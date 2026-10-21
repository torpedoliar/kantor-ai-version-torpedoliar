// Application tasks: the model returns a source bundle, the server stores an immutable revision, the owner approves
// running it, the real runner builds and tests it, and only a revision with passing evidence can reach Review/Done.
// The mock provider returns a trusted calculator bundle written in this test; nothing comes from a real model.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43601),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-app-flow-'));
const calc=`exports.add=(a,b)=>a+b;exports.sub=(a,b)=>a-b;exports.div=(a,b)=>{if(b===0)throw new Error('Tidak bisa membagi dengan nol');return a/b;};`;
const tests=good=>`const test=require('node:test'),assert=require('node:assert'),c=require('../calc.js');
test('C1 2+2=4',()=>assert.equal(c.add(2,2),${good?4:5}));test('C2 negatif',()=>assert.equal(c.sub(-2,3),-5));
test('C3 desimal',()=>assert.equal(c.add(0.1,0.2).toFixed(2),'0.30'));test('C4 bagi nol',()=>assert.throws(()=>c.div(1,0),/nol/));`;
const bundle=good=>({runtime:'static-web',files:[{path:'index.html',content:'<!doctype html><title>Kalkulator</title><script src="calc.js"></script>'},{path:'calc.js',content:calc},{path:'test/calc.test.js',content:tests(good)}],
  commands:{test:{executable:'node',args:['--test','test/calc.test.js']}},acceptanceTests:['C1 2+2=4','C2 negatif','C3 desimal','C4 bagi nol'],knownLimitations:['Tidak menyimpan riwayat']});
