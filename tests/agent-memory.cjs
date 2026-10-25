// Each agent keeps a short memory of its approved work and the owner's answers, sent with its next task.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43691),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-memory-'));
const prompts=[];let replies=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{prompts.push(JSON.stringify(JSON.parse(raw||'{}').messages));
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:replies.length?replies.shift():'Draf siap.'}}]}));});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,1).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  assert.equal((await call('GET','/api/agents/Kak%20Rani/memory')).body.items.length,0,'starts empty');
  // Task 1: the agent asks, the owner answers; the owner approves the draft → both land in memory.
  replies=['QUESTIONS:\n1. Bahasa?'];
  const t1=(await call('POST','/api/tasks',{title:'Kalkulator',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Buat kalkulator'})).body;
  const d=await wait(async()=>(await call('GET','/api/communications')).body.decisions.find(x=>x.taskId===t1.id&&x.status==='open'),'question');
  await call('POST',`/api/decisions/${d.id}/answer`,{answer:'Pakai JavaScript, UI bahasa Indonesia',version:d.version});
  const review=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===t1.id);return t.status==='review'&&t;},'review');
  // A rejected draft is not remembered.
  replies=['Draf kedua.'];await call('PATCH',`/api/tasks/${t1.id}`,{action:'revise',feedback:'Lebih singkat',version:review.version});
  const again=await wait(async()=>{const t=(await call('GET','/api/tasks')).body.find(x=>x.id===t1.id);return t.status==='review'&&t.version!==review.version&&t;},'second review');
  assert.equal((await call('GET','/api/agents/Kak%20Rani/memory')).body.items.length,0,'nothing remembered before approval');
  await call('PATCH',`/api/tasks/${t1.id}`,{action:'approve',version:again.version});
  const mem=(await call('GET','/api/agents/Kak%20Rani/memory')).body.items;
  assert.ok(mem.some(i=>/Kalkulator/.test(i.text)),'approved task is remembered');assert.ok(mem.some(i=>/JavaScript, UI bahasa Indonesia/.test(i.text)),'owner answer is remembered');
  assert.ok(!mem.some(i=>/Draf siap|Draf kedua/.test(i.text)&&i.text.length>400),'memory is a short summary, not the full draft');
  // Task 2: the memory is sent with the next task.
  const before=prompts.length;
  const t2=(await call('POST','/api/tasks',{title:'Kalender konten',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Kalender bulan depan'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(x=>x.id===t2.id).status==='review','second task');
  assert.match(prompts.slice(before).join(''),/Your memory[\s\S]*JavaScript, UI bahasa Indonesia/,'memory reaches the model on the next task');
  // Owner edits and clears; limits hold; unlock required.
  const edited=await call('PUT','/api/agents/Kak%20Rani/memory',{items:[{text:'Owner suka nada santai'}]});assert.equal(edited.status,200);
  assert.deepEqual((await call('GET','/api/agents/Kak%20Rani/memory')).body.items.map(i=>i.text),['Owner suka nada santai']);
  assert.equal((await call('PUT','/api/agents/Kak%20Rani/memory',{items:Array.from({length:40},(_,i)=>({text:'x'+i}))})).body.items.length,20,'capped at 20');
  assert.equal((await call('PUT','/api/agents/Kak%20Rani/memory',{items:[]})).body.items.length,0,'cleared');
  assert.equal((await call('GET','/api/agents/Nobody/memory')).status,404);
  token='';assert.equal((await call('GET','/api/agents/Kak%20Rani/memory')).status,403,'owner only');
  console.log('PASS: approved work and owner answers become agent memory, sent with the next task; editable, capped, owner-only');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
