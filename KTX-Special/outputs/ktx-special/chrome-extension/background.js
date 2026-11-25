const BASE = 'http://127.0.0.1:47831';
let busy = false;
async function request(path, body) {
  const {token} = await chrome.storage.local.get('token');
  const response = await fetch(BASE + path, {method:body===undefined?'GET':'POST',headers:{'X-KTX-Extension-Id':chrome.runtime.id,...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data = await response.json(); if(!response.ok) throw new Error(data.error || 'PC 연결에 실패했습니다.'); return data;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitComplete(tabId, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const tab = await chrome.tabs.get(tabId); if (tab.status === 'complete') return true; } catch { return false; }
    await sleep(500);
  }
  return false;
}

async function getListDate(tabId) {
  try {
    const [{result}] = await chrome.scripting.executeScript({target:{tabId}, func:() => {
      if (location.origin !== 'https://www.korail.com') return null;
      const v = document.querySelector('#startDate')?.value || '';
      const m = v.match(/\d{4}-\d{2}-\d{2}/);
      return m ? m[0] : null;
    }});
    return result || null;
  } catch { return null; }
}

async function clickInPage(tabId, selector) {
  try {
    const [{result}] = await chrome.scripting.executeScript({target:{tabId}, args:[selector], func:(sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }});
    return Boolean(result);
  } catch { return false; }
}

// (removed) synthetic date-driving: korail ignores programmatic element.click(),
// so date changes require a real user click. Automatic refresh is done via chrome.tabs.reload.


async function readTab(tabId) {
  await chrome.scripting.executeScript({target:{tabId}, files:['parse.js','content.js']});
  const reply = await chrome.tabs.sendMessage(tabId, {kind:'READ_TRAIN_RESULTS'});
  if (!reply?.ok) throw new Error(reply?.error || '조회 결과를 읽지 못했습니다.');
  return reply.snapshot;
}
// Read every open korail 결과(list) tab. In auto mode, reload the tab so the SAME query
// is re-fetched with fresh seats (a trusted browser reload = same as the user pressing F5).
// No synthetic clicks; nothing else is touched.
async function autoScan(reason) {
  if (busy) return;
  busy = true;
  const info = [];
  try {
    const {token, automatic} = await chrome.storage.local.get(['token','automatic']);
    if (!token) throw new Error('PC 앱과 먼저 연결해 주세요.');
    const {jobs} = await request('/bridge/jobs');
    const tabs = await chrome.tabs.query({url:'https://www.korail.com/ticket/search/list*'});
    if (!tabs.length) throw new Error('코레일 조회 결과 탭을 하나 열어 두세요. (자동 새로고침은 그 탭을 이용합니다.)');
    const reloads = (await chrome.storage.local.get('lastReloads')).lastReloads || {};
    let matched = false;
    for (const tab of tabs.slice(0,3)) {
      let snapshot;
      try { snapshot = await readTab(tab.id); } catch (error) { info.push(error.message); continue; }
      const job = jobs.find(j => j.date === snapshot.date);
      if (job) {
        const result = await request('/bridge/snapshot', {...snapshot, autoRefresh:Boolean(automatic)});
        for (const alert of result.alerts) await chrome.notifications.create({type:'basic',iconUrl:'icon.png',title:alert.title,message:alert.body});
        matched = true;
        info.push(snapshot.date + ' ' + snapshot.trains.length + '대');
      }
      if (automatic && Date.now() - (reloads[tab.id]||0) >= 55000) {
        reloads[tab.id] = Date.now();
        chrome.tabs.reload(tab.id);
      }
    }
    await chrome.storage.local.set({lastReloads:reloads});
    await chrome.storage.local.set({lastCheck:new Date().toISOString(), lastError: matched ? '' : '감시 날짜와 같은 결과 탭이 없습니다. 해당 날짜 조회 결과 탭을 열어 두세요.', lastDrivenDates: info});
  } catch (error) {
    await chrome.storage.local.set({lastError:error.message, lastCheck:new Date().toISOString()});
  } finally { busy = false; }
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'check-results') autoScan('alarm'); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('check-results', {periodInMinutes:1}); autoScan('startup'); });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('check-results', {periodInMinutes:1}));
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.kind === 'PAIR') {
    request('/bridge/pair', {code:String(message.code||'').trim()}).then(async data => {
      await chrome.storage.local.set({token:data.token, automatic:false, lastError:''});
      await chrome.alarms.create('check-results', {periodInMinutes:1});
      reply({ok:true});
    }).catch(error => reply({ok:false, error:error.message}));
    return true;
  }
  if (message.kind === 'SCAN') { autoScan('manual').then(() => reply({ok:true})); return true; }
});
