/* SpendTrack v154: Tax savings (More > Tax savings).
   The payments that can lower income tax, found in your entries for the tax year (1 April – 31 March), with how
   much of each limit is used, what is left before 31 March, and a proof list for your CA.
   Section numbers are the Income-tax Act, 2025's (in force from 1 April 2026), with the old 1961 numbers in brackets.
   These deductions only count under the OLD regime; the page asks which one you use and says so plainly.
   A helper, not tax advice. Runs after app.js and only uses what app.js exposes (window.__kharcha). */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(v) { return K.money(Math.round(v)); }
  var dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  var SET_KEY = 'kharcha_tax';

  var LIMIT_123 = 150000, LIMIT_126 = 25000, LIMIT_NPS = 50000;
  var LIFE = /\b(lic|life\s+insurance|max\s+life|term\s+(?:plan|insurance)|hdfc\s+life|sbi\s+life|icici\s+pru\w*|tata\s+aia|bajaj\s+allianz\s+life|kotak\s+life|insurance\s+premium|policy\s*no)\b/i;
  var NOT_LIFE = /\b(car|motor|bike|two[- ]?wheeler|vehicle|health|mediclaim|travel|home\s+insurance|brezza)\b/i;
  var HEALTH = /\b(health\s+insurance|mediclaim|star\s+health|care\s+health|niva\s+bupa|hdfc\s+ergo\s+health|aditya\s+birla\s+health|optima)\b/i;
  var OTHER_123 = /\b(ppf|public\s+provident|nsc|sukanya|ssy|tuition|school\s+fees?)\b/i;
  var NPS = /\b(nps|national\s+pension)\b/i;
  var HOME_LOAN = /\b(home\s+loan|housing\s+loan)\b|\b(flat|house|home)\b.*\bemi\b|\bemi\b.*\b(flat|house|home)\b/i;

  function settings() { try { var s = JSON.parse(K.kvGet(SET_KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; } }
  function save(s) { K.kvSet(SET_KEY, JSON.stringify(s)); render(); }
  function taxYear(offset) {           // the Indian tax year containing today (offset -1 = last year)
    var now = new Date(), y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    y += offset || 0;
    return { from: new Date(y, 3, 1).getTime(), to: new Date(y + 1, 3, 1).getTime() - 1, label: y + '–' + String(y + 1).slice(2) };
  }
  function text(e) { return (e.desc || '') + ' ' + (e.raw || ''); }
  function seriesOf(e) { var KL = window.KharchaLedger; return KL && KL.seriesKey ? KL.seriesKey(e.desc) : String(e.desc || '').toLowerCase(); }
  function nameOf(e) { return String(K.cleanScopePrefix ? K.cleanScopePrefix(e.desc || '') : e.desc || '').replace(/^[^\wऀ-ॿ₹]+/u, '').trim() || 'Payment'; }

  function collect(ty, s) {
    var entries = ((K.getEntries && K.getEntries()) || []).filter(function (e) {
      return e && !e.synthetic && e.ts >= ty.from && e.ts <= ty.to && !(K.isIncome && K.isIncome(e)) && !(K.isTransferEntry && K.isTransferEntry(e));
    });
    var out = { life: [], other123: [], elss: [], health: [], nps: [], loan: [], sips: {} };
    entries.forEach(function (e) {
      var t = text(e);
      if (HEALTH.test(t)) out.health.push(e);
      else if (LIFE.test(t) && !NOT_LIFE.test(e.desc || '')) out.life.push(e);
      else if (NPS.test(t)) out.nps.push(e);
      else if (OTHER_123.test(t)) out.other123.push(e);
      else if (HOME_LOAN.test(t)) out.loan.push(e);
      else if (K.isInvestment && K.isInvestment(e) && /\bsip\b|mutual|autopay|clearing|elss|tax\s*saver/i.test(t)) {
        var k = seriesOf(e); (out.sips[k] = out.sips[k] || { key: k, name: nameOf(e), list: [] }).list.push(e);
        if ((s.elss || {})[k]) out.elss.push(e);
      }
    });
    return out;
  }
  function sum(list) { return list.reduce(function (t, e) { return t + (+e.amount || 0); }, 0); }

  function render() {
    var root = $('tax-root'); if (!root) return;
    var sec = $('tax-sec'); if (sec && sec.hidden) return;
    root.textContent = '';
    var s = settings(), ty = taxYear(s.lastYear ? -1 : 0), c = collect(ty, s);
    var principal = +s.hlPrincipal || 0, interest = +s.hlInterest || 0;
    var used123 = sum(c.life) + sum(c.other123) + sum(c.elss) + principal;
    var hero = el('div', 'rd-hero');
    hero.appendChild(el('h2', null, '🧾 Tax savings · ' + ty.label));
    hero.appendChild(el('p', 'rd-big', money(Math.min(used123, LIMIT_123)) + ' of ' + money(LIMIT_123)));
    hero.appendChild(el('p', 'rd-sub', 'used under Section 123 (old 80C) this tax year' + (used123 < LIMIT_123 ? ' · ' + money(LIMIT_123 - used123) + ' still possible' : ' · limit reached')));
    var bar = el('div', 'tx-bar'), fill = el('div', 'tx-fill'); fill.style.width = Math.min(100, used123 / LIMIT_123 * 100) + '%'; bar.appendChild(fill); hero.appendChild(bar);
    var yr = el('div', 'theme-row');
    [[0, 'This tax year'], [1, 'Last tax year']].forEach(function (o) {
      var b = el('button', 'scope-pill' + (!!s.lastYear === !!o[0] ? ' active' : ''), o[1]); b.type = 'button';
      b.addEventListener('click', function () { s.lastYear = !!o[0]; save(s); }); yr.appendChild(b);
    });
    hero.appendChild(yr);
    root.appendChild(hero);

    root.appendChild(regimeCard(s));
    var now = new Date(), m = now.getMonth();
    if (!s.lastYear && (m <= 2) && s.regime === 'old' && used123 < LIMIT_123) {
      var dl = el('div', 'rd-card rd-alerts'); dl.appendChild(el('h3', null, '⏳ Before 31 March'));
      dl.appendChild(el('p', 'rd-sub', money(LIMIT_123 - used123) + ' of Section 123 (old 80C) is unused. A PPF deposit or an ELSS top-up before 31 March would use it.'));
      root.appendChild(dl);
    }

    root.appendChild(sectionCard('Section 123 (old 80C) · limit ' + money(LIMIT_123), [
      ['🛡️ Life insurance premiums', c.life],
      ['📈 ELSS (tax-saving) SIPs', c.elss],
      ['🏦 PPF, NSC, Sukanya, tuition fees', c.other123]
    ], principal ? [['🏠 Home-loan principal (from your bank certificate)', principal]] : []));
    root.appendChild(sipCard(c, s));
    root.appendChild(sectionCard('Section 126 (old 80D) · health insurance · limit ' + money(LIMIT_126) + ' (₹50,000 if you are a senior citizen; parents have their own limit)', [['❤️ Health insurance premiums', c.health]], []));
    if (c.nps.length) root.appendChild(sectionCard('NPS: extra ' + money(LIMIT_NPS) + ' on top of Section 123 (old 80CCD(1B))', [['🧓 NPS contributions', c.nps]], []));
    root.appendChild(loanCard(c, s, principal, interest));

    var exp = el('button', 'linkbtn', '⬇️ Proof list for your CA (CSV)'); exp.type = 'button';
    exp.addEventListener('click', function () { exportCsv(ty, c, s); });
    root.appendChild(exp);
    root.appendChild(el('p', 'rd-note', 'A helper for you and your CA, not tax advice. Found from your entries; check each one against its receipt. ' +
      'Section numbers follow the Income-tax Act, 2025 (from 1 April 2026), with the 1961 numbers in brackets. Car and travel insurance are not deductible and are left out.'));
  }

  function regimeCard(s) {
    var c = el('div', 'rd-card');
    c.appendChild(el('h3', null, 'Which tax regime do you use?'));
    var r = el('div', 'theme-row');
    [['old', 'Old regime'], ['new', 'New regime (default)'], ['', 'Not sure']].forEach(function (o) {
      var b = el('button', 'scope-pill' + ((s.regime || '') === o[0] ? ' active' : ''), o[1]); b.type = 'button';
      b.addEventListener('click', function () { s.regime = o[0]; save(s); }); r.appendChild(b);
    });
    c.appendChild(r);
    c.appendChild(el('p', 'rd-sub', s.regime === 'old' ? 'These payments lower your taxable income.'
      : s.regime === 'new' ? 'Under the new regime these deductions do not lower your tax. The list is kept so your CA can compare both regimes.'
      : 'The new regime is the default unless you chose the old one when filing. These deductions only count under the old regime; your CA can tell you which saves more.'));
    return c;
  }
  function sectionCard(title, groups, manual) {
    var c = el('div', 'rd-card'); c.appendChild(el('h3', null, title));
    var any = false;
    groups.forEach(function (g) {
      if (!g[1].length) return; any = true;
      var head = el('div', 'rd-row'), mid = el('div', 'rd-mid'); mid.appendChild(el('b', null, g[0])); mid.appendChild(el('small', null, g[1].length + ' payment' + (g[1].length === 1 ? '' : 's')));
      head.appendChild(mid); var a = el('div', 'rd-amt'); a.appendChild(el('b', null, money(sum(g[1])))); head.appendChild(a); c.appendChild(head);
      g[1].slice().sort(function (x, y) { return x.ts - y.ts; }).forEach(function (e) {
        var r = el('div', 'tx-proof'); r.appendChild(el('span', null, dFmt.format(new Date(e.ts)) + ' · ' + nameOf(e))); r.appendChild(el('span', null, money(e.amount))); c.appendChild(r);
      });
    });
    manual.forEach(function (m) { any = true; var r = el('div', 'rd-row'), mid = el('div', 'rd-mid'); mid.appendChild(el('b', null, m[0])); r.appendChild(mid); var a = el('div', 'rd-amt'); a.appendChild(el('b', null, money(m[1]))); r.appendChild(a); c.appendChild(r); });
    if (!any) c.appendChild(el('p', 'rd-sub', 'Nothing found this tax year.'));
    return c;
  }
  function sipCard(c, s) {
    var card = el('div', 'rd-card'), keys = Object.keys(c.sips);
    card.appendChild(el('h3', null, '📈 Which SIPs are ELSS (tax-saving) funds?'));
    if (!keys.length) { card.appendChild(el('p', 'rd-sub', 'No SIPs found this tax year.')); return card; }
    card.appendChild(el('p', 'rd-sub', 'Only ELSS funds count under Section 123. Your bank SMS do not say which fund a SIP buys, so tick the ELSS ones (check your fund statement).'));
    keys.forEach(function (k) {
      var g = c.sips[k], on = !!(s.elss || {})[k];
      var b = el('button', 'scope-pill' + (on ? ' active' : ''), (on ? '✓ ELSS · ' : '') + g.name + ' · ' + money(sum(g.list)) + ' (' + g.list.length + ')'); b.type = 'button';
      b.addEventListener('click', function () { s.elss = s.elss || {}; if (on) delete s.elss[k]; else s.elss[k] = true; save(s); });
      card.appendChild(b);
    });
    return card;
  }
  function loanCard(c, s, principal, interest) {
    var card = el('div', 'rd-card'); card.appendChild(el('h3', null, '🏠 Home loan'));
    var paid = sum(c.loan);
    card.appendChild(el('p', 'rd-sub', c.loan.length ? 'EMIs paid this tax year: ' + money(paid) + ' (' + c.loan.length + '). An EMI is part principal (Section 123, old 80C) and part interest (old 24(b): up to ₹2,00,000 for a home you live in; confirm the new section number with your CA). Your bank sends the split in its yearly interest certificate.'
      : 'No home-loan EMIs found this tax year.'));
    var r = el('div', 'theme-row');
    var pb = el('button', 'scope-pill', principal ? 'Principal: ' + money(principal) : '+ Principal from certificate'); pb.type = 'button';
    var ib = el('button', 'scope-pill', interest ? 'Interest: ' + money(interest) : '+ Interest from certificate'); ib.type = 'button';
    function ask(field, title) {
      K.inputBox({ title: title, message: 'From your bank\'s home-loan interest certificate for this tax year.', fields: [{ label: 'Amount (₹)', value: s[field] ? String(s[field]) : '', inputmode: 'decimal' }], confirmText: 'Save',
        onConfirm: function (v) { var n = K.parseAmount ? K.parseAmount(v[0]) : parseFloat(v[0]); s[field] = isFinite(n) && n > 0 ? Math.round(n) : 0; save(s); } });
    }
    pb.addEventListener('click', function () { ask('hlPrincipal', 'Home-loan principal repaid'); });
    ib.addEventListener('click', function () { ask('hlInterest', 'Home-loan interest paid'); });
    r.appendChild(pb); r.appendChild(ib); card.appendChild(r);
    if (interest) card.appendChild(el('p', 'rd-sub', 'Interest counts up to ' + money(200000) + ' for a self-occupied home (old regime): ' + money(Math.min(interest, 200000)) + ' this year.'));
    return card;
  }

  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv(ty, c, s) {
    var rows = [['Section', 'Item', 'Date', 'Amount (Rs)', 'Payee / description', 'Reference', 'Bank SMS']];
    function add(sec, item, list) { list.forEach(function (e) { rows.push([sec, item, new Date(e.ts).toISOString().slice(0, 10), (+e.amount).toFixed(2), nameOf(e), e.refNo || '', String(e.raw || '').slice(0, 200)]); }); }
    add('123 (80C)', 'Life insurance premium', c.life); add('123 (80C)', 'ELSS SIP', c.elss); add('123 (80C)', 'PPF / NSC / Sukanya / tuition', c.other123);
    add('126 (80D)', 'Health insurance premium', c.health); add('NPS (80CCD(1B))', 'NPS', c.nps); add('Home loan', 'EMI (split from bank certificate)', c.loan);
    if (s.hlPrincipal) rows.push(['123 (80C)', 'Home-loan principal (certificate)', '', (+s.hlPrincipal).toFixed(2), '', '', '']);
    if (s.hlInterest) rows.push(['24(b) (check new section)', 'Home-loan interest (certificate)', '', (+s.hlInterest).toFixed(2), '', '', '']);
    var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n'), name = 'SpendTrack_tax_' + ty.label + '.csv';
    if (window.KharchaNative && window.KharchaNative.shareFile) { window.KharchaNative.shareFile(name, 'text/csv', csv); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.__tax = { render: render, _t: { collect: collect, taxYear: taxYear, LIFE: LIFE, HEALTH: HEALTH, NOT_LIFE: NOT_LIFE, HOME_LOAN: HOME_LOAN } };
  document.addEventListener('kharcha:tax', render);
  document.addEventListener('kharcha:render', function () { var sec = $('tax-sec'); if (sec && !sec.hidden) render(); });
})();
