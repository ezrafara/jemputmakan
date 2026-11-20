// Tes fungsional end-to-end: server dijalankan in-process dengan database in-memory.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { setClock } from '../src/util.js';
import { createServer } from '../server.js';
import { nextStatus, STATUS } from '../src/orders.js';
import { invalidate } from '../src/cache.js';
import { openPsqlDb } from './support/psql-db.js';

let srv, base, db;
// Waktu tetap: Jumat 20 Nov 2026 10:00 WIB agar semua merchant buka dan slot hari ini masih ada.
const FIXED = Date.UTC(2026, 10, 20, 3, 0, 0);

class Client {
  jar = {};
  async req(path, { method = 'GET', form, headers = {} } = {}) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form ? new URLSearchParams(form).toString() : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '') delete this.jar[k]; else this.jar[k] = v; }
    return { status: res.status, loc: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  async follow(path, opts) { let r = await this.req(path, opts); let n = 0; while (r.status === 303 && n++ < 5) r = await this.req(r.loc); return r; }
  login = (email, password = 'demo1234') => this.follow('/masuk', { method: 'POST', form: { email, password } });
}

before(async () => {
  setClock(() => FIXED);
  db = process.env.TEST_PSQL_URL ? await openPsqlDb(process.env.TEST_PSQL_URL) : await openDb(':memory:', null); // TEST_PSQL_URL: uji di PostgreSQL asli
  await seed(db); invalidate();
  srv = createServer(db, { quiet: true });
  return new Promise((ok) => srv.listen(0, () => { base = `http://localhost:${srv.address().port}`; ok(); }));
});
after(async () => { srv.close(); setClock(() => Date.now()); await db.close(); });

const slotFor = async (name) => (await db.get(`SELECT s.id FROM pickup_slot s JOIN merchant m ON m.id=s.merchant_id WHERE m.nama LIKE ? AND s.waktu_mulai > '2026-11-20T10:00' ORDER BY s.waktu_mulai LIMIT 1`, [name + '%'])).id;
const menuId = async (nama) => (await db.get('SELECT id FROM menu WHERE nama = ? ORDER BY id LIMIT 1', [nama])).id;

test('state machine: hanya transisi yang sah, tanpa status pengantaran', () => {
  assert.equal(nextStatus(STATUS.MENUNGGU, 'terima'), STATUS.DIPROSES);
  assert.equal(nextStatus(STATUS.DIPROSES, 'siap'), STATUS.SIAP);
  assert.equal(nextStatus(STATUS.SIAP, 'verifikasi'), STATUS.SELESAI);
  assert.equal(nextStatus(STATUS.MENUNGGU, 'batal'), STATUS.DIBATALKAN);
  assert.equal(nextStatus(STATUS.DIPROSES, 'batal'), null);
  assert.equal(nextStatus(STATUS.SELESAI, 'terima'), null);
  assert.equal(nextStatus(STATUS.MENUNGGU, 'siap'), null);
});

test('F1 Beranda menampilkan merchant, panduan self-pickup, dan header keamanan', async () => {
  const r = await new Client().req('/');
  assert.equal(r.status, 200);
  for (const s of ['Pesan dulu, ambil sendiri', 'Kantin Bu Sari – Teknik', 'Kopi Kampus Tadah', 'Ambil sendiri, kurangi emisi']) assert.ok(r.text.includes(s), s);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('F2 Pencarian merchant (nama/menu) dan filter kategori', async () => {
  const c = new Client();
  const a = await c.req('/?q=geprek'); assert.ok(a.text.includes('Geprek Mas Dimas') && !a.text.includes('Kopi Kampus Tadah'));
  const b = await c.req('/?q=zzzz'); assert.ok(b.text.includes('Tidak ada yang cocok'));
  const cat = (await db.get("SELECT id FROM category WHERE nama='Minuman'")).id;
  const d = await c.req('/?kat=' + cat); assert.ok(d.text.includes('Kopi Kampus Tadah'));
});

test('F3 Detail merchant menampilkan menu dan harga', async () => {
  const id = (await db.get("SELECT id FROM merchant WHERE nama LIKE 'Kantin Bu Sari%'")).id;
  const r = await new Client().req('/kedai/' + id);
  assert.ok(r.text.includes('Nasi Ayam Penyet') && r.text.includes('Rp 15.000') && r.text.includes('tidak ada pengantaran kurir'));
  assert.equal((await new Client().req('/kedai/99999')).status, 404);
});

test('Tamu yang menambah ke keranjang diarahkan masuk; merchant tidak bisa pakai halaman mahasiswa', async () => {
  const g = new Client(); const r = await g.req('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Nasi Ayam Penyet'), back: '/' } });
  assert.equal(r.status, 303); assert.match(r.loc, /^\/masuk/);
  const m = new Client(); await m.login('busari@jemputmakan.test');
  assert.equal((await m.req('/keranjang')).loc, '/panel');
});

