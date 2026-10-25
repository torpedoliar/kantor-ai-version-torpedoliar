# Lingkungan Realistis dan Mobilitas Kantor

Status: rancangan untuk persetujuan, belum implementasi.

## Tujuan dan keputusan pengguna

Lingkungan sekitar Kantor Kita terasa realistis dan hidup tanpa mengganggu pekerjaan dan tampilan interior yang sudah ada. Pengguna menyetujui komposisi mockup: halaman rumput, pepohonan, jalan, trotoar, parkir, awan dan bangunan tetangga. Gedung kantor tetap menjadi fokus.

Pohon tidak boleh berupa kumpulan bola: gunakan batang dan cabang nyata dengan dedaunan bertekstur dan siluet tajuk tidak beraturan. Mobil dan motor menggunakan model berproporsi nyata dan bodi berlekuk, bukan kotak-kotak. Kendaraan bergerak mengikuti jalan.

NPC pengunjung dan anggota tim dapat masuk-keluar kantor melalui area parkir lantai bawah (disebut basement oleh pengguna) menggunakan mobil atau motor. Anggota tim hanya boleh pergi bila tidak ada pekerjaan. Pengguna mengonfirmasi bahwa tugas baru harus membuat anggota yang sedang di luar segera pulang.

## Tampilan

- Rumput dengan tekstur tanah/rumput, variasi warna dan detail dekat kamera; bukan bidang hijau polos atau ribuan mesh individual.
- Pohon bertekstur dengan cabang dan sela daun, skala bervariasi, posisi tidak menutup pintu, ramp, trotoar atau fokus kamera interior.
- Mobil dan motor dengan roda, kaca, lampu dan bentuk bodi yang jelas; aset tanpa merek atau logo nyata diutamakan.
- Aspal, marka dua arah, zebra cross, trotoar, curb, akses kendaraan, jalur pejalan kaki dan petak parkir memiliki ukuran dunia yang konsisten.
- Bangunan sekitar memakai material/fasad masuk akal dan detail yang lebih tenang daripada kantor; awan lembut dengan siluet organik, bukan bola padat.
- Bentuk gedung kantor/interior tidak diganti oleh representasi gedung mockup. Mockup hanya menyetujui komposisi lingkungan.

## Lalu lintas dan perjalanan

Lalu lintas ambien terpisah dari perjalanan pengunjung/tim. Semua kendaraan mengikuti lajur, belok dengan mulus, mengantre di akses parkir dan menjaga jarak. Gunakan aturan lajur dan reservasi titik konflik yang deterministik, bukan simulasi fisika bebas. Pilihan builder: lalu lintas kiri untuk konteks Indonesia.

Perjalanan lengkap: berjalan ke parkir -> mendekati kendaraan -> naik -> berkendara keluar -> berkeliling pada jalur kawasan -> kembali -> mengantre masuk -> parkir -> turun -> berjalan masuk kantor/meja. Kedatangan pengunjung dapat dimulai dari batas dunia di luar pandangan kamera, tetapi kendaraan/orang tidak boleh muncul atau menghilang mendadak di area yang sedang terlihat.

Kendaraan hanya masuk bila tersedia petak yang cocok ukurannya. Petak, kendaraan dan penumpang memiliki pemilik/reservasi yang jelas. Tidak boleh satu orang tergandakan sebagai pejalan kaki sekaligus pengendara, dua kendaraan mengisi satu petak, atau kendaraan menembus bangunan/pejalan kaki. Pintu masuk pejalan kaki tidak dipakai sebagai jalan kendaraan. Gunakan akses parkir lantai bawah yang disesuaikan geometri asli; jangan menambahkan lantai basement baru tanpa kebutuhan.

Pilihan builder: durasi naik/turun singkat dengan transisi pose/visibilitas di samping pintu mobil; motor menampilkan pengendara duduk dan helm. Animasi detail membuka pintu mobil bukan syarat awal.

## Prioritas pekerjaan

