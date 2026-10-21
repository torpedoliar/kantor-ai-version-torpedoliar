# Struktur Organisasi + Kanban Autonomous — Design

Tanggal: 2026-10-18
Status: draft — menunggu persetujuan owner
Sumber: brainstorming 2026-10-18 (pilihan A dikunci, menu struktur owner-only)

## 1. Intent dan why

Owner memberi satu tugas besar ke atasan divisi, terima jadi.
Atasan yang memikirkan cara kerja, memecah tugas besar menjadi kartu kecil,
membagi ke bawahannya sendiri, memantau progres, dan menjadi satu-satunya
yang boleh menyatakan selesai.

Masalah hari ini: belum ada jalur komunikasi atasan-bawahan di aplikasi.
Followup tercecer, update progres tidak jelas, atasan tidak punya daftar
bawahan yang selalu akurat saat restrukturisasi.

Sukses = owner tidak lagi membagi tugas satu per satu dan tidak menagih
lewat chat terpisah. Semua progres dan obrolan followup menempel di kartu
tugas yang sama dan bisa dipantau dari atas.

## 2. Goals, non-goals, anti-goals

Goals:
- Hirarki divisi ketat: Owner → Lead divisi → anggota tetap divisi itu.
- Tiap divisi punya kanban sendiri: Antre, Jalan, Review atasan.
- Roster per divisi tercatat seperti inventory: nama, role, sibuk/bebas, tugas aktif.
- Kartu tugas berisi progres + chat followup atasan-bawahan di tempat yang sama.
- Hanya atasan yang bisa konfirmasi selesai / minta revisi. Pekerja tidak tutup tugas sendiri.
- Menu khusus struktur organisasi, hanya pemilik yang bisa buka dan ubah.
- Perintah owner "review semua bawahanmu" wajib dijawab atasan dengan roster terbaru (dipakai saat restrukturisasi).

Non-goals (tidak dibangun sekarang):
- Chat bebas antar pekerja di luar kartu tugas.
- Auto-decompose AI oleh atasan (atasan AI yang otomatis memecah tugas).
- Notifikasi push / email / mobile app.
- Multi-owner, hak akses granular per tombol, audit log penuh.

Anti-goals (kegagalan walau teknis jalan):
- Owner harus masuk ke kartu kecil untuk kerja harian jalan.
- Pekerja bisa menutup tugas sendiri tanpa review atasan.
- Roster dan kanban beda data sehingga habis restrukturisasi langsung basi.
- Atasan bisa ubah struktur organisasi.

## 3. Constraints (dari kode yang ada)

- Stack tetap: `public/tasks.js` + `public/index.html` dialog Tasks, `server/server.js` + `data/tasks.json`, tanpa login, hanya `127.0.0.1`.
- Status tugas tetap: `queued, active, blocked, review, done`. Satu tugas aktif per orang. Jangan ubah tanpa migrasi.
- `MEMBERS` 13 orang dan grup `office.js` yang ada (leadership, marketing, engineering, service) adalah titik awal, bukan struktur final. Struktur final diatur owner lewat menu.
- UI aplikasi berbahasa Inggris (aturan README). Label Indonesia di mockup brainstorming diterjemahkan saat implementasi.
- Mode browser-only (localStorage) harus tetap jalan walau tanpa server.
- Tanpa menambah dependency baru bila bisa memakai pola `fetch /api/tasks` dan dialog yang sudah ada.

## 4. Yang sudah diputuskan (jangan diubah builder tanpa tanya owner)

