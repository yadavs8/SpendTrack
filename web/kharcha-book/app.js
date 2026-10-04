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
  function normDesc(s) {
    var t = String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
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

  var dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var tFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  var mFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  function monthLabel(key) { var p = key.split('-'); return mFmt.format(new Date(+p[0], +p[1] - 1, 1)); }
  function keyToDate(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }

  /* Exposed for tests only. */
  window.__kharcha = { parseAmount: parseAmount, normDesc: normDesc, money: money, groupByDay: groupByDay, byDescription: byDescription, monthTotals: monthTotals, toLocalISOString: toLocalISOString };

  var TABLE = 'daily_expenses';
  var COLS = 'id, amount, description, spent_at';
  var DEFAULT_CHIPS = ['Grocery', 'Petrol', 'Vegetables'];
  var state = { mode: 'pending', entries: [], sel: null, editing: null, draft: null };
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
      var payload = { amount: e.amount, description: e.desc };
      if (e.spent_at) payload.spent_at = e.spent_at;
      var res = await sb.from(TABLE).insert(payload).select(COLS).single();
      if (res.error) throw res.error;
      state.entries.push(fromRow(res.data));
    },
    update: async function (id, patch) {
      var payload = { amount: patch.amount, description: patch.desc };
      if (patch.spent_at) payload.spent_at = patch.spent_at;
      var res = await sb.from(TABLE).update(payload).eq('id', id).select(COLS).single();
      if (res.error) throw res.error;
      var i = state.entries.findIndex(function (x) { return x.id === id; });
      if (i >= 0) state.entries[i] = fromRow(res.data);
    },
    remove: async function (id) {
      var res = await sb.from(TABLE).delete().eq('id', id);
      if (res.error) throw res.error;
      state.entries = state.entries.filter(function (x) { return x.id !== id; });
    }
  };

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

  $('export-csv').addEventListener('click', function () {
    var list = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });
    if (searchQuery) {
      list = list.filter(function (e) {
        return e.desc.toLowerCase().includes(searchQuery) || dFmt.format(new Date(e.ts)).toLowerCase().includes(searchQuery);
      });
    }
    if (!list.length) { toast('No expenses to export for this month.'); return; }
    var csv = ['Date,Time,Description,Amount (INR)'];
    list.sort(byTimeDesc).forEach(function (e) {
      var d = new Date(e.ts);
      var dateStr = dayKey(e.ts);
      var timeStr = tFmt.format(d);
      var descStr = '"' + e.desc.replace(/"/g, '""') + '"';
      csv.push(dateStr + ',' + timeStr + ',' + descStr + ',' + e.amount);
    });
    var blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'kharcha-expenses-' + state.sel + '.csv';
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
    var list = state.entries.filter(function (e) { return monthKey(e.ts) === state.sel; });

    if (searchQuery) {
      list = list.filter(function (e) {
        return e.desc.toLowerCase().includes(searchQuery) || dFmt.format(new Date(e.ts)).toLowerCase().includes(searchQuery);
      });
    }

    var days = groupByDay(list);

    $('mlabel').textContent = monthLabel(state.sel);
    $('mtotal').textContent = money(cur.total);
    $('st-count').textContent = String(cur.count);
    var top = days.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var byDesc = byDescription(list)[0];
    $('st-top').textContent = byDesc ? byDesc.label + ' · ' + money(byDesc.total) : '—';
    $('st-high').textContent = top ? money(top.total) + ' · ' + dFmt.format(new Date(top.ts)) : '—';
    $('prev').disabled = idx >= months.length - 1;
    $('next').disabled = idx <= 0;

    renderBudget(cur.total);
    renderSuggestions();
    renderBreakdown(list, cur.total);
    renderDays(days);
    renderMonths(months);
    renderSync();
  }

  function suggestionList() {
    var counts = new Map();
    state.entries.forEach(function (e) {
      var k = e.desc.toLowerCase();
      if (!counts.has(k)) counts.set(k, { label: e.desc, n: 0 });
      counts.get(k).n++;
    });
    var all = Array.from(counts.values()).sort(function (a, b) { return b.n - a.n; }).map(function (c) { return c.label; });
    var chips = all.slice(0, 6);
    DEFAULT_CHIPS.forEach(function (d) {
      if (chips.length < 6 && !chips.some(function (c) { return c.toLowerCase() === d.toLowerCase(); })) chips.push(d);
    });
    return { chips: chips, all: all.slice(0, 60) };
  }
  function renderSuggestions() {
    var s = suggestionList();
    var box = $('chips');
    box.textContent = '';
    s.chips.forEach(function (label) {
      var b = el('button', 'chip', label);
      b.type = 'button';
      b.addEventListener('click', function () {
        $('desc').value = label;
        if (!$('amt').value) $('amt').focus(); else $('desc').focus();
      });
      box.appendChild(b);
    });
    var dl = $('descs');
    dl.textContent = '';
    s.all.concat(DEFAULT_CHIPS).forEach(function (label) {
      var o = document.createElement('option'); o.value = label; dl.appendChild(o);
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
      em.appendChild(el('p', null, 'Type an amount and a description above, then tap Add expense. You can also pick a specific date and time for past expenses.'));
      box.appendChild(em);
      return;
    }
    if (!days.length) {
      var e2 = el('div', 'empty');
      e2.appendChild(el('p', null, searchQuery ? 'No expenses matching "' + searchQuery + '".' : 'Nothing logged in ' + monthLabel(state.sel) + '.'));
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
    var desc = normDesc($('desc').value);
    if (!desc) { showErr('Add a short description, like Grocery or Petrol.'); $('desc').focus(); return; }
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
    }).catch(function () {
      showErr('Could not save that entry. Check your connection and try again.');
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
  function renderLockToggle() {
    var b = $('locktoggle');
    b.hidden = $('main').hidden || !lockSupported;
    b.textContent = lockCred() ? 'Turn off lock' : 'Turn on fingerprint / PIN lock';
  }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  async function enableLock() {
    try {
      var who = (await sb.auth.getUser()).data.user;
      var cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(32),
        rp: { name: 'Kharcha Book' },
        user: { id: rand(16), name: (who && (who.email || who.phone)) || 'kharcha', displayName: 'Kharcha Book' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000
      } });
      setLockCred(b64u(cred.rawId));
      renderLockToggle(); renderLockOffer();
      toast('Lock is on. It asks for your fingerprint or PIN next time.');
    } catch (err) {
      toast('Could not turn on the lock. Make sure your phone has a screen lock set up.');
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
      $('lock-err').textContent = 'Could not unlock. Try again, or sign in with password.';
      $('lock-err').hidden = false;
      return;
    }
    await enterApp();
  }
  function lockNow() {
    state.editing = null;
    showScreen('lock');
  }
  $('locktoggle').addEventListener('click', function () {
    if (lockCred()) { setLockCred(null); renderLockToggle(); toast('Lock turned off'); }
    else enableLock();
  });
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
  function renderLockOffer() { $('lock-offer').hidden = !(lockSupported && !lockCred() && !offerDeclined() && !$('main').hidden); }
  $('offer-no').addEventListener('click', function () { try { localStorage.setItem(OFFER_KEY, '1'); } catch (e) {} renderLockOffer(); });
  $('offer-yes').addEventListener('click', async function () { await enableLock(); renderLockOffer(); });

  /* ---------- Sign In (Phone OTP / Email OTP / Password) ---------- */
  function showAuthErr(msg) { var e = $('auth-err'); e.textContent = msg; e.hidden = !msg; }
  function showAuthInfo(msg) { var i = $('auth-info'); i.textContent = msg; i.hidden = !msg; }

  var authTab = 'phone';
  var otpSent = false;

  function renderAuthTabs() {
    $('tab-phone').classList.toggle('active', authTab === 'phone');
    $('tab-email').classList.toggle('active', authTab === 'email');
    $('tab-pass').classList.toggle('active', authTab === 'pass');

    $('phone-field').hidden = authTab !== 'phone';
    $('email-field').hidden = authTab !== 'email';
    $('pass-field').hidden = authTab !== 'pass';
    $('code-field').hidden = !otpSent || authTab === 'pass';

    if (authTab === 'phone') {
      $('auth-title').textContent = otpSent ? 'Enter SMS Code' : 'Sign in with Phone OTP';
      $('auth-intro').textContent = 'Enter your phone number with country code (e.g. +919876543210) to receive a one-time SMS code.';
      $('auth-btn').textContent = otpSent ? 'Verify SMS Code' : 'Send SMS Code';
    } else if (authTab === 'email') {
      $('auth-title').textContent = otpSent ? 'Enter Email Code' : 'Sign in with Email OTP';
      $('auth-intro').textContent = 'Enter your email address to receive a one-time code.';
      $('auth-btn').textContent = otpSent ? 'Verify Email Code' : 'Send Email Code';
    } else {
      $('auth-title').textContent = 'Sign in with Password';
      $('auth-intro').textContent = 'Enter your email and password to sign in.';
      $('auth-btn').textContent = 'Sign in';
    }
    showAuthErr(''); showAuthInfo('');
  }

  $('tab-phone').addEventListener('click', function () { authTab = 'phone'; otpSent = false; renderAuthTabs(); });
  $('tab-email').addEventListener('click', function () { authTab = 'email'; otpSent = false; renderAuthTabs(); });
  $('tab-pass').addEventListener('click', function () { authTab = 'pass'; otpSent = false; renderAuthTabs(); });

  $('auth').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    showAuthErr(''); showAuthInfo('');
    $('auth-btn').disabled = true;
    var res;
    try {
      if (authTab === 'pass') {
        var email = $('auth-email').value.trim();
        var pass = $('auth-pass').value;
        if (!email || pass.length < 6) { showAuthErr('Enter your email and password.'); $('auth-btn').disabled = false; return; }
        res = await sb.auth.signInWithPassword({ email: email, password: pass });
      } else if (authTab === 'phone') {
        var phone = $('auth-phone').value.trim();
        if (!phone) { showAuthErr('Enter your phone number with country code (e.g. +919876543210).'); $('auth-btn').disabled = false; return; }
        if (!otpSent) {
          res = await sb.auth.signInWithOtp({ phone: phone });
          if (!res.error) {
            otpSent = true; renderAuthTabs();
            showAuthInfo('SMS code sent to ' + phone + '. Enter the 6-digit code below.');
            $('auth-code').focus(); $('auth-btn').disabled = false; return;
          }
        } else {
          var code = $('auth-code').value.replace(/\s/g, '');
          if (code.length < 6) { showAuthErr('Enter the 6-digit SMS code.'); $('auth-btn').disabled = false; return; }
          res = await sb.auth.verifyOtp({ phone: phone, token: code, type: 'sms' });
        }
      } else if (authTab === 'email') {
        var email = $('auth-email').value.trim();
        if (!email) { showAuthErr('Enter your email address.'); $('auth-btn').disabled = false; return; }
        if (!otpSent) {
          res = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
          if (!res.error) {
            otpSent = true; renderAuthTabs();
            showAuthInfo('We sent a code to ' + email + '. Enter it below.');
            $('auth-code').focus(); $('auth-btn').disabled = false; return;
          }
        } else {
          var code = $('auth-code').value.replace(/\s/g, '');
          if (code.length < 6) { showAuthErr('Enter the code from your email.'); $('auth-btn').disabled = false; return; }
          res = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
        }
      }
    } catch (err) {
      res = { error: { message: err.message || 'Could not reach Supabase. Check connection.' } };
    }
    $('auth-btn').disabled = false;
    if (res.error) { showAuthErr(res.error.message); return; }
    otpSent = false;
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
    if (which === 'auth') renderAuthTabs();
    renderLockToggle(); renderLockOffer();
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
    var got = await sb.auth.getSession();
    if (got.data && got.data.session) {
      if (lockCred() && lockSupported) { showScreen('lock'); unlock(); } else await enterApp();
    } else showScreen('auth');
  })();
})();
