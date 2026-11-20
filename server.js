// Server HTTP tanpa dependensi. Fitur hijau: kompresi br/gzip, ETag + 304, aset immutable ber-hash, cache data.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, dirname, extname } from 'node:path';
import { openDb } from './src/db.js';
import { seed, ensureSlots } from './src/seed.js';
import { loadSession, destroySession } from './src/auth.js';
import { THEME_SCRIPT } from './src/views.js';
import { routes as publicRoutes } from './src/routes_public.js';
import { panelRoutes } from './src/routes_panel.js';
import { cartCount, page, redirect } from './src/helpers.js';
import { AppError, parseCookies, readForm, todayWIB, html } from './src/util.js';
import { swdmPageView } from './src/carbon.js';
import manifest from './src/assets.manifest.json' with { type: 'json' };

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

// ---- Aset statis ----
// Di Vercel, public/assets/* disajikan langsung oleh CDN (lihat vercel.json) dan tidak lewat fungsi ini.
// Jalur di bawah dipakai saat dijalankan lokal (npm start): dibaca & dikompres sekali (lazy), cache 1 tahun.
const ASSET_URLS = Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.url]));
const assetGz = Object.values(manifest).reduce((a, m) => a + m.gz, 0);
const assetCache = new Map();
function loadAsset(urlPath) {
  if (assetCache.has(urlPath)) return assetCache.get(urlPath);
  let a = null;
  const isHashed = Object.values(manifest).some((m) => m.url === urlPath);
  const file = isHashed ? join(ROOT, 'public', urlPath) : urlPath === '/favicon.svg' ? join(ROOT, 'public/favicon.svg') : null;
  if (file) {
    const body = readFileSync(file), hash = createHash('sha1').update(body).digest('hex').slice(0, 8);
    a = { type: MIME[extname(file)], etag: `"${hash}"`, raw: body, gz: gzipSync(body, { level: 9 }),
      br: brotliCompressSync(body, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }),
      cache: isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400' };
  }
  assetCache.set(urlPath, a); return a;
}
const themeHash = createHash('sha256').update(THEME_SCRIPT).digest('base64');
const SEC = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'sha256-${themeHash}'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};

function compile(list) {
  return list.map((r) => ({ ...r, re: new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));
}
const ALL = compile([...publicRoutes, ...panelRoutes]);

function negotiate(req, buf, type) {
  const ae = req.headers['accept-encoding'] || '';
  if (buf.length < 1024) return { enc: null, body: buf };
  if (/\bbr\b/.test(ae)) return { enc: 'br', body: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 4 } }) };
  if (/\bgzip\b/.test(ae)) return { enc: 'gzip', body: gzipSync(buf, { level: 6 }) };
  return { enc: null, body: buf };
}

