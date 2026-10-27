# Kantor Kita

Tampilan terbaru mengikuti referensi kantor hangat: kayu terang, lantai parket, tanaman berdaun, kursi berbantalan dan sofa sage. Avatar chibi memakai kepala oval, rambut bervolume, wajah sederhana, badan membulat serta rig animasi yang sama. Panel putih gading memakai aksen hijau tua. Referensi gambar menjadi arahan gaya, bukan jaminan kesamaan render. Catatan gaya maket/soft block di bawah adalah riwayat perkembangan.

Antarmuka utama memakai Bahasa Indonesia; nama tahap teknis dan keluaran provider/runner dapat tetap memakai Bahasa Inggris.

Maket kantor empat lantai dengan 13 anggota tim, ruang kerja terbuka, dan pengelolaan tugas lokal. Nama dan peran mengikuti daftar pengguna. Denah, furnitur, dan figur orang adalah interpretasi ilustratif, bukan pengukuran atau potret asli.

Ruangan kini memakai tekstur PBR, perabot CC0, dan level grafis Low–Ultra; garis tinta gaya maket sudah dihapus. Avatar masih figur prosedural sederhana sampai tahap 2. Animasi bekerja, ngobrol, minum, menelepon, dan rutinitas lain tetap berjalan. Tampilan ruang belum berarti kualitas karakter sudah setara GTA.

Jika perubahan grafis tidak terlihat, pastikan server dijalankan dari checkout yang berisi `public/graphics.js` dan `public/assets/manifest.json`. Pada sesi pengembangan ini versi baru berjalan di **http://127.0.0.1:8080/?graphics=ultra**; server lain di port 3000 dapat berasal dari checkout lama.

Label, pemilih tim, detail, log, dan tugas menampilkan inisial anggota. Identitas penyimpanan tetap memakai nama lengkap agar tugas serta pilihan musholla yang sudah disimpan tetap cocok.

## Menjelajahi kantor

- **01:** barber, kursi dan cermin, area tunggu, parkiran mobil dan motor dengan pintu garasi sectional yang membuka saat kendaraan masuk atau keluar.
- **02:** dapur, kompor, bak cuci, kulkas, dan dua meja makan bersama.
- **03:** ruang kerja terbuka dengan empat kelompok meja di atas karpet masing-masing. Papan ide memisahkan Leadership dan Marketing & Business, rak rendah memisahkan Engineering & Design dan Customer Service. Ada ruang rapat kaca, dua phone booth, ruang pantry & lounge berdinding kaca, musholla, lampu gantung, dan jendela.
- **04:** rooftop garden mengikuti referensi keempat: lantai kayu, lounge di bawah pergola, meja bersama dengan kursi sage, coffee bar, planter di tepi, dan lentera hangat. Meja biliar tetap tersedia. Tim memilih tempat secara acak, termasuk sofa, meja, biliar, dan coffee bar; akses tangga tetap di kiri.
- **View whole building:** keempat lantai terlihat dengan tangga dua bentang di sisi kiri yang menyambungkan tiap lantai. Klik salah satu lantai untuk masuk. Di tampilan ini keempat lantai tersusun rapat seperti gedung sungguhan: lantai 1 sampai 3 berdinding kaca, tangga ada di menara kaca di sisi kiri, dan sisi parkir lantai 1 dibiarkan terbuka untuk keluar-masuk kendaraan, dengan jalan masuk ke jalan raya. Isi lantai tetap terlihat menembus kaca; klik kaca suatu lantai untuk masuk ke lantai itu. Perpindahan antara satu lantai dan seluruh gedung memakai animasi kamera sekitar 1,4 detik: saat keluar, lantai-lantai lain meluncur masuk menyusun gedung; saat masuk, lantai lain bergeser menjauh. Animasi dilewati bila sistem meminta gerakan dikurangi, dan berhenti seketika bila layar disentuh atau diseret. Tampilan ini juga menampilkan alas kota bundar dengan jalan, pohon, gedung-gedung lain (yang dekat dibuat rendah agar kantor tidak tertutup), awan yang bergerak pelan di kejauhan, dan burung yang terbang berputar. Saat satu lantai dipilih, yang tampil hanya lantai itu; tangga luar dan orang yang sedang di tangga hanya terlihat di tampilan seluruh gedung.

Seret untuk memutar dan memiringkan kamera. Shift + seret atau klik kanan untuk menggeser, scroll atau cubit trackpad untuk zoom, geser dua jari ke samping untuk memutar. Di layar sentuh: satu jari memutar, dua jari mencubit dan menggeser. Keyboard: panah memutar/memiringkan, W A S D menggeser, Q/E zoom. Tombol **+**, **−**, **Rotate**, dan **Reset** tetap tersedia.

### Level grafis dan aset realistis

Pengaturan → Pengaturan umum → **Level grafis** berlaku langsung tanpa muat ulang dan diingat per browser:

| Level | Isi |
|---|---|
| Low | Material polos, tanpa bayangan/pantulan, resolusi ≤ 0,75×. Untuk grafis bawaan. |
| Medium | Tekstur foto 1K (parket, plester, walnut, kain, karpet, logam, marmer) + bayangan matahari. |
| High | + pantulan dari HDRI interior, bayangan halus, tone mapping sinematik (ACES). |
| Ultra | + ambient occlusion (SAO), bloom lampu/layar, tekstur warna 2K, bayangan 4096, resolusi penuh. |

