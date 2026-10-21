const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const PORT=43194,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-org-kanban-')),origin=`http://127.0.0.1:${PORT}`;
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'5000'},stdio:['ignore','pipe','inherit']});
const start=new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve();}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
const api=async(pathname,options={})=>{const response=await fetch(origin+pathname,options);return {status:response.status,body:await response.json().catch(()=>null)};};
(async()=>{await start;let browser;try{
  const session=await api('/api/session');const headers={'content-type':'application/json','origin':origin,'x-kantor-csrf':session.body.csrf};
  const legacy=await api('/api/tasks/import',{method:'POST',headers,body:JSON.stringify([{id:'00000000-0000-4000-8000-000000000001',title:'Unassigned legacy',assignee:'Old prototype',status:'queued',brief:'Old task',result:'',createdAt:new Date().toISOString()}])});assert.equal(legacy.status,201);
  const parent=await api('/api/tasks',{method:'POST',headers,body:JSON.stringify({title:'Marketing launch',assignee:'Kak Rani',division:'marketing',asLead:true,priority:'high',brief:'Coordinate launch work.'})});assert.equal(parent.status,201);
  browser=await launch({headless:true});const page=await browser.newPage().then(skipWizard);await page.goto(origin);const unlocked=await api('/api/org/unlock',{method:'POST',headers,body:JSON.stringify({pin:'2468'})});assert.equal(unlocked.status,200);await page.evaluate(token=>sessionStorage.setItem('kantor-ai.orgToken',token),unlocked.body.token);await page.reload();await page.click('#bTasks');
  // One global board with four columns; the legacy unassigned task is still shown once.
  assert.equal(await page.locator('#taskBoard [data-column]').count(),4);assert.equal(await page.locator('.task-card[data-task-id]').count(),2);assert.equal(await page.locator('#rosterPanel').count(),0,'no duplicated roster inventory');
  await page.locator(`.task-card[data-task-id="${parent.body.id}"] .task-card-open`).click();
  const detail=page.locator('#taskDetail');await detail.getByRole('button',{name:'Pecah',exact:true}).click();await detail.locator('.split-form').waitFor();await detail.locator('.split-form input[ name="title" ]').fill('Draft launch copy');await detail.locator('.split-form button[type="submit"]').click();
  await page.waitForFunction(async id=>(await fetch('/api/tasks').then(response=>response.json())).some(task=>task.parentId===id),parent.body.id);
  const childId=(await api('/api/tasks')).body.find(task=>task.parentId===parent.body.id).id;
  await page.locator(`.task-card[data-task-id="${childId}"] .task-root-link`,{hasText:'Marketing launch'}).waitFor();
  await page.locator('.owner-summary-wrap summary').click();assert.equal(await page.locator('.owner-summary').count(),1);assert.equal(await page.locator('.owner-summary button').count(),0);
  console.log('PASS: global four-column board, Split parent linkage and read-only owner summary');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
