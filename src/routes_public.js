import { html, raw, esc, rupiah, num, AppError, clampInt, clampNum, nowWIB, slotLabel, createdLabel, tanggalLabel } from './util.js';
import { hashPassword, verifyPassword, createSession, saveCart, loginBlocked, loginFailed, loginOk } from './auth.js';
import { invalidate } from './cache.js';
import { isUniqueViolation } from './db.js';
import { createOrder, applyAction, STATUS, STATUS_LABEL } from './orders.js';
import { emisiDelivery, deltaTransport, persenPengurangan, FE_MOTOR, swdmPageView, swdmBase, swdmKomponen, SWDM, CI_GLOBAL, DEFAULTS, bandingBiaya } from './carbon.js';
import { layout, icon, merchantCard, statusBadge, openBadge, emptyState, field, pageTitle } from './views.js';
import { page, redirect, safeNext, getCategories, getMerchants, getMerchant, withOpen, getMenus, getDistances, jarakMotor, cartLines } from './helpers.js';
import { ensureSlots } from './seed.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const kg = (v, d = 4) => num(v, d) + ' kgCO₂e';

// ================= Autentikasi =================
function loginForm(ctx, { email = '', next = '' } = {}) {
  return page(ctx, 'Masuk', html`<div class="narrow">${pageTitle('Masuk', 'Masuk untuk memesan atau mengelola kedai.')}
  <form method="post" action="/masuk" class="card form">
    <input type="hidden" name="next" value="${next}">
    ${field('Email', html`<input type="email" name="email" value="${email}" required autocomplete="email">`)}
    ${field('Kata sandi', html`<input type="password" name="password" required autocomplete="current-password">`)}
    <button class="btn">Masuk</button>
    <p class="muted small">Belum punya akun? <a href="/daftar">Daftar</a> · Akun demo: <code>faradila@student.ub.ac.id</code> / <code>demo1234</code></p>
  </form></div>`);
}
export const routes = [];
const R = (method, path, handler, auth = null) => routes.push({ method, path, handler, auth });