- Level awal: Low di browser otomatis atau tanpa WebGL2, High bila GPU terdeteksi, selain itu Medium. `?graphics=low|medium|high|ultra` menimpa pilihan. Level tidak diturunkan otomatis; **Tampilkan FPS** membantu memilih.
- Diukur di GTX 750 Ti, 1080p dengan model manusia, tampilan per lantai: 15 orang Low/High 60 FPS, Ultra sekitar 40 FPS; 30 orang High 60 FPS, Ultra sekitar 36 FPS. Tampilan **Lihat seluruh gedung** jauh lebih berat (semua lantai, fasad dan lingkungan terlihat): sekitar 20–28 FPS di Low dan 17–22 FPS di High. Bayangan di tampilan ini diperbarui 4 kali per detik, bukan setiap frame. GPU lain bisa berbeda.
- Perabot memakai model CC0 (Poly Haven, Kenney) yang dipasang pada tapak perabot lama, sehingga kursi, jalur jalan, dan Tata ruang tidak berubah. Bila satu model gagal dimuat, bentuk sederhana dipakai dan muncul pemberitahuan.
- Semua aset ada di `public/assets/` (±54 MiB, CC0) dengan daftar sumber dan pembuat di `public/assets/LICENSES.md`. Unduh ulang lewat `node scripts/fetch-assets.mjs` lalu `python scripts/shrink-assets.py`. Three.js 0.160 disimpan di `public/vendor/three/` (`node scripts/vendor-three.mjs`), jadi kantor tidak memakai CDN.
- Lingkungan luar (tampilan seluruh gedung): rumput dan aspal bertekstur PBR (diffuse, normal, roughness), trotoar bertingkat dengan curb, lampu jalan, halte bus, bangku, tempat sampah, hidran, kotak surat, pagar hijau berbunga dan papan nama kantor; pohon bercabang (Poly Haven), mobil dan motor detail (CC0) di parkiran lantai 1, dan motor yang bergerak selalu membawa pengendara. Gedung-gedung kota memakai fasad jendela dengan podium, kaca lobi, kanopi, atap berparapet, dan setback. Kendaraan memakai pitch dan roll mengikuti kemiringan lajur, sehingga roda menempel di ramp dan aspal, termasuk saat melintasi kaki tanjakan. Kendaraan melintas di jalan mengikuti lajur kiri dan menjaga jarak. Pengunjung barber datang naik mobil, parkir, menunggu, lalu pulang dengan mobilnya. Anggota tim yang **tidak punya tugas** (antre, berjalan, menunggu keputusan, atau review) kadang pergi naik mobil/motor (paling banyak dua orang sekaligus, hanya saat **Rutinitas** aktif); begitu ada tugas baru mereka langsung pulang lewat jalur aman, parkir, lalu kembali ke meja. Eksekusi tugas AI tidak menunggu perjalanan pulang. Bila aset lingkungan gagal dimuat, kantor tetap berjalan dengan pemberitahuan. Aset dikonversi offline oleh `scripts/prepare-environment.py`, `scripts/convert-environment-fbx.py` dan `scripts/package-environment.py`.
- Orang memakai model manusia dewasa bertekstur dan ber-rig (MakeHuman, CC0; dikonversi offline oleh `scripts/prepare-people.py`). Warna kulit, rambut, dan postur bervariasi tetapi tetap sama untuk nama yang sama; warna kemeja mengikuti divisi. Mereka berjalan, duduk di kursi dengan tangan di keyboard, dan memegang cangkir/ponsel. `?people=legacy` memakai figur sederhana lama; figur itu juga dipakai otomatis bila aset orang gagal dimuat.
- Material fade dari tangga/fasad yang dibuang dibersihkan saat organisasi berubah. Efek AO memakai setengah resolusi render dan mengikuti perubahan ukuran jendela. Kegagalan tekstur/HDRI memakai fallback dengan pemberitahuan di status scene.

**Kamera karakter:** pilih anggota tim, lalu **First-person view** (sudut orang pertama) atau **Follow from behind**. Seret atau tombol panah untuk menoleh, scroll atau cubit untuk jarak kamera belakang. Kamera ikut berpindah lantai saat karakter naik atau turun tangga. Tekan Esc, **Exit camera**, atau **Reset** untuk kembali ke tampilan maket.

Ruang rapat, kedua phone booth, musholla, serta ruang pantry & lounge (berdinding kaca) punya pintu yang terbuka sendiri saat seseorang mendekat, lalu menutup kembali.

Tim punya rutinitas sendiri di seluruh kantor: dapat turun untuk makan atau istirahat di lantai 2, mengambil jeda di area masuk lantai 1, beraktivitas di ruang kerja lantai 3, atau menikmati rooftop lantai 4. Di lantai 3 mereka dapat menghampiri rekan untuk ngobrol, ambil minum di pantry, rehat di lounge, menelepon di phone booth, membaca papan ide, rapat kecil berdua atau bertiga, atau berdiri meregangkan badan; rooftop memiliki aktivitas seperti lounge, ping-pong, billiard, chess, yoga, swing, dan coffee bar. Setiap perjalanan otomatis dimulai dari meja lalu kembali ke meja setelah durasi aktivitas selesai. Bubble bergantian menandai siapa yang bicara. Paling banyak empat orang meninggalkan meja sekaligus, dan karakter dengan tugas aktif lebih jarang beranjak. **Routine: on/off** menghentikan kegiatan baru; yang sedang berlangsung diselesaikan lalu kembali ke meja. Rutinitas mati secara bawaan bila sistem meminta gerakan dikurangi. Perintah **Lunch**, **To the rooftop**, dan **Back to work** tetap merupakan perintah manual terpisah.

**Office log** mencatat kegiatan simulasi dan perubahan status tugas, terbaru di atas. Isinya kejadian simulasi, bukan pesan dari AI. Di layar kecil log dibuka lewat tombol **Log**.

