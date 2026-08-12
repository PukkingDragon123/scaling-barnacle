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
const FONT_SCALE = 1.35;
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