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

const { parseAmount, normDesc, money, groupByDay, byDescription, monthTotals, toLocalISOString, isFamilyEntry, parseBankSMS, parseSMSDate, findDuplicate, categoryBreakdown, monthCompare, isIncome, isMotherSettlement, isMotherPension, isSalary, isExpense, isInvestment, getFamilySettlement, getPersonalCashFlow, isProjectEntry, isProjectMotherPaid, getProjectSummary, isTripEntry, getTripSummary, getEntryScope, shiftScopeDesc } = windowMock.__kharcha;

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

// 8b. Messages that must NOT become expenses (false positives seen in real use)
const NOW = new Date(2026, 9, 4, 18, 30).getTime(); // 4 Oct 2026, 6:30 pm local
const mustReject = [
  ['failed UPI payment', 'SBI: Your UPI txn of Rs 500 to merchant@ybl has failed. Amount will be refunded if debited.', 'failed'],
  ['declined card swipe', 'HDFC Bank Card XX4321 txn of Rs 2,000 at FLIPKART declined due to insufficient balance.', 'failed'],
  ['reversal', 'HDFC Bank: Rs 799 reversed to your a/c **1234 for txn paid to Amazon on 01-10.', 'refund'],
  ['refund credited', 'ICICI Bank: Refund of INR 349.00 from MYNTRA credited to your a/c XX1234.', 'refund'],
  ['future autopay', 'Axis Bank: Mandate for Rs 649 to Netflix will be debited on 05-10-26 from a/c XX9988.', 'future'],
  ['card bill reminder', 'ICICI Bank Credit Card XX4321: Total amount due Rs 12,345. Min due Rs 620. Pay by 10-Oct to avoid charges.', 'future'],
  ['money received', 'Your a/c XX1234 is credited with Rs 5000 by Rahul via UPI. Avl bal Rs 12,000 paid', 'credit'],
  ['salary credit', 'Rs 1,000.00 credited to A/C XX1234 on 04-Oct-26 by VPA salary@company. SBI', 'credit'],
  ['payment request', 'ICICI Bank: Rahul has requested money of Rs 2,000 from you on Google Pay. Pay only if you know the sender.', 'request'],
  ['phishing', 'Dear customer your SBI account will be blocked. Update KYC http://bit.ly/x Rs 10 debited', 'scam'],
  ['card bill payment', 'Payment of Rs 12,345 received towards your ICICI Bank Credit Card XX4321. Thank you.', 'transfer'],
  ['bill paid via CRED', 'HDFC Bank: Rs 5,000 debited from a/c **1234 to VPA cred.club@axisb (UPI Ref No 998877665544).', 'transfer'],
  ['self transfer', 'Kotak Bank: Rs 10,000 debited from a/c XX5678 for self transfer to a/c XX1234. UPI Ref 556677889900.', 'transfer'],
  ['balance alert', 'Kotak: Avl bal in a/c XX5678 is Rs 3,456.78 as on 03-Oct. Low balance alert.', 'nodebit'],
  ['cashback', 'Paytm: Cashback of Rs 25 credited to your wallet for payment to Zomato.', 'refund'],
];
mustReject.forEach(([name, sms, kind]) => {
  const r = parseBankSMS(sms, NOW);
  assert(r.valid === false && r.kind === kind, `rejects ${name} (${kind})` + (r.valid ? ` — got ₹${r.amount}` : r.kind !== kind ? ` — got ${r.kind}` : ''));
});

// 8c. Real debits: right amount, payee, ref, account and date
const realUPI = parseBankSMS('HDFC Bank: Rs 450.00 debited from a/c **1234 on 03-10-26 to VPA swiggy@icici (UPI Ref No 123456789012). Not you? Call 18002586161', NOW);
assert(realUPI.valid && realUPI.amount === 450 && realUPI.bank === 'HDFC Bank', 'real UPI debit is accepted with correct amount');
assert(realUPI.rawPayee === 'Swiggy' && realUPI.desc.includes('Food'), 'payee is read from the UPI ID (swiggy@icici -> Swiggy, Food)');
assert(realUPI.refNo === '123456789012' && realUPI.account === '1234', 'reference number and account are extracted');
assert(new Date(realUPI.ts).getDate() === 3 && new Date(realUPI.ts).getMonth() === 9, 'date is taken from the SMS (03-10-26), not today');
assert(realUPI.confidence === 'high', 'complete bank SMS is high confidence');

