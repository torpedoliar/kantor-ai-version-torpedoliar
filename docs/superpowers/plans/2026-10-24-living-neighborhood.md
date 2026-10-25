# Living Neighborhood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution in this session. Tasks use checkbox (`- [ ]`) tracking. No commits; user instruction overrides commit steps.

**Goal:** Realistic local neighborhood assets, orderly road traffic and complete vehicle journeys for visitors and idle team members, with new work triggering safe return.

**Architecture:** Keep office.js as the integration adapter, not a second traffic engine. Add a pure deterministic lane/parking/trip state machine in mobility.js and a Three.js scenery/vehicle adapter in office-environment.js. Task eligibility comes from officeTasks.list(), never the character's visual `work` state. Reuse existing navigation, people rigs, barber queue and graphics tiers.

**Tech Stack:** Vanilla JS, vendored Three.js 0.160, local CC0 glTF/textures, Node assert tests and existing browser harness.

**Spec:** docs/superpowers/specs/2026-10-24-living-neighborhood-design.md (approved).

## Global Constraints

- Native execution; no commit/push and no changes to live data/credentials. Browser tests use isolated fixture origins and intercepted API, not the live server for mutations.
- No runtime CDN. CC0 source/license URLs recorded. Download assets only; never execute code bundled in downloads. Python parsing uses `-I`, scripts outside untrusted folders.
- Runtime assets total <=60 MiB; current approximately 37.4 MiB. Asset visual gate precedes integration; no rounded-ball trees/box cars passed off as final realism.
- Preserve current office building/interior. Traffic left-hand. Existing basement refers to floor-1 barber/parking, not a new underground level.
- Task runner is never gated on visual travel; queued/active/blocked/review or unknown nonterminal assigned tasks prevent new departure. Only done tasks are nonblocking under current status model.
- Camera changes only affect drawing, not simulation/reservations. Pause freezes simulation. Reduced-motion prevents new team excursions and reduces ambient motion; necessary safe returns remain available.
- Target >30 FPS GTX750Ti 1080p High with 30 team members and live traffic; measure instead of extrapolate. Report Ultra separately. graphify update . after code changes.

## Review Focus

1. Task arrival racing mount/departure, including assignment transfer and deleted tasks: no stale permission to depart (Task 4).
2. Full parking plus return traffic and a crossing pedestrian: eventual safe return without deadlock (Task 2, 3).
3. Camera/graphics changes and hidden tabs during trips: no duplicates, lost reservations or visible popping (Task 5).
4. Roster removal and floor rebuild while passengers drive: valid cleanup without teleport (Task 4, 5).
5. Missing/slow car/tree assets: office remains usable and real asset failure is disclosed (Task 1, 3).

## File map and fixed contracts

- `scripts/fetch-environment-assets.mjs`: source-pinned direct asset fetches/checksums; do not run upstream executables.
- `public/assets/environment/manifest.json`: `{version:1, assets:{tree:{file,license,source,sha256},car:{...},motorcycle:{...},asphalt:{...},grass:{...}}}`; file URLs root-relative. Tree/car/motor entries include validated bounds in metres and forward axis normalization. Optional additional variants share the same schema.
- `public/mobility.js`: browser `window.OfficeMobility`, CommonJS `module.exports` for the same pure core; no Three/DOM/timeouts.
- `public/office-environment.js`: browser renderer/model asset adapter only.
- `public/office.js`: replace old skyline/traffic implementation and connect real people/tasks/shop, dt, graphics lifecycle and cameras.
- `public/three-global.js`: ordered local loading of mobility and environment before office.js; existing surface/model/people order preserved.
- `tests/environment-assets.cjs`, `tests/mobility.cjs`, `tests/environment-ui.cjs`, `tests/mobility-team.cjs`, `tests/mobility-visitors.cjs`, `tests/environment-lifecycle.cjs`: assets, pure simulation, visual integration and lifecycle.

