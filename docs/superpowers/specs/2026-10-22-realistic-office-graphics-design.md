# Kantor 3D realistis dengan level grafis Low–Ultra

## Intent
Owner menilai kantor 3D "seluruhnya kurang nyata". Rujukan rasa: GTA V. Prioritas: **ruang kantor** (dinding, lantai, perabot, cahaya) lebih dulu, **diimbangi orang-orangnya**. Owner punya GPU dan mengizinkan aset 3D dari luar. Setelah melihat mockup interaktif (sudut kantor dengan tombol Low/Medium/High/Ultra), owner menyatakan **Ultra sudah sesuai arah**.

Sukses = membuka kantor di Ultra terasa seperti ruangan sungguhan (material foto, cahaya matahari + pantulan, bayangan halus, AO di sudut, cahaya lampu/layar berpendar), orang tampak seperti manusia (bukan boneka kotak), dan semua perilaku yang ada tetap jalan.

## Referensi visual dari owner (4 tangkapan layar GTA V / VI, disimpan di luar repo)
Yang harus terbaca dari referensi, dan menjadi standar "detail & realistis":
- **Lantai**: parket kayu pola herringbone / papan kayu terang dengan serat dan sambungan terlihat; karpet/rug bertekstur (berbulu, bermotif) di bawah area duduk.
- **Jendela**: kaca dari lantai ke plafon dengan kusen gelap tipis, pemandangan kota berkabut di luar, cahaya siang masuk dan memantul di lantai.
- **Dinding & plafon**: panel kayu aksen di belakang TV, dinding plester bersih, panel/kisi vertikal, plafon berpanel kayu atau beton dengan balok ekspos dan kolom baja (gaya loft).
- **Perabot**: sofa sectional dengan jahitan, dudukan terpisah, bantal aksen berwarna; meja kopi kaca dengan rangka logam; kabinet TV rendah, rak dinding dengan dekorasi; meja makan kaca dengan kursi; rak kayu terbuka berisi buku/patung.
- **Cahaya & lampu**: lampu gantung (pendant) kayu/logam, lampu lengkung (arc lamp), downlight plafon; cahaya hangat interior + cahaya siang dingin dari jendela.
- **Barang kecil**: remote, gelas/ember sampanye, buku, vas & tanaman tinggi, lukisan/poster berbingkai, speaker, peralatan elektronik, laptop di meja.
- **Orang**: proporsi manusia dewasa normal (bukan kepala besar), pakaian berlapis dengan lipatan (jaket, kaos, jeans, boots), variasi warna kulit, gaya rambut, kumis/janggut, kacamata; berdiri santai berkelompok, tangan di saku, menoleh saat bicara.

Kantor Kita menerapkan bahasa visual ini ke fungsinya sebagai kantor: area kerja (meja kerja, kursi ergonomis, monitor dengan isi kerja), lounge bergaya loft seperti referensi, dapur/makan, rooftop.

Batas kejujuran: karakter persis setingkat GTA V tidak realistis di browser dengan aset bebas lisensi. Target orang = model manusia proporsional dengan pakaian bertekstur dari sumber CC0 (mis. MakeHuman/MPFB2 export, Quaternius) + animasi CC0; hasilnya mendekati, bukan sama dengan GTA.

## Goals
- Pengaturan **Level grafis: Low / Medium / High / Ultra** yang bisa diganti saat aplikasi berjalan, tanpa muat ulang.
  - Low: material polos, tanpa bayangan/pantulan, pixel ratio ≤ 0.75 — untuk komputer tanpa GPU.
  - Medium: tekstur, bayangan keras 1024, tanpa pantulan.
  - High: pantulan lingkungan (HDRI), bayangan halus 2048, ACES tone mapping.
  - Ultra: semua High + SSAO/SAO + bloom untuk lampu/layar + bayangan 4096 + pixel ratio penuh (≤ 2).
  (Tabel ini mengikuti mockup yang disetujui owner: `.superpowers/brainstorm/4727-1792628107/content/graphics-levels.html`.)
- **Ruang kantor realistis**: tekstur PBR foto (kayu, lantai, plester, kain, logam, kaca) dan model perabot asli (meja, kursi kantor, monitor, sofa, tanaman, lampu) menggantikan kotak/silinder, untuk semua lantai (lobby/barber/parkir, dapur, ruang kerja, rooftop) dan fasad.
- **Orang realistis**: model manusia ber-rig dengan animasi (idle, jalan, duduk, duduk mengetik, bicara, minum, telepon, main biliar sejauh tersedia), menggantikan figur prosedural, warna baju tetap mengikuti warna divisi.
- Semua perilaku yang ada tetap: navigasi/grid jalan, tangga & antar-lantai, duduk di kursi/sofa, aktivitas, rapat, label nama, gelembung bicara, customize/inventory perabot, building view, transisi kamera, follow kamera, siang/malam lampu.

## Non-goals
- Bukan mengubah gameplay, alur tugas, Messenger, atau server.
- Bukan kota terbuka ala GTA (jalan raya/mobil detail tetap sekadar latar).
- Bukan wajah/rambut fotorealistis level film; target "game modern", bukan digital human.

