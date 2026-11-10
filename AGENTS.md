# AGENTS.md — NismaraTracker & Nismara Tracker Server

Dokumen ini adalah panduan arsitektur, referensi teknis, histori implementasi, serta aturan **DO & DON'T** untuk seluruh ekosistem **NismaraTracker**. Dokumen ini dirancang agar AI Agent / Model apa pun yang melanjutkan pengembangan dapat langsung memahami keseluruhan konteks proyek tanpa kehilangan detail sedikit pun.

---

## 1. Gambaran Umum Proyek (Project Overview)

Ekosistem **NismaraTracker** terdiri dari dua repositori/komponen utama yang saling terhubung:

1. **Client Plugin & Companion App (`nismara-tracker` & `nismara-companion`)**
   - **Lokasi**: `d:\Project\Nismara Transport\Project\nismara-tracker`
   - **Repository Git**: `https://github.com/mhazm/fortune-cookie-client.git`
   - **Peran**: Native C++20 (`x64`) in-game telemetry & overlay plugin untuk **Euro Truck Simulator 2 (ETS2)** dan **American Truck Simulator (ATS)** serta desktop companion hub berbasis Tauri v2 + React.
   - **Bentuk Distribusi**: **Single Standalone Binary (`bin/NismaraTracker.dll`)** tanpa ketergantungan DLL eksternal (menggunakan static MSVC runtime `/MT`) dan aplikasi desktop installer (`.msi` / `.exe`).
   - **Antarmuka**: In-game GUI berbentuk **iPhone 16 OS** (dimodelkan presisi dari `IPhone_16_Vector.svg` & `Nismara Group Logo.svg`) yang dirender langsung di dalam proses DirectX 11 game (toggle dengan tombol **`F11`**).

2. **Dedicated Tracker Backend (`nismara-tracker-server`)**
   - **Lokasi**: `D:\Project\Nismara Transport\Project\nismara-tracker-server`
   - **Repository Git**: `https://github.com/mhazm/fortune-cookie-server.git`
   - **Peran**: Server backend mandiri berbasis **Node.js + Express + Mongoose** yang menjembatani `NismaraTracker.dll` dengan database utama MongoDB (`nismara` database).
   - **Alasan Arsitektur**: Website utama Nismara Transport di-hosting di **Vercel** (serverless). Polling dan pengiriman telemetri/job dari plugin secara terus-menerus ke Vercel akan menguras kuota *Serverless Function Invocations* dan menyebabkan *overcost*. Oleh karena itu, seluruh komunikasi dari `NismaraTracker.dll` diarahkan ke `nismara-tracker-server` (berjalan di `http://localhost:3100` saat development atau VPS khusus saat production) dengan koneksi MongoDB pool yang persisten.

---

## 2. Tech Stack Lengkap

### A. Client Plugin (`nismara-tracker`)
- **Bahasa & Standar**: C++20 (`MSVC` x64, `/W4 /MP /EHsc /utf-8`, Static Runtime `/MT` di Release dan `/MTd` di Debug).
- **Build System**: CMake (`>= 3.20`) + MSBuild (Visual Studio 2022/2026 x64).
- **Game Telemetry API**: **SCS Telemetry SDK v1.01** (`scs-sdk/include/`).
- **Graphics & Rendering Hook**:
  - **DirectX 11 (`d3d11.lib`, `dxgi.lib`)**: Hooking `IDXGISwapChain::Present` (VTable index `8`) dan `IDXGISwapChain::ResizeBuffers` (VTable index `13`).
  - **MinHook (x64)**: Digunakan untuk hooking fungsi DirectX 11, Win32 Cursor APIs, dan DirectInput8.
  - **Dear ImGui (Docking Branch)**: Dirender di atas *render target* DX11 game dengan font TrueType asli Windows (`Segoe UI Semibold` / `Bold` / `Regular` dari `C:\Windows\Fonts`).
- **Input & Mouse Capture Bypass**:
  - Hooking `WndProc` (`SetWindowLongPtrW`) pada window game untuk menangkap hotkey (`F11` / `VK_F11`) dan memblokir input mouse/keyboard ke game saat layar iPhone 16 sedang aktif.
  - Hooking Win32 `SetCursorPos`, `ClipCursor`, `GetCursorPos` serta **DirectInput8 (`IDirectInputDevice8W::GetDeviceState` & `GetDeviceData`)** agar kamera kabin truk tidak ikut berputar saat pemain menggerakkan kursor di dalam UI iPhone 16.
