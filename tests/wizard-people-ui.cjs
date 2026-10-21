// Wizard "Orang": people grouped by division with their lead, a search, one labelled editor, and edits that survive
// renames, searches and stepping back and forth. Stepper and footer stay visible; only the content scrolls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43571),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-wizard-people-'));
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','inherit']});
const started=new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
// Cards are matched by their name element: other cards mention managers by name.
const LONG='Kepala Produksi Konten Video Pendek dan Siaran Langsung Multi-Platform';
(async()=>{await started;let browser;try{
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf,h={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
  const token=(await (await fetch(origin+'/api/org/unlock',{method:'POST',headers:h,body:JSON.stringify({pin:'2468'})})).json()).token;h['x-kantor-org']=token;
  const org=await (await fetch(origin+'/api/org',{headers:h})).json();
  // 16 people over 4 divisions; Dina has a long role and reports to Dewa (lead of Konten).
  const divisions=[['pimpinan','Pimpinan','Arman'],['konten','Konten','Dewa'],['teknik','Teknik','Wira'],['layanan','Layanan','Gilang']].map(([id,name,lead])=>({id,name,lead,collaboratesWith:[],areaName:''}));
  const people=[['Arman','CEO','pimpinan',null],['Dewa','Lead Konten','konten','Arman'],['Dina',LONG,'konten','Dewa'],['Eka','Penulis','konten','Dewa'],['Fani','Desainer','konten','Dewa'],['Gita','Editor','konten','Dewa'],
    ['Wira','Lead Teknik','teknik','Arman'],['Bagas','Frontend','teknik','Wira'],['Rizky','Backend','teknik','Wira'],['Yoga','QA','teknik','Wira'],['Eko','DevOps','teknik','Wira'],
    ['Gilang','Lead Layanan','layanan','Arman'],['Sinta','CS','layanan','Gilang'],['Laras','CS','layanan','Gilang'],['Tono','Admin','layanan','Gilang'],['Umar','Kurir','layanan','Gilang']];
  const members=people.map(([name,role,division,manager])=>({name,role,division,divisions:[division],manager,active:true,effort:name==='Dina'?'deep':'standard',workloadPct:100,instructions:'',isAgent:name==='Dina',model:null,initials:name.slice(0,2).toUpperCase()}));
  const put=await fetch(origin+'/api/org',{method:'PUT',headers:h,body:JSON.stringify({...org,company:{name:'Studio Kita',type:'Agensi kreatif',description:'Studio konten'},divisions,members})});assert.equal(put.status,200,await put.text());
  browser=await launch({headless:true});
  for(const [width,height] of [[1440,900],[768,900],[390,844]]){
    const page=await browser.newPage({viewport:{width,height}});
    await page.addInitScript(t=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken',t);}catch{}},token);
    await page.goto(origin);await page.waitForFunction(()=>window.OrgWizard&&window.officeTasks);await page.evaluate(()=>window.officeTasks.ready);
    await page.evaluate(()=>window.officeTasks.openOrg());await page.getByRole('button',{name:'Susun ulang'}).click();
    await page.waitForSelector('[data-step="company"]:not([hidden])');await page.click('#wizardNext');await page.click('#wizardNext');await page.click('#wizardNext');
    await page.waitForSelector('[data-step="people"]:not([hidden])');
    // Grouped by division with lead and count; every person once.
    const groups=page.locator('.wizard-division-group');assert.equal(await groups.count(),4);
    assert.match(await groups.nth(1).locator('.wizard-group-head').innerText(),/Konten.*Lead: Dewa.*5 orang/s);
    assert.equal(await page.locator('.wizard-person[data-member-id]').count(),16);
    // Stepper and footer stay on screen; the content area scrolls instead of the dialog.
    const visible=sel=>page.locator(sel).evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;});
    assert.ok(await visible('.wizard-steps'),`stepper visible at ${width}`);assert.ok(await visible('#wizardNext'),`footer visible at ${width}`);
    assert.ok(await page.locator('.wizard-body').evaluate(b=>b.scrollHeight>b.clientHeight),'content scrolls');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    if(process.env.SHOT){await page.locator('.wizard-person').nth(2).click();await page.screenshot({path:`${process.env.SHOT}/t7-${width}.png`});}
    if(width!==1440){await page.close();continue;}
    // Long roles stay readable: full text in the title and in the editor, not crushed into a narrow input.
    const dina=page.locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Dina$/})});assert.equal(await dina.getAttribute('title'),`Dina · ${LONG}`);
    await dina.click();const editor=page.locator('#wizardPersonEditor');
    for(const label of ['Nama','Peran','Divisi','Atasan','Effort'])assert.equal(await editor.getByLabel(label,{exact:true}).count(),1,`labelled ${label}`);
    assert.equal(await editor.getByLabel('Peran',{exact:true}).inputValue(),LONG);
    // Search narrows the list without dropping hidden people.
    await page.fill('#wizardPeopleSearch','dew');assert.deepEqual(await page.locator('.wizard-person:visible strong').allInnerTexts(),['Dewa']);
    await page.locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Dewa$/})}).click();await editor.getByLabel('Nama',{exact:true}).fill('Dewangga');
    await page.fill('#wizardPeopleSearch','');assert.equal(await page.locator('.wizard-person').count(),16,'hidden members kept');
    // Rename follows to the division lead and every report's manager.
    assert.match(await groups.nth(1).locator('.wizard-group-head').innerText(),/Lead: Dewangga/);
    await page.locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Eka$/})}).click();assert.equal(await editor.getByLabel('Atasan',{exact:true}).inputValue(),'Dewangga');
    // Moving Dina to Teknik keeps her effort and agent flag; an inline error appears for an empty name.
    await page.locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Dina$/})}).click();await editor.getByLabel('Divisi',{exact:true}).selectOption('teknik');
    assert.equal(await editor.getByLabel('Effort',{exact:true}).inputValue(),'deep');
    assert.equal(await groups.nth(2).locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Dina$/})}).count(),1);
    await editor.getByLabel('Nama',{exact:true}).fill('');assert.match(await editor.locator('.wizard-field-error').innerText(),/nama/i);
    await editor.getByLabel('Nama',{exact:true}).fill('Dina');
    // Add and remove are explicit controls, separate from the fields.
    await page.click('#wizardAddPerson');assert.equal(await page.locator('.wizard-person').count(),17);
    await editor.getByLabel('Nama',{exact:true}).fill('Vina');await editor.getByLabel('Peran',{exact:true}).fill('Magang');
    await page.locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Umar$/})}).click();await editor.getByRole('button',{name:'Hapus orang ini'}).click();assert.equal(await page.locator('.wizard-person').count(),16);
    // Back and next keep every edit.
    await page.click('#wizardBack');await page.click('#wizardNext');await page.waitForSelector('[data-step="people"]:not([hidden])');
    const names=await page.locator('.wizard-person strong').allInnerTexts();assert.ok(names.includes('Dewangga')&&names.includes('Vina')&&!names.includes('Umar')&&!names.includes('Dewa'));
    assert.equal(await page.locator('.wizard-division-group').nth(2).locator('.wizard-person').filter({has:page.locator('strong',{hasText:/^Dina$/})}).count(),1);
    // The draft goes to the agents step intact: Dina is still an agent.
    await page.click('#wizardNext');await page.waitForSelector('[data-step="agents"]:not([hidden])');assert.ok(await page.locator('[data-step="agents"] input[data-member="Dina"]').isChecked());
    await page.close();
  }
  console.log('PASS: grouped people with lead/count, search keeps hidden members, labelled editor, rename updates lead+manager, moves keep effort, back/next keeps edits, footer visible');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
