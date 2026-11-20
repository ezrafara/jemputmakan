// Panel merchant: pesanan masuk, verifikasi kode, menu, slot, pengaturan kedai.
import { html, raw, rupiah, AppError, clampInt, slotLabel, createdLabel, nowWIB, dateWIB } from './util.js';
import { applyAction, verifyByCode, STATUS, STATUS_LABEL } from './orders.js';
import { invalidate } from './cache.js';
import { icon, statusBadge, emptyState, field, pageTitle } from './views.js';
import { page, redirect, getCategories } from './helpers.js';

export const panelRoutes = [];
const R = (method, path, handler) => panelRoutes.push({ method, path, handler, auth: 'MERCHANT' });
const mine = async (ctx) => {
  const m = (await ctx.db.get('SELECT * FROM merchant WHERE user_id = ?', [ctx.user.id]));
  if (!m) throw new AppError('Data kedai tidak ditemukan.', 404);
  return m;
};
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- Pesanan masuk ----------
const TABS = [['baru', 'Perlu konfirmasi', [STATUS.MENUNGGU]], ['proses', 'Diproses', [STATUS.DIPROSES]], ['siap', 'Siap diambil', [STATUS.SIAP]],
  ['selesai', 'Selesai', [STATUS.SELESAI]], ['batal', 'Batal/Ditolak', [STATUS.DITOLAK, STATUS.DIBATALKAN]]];

R('GET', '/panel', async (ctx) => {
  const m = await mine(ctx);
  const tab = TABS.find((t) => t[0] === ctx.url.searchParams.get('tab')) || TABS[0];
  const counts = Object.fromEntries((await ctx.db.all('SELECT status, COUNT(*) AS n FROM orders WHERE merchant_id = ? GROUP BY status', [m.id])).map((r) => [r.status, r.n]));
  const orders = (await ctx.db.all(`SELECT o.id, o.status, o.total_bayar, o.catatan, o.created_at, u.nama AS pelanggan, s.waktu_mulai, s.waktu_selesai
    FROM orders o JOIN "user" u ON u.id = o.user_id JOIN pickup_slot s ON s.id = o.pickup_slot_id
    WHERE o.merchant_id = ? AND o.status IN (${tab[2].map(() => '?').join(',')}) ORDER BY s.waktu_mulai, o.id LIMIT 40`, [m.id, ...tab[2]]));
  // Satu query untuk semua item pesanan yang tampil (hindari N+1)
  const det = orders.length ? await ctx.db.all(`SELECT order_id, nama_menu_snapshot AS nama, jumlah FROM order_detail WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`, orders.map((o) => o.id)) : [];
  const items = (id) => det.filter((d) => d.order_id === id);
  const act = (o) => {
    const f = (a, label, cls = '') => html`<form method="post" action="/panel/pesanan/${o.id}"><input type="hidden" name="aksi" value="${a}"><input type="hidden" name="tab" value="${tab[0]}"><button class="btn btn-sm ${cls}">${label}</button></form>`;
    if (o.status === STATUS.MENUNGGU) return html`<div class="row">${f('terima', 'Terima pesanan')}${f('tolak', 'Tolak', 'btn-danger')}</div>`;
    if (o.status === STATUS.DIPROSES) return f('siap', 'Tandai siap diambil');
    if (o.status === STATUS.SIAP) return html`<a class="btn btn-sm btn-outline" href="/panel/verifikasi">Verifikasi kode saat pelanggan datang</a>`;
    return '';
  };
  const total = (counts[STATUS.MENUNGGU] || 0);
  return page(ctx, 'Pesanan masuk', html`${pageTitle(m.nama, `Pesanan masuk · ${total ? total + ' menunggu konfirmasi' : 'tidak ada yang menunggu'}`)}
  <div class="tabs" role="navigation" aria-label="Filter status">${TABS.map((t) => html`<a class="tab${t[0] === tab[0] ? ' active' : ''}" href="/panel?tab=${t[0]}">${t[1]}${t[2].reduce((a, s) => a + (counts[s] || 0), 0) ? html` <b class="count">${t[2].reduce((a, s) => a + (counts[s] || 0), 0)}</b>` : ''}</a>`)}<a class="tab" href="/panel?tab=${tab[0]}">Segarkan</a></div>
  ${orders.length ? html`<ul class="stack">${orders.map((o) => html`<li class="card order-p"><div class="row between"><h3>${o.pelanggan}</h3>${statusBadge(o.status)}</div>
    <p class="meta">${icon('clock', 'ic sm')} Ambil ${slotLabel(o.waktu_mulai, o.waktu_selesai)} · dipesan ${createdLabel(o.created_at)}</p>
    <ul class="sumlist">${items(o.id).map((i) => html`<li><span>${i.jumlah}× ${i.nama}</span></li>`)}</ul>
    ${o.catatan ? html`<p class="meta">Catatan: ${o.catatan}</p>` : ''}
    <div class="row between"><b>${rupiah(o.total_bayar)} <small class="muted">bayar di tempat</small></b>${act(o)}</div></li>`)}</ul>`
    : emptyState('Tidak ada pesanan', `Belum ada pesanan dengan status "${tab[1]}".`)}`);
});

