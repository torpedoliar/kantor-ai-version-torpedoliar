# Organisasi Pohon + Wizard (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ubah roster datar menjadi organisasi yang bisa disusun owner melalui pohon manager, wizard, profil perusahaan, jalur komunikasi, agen AI dinamis, dan penempatan anggota baru di kantor 3D.

**Architecture:**
- `server/org.js` menjadi sumber kebenaran schema v2, migrasi v1, validasi pohon, company profile, dan aturan kolaborasi.
- `server/server.js` memakai org graph untuk placement/escalation, menyediakan endpoint wizard/reset, dan membuat prompt agen dari roster dinamis.
- `public/tasks.js` mempertahankan drawer Organisasi tetapi mengganti roster panjang dengan wizard, profil, bagan SVG/HTML tree, dan panel edit owner-only.
- `public/office.js` tetap memakai model 3D yang ada; `officeScene.syncRoster()` menambah anggota baru ke meja kosong/hot desk tanpa merombak asset furniture.
- Tidak ada dependency baru; tree digambar dengan HTML/CSS connectors, bukan library graph.

**Tech Stack:**
- Vanilla JavaScript/HTML/CSS
- Node 22, JSON files, Node `crypto`/`fs`
- Playwright + `node:assert` tests

**Spec:** `docs/superpowers/specs/2026-10-18-nav-org-rework-design.md` §3

## Implementation Decisions (defaulted after user said “continue”)

- **Escalation answer:** the owner answers all blocked questions from the Keputusan drawer; `decisionTarget` still records the manager path for audit/display, but no simulated member gets a separate human inbox.
- **Reset:** keep the owner PIN and provider/settings configuration; archive and clear organization/tasks only. Reject reset with 409 while any AI task is `active`; the owner must wait for it to finish.
- **Member rename:** names are immutable once any task references the member. Before that, the editor may rename and the server updates the roster only.
- **First run:** seeded v1 data with no PIN is treated as first-run and opens the wizard; a configured org requires PIN plus non-empty company profile.
- **Manager scope:** regular members must have a manager in their primary division; a division lead may report cross-division to the leadership lead; `manager:null` means owner root. A chain that does not reach the division lead is a warning, not a save-blocking error, unless it creates a cycle or references an invalid/inactive person.
- **Delegator:** task payloads gain `createdBy`, defaulting to `owner`; child tasks default to the parent assignee. Server validates the recorded delegator against the graph, while the current single-owner session remains the only authenticated human.
- **Collaboration:** cross-division collaboration creates a root task assigned to the destination lead; child tasks always stay in the parent division.
- **Agent routing:** reuse existing `settings.overrides` keyed by member name; do not add duplicate provider/model fields to members.
- **New 3D members:** default gender is `nonbinary` and division color applies to the name label, marker, and shirt; existing characters keep their current appearance.

## Global Constraints

- **Schema:** `data/org.json` naik ke `schemaVersion: 2` dengan `company`, `divisions[].collaboratesWith`, dan `members[].manager/isAgent`.
- **Owner:** organisasi dan reset hanya memakai token owner dari PIN; semua error lock membawa `code: 'ORG_LOCKED'`.
- **Validation:** nama anggota unik, division/manager harus valid, manager aktif atau `null`, lead aktif, tidak boleh ada siklus manager; chain-to-lead violations are warnings exposed to the UI.
- **Migration:** v1 dibaca dan dimigrasikan otomatis; `divisions[]` ganda diringkas ke `division`, prompt lama KR/KS ditambahkan ke `instructions` tanpa menimpa instruksi existing, manager default mengikuti spec.
- **Reset safety:** tugas diarsipkan sebelum dihapus; PIN + teks `RESET` wajib; kegagalan arsip atau AI task aktif membatalkan reset.
- **UI:** bahasa Indonesia, tanpa i18n; tidak ada drag-and-drop; tidak ada chat bebas; tidak ada multi-owner.
- **Security:** API key tidak pernah dikirim ke browser atau ditulis ke org/task archive; input server divalidasi di trust boundary.
- **Compatibility:** Fase 1 rail/drawer/`officeNav` dan browser-only mode tetap berjalan.

