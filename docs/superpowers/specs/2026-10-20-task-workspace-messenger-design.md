# Ruang Kerja Tugas, Messenger, dan Eksekusi Aplikasi

Tanggal: 2026-10-20. Dokumen ini merangkum keputusan owner pada percakapan lanjutan rework organisasi. Tidak ada implementasi produk pada tahap penulisan rencana; tidak ada commit tanpa permintaan.

## 1. Tujuan dan masalah terverifikasi

Owner tidak mengetahui bahwa agen sedang menunggu keputusan. Tugas kalkulator nyata sudah memanggil 9Router dan menjadi `blocked`, tetapi halaman masih membawa keterangan dry-run yang usang. Pembagian kerja otomatis belum ada: lead-root `asLead:true` justru dikecualikan worker tanpa planner pengganti. Kanban hanya memuat queued/active/review; blocked dan done dapat hilang. Wizard Orang merupakan daftar input tanpa hierarki dan label yang mudah dibaca.

Hasil yang diinginkan:
- Owner bisa memberi tugas, melihat pembagian kerja dan pesan nyata antaragen, menjawab keputusan, serta menerima hasil yang disertai bukti pengujian.
- Komunikasi seperti Messenger dengan inbox, unread badge, notifikasi, dan percakapan terkait tugas.
- Task workspace selebar Organisasi dengan empat kolom Kanban, alur tugas/komunikasi dan console per agen.
- Tugas aplikasi menghasilkan file, aplikasi berjalan, build dan tes sungguhan; bukan hanya teks kode.
- Pengujian menawarkan Windows lokal atau Docker per proyek, tanpa fallback diam-diam.

## 2. Pengalaman pengguna

### 2.1 Tugas

Drawer Tugas hampir selebar viewport, tidak mempertahankan form tambah tugas besar di kiri. Toolbar: `+ Tugas`, pencarian, filter divisi/agen, tab `Kanban`, `Alur kerja`, `Console`.

Kanban memiliki tepat empat kolom:
1. **Tugas**: queued.
2. **In progress**: active dan blocked; blocked diberi alasan jelas (`Menunggu jawabanmu`, `Menunggu lingkungan`, `Menunggu subtugas`, `Eksekusi gagal`).
3. **Review**: hasil siap diperiksa, bukan hasil yang belum lolos pengujian.
4. **Selesai**: disetujui owner.

Setiap tugas/subtugas adalah kartu tersendiri, dengan label tugas induk, penanggung jawab, tahap aktual, waktu perubahan, dan tombol percakapan. Filter tidak menyembunyikan blocked/done secara implisit. Klik kartu membuka detail dengan brief, hasil, percakapan, dependensi, bukti pengujian dan aksi relevan.

Form tugas membedakan `Aplikasi` dan `Dokumen/analisis`, menawarkan `Otomatis: rencanakan dan delegasikan` atau `Kerjakan langsung`, serta menampilkan kriteria penerimaan. Bila kosong, lead mengusulkan asumsi/kriteria dan mencatatnya sebelum bekerja. Keputusan teknis rutin tidak selalu ditanyakan ke owner. Pertanyaan wajib hanya jika dampaknya substantif atau memerlukan izin.

### 2.2 Komunikasi seperti Messenger

Menu **Komunikasi** tersendiri di rail. Desktop: inbox kiri, percakapan tengah, konteks tugas kanan. Mobile: inbox dan thread bergantian dengan tombol kembali.
- Inbox menampilkan judul tugas, agen terkait, pesan terakhir, timestamp, unread badge; filter Semua/Butuh jawaban/Belum dibaca.
- Satu thread per tugas; tugas induk menampilkan tautan thread anak. Percakapan bukan chat bebas tanpa konteks.
- Pesan owner, agen, dan sistem dibedakan; teks model selalu dirender aman. Delegasi, pertanyaan dan hasil berasal dari tindakan nyata, bukan percakapan yang dibuat untuk animasi.
- Kartu keputusan memuat pertanyaan, konteks, opsi jika model menyediakannya, input jawaban, dan `Kirim & lanjutkan`. Pertanyaan adalah satu entitas tersimpan; pesan, badge, keputusan dan status tugas tidak boleh bertentangan.
- Setelah jawab, worker melanjutkan dengan jawaban dan riwayat pesan yang relevan. Balasan biasa pada tugas berjalan tidak merestart proses; ditampilkan sebagai `untuk langkah berikutnya` sampai konteks berikutnya dipakai.

Notifikasi:
- Badge Komunikasi untuk pesan unread dan penanda terpisah untuk keputusan belum selesai.
- Toast persisten untuk keputusan: `Budi menunggu jawabanmu · Program Kalkulator`; klik membuka thread dan kartu pertanyaan, bukan daftar umum.
- Bell/inbox notifikasi menyediakan item yang terlewat; read status tidak menyelesaikan keputusan.
- Notifikasi browser OS opsional dan hanya meminta izin setelah klik owner. Penolakan izin tidak merusak notifikasi dalam aplikasi.
- Tidak menggandakan toast saat reconnect/reload; tidak mengirim PIN/API key atau output rahasia ke notifikasi.

