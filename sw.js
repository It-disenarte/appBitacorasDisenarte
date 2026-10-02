const CACHE = 'bitacora-v4';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './favicon.ico', './icons/hoja.svg', './icons/hoja-blanca.svg', './icons/hoja-192.png',
  './icons/hoja-512.png', './icons/hoja-512-maskable.png', './icons/hoja-apple-touch.png',
  './img/textura.jpg',
  './fonts/Poppins-Italic.ttf', './fonts/Poppins-Regular.ttf', './fonts/Poppins-SemiBold.ttf', './fonts/poppins-300-latin-ext.woff2', './fonts/poppins-300-latin.woff2', './fonts/poppins-400-latin-ext.woff2', './fonts/poppins-400-latin.woff2', './fonts/poppins-500-latin-ext.woff2', './fonts/poppins-500-latin.woff2', './fonts/poppins-600-latin-ext.woff2', './fonts/poppins-600-latin.woff2', './fonts/poppins-700-latin-ext.woff2', './fonts/poppins-700-latin.woff2', './fonts/poppins.css'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
