// Service worker mínimo. Rede primeiro, sempre: um escritório de agentes
// mostra estado em tempo real, e servir uma versão em cache seria pior do
// que não funcionar de todo. A cache existe só para a app abrir offline e
// dizer que não há ligação, em vez de dar erro do browser.
const CACHE = 'ai-office-v3';
// A app do telemóvel deixou de usar Three.js: os robôs são SVG animado
// com CSS. Menos 660 KB para descarregar e guardar.
const SHELL = ['/flip.html', '/robots.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nunca cachear API nem WebSocket
  if (e.request.method !== 'GET' || /^\/(agents|projects|stats|pipeline|task|reset|plan|preview)/.test(url.pathname)) return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok && SHELL.includes(url.pathname)) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
