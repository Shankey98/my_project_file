// User-started Selenium helper for the already-open Selenuim (직장) profile.
// Reads only Chrome's connection-address file, never cookies or passwords.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import nodePath from 'node:path';
const require=createRequire(new URL('../../work/selenium-probe/package.json',import.meta.url));
const {Builder,By,Key}=require('selenium-webdriver');
const chrome=require('selenium-webdriver/chrome.js');
const wsRequire=createRequire(require.resolve('selenium-webdriver'));
const {WebSocket,WebSocketServer}=wsRequire('ws');
const runtime=new URL('./.runtime/',import.meta.url);
await mkdir(runtime,{recursive:true});
const save=async(name,data)=>{const dest=new URL(name,runtime),temp=new URL(name+'.tmp',runtime);await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,dest);};
// Accept the KTX general search form at any fragment (or none), e.g. #ktx-profile1-probe.
// The results-list page (/ticket/search/list) stays excluded to keep the helper on the form.
const searchGeneral=u=>{try{const p=new URL(u);return p.origin==='https://www.korail.com'&&p.pathname==='/ticket/search/general';}catch{return false;}};
let upstream,server,wss,service,driver,client,stopping=false;
let internalId=2000000000;
const pending=new Map();
async function rpc(method,params={}) {
  const id=internalId++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Chrome 연결 응답 대기 시간 초과'));},60000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
    upstream.send(JSON.stringify({id,method,params}));
  });
}
async function cleanup(){
  if(stopping)return;stopping=true;
  if(service)await service.kill().catch(()=>{});
  client?.terminate();wss?.close();server?.close();upstream?.close();
}
process.once('SIGINT',()=>{cleanup().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{cleanup().finally(()=>process.exit(0));});
async function observe(){
  const url=await driver.getCurrentUrl();
  const parsed=new URL(url);
  if(parsed.origin!=='https://www.korail.com'||!parsed.pathname.startsWith('/ticket/search/'))throw Error('지정한 코레일 조회 화면을 벗어났습니다.');
  return {url,title:await driver.getTitle(),text:(await driver.findElement(By.css('body')).getText()).slice(0,12000),
    controls:await driver.executeScript(`return Array.from(document.querySelectorAll('input,button,select,a')).filter(e=>e.getClientRects().length&&e.type!=='password'&&e.type!=='hidden').map(e=>({tag:e.tagName,id:e.id,type:e.type||'',cls:e.className||'',title:e.getAttribute('title')||'',text:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,120),value:['startDate','endDate','labelstart','labelend'].includes(e.id)?e.value:'',href:e.getAttribute('href')||''})).filter(e=>e.id||e.text).slice(-180)`)};
}
try {
  console.log('열려 있는 Selenium(직장) 프로필에 연결합니다. Chrome에서 연결 허용을 요청하면 직접 허용해 주세요.');
  const localAppData=process.env.LOCALAPPDATA||nodePath.join(os.homedir(),'AppData','Local');
  const lines=(await readFile(nodePath.join(localAppData,'Google','Chrome','User Data','DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
  const port=Number(lines[0]),path=lines[1];
  if(!Number.isInteger(port)||port<1||port>65535||!/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(path||''))throw Error('Chrome 연결 주소 형식을 확인하지 못했습니다.');
  upstream=new WebSocket(`ws://127.0.0.1:${port}${path}`,{headers:{'User-Agent':'KTX-Selenium-Profile-Helper/0.3'}});
  await new Promise((resolve,reject)=>{upstream.once('open',resolve);upstream.once('error',()=>reject(Error('Chrome 연결을 열지 못했습니다.')));});
  upstream.on('message',bytes=>{
    let msg;try{msg=JSON.parse(bytes.toString())}catch{return;}
    if(pending.has(msg.id)){const item=pending.get(msg.id);pending.delete(msg.id);msg.error?item.reject(Error('Chrome 연결 요청 거부')):item.resolve(msg.result);}
    else if(client?.readyState===WebSocket.OPEN)client.send(bytes.toString());
  });
  upstream.on('close',()=>{for(const item of pending.values())item.reject(Error('Chrome 연결 종료'));pending.clear();});
  const version=await rpc('Browser.getVersion');
  const webkit=/AppleWebKit\/([\d.]+)/.exec(version.userAgent||'');
  const revision=String(version.revision||'').replace(/^@/,'');
  if(!webkit||!/^[a-f0-9]{7,40}$/i.test(revision))throw Error('Chrome이 반환한 엔진 버전 정보를 확인하지 못했습니다.');
  // Chrome's new consent server omits legacy HTTP discovery. This local adapter
  // supplies discovery metadata while retaining Chrome's original consent flow.
  server=http.createServer(async(req,res)=>{
    if(req.headers.origin){res.writeHead(403).end();return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.url==='/json/version')res.end(JSON.stringify({Browser:version.product,'Protocol-Version':version.protocolVersion,'User-Agent':version.userAgent,'V8-Version':version.jsVersion,'WebKit-Version':`${webkit[1]} (@${revision})`,'File-Path-Style':'windows',webSocketDebuggerUrl:`ws://127.0.0.1:${server.address().port}/devtools/browser/ktx`}));
    else if(req.url==='/json/list'||req.url==='/json'){
      try{const targets=await rpc('Target.getTargets');res.end(JSON.stringify(targets.targetInfos.filter(t=>t.type==='page'&&searchGeneral(t.url)).map(t=>({id:t.targetId,type:t.type,url:t.url,title:t.title}))));}catch{res.writeHead(502).end('{}');}
    }else res.writeHead(404).end('{}');
  });
  wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>{
    if(req.headers.origin||req.url!=='/devtools/browser/ktx'||client){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>{client=ws;ws.on('message',bytes=>{
      let msg;try{msg=JSON.parse(bytes.toString())}catch{return;}
      if(msg.method==='Browser.close'||msg.method==='Target.closeTarget'||msg.id>=2000000000){ws.send(JSON.stringify({id:msg.id,error:{code:-32000,message:'Closing user browser is disabled'},...(msg.sessionId?{sessionId:msg.sessionId}:{})}));return;}
      upstream.send(bytes.toString());
    });ws.on('close',()=>{client=undefined;});});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const driverPath=fileURLToPath(new URL('../../work/selenium-probe/driver-cache/chromedriver/win64/158.0.8127.88/chromedriver.exe',import.meta.url));
  service=new chrome.ServiceBuilder(driverPath).build();
  const serviceUrl=await service.start(15000);
  const options=new chrome.Options().debuggerAddress(`127.0.0.1:${server.address().port}`);
  driver=await new Builder().usingServer(serviceUrl).forBrowser('chrome').setChromeOptions(options).build();
  const matches=[];
  for(const handle of await driver.getAllWindowHandles()){await driver.switchTo().window(handle);if(searchGeneral(await driver.getCurrentUrl()))matches.push(handle);}
  if(matches.length!==1)throw Error('표시한 Selenium 프로필의 코레일 탭을 하나로 확인하지 못했습니다.');
  await driver.switchTo().window(matches[0]);
  await save('ready.json',{connected:true,pid:process.pid,checkedAt:new Date().toISOString(),profile:'Profile 1',observation:await observe()});
  console.log('Selenium 연결 성공. 이 창을 열어 두세요. 지정한 코레일 조회 탭만 사용합니다. 종료하려면 Ctrl+C를 누르세요.');
  let lastId='';
  while(!stopping){
    let command;try{command=JSON.parse(await readFile(new URL('command.json',runtime),'utf8'));}catch{}
    if(command?.id&&command.id!==lastId){
      lastId=command.id;
      try{
        await observe();
        if(command.action==='click'){
          const element=await driver.findElement(By.css(command.selector));
          const label=await element.getText(),href=await element.getAttribute('href')||'';
          if(/예약|결제|취소|로그인|로그아웃|회원탈퇴/.test(label)||/reservation|payment|login|logout/.test(href))throw Error('조회 전용 도우미에서는 이 동작을 실행하지 않습니다.');
          await driver.actions().move({origin:element}).pause(60).click().perform();
        } else if(command.action==='clickText'){
          const query=String(command.text||'').trim();
          if(!query)throw Error('클릭할 역 이름이 없습니다.');
          const literal=JSON.stringify(query);
          const index=Number(command.index)||1;
          if(!Number.isInteger(index)||index<1)throw Error('클릭 순번을 확인해 주세요.');
          const found=await driver.findElements(By.xpath(`//*[self::a or self::button][normalize-space(.)=${literal}]`));
          const element=found[index-1];
          if(!element)throw Error('클릭할 요소를 찾지 못했습니다.');
          const label=await element.getText(),href=await element.getAttribute('href')||'';
          if(/예약|결제|취소|로그인|로그아웃|회원탈퇴/.test(label)||/reservation|payment|login|logout/.test(href))throw Error('조회 전용 도우미에서는 이 동작을 실행하지 않습니다.');
          await driver.actions().move({origin:element}).pause(60).click().perform();
        } else if(command.action==='type'){
          const element=await driver.findElement(By.css(command.selector));
          const type=await element.getAttribute('type');
          if(!['text','search','date','number',''].includes(type||'')||/password|member|phone|email/i.test(command.selector))throw Error('조회 입력란만 편집할 수 있습니다.');
          await element.clear();await element.sendKeys(String(command.value||''));
        } else if(command.action==='key'){
          if(!['ESCAPE','ENTER','TAB','ARROW_DOWN','ARROW_UP','ARROW_LEFT','ARROW_RIGHT'].includes(command.key))throw Error('허용되지 않은 키입니다.');
          await driver.actions().sendKeys(Key[command.key]).perform();
        } else if(command.action==='stop'){stopping=true;}
        else if(command.action!=='observe')throw Error('알 수 없는 조회 동작');
        await save('result.json',{id:command.id,ok:true,checkedAt:new Date().toISOString(),observation:await observe()});
        await writeFile(new URL('screen.png',runtime),await driver.takeScreenshot(),'base64');
      }catch(error){await save('result.json',{id:command.id,ok:false,error:error.message.slice(0,500)});}
    }
    await new Promise(resolve=>setTimeout(resolve,300));
  }
}catch(error){
  const message=error.code==='EPERM'||error.code==='EACCES'?'Chrome 연결 주소 파일에 접근하지 못했습니다.':error.message.slice(0,500);
  console.error(message);await save('ready.json',{connected:false,error:message,checkedAt:new Date().toISOString()});process.exitCode=1;
}finally{stopping=false;await cleanup();}
