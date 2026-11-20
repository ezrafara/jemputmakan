// Layout dan komponen bersama. Semua HTML dirender di server; JS klien hanya untuk toggle tema.
import { html, raw, rupiah, num } from './util.js';
import { STATUS_LABEL } from './orders.js';

const P = {
  leaf: 'M5 21c0-9 5-15 15-16 0 10-6 15-15 16zM5 21c2-5 5-8 9-10',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
  cart: 'M3 4h2l2.4 11h10.2l2-8H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  moon: 'M20 14A8 8 0 1110 4a7 7 0 0010 10z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  pin: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  walk: 'M13 4a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM10 21l2-6-3-3 1-5 3 2 3 1M7 12l-2 3',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10',
  menu: 'M4 6h16M4 12h16M4 18h16',
  check: 'M5 13l4 4L19 7',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  store: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 004 0M10 20v-6h4v6',
  key: 'M14 10a4 4 0 11-8 0 4 4 0 018 0zM12.5 12.5L20 20M17 17l2-2',
};
export const icon = (n, cls = 'ic') => raw(`<svg class="${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`);

export const THEME_SCRIPT = "(function(){try{var t=localStorage.getItem('jm-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()";

const studentNav = (user, cartCount) => [
  ['/', 'Beranda', 'home'], ['/pesanan', 'Pesanan', 'receipt'], ['/keranjang', 'Keranjang', 'cart', cartCount],
  user ? ['/profil', 'Profil', 'user'] : ['/masuk', 'Masuk', 'user'],
];
const panelNav = [
  ['/panel', 'Pesanan masuk', 'receipt'], ['/panel/verifikasi', 'Verifikasi kode', 'key'],
  ['/panel/menu', 'Menu', 'menu'], ['/panel/slot', 'Slot pengambilan', 'clock'], ['/panel/toko', 'Pengaturan kedai', 'store'],
];
const isActive = (path, href) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

function navLink([href, label, ic, badge], path, cls = '') {
  const a = isActive(path, href);
  return html`<a href="${href}" class="${cls}${a ? ' active' : ''}"${a ? raw(' aria-current="page"') : ''}>${icon(ic)}<span>${label}</span>${badge ? html`<b class="count" aria-label="${badge} item">${badge}</b>` : ''}</a>`;
}

export function layout(ctx, { title, body, description = 'JemputMakan: pesan dulu, ambil sendiri di warung dan kafe sekitar kampus.' }) {
  const { user, cartCount = 0, flash, path } = ctx;
  const panel = user?.role === 'MERCHANT';
  const nav = panel ? [] : studentNav(user, cartCount);
  return html`<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${description}">
<title>${title} · JemputMakan</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>${raw(THEME_SCRIPT)}</script>
<link rel="stylesheet" href="${ctx.assets['style.css']}">
<script defer src="${ctx.assets['app.js']}"></script>
</head><body>
<a class="skip" href="#main">Lewati ke konten</a>
<header class="topbar"><div class="container bar">
  <a class="brand" href="${panel ? '/panel' : '/'}">${icon('leaf', 'ic brand-ic')}<span>JemputMakan</span></a>
  <nav class="topnav" aria-label="Navigasi utama">${nav.map((n) => navLink(n, path))}</nav>
  <div class="bar-end">
    ${panel ? html`<span class="who">${user.nama}</span><form method="post" action="/keluar"><button class="btn btn-ghost btn-sm">Keluar</button></form>` : ''}
    <button class="icon-btn" type="button" data-theme-toggle aria-label="Ganti tema terang/gelap">${icon('moon')}</button>
  </div>
</div></header>
${panel ? html`<div class="container panel"><aside class="sidebar" aria-label="Menu merchant">${panelNav.map((n) => navLink(n, path))}</aside><main id="main" class="panel-main">${flashBox(flash)}${body}</main></div>`
    : html`<main id="main" class="container main">${flashBox(flash)}${body}</main>`}
<footer class="foot"><div class="container">
  <p class="fp"><!--FP--></p>
  <p class="muted small">JemputMakan · proyek Sistem Informasi Berkelanjutan · estimasi emisi dijelaskan di <a href="/dampak">halaman Dampak</a>.</p>
</div></footer>
${panel ? '' : html`<nav class="bottomnav" aria-label="Navigasi bawah">${nav.map((n) => navLink(n, path))}</nav>`}
</body></html>`;
}

const flashBox = (f) => (f ? html`<div class="flash ${f.type === 'error' ? 'flash-bad' : 'flash-ok'}" role="${f.type === 'error' ? 'alert' : 'status'}">${f.msg}${typeof f.link?.[0] === 'string' && f.link[0].startsWith('/') && !f.link[0].startsWith('//') ? html` <a href="${f.link[0]}">${f.link[1]}</a>` : ''}</div>` : '');

export const statusBadge = (s) => {
  const cls = { MENUNGGU_KONFIRMASI: 'warn', DIPROSES: 'info', SIAP_DIAMBIL: 'ok', SELESAI: 'done', DITOLAK: 'bad', DIBATALKAN: 'bad' }[s] || 'muted';
  return html`<span class="badge ${cls}">${STATUS_LABEL[s] || s}</span>`;
};

export const openBadge = (open) => html`<span class="badge ${open ? 'ok' : 'muted'}">${open ? 'Buka' : 'Tutup'}</span>`;

export function merchantCard(m) {
  const menit = m.jalan_rata ? Math.max(1, Math.round(m.jalan_rata * 12)) : null; // ±5 km/jam
  return html`<a class="card merchant" href="/kedai/${m.id}">
  <div class="row between"><h3>${m.nama}</h3>${openBadge(m.buka_sekarang)}</div>
  <p class="meta">${icon('pin', 'ic sm')} ${m.lokasi}</p>
  <p class="meta">${icon('clock', 'ic sm')} ${m.jam_buka}–${m.jam_tutup} WIB</p>
  <p class="meta">${icon('walk', 'ic sm')} ${menit ? html`±${menit} menit jalan kaki · ` : ''}${m.jumlah_menu} menu</p>
</a>`;
}

export const emptyState = (title, text, href, cta) => html`<div class="empty card">
  <div class="empty-ic">${icon('box', 'ic lg')}</div><h2>${title}</h2><p class="muted">${text}</p>
  ${href ? html`<a class="btn" href="${href}">${cta}</a>` : ''}</div>`;

export const field = (label, input, hint) => html`<label class="field"><span>${label}</span>${input}${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;

export function pageTitle(h, sub) {
  return html`<div class="pagehead"><h1>${h}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;
}

export { rupiah, num };
