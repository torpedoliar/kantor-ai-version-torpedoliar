// Sequential tests: browser files share GPU resources; each file gets its own free TEST_PORT and
// static host. A timeout kills the whole process tree, so no test server keeps its port.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),{spawn,execFile}=require('node:child_process');
const root=path.join(__dirname,'..'),mode=process.argv[2]||'all',logs=path.join(root,'.superpowers','suite-logs');fs.mkdirSync(logs,{recursive:true});
if(!['all','unit','ui','docker'].includes(mode)){console.error(`Unknown mode "${mode}". Use all, unit, ui or docker.`);process.exit(1);}
const EXCLUDED=new Set(['run-suite.cjs','playwright-install.cjs','browser.cjs']);
const all=fs.readdirSync(__dirname).filter(file=>file.endsWith('.cjs')&&!EXCLUDED.has(file));
// Browser tests are detected from their import, not from a hand-maintained list that drifts.
const ui=new Set(all.filter(file=>fs.readFileSync(path.join(__dirname,file),'utf8').includes('browser.cjs')).map(file=>file.slice(0,-4)));
const files=all.filter(file=>mode==='docker'?file.startsWith('project-docker'):mode==='unit'?!ui.has(file.slice(0,-4))&&!file.startsWith('project-docker-live'):mode==='ui'?ui.has(file.slice(0,-4)):file!=='project-docker-live.cjs').sort();
if(!files.length){console.error(`No test files matched mode "${mode}".`);process.exit(1);}
if(mode==='ui'||mode==='all'){
  try{require.resolve(process.env.PLAYWRIGHT_MODULE||'playwright');}
  catch{console.error('Playwright is not installed. Run npm install first, or set PLAYWRIGHT_MODULE to an existing install.');process.exit(1);}
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.glb':'model/gltf-binary','.hdr':'application/octet-stream','.bin':'application/octet-stream'};
const host=http.createServer((req,res)=>{let rel;try{rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}const file=path.resolve(root,'public','.'+(rel==='/'?'/index.html':rel));if(!file.startsWith(path.resolve(root,'public')+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();}else{res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(data);}});});
const timeoutMs=Math.max(1000,Number(process.env.TEST_TIMEOUT_MS)||900000);
const freePort=()=>new Promise((resolve,reject)=>{const probe=net.createServer();probe.unref();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
const killTree=child=>new Promise(resolve=>{
  if(!child||child.exitCode!==null)return resolve();
  if(process.platform==='win32')return execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve());
  try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}
  resolve();
});
(async()=>{await new Promise(r=>host.listen(0,'127.0.0.1',r));let failed=0;let timedOut=[];
try{for(const file of files){
  const log=fs.createWriteStream(path.join(logs,file+'.log'));const start=Date.now(),testPort=await freePort();
  const code=await new Promise(resolve=>{
    let settled=false;
    const done=code=>{if(settled)return;settled=true;resolve(code);};
    const child=spawn(process.execPath,[path.join(__dirname,file)],{cwd:root,env:{...process.env,OFFICE_URL:`http://127.0.0.1:${host.address().port}/`,TEST_PORT:String(testPort)},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    const timer=setTimeout(async()=>{log.write(`\n[timeout after ${timeoutMs} ms] killing ${file} process tree\n`);timedOut.push(file);await killTree(child);setTimeout(()=>done(124),5000).unref();},timeoutMs);
    child.on('error',error=>{log.write(error.stack);});
    child.on('close',code=>{clearTimeout(timer);log.end();done(code??1);});
  });
  console.log(`${code===0?'PASS':code===124?'TIMEOUT':'FAIL'} ${file} (${Math.round((Date.now()-start)/1000)}s) log: .superpowers/suite-logs/${file}.log`);
  if(code!==0)failed++;
}
console.log(`${files.length-failed}/${files.length} files passed; ${failed} failed${timedOut.length?` (timeout: ${timedOut.join(', ')})`:''}`);
process.exitCode=failed?1:0;
}finally{host.close();}})().catch(e=>{console.error(e);process.exitCode=1;host.close();});
