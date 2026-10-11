# Mini Task Manager

Task board sederhana untuk tim internal. Task bergerak berurutan melalui **To Do → Pending → In Progress → Done**. Setiap perubahan tercatat bersama actor dan waktu kejadian.

## Cara Menjalankan Aplikasi (Lokal)

Prasyarat: Node.js 20+, npm, dan PostgreSQL (misalnya Neon).

1. Salin file contoh environment:

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

   Isi `backend/.env` dengan koneksi PostgreSQL/Neon:

   ```env
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   PORT=3001
   ```

   Isi `frontend/.env` dengan URL backend tanpa slash di akhir:

   ```env
   VITE_API_URL=http://localhost:3001
   VITE_PORT=5173
   ```

   `VITE_API_URL` dan `VITE_PORT` dibaca oleh Vite saat startup/build. `DATABASE_URL` dan `PORT` dibaca oleh Express.

2. Pasang dependency dan siapkan tabel:

   ```bash
   npm install
   npm run db:migrate -w backend
   ```

3. Jalankan frontend dan backend:

   ```bash
   npm run dev
   ```

Frontend berjalan pada port `VITE_PORT`, backend pada port `PORT`. Vite meneruskan `/api` ke URL pada `VITE_API_URL`. Untuk production, ganti `VITE_API_URL` dengan URL backend production. Untuk menjalankan secara terpisah, gunakan `npm run dev -w frontend` dan `npm run dev -w backend`.

Jalankan satu instance backend dan frontend saja. Jika port yang dipilih sedang dipakai proses lama, hentikan proses tersebut sebelum menjalankan `npm run dev` kembali. Script root memakai `concurrently --kill-others-on-fail`, sehingga proses lain dihentikan jika salah satu server gagal dimulai.

Pemeriksaan:

```bash
npm run typecheck
npm run build
npm test -w backend
```

Tes integrasi memakai database pada `DATABASE_URL`, membuat task uji dengan prefix `Integration test`, lalu menghapusnya secara _soft delete_. Tabel dan data lain tidak dihapus.

## Struktur proyek

```text
backend/
  src/app.ts       # route HTTP dan validasi request
  src/db.ts        # connection pool PostgreSQL
  src/migrate.ts   # menjalankan schema.sql
  schema.sql       # tabel, index, constraint, dan trigger audit
  test/             # tes integrasi API
frontend/
  src/App.tsx      # state, request API, board, modal, dan drag-and-drop
  src/style.css    # tema responsif light/dark
  vite.config.ts   # port dan proxy dari environment
```

## Arsitektur

Alur data aplikasi berjalan seperti ini:

```text
Browser React → API Express → PostgreSQL (tasks dan audit_logs)
```

- **Frontend React** menampilkan board, membuat dan mengedit task, memindahkan kartu, serta menampilkan riwayat perubahan.
- **Backend Express** menerima request, memvalidasi data, memastikan urutan status, lalu menjalankan transaksi database.
- **PostgreSQL/Neon** menyimpan task dan audit log secara permanen. Trigger database menjaga audit log agar tidak dapat diubah atau dihapus.
- **SSE presence** mengirim posisi kursor dan perubahan board secara real-time ke browser lain. Data presence hanya sementara di memory backend.

### API utama

