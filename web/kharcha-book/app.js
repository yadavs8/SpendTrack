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
  window.__kharcha = { parseAmount: parseAmount, normDesc: normDesc, money: money, groupByDay: groupByDay, byDescription: byDescription, monthTotals: monthTotals };

  var TABLE = 'daily_expenses';
  var COLS = 'id, amount, description, spent_at';
  var DEFAULT_CHIPS = ['Grocery', 'Petrol', 'Vegetables'];
  var state = { mode: 'pending', entries: [], sel: null, editing: null, draft: null };
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

  /* ---------- storage: Supabase table daily_expenses (RLS limits rows to the signed-in user) ---------- */
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
    // spent_at is omitted so the server stamps the time.
    add: async function (e) {
      var res = await sb.from(TABLE)
        .insert({ amount: e.amount, description: e.desc })
        .select(COLS).single();
      if (res.error) throw res.error;
      state.entries.push(fromRow(res.data));
    },
    update: async function (id, patch) {
      var res = await sb.from(TABLE).update({ amount: patch.amount, description: patch.desc })
        .eq('id', id).select(COLS).single();
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
      state.draft = { amount: String(e.amount), desc: e.desc };
      render();
      var f = $('edit-amt'); if (f) f.focus();
    });
    return b;
  }

  function editRow(e) {
    var f = el('form', 'edit');
    f.noValidate = true;
    var row = el('div', 'add-row');
    var f1 = el('div', 'field'), l1 = el('label', null, 'Amount'); l1.htmlFor = 'edit-amt';
    var w = el('div', 'amt-wrap'); w.appendChild(el('span', null, '₹'));
    var a = el('input', 'input'); a.id = 'edit-amt'; a.inputMode = 'decimal'; a.value = state.draft.amount;
    a.addEventListener('input', function () { state.draft.amount = a.value; });
    w.appendChild(a); f1.appendChild(l1); f1.appendChild(w);
    var f2 = el('div', 'field'), l2 = el('label', null, 'Description'); l2.htmlFor = 'edit-desc';
    var d = el('input', 'input'); d.id = 'edit-desc'; d.maxLength = 60; d.value = state.draft.desc; d.setAttribute('list', 'descs');
    d.addEventListener('input', function () { state.draft.desc = d.value; });
    f2.appendChild(l2); f2.appendChild(d);
    row.appendChild(f1); row.appendChild(f2);
    var msg = el('p', 'err'); msg.hidden = true; msg.setAttribute('role', 'alert');
    var btns = el('div', 'edit-btns');
    var save = el('button', 'primary small', 'Save'); save.type = 'submit';
    var cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button';
    var del = el('button', 'danger', 'Delete'); del.type = 'button';
    btns.appendChild(save); btns.appendChild(cancel); btns.appendChild(del);
    f.appendChild(row); f.appendChild(msg); f.appendChild(btns);
    f.appendChild(el('p', 'ddate', 'Recorded ' + dFmt.format(new Date(e.ts)) + ', ' + tFmt.format(new Date(e.ts))));

    cancel.addEventListener('click', function () { state.editing = null; render(); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var amt = parseAmount(state.draft.amount), desc = normDesc(state.draft.desc);
      if (amt == null) { msg.textContent = 'Enter an amount greater than zero, like 250 or 99.50.'; msg.hidden = false; return; }
      if (!desc) { msg.textContent = 'Add a short description, like Grocery.'; msg.hidden = false; return; }
      save.disabled = true;
      store.update(e.id, { amount: amt, desc: desc }).then(function () {
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
      em.appendChild(el('p', null, 'Type an amount and a description above, then tap Add expense. The date and time are filled in for you, so groceries in the morning and petrol in the evening show up as two entries on the same day.'));
      box.appendChild(em);
      return;
    }
    if (!days.length) {
      var e2 = el('div', 'empty');
      e2.appendChild(el('p', null, 'Nothing logged in ' + monthLabel(state.sel) + '.'));
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
    var btn = $('addbtn');
    btn.disabled = true;
    store.add({ amount: amt, desc: desc }).then(function () {
      $('amt').value = ''; $('desc').value = '';
      state.sel = monthKey(Date.now());
      render();
      toast('Added ' + money(amt) + ' for ' + desc);
      $('amt').focus();
    }).catch(function () {
      showErr('Could not save that entry. Check your connection and try again.');
    }).then(function () { renderSync(); });
  });

  /* ---------- sign in ---------- */
  function showAuthErr(msg) { var e = $('auth-err'); e.textContent = msg; e.hidden = !msg; }
  $('auth').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var email = $('auth-email').value.trim(), pass = $('auth-pass').value;
    if (!email || pass.length < 6) { showAuthErr('Enter your email and a password of at least 6 characters.'); return; }
    $('auth-btn').disabled = true; showAuthErr('');
    var res;
    try {
      res = await sb.auth.signInWithPassword({ email: email, password: pass });
    } catch (err) {
      res = { error: { message: 'Could not reach Supabase. Check your connection.' } };
    }
    $('auth-btn').disabled = false;
    if (res.error) { showAuthErr(res.error.message); return; }
    await enterApp();
  });
  $('signout').addEventListener('click', async function () {
    await sb.auth.signOut();
    state.entries = []; state.editing = null; state.mode = 'signedout';
    showScreen('auth');
  });

  function showScreen(which) {
    $('setup').hidden = which !== 'setup';
    $('auth').hidden = which !== 'auth';
    $('main').hidden = which !== 'main';
    $('signout').hidden = which !== 'main';
    if (which !== 'main') { state.mode = which === 'auth' ? 'signedout' : 'setup'; renderSync(); }
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
    var got = await sb.auth.getSession();
    if (got.data && got.data.session) await enterApp(); else showScreen('auth');
  })();
})();