R('POST', '/panel/pesanan/:id', async (ctx) => {
  const id = clampInt(ctx.params.id, 1, 1e9, 0); const tab = ctx.form.tab || 'baru';
  try {
    const r = await applyAction(ctx.db, { orderId: id, actor: ctx.user, action: ctx.form.aksi });
    return redirect(`/panel?tab=${encodeURIComponent(tab)}`, { type: 'ok', msg: `Pesanan diubah menjadi "${STATUS_LABEL[r.to]}".` });
  } catch (e) { if (e instanceof AppError && e.status !== 404) return redirect(`/panel?tab=${encodeURIComponent(tab)}`, { type: 'error', msg: e.message }); throw e; }
});

// ---------- Verifikasi kode ----------
async function verifyPage(ctx, flash) {
  const m = await mine(ctx);
  const siap = (await ctx.db.all(`SELECT o.id, u.nama, s.waktu_mulai, s.waktu_selesai FROM orders o JOIN "user" u ON u.id = o.user_id JOIN pickup_slot s ON s.id = o.pickup_slot_id
    WHERE o.merchant_id = ? AND o.status = ? ORDER BY s.waktu_mulai`, [m.id, STATUS.SIAP]));
  return page({ ...ctx, flash: flash || ctx.flash }, 'Verifikasi kode', html`${pageTitle('Verifikasi kode pengambilan', 'Minta pelanggan menunjukkan kode dari halaman pesanannya.')}
  <form method="post" action="/panel/verifikasi" class="card form narrow-l">
    ${field('Kode pengambilan', html`<input name="kode" required maxlength="10" autocomplete="off" autocapitalize="characters" placeholder="JM-XXXX" class="codeinput">`)}
    <button class="btn">Verifikasi dan selesaikan pesanan</button></form>
  <h2 class="sec-head">Menunggu diambil (${siap.length})</h2>
  ${siap.length ? html`<ul class="stack">${siap.map((o) => html`<li class="card row between"><span><b>${o.nama}</b> <span class="muted small">· ${slotLabel(o.waktu_mulai, o.waktu_selesai)}</span></span><span class="badge ok">Siap diambil</span></li>`)}</ul>`
    : html`<p class="muted">Tidak ada pesanan yang menunggu diambil.</p>`}`);
}
R('GET', '/panel/verifikasi', async (ctx) => await verifyPage(ctx));
R('POST', '/panel/verifikasi', async (ctx) => {
  try { await verifyByCode(ctx.db, { merchantUserId: ctx.user.id, code: ctx.form.kode }); }
  catch (e) { if (e instanceof AppError) return { ...await verifyPage(ctx, { type: 'error', msg: e.message }), status: e.status }; throw e; }
  return redirect('/panel/verifikasi', { type: 'ok', msg: `Kode ${String(ctx.form.kode).trim().toUpperCase()} cocok. Pesanan selesai diserahkan.` });
});

