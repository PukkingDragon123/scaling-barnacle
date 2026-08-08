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

function text(ctx, str, x, y, opts = {}) {
  const { size = 8, color = '#fff', align = 'left', shadow = true, bold = true } = opts;
  ctx.font = `${bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function textWidth(ctx, str, size = 8, bold = true) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
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

// THE UI PANEL, and the whole reason every menu in the game looks like one
// family. This used to be a roundRect with an anti-aliased 1.2px stroke -- which
// is exactly the thing that made the UI read as web chrome floating over pixel
// art: soft corners and hairline borders belong to CSS, not to a game whose
// world is drawn in fat texels.
//
// It is a Stardew-style frame now, built from fillRect strips on the logical
// pixel grid: parchment (or dark driftwood) fill, a thick two-tone wooden
// border, stepped corners instead of rounded ones, and a one-texel outer
// outline to seat it on any background. Nothing here is anti-aliased and
// nothing lands off-grid -- coordinates are snapped to APIX so the frame's
// texels agree with the art's.
function uiPanel(ctx, x, y, w, h, alpha = 0.92, light = false) {
  const S = APIX;                                  // one art texel, logical units
  const snap = (v) => Math.round(v / S) * S;
  x = snap(x); y = snap(y); w = Math.max(6 * S, snap(w)); h = Math.max(6 * S, snap(h));
  const B = 2 * S;                                 // border thickness: two texels
  const C = 2 * S;                                 // corner step size

  const P = light
    ? { fill: '246,230,196', edge: '138,84,52', edge2: '186,128,82', line: '90,52,30', shine: '255,248,228' }
    : { fill: '56,38,26', edge: '32,20,12', edge2: '110,70,44', line: '20,12,7', shine: '140,96,60' };

  ctx.save();
  ctx.globalAlpha = alpha;

  // the body, with the corner steps knocked out
  ctx.fillStyle = `rgb(${P.fill})`;
  ctx.fillRect(x + C, y, w - C * 2, h);
  ctx.fillRect(x, y + C, w, h - C * 2);
  ctx.fillRect(x + S, y + S, w - S * 2, h - S * 2);

  // one-texel dark outline, drawn as strips that follow the stepped corner
  ctx.fillStyle = `rgb(${P.line})`;
  ctx.fillRect(x + C, y - S, w - C * 2, S);              // top
  ctx.fillRect(x + C, y + h, w - C * 2, S);              // bottom
  ctx.fillRect(x - S, y + C, S, h - C * 2);              // left
  ctx.fillRect(x + w, y + C, S, h - C * 2);              // right
  ctx.fillRect(x + S, y, C - S, S); ctx.fillRect(x, y + S, S, C - S);                     // TL step
  ctx.fillRect(x + w - C, y, C - S, S); ctx.fillRect(x + w - S, y + S, S, C - S);          // TR
  ctx.fillRect(x + S, y + h - S, C - S, S); ctx.fillRect(x, y + h - C, S, C - S);          // BL
  ctx.fillRect(x + w - C, y + h - S, C - S, S); ctx.fillRect(x + w - S, y + h - C, S, C - S); // BR

  // the wooden border: dark rim outside, warm wood inside it
  ctx.fillStyle = `rgb(${P.edge})`;
  ctx.fillRect(x + C, y, w - C * 2, B);
  ctx.fillRect(x + C, y + h - B, w - C * 2, B);
  ctx.fillRect(x, y + C, B, h - C * 2);
  ctx.fillRect(x + w - B, y + C, B, h - C * 2);
  ctx.fillRect(x + S, y + S, C, C); ctx.fillRect(x + w - S - C, y + S, C, C);
  ctx.fillRect(x + S, y + h - S - C, C, C); ctx.fillRect(x + w - S - C, y + h - S - C, C, C);
  ctx.fillStyle = `rgb(${P.edge2})`;
  ctx.fillRect(x + C, y + S, w - C * 2, S);
  ctx.fillRect(x + C, y + h - B, w - C * 2, S);
  ctx.fillRect(x + S, y + C, S, h - C * 2);
  ctx.fillRect(x + w - B, y + C, S, h - C * 2);

  // parchment shine along the top inside edge
  ctx.fillStyle = `rgb(${P.shine})`;
  ctx.fillRect(x + C + S, y + B, w - C * 2 - S * 2, S);

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