**Prayer time** mengantar anggota yang sudah dicentang **Join at prayer time** (di panel detail karakter) ke musholla. Tidak ada yang dicentang secara bawaan, dan tidak ada yang dikirim otomatis. Pilihan disimpan di browser ini. Musholla memuat delapan sajadah.

**Lunch**, **To the rooftop**, dan **Back to work** memindahkan tim melalui jalur tangga 3D yang terlihat. Kamera dan lantai yang sedang dilihat tidak berubah saat perintah aktivitas diberikan, termasuk **Prayer time**. Dari tampilan seluruh gedung, perjalanan dapat diamati tanpa pindah tampilan. Jika tujuan berubah saat di tangga, karakter mencapai bordes berikutnya sebelum menuju tujuan baru. **Pause** menghentikan perjalanan di posisi saat ini. Animasi tidak menyelesaikan tugas.

**Music** memutar instrumental santai sintetis (chord lembut, bass, dan melodi pada 72 BPM), dibuat melalui Web Audio tanpa file atau layanan audio eksternal. Klik lagi untuk menghentikannya. Slider **Vol.** menyimpan volume di browser. Musik selalu mati saat halaman baru dimuat; perlu klik pengguna untuk mulai. Jeda simulasi tidak menghentikan musik.

Jalankan dari direktori proyek:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Buka http://127.0.0.1:4173. Three.js sudah disertakan di `public/vendor/three/`; internet hanya diperlukan untuk memuat font Archivo dan IBM Plex Mono dari Google Fonts. Tanpa internet, kantor tetap berjalan dengan font sistem.

## Mengelola tugas

- Buka **Tugas** dari rail kiri, atau pilih anggota lewat **Tim** lalu buka tugasnya dari kartu profil.
- Klik **+ Tugas**, lalu isi pekerjaan, penanggung jawab, instruksi dan kriteria diterima. Pilih Dokumen atau Aplikasi serta cara kerja langsung/otomatis. Tugas masuk antrean.
- Klik **Mulai tugas**. Satu karakter hanya dapat memiliki satu tugas aktif. Karakter kembali ke mejanya di lantai 3.
- Isi hasil pekerjaan, lalu klik **Save result & finish**. Waktu simulasi tidak menyelesaikan tugas secara otomatis.
- Gunakan filter status atau penanggung jawab untuk mencari tugas. **Show character** menutup panel dan membuka lantai tempat karakter berada.
- Klik **Export tasks** untuk mengunduh salinan JSON. Impor belum tersedia.

Tugas disimpan dalam localStorage untuk alamat browser ini. Tidak ada sinkronisasi antarperangkat. Menghapus data situs juga menghapus tugas. Jika penyimpanan gagal, perubahan tidak diterapkan; data rusak tidak ditimpa secara otomatis.

Tugas dengan nama karakter prototipe lama tetap disimpan dan dapat dipindahkan ke anggota tim baru. Tugas aktif yang dipindahkan kembali ke antrean; hasil tugas selesai tetap dipertahankan.

## Autonomous organization and kanban

Rail kiri membuka ruang kerja Tugas dengan **Papan**, **Alur kerja**, dan **Console**. Papan global memiliki empat kolom: **Tugas / In progress / Review / Selesai**. Tugas yang menunggu jawaban, izin, tim, atau mengalami kegagalan tetap berada di In progress dengan alasannya. Ringkasan owner tersedia sebagai bagian yang dapat dibuka. Drawer Organisasi terpisah dibuka dari rail dan dikunci sekali per sesi dengan PIN owner. The owner can assign a large task only to a division lead; leads split it into same-division child cards, monitor progress, follow up in the card chat, and review completed child work. Parent cards enter review only after every child is done.

Cards support a 0–100 progress value and ordered follow-up messages. Messages and progress are open for collaboration; approving or revising work and changing the organization require the owner PIN session. The UI renders messages as plain text. Legacy tasks receive defaults for division, priority, progress, messages, and kind when read.

The Organization view is the owner-facing control center: it shows Owner → Division → Lead → Members, roster workload, and the lock state. Each member can have an effort profile (`light`, `standard`, or `deep`), a workload capacity from 0–100%, and member-specific operating instructions. These values are edited in the frontend after owner unlock, stored with the roster, shown in the kanban roster inventory, and appended to that member's autonomous agent instructions. They are guidance, not a substitute for server-side task and authorization rules. Browser-only mode displays the same seeded profiles locally without requiring a PIN.

The local server stores the organization in `data/org.json`. The first valid 4–6 digit PIN sets the owner PIN. If the PIN is forgotten, stop the server, remove only the `pinHash` property from `data/org.json`, restart, and set a new PIN. Unlock tokens are held in memory and expire when the server restarts. The browser-only mode stores its organization seed under `kantor-ai.org.v1` and keeps task chat/progress in `kantor-ai.tasks.v1`; no PIN is required without the server.

## Server tugas dan agen AI

Dengan server, tugas, percakapan, keputusan, event, proyek, job, dan read cursor disimpan secara transaksional di `data/workspace.json`. `tasks.json` lama dimigrasikan sekali dan file asal tetap dipertahankan. Anggota yang tersambung ke agen AI mengerjakan tugasnya sendiri. Saat ini **Social Media Specialist** dan **Customer Service**; daftarnya ada di `server/agents.js`. Anggota lain tetap simulasi dengan status yang diubah manual.

```sh
cp .env.example .env   # isi ANTHROPIC_API_KEY dari console.anthropic.com → API Keys
npm start              # atau: node server/server.js  (Node 22+)
```

