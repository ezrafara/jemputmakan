# Bukti Green Software Engineering (Bab 4.1.3)

Setiap butir menunjuk lokasi kode. Hasil pengukuran ada di `TESTING.md`.

## 1. Optimasi aset digital
- **Tanpa gambar, font, atau library eksternal.** Ikon berupa SVG inline (`src/views.js`), font memakai system font stack. Total aset klien: `style.css` ±13 KB dan `app.js` ±0,4 KB (sebelum kompresi; ±3 KB dan ±0,3 KB setelah brotli/gzip).
- **Tidak ada framework JavaScript di klien.** Seluruh halaman dirender di server; satu-satunya JS adalah toggle tema (`public/app.js`).
- Bila nanti menambah foto menu: pakai WebP/AVIF ≤ ±40 KB dan `<img loading="lazy" decoding="async" width height>`. Saat ini belum ada gambar sehingga tidak ada transfer gambar.

## 2. Kompresi dan caching
`server.js`:
```js
// Aset statis dibuat ber-hash saat build (`scripts/build-assets.mjs`) dan disajikan CDN Vercel dengan cache 1 tahun (`vercel.json`); saat lokal dikompres sekali (brotli q11 + gzip)
cache: hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'
// HTML dinamis: brotli/gzip sesuai Accept-Encoding + ETag → 304 untuk kunjungan ulang
if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
```
`src/cache.js` + `src/helpers.js`: daftar merchant, kategori, menu, dan jarak di-cache di memori (TTL 60 dtk) dan **di-invalidate** saat merchant mengubah menu/slot/kedai (`invalidate()` di `src/routes_panel.js`). Pencarian dan filter kategori dikerjakan atas data cache, tanpa query tambahan.

## 3. Efisiensi akses basis data
`db/schema.js` (index pada kolom yang dicari/difilter):
```sql
CREATE INDEX idx_menu_merchant ON menu(merchant_id, category_id);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_merchant_status ON orders(merchant_id, status, created_at DESC);
```
- Tidak ada N+1 pada daftar pesanan: jumlah item dihitung lewat subquery dalam satu `SELECT` (`/pesanan` di `src/routes_public.js`).
- Riwayat pesanan **dimuat bertahap** (`LIMIT n+1`, tombol "Muat lagi") alih-alih seluruh riwayat.
- Hanya kolom yang dibutuhkan yang di-`SELECT` pada halaman daftar.
- Pembuatan pesanan memakai satu transaksi dengan `SELECT … FOR UPDATE` pada slot (`src/orders.js`).
- Pembuatan slot harian memakai satu query pemeriksaan + `INSERT` multi-baris (`src/seed.js` → `ensureSlots`) agar sedikit round-trip ke database jarak jauh; daftar item pesanan merchant diambil dengan satu query `IN (...)`, bukan satu per pesanan.
- Pool koneksi kecil per instance serverless (`PG_POOL_MAX`, default 3) dan lewat Supabase Transaction pooler agar tidak menghabiskan koneksi.

## 4. Antarmuka ringan dan hemat daya
- Mode terang/gelap dengan `prefers-color-scheme` + pilihan tersimpan; dark mode dijelaskan jujur sebagai membantu layar OLED saja (halaman Profil).
- Tanpa animasi dekoratif, tanpa autoplay, `prefers-reduced-motion` dihormati (`public/style.css`).
- Tanpa polling/auto-refresh: status pesanan diperbarui saat pengguna memuat ulang, bukan lewat permintaan berulang.
- Navigasi sederhana: Beranda, Pesanan, Keranjang, Profil.

## 5. Pemuatan data seperlunya
Setiap halaman hanya mengambil data miliknya; checkout hanya memuat slot yang masih tersedia (`LIMIT 24`); riwayat pesanan bertahap.

## 6. Transparansi jejak digital
Footer setiap halaman menampilkan perkiraan ukuran transfer (HTML terkompresi + CSS + JS) dan estimasi gCO₂e per tampilan memakai SWDM v4 (`src/carbon.js` → `swdmPageView`, dipasang di `server.js`). Halaman `/dampak` memuat kalkulator lengkapnya. Semuanya berlabel **estimasi**.

## Batasan yang perlu disebut di laporan
- Optimasi aplikasi tidak otomatis membuktikan penurunan emisi; yang diukur adalah transfer data dan estimasinya.
- Pengukuran dilakukan di lingkungan lokal, bukan server produksi; GHF diasumsikan 0 karena hosting hijau belum terverifikasi.
