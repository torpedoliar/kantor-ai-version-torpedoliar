// A lost write response must not be retried blindly: a plain POST /api/tasks can create duplicates.
// The server processes the first request; the browser sees a failed connection and reports it.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43547),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-retry-')),origin=`http://127.0.0.1:${PORT}`;
(async()=>{
  const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,5).toString('base64')},stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('exit '+code)));});
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken','')}catch{}});
    await page.goto(origin);
    await page.waitForFunction(()=>window.officeTasks&&!document.getElementById('bLock').disabled,null,{timeout:90000});
    let posts=0;
    await page.route('**/api/tasks',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      posts++;
      if(posts===1){
        // Let the server create the task, then hide the response from the page.
        await route.fetch().catch(()=>null);
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.click('#bTasks');
    await page.waitForSelector('#taskCreate',{state:'visible'});
    await page.click('#taskCreate');
    await page.fill('#taskTitle','Tugas koneksi putus');
    await page.selectOption('#taskAssignee','Koh Wira');
    await page.click('#taskCreateForm button[type="submit"]');
    await page.waitForFunction(()=>document.getElementById('taskFeedback').textContent.includes('Koneksi terputus'),null,{timeout:15000});
    await page.waitForTimeout(1200);
    assert.equal(posts,1,'a write without an idempotency key is not retried');
    const tasks=(await (await fetch(origin+'/api/tasks')).json()).filter(task=>task.title==='Tugas koneksi putus');
    assert.equal(tasks.length,1,'the server created exactly one task');
    assert.deepEqual(errors,[]);
    console.log('PASS: a lost POST response is reported once, not retried into a duplicate task');
  }finally{if(browser)await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
