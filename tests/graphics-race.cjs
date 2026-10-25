// Delayed HDRI from an abandoned Ultra request must never override the more recent Low selection.
const assert=require('node:assert/strict');const {launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const browser=await launch({headless:true});try{
 const p=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 let release,requested;const gate=new Promise(r=>release=r),seen=new Promise(r=>requested=r);
 await p.route('**/assets/hdri/*.hdr',async route=>{requested();await gate;await route.continue();});
 await p.goto(URL);await p.waitForFunction(()=>window.officeScene?.snapshot().graphics&&!officeScene.snapshot().graphics.pending,null,{timeout:90000});
 await p.evaluate(()=>officeGraphics.set('ultra'));await seen;
 await p.evaluate(()=>officeGraphics.set('low'));release();
 // Drain the actual loader, not a fixed delay, then inspect what stale Ultra left behind.
 await p.waitForResponse(r=>r.url().endsWith('.hdr'));
 await p.evaluate(async()=>{await new Promise(r=>setTimeout(r,500));});
 const g=await p.evaluate(()=>officeScene.snapshot().graphics);
 assert.equal(g.level,'low');assert.equal(g.environment,false,'stale HDRI must not re-enable environment on Low');
 assert.equal(g.textures,null,'stale Ultra must not re-enable textures');assert.deepEqual(g.post,[]);assert.deepEqual(errors,[]);
 console.log('PASS: latest graphics selection wins over delayed HDRI');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
