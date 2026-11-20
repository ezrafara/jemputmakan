// Mengukur ukuran transfer data per halaman (kunjungan pertama vs ulang) dan estimasi emisi digital SWDM v4.
// Memakai Chrome lewat Playwright (opsional). Jalankan server dulu: npm start, lalu: npm run measure
// Hasil adalah estimasi pada lingkungan lokal, bukan jejak karbon server produksi.
import { swdmPageView } from '../src/carbon.js';
const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.EMAIL || 'faradila@student.ub.ac.id';
let chromium; try { ({ chromium } = await import(process.env.PLAYWRIGHT || 'playwright')); } catch { console.error('Playwright tidak ditemukan. Set PLAYWRIGHT=/path/ke/playwright/index.mjs atau ukur manual via DevTools → Network.'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const pages = [['Beranda', '/'], ['Detail Merchant', '/kedai/1'], ['Keranjang', '/keranjang'], ['Checkout', '/checkout'], ['Pesanan (riwayat)', '/pesanan'], ['Profil', '/profil'], ['Dampak', '/dampak']];
// kunjungan pertama = konteks baru tanpa cache; kunjungan ulang = halaman yang sama di konteks yang sama
const rows = [];
for (const [nama, path] of pages) {
  // 1) login & siapkan keranjang di konteks sementara, simpan cookie sesi
  const c1 = await browser.newContext(); const p1 = await c1.newPage();
  await p1.goto(BASE + '/masuk'); await p1.fill('input[name=email]', EMAIL); await p1.fill('input[name=password]', 'demo1234'); await p1.click('button.btn'); await p1.waitForLoadState('networkidle');
  await p1.goto(BASE + '/kedai/1'); await p1.click('form[action="/keranjang/tambah"] button >> nth=0');
  const state = await c1.storageState(); await c1.close();
  // 2) konteks baru dengan cookie tadi tetapi cache browser KOSONG = kunjungan pertama yang sebenarnya
  const c2 = await browser.newContext({ storageState: state }); const p2 = await c2.newPage(); let b = 0;
  p2.on('requestfinished', async (r) => { try { const s = await r.sizes(); b += s.responseBodySize + s.responseHeadersSize; } catch { /* abaikan */ } });
  await p2.goto(BASE + path, { waitUntil: 'networkidle' }); const first = b;
  b = 0; await p2.goto(BASE + path, { waitUntil: 'networkidle' }); const again = b; // kunjungan ulang: aset dari cache, HTML cukup 304
  rows.push({ nama, first, again }); await c2.close();
}
await browser.close();
const mb = (n) => (n / 1e6).toFixed(4).replace('.', ',');
console.log('| Halaman | Transfer awal (MB) | Transfer kunjungan ulang (MB) | gCO2e per page view (awal) |\n|---|---|---|---|');
let tf = 0, ta = 0;
for (const r of rows) { tf += r.first; ta += r.again; console.log(`| ${r.nama} | ${mb(r.first)} | ${mb(r.again)} | ${swdmPageView(r.first).toFixed(4).replace('.', ',')} |`); }
console.log(`| **Total** | **${mb(tf)}** | **${mb(ta)}** | **${swdmPageView(tf).toFixed(4).replace('.', ',')}** |`);
console.log(`\nRata-rata per page view: ${swdmPageView(tf / rows.length).toFixed(4)} gCO2e (kunjungan pertama), NVR/RVR/DCR bawaan, CI 494 gCO2e/kWh, GHF 0.`);
