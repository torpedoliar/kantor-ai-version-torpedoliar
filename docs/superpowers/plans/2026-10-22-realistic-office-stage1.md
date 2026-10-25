# Kantor Realistis — Tahap 1 (ruang kantor + level grafis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kantor 3D tampil mendekati interior GTA V (material foto, perabot model asli, cahaya siang + pantulan, AO, bloom) dengan pemilih level grafis Low/Medium/High/Ultra, tanpa merusak perilaku yang ada.

**Architecture:** Three.js di-upgrade ke 0.160.0 dan di-vendor lokal; modul kecil `three-global.js` mengekspos `window.THREE` (+ addon) supaya `office.js` tetap gaya IIFE. Level grafis hidup di `public/graphics.js` (tabel level, deteksi default, simpan pilihan) dan diterapkan oleh `office.js` lewat satu fungsi `applyGraphics(level)`. Permukaan memakai material PBR bernama (`surface(name)`) dari tekstur CC0; perabot memakai model GLB CC0 yang di-fit ke ukuran lama sehingga grid navigasi dan kursi tidak bergeser. Orang tetap figur prosedural di tahap ini (Tahap 2 = karakter ber-rig).

**Tech Stack:** Three.js 0.160.0 (ES modules, import map), glTF/GLB, Poly Haven CC0 textures/HDRI/models, Quaternius/Kenney CC0 models, Playwright tests (`tests/browser.cjs`).

**Spec:** `docs/superpowers/specs/2026-10-22-realistic-office-graphics-design.md`

## Global Constraints
- Vanilla JS di `public/`, tanpa build step; tidak ada request runtime ke CDN (semua di `public/vendor/` dan `public/assets/`).
- Three.js **0.160.0** persis.
- Aset hanya **CC0**, total `public/assets/` **≤ 60 MB**, setiap aset tercatat di `public/assets/LICENSES.md` (nama, sumber URL, lisensi).
- Level: `low` | `medium` | `high` | `ultra` dengan nilai persis:
  - low: pixelRatio ≤ 0.75, shadows off, env off, textures off, post off
  - medium: pixelRatio ≤ 1, shadow 1024 (PCF), textures 1K, env off, post off
  - high: pixelRatio ≤ 1.25, shadow 2048 (PCFSoft), textures 1K, env HDRI + ACES, post off
  - ultra: pixelRatio ≤ 2, shadow 4096 (PCFSoft), textures 2K, env HDRI + ACES, SAO (setengah resolusi) + bloom
- Default: `low` bila `navigator.webdriver` atau tanpa WebGL2; `high` bila renderer GPU tidak mengandung `SwiftShader|llvmpipe|Basic Render` dan `navigator.hardwareConcurrency ≥ 4`; selain itu `medium`. Query `?graphics=<level>` menimpa; pilihan tersimpan di `localStorage['kantor-ai.graphics.v1']` (try/catch).
- Tidak ada penurunan level otomatis.
- Garis tepi "paper model" (`EdgesGeometry`/`lineMaterial`) dan `MeshToonMaterial` dihapus.
- Semua test lama (`npm test`) tetap lulus; test berjalan di Low (otomatis karena `navigator.webdriver`).
- Tanpa commit kecuali owner meminta.

## Review Focus
1. Aset gagal dimuat (file hilang/korup) → kantor tetap tampil dengan material/perabot prosedural, satu peringatan di `#sceneStatus`, tanpa page error. (Test di Task 5.)
2. Mengganti level berulang (Low→Ultra→Low→High) → tidak ada kebocoran: jumlah `renderer.info.memory.textures` kembali ≤ nilai awal level itu + 2, composer lama di-dispose. (Test di Task 3.)
3. Cahaya setelah perubahan unit fisik r155+ → layar tidak gelap/terbakar: rata-rata luminans screenshot lantai 3 di tiap level dalam 0.25–0.80. (Test di Task 7.)
4. Model GLB mengubah footprint → grid navigasi dan kursi tetap sama: `navGrid(3)` sel terblokir berbeda ≤ 3% dari baseline sebelum model. (Test di Task 5.)
5. `localStorage` diblokir/private mode → level default tetap terpakai, pemilih tetap berfungsi selama sesi. (Test di Task 3.)

---

### Task 1: Three.js 0.160.0 vendored + migrasi API