Buka http://127.0.0.1:3000.

- Tugas untuk anggota yang tersambung ke agen AI berjalan sendiri: **Queued → In progress → Needs review**. Baca hasil lalu pilih **Approve & finish**, atau isi **Revision comments** dan klik **Request revision**. Revisi kembali ke antrean; draf sebelumnya tersimpan di **Draft history**. Agen tidak memposting apa pun.
- Tanpa `ANTHROPIC_API_KEY`, server berjalan dalam **dry run**: hasilnya teks contoh berlabel jelas, bukan output AI. Label nama anggota yang tersambung ke agen AI memiliki titik hijau dan panel detailnya menampilkan mode yang dipakai.
- Jika Claude gagal (koneksi, key salah, saldo habis), tugas kembali ke antrean dengan pesan error dan tombol **Try again**.
- Pada kunjungan pertama ke server yang masih kosong, tugas yang tersimpan di browser dipindahkan ke server.
- Server belum memiliki login, sehingga hanya mendengarkan di 127.0.0.1 (laptop ini). Jangan dibuka ke jaringan sebelum ada autentikasi.
- `.env` tidak masuk git. Di `data/`, hanya `data/rooms.json` yang di-track supaya tata ruang ikut antar-mesin; `settings.key`, kredensial provider, `org.json`, `team.json`, `workspace.json`/`tasks.json`, `projects/`, dan arsip tetap lokal.
- Tanpa server (misalnya `python3 -m http.server` atau Live Server), aplikasi tetap berjalan seperti sebelumnya dengan localStorage.

### Sinkronisasi antar-mesin

- `git pull` membawa kode dan `data/rooms.json`. Restart server setelah pull bila ada perubahan di `server/`.
- Perubahan ruangan dari UI langsung menulis `data/rooms.json`; commit + push agar mesin lain menerima, dan pull sebelum mengubah ruangan di mesin lain. Pada mesin yang sudah punya `data/rooms.json` lokal sebelum file ini di-track, pindahkan file itu sekali sebelum pull pertama.
- Progress tugas/chat (`data/workspace.json`), organisasi dan PIN (`data/org.json`), konfigurasi agen (`data/team.json`), proyek (`data/projects/`), serta kredensial provider tetap lokal dan tidak ikut git. `GET /api/workspace/export` adalah arsip/backup owner, bukan mekanisme impor penuh: belum ada endpoint impor workspace.

Tugas terlihat langsung di kantor:

- **Balon ucapan**: karakter berkata "On it!" saat tugasnya dimulai dan "Done!" saat selesai. Agen AI menampilkan "Drafting…" selama bekerja.
- **Task board** di lantai 3 (dulu idea board, menghadap depan) menampilkan hingga lima tugas terbuka dengan inisial dan statusnya.
- **Ringkasan** di atas Office log: jumlah orang yang sedang mengerjakan tugas, yang bebas, dan tugas selesai hari ini.

Ketiganya juga berjalan tanpa server (tugas dari localStorage).

Model bawaan adalah `claude-sonnet-5-5`; ganti dengan `ANTHROPIC_MODEL` di `.env`. Settings menyediakan pengaturan provider/model lokal untuk protokol Anthropic-compatible dan OpenAI-compatible. Credential disimpan terenkripsi di server bila `KANTOR_SETTINGS_KEY` tersedia; key tidak pernah masuk localStorage, export, response, atau task file. Server tetap hanya di `127.0.0.1` dan perubahan Settings memerlukan sesi same-origin dengan CSRF token. `tests/server.cjs` menguji alur dry run dari awal sampai akhir, tugas manual, penjaga API, persistensi, dan jalur error agen; `tests/settings.cjs` serta `tests/providers.cjs` menguji penyimpanan terenkripsi, guard Settings, discovery, dan transport provider memakai mock lokal.

## Organisasi: bagan, wizard, dan tata ruang otomatis

**Organisasi** di rail membuka bagan organisasi selebar layar:
- Setiap divisi adalah kotak berwarna. Lead ada di atas, anggota di bawahnya mengikuti garis atasan → bawahan.
- **Klik kartu** untuk membuka panel kanan dengan tab Profil, Kerja, dan AI. **Klik judul divisi** untuk mengubah nama, nama area 3D, lead, warna, dan kolaborasi.
- **Tarik kartu** ke kartu lain untuk mengganti atasan, atau ke area kosong sebuah divisi untuk memindahkannya. Bawahannya tetap di divisi lama, kecuali kamu mencentang "Pindahkan beserta timnya". Atasan yang membuat siklus ditolak.
- **Hubungkan divisi**: klik dua judul divisi untuk menambah atau menghapus jalur kolaborasi (garis ungu putus-putus).
- **Menonaktifkan** orang yang masih punya tugas terbuka akan diblokir. Panel menawarkan "Pindahkan semua ke…".
- **Review atasan:** draf staf yang melapor ke atasan di bawah pimpinan puncak melewati satu gerbang persetujuan atasan sebelum review owner; laporan langsung ke pimpinan puncak masuk review owner. Detail tugas menampilkan rantai atasan, tombol **Setujui sebagai atasan** dan **Minta perubahan**; kartu tetap berada di kolom Review, bukan kembali ke antrean. Pengelolaan anggota lokal digabungkan ke bagan/wizard Organisasi yang sama, bukan daftar tim kedua.
- **Ruang (rail PEKERJAAN):** tambah ruangan dari template, seret posisinya di denah 2D, letakkan furnitur katalog, dan tentukan **pemilik** bila ruangan itu pribadi. Kursi ruangan pribadi hanya dipakai pemiliknya saat rutinitas; pemilik mendapat tombol **Ruang pribadi** di panel detailnya, sementara orang lain tidak pernah memilih kursinya. Lantai kerja tambahan (saat divisi banyak) ikut berperabot: ruang rapat kaca, pantry, lounge, rak pemisah, dan planter, dengan kursi yang benar-benar dipakai rapat dan rehat. Ruangan fokus dan rapat kini berpagar kaca dengan pintu otomatis, kusen jendela putih, dan papan nama di atas pintu. Ruang fokus yang luas (lebar minimal 3,2 m dan dalam 4 m) otomatis ditata sebagai kantor pimpinan: meja di ujung belakang, kursi pemilik menghadap pintu, dua kursi tamu, credenza, lampu lantai, dan monitor dengan dasbor animasi.
- **Kompatibilitas data tim lama:** jika `data/org.json` belum ada tetapi `data/team.json` ada, server mengonversi daftar anggota, hubungan atasan, model, status agen AI, dan instruksi khusus ke organisasi baru. `team.json` asli tetap dipertahankan sebagai cadangan; data rusak menghentikan startup, bukan diganti diam-diam dengan contoh bawaan. Bila organisasi baru sudah ada, server tidak menimpa organisasi itu dari file tim lama.

