// Caches the app shell so it opens offline. Supabase calls are never cached.
// Network first, revalidating with the server (no browser HTTP-cache shortcut), so a new deploy is what
// opens next time -- on the main app and on installed trip apps alike, with nothing to reinstall.
var CACHE = 'kharcha-shell-v142';
var SHELL = ['./', './index.html', './styles.css?v=142', './modern.css?v=142', './modern.js?v=142', './insights.js?v=142', './card.js?v=142', './trips-home.js?v=142', './autopilot.js?v=142', './kitchen.js?v=142', './safety.js?v=142', './smart.js?v=142', './phone.js?v=142', './ledger-logic.js?v=142', './app.js?v=142', './config.js?v=142', './manifest.webmanifest', './icon-192.png?v=142', './logo-mark.png?v=142', './icon-512.png?v=142', './trip.html', './trip.js?v=142'];
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
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res && res.status === 200) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) {
      if (r) return r;
      // Offline: a trip link (trip.html?t=...) opens the cached trip page, anything else the main app.
      if (req.mode === 'navigate' && /\/trip\.html$/.test(new URL(req.url).pathname)) {
        return caches.match('./trip.html', { ignoreSearch: true });
      }
      return caches.match('./index.html');
    });
  }));
});