## Anti-goals (gagal walau "jalan")
- Kantor jadi tidak bisa dibuka di Low pada komputer tanpa GPU.
- Perilaku agen rusak (orang menembus dinding, tidak bisa duduk, label hilang).
- Aset diambil dari CDN pihak ketiga saat runtime sehingga kantor kosong bila offline/CDN mati.
- Aset berlisensi tidak jelas.

## Constraints
- Stack tetap vanilla JS di `public/` tanpa build step.
- Three.js saat ini r128 (global `THREE` dari cdnjs). Fitur yang dibutuhkan (EffectComposer/SAO/Bloom/OutputPass, GLTFLoader + DRACO/KTX2 opsional, RoomEnvironment/HDRI) membutuhkan modul `examples/jsm`.
- Test browser yang ada (`tests/office.cjs`, `avatar-stairs`, `building-view`, `customize`, `furniture-activity`, `inventory`, `member-commands`, `soft-avatar`, `autonomous-floors`, `phase1-compliance`, dll.) memakai `window.officeScene` dan harus tetap lulus (`npm test`).
- Pilihan level per-browser disimpan di `localStorage` (kenyamanan per penonton) dengan try/catch.

## Keputusan cara (call saya, bukan persetujuan owner)
- **Upgrade Three.js ke 0.160.x**, di-*vendor* lokal ke `public/vendor/three/` (core + addon yang dipakai) dan dimuat via import map, supaya offline-aman. Konsekuensi migrasi yang harus ditangani: `outputEncoding/sRGBEncoding` → `outputColorSpace/SRGBColorSpace`, `LuminanceFormat` (dipakai `toneSteps`) dihapus, unit intensitas cahaya fisik (r155+) mengubah terang/gelap sehingga semua intensitas perlu dikalibrasi ulang.
- **Aset**: hanya **CC0**. Tekstur & HDRI dari Poly Haven (1K untuk Medium/High, 2K untuk Ultra, Low tanpa tekstur); model perabot & manusia dari Quaternius / Kenney / Poly Haven (format glTF/GLB). Semua disimpan di `public/assets/` dengan file `public/assets/LICENSES.md` (sumber, URL, lisensi per aset). Ukuran total aset target ≤ 60 MB.
- **Level default**: High pada perangkat dengan WebGL2 dan GPU diskret terdeteksi, selain itu Medium; Low bila WebGL2 tidak ada. Pemilih level ada di Pengaturan (bagian Umum) dan dipakai langsung.
- **Penurunan otomatis**: tidak ada (owner memilih level sendiri); FPS ditampilkan opsional di Pengaturan.
- Material "paper-model" (toon + garis tepi) dihapus; garis tepi tidak dipakai di level mana pun.

## Jawaban owner (putaran reviewer)
- **Kelancaran**: GPU owner beragam; "lancar" = **di atas 30 FPS**. Target: Ultra ≥ 30 FPS di GPU diskret kelas menengah pada 1080p dengan 13 orang (dan tetap ≥ 30 FPS hingga 30 orang di High); bila Ultra < 30 FPS, owner cukup turun level. Builder boleh menjalankan SAO di setengah resolusi untuk memenuhi target.
- **Tampilan orang (opsi B)**: model dasar pria & wanita **ditambah variasi** warna kulit, gaya/warna rambut, dan bentuk badan, ditetapkan deterministik per nama (orang yang sama selalu terlihat sama), sehingga tiap orang bisa dikenali tanpa membaca label. Warna baju tetap mengikuti divisi; label inisial tetap ada.

## Keputusan tambahan (call saya, dari pertanyaan reviewer)
- **Low memakai model yang sama** dengan level lain (satu jalur pembangun scene), hanya material polos tanpa tekstur, tanpa bayangan/pantulan/post-processing, pixel ratio ≤ 0.75. "Tanpa GPU" = grafis bawaan (integrated); renderer CPU murni (SwiftShader) hanya harus berfungsi, tidak harus lancar.
- **Bertahap**: Tahap 1 = upgrade Three.js + ruang kantor + level grafis (figur prosedural lama di-port ke 0.160 sementara). Tahap 2 = orang ber-rig dengan animasi & variasi. Tiap tahap harus lulus `npm test` dan bisa dipakai sendiri.
- **Aset di-commit langsung ke repo** di `public/assets/` (CC0, ≤ 60 MB, tekstur KTX2/JPG terkompresi, model GLB ter-Draco/meshopt bila membantu). Tidak ada unduhan saat setup.
- **Test** memaksa level **Low** (lewat `localStorage`/query `?graphics=low`) agar cepat dan stabil di headless; satu test tambahan memastikan pergantian level Low→Ultra→Low berjalan tanpa error halaman dan pengaturan tersimpan.

## Yang diserahkan ke builder
- Pemilihan model perabot/manusia spesifik dari sumber CC0 di atas, penataan ulang skala/pivot agar cocok dengan posisi kursi/meja dan grid navigasi yang ada.
- Pemetaan pose lama (`blendPose` sit/walk/talk/cup/phone/cue) ke klip animasi; pose tanpa klip yang cocok boleh memakai klip terdekat.
- Kalibrasi pencahayaan per lantai dan mode building view / malam.
- Strategi performa (instancing, LOD, merge geometri statis) asalkan Ultra tetap lancar di GPU owner dan Low ringan.
