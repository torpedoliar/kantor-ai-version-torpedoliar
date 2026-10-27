// Model calls share one gate: at most N across the office and at most M per provider; waiting calls start by priority.
const assert=require('node:assert/strict'),{createGate}=require('../server/concurrency.js');
(async()=>{
 let limits={office:2,providers:{a:1}};const gate=createGate(()=>limits);const started=[];const releases=[];
 const job=(id,provider,priority)=>gate.run({provider,priority,label:id},()=>new Promise(r=>{started.push(id);releases.push(r);}));
 const p=[job('a1','a','normal'),job('b1','b','normal'),job('a2','a','low'),job('b2','b','low'),job('b3','b','high')];
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(started,['a1','b1'],'office limit 2, provider a limit 1');
 assert.equal(gate.snapshot().running,2);assert.equal(gate.snapshot().waiting,3);
 releases.shift()();await new Promise(r=>setImmediate(r)); // a1 done: a2 cannot start (provider a), b3 (high) goes before b2 (low)
 assert.deepEqual(started,['a1','b1','b3'],'highest priority waiting call goes first');
 releases.shift()();await new Promise(r=>setImmediate(r)); // b1 done
 assert.deepEqual(started.slice(3),['a2'],'equal limit room goes to the oldest highest-priority eligible call');
 // A failing call still releases its slot.
 limits={office:1,providers:{}};const g2=createGate(()=>limits);
 await assert.rejects(g2.run({provider:'x',priority:'normal'},async()=>{throw Error('boom');}),/boom/);
 assert.equal(g2.snapshot().running,0,'slot released after failure');
 // Raising the limit at runtime lets waiting calls start without a restart.
 const g3=createGate(()=>limits);const s3=[];const r3=[];for(const id of ['x','y','z'])g3.run({provider:'p',priority:'normal'},()=>new Promise(r=>{s3.push(id);r3.push(r);}));
 await new Promise(r=>setImmediate(r));assert.deepEqual(s3,['x']);limits={office:3,providers:{}};g3.poke();await new Promise(r=>setImmediate(r));assert.deepEqual(s3,['x','y','z']);
 // null limit = unlimited.
 const g4=createGate(()=>({office:null,providers:{}}));const s4=[];for(let i=0;i<10;i++)g4.run({provider:'p'},()=>new Promise(()=>{s4.push(i);}));await new Promise(r=>setImmediate(r));assert.equal(s4.length,10);
 // A provider cooldown holds every queued call for that provider, then releases them once.
 const g5=createGate(()=>({office:null,providers:{}}));let cooled=0;
 g5.cooldown('p',150);
 g5.run({provider:'p',label:'cooled'},()=>{cooled++;});
 await new Promise(r=>setTimeout(r,50));
 assert.equal(cooled,0,'cooldown holds the call');assert.ok(g5.snapshot().cooldowns.p>0,'snapshot reports the cooldown');
 await new Promise(r=>setTimeout(r,180));
 assert.equal(cooled,1,'the call runs when the cooldown ends');assert.equal(g5.snapshot().cooldowns.p,undefined,'expired cooldown is cleared');
 // A huge Retry-After cannot park a provider for more than five minutes.
 g5.cooldown('q',24*60*60*1000);assert.ok(g5.snapshot().cooldowns.q<=300000,'cooldown is clamped');
 // Settings: office limit defaults to 3, per-provider limit optional, both validated and persisted.
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createSettings}=require('../server/settings.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-conc-'));
 const s=createSettings({dataDir:dir,env:{KANTOR_SETTINGS_KEY:Buffer.alloc(32,1).toString('base64')},agents:{}});
 assert.equal(s.publicState().concurrency,3,'default office limit is 3');
 let v=s.publicState().version;s.save({...s.publicState(),version:v,concurrency:5,providers:[{id:'pa',displayName:'A',protocol:'openai',baseUrl:'https://a.example',models:[],maxConcurrent:2}]},v);
 assert.equal(s.publicState().concurrency,5);assert.equal(s.publicState().providers[0].maxConcurrent,2);
 assert.deepEqual(s.callLimits(),{office:5,providers:{pa:2}},'limits() feeds the gate');
 v=s.publicState().version;s.save({...s.publicState(),version:v,concurrency:0},v);assert.equal(s.publicState().concurrency,null,'0 = unlimited');
 v=s.publicState().version;assert.throws(()=>s.save({...s.publicState(),version:v,concurrency:-1},v),/bersamaan/i);
 v=s.publicState().version;assert.throws(()=>s.save({...s.publicState(),version:v,providers:[{...s.publicState().providers[0],maxConcurrent:1.5}]},v),/bersamaan/i);
 // Reloading from disk keeps both limits.
 const again=createSettings({dataDir:dir,env:{KANTOR_SETTINGS_KEY:Buffer.alloc(32,1).toString('base64')},agents:{}});
 assert.equal(again.publicState().concurrency,null);assert.equal(again.publicState().providers[0].maxConcurrent,2);
 fs.rmSync(dir,{recursive:true,force:true});
 console.log('PASS: office and per-provider concurrency limits, priority ordering, release on failure, provider cooldown, live limit changes, validated settings');
})().catch(e=>{console.error(e);process.exitCode=1;});
