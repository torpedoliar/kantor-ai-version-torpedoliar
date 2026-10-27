// Health/readiness report real state, one DATA_DIR cannot be served twice, and a killed server's
// lock is detected as stale on the next start.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-health-')),A=43644,B=43645;
const env=port=>({...process.env,PORT:String(port),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,13).toString('base64')});
const start=port=>{const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:env(port),stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
  return {child,out:()=>out,ready:new Promise((resolve,reject)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve(child));child.on('exit',code=>reject(Error(`exit ${code}: ${out}`)));})};};
const stop=child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill('SIGTERM');setTimeout(resolve,5000).unref();});
(async()=>{let a,b,c;try{
  a=start(A);await a.ready;
  const health=await (await fetch(`http://127.0.0.1:${A}/api/health`)).json();
  assert.equal(health.ok,true);assert.equal(health.dataDirWritable,true);assert.equal(health.port,A);
  assert.ok(health.workspaceVersion>=0);assert.ok(health.models&&Number.isInteger(health.models.running));assert.ok(Array.isArray(health.recovery));
  const ready=await (await fetch(`http://127.0.0.1:${A}/api/ready`)).json();assert.equal(ready.ready,true);
  // A second server on the same data directory refuses to start and leaves the first running.
  b=start(B);b.ready.catch(()=>{});const exited=await new Promise(resolve=>b.child.once('exit',code=>resolve(code)));
  assert.equal(exited,1);assert.match(b.out(),/sedang dipakai|already used|another/i);
  assert.equal((await fetch(`http://127.0.0.1:${A}/api/health`)).status,200,'the first server is untouched');
  // A killed server leaves a lock that the next process recognises as stale.
  await stop(a.child);
  for(let i=0;i<20;i++){try{await fetch(`http://127.0.0.1:${A}/api/health`);await new Promise(r=>setTimeout(r,100));}catch{break;}}
  await fetch(`http://127.0.0.1:${A}/api/health`).then(()=>{throw Error('port should be closed');},()=>{});
  c=start(B);await c.ready;
  const again=await (await fetch(`http://127.0.0.1:${B}/api/health`)).json();
  assert.equal(again.ok,true);assert.ok(fs.existsSync(path.join(dir,'.lock')),'the new process owns the lock');
  console.log('PASS: health/readiness, single-instance data lock, and stale-lock recovery after shutdown');
}finally{for(const child of [a?.child,b?.child,c?.child])if(child)await stop(child);fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