**Files:**
- Create: `public/vendor/three/` (salinan `build/three.module.min.js` dan addon yang dipakai dari `examples/jsm/` dengan path asli: `postprocessing/{EffectComposer,RenderPass,ShaderPass,MaskPass,Pass,SAOPass,UnrealBloomPass,OutputPass}.js`, `shaders/{CopyShader,SAOShader,DepthLimitedBlurShader,UnpackDepthRGBAShader,LuminosityHighPassShader,OutputShader}.js`, `loaders/{GLTFLoader,RGBELoader}.js`, `utils/BufferGeometryUtils.js`, `environments/RoomEnvironment.js`, `math/SimplexNoise.js` bila diimpor), `scripts/vendor-three.mjs` (pengunduh sekali jalan dari `cdn.jsdelivr.net/npm/three@0.160.0/`)
- Create: `public/three-global.js` (module)
- Modify: `public/index.html:139-140`, `public/office.js` (encoding, toon, edges)
- Test: `tests/three-upgrade.cjs`

**Interfaces:**
- Produces: `window.THREE` = salinan namespace core + `THREE.addons = {EffectComposer, RenderPass, SAOPass, UnrealBloomPass, OutputPass, GLTFLoader, RGBELoader, RoomEnvironment}`; `office.js` dimuat sebagai `<script type="module">` setelah `three-global.js`.

