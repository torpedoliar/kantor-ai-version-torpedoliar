# Struktur Organisasi + Kanban Autonomous Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner memberi satu tugas besar ke lead divisi dan terima jadi; lead memecah, membagi, memantau, dan menutup tugas di kanban divisinya.

**Architecture:** Tambah modul org (divisi, lead, anggota, PIN owner) sebagai sumber kebenaran assignee; tambah field task (`parentId`, `priority`, `progressPct`, `messages[]`, `kind`) tanpa mengubah status set; kanban + roster + menu owner di dialog Tasks yang sudah ada. Instruksi kerja per pegawai (create/start/finish, draft AI, review/revise, blocked-QUESTIONS) tidak diubah perilakunya.

**Tech Stack:** Node 22+ (server), vanilla JS + dialog HTML (frontend), JSON file storage, Playwright + Chromium (tests).

**Spec:** docs/superpowers/specs/2026-10-18-org-kanban-design.md

## Global Constraints

- UI aplikasi berbahasa Inggris (aturan README).
- Server hanya `127.0.0.1`, guard CSRF + same-origin seperti `server/server.js` tetap berlaku untuk semua endpoint baru.
- Status tugas tetap `queued, active, blocked, review, done`; satu tugas aktif per orang.
- Mode browser-only (localStorage) tetap jalan tanpa server.
- Tanpa dependency baru; ikuti pola `fetch /api/tasks` dan dialog yang sudah ada.
- Lead awal: Marketing = Kak Rani, Engineering = Koh Wira, Service = Gilang.
- Tugas besar owner wajib: judul + instruksi + prioritas; lead wajib bertanya (alur blocked/QUESTIONS) bila tidak jelas.
- Lintas divisi di v1 mutlak tidak boleh; pindah divisi hanya lewat menu owner.
- Menu struktur hanya owner, dikunci PIN lokal 4-6 digit.

## Review Focus

- PIN salah/berulang: tebakan PIN tidak boleh membuka menu dan tidak boleh membocorkan hash/PIN lewat response atau log; ekspektasi: selalu 403 tanpa petunjuk.
- Assignee dihapus/dinonaktifkan saat punya tugas aktif: tugas tidak boleh hilang atau yatim; ekspektasi: ikut Unassigned dengan status dipertahankan dan tercatat di log.
- `messages[]` berisi HTML/JS jahat dari input chat: render tidak boleh mengeksekusi script; ekspektasi: tampil sebagai teks polos.
- Dua tab kirim update progres/chat bersamaan: versi lama tidak boleh menimpa versi baru; ekspektasi: 409 seperti guard review yang sudah ada.
- Server restart saat PIN sudah diset: menu tetap terkunci dan tidak reset ke terbuka; ekspektasi: `org.json` terbaca ulang, PIN tetap wajib.

---

### Task 1: Org storage + PIN guard (backend)

**Files:**
- Create: `server/org.js`
- Modify: `server/server.js`
- Test: `tests/org.cjs`

**Interfaces:**
- Consumes: pola `guardRequest`, `send`, `readJson`, `atomicWrite`-style, `TASKS_FILE` dari `server/server.js`; pola `createSettings` save/version dari `server/settings.js`.
- Produces: `createOrg({dataDir})` → `{ publicState(), save(next, token, expectedVersion), unlock(pin), verifyToken(token), roster(), divisionOf(name), isLead(name), seedFromMembers(names) }`; endpoint `GET /api/org` (butuh CSRF), `PUT /api/org` (butuh CSRF + header `x-kantor-org`), `POST /api/org/unlock` (tukar PIN jadi token sesi memory, butuh CSRF; hangus saat restart).

- [ ] **Step 1: Write the failing test**

```js
// tests/org.cjs: seed awal 4 divisi (leadership/Arman, marketing/Rani,
// engineering/Wira, service/Gilang; Wira dual-hat member leadership);
// GET /api/org tanpa CSRF → 403; PUT /api/org tanpa header x-kantor-org → 403
// tanpa bocorkan hash; POST /api/org/unlock dengan PIN benar → token sesi memory;
// PUT dengan token + version → 200 dan roster berubah; restart server → token hangus,
// PIN wajib lagi, menu tidak reset terbuka.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org.cjs`
Expected: FAIL — `Cannot find module '../server/org.js'` atau endpoint 404.

- [ ] **Step 3: Implement `createOrg({dataDir})` in `server/org.js` + wire endpoints in `server/server.js`**

