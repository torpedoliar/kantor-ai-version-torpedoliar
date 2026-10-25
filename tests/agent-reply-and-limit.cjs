// (1) Model calls never exceed "Maks agen bersamaan", and the waiting calls still finish.
// (2) An owner message on a task waiting for review gets a real agent reply; the reviewed draft is not replaced.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43681),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-limit-'));
let inFlight=0,peak=0;const calls=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);calls.push(text);
  inFlight++;peak=Math.max(peak,inFlight);
  const content=/MODE: REPLY/.test(text)?'Hasil tugas ini berupa laporan teks; belum ada folder proyek yang dibuat.':'Draf hasil kerja.';
  setTimeout(()=>{inFlight--;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));},400);});});
const wait=async(fn,label,ms=40000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64'),PROVIDER_TIMEOUT_MS:'30000'},stdio:['ignore','pipe','pipe']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  assert.equal(s.concurrency,3,'default limit exposed');
  const saved=await call('PUT','/api/settings',{version:s.version,concurrency:2,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;const chosen=o.divisions.map(d=>o.members.find(m=>m.name===d.lead)).filter(Boolean),people=chosen.map(m=>m.name);assert.ok(chosen.length>=3,'need several division leads');
  await call('PUT','/api/org',{...o,members:o.members.map(m=>people.includes(m.name)?{...m,isAgent:true}:m)});
  const ids=[];for(const m of chosen){const r=await call('POST','/api/tasks',{title:'Tugas '+m.name,assignee:m.name,division:m.division,asLead:true,executionMode:'direct',brief:'Tulis satu paragraf'});assert.equal(r.status,201,JSON.stringify(r.body));ids.push(r.body.id);}
  await wait(async()=>{const all=(await call('GET','/api/tasks')).body;return ids.every(id=>all.find(t=>t.id===id).status==='review');},'all tasks finish under the limit');
  assert.ok(peak<=2,`never more than 2 model calls at once (peak ${peak})`);assert.ok(peak===2,'the limit is actually used');
  // (2) Ask a question on a task that is waiting for review.
  const task=ids[0],before=(await call('GET','/api/tasks')).body.find(t=>t.id===task);
  const sent=await call('POST',`/api/tasks/${task}/messages`,{text:'lokasi file project-nya di mana?'});assert.equal(sent.status,201);
  const reply=await wait(async()=>(await call('GET',`/api/tasks/${task}/thread`)).body.messages.find(m=>m.sender.type==='agent'&&m.kind==='reply'),'agent replies on a review task');
  assert.match(reply.text,/laporan teks|folder/);
  const after=(await call('GET','/api/tasks')).body.find(t=>t.id===task);
  assert.equal(after.status,'review','still waiting for the owner review');assert.equal(after.result,before.result,'reviewed draft untouched');
  assert.ok(calls.some(c=>/MODE: REPLY/.test(c)&&/lokasi file/.test(c)),'the agent saw the question');
  console.log(`PASS: model calls capped at the configured limit (peak ${peak}), agents reply to messages on review tasks without changing the draft`);
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
