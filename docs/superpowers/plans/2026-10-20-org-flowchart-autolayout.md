# Org Flowchart + Wizard + Auto Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the list-style Organization drawer with a drag-and-drop flowchart (option B) plus side panels, make a real 7-step wizard appear, and derive the 3D work floors and desks from the organization, adding work floors automatically.

**Architecture:**
- Pure org logic (member moves, chart layout, seating plan) lives in a new UMD file, `public/org-model.js`. Both the browser and the Node tests load it.
- Two new browser modules render UI on top of it:
  - `public/org-chart.js`: canvas, panels, drag;
  - `public/org-wizard.js`: wizard and reset dialog.
- `tasks.js` keeps data/API ownership and calls them.
- The server only gains:
  - normalization for `areaName`/`color`;
  - a busy-member guard;
  - a bulk task reassign endpoint.
- `office.js` turns its single hardcoded Workspace floor into N generated work floors from `OrgModel.planSeating`, with the rooftop at level `3+N`.

**Tech Stack:** Vanilla JS/HTML/CSS, Three.js r128 (CDN), Node 22 server, tests in `node:assert` + Playwright `.cjs`.

**Spec:** `docs/superpowers/specs/2026-10-20-org-flowchart-autolayout-design.md` (parent: `docs/superpowers/specs/2026-10-18-nav-org-rework-design.md`).

## Global Constraints

- UI copy is Indonesian, with no i18n layer.
- No new npm/CDN dependencies. The chart is plain DOM plus an SVG overlay for lines.
- Do not commit unless the user asks. "Commit" steps in this plan are skipped and recorded in the ledger instead.
- Test servers use ports ≥ 43000 (ports 4173/4181/4185 are refused here). Each test spawns its own server with a temp `DATA_DIR`.
- Owner-only writes still require `x-kantor-org` and recover through `recoverOrgLock()`.
- Floor capacity:
  - 4 division areas per work floor;
  - 8 seats per area;
  - a division with more than 8 active members takes multiple areas, the extra ones labelled `<area> (lanjutan)`.
- Extra work floors contain only the shell, stairs, 4 desk areas and plants. The task board, meeting room, phone booths and pantry stay on work floor 1.
- Moving a person to another division:
  - by default, their reports stay and are re-pointed to the mover's old manager;
  - with "Pindahkan beserta timnya", the whole subtree moves;
  - if the mover was the lead, the old division's new lead is the mover's first direct report (with a warning); if they have none, the lead is empty and saving is blocked.
- Wizard template on "Susun ulang" replaces everything after a warning. Saving is blocked while someone being removed still has open tasks, until they are reassigned ("Pindahkan tugas ke…").
- Saved Tata ruang furniture follows the floor role (`lobby`, `dining`, `work-1`..`work-N`, `roof`). Items that collide with generated desks are hidden, not deleted.
- Division palette, in order: `#2f4a6b`, `#b4623a`, `#3f7a58`, `#74598c`, `#a8842c`, `#2e7d8c`, `#b0455e`, `#5d6b2f`.

## Review Focus

1. **Org with 0 divisions or only empty divisions** (template "Mulai kosong"): the chart shows an empty-state CTA, `planSeating` returns 1 empty work floor, and the 3D still loads. Pinned in Task 2 (`planSeating({divisions:[],members:[]})`) and Task 5.
2. **Drag a card onto itself or onto its own descendant**: nothing changes and the card shows "Tidak bisa: membuat siklus" without a server round-trip. Pinned in Task 2 (`moveMember` cycle) and Task 3.
3. **Shrinking from 2 work floors to 1 while someone stands on work floor 2 or in the stairs**: that agent is moved to their new desk and the camera's active floor clamps to an existing level. Pinned in Task 5.
4. **Concurrent edit (version conflict 409) after a drag**: the chart reloads `orgState` and shows "Organisasi berubah di tab lain, dimuat ulang." Pinned in Task 3.
5. **Division name containing HTML or very long names (120 chars)**: the text is escaped (`textContent`) and ellipsized in the box header and 3D sign without breaking the layout. Pinned in Task 3 and Task 5.

---

### Task 1: Server — division fields, busy guard, bulk reassign

**Files:**
- Modify: `server/org.js`
  - `normalize`: add `areaName`, `color`;
  - export `PALETTE`.
- Modify: `server/server.js`
  - PUT `/api/org` and POST `/api/org/wizard`: busy guard;
  - new route `POST /api/tasks/reassign`.
- Test: `tests/org-fields.cjs` (new)

