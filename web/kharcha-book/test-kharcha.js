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

const { parseAmount, normDesc, money, groupByDay, byDescription, monthTotals, toLocalISOString, isFamilyEntry, parseBankSMS, categoryBreakdown } = windowMock.__kharcha;

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

// 8. Bank SMS Parser tests
const hdfcSMS = "AD-HDFCBK: Rs.450.00 debited from A/C **1234 on 04-OCT-26 to SWIGGY via UPI Ref 42781923.";
const parsedHdfc = parseBankSMS(hdfcSMS);
assert(parsedHdfc.valid === true && parsedHdfc.amount === 450 && parsedHdfc.bank === 'HDFC Bank', 'parseBankSMS parses valid HDFC debit SMS');

const iciciSMS = "Dear Customer, A/C X6789 has been debited by Rs 1,250.00 on 04-Oct-26 for BESCOM Electricity Bill payment. ICICI Bank.";
const parsedIcici = parseBankSMS(iciciSMS);
assert(parsedIcici.valid === true && parsedIcici.amount === 1250 && parsedIcici.scope === 'family', 'parseBankSMS identifies ICICI electricity bill as Family scope');

const otpMsg = "Your OTP for Login to XYZ Store is 482910. Do not share with anyone. Rs 500 off!";
const parsedOTP = parseBankSMS(otpMsg);
assert(parsedOTP.valid === false && parsedOTP.error.includes('OTP'), 'parseBankSMS rejects OTP messages');

const spamMsg = "Congratulations! You got Rs 50,000 pre-approved loan from QuickCash. Click http://spam.link to claim.";
const parsedSpam = parseBankSMS(spamMsg);
assert(parsedSpam.valid === false && parsedSpam.error.includes('promotional'), 'parseBankSMS rejects fake loan promotional spam');

const creditMsg = "Rs 1,000.00 credited to A/C XX1234 on 04-Oct-26 by VPA salary@company. SBI";
const parsedCredit = parseBankSMS(creditMsg);
assert(parsedCredit.valid === false && parsedCredit.error.includes('credit'), 'parseBankSMS rejects income credit messages');

// 9. Category Breakdown tests
const catRes = categoryBreakdown([
  { amount: 1500, desc: '🛒 General Grocery' },
  { amount: 500, desc: '🛒 Supermarket' },
  { amount: 800, desc: '⚡ Electricity Bill' }
]);
assert(catRes.categories.length === 2, 'categoryBreakdown groups expenses into 2 categories');
assert(catRes.categories[0].name === '🛒 Grocery' && catRes.categories[0].total === 2000, 'categoryBreakdown sums total per category');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
