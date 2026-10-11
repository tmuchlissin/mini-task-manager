# Panduan Presentasi Mini Task Manager

Dokumen ini membantu menjelaskan project secara runtut saat presentasi atau interview. Gunakan bahasa sendiri; contoh kalimat di bawah dapat dijadikan acuan.

## 1. Pembukaan project

> Mini Task Manager adalah aplikasi kanban sederhana untuk mengelola task internal. Fokus utamanya bukan jumlah fitur, tetapi kejelasan perubahan data. User dapat membuat task, memindahkan status, mengedit detail, menghapus task secara soft delete, dan melihat audit log yang menjelaskan siapa mengubah apa dan kapan.

Status task mengikuti requirement assignment:

```text
to_do → pending → in_progress → done
```

## 2. Teknologi yang digunakan

| Bagian | Teknologi | Peran |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite | Menampilkan board dan menangani interaksi user. |
| Backend | Node.js + Express + TypeScript | Menyediakan API dan aturan bisnis. |
| Database | PostgreSQL/Neon | Menyimpan task dan audit log secara permanen. |
| Real-time | Server-Sent Events | Mengirim perubahan board dan posisi cursor ke browser lain. |
| Testing | Node test runner + TypeScript | Memeriksa perilaku API, status, audit, dan presence. |

## 3. Struktur repository

```text
mini-task-manager/
├── frontend/
│   ├── src/
│   │   ├── main.tsx       # titik awal React
│   │   ├── App.tsx        # state, API, board, modal, drag-and-drop
│   │   └── style.css      # layout, responsive, light/dark theme
│   ├── index.html          # wadah HTML dengan elemen #root
│   ├── vite.config.ts      # port frontend dan proxy API dari env
│   └── .env.example        # contoh konfigurasi frontend
├── backend/
│   ├── src/
│   │   ├── server.ts       # menyalakan HTTP server
│   │   ├── app.ts          # middleware, route, validasi, transaksi
│   │   ├── db.ts           # connection pool PostgreSQL
│   │   ├── constants.ts    # status dan daftar actor
│   │   ├── presence.ts     # SSE dan cursor real-time
│   │   └── migrate.ts      # menjalankan schema.sql
│   ├── schema.sql          # tabel, constraint, index, trigger audit
│   ├── test/               # integration test backend
│   └── .env.example        # contoh konfigurasi backend
├── README.md
└── package.json            # workspace dan script root
```

## 4. Penjelasan TypeScript

TypeScript adalah JavaScript yang memiliki tipe data. Tipe membantu editor dan compiler menemukan kesalahan lebih awal.

```ts
const title: string = "Prepare invoice";
const count: number = 3;
```

Di frontend, file `.tsx` berarti TypeScript yang dapat berisi JSX. JSX adalah sintaks seperti HTML di dalam kode React.

```tsx
function Greeting() {
  return <h1>Hello</h1>;
}
```

File `.ts` digunakan untuk TypeScript biasa, sedangkan `.tsx` digunakan ketika file berisi komponen React atau JSX.

## 5. Alur frontend

### `index.html` dan `main.tsx`

`index.html` menyediakan wadah:

```html
<div id="root"></div>
```

`main.tsx` memasang React ke wadah tersebut dan merender `<App />`.

```text
index.html → main.tsx → App.tsx → tampilan aplikasi
```

### `App.tsx`

`App.tsx` adalah komponen utama. Bagian pentingnya:

- **Type dan constant**: mendefinisikan `Task`, `AuditLog`, `LiveCursor`, dan urutan status.
- **State React**: menyimpan task, actor aktif, theme, modal, error, loading, dan cursor.
- **`useEffect`**: menjalankan proses saat komponen dipasang, misalnya mengambil data awal dan membuka koneksi SSE.
- **Helper `api`**: menyatukan request HTTP dan penanganan error.
- **Fungsi mutation**: `create`, `moveToStatus`, `updateDetails`, dan `remove` mengirim perubahan ke backend.
- **Drag-and-drop**: `startDrag`, `dragOver`, `drop`, dan `endDrag` mengatur pemindahan kartu.
- **Render JSX**: menampilkan header, toolbar, empat kolom, kartu, archive, modal, dan history.

### React state

Contoh:

```tsx
const [tasks, setTasks] = useState<Task[]>([]);
```

Artinya `tasks` menyimpan data task saat ini, sedangkan `setTasks` digunakan untuk mengubahnya. Ketika state berubah, React merender ulang bagian UI yang membutuhkan data tersebut.

