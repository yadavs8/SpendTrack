// Run: node web/kharcha-book/test-ledger.js
const assert = require('assert');
const L = require('./ledger-logic.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('splitPaise adds up exactly', () => {
  assert.deepStrictEqual(L.splitPaise(1000, 3), [334, 333, 333]);
  assert.strictEqual(L.splitPaise(1, 3).reduce((a, b) => a + b, 0), 1);
});

t('tripItemLabel strips the app tags', () => {
  assert.strictEqual(L.tripItemLabel('✈️ Goa: Hotel [Paid by Rahul]'), 'Hotel');
  assert.strictEqual(L.tripItemLabel('Trip: Manali cab'), 'Manali cab');
  assert.strictEqual(L.tripItemLabel('✈️'), 'Expense');
});

const exp = [
  { label: 'Hotel', amount: 9000, payer: 'Rahul' },
  { label: 'Cab', amount: 3000, payer: 'Amit' },
  { label: 'Food', amount: 1500, payer: 'Me' }
];
const people = ['Me', 'Rahul', 'Amit'];

t('equal share, balances and fewest payments', () => {
  const r = L.tripSettlement(exp, people);
  const by = Object.fromEntries(r.people.map(p => [p.name, p]));
  assert.strictEqual(by.Me.share, 4500);
  assert.strictEqual(by.Rahul.net, 4500);
  assert.strictEqual(by.Amit.net, -1500);
  assert.strictEqual(by.Me.net, -3000);
  assert.deepStrictEqual(r.transfers, [
    { from: 'Me', to: 'Rahul', amount: 3000 },
    { from: 'Amit', to: 'Rahul', amount: 1500 }
  ]);
});

t('pair view offsets both ways and keeps the reasons', () => {
  const r = L.tripSettlement(exp, people);
  const p = r.pairs.find(x => x.from === 'Me' && x.to === 'Rahul');
  assert.strictEqual(p.amount, 2500);
  assert.deepStrictEqual(p.items.map(i => [i.label, i.amount, i.kind]), [['Hotel', 3000, 'owes'], ['Food', 500, 'offset']]);
  // each person's pair amounts add up to their balance
  const net = {};
  r.pairs.forEach(x => { net[x.from] = (net[x.from] || 0) - x.amount; net[x.to] = (net[x.to] || 0) + x.amount; });
  r.people.forEach(pp => assert.strictEqual(net[pp.name] || 0, pp.net));
});

t('odd amounts never lose a paisa', () => {
  const r = L.tripSettlement([{ label: 'Snacks', amount: 100, payer: 'Me' }], ['Me', 'A', 'B']);
  assert.strictEqual(r.people.reduce((s, p) => s + Math.round(p.net * 100), 0), 0);
  assert.strictEqual(Math.round(r.transfers.reduce((s, x) => s + x.amount, 0) * 100), 6666); // others owe 33.33 + 33.33
});

t('a payer who is not listed is added; empty trip is quiet', () => {
  const r = L.tripSettlement([{ label: 'Taxi', amount: 300, payer: 'Zoya' }], ['Me']);
  assert.deepStrictEqual(r.transfers, [{ from: 'Me', to: 'Zoya', amount: 150 }]);
  assert.deepStrictEqual(L.tripSettlement([], ['Me']).transfers, []);
});

t('everyone square gives no transfers', () => {
  const r = L.tripSettlement([{ label: 'A', amount: 100, payer: 'Me' }, { label: 'B', amount: 100, payer: 'X' }], ['Me', 'X']);
  assert.deepStrictEqual(r.transfers, []);
  assert.deepStrictEqual(r.pairs, []);
});

t('upiPayLink, settleMessage, and whatsappLink helpers format correctly', () => {
  const link = L.upiPayLink('sanjeev@okhdfcbank', 'Sanjeev', 1500, 'Manali trip');
  assert.strictEqual(link, 'upi://pay?pa=sanjeev%40okhdfcbank&pn=Sanjeev&am=1500.00&cu=INR&tn=Manali%20trip');
  const empty = L.upiPayLink('', 'Sanjeev', 1500, 'Manali');
  assert.strictEqual(empty, '');
  const msg = L.settleMessage('Rohit', 2500, 'Manali stay', 'sanjeev@okhdfcbank');
  assert.ok(msg.includes('Rohit') && msg.includes('₹2,500') && msg.includes('sanjeev@okhdfcbank'));
  const wa = L.whatsappLink('Test message');
  assert.strictEqual(wa, 'https://wa.me/?text=Test%20message');
});

// ---- ledger ----
const loans = [
  { id: 'a', person: 'Rohit', kind: 'lent', amount: 5000, note: 'bike repair', ts: 1, payments: [{ id: 'p1', amount: 2000, ts: 2 }] },
  { id: 'b', person: ' rohit ', kind: 'lent', amount: 1000, note: '', ts: 3, payments: [] },
  { id: 'c', person: 'Neha', kind: 'borrowed', amount: 700, note: 'lunch', ts: 4, payments: [] }
];

t('parseLoans drops junk and trims names', () => {
  const out = L.parseLoans(JSON.stringify([...loans, { id: 'x', person: '', kind: 'lent', amount: 5, ts: 1 }, { nope: 1 }, { id: 'y', person: 'Z', kind: 'gift', amount: 1, ts: 1 }]));
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[1].person, 'rohit');
  assert.deepStrictEqual(L.parseLoans('not json'), []);
});

t('summarize groups people ignoring case and totals both directions', () => {
  const s = L.summarize(L.parseLoans(JSON.stringify(loans)));
  assert.strictEqual(s.people.length, 2);
  const rohit = s.people.find(p => p.key === 'rohit');
  assert.strictEqual(rohit.owedToMe, 4000);
  assert.strictEqual(s.totalOwedToMe, 4000);
  assert.strictEqual(s.totalIOwe, 700);
  assert.strictEqual(s.net, 3300);
});

t('repayments reduce what is pending and cannot exceed it', () => {
  const l = L.parseLoans(JSON.stringify(loans))[0];
  assert.strictEqual(L.outstanding(l), 3000);
  const ok = L.addPayment(l, 1000.5, 9, 'p2');
  assert.strictEqual(L.outstanding(ok.loan), 1999.5);
  assert.ok(L.addPayment(l, 3000.01, 9, 'p3').error);
  assert.ok(L.addPayment(l, 0, 9, 'p4').error);
  assert.strictEqual(L.outstanding(L.addPayment(l, 3000, 9, 'p5').loan), 0);
});

