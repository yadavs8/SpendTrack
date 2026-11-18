/* SpendTrack v155: "₹2,089.90 went into Amazon Pay. What did you buy?"
   A card payment "on AMAZON PAY WALL" only moves money into the Amazon Pay balance; the Blinkit / Amazon order is the
   spending, and its own message (Amazon's email) often never reaches the phone, so the order went unlogged.
   - Home shows a card for each top-up still waiting for its purchase (ledger-logic waitingTopups).
   - The Wallet page lists them too.
   - The phone's notification (MainActivity → window.kharchaWalletPrompt) opens the same form.
   The form asks the shop and the FULL order amount (part may have come from the balance: the 18 Nov Blinkit order was
   ₹2,294, the card paid ₹2,089.90) and logs "👛 Amazon Pay · <shop>". "Kept in wallet" stops asking about that top-up. */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var KEPT_KEY = 'kharcha_wallet_kept';
  var tFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  function kept() { try { var a = JSON.parse(K.kvGet(KEPT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function keep(id) { var a = kept(); if (a.indexOf(id) < 0) a.push(id); K.kvSet(KEPT_KEY, JSON.stringify(a.slice(-200))); refresh(); }
  function waiting() {
    var KL = window.KharchaLedger;
    if (!KL || !KL.waitingTopups || !K.getEntries) return [];
    return KL.waitingTopups(K.getEntries(), Date.now(), kept(), 30);
  }

  // The form. data: { amount, ts, shop?, topupId? }
  function ask(data) {
    if (!K.inputBox || !K.store) return false;
    var amt = +data.amount || 0, ts = +data.ts || Date.now();
    K.inputBox({
      title: '👛 What did you buy with Amazon Pay?',
      message: K.money(amt) + ' went into Amazon Pay on ' + tFmt.format(new Date(ts)) + '. If part of the order was paid from your Amazon Pay balance, enter the full order amount (it is on the invoice).',
      fields: [
        { label: 'Shop', value: data.shop || '', placeholder: 'Blinkit, Amazon, Zomato…' },
        { label: 'Order amount (₹)', value: String(amt), inputmode: 'decimal' }
      ],
      confirmText: 'Log purchase',
      onConfirm: function (v) {
        var shop = String(v[0] || '').trim() || 'Amazon Pay purchase', n = K.parseAmount ? K.parseAmount(v[1]) : parseFloat(v[1]);
        if (!isFinite(n) || n <= 0) { K.toast('Enter the order amount.'); return; }
        var KL = window.KharchaLedger;
        K.store.add({ amount: Math.round(n * 100) / 100, desc: KL.walletSpendDesc('Amazon Pay', shop), spent_at: new Date(ts + 1000).toISOString(), method: 'other', kind: 'expense' })
          .then(function () { K.toast('Logged ' + K.money(n) + ' · ' + shop + ' (Amazon Pay)'); if (K.rerender) K.rerender(); refresh(); })
          .catch(function (err) { K.toast('Could not log it: ' + ((err && err.message) || err)); });
      }
    });
    return true;
  }
  // Called by the phone app when its notification is tapped. Returns true once the form is open.
  window.kharchaWalletPrompt = function (data) {
    if (!window.__kharcha || !K.store || !K.getEntries || !K.getEntries()) return false;   // page not ready yet: the phone retries
    try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { return false; }
    if (!data || !(+data.amount > 0)) return true;
    // already logged since the notification (or the email came after all): nothing to ask
    var t = waiting().filter(function (e) { return Math.abs(e.ts - (+data.ts || 0)) <= 10 * 60000 && Math.abs(e.amount - data.amount) < 1; })[0];
    if (!t && waiting().length === 0 && data.ts) { K.toast('That Amazon Pay payment is already explained.'); return true; }
    return ask({ amount: data.amount, ts: data.ts, shop: data.shop, topupId: t && t.id });
  };

  function row(e, compact) {
    var r = el('div', 'wp-row');
    var mid = el('div', 'rd-mid');
    mid.appendChild(el('b', null, K.money(e.amount) + ' went into Amazon Pay'));
    mid.appendChild(el('small', null, tFmt.format(new Date(e.ts)) + ' · ' + (String(e.desc || '').split('·')[1] || 'card').trim() + ' · What did you buy?'));
    r.appendChild(mid);
    var acts = el('div', 'wp-acts');
    ['Blinkit', 'Amazon'].forEach(function (s) {
      var b = el('button', 'scope-pill', s); b.type = 'button';
      b.addEventListener('click', function () { ask({ amount: e.amount, ts: e.ts, shop: s, topupId: e.id }); }); acts.appendChild(b);
    });
    var o = el('button', 'scope-pill', 'Other'); o.type = 'button'; o.addEventListener('click', function () { ask({ amount: e.amount, ts: e.ts, shop: '', topupId: e.id }); }); acts.appendChild(o);
    if (!compact) {
      var k = el('button', 'scope-pill', 'Kept in wallet'); k.type = 'button';
      k.title = 'Nothing was bought yet: the money stays in your Amazon Pay balance.';
      k.addEventListener('click', function () { keep(e.id); K.toast('OK, it stays in your Amazon Pay balance.'); }); acts.appendChild(k);
    }
    r.appendChild(acts);
    return r;
  }
  function homeCard() {
    var old = $('wp-home'); if (old) old.remove();
    var cur = document.querySelector('.streambtn.active'); if (cur && cur.dataset.stream !== 'spends') return;
    var list = waiting().filter(function (e) { return Date.now() - e.ts <= 3 * 864e5; });
    if (!list.length) return;
    var c = el('div', 'rd-card wp-card'); c.id = 'wp-home';
    c.appendChild(el('h3', null, '👛 Not logged yet: what was it?'));
    c.appendChild(el('p', 'rd-sub', 'Amazon Pay does not tell your bank what you bought, so these are not in your spending yet.'));
    list.slice(0, 3).forEach(function (e) { c.appendChild(row(e, true)); });
    var home = $('spends-view'); if (home) home.insertBefore(c, home.firstChild);
  }
  function walletCard() {
    var old = $('wp-wallet'); if (old) old.remove();
    var sec = $('wallet-sec'); if (!sec || sec.hidden) return;
    var list = waiting(); if (!list.length) return;
    var c = el('div', 'rd-card wp-card'); c.id = 'wp-wallet';
    c.appendChild(el('h3', null, '👛 Top-ups waiting for a purchase'));
    c.appendChild(el('p', 'rd-sub', 'Money that went into Amazon Pay with no order logged after it. Log what you bought, or mark it as kept in the wallet.'));
    list.forEach(function (e) { c.appendChild(row(e, false)); });
    sec.insertBefore(c, sec.firstChild);
  }
  function refresh() { try { homeCard(); walletCard(); } catch (e) { console.warn('SpendTrack: wallet prompt', e); } }

  window.__walletPrompt = { waiting: waiting, ask: ask, refresh: refresh };
  document.addEventListener('kharcha:render', refresh);
})();
