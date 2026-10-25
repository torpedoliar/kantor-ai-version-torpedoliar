// Komunikasi: one thread per task, decision cards, unread badges and persistent decision toasts.
// The server owns read cursors and decisions; this view only reflects them.
(() => {
  const el = id => document.getElementById(id);
  const draftKey = id => `kantor-ai.composer.${id}`;
  // Activity per thread (status + event lines), refreshed with the inbox; a 1s ticker keeps elapsed time live.
  const activity = new Map(); let ticker = null;
  let api = null, data = {threads: [], messages: [], decisions: [], reads: {}}, current = null, filter = 'all', loaded = false, timer = null;
  const toasted = new Set();
  function node(tag, text, className) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; }
  function readDraft(id) { try { return sessionStorage.getItem(draftKey(id)) || ''; } catch { return ''; } }
  function writeDraft(id, value) { try { value ? sessionStorage.setItem(draftKey(id), value) : sessionStorage.removeItem(draftKey(id)); } catch {} }
  const time = at => new Date(at).toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'});
  // Only decisions addressed to the owner notify; a question a lead is answering for its team is not yours yet.
  const openDecisions = () => data.decisions.filter(d => d.status === 'open' && (!d.target || d.target === 'owner'));

  async function refresh() {
    if (!api.unlocked()) return;
    try {
      // ponytail: whole inbox per refresh; page by seq when threads × messages get large.
      // Rebuild the open thread only when something it draws changed; idle polls must not wipe open panels or previews.
      const before = threadKey();
      data = await api.call('GET', '/api/communications?after=0');
      loaded = true; badge(); toasts(); alertToasts(); markHere();
      if (el('communicationDialog').open && current) { const task = data.threads.find(t => t.id === current)?.taskId; if (task) activity.set(current, await api.call('GET', `/api/tasks/${task}/activity`).catch(() => null)); }
      if (el('communicationDialog').open) { renderList(); if (before !== threadKey()) renderThread(); else renderStatus(); markHere(); }
    } catch (error) { api.locked(error); }
  }
  function badge() {
    const unread = data.threads.reduce((sum, t) => sum + t.unread, 0), open = openDecisions().length, button = el('bCommunications');
    button.querySelector('.badge').textContent = unread || '';
    button.querySelector('.decision-dot').hidden = !open;
    button.setAttribute('aria-label', `Komunikasi${unread ? ` · ${unread} belum dibaca` : ''}${open ? ` · ${open} keputusan menunggu` : ''}`);
  }
  // One toast per open decision, keyed by decision id: reloads and reconnects never stack duplicates.
  function alertToasts() {
    const center = el('notificationCenter'), alerts = data.alerts || [], keys = alerts.map(a => `${a.taskId}:${a.since}`);
    center.querySelectorAll('.toast[data-alert]').forEach(t => { if (!keys.includes(t.dataset.alert)) t.remove(); });
    for (const alert of alerts) {
      const key = `${alert.taskId}:${alert.since}`;
      if (center.querySelector(`.toast[data-alert="${CSS.escape(key)}"]`)) continue;
      const toast = node('button', `Gagal · ${alert.text}`, 'toast toast-error'); toast.type = 'button'; toast.dataset.alert = key;
      toast.onclick = () => { toast.remove(); open_({taskId: alert.taskId}); };
      center.append(toast);
    }
  }
  function toasts() {
    const center = el('notificationCenter'), open = openDecisions();
    center.querySelectorAll('.toast[data-decision-id]').forEach(toast => { if (!open.some(d => d.id === toast.dataset.decisionId)) toast.remove(); });
    for (const decision of open) {
      if (center.querySelector(`.toast[data-decision-id="${decision.id}"]`)) continue;
      const thread = data.threads.find(t => t.id === decision.threadId), who = api.displayName(thread?.assignee || decision.askedBy || 'Agen');
      const toast = node('button', `${who} ${decision.kind==='approval'?'menunggu izin pengujian':'menunggu jawabanmu'} · ${thread?.title || 'Tugas'}`, 'toast'); toast.type = 'button';
      toast.dataset.decisionId = decision.id; toast.onclick = () => open_({taskId: decision.taskId, decisionId: decision.id});
      center.append(toast);
      if (!toasted.has(decision.id) && 'Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Kantor Kita', {body: toast.textContent, tag: decision.id});
      toasted.add(decision.id);
    }
  }
  function renderList() {
    const list = el('threadList');
    const shown = data.threads.filter(t => filter === 'all' || (filter === 'decision' ? openDecisions().some(d => d.threadId === t.id) : t.unread));
    list.replaceChildren(...shown.map(thread => {
      const item = node('button', undefined, 'thread-item'); item.type = 'button'; item.dataset.threadId = thread.id;
      if (thread.id === current) item.setAttribute('aria-current', 'true');
      const head = node('span', undefined, 'thread-head'); head.append(node('strong', thread.title), node('time', thread.lastMessage ? time(thread.lastMessage.at) : ''));
      item.append(head, node('span', `${api.displayName(thread.assignee || '')}${thread.lastMessage ? ` · ${thread.lastMessage.text}` : ''}`, 'thread-last'));
      if (openDecisions().some(d => d.threadId === thread.id)) item.append(node('span', 'Butuh jawaban', 'task-badge task-badge-owner'));
      if (thread.unread) item.append(node('span', String(thread.unread), 'thread-unread'));
      item.onclick = () => select(thread.id);
      return item;
    }));
    if (!shown.length) list.append(node('p', 'Tidak ada percakapan di filter ini.', 'task-column-empty'));
  }
  function bubble(message) {
    const item = node("div", undefined, `bubble bubble-${message.sender.type}${message.kind==="error"?" bubble-error":""}`); item.dataset.seq = message.seq;
    item.append(node('span', `${message.sender.type === 'owner' ? 'Kamu' : message.sender.name} · ${time(message.at)}${message.kind !== 'text' && message.kind !== 'decision' ? ` · ${{delegation: 'delegasi', result: 'hasil'}[message.kind] || message.kind}` : ''}`, 'bubble-meta'), node('p', message.text));
    return item;
  }
  function decisionCard(decision, message) {
    const card = node('section', undefined, 'decision-card'); card.dataset.status = decision.status; card.dataset.decisionId = decision.id;
    card.append(node('h4', decision.status === 'open' ? 'Butuh keputusanmu' : decision.status === 'answered' ? 'Sudah dijawab' : 'Dibatalkan'), node('p', message?.text || (decision.questions || []).join('\n'), 'decision-questions'));
    if (decision.status === 'answered') card.append(node('p', `Jawabanmu: ${decision.answer}`, 'task-meta'));
    if (decision.status !== 'open') return card;
    const form = node('form'), label = node('label', 'Jawaban'), input = node('textarea'), submit = node('button', 'Kirim & lanjutkan');
    input.id = 'decisionAnswer'; label.htmlFor = input.id; input.rows = 3; input.maxLength = 3000; input.value = readDraft(`decision:${decision.id}`);
    input.oninput = () => writeDraft(`decision:${decision.id}`, input.value);
    input.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); } };
    submit.type = 'submit'; submit.className = 'task-primary';
    (decision.options || []).forEach(option => { const pick = node('button', option, 'decision-option'); pick.type = 'button'; pick.onclick = () => { input.value = option; input.oninput(); }; form.append(pick); });
    form.append(label, input, submit);
    form.onsubmit = async event => {
      event.preventDefault(); const answer = input.value.trim(); if (!answer) { input.focus(); return; }
      submit.disabled = true;
      try { await api.call('POST', `/api/decisions/${decision.id}/answer`, {answer, version: decision.version}, {request: `answer:${decision.id}:${decision.version}`}); writeDraft(`decision:${decision.id}`, ''); api.feedback('Jawaban terkirim. Agen melanjutkan tugas.'); await refresh(); api.reloadTasks(); }
      catch (error) { submit.disabled = false; el('messengerStatus').textContent = error.message; if (error.code === 'VERSION_CONFLICT') refresh(); }
    };
    card.append(form); return card;
  }
  function renderThread() {
    const timeline = el('messageTimeline'), thread = data.threads.find(t => t.id === current);
    el('communicationDialog').classList.toggle('thread-open', !!thread);
    el('threadTitle').textContent = thread ? thread.title : 'Pilih percakapan';
    el('messageComposer').hidden = !thread;
    const waiting=thread&&openDecisions().some(d=>d.threadId===thread.id&&d.kind!=='approval');
    const owned=thread&&api.task(thread.taskId),failed=!waiting&&owned?.error&&owned.status==='queued';
    document.querySelector('label[for="composerText"]').textContent=failed?'Tugas gagal: kirim pesan (mis. "lanjutkan") untuk mencoba lagi':waiting?'Jawab pertanyaan agen (balasan ini dipakai sebagai jawaban)':'Pesan untuk tugas ini';
    const context = el('threadContext'); context.replaceChildren();
    if (!thread) { timeline.replaceChildren(node('p', 'Pilih percakapan di kiri.', 'task-column-empty')); return; }
    const task = api.task(thread.taskId);
    if (task) {
      context.append(node('h4', 'Konteks tugas'), node('p', `${api.displayName(task.assignee)} · ${api.statusName(task.status)}${task.status === 'active' ? ' (balasanmu dipakai di langkah berikutnya)' : ''}`, 'task-meta'));
      if (task.brief) context.append(node('p', task.brief.slice(0, 400)));
      const open = node('button', 'Buka di Tugas'); open.type = 'button'; open.onclick = () => api.openTask(task.id); context.append(open);
      const kids = data.threads.filter(t => api.task(t.taskId)?.parentId === task.id);
      if (kids.length) { context.append(node('h4', 'Percakapan subtugas')); kids.forEach(kid => { const link = node('button', kid.title, 'task-root-link'); link.type = 'button'; link.onclick = () => select(kid.id); context.append(link); }); }
    }
    // Keep the reader where they are unless they were already at the bottom.
    const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 24, prior = timeline.scrollTop, rendered = timeline.dataset.thread === current;
    const messages = data.messages.filter(m => m.threadId === current), decisions = data.decisions.filter(d => d.threadId === current);
    // A background refresh must not take the owner's cursor out of the answer box.
    const active = timeline.contains(document.activeElement) ? {id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd} : null;
    // Messages and activity lines interleave by sequence, like a session log between replies.
    const act = activity.get(current), entries = [...messages.map(m => ({seq: m.seq, message: m})), ...(act?.items || []).map(i => ({seq: i.seq, line: i}))].sort((a, b) => a.seq - b.seq);
    timeline.replaceChildren(...entries.map(entry => {
      if (entry.line) { const row = node('div', undefined, `activity-line activity-${entry.line.type.split('.')[0]}${/failed|rejected/.test(entry.line.type) ? ' activity-error' : ''}`); row.append(node('time', time(entry.line.at)), node('span', entry.line.text)); return row; }
      const message = entry.message, decision = message.kind === 'decision' && decisions.find(d => d.id === message.decisionId);
      return decision ? decisionCard(decision, message) : bubble(message);
    }));
    if(act?.typing?.text){const live=node('div',undefined,'bubble bubble-agent bubble-typing');live.append(node('span',`${act.typing.agent} · sedang menulis…`,'bubble-meta'),node('p',act.typing.text));timeline.append(live);}
    renderStatus();
    if(task?.outputType==='application'&&task.revisionId)window.ApplicationPanel.mount(timeline,task,{call:api.call,feedback:api.feedback,reload:async()=>{await api.reloadTasks();await refresh();},source:api.source});
    timeline.dataset.thread = current;
    if (active?.id) { const input = document.getElementById(active.id); if (input) { input.focus({preventScroll: true}); input.setSelectionRange?.(active.start, active.end); } }
    timeline.scrollTop = !rendered || atBottom ? timeline.scrollHeight : prior;
    const composer = el('composerText'); if (composer.dataset.thread !== current) { composer.dataset.thread = current; composer.value = readDraft(current); }
    markRead(messages.at(-1)?.seq);
  }
  async function markRead(seq) {
    const thread = data.threads.find(t => t.id === current);
    if (!seq || !thread || !thread.unread || document.hidden || !el('communicationDialog').open) return;
    try { await api.call('PUT', `/api/communications/${encodeURIComponent(current)}/read`, {throughSeq: seq}); thread.unread = 0; badge(); renderList(); } catch (error) { api.locked(error); }
  }
  // The toast for the decision already on screen would only cover the composer.
  const elapsed = since => { const s = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000)); return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`; };
  // Status bar: what is happening now, for how long, which model, and real subtask counts.
  function renderStatus() {
    const bar = el('threadStatus'), status = activity.get(current)?.status;
    bar.hidden = !status; if (!status) { clearInterval(ticker); ticker = null; return; }
    bar.classList.toggle('busy', !!status.busy);
    const parts = [node('strong', status.label)];
    if (status.since) parts.push(node('span', `· ${elapsed(status.since)}`, 'thread-status-time'));
    if (status.model) parts.push(node('span', `· ${status.model}`, 'thread-status-meta'));
    if (status.progress) parts.push(node('span', `· ${status.progress.done}/${status.progress.total} subtugas selesai`, 'thread-status-meta'));
    if (status.working?.length) parts.push(node('span', `· sedang dikerjakan: ${status.working.map(w => `${api.displayName(w.assignee)} (${w.title})`).join(', ')}`, 'thread-status-meta'));
    bar.replaceChildren(node('span', '', 'thread-status-dot'), ...parts);
    if (status.since && !ticker) ticker = setInterval(() => { const t = bar.querySelector('.thread-status-time'), s = activity.get(current)?.status; if (t && s?.since) t.textContent = `· ${elapsed(s.since)}`; }, 1000);
    if (!status.since && ticker) { clearInterval(ticker); ticker = null; }
  }
  function markHere() { const here = el('communicationDialog').open ? openDecisions().filter(d => d.threadId === current).map(d => d.id) : []; el('notificationCenter').querySelectorAll('.toast').forEach(t => t.classList.toggle('toast-here', here.includes(t.dataset.decisionId))); }
  function render() { renderList(); renderThread(); markHere(); }
  // status.now changes on every call; compare only what is drawn so an idle poll never rebuilds the thread.
  function threadKey() {
    const task = current && api.task(data.threads.find(t => t.id === current)?.taskId);
    return JSON.stringify([current, data.messages.filter(m => m.threadId === current).map(m => m.seq), data.decisions.filter(d => d.threadId === current).map(d => [d.id, d.status, d.version, d.target]),
      task && [task.status, task.phase, task.error, task.revisionId, task.evidence?.jobId, task.version], activityKey(activity.get(current))]);
  }
  const activityKey = a => a ? JSON.stringify({items: a.items, typing: a.typing?.text || null, status: {...a.status, now: undefined}}) : '';
  async function loadActivity(id) { const task = data.threads.find(t => t.id === id)?.taskId; if (!task) return; const before = activityKey(activity.get(id)); activity.set(id, await api.call('GET', `/api/tasks/${task}/activity`).catch(() => null));
    if (current !== id) return; if (before !== activityKey(activity.get(id))) renderThread(); else renderStatus(); }
  function select(id, decisionId) {
    current = id; render(); loadActivity(id);
    focusDecision(decisionId);
  }
  function focusDecision(decisionId) {
    const decision=decisionId&&data.decisions.find(d=>d.id===decisionId);
    const target = decision?.kind==='approval' ? document.querySelector('#messageApplicationPanel button') : decisionId ? document.querySelector(`.decision-card[data-decision-id="${decisionId}"] textarea`) : null;
    if (target) { target.scrollIntoView({block: 'center'}); target.focus(); }
  }
  async function open_({taskId, decisionId} = {}) {
    if (!api.unlocked() && !(await api.unlock())) return;
    window.officeNav.open('communicationDialog');
    if (!loaded || taskId) await refresh();
    const thread = taskId && data.threads.find(t => t.taskId === taskId);
    select(thread ? thread.id : current || data.threads[0]?.id || null, decisionId);
  }
  function wire() {
    el('bCommunications').onclick = () => open_();
    el('closeCommunications').onclick = () => window.officeNav.close();
    el('threadBack').onclick = () => { current = null; render(); };
    document.querySelectorAll('#threadFilters [data-filter]').forEach(button => { button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('#threadFilters [data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderList(); }; });
    const composer = el('composerText');
    composer.oninput = () => writeDraft(current, composer.value);
    composer.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el('messageComposer').requestSubmit(); } };
    el('messageComposer').onsubmit = async event => {
      event.preventDefault(); const text = composer.value.trim(); if (!text || !current) return;
      const thread = data.threads.find(t => t.id === current);
      try { const saved = await api.call('POST', `/api/tasks/${thread.taskId}/messages`, {text}); composer.value = ''; writeDraft(current, ''); if (saved.answeredDecision||saved.retried) api.reloadTasks(); el('messengerStatus').textContent = saved.retried ? 'Terkirim. Agen mencoba lagi tugas ini.' : saved.answeredDecision ? 'Jawaban terkirim. Agen melanjutkan tugas.' : saved.pendingForNextStep ? 'Terkirim · dipakai agen di langkah berikutnya.' : 'Terkirim.'; await refresh(); }
      catch (error) { el('messengerStatus').textContent = error.message; api.locked(error); }
    };
    el('notifyOptIn').onclick = async () => { if (!('Notification' in window)) return; const result = await Notification.requestPermission(); el('notifyOptIn').hidden = result !== 'default'; el('messengerStatus').textContent = result === 'granted' ? 'Notifikasi browser aktif.' : 'Notifikasi browser ditolak; notifikasi di aplikasi tetap jalan.'; };
    el('notifyOptIn').hidden = !('Notification' in window) || Notification.permission !== 'default';
    document.addEventListener('visibilitychange', () => { if (!document.hidden && el('communicationDialog').open) renderThread(); });
  }
  window.Messenger = {
    mount(options) { api = options; wire(); refresh(); timer = setInterval(refresh, 2500); setInterval(()=>{if(el('communicationDialog').open&&current&&api.unlocked())loadActivity(current);},500); },
    open: open_, refresh,
    // Returns false when there is nothing to open (offline or no open decision) so the caller can fall back.
    // Locked: unlock first, then jump to the oldest waiting decision. Returns false only when there is no server.
    openDecision(taskId) {
      if (!api.online()) return false;
      (async () => {
        if (!api.unlocked() && !(await api.unlock())) return;
        await refresh();
        const d = openDecisions().filter(x => !taskId || x.taskId === taskId).sort((a, b) => a.openedAt.localeCompare(b.openedAt))[0];
        open_(d ? {taskId: d.taskId, decisionId: d.id} : {taskId});
      })();
      return true;
    },
    // Task events say something changed; the inbox is re-read rather than patched piecemeal.
    update() { refresh(); }
  };
})();
