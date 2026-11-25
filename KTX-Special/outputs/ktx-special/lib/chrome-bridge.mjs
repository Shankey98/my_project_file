import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, tripStatus } from './trips.mjs';

const digest = value => createHash('sha256').update(String(value)).digest();
export const extensionOrigin = value => /^chrome-extension:\/\/[a-p]{32}$/.test(value || '');
export function sanitizeSnapshot(input) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !Array.isArray(input.trains) || input.trains.length < 1 || input.trains.length > 100) throw new AppError('Chrome 조회 결과 형식을 확인해 주세요.');
  const valid = ['available', 'soldout', 'unknown'];
  const trains = input.trains.map(train => {
    if (!/^\d{1,5}$/.test(train.number || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(train.time || '') || !valid.includes(train.special) || !valid.includes(train.general)) throw new AppError('Chrome 열차 상태가 올바르지 않습니다.');
    if (typeof train.from !== 'string' || typeof train.to !== 'string' || !train.from || !train.to || train.from.length > 30 || train.to.length > 30) throw new AppError('Chrome 조회 구간을 확인해 주세요.');
    return { number: train.number, time: train.time, from: train.from, to: train.to, special: train.special, general: train.general };
  });
  return { date: input.date, trains, autoRefresh: Boolean(input.autoRefresh) };
}
export function findObservedTrain(trip, snapshot) {
  if (!snapshot || snapshot.date !== trip.date) return null;
  return snapshot.trains.find(train => train.from === trip.from && train.to === trip.to && trip.trains.some(candidate => Number(candidate.number) === Number(train.number) && candidate.time === train.time)) || null;
}
export function observedTripStatus(trip, bridge, now = Date.now()) {
  const base = tripStatus(trip, now);
  if (base.code !== 'blocked') return base;
  if (!bridge?.pairedAt) return { code: 'blocked', label: 'Chrome 연결 대기' };
  const snapshot = bridge.snapshots?.find(item => findObservedTrain(trip, item));
  if (!snapshot || now - Date.parse(snapshot.receivedAt) > 180000) return { code: 'blocked', label: '해당 열차 조회 필요' };
  const train = findObservedTrain(trip, snapshot);
  if (train.special === 'available') return { code: 'available', label: '특실 표시 발견 · 직접 예약', checkedAt: snapshot.receivedAt };
  if (train.special === 'unknown') return { code: 'blocked', label: '좌석 상태 확인 필요', checkedAt: snapshot.receivedAt };
  return { code: 'watching', label: snapshot.autoRefresh ? '확인 중 · 특실 매진' : '최근 확인 · 특실 매진', checkedAt: snapshot.receivedAt };
}

export function createChromeBridge({ store, event, json, readBody }) {
  let codeHash = null, codeExpiry = 0;
  const attempts = new Map();
  return {
    publicState() {
      const bridge = store.read().chromeBridge;
      return { paired: Boolean(bridge?.pairedAt), pairedAt: bridge?.pairedAt || null, lastSeen: bridge?.lastSeen || null, snapshots: bridge?.snapshots || [], live: Boolean(bridge?.lastSeen && Date.now() - Date.parse(bridge.lastSeen) < 150000) };
    },
    generateCode() { const code = randomBytes(12).toString('hex'); codeHash = digest(code); codeExpiry = Date.now() + 600000; return { code, expiresAt: new Date(codeExpiry).toISOString() }; },
    async disconnect() { codeHash = null; await store.update(state => { delete state.chromeBridge; event(state, 'Chrome 연결을 해제했어요'); }); },
    async handle(req, res, route) {
      const origin = req.headers.origin || `chrome-extension://${req.headers['x-ktx-extension-id'] || ''}`;
      if (!extensionOrigin(origin)) throw new AppError('Chrome 확장프로그램 요청만 허용합니다.', 403);
      if (req.headers['x-ktx-extension-id'] && origin !== `chrome-extension://${req.headers['x-ktx-extension-id']}`) throw new AppError('확장프로그램 식별자가 일치하지 않습니다.', 403);
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-KTX-Extension-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (route === '/bridge/pair' && req.method === 'POST') {
        const minute = Math.floor(Date.now() / 60000);
        if (!attempts.has(minute)) { attempts.clear(); attempts.set(minute, 0); }
        attempts.set(minute, attempts.get(minute) + 1);
        if (attempts.get(minute) > 5) throw new AppError('연결 코드 입력 횟수를 초과했습니다. 1분 후 다시 시도해 주세요.', 429);
        const input = await readBody(req);
        if (!codeHash || Date.now() > codeExpiry || !timingSafeEqual(digest(input.code), codeHash)) throw new AppError('연결 코드가 틀렸거나 만료되었습니다.', 401);
        codeHash = null;
        const token = randomBytes(32).toString('base64url');
        await store.update(state => { state.chromeBridge = { tokenHash: digest(token).toString('hex'), origin, pairedAt: new Date().toISOString(), snapshots: [], observed: {} }; event(state, '기존 Chrome 연결을 등록했어요', '좌석 조회 결과를 기다리고 있어요.'); });
        return json(res, 200, { token });
      }
      const state = store.read(), bridge = state.chromeBridge;
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      if (!bridge || origin !== bridge.origin || !token || !timingSafeEqual(digest(token), Buffer.from(bridge.tokenHash, 'hex'))) throw new AppError('PC 앱과 다시 연결해 주세요.', 401);
      if (route === '/bridge/jobs' && req.method === 'GET') return json(res, 200, { jobs: state.trips.filter(trip => trip.watchRequested && !trip.reservation && Date.parse(trip.deadline) > Date.now()).map(({ id, date, from, to, trains }) => ({ id, date, from, to, trains })), minRefreshSeconds: 60 });
      if (route === '/bridge/snapshot' && req.method === 'POST') {
        const snapshot = { ...sanitizeSnapshot(await readBody(req)), receivedAt: new Date().toISOString() };
        const alerts = [];
        await store.update(next => {
          const current = next.chromeBridge;
          if (!current || current.tokenHash !== bridge.tokenHash) throw new AppError('Chrome 연결이 해제되었습니다.', 401);
          current.lastSeen = snapshot.receivedAt;
          current.snapshots = (current.snapshots || []).filter(item => !(item.date === snapshot.date && item.trains[0]?.from === snapshot.trains[0]?.from && item.trains[0]?.to === snapshot.trains[0]?.to));
          current.snapshots.push(snapshot); current.snapshots = current.snapshots.slice(-20);
          current.observed ||= {};
          for (const trip of next.trips) {
            if (!trip.watchRequested || trip.reservation || Date.parse(trip.deadline) <= Date.now()) continue;
            const train = findObservedTrain(trip, snapshot); if (!train) continue;
            const previous = current.observed[trip.id];
            if (train.special === 'available' && previous !== 'available') {
              const detail = `${trip.date} ${train.time} ${trip.from} → ${trip.to} · KTX ${train.number} · 예약은 직접 확인해 주세요.`;
              event(next, '특실 표시를 발견했어요', detail, 'available');
              alerts.push({ title: '특실로 · 특실 표시 발견', body: detail, tripId: trip.id });
            }
            current.observed[trip.id] = train.special;
          }
        });
        return json(res, 200, { ok: true, alerts });
      }
      throw new AppError('연결 기능을 찾을 수 없습니다.', 404);
    }
  };
}
