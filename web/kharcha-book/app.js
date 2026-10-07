(function () {
  'use strict';

  var CFG = window.KHARCHA_CONFIG || {};

  /* ---------- pure logic ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function paise(x) { return Math.round(x * 100); }
  function sumRupees(list) { return list.reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100; }
  function parseAmount(s) {
    var t = String(s).replace(/[,\s₹]/g, '');
    if (t === '' || t === '.' || !/^\d*\.?\d{0,2}$/.test(t)) return null;
    var n = Number(t);
    return n > 0 && n < 1e9 ? n : null;
  }
  function safeTruncate(str, len) {
    var s = String(str || '');
    try {
      encodeURIComponent(s);
    } catch (err) {
      s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    }
    return Array.from(s).slice(0, len || 50).join('');
  }
  function normDesc(s) {
    var t = safeTruncate(String(s).replace(/\s+/g, ' ').trim(), 50);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }
  function toLocalISOString(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  var inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  var inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(v) { return Number.isInteger(v) ? inr0.format(v) : inr2.format(v); }
  function byTimeDesc(a, b) { return b.ts - a.ts || (a.id < b.id ? 1 : -1); }

  // Plain-text incomings (no emoji tag) must *start* with one of these words...
  var INCOME_WORD_START = /^(?:salary|pension|income)\b/;
  // ...and not read like a payment of it ("Income tax", "LIC pension premium", "Salary to maid").
  var PAID_OUT_WORDS = /\b(?:tax|premium|policy|plan|fund|contribution|emi|paid|to|maid)\b/;

  function isIncome(e) {
    if (!e || !e.desc) return false;
    var d = e.desc.trim().toLowerCase();
    // Expenses tagged with 🏠, 👤, 🔨 (project spends), or 📈 (investments) are not income
    if (d.startsWith('🏠') || d.startsWith('👤') || d.includes('🔨') || d.includes('📈')) return false;
    // Incomings added from the app carry 💼 / 👵 / 💰 tags
    if (d.includes('💼') || d.includes('👵') || d.startsWith('💰')) return true;
    if (d.includes('withdrawn from mother')) return true;
    return INCOME_WORD_START.test(d) && !PAID_OUT_WORDS.test(d);
  }

  function isMotherSettlement(e) {
    if (!e || !e.desc) return false;
    var d = e.desc.toLowerCase();
    return d.includes('withdrawn from mother') || (d.includes('👵') && d.includes('withdraw'));
  }

  function isMotherPension(e) {
    if (!e || !e.desc) return false;
    var d = e.desc.toLowerCase();
    return (d.includes('👵') && (d.includes('pension') || !d.includes('withdraw'))) || (d.includes('pension') && !d.includes('withdrawn'));
  }

  function isSalary(e) {
    if (!e || !e.desc || !isIncome(e)) return false;
    var d = e.desc.toLowerCase();
    return (d.includes('💼') || d.includes('salary')) && !isMotherSettlement(e) && !d.includes('maid');
  }

  function isInvestment(e) {
    if (!e || !e.desc) return false;
    var d = e.desc.trim().toLowerCase();
    return d.includes('📈') || d.startsWith('investment') || d.includes('mutual fund') || d.includes('sip') || d.includes('ppf') || d.includes('nps') || d.includes('fixed deposit') || d.includes('fd ') || d.includes('stocks') || d.includes('shares');
  }

  function isExpense(e) {
    return !isIncome(e) && !isInvestment(e);
  }

  function isProjectEntry(desc) {
    var d = (desc || '').toLowerCase();
    return d.includes('🔨') || d.includes('renovation') || d.includes('labour') || d.includes('mistri');
  }

  function isProjectMotherPaid(desc) {
    var d = (desc || '').toLowerCase();
    return isProjectEntry(d) && (d.includes('👵') || d.includes('mother'));
  }

  function isFamilyEntry(desc) {
    var d = (desc || '').toLowerCase();
    // If it's a project entry paid directly by Mother, it does NOT create a family reimbursement debt
    if (isProjectMotherPaid(d)) return false;
    // If it's a project entry paid by User, it IS included in family settlement reimbursement!
    if (isProjectEntry(d)) return true;
    return d.includes('🏠') || d.includes('family') || d.includes('niece') || d.includes('electricity') || d.includes('gas') || d.includes('bill');
  }

  function getProjectSummary(monthEntries) {
    var list = (monthEntries || []).filter(function (e) {
      return isExpense(e) && isProjectEntry(e.desc);
    });
    var totalSpent = list.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var meEntries = list.filter(function (e) { return !isProjectMotherPaid(e.desc); });
    var motherEntries = list.filter(function (e) { return isProjectMotherPaid(e.desc); });
    var meSpent = meEntries.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var motherSpent = motherEntries.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    return {
      entries: list,
      totalSpent: totalSpent,
      meEntries: meEntries,
      meSpent: meSpent,
      motherEntries: motherEntries,
      motherSpent: motherSpent
    };
  }

  function getFamilySettlement(monthEntries) {
    var list = monthEntries || [];
    var familyExpenses = list.filter(function (e) { return isExpense(e) && isFamilyEntry(e.desc); });
    var familySpent = familyExpenses.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;

    var motherSettledEntries = list.filter(function (e) { return isIncome(e) && isMotherSettlement(e); });
    var motherWithdrawn = motherSettledEntries.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;

    var pending = Math.max(0, (familySpent * 100 - motherWithdrawn * 100) / 100);
    var status = pending === 0 ? 'settled' : 'pending';

    return {
      familyExpenses: familyExpenses,
      familySpent: familySpent,
      motherSettledEntries: motherSettledEntries,
      motherWithdrawn: motherWithdrawn,
      pending: pending,
      status: status
    };
  }

  function getPersonalCashFlow(monthEntries) {
    var list = monthEntries || [];
    var salaries = list.filter(function (e) { return isSalary(e); }).reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var personalExpenses = list.filter(function (e) { return isExpense(e) && !isFamilyEntry(e.desc); });
    var personalSpent = personalExpenses.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var investments = list.filter(isInvestment);
    var totalInvested = investments.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var personalSavings = (salaries * 100 - personalSpent * 100) / 100;
    var savingsRate = salaries > 0 ? Math.round((personalSavings / salaries) * 100) : 0;

    return {
      salaries: salaries,
      personalSpent: personalSpent,
      totalInvested: totalInvested,
      personalSavings: personalSavings,
      savingsRate: savingsRate
    };
  }

  function groupByDay(list) {
    var map = new Map();
    list.slice().sort(byTimeDesc).forEach(function (e) {
      var k = dayKey(e.ts);
      if (!map.has(k)) map.set(k, { key: k, ts: e.ts, items: [] });
      map.get(k).items.push(e);
    });
    return Array.from(map.values()).map(function (g) { g.total = sumRupees(g.items); return g; });
  }
  function byDescription(list) {
    var map = new Map();
    list.forEach(function (e) {
      var k = e.desc.toLowerCase();
      if (!map.has(k)) map.set(k, { label: e.desc, p: 0 });
      map.get(k).p += paise(e.amount);
    });
    return Array.from(map.values())
      .map(function (x) { return { label: x.label, total: x.p / 100 }; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  function monthTotals(entries) {
    var map = new Map();
    (entries || []).filter(isExpense).forEach(function (e) {
      var k = monthKey(e.ts);
      if (!map.has(k)) map.set(k, { key: k, items: [] });
      map.get(k).items.push(e);
    });
    return Array.from(map.values())
      .map(function (m) {
        var top = byDescription(m.items)[0];
        return { key: m.key, total: sumRupees(m.items), count: m.items.length, top: top ? top.label : '', topTotal: top ? top.total : 0 };
      })
      .sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  }

  // Whole-word matches only, so "credited" is not read as Cred and "AMAZON" (a merchant) is not read as Amazon Pay.
  var KNOWN_BANKS = [
    { name: 'HDFC Bank', match: /\bHDFC(?:BK|BANK)?\b/i },
    { name: 'ICICI Bank', match: /\bICICI(?:B|BANK)?\b/i },
    { name: 'State Bank of India', match: /\bSBI(?:INB|UPI|PSG|CRD)?\b|STATE BANK/i },
    { name: 'Axis Bank', match: /\bAXIS(?:BK)?\b/i },
    { name: 'Kotak Bank', match: /\bKOTAK(?:B|BK)?\b/i },
    { name: 'Punjab National Bank', match: /\bPNB(?:SMS)?\b/i },
    { name: 'Bank of Baroda', match: /\bBOB(?:TXT|SMS)?\b|\bBARODA\b/i },
    { name: 'Paytm Payments Bank', match: /\bPAYTM(?:B)?\b/i },
    { name: 'Google Pay', match: /\bGPAY\b|GOOGLE PAY/i },
    { name: 'PhonePe', match: /\bPHONEPE\b/i },
    { name: 'Amazon Pay', match: /AMAZON ?PAY\b|\bAMZPAY\b/i },
    { name: 'Canara Bank', match: /\bCANARA\b|\bCANBNK\b|\bCANBK\b/i },
    { name: 'IndusInd Bank', match: /\bINDUSIND\b|\bINDUSB\b|\bINDUSI\b/i },
    { name: 'IDFC FIRST Bank', match: /\bIDFC(?:FB)?\b/i },
    { name: 'Yes Bank', match: /\bYESBNK\b|\bYES BANK\b/i },
    { name: 'Union Bank', match: /\bUNION BANK\b|\bUNIONB\b|\bUBOI\b/i },
    { name: 'Federal Bank', match: /\bFEDERAL BANK\b|\bFEDBNK\b/i },
    { name: 'Cred', match: /\bCRED\b/i },
    { name: 'Slice', match: /\bSLICE(?:IT)?\b/i },
    { name: 'Jupiter', match: /\bJUPITER\b|\bJUPITR\b/i },
    { name: 'Fi Money', match: /\bFI MONEY\b|\bEPIFI\b/i }
  ];

  // Checked in order; the first match rejects the message.
  var REJECT_RULES = [
    { kind: 'otp', re: /\botp\b|one[- ]time password|verification code|secret code|do not share/i,
      msg: 'This is an OTP / verification message, not a transaction.' },
    { kind: 'scam', re: /\bkyc\b|will be (?:blocked|suspended|deactivated|closed)|has been (?:blocked|suspended|deactivated)|account (?:is )?(?:blocked|suspended)|lottery|you have won|\bclaim (?:your|now)\b|update your (?:pan|details|account)/i,
      msg: 'This looks like a scam / phishing message. Banks never ask you to update KYC or unblock an account through an SMS.' },
    { kind: 'promo', re: /pre-approved|apply (?:now|for)|congratulations|flat \d+%|reward points|earn cashback|limited period offer|get up to/i,
      msg: 'This is a promotional offer, not a debit transaction.' },
    { kind: 'request', re: /has requested|requested (?:money|payment|rs|inr|₹)|collect request|payment request/i,
      msg: 'This is a payment request. No money has left your account.' },
    { kind: 'failed', re: /\bfail(?:ed|ure)?\b|\bdeclined\b|\bunsuccessful\b|not (?:been )?processed|could not be (?:processed|completed)|\brejected\b|insufficient (?:funds|balance)/i,
      msg: 'This transaction failed, so no money was spent.' },
    { kind: 'refund', re: /\brevers(?:ed|al)\b|\brefund(?:ed)?\b|\bchargeback\b|cash ?back[\s\S]*\bcredited\b|\bcredited\b[\s\S]*cash ?back/i,
      msg: 'This is a refund / reversal (money coming back), not an expense.' },
    { kind: 'future', re: /will be debited|to be debited|\bdue (?:on|date|by)\b|\bis due\b|\bpay by\b|(?:total|min(?:imum)?) (?:amount )?due|\breminder\b|\bupcoming\b|\bscheduled\b|mandate (?:is |has been )?(?:created|registered|set ?up|approved)|autopay (?:is |has been )?(?:set|registered|enabled|activated)/i,
      msg: 'This is a reminder or an upcoming debit. Add it once the money is actually debited.' },
    { kind: 'transfer', re: /self[- ]?transfer|to (?:your )?own (?:a\/c|account)|towards [\w ]{0,30}?card|credit card (?:bill|payment)|card bill|received (?:towards|on|for) [\w ]{0,30}?card|cred\.?club|\bcred club\b/i,
      msg: 'This is a credit card bill payment or a transfer between your own accounts. It is not a new spend (the card swipes themselves are).' }
  ];

  var STRONG_OUT = /\bdebited\b|\bspent\b|\bwithdrawn\b|\bcharged\b|\bpurchase\b/i;
  var WEAK_OUT = /\bpaid\b|\bsent\b|\btrf to\b|\btransferred to\b|\bused (?:at|for|on)\b/i;
  var INCOMING = /\bcredited\b|\breceived\b|\bdeposited\b|\bcredit of\b|\badded to (?:your )?(?:wallet|a\/c|account)\b/i;
  var CUR_AMT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  var BARE_AMT = /\b(?:debited|spent|paid|withdrawn|charged)\s+(?:by|for|of|with)?\s*([\d,]+(?:\.\d{1,2})?)\b/gi;
  var BAL_WORD = /\b(?:avl|avail(?:able)?|bal|balance|limit|due|outstanding)\b/gi;

  // An amount is a balance/limit if a balance word comes right before it with no other amount or debit word in between.
  function isBalanceAmount(txt, idx) {
    var before = txt.slice(Math.max(0, idx - 30), idx), last = -1, m;
    BAL_WORD.lastIndex = 0;
    while ((m = BAL_WORD.exec(before))) last = m.index + m[0].length;
    if (last < 0) return false;
    var gap = before.slice(last);
    return !/(?:rs\.?|inr|₹)\s*\d|\d[.,]\d/i.test(gap) && !/\b(?:debited|spent|paid|withdrawn|charged)\b/i.test(gap);
  }

  function extractAmount(txt) {
    var cands = [], m;
    CUR_AMT.lastIndex = 0;
    while ((m = CUR_AMT.exec(txt))) cands.push({ v: m[1], idx: m.index });
    BARE_AMT.lastIndex = 0;
    while ((m = BARE_AMT.exec(txt))) cands.push({ v: m[1], idx: m.index + m[0].length - m[1].length });
    cands = cands.filter(function (c) { return parseAmount(c.v) && !isBalanceAmount(txt, c.idx); });
    if (!cands.length) return null;
    // Prefer the amount closest to a debit word.
    var outIdx = [], re = /\b(?:debited|spent|paid|withdrawn|charged|sent|purchase)\b/gi;
    while ((m = re.exec(txt))) outIdx.push(m.index);
    var best = cands[0], bestDist = Infinity;
    cands.forEach(function (c) {
      outIdx.forEach(function (o) {
        var d = Math.abs(o - c.idx);
        if (d < bestDist) { bestDist = d; best = c; }
      });
    });
    return { amount: parseAmount(best.v), nearDebit: bestDist < 40 };
  }

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // Returns the transaction time from the SMS (ms), or null if none / implausible. Indian dd-mm order.
  function parseSMSDate(txt, now) {
    now = now || Date.now();
    var y, mo, d, m;
    if ((m = txt.match(/\b(\d{1,2})[-\/ ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\/ ,]*(\d{4}|\d{2})(?!\d)/i))) {
      d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
    } else if ((m = txt.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
      y = +m[1]; mo = +m[2] - 1; d = +m[3];
    } else if ((m = txt.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/))) {
      d = +m[1]; mo = +m[2] - 1; y = +m[3];
    } else return null;
    if (y < 100) y += 2000;
    var hh = null, mm = 0, t = txt.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i);
    if (t && +t[1] < 24 && +t[2] < 60) {
      hh = +t[1]; mm = +t[2];
      if (t[3] && /pm/i.test(t[3]) && hh < 12) hh += 12;
      if (t[3] && /am/i.test(t[3]) && hh === 12) hh = 0;
    }
    var dt = new Date(y, mo, d, hh == null ? 12 : hh, mm);
    if (dt.getDate() !== d || dt.getMonth() !== mo) return null;
    var today = new Date(now);
    var sameDay = dt.getFullYear() === today.getFullYear() && dt.getMonth() === today.getMonth() && dt.getDate() === today.getDate();
    if (sameDay && hh == null) return now;
    var endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).getTime();
    if (dt.getTime() > endOfToday || now - dt.getTime() > 400 * 864e5) return null;
    return dt.getTime();
  }

  function extractRef(txt) {
    var m = txt.match(/(?:upi\s*ref(?:erence)?|\bref(?:erence)?|\brrn|\butr|txn\s*id|transaction\s*id)\s*(?:no\.?|num(?:ber)?|id|#)?\s*[:.#-]?\s*([A-Z0-9]{6,24})\b/i);
    return m && /\d{4,}/.test(m[1]) ? m[1].toUpperCase() : null;
  }

  function extractAccount(txt) {
    var m = txt.match(/(?:a\/c|acct|account|card)(?:\s*no\.?)?\s*(?:ending(?:\s*with)?)?\s*[:\s]*(?:[x*]+\s*)?(\d{3,4})\b/i);
    return m ? m[1] : null;
  }

  function prettyName(s) {
    return s.replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim().split(/\s+/)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
  }
  var PAYEE_STOP = /^(?:you|your|a\/?c|account|card|vpa|upi|the|bank|rs|inr|us|mobile|self)\b/i;
  function extractPayee(txt) {
    var vpa = txt.match(/\b([a-z][a-z0-9._-]{1,40})@[a-z]{2,}\b/i);
    if (vpa && !/^(?:paytmqr|bharatpe|q\d|upi|\d)/i.test(vpa[1])) {
      var n = prettyName(vpa[1]);
      if (n.length >= 2) return n;
    }
    var m = txt.match(/\b(?:at|to|trf to|info[:\s])\s*(?:vpa\s+)?([A-Za-z][A-Za-z0-9 &'._-]{1,30}?)(?=\s+(?:on|ref\w*|via|vpa|using|upi|from|for|dated|avl|with|is|has|txn)\b|[.,;(:]|\s*$)/i) ||
            txt.match(/\bfor\s+([A-Za-z][A-Za-z0-9 &'._-]{1,30}?)(?=\s+(?:payment|via|on)\b|[.,;(]|\s*$)/i);
    if (m) {
      var p = m[1].trim();
      if (p.length >= 2 && !PAYEE_STOP.test(p)) return p === p.toUpperCase() && p.length > 3 ? prettyName(p) : p;
    }
    return '';
  }

  var CATEGORY_RULES = [
    { re: /swiggy|zomato|\beats\b|\bfood\b|restaurant|\bcafe\b|domino|pizza/i, emoji: '🍔', label: function (p) { return 'Food & Dining (' + p + ')'; }, scope: 'personal' },
    { re: /zepto|blinkit|instamart|grocery|dmart|supermarket|bigbasket|bazaar/i, emoji: '🛒', label: function (p) { return 'General Grocery (' + p + ')'; }, scope: 'family' },
    { re: /electricity|bescom|tata power|torrent power|light bill/i, emoji: '⚡', label: function () { return 'Electricity Bill'; }, scope: 'family' },
    { re: /\bgas\b|indane|bharat ?gas|cylinder/i, emoji: '🔥', label: function () { return 'Gas Bill'; }, scope: 'family' },
    { re: /airtel|\bjio\b|\bvi\b|vodafone|wifi|broadband|recharge/i, emoji: '📱', label: function () { return 'Mobile & WiFi'; }, scope: 'personal' },
    { re: /hpcl|iocl|bpcl|petrol|\bfuel\b|\bshell\b/i, emoji: '⛽', label: function () { return 'Petrol / Fuel'; }, scope: 'personal' },
    { re: /\buber\b|\bola\b|rapido|namma yatri|\bauto\b|\bcab\b|\bmetro\b/i, emoji: '🛺', label: function () { return 'Auto / Cab'; }, scope: 'personal' },
    { re: /amazon|flipkart|myntra|meesho|nykaa/i, emoji: '🛍️', label: function (p) { return 'Online Shopping (' + p + ')'; }, scope: 'personal' },
    { re: /pharmacy|pharmeasy|apollo|\b1mg\b|doctor|clinic|hospital|medicine/i, emoji: '💊', label: function () { return 'Medicines & Doctor'; }, scope: 'family' },
    { re: /\bmilk\b|doodh|dairy/i, emoji: '🥛', label: function () { return 'Milk / Doodh'; }, scope: 'family' }
  ];
  function categorise(payee, txt) {
    var targets = [payee, txt];
    for (var t = 0; t < targets.length; t++) {
      if (!targets[t]) continue;
      for (var i = 0; i < CATEGORY_RULES.length; i++) {
        if (CATEGORY_RULES[i].re.test(targets[t])) return CATEGORY_RULES[i];
      }
    }
    return null;
  }

  function parseBankSMS(rawText, now) {
    if (!rawText || typeof rawText !== 'string') return { valid: false, kind: 'empty', error: 'Empty message provided.' };
    var txt = rawText.trim().replace(/\s+/g, ' ');
    if (!txt) return { valid: false, kind: 'empty', error: 'Empty message provided.' };

    // 1. Reject messages that are not money actually leaving the account
    for (var r = 0; r < REJECT_RULES.length; r++) {
      if (REJECT_RULES[r].re.test(txt)) return { valid: false, kind: REJECT_RULES[r].kind, error: REJECT_RULES[r].msg };
    }
    var strongOut = STRONG_OUT.test(txt), weakOut = WEAK_OUT.test(txt);
    if (INCOMING.test(txt) && !strongOut) {
      return { valid: false, kind: 'credit', error: 'This is a credit/income message (money received), not an expense.' };
    }

    // 2. Identify Bank / Sender (header like "AD-HDFCBK:" first, then body)
    var detectedBank = null;
    var headerMatch = txt.match(/^([A-Z]{2}-[A-Z0-9]{3,8}(?:-[A-Z0-9]+)?):\s*/i);
    var sources = headerMatch ? [headerMatch[1], txt] : [txt];
    for (var s = 0; s < sources.length && !detectedBank; s++) {
      for (var i = 0; i < KNOWN_BANKS.length; i++) {
        if (KNOWN_BANKS[i].match.test(sources[s])) { detectedBank = KNOWN_BANKS[i].name; break; }
      }
    }

    if (!strongOut && !weakOut) {
      return { valid: false, kind: 'nodebit', error: detectedBank
        ? 'Message from bank found, but does not contain a debit transaction.'
        : 'No recognized bank or debit pattern found in message.' };
    }

    // 3. Extract Amount (ignoring balances, limits and dues)
    var amt = extractAmount(txt);
    if (!amt || !amt.amount) return { valid: false, kind: 'noamount', error: 'Could not extract valid transaction amount from SMS.' };

    // 4. Details used for confidence and duplicate detection
    var refNo = extractRef(txt);
    var account = extractAccount(txt);
    var tsFromSMS = parseSMSDate(txt, now);
    var warnings = [];
    if (!detectedBank) warnings.push('Sender is not a recognised bank or UPI app.');
    if (/https?:\/\/|www\.|bit\.ly/i.test(txt)) warnings.push('Contains a link. Real debit alerts rarely need you to click anything.');
    if (!amt.nearDebit) warnings.push('Amount was not found right next to "debited/spent". Please check it.');
    if (tsFromSMS == null) warnings.push('No valid date in the SMS, so today\'s date is used.');

    // 5. Payee and category
    var payee = extractPayee(txt);
    var rawPayee = payee;
    if (!payee) payee = detectedBank ? (detectedBank + ' Spend') : 'Bank Spend';
    var cat = categorise(rawPayee, txt);
    var emoji = cat ? cat.emoji : '💳';
    var label = cat ? cat.label(payee) : payee;
    var scope = cat ? cat.scope : 'personal';
    var descWithEmoji = (scope === 'family') ? ('🏠 ' + emoji + ' ' + label) : (emoji + ' ' + label);

    var confident = detectedBank && amt.nearDebit && (refNo || account) && strongOut && !warnings.length;

    return {
      valid: true,
      bank: detectedBank || 'Bank SMS',
      amount: amt.amount,
      rawPayee: rawPayee,
      desc: descWithEmoji,
      scope: scope,
      refNo: refNo,
      account: account,
      ts: tsFromSMS,
      confidence: confident ? 'high' : 'check',
      warnings: warnings,
      rawSMS: txt
    };
  }

  // Exact = same bank reference number. Likely = same amount on the same day (when refs can't be compared).
  function findDuplicate(parsed, entries, now) {
    if (!parsed || !parsed.valid) return null;
    if (parsed.refNo) {
      var exact = entries.find(function (e) { return e.refNo && e.refNo === parsed.refNo; });
      if (exact) return { kind: 'exact', entry: exact };
    }
    var day = dayKey(parsed.ts || now || Date.now());
    var p = paise(parsed.amount);
    var likely = entries.find(function (e) {
      return paise(e.amount) === p && dayKey(e.ts) === day && !(parsed.refNo && e.refNo && e.refNo !== parsed.refNo);
    });
    return likely ? { kind: 'likely', entry: likely } : null;
  }

  function categoryBreakdown(entries) {
    var map = new Map();
    var grandTotal = sumRupees(entries);
    if (grandTotal <= 0) return { categories: [], total: 0 };

    entries.forEach(function (e) {
      var desc = e.desc || '';
      var clean = desc.replace(/^[🏠👤]\s*/, '').trim();
      var firstSymbol = Array.from(clean)[0] || '💳';
      var categoryName = clean;

      var lower = clean.toLowerCase();
      if (clean.includes('🛒') || lower.includes('grocery') || lower.includes('supermarket') || lower.includes('dmart') || lower.includes('zepto') || lower.includes('blinkit') || lower.includes('instamart') || lower.includes('bigbasket')) categoryName = '🛒 Grocery';
      else if (clean.includes('🥦') || lower.includes('vegetable') || lower.includes('sabzi') || lower.includes('fruits')) categoryName = '🥦 Vegetables';
      else if (clean.includes('🥛') || lower.includes('milk') || lower.includes('doodh') || lower.includes('dairy') || lower.includes('paneer') || lower.includes('curd')) categoryName = '🥛 Milk & Dairy';
      else if (clean.includes('⚡') || lower.includes('electricity') || lower.includes('power') || lower.includes('bescom') || lower.includes('light bill')) categoryName = '⚡ Electricity Bill';
      else if (clean.includes('🔥') || lower.includes('gas') || lower.includes('cylinder') || lower.includes('indane') || lower.includes('hp gas') || lower.includes('bharat gas')) categoryName = '🔥 Gas Bill';
      else if (clean.includes('📱') || lower.includes('airtel') || lower.includes('jio') || lower.includes('vodafone') || lower.includes('vi ') || lower.includes('wifi') || lower.includes('wi-fi') || lower.includes('broadband') || lower.includes('recharge') || lower.includes('fiber') || lower.includes('telecom')) categoryName = '📱 Mobile & WiFi';
      else if (clean.includes('⛽') || lower.includes('petrol') || lower.includes('fuel') || lower.includes('diesel') || lower.includes('cng') || lower.includes('hpcl') || lower.includes('bpcl') || lower.includes('iocl') || lower.includes('shell')) categoryName = '⛽ Fuel';
      else if (clean.includes('🍔') || lower.includes('swiggy') || lower.includes('zomato') || lower.includes('food') || lower.includes('restaurant') || lower.includes('cafe') || lower.includes('pizza') || lower.includes('burger') || lower.includes('chai') || lower.includes('tea') || lower.includes('coffee') || lower.includes('snacks')) categoryName = '🍔 Food & Dining';
      else if (clean.includes('🛍️') || lower.includes('shopping') || lower.includes('amazon') || lower.includes('flipkart') || lower.includes('myntra') || lower.includes('meesho') || lower.includes('nykaa') || lower.includes('ajio')) categoryName = '🛍️ Online Shopping';
      else if (clean.includes('👧') || lower.includes('niece') || lower.includes('allowance')) categoryName = '👧 Niece Allowance';
      else if (clean.includes('💊') || lower.includes('medicine') || lower.includes('doctor') || lower.includes('pharmacy') || lower.includes('apollo') || lower.includes('1mg') || lower.includes('clinic') || lower.includes('hospital')) categoryName = '💊 Health & Medicines';
      else if (clean.includes('🧹') || lower.includes('maid') || lower.includes('house help') || lower.includes('kamwali')) categoryName = '🧹 House Help';
      else if (clean.includes('🛺') || lower.includes('auto') || lower.includes('cab') || lower.includes('taxi') || lower.includes('uber') || lower.includes('ola') || lower.includes('rapido') || lower.includes('metro')) categoryName = '🛺 Travel & Cab';
      else if (lower.includes('cash') || lower.includes('atm') || lower.includes('withdrawal')) categoryName = '💵 Cash Withdrawal';
      else if (lower.includes('transfer') || lower.includes('diye') || lower.includes('given to') || lower.includes('sent to')) categoryName = '🤝 Personal Transfers';
      else {
        var cleanNoPunct = clean.replace(/^[^\p{L}\p{N}]+/u, '').trim();
        categoryName = '💳 ' + (cleanNoPunct || 'Other Spends');
      }

      if (!map.has(categoryName)) map.set(categoryName, { name: categoryName, paise: 0, count: 0 });
      var item = map.get(categoryName);
      item.paise += paise(e.amount);
      item.count++;
    });

    var list = Array.from(map.values()).map(function (x) {
      var total = x.paise / 100;
      var pct = Math.round((total / grandTotal) * 100);
      return { name: x.name, total: total, count: x.count, pct: pct };
    }).sort(function (a, b) { return b.total - a.total; });

    return { categories: list, total: grandTotal };
  }

  function monthCompare(curList, prevList) {
    var cur = sumRupees(curList), prev = sumRupees(prevList), prevCats = {};
    categoryBreakdown(prevList).categories.forEach(function (c) { prevCats[c.name] = c.total; });
    return { cur: cur, prev: prev, pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null, prevCats: prevCats };
  }
  function prevMonthKey(key) {
    var p = key.split('-'); var d = new Date(+p[0], +p[1] - 2, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  var dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var tFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  var mFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  function monthLabel(key) { var p = key.split('-'); return mFmt.format(new Date(+p[0], +p[1] - 1, 1)); }
  function keyToDate(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }

  /* Exposed for tests and diagnostics. */
  window.__kharcha = {
    state: state,
    store: store,
    enterApp: enterApp,
    getSb: function () { return sb; },
    parseAmount: parseAmount, normDesc: normDesc, money: money, groupByDay: groupByDay, byDescription: byDescription, monthTotals: monthTotals, toLocalISOString: toLocalISOString, isFamilyEntry: isFamilyEntry, parseBankSMS: parseBankSMS, parseSMSDate: parseSMSDate, findDuplicate: findDuplicate, categoryBreakdown: categoryBreakdown, monthCompare: monthCompare,
    isIncome: isIncome, isMotherSettlement: isMotherSettlement, isMotherPension: isMotherPension, isSalary: isSalary, isExpense: isExpense, isInvestment: isInvestment, getFamilySettlement: getFamilySettlement, getPersonalCashFlow: getPersonalCashFlow,
    isProjectEntry: isProjectEntry, isProjectMotherPaid: isProjectMotherPaid, getProjectSummary: getProjectSummary
  };

  var TABLE = 'daily_expenses';
  var COLS = 'id, amount, description, spent_at';
  // ref_no / raw_sms come from supabase/daily_expenses_v2_sms.sql. Until that migration runs, the app falls back to COLS.
  var COLS_EXT = COLS + ', ref_no, raw_sms';
  var hasExtCols = true;
  function selectCols() { return hasExtCols ? COLS_EXT : COLS; }
  function isMissingColumn(err) {
    return err && (err.code === '42703' || err.code === 'PGRST204' || /column .*(does not exist|not find)|could not find the '.*' column/i.test(err.message || ''));
  }

  var DEFAULT_CHIPS = [
    { label: 'General Grocery', emoji: '🛒' },
    { label: 'Daily Vegetables', emoji: '🥦' },
    { label: 'Milk / Doodh', emoji: '🥛' },
    { label: 'Bread & Eggs', emoji: '🍞' },
    { label: 'Fresh Fruits', emoji: '🍎' },
    { label: 'Online Spend', emoji: '🛍️' },
    { label: 'Tea / Chai & Snacks', emoji: '☕' },
    { label: 'Electricity Bill', emoji: '⚡' },
    { label: 'Gas Bill / Cylinder', emoji: '🔥' },
    { label: 'Mobile & WiFi Recharge', emoji: '📱' },
    { label: 'Petrol / Fuel', emoji: '⛽' },
    { label: 'Niece Allowance', emoji: '👧' },
    { label: 'Medicines & Doctor', emoji: '💊' },
    { label: 'House Help / Maid', emoji: '🧹' },
    { label: 'Auto / Cab / Bus', emoji: '🛺' }
  ];

  var state = { mode: 'pending', entries: [], sel: null, editing: null, draft: null, scopeFilter: 'all', activeStream: 'spends', expandedDays: {} };
  var searchQuery = '';
  var sb = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function validEntry(e) {
    return e && typeof e.amount === 'number' && isFinite(e.amount) && typeof e.ts === 'number' && !isNaN(e.ts) && typeof e.desc === 'string';
  }
  function fromRow(r) {
    return { id: r.id, amount: Number(r.amount), desc: r.description, ts: Date.parse(r.spent_at), refNo: r.ref_no || null };
  }

  /* ---------- storage ---------- */
  var store = {
    loadAll: async function () {
      console.log('Kharcha: store.loadAll begin, selectCols=' + selectCols());
      var out = [], from = 0, size = 1000;
      while (true) {
        var res = await sb.from(TABLE).select(selectCols())
          .order('spent_at', { ascending: false }).order('id').range(from, from + size - 1);
        console.log('Kharcha: query batch res error=' + (res.error ? JSON.stringify(res.error) : 'null') + ' dataCount=' + (res.data ? res.data.length : 'null'));
        if (res.error && hasExtCols && isMissingColumn(res.error)) {
          console.warn('Kharcha: missing ext cols, retrying with basic COLS');
          hasExtCols = false; continue;
        }
        if (res.error) throw res.error;
        out = out.concat(res.data || []);
        if (!res.data || res.data.length < size) break;
        from += size;
      }
      var filtered = out.map(fromRow).filter(validEntry);
      console.log('Kharcha: store.loadAll done, total=' + filtered.length);
      return filtered;
    },
    add: async function (e) {
      if (isDemoMode) {
        var cleanDesc = safeTruncate(e.desc, 50);
        var mockEntry = { id: 'demo-' + Date.now(), amount: e.amount, desc: cleanDesc, ts: e.spent_at ? Date.parse(e.spent_at) : Date.now(), refNo: e.ref_no || null };
        state.entries.push(mockEntry);
        return;
      }
      var userRes = await sb.auth.getUser();
      if (!userRes.data || !userRes.data.user) {
        showScreen('auth');
        throw new Error("Your sign-in session expired. Please sign in again.");
      }
      var cleanDesc = safeTruncate(e.desc, 50);
      var payload = { amount: e.amount, description: cleanDesc, user_id: userRes.data.user.id };
      if (e.spent_at) payload.spent_at = e.spent_at;
      if (hasExtCols && e.ref_no) payload.ref_no = e.ref_no;
      if (hasExtCols && e.raw_sms) payload.raw_sms = safeTruncate(e.raw_sms, 500);
      var res = await sb.from(TABLE).insert([payload]).select(selectCols()).single();
      if (res.error && hasExtCols && isMissingColumn(res.error)) {
        hasExtCols = false;
        delete payload.ref_no; delete payload.raw_sms;
        res = await sb.from(TABLE).insert([payload]).select(COLS).single();
      }
      if (res.error && res.error.code === '23505') {
        throw new Error('Already added: this transaction (Ref ' + e.ref_no + ') is already in your Kharcha Book.');
      }
      if (res.error) {
        console.error('Supabase add error:', res.error);
        throw res.error;
      }
      state.entries.push(fromRow(res.data));
    },
    update: async function (id, patch) {
      var cleanDesc = safeTruncate(patch.desc, 50);
      var payload = { amount: patch.amount, description: cleanDesc };
      if (patch.spent_at) payload.spent_at = patch.spent_at;
      var res = await sb.from(TABLE).update(payload).eq('id', id).select(selectCols()).single();
      if (res.error) {
        console.error('Supabase update error:', res.error);
        throw res.error;
      }
      var i = state.entries.findIndex(function (x) { return x.id === id; });
      if (i >= 0) state.entries[i] = fromRow(res.data);
    },
    remove: async function (id) {
      var res = await sb.from(TABLE).delete().eq('id', id);
      if (res.error) throw res.error;
      state.entries = state.entries.filter(function (x) { return x.id !== id; });
    }
  };

  /* ---------- Scope Radio Pills in Form ---------- */
  function getSelectedScope() {
    var checked = document.querySelector('input[name="scope"]:checked');
    return checked ? checked.value : 'personal';
  }
  function setSelectedScope(val) {
    var radios = document.querySelectorAll('input[name="scope"]');
    radios.forEach(function (r) {
      r.checked = (r.value === val);
      r.parentElement.classList.toggle('active', r.checked);
    });
  }
  document.querySelectorAll('.scope-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var input = pill.querySelector('input');
      if (input) setSelectedScope(input.value);
    });
  });

  /* ---------- Scope Filter Tabs on Hero Card ---------- */
  document.querySelectorAll('.scopetab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.scopetab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      state.scopeFilter = tab.dataset.scope || 'all';
      render();
    });
  });

  /* ---------- Budget Feature ---------- */
  var BUDGET_KEY = 'kharcha_monthly_budget';
  function getBudget() { try { return Number(localStorage.getItem(BUDGET_KEY)) || 0; } catch (e) { return 0; } }
  function setBudget(val) { try { if (val > 0) localStorage.setItem(BUDGET_KEY, String(val)); else localStorage.removeItem(BUDGET_KEY); } catch (e) {} }

  function renderBudget(curTotal) {
    var b = getBudget();
    var status = $('budget-status');
    var fill = $('budget-fill');
    var btn = $('budget-edit-btn');
    if (!b) {
      status.textContent = 'Monthly budget: Not set';
      fill.style.width = '0%';
      fill.className = 'budget-progress-fill';
      btn.textContent = 'Set budget';
      return;
    }
    btn.textContent = 'Edit budget';
    var pct = Math.round((curTotal / b) * 100);
    status.textContent = 'Budget: ' + money(curTotal) + ' of ' + money(b) + ' (' + pct + '%)';
    fill.style.width = Math.min(100, pct) + '%';
    if (pct >= 100) fill.className = 'budget-progress-fill danger';
    else if (pct >= 80) fill.className = 'budget-progress-fill warning';
    else fill.className = 'budget-progress-fill';
  }

  /* ---------- In-App Budget Modal ---------- */
  var currentBudgetSaveCallback = null;
  var currentBudgetClearCallback = null;

  function openBudgetModal(options) {
    var modal = $('budget-modal');
    if (!modal) return;

    var titleEl = $('budget-modal-title');
    if (titleEl) titleEl.textContent = options.title || '🎯 Set Budget';

    var introEl = $('budget-modal-intro');
    if (introEl) introEl.textContent = options.intro || 'Set your spending limit in ₹. Leave blank or enter 0 to remove.';

    var spentWrap = $('budget-modal-spent-wrap');
    var spentVal = $('budget-modal-spent');
    if (spentWrap && spentVal) {
      if (options.spentText) {
        spentWrap.hidden = false;
        spentVal.textContent = options.spentText;
      } else {
        spentWrap.hidden = true;
      }
    }

    var input = $('budget-modal-input');
    if (input) {
      input.value = (options.currentValue && options.currentValue > 0) ? options.currentValue : '';
    }

    var errEl = $('budget-modal-err');
    if (errEl) errEl.hidden = true;

    var presetsWrap = $('budget-modal-presets');
    if (presetsWrap) {
      presetsWrap.textContent = '';
      var presets = options.presets || [1000, 2500, 5000, 10000];
      presets.forEach(function (amt) {
        var chip = el('button', 'budget-chip', '₹' + amt.toLocaleString('en-IN'));
        chip.type = 'button';
        chip.addEventListener('click', function () {
          if (input) {
            input.value = amt;
            if (errEl) errEl.hidden = true;
            input.focus();
          }
        });
        presetsWrap.appendChild(chip);
      });
    }

    var clearBtn = $('clear-budget-modal-btn');
    if (clearBtn) {
      clearBtn.style.display = (options.currentValue && options.currentValue > 0) ? 'inline-block' : 'none';
    }

    currentBudgetSaveCallback = options.onSave;
    currentBudgetClearCallback = options.onClear;

    modal.hidden = false;
    if (input) {
      setTimeout(function () {
        input.focus();
        input.select();
      }, 100);
    }
  }

  function closeBudgetModal() {
    var modal = $('budget-modal');
    if (modal) modal.hidden = true;
    currentBudgetSaveCallback = null;
    currentBudgetClearCallback = null;
  }

  (function initBudgetModalEvents() {
    var modal = $('budget-modal');
    if (!modal) return;

    var closeBtn = $('close-budget-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeBudgetModal);

    var cancelBtn = $('cancel-budget-modal-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeBudgetModal);

    var clearBtn = $('clear-budget-modal-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        var cb = currentBudgetClearCallback;
        closeBudgetModal();
        if (cb) cb();
      });
    }

    var input = $('budget-modal-input');
    var saveBtn = $('save-budget-modal-btn');
    var errEl = $('budget-modal-err');

    function handleSave() {
      if (!input) return;
      var raw = input.value.trim();
      if (!raw || raw === '0') {
        var cb = currentBudgetClearCallback;
        closeBudgetModal();
        if (cb) cb();
        return;
      }
      var n = Number(raw.replace(/[,\s₹]/g, ''));
      if (isNaN(n) || n < 0) {
        if (errEl) {
          errEl.textContent = 'Please enter a valid positive number.';
          errEl.hidden = false;
        }
        input.focus();
        return;
      }
      var rounded = Math.round(n * 100) / 100;
      var saveCb = currentBudgetSaveCallback;
      closeBudgetModal();
      if (saveCb) saveCb(rounded);
    }

    if (saveBtn) saveBtn.addEventListener('click', handleSave);

    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'Escape') {
          closeBudgetModal();
        }
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeBudgetModal();
    });
  })();

  /* ---------- In-App Confirm Modal ---------- */
  var confirmModalCallback = null;

  function showConfirmModal(options) {
    var modal = $('confirm-modal');
    if (!modal) {
      if (confirm(options.message)) {
        if (options.onConfirm) options.onConfirm();
      }
      return;
    }

    var titleEl = $('confirm-modal-title');
    if (titleEl) titleEl.textContent = options.title || 'Confirm Action';

    var msgEl = $('confirm-modal-msg');
    if (msgEl) msgEl.textContent = options.message || 'Are you sure?';

    var okBtn = $('ok-confirm-modal-btn');
    if (okBtn) {
      okBtn.textContent = options.confirmText || 'Confirm';
      if (options.isDanger) {
        okBtn.style.background = 'var(--danger)';
      } else {
        okBtn.style.background = '';
      }
    }

    confirmModalCallback = options.onConfirm;
    modal.hidden = false;
  }

  function closeConfirmModal() {
    var modal = $('confirm-modal');
    if (modal) modal.hidden = true;
    confirmModalCallback = null;
  }

  (function initConfirmModalEvents() {
    var modal = $('confirm-modal');
    if (!modal) return;

    var closeBtn = $('close-confirm-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeConfirmModal);

    var cancelBtn = $('cancel-confirm-modal-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeConfirmModal);

    var okBtn = $('ok-confirm-modal-btn');
    if (okBtn) {
      okBtn.addEventListener('click', function () {
        var cb = confirmModalCallback;
        closeConfirmModal();
        if (cb) cb();
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeConfirmModal();
    });
  })();

  $('budget-edit-btn').addEventListener('click', function () {
    var cur = getBudget();
    var list = visibleEntries(state.sel);
    var curTotal = list.reduce(function (s, e) { return s + e.amount; }, 0);
    openBudgetModal({
      title: '🎯 Monthly Budget',
      intro: 'Set your overall monthly spending limit. You will see real-time progress and alerts as you spend.',
      spentText: money(curTotal),
      currentValue: cur || 0,
      presets: [10000, 20000, 30000, 50000],
      onSave: function (n) {
        setBudget(n);
        render();
        toast('Monthly budget set to ' + money(n));
      },
      onClear: function () {
        setBudget(0);
        render();
        toast('Monthly budget cleared');
      }
    });
  });

  /* ---------- Search & CSV Export ---------- */
  $('search').addEventListener('input', function (ev) {
    searchQuery = ev.target.value.trim().toLowerCase();
    render();
  });

  var moveBtn = $('move-all-family');
  if (moveBtn) {
    moveBtn.addEventListener('click', function () {
      var personalEntries = state.entries.filter(function (e) { return !isFamilyEntry(e.desc); });
      if (!personalEntries.length) {
        toast('All expenses are already under Family & Bills!');
        return;
      }
      showConfirmModal({
        title: '🏠 Move to Family & Bills',
        message: 'Move ' + personalEntries.length + ' personal expense(s) to Family & Bills?',
        confirmText: 'Move All',
        onConfirm: async function () {
          moveBtn.disabled = true;
          moveBtn.textContent = 'Moving…';
          var count = 0;
          try {
            for (var i = 0; i < personalEntries.length; i++) {
              var e = personalEntries[i];
              var clean = e.desc.replace(/^[👤🏠]\s*/, '');
              var newDesc = '🏠 ' + clean;
              await store.update(e.id, { amount: e.amount, desc: newDesc, spent_at: new Date(e.ts).toISOString() });
              count++;
            }
            toast('Moved ' + count + ' expenses to Family & Bills!');
          } catch (err) {
            toast('Moved ' + count + ' expenses before error: ' + (err.message || 'failed'));
          } finally {
            moveBtn.disabled = false;
            moveBtn.textContent = '🏠 Move All to Family';
            state.entries = await store.loadAll();
            render();
          }
        }
      });
    });
  }

  $('export-csv').addEventListener('click', function () {
    var list = visibleEntries(state.sel);
    if (!list.length) { toast('No expenses to export for this view.'); return; }
    var csv = ['Date,Time,Category,Description,Amount (INR)'];
    list.sort(byTimeDesc).forEach(function (e) {
      var d = new Date(e.ts);
      var dateStr = dayKey(e.ts);
      var timeStr = tFmt.format(d);
      var catStr = isFamilyEntry(e.desc) ? 'Family/Bill' : 'Personal';
      var descStr = '"' + e.desc.replace(/"/g, '""') + '"';
      csv.push(dateStr + ',' + timeStr + ',' + catStr + ',' + descStr + ',' + e.amount);
    });
    var blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'kharcha-' + state.scopeFilter + '-' + state.sel + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded CSV for ' + monthLabel(state.sel));
  });

  /* ---------- small UI helpers ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function showErr(msg) { var e = $('err'); e.textContent = msg; e.hidden = !msg; }
  function updateStamp() {
    var n = Date.now(), s = $('stamp');
    s.textContent = dFmt.format(n) + ', ' + tFmt.format(n);
    s.setAttribute('datetime', new Date(n).toISOString());
  }

  /* ---------- render ---------- */
  // Expenses of one month after the scope tab and search box are applied.
  function visibleEntries(key) {
    var list = state.entries.filter(function (e) { return monthKey(e.ts) === key && isExpense(e); });
    if (state.scopeFilter === 'personal') {
      list = list.filter(function (e) { return !isFamilyEntry(e.desc); });
    } else if (state.scopeFilter === 'family') {
      list = list.filter(function (e) { return isFamilyEntry(e.desc); });
    }
    if (searchQuery) {
      list = list.filter(function (e) {
        return e.desc.toLowerCase().includes(searchQuery) || dFmt.format(new Date(e.ts)).toLowerCase().includes(searchQuery);
      });
    }
    return list;
  }

  // Incomings of selected month
  function visibleIncomings(key) {
    var list = state.entries.filter(function (e) { return monthKey(e.ts) === key && isIncome(e); });
    if (searchQuery) {
      list = list.filter(function (e) {
        return e.desc.toLowerCase().includes(searchQuery) || dFmt.format(new Date(e.ts)).toLowerCase().includes(searchQuery);
      });
    }
    return list;
  }

  function render() {
    var nowKey = monthKey(Date.now());
    var months = monthTotals(state.entries);
    if (!months.some(function (m) { return m.key === nowKey; })) months.unshift({ key: nowKey, total: 0, count: 0 });
    months.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    if (!state.sel || !months.some(function (m) { return m.key === state.sel; })) state.sel = nowKey;
    var idx = months.findIndex(function (m) { return m.key === state.sel; });
    var cur = months[idx];

    var list = visibleEntries(state.sel);
    var prevKey = prevMonthKey(state.sel);
    var prevList = visibleEntries(prevKey);
    var cmp = monthCompare(list, prevList);

    var displayTotal = sumRupees(list);
    var days = groupByDay(list);

    $('mlabel').textContent = monthLabel(state.sel);
    $('mtotal').textContent = money(displayTotal);
    $('sticky-month-label').textContent = monthLabel(state.sel);
    $('sticky-month-total').textContent = money(displayTotal);
    var vs = $('vs-last');
    if (vs) {
      vs.hidden = cmp.pct == null;
      if (cmp.pct != null) vs.textContent = (cmp.pct > 0 ? '▲ ' : cmp.pct < 0 ? '▼ ' : '') + Math.abs(cmp.pct) + '% vs ' + monthLabel(prevKey) + ' (' + money(cmp.prev) + ')';
    }
    $('st-count').textContent = String(list.length);
    var top = days.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var byDesc = byDescription(list)[0];
    $('st-top').textContent = byDesc ? byDesc.label + ' · ' + money(byDesc.total) : '—';
    $('st-high').textContent = top ? money(top.total) + ' · ' + dFmt.format(new Date(top.ts)) : '—';
    $('prev').disabled = idx >= months.length - 1;
    $('next').disabled = idx <= 0;

    // Cash Flow & Streams calculation for state.sel month
    var allMonthEntries = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });
    var monthExpenses = allMonthEntries.filter(isExpense);
    var monthIncomings = allMonthEntries.filter(isIncome);
    var monthInvestments = allMonthEntries.filter(isInvestment);
    var settlement = getFamilySettlement(allMonthEntries);
    var cashFlow = getPersonalCashFlow(allMonthEntries);
    var projSummary = getProjectSummary(allMonthEntries);

    renderCashFlow(cashFlow, settlement);
    renderStreamSwitcher(monthExpenses.length, monthIncomings.length, projSummary.entries.length, monthInvestments.length);

    renderBudget(cur.total);
    renderSuggestions();
    renderCategoryBreakdown(list, cmp, prevKey);
    renderBreakdown(list, displayTotal);
    renderDays(days);
    renderMonths(months);

    // Stream Views Rendering
    renderIncomingsView(monthIncomings);
    renderSettlementView(settlement);
    renderProjectView(projSummary);
    renderInvestmentsView(monthInvestments);

    renderSync();
  }

  /* ---------- Cash Flow Cards on Hero ---------- */
  function renderCashFlow(cf, setl) {
    var pSavings = $('cf-personal-savings');
    var pSub = $('cf-personal-sub');
    var famSpent = $('cf-family-spent');
    var famCount = $('cf-family-count');
    var mothStatus = $('cf-mother-status');
    var mothSub = $('cf-mother-sub');

    if (pSavings) {
      pSavings.textContent = money(cf.personalSavings);
      pSavings.style.color = '';
      pSavings.className = 'cf-amount ' + (cf.personalSavings >= 0 ? (cf.salaries > 0 ? 'positive' : '') : 'danger-soft');
    }
    if (pSub) {
      if (cf.salaries > 0) {
        var invNote = cf.totalInvested > 0 ? (' · ' + money(cf.totalInvested) + ' invested') : '';
        pSub.textContent = cf.savingsRate + '% saved' + invNote;
      } else {
        pSub.textContent = money(cf.personalSpent) + ' personal spent';
      }
    }

    if (famSpent) famSpent.textContent = money(setl.familySpent);
    if (famCount) famCount.textContent = setl.familyExpenses.length + (setl.familyExpenses.length === 1 ? ' item' : ' items');

    if (mothStatus) {
      mothStatus.style.color = '';
      if (setl.pending > 0) {
        mothStatus.textContent = money(setl.pending);
        mothStatus.className = 'cf-amount pending-debt';
      } else {
        mothStatus.textContent = money(setl.motherWithdrawn);
        mothStatus.className = 'cf-amount positive';
      }
    }
    if (mothSub) {
      mothSub.textContent = setl.pending > 0 ? 'Pending to withdraw' : 'Settled from Mother';
    }
  }

  /* ---------- Stream Switcher Tabs ---------- */
  function renderStreamSwitcher(spendsCount, incomingsCount, projCount, invCount) {
    var spCountEl = $('spends-count');
    var incCountEl = $('incomings-count');
    var projCountEl = $('projects-count');
    var invCountEl = $('investments-count');
    if (spCountEl) spCountEl.textContent = String(spendsCount);
    if (incCountEl) incCountEl.textContent = String(incomingsCount);
    if (projCountEl) projCountEl.textContent = String(projCount || 0);
    if (invCountEl) invCountEl.textContent = String(invCount || 0);

    var spendsView = $('spends-view');
    var incomingsSec = $('incomings-sec');
    var settlementSec = $('settlement-sec');
    var projectSec = $('project-sec');
    var investmentsSec = $('investments-sec');

    var stream = state.activeStream || 'spends';
    if (spendsView) spendsView.hidden = (stream !== 'spends');
    if (incomingsSec) incomingsSec.hidden = (stream !== 'incomings');
    if (settlementSec) settlementSec.hidden = (stream !== 'settlement');
    if (projectSec) projectSec.hidden = (stream !== 'projects');
    if (investmentsSec) investmentsSec.hidden = (stream !== 'investments');

    document.querySelectorAll('.streambtn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.stream === stream);
    });
  }

  document.querySelectorAll('.streambtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.activeStream = btn.dataset.stream || 'spends';
      render();
    });
  });

  /* ---------- Incomings View Rendering ---------- */
  function renderIncomingsView(monthIncomings) {
    var totalInc = sumRupees(monthIncomings);
    var salaries = monthIncomings.filter(isSalary).reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100;
    var motherInc = monthIncomings.filter(function (e) { return isMotherPension(e) || isMotherSettlement(e); }).reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100;
    var otherInc = monthIncomings.filter(function (e) { return !isSalary(e) && !isMotherPension(e) && !isMotherSettlement(e); }).reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100;

    var totalEl = $('inc-total-amt');
    var salEl = $('inc-salaries-amt');
    var mothEl = $('inc-mother-amt');
    var othEl = $('inc-others-amt');

    if (totalEl) totalEl.textContent = money(totalInc);
    if (salEl) salEl.textContent = money(salaries);
    if (mothEl) mothEl.textContent = money(motherInc);
    if (othEl) othEl.textContent = money(otherInc);

    var daysBox = $('income-days');
    if (!daysBox) return;
    daysBox.textContent = '';

    if (!monthIncomings.length) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, 'No incomings logged for ' + monthLabel(state.sel) + '. Add salary, pension, or credits above!'));
      daysBox.appendChild(em);
      return;
    }

    var days = groupByDay(monthIncomings);
    days.forEach(function (g, idx) {
      var wrap = el('section', 'day');
      var isExpanded = true;
      var wrapper = el('div', 'entries-wrapper expanded');
      var ul = el('ul', 'entries');
      g.items.forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e));
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      var head = dayHead(g, isExpanded, function () {
        var nextExpanded = !wrapper.classList.contains('expanded');
        head.classList.toggle('expanded', nextExpanded);
        wrapper.classList.toggle('expanded', nextExpanded);
      }, idx);

      wrap.appendChild(head);
      wrap.appendChild(wrapper);
      daysBox.appendChild(wrap);
    });
  }

  /* ---------- Family Settlement View Rendering ---------- */
  function renderSettlementView(setl) {
    var badge = $('settle-badge');
    var title = $('settle-title');
    var msg = $('settle-msg');
    var settleBtn = $('settle-now-btn');
    var spentVal = $('settle-spent-val');
    var spentCount = $('settle-spent-count');
    var withVal = $('settle-withdrawn-val');
    var withCount = $('settle-withdrawn-count');
    var entriesBox = $('settle-family-entries');

    if (spentVal) spentVal.textContent = money(setl.familySpent);
    if (spentCount) spentCount.textContent = setl.familyExpenses.length + (setl.familyExpenses.length === 1 ? ' family expense' : ' family expenses');
    if (withVal) withVal.textContent = money(setl.motherWithdrawn);
    if (withCount) withCount.textContent = setl.motherSettledEntries.length + ' reimbursement entries';

    if (badge && title && msg && settleBtn) {
      if (setl.pending > 0) {
        badge.textContent = 'Action Required';
        badge.className = 'settle-badge pending';
        title.textContent = 'Pending Withdrawal: ' + money(setl.pending);
        msg.textContent = 'You spent ' + money(setl.familySpent) + ' on family expenses this month. Withdraw ' + money(setl.pending) + ' from Mother’s account to settle.';
        settleBtn.hidden = false;
        settleBtn.textContent = '📥 Settle ' + money(setl.pending) + ' from Mother';
      } else {
        badge.textContent = 'All Clear';
        badge.className = 'settle-badge settled';
        title.textContent = 'Family Expenses Settled! 🎉';
        msg.textContent = setl.familySpent > 0 ? ('All ' + money(setl.familySpent) + ' in family expenses have been reimbursed from Mother’s account.') : 'No family expenses recorded this month.';
        settleBtn.hidden = true;
      }
    }

    if (entriesBox) {
      entriesBox.textContent = '';
      if (!setl.familyExpenses.length) {
        var em = el('div', 'empty');
        em.appendChild(el('p', null, 'No family expenses logged for ' + monthLabel(state.sel) + '. Tap "🏠 Family / Bill" when adding an expense.'));
        entriesBox.appendChild(em);
        return;
      }

      var ul = el('ul', 'entries');
      setl.familyExpenses.sort(byTimeDesc).forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e, true));
        ul.appendChild(li);
      });
      entriesBox.appendChild(ul);
    }
  }

  /* ---------- 1-Tap Settle Button Action ---------- */
  var settleNowBtn = $('settle-now-btn');
  if (settleNowBtn) {
    settleNowBtn.addEventListener('click', function () {
      var allMonthEntries = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });
      var setl = getFamilySettlement(allMonthEntries);
      if (setl.pending <= 0) {
        toast('Already fully settled for this month!');
        return;
      }
      showConfirmModal({
        title: '👵 Settle from Mother’s Account',
        message: 'Record ' + money(setl.pending) + ' as withdrawn from Mother’s account to reimburse family expenses for ' + monthLabel(state.sel) + '?',
        confirmText: 'Record Settlement',
        onConfirm: function () {
          settleNowBtn.disabled = true;
          settleNowBtn.textContent = 'Recording…';
          var desc = '👵 Withdrawn from Mother (Family Settlement)';
          store.add({ amount: setl.pending, desc: desc, spent_at: new Date().toISOString() }).then(function () {
            toast('Recorded settlement of ' + money(setl.pending) + '!');
            render();
          }).catch(function (err) {
            toast('Failed to record settlement: ' + (err.message || 'error'));
          }).finally(function () {
            settleNowBtn.disabled = false;
            settleNowBtn.textContent = '📥 Settle from Mother';
          });
        }
      });
    });
  }

  /* ---------- Add Income Form Handling ---------- */
  function getSelectedIncomeSource() {
    var checked = document.querySelector('input[name="income-source"]:checked');
    return checked ? checked.value : 'salary1';
  }
  function setSelectedIncomeSource(val) {
    var radios = document.querySelectorAll('input[name="income-source"]');
    radios.forEach(function (r) {
      r.checked = (r.value === val);
      r.parentElement.classList.toggle('active', r.checked);
    });
  }
  document.querySelectorAll('#income-source-chips .scope-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var input = pill.querySelector('input');
      if (input) setSelectedIncomeSource(input.value);
    });
  });

  var addIncomeForm = $('add-income');
  var incomeAmtInput = $('income-amt');
  var addIncomeBtn = $('add-income-btn');
  var incomeErr = $('income-err');

  if (incomeAmtInput && addIncomeBtn) {
    incomeAmtInput.addEventListener('input', function () {
      var a = parseAmount(incomeAmtInput.value);
      addIncomeBtn.disabled = (a == null);
    });
  }

  if (addIncomeForm) {
    addIncomeForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (incomeErr) incomeErr.hidden = true;
      var amt = parseAmount(incomeAmtInput.value);
      if (amt == null) {
        if (incomeErr) { incomeErr.textContent = 'Enter an amount greater than zero, like 50000 or 12000.'; incomeErr.hidden = false; }
        incomeAmtInput.focus();
        return;
      }

      var source = getSelectedIncomeSource();
      var note = ($('income-note') ? $('income-note').value.trim() : '');
      var prefix = '';
      if (source === 'salary1') prefix = '💼 Salary 1';
      else if (source === 'salary2') prefix = '💼 Salary 2';
      else if (source === 'mother-pension') prefix = '👵 Mother’s Pension';
      else if (source === 'mother-withdraw') prefix = '👵 Withdrawn from Mother';
      else prefix = '💰 Other / UPI';

      var desc = note ? (prefix + ' (' + note + ')') : prefix;

      var spentVal = $('income-date') ? $('income-date').value : '';
      var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

      addIncomeBtn.disabled = true;
      store.add({ amount: amt, desc: desc, spent_at: spentAt }).then(function () {
        incomeAmtInput.value = '';
        if ($('income-note')) $('income-note').value = '';
        if ($('income-date')) $('income-date').value = '';
        var ts = spentAt ? Date.parse(spentAt) : Date.now();
        state.sel = monthKey(ts);
        render();
        toast('Logged income ' + money(amt) + ' (' + prefix + ')');
        incomeAmtInput.focus();
      }).catch(function (err) {
        var msg = (err && (err.message || 'Check your connection.')) || 'Failed to save.';
        if (incomeErr) { incomeErr.textContent = 'Could not save income: ' + msg; incomeErr.hidden = false; }
      }).finally(function () {
        addIncomeBtn.disabled = false;
        renderSync();
      });
    });
  }

  /* ---------- Projects & Renovation View Rendering ---------- */
  var PROJ_NAME_KEY = 'kharcha_active_project_name';
  function getActiveProjectName() {
    try { return localStorage.getItem(PROJ_NAME_KEY) || 'House Renovation'; } catch (e) { return 'House Renovation'; }
  }
  function setActiveProjectName(name) {
    try { localStorage.setItem(PROJ_NAME_KEY, name || 'House Renovation'); } catch (e) {}
  }

  function renderProjectView(proj) {
    var curName = getActiveProjectName();
    var displayEl = $('project-display-name');
    var changeBtn = $('project-change-btn');
    if (displayEl) displayEl.textContent = '🔨 ' + curName;
    if (changeBtn) changeBtn.textContent = '✏️ ' + curName;

    var totSpentEl = $('proj-total-spent');
    var meSpentEl = $('proj-me-spent');
    var motherSpentEl = $('proj-mother-spent');

    if (totSpentEl) totSpentEl.textContent = money(proj.totalSpent);
    if (meSpentEl) meSpentEl.textContent = money(proj.meSpent);
    if (motherSpentEl) motherSpentEl.textContent = money(proj.motherSpent);

    var daysBox = $('project-days');
    if (!daysBox) return;
    daysBox.textContent = '';

    if (!proj.entries.length) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, 'No ' + curName + ' expenses logged for ' + monthLabel(state.sel) + '. Add labour, mistri or materials above!'));
      daysBox.appendChild(em);
      return;
    }

    var days = groupByDay(proj.entries);
    days.forEach(function (g, idx) {
      var wrap = el('section', 'day');
      var isExpanded = true;
      var wrapper = el('div', 'entries-wrapper expanded');
      var ul = el('ul', 'entries');
      g.items.forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e));
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      var head = dayHead(g, isExpanded, function () {
        var nextExpanded = !wrapper.classList.contains('expanded');
        head.classList.toggle('expanded', nextExpanded);
        wrapper.classList.toggle('expanded', nextExpanded);
      }, idx);

      wrap.appendChild(head);
      wrap.appendChild(wrapper);
      daysBox.appendChild(wrap);
    });
  }

  /* Project Payer Radio Pills */
  function getSelectedProjectPayer() {
    var checked = document.querySelector('input[name="proj-payer"]:checked');
    return checked ? checked.value : 'me';
  }
  function setSelectedProjectPayer(val) {
    var radios = document.querySelectorAll('input[name="proj-payer"]');
    radios.forEach(function (r) {
      r.checked = (r.value === val);
      r.parentElement.classList.toggle('active', r.checked);
    });
  }
  document.querySelectorAll('#proj-payer-chips .scope-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var input = pill.querySelector('input');
      if (input) setSelectedProjectPayer(input.value);
    });
  });

  /* Quick project item chips */
  document.querySelectorAll('#quick-proj-chips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var item = chip.dataset.item || chip.textContent.trim();
      var descInput = $('proj-desc');
      if (descInput) {
        descInput.value = item;
        if (!$('proj-amt').value) $('proj-amt').focus(); else descInput.focus();
      }
    });
  });

  /* Project Rename Button */
  var projChangeBtn = $('project-change-btn');
  if (projChangeBtn) {
    projChangeBtn.addEventListener('click', function () {
      var cur = getActiveProjectName();
      var next = window.prompt('Enter project name (e.g. House Renovation, Shop Setup, Event):', cur);
      if (next && next.trim() && next.trim() !== cur) {
        setActiveProjectName(next.trim());
        render();
        toast('Project set to ' + next.trim());
      }
    });
  }

  /* Add Project Form Submission */
  var addProjForm = $('add-project');
  var projAmtInput = $('proj-amt');
  var addProjBtn = $('add-proj-btn');
  var projErr = $('proj-err');

  if (projAmtInput && addProjBtn) {
    projAmtInput.addEventListener('input', function () {
      var a = parseAmount(projAmtInput.value);
      addProjBtn.disabled = (a == null);
    });
  }

  if (addProjForm) {
    addProjForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (projErr) projErr.hidden = true;
      var amt = parseAmount(projAmtInput.value);
      if (amt == null) {
        if (projErr) { projErr.textContent = 'Enter an amount greater than zero, like 800 or 1500.'; projErr.hidden = false; }
        projAmtInput.focus();
        return;
      }

      var payer = getSelectedProjectPayer(); // 'me' or 'mother'
      var rawItem = $('proj-desc') ? $('proj-desc').value.trim() : '';
      var item = rawItem || 'Labour / Work';
      var projName = getActiveProjectName();

      // Tag format:
      // If paid by Me: 🔨 Renovation 👤 Labour daily wage - Ramesh
      // If paid by Mother: 🔨 Renovation 👵 Cement & sand bags
      var payerEmoji = payer === 'mother' ? '👵' : '👤';
      var desc = '🔨 ' + projName + ' ' + payerEmoji + ' ' + item;

      var spentVal = $('proj-date') ? $('proj-date').value : '';
      var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

      addProjBtn.disabled = true;
      store.add({ amount: amt, desc: desc, spent_at: spentAt }).then(function () {
        projAmtInput.value = '';
        if ($('proj-desc')) $('proj-desc').value = '';
        if ($('proj-date')) $('proj-date').value = '';
        var ts = spentAt ? Date.parse(spentAt) : Date.now();
        state.sel = monthKey(ts);
        render();
        var payerLabel = payer === 'mother' ? "Paid from Mother's Account" : "Paid from My Account (added to Settlement)";
        toast('Logged ' + money(amt) + ' (' + payerLabel + ')');
        projAmtInput.focus();
      }).catch(function (err) {
        var msg = (err && (err.message || 'Check your connection.')) || 'Failed to save.';
        if (projErr) { projErr.textContent = 'Could not save project spend: ' + msg; projErr.hidden = false; }
      }).finally(function () {
        addProjBtn.disabled = false;
        renderSync();
      });
    });
  }

  /* ---------- Investments View Rendering ---------- */
  function renderInvestmentsView(monthInvestments) {
    var totalInv = sumRupees(monthInvestments);
    var sipEntries = monthInvestments.filter(function (e) {
      var d = e.desc.toLowerCase();
      return d.includes('sip') || d.includes('mutual fund');
    });
    var sipAmt = sipEntries.reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100;
    var otherAmt = Math.max(0, (totalInv * 100 - sipAmt * 100) / 100);

    var totalEl = $('inv-total-amt');
    var sipEl = $('inv-sip-amt');
    var othEl = $('inv-other-amt');
    if (totalEl) totalEl.textContent = money(totalInv);
    if (sipEl) sipEl.textContent = money(sipAmt);
    if (othEl) othEl.textContent = money(otherAmt);

    var daysBox = $('investment-days');
    if (!daysBox) return;
    daysBox.textContent = '';

    if (!monthInvestments.length) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, 'No investments logged for ' + monthLabel(state.sel) + '. Add a SIP, mutual fund, or shares above!'));
      daysBox.appendChild(em);
      return;
    }

    var days = groupByDay(monthInvestments);
    days.forEach(function (g, idx) {
      var wrap = el('section', 'day');
      var isExpanded = true;
      var wrapper = el('div', 'entries-wrapper expanded');
      var ul = el('ul', 'entries');
      g.items.forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e));
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      var head = dayHead(g, isExpanded, function () {
        var nextExpanded = !wrapper.classList.contains('expanded');
        head.classList.toggle('expanded', nextExpanded);
        wrapper.classList.toggle('expanded', nextExpanded);
      }, idx);

      wrap.appendChild(head);
      wrap.appendChild(wrapper);
      daysBox.appendChild(wrap);
    });
  }

  /* Investment Type Radio Pills */
  function getSelectedInvType() {
    var checked = document.querySelector('input[name="inv-type"]:checked');
    return checked ? checked.value : 'sip';
  }
  function setSelectedInvType(val) {
    var radios = document.querySelectorAll('input[name="inv-type"]');
    radios.forEach(function (r) {
      r.checked = (r.value === val);
      r.parentElement.classList.toggle('active', r.checked);
    });
  }
  document.querySelectorAll('#inv-type-chips .scope-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var input = pill.querySelector('input');
      if (input) setSelectedInvType(input.value);
    });
  });

  /* Add Investment Form Submission */
  var addInvForm = $('add-investment');
  var invAmtInput = $('inv-amt');
  var addInvBtn = $('add-inv-btn');
  var invErr = $('inv-err');

  if (invAmtInput && addInvBtn) {
    invAmtInput.addEventListener('input', function () {
      var a = parseAmount(invAmtInput.value);
      addInvBtn.disabled = (a == null);
    });
  }

  if (addInvForm) {
    addInvForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (invErr) invErr.hidden = true;
      var amt = parseAmount(invAmtInput.value);
      if (amt == null) {
        if (invErr) { invErr.textContent = 'Enter an amount greater than zero, like 5000 or 10000.'; invErr.hidden = false; }
        invAmtInput.focus();
        return;
      }

      var invType = getSelectedInvType();
      var rawNote = $('inv-desc') ? $('inv-desc').value.trim() : '';
      var prefix = '📈 ';
      var typeLabels = {
        'sip': 'SIP Mutual Fund',
        'stocks': 'Stocks / Shares',
        'ppf': 'PPF / EPF',
        'fd': 'Fixed Deposit',
        'other': 'Investment'
      };
      var desc = prefix + (rawNote ? rawNote : (typeLabels[invType] || 'Investment'));

      var spentVal = $('inv-date') ? $('inv-date').value : '';
      var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

      addInvBtn.disabled = true;
      store.add({ amount: amt, desc: desc, spent_at: spentAt }).then(function () {
        invAmtInput.value = '';
        if ($('inv-desc')) $('inv-desc').value = '';
        if ($('inv-date')) $('inv-date').value = '';
        var ts = spentAt ? Date.parse(spentAt) : Date.now();
        state.sel = monthKey(ts);
        render();
        toast('Logged ' + money(amt) + ' as ' + desc);
        invAmtInput.focus();
      }).catch(function (err) {
        var msg = (err && (err.message || 'Check your connection.')) || 'Failed to save.';
        if (invErr) { invErr.textContent = 'Could not save investment: ' + msg; invErr.hidden = false; }
      }).finally(function () {
        addInvBtn.disabled = false;
        renderSync();
      });
    });
  }

  /* Sticky month-total bar: only shown once the hero banner (same number) has scrolled out
     of view, so the two never compete for attention at once. */
  (function initStickyBarVisibility() {
    var hero = document.querySelector('.hero');
    var bar = $('sticky-month-bar');
    if (!hero || !bar || !('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        bar.classList.toggle('visible', !entry.isIntersecting);
      });
    }, { threshold: 0 });
    observer.observe(hero);
  })();

  var CAT_BUDGET_KEY = 'kharcha_category_budgets';
  function categoryBudgets() { try { return JSON.parse(localStorage.getItem(CAT_BUDGET_KEY)) || {}; } catch (e) { return {}; } }
  function setCategoryBudget(name, val) {
    var b = categoryBudgets();
    if (val > 0) b[name] = val; else delete b[name];
    try { localStorage.setItem(CAT_BUDGET_KEY, JSON.stringify(b)); } catch (e) {}
  }

  function renderCategoryBreakdown(list, cmp, prevKey) {
    var sec = $('category-sec');
    var container = $('cat-breakdown');
    if (!sec || !container) return;
    container.textContent = '';
    if (!list.length) { sec.hidden = true; return; }

    var res = categoryBreakdown(list);
    if (!res.categories.length) { sec.hidden = true; return; }
    sec.hidden = false;

    var budgets = categoryBudgets();
    var prevName = monthLabel(prevKey).split(' ')[0].slice(0, 3);
    res.categories.slice(0, 6).forEach(function (c) {
      var row = el('button', 'cat-row');
      row.type = 'button';
      row.title = 'Tap to set a monthly budget for ' + c.name;
      var head = el('div', 'cat-row-head');
      var nameSpan = el('span', null, c.name + ' (' + c.count + ')');
      var amtSpan = el('span', null, money(c.total) + ' · ' + c.pct + '%');
      head.appendChild(nameSpan);
      head.appendChild(amtSpan);

      var budget = budgets[c.name];
      var used = budget ? Math.round((c.total / budget) * 100) : c.pct;
      var track = el('div', 'cat-track');
      var fill = el('div', 'cat-fill' + (budget && used >= 100 ? ' danger' : budget && used >= 80 ? ' warning' : ''));
      fill.style.width = Math.min(100, Math.max(2, used)) + '%';
      track.appendChild(fill);

      var notes = [];
      if (budget) notes.push(used + '% of ' + money(budget) + ' budget');
      var prev = cmp.prevCats[c.name];
      if (prev) {
        var diff = c.total - prev;
        notes.push((diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '') + money(Math.abs(diff)) + ' vs ' + prevName);
      } else if (cmp.prev > 0) {
        notes.push('New vs ' + prevName);
      }

      row.appendChild(head);
      row.appendChild(track);
      if (notes.length) row.appendChild(el('div', 'cat-note', notes.join(' · ')));
      row.addEventListener('click', function () {
        var curBudget = budgets[c.name] || 0;
        openBudgetModal({
          title: c.name + ' Budget',
          intro: 'Set a monthly spending limit for ' + c.name + '. You will get warned when spending approaches this limit.',
          spentText: money(c.total) + ' (' + c.pct + '% of month total)',
          currentValue: curBudget,
          presets: [500, 1000, 2500, 5000],
          onSave: function (n) {
            setCategoryBudget(c.name, n);
            render();
            toast('Budget for ' + c.name + ' set to ' + money(n));
          },
          onClear: function () {
            setCategoryBudget(c.name, 0);
            render();
            toast('Budget for ' + c.name + ' cleared');
          }
        });
      });
      container.appendChild(row);
    });
  }

  /* ---------- Bank SMS Parser Modal & Auto-Detection ---------- */
  var parsedSMSDraft = null;

  /* Merchant memory: when you change the description of a parsed SMS, the next SMS from that payee uses it. */
  var MERCHANT_KEY = 'kharcha_merchant_memory';
  function merchantMemory() { try { return JSON.parse(localStorage.getItem(MERCHANT_KEY)) || {}; } catch (e) { return {}; } }
  function rememberMerchant(payee, desc) {
    if (!payee) return;
    var mem = merchantMemory();
    mem[payee.toLowerCase()] = desc;
    try { localStorage.setItem(MERCHANT_KEY, JSON.stringify(mem)); } catch (e) {}
  }

  function smsField(labelText, input) {
    var f = el('label', 'sms-field');
    f.appendChild(el('span', null, labelText));
    f.appendChild(input);
    return f;
  }

  function triggerSMSParse(txt) {
    var result = parseBankSMS(txt);
    var container = $('sms-result');
    if (!container) return;
    container.textContent = '';
    container.hidden = false;
    var saveBtn = $('save-sms-entry');
    saveBtn.textContent = '1-Tap Add Expense';

    if (!result.valid) {
      container.className = 'sms-preview-card invalid';
      container.appendChild(el('div', 'sms-badge-title', '❌ Not added: not a real spend'));
      container.appendChild(el('div', null, result.error || 'Only debit SMS messages from recognized banks are parsed.'));
      saveBtn.disabled = true;
      parsedSMSDraft = null;
      return;
    }

    var remembered = result.rawPayee && merchantMemory()[result.rawPayee.toLowerCase()];
    if (remembered) result.desc = remembered;
    var dup = findDuplicate(result, state.entries);

    container.className = 'sms-preview-card valid' + (result.confidence === 'high' && !dup ? '' : ' check');
    container.appendChild(el('div', 'sms-badge-title', result.confidence === 'high'
      ? '✓ Verified debit (' + result.bank + ')'
      : '⚠️ Check before adding (' + result.bank + ')'));

    var meta = [];
    if (result.account) meta.push('A/c ··' + result.account);
    if (result.refNo) meta.push('Ref ' + result.refNo);
    if (meta.length) container.appendChild(el('div', 'sms-meta', meta.join(' · ')));

    if (dup) {
      var when = dFmt.format(new Date(dup.entry.ts));
      container.appendChild(el('div', 'sms-dup', dup.kind === 'exact'
        ? '⛔ Already added on ' + when + ' (same reference number).'
        : '⚠️ Possible duplicate: ' + money(dup.entry.amount) + ' "' + dup.entry.desc + '" is already logged on ' + when + '.'));
    }
    if (result.warnings.length) {
      var ul = el('ul', 'sms-warn');
      result.warnings.forEach(function (w) { ul.appendChild(el('li', null, w)); });
      container.appendChild(ul);
    }
    if (remembered) container.appendChild(el('div', 'sms-meta', 'Using your saved description for ' + result.rawPayee + '.'));

    var grid = el('div', 'sms-details-grid sms-edit');
    var amtIn = el('input', 'input'); amtIn.id = 'sms-amt'; amtIn.inputMode = 'decimal'; amtIn.value = String(result.amount);
    var descIn = el('input', 'input'); descIn.id = 'sms-desc'; descIn.maxLength = 50; descIn.value = result.desc;
    var dateIn = el('input', 'input'); dateIn.id = 'sms-date'; dateIn.type = 'datetime-local'; dateIn.value = toLocalISOString(result.ts || Date.now());
    grid.appendChild(smsField('Amount (₹)', amtIn));
    grid.appendChild(smsField('Date & time', dateIn));
    var descField = smsField('Description', descIn); descField.classList.add('wide');
    grid.appendChild(descField);
    container.appendChild(grid);

    parsedSMSDraft = result;
    saveBtn.disabled = dup && dup.kind === 'exact';
    if (dup && dup.kind === 'likely') saveBtn.textContent = 'Add anyway';
  }

  function openSMSModal(initialText) {
    var modal = $('sms-modal');
    if (!modal) return;
    modal.hidden = false;
    $('sms-input').value = (typeof initialText === 'string') ? initialText : '';
    var res = $('sms-result');
    if (res) res.hidden = true;
    $('save-sms-entry').disabled = true;

    if (typeof initialText === 'string' && initialText.trim()) {
      triggerSMSParse(initialText);
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (clipText) {
        if (clipText && clipText.trim()) {
          var parsed = parseBankSMS(clipText);
          if (parsed.valid) {
            $('sms-input').value = clipText;
            triggerSMSParse(clipText);
            toast('Auto-detected Bank SMS from clipboard!');
          }
        }
      }).catch(function () {});
    }
    $('sms-input').focus();
  }

  function closeSMSModal() {
    var modal = $('sms-modal');
    if (modal) modal.hidden = true;
    parsedSMSDraft = null;
  }

  if ($('open-sms-modal')) $('open-sms-modal').addEventListener('click', function () { openSMSModal(); });
  if ($('close-sms-modal')) $('close-sms-modal').addEventListener('click', closeSMSModal);
  if ($('cancel-sms-modal')) $('cancel-sms-modal').addEventListener('click', closeSMSModal);

  if ($('sms-modal')) {
    $('sms-modal').addEventListener('click', function (ev) {
      if (ev.target === $('sms-modal')) closeSMSModal();
    });
  }

  if ($('sms-parse-btn')) {
    $('sms-parse-btn').addEventListener('click', function () {
      triggerSMSParse($('sms-input').value);
    });
  }

  if ($('save-sms-entry')) {
    $('save-sms-entry').addEventListener('click', function () {
      var draft = parsedSMSDraft;
      if (!draft || !draft.valid) return;
      var amt = parseAmount($('sms-amt').value);
      if (!amt) { toast('Please enter a valid amount.'); return; }
      var desc = normDesc($('sms-desc').value);
      if (!desc) { toast('Please enter a description.'); return; }
      var dateVal = $('sms-date').value;
      var spentAt = dateVal ? new Date(dateVal).toISOString() : null;
      if (desc !== draft.desc) rememberMerchant(draft.rawPayee, desc);

      var saveBtn = $('save-sms-entry');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      store.add({ amount: amt, desc: desc, spent_at: spentAt, ref_no: draft.refNo, raw_sms: draft.rawSMS }).then(function () {
        closeSMSModal();
        render();
        toast('Added ' + money(amt) + ' from ' + draft.bank + ' SMS!');
      }).catch(function (err) {
        toast('Could not save SMS entry: ' + (err.message || 'Error'));
      }).then(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = '1-Tap Add Expense';
      });
    });
  }

  // Web Share Target: Auto-detect shared SMS text from Android Share menu
  try {
    var queryParams = new URLSearchParams(window.location.search);
    var sharedSMS = queryParams.get('sms_text') || queryParams.get('text') || queryParams.get('title');
    if (sharedSMS && sharedSMS.trim()) {
      window.history.replaceState({}, document.title, window.location.pathname);
      openSMSModal(sharedSMS);
    }
  } catch (e) {}

  function renderSuggestions() {
    var box = $('chips');
    box.textContent = '';
    DEFAULT_CHIPS.forEach(function (c) {
      var b = el('button', 'chip', c.emoji + ' ' + c.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        // Populates description WITHOUT altering the user's selected scope radio pill!
        $('desc').value = c.emoji + ' ' + c.label;
        if (!$('amt').value) $('amt').focus(); else $('desc').focus();
      });
      box.appendChild(b);
    });

    var dl = $('descs');
    dl.textContent = '';
    DEFAULT_CHIPS.forEach(function (c) {
      var o = document.createElement('option'); o.value = c.emoji + ' ' + c.label; dl.appendChild(o);
    });
  }

  function renderBreakdown(list, total) {
    var sec = $('breakdown-sec'), ul = $('breakdown');
    ul.textContent = '';
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false;
    var rows = byDescription(list).slice(0, 6);
    var max = rows[0].total || 1;
    rows.forEach(function (r) {
      var li = el('li');
      var top = el('div', 'bar-top');
      top.appendChild(el('b', null, r.label));
      top.appendChild(el('span', null, money(r.total) + (total ? ' · ' + Math.round((r.total / total) * 100) + '%' : '')));
      var bar = el('div', 'bar'); var fill = el('i');
      fill.style.width = Math.max(3, Math.round((r.total / max) * 100)) + '%';
      bar.appendChild(fill);
      li.appendChild(top); li.appendChild(bar);
      ul.appendChild(li);
    });
  }

  var DAY_COLOR_COUNT = 6;
  function dayHead(g, isExpanded, toggleFn, colorIdx) {
    var head = el('button', 'day-head' + (isExpanded ? ' expanded' : ''));
    head.type = 'button';
    head.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    head.setAttribute('aria-label', (isExpanded ? 'Collapse ' : 'Expand ') + dFmt.format(keyToDate(g.key)) + ' expenses');

    var l = el('div', 'l');
    var today = dayKey(Date.now());
    var yest = dayKey(Date.now() - 86400000);
    var date = dFmt.format(keyToDate(g.key));
    if (g.key === today) { l.appendChild(el('span', 'dname', 'Today')); l.appendChild(el('span', 'ddate', date)); }
    else if (g.key === yest) { l.appendChild(el('span', 'dname', 'Yesterday')); l.appendChild(el('span', 'ddate', date)); }
    else l.appendChild(el('span', 'dname', date));

    var r = el('div', 'r-head');
    r.appendChild(el('span', 'dtotal day-color-' + (colorIdx % DAY_COLOR_COUNT), money(g.total)));
    r.appendChild(el('span', 'chevron', '▼'));

    head.appendChild(l);
    head.appendChild(r);
    head.addEventListener('click', toggleFn);
    return head;
  }

  // Lists grouped under a day header show the time; flat month-long lists (settlement) show the date.
  var rowDateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  function entryRow(e, showDate) {
    var b = el('button', 'row');
    b.type = 'button';
    b.setAttribute('aria-label', 'Edit ' + e.desc + ', ' + money(e.amount));
    b.appendChild(el('span', 't', (showDate ? rowDateFmt : tFmt).format(new Date(e.ts))));
    b.appendChild(el('span', 'd', e.desc));
    b.appendChild(el('span', 'a', money(e.amount)));
    b.addEventListener('click', function () {
      state.editing = e.id;
      state.draft = { amount: String(e.amount), desc: e.desc, spent_at: toLocalISOString(e.ts) };
      render();
      var f = $('edit-amt'); if (f) f.focus();
    });
    return b;
  }

  function editRow(e) {
    var f = el('form', 'edit');
    f.noValidate = true;
    var row1 = el('div', 'add-row');
    var f1 = el('div', 'field'), l1 = el('label', null, 'Amount'); l1.htmlFor = 'edit-amt';
    var w = el('div', 'amt-wrap'); w.appendChild(el('span', null, '₹'));
    var a = el('input', 'input'); a.id = 'edit-amt'; a.inputMode = 'decimal'; a.value = state.draft.amount;
    a.addEventListener('input', function () { state.draft.amount = a.value; });
    w.appendChild(a); f1.appendChild(l1); f1.appendChild(w);
    var f2 = el('div', 'field'), l2 = el('label', null, 'Description'); l2.htmlFor = 'edit-desc';
    var d = el('input', 'input'); d.id = 'edit-desc'; d.maxLength = 60; d.value = state.draft.desc; d.setAttribute('list', 'descs');
    d.addEventListener('input', function () { state.draft.desc = d.value; });
    f2.appendChild(l2); f2.appendChild(d);
    row1.appendChild(f1); row1.appendChild(f2);

    var row2 = el('div', 'add-row add-row-extra');
    var f3 = el('div', 'field'), l3 = el('label', null, 'Date & Time'); l3.htmlFor = 'edit-date';
    var dt = el('input', 'input'); dt.id = 'edit-date'; dt.type = 'datetime-local'; dt.value = state.draft.spent_at;
    dt.addEventListener('input', function () { state.draft.spent_at = dt.value; });
    f3.appendChild(l3); f3.appendChild(dt);
    row2.appendChild(f3);

    var msg = el('p', 'err'); msg.hidden = true; msg.setAttribute('role', 'alert');
    var btns = el('div', 'edit-btns');
    var save = el('button', 'primary small', 'Save'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    var del = el('button', 'danger', 'Delete'); del.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel); btns.appendChild(del);
    f.appendChild(row1); f.appendChild(row2); f.appendChild(msg); f.appendChild(btns);

    cancel.addEventListener('click', function () { state.editing = null; render(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var amt = parseAmount(state.draft.amount), desc = normDesc(state.draft.desc);
      if (amt == null) { msg.textContent = 'Enter an amount greater than zero, like 250 or 99.50.'; msg.hidden = false; return; }
      if (!desc) { msg.textContent = 'Add a short description, like Grocery.'; msg.hidden = false; return; }
      save.disabled = true;
      var newTs = state.draft.spent_at ? new Date(state.draft.spent_at).toISOString() : null;
      store.update(e.id, { amount: amt, desc: desc, spent_at: newTs }).then(function () {
        state.editing = null; render(); toast('Changes saved');
      }).catch(function () {
        save.disabled = false; msg.textContent = 'Could not save the change. Try again.'; msg.hidden = false;
      });
    });
    var armed = false, armTimer = 0;
    del.addEventListener('click', function () {
      if (!armed) {
        armed = true; del.textContent = 'Tap again to delete'; del.classList.add('armed');
        armTimer = setTimeout(function () { armed = false; del.textContent = 'Delete'; del.classList.remove('armed'); }, 4000);
        return;
      }
      clearTimeout(armTimer);
      store.remove(e.id).then(function () {
        state.editing = null; render(); toast('Deleted ' + e.desc + ' ' + money(e.amount));
      }).catch(function () { msg.textContent = 'Could not delete. Try again.'; msg.hidden = false; });
    });
    return f;
  }

  function renderDays(days) {
    var box = $('days');
    box.textContent = '';
    if (!state.expandedDays) state.expandedDays = {};

    if (!state.entries.length) {
      var em = el('div', 'empty');
      var p1 = el('p'); p1.appendChild(el('strong', null, 'No expenses yet.'));
      em.appendChild(p1);
      em.appendChild(el('p', null, 'Type an amount and a description above, or tap a quick chip like 🛒 Grocery, 🥛 Milk, or ⚡ Electricity Bill.'));
      box.appendChild(em);
      return;
    }
    if (!days.length) {
      var e2 = el('div', 'empty');
      var filterNote = state.scopeFilter !== 'all' ? ' in ' + (state.scopeFilter === 'personal' ? 'Personal' : 'Family & Bills') : '';
      e2.appendChild(el('p', null, searchQuery ? 'No expenses matching "' + searchQuery + '".' : 'Nothing logged' + filterNote + ' for ' + monthLabel(state.sel) + '.'));
      box.appendChild(e2);
      return;
    }

    days.forEach(function (g, idx) {
      var wrap = el('section', 'day');
      var hasEditing = g.items.some(function (e) { return e.id === state.editing; });
      if (hasEditing) state.expandedDays[g.key] = true;

      // Default expand today or first day if no expanded state stored for this month
      if (state.expandedDays[g.key] === undefined) {
        state.expandedDays[g.key] = (idx === 0 || g.key === dayKey(Date.now()));
      }

      var isExpanded = !!state.expandedDays[g.key];
      var wrapper = el('div', 'entries-wrapper' + (isExpanded ? ' expanded' : ''));
      var ul = el('ul', 'entries');
      g.items.forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e));
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      var head = dayHead(g, isExpanded, function () {
        var nextExpanded = !wrapper.classList.contains('expanded');
        state.expandedDays[g.key] = nextExpanded;
        head.classList.toggle('expanded', nextExpanded);
        head.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        head.setAttribute('aria-label', (nextExpanded ? 'Collapse ' : 'Expand ') + dFmt.format(keyToDate(g.key)) + ' expenses');
        wrapper.classList.toggle('expanded', nextExpanded);
      }, idx);

      wrap.appendChild(head);
      wrap.appendChild(wrapper);
      box.appendChild(wrap);
    });
  }

  function renderMonths(months) {
    var sec = $('months-sec'), ul = $('months');
    ul.textContent = '';
    var real = months.filter(function (m) { return m.count > 0; });
    if (real.length < 1) { sec.hidden = true; return; }
    sec.hidden = false;
    real.forEach(function (m) {
      var li = el('li');
      var b = el('button', 'mrow'); b.type = 'button';
      if (m.key === state.sel) b.setAttribute('aria-current', 'true');
      var nm = el('span', null, monthLabel(m.key));
      if (m.top) nm.appendChild(el('span', 'sub', 'Most on ' + m.top + ' · ' + money(m.topTotal)));
      b.appendChild(nm);
      b.appendChild(el('span', 'c', m.count + (m.count === 1 ? ' entry' : ' entries')));
      b.appendChild(el('span', 'm', money(m.total)));
      b.addEventListener('click', function () {
        state.sel = m.key; state.editing = null; render();
        window.scrollTo({ top: 0 });
      });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function renderSync() {
    var s = $('sync');
    var map = {
      pending: ['Loading…', ''],
      db: ['Saved to Supabase', 'Every entry is stored in your Supabase project.'],
      signedout: ['Signed out', ''],
      locked: ['Locked', ''],
      setup: ['Not connected', ''],
      error: ['Not connected', '']
    };
    var m = map[state.mode] || map.pending;
    s.textContent = m[0]; s.title = m[1]; s.dataset.state = state.mode;
    $('addbtn').disabled = state.mode !== 'db';
  }

  /* ---------- events ---------- */
  $('prev').addEventListener('click', function () { shiftMonth(1); });
  $('next').addEventListener('click', function () { shiftMonth(-1); });
  function shiftMonth(step) {
    var nowKey = monthKey(Date.now());
    var keys = monthTotals(state.entries).map(function (m) { return m.key; });
    if (keys.indexOf(nowKey) < 0) keys.push(nowKey);
    keys.sort(function (a, b) { return a < b ? 1 : -1; });
    var i = keys.indexOf(state.sel) + step;
    if (i >= 0 && i < keys.length) { state.sel = keys[i]; state.editing = null; render(); }
  }

  $('add').addEventListener('submit', function (ev) {
    ev.preventDefault();
    showErr('');
    var amt = parseAmount($('amt').value);
    if (amt == null) { showErr('Enter an amount greater than zero, like 250 or 99.50.'); $('amt').focus(); return; }
    var rawDesc = normDesc($('desc').value);
    if (!rawDesc) { showErr('Add a description, e.g. Grocery, Milk, Electricity Bill.'); $('desc').focus(); return; }

    var scope = getSelectedScope();
    var cleanDesc = rawDesc.replace(/^[🏠👤]\s*/, '');
    var desc = (scope === 'family') ? ('🏠 ' + cleanDesc) : cleanDesc;

    var spentVal = $('spent-date').value;
    var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

    var btn = $('addbtn');
    btn.disabled = true;
    store.add({ amount: amt, desc: desc, spent_at: spentAt }).then(function () {
      $('amt').value = ''; $('desc').value = ''; $('spent-date').value = '';
      var ts = spentAt ? Date.parse(spentAt) : Date.now();
      state.sel = monthKey(ts);
      render();
      toast('Added ' + money(amt) + ' for ' + desc);
      $('amt').focus();
    }).catch(function (err) {
      console.error('Save entry failed:', err);
      var msg = (err && (err.message || err.details || err.hint || (typeof err === 'object' ? JSON.stringify(err) : String(err)))) || 'Check your connection and try again.';
      showErr('Could not save entry: ' + msg);
    }).then(function () { renderSync(); });
  });

  /* ---------- app lock: fingerprint / phone PIN via WebAuthn ---------- */
  var LOCK_KEY = 'kharcha_lock_cred';
  var LOCK_AFTER_MS = 60000;
  var hiddenAt = 0;
  function b64u(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; var bin = atob(str), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function lockCred() { try { return localStorage.getItem(LOCK_KEY); } catch (e) { return null; } }
  function setLockCred(v) { try { if (v) localStorage.setItem(LOCK_KEY, v); else localStorage.removeItem(LOCK_KEY); } catch (e) {} }
  var lockSupported = false;
  function detectLock() {
    if (!window.PublicKeyCredential || !window.isSecureContext || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return Promise.resolve();
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(function (ok) { lockSupported = !!ok; }).catch(function () {});
  }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  async function enableLock() {
    try {
      var who = (await sb.auth.getUser()).data.user;
      var cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(32),
        rp: { name: 'Kharcha Book' },
        user: { id: rand(16), name: (who && who.email) || 'kharcha', displayName: 'Kharcha Book' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000
      } });
      setLockCred(b64u(cred.rawId));
      renderLockOffer();
      toast('Lock enabled! Fingerprint or phone PIN will be required next time.');
    } catch (err) {
      toast('Could not enable lock. Ensure your device has a fingerprint or phone PIN set up.');
    }
  }
  async function unlock() {
    var id = lockCred();
    if (!id) { await enterApp(); return; }
    $('lock-err').hidden = true;
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: unb64u(id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000
      } });
    } catch (err) {
      $('lock-err').textContent = 'Could not unlock. Try again, or verify with your phone PIN / password.';
      $('lock-err').hidden = false;
      return;
    }
    await enterApp();
  }
  function lockNow() {
    state.editing = null;
    showScreen('lock');
  }
  $('lock-btn').addEventListener('click', unlock);
  $('lock-pass').addEventListener('click', async function () {
    setLockCred(null);
    await sb.auth.signOut();
    state.entries = []; state.editing = null;
    showScreen('auth');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && lockCred() && !$('main').hidden) {
      lockNow();
      hiddenAt = 0;
      return;
    }
    hiddenAt = 0;
    // Auto-refresh when app becomes visible again so new synced payments show immediately
    if (!$('main').hidden && !isLoadingApp && state.mode === 'db') {
      refreshData();
    }
  });

  window.addEventListener('focus', function () {
    if (!$('main').hidden && !isLoadingApp && state.mode === 'db') {
      refreshData();
    }
  });

  async function refreshData() {
    try {
      var latest = await store.loadAll();
      state.entries = latest;
      render();
    } catch (e) {
      console.warn('Kharcha: background refresh failed', e);
    }
  }

  var OFFER_KEY = 'kharcha_lock_declined';
  function offerDeclined() { try { return !!localStorage.getItem(OFFER_KEY); } catch (e) { return false; } }
  function renderLockOffer() {
    var offerSec = $('lock-offer');
    if (offerSec) offerSec.hidden = !(lockSupported && !lockCred() && !offerDeclined() && !$('main').hidden);
  }
  $('offer-no').addEventListener('click', function () { try { localStorage.setItem(OFFER_KEY, '1'); } catch (e) {} renderLockOffer(); });
  $('offer-yes').addEventListener('click', async function () { await enableLock(); renderLockOffer(); });

  /* ---------- sign in ---------- */
  function showAuthErr(msg) { var e = $('auth-err'); e.textContent = msg; e.hidden = !msg; }
  var authMode = 'otp', otpSent = false;
  function showAuthInfo(msg) { var i = $('auth-info'); i.textContent = msg; i.hidden = !msg; }
  function renderAuth() {
    var otp = authMode === 'otp';
    $('auth-title').textContent = otp ? 'Sign in with an email link or code' : 'Sign in with a password';
    $('auth-intro').hidden = !otp || otpSent;
    $('code-field').hidden = !(otp && otpSent);
    $('pass-field').hidden = otp;
    $('auth-email').readOnly = otp && otpSent;
    $('auth-btn').textContent = otp ? (otpSent ? 'Verify code' : 'Send link / code') : 'Sign in';
    $('auth-toggle').textContent = otp ? 'Use a password instead' : 'Use an email link instead';
    showAuthErr(''); showAuthInfo('');
  }
  $('auth-toggle').addEventListener('click', function () {
    authMode = authMode === 'otp' ? 'pass' : 'otp'; otpSent = false; $('auth-code').value = ''; renderAuth();
  });
  $('auth').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var email = $('auth-email').value.trim();
    if (!email) { showAuthErr('Enter your email address.'); return; }
    $('auth-btn').disabled = true; showAuthErr('');
    var res;
    try {
      if (authMode === 'pass') {
        var pass = $('auth-pass').value;
        if (pass.length < 6) { showAuthErr('Enter your password.'); $('auth-btn').disabled = false; return; }
        res = await sb.auth.signInWithPassword({ email: email, password: pass });
      } else if (!otpSent) {
        res = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
        if (!res.error) {
          otpSent = true; renderAuth();
          showAuthInfo('We sent a sign-in link to ' + email + '. Click the link in your email to log in automatically.');
          $('auth-code').focus();
          $('auth-btn').disabled = false; return;
        }
      } else {
        var code = $('auth-code').value.replace(/\s/g, '');
        if (code.length < 6) { showAuthErr('Enter the code from your email.'); $('auth-btn').disabled = false; return; }
        res = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
      }
    } catch (err) {
      res = { error: { message: 'Could not reach Supabase. Check your connection.' } };
    }
    $('auth-btn').disabled = false;
    if (res.error) { showAuthErr(res.error.message); return; }
    otpSent = false; renderAuth();
    await enterApp();
  });

  $('signout').addEventListener('click', async function () {
    setLockCred(null);
    try { localStorage.removeItem(OFFER_KEY); } catch (e) {}
    await sb.auth.signOut();
    state.entries = []; state.editing = null; state.mode = 'signedout';
    showScreen('auth');
  });

  function showScreen(which) {
    $('setup').hidden = which !== 'setup';
    $('auth').hidden = which !== 'auth';
    $('lock').hidden = which !== 'lock';
    $('main').hidden = which !== 'main';
    $('signout').hidden = which !== 'main';
    if (which === 'auth') renderAuth();
    renderLockOffer();
    if (which !== 'main') { state.mode = which === 'auth' ? 'signedout' : which === 'lock' ? 'locked' : 'setup'; renderSync(); }
  }

  var isLoadingApp = false;
  async function enterApp() {
    console.log('Kharcha: enterApp called, isLoading=' + isLoadingApp);
    if (isLoadingApp) return;
    isLoadingApp = true;
    showScreen('main');
    state.mode = 'pending'; renderSync();
    try {
      console.log('Kharcha: calling store.loadAll()');
      state.entries = await store.loadAll();
      console.log('Kharcha: store.loadAll completed with ' + state.entries.length + ' entries');
      state.mode = 'db';
    } catch (err) {
      console.error('Kharcha: store.loadAll failed:', err);
      state.mode = 'error';
      render();
      showErr('Could not load your expenses: ' + (err.message || 'check the Supabase table and policies') + '. Run supabase/daily_expenses.sql in the Supabase SQL editor if you have not yet.');
      isLoadingApp = false;
      return;
    }
    isLoadingApp = false;
    render();
    console.log('Kharcha: render completed successfully, total entries=' + state.entries.length);
  }

  /* ---------- start ---------- */
  updateStamp();
  setInterval(updateStamp, 15000);
  render();

  (async function init() {
    console.log('Kharcha: init starting');
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) {
      console.warn('Kharcha: Supabase config or script missing');
      showScreen('setup'); return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        lock: async function (name, acquireTimeout, fn) {
          return await fn();
        }
      }
    });
    console.log('Kharcha: Supabase client created');
    await detectLock();
    console.log('Kharcha: detectLock done, lockSupported=' + lockSupported);

    sb.auth.onAuthStateChange(function (event, session) {
      console.log('Kharcha: auth state changed: ' + event + ', session=' + !!session);
      if (event === 'INITIAL_SESSION') return;
      if (session && ($('main').hidden || state.mode === 'signedout')) {
        setTimeout(function () {
          if (lockCred() && lockSupported) { showScreen('lock'); unlock(); }
          else enterApp();
        }, 0);
      } else if (!session && event === 'SIGNED_OUT') {
        state.entries = []; state.editing = null; state.mode = 'signedout';
        showScreen('auth');
      }
    });

    var got = await sb.auth.getSession();
    console.log('Kharcha: getSession returned session=' + !!got.data?.session);
    if (got.data && got.data.session) {
      if (lockCred() && lockSupported) { showScreen('lock'); unlock(); } else await enterApp();
      // Subscribe to real-time changes on daily_expenses for instant sync from phone detection
      try {
        sb.channel('realtime-expenses')
          .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, function () {
            console.log('Kharcha: realtime update received, refreshing');
            refreshData();
          })
          .subscribe();
      } catch (rtErr) {
        console.warn('Kharcha: Realtime subscription failed', rtErr);
      }
    } else {
      showScreen('auth');
    }
  })();

  /* ---------- PWA Installation Handler ---------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferredPrompt = ev;
    var btn = $('install-btn');
    if (btn) btn.hidden = false;
  });

  var installBtn = $('install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === 'accepted') {
          installBtn.hidden = true;
          toast('Kharcha Book app installed!');
        }
        deferredPrompt = null;
      });
    });
  }
  /* ---------- Demo Mode & Force Update Handlers ---------- */
  var isDemoMode = false;
  var demoBtn = $('demo-mode-btn');
  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      isDemoMode = true;
      state.entries = [
        { id: 'd1', amount: 450, desc: '🍔 Food & Dining (Swiggy)', ts: Date.now() - 3600000, refNo: '42781923' },
        { id: 'd2', amount: 1250, desc: '🏠 ⚡ Electricity Bill', ts: Date.now() - 86400000, refNo: 'BESCOM98' },
        { id: 'd3', amount: 1500, desc: '🏠 🛒 General Grocery', ts: Date.now() - 172800000, refNo: 'DMART44' },
        { id: 'd4', amount: 600, desc: '⛽ Petrol / Fuel', ts: Date.now() - 259200000, refNo: 'HPCL712' }
      ];
      showScreen('main');
      state.mode = 'db';
      renderSync();
      render();
      toast('Demo Mode activated! You can test SMS parser, category budgets, & dark mode.');
    });
  }

  var updateBtn = $('force-update-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', function () {
      showConfirmModal({
        title: '🔄 Force Clear Cache & Reload',
        message: 'Clear cached app data and reload to the latest v32?',
        confirmText: 'Clear & Reload',
        onConfirm: function () {
          if ('caches' in window) {
            caches.keys().then(function(keys) {
              return Promise.all(keys.map(function(k) { return caches.delete(k); }));
            }).then(function() {
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  regs.forEach(function(r) { r.unregister(); });
                  window.location.reload(true);
                });
              } else {
                window.location.reload(true);
              }
            });
          } else {
            window.location.reload(true);
          }
        }
      });
    });
  }
})();
