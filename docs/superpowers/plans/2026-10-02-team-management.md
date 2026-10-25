# Team Management + Model Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kelola tim (rename/tambah/hapus via UI, hapus wajib reassign) dengan `data/team.json` sebagai canonical, dropdown model dari router per AI member, dan kursi 3D dinamis + waiting bench.

**Architecture:** `server/team.js` baru berisi pure functions (validasi + cascade, tanpa I/O) agar bisa di-unit-test langsung. `server/server.js` tetap pemilik I/O: load/save atomik, route CRUD, worker baca config AI efektif dari team. Frontend: tab Team di dialog Tasks, roster tunggal dari `/api/team`, 3D rebuild via reload. `server/agents.js` menyusut jadi seed default.

**Tech Stack:** Node 22+ (no deps, stdlib only), vanilla JS frontend, existing `.cjs` test scripts run with `node <file>`.

**Spec:** `docs/superpowers/specs/2026-10-02-team-management-design.md`

## Global Constraints

- Single-user lokal, tanpa login, server hanya listen 127.0.0.1.
- `data/team.json` canonical; tulis atomik (tmp + rename) seperti `tasks.json`.
- Mode dry-run tanpa key tetap jalan.
- Tanpa auth/roles di plan ini.
- Rename cascade atomik: `tasks.json` (assignee), kunci agen; history `by` label tidak diubah.
- Hapus: tolak 409 bila ada tugas non-done tanpa `reassignTo`; bila ada: pindah semua tugas non-done, active jadi queued, `runId` null, `version`+1.
- Anak ke-5+ per grup ke waiting bench (bangku + laptop, pose `sit` existing); tanpa avatar berdiri idle, tanpa kursi tumpang tindih.
- Node >= 22 (`process.loadEnvFile`, `structuredClone` sudah dipakai).

## Review Focus

- Nama duplikat beda case (`kak rani` vs `Kak Rani`) → harus 409, bukan dua avatar satu nama.
- Rename ke nama yang sudah ada → 409, tasks tidak berubah sama sekali.
- Hapus anggota yang task-nya sedang `active` dikerjakan worker → `runId` guard buang hasil telat, tugas pindah sebagai queued.
- `data/team.json` korup saat boot → server refuse start dengan pesan jelas (seperti `tasks.json`), bukan fallback diam-diam.
- Nama berisi HTML/JS (`<img onerror>`) → render via `textContent` tetap aman, tidak ada `innerHTML` baru.

---

### Task 1: `server/team.js` — pure roster logic

**Files:**
- Create: `server/team.js`
- Test: inline `node -e` assert (no test file; black-box coverage lands in Task 2)

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces: `SEED` (array 13 member bawaan, pindahan isi TEAM dari `public/office.js:43-57` + field `ai`), `validateMember(input, team, isNew)` → `{ok, error?, member?}`, `cascadeRename(tasks, oldName, newName)`, `reassignTasks(tasks, from, to)` → `{moved}`.

`ai` shape: `null` (manual) atau `{on: true, model: string, system: string}`. Seed: Kak Rani `{on:true, model:'TH/qwen3.8-flash:free', system:<pindahan agents.js>}`, Kak Sinta `{on:true, model:'TH/deepseek-v4-flash:free', system:<pindahan>}`, sisanya `ai:null`. ASK block pindah ke `server/team.js` sebagai `ASK_QUESTIONS` const, dipakai template default.

- [ ] **Step 1: Write the module**