- **Image & Texture Pipeline**:
  - **Windows Imaging Component (`windowscodecs.lib` / WIC)**: Memuat custom wallpaper (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`) menjadi `ID3D11ShaderResourceView*`.
  - **Embedded Vector Logo Mask (`include/ui/nismara_logo_data.hpp`)**: Hasil rasterisasi *64x-supersampled (8x8 MSAA)* dari `Nismara Group Logo.svg` (`360x100` alpha mask) yang di-composite langsung ke tengah default/preset wallpaper (`512x1108`).
- **Networking & JSON**:
  - **WinHTTP (`winhttp.lib`)**: Asynchronous HTTP/HTTPS client pada background worker thread (`std::thread`) sehingga tidak pernah memblokir render thread DX11 maupun callback SCS SDK.
  - **nlohmann/json (`vendor/json/nlohmann/json.hpp`)**: Single-header JSON parser/serializer.
- **Server Detection (`iphlpapi.lib`, `ws2_32.lib`, `tlhelp32.h`)**:
  - Kombinasi pemeriksaan modul DLL yang ter-inject di memori proses game, tabel koneksi jaringan aktif, dan parsing *reverse-chronological* pada `Documents\Euro Truck Simulator 2\game.log.txt` (dan ATS).

### B. Backend Server (`nismara-tracker-server`)
- **Runtime & Framework**: Node.js + Express (`^4.21.2`) + Mongoose (`^8.10.1`) + CORS + Dotenv.
- **Database**: MongoDB (`nismara` database) menggunakan skema koleksi yang 100% kompatibel dengan ekosistem Web (`beta.nismara.web.id`) dan Bot Discord Nismara Transport.

---

## 3. Struktur Direktori & Peta File

### A. `d:\Project\Nismara Transport\Project\nismara-tracker`
```text
nismara-tracker/
├── CMakeLists.txt                       # Konfigurasi build CMake (x64, C++20, /MT, MSVC /DELAYLOAD Ultralight)
├── Nismara Group Logo.svg               # Master vector logo Nismara Group (di-bake ke nismara_logo_data.hpp)
├── IPhone_16_Vector.svg                 # Master referensi geometri dan palet warna casing iPhone 16
├── include/
│   ├── core/
│   │   ├── telemetry_state.hpp          # Thread-safe singleton penyimpanan data telemetri, akun, fleet, garage, job
│   │   ├── scs_callbacks.hpp            # Deklarasi callback SCS SDK (frame, channel, config, gameplay events)
│   │   ├── config_manager.hpp           # Load/save konfigurasi lokal & path resolver Companion runtime/web-ui
│   │   ├── profile_validator.hpp        # Validasi 9 parameter cvars game & deteksi mod terlarang
│   │   ├── api_client.hpp               # Async WinHTTP client (/me, /jobs/start, /jobs/complete, /jobs/cancel)
│   │   └── server_detector.hpp          # Detektor server bermain (Singleplayer, SCS Convoy, TruckersMP, HaulMP)
│   ├── hooks/
│   │   ├── dx11_hook.hpp                # Hook IDXGISwapChain::Present & ResizeBuffers
│   │   └── wndproc_hook.hpp             # Hook WndProc, Win32 Cursor APIs, & DirectInput8 mouse lock bypass
│   └── ui/
│       ├── web_surface_bridge.hpp       # Bridge engine Ultralight 2.0 WebKit, D3D11 surface, mouse input, & JS bridge
│       ├── tablet_gui.hpp               # State & renderer frame hardware iPhone 16 OS (bezel, titanium, fallback)
│       ├── texture_manager.hpp          # Manajemen tekstur DX11 untuk preset & custom wallpaper
│       └── nismara_logo_data.hpp        # Data alpha mask 64x-supersampled (360x100) dari Nismara Group Logo.svg
├── src/
│   ├── dllmain.cpp                      # Entry point DLL & registrasi SetDllDirectoryW ke folder runtime Companion
│   ├── NismaraTracker.def               # Definisi simbol ekspor DLL untuk SCS SDK
│   ├── core/
│   │   ├── telemetry_state.cpp          # Implementasi thread-safe getter/setter TelemetryState
│   │   ├── scs_callbacks.cpp            # Parser atribut SCS SDK, fleet matching, akumulasi damage, & job lifecycle
│   │   ├── config_manager.cpp           # Parser & writer config + resolver GetCompanionRuntimeDirectory/WebUIDirectory
│   │   ├── profile_validator.cpp        # Parser file config.cfg & game.log.txt (cvars & forbidden mods scan)
│   │   ├── api_client.cpp               # Worker thread WinHTTP & JSON parsing respons backend
│   │   └── server_detector.cpp          # Logika deteksi modul DLL (core_ets2mp.dll, haulmp_stub.dll) & game.log.txt
│   ├── hooks/
│   │   ├── dx11_hook.cpp                # Dummy swapchain discovery, DX11 Present loop, & WebSurfaceBridge texture update
│   │   └── wndproc_hook.cpp             # F11 toggle, DirectInput8 VTable hook, & pembebasan kursor di dalam game
│   └── ui/
│       ├── web_surface_bridge.cpp       # Implementasi Ultralight WebKit runtime, D3D11 texture copy, & telemetry dispatcher
│       ├── texture_manager.cpp          # Generator wallpaper procedural iOS 18 + Nismara Logo & WIC loader
│       └── tablet_gui.cpp               # Renderer frame iPhone 16, forwarding mouse ke WebSurfaceBridge, & ImGui fallback
├── phone-ui/                            # Sub-project frontend React 19 + Tailwind CSS untuk iPhone 16 in-game OS
│   ├── package.json                     # Scripts dev, build, & deploy:local
│   ├── vite.config.ts                   # Base relative path './' untuk Ultralight file:/// loading
│   ├── tsconfig.json                    # Konfigurasi TypeScript
│   ├── index.html                       # Viewport iPhone 16 OLED (350x758) & container rounded 46px
│   └── src/
│       ├── main.tsx                     # Entry point React
│       ├── App.tsx                      # Root component, screen switcher (lock, home, app), & theme background
│       ├── index.css                    # Tailwind CSS v4 & iOS glassmorphism classes
│       ├── types/telemetry.ts           # Definisi interface telemetri & aplikasi
│       ├── hooks/useNismaraNative.ts    # Hook bridge JS nismara.on('telemetry') & mock browser simulator
│       ├── components/ios/              # Komponen iOS (DynamicIsland.tsx, StatusBar.tsx, HomeIndicator.tsx)
│       └── screens/                     # Layar aplikasi (LockScreen, HomeScreen, DispatchApp, NismaraIdApp, GarageApp, TelemetryApp, PenaltyApp, WallpapersApp, SettingsApp)
├── nismara-companion/                   # Desktop Companion Hub berbasis Tauri v2 + React
├── vendor/
│   ├── ultralight/                      # Ultralight 2.0 WebKit C++ SDK (include/ & lib/)
│   ├── minhook/                         # MinHook x64 API hook library
│   ├── imgui/                           # Dear ImGui docking branch (DX11 + Win32 backend)
│   └── json/                            # nlohmann/json single-header library
└── bin/
    └── NismaraTracker.dll               # Output akhir binary plugin standalone (1.44 MB) siap pakai

### B. Folder Runtime Distribusi Komputer Pengguna (`%LOCALAPPDATA%\Nismara Companion\`)
```text
%LOCALAPPDATA%\Nismara Companion/
├── nismara-companion.exe                # Desktop Companion App (Tauri)
├── runtime/                             # Engine Ultralight WebKit (~35 MB)
│   ├── Ultralight.dll
│   ├── UltralightCore.dll
│   ├── WebCore.dll
│   ├── AppCore.dll
│   ├── icudt67l.dat
│   └── cacert.pem
└── web-ui/                              # Bundle React 19 + Tailwind CSS Phone UI (~340 KB)
    ├── index.html
    └── assets/
        ├── index-*.js
        └── index-*.css
```

### C. `D:\Project\Nismara Transport\Project\nismara-tracker-server`
```text
nismara-tracker-server/
├── server.js                            # Entry point Express server (Port 3100) & koneksi MongoDB
├── .env                                 # Konfigurasi PORT, MONGODB_URI, GUILD_ID, dan ekonomi reward
└── src/
    ├── middleware/
    │   └── authDriver.js                # Validasi token driver (Header x-tracker-token / Authorization Bearer / Body)
    ├── models/
    │   ├── User.js                      # Koleksi `users` (name, discordId, trackerToken, truckyRank, steamId, dll.)
    │   ├── Currency.js                  # Koleksi `currencies` (userId: String(discordId), guildId, totalNC, dll.)
    │   ├── Point.js                     # Koleksi `points` (userId: String(discordId), guildId, points, level, exp)
    │   ├── Fleet.js                     # Koleksi `fleets` (owner: ObjectId(user._id), fleet_number, in_game_id, dll.)
    │   ├── Garage.js                    # Koleksi `garages` (owner: ObjectId(user._id), city, country, level, slots)
    │   ├── JobHistory.js                # Koleksi `jobhistories` (jobId sekuensial "1","2",..., provider: "nismara")
    │   ├── Cargo.js                     # Koleksi `cargos` (pencocokan kargo & multiplier harga)
    │   ├── Fuel.js                      # Koleksi `fuels` (harga bahan bakar per liter)
    │   ├── CurrencyBoost.js             # Koleksi `currencyboosts` (multiplier event NC/EXP aktif)
    │   ├──CommunityGoal.js             # Koleksi `communitygoals` (kontribusi event komunitas otomatis)
    │   └── Transaction.js               # Koleksi `transactions` (pencatatan mutasi pendapatan job NC)
    ├── routes/
    │   ├── me.routes.js                 # GET & POST /api/tracker/me (sinkronisasi profil, wallet, fleet, garage, ongoingJob)
    │   ├── jobs.routes.js               # POST /api/tracker/jobs/start, /complete, /cancel
    │   ├── points.routes.js             # POST /api/tracker/points/pay & /use-ticket
    │   ├── events.routes.js             # GET /api/tracker/events (contracts, coupons, giveaways, ncevents)
    │   ├── news.routes.js               # GET /api/tracker/news (proxy Sanity CMS Viewer API menggunakan SANITY_TOKEN)
    │   └── updater.routes.js            # GET /api/tracker/version & /update.json
    └── services/
        └── jobProcessor.js              # Kalkulasi finansial job, cap +25% plannedDistanceKm, update wallet/exp/fleet
```

---

## 4. Aturan Skema Database MongoDB (KRITIS!)

Saat memodifikasi query atau skema di `nismara-tracker-server`, **WAJIB** mematuhi relasi antar-koleksi MongoDB Nismara berikut:

1. **Perbedaan `user._id` vs `user.discordId`**:
   - Koleksi **`currencies`** dan **`points`** **TIDAK** menggunakan `ObjectId(user._id)`, melainkan menggunakan:
     - `userId: String(user.discordId)`
     - `guildId: "863959415702028318"` (atau `process.env.NISMARA_GUILD_ID`)
   - Koleksi **`fleets`** dan **`garages`** menggunakan:
     - `owner: user._id` (`ObjectId`)
2. **Koleksi `points` (POIN PENALTI DRIVER, BUKAN PRESTASI)**:
   - Field `totalPoints` di koleksi `points` mencatat **poin penalti pelanggaran driver** (skala 0–50).
   - Nilai ideal adalah **0** (Aman). Status: `<10` Aman (Hijau), `10-24` Penalty 1 (Kuning), `25-49` Penalty 2 (Oranye), `≥50` Penalty 3 (Merah).
   - Jangan pernah menganggap `totalPoints` sebagai skor prestasi atau men-default nilainya ke 100!
3. **Koleksi `garages` (`safeboxStock`, Level Fasilitas, & Rincian Biaya Operasional NC)**:
   - Field `safeboxStock` di koleksi `garages` adalah **jumlah tiket hapus penalti**, BUKAN saldo uang/NC.
   - Kapasitas maksimal tiket: $\text{Max Tickets} = 10 + (\text{safeboxLevel} - 1) \times 5$.
   - Rasio penggunaan: **1 Tiket Safebox = 1 Poin Penalti Dihapus**.
   - **Level Fasilitas & Biaya Operasional (dalam NC / Nismara Coin)**:
     - `fleetSlotLevel`: Level kapasitas slot armada (mulai dari `1`).
     - `fuelTankLevel`: Level kapasitas tangki solar ($\text{fuelTankLevel} = \max(1, \frac{\text{fuelCapacity} - 1000}{1000})$).
     - `safeboxLevel`: Level kapasitas brankas safebox (mulai dari `1`).
     - `operational_cost`: Total biaya operasional garasi dalam NC (`fleet_operational_cost + fuel_operational_cost + safebox_operational_cost`) beserta tanggal jatuh tempo `next_payment_date`.
     - `fleet_operational_cost`: Biaya operasional slot armada ($\sum_{i=2}^{\text{fleetSlotLevel}} [250 + \lfloor\frac{i-1}{3}\rfloor \times 250]$ NC).
     - `fuel_operational_cost`: Biaya operasional tangki solar ($\sum_{i=2}^{\text{fuelTankLevel}} [200 + \lfloor\frac{i-1}{5}\rfloor \times 100]$ NC).
     - `safebox_operational_cost`: Biaya operasional brankas safebox ($\sum_{i=2}^{\text{safeboxLevel}} [250 + \lfloor\frac{i-2}{3}\rfloor \times 150]$ NC).
4. **Koleksi `fleets` (`wear.unfix_*`, `maintenance.*`, `status`, & Jadwal Servis — KRITIS!)**:
   - **`wear.unfix_engine`, `wear.unfix_transmission`, `wear.unfix_brakes`, `wear.unfix_tires`**:
     - Nilai di database MongoDB **SUDAH dalam skala persentase `0–100` (contoh: `2.8427` berarti `2.84%`)**, BUKAN skala pecahan `0.0–1.0`!
     - **JANGAN PERNAH** mengalikan `unfix_*` dengan `100` di frontend/UI karena akan menyebabkan `2.84%` tampil salah menjadi `284.3%`.
   - **`maintenance.engine` (`50000`), `maintenance.tires` (`20000`), `maintenance.transmission` (`70000`), `maintenance.brakes` (`35000`)**:
     - Angka ini adalah **Target Odometer Servis Berkala Berikutnya (dalam KM)** — artinya saat odometer truk mencapai angka tersebut (misal odometer menyentuh `20.000 km`), truk wajib melakukan servis komponen terkait ($\text{Sisa Jarak Servis} = \text{maintenance.target} - \text{odometer}$).
     - **JANGAN PERNAH** mengartikan field `maintenance.*` sebagai "jarak tempuh sejak servis terakhir". Untuk titik odometer saat terakhir kali diservis, gunakan `last_maintenance.{engine,tires,transmission,brakes}`.
   - **`status`, `maintenance_needed`, `maintenance_start_date`, `maintenance_end_date`**:
     - `status`: Memiliki enum `["active", "inactive", "onservice", "need_maintenance"]` (lihat model `Fleet.ts`).
     - `maintenance_needed` (`boolean`): Menandakan apakah unit truk sudah harus melakukan servis berkala.
     - `maintenance_start_date` & `maintenance_end_date` (`Date | null`): Waktu mulai servis dan estimasi selesai servis armada.
     - `customName` & `customImage`: Nama julukan kustom dan foto kustom armada.
5. **Koleksi `currencies` & Aturan Diskon Kumulatif**:
   - Field saldo utama di database bernama **`totalNC`** (perhatikan huruf besar `NC`).
   - Endpoint `/api/tracker/me` mengembalikan keduanya (`totalNC` dan `totalNc`) di JSON.
   - Biaya tebus penalti via NC: Base `pointPrice = 3000 NC` (dari `guildsettings`).
   - **Diskon Kumulatif**: Server Booster (-500 NC) + Nismara+ Aktif (-500 NC). Jika driver memiliki keduanya, diskon menjadi **-1,000 NC** (biaya tebus menjadi 2,000 NC/poin).
6. **Koleksi `jobhistories` (Pencatatan Job dari Plugin)**:
   - **`provider`**: Selalu bernilai `"nismara"` (untuk membedakan dari job legacy `"trucky"`).
   - **`jobId`**: String angka sekuensial auto-increment mulai dari `"1"`, `"2"`, `"3"`, dst. Dihasilkan oleh fungsi `getNextSequentialJobId()` di `src/routes/jobs.routes.js` yang mencari nilai numerik tertinggi pada dokumen `jobhistories` dengan `provider: "nismara"`.
   - **`status`**: `"ONGOING"` saat job dimulai (`job_started`), lalu berubah menjadi `"COMPLETED"` (`job_delivered`) atau `"CANCELED"` (`job_cancelled`).

---

## 5. Fitur & Milestone yang Sudah Selesai Dikerjakan (Phases 1–5)

### Phase 1: Core SCS Telemetry SDK & DirectX 11 Overlay
- Integrasi penuh dengan **SCS Telemetry SDK v1.01** (`scs_telemetry_init` / `scs_telemetry_shutdown`).
- Hooking `IDXGISwapChain::Present` dan `ResizeBuffers` menggunakan dummy window/swapchain VTable discovery.
- Penanganan penuh *fullscreen / alt-tab / resolution resize* dengan melepas `ID3D11RenderTargetView` sebelum `ResizeBuffers` dieksekusi.
- Hooking `WndProc` (`F11` untuk membuka/menutup HP) + bypass penguncian kursor Win32 & DirectInput8 agar mouse dapat mengklik UI dengan bebas tanpa menggerakkan kamera truk.

### Phase 2: Sinkronisasi Akun Driver (`NSM-...`)
- Konfigurasi lokal disimpan secara otomatis di direktori dokumen user game (`Documents\Euro Truck Simulator 2\nismara_config.dat` atau `Documents\American Truck Simulator\nismara_config.dat`, dengan dukungan parameter `-homedir` dan path XDG/macOS), sehingga folder instalasi `bin/win_x64/plugins/` tetap bersih (hanya berisi binary `NismaraTracker.dll`) dan satu lokasi dengan `game.log.txt` serta `profiles/.../save/.../game.sii`.
- Verifikasi token driver (`NSM-XXXXXX-...`) ke `/api/tracker/me` secara asynchronous.
- Menampilkan nama driver, rank, level, EXP, Nismara+ status, dan saldo **Nismara Cash (NC)** secara real-time.

### Phase 3: Antarmuka iPhone 16 OS & Custom Wallpapers
- Casing dan layar OLED **iPhone 16** (`392x794` px, layar dalam `350x758` px dengan `46px` rounded corners) dengan 5 pilihan warna frame (*Ultramarine*, *Black Titanium*, *Natural Titanium*, *Teal*, *Pink*).
- **Lock Screen**: Jam besar iOS 18 (`62px`), tanggal, greeting pill, widget **TRUCK STATUS**, widget **NISMARA WALLET**, widget **SERVER STATUS** (`Connected` + `Playing Singleplayer / TruckersMP / HaulMP / SCS Convoy`), dan kartu notifikasi rute aktif.
- **Home Screen**: Smart Driver Widget di bagian atas, grid 8 ikon aplikasi (*Telemetry*, *Job*, *Nismara ID*, *Garage*, *Events [SOON]*, *Wallpapers*, *Settings*, *Lock*), serta iOS Frosted Dock di bagian bawah.
- **Dynamic Island**: Pill interaktif di bagian atas layar yang menampilkan nomor lambung fleet aktif (`NL-074 | 80 km/h`) dan dapat diklik untuk melakukan *expand* informasi detail (kecepatan, gigi, sisa jarak navigasi, atau bahan bakar & RPM).
- **Default & Custom Wallpaper**:
  - 5 Preset tema iOS 18 (*Ultramarine*, *Midnight*, *Executive Gold*, *Cyberpunk*, *Sunset*) yang menampilkan logo resmi **`Nismara Group Logo.svg`** tepat di tengah wallpaper.
  - Mendukung pemilihan gambar kustom dari folder `Documents\<Game>\wallpapers\` secara terpisah untuk Lock Screen dan Home Screen.

### Phase 4: Sinkronisasi Kendaraan In-Game $\leftrightarrow$ Database `fleets` & `garages`
- Setiap kali truk di dalam game berganti atau akun selesai disinkronisasi, `TelemetryState::MatchActiveVehicleWithFleet` mencocokkan truk in-game dengan daftar `fleets` milik driver di database:
  - **Prioritas 1**: Pencocokan eksak `in_game_id` (`brand_id + "." + model_id`, contoh: `renault.magnum.2009` == `renault.magnum.2009`).
  - **Prioritas 2**: Pencocokan prefix model dasar (`scania.s_2016` cocok dengan `scania.s_2016.8x4`) dengan syarat `fleet.game` sesuai (`ETS2` atau `ATS`).
  - **Prioritas 3**: Fallback pencocokan nama brand + model secara *case-insensitive*.
- Aplikasi **My Garage** di dalam HP menampilkan daftar seluruh garasi (`garages`) dan armada truk (`fleets`) milik driver beserta kondisi kesehatan, odometer, bahan bakar, plat nomor, dan badge **`IN USE`** pada armada yang sedang dikendarai.

### Phase 5: Deteksi Server, Pencatatan Job (`jobhistories`), Akumulasi Damage & Anti-Farming Cap
1. **Deteksi Server (`ServerDetector`)**:
   - Mendeteksi secara akurat apakah driver bermain di **`Singleplayer`**, **`SCS Convoy`**, **`TruckersMP`**, atau **`HaulMP`**.
   - Menggunakan deteksi modul DLL di memori (`core_ets2mp.dll` untuk TruckersMP; `haulmp_stub.dll` / `haulmp-telemetry.dll` untuk HaulMP) serta pembacaan terbalik (*reverse scan*) `game.log.txt` sehingga tidak salah mendeteksi jika driver sebelumnya pernah membuka mod lain.
2. **Siklus Hidup Job Otomatis (`ONGOING` $\rightarrow$ `COMPLETED` / `CANCELED`)**:
   - Saat mengambil job di game (`SCS_TELEMETRY_GAMEPLAY_EVENT_job_started`): plugin mengirim `POST /api/tracker/jobs/start` dan membuat dokumen `jobhistories` berstatus `"ONGOING"` dengan `jobId` sekuensial (`"1"`, `"2"`, ...).
   - Saat menyelesaikan job (`SCS_TELEMETRY_GAMEPLAY_EVENT_job_delivered`): plugin mengirim `POST /api/tracker/jobs/complete`, backend menghitung pendapatan **NC**, **EXP**, pajak, biaya bahan bakar, bonus on-time, meng-update kondisi & odometer armada di koleksi `fleets`, mencatat mutasi di `transactions`, dan memperbarui saldo wallet driver.
   - Saat membatalkan job (`SCS_TELEMETRY_GAMEPLAY_EVENT_job_cancelled`): plugin mengirim `POST /api/tracker/jobs/cancel` dan mengubah status dokumen menjadi `"CANCELED"`.
3. **Perhitungan Damage Akumulatif (Anti-Repair Reset)**:
   - Selama job berlangsung (`job_active == true`), setiap kenaikan wear pada 5 komponen truk (`engine`, `transmission`, `cabin`, `chassis`, `wheels`) serta `trailer` dan `cargo` diakumulasikan ke variabel `job_accum_*` (`src/core/scs_callbacks.cpp`).
   - Jika driver melakukan **repair di bengkel di tengah perjalanan**, nilai wear di game memang turun ke `0`, namun `job_accum_*` **TIDAK di-reset**. Jika setelah repair driver menabrak lagi, kenaikan damage baru langsung ditambahkan ke akumulasi sebelumnya.
4. **Pembatasan Jarak Maksimum `+25%` (`plannedDistanceKm` Cap)**:
   - Untuk mencegah eksploitasi *distance farming* (mengambil job jarak pendek lalu berputar-putar agar mendapat NC besar), baik di plugin (`src/core/scs_callbacks.cpp`) maupun di backend (`src/services/jobProcessor.js`), parameter `distanceKm` dibatasi maksimum **`125%` (`+25%`) dari `plannedDistanceKm`**:
     $$\text{effectiveDistanceKm} = \min\left(\text{drivenKm},\ \text{round}(\text{plannedDistanceKm} \times 1.25)\right)$$

### Phase 6: Aplikasi Penalty Points, Safebox Tickets & Diskon Kumulatif
1. **Aplikasi Penalty Points (`PhoneAppId::PenaltyPoints`)**:
   - Ikon Shield Alert Crimson di Home Screen iPhone 16.
   - Status bar penalti `0 – 50` poin dengan 4 tingkat bahaya (Aman, Penalty 1, Penalty 2, Penalty 3).
   - Modul tebus via NC dengan stepper poin dan total kalkulasi biaya.
   - Modul hapus penalti via tiket brankas garasi (`Safebox`).
   - Notifikasi toast hasil transaksi secara real-time.
2. **Diskon Kumulatif Penebusan NC**:
   - Server Booster: Diskon `500 NC`.
   - Nismara+ Aktif: Diskon `500 NC`.
   - Keduanya aktif: Diskon kumulatif **`1,000 NC`** (biaya tebus turun dari 3,000 NC menjadi 2,000 NC/poin).
3. **Endpoint Backend Khusus**:
   - `POST /api/tracker/points/pay`: Pemotongan atomik saldo NC, pengurangan `points.totalPoints`, pencatatan `pointhistories` & `currencyhistories`.
   - `POST /api/tracker/points/use-ticket`: Pemotongan stok tiket `garages.safeboxStock`, pengurangan `points.totalPoints`, pencatatan `pointhistories`.
4. **Perbaikan Tampilan My Garage & Nismara ID**:
   - `RenderGarageView`: Safebox menampilkan `X / Y Tiket Hapus Penalti` (bukan saldo NC) dengan tombol langsung menuju aplikasi Penalty Points.
   - `RenderNismaraIdView`: Mengoreksi label dari *Driver Points* menjadi *Poin Penalti* dengan indikator warna status.

### Phase 7: Perombakan Total Antarmuka 7 Aplikasi (Native iOS UI & Interactive Sub-Navigation)
1. **Penerapan Native Segmented Control (`RenderSegmentedControl`)**:
   - Seluruh 7 aplikasi kini memiliki arsitektur layout khas iOS mandiri yang unik, tidak lagi monoton.
2. **My Garage (`RenderAppGarage` & `RenderFleetDetailInspector`)**:
   - Sub-tab: `Overview`, `Armada (X)`, `Fasilitas`.
   - Setiap kartu kendaraan di tab `Armada` dapat diklik untuk masuk ke tampilan drill-down **Vehicle Detail Inspector**.
   - Inspector menampilkan spesifikasi teknis lengkap, status asuransi, live in-game vs database odometer, keausan komponen, tombol bind manual, serta **Jadwal & Target Servis Berkala (Countdown km)** untuk mesin (`maint_engine`), transmisi (`maint_transmission`), rem (`maint_brakes`), dan ban (`maint_tires`). Jika jarak tempuh melewati target, badge merah `LEWAT X km!` akan menyala.
   - Tombol navigasi atas berganti dinamis menjadi `< Garage` dan judul menjadi `Vehicle Detail`.
3. **Job (`RenderAppDispatch`)**:
   - Sub-tab: `Waybill Rute` & `Slip Paycheck`.
   - `Waybill Rute`: Menampilkan visual rute timeline (Origin $\rightarrow$ Destination) dengan indikator panah, jarak rencana, sisa navigasi real-time, manifest kargo, kuota cap jarak (+25%), serta akumulasi kerusakan dan statistik kecepatan.
   - `Slip Paycheck`: Menampilkan invoice/paystub digital resmi pekerjaan terakhir lengkap dengan pendapatan bersih NC, bonus multiplayer, hardcore parking, potongan pajak, service, dan denda poin penalti.
4. **Nismara ID (`RenderAppNismaraId`)**:
   - Desain **Apple Wallet Holographic Pass** dengan barcode digital prosedural, Discord ID, SteamID64, Trucky Role/Rank emblem dengan warna badge resmi.
   - Kartu Apple Card saldo Nismara Cash, progress EXP/Level driver, dan pill status pelanggaran.
5. **Telemetry (`RenderAppTelemetry`)**:
   - Sub-tab: `Cockpit`, `Powertrain`, `Diagnostik`.
   - Cockpit menghadirkan digital cluster speedometer besar, kotak transmisi `[D12]`/`[N]`/`[R1]`, cruise control, RPM bar dengan redline warning, serta kompas navigasi dan koordinat GPS dunia.
6. **Penalty Points (`RenderAppPenaltyPoints`)**:
   - Sub-tab: `Tebus NC`, `Tiket Garasi`, `Aturan`.
   - Gauge bahaya terintegrasi dengan stepper interaktif tebus NC (kalkulasi diskon otomatis) dan penggunaan tiket Safebox garasi.
7. **Wallpapers (`RenderAppWallpapers`)**:
   - Sub-tab: `Preset iOS 18`, `Foto Disk`, `Warna Casing`.
8. **Settings (`RenderAppSettings`)**:
   - Format iOS Inset Grouped Table dengan kelompok pengaturan perilaku, cloud endpoint switcher, token password masking, dan info sistem.

### Phase 8: Nismara Companion Desktop App, Win32 Mutex Gatekeeper & Auto-Updater
1. **Nismara Companion App (`nismara-companion/`)**:
   - **Framework**: Tauri v2 (`x86_64-pc-windows-msvc`) + React 19 + TypeScript + Vite + Tailwind CSS v4.
   - **UI Desktop Modern**:
     - *Header Quick Launch*: Menampilkan status deteksi Steam, status instalasi plugin `NismaraTracker.dll`, tombol `Install Plugin`, serta tombol `Launch ETS2` / `Launch ATS` (`steam://rungameid/227300` & `270880`).
     - *5 Tab Navigasi Utama*: **Dashboard**, **Job Waybill**, **My Garage** (lengkap dengan hitungan mundur target servis berkala), **Penalty Points** (tebus via saldo NC & gunakan tiket Safebox), dan **Settings** (pengaturan base URL, switch profile token, info hardware).
2. **Win32 Named Mutex Gatekeeper Protocol (`Global\NismaraCompanionRunning`)**:
   - **Tujuan**: Memastikan in-game overlay iPhone 16 **hanya dapat diakses jika dan hanya jika Nismara Companion Desktop App sedang berjalan di background**.
   - **Implementasi Rust (`src-tauri/src/lib.rs`)**:
     - Membuka Named Mutex `Global\NismaraCompanionRunning` (dengan fallback `Local\NismaraCompanionRunning`) menggunakan Win32 API (`CreateMutexW`).
     - Handle mutex disimpan di memori selama Companion App hidup (`CompanionMutexGuard`), dan dilepas secara otomatis saat aplikasi ditutup.
   - **Implementasi In-Game C++ (Non-Intrusive & Crash-Proof)**:
     - Plugin `NismaraTracker.dll` tetap ter-load aman bersama game tanpa memicu `FreeLibrary` atau `SCS_RESULT_unsupported` yang berisiko menyebabkan game crash seusai video intro.
     - Di dalam hook keyboard Windows ([`src/hooks/wndproc_hook.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/hooks/wndproc_hook.cpp)): Setiap kali tombol `F11` ditekan, fungsi `IsCompanionAppRunning()` memeriksa keberadaan Mutex.
     - **Jika Companion TIDAK berjalan**: Tombol `F11` sepenuhnya dinonaktifkan (*disabled/dormant*), kursor game tidak dibebaskan, dan overlay iPhone 16 tidak pernah terbuka.
     - **Jika Companion SEDANG berjalan**: Tombol `F11` langsung aktif normal membuka iPhone 16 OS.
     - **Jika Companion ditutup saat HP sedang terbuka**: Di dalam rendering loop ([`src/ui/tablet_gui.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/ui/tablet_gui.cpp)), sistem mendeteksi hilangnya Mutex dan langsung menutup tampilan HP secara otomatis.
3. **Ekosistem CI/CD & Auto-Updater via GitHub Releases (`.github/workflows/release.yml`)**:
   - Kompilasi otomatis multi-platform (Windows `.exe`, Linux `.AppImage`/`.deb`, macOS `.dmg`) dijalankan via **GitHub Actions** setiap kali git tag `v*` di-push atau dijalankan via `workflow_dispatch`.
   - Pada runner Windows, workflow secara otomatis mengompilasi `NismaraTracker.dll` (Release x64) terlebih dahulu dengan CMake & MSBuild, menyalinnya ke `resources/` paket installer Companion, dan mengunggahnya sebagai standalone asset di GitHub Release.
   - Endpoint auto-updater di `tauri.conf.json` diarahkan langsung ke GitHub Releases:
     `https://github.com/mhazm/fortune-cookie-client/releases/latest/download/latest.json`
   - Hal ini menghemat beban bandwidth server VPS secara drastis (di-hosting gratis dan berkecepatan tinggi oleh GitHub Global CDN) serta memudahkan 300+ driver menerima pembaruan instan.
   - Integritas biner pembaruan divalidasi dengan enkripsi Minisign (`pubkey` di `tauri.conf.json` dan `TAURI_SIGNING_PRIVATE_KEY` di GitHub Secrets).

### Phase 9: Auto-Updater Otomatis, In-Game Version Gatekeeper & Sinkronisasi Biner DLL
1. **Pemeriksaan Pembaruan Klien Desktop (`Nismara Companion`)**:
   - Terintegrasi langsung dengan `@tauri-apps/plugin-updater` dan `@tauri-apps/plugin-process`.
   - Setiap kali Nismara Companion dibuka, aplikasi secara otomatis memeriksa pembaruan via GitHub Releases (`latest.json`).
   - Tersedia tombol manual `Periksa Pembaruan` di footer bar dan modal dialog interaktif dengan catatan rilis (changelog), progress bar download real-time, dan tombol `Unduh & Perbarui Sekarang` (auto-relaunch).
2. **Deteksi & Auto-Sync Biner DLL In-Game (`NismaraTracker.dll`)**:
   - Companion membandingkan ukuran dan timestamp biner `NismaraTracker.dll` di folder game (`plugins/`) dengan biner yang dibundel di dalam aplikasi.
   - Jika biner di folder game usang (`plugin_outdated`), Companion menampilkan badge status dan tombol interaktif `Perbarui Plugin DLL` (Amber), serta secara otomatis menyinkronkannya saat startup selama game sedang tidak berjalan.
3. **Penegakan Versi Minimum Server (Server-Side Version Gatekeeper)**:
   - Server `nismara-tracker-server` memberlakukan variabel `MIN_TRACKER_VERSION` (default `"1.0.0"`).
   - Middleware `authTracker.js` memeriksa header `X-Tracker-Version`. Jika versi klien lebih rendah dari versi minimum:
     - Mengembalikan `HTTP 426 Upgrade Required` dengan kode error `"OUTDATED_VERSION"` dan panduan pembaruan.
     - Tracking telemetri dan job dari klien usang ditolak dengan aman tanpa menyebabkan data korup.
   - Endpoint publik `GET /api/tracker/version` disediakan untuk memverifikasi batas versi minimum dan URL rilis resmi.
4. **Peringatan In-Game Overlay iPhone 16 (`tablet_gui.cpp`)**:
   - Jika plugin mendeteksi penolakan `HTTP 426 / OUTDATED_VERSION` dari server:
     - Layar iPhone 16 in-game menampilkan banner peringatan merah mencolok di bagian atas layar:
       `! UPDATE DIPERLUKAN: Wajib v{min_ver} - Buka Nismara Companion`.
     - Pengemudi langsung mengetahui bahwa mereka perlu membuka Companion untuk memperbarui aplikasi.

### Phase 10: Spesifikasi Hardcore Mode, Validasi Parameter Game, & Kalkulasi Hardcore Points (HP)
1. **Definisi Hardcore Mode**:
   - Mode simulasi penuh di mana seluruh parameter realisme game wajib aktif, tanpa bantuan instan (*no auto-assist*), tanpa mod terlarang, dan dengan pengujian berkendara ketat.
2. **9 Parameter Konfigurasi Profil Game Wajib**:
   1. `g_traffic >= 1` (Traffic wajib ada, tidak boleh 0).
   2. `g_fatigue = 1` (Fatigue / Kelelahan pengemudi = Yes).
   3. `g_police = 1` (Traffic Offence / Tilang polisi = Yes).
   4. `g_simple_parking_doubles = 0` / Parking Difficulty = Skilled Parking (Parkir manual presisi tinggi).
   5. `g_road_events >= 0.1` (Random Road Events minimal 10%).
   6. `g_rain_prob >= 0.1` (Probabilitas hujan minimal 10%).
   7. `g_trailer_advanced_coupling = 1` (Advanced Trailer Coupling = Yes).
   8. `g_fuel_economy = 1` (Realistic Fuel Consumption = Yes).
   9. `g_air_brake = 1` (Air Brakes Simulation = Yes).
3. **Kategori Kecepatan Mengemudi (Speed Classification — ETS2 vs ATS)**:
   - Sesuai standar simulasi realistis VTC Nismara Transport dan model `JobHistory` (`lib/models/JobHistory.ts`), klasifikasi kecepatan dibedakan secara adil sesuai game yang sedang dimainkan:
     - **Euro Truck Simulator 2 (`eut2` / `gameId: "1"`)**:
       - **Real Miles** ($\le 100\text{ km/h}$ / $\approx 62.1\text{ mph}$): Kecepatan reguler standar jalan tol Eropa. Memenuhi syarat bonus Hardcore.
       - **Race Miles** ($> 100\text{ km/h}$ dan $\le 180\text{ km/h}$): Melebihi batas aman realistis. Dikenakan penalti `+2` Poin Pelanggaran (`pointhistories`), pembatalan bonus Distance & Mass (`-100%`), dan diskualifikasi rating Hardcore.
       - **Invalid Stats** ($> 180\text{ km/h}$ / $> 111.8\text{ mph}$): Kecepatan tidak wajar / glitch physics. Dikenakan penalti berat `+5` Poin Pelanggaran dan rating otomatis 0 bintang.
     - **American Truck Simulator (`amtrucks` / `gameId: "2"`)**:
       - **Real Miles** ($\le 80\text{ mph}$ / $\le 128.75\text{ km/h}$): Kecepatan reguler jalan tol Interstate AS (Texas, Utah, Montana, Nevada). Memenuhi syarat bonus Hardcore.
       - **Race Miles** ($> 80\text{ mph}$ dan $\le 130\text{ mph}$ / $> 128.75\text{ km/h}$ dan $\le 209.2\text{ km/h}$): Kecepatan balap truk. Dikenakan penalti `+2` Poin Pelanggaran, pembatalan bonus Distance & Mass (`-100%`), dan diskualifikasi rating Hardcore.
       - **Invalid Stats** ($> 130\text{ mph}$ / $> 209.2\text{ km/h}$): Manipulasi physics / speedhack. Dikenakan penalti berat `+5` Poin Pelanggaran dan rating otomatis 0 bintang.
   - **Simetri Headroom Safety**: Kedua game memiliki buffer keselamatan kecepatan Race Miles yang seimbang yaitu sebesar $+80\text{ km/h}$ ($+50\text{ mph}$) di atas batas Real Miles sebelum dikategorikan sebagai Invalid Stats.

4. **Kriteria Validasi Kelayakan Hardcore & 3-Pillar Integrity Model**:
   - **Pillar 1 — Validasi Awal (Start Check)**:
     - Saat job baru diambil (`is_new_contract`), client plugin langsung melakukan pemindaian profil game (`ProfileValidator::ScanProfileSettings`).
     - Data 9 parameter cvars, status mod, `gameId` (`"1"` / `"2"`), dan `game` dikirim ke `POST /api/tracker/jobs/start`.
     - Job disimpan dengan field `gameId` dan `game` lengkap di MongoDB sehingga job ETS2 dan ATS tidak pernah bercampur atau konflik.
     - Jika sejak awal konfigurasi ada yang belum memenuhi syarat (misal `g_fatigue 0`, mod terlarang aktif, dll.), backend server dan plugin langsung mengunci status job menjadi **`isHardcoreEligibleAtStart = false`** dan **`hardcore_disqualified = true`**.
   - **Pillar 2 — Pemantauan Pelanggaran & Penguncian Mid-Trip (Latched Disqualification)**:
     - Plugin memantau telemetri secara berkelanjutan selama berkendara:
       - **Batas Kecepatan Real Miles Adaptif**: Jika kecepatan menembus batas Real Miles game aktif ($> 100\text{ km/h}$ untuk ETS2 atau $> 80\text{ mph}$ / $128.75\text{ km/h}$ untuk ATS), status langsung didiskualifikasi secara permanen (`s.hardcore_disqualified = true`).
       - **Anti-Tampering Cvars Reaktif**: Setiap 5 detik, plugin memeriksa perubahan `last_write_time` berkas `config.cfg` dan `game.log.txt` (overhead sub-milidetik). Jika terdeteksi perubahan parameter cvars menjadi non-hardcore saat sedang berkendara, job langsung didiskualifikasi.
       - **Anti-Warp / Speedhack**: Rasio lompatan waktu game vs wall-clock $> 26\times$ langsung mendiskualifikasi job.
       - **Fitur Auto Park**: Menggunakan auto-parking langsung mengunci status diskualifikasi.
     - **Prinsip One-Way Latch**: Sekali `hardcore_disqualified` menjadi `true`, nilai tersebut **TIDAK DAPAT KEMBALI MENJADI FALSE** sampai seluruh kontrak pekerjaan selesai dan kontrak baru dimulai.
   - **Pillar 3 — Gerbang Validasi Akhir (Finish Verification di Server)**:
     - Saat job selesai (`POST /api/tracker/jobs/complete`), server memvalidasi `driverJob.isHardcoreEligibleAtStart`, `payload.hardcoreDisqualifiedDuringTrip`, kelengkapan 9 cvar di finish, jarak tempuh aktual $\ge 250\text{ km}$, massa kargo $> 0\text{ ton}$, BBM $> 0\text{ L}$, dan kesesuaian kategori Real Miles sesuai `gameId`.

5. **Kriteria Kelayakan Teknis (Semua Wajib Terpenuhi)**:
   - Kecepatan berada dalam kategori **Real Miles** ($\le 100\text{ km/h}$).
   - Seluruh 9 setting konfigurasi profil di atas terkonfigurasi dengan benar sejak start hingga finish.
   - Tidak menggunakan Auto Load (*No Auto Load* — dikecualikan untuk Freight Market, Public Transport System, dan WOTR Freight Market).
   - Parkir Manual (*Manual Parking* — event `auto_parking_used == false`).
   - Jarak tempuh aktual di atas 250 km (`distanceKm >= 250`).
   - Tidak ada manipulasi waktu / warp (*No Warping* — rasio waktu in-game vs wall-clock valid, warp value tidak berubah).
   - Tidak menggunakan Damage Mod (kerusakan fisik aktif & logis).
   - Massa kargo lebih dari 0 ton (`cargoMassTons > 0`).
   - Bahan bakar terpakai lebih dari 0 liter (`fuelUsedLiters > 0`).
   - Tidak ada Forbidden Mods yang terdeteksi di `game.log.txt`.
   - Tidak melakukan rute berulang secara eksploitatif (*No Repetitive Route*).
   - Massa kargo masuk akal (*Reasonable Cargo Mass*).
5. **Rumus Perhitungan Hardcore Points (HP)**:
   $$\text{HP} = 0.4 \times \text{Distance} + 0.35 \times \text{Mass} - 0.4 \times \text{Fuel Economy} - 1.0 \times \text{Damage Percentage} - 5.0 \times \text{Number of Fines}$$
   - *Non SCS Stock Cargo*: Nilai bonus massa kargo tetap bernilai `5.25`.
6. **Penalti Pengurangan HP**:
   - *Late Delivery*: Penalti `-50%` dari total bonus Distance dan Mass.
   - *Rest Time Stop Overdue*: Melewati batas istirahat > 30 menit waktu game $\rightarrow$ Penalti `-50%` dari total bonus Distance dan Mass.
   - *Race / Invalid Stats*: Pengurangan total bonus Distance dan Mass (`-100%`).
   - *Job Canceled*: Pengurangan total bonus Distance dan Mass (`-100%`).
   - *Speeding (Batas > 40 km/h, toleransi 5 km/h)*: Maksimal waktu mengebut yang diizinkan adalah `10%` dari Real-Time driving. Setiap 1 menit mengebut di atas batas tersebut dikenakan penalti `-5%` dari bonus Distance dan Mass.
7. **Delivery Rating Bintang (0 hingga 5 Bintang)**:
   - **Distance Rating**: `<250km`: 0★, `250-499km`: 1★, `500-749km`: 2★, `750-999km`: 3★, `1000-1249km`: 4★, `≥1250km`: 5★.
   - **Mass Rating**: `<10t`: 0★, `10-14.99t`: 1★, `15-19.99t`: 2★, `20-24.99t`: 3★, `25-29.99t`: 4★, `≥30t`: 5★ (Non SCS Stock Cargo = 1★).
   - **Damage Rating**: `0%`: 5★, `1-10%`: 4★, `11-20%`: 3★, `21-30%`: 2★, `31-40%`: 1★, `>40%`: 0★.
   - **Fuel Economy Rating**: Ideal ETS2 = 38 L/100km, ATS = 42 L/100km.
     $$\text{Stars} = \text{clamp}\left(5 - \frac{\text{FuelEconomy} - \text{Ideal}}{\text{Ideal}},\ 0,\ 5\right)$$
   - **Fines Rating**: `0 fines`: 5★, `1 fine`: 4★, `2 fines`: 3★, `3 fines`: 2★, `4 fines`: 1★, `≥5 fines`: 0★.
   - **Penalti Bintang Akhir**:
     - Late Delivery: `-2 Bintang`.
     - Rest Time Overdue: `-2 Bintang`.
     - Job Canceled / Race Stats / Invalid Stats: `0 Bintang (Diskualifikasi Total)`.
8. **Deteksi Forbidden Mods**:
   - Memeriksa daftar mod aktif di `game.log.txt` yang mengubah: damage calculation, fuel consumption, tollgates, tank size, speed limits, delivery time, sleeping time, bypass fines, atau economy mod.
9. **Integrasi Antarmuka In-Game iPhone 16 (`tablet_gui.cpp`)**:
   - *Settings App*: Dilengkapi kartu **DIAGNOSTIK SIMULASI HARDCORE** dengan checklist 9 parameter status `[OK]` / `[X]`, status mod game, dan tombol interaktif `Pindai Ulang Profil Game (Rescan)` yang dapat dipicu kapan saja tanpa restart game.
   - *Job Dispatch - Waybill*: Menampilkan klasifikasi kecepatan real-time (`Real Miles` hijau, `Race Miles` crimson, `Invalid Stats` merah), serta badge status kelayakan `[★ SIMULASI HARDCORE: ELIGIBLE]` atau `[SIMULASI STANDAR]`.
   - *Job Dispatch - Slip Paycheck*: Menampilkan total **Hardcore Points (`+X.X HP`)**, kalkulasi **5-Star Delivery Rating (`★ ★ ★ ★ ☆`)**, serta rincian alasan diskualifikasi jika kriteria tidak terpenuhi.

### Phase 11: Integrasi Berita Sanity CMS di Nismara Companion Desktop App
1. **Live Fetching dari Sanity CMS**:
   - Mengambil artikel resmi Nismara Group langsung dari **Sanity Edge CDN** (`projectId: yi1d1k89`, `dataset: production`, `apiVersion: 2024-03-15`) dengan GROQ query berurutan `publishedAt desc`.
   - Dilengkapi mekanisme fallback ke REST API publik `https://nismara.web.id/api/articles`.
2. **Koleksi & Penyajian Media Resolusi Tinggi**:
   - Transformasi referensi asset `image-<hash>-<width>x<height>-<ext>` ke URL Sanity Image CDN global (`https://cdn.sanity.io/images/yi1d1k89/production/...`).
   - Rasio 16:9 dengan overlay badge kategori dinamis (`Update`, `News`, `Transport`, dll.).
3. **Fitur Antarmuka Tab News**:
   - Filter interaktif berbasis kategori dinamis (pills) yang diekstrak otomatis dari metadata artikel.
   - Indikator loading skeleton dan tombol manual `Segarkan Berita` (`RefreshCw`).
   - Modal Reader pop-up (`Nismara Gazette`) di dalam aplikasi untuk membaca artikel lengkap tanpa harus keluar dari aplikasi.
   - Integrasi tombol `Buka di Web` dengan `@tauri-apps/plugin-opener` (`openUrl`) untuk membuka tautan di browser default sistem.

### Phase 12: Penggantian Tab Map Menjadi Events & Agregasi Multi-Koleksi MongoDB
1. **Agregasi Multi-Koleksi MongoDB di Backend (`/api/tracker/events`)**:
   - Penggantian placeholder tab Map di desktop companion dengan pusat informasi kegiatan VTC (**Events**).
   - Backend `nismara-tracker-server` mengagregasi 4 koleksi MongoDB (`contracts`, `coupons`, `giveaways`, `ncevents`).
   - Format respons terstandarisasi dengan endpoint `GET /api/tracker/events` yang menyajikan ringkasan metrik statistik serta timeline feed kronologis.
2. **Antarmuka Interaktif Tab Events di Nismara Companion Desktop App**:
   - Ikon navigasi `Trophy` menggantikan `MapIcon` pada sidebar desktop app.
   - Filter pills kategori (`Semua`, `Kontrak`, `Kupon Hadiah`, `Giveaway Quest`, `NC Boost`).
   - Kartu event responsif dengan banner visual, badge status, countdown/tanggal, ringkasan quest, dan tombol salin kupon interaktif.
   - Modal inspektor mendalam (*Event Detail Modal*) untuk melihat seluruh detail kontrak, rincian quest giveaway & tier hadiah.

### Phase 13: Penguncian & Perlindungan Endpoint Server Produksi (IP Hiding & Beta Security)
1. **Paten Endpoint Produksi 24/7 (`http://103.150.101.154:3100`)**:
   - Menghilangkan seluruh input text/field URL server dari pandangan pengguna di antarmuka Nismara Companion Desktop App maupun aplikasi Settings iPhone 16 in-game C++.
   - Menggantikannya dengan status badge keamanan: `[●] Nismara Official Cloud Network (Online / 100% Secure)`.
2. **Auto-Upgrade & Sanitasi Konfigurasi**:
   - Jika file `nismara_config.dat` pada perangkat driver masih berisi URL dev lama (`localhost:3100`, `localhost:3000`, `127.0.0.1`) atau kosong, C++ plugin dan Tauri Rust engine secara otomatis meng-upgrade-nya ke server live `http://103.150.101.154:3100`.
   - String `status_message` pada `ApiClient` dibersihkan dari pemaparan raw IP (`Menyinkronkan dengan Nismara Cloud...`).
   - Binary standalone `NismaraTracker.dll` di bundle `resources/` diperbarui dengan build release terbaru.

### Phase 11: Ultralight 2.0 WebKit Engine & In-Game iPhone 16 OS via React 19 + Tailwind CSS
1. **Latar Belakang & Masalah CEF vs Ultralight**:
   - Upaya merender UI web in-game menggunakan CEF (Chromium Embedded Framework) memicu pembengkakan ukuran binary hingga ~400 MB yang melanggar batas distribusi ringan Nismara.
   - Diadopsi engine **Ultralight 2.0 (WebKit + JavaScriptCore fork)** yang dirancang khusus untuk game C++ / DirectX 11.
   - Ukuran redistributable terpangkas drastis menjadi **~35 MB uncompressed (hanya ~25 MB terkompresi 7z)**, namun tetap mendukung 100% kapabilitas React 19, Tailwind CSS v4, Lucide SVG icons, dan animasi CSS halus.
2. **Zero-Clutter Game Folder via MSVC `/DELAYLOAD`**:
   - Folder instalasi game `bin/win_x64/plugins/` **hanya berisi 1 file tunggal: `NismaraTracker.dll` (1.4 MB)**.
   - Seluruh DLL engine (`Ultralight.dll`, `UltralightCore.dll`, `WebCore.dll`, `AppCore.dll`) dan aset WebKit (`icudt67l.dat`, `cacert.pem`) disimpan terpusat di folder Companion: `%LOCALAPPDATA%\Nismara Companion\runtime\`.
   - Di `src/dllmain.cpp` (`DLL_PROCESS_ATTACH`), plugin mendaftarkan direktori tersebut ke Windows DLL search path melalui `SetDllDirectoryW`.
3. **Arsitektur Rendering & Input Forwarding (`WebSurfaceBridge`)**:
   - `WebSurfaceBridge` mengelola instance Ultralight `Renderer` dan `View` beresolusi native OLED iPhone 16 (`350 x 758 px`) dengan mode transparan.
   - Buffer bitmap Ultralight di-upload secara langsung ke `ID3D11Texture2D` berformat `DXGI_FORMAT_B8G8R8A8_UNORM` dan dirender ke layar melalui `draw_list->AddImageRounded(..., 46.0f)` di dalam bezel iPhone 16 ImGui.
   - Event mouse (gerakan kursor, klik kiri/kanan, dan mouse wheel) diterjemahkan dari koordinat game ke koordinat lokal layar `[0..350] x [0..758]` dan diteruskan ke `view->FireMouseEvent()` & `FireScrollEvent()`.
4. **Bidirectional JavaScript Bridge & Telemetry Streaming**:
   - Menggunakan `js::API` Ultralight: C++ mengekspos event `nismara.on('telemetry', (json) => ...)` yang mem-push live speed, gear, RPM, bahan bakar, muatan kargo, rute, keausan komponen, dan saldo NC.
   - JavaScript mengekspos fungsi kontrol native: `nismara.lockPhone()`, `nismara.unlockPhone()`, `nismara.closePhone()`, dan `nismara.openApp()`.
5. **Project Frontend Mandiri (`phone-ui/`)**:
   - Dibangun dengan Vite + React 19 + TypeScript + Tailwind CSS v4.
   - Mengadopsi prinsip UI/UX dari skill global `ui-ux-pro-max`, `sleek-design-mobile-apps`, dan `no-ai-slop`.
   - **7 Aplikasi dengan Kepribadian Unik**:
     - *Lock Screen*: Jam raksasa iOS 18, Dynamic Island aktif, 3 lockscreen widgets, dan live route card.
     - *Home Screen*: Smart Driver Widget, 8 app icons (touch targets min 56x56 px), dan frosted glass dock.
     - *Waybill & Dispatch*: Layout nota kargo logistik industrial, manifest muatan, timeline rute origin-destination, dan slip paycheck digital.
     - *Nismara ID*: Desain Apple Wallet holographic member pass dengan barcode dan badge rank.
     - *My Garage*: Showroom armada aktif, aus 5 komponen fisik, dan countdown kilometer servis berkala.
     - *Cockpit Cluster*: Digital speedometer tajam, multi-band RPM bar (Eco, Power, Redline), dan telltale indicators.
     - *Penalty Compliance*: Gauge penalti 0-50 poin, stepper tebus NC diskon kumulatif, dan penggunaan tiket Safebox.
     - *Themes & Settings*: 5 Preset tema iOS 18 (Ultramarine, Midnight, Cyberpunk, Executive, Sunset) dan tabel konfigurasi inset grouped.
6. **Automatic Graceful Fallback**:
   - Jika runtime Ultralight atau folder `web-ui` belum terinstal, `tablet_gui.cpp` secara otomatis beralih ke rendering Dear ImGui native tanpa pernah menyebabkan game crash.
7. **Pencegahan Deadlock / Freeze saat Exit Game (OS Loader Lock Safety)**:
   - Shutdown graceful (`Dx11Hook::Shutdown()`, `ApiClient::Shutdown()`) dipindahkan ke `scs_telemetry_shutdown()` yang dieksekusi oleh engine game saat telemetry session berakhir.
   - Di `src/dllmain.cpp` (`DLL_PROCESS_DETACH`), jika `lpReserved != nullptr` (tanda proses sedang dimatikan secara instan oleh OS), DLL dilarang keras melakukan thread synchronization / `.join()` atau panggilan DirectX/COM untuk mencegah freeze/deadlock di bawah Windows Loader Lock.
8. **Aturan CSS Engine Compatibility pada Ultralight WebKit**:
   - Engine WebKit pada Ultralight 2.0 (branch 615) tidak memproses selector kelas Tailwind dengan kurung siku escaped (`\[...\]` seperti `.pt-[68px]`, `.text-[68px]`, `.rounded-[26px]`).
   - Seluruh layout viewport, padding safe area atas/bawah, elevasi dock, dan ukuran jam wajib menggunakan **inline styles React (`style={{ ... }}`)** atau CSS murni tanpa arbitrary bracket selector agar rendering konsisten 100% dan tidak pernah melorot/menumpuk.
9. **Penegakan Gatekeeper Sesi Kabin Aktif (Anti-Crash Menu / Loading / Pause)**:
   - F11 dan rendering overlay iPhone 16 **hanya diizinkan ketika driver sedang berada di dalam kabin truk aktif** (`TelemetryState::IsInCabinDrivingSession()`).
   - Di ETS2/ATS, menu utama memiliki *3D desktop showroom* di latar belakang yang memuat model truk (`Desktop screen config switched to 'truck'`). Untuk membedakan kabin berkendara nyata dari menu utama/showroom, plugin mendaftarkan event callback `SCS_TELEMETRY_EVENT_frame_start` untuk memonitor `paused_simulation_time`.
   - Driver dianggap berada di dalam sesi kabin berkendara (`is_driving_in_world`) jika dan hanya jika:
     1. Simulasi fisik aktif berdetak (`paused_simulation_time` terus bertambah, tidak beku).
     2. Status `is_paused == false`.
     3. Model truk terpasang (`truck_in_game_id` tidak kosong).
     4. Waktu in-game berjalan (`game_time_minutes > 0`).
     5. Koordinat posisi truk di dunia valid (`abs(pos_x) > 1.0` atau `abs(pos_z) > 1.0`).
   - Di Main Menu, Loading Screen, atau saat game di-pause (Esc), penekanan tombol F11 otomatis diblokir total (`return 0`).
   - Jika game memasuki status pause atau memuat game baru (`OnTelemetryPause` / `SCS_TELEMETRY_EVENT_paused`), overlay HP otomatis tertutup seketika untuk mencegah *swapchain pipeline conflict* dan crash DirectX saat game memuat save.
10. **Optimasi Alokasi Memori Ultralight & Zero Backbuffer Lock**:
    - Default Ultralight mengalokasikan 256 MB cache dan memicu hingga 16 worker thread yang berisiko memicu *E_OUTOFMEMORY (0x8007000E)* saat ETS2 memuat tekstur dunia (misal 2048x2048 shadow maps).
    - Dikonfigurasi ultra-ringan: `memory_cache_size = 32 MB`, `num_renderer_threads = 1`, `max_heap_size = 64 MB`, dan `idle_gc_enabled = true`.
    - `main_rtv_` (DX11 RenderTargetView) HANYA dibuat saat HP dalam keadaan terlihat (`tablet_visible == true`). Saat HP tertutup, `main_rtv_` segera dilepas (`CleanupRenderTarget()`) sehingga plugin tidak pernah menahan referensi ke swapchain backbuffer saat game memuat save atau berpindah adegan.

### Phase 15: Penyempurnaan Companion Phone (Nismara OS), Alur Data SCS SDK, Filter Game Armada, & Stabilitas Input/Scroll (WAJIB DIPAHAMI OLEH SEMUA MODEL AI!)
Bagian ini merangkum arsitektur final yang sudah 100% stabil agar model AI mana pun (termasuk Gemini Flash / Pro / Claude) **TIDAK melakukan improvisasi liar atau merusak sistem yang sudah berjalan**:

1. **Identitas & Penamaan Resmi (`Companion Phone` & `Nismara OS`)**:
   - Seluruh teks antarmuka pengguna di `phone-ui/` maupun `tablet_gui.cpp` **WAJIB** menggunakan nama perangkat **"Companion Phone"** dan sistem operasi **"Nismara OS"** (contoh: `Nismara OS v1.0.1`, `Build 1.0.1-x64`).
   - **DILARANG** menampilkan teks `"iPhone 16"` atau `"iOS 18"` di layar pengguna.
   - Versi plugin dan OS dikirim secara dinamis dari macro CMake `NISMARA_VERSION` (`CMakeLists.txt` $\rightarrow$ `src/ui/web_surface_bridge.cpp`), bukan di-hardcode manual.

2. **Sumber Data Truk & Transmisi (100% SCS Telemetry SDK, BUKAN `game.log.txt`!)**:
   - **Identitas Truk In-Game**: Diambil murni dari callback SCS Telemetry SDK `OnTelemetryConfiguration` (`info->id == "truck"`) di [`src/core/scs_callbacks.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/core/scs_callbacks.cpp) (`brand_id`, `brand`, `id`, `name`, `license_plate`), yang kemudian langsung memanggil `TelemetryState::Get().MatchActiveFleet()`. **JANGAN PERNAH** mencoba membaca merek/model truk dari `game.log.txt`!
   - **Gigi Transmisi (`gear_text`)**: Diambil dari channel SCS SDK `SCS_TELEMETRY_TRUCK_CHANNEL_displayed_gear` (`gear.displayed`) dan `selected_gear` (`gear.selected`), lalu diformat oleh `FormatTruckGearString()` di `scs_callbacks.cpp` menjadi `D1..D12`, `N`, `R1..`, atau `1L..8H` dan dikirim ke React melalui field JSON `gear_text`.
   - **Pencocokan Armada (`MatchActiveFleet`) vs Truk Sewa (Quick Job)**:
     - `TelemetryState::MatchActiveFleet()` mencocokkan `truck_in_game_id` / `brand` / `model` yang sedang dikendarai dengan daftar `fleets` milik user dari database.
     - Jika cocok (`has_matched_fleet == true`), maka nomor lambung (`fleet_number`, misal `NL-074`) ditampilkan.
     - Jika **TIDAK cocok** (`has_matched_fleet == false`), berarti user sedang memakai **Truk Sewa (Quick Job) atau truk yang belum terdaftar di garasi**. Dalam kondisi ini, `fleet_number` **HARUS KOSONG (`""`)** dan UI menampilkan `SEWA` / `TRUK SEWA` / `[UNREGISTERED]`. **DILARANG KERAS** memaksa atau meng-hardcode `fleet_number` milik user ketika `has_matched_fleet == false`!