const balanceFirst = parseBankSMS('Avl Bal Rs 25,000.00. Rs 300 debited from a/c XX1234 to zepto@ybl', NOW);
assert(balanceFirst.valid && balanceFirst.amount === 300, 'balance shown before the amount is ignored (300, not 25,000)');

const cardSwipe = parseBankSMS('Kotak Bank: Rs.1,299.00 spent on Credit Card XX4321 at AMAZON on 02-Oct-26. Avl limit Rs 50,000', NOW);
assert(cardSwipe.valid && cardSwipe.amount === 1299 && cardSwipe.bank === 'Kotak Bank' && cardSwipe.rawPayee === 'Amazon', 'card swipe: amount, bank (not Amazon Pay) and merchant');

const sbiStyle = parseBankSMS('Dear UPI user A/C X1234 debited by 300.0 on date 03Oct26 trf to ZEPTO Refno 412345678901. If not u? call 1800111109. -SBI', NOW);
assert(sbiStyle.valid && sbiStyle.amount === 300 && sbiStyle.refNo === '412345678901' && sbiStyle.bank === 'State Bank of India', 'SBI format without "Rs" is parsed');
assert(new Date(sbiStyle.ts).getDate() === 3, 'SBI compact date 03Oct26 is parsed');

const credLimit = parseBankSMS('ICICI Bank: INR 2,500.00 spent using Card XX9999 on 01-Oct-26 at DMART. Avl Limit: INR 47,500.00.', NOW);
assert(credLimit.valid && credLimit.amount === 2500 && credLimit.scope === 'family', 'available limit is ignored; DMart is family grocery');

const noBank = parseBankSMS('Rs 200 debited for chai', NOW);
assert(noBank.valid && noBank.confidence === 'check', 'unknown sender is accepted but flagged "check"');

// 8d. SMS dates
assert(parseSMSDate('on 04-Oct-26 at 10:32 AM', NOW) === new Date(2026, 9, 4, 10, 32).getTime(), 'parseSMSDate reads date + time');
assert(parseSMSDate('on 04-Oct-26', NOW) === NOW, 'parseSMSDate uses "now" for today without a time');
assert(parseSMSDate('on 25-12-26', NOW) === null, 'parseSMSDate rejects future dates');
assert(parseSMSDate('on 31-02-26', NOW) === null, 'parseSMSDate rejects impossible dates');

// 8e. Duplicate detection
const existing = [
  { id: 'a', amount: 450, desc: 'Swiggy', ts: new Date(2026, 9, 3, 12).getTime(), refNo: '123456789012' },
  { id: 'b', amount: 300, desc: 'Zepto', ts: NOW, refNo: null }
];
assert(findDuplicate(realUPI, existing, NOW).kind === 'exact', 'same UPI reference is an exact duplicate');
assert(findDuplicate(balanceFirst, existing, NOW).kind === 'likely', 'same amount on the same day is a likely duplicate');
assert(findDuplicate(cardSwipe, existing, NOW) === null, 'different amount is not a duplicate');

// 9. Category Breakdown tests
const catRes = categoryBreakdown([
  { amount: 1500, desc: '🛒 General Grocery' },
  { amount: 500, desc: '🛒 Supermarket' },
  { amount: 800, desc: '⚡ Electricity Bill' }
]);
assert(catRes.categories.length === 2, 'categoryBreakdown groups expenses into 2 categories');
assert(catRes.categories[0].name === '🛒 Grocery' && catRes.categories[0].total === 2000, 'categoryBreakdown sums total per category');