**Interfaces:**
- Produces:
  - `divisions[].areaName: string` (≤120 chars, default `''`).
  - `divisions[].color: string`: `#rrggbb`. An invalid or missing value is filled with `PALETTE[index % 8]`.
  - Error `409 {code:'ORG_MEMBER_BUSY', error, tasks:[{id,title,assignee,status}]}`. Returned when a save removes a member, or sets them `active:false`, while that member has tasks whose status is not `done`.
  - `POST /api/tasks/reassign {from, to}`:
    - requires the owner token;
    - moves every non-`done` task with `assignee===from` to `to`;
    - each moved task gets `status:'queued'` (unless it is `review`, which stays `review`) and `division` = the division of `to`;
    - returns `200 {moved:n}`;
    - `400` if `to` is unknown or inactive.

- [ ] **Step 1: Write the failing test** `tests/org-fields.cjs`. Spawn the server on port 43301 with `DRY_RUN_DELAY_MS:'60000'` so tasks stay queued, unlock with PIN `2468`, then:

```js
const org=(await get('/api/org')).body;
assert.equal(org.divisions[0].areaName,'');assert.match(org.divisions[0].color,/^#[0-9a-f]{6}$/);
const put1=await put('/api/org',{...org,divisions:org.divisions.map((d,i)=>i===1?{...d,areaName:'Pojok Marketing',color:'#123456'}:d)});
assert.equal(put1.status,200);assert.equal(put1.body.divisions[1].areaName,'Pojok Marketing');assert.equal(put1.body.divisions[1].color,'#123456');
const t=await post('/api/tasks',{title:'x',assignee:'Kak Dewi',division:'marketing',parentId:root.id,brief:'b'},owner); // root = lead task to Kak Rani
const busy=await put('/api/org',{...put1.body,members:put1.body.members.map(m=>m.name==='Kak Dewi'?{...m,active:false}:m)});
assert.equal(busy.status,409);assert.equal(busy.body.code,'ORG_MEMBER_BUSY');assert.deepEqual(busy.body.tasks.map(x=>x.id),[t.body.id]);
const moved=await post('/api/tasks/reassign',{from:'Kak Dewi',to:'Mira'},owner);assert.equal(moved.status,200);assert.equal(moved.body.moved,1);
assert.equal((await put('/api/org',{...put1.body,members:put1.body.members.map(m=>m.name==='Kak Dewi'?{...m,active:false}:m)})).status,200);
assert.equal((await post('/api/tasks/reassign',{from:'Mira',to:'Nobody'},owner)).status,400);
assert.equal((await post('/api/tasks/reassign',{from:'Mira',to:'Kak Dewi'})).status,403);
```

- [ ] **Step 2: Run it.** `node tests/org-fields.cjs` → Expected: FAIL on `areaName` being `undefined`.
- [ ] **Step 3: Implement.**
  - In `server/org.js` `normalize`: add `areaName:text(item.areaName,LIMITS.name)` and `color:/^#[0-9a-f]{6}$/i.test(item.color)?item.color.toLowerCase():PALETTE[i%PALETTE.length]`.
  - In `server/server.js`, add `busyMembers(next)`, which compares `org.state.members` against `next.members` and runs before `org.save` in both PUT routes.
  - Add the reassign route next to the other `/api/tasks` routes. It uses `org.verifyToken` and `save()`.
- [ ] **Step 4: Run** `node tests/org-fields.cjs` → PASS. Also run `node tests/org-v2.cjs && node tests/org-api-v2.cjs && node tests/org-tasks.cjs` → all PASS.

### Task 2: `public/org-model.js` — pure org logic

**Files:**
- Create: `public/org-model.js` (UMD: `window.OrgModel` in the browser, `module.exports` in Node)
- Modify: `public/index.html` (add `<script src="org-model.js"></script>` before `tasks.js`)
- Test: `tests/org-model.cjs` (new, pure Node)

