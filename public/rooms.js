// Custom rooms (port dari orchestrator-patterns, diadaptasi ke v2): list, template form,
// a 2D floor plan with drag + furniture, and live rebuild of the 3D office without a reload.
// Writes need the owner unlock token, the same as the organization editor.
(() => {
  const el = id => document.getElementById(id);
  const ROOM_TYPES = {
    meeting: {label: 'Ruang rapat', capacity: 6, w: 6, d: 5},
    focus: {label: 'Ruang fokus', capacity: 1, w: 3, d: 3},
    lounge: {label: 'Lounge', capacity: 4, w: 5, d: 4},
    pantry: {label: 'Pojok pantry', capacity: 3, w: 4, d: 3},
    musholla: {label: 'Ruang salat', capacity: 8, w: 5, d: 3.5},
    custom: {label: 'Ruang bebas', capacity: 4, w: 5, d: 4},
  };
  const ROOM_KINDS = ['table', 'chair', 'sofa', 'board', 'plant'];
  const PLAN = {w: 360, h: 272, scale: 10}; // the 32x24 floor slab, 10px per metre
  let roomsList = [], editingRoom = null, planRoom = null, planDrag = null, csrf = '', stamp = '', members = [];

  const message = text => { el('roomsMessage').textContent = text || ''; };
  const memberNames = () => members.map(m => m.name);
  async function loadMembers() {
    if (memberNames().length) return;
    try { const org = await call('GET', '/api/org'); members = (org.members || []).filter(m => m.active !== false); } catch {/* rooms list still works without names */}
  }
  async function call(method, path, body) {
    const token = sessionStorage.getItem('kantor-ai.orgToken') || '';
    const response = await fetch(path, {method, headers: {'content-type': 'application/json', origin: location.origin, 'x-kantor-csrf': csrf, ...(token ? {'x-kantor-org': token} : {})}, body: body && JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Server error ${response.status}`), {code: data.code, status: response.status});
    return data;
  }

  async function refresh(quiet) {
    try {
      const list = await call('GET', '/api/rooms');
      if (!Array.isArray(list)) return;
      const next = JSON.stringify(list);
      if (next === stamp) return;
      stamp = next; roomsList = list;
      window.officeScene?.applyRooms?.(list);
      renderRooms();
      if (planRoom) drawPlan();
      if (!quiet) message('');
    } catch {/* static host or server gone: keep the last known rooms */}
  }

  function floorOptions() {
    const roles = window.officeScene?.floorRoles?.() || [];
    return roles.map(role => ({value: String(role.level), label: `L${String(role.number).padStart(2, '0')} · ${role.name}`}));
  }

  function renderRooms() {
    const list = el('roomsList'); if (!list) return;
    list.replaceChildren();
    for (const room of roomsList) {
      const row = document.createElement('div'); row.className = 'room-row';
      const strong = document.createElement('strong'); strong.textContent = room.name;
      const meta = document.createElement('span'); meta.className = 'task-meta';
      meta.textContent = `L${String(room.floor).padStart(2, '0')} · ${ROOM_TYPES[room.type]?.label || room.type} · ${room.capacity} kursi${room.owner ? ` · milik ${room.owner}` : ''}${room.builtIn ? ' · bawaan' : ''}`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Ubah'; edit.onclick = () => openRoomForm(room);
      row.append(strong, meta, edit);
      if (!room.builtIn) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Hapus';
        remove.onclick = () => deleteRoom(room); row.append(remove);
      }
      list.append(row);
    }
    if (!roomsList.length) { const empty = document.createElement('p'); empty.className = 'task-empty'; empty.textContent = 'Belum ada ruangan selain kantor bawaan.'; list.append(empty); }
  }

  function openRoomForm(room) {
    editingRoom = room?.id || null;
    const locked = !!room?.builtIn; // built-in rooms are part of the office: rename only
    el('roomName').value = room?.name || '';
    el('roomFloor').replaceChildren(...floorOptions().map(({value, label}) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
    if (![...el('roomFloor').options].some(option => option.value === String(room?.floor ?? 3))) {
      const fallback = document.createElement('option'); fallback.value = String(room?.floor ?? 3); fallback.textContent = `L${String(room?.floor ?? 3).padStart(2, '0')}`; el('roomFloor').append(fallback);
    }
    el('roomFloor').value = String(room?.floor ?? 3);
    el('roomType').replaceChildren(...Object.entries(ROOM_TYPES).map(([value, meta]) => { const option = document.createElement('option'); option.value = value; option.textContent = meta.label; return option; }));
    el('roomType').value = room?.type || 'lounge';
    el('roomKind').replaceChildren(...ROOM_KINDS.map(kind => { const option = document.createElement('option'); option.value = kind; option.textContent = kind; return option; }));
    el('roomFloor').disabled = locked; el('roomType').disabled = locked; el('roomCapacity').disabled = locked;
    el('roomCapacity').value = room?.capacity ?? ROOM_TYPES.lounge.capacity;
    // Private rooms: seats belong to one member; everyone else cannot pick them.
    el('roomOwner').replaceChildren(...['', ...memberNames()].map(name => { const option = document.createElement('option'); option.value = name; option.textContent = name || 'Publik (siapa saja)'; return option; }));
    el('roomOwner').value = room?.owner || '';
    el('roomOwner').disabled = locked;
    loadMembers().then(() => { if (!el('roomForm').hidden) { el('roomOwner').replaceChildren(...['', ...memberNames()].map(name => { const option = document.createElement('option'); option.value = name; option.textContent = name || 'Publik (siapa saja)'; return option; })); el('roomOwner').value = room?.owner || ''; } });
    const template = ROOM_TYPES[room?.type || 'lounge'];
    planRoom = room
      ? {x: room.x, z: room.z, w: room.w, d: room.d, furniture: (room.furniture || []).map(item => ({...item}))}
      : {x: 0, z: 0, w: template.w, d: template.d, furniture: []};
    el('roomForm').hidden = false;
    drawPlan(); renderFurnitureList();
    el('roomName').focus();
  }

  const planToCanvas = (x, z) => [PLAN.w / 2 + x * PLAN.scale, PLAN.h / 2 + z * PLAN.scale];
  const canvasToPlan = (px, py) => [Math.round(((px - PLAN.w / 2) / PLAN.scale) * 2) / 2, Math.round(((py - PLAN.h / 2) / PLAN.scale) * 2) / 2];

  function drawPlan() {
    const canvas = el('roomPlan'); if (!canvas || !planRoom) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, PLAN.w, PLAN.h);
    ctx.fillStyle = '#f7f3ed'; ctx.fillRect(0, 0, PLAN.w, PLAN.h);
    ctx.strokeStyle = '#b4ae9f'; ctx.lineWidth = 2;
    ctx.strokeRect(...planToCanvas(-16, -12), 32 * PLAN.scale, 24 * PLAN.scale);
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    for (const room of roomsList) {
      if (room.floor !== Number(el('roomFloor').value)) continue;
      const [cx, cy] = planToCanvas(room.x - room.w / 2, room.z - room.d / 2);
      const mine = room.id === editingRoom;
      ctx.fillStyle = mine ? 'rgba(30,34,48,.1)' : 'rgba(30,34,48,.04)';
      ctx.fillRect(cx, cy, room.w * PLAN.scale, room.d * PLAN.scale);
      ctx.strokeStyle = mine ? '#1e2230' : '#b4ae9f';
      ctx.strokeRect(cx, cy, room.w * PLAN.scale, room.d * PLAN.scale);
      ctx.fillStyle = '#6b6f7b'; ctx.fillText(room.name.slice(0, 16), cx + 4, cy + 12);
    }
    const [cx, cy] = planToCanvas(planRoom.x - planRoom.w / 2, planRoom.z - planRoom.d / 2);
    ctx.fillStyle = 'rgba(232,99,74,.14)';
    ctx.fillRect(cx, cy, planRoom.w * PLAN.scale, planRoom.d * PLAN.scale);
    ctx.strokeStyle = '#e8634a'; ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, planRoom.w * PLAN.scale, planRoom.d * PLAN.scale);
    ctx.fillStyle = '#1e2230';
    for (const item of planRoom.furniture) { const [ix, iy] = planToCanvas(item.x, item.z); ctx.fillRect(ix - 3, iy - 3, 6, 6); }
  }

  function renderFurnitureList() {
    const list = el('roomFurniture'); if (!list) return;
    list.replaceChildren();
    if (!planRoom?.furniture.length) { const empty = document.createElement('span'); empty.className = 'settings-note'; empty.textContent = 'Belum ada furnitur.'; list.append(empty); return; }
    planRoom.furniture.forEach((item, index) => {
      const chip = document.createElement('span'); chip.className = 'furnish-chip'; chip.textContent = `${item.kind} (${item.x}, ${item.z}) `;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'furnish-remove'; remove.setAttribute('aria-label', `Hapus ${item.kind}`); remove.textContent = '×';
      remove.onclick = () => { planRoom.furniture.splice(index, 1); renderFurnitureList(); drawPlan(); };
      chip.append(remove); list.append(chip);
    });
  }

  function bindPlanCanvas(canvas) {
    // Drag moves the room; a plain click inside it places the selected furniture piece.
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height)];
    };
    canvas.addEventListener('pointerdown', event => {
      if (!planRoom || el('roomForm').hidden || el('roomType').disabled) return;
      const [x, z] = canvasToPlan(...point(event));
      planDrag = {moved: false, offX: planRoom.x - x, offZ: planRoom.z - z};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!planDrag || !planRoom) return;
      const [x, z] = canvasToPlan(...point(event));
      const nx = Math.max(-15 + planRoom.w / 2, Math.min(15 - planRoom.w / 2, x + planDrag.offX));
      const nz = Math.max(-11.5 + planRoom.d / 2, Math.min(11.5 - planRoom.d / 2, z + planDrag.offZ));
      if (nx !== planRoom.x || nz !== planRoom.z) { planRoom.x = nx; planRoom.z = nz; planDrag.moved = true; drawPlan(); }
    });
    canvas.addEventListener('pointerup', event => {
      if (!planDrag || !planRoom) { planDrag = null; return; }
      const moved = planDrag.moved; planDrag = null;
      if (moved) return;
      const [x, z] = canvasToPlan(...point(event));
      if (Math.abs(x - planRoom.x) > planRoom.w / 2 || Math.abs(z - planRoom.z) > planRoom.d / 2) return;
      if (planRoom.furniture.length >= 40) { message('Daftar furnitur sudah penuh.'); return; }
      planRoom.furniture.push({kind: el('roomKind').value, x, z});
      renderFurnitureList(); drawPlan();
    });
  }

  async function saveRoom(event) {
    event.preventDefault();
    const locked = el('roomType').disabled;
    const body = locked
      ? {name: el('roomName').value.trim()}
      : {name: el('roomName').value.trim(), floor: Number(el('roomFloor').value), type: el('roomType').value,
         capacity: Number(el('roomCapacity').value) || 1, owner: el('roomOwner').value || null,
         x: planRoom.x, z: planRoom.z, w: planRoom.w, d: planRoom.d, furniture: planRoom.furniture};
    try {
      const saved = editingRoom ? await call('PATCH', `/api/rooms/${encodeURIComponent(editingRoom)}`, body) : await call('POST', '/api/rooms', body);
      message(`${saved.name} tersimpan dan kantor 3D diperbarui.`);
      el('roomForm').hidden = true; planRoom = null;
      stamp = ''; await refresh(true);
    } catch (error) {
      message(error.status === 403 ? 'Buka kunci organisasi dulu (tombol Kunci), lalu ubah ruangan.' : error.message);
    }
  }

  async function deleteRoom(room) {
    const occupants = window.officeScene?.roomOccupancy?.()?.[room.id] || 0;
    if (occupants > 0) { message(`Ada ${occupants} orang di ${room.name}. Suruh kembali kerja dulu.`); return; }
    if (!confirm(`Hapus ${room.name} dari kantor?`)) return;
    try {
      await call('DELETE', `/api/rooms/${encodeURIComponent(room.id)}?occupants=${occupants}`);
      message(`${room.name} dihapus dan kantor 3D diperbarui.`);
      el('roomForm').hidden = true; planRoom = null;
      stamp = ''; await refresh(true);
    } catch (error) {
      message(error.status === 403 ? 'Buka kunci organisasi dulu (tombol Kunci), lalu hapus ruangan.' : error.message);
    }
  }

  function start() {
    if (!el('roomsDialog')) return;
    el('bRooms').hidden = false;
    el('bRooms').onclick = () => { if (window.officeNav?.open?.('roomsDialog') !== true) el('roomsDialog').showModal(); refresh(true); };
    el('roomsClose').onclick = () => el('roomsDialog').close();
    el('addRoom').onclick = () => openRoomForm(null);
    el('roomForm').onsubmit = saveRoom;
    el('roomCancel').onclick = () => { el('roomForm').hidden = true; planRoom = null; };
    el('roomType').onchange = () => { const meta = ROOM_TYPES[el('roomType').value]; planRoom.w = meta.w; planRoom.d = meta.d; el('roomCapacity').value = meta.capacity; drawPlan(); };
    el('roomFloor').onchange = drawPlan;
    bindPlanCanvas(el('roomPlan'));
    (async () => { try { csrf = (await (await fetch('/api/session')).json()).csrf; } catch {} })();
    refresh(true);
    // Cross-tab updates: rooms are small, so a light poll keeps every open office in sync.
    setInterval(() => { if (!document.hidden) refresh(true); }, 10000);
  }

  window.officeRooms = {start, refresh};
})();