const cmp = monthCompare([{ amount: 1200, desc: '🛒 General Grocery' }], [{ amount: 1000, desc: '🛒 General Grocery' }]);
assert(cmp.pct === 20 && cmp.prevCats['🛒 Grocery'] === 1000, 'monthCompare gives % change and last month per category');

// 10. Smart telecom/wifi categorization
const telecomRes = categoryBreakdown([
  { amount: 975.62, desc: 'WWW AIRTEL (ICICI Card XX1014)' },
  { amount: 399, desc: 'Jio Prepaid Recharge' }
]);
assert(telecomRes.categories[0].name === '📱 Mobile & WiFi' && telecomRes.categories[0].total === 1374.62, 'Airtel and Jio map to 📱 Mobile & WiFi category');

// 11. Incomings, Salaries, and Pension identification
assert(isIncome({ desc: '💼 Salary 1' }) === true, 'isIncome identifies Salary 1');
assert(isIncome({ desc: '💼 Salary 2 (Secondary)' }) === true, 'isIncome identifies Salary 2');
assert(isIncome({ desc: '👵 Mother’s Pension' }) === true, 'isIncome identifies Mother pension');
assert(isIncome({ desc: '👵 Withdrawn from Mother (Family Settlement)' }) === true, 'isIncome identifies Mother settlement withdrawal');
assert(isIncome({ desc: '🛒 Grocery' }) === false, 'isIncome rejects regular grocery expense');
assert(isExpense({ desc: '🛒 Grocery' }) === true, 'isExpense accepts regular grocery expense');
assert(isIncome({ desc: '💰 Other / UPI (Refund from Rahul)' }) === true, 'isIncome identifies 💰 Other / UPI incoming');
assert(isIncome({ desc: 'Salary October' }) === true, 'isIncome accepts plain-text salary entry');
assert(isIncome({ desc: 'Pension' }) === true, 'isIncome accepts plain-text pension entry');
assert(isIncome({ desc: 'Income tax payment' }) === false, 'isIncome rejects income tax (an expense)');
assert(isIncome({ desc: 'LIC pension plan premium' }) === false, 'isIncome rejects pension premium (an expense)');
assert(isIncome({ desc: 'Salary to maid Sunita' }) === false, 'isIncome rejects salary paid to maid (an expense)');
assert(isIncome({ desc: 'Milk and income' }) === false, 'isIncome ignores income word not at start');
assert(isExpense({ desc: '💼 Salary 1' }) === false, 'isExpense rejects salary');

assert(isSalary({ desc: '💼 Salary 1' }) === true, 'isSalary identifies salary');
assert(isSalary({ desc: '👵 Withdrawn from Mother' }) === false, 'isSalary rejects mother withdrawal');
assert(isMotherSettlement({ desc: '👵 Withdrawn from Mother (Family Settlement)' }) === true, 'isMotherSettlement identifies settlement');
assert(isMotherSettlement({ desc: '💼 Salary 1' }) === false, 'isMotherSettlement rejects salary');

// 12. Family Settlement Reconciliation calculations
const octEntries = [
  // User personal salaries
  { id: 'i1', amount: 80000, desc: '💼 Salary 1', ts: new Date('2026-10-01T10:00:00Z').getTime() },
  { id: 'i2', amount: 25000, desc: '💼 Salary 2', ts: new Date('2026-10-05T10:00:00Z').getTime() },
  // Mother pension
  { id: 'i3', amount: 30000, desc: '👵 Mother’s Pension', ts: new Date('2026-10-02T10:00:00Z').getTime() },
  // Family expenses paid upfront by user
  { id: 'e1', amount: 3200, desc: '🏠 ⚡ Electricity Bill', ts: new Date('2026-10-03T10:00:00Z').getTime() },
  { id: 'e2', amount: 4500, desc: '🏠 🛒 Monthly Grocery', ts: new Date('2026-10-03T12:00:00Z').getTime() },
  { id: 'e3', amount: 2000, desc: '🏠 🧹 Maid Salary', ts: new Date('2026-10-04T10:00:00Z').getTime() },
  // Personal expenses of user
  { id: 'e4', amount: 5000, desc: '💊 Health Insurance / Medical', ts: new Date('2026-10-04T14:00:00Z').getTime() },
  { id: 'e5', amount: 1500, desc: '🍔 Weekend Dining / Party', ts: new Date('2026-10-04T20:00:00Z').getTime() }
];

