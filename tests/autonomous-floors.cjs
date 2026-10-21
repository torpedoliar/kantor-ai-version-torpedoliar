const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
// These tests start from a fresh data dir; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};

const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}}).then(skipWizard),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>window.officeScene);
 await page.evaluate(()=>{Math.random=()=>.1;});
 const camera=await page.evaluate(()=>officeScene.snapshot().camera);
 const excursion=await page.waitForFunction(()=>officeScene.snapshot().team.find(a=>a.activity&&a.destination!==3),null,{timeout:30000}).then(h=>h.jsonValue());
 assert.ok(excursion,'routine should send an employee to an activity on another floor');
 assert.ok([1,2,4].includes(excursion.destination));
 assert.equal(excursion.floor,3,'the employee starts the excursion from the desk floor');
 await page.waitForFunction(initials=>{const person=officeScene.snapshot().team.find(a=>a.initials===initials);return person&&person.floor===person.destination&&person.state==='break';},excursion.initials,{timeout:120000});
 const arrived=await page.evaluate(initials=>officeScene.snapshot().team.find(a=>a.initials===initials),excursion.initials);
 assert.equal(arrived.destination,excursion.destination,'agent arrives on the selected floor');
 assert.deepEqual(await page.evaluate(()=>officeScene.snapshot().camera),camera,'routine does not change the camera');
 assert.deepEqual(errors,[]);
 console.log(`PASS: autonomous routine crosses floors (${excursion.initials} → floor ${excursion.destination})`);
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
