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
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintThemeButton() {
    var b = $('theme-btn'); if (!b) return;
    var dark = effectiveTheme() === 'dark';
    b.innerHTML = dark ? SUN : MOON;                 // shows what a tap switches to
    b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    b.title = dark ? 'Switch to day mode' : 'Switch to night mode';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#0B1120' : '#0369A1');
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
    b.addEventListener('click', function () { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); });
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
    ['My money', [['monthly', '📊', 'Monthly', 'Savings'], ['bank', '🏦', 'Bank', 'Balance, cash'], ['wallet', '👛', 'Wallet', 'Amazon Pay']]],
    ['People', [['udhaar', '🤝', 'Udhaar', 'Who owes you'], ['settlement', '👵', 'Settle', "Mother's money"]]],
    ['Plans', [['investments', '📈', 'Invest', 'SIPs and savings'], ['projects', '🔨', 'Projects', 'Home work costs']]],
    ['Account', [['__signout', '🚪', 'Sign out', '']]]
  ];
  var TITLES = {};
  MORE_GROUPS.forEach(function (g) { g[1].forEach(function (t) { TITLES[t[0]] = t[1] + ' ' + t[2]; }); });
  var bnav, sheet, backbar;

  function goStream(stream) {
    var old = document.querySelector('.streambtn[data-stream="' + stream + '"]');
    if (old) old.click();
    closeSheet();
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function openSheet() { if (sheet) sheet.hidden = false; }
  function closeSheet() { if (sheet) sheet.hidden = true; }

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
    var card = el('div', 'msheet-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'More');
    card.appendChild(el('div', 'msheet-grip'));
    MORE_GROUPS.forEach(function (g) {
      card.appendChild(el('div', 'msheet-h', g[0]));
      var grid = el('div', 'msheet-grid');
      g[1].forEach(function (t) {
        var b = el('button', 'mtile'); b.type = 'button';
        b.appendChild(el('span', 'e', t[1]));
        var tx = el('span', 'mt'); tx.appendChild(el('b', null, t[2])); if (t[3]) tx.appendChild(el('small', null, t[3]));
        b.appendChild(tx);
        b.addEventListener('click', function () {
          if (t[0] === '__signout') { closeSheet(); var so = $('signout'); if (so) so.click(); return; }
          goStream(t[0]);
        });
        grid.appendChild(b);
      });
      card.appendChild(grid);
    });
    sheet.appendChild(card);
    backbar = el('div', 'backbar'); backbar.hidden = true;
    var bb = el('button', 'backbtn', '‹ Home'); bb.type = 'button'; bb.addEventListener('click', function () { goStream('spends'); });
    backbar.appendChild(bb); backbar.appendChild(el('span', 'backttl', ''));
    var mainEl = $('main'); if (mainEl && mainEl.parentNode) mainEl.parentNode.insertBefore(backbar, mainEl);
    sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });
    document.body.appendChild(sheet);
  }

  function syncNav() {
    if (!bnav) return;
    var main = $('main');
    bnav.hidden = !main || main.hidden;
    var act = document.querySelector('.streambtn.active');
    var stream = act ? act.dataset.stream : 'spends';
    var key = NAV_OF[stream] || 'more';
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
    list.forEach(function (e) {
      for (var j = 0; j < 7; j++) if (e.ts >= days[j].start && e.ts < days[j].end) { days[j].p += paise(e.amount); break; }
    });
    var week = days.reduce(function (s, d) { return s + d.p; }, 0), today = days[6].p, max = Math.max.apply(null, days.map(function (d) { return d.p; })) || 1;
    box.textContent = '';
    var chips = el('div', 'hx-chips');
    [['Today', today], ['7 days', week], ['Avg / day', Math.round(week / 7)]].forEach(function (c) {
      var chip = el('div', 'hx-chip'); chip.appendChild(el('span', null, c[0])); chip.appendChild(el('b', null, K.money(Math.round(c[1] / 100)))); chips.appendChild(chip);
    });
    box.appendChild(chips);
    var bars = el('div', 'hx-bars'); bars.setAttribute('role', 'img'); bars.setAttribute('aria-label', 'Spending over the last 7 days');
    days.forEach(function (d, idx) {
      var col = el('div', 'hx-col' + (idx === 6 ? ' today' : '')); var bar = el('div', 'hx-bar');
      bar.style.height = Math.max(6, Math.round((d.p / max) * 100)) + '%';
      col.title = K.money(d.p / 100); col.appendChild(bar); col.appendChild(el('i', null, d.letter)); bars.appendChild(col);
    });
    box.appendChild(bars);
    var bank = K.getBankTotals ? K.getBankTotals() : null;
    if (bank && bank.has) {
      var chip = el('button', 'hx-bank'); chip.type = 'button';
      chip.appendChild(el('span', null, '\uD83C\uDFE6 Bank balance' + (bank.count > 1 ? ' (' + bank.count + ' accounts)' : '') + ' \u00b7 estimate'));
      chip.appendChild(el('b', null, K.money(bank.total)));
      chip.addEventListener('click', function () { goStream('bank'); });
      box.appendChild(chip);
    }
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

  /* ---------- wiring ---------- */
  var scheduled = false;
  function refresh() {
    scheduled = false;
    syncNav(); decorateRows();
  }
  function schedule() { if (!scheduled) { scheduled = true; raf(refresh); } }

  buildNav();
  tuckExtras();
  attachSuggest($('desc'), $('amt'));
  attachSuggest($('trip-exp-desc'), $('trip-exp-amt'));
  document.addEventListener('kharcha:render', function () {
    pool = null; countUpTotal(); renderHeroExtras(); decorateRows(); syncNav();
  });
  var main = $('main');
  if (window.MutationObserver) {
    var mo = new MutationObserver(schedule);
    if (main) mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    var sw = $('stream-switcher'); if (sw) mo.observe(sw, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', fitTotal);
  refresh();
})();
