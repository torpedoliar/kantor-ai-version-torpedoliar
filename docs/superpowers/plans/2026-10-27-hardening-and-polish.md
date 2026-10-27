# Hardening & Polish Implementation Plan (2026-10-27)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup tiga bug yang bisa merusak otomasi (loop synthesis, otorisasi PATCH, ghost room), lalu menaikkan ketahanan data/operasi, performa render & tulis state, dan kualitas UX mobile — tanpa mengubah arsitektur inti (Node stdlib + vanilla JS + JSON store).

**Architecture:** Server tetap satu proses `node:http`, `taskStore` sebagai satu-satunya penulis `workspace.json`, dan `public/office.js` sebagai pemilik scene. Semua item dikerjakan sebagai perubahan kecil yang dapat diuji sendiri, dengan tes regresi per bug. Tidak ada dependensi runtime baru; alat dev (ESLint/Prettier) hanya untuk CI.

**Tech Stack:** Node 22+ (stdlib only), vanilla JS, Three.js (vendored), test `.cjs` dijalankan `node tests/<file>.cjs`, Playwright opsional lewat `PLAYWRIGHT_MODULE`.

**Sumber temuan:** audit server (`server/*.js`), audit klien (`public/*.js`, CSS), audit tes/ops. Setiap task menyebut lokasi kode saat plan ditulis; verifikasi ulang sebelum mengedit karena nomor baris dapat bergeser.

## Global Constraints

- Single-user lokal, server listen `127.0.0.1`; tanpa login. Semua endpoint owner tetap memakai PIN/token yang sudah ada.
- Tulis state tetap atomik (tmp + rename). Tidak boleh ada penulisan `workspace.json` dari dua proses.
- Tanpa dependensi runtime baru. Tanpa perubahan format data yang merusak (migrasi harus aditif dan punya snapshot `last-good`).
- Setiap task wajib: `node --check` untuk file JS yang disentuh, tes baru/terkait lulus, dan tidak menurunkan jumlah lulus suite unit (baseline 71 file non-UI).
- Perubahan UI wajib diverifikasi di 1440/768/375 px; minimal satu screenshot sebelum/sesudah untuk perubahan visual.
- Bahasa UI yang terlihat pengguna: Indonesia (perbaikan bertahap, lihat Task 17).

## Prioritas dan Urutan

| Fase | Fokus | Alasan urutan |
|---|---|---|
| 1 | Keamanan & stabilitas otomasi | Bug aktif; bisa menggandakan biaya model / membocorkan gate review |
| 2 | Ketahanan data & operasi | Mencegah kehilangan state dan pemulihan yang mustahil |
| 3 | Performa | Mengurangi beban tulis/poll/frame; setelah jalur auth stabil |
| 4 | UX & aksesibilitas | Polish yang terlihat; setelah data & performa aman |
| 5 | QA & delivery | CI dan harness agar semua di atas tidak regres |

Dependensi keras:
- Task 2 sebelum Task 9 (Task 9 menyentuh handler PATCH yang sama).
- Task 5 dan 6 sebelum Task 7 (health/doctor butuh validasi state).
- Task 3 sebelum Task 13 (marker ruangan harus ada sebelum merge dinamis).
- Task 18 sebelum Task 19 (CI memakai runner yang sudah diperbaiki).

---

# Fase 1 — Keamanan & Stabilitas Otomasi

### Task 1: Batasi retry synthesis yang gagal

**Masalah:** `synthesize()` menulis `status:'blocked', phase:'waiting_children', error` saat model gagal (`server/task-orchestrator.js`, blok `catch`), lalu `wake()` memanggil `synthesize()` lagi setiap kali semua anak `done` tanpa memeriksa `error` atau jumlah percobaan. Setiap commit menjadwalkan `kick()` baru, jadi kegagalan permanen berulang tanpa henti.

**Files:**
- Modify: `server/task-orchestrator.js`
- Test: `tests/task-synthesis-retry.cjs` (baru)

**Steps:**
- [x] 1. Tambah field `synthAttempts` pada task; naikkan di awal setiap `synthesize()` dan reset saat sukses atau saat owner menekan retry.
- [x] 2. Gate di `wake()`: hanya panggil `synthesize()` bila error kosong atau masih ada sisa percobaan dan `synthRetryAt` sudah lewat; setelah batas, `phase:'failed'` + pesan yang menyebut tombol Coba lagi.
- [x] 3. Pada kegagalan, jadwalkan percobaan berikutnya dengan backoff (`KANTOR_SYNTH_RETRY_DELAYS_MS`, default 30s/2m) dan timer 1 detik di server yang hanya membangunkan orchestrator saat jatuh tempo.
- [x] 4. `plan()` tidak diubah (sudah punya guard `!t.error`); retry owner lewat `PATCH status:'queued'` mengembalikan `phase` ke `waiting_children` dan mereset `synthAttempts`.

