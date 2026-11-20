# JemputMakan

Aplikasi web **pre-order + self-pickup** untuk mahasiswa di sekitar Universitas Brawijaya. Pesan makanan dari warung/kafe dekat kampus sebelum datang, lalu jemput sendiri dengan berjalan kaki. Tidak ada layanan kurir. Proyek akhir mata kuliah Sistem Informasi Berkelanjutan.

## Menjalankan lokal

Syarat: **Node.js ≥ 22.5**. Dua mode database, otomatis dipilih dari `DATABASE_URL`:

| Mode | Kapan | Perintah |
|---|---|---|
| **SQLite** (bawaan Node, tanpa instalasi) | Pengembangan lokal dan tes cepat | `npm start` → http://localhost:3000 (database + data demo dibuat otomatis) |
| **PostgreSQL / Supabase** | Produksi (Vercel) | `npm install`, isi `DATABASE_URL`, lalu `npm start` |

```bash
npm start          # server lokal
npm run seed       # reset SQLite lokal ke data demo
npm test           # 25 tes (SQLite); 4 tes khusus PostgreSQL dilewati
npm run test:pg    # tes yang sama + tes PostgreSQL pada PostgreSQL asli (cluster sementara, butuh binary PostgreSQL)
npm run build      # buat ulang aset ber-hash di public/assets (jalankan setelah mengubah assets/*)
```

Akun demo (kata sandi `demo1234`):

| Peran | Email |
|---|---|
| Mahasiswa | `faradila@student.ub.ac.id`, `ezra@student.ub.ac.id` |
| Merchant | `busari@jemputmakan.test` (Kantin Bu Sari – Teknik), `kopitadah@…`, `yati@…`, `dimas@…`, `pojokfeb@…` (`@jemputmakan.test`) |

Variabel lingkungan: lihat `.env.example` (`DATABASE_URL`, `PG_POOL_MAX`, `CACHE_TTL_MS`, `PORT`, `DB_FILE`).

## Deploy: Supabase (database) + Vercel (aplikasi)

### 1. Supabase
1. Buat project di https://supabase.com. Pilih region yang dekat pengguna (mis. Singapore) dan catat **database password**.
2. Buat tabel: buka **SQL Editor**, tempel seluruh isi `supabase/migrations/0001_init.sql`, lalu **Run**. (Alternatif: `DATABASE_URL=<session pooler> npm run db:migrate`.) File ini mengaktifkan **Row Level Security** pada semua tabel tanpa policy dan mencabut hak role `anon`/`authenticated`, sehingga API otomatis Supabase (PostgREST) tidak bisa membaca data. Aplikasi memakai koneksi langsung ke database, jadi tidak terpengaruh.
3. Ambil connection string: klik **Connect** di dashboard.
   - **Untuk Vercel**: **Transaction pooler** (port 6543). Wajib, karena Vercel tidak mendukung koneksi langsung IPv6.
   - **Untuk migrasi/seed dari laptop**: **Session pooler** (port 5432).
4. Isi data demo (opsional, sekali saja): `npm install` lalu `DATABASE_URL="<session pooler>" npm run seed`. Seed melewati proses bila tabel `user` sudah berisi data.

### 2. Vercel
1. Push proyek ke GitHub, lalu **Add New → Project** di Vercel dan impor repositori. Framework Preset: **Other** (konfigurasi sudah ada di `vercel.json`).
2. **Environment Variables**: `DATABASE_URL` = connection string *Transaction pooler* (ganti `[YOUR-PASSWORD]`). Bila memakai kata sandi dengan karakter khusus, encode URL.
3. **Settings → Functions → Function Region**: pilih region terdekat dengan database Supabase (mis. Singapore) supaya latensi query kecil.
4. **Deploy**. Buka URL-nya; coba masuk dengan akun demo.

Cara kerjanya: `vercel.json` mengirim semua rute ke satu fungsi (`api/index.js`), sedangkan `public/assets/*` (CSS/JS ber-hash, cache immutable) disajikan langsung oleh CDN Vercel.

### Catatan produksi
- **Ganti kata sandi demo** atau hapus akun demo sebelum dipublikasikan. Kata sandi disimpan sebagai hash scrypt.
- **Cache per instance**: daftar merchant/menu di-cache 20 detik per instance serverless. Perubahan merchant bisa tertunda sebesar itu di instance lain; checkout selalu memvalidasi ke database sehingga pesanan tetap benar.
- **Pembatas login** tersimpan di database (tabel `login_attempt`), jadi konsisten antar instance.
- **Slot harian** dibuat otomatis oleh request pertama tiap hari (idempoten, aman dijalankan bersamaan). Untuk beban nyata, pertimbangkan Vercel Cron.
- Pembayaran tetap simulasi (bayar di tempat).

## Fitur

