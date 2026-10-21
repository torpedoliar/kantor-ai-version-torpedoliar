// Thread status and activity lines come only from task state and stored events — no invented progress.
const assert=require('node:assert/strict');
const {activityFor}=require('../server/task-activity');
const at=s=>new Date(Date.UTC(2026,9,21,9,0,s)).toISOString();
const root={id:'r',title:'Program Kalkulator',assignee:'Budi',status:'blocked',blockedReason:'children',phase:'waiting_children'};
const kids=[{id:'a',parentId:'r',rootId:'r',title:'UI',assignee:'Ahmad',status:'done'},{id:'b',parentId:'r',rootId:'r',title:'Logika',assignee:'Maya',status:'active',dependencyIds:[]},{id:'c',parentId:'r',rootId:'r',title:'Tes',assignee:'Rina',status:'queued',dependencyIds:['b']}];
const events=[
 {seq:1,at:at(0),type:'task.created',taskId:'r',rootId:'r',agent:'Budi'},
 {seq:2,at:at(1),type:'model.started',taskId:'r',rootId:'r',agent:'Budi',data:{purpose:'plan',modelId:'grok'}},
 {seq:3,at:at(20),type:'model.completed',taskId:'r',rootId:'r',agent:'Budi',data:{purpose:'plan'}},
 {seq:4,at:at(20),type:'delegation.created',taskId:'a',rootId:'r',from:'Budi',to:'Ahmad',data:{title:'UI'}},
 {seq:5,at:at(20),type:'delegation.rejected',taskId:'r',rootId:'r',from:'Budi',to:'Sinta',data:{title:'FAQ'}},
 {seq:6,at:at(21),type:'message.created',taskId:'r',rootId:'r'},
 {seq:7,at:at(22),type:'model.started',taskId:'b',rootId:'r',agent:'Maya',data:{purpose:'work',modelId:'m'}},
 {seq:8,at:at(30),type:'result.submitted',taskId:'a',rootId:'r',from:'Ahmad',to:'Budi',data:{accepted:true}},
];
const state={tasks:[root,...kids],events};
let a=activityFor(state,'r',{now:at(40),agents:['Budi','Ahmad','Maya','Rina']});
assert.equal(a.status.label,'Tim sedang bekerja');assert.deepEqual(a.status.progress,{done:1,total:3});
assert.deepEqual(a.status.working.map(w=>[w.assignee,w.title]),[['Maya','Logika']]);
const lines=a.items.map(i=>i.text);
assert.ok(lines.includes('Budi mulai menyusun rencana'));assert.ok(lines.some(l=>/Budi selesai menyusun rencana · 19 dtk/.test(l)));
assert.ok(lines.includes('Didelegasikan ke Ahmad: UI'));assert.ok(lines.some(l=>/Tidak bisa didelegasikan ke Sinta/.test(l)));
assert.ok(lines.includes('Maya mulai mengerjakan "Logika"'));assert.ok(lines.includes('Ahmad mengirim hasil "UI" ke Budi'));
assert.ok(!a.items.some(i=>i.seq===6),'messages stay messages, not activity lines');
assert.ok(a.items.every((i,k)=>!k||a.items[k-1].seq<i.seq),'ordered by sequence');
assert.doesNotMatch(JSON.stringify(a),/%/,'no invented percentages');
// Active work: label from phase, elapsed since the model call started, model shown.
a=activityFor({tasks:[{id:'w',title:'Caption',assignee:'Rani',status:'active'}],events:[{seq:1,at:at(5),type:'model.started',taskId:'w',agent:'Rani',data:{purpose:'work',modelId:'grok-x'}}]},'w',{now:at(65),agents:['Rani']});
assert.equal(a.status.label,'Rani sedang mengerjakan');assert.equal(a.status.since,at(5));assert.equal(a.status.model,'grok-x');assert.equal(a.status.busy,true);
a=activityFor({tasks:[{id:'p',title:'X',assignee:'Budi',status:'active',phase:'planning'}],events:[]},'p',{agents:['Budi']});assert.equal(a.status.label,'Budi sedang menyusun rencana');
a=activityFor({tasks:[{id:'s',title:'X',assignee:'Budi',status:'active',phase:'synthesizing'}],events:[]},'s',{agents:['Budi']});assert.equal(a.status.label,'Budi sedang mereview hasil tim');
// Queued: say why it is waiting.
const busy={tasks:[{id:'q',title:'Baru',assignee:'Rani',status:'queued',createdAt:at(2)},{id:'o',title:'Lama',assignee:'Rani',status:'active'}],events:[]};
assert.match(activityFor(busy,'q',{agents:['Rani']}).status.label,/Antre.*Rani masih mengerjakan "Lama"/);
assert.match(activityFor(state,'c',{agents:['Rina']}).status.label,/Menunggu "Logika" selesai/);
assert.match(activityFor({tasks:[{id:'m',title:'M',assignee:'Yoga',status:'queued'}],events:[]},'m',{agents:[]}).status.label,/dikerjakan manual/);
assert.match(activityFor({tasks:[{id:'n',title:'N',assignee:'Rani',status:'queued'}],events:[]},'n',{agents:['Rani']}).status.label,/segera/);
assert.match(activityFor({tasks:[{id:'f',title:'F',assignee:'Rani',status:'queued',error:'timeout'}],events:[]},'f',{agents:['Rani']}).status.label,/Gagal/);
assert.equal(activityFor({tasks:[{id:'d',title:'D',assignee:'Rani',status:'blocked',blockedReason:'decision'}],events:[]},'d',{agents:['Rani']}).status.label,'Menunggu jawabanmu');
assert.equal(activityFor({tasks:[{id:'v',title:'V',assignee:'Rani',status:'review'}],events:[]},'v',{agents:['Rani']}).status.label,'Siap kamu review');
console.log('PASS: thread status (planning/working/reviewing/queued reasons/real subtask counts) and ordered activity lines from events');