**Acceptance:**
- Tes memakai provider mock yang selalu 500 untuk `MODE: SYNTHESIZE` dengan batas 3 percobaan: tepat 3 panggilan, lalu tidak ada panggilan keempat dan versi task berhenti berubah.
- Task tetap `queued` dengan error dan pesan "dihentikan" di thread; `synthRetryAt` kosong.
- Setelah owner menekan Coba lagi, synthesis berjalan sekali lagi dan sukses, `synthAttempts` kembali 0.
- `tests/task-orchestration.cjs` (happy path: tepat satu synthesis) tetap lulus.

---

### Task 2: Tutup celah otorisasi PATCH untuk task privileged

**Masalah:** `action:'answer'` ditangani sebelum `requireOrgToken`; cabang `assignee`/`status` tidak pernah memanggilnya. Draf `review`/`manager-review` bisa dipindah ke non-agen lalu ditutup `done` dengan `result` dari pemanggil.

**Files:**
- Modify: `server/server.js` (handler `PATCH /api/tasks/:id`, fungsi `privilegedTask`/`requireOrgToken`)
- Test: `tests/task-auth.cjs` (baru)

**Steps:**
- [x] 1. Pindahkan pemeriksaan token ke awal handler PATCH untuk task yang `privilegedTask(task)` benar — berlaku untuk semua bentuk input (`action`, `message`, `progressPct`, `assignee`, `status`).
- [x] 2. Buat guard review tidak bisa dilewati: bila `task.status` `review`/`manager-review`, setiap `assignee`/`status` generik ditolak 409 `REVIEW_REQUIRED`; hanya `approve`/`revise`/`manager-*` yang boleh memindahkan draf.
- [x] 3. Pertahankan perilaku untuk task non-privileged (tidak perlu PIN) agar alur owner sehari-hari tidak berubah.
- [x] 4. Audit endpoint lain: `POST /api/tasks/:id/messages`, `/api/decisions/:id/answer`, preview, dan application action sudah memakai token; tidak ada perubahan tambahan.

**Acceptance:**
- Tanpa `x-kantor-org`: `answer`, `progressPct`, `message`, `assignee`, dan `status:done` pada task anak/review semuanya 403 `ORG_LOCKED`; dengan token perilaku normal.
- Draf `review` tidak bisa diubah assignee/status lewat PATCH generik; hasil asli anak tetap dipakai saat approve.
- `tests/org-tasks.cjs`, `tests/org-owner.cjs`, `tests/decisions.cjs`, `tests/manager-advice.cjs`, `tests/application-workflow.cjs` lulus setelah ekspektasi tes disesuaikan ke aturan baru.

---

### Task 3: Hilangkan ghost mesh ruangan setelah merge static

**Masalah:** `applyRooms(customRooms)` berjalan sebelum `mergeStatic` saat startup. Group ruangan tidak punya penanda yang dilewati `mergeStatic`, sehingga mesh-nya di-merge; `removeRoomBuilt` hanya menghapus group asli, menyisakan geometri dan sel collision.

**Files:**
- Modify: `public/office.js` (`buildRoom`, `mergeStatic`, `applyRooms`, `removeRoomBuilt`)
- Test: `tests/rooms-merge.cjs` (baru)

**Steps:**
- [x] 1. Beri `group.userData.customRoom = room.id` di `buildRoom` (penanda cukup di root; pengecekan ancestor di `mergeStatic` menemukannya).
- [x] 2. Tambahkan `a.userData.customRoom` ke daftar skip di `mergeStatic`.
- [x] 3. Bangun ruangan setelah `mergeStatic` saat startup, sehingga mesh ruangan tidak pernah masuk ke geometri statis.
- [x] 4. `disposeRoomGroup`: dispose geometri unik dan material bertanda `roomOwned`; geometri `softBox` yang dipakai bersama tidak disentuh.
- [x] 5. Perbaiki race polling drawer ruangan (`refreshSeq`) yang bisa menerapkan daftar lama setelah ruangan baru dibuat; tes rooms-nav menunggu sinkronisasi awal.

**Acceptance:**
- `tests/rooms-merge.cjs`: ruangan yang dibuat sebelum halaman dimuat punya `roomMeshes[id] > 0`; setelah dihapus, entri itu hilang, jumlah mesh lantai turun, dan sel collision berkurang.
- Tidak ada ghost mesh atau sel collision tersisa setelah penghapusan.
- `tests/rooms.cjs`, `tests/rooms-nav.cjs`, `tests/office.cjs`, `tests/graphics-dynamic-floors.cjs` lulus.

---

# Fase 2 — Ketahanan Data & Operasi

### Task 4: Cooldown provider dan hormati `Retry-After`

**Masalah:** 429/503 dipetakan ke `quota`/`unavailable` tetapi header `Retry-After` dan body error dibuang. Gate hanya membatasi in-flight, jadi semua task antre langsung menembak provider yang sedang rate-limited.

**Files:**
- Modify: `server/providers.js`, `server/concurrency.js`, `server/server.js` (`askConfigured`/worker)
- Test: `tests/provider-cooldown.cjs` (baru), perluas `tests/concurrency.cjs`

