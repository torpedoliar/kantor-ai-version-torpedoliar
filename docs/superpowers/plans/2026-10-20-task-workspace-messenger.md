# Task Workspace & Messenger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner dapat memantau pekerjaan nyata melalui Kanban empat kolom, Messenger, graf komunikasi, dan console, serta menerima aplikasi yang dibangun dan diuji pada Windows lokal atau Docker sesuai pilihan eksplisit.

**Architecture:** Pertahankan Node single-process, vanilla DOM/SVG dan provider transport yang ada. Pindahkan state lifecycle ke satu transactional task store; orchestrator mengonsumsi hasil model terstruktur dan runner menjalankan command manifest yang disetujui. Messenger, graf dan console membaca event durable yang sama, bukan menyimpulkan percakapan dari animasi atau polling status.

**Tech Stack:** Node >=22, vanilla JavaScript/CSS, SVG, Playwright yang sudah terpasang, Docker CLI opsional; tanpa framework UI/queue baru.

**Spec:** `docs/superpowers/specs/2026-10-20-task-workspace-messenger-design.md`. Dasar keputusan owner: `.superpowers/task-workspace-decisions.md`; diagnosis awal: `.superpowers/task-workspace-investigation.md`.

## Global Constraints

- Native execution ketika implementasi disetujui; tidak membuat commit atau push tanpa permintaan owner.
- UI Bahasa Indonesia; empat kolom tepat: **Tugas / In progress / Review / Selesai**. `blocked` tetap In progress dengan alasan yang jelas.
- Komunikasi menjadi menu rail tersendiri bergaya Messenger; setiap task card menautkan thread-nya.
- Semua event percakapan/progress berasal dari tindakan nyata. Tidak menampilkan hidden reasoning, percakapan palsu, persentase palsu, atau menjanjikan aplikasi bebas bug.
- Owner memilih Windows lokal atau Docker per proyek. Tidak pernah fallback otomatis. Windows bukan sandbox; execution/install membutuhkan persetujuan sumber+command+environment.
- Tidak menjalankan kode hasil model pada host ketika menulis/menguji fitur ini; gunakan fixture kode tepercaya dan child process yang dimiliki tes.
- Default runtime awal: static JavaScript web dan Node web service. Runtime lain menghasilkan `unsupported_runtime`, bukan shell bebas.
- Source/proyek hasil agen berada di `DATA_DIR/projects`; tidak menimpa repo Kantor Kita. Preview loopback origin terpisah, tidak berbagi origin dengan API owner.
- Token PIN, CSRF, version dan runId tetap ditegakkan. Tidak memasukkan secrets ke job, event, log, argv, source atau unduhan.
- Tests pakai temp DATA_DIR/provider mock, port dinamis atau TEST_PORT >=43000, satu browser suite pada satu waktu. Docker tes nyata hanya jika daemon tersedia; tidak diam-diam dianggap pass jika dilewati.
- Jalankan `graphify update .` setelah perubahan kode. Per-task ledger mencatat RED/GREEN, command, hasil, dan ruling.

## Review Focus

1. Restart/duplicate delivery saat planner selesai: satu plan/run membuat satu set anak, tidak dua (Task 3).
2. Jawaban owner/read cursor dikirim dua kali atau dari tab lama: conflict/idempotency tidak merestart dua worker atau menghapus unread baru (Task 2/6).
3. Windows junction/symlink/traversal dan env inheritance: keluar workspace atau bocor secrets ditolak (Task 8/9).
4. Source/manifest berubah setelah approval atau bukti tes lama: tidak boleh execution/review dengan izin/evidence stale (Task 9/11).
5. SSE reconnect/scroll/filter pada thread ramai: tidak menggandakan toast, tidak kehilangan decision, input balasan tidak hilang (Task 5/6).

## Tahapan dan batas file

A. **Lifecycle & visibilitas** — Tasks 1–7. Menghasilkan aplikasi task/messenger yang bisa dipakai dan dilihat tanpa runner.
B. **Aplikasi yang benar-benar diuji** — Tasks 8–11. Workspace, runtime Windows/Docker, repair dan review evidence.
C. **Penutupan** — Task 12. Full regression, visual/E2E, dokumentasi dan review.

