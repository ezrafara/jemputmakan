import { layout } from './views.js';
import { cached } from './cache.js';
import { timeWIB } from './util.js';

export const page = (ctx, title, body, status = 200) => ({ status, body: layout(ctx, { title, body }) });
export const redirect = (location, flash) => ({ status: 303, location, flash });
export const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(n) ? n : null);
export const cartCount = (cart) => Object.values(cart?.items || {}).reduce((a, b) => a + b, 0);

// ---- Data yang jarang berubah -> di-cache, di-invalidate saat merchant mengubah data ----
export const getCategories = (db) => cached('categories', () => db.all('SELECT id, nama FROM category ORDER BY id'));
export function getMerchants(db) {
  return cached('merchants', async () => {
    // Diagregasi di JS (bukan group_concat/string_agg) supaya SQL sama persis di SQLite dan PostgreSQL.
    const [ms, dist, menus] = await Promise.all([
      db.all('SELECT * FROM merchant ORDER BY nama'),
      db.all('SELECT merchant_id, jarak_jalan_km FROM merchant_distance'),
      db.all('SELECT merchant_id, category_id, nama, is_available FROM menu'),
    ]);
    return ms.map((m) => {
      const d = dist.filter((x) => x.merchant_id === m.id), mn = menus.filter((x) => x.merchant_id === m.id);
      return { ...m,
        jalan_rata: d.length ? d.reduce((a, x) => a + x.jarak_jalan_km, 0) / d.length : null,
        jumlah_menu: mn.filter((x) => x.is_available).length,
        kata: mn.map((x) => x.nama.toLowerCase()).join(' '),
        kats: [...new Set(mn.map((x) => x.category_id))] };
    });
  });
}
export const getMerchant = async (db, id) => (await getMerchants(db)).find((m) => m.id === id) || null;
export const withOpen = (m) => { const t = timeWIB(); return { ...m, buka_sekarang: !!m.is_open && m.jam_buka <= t && t < m.jam_tutup }; };
export const getMenus = (db, merchantId) => cached('menu:' + merchantId, () =>
  db.all('SELECT id, category_id, nama, deskripsi, harga, is_available FROM menu WHERE merchant_id = ? ORDER BY category_id, nama', [merchantId]));
export const getDistances = (db, merchantId) => cached('dist:' + merchantId, () =>
  db.all('SELECT titik_asal, jarak_motor_km, jarak_jalan_km, sumber FROM merchant_distance WHERE merchant_id = ? ORDER BY id', [merchantId]));

// Jarak motor referensi untuk sebuah pesanan (titik asal terpilih, atau rata-rata merchant).
export async function jarakMotor(db, merchantId, titik) {
  const ds = await getDistances(db, merchantId);
  const d = ds.find((x) => x.titik_asal === titik);
  if (d) return d.jarak_motor_km;
  return ds.length ? ds.reduce((a, x) => a + x.jarak_motor_km, 0) / ds.length : 0;
}

export async function cartLines(db, cart) {
  const ids = Object.keys(cart?.items || {}).map(Number).filter(Boolean);
  if (!ids.length) return { merchant: null, lines: [], subtotal: 0, allAvailable: true, changed: false };
  const rows = await db.all(`SELECT id, merchant_id, nama, harga, is_available FROM menu WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const lines = rows.filter((r) => r.merchant_id === cart.merchant_id).map((r) => ({ ...r, qty: cart.items[r.id] }));
  const merchant = await getMerchant(db, cart.merchant_id);
  return {
    merchant, lines,
    subtotal: lines.reduce((a, l) => a + l.harga * l.qty, 0),
    allAvailable: lines.every((l) => l.is_available),
    changed: lines.length !== ids.length,
  };
}