Core interface: `OfficeMobility.create({lanes,conflicts,parking,seed,maxTeamAway:2})` returns `{tick(dt),request({id,kind,owner,vehicle}),recall(owner),removeOwner(owner),setDepartures(enabled),setLimit(n),occupyCrossing(id,occupied),snapshot()}`. `request` returns a trip id or null; repeated owner request is idempotent. Lane entries `{id,points:[[x,y,z],...],next:[id],conflicts:[id],speed}`. Parking `{id,kind:'car'|'motorcycle',position:[x,y,z],heading,entryLane,exitLane}`. Snapshot contains copied `vehicles`, `trips`, `reservations`; each vehicle has stable id, owner, kind, lane, distance, speed, pose; each trip has owner, phase, recall flag, parking id. Phases: `walkToVehicle,mount,outbound,away,inbound,park,dismount,walkToOffice,complete`; removal uses `retiring` until safe offscreen exit. A trip's walking/mount phases advance only through `arrive(tripId,phase)` acknowledgments from the office adapter; include this method on the returned interface. Tick never advances arrival-based phases by guessing that a person reached a point.

Renderer interface: `officeEnvironment.create({THREE,scene,parkingRoot,level,onWarning})` -> `{ready(),layout,update(snapshot,dt),setLevel(level),setCityVisible(on),dispose(),audit()}`. `ready()` resolves after bounded loading, audit reports failed/pending assets. `layout` supplies core lanes/conflicts/parking plus pedestrian ingress waypoints; geometry and simulation share it. `audit()` reports counts, asset use, world bounds, draw/resource counts and failed assets, not fake test-only statuses. No external fetch at runtime.

## Task 1: Asset selection and visual gate

**Files:** create fetch script, environment manifest, local assets, tests/environment-assets.cjs; modify LICENSES.md.
**Produces:** validated local files/normalization used by renderer. Sources are builder-selected, not pre-approved claims; verify actual CC0 pages and files.

- [ ] Write asset assertions: required entries exist, CC0 provenance and SHA256 present, valid glTF primitives/maps, bounds match vehicle scale (car ~3.5–5.5m long, motor ~1.6–2.5m), all runtime URLs local, aggregate public/assets <=60*1024*1024 bytes.
- [ ] Run `node tests/environment-assets.cjs`: expect FAIL missing manifest.
- [ ] Research primary source CC0 models/foliage/textures and download into separate empty staging directories. Inspect glTF/texture payload and licensing before converting. Use local self-authored conversion tooling only. Prefer one detailed car, one motor and 1–2 organic tree variants with shared maps/LODs within remaining ~22MiB budget. If no suitable asset exists, record real blocker rather than substituting rejected shapes.
- [ ] Create a standalone asset contact sheet/browser close-up (not application replacement), inspect trees from 3 sides (branches, irregular leaf silhouette) and vehicle curves/wheels/glass. Record source, scale, triangle/map size and screenshot evidence. Show these actual assets for approval if quality differs materially from requested realism.
- [ ] Run assets test: expect PASS; preserve visual evidence in this plan's scratch ledger. No product scene integration before this gate passes.

## Task 2: Deterministic lanes, parking and trips

**Files:** create public/mobility.js, tests/mobility.cjs.
**Consumes:** contracts above; Three-free fixture map.
**Produces:** OfficeMobility API, including arrive(tripId,phase), deterministic copied snapshots.

- [ ] Write tests on real core: same seed/dt yields same state; car/motor keep >=0.5m bumper gap; conflicting turn reservations exclusive; full park request returns null; motor-only bay rejects car; duplicate request owner does not duplicate; crossing occupancy stops vehicles before conflict; leave bay reserved for returning owner so traffic cannot steal it; all released at complete/retiring exit.
- [ ] Run `node tests/mobility.cjs`: expect FAIL missing module.
- [ ] Implement longitudinal lane progress with curved/corner waypoint sampling, speed-limited turn sections, conflict ownership and a shared vehicle pool. Bounded fixed substeps (<=1/30s, total catch-up capped at .15s per tick) prevent tunnelling; no runtime timers/random globals. Reserve next conflict only when its exit has space; release behind rear bumper. Advance walking stages via arrive acknowledgments; away timer uses sim time.
- [ ] Add tests: recall at every phase, departure disabled before mount, 10s dt no jump, dt=0 unchanged, full-park return vs crossing clears after occupancy release, no starvation in a bounded 300s fixture. Assert coordinates/displacements/ownership, not solely phase strings.
- [ ] Run pure tests: expect PASS.