File baru beserta tanggung jawab:
- `server/task-store.js`: satu state durable, migration, transaction, queries.
- `server/task-orchestrator.js`: scheduler, planner, delegasi, dependency, eskalasi/sintesis.
- `server/task-protocol.js`: parsing/validation output planner dan implementer.
- `server/project-workspace.js`: validasi file dan revision hash, source export.
- `server/project-runner.js`: job state, approval, process lifecycle, Windows/Docker adapters dalam file yang sama dahulu.
- `public/task-workspace.js` + `.css`: Kanban/detail/form/alur/console.
- `public/messenger.js` + `.css`: inbox/thread/decision/notifikasi.
- `tests/helpers/task-app.cjs`: test-only server/mock/temp cleanup; tidak menaruh test hook di production.

File existing: `server/server.js` tetap HTTP integration/guards; `server/providers.js` tetap transport model; `server/agents.js` prompt context; `public/tasks.js` menjadi adapter data/API kompatibel bagi office.js; `public/nav.js` menambah drawer Komunikasi; `public/org-wizard.js` perapian Orang, bukan redesign organisasi ulang.

## Kontrak bersama

### Durable state v1 (`workspace.json`)

`{schemaVersion:1, version, nextSeq, tasks:[], threads:[], messages:[], decisions:[], events:[], projects:[], jobs:[], reads:{owner:{threadId:seq}}, requests:{idempotencyKey:resultId}}`.

- Task legacy fields tetap; tambah `rootId`, `phase`, `blockedReason`, `executionMode:'direct'|'automatic'`, `outputType:'document'|'application'`, `dependencyIds:[]`, `planRunId`, `acceptance:[]`, `projectId`.
- Phase: `queued|planning|waiting_children|drafting|waiting_approval|building|testing|smoke|synthesizing|review|done|interrupted|failed`.
- Event: `{id,seq,at,type,taskId,rootId,agent,runId,from,to,messageId,jobId,data}`; event types specified by owning task below.
- Message: `{id,threadId,seq,at,sender:{type:'owner'|'agent'|'system',name},kind:'text'|'delegation'|'decision'|'result',text,taskId,decisionId?,replyTo?}`.
- Decision: `{id,taskId,threadId,version,status:'open'|'answered'|'cancelled',target,questions:[],options:[],answer?,answeredAt?}`.
- Job: `{id,taskId,projectId,revisionId,runId,environment,status,manifestHash,approvalId?,startedAt?,finishedAt?,evidence:[]}`. Tidak memuat credential.

`createTaskStore({dataDir}) -> {snapshot(),transaction(expectedVersion, mutate),eventsAfter(after,limit),subscribe(listener)}`. Mutator sinkron menerima draft state dan `emit(event)`; transaction write atomik sebelum notify. Mutation gagal → disk dan memory lama tetap. Event seq dialokasikan hanya dalam transaction yang commit.

### HTTP conventions

Mutations meminta owner PIN untuk orkestrasi/keputusan/izin; CSRF dan origin guard existing tetap. GET SSE juga session+owner protected melalui `fetch` stream headers, bukan token di query string. Legacy read-only task view tidak otomatis menjadi hak menjalankan kode.

