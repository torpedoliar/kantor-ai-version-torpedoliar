// Task server: dry-run agent end to end, manual tasks, API guards, persistence and the agent error path.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P1=Number(process.env.TEST_PORT||4181),P2=P1+1,P3=P1+2,P4=P1+3;
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
function start(port,env){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-'));
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'1500',...env},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:'))resolve({child,dir});});child.on('exit',code=>reject(new Error('server exited '+code)));});
}
const csrfBy={};const api=async(port,p,opts={})=>{if(!csrfBy[port])csrfBy[port]=(await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).csrf;return fetch(`http://127.0.0.1:${port}${p}`,{...opts,headers:{'content-type':'application/json','origin':`http://127.0.0.1:${port}`,'x-kantor-csrf':csrfBy[port]}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));};
const waitFor=async(check,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,250));}throw new Error('timed out');};
(async()=>{
 const browser=await launch({headless:true});
 try{
 const one=await start(P1);
 try{
  assert.equal((await api(P1,'/api/agents')).body.mode,'dry-run');
  assert.ok([403,404].includes((await fetch(`http://127.0.0.1:${P1}/..%2fserver%2fserver.js`)).status),'no files outside public/');
  const page=await browser.newPage({viewport:{width:1440,height:900}}).then(skipWizard),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${P1}`);const owner=await api(P1,'/api/org/unlock',{method:'POST',body:JSON.stringify({pin:'2468'})});await page.evaluate(t=>sessionStorage.setItem('kantor-ai.orgToken',t),owner.body.token);await page.reload();await page.waitForFunction(()=>window.officeScene);
  await page.waitForFunction(()=>document.getElementById('taskNote').textContent.includes('dry run'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.name-label.ai')].map(l=>l.textContent).join()),'KR,KS');
  // A task for KR is picked up and finished by the dry-run agent.
  await page.click('#bTasks');await page.click('#taskCreate');await page.fill('#taskTitle','Caption for the new menu');await page.selectOption('#taskAssignee','Kak Rani');await page.check('input[name="taskMode"][value="direct"]');await page.fill('#taskBrief','Friendly, Indonesian');await page.click('#taskCreateForm .task-primary');
  await page.waitForFunction(()=>document.getElementById('taskList').innerText.includes('Hasil dry run'),null,{timeout:20000});
  assert.match(await page.locator('.task-item > .task-result').first().innerText(),/DRY RUN/);
  assert.match(await page.locator('#taskList').innerText(),/Butuh review/);
  const firstDraft=(await api(P1,'/api/tasks')).body.find(t=>t.status==='review');
  await page.locator('textarea[id^="review-"]').fill('Make it shorter and more friendly');
  await page.getByRole('button',{name:'Minta revisi',exact:true}).click();
  await page.waitForFunction(()=>officeTasks.list().some(t=>t.status==='review'&&t.history?.length===2),null,{timeout:20000});
  assert.match(await page.locator('.task-item > .task-result').last().innerText(),/Make it shorter/);
  assert.equal((await api(P1,`/api/tasks/${firstDraft.id}`,{method:'PATCH',headers:{},body:JSON.stringify({action:'approve',version:firstDraft.version})})).status,403,'approving without the owner unlock is refused');
  await page.getByRole('button',{name:'Setujui & selesai',exact:true}).click();
  await page.waitForFunction(()=>officeTasks.list().some(t=>t.status==='done'));
  await page.click('#closeTasks');
  assert.match(await page.locator('#logStats').innerText(),/1\s*selesai/);
  await page.click('#bTasks');
  assert.match(await page.locator('#logList').innerText(),/KR.*Caption for the new menu/);
  assert.match(await page.locator('#logList').innerText(),/KR.*Caption for the new menu/);
  const kn=(await api(P1,'/api/tasks')).body.find(t=>t.assignee==='Kak Rani');
  assert.equal(kn.by,'dry-run');
  assert.equal((await api(P1,`/api/tasks/${kn.id}`,{method:'PATCH',body:JSON.stringify({status:'done',result:'x'})})).status,409,'AI tasks are not finished by hand');
  // Members without an agent keep the manual flow.
  await page.click('#taskCreate');await page.fill('#taskTitle','Plan the quarter');await page.selectOption('#taskAssignee','Koh Arman');await page.click('#taskCreateForm .task-primary');
  await page.locator('.task-item',{hasText:'Plan the quarter'}).getByRole('button',{name:'Mulai tugas'}).click();
  await waitFor(async()=>(await api(P1,'/api/tasks')).body.find(t=>t.title==='Plan the quarter').status==='active');
  await page.locator('.task-item textarea').fill('Unsaved result stays here');
  await page.locator('#taskFilter').focus();
  await api(P1,'/api/tasks',{method:'POST',body:JSON.stringify({title:'Another update',assignee:'Koh Wira',division:'engineering'})});
  await page.waitForFunction(()=>officeTasks.list().some(t=>t.title==='Another update'));
  assert.equal(await page.locator('.task-item textarea').inputValue(),'Unsaved result stays here');
  await page.reload();await page.waitForFunction(()=>window.officeTasks?.list().some(t=>t.title==='Plan the quarter'));
  await page.click('#bTasks');
  assert.equal(await page.locator('.task-item textarea').inputValue(),'Unsaved result stays here');
  assert.deepEqual(errors,[]);
  console.log('PASS: dry-run agent end to end, log entries, manual tasks, API guard, path guard, persistence across reload');
 }finally{one.child.kill();}
 // With a key but an unreachable API, the task returns to the queue with the error and can be retried.
 const two=await start(P2,{ANTHROPIC_API_KEY:'test-key',ANTHROPIC_BASE_URL:'http://127.0.0.1:9'});
 try{
  assert.equal((await api(P2,'/api/agents')).body.mode,'claude');
  const made=(await api(P2,'/api/tasks',{method:'POST',body:JSON.stringify({title:'Will fail',assignee:'Kak Rani',division:'marketing',asLead:false})})).body;
  const failed=await waitFor(async()=>{const t=(await api(P2,'/api/tasks')).body.find(t=>t.id===made.id);return t.error&&t;});
  assert.equal(failed.status,'queued');
  const page=await browser.newPage().then(skipWizard);await page.goto(`http://127.0.0.1:${P2}`);await page.waitForFunction(()=>window.officeScene);
  await page.waitForFunction(()=>document.getElementById('taskNote').textContent.includes('provider LLM'));
  await page.click('#bTasks');await page.getByRole('button',{name:'Coba lagi'}).waitFor();
  console.log('PASS: agent error is shown with Try again, task stays queued');
 }finally{two.child.kill();}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
