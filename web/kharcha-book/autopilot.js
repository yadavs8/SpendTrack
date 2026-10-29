/* Kharcha Book v127: Autopilot (More > Autopilot) and the "Safe to spend today" chip on Home.
   - Safe to spend: income in + salary still expected - spent - bills still due - what you keep aside, over the days left.
   - Bills that repeat each month, found by themselves: countdown, late, paid, price changes, yearly cost of subscriptions.
   - Money coming in (salaries, pension) and the costs creeping up or cooling down against your usual.
   Runs after app.js and only uses what app.js exposes (window.__kharcha) and ledger-logic.js (window.KharchaLedger). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(v) { return K.money(Math.round(v)); }
  var HIDE_KEY = 'kharcha_autopilot_hide', KEEP_KEY = 'kharcha_autopilot_keep', MINE_KEY = 'kharcha_autopilot_bills';
  var BILL_WORDS = /\b(emi|rent|lic|premium|insurance|electric\w*|bijli|broadband|wifi|fibre|fiber|recharge|postpaid|airtel|jio|vodafone|\bvi\b|netflix|hotstar|prime|spotify|youtube|sip|maintenance|society|school fee|tuition|gas bill|water bill)\b/i;
  var dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  var ui = { paidOpen: false, hiddenOpen: false };
  var SUBS = { subscription: 1, recharge: 1, entertainment: 1 };

  function hidden() { try { var a = JSON.parse(K.kvGet(HIDE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function myBills() { try { var a = JSON.parse(K.kvGet(MINE_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (b) { return b && b.name && b.amount > 0 && b.day >= 1 && b.day <= 31; }) : []; } catch (e) { return []; } }
  function saveMyBills(a) { K.kvSet(MINE_KEY, JSON.stringify(a)); memo.v = null; render(); homeChip(); }
  function keepAside() { var n = Number(K.kvGet(KEEP_KEY) || 0); return isFinite(n) && n > 0 ? n : 0; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function curKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function catOf(e) { var KL = window.KharchaLedger; return KL && KL.categoryOf ? KL.categoryOf(e.desc, e.raw) : { icon: '🧾', color: '#64748b', key: 'other' }; }

  // Everything the page and the Home chip need, worked out once per render.
  var memo = { at: 0, n: -1, v: null };
  function plan() {
    var KL = window.KharchaLedger;
    if (!KL || !KL.recurringSeries || !K.getEntries || !K.isExpense) return null;
    var entries = K.getEntries(), nowMs = Date.now();
    if (memo.v && memo.n === entries.length && nowMs - memo.at < 15000) return memo.v;
    var now = new Date(nowMs), mk = curKey(now), hide = hidden();
    var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var isInv = function (e) { return !!(K.isInvestment && K.isInvestment(e)); };
    // LIC, SIPs and EMIs are commitments too, so they count as bills (and as money out) here.
    var isBillLike = function (e) { return (K.isExpense(e) || isInv(e)) && !(K.isCardBillEntry && K.isCardBillEntry(e)) && !(K.isTransferEntry && K.isTransferEntry(e)); };
    var bills = KL.recurringSeries(entries, nowMs, isBillLike).filter(function (b) { return hide.indexOf(b.key) < 0; });
    // bills you added yourself (or from a suggestion): paid when this month has a payment with the same name
    var autoKeys = bills.map(function (b) { return b.key; }), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var monthStart0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var thisMonth = entries.filter(function (e) { return e && !e.synthetic && e.ts >= monthStart0 && e.ts <= nowMs && isBillLike(e); });
    myBills().forEach(function (mb) {
      var key = KL.seriesKey(mb.name); if (!key || autoKeys.indexOf(key) >= 0) return;
      var hit = thisMonth.filter(function (e) { return KL.seriesKey(e.desc) === key; }).sort(function (a, b) { return b.ts - a.ts; })[0];
      var dueDay = Math.min(mb.day, dim), daysTo = dueDay - now.getDate();
      bills.push({ key: key, label: mb.name, amount: Math.round(mb.amount), day: mb.day, dueTs: new Date(now.getFullYear(), now.getMonth(), dueDay).getTime(), daysTo: daysTo,
        status: hit ? 'paid' : daysTo < -3 ? 'late' : daysTo < 0 ? 'due' : daysTo <= 3 ? 'soon' : 'upcoming', paidAmount: hit ? Math.round(hit.amount) : 0, paidTs: hit ? hit.ts : null,
        months: 0, change: hit && Math.abs(hit.amount - mb.amount) >= Math.max(10, mb.amount * 0.03) ? Math.round(hit.amount - mb.amount) : 0, sample: hit || { desc: mb.name }, mine: true });
    });
    bills.sort(function (a, b) { return a.day - b.day; });
    // payments this month that look like bills and aren't tracked yet: one tap to add
    var have = bills.map(function (b) { return b.key; }).concat(hide), seen = {};
    var suggest = thisMonth.filter(function (e) {
      var k = KL.seriesKey(e.desc), c = catOf(e).key;
      if (!k || seen[k] || have.indexOf(k) >= 0 || e.amount < 99) return false;
      if (!(BILL_WORDS.test(String(e.desc || '')) || c === 'bills' || c === 'insurance' || c === 'recharge' || c === 'subscription' || isInv(e))) return false;
      seen[k] = 1; return true;
    }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 4);
    var incomes = KL.recurringSeries(entries, nowMs, function (e) { return K.isIncome(e); });
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), incomeGot = 0, todaySpent = 0, invested = 0, byMonth = {};
    var monthIdx = function (ts) { var d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); }, cur = monthIdx(nowMs);
    entries.forEach(function (e) {
      if (!e || e.synthetic || e.ts > nowMs) return;
      if (K.isIncome(e)) { var mi = monthIdx(e.ts); if (mi >= cur - 3) byMonth[mi] = (byMonth[mi] || 0) + (Number(e.amount) || 0); }
      if (e.ts < monthStart) return;
      if (K.isIncome(e)) incomeGot += Number(e.amount) || 0;
      else if (isInv(e)) invested += Number(e.amount) || 0;
      if (e.ts >= dayStart && (K.isExpense(e) || isInv(e))) todaySpent += Number(e.amount) || 0;
    });
    // What a month runs on: your budget if you set one, else your usual month's income (median of the last 3 months).
    // A salary that lands on the 30th pays for the next month, so this month's own credits alone would mislead.
    var past = [cur - 1, cur - 2, cur - 3].map(function (mi) { return byMonth[mi] || 0; }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    // too little history for a median: the last 30 days of income hold about one of each monthly credit
    var last30 = 0; entries.forEach(function (e) { if (e && !e.synthetic && e.ts <= nowMs && e.ts > nowMs - 30 * 86400000 && K.isIncome(e)) last30 += Number(e.amount) || 0; });
    var usual = past.length >= 2 ? (past.length % 2 ? past[(past.length - 1) / 2] : (past[past.length / 2 - 1] + past[past.length / 2]) / 2) : Math.max(last30, incomeGot);
    if (past.length < 2) past = [];
    var budget = Number(K.kvGet('kharcha_monthly_budget')) || 0;
    var mode = budget > 0 ? 'budget' : 'income', base = Math.round(budget > 0 ? budget : usual);
    var due = bills.filter(function (b) { return b.status !== 'paid'; });
    var billsDue = due.reduce(function (s, b) { return s + b.amount; }, 0);
    var spent = (K.monthForecast ? K.monthForecast(entries, mk, now).spent : 0) + invested;
    var keep = mode === 'income' ? keepAside() : 0;
    var fixedMonth = bills.reduce(function (s, b) { return s + (b.status === 'paid' ? b.paidAmount : b.amount); }, 0);
    var safe = base > 0 ? KL.safeToSpend({ incomeGot: base, spent: spent, billsDue: billsDue, fixedMonth: fixedMonth,
      keepAside: keep, todaySpent: todaySpent, day: now.getDate(), daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }) : null;
    var v = { suggest: suggest, bills: bills, incomes: incomes, mode: mode, base: base, incomeGot: incomeGot, usualMonths: past.length, spent: spent, invested: invested, billsDue: billsDue,
      due: due, keep: keep, todaySpent: todaySpent, safe: safe, creep: KL.creepingSpends ? KL.creepingSpends(entries, nowMs, K.isExpense) : { up: [], down: [] } };
    memo = { at: nowMs, n: entries.length, v: v };
    return v;
  }

  function goAutopilot() { var l = document.querySelector('.side-link[data-stream="autopilot"]'); if (l) l.click(); else { var b = $('stream-autopilot-btn'); if (b) b.click(); } }

  /* ---------- Home: one chip that answers "can I spend today?" ---------- */
  function homeChip() {
    var box = $('hero-extras'); if (!box) return;
    var old = box.querySelector('.ap-chip'); if (old) old.remove();
    var st = K.state || {};
    if ((st.activeStream || 'spends') !== 'spends' || (K.selMonth && K.selMonth() !== curKey(new Date()))) return;
    var p = plan(); if (!p || !p.safe) return;
    var s = p.safe, chip = el('button', 'ap-chip ' + s.status); chip.type = 'button';
    var l = el('span', 'ap-chip-l');
    l.appendChild(el('small', null, s.status === 'over' ? '⚠️ Over for this month' : s.status === 'today-over' ? '🔥 Over today\'s share' : '🛡️ Safe to spend today'));
    l.appendChild(el('b', null, s.status === 'over' ? money(-s.pool) : money(Math.max(0, s.todayLeft))));
    chip.appendChild(l);
    var r = el('span', 'ap-chip-r');
    r.appendChild(el('span', null, s.status === 'over' ? 'Spent more than came in' : (s.daysLeft > 1 ? 'then ' + money(Math.max(0, s.fromTomorrow)) + '/day' : 'last day of the month')));
    var next = p.due.filter(function (b) { return b.daysTo >= 0; })[0];
    var short = next ? String(next.label).split(' ').slice(0, 2).join(' ').slice(0, 14) : '';
    var late = p.due.filter(function (b) { return b.status === 'late'; })[0];
    r.appendChild(el('small', null, late ? '⚠️ ' + String(late.label).split(' ').slice(0, 2).join(' ').slice(0, 14) + ' is late' :
      next ? short + ' ' + money(next.amount) + (next.daysTo === 0 ? ' today' : next.daysTo === 1 ? ' tomorrow' : ' in ' + next.daysTo + 'd') : s.daysLeft + ' days left'));
    chip.appendChild(r);
    chip.addEventListener('click', goAutopilot);
    box.insertBefore(chip, box.firstChild);
  }

  /* ---------- the Autopilot page ---------- */
  function statusText(b) {
    if (b.status === 'paid') return '✓ Paid ' + dFmt.format(new Date(b.paidTs));
    if (b.status === 'late') return (-b.daysTo) + ' days late';
    if (b.status === 'due') return 'Due ' + (-b.daysTo === 1 ? 'yesterday' : (-b.daysTo) + ' days ago');
    if (b.daysTo === 0) return 'Due today';
    if (b.daysTo === 1) return 'Tomorrow';
    return 'In ' + b.daysTo + ' days';
  }
  function heroCard(p) {
    var s = p.safe, card = el('section', 'ap-hero ' + (s ? s.status : 'none'));
    if (!s) {
      card.appendChild(el('div', 'ap-k', 'SAFE TO SPEND'));
      card.appendChild(el('div', 'ap-big', '—'));
      card.appendChild(el('p', 'ap-sub', 'Log this month\'s salary or any income and Autopilot works out what you can spend each day.'));
      return card;
    }
    card.appendChild(el('div', 'ap-k', s.status === 'over' ? 'THIS MONTH IS OVER BY' : 'SAFE TO SPEND TODAY'));
    card.appendChild(el('div', 'ap-big', s.status === 'over' ? money(-s.pool) : money(Math.max(0, s.todayLeft))));
    var msg = s.status === 'over' ? 'Spends and bills due are more than the money in this month. Keep today light.' :
      s.status === 'today-over' ? 'Today went ' + money(-s.todayLeft) + ' over its share. The rest of the month gets ' + money(Math.max(0, s.fromTomorrow)) + ' a day.' :
      'Today started with ' + money(s.allowance) + (p.todaySpent ? ', ' + money(p.todaySpent) + ' spent so far.' : '. Nothing spent yet.');
    card.appendChild(el('p', 'ap-sub', msg));
    if (s.spare > 0) card.appendChild(el('div', 'ap-spare', '🎉 ' + money(s.spare) + ' spare this month beyond a comfortable pace. A good month to move it to savings.'));
    if (s.status !== 'over') {
      var track = el('div', 'ap-track'), fill = el('i');
      fill.style.width = Math.min(100, s.allowance ? Math.round(p.todaySpent / s.allowance * 100) : 0) + '%'; track.appendChild(fill); card.appendChild(track);
    }
    var pills = el('div', 'ap-pills');
    [[s.daysLeft > 1 ? money(Math.max(0, s.fromTomorrow)) : '—', 'a day from tomorrow'], [String(s.daysLeft), s.daysLeft === 1 ? 'day left' : 'days left'], [money(Math.max(0, s.pool)), 'left this month']]
      .forEach(function (x) { var d = el('div', 'ap-pill'); d.appendChild(el('b', null, x[0])); d.appendChild(el('small', null, x[1])); pills.appendChild(d); });
    card.appendChild(pills);
    // how it is worked out
    var how = el('div', 'ap-how');
    function line(label, v, sign, extra) {
      var r = el('div', 'ap-line' + (sign === '=' ? ' total' : ''));
      r.appendChild(el('span', null, label)); var b = el('b', null, (sign && sign !== '=' ? sign + ' ' : '') + money(v)); r.appendChild(b);
      if (extra) r.appendChild(extra); how.appendChild(r);
    }
    line(p.mode === 'budget' ? 'Your monthly budget' : p.usualMonths ? 'Your usual month\'s income' : 'Income, last 30 days', p.base, '');
    line(p.invested ? 'Spent & invested so far' : 'Spent so far', p.spent, '−');
    if (p.billsDue) line('Bills still due (' + p.due.length + ')', p.billsDue, '−');
    var kb = el('button', 'ap-keep', p.keep ? 'Change' : 'Set'); kb.type = 'button';
    kb.addEventListener('click', function () {
      K.inputBox({ title: '🐷 Keep aside each month', message: 'Money for savings or a goal. Autopilot leaves it out of what you can spend.',
        fields: [{ label: 'Amount (₹), 0 for none', value: p.keep ? String(p.keep) : '', placeholder: 'e.g. 10000', inputmode: 'decimal' }], confirmText: 'Save',
        onConfirm: function (v) { var n = Number(String(v[0] || '').replace(/[,₹\s]/g, '')); K.kvSet(KEEP_KEY, isFinite(n) && n > 0 ? String(Math.round(n)) : '0'); memo.v = null; render(); homeChip(); } });
    });
    if (p.mode === 'income') line('Keep aside', p.keep, '−', kb);
    line('Left for the month', s.pool, '=');
    card.appendChild(how);
    card.appendChild(el('p', 'ap-foot', p.mode === 'budget' ? 'Based on the monthly budget on Home. Clear it there to plan from your income instead.' :
      p.usualMonths ? 'Based on your income in the last ' + p.usualMonths + ' months, so a salary on the 30th still counts for the month it pays for.' : 'Based on the income of the last 30 days. Once you have a few months of history it uses your usual month.'));
    return card;
  }
  function billRow(b) {
    var c = catOf(b.sample), row = el('div', 'ap-bill ' + b.status);
    var ic = el('span', 'ap-ic', c.icon || '🧾'); ic.style.background = (c.color || '#64748b') + '22'; row.appendChild(ic);
    var mid = el('div', 'ap-mid');
    mid.appendChild(el('b', null, b.label));
    var meta = el('small', null, (b.mine ? 'Every month on the ' : 'Usually the ') + b.day + ordinal(b.day) + (b.mine ? ' · added by you' : ' · seen ' + b.months + ' months'));
    mid.appendChild(meta);
    if (b.change) mid.appendChild(el('span', 'ap-chg ' + (b.change > 0 ? 'up' : 'down'), (b.change > 0 ? '▲ ' : '▼ ') + money(Math.abs(b.change)) + (b.change > 0 ? ' more than last month' : ' less than last month')));
    row.appendChild(mid);
    var right = el('div', 'ap-right');
    right.appendChild(el('b', null, money(b.status === 'paid' ? b.paidAmount : b.amount)));
    right.appendChild(el('span', 'ap-when ' + b.status, statusText(b)));
    row.appendChild(right);
    var x = el('button', 'ap-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Not a bill');
    x.addEventListener('click', function () {
      if (b.mine) {
        var was = myBills(); saveMyBills(was.filter(function (m) { return window.KharchaLedger.seriesKey(m.name) !== b.key; }));
        K.toast(b.label + ' removed', function () { saveMyBills(was); }); return;
      }
      var before = hidden(); K.kvSet(HIDE_KEY, JSON.stringify(before.concat([b.key]))); memo.v = null; render(); homeChip();
      K.toast(b.label + ' is not treated as a bill', function () { K.kvSet(HIDE_KEY, JSON.stringify(before)); memo.v = null; render(); homeChip(); });
    });
    row.appendChild(x);
    if (b.mine) {
      // a bill you added: tap it to fix the name, amount or day
      mid.classList.add('ap-edit'); mid.setAttribute('role', 'button'); mid.tabIndex = 0;
      mid.addEventListener('click', function () { editBill(b); });
    }
    return row;
  }
  function editBill(b) {
    var list = myBills(), KL = window.KharchaLedger, i = list.map(function (m) { return KL.seriesKey(m.name); }).indexOf(b.key);
    if (i < 0) return;
    var cur = list[i];
    K.inputBox({ title: '✏️ Edit ' + cur.name, message: 'Change what is wrong, or tap × on the bill to remove it.',
      fields: [{ label: 'Name', value: cur.name }, { label: 'Amount (₹)', value: String(cur.amount), inputmode: 'decimal' }, { label: 'Day of the month (1-31)', value: String(cur.day), inputmode: 'numeric' }],
      confirmText: 'Save',
      onConfirm: function (v) {
        var name = String(v[0] || '').trim().slice(0, 40), amt = Number(String(v[1] || '').replace(/[,₹\s]/g, '')), day = parseInt(v[2], 10);
        if (!name || !(amt > 0) || !(day >= 1 && day <= 31)) { K.toast('Add a name, an amount and a day from 1 to 31'); return; }
        var next = list.slice(); next[i] = { name: name, amount: Math.round(amt), day: day }; saveMyBills(next); K.toast('Saved ' + name);
      } });
  }
  // bills you hid with ×, listed so they can come back any time (not only from the Undo pop-up)
  function hiddenList() {
    var h = hidden(); if (!h.length) return null;
    var box = el('div', 'ap-hidden');
    var t = el('button', 'ap-more', ui.hiddenOpen ? 'Close hidden bills ▴' : '🙈 Hidden bills (' + h.length + ') · restore ▾'); t.type = 'button';
    t.addEventListener('click', function () { ui.hiddenOpen = !ui.hiddenOpen; render(); });
    box.appendChild(t);
    if (ui.hiddenOpen) h.forEach(function (k) {
      var r = el('div', 'ap-sub-row'); r.appendChild(el('span', null, '🙈 ' + k.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); })));
      var rb = el('button', 'ap-keep ap-restore', 'Restore'); rb.type = 'button';
      rb.addEventListener('click', function () { K.kvSet(HIDE_KEY, JSON.stringify(hidden().filter(function (x) { return x !== k; }))); memo.v = null; render(); homeChip(); K.toast('Back on Autopilot'); });
      r.appendChild(rb); box.appendChild(r);
    });
    return box;
  }
  function ordinal(d) { return (d % 100 >= 11 && d % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][d % 10] || 'th'); }
  function billsCard(p) {
    var card = el('section', 'ap-card');
    var h = el('div', 'ap-h'); h.appendChild(el('span', null, '📅 Bills on autopilot'));
    h.appendChild(el('small', null, p.bills.length ? money(p.billsDue) + ' still due' : '')); card.appendChild(h);
    if (p.suggest.length) {
      var sg = el('div', 'ap-sugg'); sg.appendChild(el('div', 'ap-k2', 'LOOKS LIKE A BILL · TAP TO TRACK'));
      p.suggest.forEach(function (e) {
        var d = new Date(e.ts), name = (window.KharchaLedger.payeeName(e.desc) || 'Bill').slice(0, 30);
        var b = el('button', 'ap-sg'); b.type = 'button';
        b.appendChild(el('span', null, (catOf(e).icon || '🧾') + ' ' + name)); b.appendChild(el('b', null, money(e.amount) + ' · ' + d.getDate() + ordinal(d.getDate())));
        b.addEventListener('click', function () {
          saveMyBills(myBills().concat([{ name: name, amount: Math.round(e.amount), day: d.getDate() }]));
          K.toast(name + ' is tracked every month on the ' + d.getDate() + ordinal(d.getDate()));
        });
        sg.appendChild(b);
      });
      card.appendChild(sg);
    }
    var addB = el('button', 'ap-add', '＋ Add a bill'); addB.type = 'button';
    addB.addEventListener('click', function () {
      K.inputBox({ title: '📅 Add a monthly bill', message: 'Autopilot counts it in safe-to-spend and marks it paid when a payment with this name comes in.',
        fields: [{ label: 'Name', placeholder: 'e.g. Flat EMI' }, { label: 'Amount (₹)', placeholder: 'e.g. 5718', inputmode: 'decimal' }, { label: 'Day of the month (1-31)', placeholder: 'e.g. 5', inputmode: 'numeric' }],
        confirmText: 'Add bill',
        onConfirm: function (v) {
          var name = String(v[0] || '').trim().slice(0, 40), amt = Number(String(v[1] || '').replace(/[,₹\s]/g, '')), day = parseInt(v[2], 10);
          if (!name || !(amt > 0) || !(day >= 1 && day <= 31)) { K.toast('Add a name, an amount and a day from 1 to 31'); return; }
          saveMyBills(myBills().concat([{ name: name, amount: Math.round(amt), day: day }])); K.toast(name + ' added');
        } });
    });
    if (!p.bills.length) {
      card.appendChild(el('p', 'ap-muted', 'Bills show up here by themselves once the same payment repeats in two months: EMI, rent, phone, insurance, subscriptions. Add the ones you know now.'));
      card.appendChild(addB); var hl0 = hiddenList(); if (hl0) card.appendChild(hl0); return card;
    }
    var order = { late: 0, due: 1, soon: 2, upcoming: 3, paid: 4 };
    var open = p.bills.filter(function (b) { return b.status !== 'paid'; }).sort(function (a, b) { return order[a.status] - order[b.status] || a.daysTo - b.daysTo; });
    var paid = p.bills.filter(function (b) { return b.status === 'paid'; });
    if (!open.length) card.appendChild(el('p', 'ap-done', '🎉 Every bill this month is paid.'));
    open.forEach(function (b) { card.appendChild(billRow(b)); });
    if (paid.length) {
      var t = el('button', 'ap-more', (ui.paidOpen ? 'Hide' : 'Show') + ' paid this month (' + paid.length + ') ' + (ui.paidOpen ? '▴' : '▾')); t.type = 'button';
      t.addEventListener('click', function () { ui.paidOpen = !ui.paidOpen; render(); });
      card.appendChild(t);
      if (ui.paidOpen) paid.forEach(function (b) { card.appendChild(billRow(b)); });
    }
    card.appendChild(addB);
    var hl = hiddenList(); if (hl) card.appendChild(hl);
    card.appendChild(el('p', 'ap-muted', 'Added one by mistake? Tap × on it to remove it. Tap a bill you added to change it. Paid ones are under “Show paid”.'));
    return card;
  }
  function fixedCard(p) {
    if (!p.bills.length) return null;
    var month = p.bills.reduce(function (s, b) { return s + b.amount; }, 0);
    var subs = p.bills.filter(function (b) { return SUBS[catOf(b.sample).key]; }).sort(function (a, b) { return b.amount - a.amount; });
    var card = el('section', 'ap-card');
    var h = el('div', 'ap-h'); h.appendChild(el('span', null, '🔁 Fixed costs')); card.appendChild(h);
    var g = el('div', 'ap-pills');
    [[money(month), 'every month'], [money(month * 12), 'a year'], [p.base ? Math.round(month / p.base * 100) + '%' : '—', p.mode === 'budget' ? 'of your budget' : 'of your income']]
      .forEach(function (x) { var d = el('div', 'ap-pill'); d.appendChild(el('b', null, x[0])); d.appendChild(el('small', null, x[1])); g.appendChild(d); });
    card.appendChild(g);
    if (subs.length) {
      card.appendChild(el('div', 'ap-k2', 'SUBSCRIPTIONS & PLANS'));
      subs.forEach(function (b) {
        var r = el('div', 'ap-sub-row'); r.appendChild(el('span', null, (catOf(b.sample).icon || '🔁') + ' ' + b.label));
        r.appendChild(el('b', null, money(b.amount) + '/mo · ' + money(b.amount * 12) + '/yr')); card.appendChild(r);
      });
      var yr = subs.reduce(function (s, b) { return s + b.amount * 12; }, 0);
      card.appendChild(el('p', 'ap-tip', '💡 These cost ' + money(yr) + ' a year. Dropping one you rarely use is the easiest saving there is.'));
    }
    return card;
  }
  function incomeCard(p) {
    if (!p.incomes.length) return null;
    var card = el('section', 'ap-card');
    var h = el('div', 'ap-h'); h.appendChild(el('span', null, '💼 Money coming in')); card.appendChild(h);
    p.incomes.forEach(function (s) {
      var r = el('div', 'ap-bill ' + (s.status === 'paid' ? 'paid' : 'upcoming'));
      r.appendChild(el('span', 'ap-ic', s.status === 'paid' ? '✅' : '⏳'));
      var mid = el('div', 'ap-mid'); mid.appendChild(el('b', null, s.label)); mid.appendChild(el('small', null, 'Usually the ' + s.day + ordinal(s.day))); r.appendChild(mid);
      var right = el('div', 'ap-right'); right.appendChild(el('b', null, money(s.status === 'paid' ? s.paidAmount : s.amount)));
      right.appendChild(el('span', 'ap-when ' + (s.status === 'paid' ? 'paid' : 'upcoming'), s.status === 'paid' ? '✓ Came ' + dFmt.format(new Date(s.paidTs)) : s.daysTo >= 0 ? (s.daysTo === 0 ? 'Expected today' : s.daysTo === 1 ? 'Tomorrow' : 'In ' + s.daysTo + ' days') : 'Expected ' + (-s.daysTo) + 'd ago'));
      r.appendChild(right); card.appendChild(r);
    });
    return card;
  }
  function creepCard(p) {
    var up = p.creep.up.slice(0, 4), down = p.creep.down.slice(0, 3);
    if (!up.length && !down.length) return null;
    var card = el('section', 'ap-card');
    var h = el('div', 'ap-h'); h.appendChild(el('span', null, '📈 Last 30 days vs your usual')); card.appendChild(h);
    function row(x, kind) {
      var r = el('button', 'ap-creep ' + kind); r.type = 'button';
      var ic = el('span', 'ap-ic', x.icon); ic.style.background = (x.color || '#64748b') + '22'; r.appendChild(ic);
      var mid = el('span', 'ap-mid'); mid.appendChild(el('b', null, x.label)); mid.appendChild(el('small', null, money(x.now) + ' vs usual ' + money(x.usual))); r.appendChild(mid);
      r.appendChild(el('span', 'ap-pct ' + kind, (x.pct > 0 ? '▲ ' : '▼ ') + Math.abs(x.pct) + '%'));
      r.addEventListener('click', function () { search(x.label); });
      card.appendChild(r);
    }
    if (up.length) { card.appendChild(el('div', 'ap-k2', 'CREEPING UP')); up.forEach(function (x) { row(x, 'up'); }); }
    if (down.length) { card.appendChild(el('div', 'ap-k2', 'NICELY DOWN')); down.forEach(function (x) { row(x, 'down'); }); }
    if (up.length) card.appendChild(el('p', 'ap-tip', '💡 ' + up[0].label + ' is ' + money(up[0].diff) + ' above usual. Bringing it back saves about ' + money(up[0].diff * 12) + ' a year.'));
    return card;
  }
  function search(label) {
    var home = document.querySelector('.side-link[data-stream="spends"]'); if (home) home.click();
    var inp = $('search'); if (!inp) return;
    inp.value = String(label).split(/[ &,]/)[0].toLowerCase();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () { var b = $('search-all'); if (b && !b.hidden) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
  }

  function render() {
    var root = $('autopilot-root'); if (!root) return;
    var sec = $('autopilot-sec'); if (sec && sec.hidden) return;
    var p = plan();
    root.textContent = '';
    if (!p) { root.appendChild(el('p', 'err', 'Autopilot could not load. Refresh the page.')); return; }
    root.appendChild(heroCard(p));
    [billsCard(p), incomeCard(p), fixedCard(p), creepCard(p)].forEach(function (c) { if (c) root.appendChild(c); });
  }

  window.__autopilot = { plan: plan, render: render };
  document.addEventListener('kharcha:autopilot', function () { memo.v = null; render(); });
  document.addEventListener('kharcha:render', function () { memo.v = null; homeChip(); render(); });
})();
