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

  /* ---------- screen ---------- */
  function render() {
    var root = $('insights-root'); if (!root || !K.getNetWorthParts) return;
    var keepScroll = root.querySelector('.story-rail') ? root.querySelector('.story-rail').scrollLeft : 0;
    root.textContent = '';
    root.appendChild(netWorthCard());
    root.appendChild(weeklyStory());
    root.appendChild(streakCard());
    root.appendChild(goalCard(render));
    root.appendChild(heatmapCard(render));
    var rail = root.querySelector('.story-rail'); if (rail && keepScroll) rail.scrollLeft = keepScroll;
  }
  document.addEventListener('kharcha:insights', render);
})();
