// ============================================
// THEME — clair / sombre / système
// ============================================
// Appliqué le plus tôt possible (avant le rendu) pour éviter le flash.

(function () {
  const stored = localStorage.getItem('theme') || 'system';
  applyTheme(stored);
})();

function applyTheme(mode) {
  localStorage.setItem('theme', mode);
  let effective = mode;
  if (mode === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effective);
}

// À appeler une fois le DOM prêt, sur les pages qui affichent le sélecteur.
function initThemeToggle() {
  const buttons = document.querySelectorAll('.theme-toggle button');
  if (buttons.length === 0) return;

  const current = localStorage.getItem('theme') || 'system';
  buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === current));

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.mode);
      buttons.forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Si "système" est sélectionné, on réagit aussi à un changement live du système
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme') || 'system') === 'system') applyTheme('system');
  });
}
