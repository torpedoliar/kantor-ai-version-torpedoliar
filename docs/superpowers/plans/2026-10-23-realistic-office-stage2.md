# Textured Human Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task. No commits without an explicit owner request.

**Goal:** Replace chibi/procedural character meshes with textured adult humans, stable individual variation and working office animations.

**Architecture:** Convert verified MakeHuman CC0 source mesh, adult morph targets, skeleton weights and system clothing/hair assets to two compact local glTF models. `office-people.js` loads and clones skinned models; a pose adapter translates the existing office rig controls into bone rotations. The procedural prototype is opt-in (`?people=draft`) until the textured implementation is verified, never claimed as final realism.

**Tech Stack:** Existing Three.js0.160 GLTFLoader, local SkeletonUtils clone, Python3/Pillow for offline asset preparation; no new runtime framework or build step.

**Spec:** docs/superpowers/specs/2026-10-22-realistic-office-graphics-design.md

## Global Constraints
- Finish stage1 verification before enabling stage2 by default.
- Preserve navigation, floor transitions, seating, interactions, labels, props, per-division colour and all graphics levels.
- All downloaded data CC0 with exact source URLs and license text. No runtime CDN; public/assets total ≤60MiB.
- No live workspace/org mutation. Tests use synthetic data/browser state.
- Human dimensions measured in neutral standing pose; never infer height by adding a seated offset or mutating active animation for a passing assertion.
- Native implementation, no commits/push. Asset download is authorized; do not execute scripts from downloaded packs.

## Verified sources
- MakeHuman base mesh, default skeleton and weights: https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data
- Asset license: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md (section C assetsCC0; section D exports unrestricted).
- System pack: https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip (280737770bytes; downloaded to .superpowers/downloads/humans-20261023/system-assets.zip).
- Pack entries inspected: male_casualsuit02, female_casualsuit01, short01, bob01, young_asian_male/female and young_african_male/female, including explicit CC0 headers.

## Review Focus
- Clothes skin weights follow body at shoulders, elbows, knees (Task2 deformation tests).
- Model clone skeleton/material ownership: moving one person cannot deform/recolour another (Task3).
- Missing GLB/texture yields old rig fallback + visible warning, not a blank office (Task3).
- Sitting soles and hands fit actual chair/table; no detached props (Task4).
- Repeated org changes free removed per-person clones; graphics level changes keep photo skin/palette coherent (Task5).

### Task 1: Prepare local textured assets
**Files:** scripts/prepare-people.py, public/assets/people/{male,female}.gltf + binary buffers + textures, people.json, public/assets/LICENSES.md.
**Interfaces:** people.json lists each template, texture variants, skeleton map and source/license metadata. Keep skin/hair/clothes separate materials.
- [ ] Add tests/people-assets.cjs: glTF contains skins,JOINTS_0,WEIGHTS_0; weights normalized; adult head-to-height ratio<.17, standing1.6–2.0m; male/female templates differ; textures exist, ≤1024px; total assets≤60MiB.
- [ ] Run test RED absent people assets.
- [ ] Prepare using official OBJ base body group only (exclude helper/joint meshes). Apply adult male/female macro target deltas. Bone head/tail positions come from average referenced base vertices in default.mhskel; skin weights from default_weights.mhw, keep highest4 normalized influences.
- [ ] Fit system clothes/hair via mhclo barycentric vertex mapping and scaled offsets; transfer weights through the same body-vertex references. Use mhclo delete_verts to hide skin under clothes. Add eyes from system asset. No nude fallback enabled.
- [ ] Export glTF buffers offline with correct inverse bind matrices, meters units, Y-up. JPEG skin/clothes1024; alpha hair PNG≤512. Copy only needed pack files; never execute pack code.
- [ ] Run asset test GREEN.

### Task 2: Validate mesh deformation and retarget map
**Files:** scripts/prepare-people.py, public/assets/people/people.json; tests/people-deformation.cjs.
**Interfaces:** logical bones root/hips/spine/head,shoulder/elbow/wrist,thigh/knee/ankle mapped to exact exported bone names, neutral quaternion and local angle-axis conversion.
- [ ] RED: CPU sample skinned vertices at elbow/knee before/after90° rotation, assert displacement localized and finite; neutral feet nearY0,neutral crown1.6–2.0m.
- [ ] Correct bind transforms, clothing correspondence and neutral arm-down pose (MakeHuman rest arms are angled).
- [ ] GREEN deformation test and people-assets.

### Task 3: Load textured human rigs
**Files:** public/office-people.js (replace prototype), public/three-global.js, public/vendor/three/utils/SkeletonUtils.js; tests/people-realistic.cjs.
**Interfaces:** officePeople.ready():Promise,build(person,divisionColor):rig|null; rig retains figure/body/hips/head/legs/arms/cup/phone/cue and metadata but renders a SkinnedMesh, not disconnected capsules.
- [ ] RED browser assertions: actual textured SkinnedMesh, normalized skin attributes, individual skeleton instances; same name stable skin/hair/build afterreload; changing first person's arm/shirt does not alter second.
- [ ] Vendor SkeletonUtils via existing vendor script. Load templates once; cloned bones per person, shared geometry/textures, per-person tintable clothing materials.
- [ ] Deterministic name hash chooses skin tone/texture,hair style and width/height build. Do not infer pronouns or identity from appearance. Existing gender metadata chooses compatible template; unspecified uses deterministic template.
- [ ] Missing model test aborts people request, assert legacy figure fallback and status warning. Enable default only after GREEN.

### Task 4: Integrate office poses and props
**Files:** public/office.js blendPose/pose/shopPose/character/extra/followCamera; tests/people-poses.cjs.
- [ ] RED: neutral standing grounded; desk seated hips within0.08m of chair seat, shoes abovefloor, hands within0.15m of keyboard; walking changes knee/elbow transforms; talking turns head; phone/cup visible only matching activity.
- [ ] Adapter applies logical pose controllers to bones relative to neutral bind rotations. Calibrate seated body drop from hip/chair heights (do not hardcode prototype proportions). Attach props to wrist bones; follow-camera eye offset from head world position.
- [ ] Run existing soft-avatar,avatar-stairs,furniture-activity,member-commands tests. Preserve equivalent behavioral assertions, never weaken tests just for new mesh.

### Task 5: Performance, lifecycle and visual verification
**Files:** tests/people-lifecycle.cjs,tests/graphics-performance.cjs,README.md; stage2 ledger.
- [ ] RED: repeated roster removal/addition releases per-person material/skeleton resources;30people stable animation, no cross-person bone drift.
- [ ] Measure actual1080p Ultra13people and High30people FPS using existing GPU launcher; target>30FPS. Share immutable mesh/texture resources, bound draw calls; no hidden cap on headcount.
- [ ] Capture desktop/mobile floor3,additional workfloor,lobby/visitors,roof,building view plus unobscured front/side standing+seated closeups. Confirm skin/clothing texture is visible, adults not toy proportions, floor/seat alignment.
- [ ] npm test, graphify update ., independent end review then one tested fix pass. Report actual suite result, GPU/FPS and remaining limitations; no GTA-equivalence claim.

## Self-review
Tasks1→2 share skin weights and skeleton metadata;2→3 same exact exported bone map;3→4 logical rig API preserves office callers;5 checks resource ownership from3. Asset selection delegated by approved spec; no new owner choices needed. If CC0 pack cannot yield correctly dressed skinned adults, stop at a specific asset/tool blocker rather than substituting capsule humans as completion.