const setlBefore = getFamilySettlement(octEntries);
assert(setlBefore.familySpent === 9700, 'getFamilySettlement sums family spent: 3200+4500+2000 = 9700');
assert(setlBefore.motherWithdrawn === 0, 'getFamilySettlement has 0 withdrawn initially');
assert(setlBefore.pending === 9700, 'getFamilySettlement shows 9700 pending to withdraw');
assert(setlBefore.status === 'pending', 'getFamilySettlement status is pending');

// Simulate user withdrawing / settling 9700 from Mother's account
const octEntriesSettled = octEntries.concat([
  { id: 'i4', amount: 9700, desc: '👵 Withdrawn from Mother (Family Settlement)', ts: new Date('2026-10-06T10:00:00Z').getTime() }
]);

const setlAfter = getFamilySettlement(octEntriesSettled);
assert(setlAfter.familySpent === 9700, 'familySpent stays 9700 after settlement');
assert(setlAfter.motherWithdrawn === 9700, 'motherWithdrawn becomes 9700');
assert(setlAfter.pending === 0, 'pending becomes 0 after full settlement');
assert(setlAfter.status === 'settled', 'settlement status becomes settled');

// 13. Personal Cash Flow calculations
const cf = getPersonalCashFlow(octEntriesSettled);
assert(cf.salaries === 105000, 'Personal salaries = 80000 + 25000 = 105000');
assert(cf.personalSpent === 6500, 'Personal spent = 5000 + 1500 = 6500 (family 9700 excluded!)');
assert(cf.personalSavings === 98500, 'Personal savings = 105000 - 6500 = 98500');
assert(cf.savingsRate === 94, 'Savings rate = 94%');

// 14. Project & Renovation Tracking (Labour, Materials, Payer separation)
assert(isProjectEntry('🔨 House Renovation 👤 Labour daily wage') === true, 'isProjectEntry identifies renovation hammer tag');
assert(isProjectEntry('Tiles and Granite for renovation') === true, 'isProjectEntry identifies renovation keyword');
assert(isProjectEntry('Ramesh labour wage') === true, 'isProjectEntry identifies labour keyword');
assert(isProjectEntry('🛒 Grocery') === false, 'isProjectEntry rejects non-project spend');

assert(isProjectMotherPaid('🔨 House Renovation 👵 Cement bags from Mother cash') === true, 'isProjectMotherPaid detects mother paid project entry');
assert(isProjectMotherPaid('🔨 House Renovation 👤 Labour wage') === false, 'isProjectMotherPaid rejects user paid project entry');

// Project entry paid by User flows into Family Settlement!
assert(isFamilyEntry('🔨 House Renovation 👤 Labour daily wage') === true, 'Renovation entry paid by User is counted as Family spend for reimbursement');
// Project entry paid directly by Mother does NOT create reimbursement debt
assert(isFamilyEntry('🔨 House Renovation 👵 Cement bags from Mother cash') === false, 'Renovation entry paid by Mother does not create reimbursement debt');

const projectEntries = [
  { id: 'p1', amount: 1500, desc: '🔨 House Renovation 👤 Labour daily wage', ts: Date.now() },
  { id: 'p2', amount: 3000, desc: '🔨 House Renovation 👤 Mistri / Mason wage', ts: Date.now() },
  { id: 'p3', amount: 5000, desc: '🔨 House Renovation 👵 Tiles and Cement bags', ts: Date.now() },
  { id: 'p4', amount: 200, desc: '🛒 Regular snacks', ts: Date.now() }
];