## Review Focus

1. **Migrasi v1 dengan multi-division dan dua lead tanpa manager.** Data lama harus tetap terbaca, tidak kehilangan anggota, dan menghasilkan graph valid atau warning terarah. Test Task 1.
2. **Manager cycle, invalid manager, and cross-division exception.** PUT organisasi menolak cycle/invalid references, tetapi memperingatkan chain-to-lead violations. Test Task 1.
3. **Stale owner token saat wizard/reset/editor save.** UI menampilkan PIN dialog, tidak meninggalkan modal terbuka, dan tidak menghapus data. Test Task 2/5/6.
4. **Eskalasi agent `QUESTIONS:`.** Pertanyaan mencatat manager path dan masuk ke Keputusan owner untuk dijawab. Test Task 3.
5. **Reset saat archive gagal atau AI task aktif.** Tidak boleh ada partial reset; archive dibuat sebelum data kosong. Test Task 2/6.
6. **Anggota baru, nama rename, dan meja penuh.** Anggota muncul di roster 3D sebagai hot desk, tidak merusak posisi anggota lama, dan memberi status yang bisa dibaca. Test Task 5/7.
7. **Active-task deletion/deactivation.** Division/member removal is blocked and offers “Pindahkan semua ke…”. Test Task 2/5.
8. **Secrets.** Templates, public org state, and task archives contain no PIN hash, API key, or provider credential. Test Task 2.

---

## Compatibility and shared contracts

- `GET /api/org` includes `configured:boolean`, `warnings:[{code,message,member}]`, and `schemaVersion:2`.
- Tasks persist `createdBy` and optional `decisionTarget/decisionPath`; legacy tasks default `createdBy:'owner'`.
- `GET /api/agents` is roster-derived; `server/settings.js` no longer uses a hard-coded `AGENT_NAMES` allowlist.
- All Phase 2 UI writes use `recoverOrgLock(error)` and return focus to the active drawer after PIN unlock.
- Existing Phase 1 tests that assert dual-division/root placement are updated in Task 3 rather than silently dropped.

---

## Plan self-review notes

- Spec §3.3 deletion safety is implemented in Task 2 API + Task 5 UI.
- Spec §3.6 gender/color behavior is implemented in Task 7.
- `configured:false`, task `createdBy`, wizard version guard, reset-active-run guard, rename policy, and settings override reuse are explicit below.
- Collaboration and child-division rules are intentionally non-conflicting: collaboration is a lead-to-lead root task; children remain in their parent division.

---

### Task 1: Schema v2, migrasi, dan validasi organization graph

