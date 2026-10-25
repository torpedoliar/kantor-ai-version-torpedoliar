// Lighting stays readable at every graphics level after the physical-light-unit upgrade: the work floor,
// the building view and the open rooftop are neither dark nor blown out, and High/Ultra use the HDRI environment.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 try{
  for(const level of ['low','medium','high','ultra']){
   const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
   await page.goto(`${URL}?graphics=${level}`);
   await page.waitForFunction(()=>{const g=window.officeScene?.snapshot().graphics;return g&&!g.pending;},null,{timeout:90000});
   const luminance=()=>page.evaluate(()=>officeScene.luminance());
   await page.evaluate(()=>officeScene.setCamera({target:[0,1,2],theta:.8,phi:1.0,radius:18}));await page.waitForTimeout(400);
   const floor=await luminance();
   await page.locator('[data-floor="0"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);await page.waitForTimeout(300);
   const building=await luminance();
   await page.locator('[data-floor="4"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning);await page.waitForTimeout(300);const roof=await luminance();
   for(const [name,value] of [['floor',floor],['building',building],['roof',roof]])assert.ok(value>=.25&&value<=.8,`${level} ${name} luminance ${value.toFixed(3)}`);
   const g=await page.evaluate(()=>officeScene.snapshot().graphics);
   assert.equal(g.environment,['high','ultra'].includes(level));if(g.environment)assert.equal(g.environmentSource,'hdri','HDRI environment for high/ultra');
   assert.deepEqual(errors,[]);await page.close();
   console.log(`  ${level}: floor ${floor.toFixed(2)} building ${building.toFixed(2)} roof ${roof.toFixed(2)}`);
  }
  console.log('PASS: lighting readable at every level (work floor, building view, rooftop); HDRI on high/ultra');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
