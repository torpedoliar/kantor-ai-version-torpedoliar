# Editor Organisasi Flowchart + Wizard + Tata Ruang Otomatis — Design

Tanggal: 2026-10-20 · Menggantikan §3.3, §3.4 (bagian UI), dan §3.6 dari `2026-10-18-nav-org-rework-design.md`. Bagian lain spec itu (model data v2, jalur komunikasi, agen dinamis, reset) tetap berlaku.

## 1. Intent

Owner merasa pengaturan organisasi saat ini tidak enak dipakai:
- Pohonnya hanya daftar berindentasi, sehingga batas antar tim tidak terlihat.
- Form pengaturan tiap anggota berulang panjang di bawah pohon dan tidak rapi.
- Wizard tidak pernah muncul.

Owner ingin mengatur organisasi **seperti mengatur flowchart**. Ruang kantor 3D harus **otomatis mengikuti struktur organisasi**: tim duduk di area divisinya, lantai kerja bertambah sendiri kalau meja kurang, dan nama area mengikuti struktur organisasi.

Sukses berarti owner bisa:
- menyusun dan mengubah struktur di satu kanvas;
- melihat tiap tim terpisah jelas;
- selesai wizard, lalu langsung melihat kantornya tertata sesuai organisasi tanpa membuka Tata ruang.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- Kanvas bagan organisasi (opsi B yang dipilih owner): kartu orang dihubungkan garis atasan → bawahan, dengan tiap divisi dibungkus kotak berwarna.
- Drag-and-drop di kanvas untuk mengganti atasan dan memindah divisi. Ini membatalkan non-goal "drag-and-drop" di spec lama; keputusan owner 2026-10-20.
- Panel samping (kanan) untuk mengedit satu orang atau satu divisi. Form panjang per anggota dihapus.
- Wizard 7 langkah yang benar-benar muncul.
- Tata ruang lantai kerja diturunkan otomatis dari organisasi, dan lantai kerja ditambah otomatis.
- Nama area 3D per divisi bisa diubah.

**Non-goals**
- Penamaan meja per orang. Meja otomatis menampilkan nama penghuninya.
- Chat bebas antar anggota, i18n, multi-owner (tetap seperti spec lama).
- Bentuk ruangan atau dinding custom per lantai. Lantai kerja tambahan memakai cangkang yang sama dengan lantai Workspace.

**Anti-goals** (gagal walau "jalan")
- Teks tim saling bertabrakan atau batas divisi tidak terlihat di kanvas.
- Owner harus mengisi puluhan field untuk satu perubahan kecil.
- Orang baru muncul di 3D tanpa meja, atau duduk di area divisi lain, padahal sebenarnya bisa ditambah lantai.
- Wizard yang bisa dibuka tapi hasilnya tidak tercermin di kantor 3D.

## 3. Editor organisasi (drawer Organisasi)

### 3.1 Bentuk
- Drawer Organisasi melebar menjadi hampir layar penuh di desktop (sisakan rail).
- Isinya: tab **Bagan** (default) dan **Profil perusahaan**.
- Di mobile, kanvas boleh digeser satu jari dan panel samping menjadi sheet bawah.
- **Toolbar:** `+ Orang`, `+ Divisi`, `Hubungkan divisi`, `Rapikan`, zoom `− 100% +`, `Susun ulang (wizard)`, dan menu `⋯` berisi `Setel ulang total`.
- **Kanvas:** latar titik-titik, bisa digeser (drag area kosong / scroll) dan di-zoom (tombol / Ctrl+scroll).

### 3.2 Isi bagan
- **Kartu orang:** nama tebal dan peran kecil. Kartu juga membawa:
  - badge `AI` kalau `isAgent`;
  - badge `Lead` kalau dia lead divisinya;
  - tampilan redup kalau tidak aktif.
- **Kotak divisi:** garis putus-putus berwarna dengan latar tipis warna yang sama. Nama divisi ada di pojok kiri atas.
  - Lead berada di atas kotak, anggota di bawahnya mengikuti pohon atasan.
  - Warna diambil dari palet tetap secara berurutan dan disimpan per divisi (lihat §6).
- Kotak divisi tidak boleh saling tumpang tindih. Teks di dalamnya tidak boleh terpotong atau bertabrakan.
- **Divisi Leadership:** anggotanya (lead tertinggi) di puncak, di luar baris divisi lain atau sebagai kotak tersendiri di atas.
- **Garis:** abu-abu solid untuk atasan → bawahan, ungu putus-putus antar kotak divisi untuk `collaboratesWith`.
- **Rapikan:** tata letak pohon otomatis, top-down. Posisi kartu **tidak disimpan**; bagan selalu di-layout ulang dari data. Layout manual adalah non-goal.

