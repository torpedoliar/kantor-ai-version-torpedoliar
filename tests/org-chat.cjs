const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const PORT=Number(process.env.TEST_PORT||43193),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-org-chat-')),origin=`http://127.0.0.1:${PORT}`;
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'5000'},stdio:['ignore','pipe','inherit']});
const start=new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve();}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
const request=async(pathname,options={})=>{const response=await fetch(origin+pathname,options);return {status:response.status,body:await response.json().catch(()=>null)};};
(async()=>{await start;let browser;try{
  const session=await request('/api/session');const csrf=session.body.csrf;const headers={'content-type':'application/json','origin':origin,'x-kantor-csrf':csrf};
  const create=await request('/api/tasks',{method:'POST',headers,body:JSON.stringify({title:'Chat task',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'manual',brief:'Follow up the campaign.'})});
  assert.equal(create.status,201);
  const message=await request(`/api/tasks/${create.body.id}`,{method:'PATCH',headers,body:JSON.stringify({message:{by:'Kak Rani',text:'<script>window.__chatXss=1</script> add price',at:'not trusted'},version:create.body.version})});
  assert.equal(message.status,200);assert.deepEqual(message.body.messages,[{by:'Kak Rani',text:'<script>window.__chatXss=1</script> add price',at:message.body.messages[0].at}]);
  const stale=await request(`/api/tasks/${create.body.id}`,{method:'PATCH',headers,body:JSON.stringify({progressPct:40,version:create.body.version})});assert.equal(stale.status,409);
  const progress=await request(`/api/tasks/${create.body.id}`,{method:'PATCH',headers,body:JSON.stringify({progressPct:140,version:message.body.version})});assert.equal(progress.status,200);assert.equal(progress.body.progressPct,100);
  browser=await launch({headless:true});const page=await browser.newPage().then(skipWizard);await page.goto(origin);await page.click('#bTasks');await page.waitForFunction(()=>document.querySelector('#taskList')?.textContent.includes('<script>window.__chatXss=1</script> add price'));
  assert.equal(await page.evaluate(()=>window.__chatXss||false),false);assert.equal(await page.locator('.task-message').count(),1);assert.equal(await page.locator('.task-progress').getAttribute('aria-valuenow'),'100');
  console.log('PASS: task chat/progress API version guard and safe text rendering');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