```js
// Pure roster logic: no fs, no http. Server.js owns all I/O.
const ASK_QUESTIONS = [
  'If the brief is missing information you cannot draft well without (for example the product, the audience or the key facts),',
  'do not guess: reply with the line QUESTIONS: followed by at most three short numbered questions, and nothing else.',
  'Otherwise never start your answer with QUESTIONS:.'
].join(' ');

const GROUPS = new Set(['leadership', 'marketing', 'engineering', 'service']);
const GENDERS = new Set(['male', 'female']);

function defaultSystem(role) {
  return [
    `You are the ${role} on a 13-person team working in a virtual office called Kantor Kita.`,
    'You receive tasks from teammates and return drafts that a human will review before anything is published.',
    'Write in the language of the task (Indonesian or English). If the task mixes both, follow the brief.',
    'Structure your answer as: a short summary line, then the draft, then any notes or questions for the reviewer.',
    'Never claim that you posted, scheduled or sent anything. Never invent facts about the company, products, prices or people; if something is missing, list it under notes as a question.',
    'Keep the whole answer under 600 words.',
    ASK_QUESTIONS
  ].join('\n');
}

const SEED = [
  {n: 'Koh Arman', initials: 'KA', gender: 'male', role: 'CEO', group: 'leadership', ai: null},
  {n: 'Koh Wira', initials: 'KW', gender: 'male', role: 'CTO', group: 'leadership', ai: null},
  {n: 'Kak Rani', initials: 'KR', gender: 'female', role: 'Social Media Specialist', group: 'marketing', ai: {on: true, model: 'TH/qwen3.8-flash:free', system: '...pindahan system Kak Rani dari agents.js...'}},
  // ... 10 baris sisanya, pola sama; Kak Sinta ai.on true model TH/deepseek-v4-flash:free
];

// isNew=true (POST): semua field wajib. false (PATCH): hanya field yang ada divalidasi.
function validateMember(input, team, isNew) {
  if (!input || typeof input !== 'object') return {ok: false, error: 'Expected an object.'};
  const get = k => input[k] === undefined ? undefined : String(input[k]).trim();
  const out = {};
  const need = (k, max) => {
    const v = get(k);
    if (v === undefined) return isNew ? {ok: false, error: `Pick a ${k}.`} : null;
    if (!v || v.length > max) return {ok: false, error: `${k} must be 1-${max} characters.`};
    out[k] = v; return null;
  };
  for (const [k, max] of [['n', 80], ['initials', 4], ['role', 80]])
    { const err = need(k, max); if (err) return err; }
  if (input.gender !== undefined || isNew) {
    if (!GENDERS.has(get('gender') ?? '')) return {ok: false, error: 'Pick male or female.'};
    out.gender = get('gender');
  }
  if (input.group !== undefined || isNew) {
    if (!GROUPS.has(get('group') ?? '')) return {ok: false, error: 'Pick a desk group.'};
    out.group = get('group');
  }
  if (input.ai !== undefined) {
    if (input.ai !== null) {
      if (typeof input.ai !== 'object') return {ok: false, error: 'Bad AI config.'};
      const model = String(input.ai.model || '').trim().slice(0, 200);
      const system = String(input.ai.system ?? '').trim().slice(0, 5000);
      if (!model) return {ok: false, error: 'Pick a model from the router list.'};
      out.ai = {on: input.ai.on !== false, model, system: system || defaultSystem(out.role || 'Team member')};
      // ponytail: system kosong = template generik berbasis role, bukan error
    } else out.ai = null;
  }
  const clash = team.find(m => m.n.toLowerCase() === (out.n ?? '').toLowerCase() && m.n !== input._self);
  // _self = nama lama saat PATCH, agar rename ke nama sendiri lolos
  if (out.n && clash) return {ok: false, error: 'That name is already used.'};
  const clashInit = team.find(m => m.initials.toLowerCase() === (out.initials ?? '').toLowerCase() && m.n !== input._self);
  if (out.initials && clashInit) return {ok: false, error: 'Those initials are already used.'};
  return {ok: true, member: out};
}

function cascadeRename(tasks, oldName, newName) {
  for (const t of tasks) if (t.assignee === oldName) t.assignee = newName;
}

function reassignTasks(tasks, from, to) {
  let moved = 0;
  for (const t of tasks) {
    if (t.assignee !== from || t.status === 'done') continue;
    t.assignee = to;
    if (t.status === 'active') { t.status = 'queued'; t.runId = null; }
    t.version = (t.version || 0) + 1; t.updatedAt = new Date().toISOString(); t.error = undefined;
    moved++;
  }
  return {moved};
}

module.exports = {SEED, GROUPS: [...GROUPS], validateMember, cascadeRename, reassignTasks, defaultSystem};
```

- [ ] **Step 2: Run inline asserts to verify**