test('Login: kata sandi salah ditolak, benar berhasil; pembatas percobaan aktif', async () => {
  const c = new Client();
  assert.equal((await c.req('/masuk', { method: 'POST', form: { email: 'ezra@student.ub.ac.id', password: 'salah' } })).status, 401);
  assert.equal((await c.req('/masuk', { method: 'POST', form: { email: 'ezra@student.ub.ac.id', password: 'demo1234' } })).status, 303);
  const x = new Client(); let last;
  for (let i = 0; i < 6; i++) last = await x.req('/masuk', { method: 'POST', form: { email: 'rl@x.id', password: 'salah' } });
  assert.equal(last.status, 429);
});

test('F4-F8 Alur lengkap: keranjang → checkout → konfirmasi merchant → siap → verifikasi kode → selesai', async () => {
  const s = new Client(); await s.login('faradila@student.ub.ac.id');
  await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Nasi Ayam Penyet'), back: '/' } });
  await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Nasi Ayam Penyet'), back: '/' } });
  await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Es Teh Manis'), back: '/' } });
  let cart = await s.req('/keranjang');
  assert.ok(cart.text.includes('Rp 34.000'), 'total 2×15.000 + 4.000');
  // satu merchant per keranjang
  const bad = await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Americano'), back: '/' } });
  assert.ok(bad.text.includes('hanya boleh berisi menu dari satu merchant'));
  // checkout
  const slot = await slotFor('Kantin Bu Sari');
  const co = await s.req('/checkout'); assert.ok(co.text.includes('Pilih waktu pengambilan'));
  const made = await s.req('/checkout', { method: 'POST', form: { slot_id: slot, titik_asal: 'FILKOM UB', catatan: 'tanpa sambal' } });
  assert.equal(made.status, 303);
  const id = Number(made.loc.split('/').pop());
  const o = (await db.get('SELECT * FROM orders WHERE id = ?', [id]));
  assert.equal(o.status, 'MENUNGGU_KONFIRMASI'); assert.equal(o.total_bayar, 34000); assert.match(o.pickup_code, /^JM-[A-Z2-9]{4}$/);
  assert.equal((await db.get('SELECT terpakai FROM pickup_slot WHERE id = ?', [slot])).terpakai, 1);
  const det = (await db.all('SELECT * FROM order_detail WHERE order_id = ?', [id])); assert.equal(det.length, 2);
  const detail = await s.follow('/pesanan/' + id); assert.ok(detail.text.includes(o.pickup_code) && detail.text.includes('0,0779 kgCO₂e'));
  // snapshot: ubah harga menu → riwayat tetap
  (await db.run("UPDATE menu SET harga = 99000 WHERE nama = 'Nasi Ayam Penyet'")); invalidate();
  assert.ok((await s.req('/pesanan/' + id)).text.includes('Rp 30.000'), 'harga snapshot 2×15.000 tetap');
  await db.run("UPDATE menu SET harga = 15000 WHERE nama = 'Nasi Ayam Penyet'"); invalidate();

  const m = new Client(); await m.login('busari@jemputmakan.test');
  const inbox = await m.req('/panel'); assert.ok(inbox.text.includes('Faradila Aurelia') && inbox.text.includes('tanpa sambal') && !inbox.text.includes(o.pickup_code), 'kode tidak dibocorkan ke merchant');
  await m.follow(`/panel/pesanan/${id}`, { method: 'POST', form: { aksi: 'siap' } });
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id])).status, 'MENUNGGU_KONFIRMASI', 'lompat status ditolak');
  await m.follow(`/panel/pesanan/${id}`, { method: 'POST', form: { aksi: 'terima' } });
  await m.follow(`/panel/pesanan/${id}`, { method: 'POST', form: { aksi: 'siap' } });
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id])).status, 'SIAP_DIAMBIL');
  const wrong = await m.req('/panel/verifikasi', { method: 'POST', form: { kode: 'JM-ZZZZ' } }); assert.equal(wrong.status, 404);
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id])).status, 'SIAP_DIAMBIL');
  const ok = await m.follow('/panel/verifikasi', { method: 'POST', form: { kode: o.pickup_code.toLowerCase() } });
  assert.ok(ok.text.includes('Pesanan selesai diserahkan'));
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id])).status, 'SELESAI');
  const prof = await s.req('/profil'); assert.ok(prof.text.includes('1 pesanan') && prof.text.includes('0,0779 kgCO₂e'));
  const hist = await s.req('/pesanan?tab=selesai'); assert.ok(hist.text.includes('Kantin Bu Sari'));
});