Errors `{error,code,currentVersion?}`: `ORG_LOCKED`, `VERSION_CONFLICT`, `TASK_ROUTE_FORBIDDEN`, `ENVIRONMENT_UNAVAILABLE`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`, `UNSUPPORTED_RUNTIME`, `QUALITY_GATE_FAILED`.

Idempotency header `x-kantor-request` (UUID) wajib untuk create/message/answer/start/retry. Browser retry hanya dengan key sama; **hapus retry POST generik tanpa key** dari tasks.js.

## Task 1: Transactional lifecycle dan migration kompatibel

**Files:** Create `server/task-store.js`, `tests/task-store.cjs`, `tests/helpers/task-app.cjs`; modify `server/server.js` storage/newTask/normalizeTask/routes, `tests/org-tasks.cjs`, `tests/worker-reliability.cjs`.

**Interfaces:** produces shared store di atas; `transitionTask(draft,id,patch,{expectedTaskVersion,runId})` checks per-task version, active run identity, appends actual transition event. Existing `GET/POST /api/tasks`, PATCH tetap kompatibel.

- [ ] RED: `task-store.cjs` asserts migration tasks.json → workspace.json once; original bytes unchanged; reload sees same task IDs; transaction message+task+event commits together; throwing mutator commits nothing; duplicate request key returns original result; `eventsAfter(3,100)` strictly increasing and excludes <=3. Run `node tests/task-store.cjs` → FAIL missing module.
- [ ] GREEN: implement copy-on-write state + atomic rename with injected write adapter only at store factory boundary for disk-failure test. Migrate messages/history preserving authors as legacy/system, no invented agent chat. Add limits (500 events/page; event/message text 8000 chars). Migrate only on absent workspace.json; invalid storage fails startup without overwrite.
- [ ] RED: extend `org-tasks.cjs`: stale generic PATCH →409; child whose assignee division mismatches →409; closed parent/cyclic parent →409; final AI-child approval cannot leave parent forever queued or auto-approve a root with empty result.
- [ ] GREEN: route all writes through shared lifecycle and placement checks after body read. `validateTaskPlacement` validates active member, hierarchy, parent open, dependencies and routing. Preserve old API shape through serialization, not a second mutable task array.
- [ ] Verify `node tests/task-store.cjs && node tests/org-tasks.cjs && node tests/worker-reliability.cjs && node tests/server.cjs` (TEST_PORT override) → PASS. No commit.

## Task 2: Messenger backend dan decisions atomik

**Files:** Modify `server/task-store.js`, `server/server.js`, `server/agents.js`, `server/providers.js`; create `tests/task-messenger-api.cjs`.

**Interfaces:**
- `GET /api/communications?after=seq` returns `{threads,messages,decisions,reads,nextSeq}` (incremental messages/events, thread summaries snapshot; limit 200).
- `POST /api/tasks/:id/messages {text,version}`; author always server-derived owner. `GET /api/tasks/:id/thread`.
- `POST /api/decisions/:id/answer {answer,version}` resolves decision+adds message+queues task in one transaction.
- `PUT /api/communications/:threadId/read {throughSeq}` advances cursor only through committed seq, never backwards.
- `emitDecision(task,questions,target)` yields `decision.opened` + message, status blocked with reason decision. Reuse legacy PATCH action answer via same handler.
- Provider task context gets bounded `conversation` and `childResults`; no arbitrary sender supplied by client.

- [ ] RED API fixture: task asks QUESTIONS →one open decision + agent message; unknown user-supplied `by:'CEO'` ignored; stale answer →409; same request UUID repeated →one answer and one resumption; read notification leaves decision open; reload preserves unread/read; `<script>` stored as text. `node tests/task-messenger-api.cjs` → FAIL endpoint absent.
- [ ] GREEN: implement endpoints and canonical decision transition; thread linked to task creation, timestamps/seq server-owned. Map legacy questions/messages; don't double-import on restart. Include replies in next worker prompt; while running, mark owner message pending next context rather than claiming immediate consumption.
- [ ] Verify `node tests/task-messenger-api.cjs && node tests/org-chat.cjs && node tests/decisions.cjs` → PASS, mock model receives actual owner answer and historical message attribution.

## Task 3: Planner, delegation dan dependency scheduling

**Files:** Create `server/task-protocol.js`, `server/task-orchestrator.js`, `tests/task-orchestration.cjs`; modify `server/server.js`, `server/agents.js`.

**Interfaces:**
- `parsePlan(text,{org,parent}) -> {assumptions,acceptance,children:[{key,title,brief,assignee,dependencyKeys,outputType,mode}]}`; key unique, DAG, max12 children/call/depth3/40 root total.
- `createOrchestrator({store,org,settings,generate,runner}) -> {wake(),cancel(taskId),recover()}`; worker phase persisted, no credentials stored. Concurrency 1/agent, global3; apply queued priority high→normal→low then createdAt; zero workload does not schedule and emits reason.
- `POST /api/tasks` accepts executionMode/outputType/acceptance. Legacy direct tasks retain behavior. Auto root planning →waiting_children →synthesizing.
- Structured worker reply `{kind:'questions',questions,options}` or `{kind:'result',text}`; support old QUESTIONS string. Agent questions routed through manager; owner decisions always visible to owner.

- [ ] RED: mock planner assigns engineering work to engineering lead and collaborator lead; manager delegates child; dependencies prevent early execution; denied peer route emits `delegation.rejected` not children; duplicate plan completion/restart creates one child per `(parent,planRunId,key)`; roster review wakes immediately; cancellation rejects late result. Run `node tests/task-orchestration.cjs` → FAIL absent orchestrator.
- [ ] GREEN: explicit phases replace root-asLead exclusion. Server validates all plan children before a single transaction. Translate model-declared dependencyKeys to IDs. No fake owner creator bypass. Allow cross-division child only through validated lead collaboration edge; subsequent delegation within own subtree. Escalation records each hop with loop bound.
- [ ] RED: child internal completion triggers exactly one synthesis; last AI child completion and manual completion use same path; failed child blocks dependency; approval root without result fails. Model mock tracks calls and asserts answers/child results reach synthesis.
- [ ] GREEN: internal leaf completion accepted by lead, not automatically root done. Root direct/doc →Review after result; app root→runner quality gate. Limit repair/planning retries; persist interruptions and expose retry action rather than blindly restarting effects.
- [ ] Verify `node tests/task-orchestration.cjs && node tests/org-communication.cjs && node tests/org-tasks.cjs && node tests/worker-reliability.cjs` →PASS. Test through provider mock; no live paid providers.

## Task 4: Wide task workspace dan Kanban empat kolom

**Files:** Create `public/task-workspace.js`, `public/task-workspace.css`, `tests/task-board.cjs`; modify `public/index.html`, `public/tasks.js`, `public/nav.js`, `tests/org-kanban.cjs`.

**Interfaces:** `TaskWorkspace.mount(container,{snapshot,create,patch,openThread,selectTask})`, `.update(snapshot)`. `officeTasks.list/activeFor/open/state/setTeam/ready` preserved for office scene. `#taskDialog.drawer-wide`; `#taskCreate`, `#taskBoard`, `[data-column=queued|progress|review|done]`, `.task-card[data-task-id]`, `#taskDetail`, `#taskCreateForm`.

