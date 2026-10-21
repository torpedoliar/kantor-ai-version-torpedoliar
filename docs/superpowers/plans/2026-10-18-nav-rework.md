# Rework Navigasi (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti header, modal bertumpuk, dan toolbar 13 tombol dengan rail kiri + drawer, toolbar ringkas, log lipat, tombol Tim, dan PIN di level aplikasi. Semua teks UI berbahasa Indonesia.

**Architecture:**
- File baru `public/nav.js` menjadi satu-satunya pemilik rail dan drawer (`window.officeNav`).
- `<dialog>` tugas dan pengaturan tetap memakai id yang sama, tapi dibuka non-modal sebagai drawer lewat `officeNav.open(id)`.
- Panel Organisasi pindah dari tab Tasks ke drawer sendiri.
- `tasks.js` tetap pemilik `orgToken` dan dialog PIN.
- `office.js` hanya kehilangan wiring header, caption, dan toolbar lama.

**Tech Stack:**
- Vanilla JS/CSS/HTML di `public/`
- Node 22 `server/server.js`
- Tes `tests/*.cjs` memakai `node:assert` + Playwright (tanpa framework)

**Spec:** `docs/superpowers/specs/2026-10-18-nav-org-rework-design.md` §2

## Global Constraints

- **Teks UI:** Semua teks UI berbahasa Indonesia, tanpa i18n dan tanpa kamus terjemahan.
- **Id elemen:** Id yang sudah ada dipertahankan bila elemennya masih ada (`#bTasks`, `#bPause`, `#bRoutine`, `#bLunch`, `#bRoof`, `#bPray`, `#bWork`, `#bZoomIn`, `#bZoomOut`, `#bRotate`, `#bReset`, `#bMusic`, `#bCustom`, `#bSettings`, `#bLog`, `#decisions`, `#taskDialog`, `#settingsDialog`, `#closeTasks`, `#settingsClose`, `#orgPanel`, `#orgPin`). Tes lama cukup menyesuaikan langkah, tidak perlu mengganti selector.
- **Elemen dihapus:** `#header`, `#teamSelect`, `#teamFaces`, `#floorCaption`, `#cameraHint`, `#taskOrgTab`, `#taskOrgView`.
- **Drawer:** satu drawer terbuka pada satu waktu. Esc menutup lapisan teratas dengan urutan `#pinDialog` → drawer → kamera karakter. Rail "Kantor" menutup semua drawer.
- **Layout:** tidak ada scroll horizontal di lebar 375, 768, dan 1440px. Target sentuh minimal 44px.
- **Dependensi:** tidak ada dependensi baru.

## Review Focus

1. **Drawer dibuka saat mode Tata ruang aktif.** Customize harus keluar dulu, karena drawer dan panel customize tidak boleh tumpang-tindih. Tes ada di Task 1.
2. **Esc saat kamera karakter aktif dan drawer terbuka.** Esc pertama hanya menutup drawer, Esc kedua baru keluar dari kamera. Tes ada di Task 1.
3. **Token org basi setelah server restart.** Server menjawab 403 "owner unlock". Token di `sessionStorage` harus dihapus dan dialog PIN muncul lagi, bukan hanya pesan error. Tes ada di Task 2.
4. **Pindah drawer saat Pengaturan punya perubahan belum disimpan.** Konfirmasi `dirty` di `settings.js` tetap muncul. Kalau ditolak, drawer Pengaturan tetap terbuka. Tes ada di Task 1.
5. **Rail di 375px.** Rail jadi bar bawah dan tidak boleh menutupi toolbar simulasi atau tombol kamera. Tes ada di Task 6.

---

### Task 1: Rail + drawer (`nav.js`), header dihapus

**Files:**
- Create: `public/nav.js`
- Create: `tests/nav.cjs`
- Modify: `public/index.html`
  - Hapus `#header` (baris 17–27).
  - Tambah `<nav id="rail">`.
  - Muat `nav.js` sebelum `settings.js`.
