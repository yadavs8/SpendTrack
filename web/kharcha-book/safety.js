/* Kharcha Book v129: ask before saving or deleting anything.
   One place for the whole app (every page, every pop-up, and anything added later):
   - Saving a form ("Add", "Save", "Log", "Record", "Create", ...) first shows "Save this?" with what you typed.
   - A button that deletes or removes something first shows "Delete this?" with what it is.
   - Buttons that save straight away (no form) do the same when they say Save / Log it / Record, or carry data-confirm.
   Turn it off or on from the menu (☰ > Ask before save & delete). Runs after app.js; uses window.__kharcha only. */
(function () {
  'use strict';
  var K = new Proxy({}, { get: function (_, k) { return (window.__kharcha || {})[k]; } });
  var KEY = 'kharcha_confirm_actions';
  function on() { try { return (K.kvGet(KEY) || 'on') !== 'off'; } catch (e) { return true; } }
  // While the save/delete you just said yes to runs, a handler that asks the same thing again by itself
  // is answered by that yes. Only for that moment: a later, separate question is always asked.
  function runConfirmed(fn) { window.__kharchaOkUntil = Date.now() + 1500; try { fn(); } finally { window.__kharchaOkUntil = 0; } }

  var SAVE_LABEL = /\b(add|save|create|log|record|start|track|set|update|join|done|rename|keep|lent|borrowed|settle|confirm|apply|use|mark)\b|＋|^\s*\+/i;
  var DIRECT_SAVE = /^\W*(save|log it|record)\b/i;
  var DEL_LABEL = /\b(delete|remove|stop tracking|not a bill|discard|clear all|reset)\b|🗑/i;
  var NOT_DEL = /^\W*(close|clear search|hide|cancel)\b/i;

  function labelOf(f, input) {
    if (input.id) { var l = f.querySelector('label[for="' + input.id + '"]'); if (l) return l.textContent.trim(); }
    var w = input.closest('.field, label'); if (w) { var lb = w.tagName === 'LABEL' ? w : w.querySelector('label'); if (lb) return lb.textContent.replace(input.value, '').trim(); }
    return (input.getAttribute('aria-label') || input.placeholder || '').trim();
  }
  function looksAmount(input, label) { return input.inputMode === 'decimal' || /amt|amount/i.test(input.id + ' ' + input.name) || /amount|₹/i.test(label); }
  function summary(f) {
    var out = [];
    Array.prototype.forEach.call(f.elements || [], function (x) {
      if (out.length >= 5 || x.disabled) return;
      var t = (x.type || '').toLowerCase();
      if (t !== 'hidden' && !x.getClientRects().length) return;    // a field that isn't on screen
      if (/^(hidden|password|submit|button|reset|file|image|search)$/.test(t) || x.tagName === 'BUTTON' || x.tagName === 'FIELDSET') return;
      if ((t === 'checkbox' || t === 'radio') && !x.checked) return;
      var v = x.tagName === 'SELECT' ? (x.options[x.selectedIndex] ? x.options[x.selectedIndex].text : '') : String(x.value || '');
      v = v.trim(); if (!v) return;
      var lab = labelOf(f, x).replace(/\s+/g, ' ').replace(/[:\s]+$/, '').slice(0, 40);
      if (looksAmount(x, lab) && /^[\d,.\s]+$/.test(v)) v = '₹' + v;
      if (t === 'datetime-local' || t === 'date') { var d = new Date(v); if (!isNaN(d)) v = d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: t === 'date' ? undefined : 'numeric', minute: t === 'date' ? undefined : '2-digit' }); }
      if (t === 'checkbox' || t === 'radio') v = '✓';
      out.push((lab ? lab + ': ' : '') + v.slice(0, 70));
    });
    return out;
  }
  function contextOf(b) {
    var f = b.closest('form'); if (f) { var s = summary(f); if (s.length) return s.join('\n'); }
    var row = b.closest('.row, .entry-swipe-wrap, .ap-bill, .ap-sub-row, .th-p, .th-person, li, .udh-row, .udh-item, .wal-card, .in-card, .due-card, .fc-bill, .rule-row, [class*="-row"], [class*="-item"], [class*="-chip"], [class*="card"]');
    if (!row) return '';
    var txt = (row.innerText || '').replace(b.innerText || '', '').split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s && s !== '×' && s.length > 1; });
    return txt.slice(0, 3).join(' · ').slice(0, 140);
  }
  function verbOf(label) {
    var m = /\b(add|save|create|log|record|start|set|update|join|rename|track|settle|mark)\b/i.exec(label || '');
    var v = m ? m[1].toLowerCase() : 'save';
    return v === 'log' ? 'Log' : v.charAt(0).toUpperCase() + v.slice(1);
  }

  /* ---------- saving a form ---------- */
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!(f instanceof HTMLFormElement) || !on()) return;
    if (f.dataset.okd === '1') { delete f.dataset.okd; return; }
    if (f.id === 'auth' || f.closest('#confirm-modal') || f.matches('[role="search"], .no-confirm') || f.querySelector('input[type="password"]')) return;
    var btn = ev.submitter || f.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
    var label = btn ? (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim() : '';
    if (label && !SAVE_LABEL.test(label)) return;               // "Open UPI app", "Send on WhatsApp", "Sign in", "Search"
    var lines = summary(f);
    if (!lines.length) return;                                  // empty: let the form show its own "enter an amount" message
    ev.preventDefault(); ev.stopImmediatePropagation();
    var verb = verbOf(label);
    K.confirmBox({
      title: verb + ' this?', message: 'Do you want to ' + verb.toLowerCase() + ' this record?\n\n' + lines.join('\n'),
      confirmText: '✓ Yes, ' + verb.toLowerCase(),
      onConfirm: function () {
        f.dataset.okd = '1';
        runConfirmed(function () {
          if (f.requestSubmit) { try { f.requestSubmit(btn && btn.form === f && btn.type === 'submit' ? btn : undefined); return; } catch (e) {} }
          f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
      }
    });
  }, true);

  /* ---------- deleting, and buttons that save straight away ---------- */
  document.addEventListener('click', function (ev) {
    if (!on()) return;
    var b = ev.target && ev.target.closest ? ev.target.closest('button, [role="button"]') : null;
    if (!b || b.disabled || b.closest('#confirm-modal') || b.hasAttribute('data-self-confirm')) return;   // it asks its own, fuller question
    if (b.dataset.okd === '1') { delete b.dataset.okd; return; }
    var label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').replace(/\s+/g, ' ').trim();
    var isDel = (DEL_LABEL.test(label) || /(^|[-_ ])(del|remove)\b/i.test(b.className)) && !NOT_DEL.test(label);
    var isSave = !isDel && b.type !== 'submit' && (b.hasAttribute('data-confirm') || DIRECT_SAVE.test(b.textContent || ''));
    if (!isDel && !isSave) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var what = contextOf(b);
    var go = function () { b.dataset.okd = '1'; runConfirmed(function () { b.click(); }); };
    if (isDel) {
      var t = label.length <= 36 && !/^×$/.test(label) ? label.charAt(0).toUpperCase() + label.slice(1) : 'Delete this';
      K.confirmBox({ title: '🗑️ ' + t.replace(/\?$/, '') + '?', message: 'Do you want to delete this?' + (what ? '\n\n' + what : ''), confirmText: 'Yes, delete', isDanger: true, onConfirm: go });
    } else {
      var v = b.getAttribute('data-confirm') || verbOf(b.textContent);
      K.confirmBox({ title: v + ' this?', message: 'Do you want to save this record?' + (what ? '\n\n' + what : ''), confirmText: '✓ Yes, ' + v.toLowerCase(), onConfirm: go });
    }
  }, true);

  window.__kharchaSafety = {
    on: on,
    toggle: function () {
      var next = on() ? 'off' : 'on'; K.kvSet(KEY, next);
      K.toast(next === 'on' ? '🛡️ The app asks before every save and delete' : 'Saves and deletes happen straight away (Undo still works)');
      return next === 'on';
    }
  };
})();
