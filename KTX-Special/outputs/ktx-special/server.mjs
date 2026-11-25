import http from 'node:http';
import https from 'node:https';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { openStore } from './lib/store.mjs';
import { AppError, validateTrip } from './lib/trips.mjs';
import { loadPushKeys, validateSubscription, sendPush } from './lib/push.mjs';
import { createChromeBridge, observedTripStatus } from './lib/chrome-bridge.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const localAddress = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
const hash = value => createHash('sha256').update(String(value)).digest();
const event = (state, title, detail = '', kind = 'info') => state.events.push({ id: randomUUID(), at: new Date().toISOString(), title, detail, kind });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export async function createApp({ dataDir = path.join(root, '.local'), publicOrigin = '', tls = null, contact = '', fetcher = fetch } = {}) {
  await mkdir(dataDir, { recursive: true });
  const store = await openStore(dataDir), keys = await loadPushKeys(dataDir);
  const sessions = new Map(), limits = new Map();
  let pairCode = null, pairExpiry = 0;
  const startedAt = new Date().toISOString();
  const storageId = createHash('sha256').update(path.resolve(dataDir).toLowerCase()).digest('hex');
  const token = () => randomBytes(32).toString('base64url');
  const nordInstalled = existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NordVPN', 'NordVPN.exe'));
  const meshInterfaces = () => Object.entries(os.networkInterfaces()).flatMap(([name, list]) => /nord|mesh|lynx/i.test(name) ? list.filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, address: item.address })) : []);
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const readBody = async req => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError('JSON 형식의 요청이 필요합니다.', 415);
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 262144) throw new AppError('요청 용량이 너무 큽니다.', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('요청 내용을 읽을 수 없습니다.'); }
  };
  const setSession = (req, res) => {
    const value = token(); sessions.set(value, Date.now() + 86400000);
    res.setHeader('Set-Cookie', `ktx_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${req.socket.encrypted ? '; Secure' : ''}`);
  };
  const sessionToken = req => /(?:^|;\s*)ktx_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  const requireLocal = req => {
    const hostname = new URL(`http://${req.headers.host}`).hostname;
    if (!localAddress(req.socket.remoteAddress) || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) throw new AppError('PC의 localhost 화면에서만 사용할 수 있습니다.', 403);
  };
  const chromeBridge = createChromeBridge({ store, event, json, readBody });
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      const port = server.address()?.port;
      const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      const remoteHost = publicOrigin ? new URL(publicOrigin).host : '';
      if (!localHosts.includes(host) && host !== remoteHost) throw new AppError('허용되지 않은 접속 주소입니다.', 403);
      const origin = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
      const url = new URL(req.url, origin), route = url.pathname;
      if (route.startsWith('/bridge/')) {
        if (!localAddress(req.socket.remoteAddress)) throw new AppError('Chrome 연결은 이 PC에서만 허용합니다.', 403);
        return await chromeBridge.handle(req, res, route);
      }
      if (req.headers.origin && req.headers.origin !== origin) throw new AppError('다른 사이트의 요청은 허용하지 않습니다.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site' && route.startsWith('/api/')) throw new AppError('다른 사이트의 요청은 허용하지 않습니다.', 403);
      if (route.startsWith('/api/')) {
        const ip = req.socket.remoteAddress;
        const limited = limits.get(ip) || { start: Date.now(), count: 0, pair: 0 };
        if (Date.now() - limited.start > 60000) { limited.start = Date.now(); limited.count = 0; limited.pair = 0; }
        limited.count++; limits.set(ip, limited);
        if (limited.count > 150) throw new AppError('요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429);
        if (route === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, app: 'ktx-special-local', version: '0.2.0', storageId });
        if (route === '/api/local-session' && req.method === 'POST') {
          requireLocal(req); await readBody(req); setSession(req, res); return json(res, 200, { ok: true });
        }
        if (route === '/api/pair' && req.method === 'POST') {
          if (!req.socket.encrypted) throw new AppError('휴대폰 연결에는 HTTPS 접속이 필요합니다.', 403);
          if (++limited.pair > 5) throw new AppError('연결 코드 입력 횟수를 초과했습니다. 1분 뒤 다시 시도해 주세요.', 429);
          const input = await readBody(req);
          if (!pairCode || pairExpiry < Date.now() || !timingSafeEqual(hash(input.code), pairCode)) throw new AppError('연결 코드가 틀렸거나 만료되었습니다.', 401);
          pairCode = null; setSession(req, res); return json(res, 200, { ok: true });
        }
        if (!sessions.has(sessionToken(req)) || sessions.get(sessionToken(req)) < Date.now()) throw new AppError('이 기기를 먼저 연결해 주세요.', 401);
        if (route === '/api/shutdown' && req.method === 'POST') {
          requireLocal(req); const input = await readBody(req);
          if (input.storageId !== storageId) throw new AppError('다른 실행 폴더의 앱은 종료할 수 없습니다.', 403);
          json(res, 200, { ok: true });
          setImmediate(() => { server.emit('app-shutdown'); server.close(); server.closeAllConnections(); });
          return;
        }
        if (route === '/api/logout' && req.method === 'POST') {
          await readBody(req); sessions.delete(sessionToken(req)); res.setHeader('Set-Cookie', 'ktx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
        }
        if (route === '/api/state' && req.method === 'GET') {
          const state = store.read();
          const chrome = chromeBridge.publicState();
          return json(res, 200, { trips: state.trips.map(trip => ({ ...trip, status: observedTripStatus(trip, state.chromeBridge) })), events: state.events.slice().reverse(), connection: { startedAt, serverTime: new Date().toISOString(), transportSecure: Boolean(req.socket.encrypted), httpsConfigured: Boolean(tls), local: localAddress(req.socket.remoteAddress), nordInstalled, meshInterfaces: meshInterfaces(), publicOrigin, chrome, provider: { connected: chrome.live, name: '기존 Chrome 조회', canReserveSpecial: false, message: chrome.live ? 'Chrome 조회 연결됨 · 자동 예약은 연결되지 않았습니다.' : 'Chrome 확장프로그램 연결이 필요합니다. 자동 예약은 연결되지 않았습니다.' } }, push: { publicKey: keys.publicKey, devices: state.subscriptions.map(item => ({ id: item.id, name: item.name, createdAt: item.createdAt })), contact: state.contact || contact.replace(/^mailto:/, '') } });
        }
        if (route === '/api/chrome/code' && req.method === 'POST') { requireLocal(req); await readBody(req); return json(res, 200, chromeBridge.generateCode()); }
        if (route === '/api/chrome/disconnect' && req.method === 'POST') { requireLocal(req); await readBody(req); await chromeBridge.disconnect(); return json(res, 200, { ok: true }); }
        if (route === '/api/trips' && req.method === 'POST') {
          const trip = validateTrip(await readBody(req));
          await store.update(state => { if (state.trips.length >= 100) throw new AppError('여행은 최대 100개까지 등록할 수 있습니다.'); state.trips.push(trip); event(state, '여행을 등록했어요', trip.name); });
          return json(res, 201, { trip });
        }
        const match = /^\/api\/trips\/([a-f0-9-]{36})(\/watch)?$/.exec(route);
        if (match && ['PUT', 'DELETE', 'POST'].includes(req.method)) {
          const input = await readBody(req);
          const result = await store.update(state => {
            const index = state.trips.findIndex(trip => trip.id === match[1]);
            if (index < 0) throw new AppError('여행을 찾을 수 없습니다.', 404);
            const old = state.trips[index];
            if (match[2] && req.method === 'POST') {
              if (typeof input.enabled !== 'boolean') throw new AppError('감시 설정을 확인해 주세요.');
              if (old.reservation) throw new AppError('예약내역을 확인한 뒤 변경해 주세요.');
              if (input.enabled && Date.parse(old.deadline) <= Date.now()) throw new AppError('종료 시각이 지난 여행입니다. 날짜를 수정해 주세요.');
              old.watchRequested = input.enabled; old.updatedAt = new Date().toISOString();
              event(state, input.enabled ? '감시 요청을 저장했어요' : '감시 요청을 해제했어요', `${old.name}${input.enabled ? ' · 코레일 연동 대기 중' : ''}`);
            } else if (!match[2] && req.method === 'PUT') {
              if (old.reservation) throw new AppError('예약내역이 있는 여행은 수정할 수 없습니다.');
              state.trips[index] = validateTrip(input, { id: old.id, createdAt: old.createdAt }); event(state, '여행 설정을 바꿨어요', old.name);
            } else if (!match[2] && req.method === 'DELETE') {
              state.trips.splice(index, 1); event(state, '여행을 삭제했어요', old.name);
            } else throw new AppError('지원하지 않는 요청입니다.', 405);
            return { ok: true };
          });
          return json(res, 200, result);
        }
        if (route === '/api/export' && req.method === 'GET') {
          return json(res, 200, { format: 'ktx-special-trips', version: 1, exportedAt: new Date().toISOString(), trips: store.read().trips.map(({ reservation, ...trip }) => ({ ...trip, watchRequested: false })) });
        }
        if (route === '/api/import' && req.method === 'POST') {
          const input = await readBody(req);
          if (input.format !== 'ktx-special-trips' || input.version !== 1 || !Array.isArray(input.trips) || input.trips.length > 100) throw new AppError('특실로 여행 백업 파일을 선택해 주세요.');
          const trips = input.trips.map(trip => validateTrip({ ...trip, watchRequested: false }, { allowPast: true }));
          await store.update(state => { if (state.trips.length + trips.length > 100) throw new AppError('여행은 최대 100개까지 등록할 수 있습니다.'); state.trips.push(...trips); event(state, '여행 백업을 가져왔어요', `${trips.length}개 여행 · 일시정지 상태로 등록`); });
          return json(res, 200, { count: trips.length });
        }
        if (route === '/api/pair-code' && req.method === 'POST') {
          requireLocal(req); await readBody(req);
          if (!tls || !publicOrigin) throw new AppError('HTTPS 외부 접속 주소를 먼저 설정해야 합니다. 연결 설정 안내를 확인해 주세요.');
          const code = randomBytes(12).toString('hex'); pairCode = hash(code); pairExpiry = Date.now() + 600000;
          return json(res, 200, { code, expiresAt: new Date(pairExpiry).toISOString(), origin: publicOrigin });
        }
        if (route === '/api/push/contact' && req.method === 'POST') {
          const input = await readBody(req), email = typeof input.email === 'string' ? input.email.trim() : '';
          if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('연락용 이메일 주소를 확인해 주세요.');
          await store.update(state => { state.contact = email; }); return json(res, 200, { ok: true });
        }
        if (route === '/api/push/subscription' && req.method === 'POST') {
          const input = await readBody(req), subscription = validateSubscription(input.subscription);
          const id = createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 24);
          await store.update(state => {
            if (!state.contact && !contact) throw new AppError('연락용 이메일을 먼저 저장해 주세요.');
            if (state.subscriptions.length >= 12 && !state.subscriptions.some(device => device.id === id)) throw new AppError('알림 기기는 최대 12대까지 등록할 수 있습니다.');
            state.subscriptions = state.subscriptions.filter(device => device.id !== id);
            state.subscriptions.push({ ...subscription, id, name: typeof input.name === 'string' ? input.name.trim().slice(0, 40) || '내 기기' : '내 기기', createdAt: new Date().toISOString() });
            event(state, '알림 기기를 연결했어요', '테스트 알림을 보내 수신을 확인해 주세요.');
          });
          return json(res, 201, { id });
        }
        if (route.startsWith('/api/push/devices/') && req.method === 'DELETE') {
          await readBody(req); const id = route.slice('/api/push/devices/'.length);
          await store.update(state => { state.subscriptions = state.subscriptions.filter(device => device.id !== id); }); return json(res, 200, { ok: true });
        }
        if (route === '/api/push/test' && req.method === 'POST') {
          await readBody(req); const state = store.read();
          if (!state.subscriptions.length) throw new AppError('먼저 이 기기에서 알림을 등록해 주세요.');
          if (!state.contact && !contact) throw new AppError('연락용 이메일을 먼저 저장해 주세요.');
          const results = await Promise.all(state.subscriptions.map(async sub => {
            try { return { id: sub.id, ...await sendPush(sub, { title: '특실로 · 테스트 알림', body: '자체 푸시 전송 테스트입니다. 실제 특실 예약이 아닙니다.', url: '/#notifications', tag: 'ktx-special-test' }, keys, state.contact ? `mailto:${state.contact}` : contact, fetcher) }; }
            catch { return { id: sub.id, ok: false, expired: false }; }
          }));
          const accepted = results.filter(result => result.ok).length;
          await store.update(next => {
            next.subscriptions = next.subscriptions.filter(sub => !results.some(result => result.id === sub.id && result.expired));
            event(next, accepted ? '테스트 알림 전송을 요청했어요' : '테스트 알림 전송에 실패했어요', `${accepted}/${results.length}대 · 실제 수신은 기기에서 확인해 주세요.`, accepted ? 'info' : 'warning');
          });
          return json(res, accepted ? 200 : 502, accepted ? { accepted, total: results.length } : { error: '알림 서비스에 전송하지 못했습니다. PC 인터넷 연결과 기기 등록 상태를 확인해 주세요.' });
        }
        throw new AppError('요청한 기능을 찾을 수 없습니다.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('지원하지 않는 요청입니다.', 405);
      const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest', '/icon.svg': 'icon.svg', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png' };
      const file = files[route]; if (!file) throw new AppError('페이지를 찾을 수 없습니다.', 404);
      const body = await readFile(path.join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || (file.endsWith('.png') ? 'image/png' : 'application/octet-stream'), 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : '처리 중 오류가 발생했습니다. 다시 시도해 주세요.' });
      else res.end();
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  const clean = setInterval(() => {
    for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
    for (const [key, value] of limits) if (Date.now() - value.start > 120000) limits.delete(key);
  }, 60000); clean.unref();
  server.on('close', () => clearInterval(clean));
  return { server, store, handler };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const host = process.env.KTX_HOST || '127.0.0.1', port = Number(process.env.KTX_PORT || 47831);
    const cert = process.env.KTX_TLS_CERT, key = process.env.KTX_TLS_KEY, publicOrigin = process.env.KTX_PUBLIC_ORIGIN || '';
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('KTX_PORT는 1024~65535로 설정해 주세요.');
    if (Boolean(cert) !== Boolean(key)) throw new Error('HTTPS 인증서와 키를 함께 설정해 주세요.');
    if (!['127.0.0.1', '::1'].includes(host)) {
      if (!cert || !publicOrigin.startsWith('https://')) throw new Error('외부 연결은 HTTPS 인증서·키·KTX_PUBLIC_ORIGIN 설정 후 실행할 수 있습니다.');
      const addresses = Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address);
      if (!addresses.includes(host) || host === '0.0.0.0') throw new Error('KTX_HOST에는 이 PC의 Meshnet 인터페이스 IP를 지정해 주세요.');
    }
    if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('KTX_PUBLIC_ORIGIN에는 경로 없는 HTTPS 주소를 입력해 주세요.');
    const tls = cert ? { cert: await readFile(cert), key: await readFile(key) } : null;
    const { server, handler } = await createApp({ tls, publicOrigin, dataDir: process.env.KTX_DATA_DIR || path.join(root, '.local') });
    let localServer;
    if (!['127.0.0.1', '::1'].includes(host)) {
      localServer = http.createServer(handler);
      localServer.listen(port, '127.0.0.1');
      localServer.on('error', error => { console.error(`PC 관리 화면 실행 실패: ${error.message}`); server.close(); server.closeAllConnections(); process.exitCode = 1; });
    }
    server.on('app-shutdown', () => { localServer?.close(); localServer?.closeAllConnections(); });
    server.listen(port, host, () => {
      console.log(`특실로 개발판 0.2.0 · ${tls ? 'https' : 'http'}://${host === '::1' ? '[::1]' : host}:${port}`);
      console.log('여행 관리: 사용 가능 / Chrome 조회: 확장 연결 필요 / 자동 예약: 연결되지 않음');
      console.log('종료: Ctrl+C. PC 종료·절전 중에는 작동하지 않습니다.');
    });
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '이미 실행 중이거나 같은 포트를 사용 중입니다. 기존 창을 확인해 주세요.' : `실행 실패: ${error.message}`); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); localServer?.close(); localServer?.closeAllConnections(); });
  } catch (error) { console.error(`실행 실패: ${error.message}`); process.exitCode = 1; }
}