**Interfaces:**
- Produces (every function is pure and returns a new state; it never mutates its input):
  - `leadershipId(state) -> string|null`: the first division (in data order) whose lead has `manager===null`.
  - `moveMember(state, name, {manager?, division?, withTeam?=false}) -> {state, warnings:string[], error?:string}`. Rules:
    - Setting `manager` to the member itself or to one of its descendants returns `error:'Tidak bisa: membuat siklus'`.
    - When `division` changes and `withTeam` is false: the mover's direct reports get `manager = mover's old manager`.
    - When `division` changes and `withTeam` is true: every descendant gets the new division.
    - If the mover was the lead of the old division: the new lead is the first direct report that stays behind, with the warning `"<old lead> bukan lagi lead <division>; <new> jadi lead."`. If no report stays behind, the lead is `''` with the warning `"<division> belum punya lead."`.
    - If only `division` is given, `manager` = the lead of the target division (or `null` if the mover is going to lead an empty division).
  - `toggleCollaboration(state, fromId, toId) -> state`: toggles `toId` in `from.collaboratesWith`. Ignores `fromId===toId`.
  - `addDivision(state, name) -> state`: `id` = slug of the name (`-2`, `-3` suffix on collision), lead `''`, color = next palette entry.
  - `removeDivision(state, id) -> {state, error?}`: returns `error:'Pindahkan semua anggota dulu.'` while the division still has members.
  - `moveAllMembers(state, fromId, toId) -> state`: every member of `fromId` gets `division=toId` and `manager = lead of toId`.
  - `chartLayout(state) -> {nodes:[{name,x,y}], boxes:[{id,x,y,w,h}], width, height}`. Layout:
    - top-down tree;
    - card size 150×52, horizontal gap 16, vertical gap 40, box padding 12 plus a 22 px header;
    - the leadership division sits on the top row, the other divisions side by side below it in data order;
    - inside each box, the lead is on top and members follow the manager tree;
    - members whose manager is outside the box hang under the box's lead.
  - `planSeating(state) -> {floors:[{level:'work-1', areas:[{divisionId, label, color, slot:0..3, seats:[name,…≤8]}]}]}`. Rules:
    - active members only;
    - leadership division first, then data order;
    - lead first, then tree order;
    - each chunk of 8 is one area, the 2nd and later chunks labelled `"<areaName||name> (lanjutan)"`;
    - fill 4 slots per floor, then start a new floor;
    - always return at least 1 floor.
  - `PALETTE`: the same 8 colors as the server.

- [ ] **Step 1: Write the failing test** `tests/org-model.cjs`. Build fixtures from `require('../server/org.js').seed()`.

```js
const M=require('../public/org-model.js');const s=seed();
assert.equal(M.leadershipId(s),'leadership');
assert.equal(M.moveMember(s,'Koh Arman',{manager:'Bagas Pratama Putra'}).error,'Tidak bisa: membuat siklus');
const r1=M.moveMember(s,'Koh Wira',{division:'marketing'});           // Wira leads engineering, reports stay
assert.equal(r1.state.members.find(m=>m.name==='Rizky Hakim').manager,'Koh Arman');
assert.equal(r1.state.divisions.find(d=>d.id==='engineering').lead,'Bagas Pratama Putra');assert.equal(r1.warnings.length,1);
const r2=M.moveMember(s,'Koh Wira',{division:'marketing',withTeam:true});
assert.ok(r2.state.members.filter(m=>m.manager==='Koh Wira').every(m=>m.division==='marketing'));
assert.equal(r2.state.divisions.find(d=>d.id==='engineering').lead,'');
assert.deepEqual(s.members.find(m=>m.name==='Koh Wira').division,'engineering','input not mutated');
assert.equal(M.removeDivision(s,'service').error,'Pindahkan semua anggota dulu.');
assert.ok(!M.removeDivision(M.moveAllMembers(s,'service','marketing'),'service').error);
const big={...s,members:[...s.members,...Array.from({length:20},(_,i)=>({name:`P${i}`,initials:'P',role:'r',division:'marketing',manager:'Kak Rani',active:true}))]};
const plan=M.planSeating(big);assert.equal(plan.floors.length,2);
assert.deepEqual(plan.floors[0].areas.map(a=>a.divisionId),['leadership','marketing','marketing','marketing']);
assert.equal(plan.floors[0].areas[2].label,'Marketing (lanjutan)');assert.ok(plan.floors.flatMap(f=>f.areas).every(a=>a.seats.length<=8));
assert.equal(M.planSeating({divisions:[],members:[]}).floors.length,1);
const L=M.chartLayout(s);const boxes=L.boxes;for(const a of boxes)for(const b of boxes)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'boxes overlap');
```

- [ ] **Step 2: Run** `node tests/org-model.cjs` → Expected: FAIL with `Cannot find module '../public/org-model.js'`.
- [ ] **Step 3: Implement** `public/org-model.js` with the signatures above. Wrap it in `(function(root,factory){typeof module==='object'?module.exports=factory():root.OrgModel=factory()})(this,()=>{…})`.
- [ ] **Step 4: Run** `node tests/org-model.cjs` → PASS.

### Task 3: Flowchart editor in the Organization drawer

**Files:**
- Create: `public/org-chart.js` (exports `window.OrgChart = {mount(container, api)}`)
- Modify:
  - `public/tasks.js` `renderOrg`: delete the old wizard/tree/member-form/add-form markup and call `OrgChart.mount(el('orgPanel'), api)`. Keep `#orgResetHint` out of the drawer; it moves into the `⋯` menu as text.
  - `public/index.html`: give `#orgDialog` the class `drawer drawer-wide`, and load `org-chart.js` after `org-model.js`.
  - `public/tasks.css`: chart styles. The `.drawer-wide` width is `calc(100vw - var(--rail-w) - 48px)`. Below 640px the panel becomes a bottom sheet.