### 2.3 Alur kerja dan console

Alur kerja menampilkan hierarki task → subtasks dengan kartu agen, dependensi, status, dan edge berarah `delegasi`, `pertanyaan`, `jawaban`, `hasil`. Edge berasal dari event tersimpan. Jalur yang diizinkan organisasi tidak digambar seolah pesan telah terkirim. Klik edge membuka pesan/event, klik node membuka detail tugas. Filter satu root task agar graf tetap terbaca.

Console menampilkan event bertimestamp, task/agent/run id, provider/model yang dipakai, pemanggilan model, validasi rencana, delegasi, antrean, izin, command start/end, exit code, stdout/stderr terbatas, error, retry dan pengujian. Ada filter agen/tugas/level, pause tampilan, auto-scroll, unduh log yang disanitasi. Tidak mengklaim persentase kemajuan atau membuka proses berpikir tersembunyi. Progress = tahap + jumlah subtugas yang benar-benar selesai.

### 2.4 Wizard Orang

Ringkasan per divisi dengan jumlah orang dan lead, pencarian nama/peran, daftar ringkas (nama, peran, atasan). Klik anggota membuka editor berlabel di samping, atau sheet pada mobile. Tambah/hapus dipisahkan dari field; peran panjang tidak harus dibaca dari input sempit. Stepper dan footer tetap terlihat; hanya satu area konten yang scroll. Draf, lead dan referensi nama tetap utuh saat pindah langkah/pencarian.

## 3. Orkestrasi nyata

- Root otomatis diproses planner; tidak lagi diam selamanya karena `asLead`.
- Planner mengembalikan JSON tervalidasi: asumsi, kriteria penerimaan, subtasks, assignee, dependencies, output type. Limit awal: 12 anak per planning call, depth 3, 40 tasks per root, satu model call aktif per agen, maksimal 3 model calls global.
- Penugasan harus melalui jalur organisasi. Delegasi bertingkat dilakukan oleh lead terkait; kolaborasi lintas divisi melalui lead dan `collaboratesWith`, bukan bypass owner palsu. Anak boleh melewati divisi hanya melalui edge kolaborasi valid; kegagalan rute menjadi event/error yang dapat ditindaklanjuti.
- Semua perubahan dari satu hasil planner dikomit bersama. Retry/restart tidak menggandakan subtasks.
- Anak menunggu dependensi. Kegagalan/pertanyaan memblokir dependennya, bukan menggagalkan semua tugas diam-diam.
- Leaf selesai sebagai hasil internal siap diterima lead. Lead menyintesis hasil; persetujuan owner hanya diwajibkan pada deliverable root dan aksi sensitif, bukan klik tiap anak.
- Direct task tetap tersedia untuk pekerjaan tunggal. Root dokumen bisa masuk Review setelah sintesis; root aplikasi harus melewati runner dan quality gate.
- QUESTIONS terstruktur diutamakan, format lama tetap didukung. Eskalasi ke atasan mengikuti org; agen atasan dapat menjawab dari fakta yang tersedia, sementara keputusan owner/izin selalu masuk inbox owner. Batasi eskalasi satu kali per level untuk satu pertanyaan agar tidak looping.
- Cancel menghentikan job/child process yang dimiliki dan membatalkan hasil terlambat menggunakan runId; tidak membunuh proses lain.

## 4. Membuat dan menguji aplikasi

### 4.1 Pilihan lingkungan dan izin

Di task aplikasi owner memilih **Docker (direkomendasikan)** atau **Windows lokal**. Pilihan tersimpan per proyek dan ditampilkan di detail/console.
- Docker tidak tersedia → blocked `environment_unavailable`, tawarkan cek ulang atau perubahan lingkungan eksplisit. Tidak pernah fallback otomatis.
- Windows lokal: tampilkan bahwa kode memiliki akses sesuai akun Windows, lokasi proyek, command manifest dan izin jaringan. Owner menyetujui sebelum menjalankan kode. Folder proyek khusus bukan sandbox.
- Approval terikat hash sumber, command manifest, runtime/environment, dan root proyek. Perubahan kode/perintah membatalkan approval. Dependensi/install juga merupakan eksekusi kode; tidak dilakukan sebelum persetujuan.
- Perintah berisiko/di luar template yang didukung memerlukan keputusan baru. Model tidak mendapat shell bebas atau akses rahasia server.

### 4.2 Cakupan awal yang sengaja dibatasi