- Modify: `public/tasks.js:328` — `showModal()` diganti `officeNav.open('taskDialog')`. `#closeTasks` → `officeNav.close()`.
- Modify: `public/settings.js:30` — `open` memakai `officeNav.open('settingsDialog')`. `close()` tetap melakukan cek `dirty`.
- Modify: `public/office.js:1612-1619,1835-1850` — wiring `#bLog`, `#bTasks` dipindah. `setCustomizing(true)` memanggil `officeNav.close()`, lalu mendaftarkan diri lewat `officeNav.onOpen(()=>setCustomizing(false))`.
- Modify: `public/tasks.js:253` — aksi "Show character" memanggil `officeNav.close()`, bukan `el('taskDialog').close()`.
- Modify: `public/office.js:1891-1894` — `modalOpen` diganti `document.querySelector('dialog:modal')`. Tanpa perubahan ini, drawer non-modal yang terbuka akan memblokir panah dan Esc kamera selamanya. Tombol panah tetap diabaikan bila fokus ada di dalam drawer, karena guard `event.target.closest(...dialog...)` sudah menanganinya.
- Modify: `public/settings.js:32` — dialog non-modal tidak menerima event `cancel` saat Esc ditekan. Cek `dirty` didaftarkan lewat `officeNav.guard('settingsDialog', ()=>!dirty||confirm(...))`. `close()` memanggil `officeNav.close()`.
- Modify: brand. Di puncak rail ada `#railBrand`: ikon `.brand-mark` yang sudah ada + "Kantor Kita" + `.brand-meta` "13 orang · 4 lantai". Di 641–1000px dan ≤640px hanya ikon yang tampil.
- Modify: `#sceneStatus` (`office.css:63,84,201,227`) dan `#followBar` (`office.css:101,105`) — posisinya dihitung ulang karena header hilang. Keduanya berada di tengah atas kanvas (`left: calc(var(--rail-w) + 50%)`), dan tidak boleh tertutup drawer saat drawer terbuka.
- Modify: `public/office.css` dan `public/tasks.css` — gaya rail dan drawer. Semua aturan yang menyebut `#header`, `.header-card`, `#teamFaces`, `.brand-tagline`, `#floorCaption`, `#cameraHint` dihapus (`office.css:13-14,38-43,66,68-69,72,106,134-138,216-217,279`). Gaya `dialog#taskDialog`/`dialog#settingsDialog` (posisi tengah + backdrop) di `tasks.css:1-3,7` diganti `.drawer`.
- Catatan: drawer menutupi `#floors` saat terbuka. Itu disengaja, karena pemilih lantai tidak dipakai selama drawer terbuka.

**Interfaces:**
- Produces: `window.officeNav`
  - `open(id: string): boolean` — menutup drawer lain lewat guard-nya, lalu memanggil `dialog.show()`. Mengembalikan `false` kalau guard menolak.
  - `close(): boolean`
  - `current(): string|null`
  - `guard(id, fn: () => boolean)` — `fn` mengembalikan `false` untuk menolak penutupan.
  - `onOpen(fn)`
- Rail harus tetap berfungsi saat server mati (`tests/org-offline.cjs` menyajikan `public/` lewat `python -m http.server`). `nav.js` tidak boleh memanggil API.
- Isi rail (urutan dan id): `#navOffice` "Kantor", `#bTasks` "Tugas" + `#taskCount`, `#bOrg` "Organisasi", `#bTeam` "Tim", `#bCustom` "Tata ruang", `#decisions` "Keputusan" + badge, `#bSettings` "Pengaturan", `#bLock` (gembok).
- Item rail yang aktif memakai `aria-current="page"`.
- Drawer adalah `<dialog class="drawer">`. Posisinya `left: var(--rail-w)`, `top:0`, `bottom:0`, lebar `min(760px, 100vw - var(--rail-w))`, tanpa backdrop.
- Handler Esc di `nav.js` berjalan pada fase capture. Kalau ada drawer terbuka, handler menutup drawer itu dan `stopPropagation()`, sehingga Esc di `office.js` (keluar kamera) tidak ikut terpicu.

- [ ] **Step 1: Write the failing test `tests/nav.cjs`**

Spawn server (pola `tests/org-owner.cjs`, port 43210, `DATA_DIR` sementara), lalu buka halaman di 1440×900. Assertions:

