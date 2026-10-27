// Task board: one global board with four columns. Cards only select; the detail panel (tasks.js) holds every action.
(() => {
  const COLUMNS = [['queued', 'Tugas'], ['progress', 'Sedang dikerjakan'], ['review', 'Review'], ['done', 'Selesai']];
  const columnOf = status => ({queued: 'queued', active: 'progress', blocked: 'progress', 'manager-review': 'review', review: 'review', done: 'done'})[status] || 'queued';
  let root = null, api = null;
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function badge(task) {
    if (task.status === 'blocked') {
      if(task.blockedReason==='approval')return ['Menunggu izin pengujian','owner'];
      if(task.blockedReason==='failed')return ['Gagal: periksa detail','error'];
      if(task.blockedReason==='interrupted')return ['Terputus: perlu tindakan','owner'];
      return task.blockedReason === 'children' ? ['Menunggu tim', 'wait'] : ['Menunggu jawabanmu', 'owner'];
    }
    if (task.status === 'queued' && task.error) return ['Gagal, coba lagi', 'error'];
    if (task.status === 'manager-review') return ['Menunggu atasan', 'wait'];
    if (task.status === 'review') return ['Perlu review kamu', 'owner'];
    return null;
  }
  function card(task, all, selectedId) {
    const article = node('article', undefined, 'task-card'); article.dataset.taskId = task.id;
    if (task.id === selectedId) article.setAttribute('aria-current', 'true');
    const open = node('button', task.title, 'task-card-open'); open.type = 'button'; open.onclick = () => api.select(task.id);
    article.append(open, node('p', `${api.displayName(task.assignee)} · ${api.divisionName(task.division) || 'Tanpa divisi'}`, 'task-card-meta'));
    const mark = badge(task); if (mark) article.append(node('span', mark[0], `task-badge task-badge-${mark[1]}`));
    if (task.status === 'active' || task.progressPct) article.append(node('span', `${task.progressPct || 0}%`, 'task-card-progress'));
    const kids = all.filter(item => item.parentId === task.id).length;
    if (kids) article.append(node('span', `${kids} subtugas`, 'task-card-kids'));
    if (task.parentId) {
      const parent = all.find(item => item.id === task.parentId);
      const link = node('button', `↳ ${parent ? parent.title : 'Tugas induk'}`, 'task-root-link'); link.type = 'button';
      link.disabled = !parent; link.onclick = () => api.select(parent.id);
      article.append(link);
    }
    return article;
  }
  // `visible` is already filtered; `all` resolves parent titles and child counts.
  function update({visible, all, selectedId}) {
    if (!root) return;
    // A poll or selection rebuild repaints every card; keep the keyboard on the same card.
    const active = document.activeElement;
    const focusTask = active && root.contains(active) ? active.closest('[data-task-id]')?.dataset.taskId : null;
    const focusClass = active && active.classList?.contains('task-root-link') ? 'task-root-link' : 'task-card-open';
    const scroll = root.scrollLeft;
    root.replaceChildren(...COLUMNS.map(([id, label]) => {
      const list = visible.filter(task => columnOf(task.status) === id);
      const column = node('section', undefined, 'task-column'); column.dataset.column = id;
      const heading = node('h3', label); heading.append(node('span', String(list.length), 'task-column-count'));
      column.append(heading);
      if (!list.length) column.append(node('p', 'Kosong', 'task-column-empty'));
      list.forEach(task => column.append(card(task, all, selectedId)));
      return column;
    }));
    root.scrollLeft = scroll;
    if (focusTask) root.querySelector(`[data-task-id="${CSS.escape(focusTask)}"] .${focusClass}`)?.focus({preventScroll: true});
  }
  window.TaskWorkspace = {mount(container, options) { root = container; api = options; }, update, columnOf};
})();
