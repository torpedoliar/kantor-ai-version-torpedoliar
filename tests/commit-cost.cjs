// One owner action = one durable workspace write. Approving a draft used to save the cache,
// run the transaction and save again; the promotion and remembered notes now commit together.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=43646,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-commit-cost-')),origin=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,14).toString('base64')},stdio:['ignore','pipe','ignore']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
const wait=async(fn,label,ms=15000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,80));}};
(async()=>{await ready;try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const parent=(await call('POST','/api/tasks',{title:'Parent',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'manual',brief:'Parent brief.'})).body;
  const child=(await call('POST','/api/tasks',{title:'Child',assignee:'Bagas Pratama Putra',division:'engineering',parentId:parent.id,asLead:false,brief:'Child brief.'})).body;
  const progress=await call('PATCH',`/api/tasks/${child.id}`,{progressPct:10,version:child.version});assert.equal(progress.status,200);
  const done=await call('PATCH',`/api/tasks/${child.id}`,{status:'done',result:'Child complete.',version:progress.body.version});assert.equal(done.status,200);
  const review=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===parent.id);return t&&t.status==='review'&&t;},'parent review');
  // Let any queued kick/worker settle, then take a stable baseline.
  let baseline;for(let i=0;i<20;i++){const a=(await call('GET','/api/health')).body;await new Promise(r=>setTimeout(r,120));const b=(await call('GET','/api/health')).body;if(a.workspaceWrites===b.workspaceWrites&&a.workspaceVersion===b.workspaceVersion){baseline=b;break;}}
  assert.ok(baseline&&Number.isInteger(baseline.workspaceWrites),'health reports workspace write count');
  const approved=await call('PATCH',`/api/tasks/${parent.id}`,{action:'approve',version:review.version});
  assert.equal(approved.status,200);assert.equal(approved.body.status,'done');
  const after=(await call('GET','/api/health')).body;
  assert.equal(after.workspaceWrites-baseline.workspaceWrites,1,`one approve writes once (${baseline.workspaceWrites} → ${after.workspaceWrites})`);
  assert.equal(after.workspaceVersion-baseline.workspaceVersion,1,'one version bump');
  const final=(await call('GET','/api/tasks')).body.find(x=>x.id===parent.id);
  assert.match(final.result,/Child complete\./,'the promotion keeps the child result');
  console.log('PASS: approving a draft commits its promotion and memory in one workspace write');
}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
