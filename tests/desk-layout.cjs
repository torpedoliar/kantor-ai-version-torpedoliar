// Desk areas: chairs face the desk (backrest behind the seated person), seats sit at the desk's legroom so knees
// do not run into drawer pedestals, and desk-top items (monitor, keyboard, books, mug) do not intersect.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{for(const suffix of ['','?people=legacy']){
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL+suffix);await p.waitForFunction(()=>window.officeScene?.snapshot().team.length>=13,null,{timeout:90000});
 await p.evaluate(()=>officeScene.setRoutine(false));await p.waitForTimeout(1500);
 const r=await p.evaluate(()=>officeScene.deskLayoutAudit());
 assert.deepEqual(r.overlaps,[],`${suffix||'default'}: desk-top items intersect`);
 assert.ok(r.seats.length>=10,`${suffix||'default'}: seated ${r.seats.length}`);
 for(const s of r.seats)assert.ok(s.backForward<0,`${suffix||'default'} ${s.name}: chair back is in front of the person (${s.backForward}m)`);
 if(!suffix)for(const s of r.seats)assert.ok(s.legroom>=0,`${s.name}: knees hit the desk ${s.legroom}m`);
 assert.deepEqual(errors,[]);await p.close();
}console.log('PASS: chairs face their desks, knees have legroom, desk-top items do not intersect');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