PIN disimpan sebagai salted hash (scrypt) di `data/org.json`; default PIN kosong = menu terbuka sampai owner set PIN pertama. Seed awal 4 divisi + 4 kanban: leadership (lead Koh Arman), marketing (lead Kak Rani), engineering (lead Koh Wira), service (lead Gilang); Wira dual-hat member leadership (satu-satunya pengecualian).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/org.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/org.js server/server.js tests/org.cjs
git commit -m "feat: add org storage with owner PIN guard"
```

### Task 2: Task schema baru + validasi roster (backend)

**Files:**
- Modify: `server/server.js` (newTask, PATCH, validasi assignee)
- Test: `tests/org.cjs` (tambah blok) atau `tests/org-tasks.cjs` baru bila file membengkak

**Interfaces:**
- Consumes: `createOrg().roster()/divisionOf()` dari Task 1; `STATES`, `MEMBERS` diganti sumber roster.
- Produces: field task `parentId|null`, `asLead: true|false` (wajib bila assignee dual-hat seperti Wira; menentukan aturan lead vs member per-tugas), `priority: low|normal|high`, `progressPct: 0-100`, `messages: [{by, text, at}]`, `kind: work|roster-review`; aturan struktur tanpa klaim identitas: (a) tugas tanpa parent hanya boleh ke lead, (b) kartu kecil wajib satu divisi dengan parent-nya, (c) owner tidak assign langsung ke anggota; worker skip tugas besar (tanpa parentId + asLead) dari auto-draft; lead boleh pegang maks 1 kartu kecil divisinya sebagai kontributor (otomatis via aturan satu tugas aktif per orang); parent ke Review hanya bila semua anak done; approve parent = owner (sesi unlock); roster-review pending → POST kartu kecil baru di divisi itu 409.

- [ ] **Step 1: Write the failing test**

```js
// POST tugas besar (tanpa parent, asLead) hanya boleh ke lead → 200;
// POST tugas tanpa parent ke anggota biasa → 409;
// POST kartu kecil (parentId) beda divisi dengan parent → 409;
// POST dengan priority + parentId + asLead tersimpan dan terbaca GET;
// assignee tak dikenal → 400; tugas lama tanpa field baru tetap valid (migrasi baca).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org.cjs`
Expected: FAIL — field baru hilang dari response.

- [ ] **Step 3: Implement field + validasi roster di `server/server.js`**

`MEMBERS` hardcoded diganti cek ke roster org (fallback ke daftar lama bila `org.json` belum ada). Penegakan peran TANPA klaim identitas dari client (tanpa `asRole`, karena tanpa login siapa pun bisa memalsukannya): (a) tugas tanpa parent hanya boleh ke lead, (b) kartu kecil wajib satu divisi dengan parent-nya, (c) owner tidak assign langsung ke anggota. Satu-satunya aksi beridentitas adalah ubah struktur → dikunci PIN. Worker skip tugas yang assignee-nya lead dan tanpa `parentId` (tugas besar tidak auto-draft); kartu kecil milik anggota agen tetap auto-draft normal. Parent ke Review hanya bila semua anak `done` (server tolak bila belum); approve parent = owner. Tugas lama: default `priority: normal`, `progressPct: 0`, `messages: []`, `kind: work`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/org.cjs && node tests/server.cjs`
Expected: PASS semua; alur instruksi kerja per pegawai (start/finish manual, draft AI, revise) tidak berubah.

- [ ] **Step 5: Commit**

```bash
git add server/server.js tests/org.cjs
git commit -m "feat: add parent/priority/progress/messages fields with roster validation"
```

### Task 3: Chat followup + progres di kartu (backend + frontend render)

**Files:**
- Modify: `server/server.js` (PATCH `message`, `progress`), `public/tasks.js` (render messages + form progres/chat)
- Test: `tests/org-chat.cjs` (API) + Playwright render check di file yang sama

**Interfaces:**
- Consumes: `PATCH /api/tasks/:id` + version guard dari Task 2; `draftWrite/draftRead` sessionStorage untuk teks belum kirim.
- Produces: `PATCH {message, version}` append ke `messages[]` (TERBUKA tanpa unlock; `by` = pilihan UI, tanpa verifikasi); `PATCH {progressPct, version}` update progres (terbuka); approve/revise/approve-parent WAJIB header `x-kantor-org`; render kartu: daftar pesan (textContent, bukan innerHTML), bar progres, form update + chat, tombol Split (lihat Task 4).

- [ ] **Step 1: Write the failing test**

```js
// PATCH message appends {by:'Kak Rani', text:'tambah harga di slide 2'};
// PATCH dengan version basi → 409; render menampilkan pesan sebagai teks
// (cek tidak ada <script> tereksekusi — assert via textContent).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-chat.cjs`
Expected: FAIL — `Unknown field` atau 400.

- [ ] **Step 3: Implement PATCH message/progress di server + render di `public/tasks.js`**