**Steps:**
- [x] 1. Klasifikasi error mengembalikan `{category, retryAfterMs, status, snippet}`; parse `Retry-After` (detik atau HTTP date), clamp 5 menit, dan redaksi pola kredensial di snippet.
- [x] 2. Tambah `gate.cooldown(providerId, ms)` + `gate.snapshot().cooldowns`; `fits()` menolak provider yang sedang cooldown dan satu timer membangunkan antrean saat cooldown paling awal berakhir.
- [x] 3. `askConfigured` melaporkan kegagalan quota/unavailable/timeout ke gate (provider utama dan fallback); retry per task tetap ada sebagai lapis kedua.
- [x] 4. Sertakan snippet body error (≤200 karakter, sudah disanitasi) di pesan kegagalan task.

**Acceptance:**
- Provider mock membalas 429 + `Retry-After: 1`: retry tidak menembak provider sebelum cooldown berakhir; setelah itu task selesai.
- Snippet "slow down" terlihat di audit trail dan thread, tetap ≤500 karakter.
- `tests/auto-retry.cjs` (mock kini mengirim `Retry-After: 0.3`), `tests/concurrency.cjs`, `tests/providers.cjs`, `tests/provider-cooldown.cjs` lulus.

---

### Task 5: Backup, restore, dan doctor untuk seluruh `DATA_DIR`

**Masalah:** export workspace tidak mencakup `org.json`, `rooms.json`, `settings.json`, kredensial, `settings.key`, dan `data/projects/`; tidak ada jalur import/restore.

**Files:**
- Create: `scripts/backup-data.mjs`, `scripts/restore-data.mjs`, `scripts/doctor.mjs`
- Modify: `server/server.js` (endpoint owner-only `POST /api/workspace/import`, `GET /api/workspace/info`)
- Test: `tests/backup-restore.cjs` (baru), perluas `tests/workspace-lifecycle.cjs`

**Steps:**
- [x] 1. Backup: salin `DATA_DIR` ke `data/backups/<timestamp>/` + `manifest.json` (SHA-256 per file, ukuran, mode); pertahankan 0600 untuk kredensial, lewati folder backup dan file sementara.
- [x] 2. Restore: verifikasi seluruh hash sebelum menimpa, wajibkan snapshot pra-restore otomatis, tolak arsip rusak, dan minta `--yes`.
- [x] 3. Import API: validasi skema workspace, arsipkan workspace lama, tolak store non-kosong kecuali `replace:true`, tolak saat ada tugas/job berjalan, lalu reset timer retry dan kick.
- [x] 4. Doctor: validasi file state + `settings.key`, laporkan folder proyek tanpa `project.json` dan backup rusak, cetak langkah pemulihan.
- Catatan: import hanya memuat metadata workspace; source proyek dipulihkan lewat `scripts/restore-data.mjs`, karena file proyek sengaja tidak masuk export.

**Acceptance:**
- Siklus backup → ubah data → restore mengembalikan org/rooms/workspace dan kredensial; snapshot `pre-restore-*` selalu dibuat.
- Arsip yang diubah satu byte ditolak sebelum ada file yang ditimpa.
- `tests/backup-restore.cjs` mencakup skrip, doctor, restore yang ditolak, dan import owner-only.

---

### Task 6: Pemulihan state korup tanpa mem-brick startup

**Masalah:** satu JSON rusak (`workspace.json`, `org.json`, `rooms.json`, `team.json`) membuat proses throw dan keluar; tidak ada snapshot sebelum migrasi.

**Files:**
- Modify: `server/task-store.js`, `server/org.js`, `server/server.js`, `server/settings.js`
- Test: `tests/state-recovery.cjs` (baru), perluas `tests/task-store.cjs`

**Steps:**
- [x] 1. Helper `recoverState(file, validate, fresh, corruptFresh)`: valid → pakai dan tulis snapshot `last-good`; rusak → arsip `.corrupt-<timestamp>`, coba snapshot terbaru, lalu fallback dan tandai `degraded`.
- [x] 2. Tambah `migrateWorkspace(state)` dengan versi skema eksplisit (v1); legacy `tasks.json` disalin ke `last-good` sebelum migrasi.
- [x] 3. Org/rooms tidak di-reseed diam-diam saat korup tanpa snapshot: org menjadi kosong, rooms menjadi daftar kosong, dan semuanya dilaporkan di `/api/workspace/info` + `/api/health`.
- [x] 4. `team.json` korup diarsipkan dan startup lanjut dengan org kosong; `scripts/doctor.mjs` menjadi jalur perbaikan manual.
- [x] 5. Settings/credentials memakai helper yang sama; state `degraded` tetap memblokir save sampai dipulihkan.

**Acceptance:**
- `tests/state-recovery.cjs`: lima file state korup sekaligus → server hidup, semua diarsipkan, org/tasks kosong, settings `broken`, info melaporkan lima entri recovery.
- `tests/task-store.cjs`: workspace rusak dipulihkan dari `last-good`; legacy rusak tidak lagi mematikan store.
- `tests/team.cjs`, `tests/settings.cjs`, `tests/org-api-v2.cjs` lulus.

