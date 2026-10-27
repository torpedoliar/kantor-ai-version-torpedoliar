#!/usr/bin/env node
// Open the browser only after /api/ready answers, using PORT from .env when present.
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
try{process.loadEnvFile(path.join(root,'.env'));}catch{/* defaults below */}
const port=Number(process.env.PORT)||3000,url=`http://127.0.0.1:${port}/`,deadline=Date.now()+30000;
while(Date.now()<deadline){
  try{
    const response=await fetch(`${url}api/ready`,{signal:AbortSignal.timeout(1200)});
    if(response.ok){
      const child=process.platform==='win32'
        ?spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore'})
        :spawn(process.platform==='darwin'?'open':'xdg-open',[url],{detached:true,stdio:'ignore'});
      child.unref();process.exit(0);
    }
  }catch{/* server not listening yet */}
  await new Promise(resolve=>setTimeout(resolve,300));
}
console.error(`Kantor Kita belum siap dalam 30 detik; buka ${url} manual.`);
process.exitCode=1;
