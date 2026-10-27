// First-run wizard: opens by itself, walks PIN → company → template → divisions → people → AI → summary,
// shows the floor plan preview and saves. Total reset uses its own dialog (no prompt) and offers the archive.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43290),dir=fs.mkdtempSync(path.join(os.tmpdir(),'org-wizard-')),origin=`http://127.0.0.1:${PORT}`;
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'60000'},stdio:['ignore','pipe','inherit']});
const start=new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve();}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
(async()=>{await start;let browser;try{
  browser=await launch();const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let prompted=false;page.on('dialog',d=>{prompted=true;d.dismiss();});
  await page.goto(origin);
  await page.waitForSelector('#wizardDialog[open] [data-step="pin"]:not([hidden])');
  assert.equal(await page.locator('ol.wizard-steps li').count(),7);
  assert.match(await page.locator('ol.wizard-steps li[aria-current=step]').innerText(),/PIN/);
  // Validation: a short PIN does not advance.
  await page.fill('#wizardPin','12');await page.click('#wizardNext');assert.ok(await page.locator('[data-step="pin"]').isVisible());
  await page.fill('#wizardPin','2468');await page.click('#wizardNext');
  await page.waitForSelector('[data-step="company"]:not([hidden])');
  await page.fill('#wizardCompanyName','Toko Maju');await page.selectOption('#wizardCompanyType','Toko & retail');await page.fill('#wizardCompanyDescription','Toko bangunan keluarga.');await page.click('#wizardNext');
  await page.waitForSelector('[data-step="template"]:not([hidden])');
  assert.ok(await page.locator('[data-step="template"] input[value="retail"]').isChecked(),'template suggested from business type');
  await page.check('[data-step="template"] input[value="empty"]');await page.click('#wizardNext');
  await page.waitForSelector('[data-step="divisions"]:not([hidden])');
  assert.equal(await page.locator('[data-step="divisions"] .wizard-row').count(),0);
  await page.click('#wizardAddDivision');await page.fill('[data-step="divisions"] .wizard-row input[name="name"]','Gudang');
  await page.click('#wizardAddDivision');await page.fill('[data-step="divisions"] .wizard-row:nth-child(2) input[name="name"]','Toko');
  // Backtracking through Template must preserve the current draft unless a different template is explicitly selected.
  await page.click('#wizardBack');await page.click('#wizardNext');
  assert.equal(await page.locator('[data-step="divisions"] .wizard-row').count(),2,'backtracking preserves edited divisions');
  await page.click('#wizardNext');
  await page.waitForSelector('[data-step="people"]:not([hidden])');
  // People are added with "+ Orang" and filled in the labelled editor.
  const person=async(i,name,role,division,manager)=>{await page.click('#wizardAddPerson');const editor=page.locator('#wizardPersonEditor');await editor.getByLabel('Nama',{exact:true}).fill(name);await editor.getByLabel('Peran',{exact:true}).fill(role);await editor.getByLabel('Divisi',{exact:true}).selectOption({label:division});await editor.getByLabel('Atasan',{exact:true}).selectOption(manager||'');};
  await person(0,'Andi','Pemilik','Toko');await person(1,'Budi','Kepala Gudang','Gudang','Andi');await person(2,'Citra','Staf Gudang','Gudang','Budi');
  // Leads are required before going on.
  await page.click('#wizardNext');assert.match(await page.locator('#wizardMessage').innerText(),/lead/i);
  await page.click('#wizardBack');
  await page.locator('[data-step="divisions"] .wizard-row').nth(0).locator('select[name="lead"]').selectOption('Budi');
  await page.locator('[data-step="divisions"] .wizard-row').nth(1).locator('select[name="lead"]').selectOption('Andi');
  await page.locator('[data-step="divisions"] .wizard-row').nth(1).locator('input[name="collab"]').check();
  await page.click('#wizardNext');await page.click('#wizardNext');
  await page.waitForSelector('[data-step="agents"]:not([hidden])');
  await page.check('[data-step="agents"] input[data-member="Citra"]');
  // No provider is configured in this test, so the model picker explains where models come from.
  assert.match(await page.locator('[data-step="agents"] select[data-model="Citra"]').innerText(),/Ikuti default/);
  await page.click('#wizardNext');
  await page.waitForSelector('[data-step="summary"]:not([hidden])');
  assert.match(await page.locator('#wizardFloorPlan').innerText(),/Lantai kerja 1: Toko \(1\), Gudang \(2\)/);
  assert.match(await page.locator('[data-step="summary"]').innerText(),/Toko Maju/);
  await page.click('#wizardSave');await page.waitForFunction(()=>!document.querySelector('#wizardDialog').open);
  const saved=await page.evaluate(()=>window.officeTasks.state());
  assert.equal(saved.company.name,'Toko Maju');assert.equal(saved.company.type,'Toko & retail');assert.equal(saved.configured,true);
  assert.deepEqual(saved.divisions.map(d=>[d.name,d.lead]),[['Gudang','Budi'],['Toko','Andi']]);
  assert.equal(saved.members.find(m=>m.name==='Citra').isAgent,true);assert.equal(saved.members.find(m=>m.name==='Citra').manager,'Budi');
  assert.equal(saved.members.find(m=>m.name==='Andi').manager,null);assert.equal(saved.members.find(m=>m.name==='Budi').manager,'Andi');
  assert.deepEqual(saved.divisions.find(d=>d.name==='Toko').collaboratesWith,[saved.divisions.find(d=>d.name==='Gudang').id]);
  // Reload: configured, so no wizard.
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#bLock').disabled);await page.waitForTimeout(500);
  assert.equal(await page.locator('#wizardDialog[open]').count(),0);
  // Susun ulang keeps the current structure unless a template is picked; picking one warns.
  await page.click('#bOrg');await page.click('#orgRearrange');
  await page.waitForSelector('#wizardDialog[open]');
  if(await page.locator('[data-step="pin"]:not([hidden])').count()){await page.fill('#wizardPin','2468');await page.click('#wizardNext');}
  await page.click('#wizardNext');
  assert.ok(await page.locator('[data-step="template"] input[value="keep"]').isChecked());
  await page.check('[data-step="template"] input[value="marketing"]');assert.ok(await page.locator('#wizardReplaceWarning').isVisible());
  await page.check('[data-step="template"] input[value="keep"]');await page.click('#wizardNext');
  assert.equal(await page.locator('[data-step="divisions"] .wizard-row').count(),2);
  await page.click('#wizardCancel');await page.waitForFunction(()=>!document.querySelector('#wizardDialog').open);
  // Total reset: own dialog, PIN + RESET, archive link, then the wizard opens again.
  await page.click('#orgMore');await page.click('text=Setel ulang total');
  await page.waitForSelector('#resetDialog[open]');assert.ok(await page.locator('#resetSubmit').isDisabled());
  await page.fill('#resetPin','2468');await page.fill('#resetConfirm','reset');assert.ok(await page.locator('#resetSubmit').isDisabled());
  await page.fill('#resetConfirm','RESET');await page.click('#resetSubmit');
  await page.waitForSelector('#resetArchive a[download]');
  const archive=await page.locator('#resetArchive a[download]').getAttribute('href');assert.match(archive,/^blob:/);
  await page.click('#resetContinue');await page.waitForSelector('#wizardDialog[open]');
  assert.equal(prompted,false,'no prompt()/confirm() dialogs');
  assert.deepEqual(errors,[]);
  console.log('PASS: first-run wizard steps, validation, floor plan preview, save, Susun ulang keep/replace, reset dialog with archive');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