R('GET', '/masuk', async (ctx) => ctx.user ? redirect(ctx.user.role === 'MERCHANT' ? '/panel' : '/') : loginForm(ctx, { next: safeNext(ctx.url.searchParams.get('next')) || '' }));
R('POST', '/masuk', async (ctx) => {
  const { email = '', password = '', next = '' } = ctx.form;
  const key = `${ctx.ip}|${email.toLowerCase()}`;
  if (await loginBlocked(ctx.db, key)) return { ...loginForm(ctx, { email, next }), status: 429, flash: { type: 'error', msg: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' } };
  const u = (await ctx.db.get('SELECT * FROM "user" WHERE email = ?', [email.trim().toLowerCase()]));
  if (!u || !verifyPassword(password, u.password_hash)) {
    await loginFailed(ctx.db, key);
    const r = loginForm({ ...ctx, flash: { type: 'error', msg: 'Email atau kata sandi salah.' } }, { email, next });
    return { ...r, status: 401 };
  }
  await loginOk(ctx.db, key);
  const sid = await createSession(ctx.db, u.id);
  const to = u.role === 'MERCHANT' ? '/panel' : (safeNext(next) || '/');
  return { ...redirect(to, { type: 'ok', msg: `Halo, ${u.nama}!` }), setSid: sid };
});

function registerForm(ctx, v = {}, status = 200, flash) {
  const merchant = v.peran === 'merchant';
  return { ...page({ ...ctx, flash: flash || ctx.flash }, 'Daftar', html`<div class="narrow">${pageTitle('Buat akun', 'Gratis. Pilih peranmu.')}
  <div class="tabs" role="tablist"><a class="tab${merchant ? '' : ' active'}" href="/daftar">Mahasiswa</a><a class="tab${merchant ? ' active' : ''}" href="/daftar?peran=merchant">Merchant (warung/kafe)</a></div>
  <form method="post" action="/daftar" class="card form">
    <input type="hidden" name="peran" value="${merchant ? 'merchant' : 'mahasiswa'}">
    ${field('Nama', html`<input name="nama" value="${v.nama || ''}" required minlength="2" maxlength="60" autocomplete="name">`)}
    ${field('Email', html`<input type="email" name="email" value="${v.email || ''}" required autocomplete="email">`)}
    ${field('Kata sandi', html`<input type="password" name="password" required minlength="8" autocomplete="new-password">`, 'Minimal 8 karakter.')}
    ${merchant ? html`
      ${field('Nama kedai', html`<input name="kedai" value="${v.kedai || ''}" required maxlength="60">`)}
      ${field('Lokasi pengambilan', html`<input name="lokasi" value="${v.lokasi || ''}" required maxlength="120" placeholder="mis. Gedung Fakultas Teknik UB">`)}
      <div class="two">${field('Jam buka', html`<input type="time" name="buka" value="${v.buka || '08:00'}" required>`)}${field('Jam tutup', html`<input type="time" name="tutup" value="${v.tutup || '16:00'}" required>`)}</div>` : ''}
    <button class="btn">Daftar</button>
    <p class="muted small">Sudah punya akun? <a href="/masuk">Masuk</a></p>
  </form></div>`), status };
}
R('GET', '/daftar', async (ctx) => ctx.user ? redirect('/') : registerForm(ctx, { peran: ctx.url.searchParams.get('peran') }));
R('POST', '/daftar', async (ctx) => {
  const f = ctx.form; const merchant = f.peran === 'merchant';
  const v = { ...f, peran: merchant ? 'merchant' : 'mahasiswa' };
  const err = (m) => registerForm(ctx, v, 400, { type: 'error', msg: m });
  const nama = (f.nama || '').trim(), email = (f.email || '').trim().toLowerCase();
  if (nama.length < 2 || nama.length > 60) return err('Nama harus 2–60 karakter.');
  if (!EMAIL.test(email)) return err('Format email tidak valid.');
  if ((f.password || '').length < 8) return err('Kata sandi minimal 8 karakter.');
  if ((await ctx.db.get('SELECT 1 FROM "user" WHERE email = ?', [email]))) return err('Email sudah terdaftar.');
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (merchant) {
    if (!(f.kedai || '').trim() || !(f.lokasi || '').trim()) return err('Nama kedai dan lokasi wajib diisi.');
    if (!hm.test(f.buka || '') || !hm.test(f.tutup || '') || f.buka >= f.tutup) return err('Jam buka harus lebih awal dari jam tutup.');
  }
  let uid;
  try {
    uid = await ctx.db.tx(async (db) => {
      const id = (await db.get('INSERT INTO "user" (nama, email, password_hash, role, created_at) VALUES (?,?,?,?,?) RETURNING id',
        [nama, email, hashPassword(f.password), merchant ? 'MERCHANT' : 'MAHASISWA', nowWIB()])).id;
      if (merchant) await db.run('INSERT INTO merchant (user_id, nama, lokasi, jam_buka, jam_tutup) VALUES (?,?,?,?,?)',
        [id, f.kedai.trim().slice(0, 60), f.lokasi.trim().slice(0, 120), f.buka, f.tutup]);
      return id;
    });
  } catch (e) { if (isUniqueViolation(e)) return err('Email sudah terdaftar.'); throw e; } // dua pendaftaran serentak
  if (merchant) { await ensureSlots(ctx.db); invalidate(); }
  return { ...redirect(merchant ? '/panel' : '/', { type: 'ok', msg: 'Akun berhasil dibuat.' }), setSid: await createSession(ctx.db, uid) };
});
R('POST', '/keluar', async (ctx) => ({ ...redirect('/', { type: 'ok', msg: 'Kamu sudah keluar.' }), setSid: null, destroy: true }));

// ================= Beranda =================
R('GET', '/', async (ctx) => {
  const q = (ctx.url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  const kat = clampInt(ctx.url.searchParams.get('kat'), 0, 1e6, 0);
  const cats = await getCategories(ctx.db);
  const all = await getMerchants(ctx.db);
  const list = all.filter((m) => (!kat || m.kats.includes(kat)) && (!q || `${m.nama} ${m.lokasi} ${m.kata}`.toLowerCase().includes(q))).map(withOpen);
  const chip = (id, label) => html`<a class="chip${kat === id ? ' active' : ''}" href="/?${new URLSearchParams({ ...(id ? { kat: id } : {}), ...(q ? { q } : {}) })}"${kat === id ? raw(' aria-current="true"') : ''}>${label}</a>`;
  return page(ctx, 'Beranda', html`
  <section class="hero card">
    <div><h1>Pesan dulu, ambil sendiri</h1><p class="muted">Pesan makanan dari warung dan kafe sekitar kampus sebelum datang, lalu jemput di lokasi. Tanpa ongkir, tanpa biaya layanan.</p>
    <p class="tagline">${icon('leaf', 'ic sm')} Ambil sendiri, kurangi emisi pengantaran</p></div>
    <ol class="steps">
      <li><b>1</b><span>Pilih menu favorit dari kantin kampus</span></li>
      <li><b>2</b><span>Tentukan jam ambil sesuai jeda kuliah</span></li>
      <li><b>3</b><span>Jemput di lokasi dengan kode pesanan</span></li>
    </ol>
  </section>
  <form class="search" role="search" method="get" action="/">
    ${kat ? html`<input type="hidden" name="kat" value="${kat}">` : ''}
    <label class="sr" for="q">Cari kantin, lokasi, atau menu</label>
    <span class="search-ic">${icon('search')}</span>
    <input id="q" name="q" type="search" value="${q}" placeholder="Cari kantin, lokasi, atau menu…" maxlength="60">
    <button class="btn">Cari</button>
  </form>
  <div class="chips" role="navigation" aria-label="Kategori">${chip(0, 'Semua')}${cats.map((c) => chip(c.id, c.nama))}</div>
  <div class="row between sec-head"><h2>Merchant Sekitar Kampus</h2><span class="muted">${list.length} lokasi</span></div>
  ${list.length ? html`<div class="grid cards">${list.map(merchantCard)}</div>`
    : emptyState('Tidak ada yang cocok', 'Coba kata kunci atau kategori lain.', '/', 'Lihat semua')}`);
});

// ================= Detail merchant =================
R('GET', '/kedai/:id', async (ctx) => {
  const m0 = await getMerchant(ctx.db, clampInt(ctx.params.id, 1, 1e9, 0));
  if (!m0) throw new AppError('Kedai tidak ditemukan.', 404);
  const m = withOpen(m0);
  const menus = await getMenus(ctx.db, m.id); const cats = await getCategories(ctx.db);
  const ds = await getDistances(ctx.db, m.id);
  const group = (c) => menus.filter((x) => x.category_id === c.id);
  const item = (x) => html`<li class="menu-item card">
    <div class="grow"><h4>${x.nama}</h4>${x.deskripsi ? html`<p class="muted small">${x.deskripsi}</p>` : ''}<p class="price">${rupiah(x.harga)}</p></div>
    ${x.is_available
      ? html`<form method="post" action="/keranjang/tambah"><input type="hidden" name="menu_id" value="${x.id}"><input type="hidden" name="back" value="/kedai/${m.id}"><button class="btn btn-sm" aria-label="Tambah ${x.nama} ke keranjang">Tambah</button></form>`
      : html`<span class="badge muted">Habis</span>`}</li>`;
  return page(ctx, m.nama, html`
  <a class="back" href="/">← Semua merchant</a>
  <section class="card merchant-head">
    <div class="row between"><h1>${m.nama}</h1>${openBadge(m.buka_sekarang)}</div>
    ${m.deskripsi ? html`<p class="muted">${m.deskripsi}</p>` : ''}
    <p class="meta">${icon('pin', 'ic sm')} Lokasi pengambilan: ${m.lokasi}</p>
    <p class="meta">${icon('clock', 'ic sm')} Jam operasional ${m.jam_buka}–${m.jam_tutup} WIB</p>
    <p class="meta">${icon('walk', 'ic sm')} Self-pickup · tidak ada pengantaran kurir</p>
    ${ds.length ? html`<details class="small"><summary>Estimasi jarak dari kampus</summary><ul>${ds.map((d) => html`<li>${d.titik_asal}: ${num(d.jarak_jalan_km, 2)} km jalan kaki${d.sumber === 'contoh demo' ? html` <span class="muted">(contoh demo)</span>` : ''}</li>`)}</ul></details>` : ''}
  </section>
  ${cats.map((c) => group(c).length ? html`<section><h2 class="sec-head">${c.nama}</h2><ul class="grid menu-list">${group(c).map(item)}</ul></section>` : '')}
  ${menus.length ? '' : emptyState('Belum ada menu', 'Merchant ini belum menambahkan menu.')}`);
});

// ================= Keranjang =================
R('POST', '/keranjang/tambah', async (ctx) => {
  const back = safeNext(ctx.form.back) || '/';
  const menu = (await ctx.db.get('SELECT id, merchant_id, nama, is_available FROM menu WHERE id = ?', [clampInt(ctx.form.menu_id, 1, 1e9, 0)]));
  if (!menu) throw new AppError('Menu tidak ditemukan.', 404);
  if (!menu.is_available) return redirect(back, { type: 'error', msg: `"${menu.nama}" sedang habis.` });
  const cart = ctx.session.cart;
  const hasItems = Object.keys(cart.items || {}).length > 0;
  if (hasItems && cart.merchant_id !== menu.merchant_id)
    return redirect(back, { type: 'error', msg: 'Keranjang hanya boleh berisi menu dari satu merchant. Kosongkan keranjang dulu untuk memesan dari merchant lain.', link: ['/keranjang', 'Lihat keranjang'] });
  cart.merchant_id = menu.merchant_id; cart.items ||= {};
  cart.items[menu.id] = Math.min((cart.items[menu.id] || 0) + 1, 20);
  await saveCart(ctx.db, ctx.session.sid, cart);
  return redirect(back, { type: 'ok', msg: `${menu.nama} masuk keranjang.`, link: ['/keranjang', 'Lihat keranjang'] });
}, 'MAHASISWA');

R('POST', '/keranjang/ubah', async (ctx) => {
  const id = String(clampInt(ctx.form.menu_id, 1, 1e9, 0)); const cart = ctx.session.cart;
  if (cart.items?.[id]) {
    const a = ctx.form.aksi;
    if (a === 'tambah') cart.items[id] = Math.min(cart.items[id] + 1, 20);
    else if (a === 'kurang') cart.items[id] -= 1;
    else if (a === 'hapus') cart.items[id] = 0;
    if (cart.items[id] <= 0) delete cart.items[id];
    if (!Object.keys(cart.items).length) { delete cart.items; delete cart.merchant_id; }
    await saveCart(ctx.db, ctx.session.sid, cart);
  }
  return redirect('/keranjang');
}, 'MAHASISWA');
R('POST', '/keranjang/kosongkan', async (ctx) => { await saveCart(ctx.db, ctx.session.sid, {}); return redirect('/keranjang', { type: 'ok', msg: 'Keranjang dikosongkan.' }); }, 'MAHASISWA');

R('GET', '/keranjang', async (ctx) => {
  const c = await cartLines(ctx.db, ctx.session.cart);
  if (c.changed) { // rekonsiliasi: menu yang sudah dihapus merchant dibuang dari keranjang
    const items = {}; for (const l of c.lines) items[l.id] = l.qty;
    await saveCart(ctx.db, ctx.session.sid, c.lines.length ? { merchant_id: ctx.session.cart.merchant_id, items } : {});
  }
  if (!c.lines.length) return page(ctx, 'Keranjang', html`${pageTitle('Keranjang')}${emptyState('Keranjang masih kosong', 'Pilih makanan atau minuman dari kantin kampus, pesan lebih dulu, ambil tanpa antre.', '/', 'Jelajahi Merchant')}`);
  const line = (l) => html`<li class="cart-line card">
    <div class="grow"><h4>${l.nama}</h4><p class="muted small">${rupiah(l.harga)}${l.is_available ? '' : html` · <b class="bad-t">sedang habis</b>`}</p></div>
    <form method="post" action="/keranjang/ubah" class="qty"><input type="hidden" name="menu_id" value="${l.id}">
      <button name="aksi" value="kurang" class="btn btn-outline btn-sq" aria-label="Kurangi ${l.nama}">−</button><output aria-live="polite">${l.qty}</output>
      <button name="aksi" value="tambah" class="btn btn-outline btn-sq" aria-label="Tambah ${l.nama}">+</button>
      <button name="aksi" value="hapus" class="btn btn-ghost btn-sm">Hapus</button></form>
    <p class="price line-total">${rupiah(l.harga * l.qty)}</p></li>`;
  return page(ctx, 'Keranjang', html`${pageTitle('Keranjang', `Dari ${c.merchant.nama}`)}
  <div class="two-col"><ul class="stack">${c.lines.map(line)}</ul>
  <aside class="card summary"><h2>Ringkasan</h2>
    <dl class="sum"><dt>Subtotal</dt><dd>${rupiah(c.subtotal)}</dd><dt>Ongkos kirim</dt><dd>Rp 0 <small class="muted">(self-pickup)</small></dd><dt>Biaya layanan</dt><dd>Rp 0</dd><dt class="total">Total</dt><dd class="total">${rupiah(c.subtotal)}</dd></dl>
    <p class="meta">${icon('pin', 'ic sm')} Ambil di: ${c.merchant.lokasi}</p>
    ${c.allAvailable ? html`<a class="btn block" href="/checkout">Lanjut ke checkout</a>` : html`<p class="flash flash-bad">Ada menu yang habis. Hapus dulu untuk melanjutkan.</p>`}
    <form method="post" action="/keranjang/kosongkan"><button class="btn btn-ghost block">Kosongkan keranjang</button></form>
  </aside></div>`);
}, 'MAHASISWA');

// ================= Checkout =================
R('GET', '/checkout', async (ctx) => {
  const c = await cartLines(ctx.db, ctx.session.cart);
  if (!c.lines.length) return redirect('/keranjang');
  if (!c.allAvailable) return redirect('/keranjang', { type: 'error', msg: 'Ada menu yang habis. Hapus dulu untuk melanjutkan.' });
  const slots = (await ctx.db.all('SELECT id, waktu_mulai, waktu_selesai, kuota, terpakai FROM pickup_slot WHERE merchant_id = ? AND waktu_selesai > ? AND terpakai < kuota ORDER BY waktu_mulai LIMIT 24', [c.merchant.id, nowWIB()]));
  const days = [...new Set(slots.map((s) => s.waktu_mulai.slice(0, 10)))];
  const ds = await getDistances(ctx.db, c.merchant.id);
  const slotChoices = days.map((d) => html`<fieldset class="slotday"><legend>${tanggalLabel(d)}</legend>
    <div class="slots">${slots.filter((s) => s.waktu_mulai.startsWith(d)).map((s) => html`<label class="slot"><input type="radio" name="slot_id" value="${s.id}" required><span>${s.waktu_mulai.slice(11, 16)}–${s.waktu_selesai.slice(11, 16)}<small>sisa ${s.kuota - s.terpakai}</small></span></label>`)}</div></fieldset>`);
  return page(ctx, 'Checkout', html`${pageTitle('Checkout', `Pre-order dari ${c.merchant.nama}`)}
  <form method="post" action="/checkout" class="two-col">
    <div class="stack">
      <section class="card form"><h2>1. Pilih waktu pengambilan</h2>
        ${slots.length ? slotChoices : html`<p class="flash flash-bad">Belum ada slot tersedia. Coba lagi nanti atau pilih merchant lain.</p>`}</section>
      <section class="card form"><h2>2. Detail tambahan</h2>
        ${ds.length ? field('Kamu berangkat dari mana?', html`<select name="titik_asal"><option value="">Tidak dipilih</option>${ds.map((d) => html`<option>${d.titik_asal}</option>`)}</select>`, 'Dipakai untuk menghitung estimasi emisi yang kamu hindari.') : ''}
        ${field('Catatan untuk merchant (opsional)', html`<textarea name="catatan" maxlength="200" rows="2" placeholder="mis. tanpa sambal"></textarea>`)}</section>
    </div>
    <aside class="card summary"><h2>Ringkasan pesanan</h2>
      <ul class="sumlist">${c.lines.map((l) => html`<li><span>${l.qty}× ${l.nama}</span><span>${rupiah(l.harga * l.qty)}</span></li>`)}</ul>
      <dl class="sum"><dt class="total">Total</dt><dd class="total">${rupiah(c.subtotal)}</dd></dl>
      <p class="muted small">Pembayaran: bayar di tempat saat pengambilan (simulasi, tidak ada pembayaran online). Tidak ada ongkir.</p>
      <button class="btn block"${slots.length ? '' : raw(' disabled')}>Buat pesanan</button><a class="btn btn-ghost block" href="/keranjang">Kembali ke keranjang</a>
    </aside></form>`);
}, 'MAHASISWA');

R('POST', '/checkout', async (ctx) => {
  const cart = ctx.session.cart;
  const ds = cart.merchant_id ? await getDistances(ctx.db, cart.merchant_id) : [];
  const titik = ds.some((d) => d.titik_asal === ctx.form.titik_asal) ? ctx.form.titik_asal : '';
  try {
    const id = await createOrder(ctx.db, { userId: ctx.user.id, cart, slotId: clampInt(ctx.form.slot_id, 1, 1e9, 0), titikAsal: titik, catatan: (ctx.form.catatan || '').trim() });
    await saveCart(ctx.db, ctx.session.sid, {});
    return redirect(`/pesanan/${id}`, { type: 'ok', msg: 'Pesanan dibuat. Tunjukkan kode pengambilan ke merchant saat menjemput.' });
  } catch (e) { if (e instanceof AppError) return redirect('/checkout', { type: 'error', msg: e.message }); throw e; }
}, 'MAHASISWA');

// ================= Pesanan =================
const TABS = [['semua', 'Semua', null], ['menunggu', 'Menunggu Konfirmasi', [STATUS.MENUNGGU]], ['proses', 'Diproses', [STATUS.DIPROSES, STATUS.SIAP]],
  ['selesai', 'Selesai', [STATUS.SELESAI]], ['batal', 'Batal', [STATUS.DITOLAK, STATUS.DIBATALKAN]]];
R('GET', '/pesanan', async (ctx) => {
  const tab = TABS.find((t) => t[0] === ctx.url.searchParams.get('tab')) || TABS[0];
  const n = clampInt(ctx.url.searchParams.get('n'), 8, 200, 8);
  const where = tab[2] ? `AND o.status IN (${tab[2].map(() => '?').join(',')})` : '';
  const rows = (await ctx.db.all(`SELECT o.id, o.status, o.total_bayar, o.created_at, o.pickup_code, m.nama AS merchant, s.waktu_mulai, s.waktu_selesai,
      (SELECT COALESCE(SUM(jumlah),0) FROM order_detail d WHERE d.order_id = o.id) AS items
    FROM orders o JOIN merchant m ON m.id = o.merchant_id JOIN pickup_slot s ON s.id = o.pickup_slot_id
    WHERE o.user_id = ? ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`, [ctx.user.id, ...(tab[2] || []), n + 1]));
  const more = rows.length > n; const shown = rows.slice(0, n);
  const qs = (t, nn) => '/pesanan?' + new URLSearchParams({ tab: t, ...(nn ? { n: nn } : {}) });
  return page(ctx, 'Pesanan', html`${pageTitle('Riwayat pesanan', 'Pesananmu dari semua merchant.')}
  <div class="tabs" role="navigation" aria-label="Filter status">${TABS.map((t) => html`<a class="tab${t[0] === tab[0] ? ' active' : ''}" href="${qs(t[0])}">${t[1]}</a>`)}</div>
  ${shown.length ? html`<ul class="stack">${shown.map((o) => html`<li><a class="card order" href="/pesanan/${o.id}">
    <div class="row between"><h3>${o.merchant}</h3>${statusBadge(o.status)}</div>
    <p class="meta">${icon('clock', 'ic sm')} Ambil ${slotLabel(o.waktu_mulai, o.waktu_selesai)}</p>
    <div class="row between"><span class="muted small">${o.items} item · dipesan ${createdLabel(o.created_at)}</span><b>${rupiah(o.total_bayar)}</b></div></a></li>`)}</ul>
    ${more ? html`<p class="center"><a class="btn btn-outline" href="${qs(tab[0], n + 8)}">Muat lagi</a></p>` : ''}`
    : emptyState('Belum ada pesanan', 'Anda belum membuat pesanan pre-order. Yuk, beli makanan dari kantin kampus.', '/', 'Cari Makanan')}`);
}, 'MAHASISWA');

R('GET', '/pesanan/:id', async (ctx) => {
  const id = clampInt(ctx.params.id, 1, 1e9, 0);
  const o = (await ctx.db.get(`SELECT o.*, m.nama AS merchant, m.lokasi, s.waktu_mulai, s.waktu_selesai FROM orders o
    JOIN merchant m ON m.id = o.merchant_id JOIN pickup_slot s ON s.id = o.pickup_slot_id WHERE o.id = ? AND o.user_id = ?`, [id, ctx.user.id]));
  if (!o) throw new AppError('Pesanan tidak ditemukan.', 404);
  const items = (await ctx.db.all('SELECT nama_menu_snapshot AS nama, harga_snapshot AS harga, jumlah FROM order_detail WHERE order_id = ? ORDER BY id', [id]));
  const aktif = [STATUS.MENUNGGU, STATUS.DIPROSES, STATUS.SIAP].includes(o.status);
  const steps = [['Dipesan', true], ['Dikonfirmasi', o.status !== STATUS.MENUNGGU && ![STATUS.DITOLAK, STATUS.DIBATALKAN].includes(o.status)],
    ['Siap diambil', [STATUS.SIAP, STATUS.SELESAI].includes(o.status)], ['Selesai', o.status === STATUS.SELESAI]];
  const hindar = deltaTransport(await jarakMotor(ctx.db, o.merchant_id, o.titik_asal));
  return page(ctx, `Pesanan ${o.pickup_code}`, html`<a class="back" href="/pesanan">← Riwayat pesanan</a>
  <div class="two-col">
  <div class="stack">
    <section class="card"><div class="row between"><h1>${o.merchant}</h1>${statusBadge(o.status)}</div>
      <p class="meta">${icon('pin', 'ic sm')} Ambil di: ${o.lokasi}</p>
      <p class="meta">${icon('clock', 'ic sm')} Waktu ambil: ${slotLabel(o.waktu_mulai, o.waktu_selesai)}</p>
      ${o.catatan ? html`<p class="meta">Catatan: ${o.catatan}</p>` : ''}
      ${[STATUS.DITOLAK, STATUS.DIBATALKAN].includes(o.status) ? html`<p class="flash flash-bad">Pesanan ${STATUS_LABEL[o.status].toLowerCase()}. Kuota slot sudah dikembalikan.</p>`
        : html`<ol class="timeline">${steps.map(([t, done]) => html`<li class="${done ? 'done' : ''}"><span>${done ? icon('check', 'ic sm') : ''}</span>${t}</li>`)}</ol>`}
    </section>
    <section class="card"><h2>Rincian</h2>
      <ul class="sumlist">${items.map((i) => html`<li><span>${i.jumlah}× ${i.nama}</span><span>${rupiah(i.harga * i.jumlah)}</span></li>`)}</ul>
      <dl class="sum"><dt>Ongkos kirim</dt><dd>Rp 0</dd><dt class="total">Total (bayar di tempat)</dt><dd class="total">${rupiah(o.total_bayar)}</dd></dl></section>
  </div>
  <aside class="stack">
    ${aktif ? html`<section class="card codebox"><p class="muted small">Kode pengambilan</p><p class="code" aria-label="Kode pengambilan ${o.pickup_code}">${o.pickup_code}</p><p class="muted small">Tunjukkan kode ini ke merchant saat menjemput pesanan.</p></section>` : ''}
    <section class="card eco"><div class="row nowrap">${icon('leaf', 'ic')}<div><p>Dengan mengambil sendiri, estimasi emisi pengantaran motor yang dihindari: <b>${kg(hindar)}</b>${o.titik_asal ? ` (dari ${o.titik_asal})` : ' (jarak rata-rata merchant)'}.</p><p class="muted small">Estimasi, dengan asumsi pengantaran 1 perjalanan per pesanan. <a href="/dampak">Pelajari metodenya</a>.</p></div></div></section>
    ${o.status === STATUS.MENUNGGU ? html`<form method="post" action="/pesanan/${o.id}/batal"><button class="btn btn-danger block">Batalkan pesanan</button></form>` : ''}
  </aside></div>`);
}, 'MAHASISWA');

R('POST', '/pesanan/:id/batal', async (ctx) => {
  const id = clampInt(ctx.params.id, 1, 1e9, 0);
  try { await applyAction(ctx.db, { orderId: id, actor: ctx.user, action: 'batal' }); }
  catch (e) { if (e instanceof AppError && e.status !== 404) return redirect(`/pesanan/${id}`, { type: 'error', msg: e.message }); throw e; }
  return redirect(`/pesanan/${id}`, { type: 'ok', msg: 'Pesanan dibatalkan.' });
}, 'MAHASISWA');

// ================= Profil =================
R('GET', '/profil', async (ctx) => {
  const done = (await ctx.db.all("SELECT merchant_id, titik_asal FROM orders WHERE user_id = ? AND status = 'SELESAI'", [ctx.user.id]));
  let total = 0;
  for (const o of done) total += deltaTransport(await jarakMotor(ctx.db, o.merchant_id, o.titik_asal));
  return page(ctx, 'Profil', html`${pageTitle('Profil akun', 'Akun Mahasiswa')}
  <div class="two-col"><div class="stack">
    <section class="card"><div class="row"><span class="avatar">${icon('user')}</span><div><h2>${ctx.user.nama}</h2><p class="muted">${ctx.user.email}</p><span class="badge ok">Customer</span></div></div></section>
    <section class="card"><div class="row between"><div><h2>Mode gelap</h2><p class="muted small">Tampilan gelap, bisa lebih hemat daya di layar OLED. Pada layar LCD pengaruhnya kecil.</p></div>
      <button type="button" class="btn btn-outline" data-theme-toggle>Ganti tema</button></div></section>
    <form method="post" action="/keluar"><button class="btn btn-danger block">Keluar</button></form>
  </div>
  <aside class="card eco"><h2>${icon('leaf')} Kontribusi Ramah Lingkungan</h2>
    <p>Total pesanan self-pickup selesai: <b>${done.length} pesanan</b></p>
    <p>Estimasi emisi motor yang dihindari: <b>${kg(total)}</b></p>
    <p class="muted small">Estimasi dari jarak referensi per titik asal × 0,082 kgCO₂e/km, dengan asumsi pengantaran motor 1 perjalanan per pesanan. <a href="/dampak">Metode dan batasannya</a>.</p></aside></div>`);
}, 'MAHASISWA');

// ================= Dampak (CO2e & biaya) =================
R('GET', '/dampak', async (ctx) => {
  const sp = ctx.url.searchParams;
  const kasus = (await getMerchants(ctx.db)).find((m) => m.nama.startsWith('Kantin Bu Sari'));
  const ds = kasus ? (await getDistances(ctx.db, kasus.id)).filter((d) => d.sumber === 'studi kasus laporan') : [];
  const rows = ds.map((d) => ({ ...d, e: emisiDelivery(d.jarak_motor_km) }));
  const totMotor = rows.reduce((a, r) => a + r.jarak_motor_km, 0), totJalan = rows.reduce((a, r) => a + r.jarak_jalan_km, 0), totE = rows.reduce((a, r) => a + r.e, 0);
  const rata = rows.length ? totE / rows.length : 0;
  // Kalkulator transportasi + biaya
  const titik = sp.get('titik') || 'semua';
  const n = clampInt(sp.get('n'), 1, 1e6, 100);
  const ongkir = clampNum(sp.get('ongkir'), 0, 100000, 8000), layanan = clampNum(sp.get('layanan'), 0, 100000, 3000);
  const pilih = rows.find((r) => r.titik_asal === titik);
  const perPesanan = pilih ? pilih.e : rata;
  const hindar = n * perPesanan, tahun = hindar * 12;
  const biaya = bandingBiaya({ subtotal: 0, ongkir, biayaLayanan: layanan });
  // Kalkulator digital (SWDM v4)
  const kb = clampNum(sp.get('kb'), 1, 1e6, 100);
  const nvr = clampNum(sp.get('nvr'), 0, 1, DEFAULTS.nvr), dcr = clampNum(sp.get('dcr'), 0, 1, DEFAULTS.dcr);
  const ghf = clampNum(sp.get('ghf'), 0, 1, 0), ci = clampNum(sp.get('ci'), 1, 2000, CI_GLOBAL);
  const bytes = kb * 1000, opts = { nvr, rvr: 1 - nvr, dcr, ghf, ci };
  const pv = swdmPageView(bytes, opts), base = swdmBase(bytes, { ghf, ci }), komp = swdmKomponen(bytes, { ci });
  return page(ctx, 'Dampak', html`${pageTitle('Dampak: emisi CO₂e dan penghematan', 'Perbandingan skenario delivery motor vs self-pickup jalan kaki, plus estimasi jejak digital aplikasi.')}
  <section class="card"><h2>1. Emisi transportasi (studi kasus Kantin Bu Sari – Teknik)</h2>
    <p class="muted">Rumus: <code>E(delivery) = D × ${num(FE_MOTOR, 3)}</code> kgCO₂e (faktor emisi motor bensin RON 90, Kalkulator Hijau V2 Bank Indonesia). Self-pickup jalan kaki: <code>E = 0</code> (emisi langsung bahan bakar). <code>ΔE = E(delivery) − E(self-pickup)</code>.</p>
    <div class="tablewrap"><table><thead><tr><th>Titik asal</th><th class="r">Delivery motor (km)</th><th class="r">Self-pickup jalan (km)</th><th class="r">E(delivery)</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.titik_asal}</td><td class="r">${num(r.jarak_motor_km)}</td><td class="r">${num(r.jarak_jalan_km)}</td><td class="r">${kg(r.e)}</td></tr>`)}</tbody>
      <tfoot><tr><th>Total</th><th class="r">${num(totMotor)}</th><th class="r">${num(totJalan)}</th><th class="r">${kg(totE)}</th></tr></tfoot></table></div>
    <p>Rata-rata per pesanan: <b>${kg(rata)}</b>. Potensi emisi yang dihindari (ΔE) untuk ${rows.length} perjalanan: <b>${kg(totE)}</b> atau <b>${num(persenPengurangan(totE, 0), 0)}%</b> dari emisi langsung skenario delivery.</p>
    <p class="note">Angka 100% adalah konsekuensi langsung dari asumsi bahwa berjalan kaki tidak menimbulkan emisi bahan bakar, bukan klaim bahwa dampaknya nol. Perhitungan juga tidak memasukkan perjalanan kembali kurir.</p></section>

  <section class="card" id="kalkulator"><h2>2. Kalkulator ekstrapolasi dan biaya</h2>
    <form method="get" action="/dampak#kalkulator" class="form calc">
      <div class="three">
        ${field('Titik asal', html`<select name="titik"><option value="semua"${titik === 'semua' ? raw(' selected') : ''}>Rata-rata 3 titik</option>${rows.map((r) => html`<option${r.titik_asal === titik ? raw(' selected') : ''}>${r.titik_asal}</option>`)}</select>`)}
        ${field('Jumlah pesanan yang beralih', html`<input type="number" name="n" min="1" max="1000000" value="${n}">`)}
        ${field('Ongkir delivery (Rp)', html`<input type="number" name="ongkir" min="0" step="500" value="${ongkir}">`, 'Contoh/asumsi, ganti dengan data nyatamu')}
        ${field('Biaya layanan (Rp)', html`<input type="number" name="layanan" min="0" step="500" value="${layanan}">`, 'Contoh/asumsi')}
      </div><button class="btn btn-sm">Hitung</button></form>
    <dl class="results"><div><dt>Emisi dihindari</dt><dd>${kg(hindar, 3)}</dd></div><div><dt>Bila volume sama bertahan 12 bulan</dt><dd>${kg(tahun, 1)}</dd></div>
      <div><dt>Penghematan biaya per pesanan</dt><dd>${rupiah(biaya.hemat)}</dd></div><div><dt>Penghematan ${n} pesanan</dt><dd>${rupiah(biaya.hemat * n)}</dd></div></dl>
    <p class="note">Ini ilustrasi skala dari asumsi yang kamu masukkan, bukan hasil pengukuran. Penghematan biaya aktual belum dapat ditentukan tanpa data transaksi nyata, dan hanya bila pesanan benar-benar beralih dari delivery ke self-pickup.</p></section>

  <section class="card"><h2>3. Estimasi emisi digital (SWDM v4)</h2>
    <p class="muted">Model Green Web Foundation: <code>C_pageview = C_base × NVR + C_base × RVR × (1 − DCR)</code>. Intensitas energi (kWh/GB, operasional / tertanam): ${Object.values(SWDM).map((s) => `${s.nama} ${num(s.op, 3)}/${num(s.em, 3)}`).join('; ')}. Faktor karbon listrik bawaan ${CI_GLOBAL} gCO₂e/kWh; 1 GB = 10⁹ byte.</p>
    <form method="get" action="/dampak#digital" class="form calc" id="digital"><div class="three">
      ${field('Transfer data (KB)', html`<input type="number" name="kb" min="1" step="any" value="${kb}">`, 'Ambil dari DevTools → Network')}
      ${field('Rasio pengunjung baru (NVR)', html`<input type="number" name="nvr" min="0" max="1" step="0.05" value="${nvr}">`, `RVR otomatis = ${num(1 - nvr)}`)}
      ${field('Rasio cache data (DCR)', html`<input type="number" name="dcr" min="0" max="1" step="0.01" value="${dcr}">`, 'Asumsi awal, ganti sesuai pengujian')}
      ${field('Green hosting factor (GHF)', html`<input type="number" name="ghf" min="0" max="1" step="0.05" value="${ghf}">`, '0 bila hosting hijau belum terverifikasi')}
      ${field('Intensitas karbon listrik (gCO₂e/kWh)', html`<input type="number" name="ci" min="1" max="2000" value="${ci}">`)}
    </div><button class="btn btn-sm">Hitung</button></form>
    <dl class="results"><div><dt>Emisi per page view</dt><dd>${num(pv, 4)} gCO₂e</dd></div><div><dt>Per 1.000 page view</dt><dd>${num(pv * 1000, 1)} gCO₂e</dd></div><div><dt>C_base (kunjungan pertama)</dt><dd>${num(base, 4)} gCO₂e</dd></div></dl>
    <div class="tablewrap"><table><thead><tr><th>Komponen</th><th class="r">Operasional (gCO₂e)</th><th class="r">Tertanam (gCO₂e)</th></tr></thead><tbody>${komp.map((k) => html`<tr><td>${k.nama}</td><td class="r">${num(k.op, 4)}</td><td class="r">${num(k.em, 4)}</td></tr>`)}</tbody></table></div>
    <p class="note">Hasil ini estimasi aktivitas digital berdasarkan transfer data, bukan pengukuran listrik server produksi. Bila data konsumsi listrik server tersedia, jangan dijumlahkan dengan komponen data center SWDM agar tidak terjadi penghitungan ganda.</p></section>

  <section class="card"><h2>Batasan klaim</h2><ul>
    <li>Self-pickup hanya mengurangi komponen <b>pengantaran</b>. Emisi produksi makanan (menurut Hu dkk., 2023, lebih dari 70% emisi satu pesanan layanan antar) tidak berubah.</li>
    <li>Hasil berupa estimasi dari asumsi dan data yang tersedia, bukan pengukuran langsung.</li>
    <li>Pengurangan emisi hanya terjadi bila pesanan benar-benar beralih dari pengantaran motor ke pengambilan dengan berjalan kaki.</li>
    <li>Jejak digital tidak mencakup produksi perangkat dan infrastruktur jaringan bila datanya tidak tersedia, serta belum memisahkan hosting produksi.</li></ul></section>`);
});

export const _internals = { kg };
