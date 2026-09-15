// ============================================
// ENREGISTREMENT DU SERVICE WORKER (PWA)
// ============================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker non enregistré :', err);
    });
  });
}
