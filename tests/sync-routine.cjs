// The saved routine preference applies after reload, another tab's org edit reaches this tab,
// and a hidden tab stops polling until it becomes visible again.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{launch}=require('./browser.cjs');
const PORT=43648,origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-sync-routine-'));
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,16).toString('base64')},stdio:['ignore','pipe','ignore']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
const wait=async(fn,label,ms=12000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await ready;let browser;try{
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;
  const headers={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
  const token=(await(await fetch(origin+'/api/org/unlock',{method:'POST',headers,body:JSON.stringify({pin:'2468'})})).json()).token;
  const owner={...headers,'x-kantor-org':token};
  const rename=async name=>{const org=await (await fetch(origin+'/api/org',{headers})).json();const response=await fetch(origin+'/api/org',{method:'PUT',headers:owner,body:JSON.stringify({...org,version:org.version,divisions:org.divisions.map(d=>d.id==='marketing'?{...d,name}:d)})});assert.equal(response.status,200);};
  browser=await launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:860}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
  await page.goto(origin);await page.waitForFunction(()=>window.officeScene&&!document.getElementById('bLock').disabled,null,{timeout:90000});
  // Routine preference: uncheck, save, and confirm it survives a reload.
  await page.evaluate(()=>officeSettings.open());await page.locator('#settingsRoutine').uncheck();await page.click('#settingsGeneralSave');
  await page.waitForFunction(()=>officeScene.snapshot().routine===false);
  await page.evaluate(()=>document.getElementById('settingsDialog').close());
  await page.reload();await page.waitForFunction(()=>window.officeScene&&!document.getElementById('bLock').disabled,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>officeScene.snapshot().routine),false,'routine stays off after reload');
  // A second tab follows org changes from the first (server) without a reload.
  const second=await context.newPage();await second.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
  await second.goto(origin);await second.waitForFunction(()=>window.officeScene&&!document.getElementById('bLock').disabled,null,{timeout:90000});
  await rename('Marketing Baru');
  await wait(()=>second.evaluate(()=>window.officeTasks?.state?.().divisions.find(d=>d.id==='marketing')?.name==='Marketing Baru'),'org change reaches the second tab');
  // Hidden: the poll pauses; after visibility returns it catches up.
  await second.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await rename('Marketing Tersembunyi');
  await new Promise(resolve=>setTimeout(resolve,3200));
  assert.equal(await second.evaluate(()=>window.officeTasks.state().divisions.find(d=>d.id==='marketing').name),'Marketing Baru','a hidden tab does not poll');
  await second.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await wait(()=>second.evaluate(()=>window.officeTasks.state().divisions.find(d=>d.id==='marketing').name==='Marketing Tersembunyi'),'visible tab catches up');
  assert.deepEqual(errors,[]);
  console.log('PASS: routine preference persists, org edits sync between tabs, and hidden polling pauses until visible');
}finally{if(browser)await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