Run: `node -e "const t=require('./server/team.js');const a=require('node:assert/strict');a.equal(t.SEED.length,13);let r=t.validateMember({n:'Kak Rani',initials:'KR',gender:'female',role:'X',group:'marketing'},t.SEED,true);a.equal(r.ok,false);r=t.validateMember({n:'Budi',initials:'kr',gender:'male',role:'Dev',group:'engineering'},t.SEED,true);a.equal(r.ok,false);const ts=[{assignee:'Kak Rani',status:'active',runId:'x',version:1}];t.cascadeRename(ts,'Kak Rani','Rani Baru');a.equal(ts[0].assignee,'Rani Baru');const m=t.reassignTasks(ts,'Rani Baru','Koh Wira');a.equal(ts[0].status,'queued');a.equal(m.moved,1);console.log('team.js OK')"`

Expected: `team.js OK`

- [ ] **Step 3: Commit**

```bash
git add server/team.js
git commit -m "feat: add pure team roster logic with validation and cascade"
```

---

### Task 2: `server/server.js` — team store + CRUD API

**Files:**
- Modify: `server/server.js` (store boot, routes, dynamic MEMBERS, compat PATCH)
- Test: `tests/team.cjs` (new, part 1 now; parts appended in Task 3)

**Interfaces:**
- Consumes: `server/team.js` (`SEED`, `validateMember`, `cascadeRename`, `reassignTasks`).
- Produces: `GET /api/team` → 200 array, `POST /api/team` → 201/400/409, `PATCH /api/team/:n` → 200/400/404/409, `DELETE /api/team/:n?reassignTo=` → 200 `{moved}`/404/409. `MEMBERS` derived from team (replaces line 41 const). `/api/agents` members now include `ai.on` + custom system internally.

Store boot (ganti MODELS_FILE block line 43-45):