```js
assert.equal(await page.locator('#header').count(),0);
assert.deepEqual(await page.locator('#rail button').allInnerTexts().then(t=>t.map(s=>s.trim().split('\n')[0])),
  ['Kantor','Tugas','Organisasi','Tim','Tata ruang','Keputusan','Pengaturan','Kunci']);
await page.click('#bTasks');assert.equal(await page.isVisible('#taskDialog'),true);
assert.equal(await page.evaluate(()=>document.querySelector('#taskDialog').matches(':modal')),false); // 3D tetap bisa diklik
assert.ok(await page.evaluate(()=>document.querySelector('#taskDialog').getBoundingClientRect().right<innerWidth-300));
await page.click('#bSettings');assert.equal(await page.isVisible('#taskDialog'),false);assert.equal(await page.isVisible('#settingsDialog'),true);
await page.fill('#providerName','x');page.once('dialog',d=>d.dismiss());await page.click('#bTasks');
assert.equal(await page.isVisible('#settingsDialog'),true); // Review Focus 4
await page.click('#providerCancel'); // Clear form mereset dirty
await page.click('#navOffice');assert.equal(await page.evaluate(()=>officeNav.current()),null);
await page.click('#bCustom');await page.click('#bTasks');assert.equal(await page.isVisible('#customPanel'),false); // Review Focus 1
await page.keyboard.press('Escape');assert.equal(await page.isVisible('#taskDialog'),false);
// Review Focus 2: kamera karakter + drawer
await page.evaluate(()=>officeScene.select('Rizky Hakim'));await page.click('#iEyes');await page.click('#bTasks');
await page.keyboard.press('Escape');assert.equal(await page.isVisible('#followBar'),true);
await page.keyboard.press('Escape');assert.equal(await page.isVisible('#followBar'),false);
// drawer non-modal tidak memblokir panah kamera
await page.click('#bTasks');await page.click('canvas#c',{position:{x:1300,y:450}});const before=await page.evaluate(()=>officeScene.snapshot().camera);
await page.keyboard.down('ArrowLeft');await page.waitForTimeout(300);await page.keyboard.up('ArrowLeft');
assert.notDeepEqual(await page.evaluate(()=>officeScene.snapshot().camera),before);
// Esc di Pengaturan yang dirty memicu konfirmasi
await page.click('#bSettings');await page.fill('#providerName','y');page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');
assert.equal(await page.isVisible('#settingsDialog'),true);await page.click('#providerCancel');
assert.match(await page.locator('#railBrand').innerText(),/Kantor Kita/);
assert.deepEqual(errors,[]);
```

Kalau `officeScene.select(name)` belum ada, tambahkan di `office.js` sebagai satu baris yang memanggil `selectAgent(agents.find(a=>a.n===name))`. Task 5 juga memakainya.

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL pada `#header` count.
- [ ] **Step 3: Implementasikan `nav.js`, markup rail, dan konversi kedua dialog sesuai blok Interfaces di atas.**
- [ ] **Step 4: Jalankan `node tests/nav.cjs`, lalu `node tests/settings-ui.cjs` dan `node tests/decisions.cjs`.** Expected: ketiganya PASS. `decisions.cjs` boleh gagal hanya pada assertion teks banner; teks itu diperbaiki di Task 4.
- [ ] **Step 5: Commit** `feat(nav): rail kiri dan drawer menggantikan header dan modal`

### Task 2: Drawer Organisasi + gembok PIN di rail

**Files:**
- Modify: `public/index.html`
  - Hapus `#taskOrgTab` dan `#taskOrgView`.
  - Tambah `<dialog id="orgDialog" class="drawer">` berisi header "Organisasi", `#closeOrg`, dan `<section id="orgPanel">`.
  - Tambah `<dialog id="pinDialog">` (modal kecil) berisi form `#orgPin`, `#pinSubmit` "Buka kunci", dan `#pinMessage`.
- Modify: `public/tasks.js:139,200-240,351`
  - `renderOrg()` tidak lagi menampilkan form PIN. Kalau belum ada token, tampilkan teks "Organisasi terkunci" dan tombol "Buka kunci" yang memanggil `unlockFlow()`.
  - Error yang mengandung "owner unlock" menghapus token lalu memanggil `unlockFlow()`.
