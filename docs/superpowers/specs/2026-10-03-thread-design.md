# Spec 2 — Thread per task (2026-10-03)

Status: draft, awaits review. Butuh: Spec 1 (state + handoff). Lanjut: Spec 3, Spec 4.

## Intent
Satu thread per task: agen auto-post milestone (start, QUESTIONS, draft,
handoff delegasi/submit/approve), owner/manager bisa balas; balasan =
feedback revise, agen draft ulang via flow revise existing.
Sukses: tiap task punya riwayat percakapan utuh yang bisa dibaca; balas
mudah tanpa endpoint chat terpisah.

## Constraints
Reuse flow revise/answer existing. Tanpa websocket; polling 2.5s existing.
Tanpa auth. Thread read-only untuk agen selain penulis milestone.

## Data — `task.thread[]`
`{by, kind, text, createdAt}` — kind: `milestone|question|draft|handoff|reply`.
Append-only; tulis atomik bareng `tasks.json`. Batas 100 entri per task
(buang paling lama, draft `history` tak tersentuh).

## API
- Milestone auto-append di worker: start ("On it"), QUESTIONS, draft,
  handoff (delegated/submitted/manager-approved/manager-rejected).
- `PATCH /api/tasks/:id {action:'reply', text, version}` — append reply,
  bila task di `review`/`manager-review` + text non-kosong = perlakukan
  sebagai `revise` (kembali antre + feedback = text). Satu endpoint,
  tanpa state baru.

## UI — drawer/kanban (konsumsi Spec 4)
Thread render kronologis di detail task: badge kind + nama + teks.
Form balas di bawah thread (textarea + kirim). Bubble 3D + Office log
tampilkan handoff ringkas (reuse SAY/log existing).

## Uji
`tests/thread.cjs` baru: milestone start/draft muncul, reply di review =
revise, reply di queued = hanya komentar, batas 100 entri, XSS
textContent-only.

## Bukan bagian spec
Ruangan (Spec 3), kanban layout (Spec 4), websocket realtime, notifikasi push.
