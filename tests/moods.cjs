// Time-of-day moods change the sun, sky, lamps, city windows and stars, and the choice persists.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
  await page.goto(URL);await page.waitForFunction(()=>window.officeScene?.mood,null,{timeout:90000});
  assert.equal(await page.locator('#bMood').inputValue(),'siang','noon is the default');
  const day=await page.evaluate(()=>officeScene.mood());
  assert.equal(day.id,'siang');assert.equal(day.stars,false);assert.equal(day.lamps,false);assert.ok(!day.fog);
  await page.selectOption('#bMood','malam');
  await page.waitForFunction(()=>officeScene.mood().id==='malam'&&officeScene.mood().blend===1,null,{timeout:10000});
  const night=await page.evaluate(()=>officeScene.mood());
  assert.ok(night.sun<day.sun,'moonlight is dimmer than noon');assert.ok(night.ambient<day.ambient,'night ambient is lower');
  assert.ok(night.stars,'stars appear at night');assert.ok(night.lamps,'interior lamps glow at night');
  assert.ok(night.city>0&&night.street>0,'city windows and street lamps light up');
  assert.notEqual(night.background,day.background,'the sky changes');
  await page.selectOption('#bMood','pagi');
  await page.waitForFunction(()=>officeScene.mood().id==='pagi'&&officeScene.mood().blend===1,null,{timeout:10000});
  const morning=await page.evaluate(()=>officeScene.mood());
  assert.ok(morning.sun>night.sun,'morning sun is brighter than moonlight');assert.equal(morning.stars,false);assert.equal(morning.lamps,false);
  await page.selectOption('#bMood','sore');
  await page.waitForFunction(()=>officeScene.mood().id==='sore'&&officeScene.mood().blend===1,null,{timeout:10000});
  const evening=await page.evaluate(()=>officeScene.mood());
  assert.ok(evening.lamps&&evening.city>0,'golden hour starts warming the lamps');
  assert.notEqual(evening.background,morning.background);
  // The building view gets haze/fog and the city sky; the selected mood persists across a reload.
  await page.locator('[data-floor="0"]').click();await page.waitForFunction(()=>!officeScene.snapshot().transitioning,null,{timeout:60000});
  await page.selectOption('#bMood','malam');
  await page.waitForFunction(()=>officeScene.mood().id==='malam'&&officeScene.mood().blend===1,null,{timeout:10000});
  const building=await page.evaluate(()=>officeScene.mood());assert.ok(building.fog,'the city view uses night haze');assert.ok(building.stars);
  await page.reload();await page.waitForFunction(()=>window.officeScene?.mood,null,{timeout:90000});
  assert.equal(await page.locator('#bMood').inputValue(),'malam','the mood is remembered');
  assert.equal((await page.evaluate(()=>officeScene.mood())).id,'malam');
  assert.deepEqual(errors,[]);
  console.log('PASS: pagi/siang/sore/malam change sky, sun, lamps, city glow and stars, and persist');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