### 3.3 Interaksi
- **Klik kartu:** buka panel orang. Kartu terpilih diberi garis coral.
- **Klik judul kotak divisi:** buka panel divisi.
- **Drag kartu ke kartu lain:**
  - Target menjadi atasan, dengan konfirmasi singkat di panel (bukan `confirm()`).
  - Kalau target ada di divisi lain, divisinya ikut pindah.
  - Server menolak siklus; UI menampilkan pesannya di kartu.
- **Drag kartu ke area kosong kotak divisi:** pindah divisi. Atasan menjadi lead divisi tujuan.
- **Hubungkan divisi:** mode di mana owner klik kotak A lalu kotak B untuk menambah/menghapus `B ∈ A.collaboratesWith`. Esc membatalkan mode.
- **Akses keyboard:** setiap aksi drag punya padanan di panel (dropdown Atasan / Divisi). Drag hanya jalan pintas.
- **Saat terkunci (tanpa PIN):** kanvas bisa dilihat tapi tidak bisa diubah. Aksi apa pun memicu alur unlock yang sudah ada.

### 3.4 Panel orang (kanan)
- **Header:** nama, `peran · divisi · Lead?`.
- **Tab Profil:** nama, inisial, peran, divisi, atasan.
- **Tab Kerja:** effort, kapasitas %, instruksi.
- **Tab AI:** toggle agen AI. Kalau aktif: model/provider dan instruksi agen.
- **Tombol:** satu `Simpan` (primer coral). `Nonaktifkan` / `Aktifkan` dan `Kirim review roster` ada di bawah sebagai tombol sekunder.
- Aturan blokir lama tetap berlaku: tidak bisa nonaktifkan selama ada tugas aktif. Daftar tugasnya ditampilkan bersama tombol "Pindahkan semua ke…".

### 3.5 Panel divisi
- **Field:** nama, nama area 3D (opsional; kosong = ikut nama divisi), lead (dropdown anggota divisi), kolaborasi (checklist divisi lain), warna.
- **Hapus divisi:** diblokir kalau masih ada anggota atau tugas aktif. Panel menawarkan "Pindahkan semua anggota ke…".

## 4. Wizard

- **Kapan muncul:**
  - otomatis saat organisasi belum dikonfigurasi (`configured === false`) begitu halaman dimuat;
  - dari toolbar `Susun ulang`, yang membuka wizard berisi struktur saat ini;
  - setelah `Setel ulang total`.
- **Bentuk:** modal/drawer langkah demi langkah dengan indikator langkah, tombol Kembali/Lanjut, dan draf yang tidak hilang saat pindah langkah.
- **Langkah:**
  1. PIN (buat atau unlock).
  2. Profil perusahaan.
  3. Template.
  4. Divisi: nama, lead, kolaborasi.
  5. Orang: nama, peran, divisi, atasan.
  6. Agen AI.
  7. Ringkasan.
- **Langkah 7 (Ringkasan):** menampilkan
  - pratinjau bagan mini;
  - **pratinjau denah**: daftar per lantai kerja → divisi → jumlah meja, misalnya "Lantai kerja 1: Leadership (2), Engineering (6) · Lantai kerja 2: Marketing (5)".
- **Simpan:** menyimpan organisasi, lalu 3D langsung menerapkan tata ruang otomatis (§5).
- **Setel ulang total:**
  - Pakai dialog sendiri: input PIN, ketik `RESET`, tombol merah.
  - Arsip tugas bisa diunduh setelah reset.
  - Tidak memakai `prompt()`.

## 5. Tata ruang otomatis (3D)

### 5.1 Bangunan
- Urutan lantai dari bawah:
  - Lobby (1)
  - Dining (2)
  - **Lantai kerja 1..N**
  - Rooftop (paling atas)
- N minimal 1. Rooftop dan tangga/fasad ikut naik saat N bertambah.
- Selector lantai dan label lantai menampilkan `Lantai kerja 1`, `Lantai kerja 2`, … (kalau N = 1 cukup `Workspace`).

### 5.2 Penempatan
- Satu lantai kerja punya maksimal **4 area divisi** (2×2, seperti sekarang). Satu area berisi satu meja tim dengan maksimal **8 kursi**.
- Divisi diproses berurutan: Leadership dulu, lalu urutan di data.
  - Isi area kosong berikutnya di lantai saat ini.
  - Kalau lantai penuh (4 area), buat lantai kerja baru.
- **Divisi dengan anggota aktif > 8** memakai 2 area berdampingan di lantai yang sama. Kalau tidak muat, area kedua di lantai berikutnya dengan label `Nama area (lanjutan)`.
- **Urutan kursi dalam area:** lead dulu, lalu anggota mengikuti urutan pohon.
- Papan nama di area = `areaName || name` divisi. Warna karpet dan kursi mengikuti warna divisi.
- Tidak ada lagi hot desk untuk kasus meja penuh, karena lantai bertambah otomatis. Hot desk hanya fallback kalau terjadi error penempatan.

