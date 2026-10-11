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

console.log(n + ' tests passed');
