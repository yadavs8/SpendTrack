/* Kharcha Book v79: Phone connection screen (More > Phone connection). Shows whether bank messages are really arriving from the phone,
   and how to reach the phone settings (SMS access, Cloud Sync). Uses only what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  var DAY = 86400000;

  function native() { return !!(window.KharchaNative && window.KharchaNative.openSettings); }
  function line(root, icon, title, text) {
    var r = el('div', 'ph-row'); r.appendChild(el('span', 'ph-i', icon));
    var t = el('div', 'ph-t'); t.appendChild(el('b', null, title)); if (text) t.appendChild(el('span', null, text)); r.appendChild(t); root.appendChild(r);
  }

  function render() {
    var root = $('phone-root');
    if (!root || !K.getEntries) return;
    root.textContent = '';
    var now = Date.now(), fromPhone = K.getEntries().filter(function (e) { return e && !e.synthetic && (e.raw || e.refNo); }).sort(function (a, b) { return b.ts - a.ts; });
    var last = fromPhone[0], n24 = fromPhone.filter(function (e) { return e.ts > now - DAY; }).length, n7 = fromPhone.filter(function (e) { return e.ts > now - 7 * DAY; }).length;

    var c1 = el('div', 'wal-card');
    c1.appendChild(el('div', 'wal-name', '📡 Bank messages from your phone'));
    if (last && now - last.ts < 3 * DAY) {
      line(c1, '✅', 'Messages are arriving', 'Latest: ' + fmt.format(last.ts) + ' · ' + n24 + ' in the last 24 hours, ' + n7 + ' this week.');
    } else if (last) {
      line(c1, '⚠️', 'Nothing new for a while', 'The latest bank message here is from ' + fmt.format(last.ts) + '. If you have had payments since, the phone app is not sending them. The most common cause: the phone app got signed out (for example after signing out on the web). Open the Android app > ⚙️ > Cloud Sync and sign in again; payments waiting on the phone are sent by themselves.');
    } else {
      line(c1, '⚠️', 'No bank message has reached Kharcha Book yet', 'Bank messages are read by the Kharcha Book Android app and sent here. Check the steps below.');
    }
    var who = el('div', 'wal-hint', 'Signed in as …'); c1.appendChild(who);
    try {
      var sb = K.getSb && K.getSb();
      if (sb && sb.auth && sb.auth.getUser) sb.auth.getUser().then(function (r) {
        var u = r && r.data && r.data.user;
        who.textContent = u && u.email ? 'Signed in as ' + u.email + '. The phone app must be signed in with this same email to sync.' : '';
      }).catch(function () { who.textContent = ''; });
    } catch (e) { who.textContent = ''; }
    root.appendChild(c1);

    var c2 = el('div', 'wal-card');
    c2.appendChild(el('div', 'wal-name', '⚙️ Phone settings'));
    if (native()) {
      line(c2, '📱', 'You are inside the phone app', 'Everything is in the settings screen: SMS and notification access, Cloud Sync sign-in, app lock.');
      var go = el('button', 'primary', 'Open phone app settings'); go.type = 'button';
      go.addEventListener('click', function () { window.KharchaNative.openSettings(); });
      c2.appendChild(go);
    } else {
      line(c2, 'ℹ️', 'You are in the web version', 'This copy runs in the browser, which cannot read SMS. The settings button lives in the Kharcha Book Android app (installed from the APK). Open that app and tap ⚙️ at the top right, or More > Phone settings.');
      line(c2, '📲', 'No Android app on this phone?', 'Then nothing is reading your bank messages, and credits and debits will only appear when you type them in. Install the Android app (APK) and sign in with the same email.');
      var apkBtn = el('a', 'btn-primary', '⬇️ Download Kharcha-Book.apk');
      apkBtn.href = 'https://github.com/yadavs8/SpendTrack/releases/download/apk-latest/Kharcha-Book.apk';
      apkBtn.setAttribute('download', '');
      apkBtn.style.cssText = 'display:inline-block;margin:10px 0 4px 38px;padding:8px 14px;background:var(--accent,#0B5D75);color:#fff;border-radius:8px;font-weight:600;text-decoration:none;font-size:0.85rem;';
      c2.appendChild(apkBtn);
    }
    root.appendChild(c2);

    var c3 = el('div', 'wal-card');
    c3.appendChild(el('div', 'wal-name', '✅ Checklist so nothing goes silent'));
    [['1', 'Android Settings > Apps > Kharcha Book > Permissions > SMS: Allow. Notifications: Allow.'],
     ['2', 'Settings > Apps > Special app access > Notification access: turn Kharcha Book on.'],
     ['3', 'Settings > Apps > Kharcha Book > Battery: Unrestricted (OnePlus: Don’t optimise). Otherwise Android stops the app while the phone sits idle.'],
     ['4', 'In the app: ⚙️ > Cloud Sync: sign in with the same email as here, and turn SMS detection on.']].forEach(function (s) { line(c3, s[0], s[1], ''); });
    root.appendChild(c3);
  }
  document.addEventListener('kharcha:phone', render);
  document.addEventListener('kharcha:render', function () { var s = $('phone-sec'); if (s && !s.hidden) render(); });
})();
