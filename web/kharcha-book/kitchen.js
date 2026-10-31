/* Kharcha Book v133: Kitchen. What each grocery spend was (no bill needed) and how much of each item you use.
   - Your known baskets fill themselves: ₹36 / ₹72 Amul, ₹40 / ₹80 A2, ₹136 / ₹172 = 10 coffee + Amul.
   - Anything else at a kirana / dairy / sabzi shop asks "What did you buy?": tap items, ± quantity, or type
     "adrak 40, sabzi 60". Saving a basket of priced packs teaches the app that amount for next time.
   - The Kitchen page: per item quantity, money, price per unit, how often, and what is about to run out.
   Items live in the expense_items table (one row per spend; deleting the spend deletes them). Runs after app.js. */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function KL() { return window.KharchaLedger; }
  function money(v) { return K.money(Math.round(v * 100) / 100); }
  var CAT_KEY = 'kharcha_item_catalog', PAT_KEY = 'kharcha_item_patterns', LOCAL_KEY = 'kharcha_items_local', SKIP_KEY = 'kharcha_items_skip';
  var dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var tFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
  var sFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* ---------- storage ---------- */
  var saved = {}, loaded = false, loading = false;
  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function writeLocal(m) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(m)); } catch (e) {} }
  function sb() { return K.getSb ? K.getSb() : null; }
  function load() {
    if (loaded || loading) return;
    loading = true;
    var loc = readLocal(); Object.keys(loc).forEach(function (k) { saved[k] = loc[k]; });
    var c = sb();
    if (!c || !c.from) { loaded = true; loading = false; return; }
    c.from('expense_items').select('entry_id, items').then(function (res) {
      loading = false; loaded = true;
      if (res && res.data) res.data.forEach(function (r) { if (Array.isArray(r.items)) saved[r.entry_id] = r.items; });
      refresh();
    }, function () { loading = false; loaded = true; });
  }
  function store(entryId, items) {
    if (items && items.length) saved[entryId] = items; else delete saved[entryId];
    var c = sb();
    if (c && c.from && UUID.test(entryId)) {
      var q = items && items.length ? c.from('expense_items').upsert({ entry_id: entryId, items: items, updated_at: new Date().toISOString() }) : c.from('expense_items').delete().eq('entry_id', entryId);
      return q.then(function (res) { if (res && res.error) throw res.error; });
    }
    var loc = readLocal(); if (items && items.length) loc[entryId] = items; else delete loc[entryId]; writeLocal(loc);
    return Promise.resolve();
  }

  /* ---------- catalog and learned baskets ---------- */
  function jsonKv(k, d) { try { var v = JSON.parse(K.kvGet(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function catalog() {
    var extra = jsonKv(CAT_KEY, []), by = {};
    KL().KITCHEN_SEED.forEach(function (it) { by[it.id] = it; });
    (Array.isArray(extra) ? extra : []).forEach(function (it) { if (it && it.id) by[it.id] = Object.assign({}, by[it.id] || {}, it); });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function learned() { var p = jsonKv(PAT_KEY, {}); return p && typeof p === 'object' ? p : {}; }
  function rememberBasket(amount, items) {
    var cat = catalog(), packs = [];
    for (var i = 0; i < items.length; i++) {
      var it = cat.filter(function (c) { return c.id === items[i].id; })[0];
      if (!it || !it.pack || items[i].amount == null) return;
      var n = Math.round(items[i].qty / it.pack.size); if (Math.abs(n * it.pack.size - items[i].qty) > 1e-6 || Math.abs(n * it.pack.price - items[i].amount) > 0.01) return;
      packs.push([it.id, n]);
    }
    var sum = items.reduce(function (t, l) { return t + Math.round(l.amount * 100); }, 0);
    if (!packs.length || sum !== Math.round(amount * 100)) return;
    var p = learned(); p[sum] = packs; K.kvSet(PAT_KEY, JSON.stringify(p));
  }
  function addToCatalog(lines) {
    var extra = jsonKv(CAT_KEY, []); if (!Array.isArray(extra)) extra = [];
    lines.forEach(function (l) { if (l.fresh && !extra.some(function (x) { return x.id === l.id; })) extra.push({ id: l.id, name: l.fresh.name, icon: l.fresh.icon, unit: l.fresh.unit, words: [l.fresh.name.toLowerCase()] }); delete l.fresh; });
    K.kvSet(CAT_KEY, JSON.stringify(extra));
  }

  /* ---------- which spends are groceries, and what they were ---------- */
  var SHOPISH = /kirana|general\s*store|provision|dairy|doodh|milk|sabzi|sabji|vegetable|fruit|grocery|grocer|mart\b|blinkit|zepto|instamart|bigbasket|swiggy\s*instamart|jiomart|dmart/i;
  function isGrocery(e) {
    if (!e || e.synthetic || !(e.amount > 0) || !K.isExpense(e) || (K.isTripEntry && K.isTripEntry(e)) || e.method === 'credit_card' && !SHOPISH.test(e.desc + ' ' + (e.raw || ''))) return false;
    var c = KL().categoryOf(e.desc, e.raw);
    return c.key === 'milk' || c.key === 'grocery' || c.key === 'veg' || SHOPISH.test(String(e.desc || '')) || !!KL().kitchenItemFor(e.desc, catalog());
  }
  // { items, auto } or null. Auto = one of your known baskets, at a shop, with no other item named in the description.
  function itemsFor(e) {
    if (!e) return null;
    if (saved[e.id]) return { items: saved[e.id], auto: false };
    if (!isGrocery(e)) return null;
    var named = KL().kitchenItemFor(String(e.desc || '').replace(/[^\w\s]/g, ' '), catalog());
    if (named && ['amul', 'a2', 'coffee'].indexOf(named.id) < 0) return null;
    var guess = KL().itemsFromPattern(e.amount, catalog(), learned());
    return guess ? { items: guess, auto: true } : null;
  }
  function skipped() { try { return JSON.parse(localStorage.getItem(SKIP_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function pending() {
    var since = Date.now() - 30 * 86400000, sk = skipped();
    return K.getEntries().filter(function (e) { return e.ts > since && !sk[e.id] && isGrocery(e) && !itemsFor(e); }).sort(function (a, b) { return b.ts - a.ts; });
  }
  function shopOf(e) { return K.cleanScopePrefix ? K.cleanScopePrefix(e.desc).replace(/\s*\(.*$/, '').trim() : e.desc; }

  /* ---------- "What did you buy?" ---------- */
  function openFill(e, queue) {
    var cat = catalog(), total = Number(e.amount), lines = [];
    var have = saved[e.id] || (itemsFor(e) || {}).items;
    if (have) lines = JSON.parse(JSON.stringify(have));
    else {   // the description already names items ("milk and paneer"): start with those
      KL().parseItemsText(String(K.cleanScopePrefix ? K.cleanScopePrefix(e.desc) : e.desc).replace(/\(.*$/, ''), cat).forEach(function (l) { if (!l.fresh) { l.amount = l.amount != null && l.amount <= total ? l.amount : null; lines.push(l); } });
      var open0 = lines.filter(function (l) { return l.amount == null; }), known0 = lines.reduce(function (t, l) { return t + (l.amount || 0); }, 0);
      if (open0.length === 1 && total - known0 > 0) open0[0].amount = Math.round((total - known0) * 100) / 100;
    }
    var back = el('div', 'modal-backdrop kt-back'), card = el('div', 'modal-card kt-sheet');
    back.appendChild(card); document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (ev) { if (ev.target === back) close(); });
    var usage = usageRank();
    function paint() {
      card.textContent = '';
      var head = el('div', 'kt-head');
      var ht = el('div'); ht.appendChild(el('b', null, '🧺 What did you buy?'));
      ht.appendChild(el('small', null, shopOf(e) + ' · ' + money(total) + ' · ' + dFmt.format(new Date(e.ts)) + ', ' + tFmt.format(new Date(e.ts)) + (queue && queue.length > 1 ? ' · ' + (queue.indexOf(e) + 1) + ' of ' + queue.length : '')));
      head.appendChild(ht);
      var x = el('button', 'kt-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', close); head.appendChild(x);
      card.appendChild(head);
      // one-tap guess: a basket you've told the app about with this amount
      var g = KL().itemsFromPattern(total, cat, learned());
      if (g && !lines.length) {
        var gb = el('button', 'kt-guess'); gb.type = 'button';
        gb.appendChild(el('span', null, '✨ ' + g.map(function (l) { return l.icon + ' ' + qtyText(l); }).join(' + ')));
        gb.appendChild(el('b', null, 'Use this'));
        gb.addEventListener('click', function () { lines = g; paint(); });
        card.appendChild(gb);
      }
      // the lines
      var list = el('div', 'kt-lines');
      if (!lines.length) list.appendChild(el('p', 'kt-hint', 'Tap what you bought below, or type it.'));
      lines.forEach(function (l, i) {
        var it = cat.filter(function (c) { return c.id === l.id; })[0] || l;
        var r = el('div', 'kt-line');
        r.appendChild(el('span', 'kt-ic', l.icon || '🛒'));
        var nm = el('span', 'kt-nm'); nm.appendChild(el('b', null, l.name)); r.appendChild(nm);
        var step = it.pack ? it.pack.size : (l.unit === 'kg' || l.unit === 'L' ? 0.25 : 1);
        var minus = el('button', 'kt-step', '−'); minus.type = 'button';
        var q = el('span', 'kt-q' + (qtyText(l) ? '' : ' unk'), qtyText(l) || 'qty?');
        var plus = el('button', 'kt-step', '+'); plus.type = 'button';
        function setQ(nq) { l.qty = Math.max(step, Math.round(nq * 1000) / 1000); if (it.pack) l.amount = Math.round(l.qty / it.pack.size * it.pack.price * 100) / 100; paint(); }
        minus.addEventListener('click', function () { setQ(l.qty == null ? step : l.qty - step); });
        plus.addEventListener('click', function () { setQ(l.qty == null ? step : l.qty + step); });
        r.appendChild(minus); r.appendChild(q); r.appendChild(plus);
        var amt = el('input', 'kt-amt'); amt.inputMode = 'decimal'; amt.placeholder = '₹'; amt.value = l.amount != null ? String(l.amount) : '';
        amt.addEventListener('change', function () { var n = Number(String(amt.value).replace(/[₹,\s]/g, '')); l.amount = isFinite(n) && n > 0 ? n : null; paint(); });
        r.appendChild(amt);
        var rm = el('button', 'kt-rm', '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Take ' + l.name + ' off'); rm.setAttribute('data-self-confirm', '');
        rm.addEventListener('click', function () { lines.splice(i, 1); paint(); });
        r.appendChild(rm);
        list.appendChild(r);
      });
      card.appendChild(list);
      var filled = lines.reduce(function (t, l) { return t + (l.amount || 0); }, 0), left = Math.round((total - filled) * 100) / 100;
      var bar = el('div', 'kt-left' + (left < 0 ? ' over' : left === 0 ? ' done' : ''));
      bar.textContent = left === 0 ? '✓ All ' + money(total) + ' filled' : left > 0 ? money(left) + ' of ' + money(total) + ' not filled yet' + (lines.length ? ' · saved as "Other"' : '') : money(-left) + ' more than the payment';
      card.appendChild(bar);
      // add: chips + typing
      var chips = el('div', 'kt-chips');
      usage.slice(0, 14).forEach(function (it) {
        var c = el('button', 'kt-chip'); c.type = 'button'; c.textContent = (it.icon || '🛒') + ' ' + it.name + (it.pack ? ' ₹' + it.pack.price : '');
        c.addEventListener('click', function () {
          var ex = lines.filter(function (l) { return l.id === it.id; })[0];
          var rest = Math.max(0, total - lines.reduce(function (t, l) { return t + (l.amount || 0); }, 0));
          if (ex && it.pack) { ex.qty = Math.round(((ex.qty || 0) + it.pack.size) * 1000) / 1000; ex.amount = Math.round(ex.qty / it.pack.size * it.pack.price * 100) / 100; }
          else if (ex) { if (ex.amount == null && rest > 0) ex.amount = Math.round(rest * 100) / 100; }
          else lines.push({ id: it.id, name: it.name, icon: it.icon, qty: it.pack ? it.pack.size : null, unit: it.unit, amount: it.pack ? it.pack.price : (rest > 0 ? Math.round(rest * 100) / 100 : null) });
          paint();
        });
        chips.appendChild(c);
      });
      card.appendChild(chips);
      var tw = el('div', 'kt-type');
      var inp = el('input', 'input'); inp.placeholder = 'Or type: adrak 40, sabzi 250g 30, 10 coffee'; inp.setAttribute('aria-label', 'Type what you bought');
      var add = el('button', 'kt-add', 'Add'); add.type = 'button';
      function addTyped() {
        var got = KL().parseItemsText(inp.value, cat); if (!got.length) return;
        var rest = Math.max(0, total - lines.reduce(function (t, l) { return t + (l.amount || 0); }, 0));
        var noAmt = got.filter(function (l) { return l.amount == null; });
        if (noAmt.length === 1) noAmt[0].amount = Math.max(0, Math.round((rest - got.reduce(function (t, l) { return t + (l.amount || 0); }, 0)) * 100) / 100) || null;
        got.forEach(function (gl) {
          var ex = lines.filter(function (l) { return l.id === gl.id && (l.amount == null || l.qty == null); })[0];
          if (ex) { if (gl.amount != null) ex.amount = gl.amount; if (gl.qty != null) ex.qty = gl.qty; } else lines.push(gl);
        });
        inp.value = ''; paint();
        setTimeout(function () { var i2 = card.querySelector('.kt-type input'); if (i2) i2.focus(); }, 30);
      }
      add.addEventListener('click', addTyped);
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addTyped(); } });
      tw.appendChild(inp); tw.appendChild(add); card.appendChild(tw);
      // actions
      var acts = el('div', 'kt-acts');
      if (queue) {
        var skip = el('button', 'kt-skip', 'Skip'); skip.type = 'button';
        skip.addEventListener('click', function () { var s0 = skipped(); s0[e.id] = 1; try { localStorage.setItem(SKIP_KEY, JSON.stringify(s0)); } catch (er) {} next(); });
        acts.appendChild(skip);
      }
      if (saved[e.id]) {
        var clr = el('button', 'kt-skip', 'Clear items'); clr.type = 'button'; clr.setAttribute('aria-label', 'Remove the items of this spend');
        clr.addEventListener('click', function () { store(e.id, null).then(function () { refresh(); close(); K.toast('Items removed'); }); });
        acts.appendChild(clr);
      }
      var save = el('button', 'kt-save', 'Save items'); save.type = 'button'; save.disabled = !lines.length;
      save.addEventListener('click', function () {
        var out = lines.filter(function (l) { return l.qty > 0 || (l.qty == null && l.amount > 0) || (l.qty == null && l.amount == null); }).map(function (l) { return { id: l.id, name: l.name, icon: l.icon, qty: l.qty, unit: l.unit, amount: l.amount, fresh: l.fresh }; });
        var sum = out.reduce(function (t, l) { return t + (l.amount || 0); }, 0), rest = Math.round((total - sum) * 100) / 100;
        var noAmt = out.filter(function (l) { return l.amount == null; });
        if (noAmt.length && rest > 0) { var each = Math.round(rest / noAmt.length * 100) / 100; noAmt.forEach(function (l) { l.amount = each; }); rest = 0; }
        if (rest > 0.009) out.push({ id: 'other', name: 'Other', icon: '🛍️', qty: 1, unit: 'pc', amount: rest });
        addToCatalog(out);
        save.disabled = true;
        store(e.id, out).then(function () {
          rememberBasket(total, out.filter(function (l) { return l.id !== 'other'; }).length === out.length ? out : []);
          K.toast('🧺 Saved: ' + out.map(function (l) { return l.icon + ' ' + l.name; }).join(', '));
          refresh(); next();
        }, function () { save.disabled = false; K.toast('Could not save. Try again.'); });
      });
      acts.appendChild(save);
      card.appendChild(acts);
    }
    function next() {
      close();
      if (!queue) return;
      var rest = pending(); if (rest.length) openFill(rest[0], rest);
    }
    paint();
  }
  function qtyText(l) {
    if (l.qty == null || !(Number(l.qty) > 0)) return '';
    var q = Number(l.qty) || 0, u = l.unit;
    if (u === 'L' && q < 1) return Math.round(q * 1000) + ' ml';
    if (u === 'kg' && q < 1) return Math.round(q * 1000) + ' g';
    if (u === 'pkt') return q + (q === 1 ? ' pkt' : ' pkts');
    if (u === 'pc') return q + ' pc';
    return (Math.round(q * 100) / 100) + ' ' + u;
  }
  // items you buy most first, then the rest of the list
  function usageRank() {
    var n = {}; Object.keys(saved).forEach(function (k) { (saved[k] || []).forEach(function (l) { n[l.id] = (n[l.id] || 0) + 1; }); });
    return catalog().slice().sort(function (a, b) { return (n[b.id] || 0) - (n[a.id] || 0) || (b.pack ? 1 : 0) - (a.pack ? 1 : 0); });
  }

  /* ---------- on a spend row: what it was ---------- */
  function decorate(dSpan, e) {
    var got = itemsFor(e);
    if (!got && !isGrocery(e)) return;
    var b = el('span', 'kt-badge' + (got ? (got.auto ? ' auto' : ' done') : ' ask')); b.setAttribute('role', 'button'); b.tabIndex = 0;   // the row is a button already
    b.textContent = got ? (got.auto ? '✨ ' : '') + got.items.filter(function (l) { return l.id !== 'other'; }).map(function (l) { return l.icon + ' ' + qtyText(l); }).join(' · ') || '🛍️ Other' : '🧺 + items';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); openFill(e, null); });
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); ev.preventDefault(); openFill(e, null); } });
    dSpan.appendChild(b);
  }

  /* ---------- Home: spends waiting for their items ---------- */
  function homeNudge() {
    var old = $('kt-nudge'); if (old) old.remove();
    var st = K.state || {}, sw = $('stream-switcher');
    if (!sw || (st.activeStream || 'spends') !== 'spends') return;
    var list = pending(); if (!list.length) return;
    var box = el('section', 'kt-nudge'); box.id = 'kt-nudge';
    var t = el('div', 'kt-nudge-t');
    t.appendChild(el('b', null, '🧺 What did you buy?'));
    t.appendChild(el('small', null, list.length + ' grocery spend' + (list.length === 1 ? '' : 's') + ' to fill · latest ' + shopOf(list[0]) + ' ' + money(list[0].amount)));
    box.appendChild(t);
    var go = el('button', 'kt-nudge-go', 'Fill now'); go.type = 'button';
    go.addEventListener('click', function () { openFill(list[0], list); });
    box.appendChild(go);
    // inside Home's own section, so it can never show on another page
    var home = $('spends-view'), ap = $('ap-nudges');
    if (ap && ap.parentNode === home) home.insertBefore(box, ap.nextSibling); else if (home) home.insertBefore(box, home.firstChild); else sw.parentNode.insertBefore(box, sw);
  }

  /* ---------- the Kitchen page ---------- */
  var ui = { month: 0 };
  function monthRange(off) { var n = new Date(); var a = new Date(n.getFullYear(), n.getMonth() - off, 1), b = new Date(n.getFullYear(), n.getMonth() - off + 1, 1); return [a.getTime(), b.getTime(), a]; }
  function rows() { return K.getEntries().map(function (e) { var g = itemsFor(e); return g ? { ts: e.ts, items: g.items, e: e } : null; }).filter(Boolean); }
  function render() {
    var root = $('kitchen-root'); if (!root) return;
    var sec = $('kitchen-sec'); if (sec && sec.hidden) return;
    root.textContent = '';
    var r0 = monthRange(ui.month), r1 = monthRange(ui.month + 1), all = rows(), now = Date.now();
    var cur = KL().summarizeItems(all, r0[0], r0[1], now), prev = KL().summarizeItems(all, r1[0], r1[1], now);
    var groc = K.getEntries().filter(function (e) { return e.ts >= r0[0] && e.ts < r0[1] && isGrocery(e); });
    var grocSum = groc.reduce(function (t, e) { return t + Number(e.amount); }, 0), open = groc.filter(function (e) { return !itemsFor(e); });
    var mFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
    // hero
    var hero = el('section', 'kt-hero');
    var tabs = el('div', 'kt-tabs');
    [[0, 'This month'], [1, 'Last month'], [2, '2 months ago']].forEach(function (x) {
      var b = el('button', 'kt-tab' + (ui.month === x[0] ? ' on' : ''), x[1]); b.type = 'button';
      b.addEventListener('click', function () { ui.month = x[0]; render(); }); tabs.appendChild(b);
    });
    hero.appendChild(tabs);
    hero.appendChild(el('div', 'ap-k', '🧺 GROCERIES · ' + mFmt.format(r0[2]).toUpperCase()));
    hero.appendChild(el('div', 'ap-big', money(grocSum)));
    hero.appendChild(el('p', 'ap-sub', groc.length + ' grocery spends · ' + cur.length + ' items tracked' + (open.length ? ' · ' + open.length + ' still to fill (' + money(open.reduce(function (t, e) { return t + Number(e.amount); }, 0)) + ')' : ' · all filled ✓')));
    if (open.length) {
      var fb = el('button', 'kt-nudge-go', '🧺 Fill ' + open.length + ' now'); fb.type = 'button';
      fb.addEventListener('click', function () { var q = open.slice().sort(function (a, b) { return b.ts - a.ts; }); openFill(q[0], q); });
      hero.appendChild(fb);
    }
    root.appendChild(hero);
    // what is about to run out
    var soon = cur.concat(prev.filter(function (p) { return !cur.some(function (c) { return c.id === p.id; }); }))
      .filter(function (x) { return x.nextTs && x.id !== 'other' && x.nextTs < now + 3 * 86400000; }).sort(function (a, b) { return a.nextTs - b.nextTs; }).slice(0, 6);
    if (ui.month === 0 && soon.length) {
      var sc = el('section', 'ap-card');
      var sh = el('div', 'ap-h'); sh.appendChild(el('span', null, '🛒 Likely to need soon')); sc.appendChild(sh);
      soon.forEach(function (x) {
        var r = el('div', 'kt-soon'); r.appendChild(el('span', null, x.icon + ' ' + x.name));
        var d = Math.round((x.nextTs - now) / 86400000);
        r.appendChild(el('b', null, d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days'));
        sc.appendChild(r);
      });
      sc.appendChild(el('p', 'ap-muted', 'From how often you have bought each one.'));
      root.appendChild(sc);
    }
    // items
    var ic = el('section', 'ap-card');
    var ih = el('div', 'ap-h'); ih.appendChild(el('span', null, '🥛 What you used')); ih.appendChild(el('small', null, 'vs ' + new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(r1[2]))); ic.appendChild(ih);
    if (!cur.length) ic.appendChild(el('p', 'ap-muted', 'Nothing itemized this month yet. Fill a few grocery spends and each item shows up here with how much you used.'));
    var max = Math.max.apply(null, cur.map(function (x) { return x.amount; }).concat([1]));
    cur.forEach(function (x) {
      var p = prev.filter(function (y) { return y.id === x.id && y.unit === x.unit; })[0];
      var r = el('div', 'kt-item');
      r.appendChild(el('span', 'kt-ic big', x.icon || '🛒'));
      var mid = el('div', 'kt-mid');
      var top = el('div', 'kt-top'); top.appendChild(el('b', null, x.name)); if (qtyText(x)) top.appendChild(el('span', 'kt-qty', qtyText(x)));
      mid.appendChild(top);
      var bits = [];
      if (x.perUnit && x.id !== 'other') bits.push(money(x.perUnit) + '/' + (x.unit === 'pkt' ? 'pkt' : x.unit === 'pc' ? 'pc' : x.unit));
      if (x.perDay && x.perDay >= 0.01 && ui.month === 0 && x.unit !== 'pc' && x.unit !== 'dozen' && x.id !== 'other') bits.push('~' + qtyText({ qty: Math.round(x.perDay * 100) / 100, unit: x.unit }) + ' a day');
      if (!bits.length && x.buys) bits.push(x.buys + (x.buys === 1 ? ' buy' : ' buys'));
      if (x.everyDays) bits.push('every ' + (x.everyDays < 1.5 ? 'day' : Math.round(x.everyDays) + ' days'));
      if (p) { var dq = Math.round((x.qty - p.qty) * 100) / 100; if (dq && x.qty && p.qty) bits.push((dq > 0 ? '▲ ' : '▼ ') + qtyText({ qty: Math.abs(dq), unit: x.unit })); if (p.perUnit && x.perUnit && Math.abs(x.perUnit - p.perUnit) >= 0.5) bits.push('price ' + (x.perUnit > p.perUnit ? '▲' : '▼') + ' ' + money(Math.abs(x.perUnit - p.perUnit))); }
      mid.appendChild(el('small', null, bits.join(' · ')));
      var bar = el('div', 'kt-bar'), f = el('i'); f.style.width = Math.max(3, Math.round(x.amount / max * 100)) + '%'; bar.appendChild(f); mid.appendChild(bar);
      r.appendChild(mid);
      r.appendChild(el('b', 'kt-money', money(x.amount)));
      ic.appendChild(r);
    });
    root.appendChild(ic);
    // prices you told the app
    var pc = el('section', 'ap-card');
    var ph = el('div', 'ap-h'); ph.appendChild(el('span', null, '🏷️ Pack prices')); ph.appendChild(el('small', null, 'tap to change')); pc.appendChild(ph);
    catalog().filter(function (it) { return it.pack; }).forEach(function (it) {
      var r = el('button', 'kt-price'); r.type = 'button';
      r.appendChild(el('span', null, it.icon + ' ' + it.name)); r.appendChild(el('b', null, money(it.pack.price) + ' / ' + qtyText({ qty: it.pack.size, unit: it.unit })));
      r.addEventListener('click', function () {
        K.inputBox({ title: it.icon + ' ' + it.name, message: 'Price of one pack (' + qtyText({ qty: it.pack.size, unit: it.unit }) + '). Known amounts and new fills use it.',
          fields: [{ label: 'Price (₹)', value: String(it.pack.price), inputmode: 'decimal' }], confirmText: 'Save price',
          onConfirm: function (v) {
            var n = Number(String(v[0] || '').replace(/[₹,\s]/g, '')); if (!(n > 0)) return;
            var extra = jsonKv(CAT_KEY, []); if (!Array.isArray(extra)) extra = [];
            var row = extra.filter(function (z) { return z.id === it.id; })[0];
            if (row) row.pack = { size: it.pack.size, price: n }; else extra.push({ id: it.id, pack: { size: it.pack.size, price: n } });
            K.kvSet(CAT_KEY, JSON.stringify(extra)); K.toast(it.name + ' now ' + money(n)); render();
          } });
      });
      pc.appendChild(r);
    });
    var addP = el('button', 'ap-more', '＋ Add a packed item (name, pack size, price)'); addP.type = 'button';
    addP.addEventListener('click', function () {
      K.inputBox({ title: '🏷️ New packed item', message: 'Things you buy at a fixed price, like Amul milk.', fields: [{ label: 'Name', placeholder: 'e.g. Mother Dairy toned milk' }, { label: 'Pack size', placeholder: 'e.g. 500 ml, 1 kg, 1 pkt' }, { label: 'Price (₹)', placeholder: 'e.g. 30', inputmode: 'decimal' }], confirmText: 'Add item',
        onConfirm: function (v) {
          var name = String(v[0] || '').trim().slice(0, 30), m = /(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pkt|pc|dozen)?/i.exec(String(v[1] || '')), price = Number(String(v[2] || '').replace(/[₹,\s]/g, ''));
          if (!name || !m || !(price > 0)) { K.toast('Add a name, a pack size and a price'); return; }
          var u = (m[2] || 'pkt').toLowerCase(), size = Number(m[1]), unit = u === 'g' ? 'kg' : u === 'ml' ? 'L' : u === 'l' ? 'L' : u;
          if (u === 'g' || u === 'ml') size = size / 1000;
          var extra = jsonKv(CAT_KEY, []); if (!Array.isArray(extra)) extra = [];
          extra.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24), name: name, icon: unit === 'L' ? '🥛' : '🛒', unit: unit, pack: { size: size, price: price }, words: [name.toLowerCase()] });
          K.kvSet(CAT_KEY, JSON.stringify(extra)); K.toast(name + ' added'); render();
        } });
    });
    pc.appendChild(addP);
    root.appendChild(pc);
  }
  function refresh() { if (K.rerender) K.rerender(); else { homeNudge(); render(); } }

  window.__kitchen = { decorate: decorate, itemsFor: itemsFor, openFill: openFill, pending: pending, render: render };
  document.addEventListener('kharcha:render', function () { load(); homeNudge(); render(); });
  document.addEventListener('kharcha:kitchen', function () { load(); render(); });
})();
