// Organization flowchart: colored division boxes, side panel tabs, drag to re-parent, cycle guard,
// collaboration links, escaped names and the conflict reload path.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const PORT=43302,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-org-chart-')),origin=`http://127.0.0.1:${PORT}`;
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'60000'},stdio:['ignore','pipe','inherit']});
const start=new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve();}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
const overlap=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
async function dragTo(page,from,to){
  const a=await page.locator(from).boundingBox(),b=await page.locator(to).boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+12,a.y+a.height/2+12,{steps:3});
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();
}
const member=(page,name)=>page.evaluate(n=>window.officeTasks.state().members.find(m=>m.name===n),name);
(async()=>{await start;let browser;try{
  browser=await launch();const page=await browser.newPage({viewport:{width:1440,height:900}}).then(skipWizard),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.officeScene&&!document.querySelector('#bLock').disabled);
  await page.click('#bOrg');
  await page.waitForSelector('.org-box[data-division="engineering"] .org-card[data-member="Koh Wira"].is-lead');
  assert.match(await page.locator('#orgPanel').innerText(),/terkunci/i,'locked banner while viewing');
  assert.equal(await page.locator('.org-card').count(),13);
  assert.equal(await page.locator('#orgPanel .org-member-editor, #orgPanel .org-add-form').count(),0,'old per-member forms are gone');
  assert.equal(await page.locator('.org-card[data-member="Kak Rani"].is-ai').count(),1);
  const rects=await page.$$eval('.org-box',boxes=>boxes.map(b=>b.getBoundingClientRect().toJSON()));
  for(const a of rects)for(const b of rects)if(a!==b)assert.ok(!overlap(a,b),'division boxes never overlap');
  // Clicking while locked still opens the panel; saving asks for the PIN.
  await page.click('.org-card[data-member="Kak Dewi"]');await page.waitForSelector('#orgSide [role=tab]');
  assert.deepEqual(await page.locator('#orgSide [role=tab]').allInnerTexts(),['Profil','Kerja','AI']);
  await page.getByRole('tab',{name:'Kerja'}).click();await page.fill('#orgSideWorkload','60');await page.click('#orgSideSave');
  await page.locator('#pinDialog').waitFor({state:'visible'});await page.fill('#orgPin','2468');await page.click('#pinSubmit');
  await page.waitForFunction(()=>window.officeTasks.state().members.find(m=>m.name==='Kak Dewi').workloadPct===60);
  assert.doesNotMatch(await page.locator('.org-toolbar').innerText(),/terkunci/i);
  // Drag onto a card in another division: new manager and division.
  await dragTo(page,'.org-card[data-member="Tari"]','.org-card[data-member="Gilang"]');
  await page.getByRole('button',{name:'Terapkan perpindahan',exact:true}).click();
  await page.waitForFunction(()=>{const t=window.officeTasks.state().members.find(m=>m.name==='Tari');return t.manager==='Gilang'&&t.division==='service';});
  await page.waitForSelector('.org-box[data-division="service"] .org-card[data-member="Tari"]');
  // Dragging a manager under their own report is refused locally.
  const version=await page.evaluate(()=>window.officeTasks.state().version);
  await dragTo(page,'.org-card[data-member="Koh Arman"]','.org-card[data-member="Bagas Pratama Putra"]');
  await page.waitForSelector('.org-card[data-member="Koh Arman"] .org-card-error');
  assert.match(await page.locator('.org-card[data-member="Koh Arman"] .org-card-error').innerText(),/siklus/);
  assert.equal(await page.evaluate(()=>window.officeTasks.state().version),version,'no save on a cycle');
  // A short press is a click, not a drag.
  await page.click('.org-card[data-member="Yoga"]');await page.waitForFunction(()=>document.querySelector('#orgSide h3')?.textContent==='Yoga');
  // Collaboration mode links two division boxes.
  await page.click('#orgConnect');await page.click('.org-box[data-division="marketing"] .org-box-title');await page.click('.org-box[data-division="service"] .org-box-title');
  await page.waitForSelector('path.org-collab');
  assert.deepEqual((await page.evaluate(()=>window.officeTasks.state().divisions.find(d=>d.id==='marketing').collaboratesWith)),['service']);
  // Division panel: new division, escaped name, area name.
  await page.click('#orgAddDivision');await page.fill('#orgSideName','<b>Riset</b>');await page.fill('#orgSideArea','Lab');await page.click('#orgSideSave');
  await page.waitForFunction(()=>window.officeTasks.state().divisions.some(d=>d.name==='<b>Riset</b>'&&d.areaName==='Lab'&&d.lead===''));
  assert.equal(await page.locator('.org-box-title b').count(),0,'division name is escaped');
  const rId=await page.evaluate(()=>window.officeTasks.state().divisions.find(d=>d.name==='<b>Riset</b>').id);
  assert.match(await page.locator(`.org-box[data-division="${rId}"]`).innerText(),/Belum ada lead/);
  // The first person in an empty division becomes its lead, so + Orang is usable there.
  await page.click('#orgAddPerson');
  await page.waitForFunction(id=>{const s=officeTasks.state(),d=s.divisions.find(d=>d.id===id);return d.lead&&s.members.some(m=>m.name===d.lead&&m.division===id);},rId);
  // Change a division lead from its panel.
  await page.click('.org-box[data-division="service"] .org-box-title');await page.selectOption('#orgSideLead','Kak Sinta');await page.click('#orgSideSave');
  await page.waitForFunction(()=>window.officeTasks.state().divisions.find(d=>d.id==='service').lead==='Kak Sinta');
  // Deactivating someone with open tasks offers reassignment.
  await page.evaluate(async()=>{const h={'content-type':'application/json','x-kantor-csrf':window.officeTasks.csrf(),'x-kantor-org':sessionStorage.getItem('kantor-ai.orgToken')};const root=await fetch('/api/tasks',{method:'POST',headers:h,body:JSON.stringify({title:'Root',assignee:'Kak Rani',division:'marketing',asLead:true,brief:'b'})}).then(r=>r.json());await fetch('/api/tasks',{method:'POST',headers:h,body:JSON.stringify({title:'Busy work',assignee:'Mira',division:'marketing',parentId:root.id,brief:'b'})});});
  await page.click('.org-card[data-member="Mira"]');await page.click('#orgSideToggleActive');
  await page.waitForSelector('#orgBusy');assert.match(await page.locator('#orgBusy').innerText(),/Busy work/);
  await page.selectOption('#orgBusyTarget','Kak Dewi');await page.click('#orgReassign');
  await page.waitForFunction(()=>window.officeTasks.state().members.find(m=>m.name==='Mira').active===false);
  await page.waitForSelector('.org-card[data-member="Mira"].is-inactive');
  // Another tab bumps the version: the next save reloads instead of overwriting.
  await page.evaluate(()=>fetch('/api/org',{method:'PUT',headers:{'content-type':'application/json','x-kantor-csrf':window.officeTasks.csrf(),'x-kantor-org':sessionStorage.getItem('kantor-ai.orgToken')},body:JSON.stringify(window.officeTasks.state())}));
  await page.click('.org-card[data-member="Yoga"]');await page.getByRole('tab',{name:'Kerja'}).click();await page.fill('#orgSideWorkload','40');await page.click('#orgSideSave');
  await page.waitForFunction(()=>document.querySelector('#orgPanel').textContent.includes('dimuat ulang'));
  assert.notEqual((await member(page,'Yoga')).workloadPct,40);
  await page.getByRole('tab',{name:'Profil perusahaan',exact:true}).click();await page.fill('#orgCompanyName','Kantor Uji');await page.getByRole('button',{name:'Simpan profil',exact:true}).click();await page.waitForFunction(()=>officeTasks.state().company.name==='Kantor Uji');await page.getByRole('tab',{name:'Bagan',exact:true}).click();
  // Zoom keeps the chart usable.
  await page.click('#orgZoomOut');assert.match(await page.locator('#orgZoomLabel').innerText(),/90%/);await page.click('#orgTidy');assert.match(await page.locator('#orgZoomLabel').innerText(),/100%/);
  assert.deepEqual(errors,[]);
  // Mobile: the panel becomes a bottom sheet and the canvas stays visible.
  // Keep the selected Yoga panel open while resizing; other cards may be outside the phone's panned canvas.
  await page.setViewportSize({width:390,height:844});
  const side=await page.locator('#orgSide').boundingBox();assert.ok(side.y>844/3,'side panel sits at the bottom on phones');
  console.log('PASS: org flowchart boxes, panel tabs, drag re-parent, cycle guard, collaboration, division panel, busy reassign, conflict reload, zoom, mobile sheet');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
