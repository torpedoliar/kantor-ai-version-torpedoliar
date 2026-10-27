// Durable lifecycle transactions: migration once, atomic changes, request deduplication and cursor replay.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTaskStore,transitionTask,prune,EVENT_LIMIT,REQUEST_LIMIT,REQUEST_TTL}=require('../server/task-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-store-'));
try{
  const legacy='[{"id":"old","title":"Old task","assignee":"A","status":"queued","version":0,"messages":[{"by":"Owner","text":"A note","at":"2026-10-20T00:00:00Z"}]}]';
  fs.writeFileSync(path.join(dir,'tasks.json'),legacy);
  const store=createTaskStore({dataDir:dir});
  assert.equal(store.snapshot().tasks[0].id,'old');assert.equal(fs.readFileSync(path.join(dir,'tasks.json'),'utf8'),legacy);
  assert.ok(fs.existsSync(path.join(dir,'workspace.json')));
  assert.equal(store.snapshot().messages[0].text,'A note');assert.equal(store.snapshot().messages[0].sender.type,'system','legacy attribution is not fabricated agent activity');
  let notices=[];store.subscribe(events=>notices.push(events));
  const v=store.snapshot().version;
  const result=store.transaction(v,(draft,emit)=>{
    transitionTask(draft,'old',{status:'active',runId:'run1'},{expectedTaskVersion:0});
    const e=emit({type:'model.started',taskId:'old',runId:'run1',data:{model:'test'}});
    draft.messages.push({id:'m1',threadId:'old',seq:e.seq,text:'Started',sender:{type:'system',name:'System'}});
    return 'old';
  },{requestKey:'request-1'});
  assert.equal(result,'old');assert.equal(store.snapshot().tasks[0].status,'active');assert.equal(notices.length,1);
  assert.equal(createTaskStore({dataDir:dir}).snapshot().messages.at(-1).id,'m1');
  const saved=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');
  assert.throws(()=>store.transaction(store.snapshot().version,(draft,emit)=>{draft.tasks=[];emit({type:'bad'});throw Error('stop');}),/stop/);
  assert.equal(fs.readFileSync(path.join(dir,'workspace.json'),'utf8'),saved);assert.equal(store.snapshot().tasks.length,1);
  let invoked=false;
  assert.equal(store.transaction(v,()=>{invoked=true;return 'wrong';},{requestKey:'request-1'}),'old');assert.equal(invoked,false,'duplicate request bypasses mutator even with stale version');
  assert.throws(()=>store.transaction(v,()=>{}),e=>e.code==='VERSION_CONFLICT');
  assert.throws(()=>store.transaction(store.snapshot().version,draft=>transitionTask(draft,'old',{status:'review'},{expectedTaskVersion:0})),e=>e.code==='VERSION_CONFLICT');
  assert.throws(()=>store.transaction(store.snapshot().version,draft=>transitionTask(draft,'old',{status:'review'},{runId:'wrong'})),e=>e.code==='STALE_RUN');
  for(let i=0;i<5;i++)store.transaction(store.snapshot().version,(draft,emit)=>emit({type:'test.event',data:{text:'x'.repeat(9000)}}));
  const replay=store.eventsAfter(3,100);assert.ok(replay.length>0);assert.ok(replay.every(e=>e.seq>3));assert.ok(replay.every((e,i)=>!i||e.seq>replay[i-1].seq));assert.equal(replay.at(-1).data.text.length,8000);
  const copy=store.snapshot();copy.tasks=[];assert.equal(store.snapshot().tasks.length,1,'reads cannot mutate store');
  const broken=createTaskStore({dataDir:dir,write:()=>{throw Error('disk full')}}),before=broken.snapshot();
  assert.throws(()=>broken.transaction(before.version,d=>{d.tasks=[];}),/disk full/);assert.deepEqual(broken.snapshot(),before);
  // Migration cannot run twice or consume a subsequently changed legacy file.
  fs.writeFileSync(path.join(dir,'tasks.json'),'[]');assert.equal(createTaskStore({dataDir:dir}).snapshot().tasks.length,1);
  const bad=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-bad-'));
  try{fs.writeFileSync(path.join(bad,'tasks.json'),'broken');assert.throws(()=>createTaskStore({dataDir:bad}),/Cannot read/);assert.equal(fs.existsSync(path.join(bad,'workspace.json')),false);}finally{fs.rmSync(bad,{recursive:true,force:true});}
  // Retention: expired events and request keys are pruned, and the retained sequence starts at firstSeq.
  const stamp=Date.parse('2026-10-27T00:00:00Z'),old=new Date(stamp-200*24*60*60*1000).toISOString(),recent=new Date(stamp-1000).toISOString();
  const retention={events:[{seq:1,at:old},{seq:2,at:recent}],nextSeq:3,requests:{old:{result:'x',at:old},fresh:{result:'y',at:recent},legacy:{result:'z'}}};
  assert.equal(prune(retention,stamp),true);
  assert.deepEqual(retention.events.map(event=>event.seq),[2]);assert.equal(retention.firstSeq,2);
  assert.deepEqual(Object.keys(retention.requests),['fresh']);
  const many={events:Array.from({length:EVENT_LIMIT+3},(_,index)=>({seq:index+1,at:recent})),nextSeq:EVENT_LIMIT+4,requests:{}};
  for(let index=0;index<REQUEST_LIMIT+5;index++)many.requests['r'+index]={result:index,at:new Date(stamp-index*100).toISOString()};
  prune(many,stamp);
  assert.equal(many.events.length,EVENT_LIMIT);assert.equal(many.firstSeq,4);
  assert.equal(Object.keys(many.requests).length,REQUEST_LIMIT);
  assert.ok(!Object.hasOwn(many.requests,'r'+REQUEST_LIMIT),'oldest request key is dropped first');
  assert.ok(REQUEST_TTL>0);
  console.log('PASS: transactional task migration, atomic rollback, request deduplication, lifecycle guards, ordered event replay and bounded retention');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
