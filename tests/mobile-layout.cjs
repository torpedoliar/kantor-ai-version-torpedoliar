// Resize keeps the owner's camera, phone-width input stays at 16 px, the settings header is a flex
// row, and the narrow rail moves Ruang/Tata ruang into Lainnya instead of clipping.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173/';
(async()=>{
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
    await page.goto(URL);await page.waitForFunction(()=>window.officeScene,null,{timeout:90000});
    await page.evaluate(()=>officeScene.setCamera({target:[3,4,5],theta:-.4,phi:.7,radius:50}));
    await page.waitForTimeout(250);
    const before=await page.evaluate(()=>officeScene.snapshot().camera);
    await page.setViewportSize({width:900,height:700});await page.waitForTimeout(350);
    const after=await page.evaluate(()=>officeScene.snapshot().camera);
    for(let i=0;i<3;i++)assert.ok(Math.abs(after.target[i]-before.target[i])<.05,`camera target ${i} survives resize`);
    assert.ok(Math.abs(after.theta-before.theta)<.01&&Math.abs(after.phi-before.phi)<.01&&Math.abs(after.radius-before.radius)<.1,'camera orbit survives resize');
    // The settings header is the shared flex row; the close button sits on the right edge.
    await page.evaluate(()=>document.getElementById('settingsDialog').showModal());
    const header=await page.evaluate(()=>{const h=document.querySelector('#settingsDialog .settings-header'),close=document.getElementById('settingsClose'),a=h.getBoundingClientRect(),b=close.getBoundingClientRect();return {display:getComputedStyle(h).display,right:a.right,closeRight:b.right};});
    assert.equal(header.display,'flex');assert.ok(Math.abs(header.right-header.closeRight)<2,'the close button aligns right');
    await page.evaluate(()=>document.getElementById('settingsDialog').close());
    // Phone rail: nine buttons do not fit, so Ruang and Tata ruang move into Lainnya.
    await page.setViewportSize({width:360,height:740});
    await page.evaluate(()=>{const decisions=document.getElementById('decisions');decisions.hidden=false;decisions.querySelector('.badge').textContent='1';document.getElementById('bRooms').hidden=false;});
    await page.waitForTimeout(250);
    const rail=await page.evaluate(()=>{const buttons=[...document.querySelectorAll('#rail .btn')].filter(button=>!button.hidden&&button.offsetParent!==null);return {scroll:document.documentElement.scrollWidth,inner:innerWidth,boxes:buttons.map(button=>{const box=button.getBoundingClientRect();return {id:button.id,left:box.left,right:box.right};}),roomsInMenu:!!document.getElementById('bRooms').closest('#railMore'),customInMenu:!!document.getElementById('bCustom').closest('#railMore')};});
    assert.ok(rail.scroll<=rail.inner+1,`no horizontal page scroll at 360 (${rail.scroll} > ${rail.inner})`);
    assert.ok(rail.boxes.every(box=>box.left>=-1&&box.right<=rail.inner+1),`rail buttons stay on screen: ${JSON.stringify(rail.boxes)}`);
    assert.equal(rail.roomsInMenu,true);assert.equal(rail.customInMenu,true);
    await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(250);
    const restored=await page.evaluate(()=>({rooms:!!document.getElementById('bRooms').closest('#railMore'),custom:!!document.getElementById('bCustom').closest('#railMore')}));
    assert.equal(restored.rooms,false);assert.equal(restored.custom,false);
    assert.deepEqual(errors,[]);
    // A coarse pointer (phones/tablets) gets 16 px controls so iOS does not zoom on focus.
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const touch=await context.newPage();
    await touch.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
    await touch.goto(URL);await touch.waitForFunction(()=>window.officeScene,null,{timeout:90000});
    assert.equal(await touch.evaluate(()=>matchMedia('(pointer:coarse)').matches),true);
    assert.equal(await touch.evaluate(()=>getComputedStyle(document.getElementById('taskTitle')).fontSize),'16px');
    await context.close();
    console.log('PASS: resize preserves the camera, phone controls are 16 px, the settings header aligns, and the rail fits 360 px');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