- [ ] RED Playwright: fixtures for queued/active/blocked/review/done + nested child produce exactly4 columns and every task once; blocked badge says `Menunggu jawabanmu`; done visible; filter includes standalone children/root link. Creation form hidden until `+ Tugas`; chooses document/application/direct/automatic, criteria and environment for application. `node tests/task-board.cjs` →FAIL old column count.
- [ ] GREEN: remove repeated roster inventory from task content; show optional collapsible team filter, not full duplicate org editor. Single global board with divisi filter (not 4 columns duplicated for every division). Action state machine drives detail buttons and optimistic conflict feedback. Read actual agents routing on settings/org refresh to eliminate stale dry-run copy.
- [ ] Verify update `org-kanban.cjs` assertions to new 4 global columns, retaining split linkage and owner summary in detail. Run both tests + `nav.cjs`/`phase1-compliance.cjs`; screenshots 390×844,768×900,1440×900; inspect no horizontal page overflow (board itself may scroll).

## Task 5: Event replay, console dan task communication graph

**Files:** Modify `server/server.js`, `server/task-store.js`, `public/task-workspace.js/.css`, `public/tasks.js`; create `tests/task-events.cjs`, `tests/task-flow.cjs`.

**Interfaces:** `GET /api/task-events?after=seq` SSE (event id=seq), heartbeat15s, replay limit500 with explicit `resync` marker; `GET /api/task-events/snapshot` for reconciliation. Client fetch-stream parser and 2.5s polling fallback use same seq. Types `task.created|task.phase|model.started|model.completed|model.failed|delegation.created|delegation.rejected|decision.opened|decision.answered|result.submitted|job.*|command.*|test.*`.

- [ ] RED API: replay returns actual events even queued→active→review between polls; reconnect Last-Event-ID/query cursor has no gap/dup; disconnect releases subscription; auth rejects missing owner token; event JSON excludes credential/provider snapshot. `node tests/task-events.cjs` →FAIL SSE route absent.
- [ ] GREEN: store commit listener fans out (no new event bus dependency); bounded per-connection backpressure closes slow client and forces snapshot. Client updates normalized data, emits officeTasks change without fabricating missed `active` logs.
- [ ] RED browser: select one root →graph shows actual delegation IDs only, allowed-but-unused collab absent; click edge opens source message; console filters by agent/run, escaped output, pause stops scrolling not ingestion, export secrets absent. `task-flow.cjs` →FAIL missing graph/console.
- [ ] GREEN: DOM cards + SVG elbow paths from task DAG; zoom/pan and focus root; dynamic runtime nodes not positional copies of org. Console virtualizes/paginates max200 visible rows, retains cursor; render stderr as text, strip ANSI and secret patterns server-side.
- [ ] Verify both tests + worker reliability; no invented percent. Browser screenshot confirms 30-node graph can pan without overlapping text.