### React `useEffect`

`useEffect` digunakan untuk pekerjaan yang berhubungan dengan dunia luar komponen, seperti request API, localStorage, event keyboard, dan SSE.

Setiap effect harus memiliki cleanup jika membuat koneksi atau event listener. Di project ini cleanup menutup SSE, menghapus listener, dan menghentikan presence saat halaman ditinggalkan.

### Request API frontend

Frontend membaca URL backend dari `VITE_API_URL`:

```env
VITE_API_URL=http://localhost:3001
VITE_PORT=5173
```

`api("/api/tasks")` kemudian mengirim request ke backend. Pada development, Vite juga meneruskan path `/api` melalui proxy.

## 6. Alur backend

### `server.ts`

`server.ts` mengambil `PORT` dari environment lalu memanggil `app.listen`. File ini hanya menyalakan server; route dan middleware berada di `app.ts`.

```text
server.ts → app.ts → route API
```

### `app.ts`

`app.ts` melakukan beberapa pekerjaan:

1. Mengaktifkan CORS agar frontend dapat memanggil backend.
2. Mengaktifkan `express.json()` agar body JSON dapat dibaca.
3. Mendaftarkan route presence.
4. Mendefinisikan endpoint task dan actor.
5. Memvalidasi ID, actor, title, description, dan status.
6. Menjalankan query serta transaksi PostgreSQL.
7. Mengirim response JSON.
8. Menangkap error melalui error middleware.

### Async route

Express perlu meneruskan error dari fungsi async ke error middleware. Helper `route` melakukan pekerjaan tersebut agar setiap route tidak perlu mengulang pola yang sama.

### `db.ts`

File ini membaca `DATABASE_URL` dan membuat `pg.Pool`. Pool mengatur koneksi database agar koneksi dapat dipakai ulang oleh banyak request.

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
PORT=3001
```

## 7. Database dan tabel

### Tabel `tasks`

Menyimpan data terbaru dari task:

- `id`: UUID unik task.
- `title`: judul task, wajib 1–120 karakter.
- `description`: konteks task, maksimal 1000 karakter.
- `status`: salah satu dari empat status.
- `created_at`: waktu task dibuat.
- `updated_at`: waktu perubahan terakhir.
- `deleted_at`: waktu soft delete; `NULL` berarti task aktif.

### Tabel `audit_logs`

Menyimpan riwayat perubahan:

- `task_id`: task yang berubah.
- `actor`: user yang melakukan perubahan.
- `action`: jenis perubahan.
- `from_status` dan `to_status`: status sebelum dan sesudah.
- `previous_title` dan `previous_description`: nilai sebelum edit detail.
- `task_title` dan `task_description`: snapshot nilai setelah perubahan.
- `occurred_at`: waktu kejadian.

Snapshot disimpan agar riwayat tetap mudah dibaca walaupun data task berubah setelahnya.

### Mengapa audit log immutable?

Database memiliki trigger yang menolak `UPDATE`, `DELETE`, dan `TRUNCATE` pada `audit_logs`. Selain itu, API tidak menyediakan endpoint untuk mengubah atau menghapus log. Perubahan task dan pembuatan log dilakukan dalam satu transaksi.

## 8. Contoh alur membuat task

1. User membuka modal **New task**.
2. User mengisi title, description, dan memilih actor.
3. Frontend mengirim `POST /api/tasks`.
4. Backend memvalidasi input.
5. Backend membuka transaksi database.
6. Backend memasukkan task dengan status `to_do`.
7. Backend memasukkan audit log `created`.
8. Backend melakukan `COMMIT`.
9. Frontend memuat ulang task dan menutup modal.

Jika langkah database gagal, transaksi di-rollback sehingga task dan audit log tidak menjadi data yang setengah tersimpan.

## 9. Contoh alur memindahkan status

1. User menekan tombol status atau menggeser kartu.
2. Frontend menentukan status target berikutnya.
3. Frontend mengirim `PUT /api/tasks/:id/status`.
4. Backend mengunci row task dengan `SELECT ... FOR UPDATE`.
5. Backend memeriksa apakah target benar-benar satu tahap setelah status saat ini.
6. Backend mengubah status task.
7. Backend menambahkan audit log `status_changed`.
8. Backend melakukan `COMMIT`.
9. Frontend memperbarui board.

Jika status sama dikirim lagi, request dianggap idempotent dan tidak membuat audit log baru. Jika status melompat atau mundur, backend mengembalikan `409`.

## 10. Contoh alur edit task

Klik bagian tengah kartu membuka modal edit. Klik **History** membuka audit log. Keduanya sengaja dipisahkan agar user tidak salah membuka panel.

Saat disimpan:

1. Frontend mengirim `PUT /api/tasks/:id`.
2. Backend mengunci task.
3. Backend membandingkan title dan description lama dengan nilai baru.
4. Jika tidak berubah, tidak ada log baru.
5. Jika berubah, backend memperbarui task dan menambah log `details_changed` dalam transaksi.

## 11. Delete dan archive

Delete tidak menghapus row secara fisik. Backend mengisi `deleted_at` dan menambah audit log `deleted`.

Akibatnya:

- Task tidak muncul di board aktif.
- Task tetap dapat ditampilkan di **deleted tasks**.
- History task tetap dapat dibaca.
- Audit log lama tidak ikut hilang.

## 12. Real-time presence

Presence bukan audit log. Presence hanya menunjukkan aktivitas sementara saat user sedang drag.

```text
Browser A → POST /api/presence → backend memory
Browser B ← GET /api/presence melalui SSE
```

Backend mengirim event `cursors` dan `tasks-changed`. Cursor akan dihapus ketika drag selesai atau timeout. Implementasi ini cocok untuk satu instance backend; multi-instance membutuhkan Redis atau pub/sub bersama.

## 13. Status code API yang penting

| Status | Arti |
| --- | --- |
| `200` | Request berhasil. |
| `201` | Data baru berhasil dibuat. |
| `204` | Berhasil tanpa response body, misalnya delete atau presence update. |
| `400` | Input tidak valid. |
| `404` | Task tidak ditemukan. |
| `409` | Konflik aturan status, misalnya melompat ke status lain. |
| `500` | Error tidak terduga di server. |

## 14. Cara menjalankan saat demo

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm install
npm run db:migrate -w backend
npm run dev
```

