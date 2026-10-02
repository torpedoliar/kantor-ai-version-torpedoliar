# Org Chart + Approve Satu Pintu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiap anggota punya atasan langsung (`manager`), draft bawahan wajib lewat `manager-review` sebelum ke owner (`review`), dengan tombol manager-approve/reject terbuka lokal tanpa login.

**Architecture:** `server/team.js` tetap pure logic (tambah chain + siklus + cascade manager); `server/server.js` pemilik I/O dan satu-satunya penulis `team.json`/`tasks.json`; frontend hanya render rantai dan tombol sesuai status, tanpa logika kuasa sendiri. Satu state baru `manager-review`, reuse pola `version` + `runId` guard yang sudah ada.

**Tech Stack:** Node 22+ (stdlib only, no deps), vanilla JS frontend, test `.cjs` dijalankan dengan `node tests/<file>.cjs`.

**Spec:** `docs/superpowers/specs/2026-10-03-org-approve-design.md`

## Global Constraints

- Single-user lokal, tanpa login, server hanya listen 127.0.0.1.
- `data/team.json` canonical; tulis atomik (tmp + rename) seperti `tasks.json`.
- Mode dry-run tanpa key tetap jalan.
- Tanpa auth/roles di plan ini.
- Tombol manager-approve terbuka untuk siapa pun yang buka browser (kepercayaan lokal, Ruling A).
- History `by` label tidak diubah saat rename.
- Hapus anggota: bawahan langsung wajib reassign manager baru, default ke manager almarhum; bila almarhum owner, bawahan jadi owner (`manager: null`).
- Node >= 22 (`process.loadEnvFile`, `structuredClone` sudah dipakai).

## Review Focus

- Rantai 4 level (staf → head → manager → owner) approve tetap satu pintu, tidak minta approve berlapis — test di Task 3.
- Rename manager menengah tidak memutus rantai bawahan — test di Task 2.
- Task `review` lama (dibuat sebelum fitur) tetap bisa di-approve final tanpa lewat manager — test di Task 3.
- `manager` menunjuk nama yang sudah dihapus via race dua editor — test di Task 2.
- Draft `manager-review` dari anggota yang manager-nya dihapus sebelum approve — test di Task 3.

---

## File Structure

- `server/team.js` — pure roster + org logic. Tambah: `managerChain(roster, name)`, `isManagerOf(roster, actor, target)`, `validateManagerAssignment(roster, selfName, managerName)`, `defaultSystem(role, isManager)`, perluas `cascadeRename` ke field manager, tambah `reassignSubordinates(roster, deletedName, fallback)`. Tanpa fs/http.
- `server/server.js` — pemilik I/O. Ubah: `STATES` + `newTask` + semua guard status, boot `team.json` (field manager default), route `PATCH /api/team/:n` terima `manager`, route `DELETE` reassign bawahan, worker tulis `manager-review`, action `manager-approve`/`manager-reject`, `GET /api/agents` sertakan `manager` + `chain`.
- `server/agents.js` — tidak diubah (masih seed re-export dari `team.SEED`).
- `public/tasks.js` — state label, `chainFor()`, select manager di form, rantai di meta, kontrol `manager-review`, `validTask` terima state baru.
- `public/index.html` — satu `<option value="manager-review">` di filter status.
- `public/office.js` — `TASK_LOG` + `SAY` tambah entri manager, chip board tambah `manager-review`, `apply()` di tasks.js petakan transisi.
- `tests/org.cjs` — baru. Rantai 3 level, siklus, lintas-subtree, alur penuh, reject, rename cascade manager, hapus manager.
- `tests/team.cjs`, `tests/worker-reliability.cjs`, `tests/decisions.cjs`, `tests/office.cjs`, `tests/server.cjs` — tidak diubah kecuali assert yang pecah karena state baru.

---

### Task 1: `server/team.js` — org pure logic