// ---- wallets ----
const wallet = { id: 'w1', name: 'Amazon Pay', opening: 500, since: 1000 };
t('wallet descriptions round-trip', () => {
  assert.deepStrictEqual(L.parseWalletDesc(L.walletTopupDesc('Amazon Pay', 'ICICI card XX1014')), { kind: 'topup', wallet: 'Amazon Pay', note: 'ICICI card XX1014' });
  assert.deepStrictEqual(L.parseWalletDesc(L.walletSpendDesc('Amazon Pay', 'Blinkit groceries')), { kind: 'spend', wallet: 'Amazon Pay', note: 'Blinkit groceries' });
  assert.strictEqual(L.parseWalletDesc('🏠 Blinkit'), null);
  assert.strictEqual(L.parseWalletDesc('👛'), null);
  assert.strictEqual(L.parseWalletDesc('👛➕ Amazon Pay').kind, 'topup');
});
t('balance = opening + top-ups - wallet purchases, only from the start date', () => {
  const entries = [
    { id: '1', amount: 442, desc: '👛➕ Amazon Pay · ICICI card XX1014', ts: 2000 },
    { id: '2', amount: 906, desc: '👛 Amazon Pay · Blinkit', ts: 2001 },
    { id: '3', amount: 50, desc: '👛 Amazon Pay · before tracking', ts: 500 },
    { id: '4', amount: 70, desc: '👛 amazon pay · case-insensitive name', ts: 3000 },
    { id: '5', amount: 99, desc: '👛 Paytm · other wallet', ts: 3001 },
    { id: '6', amount: 10, desc: 'Plain expense', ts: 3002 }
  ];
  const s = L.walletState(entries, wallet);
  assert.strictEqual(s.topups, 442);
  assert.strictEqual(s.spent, 976);
  assert.strictEqual(s.balance, 500 + 442 - 976); // -34: tells the user a top-up is missing
  assert.strictEqual(s.items.length, 3);
  assert.strictEqual(s.items[0].id, '4');
});
t('split payment: card top-up plus wallet money counts the order once', () => {
  // Blinkit order Rs 906 = Rs 442 from the card (top-up) + the rest from the wallet balance.
  const s = L.walletState([
    { id: 'a', amount: 442, desc: '👛➕ Amazon Pay · card', ts: 2000 },
    { id: 'b', amount: 906, desc: '👛 Amazon Pay · Blinkit', ts: 2001 }
  ], { id: 'w', name: 'Amazon Pay', opening: 464, since: 1000 });
  assert.strictEqual(s.balance, 0); // opening 464 + 442 - 906
  assert.strictEqual(s.spent, 906); // spending counted once; the 442 is only a transfer
});
t('reconcile tells unaccounted spend from extra money', () => {
  assert.deepStrictEqual(L.walletReconcile(100, 100), { kind: 'match', amount: 0 });
  assert.deepStrictEqual(L.walletReconcile(100, 80.5), { kind: 'spent', amount: 19.5 });
  assert.deepStrictEqual(L.walletReconcile(100, 130), { kind: 'extra', amount: 30 });
});
t('parseWallets keeps valid wallets only', () => {
  const out = L.parseWallets(JSON.stringify([wallet, { id: 'x', name: '', opening: 1, since: 1 }, { nope: 1 }]));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(L.parseWallets('bad'), []);
});

// ---- pay cycles ----
const D = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
t('pay cycles run from one Salary 1 payday to the next, newest first', () => {
  const rows = [
    { desc: '💼 Salary 1', ts: D(2026, 9, 30) }, { desc: '💼 Salary 2', ts: D(2026, 10, 10) },
    { desc: '💼 Salary 1', ts: D(2026, 10, 30) }, { desc: 'Chai', ts: D(2026, 10, 2) }
  ];
  const c = L.payCycles(rows, e => /salary 1/i.test(e.desc));
  assert.deepStrictEqual(c, [{ start: D(2026, 10, 30), end: null }, { start: D(2026, 9, 30), end: D(2026, 10, 30) }]);
  assert.deepStrictEqual(L.payCycles([{ desc: 'x', ts: 1 }], () => false), []);
});
t('two payday entries within a week are one cycle start', () => {
  const c = L.payCycles([{ desc: 'Salary 1', ts: D(2026, 9, 30) }, { desc: 'Salary 1 arrears', ts: D(2026, 10, 2) }], e => true);
  assert.strictEqual(c.length, 1);
});
t('last working day skips weekends', () => {
  assert.strictEqual(L.lastWorkingDay(2026, 8).getDate(), 30);   // Sep 2026 ends on Wednesday the 30th
  assert.strictEqual(L.lastWorkingDay(2026, 9).getDate(), 30);   // Oct 31 2026 is a Saturday, so Friday 30th
  assert.strictEqual(L.lastWorkingDay(2026, 10).getDate(), 30);  // Nov 30 2026 is a Monday
});
t('next payday this month, or next month once it has passed', () => {
  const a = L.nextPayday(D(2026, 10, 11));
  assert.strictEqual(a.date.getDate(), 30); assert.strictEqual(a.days, 19);
  const b = L.nextPayday(D(2026, 10, 31));
  assert.strictEqual(b.date.getMonth(), 10);
});
// ---- bank ----
const bank = { id: 'b1', name: 'ICICI', snapshots: [{ ts: D(2026, 10, 1), balance: 100000 }] };
const isIn = e => e.kind === 'income', isOut = e => e.kind === 'spend';
t('bank balance = newest balance + money in - money out since then', () => {
  const rows = [
    { id: '1', amount: 38000, kind: 'income', desc: 'Salary 2', ts: D(2026, 10, 10) },
    { id: '2', amount: 906, kind: 'spend', desc: 'Blinkit', ts: D(2026, 10, 10) },
    { id: '3', amount: 500, kind: 'spend', desc: 'before the snapshot', ts: D(2026, 9, 20) },
    { id: '4', amount: 99, kind: 'other', desc: 'ignored', ts: D(2026, 10, 11) }
  ];
  const e = L.bankEstimate(rows, bank, isIn, isOut);
  assert.strictEqual(e.balance, 100000 + 38000 - 906);
  assert.strictEqual(e.income, 38000); assert.strictEqual(e.spent, 906); assert.strictEqual(e.items.length, 2);
});
t('a newer balance restarts the estimate', () => {
  const b2 = { id: 'b1', name: 'ICICI', snapshots: [{ ts: D(2026, 10, 1), balance: 100000 }, { ts: D(2026, 10, 10), balance: 90000 }] };
  const e = L.bankEstimate([{ id: '1', amount: 1000, kind: 'spend', ts: D(2026, 10, 5) }, { id: '2', amount: 2000, kind: 'spend', ts: D(2026, 10, 11) }], b2, isIn, isOut);
  assert.strictEqual(e.balance, 88000);
});
t('parseBank keeps valid accounts only', () => {
  const out = L.parseBank(JSON.stringify([bank, { id: 'x', name: '', snapshots: [{ ts: 1, balance: 1 }] }, { id: 'y', name: 'Empty', snapshots: [] }]));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(L.parseBank('nope'), []);
});

