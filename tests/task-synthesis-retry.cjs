// A failing synthesis is bounded: it backs off, stops after KANTOR_SYNTH_ATTEMPTS, and waits for
// an explicit Coba lagi instead of re-entering wake() forever.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=43554,origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-synth-retry-'));
let failSynth=true;const calls=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw||'{}'),text=JSON.stringify(body.messages);calls.push({text});
  if(/MODE: SYNTHESIZE/.test(text)&&failSynth){
    setTimeout(()=>{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'synthesis down'}}));},20);return;
  }
  let content='Hasil kerja.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:[],acceptance:['Hasil tersedia'],children:[{key:'a',title:'Bagian A',brief:'Kerjakan A',assignee:'Bagas Pratama Putra'},{key:'b',title:'Bagian B',brief:'Kerjakan B',assignee:'Rizky Hakim'}]});
  else if(/MODE: SYNTHESIZE/.test(text))content='Hasil akhir dari tim.';
  else if(/MODE: REVIEW/.test(text))content='APPROVE';
  else if(/Kerjakan A/.test(text))content='Hasil A.';
  else if(/Kerjakan B/.test(text))content='Hasil B.';
  setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));},20);});});
function start(){const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,7).toString('base64'),KANTOR_SYNTH_ATTEMPTS:'3',KANTOR_SYNTH_RETRY_DELAYS_MS:'150,250'},stdio:['ignore','pipe','inherit']});
  return new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r(child));child.on('exit',c=>j(Error('server exit '+c)));});}
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));let child=await start();try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;
  assert.equal((await call('PUT','/api/org',{...o,members:o.members.map(m=>['Koh Wira','Bagas Pratama Putra','Rizky Hakim'].includes(m.name)?{...m,isAgent:true}:m)})).status,200);
  const root=(await call('POST','/api/tasks',{title:'Program dengan synthesis gagal',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'automatic',brief:'Kerjakan program'})).body;
  const failed=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===root.id);return t&&t.phase==='failed'&&t.synthAttempts===3&&t;},'three bounded synthesis attempts');
  assert.equal(failed.status,'queued','the task stays retryable');
  assert.ok(failed.error,'the failure is visible');
  const synthCalls=()=>calls.filter(c=>/MODE: SYNTHESIZE/.test(c.text));
  assert.equal(synthCalls().length,3,'exactly three attempts');
  assert.equal(failed.synthRetryAt,undefined,'no further automatic retry is scheduled');
  // Nothing re-enters the loop while the task sits failed: version and call count stay put.
  const version=failed.version;await new Promise(r=>setTimeout(r,1500));
  const quiet=(await call('GET','/api/tasks')).body.find(x=>x.id===root.id);
  assert.equal(synthCalls().length,3,'no fourth synthesis call');
  assert.equal(quiet.version,version,'no background commits after the last attempt');
  const thread=(await call('GET',`/api/tasks/${root.id}/thread`)).body;
  assert.ok((thread.messages||[]).some(m=>m.kind==='error'&&/dihentikan/.test(m.text)),'the thread says the automatic retries stopped');
  // Coba lagi clears the error and reopens the synthesis gate; this time it succeeds once.
  failSynth=false;
  assert.equal((await call('PATCH',`/api/tasks/${root.id}`,{status:'queued',version:quiet.version})).status,200);
  const reviewed=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===root.id);return t&&t.status==='review'&&t;},'synthesis after retry');
  assert.equal(reviewed.result,'Hasil akhir dari tim.');
  assert.equal(reviewed.synthAttempts,0,'a successful synthesis resets the attempt counter');
  assert.equal(synthCalls().length,4,'one extra synthesis after the manual retry');
  console.log('PASS: failed synthesis retries with backoff, stops at the limit, and resumes once after Coba lagi');
}finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