- Modify: `public/office.js` — `#bOrg` memanggil `officeTasks.openOrg()`.
- Modify: `tests/office.cjs:95` — setelah `#bTasks`, cek `#taskDialog` tidak scroll horizontal (tetap), lalu Esc menutupnya (tetap). Tidak perlu diubah, cukup dipastikan PASS di Task 1.
- Modify: `tests/org-owner.cjs:26`, `tests/org-offline.cjs:7` — klik `#bOrg` menggantikan `#bTasks` + `#taskOrgTab`. Klik `#bLock` lalu isi `#orgPin`.

**Interfaces:**
- Consumes: `officeNav.open/close` (Task 1).
- Produces:
  - `officeTasks.openOrg()`
  - `officeTasks.unlockFlow(): Promise<boolean>` — membuka `#pinDialog` lewat `showModal()`. Hasilnya `true` setelah token tersimpan.
- Token disimpan di `sessionStorage['kantor-ai.orgToken']` dan dibaca saat `init`.
- `#bLock` berlabel "Kunci" atau "Terbuka" dengan `aria-pressed` sesuai status. Klik saat status terbuka akan mengunci lagi: token dihapus.
- Gembok dibuka sekali untuk semua aksi owner (approve, split, roster review, edit org).
- Mode offline (`server===null`): `#bLock` `disabled` dengan `title="Butuh server lokal"`. Drawer Organisasi menampilkan ringkasan baca-saja yang sudah ada (`tasks.js:212-215`).

- [ ] **Step 1: Tambah ke `tests/nav.cjs` (Review Focus 3)**

```js
await page.click('#bOrg');assert.match(await page.locator('#orgPanel').innerText(),/terkunci/i);
await page.click('#bLock');await page.fill('#orgPin','2468');await page.click('#pinSubmit');
await page.waitForFunction(()=>document.querySelector('#orgPanel').textContent.includes('Kak Rani'));
await page.reload();await page.click('#bOrg');assert.doesNotMatch(await page.locator('#orgPanel').innerText(),/terkunci/i);
await page.evaluate(()=>sessionStorage.setItem('kantor-ai.orgToken','stale'));await page.reload();await page.click('#bOrg');
// aksi owner apa pun dengan token basi → dialog PIN muncul
await page.locator('#orgPanel button',{hasText:'Kirim roster review'}).first().click();
await page.locator('#pinDialog').waitFor({state:'visible'});
assert.equal(await page.evaluate(()=>sessionStorage.getItem('kantor-ai.orgToken')),null);
```

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL, karena `#bOrg` belum punya handler.
- [ ] **Step 3: Implementasikan drawer org, `#pinDialog`, `unlockFlow`, dan penyimpanan token di `sessionStorage`.** Saat `GET /api/org` dengan token basi, cukup tampilkan panel terkunci. Dialog PIN muncul hanya saat aksi tulis.
- [ ] **Step 4: Jalankan `node tests/nav.cjs`, `node tests/org-owner.cjs`, `node tests/org-offline.cjs`, dan `node tests/org-kanban.cjs`.** Expected: semuanya PASS.
- [ ] **Step 5: Commit** `feat(nav): drawer Organisasi dan gembok PIN per sesi`

### Task 3: Toolbar ringkas + menu Momen + kontrol kamera di pojok

**Files:**
- Modify: `public/index.html:69-73`
  - `#controls` hanya berisi `#bPause`, `#bRoutine`, `<details id="moments"><summary>Momen</summary>` dengan `#bLunch`, `#bRoof`, `#bPray`, `#bWork` di dalamnya, lalu `#bMusic` dan `#musicVolume`.
  - Tambah `<div id="cameraControls">` berisi `#bZoomIn`, `#bZoomOut`, `#bRotate`, `#bReset`.
  - Hapus `#cameraHint`. Teks petunjuk pindah ke `title` pada `#cameraControls`.
- Modify: `public/office.js:1611-1618` — setiap tombol Momen menutup `#moments` (`open=false`) setelah aksinya jalan.
- Modify: `public/office.css:64-68` — `#cameraControls` diposisikan fixed di kanan bawah, tombolnya disusun vertikal, ukuran 44px.
- Modify: `tests/office.cjs`, `tests/avatar-stairs.cjs`, `tests/soft-avatar.cjs` — sebelum setiap `click('#bLunch'|'#bRoof'|'#bPray'|'#bWork')`, sisipkan `await page.click('#moments summary');`.

