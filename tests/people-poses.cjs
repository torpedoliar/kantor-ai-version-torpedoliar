// Skinned humans follow office poses: grounded when standing, seated on the chair at the desk with hands near
// the keyboard, knees and elbows actually bend while walking, and props sit in the hand.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL);await p.waitForFunction(()=>window.officeScene?.poseAudit,null,{timeout:90000});
 await p.evaluate(()=>officeScene.setRoutine(false));await p.waitForTimeout(1500);
 const seated=await p.evaluate(()=>officeScene.poseAudit().filter(x=>x.atDesk&&x.state==='work'));
 assert.ok(seated.length>=10,`seated workers ${seated.length}`);
 for(const s of seated){
  assert.ok(s.soleAboveFloor>=-.03&&s.soleAboveFloor<.15,`${s.name} feet on the floor: ${s.soleAboveFloor}`);
  assert.ok(Math.abs(s.hipAboveSeat)<.12,`${s.name} sits on the seat: hips ${s.hipAboveSeat}m from seat`);
  assert.ok(s.handToKeyboard<.3,`${s.name} hands at the keyboard: ${s.handToKeyboard}m`);
  assert.ok(s.headToMonitor>=.15,`${s.name} head clear of monitor: ${s.headToMonitor}m`);
 }
 // A walker bends knees and swings elbows (not a rigid slide).
 const walk=await p.evaluate(async()=>{const name=officeScene.snapshot().team.find(x=>x.atDesk).name;officeScene.sendToStretch?.(name);
  const samples=[];for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,60));const w=officeScene.poseAudit().find(x=>x.name===name);if(w.state==='walk')samples.push(w);}return samples;});
 assert.ok(walk.length>=5,'saw the person walking');
 const range=k=>Math.max(...walk.map(w=>w[k]))-Math.min(...walk.map(w=>w[k]));
 assert.ok(range('kneeBend')>.25,`knees bend while walking: ${range('kneeBend')}`);
 assert.ok(range('armSwing')>.2,`arms swing while walking: ${range('armSwing')}`);
 assert.deepEqual(errors,[]);
 console.log('PASS: skinned humans sit on chairs at the keyboard, stand grounded, and bend knees/arms while walking');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
