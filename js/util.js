// ---- shared helpers ----------------------------------------------------
'use strict';

const W = 480, H = 270;   // logical resolution: all game code works in these units
const DPX = 4;            // art density: device texels per logical unit
const PIX = 1 / DPX;      // one device texel, in logical units (for fine detail)
const APIX = 0.5;         // texel size of hand-authored sprites, in logical units
const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;

function rand(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); }
function irand(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// deterministic RNG for node layouts
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function weightedPick(pairs, r) {
  // pairs: [[value, weight], ...], r in [0,1)
  let total = 0;
  for (const p of pairs) total += Math.max(0, p[1]);
  if (total <= 0) return pairs[0][0];
  let x = r * total;
  for (const p of pairs) {
    x -= Math.max(0, p[1]);
    if (x <= 0) return p[0];
  }
  return pairs[pairs.length - 1][0];
}

// All text goes through here, in the game's pixel face (js/font.js). VT323 runs
// narrower and lighter than the bold Courier this used to set, so the size is
// scaled up ~1.35x INSIDE the helper: every call site keeps its old numbers and
// its old layout math, and textWidth measures with the same scaling so nothing
// drifts. `bold` is accepted and ignored -- a pixel font has one weight.
// VT323 runs narrower and lighter than the bold Courier this used to set, so it
// is scaled up inside the helper and every call site keeps its old numbers. 1.35
// was too much: at that multiplier a size-8 dialogue line renders at 10.8px and
// the text reads oversized against the art -- it was sized to fill the old
// Courier's box rather than to sit right. 1.15 keeps the face legible at 6pt
// without shouting at 8.
const FONT_SCALE = 1.15;
function _fontFor(size) {
  const fam = typeof FONT_FAMILY !== 'undefined' ? `'${FONT_FAMILY}', ` : '';
  return `${Math.round(size * FONT_SCALE * 2) / 2}px ${fam}"Courier New", monospace`;
}

function text(ctx, str, x, y, opts = {}) {
  const { size = 8, color = '#fff', align = 'left', shadow = true } = opts;
  ctx.font = _fontFor(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function textWidth(ctx, str, size = 8) {
  ctx.font = _fontFor(size);
  return ctx.measureText(str).width;
}

// TEXT THAT FITS THE BOX IT IS IN.
//
// text() draws whatever it is given at whatever size it is given, and every
// fixed-width panel in the game clips. That is where "the text bugs and goes
// below" comes from: the quest tracker is 118 units wide and its hint line was
// "Fintan has the next one -- go and ask", so the player read "...go and as".
//
// textFit shrinks first (down to `min`, because a slightly smaller line is
// always better than a truncated one) and only then cuts, and when it cuts it
// says so with an ellipsis instead of stopping mid-word. Returns the size it
// actually used, so a caller can advance its own layout by the right amount.
function textFit(ctx, str, x, y, maxW, opts = {}) {
  const { size = 8, min = 5 } = opts;
  let s2 = size;
  while (s2 > min && textWidth(ctx, str, s2) > maxW) s2 -= 0.5;
  if (textWidth(ctx, str, s2) > maxW) {
    let cut = String(str);
    while (cut.length > 1 && textWidth(ctx, cut + '...', s2) > maxW) cut = cut.slice(0, -1);
    str = cut.replace(/[\s\-]+$/, '') + '...';
  }
  text(ctx, str, x, y, Object.assign({}, opts, { size: s2 }));
  return s2;
}

// Greedy word wrap to a pixel width. Returns the lines; the caller decides how
// many it has room for, because "how many lines fit" is a layout question and
// this is a measuring one.
function textWrap(ctx, str, maxW, size = 8) {
  const words = String(str).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (line && textWidth(ctx, t, size) > maxW) { out.push(line); line = w; }
    else line = t;
  }
  if (line) out.push(line);
  return out;
}

function rrect(ctx, x, y, w, h, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

// ---- hi-density pixel-art helpers ----------------------------------------

function hexRGB(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function rgbLerp(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}
function cssRGB(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

// Vertical gradient rendered as flat pixel-art bands with dithered seams —
// reads as hand-placed color, not a smooth CSS gradient.
function bandedFill(ctx, x, y, w, h, from, to, bands = 10, dither = true) {
  const bh = h / bands;
  for (let i = 0; i < bands; i++) {
    const col = rgbLerp(from, to, i / Math.max(1, bands - 1));
    const by = y + bh * i;
    ctx.fillStyle = cssRGB(col);
    ctx.fillRect(x, by, w, bh + 0.6);
    if (dither && i > 0) {
      ctx.fillStyle = cssRGB(rgbLerp(from, to, (i - 1) / Math.max(1, bands - 1)));
      const step = 2;
      for (let dx = (i % 2), c = 0; dx < w; dx += step, c++)
        ctx.fillRect(x + dx, by, 1, 1);
    }
  }
}

// Draw a sprite authored at DPX density at its logical size, snapped to the
// device-texel grid so it stays crisp.
function drawSpr(ctx, img, x, y) {
  ctx.drawImage(img, Math.round(x * DPX) / DPX, Math.round(y * DPX) / DPX, img.width * APIX, img.height * APIX);
}

// THE UI PANEL -- one painter, every menu, drawn with Stardew Valley's actual
// frame anatomy rather than a rectangle with a border colour:
//
//   * a THICK bevelled wooden border: sun side up-left, shadow side down-right,
//     so the frame reads as carved wood, not as a stroke
//   * one-texel dark outlines on BOTH sides of the border (outside seats it on
//     any background, inside separates wood from parchment)
//   * round corner KNOBS overlapping each corner -- the signature detail that
//     makes a frame read as furniture -- each with its own brass pin
//   * parchment with a shadowed bottom edge, so the page has thickness
//
// Everything is fillRect on the art's own texel grid (APIX): no strokes, no
// anti-aliasing, no fractional coordinates. Weathered oak and brass, because
// this game's furniture is a pier's.
function uiPanel(ctx, x, y, w, h, alpha = 0.92, light = false) {
  const S = APIX;
  const snap = (v) => Math.round(v / S) * S;
  x = snap(x); y = snap(y); w = Math.max(10 * S, snap(w)); h = Math.max(10 * S, snap(h));
  const B = 3 * S;                       // border: three texels of wood

  const P = light ? {
    fill: '#f2dfae', fill2: '#e3cc95', out: '#2c170b',
    wood: '#9c5b32', lit: '#c98a50', dim: '#6b3a1d',
    knob: '#8a4f2a', knobLit: '#c98a50', pin: '#e9b455',
  } : {
    // THE DARK VARIANT, which every big menu uses (the bag, the skill trees, the
    // crafting board) and which had gone flat. The old palette put the wood at
    // #59371f against a #3a2617 page and the corner knobs at #4e3018 -- BETWEEN
    // the two -- so the bevel had nothing to catch and the knobs were invisible.
    // The result was a plain dark-brown rectangle with a hairline border, sitting
    // in the same game as the journal's carved parchment frame: the same object,
    // apparently made by two different people.
    //
    // These are the same anatomy with the contrast put back. Stained oak against
    // a dark page, a clear sun side and shadow side, knobs a full step LIGHTER
    // than the frame so they stand proud of it, and real brass in the pins.
    fill: '#241a12', fill2: '#1a1109', out: '#0f0803',
    wood: '#6b4526', lit: '#96663c', dim: '#38200f',
    knob: '#8a5a30', knobLit: '#c08a52', pin: '#e9b455',
  };

  ctx.save();
  ctx.globalAlpha = alpha;

  // outer outline, then the wooden ring, then the inner outline, then the page
  ctx.fillStyle = P.out;
  ctx.fillRect(x - S, y - S, w + S * 2, h + S * 2);
  ctx.fillStyle = P.wood;
  ctx.fillRect(x, y, w, h);
  // bevel: lit on the sun side, dim on the shadow side
  ctx.fillStyle = P.lit;
  ctx.fillRect(x, y, w, S);
  ctx.fillRect(x, y, S, h);
  ctx.fillStyle = P.dim;
  ctx.fillRect(x, y + h - S, w, S);
  ctx.fillRect(x + w - S, y, S, h);
  ctx.fillStyle = P.out;
  ctx.fillRect(x + B, y + B, w - B * 2, h - B * 2);
  ctx.fillStyle = P.fill;
  ctx.fillRect(x + B + S, y + B + S, w - (B + S) * 2, h - (B + S) * 2);
  // the page's own shadowed bottom edge
  ctx.fillStyle = P.fill2;
  ctx.fillRect(x + B + S, y + h - B - S * 3, w - (B + S) * 2, S * 2);

  // ---- corner knobs -------------------------------------------------------
  // a 5x5-texel rounded cap centred on each corner, one texel proud of the
  // outline, with a brass pin -- drawn texel by texel from a tiny map
  const KNOB = [
    ' ooo ',
    'oLKKo',
    'oKPKo',
    'oKKDo',
    ' ooo ',
  ];
  const KC = { o: P.out, K: P.knob, L: P.knobLit, D: P.dim, P: P.pin };
  const knob = (kx, ky) => {
    for (let r = 0; r < 5; r++) {
      for (let cN = 0; cN < 5; cN++) {
        const ch = KNOB[r][cN];
        if (ch === ' ') continue;
        ctx.fillStyle = KC[ch];
        ctx.fillRect(kx + (cN - 2) * S, ky + (r - 2) * S, S, S);
      }
    }
  };
  knob(x + S, y + S); knob(x + w - S, y + S);
  knob(x + S, y + h - S); knob(x + w - S, y + h - S);

  ctx.restore();
}

// ---- FX: one recycled pool of pixel particles ------------------------------
//
// Every system in this game that wanted a sparkle grew its own array, its own
// update and its own draw -- and most of the moments that deserve one still have
// nothing: handing in an errand, learning a skill, finishing a craft. This is the
// shared one. It is a FIXED pool, allocated once, so a burst costs no garbage
// however many go off, and it draws with fillRect on the pixel grid: no arcs, no
// gradients, no anti-aliasing, nothing that would read as web chrome.
const FX = {
  MAX: 96,
  p: null,
  _n: 0,

  _ensure() {
    if (this.p) return;
    this.p = new Array(this.MAX);
    for (let i = 0; i < this.MAX; i++) {
      this.p[i] = { t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, g: 0, s: 1, col: '#fff', star: false };
    }
  },
  _slot() {
    this._ensure();
    for (let i = 0; i < this.MAX; i++) if (this.p[i].t <= 0) return this.p[i];
    return null;                      // full: drop it, never grow the pool
  },

  // A burst. `spread` is the speed envelope, `g` the gravity (0 floats, +40
  // falls), `star` draws a four-point twinkle instead of a square.
  burst(x, y, n, opts = {}) {
    const { col = '#ffe66e', spread = 34, g = 26, life = 0.6, s = 1, star = false, up = 0 } = opts;
    for (let i = 0; i < n; i++) {
      const q = this._slot();
      if (!q) return;
      const a2 = rand(0, TAU);
      const sp = rand(spread * 0.35, spread);
      q.t = q.life = life * rand(0.7, 1.25);
      q.x = x + rand(-1.5, 1.5); q.y = y + rand(-1.5, 1.5);
      q.vx = Math.cos(a2) * sp;
      q.vy = Math.sin(a2) * sp - up;
      q.g = g; q.s = s; q.col = col; q.star = star;
    }
  },

  // A ring: particles thrown outward on one plane. Splashes, impacts, a bed
  // settling into the sand.
  ring(x, y, n, opts = {}) {
    const { col = '#dff2ff', r = 30, life = 0.5, s = 1, flat = 0.35 } = opts;
    for (let i = 0; i < n; i++) {
      const q = this._slot();
      if (!q) return;
      const a2 = (i / n) * TAU + rand(-0.2, 0.2);
      q.t = q.life = life * rand(0.8, 1.15);
      q.x = x; q.y = y;
      q.vx = Math.cos(a2) * r;
      q.vy = Math.sin(a2) * r * flat;
      q.g = 0; q.s = s; q.col = col; q.star = false;
    }
  },

  update(dt) {
    if (!this.p) return;
    let live = 0;
    for (let i = 0; i < this.MAX; i++) {
      const q = this.p[i];
      if (q.t <= 0) continue;
      q.t -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += q.g * dt;
      q.vx *= 0.98;
      live++;
    }
    this._n = live;
  },

  draw(ctx) {
    if (!this.p || !this._n) return;
    for (let i = 0; i < this.MAX; i++) {
      const q = this.p[i];
      if (q.t <= 0) continue;
      const k = q.t / q.life;
      ctx.globalAlpha = k > 0.7 ? 1 : k / 0.7;
      ctx.fillStyle = q.col;
      const sz = q.s * (k > 0.5 ? 1 : 0.6);
      const x = Math.round(q.x / APIX) * APIX, y = Math.round(q.y / APIX) * APIX;
      if (q.star) {                   // a four-point twinkle, five rects
        ctx.fillRect(x - sz, y, sz * 3, sz);
        ctx.fillRect(x, y - sz, sz, sz * 3);
      } else {
        ctx.fillRect(x, y, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  },
};

// ---- PANEL CHROME ---------------------------------------------------------
//
// uiPanel draws the FRAME. These draw the things that go on it, and they exist
// because the crafting board and the skill trees were furnishing themselves out
// of rrect(): flat rectangles with a hairline stroke, a bare lowercase `x` for a
// close box, tab strips that were just darker rectangles, and a cream slab for a
// button. Next to the journal -- carved frame, rope rule, paper index tabs, inked
// plates -- they read as a different game's menus.
//
// One set of painters, used by both, so "the UI" is one thing.

// The rope rule the journal runs under its header: two-tone dashes, the pier's
// own line. Everything below it is the page.
function uiRule(ctx, x, y, w, light = true) {
  for (let dx = x; dx < x + w; dx += 6) {
    ctx.fillStyle = light ? '#b08a5c' : '#7a5232';
    ctx.fillRect(dx, y, 4, 1.5);
    ctx.fillStyle = light ? '#8a6a44' : '#4e3018';
    ctx.fillRect(dx + 1, y + 1.5, 4, 1);
  }
}

// A real close box: the frame in miniature, with an inked X, and it lights up
// under the pointer so it is obviously a button.
function uiClose(ctx, r, hover, light = true) {
  uiPanel(ctx, r.x, r.y, r.w, r.h, hover ? 1 : 0.85, light ? !hover : false);
  const px2 = APIX;
  ctx.fillStyle = hover ? '#f6e8c9' : (light ? '#5a3a22' : '#c9a271');
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(r.x + r.w / 2 - 2.5 + i * px2 * 2, r.y + r.h / 2 - 2.5 + i * px2 * 2, px2 * 2, px2 * 2);
    ctx.fillRect(r.x + r.w / 2 + 2.5 - i * px2 * 2 - px2 * 2, r.y + r.h / 2 - 2.5 + i * px2 * 2, px2 * 2, px2 * 2);
  }
}

// A paper index tab. The selected one is the page's own colour and joins it; the
// rest sit behind, darker and a texel lower, the way a stack of dividers does.
function uiTab(ctx, r, label, on, hover, accent) {
  const dy = on ? 0 : 1;
  ctx.fillStyle = on ? '#f2dfae' : (hover ? '#c9ab78' : '#a8895e');
  ctx.fillRect(r.x, r.y + dy, r.w, r.h - dy);
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(r.x, r.y + dy, r.w, 1);
  ctx.fillRect(r.x, r.y + dy, 1, r.h - dy);
  ctx.fillRect(r.x + r.w - 1, r.y + dy, 1, r.h - dy);
  if (!on) { ctx.fillStyle = 'rgba(60,38,18,0.30)'; ctx.fillRect(r.x + 1, r.y + dy + 1, r.w - 2, r.h - dy - 1); }
  if (accent) {                       // the track's colour, along the tab's foot
    ctx.fillStyle = accent;
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.fillRect(r.x + 2, r.y + r.h - 2, r.w - 4, 2);
    ctx.globalAlpha = 1;
  }
  textFit(ctx, label, r.x + r.w / 2, r.y + dy + 3, r.w - 8, {
    size: 7, align: 'center', shadow: false,
    color: on ? '#4a3020' : '#5f4526',
  });
}

// A pressable wooden button: bevel up when live, pressed in when hovered, flat
// and grey when it cannot be used. `t` drives a shine sweep on a live button so
// the thing you are meant to click is the thing that moves.
function uiButton(ctx, r, label, enabled, hover, t = 0) {
  const S = APIX;
  ctx.fillStyle = '#2c170b';
  ctx.fillRect(r.x - S, r.y - S, r.w + S * 2, r.h + S * 2);
  ctx.fillStyle = enabled ? (hover ? '#e9c07a' : '#d9ab63') : '#6a5a48';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = enabled ? (hover ? '#fbe6b4' : '#f0d295') : '#7d6c58';
  ctx.fillRect(r.x, r.y, r.w, S * 2);
  ctx.fillRect(r.x, r.y, S * 2, r.h);
  ctx.fillStyle = enabled ? '#a4763a' : '#4f4336';
  ctx.fillRect(r.x, r.y + r.h - S * 2, r.w, S * 2);
  ctx.fillRect(r.x + r.w - S * 2, r.y, S * 2, r.h);
  if (enabled) {                      // a slow shine, so it reads as live
    const sx = r.x + ((t * 34) % (r.w + 26)) - 13;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(sx, r.y, 5, r.h);
    ctx.restore();
  }
  textFit(ctx, label, r.x + r.w / 2, r.y + r.h / 2 - 4, r.w - 8, {
    size: 7.5, align: 'center', shadow: false,
    color: enabled ? '#4a3020' : '#9a8d7c',
  });
}

// A bevelled trough with a fill: xp, growth, air, anything 0..1. Flat progress
// rectangles were the other thing making these screens look unfinished.
function uiMeter(ctx, x, y, w, h, frac, col, light = false) {
  const S = APIX;
  ctx.fillStyle = light ? '#5a3c22' : '#0f0803';
  ctx.fillRect(x - S, y - S, w + S * 2, h + S * 2);
  ctx.fillStyle = light ? '#c9ab78' : '#2a1d12';
  ctx.fillRect(x, y, w, h);
  const fw = Math.max(0, Math.min(1, frac)) * w;
  if (fw > 0) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';   // a lit top edge on the fill
    ctx.fillRect(x, y, fw, S);
  }
}

// small pixel heart used by the HUD — authored at device density (14x12 texels
// drawn into a 7x6 logical footprint) with outline + shine
function drawHeart(ctx, x, y, kind) {
  // kind: 'full' | 'half' | 'empty'
  const rows = [
    '..ooo...ooo...',
    '.orrro.orrro..',
    'orrhrrorrrrro.',
    'orhrrrrrrrrro.',
    'orrrrrrrrrrro.',
    '.orrrrrrrrro..',
    '..orrrrrrro...',
    '...orrrrro....',
    '....orrro.....',
    '.....oro......',
    '......o.......',
  ];
  const pal = kind === 'empty'
    ? { o: '#1d1016', r: '#3a2330', h: '#4a2f3e' }
    : { o: '#341016', r: '#e8434c', h: '#ff9aa0' };
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      let col = pal[ch];
      if (kind === 'half' && c > 6) col = { o: '#1d1016', r: '#3a2330', h: '#4a2f3e' }[ch];
      ctx.fillStyle = col;
      ctx.fillRect(x + c * APIX, y + r * APIX, APIX, APIX);
    }
  }
}