// ---------- Menu ----------
const parseMenu = (ctx, cats) => {
  const f = ctx.form; const nama = (f.nama || '').trim();
  const harga = Number(f.harga); const cat = Number(f.category_id);
  if (nama.length < 2 || nama.length > 60) throw new AppError('Nama menu 2–60 karakter.');
  if (!Number.isInteger(harga) || harga < 0 || harga > 1_000_000) throw new AppError('Harga harus bilangan bulat 0–1.000.000.');
  if (!cats.some((c) => c.id === cat)) throw new AppError('Pilih kategori.');
  return { nama, harga, cat, desk: (f.deskripsi || '').trim().slice(0, 120) };
};
const menuForm = (cats, v = {}, action, label) => html`<form method="post" action="${action}" class="card form">
  <div class="two">${field('Nama menu', html`<input name="nama" value="${v.nama || ''}" required maxlength="60">`)}${field('Harga (Rp)', html`<input type="number" name="harga" min="0" max="1000000" step="500" value="${v.harga ?? ''}" required>`)}</div>
  <div class="two">${field('Kategori', html`<select name="category_id">${cats.map((c) => html`<option value="${c.id}"${c.id === v.category_id ? raw(' selected') : ''}>${c.nama}</option>`)}</select>`)}${field('Deskripsi singkat', html`<input name="deskripsi" value="${v.deskripsi || ''}" maxlength="120">`)}</div>
  <button class="btn btn-sm">${label}</button></form>`;

R('GET', '/panel/menu', async (ctx) => {
  const m = await mine(ctx); const cats = await getCategories(ctx.db);
  const menus = (await ctx.db.all('SELECT x.*, c.nama AS kategori FROM menu x JOIN category c ON c.id = x.category_id WHERE x.merchant_id = ? ORDER BY x.category_id, x.nama', [m.id]));
  return page(ctx, 'Kelola menu', html`${pageTitle('Kelola menu', 'Tambah, ubah, atau tandai menu habis.')}
  <h2 class="sec-head">Tambah menu</h2>${menuForm(cats, {}, '/panel/menu', 'Tambah menu')}
  <h2 class="sec-head">Daftar menu (${menus.length})</h2>
  ${menus.length ? html`<div class="tablewrap card"><table><thead><tr><th>Menu</th><th>Kategori</th><th class="r">Harga</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
    ${menus.map((x) => html`<tr><td>${x.nama}</td><td>${x.kategori}</td><td class="r">${rupiah(x.harga)}</td><td><span class="badge ${x.is_available ? 'ok' : 'muted'}">${x.is_available ? 'Tersedia' : 'Habis'}</span></td>
      <td class="acts"><form method="post" action="/panel/menu/${x.id}/toggle"><button class="btn btn-sm btn-outline">${x.is_available ? 'Tandai habis' : 'Tandai tersedia'}</button></form>
      <a class="btn btn-sm btn-ghost" href="/panel/menu/${x.id}">Ubah</a>
      <form method="post" action="/panel/menu/${x.id}/hapus"><button class="btn btn-sm btn-ghost bad-t">Hapus</button></form></td></tr>`)}</tbody></table></div>`
    : emptyState('Belum ada menu', 'Tambahkan menu pertamamu di atas.')}`);
});
R('POST', '/panel/menu', async (ctx) => {
  const m = await mine(ctx);
  try { const v = parseMenu(ctx, await getCategories(ctx.db));
    await ctx.db.run('INSERT INTO menu (merchant_id, category_id, nama, deskripsi, harga) VALUES (?,?,?,?,?)', [m.id, v.cat, v.nama, v.desk, v.harga]);
  } catch (e) { if (e instanceof AppError) return redirect('/panel/menu', { type: 'error', msg: e.message }); throw e; }
  invalidate(); return redirect('/panel/menu', { type: 'ok', msg: 'Menu ditambahkan.' });
});
const ownMenu = async (ctx) => {
  const m = await mine(ctx);
  const x = (await ctx.db.get('SELECT * FROM menu WHERE id = ? AND merchant_id = ?', [clampInt(ctx.params.id, 1, 1e9, 0), m.id]));
  if (!x) throw new AppError('Menu tidak ditemukan.', 404); return x;
};
R('GET', '/panel/menu/:id', async (ctx) => { const x = await ownMenu(ctx);
  return page(ctx, 'Ubah menu', html`<a class="back" href="/panel/menu">← Kelola menu</a>${pageTitle('Ubah menu')}${menuForm(await getCategories(ctx.db), x, `/panel/menu/${x.id}/ubah`, 'Simpan perubahan')}`); });