t('cash income kept at home stays out of the bank until deposited, and deposit is not income', () => {
  const rows = [{ id: '1', amount: 38000, kind: 'income', desc: 'Salary 2', ts: D(2026, 10, 10) }];
  const held = Object.assign({}, bank, { held: ['1'], deposits: [] });
  const e = L.bankEstimate(rows, held, isIn, isOut);
  assert.strictEqual(e.balance, 100000); assert.strictEqual(e.cashHeld, 38000);
  const dep = Object.assign({}, held, { deposits: [{ ts: D(2026, 10, 12), amount: 38000, ref: '1' }] });
  const e2 = L.bankEstimate(rows, dep, isIn, isOut);
  assert.strictEqual(e2.balance, 138000); assert.strictEqual(e2.cashHeld, 0);
  assert.strictEqual(e2.items.length, 1);
});
t('parseBank keeps held and deposits', () => {
  const o = L.parseBank(JSON.stringify([Object.assign({}, bank, { held: ['1'], deposits: [{ ts: 5, amount: 10 }, { ts: 6, amount: -1 }] })]));
  assert.deepStrictEqual(o[0].held, ['1']); assert.strictEqual(o[0].deposits.length, 1);
});

const loanX = { id: 'l1', person: 'Ravi', kind: 'lent', amount: 5000, note: '', ts: 1, payments: [{ id: 'p1', amount: 2000, ts: 2, note: '' }] };
t('editLoan fixes the amount, keeps repayments, and refuses less than repaid', () => {
  const ok = L.editLoan(loanX, { amount: 12000 });
  assert.strictEqual(ok.loan.amount, 12000); assert.strictEqual(ok.loan.payments.length, 1);
  assert.strictEqual(L.outstanding(ok.loan), 10000);
  assert.ok(L.editLoan(loanX, { amount: 1500 }).error);
  assert.ok(L.editLoan(loanX, { amount: 0 }).error);
  assert.strictEqual(L.editLoan(loanX, { person: '  Ravi   K ' }).loan.person, 'Ravi K');
});
t('editPayment corrects a repayment but not beyond the loan', () => {
  assert.strictEqual(L.editPayment(loanX, 'p1', { amount: 2500 }).loan.payments[0].amount, 2500);
  assert.ok(L.editPayment(loanX, 'p1', { amount: 6000 }).error);
  assert.ok(L.editPayment(loanX, 'nope', { amount: 1 }).error);
});

t('smart rules recognise payees and route banks', () => {
  const rules = L.parseRules(JSON.stringify(L.defaultRules()));
  assert.strictEqual(L.matchRule('UPI-JAGROOP SHOSHRI CHAND', rules).name, 'Milk vendor');
  assert.strictEqual(L.matchRule('Priyanka Mehta', rules).name, 'Niece allowance');
  assert.strictEqual(L.matchRule('Premium paid', rules), null);
  const accts = [{ id: 'i', name: 'ICICI Salary' }, { id: 'h', name: 'HDFC Savings' }];
  assert.strictEqual(L.routeAccount({ id: '1', desc: 'Flat EMI' }, accts, {}, rules, 'i'), 'h');
  assert.strictEqual(L.routeAccount({ id: '2', desc: 'Blinkit' }, accts, {}, rules, 'i'), 'i');
  assert.strictEqual(L.routeAccount({ id: '3', desc: 'Flat EMI' }, [accts[0]], {}, rules, 'i'), null);
  assert.strictEqual(L.routeAccount({ id: '4', desc: 'Salary' }, accts, { '4': 'cash' }, rules, 'i'), 'i');
  assert.strictEqual(L.routeAccount({ id: '5', desc: 'Cred wallet' }, accts, { '5': 'none' }, rules, 'i'), null);
});
t('due rules appear from the due day until logged or skipped', () => {
  const rules = L.parseRules(JSON.stringify(L.defaultRules()));
  const D2 = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  assert.deepStrictEqual(L.dueRules(rules, [], D2(2026, 10, 4), {}).map(x => x.rule.id).sort(), ['r-milk', 'r-niece']);
  const logged = [{ id: 'a', desc: '🏠 Milk vendor', amount: 2400, ts: D2(2026, 10, 2) }];
  const due = L.dueRules(rules, logged, D2(2026, 10, 6), { 'r-niece': '2026-10' });
  assert.deepStrictEqual(due.map(x => x.rule.id), ['r-emi']);
  const prev = L.dueRules(rules, [{ id: 'p', desc: 'Milk vendor', amount: 2400, ts: D2(2026, 9, 2) }], D2(2026, 10, 2), {});
  assert.strictEqual(prev.filter(x => x.rule.id === 'r-milk')[0].amount, 2400);
});

t('a transfer lowers one account and raises the other', () => {
  const ic = { id: 'ic', name: 'ICICI', snapshots: [{ ts: D(2026, 10, 1), balance: 100000 }] };
  const hd = { id: 'hd', name: 'HDFC', snapshots: [{ ts: D(2026, 10, 1), balance: 50000 }] };
  const tr = L.parseTransfers(JSON.stringify([{ id: 't', ts: D(2026, 10, 11), amount: 10000, from: 'ic', to: 'hd', label: 'Transfer ICICI → HDFC' }, { id: 'bad', ts: 1, amount: 5, from: 'ic', to: 'ic' }]));
  assert.strictEqual(tr.length, 1);
  assert.strictEqual(L.bankEstimate([], ic, isIn, isOut, tr).balance, 90000);
  assert.strictEqual(L.bankEstimate([], hd, isIn, isOut, tr).balance, 60000);
  const old = L.parseTransfers(JSON.stringify([{ id: 'o', ts: D(2026, 9, 1), amount: 999, from: 'ic', to: 'hd' }]));
  assert.strictEqual(L.bankEstimate([], hd, isIn, isOut, old).balance, 50000);
});

