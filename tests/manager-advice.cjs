// Manager advice (port dari orchestrator-patterns): an AI manager reads every staff draft at
// the manager-review gate and recommends approve/revise — never deciding. Owner-only retry,
// failure parking, and the restart pickup are covered. The draft agent and the manager share
// one mock provider; advice requests are told apart by their review prompt.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.TEST_PORT||43533),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-advice-')),origin=`http://127.0.0.1:${PORT}`;
let adviceText='Fakta sudah cocok dengan brief; nada dan kelengkapan oke.\nVERDICT: approve',failAdvice=0;
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw||'{}'),isAdvice=JSON.stringify(body.messages||[]).includes('Review this draft');
  if(isAdvice&&failAdvice>0){failAdvice--;res.writeHead(500,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'mock advice outage'}}));}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:isAdvice?adviceText:'DRAF STAF: konten siap ditinjau atasan.'}}]}));
});});
const wait=async(fn,label,ms=15000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const child=()=>spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,9).toString('base64')},stdio:['ignore','pipe','inherit']});
  let server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
    const settings=(await call('GET','/api/settings')).body;
    const provider={id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'mock-model',source:'manual',status:'verified',enabled:true}],credential:'k'};
    assert.equal((await call('PUT','/api/settings',{version:settings.version,providers:[provider],defaultRoute:{providerId:'mock',modelId:'mock-model'},fallbackRoute:null,overrides:{}})).status,200);
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    // Root tasks go to division leads, so give the marketing lead a manager below the top:
    // Kak Rani (agent) reports to Kak Dewi (agent); Dewi reports to the top to keep the graph acyclic.
    const orgState=(await call('GET','/api/org')).body;
    const rani=orgState.members.find(m=>m.name==='Kak Rani'),dewi=orgState.members.find(m=>m.name==='Kak Dewi');
    rani.isAgent=true;rani.model='mock-model';rani.manager='Kak Dewi';
    dewi.isAgent=true;dewi.model='mock-model';dewi.manager='Koh Arman';
    assert.equal((await call('PUT','/api/org',orgState,owner)).status,200);
    // 1. A staff draft lands at the gate and the manager recommends approving it.
    const task=(await call('POST','/api/tasks',{title:'Caption menu baru',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Ramah dan singkat untuk Instagram, menu es kopi, rilis Jumat.'},owner)).body;
    const advised=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);return t.status==='manager-review'&&t.managerAdvice?t:null;},'advice lands');
    assert.equal(advised.managerAdvice.verdict,'approve');assert.equal(advised.managerAdvice.by,'mock-model');
    const events=(await call('GET','/api/task-events?after=0',{},owner)).body.events;
    assert.ok(events.some(e=>e.type==='manager.advice'&&e.taskId===task.id&&e.data.verdict==='approve'),'advice is a task event');
    const comms=(await call('GET','/api/communications?after=0',{},owner)).body;
    assert.ok(comms.messages.some(m=>m.taskId===task.id&&m.sender.name==='Kak Dewi'),'advice reaches the thread');
    // The advice is a recommendation; the owner still presses the button.
    assert.equal((await call('PATCH',`/api/tasks/${task.id}`,{action:'manager-approve',version:advised.version},owner)).status,200);
    assert.equal((await call('GET','/api/tasks')).body.find(t=>t.id===task.id).status,'review');
    // 2. A missing VERDICT line falls back to revise; failure parks an error and retry recovers.
    adviceText='Secara umum masih kurang data.';
    const t2=(await call('POST','/api/tasks',{title:'Jawaban pelanggan',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Pesanan 1042 telat dua hari, pelanggan kecewa.'},owner)).body;
    const gate2=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t2.id);return t.status==='manager-review'?t:null;},'second draft at the gate');
    const noVerdict=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t2.id);return t.managerAdvice?t:null;},'fallback advice');
    assert.equal(noVerdict.managerAdvice.verdict,'revise','no VERDICT line means revise, never a guess');
    adviceText='Perlu angka faktur.\nVERDICT: revise';failAdvice=1;
    const t3=(await call('POST','/api/tasks',{title:'Caption kampanye',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Kampanye akhir tahun untuk pelanggan setia.'},owner)).body;
    const failed=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t3.id);return t.status==='manager-review'&&t.adviceError?t:null;},'advice failure parked');
    assert.ok(failed.adviceError,'advice failure is parked on the task');
    assert.equal((await call('PATCH',`/api/tasks/${t3.id}`,{action:'retry-advice',version:failed.version},owner)).status,200);
    const retried=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t3.id);return t.managerAdvice?t:null;},'retry advice');
    assert.equal(retried.managerAdvice.verdict,'revise');
    assert.equal((await call('PATCH',`/api/tasks/${t3.id}`,{action:'retry-advice',version:retried.version},owner)).status,409,'cannot retry once advised');
    // 3. A manager without an agent never advises; the retry says why. Root tasks need a lead, so the same
    //    lead now reports to Koh Wira (not an agent).
    let org2=(await call('GET','/api/org')).body;org2.members.find(m=>m.name==='Kak Rani').manager='Koh Wira';
    assert.equal((await call('PUT','/api/org',org2,owner)).status,200);
    const made4=await call('POST','/api/tasks',{title:'Balasan reseller',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Reseller menanyakan stok produk favorit.'},owner);if(made4.status!==201)throw Error('t4 create failed: '+made4.status+' '+JSON.stringify(made4.body));const t4=made4.body;
    const gate4=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t4.id);return t.status==='manager-review'?t:null;},'manual-manager gate');
    await new Promise(r=>setTimeout(r,1200));
    assert.equal((await call('GET','/api/tasks')).body.find(t=>t.id===t4.id).managerAdvice,undefined);
    assert.equal((await call('PATCH',`/api/tasks/${t4.id}`,{action:'retry-advice',version:gate4.version},owner)).status,400,'manager is not connected to an AI agent');
    // 4. Restart pickup: a failed review is retried after reboot without any API call.
    const org3=(await call('GET','/api/org')).body;org3.members.find(m=>m.name==='Kak Rani').manager='Kak Dewi';
    assert.equal((await call('PUT','/api/org',org3,owner)).status,200);
    failAdvice=1;adviceText='Oke setelah diperiksa ulang.\nVERDICT: approve';
    const t5=(await call('POST','/api/tasks',{title:'Ringkasan mingguan',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Ringkasan performa minggu ini untuk owner.'},owner)).body;
    await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t5.id);return t.status==='manager-review'&&t.adviceError?t:null;},'failed advice persisted').catch(async e=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t5.id);const ev=(await call('GET','/api/task-events?after=0',{},owner)).body.events.filter(e=>e.taskId===t5.id).map(e=>e.type+(e.data&&e.data.purpose?':'+e.data.purpose:''));throw Error(e.message+' t5='+JSON.stringify({status:t&&t.status,adviceError:t&&t.adviceError,advised:!!(t&&t.managerAdvice),events:ev}));});
    server.kill();await new Promise(r=>setTimeout(r,300));
    server=child();
    await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
    const booted=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===t5.id);return t.managerAdvice?t:null;},'boot retries advice');
    assert.equal(booted.managerAdvice.verdict,'approve');
    console.log('PASS: manager advice with verdict, thread message, event, fallback, retry, manual manager, restart pickup');
  }finally{server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
