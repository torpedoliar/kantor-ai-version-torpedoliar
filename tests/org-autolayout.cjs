// The 3D office follows the organization: desk areas per division, extra work floors when desks run out,
// the rooftop stays on top, people on removed floors are re-seated, and area signs follow the division.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const PORT=Number(process.env.TEST_PORT||43303),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-autolayout-')),origin=`http://127.0.0.1:${PORT}`;
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'60000'},stdio:['ignore','pipe','inherit']});
const start=new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',d=>{if(String(d).includes('Kantor Kita:')){ready=true;resolve();}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
(async()=>{await start;let browser;try{
  browser=await launch();const page=await browser.newPage({viewport:{width:1440,height:900}}).then(skipWizard),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.officeScene?.floorRoles&&!document.querySelector('#bLock').disabled);
  const roles=()=>page.evaluate(()=>officeScene.floorRoles().map(f=>f.role));
  const levelOf=role=>page.evaluate(r=>officeScene.floorRoles().find(f=>f.role===r)?.level,role);
  // The server organization is applied on load: Koh Wira leads Engineering, so he sits in the Engineering area.
  assert.deepEqual(await roles(),['lobby','dining','work-1','roof']);
  await page.waitForFunction(()=>officeScene.snapshot().team.find(a=>a.name==='Koh Wira')?.group==='engineering');
  assert.equal(await page.locator('#floors [data-floor]:not([data-floor="0"])').count(),4);
  // Twenty more marketing people need a second work floor; the rooftop moves up above it.
  const grown=await page.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,members:[...s.members,...Array.from({length:20},(_,i)=>({name:`Staf ${i}`,initials:`S${i}`,role:'Staf',division:'marketing',manager:'Kak Rani',active:true}))]});});
  assert.equal(grown.floors,2);assert.equal(grown.seated,33);
  assert.deepEqual(await roles(),['lobby','dining','work-1','work-2','roof']);
  const work2=await levelOf('work-2'),roof=await levelOf('roof');
  const floors=await page.evaluate(()=>officeScene.floorRoles());
  assert.deepEqual(floors.map(f=>f.number),[1,2,3,4,5],'display numbers follow the building from the ground up');
  assert.equal(floors.find(f=>f.role==='work-2').name,'Lantai kerja 2');
  let snap=await page.evaluate(()=>officeScene.snapshot());
  assert.equal(snap.team.length,33);
  // Leadership + three Marketing areas fill work floor 1; Engineering and Service move up to work floor 2.
  assert.equal(snap.team.find(a=>a.name==='Staf 19').floor,3);
  assert.equal(snap.team.find(a=>a.name==='Yoga').floor,work2,'next divisions seated on the second work floor');
  assert.ok(snap.team.find(a=>a.name==='Yoga').atDesk);
  assert.equal(await page.locator(`#floors [data-floor="${work2}"]`).count(),1);
  const buttons=await page.$$eval('#floors .section-stack [data-floor]',b=>b.map(x=>x.querySelector('.floor-number').textContent));
  assert.deepEqual(buttons,['FL.05','FL.04','FL.03','FL.02','FL.01'],'rooftop button is on top');
  assert.ok(await page.evaluate(([w,r])=>officeScene.floorHeight(r)>officeScene.floorHeight(w),[work2,roof]),'rooftop sits above the new floor');
  // Everyone can still reach the rooftop.
  await page.evaluate(()=>document.getElementById('bRoof').click());
  await page.waitForFunction(r=>officeScene.snapshot().team.filter(a=>a.floor===r).length>=8,roof,{timeout:60000});
  // Visit the extra floor, then shrink back while people are upstairs.
  await page.click(`#floors [data-floor="${work2}"]`);
  await page.evaluate(()=>officeScene.applyOrg(officeTasks.state()));
  assert.deepEqual(await roles(),['lobby','dining','work-1','roof']);
  snap=await page.evaluate(()=>officeScene.snapshot());
  const existing=new Set(await page.evaluate(()=>officeScene.floorRoles().map(f=>f.level)));
  assert.equal(snap.team.length,13);assert.ok(snap.team.every(a=>existing.has(a.floor)||a.state==='stairs'),'nobody is left on a removed floor');
  assert.ok(existing.has(snap.floor)||snap.floor===0,'the active floor falls back to a floor that exists');
  assert.equal(await page.locator(`#floors [data-floor="${work2}"]`).count(),0);
  // Area signs follow the division name, or the area name when set; long names are shortened, not broken.
  await page.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,divisions:s.divisions.map(d=>d.id==='service'?{...d,areaName:'Pojok CS'}:d.id==='marketing'?{...d,name:'M'.repeat(120)}:d)});});
  const signs=await page.evaluate(()=>officeScene.signs());
  assert.ok(signs.includes('POJOK CS'));assert.ok(signs.some(s=>s.startsWith('MMMM')));
  // A new member gets a real character with the division colour, a desk and a name label.
  await page.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,members:[...s.members,{name:'Nina',initials:'N',role:'Analis',division:'service',manager:'Gilang',active:true}]});});
  snap=await page.evaluate(()=>officeScene.snapshot());
  const nina=snap.team.find(a=>a.name==='Nina');assert.ok(nina);assert.equal(nina.group,'service');assert.equal(nina.gender,'nonbinary');
  assert.equal(await page.locator('.name-label',{hasText:/^N$/}).count(),1);
  // Deactivated members leave the office.
  await page.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,members:s.members.map(m=>m.name==='Tari'?{...m,active:false}:m)});});
  assert.ok(!(await page.evaluate(()=>officeScene.snapshot())).team.some(a=>a.name==='Tari'));
  // An empty organization still renders one empty work floor.
  assert.equal((await page.evaluate(()=>officeScene.applyOrg({...officeTasks.state(),divisions:[],members:[]}))).floors,1);
  assert.deepEqual(await roles(),['lobby','dining','work-1','roof']);
  await page.evaluate(()=>officeScene.applyOrg(officeTasks.state()));
  // Saved Tata ruang furniture: a rooftop lantern stays on the rooftop; a sofa saved where a team table now stands is hidden, not deleted.
  const items=await page.evaluate(()=>officeScene.customize.list());
  const lamp=items.find(i=>i.floor===4&&i.type==='billiard')||items.find(i=>i.floor===4);
  const sofa=items.find(i=>i.type==='sofa'&&i.floor===3);
  assert.ok(lamp&&sofa);
  // Seed on the next document: the current document's beforeunload handler persists its own slot state.
  await page.addInitScript(([l,s])=>{localStorage.setItem('kantor-ai.layouts.v1',JSON.stringify({names:['Slot 1','Slot 2','Slot 3','Slot 4','Slot 5'],layouts:[{[l]:{x:2,z:2,rot:0},[s]:{x:-5.5,z:-3.5,rot:0}},null,null,null,null],current:1}));},[lamp.id,sofa.id]);
  await page.reload();await page.waitForFunction(()=>window.officeScene?.floorRoles&&!document.querySelector('#bLock').disabled);await page.waitForTimeout(500);
  await page.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,members:[...s.members,...Array.from({length:20},(_,i)=>({name:`Staf ${i}`,initials:`S${i}`,role:'Staf',division:'marketing',manager:'Kak Rani',active:true}))]});});
  const after=await page.evaluate(()=>officeScene.customize.list());
  assert.equal(after.find(i=>i.id===lamp.id).floor,4);assert.equal(await levelOf('roof'),4,'rooftop furniture stays on the rooftop');
  assert.equal(after.find(i=>i.id===sofa.id).hidden,true,`furniture under a team table is hidden: ${JSON.stringify(after.find(i=>i.id===sofa.id))}`);
  assert.match(await page.evaluate(()=>localStorage.getItem('kantor-ai.layouts.v1')),new RegExp(sofa.id),'saved layout is kept');
  assert.ok(after.filter(i=>i.generated).length>0);
  assert.equal(await page.evaluate(id=>officeScene.customize.select(id),after.find(i=>i.generated).id),null,'team desks are not movable in Tata ruang');
  await page.evaluate(()=>officeScene.applyOrg(officeTasks.state()));
  // The building view still works with the regenerated facade.
  await page.click('#floors [data-floor="0"]');await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
  assert.deepEqual(errors,[]);
  console.log('PASS: org-driven desk areas, extra work floors, rooftop on top, re-seating on shrink, area signs, new and removed members');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
