// Automatic retry with backoff (audit R1): transient provider trouble (quota/unavailable/
// connection/timeout) retries itself on a schedule instead of parking until the owner returns.
// Configuration errors (auth) never auto-retry; after the last attempt the task parks with an alert.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.TEST_PORT||43543),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-retry-')),origin=`http://127.0.0.1:${PORT}`;
let failWith=0; // 0 = healthy; a status code makes the mock fail with it
const mock=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
  if(failWith){res.writeHead(failWith,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'mock outage '+failWith}}));}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'DRAF SIAP.'}}]}));
});});
const wait=async(fn,label,ms=20000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const env={...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,3).toString('base64'),KANTOR_RETRY_DELAYS_MS:'250,500,900'};
  const child=()=>spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env,stdio:['ignore','pipe','inherit']});
  let server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
    const settings=(await call('GET','/api/settings')).body;
    const provider={id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'};
    assert.equal((await call('PUT','/api/settings',{version:settings.version,providers:[provider],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}})).status,200);
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    const taskOf=id=>call('GET','/api/tasks').then(r=>r.body.find(t=>t.id===id));
    // 1. One quota blip: the task retries itself and reaches review without the owner.
    failWith=429;
    const t1=(await call('POST','/api/tasks',{title:'Caption promo',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Ramah dan singkat untuk Instagram, promo akhir pekan.'},owner)).body;
    await wait(async()=>(await taskOf(t1.id)).retryAt!==undefined,'retry scheduled');
    const during=await taskOf(t1.id);
    assert.equal(during.status,'queued');assert.equal(during.autoAttempts,1);assert.ok(during.retryAt>Date.now()-1000,'backoff armed');
    const comms=await call('GET','/api/communications?after=0',{},owner);
    assert.ok(!comms.body.alerts.some(a=>a.taskId===t1.id),'no alert while an auto-retry owns the failure');
    failWith=0;
    const fixed=await wait(async()=>{const t=await taskOf(t1.id);return t.status==='review'?t:null;},'auto-retry reaches review',30000);
    assert.match(fixed.result,/DRAF SIAP/);
    const events=(await call('GET','/api/task-events?after=0',{},owner)).body.events.filter(e=>e.taskId===t1.id).map(e=>e.type);
    assert.ok(events.includes('task.retry_scheduled')&&events.includes('task.retry'),'retry is visible in the audit trail');
    const messages=(await call('GET','/api/communications?after=0',{},owner)).body.messages.filter(m=>m.taskId===t1.id);
    assert.ok(messages.some(m=>m.text.includes('1/3')),'each attempt is announced in the thread');
    // 2. A provider that stays down: exactly three automatic attempts, then a parked task with an alert.
    failWith=503;
    const t2=(await call('POST','/api/tasks',{title:'Ringkasan stok',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Ringkasan stok gudang minggu ini untuk owner.'},owner)).body;
    const parked=await wait(async()=>{const t=await taskOf(t2.id);return t.error&&t.status==='queued'&&!t.retryAt?t:null;},'final park after three attempts',30000);
    assert.equal(parked.autoAttempts,3,'three automatic attempts, no more');
    const comms2=await call('GET','/api/communications?after=0',{},owner);
    assert.ok(comms2.body.alerts.some(a=>a.taskId===t2.id),'the parked task raises an owner alert');
    const msgs2=(await call('GET','/api/communications?after=0',{},owner)).body.messages.filter(m=>m.taskId===t2.id);
    assert.equal(msgs2.filter(m=>m.text.includes('/3')).length,4,'first-failure plan + 3 start notes, then it stops');
    failWith=0;
    // 3. Configuration errors never auto-retry: an auth failure parks immediately.
    failWith=401;
    const t3=(await call('POST','/api/tasks',{title:'Balasan VIP',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Balasan pelanggan VIP tentang pengiriman prioritas.'},owner)).body;
    const authPark=await wait(async()=>{const t=await taskOf(t3.id);return t.error&&!t.retryAt?t:null;},'auth parks immediately');
    assert.equal(authPark.autoAttempts,undefined);
    failWith=0;
    // 4. A pending retry survives a restart: past-due is released without any API call.
    failWith=429;
    const t4=(await call('POST','/api/tasks',{title:'Laporan harian',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Laporan penjualan harian untuk owner.'},owner)).body;
    await wait(async()=>(await taskOf(t4.id)).retryAt!==undefined,'retry armed for restart test');
    server.kill();await new Promise(r=>setTimeout(r,300));
    failWith=0;
    server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
    const booted=await wait(async()=>{const t=await taskOf(t4.id);return t.status==='review'?t:null;},'restart releases the past-due retry',30000);
    assert.match(booted.result,/DRAF SIAP/);
    console.log('PASS: transient auto-retry with backoff, alerts, audit trail, auth never retried, restart pickup');
  }finally{server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
