// A task blocked with questions before decisions existed must still be answerable from Komunikasi.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTaskStore}=require('../server/task-store');
const legacyTask={id:'c9511c99-3889-4054-bea6-6be15c5f1757',title:'Membuat Program Kalkulator',assignee:'Budi Santoso',status:'blocked',questions:'1. Bahasa apa?\n2. Fitur apa?',brief:'Buatkan',result:'',messages:[],version:2,createdAt:'2026-10-20T14:24:23.286Z'};
// Fresh migration from tasks.json.
const a=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-a-'));fs.writeFileSync(path.join(a,'tasks.json'),JSON.stringify([legacyTask]));
let s=createTaskStore({dataDir:a}).snapshot();
assert.equal(s.decisions.length,1,'migration opens a decision for a blocked task with questions');
assert.equal(s.decisions[0].status,'open');assert.deepEqual(s.decisions[0].questions,['Bahasa apa?','Fitur apa?']);
assert.equal(s.messages.filter(m=>m.kind==='decision').length,1,'the decision card has a message in the thread');
assert.equal(s.tasks[0].blockedReason,'decision');
// Already-migrated workspace (the live case): repaired on load, once.
const b=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-b-'));
fs.writeFileSync(path.join(b,'workspace.json'),JSON.stringify({schemaVersion:1,version:3,nextSeq:3,tasks:[legacyTask],threads:[{id:legacyTask.id,taskId:legacyTask.id,title:legacyTask.title}],messages:[{id:'m',threadId:legacyTask.id,taskId:legacyTask.id,seq:1,at:'x',sender:{type:'owner',name:'Owner'},kind:'text',text:'bebas'}],decisions:[],events:[{type:'message.created',seq:1,id:'e1',at:'x'},{type:'task.updated',seq:2,id:'e2',at:'x'}],projects:[],jobs:[],reads:{owner:{}},requests:{}}));
s=createTaskStore({dataDir:b}).snapshot();assert.equal(s.decisions.filter(d=>d.status==='open').length,1,'existing workspace is repaired');
assert.equal(s.messages.length,2,'owner message kept');
s=createTaskStore({dataDir:b}).snapshot();assert.equal(s.decisions.length,1,'repair is idempotent across restarts');
for(const d of [a,b])fs.rmSync(d,{recursive:true,force:true});
console.log('PASS: legacy blocked questions become an open, answerable decision (fresh migration and existing workspace, idempotent)');
