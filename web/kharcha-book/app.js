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

  function isFamilyEntry(desc) {
    var d = desc.toLowerCase();
    return d.includes('🏠') || d.includes('family') || d.includes('niece') || d.includes('electricity') || d.includes('gas') || d.includes('bill');
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
    entries.forEach(function (e) {
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

  var KNOWN_BANKS = [
    { name: 'HDFC Bank', code: 'HDFCBK', match: /HDFC|HDFCBK/i },
    { name: 'ICICI Bank', code: 'ICICIB', match: /ICICI|ICICIB/i },
    { name: 'State Bank of India', code: 'SBIINB', match: /SBI|SBIINB|STATE BANK/i },
    { name: 'Axis Bank', code: 'AXISBK', match: /AXIS|AXISBK/i },
    { name: 'Kotak Bank', code: 'KOTAKB', match: /KOTAK|KOTAKB/i },
    { name: 'Punjab National Bank', code: 'PNBSMS', match: /PNB|PNBSMS/i },
    { name: 'Bank of Baroda', code: 'BOBTXT', match: /BOB|BARODA/i },
    { name: 'Paytm Payments Bank', code: 'PAYTM', match: /PAYTM/i },
    { name: 'Google Pay', code: 'GPAY', match: /GPAY|GOOGLE PAY/i },
    { name: 'PhonePe', code: 'PHONEPE', match: /PHONEPE/i },
    { name: 'Amazon Pay', code: 'AMAZON', match: /AMAZON/i },
    { name: 'Canara Bank', code: 'CANBK', match: /CANARA|CANBK/i },
    { name: 'IndusInd Bank', code: 'INDUSI', match: /INDUSIND|INDUSI/i },
    { name: 'IDFC FIRST Bank', code: 'IDFCFB', match: /IDFC/i },
    { name: 'Yes Bank', code: 'YESBNK', match: /YESBNK|YES BANK/i },
    { name: 'Union Bank', code: 'UNIONB', match: /UNION/i },
    { name: 'Federal Bank', code: 'FEDERAL', match: /FEDERAL/i },
    { name: 'Cred', code: 'CRED', match: /CRED/i },
    { name: 'Slice', code: 'SLICE', match: /SLICE/i },
    { name: 'Jupiter', code: 'JUPITR', match: /JUPITER|JUPITR/i },
    { name: 'Fi Money', code: 'FI', match: /FI MONEY|EPIFI/i }
  ];

  function parseBankSMS(rawText) {
    if (!rawText || typeof rawText !== 'string') return { valid: false, error: 'Empty message provided.' };
    var txt = rawText.trim();
    if (!txt) return { valid: false, error: 'Empty message provided.' };

    // 1. Filter out OTPs, promotional spam, and credits
    var isOTP = /otp|verification code|secret code|do not share/i.test(txt);
    if (isOTP) return { valid: false, error: 'This is an OTP / verification message, not a transaction.' };

    var isSpam = /pre-approved|apply (?:now|for)|congratulations|flat \d+%|reward points|earn cashback|limited period offer/i.test(txt);
    if (isSpam) return { valid: false, error: 'This is a promotional offer, not a debit transaction.' };

    var isCredit = /\bcredited\b|\bcredit of\b|\brefund of\b/i.test(txt) && !/\bdebited\b|\bpaid\b|\bspent\b/i.test(txt);
    if (isCredit) return { valid: false, error: 'This is a credit/income message, not an expense.' };

    // 2. Identify Bank / Sender
    var detectedBank = null;
    var headerMatch = txt.match(/^([A-Z]{2}-[A-Z0-9]{3,8}(?:-[A-Z0-9]+)?):\s*/i);
    var headerCode = headerMatch ? headerMatch[1] : '';

    for (var i = 0; i < KNOWN_BANKS.length; i++) {
      var b = KNOWN_BANKS[i];
      if (b.match.test(headerCode) || b.match.test(txt)) {
        detectedBank = b.name;
        break;
      }
    }

    // Check for standard debit keywords
    var hasDebitWord = /\bdebited\b|\bpaid\b|\bspent\b|\bwithdrawn\b|\btransferred\b|\bused at\b|\bpurchased at\b|\bvpa\b|\bupi ref\b|\bspent rs\b|\bsent rs\b/i.test(txt);

    if (!detectedBank && !hasDebitWord) {
      return { valid: false, error: 'No recognized bank or debit pattern found in message.' };
    }

    if (!hasDebitWord) {
      return { valid: false, error: 'Message from bank found, but does not contain a debit transaction.' };
    }

    // 3. Extract Amount
    var amtMatch = txt.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                   txt.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:debited|paid|spent)/i) ||
                   txt.match(/(?:amount|sum)\s*(?:of)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);

    if (!amtMatch) {
      return { valid: false, error: 'Could not extract valid transaction amount from SMS.' };
    }

    var amtStr = amtMatch[1].replace(/,/g, '');
    var amount = Number(amtStr);
    if (!amount || isNaN(amount) || amount <= 0) {
      return { valid: false, error: 'Invalid transaction amount extracted.' };
    }

    // 4. Extract Payee / Merchant Name
    var payee = '';
    var payeeMatch = txt.match(/(?:to|at|info:)\s+([A-Za-z0-9\s._&-]{2,30}?)(?:\s+on|\s+ref|\s+via|\s+vpa|\s+a\/c|\s+balance|\.|\,|$)/i) ||
                     txt.match(/paid\s+(?:to\s+)?([A-Za-z0-9\s._&-]{2,30}?)(?:\s+on|\s+ref|\s+via|\.|\,|$)/i) ||
                     txt.match(/for\s+([A-Za-z0-9\s._&-]{2,30}?)(?:\s+payment|\s+via|\s+on|\.|\,|$)/i);

    if (payeeMatch) {
      payee = payeeMatch[1].trim();
      payee = payee.replace(/@\w+/g, '').replace(/^(vpa|info|ref)\s+/i, '').trim();
    }

    if (!payee || payee.length < 2) {
      payee = detectedBank ? (detectedBank + ' Spend') : 'Bank Spend';
    }

    // 5. Determine Category Emoji & Scope
    var payeeLower = payee.toLowerCase();
    var txtLower = txt.toLowerCase();
    var combo = payeeLower + ' ' + txtLower;

    var emoji = '💳';
    var label = payee;
    var scope = 'personal';

    if (/swiggy|zomato|eats|food|restaurant|cafe|dominos|pizza/i.test(combo)) {
      emoji = '🍔'; label = 'Food & Dining (' + payee + ')'; scope = 'personal';
    } else if (/zepto|blinkit|instamart|grocery|dmart|supermarket|bigbasket|bazaar/i.test(combo)) {
      emoji = '🛒'; label = 'General Grocery (' + payee + ')'; scope = 'family';
    } else if (/electricity|bescom|tata power|torrent|power|light bill/i.test(combo)) {
      emoji = '⚡'; label = 'Electricity Bill'; scope = 'family';
    } else if (/gas|indane|hpcl|bharatgas|cylinder/i.test(combo)) {
      emoji = '🔥'; label = 'Gas Bill'; scope = 'family';
    } else if (/airtel|jio|vi\b|vodafone|wifi|broadband|recharge/i.test(combo)) {
      emoji = '📱'; label = 'Mobile & WiFi'; scope = 'personal';
    } else if (/hpcl|iocl|bpcl|petrol|fuel|shell\b/i.test(combo)) {
      emoji = '⛽'; label = 'Petrol / Fuel'; scope = 'personal';
    } else if (/uber|ola|rapido|namma yatri|auto|cab|metro/i.test(combo)) {
      emoji = '🛺'; label = 'Auto / Cab'; scope = 'personal';
    } else if (/amazon|flipkart|myntra|meesho|nykaa/i.test(combo)) {
      emoji = '🛍️'; label = 'Online Shopping (' + payee + ')'; scope = 'personal';
    } else if (/pharmacy|pharmeasy|apollo|1mg|doctor|clinic|hospital|medicine/i.test(combo)) {
      emoji = '💊'; label = 'Medicines & Doctor'; scope = 'family';
    } else if (/milk|doodh|dairy|mother dairy/i.test(combo)) {
      emoji = '🥛'; label = 'Milk / Doodh'; scope = 'family';
    }

    var descWithEmoji = (scope === 'family') ? ('🏠 ' + emoji + ' ' + label) : (emoji + ' ' + label);

    return {
      valid: true,
      bank: detectedBank || 'Bank SMS',
      amount: amount,
      rawPayee: payee,
      desc: descWithEmoji,
      scope: scope,
      rawSMS: txt
    };
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
      if (clean.includes('🛒') || lower.includes('grocery') || lower.includes('supermarket')) categoryName = '🛒 Grocery';
      else if (clean.includes('🥦') || lower.includes('vegetable')) categoryName = '🥦 Vegetables';
      else if (clean.includes('🥛') || lower.includes('milk') || lower.includes('doodh')) categoryName = '🥛 Milk & Dairy';
      else if (clean.includes('⚡') || lower.includes('electricity')) categoryName = '⚡ Electricity Bill';
      else if (clean.includes('🔥') || lower.includes('gas')) categoryName = '🔥 Gas Bill';
      else if (clean.includes('📱') || lower.includes('recharge') || lower.includes('wifi')) categoryName = '📱 Mobile & WiFi';
      else if (clean.includes('⛽') || lower.includes('petrol') || lower.includes('fuel')) categoryName = '⛽ Fuel';
      else if (clean.includes('🍔') || lower.includes('swiggy') || lower.includes('zomato') || lower.includes('food')) categoryName = '🍔 Food & Dining';
      else if (clean.includes('🛍️') || lower.includes('shopping') || lower.includes('amazon')) categoryName = '🛍️ Online Shopping';
      else if (clean.includes('👧') || lower.includes('niece')) categoryName = '👧 Niece Allowance';
      else if (clean.includes('💊') || lower.includes('medicine') || lower.includes('doctor')) categoryName = '💊 Health & Medicines';
      else if (clean.includes('🧹') || lower.includes('maid') || lower.includes('house help')) categoryName = '🧹 House Help';
      else if (clean.includes('🛺') || lower.includes('auto') || lower.includes('cab')) categoryName = '🛺 Travel & Cab';
      else categoryName = firstSymbol + ' Other Spends';

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

  var dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var tFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  var mFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  function monthLabel(key) { var p = key.split('-'); return mFmt.format(new Date(+p[0], +p[1] - 1, 1)); }
  function keyToDate(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }

  /* Exposed for tests only. */
  window.__kharcha = { parseAmount: parseAmount, normDesc: normDesc, money: money, groupByDay: groupByDay, byDescription: byDescription, monthTotals: monthTotals, toLocalISOString: toLocalISOString, isFamilyEntry: isFamilyEntry, parseBankSMS: parseBankSMS, categoryBreakdown: categoryBreakdown };

  var TABLE = 'daily_expenses';
  var COLS = 'id, amount, description, spent_at';

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

  var state = { mode: 'pending', entries: [], sel: null, editing: null, draft: null, scopeFilter: 'all' };
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
    return { id: r.id, amount: Number(r.amount), desc: r.description, ts: Date.parse(r.spent_at) };
  }

  /* ---------- storage ---------- */
  var store = {
    loadAll: async function () {
      var out = [], from = 0, size = 1000;
      while (true) {
        var res = await sb.from(TABLE).select(COLS)
          .order('spent_at', { ascending: false }).order('id').range(from, from + size - 1);
        if (res.error) throw res.error;
        out = out.concat(res.data);
        if (res.data.length < size) break;
        from += size;
      }
      return out.map(fromRow).filter(validEntry);
    },
    add: async function (e) {
      var userRes = await sb.auth.getUser();
      if (!userRes.data || !userRes.data.user) {
        showScreen('auth');
        throw new Error("Your sign-in session expired. Please sign in again.");
      }
      var cleanDesc = safeTruncate(e.desc, 50);
      var payload = { amount: e.amount, description: cleanDesc, user_id: userRes.data.user.id };
      if (e.spent_at) payload.spent_at = e.spent_at;
      var res = await sb.from(TABLE).insert([payload]).select(COLS).single();
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
      var res = await sb.from(TABLE).update(payload).eq('id', id).select(COLS).single();
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

  $('budget-edit-btn').addEventListener('click', function () {
    var cur = getBudget();
    var val = prompt('Enter your monthly budget limit in ₹ (enter 0 to clear):', cur || '');
    if (val === null) return;
    var n = Number(val.replace(/[,\s₹]/g, ''));
    if (isNaN(n) || n < 0) { alert('Please enter a valid positive number.'); return; }
    setBudget(n);
    render();
  });

  /* ---------- Search & CSV Export ---------- */
  $('search').addEventListener('input', function (ev) {
    searchQuery = ev.target.value.trim().toLowerCase();
    render();
  });

  var moveBtn = $('move-all-family');
  if (moveBtn) {
    moveBtn.addEventListener('click', async function () {
      var personalEntries = state.entries.filter(function (e) { return !isFamilyEntry(e.desc); });
      if (!personalEntries.length) {
        toast('All expenses are already under Family & Bills!');
        return;
      }
      var ok = confirm('Move ' + personalEntries.length + ' personal expense(s) to Family & Bills?');
      if (!ok) return;

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
        render();
      }
    });
  }

  $('export-csv').addEventListener('click', function () {
    var list = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });
    if (state.scopeFilter === 'personal') list = list.filter(function (e) { return !isFamilyEntry(e.desc); });
    else if (state.scopeFilter === 'family') list = list.filter(function (e) { return isFamilyEntry(e.desc); });

    if (searchQuery) {
      list = list.filter(function (e) {
        return e.desc.toLowerCase().includes(searchQuery) || dFmt.format(new Date(e.ts)).toLowerCase().includes(searchQuery);
      });
    }
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
  function render() {
    var nowKey = monthKey(Date.now());
    var months = monthTotals(state.entries);
    if (!months.some(function (m) { return m.key === nowKey; })) months.unshift({ key: nowKey, total: 0, count: 0 });
    months.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    if (!state.sel || !months.some(function (m) { return m.key === state.sel; })) state.sel = nowKey;
    var idx = months.findIndex(function (m) { return m.key === state.sel; });
    var cur = months[idx];

    var monthEntries = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });
    var list = monthEntries;

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

    var displayTotal = sumRupees(list);
    var days = groupByDay(list);

    $('mlabel').textContent = monthLabel(state.sel);
    $('mtotal').textContent = money(displayTotal);
    $('st-count').textContent = String(list.length);
    var top = days.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var byDesc = byDescription(list)[0];
    $('st-top').textContent = byDesc ? byDesc.label + ' · ' + money(byDesc.total) : '—';
    $('st-high').textContent = top ? money(top.total) + ' · ' + dFmt.format(new Date(top.ts)) : '—';
    $('prev').disabled = idx >= months.length - 1;
    $('next').disabled = idx <= 0;

    renderBudget(cur.total);
    renderSuggestions();
    renderCategoryBreakdown(list);
    renderBreakdown(list, displayTotal);
    renderDays(days);
    renderMonths(months);
    renderSync();
  }

  function renderCategoryBreakdown(list) {
    var sec = $('category-sec');
    var container = $('cat-breakdown');
    if (!sec || !container) return;
    container.textContent = '';
    if (!list.length) { sec.hidden = true; return; }

    var res = categoryBreakdown(list);
    if (!res.categories.length) { sec.hidden = true; return; }
    sec.hidden = false;

    res.categories.slice(0, 6).forEach(function (c) {
      var row = el('div', 'cat-row');
      var head = el('div', 'cat-row-head');
      var nameSpan = el('span', null, c.name + ' (' + c.count + ')');
      var amtSpan = el('span', null, money(c.total) + ' · ' + c.pct + '%');
      head.appendChild(nameSpan);
      head.appendChild(amtSpan);

      var track = el('div', 'cat-track');
      var fill = el('div', 'cat-fill');
      fill.style.width = Math.min(100, Math.max(2, c.pct)) + '%';
      track.appendChild(fill);

      row.appendChild(head);
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  /* ---------- Bank SMS Parser Modal ---------- */
  var parsedSMSDraft = null;

  function openSMSModal() {
    var modal = $('sms-modal');
    if (modal) {
      modal.hidden = false;
      $('sms-input').value = '';
      var res = $('sms-result');
      if (res) res.hidden = true;
      $('save-sms-entry').disabled = true;
      $('sms-input').focus();
    }
  }

  function closeSMSModal() {
    var modal = $('sms-modal');
    if (modal) modal.hidden = true;
    parsedSMSDraft = null;
  }

  if ($('open-sms-modal')) $('open-sms-modal').addEventListener('click', openSMSModal);
  if ($('close-sms-modal')) $('close-sms-modal').addEventListener('click', closeSMSModal);
  if ($('cancel-sms-modal')) $('cancel-sms-modal').addEventListener('click', closeSMSModal);

  if ($('sms-modal')) {
    $('sms-modal').addEventListener('click', function (ev) {
      if (ev.target === $('sms-modal')) closeSMSModal();
    });
  }

  if ($('sms-parse-btn')) {
    $('sms-parse-btn').addEventListener('click', function () {
      var txt = $('sms-input').value;
      var result = parseBankSMS(txt);
      var container = $('sms-result');
      if (!container) return;
      container.textContent = '';
      container.hidden = false;

      if (!result.valid) {
        container.className = 'sms-preview-card invalid';
        var title = el('div', 'sms-badge-title', '❌ Invalid or Non-Bank Message');
        var desc = el('div', null, result.error || 'Only debit SMS messages from recognized banks are parsed.');
        container.appendChild(title);
        container.appendChild(desc);
        $('save-sms-entry').disabled = true;
        parsedSMSDraft = null;
      } else {
        container.className = 'sms-preview-card valid';
        var title = el('div', 'sms-badge-title', '✓ Verified Bank SMS (' + result.bank + ')');
        var grid = el('div', 'sms-details-grid');
        grid.appendChild(el('div', null, 'Amount: ' + money(result.amount)));
        grid.appendChild(el('div', null, 'Scope: ' + (result.scope === 'family' ? '🏠 Family & Bills' : '👤 Personal')));
        grid.appendChild(el('div', null, 'Parsed Category: ' + result.desc));

        container.appendChild(title);
        container.appendChild(grid);
        $('save-sms-entry').disabled = false;
        parsedSMSDraft = result;
      }
    });
  }

  if ($('save-sms-entry')) {
    $('save-sms-entry').addEventListener('click', function () {
      if (!parsedSMSDraft || !parsedSMSDraft.valid) return;
      var saveBtn = $('save-sms-entry');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      store.add({ amount: parsedSMSDraft.amount, desc: parsedSMSDraft.desc, spent_at: null }).then(function () {
        closeSMSModal();
        render();
        toast('Added ' + money(parsedSMSDraft.amount) + ' from ' + parsedSMSDraft.bank + ' SMS!');
      }).catch(function (err) {
        alert('Could not save SMS entry: ' + (err.message || 'Error'));
      }).then(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = '1-Tap Add Expense';
      });
    });
  }

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

  function dayHead(g) {
    var head = el('div', 'day-head');
    var l = el('div', 'l');
    var today = dayKey(Date.now());
    var yest = dayKey(Date.now() - 86400000);
    var date = dFmt.format(keyToDate(g.key));
    if (g.key === today) { l.appendChild(el('span', 'dname', 'Today')); l.appendChild(el('span', 'ddate', date)); }
    else if (g.key === yest) { l.appendChild(el('span', 'dname', 'Yesterday')); l.appendChild(el('span', 'ddate', date)); }
    else l.appendChild(el('span', 'dname', date));
    head.appendChild(l);
    head.appendChild(el('span', 'dtotal', money(g.total)));
    return head;
  }

  function entryRow(e) {
    var b = el('button', 'row');
    b.type = 'button';
    b.setAttribute('aria-label', 'Edit ' + e.desc + ', ' + money(e.amount));
    b.appendChild(el('span', 't', tFmt.format(new Date(e.ts))));
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
    days.forEach(function (g) {
      var wrap = el('section', 'day');
      wrap.appendChild(dayHead(g));
      var ul = el('ul', 'entries');
      g.items.forEach(function (e) {
        var li = el('li');
        li.appendChild(state.editing === e.id && state.draft ? editRow(e) : entryRow(e));
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
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
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && lockCred() && !$('main').hidden) lockNow();
    hiddenAt = 0;
  });

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

  async function enterApp() {
    showScreen('main');
    state.mode = 'pending'; renderSync();
    try {
      state.entries = await store.loadAll();
      state.mode = 'db';
    } catch (err) {
      state.mode = 'error';
      render();
      showErr('Could not load your expenses: ' + (err.message || 'check the Supabase table and policies') + '. Run supabase/daily_expenses.sql in the Supabase SQL editor if you have not yet.');
      return;
    }
    render();
  }

  /* ---------- start ---------- */
  updateStamp();
  setInterval(updateStamp, 15000);
  render();

  (async function init() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) { showScreen('setup'); return; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    await detectLock();

    sb.auth.onAuthStateChange(async function (event, session) {
      if (session && ($('main').hidden || state.mode === 'signedout')) {
        if (lockCred() && lockSupported) { showScreen('lock'); unlock(); }
        else await enterApp();
      }
    });

    var got = await sb.auth.getSession();
    if (got.data && got.data.session) {
      if (lockCred() && lockSupported) { showScreen('lock'); unlock(); } else await enterApp();
    } else showScreen('auth');
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
})();
