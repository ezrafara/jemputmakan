// Mensimulasikan perilaku runtime Vercel: body form sudah di-parse ke req.body (stream habis).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createHandler } from '../server.js';

test('Handler tetap bekerja saat req.body sudah di-parse (seperti fungsi Vercel)', async () => {
  const db = await openDb(':memory:', null); await seed(db);
  const handler = createHandler(db, { quiet: true });
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    if (raw) req.body = Object.fromEntries(new URLSearchParams(raw)); // gaya Vercel: objek, stream sudah terbaca
    return handler(req, res);
  });
  await new Promise((ok) => srv.listen(0, ok));
  const base = `http://localhost:${srv.address().port}`;
  const r = await fetch(base + '/masuk', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'faradila@student.ub.ac.id', password: 'demo1234' }) });
  assert.equal(r.status, 303);
  assert.match(r.headers.getSetCookie().join(';'), /sid=[0-9a-f]{64}/);
  srv.close(); await db.close();
});

test('api/index.js menolak start tanpa DATABASE_URL dengan pesan jelas (bukan crash)', async () => {
  const old = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const { default: handler } = await import('../api/index.js');
  const res = { statusCode: 0, headers: {}, headersSent: false, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ url: '/', method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 500); assert.match(res.body, /bermasalah/);
  if (old) process.env.DATABASE_URL = old;
});
