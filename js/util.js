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

// ---- TEXT IS A BITMAP FACE NOW --------------------------------------------
//
// Text was set in VT323 -- a real font file, so the browser hints and
// anti-aliases it. At size 6 on a canvas scaled by DPX that means grey glyph
// edges landing on fractional pixels, over sprites authored at four hard texels
// per logical unit. It is the loudest non-pixel-art thing on the screen and no
// amount of styling fixes it, because the blur is the renderer's, not ours.
//
// js/pixfont.js is a hand-authored 4x6 face instead: one fillRect per lit
// pixel, baked to an atlas, blitted with smoothing off. Hard edges at every
// scale, identical on every machine.
//
// THE ONE CONSTRAINT: a line must never come out WIDER than what it replaces.
// A dozen panels here wrap by character count and size their boxes off
// textWidth, so a wider face would overflow all of them at once. The font-pixel
// size is therefore FLOORED out of the old advance (size * FONT_SCALE * 0.6 per
// character, which is the figure the wrap code already assumes) rather than
// picked by eye -- every line comes out the same width or slightly narrower,
// and never longer.
//
// _fontPx returns DEVICE pixels per font pixel: an integer, so a glyph can
// never land on a half pixel however the canvas is scaled.
function _fontPx(size) {
  const advance = size * FONT_SCALE * 0.6;                  // logical, per char
  return clamp(Math.floor(advance / (PixFont.W + PixFont.GAP) * DPX), 2, 14);
}
function _advance(size) { return _fontPx(size) * (PixFont.W + PixFont.GAP) / DPX; }

function text(ctx, str, x, y, opts = {}) {
  const { size = 8, color = '#fff', align = 'left', shadow = true } = opts;
  str = String(str);
  const px = _fontPx(size);
  const adv = px * (PixFont.W + PixFont.GAP) / DPX;
  const gw = px * PixFont.W / DPX, gh = px * PixFont.H / DPX;
  const total = adv * str.length;

  let sx = x;
  if (align === 'center') sx = x - total / 2;
  else if (align === 'right') sx = x - total;
  // the old em box carried leading above the cap; the bitmap starts at its first
  // lit row, so nudge down and keep every call site's y meaning what it meant
  let sy = y + (size * FONT_SCALE - gh) * 0.34;
  const q = 1 / DPX;
  sx = Math.round(sx / q) * q;
  sy = Math.round(sy / q) * q;

  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (shadow) _blit(ctx, str, sx + q, sy + q, px, gw, gh, adv, 'rgba(0,0,0,0.7)');
  _blit(ctx, str, sx, sy, px, gw, gh, adv, color);
  ctx.imageSmoothingEnabled = sm;
}

function _blit(ctx, str, sx, sy, px, gw, gh, adv, colour) {
  const at = PixFont.atlas(px, colour);
  const cw = PixFont.W * px, chh = PixFont.H * px;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === ' ') continue;
    let idx = PixFont._idx[ch];
    if (idx === undefined) idx = PixFont._idx[ch.toUpperCase()];
    if (idx === undefined) idx = PixFont._idx['?'];
    ctx.drawImage(at, idx * cw, 0, cw, chh, sx + i * adv, sy, gw, gh);
  }
}

