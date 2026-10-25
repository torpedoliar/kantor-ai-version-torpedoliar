// What an agent is doing right now, and what has happened so far, for one task thread.
// Built only from task state and stored events: no percentages, no guessed progress.
const PURPOSE={plan:'menyusun rencana',synthesize:'mereview hasil tim',review:'mereview hasil',work:'mengerjakan',application:'menulis kode aplikasi'};
const secs=(from,to)=>Math.max(0,Math.round((Date.parse(to)-Date.parse(from))/1000));
const duration=s=>s<60?`${s} dtk`:`${Math.floor(s/60)} mnt ${s%60} dtk`;

function statusOf(state,task,{agents=[]}={}){
  const kids=state.tasks.filter(t=>t.parentId===task.id),progress=kids.length?{done:kids.filter(k=>k.status==='done').length,total:kids.length}:null;
  const started=[...state.events].reverse().find(e=>e.taskId===task.id&&e.type==='model.started');
  const base={progress,busy:false};
  if(task.status==='active'){
    const what=task.phase==='planning'?'menyusun rencana':task.phase==='synthesizing'?'mereview hasil tim':task.phase==='testing'?'menjalankan pengujian':task.phase==='implementing'||task.phase==='repairing'?'menulis kode aplikasi':'mengerjakan';
    return {...base,busy:true,label:`${task.assignee} sedang ${what}`,since:started?.at||task.updatedAt||null,model:started?.data?.modelId||null};
  }
  if(task.status==='blocked'){
    if(task.blockedReason==='children'){
      const working=kids.filter(k=>k.status==='active').map(k=>({assignee:k.assignee,title:k.title}));
      return {...base,busy:working.length>0,label:'Tim sedang bekerja',working};
    }
    if(task.blockedReason==='approval')return {...base,label:'Menunggu izin pengujian darimu'};
    if(task.blockedReason==='failed')return {...base,label:`Gagal: ${task.error||'periksa detail'}`};
    if(task.blockedReason==='interrupted')return {...base,label:'Terputus saat server dimulai ulang'};
    return {...base,label:'Menunggu jawabanmu'};
  }
  if(task.status==='queued'){
    if(task.error)return {...base,label:`Gagal: ${String(task.error).replace(/[.\s]+$/,"")}. Kirim "lanjutkan" untuk mencoba lagi.`};
    const blocker=(task.dependencyIds||[]).map(id=>state.tasks.find(t=>t.id===id)).find(t=>t&&t.status!=='done');
    if(blocker)return {...base,label:`Menunggu "${blocker.title}" selesai`};
    if(!agents.includes(task.assignee))return {...base,label:`${task.assignee} bukan agen AI: dikerjakan manual`};
    const other=state.tasks.find(t=>t.id!==task.id&&t.assignee===task.assignee&&t.status==='active');
    if(other)return {...base,label:`Antre: ${task.assignee} masih mengerjakan "${other.title}"`};
    return {...base,label:`Antre: ${task.assignee} akan segera mulai`};
  }
  if(task.status==='manager-review')return {...base,label:'Menunggu review atasan'};
  if(task.status==='review')return {...base,label:'Siap kamu review'};
  if(task.status==='done')return {...base,label:'Selesai'};
  return {...base,label:task.status};
}

function lineFor(event,state){
  const title=id=>state.tasks.find(t=>t.id===id)?.title||'tugas';
  const d=event.data||{};
  switch(event.type){
    case 'model.started':return `${event.agent} mulai ${d.purpose==='work'||!d.purpose?`mengerjakan "${title(event.taskId)}"`:PURPOSE[d.purpose]||d.purpose}`;
    case 'model.completed':return null;// paired with its start below
    case 'model.failed':return `${event.agent} gagal: ${d.error||'kesalahan provider'}`;
    case 'delegation.created':return `Didelegasikan ke ${event.to}: ${d.title||title(event.taskId)}`;
    case 'delegation.rejected':return `Tidak bisa didelegasikan ke ${event.to} (jalur organisasi): ${d.title||''}`.trim();
    case 'result.submitted':return d.accepted?`${event.from} mengirim hasil "${title(event.taskId)}" ke ${event.to}`:d.final?`${event.from} mengirim hasil akhir untuk kamu review`:`${event.from} mengirim hasil "${title(event.taskId)}" ke ${event.to}`;
    case 'decision.opened':return d.kind==='approval'?'Menunggu izin pengujian darimu':`${event.agent} bertanya kepadamu`;
    case 'decision.answered':return 'Jawabanmu diterima';
    case 'job.started':return `Pengujian dimulai (${d.environment==='windows'?'Windows lokal':'Docker'})`;
    case 'command.finished':return `Perintah ${d.phase} selesai · exit ${d.exitCode}${d.ending?` (${d.ending})`:''}`;
    case 'job.passed':return 'Pengujian lulus';
    case 'job.failed':return 'Pengujian gagal';
    case 'task.interrupted':return 'Terputus karena server dimulai ulang';
    default:return null;
  }
}

// One thread covers its task and, for a root, every task delegated under it.
function activityFor(state,taskId,{now=new Date().toISOString(),agents=[],limit=60}={}){
  const task=state.tasks.find(t=>t.id===taskId);if(!task)return null;
  const inTree=new Set([taskId]);let grew=true;while(grew){grew=false;for(const t of state.tasks)if(t.parentId&&inTree.has(t.parentId)&&!inTree.has(t.id)){inTree.add(t.id);grew=true;}}
  const items=[];
  for(const event of state.events){
    if(!inTree.has(event.taskId))continue;
    if(event.type==='model.completed'){
      const start=[...items].reverse().find(i=>i.type==='model.started'&&i.taskId===event.taskId);
      const purpose=event.data?.purpose;
      items.push({seq:event.seq,at:event.at,type:event.type,taskId:event.taskId,text:`${event.agent} selesai ${purpose==='work'||!purpose?`mengerjakan "${state.tasks.find(t=>t.id===event.taskId)?.title||'tugas'}"`:PURPOSE[purpose]||purpose}${start?` · ${duration(secs(start.at,event.at))}`:''}`});
      continue;
    }
    const text=lineFor(event,state);if(text)items.push({seq:event.seq,at:event.at,type:event.type,taskId:event.taskId,text});
  }
  return {taskId,status:{...statusOf(state,task,{agents}),now},items:items.slice(-limit)};
}
module.exports={activityFor};