1. Pola A — hirarki divisi ketat. Tidak ada pool lintas divisi di v1. Pindah divisi hanya lewat menu owner.
2. Menu struktur organisasi khusus owner, dikunci SATU PIN lokal 4-6 digit untuk semua aksi istimewa (ubah struktur, approve parent, approve/revise kartu kecil sebagai sesi unlock; tidak ada PIN per-divisi di v1). PIN disimpan salted hash (scrypt) di server. Unlock = token sesi acak di memory server (bukan file/cookie), dikirim client via header `x-kantor-org`, hangus saat restart sehingga owner wajib masukkan PIN lagi. API menolak tanpa sesi unlock benar; UI menyembunyikan menu tanpa unlock. Lupa PIN: tanpa endpoint reset; layar PIN + README menampilkan petunjuk (stop server, hapus `pinHash` di `data/org.json`, restart, set PIN baru). Isi: daftar divisi + lead + anggota, tombol Kelola per divisi, tambah divisi, tambah pekerja (nama baru diizinkan, bukan hanya 13 nama awal), pindah anggota, angkat lead baru, ubah role, nonaktifkan anggota. Roster hasil menu ini adalah sumber kebenaran untuk validasi assignee (menggantikan `MEMBERS` hardcoded). Setiap simpan langsung update roster dan kanban.
3. Roster = inventory orang. Kolom wajib: nama, role, lead-bukan/tidak, status sibuk/bebas (turunan dari tugas aktif), tugas aktif saat ini. Atasan tidak edit roster; atasan hanya melapor via perintah review.
4. Kanban per SEMUA divisi termasuk leadership untuk monitoring (4 kanban: leadership, marketing, engineering, service), tiga kolom: Antre, Jalan, Review atasan. Owner = operator di luar roster (bukan Koh Arman). Koh Arman = lead leadership; Koh Wira dual-hat exception (lead Engineering + member leadership untuk tugas pimpinan), satu-satunya pengecualian single-divisi di v1. Tugas ke penerima dual-hat wajib bertanda `asLead: true|false` per-tugas; aturan lead/member (worker-skip, wajib pecah, auto-draft) berlaku per-tugas bukan per-orang. Satu tugas besar owner ke lead (wajib: judul + instruksi + prioritas; lead WAJIB bertanya balik via alur blocked/QUESTIONS bila permintaan tidak jelas, tidak boleh menebak) selalu dipecah lead menjadi kartu kecil sebelum dibagikan. Kartu kecil wajib satu divisi dengan parent-nya (via parentId). Tugas tanpa parent hanya boleh ke lead. Kartu kecil tidak bisa dibuat langsung oleh owner ke anggota. Penugasan lintas divisi mutlak tidak boleh di v1. Tugas besar ke lead dikecualikan dari auto-draft worker; hanya kartu kecil yang boleh dikerjakan AI otomatis. Parent baru boleh ke Review setelah SEMUA kartu kecilnya done (server tolak bila belum); yang approve parent adalah owner, bukan lead.
5. Isi kartu: judul, penerima, progres (persen + update teks terakhir), chat followup berurutan, tombol tulis update, tombol kirim pesan, tombol khusus atasan Setujui-tutup / Minta-revisi (wajib sesi unlock). Chat/progres TERBUKA: siapa pun yang melihat kartu boleh posting (nama pengirim = pilihan UI, tanpa verifikasi, seperti office log); hanya approve/revise/approve-parent/ubah-struktur yang digembok unlock. Tanpa deadline di v1. Cara pecah: tombol Split di kartu parent membuka N sub-form (dropdown assignee terbatas satu divisi, parentId terisi otomatis) — bukan form manual dengan parent picker.
6. Perintah review roster: owner kirim ke satu/ semua atasan → atasan cek daftarnya → kirim balik ringkasan (siapa aktif, siapa menganggur, usulan pindah/keluar) → roster tercatat. Ini jalur yang dipakai saat restrukturisasi.
7. Ringkasan owner: READ-ONLY 4 kartu divisi (hitungan Antre/Jalan/Review + daftar tugas besar + roster-review pending). Tanpa aksi di kartu kecil dari layar ini — prinsip terima-beres ditegakkan di UI.

## 5. Alur utama

- Owner atur struktur (sekali + saat restrukturisasi) → roster jadi acuan penugasan.
- Owner buat tugas besar ke lead divisi (muncul di kolom Antre kanban divisi itu).
- Lead REVIEW pembagian: pecah jadi kartu kecil, tugaskan ke bawahan, pastikan tiap kartu jelas (bertanya ke owner bila tugas besar tidak jelas).
- Lead MONITORING progres: pantau kolom Jalan, baca update progres + chat followup tiap kartu, tegur/minta update bila macet.
- Bawahan tulis update progres + balas followup di kartu yang sama.
- Bawahan kirim ke Review; lead REVIEW hasil: Setujui-tutup atau Minta-revisi. Revisi kembali ke Jalan dengan catatan.
- Owner pantau ringkasan; bila butuh, perintahkan review roster.

