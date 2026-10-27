(() => {
  const storageKey = 'kantor-ai.tasks.v1', orgStorageKey = 'kantor-ai.org.v1';
  const states = {queued: 'Antre', active: 'Sedang berjalan', blocked: 'Butuh keputusan', 'manager-review': 'Review atasan', review: 'Butuh review', done: 'Selesai'};
  const priorities = new Set(['low','normal','high']), kinds = new Set(['work','roster-review']);
  const el = id => document.getElementById(id);
  let tasks = [], team = [], changed, locate;
  let storageHealthy = true;
  let mutation=0,polling=false,writing=0;
  const drafts=new Map();
  const draftKey=(task,kind)=>`${kind}:${task.id}:${kind==='result'?'result':(task.version||0)}`;
  function draftRead(key){if(drafts.has(key))return drafts.get(key);try{return sessionStorage.getItem('kantor-draft:'+key)||'';}catch{return '';}}
  function draftWrite(key,value){drafts.set(key,value);try{sessionStorage.setItem('kantor-draft:'+key,value);}catch{feedback('Draf hanya tersimpan di tab ini; penyimpanan browser tidak tersedia.');}}
  function draftClear(key){drafts.delete(key);try{sessionStorage.removeItem('kantor-draft:'+key);}catch{}}

  // With the server running, tasks live there and some members are AI agents; without it, tasks stay in this browser.
  let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
  let server = null, csrf = '', orgState = {divisions: [], members: []}, orgToken = '', selectedId = null, activeView = 'board', pendingUnlockResolve = null;
  // Stored task events, newest last, from the owner-only stream (SSE) or the polling fallback; same seq cursor for both.
  let events = [], eventSeq = 0, feedAbort = null;
  try { orgToken = sessionStorage.getItem('kantor-ai.orgToken') || ''; selectedId = sessionStorage.getItem('kantor-ai.selectedTask'); } catch {}
  const displayName = name => team.find(person => person.n === name)?.initials || name;
  const fallbackOrg = () => ({version:0,divisions:[{id:'leadership',name:'Leadership',lead:'Koh Arman'},{id:'marketing',name:'Marketing',lead:'Kak Rani'},{id:'engineering',name:'Engineering',lead:'Koh Wira'},{id:'service',name:'Service',lead:'Gilang'}],members:team.map(person=>({name:person.n,role:person.role,division:person.group,divisions:[person.group],active:true,effort:'standard',workloadPct:100,instructions:''}))});
  function normalizeLocalTask(task) { return {...task,version:Number.isInteger(task.version)?task.version:0,division:task.division||null,parentId:typeof task.parentId==='string'&&task.parentId?task.parentId:null,asLead:task.asLead===true,priority:priorities.has(task.priority)?task.priority:'normal',progressPct:Number.isInteger(task.progressPct)?Math.max(0,Math.min(100,task.progressPct)):0,messages:Array.isArray(task.messages)?task.messages.filter(message=>message&&typeof message.text==='string').map(message=>({by:typeof message.by==='string'?message.by:'Owner',text:message.text.slice(0,2000),at:typeof message.at==='string'?message.at:new Date().toISOString()})):[],kind:kinds.has(task.kind)?task.kind:'work',legacy:task.legacy===true}; }
  function saveOrgSeed() { try { if(!localStorage.getItem(orgStorageKey)) localStorage.setItem(orgStorageKey,JSON.stringify(fallbackOrg())); } catch {} }
  const agentFor = name => server?.members[name] ? {...server.members[name], mode: server.mode} : null;

  function feedback(message) { el('taskFeedback').textContent = message; }
  // A stale copy (someone else changed the task) reloads the board instead of leaving the owner on old data.
  async function failed(error) {
    if (recoverOrgLock(error)) return;
    feedback(error.message);
    if (error.code === 'VERSION_CONFLICT' && server) { const latest = await call('GET', '/api/tasks').catch(() => null); if (latest) { apply(latest); render(); } }
  }
  const chainText = name => [displayName(name), ...chainFor(name).map(displayName)].join(' → ');
  // Manager chain from the org chart (member.manager = name or null), cycle-safe.
  function chainFor(name) {
    const chain = [], seen = new Set([name]);
    let cur = orgState.members.find(m => m.name === name)?.manager ?? null;
    while (cur && !seen.has(cur)) { seen.add(cur); chain.push(cur); cur = orgState.members.find(m => m.name === cur)?.manager ?? null; }
    return chain;
  }
  function persist(next) {
    if (!storageHealthy) {
      feedback('Data tersimpan tidak bisa dibaca. Perubahan diblokir agar data lama tidak tertimpa.');
      return false;
    }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { feedback('Gagal menyimpan. Periksa penyimpanan browser; perubahan tidak diterapkan.'); return false; }
    tasks = next;
    return true;
  }
  async function call(method, path, body, options = {}) {
    const write=method!=='GET';if(write){mutation++;writing++;}
    try{
      if(write&&!csrf){const session=await fetch('/api/session',{cache:'no-store'});if(session.ok)csrf=(await session.json()).csrf||'';}
      const headers={'content-type':'application/json'};if(csrf)headers['x-kantor-csrf']=csrf;if(options.request)headers['x-kantor-request']=options.request;if(orgToken)headers['x-kantor-org']=orgToken;
      // Only reads, and writes that already carry an idempotency key, may be retried. Retrying a plain
      // POST after a lost response could create the same task or room twice.
      const retryable=method==='GET'||method==='HEAD'||!!options.request;
      let response;
      try{response=await fetch(path,{method,headers,body:body&&JSON.stringify(body)});}
      catch{
        if(!retryable){const error=new Error('Koneksi terputus saat menyimpan. Muat ulang halaman dan periksa apakah perubahan sudah tersimpan.');error.code='SERVER_UNREACHABLE';throw error;}
        await new Promise(r=>setTimeout(r,800));
        try{response=await fetch(path,{method,headers,body:body&&JSON.stringify(body)});}
        catch{const error=new Error('Server Kantor Kita tidak bisa dihubungi. Pastikan server berjalan (npm start), lalu muat ulang halaman ini dengan Ctrl+F5.');error.code='SERVER_UNREACHABLE';throw error;}
      }
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error(data.error||`Server error ${response.status}`);error.code=data.code;error.status=response.status;if(Array.isArray(data.tasks))error.tasks=data.tasks;throw error;}
      return data;
    }finally{if(write){writing--;mutation++;}}
  }
  // Server changes arrive as whole task lists; report each status change once so the office log and characters follow.
  function apply(list) {
    const before = new Map(tasks.map(t => [t.id, t]));
    tasks = list;
    for (const task of list) {
      const old = before.get(task.id);
      // A fast agent can go from queued to done between two polls; still log that it started.
      if (old && old.status === 'queued' && ['blocked','manager-review','review','done'].includes(task.status)) changed(task.assignee, 'active', task.title);
      if (old && old.status !== task.status) changed(task.assignee, task.status, task.title);
      if (old && old.assignee !== task.assignee) changed(old.assignee);
    }
  }
  function validTask(task) {
    return task && typeof task.id === 'string' && typeof task.title === 'string' && task.title.trim() &&
      task.title.length <= 160 && typeof task.assignee === 'string' && task.assignee.trim() &&
      Object.hasOwn(states, task.status) && typeof task.brief === 'string' && task.brief.length <= 5000 &&
      typeof task.result === 'string' && task.result.length <= 10000 &&
      Number.isInteger(task.progressPct) && task.progressPct >= 0 && task.progressPct <= 100 &&
      Array.isArray(task.messages) && task.messages.every(message => message && typeof message.text === 'string' && message.text.length <= 2000) &&
      (!['review','manager-review','done'].includes(task.status) || task.result.trim()) && typeof task.createdAt === 'string';
  }
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function action(text, handler) {
    const button = node('button', text);
    button.type = 'button'; button.onclick = handler;
    return button;
  }
  async function update(id, status, result = '') {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    if (status === 'active' && tasks.some(t => t.id !== id && t.assignee === task.assignee && t.status === 'active')) {
      feedback(`${displayName(task.assignee)} sudah punya tugas aktif. Kembalikan ke antrean atau selesaikan dulu.`);
      return;
    }
    if (server) {
      try { const saved = await call('PATCH', `/api/tasks/${id}`, {status, result}); apply(tasks.map(t => t.id === id ? saved : t)); }
      catch (error) { failed(error); return; }
    } else {
      const next = tasks.map(t => t.id === id ? {...t, status, result, updatedAt: new Date().toISOString()} : t);
      if (!persist(next)) return;
      changed(task.assignee, status, task.title);
    }
    if(status==='done')draftClear(draftKey(task,'result'));
    render(); feedback(`Status tugas: ${states[status]}.`);
    el('taskFilter').focus();
  }
  async function taskPatch(task, body) {
    if (server) {
      const saved = await call('PATCH', `/api/tasks/${task.id}`, {...body, version:task.version||0});
      apply(tasks.map(item => item.id === task.id ? saved : item));
      return saved;
    }
    const next=tasks.map(item=>{if(item.id!==task.id)return item;const updated={...item};if(body.message){const message=body.message;updated.messages=[...(item.messages||[]),{by:typeof message.by==='string'?message.by:'Owner',text:message.text.slice(0,2000),at:new Date().toISOString()}];}if(body.progressPct!==undefined)updated.progressPct=Math.max(0,Math.min(100,Number(body.progressPct)));return normalizeLocalTask({...updated,version:(item.version||0)+1,updatedAt:new Date().toISOString()});});
    if (!persist(next)) throw new Error('Could not save this update.');
    return next.find(item=>item.id===task.id);
  }
  async function sendMessage(task, by, value) {
    const text=value.trim();
    if (!text) return;
    try { await taskPatch(task,{message:{by,text}}); render(); feedback('Pesan ditambahkan.'); }
    catch(error){ failed(error); }
  }
  async function setProgress(task, value) {
    const progressPct=Number(value);
    if (!Number.isInteger(progressPct)) return;
    try { await taskPatch(task,{progressPct}); render(); feedback('Progres diperbarui.'); }
    catch(error){ failed(error); }
  }
  async function reassign(id, assignee) {
    if (!team.some(person => person.n === assignee)) return;
    if (server) {
      try { const saved = await call('PATCH', `/api/tasks/${id}`, {assignee}); apply(tasks.map(t => t.id === id ? saved : t)); }
      catch (error) { failed(error); return; }
    } else {
      const next = tasks.map(task => task.id === id ? {...task, assignee, status: task.status === 'done' ? 'done' : 'queued'} : task);
      if (!persist(next)) return;
    }
    render(); feedback(`Tugas dipindahkan ke ${displayName(assignee)}.`);
  }
  async function reviewTask(task,action,comments=''){
    try{
      if(server){const saved=await call('PATCH',`/api/tasks/${task.id}`,{action,feedback:comments,version:task.version||0});apply(tasks.map(t=>t.id===task.id?saved:t));}
      else{
        const status=action==='approve'?'done':action==='manager-approve'?'review':'queued';
        const next=tasks.map(t=>t.id===task.id?{...t,status,feedback:comments,version:(t.version||0)+1,updatedAt:new Date().toISOString()}:t);
        if(!persist(next))return;
        changed(task.assignee,status,task.title);
      }
      draftClear(draftKey(task,'review'));draftClear(draftKey(task,'manager-review'));render();feedback(action==='approve'?'Draf disetujui.':action==='manager-approve'?'Disetujui atasan, diteruskan ke review owner.':'Revisi diminta. Draf sebelumnya tetap tersimpan di riwayat.');
    }catch(error){failed(error);}
  }
  function reviewControls(task,article){
    article.append(node('div',task.result,'task-result'));
    const approve=action('Setujui & selesai',()=>reviewTask(task,'approve'));approve.className='task-primary';article.append(approve);
    const form=node('form'),label=node('label','Catatan revisi'),input=node('textarea'),key=draftKey(task,'review');
    input.id=`review-${task.id}`;label.htmlFor=input.id;input.required=true;input.maxLength=5000;input.rows=3;input.value=draftRead(key);
    input.oninput=()=>{input.setCustomValidity('');draftWrite(key,input.value);};
    const submit=node('button','Minta revisi');submit.type='submit';
    form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();if(!input.value.trim()){input.setCustomValidity('Jelaskan perubahan yang dibutuhkan.');input.reportValidity();return;}reviewTask(task,'revise',input.value.trim());};article.append(form);
  }
  function managerReviewControls(task,article){
    article.append(node('div',task.result,'task-result'));
    const who = chainFor(task.assignee)[0];
    if (task.managerAdvice) {
      const advice = task.managerAdvice;
      article.append(node('p', `${who ? displayName(who) : 'Atasan'} (${advice.by}) menyarankan: ${advice.verdict === 'approve' ? 'setujui' : 'revisi'} — keputusan tetap milikmu.`, `task-agent advice-${advice.verdict}`));
      article.append(node('div', advice.text, 'task-result advice-text'));
    } else if (task.adviceError) {
      article.append(node('p', `Pertimbangan atasan gagal: ${task.adviceError}`, 'task-error'));
      article.append(action('Minta tinjau ulang', async () => {
        try { const saved = await call('PATCH', `/api/tasks/${task.id}`, {action: 'retry-advice', version: task.version || 0}); apply(tasks.map(t => t.id === task.id ? saved : t)); render(); feedback('Atasan AI membaca drafnya lagi.'); }
        catch (error) { failed(error); }
      }));
    } else if (who) article.append(node('p', `Menunggu ${displayName(who)} (atasan). Siapa pun yang membuka browser ini menyetujui sebagai atasan (kepercayaan lokal).`, 'task-agent'));
    const approve=action('Setujui sebagai atasan',()=>reviewTask(task,'manager-approve'));approve.className='task-primary';article.append(approve);
    const form=node('form'),label=node('label','Minta perubahan (kembali ke staf)'),input=node('textarea'),key=draftKey(task,'manager-review');
    input.id=`manager-review-${task.id}`;label.htmlFor=input.id;input.required=true;input.maxLength=5000;input.rows=3;input.value=draftRead(key);
    input.oninput=()=>{input.setCustomValidity('');draftWrite(key,input.value);};
    const submit=node('button','Minta perubahan');submit.type='submit';
    form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();if(!input.value.trim()){input.setCustomValidity('Jelaskan perubahan yang dibutuhkan.');input.reportValidity();return;}reviewTask(task,'manager-reject',input.value.trim());};article.append(form);
  }
  // An agent that asked instead of guessing: show its questions and take the answers.
  async function answerTask(task,answer){
    try{const saved=await call('PATCH',`/api/tasks/${task.id}`,{action:'answer',answer,version:task.version||0});apply(tasks.map(t=>t.id===task.id?saved:t));draftClear(draftKey(task,'answer'));render();feedback(`Jawaban terkirim. ${displayName(task.assignee)} melanjutkan tugas.`);}
    catch(error){failed(error);}
  }
  function answerControls(task,article){
    article.append(node('p',`${displayName(task.assignee)} butuh informasi tambahan sebelum menyusun draf:`,'task-agent'),node('div',task.questions,'task-result task-questions'));
    const form=node('form'),label=node('label','Jawaban kamu'),input=node('textarea'),key=draftKey(task,'answer');
    input.id=`answer-${task.id}`;label.htmlFor=input.id;input.required=true;input.maxLength=3000;input.rows=3;input.value=draftRead(key);
    input.oninput=()=>{input.setCustomValidity('');draftWrite(key,input.value);};
    const submit=node('button','Kirim jawaban');submit.type='submit';submit.className='task-primary';
    form.append(label,input,submit);form.onsubmit=e=>{e.preventDefault();if(!input.value.trim()){input.setCustomValidity('Tulis jawaban dulu.');input.reportValidity();return;}answerTask(task,input.value.trim());};
    article.append(form);
  }
  // With the server, the decision lives in Komunikasi; the detail shows the questions and a way there, never a second form.
  function decisionLink(task, article) {
    article.append(node('p',`${displayName(task.assignee)} butuh informasi tambahan:`,'task-agent'),node('div',task.questions||'','task-result task-questions'));
    const go=action('Jawab di Komunikasi',()=>window.Messenger.openDecision(task.id));go.className='task-primary';article.append(go);
  }
  function agentActions(task, article, actions) {
    const agent = agentFor(task.assignee);
    if (task.status === 'blocked' && task.questions && server) decisionLink(task, article);
    else if (task.status === 'blocked') answerControls(task, article);
    else if (task.status === 'manager-review') managerReviewControls(task, article);
    else if (task.status === 'queued' && task.error) {
      article.append(node('p', `Agen tidak bisa menyelesaikan: ${task.error}`, 'task-error'));
      actions.append(action('Coba lagi', () => update(task.id, 'queued')));
    } else if (task.status === 'queued') article.append(node('p', 'Menunggu agen AI mengambil tugas ini.', 'task-agent'));
    else if (task.status === 'active') article.append(node('p', agent.mode === 'claude' ? 'Agen AI sedang mengerjakan…' : 'Simulasi dry run berjalan…', 'task-agent'));
    else {
      article.append(node('p', task.by === 'dry-run' ? 'Hasil dry run, bukan output AI. Periksa sebelum dipakai.' : task.by ? `Draf oleh ${task.providerId ? `${task.providerId} · ` : ''}${task.by}${task.usedFallback ? ' (cadangan)' : ''}. Periksa sebelum dipakai.` : 'Hasil', 'task-agent'));
      if(task.status==='review')reviewControls(task,article);else article.append(node('div', task.result, 'task-result'));
    }
    article.append(actions);
  }
  const announce = () => document.dispatchEvent(new CustomEvent('officetasks:change'));
  function divisionTasks(division) { return tasks.filter(task => (task.division || orgState.members.find(member => member.name === task.assignee)?.division) === division); }
  function splitForm(task, article) {
    const form=node('form',undefined,'split-form'),title=node('input'),label=node('label','Judul sub-tugas'),select=node('select');
    title.name='title';title.required=true;title.maxLength=160;title.placeholder='Judul sub-tugas';label.htmlFor=`split-title-${task.id}`;title.id=label.htmlFor;
    const members=orgState.members.filter(member=>member.active&&(member.divisions||[member.division]).includes(task.division));members.forEach(member=>{const option=node('option',`${displayName(member.name)} · ${member.role}`);option.value=member.name;select.append(option);});
    const brief=node('textarea');brief.name='brief';brief.rows=2;brief.maxLength=5000;brief.placeholder='Instruksi';const submit=node('button','Buat sub-tugas');submit.type='submit';submit.className='task-primary';form.append(label,title,node('label','Penanggung jawab'),select,node('label','Instruksi'),brief,submit);
    form.onsubmit=async event=>{event.preventDefault();try{const body={title:title.value.trim(),assignee:select.value,division:task.division,parentId:task.id,asLead:false,brief:brief.value.trim(),status:'queued',result:''};let saved;if(server)saved=await call('POST','/api/tasks',body);else{saved={id:crypto.randomUUID(),...body,priority:'normal',progressPct:0,messages:[],kind:'work',legacy:false,createdAt:new Date().toISOString()};if(!persist([saved,...tasks]))return;}tasks=[saved,...tasks.filter(item=>item.id!==saved.id)];render();feedback('Sub-tugas dibuat.');}catch(error){if(recoverOrgLock(error))return;feedback(error.message);}};
    return form;
  }
  function renderSummary() {
    const summary=document.querySelector('.owner-summary');summary.replaceChildren(node('h3','Ringkasan owner'));orgState.divisions.forEach(division=>{const list=divisionTasks(division.id),card=node('section',undefined,'owner-summary-card');card.append(node('h4',division.name),node('p',`Antre ${list.filter(task=>task.status==='queued').length} · Berjalan ${list.filter(task=>['active','blocked'].includes(task.status)).length} · Review ${list.filter(task=>['manager-review','review'].includes(task.status)).length}`));const roots=list.filter(task=>!task.parentId);if(roots.length)card.append(node('p',`Tugas lead: ${roots.map(task=>task.title).join(', ')}`));summary.append(card);});
  }
  async function unlockFlow(){
    const dialog=el('pinDialog');if(!dialog)return false;dialog.showModal();el('orgPin').value='';el('pinMessage').textContent='';el('orgPin').focus();
    return new Promise(resolve=>{pendingUnlockResolve=resolve;const form=el('pinForm');form.onsubmit=async event=>{event.preventDefault();try{const result=await call('POST','/api/org/unlock',{pin:el('orgPin').value});orgToken=result.token;try{sessionStorage.setItem('kantor-ai.orgToken',orgToken)}catch{};orgState=await call('GET','/api/org');dialog.close();pendingUnlockResolve=null;renderOrg();syncLock();resolve(true);}catch(error){el('pinMessage').textContent=error.message;}};});
  }
  function cancelUnlock(){const dialog=el('pinDialog');if(dialog?.open)dialog.close();el('orgPin').value='';el('pinMessage').textContent='';pendingUnlockResolve?.(false);pendingUnlockResolve=null;}
  function syncLock(){const button=el('bLock');button.textContent=orgToken?'Terbuka':'Kunci';button.setAttribute('aria-pressed',String(!!orgToken));}
  function clearOrgToken(){feedAbort?.abort();feedAbort=null;orgToken='';try{sessionStorage.removeItem('kantor-ai.orgToken')}catch{};syncLock();}
  function recoverOrgLock(error){if(error.code!=='ORG_LOCKED'&&!error.message.includes('owner unlock'))return false;clearOrgToken();renderOrg();unlockFlow();return true;}
  // The chart reads and writes organization data only through this object.
  const orgApi={
    getState:()=>orgState,
    isUnlocked:()=>!!orgToken,
    unlock:()=>unlockFlow(),
    clearToken:clearOrgToken,
    // Model choices come from the providers fetched in Settings; a member route is stored as a settings override.
    modelOptions:()=>window.officeModels?.options()||[],
    routeOf:value=>window.officeModels?.routeOf(value)||null,
    memberRoute:name=>window.officeModels?.routeValue(window.officeModels.overrides?.()[name])||'',
    memory:name=>call('GET',`/api/agents/${encodeURIComponent(name)}/memory`),
    saveMemory:(name,items)=>call('PUT',`/api/agents/${encodeURIComponent(name)}/memory`,{items}),
    async saveMemberRoutes(map){const routes=Object.fromEntries(Object.entries(map).map(([name,value])=>[name,window.officeModels.routeOf(value)]));await call('PUT','/api/settings/member-routes',{routes});await window.officeModels.load(true);},
    async save(next){orgState=await call('PUT','/api/org',{...next,version:orgState.version});orgChanged();return orgState;},
    async reload(){orgState=await call('GET','/api/org');orgChanged();},
    async reassign(from,to){const result=await call('POST','/api/tasks/reassign',{from,to});tasks=await call('GET','/api/tasks');render();return result;},
    feedback,
    openWizard:mode=>window.OrgWizard?.open(mode,wizardApi),
    openReset:()=>window.OrgWizard?.openReset(wizardApi),
    async sendRosterReview(id){const division=orgState.divisions.find(item=>item.id===id);try{const task=await call('POST','/api/tasks',{title:`Review roster ${division.name}`,assignee:division.lead,division:division.id,asLead:true,kind:'roster-review',brief:`Review every member currently assigned to ${division.name}. Return active, idle, and recommended changes.`});tasks=[task,...tasks];render();feedback(`Review roster dikirim ke ${division.lead}.`);}catch(error){if(recoverOrgLock(error))return;feedback(error.message);}}
  };
  const wizardApi={...orgApi,call,setToken(token){orgToken=token;try{sessionStorage.setItem('kantor-ai.orgToken',token)}catch{};syncLock();},setState(next){orgState=next;orgChanged();},async reloadTasks(){tasks=await call('GET','/api/tasks');render();}};
  // After any organization change: redraw the chart and let the 3D office re-seat everyone.
  function orgChanged(){if(el('orgDialog')?.open)renderOrg();window.officeScene?.applyOrg?.(orgState);}
  function renderOrg() {
    const panel=el('orgPanel');
    if(!server){
      panel.dataset.mounted='';
      panel.replaceChildren(node('h3','Ringkasan organisasi'),node('p','Mode offline: pengaturan organisasi ditampilkan secara lokal; buka kunci tersedia saat server lokal terhubung.','org-reset-hint'));
      orgState.divisions.forEach(division=>{const section=node('section',undefined,'org-division');section.append(node('h4',`${division.name} · Lead: ${division.lead}`));orgState.members.filter(member=>member.active&&(member.divisions||[member.division]).includes(division.id)).forEach(member=>section.append(node('p',`${member.name} · ${member.role}${member.name===division.lead?' · Lead':''} · Effort ${member.effort||'standard'} · Beban ${member.workloadPct??100}%${member.instructions?` · ${member.instructions}`:''}`)));panel.append(section);});
      return;
    }
    if(panel.dataset.mounted!=='chart'){panel.dataset.mounted='chart';window.OrgChart.mount(panel,orgApi);}else window.OrgChart.render();
  }
  // Polling carries summaries; the task being shown is upgraded to its full record once.
  const fullRequests=new Set();
  function ensureFull(task){
    if(!server||!task||Object.hasOwn(task,'brief')||fullRequests.has(task.id))return;
    fullRequests.add(task.id);
    call('GET',`/api/tasks/${task.id}`).then(full=>{
      fullRequests.delete(task.id);if(!full?.id)return;
      tasks=tasks.map(item=>item.id===full.id?full:item);
      if(selectedId===full.id)render();
    }).catch(()=>fullRequests.delete(task.id));
  }
  function render() {
    const focused=el('taskList').contains(document.activeElement)&&document.activeElement.tagName==='TEXTAREA'?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    announce();
    const list = el('taskList'); list.replaceChildren();
    const done = tasks.filter(t => t.status === 'done').length;
    el('taskCount').textContent = tasks.length - done;
    el('taskSummary').textContent = `${tasks.length} tugas · ${done} selesai`;
    el('exportTasks').disabled = tasks.length === 0;
    syncDivisionFilter();
    const visible = tasks.filter(t => (el('taskFilter').value === 'all' || t.status === el('taskFilter').value) &&
      (el('divisionFilter').value === 'all' || t.division === el('divisionFilter').value) &&
      (el('agentFilter').value === 'all' || t.assignee === el('agentFilter').value));
    // Keep the owner's selection; otherwise show what most needs attention.
    const rank = {blocked:0, review:1, 'manager-review':1, active:2, queued:3, done:4};
    let selected = tasks.find(t => t.id === selectedId);
    if (!selected || !visible.includes(selected)) selected = [...visible].sort((a,b) => rank[a.status]-rank[b.status])[0] || null;
    selectedId = selected?.id || null;
    if(selected)ensureFull(selected);
    window.TaskWorkspace.update({visible, all: tasks, selectedId});
    if (activeView === 'flow') window.TaskFlow.renderFlow();
    if (activeView === 'console') window.TaskFlow.renderConsole();
    renderSummary();
    if (!visible.length) list.append(node('p', tasks.length ? 'Tidak ada tugas yang cocok dengan filter ini.' : 'Belum ada tugas. Klik + Tugas untuk pekerjaan pertama tim.', 'task-empty'));
    for (const task of selected ? [selected] : []) {
      const article = node('article', undefined, 'task-item');
      const agent = agentFor(task.assignee);
      article.append(node('h3', task.title), node('div', `${chainText(task.assignee)} · ${states[task.status]}${agent ? ` · AI agent${agent.mode === 'claude' ? ` · ${agent.provider ? `${agent.provider} · ` : ''}${agent.model}` : ''}` : ''}`, 'task-meta'));
      if (task.parentId) { const parent = tasks.find(t => t.id === task.parentId); if (parent) { const up = action(`Bagian dari: ${parent.title}`, () => select(parent.id)); up.className = 'task-root-link'; article.append(up); } }
      if (task.brief) article.append(node('p', task.brief));
      const facts = [task.outputType === 'application' ? `Aplikasi · diuji di ${task.environment === 'windows' ? 'Windows lokal' : 'Docker'}` : null, task.executionMode === 'automatic' ? 'Otomatis dibagi lead' : null].filter(Boolean);
      if (facts.length) article.append(node('p', facts.join(' · '), 'task-meta'));
      if (task.acceptance?.length) { const criteria = node('ul', undefined, 'task-acceptance'); task.acceptance.forEach(item => criteria.append(node('li', item))); article.append(node('h4', 'Kriteria diterima'), criteria); }
      const kids = tasks.filter(t => t.parentId === task.id);
      if (kids.length) { const sub = node('ul', undefined, 'task-children'); kids.forEach(kid => { const li = node('li'); li.append(action(`${kid.title} · ${displayName(kid.assignee)} · ${states[kid.status]}`, () => select(kid.id))); sub.append(li); }); article.append(node('h4', `Subtugas (${kids.length})`), sub); }
      const progress=node('progress',undefined,'task-progress');progress.max=100;progress.value=task.progressPct||0;progress.setAttribute('aria-label','Progres tugas');progress.setAttribute('aria-valuenow',String(task.progressPct||0));article.append(progress,node('span',`${task.progressPct||0}% selesai`,'task-progress-label'));
      if(task.messages?.length){const messages=node('section',undefined,'task-messages');messages.setAttribute('aria-label','Pesan tugas');messages.append(node('h4','Pesan tindak lanjut'));task.messages.forEach(message=>messages.append(node('p',`${message.by||'Owner'} · ${message.text}`,'task-message')));article.append(messages);}
      if(task.history?.length){const history=node('details'),summary=node('summary',`Riwayat draf (${task.history.length})`);history.append(summary);task.history.forEach((draft,i)=>{history.append(node('h4',`Draf ${i+1} · ${draft.by||'Tersimpan'}`));if(draft.feedback)history.append(node('p',`Catatan revisi: ${draft.feedback}`));history.append(node('div',draft.result,'task-result'));});article.append(history);}
      const followup=node('form',undefined,'task-followup'),followupLabel=node('label','Tindak lanjut'),followupInput=node('input');followupLabel.htmlFor=`message-${task.id}`;followupInput.id=followupLabel.htmlFor;followupInput.maxLength=2000;followupInput.placeholder='Tambahkan pesan tindak lanjut';const followupButton=node('button','Kirim pesan');followupButton.type='submit';followup.append(followupLabel,followupInput,followupButton);followup.onsubmit=event=>{event.preventDefault();sendMessage(task,displayName(task.assignee),followupInput.value);followupInput.value='';};article.append(followup);
      const progressForm=node('form',undefined,'task-progress-form'),progressLabel=node('label','Progress'),progressInput=node('input');progressLabel.htmlFor=`progress-input-${task.id}`;progressInput.id=progressLabel.htmlFor;progressInput.type='number';progressInput.min=0;progressInput.max=100;progressInput.step=1;progressInput.value=task.progressPct||0;const progressButton=node('button','Perbarui progres');progressButton.type='submit';progressForm.append(progressLabel,progressInput,progressButton);progressForm.onsubmit=event=>{event.preventDefault();setProgress(task,progressInput.value);};article.append(progressForm);
      const actions = node('div', undefined, 'task-actions');
      if (!team.some(person => person.n === task.assignee)) {
        article.append(node('p', 'Anggota ini sudah tidak ada di tim. Pilih anggota tim untuk melanjutkan.'));
        const select = node('select'); select.setAttribute('aria-label', `Penanggung jawab baru untuk ${task.title}`);
        for (const person of team) { const option = node('option', displayName(person.n)); option.value = person.n; select.append(option); }
        actions.append(action('Pindahkan tugas', () => reassign(task.id, select.value)));
        if (task.result) article.append(node('div', task.result, 'task-result'));
        article.append(select, actions); list.append(article); continue;
      }
      if (server) { const talk = action('Buka percakapan', () => window.Messenger.open({taskId: task.id})); talk.className = 'task-primary'; actions.append(talk); }
      actions.append(action('Tunjukkan karakter', () => { window.officeNav.close(); locate(task.assignee); }));
      if (!task.parentId && task.status !== 'done') { const split = action('Pecah', () => { if (!article.querySelector('.split-form')) article.append(splitForm(task, article)); }); split.className = 'task-split'; actions.append(split); }
      if(task.outputType==='application'&&server){
        window.ApplicationPanel.mount(article,task,{call,feedback,reload:async()=>{apply(await call('GET','/api/tasks'));render();},source:async(t,file)=>{const headers={};if(orgToken)headers['x-kantor-org']=orgToken;const r=await fetch(`/api/projects/${t.projectId}/revisions/${t.revisionId}/files/${file.split('/').map(encodeURIComponent).join('/')}`,{headers});if(!r.ok)throw Error('Sumber tidak dapat dimuat.');return r.text();}});
        if(task.status==='review')reviewControls(task,article);else if(task.status==='manager-review')managerReviewControls(task,article);article.append(actions);list.append(article);continue;
      }
      if (agent) { agentActions(task, article, actions); list.append(article); continue; }
      if(task.status==='review'){reviewControls(task,article);article.append(actions);list.append(article);continue;}
      if(task.status==='manager-review'){managerReviewControls(task,article);article.append(actions);list.append(article);continue;}
      if(task.status==='blocked'&&task.questions){if(server)decisionLink(task,article);else answerControls(task,article);article.append(actions);list.append(article);continue;}
      if (task.status === 'queued') actions.append(action('Mulai tugas', () => update(task.id, 'active')));
      if (task.status === 'active') {
        actions.append(action('Kembali ke antrean', () => update(task.id, 'queued')));
        const form = node('form');
        const label = node('label', 'Hasil'); label.htmlFor = `result-${task.id}`;
        const input = node('textarea'); input.id = label.htmlFor; input.required = true; input.maxLength = 10000; input.rows = 3;
        const key=draftKey(task,'result');input.value=draftRead(key);
        input.placeholder = 'Write the result or a document link before finishing the task';
        const submit = node('button', 'Simpan hasil & selesai'); submit.type = 'submit'; submit.className = 'task-primary';
        const footer = node('div', undefined, 'task-actions'); footer.append(submit);
        form.append(label, input, footer);
        form.onsubmit = event => {
          event.preventDefault();
          if (!input.value.trim()) { input.setCustomValidity('Isi hasil dulu.'); input.reportValidity(); return; }
          update(task.id, 'done', input.value.trim());
        };
        input.oninput = () => {input.setCustomValidity('');draftWrite(key,input.value);};
        article.append(actions, form);
      } else {
        if (task.status === 'done') article.append(node('div', task.result, 'task-result'));
        article.append(actions);
      }
      list.append(article);
    }
    if(focused){const input=document.getElementById(focused.id);if(input){input.focus({preventScroll:true});input.setSelectionRange(focused.start,focused.end);}}
  }
  function setView(view) {
    activeView = view;
    document.querySelectorAll('.task-views [data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    el('taskBoard').hidden = view !== 'board'; el('taskFlowView').hidden = view !== 'flow'; el('taskConsoleView').hidden = view !== 'console';
    if (view !== 'board') loadEvents(); render();
  }
  function addEvents(list) {
    const fresh = list.filter(event => event.seq > eventSeq);
    if (!fresh.length) return false;
    events = [...events, ...fresh].slice(-5000); eventSeq = fresh.at(-1).seq; return true;
  }
  // Events need the owner unlock. Without it the flow/console say so instead of showing an empty, misleading view.
  async function loadEvents() {
    if (!server || !orgToken) { if (activeView !== 'board') feedback('Buka kunci owner untuk melihat alur kerja dan console.'); return; }
    for (let guard = 0; guard < 20; guard++) {
      const page = await call('GET', `/api/task-events?after=${eventSeq}`).catch(error => { recoverOrgLock(error); return null; });
      if (!page) break;
      // History was pruned past this cursor: start again at the oldest retained event.
      if (page.resync) { events = []; eventSeq = Math.max(0, (page.firstSeq || 1) - 1); }
      if (!addEvents(page.events)) break;
    }
    render(); openFeed();
  }
  // SSE over fetch (headers carry the owner token); a dropped stream reconnects from the last seq, polling covers the gap.
  async function openFeed() {
    if (feedAbort || !orgToken) return;
    const controller = new AbortController(); feedAbort = controller;
    try {
      const response = await fetch(`/api/task-events?after=${eventSeq}`, {headers: {accept: 'text/event-stream', 'x-kantor-org': orgToken}, signal: controller.signal});
      if (!response.ok) throw new Error(String(response.status));
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        buffer += decoder.decode(value, {stream: true}); let cut, changedAny = false;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const field = name => block.split('\n').find(line => line.startsWith(name + ':'))?.slice(name.length + 1).trim();
          const data = field('data'); if (!data) continue;
          if (field('event') === 'resync') { events = []; eventSeq = 0; controller.abort(); feedAbort = null; loadEvents(); return; }
          changedAny = addEvents([JSON.parse(data)]) || changedAny;
        }
        if (changedAny) render();
      }
    } catch {}
    if (feedAbort === controller) { feedAbort = null; setTimeout(() => { if (orgToken) loadEvents(); }, 2500); }
  }
  function select(id, view) { if (view) activeView = view; selectedId = id; try { sessionStorage.setItem('kantor-ai.selectedTask', id); } catch {} if (view) setView(view); else render(); if (matchMedia('(max-width:1000px)').matches) el('taskDetail').scrollIntoView({block: 'start'}); }
  function syncDivisionFilter() {
    const select = el('divisionFilter'), value = select.value, ids = orgState.divisions.map(d => d.id).join();
    if (select.dataset.ids === ids) return;
    select.dataset.ids = ids; select.querySelectorAll('option[data-division]').forEach(option => option.remove());
    orgState.divisions.forEach(division => { const option = node('option', division.name); option.value = division.id; option.dataset.division = ''; select.append(option); });
    select.value = [...select.options].some(option => option.value === value) ? value : 'all';
  }
  // The note follows the current routing (Settings can change it at any time), not the value read at page load.
  function describeAgents(info) {
    const members = Object.entries(info.members || {});
    const live = members.filter(([, a]) => a.mode === 'claude').map(([name]) => displayName(name)), dry = members.filter(([, a]) => a.mode !== 'claude').map(([name]) => displayName(name));
    el('taskNote').textContent = !members.length ? 'Belum ada agen AI. Semua anggota adalah simulasi; ubah statusnya secara manual.'
      : `${live.length ? `${live.join(', ')} bekerja dengan provider LLM yang dikonfigurasi dan mengirim draf untuk kamu review. ` : ''}${dry.length ? `${dry.join(', ')} dalam mode dry run, jadi hasilnya hanya contoh. ` : ''}Anggota lain adalah simulasi.`;
  }
  async function refreshAgents() {
    if (!server) return;
    const info = await fetch('/api/agents', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).catch(() => null);
    if (info) { server = info; describeAgents(info); render(); }
  }
  function toggleCreate(show) {
    const form = el('taskCreateForm'); form.hidden = !show; el('taskCreate').setAttribute('aria-expanded', String(show));
    if (show) { syncOutput(); el('taskTitle').focus(); }
  }
  function syncOutput() { el('taskEnvironmentField').hidden = el('taskCreateForm').elements.taskOutput.value !== 'application'; }
  // Look for the server once at start. A static host (or no server) keeps the browser-only behaviour.
  async function connect() {
    let info;
    try {
      const session = await fetch('/api/session', {cache:'no-store'});
      if(session.ok) csrf=(await session.json()).csrf||'';
      const response = await fetch('/api/agents', {cache: 'no-store'});
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      info = await response.json();
    } catch { return; }
    let list = await call('GET', '/api/tasks').catch(() => null);
    if (!list) return;
    // First visit with the server: carry over tasks this browser saved before, if the server has none.
    if (!list.length && storageHealthy && tasks.length) {
      list = await call('POST', '/api/tasks/import', tasks).then(imported => { feedback(`${imported.length} tugas dari browser ini dipindahkan ke server.`); return imported; }).catch(() => list);
    }
    // Load the organization before marking the server ready, so an org dialog opened now never renders the offline fallback.
    const org = await call('GET','/api/org').catch(() => fallbackOrg());
    server = info;
    el('bLock').disabled=false;el('bLock').removeAttribute('title');syncLock();
    tasks = list;
    orgState = org;
    describeAgents(info);
    render();
    resolveReady(orgState);
    window.officeModels?.load();
    window.officeRooms?.start();
    // A fresh install has no owner PIN yet: walk the owner through building the organization.
    let snoozed=false;try{snoozed=sessionStorage.getItem('kantor-ai.wizardSnoozed')==='1';}catch{}
    if(orgState.configured===false&&!snoozed)window.OrgWizard?.open('first-run',wizardApi);
    tasks.filter(t => t.status === 'active' && team.some(person => person.n === t.assignee)).forEach(t => changed(t.assignee));
    document.dispatchEvent(new CustomEvent('officetasks:server', {detail: info}));
    const poll = async () => {
      if(document.hidden||polling||writing)return;polling=true;const ticket=mutation;
      const [latest,orgLatest] = await Promise.all([
        call('GET', `/api/tasks?summary=1${selectedId?`&full=${encodeURIComponent(selectedId)}`:''}`).catch(() => null),
        call('GET','/api/org').catch(() => null)
      ]);
      polling=false;if(ticket!==mutation)return;
      if(orgLatest&&orgLatest.version!==orgState.version){orgState=orgLatest;orgChanged();}
      if (!latest || JSON.stringify(latest) === JSON.stringify(tasks)) return;
      apply(latest);render();
    };
    setInterval(poll, 2500);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  }
  window.officeTasks = {
    activeFor: name => tasks.find(t => t.assignee === name && t.status === 'active'),
    online: () => !!server,
    state: () => structuredClone(orgState),
    ready,
    events: () => events.map(event => ({...event})),
    csrf: () => csrf,
    list: () => tasks.map(t => ({...t})),
    agentFor,
    divisionOf(name){const member=orgState.members.find(item=>item.name===name);return orgState.divisions.find(item=>item.id===member?.division)?.name||member?.division||null;},
    openOrg(){orgState=orgState||fallbackOrg();const opened=window.officeNav.open('orgDialog');renderOrg();syncLock();return opened;},
    async unlockFlow(){return unlockFlow();},
    cancelUnlock,
    toggleLock(){if(!server)return false;if(orgToken){clearOrgToken();renderOrg();return true;}return unlockFlow();},
    // From a person: their tasks plus the create form for them. From the decisions badge: what waits on the owner.
    open(name, status = 'all') {
      if (name) el('taskAssignee').value = name;
      el('agentFilter').value = name || 'all';
      el('taskFilter').value = status;
      if (status !== 'all' && tasks.find(t => t.id === selectedId)?.status !== status) selectedId = null;
      render();
      window.officeNav.open('taskDialog');
      if (name) toggleCreate(true);
    },
    // The office passes its people again whenever the organization changes.
    setTeam(people) {
      team = people;
      for (const id of ['taskAssignee', 'agentFilter']) {
        const select = el(id), value = select.value;
        select.querySelectorAll('option[data-member]').forEach(option => option.remove());
        for (const person of team) { const option = node('option', `${displayName(person.n)} · ${person.role}`); option.value = person.n; option.dataset.member = ''; select.append(option); }
        if ([...select.options].some(option => option.value === value)) select.value = value;
      }
      render();
    },
    init(people, onChange, onLocate) {
      changed = onChange; locate = onLocate;
      window.officeTasks.setTeam(people);
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved), migrated=Array.isArray(parsed)?parsed.map(normalizeLocalTask):null;
          if (!migrated || !migrated.every(validTask) || new Set(migrated.map(t => t.id)).size !== migrated.length ||
            new Set(migrated.filter(t => t.status === 'active').map(t => t.assignee)).size !== migrated.filter(t => t.status === 'active').length) throw new Error('Invalid task data');
          tasks = migrated;
        }
        saveOrgSeed();
      } catch { storageHealthy = false; feedback('Data tugas tidak bisa dibaca. Data lama dipertahankan; perubahan diblokir.'); }
      for (const name of new Set(tasks.filter(task => !team.some(person => person.n === task.assignee)).map(task => task.assignee))) {
        const option = node('option', `${name} (prototipe lama)`); option.value = name; el('agentFilter').append(option);
      }
      el('closeTasks').onclick = () => window.officeNav.close();
      el('bLock').disabled=true;el('bLock').title='Butuh server lokal';syncLock();
      window.TaskWorkspace.mount(el('taskBoard'), {select, displayName, divisionName: id => orgState.divisions.find(d => d.id === id)?.name || id});
      window.Messenger.mount({call, displayName, feedback, online: () => !!server, unlocked: () => !!orgToken, unlock: unlockFlow, locked: error => recoverOrgLock(error),
        task: id => tasks.find(t => t.id === id), statusName: status => states[status] || status,
        source: async(t,file)=>{const headers={};if(orgToken)headers['x-kantor-org']=orgToken;const r=await fetch(`/api/projects/${t.projectId}/revisions/${t.revisionId}/files/${file.split('/').map(encodeURIComponent).join('/')}`,{headers});if(!r.ok)throw Error('Sumber tidak dapat dimuat.');return r.text();},
        openTask: id => { el('agentFilter').value = 'all'; el('taskFilter').value = 'all'; el('divisionFilter').value = 'all'; window.officeNav.open('taskDialog'); select(id, 'board'); },
        reloadTasks: async () => { const latest = await call('GET', '/api/tasks').catch(() => null); if (latest) { apply(latest); render(); } }});
      window.TaskFlow.mount({tasks: () => tasks, events: () => events, selectedId: () => selectedId, select, displayName, thread: id => call('GET', `/api/tasks/${id}/thread`)});
      document.querySelectorAll('.task-views [data-view]').forEach(button => { button.onclick = () => setView(button.dataset.view); });
      el('taskFilter').onchange = render; el('agentFilter').onchange = render; el('divisionFilter').onchange = render;
      el('taskCreate').onclick = () => toggleCreate(el('taskCreateForm').hidden);
      el('taskCreateCancel').onclick = () => toggleCreate(false);
      el('taskCreateForm').addEventListener('change', syncOutput);
      window.officeNav.onOpen(id => { if (id === 'taskDialog') refreshAgents(); });
      el('taskCreateForm').onsubmit = async event => {
        event.preventDefault();
        const title = el('taskTitle').value.trim();
        if (!title) { el('taskTitle').setCustomValidity('Isi nama tugas.'); el('taskTitle').reportValidity(); return; }
        const form = el('taskCreateForm').elements, outputType = form.taskOutput.value, executionMode = form.taskMode.value, assignee = el('taskAssignee').value;
        const acceptance = el('taskAcceptance').value.split('\n').map(line => line.trim()).filter(Boolean);
        const draft = {title, assignee, createdBy:'owner', brief: el('taskBrief').value.trim(), status: 'queued', result: '', outputType, executionMode, acceptance,
          ...(outputType === 'application' ? {environment: el('taskEnvironment').value} : {}),
          // Automatic work is planned by a lead; leads' direct tasks keep the manual "Pecah" flow.
          // A division lead receives the task as lead: automatic = plan, delegate and review; direct = do it personally.
          ...(orgState.divisions.some(d => d.lead === assignee) ? {asLead: true} : {})};
        let task;
        if (server) {
          try { task = await call('POST', '/api/tasks', draft); tasks = [task, ...tasks]; if (task.status !== 'queued') changed(task.assignee, task.status, task.title); }
          catch (error) { feedback(error.message); return; }
        } else {
          task = {id: crypto.randomUUID(), ...draft, createdAt: new Date().toISOString()};
          if (!persist([task, ...tasks])) return;
        }
        el('taskTitle').value = ''; el('taskBrief').value = ''; el('taskAcceptance').value = '';
        el('agentFilter').value = 'all'; el('taskFilter').value = 'all'; el('divisionFilter').value = 'all';
        toggleCreate(false); select(task.id); feedback(`Tugas ditambahkan untuk ${displayName(task.assignee)}${agentFor(task.assignee) ? '. Agen AI akan mengambilnya.' : '.'}`);
      };
      el('taskTitle').oninput = () => el('taskTitle').setCustomValidity('');
      el('exportTasks').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(tasks, null, 2)], {type: 'application/json'}));
        const link = node('a'); link.href = url; link.download = 'kantor-ai-tasks.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('Salinan tugas diekspor.');
      };
      try { orgState = JSON.parse(localStorage.getItem(orgStorageKey)) || fallbackOrg(); } catch { orgState = fallbackOrg(); }
      render();
      tasks.filter(t => t.status === 'active' && team.some(person => person.n === t.assignee)).forEach(t => changed(t.assignee));
      connect().finally(()=>{if(!server)resolveReady(null);});
    }
  };
})();
