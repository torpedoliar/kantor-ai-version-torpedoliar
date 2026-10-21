// Automatic work: a lead plans, children are created through org routes in one transaction,
// dependencies gate execution, and the lead synthesizes the team's results exactly once.
const crypto=require('node:crypto');
const {parsePlan,LIMITS}=require('./task-protocol');
const {addMessage,acknowledge}=require('./task-store');

const PLAN_INSTRUCTIONS='MODE: PLAN\nYou lead this task. Split it into subtasks for people you are allowed to delegate to (your reports, or other division leads you collaborate with). Reply with JSON only: {"assumptions":["..."],"acceptance":["criteria the owner can check"],"children":[{"key":"short-id","title":"...","brief":"...","assignee":"exact person name","dependencyKeys":["key of a subtask that must finish first"]}]}. Use at most 12 subtasks. Do not invent people.';
const SYNTH_INSTRUCTIONS='MODE: SYNTHESIZE\nYour team finished the subtasks below. Combine their results into one final deliverable for the owner. Note anything still missing.';

function createOrchestrator({snapshot,commit,org,askModel,canRun,buildApplication,now=()=>new Date().toISOString(),log=()=>{}}){
  const planning=new Set();
  const childrenOf=(state,id)=>state.tasks.filter(t=>t.parentId===id);
  const depthOf=(state,task)=>{let d=0,c=task;while(c?.parentId&&d<10){c=state.tasks.find(t=>t.id===c.parentId);d++;}return d;};
  const rootOf=(state,task)=>{let c=task;while(c?.parentId){const p=state.tasks.find(t=>t.id===c.parentId);if(!p)break;c=p;}return c.id;};
  // Ready = queued, no unmet dependencies; tasks waiting on a dependency are skipped, not failed.
  function dependenciesMet(state,task){return (task.dependencyIds||[]).every(id=>state.tasks.find(t=>t.id===id)?.status==='done');}
  function blockedDependency(state,task){return (task.dependencyIds||[]).map(id=>state.tasks.find(t=>t.id===id)).find(t=>t&&['blocked'].includes(t.status)&&t.blockedReason==='failed');}

  async function plan(task){
    if(planning.has(task.id))return;planning.add(task.id);const runId=crypto.randomUUID();
    try{
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);Object.assign(t,{status:'active',phase:'planning',runId,version:(t.version||0)+1,updatedAt:now()});if(!draft.messages.some(m=>m.taskId===t.id&&m.kind==='ack'))acknowledge(draft,emit,t,{delegate:true});emit({type:'model.started',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'plan'}});});
      let parsed=null,lastError='';
      for(let attempt=0;attempt<2&&!parsed;attempt++){
        const answer=await askModel(task.assignee,{...task,brief:`${PLAN_INSTRUCTIONS}\n\n${task.brief||''}${lastError?`\n\nYour previous plan could not be used: ${lastError}. Reply with valid JSON only.`:''}`});
        try{const state=snapshot();parsed=parsePlan(answer.text,{org:org.state,parent:{...task,depth:depthOf(state,task)},existingInRoot:state.tasks.filter(t=>t.rootId===(task.rootId||task.id)).length});if(!parsed)lastError='no JSON plan found';}
        catch(error){lastError=error.message;}
      }
      commit((draft,emit)=>{
        const t=draft.tasks.find(x=>x.id===task.id);if(!t||t.runId!==runId)return;
        emit({type:'model.completed',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'plan'}});
        if(!parsed||!parsed.children.length){Object.assign(t,{status:'blocked',phase:'failed',blockedReason:'failed',error:parsed?'Rencana tidak berisi subtugas yang bisa dikerjakan.':`Rencana tidak valid: ${lastError}`,runId:null,version:(t.version||0)+1,updatedAt:now()});
          for(const r of parsed?.rejected||[])emit({type:'delegation.rejected',taskId:t.id,rootId:t.rootId||t.id,from:t.assignee,to:r.assignee,data:{title:r.title,reason:r.reason}});
          addMessage(draft,emit,{task:t,sender:{type:'system',name:'Sistem'},text:`Perencanaan gagal: ${t.error}`});return;}
        // Idempotent: a (parent, planRunId, key) child is created once even if this commit is retried.
        const ids=new Map();const rootId=t.rootId||t.id;
        for(const c of parsed.children){const existing=draft.tasks.find(x=>x.parentId===t.id&&x.planRunId===runId&&x.planKey===c.key);ids.set(c.key,existing?.id||crypto.randomUUID());}
        for(const c of parsed.children){
          if(draft.tasks.some(x=>x.id===ids.get(c.key)))continue;
          const member=org.state.members.find(m=>m.name===c.assignee);
          const child={id:ids.get(c.key),title:c.title,assignee:c.assignee,division:member?.division||t.division,parentId:t.id,rootId,createdBy:t.assignee,asLead:false,priority:t.priority||'normal',progressPct:0,messages:[],kind:'work',legacy:false,brief:c.brief,status:'queued',phase:'queued',result:'',createdAt:now(),version:0,executionMode:c.mode,outputType:c.outputType,dependencyIds:c.dependencyKeys.map(k=>ids.get(k)),planRunId:runId,planKey:c.key};
          draft.tasks.push(child);draft.threads.push({id:child.id,taskId:child.id,title:child.title,createdAt:child.createdAt});
          emit({type:'delegation.created',taskId:child.id,rootId,from:t.assignee,to:c.assignee,data:{parentId:t.id,title:c.title,dependencyIds:child.dependencyIds}});
          addMessage(draft,emit,{task:child,sender:{type:'agent',name:t.assignee},kind:'delegation',text:`${c.title}${c.brief?`\n${c.brief}`:''}`});
        }
        for(const r of parsed.rejected)emit({type:'delegation.rejected',taskId:t.id,rootId,from:t.assignee,to:r.assignee,data:{title:r.title,reason:r.reason}});
        Object.assign(t,{status:'blocked',phase:'waiting_children',blockedReason:'children',assumptions:parsed.assumptions,acceptance:parsed.acceptance.length?parsed.acceptance:t.acceptance||[],runId:null,version:(t.version||0)+1,updatedAt:now()});
        addMessage(draft,emit,{task:t,sender:{type:'agent',name:t.assignee},text:`Rencana dibagi ke ${parsed.children.length} subtugas: ${parsed.children.map(c=>`${c.title} → ${c.assignee}`).join('; ')}.${parsed.rejected.length?` Tidak bisa didelegasikan (jalur organisasi): ${parsed.rejected.map(r=>r.assignee).join(', ')}.`:''}`});
      });
    }catch(error){
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);if(!t||t.runId!==runId)return;Object.assign(t,{status:'queued',phase:'queued',runId:null,error:error.message,version:(t.version||0)+1,updatedAt:now()});emit({type:'model.failed',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'plan',error:error.message}});});
      log(`Plan failed for ${task.title}: ${error.message}`);
    }finally{planning.delete(task.id);}
  }
  async function synthesize(task){
    if(planning.has(task.id))return;planning.add(task.id);const runId=crypto.randomUUID();
    try{
      const state=snapshot(),children=childrenOf(state,task.id).filter(c=>c.planRunId);
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);Object.assign(t,{status:'active',phase:'synthesizing',blockedReason:null,runId,version:(t.version||0)+1,updatedAt:now()});emit({type:'model.started',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'synthesize'}});});
      const childResults=children.map(c=>`### ${c.title} (${c.assignee})\n${c.result||'(tanpa hasil)'}`).join('\n\n').slice(-12000);
      if(task.outputType==='application'&&buildApplication){await buildApplication(task.id,childResults);return;}
      const answer=await askModel(task.assignee,{...task,brief:`${SYNTH_INSTRUCTIONS}\n\n${task.brief||''}`,childResults});
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);if(!t||t.runId!==runId)return;
        emit({type:'model.completed',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'synthesize'}});
        const result=answer.text.slice(0,10000),final=!t.parentId;
        // A sub-lead's synthesis is accepted by its own lead; only the root goes to the owner for review.
        Object.assign(t,{status:final?'review':'done',phase:final?'review':'done',result,by:answer.by,runId:null,history:[...(t.history||[]),{result,by:answer.by,createdAt:now(),feedback:''}],version:(t.version||0)+1,updatedAt:now()});
        emit({type:'result.submitted',taskId:t.id,rootId:t.rootId||t.id,from:t.assignee,to:final?'owner':draft.tasks.find(p=>p.id===t.parentId)?.assignee,data:{final}});
        addMessage(draft,emit,{task:t,sender:{type:'agent',name:t.assignee},kind:'result',text:result});
      });
    }catch(error){
      commit((draft,emit)=>{const t=draft.tasks.find(x=>x.id===task.id);if(!t||t.runId!==runId)return;Object.assign(t,{status:'blocked',phase:'waiting_children',blockedReason:'children',runId:null,error:error.message,version:(t.version||0)+1,updatedAt:now()});emit({type:'model.failed',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,runId,data:{purpose:'synthesize',error:error.message}});});
    }finally{planning.delete(task.id);}
  }
  // Leaf results from automatic plans are accepted by the lead internally, not left for owner review.
  function acceptChildren(){
    const state=snapshot(),accept=state.tasks.filter(t=>t.planRunId&&t.status==='review'&&!childrenOf(state,t.id).length);
    if(!accept.length)return;
    commit((draft,emit)=>{for(const a of accept){const t=draft.tasks.find(x=>x.id===a.id);if(t.status!=='review')continue;const lead=draft.tasks.find(p=>p.id===t.parentId);
      Object.assign(t,{status:'done',phase:'done',reviewedAt:now(),reviewedBy:lead?.assignee||null,version:(t.version||0)+1,updatedAt:now()});
      emit({type:'result.submitted',taskId:t.id,rootId:t.rootId||t.id,from:t.assignee,to:lead?.assignee||'owner',data:{accepted:true}});}});
  }
  // Called whenever something changes: plan new automatic tasks, accept finished leaves, synthesize completed parents.
  function wake(){
    acceptChildren();
    const state=snapshot();
    for(const t of state.tasks){
      if(t.status==='queued'&&t.executionMode==='automatic'&&!childrenOf(state,t.id).length&&canRun(t.assignee))plan(t);
      if(t.phase==='waiting_children'){const kids=childrenOf(state,t.id).filter(c=>c.planRunId);if(kids.length&&kids.every(c=>c.status==='done')&&canRun(t.assignee))synthesize(t);}
    }
  }
  // Worker eligibility for ordinary (direct) execution: dependencies done, not an automatic planner task.
  function eligible(state,task){return task.executionMode!=='automatic'&&dependenciesMet(state,task)&&!blockedDependency(state,task);}
  // On restart nothing is re-planned: in-flight planning/synthesis returns to a resumable state.
  function recover(){
    const state=snapshot(),stuck=state.tasks.filter(t=>t.status==='active'&&['planning','synthesizing'].includes(t.phase));
    if(!stuck.length)return;
    commit((draft,emit)=>{for(const s of stuck){const t=draft.tasks.find(x=>x.id===s.id);const hasKids=draft.tasks.some(c=>c.parentId===t.id);
      Object.assign(t,{status:hasKids?'blocked':'queued',phase:hasKids?'waiting_children':'queued',blockedReason:hasKids?'children':null,runId:null,version:(t.version||0)+1,updatedAt:now()});
      emit({type:'task.interrupted',taskId:t.id,rootId:t.rootId||t.id,agent:t.assignee,data:{phase:s.phase}});}});
  }
  return {wake,recover,eligible,LIMITS};
}
module.exports={createOrchestrator};