Builder memulai dengan aplikasi **JavaScript web**: static HTML/CSS/JS atau Node web service. Paket harus mendeklarasikan template runtime, file relatif, perintah build/test/start dan kriteria. Windows menjalankan Node menggunakan argv, tanpa `shell:true`; Docker memakai image runtime yang dikonfigurasi eksplisit, bukan Dockerfile atau mount arbitrer hasil model. Bahasa/runtime lain ditampilkan sebagai `Belum didukung`, tidak diberi label lulus palsu. Ekstensi runtime menjadi pekerjaan berikutnya, bukan executable generik yang tidak dibatasi.

File berada di proyek terpisah di bawah `DATA_DIR/projects/<projectId>/revisions/<revisionId>/src`. Validasi terhadap path traversal, absolute path, drive/UNC, symlink/junction, penimpaan app/server, jumlah dan ukuran file. Model tidak menentukan path host. Server tidak memberikan `.env`, credentials atau environment key ke child/container.

Docker: non-root, tanpa Docker socket, tanpa privileged, cap-drop, no-new-privileges, limit CPU/memori/PID/waktu; source mount read-only, output terpisah. Network off untuk build/test default; kebutuhan download/install dibatasi dan diberi izin terpisah, tidak diputuskan model diam-diam. Preview hanya bind 127.0.0.1. Windows: cwd khusus, env allowlist, timeout/output cap, process tree cleanup; batas akses OS tetap dinyatakan jelas.

### 4.3 Quality gate dan hasil

Tahap: plan → implementasi file → menunggu izin/lingkungan → build → tes otomatis → smoke/preview → sintesis → Review owner.
- Build/test/smoke benar-benar dijalankan. Bukti mencakup revision hash, argv, waktu, exit code, output disanitasi, dan daftar kriteria yang diperiksa.
- Fixture/model berkata `tests pass` tidak pernah dianggap bukti.
- Kriteria penerimaan ditautkan ke test cases; tidak cukup menjalankan tes kosong yang dibuat model. Template smoke dan pemeriksaan independen mencakup startup, halaman/endpoint dasar dan kriteria terstruktur.
- Loop perbaikan maksimal 2; tiap revisi yang mengubah file/perintah membutuhkan approval Windows baru. Batas waktu/token/biaya tersedia dan terlihat, tidak retry tak terbatas.
- Approval owner ditolak jika sumber/runner evidence tidak cocok, tes gagal, kosong, atau belum dijalankan. Status gagal tetap In progress dengan alasan, bukan Review.
- Review menampilkan link preview, unduh source, petunjuk menjalankan, hasil tes dan keterbatasan. Aplikasi tidak dijamin bebas bug; UI menjelaskan apa yang benar-benar diuji.
- Preview konten tak tepercaya berjalan di origin port tersendiri dan iframe sandbox tanpa same-origin dengan app; API auth/Origin menolak akses dari preview.

## 5. Data dan keandalan

Task, thread, decision, event, project, job dan read cursors memakai satu state transaction di `DATA_DIR/workspace.json` agar lifecycle tidak menghasilkan status/pesan yang terpisah. `tasks.json` dimigrasikan sekali tanpa menghapus file asal; API task lama tetap tersedia. `org.json`/settings tetap memakai store yang ada. Source/binary/log besar disimpan terpisah dengan hash/id, bukan seluruhnya di JSON state.

Event memakai id/sequence monotonic dan runId. SSE mengirim replay event setelah cursor; SSE hanyalah pemberitahuan, state durable adalah sumber kebenaran. Polling fallback dan reconciliation snapshot menutup gap. Read/unread tersimpan server untuk satu owner, PIN token tidak disimpan dalam state. Event publik tidak memuat credentials, PIN atau seluruh prompt.

Restart menandai job berjalan sebagai interrupted dan menampilkan pilihan lanjut/retry; tidak mengeksekusi ulang command atau model call tanpa deduplication. Arsip/export/reset meliputi state baru; proyek aktif memblokir reset. Data live tidak digunakan untuk tes; server tes memakai temp data dir dan provider lokal tiruan.

## 6. Batas dan keputusan builder

- No new UI framework: vanilla JS/DOM/SVG, stylesheet tokens app, Node built-ins + Playwright yang sudah ada.
- Notifikasi dalam aplikasi wajib; browser OS optional.
- Messenger bukan sarana kontak eksternal; tidak mengirim WhatsApp/email/pesan publik.
- Default rekomendasi tugas kalkulator: web JS, empat operasi, validasi input dan pembagian nol, beserta browser tests; owner dapat mengganti sebelum eksekusi.
- Root deliverable memerlukan review owner. Tidak auto publish/deploy, push git, akses kredensial, hapus file luar workspace atau menjalankan kode host sebelum izin.
- Desain baru mempertahankan PIN/CSRF/version guard, routing model 9Router OpenAI-compatible, serta user instruction tanpa commit.
