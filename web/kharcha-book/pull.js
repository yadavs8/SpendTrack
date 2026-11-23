/* Pull down to close — the More sheet, every pop-up, and any page opened from More (back to Home).
 *
 * One document-level touch handler instead of one per sheet. It starts only when the finger moves down
 * first and everything it is on is already scrolled to the top, so normal scrolling and sideways swipes
 * are untouched. The panels stop scroll chaining (overscroll-behavior: contain, modern.css), so the browser
 * never starts a page scroll underneath before this decides.
 */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function nav() { return window.__kharchaNav || null; }
  function clickClose(root, sels) {
    for (var i = 0; i < sels.length; i++) { var b = root.querySelector(sels[i]); if (b) { b.click(); return true; } }
    return false;
  }
  function clickBackdrop(back) {                     // the backdrops close on a click whose target is themselves
    if (!back) return false;
    back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }
  function closeModal(card) {
    var back = card.closest('.modal-backdrop') || card.parentNode;
    if (clickClose(card, ['.close-btn', '[aria-label="Close"]', '.modal-x'])) return;
    var btns = card.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) if (/^\s*(cancel|close|not now|no)\s*$/i.test(btns[i].textContent)) { btns[i].click(); return; }
    clickBackdrop(back);
  }
  // [selector, how to close it]. The first match from the touched element up wins.
  var PANELS = [
    ['.msheet-card', function () { var n = nav(); if (n) n.closeMore(); }],
    ['.hx-pop', function (p) { clickClose(p, ['.hx-pop-x']); }],
    ['.kt-sheet', function (p) { clickClose(p, ['.kt-x']) || clickBackdrop(p.parentNode); }],
    ['.sm-sheet', function (p) { clickClose(p, ['.sm-x']) || clickBackdrop(p.parentNode); }],
    ['.modal-card, .modal-box', closeModal]
  ];
  var PANEL_SEL = PANELS.map(function (p) { return p[0]; }).join(', ');
  var NO_PULL = 'input, textarea, select, [contenteditable="true"], [data-no-pull], canvas.snap-logo';

  function panelOf(t) {
    var p = t.closest && t.closest(PANEL_SEL); if (!p) return null;
    for (var i = 0; i < PANELS.length; i++) if (p.matches(PANELS[i][0])) return { el: p, close: PANELS[i][1] };
    return null;
  }
  function anyPanelOpen() {
    var els = document.querySelectorAll(PANEL_SEL);
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width && r.height && !els[i].closest('[hidden]')) return true; }
    return false;
  }
  // Every scrollable box from the touched element up to `stop` (or the page) is at its top.
  function atTop(t, stop) {
    for (var n = t; n && n.nodeType === 1; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1) {
        var oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollTop > 0) return false;
      }
      if (n === stop) return true;
    }
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }
  // Pulling feels heavier the further it goes.
  function rubber(dy, max) { return dy <= 0 ? 0 : max * (1 - Math.exp(-dy / max)); }

  var g = null, hint = null, suppressClickUntil = 0, SLOP = 12;   // px a tap may wander before it counts as a pull
  function pageEls() { return [document.getElementById('main'), document.querySelector('.backbar')].filter(Boolean); }
  function showHint(ready) {
    if (!hint) { hint = document.createElement('div'); hint.className = 'pull-hint'; document.body.appendChild(hint); }
    hint.textContent = ready ? '⌂ Let go for Home' : '↓ Pull to go Home';
    hint.classList.toggle('ready', !!ready); hint.hidden = false;
  }
  function hideHint() { if (hint) hint.hidden = true; }
  function setPanel(el, y, bdAlpha) {
    el.style.transition = 'none'; el.style.transform = y ? 'translateY(' + y + 'px)' : '';
    if (el.matches('.msheet-card') && el.parentNode) el.parentNode.style.backgroundColor = 'rgba(2, 6, 23, ' + bdAlpha.toFixed(3) + ')';
  }
  function resetPanel(el, animate) {
    el.style.transition = animate ? 'transform .24s cubic-bezier(.16,1,.3,1)' : '';
    el.style.transform = '';
    if (el.matches('.msheet-card') && el.parentNode) { el.parentNode.style.transition = animate ? 'background-color .24s ease' : ''; el.parentNode.style.backgroundColor = ''; }
    setTimeout(function () { el.style.transition = ''; if (el.parentNode) el.parentNode.style.transition = ''; }, 260);
  }

  document.addEventListener('touchstart', function (e) {
    g = null;
    if (e.touches.length !== 1) return;
    var t = e.target, p = panelOf(t);
    if (t.closest && t.closest(NO_PULL)) return;
    if (p) {
      if (!atTop(t, p.el)) return;
      g = { mode: 'panel', panel: p, y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(), on: false, dy: 0 };
      return;
    }
    var n = nav();
    if (!n || n.curStream() === 'spends' || anyPanelOpen()) return;   // Home has nothing to go back to
    if (t.closest && t.closest('.bnav, .msheet, .modal-backdrop, .kt-back, .sm-back, .hx-pop-bd')) return;
    if (!atTop(t, null)) return;
    g = { mode: 'page', y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(), on: false, dy: 0 };
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!g || e.touches.length !== 1) return;
    var dy = e.touches[0].clientY - g.y0, dx = e.touches[0].clientX - g.x0;
    if (!g.on) {
      if (dy < -SLOP || Math.abs(dx) > SLOP) { g = null; return; }     // scrolling up or swiping sideways: not ours
      // v157: a finger drifts a few pixels during an ordinary tap. Starting the pull at 2px swallowed that tap
      // (its click was suppressed on lift), so buttons like Save or Move to Personal sometimes did nothing.
      if (dy > SLOP && dy > Math.abs(dx) * 1.2) g.on = true; else return;
    }
    if (e.cancelable) e.preventDefault();
    g.dy = dy;
    if (g.mode === 'panel') {
      var h = g.panel.el.offsetHeight || 400;
      setPanel(g.panel.el, Math.max(0, dy), 0.55 * (1 - Math.min(1, dy / h) * 0.85));
    } else {
      var y = rubber(dy, 140);
      pageEls().forEach(function (el) { el.style.transition = 'none'; el.style.transform = 'translateY(' + y + 'px)'; el.style.opacity = String(1 - Math.min(0.35, y / 400)); });
      showHint(dy > 120);
    }
  }, { passive: false, capture: true });

  function end(e) {
    if (!g) return;
    var s = g; g = null;
    if (!s.on) return;
    suppressClickUntil = Date.now() + 350;            // the finger lifting is not a tap on what is under it
    var v = s.dy / Math.max(1, Date.now() - s.t0), cancelled = e.type === 'touchcancel';
    if (s.mode === 'panel') {
      var el = s.panel.el;
      if (!cancelled && (s.dy > 90 || (s.dy > 30 && v > 0.45))) {
        if (el.matches('.msheet-card') || reduceMotion) { resetPanel(el, false); s.panel.close(el); return; }
        el.style.transition = 'transform .2s ease-in'; el.style.transform = 'translateY(110%)';
        setTimeout(function () { s.panel.close(el); resetPanel(el, false); }, 190);
      } else resetPanel(el, true);
    } else {
      hideHint();
      var go = !cancelled && (s.dy > 120 || (s.dy > 50 && v > 0.6));
      var els = pageEls();
      els.forEach(function (el) { el.style.transition = 'transform .22s ease, opacity .22s ease'; el.style.transform = go ? 'translateY(60px)' : ''; el.style.opacity = go ? '0' : ''; });
      setTimeout(function () {
        if (go) { var n = nav(); if (n) n.home(); }
        els.forEach(function (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; });
      }, go ? 200 : 230);
    }
  }
  document.addEventListener('touchend', end, { passive: true, capture: true });
  document.addEventListener('touchcancel', end, { passive: true, capture: true });
  document.addEventListener('click', function (e) {
    if (e.isTrusted && Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); suppressClickUntil = 0; }
  }, true);
})();
