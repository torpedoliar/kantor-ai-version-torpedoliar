const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {recoverState}=require('./state-recovery');

const SCHEMA_VERSION=2;
const PIN_PATTERN=/^\d{4,6}$/;
const LIMITS={name:120,role:120,id:80,instructions:12000,company:160,description:4000};
const EFFORTS=new Set(['light','standard','deep']);
const PALETTE=['#2f4a6b','#b4623a','#3f7a58','#74598c','#a8842c','#2e7d8c','#b0455e','#5d6b2f'];
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const clone=value=>structuredClone(value);
const LEGACY_MODELS={'Kak Rani':'claude-sonnet-5-5','Kak Sinta':'claude-haiku-4-5-20251001'};
const LEGACY_PROMPTS={
  'Kak Rani':'You are the Social Media Specialist. Draft social content for human review; never publish or invent facts.',
  'Kak Sinta':'You are the Customer Service agent. Draft warm, concrete customer replies for human review; never promise unconfirmed outcomes.'
};
const SEED=[
  {id:'leadership',name:'Leadership',lead:'Koh Arman',collaboratesWith:[]},
  {id:'marketing',name:'Marketing',lead:'Kak Rani',collaboratesWith:[]},
  {id:'engineering',name:'Engineering',lead:'Koh Wira',collaboratesWith:[]},
  {id:'service',name:'Service',lead:'Gilang',collaboratesWith:[]}
];
const MEMBERS=[
  ['Koh Arman','KA','CEO','leadership',['leadership']],['Koh Wira','KW','CTO','engineering',['engineering','leadership']],['Kak Rani','KR','Social Media Specialist','marketing',['marketing']],['Kak Dewi','KD','Digital Marketing','marketing',['marketing']],['Mira','M','Business Development','marketing',['marketing']],['Tari','T','Social Media Intern','marketing',['marketing']],['Bagas Pratama Putra','BPP','Frontend Engineer','engineering',['engineering']],['Rizky Hakim','RH','Backend Engineer','engineering',['engineering']],['Yoga','Y','Product Design','engineering',['engineering']],['Bang Eko','BE','Graphic Designer','engineering',['engineering']],['Gilang','G','Customer Service Leader','service',['service']],['Kak Sinta','KS','Customer Service','service',['service']],['Kak Laras','KL','Customer Service','service',['service']]
];
// Seed members omit `manager` so normalize() applies the same migration rules as v1 files.
const seed=()=>normalize({version:0,company:{name:'Kantor Kita',type:'Lainnya',description:''},divisions:clone(SEED),members:MEMBERS.map(([name,initials,role,division,divisions])=>({name,initials,role,division,divisions,active:true,effort:'standard',workloadPct:100}))});
function fail(message,status=400,code){const error=new Error(message);error.status=status;if(code)error.code=code;throw error;}
function atomicWrite(file,data){const tmp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,file);}
function migrationManager(member,all,divisions){const lead=divisions.find(d=>d.id===member.division)?.lead;if(member.name===lead)return member.division==='leadership'?null:divisions.find(d=>d.id==='leadership')?.lead||null;return lead||null;}
function normalize(input){
  if(!input||typeof input!=='object')fail('Organization must be an object.');
  const rawDivisions=Array.isArray(input.divisions)?input.divisions:[];
  const divisions=rawDivisions.map((item,index)=>({id:text(item.id,LIMITS.id),name:text(item.name,LIMITS.name),areaName:text(item.areaName,LIMITS.name),color:/^#[0-9a-f]{6}$/i.test(item.color||'')?item.color.toLowerCase():PALETTE[index%PALETTE.length],lead:text(item.lead,LIMITS.name),collaboratesWith:Array.isArray(item.collaboratesWith)?[...new Set(item.collaboratesWith.map(v=>text(v,LIMITS.id)).filter(Boolean))]:[]}));
  if(divisions.some(item=>!item.id||!item.name))fail('Every division needs an id and name.');
  if(new Set(divisions.map(item=>item.id)).size!==divisions.length)fail('Division IDs must be unique.');
  const rawMembers=Array.isArray(input.members)?input.members:[];
  const members=rawMembers.map(item=>{const legacyDivisions=Array.isArray(item.divisions)?item.divisions.map(v=>text(v,LIMITS.id)).filter(Boolean):[];const division=text(item.division,LIMITS.id)||legacyDivisions[0];const instructions=text(item.instructions,LIMITS.instructions);const legacyPrompt=LEGACY_PROMPTS[item.name]||'';return {name:text(item.name,LIMITS.name),initials:text(item.initials,12),role:text(item.role,LIMITS.role),division,divisions:[division],manager:Object.hasOwn(item,'manager')?(item.manager===null?null:text(item.manager,LIMITS.name)):migrationManager({name:item.name,division},rawMembers,divisions),active:item.active!==false,effort:EFFORTS.has(item.effort)?item.effort:'standard',workloadPct:Number.isInteger(item.workloadPct)?Math.max(0,Math.min(100,item.workloadPct)):100,instructions:instructions||legacyPrompt,isAgent:Object.hasOwn(item,'isAgent')?item.isAgent===true:Object.hasOwn(LEGACY_PROMPTS,item.name),model:typeof item.model==='string'?item.model.slice(0,200):LEGACY_MODELS[item.name]||null};});
  if(members.some(item=>!item.name||!item.role||!item.division))fail('Every member needs name, role, and division.');
  if(new Set(members.map(item=>item.name)).size!==members.length)fail('Member names must be unique.');
  const ids=new Set(divisions.map(item=>item.id));
  if(members.some(item=>!ids.has(item.division)))fail('Members must use existing divisions.');
  if(divisions.some(item=>item.collaboratesWith.some(id=>!ids.has(id))))fail('Collaborations must use existing divisions.');
  const candidate={schemaVersion:SCHEMA_VERSION,version:Number.isInteger(input.version)?input.version:0,pinHash:null,company:{name:text(input.company?.name,LIMITS.company)||'Kantor Kita',type:text(input.company?.type,LIMITS.company)||'Lainnya',description:text(input.company?.description,LIMITS.description)},divisions,members};
  const graphError=validateGraph(candidate);if(graphError)fail(graphError.message,400,graphError.code);
  return candidate;
}
function validateGraph(state){const names=new Map(state.members.map(m=>[m.name,m]));for(const member of state.members){if(member.manager!==null){const manager=names.get(member.manager);if(!manager||!manager.active)return {field:`members.${member.name}.manager`,message:`Manager ${member.manager} must be an active member.`,code:'ORG_GRAPH_INVALID'};}}
  // A division may stay without a lead only while it has nobody active in it.
  for(const d of state.divisions){if(d.lead?!state.members.some(m=>m.name===d.lead&&m.active&&m.division===d.id):state.members.some(m=>m.division===d.id&&m.active))return {field:'divisions.lead',message:d.lead?'Every division lead must be active.':`Pilih lead untuk ${d.name}.`,code:'ORG_GRAPH_INVALID'};}
  const ids=new Set(state.divisions.map(d=>d.id));if(state.divisions.some(d=>d.collaboratesWith.some(id=>!ids.has(id))))return {field:'divisions.collaboratesWith',message:'Unknown collaboration division.',code:'ORG_GRAPH_INVALID'};
  for(const member of state.members){const seen=new Set([member.name]);let cursor=member.manager;while(cursor){if(seen.has(cursor))return {field:`members.${member.name}.manager`,message:'Manager cycle detected.',code:'ORG_GRAPH_CYCLE'};seen.add(cursor);cursor=names.get(cursor)?.manager||null;}}
  return null;
}
function graphFor(name,state){const member=state.members.find(m=>m.name===name);if(!member)return null;const ancestors=[];const seen=new Set();let cursor=member.manager;while(cursor&&!seen.has(cursor)){seen.add(cursor);ancestors.push(cursor);cursor=state.members.find(m=>m.name===cursor)?.manager||null;}return {manager:member.manager,ancestors,children:state.members.filter(m=>m.manager===name).map(m=>m.name),division:member.division,lead:state.divisions.find(d=>d.id===member.division)?.lead||null};}
// One rule for who may hand work to whom: up/down the manager chain, or lead to lead across a collaboration edge.
function routeBetween(state,from,to){const a=graphFor(from,state),b=graphFor(to,state);if(!a||!b)return {allowed:false,reason:'Unknown member',path:[]};if(a.ancestors.includes(to)||a.children.includes(to))return {allowed:true,reason:'manager-chain',path:[from,to]};const fromDivision=state.divisions.find(d=>d.id===a.division);if(a.lead===from&&b.lead===to&&fromDivision?.collaboratesWith.includes(b.division))return {allowed:true,reason:'cross-division-collaboration',path:[from,to]};return {allowed:false,reason:'Task route is not allowed.',path:[from,...a.ancestors]};}
function createOrg({dataDir}){
  const file=path.join(dataDir,'org.json');let state=seed(),tokens=new Set();
  // A corrupt org is archived and replaced from last-good; with no snapshot the office starts
  // empty (never seeded over the owner's members) so the restore path stays the source of truth.
  const emptyOrg=()=>normalize({version:0,company:{name:'',type:'Lainnya',description:''},divisions:[],members:[]});
  const recovery=recoverState({file,dataDir,label:'org',validate:value=>{normalize(value);},fresh:seed,corruptFresh:emptyOrg});
  state=normalize(recovery.value);state.pinHash=recovery.value.pinHash||null;
  function persist(){atomicWrite(file,JSON.stringify(state,null,2));}
  if(recovery.recovered||recovery.degraded){try{persist();}catch{}}
  if(recovery.degraded)console.error(`org.json tidak bisa dibaca; file disimpan di ${recovery.corruptPath}. Mulai dengan organisasi kosong.`);
  function publicState(){return {schemaVersion:state.schemaVersion,version:state.version,hasPin:!!state.pinHash,configured:!!state.pinHash&&!!state.company?.name&&state.members.length>0,company:clone(state.company),divisions:clone(state.divisions),members:clone(state.members)};}
  function verifyToken(token){return typeof token==='string'&&tokens.has(token);}
  function unlock(pin){if(!PIN_PATTERN.test(pin||''))fail('PIN must contain 4 to 6 digits.',400);if(!state.pinHash){state.pinHash={salt:crypto.randomBytes(16).toString('hex'),hash:crypto.scryptSync(pin,state.pinHash?.salt||'',32).toString('hex')};const salt=state.pinHash.salt;state.pinHash.hash=crypto.scryptSync(pin,salt,32).toString('hex');persist();}else{const actual=crypto.scryptSync(pin,state.pinHash.salt,32);if(!crypto.timingSafeEqual(actual,Buffer.from(state.pinHash.hash,'hex')))fail('Invalid owner PIN.',403);}const token=crypto.randomBytes(32).toString('hex');tokens.add(token);return token;}
  function reset(expectedVersion){if(expectedVersion!==undefined&&expectedVersion!==state.version)fail('Organization changed in another tab. Reload before reset.',409);state={...seed(),company:{name:'',type:'Lainnya',description:''},divisions:[],members:[],pinHash:state.pinHash,version:state.version+1};persist();tokens.clear();return publicState();}
  function save(next,token,expectedVersion){if(!verifyToken(token))fail('A valid owner unlock is required.',403,'ORG_LOCKED');if(expectedVersion!==undefined&&expectedVersion!==state.version)fail('Organization changed in another tab. Reload before saving.',409);const candidate=normalize(next);candidate.version=state.version+1;candidate.pinHash=state.pinHash;state=candidate;persist();return publicState();}
  function roster(){return clone(state.members.filter(m=>m.active));}function divisionOf(name){return state.members.find(m=>m.name===name)?.division||null;}function divisionsOf(name){return clone(state.members.find(m=>m.name===name)?.divisions||[]);}function isLead(name){return state.divisions.some(d=>d.lead===name);}
  function communicationPath(from,to){return routeBetween(state,from,to);}
  function escalationTarget(name){const graph=graphFor(name,state);return graph?.manager?{type:'member',name:graph.manager,path:[name,graph.manager]}:{type:'owner',name:'owner',path:[name,'owner']};}
  function seedFromMembers(){if(!fs.existsSync(file))persist();return publicState();}
  return {publicState,save,reset,unlock,verifyToken,roster,divisionOf,divisionsOf,isLead,seedFromMembers,validateGraph:()=>validateGraph(state),divisionGraph:name=>graphFor(name,state),communicationPath,escalationTarget,recovery:()=>structuredClone(recovery),get state(){return clone(state)}};
}
module.exports={createOrg,seed,normalize,validateGraph,routeBetween,SCHEMA_VERSION,PALETTE};
