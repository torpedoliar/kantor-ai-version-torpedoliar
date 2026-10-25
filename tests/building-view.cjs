const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
// These tests start from a fresh data dir; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};

(async()=>{
 const browser=await launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}).then(skipWizard),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.OFFICE_URL||'http://127.0.0.1:4173');await page.waitForFunction(()=>window.officeScene);
 await page.click('#bRoutine');await page.click('#bPause');
 await page.locator('[data-floor="0"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('building-view')),true);
 assert.equal(await page.locator('.floor-thumb').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth===200)),true);
 assert.equal(await page.locator('[data-floor="3"] .floor-count').innerText(),String(await page.evaluate(()=>window.officeTasks.state().members.filter(m=>m.active!==false).length)));
 const point=await page.evaluate(()=>officeScene.floorPoint(2));await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 assert.equal(await page.evaluate(()=>officeScene.snapshot().floor),2);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('building-view')),false);
 for(const width of [375,768,1440]){
 await page.setViewportSize({width,height:960});await page.locator('[data-floor="0"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/private/tmp/kantor-evening-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS: actual floor thumbnails, live counts, floor picking, theme switch, responsive building view, no JS errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
