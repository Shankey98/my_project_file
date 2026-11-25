import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createApp} from '../server.mjs';
import {validateTrip} from '../lib/trips.mjs';
import {sanitizeSnapshot,observedTripStatus} from '../lib/chrome-bridge.mjs';
import {removeTestDirectory} from './helpers.mjs';

const date=()=>new Date(Date.now()+86400000).toISOString().slice(0,10);
const trip=()=>validateTrip({name:'서울 포항',from:'서울',to:'포항',date:date(),passengers:{adult:1,child:0,senior:0},seatPolicy:'all',adjacency:'prefer',trains:[{number:'259',time:'08:35'}],watchRequested:true,existingTicket:'paid'});
const snapshot=(special='soldout')=>({date:date(),trains:[{number:'00259',time:'08:35',from:'서울',to:'포항',general:'soldout',special}],autoRefresh:true});

test('실제 관측한 Chrome 행 형태에서 열차와 일반·특실 표시를 구분한다',async()=>{
 const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../chrome-extension/parse.js',import.meta.url),'utf8'),context);
 const parsed=context.KtxSpecialParse([
  {text:'KTX-산천\n259\n서울 → 포항(08:35 ~ 10:55)\n소요시간: 2시간 20분\n매진\n매진',seats:['매진','매진']},
  {text:'KTX-산천253서울 → 포항(05:38 ~ 08:08)소요시간:2시간 30분',seats:['일반실 48,300원 5%적립','특실(매진임박) 70,300원 5%적립']},
  {text:'일반 메뉴',seats:[]}
 ],date());
 assert.equal(parsed.trains.length,2);assert.equal(parsed.trains[0].special,'soldout');assert.equal(parsed.trains[0].number,'259');assert.equal(parsed.trains[1].special,'available');
 assert.throws(()=>context.KtxSpecialParse([],date()));assert.throws(()=>sanitizeSnapshot({date:date(),trains:[]}));
});
test('오래되거나 다른 구간·날짜의 화면을 현재 감시 결과로 표시하지 않는다',()=>{
 const t=trip(),fresh={...snapshot(),receivedAt:new Date().toISOString()};
 assert.equal(observedTripStatus(t,undefined).code,'blocked');
 assert.equal(observedTripStatus(t,{pairedAt:'yes',snapshots:[fresh]}).code,'watching');
 assert.equal(observedTripStatus(t,{pairedAt:'yes',snapshots:[{...fresh,receivedAt:'2000-01-01T00:00:00Z'}]}).code,'blocked');
 assert.equal(observedTripStatus(t,{pairedAt:'yes',snapshots:[{...fresh,date:'2000-01-01'}]}).code,'blocked');
 assert.equal(observedTripStatus(t,{pairedAt:'yes',snapshots:[{...snapshot('available'),receivedAt:new Date().toISOString()}]}).code,'available');
 assert.equal(observedTripStatus({...t,watchRequested:false},{pairedAt:'yes',snapshots:[fresh]}).code,'paused');
});
test('Chrome 연결은 1회용 코드·확장 ID·토큰을 검증하고 자리 발견 알림을 중복 생성하지 않는다',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'ktx-special-test-bridge-'));const app=await createApp({dataDir:folder});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`,extension='a'.repeat(32);let cookie='',token='';
 const request=async(route,method='GET',body,bridge=false,extra={})=>{
  const res=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(bridge?{'X-KTX-Extension-Id':extension,Origin:`chrome-extension://${extension}`,...(token?{Authorization:`Bearer ${token}`}:{})}:{Cookie:cookie}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 };
 try{
  assert.equal((await request('/bridge/jobs')).status,403);
  cookie=(await request('/api/local-session','POST',{})).cookie.split(';')[0];
  await app.store.update(state=>state.trips.push(trip()));
  const {code}=(await request('/api/chrome/code','POST',{})).data;
  assert.equal((await request('/bridge/pair','POST',{code},true,{Origin:'https://evil.invalid'})).status,403);
  const paired=await request('/bridge/pair','POST',{code},true);assert.equal(paired.status,200);token=paired.data.token;
  assert.equal((await request('/bridge/pair','POST',{code},true)).status,401);
  assert.equal((await request('/bridge/jobs','GET',undefined,true)).data.jobs.length,1);
  assert.equal((await request('/bridge/snapshot','POST',snapshot(),true)).status,200);
  const first=await request('/bridge/snapshot','POST',snapshot('available'),true);assert.equal(first.data.alerts.length,1);
  assert.equal((await request('/bridge/snapshot','POST',snapshot('available'),true)).data.alerts.length,0);
  const state=(await request('/api/state')).data;assert.equal(state.connection.chrome.live,true);assert.equal(state.trips[0].status.code,'available');assert.equal(state.trips[0].reservation,null);assert.equal(state.connection.chrome.tokenHash,undefined);
  assert.equal((await request('/bridge/jobs','GET',undefined,true,{Origin:`chrome-extension://${'b'.repeat(32)}`})).status,403);
  await request('/api/chrome/disconnect','POST',{});assert.equal((await request('/bridge/jobs','GET',undefined,true)).status,401);
 }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await removeTestDirectory(folder);}
});
