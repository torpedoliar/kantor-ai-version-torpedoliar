// Messenger backend: a real worker question becomes one decision + agent message; answering resumes the task once.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43552),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-messenger-'));
const calls=[];let replies=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw||'{}');calls.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:replies.length?replies.shift():'Final draft.'}}]}));});});
function start(){const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});
  return new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r(child));child.on('exit',c=>j(Error('server exit '+c)));});}
const wait=async(fn,label,ms=15000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));let child=await start();try{
  const csrf=async()=>(await(await fetch(origin+'/api/session')).json()).csrf;let token,c=await csrf();
  const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':c,...(token?{'x-kantor-org':token}:{}),...extra},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  assert.equal((await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}})).status,200);
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  replies=['QUESTIONS:\n1. Bahasa pemrograman apa?\n2. Fitur apa saja?'];
  const task=(await call('POST','/api/tasks',{title:'Program Kalkulator',assignee:'Kak Rani',brief:'Buat kalkulator'})).body;
  const blocked=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===task.id);return t.status==='blocked'&&t;},'blocked');
  assert.equal(blocked.blockedReason,'decision');
  let comm=(await call('GET','/api/communications')).body;
  const decisions=comm.decisions.filter(d=>d.taskId===task.id&&d.status==='open');assert.equal(decisions.length,1,'one open decision');
  const decision=decisions[0];assert.deepEqual(decision.questions,['Bahasa pemrograman apa?','Fitur apa saja?']);
  const thread=comm.threads.find(t=>t.taskId===task.id);assert.ok(thread,'thread linked to task');assert.equal(thread.openDecisions,1);assert.ok(thread.unread>=1);
  const asked=comm.messages.find(m=>m.decisionId===decision.id);assert.equal(asked.sender.type,'agent');assert.equal(asked.sender.name,'Kak Rani');assert.equal(asked.kind,'decision');
  // Owner messages are authored by the server, not the client.
  // (A reply to a task waiting on questions answers them — covered below; authorship uses a task with no open decision.)
  const plain=(await call('POST','/api/tasks',{title:'Catatan bebas',assignee:'Koh Arman',division:'leadership',asLead:true,brief:'manual'})).body;
  const sent=await call('POST',`/api/tasks/${plain.id}/messages`,{text:'<script>alert(1)</script> Gunakan JavaScript',by:'CEO'});assert.equal(sent.status,201);assert.notEqual(sent.body.answeredDecision,true);
  assert.equal(sent.body.sender.type,'owner');assert.equal(sent.body.sender.name,'Owner');assert.equal(sent.body.text,'<script>alert(1)</script> Gunakan JavaScript');
  assert.equal((await call('POST',`/api/tasks/${plain.id}/messages`,{text:'x'},{'x-kantor-org':''})).status,403,'owner messages need the PIN session');
  // Reading the thread does not answer the decision.
  const last=(await call('GET',`/api/tasks/${task.id}/thread`)).body.messages.at(-1).seq;
  assert.equal((await call('PUT',`/api/communications/${thread.id}/read`,{throughSeq:last})).status,200);
  assert.equal((await call('PUT',`/api/communications/${thread.id}/read`,{throughSeq:1})).status,200,'older cursor is ignored, not an error');
  comm=(await call('GET','/api/communications')).body;const after=comm.threads.find(t=>t.id===thread.id);assert.equal(after.unread,0);assert.equal(after.openDecisions,1,'read does not close decision');
  assert.equal(comm.reads[thread.id],last,'read cursor never moves backwards');
  // Answer: stale version refused; same request key answers once and resumes once.
  assert.equal((await call('POST',`/api/decisions/${decision.id}/answer`,{answer:'JavaScript web',version:decision.version+1})).status,409);
  const key='a6f1c2e0-7b2d-4c38-9a51-000000000001';const before=calls.length;
  const first=await call('POST',`/api/decisions/${decision.id}/answer`,{answer:'JavaScript web, empat operasi',version:decision.version},{'x-kantor-request':key});assert.equal(first.status,200);
  const again=await call('POST',`/api/decisions/${decision.id}/answer`,{answer:'JavaScript web, empat operasi',version:decision.version},{'x-kantor-request':key});assert.equal(again.status,200);assert.deepEqual(again.body,first.body,'duplicate request returns the first result');
  await wait(async()=>(await call('GET','/api/tasks')).body.find(x=>x.id===task.id).status==='review','resumed to review');
  assert.equal(calls.length-before,1,'one resumption');
  const prompt=JSON.stringify(calls.at(-1).messages);assert.match(prompt,/JavaScript web, empat operasi/,'answer reaches the model');assert.match(prompt,/Owner/,'history attribution reaches the model');assert.doesNotMatch(prompt,/CEO/);
  comm=(await call('GET','/api/communications')).body;assert.equal(comm.decisions.find(d=>d.id===decision.id).status,'answered');
  // A plain chat reply to a task waiting on questions answers them: the owner should not need to find the card.
  replies.push('QUESTIONS:\n1. Ukuran brosur?');
  const t2=(await call('POST','/api/tasks',{title:'Draf brosur',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'x'})).body;
  const d2=await wait(async()=>(await call('GET','/api/communications')).body.decisions.find(d=>d.taskId===t2.id&&d.status==='open'),'second decision');
  const reply=await call('POST',`/api/tasks/${t2.id}/messages`,{text:'Bebas, terserah kamu'});assert.equal(reply.status,201);assert.equal(reply.body.answeredDecision,true);
  assert.equal((await call('GET','/api/communications')).body.decisions.find(d=>d.id===d2.id).status,'answered');
  await wait(async()=>(await call('GET','/api/tasks')).body.find(x=>x.id===t2.id).status==='review','chat reply resumed the agent');
  // Reload keeps read state; legacy messages are not imported twice.
  const msgCount=(await call('GET','/api/communications')).body.messages.length;child.kill();child=await start();c=await csrf();token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  comm=(await call('GET','/api/communications')).body;assert.equal(comm.messages.length,msgCount);assert.equal(comm.reads[thread.id],last);
  // Incremental fetch only returns later messages.
  const inc=(await call('GET',`/api/communications?after=${last}`)).body;assert.ok(inc.messages.every(m=>m.seq>last));
  // nextSeq-1 is the last assigned sequence: a message created next must not be skipped by the cursor.
  const cursor=(await call('GET','/api/communications')).body.nextSeq-1;
  const fresh=await call('POST',`/api/tasks/${plain.id}/messages`,{text:'Pesan baru setelah cursor'});
  const inc2=(await call('GET',`/api/communications?after=${cursor}`)).body;
  assert.ok(inc2.messages.some(m=>m.text==='Pesan baru setelah cursor'),'the first message after the cursor is delivered');
  console.log('PASS: messenger decisions, server-owned authorship, read cursors, idempotent answer resumes worker once with owner context');
}finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