- Update tests to the new DOM: `tests/org-editor.cjs`, `tests/org-owner.cjs`, `tests/org-offline.cjs`, `tests/nav.cjs`, `tests/nav-hardening.cjs`.
- Test: `tests/org-chart.cjs` (new, Playwright, port 43302)

**Interfaces:**
- Consumes: the `OrgModel.*` functions from Task 2; the Task 1 endpoints and `ORG_MEMBER_BUSY`.
- `api` passed by `tasks.js`, all functions:

  | Function | Returns |
  |---|---|
  | `getState()` | `orgState` |
  | `save(next)` | the saved state; throws on error |
  | `reassign(from, to)` | |
  | `isUnlocked()` | `bool` |
  | `unlock()` | `Promise<bool>` (calls `unlockFlow`) |
  | `feedback(text)` | |
  | `tasksFor(name)` | open tasks |
  | `openWizard(mode)` | `mode` is `'edit'` |
  | `openReset()` | |
  | `sendRosterReview(divisionId)` | |

- Required DOM ids/attributes (tests depend on them):
  - toolbar buttons: `#orgAddPerson`, `#orgAddDivision`, `#orgConnect`, `#orgTidy`, `#orgZoomIn`, `#orgZoomOut`, `#orgRearrange`, `#orgMore`;
  - `#orgCanvas` (viewport), `#orgStage` (scaled content), `svg#orgLines`;
  - cards: `.org-card[data-member]`, which can carry `.is-lead`, `.is-ai`, `.is-inactive`, `.is-selected`;
  - division boxes: `.org-box[data-division]`, with a header button `.org-box-title`;
  - collaboration lines: `path.org-collab`;
  - side panel `#orgSide`, with tabs `[role=tab]` named `Profil`, `Kerja`, `AI` and a single submit button `#orgSideSave`.
- Saves:
  - Every edit (panel save, drag drop, connect click) calls `api.save`. On `409` without a code, it reloads state and shows `"Organisasi berubah di tab lain, dimuat ulang."`.
  - On `ORG_MEMBER_BUSY`, the panel lists the tasks with a select plus a `Pindahkan semua ke…` button (`#orgReassign`), which calls `api.reassign` and then retries.
- Drag: pointer events on `.org-card`.
  - Dropping on another card calls `moveMember({manager:target, division:target.division})`.
  - Dropping on an empty area of `.org-box` calls `moveMember({division})`.
  - A cycle error is shown as `.org-card-error` text on the dragged card for 3s.
  - A drag with less than 4px of movement counts as a click.
  - Panel field `#orgMoveWithTeam` (checkbox) feeds `withTeam` when the division select changes.
- Division panel (opened by clicking `.org-box-title` or right after `#orgAddDivision`): fields `#orgSideName`, `#orgSideArea` (areaName), `#orgSideLead`, collaboration checkboxes `input[name=collab]`, color swatches from `PALETTE`. Buttons: `Kirim review roster` and `Hapus divisi`. When a delete is blocked, the panel shows a select plus `Pindahkan semua anggota ke…`, which calls `moveAllMembers`. When a division has an empty lead, the box shows a red "Belum ada lead" and Save is blocked.
- Person panel secondary buttons: `Nonaktifkan`/`Aktifkan`. The AI tab holds the checkbox `#orgSideAgent`, the model input `#orgSideModel` and the instructions `#orgSideInstructions`. The Kerja tab holds `#orgSideEffort` and `#orgSideWorkload`.
- Locked state: when `!api.isUnlocked()`, a drag or save calls `api.unlock()` first and aborts if it resolves `false`.

- [ ] **Step 1: Write the failing test** `tests/org-chart.cjs`. Set the viewport to 1440×900, unlock via `#bLock` + PIN `2468`, then open `#bOrg`.

