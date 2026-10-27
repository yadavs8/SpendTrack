/* Kharcha Book v118: Trips home. One banner per trip ("Manali Trip"); tap it for a short, day-by-day flow of the trip's
   spends, the people on it (add them from your phone's contacts), what each person owes, and the trip's own share link.
   The full trip tools (budget, categories, add spend, settle-up) are one tap away under "More trip tools".
   Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(v) { return K.money(Math.round(v * 100) / 100); }
  var ui = { trip: null, tools: false };
  var dayF = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var shortF = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

  /* ---------- look of a trip, from its name ---------- */
  var THEMES = [
    [/manali|shimla|ladakh|\bleh\b|spiti|kasol|himachal|uttarakhand|rishikesh|kedarnath|badrinath|mussoorie|nainital|auli|kashmir|gulmarg|srinagar|darjeeling|sikkim|gangtok|tawang|mountain|trek|hill/i, '🏔️', 'linear-gradient(135deg,#0f172a 0%,#1e3a8a 45%,#60a5fa 100%)'],
    [/goa|kerala|andaman|gokarna|pondicherry|puducherry|varkala|alibaug|beach|maldives|bali|phuket|lakshadweep|diu/i, '🏖️', 'linear-gradient(135deg,#0e7490 0%,#06b6d4 50%,#fde68a 100%)'],
    [/jaipur|udaipur|jaisalmer|jodhpur|rajasthan|agra|pushkar|desert|hampi|khajuraho/i, '🏜️', 'linear-gradient(135deg,#7c2d12 0%,#ea580c 50%,#fcd34d 100%)'],
    [/varanasi|banaras|haridwar|amritsar|tirupati|vaishno|shirdi|puri|dwarka|mathura|vrindavan|ayodhya|temple|yatra/i, '🛕', 'linear-gradient(135deg,#7f1d1d 0%,#f97316 55%,#fde047 100%)'],
    [/mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|dubai|singapore|london|paris|city/i, '🌆', 'linear-gradient(135deg,#1e1b4b 0%,#7c3aed 55%,#f472b6 100%)']
  ];
  function themeOf(name) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][0].test(name || '')) return { icon: THEMES[i][1], bg: THEMES[i][2] };
    return { icon: '✈️', bg: 'linear-gradient(135deg,#064e3b 0%,#059669 55%,#a7f3d0 100%)' };
  }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function hue(n) { var h = 0, s = String(n || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function avatar(n, cls) { var a = el('span', 'th-av' + (cls ? ' ' + cls : ''), n === 'Me' ? 'Me' : initials(n)); a.style.background = 'hsl(' + hue(n) + ' 65% 88%)'; a.style.color = 'hsl(' + hue(n) + ' 55% 28%)'; a.title = n; return a; }
  function label(desc) {
    var KL = window.KharchaLedger;
    var t = KL && KL.tripItemLabel ? KL.tripItemLabel(desc) : String(desc || '');
    return String(t || desc || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
  }
  var TRIP_COLORS = { stay: '#2563eb', fuel: '#dc2626', food: '#ea580c', beverages: '#9333ea' };
  // Trip-specific first (Stay / Fuel / Food / Drinks), then the everyday categories (Travel, Shopping...).
  function catOf(desc) {
    var KL = window.KharchaLedger;
    var t = KL && KL.tripItemCategory ? KL.tripItemCategory(desc) : null;
    if (t && t.key !== 'other') return { icon: t.emoji, label: t.name.replace(/ Expenses$/, ''), color: TRIP_COLORS[t.key] || '#64748b' };
    var c = KL && KL.categoryOf ? KL.categoryOf(label(desc)) : null;
    if (c && c.key !== 'other' && c.key !== 'person') return c;
    return { icon: '🎟️', label: 'Activities & other', color: '#0d9488' };
  }
  function phoneDigits(tel) { var d = String(tel || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1); return d.length >= 11 ? d : ''; }

  /* ---------- contacts: the phone app's picker, Chrome's picker, or typing a name ---------- */
  var APK_URL = 'https://github.com/yadavs8/SpendTrack/releases/download/apk-latest/Kharcha-Book.apk';
  function inApp() { return !!window.KharchaNative; }
  function nativePick() { return !!(window.KharchaNative && typeof window.KharchaNative.pickContact === 'function'); }
  // Inside the phone app only the app's own picker works (the WebView has a contacts object that cannot open anything).
  function contactMode() {
    if (nativePick()) return 'native';
    if (inApp()) return 'update';
    if (navigator.contacts && typeof navigator.contacts.select === 'function') return 'web';
    return '';
  }
  function canPick() { return contactMode() !== ''; }
  function pickContacts() {
    if (nativePick()) {
      return new Promise(function (resolve, reject) {
        window.__kharchaContactPicked = function (c) { window.__kharchaContactPicked = null; resolve(c && c.name ? [{ name: c.name, tel: c.tel || '' }] : []); };
        try { window.KharchaNative.pickContact(); } catch (e) { reject(e); }
      });
    }
    return navigator.contacts.select(['name', 'tel'], { multiple: true }).then(function (list) {
      return (list || []).map(function (c) { return { name: (c.name && c.name[0]) || '', tel: (c.tel && c.tel[0]) || '' }; }).filter(function (c) { return c.name; });
    });
  }
  function addPeople(trip, people) {
    var api = K.tripsApi, cur = api.friends(trip).filter(function (f) { return f !== 'Me'; }), added = [];
    people.forEach(function (p) {
      var n = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!n) return;
      if (cur.some(function (f) { return f.toLowerCase() === n.toLowerCase(); })) { if (p.tel) api.setPhone(n, p.tel); return; }
      cur.push(n); added.push(n); if (p.tel) api.setPhone(n, p.tel);
    });
    if (added.length) { api.setFriends(trip, cur); K.toast(added.join(', ') + (added.length === 1 ? ' added to ' : ' added to ') + trip + '. Spends split equally.'); }
    render();
  }

  /* ---------- sharing the trip's own link ---------- */
  function shareLink(trip, toName) {
    var api = K.tripsApi;
    api.link(trip).then(function (link) {
      var msg = 'Join our "' + trip + '" trip on Kharcha Book. See what has been spent and add your own: ' + link;
      var tel = toName ? phoneDigits(api.phones()[toName]) : '';
      if (tel) { window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank'); return; }
      if (!toName && navigator.share && !(window.KharchaNative)) { navigator.share({ title: trip, text: msg }).catch(function () {}); return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }).catch(function (err) { K.toast((err && err.message) || 'Could not make the trip link.'); });
  }
  function copyLink(trip) {
    K.tripsApi.link(trip).then(function (link) {
      var done = function () { K.toast('Trip link copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy the trip link', link); });
      else window.prompt('Copy the trip link', link);
    }).catch(function (err) { K.toast((err && err.message) || 'Could not make the trip link.'); });
  }

  /* ---------- screens ---------- */
  function tripStats(name) {
    var s = K.tripsApi.summary(name);
    var items = (s.entries || []).filter(function (e) { return !K.tripsApi.isSettlement(e); });
    var last = items.reduce(function (m, e) { return Math.max(m, e.ts); }, 0), first = items.reduce(function (m, e) { return Math.min(m, e.ts); }, Infinity);
    return { s: s, items: items, last: last, first: isFinite(first) ? first : 0 };
  }
  function banner(name, st, big) {
    var th = themeOf(name), b = el(big ? 'div' : 'button', 'th-banner' + (big ? ' big' : '')); if (!big) b.type = 'button';
    b.style.background = th.bg;
    b.appendChild(el('span', 'th-art', th.icon));
    var tx = el('div', 'th-tx');
    tx.appendChild(el('b', 'th-name', name));
    var days = st.s.daysCount || 0;
    tx.appendChild(el('span', 'th-meta', st.items.length ? (st.first ? shortF.format(new Date(st.first)) + (st.last && shortF.format(new Date(st.last)) !== shortF.format(new Date(st.first)) ? ' – ' + shortF.format(new Date(st.last)) : '') + ' · ' : '') + days + (days === 1 ? ' day' : ' days') : 'No spends yet'));
    b.appendChild(tx);
    var r = el('div', 'th-r');
    r.appendChild(el('b', 'th-amt', money(st.s.totalSpent || 0)));
    var avs = el('div', 'th-avs');
    (st.s.participants || ['Me']).slice(0, 4).forEach(function (p) { avs.appendChild(avatar(p, 'sm')); });
    if ((st.s.participants || []).length > 4) avs.appendChild(el('span', 'th-av sm more', '+' + ((st.s.participants || []).length - 4)));
    r.appendChild(avs);
    b.appendChild(r);
    return b;
  }

  function renderList(root) {
    var api = K.tripsApi, trips = api.list();
    var head = el('div', 'th-head'); head.appendChild(el('h2', 'th-title', 'Your trips'));
    var nb = el('button', 'th-new', '+ New trip'); nb.type = 'button';
    nb.addEventListener('click', function () { var b = $('trip-new-btn'); if (b) b.click(); });
    head.appendChild(nb); root.appendChild(head);
    if (!trips.length) {
      var e = el('div', 'th-empty'); e.appendChild(el('span', 'th-art', '🧳'));
      e.appendChild(el('b', null, 'Plan your first trip')); e.appendChild(el('p', null, 'Add friends from your contacts, log spends as you go, and everyone sees the same day-by-day list from one link.'));
      root.appendChild(e); return;
    }
    trips.map(function (t) { return { t: t, st: tripStats(t) }; }).sort(function (a, b) { return (b.st.last || 0) - (a.st.last || 0); }).forEach(function (x) {
      var b = banner(x.t, x.st, false);
      b.addEventListener('click', function () { ui.trip = x.t; ui.tools = false; api.select(x.t); window.scrollTo({ top: 0 }); render(); });
      root.appendChild(b);
    });
  }

  function renderTrip(root, trip) {
    var api = K.tripsApi, st = tripStats(trip), s = st.s;
    var back = el('button', 'th-back', '‹ All trips'); back.type = 'button';
    back.addEventListener('click', function () { ui.trip = null; ui.tools = false; render(); });
    root.appendChild(back);
    var hb = banner(trip, st, true);
    var people = s.participants || ['Me'];
    if (people.length > 1 && s.totalSpent) hb.appendChild(el('span', 'th-share', money(s.perPersonShare || s.totalSpent / people.length) + ' each'));
    root.appendChild(hb);

    // actions
    var acts = el('div', 'th-acts');
    var add = el('button', 'th-act primary', '＋ Add spend'); add.type = 'button';
    add.addEventListener('click', function () { ui.tools = true; render(); setTimeout(function () { var f = $('trip-exp-amt') || document.querySelector('#trips-sec input'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }, 60); });
    var sh = el('button', 'th-act', '🔗 Share link'); sh.type = 'button'; sh.addEventListener('click', function () { shareLink(trip); });
    var cp = el('button', 'th-act', '📋 Copy link'); cp.type = 'button'; cp.addEventListener('click', function () { copyLink(trip); });
    acts.appendChild(add); acts.appendChild(sh); acts.appendChild(cp);
    root.appendChild(acts);

    // people
    var pc = el('section', 'th-card');
    var ph = el('div', 'th-card-h'); ph.appendChild(el('b', null, '👥 People · split equally'));
    pc.appendChild(ph);
    var plist = el('div', 'th-people'), phones = api.phones();
    var bal = {}; (s.balances || []).forEach(function (b) { bal[b.name] = b; });
    people.forEach(function (p) {
      var row = el('div', 'th-person');
      row.appendChild(avatar(p));
      var t = el('div', 'th-p-t'); t.appendChild(el('b', null, p === 'Me' ? 'You' : p));
      var b = bal[p], net = b ? Math.round(b.net) : 0;
      t.appendChild(el('span', 'th-p-net' + (net > 0 ? ' get' : net < 0 ? ' owe' : ''), b ? 'Paid ' + money(b.paid) + (net > 0 ? ' · gets back ' + money(net) : net < 0 ? ' · owes ' + money(-net) : ' · settled') : ''));
      row.appendChild(t);
      if (p !== 'Me') {
        var send = el('button', 'th-mini', phoneDigits(phones[p]) ? '💬 Send link' : '🔗 Link'); send.type = 'button';
        send.addEventListener('click', function () { shareLink(trip, p); });
        row.appendChild(send);
      }
      plist.appendChild(row);
    });
    pc.appendChild(plist);
    var addRow = el('div', 'th-add-people');
    var nameIn = el('input', 'input th-name-in'); nameIn.placeholder = canPick() ? 'or type a name' : 'Friend\'s name'; nameIn.maxLength = 40;
    var mode = contactMode();
    if (mode) {
      var pick = el('button', 'th-act', '📇 Add from contacts'); pick.type = 'button';
      pick.addEventListener('click', function () {
        if (mode === 'update') {
          K.confirmBox({ title: 'Update the phone app', message: 'Picking friends from contacts needs the latest Kharcha Book app. It installs over this one and keeps all your data. You can type a name for now.', confirmText: 'Download update',
            onConfirm: function () { window.open(APK_URL, '_blank'); } });
          return;
        }
        pick.disabled = true;
        pickContacts().then(function (list) { if (list.length) addPeople(trip, list); })
          .catch(function () { K.toast('Could not open contacts. Type the name instead.'); try { nameIn.focus(); } catch (e) {} })
          .then(function () { pick.disabled = false; });
      });
      addRow.appendChild(pick);
    }
    var addB = el('button', 'th-act', 'Add'); addB.type = 'button';
    var doAdd = function () { var v = nameIn.value.trim(); if (v) { addPeople(trip, [{ name: v }]); nameIn.value = ''; } };
    addB.addEventListener('click', doAdd); nameIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doAdd(); });
    addRow.appendChild(nameIn); addRow.appendChild(addB);
    pc.appendChild(addRow);
    if ((s.transfers || []).length) {
      var tr = el('div', 'th-settle'); tr.appendChild(el('span', 'th-k', 'TO SETTLE UP'));
      s.transfers.slice(0, 6).forEach(function (x) { tr.appendChild(el('div', 'th-tr', (x.from === 'Me' ? 'You' : x.from) + ' → ' + (x.to === 'Me' ? 'you' : x.to) + '  ' + money(x.amount))); });
      pc.appendChild(tr);
    }
    root.appendChild(pc);

    // day-by-day flow
    var fc = el('section', 'th-card');
    fc.appendChild(el('div', 'th-card-h', '🗓️ Day by day'));
    if (!st.items.length) fc.appendChild(el('p', 'th-muted', 'No spends yet. Tap “Add spend”, or friends can add from the trip link.'));
    var byDay = {}, order = [];
    st.items.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (e) {
      var d = new Date(e.ts), k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
      if (!byDay[k]) { byDay[k] = { ts: e.ts, p: 0, items: [] }; order.push(k); }
      byDay[k].p += Math.round(e.amount * 100); byDay[k].items.push(e);
    });
    order.forEach(function (k, i) {
      var g = byDay[k], day = el('div', 'th-day');
      var dh = el('div', 'th-day-h');
      dh.appendChild(el('span', 'th-dot', String(i + 1)));
      var dt = el('div', 'th-day-t'); dt.appendChild(el('b', null, 'Day ' + (i + 1))); dt.appendChild(el('span', null, dayF.format(new Date(g.ts))));
      dh.appendChild(dt); dh.appendChild(el('b', 'th-day-amt', money(g.p / 100)));
      day.appendChild(dh);
      g.items.forEach(function (e) {
        var c = catOf(e.desc), r = el('div', 'th-item');
        var ic = el('span', 'th-ic', c.icon); ic.style.background = c.color + '1f'; r.appendChild(ic);
        var t = el('div', 'th-it-t'); t.appendChild(el('b', null, label(e.desc).slice(0, 40) || 'Spend'));
        var who = api.payer(e.desc); t.appendChild(el('span', null, (who === 'Me' ? 'You paid' : who + ' paid') + ' · ' + c.label));
        r.appendChild(t); r.appendChild(el('b', 'th-it-a', money(e.amount)));
        day.appendChild(r);
      });
      fc.appendChild(day);
    });
    root.appendChild(fc);

    var more = el('button', 'th-tools', ui.tools ? 'Hide trip tools ▴' : 'More trip tools: budget, categories, add & settle ▾'); more.type = 'button';
    more.addEventListener('click', function () { ui.tools = !ui.tools; render(); });
    root.appendChild(more);
  }

  function render() {
    var sec = $('trips-sec'); if (!sec || !K.tripsApi) return;
    var root = $('trips-home');
    if (!root) { root = el('div', 'trips-home'); root.id = 'trips-home'; sec.insertBefore(root, sec.firstChild); }
    if (ui.trip && K.tripsApi.list().indexOf(ui.trip) < 0) ui.trip = null;
    root.textContent = '';
    if (ui.trip) renderTrip(root, ui.trip); else renderList(root);
    sec.classList.toggle('th-on', true);
    sec.classList.toggle('th-tools-open', !!(ui.trip && ui.tools));
  }
  document.addEventListener('kharcha:render', function () { var sec = $('trips-sec'); if (sec && !sec.hidden) render(); });
  // re-render when the Trips page is opened
  var mo = new MutationObserver(function () { var sec = $('trips-sec'); if (sec && !sec.hidden) render(); });
  function watch() { var sec = $('trips-sec'); if (sec) mo.observe(sec, { attributes: true, attributeFilter: ['hidden'] }); else setTimeout(watch, 300); }
  watch();
})();
