(() => {
  if (globalThis.ktxSpecialListenerInstalled) return;
  globalThis.ktxSpecialListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.kind !== 'READ_TRAIN_RESULTS') return;
    try {
      if (location.origin !== 'https://www.korail.com' || location.pathname !== '/ticket/search/list') throw new Error('코레일 조회 결과 화면이 아닙니다.');
      if (/CODE\s*:\s*-8003|매크로.*미허가|미허가 도구/.test(document.body.innerText)) throw new Error('코레일 이용 제한 안내가 표시되어 확인을 중지했습니다.');
      const date = document.querySelector('#startDate')?.value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      const rows = [...document.querySelectorAll('#container li')].map(el => ({text: el.innerText, seats: [...el.querySelectorAll('a,button')].map(link => link.innerText.trim().replace(/\s+/g,' ')).filter(text => /매진|특실|일반실|입석/.test(text))}));
      reply({ok:true,snapshot:globalThis.KtxSpecialParse(rows,date)});
    } catch (error) {reply({ok:false,error:error.message});}
  });
})();