---

### Task 7: Health/readiness, graceful shutdown, dan lock satu instance

**Masalah:** tidak ada endpoint health; SIGTERM/SIGINT tidak ditangani sehingga job, preview, dan SSE tetap hidup; dua server dengan `DATA_DIR` sama bisa saling menimpa `workspace.json`.

**Files:**
- Modify: `server/server.js`, `server/task-store.js`, `start.bat`
- Test: `tests/health-shutdown.cjs` (baru)

**Steps:**
- [x] 1. `GET /api/health` (tanpa token, tanpa secret): status, uptime, port, dataDirWritable, version, hitungan status task, streams, running jobs, retry timers, gate queue/cooldowns, dan recovery; `GET /api/ready`.
- [x] 2. Handler SIGTERM/SIGINT: tutup koneksi, abort job runner, `previews.stopAll()`, tutup SSE, tandai job `interrupted`, lepas lock, paksa keluar setelah 8 detik.
- [x] 3. Lockfile `data/.lock` (exclusive open + PID); instance kedua menolak start; lock basi dideteksi dari PID yang sudah mati.
- [x] 4. `scripts/open-when-ready.mjs` membaca `PORT` dari `.env`, menunggu `/api/ready`, lalu membuka browser; `start.bat` memakainya.
- [x] 5. `headersTimeout`/`requestTimeout` eksplisit untuk request yang menggantung.

**Acceptance:**
- `tests/health-shutdown.cjs`: health/ready menjawab, server kedua keluar 1 dengan pesan lock, dan start setelah pemilik lock mati berhasil.
- Port lama bebas setelah SIGTERM; lock baru dimiliki proses pengganti.
- Catatan: pembukaan browser diuji lewat helper (bukan klik manual di Windows).

---

### Task 8: Reset dan retensi untuk `data/projects` dan arsip

**Masalah:** reset workspace tidak mengarsipkan/menghapus `data/projects`; revisi dan output job tumbuh tanpa batas.

**Files:**
- Modify: `server/server.js` (reset), `server/project-workspace.js`
- Test: perluas `tests/workspace-lifecycle.cjs`

**Steps:**
- [x] 1. Reset menghentikan preview lalu memindahkan `data/projects` ke `archive/projects-<stamp>`; folder terkunci membatalkan reset sebelum state lain dibersihkan.
- [x] 2. Retensi: simpan 20 revisi terakhir per project dan hapus job >30 hari (`KANTOR_KEEP_REVISIONS`, `KANTOR_JOB_MAX_AGE_DAYS`); dijalankan saat boot, setelah job selesai, dan harian.
- [x] 3. Ukuran `data/` tersedia lewat `scripts/doctor.mjs` dan `/api/workspace/info`; peringatan >500 MB di Pengaturan belum dikerjakan (deferred ke Fase 4).

**Acceptance:**
- `tests/workspace-lifecycle.cjs`: reset mengembalikan `projectsArchive`, folder proyek hilang dari data aktif, dan source ada di arsip.
- `tests/project-workspace.cjs`: 25 revisi → tersisa 20 terbaru; job 40 hari terhapus, job baru tetap.

---

# Fase 3 — Performa

### Task 9: Satu transaksi per commit

**Masalah:** `commit()` memanggil `save()` lalu transaksi kedua dan dua `snapshot()`; setiap event/pesan/keputusan menulis seluruh workspace dua kali dan meng-clone state berkali-kali.

**Files:**
- Modify: `server/server.js` (semua situs mutasi in-place), `server/task-store.js`
- Test: perluas `tests/task-store.cjs`, `tests/project-workspace.cjs`; tambah `tests/commit-cost.cjs`

**Steps:**
- [x] 1. Konversi PATCH approve/revisi ke satu mutator transaksi: ubah task, promosikan parent di `draft.tasks`, catat memori, dan emit `task.phase` dalam commit yang sama.
- [x] 2. `commit()` tidak lagi memanggil `save()`; ia menjalankan satu transaksi lalu satu `snapshot()`. Situs lain yang mengubah `tasks` in-place tetap satu tulisan lewat `save()` (create, reassign, wizard, boot).
- [x] 3. `promoteParent(parentId, list)` bisa bekerja pada draft transaksi maupun array global.
- [x] 4. Instrumentasi: `taskStore.writes()` + `workspaceWrites` di `/api/health`; tes `commit-cost.cjs` membandingkan angka sebelum/sesudah approve.

**Acceptance:**
- Satu approve menaikkan `workspaceWrites` tepat 1 dan `workspaceVersion` tepat 1.
- Hasil anak tetap terbawa ke parent setelah promosi; memori agen tetap tercatat.
- Suite unit 59/59 dan tes approval UI (`decisions`, `org-owner`, `application-workflow-ui`) lulus.

---

### Task 10: Batasi pertumbuhan state dan poll hanya yang berubah