**Interfaces:** tidak ada yang baru. Id lama tetap dipakai.

- [ ] **Step 1: Tambah ke `tests/nav.cjs`**

```js
assert.equal(await page.locator('#controls button:visible').count(),3); // Pause, Routine, Musik
assert.equal(await page.isVisible('#bLunch'),false);
await page.click('#moments summary');await page.click('#bLunch');
assert.equal(await page.evaluate(()=>document.querySelector('#moments').open),false);
const r=await page.locator('#cameraControls').boundingBox();assert.ok(r.x>1440-200&&r.y>900-300);
assert.equal(await page.locator('#cameraHint').count(),0);
```

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL pada jumlah tombol.
- [ ] **Step 3: Implementasikan markup, wiring penutupan `#moments`, dan CSS.**
- [ ] **Step 4: Jalankan `node tests/nav.cjs`, `node tests/avatar-stairs.cjs`, dan `node tests/soft-avatar.cjs`.** Untuk `node tests/office.cjs`, jalankan `npm start` dulu di port 4173. Expected: semuanya PASS.
- [ ] **Step 5: Commit** `feat(nav): toolbar ringkas, menu Momen, kontrol kamera di pojok`

### Task 4: Lantai ringkas, caption dihapus, log lipat, Keputusan di rail

**Files:**
- Modify: `public/index.html:28-49`
  - Tombol lantai jadi satu baris: `FL.0n Nama` + `<span class="floor-count">` (jumlah orang). `<small>` dihapus.
  - `#floorCaption` dihapus.
  - `#log` selalu terlihat. Kepalanya berisi `#logStats` (ringkasan) dan `#bLog` (toggle `aria-expanded`, default `false`), sedangkan `#logList` dan `#logEmpty` tersembunyi saat terlipat.
  - `#decisions` di log dihapus karena sudah ada di rail sejak Task 1.
- Modify: `public/office.js:1566-1572` — hapus 3 baris `floorKicker`, `floorTitle`, dan `floorDescription`.
- Modify: `public/office.js:1612-1613` — `syncLog(open)` mengubah `#log.classList.toggle('collapsed', !open)` dan `aria-expanded`. Nilai awal: `officeSettings.preferences.read().logVisible===true`. Default-nya terlipat, karena nilai lama `undefined` dianggap terlipat.
- Modify: `public/settings.js:37` — checkbox `#settingsLog` diberi label "Buka log saat mulai". Saat dimuat, checkbox dicentang hanya bila `logVisible===true` (sekarang `!==false`).
- Modify: `public/office.css:52,118` — aturan `body:has(#info:not([hidden])) #log{display:none / max-height:22vh}` diganti: saat `#info` terbuka, `#log` dipaksa terlipat (`.collapsed`) supaya tidak bertumpuk.
- Modify: `public/office.js:2030-2041`
  - Ringkasan log: `${busy} sedang tugas · ${free} bebas · ${done} selesai`.
  - `#decisions`: badge `<span class="badge">` berisi jumlah. Tombol `hidden` bila 0. `aria-label` berbunyi `${n} tugas menunggu keputusanmu · ${inisial}`.
- Modify: jumlah orang per lantai. Pakai penghitung thumbnail yang sudah ada (`tests/building-view.cjs` sudah menguji counts). Cari dengan `grep -n "count" public/office.js` di sekitar kode thumbnail lantai, lalu arahkan ke `.floor-count`.
- Modify: `tests/office.cjs:96` — di 375px, `#log` terlihat dan `#logList` tersembunyi. Klik `#bLog` membuat `#logList` terlihat.
- Modify: `tests/decisions.cjs:20` — assertion jadi `aria-label` cocok dengan `/1 tugas menunggu keputusanmu · KR/`.

- [ ] **Step 1: Tambah ke `tests/nav.cjs`**