const own = L.parseOwn(JSON.stringify(L.defaultOwn()));
const accts2 = [{ id: 'i', name: 'ICICI Salary' }, { id: 'h', name: 'HDFC Savings' }];
t('own cards and account numbers drive routing', () => {
  assert.strictEqual(L.cardFor('ICICI Card XX1014 Airtel', own).kind, 'credit');
  assert.strictEqual(L.cardFor('debit card 0778 POS', own).kind, 'debit');
  assert.strictEqual(L.routeAccount({ id: '1', desc: 'EMI debited A/c XX8749' }, accts2, {}, [], 'i', own), 'h');
  assert.strictEqual(L.routeAccount({ id: '2', desc: 'POS XX0778 shop' }, accts2, {}, [], 'h', own), 'i');
  assert.strictEqual(L.routeAccount({ id: '3', desc: 'plain' }, accts2, {}, [], 'i', own), 'i');
});
t('transfer suggestions: named own account, and same amount out and in', () => {
  const NOW = D(2026, 10, 11);
  const pred = { isTransfer: () => false, isExpense: e => e.kind === 'spend', isIncome: e => e.kind === 'income', isCard: () => false, isRule: () => false, route: () => 'i' };
  const a = L.transferCandidates([{ id: 'x', kind: 'spend', amount: 10000, desc: 'IMPS to A/c XX8749', ts: NOW - 1000 }], accts2, own, NOW, {}, pred);
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].from, 'i'); assert.strictEqual(a[0].to, 'h');
  const b = L.transferCandidates([{ id: 'o', kind: 'spend', amount: 7000, desc: 'UPI Rahul', ts: NOW - 5000 }, { id: 'n', kind: 'income', amount: 7000, desc: 'UPI Rahul', ts: NOW - 4000 }], accts2, own, NOW, {}, pred);
  assert.strictEqual(b.length, 1); assert.deepStrictEqual(b[0].ids, ['o', 'n']); assert.strictEqual(b[0].to, 'h');
  assert.strictEqual(L.transferCandidates([{ id: 'x', kind: 'spend', amount: 5, desc: 'IMPS to A/c XX8749', ts: NOW }], accts2, own, NOW, { x: 1 }, pred).length, 0);
  assert.strictEqual(L.transferCandidates([{ id: 'x', kind: 'spend', amount: 5, desc: 'IMPS to A/c XX8749', ts: NOW }], [accts2[0]], own, NOW, {}, pred).length, 0);
});

t('payments to your own name are detected, with the source account from the SMS', () => {
  const NOW = D(2026, 10, 11);
  const pred = { isTransfer: () => false, isExpense: e => e.kind === 'spend', isIncome: e => e.kind === 'income', isCard: () => false, isRule: () => false, route: () => 'i' };
  assert.ok(L.isOwnName('Sanjeev Yadav', own)); assert.ok(L.isOwnName('🔁 SANJEEV  YADAV', own)); assert.ok(!L.isOwnName('Sanjeev Kumar', own));
  const raw = 'ICICI Bank Acct XX602 debited for Rs 5000.00 on 11-Oct-26; SANJEEV YADAV credited. UPI:665';
  assert.strictEqual(L.sourceAccountFromRaw(raw, own, accts2), 'i');
  const r = L.autoOwnTransfers([{ id: 'e', kind: 'spend', amount: 5000, desc: 'Sanjeev Yadav', raw, ts: NOW - 1000 }, { id: 'f', kind: 'spend', amount: 72, desc: 'Sanskriti S Sto', raw, ts: NOW }], accts2, own, NOW, pred);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].from, 'i'); assert.strictEqual(r[0].to, 'h');
  assert.strictEqual(L.autoOwnTransfers([{ id: 'e', kind: 'spend', amount: 5000, desc: 'Sanjeev Yadav', raw, ts: NOW }], [accts2[0]], own, NOW, pred).length, 0);
  assert.strictEqual(L.routeAccount({ id: '9', desc: 'EMI', raw: 'HDFC Bank A/c XX749 debited Rs 5' }, accts2, {}, [], 'i', own), 'h');
});

t('the same transfer is never counted twice', () => {
  const dup = L.parseTransfers(JSON.stringify([
    { id: 'a', ts: 1000, amount: 5000, from: 'i', to: 'h', ref: 'e1' },
    { id: 'b', ts: 2000, amount: 5000, from: 'i', to: 'h', ref: 'e1' },
    { id: 'c', ts: 90000, amount: 5000, from: 'i', to: 'h', ref: 'e2' },
    { id: 'd', ts: 99999999, amount: 5000, from: 'i', to: 'h', ref: 'e3' }]));
  assert.deepStrictEqual(dup.map(t => t.id), ['a', 'd']);
});
t('twin copies of one payment and already-marked transfers', () => {
  const NOW = D(2026, 10, 11);
  const pred = { isTransfer: e => /^🔁/.test(e.desc), isExpense: e => e.kind === 'spend' && !/^🔁/.test(e.desc), isIncome: () => false, isCard: () => false, isRule: () => false, route: () => 'i' };
  const rows = [{ id: 'a', kind: 'spend', amount: 5000, desc: 'Sanjeev Yadav', ts: NOW - 60000 }, { id: 'b', kind: 'spend', amount: 5000, desc: 'Sanjeev Yadav', ts: NOW - 20000 }];
  const r = L.autoOwnTransfers(rows, accts2, own, NOW, pred, {});
  assert.strictEqual(r.length, 1); assert.deepStrictEqual(r[0].ids, ['a', 'b']);
  assert.strictEqual(L.autoOwnTransfers(rows, accts2, own, NOW, pred, { a: 1, b: 1 }).length, 0);
  const marked = [{ id: 'm', kind: 'spend', amount: 300, desc: '🔁 Rahul', ts: NOW - 1000 }];
  assert.strictEqual(L.orphanTransfers(marked, [], accts2, own, NOW, pred).length, 1);
  assert.strictEqual(L.orphanTransfers(marked, [{ ref: 'm', from: 'i', to: 'h', amount: 300, ts: NOW }], accts2, own, NOW, pred).length, 0);
});

t('bank balance is read from SMS text', () => {
  assert.strictEqual(L.parseAvlBalance('Rs 500 debited. Avl Bal Rs 12,345.67. Not you? Call'), 12345.67);
  assert.strictEqual(L.parseAvlBalance('Available balance: INR 3181.66'), 3181.66);
  assert.strictEqual(L.parseAvlBalance('A/c XX749 debited. Avl bal:Rs.99'), 99);
  assert.strictEqual(L.parseAvlBalance('Bal: Rs 250.00 on 11-Oct'), 250);
  assert.strictEqual(L.parseAvlBalance('INR 1,261.50 spent on ICICI Bank Card XX1014. Avl Limit: INR 57,133.55'), null);
  assert.strictEqual(L.parseAvlBalance('ICICI Bank Acct XX602 debited for Rs 5000.00; SANJEEV YADAV credited.'), null);
});
t('newest SMS balance after the last balance wins; older ones and cards are ignored', () => {
  const ac = { id: 'h', name: 'HDFC', snapshots: [{ ts: D(2026, 10, 1), balance: 100 }] };
  const rows = [
    { id: '1', ts: D(2026, 10, 5), raw: 'debited Avl Bal Rs 900', amount: 5 },
    { id: '2', ts: D(2026, 10, 9), raw: 'debited Avl Bal Rs 800.50', amount: 5 },
    { id: '3', ts: D(2026, 9, 20), raw: 'old Avl Bal Rs 7', amount: 5 },
    { id: '4', ts: D(2026, 10, 10), raw: 'card Avl Bal Rs 1', amount: 5, card: true },
    { id: '5', ts: D(2026, 10, 11), raw: 'other bank Avl Bal Rs 2', amount: 5, other: true }];
  const f = L.balanceFromSms(rows, ac, e => e.other ? 'x' : 'h', e => !!e.card);
  assert.deepStrictEqual(f, { ts: D(2026, 10, 9), balance: 800.5 });
  assert.strictEqual(L.balanceFromSms([rows[2]], ac, () => 'h', () => false), null);
  assert.strictEqual(L.parseBank(JSON.stringify([{ id: 'a', name: 'X', snapshots: [{ ts: 1, balance: 2, src: 'sms' }] }]))[0].snapshots[0].src, 'sms');
});

