# Rework Navigasi + Organisasi Pohon + Wizard — Design

Tanggal: 2026-10-18
Status: disetujui owner (sesi grilling 2026-10-18, Q1–Q20)
Menggantikan sebagian: `2026-10-18-org-kanban-design.md` (model divisi datar, divisi ganda)

## 1. Intent

Navigasi sekarang membingungkan. Ada 13 tombol toolbar. Semua fitur ditumpuk dalam modal besar: Tasks berisi 4 tab, form, dan pengaturan organisasi sekaligus. Panel dekoratif selalu tampil.
Struktur organisasi juga kaku. Divisi dan lead tidak bisa diatur dari UI, jalur komunikasi ditulis langsung di kode, dan wizard belum pernah dibuat.

Kondisi sukses:
- Owner bisa memberi tugas, meninjau hasilnya, dan menyusun organisasinya sendiri tanpa menyentuh kode.
- Kantor 3D tetap terlihat sebagai latar yang hidup.

## 2. Fase 1 — Rework navigasi

Tugas utama: memberi tugas dan meninjau hasilnya. Kantor 3D jadi kanvas latar.

- **Rail kiri tetap** berisi ikon dan label:
  - Kantor
  - Tugas
  - Organisasi
  - Pengaturan
  - Keputusan (dengan badge jumlah tugas yang `blocked`)
  - Gembok PIN
- **Drawer.** Tugas, Organisasi, dan Pengaturan terbuka sebagai panel samping lebar. 3D tetap terlihat di sisi kanan. Hanya satu drawer yang terbuka pada satu waktu, Esc menutupnya, dan Kantor menutup semua drawer.
  - Drawer Tugas berisi Daftar, Kanban divisi, dan Ringkasan. Form "Buat tugas" ada di dalam drawer Tugas.
  - Bagian Organisasi pindah dari Tugas ke drawer Organisasi.
- **Toolbar bawah:**
  - Pause/Play
  - Routine
  - Musik + volume
  - Menu "Momen": Makan siang, Ke rooftop, Waktu salat, Kembali kerja
- **Kontrol kamera** (zoom +/−, Putar, Reset) jadi tombol kecil di pojok kanan bawah kanvas.
- **Pemilih lantai** jadi daftar ringkas vertikal: FL.01–04 + "Seluruh gedung", dengan jumlah orang di tiap lantai.
- **Kartu deskripsi lantai** (floor caption) dihapus.
- **Office log** jadi panel lipat yang default-nya terlipat. Saat terlipat, panel menampilkan ringkasan "x sedang tugas · y bebas · z selesai".
- **Tombol "Tim"** menggantikan picker inisial dan deretan avatar. Tombol ini membuka daftar orang. Klik seseorang untuk memfokuskan kamera dan membuka kartu profil (peran, divisi, tugas aktif). Panel info yang sudah ada dipakai ulang.
- **PIN owner** dibuka sekali per sesi lewat gembok di rail. Drawer Organisasi meminta unlock lewat gembok, tidak lagi lewat form di dalam tab.
- **Customize office** pindah ke rail sebagai entri "Tata ruang", lalu membuka panel customize yang sudah ada.
- **Bahasa UI:** semua teks berbahasa Indonesia, tanpa i18n.

## 3. Fase 2 — Organisasi pohon + wizard

### 3.1 Model data (`data/org.json`, schemaVersion 2)

```
company: { name, type, description }
divisions: [{ id, name, lead, collaboratesWith: [divisionId] }]
members:  [{ name, initials, role, division, manager|null, active,
             effort, workloadPct, instructions, isAgent }]
```

- `manager` diisi nama anggota aktif. Nilai `null` berarti melapor langsung ke owner.
- `lead` dipilih eksplisit. UI memberi peringatan kalau rantai atasan seorang anggota divisi tidak melewati lead divisinya.
- Siklus dalam rantai atasan ditolak oleh server.
- Migrasi dari v1:
  - `divisions[]` ganda diringkas jadi `division` utama.
  - `manager` diisi dengan lead divisi. Lead sendiri diisi `null`, kecuali lead divisi non-leadership, yang diisi lead leadership.