**Files:**
- Modify: `server/org.js`
- Create: `tests/org-v2.cjs`
- Modify: `tests/org.cjs`

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION = 2`
  - `createOrg({dataDir})` dengan `publicState()` mengembalikan `company`, `divisions[].collaboratesWith`, dan member `manager/isAgent`.
  - `normalize(input) -> OrgStateV2` migrates v1 and rejects invalid graphs.
  - `validateGraph(input) -> null | {field, message}` (dipakai API dan UI warning).
  - `divisionGraph(name) -> {manager, ancestors, children, division, lead}`.
  - `communicationPath(from, to) -> {allowed, reason, path}`.
  - `escalationTarget(memberName) -> {type:'member'|'owner', name, path}`.
- Manager default migration:
  - Leadership lead `manager:null`.
  - Non-leadership lead `manager` = leadership lead.
  - Other members `manager` = current division lead.
  - `divisions[]` lama disederhanakan ke `division` utama.
  - `company` default `{name:'Kantor Kita', type:'Lainnya', description:''}`.
  - `isAgent` true hanya untuk legacy KR/KS; `instructions` mempertahankan prompt lama dan menambahkan prompt legacy tanpa menimpa instruksi existing.

- [ ] **Step 1: Write failing tests**
  - v1 fixture migrates to schema 2 and preserves 13 members.
  - Koh Wira gets one primary division and manager according to migration rule.
  - A→B→A manager cycle returns 400 with a stable validation message.
  - Unknown manager, inactive manager, unknown collaboration division, and inactive lead return 400.
  - Valid graph round-trips through `publicState()` without `pinHash`.
- [ ] **Step 2: Run `node tests/org-v2.cjs` and verify RED** on missing schema/manager fields.
- [ ] **Step 3: Implement schema, migration, graph validation, and safe public state in `server/org.js`.** Keep v1 files readable; persist the migrated v2 state atomically on first owner save, not during a read-only GET.
- [ ] **Step 4: Run `node tests/org-v2.cjs`, `node tests/org.cjs`, `node tests/org-owner.cjs`, `node tests/org-offline.cjs`, and the current compatibility tests `node tests/org-tasks.cjs`, `node tests/org-kanban.cjs`, `node tests/org-chat.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(org): add schema v2 tree migration and validation`

### Task 2: Organization API, company profile, divisions, and owner-safe mutations

**Files:**
- Modify: `server/server.js`
- Modify: `server/org.js`
- Create: `tests/org-api-v2.cjs`

**Interfaces:**
- Produces endpoints, all requiring CSRF and owner token unless explicitly read-only:
  - `GET /api/org` → v2 public state.
  - `PUT /api/org` → full validated v2 state, optimistic `version` guard.
  - `POST /api/org/wizard` body `{draft, version}` → validates and saves a complete draft, returns public state; rejects stale `version` with 409.
  - `POST /api/org/reset` body `{pin, confirmation:'RESET', version}` → archives tasks then clears tasks/org while keeping PIN/settings, returns `{archiveFile, org}`; rejects active AI runs and archive failure without partial reset.
  - `GET /api/org/templates` → `marketing`, `software-dev`, `creative-agency`, `retail`, `example`, `empty` templates; no secrets.
  - `POST /api/org/roster-review` may remain task creation but uses new graph state.
- `archiveTasks(dataDir, tasks, timestamp) -> archivePath` writes `data/archive/tasks-<timestamp>.json` with no credentials.
- Reset is atomic at application level: archive first; only after successful archive write replace tasks/org state.

- [ ] **Step 1: Write failing API tests** for profile/template reads, wizard save, division/lead/manager/collaboration changes, reset confirmation/PIN, archive contents, archive-failure no-reset, and stale-token `ORG_LOCKED`.
- [ ] **Step 2: Run `node tests/org-api-v2.cjs` and verify RED.**
- [ ] **Step 3: Implement endpoints and archive/reset helpers.** Keep existing `/api/org/unlock` and version semantics; never return `pinHash` or provider credentials.
- [ ] **Step 4: Run `node tests/org-api-v2.cjs`, `node tests/org.cjs`, `node tests/org-tasks.cjs`, and `node tests/org-owner.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(org): add wizard profile templates and safe reset API`

### Task 3: Tree-based task placement, delegation, collaboration, and escalation

**Files:**
- Modify: `server/server.js`
- Modify: `server/org.js`
- Create: `tests/org-communication.cjs`

**Interfaces:**
- `validateTaskPlacement(task, input)` uses:
  - owner/root task → division lead or top-level manager target;
  - parent task → same division and allowed by owner/manager chain;
  - manager → active direct/indirect report allowed;
  - cross-division → only lead A to lead B when `B ∈ A.collaboratesWith`;
  - unauthorized route returns 409 with stable `TASK_ROUTE_FORBIDDEN`.
- `escalationTarget(memberName) -> {type:'member'|'owner', name, path}` from `org.js`.
- On `QUESTIONS:` worker result, task gets `blocked`, `decisionTarget`, and `decisionPath`; `decisionTarget` is direct manager or owner.
- Child tasks are owner/authorized-manager only and preserve parent division.

- [ ] **Step 1: Write failing tests** for direct manager delegation, indirect manager delegation, unauthorized peer assignment, allowed collaboration, denied collaboration, manager escalation, owner decision fallback, and cycle-safe paths.
- [ ] **Step 2: Run `node tests/org-communication.cjs` and verify RED.**
- [ ] **Step 3: Replace flat lead checks with graph-derived route validation and add escalation metadata to worker results.**
- [ ] **Step 4: Run `node tests/org-communication.cjs`, `node tests/org-tasks.cjs`, `node tests/decisions.cjs`, `node tests/org-owner.cjs`, `node tests/org-kanban.cjs`, `node tests/org-chat.cjs`, and `node tests/phase1-compliance.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(org): derive delegation and escalation from manager tree`

### Task 4: Dynamic agents and company-aware prompts

**Files:**
- Modify: `server/agents.js`
- Modify: `server/server.js`
- Modify: `server/settings.js`
- Create: `tests/dynamic-agents.cjs`

**Interfaces:**
- Produces `buildAgent(member, orgState, route) -> {role, model, system}`.
- Any member with `isAgent:true` appears in `/api/agents`; members with `isAgent:false` remain simulation-only.
- Agent prompt includes company name/type/description, role, primary division, manager, direct reports, effort, workload, and instructions.
- Per-member model routing reuses `settings.overrides` keyed by member name; invalid route returns a clear Settings error before task execution.
- Legacy KR/KS prompt text is migrated into `instructions`; remove hard-coded roster dependency from worker selection.

- [ ] **Step 1: Write failing tests** toggling Nina to an agent, checking `/api/agents`, prompt composition, per-member model routing, disabling KR, and ensuring disabled members cannot receive AI work.
- [ ] **Step 2: Run `node tests/dynamic-agents.cjs` and verify RED.**
- [ ] **Step 3: Implement dynamic agent registry/prompt builder and update `work()`/`kick()` to iterate active `isAgent` members.**
- [ ] **Step 4: Run `node tests/dynamic-agents.cjs`, `node tests/org-effort.cjs`, `node tests/providers.cjs`, `node tests/decisions.cjs`, and `node tests/org-tasks.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): build AI workers from organization roster`

### Task 5: Organization drawer editor and visual tree

**Files:**
- Modify: `public/tasks.js`
- Modify: `public/tasks.css`
- Modify: `public/index.html`
- Create: `tests/org-editor.cjs`

**Interfaces:**
- `officeTasks.renderOrg()` shows four sections/tabs inside `#orgDialog`: `Pohon`, `Divisi`, `Profil perusahaan`, `Wizard`.
- Tree DOM contract:
  - `#orgTree` root;
  - `[data-member="<name>"]` member cards;
  - `[data-manager="<name>"]` relationship connector metadata;
  - `#orgMemberEditor` panel opened by clicking a card.