test('Batal oleh mahasiswa mengembalikan kuota; tidak bisa batal setelah diproses', async () => {
  const s = new Client(); await s.login('ezra@student.ub.ac.id');
  const slot = await slotFor('Geprek Mas Dimas');
  await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Ayam Geprek Original'), back: '/' } });
  const made = await s.req('/checkout', { method: 'POST', form: { slot_id: slot } });
  const id = Number(made.loc.split('/').pop());
  assert.equal((await db.get('SELECT terpakai FROM pickup_slot WHERE id=?', [slot])).terpakai, 1);
  await s.follow(`/pesanan/${id}/batal`, { method: 'POST', form: {} });
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id])).status, 'DIBATALKAN');
  assert.equal((await db.get('SELECT terpakai FROM pickup_slot WHERE id=?', [slot])).terpakai, 0);
  // pesan lagi, merchant terima, lalu coba batal
  await s.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Ayam Geprek Original'), back: '/' } });
  const id2 = Number((await s.req('/checkout', { method: 'POST', form: { slot_id: slot } })).loc.split('/').pop());
  const m = new Client(); await m.login('dimas@jemputmakan.test');
  await m.follow(`/panel/pesanan/${id2}`, { method: 'POST', form: { aksi: 'tolak' } });
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id2])).status, 'DITOLAK');
  assert.equal((await db.get('SELECT terpakai FROM pickup_slot WHERE id=?', [slot])).terpakai, 0, 'ditolak juga mengembalikan kuota');
  await s.follow(`/pesanan/${id2}/batal`, { method: 'POST', form: {} });
  assert.equal((await db.get('SELECT status FROM orders WHERE id=?', [id2])).status, 'DITOLAK');
});

