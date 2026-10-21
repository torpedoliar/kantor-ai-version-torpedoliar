// Agents talk back: an acknowledgement when they pick work up, a lead delegates by default, a chat message
// "lanjutkan" retries a failed task, and a slow provider is given enough time.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43671),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-agent-talk-'));
let failNext=0,slowMs=0;const calls=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);calls.push(text);
  if(failNext>0){failNext--;res.writeHead(503);return res.end('{}');}
  let content='Draf hasil kerja.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:[],acceptance:['Hasil jelas'],children:[{key:'a',title:'Susun copy',brief:'Draf copy',assignee:'Kak Dewi'}]});
  else if(/MODE: SYNTHESIZE/.test(text))content='Ringkasan tim siap direview.';
  setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));},slowMs);});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,3).toString('base64'),PROVIDER_TIMEOUT_MS:'3000'},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;await call('PUT','/api/org',{...o,members:o.members.map(m=>['Kak Rani','Kak Dewi'].includes(m.name)?{...m,isAgent:true}:m)});
  const thread=async id=>(await call('GET',`/api/tasks/${id}/thread`)).body.messages;
  // 1) A task given to a lead (asLead, no mode chosen) is delegated by default, and the lead acknowledges it.
  const lead=(await call('POST','/api/tasks',{title:'Kampanye launch',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'Kampanye Instagram minggu depan'})).body;
  assert.equal(lead.executionMode,'automatic','a lead task is delegated by default');
  await wait(async()=>(await call('GET','/api/tasks')).body.some(t=>t.parentId===lead.id),'lead delegated to the team');
  const leadMsgs=await thread(lead.id);
  const ack=leadMsgs.find(m=>m.sender.type==='agent'&&m.kind==='ack');assert.ok(ack,'lead acknowledges before planning');assert.match(ack.text,/mengerti|terima|segera/i);
  // The child worker also acknowledges, and the lead reviews: the root reaches Review via synthesis.
  const kid=(await call('GET','/api/tasks')).body.find(t=>t.parentId===lead.id);
  await wait(async()=>(await thread(kid.id)).some(m=>m.kind==='ack'&&m.sender.name==='Kak Dewi'),'worker acknowledges');
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===lead.id).status==='review','lead synthesis reaches review',40000);
  assert.ok(calls.some(c=>/MODE: SYNTHESIZE/.test(c)),'lead reviewed the team result');
  // The owner can still choose direct work explicitly.
  const direct=(await call('POST','/api/tasks',{title:'Catatan singkat',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Tulis catatan singkat'})).body;
  assert.equal(direct.executionMode,'direct');
  // 2) A failed task resumes when the owner says so in the chat — "lanjutkan", "coba lagi".
  failNext=3;const soloRes=await call('POST','/api/tasks',{title:'Caption cepat',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Caption satu kalimat'});assert.equal(soloRes.status,201,JSON.stringify(soloRes.body));const solo=soloRes.body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===solo.id).error,'task fails');
  failNext=0;const retry=await call('POST',`/api/tasks/${solo.id}/messages`,{text:'lanjutkan ya'});assert.equal(retry.status,201);assert.equal(retry.body.retried,true);
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===solo.id).status==='review','chat retry resumed the failed task');
  // 3) Provider timeout comes from configuration (slow models like *-xhigh need more than the old 120s).
  slowMs=1500;const slow=(await call('POST','/api/tasks',{title:'Analisis lambat',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Analisis panjang'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===slow.id).status==='review','slow model within configured timeout');
  console.log('PASS: lead delegates and reviews by default, agents acknowledge, chat "lanjutkan" retries, configurable provider timeout');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
