// Full chain: Direktur splits to a lead; a lead with staff splits again; each result is reviewed by the person who
// delegated it (approve or one revision); results roll up; a failed subtask is reported to its lead.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43761),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-hierarchy-'));
const calls=[];let failWork=false;
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);calls.push(text);
  const say=content=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));};
  if(/MODE: PLAN/.test(text)){
    if(/Task: Bangun kalkulator/.test(text))return say(JSON.stringify({children:[{key:'ui',title:'UI kalkulator',brief:'Tombol',assignee:'Bagas Pratama Putra'},{key:'api',title:'Logika kalkulator',brief:'Operasi',assignee:'Rizky Hakim',dependencyKeys:['ui']}]}));
    // A sub-lead whose plan is unusable must not stall the tree: it does the work itself.
    if(/Task: Dukungan pelanggan/.test(text))return say('bukan rencana JSON');
    return say(JSON.stringify({children:[{key:'eng',title:'Bangun kalkulator',brief:'Tim engineering',assignee:'Koh Wira'},{key:'svc',title:'Dukungan pelanggan',brief:'Tim CS',assignee:'Gilang',dependencyKeys:['eng']}]}));
  }
  // The first review of the UI asks for one revision; everything else is approved.
  if(/MODE: REVIEW/.test(text))return say(/Task: UI kalkulator/.test(text)&&!/Revisi UI/.test(text)?'REVISE: Tambahkan tombol persen.':'APPROVE');
  if(/MODE: SYNTHESIZE/.test(text))return say(/Task: Bangun kalkulator/.test(text)?'Ringkasan tim engineering.':'Ringkasan akhir untuk owner.');
  if(/Task: Logika kalkulator/.test(text)){if(failWork){res.writeHead(400,{'content-type':'application/json'});return res.end('{}');}return say('Logika: + - * /.');}
  if(/Task: UI kalkulator/.test(text))return say(/Tambahkan tombol persen/.test(text)?'Revisi UI: grid + tombol persen.':'UI: grid tombol.');
  say('Hasil kerja.');});});
const wait=async(fn,label,ms=60000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,120));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,7).toString('base64')},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;
  await call('PUT','/api/org',{...o,members:o.members.map(m=>['Koh Arman','Koh Wira','Bagas Pratama Putra','Rizky Hakim','Gilang','Kak Sinta'].includes(m.name)?{...m,isAgent:true}:m)});
  const tasks=async()=>(await call('GET','/api/tasks')).body;
  const root=(await call('POST','/api/tasks',{title:'Program Kalkulator',assignee:'Koh Arman',division:'leadership',asLead:true,brief:'Kalkulator web'})).body;
  // Level 1: Direktur → lead. Level 2: the lead (who has AI staff) splits again.
  const lead=await wait(async()=>(await tasks()).find(t=>t.parentId===root.id&&t.assignee==='Koh Wira'),'direktur delegated to lead');
  // A sub-lead whose subtask depends on another one waits: no planning, no team, until the dependency is done.
  const svc=(await tasks()).find(t=>t.parentId===root.id&&t.assignee==='Gilang');
  assert.equal(lead.assignee,'Koh Wira');assert.equal(lead.executionMode,'automatic','a delegated lead with staff splits again');
  const staff=await wait(async()=>{const l=(await tasks()).filter(t=>t.parentId===lead.id);return l.length===2&&l;},'lead delegated to staff');
  assert.deepEqual(staff.map(t=>t.assignee).sort(),['Bagas Pratama Putra','Rizky Hakim']);
  assert.ok(staff.every(t=>t.executionMode!=='automatic'),'staff without reports execute directly');
  await wait(async()=>(await tasks()).find(t=>t.id===root.id).status==='review','root reaches owner review',90000);
  // Gilang's plan call came only after Koh Wira's synthesis was reviewed (his dependency was done).
  const firstSvcPlan=calls.findIndex(c=>/MODE: PLAN/.test(c)&&/Task: Dukungan pelanggan/.test(c)),wiraReviewed=calls.findIndex(c=>/MODE: REVIEW/.test(c)&&/Task: Bangun kalkulator/.test(c));
  assert.ok(wiraReviewed>=0&&firstSvcPlan>wiraReviewed,'dependent sub-lead plans only after its dependency is done');
  const svcDone=(await tasks()).find(t=>t.id===svc.id);
  assert.equal(svcDone.status,'done');assert.equal((await tasks()).filter(t=>t.parentId===svc.id).length,0,'failed sub-plan → worked directly');
  assert.ok((await call('GET',`/api/tasks/${svc.id}/thread`)).body.messages.some(m=>/dikerjakan langsung/.test(m.text)),'thread says the lead works it directly');
  // The lead reviewed each staff result; the UI result got exactly one revision before approval.
  assert.ok(calls.filter(c=>/MODE: REVIEW/.test(c)).length>=4,'each staff result (plus the revision) and the lead result were reviewed');
  const all=await tasks(),ui=all.find(t=>t.parentId===lead.id&&t.assignee==='Bagas Pratama Putra');
  assert.match(ui.result,/tombol persen/,'revision requested by the lead was applied');assert.equal(ui.status,'done');
  const uiMsgs=(await call('GET',`/api/tasks/${ui.id}/thread`)).body.messages;
  assert.ok(uiMsgs.some(m=>m.sender.name==='Koh Wira'&&/Tambahkan tombol persen/.test(m.text)),'lead review comment is in the staff thread');
  assert.ok(uiMsgs.some(m=>m.sender.name==='Koh Wira'&&/disetujui/i.test(m.text)),'lead approval is in the staff thread');
  // The lead synthesized for the director (and was reviewed by him); the director synthesized for the owner.
  assert.match(all.find(t=>t.id===lead.id).result,/Ringkasan tim engineering/);assert.equal(all.find(t=>t.id===lead.id).status,'done');
  assert.match(all.find(t=>t.id===root.id).result,/Ringkasan akhir untuk owner/);
  // Monitoring: a failing staff subtask is reported to its lead.
  failWork=true;
  const root2=(await call('POST','/api/tasks',{title:'Kalkulator kedua',assignee:'Koh Arman',division:'leadership',asLead:true,brief:'Kalkulator'})).body;
  const lead2=await wait(async()=>(await tasks()).find(t=>t.parentId===root2.id),'second delegation');
  await wait(async()=>(await call('GET',`/api/tasks/${lead2.id}/thread`)).body.messages.some(x=>x.sender.type==='system'&&/Subtugas "Logika kalkulator".*gagal/.test(x.text)),'lead notified of failed subtask',90000);
  console.log('PASS: Direktur→lead→staff delegation, per-result review with one revision, roll-up synthesis, failure monitoring');
 }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
