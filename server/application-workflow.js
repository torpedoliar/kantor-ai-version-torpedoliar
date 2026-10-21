// Application lifecycle: source revisions and test output are facts, not model claims.
const crypto=require('node:crypto');
const {findJson}=require('./org-draft');
const {validateBundle}=require('./project-workspace');
const {addMessage,sanitizeText}=require('./task-store');
const {WINDOWS_WARNING}=require('./project-runner');
const INSTRUCTIONS='MODE: APPLICATION\nReturn JSON only: {runtime:"static-web"|"node-web",files:[{path,content}],commands:{build?:{executable:"node",args:[]},test:{executable:"node",args:[]},start?:{executable:"node",args:[]}},acceptanceTests:[],knownLimitations:[]}. Include runnable Node test files using node:test. Test names must identify each owner acceptance criterion. Never claim tests passed: the server runs them after owner approval. No dependencies requiring installation, secrets, absolute paths, Dockerfile, or shell commands.';
function criteriaEvidence(output,criteria){
  const cases=String(output).split(/\r?\n/).filter(line=>/^\s*ok\s+\d+\s*-/.test(line)&&!/#\s*(SKIP|TODO)\b/i.test(line)).map(line=>line.replace(/^\s*ok\s+\d+\s*-\s*/, '').toLowerCase());
  return criteria.map(criterion=>({criterion,status:cases.some(name=>name.includes(criterion.toLowerCase()))?'passed':'not_verified'}));
}
function canReviewApplication(task,state){
  const e=task.evidence,j=state.jobs.find(j=>j.id===e?.jobId);
  return !!(j&&j.status==='passed'&&j.revisionId===task.revisionId&&e.revisionId===task.revisionId&&j.manifestHash===e.manifestHash&&e.exitCode===0&&e.smoke?.status==='passed'&&e.criteria?.length&&e.criteria.every(c=>c.status==='passed'));
}
function createApplicationWorkflow({snapshot,commit,projects,askModel,approveRun,startJob,smoke}){
  const busy=new Set(),now=()=>new Date().toISOString();
  function change(id,mutate){return commit((draft,emit)=>{const task=draft.tasks.find(t=>t.id===id);if(!task)return;mutate(task,draft,emit);task.version=(task.version||0)+1;task.updatedAt=now();});}
  async function generate(id,failure=''){
    if(busy.has(id))return;busy.add(id);const runId=crypto.randomUUID();
    try{
      change(id,(t,d,emit)=>{t.status='active';t.phase='implementing';t.runId=runId;emit({type:'model.started',taskId:id,agent:t.assignee,runId,data:{purpose:'application'}});});
      const task=snapshot().tasks.find(t=>t.id===id);
      const answer=await askModel(task.assignee,{...task,brief:`${INSTRUCTIONS}\n\n${task.brief||''}\nAcceptance criteria:\n${(task.acceptance||[]).join('\n')}${failure?`\nPrevious revision failed. Repair using this actual test output:\n${failure}`:''}`});
      const raw=findJson(answer.text,obj=>Array.isArray(obj?.files)?obj:null);
      if(!raw)throw Error('Agen belum mengirim bundle aplikasi JSON yang dapat diuji.');
      const bundle=validateBundle(raw),project=task.projectId?{id:task.projectId}:projects.createProject({taskId:id,environment:task.environment||'docker'});
      const revision=projects.writeRevision(project.id,bundle),manifest=projects.manifest(project.id,revision.id);
      change(id,(t,d,emit)=>{
        if(t.runId!==runId)return;
        Object.assign(t,{projectId:project.id,revisionId:revision.id,status:'blocked',phase:'awaiting_approval',blockedReason:'approval',runId:null,error:null,evidence:null});
        let p=d.projects.find(p=>p.id===project.id);if(!p)d.projects.push({id:project.id,taskId:id,environment:t.environment||'docker',approvals:[]});
        const commands=Object.entries(manifest.commands).map(([phase,c])=>`${phase}: node ${c.args.join(' ')}`).join('\n');
        for(const decision of d.decisions)if(decision.taskId===id&&decision.kind==='approval'&&decision.status==='open')decision.status='cancelled';
        const decision={id:crypto.randomUUID(),kind:'approval',taskId:id,threadId:id,revisionId:revision.id,version:0,status:'open',target:'owner',questions:['Setujui sumber dan perintah untuk pengujian?'],options:[],openedAt:now()};d.decisions.push(decision);
        emit({type:'decision.opened',taskId:id,rootId:t.rootId||id,agent:t.assignee,data:{decisionId:decision.id,target:'owner',kind:'approval'}});
        addMessage(d,emit,{task:t,sender:{type:'system',name:'Sistem'},kind:'approval',decisionId:decision.id,text:`Periksa sumber sebelum menjalankan: ${manifest.files.length} file · ${manifest.runtime}\n${commands}\n${t.environment==='windows'?WINDOWS_WARNING:'Docker: sumber read-only, jaringan mati secara default.'}\nRevisi ${revision.id}\nHash ${revision.manifestHash}`});
        emit({type:'model.completed',taskId:id,agent:t.assignee,runId,data:{purpose:'application',revisionId:revision.id}});
      });
    }catch(error){change(id,(t,d,emit)=>{Object.assign(t,{status:'blocked',phase:'failed',blockedReason:'failed',error:sanitizeText(error.message),runId:null});emit({type:'model.failed',taskId:id,agent:t.assignee,runId,data:{error:t.error}});});}
    finally{busy.delete(id);}
  }
  async function approve(id,input){
    const task=snapshot().tasks.find(t=>t.id===id);
    if(!task||task.phase!=='awaiting_approval'||task.revisionId!==input.revisionId)throw Object.assign(Error('Revisi berubah. Periksa lagi sumbernya.'),{status:409,code:'APPROVAL_STALE'});
    const approval=await approveRun(task.projectId,{...input,environment:task.environment||'docker',networkAllowed:input.networkAllowed===true});
    const job=startJob(task.projectId,{revisionId:task.revisionId,approvalId:approval.id},`app:${id}:${task.revisionId}:${approval.id}`);
    change(id,(t,d,emit)=>{Object.assign(t,{status:'active',phase:'testing',blockedReason:null,jobId:job.id});for(const decision of d.decisions)if(decision.taskId===id&&decision.kind==='approval'&&decision.revisionId===t.revisionId&&decision.status==='open'){Object.assign(decision,{status:'answered',answer:'Pengujian disetujui',answeredAt:now(),version:decision.version+1});emit({type:'decision.answered',taskId:id,data:{decisionId:decision.id,kind:'approval'}});}});
    return job;
  }
  async function completed(job){
    const t=snapshot().tasks.find(t=>t.id===job.taskId);
    if(!t||t.jobId!==job.id||t.revisionId!==job.revisionId)return;
    const output=job.evidence.map(e=>e.stdout+'\n'+e.stderr).join('\n');
    const test=job.evidence.find(e=>e.phase==='test'),passedCount=Number(output.match(/# tests (\d+)/)?.[1]||0);
    const criteria=criteriaEvidence(test?.stdout||'',t.acceptance||[]);
    if(job.status==='passed'&&passedCount>0&&criteria.length&&criteria.every(c=>c.status==='passed')){
      let m;try{m=projects.verifyRevision(t.projectId,t.revisionId);}catch(error){change(t.id,task=>Object.assign(task,{status:'blocked',phase:'failed',blockedReason:'failed',error:sanitizeText(error.message)}));return;}
      let smokeEvidence;try{smokeEvidence=await smoke(t);}catch(error){change(t.id,task=>Object.assign(task,{status:'blocked',phase:'failed',blockedReason:'failed',error:`Smoke gagal: ${sanitizeText(error.message)}`}));return;}
      if(snapshot().tasks.find(x=>x.id===t.id)?.revisionId!==job.revisionId)return;
      change(t.id,(task,d,emit)=>{
        Object.assign(task,{status:'review',phase:'review',blockedReason:null,error:null,evidence:{jobId:job.id,revisionId:job.revisionId,sourceHash:m.sourceHash,manifestHash:m.manifestHash,exitCode:test.exitCode,criteria,smoke:smokeEvidence},result:`Diuji di ${task.environment==='windows'?'Windows lokal':'Docker'}: ${passedCount} tes.\n${criteria.map(c=>`${c.criterion}: ${c.status}`).join('\n')}\nKeterbatasan: ${m.knownLimitations.join('; ')||'Belum dinyatakan.'}\nPengujian tidak menjamin semua kasus telah tercakup.`});
        addMessage(d,emit,{task,sender:{type:'agent',name:task.assignee},kind:'result',text:task.result});
      });return;
    }
    if(['cancelled','interrupted','environment_unavailable'].includes(job.status)){
      change(t.id,task=>Object.assign(task,{status:'blocked',phase:job.status,blockedReason:job.status,error:output.slice(-2000)}));return;
    }
    if((t.repairAttempts||0)<2){change(t.id,task=>{task.repairAttempts=(task.repairAttempts||0)+1;task.phase='repairing';task.status='active';});generate(t.id,output.slice(-12000));}
    else change(t.id,task=>Object.assign(task,{status:'blocked',phase:'failed',blockedReason:'failed',error:`Pengujian gagal setelah 2 perbaikan. ${output.slice(-2000)}`}));
  }
  return {generate,approve,completed,canReview:task=>{if(!canReviewApplication(task,snapshot()))return false;try{return projects.verifyRevision(task.projectId,task.revisionId).sourceHash===task.evidence.sourceHash;}catch{return false;}}};
}
module.exports={createApplicationWorkflow,canReviewApplication,criteriaEvidence};
