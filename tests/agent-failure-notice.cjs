// An agent failure must reach the owner: a system message in the thread and an alert in Komunikasi, not only a card label.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43661),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-fail-notice-'));
const mock=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"boom"}');});});
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,5).toString('base64'),KANTOR_RETRY_DELAYS_MS:'100,100,100'},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const task=(await call('POST','/api/tasks',{title:'Caption gagal',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Caption singkat untuk Instagram'})).body;
  let comm;for(let i=0;i<150;i++){comm=(await call('GET','/api/communications')).body;if(comm.alerts?.some(a=>a.taskId===task.id))break;await new Promise(r=>setTimeout(r,100));}
  const msg=comm.messages.find(m=>m.taskId===task.id&&m.kind==='error');assert.ok(msg,'failure is posted to the task thread');assert.equal(msg.sender.type,'system');assert.match(msg.text,/gagal|500/i);
  const alert=comm.alerts.find(a=>a.taskId===task.id);assert.ok(alert,'failure is an alert in Komunikasi');assert.match(alert.text,/Caption gagal/);
  assert.doesNotMatch(JSON.stringify(comm),/"credential"|sk-/,'no secrets in alerts');
  // Retrying clears the alert; a repeated failure on the same task does not stack duplicates.
  await new Promise(r=>setTimeout(r,500));comm=(await call('GET','/api/communications')).body;
  assert.equal(comm.messages.filter(m=>m.taskId===task.id&&m.kind==='error').length,1,'one error message per failure, not one per retry poll');
  console.log('PASS: agent failure posts one system message and a Komunikasi alert');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