| Method   | Endpoint                    | Kegunaan                                                                                   |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/api/actors`               | Mengambil daftar actor pada dropdown.                                                      |
| `GET`    | `/api/tasks`                | Mengambil task aktif. Tambahkan `?includeDeleted=true` untuk melihat task yang dihapus.    |
| `POST`   | `/api/tasks`                | Membuat task baru dengan judul, deskripsi opsional, dan actor. Status awal selalu `to_do`. |
| `PUT`    | `/api/tasks/:id`            | Mengubah judul dan deskripsi task.                                                         |
| `PUT`    | `/api/tasks/:id/status`     | Memindahkan task satu tahap ke status berikutnya.                                          |
| `DELETE` | `/api/tasks/:id`            | Menandai task sebagai dihapus tanpa menghapus data secara fisik.                           |
| `GET`    | `/api/tasks/:id/audit-logs` | Mengambil riwayat perubahan task secara kronologis.                                        |
| `GET`    | `/api/presence`             | Membuka koneksi SSE untuk kursor dan perubahan board real-time.                            |
| `POST`   | `/api/presence`             | Mengirim posisi kursor saat drag atau menutup sesi drag.                                   |

## Asumsi yang diambil

- Task memiliki `id`, `title`, `description`, `status`, `createdAt`, `updatedAt`, dan `deletedAt`.
- Task baru selalu dimulai dari status `to_do`.
- `pending` dianggap sebagai tahap ketika task sudah diakui, tetapi masih menunggu approval, assignment, atau persiapan.
- Actor dipilih dari tiga nama yang sudah ditentukan karena assignment tidak meminta autentikasi.
- Status hanya boleh bergerak mengikuti urutan `to_do → pending → in_progress → done`.
- Task yang dihapus masih perlu dapat dilihat riwayatnya, sehingga penghapusan dilakukan secara soft delete.
- Satu task memiliki satu audit log atau lebih, dan setiap log menyimpan actor, aksi, status sebelum/sesudah, snapshot judul/deskripsi, serta waktu kejadian.
- Audit log ditampilkan dari yang paling lama ke yang paling baru agar alur perubahan mudah diikuti.
- Pembuatan task, perubahan detail, perubahan status, dan penghapusan dianggap sebagai perubahan yang perlu dicatat.
- Permintaan update membawa actor dari pilihan UI. Karena belum ada login, actor tersebut diperlakukan sebagai identitas simulasi.
- Database yang dipakai adalah PostgreSQL yang kompatibel dengan Neon. Migrasi dijalankan dari `backend/schema.sql`.
- Frontend dan backend dijalankan sebagai proses terpisah dan berkomunikasi melalui HTTP API.
- Mode terang/gelap hanya merupakan preferensi UI dan disimpan di browser; preferensi tersebut tidak termasuk data bisnis.
- Real-time yang diperlukan hanya perubahan board dan posisi kursor saat drag, bukan kolaborasi penuh seperti editor dokumen.

## Trade-off yang dibuat

Trade-off adalah pilihan yang memberikan keuntungan tertentu, tetapi juga memiliki konsekuensi. Pilihan yang diambil dalam project ini adalah:

| Pilihan yang diambil                                        | Keuntungan                                                                     | Konsekuensi                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actor menggunakan tiga nama hardcoded                       | Implementasi cepat dan tidak perlu membuat login.                              | Actor belum membuktikan identitas pengguna sebenarnya. Production membutuhkan autentikasi.                                                                                                                   |
| Task menggunakan soft delete                                | Task dan audit log tetap bisa dilihat setelah task dihapus.                    | Data yang sudah tidak aktif tetap tersimpan dan mungkin membutuhkan pembersihan berkala.                                                                                                                     |
| Status hanya boleh maju satu tahap                          | Alur assignment selalu konsisten dan tidak dapat melompati proses.             | User tidak dapat langsung memindahkan task ke status mana pun.                                                                                                                                               |
| Update yang sama dianggap idempotent                        | Request berulang tidak membuat audit log duplikat.                             | Sistem tidak mencatat request yang sebenarnya tidak mengubah data.                                                                                                                                           |
| Presence menggunakan SSE dan memory backend                 | Real-time sederhana tanpa Redis atau layanan tambahan.                         | Data hilang saat server restart dan tidak cocok untuk banyak instance backend.                                                                                                                               |
| Menggunakan PostgreSQL/Neon                                 | Transaksi dapat menjaga perubahan task dan audit log tetap sinkron.            | Perlu mengelola koneksi database dan menjalankan migrasi.                                                                                                                                                    |
| Query SQL ditulis langsung menggunakan `pg`                 | Dependency sedikit dan query serta transaksi terlihat jelas.                   | Query harus dirawat manual; belum mendapat kemudahan ORM.                                                                                                                                                    |
| Drag-and-drop menjadi interaksi utama                       | Board terasa natural seperti aplikasi kanban.                                  | Perangkat tertentu kurang nyaman memakai drag-and-drop, sehingga tersedia tombol status sebagai fallback.                                                                                                    |
| Validasi utama dilakukan di backend                         | Backend menjadi sumber kebenaran meskipun request berasal dari client berbeda. | Feedback awal di UI tidak selengkap jika semua validasi dilakukan secara lokal.                                                                                                                              |
| Route masih sederhana dalam `app.ts`                        | Mudah dibaca dan sesuai scope take-home.                                       | Jika fitur bertambah, route, service, dan repository perlu dipisahkan.                                                                                                                                       |
| Belum ada pagination, role, rate limiting, atau retry queue | Scope tetap kecil dan fokus pada requirement utama.                            | Pagination dibutuhkan saat data sangat banyak; role dan rate limiting dibutuhkan saat user bertambah; retry queue dibutuhkan jika ada pekerjaan background atau integrasi eksternal yang perlu dicoba ulang. |

## Jawaban pertanyaan take-home-test

**Pertanyaan:** Bagaimana audit log dijaga agar tidak termodifikasi?

**Jawaban:** API hanya menyediakan operasi baca dan insert. Trigger database menolak `UPDATE`, `DELETE`, dan `TRUNCATE` pada audit log. Task memakai soft delete, dan foreign key membatasi penghapusan fisik task yang memiliki log. Perubahan status dan insert log dilakukan dalam satu transaksi; kegagalan salah satu membatalkan keduanya. Administrator database yang dapat mengubah skema atau menonaktifkan trigger tetap mempunyai kuasa penuh. Untuk produksi perlu pemisahan role database dan kontrol akses yang lebih ketat.

**Pertanyaan:** Apa risiko terbesar jika banyak user memakai aplikasi ini?

**Jawaban:** Actor dipilih dari dropdown tanpa autentikasi, sehingga atribusi belum membuktikan identitas sebenarnya. Update bersamaan dikendalikan dengan `SELECT ... FOR UPDATE`: permintaan kedua akan dinilai terhadap status terbaru. Latensi database jarak jauh dan batas koneksi juga perlu dipantau saat jumlah user naik.

**Pertanyaan:** Apa yang direfactor pertama jika sistem membesar?

**Jawaban:** Pisahkan aturan domain dan operasi database dari `app.ts` menjadi service/repository, lalu tambahkan identitas user dari autentikasi. Satu file route masih mudah diikuti untuk scope ini, tetapi pertumbuhan fitur akan membuatnya sulit dirawat.

**Pertanyaan:** Bagaimana AI digunakan?

**Jawaban:** AI membantu menyusun kerangka workspace, API, skema SQL, UI board, dokumentasi, dan tes. Solusi divalidasi dengan pemeriksaan TypeScript, build, migrasi database, serta tes integrasi terhadap Neon untuk transisi status, idempotensi, soft delete, dan sifat append-only audit log.
