const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const APP_PORT=Number(process.env.TEST_PORT||43651),secret='sentinel-browser-key',dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-settings-ui-'));
const origin=`http://127.0.0.1:${APP_PORT}`;
function listen(server,host='127.0.0.1'){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,()=>resolve(server.address().port));});}
function startApp(){
  const key=Buffer.alloc(32,9).toString('base64');
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(APP_PORT),DATA_DIR:dataDir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:key,DRY_RUN_DELAY_MS:'20'},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let output='';child.stdout.on('data',data=>{output+=String(data);if(output.includes('Kantor Kita:'))resolve(child)});child.stderr.on('data',data=>{output+=String(data)});child.on('exit',code=>reject(new Error(`server exited ${code}: ${output}`)));});
}
(async()=>{
  const mock=http.createServer((req,res)=>{if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'mock-model',name:'Mock model'}]}));return;}res.writeHead(404);res.end();});
  const mockPort=await listen(mock);
  const app=await startApp();
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}).then(skipWizard),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.locator('#railMore').evaluate(node=>node.open=true);await page.locator('#bSettings').click();await page.locator('#settingsDialog').waitFor({state:'visible'});
    await page.fill('#providerName','Local mock');await page.selectOption('#providerProtocol','openai');await page.fill('#providerBaseUrl',`http://127.0.0.1:${mockPort}`);await page.fill('#providerCredential',secret);await page.getByRole('button',{name:'Simpan provider',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#settingsMessage').textContent==='Provider disimpan.');
    assert.match(await page.locator('#settingsProviders').innerText(),/Kredensial tersimpan/);
    const browserData=await page.evaluate(()=>JSON.stringify({...localStorage}));assert.equal(browserData.includes(secret),false,'API key must not enter browser storage');
    const saved=await page.evaluate(()=>fetch('/api/settings').then(response=>response.json()));assert.equal(saved.providers.length,1);assert.equal(saved.providers[0].hasCredential,true);assert.equal(JSON.stringify(saved).includes(secret),false);
    await page.getByRole('button',{name:'Ambil model',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#settingsMessage').textContent.includes('model'));
    // The status line can show 'model' before the fetched list is saved; wait for the saved list itself.
    let fetched;for(let i=0;i<50;i++){fetched=await page.evaluate(()=>fetch('/api/settings').then(response=>response.json()));if(fetched.providers[0]?.models?.length)break;await page.waitForTimeout(100);}assert.deepEqual(fetched.providers[0].models.map(model=>model.id),['mock-model']);
    // Fetched models are listed and usable: pick the default route without hand-enabling anything.
    assert.match(await page.locator('#settingsProviders').innerText(),/1 model/);
    assert.match(await page.locator('#routeDefault').innerText(),/Local mock · Mock model/);await page.selectOption('#routeDefault',{label:'Local mock · Mock model'});await page.getByRole('button',{name:'Simpan routing',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#settingsMessage').textContent.includes('Routing disimpan'));
    const routed=await page.evaluate(()=>fetch('/api/settings').then(response=>response.json()));assert.equal(routed.defaultRoute.modelId,'mock-model');assert.equal(routed.providers[0].models[0].enabled,true);
    // Per-agent model from the organization chart AI tab: unlock, pick a model for Kak Rani, saved as a settings override.
    await page.evaluate(()=>sessionStorage.removeItem('kantor-ai.wizardSnoozed'));await page.locator('#settingsClose').click();
    await page.click('#bOrg');await page.click('.org-card[data-member="Kak Rani"]');await page.getByRole('tab',{name:'AI'}).click();
    assert.match(await page.locator('#orgSideModel').innerText(),/Local mock · Mock model/);
    await page.selectOption('#orgSideModel',{label:'Local mock · Mock model'});await page.click('#orgSideSave');
    await page.locator('#pinDialog').waitFor({state:'visible'});await page.fill('#orgPin','2468');await page.click('#pinSubmit');
    await page.waitForFunction(async()=>(await fetch('/api/settings').then(r=>r.json())).overrides['Kak Rani']?.modelId==='mock-model');
    assert.equal((await page.evaluate(()=>fetch('/api/agents').then(r=>r.json()))).members['Kak Rani'].model,'mock-model');
    await page.locator('#closeOrg').click();await page.locator('#railMore').evaluate(node=>node.open=true);await page.locator('#bSettings').click();await page.locator('#settingsDialog').waitFor({state:'visible'});
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Ekspor pengaturan aman',exact:true}).click();const download=await downloadPromise;const exported=fs.readFileSync(await download.path(),'utf8');assert.equal(exported.includes(secret),false,'export must not contain API key');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reset provider dan routing',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#settingsMessage').textContent.includes('direset'));
    const reset=await page.evaluate(()=>fetch('/api/settings').then(response=>response.json()));assert.equal(reset.providers.length,0);assert.deepEqual(errors,[]);
    console.log('PASS: Settings UI saves provider, fetches models, redacts/export-protects key, resets, and has no page errors');
  }finally{await browser.close();app.kill();await new Promise(resolve=>mock.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