## Task 3: Realistic scenery and traffic renderer

**Files:** create office-environment.js, environment-ui.cjs; modify three-global.js and office.js skyline block (~887–1000), applyGraphics/showLevels/frame.
**Consumes:** asset manifest, mobility core. **Produces:** renderer API/layout and visible ambient traffic, no people journey integration yet.

- [ ] Browser test: local assets loaded; real car/motor/tree meshes used (not placeholders); roads/sidewalk/parking and nonoverlapping ingress bounds; car moves along road while paused car does not; graphics tiers keep same logical lanes. Abort one asset and stall another: office reaches ready with an explicit warning and legacy interior still works.
- [ ] Run against an isolated static host via existing suite harness: expect FAIL missing environment integration.
- [ ] Build layout from actual floor-1 parking/door dimensions; document exact lane/parking coordinates in `layout`, not duplicated guessed constants. Replace old skyline and animateSky rather than running both. Match building footprint and world Y: street has continuous ramp connection to parking; pedestrian entry follows doors. Separate city root from parkingRoot so floor-1 parked vehicles stay visible when city is hidden.
- [ ] Load assets with bounded timeout and generation token; tier changes or late loads cannot resurrect disposed roots. Ground uses local textured materials; foliage instancing/shared maps; detailed nearby cars/motorcycles; neighboring buildings/fog provide backdrop without covering office. Shadow casting only near camera. Place car wheels/rider anchors from normalized asset bounds. City camera visibility does not gate core.tick.
- [ ] Drive ambient vehicles through core.update and renderer.update once per simulation frame; avoid old vehicle wrap inside visible area. Add frustum-aware retire/admit on tier caps (low 2, medium 4, high 6, ultra 8 ambient vehicles); limits are render budgets, not parking correctness rules.
- [ ] Run new browser test + graphics-levels/lifecycle/race/dynamic-floors, building-view, assets: expect PASS. Inspect desktop/mobile overview and street captures once, fix all material defects in one batch, confirm once.

## Task 4: Team journey and task-priority return

**Files:** modify office.js routines/updateAgent/syncTaskDisplay/commands/applyOrg/camera; create mobility-team.cjs. Keep server/task execution unchanged.
**Consumes:** `officeTasks.list()`, `officetasks:change`, existing setPath/stair movement, core request/recall/arrive.
**Produces:** real existing team actor walks/rides/returns with one identity.

- [ ] Tests with controlled clock/core fixtures and API-intercepted tasks: assigned queued/active/blocked/review/unknown nonterminal all deny departure; done permits. New task at each travel phase recalls; arriving task during mount cannot enter away loop; reassignment recalls new owner and does not incorrectly keep old owner busy. Assert task runner/API requests not waiting on physical arrival.
- [ ] Run `node tests/mobility-team.cjs` via isolated browser fixture: expect FAIL no journeys.
- [ ] Use small `busyFor(name)` in the adapter reading list on each departure and task change (no copying activeFor semantics). Subscribe existing event, then recheck before mount. Integration checks busy every update until task data ready; no excursions while offline task state is unknown. Maximum 2 away, shared pool capacity.
- [ ] Introduce travel controller ownership in updateAgent/live: existing actor navigates to park, calls arrive only at waypoint tolerance <=.15m, then body is hidden inside car or posed with helmet on motorcycle; label/camera follow vehicle anchor. Actor is never both walker/rider. On return, restore actor and path to actual current desk. Task display must not force a driving person instantly into desk pose. Respect explicit meeting/work commands through safe recall; do not erase assignments.
- [ ] Test routine off/reduced-motion no departure, task arrival during each phase, repeated event idempotence, follow camera switching during riding/walking, member renamed/removed and desk relocated during trip; no duplicate actor/vehicle or stale reservation.
- [ ] Run team tests + people-poses/skinned/hygiene, avatar-stairs, office, member-commands, task-flow: expect PASS.

