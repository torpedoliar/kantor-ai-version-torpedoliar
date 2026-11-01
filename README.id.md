# Kantor Kita

[English](README.md) · **Bahasa Indonesia**

Kantor Kita adalah kantor 3D interaktif yang berjalan di browser, didukung server tugas lokal yang kecil. Anggota tim tampil sebagai karakter di gedung empat lantai, tugas bergerak di papan kanban, dan anggota yang tersambung ke agen AI mengambil serta menyusun draf pekerjaannya sendiri, sementara owner meninjau dan menyetujui hasilnya. Aplikasi berjalan di Node.js tanpa framework dan tanpa build step. Antarmukanya sebagian besar berbahasa Indonesia.

Repositori ini adalah fork dari proyek Kantor Kita asli karya Kangkung Mozzarella, yang dikembangkan lebih lanjut oleh [@torpedoliar](https://github.com/torpedoliar) dengan model organisasi, delegasi AI berjenjang, job aplikasi, pengaturan multi-provider, dan perangkat operasional.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.160-000000?logo=threedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/tests-Playwright-2EAD33?logo=playwright&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

## Daftar isi

- [Fitur](#fitur)
- [Mulai cepat](#mulai-cepat)
- [Konfigurasi](#konfigurasi)
- [Alur kerja](#alur-kerja)
- [Data dan sinkronisasi](#data-dan-sinkronisasi)
- [Operasional](#operasional)
- [Pengujian](#pengujian)
- [Struktur proyek](#struktur-proyek)
- [Catatan keamanan](#catatan-keamanan)
- [Panduan lengkap](#panduan-lengkap)
- [Lisensi dan kredit](#lisensi-dan-kredit)

## Fitur

### Kantor 3D

- Gedung dengan barbershop dan garasi parkir di lantai 1, dapur di lantai 2, ruang kerja terbuka di lantai 3 (ruang rapat, phone booth, pantry dan lounge, musholla), serta rooftop garden di lantai 4. Lantai kerja tambahan dibuat otomatis bila organisasi punya banyak divisi.
- Tampilan seluruh gedung dengan menara tangga kaca, blok kota lengkap dengan jalan, lalu lintas, pohon, dan gedung lain, serta transisi kamera beranimasi antara tampilan gedung dan satu lantai.
- Level grafis Low sampai Ultra: tekstur foto, bayangan, pantulan HDRI, ambient occlusion, dan bloom, dipilih otomatis sesuai GPU dan bisa diganti tanpa muat ulang. Perabot dan orang memakai model CC0 (Poly Haven, Kenney, MakeHuman), dengan bentuk sederhana sebagai cadangan bila model gagal dimuat.
- Karakter berjalan, duduk di meja, mengobrol, menelepon, makan, sholat, dan memakai rooftop sesuai rutinitasnya sendiri. Pintu terbuka otomatis, dan tersedia kamera orang pertama serta kamera mengikuti dari belakang.
- Suasana sesuai waktu, monitor meja beranimasi, dan musik latar yang dibuat lewat Web Audio.
- Editor ruangan: tambah ruangan dari template, geser di denah 2D, letakkan furnitur dari katalog, dan tetapkan ruang pribadi untuk pemiliknya.

### Tugas dan organisasi

- Papan kanban dengan kolom Tugas, In progress, Review, dan Selesai, ditambah graf alur kerja dan console event.
- Bagan organisasi dengan divisi, lead, dan garis atasan. Tarik kartu untuk mengganti atasan, hubungkan divisi untuk kolaborasi, dan atur profil, tingkat usaha, kapasitas beban kerja, serta instruksi agen setiap anggota.
- Wizard setup tujuh langkah untuk instalasi baru: PIN, profil perusahaan, template, divisi, orang, agen AI, dan ringkasan dengan pratinjau denah per lantai.
- Aksi owner (menyetujui pekerjaan, mengubah organisasi, reset) membutuhkan sesi PIN owner.

### Agen AI

- Anggota yang tersambung ke agen mengerjakan tugasnya sendiri: antre, dikerjakan, lalu menunggu review. Owner menyetujui draf atau meminta revisi dengan komentar; draf sebelumnya tetap tersimpan di riwayat draf. Agen tidak pernah memublikasikan apa pun sendiri.
- Pada mode otomatis, direktur membagi tugas ke lead divisi, dan lead yang punya staf AI membaginya lagi, sampai kedalaman tiga tingkat. Setiap hasil direview oleh yang mendelegasikannya, dan hanya tugas utama yang sampai ke owner.
- Pertanyaan anggota diajukan ke lead lebih dulu; lead meneruskannya ke owner hanya untuk keputusan anggaran, cakupan, atau keputusan bisnis akhir.
- Memori per agen berisi maksimal 20 catatan pendek, yang dibuat hanya setelah owner menyetujui hasil.
- Provider Anthropic-compatible dan OpenAI-compatible, model cadangan, cooldown dan retry provider, serta draf streaming untuk provider OpenAI-compatible. Kredensial provider disimpan terenkripsi di server.
- Tanpa API key, server berjalan dalam mode dry run yang diberi label jelas.

### Job aplikasi

- Tugas "Aplikasi" menghasilkan revisi sumber yang tidak bisa diubah. Owner memeriksa sumber dan perintahnya, lalu menyetujui pengujian untuk hash revisi tersebut.
- Job berjalan di Windows lokal (dengan pengakuan risiko eksplisit, karena bukan sandbox) atau di container Docker yang dikunci ketat: non-root, sumber read-only, tanpa jaringan secara default, serta batas CPU, memori, dan PID.
- Review membutuhkan exit code sukses, kasus TAP yang cocok dan tidak dilewati, hash revisi yang sama, dan smoke check HTTP. Pratinjau web statis berjalan di iframe sandbox pada port loopback terpisah.

## Mulai cepat

### Dengan server tugas (disarankan)

Prasyarat: Node.js 22 atau lebih baru.

```sh
cp .env.example .env    # opsional: isi ANTHROPIC_API_KEY
npm start               # atau: node server/server.js
```

Buka http://127.0.0.1:3000. Di Windows, Anda bisa klik dua kali `start.bat`, yang menjalankan server lalu membuka browser setelah server siap.

### Statis, tanpa server

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Buka http://127.0.0.1:4173. Tugas kemudian disimpan di localStorage browser. Three.js sudah disertakan di `public/vendor/three/`, jadi internet hanya dibutuhkan untuk memuat Google Fonts; tanpa internet, kantor memakai font sistem.

## Konfigurasi

| Variabel | Keterangan |
|---|---|
| `ANTHROPIC_API_KEY` | Key provider. Kosong berarti mode dry run |
| `ANTHROPIC_BASE_URL` | URL dasar provider. Default `https://api.anthropic.com`; router lokal Anthropic-compatible juga bisa |
| `ANTHROPIC_MODEL` | Model cadangan bila anggota belum memilih model |
| `PORT` | Port server di 127.0.0.1 (default 3000) |
| `KANTOR_SETTINGS_KEY` | Key 32 byte (base64 atau hex) untuk kredensial Settings terenkripsi. Bila kosong, `data/settings.key` dibuat sekali; simpan cadangannya |
| `KANTOR_RUNNER_IMAGE` | Image Docker yang sudah terpasang untuk job aplikasi (default `node:22-alpine`). Server tidak pernah menarik image |
| `KANTOR_RETRY_DELAYS_MS`, `KANTOR_SYNTH_ATTEMPTS`, `KANTOR_SYNTH_RETRY_DELAYS_MS` | Perilaku retry untuk gangguan provider sementara |
| `KANTOR_DECISION_SLA_MS` | Lama keputusan menunggu sebelum satu pengingat (default 15 menit) |
| `KANTOR_KEEP_REVISIONS`, `KANTOR_JOB_MAX_AGE_DAYS` | Retensi proyek (default 20 revisi, output job 30 hari) |

Routing provider dan model juga bisa diatur dari aplikasi di menu Pengaturan.

## Alur kerja

1. Owner membuat dan menugaskan tugas, atau menugaskan tugas besar ke lead divisi.
2. Pada mode otomatis, lead merencanakan dan mendelegasikan lewat jalur organisasi; pada mode langsung, penanggung jawab mengerjakannya sendiri.
3. Agen menyusun draf hasil; untuk anggota tanpa agen, hasil diisi manual.
4. Atasan di bawah pimpinan puncak meninjau draf stafnya lebih dulu, lalu owner meninjau.
5. Pekerjaan yang disetujui masuk ke Selesai. Permintaan revisi mengembalikannya ke antrean beserta komentarnya.

Setiap tugas punya thread percakapan sendiri berisi pesan owner, agen, dan sistem, serta kartu keputusan untuk pertanyaan yang perlu dijawab.

## Data dan sinkronisasi

Dengan server, tugas, percakapan, keputusan, event, proyek, dan job disimpan secara transaksional di `data/workspace.json`. Hanya `data/rooms.json` yang di-track git, sehingga tata ruang bisa dibagikan antar komputer dengan pull dan push biasa. Organisasi dan PIN (`data/org.json`), konfigurasi agen, proyek, kredensial provider, dan `settings.key` tetap lokal.

`GET /api/workspace/export` menghasilkan arsip untuk owner, dan `POST /api/workspace/import` (khusus owner) mengganti workspace setelah mengarsipkan yang lama.

## Operasional

```sh
npm run backup                                        # salin data/ ke data/backups/<waktu>/ dengan manifest SHA-256
npm run doctor                                        # periksa semua file state tanpa menjalankan server
npm run restore -- --backup data/backups/<waktu> --yes # verifikasi checksum, buat snapshot, lalu pulihkan
```

Saat start, file JSON yang rusak diarsipkan dan snapshot `data/last-good` terbaru dipakai; bila tidak ada, server berjalan dalam mode terdegradasi dan melaporkannya. `GET /api/health` dan `GET /api/ready` terbuka untuk supervisor. `data/.lock` mencegah dua server memakai folder data yang sama.

## Pengujian

```sh
npm test               # semua file test berurutan
npm run test:unit      # test Node murni, tanpa browser
npm run test:ui        # test browser (butuh npm install sekali untuk Playwright)
npm run test:smoke     # subset UI cepat yang dipakai di CI
npm run check          # node --check pada semua JavaScript first-party
npm run test:docker    # test runner Docker; isi RUN_DOCKER_TESTS=1 untuk uji live
```

Test memakai folder data sementara dan provider mock lokal, sehingga tidak menyentuh tugas live dan tidak menghabiskan token provider. `.github/workflows/ci.yml` menjalankan pemeriksaan statis dan unit test di Linux dan Windows, lalu smoke test UI di Windows.

## Struktur proyek

```
public/
  index.html          struktur halaman, rail, drawer, kanvas 3D
  office.js           gedung 3D, pergerakan, kamera, furnitur, integrasi tugas
  graphics.js         level grafis dan pipeline render
  org-model.js        logika organisasi murni (pindah, lead, tempat duduk)
  org-chart.js        bagan organisasi dan panel samping
  org-wizard.js       wizard setup dan setel ulang total
  tasks.js            tugas, validasi, penyimpanan, ekspor
  task-workspace.js   papan, graf alur kerja, console
  messenger.js        percakapan tugas dan keputusan
  settings.js         dialog Pengaturan
  assets/             tekstur, model, HDRI CC0 (lihat assets/LICENSES.md)
  vendor/three/       Three.js yang disertakan
server/
  server.js           file statis, API tugas dan Settings, pekerja agen
  providers.js        transport Anthropic-compatible dan OpenAI-compatible
  settings.js         routing provider dan kredensial terenkripsi
  agents.js           daftar awal anggota yang tersambung ke agen
scripts/              backup, restore, doctor, check, persiapan aset
tests/                unit test dan test browser, runner suite
data/rooms.json       tata ruang bersama
```

## Catatan keamanan

- Server belum punya login, sehingga hanya mendengarkan di 127.0.0.1. Jangan buka ke jaringan sebelum ada autentikasi.
- Perubahan Pengaturan membutuhkan sesi same-origin dengan token CSRF. Kredensial tidak pernah disimpan di localStorage, ekspor, respons, atau file tugas.
- Job aplikasi di Windows lokal tidak berada dalam sandbox dan berjalan dengan hak akses akun Anda. Utamakan runner Docker.
- Jangan pernah membagikan `data/settings.key`; tanpanya kredensial provider yang tersimpan tidak bisa dibuka.

## Panduan lengkap

Panduan lengkap berbahasa Indonesia, yang membahas setiap kontrol, detail simulasi, dan file test, ada di [docs/PANDUAN.md](docs/PANDUAN.md). Catatan pengembangan dan review perubahan ada di [REVIEW.md](REVIEW.md) serta `docs/superpowers/`.

## Lisensi dan kredit

Dirilis di bawah [Lisensi MIT](LICENSE). Hak cipta © 2026 Kangkung Mozzarella, pembuat asli Kantor Kita. Pengembangan fork oleh Yohanes Octavian Rizky ([@torpedoliar](https://github.com/torpedoliar)).

Aset 3D berlisensi CC0; sumber dan pembuatnya tercantum di `public/assets/LICENSES.md`.
