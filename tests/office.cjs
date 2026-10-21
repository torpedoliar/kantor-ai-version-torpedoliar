const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}}).then(skipWizard);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);
 await page.waitForFunction(()=>window.officeScene);
 const snap=await page.evaluate(()=>officeScene.snapshot());
 assert.equal(snap.team.length,13);assert.equal(snap.floor,3);
 assert.equal(snap.team.find(p=>p.name==='Bagas Pratama Putra').role,'Frontend Engineer');
 assert.equal(await page.locator('#taskAssignee option').count(),13);
 for(const floor of [3,1,2,4,0]){
   await page.locator(`[data-floor="${floor}"]`).click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
   assert.deepEqual(await page.evaluate(()=>officeScene.snapshot().visibleFloors),floor?[floor]:[1,2,3,4]);
   assert.equal(await page.evaluate(()=>officeScene.snapshot().sky),floor===0,'city, clouds and birds only in the whole-building view');
   await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),`kantor-floor-${floor}.png`)});
 }
 console.log('PASS: 13 team members, roles, 4 floors and building overview');
 await page.locator('[data-floor="0"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 const point=await page.evaluate(()=>officeScene.floorPoint(2));await page.mouse.click(point.x,point.y);
 assert.equal(await page.evaluate(()=>officeScene.snapshot().floor),2);
 await page.locator('[data-floor="3"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 const before=await page.evaluate(()=>officeScene.snapshot().camera);
 await page.mouse.move(820,520);await page.mouse.down();await page.mouse.move(680,440,{steps:10});await page.mouse.up();
 const after=await page.evaluate(()=>officeScene.snapshot().camera);
 assert.ok(after.theta>before.theta+.5&&after.phi>before.phi+.3,'drag orbits and tilts the camera');
 await page.mouse.move(820,520);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(700,520,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
 const panned=await page.evaluate(()=>officeScene.snapshot().camera);assert.ok(Math.abs(panned.theta-after.theta)<.2,'shift drag pans instead of orbiting');
 await page.mouse.wheel(0,300);assert.ok((await page.evaluate(()=>officeScene.snapshot().camera.radius))>panned.radius);
 await page.click('#bReset');
 console.log('PASS: building view click enters floor, drag orbit, shift pan, wheel zoom');
 if(process.argv.includes('--visual')){
   for(const width of [375,768,1440]){
     await page.setViewportSize({width,height:900});await page.locator('[data-floor="3"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);

   }
   await browser.close();return;
 }
 await page.locator('[data-floor="3"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 assert.equal(await page.evaluate(()=>officeScene.snapshot().routine),true);
 await page.waitForFunction(()=>officeScene.snapshot().team.some(p=>p.activity&&!p.atDesk&&p.state===p.activity),null,{timeout:60000});
 await page.waitForFunction(()=>officeScene.snapshot().team.some(p=>p.talkingWith),null,{timeout:150000});
 const talk=await page.evaluate(()=>officeScene.snapshot().team.filter(p=>p.talkingWith).map(p=>`${p.name} (${p.state}) -> ${p.talkingWith}`));
 await page.screenshot({path:'/private/tmp/kantor-routine.png'});
 assert.ok(await page.evaluate(()=>officeScene.snapshot().team.filter(p=>p.activity).length<=4));
 console.log('PASS: autonomous routine leaves desks and colleagues talk:',talk.join(', '));
 assert.ok(await page.locator('#logList li').count()>0,'routine events appear in the office log');
 await page.click('#moments summary');await page.click('#bPray');assert.match(await page.locator('#sceneStatus').innerText(),/Belum ada yang ikut/);
 await page.click('#bTeam');await page.click('#teamList [data-member="Kak Laras"]');await page.check('#iPray');await page.click('#moments summary');await page.click('#bPray');
 await page.waitForFunction(()=>officeScene.snapshot().team.find(p=>p.name==='Kak Laras').state==='pray',null,{timeout:60000});
 assert.match(await page.locator('#logList').innerText(),/Waktu salat: KL menuju ruang salat/);
 console.log('PASS: office log, prayer opt-in, only opted-in member goes to the musholla');
 await page.waitForFunction(()=>officeScene.snapshot().doors.some(v=>v>.8),null,{timeout:120000});
 console.log('PASS: a room door opens when someone walks through');
 await page.click('#bTeam');await page.click('#teamList [data-member="Rizky Hakim"]');assert.match(await page.locator('#info').innerText(),/Backend Engineer/);
 await page.click('#iTasks');assert.equal(await page.inputValue('#taskAssignee'),'Rizky Hakim');
 await page.fill('#taskTitle','Uji API kantor');await page.click('#taskCreateForm button[type=submit]');
 await page.getByRole('button',{name:'Mulai tugas',exact:true}).click();
 await page.locator('.task-item textarea').fill('Hasil pengujian API');
 await page.getByRole('button',{name:'Simpan hasil & selesai'}).click();
 assert.equal(await page.locator('.task-result').innerText(),'Hasil pengujian API');
 await page.keyboard.press('Escape');
 await page.click('#bZoomIn');await page.click('#bZoomOut');await page.click('#bRotate');await page.click('#bReset');
 await page.click('#bPause');assert.equal(await page.evaluate(()=>officeScene.snapshot().paused),true);await page.click('#bPause');
 await page.click('#bTeam');await page.click('#teamList [data-member="Rizky Hakim"]');await page.click('#iEyes');
 // The camera eases into the eyes over a few frames; wait for it instead of sampling the first frame.
 const eyeGap=()=>page.evaluate(()=>{const s=officeScene.snapshot(),p=s.team.find(m=>m.name==='Rizky Hakim').position;return Math.hypot(...s.cameraPosition.map((v,i)=>v-p[i]));});
 // The camera is already at the head on the click that starts the follow, so the very
 // first sample has to be in place -- not one animation frame later.
 assert.ok(await eyeGap()<3,'eye camera snaps to the character on the first frame');
 await page.waitForFunction(()=>{const s=officeScene.snapshot(),p=s.team.find(m=>m.name==='Rizky Hakim').position;return Math.hypot(...s.cameraPosition.map((v,i)=>v-p[i]))<3;},null,{timeout:5000}).catch(async()=>{throw Error('eye camera sits in the character; gap '+(await eyeGap()).toFixed(2));});
 const eyes=await page.evaluate(()=>officeScene.snapshot());assert.deepEqual(eyes.follow,{name:'Rizky Hakim',mode:'eyes'});
 await page.click('#fChase');await page.waitForTimeout(1500);
 const chase=await page.evaluate(()=>officeScene.snapshot()),chaseAt=chase.team.find(p=>p.name==='Rizky Hakim').position,gap=Math.hypot(...chase.cameraPosition.map((v,i)=>v-chaseAt[i]));
 assert.ok(gap>2&&gap<7,'chase camera trails behind the character');
 await page.click('#moments summary');await page.click('#bLunch');
 await page.waitForFunction(()=>{const s=officeScene.snapshot();return s.team.find(p=>p.name==='Rizky Hakim').state==='break'&&s.floor===2&&s.follow;},null,{timeout:150000});
 await page.screenshot({path:'/private/tmp/kantor-follow-lunch.png'});
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>officeScene.snapshot().follow),null);
 console.log('PASS: character camera from the eyes and from behind, follows down the stairs to lunch, Escape exits');
 await page.waitForFunction(()=>officeScene.snapshot().team.every(p=>p.floor===2&&p.state==='break'),null,{timeout:90000});
 await page.screenshot({path:'/private/tmp/kantor-lunch.png'});
 console.log('PASS: character selection, tasks, controls, all 13 arrive at lunch');
 await page.click('#moments summary');await page.click('#bRoof');
 await page.waitForFunction(()=>officeScene.snapshot().team.every(p=>p.floor===4&&p.state==='break'),null,{timeout:150000});
 await page.click('#bRoutine');assert.equal(await page.evaluate(()=>officeScene.snapshot().routine),false);
 await page.click('#moments summary');await page.click('#bWork');
 await page.waitForFunction(()=>officeScene.snapshot().team.every(p=>p.floor===3&&p.state==='work'),null,{timeout:150000});
 await page.waitForTimeout(3000);
 assert.ok(await page.evaluate(()=>officeScene.snapshot().team.every(p=>p.atDesk&&!p.activity)));
 await page.click('#bRoutine');
 console.log('PASS: rooftop, routine off keeps everyone at their own desk');
 for(const width of [375,768,1440]){
   await page.setViewportSize({width,height:900});await page.locator('[data-floor="3"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

   await page.click('#bTasks');assert.equal(await page.locator('#taskDialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.keyboard.press('Escape');
   if(width===375){assert.equal(await page.isVisible('#logList'),false);await page.click('#logToggle');assert.equal(await page.isVisible('#logList'),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.click('#logToggle');}
 }
 await page.evaluate(()=>localStorage.setItem('kantor-ai.tasks.v1',JSON.stringify([{id:'old-task',title:'Tugas lama',assignee:'Sari',status:'active',brief:'',result:'',createdAt:new Date().toISOString()}])));
 await page.reload();await page.waitForFunction(()=>window.officeScene);await page.click('#bTasks');
 assert.match(await page.locator('#taskList').innerText(),/prototipe lama/);
 await page.locator('.task-item select').selectOption('Kak Rani');await page.getByRole('button',{name:'Pindahkan tugas'}).click();
 assert.match(await page.locator('#taskList').innerText(),/KR/);
 await page.getByRole('button',{name:'Mulai tugas',exact:true}).click();
 await page.reload();await page.waitForFunction(()=>window.officeScene);
 assert.equal(await page.evaluate(()=>officeTasks.activeFor('Kak Rani').title),'Tugas lama');
 await page.click('#bTeam');await page.click('#teamList [data-member="Kak Laras"]');assert.equal(await page.isChecked('#iPray'),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile/tablet/desktop, legacy task reassignment, reload, no JavaScript errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
