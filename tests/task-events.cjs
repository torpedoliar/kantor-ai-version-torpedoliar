// Live task events: owner-only SSE with replay by sequence, no gaps or duplicates on reconnect, resync when far behind.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {sanitizeText}=require('../server/task-store');
// Console output is sanitized before it is stored: no terminal escapes, no tokens.
assert.equal(sanitizeText('\x1b[31mmerah\x1b[0m'),'merah');
assert.doesNotMatch(sanitizeText('key sk-abcDEF1234567890xyz and Bearer abc.def-123 api_key=hunter2'),/abcDEF1234567890xyz|abc\.def-123|hunter2/);
const PORT=Number(process.env.TEST_PORT||43531),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-events-'));
const SECRET='sk-test-SECRET999';
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Draf siap.'}}]}));},150));});
const child=()=>spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,7).toString('base64')},stdio:['ignore','pipe','inherit']});
const wait=async(fn,label,ms=15000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,50));}};
// Minimal SSE reader over fetch, the same way the browser client reads it.
function stream(headers,after){
  const controller=new AbortController(),events=[],control=[];let buffer='';
  const done=fetch(`${origin}/api/task-events${after!==undefined?`?after=${after}`:''}`,{headers:{accept:'text/event-stream',...headers},signal:controller.signal}).then(async res=>{
    if(res.status!==200){control.push({status:res.status});return;}
    const reader=res.body.getReader(),decoder=new TextDecoder();
    for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let cut;
      while((cut=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const f={};for(const line of block.split('\n')){const i=line.indexOf(':');if(i<=0)continue;f[line.slice(0,i)]=line.slice(i+1).trim();}
        if(f.event==='resync')control.push({resync:JSON.parse(f.data)});else if(f.data){const e=JSON.parse(f.data);assert.equal(String(e.seq),f.id,'SSE id is the event sequence');events.push(e);}}}
  }).catch(e=>{if(e.name!=='AbortError')throw e;});
  return {events,control,close:()=>controller.abort(),done};
}
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));const server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
 try{
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  assert.equal((await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:SECRET}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}})).status,200);
  // Owner only: no token, no events.
  assert.equal((await call('GET','/api/task-events?after=0')).status,403);assert.equal((await call('GET','/api/task-events/snapshot')).status,403);
  const locked=stream({});await locked.done;assert.equal(locked.control[0].status,403);
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;const auth={'x-kantor-org':token};
  const start=(await call('GET','/api/task-events/snapshot')).body;assert.ok(Number.isInteger(start.seq));assert.ok(Array.isArray(start.tasks));
  // Live: a task that goes queued → active → review between two polls still shows every real step.
  const live=stream(auth,start.seq);await wait(async()=>(await call('GET','/api/task-events/snapshot')).body.streams===1,'stream registered');
  const task=(await call('POST','/api/tasks',{title:'Caption menu',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Ramah dan singkat untuk Instagram'})).body;
  await wait(()=>live.events.some(e=>e.type==='task.phase'&&e.taskId===task.id&&e.data.to==='review'),'review event');
  const mine=live.events.filter(e=>e.taskId===task.id).map(e=>e.type==='task.phase'?`${e.data.from}>${e.data.to}`:e.type);
  assert.deepEqual(mine.filter(t=>t!=='task.updated'),['task.created','queued>active','message.created','model.started','model.completed','active>review','result.submitted','message.created']);
  const started=live.events.find(e=>e.type==='model.started'&&e.taskId===task.id);assert.equal(started.data.providerId,'mock');assert.equal(started.data.modelId,'m');assert.ok(started.runId);
  const seqs=live.events.map(e=>e.seq);assert.deepEqual(seqs,[...seqs].sort((a,b)=>a-b));assert.equal(new Set(seqs).size,seqs.length);
  // Reconnect from Last-Event-ID: everything since, exactly once.
  const last=live.events.at(-1).seq;live.close();await live.done;
  await wait(async()=>(await call('GET','/api/task-events/snapshot')).body.streams===0,'closed stream released');
  for(let i=0;i<3;i++)assert.equal((await call('POST',`/api/tasks/${task.id}/messages`,{text:`catatan ${i}`})).status,201);
  const again=stream({...auth,'last-event-id':String(last)});
  const expected=(await call('GET',`/api/task-events?after=${last}`)).body.events.map(e=>e.seq);assert.ok(expected.length>=3);
  await wait(()=>again.events.length>=expected.length,'replay');assert.deepEqual(again.events.map(e=>e.seq),expected,'replay has no gap and no duplicate');
  again.close();await again.done;
  // Far behind (more than 500 events): an explicit resync marker instead of a partial replay.
  for(let i=0;i<505;i++)await call('POST',`/api/tasks/${task.id}/messages`,{text:`m${i}`});
  // Owner messages schedule async agent replies; let that tail land so the resync cursor is measured on a quiet log.
  let settled=0,quietSeq=(await call('GET','/api/task-events/snapshot')).body.seq;
  for(let until=Date.now()+15000;Date.now()<until;){await new Promise(r=>setTimeout(r,150));const s=(await call('GET','/api/task-events/snapshot')).body.seq;if(s===quietSeq){if(++settled>=3)break;}else{settled=0;quietSeq=s;}}
  const behind=stream(auth,0);await wait(()=>behind.control.length,'resync');const latest=(await call('GET','/api/task-events/snapshot')).body.seq;
  assert.equal(behind.control[0].resync.seq,quietSeq,'resync carries the seq at subscribe time');assert.ok(latest>=behind.control[0].resync.seq);assert.equal(behind.events.length,0);behind.close();await behind.done;
  // Public events never carry credentials or provider snapshots.
  const all=[];for(let after=0;;){const page=(await call('GET',`/api/task-events?after=${after}`)).body.events;if(!page.length)break;all.push(...page);after=page.at(-1).seq;}
  const json=JSON.stringify(all);assert.doesNotMatch(json,/SECRET999|credential|baseUrl/);
  console.log('PASS: owner-only SSE, real phase replay, Last-Event-ID without gaps, released streams, resync marker, sanitized events');
 }finally{server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
