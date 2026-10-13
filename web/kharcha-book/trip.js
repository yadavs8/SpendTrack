// Kharcha Book -- shared trip guest page. Deliberately standalone: no personal-finance code,
// no bank parsing, no auth, nothing from app.js. A friend here never gets a Supabase account --
// every call below goes through a token-checked Postgres function (see
// supabase/kharcha_trip_sharing_v1.sql), never a direct table read/write.
(function () {
  'use strict';

  var CFG = window.KHARCHA_CONFIG || null;
  var params = new URLSearchParams(location.search);
  var token = (params.get('t') || '').trim();
  var app = document.getElementById('app');

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
  function renderInstallRow(container) {
    // Running standalone already (installed and opened from the home screen) -- nothing to offer.
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
    var row = el('div', 'install-row');
    var p = el('p', null, 'Add this to your home screen so you don\'t need to find this link again.');
    var btn = el('button', 'ghost', '📲 Install');
    btn.id = 'install-btn';
    btn.hidden = !deferredInstallPrompt; // shown once the browser offers it (Chrome/Edge); hidden otherwise
    btn.addEventListener('click', function () {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () { deferredInstallPrompt = null; btn.hidden = true; });
    });
    row.appendChild(p); row.appendChild(btn);
    container.appendChild(row);
    // Safari/iOS never fires beforeinstallprompt -- tell them the manual way instead of showing nothing.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) {
      p.textContent = 'Add this to your home screen: tap Share, then "Add to Home Screen".';
      btn.hidden = true;
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
    var err = el('p', 'err'); err.hidden = true;
    var btn = el('button', 'primary', 'Join trip');
    btn.addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) { err.textContent = 'Enter your name.'; err.hidden = false; return; }
      btn.disabled = true; err.hidden = true;
      join(name, null).then(function (row) {
        saveMembership({ guest_token: row.guest_token, display_name: row.display_name });
        renderTrip(row.trip_name);
      }).catch(function (e) {
        err.textContent = (e && e.message) || 'Could not join. Try again.';
        err.hidden = false;
        btn.disabled = false;
      });
    });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') btn.click(); });
    card.appendChild(err); card.appendChild(btn);
    app.appendChild(card);
    input.focus();
  }

  function getSavedVpa(personName) {
    try {
      var direct = localStorage.getItem('kharcha_vpa_' + (personName || '').toLowerCase());
      if (direct) return direct;
      var myUpi = localStorage.getItem('kharcha_my_upi');
      if (myUpi && personName && (personName.toLowerCase().includes('sanjeev') || personName.toLowerCase() === 'me')) {
        return myUpi;
      }
      return '';
    } catch (e) { return ''; }
  }

  function showUpiModal(personName, amount, tripName) {
    var existingModal = document.getElementById('upi-modal-root');
    if (existingModal) existingModal.remove();

    var savedVpa = getSavedVpa(personName);

    var backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'upi-modal-root';

    var box = el('div', 'modal-box');

    var title = el('h2', 'modal-title', '⚡ Pay via UPI');
    var sub = el('p', 'modal-sub', 'Paying ' + money(amount) + ' to ' + personName);

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

    var btnCopy = el('button', 'btn-secondary', '📋 Copy UPI Link');
    var btnCancel = el('button', 'btn-secondary', 'Cancel');

    var btnRow = el('div', 'modal-btn-row');
    btnRow.appendChild(btnCopy);
    btnRow.appendChild(btnCancel);

    function triggerPay(vpa) {
      if (!vpa || !vpa.trim()) {
        statusMsg.textContent = 'Please enter a valid UPI ID (e.g. name@okhdfcbank).';
        statusMsg.hidden = false;
        input.focus();
        return;
      }
      var cleanVpa = vpa.trim();
      try { localStorage.setItem('kharcha_vpa_' + personName.toLowerCase(), cleanVpa); } catch (e) {}

      var KL = window.KharchaLedger;
      var note = (tripName || 'Trip') + ' settlement';
      var link = (KL && KL.upiPayLink) ?
        KL.upiPayLink(cleanVpa, personName, amount, note) :
        'upi://pay?pa=' + encodeURIComponent(cleanVpa) + '&pn=' + encodeURIComponent(personName) + '&am=' + Number(amount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note);

      // 1. If inside native Kharcha Book Android App with native bridge
      if (window.KharchaNative && typeof window.KharchaNative.payUpi === 'function') {
        window.KharchaNative.payUpi(cleanVpa, personName, String(amount), note);
        backdrop.remove();
        return;
      }

      // 2. Open UPI link in browser
      try {
        window.location.href = link;
      } catch (err) {
        var a = document.createElement('a');
        a.href = link;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try { document.body.removeChild(a); } catch (e) {}
        }, 500);
      }
      setTimeout(function () {
        try { backdrop.remove(); } catch (e) {}
      }, 1200);
    }

    btnPay.addEventListener('click', function () {
      triggerPay(input.value);
    });

    btnCopy.addEventListener('click', function () {
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
        KL.upiPayLink(cleanVpa, personName, amount, note) :
        'upi://pay?pa=' + encodeURIComponent(cleanVpa) + '&pn=' + encodeURIComponent(personName) + '&am=' + Number(amount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note);

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
    box.appendChild(field);
    box.appendChild(statusMsg);
    box.appendChild(btnPay);
    box.appendChild(btnRow);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    input.focus();
  }

  function handleUpiPay(personName, amount, tripName) {
    showUpiModal(personName, amount, tripName);
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
    head.appendChild(userSub);
    head.appendChild(changeBtn);
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
    splitField.appendChild(el('label', null, 'Split between'));
    var chipBox = el('div', 'chip-box');
    var chipAll = el('span', 'chip active', 'Everyone (equal)');
    chipBox.appendChild(chipAll);
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

    chipAll.addEventListener('click', function () {
      selectedSplitNames = null;
      var chips = chipBox.querySelectorAll('.chip');
      chips.forEach(function (c) { c.classList.remove('active'); });
      chipAll.classList.add('active');
    });

    function updateSplitChips(participants) {
      knownParticipants = participants || [];
      chipBox.innerHTML = '';
      chipAll.className = 'chip' + (!selectedSplitNames ? ' active' : '');
      chipBox.appendChild(chipAll);

      knownParticipants.forEach(function (name) {
        var chip = el('span', 'chip', name);
        if (selectedSplitNames && selectedSplitNames.indexOf(name) >= 0) chip.classList.add('active');
        chip.addEventListener('click', function () {
          if (!selectedSplitNames) {
            // First time switching from everyone -> select clicked person + self
            selectedSplitNames = [name];
            if (myName && selectedSplitNames.indexOf(myName) < 0) selectedSplitNames.push(myName);
          } else {
            var idx = selectedSplitNames.indexOf(name);
            if (idx >= 0) selectedSplitNames.splice(idx, 1);
            else selectedSplitNames.push(name);
            if (!selectedSplitNames.length) selectedSplitNames = null; // fall back to everyone
          }
          updateSplitChips(knownParticipants);
        });
        chipBox.appendChild(chip);
      });
    }

    function refresh() {
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

        var actualTotal = items.reduce(function (sum, e) { return sum + Number(e.amount); }, 0);
        totalEl.textContent = money(actualTotal);
        noteEl.textContent = items.length + (items.length === 1 ? ' expense logged' : ' expenses logged');

        // Collect all distinct names
        var namesSet = new Set();
        if (myName) namesSet.add(myName);
        items.forEach(function (e) {
          if (e.added_by_name) namesSet.add(e.added_by_name.trim());
          if (Array.isArray(e.split_among)) {
            e.split_among.forEach(function (n) { if (n) namesSet.add(n.trim()); });
          }
        });
        var participants = Array.from(namesSet);
        updateSplitChips(participants);

        // Map expenses for settlement calculation
        var mapped = items.map(function (e) {
          return {
            id: e.id,
            label: e.description,
            amount: Number(e.amount),
            payer: e.added_by_name,
            splitAmong: Array.isArray(e.split_among) ? e.split_among : null
          };
        });

        var settlement = null;
        var KL = window.KharchaLedger;
        if (KL && typeof KL.tripSettlement === 'function') {
          settlement = KL.tripSettlement(mapped, participants);
        }

        // Render Personal Standing Card
        personalCard.innerHTML = '';
        if (settlement && myName) {
          var myPerson = settlement.people.find(function (p) {
            return p.name.toLowerCase() === myName.toLowerCase();
          });
          if (myPerson) {
            var box = el('div', 'settle-hero');
            if (myPerson.net < -0.01) {
              box.classList.add('settle-owe');
              var netOwe = Math.abs(myPerson.net);
              box.appendChild(el('p', 'settle-headline', '🔴 You owe ' + money(netOwe) + ' in total'));
              box.appendChild(el('p', 'settle-sub', 'Your fair share: ' + money(myPerson.share) + ' · You paid: ' + money(myPerson.paid)));

              var myDebts = settlement.transfers.filter(function (t) {
                return t.from.toLowerCase() === myName.toLowerCase();
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

                  var payBtn = el('button', 'btn-upi', '⚡ Pay UPI');
                  payBtn.title = 'Pay via UPI / GPay / PhonePe';
                  payBtn.addEventListener('click', function () {
                    handleUpiPay(t.to, t.amount, tripName);
                  });
                  actBox.appendChild(payBtn);

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
                return t.to.toLowerCase() === myName.toLowerCase();
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

                  var waRemind = el('button', 'btn-wa', '📲 Remind');
                  waRemind.addEventListener('click', function () {
                    var myVpa = getSavedVpa(myName);
                    var msg = 'Hey ' + t.from + ', your share for ' + (tripName || 'our trip') + ' comes to ' + money(t.amount) + '.';
                    if (myVpa) msg += '\nPay to UPI ID: ' + myVpa;
                    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
                  });
                  oRow.appendChild(waRemind);
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

            if (myName && t.from.toLowerCase() === myName.toLowerCase()) {
              var paySm = el('button', 'btn-upi', '⚡ Pay');
              paySm.style.padding = '5px 10px';
              paySm.style.fontSize = '0.78rem';
              paySm.addEventListener('click', function () {
                handleUpiPay(t.to, t.amount, tripName);
              });
              rRight.appendChild(paySm);
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
            var pName = el('span', 'person-name', p.name + (myName && p.name.toLowerCase() === myName.toLowerCase() ? ' (You)' : ''));
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

            if (Array.isArray(e.split_among) && e.split_among.length) {
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

      var splitPayload = (Array.isArray(selectedSplitNames) && selectedSplitNames.length) ? selectedSplitNames : null;

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
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
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