**Wizard** muncul sendiri di instalasi baru (belum ada PIN). Wizard juga bisa dibuka dari tombol **Susun ulang**. Langkahnya:
1. PIN
2. Profil perusahaan
3. Template
4. Divisi
5. Orang
6. Agen AI
7. Ringkasan, dengan pratinjau denah per lantai

Memilih template saat susun ulang akan mengganti seluruh struktur.

**Setel ulang total** (menu ⋯):
- Membutuhkan PIN dan teks `RESET`.
- Tugas diarsipkan ke `data/archive/` dan arsipnya bisa diunduh.
- PIN dan pengaturan provider tetap.

**Kantor 3D mengikuti organisasi:**
- Satu area meja per divisi, maksimal 8 kursi per area dan 4 area per lantai kerja.
- Kalau meja kurang, lantai kerja baru ditambahkan di bawah rooftop. Lantai tambahan dihapus lagi saat organisasi mengecil.
- Papan nama area memakai "Nama area 3D", atau nama divisi kalau kosong.
- Furnitur Tata ruang yang tertimpa meja tim disembunyikan, tidak dihapus.

## Struktur

- `public/index.html`: struktur halaman, rail, drawer tugas/organisasi/pengaturan, dan kanvas 3D.
- `public/nav.js`: rail kiri, drawer, guard perubahan, dan navigasi keyboard.
- `public/office.js`: gedung 3D (lantai kerja dibangun dari organisasi), pergerakan, kamera, kustomisasi furnitur, inventaris, dan integrasi tugas.
- `public/org-model.js`: logika organisasi murni: pindah anggota, lead, layout bagan, dan rencana tempat duduk.
- `public/org-chart.js`: bagan organisasi, drag, dan panel samping.
- `public/org-wizard.js`: wizard 7 langkah dan dialog setel ulang total.
- `public/office.css`: navigasi lantai, panel anggota, dan kontrol responsif.
- `public/tasks.js`: tugas, validasi, penyimpanan, filter, dan ekspor.
- `public/tasks.css`: panel tugas responsif, fokus keyboard, dan gaya formulir.
- `public/music.js`: komposisi instrumental, kontrol putar/mati, dan volume.
- `server/server.js`: server lokal (file statis + API tugas/Settings) dan pekerja agen AI.
- `server/settings.js`: penyimpanan routing provider/model dan credential terenkripsi.
- `server/providers.js`: transport Anthropic-compatible/OpenAI-compatible, discovery, dan validasi provider.
- `server/agents.js`: anggota yang tersambung ke agen AI beserta instruksinya.
- `public/settings.js`: dialog Settings dan preferensi browser yang tidak rahasia.

## Pemeriksaan browser

`tests/nav.cjs` memeriksa rail, drawer non-modal, PIN sesi, Team popover, toolbar Momen, log lipat, floor counts, dan layout 375/768/1440px. `tests/avatar-stairs.cjs` memeriksa varian avatar, inisial, kompatibilitas tugas, posisi 3D saat naik/turun tangga, jeda, perubahan tujuan, kamera yang tetap, musik, volume tersimpan, serta layout 375/768/1440px. `tests/autonomous-floors.cjs` memeriksa bahwa routine otomatis dapat mengirim pegawai ke aktivitas lintas lantai tanpa mengubah kamera. Jalankan dengan `node tests/avatar-stairs.cjs`; konfigurasi Playwright sama seperti tes di bawah. `OFFICE_URL` dapat digunakan untuk alamat server selain port 4173.

`tests/office.cjs` menguji jumlah tim, pergantian lantai, klik lantai dari tampilan gedung, kamera karakter (mata, belakang, ikut ke lantai lain, Esc), pintu otomatis, orbit/geser/zoom kamera, rutinitas otomatis (meninggalkan meja, ngobrol, batas empat orang), log kantor, musholla dengan pilihan per orang, pilihan karakter, tugas, perjalanan makan/rooftop/kembali, tampilan responsif, dan pemindahan tugas lama. Jalankan server lokal terlebih dahulu, kemudian `node tests/office.cjs` dengan Playwright dan Chromium tersedia. Jika Playwright terpasang di luar proyek, set `PLAYWRIGHT_MODULE` ke direktori modul tersebut. Tambahkan `--visual` untuk hanya memeriksa lantai dan mengambil tangkapan layar. Browser pengujian memakai konteks terpisah dari data pengguna.

