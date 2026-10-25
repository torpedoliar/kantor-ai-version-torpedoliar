# Spec 1 — Team management + model dropdown (2026-10-02)

Status: implemented 2026-10-02 (branch feat/team-management). Spec 2 (chat) dan Spec 3 (kanban) open.

Ruling vs draft: meja + karpet tetap untuk 4; anak ke-5+ ke waiting bench di luar
karpet (bukan auto-grow). Tugas anggota terhapus = pesan "no longer on the team"
+ opsi pindah manual (bukan arsip non-klik murni).

## Intent
Rename tiap anggota, tambah/kurang anggota via UI, hapus wajib reassign.
Dropdown AI model fetch daftar router. Semua browser lihat tim sama.
Sukses: kelola tim tanpa restart, tasks ikut pindah, semua avatar duduk, dropdown terisi untuk AI member.

## Constraints
Single-user lokal, tanpa login, server hanya 127.0.0.1. `data/team.json` canonical.
Mode dry-run tanpa key tetap jalan. Tanpa auth/roles di spec ini.

## Data — `data/team.json`
Array, tulis atomik ala `tasks.json`. Boot: load file, fallback 13 bawaan bila file kosong.
Migrasi sekali jalan: `models.json` lama digabung ke field `ai.model`, lalu file lama diabaikan.

```
{n, initials, gender, role, group, ai: null | {on, model, system}}
```

- `n`: 1–80 char, unik case-insensitive. Kunci rename cascade.
- `initials`: 1–4 char, unik case-insensitive.
- `gender`: `male` | `female`. `group`: `leadership` | `marketing` | `engineering` | `service`.
- `ai.on`: toggle. `ai.model`: id dari router, fallback `ANTHROPIC_MODEL`.
  `ai.system`: 1–5000 char, default template generik berbasis role + aturan QUESTIONS bila kosong.
- `server/agents.js` tinggal seed default (Kak Rani, Kak Sinta). Hidup/mati/model/system efektif baca dari `team.json`.

## API
| Method | Path | Body | Sukses | Gagal |
|---|---|---|---|---|
| GET | /api/team | – | 200 array | – |
| POST | /api/team | {n, initials, gender, role, group, ai?} | 201 member | 400 validasi, 409 nama/inisial duplikat |
| PATCH | /api/team/:n | {n?, initials?, role?, group?, gender?, ai?} | 200 member | 400/404/409 |
| DELETE | /api/team/:n?reassignTo= | – | 200 {moved} | 404, 409 bila tugas non-done tanpa reassignTo |
| GET | /api/models | – | 200 [id] (tetap) | 502 pesan router |
| PATCH | /api/agents/:name | {model} | tetap, tulis ke team.json | tetap |

Rename cascade atomik: `tasks.json` (assignee), kunci agen, `askedBy`, history `by` label tetap apa adanya (riwayat tak diubah).
Hapus: tolak 409 bila ada tugas status queued/active/review/blocked dan tanpa `reassignTo`.
Bila ada: pindah semua tugas non-done ke pengganti, status active jadi queued, `runId` null, `version`+1, lalu hapus.
Tugas done milik almarhum tetap, tampil label arsip non-klik.
Worker baca config efektif per nama dari team; nama tak dikenal = skip.

## UI — dialog Tasks
Tab `Tasks | Team` di header `#taskDialog`, state tab di memori tab saja.
Panel Team: list (inisial, nama, role, badge AI + model). Klik = form edit.
Tambah: baris `+ Add member`, form kosong, POST. Hapus: tombol per baris;
bila tugas non-done ada = dialog pilih `reassignTo` + konfirmasi, lalu DELETE.
`#taskModel` fix (bukan fetch gagal): disabled bila assignee manual + pesan
"Manual member, no AI model." Bila AI: isi dari `/api/models`, current selalu
opsi pertama bila tak ada di list. Dry-run = pesan set key. Fetch gagal =
pesan error + retry. `syncModelSelect` tiap buka dialog dan ganti assignee.
Assignee dropdown + filter rebuild dari `/api/team`. Save model PATCH lalu
update `server.members` + `render()`.

## 3D — kursi dinamis + waiting
Meja grup auto-grow: lebar meja + karpet + kursi ikut count, grid 2 kolom
untuk 4 pertama (kode existing). Anak ke-5+ ke waiting bench area grup:
bangku + laptop di pangkuan, pose `sit` existing, label inisial tetap.
Tanpa avatar berdiri idle, tanpa kursi tumpang tindih.
Rebuild meja + karakter saat event `officetasks:team`; posisi reset ke meja.
Roster tunggal dari `/api/team` (fetch awal, fallback 13 bila server mati).
`office.js` hapus duplikat TEAM statis sebagai sumber; jadikan fallback saja.

## Migrasi
Tugas existing cocok by nama persis. Tak cocok = label arsip non-klik di list.
Tanpa hapus data. `data/models.json` lama digabung sekali, bukan sumber lagi.

## Uji
`tests/team.cjs` baru: CRUD roundtrip, rename cascade, hapus 409 tanpa reassign,
hapus + pindah dengan reassign, toggle AI + draft via mock, waiting seat render,
kursi = anggota. Update `decisions.cjs` (nama/model baru), `office.cjs`
(13 → dinamis), `building-view.cjs` (count dinamis). `worker-reliability.cjs`
tetap hijau.

## Bukan bagian spec
Chat agen (Spec 2), kanban panel samping 3D (Spec 3), auth/roles,
editor prompt rich-text, avatar custom. Tanpa itu v1 selesai.
