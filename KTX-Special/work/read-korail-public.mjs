import {writeFile} from 'node:fs/promises';
try {
  const response=await fetch('https://www.korail.com/ticket/search/general',{signal:AbortSignal.timeout(20000)});
  const body=await response.text();
  await writeFile(new URL('./korail-public.html',import.meta.url),body);
  console.log(JSON.stringify({status:response.status,url:response.url,bytes:Buffer.byteLength(body),scripts:[...body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>m[1])}));
} catch(error) { console.log(JSON.stringify({error:error.name,code:error.cause?.code,message:error.cause?.message||error.message}));process.exitCode=1; }
