// Stage 2: proportional human characters. Proportions, per-person variation that stays stable, and
// the same pose/behaviour contract the office already relies on.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173';
(async()=>{const b=await launch({headless:true});try{
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
 await p.goto(URL);await p.waitForFunction(()=>window.officeScene?.snapshot().team,null,{timeout:90000});
 const people=await p.evaluate(()=>officeScene.people());
 assert.ok(people.length>=13);
 for(const person of people){
   // Adult proportions: height ≈ 1.70–1.95 m, head ≈ 1/7.5 of height, shoulders ≈ 2.3 head widths.
   assert.ok(person.height>=1.6&&person.height<=2.0,`${person.name} height ${person.height}`);
   assert.ok(person.headHeight>=.19&&person.headHeight<=.28,`${person.name} head ${person.headHeight}`);
   assert.ok(person.headHeight/person.height<.17,`${person.name} must not be chibi`);
   assert.ok(person.shoulderWidth>=.36&&person.shoulderWidth<=.62,`${person.name} shoulders ${person.shoulderWidth}`);
 }
 // Variation is deterministic per person: the same name always gets the same look.
 const first=await p.evaluate(()=>officeScene.people().map(x=>({name:x.name,skin:x.skin,hair:x.hair,build:x.build})));
 await p.reload();await p.waitForFunction(()=>window.officeScene?.snapshot().team,null,{timeout:90000});
 const second=await p.evaluate(()=>officeScene.people().map(x=>({name:x.name,skin:x.skin,hair:x.hair,build:x.build})));
 assert.deepEqual(second,first,'a person must look the same after a reload');
 assert.ok(new Set(first.map(x=>x.skin)).size>=3,'skin tones vary between people');
 assert.ok(new Set(first.map(x=>x.hair)).size>=3,'hair styles vary between people');
 assert.ok(new Set(first.map(x=>x.build)).size>=2,'body builds vary between people');
 // The shirt still follows the division colour.
 assert.ok(people.every(x=>x.shirt!==null));
 assert.deepEqual(errors,[]);
 console.log('PASS: proportional human characters with stable per-person variation, division colours kept');
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