function textWidth(ctx, str, size = 8) {
  return _advance(size) * String(str).length;
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

// ---- CIRCLES, IN TEXELS ------------------------------------------------------
//
// ctx.arc draws an anti-aliased curve. On a screen where every other edge is a
// hard texel boundary, a soft round blob is the one thing that reads as a
// different program showing through -- and there is no styling that fixes it,
// because the problem is the sub-pixel coverage itself.
//
// So: no arcs in the world. A disc is horizontal spans snapped to the sprite
// grid, which is the stair-stepped edge a hand-drawn circle has. A ring is the
// same spans with the middle left out. Both cost one fillRect per texel row,
// which is a couple of dozen for anything the size of a bubble.
function pixDisc(ctx, cx, cy, r, col, q) {
  const S = q || APIX;
  if (r < S) return;
  const snap = (v) => Math.round(v / S) * S;
  if (col) ctx.fillStyle = col;
  const x0 = snap(cx), y0 = snap(cy);
  for (let dy = -r; dy <= r; dy += S) {
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (hw < S * 0.5) continue;
    ctx.fillRect(snap(x0 - hw), snap(y0 + dy), Math.max(S, snap(hw * 2)), S);
  }
}

// `thick` is the wall thickness in logical units, measured inwards.
function pixRing(ctx, cx, cy, r, col, thick, q) {
  const S = q || APIX;
  if (r < S) return;
  const t = Math.max(S, thick || S);
  const ri = Math.max(0, r - t);
  const snap = (v) => Math.round(v / S) * S;
  if (col) ctx.fillStyle = col;
  const x0 = snap(cx), y0 = snap(cy);
  for (let dy = -r; dy <= r; dy += S) {
    const ho = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (ho < S * 0.5) continue;
    const hi = Math.abs(dy) <= ri ? Math.sqrt(Math.max(0, ri * ri - dy * dy)) : 0;
    if (hi < S * 0.5) {
      ctx.fillRect(snap(x0 - ho), snap(y0 + dy), Math.max(S, snap(ho * 2)), S);
    } else {
      const w = Math.max(S, snap(ho - hi));
      ctx.fillRect(snap(x0 - ho), snap(y0 + dy), w, S);
      ctx.fillRect(snap(x0 + hi), snap(y0 + dy), w, S);
    }
  }
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


// ---- THE UI PALETTE -------------------------------------------------------
//
// These are the EXACT nine colours the HUD icon art is painted from (the trophy
// and satchel grids in js/uibar.js). The chrome is built out of the same ramps
// so a panel and a button icon look like they were drawn by the same hand on
// the same day: a hard #2a1b10 outline round everything, a three-step leather
// ramp, a three-step gold ramp, and one highlight that doubles as the paper.
//
// Nothing here blends. Pixel art gets its depth from STEPPED ramps and dither,
// not from gradients -- a smooth fill at this density reads as a web page with
// sprites on it.
const UIPAL = {
  // SAMPLED, not chosen. These are the colours the HUD icon art is actually
  // painted from -- assets/ui_craft.png, ui_skills.png and ui_bag.png quantised
  // and intersected, so the chrome and the icons are literally the same ramp.
  out:  '#30150a',   // the near-black outline every icon wears
  dark: '#662907',   // deep brown, the frame's shadow side
  mid:  '#914007',   // mid brown
  fr:   '#c56906',   // the frame face -- bright orange-brown
  lit:  '#e08a1a',   // frame, sun side (fr stepped toward the panel)
  warm: '#e3ab61',   // light tan, one step under the panel
  w:    '#f4bf69',   // THE PANEL. Warm parchment gold, not cream.
  p2:   '#e3ab61',   // paper, one step down (== warm)
  p3:   '#c98f45',   // paper, two steps down: the curl and the torn edge
  // kept for callers that still name the old gold ramp
  b:    '#662907',
  t:    '#914007',
  c:    '#c56906',
  d:    '#914007',
  m:    '#e08a1a',
  l:    '#f4bf69',
  sh:   '#30150a',
  rule: '#b07a3a',   // the ruled line, a tint of the frame so it belongs
  hi:   '#f8d089',
  p:    '#f4bf69',   // one step ABOVE the panel: cards, so they read as raised
  ink:  '#30150a',   // primary text
  ink2: '#662907',   // secondary text
  ink3: '#914007',   // dim text
};


// A dither wash: every other texel of `col` on a 2x2 lattice, which is how a
// pixel artist gets a half-tone without a new colour. Clipped by the caller.
function pixDither(ctx, x, y, w, h, col, step = 2) {
  // ONE FILLRECT PER LATTICE POINT, and the lattice is w*h/(S*step)^2 points.
  // At S = 0.5 and step = 1 over a 244x180 panel that is 175,000 fillRects in a
  // single call -- per frame. That is what "the game lags" was. The step is
  // clamped so a caller can never ask for a finer lattice than two texels, and
  // the whole thing bails out if the area is still absurd.
  const S = APIX;
  const st = Math.max(2, step | 0);
  const cell = S * st;
  if (w <= 0 || h <= 0) return;
  if ((w / cell) * (h / cell) > 6000) return;      // refuse to melt the frame
  ctx.fillStyle = col;
  const x0 = Math.round(x / S) * S, y0 = Math.round(y / S) * S;
  let row = 0;
  for (let j = 0; j < h; j += cell, row++) {
    for (let i = (row & 1) ? cell / 2 : 0; i < w; i += cell) {
      ctx.fillRect(x0 + i, y0 + j, S, S);
    }
  }
}

// A hard pixel border: `n` texels of colour, drawn as four rects, no strokes and
// no half pixels. This is what makes a panel read as drawn rather than as CSS.
function pixEdge(ctx, x, y, w, h, col, n = 1) {
  const S = APIX, t = S * n;
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
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
    // LIGHTER. This was a very dark page (#241a12) in a dark frame, and every
    // big menu in the game uses it -- the bag, the trades, the crafting board --
    // so the whole interior of the game read as brown gloom. Warm driftwood and
    // a sand-coloured page instead: still clearly the darker of the two panels,
    // still high enough contrast for pale ink, but it is a lit room now.
    fill: '#4a3a2c', fill2: '#3d2f23', out: '#1d1209',
    wood: '#8a6440', lit: '#b98a5a', dim: '#54341c',
    knob: '#a8764a', knobLit: '#d8a870', pin: '#ffd48a',
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

// ---- THE NOTEBOOK PAGE -----------------------------------------------------
//
// uiPanel is furniture: a carved wooden frame, right for a sign or a tracker
// hanging on the world. The big menus are not furniture -- they are Otto's
// NOTEBOOK, and the journal has been drawn that way for a while. This is that
// page, extracted so the bag, the trades and the crafting board are the same
// object: torn cream paper, faint blue rules, a red margin down the left, three
// punched holes, and a strip of tape at each corner holding it to the screen.
//
// Everything is fillRect on the art's own texel grid. The "hand-drawn" of it is
// in the irregularities: the tear along the edges wobbles, the rules stop short
// of the margin, the tape sits at a slight angle. All of it is derived from x/y
// so it is stable frame to frame -- a page that shimmered would be worse than a
// rectangle.

// ---- THE PANEL FRAME ------------------------------------------------------
//
// Stardew's menu anatomy, which is what this was asked to look like and what
// torn notebook paper was never going to be:
//
//   * a THICK border band, bevelled -- lit along the top and left, shadowed
//     along the bottom and right, so it reads as carved wood rather than as a
//     coloured stroke
//   * a one-texel dark outline on BOTH sides of that band: the outer one seats
//     the panel on any background, the inner one separates wood from paper
//   * a rounded STUD over each corner, with its own bright pin -- the detail
//     that makes a frame read as furniture instead of as a rectangle
//   * an interior that is SHADED: a banded vertical ramp, lit at the top and
//     falling to the shadow at the bottom, dithered at every seam
//
// The shading is banded and dithered rather than a canvas gradient on purpose.
// A real gradient at this density produces hundreds of intermediate colours and
// reads as a web page; four steps with a dithered seam is how the ramp is done
// in the art, and it matches the sprites beside it.
function uiFrame(ctx, x, y, w, h, opts = {}) {
  const { border = 3, alpha = 1, studs = true, top = null, bot = null } = opts;
  const S = APIX;
  const snap = (v) => Math.round(v / S) * S;
  x = snap(x); y = snap(y); w = Math.max(12 * S, snap(w)); h = Math.max(12 * S, snap(h));
  const B = border * S;

  ctx.save();
  ctx.globalAlpha = alpha;

  // the shadow it sits on -- two flat steps, never a blur
  ctx.fillStyle = 'rgba(24,12,4,0.34)';
  ctx.fillRect(x + S * 4, y + S * 5, w, h);
  ctx.fillStyle = 'rgba(24,12,4,0.20)';
  ctx.fillRect(x + S * 2, y + S * 3, w, h);

  // the border band, then its bevel
  ctx.fillStyle = UIPAL.fr;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = UIPAL.lit;                       // sun side: top and left
  ctx.fillRect(x + S, y + S, w - S * 2, S * 2);
  ctx.fillRect(x + S, y + S, S * 2, h - S * 2);
  ctx.fillStyle = UIPAL.mid;                       // shadow side: bottom and right
  ctx.fillRect(x + S, y + h - B, w - S * 2, B - S);
  ctx.fillRect(x + w - B, y + S, B - S, h - S * 2);
  ctx.fillStyle = UIPAL.dark;
  ctx.fillRect(x + S, y + h - S * 2, w - S * 2, S);
  ctx.fillRect(x + w - S * 2, y + S, S, h - S * 2);

  // outer outline, then the interior with its inner outline
  pixEdge(ctx, x, y, w, h, UIPAL.out, 1);
  const ix = x + B, iy = y + B, iw = w - B * 2, ih = h - B * 2;
  pixEdge(ctx, ix - S, iy - S, iw + S * 2, ih + S * 2, UIPAL.dark, 1);

  // THE SHADED INTERIOR: four steps down the page with a dithered seam
  const A = hexRGB(top || UIPAL.hi), Z = hexRGB(bot || UIPAL.warm);
  const bands = 4, bh = ih / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = cssRGB(rgbLerp(A, Z, i / (bands - 1)));
    ctx.fillRect(ix, iy + bh * i, iw, bh + S);
    if (i > 0) {                                   // dither the seam upward
      ctx.fillStyle = cssRGB(rgbLerp(A, Z, (i - 1) / (bands - 1)));
      for (let dx = (i & 1) ? 0 : S; dx < iw; dx += S * 2) ctx.fillRect(ix + dx, iy + bh * i, S, S);
    }
  }

  // the corner studs
  if (studs) {
    const k = B + S * 3;
    for (let c = 0; c < 4; c++) {
      const cx = c & 1 ? x + w - k - S : x + S, cy = c & 2 ? y + h - k - S : y + S;
      ctx.fillStyle = UIPAL.out;
      ctx.fillRect(cx, cy, k, k);
      ctx.fillStyle = UIPAL.mid;
      ctx.fillRect(cx + S, cy + S, k - S * 2, k - S * 2);
      ctx.fillStyle = UIPAL.lit;
      ctx.fillRect(cx + S, cy + S, k - S * 3, S);
      ctx.fillRect(cx + S, cy + S, S, k - S * 3);
      ctx.fillStyle = UIPAL.p;                     // the bright pin
      ctx.fillRect(cx + k / 2 - S / 2, cy + k / 2 - S / 2, S, S);
    }
  }
  ctx.restore();
  return { x: ix, y: iy, w: iw, h: ih };
}

function uiPage(ctx, x, y, w, h, alpha = 1) {
  // A BIG menu: a wide carved border and a shaded page inside it. The torn
  // notebook sheet that used to live here -- punch holes, red margin, tape --
  // was a different game's furniture; this is the frame the icons belong to.
  const r = uiFrame(ctx, x, y, w, h, { border: 8, alpha: alpha });
  // the faintest ruling across the page, so a wall of text still has a grid to
  // sit on without the panel pretending to be paper
  ctx.save();
  ctx.globalAlpha = alpha * 0.16;
  ctx.fillStyle = UIPAL.mid;
  for (let ry = r.y + 12; ry < r.y + r.h - 4; ry += 9) ctx.fillRect(r.x + 6, ry, r.w - 12, APIX);
  ctx.restore();
  return r;
}

// BOUNCE. A back-out curve: overshoots past 1 and settles, which is what makes a
// panel feel like it was tossed down rather than faded up. k is 0..1 in, and
// uiPopOut mirrors it for a panel leaving.
function uiPop(k) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}
function uiPopOut(k) { return 1 - uiPop(1 - clamp(k, 0, 1)); }

// A drawn wax seal: a blob with a highlight and a pressed rim. Pixel art, so it
// is rects on the texel grid rather than an arc.
function uiSeal(ctx, cx, cy, r, col) {
  const S = APIX, q = (v) => Math.round(v / S) * S;
  ctx.fillStyle = '#5a1410';
  for (let dy = -r; dy <= r; dy += S) {
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (hw < S) continue;
    ctx.fillRect(q(cx - hw), q(cy + dy), q(hw * 2), S);
  }
  ctx.fillStyle = col || '#a8261e';
  for (let dy = -r + S; dy <= r - S; dy += S) {
    const hw = Math.sqrt(Math.max(0, (r - S) * (r - S) - dy * dy));
    if (hw < S) continue;
    ctx.fillRect(q(cx - hw), q(cy + dy), q(hw * 2), S);
  }
  ctx.fillStyle = 'rgba(255,220,200,0.30)';
  ctx.fillRect(q(cx - r * 0.5), q(cy - r * 0.55), q(r * 0.7), S);
  ctx.fillStyle = 'rgba(60,10,8,0.45)';
  ctx.fillRect(q(cx - r * 0.35), q(cy + r * 0.25), q(r * 0.7), S);
}

// The open/close transition every big menu shares: a page does not blink on, it
// is put down. Scale from 0.88 with a small overshoot, fade the backdrop in, and
// hand back a boolean for "still animating". k is 0..1.
function uiPageOpen(ctx, k, cx, cy) {
  // A panel does not fade in, it is SET DOWN: overshoot past full size, settle
  // back, with a little tilt that unwinds as it lands. The backdrop darkens on
  // its own curve so the room dims before the panel has finished arriving.
  // uiPop OVERSHOOTS past 1 and settles, so the panel lands with a bounce rather
  // than easing politely up to size. The extra sine is the second, smaller
  // rebound -- one overshoot reads as a glitch, two read as weight.
  const e = uiPop(k);
  const spring = Math.sin(Math.min(1, k) * Math.PI) * 0.03;
  const sc = 0.80 + 0.20 * e + spring;
  ctx.fillStyle = `rgba(8,12,18,${(0.6 * Math.min(1, k * 1.6)).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.rotate((1 - e) * -0.06);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = Math.min(1, k * 2.2);
}

// ---- hand-drawn ink -------------------------------------------------------
//
// A pen wobbles. A rectangle drawn on a notebook page never has four straight
// sides and never closes exactly where it started, and that is the entire
// difference between "a UI box on top of a paper texture" and "somebody drew
// this box". Everything below wobbles by a hash of the COORDINATE it is drawn
// at, so the same box wobbles the same way on every frame -- a wobble reseeded
// per frame is a crawling outline, which reads as broken rather than hand-made.
//
// inkN(a, b) -> -0.5..0.5. Two integers in, one stable fraction out.
function inkN(a, b) {
  let s = (Math.round(a) * 374761393 + Math.round(b) * 668265263) | 0;
  s = Math.imul(s ^ (s >>> 13), 1274126177);
  return (((s ^ (s >>> 16)) >>> 0) % 1024) / 1023 - 0.5;
}

// The bowed segment ALONE, continuing from wherever the pen already is. Path
// builders must use this one: a moveTo in the middle of a path starts a new
// subpath, and a shape made of disconnected subpaths still strokes perfectly
// while silently refusing to fill -- every outline correct, every interior
// empty, and nothing anywhere reporting an error.
function inkCurveTo(ctx, x0, y0, x1, y1, bow = 1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const b = inkN(x0 + y1, x1 + y0) * bow * 2;
  ctx.quadraticCurveTo((x0 + x1) / 2 - (dy / len) * b, (y0 + y1) / 2 + (dx / len) * b, x1, y1);
}

// A pen stroke between two points: straight, but bowed by a hair and with the
// bow fixed by the endpoints, so a link never wriggles. Standalone -- it lifts
// the pen first, so it is for STROKING batches of separate lines.
function inkLine(ctx, x0, y0, x1, y1, bow = 1) {
  ctx.moveTo(x0, y0);
  inkCurveTo(ctx, x0, y0, x1, y1, bow);
}

// A drawn box. Corners land a fraction off where they should, and the outline
// overshoots at the start the way a pen does when you go round twice.
function inkBoxPath(ctx, x, y, w, h, wob = 1.1) {
  const p = [
    [x + inkN(x, y) * wob, y + inkN(y, x) * wob],
    [x + w + inkN(x + w, y) * wob, y + inkN(y, x + w) * wob],
    [x + w + inkN(x + w, y + h) * wob, y + h + inkN(y + h, x + w) * wob],
    [x + inkN(x, y + h) * wob, y + h + inkN(y + h, x) * wob],
  ];
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) inkCurveTo(ctx, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], wob * 0.5);
  inkCurveTo(ctx, p[3][0], p[3][1], p[0][0], p[0][1], wob * 0.5);
  ctx.closePath();
}

// The whole thing: a drawn box, filled and outlined, with the outline gone over
// twice at slightly different weights so it reads as pencil rather than vector.
function inkBox(ctx, x, y, w, h, fill, ink, lw = PIX * 2) {
  inkBoxPath(ctx, x, y, w, h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (!ink) return;
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.globalAlpha *= 0.4;          // the second pass, lighter and a touch off
  inkBoxPath(ctx, x + 0.4, y + 0.35, w, h, 1.4);
  ctx.lineWidth = lw * 0.7;
  ctx.stroke();
  ctx.globalAlpha /= 0.4;
  ctx.lineWidth = 1;
}

// A SLIP OF PAPER, for everything that is not a full page: the dialogue box,
// the quest card, the HUD plates, the interact prompt, toasts.
//
// uiPage is a whole sheet out of the notebook -- punch holes, a red margin, tape
// at four corners -- and all of that is nonsense at 120x30. This is the same
// paper with only the details that survive being small: a torn edge, a warm
// curl down two sides, and (optionally) the ruling. Everything wobbles by its
// COORDINATE so a note that is redrawn every frame holds still.
function uiNote(ctx, x, y, w, h, opts = {}) {
  // A SMALL plate -- HUD chips, prompts, toasts, the dialogue box. Same
  // anatomy, a narrower border, and studs only when it is big enough to carry
  // them without the corners eating the whole plate.
  const { alpha = 1, rules = false, tint = null } = opts;
  const r = uiFrame(ctx, x, y, w, h, {
    border: 4, alpha: alpha, studs: Math.min(w, h) >= 30,
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tint) { ctx.fillStyle = tint; ctx.fillRect(r.x, r.y, r.w, r.h); }
  if (rules) {
    ctx.globalAlpha = alpha * 0.18;
    ctx.fillStyle = UIPAL.mid;
    for (let ry = r.y + 9; ry < r.y + r.h - 3; ry += 9) ctx.fillRect(r.x + 3, ry, r.w - 6, APIX);
  }
  ctx.restore();
  return r;
}

// A button somebody drew on the page and coloured in. Live buttons carry a
// pencil hatch under the bottom edge, the way you would shade a box to make it
// look like it sticks up; hovering presses it flat against the paper. Same
// contract as uiButton so the two are interchangeable.
function inkButton(ctx, r, label, enabled, hover, t = 0) {
  const S = APIX;
  // (NO IDLE BOUNCE. Every button on screen lifting on its own sine read as
  // the UI vibrating, not as life -- a button should move when you touch it.)
  const snap = (v) => Math.round(v / S) * S;
  const x = snap(r.x), y = snap(r.y + (enabled && hover ? S * 2 : 0));
  const w = snap(r.w), h = snap(r.h);

  if (enabled && !hover) {                     // it stands off the page
    ctx.fillStyle = UIPAL.sh;
    ctx.fillRect(x + S * 2, y + h, w - S * 2, S * 2);
    ctx.fillRect(x + w, y + S * 2, S * 2, h - S * 2);
  }
  // a THREE-STEP ramp, the same one the trophy is painted with: light along the
  // sun side, mid for the body, dark along the shadow side. No gradient.
  ctx.fillStyle = enabled ? (hover ? UIPAL.l : UIPAL.m) : '#b8ab92';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = enabled ? UIPAL.l : '#cfc3ab';
  ctx.fillRect(x, y, w, S * 2);
  ctx.fillRect(x, y, S * 2, h);
  ctx.fillStyle = enabled ? UIPAL.d : '#8f8574';
  ctx.fillRect(x, y + h - S * 2, w, S * 2);
  ctx.fillRect(x + w - S * 2, y, S * 2, h);
  if (enabled) {                               // two flat glints, not a wash
    ctx.fillStyle = UIPAL.p;
    ctx.fillRect(x + S * 3, y + S * 3, S * 2, S);
    ctx.fillRect(x + w - S * 7, y + S * 3, S * 4, S);
  }
  pixEdge(ctx, x, y, w, h, UIPAL.out, 1);

  textFit(ctx, label, x + w / 2, y + h / 2 - 4, w - 10, {
    size: 7.5, align: 'center', shadow: false,
    color: enabled ? UIPAL.out : '#7b7060',
  });
}

// A close button for a paper page: a drawn box with a drawn cross in it, not a
// wooden plaque. Same rect contract as uiClose so they are interchangeable.
function inkClose(ctx, r, hover) {
  inkBox(ctx, r.x, r.y, r.w, r.h,
    hover ? UIPAL.lit : UIPAL.hi, hover ? UIPAL.dark : UIPAL.mid, PIX * 2);
  PixIcons.draw(ctx, 'close', r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) - 3, {
    t: (typeof Game !== 'undefined' ? Game.time : 0), fx: hover ? 'tick' : null });
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