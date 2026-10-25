// The owner answers while the lead is still thinking: the lead's late reply (answer or escalation) must not reopen,
// re-answer or retarget the already-answered decision.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43751),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-lead-race-'));
let leadReply='ESCALATE: owner yang tahu',releaseLead;const leadGate=new Promise(r=>{releaseLead=r;});
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);let content='Draf hasil.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:[],acceptance:[],children:[{key:'a',title:'Logika hitung',brief:'Kerjakan',assignee:'Kak Dewi'}]});
  else if(/MODE: ANSWER TEAM/.test(text)){await leadGate;content=leadReply;}
  else if(/MODE: SYNTHESIZE/.test(text))content='Ringkasan.';
  else if(!/Answers:|Lead menjawab/.test(text))content='QUESTIONS:\n1. Bahasa apa?';
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;await call('PUT','/api/org',{...o,members:o.members.map(m=>['Kak Rani','Kak Dewi'].includes(m.name)?{...m,isAgent:true}:m)});
  const root=(await call('POST','/api/tasks',{title:'Kalkulator',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'Kalkulator web'})).body;
  // The member asks; the decision is with the lead, who is still thinking (gated).
  const d=await wait(async()=>{const k=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root.id);if(!k)return null;return (await call('GET','/api/communications')).body.decisions.find(x=>x.taskId===k.id&&x.status==='open');},'member question');
  assert.equal(d.target,'Kak Rani');
  // The owner answers directly in the meantime.
  const ans=await call('POST',`/api/decisions/${d.id}/answer`,{answer:'Pakai JavaScript',version:d.version});assert.equal(ans.status,200);
  releaseLead();await new Promise(r=>setTimeout(r,800));
  const after=(await call('GET','/api/communications')).body.decisions.find(x=>x.id===d.id);
  assert.equal(after.status,'answered','late escalation does not reopen');assert.equal(after.answer,'Pakai JavaScript');assert.notEqual(after.target,'owner','late escalation does not retarget an answered decision');
  const msgs=(await call('GET',`/api/tasks/${d.taskId}/thread`)).body.messages;
  assert.ok(!msgs.some(m=>/meneruskan pertanyaan ini ke owner/.test(m.text)),'no stale forward message');
  console.log('PASS: owner answer during lead thinking wins; late lead escalation is dropped');
 }finally{releaseLead();child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
