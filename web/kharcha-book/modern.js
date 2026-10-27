/* Kharcha Book v47: modern layer. Night-mode button, bottom navigation, top-card extras, row icons,
   count-up total and smart suggestions. Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  // app.js publishes window.__kharcha when it has started, so look it up on every use.
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function svg(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
  }
  function raf(fn) { return (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- night mode ---------- */
  var MOON = svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
  var SUN = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light' || t === 'thanos') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintThemeButton() {
    var b = $('theme-btn'); if (!b) return;
    var dark = effectiveTheme() !== 'light';
    b.innerHTML = dark ? SUN : MOON;                 // shows what a tap switches to
    b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    b.title = dark ? 'Switch to day mode' : 'Switch to night mode';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', effectiveTheme() === 'thanos' ? '#1a0b2e' : dark ? '#0B1120' : '#0369A1');
    document.querySelectorAll('.theme-pill').forEach(function (x) { x.classList.toggle('active', x.dataset.theme === effectiveTheme()); });
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('kharcha_theme', t); } catch (e) {}
    paintThemeButton();
  }
  (function initTheme() {
    var top = document.querySelector('.top-r');
    if (!top) return;
    var b = el('button', 'installbtn theme-btn'); b.type = 'button'; b.id = 'theme-btn';
    b.setAttribute('aria-label', 'Night mode');
    b.addEventListener('click', function () { setTheme(effectiveTheme() === 'light' ? 'dark' : 'light'); });
    top.insertBefore(b, top.firstChild);
    paintThemeButton();
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      var fn = function () { paintThemeButton(); };
      if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
    }
  })();

  /* ---------- bottom navigation ---------- */
  var ICONS = {
    home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>'),
    income: svg('<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
    add: svg('<path d="M12 5v14M5 12h14"/>', ' stroke-width="2.6"'),
    trips: svg('<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 4-4"/>'),
    more: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>')
  };
  var NAV_OF = { spends: 'home', incomings: 'income', trips: 'trips' };   // everything else lives under More
  var MORE_GROUPS = [
    ['My money', [['monthly', '📊', 'Monthly', 'Savings'], ['bank', '🏦', 'Bank', 'Balance, cash'], ['card', '💳', 'Credit card', 'Owed, spends'], ['insights', '✨', 'Insights', 'Week, goals, net worth'], ['wallet', '👛', 'Wallet', 'Amazon Pay'], ['rules', '⚙️', 'Auto rules', 'Payees, monthly bills']]],
    ['People', [['udhaar', '🤝', 'Udhaar', 'Who owes you'], ['settlement', '👵', 'Settle', "Mother's money"]]],
    ['Plans', [['investments', '📈', 'Invest', 'SIPs and savings'], ['projects', '🔨', 'Projects', 'Home work costs']]],
    ['Account', [['phone', '📡', 'Phone connection', 'SMS, sync, settings'], ['__settings', '⚙️', 'Phone settings', 'SMS access, sync, lock'], ['__signout', '🚪', 'Sign out', '']]]
  ];
  var TITLES = {};
  MORE_GROUPS.forEach(function (g) { g[1].forEach(function (t) { TITLES[t[0]] = t[1] + ' ' + t[2]; }); });
  var bnav, sheet, card, backbar;
  var isDragging = false, startY = 0, startX = 0, currentY = 0, startTime = 0;
  var isFromHandle = false, didDrag = false, isClosing = false;

  function goStream(stream) {
    var old = document.querySelector('.streambtn[data-stream="' + stream + '"]');
    if (old) old.click();
    closeSheet(true);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function openSheet() {
    if (!sheet) return;
    if (isClosing) return;
    sheet.hidden = false;
    if (card) {
      card.scrollTop = 0;
      if (!reduceMotion) {
        card.style.transition = 'none';
        card.style.transform = 'translateY(100%)';
        sheet.style.transition = 'none';
        sheet.style.backgroundColor = 'rgba(2, 6, 23, 0)';
        void card.offsetHeight;
        card.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
        card.style.transform = 'translateY(0)';
        sheet.style.transition = 'background-color 0.28s ease';
        sheet.style.backgroundColor = '';
        setTimeout(function () {
          if (!isDragging && !isClosing && card) {
            card.style.transition = '';
            card.style.transform = '';
            sheet.style.transition = '';
          }
        }, 300);
      }
    }
  }

  function snapBack() {
    if (!card) return;
    card.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
    card.style.transform = 'translateY(0)';
    sheet.style.transition = 'background-color 0.24s ease';
    sheet.style.backgroundColor = '';
    setTimeout(function () {
      if (!isDragging && !isClosing && card) {
        card.style.transition = '';
        card.style.transform = '';
        sheet.style.transition = '';
      }
    }, 250);
  }

  function closeWithSlide(onDone) {
    if (!sheet || sheet.hidden) return;
    if (isClosing) return;
    isClosing = true;
    if (reduceMotion || !card) {
      sheet.hidden = true;
      if (card) {
        card.style.transition = '';
        card.style.transform = '';
      }
      sheet.style.backgroundColor = '';
      sheet.style.transition = '';
      isClosing = false;
      if (typeof onDone === 'function') onDone();
      return;
    }
    card.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';
    card.style.transform = 'translateY(100%)';
    sheet.style.transition = 'background-color 0.22s ease';
    sheet.style.backgroundColor = 'rgba(2, 6, 23, 0)';
    setTimeout(function () {
      sheet.hidden = true;
      if (card) {
        card.style.transition = '';
        card.style.transform = '';
      }
      sheet.style.backgroundColor = '';
      sheet.style.transition = '';
      isClosing = false;
      if (typeof onDone === 'function') onDone();
    }, 230);
  }

  function closeSheet(immediate) {
    if (immediate) {
      if (!sheet) return;
      sheet.hidden = true;
      if (card) {
        card.style.transition = '';
        card.style.transform = '';
      }
      sheet.style.backgroundColor = '';
      sheet.style.transition = '';
      isClosing = false;
    } else {
      closeWithSlide();
    }
  }

  function buildNav() {
    bnav = el('nav', 'bnav'); bnav.setAttribute('aria-label', 'Main'); bnav.hidden = true;
    var bar = el('div', 'bnav-bar');
    function item(key, label, cls) {
      var b = el('button', 'bnav-btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.dataset.nav = key;
      var ic = el('span', cls === 'bnav-add' ? 'fab' : 'ic'); ic.innerHTML = ICONS[key];
      b.appendChild(ic); b.appendChild(el('span', null, label)); bar.appendChild(b); return b;
    }
    item('home', 'Home').addEventListener('click', function () { goStream('spends'); });
    item('income', 'Income').addEventListener('click', function () { goStream('incomings'); });
    item('add', 'Add', 'bnav-add').addEventListener('click', function () {
      goStream('spends');
      var amt = $('amt'), form = $('add');
      if (form && form.scrollIntoView) form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      if (amt) setTimeout(function () { try { amt.focus({ preventScroll: true }); } catch (e) { amt.focus(); } }, 250);
    });
    item('trips', 'Trips').addEventListener('click', function () { goStream('trips'); });
    item('more', 'More').addEventListener('click', openSheet);
    bnav.appendChild(bar); document.body.appendChild(bnav);

    sheet = el('div', 'msheet'); sheet.hidden = true;
    card = el('div', 'msheet-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'More');
    var handle = el('div', 'msheet-handle');
    handle.appendChild(el('div', 'msheet-grip'));
    card.appendChild(handle);

    function onTouchStart(e) {
      if (e.touches.length !== 1 || isClosing) return;
      var touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      currentY = startY;
      startTime = Date.now();
      isFromHandle = handle.contains(e.target);
      isDragging = false;
      didDrag = false;
    }

    function onTouchMove(e) {
      if (isClosing || !e.touches || e.touches.length !== 1) return;
      var touch = e.touches[0];
      var dy = touch.clientY - startY;
      var dx = touch.clientX - startX;

      if (!isDragging) {
        if (isFromHandle) {
          if (dy > 0) isDragging = true;
        } else {
          if (card.scrollTop <= 0 && dy > 6 && dy > Math.abs(dx)) {
            isDragging = true;
          }
        }
      }

      if (isDragging) {
        if (e.cancelable) e.preventDefault();
        didDrag = true;
        currentY = touch.clientY;
        var pullDist = Math.max(0, touch.clientY - startY);
        card.classList.add('is-dragging');
        card.style.transition = 'none';
        card.style.transform = 'translateY(' + pullDist + 'px)';

        var cardHeight = card.offsetHeight || 400;
        var progress = Math.min(1, pullDist / cardHeight);
        var alpha = 0.55 * (1 - progress * 0.85);
        sheet.style.backgroundColor = 'rgba(2, 6, 23, ' + Math.max(0, alpha).toFixed(3) + ')';
      }
    }

    function onTouchEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove('is-dragging');

      var endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : currentY;
      var totalDy = endY - startY;
      var dt = Date.now() - startTime;
      var velocity = totalDy / (dt || 1);

      if (totalDy > 75 || (totalDy > 25 && velocity > 0.35)) {
        closeWithSlide();
      } else {
        snapBack();
      }
    }

    card.addEventListener('touchstart', onTouchStart, { passive: true });
    card.addEventListener('touchmove', onTouchMove, { passive: false });
    card.addEventListener('touchend', onTouchEnd, { passive: true });
    card.addEventListener('touchcancel', onTouchEnd, { passive: true });

    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || isClosing) return;
      var mStartY = e.clientY;
      var mStartTime = Date.now();
      var mDidDrag = false;
      card.classList.add('is-dragging');

      function onMouseMove(me) {
        var dy = me.clientY - mStartY;
        if (dy > 3) {
          mDidDrag = true;
          didDrag = true;
          var pullDist = Math.max(0, dy);
          card.style.transition = 'none';
          card.style.transform = 'translateY(' + pullDist + 'px)';
          var cardHeight = card.offsetHeight || 400;
          var progress = Math.min(1, pullDist / cardHeight);
          var alpha = 0.55 * (1 - progress * 0.85);
          sheet.style.backgroundColor = 'rgba(2, 6, 23, ' + Math.max(0, alpha).toFixed(3) + ')';
        }
      }

      function onMouseUp(me) {
        card.classList.remove('is-dragging');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        var totalDy = me.clientY - mStartY;
        var dt = Date.now() - mStartTime;
        var velocity = totalDy / (dt || 1);

        if (mDidDrag) {
          if (totalDy > 75 || (totalDy > 25 && velocity > 0.35)) {
            closeWithSlide();
          } else {
            snapBack();
          }
        }
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    card.addEventListener('click', function (ev) {
      if (didDrag) {
        ev.stopPropagation();
        ev.preventDefault();
        didDrag = false;
      }
    }, true);

    MORE_GROUPS.forEach(function (g) {
      card.appendChild(el('div', 'msheet-h', g[0]));
      var grid = el('div', 'msheet-grid');
      g[1].forEach(function (t) {
        if (t[0] === '__settings' && !(window.KharchaNative && window.KharchaNative.openSettings)) return;   // only inside the phone app
        var b = el('button', 'mtile'); b.type = 'button';
        b.appendChild(el('span', 'e', t[1]));
        var tx = el('span', 'mt'); tx.appendChild(el('b', null, t[2])); if (t[3]) tx.appendChild(el('small', null, t[3]));
        b.appendChild(tx);
        b.addEventListener('click', function () {
          if (t[0] === '__settings') { closeSheet(true); window.KharchaNative.openSettings(); return; }
          if (t[0] === '__signout') { closeSheet(true); var so = $('signout'); if (so) so.click(); return; }
          goStream(t[0]);
        });
        grid.appendChild(b);
      });
      card.appendChild(grid);
    });
    card.appendChild(el('div', 'msheet-h', 'Look and feel'));
    var tp = el('div', 'theme-row');
    [['light', '☀️ Light'], ['dark', '🌙 Midnight'], ['thanos', '🟣 Thanos']].forEach(function (t) {
      var pb = el('button', 'scope-pill theme-pill', t[1]); pb.type = 'button'; pb.dataset.theme = t[0];
      pb.addEventListener('click', function () { setTheme(t[0]); }); tp.appendChild(pb);
    });
    card.appendChild(tp);
    var fxr = el('div', 'theme-row');
    [['s', 'Sound'], ['h', 'Vibration']].forEach(function (f) {
      var fb = el('button', 'scope-pill fx-pill'); fb.type = 'button'; fb.dataset.fx = f[0];
      function paintFx() { var on = fxOn(f[0]); fb.textContent = (f[0] === 's' ? '🔊 ' : '📳 ') + f[1] + ': ' + (on ? 'On' : 'Off'); fb.classList.toggle('active', on); }
      fb.addEventListener('click', function () { setFx(f[0], !fxOn(f[0])); paintFx(); if (fxOn(f[0])) feedback('save'); });
      paintFx(); fxr.appendChild(fb);
    });
    card.appendChild(fxr);
    paintThemeButton();
    var tl = el('button', 'linkbtn', '✨ Show the quick tour'); tl.type = 'button'; tl.addEventListener('click', function () { closeSheet(true); showTour(true); }); card.appendChild(tl);
    sheet.appendChild(card);
    backbar = el('div', 'backbar'); backbar.hidden = true;
    var bb = el('button', 'backbtn', '‹ Home'); bb.type = 'button'; bb.addEventListener('click', function () { goStream('spends'); });
    backbar.appendChild(bb); backbar.appendChild(el('span', 'backttl', ''));
    var mainEl = $('main'); if (mainEl && mainEl.parentNode) mainEl.parentNode.insertBefore(backbar, mainEl);
    sheet.addEventListener('click', function (ev) { if (ev.target === sheet && !isDragging && !didDrag) closeWithSlide(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeWithSlide(); });
    document.body.appendChild(sheet);
  }

  function syncNav() {
    if (!bnav) return;
    var main = $('main');
    bnav.hidden = !main || main.hidden;
    var act = document.querySelector('.streambtn.active');
    var stream = act ? act.dataset.stream : 'spends';
    var key = NAV_OF[stream] || 'more';
    // Tool screens and Trips have their own numbers: the month card would only be noise there.
    var heroEl = document.querySelector('.hero');
    var tool = ['trips', 'projects', 'investments', 'udhaar', 'wallet', 'bank', 'rules', 'monthly', 'insights', 'card', 'phone'].indexOf(stream) >= 0;
    if (heroEl) heroEl.hidden = tool;
    var stk = $('sticky-month-bar'); if (stk) stk.style.display = tool ? 'none' : '';
    if (backbar) {
      var other = key === 'more' && TITLES[stream];
      backbar.hidden = !other || bnav.hidden;
      if (other) backbar.querySelector('.backttl').textContent = TITLES[stream];
    }
    bnav.querySelectorAll('.bnav-btn[data-nav]').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === key); });
  }

  /* ---------- top card: sparkline + chips, fitted and counting total ---------- */
  var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  function paise(x) { return Math.round(Number(x) * 100); }
  function renderHeroExtras() {
    var block = document.querySelector('.hero-amount-block');
    if (!block || !K.getEntries || !K.isExpense) return;
    var box = $('hero-extras');
    if (!box) { box = el('div', 'hx'); box.id = 'hero-extras'; block.parentNode.insertBefore(box, block.nextSibling); }
    var list = K.getEntries().filter(function (e) { return !e.synthetic && K.isExpense(e); });
    var days = [], now = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ start: d.getTime(), end: d.getTime() + 86400000, p: 0, letter: DAY_LETTERS[d.getDay()] });
    }
    days.forEach(function (d) { d.items = []; });
    list.forEach(function (e) {
      for (var j = 0; j < 7; j++) if (e.ts >= days[j].start && e.ts < days[j].end) { days[j].p += paise(e.amount); days[j].items.push(e); break; }
    });
    var week = days.reduce(function (s, d) { return s + d.p; }, 0), today = days[6].p, max = Math.max.apply(null, days.map(function (d) { return d.p; })) || 1;
    var hotIdx = -1; days.forEach(function (d, i) { if (d.p > 0 && d.p === max && hotIdx < 0) hotIdx = i; });
    var weekItems = [].concat.apply([], days.map(function (d) { return d.items; }));
    var dayName = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    box.textContent = '';
    var chips = el('div', 'hx-chips');
    var chipDefs = [
      ['Today', today, function () { openPop('Today', days[6].items, 'Spent so far today'); }],
      ['7 days', week, function () { openPop('Last 7 days', weekItems, hotIdx >= 0 ? 'Biggest day: ' + dayName.format(new Date(days[hotIdx].start)) + ' \u00b7 ' + K.money(Math.round(max / 100)) : 'Nothing spent yet'); }],
      ['Avg / day', Math.round(week / 7), function () {
        var avg = Math.round(week / 7), diff = today - avg;
        openPop('Daily average', weekItems, 'About ' + K.money(Math.round(avg / 100)) + ' a day. Today is ' + (diff > 0 ? K.money(Math.round(diff / 100)) + ' above' : diff < 0 ? K.money(Math.round(-diff / 100)) + ' below' : 'right on') + ' your average.', Math.round(avg / 100));
      }]
    ];
    chipDefs.forEach(function (c) {
      var chip = el('button', 'hx-chip'); chip.type = 'button'; chip.appendChild(el('span', null, c[0])); chip.appendChild(el('b', null, K.money(Math.round(c[1] / 100))));
      chip.addEventListener('click', c[2]); chips.appendChild(chip);
    });
    box.appendChild(chips);
    var bars = el('div', 'hx-bars'); bars.setAttribute('aria-label', 'Spending over the last 7 days. Tap a day for details.');
    days.forEach(function (d, idx) {
      var col = el('button', 'hx-col' + (idx === 6 ? ' today' : '') + (idx === hotIdx ? ' hot' : ' cool') + (!d.p ? ' zero' : '')); col.type = 'button';
      col.setAttribute('aria-label', dayName.format(new Date(d.start)) + ', ' + K.money(d.p / 100));
      var bar = el('div', 'hx-bar');
      bar.style.height = Math.max(6, Math.round((d.p / max) * 100)) + '%';
      if (idx === hotIdx) col.appendChild(el('span', 'hx-flame', '\uD83D\uDD25'));
      col.appendChild(bar); col.appendChild(el('i', null, d.letter));
      col.addEventListener('click', function () { openPop(dayName.format(new Date(d.start)), d.items, d.p ? (idx === hotIdx ? 'Your biggest spending day this week' : 'Spent this day') : 'Nothing spent this day'); });
      bars.appendChild(col);
    });
    box.appendChild(bars);
    var bank = K.getTopBank ? K.getTopBank() : null;
    if (bank) {
      var chip = el('button', 'hx-bank'); chip.type = 'button';
      chip.appendChild(el('span', null, '\uD83C\uDFE6 ' + bank.name + ' balance'));
      chip.appendChild(el('b', null, K.money(bank.balance)));
      chip.addEventListener('click', function () { goStream('bank'); });
      box.appendChild(chip);
    }
  }


  /* ---------- tap a bar or box on the top card: how much, and on what ---------- */
  function openPop(title, items, note, avgFor) {
    var old = document.querySelector('.hx-pop-bd'); if (old) old.remove();
    var total = items.reduce(function (n, e) { return n + paise(e.amount); }, 0) / 100;
    var bd = el('div', 'hx-pop-bd'), pop = el('div', 'hx-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', title);
    var head = el('div', 'hx-pop-head'); head.appendChild(el('b', null, title));
    var x = el('button', 'hx-pop-x', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); head.appendChild(x); pop.appendChild(head);
    pop.appendChild(el('div', 'hx-pop-amt', K.money(avgFor != null ? avgFor : Math.round(total * 100) / 100)));
    if (note) pop.appendChild(el('p', 'hx-pop-note', note));
    if (items.length && K.categoryBreakdown) {
      var cats = K.categoryBreakdown(items).categories.slice(0, 5);
      pop.appendChild(el('div', 'hx-pop-k', 'WHAT IT WENT ON'));
      cats.forEach(function (c) {
        var row = el('div', 'hx-cat'), top = el('div', 'hx-cat-top');
        top.appendChild(el('span', null, c.name)); top.appendChild(el('b', null, K.money(Math.round(c.total))));
        var tr = el('div', 'hx-cat-track'), f = el('div', 'hx-cat-fill'); f.style.width = Math.max(4, c.pct) + '%'; tr.appendChild(f);
        row.appendChild(top); row.appendChild(tr); pop.appendChild(row);
      });
      var big = items.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3);
      pop.appendChild(el('div', 'hx-pop-k', 'BIGGEST PAYMENTS'));
      big.forEach(function (e) {
        var r = el('div', 'hx-big'); r.appendChild(el('span', null, String(e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 30)));
        r.appendChild(el('b', null, K.money(e.amount))); pop.appendChild(r);
      });
    } else pop.appendChild(el('p', 'hx-pop-note', 'Nothing to show.'));
    bd.appendChild(pop); document.body.appendChild(bd);
    function close() { bd.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    x.addEventListener('click', close); bd.addEventListener('click', function (ev) { if (ev.target === bd) close(); });
    document.addEventListener('keydown', onKey);
  }

  var lastTotal = null, animToken = 0;
  function fitTotal() {
    var t = $('mtotal'); if (!t) return;
    t.style.fontSize = '';
    var size = parseFloat(getComputedStyle(t).fontSize) || 40;
    while (t.scrollWidth > t.clientWidth + 1 && size > 18) { size -= 1; t.style.fontSize = size + 'px'; }
  }
  function countUpTotal() {
    var t = $('mtotal'); if (!t) return;
    var target = parseFloat(String(t.textContent).replace(/[^0-9.]/g, ''));
    if (!isFinite(target)) { fitTotal(); return; }
    var from = lastTotal; lastTotal = target;
    var token = ++animToken;
    if (reduceMotion || from == null || from === target || !K.money) { fitTotal(); return; }
    var start = null, dur = 450;
    t.textContent = K.money(from);
    (function step(ts) {
      if (token !== animToken) return;
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / dur), eased = 1 - Math.pow(1 - p, 3);
      t.textContent = K.money(Math.round((from + (target - from) * eased) * 100) / 100);
      fitTotal();
      if (p < 1) raf(step); else { t.textContent = K.money(target); fitTotal(); }
    })(performance.now());
    fitTotal();
  }

  /* ---------- rows: icon avatar ---------- */
  var EMOJI_LEAD = /^(?:[←-⯿️‍]|[\uD83C-\uD83E][\uDC00-\uDFFF])+/;
  function decorateRows() {
    document.querySelectorAll('button.row').forEach(function (row) {
      if (row.querySelector(':scope > .av')) return;
      var d = row.querySelector('.d'); if (!d) return;
      var av = el('span', 'av'); av.setAttribute('aria-hidden', 'true');
      var first = d.firstChild, txt = first && first.nodeType === 3 ? first.nodeValue : d.textContent;
      var m = String(txt || '').trim().match(EMOJI_LEAD);
      if (m) {
        av.textContent = m[0].replace(/️/g, '');
        if (first && first.nodeType === 3) first.nodeValue = first.nodeValue.replace(/^\s*(?:[←-⯿️‍]|[\uD83C-\uD83E][\uDC00-\uDFFF])+\s*/, '');
      } else {
        var letter = (String(txt || '').match(/[A-Za-zऀ-ॿ0-9]/) || ['•'])[0].toUpperCase(), h = 0, s = String(txt || '');
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        av.textContent = letter;
        av.style.background = 'hsl(' + h + ' 70% 92%)'; av.style.color = 'hsl(' + h + ' 55% 32%)';
      }
      row.insertBefore(av, row.firstChild);
    });
  }

  /* ---------- smart suggestions for "what was it for" ---------- */
  var SCOPE_LEAD = /^(?:[\u{1F3E0}\u{1F464}\u{1F528}\u{1F4C8}\u{1F4BC}\u{1F475}\u{1F4B0}\u{1F45B}➕✈️\s])+/u;
  var pool = null;
  function cleanLabel(desc) {
    var d = String(desc || '');
    var trip = d.indexOf('✈') >= 0;
    d = d.replace(/\[[^\]]*\]/g, ' ').replace(SCOPE_LEAD, '').replace(/\s+/g, ' ').trim();
    if (trip) d = d.replace(/^[^:·]{1,30}:\s+/, '');
    return d.replace(/^trip\s*:\s*/i, '').trim();
  }
  function buildPool() {
    var map = {};
    (K.getEntries ? K.getEntries() : []).forEach(function (e) {
      if (e.synthetic || !e.desc || (K.isExpense && !K.isExpense(e))) return;
      if (String(e.desc).indexOf('👛') === 0) return;                  // wallet rows
      var label = cleanLabel(e.desc);
      if (label.length < 2 || label.length > 40 || /^(unaccounted|cash withdrawn)/i.test(label)) return;
      var k = label.toLowerCase(), o = map[k];
      if (!o) o = map[k] = { label: label, n: 0, ts: 0, amount: 0 };
      o.n++;
      if (e.ts >= o.ts) { o.ts = e.ts; o.amount = e.amount; o.label = label; }
    });
    pool = Object.keys(map).map(function (k) { return map[k]; });
  }
  function suggest(q) {
    if (!pool) buildPool();
    var s = q.trim().toLowerCase();
    if (!s) return [];
    var out = [];
    pool.forEach(function (o) {
      var l = o.label.toLowerCase(), idx = l.indexOf(s);
      if (idx < 0 || l === s) return;
      var rank = idx === 0 ? 0 : (l.charAt(idx - 1) === ' ' ? 1 : 2);
      out.push({ o: o, rank: rank });
    });
    out.sort(function (a, b) { return a.rank - b.rank || b.o.n - a.o.n || b.o.ts - a.o.ts; });
    return out.slice(0, 5).map(function (x) { return x.o; });
  }
  function highlight(label, q) {
    var frag = document.createDocumentFragment(), i = label.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0) { frag.appendChild(document.createTextNode(label)); return frag; }
    frag.appendChild(document.createTextNode(label.slice(0, i)));
    frag.appendChild(el('mark', null, label.slice(i, i + q.trim().length)));
    frag.appendChild(document.createTextNode(label.slice(i + q.trim().length)));
    return frag;
  }
  function attachSuggest(input, amountInput) {
    if (!input || input.dataset.sugg) return;
    input.dataset.sugg = '1';
    input.removeAttribute('list');                     // the browser's own list is replaced by this one
    input.setAttribute('autocomplete', 'off');
    var ul = el('ul', 'sugg'); ul.hidden = true; ul.setAttribute('role', 'listbox');
    input.parentNode.appendChild(ul);
    var items = [], active = -1;
    function hide() { ul.hidden = true; active = -1; }
    function paint() { Array.prototype.forEach.call(ul.children, function (li, i) { li.setAttribute('aria-selected', i === active ? 'true' : 'false'); }); }
    function show() {
      items = suggest(input.value); ul.textContent = '';
      if (!items.length) { hide(); return; }
      items.forEach(function (o, i) {
        var li = el('li'); li.setAttribute('role', 'option');
        var t = el('span', 's-t'); t.appendChild(highlight(o.label, input.value)); li.appendChild(t);
        if (o.amount) li.appendChild(el('span', 's-a', K.money(o.amount)));
        li.addEventListener('pointerdown', function (ev) { ev.preventDefault(); pick(i); });
        ul.appendChild(li);
      });
      active = -1; ul.hidden = false;
    }
    function pick(i) {
      var o = items[i]; if (!o) return;
      input.value = o.label; input.dispatchEvent(new Event('input', { bubbles: true }));
      var amt = amountInput && amountInput.value.trim() === '' && o.amount ? amountInput : null;
      if (amt) { amt.value = String(o.amount); amt.dispatchEvent(new Event('input', { bubbles: true })); }
      hide();
      var next = amt || null;
      if (next) { try { next.focus(); next.select(); } catch (e) {} }
    }
    input.addEventListener('input', show);
    input.addEventListener('focus', function () { if (input.value.trim()) show(); });
    input.addEventListener('blur', function () { setTimeout(hide, 120); });
    input.addEventListener('keydown', function (ev) {
      if (ul.hidden) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % items.length; paint(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
      else if (ev.key === 'Enter' && active >= 0) { ev.preventDefault(); pick(active); }
      else if (ev.key === 'Escape') hide();
    });
  }

  /* ---------- add form: date and payment method tucked behind one tap ---------- */
  function tuckExtras() {
    var extra = document.querySelector('#add .add-row-extra');
    if (!extra || extra.dataset.tucked) return;
    extra.dataset.tucked = '1';
    var btn = el('button', 'linkbtn extras-toggle', '+ Date, time and payment method'); btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    extra.hidden = true;
    btn.addEventListener('click', function () {
      var open = extra.hidden; extra.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '− Hide date, time and payment method' : '+ Date, time and payment method';
    });
    extra.parentNode.insertBefore(btn, extra);
  }

  /* ---------- the winged rupee: flaps, lifts off through the top, comes back ---------- */
  function accentColor() {
    var v = ''; try { v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); } catch (e) {}
    return v || '#0284C7';
  }
  // Draws the rupee tile with a pair of feathered wings. All numbers are in "logo units" (the tile is 36 wide).
  // st: dy (up is negative), scale, alpha, phase (flap clock, radians), amp (flap degrees), open (1 spread, 0 folded)
  function drawWinged(ctx, img, W, H, unit, st, feathers) {
    var T = 36, col = accentColor();
    ctx.clearRect(0, 0, W * unit, H * unit);
    ctx.save();
    ctx.scale(unit, unit);
    // falling feathers (not tied to the body)
    (feathers || []).forEach(function (f) {
      ctx.save(); ctx.globalAlpha = Math.max(0, f.a); ctx.translate(f.x, f.y); ctx.rotate(f.r);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -4); ctx.quadraticCurveTo(2.2, 0, 0, 5); ctx.quadraticCurveTo(-2.2, 0, 0, -4); ctx.fill(); ctx.restore();
    });
    ctx.globalAlpha = Math.max(0, Math.min(1, st.alpha));
    ctx.translate(W / 2, H / 2 + st.dy);
    ctx.scale(st.scale, st.scale);
    var flap = Math.sin(st.phase) * st.amp, ANG = [-58, -38, -18, 2], LEN = [15, 19, 21, 17];
    [1, -1].forEach(function (side) {
      ctx.save(); ctx.translate(side * (T / 2 - 3), -1); ctx.scale(side, 1);
      for (var i = ANG.length - 1; i >= 0; i--) {
        var open = Math.max(0, st.open), ang = (ANG[i] * (0.25 + 0.75 * open) + 20 * (1 - open) + flap * (0.6 + i * 0.15)) * Math.PI / 180, len = LEN[i] * (0.55 + 0.45 * open);
        ctx.save(); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.45, -3.4, len, -0.4); ctx.quadraticCurveTo(len * 0.5, 3.2, 0, 0); ctx.closePath();
        ctx.fillStyle = col; ctx.globalAlpha = Math.max(0, Math.min(1, st.alpha)) * (0.62 + 0.1 * i); ctx.fill();
        ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    });
    ctx.globalAlpha = Math.max(0, Math.min(1, st.alpha));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-T / 2, -T / 2, T, T, 11); else ctx.rect(-T / 2, -T / 2, T, T);
    ctx.save(); ctx.clip(); ctx.drawImage(img, -T / 2, -T / 2, T, T); ctx.restore();
    ctx.restore();
  }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function easeOut(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - Math.pow(1 - t, 3); }
  // One run of the flight as a function of time: perch, take off through the top, gone, drop back in, settle.
  var FLIGHT = { perch: 1800, up: 1100, gone: 700, down: 1000 };
  function flightState(t, rise) {
    var P = FLIGHT.perch, U = P + FLIGHT.up, G = U + FLIGHT.gone, D = G + FLIGHT.down, st = { dy: 0, scale: 1, alpha: 1, phase: t / 95, amp: 11, open: 1 };
    if (t < P) { st.phase = t / 110; st.amp = 9; }
    else if (t < U) { var k = (t - P) / FLIGHT.up; st.phase = P / 110 + (t - P) / 55; st.amp = 20; st.dy = -rise * ease(k) * ease(k); st.scale = 1 - 0.5 * ease(k); st.alpha = 1 - ease((k - 0.45) / 0.55); }
    else if (t < G) { st.alpha = 0; }
    else if (t < D) { var m = (t - G) / FLIGHT.down; st.phase = (t - G) / 60; st.amp = 22 * (1 - m) + 6 * m; st.dy = -rise * (1 - easeOut(m)); st.scale = 0.6 + 0.4 * easeOut(m); st.alpha = ease(m / 0.45); st.open = 0.55 + 0.45 * ease(m); }
    return st;
  }
  function makeFeathers(t) {                       // feathers shed during take-off
    var P = FLIGHT.perch, out = [];
    for (var i = 0; i < 7; i++) {
      var born = P + 80 + i * 110, age = (t - born) / 1000;
      if (age < 0 || age > 1.5) continue;
      out.push({ x: 10 + (i % 2 ? 24 : 0) + Math.sin(i * 2.1) * 6 + Math.sin(age * 4 + i) * 5, y: 12 + age * (18 + i * 2) - age * 4, r: age * (1.5 + i * 0.4) + i, a: 0.85 * (1 - age / 1.5) });
    }
    return out;
  }

  /* ---------- header logo ---------- */
  function snapLogo() {
    var img = document.querySelector('.top .logo');
    if (!img || reduceMotion || !img.parentNode) return;
    var W = 64, H = 100, DPR = Math.min(3, window.devicePixelRatio || 2), cv = el('canvas', 'logo snap-logo');
    cv.width = W * DPR; cv.height = H * DPR; cv.setAttribute('aria-hidden', 'true'); cv.title = 'Tap';
    var ctx, running = false, t0 = 0, skip = 0, raf0 = 0;
    function frame(now) {
      if (!t0) t0 = now;
      var t = now - t0 + skip, total = FLIGHT.perch + FLIGHT.up + FLIGHT.gone + FLIGHT.down;
      if (document.hidden) { t0 = 0; running = false; setTimeout(go, 1500); return; }
      if (t >= total) { drawWinged(ctx, img, W, H, DPR, { dy: 0, scale: 1, alpha: 1, phase: 0, amp: 0, open: 1 }, []); running = false; skip = 0; setTimeout(go, 600); return; }
      drawWinged(ctx, img, W, H, DPR, flightState(t, 56), makeFeathers(t));
      raf0 = raf(frame);
    }
    function go() { if (running) return; running = true; t0 = 0; raf0 = raf(frame); }
    function init() {
      ctx = cv.getContext('2d'); if (!ctx) return;
      drawWinged(ctx, img, W, H, DPR, { dy: 0, scale: 1, alpha: 1, phase: 0, amp: 0, open: 1 }, []);
      img.style.display = 'none';
      img.parentNode.insertBefore(cv, img);
      cv.addEventListener('click', function () { if (!running) { skip = FLIGHT.perch - 500; go(); } });
      setTimeout(go, 900);
    }
    if (img.complete && img.naturalWidth) init(); else img.addEventListener('load', init);
  }

  /* ---------- opening splash: the winged rupee drops in from the top and lands ---------- */
  function runSplash() {
    var sp = $('splash');
    if (!sp) return;
    function leave() { sp.classList.add('out'); setTimeout(function () { if (sp.parentNode) sp.remove(); }, 500); try { sessionStorage.setItem('kharcha_splash', '1'); } catch (e) {} }
    var cv = $('splash-cv');
    sp.addEventListener('click', leave);                              // tap to skip
    if (reduceMotion || !cv) { leave(); return; }
    var img = new Image();
    img.onload = function () {
      var W = 64, H = 100, unit = cv.width / W, ctx = cv.getContext('2d'), t0 = 0, G = FLIGHT.perch + FLIGHT.up + FLIGHT.gone;
      function frame(now) {
        if (!t0) t0 = now;
        var t = now - t0, tt = G + Math.min(t, FLIGHT.down + 600);
        drawWinged(ctx, img, W, H, unit, tt >= G + FLIGHT.down ? { dy: 0, scale: 1, alpha: 1, phase: (t) / 140, amp: 5 * Math.max(0, 1 - (t - FLIGHT.down) / 600), open: 1 } : flightState(tt, 60), []);
        if (t < FLIGHT.down + 700) raf(frame); else setTimeout(leave, 350);
      }
      raf(frame);
    };
    img.onerror = leave;
    img.src = 'logo-mark.png?v=80';
    setTimeout(leave, 4200);                                        // never keeps you waiting
  }

  /* ---------- feel: sound, vibration, money flying to the total ---------- */
  var fxState = null;
  function fxOn(k) {
    if (!fxState) { try { fxState = JSON.parse(localStorage.getItem('kharcha_fx') || '{}') || {}; } catch (e) { fxState = {}; } }
    return fxState[k] !== 0;
  }
  function setFx(k, on) { fxOn(k); fxState[k] = on ? 1 : 0; try { localStorage.setItem('kharcha_fx', JSON.stringify(fxState)); } catch (e) {} }
  var audio = null;
  function tone(freq, start, dur, vol) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
      var o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + start;
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  function feedback(kind) {
    if (fxOn('h') && navigator.vibrate) { try { navigator.vibrate(kind === 'delete' ? [10, 30, 10] : kind === 'income' ? [14, 40, 14] : 12); } catch (e) {} }
    if (!fxOn('s')) return;
    if (kind === 'income') { tone(784, 0, 0.14); tone(988, 0.1, 0.14); tone(1319, 0.2, 0.22); }
    else if (kind === 'delete') { tone(392, 0, 0.12); tone(262, 0.09, 0.18); }
    else { tone(660, 0, 0.09); tone(880, 0.07, 0.13); }
  }
  function flyChip(text, income) {
    if (reduceMotion) return;
    var tot = $('mtotal'), chip = el('div', 'coin ' + (income ? 'in' : 'out'), text);
    document.body.appendChild(chip);
    var from = { x: window.innerWidth / 2, y: window.innerHeight - 110 }, to = { x: window.innerWidth / 2, y: 120 };
    if (tot) { var r = tot.getBoundingClientRect(); if (r.height) { to = { x: r.left + Math.min(r.width, 160) / 2, y: r.top + r.height / 2 }; } }
    var dx = to.x - from.x, dy = to.y - from.y;
    chip.style.left = from.x + 'px'; chip.style.top = from.y + 'px';
    if (!chip.animate) { setTimeout(function () { chip.remove(); }, 900); return; }
    var an = chip.animate([
      { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.18 },
      { transform: 'translate(calc(-50% + ' + dx * 0.5 + 'px), calc(-50% + ' + dy * 0.45 + 'px)) scale(1)', opacity: 1, offset: 0.55 },
      { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.55)', opacity: 0 }
    ], { duration: 1000, easing: 'cubic-bezier(.3,.7,.3,1)' });
    an.onfinish = function () { chip.remove(); };
    if (income) {                                                       // a small burst of coins
      for (var i = 0; i < 14; i++) {
        var d = el('i', 'spark'); d.style.left = from.x + 'px'; d.style.top = from.y + 'px'; document.body.appendChild(d);
        var ang = (i / 14) * 6.283 + Math.random() * 0.4, dist = 50 + Math.random() * 60;
        if (d.animate) {
          var a2 = d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + Math.cos(ang) * dist + 'px), calc(-50% + ' + (Math.sin(ang) * dist - 20) + 'px)) scale(0.2)', opacity: 0 }], { duration: 700 + Math.random() * 300, easing: 'ease-out' });
          a2.onfinish = (function (n) { return function () { n.remove(); }; })(d);
        } else d.remove();
      }
    }
  }
  var seenIds = null;
  function watchNewEntries() {
    var list = K.getEntries ? K.getEntries() : [];
    if (!seenIds) { seenIds = {}; list.forEach(function (e) { seenIds[e.id] = 1; }); return; }
    var fresh = list.filter(function (e) { return e && !e.synthetic && !seenIds[e.id]; });
    list.forEach(function (e) { seenIds[e.id] = 1; });
    var mine = fresh.filter(function (e) { return e.ts > Date.now() - 180000 && String(e.desc || '').indexOf('🔁') !== 0; }).slice(0, 2);
    mine.forEach(function (e, i) {
      var inc = K.isIncome && K.isIncome(e);
      setTimeout(function () { flyChip((inc ? '+ ' : '− ') + K.money(e.amount), inc); feedback(inc ? 'income' : 'save'); }, i * 350);
    });
  }
  (function watchToast() {
    var t = $('toast'); if (!t || !window.MutationObserver) return;
    new MutationObserver(function () { if (!t.hidden && /^Deleted/.test(t.textContent || '')) feedback('delete'); }).observe(t, { childList: true, characterData: true, subtree: true });
  })();

  /* ---------- friendlier empty screens ---------- */
  function decorateEmpty() {
    document.querySelectorAll('.empty').forEach(function (e) {
      if (e.querySelector('.empty-ill') || e.closest('[hidden]')) return;
      var t = (e.textContent || '').toLowerCase(), ic = '📭', cta = false;
      if (t.indexOf('nothing logged') >= 0 || t.indexOf('no expenses') >= 0) { ic = '🧾'; cta = true; }
      else if (t.indexOf('udhaar') >= 0 || t.indexOf('lent') >= 0) ic = '🤝';
      else if (t.indexOf('bank') >= 0) ic = '🏦';
      else if (t.indexOf('wallet') >= 0) ic = '👛';
      else if (t.indexOf('trip') >= 0) ic = '✈️';
      else if (t.indexOf('invest') >= 0) ic = '📈';
      var ill = el('div', 'empty-ill', ic); e.insertBefore(ill, e.firstChild);
      if (cta) {
        var b = el('button', 'primary small', '+ Add a spend'); b.type = 'button';
        b.addEventListener('click', function () { var a = $('amt'); if (a) { a.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { a.focus(); }, 300); } });
        e.appendChild(b);
      }
    });
  }

  /* ---------- home: "How am I doing?" card, pace colour on the total card ---------- */
  function paceKind(f) {
    if (f.ratio == null) return '';
    return f.ratio <= 0.95 ? 'good' : f.ratio <= 1.15 ? 'warn' : 'bad';
  }
  function renderAnswerCard() {
    var hero = document.querySelector('.hero'), sw = $('stream-switcher');
    if (!hero || !sw || !K.getHomeFacts) return;
    var f = K.getHomeFacts(), kind = paceKind(f);
    if (kind) hero.setAttribute('data-pace', kind); else hero.removeAttribute('data-pace');
    var card = $('ans-card');
    if (!card) { card = el('section', 'ans-card'); card.id = 'ans-card'; sw.parentNode.insertBefore(card, sw); }
    var act = document.querySelector('.streambtn.active'), onHome = !act || act.dataset.stream === 'spends';
    card.hidden = !(f.viewingCurrent && onHome);
    if (card.hidden) return;
    card.setAttribute('data-pace', kind || 'none');
    card.textContent = '';
    var money = K.money;
    if (f.mode === 'none') {
      card.appendChild(el('div', 'ans-k', 'SAFE TO SPEND'));
      card.appendChild(el('div', 'ans-sub', 'Track your bank (More > Bank) or set a monthly budget and this card tells you what you can spend each day.'));
      return;
    }
    if (f.mode === 'bank' && f.payDays === 0) {
      card.appendChild(el('div', 'ans-k', 'PAYDAY'));
      card.appendChild(el('div', 'ans-big', 'Payday is today'));
      card.appendChild(el('div', 'ans-sub', 'Log your salary and the new cycle starts.'));
      return;
    }
    card.appendChild(el('div', 'ans-k', f.mode === 'bank' ? 'SAFE TO SPEND TODAY' : 'LEFT IN YOUR BUDGET'));
    var big = el('div', 'ans-big'); big.appendChild(document.createTextNode(money(Math.round(f.safe)))); big.appendChild(el('span', 'ans-per', ' a day'));
    card.appendChild(big);
    if (f.mode === 'bank') {
      card.appendChild(el('div', 'ans-sub', 'until payday in ' + f.payDays + ' day' + (f.payDays === 1 ? '' : 's') + '. Bank ' + money(Math.round(f.bankTotal)) + (f.upSum ? ', ' + money(Math.round(f.upSum)) + ' of bills still to come' : '') + '.'));
    } else {
      card.appendChild(el('div', 'ans-sub', money(Math.max(0, Math.round(f.left))) + ' left of ' + money(f.budget) + ' for ' + f.days + ' more day' + (f.days === 1 ? '' : 's') + '.'));
    }
    var diff = Math.round((f.mode === 'bank' ? f.avg7 - f.safe : 0));
    var msg = kind === 'good' ? '✅ On track. You have spent about ' + money(Math.round(f.avg7)) + ' a day this week.'
      : kind === 'warn' ? '⚠️ Close to the limit' + (f.mode === 'bank' ? ': about ' + money(Math.round(f.avg7)) + ' a day this week.' : '. A little ahead of the month.')
      : '🔴 Over pace' + (f.mode === 'bank' && diff > 0 ? ' by about ' + money(diff) + ' a day.' : ': spending is ahead of the month.');
    card.appendChild(el('div', 'ans-pace ' + kind, msg));
  }

  /* ---------- hide amounts (eye) ---------- */
  var EYE = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  var EYE_OFF = svg('<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4"/><path d="M6.5 6.8C3.7 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.1-.9"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/>');
  (function initPrivacy() {
    var top = document.querySelector('.hero-amount-block');
    if (!top) return;
    var b = el('button', 'eye-btn'); b.type = 'button'; b.id = 'eye-btn';
    function paint() {
      var on = document.body.classList.contains('privacy');
      b.innerHTML = on ? EYE_OFF : EYE; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Show amounts' : 'Hide amounts'); b.title = on ? 'Show amounts' : 'Hide amounts';
    }
    try { if (localStorage.getItem('kharcha_privacy') === '1') document.body.classList.add('privacy'); } catch (e) {}
    b.addEventListener('click', function () {
      document.body.classList.toggle('privacy');
      try { localStorage.setItem('kharcha_privacy', document.body.classList.contains('privacy') ? '1' : '0'); } catch (e) {}
      paint();
    });
    top.appendChild(b); paint();
  })();

  /* ---------- search everywhere (all months): text, amount, ">500", "<100" ---------- */
  function amountTest(q) {
    var m = /^\s*([<>]=?)\s*([\d,]+(?:\.\d+)?)\s*$/.exec(q);
    if (m) { var n = Number(m[2].replace(/,/g, '')); return m[1][0] === '>' ? function (a) { return a >= n; } : function (a) { return a <= n; }; }
    if (/^[\d,]+(?:\.\d+)?$/.test(q.trim())) { var v = Number(q.replace(/,/g, '')); return function (a) { return Math.abs(a - v) < 0.005 || String(a).indexOf(q.trim()) === 0; }; }
    return null;
  }
  var dFmtS = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  function renderSearchAll() {
    var inp = $('search'); if (!inp) return;
    var box = $('search-all');
    if (!box) { box = el('div', 'search-all'); box.id = 'search-all'; var bar = inp.closest('.actions-bar'); bar.parentNode.insertBefore(box, bar.nextSibling); }
    var q = inp.value.trim().toLowerCase();
    box.textContent = '';
    if (q.length < 2 && !/^[<>]/.test(q)) { box.hidden = true; return; }
    var KLs = window.KharchaLedger, smart = !amountTest(q) && KLs && KLs.smartSearch ? KLs.smartSearch(q) : null;
    var test = amountTest(q), rows = (K.getEntries ? K.getEntries() : []).filter(function (e) {
      if (!e || e.synthetic) return false;
      if (test) return test(e.amount);
      return smart ? smart.test(e.desc) : String(e.desc || '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return b.ts - a.ts; });
    box.hidden = false;
    var ask = !test && KLs && KLs.askQuery ? KLs.askQuery(K.getEntries ? K.getEntries() : [], q, Date.now(), function (e) { return K.isExpense(e); }) : null;
    if (ask) { var ab = el('div', 'sa-head', '\uD83D\uDCAC ' + ask.text); ab.style.fontWeight = '700'; box.appendChild(ab); }
    var total = rows.reduce(function (n, e) { return n + (K.isExpense(e) ? e.amount : 0); }, 0);
    if (!(ask && !rows.length)) box.appendChild(el('div', 'sa-head', rows.length ? rows.length + ' found in all months' + (total ? ' · spent ' + K.money(Math.round(total * 100) / 100) : '') : 'Nothing found in any month.'));
    rows.slice(0, 30).forEach(function (e) {
      var r = el('div', 'sa-row'), isIn = K.isIncome && K.isIncome(e);
      r.appendChild(el('span', 'sa-d', dFmtS.format(new Date(e.ts))));
      r.appendChild(el('span', 'sa-t', String(e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 34)));
      r.appendChild(el('span', 'sa-a' + (isIn ? ' in' : ''), (isIn ? '+ ' : '') + K.money(e.amount)));
      box.appendChild(r);
    });
    if (smart && smart.concepts.length && rows.length) box.insertBefore(el('div', 'sa-more', 'Also matching related words for: ' + smart.concepts.join(', ')), box.children[1] || null);
    if (rows.length > 30) box.appendChild(el('div', 'sa-more', '…and ' + (rows.length - 30) + ' more. Narrow the search.'));
  }
  (function initSearchAll() {
    var inp = $('search'); if (!inp) return;
    var t = 0; inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(renderSearchAll, 160); });
    inp.placeholder = 'Search: salon, petrol, swiggy, 906, >1000';
  })();

  /* ---------- first-run tour ---------- */
  var TOUR = [
    ['➕', 'Add a spend in seconds', 'Type the amount and what it was for. Tap a suggestion to fill it. Every change can be undone for a few seconds.'],
    ['🏦', 'Bank, cards and transfers', 'More > Bank tracks each account. Money you move between your own accounts is never counted as spending.'],
    ['⚙️', 'Let it do the boring parts', 'More > Auto rules knows your milk vendor, EMI and monthly payments, and reminds you when they are due.']
  ];
  function showTour(force) {
    var done = false; try { done = localStorage.getItem('kharcha_tour_done') === '1'; } catch (e) {}
    if (done && !force) return;
    if ($('tour')) return;
    var i = 0, back = el('div', 'tour'); back.id = 'tour'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-label', 'Quick tour');
    var card = el('div', 'tour-card'); back.appendChild(card);
    function finish() { try { localStorage.setItem('kharcha_tour_done', '1'); } catch (e) {} back.remove(); }
    function paint() {
      card.textContent = '';
      var t = TOUR[i];
      card.appendChild(el('div', 'tour-e', t[0])); card.appendChild(el('h3', null, t[1])); card.appendChild(el('p', null, t[2]));
      var dots = el('div', 'tour-dots'); TOUR.forEach(function (_, k) { dots.appendChild(el('i', k === i ? 'on' : '')); }); card.appendChild(dots);
      var row = el('div', 'tour-btns'), skip = el('button', 'ghost', 'Skip'); skip.type = 'button'; skip.addEventListener('click', finish);
      var go = el('button', 'primary', i === TOUR.length - 1 ? 'Got it' : 'Next'); go.type = 'button';
      go.addEventListener('click', function () { if (i === TOUR.length - 1) finish(); else { i++; paint(); } });
      row.appendChild(skip); row.appendChild(go); card.appendChild(row);
    }
    paint(); document.body.appendChild(back);
  }

  /* ---------- wiring ---------- */
  var scheduled = false;
  function refresh() {
    scheduled = false;
    syncNav(); decorateRows(); decorateEmpty(); renderAnswerCard();
  }
  function schedule() { if (!scheduled) { scheduled = true; raf(refresh); } }

  buildNav();
  runSplash();
  snapLogo();
  tuckExtras();
  attachSuggest($('desc'), $('amt'));
  attachSuggest($('trip-exp-desc'), $('trip-exp-amt'));
  document.addEventListener('kharcha:render', function () {
    pool = null; countUpTotal(); renderHeroExtras(); decorateRows(); syncNav(); renderAnswerCard(); watchNewEntries(); decorateEmpty();
    var m0 = $('main'); if (m0 && !m0.hidden) setTimeout(function () { showTour(false); }, 900);
  });
  var main = $('main');
  if (window.MutationObserver) {
    var mo = new MutationObserver(schedule);
    if (main) mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    var sw = $('stream-switcher'); if (sw) mo.observe(sw, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  /* ---------- calm home (v110): only what matters on the dashboard; everything else one tap away ---------- */
  (function calmHome() {
    var form = $('add'); if (!form) return;
    document.body.classList.add('calm');
    // 1. The add form folds into one bar; the + button and the bar open it, it folds again after saving.
    var bar = el('button', 'quick-add-bar'); bar.type = 'button';
    bar.innerHTML = '<span>\uFF0B</span> Add a spend <em>amount and what it was for</em>';
    form.parentNode.insertBefore(bar, form);
    function setOpen(on) {
      form.classList.toggle('open', on); bar.hidden = on;
      if (on) { var amt = $('amt'); if (amt) setTimeout(function () { try { amt.focus(); } catch (e) {} }, 60); }
    }
    bar.addEventListener('click', function () { setOpen(true); });
    form.addEventListener('submit', function () { setTimeout(function () { setOpen(false); }, 700); });
    var cancel = el('button', 'ghost quick-add-close', 'Close'); cancel.type = 'button'; cancel.addEventListener('click', function () { setOpen(false); });
    form.insertBefore(cancel, form.firstChild);
    var fab = document.querySelector('.bnav-add');
    if (fab) fab.addEventListener('click', function () { setOpen(true); });
    // 2. Several payments due: one summary line that opens the list.
    var due = $('due-box');
    if (due) {
      var busy = false, openDue = false;
      var tidy = function () {
        if (busy) return; busy = true;
        var cards = due.querySelectorAll('.due-card');
        var old = due.querySelector('.due-sum'); if (old) old.remove();
        due.classList.toggle('due-fold', cards.length > 1 && !openDue);
        if (cards.length > 1) {
          var s = el('button', 'due-sum'); s.type = 'button';
          s.textContent = '\uD83D\uDCC5 ' + cards.length + ' payments due this month ' + (openDue ? '\u25B4' : '\u25BE');
          s.addEventListener('click', function () { openDue = !openDue; tidy(); });
          due.insertBefore(s, due.firstChild);
        }
        busy = false;
      };
      new MutationObserver(function () { if (!busy) setTimeout(tidy, 0); }).observe(due, { childList: true });
      tidy();
    }
    // 3. Past months fold away (the arrows at the top already move between months).
    var ms = $('months-sec');
    if (ms) { var t = ms.querySelector('.sec-title'); if (t) { t.classList.add('fold-title'); t.addEventListener('click', function () { ms.classList.toggle('open'); }); } }
    // 4. No budget set: hide the budget strip (Set one from Insights & Stats).
    var bs = $('budget-status'), bw = $('budget-wrap');
    if (bs && bw) {
      var upd = function () { bw.classList.toggle('calm-hide', /not set/i.test(bs.textContent || '')); };
      new MutationObserver(upd).observe(bs, { childList: true, characterData: true, subtree: true }); upd();
    }
  })();
  window.addEventListener('resize', fitTotal);
  refresh();
})();
