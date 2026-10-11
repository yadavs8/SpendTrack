/* Kharcha Book: pure logic for (1) trip settle-up and (2) the lent / borrowed ledger.
   No DOM and no Supabase in here, so it runs in the browser (window.KharchaLedger) and in Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KharchaLedger = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function toPaise(x) { return Math.round(Number(x) * 100); }
  function cmpName(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /* ---------- trip settle-up ---------- */

  // Splits totalPaise into n whole-paise shares that add up exactly (first r people get the extra paisa).
  function splitPaise(totalPaise, n) {
    var base = Math.floor(totalPaise / n), r = totalPaise - base * n, out = [];
    for (var i = 0; i < n; i++) out.push(base + (i < r ? 1 : 0));
    return out;
  }

  // Removes the app's tags from a trip entry description so it reads as "Hotel", not "✈️ Goa: Hotel [Paid by Rahul]".
  function tripItemLabel(desc) {
    var t = String(desc || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/(?:✈️|✈|🤝|👤|🧑)/g, ' ')
      .replace(/^\s*trip\s*:\s*/i, '')
      .replace(/\s+/g, ' ').trim();
    var colon = t.indexOf(':');
    if (colon > 0 && colon < 30 && t.slice(colon + 1).trim()) t = t.slice(colon + 1).trim();
    return t || 'Expense';
  }

  /* expenses: [{ id, label, amount (rupees), payer }]; participants: [names]. Everyone splits every expense equally.
     Returns:
       people:    [{ name, paid, share, net }]   net > 0 gets money back, net < 0 owes
       transfers: fewest payments that settle everyone [{ from, to, amount }]
       pairs:     for each pair, what one owes the other after offsetting, with the reasons
                  [{ from, to, amount, items: [{ label, amount, kind: 'owes' | 'offset' }] }] */
  function tripSettlement(expenses, participants) {
    var names = [];
    (participants || []).forEach(function (n) { if (n && names.indexOf(n) < 0) names.push(n); });
    (expenses || []).forEach(function (e) { if (e.payer && names.indexOf(e.payer) < 0) names.push(e.payer); });
    var paid = {}, share = {}, directed = {};
    names.forEach(function (n) { paid[n] = 0; share[n] = 0; });
    var n = names.length;

    (expenses || []).forEach(function (e) {
      if (!n) return;
      var p = toPaise(e.amount);
      if (!(p > 0)) return;
      paid[e.payer] += p;
      var shares = splitPaise(p, n);
      names.forEach(function (q, i) {
        share[q] += shares[i];
        if (q === e.payer || shares[i] === 0) return;
        var k = q + '\u0000' + e.payer;
        if (!directed[k]) directed[k] = { from: q, to: e.payer, total: 0, items: [] };
        directed[k].total += shares[i];
        directed[k].items.push({ label: e.label || 'Expense', paise: shares[i] });
      });
    });

    var people = names.map(function (name) {
      return { name: name, paid: paid[name] / 100, share: share[name] / 100, net: (paid[name] - share[name]) / 100 };
    });

    // fewest payments: largest debtor pays largest creditor until everyone is square
    var cred = [], debt = [];
    names.forEach(function (name) {
      var net = paid[name] - share[name];
      if (net > 0) cred.push({ name: name, p: net }); else if (net < 0) debt.push({ name: name, p: -net });
    });
    function bySize(a, b) { return b.p - a.p || cmpName(a.name, b.name); }
    cred.sort(bySize); debt.sort(bySize);
    var transfers = [], i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      var amt = Math.min(debt[i].p, cred[j].p);
      transfers.push({ from: debt[i].name, to: cred[j].name, amount: amt / 100 });
      debt[i].p -= amt; cred[j].p -= amt;
      if (debt[i].p === 0) i++;
      if (cred[j].p === 0) j++;
    }

    // pair view: offset A->B against B->A, keep the reasons
    var seen = {}, pairs = [];
    Object.keys(directed).forEach(function (k) {
      var d = directed[k];
      var key = [d.from, d.to].sort(cmpName).join('\u0000');
      if (seen[key]) return;
      seen[key] = true;
      var back = directed[d.to + '\u0000' + d.from];
      var net = d.total - (back ? back.total : 0);
      if (net === 0) return;
      var win = net > 0 ? d : back, lose = net > 0 ? back : d;
      var items = win.items.map(function (it) { return { label: it.label, amount: it.paise / 100, kind: 'owes' }; });
      if (lose) lose.items.forEach(function (it) { items.push({ label: it.label, amount: it.paise / 100, kind: 'offset' }); });
      items.sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === 'owes' ? -1 : 1) || b.amount - a.amount || cmpName(a.label, b.label); });
      pairs.push({ from: win.from, to: win.to, amount: Math.abs(net) / 100, items: items });
    });
    pairs.sort(function (a, b) { return b.amount - a.amount || cmpName(a.from, b.from); });

    return { people: people, transfers: transfers, pairs: pairs };
  }

  /* ---------- lent / borrowed ledger ----------
     loan: { id, person, kind: 'lent' | 'borrowed', amount, note, ts, payments: [{ id, amount, ts, note }] }
     'lent'     = I gave money, they owe me.   'borrowed' = they gave me money, I owe them. */

  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
  function nameKey(s) { return cleanName(s).toLowerCase(); }

  function parseLoans(json) {
    var arr;
    try { arr = JSON.parse(json || '[]'); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (l) {
      return l && typeof l.id === 'string' && cleanName(l.person) && (l.kind === 'lent' || l.kind === 'borrowed') &&
        isFinite(l.amount) && l.amount > 0 && isFinite(l.ts);
    }).map(function (l) {
      return {
        id: l.id, person: cleanName(l.person), kind: l.kind, amount: Number(l.amount), note: String(l.note || '').slice(0, 80), ts: Number(l.ts),
        payments: (Array.isArray(l.payments) ? l.payments : []).filter(function (p) { return p && typeof p.id === 'string' && isFinite(p.amount) && p.amount > 0 && isFinite(p.ts); })
          .map(function (p) { return { id: p.id, amount: Number(p.amount), ts: Number(p.ts), note: String(p.note || '').slice(0, 80) }; })
      };
    });
  }

  function repaid(loan) { return loan.payments.reduce(function (s, p) { return s + toPaise(p.amount); }, 0) / 100; }
  function outstanding(loan) { return Math.max(0, (toPaise(loan.amount) - toPaise(repaid(loan))) / 100); }

  // Records a repayment. Refuses more than what is still owed so the balance never goes negative by accident.
  function addPayment(loan, amount, ts, id, note) {
    var p = toPaise(amount);
    if (!(p > 0)) return { error: 'Enter an amount greater than zero.' };
    var left = toPaise(outstanding(loan));
    if (p > left) return { error: 'That is more than the ₹' + (left / 100).toLocaleString('en-IN') + ' still pending.' };
    var next = Object.assign({}, loan, { payments: loan.payments.concat([{ id: id, amount: p / 100, ts: ts, note: String(note || '').slice(0, 80) }]) });
    return { loan: next };
  }

  /* Per person: what they owe me, what I owe them, and the net. Names match ignoring case and spacing. */
  function summarize(loans) {
    var map = {}, order = [];
    loans.forEach(function (l) {
      var k = nameKey(l.person);
      if (!map[k]) { map[k] = { key: k, name: l.person, owedToMe: 0, iOwe: 0, loans: [], lastTs: 0 }; order.push(k); }
      var m = map[k], left = toPaise(outstanding(l));
      if (l.ts >= m.lastTs) { m.lastTs = l.ts; m.name = l.person; }
      if (l.kind === 'lent') m.owedToMe += left; else m.iOwe += left;
      m.loans.push(l);
    });
    var people = order.map(function (k) {
      var m = map[k];
      m.loans.sort(function (a, b) { return b.ts - a.ts; });
      return { key: m.key, name: m.name, owedToMe: m.owedToMe / 100, iOwe: m.iOwe / 100, net: (m.owedToMe - m.iOwe) / 100, loans: m.loans, lastTs: m.lastTs };
    });
    people.sort(function (a, b) { return (b.owedToMe + b.iOwe) - (a.owedToMe + a.iOwe) || cmpName(a.name.toLowerCase(), b.name.toLowerCase()); });
    var totalOwed = people.reduce(function (s, p) { return s + toPaise(p.owedToMe); }, 0) / 100;
    var totalIOwe = people.reduce(function (s, p) { return s + toPaise(p.iOwe); }, 0) / 100;
    return { people: people, totalOwedToMe: totalOwed, totalIOwe: totalIOwe, net: (toPaise(totalOwed) - toPaise(totalIOwe)) / 100 };
  }

  return {
    splitPaise: splitPaise, tripItemLabel: tripItemLabel, tripSettlement: tripSettlement,
    cleanName: cleanName, nameKey: nameKey, parseLoans: parseLoans, repaid: repaid, outstanding: outstanding,
    addPayment: addPayment, summarize: summarize
  };
});
