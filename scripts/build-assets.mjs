// Membuat aset statis ber-hash di public/assets/ (disajikan CDN Vercel dengan cache immutable)
// dan manifest ukuran terkompresi (dipakai estimasi "jejak digital halaman").
// Jalankan: npm run build   (juga dijalankan otomatis oleh Vercel sebelum deploy)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { extname, basename } from 'node:path';

const SRC = new URL('../assets/', import.meta.url), OUT = new URL('../public/assets/', import.meta.url);
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const f of readdirSync(SRC)) {
  const body = readFileSync(new URL(f, SRC)), ext = extname(f);
  const hash = createHash('sha1').update(body).digest('hex').slice(0, 8);
  const name = `${basename(f, ext)}.${hash}${ext}`;
  writeFileSync(new URL(name, OUT), body);
  manifest[f] = { url: `/assets/${name}`, bytes: body.length, gz: gzipSync(body, { level: 9 }).length,
    br: brotliCompressSync(body, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length };
}
writeFileSync(new URL('../src/assets.manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log('Aset dibuat:', Object.values(manifest).map((m) => `${m.url} (${m.bytes} B, gzip ${m.gz} B)`).join(', '));
