# Spec 4 — Kanban + strip ringkas + drawer (2026-10-03)

Status: superseded. Implementasi final memakai 4 kolom
(Tugas / In progress / Review / Selesai) di `public/task-workspace.js`; rencana 6 kolom
di bawah disimpan sebagai riwayat.

## Intent
Papan kanban gantikan list Tasks: rencana awal 6 kolom status
(Queued → In progress → Needs decision → Manager review → Needs review → Done),
strip ringkas atas (per agen + total), klik kartu = drawer detail full.
Tanpa drag di v1; pindah status via tombol existing (guard 409 tetap).
Sukses: progres tiap agen terlihat sekilas; klik tahu sampai mana.

## Constraints
Tanpa drag-and-drop v1. Guard status existing tak diubah. Tanpa auth.
Polling 2.5s existing. Mobile: kolom horizontal scroll.

## UI — gantikan `#taskList`
- Strip ringkas: per AI member (inisial + count aktif + count perlu aksi) + total.
- 6 kolom, kartu ringkas: judul (2 baris) + inisial + badge model/by + umur.
- Klik kartu = drawer kanan: brief, draft + history, thread (Spec 2),
  rantai manager (Spec 1), tombol aksi sesuai status
  (Start/Back/Approve/Revise/Answer/Manager-approve).
- Filter status/assignee existing tetap (filter kolom yang tampil).
- Arsip "no longer on the team" = kartu abu + pindah manual (reuse).

## Data/API
Tanpa endpoint baru. Konsumsi `/api/tasks`, `/api/team`, `/api/agents`.
`officetasks:change` re-render papan (reuse).

## Uji
`tests/kanban.cjs` baru (playwright): 6 kolom render, kartu klik buka
drawer, aksi approve/revise dari drawer, strip count benar, filter
menyempitkan kolom. Suite existing hijau.

## Bukan bagian spec
Drag-and-drop (v2 bila diminta), swimlane per anggota, notifikasi push.