**Masalah:** `jobs[].evidence` menyimpan stdout/stderr penuh; pesan tidak dipangkas; `/api/tasks` mengembalikan semuanya dan dipoll 2,5 detik; messenger mengambil seluruh inbox meski API punya cursor.

**Files:**
- Modify: `server/server.js`, `server/task-store.js`, `server/project-runner.js`, `public/tasks.js`, `public/messenger.js`
- Test: perluas `tests/task-store.cjs`, `tests/messenger-ui.cjs`, `tests/task-events.cjs`

**Steps:**
- [ ] 1. Tulis log job ke `data/projects/<id>/jobs/<jobId>/` dan simpan hanya excerpt ≤16 KB per fase di workspace.
- [ ] 2. Tambah retensi pesan/thread selesai di `prune()` (mis. 90 hari / 5.000 pesan terakhir) dengan ringkasan tetap.
- [ ] 3. Tambah `GET /api/tasks?summary=1` (tanpa `history`/`messages`/`evidence`) untuk polling; klien memakai detail saat drawer dibuka.
- [ ] 4. Messenger memakai `after=nextSeq` dan berhenti polling saat `document.hidden` + refresh saat `visibilitychange`.

**Acceptance:**
- Ukuran `workspace.json` tetap <5 MB setelah 20 job dengan output 1 MB.
- Poll `/api/tasks?summary=1` mengembalikan <20% byte dibanding versi penuh untuk dataset yang sama.
- Messenger tetap menerima pesan baru setelah tab kembali terlihat; `tests/task-events.cjs` lulus.

---

### Task 11: Watchdog aset model dan penanganan context loss

**Masalah:** startup menunggu semua GLTF tanpa timeout; kehilangan konteks WebGL membekukan canvas tanpa pesan.

**Files:**
- Modify: `public/office.js`, `public/office-models.js`, `public/three-global.js`
- Test: perluas `tests/office-models.cjs`, `tests/graphics-lifecycle.cjs`

**Steps:**
- [ ] 1. Race `officeModels3d.ready()` dengan deadline 12 detik; bila lewat, render dengan fallback prosedural dan tampilkan status yang bisa ditutup.
- [ ] 2. Tambah `.catch` pada rantai pemuatan script vendor; tulis pesan jelas + tombol Muat ulang ke `#sceneStatus`.
- [ ] 3. Listener `webglcontextlost` (preventDefault + hentikan rAF + pesan) dan `webglcontextrestored` (re-init renderer/composer atau reload).

**Acceptance:**
- Tes memblokir `/assets/manifest.json` dengan delay 20 detik: scene tampil <15 detik dengan fallback, tanpa error halaman.
- Tes memicu `WEBGL_lose_context`: muncul pesan dan canvas tidak membeku diam-diam.

---

### Task 12: Kurangi alokasi di frame loop

**Masalah:** empat `mobility.snapshot()` (structuredClone) per frame, `querySelector`/`matchMedia`/sort/filter per frame, dan dua `Vector3` baru per agen tiap frame.

**Files:**
- Modify: `public/office.js`
- Test: perluas `tests/graphics-performance.cjs`, `tests/mobility.cjs`

**Steps:**
- [ ] 1. Ambil satu snapshot per frame setelah `mobility.tick`, teruskan ke `stepShop`, `updateTeamTravel`, `environment.update`, dan cek garasi.
- [ ] 2. Cache: flag modal terbuka (event nav), `reduceMotion`, elemen badge lantai, dan `activeTaskByName` (Map yang di-refresh saat `officetasks:change`).
- [ ] 3. Ganti alokasi per agen dengan scratch vector; urutkan agen hanya saat frame berikutnya butuh urutan baru.
- [ ] 4. Ukur dengan `renderer.info` + waktu frame rata-rata sebelum/sesudah pada viewport 1280×860.

**Acceptance:**
- Draw call dan hasil visual tidak berubah; tidak ada error.
- Waktu frame rata-rata turun ≥10% di lantai kerja penuh, atau alokasi per frame turun ≥30% (pilih salah satu metrik yang stabil di mesin uji).

---

### Task 13: Finalisasi lantai dinamis dan dispose group

**Masalah:** lantai yang dibuat setelah startup tidak menjalankan `mergeStatic`; rebuild meja/ruangan/lantai membuang group tanpa dispose geometri/material/texture.

**Files:**
- Modify: `public/office.js` (`setFloorCount`, `seatAreas`, `removeRoomBuilt`, `removeCustomItem`)
- Test: perluas `tests/graphics-dynamic-floors.cjs`, `tests/graphics-lifecycle.cjs`, `tests/rooms-merge.cjs`

