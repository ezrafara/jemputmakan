// Satu-satunya JS klien: toggle tema (terang/gelap). Selebihnya server-rendered.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  const r = document.documentElement, t = r.dataset.theme === 'dark' ? 'light' : 'dark';
  r.dataset.theme = t;
  try { localStorage.setItem('jm-theme', t); } catch (_) { /* penyimpanan tidak tersedia */ }
});