- `officeTasks.openWizard(mode:'first-run'|'restructure')` opens the same wizard state machine.
- Member editor submits complete member patch; division editor submits complete v2 org; all writes use `recoverOrgLock()` and re-render only after server response.
- Visual tree uses nested lists/CSS connectors; no drag-and-drop or graph dependency.

- [ ] **Step 1: Write failing Playwright test** that unlocks, sees tree cards and manager connectors, clicks a member, changes manager/division/agent toggle, changes lead/collaboration, saves profile, and sees validation warning for a broken chain.
- [ ] **Step 2: Run `node tests/org-editor.cjs` and verify RED.**
- [ ] **Step 3: Implement tree renderer, member editor, division controls, company profile form, and validation warnings in the existing drawer.**
- [ ] **Step 4: Run `node tests/org-editor.cjs`, `node tests/org-owner.cjs`, and `node tests/org-offline.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(org-ui): add visual organization tree editor`

### Task 6: Wizard flow and total reset UI

**Files:**
- Modify: `public/tasks.js`
- Modify: `public/tasks.css`
- Modify: `public/index.html`
- Create: `tests/org-wizard.cjs`

**Interfaces:**
- Wizard steps use `#orgWizard` and `data-step` values `pin`, `company`, `template`, `divisions`, `members`, `agents`, `summary`.
- First-run detection: `GET /api/org` reports `configured:false` when there is no PIN/company/member setup; drawer opens wizard automatically once per browser session.
- Template selection populates editable draft; it never writes until final Save.
- Back/Next validates the current step; Summary Save calls `/api/org/wizard` once.
- Reset UI requires current PIN and exact `RESET`, calls `/api/org/reset`, downloads/links the archive result, clears local task/org seeds, and returns to first-run wizard.