R('POST', '/panel/menu/:id/ubah', async (ctx) => { const x = await ownMenu(ctx);
  try { const v = parseMenu(ctx, await getCategories(ctx.db));
    await ctx.db.run('UPDATE menu SET nama=?, harga=?, category_id=?, deskripsi=? WHERE id=?', [v.nama, v.harga, v.cat, v.desk, x.id]);
  } catch (e) { if (e instanceof AppError) return redirect(`/panel/menu/${x.id}`, { type: 'error', msg: e.message }); throw e; }
  invalidate(); return redirect('/panel/menu', { type: 'ok', msg: 'Menu diperbarui.' }); });
R('POST', '/panel/menu/:id/toggle', async (ctx) => { const x = await ownMenu(ctx);
  await ctx.db.run('UPDATE menu SET is_available = 1 - is_available WHERE id = ?', [x.id]); invalidate();
  return redirect('/panel/menu', { type: 'ok', msg: `"${x.nama}" ${x.is_available ? 'ditandai habis' : 'tersedia lagi'}.` }); });
R('POST', '/panel/menu/:id/hapus', async (ctx) => { const x = await ownMenu(ctx);
  await ctx.db.run('DELETE FROM menu WHERE id = ?', [x.id]); invalidate(); // riwayat pesanan aman: nama & harga disalin di order_detail
  return redirect('/panel/menu', { type: 'ok', msg: `"${x.nama}" dihapus.` }); });

// ---------- Slot ----------
R('GET', '/panel/slot', async (ctx) => {
  const m = await mine(ctx);
  const slots = (await ctx.db.all('SELECT * FROM pickup_slot WHERE merchant_id = ? AND waktu_selesai > ? ORDER BY waktu_mulai LIMIT 60', [m.id, nowWIB()]));
  return page(ctx, 'Slot pengambilan', html`${pageTitle('Slot pengambilan', 'Atur jam pengambilan dan kuota pesanan per slot.')}
  <form method="post" action="/panel/slot" class="card form"><div class="three">
    ${field('Tanggal', html`<select name="tanggal"><option value="${dateWIB(0)}">Hari ini</option><option value="${dateWIB(1)}">Besok</option><option value="${dateWIB(2)}">Lusa</option></select>`)}
    ${field('Mulai', html`<input type="time" name="mulai" required>`)}${field('Selesai', html`<input type="time" name="selesai" required>`)}
    ${field('Kuota pesanan', html`<input type="number" name="kuota" min="1" max="50" value="5" required>`)}</div>
    <button class="btn btn-sm">Tambah slot</button></form>
  <h2 class="sec-head">Slot mendatang (${slots.length})</h2>
  ${slots.length ? html`<div class="tablewrap card"><table><thead><tr><th>Waktu</th><th class="r">Terpakai</th><th>Aksi</th></tr></thead><tbody>${slots.map((s) => html`<tr><td>${slotLabel(s.waktu_mulai, s.waktu_selesai)}</td>
    <td class="r">${s.terpakai}/${s.kuota}${s.terpakai >= s.kuota ? html` <span class="badge bad">Penuh</span>` : ''}</td>
    <td>${s.terpakai === 0 ? html`<form method="post" action="/panel/slot/${s.id}/hapus"><button class="btn btn-sm btn-ghost bad-t">Hapus</button></form>` : html`<span class="muted small">Sudah dipesan</span>`}</td></tr>`)}</tbody></table></div>`
    : emptyState('Belum ada slot', 'Tambahkan slot agar mahasiswa bisa memesan.')}`);
});
R('POST', '/panel/slot', async (ctx) => {
  const m = await mine(ctx); const f = ctx.form;
  const days = [dateWIB(0), dateWIB(1), dateWIB(2)];
  const kuota = clampInt(f.kuota, 1, 50, 5);
  let err = '';
  if (!days.includes(f.tanggal)) err = 'Tanggal tidak valid.';
  else if (!HM.test(f.mulai || '') || !HM.test(f.selesai || '') || f.mulai >= f.selesai) err = 'Jam selesai harus setelah jam mulai.';
  else if (f.mulai < m.jam_buka || f.selesai > m.jam_tutup) err = `Slot harus berada dalam jam operasional (${m.jam_buka}–${m.jam_tutup}).`;
  if (err) return redirect('/panel/slot', { type: 'error', msg: err });
  const ins = await ctx.db.run('INSERT INTO pickup_slot (merchant_id, waktu_mulai, waktu_selesai, kuota) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', [m.id, `${f.tanggal}T${f.mulai}`, `${f.tanggal}T${f.selesai}`, kuota]);
  if (!ins.changes) return redirect('/panel/slot', { type: 'error', msg: 'Sudah ada slot dengan jam mulai yang sama.' });
  invalidate(); return redirect('/panel/slot', { type: 'ok', msg: 'Slot ditambahkan.' });
});
R('POST', '/panel/slot/:id/hapus', async (ctx) => {
  const m = await mine(ctx);
  const r = (await ctx.db.run('DELETE FROM pickup_slot WHERE id = ? AND merchant_id = ? AND terpakai = 0', [clampInt(ctx.params.id, 1, 1e9, 0), m.id]));
  return redirect('/panel/slot', r.changes ? { type: 'ok', msg: 'Slot dihapus.' } : { type: 'error', msg: 'Slot tidak dapat dihapus karena sudah dipesan.' });
});