- [ ] **Step 1: Write the failing test** `tests/three-upgrade.cjs` (gaya `tests/office.cjs`, memakai `OFFICE_URL`):
```js
const requests=[];page.on('request',r=>requests.push(r.url()));
await page.goto(URL);await page.waitForFunction(()=>window.officeScene);
assert.equal(await page.evaluate(()=>THREE.REVISION),'160');
assert.ok(await page.evaluate(()=>!!THREE.addons?.GLTFLoader&&!!THREE.addons?.EffectComposer));
assert.equal(requests.filter(u=>/cdnjs|jsdelivr|unpkg/.test(u)).length,0,'no CDN at runtime');
assert.equal(await page.evaluate(()=>document.querySelector('#c')&&officeScene.snapshot().team.length),13);
assert.deepEqual(errors,[]);
```
- [ ] **Step 2: Run** `node tests/three-upgrade.cjs` with the static host (`npm test` runs it; alone: start `npx http-server public -p 4173` or reuse the suite's host). Expected: FAIL `'128' !== '160'`.
- [ ] **Step 3: Implement.** Run `node scripts/vendor-three.mjs` once (downloads the listed files into `public/vendor/three/` keeping `examples/jsm` relative imports working; core imported as `three` via import map `{"imports":{"three":"./vendor/three/three.module.min.js","three/addons/":"./vendor/three/"}}`). `three-global.js`: `import * as T from 'three'` + addons → `window.THREE=Object.assign({},T,{addons})`. Migrate `office.js`: `outputEncoding/sRGBEncoding` → `outputColorSpace=THREE.SRGBColorSpace`, every `texture.encoding=THREE.sRGBEncoding` → `texture.colorSpace=THREE.SRGBColorSpace`, delete `toneSteps`, glass materials → `MeshPhysicalMaterial({transmission:0, transparent:true, opacity, roughness:.05, metalness:0})`, remove `EdgesGeometry` lines (the `edges` param becomes a no-op and is then removed from `mesh()`), multiply every light intensity by `Math.PI` as the starting calibration (Task 7 fine-tunes).
- [ ] **Step 4: Run** `node tests/three-upgrade.cjs` then `npm test`. Expected: PASS; full suite 0 failed.

### Task 2: Aset CC0 (tekstur, HDRI, model) + manifest

**Files:**
- Create: `scripts/fetch-assets.mjs`, `public/assets/manifest.json`, `public/assets/LICENSES.md`, `public/assets/textures/<name>/{1k,2k}/{diff,nor,rough}.jpg`, `public/assets/hdri/<name>_1k.hdr`, `public/assets/models/<name>.glb`
- Test: `tests/assets.cjs`

**Interfaces:**
- Produces: `manifest.json` = `{textures:{[name]:{1k:{diff,nor,rough},2k:{...},repeat:[u,v]}}, hdri:{interior:path}, models:{[name]:{file, fit:'footprint'|'height'}}}`. Texture names (fixed): `parquet_herringbone`, `wood_planks_light`, `plaster_white`, `wood_panel_walnut`, `concrete_ceiling`, `fabric_sofa`, `rug_shaggy`, `rug_pattern`, `metal_brushed`, `metal_black`, `leather_brown`, `marble_white`, `brick_painted`, `asphalt`, `tiles_kitchen`. Model names (fixed, chosen from Poly Haven models / Quaternius “Ultimate Furniture” / Kenney “Furniture Kit”): `desk`, `office_chair`, `monitor`, `keyboard`, `laptop`, `sofa_sectional`, `armchair`, `coffee_table_glass`, `tv_cabinet`, `tv`, `dining_table`, `dining_chair`, `bookshelf`, `pendant_lamp`, `arc_lamp`, `floor_lamp`, `plant_tall`, `plant_small`, `painting`, `mug`, `books`, `speaker`, `stool`, `bed_bean`.

- [ ] **Step 1: Write the failing test** `tests/assets.cjs` (pure Node):
```js
const m=JSON.parse(fs.readFileSync('public/assets/manifest.json'));const lic=fs.readFileSync('public/assets/LICENSES.md','utf8');
for(const f of allPaths(m))assert.ok(fs.existsSync(path.join('public',f)),f);
for(const name of [...Object.keys(m.textures),...Object.keys(m.models),...Object.keys(m.hdri)])assert.match(lic,new RegExp(`\\b${name}\\b`));
assert.ok(!/CC-BY|CC BY|non-commercial/i.test(lic)&&/CC0/.test(lic));
assert.ok(dirSize('public/assets')<=60*1024*1024);
for(const f of glbPaths(m))assert.equal(fs.readFileSync(path.join('public',f)).subarray(0,4).toString(),'glTF');
```
- [ ] **Step 2: Run** `node tests/assets.cjs`. Expected: FAIL (no manifest).
- [ ] **Step 3: Implement** `fetch-assets.mjs`: Poly Haven API (`https://api.polyhaven.com/files/<id>`) for textures (jpg 1k/2k: Diffuse, nor_gl, Rough), one HDRI (1k), and models (gltf → packed GLB); Quaternius/Kenney packs downloaded from their CC0 zip URLs and the needed GLBs extracted. Write manifest + LICENSES.md (asset, source URL, author, CC0). Resize/compress so total ≤ 60 MB (prefer JPG quality 82, drop 2k normal maps first if over budget). Run it once; commit-ready files stay in repo.
- [ ] **Step 4: Run** `node tests/assets.cjs`. Expected: PASS.

### Task 3: Level grafis (graphics.js + Pengaturan + penerapan di renderer)

**Files:**
- Create: `public/graphics.js`
- Modify: `public/index.html` (script tag before `office.js`; `<select id="settingsGraphics">` in “Pengaturan umum” with options Low/Medium/High/Ultra and a `<label><input type="checkbox" id="settingsFps"> Tampilkan FPS</label>`), `public/settings.js` (bind select → `officeGraphics.set`), `public/office.js` (`applyGraphics`, composer in render loop, FPS label)
- Test: `tests/graphics-levels.cjs`

**Interfaces:**
- Produces: `window.officeGraphics = {LEVELS, level():string, set(level:string):string, onChange(fn)}`; `LEVELS[level] = {pixelRatio, shadow:0|1024|2048|4096, textures:null|'1k'|'2k', env:boolean, ao:boolean, bloom:boolean}` with the Global Constraints values. `office.js`: `applyGraphics(level)` (pixel ratio, shadowMap.enabled/type/mapSize + dispose old map, toneMapping, `scene.environment`, swaps texture tier via `surfaces.setTier(tier)` from Task 4, builds/disposes `EffectComposer`). `officeScene.snapshot().graphics = {level, shadows:boolean, environment:boolean, post:string[] /* e.g. ['sao','bloom'] */, textures:null|'1k'|'2k', drawCalls:number, textureCount:number}`.

- [ ] **Step 1: Write the failing test** `tests/graphics-levels.cjs`:
```js
await page.goto(URL);await page.waitForFunction(()=>window.officeScene);
let g=await page.evaluate(()=>officeScene.snapshot().graphics);assert.equal(g.level,'low','automated browser defaults to low');
assert.deepEqual([g.shadows,g.environment,g.post,g.textures],[false,false,[],null]);
// open Settings → choose Ultra
await page.locator('#railMore').evaluate(n=>n.open=true);await page.click('#bSettings');await page.selectOption('#settingsGraphics','ultra');
await page.waitForFunction(()=>officeScene.snapshot().graphics.level==='ultra');
g=await page.evaluate(()=>officeScene.snapshot().graphics);assert.deepEqual([g.shadows,g.environment,g.post,g.textures],[true,true,['sao','bloom'],'2k']);
const lowTex=0;for(const l of ['low','ultra','low','high','low'])await page.selectOption('#settingsGraphics',l);
await page.waitForFunction(()=>officeScene.snapshot().graphics.level==='low');
const afterTex=await page.evaluate(()=>officeScene.snapshot().graphics.textureCount);
await page.reload();await page.waitForFunction(()=>window.officeScene);
assert.equal(await page.evaluate(()=>officeScene.snapshot().graphics.level),'low','choice persisted');
assert.ok(afterTex<=baselineLowTextures+2,'switching levels does not leak textures');
// ?graphics= overrides; blocked storage still works
await page.goto(URL+'?graphics=medium');await page.waitForFunction(()=>window.officeScene);assert.equal(await page.evaluate(()=>officeScene.snapshot().graphics.level),'medium');
const ctx2=await browser.newContext();const p2=await ctx2.newPage();await p2.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})});
await p2.goto(URL);await p2.waitForFunction(()=>window.officeScene);await p2.evaluate(()=>officeGraphics.set('high'));assert.equal(await p2.evaluate(()=>officeScene.snapshot().graphics.level),'high');
assert.deepEqual(errors,[]);
```
(`baselineLowTextures` = `textureCount` read right after first load.)
- [ ] **Step 2: Run** `node tests/graphics-levels.cjs`. Expected: FAIL (`graphics` undefined).
- [ ] **Step 3: Implement** per Interfaces. SAO: `new SAOPass(scene,camera,new THREE.Vector2(w/2,h/2))` with params `{saoIntensity:.012,saoScale:4,saoKernelRadius:40,saoBlur:true}` (mockup values); bloom `UnrealBloomPass(size/2,.35,.6,.85)`; `OutputPass` last. Composer resized in the existing resize handler. FPS label `#fpsLabel` shown only when `#settingsFps` checked (stored in the existing general prefs).
- [ ] **Step 4: Run** `node tests/graphics-levels.cjs` and `node tests/settings-ui.cjs`. Expected: PASS both.

### Task 4: Material PBR bernama untuk semua permukaan

**Files:**
- Create: `public/office-surfaces.js` (module, loaded by `three-global.js`, exposes `window.officeSurfaces`)
- Modify: `public/office.js` (`material(color)` → `surface(name)` for floors, walls, ceilings, desks, sofas, rugs, metal, glass, kitchen, rooftop, facade, road)
- Test: extend `tests/graphics-levels.cjs`

**Interfaces:**
- Consumes: `manifest.json` (Task 2), `officeGraphics` (Task 3).
- Produces: `officeSurfaces.surface(name:string, opts?:{repeat?:[number,number], tint?:number}) → THREE.MeshStandardMaterial|MeshPhysicalMaterial` (cached per name+opts); `officeSurfaces.setTier(null|'1k'|'2k') → Promise<void>` (loads maps lazily, sets/clears `map/normalMap/roughnessMap`, disposes the unused tier); `officeSurfaces.names` = manifest texture names + `'glass'`, `'roofglass'`, `'screen'` (emissive, canvas-texture work content), `'lampGlow'` (emissive). Unknown palette colors keep `material(color)` but with `roughness:.6`.
- Mapping (fixed): work floors → `parquet_herringbone`; lobby/dining floors → `wood_planks_light`; walls → `plaster_white`; feature walls behind TV/desk groups/meeting room → `wood_panel_walnut`; ceilings → `concrete_ceiling` with exposed black beams (`metal_black`); sofas/armchairs → `fabric_sofa` (accent cushions tinted orange/red/black like the reference); lounge rugs → `rug_shaggy`, meeting rug → `rug_pattern`; desk legs, lamp poles, window frames → `metal_black`; appliances → `metal_brushed`; kitchen counters → `marble_white`, backsplash → `tiles_kitchen`; barber chairs → `leather_brown`; exterior/stairs core → `brick_painted`; street → `asphalt`.

- [ ] **Step 1: Write the failing test** (append to `graphics-levels.cjs`): at `medium`, `await page.evaluate(()=>officeScene.surfaceAudit(3))` returns `{textured:number, flat:number}` for floor 3 meshes ≥ 0.2 m²; assert `textured/(textured+flat) ≥ 0.8`; at `low` assert `textured===0`.
- [ ] **Step 2: Run.** Expected: FAIL (`surfaceAudit` missing).
- [ ] **Step 3: Implement** `office-surfaces.js` + replace calls in builders (`shell`, `table`, `chair`, `sofa`, `restroom`, `buildFacadeLevel`, kitchen/rooftop builders, `car` road). Add `officeScene.surfaceAudit(level)`.
- [ ] **Step 4: Run** `node tests/graphics-levels.cjs`, `npm test`. Expected: PASS, suite 0 failed.

### Task 5: Perabot model GLB yang di-fit ke footprint lama

**Files:**
- Create: `public/office-models.js` (exposes `window.officeModels3d`)
- Modify: `public/office.js` (startup awaits models before building floors and before nav rasterization; builders `table`, `chair`, `screen`, `sofa`, `armchair`, `plant`, `floorLamp`, `diningChair`, `stool`, `billiard`, `lantern`, inventory `runtimeFurniture` use models)
- Test: `tests/office-models.cjs`

**Interfaces:**
- Produces: `officeModels3d.load():Promise<{loaded:string[], failed:string[]}>`; `officeModels3d.place(name, {w,h,d}, parent, {x,y,z,rotY}) → THREE.Object3D|null` (clone, scale so its bounding box fits w×h×d keeping proportions on the ground plane, center on footprint, `castShadow/receiveShadow`, returns `null` when the model failed so the caller builds the old procedural shape). `officeScene.snapshot().models = {loaded:number, failed:string[]}`.

- [ ] **Step 1: Write the failing test** `tests/office-models.cjs`:
```js
// baseline nav from the procedural build, then the model build
const base=await navBlocked(URL+'?models=off');const withModels=await navBlocked(URL);
assert.ok(Math.abs(withModels-base)/base<=.03,'models keep the walking grid');
const s=await page.evaluate(()=>officeScene.snapshot().models);assert.ok(s.loaded>=20);assert.deepEqual(s.failed,[]);
// a missing model falls back without page errors
await page.route('**/assets/models/office_chair.glb',r=>r.abort());await page.goto(URL);await page.waitForFunction(()=>window.officeScene);
assert.deepEqual(await page.evaluate(()=>officeScene.snapshot().models.failed),['office_chair']);
assert.match(await page.textContent('#sceneStatus'),/aset/i);assert.deepEqual(errors,[]);
```
(`navBlocked(url)` = count of non-zero cells in `officeScene.navGrid(3).cells`. `?models=off` = debug switch that skips models.)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces; `#sceneStatus` shows `Sebagian aset 3D gagal dimuat; memakai bentuk sederhana.` when `failed.length`.
- [ ] **Step 4: Run** `node tests/office-models.cjs` then `node tests/customize.cjs tests/inventory.cjs tests/furniture-activity.cjs tests/avatar-stairs.cjs` (each). Expected: PASS all.

### Task 6: Dressing ruangan sesuai referensi (detail & barang kecil)

**Files:**
- Modify: `public/office.js` (new `dress(level)` called per floor after builders)
- Test: `tests/office-models.cjs` (extend)

**Interfaces:**
- Consumes: `officeModels3d.place`, `officeSurfaces.surface`.
- Produces: `officeScene.decor(level) → {total:number, kinds:string[]}`; decor objects carry `userData.decor=true` and are skipped by nav rasterization unless taller than 0.6 m.

Fixed content per floor (positions chosen by builder inside existing free areas, never on walk paths):
- Work floors: per desk → `monitor` (screen surface showing code/doc/chart canvas variants), `keyboard`, mug or books on alternating desks; per desk group → one `plant_small`; lounges → `sofa_sectional` + `coffee_table_glass` + `rug_shaggy` + `arc_lamp` + accent cushions; meeting room → `tv` on `wood_panel_walnut` wall + `rug_pattern`; per floor ≥ 2 `painting`, 2 `plant_tall`, 1 `bookshelf` with `books`, ceiling `pendant_lamp`s over desk groups, floor-to-ceiling window frames (`metal_black`) on the facade sides.
- Dining: `dining_table` + `dining_chair`s, pendants, marble counters, backsplash tiles, plants.
- Lobby/barber: leather chairs, mirrors, `speaker`, plants, painting.
- Rooftop: keep existing items; add rugs/cushions to lounge, `plant_tall` planters.

- [ ] **Step 1: Write the failing test:** for floor 3 `decor(3).total ≥ 60` and `kinds` ⊇ `['monitor','keyboard','plant_small','plant_tall','painting','bookshelf','pendant_lamp','sofa_sectional','coffee_table_glass','rug_shaggy','arc_lamp','tv']`; floors 1, 2, 4 `total ≥ 15`; and every seat in `officeScene.snapshot()` agents still reaches its desk (reuse the assertion from `tests/furniture-activity.cjs`: all agents `state==='work'` within 20 s of `?fast=1` start).
- [ ] **Step 2: Run.** Expected: FAIL (`decor` missing).
- [ ] **Step 3: Implement** `dress(level)`.
- [ ] **Step 4: Run** test + `npm test`. Expected: PASS, suite 0 failed.

### Task 7: Pencahayaan & kalibrasi per level

**Files:**
- Modify: `public/office.js` (`buildLights`, `buildingMood`, sun/hemi values, window light, emissive lamps/screens, HDRI environment via `RGBELoader` + `PMREMGenerator` for high/ultra, `RoomEnvironment` fallback when HDRI fails)
- Test: `tests/graphics-lighting.cjs`

**Interfaces:**
- Consumes: `officeGraphics`, manifest `hdri.interior`.
- Produces: no new API; `snapshot().graphics.environment` true only for high/ultra.

- [ ] **Step 1: Write the failing test** `tests/graphics-lighting.cjs`: for each level in `low,medium,high,ultra` (via `?graphics=`), set floor 3, `setCamera({target:[0,1,2],theta:.8,phi:1.0,radius:18})`, wait 2 frames, screenshot `#c`, compute mean luminance (decode PNG with `zlib` inflate of IDAT, or `page.evaluate` drawing the WebGL canvas into a 2D canvas with `preserveDrawingBuffer` read via `toDataURL`); assert `0.25 ≤ mean ≤ 0.80`; also building view (`data-floor=0`) and evening (`buildingMood`) within the same range.
- [ ] **Step 2: Run.** Expected: FAIL on at least one level (physical units after Task 1).
- [ ] **Step 3: Implement:** daylight sun (warm, from window side, shadow camera fitted to the active floor), cool hemisphere fill, window light planes, warm `PointLight`s only for pendants/arc lamps near the camera floor (max 6 non-shadow), emissive screens/lamp shades for bloom, ACES exposure ≈ 1.0. Calibrate until the test passes.
- [ ] **Step 4: Run** test + `node tests/building-view.cjs`. Expected: PASS.

### Task 8: Performa, README, suite penuh

**Files:**
- Modify: `public/office.js` (merge static geometry per floor with `BufferGeometryUtils.mergeGeometries` grouped by material; `InstancedMesh` for repeated decor like keyboards/mugs/books; frustum culling on; shadows only from sun), `README.md` (section “Level grafis & aset”), `.superpowers/agent-context-enhancements.md` (ledger)
- Test: extend `tests/graphics-levels.cjs`

- [ ] **Step 1: Write the failing test:** at `ultra`, floor 3 default camera, `snapshot().graphics.drawCalls ≤ 600`; at `low` ≤ 400; 30 people via `officeScene.syncRoster` (reuse roster helper from `tests/autonomous-floors.cjs`) still ≤ 700 at ultra.
- [ ] **Step 2: Run.** Expected: FAIL (draw calls above budget after Tasks 5–6).
- [ ] **Step 3: Implement** merging/instancing until within budget; README documents levels, default rule, FPS toggle, asset licenses file, and that people are upgraded in Tahap 2.
- [ ] **Step 4: Run** `npm test`. Expected: all files passed, 0 failed. Then `graphify update .`.
- [ ] **Step 5: Owner check (manual):** open `http://127.0.0.1:8080` on owner's machine at Ultra; owner reports FPS (target ≥ 30) and visual verdict against the GTA references.
