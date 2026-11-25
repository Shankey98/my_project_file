const base='http://127.0.0.1:47831';
const session=await fetch(base+'/api/local-session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if(!session.ok)throw new Error('Local session failed');
const cookie=session.headers.get('set-cookie').split(';')[0];await session.json();
const call=async(route,body)=>{const response=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
const state=await call('/state');
const exists=state.trips.some(t=>t.date==='2026-11-23'&&t.from==='서울'&&t.to==='포항'&&t.trains.some(train=>Number(train.number)===259&&train.time==='08:35'));
if(!exists)await call('/trips',{name:'서울 → 포항 · 오전 8:35',date:'2026-11-23',from:'서울',to:'포항',passengers:{adult:1,child:0,senior:0},seatPolicy:'all',adjacency:'prefer',trains:[{number:'259',time:'08:35'}],existingTicket:'paid',watchRequested:true,notes:'기존 Chrome에서 259번 08:35~10:55를 조회함. 확장 설치 후 연결 확인 필요. 자동 예약 미연결.'});
console.log(exists?'Target trip already present; preserved.':'Target trip saved: 2026-11-23 Seoul-Pohang 08:35 / KTX 259 / 1 adult / Chrome pairing pending.');