// Handler (req, res) murni: dipakai server lokal (npm start) maupun fungsi serverless Vercel (api/index.js).
export function createHandler(db, { quiet = false } = {}) {
  let slotDay = null;
  return async (req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      const url = new URL(req.url, 'http://x');
      // --- aset statis ---
      const a = loadAsset(url.pathname);
      if (a && (req.method === 'GET' || req.method === 'HEAD')) {
        const ae = req.headers['accept-encoding'] || '';
        const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gz' : null;
        const h = { 'Content-Type': a.type, 'Cache-Control': a.cache, ETag: a.etag, Vary: 'Accept-Encoding', ...SEC };
        if (req.headers['if-none-match'] === a.etag) { res.writeHead(304, h); return res.end(); }
        const body = enc ? a[enc] : a.raw; if (enc) h['Content-Encoding'] = enc === 'gz' ? 'gzip' : 'br';
        h['Content-Length'] = body.length; res.writeHead(200, h); return res.end(req.method === 'HEAD' ? undefined : body);
      }
      // --- konteks permintaan ---
      if (todayWIB() !== slotDay) { slotDay = todayWIB(); try { await ensureSlots(db); } catch (e) { slotDay = null; console.error('ensureSlots gagal', e); } }
      const cookies = parseCookies(req.headers.cookie);
      const session = await loadSession(db, cookies.sid);
      let flash = null; try { if (cookies.flash) flash = JSON.parse(Buffer.from(cookies.flash, 'base64url').toString()); } catch { /* abaikan */ }
      const ctx = { req, url, db, session, user: session?.user || null, cartCount: cartCount(session?.cart), flash, assets: ASSET_URLS,
        path: url.pathname, ip: clientIp(req), form: {}, params: {} };

      let result;
      try {
        const route = ALL.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!route) { result = page(ctx, 'Tidak ditemukan', html`<div class="empty card"><h1>404</h1><p class="muted">Halaman tidak ditemukan.</p><a class="btn" href="/">Ke beranda</a></div>`, 404); }
        else {
          ctx.params = url.pathname.match(route.re).groups || {};
          if (req.method === 'POST') {
            const origin = req.headers.origin; // perlindungan CSRF tambahan di atas SameSite=Lax
            if (origin && new URL(origin).host !== req.headers.host) throw new AppError('Permintaan lintas situs ditolak.', 403);
            ctx.form = await readForm(req);
          }
          if (route.auth && !ctx.user) result = redirect('/masuk?next=' + encodeURIComponent(req.method === 'GET' ? url.pathname : ctx.form.back || '/'), { type: 'error', msg: 'Masuk dulu untuk melanjutkan.' });
          else if (route.auth && ctx.user.role !== route.auth) result = redirect(ctx.user.role === 'MERCHANT' ? '/panel' : '/', { type: 'error', msg: 'Halaman itu tidak tersedia untuk akunmu.' });
          else if (req.method === 'GET' && url.pathname === '/' && ctx.user?.role === 'MERCHANT') result = redirect('/panel');
          else result = await route.handler(ctx);
        }
      } catch (e) {
        if (e instanceof AppError) result = page({ ...ctx, flash: null }, e.status === 404 ? 'Tidak ditemukan' : 'Ups', html`<div class="empty card"><h1>${e.status}</h1><p>${e.message}</p><a class="btn" href="/">Ke beranda</a></div>`, e.status);
        else { console.error(e); result = page({ ...ctx, flash: null }, 'Kesalahan', html`<div class="empty card"><h1>500</h1><p>Terjadi kesalahan di server.</p><a class="btn" href="/">Ke beranda</a></div>`, 500); }
      }
      await send(req, res, ctx, result, session);
      if (!quiet) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)}ms`);
    } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500); res.end('Server error'); }
  };

  async function send(req, res, ctx, r, session) {
    const cookies = [];
    const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const cookie = (n, v, extra = '') => `${n}=${v}; Path=/; HttpOnly; SameSite=Lax${secure}${extra}`;
    if (r.setSid) cookies.push(cookie('sid', r.setSid, '; Max-Age=604800'));
    if (r.setSid === null) { cookies.push(cookie('sid', '', '; Max-Age=0')); if (session) await destroySession(db, session.sid); }
    if (r.flash) cookies.push(cookie('flash', Buffer.from(JSON.stringify({ type: r.flash.type, msg: String(r.flash.msg), link: r.flash.link })).toString('base64url'), '; Max-Age=30'));
    else if (ctx.flash) cookies.push(cookie('flash', '', '; Max-Age=0'));
    const h = { ...SEC, Vary: 'Accept-Encoding, Cookie' };
    if (cookies.length) h['Set-Cookie'] = cookies;
    if (r.location) { res.writeHead(r.status || 303, { ...h, Location: r.location }); return res.end(); }
    let body = String(r.body?.s ?? r.body);
    // Jejak digital halaman ini (estimasi SWDM v4): ukuran HTML terkompresi + CSS + JS.
    const bare = body.replace('<!--FP-->', '');
    const htmlGz = gzipSync(bare, { level: 6 }).length, first = htmlGz + assetGz;
    const g = swdmPageView(first);
    body = body.replace('<!--FP-->', `Jejak digital halaman ini: ±${(first / 1000).toFixed(1).replace('.', ',')} KB kunjungan pertama, ±${(htmlGz / 1000).toFixed(1).replace('.', ',')} KB kunjungan ulang (CSS/JS ter-cache) · estimasi ≈ ${(g * 1000).toFixed(1).replace('.', ',')} mgCO₂e per tampilan (SWDM v4, estimasi).`);
    const buf = Buffer.from(body);
    const etag = '"' + createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
    const base = { ...h, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache', ETag: etag };
    if ((r.status || 200) === 200 && req.method === 'GET' && req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
    const { enc, body: out } = negotiate(req, buf);
    if (enc) base['Content-Encoding'] = enc;
    base['Content-Length'] = out.length;
    res.writeHead(r.status || 200, base); res.end(req.method === 'HEAD' ? undefined : out);
  }
}

export const createServer = (db, opts) => http.createServer(createHandler(db, opts));

// IP klien untuk pembatas login. Header X-Forwarded-For hanya dipercaya di balik proxy Vercel.
function clientIp(req) {
  const xf = process.env.VERCEL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || '';
}

// ---- Start (lokal): npm start ----
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await openDb();
  if ((await db.get('SELECT COUNT(*) AS n FROM "user"')).n === 0) { await seed(db); console.log('Database kosong, data demo dimuat (password demo: demo1234).'); }
  const port = Number(process.env.PORT) || 3000;
  createServer(db).listen(port, () => console.log(`JemputMakan berjalan di http://localhost:${port} (${db.dialect})`));
}
