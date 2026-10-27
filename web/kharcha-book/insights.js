/* Kharcha Book v70: Insights screen (More > Insights). Net worth, weekly story, streak and savings goal, spending heatmap.
   Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var DAY = 86400000;
  var dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
  var wFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  var mFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  function money(v) { return K.money(Math.round(v * 100) / 100); }
  function rupees(v) { return K.money(Math.round(v)); }
  function sod(ts) { return K.startOfDay(ts); }
  function spends() { return (K.getEntries ? K.getEntries() : []).filter(function (e) { return e && !e.synthetic && K.isExpense(e); }); }
  function sum(list) { return list.reduce(function (n, e) { return n + Math.round(e.amount * 100); }, 0) / 100; }

  /* ---------- net worth ---------- */
  function sparkline(points) {
    var W = 300, H = 60, pad = 4, ns = 'http://www.w3.org/2000/svg';
    var min = Infinity, max = -Infinity;
    points.forEach(function (p) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; });
    if (!isFinite(min)) return null;
    if (max - min < 1) { max = min + 1; }
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'nw-spark'); svg.setAttribute('aria-hidden', 'true');
    var d = points.map(function (p, i) {
      var x = pad + (i / (points.length - 1)) * (W - pad * 2), y = H - pad - ((p.v - min) / (max - min)) * (H - pad * 2);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    var area = document.createElementNS(ns, 'path'); area.setAttribute('d', d + ' L' + (W - pad) + ' ' + H + ' L' + pad + ' ' + H + ' Z'); area.setAttribute('class', 'nw-area'); svg.appendChild(area);
    var line = document.createElementNS(ns, 'path'); line.setAttribute('d', d); line.setAttribute('class', 'nw-line'); line.setAttribute('fill', 'none'); svg.appendChild(line);
    return svg;
  }
  function netWorthCard() {
    var p = K.getNetWorthParts(), card = el('section', 'in-card nw-card');
    card.appendChild(el('div', 'in-k', 'NET WORTH'));
    card.appendChild(el('div', 'in-big', money(p.total)));
    var first = p.trend.length ? p.trend[0].v : null;
    if (first != null && p.hasBank) {
      var diff = p.total - first;
      card.appendChild(el('div', 'in-sub', (diff >= 0 ? '▲ ' : '▼ ') + rupees(Math.abs(diff)) + ' in the last 30 days (estimate)'));
      var sp = sparkline(p.trend); if (sp) card.appendChild(sp);
    }
    var rows = [['🏦', 'In your banks', p.bank, p.hasBank], ['💵', 'Cash at home', p.cash, p.cash > 0], ['👛', 'Wallets', p.wallets, p.wallets !== 0], ['🤝', 'Friends owe you', p.owedToMe, p.owedToMe > 0], ['📤', 'You owe', -p.iOwe, p.iOwe > 0]];
    var ul = el('div', 'nw-rows');
    rows.forEach(function (r) {
      if (!r[3]) return;
      var row = el('div', 'nw-row'); row.appendChild(el('span', null, r[0] + ' ' + r[1])); row.appendChild(el('b', r[2] < 0 ? 'neg' : '', (r[2] < 0 ? '− ' : '') + money(Math.abs(r[2])))); ul.appendChild(row);
    });
    if (!ul.children.length) ul.appendChild(el('div', 'in-sub', 'Track a bank account (More > Bank) to see your net worth.'));
    card.appendChild(ul);
    return card;
  }

  /* ---------- weekly story ---------- */
  function weekFacts() {
    var now = Date.now(), t0 = sod(now), all = spends();
    var w1 = all.filter(function (e) { return e.ts >= t0 - 6 * DAY && e.ts <= now; });
    var w0 = all.filter(function (e) { return e.ts >= t0 - 13 * DAY && e.ts < t0 - 6 * DAY; });
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var s0 = t0 - i * DAY, list = w1.filter(function (e) { return e.ts >= s0 && e.ts < s0 + DAY; });
      days.push({ ts: s0, total: sum(list), dow: new Date(s0).getDay() });
    }
    var total = sum(w1), prev = sum(w0), cats = w1.length ? K.categoryBreakdown(w1).categories : [];
    var biggest = w1.slice().sort(function (a, b) { return b.amount - a.amount; })[0] || null;
    var priciest = days.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var we = days.filter(function (d) { return d.dow === 0 || d.dow === 6; }), wd = days.filter(function (d) { return d.dow !== 0 && d.dow !== 6; });
    var weAvg = we.length ? sum(we.map(function (d) { return { amount: d.total }; })) / we.length : 0, wdAvg = wd.length ? sum(wd.map(function (d) { return { amount: d.total }; })) / wd.length : 0;
    return { total: total, prev: prev, days: days, cats: cats, biggest: biggest, priciest: priciest, weAvg: weAvg, wdAvg: wdAvg, count: w1.length };
  }
  function tipFor(f) {
    var top = f.cats[0];
    if (f.prev > 0 && f.total > f.prev * 1.25) return 'Spending is up ' + Math.round((f.total / f.prev - 1) * 100) + '% on last week' + (top ? '. ' + top.name + ' is the biggest part.' : '.');
    if (top && top.pct >= 40) return top.name + ' is ' + top.pct + '% of your week. A small cut there moves the total the most.';
    if (f.weAvg > f.wdAvg * 1.5 && f.wdAvg > 0) return 'Weekends cost you more: ' + rupees(f.weAvg) + ' a day against ' + rupees(f.wdAvg) + ' on weekdays.';
    if (f.prev > 0 && f.total < f.prev * 0.8) return 'Nice: ' + rupees(f.prev - f.total) + ' less than last week. Keep it going.';
    return 'A steady week. Logging every spend keeps these numbers true.';
  }
  function weeklyStory() {
    var f = weekFacts(), wrap = el('section', 'in-story-wrap');
    wrap.appendChild(el('div', 'in-h', '📖 Your week'));
    var rail = el('div', 'story-rail');
    if (!f.count) {
      var empty = el('div', 'story-card'); empty.appendChild(el('div', 'in-k', 'LAST 7 DAYS')); empty.appendChild(el('div', 'in-sub', 'No spends in the last 7 days yet. Add a few and your week story appears here.')); rail.appendChild(empty);
      wrap.appendChild(rail); return wrap;
    }
    // 1 total
    var c1 = el('div', 'story-card s1'); c1.appendChild(el('div', 'in-k', 'LAST 7 DAYS')); c1.appendChild(el('div', 'in-big', money(f.total)));
    if (f.prev > 0) { var pc = Math.round((f.total / f.prev - 1) * 100); c1.appendChild(el('div', 'in-sub', (pc > 0 ? '▲ ' : '▼ ') + Math.abs(pc) + '% vs the 7 days before (' + rupees(f.prev) + ')')); } else c1.appendChild(el('div', 'in-sub', f.count + ' spends'));
    var bars = el('div', 'story-bars'), mx = Math.max.apply(null, f.days.map(function (d) { return d.total; })) || 1;
    f.days.forEach(function (d) { var b = el('div', 'sb'), i = el('i'); i.style.height = Math.max(4, Math.round((d.total / mx) * 100)) + '%'; b.appendChild(i); b.appendChild(el('span', null, 'SMTWTFS'[d.dow])); bars.appendChild(b); });
    c1.appendChild(bars); rail.appendChild(c1);
    // 2 where it went
    var c2 = el('div', 'story-card s2'); c2.appendChild(el('div', 'in-k', 'WHERE IT WENT'));
    f.cats.slice(0, 4).forEach(function (c) {
      var r = el('div', 'cat-row'); r.appendChild(el('span', null, c.name)); r.appendChild(el('b', null, rupees(c.total) + ' · ' + c.pct + '%'));
      var bar = el('div', 'cat-bar'), fill = el('i'); fill.style.width = c.pct + '%'; bar.appendChild(fill); c2.appendChild(r); c2.appendChild(bar);
    });
    rail.appendChild(c2);
    // 3 biggest moment
    var c3 = el('div', 'story-card s3'); c3.appendChild(el('div', 'in-k', 'BIGGEST MOMENT'));
    if (f.biggest) { c3.appendChild(el('div', 'in-big', money(f.biggest.amount))); c3.appendChild(el('div', 'in-sub', String(f.biggest.desc || '').replace(/^[^\wऀ-ॿ]+/, '') + ' · ' + dFmt.format(new Date(f.biggest.ts)))); }
    c3.appendChild(el('div', 'in-sub strong', 'Priciest day: ' + wFmt.format(new Date(f.priciest.ts)) + ' (' + rupees(f.priciest.total) + ')'));
    rail.appendChild(c3);
    // 4 tip
    var c4 = el('div', 'story-card s4'); c4.appendChild(el('div', 'in-k', 'ONE THING')); c4.appendChild(el('div', 'in-tip', '💡 ' + tipFor(f))); rail.appendChild(c4);
    wrap.appendChild(rail);
    var dots = el('div', 'story-dots'); for (var i = 0; i < rail.children.length; i++) dots.appendChild(el('i', i === 0 ? 'on' : ''));
    wrap.appendChild(dots);
    rail.addEventListener('scroll', function () {
      var idx = Math.round(rail.scrollLeft / (rail.firstChild.offsetWidth + 10));
      Array.prototype.forEach.call(dots.children, function (d, k) { d.className = k === idx ? 'on' : ''; });
    }, { passive: true });
    return wrap;
  }

  /* ---------- streak ---------- */
  function streakCard() {
    var f = K.getHomeFacts(), card = el('section', 'in-card');
    card.appendChild(el('div', 'in-k', 'STREAK'));
    var allowance = f.mode === 'budget' ? f.budget / 30 : (f.mode === 'bank' ? f.safe : 0);
    if (!(allowance > 0)) { card.appendChild(el('div', 'in-sub', 'Set a monthly budget or track your bank and the app counts the days you stay inside your daily limit.')); return card; }
    var now = Date.now(), t0 = sod(now), all = spends(), flags = [];
    for (var i = 0; i < 60; i++) {
      var s0 = t0 - i * DAY, tot = sum(all.filter(function (e) { return e.ts >= s0 && e.ts < s0 + DAY; }));
      flags.push({ ts: s0, ok: tot <= allowance, tot: tot });
    }
    var cur = 0, started = flags[0].ok ? 0 : 1;                       // today still counts if it is fine so far, otherwise start from yesterday
    for (var j = started; j < flags.length && flags[j].ok; j++) cur++;
    var best = 0, run = 0; flags.slice().reverse().forEach(function (d) { run = d.ok ? run + 1 : 0; if (run > best) best = run; });
    var big = el('div', 'in-big'); big.appendChild(document.createTextNode('🔥 ' + cur)); big.appendChild(el('span', 'in-per', cur === 1 ? ' day' : ' days')); card.appendChild(big);
    card.appendChild(el('div', 'in-sub', 'under ' + rupees(allowance) + ' a day. Best run in 60 days: ' + best + '.'));
    var dots = el('div', 'streak-dots'); flags.slice(0, 21).reverse().forEach(function (d) { var i2 = el('i', d.ok ? 'ok' : 'over'); i2.title = dFmt.format(new Date(d.ts)) + ': ' + rupees(d.tot); dots.appendChild(i2); }); card.appendChild(dots);
    return card;
  }

  /* ---------- savings goal ---------- */
  var GOAL_KEY = 'kharcha_goal';
  function loadGoal() { try { var g = JSON.parse(K.kvGet(GOAL_KEY) || 'null'); if (g && g.target > 0 && Array.isArray(g.adds)) return g; } catch (e) {} return null; }
  function saveGoal(g) { if (g) K.kvSet(GOAL_KEY, JSON.stringify(g)); else K.kvSet(GOAL_KEY, 'null'); }
  function num(v) { var n = Number(String(v || '').replace(/[,₹\s]/g, '')); return isFinite(n) && n > 0 && n < 1e10 ? n : null; }
  function ring(pct) {
    var ns = 'http://www.w3.org/2000/svg', R = 40, C = 2 * Math.PI * R, svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'goal-ring'); svg.setAttribute('aria-hidden', 'true');
    var bg = document.createElementNS(ns, 'circle'); bg.setAttribute('cx', 50); bg.setAttribute('cy', 50); bg.setAttribute('r', R); bg.setAttribute('class', 'gr-bg'); svg.appendChild(bg);
    var fg = document.createElementNS(ns, 'circle'); fg.setAttribute('cx', 50); fg.setAttribute('cy', 50); fg.setAttribute('r', R); fg.setAttribute('class', 'gr-fg'); fg.setAttribute('transform', 'rotate(-90 50 50)');
    fg.setAttribute('stroke-dasharray', C.toFixed(1)); fg.setAttribute('stroke-dashoffset', (C * (1 - Math.min(1, pct / 100))).toFixed(1)); svg.appendChild(fg);
    var tx = document.createElementNS(ns, 'text'); tx.setAttribute('x', 50); tx.setAttribute('y', 56); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'gr-t'); tx.textContent = Math.round(pct) + '%'; svg.appendChild(tx);
    return svg;
  }
  var goalUi = { edit: false };
  function goalCard(rerender) {
    var card = el('section', 'in-card'), g = loadGoal();
    card.appendChild(el('div', 'in-k', 'SAVINGS GOAL'));
    function field(label, input) { var w = el('div', 'field'); w.appendChild(el('label', null, label)); w.appendChild(input); return w; }
    function form(cur) {
      var f = el('form', 'udh-editform'); f.noValidate = true;
      var nm = el('input', 'input'); nm.maxLength = 30; nm.value = cur ? cur.name : ''; nm.placeholder = 'e.g. Emergency fund';
      var tg = el('input', 'input'); tg.inputMode = 'decimal'; tg.value = cur ? String(cur.target) : ''; tg.placeholder = 'Target, e.g. 50000';
      var er = el('p', 'err'); er.hidden = true;
      var row = el('div', 'add-row'); row.appendChild(field('Goal', nm)); row.appendChild(field('Target (₹)', tg));
      var btns = el('div', 'edit-btns'), ok = el('button', 'primary small', 'Save'); ok.type = 'submit'; btns.appendChild(ok);
      if (cur) { var cx = el('button', 'ghost', 'Cancel'); cx.type = 'button'; cx.addEventListener('click', function () { goalUi.edit = false; rerender(); }); btns.appendChild(cx); }
      f.appendChild(row); f.appendChild(er); f.appendChild(btns);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var t = num(tg.value), name = nm.value.trim().slice(0, 30);
        if (!name) { er.textContent = 'Give the goal a name.'; er.hidden = false; return; }
        if (!t) { er.textContent = 'Enter a target amount, like 50000.'; er.hidden = false; return; }
        var before = K.kvGet(GOAL_KEY);
        saveGoal({ name: name, target: t, adds: cur ? cur.adds : [] }); goalUi.edit = false; rerender();
        K.toast('Goal saved', function () { K.kvSet(GOAL_KEY, before == null ? 'null' : before); rerender(); });
      });
      return f;
    }
    if (!g) { card.appendChild(el('div', 'in-sub', 'Pick something to save for. Add money to it whenever you set some aside.')); card.appendChild(form(null)); return card; }
    var saved = sum(g.adds.map(function (a) { return { amount: a.amount }; })), pct = Math.min(100, (saved / g.target) * 100);
    var top = el('div', 'goal-top'); top.appendChild(ring(pct));
    var tx = el('div', 'goal-tx'); tx.appendChild(el('b', null, g.name)); tx.appendChild(el('div', 'in-sub', money(saved) + ' of ' + money(g.target)));
    tx.appendChild(el('div', 'in-sub', saved >= g.target ? '🎉 Goal reached!' : rupees(g.target - saved) + ' to go')); top.appendChild(tx); card.appendChild(top);
    if (goalUi.edit) { card.appendChild(form(g)); return card; }
    var af = el('form', 'goal-add'); af.noValidate = true;
    var ai = el('input', 'input'); ai.inputMode = 'decimal'; ai.placeholder = 'Add money ₹'; ai.setAttribute('aria-label', 'Amount to add to the goal');
    var ab = el('button', 'primary small', 'Add'); ab.type = 'submit'; af.appendChild(ai); af.appendChild(ab); card.appendChild(af);
    af.addEventListener('submit', function (ev) {
      ev.preventDefault(); var n = num(ai.value); if (!n) { ai.focus(); return; }
      var before = K.kvGet(GOAL_KEY), next = Object.assign({}, g, { adds: g.adds.concat([{ id: Date.now().toString(36), ts: Date.now(), amount: n }]) });
      saveGoal(next); rerender(); K.toast(money(n) + ' added to ' + g.name, function () { K.kvSet(GOAL_KEY, before); rerender(); });
    });
    g.adds.slice(-3).reverse().forEach(function (a) {
      var r = el('div', 'goal-add-row'); r.appendChild(el('span', null, dFmt.format(new Date(a.ts)) + ' · ' + money(a.amount)));
      var x = el('button', 'udh-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove this amount');
      x.addEventListener('click', function () {
        var before = K.kvGet(GOAL_KEY); saveGoal(Object.assign({}, g, { adds: g.adds.filter(function (y) { return y.id !== a.id; }) })); rerender();
        K.toast('Removed', function () { K.kvSet(GOAL_KEY, before); rerender(); });
      });
      r.appendChild(x); card.appendChild(r);
    });
    var tools = el('div', 'edit-btns');
    var ed = el('button', 'ghost', 'Edit goal'); ed.type = 'button'; ed.addEventListener('click', function () { goalUi.edit = true; rerender(); });
    var rm = el('button', 'ghost', 'Remove goal'); rm.type = 'button';
    rm.addEventListener('click', function () {
      K.confirmBox({ title: 'Remove this goal?', message: g.name + ' and the money you added to it will be removed.', onConfirm: function () {
        var before = K.kvGet(GOAL_KEY); saveGoal(null); rerender(); K.toast('Goal removed', function () { K.kvSet(GOAL_KEY, before); rerender(); });
      } });
    });
    tools.appendChild(ed); tools.appendChild(rm); card.appendChild(tools);
    return card;
  }

  /* ---------- heatmap ---------- */
  var hm = { month: null, day: null };
  function heatmapCard(rerender) {
    var card = el('section', 'in-card'), now = new Date();
    if (!hm.month) hm.month = { y: now.getFullYear(), m: now.getMonth() };
    var y = hm.month.y, m = hm.month.m, dim = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
    var head = el('div', 'hm-head');
    function navBtn(txt, delta) { var b = el('button', 'hm-nav', txt); b.type = 'button'; b.setAttribute('aria-label', delta < 0 ? 'Earlier month' : 'Later month'); b.addEventListener('click', function () { var d = new Date(y, m + delta, 1); hm.month = { y: d.getFullYear(), m: d.getMonth() }; hm.day = null; rerender(); }); return b; }
    head.appendChild(navBtn('‹', -1)); head.appendChild(el('b', null, '🗓️ ' + mFmt.format(new Date(y, m, 1)))); head.appendChild(navBtn('›', 1)); card.appendChild(head);
    var all = spends().filter(function (e) { var d = new Date(e.ts); return d.getFullYear() === y && d.getMonth() === m; }), per = {};
    all.forEach(function (e) { var d = new Date(e.ts).getDate(); (per[d] = per[d] || []).push(e); });
    var totals = Object.keys(per).map(function (d) { return sum(per[d]); }), mx = Math.max.apply(null, totals.concat([1]));
    var grid = el('div', 'hm-grid');
    'MTWTFSS'.split('').forEach(function (c) { grid.appendChild(el('span', 'hm-dow', c)); });
    for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'hm-blank'));
    for (var d = 1; d <= dim; d++) {
      var tot = per[d] ? sum(per[d]) : 0, lvl = !tot ? 0 : Math.min(4, 1 + Math.floor((tot / mx) * 3.999));
      var cell = el('button', 'hm-cell l' + lvl + (hm.day === d ? ' sel' : ''), String(d)); cell.type = 'button';
      cell.setAttribute('aria-label', dFmt.format(new Date(y, m, d)) + ': ' + (tot ? rupees(tot) : 'no spends'));
      cell.addEventListener('click', (function (dd) { return function () { hm.day = hm.day === dd ? null : dd; rerender(); }; })(d));
      grid.appendChild(cell);
    }
    card.appendChild(grid);
    var lg = el('div', 'hm-legend'); lg.appendChild(el('span', null, 'Less')); [0, 1, 2, 3, 4].forEach(function (l) { lg.appendChild(el('i', 'hm-cell l' + l)); }); lg.appendChild(el('span', null, 'More')); card.appendChild(lg);
    card.appendChild(el('div', 'in-sub', all.length ? mFmt.format(new Date(y, m, 1)) + ': ' + money(sum(all)) + ' over ' + Object.keys(per).length + ' days' : 'No spends in this month.'));
    if (hm.day && per[hm.day]) {
      var box = el('div', 'hm-day'); box.appendChild(el('div', 'in-k', dFmt.format(new Date(y, m, hm.day)).toUpperCase() + ' · ' + money(sum(per[hm.day]))));
      per[hm.day].slice().sort(function (a, b) { return b.amount - a.amount; }).forEach(function (e) {
        var r = el('div', 'sa-row'); r.appendChild(el('span', 'sa-d', new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(e.ts))));
        r.appendChild(el('span', 'sa-t', String(e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 34))); r.appendChild(el('span', 'sa-a', money(e.amount))); box.appendChild(r);
      }); card.appendChild(box);
    }
    return card;
  }


  /* ---------- where the money left from (this month / last month) ---------- */
  var srcUi = { back: 0 };
  function mkey(offset) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth() - offset, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function sourcesCard(rerender) {
    var card = el('section', 'in-card'), head = el('div', 'hm-head');
    head.appendChild(el('b', null, '🏦 Where it left from'));
    var tog = el('div', 'theme-row');
    [[0, 'This month'], [1, 'Last month']].forEach(function (o) {
      var b = el('button', 'scope-pill' + (srcUi.back === o[0] ? ' active' : ''), o[1]); b.type = 'button';
      b.addEventListener('click', function () { srcUi.back = o[0]; rerender(); }); tog.appendChild(b);
    });
    card.appendChild(head); card.appendChild(tog);
    var d = K.getSpendSources(mkey(srcUi.back));
    if (!d.list.length) { card.appendChild(el('div', 'in-sub', 'No spends in this month.')); return card; }
    card.appendChild(el('div', 'in-sub', money(d.total) + ' spent in total'));
    d.list.forEach(function (c) {
      var r = el('div', 'cat-row dk'); r.appendChild(el('span', null, c.icon + ' ' + c.name)); r.appendChild(el('b', null, rupees(c.total) + ' · ' + c.pct + '%'));
      var bar = el('div', 'cat-bar dk'), fill = el('i'); fill.style.width = Math.max(2, c.pct) + '%'; bar.appendChild(fill); card.appendChild(r); card.appendChild(bar);
    });
    return card;
  }

  /* ---------- month report as an image ---------- */
  function wrapText(ctx, text, maxW) { var words = String(text).split(' '), line = '', out = []; words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }); if (line) out.push(line); return out; }
  function drawReport(key) {
    var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'), entries = K.getEntries().filter(function (e) { return e && !e.synthetic; });
    var parts = key.split('-'), y = +parts[0], m = +parts[1] - 1, label = mFmt.format(new Date(y, m, 1));
    var spendList = entries.filter(function (e) { return K.isExpense(e) && new Date(e.ts).getFullYear() === y && new Date(e.ts).getMonth() === m; });
    var total = sum(spendList), cats = spendList.length ? K.categoryBreakdown(spendList).categories : [];
    var sm = K.getMonthlySummary(entries, key);
    var g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f172a'); g.addColorStop(0.55, '#312e81'); g.addColorStop(1, '#0f766e'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.arc(W - 120, 160, 360, 0, 6.283); c.fill();
    var F = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillStyle = '#fff'; c.font = '700 44px ' + F; c.fillText('Kharcha Book', 70, 120);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '500 36px ' + F; c.fillText(label + ' report', 70, 176);
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.font = '600 28px ' + F; c.fillText('SPENT', 70, 290);
    c.fillStyle = '#fff'; c.font = '800 120px ' + F; c.fillText(money(total), 70, 410);
    var yy = 480;
    if (sm.salaries > 0) {
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(70, yy, W - 140, 150);
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '600 26px ' + F; c.fillText('SALARY IN', 100, yy + 52); c.fillText('SAVED', 560, yy + 52);
      c.fillStyle = '#fff'; c.font = '700 48px ' + F; c.fillText(rupees(sm.salaries), 100, yy + 112);
      c.fillStyle = sm.savings >= 0 ? '#6ee7b7' : '#fca5a5'; c.fillText(rupees(sm.savings) + (sm.savingsRate != null ? '  (' + Math.round(sm.savingsRate) + '%)' : ''), 560, yy + 112);
      yy += 200;
    }
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.font = '600 28px ' + F; c.fillText('WHERE IT WENT', 70, yy + 20);
    yy += 74;
    cats.slice(0, 5).forEach(function (cat) {
      c.fillStyle = '#fff'; c.font = '600 34px ' + F; c.fillText(String(cat.name).slice(0, 26), 70, yy);
      c.textAlign = 'right'; c.fillText(rupees(cat.total) + '  ' + cat.pct + '%', W - 70, yy); c.textAlign = 'left';
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(70, yy + 14, W - 140, 12); c.fillStyle = '#fbbf24'; c.fillRect(70, yy + 14, Math.max(8, (W - 140) * cat.pct / 100), 12);
      yy += 70;
    });
    // daily bars
    var dim = new Date(y, m + 1, 0).getDate(), per = [], mx = 1;
    for (var d = 1; d <= dim; d++) { var t = sum(spendList.filter(function (e) { return new Date(e.ts).getDate() === d; })); per.push(t); if (t > mx) mx = t; }
    var bx = 70, bw = (W - 140) / dim, base = H - 125;
    per.forEach(function (t, i) { var h = Math.max(4, (t / mx) * 100); c.fillStyle = t ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)'; c.fillRect(bx + i * bw + 2, base - h, bw - 4, h); });
    var big = spendList.slice().sort(function (a, b) { return b.amount - a.amount; })[0];
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = '500 28px ' + F;
    if (big) { var line = 'Biggest: ' + money(big.amount) + ' · ' + String(big.desc).replace(/^[^\wऀ-ॿ]+/, '').slice(0, 30); wrapText(c, line, W - 140).slice(0, 1).forEach(function (l) { c.fillText(l, 70, H - 90); }); }
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.font = '500 24px ' + F; c.fillText('Made with Kharcha Book', 70, H - 40);
    return cv;
  }
  function reportCard() {
    var card = el('section', 'in-card');
    card.appendChild(el('div', 'in-k', 'MONTH REPORT'));
    card.appendChild(el('div', 'in-sub', 'A picture of the month to keep or share: spent, saved, where it went, day by day.'));
    var row = el('div', 'theme-row');
    [[0, 'This month'], [1, 'Last month']].forEach(function (o) {
      var b = el('button', 'primary small', '📤 ' + o[1]); b.type = 'button'; b.addEventListener('click', function () { showReport(mkey(o[0])); }); row.appendChild(b);
    });
    card.appendChild(row);
    return card;
  }
  function showReport(key) {
    var cv = drawReport(key), back = el('div', 'tour'), box = el('div', 'tour-card rep-box');
    back.appendChild(box);
    var img = el('img', 'rep-img'); img.alt = 'Month report'; box.appendChild(img);
    var btns = el('div', 'tour-btns'), close = el('button', 'ghost', 'Close'); close.type = 'button'; close.addEventListener('click', function () { back.remove(); });
    var go = el('button', 'primary', 'Share or save'); go.type = 'button'; btns.appendChild(close); btns.appendChild(go); box.appendChild(btns);
    cv.toBlob(function (blob) {
      if (!blob) { K.toast('Could not make the picture'); back.remove(); return; }
      var url = URL.createObjectURL(blob); img.src = url;
      go.addEventListener('click', function () {
        var file = null; try { file = new File([blob], 'kharcha-' + key + '.png', { type: 'image/png' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Kharcha Book ' + key }).catch(function () {}); return; }
        var a = document.createElement('a'); a.href = url; a.download = 'kharcha-' + key + '.png'; document.body.appendChild(a); a.click(); a.remove();
      });
    }, 'image/png');
    back.addEventListener('click', function (ev) { if (ev.target === back) back.remove(); });
    document.body.appendChild(back);
  }

  /* ---------- your data: backup and restore ---------- */
  function dataCard() {
    var card = el('section', 'in-card');
    card.appendChild(el('div', 'in-k', 'YOUR DATA'));
    card.appendChild(el('div', 'in-sub', 'Keep a copy of every entry and setting in one file, and put it back later. Restoring never duplicates entries you already have.'));
    var row = el('div', 'theme-row');
    var dl = el('button', 'primary small', '💾 Download backup'); dl.type = 'button';
    dl.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(K.backupData())], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kharcha-backup-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
      K.toast('Backup downloaded');
    });
    var file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    var rs = el('button', 'ghost', '♻️ Restore from file'); rs.type = 'button'; rs.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var obj; try { obj = JSON.parse(String(rd.result)); } catch (e) { K.toast('That file is not a backup.'); return; }
        var info = K.inspectBackup(obj);
        if (!info) { K.toast('That file is not a Kharcha Book backup.'); return; }
        K.confirmBox({
          title: 'Restore this backup?',
          message: info.total + ' entries in the file, ' + info.missing.length + ' of them not in your book yet. ' + info.settingKeys.length + ' settings (bank accounts, rules, goal…) will be put back too.',
          confirmText: 'Restore',
          onConfirm: function () {
            K.restoreData(obj, true).then(function (r) { K.toast('Restored ' + r.added + ' entries' + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + ' and ' + r.settings + ' settings'); render(); })
              .catch(function (e) { K.toast('Could not restore: ' + (e && e.message || 'try again')); });
          }
        });
      };
      rd.readAsText(f); file.value = '';
    });
    row.appendChild(dl); row.appendChild(rs); row.appendChild(file); card.appendChild(row);
    return card;
  }

  /* ---------- bills calendar (shown at the top of Auto rules) ---------- */
  var cal = { month: null, day: null };
  function billsCalendar() {
    var root = $('rules-root'); if (!root || !K.loadRules || root.querySelector('.bills-cal')) return;
    var KL = window.KharchaLedger, rules = K.loadRules().filter(function (r) { return r.day > 0; });
    var card = el('section', 'in-card bills-cal'), now = new Date();
    if (!cal.month) cal.month = { y: now.getFullYear(), m: now.getMonth() };
    var y = cal.month.y, m = cal.month.m, dim = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7, today = sod(Date.now());
    var head = el('div', 'hm-head');
    function nav(txt, delta) { var b = el('button', 'hm-nav', txt); b.type = 'button'; b.addEventListener('click', function () { var d = new Date(y, m + delta, 1); cal.month = { y: d.getFullYear(), m: d.getMonth() }; cal.day = null; var old = root.querySelector('.bills-cal'); if (old) old.remove(); billsCalendar(); }); return b; }
    head.appendChild(nav('‹', -1)); head.appendChild(el('b', null, '📅 Bills in ' + mFmt.format(new Date(y, m, 1)))); head.appendChild(nav('›', 1)); card.appendChild(head);
    var entries = K.getEntries().filter(function (e) { return e && !e.synthetic; }), mStart = new Date(y, m, 1).getTime(), mEnd = new Date(y, m + 1, 1).getTime();
    var items = rules.map(function (r) {
      var hit = entries.filter(function (e) { return e.ts >= mStart && e.ts < mEnd && KL.matchRule(e.desc, [r]); }).sort(function (a, b) { return a.ts - b.ts; })[0] || null;
      var due = new Date(y, m, Math.min(r.day, dim), 12).getTime();
      var last = entries.filter(function (e) { return KL.matchRule(e.desc, [r]); }).sort(function (a, b) { return b.ts - a.ts; })[0];
      var status = hit ? 'paid' : (due < today ? 'late' : 'soon');
      return { rule: r, day: Math.min(r.day, dim), status: status, hit: hit, amount: hit ? hit.amount : (r.amount || (last ? last.amount : 0)) };
    });
    var grid = el('div', 'hm-grid');
    'MTWTFSS'.split('').forEach(function (cc) { grid.appendChild(el('span', 'hm-dow', cc)); });
    for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'hm-blank'));
    for (var d = 1; d <= dim; d++) {
      var its = items.filter(function (x) { return x.day === d; }), st = its.some(function (x) { return x.status === 'late'; }) ? 'late' : its.some(function (x) { return x.status === 'soon'; }) ? 'soon' : its.length ? 'paid' : '';
      var cell = el('button', 'hm-cell bill ' + st + (cal.day === d ? ' sel' : ''), String(d)); cell.type = 'button';
      if (its.length) cell.appendChild(el('i', 'bill-dot'));
      cell.addEventListener('click', (function (dd) { return function () { cal.day = cal.day === dd ? null : dd; var old = root.querySelector('.bills-cal'); if (old) old.remove(); billsCalendar(); }; })(d));
      grid.appendChild(cell);
    }
    card.appendChild(grid);
    var lg = el('div', 'hm-legend'); [['paid', 'Paid'], ['soon', 'Coming up'], ['late', 'Not logged yet']].forEach(function (x) { lg.appendChild(el('i', 'hm-cell bill ' + x[0])); lg.appendChild(el('span', null, x[1])); }); card.appendChild(lg);
    if (!items.length) card.appendChild(el('div', 'in-sub', 'Give a rule a day of the month and it shows here.'));
    var shown = items.filter(function (x) { return cal.day ? x.day === cal.day : true; }).sort(function (a, b) { return a.day - b.day; });
    shown.forEach(function (x) {
      var r = el('div', 'sa-row bill-row');
      r.appendChild(el('span', 'sa-d', x.day + ' ' + new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(y, m, 1))));
      r.appendChild(el('span', 'sa-t', x.rule.name));
      r.appendChild(el('span', 'sa-a ' + x.status, (x.amount ? money(x.amount) + ' ' : '') + (x.status === 'paid' ? '✓' : x.status === 'late' ? '⚠️' : '⏳')));
      card.appendChild(r);
    });
    root.insertBefore(card, root.firstChild);
  }
  document.addEventListener('kharcha:rules', billsCalendar);

  /* ---------- month-end forecast + unusual spends ---------- */
  function forecastCard() {
    var KL = window.KharchaLedger, card = el('section', 'in-card');
    card.appendChild(el('div', 'in-k', 'MONTH-END FORECAST'));
    if (!KL || !KL.forecastMonth) { card.appendChild(el('p', 'in-sub', 'Not available yet.')); return card; }
    var up = 0; try { var rules = K.loadRules(); var ups = KL.upcomingRules(rules, K.getEntries(), Date.now(), new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59).getTime()); up = ups.reduce(function (n, u) { return n + Number(u.amount || 0); }, 0); } catch (e) {}
    var f = KL.forecastMonth(K.getEntries(), Date.now(), function (e) { return K.isExpense(e); }, up);
    card.appendChild(el('div', 'in-big', '\u2248 ' + rupees(f.projected)));
    card.appendChild(el('p', 'in-sub', 'Expected spend by month end. So far ' + rupees(f.spent) + ', ' + f.daysLeft + ' days to go' + (up ? ', plus ' + rupees(up) + ' of monthly payments due' : '') + '.'));
    if (f.riskyAvg > 0) card.appendChild(el('p', 'in-sub', 'Watch out on ' + f.riskyDay + 's: you usually spend about ' + rupees(f.riskyAvg) + ' that day.'));
    return card;
  }
  function unusualCard() {
    var KL = window.KharchaLedger, card = el('section', 'in-card');
    card.appendChild(el('div', 'in-k', 'UNUSUAL SPENDS'));
    var list = KL && KL.unusualSpends ? KL.unusualSpends(K.getEntries(), Date.now(), function (e) { return K.isExpense(e); }) : [];
    if (!list.length) { card.appendChild(el('p', 'in-sub', 'Nothing odd in the last 3 days. Spends look normal.')); return card; }
    list.slice(0, 5).forEach(function (u) {
      var name = String(u.e.desc || '').replace(/^[^\wऀ-ॿ]+/, '').slice(0, 30);
      card.appendChild(el('p', 'in-sub', u.twice ? '\u26A0\uFE0F ' + name + ' ' + rupees(u.e.amount) + ' was charged twice on the same day.' : '\u26A0\uFE0F ' + name + ' ' + rupees(u.e.amount) + ' is ' + u.times.toFixed(1) + '\u00d7 your usual ' + rupees(u.usual) + '.'));
    });
    return card;
  }

  /* ---------- screen ---------- */
  function render() {
    var root = $('insights-root'); if (!root || !K.getNetWorthParts) return;
    var keepScroll = root.querySelector('.story-rail') ? root.querySelector('.story-rail').scrollLeft : 0;
    root.textContent = '';
    root.appendChild(netWorthCard());
    root.appendChild(forecastCard());
    root.appendChild(unusualCard());
    root.appendChild(weeklyStory());
    root.appendChild(streakCard());
    root.appendChild(goalCard(render));
    root.appendChild(heatmapCard(render));
    root.appendChild(sourcesCard(render));
    root.appendChild(reportCard());
    root.appendChild(dataCard());
    var rail = root.querySelector('.story-rail'); if (rail && keepScroll) rail.scrollLeft = keepScroll;
  }
  document.addEventListener('kharcha:insights', render);
})();
