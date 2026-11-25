import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const runtime=new URL('../../outputs/ktx-selenium-probe/.runtime/',import.meta.url);
const command=JSON.parse(await readFile(new URL('./next-command.json',import.meta.url),'utf8'));
command.id=randomUUID();
await writeFile(new URL('command.next',runtime),JSON.stringify(command));
await rename(new URL('command.next',runtime),new URL('command.json',runtime));
const deadline=Date.now()+15000;
while(Date.now()<deadline){
  try{const r=JSON.parse(await readFile(new URL('result.json',runtime),'utf8'));if(r.id===command.id){console.log(JSON.stringify(r));process.exit(r.ok?0:1);}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
}
console.log('Command pending; do not repeat before checking helper state.');process.exitCode=2;