t('bills still to come before payday', () => {
  const rules = L.parseRules(JSON.stringify([
    { id: 'e', name: 'Flat EMI', words: ['emi'], day: 5, amount: 31000, scope: 'personal', acct: 'HDFC' },
    { id: 'm', name: 'Milk', words: ['milk'], day: 1, amount: 2400, scope: 'family', acct: '' }]));
  const NOW = D(2026, 10, 12), END = D(2026, 10, 30);
  const early = L.upcomingRules(rules, [], NOW, END);          // both not logged yet: overdue ones count
  assert.strictEqual(early.length, 2);
  const paid = L.upcomingRules(rules, [{ id: '1', desc: 'Flat EMI', amount: 31000, ts: D(2026, 10, 5) }, { id: '2', desc: 'Milk', amount: 2400, ts: D(2026, 10, 2) }], NOW, END);
  assert.strictEqual(paid.length, 0);                          // next ones fall in November, after payday
  assert.strictEqual(L.upcomingRules(rules, [{ id: '2', desc: 'Milk', amount: 2400, ts: D(2026, 10, 2) }], NOW, D(2026, 11, 6)).length, 2);
});

t('LIC on the 22nd and small insurance on the 16th are recognised; look-alikes are not', () => {
  const rules = L.parseRules(JSON.stringify(L.defaultRules()));
  const on = (d, day, amount) => L.matchRule(d, rules, { amount, ts: D(2026, 10, day) });
  assert.strictEqual(on('LIC of India', 22, 5000).scope, 'investment');
  assert.strictEqual(on('LIC of India', 9, 5000), null);                 // not near its day
  assert.strictEqual(on('Star Health Insurance Premium', 16, 1800).scope, 'personal');
  assert.strictEqual(on('Star Health Insurance Premium', 16, 9000), null); // above the cap
  assert.strictEqual(on('Lavish Kirana Store', 13, 420).scope, 'family');
  assert.strictEqual(on('Zomato', 16, 300), null);
});
t('new built-in rules are added once, never over the ones you have', () => {
  const mine = L.parseRules(JSON.stringify([{ id: 'r-emi', name: 'Flat EMI', words: ['emi'], day: 7, amount: 31000, scope: 'personal', acct: 'HDFC' }]));
  const a = L.seedRules(mine, []);
  assert.ok(a.rules.some(r => r.id === 'r-lic')); assert.strictEqual(a.rules.filter(r => r.id === 'r-emi')[0].day, 7);
  const b = L.seedRules(a.rules.filter(r => r.id !== 'r-lic'), a.seeded);   // you deleted LIC: it stays deleted
  assert.ok(!b.rules.some(r => r.id === 'r-lic'));
});
t('duplicates: the same SMS twice goes; two real payments and rows with a bank reference stay', () => {
  const NOW = D(2026, 10, 11);
  const raw = 'ICICI Bank Acct XX602 debited for Rs 2.00';
  const sure = L.findDuplicates([{ id: 'a', amount: 2, desc: 'Sanjeev', raw, refNo: '665', ts: NOW - 60000 }, { id: 'b', amount: 2, desc: 'Sanjeev', raw, ts: NOW - 30000 }], NOW);
  assert.strictEqual(sure.sure.length, 1); assert.strictEqual(sure.sure[0].drop.id, 'b'); assert.strictEqual(sure.sure[0].keep.id, 'a');
  const two = L.findDuplicates([{ id: 'a', amount: 90, desc: 'Chai', raw: 'x', refNo: '1', ts: NOW - 60000 }, { id: 'b', amount: 90, desc: 'Chai', raw: 'x', refNo: '2', ts: NOW - 30000 }], NOW);
  assert.strictEqual(two.sure.length + two.maybe.length, 0);
  const hand = L.findDuplicates([{ id: 'a', amount: 50, desc: 'Auto', ts: NOW - 60000 }, { id: 'b', amount: 50, desc: '👤 Auto', ts: NOW - 30000 }], NOW);
  assert.strictEqual(hand.sure.length, 0); assert.strictEqual(hand.maybe.length, 1);
  const far = L.findDuplicates([{ id: 'a', amount: 50, desc: 'Auto', raw: 'x', ts: NOW - 3600000 }, { id: 'b', amount: 50, desc: 'Auto', raw: 'x', ts: NOW }], NOW);
  assert.strictEqual(far.sure.length + far.maybe.length, 0);
  const copyNoRef = L.findDuplicates([{ id: 'a', amount: 450, desc: 'Zomato', refNo: '9', ts: NOW - 60000 }, { id: 'b', amount: 450, desc: 'Zomato', raw: 'SMS', ts: NOW - 20000 }], NOW);
  assert.strictEqual(copyNoRef.sure.length, 1); assert.strictEqual(copyNoRef.sure[0].drop.id, 'b');
  const tripVsUnscoped = L.findDuplicates([{ id: 'sms', amount: 4500, desc: 'Airbnb', refNo: '612', raw: 'SMS', ts: NOW - 120000 }, { id: 'gpay', amount: 4500, desc: '✈️ Manali Trip: Airbnb', raw: 'GPay', ts: NOW - 60000 }], NOW);
  assert.strictEqual(tripVsUnscoped.sure.length, 1); assert.strictEqual(tripVsUnscoped.sure[0].keep.id, 'gpay'); assert.strictEqual(tripVsUnscoped.sure[0].drop.id, 'sms');
});
t('a Rs 2 test transfer between your two banks is one transfer, found without any name', () => {
  const NOW = D(2026, 10, 11);
  const pred = { isTransfer: e => /^🔁/.test(e.desc), isExpense: e => e.kind === 'spend', isIncome: e => e.kind === 'income', isCard: () => false, isRule: () => false, route: () => 'i' };
  const rows = [
    { id: 'o', kind: 'spend', amount: 2, desc: 'Rahul K', raw: 'ICICI Bank Acct XX602 debited for Rs 2.00 on 11-Oct; UPI:111', ts: NOW - 120000 },
    { id: 'n', kind: 'income', amount: 2, desc: 'UPI credit', raw: 'HDFC Bank: Rs 2.00 credited to a/c XX749 on 11-10-26. Info: UPI-222', ts: NOW - 100000 }];
  const r = L.autoTransferPairs(rows, accts2, own, NOW, pred);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].from, 'i'); assert.strictEqual(r[0].to, 'h'); assert.deepStrictEqual(r[0].ids, ['o', 'n']);
  assert.strictEqual(L.autoTransferPairs([rows[0], Object.assign({}, rows[1], { raw: 'Bank: Rs 2.00 credited' })], accts2, own, NOW, pred).length, 0);
  assert.strictEqual(L.autoTransferPairs([rows[0], Object.assign({}, rows[1], { ts: NOW - 5400000 })], accts2, own, NOW, pred).length, 0);
});
t('the credit leg of a transfer, marked 🔁, does not become a second transfer the other way', () => {
  const NOW = D(2026, 10, 11);
  const pred = { isTransfer: e => /^🔁/.test(e.desc), isExpense: () => false, isIncome: () => false, isCard: () => false, isRule: () => false, route: e => (e.id === 'n' ? 'h' : 'i') };
  const marked = [{ id: 'n', amount: 2, desc: '🔁 UPI credit', raw: 'HDFC Bank: Rs 2.00 credited to a/c XX749', ts: NOW - 1000 }];
  assert.strictEqual(L.orphanTransfers(marked, [{ ref: 'o', from: 'i', to: 'h', amount: 2, ts: NOW - 5000 }], accts2, own, NOW, pred).length, 0);
});
t('credit card: the SMS available limit gives the amount owed; else your starting figure plus spends minus payments', () => {
  assert.strictEqual(L.parseCardLimit('Rs 450 spent on ICICI Card XX1014 at Zomato. Avl Limit: Rs 1,23,456.78'), 123456.78);
  assert.strictEqual(L.parseCardLimit('Available credit limit is INR 90000'), 90000);
  assert.strictEqual(L.parseCardLimit('Rs 450 spent'), null);
  const card = { kind: 'credit', last4: '1014' };
  const pred = { onCard: e => /1014/.test(e.desc + (e.raw || '')), isSpend: e => e.kind === 'spend' && !/card bill/i.test(e.desc), isPayment: e => /card bill/i.test(e.desc) };
  const rows = [
    { id: 'a', kind: 'spend', amount: 450, desc: 'Zomato XX1014', raw: 'Spent on Card XX1014. Avl Limit: Rs 99,550', ts: 1000 },
    { id: 'b', kind: 'spend', amount: 550, desc: 'Amazon XX1014', ts: 2000 },
    { id: 'p', kind: 'spend', amount: 200, desc: 'Card bill payment 1014', ts: 3000 }];
  const viaSms = L.cardState(rows, card, { limit: 100000 }, pred);
  assert.strictEqual(viaSms.outstanding, 450 + 550 - 200); assert.strictEqual(viaSms.available, 100000 - 800); assert.strictEqual(viaSms.source, 'sms');
  const viaBase = L.cardState(rows.map(r => Object.assign({}, r, { raw: undefined })), card, { limit: 100000, base: { ts: 500, outstanding: 5000 } }, pred);
  assert.strictEqual(viaBase.outstanding, 5000 + 450 + 550 - 200); assert.strictEqual(viaBase.source, 'manual');
  assert.strictEqual(L.cardState(rows.map(r => Object.assign({}, r, { raw: undefined })), card, {}, pred).outstanding, null);
});

