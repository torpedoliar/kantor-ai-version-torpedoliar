// "Mulai dari 0 — disusun AI": the chosen model drafts divisions, people, managers and effort from the company profile.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.TEST_PORT||43305),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-ai-draft-')),origin=`http://127.0.0.1:${PORT}`;
let reply='',seen=null,replyQueue=[];
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{seen=JSON.parse(raw||'{}');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:replyQueue.length?replyQueue.shift():reply}}]}));});});
const draft={divisions:[{id:'leadership',name:'Leadership',lead:'Sari',collaboratesWith:['ops']},{id:'ops',name:'Operasional',lead:'Joko',collaboratesWith:[]}],
  members:[{name:'Sari',role:'Direktur',division:'leadership',manager:null,effort:'deep'},{name:'Joko',role:'Kepala Operasional',division:'ops',manager:'Sari',effort:'standard'},{name:'Rina',role:'Staf Gudang',division:'ops',manager:'Joko',effort:'light'}]};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,5).toString('base64')},stdio:['ignore','pipe','inherit']});
  await new Promise((res,rej)=>{let ok=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ok=true;res();}});child.on('exit',c=>{if(!ok)rej(new Error('server exited '+c));});});
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
    const settings=(await call('GET','/api/settings')).body;
    const provider={id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'mock-model',source:'manual',status:'verified',enabled:true}],credential:'k'};
    assert.equal((await call('PUT','/api/settings',{version:settings.version,providers:[provider],defaultRoute:null,fallbackRoute:null,overrides:{}})).status,200);
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    const company={name:'Toko Maju',type:'Toko & retail',description:'Toko bangunan dengan gudang dan pengiriman.'};
    const route={providerId:'mock',modelId:'mock-model'};
    assert.equal((await call('POST','/api/org/ai-draft',{company,route})).status,403,'owner only');
    // The model wraps JSON in prose and a code fence; the server still finds it.
    reply='Berikut usulan:\n```json\n'+JSON.stringify(draft)+'\n```';
    const ok=await call('POST','/api/org/ai-draft',{company,route},owner);
    assert.equal(ok.status,200,JSON.stringify(ok.body));
    assert.equal(seen.model,'mock-model');assert.match(JSON.stringify(seen.messages),/Toko bangunan/);assert.ok(seen.max_tokens>=8000,'organization output has enough token budget');assert.equal(seen.stream,false,'use OpenAI non-streaming chat');
    assert.deepEqual(ok.body.divisions.map(d=>d.lead),['Sari','Joko']);
    assert.deepEqual(ok.body.members.map(m=>[m.name,m.manager,m.effort,m.isAgent]),[['Sari',null,'deep',true],['Joko','Sari','standard',true],['Rina','Joko','light',true]]);
    assert.equal((await call('GET','/api/org')).body.members.length,13,'drafting saves nothing');
    replyQueue=['{"divisions":[',JSON.stringify(draft)];
    const repaired=await call('POST','/api/org/ai-draft',{company,route},owner);assert.equal(repaired.status,200,'one correction request recovers a truncated answer');assert.match(JSON.stringify(seen.messages),/previous response could not be used/);
    // A broken org (cycle) or non-JSON answer is rejected with a readable message.
    reply=JSON.stringify({...draft,members:draft.members.map(m=>m.name==='Sari'?{...m,manager:'Rina'}:m)});
    const cycle=await call('POST','/api/org/ai-draft',{company,route},owner);assert.equal(cycle.status,422);assert.match(cycle.body.error,/AI/);
    reply='Maaf, saya tidak bisa.';
    assert.equal((await call('POST','/api/org/ai-draft',{company,route},owner)).status,422);
    assert.equal((await call('POST','/api/org/ai-draft',{company,route:{providerId:'mock',modelId:'nope'}},owner)).status,400);
    // Wizard: "Mulai dari 0 — disusun AI" fills divisions and people, every agent gets the builder model.
    reply=JSON.stringify(draft);
    const {launch}=require('./browser.cjs');const browser=await launch();
    try{
      const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#bLock').disabled);
      // A PIN session left over from before a server restart: the wizard skips the PIN step at first,
      // then asks for the PIN when the server rejects it and returns to the step the owner was on.
      await page.evaluate(()=>sessionStorage.setItem('kantor-ai.orgToken','stale-from-before-restart'));await page.reload();await page.waitForFunction(()=>!document.querySelector('#bLock').disabled);
      await page.click('#bOrg');await page.click('#orgRearrange');await page.waitForSelector('#wizardDialog[open]');
      assert.equal(await page.locator('[data-step="pin"]:not([hidden])').count(),0,'stale session skips the PIN step at first');
      await page.fill('#wizardCompanyName','Toko Maju');await page.fill('#wizardCompanyDescription','Toko bangunan dengan gudang dan pengiriman.');await page.click('#wizardNext');
      await page.check('[data-step="template"] input[value="ai"]');await page.selectOption('#wizardAiModel',{label:'Mock · mock-model'});await page.click('#wizardNext');
      await page.waitForSelector('[data-step="pin"]:not([hidden])');assert.match(await page.locator('#wizardMessage').innerText(),/PIN/);
      assert.doesNotMatch(await page.locator('#wizardMessage').innerText(),/valid owner unlock/);
      await page.fill('#wizardPin','2468');await page.click('#wizardNext');
      await page.waitForSelector('[data-step="template"]:not([hidden])');
      assert.ok(await page.locator('[data-step="template"] input[value="ai"]').isChecked(),'returns to the AI template choice');
      assert.ok(await page.locator('#wizardReplaceWarning').isVisible(),'AI draft replaces the current structure');
      await page.selectOption('#wizardAiModel',{label:'Mock · mock-model'});if(process.env.SHOT)await page.screenshot({path:'.superpowers/shots/wizard-ai-template.png'});await page.click('#wizardNext');
      await page.waitForSelector('[data-step="divisions"]:not([hidden])');
      assert.equal(await page.locator('[data-step="divisions"] .wizard-row').count(),2);
      await page.click('#wizardNext');assert.equal(await page.locator('[data-step="people"] .wizard-person').count(),3);
      await page.click('#wizardNext');
      assert.equal(await page.locator('[data-step="agents"] input[data-member]:checked').count(),3,'every drafted person is an agent');
      assert.deepEqual(await page.locator('[data-step="agents"] select[data-model]').evaluateAll(s=>s.map(x=>x.value)),Array(3).fill('mock|mock-model'),'one model for everyone');
      await page.click('#wizardNext');await page.click('#wizardSave');await page.waitForFunction(()=>!document.querySelector('#wizardDialog').open);
      const st=(await call('GET','/api/settings')).body;assert.deepEqual(Object.keys(st.overrides).sort(),['Joko','Rina','Sari']);
      assert.equal((await call('GET','/api/org')).body.members.find(m=>m.name==='Rina').effort,'light');
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
    console.log('PASS: AI org draft is owner-only, uses the chosen model, parses fenced JSON, validates the graph, saves nothing until the wizard does, and seeds one model for every agent');
  }finally{child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
