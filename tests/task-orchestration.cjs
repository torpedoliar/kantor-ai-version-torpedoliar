// Automatic tasks: the lead plans, children are created through org routes, dependencies gate work, and the lead synthesizes once.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {parsePlan}=require('../server/task-protocol');
const {seed}=require('../server/org');
const PORT=43553,origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-orchestration-'));
// --- Pure protocol checks against the seed organisation (Koh Wira leads engineering, collaborates via leadership).
const org=seed(),parent={id:'p',assignee:'Koh Wira',division:'engineering',depth:0};
const ok=parsePlan(JSON.stringify({assumptions:['web'],acceptance:['2+2=4'],children:[{key:'ui',title:'UI',brief:'b',assignee:'Bagas Pratama Putra'},{key:'api',title:'API',brief:'b',assignee:'Rizky Hakim',dependencyKeys:['ui']}]}),{org,parent});
assert.deepEqual(ok.children.map(c=>[c.key,c.assignee,c.dependencyKeys]),[['ui','Bagas Pratama Putra',[]],['api','Rizky Hakim',['ui']]]);
assert.deepEqual(ok.acceptance,['2+2=4']);
assert.throws(()=>parsePlan('{"children":[{"key":"a","title":"A","assignee":"Bagas Pratama Putra","dependencyKeys":["b"]},{"key":"b","title":"B","assignee":"Yoga","dependencyKeys":["a"]}]}',{org,parent}),/siklus|cycle/i);
assert.throws(()=>parsePlan('{"children":[{"key":"a","title":"A","assignee":"Bagas Pratama Putra"},{"key":"a","title":"A2","assignee":"Yoga"}]}',{org,parent}),/unik|unique/i);
assert.throws(()=>parsePlan(JSON.stringify({children:Array.from({length:13},(_,i)=>({key:'k'+i,title:'T',assignee:'Yoga'}))}),{org,parent}),/12/);
assert.throws(()=>parsePlan('{"children":[{"key":"a","title":"A","assignee":"Yoga"}]}',{org,parent:{...parent,depth:3}}),/kedalaman|depth/i);
const denied=parsePlan('{"children":[{"key":"s","title":"Support","assignee":"Kak Sinta"},{"key":"u","title":"UI","assignee":"Yoga"}]}',{org,parent});
assert.deepEqual(denied.children.map(c=>c.key),['u']);assert.equal(denied.rejected[0].assignee,'Kak Sinta','peer in another division is rejected, not silently created');
assert.equal(parsePlan('tidak ada rencana',{org,parent}),null);

// --- End to end through the server with a role-aware mock model.
const calls=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw||'{}'),text=JSON.stringify(body.messages);calls.push({text});
  let content='Hasil kerja.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:['Aplikasi web'],acceptance:['Operasi dasar benar'],children:[{key:'ui',title:'Rancang UI kalkulator',brief:'Tombol angka',assignee:'Bagas Pratama Putra'},{key:'logic',title:'Logika hitung',brief:'Empat operasi',assignee:'Rizky Hakim',dependencyKeys:['ui']},{key:'cs',title:'Siapkan FAQ',assignee:'Kak Sinta'}]});
  else if(/MODE: SYNTHESIZE/.test(text))content='Ringkasan akhir: UI dan logika selesai.';
  else if(/Rancang UI/.test(text))content='UI selesai: grid tombol.';
  else if(/Logika hitung/.test(text))content='Logika selesai: + - * /.';
  setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));},60);});});
function start(){const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,6).toString('base64')},stdio:['ignore','pipe','inherit']});
  return new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r(child));child.on('exit',c=>j(Error('server exit '+c)));});}
const wait=async(fn,label,ms=20000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));let child=await start();try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  // Make the engineering team AI agents so they can execute their children.
  const o=(await call('GET','/api/org')).body;
  assert.equal((await call('PUT','/api/org',{...o,members:o.members.map(m=>['Koh Wira','Bagas Pratama Putra','Rizky Hakim'].includes(m.name)?{...m,isAgent:true}:m)})).status,200);
  const root=(await call('POST','/api/tasks',{title:'Program Kalkulator',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'automatic',brief:'Kalkulator web'})).body;
  assert.equal(root.executionMode,'automatic');
  const children=await wait(async()=>{const l=(await call('GET','/api/tasks')).body.filter(t=>t.parentId===root.id);return l.length===2&&l;},'children');
  const ui=children.find(c=>c.assignee==='Bagas Pratama Putra'),logic=children.find(c=>c.assignee==='Rizky Hakim');
  assert.deepEqual(logic.dependencyIds,[ui.id],'dependency keys become task ids');assert.equal(ui.rootId,root.id);assert.equal(ui.createdBy,'Koh Wira');
  const ev=(await call('GET','/api/task-events?after=0')).body.events||[];
  assert.ok(ev.some(e=>e.type==='delegation.created'&&e.from==='Koh Wira'&&e.to==='Bagas Pratama Putra'));
  assert.ok(ev.some(e=>e.type==='delegation.rejected'&&e.to==='Kak Sinta'),'route-denied child is recorded, not created');
  // Logic must not start before UI is done.
  const firstLogic=calls.findIndex(c=>/Logika hitung/.test(c.text)&&!/MODE: PLAN/.test(c.text)),firstUi=calls.findIndex(c=>/Rancang UI/.test(c.text)&&!/MODE: PLAN/.test(c.text));
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===root.id).status==='review','root review');
  const order=calls.map(c=>c.text);const iUi=order.findIndex(t=>/Rancang UI kalkulator/.test(t)&&!/MODE/.test(t)),iLogic=order.findIndex(t=>/Logika hitung/.test(t)&&!/MODE/.test(t));
  assert.ok(iUi>=0&&iLogic>iUi,'dependency gated logic until UI finished');
  const synth=calls.filter(c=>/MODE: SYNTHESIZE/.test(c.text));assert.equal(synth.length,1,'exactly one synthesis');assert.match(synth[0].text,/UI selesai: grid tombol/);assert.match(synth[0].text,/Logika selesai/);
  const done=(await call('GET','/api/tasks')).body;const finalRoot=done.find(t=>t.id===root.id);
  assert.match(finalRoot.result,/Ringkasan akhir/);assert.ok(done.filter(t=>t.parentId===root.id).every(t=>t.status==='done'),'leaf results accepted internally by lead');
  // Restart does not re-plan or duplicate children.
  const planCalls=calls.filter(c=>/MODE: PLAN/.test(c.text)).length;child.kill();child=await start();
  await new Promise(r=>setTimeout(r,800));
  assert.equal((await call('GET','/api/tasks')).body.filter(t=>t.parentId===root.id).length,2,'no duplicate children after restart');
  assert.equal(calls.filter(c=>/MODE: PLAN/.test(c.text)).length,planCalls,'no re-plan after restart');
  console.log('PASS: plan protocol validation, route-checked delegation, dependency gating, single synthesis and restart-safe planning');
}finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
