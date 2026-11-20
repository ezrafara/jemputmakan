# Pengujian dan Pengukuran

## 1. Pengujian fungsionalitas (Bab 4.3.1)

Dijalankan otomatis dengan `npm test` (server in-process, SQLite in-memory, jam tetap 20 Nov 2026 10.00 WIB): **25 tes lulus, 4 tes khusus PostgreSQL dilewati**. Rangkaian yang sama dijalankan pada **PostgreSQL 16 asli** dengan `npm run test:pg`: **18 tes lulus** (14 tes aplikasi + 4 tes PostgreSQL: skema + seed, RLS aktif di semua tabel, ROLLBACK dan kode error 23505, `ON CONFLICT` di dalam transaksi). Tes otomatis tidak menggantikan uji manual oleh pengguna sungguhan; sebaiknya kelompokmu tetap mencoba alurnya di browser dan menambahkan catatan sendiri.

| No | Fitur | Skenario | Hasil yang diharapkan | Hasil aktual |
|---|---|---|---|---|
| 1 | Beranda | Membuka halaman utama | Informasi merchant, panduan 3 langkah, penanda self-pickup tampil | Berhasil |
| 2 | Pencarian merchant | Kata kunci `geprek`; kata kunci tak ada; filter kategori | Merchant sesuai tampil; pesan "tidak ada yang cocok"; filter bekerja | Berhasil |
| 3 | Detail menu | Membuka merchant | Menu, harga, ketersediaan tampil; id tak dikenal → 404 | Berhasil |
| 4 | Keranjang | Tambah produk; tambah dari merchant lain | Total benar (2×15.000 + 4.000 = Rp 34.000); menu merchant lain ditolak dengan pesan | Berhasil |
| 5 | Checkout | Pilih slot, buat pesanan | Pesanan `MENUNGGU_KONFIRMASI`, kode `JM-XXXX`, kuota slot bertambah, snapshot nama & harga tersimpan | Berhasil |
| 6 | Status pesanan | Merchant terima → siap → verifikasi kode | Status berubah sesuai alur; lompat status ditolak; kode salah ditolak; kode benar → `SELESAI` | Berhasil |
| 7 | Pengelolaan merchant | Tandai menu habis, tambah menu, kelola slot, pengaturan kedai | Perubahan langsung terlihat mahasiswa (cache di-invalidate); validasi form bekerja | Berhasil |
| 8 | Pembatalan | Batal saat menunggu; tolak oleh merchant; batal setelah ditolak | Kuota slot dikembalikan; status akhir tidak bisa diubah | Berhasil |
| 9 | Kuota slot | Dua pesanan ke slot berkuota 1 | Pesanan kedua ditolak, kuota tidak melebihi batas | Berhasil |
| 10 | Keamanan | Akses pesanan orang lain; input `<script>`; POST lintas situs; 6× login salah | 404; di-escape; 403; 429 | Berhasil |
| 11 | Perhitungan CO₂e | Nilai studi kasus Bab 4.2 | 0,0779 / 0,1230 / 0,1066 → total 0,3075 kgCO₂e; rata-rata 0,1025; 100% | Berhasil |
| 12 | Perhitungan SWDM v4 | 1 GB, CI 494 | 148,2 gCO₂e; rumus C_pageview dan GHF benar | Berhasil |

Fitur yang berhasil: seluruh 7 skenario di tabel Bab 4.3.1 laporan. Belum tercakup: pengujian dengan pengguna nyata, banyak perangkat/browser, dan beban tinggi.

### Uji asap setelah deploy ke Supabase + Vercel (dilakukan manual)

Koneksi nyata ke Supabase dan Vercel tidak dapat diuji dari lingkungan pengembangan. Setelah deploy pertama, cek: (1) beranda menampilkan 5 merchant; (2) masuk sebagai `faradila@student.ub.ac.id`; (3) alur pesan → merchant terima → siap → verifikasi kode berhasil; (4) di Supabase → Table Editor tabel `orders` bertambah; (5) di Supabase, panggilan REST anon ke tabel (mis. `/rest/v1/user`) ditolak/kosong karena RLS; (6) Vercel → Logs tidak menampilkan error koneksi.

## 2. Transfer data per halaman (Bab 4.2.2)

Diukur dengan `npm run measure` (Chrome via Playwright; ukuran badan + header respons yang diterima; kunjungan pertama = cache kosong, kunjungan ulang = aset dari cache). Lingkungan **lokal**, kompresi brotli aktif, bukan server produksi. Emisi dihitung dengan SWDM v4 (NVR/RVR/DCR bawaan, CI 494 gCO₂e/kWh, GHF 0).

| Halaman | Transfer awal (MB) | Transfer kunjungan ulang (MB) | gCO₂e per page view (awal) |
|---|---|---|---|
| Beranda | 0,0082 | 0,0005 | 0,0012 |
| Detail Merchant | 0,0082 | 0,0005 | 0,0012 |
| Keranjang | 0,0078 | 0,0005 | 0,0011 |
| Checkout | 0,0080 | 0,0005 | 0,0012 |
| Pesanan (riwayat) | 0,0075 | 0,0005 | 0,0011 |
| Profil | 0,0077 | 0,0005 | 0,0011 |
| Dampak | 0,0093 | 0,0005 | 0,0014 |
| **Total** | **0,0565** | **0,0038** | **0,0083** |

Detail Pesanan tidak diukur otomatis karena butuh id pesanan; ukur manual lewat DevTools → Network bila diperlukan. Ulangi pengukuran di server hasil deploy sebelum dimasukkan ke laporan final.

## 3. Performance testing (Bab 4.3.2)

Lighthouse **belum dijalankan** (tidak tersedia di lingkungan pengembangan). Jalankan di Chrome: DevTools → Lighthouse, atau https://pagespeed.web.dev pada URL hasil deploy, lalu isi:

| Indikator | Hasil |
|---|---|
| Performance | [isi] |
| Accessibility | [isi] |
| Best Practices | [isi] |
| SEO | [isi] |
| FCP / LCP / TBT / CLS | [isi] |

Catatan desain yang relevan: tanpa gambar dan JS berat, kontras warna dan label form dirancang mengikuti WCAG AA, tap target ≥ 44 px, namun skor aktual harus diukur, bukan diasumsikan. Skor performa tidak langsung menunjukkan besarnya pengurangan emisi.