3. **Filter Armada Berdasarkan Game Aktif (`ETS2` vs `ATS`)**:
   - Di database MongoDB, field `game_id` pada dokumen koleksi `fleets` sering bernilai default `"1"`, sedangkan identitas game sebenarnya tersimpan di dokumen `fleetstores` hasil `$lookup` (`f.modelInfo.game_id`: `1` = ETS2, `2` = ATS).
   - Di backend [`src/routes/me.routes.js`](file:///D:/Project/Nismara%20Transport/Project/nismara-tracker-server/src/routes/me.routes.js), mapping `gameId` pada `fleets` wajib menggunakan `String(f.modelInfo?.game_id ?? f.game_id ?? "1")`.
   - Di sisi client C++ (`telemetry_state.cpp` & `web_surface_bridge.cpp`) dan React (`GarageApp.tsx`), daftar armada difilter berdasarkan game yang sedang berjalan (`IsFleetMatchingGame` / `isFleetForCurrentGame`). Saat bermain **ETS2**, hanya armada ETS2 yang ditampilkan dan dicocokkan; saat bermain **ATS**, hanya armada ATS yang ditampilkan dan dicocokkan.

4. **Skema JSON `/api/tracker/me` (Nested Schema & Ketahanan Data)**:
   - Endpoint `GET/POST /api/tracker/me` mengembalikan struktur JSON bersarang di bawah `data`:
     - `data.driver` (`name`, `discordId`, `steamId`, `image`, `banner`, `rank`, `role`, `joinedConvoy`)
     - `data.wallet` (`totalNC`, `totalNc`)
     - `data.level` (`level`, `exp`, `totalExp`)
     - `data.penalty` (`totalPoints`, `pointPrice`, `discountBooster`, `discountNismaraPlus`, `totalDiscount`, `finalPointPrice`, `safeboxTickets`, `maxPenaltyTickets`)
     - `data.garage` (`hasGarage`, `fuelStock`, `fuelCapacity`, `fuelLevel`, `fleetSlot`, `fleetSlotUsed`, `safeboxStock`, `safeboxLevel`)
     - `data.fleets` (array armada) & `data.perks` (`nismaraPlus`, `isBooster`, `insurance`, `ncBoost`, `topManager`)
   - Fungsi `ParseDriverAccountJson` di [`src/core/api_client.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/core/api_client.cpp) wajib mem-parsing struktur bersarang tersebut (dengan fallback ke key flat).
   - Apabila request HTTP `/api/tracker/me` mengalami kegagalan jaringan sementara (timeout / koneksi terputus sesaat), **JANGAN PERNAH** menimpa `TelemetryState` dengan `DriverAccountData` kosong yang menghapus daftar `fleets` dan `garage` yang sudah berhasil dimuat sebelumnya!

5. **Aturan Hook DirectInput8 (Anti-Crash Saat Colok Joystick / Steering Wheel)**:
   - Di [`src/hooks/wndproc_hook.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/hooks/wndproc_hook.cpp), **DILARANG KERAS** memasang hook pada `IDirectInput8W::CreateDevice` (VTable index `3`).
   - **Alasan**: Saat pemain mencolokkan perangkat Joystick, Steering Wheel, atau Gamepad USB di tengah permainan, engine ETS2/ATS memanggil `CreateDevice` untuk `DI8DEVCLASS_GAMECTRL`. Mencegat VTable `CreateDevice` akan merusak inisialisasi perangkat kontroler dan menyebabkan game langsung *crash* (*Access Violation*).
   - **Cara yang Benar**: Buat dummy device `GUID_SysMouse` satu kali saat inisialisasi hook, lalu hanya pasang hook pada `GetDeviceState` (VTable index `9`) dan `GetDeviceData` (VTable index `10`). Di dalam hook tersebut, periksa `IsMouseDevice(this)` dan hanya blokir pergerakan kamera ketika layar HP sedang terbuka (`IsTabletVisible() == true`).

6. **Aturan Vertical Scrolling pada Ultralight WebKit (`phone-ui/`)**:
   - **Masalah Klasik Flexbox + Overflow**: Jika sebuah `<div>` memiliki `overflow-y: auto` sekaligus `display: flex; flex-direction: column`, engine WebKit akan menyusutkan tinggi kartu-kartu di dalamnya (`flex-shrink: 1`) agar muat di dalam tinggi layar, sehingga kartu tampak gepeng/terpotong dan `scrollHeight === clientHeight` (tidak bisa di-scroll ke bawah).
   - **Pola Wajib (`.scroll-area`)**:
     Seluruh halaman aplikasi di `phone-ui/src/screens/*.tsx` wajib memisahkan kontainer scroll (block) dan kontainer flex di dalamnya:
     ```tsx
     <div data-scroll-container="true" className="scroll-area">
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
         {/* Kartu-kartu konten di sini */}
       </div>
     </div>
     ```
   - Selain `view->FireScrollEvent()`, `WebSurfaceBridge::FireMouseScroll` memancarkan event JS `nismara.on('scroll', ({ x, y, delta_y }) => ...)` yang ditangkap di [`useNismaraNative.ts`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/phone-ui/src/hooks/useNismaraNative.ts) untuk menggerakkan `el.scrollTop -= delta_y` secara presisi pada elemen `[data-scroll-container="true"]`.

7. **Siklus Buka/Tutup HP (`overlay_open_seq`), Dynamic Island, & Idle Throttling**:
   - Saat layar Companion Phone ditutup (`F11`), `WebSurfaceBridge` melakukan *idle throttling* (tidak me-render ulang frame WebKit setiap siklus DX11 `Present`), sehingga penggunaan CPU/GPU in-game saat HP tertutup adalah ~0%. *(Catatan: Proses `WebView2 Manager` di Task Manager Windows adalah milik aplikasi desktop **Nismara Companion (Tauri)**, bukan proses di dalam game).*
   - Setiap kali HP dibuka/ditutup dengan `F11`, counter `overlay_open_seq` bertambah. `DynamicIsland.tsx` mendengarkan perubahan `overlay_open_seq` dan `activeScreen` agar otomatis kembali menutup (*collapse* ke bentuk pill kecil) setiap kali pengguna berpindah aplikasi atau menutup HP.
   - Ukuran `DynamicIsland`: Saat tertutup (*collapsed*) berbentuk pill ringkas (`172x26 px`) yang hanya menampilkan status lambung/sewa serta kecepatan & gigi. Saat diklik (*expanded*) membuka kartu detail (`318x92 px`).

8. **Aturan Gatekeeper Pencatatan Job (`IsCompanionAppRunning()`) vs Layar HP In-Game (`F11`)**:
   - **Aplikasi Desktop `Nismara Companion` (`nismara-companion.exe`) WAJIB Terbuka**:
     Di [`src/core/scs_callbacks.cpp`](file:///d:/Project/Nismara%20Transport/Project/nismara-tracker/src/core/scs_callbacks.cpp) (`OnTelemetryGameplayEvent` untuk `job_started`, `job_delivered`, `job_cancelled`), plugin **WAJIB** memeriksa `nismara::core::IsCompanionAppRunning()`.
     - Jika aplikasi desktop **`Nismara Companion` TIDAK dibuka** oleh pemain: **pekerjaan TIDAK BOLEH dicatat ke database** (request `/jobs/start`, `/jobs/complete`, `/jobs/cancel` diblokir). **JANGAN PERNAH menghapus pemeriksaan `IsCompanionAppRunning()` ini!**
     - Jika aplikasi desktop **`Nismara Companion` SEDANG terbuka** (baik di layar maupun berjalan di background/system tray): **pekerjaan TETAP DICATAT 100% OTOMATIS ke database oleh `scs_callbacks.cpp` meskipun pemain sama sekali tidak membuka layar HP in-game (`F11`) selama perjalanan**.

---

## 6. Konteks Produksi Skala Besar (~300+ Pengguna), Cross-Platform, & Server 24/7 (PRIORITAS UTAMA!)

Proyek ini digunakan oleh sekitar **300+ pengemudi aktif VTC Nismara Transport** dengan spesifikasi perangkat, sistem operasi, dan struktur penyimpanan yang sangat beragam. Seluruh desain dan kode di `nismara-tracker`, `nismara-companion`, dan `nismara-tracker-server` **WAJIB** mematuhi tiga pilar produksi berikut:

### A. Skala Multi-User (~300+ Orang) & Direktori Dinamis (Zero Hardcoded Paths/Tokens)
1. **Tidak Boleh Ada Path atau Token Hardcoded Milik Developer**:
   - Setiap pengguna memiliki lokasi instalasi Steam, library game (`C:\`, `D:\`, `E:\`, `/home/user/.steam`, `/Users/user/Library/Application Support/Steam`, dll.), serta lokasi folder profil (`Documents\Euro Truck Simulator 2` atau custom `-homedir`) yang berbeda-beda.
   - Jangan pernah menjadikan token personal developer (`NSM-...`) atau path lokal developer (seperti `F:\SteamLibrary\...`) sebagai nilai default di UI Companion maupun C++ plugin. Nilai default token dan custom path override harus kosong (`""`) untuk pengguna baru.
2. **Resolusi Direktori Otomatis, Penyimpanan di `Documents\<Game>`, & Kemudahan Akses `game.sii`**:
   - `Nismara Companion` wajib mendeteksi lokasi instalasi game secara otomatis melalui parsing `libraryfolders.vdf` lintas drive/partisi, serta menyediakan opsi pemilihan folder manual bagi pengguna dengan instalasi kustom.
   - Seluruh file konfigurasi dan data lokal (`nismara_config.dat`, folder `wallpapers/`, dan file heartbeat gatekeeper) **TIDAK** disimpan di dalam folder `bin/win_x64/plugins/` game agar folder `plugins/` tetap bersih (hanya berisi `NismaraTracker.dll`) dan bebas dari masalah izin tulis Administrator (`Program Files`).
   - Sebaliknya, seluruh file tersebut disimpan terpusat di direktori data dokumen game pengguna:
     - **Windows & Steam Proton**: `Documents\Euro Truck Simulator 2\` dan `Documents\American Truck Simulator\` (atau direktori `-homedir` jika pengguna memakai parameter launch `-homedir`).
     - **Linux Native**: `~/.local/share/Euro Truck Simulator 2/` dan `~/.local/share/American Truck Simulator/`.
     - **macOS**: `~/Library/Application Support/Euro Truck Simulator 2/` dan `~/Library/Application Support/American Truck Simulator/`.
   - Penempatan terpusat di folder dokumen game ini juga memberikan akses langsung satu pintu ke `game.log.txt`, `config.cfg`, serta `profiles/` & `steam_profiles/` (`save/.../game.sii`) untuk pengembangan fitur lanjutan ke depannya.
   - Saat pengguna mengisi `Driver Tracker Token` dan `Server Backend URL` di `Nismara Companion`, konfigurasi tersebut langsung disinkronkan secara otomatis ke `Documents\Euro Truck Simulator 2\nismara_config.dat` dan `Documents\American Truck Simulator\nismara_config.dat`.

### B. Dukungan Lintas Sistem Operasi (Windows, Linux, dan macOS)
Tidak semua anggota komunitas menggunakan Windows. Ekosistem Nismara harus mengutamakan kompatibilitas untuk **Windows**, **Linux**, dan **macOS**:
1. **Nismara Companion (`nismara-companion` - Tauri v2)**:
   - Kode Rust di `src-tauri/src/lib.rs` dan dependensi di `Cargo.toml` wajib memisahkan API spesifik OS menggunakan conditional compilation (`#[cfg(target_os = "windows")]`, `#[cfg(target_os = "linux")]`, `#[cfg(target_os = "macos")]`).
   - **Deteksi Steam per OS**:
     - **Windows**: Registry `HKCU\Software\Valve\Steam` / `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` + `libraryfolders.vdf`.
     - **Linux**: `~/.steam/steam`, `~/.local/share/Steam`, dan Flatpak (`~/.var/app/com.valvesoftware.Steam/.local/share/Steam`) + `libraryfolders.vdf`.
     - **macOS**: `~/Library/Application Support/Steam` + `libraryfolders.vdf`.
   - **Peluncuran Game (`steam://rungameid/<id>`)**: Menggunakan `cmd /c start` di Windows, `xdg-open` di Linux, dan `open` di macOS (atau `tauri-plugin-opener`).
2. **In-Game Telemetry Plugin (`nismara-tracker`)**:
   - **Linux via Steam Proton / Wine**: Banyak pengguna Linux menjalankan ETS2/ATS versi Windows melalui Proton (DXVK $\rightarrow$ DirectX 11). Agar `NismaraTracker.dll` berjalan mulus di dalam Proton/Wine:
     - Pembuatan font di `tablet_gui.cpp` (`LoadTrueTypeFonts`) wajib memiliki fallback font multi-path (termasuk font bawaan Wine/Linux atau font default Dear ImGui) jika `Segoe UI` tidak tersedia di prefix Wine.
     - Mekanisme **Gatekeeper** tidak boleh hanya mengandalkan Win32 Named Mutex (`Global\NismaraCompanionRunning`), karena proses native Linux `Nismara Companion` terpisah dari namespace Win32 Mutex di dalam container Wine/Proton. Wajib dilengkapi dengan **Cross-Platform Gatekeeper Heartbeat File** (misalnya file lock/heartbeat bertimestamp yang diperbarui oleh Companion) sebagai pendamping Win32 Mutex.
   - **Linux Native (`.so`) & macOS Native (`.dylib`)**: Sistem build `CMakeLists.txt` dan abstraksi platform harus disiapkan agar dapat dikompilasi menjadi `NismaraTracker.dll` (`bin/win_x64/plugins/`), `libNismaraTracker.so` (`bin/linux_x64/plugins/`), dan `libNismaraTracker.dylib` (`Euro Truck Simulator 2.app/Contents/MacOS/plugins/`).

### C. Server Produksi 24/7 (`nismara-tracker-server`)
1. **Berjalan 24/7 dengan IP / Domain Publik Sendiri**:
   - Saat development, `nismara-tracker-server` berjalan di `http://localhost:3100`.
   - Saat production, server ini berjalan **24/7 di VPS/Dedicated Server khusus** yang memiliki IP publik atau domain sendiri untuk melayani ~300+ pengguna secara bersamaan.
2. **Keamanan Autentikasi Multi-User Ketat (Tanpa Localhost Bypass)**:
   - Di server 24/7 (terutama jika berada di balik reverse proxy seperti Nginx, Caddy, atau Cloudflare di mana `req.ip` terlihat sebagai `127.0.0.1`), middleware autentikasi (`src/middleware/authTracker.js`) **DILARANG KERAS** menyimpan variabel global `lastAuthenticatedUser` atau melakukan fallback ke user pertama di database ketika token tidak cocok!
   - Setiap request HTTP dari plugin/companion wajib diautentikasi secara independen dan terisolasi menggunakan `Authorization: Bearer <trackerToken>` atau `x-tracker-token` milik masing-masing pengguna.
3. **Pengecualian IP/Port Tracker Server dari Deteksi Socket Multiplayer**:
   - Di `src/core/server_detector.cpp`, saat memindai koneksi TCP aktif milik proses game untuk mendeteksi SCS Convoy / Multiplayer, host dan port dari `api_base_url` (`nismara-tracker-server`) wajib dikecualikan agar koneksi HTTP keep-alive ke server tracker 24/7 tidak salah terdeteksi sebagai sesi multiplayer.

---

## 7. Cara Build, Deploy, dan Menjalankan Proyek

### A. Build & Deploy `phone-ui` (In-Game Companion Phone React Bundle)
Setiap kali memodifikasi file di `phone-ui/src/`, **WAJIB** mem-build dan men-deploy ke folder runtime Companion:
```powershell
cd "d:\Project\Nismara Transport\Project\nismara-tracker\phone-ui"
npm run deploy:local
```
Serta salin hasil build `phone-ui/dist/*` ke `nismara-companion/src-tauri/resources/web-ui` dan `nismara-companion/src-tauri/target/release/web-ui` agar paket Companion App selalu sinkron.

### B. Build & Deploy `NismaraTracker.dll`
Jalankan perintah PowerShell berikut dari direktori `d:\Project\Nismara Transport\Project\nismara-tracker`:
```powershell
cmake --build build --config Release
Copy-Item -Path "bin\NismaraTracker.dll" -Destination "$env:LOCALAPPDATA\Nismara Companion\NismaraTracker.dll" -Force
Copy-Item -Path "bin\NismaraTracker.dll" -Destination "nismara-companion\src-tauri\resources\NismaraTracker.dll" -Force
Copy-Item -Path "bin\NismaraTracker.dll" -Destination "C:\Program Files (x86)\Steam\steamapps\common\Euro Truck Simulator 2\bin\win_x64\plugins\NismaraTracker.dll" -Force
```
*(Catatan: Jika game ETS2 sedang berjalan dan me-lock file `NismaraTracker.dll`, tutup game terlebih dahulu sebelum menjalankan `Copy-Item`).*

### C. Menjalankan & Membangun `Nismara Companion`
Jalankan perintah berikut dari direktori `d:\Project\Nismara Transport\Project\nismara-tracker\nismara-companion`:
- **Mode Development (Hot-Reload)**:
  ```powershell
  npm run tauri dev
  ```
- **Kompilasi Standalone Release Installer (`.exe` / `.msi` di Windows, `.AppImage` / `.deb` di Linux, `.dmg` / `.app` di macOS)**:
  ```powershell
  npm run tauri build
  ```
  Binary hasil kompilasi akan berada di folder `src-tauri/target/release/` dan file setup installer di `src-tauri/target/release/bundle/`.

### D. Menjalankan & Memelihara Dedicated Tracker Server (`nismara-tracker-server`)
Jalankan perintah berikut dari direktori `D:\Project\Nismara Transport\Project\nismara-tracker-server`:
- **Mode Development (Hot-Reload)**:
  ```bash
  npm run dev
  ```
- **Mode Production (Node.js Direct)**:
  ```bash
  npm start
  ```
- **Mode Production 24/7 (PM2 Process Manager)**:
  Menggunakan `ecosystem.config.cjs` (format standar CommonJS untuk Node.js ESM) atau `ecosystem.js`:
  ```bash
  # Menjalankan server di background dengan PM2
  npm run pm2:start

  # Memantau log real-time
  npm run pm2:logs

  # Restart / Zero-downtime reload
  npm run pm2:restart
  npm run pm2:reload

  # Menghentikan server
  npm run pm2:stop

  # Membuka terminal dashboard CPU / Memory
  npm run pm2:monit
  ```
  Fitur otomatis di PM2 ecosystem: Auto-restart jika terjadi *unhandled crash*, batasan memori maksimum `500MB` (`max_memory_restart`), serta pencatatan log dengan timestamp terformat di folder `logs/pm2-error.log` dan `logs/pm2-out.log`.

---

## 8. Aturan Penting: DO & DON'T (Guardrails untuk AI Agent)

### DO (Yang Harus Dilakukan)
- **DO**: Gunakan arsitektur **Ultralight 2.0 WebKit (`src/ui/web_surface_bridge.cpp` + `phone-ui/` React 19)** sebagai renderer utama layar **Companion Phone (Nismara OS)** di dalam bezel `tablet_gui.cpp`, dengan fallback otomatis ke Dear ImGui jika runtime Ultralight tidak ditemukan.
- **DO**: Gunakan penamaan resmi **"Companion Phone"** dan **"Nismara OS"** (mengambil versi dari macro CMake `NISMARA_VERSION`).
- **DO**: Ambil data identitas truk (`brand_id`, `brand`, `id`, `name`, `license_plate`) dan gigi transmisi (`gear_displayed`, `gear_selected` $\rightarrow$ `gear_text`) **100% dari SCS Telemetry SDK (`src/core/scs_callbacks.cpp`)**, lalu panggil `TelemetryState::Get().MatchActiveFleet()`.
- **DO**: Filter daftar armada (`fleets`) di garasi sesuai game yang sedang berjalan (`ETS2` vs `ATS`), baik pada pencocokan armada (`MatchActiveFleet`), pengiriman telemetri (`web_surface_bridge.cpp`), maupun tampilan aplikasi `GarageApp.tsx`.
- **DO**: Gunakan pola `<div data-scroll-container="true" className="scroll-area"><div style={{ display: 'flex', flexDirection: 'column', ... }}>` pada seluruh layar aplikasi `phone-ui/` agar kartu tidak tertekan oleh Flexbox dan selalu dapat di-scroll dengan roda mouse hingga paling bawah.
- **DO**: Pertahankan kompilasi **single-binary (`NismaraTracker.dll` / `.so` / `.dylib`)** dengan static runtime (`/MT` pada MSVC) dan `/DELAYLOAD` untuk DLL Ultralight dari `%LOCALAPPDATA%\Nismara Companion\runtime`.
- **DO**: Utamakan kompatibilitas **Cross-Platform (Windows, Linux Proton/Native, dan macOS)** serta skala **~300+ pengguna** dengan direktori yang berbeda-beda di setiap perubahan kode.
- **DO**: Pertahankan protokol **Gatekeeper (`IsCompanionAppRunning()` via `Global\NismaraCompanionRunning` + Cross-Platform Heartbeat)** baik untuk membuka overlay `F11` maupun untuk **mencatat pekerjaan ke database (`scs_callbacks.cpp`: `/jobs/start`, `/jobs/complete`, `/jobs/cancel`)**. Jika aplikasi desktop `Nismara Companion` TIDAK dibuka, job TIDAK BOLEH tercatat. Jika `Nismara Companion` sedang berjalan di background, job WAJIB tetap tercatat otomatis meskipun layar HP in-game (`F11`) tertutup.
- **DO**: Selalu gunakan komunikasi HTTP asynchronous di thread terpisah (`ApiClient`) untuk seluruh request jaringan dari C++. Jangan pernah melakukan jaringan sinkron di dalam thread DirectX `Present` atau callback SCS SDK.
- **DO**: Gunakan `String(user.discordId)` dan `guildId: "863959415702028318"` saat melakukan query ke koleksi `currencies` dan `points`, serta `ObjectId(user._id)` saat melakukan query ke koleksi `fleets` dan `garages`.
- **DO**: Pertahankan mekanisme akumulasi damage (`job_accum_*`) dan batas maksimum jarak tempuh `+25%` dari `plannedDistanceKm` baik di sisi client C++ maupun di sisi server Node.js.
- **DO**: Selalu bungkus seluruh callback SCS Telemetry SDK (`scs_telemetry_init`, `scs_telemetry_shutdown`, `OnTelemetryConfiguration`, `OnTelemetryGameplayEvent`) dan seluruh entry point thread latar belakang (`std::thread`) dengan top-level `try { ... } catch (...) {}`. Uncaught exception yang lolos dari thread atau callback SCS SDK akan langsung memanggil `std::terminate()` dan mematikan game ETS2/ATS seketika tanpa dialog *crash*.
- **DO**: Pisahkan penanganan eksepsi Win32 SEH (`__try / __except`) ke dalam static helper fungsi murni (tanpa objek C++ yang memerlukan stack unwinding) jika digabungkan dengan C++ `try / catch`, untuk mencegah konflik kompilator MSVC `error C2712` dan `error C2713`.
- **DO**: Gunakan default constructor `ImFontConfig cfg;` saat memuat font di Dear ImGui, **jangan pernah** menggunakan zero-initialization `ImFontConfig cfg = {};` karena akan membuat `ExtraSizeScale = 0.0f` dan memicu floating-point division by zero di dalam rasterizer font atlas ImGui.

### DON'T (Yang Dilarang Dilakukan)
- **DON'T**: **Jangan pernah** memasang hook pada `IDirectInput8W::CreateDevice` (VTable index `3`) di `src/hooks/wndproc_hook.cpp`! Hooking `CreateDevice` akan menyebabkan game langsung **CRASH** ketika pengguna mencolokkan perangkat Joystick, Steering Wheel, atau Gamepad saat bermain. Hanya pasang hook pada `GetDeviceState` (index `9`) dan `GetDeviceData` (index `10`) pada device `GUID_SysMouse`.
- **DON'T**: **Jangan pernah** memaksa atau meng-hardcode nomor lambung truk (`fleet_number` seperti `NL-074`) apabila `has_matched_fleet == false`. Jika truk yang dipakai di game tidak cocok dengan daftar kepemilikan `fleets` user, truk tersebut adalah **Truk Sewa (`SEWA` / `[UNREGISTERED]`)**.
- **DON'T**: **Jangan pernah** membaca atau menebak truk aktif dari `game.log.txt`. Identitas truk wajib berasal 100% dari callback `SCS_TELEMETRY_EVENT_configuration` (`"truck"`) pada SCS Telemetry SDK.
- **DON'T**: **Jangan pernah** mengarang field atau fitur fiktif di UI `phone-ui/` yang tidak ada di `TelemetryState` atau `TabletGui` (gunakan pedoman informasi dari `src/ui/tablet_gui.cpp` dan `src/ui/web_surface_bridge.cpp`).
- **DON'T**: **Jangan pernah** mengalikan field `unfix_engine`, `unfix_transmission`, `unfix_brakes`, atau `unfix_tires` dari koleksi `fleets` dengan `100` di UI, karena nilai di database sudah berbentuk persentase `0–100` (misal `2.84` = `2.84%`).
- **DON'T**: **Jangan pernah** mengartikan field `maintenance.{engine,tires,transmission,brakes}` (`50000`, `20000`, `70000`, `35000`) sebagai jarak tempuh sejak servis; field tersebut adalah **Target Odometer Servis Berkala Berikutnya** (truk wajib servis saat odometer mencapai angka tersebut).
- **DON'T**: **Jangan pernah** menggunakan nama `"iPhone 16"` atau `"iOS 18"` di teks antarmuka pengguna; selalu gunakan **"Companion Phone"** dan **"Nismara OS"**.
- **DON'T**: **Jangan pernah** menghapus pemeriksaan `IsCompanionAppRunning()` pada pengiriman job di `src/core/scs_callbacks.cpp`. Job tidak boleh tercatat apabila aplikasi desktop `Nismara Companion` belum dibuka.
- **DON'T**: **Jangan pernah** mengandalkan path bundel tunggal pada Tauri v2 installer tanpa memeriksa folder `_up_/resources/`. Path relatif `"../resources/NismaraTracker.dll"` di `tauri.conf.json` akan diekstrak oleh WiX/NSIS ke dalam subfolder `_up_\resources\`. Pastikan helper Rust `find_bundled_plugin_source` memeriksa `_up_/resources/` serta file DLL diletakkan di `src-tauri/resources/`.
- **DON'T**: **Jangan pernah** menggunakan CEF Browser (`CefSharp`) atau WebSocket streaming untuk merender UI `tablet_gui`, karena akan membengkakkan ukuran instalasi ratusan megabyte dan menguras resource CPU/RAM pengguna.
- **DON'T**: **Jangan pernah** meng-hardcode path direktori lokal developer (seperti `F:\SteamLibrary\...`) atau token personal developer (`NSM-...`) sebagai default di kode client maupun companion app.
- **DON'T**: **Jangan pernah** menggunakan fallback `lastAuthenticatedUser` atau bypass autentikasi `isLocalRequest` di `nismara-tracker-server`, karena pada server produksi 24/7 yang melayani ~300 pengguna (terutama di balik reverse proxy), hal tersebut akan menyebabkan kebocoran/pencampuran sesi antar-driver.
- **DON'T**: **Jangan pernah** mengarahkan polling telemetri atau pengiriman job langsung ke domain Vercel (`beta.nismara.web.id` / website utama) secara terus-menerus. Selalu gunakan `nismara-tracker-server` mandiri (24/7) agar kuota serverless Vercel aman dari pembengkakan biaya (*overcost*).
- **DON'T**: **Jangan pernah** mengubah `CMAKE_MSVC_RUNTIME_LIBRARY` menjadi `/MD` (Dynamic DLL) pada build Windows, karena akan menyebabkan plugin gagal dimuat pada komputer driver yang belum menginstal VC++ Redistributable terbaru.
- **DON'T**: **Jangan pernah** menghapus atau melewati pemeriksaan Gatekeeper di `wndproc_hook.cpp` atau `tablet_gui.cpp`.
- **DON'T**: **Jangan pernah** melupakan pelepasan (`Release()`) `ID3D11RenderTargetView` di dalam hook `ResizeBuffers` (`src/hooks/dx11_hook.cpp`). Jika RTV tidak dilepas sebelum `ResizeBuffers` asli dipanggil, game ETS2/ATS akan langsung *crash* saat pengguna melakukan Alt-Tab atau mengubah resolusi layar.
- **DON'T**: **Jangan pernah** menggunakan karakter non-ASCII / simbol Unicode eksotis yang tidak didukung oleh subset glyph default Dear ImGui (`Segoe UI` ASCII/Latin-1 range) di dalam string UI C++, karena akan tampil sebagai tanda tanya (`?`). Gunakan teks bersih atau ikon vektor `ImDrawList`.
- **DON'T**: **Jangan pernah** mengandalkan pembacaan baris pertama hingga akhir pada `game.log.txt` untuk mendeteksi server multiplayer tanpa memprioritaskan modul DLL di memori (`haulmp_stub.dll` vs `core_ets2mp.dll`) dan urutan baris log paling bawah (*reverse scan*).

