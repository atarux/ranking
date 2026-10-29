// Cambia la versione quando modifichi i file, così l'app scarica gli aggiornamenti.
const CACHE = 'classifica-v13';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180-v2.png',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la rete (così vedi subito gli aggiornamenti), poi la cache se sei offline.
// 'no-cache' obbliga a ricontrollare col server invece di usare copie vecchie del browser.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    fetch(e.request, sameOrigin ? { cache: 'no-cache' } : undefined)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