```js
const team = require('./team');
const TEAM_FILE = path.join(DATA_DIR, 'team.json');
let roster = [];
try {
  roster = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
  if (!Array.isArray(roster) || !roster.length) throw new Error('empty roster');
} catch (error) {
  if (error.code === 'ENOENT') { roster = structuredClone(team.SEED); }
  else { console.error(`Cannot read ${TEAM_FILE}: ${error.message}. Fix or move the file, then restart.`); process.exit(1); }
}
// One-time merge: model picks saved in models.json move into roster, then ignored.
try {
  const saved = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  for (const [name, model] of Object.entries(saved || {})) {
    const m = roster.find(m => m.n === name);
    if (m && typeof model === 'string' && model.trim() && m.ai) m.ai.model = model.trim();
  }
} catch { /* no saved model picks */ }
function saveTeam() {
  const tmp = `${TEAM_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(roster, null, 2));
  fs.renameSync(tmp, TEAM_FILE);
}
if (!fs.existsSync(TEAM_FILE)) saveTeam();
const hasMember = name => roster.some(m => m.n === name);
const isAI = name => roster.find(m => m.n === name)?.ai?.on === true;
const aiOf = name => roster.find(m => m.n === name)?.ai || null;
```

Ganti semua `MEMBERS.has(x)` → `hasMember(x)`, `agents[x]` guard → `isAI(x)`. Hapus `const MEMBERS` line 41. `work()`/`kick()` iterasi `roster.filter(m => m.ai?.on)` bukan `Object.keys(agents)`. `askClaude(member, task)`: `model = member.ai.model || MODEL`, `system = member.ai.system`. `by = model` saat save draft.

Routes (sisip sebelum `/api/agents` GET):

```js
if (url.pathname === '/api/team' && req.method === 'GET') return send(res, 200, roster);
if (url.pathname === '/api/team' && req.method === 'POST') {
  const input = await readJson(req);
  const v = team.validateMember(input, roster, true);
  if (!v.ok) return send(res, input?.n && roster.some(m => m.n.toLowerCase() === String(input.n).trim().toLowerCase()) ? 409 : 400, {error: v.error});
  // ponytail: 409 hanya bila sebabnya duplikat; validate sudah bedakan pesan, status ikut pesan
  const member = {ai: null, ...v.member};
  roster.push(member); saveTeam(); kick(); return send(res, 201, member);
}
```

Hati-hati: status 409 vs 400 — implementasi jujur: `validateMember` kembalikan `{ok, error, code}` dengan code `'dup'` bila duplikat. Tambahkan di Task 2 saat implement (ubah return clash menjadi `{ok:false, error, code:'dup'}`). Route: `return send(res, v.code === 'dup' ? 409 : 400, {error: v.error})`.

```js
const teamMatch = url.pathname.match(/^\/api\/team\/(.+)$/);
if (teamMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
  const name = decodeURIComponent(teamMatch[1]);
  const member = roster.find(m => m.n === name);
  if (!member) return send(res, 404, {error: 'Unknown team member.'});
  if (req.method === 'DELETE') {
    const to = new URL(req.url, 'http://x').searchParams.get('reassignTo');
    const open = tasks.filter(t => t.assignee === name && t.status !== 'done');
    if (open.length && !to) return send(res, 409, {error: `${open.length} tasks still assigned. Pick a member to move them to.`});
    let moved = 0;
    if (to) {
      if (!hasMember(to) || to === name) return send(res, 400, {error: 'Pick another team member.'});
      moved = team.reassignTasks(tasks, name, to).moved; save();
    } else if (open.length) return send(res, 409, {error: 'Tasks still assigned.'});
    roster.splice(roster.indexOf(member), 1); saveTeam(); kick();
    return send(res, 200, {removed: name, moved});
  }
  const input = await readJson(req);
  const v = team.validateMember({...input, _self: name}, roster, false);
  if (!v.ok) return send(res, v.code === 'dup' ? 409 : 400, {error: v.error});
  const oldName = member.n;
  Object.assign(member, v.member);
  if (v.member.n && v.member.n !== oldName) { team.cascadeRename(tasks, oldName, member.n); save(); }
  saveTeam(); kick(); return send(res, 200, member);
}
```

Compat: `PATCH /api/agents/:name {model}` tetap, tapi tulis ke `roster.ai.model` + `saveTeam()` (hapus tulis MODELS_FILE). `/api/agents` GET members: `{role, model: ai?.model || MODEL, ai: ai?.on || false}`.

- [ ] **Step 1: Write failing black-box test `tests/team.cjs` part 1**

```js
// Team CRUD: validation, duplicates, rename cascade, delete guards. Throwaway server.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PORT = 4192, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-team-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: '', DRY_RUN_DELAY_MS: '50'}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise(r => server.stdout.on('data', d => String(d).includes('Kantor Kita:') && r()));
  try {
    assert.equal((await api('/api/team')).body.length, 13);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Kak Rani', initials: 'XX', gender: 'female', role: 'X', group: 'marketing'})})).status, 409);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Budi', initials: 'KR', gender: 'male', role: 'Dev', group: 'engineering'})})).status, 409);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Budi', initials: 'BD', gender: 'male', role: 'Dev', group: 'engineering'})})).status, 201);
    assert.equal((await api('/api/team')).body.length, 14);
    // Rename cascades to tasks.
    await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'T1', assignee: 'Budi'})});
    assert.equal((await api('/api/team/Budi', {method: 'PATCH', body: JSON.stringify({n: 'Budi Santoso'})})).status, 200);
    assert.equal((await api('/api/tasks')).body.find(t => t.title === 'T1').assignee, 'Budi Santoso');
    // Delete blocked without reassignTo, works with it.
    assert.equal((await api('/api/team/Budi%20Santoso', {method: 'DELETE'})).status, 409);
    const del = await api('/api/team/Budi%20Santoso?reassignTo=Koh%20Wira', {method: 'DELETE'});
    assert.equal(del.status, 200); assert.equal(del.body.moved, 1);
    assert.equal((await api('/api/tasks')).body.find(t => t.title === 'T1').assignee, 'Koh Wira');
    console.log('PASS: team CRUD part 1');
  } finally { server.kill(); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/team.cjs`
Expected: FAIL with `/api/team` 404 (route not defined)

- [ ] **Step 3: Write minimal implementation** (store boot + routes + dynamic guards + compat PATCH, per code above; add `code:'dup'` to the two clash returns in `server/team.js`)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/team.cjs`
Expected: `PASS: team CRUD part 1`

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/team.js tests/team.cjs
git commit -m "feat: team roster store with CRUD API and rename cascade"
```

---

### Task 3: AI config dari team + `agents.js` jadi seed

**Files:**
- Modify: `server/server.js` (`work`, `askClaude`, `kick`, startup log), `server/agents.js` (shrink to seed comment + re-export), `tests/team.cjs` (append part 2)

**Interfaces:**
- Consumes: Task 2 routes + roster `ai` field.
- Produces: worker hanya jalan untuk `ai.on`; `PATCH /api/agents/:name` compat; startup log list `name → model` dari roster.

`server/agents.js` baru (7 baris, tanpa duplikat prompt):

```js
// Seed defaults for the team roster. Canonical store is data/team.json;
// this file only feeds first boot and documents the two AI roles.
module.exports = require('./team').SEED.filter(m => m.ai).map(m => ({[m.n]: {role: m.role, model: m.ai.model, system: m.ai.system}})).reduce(Object.assign, {});
```

Hapus: `server.js` masih `require('./agents')` di mana-mana — ganti semua pakai roster langsung, lalu hapus require. `work(name)`: guard `if (!isAI(name)) return`. `kick`: `roster.filter(m => m.ai?.on).forEach(m => work(m.n))`. Startup log: `AI agents: ...` dari roster AI-on; bila kosong: `AI agents: none (all manual)`.

Part 2 append ke `tests/team.cjs` sebelum `console.log` (mock provider pola `worker-reliability.cjs`):

```js
    // AI toggle: member manual di-toggle on, draft via mock Anthropic endpoint.
```

Implementasi part 2 sebagai test kedua dalam file sama tapi server kedua dengan mock: refactor minimal — bungkus part 1 dalam fungsi, tambah part 2: start mock http server yang return `{content:[{type:'text',text:'MOCK DRAFT'}]}` untuk `/v1/messages`, start kantor dengan `ANTHROPIC_API_KEY:'test'`, `ANTHROPIC_BASE_URL:mock`, `ANTHROPIC_DRY_RUN:'0'`; PATCH `/api/team/Koh Wira` `{ai:{on:true, model:'mock-model', system:'Reply exactly: MOCK DRAFT'}}`; POST task; poll sampai `review`; assert `by==='mock-model'`. Lalu PATCH ai null → POST task untuknya → assert tetap `queued` setelah 1.5s (tidak di-pickup).

- [ ] **Step 1: Append part 2 test, run, verify FAIL** (toggle AI 404 / draft never arrives)

Run: `node tests/team.cjs`
Expected: FAIL at toggle or timeout waiting review

- [ ] **Step 2: Implement** (worker/ai-from-roster + agents.js shrink + compat PATCH writes roster)

- [ ] **Step 3: Run full file**

Run: `node tests/team.cjs`
Expected: `PASS: team CRUD part 1` + `PASS: AI toggle part 2`

- [ ] **Step 4: Run existing reliability suite**

Run: `node tests/worker-reliability.cjs`
Expected: PASS (guards unchanged)

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/agents.js tests/team.cjs
git commit -m "feat: drive AI workers from team roster, agents.js becomes seed"
```

---

### Task 4: Frontend — tab Team + dropdown fix + roster dari server

**Files:**
- Modify: `public/index.html` (tabs + team panel), `public/tasks.js` (team state, CRUD, roster, model fix), `public/tasks.css` (tabs + list)
- Test: `tests/decisions.cjs` (update model asserts bila berubah; roster default sama jadi tetap hijau) + manual browser check

**Interfaces:**
- Consumes: Task 2 API (`/api/team`, `/api/models` existing).
- Produces: `officetasks:team` CustomEvent (payload: roster array) tiap CRUD sukses; `window.officeTasks.team()` → roster copy.

HTML (sisip setelah `<p id="taskFeedback>`):

```html
<div class="task-tabs" role="tablist"><button type="button" id="tabTasks" role="tab" aria-selected="true">Tasks</button><button type="button" id="tabTeam" role="tab" aria-selected="false">Team</button></div>
<section id="teamPanel" hidden><h2>Team</h2><div id="teamList"></div><button type="button" id="addMember">+ Add member</button><form id="memberForm" hidden>...</form></div>
```

Wrap existing `.task-layout` grids: tab Tasks tampilkan `.task-layout`, tab Team tampilkan `#teamPanel`; state tab variabel modul (bukan localStorage).

tasks.js additions:

```js
let roster = [];
async function loadTeam() {
  if (!server) return;
  roster = await call('GET', '/api/team').catch(() => []);
  buildAssigneeOptions(); renderTeam();
  document.dispatchEvent(new CustomEvent('officetasks:team', {detail: roster.map(m => ({...m}))}));
}
function buildAssigneeOptions() {
  for (const id of ['taskAssignee', 'agentFilter']) {
    const sel = el(id), keep = sel.value;
    sel.replaceChildren(...(id === 'agentFilter' ? [new Option('All characters', 'all')] : []));
    for (const p of roster) sel.append(new Option(`${p.initials} · ${p.role}`, p.n));
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : (id === 'agentFilter' ? 'all' : roster[0]?.n || '');
  }
  team = roster.map(p => ({n: p.n, initials: p.initials, role: p.group})); // hmm — team dipakai displayName + office init
}
```

Hati-hati: `team` di tasks.js dipakai `displayName` (butuh `initials`) dan diteruskan ke `officeTasks.init(people...)` dari office.js — arahnya office→tasks, bukan sebaliknya. Jadi `buildAssigneeOptions` cukup rebuild dua select dari `roster`; `team` tetap milik office. Hapus baris `team = ...` di atas. Init flow: office.js panggil `init(people)` lalu `connect()` fetch roster → `loadTeam()`.

`renderTeam()`: tiap member satu baris: `initials · n · role + badge (AI · model / manual) + Edit + Delete`. Edit → isi `#memberForm` (n, initials, role, group select, gender select, ai checkbox, model select dari `modelIds`, system textarea), Save → POST/PATCH. Delete → bila `confirm` + bila ada tugas non-done: tampilkan select `reassignTo` dari roster lain, lalu DELETE dengan query. Tiap sukses: `await loadTeam()` (sekaligus fire event).

Dropdown fix (`syncModelSelect` existing tasks.js:36-44 ganti):

```js
function syncModelSelect() {
  const select = el('taskModel');
  if (!select || !server) return;
  const agent = agentFor(el('taskAssignee').value);
  select.disabled = !agent;
  if (!agent) { select.replaceChildren(); modelStatus(server.mode === 'claude' ? 'Manual member, no AI model.' : 'Set an API key to load router models.'); return; }
  if (!modelIds.length) { select.replaceChildren(); modelStatus('Loading router models…'); loadModels(); return; }
  const ids = modelIds.includes(agent.model) ? modelIds : [agent.model, ...modelIds];
  select.replaceChildren();
  for (const id of ids) { const option = node('option', id); option.value = id; if (id === agent.model) option.selected = true; select.append(option); }
  modelStatus(`${displayName(el('taskAssignee').value)} uses ${agent.model}. Change it here; saved on server.`);
}
```

+ retry: bila `loadModels` gagal, `modelStatus` tambah tombol? Tanpa tombol (no new DOM API): pesan `Could not load router models: <err>. Reopen the dialog to retry.` — reopen panggil `loadModels` lagi via `open()`. Tambah di `open()`: `if (server) loadModels()`.

CSS: `.task-tabs{display:flex;gap:8px;margin:12px 0}` + reuse button style; `#teamList .member-row{display:flex;...}` minimal 6 baris.

- [ ] **Step 1: Add HTML tabs + panel, CSS, tasks.js team code** (no test file change yet)

- [ ] **Step 2: Manual browser verify** — `npm start`, buka Tasks: tab Team list 13, tambah member, rename, hapus + reassign, dropdown model terisi untuk KR/KS, disabled untuk KW. Catat hasil di commit message bila anomali.

- [ ] **Step 3: Update `tests/decisions.cjs` line 14 only if defaults changed** (defaults sama → no change; verify run)

Run: `node tests/decisions.cjs` (needs playwright + chromium)
Expected: PASS unchanged

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/tasks.js public/tasks.css
git commit -m "feat: team tab with member CRUD and fixed model dropdown states"
```

---

### Task 5: `public/office.js` — roster dinamis + waiting bench

**Files:**
- Modify: `public/office.js` (TEAM → loaded roster, desk loop overflow, bench, event reload, refs)
- Test: update `tests/office.cjs` (13 → roster length), `tests/building-view.cjs` (count dinamis)

**Interfaces:**
- Consumes: Task 4 `officetasks:team` event + `window.officeTasks.team()`.
- Produces: semua avatar duduk (meja atau bench); `snapshot().team.length === roster.length`.

Roster load di awal IIFE (sebelum floor 3 dibangun):

```js
let TEAM = [ ...13 bawaan existing sebagai fallback... ];
try {
  const r = await fetch('/api/team', {cache: 'no-store'});
  if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) TEAM = list; }
} catch { /* static host: fallback */}
```

Semua referensi `TEAM` lain (log:1052, prayers:1065, board:1638, stats:1655, decisions:1662, init:1668) otomatis ikut karena variabel sama. `MEMBERS` di server terpisah — tak tersentuh.

Desk loop overflow (ganti office.js:319-326):

```js
people.forEach((person,index)=>{
  if (index < 4) {
    ...existing 4 kursi...;
    desks[person.n]=seat(x,z,f,3,group.x<0?-10.5:key==='marketing'?9:10);
  } else {
    // Waiting bench: extra row behind the group table, laptop on lap.
    const bx = group.x + (index-4)*1.1 - ((people.length-5)*1.1)/2, bz = group.z + (group.z>0?3.4:-3.4);
    bench(bx,bz,group.color); // bangku + laptop mesh, definisi sekali di bawah chair()
    desks[person.n]=seat(bx,bz,group.z>0?-1:1,3,group.x<0?-10.5:key==='marketing'?9:10);
  }
});
```

`bench(x,z,color)`: `box(1,.45,.5,color...)` alas + `softBox(.35,.04,.45)` laptop di depan + reuse tanpa pose baru (pose `sit` existing di `character`). Definisi di dekat `chair()` (~line 108). Posisi bench di dalam nav grid → otomatis walkable check via furniture rules existing.

Rebuild: di dekat `init` (line 1668):

```js
document.addEventListener('officetasks:team', () => location.reload());
```

Alasan: draft tab tersimpan di sessionStorage (`tasks.js:10-12`), tasks di server; reload = rebuild 3D paling murah dan benar. Kamera reset — diterima v1, tulis di spec? Spec bilang "posisi reset ke meja" — reload memenuhi.

Dining/rooftop overflow: `dining` 14 seats, `roofSpots` N — bila roster > kapasitas, `moveTeam`/`commandMembers` `spots[i]` undefined → crash. Guard di `commandMembers`: sudah ada (`spots.length<members.length` reject). `moveTeam` line 1320: `setPath(agent, undefined)` — tambah fallback: `agents.forEach((agent,i)=>setPath(agent, level===3?agent.desk:level===2?(dining[i]||agent.desk):(roofOrder[i]||agent.desk)))`. Satu baris, cegah crash tim besar.

Tests update: `office.cjs:10` `snap.team.length,13` → bandingkan `(await api(PORT,'/api/team')).body.length`; `building-view.cjs:13` `'13'` → sama. `avatar-stairs`, `soft-avatar`, `member-commands` tak sebut 13 langsung — cek grep, hanya yang sebut angka yang diubah.

- [ ] **Step 1: Update the three assertions, run, verify FAIL** (roster masih 13 statis — FAIL hanya muncul bila... hmm, roster default 13 jadi tetap PASS. Jujur: step ini verify test masih PASS dengan roster default, FAIL test = tambah member ke-14 via API lalu cek bench seat. Tulis sub-test manual: POST member, reload page, assert `snapshot().team.length===14` dan semua `sitting||atDesk`.)

- [ ] **Step 2: Implement** (roster fetch + bench + guard + reload listener)

- [ ] **Step 3: Verify**: `node tests/office.cjs`, `node tests/building-view.cjs`, plus 14-member bench check via `node -e` playwright? Tanpa playwright di plan: gunakan existing test harness — tambah ke `tests/team.cjs` part 3? Itu butuh browser. Ponytail: verifikasi bench via `office.cjs` run dengan `DATA`? office.cjs tak spawn server sendiri (butuh server jalan). Langkah konkret: start server test di DATA_DIR tmp, POST member ke-14, `node tests/office.cjs` dengan `OFFICE_URL`? Cek office.cjs51: pakai PORT bawaan? Baca dulu saat eksekusi; bila tak mendukung URL custom, verifikasi manual browser + catat. Tulis langkah: "start server, POST Budi, reload browser, screenshot bench" sebagai manual verify dengan checklist, bukan automated.

- [ ] **Step 4: Commit**

```bash
git add public/office.js tests/office.cjs tests/building-view.cjs
git commit -m "feat: dynamic roster with waiting bench overflow in 3D"
```

---

### Task 6: Suite hijau + `.env.example` + spec status

**Files:**
- Modify: `.env.example` (sudah ada BASE_URL — cek ulang), spec status line, `tests/decisions.cjs` bila perlu
- Test: full suite

- [ ] **Step 1: Run full suite**

Run: `node tests/worker-reliability.cjs && node tests/team.cjs && node tests/server.cjs`
Expected: all PASS (server.cjs butuh playwright; bila tak ada chromium, catat skip + alasan)

- [ ] **Step 2: Update spec status** line 3: `Status: implemented <date>, Spec 2 (chat) dan Spec 3 (kanban) open.`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: team management spec implemented, suite green"
```

