/** Attach Selenium to the user's already-running Chrome; do not launch/copy a profile. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../../work/selenium-probe/package.json',import.meta.url));
const {Builder,By}=require('selenium-webdriver');
const chrome=require('selenium-webdriver/chrome.js');
const address=process.env.KTX_CHROME_DEBUG_ADDRESS || '';
if(!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(address) || Number(address.split(':')[1])>65535) {
  throw new Error('Chrome 원격 디버깅 화면에서 확인한 로컬 주소를 KTX_CHROME_DEBUG_ADDRESS로 지정하세요.');
}
const targetUrl='https://www.korail.com/ticket/search/general#ktx-profile1-probe';
const driverPath=fileURLToPath(new URL('../../work/selenium-probe/driver-cache/chromedriver/win64/158.0.8127.88/chromedriver.exe',import.meta.url));
const service=new chrome.ServiceBuilder(driverPath).build();
let driver;
try {
  const server=await service.start(15000);
  const options=new chrome.Options().debuggerAddress(address);
  driver=await new Builder().usingServer(server).forBrowser('chrome').setChromeOptions(options).build();
  await driver.manage().setTimeouts({pageLoad:30000,script:10000});
  const matches=[];
  for(const handle of await driver.getAllWindowHandles()) {
    await driver.switchTo().window(handle);
    if(await driver.getCurrentUrl()===targetUrl)matches.push(handle);
  }
  if(matches.length!==1)throw new Error('지정한 Selenium 프로필의 테스트 탭을 정확히 하나 찾지 못했습니다. 다른 탭을 조작하지 않습니다.');
  await driver.switchTo().window(matches[0]);
  const report={checkedAt:new Date().toISOString(),runtime:'Selenium attached to existing Chrome',
    profileName:'Selenuim (직장)',profileDirectory:'Profile 1',url:await driver.getCurrentUrl(),title:await driver.getTitle(),
    text:(await driver.findElement(By.css('body')).getText()).slice(0,6000),seatLookupVerified:false,cloudExecutionVerified:false};
  const results=new URL('./attached-results/',import.meta.url);
  await mkdir(results,{recursive:true});
  await writeFile(new URL('connection.json',results),JSON.stringify(report,null,2));
  await writeFile(new URL('connection.png',results),await driver.takeScreenshot(),'base64');
  console.log(JSON.stringify({connected:true,title:report.title,url:report.url,seatLookupVerified:false}));
} finally {
  // Do not send WebDriver Quit/Close to the user's browser.
  // Terminate only the ChromeDriver service created above.
  await service.kill();
}
