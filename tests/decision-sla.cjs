// Decision SLA (audit R2): an owner decision that sits too long is nudged once in the thread,
// then the top member (when it is an agent) posts a labelled recommendation. The owner still decides.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.TEST_PORT||43545),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-decision-sla-')),origin=`http://127.0.0.1:${PORT}`;
let reply='QUESTIONS:\n1. Siapa audiens utama konten ini?';
const mock=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:reply}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,150));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const env={...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,6).toString('base64'),KANTOR_DECISION_SLA_MS:'3000'};
  const child=()=>spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env,stdio:['ignore','pipe','inherit']});
  let server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
    const settings=(await call('GET','/api/settings')).body;
    const provider={id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'};
    assert.equal((await call('PUT','/api/settings',{version:settings.version,providers:[provider],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}})).status,200);
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    // The agent asks instead of guessing; the decision targets the owner and the task blocks.
    const task=(await call('POST','/api/tasks',{title:'Konten peluncuran',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Konten untuk peluncuran produk baru.'},owner)).body;
    await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);return t.status==='blocked'&&t.blockedReason==='decision'?t:null;},'decision opened');
    // 1. Nudge once after the SLA; while the top member is human, nothing more happens.
    const nudged=await wait(async()=>{const c=(await call('GET','/api/communications?after=0',{},owner)).body;return c.messages.find(m=>m.taskId===task.id&&m.sender.name==='Sistem'&&m.text.includes('menahan tugas'))||null;},'nudge lands');
    assert.ok(nudged,'reminder posted in the thread');
    await new Promise(r=>setTimeout(r,6000));
    let comms=(await call('GET','/api/communications?after=0',{},owner)).body;
    assert.equal(comms.messages.filter(m=>m.taskId===task.id&&m.sender.name==='Sistem'&&m.text.includes('menahan tugas')).length,1,'nudge happens exactly once');
    assert.ok(!comms.messages.some(m=>m.taskId===task.id&&m.text.includes('Saran jawaban')),'no recommendation from a human top member');
    // 2. Make the top member (Koh Arman) an agent: past 2×SLA it posts a labelled recommendation.
    const orgState=(await call('GET','/api/org')).body;
    const top=orgState.members.find(m=>m.name==='Koh Arman');
    top.isAgent=true;top.model='m';
    const putTop=await call('PUT','/api/org',orgState,owner);if(putTop.status!==200)throw Error('org PUT for top agent failed: '+putTop.status+' '+JSON.stringify(putTop.body));
    reply='Audiens utamanya adalah pelanggan setia yang sudah pernah membeli.';
    const advice=await wait(async()=>{const c=(await call('GET','/api/communications?after=0',{},owner)).body;return c.messages.find(m=>m.taskId===task.id&&m.sender.name==='Koh Arman')||null;},'top member recommendation');
    assert.ok(advice.text.includes('Saran jawaban'),'clearly labelled as a recommendation');
    assert.match(advice.text,/pelanggan setia/);
    const after=(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);
    assert.equal(after.status,'blocked','the owner still has not decided: the task stays blocked');
    const events=(await call('GET','/api/task-events?after=0',{},owner)).body.events.map(e=>e.type);
    assert.ok(events.includes('decision.nudged')&&events.includes('decision.recommended'),'SLA steps are audited');
    // 3. The owner answers: the pipeline moves again.
    reply='DRAF SELESAI.';
    const decision=(await call('GET','/api/communications?after=0',{},owner)).body.decisions.find(d=>d.taskId===task.id&&d.status==='open');
    assert.equal((await call('POST',`/api/decisions/${decision.id}/answer`,{answer:'Pelanggan setia.',version:decision.version},owner)).status,200);
    await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);return ['review','manager-review'].includes(t.status)?t:null;},'task resumes after the answer');
    console.log('PASS: decision nudge once, agent-top recommendation labelled, owner still decides, resume after answer');
  }finally{server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
