import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { nowMs } from './util.js';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const a = scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Sesi disimpan di database (bukan memori) agar bekerja di serverless / banyak instance.
const SESSION_MS = 7 * 864e5;
export async function createSession(db, userId) {
  const id = randomBytes(32).toString('hex');
  await db.run('INSERT INTO session (id, user_id, expires) VALUES (?,?,?)', [id, userId, nowMs() + SESSION_MS]);
  return id;
}
export async function loadSession(db, sid) {
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const row = await db.get(`SELECT s.id, s.cart, s.expires, u.id AS uid, u.nama, u.email, u.role
                          FROM session s JOIN "user" u ON u.id = s.user_id WHERE s.id = ?`, [sid]);
  if (!row || row.expires < nowMs()) { if (row) await destroySession(db, sid); return null; }
  let cart = {}; try { cart = JSON.parse(row.cart); } catch { /* keranjang rusak -> kosong */ }
  return { sid: row.id, cart, user: { id: row.uid, nama: row.nama, email: row.email, role: row.role } };
}
export const saveCart = (db, sid, cart) => db.run('UPDATE session SET cart = ? WHERE id = ?', [JSON.stringify(cart), sid]);
export const destroySession = (db, sid) => db.run('DELETE FROM session WHERE id = ?', [sid]);

// Pembatas percobaan login: 5 gagal / 15 menit per ip+email, disimpan di database (konsisten antar instance).
const WINDOW = 15 * 60e3, MAX = 5;
export async function loginBlocked(db, key) {
  const a = await db.get('SELECT fails, first_at FROM login_attempt WHERE attempt_key = ?', [key]);
  if (!a) return false;
  if (nowMs() - a.first_at > WINDOW) { await db.run('DELETE FROM login_attempt WHERE attempt_key = ?', [key]); return false; }
  return a.fails >= MAX;
}
export async function loginFailed(db, key) {
  const a = await db.get('SELECT fails, first_at FROM login_attempt WHERE attempt_key = ?', [key]);
  if (!a || nowMs() - a.first_at > WINDOW)
    await db.run('INSERT INTO login_attempt (attempt_key, fails, first_at) VALUES (?,1,?) ON CONFLICT (attempt_key) DO UPDATE SET fails = 1, first_at = ?', [key, nowMs(), nowMs()]);
  else await db.run('UPDATE login_attempt SET fails = fails + 1 WHERE attempt_key = ?', [key]);
}
export const loginOk = (db, key) => db.run('DELETE FROM login_attempt WHERE attempt_key = ?', [key]);
