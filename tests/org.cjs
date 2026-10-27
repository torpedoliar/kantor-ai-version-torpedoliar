const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.TEST_PORT||43191),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-org-'));
const origin=`http://127.0.0.1:${PORT}`;
const start=()=>{
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'10'},stdio:['ignore','pipe','inherit']});
  return new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve(child);}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
};
const request=async(pathname,options={})=>{const response=await fetch(origin+pathname,options);return {status:response.status,body:await response.json().catch(()=>null)};};
const headers=(csrf,token)=>({'content-type':'application/json','origin':origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})});
(async()=>{
  let child=await start();
  try{
    const session=await request('/api/session');assert.equal(session.status,200);const csrf=session.body.csrf;
    assert.equal((await request('/api/org')).status,403,'org reads require a local session');
    const initial=await request('/api/org',{headers:headers(csrf)});assert.equal(initial.status,200);
    assert.deepEqual(initial.body.divisions.map(d=>d.id),['leadership','marketing','engineering','service']);
    assert.equal(initial.body.divisions.find(d=>d.id==='leadership').lead,'Koh Arman');
    assert.equal(initial.body.divisions.find(d=>d.id==='marketing').lead,'Kak Rani');
    assert.equal(initial.body.divisions.find(d=>d.id==='engineering').lead,'Koh Wira');
    assert.equal(initial.body.divisions.find(d=>d.id==='service').lead,'Gilang');
    assert.deepEqual(initial.body.members.find(m=>m.name==='Koh Wira').divisions,['engineering'],'v2 keeps one primary division');assert.equal(initial.body.members.find(m=>m.name==='Koh Wira').manager,'Koh Arman');
    assert.equal(initial.body.members.find(m=>m.name==='Koh Wira').effort,'standard');
    assert.equal(initial.body.members.find(m=>m.name==='Koh Wira').workloadPct,100);
    assert.equal(JSON.stringify(initial.body).includes('pinHash'),false);
    const denied=await request('/api/org',{method:'PUT',headers:headers(csrf),body:JSON.stringify({version:initial.body.version,divisions:initial.body.divisions,members:initial.body.members})});
    assert.equal(denied.status,403);assert.equal(denied.body.code,'ORG_LOCKED');assert.equal(JSON.stringify(denied.body).includes('hash'),false);
    const unlocked=await request('/api/org/unlock',{method:'POST',headers:headers(csrf),body:JSON.stringify({pin:'2468'})});
    assert.equal(unlocked.status,200);assert.equal(typeof unlocked.body.token,'string');assert.ok(unlocked.body.token.length>20);
    const changed=await request('/api/org',{method:'PUT',headers:headers(csrf,unlocked.body.token),body:JSON.stringify({version:initial.body.version,divisions:initial.body.divisions,members:initial.body.members.map(m=>m.name==='Tari'?{...m,role:'Content Intern',effort:'deep',workloadPct:75,instructions:'Own campaign QA.'}:m)})});
    assert.equal(changed.status,200);assert.equal(changed.body.members.find(m=>m.name==='Tari').role,'Content Intern');assert.equal(changed.body.members.find(m=>m.name==='Tari').effort,'deep');assert.equal(changed.body.members.find(m=>m.name==='Tari').workloadPct,75);assert.equal(changed.body.members.find(m=>m.name==='Tari').instructions,'Own campaign QA.');
    child.kill();await new Promise(resolve=>child.once('exit',resolve));child=await start();
    const session2=await request('/api/session');const csrf2=session2.body.csrf;
    const stale=await request('/api/org',{method:'PUT',headers:headers(csrf2,unlocked.body.token),body:JSON.stringify({version:changed.body.version,divisions:changed.body.divisions,members:changed.body.members})});
    assert.equal(stale.status,403,'unlock tokens expire on restart');
    const wrong=await request('/api/org/unlock',{method:'POST',headers:headers(csrf2),body:JSON.stringify({pin:'0000'})});assert.equal(wrong.status,403);
    const persisted=await request('/api/org',{headers:headers(csrf2)});assert.equal(persisted.body.members.find(m=>m.name==='Tari').role,'Content Intern');
    const right=await request('/api/org/unlock',{method:'POST',headers:headers(csrf2),body:JSON.stringify({pin:'2468'})});assert.equal(right.status,200);
    console.log('PASS: org seed, CSRF/PIN guard, unlock token, persistence and restart expiry');
  }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
