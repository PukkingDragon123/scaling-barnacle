// ---- shared helpers ----------------------------------------------------
'use strict';

const W = 480, H = 270;
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

// small pixel heart used by the HUD
function drawHeart(ctx, x, y, kind) {
  // kind: 'full' | 'half' | 'empty'
  const full = '#e8434c', dim = '#3a2330', line = '#1d1016';
  const rows = [
    '.xx.xx.',
    'xxxxxxx',
    'xxxxxxx',
    '.xxxxx.',
    '..xxx..',
    '...x...',
  ];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== 'x') continue;
      let col = kind === 'empty' ? dim : full;
      if (kind === 'half' && c > 3) col = dim;
      ctx.fillStyle = col;
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
  ctx.fillStyle = line;
  ctx.fillRect(x + 3, y + 0, 1, 1);
}
