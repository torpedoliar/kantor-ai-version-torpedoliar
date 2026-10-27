// Real CC0 furniture models replace procedural shapes without changing the walking grid; a missing model falls back.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
const ready=page=>page.waitForFunction(()=>window.officeScene?.snapshot().models,null,{timeout:90000});
(async()=>{
 const browser=await launch({headless:true});
 try{
  const open=async(url,setup)=>{const ctx=await browser.newContext({viewport:{width:1280,height:800}});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});await setup?.(page);await page.goto(url);await ready(page);return {page,errors,ctx};};
  const blocked=page=>page.evaluate(()=>officeScene.navGrid(3).cells.filter(Boolean).length);
  const plain=await open(URL+'?models=off'),base=await blocked(plain.page);
  assert.deepEqual(await plain.page.evaluate(()=>officeScene.snapshot().models),{loaded:0,failed:[]});await plain.ctx.close();
  const real=await open(URL);
  const s=await real.page.evaluate(()=>officeScene.snapshot().models);assert.ok(s.loaded>=20,`models loaded ${s.loaded}`);assert.deepEqual(s.failed,[]);
  const withModels=await blocked(real.page);assert.ok(Math.abs(withModels-base)/base<=.03,`walking grid changed ${base}→${withModels}`);
  assert.ok(await real.page.evaluate(()=>officeScene.modelCount(3)>=40),'work floor uses real furniture models');
  // Room dressing like the reference interiors: small items, plants, art, lighting, lounge pieces.
  const d3=await real.page.evaluate(()=>officeScene.decor(3));assert.ok(d3.total>=60,`floor 3 decor ${d3.total}`);
  for(const kind of ['monitor','keyboard','plant_small','plant_tall','painting','bookshelf','pendant_lamp','sofa_sectional','coffee_table_glass','rug','arc_lamp'])assert.ok(d3.kinds.includes(kind),`floor 3 has ${kind}: ${d3.kinds}`);
  const screens=await real.page.evaluate(()=>officeScene.screenAudit());assert.ok(screens.length>0&&screens.every(s=>s.attached&&s.gap!==null&&s.gap<.01&&s.marginX>.06),`monitor images fit inside the bezel: ${JSON.stringify(screens.slice(0,3))}`);
  for(const level of [1,2,4])assert.ok((await real.page.evaluate(l=>officeScene.decor(l).total,level))>=15,`floor ${level} decor`);
  // Decor never blocks a desk: with routines paused everyone is sent back and sits at work.
  await real.page.evaluate(()=>{officeScene.setRoutine?.(false);officeScene.everyoneToDesk?.();});
  await real.page.waitForFunction(()=>officeScene.snapshot().team.every(p=>p.state==='work'),null,{timeout:45000});
  assert.deepEqual(real.errors,[]);await real.ctx.close();
  const broken=await open(URL,page=>page.route('**/assets/models/office_chair.glb',r=>r.abort()));
  assert.deepEqual(await broken.page.evaluate(()=>officeScene.snapshot().models.failed),['office_chair']);
  assert.match(await broken.page.textContent('#sceneStatus'),/aset 3D/i);assert.deepEqual(broken.errors,[]);
  console.log('PASS: furniture models load, keep the walking grid, and a missing model falls back with a notice');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
