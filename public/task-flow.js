// Flow graph and console for the task workspace. Both are built only from stored events and real tasks:
// a route the organisation allows but nobody used is never drawn, and progress is counted, never estimated.
(() => {
  const SVG = 'http://www.w3.org/2000/svg', NODE_W = 220, NODE_H = 76, GAP_X = 48, GAP_Y = 96, MAX_ROWS = 200;
  const EDGE = {'delegation.created': 'delegation', 'result.submitted': 'result', 'decision.opened': 'question', 'decision.answered': 'answer'};
  const LABEL = {delegation: 'delegasi', result: 'hasil', question: 'pertanyaan', answer: 'jawaban'};
  const STATUS = {queued: 'Antre', active: 'Berjalan', blocked: 'Menunggu', 'manager-review': 'Review atasan', review: 'Review', done: 'Selesai'};
  let api = null, view = {zoom: 1, x: 0, y: 0}, fittedRoot = null, consoleState = {paused: false, shown: 0};
  const el = id => document.getElementById(id);
  function node(tag, text, className) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; }
  const rootOf = (tasks, task) => { let cursor = task, guard = 0; while (cursor?.parentId && guard++ < 20) { const parent = tasks.find(t => t.id === cursor.parentId); if (!parent) break; cursor = parent; } return cursor; };

  // Tree layout: each subtree gets the width of its leaves, parents centre over their children.
  function layout(tasks, root) {
    const kids = id => tasks.filter(t => t.parentId === id), pos = new Map();
    let column = 0;
    (function place(task, depth) {
      const children = kids(task.id);
      if (!children.length) { pos.set(task.id, {x: column++ * (NODE_W + GAP_X), y: depth * (NODE_H + GAP_Y)}); return; }
      children.forEach(child => place(child, depth + 1));
      const xs = children.map(child => pos.get(child.id).x);
      pos.set(task.id, {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth * (NODE_H + GAP_Y)});
    })(root, 1);
    const top = pos.get(root.id);
    pos.set('owner', {x: top.x, y: 0});
    return pos;
  }
  function renderFlow() {
    const box = el('taskFlow'), tasks = api.tasks(), events = api.events();
    const roots = tasks.filter(t => !t.parentId);
    const select = el('flowRoot'), selected = tasks.find(t => t.id === api.selectedId());
    const wanted = (selected && rootOf(tasks, selected)?.id) || select.value || roots[0]?.id;
    select.replaceChildren(...roots.map(r => { const option = node('option', r.title); option.value = r.id; return option; }));
    const canvas = box.querySelector('.flow-canvas'), rejected = box.querySelector('.flow-rejected');
    canvas.replaceChildren(); rejected.replaceChildren();
    if (!roots.length) { canvas.append(node('p', 'Belum ada tugas untuk digambar.', 'task-column-empty')); return; }
    select.value = roots.some(r => r.id === wanted) ? wanted : roots[0].id;
    const root = tasks.find(t => t.id === select.value), inTree = new Set(), walk = id => { inTree.add(id); tasks.filter(t => t.parentId === id).forEach(t => walk(t.id)); };
    walk(root.id);
    const pos = layout(tasks, root), width = Math.max(...[...pos.values()].map(p => p.x)) + NODE_W, height = Math.max(...[...pos.values()].map(p => p.y)) + NODE_H;
    // A newly chosen root starts fitted to the visible area (zoom never above 1), top-centred on the owner.
    if (fittedRoot !== root.id) { fittedRoot = root.id; const area = box.getBoundingClientRect(); if (area.width) { view.zoom = Math.max(0.4, Math.min(1, (area.width - 48) / width, (area.height - 48) / height)); view.x = Math.max(0, (area.width - 48 - width * view.zoom) / 2); view.y = 0; } }
    canvas.style.cssText = `width:${width}px;height:${height}px;transform:translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('width', width); svg.setAttribute('height', height); svg.classList.add('flow-lines');
    canvas.append(svg);
    // Owner node: the root's result goes there, and decisions addressed to the owner come from there.
    const owner = node('div', undefined, 'flow-node flow-node-owner'); owner.style.cssText = `left:${pos.get('owner').x}px;top:0`; owner.append(node('strong', 'Owner'), node('span', 'kamu'));
    canvas.append(owner);
    for (const id of inTree) {
      const task = tasks.find(t => t.id === id), p = pos.get(id), kids = tasks.filter(t => t.parentId === id);
      const card = node('button', undefined, `flow-node flow-status-${task.status}`); card.type = 'button'; card.dataset.taskId = id; card.style.cssText = `left:${p.x}px;top:${p.y}px`;
      card.append(node('strong', task.title), node('span', `${api.displayName(task.assignee)} · ${STATUS[task.status] || task.status}`));
      if (kids.length) card.append(node('span', `${kids.filter(k => k.status === 'done').length}/${kids.length} subtugas selesai`, 'flow-count'));
      if (task.dependencyIds?.length) card.append(node('span', `menunggu ${task.dependencyIds.map(d => tasks.find(t => t.id === d)?.title || '?').join(', ')}`, 'flow-count'));
      card.onclick = () => api.select(id, 'board');
      canvas.append(card);
    }
    // Edges: one per stored event. Delegation parent→child, result child→parent (root→owner), questions/answers task↔who was asked.
    const anchor = id => { const p = pos.get(id); return p && {x: p.x + NODE_W / 2, top: p.y, bottom: p.y + NODE_H}; };
    const lanes = new Map();
    for (const event of events) {
      const kind = EDGE[event.type];
      if (!kind || !inTree.has(event.taskId)) continue;
      const task = tasks.find(t => t.id === event.taskId);
      const parentEnd = task.parentId && inTree.has(task.parentId) ? task.parentId : 'owner';
      const [from, to] = kind === 'delegation' ? [task.parentId, task.id] : kind === 'result' ? [task.id, parentEnd] : kind === 'question' ? [task.id, parentEnd] : [parentEnd, task.id];
      const a = anchor(from), b = anchor(to); if (!a || !b) continue;
      // Each edge gets its own lane beside the child's vertical segment, so labels of a pair never stack.
      const child = kind === 'delegation' || kind === 'answer' ? to : from, lane = lanes.get(child) || 0; lanes.set(child, lane + 1);
      const offset = (lane - 1.5) * 26;
      const down = a.top < b.top, y1 = down ? a.bottom : a.top, y2 = down ? b.top : b.bottom;
      const mid = (y1 + y2) / 2, x1 = a.x + (from === child ? offset : 0), x2 = b.x + (to === child ? offset : 0);
      const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', `M${x1} ${y1} V${mid} H${x2} V${y2}`); path.classList.add('flow-edge', `flow-edge-${kind}`);
      Object.assign(path.dataset, {kind, eventSeq: String(event.seq), taskId: event.taskId}); svg.append(path);
      const label = node('button', LABEL[kind], `flow-edge-label flow-edge-label-${kind}`); label.type = 'button';
      Object.assign(label.dataset, {kind, eventSeq: String(event.seq), taskId: event.taskId});
      // Label on the child's vertical segment: unique per lane, never on the shared horizontal run.
      const lx = from === child ? x1 : x2, ly = from === child ? (y1 + mid) / 2 : (mid + y2) / 2;
      label.style.cssText = `left:${lx}px;top:${ly}px`;
      label.onclick = () => (kind === 'question' && event.data?.decisionId && window.Messenger?.open({taskId: task.id, decisionId: event.data.decisionId})) || inspect(event, task);
      canvas.append(label);
    }
    const denied = events.filter(e => e.type === 'delegation.rejected' && inTree.has(e.taskId));
    if (denied.length) { rejected.append(node('strong', 'Tidak bisa didelegasikan (jalur organisasi): ')); denied.forEach(e => rejected.append(node('span', `${e.to} — ${e.data?.title || ''}`, 'flow-rejected-item'))); }
  }
  // Edge → the message that carried it (delegation brief, result, question, answer).
  async function inspect(event, task) {
    const panel = el('flowInspector'); panel.hidden = false;
    panel.replaceChildren(node('h4', `${LABEL[EDGE[event.type]]} · ${task.title}`), node('p', new Date(event.at).toLocaleString('id-ID'), 'task-meta'));
    const thread = await api.thread(task.id).catch(() => null);
    const kind = EDGE[event.type], wanted = {delegation: 'delegation', result: 'result', question: 'decision'}[kind];
    const decisionId = event.data?.decisionId;
    const message = thread?.messages.find(m => decisionId ? m.decisionId === decisionId && (kind === 'question' ? m.kind === 'decision' : m.sender.type === 'owner') : m.kind === wanted) || null;
    panel.append(node('div', message ? `${message.sender.name}: ${message.text}` : (kind === 'result' ? task.result || task.resultExcerpt || 'Hasil tidak tersimpan sebagai pesan.' : 'Pesan sumber tidak ditemukan.'), 'task-result'));
  }

  // Console: newest at the bottom, at most 200 rows rendered; pause freezes the view while events keep arriving.
  function consoleRows() {
    const agent = el('consoleAgent').value, run = el('consoleRun').value, task = el('consoleTask').value;
    return api.events().filter(e => (agent === 'all' || e.agent === agent || e.from === agent) && (run === 'all' || e.runId === run) && (task === 'all' || e.taskId === task || e.rootId === task));
  }
  function describe(event, tasks) {
    const title = tasks.find(t => t.id === event.taskId)?.title || '';
    const d = event.data || {};
    const detail = event.type === 'task.phase' ? `${d.from} → ${d.to}` : event.type.startsWith('model.') ? [d.purpose, d.providerId, d.modelId, d.error].filter(Boolean).join(' · ')
      : event.from ? `${event.from} → ${event.to}${d.title ? ` · ${d.title}` : ''}${d.reason ? ` · ${d.reason}` : ''}` : d.kind ? `${d.kind}` : '';
    return {title, detail};
  }
  function syncSelect(select, values) {
    const current = select.value, key = values.map(v => v[0]).join('|');
    if (select.dataset.key !== key) { select.dataset.key = key; select.replaceChildren(...[['all', select.dataset.all], ...values].map(([value, label]) => { const option = node('option', label); option.value = value; return option; })); }
    select.value = [...select.options].some(o => o.value === current) ? current : 'all';
  }
  function renderConsole() {
    const events = api.events(), tasks = api.tasks();
    syncSelect(el('consoleAgent'), [...new Set(events.map(e => e.agent || e.from).filter(Boolean))].sort().map(a => [a, a]));
    syncSelect(el('consoleRun'), [...new Set(events.map(e => e.runId).filter(Boolean))].map(r => [r, `${r.slice(0, 8)} · ${tasks.find(t => t.id === events.find(e => e.runId === r)?.taskId)?.title || ''}`]));
    syncSelect(el('consoleTask'), tasks.filter(t => !t.parentId).map(t => [t.id, t.title]));
    const rows = consoleRows();
    if (consoleState.paused) { el('consoleNew').textContent = rows.length > consoleState.shown ? `${rows.length - consoleState.shown} baru` : ''; return; }
    consoleState.shown = rows.length; el('consoleNew').textContent = '';
    const list = el('taskConsole'), stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    list.replaceChildren(...rows.slice(-MAX_ROWS).map(event => {
      const {title, detail} = describe(event, tasks), row = node('div', undefined, `console-row console-${event.type.split('.')[0]}${/failed|rejected/.test(event.type) ? ' console-error' : ''}`);
      row.dataset.runId = event.runId || '';
      row.append(node('time', new Date(event.at).toLocaleTimeString('id-ID')), node('span', event.type, 'console-type'), node('span', event.agent || event.from || 'sistem', 'console-agent'), node('span', title, 'console-task'), node('span', detail, 'console-detail'));
      return row;
    }));
    if (rows.length > MAX_ROWS) list.prepend(node('p', `${rows.length - MAX_ROWS} event lebih lama disembunyikan; unduh log untuk semuanya.`, 'task-column-empty'));
    if (stick) list.scrollTop = list.scrollHeight;
  }
  function exportConsole() {
    const tasks = api.tasks(), lines = consoleRows().map(e => { const {title, detail} = describe(e, tasks); return [e.at, e.seq, e.type, e.agent || e.from || 'sistem', e.runId || '', title, detail].join('\t'); });
    const url = URL.createObjectURL(new Blob([['waktu\tseq\ttipe\tagen\trun\ttugas\tdetail', ...lines].join('\n')], {type: 'text/plain'}));
    const link = node('a'); link.href = url; link.download = 'kantor-console.tsv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function zoom(by) { view.zoom = Math.min(2, Math.max(0.4, view.zoom * by)); renderFlow(); }
  function wire() {
    el('flowRoot').onchange = () => { api.select(el('flowRoot').value); };
    el('flowZoomIn').onclick = () => zoom(1.2); el('flowZoomOut').onclick = () => zoom(1 / 1.2); el('flowReset').onclick = () => { fittedRoot = null; renderFlow(); };
    const box = el('taskFlow'); let drag = null;
    box.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; e.preventDefault(); drag = {x: e.clientX - view.x, y: e.clientY - view.y}; box.setPointerCapture(e.pointerId); });
    box.addEventListener('pointermove', e => { if (!drag) return; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; box.querySelector('.flow-canvas').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`; });
    box.addEventListener('pointerup', () => { drag = null; });
    ['consoleAgent', 'consoleRun', 'consoleTask'].forEach(id => { el(id).onchange = renderConsole; });
    el('consolePause').onclick = () => { consoleState.paused = !consoleState.paused; el('consolePause').textContent = consoleState.paused ? 'Lanjutkan' : 'Jeda'; el('consolePause').setAttribute('aria-pressed', String(consoleState.paused)); renderConsole(); };
    el('consoleExport').onclick = exportConsole;
  }
  window.TaskFlow = {mount(options) { api = options; wire(); }, renderFlow, renderConsole};
})();
