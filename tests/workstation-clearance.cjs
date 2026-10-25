// Seated workers must not intersect their monitor, including both desk-row orientations and dual displays.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{for(const suffix of ['', '?people=legacy']){
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL+suffix);await p.waitForFunction(()=>window.officeScene?.workstationAudit,null,{timeout:90000});
 await p.evaluate(()=>officeScene.setRoutine(false));await p.waitForTimeout(250);
 const check=async()=>{const rows=await p.evaluate(()=>officeScene.workstationAudit());assert.ok(rows.length>=13);assert.ok(rows.some(r=>r.side===1)&&rows.some(r=>r.side===-1),'both seat orientations');for(const r of rows){assert.ok(r.monitors>0);assert.ok(r.minGap>=.15,`${suffix||'normal'} ${r.name}: head is only ${r.minGap.toFixed(3)}m from monitor`);}};
 await check();await p.evaluate(()=>officeScene.applyOrg(officeTasks.state()));await p.waitForTimeout(250);await check();
 assert.deepEqual(errors,[]);await p.close();
}console.log('PASS: seated heads clear monitors by at least 15cm on both sides and after organization rebuild');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
