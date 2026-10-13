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

  function renderJoinForm() {
    app.innerHTML = '';
    var card = el('div', 'card');
    card.appendChild(el('h1', null, '✈️ Join this trip'));
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

  function renderTrip(tripName) {
    var membership = savedMembership();
    app.innerHTML = '';

    var head = el('div');
    head.appendChild(el('h1', null, '✈️ ' + tripName));
    head.appendChild(el('p', 'sub', 'You: ' + (membership ? membership.display_name : '') + ' · Kharcha Book shared trip'));
    app.appendChild(head);

    var summaryCard = el('div', 'card');
    var totalEl = el('p', 'total', '₹0');
    var noteEl = el('p', 'total-note', 'Loading…');
    summaryCard.appendChild(totalEl); summaryCard.appendChild(noteEl);
    app.appendChild(summaryCard);

    var byPersonCard = el('div', 'card');
    var byPersonHeading = el('h2', null, 'Who\'s spent what');
    byPersonHeading.style.margin = '0 0 10px';
    byPersonHeading.style.fontSize = '1rem';
    byPersonCard.appendChild(byPersonHeading);
    var byPersonList = el('ul', 'list');
    byPersonCard.appendChild(byPersonList);
    app.appendChild(byPersonCard);

    var listCard = el('div', 'card');
    var listHeading = el('h2', null, 'All expenses');
    listHeading.style.margin = '0 0 10px';
    listHeading.style.fontSize = '1rem';
    listCard.appendChild(listHeading);
    var listEl = el('ul', 'list');
    listCard.appendChild(listEl);
    app.appendChild(listCard);

    var addCard = el('div', 'card');
    var addHeading = el('h2', null, '+ Add your expense');
    addHeading.style.margin = '0 0 12px';
    addHeading.style.fontSize = '1rem';
    addCard.appendChild(addHeading);
    var amtField = el('div', 'field');
    amtField.appendChild(el('label', null, 'Amount'));
    var amtInput = el('input'); amtInput.inputMode = 'decimal'; amtInput.placeholder = '0';
    amtField.appendChild(amtInput);
    var descField = el('div', 'field');
    descField.appendChild(el('label', null, 'What was it?'));
    var descInput = el('input'); descInput.maxLength = 80; descInput.placeholder = 'e.g. Lunch, Cab, Hotel share';
    descField.appendChild(descInput);
    var addErr = el('p', 'err'); addErr.hidden = true;
    var addBtn = el('button', 'primary', 'Add expense');
    addCard.appendChild(amtField); addCard.appendChild(descField); addCard.appendChild(addErr); addCard.appendChild(addBtn);
    app.appendChild(addCard);

    var installCard = el('div', 'card');
    renderInstallRow(installCard);
    if (installCard.children.length) app.appendChild(installCard);

    var brand = el('p', 'brand');
    brand.innerHTML = 'Powered by Kharcha Book';
    app.appendChild(brand);

    function refresh() {
      sb.rpc('trip_summary', { p_invite_token: token }).then(function (res) {
        if (res.error || !res.data || !res.data.length) throw res.error || new Error('no data');
        var s = res.data[0];
        totalEl.textContent = money(s.total);
        noteEl.textContent = (s.expense_count || 0) + (s.expense_count === 1 ? ' expense logged' : ' expenses logged');
        var items = s.expenses || [];

        // Who's spent what: a running per-person total, lowest contributor to highest.
        byPersonList.innerHTML = '';
        if (!items.length) {
          byPersonList.appendChild(el('li', 'empty', 'Nobody has added anything yet.'));
        } else {
          var byPerson = {};
          items.forEach(function (e) { byPerson[e.added_by_name] = (byPerson[e.added_by_name] || 0) + Number(e.amount); });
          Object.keys(byPerson).sort(function (a, b) { return byPerson[b] - byPerson[a]; }).forEach(function (name) {
            var row = el('li', 'row');
            row.appendChild(el('span', 'row-desc', name));
            row.appendChild(el('span', 'row-amt', money(byPerson[name])));
            byPersonList.appendChild(row);
          });
        }

        listEl.innerHTML = '';
        if (!items.length) {
          listEl.appendChild(el('li', 'empty', 'No expenses yet -- be the first to add one.'));
        } else {
          items.forEach(function (e) {
            var row = el('li', 'row');
            var l = el('div', 'row-l');
            l.appendChild(el('span', 'row-desc', e.description));
            l.appendChild(el('span', 'row-meta', e.added_by_name + ' · ' + new Date(e.spent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })));
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
      sb.rpc('trip_add_expense', {
        p_invite_token: token, p_guest_token: membership.guest_token,
        p_amount: amt, p_description: desc
      }).then(function (res) {
        if (res.error) throw res.error;
        amtInput.value = ''; descInput.value = '';
        refresh();
      }).catch(function (e) {
        addErr.textContent = (e && e.message) || 'Could not save. Try again.';
        addErr.hidden = false;
      }).finally(function () { addBtn.disabled = false; });
    });
    descInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') addBtn.click(); });

    refresh();
    // Lightweight auto-refresh while the page is open and visible -- good enough until a later
    // phase adds Supabase Realtime instead of polling.
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
    // fast with a clear reason instead of after someone's typed their name.
    sb.rpc('trip_summary', { p_invite_token: token }).then(function (res) {
      if (res.error) throw res.error;
      renderJoinForm();
    }).catch(function (e) {
      showError((e && e.message) || "This trip link isn't active anymore. Ask them to resend it.");
    });
  }
})();
