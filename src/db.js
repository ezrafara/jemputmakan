// Lapisan database async dengan dua backend di balik antarmuka yang sama:
//   - PostgreSQL (Supabase) bila DATABASE_URL diisi  -> produksi / Vercel
//   - SQLite bawaan Node (node:sqlite)               -> pengembangan lokal & tes cepat
// API: db.all(sql, params) · db.get(sql, params) · db.run(sql, params) · db.tx(async (db) => ...)
// SQL ditulis dengan placeholder "?" dan dikonversi ke $1,$2,... untuk PostgreSQL.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { schemaSql } from '../db/schema.js';

// Muat .env.local (bila ada) untuk pengembangan lokal. Di Vercel variabel datang dari dashboard, file ini tidak ada.
try { process.loadEnvFile('.env.local'); } catch { /* tidak ada .env.local: lewati */ }

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
const forSqlite = (sql) => sql.replace(/\s+FOR UPDATE( OF \w+)?/gi, ''); // SQLite: transaksi sudah serial
export const isUniqueViolation = (e) => e?.code === '23505' || /UNIQUE constraint/i.test(String(e?.message));

// ---------------- SQLite ----------------
async function sqliteBackend(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;');
  raw.exec(schemaSql('sqlite'));
  const cache = new Map();
  const prep = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(forSqlite(sql)); cache.set(sql, s); } return s; };
  const plain = (r) => (r ? { ...r } : undefined);
  const ops = {
    dialect: 'sqlite',
    all: async (sql, p = []) => prep(sql).all(...p).map(plain),
    get: async (sql, p = []) => plain(prep(sql).get(...p)),
    run: async (sql, p = []) => ({ changes: Number(prep(sql).run(...p).changes) }),
  };
  // Satu koneksi: serialkan transaksi supaya perintah request lain tidak menyusup di tengahnya.
  let tail = Promise.resolve();
  const locked = (fn) => { const r = tail.then(fn, fn); tail = r.then(() => {}, () => {}); return r; };
  return {
    dialect: 'sqlite',
    all: (s, p) => locked(() => ops.all(s, p)), get: (s, p) => locked(() => ops.get(s, p)), run: (s, p) => locked(() => ops.run(s, p)),
    tx: (fn) => locked(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try { const r = await fn(ops); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    }),
    close: async () => raw.close(),
  };
}

// ---------------- PostgreSQL (Supabase) ----------------
async function pgBackend(url) {
  const { default: pg } = await import('pg'); // dependensi produksi (package.json)
  pg.types.setTypeParser(20, Number);          // BIGINT -> number (kolom expires/first_at)
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.PGSSL === 'disable';
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX) || 3,       // kecil: tiap instance serverless punya pool sendiri
    idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000,
    ssl: local ? false : { rejectUnauthorized: false }, // Supabase mewajibkan SSL
  });
  const mk = (c) => ({
    dialect: 'pg',
    all: async (sql, p = []) => (await c.query(toPg(sql), p)).rows,
    get: async (sql, p = []) => (await c.query(toPg(sql), p)).rows[0],
    run: async (sql, p = []) => ({ changes: (await c.query(toPg(sql), p)).rowCount }),
  });
  const base = mk(pool);
  return {
    ...base,
    tx: async (fn) => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(mk(c)); await c.query('COMMIT'); return r; }
      catch (e) { try { await c.query('ROLLBACK'); } catch { /* koneksi sudah putus */ } throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

export async function openDb(file = process.env.DB_FILE || 'data/jemputmakan.db', url = process.env.DATABASE_URL) {
  return url ? pgBackend(url) : sqliteBackend(file);
}
