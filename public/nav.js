(() => {
  const drawers = new Set(['taskDialog', 'settingsDialog', 'orgDialog', 'communicationDialog', 'roomsDialog']);
  const guards = new Map(), listeners = [];
  let active = null;
  const el = id => document.getElementById(id);
  const canClose = id => !guards.has(id) || guards.get(id)();
  function close(id = active) {
    if (!id || !canClose(id)) return false;
    const dialog = el(id);
    if (dialog?.open) dialog.close();
    if (active === id) active = null;
    document.querySelectorAll('#notificationCenter .toast-here').forEach(t => t.classList.remove('toast-here'));
    document.querySelectorAll('#rail [aria-current="page"]').forEach(item => item.removeAttribute('aria-current'));
    return true;
  }
  // Scene surfaces (team search popover, furniture edit mode) are exclusive with every drawer:
  // they live under it in z-order, so opening a drawer or clicking the other tool closes them first.
  function closeSceneSurfaces() {
    const popover = el('teamPopover');
    if (popover && !popover.hidden) popover.hidden = true;
    window.officeScene?.setEditing?.(false);
  }
  function open(id) {
    if (!drawers.has(id)) return false;
    if (active && active !== id && !close(active)) return false;
    const dialog = el(id);
    if (!dialog) return false;
    closeSceneSurfaces();
    dialog.show();
    active = id;
    document.querySelectorAll('#rail [aria-current="page"]').forEach(item => item.removeAttribute('aria-current'));
    document.querySelector(`[data-drawer="${id}"]`)?.setAttribute('aria-current', 'page');
    listeners.forEach(listener => listener(id));
    return true;
  }
  function closeAll() { const closed = !active || close(active); closeSceneSurfaces(); return closed; }
  function guard(id, fn) { guards.set(id, fn); }
  function onOpen(fn) { listeners.push(fn); }
  function wireRail() {
    el('navOffice').onclick = closeAll;
    el('bTasks').onclick = () => open('taskDialog');
    el('bOrg').onclick = () => window.officeTasks?.openOrg?.();
    el('bSettings').onclick = () => window.officeSettings?.open?.() || open('settingsDialog');
    el('bLock').onclick = () => window.officeTasks?.toggleLock?.();
    el('decisions').onclick = () => window.Messenger?.openDecision?.() || window.officeTasks?.open?.(null, 'blocked');
    el('bCustom').onclick = () => { closeAll(); window.officeScene?.setEditing?.(true); };
    el('bTeam').onclick = () => {
      const popover = el('teamPopover');
      if (!popover) return;
      const opening = popover.hidden;
      if (opening) closeAll();
      popover.hidden = !opening;
      if (opening) el('teamSearch')?.focus();
    };
    el('closeOrg').onclick = closeAll;
    document.addEventListener('click', event => {
      const popover = el('teamPopover');
      if (popover && !popover.hidden && !event.target.closest('#teamPopover,#bTeam')) popover.hidden = true;
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // Modal dialogs (wizard, reset) close themselves on Esc; keep drawers and the camera out of it.
    if (el('wizardDialog')?.open || el('resetDialog')?.open) { event.stopPropagation(); return; }
    const pin = el('pinDialog');
    if (pin?.open) {
      window.officeTasks?.cancelUnlock?.();
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (!active) return;
    if (close(active)) { event.preventDefault(); event.stopPropagation(); }
    else { event.preventDefault(); event.stopPropagation(); }
  }, true);
  document.addEventListener('DOMContentLoaded', wireRail);
  window.officeNav = {open, close, closeAll, current: () => active, guard, onOpen};
})();