t('trip categories: identifies stay, fuel, food, and beverages headers correctly', () => {
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Airbnb Payments').key, 'stay');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Grand Hotel Manali').name, 'Stay Expenses');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: HPCL Fuel Station').key, 'fuel');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Indian Oil Petrol').name, 'Fuel Expenses');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Chopsticks Restaurant').key, 'food');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Cafe 1947 dinner').name, 'Food Expenses');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: English Wine & Beer Shop').key, 'beverages');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Old Monk Rum & Liquor').name, 'Beverages');
  assert.strictEqual(L.tripItemCategory('✈️ Manali trip: Paragliding Solang').key, 'other');

  const sample = [
    { id: '1', amount: 18000, desc: '✈️ Manali: Airbnb Stay' },
    { id: '2', amount: 3500, desc: '✈️ Manali: Petrol Pump Fuel' },
    { id: '3', amount: 1200, desc: '✈️ Manali: Johnson Cafe lunch' },
    { id: '4', amount: 2400, desc: '✈️ Manali: Wine & Beer Shop drinks' },
    { id: '5', amount: 500, desc: '✈️ Manali: Taxi cab' }
  ];
  const cats = L.tripCategoriesSummary(sample);
  assert.strictEqual(cats.stay.total, 18000);
  assert.strictEqual(cats.fuel.total, 3500);
  assert.strictEqual(cats.food.total, 1200);
  assert.strictEqual(cats.beverages.total, 2400);
  assert.strictEqual(cats.other.total, 500);
});

t('canonicalTripParticipant unifies Me, Sanjeev, and Sanjeev Yadav', () => {
  assert.strictEqual(L.canonicalTripParticipant('Me', 'Me'), 'Me');
  assert.strictEqual(L.canonicalTripParticipant('Me (You)', 'Me'), 'Me');
  assert.strictEqual(L.canonicalTripParticipant('Sanjeev', 'Me'), 'Me');
  assert.strictEqual(L.canonicalTripParticipant('Sanjeev Yadav', 'Me'), 'Me');
  assert.strictEqual(L.canonicalTripParticipant('Me', 'Sanjeev Yadav'), 'Sanjeev Yadav');
  assert.strictEqual(L.canonicalTripParticipant('Sanjeev', 'Sanjeev Yadav'), 'Sanjeev Yadav');
  assert.strictEqual(L.canonicalTripParticipant('Sanjeev Yadav', 'Sanjeev Yadav'), 'Sanjeev Yadav');
  assert.strictEqual(L.canonicalTripParticipant('Vinay', 'Sanjeev Yadav'), 'Vinay');
  assert.strictEqual(L.canonicalTripParticipant('Bijoy', 'Sanjeev Yadav'), 'Bijoy');
});

