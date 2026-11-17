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

  // Smoothness: every feather type and the ₹ are painted ONCE into a small canvas and then stamped with
  // drawImage (cheap, GPU-friendly). Painting 74 gradient feathers per frame made the wings stutter on phones.
  var sprites = {};
  var SL = 150, SW = 40, SPAD = 6;                    // sprite feather length / width in px, padding
  function featherSprite(c1, c2, edge, shaft) {
    var key = c1 + c2 + edge + shaft;
    if (sprites[key]) return sprites[key];
    var cv = document.createElement('canvas');
    cv.width = SL + SPAD * 2; cv.height = SW * 1.4 + SPAD * 2;
    var x = cv.getContext('2d');
    x.translate(SPAD, cv.height / 2);
    feather(x, SL, SW, c1, c2, edge, shaft);
    return (sprites[key] = cv);
  }
  function stamp(ctx, sp, len, wid) {                 // a sprite feather at the origin, pointing along +x
    var sx = len / SL, sy = wid / SW;
    ctx.drawImage(sp, -SPAD * sx, -sp.height / 2 * sy, sp.width * sx, sp.height * sy);
  }
  function featherAt(ctx, sp, x, y, angDeg, len, wid) {
    var a = angDeg * D2R, cs = Math.cos(a), sn = Math.sin(a);
    ctx.save(); ctx.transform(cs, sn, -sn, cs, x, y); stamp(ctx, sp, len, wid); ctx.restore();
  }

  // The right wing (the left one is drawn mirrored). Shoulder at the origin.
  // A real wing beat: the downstroke is quicker than the upstroke (the wave is warped), the forearm and the hand
  // follow the shoulder a moment later (a whip, not a hinge), and on the upstroke the wing flexes at the wrist
  // and the tip feathers close up, then it opens fully for the next downstroke.
  // Below level the stroke is shallower: a real downstroke ends a little under the body line, never hanging down.
  function stroke(ph) { var w = Math.sin(ph + 0.42 * Math.sin(ph)); return w < 0 ? w * 0.62 : w; }
  function wing(ctx, s, flap, pal, beat) {
    var spP = featherSprite(pal.f1, pal.f2, pal.edge, pal.shaft), spS = featherSprite(pal.f1, pal.f3, pal.edge, pal.shaft);
    var spC = featherSprite(pal.c1, pal.c2, pal.edge, pal.shaft), spL = featherSprite(pal.c1, pal.c2, pal.edge, 'rgba(0,0,0,0)');
    var f1 = flap || 0, f2 = f1, f3 = f1;
    if (beat && beat.amp) {
      var A = beat.amp, ph = beat.phase, bias = beat.bias || 0;
      f1 = bias + A * stroke(ph); f2 = bias + A * stroke(ph - 0.28); f3 = bias + A * stroke(ph - 0.62);
      var rising = Math.max(0, Math.cos(ph - 0.3));             // upstroke: the wing folds in a little
      s = s * (1 - 0.2 * rising * Math.min(1, A / 30));
      f3 -= 8 * rising * Math.min(1, A / 30);                   // the hand bends down a little on the way up
    }
    // Bone directions in degrees (0 = right, 90 = down). Folded: tucked down behind the body. Open: spread up and out.
    var a1 = lerp(78, -34 - f1 * 0.9, s), a2 = lerp(208, -14 - f2 * 1.05, s), a3 = lerp(96, 16 - f3 * 1.25, s);
    var k = lerp(0.42, 1, ease(s)) * 0.68;
    var L1 = 7 * k, L2 = 9 * k, L3 = 8.5 * k;
    var d1 = dir(a1), d2 = dir(a2), d3 = dir(a3);
    var E = { x: d1.x * L1, y: d1.y * L1 }, Wr = { x: E.x + d2.x * L2, y: E.y + d2.y * L2 }, T = { x: Wr.x + d3.x * L3, y: Wr.y + d3.y * L3 };
    var fan = ease(s);

    // primaries: the long flight feathers fanned from the hand (outermost first, so inner ones lie on top)
    for (var i = 9; i >= 0; i--) {
      var q = i / 9, px = lerp(Wr.x, T.x, 0.15 + 0.85 * q), py = lerp(Wr.y, T.y, 0.15 + 0.85 * q);
      var ang = a3 + lerp(lerp(78, 6, q), lerp(16, 4, q), 1 - fan), len = (15 + 7 * Math.sin(q * 2.6 + 0.3)) * k;
      featherAt(ctx, spP, px, py, ang, len, 3.7 * k);
    }
    // secondaries: along the forearm, trailing edge
    for (var j = 8; j >= 0; j--) {
      var r = j / 8, sx = lerp(E.x, Wr.x, r), sy = lerp(E.y, Wr.y, r);
      var ang2 = a2 + lerp(lerp(118, 84, r), 168, 1 - fan), len2 = (11.5 + 1.5 * r) * k;
      featherAt(ctx, spS, sx, sy, ang2, len2, 3.5 * k);
    }
    // greater coverts: a shorter row over the base of the flight feathers
    for (var c = 10; c >= 0; c--) {
      var u = c / 10, onHand = u > 0.62, bx, by, base;
      if (onHand) { var w = (u - 0.62) / 0.38; bx = lerp(Wr.x, T.x, w * 0.8); by = lerp(Wr.y, T.y, w * 0.8); base = a3 + lerp(62, 12, w); }
      else { var v = u / 0.62; bx = lerp(E.x, Wr.x, v); by = lerp(E.y, Wr.y, v); base = a2 + lerp(112, 90, v); }
      var ang3 = lerp(base + (onHand ? 10 : 70), base, fan);
      featherAt(ctx, spC, bx, by, ang3, 6.2 * k, 2.6 * k);
    }
    // the leading edge: a soft rounded band of small feathers over the bones
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(E.x, E.y); ctx.lineTo(Wr.x, Wr.y); ctx.lineTo(lerp(Wr.x, T.x, 0.7), lerp(Wr.y, T.y, 0.7));
    ctx.lineWidth = 3.1 * k; ctx.strokeStyle = pal.band; ctx.stroke();
    ctx.lineWidth = 2.5 * k; ctx.strokeStyle = pal.c2; ctx.stroke();
    // lesser coverts: tiny scallops along the band
    for (var m = 0; m < 7; m++) {
      var z = m / 6, mx = lerp(E.x, Wr.x, z), my = lerp(E.y, Wr.y, z);
      featherAt(ctx, spL, mx, my, a2 + lerp(100, 160, 1 - fan), 3.6 * k, 2 * k);
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

  // The ₹ as a cached sprite at the canvas's resolution (px per unit), one per palette.
  function rupeeSprite(pal, pxPerUnit) {
    var key = 'r' + pal.gEdge + '|' + Math.round(pxPerUnit * 4);
    if (sprites[key]) return sprites[key];
    var box = 44, cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(box * pxPerUnit);
    var x = cv.getContext('2d');
    x.scale(pxPerUnit, pxPerUnit); x.translate(box / 2, box / 2);
    rupee(x, pal, 32);
    return (sprites[key] = { cv: cv, box: box });
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

  // Builds every sprite up front, so the first frames of a flight never pause to paint them.
  function warm(unit, theme) {
    var pal = palette(theme || themeNow());
    featherSprite(pal.f1, pal.f2, pal.edge, pal.shaft); featherSprite(pal.f1, pal.f3, pal.edge, pal.shaft);
    featherSprite(pal.c1, pal.c2, pal.edge, pal.shaft); featherSprite(pal.c1, pal.c2, pal.edge, 'rgba(0,0,0,0)');
    rupeeSprite(pal, unit);
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
        ctx.save(); ctx.translate(side * 6.5, -5); ctx.scale(side, 1); wing(ctx, s, st.flap || 0, pal, st.beat); ctx.restore();
      });
    }
    var rs = rupeeSprite(pal, unit * Math.max(1, st.scale || 1));
    ctx.drawImage(rs.cv, -rs.box / 2, -rs.box / 2, rs.box, rs.box);
    ctx.restore();
  }

  // One run. Times in ms.
  var RUN = { sit: 1600, unfold: 900, beat: 700, away: 1300, gone: 1100, back: 1300, fold: 750 };
  RUN.total = RUN.sit + RUN.unfold + RUN.beat + RUN.away + RUN.gone + RUN.back + RUN.fold;
  // The wing-beat clock. Each part of the flight beats at its own speed (quick on take-off, slow while gliding),
  // and the clock is the running total, so the beat never jumps when the speed changes.
  var SEG = ['sit', 'unfold', 'beat', 'away', 'gone', 'back', 'fold'];
  var RATE = { sit: 1 / 80, unfold: 1 / 70, beat: 1 / 50, away: 1 / 44, gone: 1 / 44, back: 1 / 78, fold: 1 / 90 };   // radians per ms
  function phaseAt(t) {
    var ph = 0, t0 = 0;
    for (var i = 0; i < SEG.length; i++) {
      var d = RUN[SEG[i]], k = Math.min(Math.max(t - t0, 0), d);
      ph += k * RATE[SEG[i]]; t0 += d;
      if (t < t0) break;
    }
    return ph;
  }
  function swing(t) {                                   // how far the wings beat (degrees), continuous over the whole run
    var a = RUN.sit, b = a + RUN.unfold, c = b + RUN.beat, d = c + RUN.away, e = d + RUN.gone, f = e + RUN.back;
    if (t < a) return 0;
    if (t < b) return 14 * ease((t - a) / RUN.unfold);
    if (t < c) return lerp(14, 36, ease((t - b) / RUN.beat));
    if (t < d) return lerp(36, 42, ease((t - c) / RUN.away));
    if (t < e) return 42;
    if (t < f) return lerp(22, 9, ease((t - e) / RUN.back));    // fades in from invisible, so the step from 42 is never seen
    return lerp(9, 0, ease((t - f) / RUN.fold));
  }
  function at(t, opts) {
    opts = opts || {};
    var rise = opts.rise || 60, drift = opts.drift || 0, side = drift > 0 ? 1 : drift < 0 ? -1 : 0;
    var st = { x: 0, y: 0, scale: 1, alpha: 1, spread: 0, flap: 0, tilt: 0, bob: 0, beat: null };
    var a = RUN.sit, b = a + RUN.unfold, c = b + RUN.beat, d = c + RUN.away, e = d + RUN.gone, f = e + RUN.back, g = f + RUN.fold;
    var bias = 0;                                       // wings held up in a shallow V while gliding
    if (t < a) { st.bob = Math.sin(t / 420) * 0.5; }
    else if (t < b) {                                   // wings open out from behind the ₹
      var k = (t - a) / RUN.unfold; st.spread = easeOut(k); st.y = -1.2 * ease(k);
    } else if (t < c) {                                 // a few strong beats in place, lifting off
      var k2 = (t - b) / RUN.beat; st.spread = 1; st.y = -1.2 - 3.4 * ease(k2); st.tilt = -3 * side * ease(k2);
    } else if (t < d) {                                 // flies up and away on a gentle curve, getting smaller
      var k3 = (t - c) / RUN.away, up = easeIn(k3);
      st.spread = 1;
      st.y = -4.6 - rise * up;
      st.x = drift * up + 1.6 * Math.sin(k3 * Math.PI) * (side || 1);
      st.scale = 1 - 0.55 * ease(k3);
      st.tilt = side * (-3 + 17 * ease(k3));            // banks into the turn
      st.alpha = 1 - ease((k3 - 0.55) / 0.45);
    } else if (t < e) { st.alpha = 0; }
    else if (t < f) {                                   // glides back down, a few lazy beats, wings in a V
      var k4 = (t - e) / RUN.back, inK = easeOut(k4);
      st.spread = 1; bias = 10 * (1 - ease((k4 - 0.6) / 0.4));
      st.y = -rise * (1 - inK); st.x = -drift * 0.4 * (1 - inK) + 0.8 * Math.sin(k4 * 5) * (1 - k4);
      st.scale = 0.5 + 0.5 * inK; st.alpha = ease(k4 / 0.4); st.tilt = -side * 8 * (1 - inK);
    } else if (t < g) {                                 // lands: a soft settle, then the wings tuck away
      var k5 = (t - f) / RUN.fold; st.spread = 1 - ease(k5);
      st.y = 0.9 * Math.sin(Math.min(1, k5 / 0.55) * Math.PI) * (1 - k5);   // the knees give a little on touchdown
    }
    var amp = swing(t);
    if (st.spread > 0 && (amp > 0 || bias)) {
      var ph = phaseAt(t);
      st.beat = { amp: amp, phase: ph, bias: bias };
      st.flap = bias + amp * Math.sin(ph);
      st.y += 1.1 * (amp / 40) * Math.cos(ph - 0.6);     // each downstroke lifts the body a little
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

  window.KharchaWings = { draw: draw, at: at, RUN: RUN, icon: icon, warm: warm };
})();
