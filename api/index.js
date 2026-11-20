// Fungsi serverless Vercel: seluruh rute aplikasi ditangani satu handler (lihat rewrites di vercel.json).
import { createHandler } from '../server.js';
import { openDb } from '../src/db.js';

let ready; // dipakai ulang selama instance masih hangat (koneksi DB tidak dibuat ulang tiap request)
function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur. Isi dengan connection string Supabase (Transaction pooler) di Vercel → Settings → Environment Variables.');
  return openDb().then((db) => createHandler(db, { quiet: true }));
}

export default async function handler(req, res) {
  try {
    ready ??= init();
    return await (await ready)(req, res);
  } catch (e) {
    ready = undefined; // coba lagi pada request berikutnya
    console.error('Gagal memulai aplikasi:', e.message);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); }
    res.end('Layanan sedang bermasalah. Coba lagi sebentar.');
  }
}
