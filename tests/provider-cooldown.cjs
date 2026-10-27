// A 429 with Retry-After rests the provider for the whole office: the task's own retry does not
// hit it again until the cooldown ends, and the provider's error snippet reaches the owner.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=43556,origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-provider-cooldown-'));
const hits=[];let first=true;
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  hits.push(Date.now());
  if(first){
    first=false;res.writeHead(429,{'content-type':'application/json','retry-after':'1'});
    res.end(JSON.stringify({error:{message:'rate limited: slow down'}}));return;
  }
  setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Hasil jadi.'}}]}));},20);
});});
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,10).toString('base64'),KANTOR_RETRY_DELAYS_MS:'50'},stdio:['ignore','pipe','inherit']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
const wait=async(fn,label,ms=25000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,80));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));await ready;try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const task=(await call('POST','/api/tasks',{title:'Caption peluncuran',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Tulis caption peluncuran kopi dingin.'})).body;
  const done=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===task.id);return t&&t.status==='review'&&t;},'task after the provider cooldown');
  assert.equal(done.result,'Hasil jadi.');
  assert.equal(hits.length,2,'one rejected call and one retry, no hammering');
  const gap=hits[1]-hits[0];
  assert.ok(gap>=800,`the retry waited for Retry-After (${gap}ms)`);
  const events=(await call('GET','/api/task-events?after=0')).body.events||[];
  const failed=events.find(e=>e.type==='model.failed'&&e.taskId===task.id);
  assert.ok(failed,'the failed call is in the audit trail');
  assert.match(failed.data.error,/slow down/,'the provider error snippet is kept');
  assert.ok(failed.data.error.length<=500,'the snippet stays bounded');
  const thread=(await call('GET',`/api/tasks/${task.id}/thread`)).body;
  assert.ok((thread.messages||[]).some(m=>m.kind==='error'&&/slow down/.test(m.text)),'the thread explains the provider error');
  console.log('PASS: Retry-After cools the whole provider, the retry waits for it, and the error snippet reaches the task');
}finally{server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
