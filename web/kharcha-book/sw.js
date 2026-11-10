// Caches the app shell so it opens offline. Supabase calls are never cached.
// Network first, revalidating with the server (no browser HTTP-cache shortcut), so a new deploy is what
// opens next time -- on the main app and on installed trip apps alike, with nothing to reinstall.
var CACHE = 'kharcha-shell-v143';
var SHELL = ['./', './index.html', './styles.css?v=143', './modern.css?v=143', './modern.js?v=143', './insights.js?v=143', './card.js?v=143', './trips-home.js?v=143', './autopilot.js?v=143', './kitchen.js?v=143', './safety.js?v=143', './smart.js?v=143', './phone.js?v=143', './ledger-logic.js?v=143', './app.js?v=143', './config.js?v=143', './manifest.webmanifest', './icon-192.png?v=143', './logo-mark.png?v=143', './icon-512.png?v=143', './trip.html', './trip.js?v=143'];
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