**Steps:**
- [ ] 1. Ekstrak `finalizeFloor(level)` (rasterize + mergeStatic) dan panggil setelah `shell`/`dress`/`furnishExtraWorkFloor` di startup maupun `setFloorCount`.
- [ ] 2. Buat `disposeGroup(root)` yang hanya membuang resource milik group (bukan geometri shared `softBox`/model GLTF/cache `surface()`).
- [ ] 3. Panggil di `seatAreas`, `removeRoomBuilt` (termasuk layar animasi), `removeCustomItem`, dan `setFloorCount`.
- [ ] 4. Tes siklus: tambah/hapus lantai dan ruangan 20 kali; `renderer.info.memory` harus kembali ke kisaran awal.

**Acceptance:**
- Lantai ke-4/5 punya draw call dalam ±15% lantai bawaan dengan jumlah furnitur setara.
- Tidak ada kenaikan tekstur/geometri monoton setelah siklus 20×.
- `tests/office.cjs` dan `tests/graphics-dynamic-floors.cjs` lulus.

---

# Fase 4 — UX, Mobile, Aksesibilitas

### Task 14: Perbaikan layout mobile dan header drawer

**Masalah:** resize memicu reset kamera (di ponsel sering karena URL bar/keyboard); input 13-14px memicu zoom iOS; `settings-header` kehilangan titik sehingga layout header rusak; rail bawah meluap saat tombol keputusan muncul.

**Files:**
- Modify: `public/office.js`, `public/tasks.css`, `public/office.css`
- Test: perluas `tests/office.cjs`, `tests/nav.cjs`, `tests/settings-ui.cjs`

**Steps:**
- [ ] 1. Resize: perbarui aspect/renderer/composer saja; pertahankan `cam.target/theta/phi/radius`. Debounce rAF; abaikan perubahan tinggi saat input fokus/`visualViewport` menunjukkan keyboard.
- [ ] 2. `@media (pointer:coarse)`: `input/select/textarea { font-size:16px }`.
- [ ] 3. Perbaiki selektor `settings-header` → `.settings-header` dan tambahkan assertion layout (tombol Tutup rata kanan).
- [ ] 4. Rail <640px: lipat item sekunder ke Lainnya atau satukan `#decisions` ke Tugas; uji 360px dengan keputusan terbuka.

**Acceptance:**
- Rotasi/resize tidak mengubah posisi kamera; menggeser URL bar di emulasi ponsel tidak me-reset view.
- Tes 360px dengan `#decisions` terlihat: tidak ada tombol terpotong (`scrollWidth <= clientWidth`).
- Screenshot header Pengaturan/Ruang menunjukkan judul kiri, Tutup kanan.

---

### Task 15: Preferensi rutinitas, sinkronisasi org, dan poll sadar-visibilitas

**Masalah:** `routineDefault` tersimpan tapi tidak pernah dibaca; org dari tab lain tidak tersinkron; poll berjalan saat tab tersembunyi.

**Files:**
- Modify: `public/office.js`, `public/settings.js`, `public/tasks.js`, `public/messenger.js`
- Test: perluas `tests/settings-ui.cjs`, `tests/office.cjs`, `tests/messenger-ui.cjs`

**Steps:**
- [ ] 1. Saat init, baca `routineDefault` (kecuali `prefers-reduced-motion`); perubahan checkbox langsung memanggil `officeScene.setRoutine()`.
- [ ] 2. Tambah `org.version` (atau hash) di poll `/api/tasks`; bila berubah, panggil `orgChanged()`/`applyOrg` tanpa reload, lewati saat ada edit lokal yang belum disimpan.
- [ ] 3. Pause poll saat `document.hidden`, refresh saat `visibilitychange`; tampilkan status koneksi di `#messengerStatus` bila refresh gagal.

**Acceptance:**
- Mematikan rutinitas lalu reload: rutinitas tetap mati.
- Dua tab: menambah departemen di tab A memunculkan area baru di tab B dalam ≤3 detik.
- Interval poll tidak berjalan saat tab tersembunyi (dapat diverifikasi lewat log request server).

---

### Task 16: Rename ruangan bawaan dan akses keyboard denah

**Masalah:** rename ruangan built-in hanya mengubah sidebar, tidak label 3D; denah ruangan hanya bisa pointer.

**Files:**
- Modify: `public/office.js`, `public/rooms.js`, `public/index.html`
- Test: perluas `tests/rooms.cjs`, `tests/rooms-nav.cjs`, `tests/nav-hardening.cjs`

**Steps:**
- [ ] 1. Simpan peta nama built-in dari `/api/rooms` dan perbarui texture label saat applyRooms (bukan menyaring built-in dari semua logika).
- [ ] 2. Tambah input angka X/Z (dan lebar/kedalaman) di form ruangan; samakan dengan panel furnitur.
- [ ] 3. `tabindex="0"` pada `#roomPlan`, panah untuk menggeser 0,1 m (Shift 0,5 m), `aria-live` mengumumkan posisi.

**Acceptance:**
- Rename "Meeting Room" → label 3D berubah setelah simpan/reload.
- Ruangan dapat dipindah tanpa mouse; posisi akhir sama dengan drag.

---

### Task 17: Pertahankan fokus keyboard dan konsistensi bahasa

**Masalah:** render ulang daftar task/thread membuang fokus; UI mencampur Indonesia/Inggris termasuk `aria-label`.

