// Three.js is vendored (0.160.0) with the addons the realistic renderer needs; nothing loads from a CDN at runtime.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(URL);await page.waitForFunction(()=>window.officeScene,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>THREE.REVISION),'160');
  assert.ok(await page.evaluate(()=>!!THREE.addons?.GLTFLoader&&!!THREE.addons?.EffectComposer&&!!THREE.addons?.SAOPass&&!!THREE.addons?.RGBELoader));
  assert.equal(requests.filter(u=>/cdnjs|jsdelivr|unpkg/.test(u)).length,0,'no CDN at runtime');
  assert.equal(await page.evaluate(()=>officeScene.snapshot().team.length),13);
  assert.deepEqual(errors,[]);
  console.log('PASS: Three.js 0.160 vendored with addons, no CDN requests, office renders without page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
