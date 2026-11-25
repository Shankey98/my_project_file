import { createECDH, createCipheriv, generateKeyPairSync, createPrivateKey, sign, hkdfSync, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './trips.mjs';

export const allowedPushHost = (host) => host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
export function validateSubscription(value) {
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { throw new AppError('알림 서비스 주소가 올바르지 않습니다.'); }
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.hash || !allowedPushHost(endpoint.hostname) || endpoint.href.length > 4096) throw new AppError('지원하지 않는 알림 서비스입니다.');
  const publicKey = Buffer.from(value.keys?.p256dh || '', 'base64url'), auth = Buffer.from(value.keys?.auth || '', 'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) throw new AppError('알림 등록 키를 확인해 주세요.');
  try { const check = createECDH('prime256v1'); check.generateKeys(); check.computeSecret(publicKey); } catch { throw new AppError('알림 공개키가 올바르지 않습니다.'); }
  return { endpoint: endpoint.href, keys: { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') } };
}
export async function loadPushKeys(directory) {
  const file = path.join(directory, 'push-keys.json');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = pair.privateKey.export({ format: 'jwk' }), publicJwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x, 'base64url'), Buffer.from(publicJwk.y, 'base64url')]).toString('base64url');
  const keys = { privateJwk, publicKey };
  await writeFile(file, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
  return keys;
}
export function encryptPayload(subscription, payload) {
  const receiver = Buffer.from(subscription.keys.p256dh, 'base64url'), auth = Buffer.from(subscription.keys.auth, 'base64url');
  const sender = createECDH('prime256v1'); sender.generateKeys();
  const publicKey = sender.getPublicKey();
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiver, publicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', sender.computeSecret(receiver), auth, info, 32));
  const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])]);
  if (plaintext.length > 3000) throw new AppError('알림 내용이 너무 깁니다.');
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const record = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header); header.writeUInt32BE(4096, 16); header[20] = publicKey.length;
  return Buffer.concat([header, publicKey, record]);
}
export function buildPushRequest(subscription, payload, keys, contact, now = Date.now()) {
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new AppError('알림 설정에 연락용 이메일을 먼저 저장해 주세요.');
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ aud: new URL(subscription.endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: contact })).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: createPrivateKey({ key: keys.privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { TTL: '120', Urgency: 'high', 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', Authorization: `vapid t=${unsigned}.${signature}, k=${keys.publicKey}` }, body: encryptPayload(subscription, payload) };
}
export async function sendPush(subscription, payload, keys, contact, fetcher = fetch) {
  const request = buildPushRequest(validateSubscription(subscription), payload, keys, contact);
  const response = await fetcher(subscription.endpoint, request);
  return { ok: response.status >= 200 && response.status < 300, expired: response.status === 404 || response.status === 410, status: response.status };
}