- Perjalanan tim hanya bagian rutinitas otomatis; nonaktifkan keberangkatan baru ketika Rutinitas nonaktif, reduced-motion aktif, atau pengguna memberi perintah eksplisit lain.
- Pemeriksaan bebas tugas harus memakai status tugas nyata, termasuk pekerjaan antre, berjalan, menunggu jawaban/review atau keadaan nonterminal lain yang masih ditugaskan kepadanya; bukan label visual work yang dipakai karakter duduk.
- Periksa lagi sebelum berangkat agar tugas yang datang saat berjalan ke kendaraan membatalkan keberangkatan.
- Tugas baru ketika mengemudi menandai perjalanan untuk pulang melalui belokan/jalur aman berikutnya; tidak U-turn mendadak, teleport, atau menghilangkan kendaraan. Setelah parkir, orang turun dan kembali ke meja.
- Eksekusi AI/server tetap berjalan segera sesuai mekanisme yang sudah ada; jangan menggantung eksekusi tugas pada lama animasi kepulangan. Status visual membedakan sedang kembali untuk tugas dari sedang duduk bekerja.
- Tidak semua anggota pergi serentak. Pilihan builder: maksimum dua anggota tim melakukan perjalanan luar kantor bersamaan, durasi jeda bervariasi dan terikat waktu simulasi.
- Perintah kembali bekerja, perpindahan/penghapusan anggota atau lantai, serta pause/resume harus mempertahankan keadaan perjalanan dan reservasi yang valid. Pergantian kamera hanya mengubah rendering; tidak membatalkan perjalanan atau melepas reservasi. Tugas/penugasan nyata tidak diubah oleh simulasi.
- Jika anggota dihapus saat berkendara, kendaraan menyelesaikan jalur aman ke luar pandangan lalu dilepas beserta reservasinya; tidak muncul kembali sebagai anggota yang sudah dihapus. Pergantian lantai mengubah tujuan berjalan pulang setelah parkir, bukan menghapus kendaraan di tengah jalan.
- Pilihan builder: kendaraan tim memakai pool bersama dengan petak khusus pengunjung, bukan satu mobil permanen per anggota. Penurunan batas kendaraan saat pergantian tier dilakukan setelah kendaraan keluar pandangan/selesai perjalanan, bukan menghilangkan kendaraan yang terlihat.
- Pengunjung memakai perilaku barber/antrian yang sudah ada: kendaraan datang/parkir sebelum kunjungan dan baru pergi setelah pengunjung kembali naik; pegawai barber tetap menjalankan pekerjaan.

## Integrasi dan batas

Tetap vanilla JS/Three.js lokal, tanpa runtime CDN. Aset CC0 dengan sumber dan lisensi di public/assets/LICENSES.md. Pemilihan dan pengunduhan file model/tekstur CC0 langsung dari sumbernya diserahkan kepada builder; larangan menjalankan skrip unduhan berarti kode executable yang berasal dari paket unduhan tidak boleh dijalankan, bukan melarang mengunduh file aset. Kualitas aset pohon/mobil/motor harus diperiksa sebelum integrasi, dan ketidaktersediaan aset sesuai kriteria dilaporkan alih-alih menggantinya diam-diam dengan gaya kotak/bola. Total aset runtime tetap <=60 MiB (sebelumnya sekitar 37.4 MiB); optimasi aset dan pemakaian ulang wajib sebelum menambah anggaran. Tidak mengubah data live, kredensial atau struktur tugas server untuk dekorasi. Tidak commit/push tanpa diminta.

Lingkungan mengikuti Low/Medium/High/Ultra: LOD, instance/shared geometry, batas kendaraan/NPC, shadow caster terbatas, tekstur lebih kecil pada tier rendah. Lajur, kepemilikan parkir dan keputusan pulang tidak boleh berubah kebenarannya ketika detail visual diturunkan. Target >30 FPS pada GTX 750 Ti 1080p dengan 30 anggota di High, diukur ulang dengan lalu lintas hidup; bukan janji kesetaraan GTA.

## Non-goals

Tidak membangun kota open-world, kendaraan yang dapat dikendarai pengguna, tabrakan fisika/ragdoll, jadwal kehadiran persisten, pencarian rute kota tak terbatas, cuaca lengkap, atau mengganti desain interior. NPC kota latar tambahan di luar pengunjung existing bukan syarat.

## Verifikasi penerimaan

- Pemeriksaan visual desktop/mobile: keseluruhan kawasan, sudut jalan, pohon/mobil dekat, akses parkir dan satu perjalanan utuh. Tidak boleh menyebut bentuk bola/kotak placeholder sebagai realistis selesai.
- Tes lajur, belok, jarak antre, petak penuh, ukuran mobil/motor, kendaraan vs pejalan kaki, serta reservasi bebas konflik.
- Tes tugas datang pada fase berjalan menuju kendaraan, berkendara keluar, berada di luar, antre masuk, parkir dan berjalan pulang; tidak ada keberangkatan baru selama tugas nonterminal, tidak ada penundaan task runner.
- Tes roster diganti/dihapus, lantai berubah, rutinitas nonaktif, pause/resume, tab tersembunyi dan delta waktu besar; tidak ada duplikat/leak/teleport.
- Aset gagal atau lambat tidak memblokir kantor; tampilkan kegagalan secara jujur dan tetap sediakan rutinitas interior yang valid. Tidak diam-diam menganggap placeholder sebagai aset realistis final.
- Suite penuh tetap hijau, budget aset terukur dan FPS/draw-call dilaporkan untuk lingkungan aktif. graphify update . sesudah perubahan kode.

## Artefak rancangan

Mockup komposisi lokal: .superpowers/brainstorm/4811-1792827295/content/realistic-neighborhood.html. Bentuk pohon dan mobil placeholder dalam mockup ditolak pengguna dan harus diganti, bukan dipoles sebagai hasil final.