const projSummary = getProjectSummary(projectEntries);
assert(projSummary.entries.length === 3, 'getProjectSummary extracts 3 project entries (ignores snacks)');
assert(projSummary.totalSpent === 9500, 'getProjectSummary sums total spent = 1500 + 3000 + 5000 = 9500');
assert(projSummary.meSpent === 4500, 'getProjectSummary sums paid by me = 1500 + 3000 = 4500');
assert(projSummary.motherSpent === 5000, 'getProjectSummary sums paid by mother = 5000');

// Verify that user-paid renovation (4500) automatically adds to Family Settlement pending balance
const setlWithProj = getFamilySettlement(projectEntries);
assert(setlWithProj.familySpent === 4500, 'Family settlement includes user-paid renovation (4500) and excludes mother-paid (5000)');
assert(setlWithProj.pending === 4500, 'Family settlement shows 4500 pending reimbursement to user');

// 15. Investment Tracking (SIP, Mutual Funds, Stocks - separated from personal expenses)
assert(isInvestment({ desc: '📈 SIP Axis Bluechip' }) === true, 'isInvestment identifies SIP with 📈 tag');
assert(isInvestment({ desc: '📈 Mutual Fund Parag Parikh' }) === true, 'isInvestment identifies mutual fund with tag');
assert(isInvestment({ desc: 'SIP payment' }) === true, 'isInvestment identifies plain SIP keyword');
assert(isInvestment({ desc: 'PPF contribution' }) === true, 'isInvestment identifies PPF keyword');
assert(isInvestment({ desc: 'Fixed Deposit SBI' }) === true, 'isInvestment identifies FD keyword');
assert(isInvestment({ desc: 'Reliance shares' }) === true, 'isInvestment identifies shares keyword');
assert(isInvestment({ desc: '🛒 Grocery' }) === false, 'isInvestment rejects grocery');
assert(isInvestment({ desc: '💼 Salary 1' }) === false, 'isInvestment rejects salary');
assert(isExpense({ desc: '📈 SIP Axis Bluechip' }) === false, 'isExpense excludes investments');
assert(isIncome({ desc: '📈 SIP Axis Bluechip' }) === false, 'isIncome excludes investments');

// Verify cash flow correctly isolates investments from personal spends
const entriesWithInvest = [
  { id: 's1', amount: 80000, desc: '💼 Salary 1', ts: Date.now() },
  { id: 'p1', amount: 5000, desc: '🛒 Grocery', ts: Date.now() },
  { id: 'i1', amount: 15000, desc: '📈 SIP Parag Parikh Flexi Cap', ts: Date.now() },
  { id: 'i2', amount: 10000, desc: '📈 Stocks Zerodha', ts: Date.now() },
  { id: 'f1', amount: 3000, desc: '🏠 ⚡ Electricity Bill', ts: Date.now() }
];

const cfWithInvest = getPersonalCashFlow(entriesWithInvest);
assert(cfWithInvest.salaries === 80000, 'Salaries = 80000');
assert(cfWithInvest.personalSpent === 5000, 'Personal spent = 5000 (excludes investments and family bills)');
assert(cfWithInvest.totalInvested === 25000, 'Total invested = 15000 + 10000 = 25000');
assert(cfWithInvest.personalSavings === 75000, 'Personal savings = 80000 - 5000 = 75000');

// 16. Scope Shifting (1-tap move between Personal, Family, and Investment)
assert(getEntryScope({ desc: '🛒 Grocery' }) === 'personal', 'getEntryScope defaults plain expense to personal');
assert(getEntryScope({ desc: '👤 Petrol' }) === 'personal', 'getEntryScope identifies personal tag');
assert(getEntryScope({ desc: '🏠 ⚡ Electricity Bill' }) === 'family', 'getEntryScope identifies family tag');
assert(getEntryScope({ desc: '📈 SIP Axis Bluechip' }) === 'investment', 'getEntryScope identifies investment tag');

// Shifting to Family
assert(shiftScopeDesc('🛒 Grocery', 'family') === '🏠 🛒 Grocery', 'shiftScopeDesc moves personal to family preserving category emoji');
assert(shiftScopeDesc('👤 Petrol', 'family') === '🏠 Petrol', 'shiftScopeDesc removes personal tag and adds family tag');
assert(shiftScopeDesc('📈 Mutual Fund', 'family') === '🏠 Mutual Fund', 'shiftScopeDesc moves investment to family');

