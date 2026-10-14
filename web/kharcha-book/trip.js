// Kharcha Book -- shared trip guest page. Deliberately standalone: no personal-finance code,
// no bank parsing, no auth, nothing from app.js. A friend here never gets a Supabase account --
// every call below goes through a token-checked Postgres function (see
// supabase/kharcha_trip_sharing_v1.sql), never a direct table read/write.
(function () {
  'use strict';

  var CFG = window.KHARCHA_CONFIG || null;
  var params = new URLSearchParams(location.search);
  var token = (params.get('t') || '').trim();
  var urlUpi = (params.get('u') || '').trim();
  if (urlUpi) {
    try {
      localStorage.setItem('kharcha_vpa_sanjeev yadav', urlUpi);
      localStorage.setItem('kharcha_vpa_sanjeev', urlUpi);
      localStorage.setItem('kharcha_my_upi', urlUpi);
    } catch (e) {}
  }
  var app = document.getElementById('app');

  // "Sanjeev", "Sanjeev Yadav", and "Me" are the same person (trip owner/organizer).
  function canonicalTripName(name) {
    if (!name) return '';
    var s = String(name).trim();
    var low = s.toLowerCase();
    if (low === 'me' || low === 'me (you)' || low.startsWith('me (') ||
        low === 'sanjeev' || low === 'sanjeev yadav' || low === 'sanjeev  yadav') {
      return 'Sanjeev Yadav';
    }
    return s;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function money(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  // Same destination-art generator as the main app's Trips view (duplicated here rather than
  // shared, on purpose -- this page loads nothing from app.js). Picks a themed gradient + tiny
  // inline-SVG illustration from the trip's name (mountains, beach, desert/heritage, city...),
  // with a generic travel scene as the fallback.
  function getTripTheme(tripName) {
    var raw = (tripName || '').trim();
    var s = raw.toLowerCase();
    var theme = {
      tag: '✈️ Travel & Adventure',
      place: raw || 'Explore the World',
      art: '<svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1E293B"/><stop offset="100%" stop-color="#0F172A"/></linearGradient></defs>' +
        '<rect width="400" height="190" fill="url(#g-sky)"/>' +
        '<circle cx="340" cy="40" r="18" fill="#F8FAFC" opacity="0.3"/>' +
        '<path d="M0,190 L40,135 L85,190 L130,120 L175,190 L240,105 L300,190 L350,128 L400,190 Z" fill="#334155" opacity="0.5"/>' +
        '</svg>'
    };
    if (!raw) return theme;

    if (s.includes('manali') || s.includes('kasol') || s.includes('rohtang') || s.includes('spiti') ||
        s.includes('ladakh') || s.includes('leh') || s.includes('shimla') || s.includes('kullu') ||
        s.includes('himachal') || s.includes('uttarakhand') || s.includes('kedarnath') || s.includes('rishikesh') ||
        s.includes('kashmir') || s.includes('gulmarg') || s.includes('mountain') || s.includes('hill') ||
        s.includes('trek') || s.includes('hike') || s.includes('snow') || s.includes('camp')) {
      theme.tag = '🏔️ Himalayas Expedition';
      theme.place = raw;
      theme.art = '<svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<linearGradient id="mt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#082F49"/><stop offset="60%" stop-color="#0C4A6E"/><stop offset="100%" stop-color="#0284C7"/></linearGradient>' +
        '</defs>' +
        '<rect width="400" height="190" fill="url(#mt-sky)"/>' +
        '<circle cx="340" cy="38" r="17" fill="#FEF08A" opacity="0.85"/>' +
        '<path d="M20,190 L80,65 L140,190 Z" fill="#38BDF8" opacity="0.35"/>' +
        '<path d="M80,65 L98,95 L80,88 L62,95 Z" fill="#FFFFFF" opacity="0.85"/>' +
        '<path d="M110,190 L190,35 L270,190 Z" fill="#0284C7" opacity="0.5"/>' +
        '<path d="M190,35 L212,68 L190,60 L168,68 Z" fill="#FFFFFF" opacity="0.95"/>' +
        '<path d="M240,190 L310,52 L380,190 Z" fill="#0369A1" opacity="0.6"/>' +
        '<path d="M310,52 L328,80 L310,74 L292,80 Z" fill="#FFFFFF" opacity="0.9"/>' +
        '<path d="M-10,190 L50,105 L120,190 Z" fill="#0F172A" opacity="0.8"/>' +
        '<path d="M290,190 L355,98 L410,190 Z" fill="#0F172A" opacity="0.8"/>' +
        '</svg>';
      return theme;
    }

    if (s.includes('goa') || s.includes('gokarna') || s.includes('beach') || s.includes('coast') ||
        s.includes('kerala') || s.includes('pondicherry') || s.includes('bali') || s.includes('maldives') ||
        s.includes('phuket') || s.includes('sea') || s.includes('ocean') || s.includes('island') ||
        s.includes('andaman') || s.includes('alibaug') || s.includes('varkala')) {
      theme.tag = '🏖️ Coastal Getaway';
      theme.place = raw;
      theme.art = '<svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="bc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FB923C"/><stop offset="45%" stop-color="#FDE047"/><stop offset="70%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient></defs>' +
        '<rect width="400" height="190" fill="url(#bc-sky)"/>' +
        '<circle cx="200" cy="80" r="26" fill="#FEF08A" opacity="0.95"/>' +
        '<path d="M0,115 L400,115 L400,190 L0,190 Z" fill="#0284C7" opacity="0.65"/>' +
        '<path d="M0,132 C60,128 120,136 180,132 C240,128 300,136 360,132 C380,130 395,131 400,132 L400,190 L0,190 Z" fill="#0369A1" opacity="0.8"/>' +
        '<path d="M30,190 Q36,140 48,112" stroke="#78350F" stroke-width="5" fill="none"/>' +
        '<path d="M48,112 Q20,108 12,124 M48,112 Q32,96 30,82 M48,112 Q55,92 66,84 M48,112 Q68,100 78,112 M48,112 Q58,124 52,136" stroke="#15803D" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '</svg>';
      return theme;
    }

    if (s.includes('jaipur') || s.includes('udaipur') || s.includes('jaisalmer') || s.includes('jodhpur') ||
        s.includes('rajasthan') || s.includes('desert') || s.includes('dubai') || s.includes('safari') ||
        s.includes('palace') || s.includes('fort') || s.includes('agra')) {
      theme.tag = '🏰 Heritage & Royal';
      theme.place = raw;
      theme.art = '<svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="ds-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C2410C"/><stop offset="50%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#FCD34D"/></linearGradient></defs>' +
        '<rect width="400" height="190" fill="url(#ds-sky)"/>' +
        '<circle cx="320" cy="48" r="22" fill="#FFFBEB" opacity="0.9"/>' +
        '<path d="M0,190 L0,150 L40,150 L40,135 C40,120 55,120 55,135 L55,150 L90,150 L90,110 C90,90 110,90 110,110 L110,150 L160,150 L160,128 C160,110 175,110 175,128 L175,150 L220,150 L220,190 Z" fill="#78350F" opacity="0.6"/>' +
        '<path d="M0,190 Q100,135 220,165 Q310,185 400,145 L400,190 Z" fill="#B45309" opacity="0.85"/>' +
        '</svg>';
      return theme;
    }

    if (s.includes('mumbai') || s.includes('bangalore') || s.includes('bengaluru') || s.includes('delhi') ||
        s.includes('london') || s.includes('singapore') || s.includes('bangkok') || s.includes('city') ||
        s.includes('urban') || s.includes('tokyo') || s.includes('york')) {
      theme.tag = '🏙️ City Life & Skyline';
      theme.place = raw;
      theme.art = '<svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
        '<rect width="400" height="190" fill="#1E1B4B"/>' +
        '<circle cx="340" cy="38" r="16" fill="#E0E7FF" opacity="0.8"/>' +
        '<rect x="20" y="95" width="28" height="95" fill="#4338CA" opacity="0.6"/>' +
        '<rect x="55" y="70" width="35" height="120" fill="#312E81" opacity="0.8"/>' +
        '<rect x="95" y="105" width="25" height="85" fill="#4338CA" opacity="0.7"/>' +
        '<polygon points="135,190 145,55 155,190" fill="#6366F1" opacity="0.5"/>' +
        '<rect x="160" y="78" width="40" height="112" fill="#312E81" opacity="0.9"/>' +
        '<rect x="210" y="52" width="32" height="138" fill="#4338CA" opacity="0.8"/>' +
        '<rect x="250" y="100" width="30" height="90" fill="#312E81" opacity="0.7"/>' +
        '<rect x="290" y="75" width="38" height="115" fill="#4338CA" opacity="0.85"/>' +
        '<rect x="335" y="110" width="45" height="80" fill="#312E81" opacity="0.9"/>' +
        '</svg>';
      return theme;
    }

    return theme;
  }

  /** The welcome banner shown at the top of both the join screen and the trip view. */
  function renderHero(tripName) {
    var theme = getTripTheme(tripName);
    var hero = el('div', 'hero');
    var art = el('div', 'hero-art'); art.innerHTML = theme.art;
    var shade = el('div', 'hero-shade');
    var inner = el('div', 'hero-inner');
    inner.appendChild(el('span', 'hero-tag', theme.tag));
    inner.appendChild(el('h1', 'hero-title', tripName ? 'Welcome to ' + tripName : 'Welcome'));
    inner.appendChild(el('p', 'hero-sub', 'Kharcha Book shared trip'));
    hero.appendChild(art); hero.appendChild(shade); hero.appendChild(inner);
    return hero;
  }

  function showError(msg) {
    app.innerHTML = '';
    var box = el('div', 'center');
    box.appendChild(el('div', null, '😕'));
    box.appendChild(el('p', null, msg));
    app.appendChild(box);
  }

  if (!token) { showError('This link is missing its invite code. Ask whoever sent it to resend it.'); return; }

  /* ---------- Installable like a real app ----------
     So a friend doesn't have to keep digging up the WhatsApp message: once they add this to
     their home screen, the icon reopens straight back to this exact trip (the manifest's
     start_url is this page's own URL, token and all) and they're still recognized automatically
     via the guest_token already saved in their browser. */
  (function setupInstallable() {
    var base = location.origin + location.pathname.replace(/[^/]*$/, '');
    var manifest = {
      name: 'Kharcha Book — Trip',
      short_name: 'Trip',
      start_url: location.href,
      scope: base,
      display: 'standalone',
      background_color: '#0B1120',
      theme_color: '#0284C7',
      icons: [
        { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    };
    var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(base + 'sw.js').catch(function () {}); // shared with the main app; best-effort
    }
  })();

  var deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferredInstallPrompt = ev;
    var btn = document.getElementById('install-btn');
    if (btn) btn.hidden = false;
  });
  var APK_URL = 'https://github.com/yadavs8/SpendTrack/releases/download/apk-latest/Kharcha-Book.apk';
  // "Get the app" card: always visible (join screen and trip page), for Android and iPhone.
  function renderInstallRow(container) {
    // Already running as an installed app -- nothing to offer.
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
    var ua = navigator.userAgent || '';
    var isIos = /iphone|ipad|ipod/i.test(ua);
    var isAndroid = /android/i.test(ua);
    container.appendChild(el('p', 'sub', '📲 Get the Kharcha Book app'));
    if (isIos || !isAndroid) {
      var ip = el('p', 'sub', 'iPhone / iPad: open this page in Safari, tap Share, then "Add to Home Screen".');
      ip.style.fontSize = '0.82rem';
      container.appendChild(ip);
    }
    if (isAndroid || !isIos) {
      var row = el('div', 'install-row');
      var p = el('p', null, 'Android: install in one tap, or download the app.');
      var btn = el('button', 'ghost', '📲 Install');
      btn.id = 'install-btn';
      btn.hidden = !deferredInstallPrompt; // shown once Chrome offers it
      btn.addEventListener('click', function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.finally(function () { deferredInstallPrompt = null; btn.hidden = true; });
      });
      row.appendChild(p); row.appendChild(btn);
      container.appendChild(row);
      var dl = el('a', 'ghost', '⬇️ Download Android app (APK)');
      dl.href = APK_URL; dl.rel = 'noopener';
      dl.style.cssText = 'display:block;text-align:center;margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:inherit;font-weight:600';
      container.appendChild(dl);
    }
  }
  if (!CFG || !window.supabase) { showError('Could not load Kharcha Book. Check your connection and reload.'); return; }

  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  var storeKey = 'kharcha_guest_' + token;

  function savedMembership() {
    try { return JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { return null; }
  }
  function saveMembership(m) {
    try { localStorage.setItem(storeKey, JSON.stringify(m)); } catch (e) {}
  }

  function join(displayName, existingGuestToken) {
    return sb.rpc('trip_join', {
      p_invite_token: token,
      p_display_name: displayName || null,
      p_existing_guest_token: existingGuestToken || null
    }).then(function (res) {
      if (res.error) throw res.error;
      var row = res.data && res.data[0];
      if (!row) throw new Error('Could not join this trip.');
      return row;
    });
  }

  var UPI_RE = /^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,30}$/i;
  function setMyUpi(upi) {
    var m = savedMembership();
    if (!m || !m.guest_token) return Promise.resolve();
    return sb.rpc('trip_set_my_upi', { p_invite_token: token, p_guest_token: m.guest_token, p_upi: upi || null })
      .then(function (res) {
        if (res.error) throw res.error;
        m.upi = upi || ''; saveMembership(m);
        try { if (upi) localStorage.setItem('kharcha_vpa_' + canonicalTripName(m.display_name).toLowerCase(), upi); } catch (e) {}
      });
  }
  // Everyone's saved UPI ids, so "Pay via UPI" is prefilled for each person.
  var memberUpis = {};
  function syncMemberUpis() {
    return sb.rpc('trip_member_upis', { p_invite_token: token }).then(function (res) {
      if (res.error || !res.data) return;
      try {
        res.data.forEach(function (r) {
          if (!r.upi) return;
          var key = canonicalTripName(r.member_name).toLowerCase();
          memberUpis[key] = r.upi;
          localStorage.setItem('kharcha_vpa_' + key, r.upi);
        });
        // Remember this guest's own UPI on this device too, so they never re-enter it.
        var m = savedMembership();
        if (m && m.display_name) {
          var mine = memberUpis[canonicalTripName(m.display_name).toLowerCase()];
          if (mine && m.upi !== mine) { m.upi = mine; saveMembership(m); }
        }
      } catch (e) {}
    }, function () {});
  }

  function renderJoinForm(tripName) {
    app.innerHTML = '';
    app.appendChild(renderHero(tripName));
    var card = el('div', 'card');
    card.appendChild(el('p', 'sub', "Enter your name to see what's been spent and add your own."));
    var field = el('div', 'field');
    var label = el('label', null, 'Your name');
    var input = el('input'); input.placeholder = 'e.g. Rohit'; input.maxLength = 40;
    field.appendChild(label); field.appendChild(input);
    card.appendChild(field);
    var ufield = el('div', 'field');
    var ulabel = el('label', null, 'Your UPI ID (optional, so friends can pay you)');
    var uinput = el('input'); uinput.placeholder = 'e.g. rohit@okhdfcbank'; uinput.maxLength = 80;
    uinput.setAttribute('autocapitalize', 'none'); uinput.setAttribute('autocomplete', 'off');
    ufield.appendChild(ulabel); ufield.appendChild(uinput);
    card.appendChild(ufield);
    var err = el('p', 'err'); err.hidden = true;
    var btn = el('button', 'primary', 'Join trip');
    btn.addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) { err.textContent = 'Enter your name.'; err.hidden = false; return; }
      var upi = uinput.value.trim();
      if (upi && !UPI_RE.test(upi)) { err.textContent = 'That UPI ID looks wrong (like name@bank). Fix it or leave it empty.'; err.hidden = false; return; }
      btn.disabled = true; err.hidden = true;
      join(name, null).then(function (row) {
        saveMembership({ guest_token: row.guest_token, display_name: row.display_name });
        if (upi) setMyUpi(upi).catch(function () {});
        renderTrip(row.trip_name);
      }).catch(function (e) {
        err.textContent = (e && e.message) || 'Could not join. Try again.';
        err.hidden = false;
        btn.disabled = false;
      });
    });
    // A returning friend on a new phone/browser: typing their name brings back the UPI ID they saved before.
    syncMemberUpis().then(function () {
      var fill = function () {
        if (uinput.value.trim()) return;
        var u = memberUpis[canonicalTripName(input.value.trim()).toLowerCase()];
        if (u) uinput.value = u;
      };
      input.addEventListener('input', fill); fill();
    });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') btn.click(); });
    card.appendChild(err); card.appendChild(btn);
    app.appendChild(card);
    var joinInstall = el('div', 'card');
    renderInstallRow(joinInstall);
    if (joinInstall.children.length) app.appendChild(joinInstall);
    input.focus();
  }

  function getSavedVpa(personName) {
    try {
      var norm = canonicalTripName(personName).toLowerCase();
      var direct = localStorage.getItem('kharcha_vpa_' + norm) || localStorage.getItem('kharcha_vpa_' + (personName || '').toLowerCase());
      if (direct) return direct;
      var myUpi = localStorage.getItem('kharcha_my_upi');
      if (myUpi && (norm.includes('sanjeev') || norm === 'me')) {
        return myUpi;
      }
      return '';
    } catch (e) { return ''; }
  }

  function isTripSettlementEntry(e) {
    if (!e) return false;
    var KL = window.KharchaLedger;
    if (KL && typeof KL.isTripSettlement === 'function') return KL.isTripSettlement(e);
    if (e.isSettlement === true) return true;
    var s = (typeof e === 'string' ? e : (e.label || '') + ' ' + (e.desc || '') + ' ' + (e.description || '')).toLowerCase();
    return s.includes('[settlement]') || s.includes('🤝 settlement') || s.includes('settlement payment') || s.includes('settle up');
  }

  function recordGuestSettlement(toPerson, paidAmount, tripName) {
    var membership = savedMembership();
    var myName = (membership && membership.display_name ? membership.display_name.trim() : 'Guest');
    var desc = '🤝 Settlement: ' + myName + ' paid ' + toPerson + ' [Settlement]';
    return sb.rpc('trip_add_expense', {
      p_invite_token: token,
      p_guest_token: (membership && membership.guest_token) || null,
      p_amount: Number(paidAmount),
      p_description: desc,
      p_split_among: [toPerson]
    }).then(function (res) {
      if (res && res.error) throw res.error;
      sessionStorage.removeItem('kharcha_pending_settlement');
      return res;
    });
  }

  function showPendingSettlementPrompt(pend, onSettledCallback) {
    if (!pend || !pend.to || !pend.amount) return;
    if (document.getElementById('pending-settle-modal') || document.getElementById('upi-modal-root')) return;

    var backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'pending-settle-modal';
    var box = el('div', 'modal-box');

    var title = el('h2', 'modal-title', '💸 Complete Settlement?');
    var sub = el('p', 'modal-sub', 'Did you pay ' + money(pend.amount) + ' to ' + pend.to + '?');
    var note = el('p', null, 'Recording this will automatically deduct ' + money(pend.amount) + ' from what you owe, updating balances for everyone immediately.');
    note.style.fontSize = '0.85rem';
    note.style.color = 'var(--muted)';
    note.style.margin = '0 0 16px';

    var btnConfirm = el('button', 'btn-upi', '✅ Yes, Record Payment (' + money(pend.amount) + ')');
    btnConfirm.style.width = '100%';
    btnConfirm.style.background = '#10B981';
    btnConfirm.style.color = '#fff';

    var btnCancel = el('button', 'btn-secondary', 'No / Skip');
    btnCancel.style.width = '100%';

    btnConfirm.addEventListener('click', function () {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Updating…';
      recordGuestSettlement(pend.to, pend.amount, pend.tripName).then(function () {
        sessionStorage.removeItem('kharcha_pending_settlement');
        backdrop.remove();
        if (typeof onSettledCallback === 'function') onSettledCallback();
      }).catch(function () {
        sessionStorage.removeItem('kharcha_pending_settlement');
        backdrop.remove();
      });
    });

    btnCancel.addEventListener('click', function () {
      sessionStorage.removeItem('kharcha_pending_settlement');
      backdrop.remove();
    });

    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(note);
    box.appendChild(btnConfirm);
    box.appendChild(btnCancel);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  function showUpiModal(personName, amount, tripName, onSettledCallback) {
    var existingModal = document.getElementById('upi-modal-root');
    if (existingModal) existingModal.remove();

    var savedVpa = getSavedVpa(personName);

    var backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'upi-modal-root';

    var box = el('div', 'modal-box');

    var title = el('h2', 'modal-title', '⚡ Pay via UPI');
    var sub = el('p', 'modal-sub', 'Paying ' + personName);

    var amtField = el('div', 'field');
    var amtLabel = el('label', null, 'Amount to pay (₹)');
    var amtInput = el('input');
    amtInput.type = 'number';
    amtInput.inputMode = 'decimal';
    amtInput.value = Number(amount || 0);
    amtField.appendChild(amtLabel);
    amtField.appendChild(amtInput);

    var field = el('div', 'field');
    var label = el('label', null, personName + "'s UPI ID / VPA");
    var input = el('input');
    input.placeholder = 'e.g. name@okhdfcbank or 98xxxxxx@upi';
    input.value = savedVpa || '';
    input.autocomplete = 'off';
    field.appendChild(label);
    field.appendChild(input);

    var statusMsg = el('p', 'err');
    statusMsg.style.margin = '0';
    statusMsg.hidden = true;

    var btnPay = el('button', 'btn-upi', '🚀 Open UPI App (GPay / PhonePe / Paytm)');
    btnPay.style.width = '100%';
    btnPay.style.padding = '12px 16px';
    btnPay.style.fontSize = '0.96rem';

    var btnRecordDirect = el('button', 'btn-secondary', '🤝 Record payment without UPI');
    btnRecordDirect.style.width = '100%';
    btnRecordDirect.style.margin = '4px 0 0';

    var btnCopy = el('button', 'btn-secondary', '📋 Copy UPI Link');
    var btnCancel = el('button', 'btn-secondary', 'Cancel');

    var btnRow = el('div', 'modal-btn-row');
    btnRow.appendChild(btnCopy);
    btnRow.appendChild(btnCancel);

    function showConfirmationStep(payAmount) {
      box.innerHTML = '';
      var cTitle = el('h2', 'modal-title', '💸 Confirm Payment');
      var cSub = el('p', 'modal-sub', 'Did you complete the payment of ' + money(payAmount) + ' to ' + personName + '?');
      var cNote = el('p', null, 'Recording this will automatically deduct ' + money(payAmount) + ' from what you owe, updating balances on all phones immediately.');
      cNote.style.fontSize = '0.85rem';
      cNote.style.color = 'var(--muted)';
      cNote.style.margin = '0 0 16px';

      var cErr = el('p', 'err'); cErr.hidden = true;

      var btnConfirm = el('button', 'btn-upi', '✅ Yes, Record Payment (' + money(payAmount) + ')');
      btnConfirm.style.width = '100%';
      btnConfirm.style.padding = '12px 16px';
      btnConfirm.style.background = '#10B981';
      btnConfirm.style.color = '#fff';
      btnConfirm.style.border = 'none';

      var btnNotYet = el('button', 'btn-secondary', 'Not yet / Cancel');
      btnNotYet.style.width = '100%';

      btnConfirm.addEventListener('click', function () {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Updating ledger…';
        recordGuestSettlement(personName, payAmount, tripName).then(function () {
          backdrop.remove();
          if (typeof onSettledCallback === 'function') onSettledCallback();
        }).catch(function (err) {
          cErr.textContent = (err && err.message) || 'Could not save payment. Please try again.';
          cErr.hidden = false;
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Retry Recording Payment';
        });
      });

      btnNotYet.addEventListener('click', function () {
        backdrop.remove();
      });

      box.appendChild(cTitle);
      box.appendChild(cSub);
      box.appendChild(cNote);
      box.appendChild(cErr);
      box.appendChild(btnConfirm);
      box.appendChild(btnNotYet);
    }

    function triggerPay(vpa) {
      var payAmount = parseFloat(amtInput.value);
      if (!payAmount || payAmount <= 0) {
        statusMsg.textContent = 'Please enter a valid amount.';
        statusMsg.hidden = false;
        amtInput.focus();
        return;
      }
      if (!vpa || !vpa.trim()) {
        statusMsg.textContent = 'Please enter a valid UPI ID (e.g. name@okhdfcbank).';
        statusMsg.hidden = false;
        input.focus();
        return;
      }
      var cleanVpa = vpa.trim();
      var normName = canonicalTripName(personName).toLowerCase();
      try {
        localStorage.setItem('kharcha_vpa_' + normName, cleanVpa);
        localStorage.setItem('kharcha_vpa_' + (personName || '').toLowerCase(), cleanVpa);
      } catch (e) {}

      var membership = savedMembership();
      var myName = (membership && membership.display_name ? membership.display_name.trim() : 'Guest');
      try {
        sessionStorage.setItem('kharcha_pending_settlement', JSON.stringify({
          from: myName,
          to: personName,
          amount: payAmount,
          tripName: tripName,
          ts: Date.now()
        }));
      } catch (e) {}

      var KL = window.KharchaLedger;
      var note = (tripName || 'Trip') + ' settlement';
      var link = (KL && KL.upiPayLink) ?
        KL.upiPayLink(cleanVpa, personName, payAmount, note) :
        'upi://pay?pa=' + encodeURIComponent(cleanVpa) + '&pn=' + encodeURIComponent(personName) + '&am=' + Number(payAmount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note);

      // 1. If inside native Kharcha Book Android App with native bridge
      if (window.KharchaNative && typeof window.KharchaNative.payUpi === 'function') {
        window.KharchaNative.payUpi(cleanVpa, personName, String(payAmount), note);
        showConfirmationStep(payAmount);
        return;
      }

      // 2. Open UPI link in browser
      var opened = false;
      try {
        var a = document.createElement('a');
        a.href = link;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        opened = true;
        setTimeout(function () {
          try { document.body.removeChild(a); } catch (e) {}
        }, 500);
      } catch (err) {}
      if (!opened) {
        try { window.location.href = link; } catch (e) {}
      }
      showConfirmationStep(payAmount);
    }

    btnPay.addEventListener('click', function () {
      triggerPay(input.value);
    });

    btnRecordDirect.addEventListener('click', function () {
      var payAmount = parseFloat(amtInput.value);
      if (!payAmount || payAmount <= 0) {
        statusMsg.textContent = 'Please enter a valid amount.';
        statusMsg.hidden = false;
        amtInput.focus();
        return;
      }
      showConfirmationStep(payAmount);
    });

    btnCopy.addEventListener('click', function () {
      var payAmount = parseFloat(amtInput.value) || amount;
      var cleanVpa = (input.value || '').trim();
      if (!cleanVpa) {
        statusMsg.textContent = 'Enter UPI ID first to generate the link.';
        statusMsg.className = 'err';
        statusMsg.hidden = false;
        input.focus();
        return;
      }
      var KL = window.KharchaLedger;
      var note = (tripName || 'Trip') + ' settlement';
      var link = (KL && KL.upiPayLink) ?
        KL.upiPayLink(cleanVpa, personName, payAmount, note) :
        'upi://pay?pa=' + encodeURIComponent(cleanVpa) + '&pn=' + encodeURIComponent(personName) + '&am=' + Number(payAmount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note);

      function markCopied() {
        btnCopy.textContent = '✅ Copied!';
        statusMsg.textContent = 'UPI payment link copied to clipboard!';
        statusMsg.style.color = '#10B981';
        statusMsg.hidden = false;
        setTimeout(function () {
          btnCopy.textContent = '📋 Copy UPI Link';
          statusMsg.hidden = true;
          statusMsg.style.color = '';
        }, 3000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(markCopied).catch(function () {
          input.value = link;
          input.select();
          markCopied();
        });
      } else {
        input.value = link;
        input.select();
        markCopied();
      }
    });

    btnCancel.addEventListener('click', function () {
      backdrop.remove();
    });

    backdrop.addEventListener('click', function (ev) {
      if (ev.target === backdrop) backdrop.remove();
    });

    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(amtField);
    box.appendChild(field);
    box.appendChild(statusMsg);
    box.appendChild(btnPay);
    box.appendChild(btnRecordDirect);
    box.appendChild(btnRow);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    amtInput.focus();
  }

  function handleUpiPay(personName, amount, tripName, onSettledCallback) {
    showUpiModal(personName, amount, tripName, onSettledCallback);
  }

  function renderTrip(tripName) {
    var membership = savedMembership();
    var myName = (membership && membership.display_name ? membership.display_name.trim() : '');
    app.innerHTML = '';

    app.appendChild(renderHero(tripName));

    var head = el('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.margin = '0 0 16px';
    var userSub = el('p', 'sub', 'You: ' + (myName || 'Guest'));
    userSub.style.margin = '0';
    var changeBtn = el('button', 'btn-ghost-sm', 'Change name');
    changeBtn.addEventListener('click', function () {
      if (confirm('Switch to a different name on this trip?')) {
        localStorage.removeItem(storeKey);
        renderJoinForm(tripName);
      }
    });
    var m0 = savedMembership() || {};
    var upiBtn = el('button', 'btn-ghost-sm', m0.upi ? 'My UPI ✓' : 'Add my UPI');
    upiBtn.addEventListener('click', function () {
      var v = prompt('Your UPI ID (like name@bank). Friends will see it to pay you.', (savedMembership() || {}).upi || '');
      if (v === null) return;
      v = v.trim();
      if (v && !UPI_RE.test(v)) { alert('That UPI ID looks wrong.'); return; }
      setMyUpi(v).then(function () { upiBtn.textContent = v ? 'My UPI ✓' : 'Add my UPI'; })
        .catch(function () { alert('Could not save. Try again.'); });
    });
    syncMemberUpis().then(function () { if ((savedMembership() || {}).upi) upiBtn.textContent = 'My UPI ✓'; });
    var btns = el('div'); btns.style.display = 'flex'; btns.style.gap = '6px';
    btns.appendChild(upiBtn); btns.appendChild(changeBtn);
    head.appendChild(userSub);
    head.appendChild(btns);
    app.appendChild(head);

    // Summary Card (Total spend)
    var summaryCard = el('div', 'card');
    var totalEl = el('p', 'total', '₹0');
    var noteEl = el('p', 'total-note', 'Loading…');
    summaryCard.appendChild(totalEl); summaryCard.appendChild(noteEl);
    app.appendChild(summaryCard);

    // Personal Splitwise Standing Card (You owe / You are owed)
    var personalCard = el('div');
    app.appendChild(personalCard);

    // Who Owes Whom (Fewest payments transfer list)
    var transfersCard = el('div', 'card');
    var transfersHeading = el('h2', null, 'Who owes whom');
    transfersHeading.style.margin = '0 0 10px';
    transfersHeading.style.fontSize = '1rem';
    transfersCard.appendChild(transfersHeading);
    var transfersList = el('ul', 'list');
    transfersCard.appendChild(transfersList);
    app.appendChild(transfersCard);

    // Balances & Shares per Person
    var byPersonCard = el('div', 'card');
    var byPersonHeading = el('h2', null, 'Balances & shares');
    byPersonHeading.style.margin = '0 0 10px';
    byPersonHeading.style.fontSize = '1rem';
    byPersonCard.appendChild(byPersonHeading);
    var byPersonList = el('ul', 'list');
    byPersonCard.appendChild(byPersonList);
    app.appendChild(byPersonCard);

    // All Itemized Expenses
    var listCard = el('div', 'card');
    var listHeading = el('h2', null, 'All expenses');
    listHeading.style.margin = '0 0 10px';
    listHeading.style.fontSize = '1rem';
    listCard.appendChild(listHeading);
    var listEl = el('ul', 'list');
    listCard.appendChild(listEl);
    app.appendChild(listCard);

    // Add Expense Card with Split Selector
    var addCard = el('div', 'card');
    var addHeading = el('h2', null, '+ Add your expense');
    addHeading.style.margin = '0 0 12px';
    addHeading.style.fontSize = '1rem';
    addCard.appendChild(addHeading);

    var amtField = el('div', 'field');
    amtField.appendChild(el('label', null, 'Amount (₹)'));
    var amtInput = el('input'); amtInput.inputMode = 'decimal'; amtInput.placeholder = '0';
    amtField.appendChild(amtInput);

    var descField = el('div', 'field');
    descField.appendChild(el('label', null, 'What was it?'));
    var descInput = el('input'); descInput.maxLength = 80; descInput.placeholder = 'e.g. Lunch, Taxi, Hotel share';
    descField.appendChild(descInput);

    var splitField = el('div', 'field');
    var splitHead = el('div');
    splitHead.style.display = 'flex';
    splitHead.style.justifyContent = 'space-between';
    splitHead.style.alignItems = 'center';
    splitHead.appendChild(el('label', null, 'Split between'));
    var splitSummary = el('span', 'split-summary-sub', 'Everyone (equal)');
    splitSummary.style.fontSize = '0.78rem';
    splitSummary.style.color = 'var(--muted)';
    splitSummary.style.fontWeight = '600';
    splitHead.appendChild(splitSummary);
    splitField.appendChild(splitHead);

    var chipBox = el('div', 'chip-box');
    splitField.appendChild(chipBox);

    var addErr = el('p', 'err'); addErr.hidden = true;
    var addBtn = el('button', 'primary', 'Add expense');
    addCard.appendChild(amtField);
    addCard.appendChild(descField);
    addCard.appendChild(splitField);
    addCard.appendChild(addErr);
    addCard.appendChild(addBtn);
    app.appendChild(addCard);

    var installCard = el('div', 'card');
    renderInstallRow(installCard);
    if (installCard.children.length) app.appendChild(installCard);

    var brand = el('p', 'brand');
    brand.innerHTML = 'Powered by Kharcha Book';
    app.appendChild(brand);

    var knownParticipants = [];
    var selectedSplitNames = null; // null = everyone

    function updateSplitSummary() {
      if (!splitSummary) return;
      var amt = parseFloat((amtInput.value || '').replace(/,/g, '')) || 0;
      var totalCount = knownParticipants.length;
      var selectedList = (Array.isArray(selectedSplitNames) && selectedSplitNames.length) ? selectedSplitNames : knownParticipants;
      var count = selectedList.length;

      if (!selectedSplitNames || selectedSplitNames.length === totalCount) {
        var txt = 'Everyone (' + totalCount + (totalCount === 1 ? ' person' : ' people') + ')';
        if (amt > 0 && totalCount > 0) {
          txt += ' · ' + money(Math.round(amt / totalCount)) + ' each';
        }
        splitSummary.textContent = txt;
      } else {
        var names = selectedList.join(', ');
        var txt = count + ' of ' + totalCount + ' (' + names + ')';
        if (amt > 0 && count > 0) {
          txt += ' · ' + money(Math.round(amt / count)) + ' each';
        }
        splitSummary.textContent = txt;
      }
    }

    amtInput.addEventListener('input', updateSplitSummary);

    function updateSplitChips(participants) {
      knownParticipants = participants || [];
      chipBox.innerHTML = '';

      var isAllActive = (!selectedSplitNames || selectedSplitNames.length === knownParticipants.length);

      var chipAll = el('span', 'chip' + (isAllActive ? ' active' : ''), '👥 Everyone');
      chipAll.addEventListener('click', function () {
        selectedSplitNames = null;
        updateSplitChips(knownParticipants);
      });
      chipBox.appendChild(chipAll);

      knownParticipants.forEach(function (name) {
        var isSelected = isAllActive || (selectedSplitNames && selectedSplitNames.indexOf(name) >= 0);
        var chip = el('span', 'chip' + (isSelected ? ' active' : ''));
        chip.textContent = (isSelected ? '✓ ' : '') + name;

        chip.addEventListener('click', function () {
          if (!selectedSplitNames) {
            // All were active. Tapping this person excludes them.
            selectedSplitNames = knownParticipants.filter(function (x) { return x !== name; });
          } else {
            var idx = selectedSplitNames.indexOf(name);
            if (idx >= 0) {
              if (selectedSplitNames.length > 1) {
                selectedSplitNames.splice(idx, 1);
              }
            } else {
              selectedSplitNames.push(name);
              if (selectedSplitNames.length === knownParticipants.length) {
                selectedSplitNames = null;
              }
            }
          }
          updateSplitChips(knownParticipants);
        });
        chipBox.appendChild(chip);
      });

      updateSplitSummary();
    }

    function refresh() {
      syncMemberUpis();
      sb.rpc('trip_summary', { p_invite_token: token }).then(function (res) {
        if (res.error || !res.data || !res.data.length) throw res.error || new Error('no data');
        var s = res.data[0];
        var items = s.expenses || [];

        // Deduplicate any duplicate owner-mirrored entries (same amount, description, spent_at where member_id is null)
        var seenOwnerKeys = new Set();
        var deduped = [];
        items.forEach(function (e) {
          if (!e.member_id) {
            var key = Number(e.amount).toFixed(2) + '|' + (e.description || '').trim().toLowerCase() + '|' + (e.spent_at || '');
            if (seenOwnerKeys.has(key)) return;
            seenOwnerKeys.add(key);
          }
          deduped.push(e);
        });
        items = deduped;

        var nonSettlementItems = items.filter(function (e) { return !isTripSettlementEntry(e); });
        var actualTotal = nonSettlementItems.reduce(function (sum, e) { return sum + Number(e.amount); }, 0);
        totalEl.textContent = money(actualTotal);
        noteEl.textContent = nonSettlementItems.length + (nonSettlementItems.length === 1 ? ' expense logged' : ' expenses logged');

        // Collect all distinct names
        var namesSet = new Set();
        if (myName) {
          var cMe = canonicalTripName(myName);
          if (cMe) namesSet.add(cMe);
        }

        var KL = window.KharchaLedger;

        try {
          var urlParamFriends = (new URLSearchParams(window.location.search).get('f') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          urlParamFriends.forEach(function (f) {
            var c = canonicalTripName(f);
            if (c) namesSet.add(c);
          });
          var savedFriends = JSON.parse(localStorage.getItem('kharcha_trip_friends_' + (tripName || '')) || '[]');
          savedFriends.forEach(function (f) {
            var c = canonicalTripName(f);
            if (c) namesSet.add(c);
          });
        } catch (e) {}

        items.forEach(function (e) {
          if (e.added_by_name) {
            var c = canonicalTripName(e.added_by_name);
            if (c) namesSet.add(c);
          }
          if (Array.isArray(e.split_among)) {
            e.split_among.forEach(function (n) {
              var c = canonicalTripName(n);
              if (c) namesSet.add(c);
            });
          }
          if (isTripSettlementEntry(e)) {
            var py = (KL && KL.parseTripSettlementPayee) ? KL.parseTripSettlementPayee(e.description, 'Sanjeev Yadav') : null;
            if (py) {
              var cpy = canonicalTripName(py);
              if (cpy) namesSet.add(cpy);
            }
          }
        });
        var participants = Array.from(namesSet);
        try {
          localStorage.setItem('kharcha_trip_friends_' + (tripName || ''), JSON.stringify(participants));
        } catch (e) {}
        updateSplitChips(participants);

        // Map expenses for settlement calculation
        var mapped = items.map(function (e) {
          var p = canonicalTripName(e.added_by_name);
          var isSettle = isTripSettlementEntry(e);
          var payee = (KL && KL.parseTripSettlementPayee) ? KL.parseTripSettlementPayee(e.description, 'Sanjeev Yadav') : null;
          var splitSubset = null;
          if (Array.isArray(e.split_among)) {
            splitSubset = [];
            e.split_among.forEach(function (n) {
              var c = canonicalTripName(n);
              if (c && splitSubset.indexOf(c) < 0) splitSubset.push(c);
            });
          }
          if (!splitSubset && payee) splitSubset = [payee];
          return {
            id: e.id,
            label: e.description,
            amount: Number(e.amount),
            payer: p,
            payee: payee,
            splitAmong: splitSubset,
            isSettlement: isSettle
          };
        });

        var settlement = null;
        if (KL && typeof KL.tripSettlement === 'function') {
          settlement = KL.tripSettlement(mapped, participants, 'Sanjeev Yadav');
        }

        // Render Personal Standing Card
        personalCard.innerHTML = '';
        var myCanonical = canonicalTripName(myName);
        if (settlement && myCanonical) {
          var myPerson = settlement.people.find(function (p) {
            return canonicalTripName(p.name).toLowerCase() === myCanonical.toLowerCase();
          });
          if (myPerson) {
            var box = el('div', 'settle-hero');
            if (myPerson.net < -0.01) {
              box.classList.add('settle-owe');
              var netOwe = Math.abs(myPerson.net);
              box.appendChild(el('p', 'settle-headline', '🔴 You owe ' + money(netOwe) + ' in total'));
              box.appendChild(el('p', 'settle-sub', 'Your fair share: ' + money(myPerson.share) + ' · You paid: ' + money(myPerson.paid)));

              var myDebts = settlement.transfers.filter(function (t) {
                return canonicalTripName(t.from).toLowerCase() === myCanonical.toLowerCase();
              });
              if (myDebts.length) {
                var debtsList = el('div');
                debtsList.style.marginTop = '6px';
                myDebts.forEach(function (t) {
                  var dRow = el('div');
                  dRow.style.display = 'flex';
                  dRow.style.alignItems = 'center';
                  dRow.style.justifyContent = 'space-between';
                  dRow.style.gap = '8px';
                  dRow.style.padding = '6px 0';
                  dRow.style.borderTop = '1px solid rgba(0,0,0,0.06)';

                  var dText = el('span', null, 'Pay ' + t.to + ': ' + money(t.amount));
                  dText.style.fontWeight = '600';
                  dText.style.fontSize = '0.92rem';
                  dRow.appendChild(dText);

                  var actBox = el('div', 'settle-actions');
                  actBox.style.margin = '0';
                  actBox.style.display = 'flex';
                  actBox.style.gap = '6px';

                  var payBtn = el('button', 'btn-upi', '⚡ Pay UPI');
                  payBtn.title = 'Pay via UPI / GPay / PhonePe';
                  payBtn.addEventListener('click', function () {
                    handleUpiPay(t.to, t.amount, tripName, refresh);
                  });
                  actBox.appendChild(payBtn);

                  var settleBtn = el('button', 'btn-wa', '🤝 Settle');
                  settleBtn.title = 'Record settlement payment';
                  settleBtn.style.background = 'rgba(16, 185, 129, 0.15)';
                  settleBtn.style.color = '#059669';
                  settleBtn.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                  settleBtn.addEventListener('click', function () {
                    showUpiModal(t.to, t.amount, tripName, refresh);
                  });
                  actBox.appendChild(settleBtn);

                  var waBtn = el('button', 'btn-wa', '📲 WhatsApp');
                  waBtn.title = 'Send payment message on WhatsApp';
                  waBtn.addEventListener('click', function () {
                    var vpa = getSavedVpa(t.to);
                    var msg = 'Hey ' + t.to + ', I am settling my ' + (tripName || 'trip') + ' share of ' + money(t.amount) + '.';
                    if (vpa) msg += '\nPay link: ' + (KL && KL.upiPayLink ? KL.upiPayLink(vpa, t.to, t.amount, tripName) : '');
                    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
                  });
                  actBox.appendChild(waBtn);

                  dRow.appendChild(actBox);
                  debtsList.appendChild(dRow);
                });
                box.appendChild(debtsList);
              }
            } else if (myPerson.net > 0.01) {
              box.classList.add('settle-owed');
              box.appendChild(el('p', 'settle-headline', '🟢 You get back ' + money(myPerson.net)));
              box.appendChild(el('p', 'settle-sub', 'You paid: ' + money(myPerson.paid) + ' · Your share: ' + money(myPerson.share)));

              var owedToMe = settlement.transfers.filter(function (t) {
                return canonicalTripName(t.to).toLowerCase() === myCanonical.toLowerCase();
              });
              if (owedToMe.length) {
                var owesList = el('div');
                owesList.style.marginTop = '6px';
                owedToMe.forEach(function (t) {
                  var oRow = el('div');
                  oRow.style.display = 'flex';
                  oRow.style.alignItems = 'center';
                  oRow.style.justifyContent = 'space-between';
                  oRow.style.gap = '8px';
                  oRow.style.padding = '6px 0';
                  oRow.style.borderTop = '1px solid rgba(0,0,0,0.06)';

                  var oText = el('span', null, t.from + ' owes you: ' + money(t.amount));
                  oText.style.fontWeight = '600';
                  oText.style.fontSize = '0.92rem';
                  oRow.appendChild(oText);

                  var actBox = el('div', 'settle-actions');
                  actBox.style.margin = '0';
                  actBox.style.display = 'flex';
                  actBox.style.gap = '6px';

                  var recBtn = el('button', 'btn-wa', '🤝 Settle');
                  recBtn.title = 'Record payment received from ' + t.from;
                  recBtn.style.background = 'rgba(16, 185, 129, 0.15)';
                  recBtn.style.color = '#059669';
                  recBtn.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                  recBtn.addEventListener('click', function () {
                    showUpiModal(t.from, t.amount, tripName, refresh);
                  });
                  actBox.appendChild(recBtn);

                  var waRemind = el('button', 'btn-wa', '📲 Remind');
                  waRemind.addEventListener('click', function () {
                    var myVpa = getSavedVpa(myCanonical);
                    var msg = 'Hey ' + t.from + ', your share for ' + (tripName || 'our trip') + ' comes to ' + money(t.amount) + '.';
                    if (myVpa) msg += '\nPay to UPI ID: ' + myVpa;
                    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
                  });
                  actBox.appendChild(waRemind);

                  oRow.appendChild(actBox);
                  owesList.appendChild(oRow);
                });
                box.appendChild(owesList);
              }
            } else {
              box.classList.add('settle-even');
              box.appendChild(el('p', 'settle-headline', '🎉 You\'re all settled up!'));
              box.appendChild(el('p', 'settle-sub', 'Paid: ' + money(myPerson.paid) + ' · Share: ' + money(myPerson.share)));
            }
            personalCard.appendChild(box);
          }
        }

        // Render Who Owes Whom (Transfers)
        transfersList.innerHTML = '';
        if (!settlement || !settlement.transfers || !settlement.transfers.length) {
          transfersList.appendChild(el('li', 'empty', 'Everyone is all squared up! 🎉'));
        } else {
          settlement.transfers.forEach(function (t) {
            var row = el('li', 'transfer-item');
            var who = el('div');
            var fName = el('span', 'transfer-who', t.from);
            var arrow = el('span', 'transfer-arrow', '➔');
            var tName = el('span', 'transfer-who', t.to);
            who.appendChild(fName); who.appendChild(arrow); who.appendChild(tName);
            row.appendChild(who);

            var rRight = el('div');
            rRight.style.display = 'flex';
            rRight.style.alignItems = 'center';
            rRight.style.gap = '8px';

            var amt = el('span', 'transfer-amt', money(t.amount));
            rRight.appendChild(amt);

            if (myCanonical && canonicalTripName(t.from).toLowerCase() === myCanonical.toLowerCase()) {
              var paySm = el('button', 'btn-upi', '⚡ Pay');
              paySm.style.padding = '5px 10px';
              paySm.style.fontSize = '0.78rem';
              paySm.addEventListener('click', function () {
                handleUpiPay(t.to, t.amount, tripName, refresh);
              });
              rRight.appendChild(paySm);

              var setSm = el('button', 'btn-wa', '🤝 Settle');
              setSm.style.padding = '5px 10px';
              setSm.style.fontSize = '0.78rem';
              setSm.style.background = 'rgba(16, 185, 129, 0.15)';
              setSm.style.color = '#059669';
              setSm.style.border = '1px solid rgba(16, 185, 129, 0.3)';
              setSm.addEventListener('click', function () {
                showUpiModal(t.to, t.amount, tripName, refresh);
              });
              rRight.appendChild(setSm);
            }
            row.appendChild(rRight);
            transfersList.appendChild(row);
          });
        }

        // Render Balances & Shares per Person
        byPersonList.innerHTML = '';
        if (!settlement || !settlement.people || !settlement.people.length) {
          byPersonList.appendChild(el('li', 'empty', 'Nobody has logged anything yet.'));
        } else {
          settlement.people.forEach(function (p) {
            var row = el('li', 'person-row');
            var info = el('div', 'person-info');
            var isMe = (myCanonical && canonicalTripName(p.name).toLowerCase() === myCanonical.toLowerCase());
            var pName = el('span', 'person-name', p.name + (isMe ? ' (You)' : ''));
            var pMeta = el('span', 'person-meta', 'Paid: ' + money(p.paid) + ' · Share: ' + money(p.share));
            info.appendChild(pName); info.appendChild(pMeta);
            row.appendChild(info);

            var statusPill = el('span', 'person-status');
            if (p.net > 0.01) {
              statusPill.classList.add('status-pos');
              statusPill.textContent = '+' + money(p.net);
            } else if (p.net < -0.01) {
              statusPill.classList.add('status-neg');
              statusPill.textContent = '-' + money(Math.abs(p.net));
            } else {
              statusPill.classList.add('status-zero');
              statusPill.textContent = 'Settled';
            }
            row.appendChild(statusPill);
            byPersonList.appendChild(row);
          });
        }

        // Render All Expenses
        listEl.innerHTML = '';
        if (!items.length) {
          listEl.appendChild(el('li', 'empty', 'No expenses yet -- be the first to add one.'));
        } else {
          items.forEach(function (e) {
            var row = el('li', 'row');
            var l = el('div', 'row-l');
            l.appendChild(el('span', 'row-desc', e.description));
            var metaText = e.added_by_name + ' · ' + new Date(e.spent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            l.appendChild(el('span', 'row-meta', metaText));

            if (isTripSettlementEntry(e)) {
              var sBadge = el('span', 'tag-split', '🤝 Settlement');
              sBadge.style.background = 'rgba(16, 185, 129, 0.15)';
              sBadge.style.color = '#059669';
              l.appendChild(sBadge);
            } else if (Array.isArray(e.split_among) && e.split_among.length) {
              var splitTag = el('span', 'tag-split', '👥 Split: ' + e.split_among.join(', '));
              l.appendChild(splitTag);
            }

            row.appendChild(l);
            row.appendChild(el('span', 'row-amt', money(e.amount)));
            listEl.appendChild(row);
          });
        }
      }).catch(function () {
        noteEl.textContent = 'Could not load the latest numbers -- showing what we last saw.';
      });
    }

    addBtn.addEventListener('click', function () {
      var amt = parseFloat((amtInput.value || '').replace(/,/g, ''));
      var desc = descInput.value.trim();
      addErr.hidden = true;
      if (!amt || amt <= 0) { addErr.textContent = 'Enter an amount greater than zero.'; addErr.hidden = false; return; }
      if (!desc) { addErr.textContent = 'Add a short description.'; addErr.hidden = false; return; }
      addBtn.disabled = true;

      var isSubset = Array.isArray(selectedSplitNames) && selectedSplitNames.length > 0 && selectedSplitNames.length < knownParticipants.length;
      var splitPayload = isSubset ? selectedSplitNames : null;

      sb.rpc('trip_add_expense', {
        p_invite_token: token, p_guest_token: membership.guest_token,
        p_amount: amt, p_description: desc,
        p_split_among: splitPayload
      }).then(function (res) {
        if (res.error) throw res.error;
        amtInput.value = ''; descInput.value = '';
        selectedSplitNames = null;
        refresh();
      }).catch(function (e) {
        addErr.textContent = (e && e.message) || 'Could not save. Try again.';
        addErr.hidden = false;
      }).finally(function () { addBtn.disabled = false; });
    });
    descInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') addBtn.click(); });

    refresh();
    var timer = setInterval(function () { if (!document.hidden) refresh(); }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refresh();
        try {
          var pend = JSON.parse(sessionStorage.getItem('kharcha_pending_settlement') || 'null');
          if (pend && Date.now() - pend.ts < 600000) {
            showPendingSettlementPrompt(pend, refresh);
          }
        } catch (e) {}
      }
    });
    window.addEventListener('beforeunload', function () { clearInterval(timer); });
  }

  // Entry point: recognize a returning guest via their saved token, else ask for a name.
  var existing = savedMembership();
  if (existing && existing.guest_token) {
    join(null, existing.guest_token).then(function (row) {
      saveMembership({ guest_token: row.guest_token, display_name: row.display_name });
      renderTrip(row.trip_name);
    }).catch(function () {
      // Saved token no longer valid (link regenerated, etc.) -- fall back to joining fresh.
      renderJoinForm();
    });
  } else {
    // Still worth checking the token is live before asking for a name, so a dead link fails
    // fast with a clear reason instead of after someone's typed their name. Also gets the trip's
    // real name for the welcome hero, before anyone has joined yet.
    sb.rpc('trip_summary', { p_invite_token: token }).then(function (res) {
      if (res.error) throw res.error;
      renderJoinForm(res.data && res.data[0] && res.data[0].trip_name);
    }).catch(function (e) {
      showError((e && e.message) || "This trip link isn't active anymore. Ask them to resend it.");
    });
  }
})();
