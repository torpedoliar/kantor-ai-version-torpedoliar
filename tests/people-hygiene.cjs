// Correctness guards for textured humans: recolour shows in audits, removal frees the cue too, body scale keeps
// forward and downward bone lengths equal (IK stays accurate), a rig with missing arm bones falls back, and
// seated hands still reach the keyboard after people move desks.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL);await p.waitForFunction(()=>window.officeScene?.snapshot().team.length>=13,null,{timeout:90000});
 await p.evaluate(()=>officeScene.setRoutine(false));await p.waitForTimeout(1500);
 const r=await p.evaluate(async()=>{
  const s=officeTasks.state(),who=s.members.find(m=>!s.members.some(o=>o.manager===m.name)&&s.members.some(o=>o.division!==m.division)),peer=s.members.find(m=>m.division!==who.division);
  const before=officeScene.people().find(x=>x.name===who.name).shirt;
  officeScene.applyOrg({...s,divisions:s.divisions.map(d=>d.id===peer.division?{...d,color:'#c0398a'}:d),members:s.members.map(m=>m.name===who.name?{...m,division:peer.division,manager:null}:m)});
  const shirt=officeScene.people().find(x=>x.name===who.name).shirt,want=officeScene.people().find(x=>x.name===peer.name).shirt,scales=officeScene.people().map(x=>x.scale);
  const proto=THREE.BufferGeometry.prototype,orig=proto.dispose;let cylinders=0;proto.dispose=function(){if(this.type==='CylinderGeometry'&&this.parameters.height===1.45)cylinders++;return orig.call(this);};
  // Seat everyone, then reorder so desks change: cached keyboard reach must follow the new desk.
  const moved=officeTasks.state();officeScene.applyOrg({...moved,members:[...moved.members].reverse()});
  await new Promise(r=>setTimeout(r,500));const reach=officeScene.reachAudit();
  const now=officeTasks.state();try{officeScene.applyOrg({...now,members:now.members.slice(0,-1)});}finally{proto.dispose=orig;}
  const SU=THREE.addons.SkeletonUtils;let broken;THREE.addons.SkeletonUtils={...SU,clone:x=>{const c=SU.clone(x);c.traverse(o=>{if(o.isBone&&o.name.startsWith('upperarm01'))o.name='gone';});return c;}};
  try{broken=officePeople.build({n:'Rusak',gender:'male'},0xff0000);}catch(e){broken='threw: '+e.message;}finally{THREE.addons.SkeletonUtils=SU;}
  return {reach,who:who.name,peer:peer.name,div:officeTasks.state().members.find(m=>m.name===who.name)?.division,shirt,want,before,scales,cylinders,broken:broken===null?null:String(broken)};});
 assert.equal(r.shirt,'#c0398a','audited shirt follows the new division colour');
 assert.equal(r.cylinders,1,`cue geometry of the removed person disposed: ${r.cylinders}`);
 assert.ok(r.scales.every(s=>s&&Math.abs(s[1]-s[2])<1e-9),`height and depth scale match: ${JSON.stringify(r.scales.slice(0,3))}`);
 assert.equal(r.broken,null,'rig missing arm bones falls back to the legacy figure');
 assert.ok(r.reach.length>=10&&r.reach.every(x=>x.drift<.02),`keyboard reach follows desk changes: ${JSON.stringify(r.reach.filter(x=>x.drift>=.02))}`);
 await p.waitForTimeout(1500);
 const seated=await p.evaluate(()=>officeScene.poseAudit().filter(x=>x.atDesk&&x.state==='work'));
 assert.ok(seated.length>=10);for(const s of seated)assert.ok(s.handToKeyboard<.3,`${s.name} reaches keyboard after reorganisation: ${s.handToKeyboard}`);
 assert.deepEqual(errors,[]);
 console.log('PASS: textured humans keep audits, disposal, scale, fallback and keyboard reach consistent');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
