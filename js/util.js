// ---- shared helpers ----------------------------------------------------
'use strict';

const W = 480, H = 270;   // logical resolution: all game code works in these units
const DPX = 2;            // art density: device texels per logical unit
const PIX = 1 / DPX;      // one device texel, in logical units (for fine detail)
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
  ctx.drawImage(img, Math.round(x * DPX) / DPX, Math.round(y * DPX) / DPX, img.width / DPX, img.height / DPX);
}

// Driftwood UI panel with pegged corners — the game's shared chrome.
function uiPanel(ctx, x, y, w, h, alpha = 0.88) {
  ctx.fillStyle = `rgba(26,17,10,${alpha})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(126,92,52,0.95)';
  ctx.fillRect(x, y, w, PIX * 2); ctx.fillRect(x, y + h - PIX * 2, w, PIX * 2);
  ctx.fillRect(x, y, PIX * 2, h); ctx.fillRect(x + w - PIX * 2, y, PIX * 2, h);
  ctx.fillStyle = 'rgba(230,200,150,0.35)';
  ctx.fillRect(x + 1, y + 1, w - 2, PIX);
  ctx.fillStyle = '#c8a03c';
  ctx.fillRect(x + 1.5, y + 1.5, 1, 1);
  ctx.fillRect(x + w - 2.5, y + 1.5, 1, 1);
  ctx.fillRect(x + 1.5, y + h - 2.5, 1, 1);
  ctx.fillRect(x + w - 2.5, y + h - 2.5, 1, 1);
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
      ctx.fillRect(x + c * PIX, y + r * PIX, PIX, PIX);
    }
  }
}
