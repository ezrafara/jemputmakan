// Tes khusus PostgreSQL (jalan hanya bila TEST_PSQL_URL diisi; lihat scripts/test-pg.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPsqlDb } from './support/psql-db.js';
import { seed } from '../src/seed.js';
import { TABLE_NAMES } from '../db/schema.js';
import { isUniqueViolation } from '../src/db.js';

const url = process.env.TEST_PSQL_URL;
const t = url ? test : test.skip;

t('PostgreSQL asli: dialek pg, versi 16, skema + seed berhasil', async () => {
  const db = await openPsqlDb(url); await seed(db);
  assert.equal(db.dialect, 'pg');
  const v = await db.get('SELECT current_setting(\'server_version_num\')::int AS v');
  assert.ok(v.v >= 150000, 'versi ' + v.v);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM merchant')).n, 5);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM pickup_slot')).n > 100, true);
  // seed kedua (ensureSlots) harus idempoten: tidak menambah/gagal walau slot sudah ada
  const { ensureSlots } = await import('../src/seed.js');
  const before = (await db.get('SELECT COUNT(*) AS n FROM pickup_slot')).n;
  await ensureSlots(db);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM pickup_slot')).n, before);
  await db.close();
});

t('Supabase: RLS aktif pada semua tabel (API anon tertutup)', async () => {
  const db = await openPsqlDb(url);
  const rows = await db.all("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'");
  assert.equal(rows.length, TABLE_NAMES.length);
  for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
  await db.close();
});

t('Transaksi: ROLLBACK membatalkan semua perubahan; pelanggaran UNIQUE memberi kode 23505', async () => {
  const db = await openPsqlDb(url); await seed(db);
  const n0 = (await db.get('SELECT COUNT(*) AS n FROM category')).n;
  await assert.rejects(db.tx(async (d) => { await d.run('INSERT INTO category (nama) VALUES (?)', ['Baru']); throw new Error('gagal'); }), /gagal/);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM category')).n, n0);
  await assert.rejects(db.run('INSERT INTO category (nama) VALUES (?)', ['Snack']), (e) => e.code === '23505' && isUniqueViolation(e));
  await db.close();
});

t('ON CONFLICT DO NOTHING di dalam transaksi tidak membuat transaksi batal (retry kode pesanan aman)', async () => {
  const db = await openPsqlDb(url); await seed(db);
  const r = await db.tx(async (d) => {
    const a = await d.run('INSERT INTO category (nama) VALUES (?) ON CONFLICT DO NOTHING', ['Snack']);
    const b = await d.run('INSERT INTO category (nama) VALUES (?) ON CONFLICT DO NOTHING', ['Dessert']);
    return [a.changes, b.changes];
  });
  assert.deepEqual(r, [0, 1]);
  await db.close();
});