```js
await p.waitForSelector('.org-box[data-division="engineering"] .org-card[data-member="Koh Wira"].is-lead');
assert.equal(await p.locator('.org-card').count(),13);assert.equal(await p.locator('#orgPanel .org-member-editor').count(),0,'old per-member forms gone');
// boxes do not overlap
const rects=await p.$$eval('.org-box',bs=>bs.map(b=>b.getBoundingClientRect().toJSON()));/* pairwise non-overlap assert */
await p.click('.org-card[data-member="Kak Dewi"]');await p.getByRole('tab',{name:'Kerja'}).click();await p.fill('#orgSideWorkload','60');await p.click('#orgSideSave');
await p.waitForFunction(()=>window.officeTasks.state().members.find(m=>m.name==='Kak Dewi').workloadPct===60);
await dragTo(p,'.org-card[data-member="Tari"]','.org-card[data-member="Gilang"]');   // mouse.down/move/up helper
await p.waitForFunction(()=>{const t=window.officeTasks.state().members.find(m=>m.name==='Tari');return t.manager==='Gilang'&&t.division==='service';});
await dragTo(p,'.org-card[data-member="Koh Arman"]','.org-card[data-member="Bagas Pratama Putra"]');
await p.waitForSelector('.org-card[data-member="Koh Arman"] .org-card-error');
await p.click('#orgConnect');await p.click('.org-box[data-division="marketing"] .org-box-title');await p.click('.org-box[data-division="service"] .org-box-title');
await p.waitForSelector('path.org-collab');
await p.click('#orgAddDivision');await p.fill('#orgSideName','<b>Riset</b>');await p.click('#orgSideSave');
assert.equal(await p.locator('.org-box-title b').count(),0,'name escaped');
// 409 path: bump version from another "tab"
await p.evaluate(()=>fetch('/api/org',{method:'PUT',headers:{'content-type':'application/json','x-kantor-csrf':window.officeTasks.csrf(),'x-kantor-org':sessionStorage.getItem('kantor-ai.orgToken')},body:JSON.stringify(window.officeTasks.state())}));
await p.click('.org-card[data-member="Mira"]');await p.click('#orgSideSave');await p.waitForFunction(()=>document.querySelector('#orgPanel').textContent.includes('dimuat ulang'));
```

  `officeTasks.state()` and `officeTasks.csrf()` are new read-only getters added to `tasks.js` in this task.
- [ ] **Step 2: Run** `node tests/org-chart.cjs` → Expected: FAIL waiting for `.org-box`.
- [ ] **Step 3: Implement** `public/org-chart.js`, the `tasks.js` wiring and the CSS. Positions come from `OrgModel.chartLayout`, applied as absolute `left/top` inside `#orgStage`. Lines are SVG paths (elbow connectors) from each card's bottom-center to its reports' top-center. Zoom uses `transform: scale()` on `#orgStage` with steps 0.5–1.5. `#orgTidy` resets scroll and zoom to 1.
- [ ] **Step 4: Run** `node tests/org-chart.cjs` → PASS. Then update the 5 legacy tests' selectors and run `node tests/org-editor.cjs && node tests/org-owner.cjs && node tests/org-offline.cjs && node tests/nav.cjs && node tests/nav-hardening.cjs` → all PASS.
- [ ] **Step 5: Visual check.** Take a Playwright screenshot at 1440×900 and 390×844 into `.superpowers/shots/org-chart-*.png` and read them. Expected: no overlapping text, distinct colored boxes, panel on the right (or bottom sheet on mobile).

### Task 4: Wizard + reset dialog

**Files:**
- Create: `public/org-wizard.js` (`window.OrgWizard = {open(mode, api)}`, where `mode` is `'first-run'|'edit'|'after-reset'`)
- Modify:
  - `public/index.html`: add `<dialog id="wizardDialog" class="wizard">` (modal, `showModal`) and `<dialog id="resetDialog">`.
  - `public/tasks.js`:
    - in `connect()`: if `orgState.configured===false`, call `OrgWizard.open('first-run', api)`;
    - expose `api.openWizard` and `api.openReset`;
    - delete the old `prompt()` reset.
  - `public/tasks.css`: wizard styles.
- Test: rewrite `tests/org-wizard.cjs` (port 43290 stays).

**Interfaces:**
- Consumes:
  - `/api/org/templates`, `/api/org/wizard`, `/api/org/reset`, `/api/tasks/reassign`;
  - `OrgModel.addDivision`, `moveMember`, `planSeating`;
  - `officeScene.applyOrg` from Task 5, called through `api.applied(state)`. Until Task 5 lands it is a no-op guard: `window.officeScene?.applyOrg?.(state)`.
- DOM:
  - steps are `#wizardDialog [data-step]`, with values `pin`, `company`, `template`, `divisions`, `people`, `agents`, `summary`;
  - navigation buttons `#wizardBack`, `#wizardNext`, `#wizardSave`;
  - step indicator `ol.wizard-steps li[aria-current=step]`.