## 6. Yang diserahkan ke builder (builder boleh putuskan) + keputusan my-call dari builder-check

- Skema penyimpanan org (file JSON baru vs tabel baru) selama impor tugas lama tetap jalan dan mode browser-only tidak rusak.
- Detail komponen UI (tab baru vs dialog baru, nama endpoint `/api/org` dsb) selama mengikuti pola guard CSRF + same-origin yang sudah ada di `server.js`.
- Aturan tugas aktif yang dipindah divisi (ikut pindah vs kembali ke antre) — default: tugas aktif ikut orangnya, ditandai pindah divisi di log.
- Tes: tambah cakupan Playwright mengikuti pola `tests/` yang ada untuk menu org, kanban divisi, dan guard owner-only.
- [my-call] Chat/progres: tambah field baru `messages[]` (chat followup) + `progressPct` + update teks terakhir, reuse `brief/result/feedback/history` yang ada; migrasi wajib keep old tasks readable + perluas `validTask`.
- [my-call] Perintah review roster = reuse alur task dengan `kind: roster-review` ke lead, ringkasan balik tersimpan di `result`; tanpa endpoint baru.
- [my-call] Tugas lama tanpa divisi tampil di bucket Unassigned, owner tetapkan divisinya lewat menu; mode browser-only tidak rusak.
- [my-call] Mapping status→kanban: `queued`=Antre, `active`+`blocked`=Jalan (blocked dengan badge Needs decision), `review`=Review, `done`=collapsed. Relasi parent via `parentId` (tugas besar owner → kartu kecil lead).

## 7. Keputusan owner (terkunci 2026-10-18, + ronde grill 1–2)

1. Lead definitif: Marketing = Kak Rani, Engineering = Koh Wira, Service = Gilang; Leadership = Koh Arman (kanban monitoring).
2. Lintas divisi di v1: mutlak tidak boleh. Pindah divisi hanya lewat menu owner. Pengecualian tunggal: Wira dual-hat (lead Engineering + member leadership).
3. Tugas besar owner: judul + instruksi + prioritas; lead wajib bertanya bila tidak jelas (pakai alur blocked/QUESTIONS yang sudah ada). Tanpa deadline di v1.
4. Kunci: SATU PIN owner untuk semua aksi istimewa (ubah struktur, approve parent, approve/revise kartu kecil via sesi unlock). Tanpa login; tanpa PIN per-divisi.
5. Owner = operator di luar roster. Penegakan peran via struktur (tugas tanpa parent hanya ke lead; kartu kecil satu divisi dengan parent), bukan klaim identitas.
6. Worker skip tugas besar ke lead (tanpa parentId); kartu kecil tetap auto-draft normal.
7. Parent ke Review hanya bila semua anak done; approve parent = owner (sesi unlock).
8. Approve/revise kartu kecil wajib sesi unlock; server tolak tanpa unlock.
9. Roster-review yang belum dijawab memblokir pembuatan kartu kecil baru di divisi itu DI LEVEL API (POST → 409 + pesan jelas; UI ikut sembunyikan tombol).
10. Tugas ke penerima dual-hat wajib `asLead` per-tugas.
11. Unlock = token memory sekali-unlock via header `x-kantor-org`, hangus saat restart.
12. Tugas lead = tiga kewajiban: review pembagian tugas, review hasil pekerjaan, monitoring progres (lihat Alur utama).
13. Lupa PIN: reset via file (stop server, hapus `pinHash` di `data/org.json`, restart, set PIN baru); petunjuk tampil di layar PIN + README; tanpa endpoint reset.
14. Pecah tugas = tombol Split di kartu parent (N sub-form, assignee satu divisi, parentId otomatis).
15. Lead boleh ambil maks 1 kartu kecil di divisinya sendiri sebagai kontributor (AI Rani tetap kepakai); worker-skip hanya untuk tugas besar.
16. Ringkasan owner read-only (4 kartu divisi + hitungan + tugas besar + review pending), tanpa aksi kartu kecil.
17. Chat/progres terbuka untuk semua yang melihat kartu; hanya approve/revise/approve-parent/ubah-struktur yang butuh sesi unlock.

## 8. Panggilan my-call oleh builder (cek saat baca dokumen)