// Shifting to Personal
assert(shiftScopeDesc('🏠 ⚡ Electricity Bill', 'personal') === '👤 ⚡ Electricity Bill', 'shiftScopeDesc moves family to personal');
assert(shiftScopeDesc('📈 Stocks Zerodha', 'personal') === '👤 Stocks Zerodha', 'shiftScopeDesc moves investment to personal');

// Shifting to Investment
assert(shiftScopeDesc('🛒 PPF Contribution', 'investment') === '📈 🛒 PPF Contribution', 'shiftScopeDesc moves personal to investment preserving category emoji');
assert(shiftScopeDesc('🏠 Mutual Fund', 'investment') === '📈 Mutual Fund', 'shiftScopeDesc moves family to investment');

// Preserving raw description cleanly
assert(shiftScopeDesc('', 'personal') === '👤 Expense', 'shiftScopeDesc falls back cleanly for empty desc');

// 17. Trip / Event Mode Tracking (Option B Strict Manual Toggle & Tagging)
assert(isTripEntry({ desc: '✈️ Goa Trip: Swiggy' }) === true, 'isTripEntry identifies ✈️ tag');
assert(isTripEntry({ desc: '✈️ Flight to Mumbai' }) === true, 'isTripEntry identifies plane flight');
assert(isTripEntry({ desc: 'Trip: Taxi to airport' }) === true, 'isTripEntry identifies trip: prefix');
assert(isTripEntry('✈️ Goa Trip: Hotel') === true, 'isTripEntry accepts raw string');
assert(isTripEntry({ desc: '🛒 Grocery' }) === false, 'isTripEntry rejects grocery');
assert(isTripEntry({ desc: '🏠 ⚡ Electricity Bill' }) === false, 'isTripEntry rejects family bill');

// getEntryScope with Trip
assert(getEntryScope({ desc: '✈️ Goa Trip: Hotel' }) === 'trip', 'getEntryScope returns trip for trip entry');

// Shifting to Trip
assert(shiftScopeDesc('🛒 Dinner with Friends', 'trip', 'Goa Trip') === '✈️ Goa Trip: 🛒 Dinner with Friends', 'shiftScopeDesc shifts to named trip preserving item');
assert(shiftScopeDesc('🏠 ⚡ Electricity Bill', 'trip', 'Goa Trip') === '✈️ Goa Trip: ⚡ Electricity Bill', 'shiftScopeDesc strips family tag when shifting to trip');
assert(shiftScopeDesc('✈️ Goa Trip: Swiggy', 'personal') === '👤 Swiggy', 'shiftScopeDesc strips trip tag cleanly when moving back to personal');

// Trip Summary
const tripEntries = [
  { id: 't1', amount: 4500, desc: '✈️ Goa Trip: Flight Indigo', ts: new Date('2026-11-20T10:00:00Z').getTime() },
  { id: 't2', amount: 3200, desc: '✈️ Goa Trip: Hotel Resort', ts: new Date('2026-11-20T14:00:00Z').getTime() },
  { id: 't3', amount: 1500, desc: '✈️ Goa Trip: Beach Dinner', ts: new Date('2026-11-21T20:00:00Z').getTime() },
  { id: 'p1', amount: 500, desc: '🛒 Home Grocery', ts: new Date('2026-11-20T08:00:00Z').getTime() }
];

const goaSummary = getTripSummary(tripEntries, 'Goa Trip');
assert(goaSummary.totalSpent === 9200, 'getTripSummary sums Goa trip spent: 4500 + 3200 + 1500 = 9200');
assert(goaSummary.itemsCount === 3, 'getTripSummary counts 3 trip items (excludes grocery)');
assert(goaSummary.daysCount === 2, 'getTripSummary counts 2 unique trip days');
assert(goaSummary.dailyAvg === 4600, 'getTripSummary calculates daily average: 9200 / 2 = 4600');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