`tests/customize.cjs` menguji mode Kustomisasi Kantor: furnitur terdaftar (6 jenis + meja biliar + papan tugas), pilih lewat klik pointer, sembunyikan putaran untuk benda simetris, pindah + putar 90° + input angka + batal, tolak tumpukan, ganti nama slot + tersimpan setelah reload, kembali ke Default, dan panel 375px. `tests/inventory.cjs` menguji stok global, tambah/kurangi stok, preview lalu Apply/Cancel, kursi ekstra yang dapat dipakai, papan tugas yang dapat digeser, persistensi item tambahan, dan pengembalian dengan konfirmasi. `tests/autonomous-floors.cjs` menguji pemilihan routine otomatis lintas lantai. Jalankan dengan server lokal dan `PLAYWRIGHT_MODULE` yang sama. Tes browser menerima `OFFICE_URL` untuk port selain 4173.

## Member and division instructions

Select an avatar or initials in **Team member**. The detail sheet shows **Active task**, its instructions, and **View / assign tasks**. A brick-red underline marks an avatar with an active task; its accessible label and tooltip include the task title. The task remains visible while the character travels or takes a break. Completing it or returning it to the queue removes the marker.

Under **Send instructions to**, choose the selected person, their division, or **Choose people…** for a custom group. **Meet together**, **Lunch**, **Rooftop**, and **Back to work** apply only to that selection and preserve the current camera. The footer still commands the whole team. Meeting places are reserved before anyone moves; an invitation that exceeds the available six seats is rejected without moving a partial group. Explicit meetings last until participants receive another command, such as **Back to work**. Tasks remain manually managed.

`tests/member-commands.cjs` covers selection scope, room capacity, empty selection, meeting arrival, camera preservation, active-task display and responsive detail panels. Use the same Playwright setup as the other tests.

## Soft-block avatars

Heads, torsos, limbs, hair and shoes now use rounded block geometry shared between characters. Joint poses blend over time instead of snapping between walking, sitting and activities. Small weight shifts, breathing, alternating typing/mouse poses and head turns vary by person. Characters slow down near their final destination. Barber characters share the rounded shapes and pose blending. Gender assignments, initials and task identities are unchanged.

`tests/soft-avatar.cjs` exercises character cameras, stairs, pause and arrival at lunch, with screenshots of the new figures. `tests/member-commands.cjs` remains the regression check for instructions and active tasks.

## Evening building overview

**View whole building** now uses a closer camera, navy panels, warm floor lights and a muted dusk sky. Individual floors keep the warm daylight interior. Navigation thumbnails are captured from the actual 3D floors at startup. Counts show team members currently on each floor, excluding people on the stairs and barber visitors; they are not online-presence indicators. Mobile navigation uses compact floor labels and counts instead of thumbnails. No analytics or account controls are implied.

**Suasana** di kontrol bawah memilih **Pagi, Siang, Sore, atau Malam**. Setiap suasana mengubah posisi/warna matahari dan bayangan, langit serta kabut, intensitas cahaya ruangan, lampu jalan, jendela gedung kota, dan bintang/bulan; peralihan berlangsung halus sekitar 1,4 detik. **Siang** adalah bawaan dan mempertahankan tampilan lama. Pilihan disimpan di browser dan ikut menentukan langit tampilan gedung maupun lantai. Monitor di meja kerja, termasuk meja lead, memakai tiga kanvas animasi bersama (editor, dokumen, dan grafik) sehingga layar tetap hidup selama simulasi berjalan.

Tes organisasi:
- `tests/org-model.cjs`: logika murni (pindah anggota, siklus, lead, layout bagan, rencana tempat duduk).
- `tests/org-fields.cjs`: `areaName`/`color`, penolakan anggota sibuk, dan endpoint `POST /api/tasks/reassign`.
- `tests/org-chart.cjs`: bagan, drag, panel, kolaborasi, konflik versi, dan sheet mobile.
- `tests/org-wizard.cjs`: wizard pertama kali, susun ulang, dan dialog reset dengan arsip.
- `tests/org-autolayout.cjs`: lantai kerja otomatis, rooftop tetap di atas, tanda area, dan furnitur yang tertimpa meja.
- `tests/rooms-nav.cjs`: rebuild ruangan berbasis diff, sel tabrakan lama dibersihkan setelah ruangan dihapus atau dipindah, dan penghuni ruangan lain tidak kehilangan kursinya saat muncul ruangan baru.
- `tests/task-retry.cjs`: respons `POST /api/tasks` yang hilang dilaporkan sekali dan tidak diulang menjadi tugas ganda.

Tes 3D lama memakai `OFFICE_URL` untuk mengganti port 4173, misalnya `OFFICE_URL=http://127.0.0.1:8080 node tests/office.cjs`.

`tests/building-view.cjs` checks thumbnail loading, counts, clicking a floor through the facade, theme switching and 375/768/1440px layouts.

## Pembaruan review dan keandalan tugas

Hasil manual dan komentar revisi disimpan sementara di sessionStorage tab browser, sehingga pembaruan daftar serta reload tidak menghapus tulisan yang belum dikirim. Komentar revisi terikat ke versi draf. Persetujuan memakai versi tugas agar tampilan lama tidak menyetujui draf yang sudah berubah.

Worker memakai identitas eksekusi: hasil atau error terlambat tidak mengubah tugas yang sudah dialihkan. API memvalidasi penanggung jawab dan batas satu tugas aktif per orang. Jalankan ulang server setelah memperbarui kode backend.

