// Privileged tasks (children, review, manager-review) demand the owner unlock for every write form,
// and a draft at a review gate cannot be laundered into done through a generic PATCH.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=43555,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-auth-')),origin=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,8).toString('base64')},stdio:['ignore','pipe','inherit']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
(async()=>{await ready;try{
  const session=await (await fetch(origin+'/api/session')).json(),plain={'content-type':'application/json',origin,'x-kantor-csrf':session.csrf};
  const call=async(method,p,body,headers=plain)=>{const r=await fetch(origin+p,{method,headers,body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const unlocked=await call('POST','/api/org/unlock',{pin:'2468'}),owner={...plain,'x-kantor-org':unlocked.body.token};
  const parent=(await call('POST','/api/tasks',{title:'Parent',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'manual',brief:'Parent brief.'},plain)).body;
  const child=(await call('POST','/api/tasks',{title:'Child',assignee:'Bagas Pratama Putra',division:'engineering',parentId:parent.id,asLead:false,brief:'Child brief.'},owner)).body;
  assert.ok(child.id,'child created with the owner unlock');
  // Every write form on a child task is owner-only, including the answer and progress paths that
  // used to run before the token check.
  for(const [label,body] of [['answer',{action:'answer',answer:'x',version:child.version}],['progress',{progressPct:10,version:child.version}],['message',{message:{text:'hi'},version:child.version}],['status',{status:'done',result:'Forged.',version:child.version}]]){
    const denied=await call('PATCH',`/api/tasks/${child.id}`,body,plain);
    assert.equal(denied.status,403,`${label} without the unlock is refused`);
    assert.equal(denied.body.code,'ORG_LOCKED',`${label} reports ORG_LOCKED`);
  }
  const progress=await call('PATCH',`/api/tasks/${child.id}`,{progressPct:10,version:child.version},owner);
  assert.equal(progress.status,200,'the unlock still allows ordinary child edits');
  const done=await call('PATCH',`/api/tasks/${child.id}`,{status:'done',result:'Child complete.',version:progress.body.version},owner);
  assert.equal(done.status,200,'the unlock can close a child');
  const review=(await call('GET','/api/tasks')).body.find(t=>t.id===parent.id);
  assert.equal(review.status,'review','closing every child promotes the parent to review');
  // A generic PATCH cannot reassign or close a draft at the gate; only approve/revise/manager-* may.
  for(const [label,body] of [['reassign',{assignee:'Kak Laras',version:review.version}],['reassign+done',{assignee:'Kak Laras',status:'done',result:'Forged.',version:review.version}],['done',{status:'done',result:'Forged.',version:review.version}]]){
    const denied=await call('PATCH',`/api/tasks/${parent.id}`,body,owner);
    assert.equal(denied.status,409,`${label} on a review draft is refused`);
    assert.equal(denied.body.code,'REVIEW_REQUIRED',`${label} reports REVIEW_REQUIRED`);
  }
  const still=(await call('GET','/api/tasks')).body.find(t=>t.id===parent.id);
  assert.equal(still.status,'review','the draft is untouched after refused edits');
  assert.equal(still.assignee,'Koh Wira');
  const approved=await call('PATCH',`/api/tasks/${parent.id}`,{action:'approve',version:still.version},owner);
  assert.equal(approved.status,200);
  assert.equal(approved.body.status,'done');
  assert.match(approved.body.result,/Child complete\./,'the real child result survives, not a forged one');
  console.log('PASS: every PATCH form on a privileged task needs the owner unlock, and review drafts only close through approve/revise');
}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
