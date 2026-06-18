const CACHE = 'budget-app-v12';
const ASSETS = [
  './',
  'index.html',
  'js/firebase.js',
  'js/auth.js',
  'js/db.js',
  'js/router.js',
  'js/app.js',
  'js/pages/dashboard.js',
  'js/pages/transactions.js',
  'js/pages/fixed.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