`tests/server.cjs` memeriksa siklus draf, revisi, persetujuan, dan pemulihan tulisan setelah polling/reload dengan dry-run. `tests/worker-reliability.cjs` memakai provider lokal tiruan untuk memeriksa error terlambat setelah pengalihan tugas. Pengujian ini tidak memanggil AI berbayar.

## Komunikasi, aplikasi, dan bukti pengujian

- **Komunikasi** memiliki satu thread per tugas, filter unread/keputusan, gelembung owner/agen/sistem, serta kartu keputusan. Membaca pesan tidak menyelesaikan keputusan. Jawaban dikirim melalui **Kirim & lanjutkan**; Ctrl+Enter juga tersedia. Draf jawaban disimpan per thread di tab ini.
- Toast persisten menyebut agen dan tugas yang menunggu jawaban. Klik membuka keputusan yang tepat. Izin notifikasi browser hanya diminta setelah klik owner; penolakan tidak mematikan notifikasi dalam aplikasi.
- Pilih **Otomatis** agar lead merencanakan dan mendelegasikan lewat jalur organisasi yang sah. **Langsung** mempertahankan pekerjaan manual/agen individual. Graf hanya menggambar event yang benar-benar terjadi, bukan seluruh jalur organisasi yang mungkin.
- Console memuat event bertimestamp dan run id. Jeda membekukan tampilan, bukan penerimaan event; ekspor mengunduh log teks yang disanitasi. Ini bukan chain-of-thought model.
- Tugas **Aplikasi** menghasilkan revisi sumber immutable. Owner memeriksa sumber dan perintah, lalu menyetujui pengujian untuk hash revisi tersebut. Perubahan sumber/perintah memerlukan persetujuan baru. Tidak ada pemasangan dependensi otomatis.
- **Windows lokal bukan sandbox**: kode memakai akses akun Windows; akses jaringan mengikuti OS. Kotak pengakuan risiko wajib dicentang. Proses menggunakan argv tanpa shell, env minimum, folder job khusus, timeout dan penghentian process tree.
- **Docker** memakai image lokal `KANTOR_RUNNER_IMAGE` (default `node:22-alpine`), digest dicatat dalam approval. Server tidak menarik image atau menyalakan daemon. Container non-root, root/source read-only, tanpa privileged/socket, CPU/memori/PID dibatasi, jaringan mati secara default. Docker tidak tersedia tidak pernah beralih diam-diam ke Windows.
- Tes benar-benar dijalankan. Review memerlukan exit code sukses, kasus TAP non-skipped yang sesuai kriteria, hash revisi yang sama, dan smoke HTTP. Kegagalan dapat memicu maksimal dua revisi perbaikan, masing-masing menunggu persetujuan baru. Restart menandai pekerjaan aplikasi aktif **interrupted**, tidak menjalankannya ulang otomatis.
- Preview static web berada di port loopback terpisah dan iframe `sandbox="allow-scripts"`, tanpa same-origin. Sumber diunduh per file sebagai attachment; ZIP belum tersedia.
- **Batas saat ini:** bundle mendukung static JavaScript web dan deklarasi Node web, tetapi smoke/preview Node service belum tersedia sehingga tidak dapat melewati gate Review. Pemeriksaan kriteria TAP bukan pembuktian aplikasi bebas bug; periksa sumber, hasil dan keterbatasan. Runner Docker me-mount sumber read-only, sehingga build yang menulis ke sumber perlu diarahkan ke `/tmp/out`.
- Reset menolak tugas/job aktif dan membuat arsip task lama plus arsip workspace (pesan, keputusan, event dan referensi evidence). `GET /api/workspace/export` membutuhkan unlock owner dan tidak menyertakan approval/request cache atau credential Settings.

## Konteks agen dan percakapan

- Setiap agen memiliki **Memori agen** di Organisasi → pilih orang → tab AI. Maksimal 20 catatan pendek; catatan otomatis dibuat hanya setelah owner menyetujui hasil. Catatan berisi ringkasan tugas dan jawaban owner yang relevan, bukan seluruh draf. Owner dapat menyimpan catatan sendiri atau menghapus semuanya. Memori dikirim pada panggilan model berikutnya; tidak dibagikan antaragen.
- Pada tugas otomatis, pertanyaan anggota ditanyakan ke lead terlebih dahulu. Jawaban lead terlihat di thread anggota. Lead meneruskan ke owner jika tidak punya informasi atau keputusan menyangkut anggaran, scope, atau keputusan bisnis akhir. Owner hanya mendapat notifikasi ketika keputusan ditujukan kepadanya.
- Delegasi berjenjang: Direktur membagi tugas ke lead divisi; lead yang punya staf AI otomatis membagi lagi ke stafnya (maks kedalaman 3). Setiap hasil direview oleh orang yang mendelegasikannya: **disetujui**, atau **sekali revisi** dengan catatan konkret di thread. Setelah semua subtugas selesai, lead menggabungkan hasil timnya untuk atasannya; hanya tugas utama yang sampai ke owner. Subtugas yang gagal dilaporkan di thread lead.
- **Maks token per jawaban** (Pengaturan → Model dan routing) default kosong = tanpa batas. Bila model reasoning hanya "berpikir" tanpa menulis jawaban, sistem meminta jawaban langsung sekali lagi, lalu memakai model cadangan bila ada.
- Bila **model cadangan** sudah dipilih di Pengaturan, kegagalan model utama dicoba sekali dengan model cadangan. Pergantian langsung diumumkan di thread, bukan menunggu model cadangan selesai. Tanpa cadangan, tugas gagal dan menunggu retry eksplisit.
- Jawaban biasa pada provider OpenAI-compatible ditampilkan bertahap sebagai **sedang menulis…**. Teks sementara disimpan hanya di memori server, lalu diganti pesan final. JSON rencana/bundle aplikasi tidak ditampilkan mentah. Provider yang tidak mendukung streaming menggunakan respons biasa; format JSON/SSE campuran 9Router tetap diterima. Anthropic-compatible saat ini memakai respons biasa.
- Teks streaming adalah draf yang belum selesai, bukan bukti pekerjaan atau hasil pengujian. Tidak ada proses berpikir tersembunyi yang ditampilkan.

