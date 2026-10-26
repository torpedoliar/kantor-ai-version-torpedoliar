// Kantor Kita server: serves public/ and a small task API. Tasks assigned to an AI-enabled
// organization member (isAgent in data/org.json) are worked by the configured model, or by a labelled dry run.
// No login yet, so it only listens on this machine.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createSettings}=require('./settings');
const {createOrg,normalize:normalizeOrg}=require('./org');
const providers=require('./providers');
const {parseDraft}=require('./org-draft');
const {createTaskStore,addMessage,openDecision,threadSummaries,sanitizeText,acknowledge,remember,MEMORY_LIMIT,MEMORY_TEXT}=require('./task-store');
const {createOrchestrator}=require('./task-orchestrator');
const {createGate}=require('./concurrency');
const {createProjectWorkspace}=require('./project-workspace');
const runner=require('./project-runner');
const {createApplicationWorkflow}=require('./application-workflow');
const {createPreviewService}=require('./project-preview');
const {activityFor}=require('./task-activity');

const ROOT = path.resolve(__dirname, '..');
try { process.loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env')); } catch { /* no .env file: dry run */ }

const {buildAgent}=require('./agents');
// Wizard templates: suggested divisions with placeholder leads the owner renames in the wizard.
const templateOf=(type,label,divisions)=>({label,company:{name:'',type,description:''},
  divisions:divisions.map(([id,name],i)=>({id,name,lead:i?`Kepala ${name}`:'Pemilik',collaboratesWith:[]})),
  members:divisions.map(([id,name,role],i)=>({name:i?`Kepala ${name}`:'Pemilik',initials:i?name.slice(0,2).toUpperCase():'P',role,division:id,manager:i?'Pemilik':null,active:true}))});
const ORG_TEMPLATES={
  marketing:templateOf('Marketing office','Kantor marketing',[['leadership','Leadership','Direktur'],['marketing','Marketing','Marketing Lead'],['sales','Sales','Sales Lead']]),
  'software-dev':templateOf('Software dev','Software house',[['leadership','Leadership','CEO'],['engineering','Engineering','Engineering Lead'],['product','Product & Design','Product Lead']]),
  'creative-agency':templateOf('Agensi kreatif','Agensi kreatif',[['leadership','Leadership','Creative Director'],['creative','Creative','Art Lead'],['accounts','Client Service','Account Lead']]),
  retail:templateOf('Toko & retail','Toko & retail',[['leadership','Leadership','Pemilik toko'],['store','Toko','Kepala Toko'],['warehouse','Gudang','Kepala Gudang']]),
  example:{label:'Kantor Kita (contoh)',...(({company,divisions,members})=>({company,divisions,members}))(require('./org').seed())},
  empty:{label:'Mulai kosong',company:{name:'',type:'Lainnya',description:''},divisions:[],members:[]}
};
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const HOST = '127.0.0.1', PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
// manager-review: a staff draft waits for its manager's approval before it reaches the owner (one gate).
const STATES = new Set(['queued', 'active', 'blocked', 'manager-review', 'review', 'done']);
const PRIORITIES = new Set(['low','normal','high']);
const KINDS = new Set(['work','roster-review']);
const CSRF=crypto.randomBytes(32).toString('hex');
const settings=createSettings({dataDir:DATA_DIR,env:process.env,agents:{'Kak Rani':{model:'claude-sonnet-5-5'},'Kak Sinta':{model:'claude-haiku-4-5-20251001'}}});
// Every model call waits here: Pengaturan → Maks agen bersamaan (office) and each provider's own cap.
const modelGate=createGate(()=>settings.callLimits());
const agentMembers=()=>Object.fromEntries(org.roster().filter(m=>m.isAgent).map(m=>[m.name,m]));
const agentFor=name=>agentMembers()[name]||null;
const isMember=name=>org.roster().some(m=>m.name===name);
function archiveTasks(timestamp=Date.now()){const archiveDir=path.join(DATA_DIR,'archive');fs.mkdirSync(archiveDir,{recursive:true});const file=path.join(archiveDir,`tasks-${timestamp}.json`);fs.writeFileSync(file,JSON.stringify(tasks,null,2),{mode:0o600});return file;}
// One-time move of the older roster (data/team.json) into the organization, so custom members, AI picks and
// manager links survive instead of a fresh seed. team.json stays as a backup; a bad roster stops startup.
function orgFromTeam(team){
  if(!Array.isArray(team)||!team.length)throw new Error('roster is empty');
  const members=team.map(m=>({name:m.n,initials:m.initials,role:m.role,division:m.group,manager:m.manager??null,active:true,effort:'standard',workloadPct:100,isAgent:m.ai?.on===true,model:m.ai?.model||null,instructions:m.ai?.system||''}));
  const byName=new Map(members.map(m=>[m.name,m])),tops=id=>members.filter(m=>m.division===id&&byName.get(m.manager)?.division!==id);
  // ponytail: lead heuristic. A group whose people all report to one outsider below the top (a CTO seated in
  // leadership) gets that outsider as its lead, as in the built-in seed. Odd charts can be fixed in the org editor.
  for(const id of new Set(members.map(m=>m.division))){const t=tops(id),boss=byName.get(t[0]?.manager);
    if(t.length>1&&boss&&boss.manager!==null&&t.every(m=>m.manager===boss.name))boss.division=id;}
  const names=Object.fromEntries(require('./org').seed().divisions.map(d=>[d.id,d.name]));
  const divisions=[...new Set(members.map(m=>m.division))].map(id=>{const t=tops(id);return {id,name:names[id]||id,lead:(t.find(m=>members.some(x=>x.manager===m.name&&x.division===id))||t[0]).name,collaboratesWith:[]};});
  return normalizeOrg({version:0,company:{name:'Kantor Kita',type:'Lainnya',description:''},divisions,members});
}
{
  const orgFile=path.join(DATA_DIR,'org.json'),teamFile=path.join(DATA_DIR,'team.json');
  if(!fs.existsSync(orgFile)&&fs.existsSync(teamFile)){
    try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(orgFile,JSON.stringify(orgFromTeam(JSON.parse(fs.readFileSync(teamFile,'utf8'))),null,2),{mode:0o600});}
    catch(error){console.error(`Cannot migrate ${teamFile}: ${error.message}. Fix or move the file, then restart.`);process.exit(1);}
  }
}
const org=createOrg({dataDir:DATA_DIR});
const modelOf = agent => agent.model || MODEL;
const legacyDryRun=()=>!process.env.ANTHROPIC_API_KEY||process.env.ANTHROPIC_DRY_RUN==='1';
const serverOrigin=()=>`http://${HOST}:${PORT}`;
function guardRequest(req){
  const origin=req.headers.origin;
  if(origin&&origin!==serverOrigin()) { const error=new Error('Cross-origin requests are not allowed.');error.status=403;throw error; }
  if(req.method==='GET'||req.method==='HEAD')return;
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){const error=new Error('JSON requests are required.');error.status=415;throw error;}
  if(origin!==serverOrigin()||req.headers['x-kantor-csrf']!==CSRF){const error=new Error('A valid local session is required.');error.status=403;throw error;}
}

