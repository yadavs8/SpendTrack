/* Kharcha Book v142: smarter by itself, and less to look at.
   1. Balance watchdog: bank SMS carry the balance, so money that moved without being logged shows up as a gap.
      Home says so ("₹177 left ICICI between 5 and 10 Nov that isn't logged") with one tap to log it.
   2. Your pages: pages with nothing in them are tucked away from More and the side menu, and you choose
      which pages you want (More > Choose pages). Nothing is deleted; every page comes back with one tap.
   Runs after app.js; uses window.__kharcha and window.KharchaLedger only. */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function KL() { return window.KharchaLedger; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function jget(key, fb) { try { var v = JSON.parse(K.kvGet(key) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } }
  var dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

  /* ---------- 1. balance watchdog ---------- */
  var GAP_KEY = 'kharcha_gap_seen';
  function openGaps() {
    if (!KL() || !KL().balanceGaps || !K.getEntries) return [];
    var seen = jget(GAP_KEY, {}), since = Date.now() - 30 * 86400000;
    return KL().balanceGaps(K.getEntries(), jget('kharcha_not_mine_banks', [])).filter(function (g) { return g.to >= since && !seen[g.key] && g.amount >= 1; }).slice(0, 3);
  }
  function dismiss(g) { var s = jget(GAP_KEY, {}); s[g.key] = 1; K.kvSet(GAP_KEY, JSON.stringify(s)); }
  function gapCard(g) {
    var box = el('section', 'sm-gap');
    var t = el('div', 'sm-gap-t');
    var same = dFmt.format(new Date(g.from)) === dFmt.format(new Date(g.to));
    t.appendChild(el('b', null, '🔎 ' + K.money(g.amount) + (g.dir === 'out' ? ' left ' : ' came into ') + g.bank + ' and isn\'t logged'));
    t.appendChild(el('small', null, (same ? 'On ' + dFmt.format(new Date(g.to)) : 'Between ' + dFmt.format(new Date(g.from)) + ' and ' + dFmt.format(new Date(g.to))) + ' · worked out from your bank SMS balances'));
    box.appendChild(t);
    var acts = el('div', 'sm-gap-a');
    var log = el('button', 'sm-gap-go', 'Log it'); log.type = 'button'; log.setAttribute('data-self-confirm', '');
    log.addEventListener('click', function () {
      K.inputBox({
        title: (g.dir === 'out' ? 'What was the ' : 'Where did the ') + K.money(g.amount) + (g.dir === 'out' ? '?' : ' come from?'),
        message: 'It will be logged on ' + dFmt.format(new Date(g.to)) + '. If it was several small payments, write them together or log them one by one from Add.',
        fields: [{ label: g.dir === 'out' ? 'Paid for' : 'From', placeholder: g.dir === 'out' ? 'e.g. vegetables, auto fare' : 'e.g. refund, friend paid back' }],
        confirmText: 'Log ' + K.money(g.amount),
        onConfirm: function (vals) {
          var note = String((vals && vals[0]) || '').trim() || (g.dir === 'out' ? 'Not logged (' + g.bank + ')' : 'Received (' + g.bank + ')');
          var desc = g.dir === 'out' ? note : '💰 Received · ' + note;
          K.store.add({ amount: g.amount, desc: desc, spent_at: new Date(g.to - 60000).toISOString(), kind: g.dir === 'out' ? 'expense' : 'income', bank: g.bank })
            .then(function () { dismiss(g); K.toast('Logged ' + K.money(g.amount)); K.rerender(); })
            .catch(function (err) { K.toast((err && err.message) || 'Could not log it.'); });
        }
      });
    });
    var no = el('button', 'sm-gap-no', 'Ignore'); no.type = 'button'; no.setAttribute('data-self-confirm', '');
    no.addEventListener('click', function () { dismiss(g); render(); });
    acts.appendChild(log); acts.appendChild(no); box.appendChild(acts);
    return box;
  }
  function render() {
    var old = $('sm-gaps'); if (old) old.remove();
    var home = $('spends-view'), st = K.state || {};
    if (!home || (st.activeStream || 'spends') !== 'spends') return;
    var gaps = openGaps(); if (!gaps.length) return;
    var wrap = el('div', 'sm-gaps'); wrap.id = 'sm-gaps';
    gaps.forEach(function (g) { wrap.appendChild(gapCard(g)); });
    home.insertBefore(wrap, home.firstChild);
  }

  /* ---------- 2. your pages ---------- */
  var PAGES_KEY = 'kharcha_pages';     // { stream: 'show' | 'hide' } -- only what you decided; the rest is automatic
  var OPTIONAL = { autopilot: 'Autopilot', kitchen: 'Kitchen', monthly: 'Monthly', bank: 'Bank', card: 'Credit card', insights: 'Insights', wallet: 'Wallet', rules: 'Auto rules', udhaar: 'Udhaar', settlement: 'Settle', investments: 'Invest', projects: 'Projects' };
  function hasData(stream) {
    var es = (K.getEntries && K.getEntries()) || [];
    function any(re) { return es.some(function (e) { return re.test(e.desc || ''); }); }
    if (stream === 'udhaar') { var l = jget('kharcha_loans', []); return (Array.isArray(l) ? l.length : Object.keys(l || {}).length) > 0 || any(/udhaar|🤝/i); }
    if (stream === 'projects') return any(/🔨/u);
    if (stream === 'wallet') return jget('kharcha_wallets', []).length > 0;
    if (stream === 'card') return Object.keys(jget('kharcha_card', {})).length > 0 || es.some(function (e) { return e.method === 'credit_card'; });
    if (stream === 'investments') return any(/^\s*📈/u);
    if (stream === 'settlement') return any(/🏠|👵/u);
    if (stream === 'bank') return jget('kharcha_bank', []).length > 0 || es.some(function (e) { return !!e.bank; });
    return true;
  }
  function hiddenNow(stream) {
    if (!OPTIONAL[stream]) return false;
    var c = jget(PAGES_KEY, {})[stream];
    if (c === 'hide') return true; if (c === 'show') return false;
    return (K.getEntries && K.getEntries().length > 0) ? !hasData(stream) : false;   // nothing loaded yet: hide nothing
  }
  function applyPages() {
    var n = 0;
    Object.keys(OPTIONAL).forEach(function (s) {
      var hide = hiddenNow(s); if (hide) n++;
      Array.prototype.forEach.call(document.querySelectorAll('.mtile[data-stream="' + s + '"], .side-link[data-stream="' + s + '"]'), function (b) { b.hidden = hide; });
    });
    // a group whose pages are all hidden loses its heading too
    Array.prototype.forEach.call(document.querySelectorAll('.msheet-grid'), function (g) {
      var vis = Array.prototype.some.call(g.children, function (c) { return !c.hidden; });
      g.hidden = !vis; if (g.previousElementSibling && /msheet-h/.test(g.previousElementSibling.className)) g.previousElementSibling.hidden = !vis;
    });
    var tile = $('sm-pages-tile'), sub = tile && tile.querySelector('small');
    if (sub) sub.textContent = n ? n + ' tucked away · tap to change' : 'Hide the ones you don\'t use';
  }
  function chooser() {
    var back = el('div', 'sm-back'), card = el('div', 'sm-sheet');
    var head = el('div', 'sm-head'); head.appendChild(el('b', null, 'Choose your pages'));
    var x = el('button', 'sm-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); head.appendChild(x); card.appendChild(head);
    card.appendChild(el('p', 'sm-note', 'Switch off what you don\'t use. Nothing is deleted: the page and its data come back when you switch it on.'));
    Object.keys(OPTIONAL).forEach(function (s) {
      var row = el('label', 'sm-row'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !hiddenNow(s);
      var tx = el('span', 'sm-row-t'); tx.appendChild(el('b', null, OPTIONAL[s]));
      if (!hasData(s)) tx.appendChild(el('small', null, 'Nothing in it yet'));
      row.appendChild(tx); row.appendChild(cb);
      cb.addEventListener('change', function () { var c = jget(PAGES_KEY, {}); c[s] = cb.checked ? 'show' : 'hide'; K.kvSet(PAGES_KEY, JSON.stringify(c)); applyPages(); });
      card.appendChild(row);
    });
    function close() { back.remove(); }
    x.addEventListener('click', close); back.addEventListener('click', function (ev) { if (ev.target === back) close(); });
    back.appendChild(card);
    var host = document.querySelector('.msheet:not([hidden])') || document.body;   // above the open More sheet
    host.appendChild(back);
  }
  function addTile() {
    if ($('sm-pages-tile')) return true;
    var grids = document.querySelectorAll('.msheet-card .msheet-grid'); if (!grids.length) return false;
    var b = el('button', 'mtile'); b.type = 'button'; b.id = 'sm-pages-tile';
    b.appendChild(el('span', 'e', '🧹'));
    var tx = el('span', 'mt'); tx.appendChild(el('b', null, 'Choose pages')); tx.appendChild(el('small', null, 'Hide the ones you don\'t use')); b.appendChild(tx);
    b.addEventListener('click', chooser);
    grids[grids.length - 1].insertBefore(b, grids[grids.length - 1].firstChild);
    return true;
  }

  /* ---------- 3. simpler Home (v144) ----------
     Home shows three things: the month, what needs you, and your days. The calendar, the category breakdown,
     the card summary and the list of months sit behind one "More about this month" button. */
  var OPEN_KEY = 'kharcha_home_more';
  function simpleHome() {
    var home = $('spends-view'); if (!home) return;
    home.classList.add('sm-compact');
    var open = false; try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (e) {}
    home.classList.toggle('sm-open', open);
    var btn = $('sm-more-btn');
    if (!btn) {
      btn = el('button', 'sm-more-btn'); btn.type = 'button'; btn.id = 'sm-more-btn';
      btn.addEventListener('click', function () {
        var now = !home.classList.contains('sm-open'); home.classList.toggle('sm-open', now);
        try { localStorage.setItem(OPEN_KEY, now ? '1' : '0'); } catch (e) {}
        paintMore();
      });
      home.appendChild(btn);
    }
    function paintMore() {
      var o = home.classList.contains('sm-open'); btn.textContent = '';
      btn.appendChild(el('span', null, o ? '📊 Less about this month' : '📊 More about this month'));
      btn.appendChild(el('small', null, o ? 'Hide ▴' : 'Calendar, categories, months ▾'));
      btn.setAttribute('aria-expanded', o ? 'true' : 'false');
    }
    paintMore();
    // everything that needs you, in one place
    var old = $('sm-attn'); var keep = [];
    ['sm-gaps', 'ap-nudges', 'kt-nudge'].forEach(function (id) { var n = $(id); if (n) keep.push(n); });
    var unsorted = ((K.visibleEntries && K.visibleEntries()) || []).filter(function (e) { return /^\s*\u{23F3}/u.test(e.desc || ''); });
    if (old) { keep.forEach(function (n) { if (old.contains(n)) home.insertBefore(n, old); }); old.remove(); }
    var done = $('sm-done'); if (done) done.remove();
    if (!keep.length && !unsorted.length) {
      // nothing waiting: say so, lightly
      if (((K.visibleEntries && K.visibleEntries()) || []).length) { done = el('div', 'sm-done', '✨ All caught up. Nothing needs you.'); done.id = 'sm-done'; home.insertBefore(done, home.firstChild); }
      return;
    }
    var box = el('div', 'sm-attn'); box.id = 'sm-attn';
    var h = el('div', 'sm-attn-h'); h.appendChild(el('span', null, 'Needs you'));
    var count = unsorted.length + keep.reduce(function (t, n) { return t + Math.max(1, n.querySelectorAll('.sm-gap, .ap-nudge, .due-ask').length || 1); }, 0);
    h.appendChild(el('span', 'sm-attn-n', String(count))); box.appendChild(h);
    if (unsorted.length) {
      var sb = el('button', 'sm-sort'); sb.type = 'button';
      sb.appendChild(el('b', null, '⏳ ' + unsorted.length + (unsorted.length === 1 ? ' payment' : ' payments') + ' to sort'));
      sb.appendChild(el('span', null, 'Show ›'));
      sb.addEventListener('click', function () { var t = document.querySelector('.entry-swipe-wrap.unsorted'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      box.appendChild(sb);
    }
    keep.forEach(function (n) { box.appendChild(n); });
    home.insertBefore(box, home.firstChild);
  }

  document.addEventListener('kharcha:render', function () { setTimeout(function () { try { render(); addTile(); applyPages(); } catch (e) {} setTimeout(function () { try { simpleHome(); } catch (e) {} }, 60); }, 40); });
  window.__smart = { render: render, gaps: openGaps, applyPages: applyPages, hidden: hiddenNow };
})();