Sanitasi: `text(input, 2000)` per pesan, `progressPct` clamp 0–100 integer. Render pesan dengan `node('p', ...)` (textContent) — jangan innerHTML.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/org-chat.cjs && node tests/server.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/server.js public/tasks.js tests/org-chat.cjs
git commit -m "feat: add in-card followup chat and progress updates"
```

### Task 4: Kanban 4 divisi + roster inventory + tombol Split + ringkasan owner (frontend)

**Files:**
- Modify: `public/index.html` (tab/section kanban + roster + ringkasan di dialog Tasks), `public/tasks.js` (view kanban), `public/tasks.css` (kolom kanban)
- Test: `tests/org-kanban.cjs` (Playwright: 4 kanban divisi × 3 kolom, roster tampil, Unassigned bucket, tombol Split isi parentId otomatis + assignee satu divisi, ringkasan owner read-only tanpa aksi kartu kecil)

**Interfaces:**
- Consumes: `GET /api/org` + `GET /api/tasks` (+ field Task 2–3); mapping kolom: `queued`=Antre, `active`/`blocked`=Jalan (blocked badge Needs decision), `review`=Review, `done`=collapsed.
- Produces: dropdown 4 divisi (leadership, marketing, engineering, service), kartu kecil di bawah parent-nya, roster panel (nama · role · lead · sibuk/bebas · tugas aktif), bucket Unassigned untuk tugas tanpa divisi, tombol Split di kartu parent (N sub-form, assignee terbatas satu divisi, parentId otomatis), layar ringkasan owner READ-ONLY.

- [ ] **Step 1: Write the failing test**

```js
// Playwright: buka Tasks → pilih divisi Marketing → 3 kolom Antre/Jalan/Review tampil;
// roster mencantumkan Rani (lead) + 3 anggota; tugas tanpa divisi tampil di Unassigned;
// tombol Split di parent membuka sub-form dengan parentId terisi; ringkasan owner
// read-only (tidak ada tombol aksi kartu kecil).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-kanban.cjs`
Expected: FAIL — selector kanban tidak ditemukan.

- [ ] **Step 3: Implement kanban view + roster panel**

Semua label Inggris. View list lama tetap ada (jangan hapus — regression tests `office.cjs` memakainya). Kanban sebagai tab kedua di dialog Tasks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/org-kanban.cjs && node tests/office.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/tasks.js public/tasks.css tests/org-kanban.cjs
git commit -m "feat: add per-division kanban and roster inventory views"
```

### Task 5: Menu struktur owner + PIN + perintah review roster (frontend + backend)

**Files:**
- Modify: `public/index.html`, `public/tasks.js`, `server/server.js` (re roster-review kind), `public/tasks.css`
- Test: `tests/org-owner.cjs` (Playwright: tanpa unlock menu terkunci + tampil petunjuk reset PIN; unlock PIN salah → 403; unlock benar → tambah/pindah/nonaktif anggota + kirim roster-review + lead jawab ringkasan; instruksi kerja per pegawai — create/start/finish manual, draft AI kartu kecil, revise — tetap jalan)

**Interfaces:**
- Consumes: `POST /api/org/unlock`, `PUT /api/org` (header `x-kantor-org`) dari Task 1; task `kind: roster-review` dari Task 2 (owner → lead, jawaban lead tersimpan di `result`); alur kerja pegawai yang sudah ada TIDAK diubah perilakunya.
- Produces: dialog/section Org (Kelola per divisi, +divisi, +pekerja, pindah, angkat lead, ubah role, nonaktif, set PIN pertama), layar PIN dengan petunjuk reset via file bila lupa, tombol `Send roster review`, tampilan ringkasan jawaban.

- [ ] **Step 1: Write the failing test**

```js
// Tanpa unlock: section Org menampilkan PIN prompt, bukan daftar;
// unlock PIN salah → 403; unlock benar → CRUD anggota jalan;
// roster-review ke lead → lead jawab → result tersimpan, status done oleh owner.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-owner.cjs`
Expected: FAIL — endpoint/selector belum ada.

- [ ] **Step 3: Implement menu owner + roster-review flow**

Set PIN pertama tanpa PIN lama (hanya bila belum ada PIN). Nonaktifkan anggota dengan tugas aktif → tugasnya pindah ke Unassigned, status dipertahankan, catat di office log via `changed()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/org-owner.cjs && node tests/server.cjs && node tests/office.cjs`
Expected: PASS — instruksi kerja per pegawai tetap jalan.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/tasks.js public/tasks.css server/server.js tests/org-owner.cjs
git commit -m "feat: add owner-only org menu and roster review command"
```

### Task 6: Browser-only parity + docs (frontend + docs)

**Files:**
- Modify: `public/tasks.js` (localStorage: default org seed + validTask perluasan), `README.md` (seksi org/kanban)
- Test: `tests/org-offline.cjs` (tanpa server: kanban + roster tampil dari seed, chat/progres tersimpan localStorage)

**Interfaces:**
- Consumes: semua view Task 3–5; seed default = struktur awal Task 1 (tanpa PIN di browser).
- Produces: `validTask` menerima field baru; org seed di localStorage key terpisah `kantor-ai.org.v1`; README seksi baru (Inggris).

- [ ] **Step 1: Write the failing test**

```js
// Matikan server (python http.server / static): kanban divisi tampil dari seed;
// tambah pesan + progres tersimpan setelah reload; PIN tidak diminta di mode offline.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-offline.cjs`
Expected: FAIL — kanban kosong tanpa server.

- [ ] **Step 3: Implement offline seed + perluas validTask + tulis README**

- [ ] **Step 4: Run full suite to verify nothing regresses**

Run: `node tests/server.cjs && node tests/office.cjs && node tests/org.cjs && node tests/org-chat.cjs && node tests/org-kanban.cjs && node tests/org-owner.cjs && node tests/org-offline.cjs`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add public/tasks.js README.md tests/org-offline.cjs
git commit -m "feat: add offline org seed and document org kanban flow"
```
