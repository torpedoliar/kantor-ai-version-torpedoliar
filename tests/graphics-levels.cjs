// Graphics levels Low/Medium/High/Ultra: automated browsers default to Low, Settings switches live, the choice persists,
// ?graphics= overrides, switching does not leak textures, and blocked storage still works.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
const snoozed=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const graphics=page=>page.evaluate(()=>officeScene.snapshot().graphics);
const waitLevel=(page,level)=>page.waitForFunction(l=>officeScene.snapshot().graphics.level===l&&!officeScene.snapshot().graphics.pending,level,{timeout:60000});
(async()=>{
 const browser=await launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:800}});const page=await snoozed(await ctx.newPage()),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(URL);await page.waitForFunction(()=>window.officeScene?.snapshot().graphics,null,{timeout:60000});
  let g=await graphics(page);assert.equal(g.level,'low','automated browser defaults to low');
  assert.deepEqual([g.shadows,g.environment,g.post,g.textures],[false,false,[],null]);
  const baseline=g.textureCount;
  await page.locator('#railMore').evaluate(n=>n.open=true);await page.click('#bSettings');await page.locator('#settingsDialog').waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#settingsGraphics option').evaluateAll(o=>o.map(x=>x.value)),['low','medium','high','ultra']);
  await page.selectOption('#settingsGraphics','ultra');await waitLevel(page,'ultra');
  g=await graphics(page);assert.deepEqual([g.shadows,g.environment,g.post,g.textures],[true,true,['sao','bloom'],'2k']);
  await page.selectOption('#settingsGraphics','medium');await waitLevel(page,'medium');
  g=await graphics(page);assert.deepEqual([g.shadows,g.environment,g.post,g.textures],[true,false,[],'1k']);
  // Medium textures most large surfaces of the work floor; Low uses none.
  let audit=await page.evaluate(()=>officeScene.surfaceAudit(3));assert.ok(audit.textured/(audit.textured+audit.flat)>=.8,`medium textured share ${JSON.stringify(audit)}`);
  await page.selectOption('#settingsGraphics','low');await waitLevel(page,'low');
  audit=await page.evaluate(()=>officeScene.surfaceAudit(3));assert.equal(audit.textured,0,'low uses flat materials');
  for(const l of ['low','ultra','low','high','low']){await page.selectOption('#settingsGraphics',l);await waitLevel(page,l);}
  assert.ok((await graphics(page)).textureCount<=baseline+2,'switching levels does not leak textures');
  await page.selectOption('#settingsGraphics','high');await waitLevel(page,'high');
  await page.reload();await page.waitForFunction(()=>window.officeScene?.snapshot().graphics,null,{timeout:60000});
  assert.equal((await graphics(page)).level,'high','choice persisted');
  await page.goto(URL+'?graphics=medium');await page.waitForFunction(()=>window.officeScene?.snapshot().graphics,null,{timeout:60000});
  assert.equal((await graphics(page)).level,'medium','?graphics= overrides');
  assert.deepEqual(errors,[]);
  // Blocked storage (private mode): default level, and switching still works for the session.
  const ctx2=await browser.newContext({viewport:{width:1280,height:800}});const p2=await snoozed(await ctx2.newPage()),errors2=[];p2.on('pageerror',e=>errors2.push(e.message));
  await p2.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})});
  await p2.goto(URL);await p2.waitForFunction(()=>window.officeScene?.snapshot().graphics,null,{timeout:60000});
  assert.equal((await graphics(p2)).level,'low');await p2.evaluate(()=>officeGraphics.set('high'));await waitLevel(p2,'high');
  assert.deepEqual(errors2,[]);
  console.log('PASS: graphics levels default/switch/persist/override, no texture leak, blocked storage');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