// ---------- Pengaturan kedai ----------
R('GET', '/panel/toko', async (ctx) => {
  const m = await mine(ctx);
  return page(ctx, 'Pengaturan kedai', html`${pageTitle('Pengaturan kedai')}
  <form method="post" action="/panel/toko" class="card form narrow-l">
    ${field('Nama kedai', html`<input name="nama" value="${m.nama}" required maxlength="60">`)}
    ${field('Deskripsi', html`<textarea name="deskripsi" rows="2" maxlength="200">${m.deskripsi}</textarea>`)}
    ${field('Lokasi pengambilan', html`<input name="lokasi" value="${m.lokasi}" required maxlength="120">`)}
    <div class="two">${field('Jam buka', html`<input type="time" name="buka" value="${m.jam_buka}" required>`)}${field('Jam tutup', html`<input type="time" name="tutup" value="${m.jam_tutup}" required>`)}</div>
    <label class="check"><input type="checkbox" name="is_open" value="1"${m.is_open ? raw(' checked') : ''}> Kedai sedang menerima pesanan</label>
    <button class="btn">Simpan</button></form>`);
});
R('POST', '/panel/toko', async (ctx) => {
  const m = await mine(ctx); const f = ctx.form;
  const nama = (f.nama || '').trim(), lokasi = (f.lokasi || '').trim();
  if (!nama || !lokasi) return redirect('/panel/toko', { type: 'error', msg: 'Nama dan lokasi wajib diisi.' });
  if (!HM.test(f.buka || '') || !HM.test(f.tutup || '') || f.buka >= f.tutup) return redirect('/panel/toko', { type: 'error', msg: 'Jam buka harus lebih awal dari jam tutup.' });
  await ctx.db.run('UPDATE merchant SET nama=?, deskripsi=?, lokasi=?, jam_buka=?, jam_tutup=?, is_open=? WHERE id=?', [nama.slice(0, 60), (f.deskripsi || '').trim().slice(0, 200), lokasi.slice(0, 120), f.buka, f.tutup, f.is_open ? 1 : 0, m.id]);
  invalidate(); return redirect('/panel/toko', { type: 'ok', msg: 'Pengaturan kedai disimpan.' });
});