**Files:**
- Modify: `public/task-workspace.js`, `public/tasks.js`, `public/messenger.js`, `public/office.js`, `public/rooms.js`
- Test: perluas `tests/task-board.cjs`, `tests/messenger-ui.cjs`, `tests/nav.cjs`

**Steps:**
- [ ] 1. Setelah render, kembalikan fokus ke `[data-task-id="…"] .task-card-open` / `[data-thread-id="…"]`; pertahankan `scrollLeft` board.
- [ ] 2. Tambah tabel string Indonesia untuk label yang masih Inggris (kolom board, pesan custom/inventory, aria-label, jenis furnitur).
- [ ] 3. Jaga `lang="id"` konsisten; istilah teknis yang dipertahankan dalam Inggris diberi penjelasan singkat.

**Acceptance:**
- Memilih kartu task tidak kehilangan fokus; panah atas/bawah tetap berfungsi pada daftar.
- Tes `grep` memastikan tidak ada `aria-label` berbahasa Inggris pada elemen yang terlihat.

---

# Fase 5 — QA & Delivery

### Task 18: Perkuat runner tes

**Masalah:** daftar UI di-hardcode; port tetap; `child.kill()` tidak membunuh process tree; screenshot ke `/private/tmp`; tidak ada guard zero-file.

**Files:**
- Modify: `tests/run-suite.cjs`, `tests/*.cjs` (port & screenshot), `tests/browser.cjs`
- Test: `npm run test:unit`, `npm run test:ui`

**Steps:**
- [ ] 1. Auto-deteksi tes UI (`require('./browser.cjs')`) atau file penanda; gagal bila 0 file cocok.
- [ ] 2. Server tes bind ke port 0 dan kirim lewat env; hapus port hardcoded bertahap (mulai dari tes baru).
- [ ] 3. Jalankan child detached dan bunuh seluruh process tree saat timeout (`taskkill /T /F` di Windows, process group di POSIX).
- [ ] 4. Screenshot ke `os.tmpdir()/kantor-tests` setelah `mkdirSync`; bersihkan `mkdtempSync` di `finally`.
- [ ] 5. Naikkan/konfigurasikan timeout per file (env `TEST_TIMEOUT_MS`).

**Acceptance:**
- Suite unit dan UI tetap 100% lulus; tidak ada port tertinggal setelah tes gagal yang disimulasikan.
- Menjalankan `node tests/run-suite.cjs unit` di checkout bersih tidak menyertakan file UI.

---

### Task 19: CI dan static gate

**Masalah:** tidak ada CI, lint, format, atau typecheck.

**Files:**
- Create: `.github/workflows/ci.yml`, `eslint.config.mjs`, `.prettierrc` (opsional)
- Modify: `package.json`
- Test: workflow run di PR

**Steps:**
- [ ] 1. Workflow: job Linux `unit` + job Windows `ui` (Node 22, `npm ci`, install Chromium, upload `.superpowers/suite-logs`).
- [ ] 2. Script `lint` (ESLint `no-undef`, `no-unused-vars`, `no-floating-promises` bila memungkinkan) untuk `server/`, `public/`, `tests/`; `check` menjalankan `node --check` semua file.
- [ ] 3. Typecheck bertahap: `tsc --allowJs --checkJs --noEmit` dimulai dari `server/task-store.js`, `server/project-workspace.js`, `server/settings.js` dengan JSDoc.
- [ ] 4. Jadikan lint + unit sebagai required check; UI Windows boleh `continue-on-error` sampai stabil.

**Acceptance:**
- PR pertama menjalankan CI hijau; log tes terunggah saat gagal.
- `npm run lint` gagal pada pelanggaran yang disengaja (uji cepat).

---

### Task 20: Tes perimeter API dan dokumentasi

**Masalah:** beberapa endpoint/guard belum punya tes langsung; README belum menjelaskan backup/health/CI.

**Files:**
- Create: `tests/api-guard.cjs`
- Modify: `tests/settings-ui.cjs`, `tests/org-kanban.cjs`, `tests/application-workflow-ui.cjs`, `README.md`, `docs/superpowers/specs/`
- Test: suite

**Steps:**
- [ ] 1. Tes guard: cross-origin, content-type salah, body >1 MB, host header salah, traversal statis, arsip tanpa token.
- [ ] 2. Tes endpoint: provider test, import 409 saat store non-kosong, `stop-preview`, SSE disconnect/backpressure.
- [ ] 3. Dokumentasi: bagian "Backup & pemulihan", "Health & shutdown", "CI & lint", dan catatan `settings.key`.
- [ ] 4. Catat item di luar cakupan (auth LAN, deployment Docker) sebagai keputusan produk, bukan bug.

**Acceptance:**
- Semua tes baru lulus di Windows; tes guard tidak bergantung pada port tetap.
- README menyebut perintah backup/restore/doctor dan konsekuensi kehilangan `settings.key`.

---

## Definition of Done (per fase)

