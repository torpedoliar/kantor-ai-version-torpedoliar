# Spec 3 — Ruangan custom + roam bebas (2026-10-03)

Status: draft, awaits review. Butuh: Spec 1 (grup label tetap). Lanjut: Spec 4.

## Intent
Owner tambah/rename ruangan dari template tipe + seret posisi di denah 2D +
furnitur katalog snap grid. Agen bisa aktivitas + roam ke semua lantai dan
ruangan baru saat idle. Tugas tetap jangkar ke meja.
Sukses: ruangan baru langsung dipakai meeting/lounge/fokus; kapasitas
ditegakkan; tanpa overlap; tanpa crash nav-mesh.

## Constraints
Tanpa gambar dinding bebas di v1. Nav grid rebuild dari furnitur existing.
Tanpa auth. `data/rooms.json` canonical, tulis atomik.

## Data — `data/rooms.json`
`{id, name, floor, type, x, z, w, d, capacity, furniture[]}` —
type: `meeting|focus|lounge|pantry|musholla|custom`.
furniture: `{kind, x, z}` kind dari katalog
(meja, kursi, sofa, board, tanaman). Kapasitas default per template.
Validasi: dalam batas lantai, tanpa overlap ruangan lain, kapasitas 1–8
(sama dengan jumlah kursi maksimum yang dibangun scene 3D).

## API
- `GET/POST/PATCH/DELETE /api/rooms` — 200/201/400/404/409 (overlap).
- Hapus ruangan berisi occupant = tolak 409 (kosongkan dulu via Back to work).
- Ruangan existing (meeting room, phone booth, pantry, musholla) = seed
  read-only (tanpa DELETE, rename boleh).

## 3D + aktivitas
Template → geometri otomatis (meja + kursi = kapasitas + board/pantry
per tipe). Furnitur katalog snap 0.5 grid. Nav grid rebuild setelah
tambah/ubah. Activity mapping: meeting→`meet`, lounge→`lounge`,
focus→`work` sunyi, pantry→`drink`. Roam idle-only (perluasan routine):
pool tujuan = hangouts + ruangan baru semua lantai; tugas aktif jarang
roam; batas 4 pergi tetap; toggle global + opt-out per anggota
(`roam:false` di team.json).

## UI — tab Rooms di dialog Tasks
List + form (nama, lantai, tipe, kapasitas) + denah 2D seret posisi
(canvas 2D top-down, snap grid). Furnitur: tambah via dropdown katalog +
klik denah. Validasi overlap tampil sebelum save.

## Uji
`tests/rooms.cjs` baru: CRUD, overlap ditolak, kapasitas ditegakkan
(meeting 6 tolak 7), nav-mesh tak crash, roam capai ruangan baru,
opt-out dihormati. Suite existing hijau.

## Bukan bagian spec
Dinding bebas, kanban (Spec 4), thread (Spec 2), auth.
