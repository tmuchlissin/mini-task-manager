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

| Method | Endpoint | Kegunaan |
| --- | --- | --- |
| `GET` | `/api/actors` | Mengambil daftar actor pada dropdown. |
| `GET` | `/api/tasks` | Mengambil task aktif. Tambahkan `?includeDeleted=true` untuk melihat task yang dihapus. |
| `POST` | `/api/tasks` | Membuat task baru dengan judul, deskripsi opsional, dan actor. Status awal selalu `to_do`. |
| `PUT` | `/api/tasks/:id` | Mengubah judul dan deskripsi task. |
| `PUT` | `/api/tasks/:id/status` | Memindahkan task satu tahap ke status berikutnya. |
| `DELETE` | `/api/tasks/:id` | Menandai task sebagai dihapus tanpa menghapus data secara fisik. |
| `GET` | `/api/tasks/:id/audit-logs` | Mengambil riwayat perubahan task secara kronologis. |
| `GET` | `/api/presence` | Membuka koneksi SSE untuk kursor dan perubahan board real-time. |
| `POST` | `/api/presence` | Mengirim posisi kursor saat drag atau menutup sesi drag. |

## Asumsi dan trade-off

- Struktur task: `id`, `title`, `description`, `status`, `createdAt`, `updatedAt`, `deletedAt`. Task baru selalu berstatus `to_do`.
- Status mengikuti urutan wajib assignment: `to_do → pending → in_progress → done`. Dalam implementasi ini, `pending` berarti task sudah diakui tetapi masih menunggu approval, assignment, atau persiapan sebelum dikerjakan.
- Actor dipilih dari tiga nama tetap. Brief tidak meminta autentikasi; pengguna lain masih bisa memilih nama yang sama.
- Permintaan ke status yang sama berhasil tanpa menambah log. Perpindahan hanya satu tahap ke depan; kembali atau melompat menghasilkan `409`.
- Delete memakai soft delete agar task dan audit log tetap dapat dibaca. Pembuatan, perubahan judul/deskripsi, dan penghapusan juga dicatat.
- Kartu dapat digeser hanya ke kolom berikutnya. Tombol perpindahan status tetap tersedia pada layar kecil untuk perangkat tanpa drag-and-drop. Keduanya memakai endpoint yang sama.
- Kursor real-time memakai Server-Sent Events dan disimpan sementara dalam memori backend, bukan audit log. Kursor hilang setelah drag selesai atau sekitar 5 detik tanpa pembaruan. Ini cocok untuk satu instance Express; beberapa instance membutuhkan pub/sub bersama seperti Redis.
- PostgreSQL/Neon memungkinkan status dan log ditulis dalam satu transaksi, dengan tambahan kebutuhan koneksi database dan migrasi.

## Jawaban pertanyaan take-home

**Bagaimana audit log dijaga agar tidak termodifikasi?** API hanya menyediakan operasi baca dan insert. Trigger database menolak `UPDATE`, `DELETE`, dan `TRUNCATE` pada audit log. Task memakai soft delete, dan foreign key membatasi penghapusan fisik task yang memiliki log. Perubahan status dan insert log dilakukan dalam satu transaksi; kegagalan salah satu membatalkan keduanya. Administrator database yang dapat mengubah skema atau menonaktifkan trigger tetap mempunyai kuasa penuh. Untuk produksi perlu pemisahan role database dan kontrol akses yang lebih ketat.

**Apa risiko terbesar jika banyak user memakai aplikasi ini?** Actor dipilih dari dropdown tanpa autentikasi, sehingga atribusi belum membuktikan identitas sebenarnya. Update bersamaan dikendalikan dengan `SELECT ... FOR UPDATE`: permintaan kedua akan dinilai terhadap status terbaru. Latensi database jarak jauh dan batas koneksi juga perlu dipantau saat jumlah user naik.

**Apa yang direfactor pertama jika sistem membesar?** Pisahkan aturan domain dan operasi database dari `app.ts` menjadi service/repository, lalu tambahkan identitas user dari autentikasi. Satu file route masih mudah diikuti untuk scope ini, tetapi pertumbuhan fitur akan membuatnya sulit dirawat.

**Bagaimana AI digunakan?** AI membantu menyusun kerangka workspace, API, skema SQL, UI board, dokumentasi, dan tes. Solusi divalidasi dengan pemeriksaan TypeScript, build, migrasi database, serta tes integrasi terhadap Neon untuk transisi status, idempotensi, soft delete, dan sifat append-only audit log. Kandidat tetap perlu memahami dan mampu menjelaskan seluruh keputusan serta trade-off di atas.
