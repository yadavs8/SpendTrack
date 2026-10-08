// Caches the app shell so it opens offline. Supabase calls are never cached.
var CACHE = 'kharcha-shell-v38';
var SHELL = ['./', './index.html', './styles.css?v=38', './app.js?v=38', './config.js?v=38', './manifest.webmanifest', './icon-192.png?v=38', './icon-512.png?v=38'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.status === 200) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('./index.html'); }); }));
});