- Owner adalah akar implisit di atas pohon dan tidak tampil sebagai karakter.

### 3.2 Jalur komunikasi (diturunkan dari pohon)

- **Delegasi:** tugas boleh diberikan oleh atasan mana pun dalam rantai ke bawahannya. Owner boleh memberi tugas ke siapa saja yang tidak punya atasan dan ke semua lead divisi.
- **Eskalasi:** kalau agen menjawab `QUESTIONS:`, tugas menjadi `blocked` dan diarahkan ke atasan langsung pekerja. Kalau atasannya `null`, tugas masuk ke kotak Keputusan owner.
- **Kolaborasi:** lead divisi A boleh membuat tugas untuk lead divisi B kalau `B ∈ A.collaboratesWith`.
- Chat bebas antar anggota tetap menjadi non-goal.
- `validateTaskPlacement` ditulis ulang memakai aturan di atas.

### 3.3 Editor organisasi (drawer Organisasi)

- **Tampilan** berupa bagan pohon visual: kotak orang dihubungkan garis dan dikelompokkan warna per divisi.
- **Panel edit** terbuka saat satu orang diklik. Isinya:
  - nama, inisial, peran, divisi, atasan (dropdown), toggle agen AI, effort, workload, instruksi
  - model/provider, kalau orang itu agen
- **Panel divisi:** tambah, ganti nama, hapus, pilih lead, dan atur `collaboratesWith`.
- **Tab Profil perusahaan:** bisa diubah kapan saja.
- Tidak ada drag-and-drop.
- **Hapus divisi atau nonaktifkan orang** diblokir selama masih ada tugas aktif. UI menampilkan daftar tugas aktif itu dan tombol "Pindahkan semua ke…".

### 3.4 Wizard

- **Kapan muncul:**
  - otomatis saat organisasi belum ada (belum ada PIN atau belum ada `data/org.json`)
  - dari Organisasi → "Susun ulang", yang membuka wizard berisi struktur saat ini
- **Langkah:**
  1. Buat PIN owner. Langkah ini dilewati kalau PIN sudah ada; cukup unlock.
  2. Profil perusahaan: nama, jenis usaha (Marketing office / Software dev / Agensi kreatif / Toko & retail / Lainnya), deskripsi.
  3. Template divisi, disarankan dari jenis usaha. Pilihan tambahan: "Kantor Kita (contoh)" (data seed saat ini) dan "Mulai kosong".
  4. Atur divisi: nama, lead, kolaborasi.
  5. Tambah orang: nama, peran, divisi, atasan.
  6. Pilih agen AI dan model/provider-nya.
  7. Ringkasan, lalu Simpan.
- **"Set ulang total":**
  - Wajib PIN dan mengetik "RESET".
  - Tugas diekspor ke `data/archive/tasks-<timestamp>.json` sebelum dikosongkan.
  - Setelah itu organisasi dan tugas dikosongkan dan wizard terbuka.

### 3.5 Agen AI dinamis

- Toggle `isAgent` tersedia per anggota.
- System prompt disusun dari profil perusahaan, peran, divisi, atasan, bawahan, effort, workload, dan instruksi.
- `server/agents.js` yang menulis langsung KR/KS dihapus. Prompt lama mereka dipindah ke field `instructions` saat migrasi.

### 3.6 Orang baru di 3D

- Orang baru otomatis diberi meja kosong di area divisinya di lantai Workspace. Kalau meja habis, dia masuk ke hot desk dan UI memberi saran "tambah meja via Tata ruang".
- Warna karakter mengikuti divisi.

## 4. Non-goals

- Drag-and-drop di bagan
- Chat bebas antar anggota
- i18n / multi-bahasa
- Multi-owner