**Mahasiswa**: cari merchant (nama/lokasi/menu) dan filter kategori · detail merchant, menu, harga, ketersediaan · keranjang (satu merchant per keranjang) · pilih slot pengambilan · kode pengambilan unik (`JM-XXXX`) · status & riwayat pesanan (dimuat bertahap) · batalkan selama belum dikonfirmasi · profil dengan kartu "Kontribusi Ramah Lingkungan" · mode terang/gelap.

**Merchant** (`/panel`): pesanan masuk (terima/tolak/proses/siap) · verifikasi kode saat pelanggan datang · kelola menu & ketersediaan · kelola slot & kuota · pengaturan kedai.

**Dampak** (`/dampak`): perbandingan emisi delivery motor vs self-pickup (studi kasus Bab 4.2), kalkulator ekstrapolasi + penghematan biaya, kalkulator emisi digital SWDM v4, dan batasan klaim.

**Alur status**: `MENUNGGU_KONFIRMASI → DIPROSES → SIAP_DIAMBIL → SELESAI`, cabang `DITOLAK` / `DIBATALKAN`. Divalidasi di server (`src/orders.js`).

## Struktur

```
server.js              handler HTTP (lokal + serverless): kompresi, ETag, header keamanan, routing
api/index.js           entry fungsi serverless Vercel
vercel.json            rewrite ke fungsi, cache aset immutable
db/schema.js           satu sumber skema (SQLite & PostgreSQL) + RLS Supabase
supabase/migrations/   0001_init.sql (dibuat dari db/schema.js: npm run db:sql)
src/db.js              lapisan DB async: PostgreSQL (pg) atau SQLite, transaksi
src/orders.js          state machine, createOrder (transaksi + snapshot), verifikasi kode
src/carbon.js          fungsi murni CO2e: transportasi + SWDM v4 + biaya
src/routes_public.js   auth, beranda, merchant, keranjang, checkout, pesanan, profil, dampak
src/routes_panel.js    panel merchant
src/views.js, helpers.js, util.js, cache.js, auth.js, seed.js
assets/                sumber CSS (±13 KB, ±3 KB terkompresi) dan JS (±0,4 KB, hanya toggle tema)
public/                hasil build: assets/ ber-hash + favicon (disajikan CDN)
tests/                 carbon, app (end-to-end), pg (PostgreSQL), vercel; support/psql-db.js
scripts/measure.mjs    ukur transfer data per halaman + estimasi gCO2e
GREEN_CODING.md        bukti penerapan Green Software Engineering (Bab 4.1.3)
TESTING.md             hasil pengujian fungsional, performa, dan pengukuran data
```

## Skema database (ERD)

`USER`, `MERCHANT`, `CATEGORY`, `MENU`, `PICKUP_SLOT`, `ORDERS`, `ORDER_DETAIL` sesuai laporan (tabel `"user"` ditulis dengan tanda kutip karena `user` kata kunci di PostgreSQL). `nama_menu_snapshot` dan `harga_snapshot` disalin ke `ORDER_DETAIL` saat checkout. Tambahan teknis di luar 7 entitas: `session` (login + keranjang), `login_attempt` (pembatas login), dan `merchant_distance` (jarak referensi per titik asal untuk estimasi CO2e; kolom `sumber` membedakan data **studi kasus laporan** dari **contoh demo**). Tanggal/jam disimpan sebagai teks WIB `YYYY-MM-DDTHH:MM` agar perilakunya identik di SQLite dan PostgreSQL.

Konkurensi: pembuatan pesanan memakai transaksi dengan `SELECT … FOR UPDATE` pada baris slot (PostgreSQL) sehingga kuota tidak bisa terlampaui oleh dua pesanan bersamaan.

## Data demo dan asumsi

- Jarak Kantin Bu Sari – Teknik (FILKOM 0,95/1,50 km, FK 1,50/1,30 km, FEB 1,30/0,90 km, motor/jalan kaki) berasal dari laporan. **Merchant lain, nama, alamat, harga menu, dan jaraknya adalah contoh demo**; ganti dengan data nyata sebelum dipakai di laporan.
- Alamat Kantin Bu Sari di seed hanya contoh; sesuaikan.
- Ongkir (Rp 8.000) dan biaya layanan (Rp 3.000) di kalkulator hanyalah nilai contoh yang bisa diubah.
- Pembayaran **disimulasikan** ("bayar di tempat"); tidak ada payment gateway.

## Catatan teknis

Aplikasi sengaja tanpa framework: Node murni, HTML dirender di server, CSS tulis tangan, satu-satunya dependensi produksi adalah `pg`. Itu menjaga halaman ±8 KB dan selaras dengan prinsip Green Software. Hal yang **sudah diuji**: seluruh logika dan SQL pada PostgreSQL 16 asli (lewat `psql`), serta perilaku body request ala Vercel. Hal yang **belum bisa diuji dari lingkungan pengembangan** (tanpa akses jaringan): koneksi nyata ke Supabase memakai driver `pg` (pengikatan parameter `$1..$n`, SSL, pooler) dan deploy sungguhan di Vercel. Lakukan uji asap setelah deploy pertama (lihat `TESTING.md`).
