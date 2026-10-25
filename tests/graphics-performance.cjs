// Draw-call regression guard (measured after merging static meshes and model primitives; Ultra counts SAO's extra
// depth/normal passes). With skinned humans: Ultra ~40 FPS (15 people) / ~36 FPS (30 people) at 1080p on a GTX 750 Ti;
// measured draw calls low 497, ultra 1873, ultra+30 people 2135.
const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
const calls=async(page)=>{await page.waitForTimeout(500);return page.evaluate(()=>{officeScene.luminance();return officeScene.snapshot().graphics.drawCalls;});};
(async()=>{
 const browser=await launch({headless:true});
 try{
  const result={};
  for(const level of ['low','ultra']){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
   await page.goto(`${URL}?graphics=${level}`);await page.waitForFunction(()=>{const g=window.officeScene?.snapshot().graphics;return g&&!g.pending;},null,{timeout:90000});
   result[level]=await calls(page);
   if(level==='ultra'){
    const extra=Array.from({length:17},(_,i)=>({name:`Tamu ${i+1}`,initials:`T${i+1}`,role:'Staf',division:['marketing','engineering','service'][i%3],manager:['Kak Rani','Koh Wira','Gilang'][i%3],active:true}));
    await page.evaluate(r=>officeScene.syncRoster(r),extra);await page.waitForFunction(()=>officeScene.snapshot().team.length>=30,null,{timeout:30000});
    result.crowd=await calls(page);
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('  draw calls',JSON.stringify(result));
  assert.ok(result.low<=1000,`low ${result.low} > 1000`);assert.ok(result.ultra<=3800,`ultra ${result.ultra} > 3800`);assert.ok(result.crowd<=8500,`30 people at ultra ${result.crowd} > 8500`);
  console.log('PASS: draw calls within budget at Low, Ultra and Ultra with 30 people');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