## Operasional: backup, pemulihan, dan kesehatan

- `npm run backup` menyalin seluruh `data/` (workspace, org, rooms, settings, kredensial, `settings.key`, proyek) ke `data/backups/<waktu>/` dengan `manifest.json` berisi SHA-256 tiap file. Simpan folder itu dan **jangan bagikan** `settings.key`; tanpa kunci tersebut kredensial provider tidak bisa dibuka.
- `npm run doctor` memeriksa semua file state, `settings.key`, folder proyek, dan manifest backup tanpa menjalankan server. Ini jalur pertama saat ada file rusak.
- `npm run restore -- --backup data/backups/<waktu> --yes` memverifikasi semua checksum sebelum menimpa apa pun, lalu membuat snapshot `pre-restore-*` otomatis. File di `data/` yang tidak ada di backup dibiarkan; source proyek hanya kembali lewat restore ini karena export workspace tidak memuat file proyek.
- Saat boot, file JSON yang rusak diarsipkan sebagai `<nama>.corrupt-<waktu>`. Workspace/org/rooms/settings/credentials mencoba snapshot `data/last-good` terbaru; bila tidak ada, server tetap hidup dalam mode terdegradasi dan melaporkannya lewat `/api/health` (`recovery`) serta `/api/workspace/info`. Org/rooms tidak di-seed ulang diam-diam.
- `GET /api/health` dan `GET /api/ready` bebas token untuk supervisor/`start.bat`. Health memuat uptime, hitungan status tugas, antrean model, job berjalan, jumlah tulisan workspace, dan file yang dipulihkan; tidak ada secret di dalamnya.
- `data/.lock` mencegah dua server memakai folder data yang sama. SIGINT/SIGTERM menutup SSE, preview, dan job lalu menandai job berjalan `interrupted`; lock basi dari proses yang mati dideteksi lewat PID.
- Retensi proyek: 20 revisi terbaru per proyek dan output job maksimal 30 hari (`KANTOR_KEEP_REVISIONS`, `KANTOR_JOB_MAX_AGE_DAYS`). Reset mengarsipkan `data/projects` bersama workspace, bukan hanya menghapus catatannya.
- Export workspace tetap tersedia untuk memindahkan tugas/pesan/keputusan; import owner-only (`POST /api/workspace/import`, `replace:true`) mengarsipkan workspace lama lebih dulu dan menolak saat ada tugas/job berjalan.

## CI dan pemeriksaan statis

- `npm run check` menjalankan `node --check` pada seluruh file JS/CJS/MJS first-party (vendor, browser ESM `three-global.js`, dan folder data dilewati). Ini gerbang sintaks tanpa dependensi tambahan; ESLint/typecheck penuh belum dipasang.
- `.github/workflows/ci.yml` menjalankan `npm ci`, `npm run check`, dan `npm run test:unit` di Linux + Windows, lalu smoke UI Windows (`npm run test:smoke`) dengan Playwright Chromium. Log suite diunggah sebagai artifact saat gagal.
- `npm run test:smoke` menjalankan subset UI cepat (navigasi, layout mobile, sinkron rutinitas/org, task board, messenger, settings) dan menerima daftar file: `node tests/run-suite.cjs ui nav,rooms-nav`.

## Pengujian

```sh
npm test                 # seluruh file secara berurutan, log per file di .superpowers/suite-logs
npm run test:unit
npm run test:ui
npm run test:smoke        # subset UI untuk CI
npm run check             # node --check semua file first-party
npm run test:docker       # fake CLI; live test menulis SKIP kecuali opt-in berikut
RUN_DOCKER_TESTS=1 npm run test:docker
```

Pada PowerShell gunakan `$env:RUN_DOCKER_TESTS='1'; npm run test:docker`. `npm run test:unit` menjalankan tes Node murni dan tidak memerlukan Playwright; `npm run test:ui` menjalankan seluruh tes browser dan memerlukan `npm install` sekali di checkout ini (atau `PLAYWRIGHT_MODULE` yang menunjuk instalasi lain). Runner mendeteksi tes browser dari `require('./browser.cjs')`, memberi setiap file `TEST_PORT` dari port kosong, membunuh seluruh process tree saat timeout, dan memakai `TEST_TIMEOUT_MS` (default 900000). Suite memakai DATA_DIR temporer dan provider mock lokal, tidak memakai task live atau menghabiskan token provider. Exit code gagal tidak disembunyikan; tes Windows lokal dilewati di host selain Windows.

File browser memakai `tests/browser.cjs`, yang menyalakan Chromium dengan ANGLE diarahkan ke GPU asli (`--use-angle=d3d11` di Windows, `metal` di macOS, `gl` di Linux). Tanpa itu `chrome-headless-shell` tidak punya GPU dan WebGL jatuh ke rasterizer perangkat lunak SwiftShader: seluruh core CPU terpakai, tiap browser memakan ~450 MB, dan adegan kantor hanya berjalan beberapa frame per detik. Kalau tidak ada GPU yang bisa dipakai, Chrome otomatis kembali ke SwiftShader, jadi flag ini tidak pernah menggagalkan tes.
