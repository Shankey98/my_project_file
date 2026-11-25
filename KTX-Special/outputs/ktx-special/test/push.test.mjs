import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, createDecipheriv, hkdfSync, createPublicKey, verify } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateSubscription, loadPushKeys, encryptPayload, buildPushRequest, sendPush } from '../lib/push.mjs';
import { removeTestDirectory } from './helpers.mjs';
function fixture(){const receiver=createECDH('prime256v1');receiver.generateKeys();const auth=randomBytes(16);return {receiver,auth,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/test-fixture',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}}};}
test('Web Push aes128gcm 페이로드를 수신자 키로 복호화할 수 있다',()=>{
 const {receiver,auth,subscription}=fixture(),payload={title:'특실로 테스트',body:'실제 예약이 아닙니다.'};
 const body=encryptPayload(subscription,payload),salt=body.subarray(0,16),size=body.readUInt32BE(16),keyLength=body[20];
 assert.equal(size,4096);assert.equal(keyLength,65);
 const sender=body.subarray(21,21+keyLength),encrypted=body.subarray(21+keyLength);
 const info=Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender]);
 const ikm=Buffer.from(hkdfSync('sha256',receiver.computeSecret(sender),auth,info,32));
 const key=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
 const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(encrypted.subarray(-16));
 const plain=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);
 assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(plain.subarray(0,-1)),payload);
});
test('VAPID 서명이 검증되고 audience·만료·연락처가 올바르다',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'ktx-special-push-'));
 try{
  const keys=await loadPushKeys(folder),same=await loadPushKeys(folder);assert.deepEqual(keys,same);
  const {subscription}=fixture(),now=Date.now(),request=buildPushRequest(subscription,{title:'test'},keys,'mailto:me@example.com',now);
  const jwt=/vapid t=(.*), k=/.exec(request.headers.Authorization)[1],parts=jwt.split('.');
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.exp,Math.floor(now/1000)+3600);assert.equal(claims.sub,'mailto:me@example.com');
  assert.equal(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:createPublicKey({key:keys.privateJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
  assert.equal(request.redirect,'error');
  const accepted=await sendPush(subscription,{title:'test'},keys,'mailto:me@example.com',async()=>({status:201}));assert.equal(accepted.ok,true);
  const expired=await sendPush(subscription,{title:'test'},keys,'mailto:me@example.com',async()=>({status:410}));assert.equal(expired.expired,true);
  assert.throws(()=>buildPushRequest(subscription,{},keys,''));
 }finally{await removeTestDirectory(folder);}
});
test('임의 URL로 푸시를 보내거나 잘못된 암호 키를 등록할 수 없다',()=>{
 const {subscription}=fixture();assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
 for(const endpoint of ['http://fcm.googleapis.com/','https://localhost/','https://fcm.googleapis.com.evil.invalid/','https://fcm.googleapis.com:444/','https://user:pass@fcm.googleapis.com/'])assert.throws(()=>validateSubscription({...subscription,endpoint}));
 assert.throws(()=>validateSubscription({...subscription,keys:{p256dh:'bad',auth:'bad'}}));
});
