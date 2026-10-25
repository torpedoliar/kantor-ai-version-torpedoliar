// In an automatic plan a team member's question goes to the lead first; the owner is asked only when the lead escalates.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43701),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-lead-answers-'));
let leadReply='Pakai JavaScript murni, tanpa framework.';const prompts=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);prompts.push(text);let content='Draf hasil.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:[],acceptance:[],children:[{key:'a',title:/Brosur/.test(text)?'Desain brosur':'Logika hitung',brief:'Kerjakan',assignee:'Kak Dewi'}]});
  else if(/MODE: ANSWER TEAM/.test(text))content=leadReply;
  else if(/MODE: SYNTHESIZE/.test(text))content='Ringkasan tim.';
  else if(!/Answers:|Lead menjawab/.test(text))content='QUESTIONS:\n1. Bahasa apa yang dipakai?';
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,8).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;await call('PUT','/api/org',{...o,members:o.members.map(m=>['Kak Rani','Kak Dewi'].includes(m.name)?{...m,isAgent:true}:m)});
  // 1) The lead answers its team member; the owner never gets a decision.
  const root=(await call('POST','/api/tasks',{title:'Program Kalkulator',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'Kalkulator web'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===root.id).status==='review','root reached review',40000);
  const kid=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root.id);
  const comm=(await call('GET','/api/communications')).body;
  assert.equal(comm.decisions.filter(d=>d.taskId===kid.id&&d.target==='owner').length,0,'owner was not asked');
  assert.ok(comm.threads.every(t=>t.ownerDecisions===0),'no thread shows a decision waiting on the owner');
  const msgs=(await call('GET',`/api/tasks/${kid.id}/thread`)).body.messages;
  const q=msgs.find(m=>m.kind==='decision'),a=msgs.find(m=>m.sender.name==='Kak Rani'&&/JavaScript murni/.test(m.text));
  assert.ok(q&&q.sender.name==='Kak Dewi','team member asked in the thread');assert.ok(a,'lead answered in the thread');assert.ok(a.seq>q.seq);
  assert.ok(prompts.some(p=>/MODE: ANSWER TEAM[\s\S]*Bahasa apa yang dipakai/.test(p)),'lead saw the question');
  assert.ok(prompts.some(p=>/Lead menjawab[\s\S]*JavaScript murni/.test(p)),'member continued with the lead answer');
  // 2) The lead escalates: the question goes to the owner as before.
  leadReply='ESCALATE: owner harus memutuskan';
  const root2=(await call('POST','/api/tasks',{title:'Brosur promo',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'Brosur'})).body;
  const escalated=await wait(async()=>{const k=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root2.id);if(!k)return null;return (await call('GET','/api/communications')).body.decisions.find(d=>d.taskId===k.id&&d.status==='open');},'escalated to owner',40000);
  assert.equal(escalated.target,'owner');
  assert.equal((await call('GET','/api/communications')).body.threads.find(t=>t.taskId===escalated.taskId).ownerDecisions,1,'escalated decision counts for the owner');
  const kid2=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root2.id);
  assert.ok((await call('GET',`/api/tasks/${kid2.id}/thread`)).body.messages.some(m=>m.sender.name==='Kak Rani'&&/meneruskan pertanyaan ini ke owner/.test(m.text)),'lead says it forwarded the question');
  // 3) A lead that replies with its own QUESTIONS: is escalating, not answering.
  leadReply='QUESTIONS:\n1. Untuk siapa brosurnya?';
  const root3=(await call('POST','/api/tasks',{title:'Brosur kedua',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'Brosur'})).body;
  const third=await wait(async()=>{const k=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root3.id);if(!k)return null;return (await call('GET','/api/communications')).body.decisions.find(d=>d.taskId===k.id&&d.status==='open'&&d.target==='owner');},'lead questions escalate',40000);
  const kid3=(await call('GET','/api/tasks')).body.find(t=>t.parentId===root3.id);
  assert.equal(kid3.status,'blocked','member stays blocked; a question is not an answer');assert.doesNotMatch(kid3.brief,/Lead menjawab[\s\S]*QUESTIONS:/);
  assert.ok(third);
  console.log('PASS: lead answers team questions in the thread; escalates to the owner when it cannot');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
