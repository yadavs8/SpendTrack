/* Kharcha Book v76: Credit card screen (More > Credit card). What the card owes, what is still available, and every card spend.
   Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var KEY = 'kharcha_card';
  var dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var sFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  var ui = { range: 'month', edit: null };

  function money(v) { return K.money(Math.round(v * 100) / 100); }
  function load() { try { var o = JSON.parse(K.kvGet(KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  function save(o) { K.kvSet(KEY, JSON.stringify(o)); }
  function creditCards() { var own = K.loadOwn(); return ((own && own.cards) || []).filter(function (c) { return c.kind === 'credit'; }); }
  function same(a, b) { a = String(a || '').replace(/\D/g, ''); b = String(b || '').replace(/\D/g, ''); return a.length >= 3 && b.length >= 3 && (a.slice(-3) === b.slice(-3)); }

  function predicates(cards) {
    var KL = window.KharchaLedger, own = K.loadOwn();
    return {
      onCard: function (e, card) {
        if (!K.isCardEntry(e)) return false;
        if (same(e.last4, card.last4)) return true;
        var c = KL.cardFor(e.desc, own) || KL.cardFor(e.raw, own);
        if (c) return c.last4 === card.last4;
        return cards.length === 1;                          // a card spend that names no card, and you have only one
      },
      isSpend: function (e) { return K.isExpense(e) && !K.isCardBillEntry(e) && !K.isTransferEntry(e); },
      isPayment: function (e, card) {
        if (!K.isCardBillEntry(e)) return false;
        var c = KL.cardFor(e.desc, own) || KL.cardFor(e.raw, own);
        return c ? c.last4 === card.last4 : cards.length === 1;
      }
    };
  }

  function rangeStart(r) {
    var n = new Date();
    if (r === 'month') return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
    if (r === 'last') return new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
    return 0;
  }
  function rangeEnd(r) { var n = new Date(); return r === 'last' ? new Date(n.getFullYear(), n.getMonth(), 1).getTime() : Infinity; }
  function clean(desc) { return String(desc || '').replace(/^\s*(?:[\u{1F3E0}\u{1F464}\u{1F4C8}\u{1F528}\u{1F501}✈️]\s*)+/u, '').trim() || 'Card spend'; }

  function field(label, input) { var w = el('label', 'fld'); w.appendChild(el('span', null, label)); w.appendChild(input); return w; }
  function num(ph, val) { var i = el('input', 'input'); i.type = 'text'; i.inputMode = 'decimal'; i.placeholder = ph; if (val) i.value = String(val); return i; }

  function setupForm(card, st, setup) {
    var f = el('div', 'wal-form');
    f.appendChild(el('p', 'wal-hint', 'Type your card limit and what you owe right now (the figure in your card app). After that, each card SMS that shows the available limit keeps it exact by itself.'));
    var lim = num('Card limit, e.g. 200000', setup.limit), owed = num('Owed today, e.g. 18500', st.outstanding != null ? st.outstanding : '');
    var r = el('div', 'add-row'); r.appendChild(field('Total limit (₹)', lim)); r.appendChild(field('Owed today (₹)', owed)); f.appendChild(r);
    var go = el('button', 'primary small', 'Save'); go.type = 'button';
    go.addEventListener('click', function () {
      var l = K.parseAmount(lim.value), o = owed.value.trim() === '' ? null : K.parseAmount(owed.value);
      if (lim.value.trim() !== '' && l == null) { K.toast('Enter the limit as a number'); return; }
      if (owed.value.trim() !== '' && o == null) { K.toast('Enter what you owe as a number'); return; }
      var all = load(), cur = all[card.last4] || {};
      if (l != null) cur.limit = l;
      if (o != null) cur.base = { ts: Date.now(), outstanding: o };
      all[card.last4] = cur; save(all); ui.edit = null; render(); K.toast('Card saved');
    });
    var cx = el('button', 'ghost', 'Cancel'); cx.type = 'button'; cx.addEventListener('click', function () { ui.edit = null; render(); });
    var row = el('div', 'wal-acts'); row.appendChild(go); row.appendChild(cx); f.appendChild(row);
    return f;
  }

  function cardBlock(card, cards, pred, entries) {
    var KL = window.KharchaLedger, setup = load()[card.last4] || {}, st = KL.cardState(entries, card, setup, pred);
    var box = el('div', 'wal-card'), head = el('div', 'wal-head');
    head.appendChild(el('span', 'wal-name', '💳 ' + (card.bank ? card.bank.toUpperCase() + ' card' : 'Credit card') + ' ·· ' + card.last4));
    box.appendChild(head);
    if (st.outstanding != null) {
      box.appendChild(el('div', 'wal-bal' + (st.outstanding < 0 ? ' neg' : ''), money(st.outstanding)));
      box.appendChild(el('div', 'wal-sub', 'Owed on the card' + (st.available != null ? ' · ' + money(st.available) + ' still available of ' + money(st.limit) : '')));
      if (st.limit > 0) {
        var pct = Math.max(0, Math.min(100, Math.round(st.outstanding / st.limit * 100))), bar = el('div', 'cc-bar'), fill = el('i'); fill.style.width = pct + '%';
        if (pct >= 70) fill.className = 'hot'; bar.appendChild(fill); box.appendChild(bar);
        box.appendChild(el('div', 'wal-hint', pct + '% of the limit used'));
      }
      box.appendChild(el('div', 'wal-hint', st.source === 'sms'
        ? '✉️ Exact: from the card SMS of ' + sFmt.format(st.since) + ', plus what happened after it.'
        : 'Estimate: ' + money(setup.base.outstanding) + ' on ' + sFmt.format(st.since) + ', plus card spends, minus bill payments since.'));
    } else {
      box.appendChild(el('div', 'wal-bal', '—'));
      box.appendChild(el('p', 'wal-hint', st.availableSms
        ? 'The card SMS shows ' + money(st.availableSms.avail) + ' available. Add the card limit to see what is owed.'
        : 'Add the card limit and what you owe today to see the balance.'));
    }
    var acts = el('div', 'wal-acts'), edit = el('button', 'ghost small', ui.edit === card.last4 ? 'Close' : (st.outstanding != null ? '✏️ Change limit or amount' : '➕ Set limit and amount owed')); edit.type = 'button';
    edit.addEventListener('click', function () { ui.edit = ui.edit === card.last4 ? null : card.last4; render(); });
    acts.appendChild(edit); box.appendChild(acts);
    if (ui.edit === card.last4) box.appendChild(setupForm(card, st, setup));

    // chips + the list for the chosen range
    var chips = el('div', 'wal-check');
    [['month', 'This month'], ['last', 'Last month'], ['all', 'All time']].forEach(function (c) {
      var b = el('button', 'cc-chip' + (ui.range === c[0] ? ' on' : ''), c[1]); b.type = 'button';
      b.addEventListener('click', function () { ui.range = c[0]; render(); }); chips.appendChild(b);
    });
    box.appendChild(chips);
    var from = rangeStart(ui.range), to = rangeEnd(ui.range);
    var inR = function (e) { return e.ts >= from && e.ts < to; };
    var spends = st.spends.filter(inR).sort(function (a, b) { return b.ts - a.ts; }), pays = st.payments.filter(inR).sort(function (a, b) { return b.ts - a.ts; });
    var total = spends.reduce(function (n, e) { return n + Math.round(e.amount * 100); }, 0) / 100;
    var paid = pays.reduce(function (n, e) { return n + Math.round(e.amount * 100); }, 0) / 100;
    box.appendChild(el('div', 'wal-sub', 'Spent on this card: ' + money(total) + ' · ' + spends.length + (spends.length === 1 ? ' payment' : ' payments') + (paid ? ' · Bill paid: ' + money(paid) : '')));
    if (!spends.length && !pays.length) { box.appendChild(el('p', 'wal-hint', 'No card payments in this period yet. They appear here by themselves when your card SMS arrives.')); return box; }
    var ul = el('ul', 'wal-items'), lastDay = '';
    pays.forEach(function (e) { var li = el('li', 'wal-item up'); li.appendChild(el('span', null, '🧾 ' + clean(e.desc) + ' · ' + sFmt.format(e.ts))); li.appendChild(el('span', 'wal-amt', '− ' + money(e.amount))); ul.appendChild(li); });
    spends.slice(0, 80).forEach(function (e) {
      var day = dFmt.format(e.ts);
      if (day !== lastDay) { lastDay = day; var h = el('li', 'cc-day', day); ul.appendChild(h); }
      var li = el('li', 'wal-item'); li.appendChild(el('span', null, clean(e.desc))); li.appendChild(el('span', 'wal-amt', money(e.amount))); ul.appendChild(li);
    });
    box.appendChild(ul);
    if (spends.length > 80) box.appendChild(el('p', 'wal-hint', 'Showing the latest 80 of ' + spends.length + '.'));
    return box;
  }

  function render() {
    var root = $('card-root');
    if (!root || !K.getEntries) return;
    root.textContent = '';
    var cards = creditCards();
    if (!cards.length) {
      var c = el('div', 'wal-card'); c.appendChild(el('div', 'wal-name', '💳 Credit card'));
      c.appendChild(el('p', 'wal-hint', 'Add your credit card in Auto rules > My accounts and cards (the last 4 digits), and this screen shows what it owes and every swipe.'));
      root.appendChild(c); return;
    }
    var pred = predicates(cards), entries = K.getEntries();
    cards.forEach(function (card) { root.appendChild(cardBlock(card, cards, pred, entries)); });
  }
  document.addEventListener('kharcha:card', render);
  document.addEventListener('kharcha:render', function () { var s = $('card-sec'); if (s && !s.hidden) render(); });
})();
