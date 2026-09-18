// Service worker mínimo: solo lo necesario para que el navegador
// considere la app "instalable". No cachea nada de forma agresiva
// para evitar que la clienta o el equipo vean datos desactualizados.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  self.clients.claim();
});
self.addEventListener('fetch', () => {
  // Sin caché: siempre va a la red. Deja la app "instalable"
  // sin arriesgar que se muestren citas o promociones viejas.
});
