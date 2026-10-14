// Caches the app shell so it opens offline. Supabase calls are never cached.
var CACHE = 'kharcha-shell-v103';
var SHELL = ['./', './index.html', './styles.css?v=103', './modern.css?v=103', './modern.js?v=103', './insights.js?v=103', './card.js?v=103', './phone.js?v=103', './ledger-logic.js?v=103', './app.js?v=103', './config.js?v=103', './manifest.webmanifest', './icon-192.png?v=103', './logo-mark.png?v=103', './icon-512.png?v=103'];
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
