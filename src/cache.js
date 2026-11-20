// Cache memori per-instance (TTL pendek + invalidasi eksplisit) untuk data yang jarang berubah.
// Catatan serverless: tiap instance punya cache sendiri, jadi perubahan merchant bisa tertunda
// sebesar TTL pada instance lain. Itu aman karena checkout selalu memvalidasi ke database.
const store = new Map();
const TTL_MS = Number(process.env.CACHE_TTL_MS) || 20_000;
export const stats = { hit: 0, miss: 0 };
export function cached(key, loader, ttl = TTL_MS) {
  const e = store.get(key);
  if (e && e.exp > Date.now()) { stats.hit++; return e.val; }
  stats.miss++;
  const val = Promise.resolve().then(loader);
  store.set(key, { val, exp: Date.now() + ttl });
  val.catch(() => store.delete(key)); // jangan menyimpan hasil gagal
  return val;
}
export const invalidate = () => store.clear(); // dipanggil saat merchant mengubah menu/slot/kedai
