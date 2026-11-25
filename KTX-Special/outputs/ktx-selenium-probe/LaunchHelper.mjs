// Keep a failed connection helper available for a code fix, without repeated requests.
// Retry only when the helper source changes. Successful sessions keep running normally.
import {stat} from 'node:fs/promises';
const source=new URL('./ExistingProfileHelper.mjs',import.meta.url);
for(;;){
  const modified=(await stat(source)).mtimeMs;
  process.exitCode=0;
  try{await import(source.href+'?revision='+modified);}catch(error){console.error(error.message);process.exitCode=1;}
  if(!process.exitCode)break;
  console.log('연결 오류를 기록했습니다. 이 창을 열어 두세요. 도우미 코드가 수정되면 한 번 다시 연결합니다.');
  while((await stat(source)).mtimeMs===modified)await new Promise(resolve=>setTimeout(resolve,1000));
}