**Files:**
- Modify: `server/team.js`
- Test: `tests/org.cjs` (ditulis di Task 6, tapi verifikasi Task 1 via inline `node -e`)

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces: `managerChain(roster, name) → string[]` (atasan langsung sampai puncak, `[]` untuk owner), `isManagerOf(roster, actor, target) → boolean`, `validateManagerAssignment(roster, selfName, managerName) → {ok, error?, code?}`, `defaultSystem(role, isManager) → string`, `cascadeRenameMember(roster, tasks, oldName, newName)`, `reassignSubordinates(roster, deletedName, fallback) → {count}`.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/org-t1.cjs — dibuang setelah hijau, coverage permanen di tests/org.cjs Task 6
const assert = require('node:assert/strict');
const t = require('./server/team.js');
assert.equal(typeof t.managerChain, 'function');
assert.equal(typeof t.isManagerOf, 'function');
assert.equal(typeof t.validateManagerAssignment, 'function');
assert.equal(typeof t.reassignSubordinates, 'function');
const roster = [{n: 'A', manager: null}, {n: 'B', manager: 'A'}, {n: 'C', manager: 'B'}];
assert.deepEqual(t.managerChain(roster, 'C'), ['B', 'A']);
assert.equal(t.isManagerOf(roster, 'A', 'C'), true);
assert.equal(t.isManagerOf(roster, 'B', 'A'), false);
assert.equal(t.validateManagerAssignment(roster, 'A', 'C').ok, false);
console.log('ORG T1 OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/org-t1.cjs`
Expected: FAIL with `t.managerChain is not a function` (fungsi belum ada).

- [ ] **Step 3: Write minimal implementation**

```js
function managerChain(roster, name) {
  const byName = new Map(roster.map(m => [m.n, m]));
  const chain = [];
  const seen = new Set([name]);
  let cur = byName.get(name)?.manager ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.push(cur);
    cur = byName.get(cur)?.manager ?? null;
  }
  return chain;
}

function isManagerOf(roster, actor, target) {
  if (actor === target) return false;
  const actorRec = roster.find(m => m.n === actor);
  if (!actorRec) return false;
  if (actorRec.manager == null) return true; // owner kuasa atas semua
  return managerChain(roster, target).includes(actor);
}

function validateManagerAssignment(roster, selfName, managerName) {
  if (managerName === null || managerName === undefined || managerName === '') return {ok: true, manager: null};
  const m = String(managerName).trim();
  if (!roster.some(x => x.n === m)) return {ok: false, error: 'Unknown manager.', code: 'bad'};
  if (m === selfName) return {ok: false, error: 'A member cannot manage themselves.', code: 'bad'};
  if (managerChain(roster, m).includes(selfName)) return {ok: false, error: 'That would create a management cycle.', code: 'dup'};
  return {ok: true, manager: m};
}

function defaultSystem(role, isManager) {
  const base = [
    `You are the ${role} on a team working in a virtual office called Kantor Kita.`,
    'You receive tasks from teammates and return drafts that a human will review before anything is published.',
    'Write in the language of the task (Indonesian or English). If the task mixes both, follow the brief.',
  ];
  if (isManager) base.push(
    'You also lead your direct reports: when a task is too big, say so in one line and list the subtasks you would delegate.',
    'When you review a draft from your team, check facts first, then tone, then completeness.',
  );
  else base.push(
    'Structure your answer as: a short summary line, then the draft, then any notes or questions for the reviewer.',
    'Your draft goes to your manager first; write so your manager can approve it in one read.',
  );
  base.push(
    'Never claim that you posted, scheduled or sent anything. Never invent facts about the company, products, prices or people; if something is missing, list it under notes as a question.',
    'Keep the whole answer under 600 words.',
    ASK_QUESTIONS
  );
  return base.join('\n');
}

function cascadeRenameMember(roster, tasks, oldName, newName) {
  for (const m of roster) if (m.manager === oldName) m.manager = newName;
  cascadeRename(tasks, oldName, newName);
}

function reassignSubordinates(roster, deletedName, fallback) {
  let count = 0;
  for (const m of roster) {
    if (m.manager === deletedName) { m.manager = fallback ?? null; count++; }
  }
  return {count};
}
```

Ubah `module.exports` tambah enam nama baru. Ubah `defaultSystem(role)` lama menjadi `defaultSystem(role, isManager)` — panggil lama `defaultSystem(role)` tetap jalan (`isManager` undefined = falsy = template staff, sama dengan perilaku lama). Ubah validasi `ai` di `validateMember`: `system: system || defaultSystem(out.role || 'Team member', false)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node /tmp/org-t1.cjs`
Expected: `ORG T1 OK`

- [ ] **Step 5: Commit**

```bash
git add server/team.js
git commit -m "feat: add org pure logic with chain and cycle guard"
```

---

### Task 2: `server/server.js` — boot roster + CRUD manager + SEED org

**Files:**
- Modify: `server/server.js` (boot, POST, PATCH, DELETE, SEED default)
- Modify: `server/team.js` (SEED tambah `manager`)
- Test: inline `node -e` + `node tests/team.cjs`

**Interfaces:**
- Consumes: Task 1 (`validateManagerAssignment`, `cascadeRenameMember`, `reassignSubordinates`, `managerChain`).
- Produces: `GET /api/team` tiap member punya `manager: string|null`; `PATCH /api/team/:n {manager}` 200/400/404/409; `DELETE` reassign bawahan; `GET /api/agents` members sertakan `manager` + `chain`.

SEED org default (ganti `manager` di `server/team.js` SEED, 13 baris):

```js
{n: 'Koh Arman', manager: null},          // owner, CEO
{n: 'Koh Wira', manager: 'Koh Arman'},    // CTO
{n: 'Kak Dewi', manager: 'Koh Arman'},    // Marketing head
{n: 'Kak Rani', manager: 'Kak Dewi'},
{n: 'Mira', manager: 'Kak Dewi'},
{n: 'Tari', manager: 'Kak Dewi'},
{n: 'Bagas Pratama Putra', manager: 'Koh Wira'},
{n: 'Rizky Hakim', manager: 'Koh Wira'},
{n: 'Yoga', manager: 'Koh Wira'},
{n: 'Bang Eko', manager: 'Koh Wira'},
{n: 'Gilang', manager: 'Koh Arman'},       // Service head
{n: 'Kak Sinta', manager: 'Gilang'},
{n: 'Kak Laras', manager: 'Gilang'},
```

Boot migrasi (setelah merge `models.json`, sebelum `saveTeam` pertama): untuk tiap `m` tanpa key `manager`, set `m.manager = <default dari SEED bila nama cocok, else null>`. Tulis `team.json` bila berubah.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/org-t2.cjs
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PORT = 4196, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-org-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
(async () => {
  const s = spawn(process.execPath, [path.join('server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: ''}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise(r => s.stdout.on('data', d => String(d).includes('Kantor Kita:') && r()));
  try {
    const team = (await api('/api/team')).body;
    assert.equal(team.find(m => m.n === 'Tari').manager, 'Kak Dewi');
    assert.equal((await api('/api/team/Tari', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 400);
    assert.equal((await api('/api/team/Kak%20Dewi', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 409);
    assert.equal((await api('/api/team/Tari', {method: 'PATCH', body: JSON.stringify({manager: 'Nobody'})})).status, 400);
    console.log('ORG T2 OK');
  } finally { s.kill(); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/org-t2.cjs`
Expected: FAIL — `manager` undefined pada member (body `manager` tidak ada) atau PATCH 404 (route tidak kenal field).

- [ ] **Step 3: Write minimal implementation**

Di `PATCH /api/team/:n`, setelah `const v = team.validateMember(...)`, tambah blok manager sebelum `Object.assign`:

```js
if (input.manager !== undefined) {
  const mv = team.validateManagerAssignment(roster, name, input.manager);
  if (!mv.ok) return send(res, mv.code === 'dup' ? 409 : 400, {error: mv.error});
  v.member.manager = mv.manager;
}
```

Di `POST /api/team`, setelah `const v = ...`, tambah blok sama dengan `selfName` = `v.member.n`:

```js
if (input.manager !== undefined || true) {
  const mv = team.validateManagerAssignment(roster, v.member.n, input.manager ?? null);
  if (!mv.ok) return send(res, mv.code === 'dup' ? 409 : 400, {error: mv.error});
  v.member.manager = mv.manager;
}
```

Ganti rename cascade: `team.cascadeRename(tasks, oldName, member.n)` menjadi `team.cascadeRenameMember(roster, tasks, oldName, member.n)`.

Di `DELETE`, setelah hitung `moved`, sebelum `roster.splice`:

```js
const leavingManager = member.manager ?? null;
const sub = team.reassignSubordinates(roster.filter(m => m.n !== name), name, leavingManager);
// catat: reassignSubordinates di atas dipanggil pada salinan tanpa almarhum agar tidak ikut diubah;
// terapkan ke roster asli:
for (const m of roster) if (m.manager === name) m.manager = leavingManager;
```

Hapus baris `sub` bila memakai loop langsung — pilih loop langsung 2 baris, tanpa fungsi ganda. (Fungsi `reassignSubordinates` tetap dipakai test unit; di server pakai loop 2 baris agar jelas.)

`DELETE` response tambah `{removed, moved, subordinates: <count>}`.

`GET /api/agents` ganti members menjadi:

```js
members: Object.fromEntries(roster.filter(m => m.ai?.on).map(m => [m.n, {role: m.role, model: m.ai.model || MODEL, ai: true, manager: m.manager ?? null, chain: team.managerChain(roster, m.n)}]))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node /tmp/org-t2.cjs`
Expected: `ORG T2 OK`

Run: `node tests/team.cjs`
Expected: PASS part 1 + part 2 (roster lama tanpa manager termigrasi, tidak pecah).

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/team.js
git commit -m "feat: add manager field with cycle guard and org seed"
```

---

### Task 3: Worker + `manager-review` + approve satu pintu

**Files:**
- Modify: `server/server.js` (`STATES`, `newTask`, worker, PATCH actions, POST/PATCH guards, reset startup)
- Test: `tests/org.cjs` bagian 1 (alur worker) + `node tests/worker-reliability.cjs`

**Interfaces:**
- Consumes: Task 2 roster `manager`.
- Produces: status `manager-review`; action `manager-approve` → `review`, `manager-reject` + feedback → `queued`; `approve` final tetap `review` → `done`; tugas owner langsung ke `review`.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/org-t3.cjs — mock provider cepat, pola worker-reliability.cjs
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const PORT = 4197, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-orgw-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const waitFor = async (check, ms = 25000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } throw new Error('timed out'); };
(async () => {
  const mock = http.createServer((req, res) => { req.resume(); res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({content: [{type: 'text', text: 'MOCK DRAFT BODY'}}]})); });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const s = spawn(process.execPath, [path.join('server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: 't', ANTHROPIC_DRY_RUN: '0', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise(r => s.stdout.on('data', d => String(d).includes('Kantor Kita:') && r()));
  try {
    const made = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Staff job', assignee: 'Kak Rani', brief: 'a sufficiently long brief for the mock'})})).body;
    const mr = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made.id); return t.status === 'manager-review' ? t : null; });
    assert.match(mr.result, /MOCK DRAFT/);
    const badApprove = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: mr.version})});
    assert.equal(badApprove.status, 409);
    const ok = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: mr.version})});
    assert.equal(ok.status, 200); assert.equal(ok.body.status, 'review');
    const fin = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: ok.body.version})});
    assert.equal(fin.body.status, 'done');
    console.log('ORG T3 OK');
  } finally { s.kill(); await new Promise(r => mock.close(r)); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/org-t3.cjs`
Expected: FAIL — timeout menunggu `manager-review` (worker masih tulis `review`), atau `manager-approve` 404/400 (action belum ada).

- [ ] **Step 3: Write minimal implementation**

Ubah `STATES` menjadi:

```js
const STATES = new Set(['queued', 'active', 'blocked', 'manager-review', 'review', 'done']);
```

Ubah `newTask` return:

```js
return {id: crypto.randomUUID(), title, assignee, brief: text(input.brief, 5000), status: ['done','review','manager-review'].includes(status) && !result ? 'queued' : status, result, createdAt: now()};
```

Ubah worker (ganti baris draft `Object.assign(current, {status:'review',...`):

```js
const needsManager = (roster.find(m => m.n === name)?.manager ?? null) !== null;
Object.assign(current, {status: needsManager ? 'manager-review' : 'review', result: draft.result, by: draft.by, history: [...(current.history || []), draft], runId: null, version: (current.version || 0) + 1, updatedAt: now()}); save();
```

Tambah cabang action setelah blok `answer`, sebelum `if(input.action!==undefined)` generik — ganti blok generik menjadi:

```js
if(input.action!==undefined){
  if(!['approve','revise','manager-approve','manager-reject'].includes(input.action))return send(res,400,{error:'Unknown action.'});
  if((input.action==='approve'||input.action==='revise')&&(task.status!=='review'||input.version!==(task.version||0)))return send(res,409,{error:'This draft changed. Refresh and review the latest version.'});
  if((input.action==='manager-approve'||input.action==='manager-reject')&&(task.status!=='manager-review'||input.version!==(task.version||0)))return send(res,409,{error:'This draft changed. Refresh and review the latest version.'});
  if(input.action==='revise'&&!text(input.feedback,5000))return send(res,400,{error:'Describe the changes needed.'});
  if(input.action==='manager-reject'&&!text(input.feedback,5000))return send(res,400,{error:'Describe the changes needed.'});
  if(input.action==='approve')Object.assign(task,{status:'done',feedback:'',reviewedAt:now(),runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
  if(input.action==='manager-approve')Object.assign(task,{status:'review',managerReviewedAt:now(),runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
  if(input.action==='revise'||input.action==='manager-reject')Object.assign(task,{status:'queued',feedback:text(input.feedback,5000),runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
  save();send(res,200,task);setImmediate(kick);return;
}
```

Update guard yang menyebut `review`/`blocked` agar sertakan `manager-review`:

```js
// POST /api/tasks:
if(task.status==='review'||task.status==='blocked'||task.status==='manager-review'||(isAI(task.assignee)&&task.status!=='queued'))return send(res,409,{error:'AI drafts must be generated before review.'});
// PATCH status langsung:
if (!STATES.has(input.status)||input.status==='review'||input.status==='blocked'||input.status==='manager-review') return send(res, 400, {error: 'Unknown status.'});
// PATCH guard review terkunci:
if((task.status==='review'||task.status==='manager-review')&&!change.assignee)return send(res,409,{error:'Approve this draft or request a revision.'});
```

Startup reset: `tasks.forEach(task => { if (task.status === 'active' && isAI(task.assignee)) ...` — tambah `manager-review` tidak perlu reset (bukan active). Biarkan. Tapi tugas `manager-review` milik anggota yang manager-nya dihapus: tetap bisa di-approve (single-user trust). Tidak ada guard tambahan.

Rantai 4 level tetap satu pintu: worker hanya cek manager langsung (`manager ?? null`), bukan seluruh rantai — buktikan dengan test Review Focus di Task 6 (rantai A→B→C→D, task C cukup sekali manager-approve).

- [ ] **Step 4: Run test to verify it passes**

Run: `node /tmp/org-t3.cjs`
Expected: `ORG T3 OK`

Run: `node tests/worker-reliability.cjs`
Expected: PASS (guard user-set `review`/`blocked` tetap, pola mock sama).

- [ ] **Step 5: Commit**

```bash
git add server/server.js
git commit -m "feat: route staff drafts via manager-review with one-gate approve"
```

---

### Task 4: Handoff log + bubble + rantai di board

**Files:**
- Modify: `public/office.js` (`TASK_LOG`, `SAY`, board chip)
- Modify: `public/tasks.js` (`apply()` transisi, `states` label)
- Test: manual headless harness (tanpa playwright) + `node tests/team.cjs`

**Interfaces:**
- Consumes: Task 3 status `manager-review`, Task 2 `chain`.
- Produces: transisi tercatat sebagai `changed(assignee, state, title)` dengan state baru; board chip `manager-review` ungu.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/org-t4.cjs — verifikasi string mapping ada di file (static, tanpa browser)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const office = fs.readFileSync('public/office.js', 'utf8');
const tasks = fs.readFileSync('public/tasks.js', 'utf8');
assert.ok(office.includes('manager-review'), 'office.js knows manager-review');
assert.ok(tasks.includes('manager-review'), 'tasks.js knows manager-review');
assert.ok(office.includes('Manager review') || office.includes('manager review'), 'board chip label exists');
console.log('ORG T4 OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/org-t4.cjs`
Expected: FAIL — `office.js knows manager-review` assertion gagal (string belum ada).

- [ ] **Step 3: Write minimal implementation**

Di `public/office.js`, ganti:

```js
const TASK_LOG={active:'started task',done:'finished task',blocked:'needs a decision before continuing',review:'submitted draft for review',queued:'moved task back to the queue'};
```

menjadi:

```js
const TASK_LOG={active:'started task',done:'finished task',blocked:'needs a decision before continuing',review:'submitted draft for review','manager-review':'sent draft to manager',queued:'moved task back to the queue'};
```

Ganti:

```js
const SAY={active:'On it!',blocked:'Quick question!',review:'Ready for review',done:'Done!'};
```

menjadi:

```js
const SAY={active:'On it!',blocked:'Quick question!',review:'Ready for review','manager-review':'Sent to manager!',done:'Done!'};
```

Di `drawBoard()`, cari peta chip:

```js
const [chip,ink,label]={active:[...],blocked:[...],review:[...]}[task.status]||[...]
```

tambah entri `'manager-review':['#e9e4f7','#5b4a9e','Mgr review']` sebelum `review`. Jika peta ditulis inline berbeda, tambah dengan pola yang sama.

Di `public/tasks.js`, ganti:

```js
const states = {queued: 'Queued', active: 'In progress', blocked: 'Needs decision', review: 'Needs review', done: 'Done'};
```

menjadi:

```js
const states = {queued: 'Queued', active: 'In progress', blocked: 'Needs decision', 'manager-review': 'Manager review', review: 'Needs review', done: 'Done'};
```

Di `apply()`, ganti kondisi fast-agent:

```js
if (old && old.status === 'queued' && ['blocked','review','done'].includes(task.status)) changed(task.assignee, 'active', task.title);
```

menjadi sertakan `'manager-review'` dalam array. Transisi `manager-review` → `review` otomatis tercatat via `old.status !== task.status` menjadi `changed(assignee, 'review', title)` = "submitted draft for review" — cukup untuk v1 (manager-approved implisit). Tanpa event `delegated` terpisah.

- [ ] **Step 4: Run test to verify it passes**

Run: `node /tmp/org-t4.cjs`
Expected: `ORG T4 OK`

Run: `node tests/team.cjs`
Expected: PASS (tidak sentuh backend).

- [ ] **Step 5: Commit**

```bash
git add public/office.js public/tasks.js
git commit -m "feat: show manager-review in log, bubble, board and labels"
```

---

### Task 5: Team tab + meta rantai + tombol manager

**Files:**
- Modify: `public/tasks.js` (`openMemberForm`, `saveMember`, `renderTeam`, meta, `managerReviewControls`, `agentActions`, `chainFor`)
- Modify: `public/index.html` (option filter + field manager di form)
- Test: ID cross-check `node -e` + headless harness `team()`/`chain`

**Interfaces:**
- Consumes: Task 2 (`PATCH /api/team/:n {manager}`, `GET /api/team` ada `manager`), Task 4 (`states`).
- Produces: form member bisa set manager; meta tampil `KR → KW → KA`; `manager-review` ada tombol Manager approve / Request changes.

- [ ] **Step 1: Write the failing test**

```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('public/index.html','utf8');
const js=fs.readFileSync('public/tasks.js','utf8');
const assert=require('node:assert/strict');
assert.ok(html.includes('value=\"manager-review\"'),'index has manager-review filter');
assert.ok(js.includes('memberManager'),'tasks.js has manager select');
assert.ok(js.includes('manager-approve'),'tasks.js has manager action');
console.log('ORG T5 OK');
"
```

Expected: FAIL — `index has manager-review filter` gagal.

- [ ] **Step 2: Run test to verify it fails**

Run perintah di atas. Expected: `AssertionError: index has manager-review filter`.

- [ ] **Step 3: Write minimal implementation**

`public/index.html`: di select `#taskFilter` tambah setelah `Needs decision`:

```html
<option value="manager-review">Manager review</option>
```

Di `#memberForm` setelah blok gender tambah:

```html
<label for="memberManager">Reports to <span>(blank = owner)</span></label><select id="memberManager"></select>
```

`public/tasks.js`:

```js
function chainFor(name) {
  const chain = [];
  const seen = new Set([name]);
  let cur = roster.find(m => m.n === name)?.manager ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.push(cur);
    cur = roster.find(m => m.n === cur)?.manager ?? null;
  }
  return chain;
}
function chainText(name) {
  const me = displayName(name);
  const rest = chainFor(name).map(displayName);
  return [me, ...rest].join(' → ');
}
function syncMemberManager() {
  const sel = el('memberManager'); if (!sel) return;
  const cur = editingMember ? roster.find(m => m.n === editingMember)?.manager ?? '' : '';
  sel.replaceChildren();
  const owner = node('option', 'Owner (no manager)'); owner.value = ''; sel.append(owner);
  for (const m of roster) {
    if (m.n === editingMember) continue;
    const o = node('option', `${m.initials} · ${m.n}`); o.value = m.n;
    if (m.n === cur) o.selected = true;
    sel.append(o);
  }
  if (cur && ![...sel.options].some(o => o.value === cur)) { const o = node('option', cur); o.value = cur; o.selected = true; sel.append(o); }
}
```

`openMemberForm`: setelah `el('memberGender').value = ...` tambah `syncMemberManager();`. `saveMember` body tambah `manager: el('memberManager').value || null` — kirim selalu (server terima `manager: null` = jadi owner).

`renderTeam` baris: ganti span menjadi `` `${m.role} · reports to ${m.manager || '—'}${m.ai?.on ? ` · AI · ${m.ai.model}` : ' · manual'}` ``.

Meta rantai: ganti `displayName(task.assignee)` di baris `task-meta` menjadi `chainText(task.assignee)`.

Kontrol manager (setelah `reviewControls`):

```js
function managerReviewControls(task, article) {
  article.append(node('div', task.result, 'task-result'));
  const who = chainFor(task.assignee)[0];
  if (who) article.append(node('p', `Waiting on ${displayName(who)} (manager). Anyone opening this browser approves as manager (local trust).`, 'task-agent'));
  const approve = action('Manager approve', () => reviewTask(task, 'manager-approve')); approve.className = 'task-primary'; article.append(approve);
  const form = node('form'), label = node('label', 'Request changes (back to staff)'), input = node('textarea'), key = draftKey(task, 'manager-review');
  input.id = `manager-review-${task.id}`; label.htmlFor = input.id; input.required = true; input.maxLength = 5000; input.rows = 3; input.value = draftRead(key);
  input.oninput = () => { input.setCustomValidity(''); draftWrite(key, input.value); };
  const submit = node('button', 'Request changes'); submit.type = 'submit';
  form.append(label, input, submit);
  form.onsubmit = e => { e.preventDefault(); if (!input.value.trim()) { input.setCustomValidity('Describe the changes needed.'); input.reportValidity(); return; } reviewTask(task, 'manager-reject', input.value.trim()); };
  article.append(form);
}
```

`reviewTask(task, action, comments)`: server branch sudah generik (`{action, feedback, version}`) — tidak perlu diubah selain pesan sukses:

```js
feedback(action==='approve'?'Draft approved.':action==='manager-approve'?'Sent to owner review.':'Revision requested. The previous draft stays in history.');
```

dan `draftClear(draftKey(task,'review'))` tambah `draftClear(draftKey(task,'manager-review'))`.

`agentActions`: setelah cabang `blocked`, tambah:

```js
else if (task.status === 'manager-review') managerReviewControls(task, article);
```

`update()` dan `reassign()` tidak berubah. `validTask`: tambah `'manager-review'` ke cek `(!['review','done'].includes(...))` menjadi `(!['review','manager-review','done'].includes(task.status) || task.result.trim())`.

- [ ] **Step 4: Run test to verify it passes**

Run perintah Step 1 lagi. Expected: `ORG T5 OK`.

Run: `node --check public/tasks.js && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/tasks.js
git commit -m "feat: manager select, chain meta and manager approve buttons"
```

---

### Task 6: `tests/org.cjs` + suite hijau + status spec

**Files:**
- Create: `tests/org.cjs` (gabungan /tmp/org-t2 + /tmp/org-t3 + tambahan di bawah)
- Modify: `docs/superpowers/specs/2026-10-03-org-approve-design.md` (status line)
- Test: `node tests/org.cjs && node tests/team.cjs && node tests/worker-reliability.cjs`

**Interfaces:**
- Consumes: Task 1–5.
- Produces: satu file test permanen; suite hijau; spec `Status: implemented`.

- [ ] **Step 1: Write the failing test**

Tulis `tests/org.cjs` final (server throwaway PORT 4198, mock cepat). Isi = 9 asersi, gabung pola yang sudah hijau di /tmp:

```js
// Org chart + approve satu pintu: rantai, siklus, alur penuh, reject, rename, hapus.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const PORT = 4198, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-org-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const waitFor = async (check, ms = 25000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } throw new Error('timed out'); };
(async () => {
  const mock = http.createServer((req, res) => { req.resume(); res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({content: [{type: 'text', text: 'MOCK ORG DRAFT'}]})); });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const server = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: 't', ANTHROPIC_DRY_RUN: '0', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('Kantor Kita:')) resolve(); }); server.on('exit', () => reject(new Error('server exited'))); });
  try {
    // 1. Seed org: Tari → Kak Dewi → Koh Arman.
    const team = (await api('/api/team')).body;
    assert.equal(team.find(m => m.n === 'Tari').manager, 'Kak Dewi');
    // 2. Siklus ditolak: Kak Dewi tidak bisa lapor ke Tari.
    assert.equal((await api('/api/team/Kak%20Dewi', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 409);
    // 3. Diri sendiri ditolak.
    assert.equal((await api('/api/team/Tari', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 400);
    // 4. Alur penuh staf: queued → manager-review → review → done.
    const made = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Staff post', assignee: 'Tari', brief: 'a sufficiently long brief for the mock'})})).body;
    const mr = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made.id); return t.status === 'manager-review' ? t : null; });
    assert.match(mr.result, /MOCK ORG DRAFT/);
    assert.equal((await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: mr.version})})).status, 409);
    const toOwner = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: mr.version})});
    assert.equal(toOwner.status, 200); assert.equal(toOwner.body.status, 'review');
    const done = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: toOwner.body.version})});
    assert.equal(done.body.status, 'done');
    // 5. Reject kembali ke antrean dengan feedback.
    const made2 = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Staff post 2', assignee: 'Tari', brief: 'another sufficiently long brief here'})})).body;
    const mr2 = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made2.id); return t.status === 'manager-review' ? t : null; });
    const rej = await api(`/api/tasks/${made2.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-reject', feedback: 'shorten it', version: mr2.version})});
    assert.equal(rej.body.status, 'queued'); assert.equal(rej.body.feedback, 'shorten it');
    // 6. Owner langsung ke review (tanpa manager-review).
    const made3 = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Owner post', assignee: 'Koh Arman', brief: 'owner brief long enough here'})})).body;
    const rev = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made3.id); return t.status === 'review' ? t : null; });
    assert.match(rev.result, /MOCK ORG DRAFT/);
    // 7. Rename manager cascade ke bawahan.
    assert.equal((await api('/api/team/Kak%20Dewi', {method: 'PATCH', body: JSON.stringify({n: 'Kak Dewi Baru'})})).status, 200);
    assert.equal((await api('/api/team')).body.find(m => m.n === 'Tari').manager, 'Kak Dewi Baru');
    // 8. Hapus manager: bawahan ikut manager almarhum (Koh Arman).
    const del = await api('/api/team/Kak%20Dewi%20Baru', {method: 'DELETE'});
    assert.equal(del.status, 200);
    assert.equal((await api('/api/team')).body.find(m => m.n === 'Tari').manager, 'Koh Arman');
    // 9. Rantai 4 level tetap satu pintu: buat A→B→C→D, task D cukup sekali manager-approve.
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L1', initials: 'L1', gender: 'male', role: 'R1', group: 'engineering', manager: null})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L2', initials: 'L2', gender: 'male', role: 'R2', group: 'engineering', manager: 'L1'})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L3', initials: 'L3', gender: 'male', role: 'R3', group: 'engineering', manager: 'L2'})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L4', initials: 'L4', gender: 'male', role: 'R4', group: 'engineering', manager: 'L3'})});
    await api('/api/team/L4', {method: 'PATCH', body: JSON.stringify({ai: {on: true, model: 'mock-m', system: 's'}})});
    const deep = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Deep', assignee: 'L4', brief: 'deep brief long enough here'})})).body;
    const dmr = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === deep.id); return t.status === 'manager-review' ? t : null; });
    const dgo = await api(`/api/tasks/${deep.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: dmr.version})});
    assert.equal(dgo.body.status, 'review');
    console.log('PASS: org chart, cycle guard, one-gate approve, reject, rename cascade, delete reassign');
  } finally { server.kill(); await new Promise(r => mock.close(r)); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
```

Catatan: langkah 9 butuh `manager` di POST diterima (Task 2) dan `ai` toggle via PATCH (existing). `L4` AI on: `PATCH /api/team/L4 {ai:{on:true,...}}` — validateMember existing terima.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org.cjs`
Expected: FAIL — tahap mana pun yang belum diimplementasi (misal timeout `manager-review` bila Task 3 belum dikerjakan; jalankan Task 6 terakhir jadi harusnya PASS; FAIL di sini berarti ada Task 1–5 yang bolong).

- [ ] **Step 3: Fix regressions, not new code**

Bila FAIL, perbaiki Task yang bolong, bukan tambah kode di Task 6. Tambahan Review Focus yang dipetakan ke sini:
- Task `review` lama tetap approve final: buat manual via POST lalu PATCH status? Tidak bisa user-set `review` (guard 409). Uji via import: `POST /api/tasks/import` dengan `[{title, assignee, status:'review', result:'old', createdAt}]` lalu `approve` → 200 `done`. Tambah sebagai langkah 10 bila langkah 1–9 hijau.
- `manager` ke nama terhapus (race): PATCH manager ke nama yang baru di-DELETE → 400 `Unknown manager`. Tambah langkah 11.
- Draft `manager-review` yang manager-nya dihapus sebelum approve: DELETE manager + reassign bawahan, lalu `manager-approve` tetap 200 (local trust). Tambah langkah 12.

- [ ] **Step 4: Run full suite to verify all green**

Run: `node tests/org.cjs && node tests/team.cjs && node tests/worker-reliability.cjs`
Expected: tiga PASS berurutan.

Run: `node --check server/server.js && node --check server/team.js && node --check public/tasks.js && node --check public/office.js && echo OK`
Expected: `OK`

Browser suite (`server.cjs`, `decisions.cjs`, `office.cjs`, `building-view.cjs`) butuh playwright+chromium; bila tidak ada, catat skip + alasan di ledger, jangan FAIL-kan task.

- [ ] **Step 5: Commit**

```bash
git add tests/org.cjs server/server.js server/team.js public/tasks.js public/index.html public/office.js docs/superpowers/specs/2026-10-03-org-approve-design.md
git commit -m "feat: org chart with one-gate manager approve"
```

Sebelum commit, update spec status line 3 menjadi: `Status: implemented <YYYY-MM-DD> (branch <name>). Spec 2 (thread), Spec 3 (rooms), Spec 4 (kanban) open.`

---

## Self-Review

1. **Spec coverage:** `manager` field + validasi + anti-siklus → Task 1+2. Rename cascade manager → Task 2. Hapus + reassign bawahan → Task 2. `manager-review` worker routing → Task 3. `manager-approve`/`manager-reject` + guard → Task 3. `approve` final → Task 3. Handoff log+bubble → Task 4. Template AI per level → Task 1 (`defaultSystem(role, isManager)`) + dipakai saat `POST/PATCH ai` tanpa system (validateMember existing panggil `defaultSystem(..., false)` — GAP: anggota baru yang langsung AI + manager tidak dapat template manager. FIX: di Task 2, saat validate `ai` tanpa system, panggil `defaultSystem(role, <manager!=null>)`. Tambahkan explicit di Task 2 Step 3: ganti `defaultSystem` call di `validateMember`? `validateMember` tidak tahu manager final. Solusi: di route POST/PATCH server.js setelah validasi, bila `body.ai && !body.ai.system?.trim()` set `v.member.ai.system = team.defaultSystem(v.member.role || member.role, (body.manager ?? member.manager ?? v.member.manager ?? null) !== null)`. Tulis ini di Task 2 implementasi.) Chain UI + tombol → Task 5. Uji org.cjs → Task 6.
2. **Placeholder scan:** tidak ada TBD/TODO; semua langkah ada kode + run + expected. Path `/tmp/org-*.cjs` scratch, permanen di `tests/org.cjs`.
3. **Type consistency:** `manager: string|null` konsisten team.js ↔ server ↔ tasks.js `chainFor`. `chain: string[]` di `/api/agents` cocok dengan `managerChain` return. `managerReviewedAt` hanya tulis, tidak dibaca — konsisten (audit field). Action names `manager-approve`/`manager-reject` sama di server + tasks.js + test.
4. **Review Focus:** lima baris terpetakan ke Task 6 langkah 9–12 + Task 3 test. Empty section tidak ada.
