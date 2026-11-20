import { randomInt } from 'node:crypto';
import { AppError, nowWIB } from './util.js';

export const STATUS = {
  MENUNGGU: 'MENUNGGU_KONFIRMASI', DIPROSES: 'DIPROSES', SIAP: 'SIAP_DIAMBIL',
  SELESAI: 'SELESAI', DITOLAK: 'DITOLAK', DIBATALKAN: 'DIBATALKAN',
};
// State machine (divalidasi di server). Tidak ada status pengantaran.
export const TRANSITIONS = {
  [STATUS.MENUNGGU]: { terima: STATUS.DIPROSES, tolak: STATUS.DITOLAK, batal: STATUS.DIBATALKAN },
  [STATUS.DIPROSES]: { siap: STATUS.SIAP },
  [STATUS.SIAP]: { verifikasi: STATUS.SELESAI },
};
const ACTOR = { terima: 'MERCHANT', tolak: 'MERCHANT', siap: 'MERCHANT', verifikasi: 'MERCHANT', batal: 'MAHASISWA' };
export const nextStatus = (cur, action) => TRANSITIONS[cur]?.[action] ?? null;

export const STATUS_LABEL = {
  MENUNGGU_KONFIRMASI: 'Menunggu konfirmasi', DIPROSES: 'Diproses', SIAP_DIAMBIL: 'Siap diambil',
  SELESAI: 'Selesai', DITOLAK: 'Ditolak', DIBATALKAN: 'Dibatalkan',
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // tanpa karakter yang mudah tertukar
const makeCode = () => 'JM-' + Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const marks = (n) => Array.from({ length: n }, () => '?').join(',');

// cart = { merchant_id, items: { "<menuId>": qty } }
export async function createOrder(db0, { userId, cart, slotId, titikAsal = '', catatan = '' }) {
  const ids = Object.keys(cart?.items || {}).map(Number).filter(Boolean);
  if (!cart?.merchant_id || ids.length === 0) throw new AppError('Keranjang masih kosong.');
  return db0.tx(async (db) => {
    const merchant = await db.get('SELECT id, nama FROM merchant WHERE id = ?', [cart.merchant_id]);
    if (!merchant) throw new AppError('Merchant tidak ditemukan.', 404);
    const menus = await db.all(`SELECT id, nama, harga, is_available FROM menu WHERE merchant_id = ? AND id IN (${marks(ids.length)})`, [merchant.id, ...ids]);
    if (menus.length !== ids.length) throw new AppError('Sebagian menu di keranjang sudah tidak tersedia. Periksa keranjangmu.');
    const habis = menus.find((m) => !m.is_available);
    if (habis) throw new AppError(`Menu "${habis.nama}" sedang habis. Hapus dari keranjang untuk melanjutkan.`);

    // Kunci baris slot sampai transaksi selesai agar dua pesanan tidak merebut kuota yang sama.
    const slot = await db.get('SELECT * FROM pickup_slot WHERE id = ? AND merchant_id = ? FOR UPDATE', [slotId, merchant.id]);
    if (!slot) throw new AppError('Pilih slot waktu pengambilan.');
    if (slot.waktu_selesai <= nowWIB()) throw new AppError('Slot yang dipilih sudah lewat. Pilih slot lain.');
    if (slot.terpakai >= slot.kuota) throw new AppError('Kuota slot yang dipilih sudah penuh. Pilih slot lain.');

    let total = 0;
    const lines = menus.map((m) => { const q = cart.items[m.id]; total += m.harga * q; return { m, q }; }); // total dihitung di server
    let orderId;
    for (let i = 0; i < 8 && !orderId; i++) { // ON CONFLICT: tabrakan kode tidak membatalkan transaksi di PostgreSQL
      const r = await db.get(`INSERT INTO orders (user_id, merchant_id, pickup_slot_id, pickup_code, status, total_bayar, catatan, titik_asal, created_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (pickup_code) DO NOTHING RETURNING id`,
      [userId, merchant.id, slot.id, makeCode(), STATUS.MENUNGGU, total, catatan.slice(0, 200), titikAsal, nowWIB()]);
      orderId = r?.id;
    }
    if (!orderId) throw new AppError('Gagal membuat kode pengambilan. Coba lagi.', 500);
    for (const { m, q } of lines) // snapshot nama & harga
      await db.run('INSERT INTO order_detail (order_id, menu_id, nama_menu_snapshot, harga_snapshot, jumlah) VALUES (?,?,?,?,?)', [orderId, m.id, m.nama, m.harga, q]);
    const upd = await db.run('UPDATE pickup_slot SET terpakai = terpakai + 1 WHERE id = ? AND terpakai < kuota', [slot.id]);
    if (!upd.changes) throw new AppError('Kuota slot yang dipilih sudah penuh. Pilih slot lain.');
    return Number(orderId);
  });
}

// action: terima | tolak | siap | verifikasi | batal
export async function applyAction(db0, { orderId, actor, action, code }) {
  return db0.tx(async (db) => {
    const o = await db.get('SELECT o.*, m.user_id AS merchant_user FROM orders o JOIN merchant m ON m.id = o.merchant_id WHERE o.id = ? FOR UPDATE OF o', [orderId]);
    if (!o) throw new AppError('Pesanan tidak ditemukan.', 404);
    if (ACTOR[action] !== actor.role) throw new AppError('Aksi ini tidak diizinkan untuk akunmu.', 403);
    const mine = actor.role === 'MERCHANT' ? o.merchant_user === actor.id : o.user_id === actor.id;
    if (!mine) throw new AppError('Pesanan tidak ditemukan.', 404); // sengaja 404: hindari IDOR/enumerasi
    const next = nextStatus(o.status, action);
    if (!next) throw new AppError(`Pesanan berstatus "${STATUS_LABEL[o.status]}" tidak dapat diubah dengan aksi ini.`, 409);
    if (action === 'verifikasi' && String(code || '').trim().toUpperCase() !== o.pickup_code) throw new AppError('Kode pengambilan tidak cocok.', 403);
    await db.run('UPDATE orders SET status = ? WHERE id = ?', [next, o.id]);
    if (next === STATUS.DITOLAK || next === STATUS.DIBATALKAN) // kembalikan kuota slot
      await db.run('UPDATE pickup_slot SET terpakai = CASE WHEN terpakai > 0 THEN terpakai - 1 ELSE 0 END WHERE id = ?', [o.pickup_slot_id]);
    return { id: o.id, from: o.status, to: next };
  });
}

// Verifikasi kode oleh merchant: cari pesanan SIAP_DIAMBIL milik merchant ini.
export async function verifyByCode(db, { merchantUserId, code }) {
  const c = String(code || '').trim().toUpperCase();
  const o = await db.get(`SELECT o.id, o.status FROM orders o JOIN merchant m ON m.id = o.merchant_id
                        WHERE o.pickup_code = ? AND m.user_id = ?`, [c, merchantUserId]);
  if (!o) throw new AppError('Kode tidak ditemukan di kedaimu.', 404);
  if (o.status !== STATUS.SIAP) throw new AppError(`Pesanan ini berstatus "${STATUS_LABEL[o.status]}", belum bisa diserahkan.`, 409);
  return applyAction(db, { orderId: o.id, actor: { role: 'MERCHANT', id: merchantUserId }, action: 'verifikasi', code: c });
}