```js
assert.equal(await page.locator('#floorCaption').count(),0);
assert.equal(await page.isVisible('#logList'),false);
assert.match(await page.locator('#logStats').innerText(),/sedang tugas.*bebas.*selesai/s);
await page.click('#bLog');assert.equal(await page.isVisible('#logList'),true);
assert.equal(await page.locator('#floors [data-floor="3"] .floor-count').innerText().then(Number)>0,true);
```

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL pada `#floorCaption`.
- [ ] **Step 3: Implementasikan perubahan di atas.**
- [ ] **Step 4: Jalankan `node tests/nav.cjs`, `node tests/decisions.cjs`, dan `node tests/building-view.cjs`, plus `node tests/office.cjs` dengan server port 4173.** Expected: semuanya PASS.
- [ ] **Step 5: Commit** `feat(nav): lantai ringkas, log lipat, Keputusan di rail`

### Task 5: Tombol Tim menggantikan picker dan deretan avatar

**Files:**
- Modify: `public/index.html`
  - Tambah `<div id="teamPopover" hidden>` berisi `<input id="teamSearch" placeholder="Cari nama atau peran">` dan `<ul id="teamList">`. Posisinya di samping `#bTeam`.
- Modify: `public/office.js:1480-1514`
  - Hapus semua referensi `teamSelect` dan `teamFaces`.
  - Isi `#teamList` dengan satu `<button data-member="${a.n}">` per agen: titik warna grup, inisial, nama, peran.
  - Klik item → `selectAgent(a)`, kamera fokus ke posisinya (logika dari `teamSelect.onchange` lama), lalu popover ditutup.
  - Ketik di `#teamSearch` → filter berdasarkan nama atau peran, tidak peka huruf besar/kecil.
  - Esc atau klik di luar popover menutupnya.
- Modify: `tests/avatar-stairs.cjs:17-20`, `tests/member-commands.cjs:11`, `tests/office.cjs:51,57,67,106`, `tests/soft-avatar.cjs:11`. Ganti `selectOption('#teamSelect',N)` dengan:

```js
await page.click('#bTeam');await page.click(`#teamList [data-member="${N}"]`);
```

`avatar-stairs.cjs:17`: assertion "tidak memuat Bagas" pindah ke `#teamList`.
- Modify: `public/tasks.js` — tambah `officeTasks.divisionOf(name): string|null`, yang mengembalikan nama divisi dari `orgState` (anggota → `division` → `divisions[].name`).
- Modify: `public/office.js:1490` — kartu profil (`#info`) menambah baris `['Divisi', officeTasks.divisionOf(agent.n)||'—']` sebelum "Desk group", sesuai spec yang meminta kartu menampilkan peran, divisi, dan tugas aktif.

**Interfaces:**
- Consumes: `officeScene.select(name)` (Task 1).

- [ ] **Step 1: Tambah ke `tests/nav.cjs`**

```js
await page.click('#bTeam');assert.equal(await page.locator('#teamList [data-member]').count(),await page.evaluate(()=>officeScene.snapshot().team.length));
await page.fill('#teamSearch','backend');assert.equal(await page.locator('#teamList [data-member]:visible').count(),1);
await page.click('#teamList [data-member="Rizky Hakim"]');
assert.equal(await page.isVisible('#teamPopover'),false);assert.match(await page.locator('#info').innerText(),/Backend Engineer/);
```

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL, karena `#bTeam` belum punya popover.
- [ ] **Step 3: Implementasikan popover dan hapus picker lama.**
- [ ] **Step 4: Jalankan `node tests/nav.cjs`, `node tests/avatar-stairs.cjs`, `node tests/member-commands.cjs`, dan `node tests/soft-avatar.cjs`, plus `node tests/office.cjs`.** Expected: semuanya PASS.
- [ ] **Step 5: Commit** `feat(nav): tombol Tim dengan pencarian menggantikan picker inisial`

### Task 6: Bahasa Indonesia + responsif 375/768

**Files:**
- Modify: semua teks yang terlihat pengguna di `public/index.html`, `public/office.js`, `public/tasks.js`, `public/settings.js`. Ini mencakup:
  - label tombol dan heading
  - placeholder dan `aria-label`
  - pesan status dan log, termasuk `TASK_LOG`, `SAY`, dan string `status(...)`
  - teks yang ditulis ke `#taskFeedback` dan `#settingsMessage`
