// One-gate manager review on the org model (was the team.json CRUD suite): legacy team.json migrates into org.json,
// staff drafts wait in manager-review, manager approve/reject need the owner unlock, reports of the top go straight
// to review, rename/manager edits flow through PUT /api/org and its cycle guard. Throwaway servers and a mock provider.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43792),origin=`http://127.0.0.1:${PORT}`;
const mock=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'MOCK DRAFT'}}]}));});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
const start=dir=>{const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,1).toString('base64')},stdio:['ignore','pipe','pipe']});
  let err='';child.stderr.on('data',d=>err+=d);
  return new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r(child));child.on('exit',c=>j(Error(`exit ${c}: ${err}`)));});};
const stop=child=>new Promise(r=>{child.once('exit',r);child.kill();});
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 // 1. A bad legacy roster is archived; startup continues with an empty org (no silent seed over it).
 const bad=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-team-bad-'));fs.writeFileSync(path.join(bad,'team.json'),'{broken');
 const badChild=await start(bad);
 try{
   const session=await (await fetch(origin+'/api/session')).json();
   const org=await (await fetch(origin+'/api/org',{headers:{'content-type':'application/json',origin,'x-kantor-csrf':session.csrf}})).json();
   assert.deepEqual(org.members,[],'the empty organization replaces no one silently');
   assert.ok(fs.readdirSync(bad).some(name=>name.startsWith('team.json.corrupt-')),'the corrupt roster is archived');
   assert.ok(fs.existsSync(path.join(bad,'org.json')),'an empty org file is written');
 }finally{await stop(badChild);fs.rmSync(bad,{recursive:true,force:true});}
 // 2. A saved team.json (custom member, AI picks, manager links) becomes org.json; team.json itself is untouched.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-team-'));
 const legacy=require('../server/team').SEED.map(m=>m.n==='Koh Arman'?{...m,ai:{on:true,model:'HomeSonet',system:'Owner prompt'}}:m).concat({manager:'Gilang',n:'Budi',initials:'BD',gender:'male',role:'Support',group:'service',ai:{on:true,model:'m',system:'Budi prompt'}});
 fs.writeFileSync(path.join(dir,'team.json'),JSON.stringify(legacy));const raw=fs.readFileSync(path.join(dir,'team.json'),'utf8');
 let child=await start(dir);
 try{
  assert.equal(fs.readFileSync(path.join(dir,'team.json'),'utf8'),raw,'team.json kept as backup');
  let csrf=(await(await fetch(origin+'/api/session')).json()).csrf,token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const o=(await call('GET','/api/org')).body,mem=n=>o.members.find(m=>m.name===n),lead=id=>o.divisions.find(d=>d.id===id).lead;
  assert.equal(o.members.length,14);assert.equal(mem('Tari').manager,'Kak Dewi');assert.equal(mem('Kak Rani').manager,'Kak Dewi');assert.equal(mem('Koh Arman').manager,null);
  assert.equal(mem('Budi').manager,'Gilang');assert.equal(mem('Budi').isAgent,true);assert.equal(mem('Budi').instructions,'Budi prompt');
  assert.equal(mem('Koh Arman').model,'HomeSonet');assert.equal(mem('Kak Rani').model,'TH/qwen3.8-flash:free');assert.equal(mem('Kak Dewi').isAgent,false);
  assert.deepEqual(['leadership','marketing','engineering','service'].map(lead),['Koh Arman','Kak Dewi','Koh Wira','Gilang']);assert.equal(mem('Koh Wira').division,'engineering');
  // 3. Provider + owner unlock.
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  // 4. Staff (Kak Rani → Kak Dewi → Koh Arman): draft waits for the manager; owner approve is refused until then.
  const root=(await call('POST','/api/tasks',{title:'Launch',assignee:'Kak Dewi',division:'marketing',asLead:true,executionMode:'manual',brief:'Coordinate the launch.'})).body;
  const t=(await call('POST','/api/tasks',{title:'Staff post',assignee:'Kak Rani',division:'marketing',parentId:root.id,brief:'a sufficiently long brief'})).body;assert.ok(t.id,JSON.stringify(t));
  const mr=await wait(async()=>{const x=(await call('GET','/api/tasks')).body.find(x=>x.id===t.id);return x.status==='manager-review'&&x;},'manager-review');
  assert.match(mr.result,/MOCK DRAFT/);
  assert.equal((await call('PATCH',`/api/tasks/${t.id}`,{action:'approve',version:mr.version})).status,409,'no skipping the manager');
  const saved=token;token='';assert.equal((await call('PATCH',`/api/tasks/${t.id}`,{action:'manager-approve',version:mr.version})).status,403,'manager approve needs the owner unlock');token=saved;
  const up=await call('PATCH',`/api/tasks/${t.id}`,{action:'manager-approve',version:mr.version});assert.equal(up.status,200);assert.equal(up.body.status,'review');assert.equal(up.body.managerReviewedBy,'Kak Dewi');
  assert.equal((await call('PATCH',`/api/tasks/${t.id}`,{action:'approve',version:up.body.version})).body.status,'done');
  // 5. Reject needs feedback and sends the draft back to the queue.
  const t2=(await call('POST','/api/tasks',{title:'Staff post 2',assignee:'Kak Rani',division:'marketing',parentId:root.id,brief:'another long brief here'})).body;
  const mr2=await wait(async()=>{const x=(await call('GET','/api/tasks')).body.find(x=>x.id===t2.id);return x.status==='manager-review'&&x;},'manager-review 2');
  assert.equal((await call('PATCH',`/api/tasks/${t2.id}`,{action:'manager-reject',version:mr2.version})).status,400);
  const rej=await call('PATCH',`/api/tasks/${t2.id}`,{action:'manager-reject',feedback:'shorten it',version:mr2.version});assert.equal(rej.body.status,'queued');assert.equal(rej.body.feedback,'shorten it');
  await wait(async()=>(await call('GET','/api/tasks')).body.find(x=>x.id===t2.id).status==='manager-review','redrafted after reject');
  // 6. A report of the top person goes straight to the owner.
  const own=(await call('POST','/api/tasks',{title:'Owner post',assignee:'Koh Arman',division:'leadership',asLead:true,executionMode:'direct',brief:'owner brief long enough'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(x=>x.id===own.id).status==='review','top goes to review');
  // 7. Org edits replace team CRUD: manager cycle rejected, rename cascades to reports.
  let cur=(await call('GET','/api/org')).body;
  assert.equal((await call('PUT','/api/org',{...cur,members:cur.members.map(m=>m.name==='Kak Dewi'?{...m,manager:'Tari'}:m)})).body.code,'ORG_GRAPH_CYCLE');
  const ren=await call('PUT','/api/org',{...cur,divisions:cur.divisions.map(d=>d.lead==='Gilang'?{...d,lead:'Gilang S'}:d),members:cur.members.map(m=>({...m,name:m.name==='Gilang'?'Gilang S':m.name,manager:m.manager==='Gilang'?'Gilang S':m.manager}))});
  assert.equal(ren.status,200);assert.equal(ren.body.members.find(m=>m.name==='Budi').manager,'Gilang S');
  // 8. After restart the migrated org stays (no second migration over edits).
  await stop(child);child=await start(dir);csrf=(await(await fetch(origin+'/api/session')).json()).csrf;token='';
  assert.equal((await call('GET','/api/org')).body.members.find(m=>m.name==='Budi').manager,'Gilang S');
  console.log('PASS: team.json migration, corrupt roster recovery, one-gate manager review with owner unlock, reject, top-to-owner, org cycle/rename, restart keeps org');
 }finally{await stop(child);await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