t('tripSettlement collapses Sanjeev/Sanjeev Yadav/Me and splits 53376.84 among 5 people', () => {
  const participants = ['Sanjeev Yadav', 'Vinay', 'Bijoy', 'Rahul', 'Sumanth'];
  const expenses = [
    { label: 'Airbnb Booking', amount: 53376.84, payer: 'Sanjeev' }
  ];
  const r = L.tripSettlement(expenses, participants, 'Sanjeev Yadav');
  assert.strictEqual(r.people.length, 5);
  const by = Object.fromEntries(r.people.map(p => [p.name, p]));
  assert.strictEqual(by['Sanjeev Yadav'].paid, 53376.84);
  assert.strictEqual(Math.round(r.people.reduce((s, p) => s + p.share, 0) * 100), 5337684);
  assert.strictEqual(by['Sanjeev Yadav'].net, 42701.47);
  assert.strictEqual(r.transfers.length, 4);
  const totalTransfer = r.transfers.reduce((s, t) => s + t.amount, 0);
  assert.strictEqual(Math.round(totalTransfer * 100), 4270147);
  r.transfers.forEach(t => {
    assert.strictEqual(t.to, 'Sanjeev Yadav');
    assert.ok(t.amount === 10675.37 || t.amount === 10675.36);
  });
});

t('tripSettlement: partial settlement payment of 25,000 against 30,000 debt leaves 5,000 balance', () => {
  const participants = ['Sanjeev', 'Rahul'];
  const expenses = [
    { label: 'Hotel Booking', amount: 60000, payer: 'Sanjeev', splitAmong: ['Sanjeev', 'Rahul'] },
    { label: '🤝 Settlement to Sanjeev [Settlement]', amount: 25000, payer: 'Rahul', payee: 'Sanjeev', isSettlement: true }
  ];
  const r = L.tripSettlement(expenses, participants, 'Sanjeev');
  const by = Object.fromEntries(r.people.map(p => [p.name, p]));

  // Rahul originally owed 30,000. He paid 25,000. He now owes exactly 5,000.
  assert.strictEqual(by['Rahul'].paid, 25000);
  assert.strictEqual(by['Rahul'].share, 30000);
  assert.strictEqual(by['Rahul'].net, -5000);

  // Sanjeev originally got back 30,000. Having received 25,000, he now gets back 5,000.
  assert.strictEqual(by['Sanjeev'].paid, 35000);
  assert.strictEqual(by['Sanjeev'].share, 30000);
  assert.strictEqual(by['Sanjeev'].net, 5000);

  // Exactly 1 transfer of 5000 from Rahul to Sanjeev
  assert.strictEqual(r.transfers.length, 1);
  assert.strictEqual(r.transfers[0].from, 'Rahul');
  assert.strictEqual(r.transfers[0].to, 'Sanjeev');
  assert.strictEqual(r.transfers[0].amount, 5000);

  // Paying the remaining 5,000 settles everyone square
  expenses.push({ label: '🤝 Final settlement [Settlement]', amount: 5000, payer: 'Rahul', payee: 'Sanjeev', isSettlement: true });
  const settled = L.tripSettlement(expenses, participants, 'Sanjeev');
  const bySettled = Object.fromEntries(settled.people.map(p => [p.name, p]));
  assert.strictEqual(bySettled['Rahul'].net, 0);
  assert.strictEqual(bySettled['Sanjeev'].net, 0);
  assert.strictEqual(settled.transfers.length, 0);
});

t('tripSettlement: full settlement payment of 30,000 at once settles everyone square', () => {
  const participants = ['Sanjeev', 'Rahul'];
  const expenses = [
    { label: 'Villa Stay', amount: 60000, payer: 'Sanjeev', splitAmong: ['Sanjeev', 'Rahul'] },
    { label: '🤝 Settlement: Rahul paid Sanjeev [Settlement]', amount: 30000, payer: 'Rahul', splitAmong: ['Sanjeev'] }
  ];
  const r = L.tripSettlement(expenses, participants, 'Sanjeev');
  const by = Object.fromEntries(r.people.map(p => [p.name, p]));
  assert.strictEqual(by['Rahul'].net, 0);
  assert.strictEqual(by['Sanjeev'].net, 0);
  assert.strictEqual(r.transfers.length, 0);
});

console.log(n + ' tests passed');


t('smartSearch: hair/salon find salons, petrol finds filling stations, typos tolerated', () => {
  const m = (q, d) => L.smartSearch(q).test(d);
  assert.ok(m('hair', '💈 Naturals Unisex Salon'));
  assert.ok(m('salon', 'Jawed Habib'));
  assert.ok(m('hair', 'Barber shop'));
  assert.ok(m('petrol', 'Indian Oil Filling Station'));
  assert.ok(m('petrol', 'HP Pump Sector 4'));
  assert.ok(m('petrol', 'Bharat Petroleum'));
  assert.ok(m('fuel', 'Shell'));
  assert.ok(!m('petrol', 'Lavish Kirana Store'));
  assert.ok(!m('hair', 'Cola corner'));       // short term "ola" must not match inside a word
  assert.ok(m('saloon', 'Style Salon'));       // typo/spelling variant
  assert.ok(m('grocry', 'Lavish Kirana Store') === false); // unknown misspelling of concept stays strict
  assert.ok(m('swigy', 'Swiggy order'));       // one typo
  assert.ok(m('king', 'King Food'));           // plain substring still works
  assert.ok(m('food king', 'King Food'));      // all words must match
});

t('smsAccounts: one account per bank + number, newest balance', () => {
  const e = [
    { id: 'a', ts: 1, raw: 'JX-PNBSMS-S Ac XX0096 Credited with Rs.20000.00,27-10-2026.Avl Bal Rs.1314829.66CR.Helpline', bank: 'PNB' },
    { id: 'b', ts: 2, raw: 'JX-PNBSMS-S Ac XX0096 Credited with Rs.38000.00.Avl Bal Rs.1314826.66CR', bank: 'PNB' },
    { id: 'c', ts: 3, raw: 'AX-ICICIT-S ICICI Bank Acct XX602 debited for Rs 72.00', bank: 'ICICI' },
    { id: 'd', ts: 4, raw: 'HDFC Bank Credit Card XX1014 spent Rs 500. Avl Bal Rs 9000', bank: 'HDFC' }
  ];
  const r = L.smsAccounts(e);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].name, 'PNB'); assert.strictEqual(r[0].last4, '0096'); assert.strictEqual(r[0].balance, 1314826.66);
});
t('askQuery answers plain questions', () => {
  const now = new Date(2026, 9, 27, 12).getTime(), D = 86400000;
  const E = [{ id: 1, ts: now - D * 40, amount: 500, desc: 'Naturals Salon' }, { id: 2, ts: now - 1000, amount: 104, desc: 'King Food' }, { id: 3, ts: now - 2000, amount: 72, desc: 'Lavish Kirana' }];
  const ex = () => true;
  assert.strictEqual(L.askQuery(E, 'hair', now, ex), null);
  assert.strictEqual(L.askQuery(E, 'how much on hair all time spent', now, ex).total, 500);
  assert.strictEqual(L.askQuery(E, 'food today', now, ex).total, 104);
  assert.strictEqual(L.askQuery(E, 'spent today', now, ex).total, 176);
});
t('forecastMonth and unusualSpends run', () => {
  const now = new Date(2026, 9, 27, 12).getTime(), D = 86400000;
  const E = []; for (let i = 1; i <= 5; i++) E.push({ id: 'p' + i, ts: now - i * 5 * D, amount: 1000, desc: 'HP Petrol Pump' });
  E.push({ id: 'big', ts: now - 1000, amount: 3400, desc: 'HP Petrol Pump' });
  const f = L.forecastMonth(E, now, () => true, 0); assert.ok(f.projected >= f.spent);
  const u = L.unusualSpends(E, now, () => true); assert.strictEqual(u.length, 1); assert.ok(u[0].times > 3);
});