## Task 6: Messenger UI, notifications dan decision response

**Files:** Create `public/messenger.js/.css`, `tests/messenger-ui.cjs`; modify `public/index.html`, `public/nav.js`, `public/tasks.js`, `public/task-workspace.js`.

**Interfaces:** rail `#bCommunications`/badge, `#communicationDialog` added nav allowlist; `Messenger.open({taskId?,decisionId?})`, `.update(snapshot)`; `#threadList`, `#messageTimeline`, `#messageComposer`, `#decisionAnswer`, `#notificationCenter`; task card `Buka percakapan`.

- [ ] RED browser: actual agent question →visible persistent toast with agent/task name; click opens exact thread/decision; owner answer resumes worker once; unread badge decreases only through visible last message; decision remains after marking read; unrelated incoming messages don't steal focus; reload restores unsent draft. `node tests/messenger-ui.cjs` →FAIL no drawer.
- [ ] GREEN: three-pane desktop, thread view with back button on phone, clear owner/agent/system bubbles, time and status. Persist composer draft per thread with try/catch sessionStorage; server read cursors authoritative. Toast keyed decisionId; browser notification opt-in button only. Permission denied →in-app works; reconnect no replay toast flood.
- [ ] RED verify blocked tasks link to same decision from Kanban, rail and graph; keyboard Esc closes top modal first; new messages don't scroll reader away while reading old messages.
- [ ] Verify `messenger-ui`, `nav-hardening`, `org-chat`, `decisions`; screenshots across 3 sizes and keyboard-only send. Notification content excludes API keys/log dumps.

## Task 7: Wizard Orang yang terstruktur

**Files:** Modify `public/org-wizard.js`, `public/tasks.css`; create `tests/wizard-people-ui.cjs`; update `tests/org-wizard.cjs`, `tests/org-ai-draft.cjs` selectors only where behavior changed.

**Interfaces:** `[data-step=people]` division groups `.wizard-division-group`, `.wizard-person[data-member-id]` (draft-only stable id), `#wizardPeopleSearch`, `#wizardPersonEditor`, fields with real labels name/role/division/manager/effort. Stable draft id never replaces server name identity implicitly.

- [ ] RED: generated roster16 members grouped by division+lead; long role readable in summary/title, editor labels unambiguous; search then rename updates lead+manager references, retains hidden members, back/next retains all edits. Stepper/footer visible at phone/tablet/desktop; only content scrolls. `node tests/wizard-people-ui.cjs` →FAIL old flat form.
- [ ] GREEN: card/list summary + one selected editor, group collapse and search, inline errors, explicit add/deactivate/remove controls. Use existing OrgModel operations where correct; no extra UI framework or second org graph.
- [ ] Verify wizard suite including AI generation/model route selection and expired PIN recovery. No loss of effort/model values while moving people between groups.

## Task 8: Project revision artifacts dan path boundary

**Files:** Create `server/project-workspace.js`, `tests/project-workspace.cjs`; extend `server/task-protocol.js`, `server/server.js`.

**Interfaces:**
- `createProjectWorkspace({dataDir}) -> {writeRevision(projectId,bundle),manifest(projectId,revisionId),readFile(...),exportSource(...)}`.
- Bundle `{runtime:'static-web'|'node-web',files:[{path,content}],commands:{build:{executable,args},test:{executable,args},start:{executable,args}},acceptanceTests:[],knownLimitations:[]}`; per revision max200 files/10MB text; individual1MB. Fixed runtime executables only (Node; npm install separately approved); no model-provided Dockerfile or host absolute paths.
- `GET /api/projects/:id/revisions/:rev` metadata; owner-protected source download and preview mapping only after validation.

- [ ] RED: allowed nested paths succeed; `../`, drive, UNC, encoded traversal, NUL, duplicate canonical path, symlink/junction ancestor, reparse point and overwrite existing revision rejected; content/manifest hash stable; write failure yields no published partial revision. `node tests/project-workspace.cjs` →FAIL module absent.
- [ ] GREEN: staging directory then rename, project/revision UUIDs assigned server; lstat/realpath containment checks every existing ancestor, reject symlinks/junctions. Immutable revisions; no arbitrary fs tools. No secret files inherit from app.
- [ ] Verify Windows-specific junction test on Windows, POSIX symlink test otherwise. Test fixtures generate trusted files, never model output. Export source with Node tar utility or a safe existing archiver only if actually available; default downloadable individual files + manifest must work without new dependency. Do not advertise ZIP if not implemented.

