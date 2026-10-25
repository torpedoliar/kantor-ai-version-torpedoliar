// An idle team member walks to the parking, drives out on the road, and a new task makes them return to their desk.
// Task data is replaced inside this isolated browser page only; nothing is written to the server.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL);await p.waitForFunction(()=>window.officeScene?.environmentAudit().loaded.length===3,null,{timeout:90000});
 await p.evaluate(()=>{window.__tasks=[];officeTasks.online=()=>true;officeTasks.list=()=>window.__tasks;officeScene.setRoutine(true);});
 // Review #1: a "back to work" command while walking to the car cancels the trip instead of leaving it stuck.
 const walker=await p.waitForFunction(()=>officeScene.mobilitySnapshot().trips.find(t=>t.kind==='team'&&t.phase==='walkToVehicle')?.owner,null,{timeout:240000,polling:200}).then(h=>h.jsonValue());
 await p.evaluate(()=>officeScene.everyoneToDesk());
 await p.waitForFunction(o=>!officeScene.mobilitySnapshot().trips.some(t=>t.owner===o),walker,{timeout:60000});
 await p.waitForFunction(o=>officeScene.snapshot().team.find(t=>t.name===o).atDesk,walker,{timeout:60000});
 // Wait for a real trip to reach the road.
 const owner=await p.waitForFunction(()=>{const s=officeScene.mobilitySnapshot(),t=s.trips.find(t=>t.kind==='team'&&['outbound','away'].includes(t.phase)&&s.vehicles.find(v=>v.id===t.id)?.pose[2]>12);return t&&t.owner;},null,{timeout:480000,polling:250}).then(h=>h.jsonValue());
 const onRoad=await p.evaluate(o=>{const t=officeScene.mobilitySnapshot().trips.find(t=>t.owner===o),v=officeScene.mobilitySnapshot().vehicles.find(v=>v.id===t.id);return v.pose;},owner);
 assert.ok(onRoad[2]>12,`vehicle left the building onto the road: ${onRoad}`);
 // A queued task arrives while driving: the trip must turn into a return and the person must reach their desk.
 await p.evaluate(o=>{window.__tasks=[{id:'t1',assignee:o,status:'queued',title:'Tugas baru'}];document.dispatchEvent(new CustomEvent('officetasks:change'));},owner);
 assert.ok(await p.evaluate(o=>officeScene.mobilitySnapshot().trips.find(t=>t.owner===o).recall,owner),'trip recalled on new task');
 await p.waitForFunction(o=>!officeScene.mobilitySnapshot().trips.some(t=>t.owner===o)&&officeScene.snapshot().team.find(t=>t.name===o).atDesk,owner,{timeout:240000,polling:500});
 // While the task is open the person must not leave again.
 await p.waitForTimeout(3000);assert.ok(!(await p.evaluate(o=>officeScene.mobilitySnapshot().trips.some(t=>t.owner===o),owner)),'busy person does not depart again');
 assert.deepEqual(errors,[]);console.log(`PASS: ${owner} drove out, a new task recalled them, they parked and returned to their desk`);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
