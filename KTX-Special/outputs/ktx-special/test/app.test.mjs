import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { validateTrip, tripStatus } from '../lib/trips.mjs';
import { openStore } from '../lib/store.mjs';
import { ReservationCoordinator } from '../lib/reservations.mjs';
import { removeTestDirectory } from './helpers.mjs';

const future = () => new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const input = (extra={}) => ({ name:'부산 출장',from:'서울',to:'부산',date:future(),passengers:{adult:1,child:0,senior:0},seatPolicy:'all',adjacency:'prefer',trains:[{number:'001',time:'10:00'},{number:'003',time:'11:00'}],existingTicket:'paid',watchRequested:true,...extra });
const dir = () => mkdtemp(path.join(os.tmpdir(),'ktx-special-test-'));

test('여행마다 인원·후보·기한을 독립 설정하고 한국 시각으로 해석한다',()=>{
 const a=validateTrip(input()),b=validateTrip(input({passengers:{adult:2,child:1,senior:1},name:'가족여행'}));
 assert.equal(b.passengers.child,1);assert.notEqual(a.id,b.id);
 assert.equal(a.deadline,`${a.date}T02:00:00.000Z`);
  assert.equal(a.deadlineMode,'last-train');
  const changedDate=validateTrip({...a,date:new Date(Date.now()+14*86400000).toISOString().slice(0,10)});
  assert.notEqual(changedDate.deadline,a.deadline);
 assert.equal(tripStatus(a).code,'blocked');
 a.watchRequested=false;assert.equal(tripStatus(a).code,'paused');assert.equal(b.watchRequested,true);
 assert.equal(tripStatus(b,Date.parse(b.deadline)+1).code,'expired');
});
test('잘못된 인원·날짜·후보 중복·과거 종료 시각을 거절한다',()=>{
 for(const extra of [
  {passengers:{adult:0,child:0,senior:0}}, {passengers:{adult:8,child:2,senior:0}},
  {passengers:{adult:1.5,child:0,senior:0}}, {date:'2027-02-31'}, {from:'서울',to:'서울'},
  {trains:[{number:'1',time:'10:00'},{number:'001',time:'11:00'}]}, {trains:[{number:'123',time:'25:00'}]},
  {deadline:'2000-01-01T00:00:00Z'}, {seatPolicy:'wrong'}
 ]) assert.throws(()=>validateTrip(input(extra)));
});
test('저장 작업을 직렬 처리하고 재시작 후에도 읽는다',async()=>{
 const folder=await dir();try{
  const store=await openStore(folder);
  await Promise.all(Array.from({length:15},(_,i)=>store.update(s=>s.trips.push(validateTrip(input({name:`여행 ${i}`}))))));
  assert.equal(store.read().trips.length,15);assert.equal((await openStore(folder)).read().trips.length,15);
  const snapshot=store.read();snapshot.trips.length=0;assert.equal(store.read().trips.length,15);
  await assert.rejects(store.update(s=>{s.trips.length=0;throw new Error('abort');}));assert.equal(store.read().trips.length,15);
 }finally{await removeTestDirectory(folder);}
});

function providerFor(trip,extra={}){
 return {capabilities:{canReserveSpecial:true},findSpecial:async()=>({count:9}),reserveSpecial:async()=>({id:'attempt'}),confirmReservation:async()=>({id:'test-reservation',payBy:new Date(Date.now()+3600000).toISOString(),seatClass:'special',trainNumber:trip.trains[0].number,date:trip.date,from:trip.from,to:trip.to,count:Object.values(trip.passengers).reduce((a,b)=>a+b,0)}),...extra};
}
test('실제 공급자가 없으면 예약 시도나 성공 알림을 만들지 않는다',async()=>{
 const trip=validateTrip(input());let saves=0,notifications=0;
 const engine=new ReservationCoordinator({provider:null,save:async()=>saves++,notify:async()=>notifications++});
 assert.equal(await engine.tick(trip),'disconnected');assert.equal(saves,0);assert.equal(notifications,0);assert.equal(trip.reservation,null);
});
test('한 여행에서 한 번만 확보하고 다른 여행 요청과 기존 일반실은 유지한다',async()=>{
 const a=validateTrip(input()),b=validateTrip(input({name:'다른 날짜 여행'}));let calls=0;const notices=[];const saved=[];
 const engine=new ReservationCoordinator({provider:providerFor(a,{reserveSpecial:async()=>{calls++;return {id:'attempt'};}}),save:async t=>saved.push(structuredClone(t)),notify:async e=>notices.push(e)});
 assert.equal(await engine.tick(a),'reserved');assert.equal(await engine.tick(a),'inactive');
 assert.equal(calls,1);assert.equal(saved[0].reservation.status,'uncertain');assert.equal(saved[1].reservation.status,'confirmed');
 assert.equal(a.existingTicket,'paid');assert.equal(b.watchRequested,true);assert.equal(b.reservation,null);assert.equal(notices[0].kind,'reserved');
});
test('동일 여행 동시 실행은 예약 중복을 막는다',async()=>{
 const trip=validateTrip(input());let calls=0,release;const pending=new Promise(resolve=>release=resolve);
 const engine=new ReservationCoordinator({provider:providerFor(trip,{reserveSpecial:async()=>{calls++;await pending;return {id:'attempt'};}}),save:async()=>{},notify:async()=>{}});
 const first=engine.tick(trip);await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(await engine.tick(trip),'busy');release();assert.equal(await first,'reserved');assert.equal(calls,1);
});
test('응답 소실·다른 등급·다른 날짜·인원 불일치면 재시도 없이 멈춘다',async()=>{
 for(const change of ['timeout','general','date','count']){
  const trip=validateTrip(input());const base=providerFor(trip);let calls=0;const notices=[];
  const engine=new ReservationCoordinator({provider:providerFor(trip,{reserveSpecial:async()=>{calls++;if(change==='timeout')throw new Error('timeout');return {};},confirmReservation:async()=>({...await base.confirmReservation(),...(change==='general'?{seatClass:'general'}:change==='date'?{date:'2000-01-01'}:change==='count'?{count:8}:{})})}),save:async()=>{},notify:async n=>notices.push(n)});
  assert.equal(await engine.tick(trip),'uncertain');assert.equal(await engine.tick(trip),'inactive');assert.equal(calls,1);assert.equal(notices[0].kind,'uncertain');
 }
});
test('전원 확보 조건은 좌석 부족시 예약하지 않고 일부 허용시 승객 선택을 임의로 하지 않는다',async()=>{
 for(const policy of ['all','partial']){
  const trip=validateTrip(input({passengers:{adult:2,child:1,senior:0},seatPolicy:policy}));let calls=0;
  const engine=new ReservationCoordinator({provider:providerFor(trip,{findSpecial:async()=>({count:1}),reserveSpecial:async()=>calls++}),save:async()=>{},notify:async()=>{}});
  assert.equal(await engine.tick(trip),policy==='all'?'unavailable':'partial_confirmation');assert.equal(calls,0);
 }
});