test('Kuota slot penuh ditolak server (transaksi)', async () => {
  const slot = await slotFor('Pojok Snack');
  await db.run('UPDATE pickup_slot SET kuota = 1 WHERE id = ?', [slot]);
  const a = new Client(), b = new Client(); await a.login('faradila@student.ub.ac.id'); await b.login('ezra@student.ub.ac.id');
  for (const c of [a, b]) await c.follow('/keranjang/tambah', { method: 'POST', form: { menu_id: await menuId('Thai Tea'), back: '/' } });
  assert.match((await a.req('/checkout', { method: 'POST', form: { slot_id: slot } })).loc, /^\/pesanan\//);
  const r = await b.follow('/checkout', { method: 'POST', form: { slot_id: slot } });
  assert.ok(r.text.includes('Kuota slot yang dipilih sudah penuh'));
  assert.equal((await db.get('SELECT terpakai FROM pickup_slot WHERE id=?', [slot])).terpakai, 1);
});

test('Keamanan: pesanan orang lain → 404 (IDOR), total dihitung server, XSS di-escape, CSRF lintas situs ditolak', async () => {
  const a = new Client(); await a.login('faradila@student.ub.ac.id');
  const id = (await db.get("SELECT id FROM orders WHERE status='SELESAI' LIMIT 1")).id;
  const e = new Client(); await e.login('ezra@student.ub.ac.id');
  assert.equal((await e.req('/pesanan/' + id)).status, 404);
  const x = new Client();
  await x.follow('/daftar', { method: 'POST', form: { peran: 'mahasiswa', nama: '<script>alert(1)</script>', email: 'xss@x.id', password: 'rahasia123' } });
  const reg = await x.req('/profil');
  assert.ok(reg.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !reg.text.includes('<script>alert(1)'));
  const csrf = await a.req('/keranjang/kosongkan', { method: 'POST', headers: { origin: 'http://evil.example' } });
  assert.equal(csrf.status, 403);
});

test('Panel merchant: ubah ketersediaan menu langsung terlihat mahasiswa (cache di-invalidate)', async () => {
  const m = new Client(); await m.login('kopitadah@jemputmakan.test');
  const mid = await menuId('Americano');
  const kid = (await db.get("SELECT id FROM merchant WHERE nama LIKE 'Kopi Kampus%'")).id;
  assert.ok(!(await new Client().req('/kedai/' + kid)).text.includes('Habis'));
  await m.follow(`/panel/menu/${mid}/toggle`, { method: 'POST', form: {} });
  assert.ok((await new Client().req('/kedai/' + kid)).text.includes('Habis'));
  // validasi form menu
  const bad = await m.follow('/panel/menu', { method: 'POST', form: { nama: 'X', harga: '-5', category_id: '1' } });
  assert.ok(bad.text.includes('Nama menu 2–60 karakter'));
  const add = await m.follow('/panel/menu', { method: 'POST', form: { nama: 'Latte Hazelnut', harga: '19000', category_id: '2' } });
  assert.ok(add.text.includes('Latte Hazelnut'));
});

test('Panel merchant: kelola slot dan pengaturan kedai', async () => {
  const m = new Client(); await m.login('yati@jemputmakan.test');
  const bad = await m.follow('/panel/slot', { method: 'POST', form: { tanggal: '2026-11-20', mulai: '05:00', selesai: '06:00', kuota: '3' } });
  assert.ok(bad.text.includes('jam operasional'));
  const ok = await m.follow('/panel/slot', { method: 'POST', form: { tanggal: '2026-11-21', mulai: '14:10', selesai: '14:20', kuota: '2' } });
  assert.ok(ok.text.includes('Slot ditambahkan'));
  const dup = await m.follow('/panel/slot', { method: 'POST', form: { tanggal: '2026-11-21', mulai: '14:10', selesai: '14:20', kuota: '2' } });
  assert.ok(dup.text.includes('Sudah ada slot dengan jam mulai yang sama'));
  const t = await m.follow('/panel/toko', { method: 'POST', form: { nama: 'Warung Pecel Bu Yati', lokasi: 'FILKOM', buka: '06:30', tutup: '15:00' } });
  assert.ok(t.text.includes('Pengaturan kedai disimpan'));
  const closed = await new Client().req('/'); assert.ok(closed.text.includes('Tutup'));
});

test('Dampak: angka studi kasus tampil (0,3075 kgCO₂e) beserta batasan klaim; kalkulator dasar', async () => {
  const r = await new Client().req('/dampak?titik=semua&n=100&ongkir=8000&layanan=3000');
  for (const s of ['0,3075 kgCO₂e', '0,1025 kgCO₂e', '10,250 kgCO₂e', '123,0 kgCO₂e', 'Rp 1.100.000', 'konsekuensi langsung', '70%', 'SWDM v4']) assert.ok(r.text.includes(s), s);
  const sw = await new Client().req('/dampak?kb=1000000&nvr=0.75&dcr=0.02'); assert.ok(sw.text.includes('147,4590 gCO₂e'), 'SWDM 1 GB');
});

test('Hijau: respons terkompresi, ETag → 304, aset ber-hash immutable', async () => {
  const r = await fetch(base + '/', { headers: { 'accept-encoding': 'br' } });
  assert.equal(r.headers.get('content-encoding'), 'br');
  const et = r.headers.get('etag'); await r.arrayBuffer();
  const r2 = await fetch(base + '/', { headers: { 'accept-encoding': 'br', 'if-none-match': et } });
  assert.equal(r2.status, 304);
  const css = (await (await fetch(base + '/', { headers: { 'accept-encoding': 'identity' } })).text()).match(/href="(\/assets\/style\.[0-9a-f]+\.css)"/)[1];
  const a = await fetch(base + css); assert.match(a.headers.get('cache-control'), /immutable/);
});