## Task 9: Windows execution jobs dan explicit approval

**Files:** Create `server/project-runner.js`, `tests/project-runner.cjs`; modify `server/server.js`, `server/task-store.js`, `public/task-workspace.js`.

**Interfaces:**
- `GET /api/execution/environments` → availability for windows/docker and reason, never starts daemon.
- `POST /api/projects/:id/approve {revisionId,manifestHash,environment,networkAllowed}` →approval tied exact snapshot and owner.
- `POST /api/projects/:id/run {revisionId,approvalId}` →job; `POST /api/jobs/:id/cancel`; `GET /api/jobs/:id` evidence.
- Runner `run({job,revision,approval,signal,onEvent})`; phases build/test/smoke/start; argv no shell interpolation, executable allowlist, env minimum PATH/SystemRoot/TEMP plus documented runtime vars (not parent env blanket).
- Limits: build/test120s each, output1MB/command with truncation marker, one active job/project, global2; no implicit npm lifecycle/dependency install before approval. Windows process tree cleanup by owned PID only.

- [ ] RED trusted fixture: no approval→403; stale revision/hash→409; command exit1 captures failure; timeout/cancel terminates grandchild; env sentinel absent; command metacharacters passed as argv not shell; duplicate run request→same job. `node tests/project-runner.cjs` →FAIL no runner.
- [ ] GREEN: native spawn `shell:false`, fixed cwd, controlled temp dirs; command plan UI shows source changes, commands, runtime and host access warning before approval. Network off cannot be enforced for ordinary Windows process: label `akses jaringan mengikuti OS`; require explicit network acknowledgement, don't claim container isolation.
- [ ] Verify job crash/restart →interrupted, never rerun code automatically; stale worker output ignored by runId; approval or environment switch is owner decision card in Messenger. Unknown runtime rejects before spawn.

## Task 10: Docker adapter tanpa fallback host

**Files:** Extend `server/project-runner.js`; create `tests/project-docker.cjs`, `tests/project-docker-live.cjs`; modify task detail environment controls.

**Interfaces:** fixed configured image (`KANTOR_RUNNER_IMAGE`, explicit digest recorded in approval), no arbitrary model image; invocation argv to Docker CLI; container label `kantor-job=<id>`; start/test containers use owned names. Read-only source mount, writable output/tmp, non-root UID, cap-drop ALL, no-new-privileges, no docker socket, CPU1/memory512m/PID128, network none unless install/network permission explicitly approved. Preview port binds127.0.0.1 with sandbox origin.

- [ ] RED fake CLI captures argv: security flags present, host repo/.env not mounted, spaces in Windows paths preserved; daemon down→blocked environment_unavailable + no Node spawn; cancel only removes labeled owned container; env switch invalidates approval. `node tests/project-docker.cjs` →FAIL adapter missing.
- [ ] GREEN implement shared runner adapter selection; Docker daemon/image missing displayed as explicit actionable decision; no pull/install/start daemon until owner approves. Environment request never executes model shell on host.
- [ ] Verify `project-docker.cjs`. `project-docker-live.cjs` runs trusted hello/calculator fixture only when opted in via `RUN_DOCKER_TESTS=1`; records SKIP otherwise. Implementation cannot be declared Docker-verified without real daemon run; report blocker honestly.

## Task 11: App generation, repair loop, preview dan owner quality gate

**Files:** Extend `server/task-orchestrator.js`, `server/task-protocol.js`, `server/project-runner.js`, `server/server.js`, `public/task-workspace.js`, `public/messenger.js`; create `tests/application-workflow.cjs` and `tests/application-workflow-ui.cjs`.

**Interfaces:** application leaf model produces Task8 bundle; lead integrates immutable revision. Test evidence `{revisionHash,manifestHash,commandId,startedAt,endedAt,exitCode,tests:[{criterionId,status}],stdoutRef,stderrRef}`. `canReviewApplication(root,state)` validates all required gate evidence; owner approve action rechecks same revision.

