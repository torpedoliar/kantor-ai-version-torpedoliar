// The render loop clones mobility once per frame, not once per consumer. This pins the hot path
// below four snapshots per frame (the old office took four).
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173/';
(async()=>{
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:860}});
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
    await page.goto(URL);await page.waitForFunction(()=>window.officeScene,null,{timeout:90000});
    await page.waitForTimeout(1200);
    const before=await page.evaluate(()=>officeScene.mobilitySnapshotCount());
    await page.waitForTimeout(2000);
    const after=await page.evaluate(()=>officeScene.mobilitySnapshotCount());
    const frames=after-before;
    assert.ok(frames>0,'the frame loop is running');
    assert.ok(frames<=220,`mobility is cloned at most once per frame (${frames} snapshots in ~2 s)`);
    console.log(`PASS: one mobility snapshot per frame (${frames} in ~2 s)`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