---

## Self-Review

1. **Spec coverage:** data/team.json ✓ T1/T2; CRUD API ✓ T2; rename cascade ✓ T2; delete reassign ✓ T2; ai toggle+model+system ✓ T2/T3; models.json merge ✓ T2; /api/models tetap ✓ (tak diubah); tab Team ✓ T4; dropdown fix states ✓ T4; assignee rebuild ✓ T4; meja auto-grow — spec bilang "lebar meja + karpet ikut count": plan T5 hanya tambah bench, meja/karpet TETAP ukuran existing. GAP: meja 4 orang + bench di belakang = karpet existing muat? Bench di `group.z±3.4`, karpet existing `6.6/4.4` panjang — bench jatuh di luar karpet, di lantai biasa. Itu konsisten dengan "waiting area", bukan melanggar; tapi "auto-grow" tak diimplementasi. FIX: ubah T5 — karpet + meja tetap (cukup untuk 4), overflow ke bench di luar karpet. Update spec kalimat "Meja grup auto-grow" → "Meja + karpet tetap untuk 4; overflow ke waiting bench". Lakukan saat eksekusi T5. Kursi = anggota ✓ (4 kursi + N bench). Rebuild event ✓ (reload). Roster tunggal ✓ T5. Migrasi arsip label ✓ — GAP: label arsip non-klik belum ada di plan! Task list render branch `!team.some(...)` existing (tasks.js:201-207) tampilkan "old prototype" + Move. Dengan roster dinamis, assignee tak dikenal = anggota terhapus → branch ini sudah tangani (label + pindah manual). Cukup: rename pesan "old prototype" → netral? Tambahkan ke T4: ubah copy jadi `This member is no longer on the team.` + opsi pindah (existing) — tanpa arsip non-klik murni, tapi strictly better (bisa dipindah). Spec "arsip non-klik" diganti perilaku ini; catat di spec saat T4.
2. **Placeholder scan:** tidak ada TBD/TODO; semua langkah ada kode/run/expected konkret. `...13 bawaan...` di T1/T5 menunjuk lokasi salin yang tepat (office.js:43-57, agents.js) — diterima, bukan placeholder.
3. **Type consistency:** `ai: null | {on, model, system}` konsisten T1→T3. `/api/agents` GET tambah field `ai` boolean — tasks.js `agentFor` spread existing tetap jalan; badge `ai.model` tetap ada. `PATCH /api/team/:n` dengan nama berspasi → client harus `encodeURIComponent` (T4 pakai itu; T2 test pakai `%20` literal ✓).
4. **Review Focus:** tiap baris terpetakan: case-dup → T2 test `kak rani`? Test T2 hanya exact-case + initials. TAMBAH ke T2 test: POST `{n:'kak rani'...}` → 409. Rename ke nama ada → tambah PATCH `{n:'Koh Wira'}` → 409 + tasks tak berubah. Hapus active-mid-run → T3 part 2 tambah: POST task ke AI member, tunggu `active`, DELETE + reassign, assert hasil mock TIDAK menimpa (status tetap queued di pemilik baru). team.json korup → tambah T2: tulis ` vite`? Tulis file garbage ke DATA_DIR lalu spawn → assert exit + pesan di stderr. XSS → tambah T2: POST nama `<img src=x onerror=alert(1)>`, GET team, assert nama utuh tersimpan (store raw) — render aman karena semua render pakai `textContent`/`node()` (tasks.js) dan `textContent` (office.js); catat audit ini di test comment.