- [ ] RED local provider mock returns trusted calculator bundle; mock runner interface not asserted as proof itself: integration test additionally runs actual trusted build/test fixture using approved Windows/Node runner, checks 2+2/negative/decimal/divide-zero criteria. Model text `tests pass` with no real job is rejected. Source changed→old evidence cannot approve. `node tests/application-workflow.cjs` →FAIL no app lifecycle.
- [ ] GREEN orchestrator bundles files, creates approval decision, runs supported adapter, collects actual exit codes, runs independent template smoke and criterion checks; per-phase real events. Max2 repair attempts, no recursive unbounded retries; revised Windows manifest/source requests approval again. Failed tests remain In progress with actionable cause.
- [ ] RED browser mock asks choice Windows/Docker, shows commands/risks; Docker unavailable doesn't fall back; build failure visible in Console/thread; successful exact revision opens Review with preview/source/test evidence/limitations; approve→done once, revise→new revision flow.
- [ ] GREEN preview service runs generated frontend on separate origin. iframe sandbox excludes same-origin privileges; download response attachment; app API rejects preview origin. No exposing arbitrary host ports or path proxy. Add stop-preview lifecycle and clear stale preview after job/revision replacement.
- [ ] Verify API/UI workflow and runner tests. Use actual trusted fixture tests, no paid providers. Smoke example app at loopback and owner approvals are test-data-only.

## Task 12: Migration, documentation, full verification dan review

**Files:** README, package.json test scripts, `tests/run-suite.cjs`, integration tests from Tasks1–11; no live task data mutations.

- [ ] RED add migration/reset/export tests: reset blocked during active jobs; archive includes task/message/decision evidence refs; no credentials/PIN/source secrets; interrupted recovery visible after restart; legacy tasks remain accessible including old blocked calculator. Run named tests →FAIL unsupported new state operations.
- [ ] GREEN update reset/export endpoints to transaction store; preserve tasks.json backup and old endpoint contracts. Add test scripts `test:unit`, `test:ui`, `test:docker`, `test` with explicit suites and 600s per lengthy browser file; report exit codes accurately, no `| head` masking failures.
- [ ] README explains actual vs dry-run, assignment/delegation, Messenger notifications, pending decisions, four columns, Windows risks/approval, Docker availability, supported JS runtime scope, build/test evidence, retry/cancel/recovery, known limitations.
- [ ] Run full `npm test` sequentially; `npm run test:docker` only with explicit Docker opt-in (otherwise report SKIP, not PASS). Run `node --check` all changed JS, `git diff --check`, `graphify update .`.
- [ ] Visual E2E: create project/task on temp data, real internal delegation with provider mock, owner receives question and answers from Messenger, independent leaf results synthesize, trusted calculator app builds/tests, owner reviews evidence, completes root. Inspect screenshots 390/768/1440: wizard people, four columns, thread, graph, console, decision notification, review result.
- [ ] Fresh whole-change read-only review against spec, plan, rulings and working files (no HEAD-only review because uncommitted). Grade by actual impact; confirmed Important/Critical fixes get regression RED→GREEN and full suite. No second speculative feature pass. Preserve no-commit instruction and ledger.
- [ ] Live restart only of identified owned process; read-only smoke on real org/task data; do not execute owner's previously blocked calculator or spend 9Router tokens without a separate approved execution request. Final report names tested runtime(s), exact failures/skips, unresolved spec items and build evidence; never say “semua selesai” if a gate remains.

## Self-review dan coverage map

- Spec§2.1 →Task4; §2.2 →Tasks2/6; §2.3 →Task5; §2.4 →Task7.
- Spec§3 →Tasks1/3; §4.1 →Task9/10; §4.2 →Task8/9/10; §4.3 →Task11.
- Spec§5 durability/recovery/migration →Tasks1/2/5/12; auth guards throughout.
- Critical shared interfaces: Task1 store consumed by2/3/5/9; Task2 decisions consumed by6/9/11; Task3 plan graph consumed by5/11; Task8 revision/hash consumed by9/10/11; Task9 evidence consumed by11. All signatures above use `revisionId` for storage identity and `revisionHash` for content evidence (not interchangeable).
- Agreed user choices preserved: Messenger menu dedicated, four exact columns, real program tests, Windows or Docker explicit choice, no commits. Builder calls requiring owner review: initial JS-only runtime scope, bounded concurrency/retry, root-only acceptance and single transactional store migration.
- Implementation approval requested before production edits; plan may be executed in order, with runnable milestones A and B instead of claiming a UI-only patch implements execution.
