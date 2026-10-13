// Caches the app shell so it opens offline. Supabase calls are never cached.
var CACHE = 'kharcha-shell-v99';
var SHELL = ['./', './index.html', './styles.css?v=99', './modern.css?v=99', './modern.js?v=99', './insights.js?v=99', './card.js?v=99', './phone.js?v=99', './ledger-logic.js?v=99', './app.js?v=99', './config.js?v=99', './manifest.webmanifest', './icon-192.png?v=99', './logo-mark.png?v=99', './icon-512.png?v=99'];
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
