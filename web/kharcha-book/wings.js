/* SpendTrack logo: a gold ₹ that sits still, unfolds a pair of real feathered wings and flies away.
 *
 * KharchaWings.draw(ctx, unit, W, H, st) paints one frame. Sizes are in "logo units"; `unit` = canvas pixels
 * per unit, W x H = the canvas in units. st = {
 *   x, y     body offset from the canvas centre (up is negative)
 *   scale    body size (1 = the ₹ is ~30 units tall)
 *   alpha    0..1
 *   spread   0 = wings folded away behind the ₹, 1 = fully open
 *   flap     wing beat in degrees (+ = wings up)
 *   tilt     body roll in degrees
 *   bob      tiny breathing offset while sitting
 * }
 * KharchaWings.at(t, opts) gives that state for time t (ms) of one run: sit, unfold, beat, fly away, gone,
 * glide back, fold. opts.rise = how far up it leaves (units), opts.drift = sideways drift (units).
 * KharchaWings.icon(ctx, size, opts) paints the static app icon (wings half open) on a size x size canvas.
 */
(function () {
  'use strict';
  var D2R = Math.PI / 180;
  function lerp(a, b, k) { return a + (b - a) * k; }
  function clamp(k) { return k < 0 ? 0 : k > 1 ? 1 : k; }
  function ease(k) { k = clamp(k); return k * k * (3 - 2 * k); }
  function easeOut(k) { k = clamp(k); return 1 - Math.pow(1 - k, 3); }
  function easeIn(k) { k = clamp(k); return k * k * k; }
  function dir(a) { return { x: Math.cos(a * D2R), y: Math.sin(a * D2R) }; }

  // One feather pointing along +x: tapered quill, rounded asymmetric tip, a shaft line down the middle.
  function feather(ctx, len, wid, c1, c2, edge, shaft) {
    var g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.beginPath();
    ctx.moveTo(0, -wid * 0.28);
    ctx.bezierCurveTo(len * 0.35, -wid * 0.62, len * 0.78, -wid * 0.58, len * 0.97, -wid * 0.18);
    ctx.quadraticCurveTo(len * 1.02, wid * 0.05, len * 0.9, wid * 0.32);
    ctx.bezierCurveTo(len * 0.7, wid * 0.62, len * 0.3, wid * 0.55, 0, wid * 0.28);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(0.18, wid * 0.07); ctx.strokeStyle = edge; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -wid * 0.08, len * 0.9, -wid * 0.02);
    ctx.lineWidth = Math.max(0.12, wid * 0.05); ctx.strokeStyle = shaft; ctx.stroke();
  }

  // The right wing (the left one is drawn mirrored). Shoulder at the origin.
  function wing(ctx, s, flap, pal) {
    var f = flap || 0;
    // Bone directions in degrees (0 = right, 90 = down). Folded: tucked down behind the body. Open: spread up and out.
    var a1 = lerp(78, -34 - f * 0.9, s), a2 = lerp(208, -14 - f * 1.05, s), a3 = lerp(96, 16 - f * 1.25, s);
    var k = lerp(0.42, 1, ease(s)) * 0.68;
    var L1 = 7 * k, L2 = 9 * k, L3 = 8.5 * k;
    var d1 = dir(a1), d2 = dir(a2), d3 = dir(a3);
    var E = { x: d1.x * L1, y: d1.y * L1 }, Wr = { x: E.x + d2.x * L2, y: E.y + d2.y * L2 }, T = { x: Wr.x + d3.x * L3, y: Wr.y + d3.y * L3 };
    var fan = ease(s);

    // primaries: the long flight feathers fanned from the hand (outermost first, so inner ones lie on top)
    for (var i = 9; i >= 0; i--) {
      var q = i / 9, px = lerp(Wr.x, T.x, 0.15 + 0.85 * q), py = lerp(Wr.y, T.y, 0.15 + 0.85 * q);
      var ang = a3 + lerp(lerp(78, 6, q), lerp(16, 4, q), 1 - fan), len = (15 + 7 * Math.sin(q * 2.6 + 0.3)) * k;
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang * D2R); feather(ctx, len, 3.7 * k, pal.f1, pal.f2, pal.edge, pal.shaft); ctx.restore();
    }
    // secondaries: along the forearm, trailing edge
    for (var j = 8; j >= 0; j--) {
      var r = j / 8, sx = lerp(E.x, Wr.x, r), sy = lerp(E.y, Wr.y, r);
      var ang2 = a2 + lerp(lerp(118, 84, r), 168, 1 - fan), len2 = (11.5 + 1.5 * r) * k;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang2 * D2R); feather(ctx, len2, 3.5 * k, pal.f1, pal.f3, pal.edge, pal.shaft); ctx.restore();
    }
    // greater coverts: a shorter row over the base of the flight feathers
    for (var c = 10; c >= 0; c--) {
      var u = c / 10, onHand = u > 0.62, bx, by, base;
      if (onHand) { var w = (u - 0.62) / 0.38; bx = lerp(Wr.x, T.x, w * 0.8); by = lerp(Wr.y, T.y, w * 0.8); base = a3 + lerp(62, 12, w); }
      else { var v = u / 0.62; bx = lerp(E.x, Wr.x, v); by = lerp(E.y, Wr.y, v); base = a2 + lerp(112, 90, v); }
      var ang3 = lerp(base + (onHand ? 10 : 70), base, fan);
      ctx.save(); ctx.translate(bx, by); ctx.rotate(ang3 * D2R); feather(ctx, 6.2 * k, 2.6 * k, pal.c1, pal.c2, pal.edge, pal.shaft); ctx.restore();
    }
    // the leading edge: a soft rounded band of small feathers over the bones
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(E.x, E.y); ctx.lineTo(Wr.x, Wr.y); ctx.lineTo(lerp(Wr.x, T.x, 0.7), lerp(Wr.y, T.y, 0.7));
    ctx.lineWidth = 3.1 * k; ctx.strokeStyle = pal.band; ctx.stroke();
    ctx.lineWidth = 2.5 * k; ctx.strokeStyle = pal.c2; ctx.stroke();
    // lesser coverts: tiny scallops along the band
    for (var m = 0; m < 7; m++) {
      var z = m / 6, mx = lerp(E.x, Wr.x, z), my = lerp(E.y, Wr.y, z);
      ctx.save(); ctx.translate(mx, my); ctx.rotate((a2 + lerp(100, 160, 1 - fan)) * D2R); feather(ctx, 3.6 * k, 2 * k, pal.c1, pal.c2, pal.edge, 'rgba(0,0,0,0)'); ctx.restore();
    }
  }

  function palette(theme) {
    var light = theme === 'light';
    return {
      f1: '#FFFFFF', f2: light ? '#C9D3E2' : '#DCE4F0', f3: light ? '#D5DDE9' : '#E7EDF6',
      c1: '#FFFFFF', c2: light ? '#E3E9F2' : '#EEF2F8', band: light ? 'rgba(15,23,42,0.22)' : 'rgba(15,23,42,0.3)',
      edge: light ? 'rgba(15,23,42,0.42)' : 'rgba(15,23,42,0.55)',
      shaft: light ? 'rgba(100,116,139,0.55)' : 'rgba(120,135,160,0.6)',
      g1: '#FFE9A3', g2: '#F5B70A', g3: '#B7791F', gEdge: light ? 'rgba(120,53,15,0.55)' : 'rgba(0,0,0,0.35)'
    };
  }
  function themeNow() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function rupee(ctx, pal, size) {
    ctx.save();
    ctx.font = '800 ' + size + 'px "Noto Sans", Roboto, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, pal.g1); g.addColorStop(0.55, pal.g2); g.addColorStop(1, pal.g3);
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.06; ctx.strokeStyle = pal.gEdge;
    ctx.strokeText('₹', 0, size * 0.04);
    ctx.fillStyle = g; ctx.fillText('₹', 0, size * 0.04);
    ctx.restore();
  }

  function draw(ctx, unit, W, H, st, theme) {
    var pal = palette(theme || themeNow());
    ctx.clearRect(0, 0, W * unit, H * unit);
    if (st.alpha <= 0) return;
    ctx.save();
    ctx.scale(unit, unit);
    ctx.globalAlpha = clamp(st.alpha);
    ctx.translate(W / 2 + (st.x || 0), H / 2 + (st.y || 0) + (st.bob || 0));
    ctx.rotate((st.tilt || 0) * D2R);
    ctx.scale(st.scale || 1, st.scale || 1);
    var s = clamp(st.spread || 0);
    if (s > 0.02) {
      [1, -1].forEach(function (side) {
        ctx.save(); ctx.translate(side * 6.5, -5); ctx.scale(side, 1); wing(ctx, s, st.flap || 0, pal); ctx.restore();
      });
    }
    rupee(ctx, pal, 32);
    ctx.restore();
  }

  // One run. Times in ms.
  var RUN = { sit: 1600, unfold: 900, beat: 700, away: 1300, gone: 1100, back: 1300, fold: 750 };
  RUN.total = RUN.sit + RUN.unfold + RUN.beat + RUN.away + RUN.gone + RUN.back + RUN.fold;
  function at(t, opts) {
    opts = opts || {};
    var rise = opts.rise || 60, drift = opts.drift || 0;
    var st = { x: 0, y: 0, scale: 1, alpha: 1, spread: 0, flap: 0, tilt: 0, bob: 0 };
    var a = RUN.sit, b = a + RUN.unfold, c = b + RUN.beat, d = c + RUN.away, e = d + RUN.gone, f = e + RUN.back, g = f + RUN.fold;
    if (t < a) { st.bob = Math.sin(t / 420) * 0.5; }
    else if (t < b) {                                   // wings open out from behind the ₹, a little shake to settle
      var k = (t - a) / RUN.unfold; st.spread = easeOut(k); st.flap = Math.sin(k * Math.PI) * 10; st.y = -1.2 * ease(k);
    } else if (t < c) {                                 // a few beats in place, lifting off the ground
      var k2 = (t - b) / RUN.beat; st.spread = 1; st.flap = Math.sin((t - b) / 62) * 34; st.y = -1.2 - 3 * ease(k2);
    } else if (t < d) {                                 // flies up and away, getting smaller
      var k3 = (t - c) / RUN.away; st.spread = 1; st.flap = Math.sin((t - c) / 52) * 40;
      st.y = -4.2 - rise * easeIn(k3); st.x = drift * easeIn(k3); st.scale = 1 - 0.55 * ease(k3); st.tilt = drift ? (drift > 0 ? 1 : -1) * 14 * ease(k3) : 0;
      st.alpha = 1 - ease((k3 - 0.55) / 0.45);
    } else if (t < e) { st.alpha = 0; }
    else if (t < f) {                                   // glides back down from the top
      var k4 = (t - e) / RUN.back; st.spread = 1; st.flap = Math.sin((t - e) / 70) * lerp(26, 8, k4);
      st.y = -rise * (1 - easeOut(k4)); st.x = -drift * 0.4 * (1 - easeOut(k4)); st.scale = 0.5 + 0.5 * easeOut(k4); st.alpha = ease(k4 / 0.4);
    } else if (t < g) {                                 // lands and tucks the wings away
      var k5 = (t - f) / RUN.fold; st.spread = 1 - ease(k5); st.flap = Math.sin(k5 * Math.PI) * -8;
    }
    return st;
  }

  // The static icon: dark rounded tile, gold ₹, wings half open. full = paint the whole square (launcher/maskable).
  function icon(ctx, size, opts) {
    opts = opts || {};
    var pad = opts.full ? 0 : size * 0.06, r = opts.round ? size / 2 : size * 0.22;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    var bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#1E1B4B'); bg.addColorStop(1, '#0B1120');
    ctx.beginPath();
    if (opts.full) ctx.rect(0, 0, size, size);
    else if (ctx.roundRect) ctx.roundRect(pad, pad, size - 2 * pad, size - 2 * pad, r);
    else ctx.rect(pad, pad, size - 2 * pad, size - 2 * pad);
    ctx.fillStyle = bg; ctx.fill();
    var glow = ctx.createRadialGradient(size / 2, size * 0.46, 0, size / 2, size * 0.46, size * 0.45);
    glow.addColorStop(0, 'rgba(245,183,10,0.28)'); glow.addColorStop(1, 'rgba(245,183,10,0)');
    ctx.fillStyle = glow; ctx.fill();
    ctx.restore();
    var units = 64, unit = size / units * (opts.zoom || 0.74);
    ctx.save();
    ctx.translate((size - units * unit) / 2, (size - units * unit) / 2);
    var pal = palette('dark');
    ctx.scale(unit, unit);
    ctx.translate(32, 38);
    [1, -1].forEach(function (side) { ctx.save(); ctx.translate(side * 6.5, -5); ctx.scale(side, 1); wing(ctx, 0.9, 42, pal); ctx.restore(); });
    rupee(ctx, pal, 32);
    ctx.restore();
  }

  window.KharchaWings = { draw: draw, at: at, RUN: RUN, icon: icon };
})();
