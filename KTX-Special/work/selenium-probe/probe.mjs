import {Builder,By} from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const folder=new URL('../../outputs/ktx-selenium-probe/',import.meta.url);
await mkdir(folder,{recursive:true});
process.env.SE_CACHE_PATH=fileURLToPath(new URL('./driver-cache/',import.meta.url));
process.env.SE_AVOID_STATS='true';
process.env.SE_AVOID_BROWSER_DOWNLOAD='true';
process.env.SE_TIMEOUT='25';
const options=new chrome.Options().setChromeBinaryPath('C:/Program Files/Google/Chrome/Application/chrome.exe');
if(process.env.KTX_PROBE_HEADED!=='1')options.addArguments('--headless=new');
options.addArguments('--window-size=1440,1100','--lang=ko-KR','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--user-data-dir='+fileURLToPath(new URL('./test-profile/',import.meta.url)));
let driver;
try {
  const service=new chrome.ServiceBuilder().loggingTo(fileURLToPath(new URL('./driver.log',import.meta.url)));
  driver=await new Builder().forBrowser('chrome').setChromeOptions(options).setChromeService(service).build();
  await driver.manage().setTimeouts({pageLoad:30000,script:10000});
  await driver.get('https://www.korail.com/ticket/search/general');
  await driver.wait(async()=>{
    const body=await driver.findElement(By.css('body')).getText();
    return /열차 조회|CODE\s*:|서비스 이용 안내|매크로/.test(body);
  },20000);
  const page={checkedAt:new Date().toISOString(),runtime:'Selenium + local Chrome, fresh test profile',
    browserVersion:(await driver.getCapabilities()).get('browserVersion'),title:await driver.getTitle(),url:await driver.getCurrentUrl(),
    text:(await driver.findElement(By.css('body')).getText()).slice(0,7000),
    controls:await driver.executeScript(`return Array.from(document.querySelectorAll('input,button,select,a')).filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,type:e.type,text:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,100),value:e.value||'',href:e.getAttribute('href')||''})).filter(e=>e.id||e.text||e.value).slice(-120)`),seatLookupVerified:false};
  await writeFile(new URL('initial.json',folder),JSON.stringify(page,null,2));
  await writeFile(new URL('initial.png',folder),await driver.takeScreenshot(),'base64');
  console.log(JSON.stringify(page,null,2));
} catch(error) {
  const failure={checkedAt:new Date().toISOString(),runtime:'Selenium + local Chrome, fresh test profile',headed:process.env.KTX_PROBE_HEADED==='1',stage:driver?'page':'browser-start',error:error.name,message:error.message.slice(0,1800),seatLookupVerified:false,cloudExecutionVerified:false};
  await writeFile(new URL('launch-error.json',folder),JSON.stringify(failure,null,2));
  console.log(JSON.stringify(failure));
  process.exitCode=1;
} finally {if(driver)await driver.quit();}
