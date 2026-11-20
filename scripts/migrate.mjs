// Menerapkan supabase/migrations/*.sql ke database di DATABASE_URL.
// Gunakan connection string "Session pooler" (port 5432) atau Direct dari dashboard Supabase untuk migrasi.
// Alternatif tanpa Node: tempel isi supabase/migrations/0001_init.sql di Supabase → SQL Editor lalu Run.
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL dulu.'); process.exit(1); }
const dir = new URL('../supabase/migrations/', import.meta.url);
const client = new pg.Client({ connectionString: url, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await client.query(readFileSync(new URL(f, dir), 'utf8'));
    console.log('Diterapkan:', f);
  }
} finally { await client.end(); }
