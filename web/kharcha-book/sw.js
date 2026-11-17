// Caches the app shell so it opens offline. Supabase calls are never cached.
// Network first, revalidating with the server (no browser HTTP-cache shortcut), so a new deploy is what
// opens next time -- on the main app and on installed trip apps alike, with nothing to reinstall.
var CACHE = 'kharcha-shell-v154';
var SHELL = ['./', './index.html', './styles.css?v=154', './modern.css?v=154', './glow.css?v=154', './wings.js?v=154', './modern.js?v=154', './pull.js?v=154', './insights.js?v=154', './card.js?v=154', './trips-home.js?v=154', './autopilot.js?v=154', './radar.js?v=154', './tax.js?v=154', './kitchen.js?v=154', './safety.js?v=154', './smart.js?v=154', './phone.js?v=154', './ledger-logic.js?v=154', './app.js?v=154', './config.js?v=154', './manifest.webmanifest', './icon-192.png?v=154', './logo-mark.png?v=154', './icon-512.png?v=154', './trip.html', './trip.js?v=154'];
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
