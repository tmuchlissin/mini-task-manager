# Mini Task Manager

Task board sederhana untuk tim internal. Task bergerak berurutan melalui **To Do → Pending → In Progress → Done**. Setiap perubahan tercatat bersama actor dan waktu kejadian.

## Menjalankan aplikasi

Prasyarat: Node.js 20+, npm, dan PostgreSQL (misalnya Neon).

1. Buat `backend/.env`:

   ```env
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   ```

   Untuk frontend production, buat `frontend/.env` dengan URL backend tanpa slash di akhir:

   ```env
   VITE_API_URL=https://your-backend.example.com
   ```

2. Pasang dependency dan siapkan tabel:

   ```bash
   npm install
   npm run db:migrate -w backend
   ```

3. Jalankan frontend dan backend:

   ```bash
   npm run dev
   ```

Frontend: http://localhost:5173. Backend: http://localhost:3001. Dalam mode development, jika `VITE_API_URL` kosong, Vite meneruskan `/api` ke Express. Saat production, frontend membaca URL backend dari `VITE_API_URL`. Untuk menjalankan secara terpisah, gunakan `npm run dev -w frontend` dan `npm run dev -w backend`.

Jalankan satu instance backend dan frontend saja. Jika port `3001` atau `5173` sedang dipakai proses lama, hentikan proses tersebut sebelum menjalankan `npm run dev` kembali. Proses lama dapat membuat UI baru memanggil API lama dan menerima 404; script `dev` kini berhenti saat salah satu server gagal dimulai.

Pemeriksaan: `npm run typecheck`, `npm run build`, dan `npm test -w backend`. Tes integrasi memakai database pada `DATABASE_URL`, membuat satu task uji, lalu menghapusnya secara *soft delete*. Tabel dan data lain tidak dihapus.

## Arsitektur

```text
React (frontend/src/App.tsx) → Express (backend/src/app.ts) → PostgreSQL
                                                        ↳ tasks + audit_logs
```

Frontend menampilkan empat kolom, form pembuatan, dropdown actor, drag-and-drop atau tombol mobile untuk pindah ke status berikutnya, panel detail untuk mengedit judul dan deskripsi serta melihat riwayat, dan daftar task yang dihapus. Tombol tema di header memilih mode terang/gelap; pilihannya disimpan di browser dan awalnya mengikuti preferensi sistem. Saat seseorang menggeser kartu, browser lain yang membuka board menampilkan kursor berlabel actor; perubahan task juga muncul otomatis. Backend memvalidasi input dan urutan status. `backend/schema.sql` berisi skema dan trigger audit log; `backend/src/migrate.ts` menerapkannya.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/actors` | Daftar actor yang dapat dipilih |
| `GET` | `/api/tasks` | Daftar task aktif; `?includeDeleted=true` menyertakan task terhapus |
| `POST` | `/api/tasks` | Buat task di `to_do` dengan `title`, `description` opsional, dan `actor` |
| `PUT` | `/api/tasks/:id` | Ubah judul/deskripsi task dengan `title`, `description`, dan `actor` |
| `PUT` | `/api/tasks/:id/status` | Ubah ke status berikutnya dengan `status` dan `actor` |
| `DELETE` | `/api/tasks/:id` | Soft delete dengan `actor` |
| `GET` | `/api/tasks/:id/audit-logs` | Riwayat kronologis, termasuk task terhapus |
| `GET` | `/api/presence` | Stream SSE kursor aktif dan notifikasi perubahan task |
| `POST` | `/api/presence` | Kirim posisi kursor saat drag atau akhiri sesi drag |

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

## Jika ada waktu lebih

Tambahkan autentikasi, migrasi berversi, pagination task/log, penanganan konflik status yang lebih jelas di UI, dan tes interaksi browser. Untuk deployment terpisah, konfigurasi origin CORS dan URL API perlu disesuaikan dengan alamat frontend/backend produksi.
