// Pure room logic: no fs, no http. server.js owns all I/O.
// A room is a template-typed rectangle on a floor; built-in rooms mirror the 3D office
// geometry and can only be renamed. Custom rooms carry catalog furniture placed by the client.

const TYPES = {
  meeting: {label: 'Meeting room', capacity: 6, w: 6, d: 5},
  focus: {label: 'Focus room', capacity: 1, w: 3, d: 3},
  lounge: {label: 'Lounge', capacity: 4, w: 5, d: 4},
  pantry: {label: 'Pantry corner', capacity: 3, w: 4, d: 3},
  musholla: {label: 'Prayer room', capacity: 8, w: 5, d: 3.5},
  custom: {label: 'Custom room', capacity: 4, w: 5, d: 4},
};
const FURNITURE = new Set(['table', 'chair', 'sofa', 'board', 'plant']);
// The 3D scene builds at most eight seats per room; the API and the drawer use the same ceiling.
const MAX_CAPACITY = 8;
// Floor slab is 32x25; keep rooms clear of the walls and the stair core on the left.
const BOUNDS = {x: 15.9, z: 11.5};

// Read-only mirrors of the rooms hardcoded in office.js. Seats and geometry stay in the
// scene; these entries only feed the list, renaming and the room API surface.
const SEED = [
  {id: 'seed-meeting', builtIn: true, name: 'Meeting Room', floor: 3, type: 'meeting', x: -12.9, z: -9.25, w: 5.9, d: 5.3, capacity: 6, furniture: []},
  {id: 'seed-pantry', builtIn: true, name: 'Pantry & Lounge', floor: 3, type: 'pantry', x: 12.5, z: -8.1, w: 5.2, d: 7.8, capacity: 4, furniture: []},
  {id: 'seed-musholla', builtIn: true, name: 'Prayer Room', floor: 3, type: 'musholla', x: 13.3, z: 10.15, w: 5.3, d: 3.3, capacity: 8, furniture: []},
  {id: 'seed-booth-1', builtIn: true, name: 'Phone Booth 1', floor: 3, type: 'focus', x: -14.6, z: 10.5, w: 1.9, d: 1.9, capacity: 1, furniture: []},
  {id: 'seed-booth-2', builtIn: true, name: 'Phone Booth 2', floor: 3, type: 'focus', x: -12.4, z: 10.5, w: 1.9, d: 1.9, capacity: 1, furniture: []},
];

const id = () => 'room-' + Math.random().toString(36).slice(2, 8);
const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : NaN;

// isNew=true (POST): name/floor/type required. false (PATCH): only present fields validated.
// Failure returns {ok:false, error, code} where 'dup'/'overlap' mean 409, else 400.
function validateRoom(input, rooms, selfId) {
  if (!input || typeof input !== 'object') return {ok: false, error: 'Expected an object.', code: 'bad'};
  const out = {};
  const get = k => input[k] === undefined ? undefined : input[k];
  if (get('name') !== undefined || selfId === null) {
    const name = typeof get('name') === 'string' ? get('name').trim() : '';
    if (!name || name.length > 80) return {ok: false, error: 'Name must be 1-80 characters.', code: 'bad'};
    if (rooms.some(r => r.name.toLowerCase() === name.toLowerCase() && r.id !== selfId)) return {ok: false, error: 'That room name is already used.', code: 'dup'};
    out.name = name;
  }
  if (get('type') !== undefined || selfId === null) {
    const type = String(get('type') ?? '');
    if (!TYPES[type]) return {ok: false, error: 'Pick a room type from the list.', code: 'bad'};
    out.type = type;
  }
  if (get('floor') !== undefined || selfId === null) {
    const floor = num(get('floor'));
    if (!Number.isInteger(floor) || floor < 1 || floor > 12) return {ok: false, error: 'Pick a floor that exists in the building.', code: 'bad'};
    out.floor = floor;
  }
  // An owned room is the private room of one member; the scene only lets that member use its seats.
  if (get('owner') !== undefined) {
    const owner = typeof get('owner') === 'string' ? get('owner').trim() : '';
    if (owner.length > 120) return {ok: false, error: 'Owner name is too long.', code: 'bad'};
    out.owner = owner || null;
  }
  if (get('capacity') !== undefined) {
    const capacity = num(get('capacity'));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) return {ok: false, error: `Capacity must be 1-${MAX_CAPACITY}.`, code: 'bad'};
    out.capacity = capacity;
  } else if (selfId === null) out.capacity = TYPES[out.type ?? 'custom'].capacity;
  // Size and position come from the template unless given; a type change re-templates them.
  // Merge with the stored room (if any) so PATCH validates the resulting placement.
  const self = rooms.find(r => r.id === selfId);
  const retemplate = selfId === null || out.type !== undefined;
  const w = get('w') !== undefined ? num(get('w')) : retemplate ? TYPES[out.type ?? 'custom'].w : self.w;
  const d = get('d') !== undefined ? num(get('d')) : retemplate ? TYPES[out.type ?? 'custom'].d : self.d;
  if (!(w >= 2 && w <= 12) || !(d >= 2 && d <= 12)) return {ok: false, error: 'Width and depth must be 2-12.', code: 'bad'};
  out.w = w; out.d = d;
  if (get('x') !== undefined) out.x = num(get('x'));
  if (get('z') !== undefined) out.z = num(get('z'));
  const base = self ? {...self, ...out} : {floor: out.floor, x: out.x ?? 0, z: out.z ?? 0, w, d};
  if (!Number.isFinite(base.x) || !Number.isFinite(base.z)) return {ok: false, error: 'Pick a position on the floor plan.', code: 'bad'};
  if (Math.abs(base.x) + base.w / 2 > BOUNDS.x || Math.abs(base.z) + base.d / 2 > BOUNDS.z) return {ok: false, error: 'The room must stay inside the floor.', code: 'bad'};
  // Rooms may not overlap each other; the stair side of floor 3 stays clear of the passage.
  for (const other of rooms) {
    if (other.id === selfId) continue;
    if (other.floor !== base.floor) continue;
    if (Math.abs(base.x - other.x) * 2 < base.w + other.w - .4 && Math.abs(base.z - other.z) * 2 < base.d + other.d - .4)
      return {ok: false, error: `That place overlaps ${other.name}.`, code: 'overlap'};
  }
  if (get('furniture') !== undefined) {
    if (!Array.isArray(get('furniture')) || get('furniture').length > 40) return {ok: false, error: 'Furniture list is too long.', code: 'bad'};
    out.furniture = [];
    for (const item of get('furniture')) {
      const kind = String(item?.kind ?? ''), fx = num(item?.x), fz = num(item?.z);
      if (!FURNITURE.has(kind) || !Number.isFinite(fx) || !Number.isFinite(fz)) return {ok: false, error: 'Furniture needs a kind from the catalog and a position.', code: 'bad'};
      if (Math.abs(fx) > base.w / 2 || Math.abs(fz) > base.d / 2) return {ok: false, error: 'Furniture must stay inside the room.', code: 'bad'};
      out.furniture.push({kind, x: Math.round(fx * 2) / 2, z: Math.round(fz * 2) / 2});
    }
  }
  return {ok: true, room: out};
}

module.exports = {SEED, TYPES, FURNITURE: [...FURNITURE], MAX_CAPACITY, validateRoom};
