// Per-member models and the "Needs decision" flow, on a throwaway dry-run server.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const PORT=Number(process.env.TEST_PORT||4185),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-'));
let csrf='';
const api=async(p,opts={})=>{const headers={'content-type':'application/json','origin':`http://127.0.0.1:${PORT}`,...(opts.headers||{})};if(csrf)headers['x-kantor-csrf']=csrf;const response=await fetch(`http://127.0.0.1:${PORT}${p}`,{...opts,headers});return {status:response.status,body:await response.json().catch(()=>null)}};
(async()=>{
 const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'800'},stdio:['ignore','pipe','inherit']});
 await new Promise(r=>server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r()));
 const browser=await launch();
 try{
  const session=(await api('/api/session')).body;csrf=session.csrf;
  const members=(await api('/api/agents')).body.members;
  assert.equal(members['Kak Rani'].model,'claude-sonnet-5-5');assert.equal(members['Kak Sinta'].model,'claude-haiku-4-5-20251001');
  const page=await browser.newPage({viewport:{width:1440,height:900}}).then(skipWizard),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}`);await page.waitForFunction(()=>window.officeScene);
  await page.waitForFunction(()=>document.querySelectorAll('.name-label.ai').length===2);
  // An almost empty brief makes the agent ask instead of guessing.
  await page.click('#bTasks');await page.click('#taskCreate');await page.fill('#taskTitle','Caption for the launch');await page.selectOption('#taskAssignee','Kak Rani');await page.check('input[name="taskMode"][value="direct"]');await page.click('#taskCreateForm .task-primary');await page.click('#closeTasks');
  await page.locator('#decisions').waitFor({state:'visible',timeout:20000});
  assert.match(await page.locator('#decisions').innerText(),/Keputusan\s*1/);assert.match(await page.locator('#decisions').getAttribute('aria-label'),/1 tugas menunggu keputusanmu · KR/);
  assert.match(await page.locator('#logList').innerText(),/KR butuh keputusan sebelum lanjut/);
  // Keputusan opens the waiting question in Komunikasi; answering needs the owner unlock.
  await page.click('#decisions');await page.locator('#pinDialog[open]').waitFor();await page.fill('#orgPin','2468');await page.click('#pinSubmit');
  const card=page.locator('#messageTimeline .decision-card[data-status="open"]');await card.waitFor();assert.match(await card.innerText(),/who is this for/);
  await page.fill('#decisionAnswer','For our Instagram followers: the new iced coffee menu, launch on Friday.');await page.getByRole('button',{name:'Kirim & lanjutkan'}).click();
  await page.waitForFunction(()=>document.getElementById('decisions').hidden);
  const kn=await (async()=>{for(let i=0;i<40;i++){const t=(await api('/api/tasks')).body.find(t=>t.assignee==='Kak Rani');if(t.status==='review')return t;await new Promise(r=>setTimeout(r,250));}})();
  assert.ok(kn,'answered task is drafted');assert.match(kn.brief,/Answers:\nFor our Instagram/);
  // A second member with its own model drafts normally.
  const parentResponse=await api('/api/tasks',{method:'POST',body:JSON.stringify({title:'Service root',assignee:'Gilang',division:'service',asLead:true,brief:'Coordinate service response.'})});assert.equal(parentResponse.status,201);const parent=parentResponse.body;assert.ok(parent.id);
  const ownerUnlock=await api('/api/org/unlock',{method:'POST',body:JSON.stringify({pin:'2468'})});assert.equal(ownerUnlock.status,200);
  const madeResponse=await api('/api/tasks',{method:'POST',headers:{'x-kantor-org':ownerUnlock.body.token},body:JSON.stringify({title:'Reply about a late order',assignee:'Kak Sinta',division:'service',parentId:parent.id,asLead:false,brief:'Order 1042 arrived two days late; customer is upset.'})});assert.equal(madeResponse.status,201);const made=madeResponse.body;
  for(let i=0;i<40&&(await api('/api/tasks')).body.find(t=>t.id===made.id).status!=='review';i++)await new Promise(r=>setTimeout(r,250));
  assert.equal((await api('/api/tasks')).body.find(t=>t.id===made.id).status,'review');
  assert.equal((await api(`/api/tasks/${kn.id}`,{method:'PATCH',body:JSON.stringify({action:'answer',answer:'x',version:kn.version})})).status,409,'only blocked tasks take answers');
  assert.deepEqual(errors,[]);
  console.log('PASS: per-member models, agent asks instead of guessing, Needs decision banner and filter, answer resumes the task, second AI member drafts');
 }finally{await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
