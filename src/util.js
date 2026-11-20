// Utilitas kecil: templating aman (auto-escape), format angka/tanggal, waktu WIB.
export class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
// Tagged template: semua interpolasi di-escape kecuali nilai Raw / hasil html``.
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// --- Jam (bisa diganti saat pengujian) ---
let nowFn = () => Date.now();
export const setClock = (fn) => { nowFn = fn; };
export const nowMs = () => nowFn();
const WIB = 7 * 3600e3;
const iso = (ms) => new Date(ms + WIB).toISOString();
export const nowWIB = () => iso(nowMs()).slice(0, 16);          // 'YYYY-MM-DDTHH:MM'
export const todayWIB = () => iso(nowMs()).slice(0, 10);
export const dateWIB = (offsetDays = 0) => iso(nowMs() + offsetDays * 864e5).slice(0, 10);
export const timeWIB = () => iso(nowMs()).slice(11, 16);

// --- Format ---
export const rupiah = (n) => 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const num = (n, d = 2) => Number(n).toFixed(d).replace('.', ',');
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function tanggalLabel(d10) {
  if (d10 === dateWIB(0)) return 'Hari ini';
  if (d10 === dateWIB(1)) return 'Besok';
  const d = new Date(d10 + 'T00:00:00Z');
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`;
}
export const slotLabel = (a, b) => `${tanggalLabel(a.slice(0, 10))} ${a.slice(11, 16)}–${b.slice(11, 16)} WIB`;
export function createdLabel(ts) { // ts: 'YYYY-MM-DDTHH:MM' WIB
  return `${tanggalLabel(ts.slice(0, 10))} ${ts.slice(11, 16)}`;
}

// --- HTTP helpers ---
export function parseCookies(h = '') {
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export async function readForm(req, limit = 100_000) {
  // Di Vercel, body sudah di-parse lebih dulu ke req.body dan stream-nya habis: pakai itu bila ada.
  if (req.body !== undefined && req.body !== null) {
    const b = req.body, o = {};
    if (Buffer.isBuffer(b) || typeof b === 'string') { for (const [k, v] of new URLSearchParams(b.toString())) o[k] = v; }
    else if (typeof b === 'object') { for (const [k, v] of Object.entries(b)) o[k] = Array.isArray(v) ? String(v[0]) : String(v); }
    return o;
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new AppError('Data terlalu besar', 413); chunks.push(c); }
  const p = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const o = {}; for (const [k, v] of p) o[k] = v; return o;
}
export class AppError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
export const clampInt = (v, min, max, def) => { if (v == null || String(v).trim() === '') return def; const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
export const clampNum = (v, min, max, def) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(max, Math.max(min, n)) : def; };