- Behaviour:
  - The draft lives in memory across steps.
  - **Step `pin`:** skipped if already unlocked. Otherwise it creates or unlocks the PIN with the existing unlock call.
  - **Step `template`:** options come from `/api/org/templates` plus "Pertahankan struktur saat ini" (default in `edit` mode). In `edit` mode, picking a template shows `#wizardReplaceWarning`: "Template akan mengganti semua divisi dan orang."
  - **Step `divisions`:** rows of name, lead (select from the draft's people, or "(pilih nanti)"), collaboration checkboxes, `+ Divisi`.
  - **Step `people`:** rows of name, role, division, manager, `+ Orang`.
  - **Step `agents`:** an AI checkbox per person, plus a model text input (optional).
  - **Step `summary`:** a mini list of divisions → people, and `#wizardFloorPlan`, which renders `planSeating(draft)` as `"Lantai kerja 1: Leadership (2), Engineering (6)"`, one line per floor.
  - **Save:** POST `/api/org/wizard`.
    - On `ORG_MEMBER_BUSY`, show `#wizardReassign` (per busy member, a select of draft people and a "Pindahkan tugas ke…" button) and block Save until every busy member is handled.
    - On success: close the wizard, `renderOrg()`, `api.applied(state)`.
  - **Reset dialog `#resetDialog`:**
    - fields `#resetPin`, `#resetConfirm` (must equal `RESET`), and a red submit `#resetSubmit` that stays disabled until both are valid;
    - on success, show `#resetArchive`, a link `<a download>` to a Blob of the archived tasks (the server returns `archiveFile`; add `GET /api/org/archive/:name`, owner token, to serve only files inside `data/archive`);
    - then open the wizard in `after-reset` mode.

- [ ] **Step 1: Write the failing test** `tests/org-wizard.cjs`. Use a fresh `DATA_DIR` with no `org.json` and no PIN.

```js
await p.goto(origin);await p.waitForSelector('#wizardDialog[open] [data-step="pin"]');            // auto-opens on first run
await p.fill('#wizardPin','2468');await p.click('#wizardNext');
await p.fill('#wizardCompanyName','Toko Maju');await p.selectOption('#wizardCompanyType','Toko & retail');await p.click('#wizardNext');
await p.click('label:has-text("Mulai kosong")');await p.click('#wizardNext');
await p.click('#wizardAddDivision');await p.fill('[data-step="divisions"] input[name="name"] >> nth=0','Gudang');await p.click('#wizardNext');
for(const [n,r] of [['Andi','Kepala Gudang'],['Budi','Staf']]){await p.click('#wizardAddPerson');/* fill last row name/role/division=gudang, manager Andi for Budi */}
await p.click('#wizardBack');await p.selectOption('[data-step="divisions"] select[name="lead"] >> nth=0','Andi');await p.click('#wizardNext');await p.click('#wizardNext');
await p.check('[data-step="agents"] input[data-member="Budi"]');await p.click('#wizardNext');
assert.match(await p.locator('#wizardFloorPlan').innerText(),/Lantai kerja 1: Gudang \(2\)/);
await p.click('#wizardSave');await p.waitForFunction(()=>!document.querySelector('#wizardDialog').open);
const saved=await p.evaluate(()=>window.officeTasks.state());assert.equal(saved.company.name,'Toko Maju');assert.equal(saved.members.find(m=>m.name==='Budi').isAgent,true);
// reset dialog, no prompt()
let prompted=false;p.on('dialog',d=>{prompted=true;d.dismiss();});
await p.click('#bOrg');await p.click('#orgMore');await p.click('text=Setel ulang total');
assert.ok(await p.locator('#resetSubmit').isDisabled());await p.fill('#resetPin','2468');await p.fill('#resetConfirm','RESET');await p.click('#resetSubmit');
await p.waitForSelector('#resetArchive a[download]');await p.waitForSelector('#wizardDialog[open]');assert.equal(prompted,false);
```

- [ ] **Step 2: Run** `node tests/org-wizard.cjs` → Expected: FAIL waiting for `#wizardDialog[open]`.
- [ ] **Step 3: Implement** `org-wizard.js`, the dialogs, the `tasks.js` wiring and the archive route.
- [ ] **Step 4: Run** `node tests/org-wizard.cjs` → PASS. Also run `node tests/org-api-v2.cjs` → PASS (the reset API is unchanged apart from the new archive route).

### Task 5: 3D — generated work floors from the org

**Files:**
- Modify: `public/office.js`
  - **Floor model:** replace `FLOOR` with `floorRoles`, an array built from the plan:
    `[{level:1,role:'lobby'},{level:2,role:'dining'},{level:3,role:'work-1'},…,{level:2+N,role:'work-N'},{level:3+N,role:'roof'}]`.
    Keep the 1/2 names and add the names `Lantai kerja k` (or `Workspace` when N=1) and `Rooftop`.
  - **Replace hardcoded `4`:**
    - every `===4` / `floor:4` / `<=4` / `floorY(4)` / `[1,2,3,4]` / `moveTeam(4)` / `setFloor(...,4)` uses `ROOF()` (= `3+N`) or `LEVELS()`;
    - every `===3`, `floors[3]` and `passage(3)` that means "the agent's work floor" uses `agent.desk.floor`;
    - meanwhile the meeting room, task board, pantry and lounges stay on level 3.
  - **Desk areas:** extract `buildDeskArea(level, slot, area)` from the GROUPS loop at lines 361–379. Slot positions are the current GROUPS coordinates: slot 0 `(-5.5,-3.5)`, 1 `(5.5,-3.5)`, 2 `(-5.5,6.5)`, 3 `(5.5,6.5)`. Each area gets:
    - the rug, tinted from `area.color` mixed 55% with `0xf1ece1`;
    - the table, sized to `area.seats.length` (2 cols × up to 4 rows);
    - chairs in the area color;
    - its sign, `area.label.toUpperCase()`;
    - pendants.
    It returns `{items:[...], seats:{name:spot}}`.
  - **Extra floors:** `buildExtraWorkFloor(level)` = `shell(level)` plus 4 corner plants. Nothing else.
  - **`applyOrg(state)`:**
    - computes `OrgModel.planSeating(state)`;
    - removes the previous generated desk items (tracked in `deskItems`, unregistered from `customItems`);
    - adds or removes extra floor groups, stairways and facade levels so they match N, and moves the rooftop group to `floorY(ROOF())`;
    - rebuilds nav grids for the work floors;
    - creates `character()` for new members (gender `'nonbinary'`, shirt = division color);
    - hides agents that are removed or inactive (`removeRosterMember`);
    - reassigns `agent.desk` for every agent:
      - an agent on a floor that no longer exists, or in `state==='stairs'`, is teleported to its desk;
      - other agents get `setPath(agent, agent.desk)`;
    - clamps `activeFloor` to `≤ ROOF()`;
    - regenerates the floor buttons in `#floors` (the same markup, numbered `FL.0k`).
  - **`TEAM`/`GROUPS`:**
    - The seed list stays only for the offline fallback.
    - `group` on an agent becomes the `divisionId`.
    - `GROUPS[x]` lookups (lines 937, 1121, 1194, 1426, 1492, 2011) read `divisionMeta(id)`, which returns `{name, color, x}` from the current plan, falling back to the seed GROUPS.
  - **Startup:** office.js waits for `window.officeTasks.ready` (a new promise in `tasks.js` that resolves with `orgState` after `connect()`, or with the fallback after 3s). It then builds from that state.
  - **`officeScene` API:**
    - add `applyOrg(state) -> {floors:N, seated:n}` and `floorRoles() -> [{level,role,name}]`;
    - `syncRoster(roster)` now delegates to `applyOrg({...officeTasks.state(), members:roster})`;
    - keep `removeRosterMember`.
- Modify: `public/tasks.js`
  - add the `ready` promise;
  - after every successful org save/wizard/reset, call `window.officeScene?.applyOrg?.(orgState)`.
- Modify: `public/index.html`: the floor buttons become generated. Keep the `#floors` container and the `data-floor="0"` building button.
- Test: `tests/org-autolayout.cjs` (new, Playwright, port 43303). Also rerun `tests/org-seating.cjs` and update its assertion to `result.assigned.includes('Nina')`.

- [ ] **Step 1: Write the failing test** `tests/org-autolayout.cjs`.

```js
await p.waitForFunction(()=>window.officeScene?.floorRoles);
assert.deepEqual((await p.evaluate(()=>officeScene.floorRoles())).map(f=>f.role),['lobby','dining','work-1','roof']);
// add 20 marketing people through the API as owner, then apply
const many=await p.evaluate(async()=>{const s=officeTasks.state();const next={...s,members:[...s.members,...Array.from({length:20},(_,i)=>({name:`Staf ${i}`,initials:`S${i}`,role:'Staf',division:'marketing',manager:'Kak Rani',active:true}))]};return officeScene.applyOrg(next);});
assert.equal(many.floors,2);
assert.deepEqual((await p.evaluate(()=>officeScene.floorRoles())).map(f=>f.role),['lobby','dining','work-1','work-2','roof']);
const snap=await p.evaluate(()=>officeScene.snapshot());
assert.ok(snap.team.some(a=>a.name==='Staf 19'&&a.floor===4),'overflow seated on work-2');
assert.equal(await p.locator('#floors [data-floor="5"]').count(),1,'rooftop button moved to level 5');
await p.click('#bRoof');                               // moments → rooftop goes to level 5 now
await p.waitForFunction(()=>officeScene.snapshot().team.some(a=>a.floor===5),null,{timeout:30000});
// shrink back while people are upstairs / on work-2
await p.evaluate(()=>officeScene.applyOrg(officeTasks.state()));
assert.deepEqual((await p.evaluate(()=>officeScene.floorRoles())).map(f=>f.role),['lobby','dining','work-1','roof']);
assert.ok((await p.evaluate(()=>officeScene.snapshot())).team.every(a=>a.floor<=4));
assert.ok((await p.evaluate(()=>officeScene.snapshot())).floor<=4,'active floor clamped');
// renamed area shows on the sign: rename via applyOrg with areaName, check the sign text registry
await p.evaluate(()=>{const s=officeTasks.state();return officeScene.applyOrg({...s,divisions:s.divisions.map(d=>d.id==='service'?{...d,areaName:'Pojok CS'}:d)});});
assert.ok((await p.evaluate(()=>officeScene.signs())).includes('POJOK CS'));
assert.deepEqual(errors,[]);
```

  `officeScene.signs()` is a new debug getter that returns the generated area sign texts.
- [ ] **Step 2: Run** `node tests/org-autolayout.cjs` → Expected: FAIL, `officeScene.floorRoles` not a function.
- [ ] **Step 3: Implement.** Work in this order, running the test after each:
  1. `floorRoles`/`ROOF()` replacing every hardcoded `4`;
  2. `buildDeskArea` extraction, with the seed state still rendering identically;
  3. `applyOrg` growth and shrink;
  4. new characters;
  5. signs and colors;
  6. the `ready` promise.
- [ ] **Step 4: Run** `node tests/org-autolayout.cjs && node tests/org-seating.cjs && node tests/decisions.cjs` (with `TEST_PORT=43304`) → all PASS.
- [ ] **Step 5: Visual check.** Take screenshots of the building view and of work floor 2 with 33 people, into `.superpowers/shots/autolayout-*.png`, and read them. Expected: the rooftop sits on top, the extra floor has 4 colored areas with readable signs, and no person stands inside furniture.

### Task 6: Tata ruang slots keyed by floor role

**Files:**
- Modify: `public/office.js`
  - `CUSTOM_KEY` becomes `'kantor-ai.layouts.v2'`;
  - slot entries become `{[itemId]:{role,x,z,rot}}`;
  - inventory items gain a `role`.
- Test: extend `tests/org-autolayout.cjs`.

**Interfaces:**
- **Migration on load:**
  - If `v1` exists and `v2` does not, map each entry using the item's original floor: `1→lobby`, `2→dining`, `3→work-1`, `4→roof`. Write `v2` and keep `v1` untouched.
  - Inventory `items[].floor` gets the same mapping into `role`.
  - When placing, the level is resolved from the role through `floorRoles()`. If the role no longer exists (`work-3` after shrinking), the item is hidden.
- **Collision:** after `applyOrg`, any saved custom item whose radius overlaps a generated desk item on the same level is hidden (`group.visible=false`, excluded from nav and seating) and listed in `#customMsg` as `"N furnitur disembunyikan karena tertutup meja tim."`. Nothing is deleted from storage.
- Generated desk items are not selectable in Tata ruang (`unique:true, generated:true`). `selectCustom` ignores them.

- [ ] **Step 1: Write the failing test.** Append to `tests/org-autolayout.cjs`. Before `goto`, seed localStorage through `addInitScript`:
  - `kantor-ai.layouts.v1` with slot 1 = `{c_roof_lantern_id:{x:2,z:2,rot:0}}`, using the id of a rooftop lantern taken from `officeScene.customItems()` in a first page load;
  - inventory `kantor-ai.inventory.*` with a sofa on floor 3 at a desk position `(-5.5,-3.5)`.

  Then assert:
  - after growing to 2 work floors, the lantern's level is `5` (the roof);
  - the sofa is hidden (`officeScene.customItems().find(...).hidden===true`);
  - `localStorage['kantor-ai.layouts.v1']` is unchanged;
  - `v2` exists with `role:'roof'`.
- [ ] **Step 2: Run** → Expected: FAIL (the lantern is still on level 4).
- [ ] **Step 3: Implement** the migration, role resolution and hide-on-collision.
- [ ] **Step 4: Run** `node tests/org-autolayout.cjs` → PASS. Also run the inventory/customize tests with `OFFICE_URL` pointed at a dry-run server on port 43305 if they support it; otherwise ledger them as environment-blocked (ports 4173).

### Task 7: Docs + full verification

**Files:**
- Modify: `README.md`
  - replace the "Organisasi pohon dan wizard" section with flowchart editor, wizard and auto layout usage;
  - list the new tests.

- [ ] **Step 1:** Run every test file that can bind here:
  `for f in tests/*.cjs; do node "$f" || echo "FAIL $f"; done`, with output to `.superpowers/sdd/2026-10-20-org-flowchart-autolayout/suite.log`. Exclude `playwright-install.cjs`, and the fixed-4173 files that are environment-blocked (list them).
  Expected: 0 FAIL among runnable files.
- [ ] **Step 2:** Run `node --check` on every `public/*.js` and `server/*.js`, then `git diff --check`, then `graphify update .`.
- [ ] **Step 3:** Restart the live server (the user's port 3000) only after confirming the PID belongs to this worktree's earlier start. Then run a Playwright smoke test on `http://127.0.0.1:3000`: open Organisasi, check `.org-box` count ≥ 1, and take a screenshot.
