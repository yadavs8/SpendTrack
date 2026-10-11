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

  // Corrects a loan (amount, name, note, date). The amount may not drop below what has already been repaid.
  function editLoan(loan, patch) {
    var amt = patch.amount == null ? loan.amount : patch.amount;
    var p = toPaise(amt);
    if (!(p > 0)) return { error: 'Enter an amount greater than zero.' };
    var paid = toPaise(repaid(loan));
    if (p < paid) return { error: 'Already repaid ₹' + (paid / 100).toLocaleString('en-IN') + ', so the amount cannot be lower than that.' };
    var who = patch.person == null ? loan.person : cleanName(patch.person);
    if (!who) return { error: 'Add the person’s name.' };
    return { loan: Object.assign({}, loan, {
      amount: p / 100, person: who,
      note: patch.note == null ? loan.note : String(patch.note).slice(0, 80),
      ts: patch.ts == null ? loan.ts : patch.ts
    }) };
  }
  // Corrects one repayment. Repayments together may not exceed the loan.
  function editPayment(loan, payId, patch) {
    var cur = loan.payments.filter(function (x) { return x.id === payId; })[0];
    if (!cur) return { error: 'That repayment no longer exists.' };
    var p = toPaise(patch.amount == null ? cur.amount : patch.amount);
    if (!(p > 0)) return { error: 'Enter an amount greater than zero.' };
    var others = loan.payments.reduce(function (s, x) { return x.id === payId ? s : s + toPaise(x.amount); }, 0);
    if (others + p > toPaise(loan.amount)) return { error: 'That would be more than the ₹' + (toPaise(loan.amount) / 100).toLocaleString('en-IN') + ' lent.' };
    return { loan: Object.assign({}, loan, { payments: loan.payments.map(function (x) {
      return x.id === payId ? { id: x.id, amount: p / 100, ts: patch.ts == null ? x.ts : patch.ts, note: x.note } : x;
    }) }) };
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


  /* ---------- prepaid wallets (Amazon Pay, Paytm, ...) ----------
     Entries are ordinary rows whose text starts with a marker, so this works on the live table as it is:
       "👛➕ Amazon Pay · ICICI card XX1014"   money moved INTO the wallet (not spending)
       "👛 Amazon Pay · Blinkit groceries"     a purchase paid from the wallet (counts as spending)
     balance = opening balance + top-ups - wallet purchases, counted from the day tracking started. */
  var W_UP = '👛➕', W_SP = '👛';

  function walletTopupDesc(name, note) { return W_UP + ' ' + cleanName(name) + (note ? ' · ' + String(note).trim() : ''); }
  function walletSpendDesc(name, what) { return W_SP + ' ' + cleanName(name) + (what ? ' · ' + String(what).trim() : ''); }

  function parseWalletDesc(desc) {
    var d = String(desc || '').trim(), kind, rest;
    if (d.indexOf(W_UP) === 0) { kind = 'topup'; rest = d.slice(W_UP.length); }
    else if (d.indexOf(W_SP) === 0) { kind = 'spend'; rest = d.slice(W_SP.length); }
    else return null;
    var dot = rest.indexOf('·');
    var name = cleanName(dot >= 0 ? rest.slice(0, dot) : rest);
    if (!name) return null;
    return { kind: kind, wallet: name, note: dot >= 0 ? rest.slice(dot + 1).trim() : '' };
  }

  function parseWallets(json) {
    var arr;
    try { arr = JSON.parse(json || '[]'); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (w) { return w && typeof w.id === 'string' && cleanName(w.name) && isFinite(w.opening) && isFinite(w.since); })
      .map(function (w) { return { id: w.id, name: cleanName(w.name), opening: Number(w.opening), since: Number(w.since) }; });
  }

  // entries: [{ id, amount, desc, ts }]. Only rows on/after wallet.since count.
  function walletState(entries, wallet) {
    var key = nameKey(wallet.name), up = 0, sp = 0, items = [];
    (entries || []).forEach(function (e) {
      if (!e || !(e.ts >= wallet.since)) return;
      var p = parseWalletDesc(e.desc);
      if (!p || nameKey(p.wallet) !== key) return;
      var a = toPaise(e.amount);
      if (p.kind === 'topup') up += a; else sp += a;
      items.push({ id: e.id, ts: e.ts, amount: a / 100, kind: p.kind, note: p.note });
    });
    items.sort(function (a, b) { return b.ts - a.ts; });
    var open = toPaise(wallet.opening);
    return { opening: open / 100, topups: up / 100, spent: sp / 100, balance: (open + up - sp) / 100, items: items };
  }

  // Compares the tracked balance with what the wallet app really shows.
  function walletReconcile(tracked, actual) {
    var diff = toPaise(tracked) - toPaise(actual);
    if (diff === 0) return { kind: 'match', amount: 0 };
    return diff > 0 ? { kind: 'spent', amount: diff / 100 } : { kind: 'extra', amount: -diff / 100 };
  }

  /* ---------- pay cycles ----------
     Salary arrives on the last working day, so it pays for the NEXT stretch of spending. A pay cycle runs from one
     payday (an entry that matches the anchor, normally "Salary 1") up to, but not including, the next payday. */
  function payCycles(entries, isAnchor) {
    var anchors = (entries || []).filter(function (e) { return e && !e.synthetic && isAnchor(e); })
      .map(function (e) { return e.ts; }).sort(function (a, b) { return a - b; });
    var bounds = [];
    anchors.forEach(function (t) { if (!bounds.length || t - bounds[bounds.length - 1] > 7 * 86400000) bounds.push(t); });
    var out = bounds.map(function (s, i) { return { start: s, end: i + 1 < bounds.length ? bounds[i + 1] : null }; });
    return out.reverse();                              // newest first; end === null means the cycle is still running
  }
  // Last Monday-Friday of a month (month is 0-based). Bank holidays are not known, so it can be a day early.
  function lastWorkingDay(year, month) {
    var d = new Date(year, month + 1, 0, 12);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d;
  }
  function nextPayday(nowTs) {
    var n = new Date(nowTs), today = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12);
    var d = lastWorkingDay(n.getFullYear(), n.getMonth());
    if (d.getTime() < today.getTime()) d = lastWorkingDay(n.getFullYear(), n.getMonth() + 1);
    return { date: d, days: Math.round((d.getTime() - today.getTime()) / 86400000) };
  }

  /* ---------- bank balance ----------
     account: { id, name, snapshots: [{ ts, balance }] }. The estimate starts from the newest snapshot (a balance you
     typed in) and adds the money in and takes off the money out that was logged after it. */
  function parseBank(json) {
    var arr;
    try { arr = JSON.parse(json || '[]'); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (a) { return a && typeof a.id === 'string' && cleanName(a.name) && Array.isArray(a.snapshots); })
      .map(function (a) {
        return {
          id: a.id, name: cleanName(a.name),
          held: Array.isArray(a.held) ? a.held.filter(function (x) { return typeof x === 'string'; }) : [],
          deposits: Array.isArray(a.deposits) ? a.deposits.filter(function (d) { return d && isFinite(d.ts) && isFinite(d.amount) && d.amount > 0; })
            .map(function (d) { return { ts: Number(d.ts), amount: Number(d.amount), label: String(d.label || ''), ref: d.ref ? String(d.ref) : '' }; }) : [],
          snapshots: a.snapshots.filter(function (s) { return s && isFinite(s.ts) && isFinite(s.balance); })
            .map(function (s) { return { ts: Number(s.ts), balance: Number(s.balance) }; }).sort(function (x, y) { return x.ts - y.ts; })
        };
      }).filter(function (a) { return a.snapshots.length; });
  }
  function bankEstimate(entries, acct, isIn, isOut) {
    var snap = acct.snapshots[acct.snapshots.length - 1], inP = 0, outP = 0, items = [], heldP = 0;
    var held = acct.held || [];
    (entries || []).forEach(function (e) {
      if (!e || e.synthetic || !(e.ts > snap.ts)) return;
      var a = toPaise(e.amount);
      if (isIn(e) && held.indexOf(e.id) >= 0) {
        var dep = (acct.deposits || []).some(function (d) { return d.ref === e.id; });
        if (!dep) heldP += a;
      }
      else if (isIn(e)) { inP += a; items.push({ id: e.id, ts: e.ts, amount: a / 100, kind: 'in', label: e.desc }); }
      else if (isOut(e)) { outP += a; items.push({ id: e.id, ts: e.ts, amount: a / 100, kind: 'out', label: e.desc }); }
    });
    (acct.deposits || []).forEach(function (d) {
      if (!(d.ts > snap.ts)) return;
      var a = toPaise(d.amount); inP += a;
      items.push({ id: 'dep' + d.ts, ts: d.ts, amount: a / 100, kind: 'in', label: d.label || 'Cash deposited' });
    });
    items.sort(function (x, y) { return y.ts - x.ts; });
    var start = toPaise(snap.balance);
    return { since: snap.ts, startBalance: snap.balance, income: inP / 100, cashHeld: heldP / 100, spent: outP / 100, balance: (start + inP - outP) / 100, items: items };
  }

  /* ---------- smart rules: payees, monthly payments, which bank ----------
     rule: { id, name, words: [text found in the payee/description], day (1-31 or 0), amount (0 = ask), scope, acct (account name or '' = main) } */
  function parseRules(json) {
    var arr;
    try { arr = JSON.parse(json); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    return arr.filter(function (r) { return r && typeof r.id === 'string' && cleanName(r.name); }).map(function (r) {
      var day = Math.round(Number(r.day)); if (!(day >= 1 && day <= 31)) day = 0;
      var amt = Number(r.amount); if (!(amt > 0)) amt = 0;
      return {
        id: r.id, name: cleanName(r.name), day: day, amount: amt,
        words: (Array.isArray(r.words) ? r.words : []).map(function (w) { return String(w).toLowerCase().replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 8),
        scope: ['personal', 'family', 'investment'].indexOf(r.scope) >= 0 ? r.scope : 'personal',
        acct: cleanName(r.acct)
      };
    });
  }
  function defaultRules() {
    return [
      { id: 'r-emi', name: 'Flat EMI', words: ['emi', 'flat emi', 'home loan'], day: 5, amount: 0, scope: 'personal', acct: 'HDFC' },
      { id: 'r-niece', name: 'Niece allowance', words: ['priyanka mehta', 'priyanka', 'bhabi'], day: 1, amount: 5000, scope: 'family', acct: '' },
      { id: 'r-milk', name: 'Milk vendor', words: ['jagroop', 'shoshri chand'], day: 1, amount: 0, scope: 'family', acct: '' }
    ];
  }
  function wordIn(text, w) {
    var esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)').test(text);
  }
  function matchRule(desc, rules) {
    var d = String(desc || '').toLowerCase();
    for (var i = 0; i < (rules || []).length; i++) {
      var r = rules[i], keys = r.words.concat([r.name.toLowerCase()]);
      for (var j = 0; j < keys.length; j++) if (keys[j] && wordIn(d, keys[j])) return r;
    }
    return null;
  }
  // Rules with a day of the month that are due now and have no matching entry yet this month.
  function dueRules(rules, entries, nowMs, skips) {
    var now = new Date(nowMs), y = now.getFullYear(), m = now.getMonth(), dim = new Date(y, m + 1, 0).getDate();
    var mk = y + '-' + (m + 1), start = new Date(y, m, 1).getTime(), out = [];
    (rules || []).forEach(function (r) {
      if (!r.day || (skips && skips[r.id] === mk)) return;
      if (now.getDate() < Math.min(r.day, dim)) return;
      var hits = (entries || []).filter(function (e) { return e && !e.synthetic && matchRule(e.desc, [r]); }).sort(function (a, b) { return b.ts - a.ts; });
      if (hits.some(function (e) { return e.ts >= start; })) return;
      out.push({ rule: r, amount: r.amount || (hits[0] ? hits[0].amount : 0), monthKey: mk });
    });
    return out;
  }
  /* Which tracked account an entry belongs to: an explicit choice (map) wins, then a rule's bank, then the main account.
     Returns null when it is not a bank movement of any tracked account (wallet, or a bank you do not track). */
  function routeAccount(entry, accts, map, rules, primaryId) {
    var ids = accts.map(function (a) { return a.id; });
    var pick = map && map[entry.id];
    if (pick === 'none') return null;
    if (pick === 'cash') return ids.indexOf(primaryId) >= 0 ? primaryId : null;
    if (pick && ids.indexOf(pick) >= 0) return pick;
    var r = matchRule(entry.desc, rules);
    if (r && r.acct) {
      var key = nameKey(r.acct), hit = accts.filter(function (a) { return nameKey(a.name).indexOf(key) >= 0; })[0];
      return hit ? hit.id : null;
    }
    return ids.indexOf(primaryId) >= 0 ? primaryId : (ids[0] || null);
  }

  return {
    parseRules: parseRules, defaultRules: defaultRules, matchRule: matchRule, dueRules: dueRules, routeAccount: routeAccount,
    splitPaise: splitPaise, tripItemLabel: tripItemLabel, tripSettlement: tripSettlement,
    cleanName: cleanName, nameKey: nameKey, parseLoans: parseLoans, repaid: repaid, outstanding: outstanding,
    addPayment: addPayment, editLoan: editLoan, editPayment: editPayment, summarize: summarize,
    walletTopupDesc: walletTopupDesc, walletSpendDesc: walletSpendDesc, parseWalletDesc: parseWalletDesc,
    parseWallets: parseWallets, walletState: walletState, walletReconcile: walletReconcile,
    payCycles: payCycles, lastWorkingDay: lastWorkingDay, nextPayday: nextPayday, parseBank: parseBank, bankEstimate: bankEstimate
  };
});
