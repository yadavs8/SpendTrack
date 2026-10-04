// Node.js test script for Kharcha Book pure functions
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dummyEl = {
  addEventListener: () => {},
  appendChild: () => {},
  setAttribute: () => {},
  removeAttribute: () => {},
  classList: { toggle: () => {}, add: () => {}, remove: () => {} },
  style: {},
  dataset: {},
  querySelector: () => ({ value: 'personal' }),
  querySelectorAll: () => []
};

const windowMock = {
  KHARCHA_CONFIG: {},
  Intl: Intl,
  Map: Map,
  Set: Set,
  Date: Date,
  Math: Math,
  Number: Number,
  String: String,
  Array: Array,
  Uint8Array: Uint8Array,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  crypto: { getRandomValues: (arr) => arr },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { serviceWorker: null },
  setInterval: () => {},
  clearInterval: () => {},
  setTimeout: () => {},
  clearTimeout: () => {},
  addEventListener: () => {},
  document: {
    getElementById: () => dummyEl,
    createElement: () => dummyEl,
    querySelector: () => dummyEl,
    querySelectorAll: () => [dummyEl],
    addEventListener: () => {}
  }
};
windowMock.window = windowMock;

const code = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
vm.runInNewContext(code, windowMock);

const { parseAmount, normDesc, money, groupByDay, byDescription, monthTotals, toLocalISOString, isFamilyEntry } = windowMock.__kharcha;

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${name}`);
    failed++;
  }
}

console.log('--- Running Kharcha Book Unit Tests ---');

// 1. Amount parsing
assert(parseAmount('250') === 250, 'parseAmount("250") => 250');
assert(parseAmount('₹ 1,250.50') === 1250.50, 'parseAmount("₹ 1,250.50") => 1250.50');
assert(parseAmount('-50') === null, 'parseAmount("-50") => null');
assert(parseAmount('abc') === null, 'parseAmount("abc") => null');

// 2. Description normalization
assert(normDesc('  grocery  shopping ') === 'Grocery shopping', 'normDesc cleans up whitespace & capitalizes first letter');
const longEmojiStr = '🛒'.repeat(55);
const normEmojiResult = normDesc(longEmojiStr);
assert(Array.from(normEmojiResult).length === 50, 'normDesc safely truncates emoji surrogate pairs without malformed JSON characters');
assert((function() { try { encodeURIComponent(normEmojiResult); return true; } catch(e) { return false; } })(), 'normEmojiResult is valid UTF-16 without unpaired surrogates');

// 3. Money formatting
assert(money(250).includes('250'), 'money(250) formats INR integer');
assert(money(250.50).includes('250.50'), 'money(250.50) formats INR decimal');

// 4. Family vs Personal scope detection
assert(isFamilyEntry('⚡ Electricity Bill') === true, 'isFamilyEntry identifies electricity bill as family');
assert(isFamilyEntry('👧 Niece Allowance') === true, 'isFamilyEntry identifies niece allowance as family');
assert(isFamilyEntry('🛒 Grocery') === false, 'isFamilyEntry identifies grocery as personal');

// 5. Group by Day
const sampleEntries = [
  { id: '1', amount: 100, desc: 'Milk', ts: new Date('2026-10-04T10:00:00Z').getTime() },
  { id: '2', amount: 50, desc: 'Bread', ts: new Date('2026-10-04T12:00:00Z').getTime() },
  { id: '3', amount: 300, desc: 'Petrol', ts: new Date('2026-10-03T15:00:00Z').getTime() }
];

const days = groupByDay(sampleEntries);
assert(days.length === 2, 'groupByDay groups entries into 2 days');

// 6. Month Totals
const months = monthTotals(sampleEntries);
assert(months.length === 1, 'monthTotals calculates month summaries');
assert(months[0].total === 450, 'monthTotals correctly sums amounts in paise without rounding error');

// 7. Local ISO string helper
const iso = toLocalISOString(new Date('2026-10-04T10:30:00').getTime());
assert(iso.includes('2026-10-04T10:30'), 'toLocalISOString formats local datetime');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
