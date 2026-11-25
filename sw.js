const prefix = 'mon-univers-tech-';
const cacheName = prefix + 'v3.1.0';
const shell = [
  './', './index.html', './informations.html', './styles.css', './app.js', './assistant.js',
  './catalog.js', './product-details.js', './offers.js', './config.js', './manifest.webmanifest', './assets/logo.svg',
  './assets/prix-malin.png', './assets/theme.js', './assets/icon-192.png', './assets/icon-512.png', './assets/hero.webp', './assets/galaxy-s24.webp', './assets/iphone-16.webp',
  ...[0, 1, 2, 3].map(index => `./assets/category-${index}.webp`),
];
const cachedUrls = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell.map(path => new Request(path, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !cachedUrls.has(request.url)) return;
  event.respondWith(fetch(request).catch(() => caches.open(cacheName).then(cache => cache.match(request))));
});
