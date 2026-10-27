const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const clone=value=>structuredClone(value);
const collections=['tasks','threads','messages','decisions','events','projects','jobs'];
// Long-running offices keep the console useful without letting workspace.json grow forever.
// Request keys only need to survive a retry window; events outside the window are dropped
// (the reset flow archives the whole workspace before clearing it). Keep the event window no
// larger than the console's own 5,000-row window, so a fresh client can page through everything
// retained without entering a resync loop.
const EVENT_LIMIT=5000,EVENT_MAX_AGE=90*24*60*60*1000,REQUEST_LIMIT=1000,REQUEST_TTL=15*60*1000;
function prune(draft,now=Date.now()){
  let changed=false,first=draft.events.findIndex(event=>now-(Date.parse(event.at)||0)<=EVENT_MAX_AGE);
  if(first<0)first=draft.events.length;
  if(draft.events.length-first>EVENT_LIMIT)first=draft.events.length-EVENT_LIMIT;
  if(first>0){draft.events.splice(0,first);changed=true;}
  draft.firstSeq=draft.events[0]?.seq??draft.nextSeq;
  for(const [key,entry] of Object.entries(draft.requests||{})){
    const at=Date.parse(entry?.at);
    if(!Number.isFinite(at)||now-at>REQUEST_TTL){delete draft.requests[key];changed=true;}
  }
  const entries=Object.entries(draft.requests||{});
  if(entries.length>REQUEST_LIMIT){
    entries.sort((a,b)=>(Date.parse(a[1]?.at)||0)-(Date.parse(b[1]?.at)||0));
    for(const [key] of entries.slice(0,entries.length-REQUEST_LIMIT))delete draft.requests[key];
    changed=true;
  }
  return changed;
}
function conflict(code,message){return Object.assign(new Error(message),{status:409,code});}
function empty(){return {schemaVersion:1,version:0,nextSeq:1,firstSeq:1,tasks:[],threads:[],messages:[],decisions:[],events:[],projects:[],jobs:[],reads:{owner:{}},requests:{},memories:{}};}
// Agent memory: at most 20 short notes per agent, newest last. Notes are summaries, never whole drafts.
const MEMORY_LIMIT=20,MEMORY_TEXT=300;
function remember(draft,agent,notes){draft.memories=draft.memories||{};const list=[...(draft.memories[agent]||[]),...notes.map(text=>({text:String(text).replace(/\s+/g,' ').trim().slice(0,MEMORY_TEXT),at:new Date().toISOString()})).filter(n=>n.text)];draft.memories[agent]=list.slice(-MEMORY_LIMIT);return draft.memories[agent];}
function atomicWrite(file,data){const tmp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;try{fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}}}
// Console/model text: strip terminal escapes and anything that looks like a credential before it is stored.
const SECRET_PATTERNS=[/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,/\b(api[_-]?key|token|secret|password|credential)\s*[:=]\s*\S+/gi];
function sanitizeText(value){let text=String(value??'').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');for(const pattern of SECRET_PATTERNS)text=text.replace(pattern,'[disembunyikan]');return text;}
function limited(value){if(typeof value==='string')return value.slice(0,8000);if(Array.isArray(value))return value.map(limited);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,limited(item)]));return value;}
function emitEvent(draft,event){const next={...limited(event),id:crypto.randomUUID(),seq:draft.nextSeq++,at:new Date().toISOString()};draft.events.push(next);return next;}
function transitionTask(draft,id,patch,{expectedTaskVersion,runId}={}){
  const task=draft.tasks.find(t=>t.id===id);if(!task)throw Object.assign(new Error('Task not found.'),{status:404});
  if(expectedTaskVersion!==undefined&&expectedTaskVersion!==(task.version||0))throw conflict('VERSION_CONFLICT','Tugas berubah. Muat ulang sebelum menyimpan.');
  if(runId!==undefined&&runId!==task.runId)throw conflict('STALE_RUN','Hasil berasal dari eksekusi lama.');
  const before=task.status;Object.assign(task,patch,{version:(task.version||0)+1,updatedAt:new Date().toISOString()});
  emitEvent(draft,{type:'task.phase',taskId:id,rootId:task.rootId||id,agent:task.assignee,runId:task.runId||null,data:{from:before,to:task.status,phase:task.phase||task.status}});
  return task;
}
// Messenger rows live in the same transaction as the task change that caused them.
function ensureThread(draft,task){let thread=draft.threads.find(t=>t.taskId===task.id);if(!thread){thread={id:task.id,taskId:task.id,title:task.title||'',createdAt:new Date().toISOString()};draft.threads.push(thread);}return thread;}
function addMessage(draft,emit,{task,sender,kind='text',text,decisionId}){
  const thread=ensureThread(draft,task),event=emit({type:'message.created',taskId:task.id,rootId:task.rootId||task.id,agent:sender.type==='agent'?sender.name:null,data:{kind,sender:sender.type}});
  const message={id:crypto.randomUUID(),threadId:thread.id,taskId:task.id,seq:event.seq,at:event.at,sender:{type:sender.type,name:String(sender.name||'').slice(0,120)},kind,text:String(text||'').slice(0,8000),...(decisionId?{decisionId}:{})};
  draft.messages.push(message);return message;
}
// A short, factual acknowledgement when an agent picks a task up; never claims work is done.
function acknowledge(draft,emit,task,{delegate=false,retry=false}={}){
  const text=retry?'Siap, saya lanjutkan lagi tugas ini sekarang.':delegate?'Baik, tugas sudah saya terima dan mengerti. Saya susun rencananya lalu bagikan ke tim; kabar berikutnya saya kirim di sini.':'Baik, tugas sudah saya terima dan mengerti. Saya mulai kerjakan sekarang; hasilnya saya kirim di sini.';
  return addMessage(draft,emit,{task,sender:{type:'agent',name:task.assignee},kind:'ack',text});
}
function openDecision(draft,emit,{task,questions,target,path:route,askedBy}){
  for(const d of draft.decisions)if(d.taskId===task.id&&d.status==='open')d.status='cancelled';
  const decision={id:crypto.randomUUID(),taskId:task.id,threadId:ensureThread(draft,task).id,version:0,status:'open',target,path:route,questions,options:[],askedBy:askedBy||null,openedAt:new Date().toISOString()};
  draft.decisions.push(decision);emit({type:'decision.opened',taskId:task.id,rootId:task.rootId||task.id,agent:task.assignee,data:{decisionId:decision.id,target}});
  addMessage(draft,emit,{task,sender:{type:'agent',name:task.assignee},kind:'decision',text:questions.map((q,i)=>`${i+1}. ${q}`).join('\n'),decisionId:decision.id});
  return decision;
}
function threadSummaries(state){
  const reads=state.reads.owner;
  return state.threads.map(thread=>{const messages=state.messages.filter(m=>m.threadId===thread.id),last=messages.at(-1),seen=reads[thread.id]||0,task=state.tasks.find(t=>t.id===thread.taskId);
    return {...thread,title:task?.title||thread.title,status:task?.status||null,assignee:task?.assignee||null,lastMessage:last?{text:last.text.slice(0,160),sender:last.sender,at:last.at,seq:last.seq}:null,unread:messages.filter(m=>m.seq>seen&&m.sender.type!=='owner').length,openDecisions:state.decisions.filter(d=>d.threadId===thread.id&&d.status==='open').length,ownerDecisions:state.decisions.filter(d=>d.threadId===thread.id&&d.status==='open'&&(!d.target||d.target==='owner')).length};})
    .sort((a,b)=>(b.lastMessage?.seq||0)-(a.lastMessage?.seq||0));
}
function validate(state){
  if(state?.schemaVersion!==1||!Number.isInteger(state.version)||!Number.isInteger(state.nextSeq)||state.nextSeq<1||!Number.isInteger(state.firstSeq)||state.firstSeq<1||state.firstSeq>state.nextSeq||collections.some(key=>!Array.isArray(state[key]))||!state.reads?.owner||!state.requests)throw Error('Invalid workspace state.');
  let seq=0;for(const event of state.events){if(!Number.isInteger(event.seq)||event.seq<=seq||event.seq>=state.nextSeq)throw Error('Invalid event sequence.');seq=event.seq;}
}
function migrate(tasks){
  if(!Array.isArray(tasks))throw Error('Legacy tasks must be a list.');
  const state=empty();state.tasks=clone(tasks);
  for(const task of state.tasks){
    if(!task||typeof task.id!=='string')throw Error('Legacy task needs an id.');
    state.threads.push({id:task.id,taskId:task.id,title:task.title||'',createdAt:task.createdAt||new Date().toISOString()});
    for(const [index,message] of (Array.isArray(task.messages)?task.messages:[]).entries()){
      const event=emitEvent(state,{type:'message.imported',taskId:task.id,data:{legacy:true}});
      state.messages.push({id:`legacy-${task.id}-${index}`,threadId:task.id,taskId:task.id,seq:event.seq,at:message.at||event.at,sender:{type:'system',name:message.by||'Legacy'},kind:'text',text:String(message.text||'').slice(0,8000)});
    }
  }
  return state;
}
// Tasks blocked with questions before decisions existed get one open decision, so the owner can answer them.
function repairLegacyDecisions(draft,emit){
  let changed=false;
  for(const task of draft.tasks){
    if(task.status!=='blocked'||!task.questions||draft.decisions.some(d=>d.taskId===task.id&&d.status==='open'))continue;
    const questions=String(task.questions).split(/\n+/).map(q=>q.replace(/^\s*\d+[.)]\s*/,'').trim()).filter(Boolean).slice(0,10);
    if(!questions.length)continue;
    task.blockedReason=task.blockedReason||'decision';
    openDecision(draft,emit,{task,questions,target:'owner',path:[task.assignee,'owner'],askedBy:task.askedBy||null});changed=true;
  }
  return changed;
}
function createTaskStore({dataDir,write=atomicWrite}){
  fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'workspace.json'),legacy=path.join(dataDir,'tasks.json');let state;
  try{
    if(fs.existsSync(file)){state=JSON.parse(fs.readFileSync(file,'utf8'));state.firstSeq=Number.isInteger(state.firstSeq)?state.firstSeq:(Array.isArray(state.events)?state.events[0]?.seq??state.nextSeq:state.nextSeq);state.memories=state.memories||{};validate(state);}
    else{state=fs.existsSync(legacy)?migrate(JSON.parse(fs.readFileSync(legacy,'utf8'))):empty();validate(state);write(file,JSON.stringify(state,null,2));}
  }catch(error){throw new Error(`Cannot read task workspace: ${error.message}`);}
  {const draft=clone(state);const repaired=repairLegacyDecisions(draft,event=>emitEvent(draft,event)),trimmed=prune(draft);if(repaired||trimmed){draft.version=state.version+1;validate(draft);write(file,JSON.stringify(draft,null,2));state=draft;}}
  const listeners=new Set();
  function transaction(expectedVersion,mutate,{requestKey}={}){
    if(requestKey&&Object.hasOwn(state.requests,requestKey))return clone(state.requests[requestKey].result);
    if(expectedVersion!==undefined&&expectedVersion!==state.version)throw conflict('VERSION_CONFLICT','Workspace berubah. Muat ulang sebelum menyimpan.');
    const draft=clone(state),firstSeq=draft.nextSeq,result=mutate(draft,event=>emitEvent(draft,event));
    if(result&&typeof result.then==='function')throw Error('Transaction mutator must be synchronous.');
    for(const message of draft.messages)if(typeof message.text==='string')message.text=message.text.slice(0,8000);
    draft.version=state.version+1;
    if(requestKey)draft.requests[requestKey]={result:clone(result??null),at:new Date().toISOString()};
    prune(draft);
    validate(draft);write(file,JSON.stringify(draft,null,2));state=draft;
    const events=state.events.filter(event=>event.seq>=firstSeq);
    for(const listener of listeners){try{listener(clone(events));}catch{/* A view listener cannot roll back a committed write. */}}
    return clone(result);
  }
  function saveTasks(tasks){
    return transaction(state.version,(draft,emit)=>{
      const previous=new Map(draft.tasks.map(t=>[t.id,t]));
      for(const task of tasks){const old=previous.get(task.id);if(!old){draft.threads.push({id:task.id,taskId:task.id,title:task.title,createdAt:task.createdAt});emit({type:'task.created',taskId:task.id,rootId:task.rootId||task.id,agent:task.assignee,data:{status:task.status}});}else if(JSON.stringify(old)!==JSON.stringify(task)){emit({type:old.status!==task.status?'task.phase':'task.updated',taskId:task.id,rootId:task.rootId||task.id,agent:task.assignee,runId:task.runId||null,data:{from:old.status,to:task.status,phase:task.phase||task.status}});}}
      draft.tasks=clone(tasks);
    });
  }
  return {snapshot:()=>clone(state),saveTasks,transaction,firstSeq:()=>state.firstSeq,eventsAfter:(after=0,limit=200)=>clone(state.events.filter(e=>e.seq>after).slice(0,Math.max(1,Math.min(500,limit)))),subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}};
}
module.exports={remember,MEMORY_LIMIT,MEMORY_TEXT,acknowledge,sanitizeText,createTaskStore,transitionTask,ensureThread,addMessage,openDecision,threadSummaries,prune,EVENT_LIMIT,EVENT_MAX_AGE,REQUEST_LIMIT,REQUEST_TTL};