// ---- durable workspace: migrate the legacy tasks file once, then commit tasks and events together ----
const taskStore=createTaskStore({dataDir:DATA_DIR});
// ---- custom rooms (port dari orchestrator-patterns): template rooms on a floor plan, built into the 3D office ----
const roomsApi=require('./rooms');
const ROOMS_FILE=path.join(DATA_DIR,'rooms.json');
let roomList;
try{roomList=JSON.parse(fs.readFileSync(ROOMS_FILE,'utf8'));if(!Array.isArray(roomList))throw new Error('not a list');}
catch(error){if(error.code==='ENOENT')roomList=structuredClone(roomsApi.SEED);else{console.error(`Cannot read ${ROOMS_FILE}: ${error.message}. Fix or move the file, then restart.`);process.exit(1);}}
function saveRooms(){const tmp=`${ROOMS_FILE}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(roomList,null,2));fs.renameSync(tmp,ROOMS_FILE);}
if(!fs.existsSync(ROOMS_FILE))saveRooms();
const projects=createProjectWorkspace({dataDir:DATA_DIR});
const previews=createPreviewService({projects});
let tasks=taskStore.snapshot().tasks;
function save(){
  try{taskStore.saveTasks(tasks);}
  catch(error){tasks=taskStore.snapshot().tasks;throw error;}
}
// Messenger and decision writes: one transaction over the durable state, then refresh the working task list.
function commit(mutate,options){
  save();const result=taskStore.transaction(taskStore.snapshot().version,mutate,options);
  tasks=taskStore.snapshot().tasks;return result;
}
// Answering resolves the decision, records the owner's reply and requeues the task in one transaction.
// `by` is the owner (default) or the lead answering its own team member.
function answerDecision(id,answer,version,requestKey,by={type:'owner',name:'Owner'}){
  return commit((draft,emit)=>{
    const d=draft.decisions.find(x=>x.id===id);if(!d)throw Object.assign(new Error('Keputusan tidak ditemukan.'),{status:404});
    if(d.kind==='approval')throw Object.assign(new Error('Persetujuan eksekusi harus melalui panel sumber dan perintah.'),{status:409,code:'APPROVAL_REQUIRED'});
    if(d.status!=='open'||version!==d.version)throw Object.assign(new Error('Pertanyaan ini sudah berubah. Muat ulang dan jawab yang terbaru.'),{status:409,code:'VERSION_CONFLICT'});
    const t=draft.tasks.find(x=>x.id===d.taskId);
    Object.assign(d,{status:'answered',answer,answeredBy:by.name,answeredAt:new Date().toISOString(),version:d.version+1});
    addMessage(draft,emit,{task:t,sender:by,kind:'text',text:answer,decisionId:d.id});
    emit({type:'decision.answered',taskId:t.id,rootId:t.rootId||t.id,data:{decisionId:d.id,by:by.name}});
    const label=by.type==='owner'?'Answers':`Lead menjawab (${by.name})`;
    Object.assign(t,{status:'queued',blockedReason:null,brief:`${t.brief}\n\nQuestions from ${t.assignee}:\n${t.questions||''}\n\n${label}:\n${answer}`.trim().slice(0,5000),questions:undefined,askedBy:undefined,error:undefined,runId:null,version:(t.version||0)+1,updatedAt:now()});
    return {decision:d,task:t};
  },{requestKey});
}
const LEAD_ANSWER='MODE: ANSWER TEAM\nA member of your team asked the questions below while working on a subtask you delegated. Answer them yourself from the task context so they can continue. Reply with the answer only. If the question needs the owner (budget, scope, a final business decision, or facts you do not have), reply with exactly: ESCALATE: <one-line reason>.';
const OWNER_REPLY='MODE: REPLY\nThe owner just wrote to you in this task’s chat (latest Owner line in the conversation). Answer it directly and briefly in Indonesian. Use only facts from the task, its result and the WORKSPACE FACTS below; never invent file paths, folders or URLs. If the owner asks you to change or redo the work, say what you would change and that they can request a revision; do not claim you already did it. Reply with the answer only.';
// What actually exists for this task, so a reply never claims a folder or app that is not there.
function workspaceFacts(task){
  const state=taskStore.snapshot(),project=(state.projects||[]).find(p=>p.taskId===task.id||p.rootTaskId===(task.rootId||task.id));
  if(task.outputType!=='application')return 'This task produced a text document (status: '+task.status+'). No application project or files were created for it. Generated applications are stored by Kantor Kita in its own project storage, never directly in a folder the owner names; exporting to another folder needs the owner to use the export action in the app.';
  if(!project)return 'This is an application task (status: '+task.status+'), but no project files exist yet.';
  return 'Application project id '+project.id+' (status: '+(project.status||task.status)+'), stored in Kantor Kita project storage: data/projects/'+project.id+'. The owner can export it to a folder of their choice from the application panel.';
}
// The owner wrote on a task that is not running and has no open question: the assignee answers once in the thread.
async function ownerReply(taskId,messageId){
  const task=tasks.find(t=>t.id===taskId);if(!task||!agentFor(task.assignee))return;
  let reply;
  try{reply=(await askModel(task.assignee,{...task,brief:`${OWNER_REPLY}

WORKSPACE FACTS: ${workspaceFacts(task)}

Task brief: ${task.brief||''}

Current result (excerpt):
${String(task.result||'').slice(0,3000)}`})).text.trim();}
  catch(error){reply='';console.error(`Reply failed on "${task.title}": ${error.message}`);
    commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===taskId);if(t)addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'error',text:`${task.assignee} belum bisa membalas: ${sanitizeText(error.message).slice(0,300)}`});});return;}
  if(!reply)return;
  commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===taskId);if(t)addMessage(draft,emit,{task:t,sender:{type:'agent',name:t.assignee},kind:'reply',text:reply.slice(0,6000)});});
}
// The lead answers its team member; if it escalates or fails, the same decision is handed to the owner.
async function leadAnswer(taskId,decisionId,parent){
  const task=tasks.find(t=>t.id===taskId);if(!task)return;
  let reply;
  try{reply=(await askModel(parent.assignee,{...parent,title:`Pertanyaan dari ${task.assignee}: ${task.title}`,brief:`${LEAD_ANSWER}\n\nYour task: ${parent.title}\n${parent.brief||''}\n\nSubtask: ${task.title}\n${task.brief||''}\n\nQuestions:\n${task.questions||''}`})).text.trim();}
  catch(error){reply=`ESCALATE: ${sanitizeText(error.message)}`;}
  const d=taskStore.snapshot().decisions.find(x=>x.id===decisionId);if(!d||d.status!=='open')return;
  // A lead replying with its own QUESTIONS: does not know either — that is an escalation, not an answer.
  const escalate=reply.match(/^ESCALATE:\s*(.*)/i)||(/^QUESTIONS:/i.test(reply)?[reply,'lead juga butuh informasi dari owner']:null);
  // The owner may have answered while the lead was thinking: both paths re-check inside the transaction.
  if(!escalate&&reply){try{answerDecision(decisionId,reply.slice(0,3000),d.version,undefined,{type:'agent',name:parent.assignee});}catch(error){if(error.code!=='VERSION_CONFLICT')throw error;return;}setImmediate(kick);return;}
  commit((draft,emit)=>{const x=draft.decisions.find(y=>y.id===decisionId),t=draft.tasks.find(y=>y.id===taskId);if(!x||x.status!=='open'||x.version!==d.version||!t)return;Object.assign(x,{target:'owner',path:[...(x.path||[]),'owner'],version:x.version+1});Object.assign(t,{decisionTarget:'owner',version:(t.version||0)+1});
    addMessage(draft,emit,{task:t,sender:{type:'agent',name:parent.assignee},kind:'text',text:`Saya meneruskan pertanyaan ini ke owner${escalate?.[1]?`: ${escalate[1]}`:''}.`});
    emit({type:'decision.opened',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,data:{decisionId,target:'owner',escalatedBy:parent.assignee}});});
}
// Bounded conversation passed to the model: who said what, oldest first, never client-chosen authors.
// Capped so memory can't crowd out the brief and conversation in the prompt.
function memoryFor(name){return (taskStore.snapshot().memories?.[name]||[]).map(n=>`- ${n.text}`).join('\n').slice(-3000);}
function conversationFor(taskId){
  return taskStore.snapshot().messages.filter(m=>m.taskId===taskId).slice(-20).map(m=>`${m.sender.type==='owner'?'Owner':m.sender.name}: ${m.text}`).join('\n').slice(-6000);
}
const now = () => new Date().toISOString();
// A save that removes or deactivates someone is refused while they still have open tasks.
function busyMembers(next){
  const divisions=new Set((next?.divisions||[]).map(d=>d.id));
  const stranded=tasks.filter(task=>task.status!=='done'&&task.division&&!divisions.has(task.division));
  if(stranded.length)return {error:'Pindahkan tugas divisi sebelum menghapus divisinya.',code:'ORG_DIVISION_BUSY',tasks:stranded.map(({id,title,assignee,status})=>({id,title,assignee,status}))};
  const kept=new Set((Array.isArray(next?.members)?next.members:[]).filter(member=>member&&member.active!==false).map(member=>member.name));
  const open=tasks.filter(task=>task.status!=='done'&&!kept.has(task.assignee)&&org.state.members.some(member=>member.name===task.assignee&&member.active));
  return open.length?{error:'Pindahkan tugas yang masih terbuka sebelum menghapus atau menonaktifkan anggota.',code:'ORG_MEMBER_BUSY',tasks:open.map(({id,title,assignee,status})=>({id,title,assignee,status}))}:null;
}
const LEGACY_MEMBERS = new Set(['Koh Arman','Koh Wira','Kak Rani','Kak Dewi','Mira','Tari','Bagas Pratama Putra','Rizky Hakim','Yoga','Bang Eko','Gilang','Kak Sinta','Kak Laras']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const memberOf = name => org.roster().find(member => member.name === name && member.active) || (LEGACY_MEMBERS.has(name) ? {name,division:null,divisions:[]} : null);
const divisionOf = name => org.divisionOf(name);
const divisionsOf = name => org.divisionsOf(name);
const leadOf = division => org.state.divisions.find(item => item.id === division)?.lead || null;
const isLeadFor = (name, division) => leadOf(division) === name;
const taskDivision = task => task.division || divisionOf(task.assignee) || null;
// One-gate review: a draft by someone whose manager is below the top of the org waits in manager-review for that
// manager; reports of the top person (the owner's seat) go straight to the owner's review.
const managerGate = name => { const state=org.state,boss=state.members.find(m=>m.name===state.members.find(x=>x.name===name)?.manager); return boss&&boss.manager!==null?boss.name:null; };
const normalizeTask = task => ({
  ...task,
  version: Number.isInteger(task.version) ? task.version : 0,
  division: task.division || taskDivision(task),
  parentId: typeof task.parentId === 'string' && task.parentId ? task.parentId : null,
  asLead: task.asLead === true,
  priority: PRIORITIES.has(task.priority) ? task.priority : 'normal',
  progressPct: Number.isInteger(task.progressPct) ? Math.max(0,Math.min(100,task.progressPct)) : 0,
  messages: Array.isArray(task.messages) ? task.messages.filter(message=>message&&typeof message.text==='string').map(message=>({by:text(message.by,120),text:text(message.text,2000),at:typeof message.at==='string'?message.at:now()})) : [],
  kind: KINDS.has(task.kind) ? task.kind : 'work',
  legacy: task.legacy===true,
  createdBy: typeof task.createdBy==='string'&&task.createdBy?task.createdBy:'owner'
});
const normalizeStoredTasks = list => list.map(normalizeTask);
tasks = normalizeStoredTasks(tasks);

// ---- agent worker: one task at a time per connected member, oldest first ----
const busy = new Set(),liveTyping=new Map();
async function askConfigured(snapshot, agent, task,options={}) {
  let primaryError;
  // Settings → Maks token (null = unlimited); one empty-answer retry is announced in the thread.
  options={maxTokens:settings.publicState().maxTokens,onEmpty:()=>commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);if(t)addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'text',text:'Model hanya berpikir tanpa menulis jawaban; diminta menjawab langsung sekali lagi.'});}),...options};
  const gated=(provider,fn)=>modelGate.run({provider:provider.id,priority:task.priority||'normal',label:task.title||''},fn);
  try { return {answer:await gated(snapshot.provider,()=>providers.generate(snapshot.provider,snapshot.provider.credential,snapshot.modelId,agent,task,options)),route:snapshot.route,fallback:false}; }
  catch(error){ primaryError=error; }
  // Auth/invalid-request errors are configuration problems the owner must see; a backup model would hide them.
  // A reasoning-only empty answer ('empty') also falls back: another model may actually answer.
  if(snapshot.fallback&&!['auth','request','invalid'].includes(providers.classify(primaryError))){
    commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);if(t)addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'text',text:`Model ${snapshot.modelId} ${primaryError.category==='timeout'?'timeout':'gagal'} (${sanitizeText(primaryError.message||'').slice(0,160)}), dicoba dengan model ${snapshot.fallback.modelId} (cadangan).`});});
    options.onDelta?.('');
    return {answer:await gated(snapshot.fallback.provider,()=>providers.generate(snapshot.fallback.provider,snapshot.fallback.provider.credential,snapshot.fallback.modelId,agent,task,options)),route:snapshot.fallback.route,fallback:true,primaryError};
  }
  throw primaryError;
}
async function dryRun(member, task) {
  await new Promise(resolve => setTimeout(resolve, Number(process.env.DRY_RUN_DELAY_MS ?? 4000)));
  // Dry runs ask back when the brief is nearly empty, so the "Needs decision" flow can be tried without a key.
  if ((task.brief || '').trim().length < 12) return 'QUESTIONS:\n1. DRY RUN: who is this for, and what should it say?\n2. DRY RUN: any facts, links or deadlines to include?';
  return `DRY RUN: no ANTHROPIC_API_KEY is set, so this is placeholder text, not AI output.\n\n${member.role} would draft: "${task.title}".\nBrief received: ${task.brief || '(none)'}${task.feedback ? `\nRevision requested: ${task.feedback}` : ''}`;
}
async function work(name) {
  if (busy.has(name)) return;
  const state=taskStore.snapshot(),rank={high:0,normal:1,low:2};
  const task = tasks.filter(t => t.assignee === name && t.status === 'queued' && !t.error && !(t.kind === 'work' && t.asLead && !t.parentId && (!t.executionMode||t.executionMode==='manual') && t.outputType!=='application') && orchestrator.eligible(state,t)).sort((a, b) => (rank[a.priority]??1)-(rank[b.priority]??1) || a.createdAt.localeCompare(b.createdAt))[0];
  if (!task || tasks.some(t => t.assignee === name && t.status === 'active')) return;
  busy.add(name);
  const runId=crypto.randomUUID();
  const profile=org.roster().find(member=>member.name===name)||{};
  const snapshot=settings.resolve(name,profile);
  try {
    if(task.outputType==='application'){await applications.generate(task.id);return;}
    commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);const retry=!!t.retryRequested;Object.assign(t,{status:'active',runId,retryRequested:undefined,version:(t.version||0)+1,updatedAt:now()});emit({type:'task.phase',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{from:'queued',to:'active',phase:'active'}});
      if(retry||!draft.messages.some(m=>m.taskId===t.id&&m.kind==='ack'))acknowledge(draft,emit,t,{retry});});
    const input={...structuredClone(task),conversation:conversationFor(task.id),memory:memoryFor(name)};
    const worker=buildAgent(profile,org.state,snapshot.route||{});
    modelEvent('model.started',task,runId,{purpose:'work',providerId:snapshot.dryRun?null:snapshot.route?.providerId||null,modelId:snapshot.dryRun?'dry-run':snapshot.route?.modelId||null});
    let result;
    try{result = snapshot.dryRun ? {answer:await dryRun(worker, input),route:null,fallback:false} : await askConfigured(snapshot, worker, input,{onDelta:text=>{
      const current=tasks.find(t=>t.id===task.id);if(current?.runId!==runId)return;
      liveTyping.set(task.id,{runId,agent:name,text:sanitizeText(text).slice(-10000),updatedAt:now()});
    }});}
    catch(error){modelEvent('model.failed',task,runId,{purpose:'work',error:sanitizeText(error.message).slice(0,500)});throw error;}
    modelEvent('model.completed',task,runId,{purpose:'work',providerId:result.route?.providerId||null,modelId:snapshot.dryRun?'dry-run':result.route?.modelId||null,fallback:!!result.fallback});
    const answer=result.answer;
    const current = tasks.find(t => t.id === task.id);
    // The task may have been moved back to the queue or reassigned while the agent worked.
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) {
      const by=snapshot.dryRun?'dry-run':result.route?.modelId||worker.model,asked=answer.match(/^QUESTIONS:\s*([\s\S]+)/);
      // The agent asked instead of guessing: park the task until someone answers.
      if(asked){
        const target=org.escalationTarget(name),questions=asked[1].trim().slice(0,2000).split(/\n+/).map(q=>q.replace(/^\s*\d+[.)]\s*/,'').trim()).filter(Boolean).slice(0,10);
        // In a delegated plan the lead (when it is an AI agent) gets the question first; the owner only if it escalates.
        const parent=current.planRunId&&tasks.find(t=>t.id===current.parentId),leadAnswers=parent&&agentFor(parent.assignee);
        const decision=commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===current.id);Object.assign(t,{status:'blocked',blockedReason:'decision',retryCategory:undefined,autoAttempts:0,retryAt:undefined,questions:questions.map((q,i)=>`${i+1}. ${q}`).join('\n'),decisionTarget:leadAnswers?parent.assignee:'owner',decisionPath:leadAnswers?[name,parent.assignee]:[name,'owner'],askedBy:by,providerId:result.route?.providerId||null,modelId:result.route?.modelId||null,usedFallback:!!result.fallback,runId:null,version:(t.version||0)+1,updatedAt:now()});return openDecision(draft,emit,{task:t,questions,target:leadAnswers?parent.assignee:'owner',path:leadAnswers?[name,parent.assignee]:target.path,askedBy:by});});
        if(leadAnswers)setImmediate(()=>leadAnswer(current.id,decision.id,parent).catch(error=>console.error(`Lead answer failed: ${error.message}`)));
        return;
      }
      const draft={result:answer.slice(0,10000),by,providerId:result.route?.providerId||null,modelId:result.route?.modelId||null,usedFallback:!!result.fallback,createdAt:now(),feedback:input.feedback||''};
      // Delegated plan tasks are reviewed by their lead (orchestrator); other staff drafts pass their manager first.
      const reviewer=current.planRunId?null:managerGate(name),to=reviewer?'manager-review':'review';
      // The draft lands in the task's thread in the same commit, so Komunikasi shows what the agent actually sent.
      commit((store,emit)=>{const t=store.tasks.find(x=>x.id===current.id);Object.assign(t,{status:to,result:draft.result,by:draft.by,providerId:draft.providerId,modelId:draft.modelId,usedFallback:draft.usedFallback,history:[...(t.history||[]),draft],runId:null,retryCategory:undefined,autoAttempts:0,retryAt:undefined,version:(t.version||0)+1,updatedAt:now()});
        emit({type:'task.phase',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{from:'active',to,phase:to}});
        emit({type:'result.submitted',taskId:t.id,rootId:t.rootId||t.id,from:t.assignee,to:reviewer||(t.parentId?store.tasks.find(x=>x.id===t.parentId)?.assignee||'owner':'owner'),runId,data:{draft:true,...(reviewer?{manager:reviewer}:{})}});
        addMessage(store,emit,{task:t,sender:{type:'agent',name:t.assignee},kind:'result',text:draft.result});});
      // A manager connected to an AI agent reads the draft right away; the owner still decides.
      if(reviewer&&agentFor(reviewer))setImmediate(()=>managerAdvice(current.id));
    }
  } catch (error) {
    const current = tasks.find(t => t.id === task.id);
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) {
      const reason=sanitizeText(error.name === 'AbortError' ? 'Model terlalu lama menjawab.' : error.message === 'fetch failed' ? 'Provider tidak bisa dihubungi. Periksa koneksi.' : error.message).slice(0,500);
      // Transient provider trouble (rate limit, outage, timeout) retries itself with backoff instead of
      // parking the task until the owner returns; configuration errors still stop for the owner.
      const category=error.category||'',attempts=current.autoAttempts||0;
      const transient=RETRY_TRANSIENT.has(category)&&attempts<RETRY_DELAYS.length;
      const nextDelay=RETRY_DELAYS[Math.min(attempts,RETRY_DELAYS.length-1)];
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===current.id);
        Object.assign(t,{status:'queued',runId:null,version:(t.version||0)+1,updatedAt:now(),error:reason,
          ...(transient?{retryCategory:category,autoAttempts:attempts+1,retryAt:Date.now()+nextDelay}
            :{retryCategory:undefined,retryAt:undefined})});
        if(transient){
          emit({type:'task.retry_scheduled',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId:null,data:{attempt:attempts+1,of:RETRY_DELAYS.length,delayMs:nextDelay,category,reason}});
          // One error message per failure streak, posted on the first attempt, with the self-healing plan.
          if(attempts===0)addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'error',text:`${t.assignee} gagal mengerjakan tugas ini: ${reason}\nGangguan terdeteksi sementara (${category}); dicoba ulang otomatis ${attempts+1}/${RETRY_DELAYS.length} dalam ${Math.round(nextDelay/1000)} detik — tidak perlu melakukan apa pun.`});
        }else if(attempts===0){
          // The owner hears about it in the task thread (and Komunikasi alerts), not only from a card label.
          addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'error',text:`${t.assignee} gagal mengerjakan tugas ini: ${reason}\nBuka tugas lalu klik Coba lagi setelah masalahnya diperbaiki.`});
        }else{
          // The streak is exhausted: close the narration, then the alert and card label take over.
          addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'text',text:`Percobaan ulang otomatis dihentikan setelah ${attempts} kali; tugas menunggu keputusan pemilik.`});
        }});
      if(transient)armRetry(current.id);
    }
    console.error(`Agent ${name} failed on "${task.title}": ${error.message}`);
  } finally { liveTyping.delete(task.id);busy.delete(name); setImmediate(() => work(name)); }
}
// ---- automatic retry with backoff (audit R1): one timer per task, cancelled by any owner action ----
const RETRY_DELAYS=(process.env.KANTOR_RETRY_DELAYS_MS||'30000,120000,480000').split(',').map(v=>Math.max(0,Number(v)||0)).slice(0,10);
const RETRY_TRANSIENT=new Set(['quota','unavailable','connection','timeout']);
const retryTimers=new Map();
function armRetry(taskId,at){
  clearTimeout(retryTimers.get(taskId));retryTimers.delete(taskId);
  const task=tasks.find(t=>t.id===taskId);
  if(!task||task.status!=='queued'||!task.error||!RETRY_TRANSIENT.has(task.retryCategory||''))return;
  const due=at??task.retryAt,token=task.retryAt;
  if(!Number.isFinite(due))return;
  retryTimers.set(taskId,setTimeout(()=>{
    retryTimers.delete(taskId);
    const current=tasks.find(t=>t.id===taskId);
    // Any owner action that cleared or moved the task cancels the attempt (token mismatch).
    if(!current||current.status!=='queued'||!current.error||current.retryAt!==token)return;
    commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===taskId);if(!t||t.status!=='queued'||!t.error||t.retryAt!==token)return;
      Object.assign(t,{error:undefined,retryAt:undefined,retryRequested:true,version:(t.version||0)+1,updatedAt:now()});
      emit({type:'task.retry',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId:null,data:{attempt:t.autoAttempts,of:RETRY_DELAYS.length}});
      addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'text',text:`Percobaan ulang otomatis ${t.autoAttempts}/${RETRY_DELAYS.length} dimulai.`});});
    // The store subscription kicks the worker for the released task.
  },Math.max(0,due-Date.now())));
}
function modelEvent(type,task,runId,data){commit((draft,emit)=>{emit({type,taskId:task.id,rootId:task.rootId||task.id,agent:task.assignee,runId,data});});}
// ---- manager advice (port dari orchestrator-patterns): the AI manager recommends on every staff draft ----
// ---- at the gate; it never approves anything. Failure parks an error with a retry; boot retries what is missing. ----
const adviceBusy=new Set();
async function managerAdvice(taskId){
  if(adviceBusy.has(taskId))return;
  const task=tasks.find(t=>t.id===taskId);
  if(!task||task.status!=='manager-review'||task.managerAdvice)return;
  const manager=managerGate(task.assignee);
  if(!manager||!agentFor(manager))return;
  adviceBusy.add(taskId);
  const profile=org.roster().find(member=>member.name===manager)||{},snapshot=settings.resolve(manager,profile),runId=crypto.randomUUID();
  try{
    const prompt=[`You are ${manager}${profile.role?` (${profile.role})`:''}. Review this draft from your direct report before it reaches the owner.`,`Task: ${task.title}`,`Brief:\n${task.brief||'(no brief given)'}`,`Draft:\n${task.result}`,'Check facts first, then tone, then completeness. Keep it under 200 words and write in the language of the draft.','End with exactly one line: VERDICT: approve (ready for the owner) or VERDICT: revise (needs changes first).'].join('\n\n');
    const route={providerId:snapshot.dryRun?null:snapshot.route?.providerId||null,modelId:snapshot.dryRun?'dry-run':snapshot.route?.modelId||null};
    modelEvent('model.started',task,runId,{purpose:'manager-review',...route});
    let answer;
    if(snapshot.dryRun){await new Promise(r=>setTimeout(r,Number(process.env.DRY_RUN_DELAY_MS??2000)/2));answer=(task.brief||'').trim().length>=12?'DRY RUN review: the draft matches the brief; nothing obvious is missing.\nVERDICT: approve':'DRY RUN review: the brief is thin; ask for the missing details before approving.\nVERDICT: revise';}
    else answer=(await askConfigured(snapshot,buildAgent(profile,org.state,snapshot.route||{}),{...task,brief:prompt,feedback:''})).answer;
    modelEvent('model.completed',task,runId,{purpose:'manager-review',...route});
    const verdict=/VERDICT:\s*(approve|revise)/i.exec(answer)?.[1]?.toLowerCase()||'revise';
    const current=tasks.find(t=>t.id===taskId);
    // The draft may have been approved, rejected or moved while the manager read it.
    if(current&&current.status==='manager-review'&&!current.managerAdvice){
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===taskId);if(!t||t.status!=='manager-review'||t.managerAdvice)return;
        t.managerAdvice={verdict,text:answer.slice(0,4000),by:snapshot.dryRun?'dry-run':route.modelId||profile.model||'model',at:now()};t.adviceError=undefined;
        emit({type:'manager.advice',taskId:t.id,rootId:t.rootId||t.id,agent:manager,runId:null,data:{verdict,manager}});
        addMessage(draft,emit,{task:t,sender:{type:'agent',name:manager},kind:'advice',text:`${verdict==='approve'?'Setuju diteruskan ke owner':'Perlu revisi dulu'} — ${answer.slice(0,1400)}`});});
    }
  }catch(error){
    const reason=sanitizeText(error.name==='AbortError'?'Manajer terlalu lama meninjau.':error.message||'gagal').slice(0,500);
    const current=tasks.find(t=>t.id===taskId);
    if(current&&current.status==='manager-review'&&!current.managerAdvice){
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===taskId);if(!t||t.status!=='manager-review'||t.managerAdvice)return;t.adviceError=reason;
        emit({type:'manager.advice',taskId:t.id,rootId:t.rootId||t.id,agent:manager,runId:null,data:{error:reason}});});
    }
    console.error(`Manager advice by ${manager} failed on "${task.title}": ${error.message}`);
  }finally{adviceBusy.delete(taskId);}
}
// ---- decision SLA (audit R2): an owner decision that sits too long gets one reminder, ----
// ---- then a labelled recommendation from the top member when that member is an agent. ----
// ---- The owner still decides; this only keeps the pipeline from stalling silently. ----
const DECISION_SLA=Number(process.env.KANTOR_DECISION_SLA_MS||900000);
const DECISION_INSTRUCTIONS='You are the top member of this company. A task is stopped waiting for the owner to answer the questions below. Draft the best answer from the facts available: concrete, short, in the language of the task. If a fact is genuinely missing, say exactly what must be asked. This is a recommendation for the owner to confirm, not a decision.';
const recommending=new Set();
function decisionSlaTick(){
  const state=taskStore.snapshot(),top=org.state.members.find(m=>m.manager===null&&m.active);
  for(const d of state.decisions){
    if(d.status!=='open'||(d.target&&d.target!=='owner'))continue;
    const task=state.tasks.find(t=>t.id===d.taskId);
    if(!task)continue;
    const age=Date.now()-(Date.parse(d.openedAt)||0);
    if(!d.nudged&&age>=DECISION_SLA){
      commit((draft,emit)=>{const x=draft.decisions.find(z=>z.id===d.id);if(!x||x.status!=='open'||x.nudged)return;x.nudged=true;
        const t=draft.tasks.find(t=>t.id===x.taskId);
        addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'text',text:`Keputusan ini sudah menunggu lama dan menahan tugas "${t?t.title:''}". Jawab di Komunikasi agar pekerjaan lanjut.`});
        emit({type:'decision.nudged',taskId:x.taskId,rootId:t?.rootId||x.taskId,data:{decisionId:x.id}});});
    }else if(!d.recommended&&!recommending.has(d.id)&&age>=DECISION_SLA*2&&top&&agentFor(top.name)){
      recommending.add(d.id);
      askModel(top.name,{...task,brief:`${DECISION_INSTRUCTIONS}\n\nTask: ${task.title}\nBrief:\n${task.brief||'(none)'}\nQuestions blocking the task:\n${task.questions||''}`,feedback:''})
        .then(answer=>{commit((draft,emit)=>{const x=draft.decisions.find(z=>z.id===d.id);if(!x||x.status!=='open'||x.recommended)return;x.recommended=String(answer.text).slice(0,2000);
          const t=draft.tasks.find(t=>t.id===x.taskId);
          addMessage(draft,emit,{task:t,sender:{type:'agent',name:top.name},kind:'advice',text:`Saran jawaban (menunggu konfirmasi owner): ${x.recommended.slice(0,1200)}`});
          emit({type:'decision.recommended',taskId:x.taskId,rootId:t?.rootId||x.taskId,data:{decisionId:x.id,by:top.name}});});})
        .catch(error=>console.error(`Decision recommendation failed on "${task.title}": ${error.message}`))
        .finally(()=>recommending.delete(d.id));
    }
  }
}
setInterval(decisionSlaTick,Math.max(5000,Math.min(60000,Math.round(DECISION_SLA/4)))).unref();
// Live event streams: owner-only, replay by sequence, explicit resync when the client is too far behind.
const EVENT_REPLAY=500,streams=new Set();
taskStore.subscribe(events=>{for(const client of streams)for(const event of events)client.push(event);});
function openEventStream(req,res,after){
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'});
  // ponytail: a live client with over 1 MB unsent is dropped; it reconnects and resyncs from its cursor.
  const write=chunk=>{if(res.writableEnded)return;res.write(chunk);if(res.writableLength>1e6)client.close();};
  const client={cursor:after,push(event){if(event.seq>client.cursor){client.cursor=event.seq;write(`id: ${event.seq}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`);}},close(){streams.delete(client);clearInterval(beat);res.end();}};
  const beat=setInterval(()=>write(': heartbeat\n\n'),15000);
  const backlog=taskStore.eventsAfter(after,EVENT_REPLAY),latest=taskStore.snapshot().nextSeq-1;
  if(backlog.length&&backlog.at(-1).seq<latest){client.cursor=latest;write(`event: resync\ndata: ${JSON.stringify({seq:latest})}\n\n`);}
  else backlog.forEach(event=>client.push(event));
  streams.add(client);req.on('close',()=>{streams.delete(client);clearInterval(beat);});
}
// ---- application jobs: an owner approval binds revision + manifest hash + environment; one job per project, two overall ----
const JOB_LIMIT=2,RUN_TIMEOUT=Number(process.env.RUNNER_TIMEOUT_MS||120000),running=new Map();
function workspaceExport(state){const copy=structuredClone(state);delete copy.requests;for(const p of copy.projects||[])delete p.approvals;return copy;}
function projectRecord(state,id){return state.projects.find(p=>p.id===id);}
async function approveRun(projectId,input){
  const manifest=projects.verifyRevision(projectId,input.revisionId);
  if(input.manifestHash!==manifest.manifestHash)throw Object.assign(new Error('Sumber atau perintah berubah sejak kamu memeriksanya. Muat ulang lalu setujui lagi.'),{status:409,code:'APPROVAL_STALE'});
  const disk=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'projects',projectId,'project.json'),'utf8'));
  if(input.environment!==disk.environment)throw Object.assign(new Error(`Proyek ini memakai ${disk.environment}. Ganti lingkungan lewat keputusan terpisah.`),{status:409,code:'ENVIRONMENT_MISMATCH'});
  if(input.environment==='windows'&&input.acknowledgeHostAccess!==true)throw Object.assign(new Error(runner.WINDOWS_WARNING),{status:409,code:'HOST_ACCESS_ACK_REQUIRED'});
  const env=(await runner.environments())[input.environment];if(!env?.available)throw Object.assign(new Error(env?.reason||'Lingkungan tidak tersedia.'),{status:409,code:'ENVIRONMENT_UNAVAILABLE'});
  return commit((draft,emit)=>{
    let record=projectRecord(draft,projectId);if(!record){record={id:projectId,taskId:disk.taskId,environment:disk.environment,approvals:[]};draft.projects.push(record);}
    const approval={id:crypto.randomUUID(),revisionId:input.revisionId,manifestHash:manifest.manifestHash,environment:input.environment,imageDigest:env.imageDigest||null,networkAllowed:input.networkAllowed===true,approvedBy:'owner',approvedAt:now()};
    record.approvals.push(approval);emit({type:'job.approved',taskId:disk.taskId,data:{projectId,revisionId:input.revisionId,environment:input.environment}});return approval;
  });
}
function startJob(projectId,input,requestKey){
  const state=taskStore.snapshot(),record=projectRecord(state,projectId),manifest=projects.verifyRevision(projectId,input.revisionId);
  const approval=record?.approvals.find(a=>a.id===input.approvalId&&a.revisionId===input.revisionId&&a.manifestHash===manifest.manifestHash);
  if(!approval)throw Object.assign(new Error('Revisi ini belum kamu setujui untuk dijalankan.'),{status:403,code:'APPROVAL_REQUIRED'});
  if(requestKey&&state.requests[requestKey])return state.requests[requestKey].result;
  if(state.jobs.some(j=>j.projectId===projectId&&['queued','running'].includes(j.status)))throw Object.assign(new Error('Proyek ini masih punya job berjalan.'),{status:409,code:'JOB_ACTIVE'});
  if(running.size>=JOB_LIMIT)throw Object.assign(new Error('Sudah ada 2 job berjalan. Tunggu salah satu selesai.'),{status:409,code:'JOB_LIMIT'});
  const job=commit((draft,emit)=>{const j={id:crypto.randomUUID(),projectId,taskId:record.taskId,revisionId:input.revisionId,manifestHash:manifest.manifestHash,approvalId:approval.id,environment:approval.environment,status:'running',startedAt:now(),evidence:[]};draft.jobs.push(j);emit({type:'job.started',taskId:record.taskId,data:{jobId:j.id,projectId,environment:j.environment}});return j;},{requestKey});
  const controller=new AbortController();running.set(job.id,controller);
  const jobDir=path.join(DATA_DIR,'projects',projectId,'jobs',job.id);
  runner.run({job,sourceDir:projects.sourceDir(projectId,input.revisionId),manifest,jobDir,signal:controller.signal,timeoutMs:RUN_TIMEOUT,environment:approval.environment,networkAllowed:approval.networkAllowed,imageDigest:approval.imageDigest,
    onEvent:(type,data)=>commit((draft,emit)=>{emit({type,taskId:record.taskId,data:{jobId:job.id,...data}});})})
    .catch(error=>({status:error.code==='ENVIRONMENT_UNAVAILABLE'?'environment_unavailable':'failed',evidence:[{phase:'runner',exitCode:null,stderr:sanitizeText(error.message),argv:[]}]}))
    .then(result=>{running.delete(job.id);commit((draft,emit)=>{const j=draft.jobs.find(x=>x.id===job.id);if(!j||j.status!=='running')return;Object.assign(j,{status:result.status,evidence:result.evidence,finishedAt:now()});emit({type:`job.${result.status}`,taskId:record.taskId,data:{jobId:job.id}});});applications.completed(taskStore.snapshot().jobs.find(j=>j.id===job.id)).catch(error=>console.error(`Application completion failed: ${error.message}`));});
  return job;
}
// A restart cannot know how far a command got: running jobs become interrupted and are never rerun automatically.
function recoverJobs(){const stuck=taskStore.snapshot().jobs.filter(j=>['queued','running'].includes(j.status));if(stuck.length)commit((draft,emit)=>{for(const s of stuck){const j=draft.jobs.find(x=>x.id===s.id);Object.assign(j,{status:'interrupted',finishedAt:now()});emit({type:'job.interrupted',taskId:j.taskId,data:{jobId:j.id}});}});}
// One model call path for planning and synthesis: same routing, fallback and dry-run rules as ordinary work.
async function askModel(name,task){
  const profile=org.roster().find(member=>member.name===name)||{},snapshot=settings.resolve(name,profile),worker=buildAgent(profile,org.state,snapshot.route||{});
  const input={...task,conversation:conversationFor(task.id),memory:memoryFor(name)};
  if(snapshot.dryRun)return {text:await dryRun(worker,input),by:'dry-run'};
  if(snapshot.invalid)throw new Error('Agen ini belum punya provider/model yang valid. Atur di Pengaturan.');
  const result=await askConfigured(snapshot,worker,input);return {text:result.answer,by:result.route?.modelId||worker.model};
}
const applications=createApplicationWorkflow({snapshot:()=>taskStore.snapshot(),commit,projects,askModel,approveRun,startJob,smoke:async task=>{
  const preview=await previews.open(task),response=await fetch(preview.url,{signal:AbortSignal.timeout(5000)}),html=await response.text();
  if(!response.ok||!/<(?:html|title|body|h1|script)\b/i.test(html))throw Error('Halaman utama tidak dapat ditampilkan.');
  return {status:'passed',httpStatus:response.status,checkedAt:now(),check:'GET halaman utama pada origin loopback terpisah'};
}});
const orchestrator=createOrchestrator({snapshot:()=>taskStore.snapshot(),commit,org,askModel,buildApplication:(id,results)=>applications.generate(id,'Integrate these completed team results:\n'+results),canRun:name=>!!agentFor(name),log:message=>console.error(message)});
const kick = () => { orchestrator.wake(); Object.keys(agentMembers()).forEach(work); };
// Any committed change (new children, an answered decision, a finished dependency) may unblock work.
let kickQueued=false;taskStore.subscribe(()=>{if(kickQueued)return;kickQueued=true;setImmediate(()=>{kickQueued=false;kick();});});

// ---- HTTP ----
function send(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 1e6) { reject(Object.assign(new Error('Request too large'), {status: 413})); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), {status: 400})); } });
  });
}
function validateTaskPlacement(task, input={}) {
  const member=memberOf(task.assignee);if(!member)return {status:400,error:'Unknown assignee.'};
  const division=task.division||divisionOf(task.assignee);if(!division)return {status:400,error:'Pick a division.'};
  if(member.division&&member.division!==division)return {status:409,error:'Anggota tidak berada di divisi tugas.',code:'TASK_ROUTE_FORBIDDEN'};
  if(task.createdBy!=='owner'&&task.createdBy!==task.assignee){const route=org.communicationPath(task.createdBy,task.assignee);if(!route.allowed)return {status:409,error:'Task route is not allowed.',code:'TASK_ROUTE_FORBIDDEN'};}
  if(member.divisions?.length>1&&input.asLead===undefined&&task.parentId===null)return {status:409,error:'Choose whether this dual-hat member receives the task as lead.'};
  task.division=division;
  if(task.parentId){
    const parent=tasks.find(item=>item.id===task.parentId);if(!parent)return {status:400,error:'Parent task not found.'};
    if(taskDivision(parent)!==division)return {status:409,error:'A child task must stay in the parent division.',code:'TASK_ROUTE_FORBIDDEN'};
    if(parent.status==='done')return {status:409,error:'Tugas induk sudah selesai.'};
    const seen=new Set([task.id]);let cursor=parent;
    while(cursor){if(seen.has(cursor.id))return {status:409,error:'Hubungan tugas membentuk siklus.'};seen.add(cursor.id);cursor=cursor.parentId?tasks.find(item=>item.id===cursor.parentId):null;}
    if(parent.kind==='roster-review')return {status:409,error:'Roster review tasks cannot have child tasks.'};
  } else if(!isLeadFor(task.assignee,division) && !(division==='leadership'&&task.assignee==='Koh Arman')) return {status:409,error:'Root tasks must be assigned to a division lead.',code:'TASK_ROUTE_FORBIDDEN'};
  if(task.asLead&&!isLeadFor(task.assignee,division)) return {status:409,error:'Only the division lead can receive a lead task.',code:'TASK_ROUTE_FORBIDDEN'};
  if(task.parentId&&task.asLead&&task.assignee!==leadOf(division)) return {status:409,error:'Child tasks cannot use lead mode for another member.',code:'TASK_ROUTE_FORBIDDEN'};
  return null;
}
function privilegedTask(task) { return task.kind === 'roster-review' || task.parentId !== null || task.status === 'review' || task.status === 'manager-review'; }
function requireOrgToken(req, task) {
  if (!privilegedTask(task) || org.verifyToken(req.headers['x-kantor-org'])) return null;
  return {status:403,error:'A valid owner unlock is required for this action.',code:'ORG_LOCKED'};
}
function promoteParent(parentId){
  if(!parentId)return;
  const parent=tasks.find(item=>item.id===parentId);if(!parent)return;
  const children=tasks.filter(item=>item.parentId===parentId);if(children.length&&children.every(item=>item.status==='done')&&['queued','active'].includes(parent.status)){
    // A manual split has no lead synthesis: the owner reviews the children's own results, listed as the parent result.
    const result=parent.result||children.map(item=>`### ${item.title} (${item.assignee})\n${item.result||'(tanpa hasil)'}`).join('\n\n').slice(0,10000);
    Object.assign(parent,{status:'review',result,version:(parent.version||0)+1,updatedAt:now()});
  }
}
function newTask(input) {
  if(!input||typeof input!=='object')return null;
  const title = text(input.title, 160), assignee = text(input.assignee, 80);
  if (!title || !assignee) return null;
  const status = STATES.has(input.status) ? input.status : 'queued', result = text(input.result, 10000);
  const legacy=!Object.hasOwn(input,'division')&&!Object.hasOwn(input,'parentId')&&!Object.hasOwn(input,'asLead')&&!Object.hasOwn(input,'priority')&&!Object.hasOwn(input,'progressPct')&&!Object.hasOwn(input,'messages')&&!Object.hasOwn(input,'kind');
  const task = {id: crypto.randomUUID(), title, assignee, division:text(input.division,80)||divisionOf(assignee), parentId:typeof input.parentId==='string'&&input.parentId?input.parentId:null, createdBy:text(input.createdBy,120)||'owner', asLead:input.asLead===true, priority:PRIORITIES.has(input.priority)?input.priority:'normal', progressPct:Number.isInteger(input.progressPct)?Math.max(0,Math.min(100,input.progressPct)):0, messages:Array.isArray(input.messages)?input.messages:[], kind:KINDS.has(input.kind)?input.kind:'work', legacy, executionMode:['direct','manual'].includes(input.executionMode)?input.executionMode:input.executionMode==='automatic'||(input.asLead===true&&!input.parentId&&input.kind!=='roster-review'&&input.outputType!=='application')?'automatic':'direct', outputType:input.outputType==='application'?'application':'document', environment:input.outputType==='application'&&['docker','windows'].includes(input.environment)?input.environment:null, acceptance:Array.isArray(input.acceptance)?input.acceptance.map(a=>text(a,500)).filter(Boolean).slice(0,20):[], dependencyIds:[], phase:'queued', brief:text(input.brief,5000), status:['done','review','manager-review'].includes(status) && !result ? 'queued' : status, result, createdAt:now()};
  return normalizeTask(task);
}
async function api(req, res, url) {
  guardRequest(req);
  if (url.pathname === '/api/session' && req.method === 'GET') return send(res,200,{csrf:CSRF});
  if (url.pathname === '/api/settings' && req.method === 'GET') return send(res,200,settings.publicState());
  if (url.pathname === '/api/org/templates' && req.method === 'GET') return send(res,200,ORG_TEMPLATES);
  if (url.pathname === '/api/org' && req.method === 'GET') {
    if((req.headers.origin&&req.headers.origin!==serverOrigin())||req.headers['x-kantor-csrf']!==CSRF){const error=new Error('A valid local session is required.');error.status=403;throw error;}
    return send(res, 200, org.publicState());
  }
  if (url.pathname === '/api/org/unlock' && req.method === 'POST') {
    const input=await readJson(req);const token=org.unlock(input.pin);return send(res,200,{token});
  }
  if (url.pathname === '/api/org' && req.method === 'PUT') {
    const input=await readJson(req);const token=req.headers['x-kantor-org'];if(org.verifyToken(token)){const busyError=busyMembers(input);if(busyError)return send(res,409,busyError);}const saved=org.save(input,token,input.version);setImmediate(kick);return send(res,200,saved);
  }
  if (url.pathname === '/api/org/wizard' && req.method === 'POST') {
    const input=await readJson(req),token=req.headers['x-kantor-org'];
    if(!org.verifyToken(token))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    if(input.version!==org.state.version)return send(res,409,{error:'Organization changed in another tab. Reload before saving.'});
    const candidate=normalizeOrg(input.draft),moves=input.reassignments||{},before=tasks;
    const next=tasks.map(task=>{const name=moves[task.assignee];if(task.status==='done'||!name)return task;const target=candidate.members.find(m=>m.name===name&&m.active);if(!target)throw Object.assign(new Error('Pilih anggota aktif tujuan.'),{status:400});if(task.status==='active')throw Object.assign(new Error('Tunggu tugas AI aktif selesai.'),{status:409});return {...task,assignee:name,division:target.division,status:task.status==='review'?'review':'queued',runId:null,version:(task.version||0)+1,updatedAt:now()};});
    tasks=next;const busyError=busyMembers(candidate);if(busyError){tasks=before;return send(res,409,busyError);}
    try{const result=org.save(candidate,token,input.version);save();return send(res,200,result);}catch(error){tasks=before;throw error;}
  }
  // "Mulai dari 0": the chosen model drafts an organization from the company profile. Nothing is saved here.
  if (url.pathname === '/api/org/ai-draft' && req.method === 'POST') {
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),company=input?.company||{},route=input?.route||{};
    const provider=settings.state.providers.find(p=>p.id===route.providerId),model=provider?.models.find(m=>m.id===route.modelId);
    if(!provider||!model)return send(res,400,{error:'Pilih model dari provider yang sudah diambil.'});
    const credential=settings.credential(provider.id);if(!credential)return send(res,400,{error:'Provider ini belum punya API key.'});
    const system='You design small-company org charts. Reply with JSON only: {"divisions":[{"id":"kebab-id","name":"...","lead":"person name","collaboratesWith":["division id"]}],"members":[{"name":"...","role":"...","division":"division id","manager":"person name or null","effort":"light|standard|deep"}]}. Rules: 3-6 divisions, 6-20 people, Indonesian role titles, unique realistic Indonesian names, exactly one top person with manager null who leads the leadership division, every division lead belongs to that division and reports to the top person, everyone else reports to someone in their own division, no cycles. effort: deep for leads and complex work, light for routine work, otherwise standard.';
    const brief=`Nama perusahaan: ${text(company.name,160)}
Jenis usaha: ${text(company.type,160)}
Keterangan: ${text(company.description,4000)||'(tidak ada)'}`;
    let correction='';
    // One bounded retry asks the same model for a complete corrected document, not a guessed or partial roster.
    for(let attempt=0;attempt<2;attempt++){
      let answer;try{answer=await providers.generate(provider,credential,model.id,{system},{title:'Susun struktur organisasi',brief:brief+correction},{maxTokens:10000});}
      catch(error){return send(res,502,{error:`Provider/model ${model.id} gagal: ${error.message}`,code:'PROVIDER_FAILED'});}
      try{
        const parsed=parseDraft(answer);
        const members=parsed.members.map(m=>({name:text(m?.name,120),role:text(m?.role,120),division:text(m?.division,80),manager:m?.manager?text(m.manager,120):null,effort:['light','standard','deep'].includes(m?.effort)?m.effort:'standard',workloadPct:100,instructions:'',active:true,isAgent:true}));
        if(!members.length||members.length>40||!parsed.divisions.length||parsed.divisions.length>12)throw new Error('Gunakan 1–12 divisi dan 1–40 orang.');
        const draft=normalizeOrg({company,divisions:parsed.divisions,members});return send(res,200,{divisions:draft.divisions,members:draft.members});
      }catch(error){
        if(attempt)return send(res,422,{error:`AI belum menghasilkan organisasi yang valid setelah koreksi: ${error.message}`,code:'AI_DRAFT_INVALID'});
        correction=`\n\nYour previous response could not be used: ${error.message}. Return one COMPLETE JSON object with divisions and members. Keep it compact: 3 divisions and 6–10 members unless the brief requires more. Do not include explanations, markdown or thinking.`;
      }
    }
  }
  if (url.pathname === '/api/org/reset' && req.method === 'POST') {
    const input=await readJson(req);if(input.confirmation!=='RESET')return send(res,400,{error:'Ketik RESET untuk mengonfirmasi reset.'});if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const state=taskStore.snapshot();if(tasks.some(task=>task.status==='active')||state.jobs.some(job=>['queued','running'].includes(job.status)))return send(res,409,{error:'Selesaikan atau batalkan tugas/job aktif sebelum reset.',code:'JOB_ACTIVE'});
    if(input.version!==org.state.version)return send(res,409,{error:'Organisasi berubah. Muat ulang sebelum reset.'});
    const stamp=Date.now(),archiveFile=archiveTasks(stamp),workspaceArchiveName=`workspace-${stamp}.json`;
    fs.writeFileSync(path.join(DATA_DIR,'archive',workspaceArchiveName),JSON.stringify(workspaceExport(state),null,2),{mode:0o600});
    const result=org.reset(input.version);for(const task of tasks)await previews.stop(task.id);
    commit(draft=>{for(const key of ['tasks','threads','messages','decisions','events','projects','jobs'])draft[key]=[];draft.reads={owner:{}};draft.requests={};draft.memories={};});
    return send(res,200,{archiveFile,archiveName:path.basename(archiveFile),workspaceArchiveName,org:result});
  }
  if(url.pathname==='/api/workspace/export'&&req.method==='GET'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    return send(res,200,workspaceExport(taskStore.snapshot()));
  }
  const workspaceArchive=url.pathname.match(/^\/api\/workspace\/archive\/(workspace-\d+\.json)$/);
  if(workspaceArchive&&req.method==='GET'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    try{return send(res,200,JSON.parse(fs.readFileSync(path.join(DATA_DIR,'archive',workspaceArchive[1]),'utf8')));}catch{return send(res,404,{error:'Arsip tidak ditemukan.'});}
  }
  // Archived task lists are served by name only, so no path outside data/archive can be read.
  const archiveMatch=url.pathname.match(/^\/api\/org\/archive\/(tasks-\d+\.json)$/);
  if(archiveMatch&&req.method==='GET'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    try{return send(res,200,JSON.parse(fs.readFileSync(path.join(DATA_DIR,'archive',archiveMatch[1]),'utf8')));}catch{return send(res,404,{error:'Arsip tidak ditemukan.'});}
  }
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const roster=agentMembers();const entries=Object.entries(roster).map(([name,a])=>{const route=settings.resolve(name,a);return [name,{role:a.role,model:route.modelId||a.model||MODEL,provider:route.provider?.displayName||null,mode:route.dryRun?'dry-run':'claude'}]});const dry=entries.every(([,a])=>a.mode==='dry-run');return send(res,200,{mode:dry?'dry-run':'claude',model:dry?null:MODEL,settingsVersion:settings.publicState().version,members:Object.fromEntries(entries)});
  }
  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    const input=await readJson(req);const result=settings.save(input,input.version);modelGate.poke();return send(res,200,result);
  }
  const modelMatch=url.pathname.match(/^\/api\/settings\/providers\/([^/]+)\/models$/);
  if(modelMatch&&req.method==='POST'){
    const current=settings.publicState(),provider=current.providers.find(item=>item.id===decodeURIComponent(modelMatch[1]));
    if(!provider)return send(res,404,{error:'Provider not found.'});
    const input=await readJson(req),credential=input.credential||settings.credential(provider.id)||'';
    if(!credential)return send(res,400,{error:'Provider credential is missing.'});
    const found=await providers.discoverModels(provider,credential);const saved={...settings.state,version:current.version,providers:settings.state.providers.map(item=>item.id===provider.id?{...item,models:found.map(model=>({...model,source:'fetched',enabled:item.models.find(old=>old.id===model.id)?.enabled??true,status:'verified',lastSeenAt:new Date().toISOString()}))}:item)};
    return send(res,200,settings.save(saved,current.version));
  }
  const testMatch=url.pathname.match(/^\/api\/settings\/providers\/([^/]+)\/test$/);
  if(testMatch&&req.method==='POST'){
    const current=settings.publicState(),provider=current.providers.find(item=>item.id===decodeURIComponent(testMatch[1]));if(!provider)return send(res,404,{error:'Provider not found.'});
    const input=await readJson(req),credential=input.credential||settings.credential(provider.id)||'';if(!credential)return send(res,400,{error:'Provider credential is missing.'});
    await providers.testConnection(provider,credential,input.modelId);return send(res,200,{ok:true,checkedAt:new Date().toISOString()});
  }
  // Per-member model routes chosen in the organization chart or wizard. Owner-only; '' clears the override.
  if(url.pathname==='/api/settings/member-routes'&&req.method==='PUT'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),routes=input?.routes&&typeof input.routes==='object'?input.routes:{},current=settings.state;
    const overrides={...current.overrides},providersNext=current.providers.map(p=>({...p,models:p.models.map(m=>({...m}))}));
    for(const [name,route] of Object.entries(routes)){
      if(!route){delete overrides[name];continue;}
      const provider=providersNext.find(p=>p.id===route.providerId),model=provider?.models.find(m=>m.id===route.modelId);
      if(!provider||!model)return send(res,400,{error:`Model ${route.modelId||''} tidak ada di provider.`});
      model.enabled=true;overrides[name]={providerId:provider.id,modelId:model.id};
    }
    return send(res,200,settings.save({...current,providers:providersNext,overrides},current.version));
  }
  if(url.pathname==='/api/settings/reset'&&req.method==='POST'){
    const input=await readJson(req);return send(res,200,settings.save({...settings.state,providers:[],defaultRoute:null,fallbackRoute:null,overrides:{}},input.version));
  }
  if (url.pathname === '/api/rooms' && req.method === 'GET') return send(res, 200, roomList);
  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req);
    const v=roomsApi.validateRoom(input,roomList,null);
    if(!v.ok)return send(res,['dup','overlap'].includes(v.code)?409:400,{error:v.error});
    if(v.room.owner&&!isMember(v.room.owner))return send(res,400,{error:'Unknown room owner.'});
    const room={id:`room-${crypto.randomUUID().slice(0,8)}`,furniture:[],...v.room};
    roomList.push(room);saveRooms();return send(res,201,room);
  }
  const roomMatch=url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if(roomMatch&&(req.method==='PATCH'||req.method==='DELETE')){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const id=decodeURIComponent(roomMatch[1]),room=roomList.find(r=>r.id===id);
    if(!room)return send(res,404,{error:'Room not found.'});
    if(req.method==='DELETE'){
      // The scene knows who sits where; the caller reports the count and the server refuses a busy room.
      const occupants=Number(new URL(req.url,'http://x').searchParams.get('occupants')||0);
      if(room.builtIn)return send(res,409,{error:'Ruangan ini bagian dari kantor; ubah namanya saja, jangan dihapus.'});
      if(occupants>0)return send(res,409,{error:'Ada yang sedang memakai ruangan ini. Suruh kembali kerja dulu.'});
      roomList.splice(roomList.indexOf(room),1);saveRooms();return send(res,200,{removed:id});
    }
    const input=await readJson(req);
    // Built-in rooms mirror the 3D office geometry: rename only.
    if(room.builtIn){
      const name=typeof input?.name==='string'?input.name.trim():'';
      if(!name||name.length>80)return send(res,400,{error:'Name must be 1-80 characters.'});
      if(roomList.some(r=>r.name.toLowerCase()===name.toLowerCase()&&r.id!==id))return send(res,409,{error:'That room name is already used.'});
      room.name=name;saveRooms();return send(res,200,room);
    }
    const v=roomsApi.validateRoom(input,roomList,id);
    if(!v.ok)return send(res,['dup','overlap'].includes(v.code)?409:400,{error:v.error});
    if(v.room.owner&&!isMember(v.room.owner))return send(res,400,{error:'Unknown room owner.'});
    Object.assign(room,v.room,{furniture:v.room.furniture??room.furniture??[]});
    saveRooms();return send(res,200,room);
  }
  if (url.pathname.startsWith('/api/task-events') && req.method === 'GET' && !org.verifyToken(req.headers['x-kantor-org']||url.searchParams.get('token')))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
  if (url.pathname === '/api/task-events/snapshot' && req.method === 'GET') {
    const state=taskStore.snapshot();return send(res,200,{seq:state.nextSeq-1,tasks:state.tasks,streams:streams.size});
  }
  if (url.pathname === '/api/task-events' && req.method === 'GET') {
    const after=Math.max(0,Number(req.headers['last-event-id']??url.searchParams.get('after')??0)||0);
    if((req.headers.accept||'').includes('text/event-stream'))return openEventStream(req,res,after);
    return send(res,200,{events:taskStore.eventsAfter(after,EVENT_REPLAY)});
  }
  if (url.pathname === '/api/communications' && req.method === 'GET') {
    const after=Number(url.searchParams.get('after')||0),state=taskStore.snapshot();
    // Alerts are derived from current task state: they clear by themselves once the task is retried or recovers.
    const alerts=state.tasks.filter(t=>t.error&&!t.retryAt&&(t.status==='queued'||(t.status==='blocked'&&['failed','interrupted','environment_unavailable'].includes(t.blockedReason)))).map(t=>({taskId:t.id,assignee:t.assignee,text:`${t.title}: ${t.error}`.slice(0,300),since:t.updatedAt}));
    return send(res,200,{threads:threadSummaries(state),messages:state.messages.filter(m=>m.seq>after).slice(-200),decisions:state.decisions,alerts,reads:state.reads.owner,nextSeq:state.nextSeq});
  }
  // Generated sources: owner-only metadata and per-file download as plain text (never served as runnable pages here).
  const revMatch=url.pathname.match(/^\/api\/projects\/([^/]+)\/revisions\/([^/]+)(?:\/files\/(.+))?$/);
  if(revMatch&&req.method==='GET'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const [,projectId,revisionId,file]=revMatch.map(v=>v&&decodeURIComponent(v));
    if(!file)return send(res,200,projects.manifest(projectId,revisionId));
    const content=projects.readFile(projectId,revisionId,file);
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':`attachment; filename="${path.basename(file).replace(/[^\w.-]/g,'_')}"`,'x-content-type-options':'nosniff','cache-control':'no-store'});return res.end(content);
  }
  // Owner copies a verified revision to a folder of their choice (e.g. E:\Vibe\Calculator); overwrite needs explicit consent.
  const exportMatch=url.pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/revisions\/([0-9a-f-]{36})\/export$/);
  if(exportMatch&&req.method==='POST'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req);
    try{return send(res,200,projects.exportRevision(exportMatch[1],exportMatch[2],typeof input?.target==='string'?input.target:'',{overwrite:input?.overwrite===true}));}
    catch(error){if(error.code==='EXPORT_NOT_EMPTY')return send(res,409,{error:error.message,code:error.code});throw error;}
  }
  if(url.pathname==='/api/execution/environments'&&req.method==='GET')return send(res,200,await runner.environments());
  const previewMatch=url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/application\/(preview|stop-preview)$/);
  if(previewMatch&&req.method==='POST'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const task=tasks.find(t=>t.id===previewMatch[1]);if(!task||!applications.canReview(task))return send(res,409,{error:'Revisi belum memiliki bukti pengujian.',code:'EVIDENCE_REQUIRED'});
    if(previewMatch[2]==='stop-preview'){await previews.stop(task.id);return send(res,200,{stopped:true});}
    return send(res,200,await previews.open(task));
  }
  const appApprove=url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/application\/approve$/);
  if(appApprove&&req.method==='POST'){if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});return send(res,202,await applications.approve(appApprove[1],await readJson(req)));}
  const projMatch=url.pathname.match(/^\/api\/projects\/([^/]+)\/(approve|run)$/),jobMatch=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/cancel)?$/);
  if((projMatch&&req.method==='POST')||jobMatch){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    if(jobMatch&&!jobMatch[2]&&req.method==='GET'){const job=taskStore.snapshot().jobs.find(j=>j.id===jobMatch[1]);return job?send(res,200,job):send(res,404,{error:'Job tidak ditemukan.'});}
    if(jobMatch&&jobMatch[2]&&req.method==='POST'){const controller=running.get(jobMatch[1]);if(!controller)return send(res,409,{error:'Job tidak sedang berjalan.'});controller.abort();return send(res,200,{id:jobMatch[1],cancelling:true});}
    if(projMatch){const input=await readJson(req),id=decodeURIComponent(projMatch[1]);
      if(projMatch[2]==='approve')return send(res,201,await approveRun(id,input));
      return send(res,202,startJob(id,input,req.headers['x-kantor-request']));}
  }
  const readMatch=url.pathname.match(/^\/api\/communications\/([^/]+)\/read$/);
  if(readMatch&&req.method==='PUT'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),id=decodeURIComponent(readMatch[1]);
    const state=taskStore.snapshot();if(!state.threads.some(t=>t.id===id))return send(res,404,{error:'Percakapan tidak ditemukan.'});
    const through=Math.min(Number(input?.throughSeq)||0,state.nextSeq-1);
    commit(draft=>{if(through>(draft.reads.owner[id]||0))draft.reads.owner[id]=through;});
    return send(res,200,{threadId:id,throughSeq:taskStore.snapshot().reads.owner[id]||0});
  }
  const threadMatch=url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(thread|messages)$/);
  // Agent memory: the owner reads, edits or clears what an agent carries into its next task.
  const memoryMatch=url.pathname.match(/^\/api\/agents\/([^/]+)\/memory$/);
  if(memoryMatch&&['GET','PUT'].includes(req.method)){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const name=decodeURIComponent(memoryMatch[1]);if(!org.state.members.some(m=>m.name===name))return send(res,404,{error:'Anggota tidak ditemukan.'});
    if(req.method==='PUT'){const input=await readJson(req);const items=(Array.isArray(input?.items)?input.items:[]).map(i=>text(i?.text,MEMORY_TEXT)).filter(Boolean).slice(-MEMORY_LIMIT);
      commit(draft=>{draft.memories=draft.memories||{};draft.memories[name]=items.map(t=>({text:t,at:now()}));});}
    return send(res,200,{agent:name,items:taskStore.snapshot().memories?.[name]||[],limit:MEMORY_LIMIT});
  }
  const activityMatch=url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/activity$/);
  if(activityMatch&&req.method==='GET'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const result=activityFor(taskStore.snapshot(),activityMatch[1],{agents:Object.keys(agentMembers())});
    return result?send(res,200,{...result,typing:liveTyping.get(activityMatch[1])||null}):send(res,404,{error:'Task not found.'});
  }
  if(threadMatch&&req.method==='GET'&&threadMatch[2]==='thread'){
    const state=taskStore.snapshot();if(!state.tasks.some(t=>t.id===threadMatch[1]))return send(res,404,{error:'Task not found.'});
    return send(res,200,{messages:state.messages.filter(m=>m.taskId===threadMatch[1]),decisions:state.decisions.filter(d=>d.taskId===threadMatch[1])});
  }
  if(threadMatch&&req.method==='POST'&&threadMatch[2]==='messages'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),body=text(input?.text,8000);if(!body)return send(res,400,{error:'Tulis pesan dulu.'});
    const task=tasks.find(t=>t.id===threadMatch[1]);if(!task)return send(res,404,{error:'Task not found.'});
    // On a failed task the owner's message ("lanjutkan", "coba lagi", or any instruction) retries it with that message as context.
    if(task.error&&task.status==='queued'){
      const message=commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);Object.assign(t,{error:undefined,retryRequested:true,retryAt:undefined,version:(t.version||0)+1,updatedAt:now()});return addMessage(draft,emit,{task:t,sender:{type:'owner',name:'Owner'},text:body});},{requestKey:req.headers['x-kantor-request']});
      setImmediate(kick);return send(res,201,{...message,retried:true,pendingForNextStep:false});
    }
    // While the agent waits on questions, a chat reply IS the answer: resolve the open decision and resume once.
    const open=taskStore.snapshot().decisions.find(d=>d.taskId===task.id&&d.status==='open'&&d.kind!=='approval');
    if(open){answerDecision(open.id,body,open.version,req.headers['x-kantor-request']);setImmediate(kick);
      const message=taskStore.snapshot().messages.filter(m=>m.decisionId===open.id&&m.sender.type==='owner').at(-1);
      return send(res,201,{...message,answeredDecision:true,pendingForNextStep:false});}
    // A running agent reads this in its next model call; it is not claimed as consumed now.
    const message=commit((draft,emit)=>addMessage(draft,emit,{task:draft.tasks.find(t=>t.id===task.id),sender:{type:'owner',name:'Owner'},text:body}),{requestKey:req.headers['x-kantor-request']});
    // Not running and nothing pending: the assignee replies now instead of the message sitting unanswered.
    const willReply=task.status!=='active'&&!!agentFor(task.assignee);
    if(willReply)setImmediate(()=>ownerReply(task.id,message.id).catch(error=>console.error(`Owner reply failed: ${error.message}`)));
    return send(res,201,{...message,pendingForNextStep:task.status==='active',willReply});
  }
  const decisionMatch=url.pathname.match(/^\/api\/decisions\/([0-9a-f-]{36})\/answer$/);
  if(decisionMatch&&req.method==='POST'){
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),answer=text(input?.answer,3000);if(!answer)return send(res,400,{error:'Tulis jawaban dulu.'});
    const result=answerDecision(decisionMatch[1],answer,input?.version,req.headers['x-kantor-request']);setImmediate(kick);return send(res,200,result);
  }
  if (url.pathname === '/api/tasks' && req.method === 'GET') return send(res, 200, tasks);
  // Moves every open task of one member to another, so a member can be removed or deactivated.
  if (url.pathname === '/api/tasks/reassign' && req.method === 'POST') {
    if(!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required.',code:'ORG_LOCKED'});
    const input=await readJson(req),from=text(input?.from,120),to=text(input?.to,120),target=org.roster().find(member=>member.name===to);
    if(!from||!target||from===to)return send(res,400,{error:'Pilih anggota aktif tujuan.'});
    const open=tasks.filter(task=>task.assignee===from&&task.status!=='done');
    if(open.some(task=>task.status==='active'))return send(res,409,{error:'Tunggu tugas AI yang sedang berjalan selesai dulu.'});
    for(const task of open)Object.assign(task,{assignee:to,division:target.division,status:task.status==='review'?'review':'queued',runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
    save();setImmediate(kick);return send(res,200,{moved:open.length});
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const input=await readJson(req);
    if(input?.status!==undefined&&!STATES.has(input.status))return send(res,400,{error:'Unknown status.'});
    const task = newTask(input); if (!task) return send(res, 400, {error: 'A task needs a title and an assignee.'});
    if(task.kind==='roster-review'&&!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required to request a roster review.',code:'ORG_LOCKED'});
    if(task.parentId&&!org.verifyToken(req.headers['x-kantor-org']))return send(res,403,{error:'A valid owner unlock is required for this action.',code:'ORG_LOCKED'});
    if(task.parentId && tasks.some(item=>item.kind==='roster-review'&&item.division===task.division&&item.status!=='done'))return send(res,409,{error:'Complete the pending roster review before creating more child tasks in this division.'});
    const placement=validateTaskPlacement(task,input);if(placement)return send(res,placement.status,{error:placement.error,code:placement.code});
    if(agentFor(task.assignee)){const route=settings.resolve(task.assignee,agentFor(task.assignee));if(!route.dryRun&&route.invalid)return send(res,409,{error:'This agent has no valid provider/model route. Fix it in Settings.'});}
    if(task.status==='review'||task.status==='blocked'||task.status==='manager-review'||(agentFor(task.assignee)&&task.status!=='queued'))return send(res,409,{error:'AI drafts must be generated before review.'});
    if(task.status==='active'&&tasks.some(t=>t.assignee===task.assignee&&t.status==='active'))return send(res,409,{error:'This member already has an active task.'});
    tasks.unshift(task); save(); send(res, 201, task); setImmediate(kick); return;
  }
  // One-time move of tasks saved in a browser before the server existed; only into an empty store.
  if (url.pathname === '/api/tasks/import' && req.method === 'POST') {
    if (tasks.length) return send(res, 409, {error: 'The server already has tasks.'});
    const list = await readJson(req); if (!Array.isArray(list)) return send(res, 400, {error: 'Expected a list of tasks.'});
    if(tasks.length)return send(res,409,{error:'The server already has tasks.'});
    tasks = list.map(item => { const task = newTask({...item,legacy:true}); if (task && typeof item.createdAt === 'string') task.createdAt = item.createdAt; if(task&&Array.isArray(item.history))task.history=item.history; return task; }).filter(Boolean);
    // Imported work that was in progress by hand goes back to the queue.
    tasks.forEach(task => { if (task.status === 'active') task.status = 'queued'; });
    save(); kick(); return send(res, 201, tasks);
  }
  const match = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
  if (match && req.method === 'PATCH') {
    const input = await readJson(req), change = {};
    const task = tasks.find(t => t.id === match[1]); if (!task) return send(res, 404, {error: 'Task not found.'});
    if(!input||typeof input!=='object')return send(res,400,{error:'Expected an object.'});
    if(input.action===undefined&&input.message===undefined&&input.progressPct===undefined&&input.version!==undefined&&input.version!==(task.version||0))return send(res,409,{error:'Tugas berubah. Muat ulang sebelum menyimpan.',code:'VERSION_CONFLICT'});
    // Answering an agent's questions adds the answers to the brief and puts the task back in its queue.
    if(input.action==='answer'){
      const open=taskStore.snapshot().decisions.find(d=>d.taskId===task.id&&d.status==='open');
      if(open&&task.status==='blocked'&&input.version===(task.version||0)){const answer=text(input.answer,3000);if(!answer)return send(res,400,{error:'Write an answer first.'});answerDecision(open.id,answer,open.version,req.headers['x-kantor-request']);send(res,200,tasks.find(t=>t.id===task.id));setImmediate(kick);return;}
      if(task.status!=='blocked'||input.version!==(task.version||0))return send(res,409,{error:'These questions changed. Refresh and answer the latest ones.'});
      const answer=text(input.answer,3000);if(!answer)return send(res,400,{error:'Write an answer first.'});
      Object.assign(task,{status:'queued',brief:`${task.brief}\n\nQuestions from ${task.assignee}:\n${task.questions}\n\nAnswers:\n${answer}`.trim().slice(0,5000),questions:undefined,askedBy:undefined,error:undefined,runId:null,version:(task.version||0)+1,updatedAt:now()});
      save();send(res,200,task);setImmediate(kick);return;
    }
    if(input.action!==undefined){
      const locked=requireOrgToken(req,task);if(locked)return send(res,locked.status,{error:locked.error,code:locked.code});
      if(input.action==='retry-advice'){
        // The manager agent failed or was interrupted: ask it again.
        if(task.status!=='manager-review')return send(res,409,{error:'Hanya draf di gerbang atasan yang bisa ditinjau ulang.'});
        if(task.managerAdvice)return send(res,409,{error:'Atasan sudah memberi pertimbangan untuk draf ini.'});
        const manager=managerGate(task.assignee);
        if(!manager||!agentFor(manager))return send(res,400,{error:'Atasan tugas ini tidak terhubung ke agen AI.'});
        Object.assign(task,{adviceError:undefined,version:(task.version||0)+1,updatedAt:now()});save();
        setImmediate(()=>managerAdvice(task.id));return send(res,200,task);
      }
      if(!['approve','revise','manager-approve','manager-reject'].includes(input.action))return send(res,400,{error:'Unknown action.'});
      // Stage 1 of the one gate: the manager passes the staff draft on to the owner's review, or sends it back.
      if(input.action==='manager-approve'||input.action==='manager-reject'){
        if(task.status!=='manager-review'||input.version!==(task.version||0))return send(res,409,{error:'This draft changed. Refresh and review the latest version.'});
        if(input.action==='manager-reject'&&!text(input.feedback,5000))return send(res,400,{error:'Describe the changes needed.'});
        const by=managerGate(task.assignee)||'Owner',approved=input.action==='manager-approve';
        commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);Object.assign(t,approved?{status:'review',managerReviewedAt:now(),managerReviewedBy:by}:{status:'queued',feedback:text(input.feedback,5000)},{runId:null,error:undefined,version:(t.version||0)+1,updatedAt:now()});
          emit({type:'task.phase',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,data:{from:'manager-review',to:t.status,phase:t.status,by}});
          addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},text:approved?`Disetujui atasan (${by}), diteruskan ke review owner.`:`Atasan (${by}) minta revisi: ${t.feedback}`});});
        send(res,200,tasks.find(t=>t.id===task.id));setImmediate(kick);return;
      }
      if(input.action==='approve'&&task.outputType==='application'&&!applications.canReview(task))return send(res,409,{error:'Belum ada bukti pengujian untuk revisi ini.',code:'EVIDENCE_REQUIRED'});
      if(task.status!=='review'||input.version!==(task.version||0))return send(res,409,{error:'This draft changed. Refresh and review the latest version.'});
      if(input.action==='revise'&&!text(input.feedback,5000))return send(res,400,{error:'Describe the changes needed.'});
      if(input.action==='approve'&&!text(task.result,10000))return send(res,409,{error:'Belum ada hasil yang bisa disetujui. Minta lead menyusun hasil dulu.',code:'RESULT_REQUIRED'});
      if(input.action==='revise'&&task.outputType==='application'){await previews.stop(task.id);task.evidence=null;task.phase='queued';task.repairAttempts=0;}
      Object.assign(task,{status:input.action==='approve'?'done':'queued',feedback:input.action==='revise'?text(input.feedback,5000):'',reviewedAt:input.action==='approve'?now():null,runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
      if(input.action==='approve'){promoteParent(task.parentId);
        const answers=taskStore.snapshot().decisions.filter(d=>d.taskId===task.id&&d.status==='answered'&&d.kind!=='approval').map(d=>`${!d.answeredBy||d.answeredBy==='Owner'?'Owner':`Lead ${d.answeredBy}`} menjawab untuk "${task.title}": ${d.answer}`);
        const summary=`Tugas selesai & disetujui owner: "${task.title}". Hasil: ${String(task.result||'').split('\n').find(l=>l.trim())||'-'}`;
        commit(draft=>{remember(draft,task.assignee,[...answers,summary]);});}
      save();send(res,200,task);setImmediate(kick);return;
    }
    if(input.message!==undefined){
      if(input.version!==(task.version||0))return send(res,409,{error:'This task changed. Refresh before sending another update.'});
      const message=typeof input.message==='string'?{text:input.message}:input.message;
      if(!message||!text(message.text,2000))return send(res,400,{error:'Write a message first.'});
      task.messages=[...(task.messages||[]),{by:text(message.by,120)||'Owner',text:text(message.text,2000),at:now()}];
      Object.assign(task,{version:(task.version||0)+1,updatedAt:now()});save();return send(res,200,task);
    }
    if(input.progressPct!==undefined){
      if(input.version!==(task.version||0))return send(res,409,{error:'This task changed. Refresh before updating progress.'});
      if(!Number.isInteger(input.progressPct))return send(res,400,{error:'Progress must be a whole number.'});
      Object.assign(task,{progressPct:Math.max(0,Math.min(100,input.progressPct)),version:(task.version||0)+1,updatedAt:now()});save();return send(res,200,task);
    }
    if (input.assignee !== undefined) { change.assignee = text(input.assignee, 80); if (!memberOf(change.assignee)) return send(res, 400, {error: 'Pick an assignee.'}); if (task.status !== 'done') change.status = 'queued'; }
    if(input.assignee!==undefined||input.parentId!==undefined||input.division!==undefined||input.asLead!==undefined){const candidate=normalizeTask({...task,...input,assignee:change.assignee||task.assignee,parentId:input.parentId!==undefined?input.parentId:task.parentId,division:input.division!==undefined?input.division:task.division,asLead:input.asLead!==undefined?input.asLead:task.asLead});const placement=validateTaskPlacement(candidate,input);if(placement)return send(res,placement.status,{error:placement.error});change.parentId=candidate.parentId;change.division=candidate.division;change.asLead=candidate.asLead;}
    if(input.priority!==undefined){if(!PRIORITIES.has(input.priority))return send(res,400,{error:'Unknown priority.'});change.priority=input.priority;}
    if (input.status !== undefined) {
      if (!STATES.has(input.status)||input.status==='review'||input.status==='blocked'||input.status==='manager-review') return send(res, 400, {error: 'Unknown status.'});
      const assignee = change.assignee || task.assignee;
      if((task.status==='review'||task.status==='manager-review')&&!change.assignee)return send(res,409,{error:'Approve this draft or request a revision.'});
      if (agentFor(assignee) && input.status !== 'queued') return send(res, 409, {error: 'This member is connected to an AI agent; it starts and finishes its own tasks.'});
      if (input.status === 'active' && tasks.some(t => t.id !== task.id && t.assignee === assignee && t.status === 'active')) return send(res, 409, {error: 'This member already has an active task.'});
      if (input.status === 'done' && !text(input.result, 10000)) return send(res, 400, {error: 'Write a result before finishing.'});
      if(input.status==='done'&&tasks.some(item=>item.parentId===task.id&&item.status!=='done'))return send(res,409,{error:'Complete every child task before closing the parent.'});
      change.status = input.status; change.result = input.status === 'done' ? text(input.result, 10000) : '';
    }
    if(!Object.keys(change).length)return send(res,400,{error:'Provide an assignee, status, or review action.'});
    // Moving a task back to the queue clears a previous agent error so it is tried again.
    Object.assign(task, change, {runId:null,version:(task.version||0)+1,error: undefined, retryAt: undefined, autoAttempts: 0, retryCategory: undefined, updatedAt: now()}); promoteParent(task.parentId); save(); kick(); return send(res, 200, task);
  }
  send(res, 404, {error: 'Not found.'});
}
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream'};
function serveFile(res, url) {
  let file;
  try { file = path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { return send(res, 400, {error: 'Bad path.'}); }
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, {error: 'Forbidden.'});
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404, {'content-type': 'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'}); res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const host=req.headers.host||'';
  if(host!==`${HOST}:${PORT}`&&host!==HOST){return send(res,400,{error:'Invalid host.'});}
  if(req.url.length>4096)return send(res,414,{error:'Request target too long.'});
  const url = new URL(req.url, serverOrigin());
  if (!url.pathname.startsWith('/api/')) return serveFile(res, url);
  try { await api(req, res, url); }
  catch (error) { send(res, error.status || 500, {error: error.status ? error.message : 'Server error.',...(error.code?{code:error.code}:{})}); if (!error.status) console.error(error); }
});
server.listen(PORT, HOST, () => {
  console.log(`Kantor Kita: http://${HOST}:${PORT}`);
  console.log(legacyDryRun() ? 'AI agents: dry run (set ANTHROPIC_API_KEY in .env to use Claude)' : `AI agents: ${Object.entries(agentMembers()).map(([name, a]) => `${name} → ${modelOf(a)}`).join(', ')}`);
  // Tasks left active by a previous run go back to the queue and are picked up again.
  orchestrator.recover();recoverJobs();tasks=taskStore.snapshot().tasks;
  let reset = false; tasks.forEach(task => { if(task.outputType==='application'&&task.status==='active'){Object.assign(task,{status:'blocked',phase:'interrupted',blockedReason:'interrupted',runId:null,error:'Server dimulai ulang. Periksa revisi dan pilih lanjut secara eksplisit.'});reset=true;}else if (task.status === 'active' && agentFor(task.assignee)) { task.status = 'queued'; reset = true; } }); if (reset) save();
  kick();
  // Drafts already waiting at the manager gate get their AI manager's recommendation again after a restart.
  tasks.forEach(task => { if (task.status === 'manager-review' && !task.managerAdvice) managerAdvice(task.id); });
  // Pending automatic retries survive a restart: past-due ones are released now, future ones re-armed.
  let rearmed=false;
  tasks.forEach(task => { if (task.status==='queued'&&task.error&&RETRY_TRANSIENT.has(task.retryCategory||'')&&Number.isFinite(task.retryAt)) {
    if (task.retryAt<=Date.now()) { Object.assign(task,{error:undefined,retryAt:undefined,retryRequested:true,version:(task.version||0)+1,updatedAt:now()}); rearmed=true; }
    else armRetry(task.id);
  } });
  if (rearmed) { save(); kick(); }
});