let reply=()=>JSON.stringify(bundle(false)),appCalls=0;
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);
  const content=/MODE: APPLICATION/.test(text)?(appCalls++,reply(text)):'Hasil kerja.';
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,150));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  if(process.platform!=='win32'){console.log('SKIP: uses the Windows runner');return;}
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;await call('PUT','/api/org',{...o,members:o.members.map(m=>m.name==='Koh Wira'?{...m,isAgent:true}:m)});
  const task=(await call('POST','/api/tasks',{title:'Kalkulator web',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'direct',outputType:'application',environment:'windows',acceptance:['2+2=4','negatif','desimal','bagi nol'],brief:'Kalkulator web sederhana'})).body;
  const get=async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===task.id);
  // Direct application roots are worked on (they are not held for manual split).
  const waiting=await wait(async()=>{const t=await get();if(t?.phase==='failed'||t?.error)throw Error(JSON.stringify(t));return t.phase==='awaiting_approval'&&t;},'bundle stored, awaiting approval');
  assert.equal(waiting.status,'blocked');assert.equal(waiting.blockedReason,'approval');assert.ok(waiting.projectId&&waiting.revisionId);
  // The owner sees an approval card in the task thread: commands, runtime and the Windows warning.
  const thread=(await call('GET',`/api/tasks/${task.id}/thread`)).body;const card=thread.messages.find(m=>m.kind==='approval');
  assert.equal(thread.decisions.find(d=>d.kind==='approval')?.status,'open','execution approval is a durable decision, not only a chat message');
  assert.match(card.text,/node --test test\/calc\.test\.js/);assert.match(card.text,/bukan sandbox/i);assert.match(card.text,/3 file/);
  // Model saying "tests pass" is not evidence: approving the task before a real job is refused.
  assert.equal((await call('PATCH',`/api/tasks/${task.id}`,{action:'approve',version:waiting.version})).body.code,'EVIDENCE_REQUIRED');
  const manifest=(await call('GET',`/api/projects/${waiting.projectId}/revisions/${waiting.revisionId}`)).body;
  const approve=async t=>(await call('POST',`/api/tasks/${t.id}/application/approve`,{revisionId:t.revisionId,manifestHash:(await call('GET',`/api/projects/${t.projectId}/revisions/${t.revisionId}`)).body.manifestHash,acknowledgeHostAccess:true})).body;
  // First revision has a wrong test: the real run fails, the agent gets ONE repair attempt with the failure output.
  reply=text=>{assert.match(text,/C1 2\+2=4/,'repair prompt carries the real failing test output');return JSON.stringify(bundle(true));};
  await approve(waiting);
  const repaired=await wait(async()=>{const t=await get();return t.phase==='awaiting_approval'&&t.revisionId!==waiting.revisionId&&t;},'repair revision awaits a new approval');
  assert.equal(repaired.repairAttempts,1);assert.equal(appCalls,2);
  const failedJob=(await call('GET',`/api/jobs/${waiting.jobId||''}`));void failedJob;
  // Changed source needs a new approval; the old approval cannot run the new revision.
  assert.equal((await call('POST',`/api/projects/${repaired.projectId}/run`,{revisionId:repaired.revisionId,approvalId:'x'})).body.code,'APPROVAL_REQUIRED');
  await approve(repaired);
  const review=await wait(async()=>{const t=await get();return t.status==='review'&&t;},'passing revision reaches review');
  assert.equal(review.evidence.revisionId,repaired.revisionId);assert.equal(review.evidence.sourceHash,(await call('GET',`/api/projects/${repaired.projectId}/revisions/${repaired.revisionId}`)).body.sourceHash);
  assert.deepEqual(review.evidence.criteria.map(c=>[c.criterion,c.status]),[['2+2=4','passed'],['negatif','passed'],['desimal','passed'],['bagi nol','passed']]);
  assert.equal(review.evidence.smoke.status,'passed');assert.equal(review.evidence.smoke.httpStatus,200);
  assert.equal(review.evidence.exitCode,0);assert.match(review.result,/Diuji di Windows lokal/);assert.match(review.result,/Tidak menyimpan riwayat/);assert.doesNotMatch(review.result,/bebas bug/i);
  // Approve checks the same revision is still current, then done exactly once.
  const done=await call('PATCH',`/api/tasks/${task.id}`,{action:'approve',version:review.version});assert.equal(done.status,200);assert.equal(done.body.status,'done');
  assert.equal((await call('PATCH',`/api/tasks/${task.id}`,{action:'approve',version:review.version})).status,409);
  // A second app whose repairs keep failing stops after 2 attempts, stays In progress with the cause.
  reply=()=>JSON.stringify(bundle(false));appCalls=0;
  const stubborn=(await call('POST','/api/tasks',{title:'Kalkulator rusak',assignee:'Koh Wira',division:'engineering',asLead:true,outputType:'application',environment:'windows',acceptance:['2+2=4'],brief:'Kalkulator'})).body;
  const getS=async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===stubborn.id);
  for(let round=0;round<3;round++){const t=await wait(async()=>{const x=await getS();return (x.phase==='awaiting_approval'||x.phase==='failed')&&x.revisionId&&!x._seen?.[round]&&x;},'round '+round);if(t.phase==='failed')break;await approve(t);await wait(async()=>(await getS()).revisionId!==t.revisionId||(await getS()).phase==='failed','next round');}
  const final=await getS();assert.equal(final.phase,'failed');assert.equal(final.status,'blocked');assert.equal(final.repairAttempts,2);assert.match(final.error,/C1 2\+2=4|gagal/i);assert.equal(appCalls,3,'one build + two repairs, never more');
  // Unsupported runtime from the model is refused before anything runs.
  reply=()=>JSON.stringify({...bundle(true),runtime:'python'});
  const py=(await call('POST','/api/tasks',{title:'App python',assignee:'Koh Wira',division:'engineering',asLead:true,outputType:'application',environment:'windows',brief:'x'})).body;
  const pyDone=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===py.id);return t.phase==='failed'&&t;},'unsupported runtime');assert.match(pyDone.error,/belum didukung/i);
  console.log('PASS: bundle → revision → owner approval → real run → one repair → new approval → evidence-gated review → done once; capped repairs; unsupported runtime refused');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