### 5.3 Kapan diterapkan
- **Saat halaman dimuat:** dari organisasi di server.
- **Setelah wizard Simpan, atau perubahan organisasi** yang mengubah keanggotaan/divisi: diterapkan ulang tanpa reload halaman.
- Karakter yang pindah meja berjalan ke meja barunya (boleh teleport kalau beda lantai dan sedang tidak terlihat).
- Karakter untuk orang baru dibuat sungguhan: warna baju ikut divisi, gender default nonbinary.

### 5.4 Hubungan dengan Tata ruang (slot layout)
- **Furnitur non-meja** (sofa, tanaman, dll.) tetap bisa diatur lewat Tata ruang seperti sekarang.
- **Meja tim** dibuat dari organisasi. Posisinya tidak disimpan di slot layout. Slot lama yang menyimpan posisi kursi meja diabaikan untuk meja.

## 6. Perubahan data

Tambahan field divisi (opsional, aman untuk data lama):

```
divisions[].areaName  string, default ''  (label area 3D; kosong = name)
divisions[].color     string hex, default diambil berurutan dari palet
```

Tata ruang 3D **tidak disimpan di server**: dihitung deterministik dari organisasi di client.

## 7a. Keputusan owner (2026-10-20)

- **Isi lantai kerja tambahan:**
  - Lantai Kerja 2..N hanya berisi cangkang, tangga, 4 area meja tim, dan tanaman.
  - Papan tugas, ruang meeting, phone booth, dan pantry hanya ada di Lantai kerja 1.
- **Memindahkan orang ke divisi lain:**
  - Bawahannya tetap di divisi lama dan dipindah melapor ke atasan lama orang itu.
  - Panel menyediakan opsi "Pindahkan beserta timnya" untuk memindahkan seluruh subtree.
  - Kalau yang dipindah adalah lead, lead divisi lama digantikan bawahan langsung pertamanya, disertai peringatan.
  - Kalau divisi lama jadi kosong, divisinya tetap ada dan owner harus memilih lead sebelum Simpan diizinkan.
- **Susun ulang lewat wizard:**
  - Memilih template di wizard yang berisi struktur saat ini akan mengganti semua divisi dan orang, setelah peringatan.
  - Kalau ada orang dengan tugas aktif yang akan hilang, Simpan diblokir sampai owner menyelesaikan langkah "Pindahkan tugas ke…".
- **Tata ruang tersimpan:**
  - Furnitur dari Tata ruang mengikuti peran lantainya (rooftop tetap di rooftop).
  - Furnitur yang menabrak meja tim hasil otomatis disembunyikan, tidak dihapus.

## 7. Keputusan yang diambil builder/asisten (bisa dikoreksi owner)

- Pratinjau denah ditampilkan di Ringkasan wizard, lalu diterapkan saat Simpan. Owner menjawab "ok lanjutkan" atas pertanyaan ini; dianggap setuju dengan pratinjau.
- Kapasitas 4 area × 8 kursi per lantai kerja.
- Posisi kartu di bagan tidak disimpan; selalu di-layout otomatis.
- Meja tidak bisa dipindah manual lewat Tata ruang.
- **Leadership** = divisi yang lead-nya ber-`manager: null` dan tampil paling atas. Kalau ada lebih dari satu, ambil urutan pertama di data. Divisi ini boleh diganti nama. Organisasi tanpa Leadership (mis. "Mulai kosong") tetap jalan: semua divisi diurutkan sesuai data.
- Slot Tata ruang dikunci per **peran lantai** (`lobby`, `dining`, `work-1..N`, `roof`), bukan nomor lantai. Slot lama dengan lantai 4 dimigrasikan ke `roof`, lantai 3 ke `work-1`. Furnitur tersimpan yang menabrak area meja hasil generate disembunyikan (tidak dihapus dari slot).
- Lantai Dining dan Rooftop tidak ikut membesar. Kalau kursi makan siang atau spot rooftop habis, sisa orang tetap di meja (simulasi dibatasi kapasitas).
- Divisi yang anggotanya lebih dari 16 memakai area sebanyak yang dibutuhkan, berlanjut ke lantai berikutnya, tanpa batas keras.

## 8. Diserahkan ke builder

- Teknik render kanvas: SVG/DOM, tanpa library baru kecuali benar-benar perlu.
- Algoritme layout pohon.
- Detail animasi karakter saat pindah meja.
- Cara memisah kode `office.js` agar lantai kerja bisa dibangun N kali.
