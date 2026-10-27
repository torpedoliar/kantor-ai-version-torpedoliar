// Polling uses a summary payload; only the task on screen is returned in full, so drafts, history
// and conversations do not travel on every 2.5 s poll. A single-task GET still returns everything.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=43647,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-summary-')),origin=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,15).toString('base64')},stdio:['ignore','pipe','ignore']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
(async()=>{await ready;try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const parent=(await call('POST','/api/tasks',{title:'Brief besar',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'manual',brief:`P`.repeat(5000)})).body;
  const child=(await call('POST','/api/tasks',{title:'Anak besar',assignee:'Bagas Pratama Putra',division:'engineering',parentId:parent.id,asLead:false,brief:`C`.repeat(5000)})).body;
  const done=await call('PATCH',`/api/tasks/${child.id}`,{status:'done',result:`R`.repeat(3000),version:child.version});assert.equal(done.status,200);
  const review=(await call('GET','/api/tasks')).body.find(t=>t.id===parent.id);assert.equal(review.status,'review');
  const full=(await call('GET','/api/tasks')).body;
  const summary=(await call('GET',`/api/tasks?summary=1&full=${parent.id}`)).body;
  const shown=summary.find(t=>t.id===parent.id),other=summary.find(t=>t.id===child.id);
  assert.equal(shown.brief.length,5000,'the task on screen is full');
  assert.ok(shown.result.length>0);
  for(const key of ['brief','result','history','messages','questions','acceptance','managerAdvice','feedback'])assert.equal(Object.hasOwn(other,key),false,`${key} is not sent for a non-selected task`);
  assert.equal(other.briefExcerpt.length,400);assert.ok(other.resultExcerpt.length<=400);
  assert.ok(JSON.stringify(summary).length<JSON.stringify(full).length*.6,'the polling payload is much smaller');
  const single=(await call('GET',`/api/tasks/${child.id}`)).body;
  assert.equal(single.brief.length,5000);assert.equal(single.result.length,3000);
  assert.equal((await call('GET','/api/tasks/00000000-0000-4000-8000-000000000000')).status,404);
  console.log('PASS: summary polling keeps drafts out, returns the selected task in full, and keeps single-task reads');
}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