test('API는 인증·출처를 검증하고 CRUD·백업 가져오기를 영속 저장한다',async()=>{
 const folder=await dir();const app=await createApp({dataDir:folder});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${app.server.address().port}`;
 let cookie='';
 const request=async(route,method='GET',body,headers={})=>{
  const res=await fetch(origin+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 };
 try{
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/local-session','POST',{}, {Origin:'https://evil.invalid'})).status,403);
  cookie=(await request('/api/local-session','POST',{})).cookie.split(';')[0];
  assert.equal((await request('/api/state')).data.connection.provider.connected,false);
  assert.equal((await request('/api/pair','POST',{code:'wrong'})).status,403);
  const created=await request('/api/trips','POST',input());assert.equal(created.status,201);const id=created.data.trip.id;
  assert.equal((await request('/api/state')).data.trips[0].status.code,'blocked');
  assert.equal((await request(`/api/trips/${id}/watch`,'POST',{enabled:false})).status,200);
  assert.equal((await request('/api/state')).data.trips[0].status.code,'paused');
  assert.equal((await request(`/api/trips/${id}`,'PUT',input({name:'수정한 여행',passengers:{adult:2,child:1,senior:0},watchRequested:false}))).status,200);
  const backup=(await request('/api/export')).data;assert.equal(backup.trips[0].name,'수정한 여행');assert.equal(backup.subscriptions,undefined);
  assert.equal((await request('/api/import','POST',{...backup,trips:[...backup.trips,input({date:'bad'})]})).status,400);
  assert.equal((await request('/api/state')).data.trips.length,1);
  assert.equal((await request('/api/import','POST',backup)).data.count,1);
  const state=(await request('/api/state')).data;assert.equal(state.trips.length,2);assert.equal(state.trips[1].watchRequested,false);assert.notEqual(state.trips[1].id,id);
  assert.equal((await request('/api/push/subscription','POST',{subscription:{endpoint:'https://127.0.0.1/internal',keys:{}}})).status,400);
  assert.equal((await request('/api/pair-code','POST',{})).status,400);
  assert.equal((await request(`/api/trips/${id}`,'DELETE',{})).status,200);
  assert.equal((await openStore(folder)).read().trips.length,1);
  assert.equal((await request('/api/trips','POST',input(),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await request('/api/logout','POST',{})).status,200);assert.equal((await request('/api/state')).status,401);
 }finally{await new Promise(resolve=>app.server.close(resolve));app.server.closeAllConnections();await removeTestDirectory(folder);}
});

test('앱 종료는 인증한 localhost에서 같은 저장 폴더를 지정해야 한다',async()=>{
 const folder=await dir(),app=await createApp({dataDir:folder});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${app.server.address().port}`;
 const request=(route,body,cookie='')=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 try{
  assert.equal((await request('/api/shutdown',{})).status,401);
  const session=await request('/api/local-session',{}),cookie=session.headers.get('set-cookie').split(';')[0];await session.json();
  assert.equal((await request('/api/shutdown',{storageId:'another-app'},cookie)).status,403);
  const health=await (await fetch(origin+'/api/health')).json();
  const closed=new Promise(resolve=>app.server.once('close',resolve));
  const response=await request('/api/shutdown',{storageId:health.storageId},cookie);assert.deepEqual(await response.json(),{ok:true});await closed;assert.equal(app.server.listening,false);
 }finally{if(app.server.listening){app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}await removeTestDirectory(folder);}
});
