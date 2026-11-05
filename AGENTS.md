# AGENTS.md — Nismara Tracker Server (`nismara-tracker-server`)

Dokumen ini menjelaskan arsitektur, skema database MongoDB, endpoint API, serta aturan **DO & DON'T** untuk backend mandiri **`nismara-tracker-server`**, yang melayani plugin C++20 in-game **`NismaraTracker.dll`** (`d:\Project\Nismara Transport\Project\nismara-tracker`).

Untuk dokumentasi lengkap yang mencakup sisi Client C++20 (SCS SDK, DirectX 11 Hook, iPhone 16 OS GUI) sekaligus Server, lihat juga:
- [`d:\Project\Nismara Transport\Project\nismara-tracker\AGENTS.md`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/AGENTS.md)

---

## 1. Tujuan & Alasan Arsitektur

Website utama Nismara Transport (`beta.nismara.web.id`) berjalan di atas infrastruktur serverless **Vercel**. Apabila plugin in-game `NismaraTracker.dll` mengirimkan request sinkronisasi dan event job secara terus-menerus ke Vercel, hal tersebut akan mengonsumsi *Serverless Function Invocations* dan berisiko menyebabkan biaya berlebih (*overcost*).

Oleh karena itu, **`nismara-tracker-server`** dibangun sebagai server **Node.js + Express + Mongoose** mandiri (berjalan di port `3100` secara lokal atau di VPS khusus) yang menjaga **satu koneksi pool persisten** ke database MongoDB Nismara.

---

## 2. Tech Stack & Konfigurasi (`.env`)

- **Runtime**: Node.js (CommonJS)
- **Framework**: Express `^4.21.2`, Mongoose `^8.10.1`, `cors`, `dotenv`
- **Port Default**: `3100` (`http://localhost:3100`)
- **Variabel Lingkungan (`.env`)**:
  - `PORT=3100`
  - `MONGODB_URI`: URI koneksi ke database MongoDB `nismara`
  - `NISMARA_GUILD_ID=863959415702028318`
  - Parameter kalkulasi ekonomi: `BASE_NC_PER_KM`, `CARGO_WEIGHT_BONUS_PER_TON`, `NISMARA_PLUS_MULTIPLIER`, `TAX_RATE_PERCENT`, `DEFAULT_FUEL_PRICE_PER_LITER`

---

## 3. Daftar Endpoint API