- Modify: `server/server.js` dan `server/org.js` — pesan error yang dikirim ke klien. Klien saat ini mencocokkan teks `'owner unlock'`; ganti dengan penanda stabil `code:'ORG_LOCKED'` di body error.
  - Ada tiga sumber 403 owner-lock: `server.js:152`, `server.js:214`, dan `org.js:69`.
  - Di `org.js:34`, `fail(message, status, code)` mengisi `error.code=code`, lalu `org.js:69` memanggilnya dengan `'ORG_LOCKED'`.
  - Catch umum di `server.js:300` mengirim `{error, code: error.code}`.
  - Di `server.js:152,214`, tambahkan `code:'ORG_LOCKED'` ke objek yang dikirim.
  - Di `tasks.js:41`, buat `err.code=data.code`. Di `tasks.js:139`, pakai `error.code==='ORG_LOCKED'`.
  - Tambah satu assertion di `tests/org.cjs:27`: `assert.equal(denied.body.code,'ORG_LOCKED')`.
- Modify: string di `public/music.js` ("Try music", label tombol musik) juga ikut diterjemahkan.
- Modify: setiap tes yang mencocokkan teks Inggris (daftar dari `grep -n "name:'\|/[A-Z]" tests/*.cjs`). Ganti dengan teks Indonesia yang baru.
  - Glosarium wajib: Pause→"Jeda", Resume→"Lanjut", Routine→"Rutinitas", Music→"Musik", Lunch→"Makan siang", To the rooftop→"Ke rooftop", Prayer time→"Waktu salat", Back to work→"Kembali kerja", Approve & finish→"Setujui & selesai", Request revision→"Minta revisi", Start task→"Mulai tugas", Save provider→"Simpan provider", Fetch models→"Ambil model", Add person→"Tambah orang", Save member→"Simpan anggota", Send roster review→"Kirim roster review", Send message→"Kirim pesan", Send answer→"Kirim jawaban", Split→"Pecah", Move task→"Pindahkan tugas", Update progress→"Perbarui progres", Try again→"Coba lagi".
- Modify: `public/office.css`, `public/tasks.css` — media query `max-width:640px`:
  - `#rail` jadi bar bawah fixed (tinggi 64px + safe-area). Isinya ikon dengan label kecil; item "Tata ruang", "Pengaturan", dan "Kunci" masuk ke `<details>` "Lainnya".
  - `#controls` naik di atas rail.
  - `#cameraControls` di kanan, di atas `#controls`.
  - Drawer jadi layar penuh di atas rail.
  - Untuk 641–1000px: rail hanya ikon dengan lebar 64px.
- Modify: `README.md` — perbarui deskripsi navigasi dan daftar tes (tambah `tests/nav.cjs`).

- [ ] **Step 1: Tambah ke `tests/nav.cjs` (Review Focus 5)**

```js
for(const width of [375,768,1440]){await page.setViewportSize({width,height:width===375?812:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no h-scroll at ${width}`);
  const boxes=await Promise.all(['#rail','#controls','#cameraControls'].map(s=>page.locator(s).boundingBox()));
  const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
  assert.equal(overlap(boxes[0],boxes[1])||overlap(boxes[0],boxes[2])||overlap(boxes[1],boxes[2]),false,`overlap at ${width}`);}
assert.equal(await page.getByRole('button',{name:'Jeda',exact:true}).count(),1);
```

- [ ] **Step 2: Jalankan `node tests/nav.cjs`.** Expected: FAIL pada overlap di 375 atau tombol "Jeda".
- [ ] **Step 3: Terjemahkan teks, ganti pencocokan `'owner unlock'` dengan `code:'ORG_LOCKED'`, lalu tambahkan CSS responsif.**
- [ ] **Step 4: Jalankan seluruh suite:**

```bash
for f in tests/*.cjs; do echo "== $f"; node "$f" || echo "FAIL $f"; done
```

`office.cjs`, `avatar-stairs.cjs`, `customize.cjs`, `inventory.cjs`, `autonomous-floors.cjs`, dan `building-view.cjs` butuh `npm start` di port 4173. Expected: tidak ada baris `FAIL`.

- [ ] **Step 5: Commit** `feat(nav): UI berbahasa Indonesia dan layout responsif rail`