- Fase 1: tiga tes regresi baru lulus; suite unit penuh lulus; tidak ada perubahan perilaku owner di luar penolakan request tak berizin.
- Fase 2: boot dari state rusak tidak mematikan server; backup/restore round-trip lulus; health dan SIGTERM teruji.
- Fase 3: angka sebelum/sesudah tercatat (ukuran workspace, jumlah tulis, draw call, frame time); tidak ada kebocoran resource pada siklus rebuild.
- Fase 4: layout 360/768/1440 tanpa overflow; screenshot header; fokus keyboard tidak hilang.
- Fase 5: CI hijau di PR; `npm run lint` dan `npm run check` tersedia; log suite terunggah saat gagal.

## Di luar cakupan (keputusan produk)

- Autentikasi multi-user / akses LAN: aplikasi ini dirancang single-user lokal; perubahan `HOST` dan origin harus dibahas terpisah.
- Docker/compose untuk server aplikasi (bukan runner): butuh keputusan deployment.
- Migrasi ke database: JSON store masih memadai untuk skala saat ini.
- i18n penuh (mesin terjemahan): Task 17 hanya menyatukan string yang terlihat, bukan sistem i18n.

## Progress log

- 2026-10-27 — Fase 1 selesai di working tree (belum commit):
  - Task 1: `synthAttempts`, backoff, batas 3 percobaan, timer server 1 detik, retry owner.
  - Task 2: token di awal PATCH privileged, guard `REVIEW_REQUIRED`, tes org-tasks/org-owner/decisions disesuaikan.
  - Task 3: marker `customRoom`, urutan `mergeStatic` sebelum `applyRooms`, dispose group, race `refreshSeq` di drawer, `roomMeshes`/`meshCount` untuk tes.
  - Tes baru: `tests/task-synthesis-retry.cjs`, `tests/task-auth.cjs`, `tests/rooms-merge.cjs` (UI).
  - Verifikasi: suite unit 54/54; rooms, rooms-nav, rooms-merge, org-owner, decisions, server, task-retry, application-workflow-ui, office, graphics-dynamic-floors lulus.
  - Catatan: `settings-header` (Task 14) sengaja belum disentuh; masih masuk Fase 4.
- 2026-10-27 — Fase 2 selesai di working tree (belum commit):
  - Task 4: provider cooldown per kantor, `Retry-After` (clamp 5 menit), snippet error teredaksi, timer antrean.
  - Task 5: `server/backup.js` + tiga skrip (backup/restore/doctor), endpoint owner-only `/api/workspace/info` dan `/api/workspace/import`.
  - Task 6: `server/state-recovery.js` dipakai workspace, org, rooms, settings, credentials, dan migrasi `team.json`; snapshot `last-good` + arsip `.corrupt-*`.
  - Task 7: `/api/health`, `/api/ready`, SIGINT/SIGTERM, `previews.stopAll()`, lock `data/.lock`, helper pembuka browser yang menunggu ready.
  - Task 8: reset mengarsipkan `data/projects`, retensi revisi/job, prune saat boot/selesai job/harian.
  - Tes baru: `provider-cooldown`, `backup-restore`, `state-recovery`, `health-shutdown`; `auto-retry` mock memakai `Retry-After`.
  - Verifikasi: suite unit 58/58; UI `settings-ui`, `server`, `org-owner`, `org-wizard` lulus.
  - Catatan: peringatan ukuran data di Pengaturan belum dibuat; health/info sudah melaporkan ukuran lewat doctor/info.
- 2026-10-27 — Task 9 selesai di working tree (belum commit):
  - `commit()` satu transaksi + satu snapshot; approve, promosi parent dan memori dalam satu commit.
  - `workspaceWrites` di `/api/health`; `tests/commit-cost.cjs` membuktikan +1 tulisan dan +1 versi per approve.
  - Perbaikan bug yang muncul saat refactor: `promoteParent` menerima `draft.tasks`, bukan seluruh state.
  - Verifikasi: suite unit 59/59; decisions, org-owner, application-workflow-ui, team lulus.
  - Sisa Fase 3: Task 10 (pertumbuhan state & polling), 11 (watchdog aset/WebGL), 12 (alokasi frame), 13 (finalisasi lantai dinamis).

## Risiko utama

| Risiko | Mitigasi |
|---|---|
| Refactor commit (Task 9) menyentuh banyak handler | Kerjakan setelah Task 2; jaga tes approval/orchestrator sebagai jaring; commit kecil per handler |
| Ghost room fix mengubah nav grid | Tes rooms-merge membandingkan `navGrid` sebelum/sesudah; merge jumpa di akhir |
| Backup/restore menimpa data salah | Validasi manifest + backup pra-restore wajib + `replace:true` |
| CI Windows tidak stabil (GPU/Playwright) | UI job `continue-on-error` sampai hijau 3 run berturut-turut; unit jadi gate utama |
| Cooldown provider terlalu agresif | `Retry-After` dihormati; batas maksimum cooldown 5 menit; retry per task tetap ada |
