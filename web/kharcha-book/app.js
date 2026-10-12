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
    // Rows from the phone carry an explicit kind (v5 column); typed-in rows are read from the text.
    if (e.kind === 'income') return true;
    if (e.kind === 'expense' || e.kind === 'cash_withdrawal' || e.kind === 'transfer') return false;
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

  function isTripEntry(e) {
    var desc = typeof e === 'string' ? e : (e && e.desc ? e.desc : '');
    var d = desc.toLowerCase();
    return d.includes('✈️') || d.startsWith('trip:') || d.includes('trip:');
  }

  // Short tokens as whole words only: "sip" must not match "Sipping Chai Cafe".
  var INVESTMENT_WORDS = /\b(?:sip|ppf|nps|fd|stocks|shares)\b/;
  function isInvestment(e) {
    if (!e || !e.desc) return false;
    var d = e.desc.trim().toLowerCase();
    return d.includes('📈') || d.startsWith('investment') || d.includes('mutual fund') || d.includes('fixed deposit') || INVESTMENT_WORDS.test(d);
  }

  // ATM / cash withdrawal synced from the phone ("💵 Cash withdrawn · HDFC ATM"): the money moved
  // into your cash wallet. It's counted as "Unaccounted cash" until you log what it was spent on,
  // so the month total is the same either way and cash is never counted twice.
  function isCashWithdrawal(e) {
    if (!e) return false;
    if (e.kind === 'cash_withdrawal') return true;
    return !!e.desc && e.desc.trim().indexOf('💵 Cash withdrawn') === 0;
  }
  function isCashSpend(e) { return !!e && e.method === 'cash' && isExpense(e); }

  // Money moved into a prepaid wallet (Amazon Pay, ...): a transfer, not spending. The purchases made
  // from the wallet are the spending (see ledger-logic.js).
  function isWalletTopup(e) {
    var KL = window.KharchaLedger;
    var p = e && e.desc && KL ? KL.parseWalletDesc(e.desc) : null;
    return !!p && p.kind === 'topup';
  }

  function isTransferEntry(e) { return !!e && /^\s*\u{1F501}/u.test(e.desc || ''); }
  function isExpense(e) {
    return !isIncome(e) && !isTransferEntry(e) && !isInvestment(e) && !isCashWithdrawal(e) && !isWalletTopup(e) && !(e && e.kind === 'transfer');
  }

  /* ---------- Cash wallet ---------- */
  function cashSummary(entries, key) {
    var list = (entries || []).filter(function (e) { return !key || monthKey(e.ts) === key; });
    var withdrawn = sumRupees(list.filter(isCashWithdrawal));
    var spent = sumRupees(list.filter(isCashSpend));
    var unaccounted = Math.max(0, Math.round((withdrawn - spent) * 100) / 100);
    return { withdrawn: withdrawn, spent: spent, unaccounted: unaccounted };
  }
  // The "💵 Unaccounted cash" line that keeps month totals right (not a stored row; never editable).
  function unaccountedCashEntry(entries, key) {
    var c = cashSummary(entries, key);
    if (c.unaccounted <= 0) return null;
    var p = key.split('-');
    return { id: 'cash-unaccounted-' + key, synthetic: true, amount: c.unaccounted, desc: '💵 Unaccounted cash', ts: new Date(+p[0], +p[1], 0, 12).getTime(), method: 'cash' };
  }

  /* ---------- Payment methods ---------- */
  var METHOD_LABELS = { upi: 'UPI', credit_card: 'Credit card', debit_card: 'Debit card', cash: 'Cash', netbanking: 'Net banking', atm: 'ATM', wallet: 'Wallet', other: 'Other' };
  var METHOD_ICONS = { upi: '📲', credit_card: '💳', debit_card: '🏦', cash: '💵', netbanking: '🏛️', atm: '🏧', wallet: '👛', other: '•' };
  function methodLabel(e) {
    if (!e || !e.method) return '';
    var base = METHOD_LABELS[e.method] || e.method;
    if ((e.method === 'credit_card' || e.method === 'debit_card') && (e.bank || e.last4)) {
      return (e.bank ? e.bank + ' ' : '') + base + (e.last4 ? ' ··' + e.last4 : '');
    }
    return base + (e.method === 'upi' && e.bank ? ' · ' + e.bank : '');
  }
  // This month's spending split by how it was paid; each credit/debit card listed on its own.
  function methodBreakdown(list) {
    var groups = {}, total = 0;
    (list || []).forEach(function (e) {
      if (!isExpense(e) && !e.synthetic) return;
      var m = e.method || 'unknown';
      var key = m, label = m === 'unknown' ? 'Not set' : (METHOD_LABELS[m] || m);
      if ((m === 'credit_card' || m === 'debit_card') && (e.last4 || e.bank)) {
        key = m + '|' + (e.bank || '') + '|' + (e.last4 || '');
        label = (e.bank ? e.bank + ' ' : '') + METHOD_LABELS[m] + (e.last4 ? ' ··' + e.last4 : '');
      }
      if (!groups[key]) groups[key] = { key: key, method: m, label: label, p: 0, count: 0 };
      groups[key].p += paise(e.amount);
      groups[key].count++;
      total += paise(e.amount);
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { key: g.key, method: g.method, label: g.label, icon: METHOD_ICONS[g.method] || '❔', total: g.p / 100, count: g.count, pct: total ? Math.round(g.p * 100 / total) : 0 };
    }).sort(function (a, b) { return b.total - a.total; });
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

  function getEntryScope(e) {
    if (!e || !e.desc) return 'personal';
    if (isTripEntry(e)) return 'trip';
    if (isInvestment(e)) return 'investment';
    if (isFamilyEntry(e.desc)) return 'family';
    return 'personal';
  }

  function cleanScopePrefix(desc) {
    if (!desc) return '';
    var s = desc.trim();
    // Strip leading trip prefix (✈️ TripName: or ✈️ )
    s = s.replace(/^[✈\u{2708}\u{FE0F}\u{1F6EB}\u{1F6EC}]+\s*(?:[^:]+:\s*)?/u, '').trim();
    // Strip other leading scope tags (🏠, 👤, 📈, 🔨)
    s = s.replace(/^[\u{1F3E0}\u{1F464}\u{1F4C8}\u{1F528}\u{1F4B0}\u{1F501}]\s*/u, '').trim();
    return s;
  }

  function shiftScopeDesc(desc, targetScope, tripName) {
    var clean = cleanScopePrefix(desc);
    if (!clean) clean = 'Expense';
    if (targetScope === 'family') return '🏠 ' + clean;
    if (targetScope === 'investment') return '📈 ' + clean;
    if (targetScope === 'personal') return '👤 ' + clean;
    if (targetScope === 'income') return '💰 ' + clean;
    if (targetScope === 'transfer') return '🔁 ' + clean;
    if (targetScope === 'trip') return '✈️ ' + (tripName || getActiveTripName() || 'Trip') + ': ' + clean;
    return clean;
  }

  /* ---------- Trip backfill ----------
     The first trip spend often happens before leaving town (fuel, airport cab), before trip mode is
     on. When a trip starts, these are the recent spends worth offering to move into it. */
  function recentSpendsForTrip(entries, nowMs, hours) {
    var since = nowMs - (hours || 12) * 3600000;
    return (entries || []).filter(function (e) {
      return e && e.ts >= since && e.ts <= nowMs && isExpense(e) && !isTripEntry(e) && !isProjectEntry(e.desc);
    }).sort(function (a, b) { return a.ts - b.ts; });
  }

  /* ---------- Recurring bills & month-end forecast ---------- */
  function recurringKey(desc) {
    return cleanScopePrefix(desc).toLowerCase()
      .replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').trim()
      .split(/\s+/).slice(0, 3).join(' ');
  }
  function median(nums) {
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // A bill = the same payee with a similar amount (within 25%) in at least 2 of the last 3 months.
  function recurringBills(entries, curMonthKey) {
    var prev = [prevMonthKey(curMonthKey)];
    prev.push(prevMonthKey(prev[0]));
    prev.push(prevMonthKey(prev[1]));
    var groups = {};
    (entries || []).forEach(function (e) {
      if (!e || isIncome(e) || isTripEntry(e)) return;
      var key = recurringKey(e.desc);
      if (key.length < 3) return;
      var mk = monthKey(e.ts);
      if (prev.indexOf(mk) < 0 && mk !== curMonthKey) return;
      (groups[key] = groups[key] || []).push(e);
    });
    var bills = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var past = list.filter(function (e) { return monthKey(e.ts) !== curMonthKey; });
      var months = {};
      past.forEach(function (e) { months[monthKey(e.ts)] = true; });
      if (Object.keys(months).length < 2) return;
      var amounts = past.map(function (e) { return e.amount; });
      var lo = Math.min.apply(null, amounts), hi = Math.max.apply(null, amounts);
      if (lo <= 0 || hi / lo > 1.25) return;
      var latest = past.slice().sort(function (a, b) { return b.ts - a.ts; })[0];
      bills.push({
        key: key,
        label: cleanScopePrefix(latest.desc),
        amount: Math.round(median(amounts)),
        day: Math.round(median(past.map(function (e) { return new Date(e.ts).getDate(); }))),
        paidThisMonth: list.some(function (e) { return monthKey(e.ts) === curMonthKey; }),
        isExpense: isExpense(latest)
      });
    });
    return bills.sort(function (a, b) { return a.day - b.day; });
  }
  // Projected month-end spend = spent so far + bills still due + the daily pace of everything else.
  function monthForecast(entries, curMonthKey, now) {
    var monthList = (entries || []).filter(function (e) { return monthKey(e.ts) === curMonthKey && isExpense(e); });
    var cashLine = unaccountedCashEntry(entries, curMonthKey);
    if (cashLine) monthList.push(cashLine);
    var spent = sumRupees(monthList);
    var bills = recurringBills(entries, curMonthKey).filter(function (b) { return b.isExpense; });
    var due = bills.filter(function (b) { return !b.paidThisMonth; });
    var upcoming = due.reduce(function (s, b) { return s + b.amount; }, 0);
    var paidBills = bills.filter(function (b) { return b.paidThisMonth; }).reduce(function (s, b) { return s + b.amount; }, 0);
    var d = now || new Date();
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var elapsed = Math.max(1, d.getDate());
    var variablePerDay = Math.max(0, spent - paidBills) / elapsed;
    return {
      spent: spent,
      upcoming: upcoming,
      dueBills: due,
      projected: Math.round(spent + upcoming + variablePerDay * (daysInMonth - elapsed))
    };
  }

  /* ---------- Settle-up links ---------- */
  // A UPI "pay me" link the other person taps on their phone; amount and note come pre-filled.
  function upiPayLink(vpa, name, amount, note) {
    return 'upi://pay?pa=' + encodeURIComponent(vpa) + '&pn=' + encodeURIComponent(name || 'Kharcha Book') +
      '&am=' + Number(amount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note || 'Settle up');
  }
  // WhatsApp does not linkify upi:// everywhere, so the UPI ID and amount are spelled out too.
  function settleMessage(toName, amount, reason, myVpa) {
    var msg = 'Hi ' + toName + ', ' + money(amount) + ' for ' + reason + '.';
    if (myVpa) msg += '\nPay to UPI ID: ' + myVpa + '\n' + upiPayLink(myVpa, 'Settle up', amount, reason);
    return msg;
  }
  function whatsappLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

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

  /* ---------- Continuous Merchant Auto-Memory ---------- */
  var MERCHANT_SCOPE_KEY = 'kharcha_merchant_scope_map';
  function merchantScopeMap() {
    try { return JSON.parse(kv.get(MERCHANT_SCOPE_KEY)) || {}; } catch (e) { return {}; }
  }
  function extractMerchantCore(desc) {
    if (!desc) return '';
    var clean = cleanScopePrefix(desc);
    clean = clean.replace(/\[Paid by Friend\]/gi, '').trim();
    // Remove leading emoji and punctuation
    clean = clean.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    // Take first 1-2 words or whole string if short
    var words = clean.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
    return words;
  }
  function rememberMerchantScope(desc, scope) {
    if (!desc || !scope) return;
    var core = extractMerchantCore(desc);
    if (!core || core.length < 2) return;
    var map = merchantScopeMap();
    map[core] = scope;
    try { kv.set(MERCHANT_SCOPE_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function predictMerchantScope(desc) {
    if (!desc) return null;
    var core = extractMerchantCore(desc);
    if (!core) return null;
    var map = merchantScopeMap();
    if (map[core]) return map[core];
    // Check word-based or substring overlap
    var coreTokens = core.split(/\s+/).filter(function (t) { return t.length >= 3; });
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (core.includes(k) || k.includes(core)) return map[k];
      var kTokens = k.split(/\s+/).filter(function (t) { return t.length >= 3; });
      for (var j = 0; j < coreTokens.length; j++) {
        if (kTokens.includes(coreTokens[j])) return map[k];
      }
    }
    return null;
  }

  function parseTripPayer(desc) {
    if (!desc) return 'Me';
    var d = desc.trim();
    var m = d.match(/\[Paid by ([^\]]+)\]/i);
    if (m && m[1]) return m[1].trim();
    if (d.includes('🤝') || /friend paid/i.test(d)) return 'Friend';
    return 'Me';
  }

  function getTripSummary(monthEntries, tripName, explicitFriends) {
    var filterName = (tripName || '').trim().toLowerCase();
    var list = (monthEntries || []).filter(function (e) {
      if (!isExpense(e) || !isTripEntry(e)) return false;
      if (!filterName) return true;
      var d = (e.desc || '').toLowerCase();
      return d.includes(filterName);
    });
    var totalSpent = list.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var daySet = new Set(list.map(function (e) { return dayKey(e.ts); }));
    var numDays = daySet.size || 1;
    var dailyAvg = totalSpent > 0 ? Math.round(totalSpent / numDays) : 0;

    // Track all participants/friends
    var friendSet = new Set();
    friendSet.add('Me');
    if (Array.isArray(explicitFriends)) {
      explicitFriends.forEach(function (f) {
        if (f && f.trim()) friendSet.add(f.trim());
      });
    }

    // Tally payments per person
    var payerTotals = {};
    list.forEach(function (e) {
      var payer = parseTripPayer(e.desc);
      friendSet.add(payer);
      if (!payerTotals[payer]) payerTotals[payer] = 0;
      payerTotals[payer] = (payerTotals[payer] * 100 + paise(e.amount)) / 100;
    });

    // If explicitFriends wasn't passed and only Me paid or binary Friend
    var allParticipants = Array.from(friendSet);
    if (allParticipants.length === 1 && allParticipants[0] === 'Me' && (!explicitFriends || !explicitFriends.length)) {
      // Default to 2 people (Me & Friend) for 50/50 balance preview
      if (list.some(function (e) { return parseTripPayer(e.desc) !== 'Me'; })) {
        allParticipants.push('Friend');
      }
    }
    var numPeople = Math.max(1, allParticipants.length);
    var perPersonShare = totalSpent > 0 ? Math.round((totalSpent * 100) / numPeople) / 100 : 0;

    // Balances breakdown
    var balances = allParticipants.map(function (person) {
      var paid = payerTotals[person] || 0;
      var net = (paid * 100 - perPersonShare * 100) / 100;
      return {
        name: person,
        paid: paid,
        share: perPersonShare,
        net: net // > 0: gets back from group, < 0: owes to group
      };
    });

    // Backward-compatible properties for 2-party view
    var paidByMe = payerTotals['Me'] || 0;
    var friendEntries = list.filter(function (e) { return parseTripPayer(e.desc) !== 'Me'; });
    var meEntries = list.filter(function (e) { return parseTripPayer(e.desc) === 'Me'; });
    var paidByFriend = friendEntries.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var netDiff = (paidByMe * 100 - paidByFriend * 100) / 200;

    return {
      entries: list,
      totalSpent: totalSpent,
      itemsCount: list.length,
      daysCount: numDays,
      dailyAvg: dailyAvg,
      participants: allParticipants,
      perPersonShare: perPersonShare,
      balances: balances,
      meEntries: meEntries,
      paidByMe: paidByMe,
      friendEntries: friendEntries,
      paidByFriend: paidByFriend,
      netDiff: netDiff
    };
  }

  function getPersonalCashFlow(monthEntries) {
    var list = monthEntries || [];
    var salaries = list.filter(function (e) { return isSalary(e); }).reduce(function (sum, e) { return sum + paise(e.amount); }, 0) / 100;
    var personalExpenses = list.filter(function (e) { return isExpense(e) && !isFamilyEntry(e.desc); });
    // ATM cash not yet itemised is still money spent (see isCashWithdrawal).
    var personalSpent = (personalExpenses.reduce(function (sum, e) { return sum + paise(e.amount); }, 0) + paise(cashSummary(list).unaccounted)) / 100;
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


  /* ---------- Monthly report: personal savings + family fund ---------- */
  // Personal savings = salaries (Salary 1, Salary 2, ...) - personal spending; investments count as saved.
  // Family fund = what Mother sends for the month (Mother's Pension and Mother Withdrawal entries) minus the
  // family expenses. If family spending goes past the fund, the overflow is shown separately and is NOT
  // taken from personal savings unless you look at "after covering it".
  function getPeriodSummary(entries, startTs, endTs, key) {
    var list = (entries || []).filter(function (e) { return !e.synthetic && e.ts >= startTs && (endTs == null || e.ts < endTs); });
    var cf = getPersonalCashFlow(list);
    var fam = getFamilySettlement(list);
    var motherList = list.filter(function (e) { return isIncome(e) && (isMotherPension(e) || isMotherSettlement(e)); });
    var motherP = motherList.reduce(function (s, e) { return s + paise(e.amount); }, 0);
    var famP = paise(fam.familySpent);
    var otherIncome = list.filter(function (e) { return isIncome(e) && !isSalary(e) && !isMotherPension(e) && !isMotherSettlement(e); })
      .reduce(function (s, e) { return s + paise(e.amount); }, 0) / 100;
    var leftP = motherP - famP;
    var overflow = Math.max(0, -leftP) / 100;
    return {
      key: key, start: startTs, end: endTs,
      salaryEntries: list.filter(isSalary).sort(function (a, b) { return a.ts - b.ts; }),
      salaries: cf.salaries,
      personalSpent: cf.personalSpent,
      invested: cf.totalInvested,
      savings: cf.personalSavings,
      savingsRate: cf.savingsRate,
      otherIncome: otherIncome,
      motherEntries: motherList,
      motherReceived: motherP / 100,
      familySpent: fam.familySpent,
      familyLeft: leftP / 100,
      overflow: overflow,
      savingsAfterOverflow: (paise(cf.personalSavings) - paise(overflow)) / 100,
      hasData: list.length > 0
    };
  }
  function monthBounds(key) {
    var p = key.split('-');
    return [new Date(+p[0], +p[1] - 1, 1).getTime(), new Date(+p[0], +p[1], 1).getTime()];
  }
  function getMonthlySummary(entries, key) {
    var b = monthBounds(key);
    return getPeriodSummary(entries, b[0], b[1], key);
  }
  // Newest month first, for every month that has any entry.
  function getMonthlyHistory(entries) {
    var seen = {};
    (entries || []).forEach(function (e) { if (!e.synthetic) seen[monthKey(e.ts)] = true; });
    return Object.keys(seen).sort().reverse().map(function (k) { return getMonthlySummary(entries, k); });
  }


  /* ---------- Pay cycles ---------- */
  // Salary arrives on the last working day, so it pays for the next stretch of spending. In "salary" mode a period
  // runs from one payday (an income entry that matches the anchor, normally "Salary 1") to the next.
  var CYCLE_KEY = 'kharcha_cycle';
  function cycleSettings() {
    var s = {};
    try { s = JSON.parse(kv.get(CYCLE_KEY) || '{}') || {}; } catch (e) {}
    return { mode: s.mode === 'calendar' ? 'calendar' : 'salary', anchor: (typeof s.anchor === 'string' && s.anchor.trim()) ? s.anchor.trim() : 'Salary 1' };
  }
  function saveCycleSettings(s) { kv.set(CYCLE_KEY, JSON.stringify(s)); }
  function getPayCycleSummaries(entries, anchorText) {
    var KL = window.KharchaLedger;
    if (!KL) return [];
    var needle = String(anchorText || 'Salary 1').toLowerCase();
    return KL.payCycles(entries, function (e) { return isSalary(e) && String(e.desc || '').toLowerCase().indexOf(needle) >= 0; })
      .map(function (c) { var s = getPeriodSummary(entries, c.start, c.end, 'c' + c.start); s.open = c.end == null; return s; });
  }

  /* ---------- Bank balance ---------- */
  // An estimate: the balance you typed in, plus income logged since, minus the spending that really left the bank.
  // Not bank debits: credit-card spends (the card bill is), cash spends, wallet spends, what a friend paid, what Mother paid.
  function isCardEntry(e) {
    if (!e) return false;
    var own = loadOwn(), c = own ? window.KharchaLedger.cardFor(e.desc, own) : null;
    if (c) return c.kind === 'credit';           // your debit card spends are bank money; credit card spends are not
    return e.method === 'credit_card' || /credit\s*card|\bcard\s*[x*·.\-]*\s*\d{3,4}\b/i.test(e.desc || '');
  }
  function isCardBillEntry(e) { return !!e && /card\s*bill|credit\s*card\s*(?:bill|payment)|\bcc\s*bill/i.test(e.desc || ''); }
  function isBankIn(e) { return !!e && isIncome(e) && e.method !== 'cash'; }
  function isBankOut(e) {
    if (!e || e.synthetic || isIncome(e)) return false;
    if (isCardBillEntry(e) || isInvestment(e) || isCashWithdrawal(e)) return true;
    if (!isExpense(e)) return false;
    if (isCardEntry(e) || e.method === 'cash' || e.method === 'wallet') return false;
    if (/^\s*👛/.test(e.desc || '')) return false;                 // paid from a prepaid wallet
    if (parseTripPayer(e.desc) !== 'Me') return false;                      // a friend paid
    if (isProjectMotherPaid(e.desc)) return false;                          // Mother paid directly
    return true;
  }
  var BANK_KEY = 'kharcha_bank';
  function loadBank() { return window.KharchaLedger ? window.KharchaLedger.parseBank(kv.get(BANK_KEY)) : []; }
  function saveBank(list) { kv.set(BANK_KEY, JSON.stringify(list)); }
  var TRANSFERS_KEY = 'kharcha_transfers', RULES_KEY = 'kharcha_rules', ACCTMAP_KEY = 'kharcha_acctmap', PRIMARY_KEY = 'kharcha_primary_acct', SKIPS_KEY = 'kharcha_rule_skips';
  function loadTransfers() { return window.KharchaLedger ? window.KharchaLedger.parseTransfers(kv.get(TRANSFERS_KEY)) : []; }
  function saveTransfers(list) { kv.set(TRANSFERS_KEY, JSON.stringify(list)); }
  var OWN_KEY = 'kharcha_own', ownMemo = { raw: undefined, val: null };
  function loadOwn() {
    var KL = window.KharchaLedger;
    if (!KL) return null;
    var raw = kv.get(OWN_KEY);
    if (ownMemo.raw !== raw || !ownMemo.val) {
      ownMemo.raw = raw;
      ownMemo.val = KL.parseOwn(raw) || KL.parseOwn(JSON.stringify(KL.defaultOwn()));
    }
    return ownMemo.val;
  }
  function loadRules() {
    var KL = window.KharchaLedger;
    if (!KL) return [];
    return KL.parseRules(kv.get(RULES_KEY)) || KL.parseRules(JSON.stringify(KL.defaultRules()));
  }
  function saveRules(list) { kv.set(RULES_KEY, JSON.stringify(list)); }
  // Built-in rules added in a later version (LIC premium, insurance) reach existing users once; deleting one keeps it deleted.
  function ensureRulesSeeded() {
    var KL = window.KharchaLedger;
    if (!KL || !KL.seedRules) return;
    var cur = KL.parseRules(kv.get(RULES_KEY));
    if (!cur) return;
    var seeded = []; try { seeded = JSON.parse(kv.get('kharcha_rules_seeded') || '[]'); } catch (e) {}
    if (!Array.isArray(seeded)) seeded = [];
    var r = KL.seedRules(cur, seeded);
    if (r.rules.length !== cur.length) saveRules(r.rules);
    if (r.seeded.length !== seeded.length) kv.set('kharcha_rules_seeded', JSON.stringify(r.seeded));
  }
  function loadJsonObj(k) { try { var o = JSON.parse(kv.get(k) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  function primaryAcctId(accts) {
    var id = kv.get(PRIMARY_KEY);
    if (accts.some(function (a) { return a.id === id; })) return id;
    var ic = accts.filter(function (a) { return /icici/i.test(a.name); })[0];
    return ic ? ic.id : (accts[0] ? accts[0].id : null);
  }
  // Each money-in or money-out belongs to ONE account: your explicit choice, else the rule's bank (HDFC for the EMI), else the main account.
  function bankPreds(acct, accts) {
    var KL = window.KharchaLedger, map = loadJsonObj(ACCTMAP_KEY), rules = loadRules(), pid = primaryAcctId(accts), own = loadOwn();
    function mine(e) { return KL.routeAccount(e, accts, map, rules, pid, own) === acct.id; }
    return { isIn: function (e) { return isBankIn(e) && mine(e); }, isOut: function (e) { return isBankOut(e) && mine(e); } };
  }
  function setEntryAcct(entryId, choice) {
    var map = loadJsonObj(ACCTMAP_KEY);
    if (!choice) delete map[entryId]; else map[entryId] = choice;
    kv.set(ACCTMAP_KEY, JSON.stringify(map));
    var accts = loadBank();
    if (!accts.length) return;
    var pid = primaryAcctId(accts);
    saveBank(accts.map(function (a) {
      var held = (a.held || []).filter(function (x) { return x !== entryId; });
      if (choice === 'cash' && a.id === pid) held.push(entryId);
      return Object.assign({}, a, { held: held });
    }));
  }
  function currentAcctChoice(e, accts) {
    var KL = window.KharchaLedger, map = loadJsonObj(ACCTMAP_KEY);
    if (map[e.id]) return map[e.id];
    var pid = primaryAcctId(accts);
    return e.id ? (KL.routeAccount(e, accts, map, loadRules(), pid, loadOwn()) || 'none') : pid;
  }
  function acctChoiceSelect(accts, value) {
    var sel = el('select', 'input');
    accts.forEach(function (a) { var o = el('option', null, '🏦 ' + a.name); o.value = a.id; sel.appendChild(o); });
    var c = el('option', null, '💵 Cash at home (not in the bank yet)'); c.value = 'cash'; sel.appendChild(c);
    var n = el('option', null, '👛 Not in a bank (wallet, other)'); n.value = 'none'; sel.appendChild(n);
    sel.value = value;
    return sel;
  }
  /* ---------- Home: what you can spend today ---------- */
  function startOfDay(ts) { var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function getHomeFacts() {
    var KL = window.KharchaLedger, now = Date.now(), d = new Date(now), nowKey = monthKey(now);
    var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var spendNow = function (e) { return e && !e.synthetic && isExpense(e); };
    var spent = sumRupees(state.entries.filter(function (e) { return spendNow(e) && monthKey(e.ts) === nowKey; }));
    var since7 = startOfDay(now) - 6 * 86400000;
    var avg7 = sumRupees(state.entries.filter(function (e) { return spendNow(e) && e.ts >= since7; })) / 7;
    var budget = getBudget(), bank = KL ? getBankTotals() : { has: false }, f = { viewingCurrent: state.sel === nowKey, spent: spent, avg7: avg7, budget: budget, mode: 'none', ratio: null };
    if (!KL) return f;
    var pay = KL.nextPayday(now), untilMs = pay.date.getTime();
    f.payDays = pay.days; f.payDate = untilMs;
    if (bank.has) {
      var up = KL.upcomingRules(loadRules(), state.entries, now, untilMs), upSum = up.reduce(function (n, u) { return n + paise(u.amount); }, 0) / 100;
      f.mode = 'bank'; f.bankTotal = bank.total; f.upcoming = up; f.upSum = upSum;
      f.avail = Math.max(0, bank.total - upSum);
      f.days = Math.max(1, pay.days);
      f.safe = f.avail / f.days;
      f.ratio = f.safe > 0 ? avg7 / f.safe : (avg7 > 0 ? 9 : 0);
    } else if (budget > 0) {
      f.mode = 'budget'; f.left = budget - spent; f.days = Math.max(1, dim - d.getDate() + 1);
      f.safe = Math.max(0, f.left) / f.days;
      f.ratio = (spent / budget) / (d.getDate() / dim);
    }
    return f;
  }

  /* ---------- Where this month's spending left from ---------- */
  function getSpendSources(key) {
    var KL = window.KharchaLedger, accts = loadBank(), map = loadJsonObj(ACCTMAP_KEY), rules = loadRules(), pid = primaryAcctId(accts), own = loadOwn(), out = {}, total = 0;
    function add(name, icon, e) { var o = out[name] || (out[name] = { name: name, icon: icon, p: 0, count: 0 }); o.p += paise(e.amount); o.count++; total += paise(e.amount); }
    state.entries.filter(function (e) { return e && !e.synthetic && monthKey(e.ts) === key && isExpense(e); }).forEach(function (e) {
      if (isCardEntry(e)) add('Credit card', '💳', e);
      else if (e.method === 'cash') add('Cash', '💵', e);
      else if (e.method === 'wallet' || /^\s*\uD83D\uDC5B/.test(e.desc || '')) add('Wallet', '👛', e);
      else if (parseTripPayer(e.desc) !== 'Me' || isProjectMotherPaid(e.desc)) add('Paid by someone else', '🤝', e);
      else {
        var id = KL && accts.length ? KL.routeAccount(e, accts, map, rules, pid, own) : null, a = accts.filter(function (x) { return x.id === id; })[0];
        add(a ? a.name : 'Bank or UPI (not tracked)', '🏦', e);
      }
    });
    var list = Object.keys(out).map(function (k) { var o = out[k]; return { name: o.name, icon: o.icon, total: o.p / 100, count: o.count, pct: total ? Math.round(o.p / total * 100) : 0 }; })
      .sort(function (a, b) { return b.total - a.total; });
    return { list: list, total: total / 100 };
  }

  /* ---------- Backup and restore ---------- */
  function backupData() {
    return {
      app: 'kharcha-book', format: 1, exportedAt: new Date().toISOString(),
      entries: state.entries.filter(function (e) { return e && !e.synthetic; }).map(function (e) {
        return { amount: e.amount, desc: e.desc, ts: e.ts, refNo: e.refNo || null, kind: e.kind || null, method: e.method || null };
      }),
      settings: kv.localSharedValues()
    };
  }
  function entryKey(amount, desc, ts) { return Math.round(ts / 1000) + '|' + paise(amount) + '|' + String(desc || '').trim(); }
  function inspectBackup(obj) {
    if (!obj || obj.app !== 'kharcha-book' || !Array.isArray(obj.entries)) return null;
    var have = {}; state.entries.forEach(function (e) { have[entryKey(e.amount, e.desc, e.ts)] = 1; });
    var missing = obj.entries.filter(function (e) { return e && isFinite(e.amount) && isFinite(e.ts) && typeof e.desc === 'string' && !have[entryKey(e.amount, e.desc, e.ts)]; });
    var keys = Object.keys(obj.settings || {}).filter(isSharedKey);
    return { total: obj.entries.length, missing: missing, settingKeys: keys };
  }
  async function restoreData(obj, withSettings) {
    var info = inspectBackup(obj);
    if (!info) throw new Error('This file is not a Kharcha Book backup.');
    var added = 0, skipped = 0;
    for (var i = 0; i < info.missing.length && i < 3000; i++) {
      var e = info.missing[i];
      try { await store.add({ amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString(), ref_no: e.refNo || undefined, method: e.method || undefined, kind: e.kind || undefined }); added++; }
      catch (err) { skipped++; }
    }
    if (withSettings) info.settingKeys.forEach(function (k) { if (obj.settings[k] != null) kv.set(k, obj.settings[k]); });
    render();
    return { added: added, skipped: skipped, settings: withSettings ? info.settingKeys.length : 0 };
  }

  /* ---------- Receipt photos: a private Supabase Storage bucket, one folder per user ---------- */
  var RECEIPT_BUCKET = 'kharcha-receipts', RECEIPTS_KEY = 'kharcha_receipts';
  function receiptMap() { return loadJsonObj(RECEIPTS_KEY); }
  function hasReceipt(id) { return !!receiptMap()[id]; }
  function setReceiptFlag(id, on) { var m = receiptMap(); if (on) m[id] = 1; else delete m[id]; kv.set(RECEIPTS_KEY, JSON.stringify(m)); }
  async function receiptPath(id) { var u = await sb.auth.getUser(); if (!u.data || !u.data.user) throw new Error('Sign in again to use receipts.'); return u.data.user.id + '/' + id + '.jpg'; }
  function shrinkImage(file) {                      // keeps phone photos small: longest side 1280px, JPEG
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1280, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not read that photo.')); }, 'image/jpeg', 0.72);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
      img.src = url;
    });
  }
  async function uploadReceipt(id, file) {
    if (isDemoMode) throw new Error('Receipts need a signed-in account.');
    var blob = await shrinkImage(file), path = await receiptPath(id);
    var res = await sb.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (res.error) throw res.error;
    setReceiptFlag(id, true);
  }
  async function receiptUrl(id) {
    var res = await sb.storage.from(RECEIPT_BUCKET).createSignedUrl(await receiptPath(id), 300);
    if (res.error || !res.data) throw new Error('Could not open the receipt.');
    return res.data.signedUrl;
  }
  async function removeReceipt(id) {
    var res = await sb.storage.from(RECEIPT_BUCKET).remove([await receiptPath(id)]);
    if (res.error) throw res.error;
    setReceiptFlag(id, false);
  }
  async function moveReceipt(fromId, toId) {                       // after Undo of a delete the entry has a new id
    var res = await sb.storage.from(RECEIPT_BUCKET).move(await receiptPath(fromId), await receiptPath(toId));
    if (res.error) throw res.error;
    setReceiptFlag(fromId, false); setReceiptFlag(toId, true);
  }
  function showReceipt(id) {
    var back = el('div', 'tour'), box = el('div', 'tour-card rep-box'), img = el('img', 'rep-img'); img.alt = 'Receipt';
    box.appendChild(img); back.appendChild(box);
    var btns = el('div', 'tour-btns'), close = el('button', 'primary', 'Close'); close.type = 'button'; close.addEventListener('click', function () { back.remove(); });
    btns.appendChild(close); box.appendChild(btns);
    back.addEventListener('click', function (ev) { if (ev.target === back) back.remove(); });
    document.body.appendChild(back);
    receiptUrl(id).then(function (u) { img.src = u; }).catch(function (err) { back.remove(); toast(err.message || 'Could not open the receipt.'); });
  }
  function receiptRow(e, onChange) {
    var box = el('div', 'receipt-row');
    function paint() {
      box.textContent = '';
      var has = hasReceipt(e.id);
      box.appendChild(el('span', 'receipt-l', has ? '📎 Receipt attached' : '📷 Receipt'));
      var input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      input.addEventListener('change', function () {
        var f = input.files && input.files[0]; if (!f) return;
        toast('Uploading receipt…');
        uploadReceipt(e.id, f).then(function () { toast('Receipt saved'); paint(); render(); }).catch(function (err) { toast(err && err.message ? err.message : 'Could not save the receipt.'); });
      });
      var add = el('button', 'ghost', has ? 'Replace' : 'Add photo'); add.type = 'button'; add.addEventListener('click', function () { input.click(); });
      if (has) {
        var view = el('button', 'ghost', 'View'); view.type = 'button'; view.addEventListener('click', function () { showReceipt(e.id); }); box.appendChild(view);
      }
      box.appendChild(add);
      if (has) {
        var rm = el('button', 'ghost', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', function () {
          showConfirmModal({ title: 'Remove this receipt?', message: 'The photo is deleted from your account.', onConfirm: function () {
            removeReceipt(e.id).then(function () { toast('Receipt removed'); paint(); render(); }).catch(function () { toast('Could not remove it. Try again.'); });
          } });
        });
        box.appendChild(rm);
      }
      box.appendChild(input);
    }
    paint();
    return box;
  }

  /* ---------- Net worth: what you hold minus what you owe ---------- */
  function getNetWorthParts() {
    var KL = window.KharchaLedger, parts = { hasBank: false, bank: 0, cash: 0, wallets: 0, owedToMe: 0, iOwe: 0, total: 0, trend: [] };
    if (!KL) return parts;
    var b = getBankTotals(), accts = loadBank(), refs = {}, held = {};
    parts.hasBank = b.has; parts.bank = b.total;
    accts.forEach(function (a) {
      (a.deposits || []).forEach(function (d) { if (d.ref) refs[d.ref] = 1; });
      (a.held || []).forEach(function (id) { held[id] = 1; });
    });
    parts.cash = sumRupees(state.entries.filter(function (e) { return held[e.id] && !refs[e.id] && isIncome(e); }));
    loadWallets().forEach(function (w) { parts.wallets += KL.walletState(state.entries, w).balance; });
    var sm = KL.summarize(loadLoans());
    parts.owedToMe = sm.totalOwedToMe; parts.iOwe = sm.totalIOwe;
    parts.total = (paise(parts.bank) + paise(parts.cash) + paise(parts.wallets) + paise(parts.owedToMe) - paise(parts.iOwe)) / 100;
    // A 30-day line, worked backwards from today: undo the bank movements logged after each day.
    var now = Date.now(), day0 = startOfDay(now);
    for (var i = 30; i >= 0; i--) {
      var t = day0 - i * 86400000 + 86399999, move = 0;
      state.entries.forEach(function (e) {
        if (!e || e.synthetic || !(e.ts > t) || e.ts > now) return;
        if (isBankIn(e) && !held[e.id]) move += paise(e.amount); else if (isBankOut(e)) move -= paise(e.amount);
      });
      parts.trend.push({ ts: t, v: (paise(parts.total) - move) / 100 });
    }
    return parts;
  }

  function getBankTotals() {
    var KL = window.KharchaLedger, accts = loadBank(), p = 0;
    if (!KL) return { has: false, total: 0, count: 0 };
    accts.forEach(function (a) { var pr = bankPreds(a, accts); p += paise(KL.bankEstimate(state.entries, a, pr.isIn, pr.isOut, loadTransfers()).balance); });
    return { has: accts.length > 0, total: p / 100, count: accts.length };
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
    // ATM cash not yet itemised still counts in its month (see isCashWithdrawal).
    (entries || []).filter(isCashWithdrawal).forEach(function (e) {
      var k = monthKey(e.ts);
      if (!map.has(k)) map.set(k, { key: k, items: [] });
    });
    map.forEach(function (m) {
      var cash = unaccountedCashEntry(entries, m.key);
      if (cash) m.items.push(cash);
    });
    return Array.from(map.values())
      .map(function (m) {
        var top = byDescription(m.items)[0];
        var count = m.items.filter(function (e) { return !e.synthetic; }).length;
        return { key: m.key, total: sumRupees(m.items), count: count, top: top ? top.label : '', topTotal: top ? top.total : 0 };
      })
      .sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  }

  // Every month that has any entry at all (income, investments, transfers), not only months with spending:
  // a month that holds just a salary must still be reachable from the month arrows and the month list.
  function monthsWithAnyEntry(entries) {
    var months = monthTotals(entries), have = {};
    months.forEach(function (m) { have[m.key] = true; });
    (entries || []).forEach(function (e) {
      if (e.synthetic) return;
      var k = monthKey(e.ts);
      if (!have[k]) { have[k] = true; months.push({ key: k, total: 0, count: 0, top: '', topTotal: 0, noSpend: true }); }
    });
    return months.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
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
      // Whole emoji only: a /[🏠👤]/ class without the u flag also ate half of 💵 💊 💳 💰.
      var clean = desc.replace(/^(?:🏠|👤)\s*/u, '').trim();
      var firstSymbol = Array.from(clean)[0] || '💳';
      var categoryName = clean;

      var lower = clean.toLowerCase();
      if (clean.indexOf('💵 Unaccounted cash') === 0) categoryName = '💵 Unaccounted cash';
      else if (clean.includes('🛒') || lower.includes('grocery') || lower.includes('supermarket') || lower.includes('dmart') || lower.includes('zepto') || lower.includes('blinkit') || lower.includes('instamart') || lower.includes('bigbasket')) categoryName = '🛒 Grocery';
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
    getEntries: function () { return state.entries; },
    getMonthlySummary: getMonthlySummary, getMonthlyHistory: getMonthlyHistory, monthsWithAnyEntry: monthsWithAnyEntry, getPeriodSummary: getPeriodSummary, isBankIn: isBankIn, isBankOut: isBankOut, getBankTotals: getBankTotals, getHomeFacts: getHomeFacts, isIncome: isIncome, getNetWorthParts: getNetWorthParts, getSpendSources: getSpendSources, backupData: backupData, inspectBackup: inspectBackup, restoreData: restoreData, loadRules: loadRules, kvGet: function (k) { return kv.get(k); }, kvSet: function (k, v) { kv.set(k, v); }, toast: function (m, u) { toast(m, u); }, confirmBox: function (o) { showConfirmModal(o); }, startOfDay: startOfDay,
    parseAmount: parseAmount, normDesc: normDesc, money: money, groupByDay: groupByDay, byDescription: byDescription, monthTotals: monthTotals, toLocalISOString: toLocalISOString, isFamilyEntry: isFamilyEntry, parseBankSMS: parseBankSMS, parseSMSDate: parseSMSDate, findDuplicate: findDuplicate, categoryBreakdown: categoryBreakdown, monthCompare: monthCompare,
    isIncome: isIncome, isMotherSettlement: isMotherSettlement, isMotherPension: isMotherPension, isSalary: isSalary, isExpense: isExpense, isInvestment: isInvestment, getFamilySettlement: getFamilySettlement, getPersonalCashFlow: getPersonalCashFlow,
    isProjectEntry: isProjectEntry, isProjectMotherPaid: isProjectMotherPaid, getProjectSummary: getProjectSummary,
    isTripEntry: isTripEntry, getTripSummary: getTripSummary, parseTripPayer: parseTripPayer,
    getAllTrips: getAllTrips, getTripFriends: getTripFriends, addTripFriend: addTripFriend, removeTripFriend: removeTripFriend,
    getEntryScope: getEntryScope, shiftScopeDesc: shiftScopeDesc,
    rememberMerchantScope: rememberMerchantScope, predictMerchantScope: predictMerchantScope,
    recentSpendsForTrip: recentSpendsForTrip, recurringBills: recurringBills, monthForecast: monthForecast,
    upiPayLink: upiPayLink, settleMessage: settleMessage, whatsappLink: whatsappLink,
    isCashWithdrawal: isCashWithdrawal, cashSummary: cashSummary, unaccountedCashEntry: unaccountedCashEntry,
    methodBreakdown: methodBreakdown, methodLabel: methodLabel,
    isCardEntry: isCardEntry, isCardBillEntry: isCardBillEntry, isTransferEntry: isTransferEntry, loadOwn: loadOwn
  };

  var TABLE = 'daily_expenses';
  var COLS = 'id, amount, description, spent_at';
  // ref_no / raw_sms come from supabase/daily_expenses_v2_sms.sql. Until that migration runs, the app falls back to COLS.
  var COLS_EXT = COLS + ', ref_no, raw_sms';
  // kind / method / account_last4 / bank come from supabase/kharcha_v5_money_types.sql.
  var COLS_V5 = COLS_EXT + ', kind, method, account_last4, bank';
  var hasExtCols = true;   // v2 columns present
  var hasV5Cols = true;    // v5 columns present
  function selectCols() { return hasV5Cols ? COLS_V5 : (hasExtCols ? COLS_EXT : COLS); }
  // A missing column drops one tier (v5 -> v2 -> basic) and the caller retries.
  function downgradeCols() {
    if (hasV5Cols) { hasV5Cols = false; return true; }
    if (hasExtCols) { hasExtCols = false; return true; }
    return false;
  }
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

  /* ---------- Shared settings: one row in Supabase kharcha_settings, used by web + phone ----------
     Same keys and string values as localStorage, so feature code just swaps localStorage for kv.
     localStorage stays as the offline cache, and is all there is until the v4 SQL has been run. */
  var SHARED_KEYS = ['kharcha_merchant_scope_map', 'kharcha_monthly_budget', 'kharcha_active_project_name',
    'kharcha_active_trip_name', 'kharcha_all_trips_list', 'kharcha_category_budgets', 'kharcha_merchant_memory',
    'kharcha_owner_identity', 'kharcha_my_upi', 'kharcha_family_payers', 'kharcha_loans', 'kharcha_wallets', 'kharcha_bank', 'kharcha_cycle', 'kharcha_rules', 'kharcha_acctmap', 'kharcha_primary_acct', 'kharcha_rule_skips', 'kharcha_transfers', 'kharcha_own', 'kharcha_xfer_dismissed', 'kharcha_goal', 'kharcha_receipts', 'kharcha_rules_seeded', 'kharcha_card', 'kharcha_dup_dismissed'];
  var SHARED_PREFIXES = ['kharcha_trip_friends_', 'kharcha_trip_budget_'];
  function isSharedKey(k) {
    return SHARED_KEYS.indexOf(k) >= 0 || SHARED_PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
  }
  var kv = {
    data: {}, remote: false, userId: null, timer: null,
    get: function (k) {
      if (Object.prototype.hasOwnProperty.call(this.data, k)) return this.data[k];
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set: function (k, v) {
      v = String(v);
      this.data[k] = v;
      try { localStorage.setItem(k, v); } catch (e) {}
      this.schedulePush();
    },
    remove: function (k) {
      this.data[k] = null; // null (not delete) so the removal reaches the other devices
      try { localStorage.removeItem(k); } catch (e) {}
      this.schedulePush();
    },
    localSharedValues: function () {
      var out = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (isSharedKey(k)) out[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return out;
    },
    // Server wins for keys it has; keys only this device knows are kept and pushed up.
    load: async function () {
      try {
        var user = (await sb.auth.getUser()).data.user;
        if (!user) return;
        this.userId = user.id;
        var res = await sb.from('kharcha_settings').select('data').maybeSingle();
        if (res.error) { console.warn('Kharcha: shared settings unavailable (' + res.error.message + '); using this device only'); return; }
        var server = (res.data && res.data.data) || {};
        var local = this.localSharedValues();
        var changed = !res.data;
        Object.keys(local).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(server, k)) { server[k] = local[k]; changed = true; } });
        this.data = server;
        Object.keys(server).forEach(function (k) {
          try { if (server[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, String(server[k])); } catch (e) {}
        });
        this.remote = true;
        if (changed) await this.push();
      } catch (e) { console.warn('Kharcha: shared settings load failed', e); }
    },
    schedulePush: function () {
      var self = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.timer = null; self.push(); }, 600);
    },
    push: async function () {
      if (!this.remote || !this.userId) return;
      var res = await sb.from('kharcha_settings').upsert({ user_id: this.userId, data: this.data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (res.error) console.warn('Kharcha: shared settings save failed', res.error.message);
    }
  };

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
    return {
      id: r.id, amount: Number(r.amount), desc: r.description, ts: Date.parse(r.spent_at), refNo: r.ref_no || null,
      raw: r.raw_sms || '', kind: r.kind || null, method: r.method || null, last4: r.account_last4 || null, bank: r.bank || null
    };
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
        if (res.error && isMissingColumn(res.error) && downgradeCols()) {
          console.warn('Kharcha: missing columns, retrying with ' + selectCols());
          continue;
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
        var mockEntry = { id: 'demo-' + Date.now(), amount: e.amount, desc: cleanDesc, ts: e.spent_at ? Date.parse(e.spent_at) : Date.now(), refNo: e.ref_no || null, method: e.method || null, kind: e.kind || null };
        state.entries.push(mockEntry);
        return mockEntry;
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
      if (hasV5Cols && e.method) payload.method = e.method;
      if (hasV5Cols && e.kind) payload.kind = e.kind;
      var res = await sb.from(TABLE).insert([payload]).select(selectCols()).single();
      while (res.error && isMissingColumn(res.error) && downgradeCols()) {
        if (!hasV5Cols) { delete payload.method; delete payload.kind; }
        if (!hasExtCols) { delete payload.ref_no; delete payload.raw_sms; }
        res = await sb.from(TABLE).insert([payload]).select(selectCols()).single();
      }
      if (res.error && res.error.code === '23505') {
        throw new Error('Already added: this transaction (Ref ' + e.ref_no + ') is already in your Kharcha Book.');
      }
      if (res.error) {
        console.error('Supabase add error:', res.error);
        throw res.error;
      }
      var added = fromRow(res.data);
      state.entries.push(added);
      return added;
    },
    update: async function (id, patch) {
      var cleanDesc = safeTruncate(patch.desc, 50);
      var payload = { amount: patch.amount, description: cleanDesc };
      if (patch.spent_at) payload.spent_at = patch.spent_at;
      if (hasV5Cols && patch.method !== undefined) payload.method = patch.method || null;
      var res = await sb.from(TABLE).update(payload).eq('id', id).select(selectCols()).single();
      while (res.error && isMissingColumn(res.error) && downgradeCols()) {
        if (!hasV5Cols) delete payload.method;
        res = await sb.from(TABLE).update(payload).eq('id', id).select(selectCols()).single();
      }
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
      if (input && input.name === 'scope') updateTripPickRow();
    });
  });

  // Populated with every trip that exists (not just the active one), so a hotel/flight booked
  // ahead of a trip that hasn't started yet can be tagged to it without making it the active trip.
  function updateTripPickRow() {
    var row = $('trip-pick-row');
    var select = $('trip-pick');
    if (!row || !select) return;
    row.hidden = getSelectedScope() !== 'trip';
    if (row.hidden) return;
    var current = select.value;
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ New trip…';
    select.appendChild(placeholder);
    var active = getActiveTripName();
    getAllTrips().forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = '✈️ ' + t + (t === active ? ' (active)' : '');
      select.appendChild(opt);
    });
    if (current && getAllTrips().includes(current)) select.value = current;
  }
  var tripPickSelect = $('trip-pick');
  if (tripPickSelect) {
    tripPickSelect.addEventListener('change', function () {
      if (tripPickSelect.value !== '') return;
      showInputModal({
        title: '✈️ New trip',
        message: "Name it now and tag this expense to it -- it won't become your active trip until you switch to it later.",
        fields: [{ label: 'Trip name', placeholder: 'e.g. Goa Dec' }],
        confirmText: 'Create',
        onConfirm: function (values) {
          var name = (values[0] || '').trim();
          if (!name) return;
          saveTripToList(name);
          updateTripPickRow();
          tripPickSelect.value = name;
        }
      });
    });
  }

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
  function getBudget() { try { return Number(kv.get(BUDGET_KEY)) || 0; } catch (e) { return 0; } }
  function setBudget(val) { try { if (val > 0) kv.set(BUDGET_KEY, String(val)); else kv.remove(BUDGET_KEY); } catch (e) {} }

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

  /* In-app text input pop-up -- replaces window.prompt(), which in the Android app (WebView) shows
     the system's bare dialog instead of something that looks like Kharcha Book.
     options: { title, message, fields: [{ label, value, placeholder, inputmode }], confirmText,
                onConfirm(values) } -- values is an array of trimmed strings, one per field. */
  function showInputModal(options) {
    var back = el('div', 'modal-backdrop');
    var card = el('div', 'modal-card modal-input');
    var form = document.createElement('form');
    form.noValidate = true;
    var head = el('div', 'modal-head');
    head.appendChild(el('h3', null, options.title || 'Enter details'));
    var x = el('button', 'close-btn', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    head.appendChild(x);
    form.appendChild(head);
    if (options.message) form.appendChild(el('p', 'modal-intro', options.message));
    var inputs = (options.fields || [{}]).map(function (f) {
      var wrap = el('label', 'field modal-field');
      if (f.label) wrap.appendChild(el('span', 'modal-field-label', f.label));
      var input = el('input', 'input');
      input.type = 'text';
      input.value = f.value || '';
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.inputmode) input.setAttribute('inputmode', f.inputmode);
      input.autocomplete = 'off';
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    });
    var foot = el('div', 'modal-foot');
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    var ok = el('button', 'primary', options.confirmText || 'Save'); ok.type = 'submit';
    foot.appendChild(cancel); foot.appendChild(ok);
    form.appendChild(foot);
    card.appendChild(form);
    back.appendChild(card);
    document.body.appendChild(back);

    function close() { document.removeEventListener('keydown', onKey); back.remove(); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    x.addEventListener('click', close);
    cancel.addEventListener('click', close);
    back.addEventListener('click', function (ev) { if (ev.target === back) close(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var values = inputs.map(function (i) { return i.value.trim(); });
      close();
      if (options.onConfirm) options.onConfirm(values);
    });
    setTimeout(function () { if (inputs[0]) { inputs[0].focus(); inputs[0].select(); } }, 50);
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

  /* Hero Insights & Stats Accordion Toggle */
  var insightsToggle = $('hero-insights-toggle');
  var insightsPanel = $('hero-insights-panel');
  if (insightsToggle && insightsPanel) {
    insightsToggle.addEventListener('click', function () {
      var isHidden = insightsPanel.hidden;
      insightsPanel.hidden = !isHidden;
      insightsToggle.setAttribute('aria-expanded', String(isHidden));
    });
  }

  /* ---------- Search & CSV Export ---------- */
  $('search').addEventListener('input', function (ev) {
    searchQuery = ev.target.value.trim().toLowerCase();
    render();
  });

  $('export-csv').addEventListener('click', function () {
    var list = visibleEntries(state.sel);
    if (!list.length) { toast('No expenses to export for this view.'); return; }
    var csv = ['Date,Time,Category,Description,Amount (INR),Paid via'];
    list.sort(byTimeDesc).forEach(function (e) {
      var d = new Date(e.ts);
      var dateStr = dayKey(e.ts);
      var timeStr = tFmt.format(d);
      var catStr = isFamilyEntry(e.desc) ? 'Family/Bill' : 'Personal';
      var descStr = '"' + e.desc.replace(/"/g, '""') + '"';
      csv.push(dateStr + ',' + timeStr + ',' + catStr + ',' + descStr + ',' + e.amount + ',"' + methodLabel(e).replace(/"/g, '""') + '"');
    });
    var fileName = 'kharcha-' + state.scopeFilter + '-' + state.sel + '.csv';
    // Inside the SpendTrack app there are no browser downloads; hand the file to Android's share sheet.
    if (window.KharchaNative && typeof window.KharchaNative.shareFile === 'function') {
      window.KharchaNative.shareFile(fileName, 'text/csv', csv.join('\n'));
      toast('CSV ready for ' + monthLabel(state.sel) + ' — choose where to save it');
      return;
    }
    var blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded CSV for ' + monthLabel(state.sel));
  });

  /* ---------- small UI helpers ---------- */
  var toastTimer = 0;
  // toast(msg) shows a short note. toast(msg, undoFn) also shows an Undo button for a few seconds.
  function toast(msg, undoFn) {
    var t = $('toast');
    t.textContent = ''; t.appendChild(document.createTextNode(msg));
    if (undoFn) {
      var u = el('button', 'toast-undo', 'Undo'); u.type = 'button';
      u.addEventListener('click', function () { t.hidden = true; clearTimeout(toastTimer); undoFn(); });
      t.appendChild(u);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, undoFn ? 7000 : 2600);
  }
  // Puts an entry back the way it was (used by Undo).
  function restoreEntry(e) {
    return store.update(e.id, { amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString(), method: e.method || null })
      .then(function () { render(); toast('Restored'); })
      .catch(function () { toast('Could not undo. Try again.'); });
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

  function renderForecast(nowKey) {
    var card = $('forecast-card');
    if (!card) return;
    if (state.sel !== nowKey) { card.hidden = true; return; }
    var fc = monthForecast(state.entries, nowKey, new Date());
    var bills = recurringBills(state.entries, nowKey);
    if (!fc.spent && !bills.length) { card.hidden = true; return; }
    card.hidden = false;
    $('fc-projected').textContent = money(fc.projected);
    $('fc-sub').textContent = 'Spent ' + money(fc.spent) + ' so far' +
      (fc.upcoming ? ' · ' + money(fc.upcoming) + ' in bills still due' : '') + ' · rest at your current daily pace';
    var ul = $('fc-bills');
    ul.textContent = '';
    bills.forEach(function (b) {
      var li = el('li', b.paidThisMonth ? 'fc-bill paid' : 'fc-bill');
      li.appendChild(el('span', null, (b.paidThisMonth ? '✓ ' : '⏳ ') + b.label));
      li.appendChild(el('span', null, money(b.amount) + ' · ~' + b.day + dayOrdinal(b.day)));
      ul.appendChild(li);
    });
  }
  // Inside the Android app: hand this month's numbers to the home-screen widget.
  function reportNativeSummary(nowKey) {
    var bridge = window.KharchaNative;
    if (!bridge || !bridge.reportSummary) return;
    try {
      var fc = monthForecast(state.entries, nowKey, new Date());
      // Recurring bills go to the phone, which reminds you a couple of days before each is due.
      var bills = recurringBills(state.entries, nowKey).filter(function (b) { return b.isExpense; }).slice(0, 40)
        .map(function (b) { return { key: b.key, label: b.label, amount: b.amount, day: b.day, paidThisMonth: b.paidThisMonth }; });
      bridge.reportSummary(JSON.stringify({
        month: monthLabel(nowKey),
        spentLabel: money(fc.spent),
        projectedLabel: money(fc.projected),
        bills: bills
      }));
    } catch (e) { /* widget is best-effort */ }
  }
  function dayOrdinal(d) {
    if (d % 100 >= 11 && d % 100 <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][d % 10] || 'th';
  }

  // Adds the "💵 Unaccounted cash" line for the month, except when it can't belong to the view
  // (Family tab, or a search for something specific).
  function withCashLine(list, key) {
    if (state.scopeFilter === 'family' || searchQuery) return list;
    var line = unaccountedCashEntry(state.entries, key);
    return line ? list.concat([line]) : list;
  }

  /* ---------- Cash wallet card ---------- */
  function renderCashWallet(c) {
    var card = $('cash-wallet');
    if (!card) return;
    card.hidden = !(c.withdrawn > 0 || c.spent > 0);
    if (card.hidden) return;
    $('cw-withdrawn').textContent = money(c.withdrawn);
    $('cw-spent').textContent = money(c.spent);
    $('cw-unaccounted').textContent = money(c.unaccounted);
    $('cw-note').textContent = c.unaccounted > 0
      ? money(c.unaccounted) + ' of cash isn\'t itemised yet. It\'s counted as "Unaccounted cash"; log cash spends to move it into real categories.'
      : 'All withdrawn cash is itemised. 👍';
  }

  /* ---------- By payment method ---------- */
  function renderMethodBreakdown(list) {
    var sec = $('method-sec');
    var box = $('method-breakdown');
    if (!sec || !box) return;
    var rows = methodBreakdown(list);
    // Nothing to show until rows carry a method (phone-synced, or picked when adding).
    var known = rows.filter(function (r) { return r.method !== 'unknown'; });
    sec.hidden = !known.length;
    box.textContent = '';
    if (sec.hidden) return;
    rows.forEach(function (r) {
      var row = el('div', 'cat-row method-row');
      var head = el('div', 'cat-row-head');
      head.appendChild(el('span', null, r.icon + ' ' + r.label + ' (' + r.count + ')'));
      head.appendChild(el('span', null, money(r.total) + ' · ' + r.pct + '%'));
      var track = el('div', 'cat-track');
      var fill = el('div', 'cat-fill method-' + r.method);
      fill.style.width = Math.min(100, Math.max(2, r.pct)) + '%';
      track.appendChild(fill);
      row.appendChild(head);
      row.appendChild(track);
      box.appendChild(row);
    });
    var cc = rows.filter(function (r) { return r.method === 'credit_card'; }).reduce(function (s, r) { return s + r.total; }, 0);
    var note = $('method-note');
    if (note) {
      note.hidden = !cc;
      if (cc) note.textContent = '💳 ' + money(cc) + ' on credit cards this month: that lands on your card bill, not your bank balance yet.';
    }
  }

  function render() {
    var nowKey = monthKey(Date.now());
    var months = monthsWithAnyEntry(state.entries);
    if (!months.some(function (m) { return m.key === nowKey; })) months.unshift({ key: nowKey, total: 0, count: 0 });
    months.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    if (!state.sel || !months.some(function (m) { return m.key === state.sel; })) state.sel = nowKey;
    var idx = months.findIndex(function (m) { return m.key === state.sel; });
    var cur = months[idx];

    renderForecast(nowKey);
    reportNativeSummary(nowKey);

    var list = visibleEntries(state.sel);
    var prevKey = prevMonthKey(state.sel);
    var prevList = visibleEntries(prevKey);
    // Totals/breakdowns include ATM cash not yet itemised; the day list shows only real rows.
    var totalsList = withCashLine(list, state.sel);
    var cmp = monthCompare(totalsList, withCashLine(prevList, prevKey));

    var displayTotal = sumRupees(totalsList);
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
    var byDesc = byDescription(totalsList)[0];
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
    var curViewTrip = getSelectedViewTripName();
    var curViewFriends = curViewTrip ? getTripFriends(curViewTrip) : ['Me'];
    var tripSummary = getTripSummary(allMonthEntries, curViewTrip, curViewFriends);

    renderCashFlow(cashFlow, settlement);
    renderStreamSwitcher(monthExpenses.length, monthIncomings.length, projSummary.entries.length, monthInvestments.length, tripSummary.entries.length);

    renderBudget(cur.total);
    renderSuggestions();
    refreshIncomeAcct();
    renderDue();
    var paidViaField = $('paid-via-field');
    if (paidViaField) paidViaField.hidden = !hasV5Cols;
    renderCategoryBreakdown(totalsList, cmp, prevKey);
    renderCashWallet(cashSummary(state.entries, state.sel));
    renderMethodBreakdown(totalsList);
    renderBreakdown(totalsList, displayTotal);
    renderDays(days);
    renderMonths(months);

    // Stream Views Rendering
    renderIncomingsView(monthIncomings);
    renderSettlementView(settlement);
    renderProjectView(projSummary);
    renderInvestmentsView(monthInvestments);
    renderTripsView(tripSummary, allMonthEntries);

    renderSync();
    try { document.dispatchEvent(new Event('kharcha:render')); } catch (e) {}
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


  /* ---------- Trip settle-up: who pays whom, and for what ---------- */
  var tripSettleMode = 'fewest';
  function personLabel(n) { return n === 'Me' ? 'You' : n; }
  function possessive(n) { return n === 'Me' ? 'your' : n + '’s'; }
  function renderTripSettle(tripSummary, viewTrip) {
    var box = $('trip-settle');
    if (!box) return;
    box.textContent = '';
    var KL = window.KharchaLedger;
    if (!KL || !viewTrip || !tripSummary.entries.length) return;
    var res = KL.tripSettlement(tripSummary.entries.map(function (e) {
      return { id: e.id, label: KL.tripItemLabel(e.desc), amount: e.amount, payer: parseTripPayer(e.desc) };
    }), tripSummary.participants);

    var head = el('div', 'ts-head');
    head.appendChild(el('span', 'ts-title', '🤝 Who pays whom'));
    var modes = el('div', 'ts-modes');
    [['fewest', 'Fewest payments'], ['why', 'For what']].forEach(function (m) {
      var b = el('button', 'ts-mode' + (tripSettleMode === m[0] ? ' active' : ''), m[1]);
      b.type = 'button';
      b.addEventListener('click', function () { tripSettleMode = m[0]; renderTripSettle(tripSummary, viewTrip); });
      modes.appendChild(b);
    });
    head.appendChild(modes);
    box.appendChild(head);

    if (!res.transfers.length) { box.appendChild(el('p', 'ts-empty', 'Everyone is square. Nobody owes anyone. 🎉')); return; }
    var myUpi = (kv.get('kharcha_my_upi') || '').trim();
    var list = el('ul', 'ts-list');
    if (tripSettleMode === 'fewest') {
      res.transfers.forEach(function (t) {
        var li = el('li', 'ts-row');
        li.appendChild(el('span', 'ts-who', personLabel(t.from) + ' → ' + personLabel(t.to)));
        li.appendChild(el('span', 'ts-amt', money(t.amount)));
        if (t.to === 'Me') {
          var ask = el('a', 'fbr-ask', '📲 Ask');
          ask.href = whatsappLink(settleMessage(t.from, t.amount, viewTrip + ' trip', myUpi));
          ask.target = '_blank'; ask.rel = 'noopener';
          li.appendChild(ask);
        }
        list.appendChild(li);
      });
    } else {
      res.pairs.forEach(function (p) {
        var li = el('li', 'ts-pair');
        var top = el('div', 'ts-row');
        top.appendChild(el('span', 'ts-who', personLabel(p.from) + (p.from === 'Me' ? ' owe ' : ' owes ') + personLabel(p.to)));
        top.appendChild(el('span', 'ts-amt', money(p.amount)));
        li.appendChild(top);
        var items = el('ul', 'ts-items');
        p.items.forEach(function (it) {
          var r = el('li', 'ts-item' + (it.kind === 'offset' ? ' offset' : ''));
          r.appendChild(el('span', null, it.kind === 'owes'
            ? it.label + ' (' + possessive(p.from) + ' share)'
            : 'Less: ' + it.label + ' (paid by ' + personLabel(p.from) + ', ' + possessive(p.to) + ' share)'));
          r.appendChild(el('span', null, (it.kind === 'offset' ? '− ' : '') + money(it.amount)));
          items.appendChild(r);
        });
        li.appendChild(items);
        list.appendChild(li);
      });
    }
    box.appendChild(list);
  }

  /* ---------- Udhaar: money I lent or borrowed ---------- */
  var udhaar = { formOpen: false, kind: 'lent', open: {}, showSettled: false, editing: null };
  function loadLoans() { return window.KharchaLedger ? window.KharchaLedger.parseLoans(kv.get('kharcha_loans')) : []; }
  function saveLoans(list) { kv.set('kharcha_loans', JSON.stringify(list)); }
  function newLoanId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function udhaarNames(loans) {
    var seen = {}, out = [];
    function add(n) { var c = window.KharchaLedger.cleanName(n); var k = c.toLowerCase(); if (c && k !== 'me' && !seen[k]) { seen[k] = 1; out.push(c); } }
    loans.forEach(function (l) { add(l.person); });
    getAllTrips().forEach(function (t) { getTripFriends(t).forEach(add); });
    return out;
  }
  function dateInputToTs(v) {
    if (!v || v === dayKey(Date.now())) return Date.now();
    var d = new Date(v + 'T12:00:00');
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
  }

  function renderUdhaar() {
    var root = $('udhaar-root');
    if (!root) return;
    var KL = window.KharchaLedger;
    root.textContent = '';
    if (!KL) { root.appendChild(el('p', 'err', 'Udhaar could not load. Refresh the page.')); return; }
    var loans = loadLoans();
    var sum = KL.summarize(loans);

    var card = el('div', 'udh-summary');
    var a = el('div', 'udh-fig');
    a.appendChild(el('span', 'udh-fig-l', 'Friends owe you'));
    a.appendChild(el('span', 'udh-fig-v', money(sum.totalOwedToMe)));
    card.appendChild(a);
    if (sum.totalIOwe > 0) {
      var b = el('div', 'udh-fig');
      b.appendChild(el('span', 'udh-fig-l', 'You owe'));
      b.appendChild(el('span', 'udh-fig-v owe', money(sum.totalIOwe)));
      card.appendChild(b);
    }
    root.appendChild(card);

    var addBtn = el('button', 'primary small', udhaar.formOpen ? 'Close' : '+ Add udhaar');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { udhaar.formOpen = !udhaar.formOpen; renderUdhaar(); });
    root.appendChild(addBtn);
    if (udhaar.formOpen) root.appendChild(udhaarForm(loans));

    var active = sum.people.filter(function (p) { return p.owedToMe > 0 || p.iOwe > 0; });
    var settled = sum.people.filter(function (p) { return !(p.owedToMe > 0 || p.iOwe > 0); });
    if (!sum.people.length) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, 'Nothing noted yet. Tap + Add udhaar to write down money you lent to a friend, or money you borrowed.'));
      root.appendChild(em);
      return;
    }
    var ul = el('ul', 'udh-people');
    active.forEach(function (p) { ul.appendChild(udhaarPerson(p, loans)); });
    root.appendChild(ul);
    if (!active.length) root.appendChild(el('p', 'ts-empty', 'All settled. Nobody owes anything. 🎉'));
    if (settled.length) {
      var tog = el('button', 'linkbtn', (udhaar.showSettled ? 'Hide' : 'Show') + ' settled (' + settled.length + ')');
      tog.type = 'button';
      tog.addEventListener('click', function () { udhaar.showSettled = !udhaar.showSettled; renderUdhaar(); });
      root.appendChild(tog);
      if (udhaar.showSettled) {
        var ul2 = el('ul', 'udh-people');
        settled.forEach(function (p) { ul2.appendChild(udhaarPerson(p, loans)); });
        root.appendChild(ul2);
      }
    }
  }

  function udhaarForm(loans) {
    var KL = window.KharchaLedger;
    var f = el('form', 'add udh-form');
    f.noValidate = true;
    var kinds = el('div', 'udh-kinds');
    [['lent', 'They owe me'], ['borrowed', 'I owe them']].forEach(function (k) {
      var pill = el('button', 'scope-pill' + (udhaar.kind === k[0] ? ' active' : ''), k[1]);
      pill.type = 'button';
      pill.addEventListener('click', function () { udhaar.kind = k[0]; kinds.querySelectorAll('.scope-pill').forEach(function (x) { x.classList.toggle('active', x === pill); }); });
      kinds.appendChild(pill);
    });
    f.appendChild(kinds);
    function field(label, id, input) { var w = el('div', 'field'); var l = el('label', null, label); l.htmlFor = id; w.appendChild(l); w.appendChild(input); return w; }
    var name = el('input', 'input'); name.id = 'udh-name'; name.maxLength = 40; name.placeholder = 'Friend’s name'; name.setAttribute('list', 'udh-names'); name.autocomplete = 'off';
    var dl = document.createElement('datalist'); dl.id = 'udh-names';
    udhaarNames(loans).forEach(function (n) { var o = document.createElement('option'); o.value = n; dl.appendChild(o); });
    var amt = el('input', 'input'); amt.id = 'udh-amt'; amt.inputMode = 'decimal'; amt.placeholder = '0'; amt.autocomplete = 'off';
    var note = el('input', 'input'); note.id = 'udh-note'; note.maxLength = 80; note.placeholder = 'What for (optional)'; note.autocomplete = 'off';
    var date = el('input', 'input'); date.id = 'udh-date'; date.type = 'date'; date.value = dayKey(Date.now()); date.max = dayKey(Date.now());
    f.appendChild(field('Name', 'udh-name', name)); f.appendChild(dl);
    var row = el('div', 'add-row');
    row.appendChild(field('Amount (₹)', 'udh-amt', amt)); row.appendChild(field('Date', 'udh-date', date));
    f.appendChild(row);
    f.appendChild(field('Note', 'udh-note', note));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var save = el('button', 'primary', 'Save'); save.type = 'submit'; f.appendChild(save);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var who = KL.cleanName(name.value), n = parseAmount(amt.value);
      if (!who) { err.textContent = 'Add the person’s name.'; err.hidden = false; return; }
      if (n == null) { err.textContent = 'Enter an amount greater than zero, like 2500.'; err.hidden = false; return; }
      var list = loadLoans();
      list.push({ id: newLoanId(), person: who, kind: udhaar.kind, amount: n, note: note.value.trim().slice(0, 80), ts: dateInputToTs(date.value), payments: [] });
      saveLoans(list);
      udhaar.formOpen = false; udhaar.open[KL.nameKey(who)] = true;
      renderUdhaar();
      toast((udhaar.kind === 'lent' ? 'Noted: ' + who + ' owes you ' : 'Noted: you owe ' + who + ' ') + money(n));
    });
    return f;
  }

  // Inline fix-up forms: change a wrongly typed amount, name, note or date without losing the repayment history.
  function udhaarEditForm(l) {
    var KL = window.KharchaLedger;
    var f = el('form', 'udh-editform'); f.noValidate = true;
    function field(label, input) { var w = el('div', 'field'); w.appendChild(el('label', null, label)); w.appendChild(input); return w; }
    var name = el('input', 'input'); name.maxLength = 40; name.value = l.person;
    var amt = el('input', 'input'); amt.inputMode = 'decimal'; amt.value = String(l.amount);
    var note = el('input', 'input'); note.maxLength = 80; note.value = l.note || '';
    var date = el('input', 'input'); date.type = 'date'; date.value = dayKey(l.ts); date.max = dayKey(Date.now());
    f.appendChild(field('Name', name));
    var row = el('div', 'add-row'); row.appendChild(field('Amount (₹)', amt)); row.appendChild(field('Date', date)); f.appendChild(row);
    f.appendChild(field('Note', note));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var btns = el('div', 'edit-btns');
    var save = el('button', 'primary small', 'Save changes'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel); f.appendChild(btns);
    cancel.addEventListener('click', function () { udhaar.editing = null; renderUdhaar(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var n = parseAmount(amt.value);
      if (n == null) { err.textContent = 'Enter an amount greater than zero, like 12000.'; err.hidden = false; return; }
      var before = loadLoans(), cur = before.filter(function (x) { return x.id === l.id; })[0];
      if (!cur) return;
      var res = KL.editLoan(cur, { amount: n, person: name.value, note: note.value, ts: date.value === dayKey(cur.ts) ? cur.ts : dateInputToTs(date.value) });
      if (res.error) { err.textContent = res.error; err.hidden = false; return; }
      saveLoans(before.map(function (x) { return x.id === l.id ? res.loan : x; }));
      udhaar.editing = null; renderUdhaar();
      toast('Updated to ' + money(n), function () { saveLoans(before); renderUdhaar(); toast('Restored'); });
    });
    return f;
  }
  function udhaarPayEditForm(l, pay) {
    var KL = window.KharchaLedger;
    var f = el('form', 'udh-editform'); f.noValidate = true;
    var amt = el('input', 'input'); amt.inputMode = 'decimal'; amt.value = String(pay.amount); amt.setAttribute('aria-label', 'Repayment amount');
    var date = el('input', 'input'); date.type = 'date'; date.value = dayKey(pay.ts); date.max = dayKey(Date.now()); date.setAttribute('aria-label', 'Repayment date');
    var row = el('div', 'add-row'); row.appendChild(amt); row.appendChild(date); f.appendChild(row);
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var btns = el('div', 'edit-btns');
    var save = el('button', 'primary small', 'Save'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel); f.appendChild(btns);
    cancel.addEventListener('click', function () { udhaar.editing = null; renderUdhaar(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var n = parseAmount(amt.value);
      if (n == null) { err.textContent = 'Enter an amount greater than zero.'; err.hidden = false; return; }
      var before = loadLoans(), cur = before.filter(function (x) { return x.id === l.id; })[0];
      if (!cur) return;
      var res = KL.editPayment(cur, pay.id, { amount: n, ts: date.value === dayKey(pay.ts) ? pay.ts : dateInputToTs(date.value) });
      if (res.error) { err.textContent = res.error; err.hidden = false; return; }
      saveLoans(before.map(function (x) { return x.id === l.id ? res.loan : x; }));
      udhaar.editing = null; renderUdhaar();
      toast('Repayment updated', function () { saveLoans(before); renderUdhaar(); toast('Restored'); });
    });
    return f;
  }

  function udhaarPerson(p, allLoans) {
    var KL = window.KharchaLedger;
    var li = el('li', 'udh-person');
    var head = el('button', 'udh-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', udhaar.open[p.key] ? 'true' : 'false');
    head.appendChild(el('span', 'udh-name', p.name));
    var status;
    if (p.owedToMe > 0 && p.iOwe > 0) status = p.net >= 0 ? 'owes you ' + money(p.net) + ' net' : 'you owe ' + money(-p.net) + ' net';
    else if (p.owedToMe > 0) status = 'owes you ' + money(p.owedToMe);
    else if (p.iOwe > 0) status = 'you owe ' + money(p.iOwe);
    else status = 'settled';
    head.appendChild(el('span', 'udh-status' + (p.iOwe > 0 && p.owedToMe === 0 ? ' owe' : p.owedToMe > 0 ? ' get' : ''), status));
    head.addEventListener('click', function () { udhaar.open[p.key] = !udhaar.open[p.key]; renderUdhaar(); });
    li.appendChild(head);
    if (!udhaar.open[p.key]) return li;

    var body = el('div', 'udh-body');
    if (p.owedToMe > 0) {
      var rem = el('a', 'fbr-ask', '📲 Remind on WhatsApp');
      rem.href = whatsappLink(settleMessage(p.name, p.owedToMe, 'the money I lent you', (kv.get('kharcha_my_upi') || '').trim()));
      rem.target = '_blank'; rem.rel = 'noopener';
      body.appendChild(rem);
    }
    p.loans.forEach(function (l) {
      var left = KL.outstanding(l), box = el('div', 'udh-loan');
      var top = el('div', 'udh-loan-top');
      top.appendChild(el('span', null, (l.kind === 'lent' ? 'You lent ' : 'You borrowed ') + money(l.amount) + ' · ' + dFmt.format(new Date(l.ts)) + (l.note ? ' · ' + l.note : '')));
      var edt = el('button', 'udh-edit', 'Edit'); edt.type = 'button'; edt.setAttribute('aria-label', 'Edit this entry');
      edt.addEventListener('click', function () { udhaar.editing = udhaar.editing === l.id ? null : l.id; renderUdhaar(); });
      var del = el('button', 'udh-x', '×'); del.type = 'button'; del.setAttribute('aria-label', 'Delete this entry');
      del.addEventListener('click', function () {
        showConfirmModal({ title: 'Delete this entry?', message: money(l.amount) + ' with ' + l.person + ' and its repayments will be removed.', onConfirm: function () {
          var before = loadLoans();
          saveLoans(before.filter(function (x) { return x.id !== l.id; })); renderUdhaar();
          toast('Deleted', function () { saveLoans(before); renderUdhaar(); toast('Restored'); });
        } });
      });
      var tools = el('span', 'udh-tools'); tools.appendChild(edt); tools.appendChild(del);
      top.appendChild(tools);
      box.appendChild(top);
      if (udhaar.editing === l.id) box.appendChild(udhaarEditForm(l));
      var pct = Math.min(100, Math.round(((l.amount - left) / l.amount) * 100));
      var bar = el('div', 'bar'); var fill = el('i'); fill.style.width = pct + '%'; bar.appendChild(fill); box.appendChild(bar);
      box.appendChild(el('div', 'udh-loan-sub', left > 0 ? ('Pending ' + money(left) + (l.payments.length ? ' · repaid ' + money(KL.repaid(l)) : '')) : 'Fully settled ✓'));
      l.payments.forEach(function (pay) {
        var r = el('div', 'udh-pay');
        r.appendChild(el('span', null, (l.kind === 'lent' ? 'Got back ' : 'You paid ') + money(pay.amount) + ' · ' + dFmt.format(new Date(pay.ts))));
        var pe = el('button', 'udh-edit', 'Edit'); pe.type = 'button'; pe.setAttribute('aria-label', 'Edit this repayment');
        pe.addEventListener('click', function () { udhaar.editing = udhaar.editing === pay.id ? null : pay.id; renderUdhaar(); });
        var px = el('button', 'udh-x', '×'); px.type = 'button'; px.setAttribute('aria-label', 'Delete this repayment');
        px.addEventListener('click', function () {
          var before = loadLoans();
          saveLoans(before.map(function (x) { return x.id === l.id ? Object.assign({}, x, { payments: x.payments.filter(function (y) { return y.id !== pay.id; }) }) : x; }));
          renderUdhaar();
          toast('Repayment removed', function () { saveLoans(before); renderUdhaar(); toast('Restored'); });
        });
        var ptools = el('span', 'udh-tools'); ptools.appendChild(pe); ptools.appendChild(px);
        r.appendChild(ptools); box.appendChild(r);
        if (udhaar.editing === pay.id) box.appendChild(udhaarPayEditForm(l, pay));
      });
      if (left > 0) {
        var form = el('form', 'udh-repay'); form.noValidate = true;
        var inp = el('input', 'input'); inp.inputMode = 'decimal'; inp.placeholder = l.kind === 'lent' ? 'Got back ₹' : 'Paid back ₹'; inp.autocomplete = 'off';
        inp.setAttribute('aria-label', 'Repayment amount');
        var ok = el('button', 'ghost', 'Record'); ok.type = 'submit';
        var all = el('button', 'ghost', 'All ' + money(left)); all.type = 'button';
        var msg = el('p', 'err'); msg.hidden = true; msg.setAttribute('role', 'alert');
        function apply(v) {
          var cur = loadLoans().filter(function (x) { return x.id === l.id; })[0];
          if (!cur) return;
          var res = KL.addPayment(cur, v, Date.now(), newLoanId());
          if (res.error) { msg.textContent = res.error; msg.hidden = false; return; }
          saveLoans(loadLoans().map(function (x) { return x.id === l.id ? res.loan : x; }));
          renderUdhaar(); toast('Recorded ' + money(v));
        }
        form.addEventListener('submit', function (ev) { ev.preventDefault(); var v = parseAmount(inp.value); if (v == null) { msg.textContent = 'Enter an amount, like 500.'; msg.hidden = false; return; } apply(v); });
        all.addEventListener('click', function () { apply(left); });
        form.appendChild(inp); form.appendChild(ok); form.appendChild(all);
        box.appendChild(form); box.appendChild(msg);
      }
      body.appendChild(box);
    });
    li.appendChild(body);
    return li;
  }


  /* ---------- Wallets: Amazon Pay and other prepaid balances ---------- */
  var walletUi = { setup: false, mode: {}, actual: {} };
  function loadWallets() { return window.KharchaLedger ? window.KharchaLedger.parseWallets(kv.get('kharcha_wallets')) : []; }
  function saveWallets(list) { kv.set('kharcha_wallets', JSON.stringify(list)); }
  function walletField(label, id, input) { var w = el('div', 'field'); var l = el('label', null, label); l.htmlFor = id; w.appendChild(l); w.appendChild(input); return w; }
  function walletInput(id, ph, mode) { var i = el('input', 'input'); i.id = id; i.placeholder = ph || ''; i.autocomplete = 'off'; if (mode) i.inputMode = mode; return i; }
  function walletDate(id) { var d = el('input', 'input'); d.id = id; d.type = 'date'; d.value = dayKey(Date.now()); d.max = dayKey(Date.now()); return d; }

  function renderWallet() {
    var root = $('wallet-root');
    if (!root) return;
    var KL = window.KharchaLedger;
    root.textContent = '';
    if (!KL) { root.appendChild(el('p', 'err', 'Wallets could not load. Refresh the page.')); return; }
    var wallets = loadWallets();

    if (!wallets.length) {
      var intro = el('div', 'empty');
      intro.appendChild(el('p', null, 'Track a prepaid wallet like Amazon Pay. Top-ups from your card are not counted as spending; the purchases you make from the wallet are, and the balance stays up to date.'));
      root.appendChild(intro);
    }
    wallets.forEach(function (w) { root.appendChild(walletCard(w)); });

    if (walletUi.setup || !wallets.length) {
      root.appendChild(walletSetupForm());
    } else {
      var add = el('button', 'ghost', '+ Track another wallet');
      add.type = 'button';
      add.addEventListener('click', function () { walletUi.setup = true; renderWallet(); });
      root.appendChild(add);
    }
  }

  function walletSetupForm() {
    var KL = window.KharchaLedger;
    var f = el('form', 'add udh-form'); f.noValidate = true;
    f.appendChild(el('h3', 'wal-h', 'Start tracking a wallet'));
    var name = walletInput('wal-new-name', 'Amazon Pay'); name.maxLength = 40; name.setAttribute('list', 'wal-names'); name.value = '';
    var dl = document.createElement('datalist'); dl.id = 'wal-names';
    ['Amazon Pay', 'Paytm', 'PhonePe', 'Mobikwik', 'Freecharge'].forEach(function (n) { var o = document.createElement('option'); o.value = n; dl.appendChild(o); });
    var bal = walletInput('wal-new-bal', '0', 'decimal');
    f.appendChild(walletField('Wallet', 'wal-new-name', name)); f.appendChild(dl);
    f.appendChild(walletField('Balance in it right now (₹)', 'wal-new-bal', bal));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var save = el('button', 'primary', 'Start tracking'); save.type = 'submit'; f.appendChild(save);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nm = KL.cleanName(name.value);
      var raw = bal.value.trim();
      var b = raw === '' ? 0 : parseAmount(raw);
      if (!nm) { err.textContent = 'Enter the wallet name, like Amazon Pay.'; err.hidden = false; return; }
      if (b == null) { err.textContent = 'Enter the balance as a number, or leave it empty for zero.'; err.hidden = false; return; }
      var list = loadWallets();
      if (list.some(function (w) { return KL.nameKey(w.name) === KL.nameKey(nm); })) { err.textContent = 'You already track ' + nm + '.'; err.hidden = false; return; }
      list.push({ id: newLoanId(), name: nm, opening: b, since: Date.now() });
      saveWallets(list); walletUi.setup = false;
      renderWallet(); toast('Tracking ' + nm + ' from ' + money(b));
    });
    return f;
  }

  async function walletAdd(desc, amount, dateVal, okMsg) {
    var ts = dateInputToTs(dateVal);
    try {
      await store.add({ amount: amount, desc: desc, spent_at: new Date(ts).toISOString() });
      render(); toast(okMsg);
      return true;
    } catch (err) {
      toast(err && err.message ? err.message : 'Could not save. Check your connection and try again.');
      return false;
    }
  }

  function walletCard(w) {
    var KL = window.KharchaLedger;
    var ws = KL.walletState(state.entries, w);
    var card = el('div', 'wal-card');
    var head = el('div', 'wal-head');
    head.appendChild(el('span', 'wal-name', '👛 ' + w.name));
    var rm = el('button', 'udh-x', '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Stop tracking ' + w.name);
    rm.addEventListener('click', function () {
      showConfirmModal({ title: 'Stop tracking ' + w.name + '?', message: 'Your top-up and purchase entries stay in Kharcha Book; only the balance card is removed.', onConfirm: function () {
        saveWallets(loadWallets().filter(function (x) { return x.id !== w.id; })); renderWallet();
      } });
    });
    if (allAccts.length > 1) {
      var isMain = primaryAcctId(allAccts) === a.id;
      var mainBtn = el('button', 'scope-pill' + (isMain ? ' active' : ''), isMain ? 'Main account ✓' : 'Make main'); mainBtn.type = 'button';
      mainBtn.addEventListener('click', function () { kv.set(PRIMARY_KEY, a.id); renderBank(); render(); toast(a.name + ' is now your main account. New income goes here.'); });
      head.insertBefore(mainBtn, rm);
    }
    head.appendChild(rm); card.appendChild(head);
    card.appendChild(el('div', 'wal-bal' + (ws.balance < 0 ? ' neg' : ''), money(ws.balance)));
    card.appendChild(el('div', 'wal-sub', ws.balance < 0
      ? 'Below zero: a top-up is missing. Add it, or check the real balance.'
      : 'Started with ' + money(ws.opening) + ' · top-ups ' + money(ws.topups) + ' · spent ' + money(ws.spent)));

    var acts = el('div', 'wal-acts');
    [['topup', '+ Top-up'], ['spend', 'Spent from wallet'], ['check', 'Check balance'], ['convert', 'From an entry']].forEach(function (m) {
      var b = el('button', 'scope-pill' + (walletUi.mode[w.id] === m[0] ? ' active' : ''), m[1]);
      b.type = 'button';
      b.addEventListener('click', function () { walletUi.mode[w.id] = walletUi.mode[w.id] === m[0] ? null : m[0]; renderWallet(); });
      acts.appendChild(b);
    });
    card.appendChild(acts);

    var mode = walletUi.mode[w.id];
    if (mode === 'topup' || mode === 'spend') card.appendChild(walletEntryForm(w, mode));
    if (mode === 'check') card.appendChild(walletCheck(w, ws));
    if (mode === 'convert') card.appendChild(walletConvert(w));

    if (ws.items.length) {
      var ul = el('ul', 'wal-items');
      ws.items.slice(0, 12).forEach(function (it) {
        var li = el('li', 'wal-item' + (it.kind === 'topup' ? ' up' : ''));
        li.appendChild(el('span', null, dFmt.format(new Date(it.ts)) + ' · ' + (it.note || (it.kind === 'topup' ? 'Top-up' : 'Purchase'))));
        li.appendChild(el('span', 'wal-amt', (it.kind === 'topup' ? '+ ' : '− ') + money(it.amount)));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    return card;
  }

  function walletEntryForm(w, mode) {
    var KL = window.KharchaLedger;
    var f = el('form', 'wal-form'); f.noValidate = true;
    var pre = 'wal-' + w.id + '-' + mode;
    var amt = walletInput(pre + '-amt', '0', 'decimal');
    var note = walletInput(pre + '-note', mode === 'topup' ? 'From, e.g. ICICI card XX1014' : 'What for, e.g. Blinkit groceries');
    note.maxLength = 30;
    var date = walletDate(pre + '-date');
    var row = el('div', 'add-row');
    row.appendChild(walletField('Amount (₹)', pre + '-amt', amt)); row.appendChild(walletField('Date', pre + '-date', date));
    f.appendChild(row);
    f.appendChild(walletField(mode === 'topup' ? 'From (optional)' : 'What for', pre + '-note', note));
    if (mode === 'topup') f.appendChild(el('p', 'wal-hint', 'Top-ups move money into the wallet. They are not counted as spending.'));
    else f.appendChild(el('p', 'wal-hint', 'Log the full price of the purchase. If part was paid by card, also add that part as a top-up.'));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var save = el('button', 'primary small', 'Save'); save.type = 'submit'; f.appendChild(save);
    f.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var n = parseAmount(amt.value);
      if (n == null) { err.textContent = 'Enter an amount greater than zero, like 442.'; err.hidden = false; return; }
      if (mode === 'spend' && !note.value.trim()) { err.textContent = 'Add what it was for, like Blinkit groceries.'; err.hidden = false; return; }
      save.disabled = true;
      var desc = mode === 'topup' ? KL.walletTopupDesc(w.name, note.value) : KL.walletSpendDesc(w.name, note.value);
      var ok = await walletAdd(desc, n, date.value, (mode === 'topup' ? 'Top-up of ' : 'Wallet spend of ') + money(n) + ' saved');
      if (!ok) save.disabled = false;
    });
    return f;
  }

  function walletCheck(w, ws) {
    var KL = window.KharchaLedger;
    var box = el('div', 'wal-form');
    var f = el('form', 'wal-check'); f.noValidate = true;
    var inp = walletInput('wal-' + w.id + '-actual', 'Balance shown in the app (₹)', 'decimal');
    inp.setAttribute('aria-label', 'Balance shown in the wallet app');
    if (walletUi.actual[w.id] != null) inp.value = String(walletUi.actual[w.id]);
    var go = el('button', 'ghost', 'Compare'); go.type = 'submit';
    f.appendChild(inp); f.appendChild(go); box.appendChild(f);
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); box.appendChild(err);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var raw = inp.value.trim();
      var n = raw === '0' ? 0 : parseAmount(raw);
      if (n == null) { err.textContent = 'Enter the balance as a number, like 1250.'; err.hidden = false; return; }
      walletUi.actual[w.id] = n; renderWallet();
    });
    if (walletUi.actual[w.id] != null) {
      var r = KL.walletReconcile(ws.balance, walletUi.actual[w.id]);
      if (r.kind === 'match') box.appendChild(el('p', 'wal-ok', 'Matches. Your tracked balance is right. ✓'));
      else {
        var msg = r.kind === 'spent'
          ? money(r.amount) + ' is missing from the wallet: spent or charged without an entry.'
          : money(r.amount) + ' more than tracked: cashback, a refund, or a top-up you did not log.';
        box.appendChild(el('p', 'wal-diff', msg));
        var fix = el('button', 'primary small', r.kind === 'spent' ? 'Log ' + money(r.amount) + ' as wallet spend' : 'Add ' + money(r.amount) + ' as top-up (not spending)');
        fix.type = 'button';
        fix.addEventListener('click', async function () {
          fix.disabled = true;
          var ok = await walletAdd(r.kind === 'spent' ? KL.walletSpendDesc(w.name, 'Unaccounted') : KL.walletTopupDesc(w.name, 'Cashback / adjustment'), r.amount, dayKey(Date.now()), 'Balance matched');
          if (ok) { walletUi.actual[w.id] = null; renderWallet(); } else fix.disabled = false;
        });
        box.appendChild(fix);
      }
    }
    return box;
  }

  // The card SMS for "₹442 towards Amazon Pay" arrives as an ordinary expense. This turns it into a top-up.
  function walletConvert(w) {
    var KL = window.KharchaLedger;
    var box = el('div', 'wal-form');
    box.appendChild(el('p', 'wal-hint', 'Tap an entry that was really money added to ' + w.name + ' (like the card charge). It stops counting as spending and becomes a top-up. Entries from before you started tracking do not change the balance, because the balance you typed in already includes them.'));
    var cutoff = Date.now() - 30 * 86400000;
    var list = state.entries.filter(function (e) { return e.ts >= cutoff && !e.synthetic && isExpense(e) && !KL.parseWalletDesc(e.desc); })
      .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 15);
    if (!list.length) { box.appendChild(el('p', 'wal-hint', 'No recent entries to convert.')); return box; }
    var ul = el('ul', 'wal-items');
    list.forEach(function (e) {
      var li = el('li', 'wal-item');
      li.appendChild(el('span', null, dFmt.format(new Date(e.ts)) + ' · ' + e.desc + (e.ts < w.since ? ' (before tracking)' : '')));
      var b = el('button', 'ghost wal-conv', money(e.amount) + ' → top-up'); b.type = 'button';
      b.addEventListener('click', async function () {
        b.disabled = true;
        try {
          await store.update(e.id, { amount: e.amount, desc: KL.walletTopupDesc(w.name, e.desc.replace(/^[^\w₹]+/, '').slice(0, 30)) });
          render(); toast(money(e.amount) + ' is now a top-up, not spending' + (e.ts < w.since ? ' (balance unchanged: it was before tracking)' : ''));
        } catch (err) { b.disabled = false; toast(err && err.message ? err.message : 'Could not change that entry.'); }
      });
      li.appendChild(b); ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }


  /* ---------- Monthly tab ---------- */
  function signedMoney(v) { return (v < 0 ? '−' : '') + money(Math.abs(v)); }
  var shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  function rangeLabel(s) { return shortDay.format(new Date(s.start)) + ' → ' + (s.end ? shortDay.format(new Date(s.end - 1)) : 'today'); }
  var moUi = { idx: 0 };

  function renderMonthly() {
    var root = $('monthly-root');
    if (!root) return;
    root.textContent = '';
    var KL = window.KharchaLedger;
    var cs = cycleSettings();
    var cycles = cs.mode === 'salary' ? getPayCycleSummaries(state.entries, cs.anchor) : [];
    var useCycle = cs.mode === 'salary' && cycles.length > 0;
    if (moUi.idx >= cycles.length || moUi.idx < 0) moUi.idx = 0;
    var cur = useCycle ? cycles[moUi.idx] : getMonthlySummary(state.entries, state.sel);

    // how to measure a "month"
    var modes = el('div', 'mo-modes');
    [['salary', 'Pay cycle'], ['calendar', 'Calendar month']].forEach(function (m) {
      var b = el('button', 'mo-mode' + (cs.mode === m[0] ? ' on' : ''), m[1]); b.type = 'button';
      b.addEventListener('click', function () { cs.mode = m[0]; saveCycleSettings(cs); moUi.idx = 0; renderMonthly(); });
      modes.appendChild(b);
    });
    root.appendChild(modes);
    if (cs.mode === 'salary') {
      var note = el('p', 'mo-note', useCycle
        ? 'Your salary arrives on the last working day, so each period runs from one ' + cs.anchor + ' payday to the next.'
        : 'No "' + cs.anchor + '" entry found yet, so calendar months are shown. Add your salary in Income to start a pay cycle.');
      root.appendChild(note);
      var f = el('form', 'mo-anchor'); f.noValidate = true;
      var inp = el('input', 'input'); inp.value = cs.anchor; inp.maxLength = 30; inp.setAttribute('aria-label', 'Salary that starts a pay cycle');
      var sv = el('button', 'ghost', 'Save'); sv.type = 'submit';
      f.appendChild(el('span', 'mo-anchor-l', 'A cycle starts when this arrives:')); f.appendChild(inp); f.appendChild(sv);
      f.addEventListener('submit', function (ev) { ev.preventDefault(); var v = inp.value.trim(); if (!v) return; cs.anchor = v; saveCycleSettings(cs); moUi.idx = 0; renderMonthly(); toast('Pay cycles start with ' + v); });
      root.appendChild(f);
    }

    // period switcher
    var nav = el('div', 'mo-nav');
    var prev = el('button', 'mo-arrow', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Earlier');
    var next = el('button', 'mo-arrow', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Later');
    if (useCycle) {
      prev.disabled = moUi.idx >= cycles.length - 1; next.disabled = moUi.idx <= 0;
      prev.addEventListener('click', function () { moUi.idx++; renderMonthly(); });
      next.addEventListener('click', function () { moUi.idx--; renderMonthly(); });
    } else {
      prev.addEventListener('click', function () { var b = $('prev'); if (b && !b.disabled) b.click(); });
      next.addEventListener('click', function () { var b = $('next'); if (b && !b.disabled) b.click(); });
    }
    nav.appendChild(prev);
    var lab = el('div', 'mo-month-wrap');
    lab.appendChild(el('span', 'mo-month', useCycle ? rangeLabel(cur) : monthLabel(state.sel)));
    if (useCycle) {
      var np = KL.nextPayday(Date.now());
      lab.appendChild(el('small', 'mo-sub', cur.open
        ? 'Running now · next salary around ' + np.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + (np.days > 0 ? ' (in ' + np.days + (np.days === 1 ? ' day)' : ' days)') : ' (today)')
        : 'Finished'));
    }
    nav.appendChild(lab); nav.appendChild(next);
    root.appendChild(nav);

    if (!cur.salaries && !cur.motherReceived && !cur.personalSpent && !cur.familySpent) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, 'Nothing for this period yet. Add your salaries in Income (💼 Salary 1 and Salary 2) and your mother’s monthly money (👵 Mother’s Pension) and this page works out your savings and the family fund.'));
      var go = el('button', 'primary small', 'Open Income'); go.type = 'button';
      go.addEventListener('click', function () { var b = document.querySelector('.streambtn[data-stream="incomings"]'); if (b) b.click(); });
      em.appendChild(go); root.appendChild(em);
    } else {
      var hero = el('div', 'mo-hero' + (cur.savings < 0 ? ' neg' : ''));
      hero.appendChild(el('span', 'mo-hero-l', useCycle ? (cur.open ? 'Saved so far this cycle' : 'Saved this cycle') : 'Saved this month'));
      hero.appendChild(el('span', 'mo-hero-v', signedMoney(cur.savings)));
      hero.appendChild(el('span', 'mo-hero-s', cur.salaries > 0
        ? cur.savingsRate + '% of salary' + (cur.invested > 0 ? ' · ' + money(cur.invested) + ' invested' : '')
        : 'Add your salary to see the rate'));
      var track = el('div', 'mo-track'), fill = el('i');
      fill.style.width = Math.max(0, Math.min(100, cur.salaries > 0 ? (cur.personalSpent / cur.salaries) * 100 : 0)) + '%';
      track.appendChild(fill); hero.appendChild(track);
      hero.appendChild(el('span', 'mo-hero-n', 'Spent ' + money(cur.personalSpent) + ' of ' + money(cur.salaries)));
      root.appendChild(hero);

      var inc = el('div', 'mo-card');
      inc.appendChild(el('h3', 'mo-h', 'Income'));
      var ul = el('ul', 'mo-list');
      cur.salaryEntries.forEach(function (e) {
        var li = el('li'); li.appendChild(el('span', null, e.desc.replace(/^[^\wऀ-ॿ]+/, '') + ' · ' + dFmt.format(new Date(e.ts))));
        li.appendChild(el('b', null, money(e.amount))); ul.appendChild(li);
      });
      if (!cur.salaryEntries.length) { var li0 = el('li'); li0.appendChild(el('span', 'mo-dim', 'No salary in this period')); ul.appendChild(li0); }
      if (cur.otherIncome > 0) { var li1 = el('li'); li1.appendChild(el('span', null, 'Other income (not in savings)')); li1.appendChild(el('b', null, money(cur.otherIncome))); ul.appendChild(li1); }
      inc.appendChild(ul); root.appendChild(inc);

      var fam = el('div', 'mo-card');
      fam.appendChild(el('h3', 'mo-h', '🏠 Family fund (from Mother)'));
      var over = cur.familyLeft < 0;
      var big = el('div', 'mo-fund' + (over ? ' neg' : ''));
      big.appendChild(el('span', 'mo-fund-v', over ? 'Over by ' + money(cur.overflow) : money(cur.familyLeft) + ' left'));
      fam.appendChild(big);
      var ftrack = el('div', 'mo-track'), ffill = el('i', over ? 'danger' : (cur.motherReceived > 0 && cur.familySpent / cur.motherReceived >= 0.8 ? 'warning' : ''));
      ffill.style.width = Math.max(0, Math.min(100, cur.motherReceived > 0 ? (cur.familySpent / cur.motherReceived) * 100 : (cur.familySpent > 0 ? 100 : 0))) + '%';
      ftrack.appendChild(ffill); fam.appendChild(ftrack);
      var fl = el('ul', 'mo-list');
      [['Received from Mother', cur.motherReceived], ['Family spending', cur.familySpent]].forEach(function (r) {
        var li = el('li'); li.appendChild(el('span', null, r[0])); li.appendChild(el('b', null, money(r[1]))); fl.appendChild(li);
      });
      fam.appendChild(fl);
      if (!cur.motherReceived) fam.appendChild(el('p', 'mo-note', 'Add this period’s money from Mother in Income (👵 Mother’s Pension) and family spending is deducted from it.'));
      else if (over) fam.appendChild(el('p', 'mo-note', 'You covered ' + money(cur.overflow) + ' of family spending beyond Mother’s money. Savings after covering it: ' + signedMoney(cur.savingsAfterOverflow) + '.'));
      root.appendChild(fam);
    }

    var hist = (useCycle ? cycles : getMonthlyHistory(state.entries)).slice(0, 12);
    if (hist.length) {
      root.appendChild(el('h3', 'sec-title mo-title', useCycle ? 'Every pay cycle' : 'Every month'));
      var hl = el('ul', 'mo-hist');
      hist.forEach(function (m, i) {
        var li = el('li'), b = el('button', 'mo-row' + ((useCycle ? i === moUi.idx : m.key === state.sel) ? ' on' : '')); b.type = 'button';
        var left = el('span', 'mo-row-l'); left.appendChild(el('b', null, useCycle ? rangeLabel(m) : monthLabel(m.key)));
        var parts = ['Salary ' + money(m.salaries), 'Personal ' + money(m.personalSpent)];
        if (m.motherReceived || m.familySpent) parts.push(m.familyLeft < 0 ? 'Family over ' + money(m.overflow) : 'Family +' + money(m.familyLeft));
        left.appendChild(el('small', null, parts.join(' · ')));
        b.appendChild(left);
        b.appendChild(el('span', 'mo-row-v' + (m.savings < 0 ? ' neg' : ''), signedMoney(m.savings)));
        b.addEventListener('click', function () {
          if (useCycle) { moUi.idx = i; renderMonthly(); } else { state.sel = m.key; state.editing = null; render(); }
          window.scrollTo({ top: 0 });
        });
        li.appendChild(b); hl.appendChild(li);
      });
      root.appendChild(hl);
    }
  }

  /* ---------- Smart rules: payees and monthly payments ---------- */
  var SCOPE_LABEL = { personal: '👤 Personal', family: '🏠 Family', investment: '📈 Invest' };
  function scopeWord(entryDesc) { return /^\s*[🏠👤📈✈🔨💼👵💰👛]/u.test(entryDesc || ''); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // Recognises payees by name ("Jagroop Shoshri Chand" is the milk vendor) and files them once, keeping the original name.
  async function applyRulesToEntries() {
    var KL = window.KharchaLedger;
    if (!KL || !state.entries.length) return;
    var rules = loadRules(), since = Date.now() - 120 * 86400000, done = {}, n = 0;
    for (var i = 0; i < state.entries.length && n < 40; i++) {
      var e = state.entries[i];
      if (!e || e.synthetic || e.ts < since || !isExpense(e) || scopeWord(e.desc)) continue;
      var r = KL.matchRule(e.desc, rules, { amount: e.amount, ts: e.ts });
      if (!r || String(e.desc).toLowerCase().indexOf(r.name.toLowerCase()) >= 0) continue;
      var nd = shiftScopeDesc(r.name + ' (' + String(e.desc).replace(/\s+/g, ' ').trim() + ')', r.scope);
      try { await store.update(e.id, { amount: e.amount, desc: nd, spent_at: new Date(e.ts).toISOString() }); n++; done[r.name] = (done[r.name] || 0) + 1; } catch (err) { break; }
    }
    if (n) toast('Recognised ' + Object.keys(done).join(', '));
  }

  function renderDue() {
    var box = $('due-box'), KL = window.KharchaLedger;
    if (!box || !KL) return;
    box.textContent = '';
    var due = KL.dueRules(loadRules(), state.entries, Date.now(), loadJsonObj(SKIPS_KEY));
    var accts = loadBank(), sugg = [];
    if (accts.length > 1) sugg = KL.transferCandidates(state.entries, accts, loadOwn(), Date.now(), loadJsonObj('kharcha_xfer_dismissed'), transferPred(accts)).slice(0, 3);
    var dups = (state.dupMaybe || []).filter(function (m) { return state.entries.indexOf(m.drop) >= 0 && state.entries.indexOf(m.keep) >= 0; }).slice(0, 2);
    if ((!due.length && !sugg.length && !dups.length) || (state.activeStream || 'spends') !== 'spends') { box.hidden = true; return; }
    box.hidden = false;
    dups.forEach(function (m) { box.appendChild(dupSuggestion(m)); });
    sugg.forEach(function (c) { box.appendChild(transferSuggestion(c, accts)); });
    due.slice(0, 3).forEach(function (d) {
      var r = d.rule, row = el('div', 'due-card');
      var txt = el('div', 'due-txt');
      txt.appendChild(el('b', null, '📅 ' + r.name));
      txt.appendChild(el('span', null, 'Due on the ' + ordinal(r.day) + (d.amount ? ' · ' + money(d.amount) : '') + (r.acct ? ' · from ' + r.acct : '')));
      row.appendChild(txt);
      var log = el('button', 'primary small', 'Log it'); log.type = 'button';
      function add(amount) {
        store.add({ amount: amount, desc: shiftScopeDesc(r.name, r.scope), spent_at: new Date().toISOString() })
          .then(function () { render(); toast(r.name + ' ' + money(amount) + ' logged'); })
          .catch(function () { toast('Could not log it. Try again.'); });
      }
      log.addEventListener('click', function () {
        if (d.amount) { add(d.amount); return; }
        showInputModal({ title: r.name, message: 'How much was it this month?', fields: [{ label: 'Amount (₹)', placeholder: 'e.g. 25000', inputmode: 'decimal' }], confirmText: 'Log it',
          onConfirm: function (v) { var a = parseAmount(v[0]); if (a != null) add(a); } });
      });
      var skip = el('button', 'ghost', 'Not this month'); skip.type = 'button';
      skip.addEventListener('click', function () {
        var before = loadJsonObj(SKIPS_KEY), next = Object.assign({}, before); next[r.id] = d.monthKey;
        kv.set(SKIPS_KEY, JSON.stringify(next)); renderDue();
        toast(r.name + ' skipped for this month', function () { kv.set(SKIPS_KEY, JSON.stringify(before)); renderDue(); });
      });
      row.appendChild(log); row.appendChild(skip);
      box.appendChild(row);
    });
  }

  function transferPred(accts) {
    var KL = window.KharchaLedger, map = loadJsonObj(ACCTMAP_KEY), rules0 = loadRules(), pid = primaryAcctId(accts), own = loadOwn();
    return {
      isTransfer: isTransferEntry, isExpense: isExpense, isIncome: isIncome, isCard: isCardEntry,
      isRule: function (e) { return !!KL.matchRule(e.desc, rules0); },
      route: function (e) { return KL.routeAccount(e, accts, map, rules0, pid, own); }
    };
  }
  // Payments to yourself (your own name, or your own account / UPI id) are filed as own transfers by themselves. Undo is offered.
  // A bank SMS that prints "Avl Bal" sets that account's balance by itself (no typing).
  function applyBalanceFromSms() {
    var KL = window.KharchaLedger, accts = loadBank();
    if (!KL || !accts.length) return;
    var map = loadJsonObj(ACCTMAP_KEY), rules = loadRules(), pid = primaryAcctId(accts), own = loadOwn(), updates = {}, names = [];
    accts.forEach(function (a) {
      var found = KL.balanceFromSms(state.entries, a, function (e) { return KL.routeAccount(e, accts, map, rules, pid, own); }, isCardEntry);
      if (found) { updates[a.id] = found; names.push(a.name + ' ' + money(found.balance)); }
    });
    if (!names.length) return;
    saveBank(loadBank().map(function (a) {
      var f = updates[a.id];
      return f ? Object.assign({}, a, { snapshots: a.snapshots.concat([{ ts: f.ts, balance: f.balance, src: 'sms' }]) }) : a;
    }));
    render();
    if (state.activeStream === 'bank') renderBank();
    toast('Balance from your bank SMS: ' + names.join(', '));
  }

  /* ---------- Duplicate check: runs whenever entries load or refresh ---------- */
  var dupBusy = false;
  function reAdd(e) {
    return store.add({ amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString(), method: e.method || null, kind: e.kind || null, raw_sms: e.raw || null });
  }
  // The same payment twice (bank SMS + app notification, a copy without the bank reference, a double tap) is removed by itself, with Undo.
  // A likely duplicate with nothing from the phone to prove it is only suggested (see renderDue).
  async function applyDuplicateCheck() {
    var KL = window.KharchaLedger;
    if (!KL || !KL.findDuplicates || dupBusy || state.mode !== 'db') return;
    dupBusy = true;
    try {
      var res = KL.findDuplicates(state.entries, Date.now(), 45), gone = [];
      for (var i = 0; i < res.sure.length; i++) {
        var d = res.sure[i].drop;
        try { await store.remove(d.id); gone.push(d); } catch (err) { break; }
      }
      var dismissed = loadJsonObj('kharcha_dup_dismissed');
      state.dupMaybe = res.maybe.filter(function (m) { return !dismissed[m.drop.id]; });
      if (gone.length) {
        render();
        toast('Removed ' + gone.length + ' duplicate ' + (gone.length === 1 ? 'entry' : 'entries') + ' (' + money(gone[0].amount) + ')', function () {
          Promise.all(gone.map(reAdd)).then(function () { render(); toast('Restored'); }).catch(function () { toast('Could not undo. Try again.'); });
        });
      } else renderDue();
    } catch (err) { console.warn('Kharcha: duplicate check failed', err); }
    finally { dupBusy = false; }
  }
  function tidyUp() { return applyOwnTransfers().then(applyBalanceFromSms, applyBalanceFromSms).then(applyDuplicateCheck, applyDuplicateCheck); }
  function dupSuggestion(m) {
    var row = el('div', 'due-card'), txt = el('div', 'due-txt');
    txt.appendChild(el('b', null, '👯 ' + money(m.drop.amount) + ' may be entered twice'));
    txt.appendChild(el('span', null, (m.keep.desc || 'Entry') + ' · ' + tFmt.format(m.keep.ts) + ' and ' + tFmt.format(m.drop.ts)));
    row.appendChild(txt);
    var rm = el('button', 'primary small', 'Remove one'); rm.type = 'button';
    rm.addEventListener('click', function () {
      rm.disabled = true;
      var gone = m.drop;
      store.remove(gone.id).then(function () {
        state.dupMaybe = (state.dupMaybe || []).filter(function (x) { return x !== m; }); render();
        toast('Duplicate removed', function () { reAdd(gone).then(function () { render(); toast('Restored'); }).catch(function () { toast('Could not undo. Try again.'); }); });
      }).catch(function () { toast('Could not remove it. Try again.'); render(); });
    });
    var keep = el('button', 'ghost', 'Keep both'); keep.type = 'button';
    keep.addEventListener('click', function () {
      var d = loadJsonObj('kharcha_dup_dismissed'); d[m.drop.id] = 1; kv.set('kharcha_dup_dismissed', JSON.stringify(d));
      state.dupMaybe = (state.dupMaybe || []).filter(function (x) { return x !== m; }); renderDue();
    });
    row.appendChild(rm); row.appendChild(keep);
    return row;
  }

  var ownXferBusy = false;
  async function applyOwnTransfers() {
    var KL = window.KharchaLedger, accts = loadBank();
    if (!KL || ownXferBusy || accts.length < 2) return;
    ownXferBusy = true;
    try {
      var pred = transferPred(accts), own = loadOwn(), existing = loadTransfers();
      var refs = {}; existing.forEach(function (t) { if (t.ref) refs[t.ref] = 1; });
      var nm = function (id) { var a = accts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : '?'; };
      var changed = false;
      // 1) A payment that already has a transfer record but lost its 🔁 mark (the phone re-synced the plain name): mark it again,
      //    otherwise it counts as spending AND as a transfer.
      var heal = state.entries.filter(function (e) { return e && refs[e.id] && !isTransferEntry(e); });
      for (var h = 0; h < heal.length; h++) {
        await store.update(heal[h].id, { amount: heal[h].amount, desc: shiftScopeDesc(heal[h].desc, 'transfer'), spent_at: new Date(heal[h].ts).toISOString() });
        changed = true;
      }
      // 2) New payments to yourself.
      var found = KL.autoOwnTransfers(state.entries, accts, own, Date.now(), pred, refs);
      // A debit from one of your accounts and a credit into another a few minutes apart: one transfer, found without any name.
      var taken = {}; found.forEach(function (c) { c.ids.forEach(function (id) { taken[id] = 1; }); });
      KL.autoTransferPairs(state.entries, accts, own, Date.now(), pred).forEach(function (c) {
        if (c.ids.some(function (id) { return taken[id] || refs[id]; })) return;
        found.push(c);
      });
      // 3) Entries marked 🔁 (by hand or by the phone's notification button) that have no record yet.
      var orphans = KL.orphanTransfers(state.entries, existing.concat(found.map(function (c) { return { ref: c.id, from: c.from, to: c.to, amount: c.amount, ts: c.ts }; })), accts, own, Date.now(), pred);
      // 4) Your own-name credit that mirrors a transfer is the other half of it, not income.
      var all = existing.concat(found.map(function (c) { return { amount: c.amount, ts: c.ts }; }), orphans.map(function (c) { return { amount: c.amount, ts: c.ts }; }));
      var mirrors = state.entries.filter(function (e) {
        return e && !e.synthetic && isIncome(e) && !isTransferEntry(e) && KL.isOwnName(e.desc, own) &&
          all.some(function (t) { return Math.abs(t.amount - e.amount) < 0.005 && Math.abs(t.ts - e.ts) <= 36 * 3600000; });
      });
      if (!found.length && !mirrors.length && !orphans.length && !changed) return;
      var beforeT = loadTransfers(), olds = [], added = [];
      for (var i = 0; i < found.length; i++) {
        var c = found[i];
        for (var k = 0; k < c.ids.length; k++) {
          var e = state.entries.filter(function (x) { return x.id === c.ids[k]; })[0];
          if (!e) continue;
          await store.update(e.id, { amount: e.amount, desc: shiftScopeDesc(e.desc, 'transfer'), spent_at: new Date(e.ts).toISOString() });
          olds.push(e);
        }
        added.push({ id: newLoanId(), ts: c.ts, amount: c.amount, from: c.from, to: c.to, ref: c.id, label: 'Transfer ' + nm(c.from) + ' → ' + nm(c.to) });
      }
      orphans.forEach(function (c) { added.push({ id: newLoanId(), ts: c.ts, amount: c.amount, from: c.from, to: c.to, ref: c.id, label: 'Transfer ' + nm(c.from) + ' → ' + nm(c.to) }); });
      for (var j = 0; j < mirrors.length; j++) {
        await store.update(mirrors[j].id, { amount: mirrors[j].amount, desc: shiftScopeDesc(mirrors[j].desc, 'transfer'), spent_at: new Date(mirrors[j].ts).toISOString() });
        olds.push(mirrors[j]);
      }
      if (added.length) saveTransfers(beforeT.concat(added));
      render();
      var first = added[0];
      if (found.length || orphans.length) {
        toast('Own transfer ' + money(first.amount) + ': ' + nm(first.from) + ' → ' + nm(first.to), found.length ? function () {
          saveTransfers(beforeT);
          Promise.all(olds.map(function (e) { return store.update(e.id, { amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString() }); })).then(function () { render(); toast('Restored'); });
        } : undefined);
      }
    } catch (err) { console.warn('Kharcha: own transfer pass failed', err); }
    finally { ownXferBusy = false; }
  }

  var xferSwap = {};
  function transferSuggestion(c, accts) {
    var nameOf = function (id) { var a = accts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : '?'; };
    var from = xferSwap[c.id] ? c.to : c.from, to = xferSwap[c.id] ? c.from : c.to;
    var row = el('div', 'due-card'), txt = el('div', 'due-txt');
    txt.appendChild(el('b', null, '↔ ' + money(c.amount) + ' looks like your own transfer'));
    txt.appendChild(el('span', null, nameOf(from) + ' → ' + nameOf(to) + ' · ' + c.reason));
    row.appendChild(txt);
    var yes = el('button', 'primary small', 'Yes, own transfer'); yes.type = 'button';
    yes.addEventListener('click', async function () {
      yes.disabled = true;
      var olds = c.ids.map(function (id) { return state.entries.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);
      var beforeT = loadTransfers();
      try {
        for (var i = 0; i < olds.length; i++) {
          var e = olds[i];
          await store.update(e.id, { amount: e.amount, desc: shiftScopeDesc(e.desc, 'transfer'), spent_at: new Date(e.ts).toISOString() });
        }
      } catch (err) { toast('Could not convert. Try again.'); render(); return; }
      saveTransfers(beforeT.concat([{ id: newLoanId(), ts: c.ts, amount: c.amount, from: from, to: to, ref: c.ids[0], label: 'Transfer ' + nameOf(from) + ' → ' + nameOf(to) }]));
      render();
      toast('Own transfer recorded', function () {
        saveTransfers(beforeT);
        Promise.all(olds.map(function (e) { return store.update(e.id, { amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString() }); })).then(function () { render(); toast('Restored'); });
      });
    });
    var sw = el('button', 'ghost', '⇄ Swap'); sw.type = 'button';
    sw.addEventListener('click', function () { xferSwap[c.id] = !xferSwap[c.id]; renderDue(); });
    var no = el('button', 'ghost', 'No'); no.type = 'button';
    no.addEventListener('click', function () {
      var before = loadJsonObj('kharcha_xfer_dismissed'), next = Object.assign({}, before); c.ids.forEach(function (id) { next[id] = 1; });
      kv.set('kharcha_xfer_dismissed', JSON.stringify(next)); renderDue();
      toast('Okay, left as it is', function () { kv.set('kharcha_xfer_dismissed', JSON.stringify(before)); renderDue(); });
    });
    var acts = el('div', 'due-acts'); acts.appendChild(yes); acts.appendChild(sw); acts.appendChild(no);
    row.appendChild(acts);
    return row;
  }

  var ownUi = { extra: 0 };
  function ownForm() {
    var KL = window.KharchaLedger, own = loadOwn(), card = el('div', 'wal-card');
    card.appendChild(el('div', 'wal-head')).appendChild(el('span', 'wal-name', '🪪 My accounts and cards'));
    card.appendChild(el('p', 'wal-sub', 'Last 4 digits let the app tell which bank a payment used, and spot money you move between your own accounts. Add your own UPI addresses too.'));
    var f = el('form', 'udh-editform'); f.noValidate = true;
    function fld(l, i) { var w = el('div', 'field'); w.appendChild(el('label', null, l)); w.appendChild(i); return w; }
    var rows = own.banks.map(function (b) { return { key: b.key, last4: b.last4, upi: b.upi.join(', ') }; });
    for (var k = 0; k < ownUi.extra; k++) rows.push({ key: '', last4: '', upi: '' });
    var ins = rows.map(function (b) {
      var key = el('input', 'input'); key.value = b.key; key.placeholder = 'Bank, e.g. icici'; key.maxLength = 20;
      var l4 = el('input', 'input'); l4.value = b.last4; l4.inputMode = 'numeric'; l4.maxLength = 4; l4.placeholder = 'Last 4';
      var upi = el('input', 'input'); upi.value = b.upi; upi.placeholder = 'UPI ids, comma separated';
      var r = el('div', 'add-row'); r.appendChild(fld('Bank', key)); r.appendChild(fld('Account last 4', l4)); f.appendChild(r); f.appendChild(fld('Your UPI ids for this bank', upi));
      return { key: key, l4: l4, upi: upi };
    });
    var namesIn = el('input', 'input'); namesIn.value = (own.names || []).join(', '); namesIn.placeholder = 'e.g. sanjeev yadav (first and last name)';
    f.appendChild(fld('Your own name(s) as UPI shows them. Money sent to these is your own transfer.', namesIn));
    var credit = own.cards.filter(function (c) { return c.kind === 'credit'; })[0], debit = own.cards.filter(function (c) { return c.kind === 'debit'; })[0];
    var cc = el('input', 'input'); cc.value = credit ? credit.last4 : ''; cc.inputMode = 'numeric'; cc.maxLength = 4; cc.placeholder = 'Last 4';
    var dc = el('input', 'input'); dc.value = debit ? debit.last4 : ''; dc.inputMode = 'numeric'; dc.maxLength = 4; dc.placeholder = 'Last 4';
    var dcBank = el('input', 'input'); dcBank.value = debit ? debit.bank : ''; dcBank.placeholder = 'Its bank, e.g. icici'; dcBank.maxLength = 20;
    var ccBank = el('input', 'input'); ccBank.value = credit ? credit.bank : ''; ccBank.placeholder = 'Card bank, e.g. icici'; ccBank.maxLength = 20;
    var r2 = el('div', 'add-row'); r2.appendChild(fld('Credit card last 4', cc)); r2.appendChild(fld('Card bank', ccBank)); f.appendChild(r2);
    var r3 = el('div', 'add-row'); r3.appendChild(fld('Debit card last 4', dc)); r3.appendChild(fld('Debit card is on bank', dcBank)); f.appendChild(r3);
    var more = el('button', 'ghost', '+ Add another bank'); more.type = 'button';
    more.addEventListener('click', function () { ownUi.extra++; renderRules(); });
    f.appendChild(more);
    var err = el('p', 'err'); err.hidden = true; f.appendChild(err);
    var save = el('button', 'primary small', 'Save'); save.type = 'submit'; f.appendChild(save);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var before = kv.get(OWN_KEY);
      var next = {
        names: namesIn.value.split(','),
        banks: ins.filter(function (x) { return x.key.value.trim(); }).map(function (x) { return { key: x.key.value.trim(), last4: x.l4.value, upi: x.upi.value.split(',') }; }),
        cards: [].concat(cc.value.trim() ? [{ kind: 'credit', last4: cc.value, bank: ccBank.value }] : [], dc.value.trim() ? [{ kind: 'debit', last4: dc.value, bank: dcBank.value }] : [])
      };
      var clean = KL.parseOwn(JSON.stringify(next));
      kv.set(OWN_KEY, JSON.stringify(clean)); ownUi.extra = 0; renderRules(); render();
      toast('Saved', function () { if (before == null) kv.remove(OWN_KEY); else kv.set(OWN_KEY, before); renderRules(); render(); });
    });
    card.appendChild(f);
    return card;
  }

  var rulesUi = { editing: null };
  function renderRules() {
    var root = $('rules-root'), KL = window.KharchaLedger;
    if (!root) return;
    root.textContent = '';
    if (!KL) { root.appendChild(el('p', 'err', 'Rules could not load. Refresh the page.')); return; }
    var rules = loadRules(), accts = loadBank();
    root.appendChild(ownForm());
    root.appendChild(el('p', 'wal-sub', 'Tell the app who you pay and when. It files those payments for you, reminds you on the due day, and takes them off the right bank account.'));
    rules.forEach(function (r) {
      var card = el('div', 'wal-card');
      var head = el('div', 'wal-head');
      head.appendChild(el('span', 'wal-name', r.name));
      var tools = el('span', 'udh-tools');
      var ed = el('button', 'udh-edit', 'Edit'); ed.type = 'button';
      ed.addEventListener('click', function () { rulesUi.editing = rulesUi.editing === r.id ? null : r.id; renderRules(); });
      var rm = el('button', 'udh-x', '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Delete ' + r.name);
      rm.addEventListener('click', function () {
        showConfirmModal({ title: 'Delete "' + r.name + '"?', message: 'Past entries stay as they are.', onConfirm: function () {
          var before = loadRules(); saveRules(before.filter(function (x) { return x.id !== r.id; })); renderRules(); render();
          toast('Rule deleted', function () { saveRules(before); renderRules(); render(); });
        } });
      });
      tools.appendChild(ed); tools.appendChild(rm); head.appendChild(tools); card.appendChild(head);
      card.appendChild(el('div', 'wal-sub', 'Looks for: ' + r.words.join(', ')));
      card.appendChild(el('div', 'wal-sub', (r.day ? 'Every month on the ' + ordinal(r.day) : 'No fixed day') + (r.amount ? ' · ' + money(r.amount) : ' · amount asked each time') + ' · ' + SCOPE_LABEL[r.scope] + ' · from ' + (r.acct || 'main account')));
      if (r.acct && !accts.some(function (a) { return a.name.toLowerCase().indexOf(r.acct.toLowerCase()) >= 0; })) card.appendChild(el('p', 'wal-hint', 'You are not tracking a ' + r.acct + ' account yet. Add it in Bank so these payments come off it.'));
      if (rulesUi.editing === r.id) card.appendChild(ruleForm(r, accts));
      root.appendChild(card);
    });
    if (rulesUi.editing === 'new') root.appendChild(ruleForm(null, accts));
    else {
      var add = el('button', 'ghost', '+ Add a rule'); add.type = 'button';
      add.addEventListener('click', function () { rulesUi.editing = 'new'; renderRules(); });
      root.appendChild(add);
    }
    try { document.dispatchEvent(new Event('kharcha:rules')); } catch (e) {}
  }
  function ruleForm(r, accts) {
    var KL = window.KharchaLedger, f = el('form', 'udh-editform'); f.noValidate = true;
    function field(label, input) { var w = el('div', 'field'); w.appendChild(el('label', null, label)); w.appendChild(input); return w; }
    var name = el('input', 'input'); name.maxLength = 40; name.value = r ? r.name : ''; name.placeholder = 'e.g. Milk vendor';
    var words = el('input', 'input'); words.value = r ? r.words.join(', ') : ''; words.placeholder = 'Names as they show in UPI, comma separated';
    var day = el('input', 'input'); day.inputMode = 'numeric'; day.value = r && r.day ? String(r.day) : ''; day.placeholder = 'Day of month (optional)';
    var amt = el('input', 'input'); amt.inputMode = 'decimal'; amt.value = r && r.amount ? String(r.amount) : ''; amt.placeholder = 'Usual amount (optional)';
    var scope = el('select', 'input'); ['personal', 'family', 'investment'].forEach(function (k) { var o = el('option', null, SCOPE_LABEL[k]); o.value = k; scope.appendChild(o); });
    scope.value = r ? r.scope : 'family';
    var bank = el('select', 'input'), names = accts.map(function (a) { return a.name; });
    if (r && r.acct && !names.some(function (n) { return n.toLowerCase().indexOf(r.acct.toLowerCase()) >= 0; })) names.push(r.acct);
    var m0 = el('option', null, 'Main account'); m0.value = ''; bank.appendChild(m0);
    names.forEach(function (n) { var o = el('option', null, '🏦 ' + n); o.value = n; bank.appendChild(o); });
    bank.value = r ? r.acct : '';
    if (r && r.acct && bank.value !== r.acct) { var match = names.filter(function (n) { return n.toLowerCase().indexOf(r.acct.toLowerCase()) >= 0; })[0]; if (match) bank.value = match; }
    f.appendChild(field('What is it called', name)); f.appendChild(field('Recognise these names', words));
    var row = el('div', 'add-row'); row.appendChild(field('Day', day)); row.appendChild(field('Amount (₹)', amt)); f.appendChild(row);
    f.appendChild(field('Counts as', scope)); f.appendChild(field('Paid from', bank));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var btns = el('div', 'edit-btns'), save = el('button', 'primary small', 'Save'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button'; btns.appendChild(save); btns.appendChild(cancel); f.appendChild(btns);
    cancel.addEventListener('click', function () { rulesUi.editing = null; renderRules(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nm = KL.cleanName(name.value), ws = words.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      if (!nm) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
      if (!ws.length) ws = [nm.toLowerCase()];
      var d = day.value.trim() ? Math.round(Number(day.value)) : 0;
      if (day.value.trim() && !(d >= 1 && d <= 31)) { err.textContent = 'Day must be between 1 and 31.'; err.hidden = false; return; }
      var a = amt.value.trim() ? parseAmount(amt.value) : 0;
      if (amt.value.trim() && a == null) { err.textContent = 'Amount should be a number, like 5000.'; err.hidden = false; return; }
      var before = loadRules();
      var next = { id: r ? r.id : newLoanId(), name: nm, words: ws, day: d, amount: a || 0, scope: scope.value, acct: bank.value };
      var list = r ? before.map(function (x) { return x.id === r.id ? next : x; }) : before.concat([next]);
      saveRules(list); rulesUi.editing = null; renderRules(); render();
      toast('Saved ' + nm, function () { saveRules(before); renderRules(); render(); });
    });
    return f;
  }

  /* ---------- Bank tab ---------- */
  var bankUi = { xfer: false, add: false, mode: {}, actual: {} };
  function renderBank() {
    var root = $('bank-root');
    if (!root) return;
    var KL = window.KharchaLedger;
    root.textContent = '';
    if (!KL) { root.appendChild(el('p', 'err', 'Bank could not load. Refresh the page.')); return; }
    var accts = loadBank();
    if (!accts.length) {
      var intro = el('div', 'empty');
      intro.appendChild(el('p', null, 'Track your bank balance. Type what the bank shows today; after that the app adds the income you log and takes off the spending that left the account, so you always see an estimate. Update it now and then to correct any drift.'));
      root.appendChild(intro);
    }
    accts.forEach(function (a) { root.appendChild(bankCard(a)); });
    if (accts.length > 1) root.appendChild(bankTransfers(accts));
    if (bankUi.add || !accts.length) root.appendChild(bankSetupForm());
    else {
      var add = el('button', 'ghost', '+ Track another account'); add.type = 'button';
      add.addEventListener('click', function () { bankUi.add = true; renderBank(); });
      root.appendChild(add);
    }
  }

  // Money moved between your own accounts (ICICI to HDFC): lowers one balance, raises the other, never counted as spending or income.
  function bankTransfers(accts) {
    var KL = window.KharchaLedger, box = el('div', 'wal-card');
    box.appendChild(el('div', 'wal-head')).appendChild(el('span', 'wal-name', '↔ Between your accounts'));
    var nameOf = function (id) { var a = accts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : '?'; };
    if (!bankUi.xfer) {
      var open = el('button', 'primary small', 'Move money between accounts'); open.type = 'button';
      open.addEventListener('click', function () { bankUi.xfer = true; renderBank(); });
      box.appendChild(open);
    } else {
      var f = el('form', 'udh-editform'); f.noValidate = true;
      var pid = primaryAcctId(accts), other = accts.filter(function (a) { return a.id !== pid; })[0];
      var from = el('select', 'input'), to = el('select', 'input');
      accts.forEach(function (a) { [from, to].forEach(function (sel) { var o = el('option', null, '🏦 ' + a.name); o.value = a.id; sel.appendChild(o); }); });
      from.value = pid; to.value = other.id;
      var amt = el('input', 'input'); amt.inputMode = 'decimal'; amt.placeholder = 'Amount, e.g. 10000';
      var date = el('input', 'input'); date.type = 'date'; date.value = dayKey(Date.now()); date.max = dayKey(Date.now());
      function fld(l, i) { var w = el('div', 'field'); w.appendChild(el('label', null, l)); w.appendChild(i); return w; }
      var r1 = el('div', 'add-row'); r1.appendChild(fld('From', from)); r1.appendChild(fld('To', to)); f.appendChild(r1);
      var r2 = el('div', 'add-row'); r2.appendChild(fld('Amount (₹)', amt)); r2.appendChild(fld('Date', date)); f.appendChild(r2);
      var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
      var btns = el('div', 'edit-btns'), ok = el('button', 'primary small', 'Move'); ok.type = 'submit';
      var cx = el('button', 'ghost', 'Cancel'); cx.type = 'button'; btns.appendChild(ok); btns.appendChild(cx); f.appendChild(btns);
      cx.addEventListener('click', function () { bankUi.xfer = false; renderBank(); });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var n = parseAmount(amt.value);
        if (from.value === to.value) { err.textContent = 'Pick two different accounts.'; err.hidden = false; return; }
        if (n == null) { err.textContent = 'Enter an amount greater than zero, like 10000.'; err.hidden = false; return; }
        var before = loadTransfers();
        saveTransfers(before.concat([{ id: newLoanId(), ts: dateInputToTs(date.value), amount: n, from: from.value, to: to.value, label: 'Transfer ' + nameOf(from.value) + ' → ' + nameOf(to.value) }]));
        bankUi.xfer = false; renderBank(); render();
        toast(money(n) + ' moved: ' + nameOf(from.value) + ' → ' + nameOf(to.value), function () { saveTransfers(before); renderBank(); render(); toast('Transfer removed'); });
      });
      box.appendChild(f);
    }
    var recent = loadTransfers().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
    recent.forEach(function (t) {
      var r = el('div', 'wal-item');
      r.appendChild(el('span', null, dFmt.format(new Date(t.ts)) + ' · ' + nameOf(t.from) + ' → ' + nameOf(t.to) + ' · ' + money(t.amount)));
      var x = el('button', 'udh-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove this transfer');
      x.addEventListener('click', function () {
        var before = loadTransfers(); saveTransfers(before.filter(function (y) { return y.id !== t.id; })); renderBank(); render();
        toast('Transfer removed', function () { saveTransfers(before); renderBank(); render(); });
      });
      r.appendChild(x); box.appendChild(r);
    });
    return box;
  }

  function bankSetupForm() {
    var KL = window.KharchaLedger;
    var f = el('form', 'add udh-form'); f.noValidate = true;
    f.appendChild(el('h3', 'wal-h', 'Add a bank account'));
    var name = walletInput('bank-new-name', 'e.g. ICICI Salary account'); name.maxLength = 40;
    var bal = walletInput('bank-new-bal', 'Balance the bank shows now', 'decimal');
    f.appendChild(walletField('Account name', 'bank-new-name', name));
    f.appendChild(walletField('Balance right now (₹)', 'bank-new-bal', bal));
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); f.appendChild(err);
    var save = el('button', 'primary', 'Start tracking'); save.type = 'submit'; f.appendChild(save);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nm = KL.cleanName(name.value), raw = bal.value.trim(), b = raw === '0' ? 0 : parseAmount(raw);
      if (!nm) { err.textContent = 'Give the account a name, like ICICI.'; err.hidden = false; return; }
      if (b == null) { err.textContent = 'Enter the balance as a number, like 123456.'; err.hidden = false; return; }
      var list = loadBank();
      if (list.some(function (x) { return KL.nameKey(x.name) === KL.nameKey(nm); })) { err.textContent = 'You already track ' + nm + '.'; err.hidden = false; return; }
      list.push({ id: newLoanId(), name: nm, held: [], deposits: [], snapshots: [{ ts: Date.now(), balance: b }] });
      saveBank(list); bankUi.add = false; renderBank(); render(); toast('Tracking ' + nm + ' from ' + money(b));
    });
    return f;
  }

  function bankCard(a) {
    var KL = window.KharchaLedger;
    var allAccts = loadBank(), pr = bankPreds(a, allAccts);
    var est = KL.bankEstimate(state.entries, a, pr.isIn, pr.isOut, loadTransfers());
    var card = el('div', 'wal-card');
    var head = el('div', 'wal-head');
    head.appendChild(el('span', 'wal-name', '🏦 ' + a.name));
    var rm = el('button', 'udh-x', '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Stop tracking ' + a.name);
    rm.addEventListener('click', function () {
      showConfirmModal({ title: 'Stop tracking ' + a.name + '?', message: 'Only the balance card is removed. Your entries stay.', onConfirm: function () { saveBank(loadBank().filter(function (x) { return x.id !== a.id; })); renderBank(); render(); } });
    });
    head.appendChild(rm); card.appendChild(head);
    card.appendChild(el('div', 'wal-bal' + (est.balance < 0 ? ' neg' : ''), money(est.balance)));
    card.appendChild(el('div', 'wal-sub', 'Estimate. Started at ' + money(est.startBalance) + ' on ' + dFmt.format(new Date(est.since)) + ', + ' + money(est.income) + ' in, − ' + money(est.spent) + ' out.' + (est.cashHeld ? ' ' + money(est.cashHeld) + ' still cash at home.' : '')));
    var lastSnap = a.snapshots[a.snapshots.length - 1];
    if (lastSnap && lastSnap.src === 'sms') card.appendChild(el('div', 'wal-hint', '✉️ Balance taken from your bank SMS on ' + dFmt.format(new Date(lastSnap.ts)) + '.'));
    var acts = el('div', 'wal-acts');
    [['check', 'Update balance'], ['moves', 'What moved']].forEach(function (m) {
      var b = el('button', 'scope-pill' + (bankUi.mode[a.id] === m[0] ? ' active' : ''), m[1]); b.type = 'button';
      b.addEventListener('click', function () { bankUi.mode[a.id] = bankUi.mode[a.id] === m[0] ? null : m[0]; renderBank(); });
      acts.appendChild(b);
    });
    card.appendChild(acts);
    card.appendChild(bankCash(a));
    var mode = bankUi.mode[a.id];
    if (mode === 'check') card.appendChild(bankCheck(a, est));
    if (mode === 'moves') {
      var ul = el('ul', 'wal-items');
      if (!est.items.length) ul.appendChild(el('li', 'wal-hint', 'Nothing logged since the balance was set.'));
      est.items.slice(0, 15).forEach(function (it) {
        var li = el('li', 'wal-item' + (it.kind === 'in' ? ' up' : ''));
        li.appendChild(el('span', null, dFmt.format(new Date(it.ts)) + ' · ' + String(it.label || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 40)));
        li.appendChild(el('span', 'wal-amt', (it.kind === 'in' ? '+ ' : '− ') + money(it.amount)));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      card.appendChild(el('p', 'wal-hint', 'Not counted: credit-card spends (the card bill is), cash and wallet spends, and what friends or Mother paid. Log a card bill as "Credit card bill" so it comes off the balance.'));
    }
    return card;
  }

  /* Income received as cash and kept at home: held out of the bank estimate until deposited. A deposit is a
     transfer, so it moves money into the bank without creating income (savings stay counted once). */
  function bankCash(a) {
    var snapTs = a.snapshots[a.snapshots.length - 1].ts, held = a.held || [];
    function save(fn) {
      saveBank(loadBank().map(function (x) { return x.id === a.id ? fn(x) : x; }));
      renderBank(); render();
    }
    var box = el('div', 'wal-form');
    var depRefs = (a.deposits || []).map(function (d) { return d.ref; });
    var heldEntries = state.entries.filter(function (e) { return isIncome(e) && !e.synthetic && held.indexOf(e.id) >= 0 && depRefs.indexOf(e.id) < 0; });
    var cands = state.entries.filter(function (e) { return isBankIn(e) && !e.synthetic && e.ts > Date.now() - 60 * 86400000 && held.indexOf(e.id) < 0; })
      .sort(function (x, y) { return y.ts - x.ts; }).slice(0, 6);
    var total = heldEntries.reduce(function (n, e) { return n + paise(e.amount); }, 0) / 100;
    box.appendChild(el('h4', 'wal-h', '💵 Cash at home'));
    box.appendChild(el('p', 'wal-sub', heldEntries.length ? 'Not in the bank yet: ' + money(total) : 'Got paid in cash and keeping it at home? Mark that income below so it is not added to your bank balance.'));
    function row(e, label, cls, fn, extra) {
      var r = el('div', 'wal-item');
      r.appendChild(el('span', null, dFmt.format(new Date(e.ts)) + ' · ' + String(e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 28) + ' · ' + money(e.amount)));
      var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); if (extra) r.appendChild(extra); r.appendChild(b);
      box.appendChild(r);
    }
    var doneEntries = state.entries.filter(function (e) { return isIncome(e) && !e.synthetic && held.indexOf(e.id) >= 0 && depRefs.indexOf(e.id) >= 0; });
    doneEntries.forEach(function (e) {
      row(e, 'Undo deposit', 'ghost', function () {
        save(function (x) { return { id: x.id, name: x.name, snapshots: x.snapshots, held: x.held, deposits: (x.deposits || []).filter(function (d) { return d.ref !== e.id; }) }; });
        toast('Deposit undone. It is cash at home again.');
      });
    });
    heldEntries.forEach(function (e) {
      var back = el('button', 'ghost', 'Not cash'); back.type = 'button';
      back.addEventListener('click', function () {
        save(function (x) { return { id: x.id, name: x.name, snapshots: x.snapshots, deposits: x.deposits, held: (x.held || []).filter(function (i) { return i !== e.id; }) }; });
      });
      row(e, 'Deposited ✓', 'primary small', function () {
        save(function (x) {
          return { id: x.id, name: x.name, snapshots: x.snapshots, held: x.held,
            deposits: (x.deposits || []).concat([{ ts: Date.now(), amount: e.amount, ref: e.id, label: 'Cash deposited: ' + String(e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 24) }]) };
        });
        toast(money(e.amount) + ' added to the bank. Not counted as income again.');
      }, back);
    });
    cands.forEach(function (e) {
      row(e, 'Kept as cash', 'ghost', function () {
        save(function (x) { return { id: x.id, name: x.name, snapshots: x.snapshots, deposits: x.deposits, held: (x.held || []).concat([e.id]) }; });
      });
    });
    if (!heldEntries.length && !cands.length) box.appendChild(el('p', 'wal-hint', 'No income logged in the last 60 days.'));
    else box.appendChild(el('p', 'wal-hint', 'Tap "Kept as cash" on an income you did not put in the bank. When you deposit it, tap "Deposited ✓". Never log the deposit as income again.'));
    return box;
  }

  function bankCheck(a, est) {
    var KL = window.KharchaLedger;
    var box = el('div', 'wal-form');
    var f = el('form', 'wal-check'); f.noValidate = true;
    var inp = walletInput('bank-' + a.id + '-actual', 'Balance the bank shows (₹)', 'decimal');
    inp.setAttribute('aria-label', 'Balance the bank shows');
    if (bankUi.actual[a.id] != null) inp.value = String(bankUi.actual[a.id]);
    var go = el('button', 'ghost', 'Compare'); go.type = 'submit';
    f.appendChild(inp); f.appendChild(go); box.appendChild(f);
    var err = el('p', 'err'); err.hidden = true; err.setAttribute('role', 'alert'); box.appendChild(err);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var raw = inp.value.trim(), n = raw === '0' ? 0 : parseAmount(raw);
      if (n == null) { err.textContent = 'Enter the balance as a number, like 123456.'; err.hidden = false; return; }
      bankUi.actual[a.id] = n; renderBank();
    });
    if (bankUi.actual[a.id] != null) {
      var actual = bankUi.actual[a.id], r = KL.walletReconcile(est.balance, actual);
      box.appendChild(el('p', r.kind === 'match' ? 'wal-ok' : 'wal-diff', r.kind === 'match' ? 'Matches the estimate. ✓'
        : r.kind === 'spent' ? 'The bank shows ' + money(r.amount) + ' less than the estimate: spending or a card bill that was not logged.'
        : 'The bank shows ' + money(r.amount) + ' more than the estimate: income that was not logged, or a refund.'));
      function setBalance(logGap) {
        var list = loadBank().map(function (x) {
          return x.id === a.id ? { id: x.id, name: x.name, held: x.held, deposits: x.deposits, snapshots: x.snapshots.concat([{ ts: Date.now(), balance: actual }]) } : x;
        });
        saveBank(list); bankUi.actual[a.id] = null;
        if (logGap && r.kind === 'spent') {
          store.add({ amount: r.amount, desc: 'Unaccounted bank spending', spent_at: new Date(Date.now() - 2000).toISOString() })
            .then(function () { render(); toast('Balance set; ' + money(r.amount) + ' logged as spending'); })
            .catch(function () { toast('Balance set, but the gap could not be logged'); });
        } else { toast('Balance set to ' + money(actual)); }
        renderBank(); render();
      }
      var set = el('button', 'primary small', 'Set balance to ' + money(actual)); set.type = 'button';
      set.addEventListener('click', function () { setBalance(false); });
      box.appendChild(set);
      if (r.kind === 'spent') {
        var both = el('button', 'ghost', 'Set it and log ' + money(r.amount) + ' as unaccounted spending'); both.type = 'button';
        both.addEventListener('click', function () { setBalance(true); });
        box.appendChild(both);
      }
    }
    return box;
  }

  /* ---------- Stream Switcher Tabs ---------- */
  function renderStreamSwitcher(spendsCount, incomingsCount, projCount, invCount, tripsCount) {
    var spCountEl = $('spends-count');
    var incCountEl = $('incomings-count');
    var projCountEl = $('projects-count');
    var invCountEl = $('investments-count');
    var tripsCountEl = $('trips-count');
    if (spCountEl) spCountEl.textContent = String(spendsCount);
    if (incCountEl) incCountEl.textContent = String(incomingsCount);
    if (projCountEl) projCountEl.textContent = String(projCount || 0);
    if (invCountEl) invCountEl.textContent = String(invCount || 0);
    if (tripsCountEl) tripsCountEl.textContent = String(tripsCount || 0);

    var spendsView = $('spends-view');
    var incomingsSec = $('incomings-sec');
    var settlementSec = $('settlement-sec');
    var projectSec = $('project-sec');
    var investmentsSec = $('investments-sec');
    var tripsSec = $('trips-sec');
    var udhaarSec = $('udhaar-sec');
    var walletSec = $('wallet-sec');
    var monthlySec = $('monthly-sec');
    var bankSec = $('bank-sec');
    var rulesSec = $('rules-sec');
    var insightsSec = $('insights-sec');
    var cardSec = $('card-sec');

    var stream = state.activeStream || 'spends';
    if (spendsView) spendsView.hidden = (stream !== 'spends');
    if (incomingsSec) incomingsSec.hidden = (stream !== 'incomings');
    if (settlementSec) settlementSec.hidden = (stream !== 'settlement');
    if (projectSec) projectSec.hidden = (stream !== 'projects');
    if (investmentsSec) investmentsSec.hidden = (stream !== 'investments');
    if (tripsSec) tripsSec.hidden = (stream !== 'trips');
    if (udhaarSec) udhaarSec.hidden = (stream !== 'udhaar');
    if (walletSec) walletSec.hidden = (stream !== 'wallet');
    if (stream === 'udhaar') renderUdhaar();
    if (monthlySec) monthlySec.hidden = (stream !== 'monthly');
    if (bankSec) bankSec.hidden = (stream !== 'bank');
    if (rulesSec) rulesSec.hidden = (stream !== 'rules');
    if (insightsSec) insightsSec.hidden = (stream !== 'insights');
    if (cardSec) cardSec.hidden = (stream !== 'card');
    if (stream === 'card') { try { document.dispatchEvent(new Event('kharcha:card')); } catch (e) {} }
    if (stream === 'insights') { try { document.dispatchEvent(new Event('kharcha:insights')); } catch (e) {} }
    if (stream === 'rules') renderRules();
    if (stream === 'bank') renderBank();
    if (stream === 'wallet') renderWallet();
    if (stream === 'monthly') renderMonthly();

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
  // Where this month's credits landed (all of them go to your main bank; only own transfers reach the other) and what they were.
  function renderIncomeSplit(daysBox, list) {
    var KL = window.KharchaLedger;
    if (!KL || !list.length) return;
    var box = el('div', 'in-split'); box.id = 'inc-split';
    var accts = loadBank();
    if (accts.length) {
      var map = loadJsonObj(ACCTMAP_KEY), rules = loadRules(), pid = primaryAcctId(accts), own = loadOwn(), by = {};
      list.forEach(function (e) {
        var id = (isBankIn(e) ? KL.routeAccount(e, accts, map, rules, pid, own) : null) || 'x';
        by[id] = (by[id] || 0) + paise(e.amount);
      });
      var row = el('div', 'in-split-row'); row.appendChild(el('b', null, '🏦 Credited to'));
      Object.keys(by).forEach(function (id) {
        var a = accts.filter(function (x) { return x.id === id; })[0];
        row.appendChild(el('span', 'in-chip', (a ? a.name : 'Cash / other') + ' ' + money(by[id] / 100)));
      });
      box.appendChild(row);
    }
    var kinds = [['💼 Salary', /💼|salary/i], ['👵 Family', /👵|withdrawn from mother|pension/i], ['📈 Dividend', /dividend/i], ['💹 Interest', /interest/i], ['🎁 Cashback', /cashback/i]], tot = {}, other = 0;
    list.forEach(function (e) {
      var k = kinds.filter(function (x) { return x[1].test(e.desc || ''); })[0];
      if (k) tot[k[0]] = (tot[k[0]] || 0) + paise(e.amount); else other += paise(e.amount);
    });
    var row2 = el('div', 'in-split-row'); row2.appendChild(el('b', null, '🧾 From'));
    kinds.forEach(function (k) { if (tot[k[0]]) row2.appendChild(el('span', 'in-chip', k[0] + ' ' + money(tot[k[0]] / 100))); });
    if (other) row2.appendChild(el('span', 'in-chip', '💰 Other ' + money(other / 100)));
    box.appendChild(row2);
    daysBox.appendChild(box);
  }

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
    renderIncomeSplit(daysBox, monthIncomings);

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

    var askBtn = $('settle-ask-btn');
    if (askBtn) {
      askBtn.hidden = !(setl.pending > 0);
      if (setl.pending > 0) {
        askBtn.href = whatsappLink(settleMessage('Maa', setl.pending, 'family expenses in ' + monthLabel(state.sel), (kv.get('kharcha_my_upi') || '').trim()));
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
  // "Credited to" choice on the income form: the bank accounts you track, cash at home, or no bank.
  function refreshIncomeAcct() {
    var f = $('income-acct-field'), sel = $('income-acct');
    if (!f || !sel) return;
    var accts = loadBank();
    f.hidden = !accts.length;
    if (!accts.length) return;
    var keep = sel.value, pid = primaryAcctId(accts);
    sel.textContent = '';
    var fresh = acctChoiceSelect(accts, pid);
    Array.prototype.slice.call(fresh.options).forEach(function (o) { sel.appendChild(o); });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === keep; }) ? keep : pid;
  }

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

      // The phone logs bank credits on its own now: don't count the same salary twice.
      var at = spentAt ? Date.parse(spentAt) : Date.now();
      var twin = state.entries.find(function (x) {
        return isIncome(x) && paise(x.amount) === paise(amt) && Math.abs(x.ts - at) <= 3 * 86400000;
      });
      if (twin && !addIncomeForm.dataset.confirmedTwin) {
        showConfirmModal({
          title: 'Already logged?',
          message: money(amt) + ' "' + twin.desc + '" is already in Incomings (' + dFmt.format(new Date(twin.ts)) + '), probably added automatically from your bank SMS. Add it again anyway?',
          confirmText: 'Add anyway',
          onConfirm: function () {
            addIncomeForm.dataset.confirmedTwin = '1';
            if (addIncomeForm.requestSubmit) addIncomeForm.requestSubmit(); else addIncomeForm.dispatchEvent(new Event('submit', { cancelable: true }));
          }
        });
        return;
      }
      delete addIncomeForm.dataset.confirmedTwin;

      addIncomeBtn.disabled = true;
      var acctSel = $('income-acct');
      var acctChoice = acctSel && !$('income-acct-field').hidden ? acctSel.value : '';
      store.add({ amount: amt, desc: desc, spent_at: spentAt, kind: 'income' }).then(function (ne) {
        if (ne && acctChoice) setEntryAcct(ne.id, acctChoice);
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
    try { return kv.get(PROJ_NAME_KEY) || 'House Renovation'; } catch (e) { return 'House Renovation'; }
  }
  function setActiveProjectName(name) {
    try { kv.set(PROJ_NAME_KEY, name || 'House Renovation'); } catch (e) {}
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
      showInputModal({
        title: '🔨 Project name',
        fields: [{ value: cur, placeholder: 'e.g. House Renovation, Shop Setup' }],
        onConfirm: function (v) {
          var next = v[0];
          if (next && next !== cur) {
            setActiveProjectName(next);
            render();
            toast('Project set to ' + next);
          }
        }
      });
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

  /* ---------- Trips & Events View Rendering & State ---------- */
  var ACTIVE_TRIP_KEY = 'kharcha_active_trip_name';
  var SELECTED_VIEW_TRIP_KEY = 'kharcha_selected_view_trip';
  var ALL_TRIPS_KEY = 'kharcha_all_trips_list';

  function getAllTrips() {
    var tripSet = new Set();
    // 1. Scan from existing entries
    (state.entries || []).forEach(function (e) {
      if (e && e.desc) {
        var m = e.desc.match(/^[✈\u{2708}\u{FE0F}\u{1F6EB}\u{1F6EC}]+\s*([^:\[]+):/u);
        if (m && m[1] && m[1].trim()) tripSet.add(m[1].trim());
      }
    });
    // 2. Add from local storage saved trips
    try {
      var saved = JSON.parse(kv.get(ALL_TRIPS_KEY)) || [];
      saved.forEach(function (t) { if (t && t.trim()) tripSet.add(t.trim()); });
    } catch (e) {}
    // 3. Active trip if set
    var active = getActiveTripName();
    if (active) tripSet.add(active);

    return Array.from(tripSet);
  }

  function saveTripToList(name) {
    if (!name || !name.trim()) return;
    var trips = getAllTrips();
    if (!trips.includes(name.trim())) {
      trips.push(name.trim());
      try { kv.set(ALL_TRIPS_KEY, JSON.stringify(trips)); } catch (e) {}
    }
  }

  function getActiveTripName() {
    try { return kv.get(ACTIVE_TRIP_KEY) || ''; } catch (e) { return ''; }
  }
  function setActiveTripName(name) {
    try {
      if (name && name.trim()) {
        kv.set(ACTIVE_TRIP_KEY, name.trim());
        saveTripToList(name.trim());
        setSelectedViewTripName(name.trim());
      } else {
        kv.remove(ACTIVE_TRIP_KEY);
      }
    } catch (e) {}
  }

  function getSelectedViewTripName() {
    try {
      var sel = localStorage.getItem(SELECTED_VIEW_TRIP_KEY);
      if (sel && sel.trim()) return sel.trim();
    } catch (e) {}
    var active = getActiveTripName();
    if (active) return active;
    var all = getAllTrips();
    return all.length ? all[0] : '';
  }
  function setSelectedViewTripName(name) {
    try {
      if (name && name.trim()) localStorage.setItem(SELECTED_VIEW_TRIP_KEY, name.trim());
      else localStorage.removeItem(SELECTED_VIEW_TRIP_KEY);
    } catch (e) {}
  }

  // Friends management per trip
  var TRIP_FRIENDS_PREFIX = 'kharcha_trip_friends_';
  function getTripFriends(tripName) {
    if (!tripName) return ['Me'];
    try {
      var saved = JSON.parse(kv.get(TRIP_FRIENDS_PREFIX + tripName.trim()));
      if (Array.isArray(saved) && saved.length) {
        var set = new Set();
        set.add('Me');
        saved.forEach(function (f) { if (f && f.trim()) set.add(f.trim()); });
        return Array.from(set);
      }
    } catch (e) {}
    return ['Me'];
  }
  function setTripFriends(tripName, friendsList) {
    if (!tripName) return;
    try {
      var clean = Array.from(new Set(friendsList)).filter(function (f) { return f && f.trim(); });
      kv.set(TRIP_FRIENDS_PREFIX + tripName.trim(), JSON.stringify(clean));
    } catch (e) {}
  }
  function addTripFriend(tripName, friendName) {
    if (!tripName || !friendName || !friendName.trim()) return;
    var list = getTripFriends(tripName);
    var norm = friendName.trim();
    if (!list.includes(norm)) {
      list.push(norm);
      setTripFriends(tripName, list);
    }
  }
  function removeTripFriend(tripName, friendName) {
    if (!tripName || !friendName || friendName === 'Me') return;
    var list = getTripFriends(tripName).filter(function (f) { return f !== friendName; });
    setTripFriends(tripName, list);
  }

  var TRIP_BUDGET_KEY_PREFIX = 'kharcha_trip_budget_';
  function getTripBudget(tripName) {
    if (!tripName) return 0;
    try { return Number(kv.get(TRIP_BUDGET_KEY_PREFIX + tripName.trim())) || 0; } catch (e) { return 0; }
  }
  function setTripBudget(tripName, val) {
    if (!tripName) return;
    try {
      if (val > 0) kv.set(TRIP_BUDGET_KEY_PREFIX + tripName.trim(), String(val));
      else kv.remove(TRIP_BUDGET_KEY_PREFIX + tripName.trim());
    } catch (e) {}
  }

  var selectedTripPayer = 'Me';

  function renderTripsView(tripSummary, monthEntries) {
    var activeTrip = getActiveTripName();
    var viewTrip = getSelectedViewTripName();
    var hasActiveTrip = !!(activeTrip && activeTrip.trim());
    var isViewingActive = hasActiveTrip && (viewTrip === activeTrip);

    // Update banner on Spends View
    var banner = $('active-trip-banner');
    var atbName = $('atb-trip-name');
    var atbSpent = $('atb-trip-spent');
    if (banner) {
      banner.hidden = !hasActiveTrip;
      if (atbName) atbName.textContent = activeTrip;
      if (atbSpent) {
        var activeSummary = getTripSummary(monthEntries, activeTrip, getTripFriends(activeTrip));
        atbSpent.textContent = money(activeSummary.totalSpent);
      }
    }

    // Populate Trip Selector Dropdown
    var tripSelect = $('trip-select');
    var allTrips = getAllTrips();
    if (tripSelect) {
      tripSelect.innerHTML = '';
      if (!allTrips.length) {
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No Trips Created (Tap + New Trip)';
        tripSelect.appendChild(opt);
      } else {
        allTrips.forEach(function (t) {
          var opt = document.createElement('option');
          opt.value = t;
          var tag = (t === activeTrip) ? ' (Active ✈️)' : '';
          opt.textContent = '✈️ ' + t + tag;
          if (t === viewTrip) opt.selected = true;
          tripSelect.appendChild(opt);
        });
      }
    }

    // Update Trips Section Status Badge and Action Buttons
    var statusBadge = $('trip-badge-status');
    var toggleBtn = $('trip-toggle-btn');
    var totSpentEl = $('trip-total-spent');
    var countEl = $('trip-items-count');
    var avgEl = $('trip-daily-avg');

    if (statusBadge) {
      if (viewTrip && viewTrip === activeTrip) {
        statusBadge.textContent = '✈️ Active Trip';
        statusBadge.className = 'trip-badge';
      } else if (viewTrip) {
        statusBadge.textContent = '🏖️ Past / Archived Trip';
        statusBadge.className = 'trip-badge closed';
      } else {
        statusBadge.textContent = '🏖️ No Trips';
        statusBadge.className = 'trip-badge closed';
      }
    }
    if (toggleBtn) {
      if (viewTrip && viewTrip === activeTrip) {
        toggleBtn.textContent = 'Close Trip';
        toggleBtn.style.display = '';
      } else if (viewTrip) {
        toggleBtn.textContent = 'Set as Active';
        toggleBtn.style.display = '';
      } else {
        toggleBtn.style.display = 'none';
      }
    }

    if (totSpentEl) totSpentEl.textContent = money(tripSummary.totalSpent);
    if (countEl) countEl.textContent = String(tripSummary.itemsCount);
    if (avgEl) avgEl.textContent = money(tripSummary.dailyAvg) + '/day';

    // Trip Budget & Burn Pace Meter
    var tripBudget = viewTrip ? getTripBudget(viewTrip) : 0;
    var budgetStatus = $('trip-budget-status');
    var budgetFill = $('trip-budget-fill');
    var budgetBtn = $('trip-budget-edit-btn');
    var burnPace = $('trip-burn-pace');

    if (budgetStatus && budgetFill) {
      if (tripBudget > 0) {
        var pct = Math.round((tripSummary.totalSpent / tripBudget) * 100);
        budgetStatus.textContent = 'Trip Budget: ' + money(tripSummary.totalSpent) + ' of ' + money(tripBudget) + ' (' + pct + '%)';
        budgetFill.style.width = Math.min(100, pct) + '%';
        budgetFill.className = 'budget-progress-fill' + (pct >= 100 ? ' danger' : (pct >= 80 ? ' warning' : ''));
        if (budgetBtn) budgetBtn.textContent = 'Edit Budget';

        // Calculate Remaining / Burn Pace
        var rem = tripBudget - tripSummary.totalSpent;
        if (burnPace) {
          if (rem > 0) {
            burnPace.textContent = money(rem) + ' left (' + money(tripSummary.dailyAvg) + '/day pace)';
            burnPace.style.color = '#10B981';
          } else {
            burnPace.textContent = 'Exceeded by ' + money(Math.abs(rem));
            burnPace.style.color = 'var(--danger)';
          }
        }
      } else {
        budgetStatus.textContent = 'Trip Budget: Not set';
        budgetFill.style.width = '0%';
        budgetFill.className = 'budget-progress-fill';
        if (budgetBtn) budgetBtn.textContent = 'Set Trip Budget';
        if (burnPace) {
          burnPace.textContent = tripSummary.dailyAvg > 0 ? (money(tripSummary.dailyAvg) + '/day spent') : 'No spend yet';
          burnPace.style.color = '';
        }
      }
    }

    // Render Friends Chips Section
    var friendsSec = $('trip-friends-sec');
    var friendsChips = $('trip-friends-chips');
    var tripFriends = viewTrip ? getTripFriends(viewTrip) : ['Me'];

    if (friendsChips) {
      friendsChips.innerHTML = '';
      tripFriends.forEach(function (friend) {
        var chip = el('span', 'friend-chip' + (friend === 'Me' ? ' is-me' : ''));
        chip.textContent = (friend === 'Me' ? '👤 Me' : '🧑 ' + friend);
        if (friend !== 'Me') {
          var del = el('button', 'friend-chip-del', '×');
          del.type = 'button';
          del.title = 'Remove ' + friend;
          del.addEventListener('click', function (ev) {
            ev.stopPropagation();
            removeTripFriend(viewTrip, friend);
            render();
            toast('Removed ' + friend);
          });
          chip.appendChild(del);
        }
        friendsChips.appendChild(chip);
      });
    }

    // Render Multi-Friend Split & Balance Breakdown
    var splitCountEl = $('trip-split-count');
    var perHeadEl = $('trip-per-head-amt');
    var balancesList = $('trip-balances-list');

    var numPpl = tripSummary.participants ? tripSummary.participants.length : 1;
    if (splitCountEl) splitCountEl.textContent = numPpl + (numPpl === 1 ? ' Person' : ' Friends Split');
    if (perHeadEl) perHeadEl.textContent = money(tripSummary.perPersonShare) + ' / person';

    if (balancesList) {
      balancesList.innerHTML = '';
      if (!tripSummary.balances || !tripSummary.balances.length) {
        var row = el('div', 'friend-bal-row');
        row.textContent = 'Add expenses to see who paid and who owes.';
        balancesList.appendChild(row);
      } else {
        // What each friend owes *me*: my "gets back" amount shared out across those who owe.
        var askFrom = {};
        var meBal = tripSummary.balances.filter(function (b) { return b.name === 'Me'; })[0];
        var stillOwedToMe = meBal && meBal.net > 0 ? meBal.net : 0;
        tripSummary.balances.forEach(function (b) {
          if (b.name === 'Me' || b.net >= 0 || stillOwedToMe < 1) return;
          var amt = Math.min(Math.abs(b.net), stillOwedToMe);
          askFrom[b.name] = Math.round(amt);
          stillOwedToMe -= amt;
        });
        var myUpi = (kv.get('kharcha_my_upi') || '').trim();
        tripSummary.balances.forEach(function (b) {
          var row = el('div', 'friend-bal-row');
          var personCol = el('div', 'fbr-person');
          var nameSpan = el('span', 'fbr-name', (b.name === 'Me' ? '👤 Me (You)' : '🧑 ' + b.name));
          var paidSpan = el('span', 'fbr-paid', 'Paid ' + money(b.paid) + ' (Share: ' + money(b.share) + ')');
          personCol.appendChild(nameSpan);
          personCol.appendChild(paidSpan);

          var netCol = el('div', 'fbr-net');
          if (Math.abs(b.net) < 1) {
            netCol.className = 'fbr-net settled';
            netCol.textContent = 'Settled 🎉';
          } else if (b.net > 0) {
            netCol.className = 'fbr-net gets-back';
            netCol.textContent = 'Gets back ' + money(b.net);
          } else {
            netCol.className = 'fbr-net owes';
            netCol.textContent = 'Owes ' + money(Math.abs(b.net));
          }

          row.appendChild(personCol);
          row.appendChild(netCol);
          if (askFrom[b.name] > 0) {
            var ask = el('a', 'fbr-ask', '📲 Ask ' + money(askFrom[b.name]));
            ask.href = whatsappLink(settleMessage(b.name, askFrom[b.name], (viewTrip || 'the') + ' trip', myUpi));
            ask.target = '_blank';
            ask.rel = 'noopener';
            if (!myUpi) ask.title = 'Add your UPI ID in Insights → Your details to include a pay link';
            row.appendChild(ask);
          }
          balancesList.appendChild(row);
        });
      }
    }

    renderTripSettle(tripSummary, viewTrip);

    // Render Who Paid dynamic radio pills in Add Form
    var payerChips = $('trip-payer-chips');
    if (payerChips) {
      payerChips.innerHTML = '';
      if (!tripFriends.includes(selectedTripPayer)) selectedTripPayer = 'Me';

      tripFriends.forEach(function (friend) {
        var label = el('label', 'scope-pill' + (selectedTripPayer === friend ? ' active' : ''));
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'trip-payer';
        radio.value = friend;
        if (selectedTripPayer === friend) radio.checked = true;
        label.appendChild(radio);
        label.appendChild(el('span', null, ' ' + (friend === 'Me' ? '👤 Me' : '🧑 ' + friend)));

        label.addEventListener('click', function () {
          selectedTripPayer = friend;
          payerChips.querySelectorAll('.scope-pill').forEach(function (p) {
            var inp = p.querySelector('input');
            p.classList.toggle('active', inp && inp.value === selectedTripPayer);
          });
        });
        payerChips.appendChild(label);
      });
    }

    // Timeline entries
    var daysBox = $('trip-days');
    if (!daysBox) return;
    daysBox.textContent = '';

    if (!tripSummary.entries.length) {
      var em = el('div', 'empty');
      em.appendChild(el('p', null, viewTrip
        ? ('No expenses logged yet for ' + viewTrip + ' in ' + monthLabel(state.sel) + '. Add hotel, food, or travel above!')
        : ('No trips created yet. Tap "+ New Trip" to start tracking!')));
      daysBox.appendChild(em);
      return;
    }

    var days = groupByDay(tripSummary.entries);
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

  // Trip Toggle & Switcher Event Listeners
  var tripSelectEl = $('trip-select');
  if (tripSelectEl) {
    tripSelectEl.addEventListener('change', function () {
      var val = tripSelectEl.value;
      if (val) {
        setSelectedViewTripName(val);
        render();
      }
    });
  }

  var tripNewBtn = $('trip-new-btn');
  if (tripNewBtn) {
    tripNewBtn.addEventListener('click', function () {
      showInputModal({
        title: '✈️ New trip',
        fields: [{ placeholder: 'e.g. Goa 2026, Manali Trip' }],
        confirmText: 'Start trip',
        onConfirm: function (v) {
          var clean = v[0];
          if (!clean) return;
          saveTripToList(clean);
          setActiveTripName(clean);
          setSelectedViewTripName(clean);
          render();
          toast('Started & switched to ' + clean + '!');
          offerTripBackfill(clean);
        }
      });
    });
  }

  var tripRenameBtn = $('trip-rename-btn');
  if (tripRenameBtn) {
    tripRenameBtn.addEventListener('click', function () {
      var cur = getSelectedViewTripName();
      if (!cur) return;
      showInputModal({
        title: 'Rename trip',
        fields: [{ value: cur }],
        confirmText: 'Rename',
        onConfirm: function (v) {
          var newName = v[0];
          if (!newName || newName === cur) return;
          saveTripToList(newName);
          if (getActiveTripName() === cur) setActiveTripName(newName);
          setSelectedViewTripName(newName);
          // Carry over the friends list and budget
          setTripFriends(newName, getTripFriends(cur));
          var b = getTripBudget(cur);
          if (b > 0) setTripBudget(newName, b);
          render();
          toast('Renamed trip to ' + newName);
        }
      });
    });
  }

  var tripAddFriendBtn = $('trip-add-friend-btn');
  if (tripAddFriendBtn) {
    tripAddFriendBtn.addEventListener('click', function () {
      var viewTrip = getSelectedViewTripName();
      if (!viewTrip) {
        toast('Select or create a trip first!');
        return;
      }
      showInputModal({
        title: '👥 Add friend to ' + viewTrip,
        fields: [{ placeholder: 'e.g. Rohit' }],
        confirmText: 'Add',
        onConfirm: function (v) {
          if (!v[0]) return;
          addTripFriend(viewTrip, v[0]);
          render();
          toast('Added ' + v[0] + ' to ' + viewTrip);
        }
      });
    });
  }

  /* Trip just started: offer to move spends from the last 12 hours into it -- the fuel filled in
     your own city before leaving, the cab to the airport -- which trip mode could not have caught. */
  function offerTripBackfill(tripName) {
    var picks = recentSpendsForTrip(state.entries, Date.now(), 12);
    if (!picks.length) return;
    var back = el('div', 'modal-backdrop');
    var card = el('div', 'modal-card');
    var head = el('div', 'modal-head');
    head.appendChild(el('h3', null, '✈️ Add earlier spends to ' + tripName + '?'));
    card.appendChild(head);
    card.appendChild(el('p', 'modal-intro', 'These were logged in the last 12 hours, before the trip started. Tick the ones that belong to it.'));
    var boxes = [];
    picks.forEach(function (e) {
      var row = el('label', 'backfill-row');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      boxes.push({ cb: cb, e: e });
      row.appendChild(cb);
      var txt = el('span', 'backfill-txt', cleanScopePrefix(e.desc));
      txt.appendChild(el('small', null, ' ' + dFmt.format(new Date(e.ts)) + ', ' + tFmt.format(new Date(e.ts))));
      row.appendChild(txt);
      row.appendChild(el('strong', null, money(e.amount)));
      card.appendChild(row);
    });
    var foot = el('div', 'modal-foot');
    var skip = el('button', 'ghost', 'Not now'); skip.type = 'button';
    var go = el('button', 'primary', 'Move to ' + tripName); go.type = 'button';
    foot.appendChild(skip); foot.appendChild(go);
    card.appendChild(foot);
    back.appendChild(card);
    document.body.appendChild(back);
    function close() { back.remove(); }
    skip.addEventListener('click', close);
    back.addEventListener('click', function (ev) { if (ev.target === back) close(); });
    go.addEventListener('click', function () {
      var chosen = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.e; });
      if (!chosen.length) { close(); return; }
      go.disabled = true;
      go.textContent = 'Moving…';
      Promise.all(chosen.map(function (e) {
        return store.update(e.id, { amount: e.amount, desc: shiftScopeDesc(e.desc, 'trip', tripName), spent_at: new Date(e.ts).toISOString() });
      })).then(function () {
        toast('Moved ' + chosen.length + (chosen.length === 1 ? ' spend' : ' spends') + ' to ' + tripName);
      }).catch(function (err) {
        toast('Could not move: ' + ((err && err.message) || 'check your connection'));
      }).then(function () { close(); refreshData(); });
    });
  }

  // Name + UPI IDs: lets the phone treat payments to yourself as transfers, and puts your UPI ID
  // on "Ask" settle-up messages. Shared with the phone through the settings row.
  var yourDetailsBtn = $('your-details-btn');
  if (yourDetailsBtn) {
    yourDetailsBtn.addEventListener('click', function () {
      showInputModal({
        title: '⚙️ Your details',
        message: 'Payments to your own name or UPI IDs count as transfers between your accounts, not spending. Your UPI ID goes on settle-up requests.',
        fields: [
          { label: 'Your full name and UPI IDs (comma separated)', value: kv.get('kharcha_owner_identity') || '', placeholder: 'e.g. Sanjeev Yadav, sanjeev@okhdfcbank' },
          { label: 'UPI ID for receiving money', value: kv.get('kharcha_my_upi') || '', placeholder: 'e.g. sanjeev@okhdfcbank', inputmode: 'email' },
          { label: 'Family who reimburse you: names or UPI IDs (money from them settles family expenses)', value: kv.get('kharcha_family_payers') || '', placeholder: 'e.g. Mamta Kasyap, mamta@oksbi' }
        ],
        onConfirm: function (v) {
          kv.set('kharcha_owner_identity', v[0]);
          kv.set('kharcha_my_upi', v[1]);
          if (v.length > 2) kv.set('kharcha_family_payers', v[2]);
          render();
          toast('Saved your details');
        }
      });
    });
  }

  function promptTripToggle() {
    var viewTrip = getSelectedViewTripName();
    var curActive = getActiveTripName();

    if (viewTrip && viewTrip === curActive) {
      showConfirmModal({
        title: '✈️ Close Active Trip?',
        message: 'Close "' + viewTrip + '"? Payment notifications will stop offering it first. You can still view ' + viewTrip + ' anytime from the trip switcher.',
        confirmText: 'Close Trip',
        onConfirm: function () {
          setActiveTripName('');
          render();
          toast('Closed ' + viewTrip);
        }
      });
    } else if (viewTrip) {
      setActiveTripName(viewTrip);
      render();
      toast('Trip Mode active: ' + viewTrip);
      offerTripBackfill(viewTrip);
    } else {
      showInputModal({
        title: '✈️ Start a trip',
        fields: [{ placeholder: 'e.g. Goa 2026, Manali Trip' }],
        confirmText: 'Start trip',
        onConfirm: function (v) {
          var name = v[0];
          if (!name) return;
          saveTripToList(name);
          setActiveTripName(name);
          setSelectedViewTripName(name);
          render();
          toast('Trip Mode active: ' + name);
          offerTripBackfill(name);
        }
      });
    }
  }

  var tripToggleBtn = $('trip-toggle-btn');
  if (tripToggleBtn) {
    tripToggleBtn.addEventListener('click', promptTripToggle);
  }

  var tripBudgetEditBtn = $('trip-budget-edit-btn');
  if (tripBudgetEditBtn) {
    tripBudgetEditBtn.addEventListener('click', function () {
      var curTrip = getSelectedViewTripName();
      if (!curTrip) {
        toast('Select or start a trip first to set its budget!');
        return;
      }
      var cur = getTripBudget(curTrip);
      openBudgetModal({
        title: '✈️ ' + curTrip + ' Budget',
        intro: 'Set your total spending budget for ' + curTrip + '. We will track your daily burn rate against this limit.',
        currentValue: cur || 0,
        presets: [10000, 25000, 50000, 100000],
        onSave: function (n) {
          setTripBudget(curTrip, n);
          render();
          toast('Trip budget set to ' + money(n));
        },
        onClear: function () {
          setTripBudget(curTrip, 0);
          render();
          toast('Trip budget cleared');
        }
      });
    });
  }

  var atbCloseBtn = $('atb-close-btn');
  if (atbCloseBtn) {
    atbCloseBtn.addEventListener('click', function () {
      var cur = getActiveTripName();
      showConfirmModal({
        title: '✈️ Close Active Trip?',
        message: 'Close "' + (cur || 'active trip') + '"? New expenses will resume logging to Personal/Family normally.',
        confirmText: 'Close Trip',
        onConfirm: function () {
          setActiveTripName('');
          render();
          toast('Closed ' + (cur || 'trip'));
        }
      });
    });
  }

  // Add Trip Expense Form
  var addTripForm = $('add-trip-expense');
  var tripExpAmtInput = $('trip-exp-amt');
  var addTripExpBtn = $('add-trip-exp-btn');
  var tripExpErr = $('trip-exp-err');

  if (tripExpAmtInput && addTripExpBtn) {
    tripExpAmtInput.addEventListener('input', function () {
      var a = parseAmount(tripExpAmtInput.value);
      addTripExpBtn.disabled = (a == null);
    });
  }

  if (addTripForm) {
    addTripForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (tripExpErr) tripExpErr.hidden = true;
      var amt = parseAmount(tripExpAmtInput.value);
      if (amt == null) {
        if (tripExpErr) { tripExpErr.textContent = 'Enter an amount greater than zero, like 1200 or 450.'; tripExpErr.hidden = false; }
        tripExpAmtInput.focus();
        return;
      }

      var tripName = getSelectedViewTripName() || getActiveTripName() || 'Trip';
      var rawDesc = $('trip-exp-desc') ? $('trip-exp-desc').value.trim() : '';
      var clean = cleanScopePrefix(rawDesc) || 'Expense';
      var payer = selectedTripPayer || 'Me';
      var payerTag = (payer && payer !== 'Me') ? (' [Paid by ' + payer + ']') : '';
      var desc = '✈️ ' + tripName + ': ' + clean + payerTag;

      var spentVal = $('trip-exp-date') ? $('trip-exp-date').value : '';
      var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

      addTripExpBtn.disabled = true;
      store.add({ amount: amt, desc: desc, spent_at: spentAt }).then(function () {
        tripExpAmtInput.value = '';
        if ($('trip-exp-desc')) $('trip-exp-desc').value = '';
        if ($('trip-exp-date')) $('trip-exp-date').value = '';
        var ts = spentAt ? Date.parse(spentAt) : Date.now();
        state.sel = monthKey(ts);
        saveTripToList(tripName);
        render();
        var payerLabel = (payer && payer !== 'Me') ? (' (Paid by ' + payer + ')') : '';
        toast('Logged ' + money(amt) + ' to ' + tripName + payerLabel);
        tripExpAmtInput.focus();
      }).catch(function (err) {
        var msg = (err && (err.message || 'Check your connection.')) || 'Failed to save.';
        if (tripExpErr) { tripExpErr.textContent = 'Could not save trip expense: ' + msg; tripExpErr.hidden = false; }
      }).finally(function () {
        addTripExpBtn.disabled = false;
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
  function categoryBudgets() { try { return JSON.parse(kv.get(CAT_BUDGET_KEY)) || {}; } catch (e) { return {}; } }
  function setCategoryBudget(name, val) {
    var b = categoryBudgets();
    if (val > 0) b[name] = val; else delete b[name];
    try { kv.set(CAT_BUDGET_KEY, JSON.stringify(b)); } catch (e) {}
  }

  // Spending by category as a donut plus a colour-keyed list. Tap a category to highlight it and
  // set its budget; each row shows last month's change.
  var CAT_COLORS = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#F97316'];
  var CAT_OTHER = '#94A3B8';
  var catSel = null;
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
    var top = res.categories.slice(0, 6);
    var restP = res.categories.slice(6).reduce(function (s, c) { return s + paise(c.total); }, 0);
    var segs = top.map(function (c, i) { return { name: c.name, total: c.total, color: CAT_COLORS[i % CAT_COLORS.length], cat: c }; });
    if (restP > 0) segs.push({ name: 'Other', total: restP / 100, color: CAT_OTHER, cat: null });
    var grandP = segs.reduce(function (s, x) { return s + paise(x.total); }, 0) || 1;
    if (catSel && !segs.some(function (x) { return x.name === catSel; })) catSel = null;
    var svgNS = 'http://www.w3.org/2000/svg';

    function draw(animate) {
      container.textContent = '';
      var wrap = el('div', 'dn');
      var chart = el('div', 'dn-chart');
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 132 132'); svg.setAttribute('class', 'dn-svg');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Spending by category');
      var R = 50, C = 2 * Math.PI * R;
      var track = document.createElementNS(svgNS, 'circle');
      track.setAttribute('cx', 66); track.setAttribute('cy', 66); track.setAttribute('r', R); track.setAttribute('class', 'dn-track');
      svg.appendChild(track);
      var g = document.createElementNS(svgNS, 'g'); g.setAttribute('transform', 'rotate(-90 66 66)');
      var acc = 0, gap = segs.length > 1 ? 2.2 : 0, pending = [];
      segs.forEach(function (sg) {
        var frac = paise(sg.total) / grandP, len = Math.max(0.5, frac * C - gap);
        var c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', 66); c.setAttribute('cy', 66); c.setAttribute('r', R);
        c.setAttribute('class', 'dn-seg' + (catSel && catSel !== sg.name ? ' dim' : ''));
        c.setAttribute('stroke', sg.color);
        c.setAttribute('stroke-dashoffset', String(-acc));
        c.setAttribute('stroke-dasharray', animate ? '0 ' + C : len + ' ' + (C - len));
        if (animate) pending.push([c, len, C]);
        c.addEventListener('click', function () { catSel = catSel === sg.name ? null : sg.name; draw(false); });
        g.appendChild(c); acc += frac * C;
      });
      svg.appendChild(g); chart.appendChild(svg);
      var sel = segs.filter(function (x) { return x.name === catSel; })[0];
      var center = el('div', 'dn-center');
      center.appendChild(el('b', null, money(sel ? sel.total : grandP / 100)));
      center.appendChild(el('span', null, sel ? sel.name + ' · ' + Math.round(paise(sel.total) / grandP * 100) + '%' : 'spent this month'));
      chart.appendChild(center); wrap.appendChild(chart);
      if (pending.length) raf2(function () { pending.forEach(function (p) { p[0].setAttribute('stroke-dasharray', p[1] + ' ' + (p[2] - p[1])); }); });

      var ul = el('div', 'dn-list');
      segs.forEach(function (sg) {
        var c = sg.cat, on = catSel === sg.name;
        var row = el('div', 'dn-row' + (on ? ' on' : ''));
        row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-pressed', on ? 'true' : 'false');
        var dot = el('span', 'dn-dot'); dot.style.background = sg.color; row.appendChild(dot);
        row.appendChild(el('span', 'dn-name', c ? c.name + ' (' + c.count + ')' : 'Other categories'));
        row.appendChild(el('span', 'dn-amt', money(sg.total)));
        var pct = Math.round(paise(sg.total) / grandP * 100);
        var budget = c ? budgets[c.name] : 0;
        var used = budget ? Math.round((sg.total / budget) * 100) : pct;
        var bar = el('div', 'dn-bar'), fill = el('i', budget && used >= 100 ? 'danger' : budget && used >= 80 ? 'warning' : '');
        fill.style.width = Math.min(100, Math.max(2, used)) + '%';
        if (!fill.className) fill.style.background = sg.color;
        bar.appendChild(fill); row.appendChild(bar);
        var notes = [pct + '% of spending'];
        if (budget) notes.unshift(used + '% of ' + money(budget) + ' budget');
        if (c) {
          var prev = cmp.prevCats[c.name];
          if (prev) { var diff = c.total - prev; notes.push((diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '') + money(Math.abs(diff)) + ' vs ' + prevName); }
          else if (cmp.prev > 0) notes.push('New vs ' + prevName);
        }
        row.appendChild(el('div', 'dn-sub', notes.join(' · ')));
        if (on && c) {
          var bb = el('button', 'dn-budget-btn', budget ? '🎯 Change budget' : '🎯 Set a budget'); bb.type = 'button';
          bb.addEventListener('click', function (ev) {
            ev.stopPropagation();
            openBudgetModal({
              title: c.name + ' Budget',
              intro: 'Set a monthly spending limit for ' + c.name + '. You will get warned when spending approaches this limit.',
              spentText: money(c.total) + ' (' + c.pct + '% of month total)',
              currentValue: budget || 0,
              presets: [500, 1000, 2500, 5000],
              onSave: function (n) { setCategoryBudget(c.name, n); render(); toast('Budget for ' + c.name + ' set to ' + money(n)); },
              onClear: function () { setCategoryBudget(c.name, 0); render(); toast('Budget for ' + c.name + ' cleared'); }
            });
          });
          row.appendChild(bb);
        }
        function toggle() { catSel = on ? null : sg.name; draw(false); }
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
        ul.appendChild(row);
      });
      wrap.appendChild(ul); container.appendChild(wrap);
    }
    draw(!reducedMotionPref());
  }
  function reducedMotionPref() { try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function raf2(fn) { (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }); }

  /* ---------- Bank SMS Parser Modal & Auto-Detection ---------- */
  var parsedSMSDraft = null;

  /* Merchant memory: when you change the description of a parsed SMS, the next SMS from that payee uses it. */
  var MERCHANT_KEY = 'kharcha_merchant_memory';
  function merchantMemory() { try { return JSON.parse(kv.get(MERCHANT_KEY)) || {}; } catch (e) { return {}; } }
  function rememberMerchant(payee, desc) {
    if (!payee) return;
    var mem = merchantMemory();
    mem[payee.toLowerCase()] = desc;
    try { kv.set(MERCHANT_KEY, JSON.stringify(mem)); } catch (e) {}
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
    if (!sec || !ul) return;   // this section was merged into the category donut
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
    var wrap = el('div', 'entry-swipe-wrap');

    var b = el('button', 'row');
    b.type = 'button';
    b.setAttribute('aria-label', 'Edit ' + e.desc + ', ' + money(e.amount));
    b.appendChild(el('span', 't', (showDate ? rowDateFmt : tFmt).format(new Date(e.ts))));
    var dSpan = el('span', 'd', e.desc);
    var how = methodLabel(e);
    if (how) dSpan.appendChild(el('small', 'method-badge method-' + e.method, (METHOD_ICONS[e.method] || '') + ' ' + how));
    if (hasReceipt(e.id)) dSpan.appendChild(el('small', 'method-badge', '📎'));
    b.appendChild(dSpan);
    b.appendChild(el('span', 'a', money(e.amount)));

    b.addEventListener('click', function () {
      state.editing = e.id;
      state.draft = { amount: String(e.amount), desc: e.desc, spent_at: toLocalISOString(e.ts), method: e.method || '' };
      render();
      var f = $('edit-amt'); if (f) f.focus();
    });

    wrap.appendChild(b);
    return wrap;
  }

  function methodSelect(id, value) {
    var s = el('select', 'input method-select'); s.id = id;
    [['', '— not set —'], ['upi', '📲 UPI'], ['credit_card', '💳 Credit card'], ['debit_card', '🏦 Debit card'],
      ['cash', '💵 Cash'], ['netbanking', '🏛️ Net banking'], ['wallet', '👛 Wallet']].forEach(function (o) {
      var opt = el('option', null, o[1]); opt.value = o[0];
      if (o[0] === value) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
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
    // How it was paid (needs the v5 columns; hidden until they exist).
    if (hasV5Cols) {
      var f4 = el('div', 'field'), l4 = el('label', null, 'Paid via'); l4.htmlFor = 'edit-method';
      var ms = methodSelect('edit-method', state.draft.method || '');
      ms.addEventListener('change', function () { state.draft.method = ms.value; });
      f4.appendChild(l4); f4.appendChild(ms);
      row2.appendChild(f4);
    }

    var msg = el('p', 'err'); msg.hidden = true; msg.setAttribute('role', 'alert');

    // 1-Tap Quick Shift Scope Buttons
    var curScope = getEntryScope(e);
    var shiftRow = el('div', 'edit-shift-row');
    var shiftLabel = el('span', 'edit-shift-label', 'Type (applied when you tap Save):');
    shiftRow.appendChild(shiftLabel);
    var pendingScope = null;

    function doShift(targetScope, label, tripName) {
      // Only changes the draft. Nothing is saved until Save is tapped, so a stray tap is harmless.
      var newDesc = shiftScopeDesc(state.draft.desc || e.desc, targetScope, tripName);
      state.draft.desc = newDesc;
      d.value = newDesc;
      pendingScope = targetScope;
      if (acctField) acctField.hidden = !(targetScope === 'income');
      if (xferBox) xferBox.hidden = !(targetScope === 'transfer');
      shiftRow.querySelectorAll('.btn-shift').forEach(function (x) { x.classList.toggle('active', x.dataset.scope === targetScope && x.dataset.label === label); });
      msg.textContent = 'Will move to ' + label + '. Tap Save to confirm.'; msg.hidden = false; msg.classList.add('note');
    }

    function createShiftBtn(targetScope, label, icon, tripName) {
      var btn = el('button', 'btn-shift' + (curScope === targetScope ? ' active' : ''), icon + ' ' + label);
      btn.type = 'button'; btn.dataset.scope = targetScope; btn.dataset.label = label;
      btn.addEventListener('click', function () { doShift(targetScope, label, tripName); });
      return btn;
    }

    if (!isIncome(e)) shiftRow.appendChild(createShiftBtn('income', 'Income', '💰'));
    if (!isIncome(e) && loadBank().length > 1) shiftRow.appendChild(createShiftBtn('transfer', 'Own transfer', '↔'));
    if (curScope !== 'personal') shiftRow.appendChild(createShiftBtn('personal', 'Personal', '👤'));
    if (curScope !== 'family') shiftRow.appendChild(createShiftBtn('family', 'Family', '🏠'));
    if (curScope !== 'investment') shiftRow.appendChild(createShiftBtn('investment', 'Investment', '📈'));
    if (curScope !== 'trip') {
      var activeTrip = getActiveTripName();
      // One button per existing trip (not just the active one), so a hotel/flight booking for a
      // trip that hasn't started yet can be filed under that trip without activating it.
      getAllTrips().forEach(function (t) {
        shiftRow.appendChild(createShiftBtn('trip', t + (t === activeTrip ? ' (active)' : ''), '✈️', t));
      });
      var newTripShiftBtn = el('button', 'btn-shift', '✈️ + New trip');
      newTripShiftBtn.type = 'button';
      newTripShiftBtn.addEventListener('click', function () {
        showInputModal({
          title: '✈️ New trip',
          message: "Name it and move this expense into it -- it won't become your active trip until you switch to it later.",
          fields: [{ label: 'Trip name', placeholder: 'e.g. Goa Dec' }],
          confirmText: 'Create & move',
          onConfirm: function (values) {
            var name = (values[0] || '').trim();
            if (!name) return;
            saveTripToList(name);
            doShift('trip', name, name);
          }
        });
      });
      shiftRow.appendChild(newTripShiftBtn);
    }

    var bankAccts = loadBank(), acctField = null, acctSel = null, xferBox = null, xFrom = null, xTo = null;
    if (bankAccts.length > 1) {
      xferBox = el('div', 'add-row'); xferBox.hidden = true;
      var pidX = primaryAcctId(bankAccts), other = bankAccts.filter(function (a) { return a.id !== pidX; });
      xFrom = el('select', 'input'); xTo = el('select', 'input');
      bankAccts.forEach(function (a) { [xFrom, xTo].forEach(function (sel) { var o = el('option', null, a.name); o.value = a.id; sel.appendChild(o); }); });
      xFrom.value = pidX; xTo.value = other[0].id;
      var ff = el('div', 'field'); ff.appendChild(el('label', null, 'From')); ff.appendChild(xFrom);
      var tf = el('div', 'field'); tf.appendChild(el('label', null, 'To')); tf.appendChild(xTo);
      xferBox.appendChild(ff); xferBox.appendChild(tf);
    }
    if (bankAccts.length) {
      acctField = el('div', 'field'); acctField.appendChild(el('label', null, 'Credited to'));
      acctSel = acctChoiceSelect(bankAccts, currentAcctChoice(e, bankAccts));
      acctField.appendChild(acctSel); acctField.hidden = !isIncome(e);
    }
    var btns = el('div', 'edit-btns');
    var save = el('button', 'primary small', 'Save'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    var del = el('button', 'danger', 'Delete'); del.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel); btns.appendChild(del);
    f.appendChild(row1); f.appendChild(row2); f.appendChild(shiftRow); if (acctField) f.appendChild(acctField); if (xferBox) f.appendChild(xferBox); if (!isDemoMode) f.appendChild(receiptRow(e)); f.appendChild(msg); f.appendChild(btns);

    cancel.addEventListener('click', function () { state.editing = null; render(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      msg.classList.remove('note');
      var amt = parseAmount(state.draft.amount), desc = normDesc(state.draft.desc);
      if (amt == null) { msg.textContent = 'Enter an amount greater than zero, like 250 or 99.50.'; msg.hidden = false; return; }
      if (!desc) { msg.textContent = 'Add a short description, like Grocery.'; msg.hidden = false; return; }
      save.disabled = true;
      var newTs = state.draft.spent_at ? new Date(state.draft.spent_at).toISOString() : null;
      var patch = { amount: amt, desc: desc, spent_at: newTs };
      if (hasV5Cols && (state.draft.method || '') !== (e.method || '')) patch.method = state.draft.method || null;
      if (pendingScope) rememberMerchantScope(e.desc, pendingScope);
      if (pendingScope === 'transfer' && xFrom && xFrom.value === xTo.value) { msg.textContent = 'Pick two different accounts.'; msg.hidden = false; save.disabled = false; return; }
      store.update(e.id, patch).then(function () {
        if (pendingScope === 'transfer' && xFrom) {
          var nm = function (id) { var a = bankAccts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : ''; };
          saveTransfers(loadTransfers().filter(function (t) { return t.ref !== e.id; }).concat([{ id: newLoanId(), ts: e.ts, amount: amt, from: xFrom.value, to: xTo.value, ref: e.id, label: 'Transfer ' + nm(xFrom.value) + ' → ' + nm(xTo.value) }]));
        }
        if (acctSel && (isIncome(e) || pendingScope === 'income') && pendingScope !== 'personal' && pendingScope !== 'family' && pendingScope !== 'investment' && pendingScope !== 'trip') setEntryAcct(e.id, acctSel.value);
        state.editing = null; render(); toast('Changes saved', function () { restoreEntry(e); });
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
      var hadReceipt = hasReceipt(e.id), undone = false;
      store.remove(e.id).then(function () {
        state.editing = null; render();
        if (hadReceipt) setTimeout(function () { if (!undone) removeReceipt(e.id).catch(function () {}); }, 9000);   // the photo goes with the entry unless Undo is used
        toast('Deleted ' + e.desc + ' ' + money(e.amount), function () {
          undone = true;
          store.add({ amount: e.amount, desc: e.desc, spent_at: new Date(e.ts).toISOString(), method: e.method || undefined, kind: e.kind || undefined })
            .then(function (ne) { if (hadReceipt && ne) moveReceipt(e.id, ne.id).catch(function () {}); render(); toast('Restored'); }).catch(function () { toast('Could not undo. Try again.'); });
        });
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
    var real = months.filter(function (m) { return m.count > 0 || m.noSpend; });
    if (real.length < 1) { sec.hidden = true; return; }
    sec.hidden = false;
    real.forEach(function (m) {
      var li = el('li');
      var b = el('button', 'mrow'); b.type = 'button';
      if (m.key === state.sel) b.setAttribute('aria-current', 'true');
      var nm = el('span', null, monthLabel(m.key));
      if (m.top) nm.appendChild(el('span', 'sub', 'Most on ' + m.top + ' · ' + money(m.topTotal)));
      b.appendChild(nm);
      b.appendChild(el('span', 'c', m.noSpend ? 'No spending' : m.count + (m.count === 1 ? ' entry' : ' entries')));
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
    var keys = monthsWithAnyEntry(state.entries).map(function (m) { return m.key; });
    if (keys.indexOf(nowKey) < 0) keys.push(nowKey);
    keys.sort(function (a, b) { return a < b ? 1 : -1; });
    var i = keys.indexOf(state.sel) + step;
    if (i >= 0 && i < keys.length) { state.sel = keys[i]; state.editing = null; render(); }
  }

  // Cash wallet → "Log a cash spend": the add form, preset to Cash.
  if ($('cw-log-btn')) {
    $('cw-log-btn').addEventListener('click', function () {
      if ($('paid-via')) $('paid-via').value = 'cash';
      var form = $('add');
      if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('amt').focus();
      if (!hasV5Cols) toast('Run supabase/kharcha_v5_money_types.sql to mark spends as cash.');
    });
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
    var desc;
    if (scope === 'trip') {
      var tripName = ($('trip-pick') && $('trip-pick').value || '').trim();
      if (!tripName) { showErr('Choose a trip, or add a new one first.'); return; }
      desc = shiftScopeDesc(cleanDesc, 'trip', tripName);
    } else {
      desc = (scope === 'family') ? ('🏠 ' + cleanDesc) : cleanDesc;
    }

    var spentVal = $('spent-date').value;
    var spentAt = spentVal ? new Date(spentVal).toISOString() : null;

    var btn = $('addbtn');
    btn.disabled = true;
    var paidVia = $('paid-via') ? $('paid-via').value : '';
    store.add({ amount: amt, desc: desc, spent_at: spentAt, method: paidVia || null }).then(function () {
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
    await sb.auth.signOut({ scope: 'local' }); // this device only; 'global' would also log SpendTrack out
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
      // Pick up trips/budgets changed on the phone -- unless a local change is still waiting to save.
      if (!kv.timer) await kv.load();
      render();
      tidyUp();
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
    await sb.auth.signOut({ scope: 'local' }); // this device only; 'global' would also log SpendTrack out
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
      await kv.load();
      ensureRulesSeeded();
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
    applyRulesToEntries().then(function () { render(); }).catch(function () {});
    tidyUp();
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

  // Phone-app settings (detection, cloud sync, trips) live natively; this button replaces the
  // floating gear that used to cover the tabs.
  var appSettingsBtn = $('app-settings-btn');
  if (appSettingsBtn && window.KharchaNative && window.KharchaNative.openSettings) {
    appSettingsBtn.hidden = false;
    appSettingsBtn.addEventListener('click', function () { window.KharchaNative.openSettings(); });
  }

  // The running version, read from this script's own ?v= so the label can't drift from the real build.
  var APP_VERSION = (function () {
    var s = document.querySelector('script[src*="app.js"]');
    var src = (s && typeof s.getAttribute === 'function' && s.getAttribute('src')) || '';
    var m = /[?&]v=(\d+)/.exec(src);
    return m ? 'v' + m[1] : '';
  })();
  var updateBtn = $('force-update-btn');
  if (updateBtn) {
    if (APP_VERSION) {
      updateBtn.textContent = APP_VERSION + ' 🔄';
      updateBtn.title = 'Force clear cache & reload (running ' + APP_VERSION + ')';
    }
    updateBtn.addEventListener('click', function () {
      showConfirmModal({
        title: '🔄 Force Clear Cache & Reload',
        message: 'Clear cached app data and reload to the latest version? (now running ' + (APP_VERSION || 'unknown') + ')',
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
