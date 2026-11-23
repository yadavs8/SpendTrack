/* SpendTrack v159: pop-ups always in front.
   On some Android phones a pop-up ("Save this?", Move to Personal...) was drawn behind the page, so its buttons
   could not be reached, even though its CSS puts it above everything. Browsers have one layer nothing can cover:
   the "top layer" of a <dialog> opened with showModal(). Whenever a pop-up (.modal-backdrop) is on screen, it is
   moved into such a dialog; when none is left the dialog closes. Pop-ups keep their own look, buttons and handlers.
   Works for every pop-up, including ones added later. Without <dialog> support nothing changes. */
(function () {
  'use strict';
  var D = window.HTMLDialogElement;
  if (!D || typeof D.prototype.showModal !== 'function') return;

  var dlg = null, busy = false;
  function host() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'kb-top';
    dlg.setAttribute('aria-label', 'Pop-up');
    // A pop-up closes with its own ✕ or Cancel; Escape / the phone's back gesture should do the same.
    dlg.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      var open = shown(), top = open[open.length - 1];
      if (!top) return;
      var x = top.querySelector('.close-btn, [aria-label="Close"], .modal-x');
      if (x) { x.click(); return; }
      var btns = top.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) if (/^\s*(cancel|close|not now|no)\s*$/i.test(btns[i].textContent)) { btns[i].click(); return; }
      top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // backdrops close on a click on themselves
    });
    document.body.appendChild(dlg);
    return dlg;
  }
  function visible(n) { return n.isConnected && !n.hidden && getComputedStyle(n).display !== 'none'; }
  function shown() { return dlg ? Array.prototype.filter.call(dlg.querySelectorAll(':scope > .modal-backdrop'), visible) : []; }

  function sync() {
    if (busy) return;
    busy = true;
    try {
      var d = host();
      // bring every pop-up that is on screen into the dialog, in the order they were opened (the newest stays on top)
      Array.prototype.forEach.call(document.querySelectorAll('.modal-backdrop'), function (n) {
        if (n.parentNode !== d && visible(n)) d.appendChild(n);
      });
      var any = shown().length > 0;
      if (any && !d.open) {
        try { d.showModal(); } catch (e) { try { d.show(); } catch (e2) {} }
        if (document.activeElement && document.activeElement !== document.body && d.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();   // no focus ring on the first button
      } else if (!any && d.open) {
        d.close();
      }
    } finally { busy = false; }
  }

  var queued = false;
  function soon() { if (queued) return; queued = true; Promise.resolve().then(function () { queued = false; sync(); }); }
  function start() {
    new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    sync();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.__kharchaTopLayer = { sync: sync };
})();