t('another bank SMS never sets an ICICI balance, and old mistakes are repaired', () => {
  const pnb = { id: 'p', ts: 500, raw: 'JX-PNBSMS-S Ac XX0096 Credited with Rs.38000.00.Avl Bal Rs.1314826.66CR', bank: 'PNB' };
  const ic = { id: 'i', ts: 300, raw: 'ICICI Bank Account XX602 credited. Avl Bal Rs 32,387.62', bank: 'ICICI' };
  const icici = { id: 'a1', name: 'ICICI SALARY account', snapshots: [{ ts: 100, balance: 1000 }, { ts: 300, balance: 32387.62, src: 'sms' }, { ts: 500, balance: 1314826.66, src: 'sms' }] };
  const pnbAcct = { id: 'a2', name: 'PNB', snapshots: [{ ts: 500, balance: 1314826.66, src: 'sms' }] };
  const r = L.cleanBankAccounts([icici, pnbAcct], [pnb, ic], ['icici', 'hdfc']);
  assert.strictEqual(r.accts.length, 1);
  assert.strictEqual(r.accts[0].snapshots[r.accts[0].snapshots.length - 1].balance, 32387.62);
  const got = L.balanceFromSms([pnb], { id: 'a1', name: 'ICICI', snapshots: [{ ts: 1, balance: 5 }] }, () => 'a1', () => false);
  assert.strictEqual(got, null);
  assert.strictEqual(L.routeAccount(pnb, [{ id: 'a1', name: 'ICICI' }], {}, [], 'a1', null), null);
});

t('money back from the same person: Rishabh 10,700 out and back', () => {
  const D = 86400000, now = Date.UTC(2026, 9, 27);
  const out = { id: 'o1', ts: now - 17 * D, amount: 10700, desc: '👤 Rishabh Shokeen', raw: 'ICICI Bank Acct XX602 debited for Rs 10700.00 on 10-Oct-26; RISHABH SHOKEEN credited. UPI:664919325392.', kind: 'expense' };
  const small = { id: 'o2', ts: now - 14 * D, amount: 5, desc: '🔨 Family function: Rishabh Shokeen', raw: 'Acct XX602 debited for Rs 5.00 on 13-Oct-26; RISHABH SHOKEEN credited. UPI:665219955363.', kind: 'expense' };
  const back = { id: 'i1', ts: now - 1 * D, amount: 10700, desc: '💰 Received · Rishabh Shokeen', raw: 'Dear Customer, Acct XX602 is credited with Rs 10700.00 on 26-Oct-26 from RISHABH SHOKEEN. UPI:666530867505-ICICI Bank.', kind: 'income' };
  assert.strictEqual(L.personOf(out), 'rishabh shokeen');
  assert.strictEqual(L.personOf(back), 'rishabh shokeen');
  const pred = { isOut: e => e.kind === 'expense', isIn: e => e.kind === 'income' };
  const r = L.findPaybacks([out, small, back], [], {}, now, pred, ['sanjeev yadav']);
  assert.strictEqual(r.auto.length, 1); assert.deepStrictEqual(r.auto[0].outIds, ['o1']);
  // Already paired: not offered again
  assert.strictEqual(L.findPaybacks([out, small, back], r.auto, {}, now, pred, []).auto.length, 0);
  // Partial: 4,000 back of 10,700 is asked, not done
  const part = Object.assign({}, back, { id: 'i2', amount: 4000 });
  const r2 = L.findPaybacks([out, part], [], {}, now, pred, []);
  assert.strictEqual(r2.auto.length, 0); assert.strictEqual(r2.ask.length, 1);
  // Never by amount alone: someone else sending 10,700 does not match
  const other = Object.assign({}, back, { id: 'i3', desc: '💰 Received · Amit Kumar', raw: 'Acct XX602 is credited with Rs 10700.00 on 26-Oct-26 from AMIT KUMAR. UPI:1.' });
  assert.strictEqual(L.findPaybacks([out, other], [], {}, now, pred, []).auto.length, 0);
  // People ledger
  const pl = L.peopleLedger([out, small, back], { isSent: e => e.kind === 'expense', isGot: e => e.kind === 'income' }, now, 180, []);
  assert.strictEqual(pl.length, 1); assert.strictEqual(pl[0].name, 'Rishabh Shokeen'); assert.strictEqual(pl[0].net, 5);
});

t('categoryOf gives a picture per spend', () => {
  const c = (d, r) => L.categoryOf(d, r).key;
  assert.strictEqual(c('Netflix'), 'subscription');
  assert.strictEqual(c('👤 Google Play'), 'subscription');
  assert.strictEqual(c('Food & Dining (Swiggy)'), 'food');
  assert.strictEqual(c('🏠 Lavish Kirana Store'), 'grocery');
  assert.strictEqual(c('HP Petrol Pump'), 'petrol');
  assert.strictEqual(c('Naturals Salon'), 'salon');
  assert.strictEqual(c('👤 Rishabh Shokeen'), 'person');
  assert.strictEqual(c('Cash', 'Rs 2000 withdrawn at ATM'), 'cash');
  assert.strictEqual(c('🏠 Milk vendor'), 'milk');
  assert.strictEqual(c('Amazon order'), 'online');
  assert.strictEqual(c('Daily Vegetables'), 'veg');
  assert.strictEqual(c('Lavish Kirana Store'), 'grocery');
  assert.strictEqual(c('King Food'), 'food');
  assert.strictEqual(c('Xyz Traders'), 'other');
});
