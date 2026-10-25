# Spec 1 — Org chart + approve satu pintu (2026-10-03)

Status: implemented 2026-10-03 (branch feat/org-approve). Spec 2 (thread), Spec 3 (rooms), Spec 4 (kanban) open.

## Intent
Kantor virtual berstruktur: tiap anggota punya atasan langsung (`manager`),
rantai naik otomatis sampai puncak. Draft bawahan wajib lewat manager
(`manager-review`) sebelum sampai ke owner (`review`). Owner = anggota tanpa
manager, kuasa atas semua.
Sukses: assign/reassign/approve tahap-1 hanya oleh manager atas subtree-nya;
draft tak bisa loncat ke owner; siklus manager ditolak.

## Constraints
Single-user lokal, tanpa login, server 127.0.0.1. Canonical tetap
`data/team.json` + field baru. Tanpa auth/roles. Dry-run tetap jalan.

## Data — `team.json` + field `manager`
`manager`: nama anggota lain atau `null` (owner). Validasi: harus anggota
existing, bukan diri sendiri, anti-siklus ( узел jalan rantai dari calon
manager; bila ketemu diri = tolak 409). Rename cascade ke field `manager`
semua anggota + `tasks.json` assignee. Hapus anggota: bawahan langsung wajib
reassign manager baru (pilih per bawahan, default ke manager almarhum);
bila almarhum owner, bawahan tanpa manager = jadi owner.
Kuasa: `isManagerOf(actor, target)` = target di subtree actor (rekursif).
Owner kuasa atas semua.

## API
- `PATCH /api/team/:n {manager}` — 200/400/404/409 (siklus, diri sendiri, unknown).
- Task state baru `manager-review`: worker AI tulis draft ke sini (bukan `review`).
- `PATCH /api/tasks/:id {action:'manager-approve'|'manager-reject', version}` —
  hanya bila caller = manager subtree assignee (single-user: guard = "assignee
  punya manager dan action oleh manager"; enforced via `reviewedBy` field?
  lihat Ruling). approve → `review`; reject + feedback → `queued`.
- `approve` final (`review`→`done`) hanya untuk tugas tanpa manager pending;
  tugas dari owner langsung (`manager:null`) skip `manager-review`.
- Handoff event: `delegated` (manager assign ke bawahan), `submitted`
  (bawahan ke manager), `manager-approved`, `manager-rejected` — masuk Office
  log + bubble 3D.

## AI — template per level
`defaultSystem(role, isManager)`: manager = delegasi, review bawahan,
QUESTIONS bila brief kurang; staff = eksekusi, lapor ke manager.
Custom `ai.system` per anggota tetap menang. Tersimpan di `team.json`.

## UI — dialog Tasks + Team tab
Team tab: tiap baris + select manager (dropdown anggota lain + "Owner").
Task meta tampil rantai: `KR → KW → KA`. Tombol approve bertingkat:
`manager-review` = "Manager approve / Request changes";
`review` = "Approve & finish" existing.
Kanban (Spec 4) tampilkan kolom `manager-review` sebagai kolom sendiri.

## Uji
`tests/org.cjs` baru: rantai 3 level, siklus ditolak, assign lintas subtree
ditolak, alur penuh queued→manager-review→review→done, reject→queued,
rename cascade manager, hapus manager + reassign bawahan.
`worker-reliability.cjs`, `team.cjs` tetap hijau.

## Bukan bagian spec
Thread chat (Spec 2), ruangan custom (Spec 3), kanban (Spec 4), auth/roles.