Seluruh endpoint di bawah `/api/tracker/*` dilindungi oleh middleware [`src/middleware/authDriver.js`](file:///D:/Project/Nismara%20Transport/Project/nismara-tracker-server/src/middleware/authDriver.js) yang membaca token driver (`NSM-...`) dari:
- Header `x-tracker-token`
- Header `Authorization: Bearer <token>`
- Body `driverToken` / `token` atau Query `?token=`

### 1. `GET /health`
Memeriksa status hidup server dan koneksi MongoDB (`readyState === 1`).

### 2. `GET /api/tracker/me` & `POST /api/tracker/me`
Mengambil profil lengkap driver untuk ditampilkan di iPhone 16 OS di dalam game:
- Data akun (`users`): `name`, `discordId`, `steamId`, `truckyRank`, `nismaraPlus`.
- Saldo Wallet (`currencies`): `totalNC` & `totalNc`.
- Level & EXP (`points`): `points`, `level`, `exp`.
- Daftar Armada Truk (`fleets`): seluruh dokumen di koleksi `fleets` dengan `owner: user._id`.
- Daftar Garasi (`garages`): seluruh dokumen di koleksi `garages` dengan `owner: user._id`.
- Pekerjaan Aktif (`ongoingJob`): dokumen `jobhistories` dengan `driver: user._id`, `status: "ONGOING"`, dan `provider: "nismara"`.

### 3. `POST /api/tracker/jobs/start`
Dipanggil otomatis oleh `NismaraTracker.dll` saat event `SCS_TELEMETRY_GAMEPLAY_EVENT_job_started` terjadi di dalam game:
- Mengecek apakah sudah ada job `"ONGOING"` milik driver pada `gameId` tersebut (mencegah duplikasi jika game di-reload).
- Menghasilkan **`jobId` sekuensial otomatis** (`"1"`, `"2"`, `"3"`, ...) menggunakan fungsi `getNextSequentialJobId()` di [`src/routes/jobs.routes.js`](file:///D:/Project/Nismara%20Transport/Project/nismara-tracker-server/src/routes/jobs.routes.js).
- Menyimpan dokumen baru di koleksi `jobhistories` dengan `status: "ONGOING"` dan `provider: "nismara"`.

### 4. `POST /api/tracker/jobs/complete`
Dipanggil otomatis saat event `SCS_TELEMETRY_GAMEPLAY_EVENT_job_delivered` terjadi di dalam game:
- Menjalankan [`processCompletedJob`](file:///D:/Project/Nismara%20Transport/Project/nismara-tracker-server/src/services/jobProcessor.js) untuk menghitung pendapatan kotor, bonus tepat waktu, penalti damage akumulatif, biaya bahan bakar, pajak, pendapatan bersih (**Net NC**), dan **EXP**.
- Membatasi `distanceKm` maksimum sebesar **`+10%` (`110%`) dari `plannedDistanceKm`** untuk mencegah kecurangan *distance farming*.
- Meng-update dokumen `jobhistories` menjadi `"COMPLETED"`.
- Menambahkan saldo `totalNC` di koleksi `currencies`, `points`/`exp`/`level` di koleksi `points`, meng-update odometer & kondisi truk di koleksi `fleets`, memperbarui progres `communitygoals`, serta mencatat riwayat transaksi di koleksi `transactions`.

### 5. `POST /api/tracker/jobs/cancel`
Dipanggil otomatis saat event `SCS_TELEMETRY_GAMEPLAY_EVENT_job_cancelled` terjadi di dalam game:
- Mengubah status dokumen `jobhistories` yang sedang `"ONGOING"` menjadi `"CANCELED"`.

### 6. `POST /api/tracker/points/pay`
Dipanggil saat driver menebus poin penalti menggunakan Nismara Cash (NC):
- Menerima `{ pointsToPay: number }`.
- Menghitung diskon kumulatif: Server Booster (`-500 NC`) + Nismara+ Aktif (`-500 NC`). Jika keduanya aktif, diskon menjadi **`-1,000 NC`**.
- Memotong saldo `currencies.totalNC` secara atomik, mengurangi `points.totalPoints` (minimal 0), serta mencatat riwayat ke `pointhistories` (`type: "remove"`) dan `currencyhistories` (`type: "spend"`).

### 7. `POST /api/tracker/points/use-ticket`
Dipanggil saat driver menggunakan tiket hapus penalti dari Safebox garasi pribadinya:
- Menerima `{ amountToUse: number }`.
- Rasio: **1 Tiket = 1 Poin Penalti Dihapus**.
- Memeriksa garasi tidak berstatus `"suspended"`.
- Memotong stok tiket `garages.safeboxStock`, mengurangi `points.totalPoints`, dan mencatat riwayat ke `pointhistories`.

---

## 4. Aturan Penting: DO & DON'T

### DO
- **DO**: Selalu dukung method `GET` maupun `POST` pada `/api/tracker/me` (`src/routes/me.routes.js`) karena `ApiClient` di C++ mengirimkan payload konteks truk via `POST`.
- **DO**: Selalu kembalikan properti `totalNC` sekaligus `totalNc` pada JSON `currency` di `/api/tracker/me`.
- **DO**: Gunakan `userId: String(user.discordId)` dan `guildId: "863959415702028318"` untuk query koleksi `currencies` dan `points`.
- **DO**: Gunakan `owner: user._id` (`ObjectId`) untuk query koleksi `fleets` dan `garages`.
- **DO**: Pertahankan pembatasan `const maxAllowedKm = Math.round(plannedKm * 1.10)` di `src/services/jobProcessor.js` agar tidak ada user yang bisa memanipulasi jarak tempuh melebihi 10% dari jarak rencana job.

### DON'T
- **DON'T**: Jangan mengubah format `jobId` untuk `provider: "nismara"` menjadi UUID acak; user secara spesifik meminta `jobId` berupa angka sekuensial yang naik otomatis (`"1"`, `"2"`, `"3"`, dst.).
- **DON'T**: Jangan menghapus field wajib pada model `JobHistory.js` karena skema tersebut dibaca bersama oleh dashboard website Nismara Transport.

