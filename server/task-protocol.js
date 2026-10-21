// Structured model replies for automatic work: a lead's plan, and a worker's questions or result.
const {findJson}=require('./org-draft');
const {routeBetween}=require('./org');

const LIMITS={children:12,depth:3,rootTotal:40,title:160,brief:5000};
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function fail(message){throw Object.assign(new Error(message),{status:422,code:'PLAN_INVALID'});}

// Returns null when the answer holds no plan, so the caller can ask once more; throws when a plan is present but unusable.
function parsePlan(answer,{org,parent,existingInRoot=0}){
  const plan=findJson(answer,obj=>Array.isArray(obj?.children)?obj:null);if(!plan)return null;
  if((parent.depth||0)>=LIMITS.depth)fail(`Batas kedalaman delegasi ${LIMITS.depth} tercapai.`);
  if(plan.children.length>LIMITS.children)fail(`Maksimal ${LIMITS.children} subtugas per rencana.`);
  if(existingInRoot+plan.children.length>LIMITS.rootTotal)fail(`Maksimal ${LIMITS.rootTotal} tugas per tugas utama.`);
  const children=plan.children.map(c=>({key:text(c?.key,60),title:text(c?.title,LIMITS.title),brief:text(c?.brief,LIMITS.brief),assignee:text(c?.assignee,120),dependencyKeys:Array.isArray(c?.dependencyKeys)?[...new Set(c.dependencyKeys.map(k=>text(k,60)).filter(Boolean))]:[],outputType:c?.outputType==='application'?'application':'document',mode:c?.mode==='automatic'?'automatic':'direct'}));
  if(children.some(c=>!c.key||!c.title||!c.assignee))fail('Setiap subtugas butuh key, title, dan assignee.');
  if(new Set(children.map(c=>c.key)).size!==children.length)fail('Key subtugas harus unik.');
  // A child the lead cannot reach through the organisation is reported, not created.
  const rejected=[],allowed=[];
  for(const c of children){const member=org.members.find(m=>m.name===c.assignee&&m.active!==false),route=member?routeBetween(org,parent.assignee,c.assignee):{allowed:false,reason:'Unknown member'};(route.allowed?allowed:rejected).push(route.allowed?c:{...c,reason:route.reason});}
  const keys=new Set(allowed.map(c=>c.key));
  for(const c of allowed){const missing=c.dependencyKeys.filter(k=>!keys.has(k));if(missing.length)c.dependencyKeys=c.dependencyKeys.filter(k=>keys.has(k));}
  // Dependencies must form a DAG.
  const state=new Map();const visit=key=>{if(state.get(key)===1)fail('Dependensi subtugas membentuk siklus.');if(state.get(key)===2)return;state.set(key,1);for(const d of allowed.find(c=>c.key===key).dependencyKeys)visit(d);state.set(key,2);};
  for(const c of allowed)visit(c.key);
  return {assumptions:(Array.isArray(plan.assumptions)?plan.assumptions:[]).map(a=>text(a,500)).filter(Boolean).slice(0,10),acceptance:(Array.isArray(plan.acceptance)?plan.acceptance:[]).map(a=>text(a,500)).filter(Boolean).slice(0,20),children:allowed,rejected};
}
// Worker reply: structured {kind:'questions'|'result'} or the older `QUESTIONS:` text.
function parseReply(answer){
  const structured=findJson(answer,obj=>obj&&(obj.kind==='questions'||obj.kind==='result')?obj:null);
  if(structured?.kind==='questions')return {kind:'questions',questions:(structured.questions||[]).map(q=>text(String(q),500)).filter(Boolean).slice(0,10),options:(structured.options||[]).map(o=>text(String(o),200)).filter(Boolean).slice(0,10)};
  if(structured?.kind==='result'&&text(structured.text,10000))return {kind:'result',text:text(structured.text,10000)};
  const asked=String(answer).match(/^QUESTIONS:\s*([\s\S]+)/);
  if(asked)return {kind:'questions',questions:asked[1].trim().slice(0,2000).split(/\n+/).map(q=>q.replace(/^\s*\d+[.)]\s*/,'').trim()).filter(Boolean).slice(0,10),options:[]};
  return {kind:'result',text:String(answer).slice(0,10000)};
}
module.exports={parsePlan,parseReply,LIMITS};