- [ ] **Step 1: Write failing Playwright test** for first-run wizard, software-dev template suggestions, editing company profile, adding manager relationships, selecting dynamic agents, final save, restructure mode, reset confirmation, and archive download.
- [ ] **Step 2: Run `node tests/org-wizard.cjs` and verify RED.**
- [ ] **Step 3: Implement wizard state machine and reset controls with no partial local state writes before final save.**
- [ ] **Step 4: Run `node tests/org-wizard.cjs`, `node tests/org-editor.cjs`, `node tests/org-owner.cjs`, and `node tests/org-offline.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(org-ui): add organization setup wizard and reset flow`

### Task 7: Dynamic roster integration with 3D desks and hot desk

**Files:**
- Modify: `public/office.js`
- Modify: `public/tasks.js`
- Modify: `public/office.css`
- Create: `tests/org-seating.cjs`

**Interfaces:**
- `officeScene.syncRoster(roster) -> {assigned:[name], hotDesk:[name], warnings:[]}`.
- Existing members retain their desk and movement state.
- New member gets first unoccupied Workspace desk in their division’s desk group; if none, a hot-desk marker is used and warning text is shown in profile/tree.
- `officeScene.removeRosterMember(name)` hides/deactivates a removed member without shifting remaining member identity.
- Division color is derived deterministically from division id and used for labels/markers.

- [ ] **Step 1: Write failing test** adding a member through the wizard, checking they appear in Team/tree/3D, fill all desks to force hot desk, and verify existing members’ positions remain stable.
- [ ] **Step 2: Run `node tests/org-seating.cjs` and verify RED.**
- [ ] **Step 3: Implement roster sync against current `agents`/desk structures; avoid rebuilding the Three.js scene.**
- [ ] **Step 4: Run `node tests/org-seating.cjs`, `node tests/avatar-stairs.cjs`, `node tests/soft-avatar.cjs`, `node tests/nav.cjs`, and `node tests/phase1-compliance.cjs`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(office): sync organization roster to desks and hot desks`

### Task 8: Full Fase 2 verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-18-nav-org-rework-design.md` only if implementation decisions differ
- Create: `tests/org-phase2.cjs` (or reuse the task-specific tests as the aggregate runner)

- [ ] **Step 1: Run the aggregate Fase 2 suite:**

```bash
node tests/org-v2.cjs
node tests/org-api-v2.cjs
node tests/org-communication.cjs
node tests/dynamic-agents.cjs
node tests/org-editor.cjs
node tests/org-wizard.cjs
node tests/org-seating.cjs
node tests/nav.cjs
node tests/phase1-compliance.cjs
node tests/org-offline.cjs
node tests/org-tasks.cjs
node tests/org-kanban.cjs
node tests/org-chat.cjs
```

- [ ] **Step 2: Run syntax and patch checks:**

```bash
for f in public/*.js server/*.js tests/*.cjs; do node --check "$f" || exit 1; done
git diff --check
```

- [ ] **Step 3: Update README with schema v2, wizard entry point, templates, reset archive, dynamic agent toggle, and hot-desk behavior.**
- [ ] **Step 4: Run `graphify update .` and record final graph refresh.**
- [ ] **Step 5: Commit** `docs(org): document organization tree and setup wizard`
