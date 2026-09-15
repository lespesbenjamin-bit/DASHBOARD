// ============================================
// SERVICE WORKER — Cockpit Benjamin
// ============================================
// Met en cache les fichiers de l'application (HTML/CSS/JS/icônes) pour un
// chargement instantané et une tolérance aux coupures réseau.
// IMPORTANT : ne met JAMAIS en cache les appels à Supabase (données/auth) —
// seulement les fichiers statiques de l'app elle-même, servis en same-origin.

const CACHE_NAME = 'cockpit-v4';

const APP_SHELL = [
  'index.html', 'login.html', 'tasks.html', 'coaching.html',
  'business.html', 'moka.html', 'running.html', 'week.html', 'tournaments.html',
  'style.css', 'theme.js', 'auth.js', 'add-menu.js',
  'app-today.js', 'tasks.js', 'coaching.js', 'coaching-engine.js',
  'business.js', 'business-data.js', 'moka.js', 'running.js', 'week.js', 'ics-sync.js', 'tournaments.js',
  'manifest.json', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // On ne touche JAMAIS aux requêtes vers un autre domaine (Supabase, CDN
  // Chart.js, polices Google...) — elles passent directement au réseau,
  // pour ne jamais servir de données ou de session périmées depuis le cache.
  if (url.origin !== self.location.origin) return;

  // Fichiers de l'app (même origine) : cache d'abord, réseau en secours,
  // et on met à jour discrètement le cache si une version plus récente existe.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || network;
    })
  );
});
