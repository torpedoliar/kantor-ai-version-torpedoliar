// A stalled model manifest must not keep the office blank: after the 12 s watchdog the scene builds
// with the procedural fallbacks and says why it is simple.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173/';
(async()=>{
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
    // Keep the manifest pending well past the watchdog; individual GLTF files are never requested.
    await page.route('**/assets/manifest.json',async route=>{await new Promise(resolve=>setTimeout(resolve,20000));await route.continue().catch(()=>{});});
    const started=Date.now();
    await page.goto(URL);
    await page.waitForFunction(()=>window.officeScene,null,{timeout:22000});
    const elapsed=Date.now()-started;
    assert.ok(elapsed<20000,`the office builds before the stalled asset delay (${elapsed} ms)`);
    const notice=await page.evaluate(()=>window.officeStartupNotice||'');
    assert.match(notice,/lambat|bentuk sederhana/,'the owner is told the office started with fallbacks');
    assert.equal(await page.evaluate(()=>officeScene.snapshot().models.loaded),0,'the office was built without the stalled models');
    assert.deepEqual(errors,[]);
    console.log('PASS: a stalled model manifest is bounded by the startup watchdog and the office still renders');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
