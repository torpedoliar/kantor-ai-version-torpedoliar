// Adding work floors must not cover the selected floor, and new floors must get the same room dressing.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{
 const browser=await launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');}catch{}});
  await page.goto(URL);await page.waitForFunction(()=>window.officeScene?.snapshot().models,null,{timeout:90000});
  const openCells=()=>page.evaluate(()=>officeScene.navGrid(3).cells.filter(v=>v===0).length);
  const orgBefore=await page.evaluate(()=>officeTasks.state());
  await page.evaluate(o=>officeScene.applyOrg(o),orgBefore);
  assert.ok(await openCells()>5000,'rebuilding a merged floor must keep usable walking space, not rasterize its entire bounding box as a wall');
  const initialAudit=await page.evaluate(()=>officeScene.geometryAudit());
  for(const art of initialAudit.decor.filter(x=>['painting','clock','mirror'].includes(x.kind)))assert.ok(Math.max(...art.size)<2.5,`${art.kind} on floor ${art.level} must fit a wall, got ${art.size}`);
  for(const o of initialAudit.decor.filter(x=>['bookshelf','tv','coffee_table_glass'].includes(x.kind))){
    assert.ok(o.size[1]<=2.2,`${o.kind} must stay within one storey, height ${o.size[1]}`);
    assert.ok(o.min[0]>=-16.1&&o.max[0]<=16.1&&o.min[2]>=-12.1&&o.max[2]<=12.1,`${o.kind} must stay inside room bounds: ${o.min} → ${o.max}`);
  }
  const geometryBefore=await page.evaluate(()=>officeScene.snapshot().graphics.geometryCount);
  const org=await page.evaluate(()=>officeTasks.state());
  const divisions=Array.from({length:6},(_,i)=>({id:'audit'+i,name:'Audit '+i,color:'#507060',lead:'Lead '+i,collaboratesWith:[]}));
  const members=divisions.map((d,i)=>({name:'Lead '+i,initials:'L'+i,role:'Lead',division:d.id,manager:null,active:true}));
  await page.evaluate(o=>officeScene.applyOrg(o),{divisions,members});
  let snap=await page.evaluate(()=>officeScene.snapshot());
  assert.equal(snap.floor,3);assert.deepEqual(snap.visibleFloors,[3],'new work floors must stay hidden while floor 3 is selected');
  const extra=await page.evaluate(()=>officeScene.floorRoles().find(x=>x.level>4));assert.ok(extra);
  assert.ok(await page.evaluate(l=>officeScene.mergedMeshes(l),extra.level)>0,'a dynamically created floor is merged after finalization');
  const expandedAudit=await page.evaluate(()=>officeScene.geometryAudit());
  const floorHeights=await page.evaluate(()=>Object.fromEntries(officeScene.floorRoles().map(f=>[f.level,officeScene.floorHeight(f.level)])));
  for(const facade of expandedAudit.facades)assert.ok(Math.abs(facade.minY-(floorHeights[facade.level]-.54))<.05,`facade ${facade.level} aligned to its own storey: ${facade.minY} vs ${floorHeights[facade.level]-.54}`);
  const decor=await page.evaluate(l=>officeScene.decor(l),extra.level);
  assert.ok(decor.kinds.includes('painting')&&decor.kinds.includes('window_frame'),'additional work floor gets room dressing, not an empty shell');
  for(const kind of ['meeting_table','meeting_chair','pantry_counter','lounge_sofa','planter','floor_sign'])assert.ok(decor.kinds.includes(kind),`additional work floor is furnished with ${kind}: ${decor.kinds}`);
  await page.click(`[data-floor="${extra.level}"]`);await page.waitForFunction(()=>!officeScene.snapshot().transitioning);
  assert.deepEqual(await page.evaluate(()=>officeScene.snapshot().visibleFloors),[extra.level]);
  await page.evaluate(o=>officeScene.applyOrg(o),org);
  assert.deepEqual(await page.evaluate(()=>officeScene.snapshot().visibleFloors),[3],'removed selected work floor returns to visible floor 3');
  const restoredAudit=await page.evaluate(()=>officeScene.geometryAudit());
  const restoredHeights=await page.evaluate(()=>Object.fromEntries(officeScene.floorRoles().map(f=>[f.level,officeScene.floorHeight(f.level)])));
  for(const facade of restoredAudit.facades)assert.ok(Math.abs(facade.minY-(restoredHeights[facade.level]-.54))<.05,`facade ${facade.level} remains aligned after removing a storey`);
  const geometryAfter=await page.evaluate(()=>officeScene.snapshot().graphics.geometryCount);
  assert.ok(geometryAfter<=geometryBefore+80,`removed floors release geometry (${geometryBefore} → ${geometryAfter})`);
  assert.deepEqual(errors,[]);
  console.log('PASS: dynamic work floors preserve floor visibility and receive realistic room dressing');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
