// Alat uji (BUKAN kode produksi): menjalankan antarmuka db.{all,get,run,tx} di atas PostgreSQL asli lewat `psql`,
// untuk memverifikasi bahwa SQL aplikasi valid dan berperilaku benar di PostgreSQL ketika driver `pg` tidak tersedia.
// Parameter di-inline sebagai literal ber-escape, jadi pengikatan $1..$n milik driver `pg` TIDAK ikut teruji di sini.
import { spawn } from 'node:child_process';
import { schemaSql } from '../../db/schema.js';

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') { if (!Number.isFinite(Number(v))) throw new Error('angka tidak valid'); return String(v); }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
};
const inline = (sql, params) => { let i = 0; const out = sql.replace(/\?/g, () => lit(params[i++])); if (i !== params.length) throw new Error(`jumlah parameter tidak cocok: ${i} placeholder, ${params.length} nilai\n${sql}`); return out; };

export async function openPsqlDb(url, { reset = true } = {}) {
  const proc = spawn('sh', ['-c', `exec psql -X -q -A -t -P pager=off -v VERBOSITY=verbose -v ON_ERROR_STOP=0 "${url}" 2>&1`], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', waiter = null, n = 0;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => { buf += d; check(); });
  const check = () => { if (!waiter) return; const m = buf.indexOf(`__END__${waiter.id}\n`); if (m < 0) return; const out = buf.slice(0, m); buf = buf.slice(m + `__END__${waiter.id}\n`.length); const w = waiter; waiter = null; w.resolve(out); };
  const send = (text) => new Promise((resolve) => { const id = ++n; waiter = { id, resolve }; proc.stdin.write(text + `\n\\echo __END__${id}\n`); check(); });
  const fail = (out, sql) => { const m = out.match(/ERROR:\s+(\w{5}):\s*(.*)/); if (m) { const e = new Error(`${m[2]}\n--- SQL: ${sql.slice(0, 300)}`); e.code = m[1]; throw e; } };
  const rows = async (sql, params, wrapRet) => {
    let q = inline(sql, params).trim().replace(/;$/, '');
    if (wrapRet && !/\bRETURNING\b/i.test(q)) q += ' RETURNING 1';
    const out = await send(`WITH t AS (${q}) SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM t;`);
    fail(out, q);
    const line = out.split('\n').find((l) => l.startsWith('['));
    if (!line) throw new Error('keluaran psql tak terduga: ' + out.slice(0, 200));
    return JSON.parse(line);
  };
  const ops = {
    dialect: 'pg',
    all: (sql, p = []) => rows(sql, p, false),
    get: async (sql, p = []) => (await rows(sql, p, false))[0],
    run: async (sql, p = []) => ({ changes: (await rows(sql, p, true)).length }),
  };
  let tail = Promise.resolve();
  const locked = (fn) => { const r = tail.then(fn, fn); tail = r.then(() => {}, () => {}); return r; };
  const exec = async (sql) => { const out = await send(sql); fail(out, sql); };
  if (reset) { await exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); }
  await exec(schemaSql('pg'));
  return {
    dialect: 'pg',
    all: (s, p) => locked(() => ops.all(s, p)), get: (s, p) => locked(() => ops.get(s, p)), run: (s, p) => locked(() => ops.run(s, p)),
    tx: (fn) => locked(async () => {
      await exec('BEGIN;');
      try { const r = await fn(ops); await exec('COMMIT;'); return r; } catch (e) { await exec('ROLLBACK;'); throw e; }
    }),
    close: async () => { proc.stdin.end(); },
  };
}
