/* SpendTrack v154: AutoPay radar (More > AutoPay radar).
   Every payment the bank takes on its own: UPI AutoPay mandates, card standing instructions and NACH/ACH debits,
   read from the bank SMS kept with each entry. For each one: what it costs, when the next one is due, and
   anything to act on — a failed debit, a price change, a ₹1 verification charge, or one that has stopped.
   A failed debit that was logged as spending can be taken out of spending (renamed "🔁 Failed · …"; nothing is deleted).
   Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(v) { return K.money(Math.round(v * 100) / 100); }
  var DAY = 864e5;
  var dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  var dayOf = function (ts) { return +new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(ts)); };

  var FAILED = /could\s+not\s+be\s+processed|not\s+processed|\bfailed\b|\bdeclined\b|unsuccessful|insufficient|\brejected\b|\bbounced\b|dishonou?red/i;
  var NOTICE = /(?:will|to)\s+be\s+(?:debited|deducted|charged)|is\s+due\s+(?:by|on)|scheduled\s+(?:on|for)|pre-?debit/i;

  function kindOf(raw) {
    if (/standing\s+instruction/i.test(raw)) return { k: 'card', label: 'Card standing instruction' };
    if (/auto\s?pay|upi[- ]?mandate|e-?mandate|\bmandate\b/i.test(raw)) return { k: 'upi', label: 'UPI AutoPay' };
    if (/\bN?ACH\s*D\b|\bNACH\b|\bECS\b/i.test(raw)) return { k: 'ach', label: 'Bank auto-debit (NACH)' };
    return null;
  }
  function payeeOf(raw) {
    var m = raw.match(/towards\s+(?:Merchant\s+)?(.+?)\s+(?:via|for|to\s+be|as\s+per|is\s+due|on\s+ICICI)\b/i) ||
      raw.match(/to\s+Merchant\s+(.+?),?\s+as\s+per/i) ||
      raw.match(/\bN?ACH\s*D-\s*([A-Za-z][^-]*?)\s*(?:-|\.|$)/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  }
  function keyOf(n) {
    return String(n || '').toLowerCase().replace(/\b(ltd|limited|private|pvt|payments\s+bank|india|in)\b/g, ' ').replace(/[^a-z0-9]/g, '');
  }
  function tidyName(n) {
    return String(n || '').replace(/\b(LTD|LIMITED|PVT|PRIVATE)\b\.?/gi, '').replace(/\s+/g, ' ').trim()
      .replace(/\b([A-Z])([A-Z]+)\b/g, function (_, a, b) { return a + b.toLowerCase(); });
  }
  function labelOf(e, payee) {
    var d = String(K.cleanScopePrefix ? K.cleanScopePrefix(e.desc || '') : e.desc || '').replace(/^[^\wऀ-ॿ₹]+/u, '').trim();
    if (!d || /standing\s+instruction|auto\s?pay|retrieval|^merchant\b/i.test(d)) return tidyName(payee) || 'Automatic payment';
    return d;
  }
  function groupOf(e, label) {
    if (K.isInvestment && K.isInvestment(e)) return 'invest';
    if (/\bemi\b|\bloan\b/i.test(label + ' ' + (e.desc || ''))) return 'loan';
    if ((K.isTransferEntry && K.isTransferEntry(e)) || e.kind === 'transfer') return 'move';
    return 'bill';
  }
  var GROUPS = [['bill', '🧾 Bills and subscriptions'], ['loan', '🏠 Loans'], ['invest', '📈 Investments'], ['move', '🔁 Card and Pay Later bills']];

  function scan() {
    var entries = (K.getEntries && K.getEntries()) || [], now = Date.now(), byPayee = {}, failedSpend = [];
    entries.forEach(function (e) {
      if (!e || e.synthetic || !e.raw || (K.isIncome && K.isIncome(e))) return;
      var raw = String(e.raw), kind = kindOf(raw); if (!kind) return;
      var payee = payeeOf(raw) || String(e.desc || ''), key = keyOf(payee); if (!key) return;
      var status = FAILED.test(raw) ? 'failed' : NOTICE.test(raw) ? 'notice' : 'ok';
      var counted = !!(K.isExpense && K.isExpense(e)) || !!(K.isInvestment && K.isInvestment(e));
      if (status === 'failed' && counted && !(K.isTransferEntry && K.isTransferEntry(e))) failedSpend.push(e);
      (byPayee[key] = byPayee[key] || { payee: payee, kind: kind, ev: [] }).ev.push({ e: e, ts: e.ts, amount: +e.amount || 0, status: status, counted: counted });
    });
    var out = [];
    Object.keys(byPayee).forEach(function (k) {
      var p = byPayee[k];
      p.ev.sort(function (a, b) { return a.ts - b.ts; });
      // One payee can hold several mandates (four ₹10,000 SIPs on the 1st, 7th, 7th and 8th): split by day of month,
      // and a second charge in the same month on the same day is a second mandate.
      var clusters = [];
      p.ev.forEach(function (v) {
        var dom = dayOf(v.ts), mk = new Date(v.ts).getFullYear() * 12 + new Date(v.ts).getMonth();
        var c = clusters.filter(function (c) {
          var dd = Math.abs(c.dom - dom); dd = Math.min(dd, 31 - dd);
          var sameMonth = c.ev.some(function (x) { return x.status !== 'failed' && v.status !== 'failed' && x.mk === mk; });
          return dd <= 3 && !sameMonth && (!c.amt || Math.abs(v.amount - c.amt) <= Math.max(2, c.amt * 0.25));
        })[0];
        if (!c) { c = { dom: dom, amt: 0, ev: [] }; clusters.push(c); }
        v.mk = mk; c.ev.push(v); if (v.status !== 'failed') c.amt = v.amount;
      });
      clusters.forEach(function (c, i) { out.push(build(p, c, clusters.length > 1 ? i + 1 : 0, now)); });
    });
    out.sort(function (a, b) { return (a.nextTs || 9e15) - (b.nextTs || 9e15); });
    return { list: out, failedSpend: failedSpend.sort(function (a, b) { return b.ts - a.ts; }) };
  }

  function build(p, c, n, now) {
    var ok = c.ev.filter(function (v) { return v.status === 'ok' || (v.status === 'notice' && v.counted); });
    var last = ok[ok.length - 1] || null, prev = ok[ok.length - 2] || null, lastEv = c.ev[c.ev.length - 1];
    var sample = (last || lastEv).e, label = labelOf(sample, p.payee) + (n ? ' (' + ordinal(c.dom) + ')' : '');
    var gaps = [];
    for (var i = 1; i < ok.length; i++) gaps.push((ok[i].ts - ok[i - 1].ts) / DAY);
    gaps.sort(function (a, b) { return a - b; });
    var gap = gaps.length ? gaps[gaps.length >> 1] : 0;
    var cadence = !ok.length ? '' : gap > 300 ? 'yearly' : gap > 75 ? 'quarterly' : gap >= 25 || ok.length === 1 ? 'monthly' : gap >= 5 ? 'weekly' : 'monthly';
    var stepDays = { yearly: 365, quarterly: 91, monthly: 0, weekly: 7 }[cadence];
    var nextTs = null;
    if (last) {
      if (cadence === 'monthly') { var d = new Date(last.ts); d.setMonth(d.getMonth() + 1); while (d.getTime() < now - 3 * DAY) d.setMonth(d.getMonth() + 1); nextTs = d.getTime(); }
      else if (stepDays) { nextTs = last.ts + stepDays * DAY; while (nextTs < now - 3 * DAY) nextTs += stepDays * DAY; }
    }
    var expectEvery = cadence === 'monthly' ? 31 : stepDays || 31;
    var flags = [];
    if (lastEv.status === 'failed') flags.push({ t: 'bad', m: 'Last debit FAILED on ' + dFmt.format(new Date(lastEv.ts)) + ' (' + money(lastEv.amount) + '). Check the ' + (p.kind.k === 'card' ? 'card' : 'account') + ', or the service may stop.' });
    var stopped = !!(last && now - last.ts > expectEvery * 1.6 * DAY && now - last.ts > 40 * DAY);
    var trial = !!(ok.length && ok.every(function (v) { return v.amount <= 2; }));
    if (stopped) flags.push({ t: 'warn', m: 'No charge since ' + dFmt.format(new Date(last.ts)) + '. Stopped? If you no longer use it, cancel the mandate in your bank app.' });
    if (trial) flags.push({ t: 'info', m: 'Only ₹1 checks so far. That is how a new mandate is set up; real charges usually follow. Cancel it if you did not mean to subscribe.' });
    if (last && prev && Math.abs(last.amount - prev.amount) >= Math.max(5, prev.amount * 0.03)) flags.push({ t: last.amount > prev.amount ? 'warn' : 'good', m: (last.amount > prev.amount ? 'Price went up ' : 'Price went down ') + money(Math.abs(last.amount - prev.amount)) + ': ' + money(prev.amount) + ' → ' + money(last.amount) + '.' });
    if (!last && lastEv.status === 'notice') flags.push({ t: 'info', m: 'Bank says ' + money(lastEv.amount) + ' will be taken soon.' });
    var perYear = last ? last.amount * ({ yearly: 1, quarterly: 4, monthly: 12, weekly: 52 }[cadence] || 12) : 0;
    return { label: label, kind: p.kind, cadence: cadence, last: last, nextTs: nextTs, flags: flags, perYear: perYear, group: groupOf(sample, label), events: c.ev, failed: lastEv.status === 'failed', stopped: stopped, trial: trial };
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------- page ---------- */
  function render() {
    var root = $('autopay-root'); if (!root) return;
    var sec = $('autopay-sec'); if (sec && sec.hidden) return;
    root.textContent = '';
    var s = scan(), list = s.list;
    var hero = el('div', 'rd-hero');
    hero.appendChild(el('h2', null, '🛰️ AutoPay radar'));
    var active = list.filter(function (m) { return m.last && !m.stopped && !m.failed && !m.trial; });
    var perMonth = function (g) { return active.filter(function (m) { return g(m.group); }).reduce(function (t, m) { return t + m.perYear / 12; }, 0); };
    var bills = perMonth(function (g) { return g === 'bill' || g === 'loan'; }), invest = perMonth(function (g) { return g === 'invest'; });
    var rupees = function (v) { return K.money(Math.round(v)); };
    hero.appendChild(el('p', 'rd-big', active.length ? rupees(bills) + ' a month' : 'Nothing found yet'));
    hero.appendChild(el('p', 'rd-sub', active.length ? 'in bills, subscriptions and EMIs the bank takes by itself (' + rupees(bills * 12) + ' a year)' +
      (invest ? ' · plus ' + rupees(invest) + ' a month into investments' : '') + ' · ' + active.length + ' active'
      : 'Payments by UPI AutoPay, card standing instruction or NACH appear here once their bank SMS arrive.'));
    root.appendChild(hero);

    var alerts = [];
    list.forEach(function (m) { m.flags.forEach(function (f) { if (f.t === 'bad' || f.t === 'warn') alerts.push({ m: m, f: f }); }); });
    if (s.failedSpend.length) root.appendChild(failedCard(s.failedSpend));
    if (alerts.length) {
      var ac = el('div', 'rd-card rd-alerts'); ac.appendChild(el('h3', null, '⚠️ Needs a look'));
      alerts.forEach(function (a) { var r = el('div', 'rd-alert ' + a.f.t); r.appendChild(el('b', null, a.m.label)); r.appendChild(el('span', null, a.f.m)); ac.appendChild(r); });
      root.appendChild(ac);
    }
    var soon = list.filter(function (m) { return m.nextTs && m.nextTs - Date.now() <= 10 * DAY && !m.failed && !m.stopped && !m.trial; });
    if (soon.length) {
      var sc = el('div', 'rd-card'); sc.appendChild(el('h3', null, '📅 Next 10 days'));
      soon.forEach(function (m) { sc.appendChild(row(m, true)); });
      root.appendChild(sc);
    }
    GROUPS.forEach(function (g) {
      var items = list.filter(function (m) { return m.group === g[0]; }); if (!items.length) return;
      var c = el('div', 'rd-card'); c.appendChild(el('h3', null, g[1]));
      items.forEach(function (m) { c.appendChild(row(m, false)); });
      root.appendChild(c);
    });
    root.appendChild(el('p', 'rd-note', 'Found from your bank SMS. To stop a mandate: UPI AutoPay in your UPI app (Autopay / Mandates), card standing instructions on the card\'s website, NACH with your bank.'));
  }
  function row(m, short) {
    var r = el('div', 'rd-row' + (m.failed ? ' failed' : ''));
    var mid = el('div', 'rd-mid'); mid.appendChild(el('b', null, m.label));
    var bits = [m.kind.label];
    if (m.cadence) bits.push(m.cadence);
    if (m.last) bits.push('last ' + dFmt.format(new Date(m.last.ts)));
    if (m.nextTs && !m.failed && !m.stopped) bits.push((m.nextTs < Date.now() - DAY ? 'expected ~' + dFmt.format(new Date(m.nextTs)) + ', not seen yet' : 'next ~' + dFmt.format(new Date(m.nextTs))));
    mid.appendChild(el('small', null, bits.join(' · ')));
    if (!short) m.flags.forEach(function (f) { mid.appendChild(el('span', 'rd-flag ' + f.t, f.m)); });
    r.appendChild(mid);
    var right = el('div', 'rd-amt'); right.appendChild(el('b', null, m.last ? money(m.last.amount) : '—'));
    if (m.perYear && !short) right.appendChild(el('small', null, money(m.perYear) + '/yr'));
    r.appendChild(right);
    return r;
  }
  function failedCard(list) {
    var c = el('div', 'rd-card rd-alerts'); c.appendChild(el('h3', null, '❌ Failed debits counted as spending'));
    c.appendChild(el('p', 'rd-sub', 'The bank said these did not go through, but they were logged as money spent. Take them out of spending so your totals are right (the entry is renamed, not deleted).'));
    list.forEach(function (e) {
      var r = el('div', 'rd-row failed'), mid = el('div', 'rd-mid');
      mid.appendChild(el('b', null, labelOf(e, payeeOf(String(e.raw))))); mid.appendChild(el('small', null, dFmt.format(new Date(e.ts)) + ' · ' + money(e.amount)));
      r.appendChild(mid);
      var b = el('button', 'scope-pill rd-fix', 'Not spent'); b.type = 'button';
      b.addEventListener('click', function () {
        var nd = ('🔁 Failed · ' + labelOf(e, payeeOf(String(e.raw)))).slice(0, 50);
        K.confirmBox({ title: 'Take ' + money(e.amount) + ' out of spending?', message: 'This debit failed, so no money left your account. It stays in your list as "' + nd + '".', confirmText: 'Take it out',
          onConfirm: function () {
            b.disabled = true;
            K.store.update(e.id, { amount: e.amount, desc: nd, spent_at: new Date(e.ts).toISOString() }).then(function (row2) {
              e.desc = (row2 && (row2.description || row2.desc)) || nd; K.toast('Done: ' + money(e.amount) + ' is no longer counted as spending.'); if (K.rerender) K.rerender(); render();
            }).catch(function (err) { b.disabled = false; K.toast('Could not update it: ' + ((err && err.message) || err)); });
          } });
      });
      r.appendChild(b); c.appendChild(r);
    });
    return c;
  }

  window.__autopay = { scan: scan, render: render, _t: { kindOf: kindOf, payeeOf: payeeOf, keyOf: keyOf, FAILED: FAILED, NOTICE: NOTICE } };
  document.addEventListener('kharcha:autopay', render);
  document.addEventListener('kharcha:render', function () { var sec = $('autopay-sec'); if (sec && !sec.hidden) render(); });
})();