Urutan demo yang disarankan:

1. Tunjukkan board dan empat status.
2. Buat task dengan title, description, dan actor.
3. Buka task dengan klik bagian tengah untuk menunjukkan modal edit.
4. Edit description lalu simpan.
5. Klik **History** dan tunjukkan actor serta waktu perubahan.
6. Pindahkan task menggunakan tombol atau drag-and-drop.
7. Tunjukkan log perubahan status dari status lama ke status baru.
8. Coba status yang sama untuk menjelaskan idempotensi.
9. Hapus task dan tunjukkan bahwa history masih tersedia di archive.
10. Jika ada dua browser, tunjukkan cursor actor secara real-time.

## 15. Jawaban singkat untuk pertanyaan teknis

**Mengapa menggunakan TypeScript?**

TypeScript membantu mendeteksi kesalahan tipe sebelum aplikasi dijalankan dan membuat struktur data API lebih jelas.

**Mengapa memakai PostgreSQL?**

PostgreSQL mendukung constraint, transaction, foreign key, dan trigger yang dibutuhkan untuk menjaga konsistensi task serta audit log.

**Mengapa audit log dibuat dalam transaksi yang sama?**

Agar perubahan task dan riwayatnya selalu sinkron. Jika salah satu gagal, keduanya dibatalkan.

**Mengapa actor belum memakai login?**

Assignment tidak meminta autentikasi. Actor hardcoded cukup untuk mendemonstrasikan konsep audit, tetapi production membutuhkan user identity dari sistem login.

**Apa risiko terbesar saat user bertambah?**

Actor belum terverifikasi, presence masih disimpan di memory, dan pool/database perlu diatur untuk concurrency yang lebih tinggi.

**Apa refactor pertama jika aplikasi membesar?**

Pisahkan `app.ts` menjadi route, controller, service, dan repository berdasarkan fitur task, lalu tambahkan autentikasi serta migration versioning.

## 16. Cara menjelaskan penggunaan AI

> AI membantu membuat draft struktur project, API, SQL schema, UI, dokumentasi, dan integration test. Saya memvalidasi hasilnya dengan membaca kembali alur kode, menjalankan typecheck, build, migration, dan integration test. Saya juga menguji requirement penting secara manual: status hanya maju satu tahap, update yang sama tidak membuat log baru, soft delete mempertahankan history, dan audit log tidak dapat diubah.

## 17. Batasan yang diakui

Project ini sengaja tidak memiliki login, role permission, pagination, rate limiting, retry queue, dan shared presence store. Fitur-fitur tersebut merupakan langkah lanjutan ketika aplikasi digunakan oleh lebih banyak user atau memiliki integrasi eksternal.

