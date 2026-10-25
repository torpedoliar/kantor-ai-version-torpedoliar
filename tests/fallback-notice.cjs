// When the main model fails and a fallback is configured, the agent retries once on it and says so in the thread.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43681),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-fallback-'));
const seen=[];let releaseBackup,authMode=false;
const backupGate=new Promise(resolve=>{releaseBackup=resolve;});
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{const model=JSON.parse(raw||'{}').model;seen.push(model);
  if(model==='slow'){res.writeHead(authMode?401:500);return res.end('{}');}
  await backupGate;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Draf dari model cadangan.'}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,2).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  const put=await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'slow',source:'manual',status:'verified',enabled:true},{id:'backup',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'slow'},fallbackRoute:{providerId:'mock',modelId:'backup'},overrides:{}});assert.equal(put.status,200);
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const task=(await call('POST','/api/tasks',{title:'Caption',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Caption satu kalimat'})).body;
  await wait(()=>seen.includes('backup'),'fallback started');
  const early=(await call('GET',`/api/tasks/${task.id}/thread`)).body.messages;
  assert.ok(early.some(m=>/dicoba dengan model backup/.test(m.text)),'switch is announced before fallback finishes');releaseBackup();
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===task.id).status==='review','fallback produced a draft');
  assert.deepEqual(seen.slice(0,2),['slow','backup'],'main first, then the fallback once');
  const msgs=(await call('GET',`/api/tasks/${task.id}/thread`)).body.messages;
  const note=msgs.find(m=>m.sender.type==='system'&&/dicoba dengan model backup/.test(m.text));assert.ok(note,'thread says the model was switched');assert.match(note.text,/slow/);
  const done=(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);assert.equal(done.usedFallback,true);assert.equal(done.modelId,'backup');
  // An auth error is a configuration problem the owner must see, not something a backup model should hide.
  seen.length=0;authMode=true;
  const t2=(await call('POST','/api/tasks',{title:'Caption dua',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Caption kedua satu kalimat'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===t2.id).error,'auth failure surfaces');
  assert.deepEqual(seen,['slow'],'no fallback call on an auth error');
  console.log('PASS: main model error retries once on the configured fallback and notes the switch in the thread');
 }finally{releaseBackup();child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