## Task 5: Visitor lifecycle, cleanup and tier boundaries

**Files:** modify office.js extra()/shop entry/exit and renderer/core disposal as required; create mobility-visitors.cjs and environment-lifecycle.cjs.
**Consumes:** existing barber queue/cashier actors; same parking/trip interface.
**Produces:** arriving/leaving visitors without separate fake passengers, stable lifecycle.

- [ ] Visitor test: arrival reserves slot, drives in, parks, dismounts, walks to shop; no barber queue entry before physical arrival; after service/payment walks back, mounts, exits. Full visitor slots defer arrival, never steal team return slot. Assert position continuity and actual queue count, not animation flags only.
- [ ] Run test: expect FAIL old visitors still spawn at (7,13).
- [ ] Replace only visitor spawn/exit bridge; reuse service queue. Prepopulated barber customers require matching preoccupied parked vehicles or a documented walking visitor mode; don't spawn all vehicles on top of each other. Barber employees stay employed, not treated as visitors.
- [ ] Lifecycle tests: 20 camera/tier switches mid-trip keep same ownership; hidden tab/large dt no tunnelling; pause/resume no elapsed-wall-time jump; routine-off prevents next departure and safely finishes current; remove owner while driving retires outside camera, removing floor reroutes pedestrian return; dispose releases cloned materials/geometries but not shared maps prematurely. Tier cap lowering retires cars offscreen only; failure to load motor suppresses motor trips rather than invisible riders.
- [ ] Run visitor/lifecycle plus graphics-lifecycle/race/performance, workspace-lifecycle, nav-hardening: expect PASS.

## Task 6: Acceptance, documentation and independent review

**Files:** README.md, tests/graphics-performance.cjs if justified, plan ledger. No broad refactoring.

- [ ] Run `npm test` into plan scratch log; read all failures and final count. Fix regressions with RED/GREEN, never hide failures by changing assertions without root cause.
- [ ] At 1920x1080 on actual detected GPU measure warmed 4s FPS (3 samples) with 30 team, high/ultra, ambient traffic active and 2 excursions; report min/median, calls/triangles/resource counts. Assert High median >30 and assets <=60MiB. If below target, profile foliage/shadow/draw/skinning before changing caps or quality; don't silently lower target.
- [ ] Capture desktop + mobile overview, tree/car/motor closeups, basement parked, street ingress and one entire trip with task arrival. Inspect full bodies/vehicle clearances, road contact, turning, rider seat/helmets, doorway/ramp access and whether office remains focal. No completion claim based only on counters. One batch fix and one confirmation pass.
- [ ] Update README controls/eligibility/recall, tier behavior, sources/failure behavior and measured numbers. graphify update .; record all rulings and unmet requirements.
- [ ] One fresh independent reviewer for the complete uncommitted environment change, spec and ledger; verify findings and fix confirmed Important/Critical with failing regression tests and green full suite. No review loop, no commits. Keep scratch ledger because there is no committed history replacing it.
- [ ] Handoff factual final summary, deferred minor findings, exact test/FPS/size evidence and preview URL; leave live data and port-3000 processes untouched.

## Plan self-review

Spec coverage: visual assets Task1/3, traffic/parking Task2/3, team/task priority Task4, visitors/lifecycle Task5, performance/verification Task6. Five Review Focus cases are assigned to tests. Exact APIs above shared by consumers; arrive acknowledgment avoids guessed walking durations. Asset sourcing remains a gated discovery step (no unverified model URL pinned as fact); CC0 availability and visual acceptance are real prerequisites, not guaranteed outcomes. Work is native by prior user preference, with one final independent review.
