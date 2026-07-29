// ---- image asset loader ------------------------------------------------------
// Assets live in assets/ (named in ASSET_MANIFEST from assets/manifest.js).
// The single-file build instead defines ASSET_DATA with data: URIs.
'use strict';

const ASSETS = {};

function loadAssets(done) {
  const man = typeof ASSET_MANIFEST !== 'undefined' ? ASSET_MANIFEST : {};
  const names = Object.keys(man);
  if (!names.length) { done(); return; }
  let left = names.length;
  const tick = () => { if (--left === 0) done(); };
  for (const n of names) {
    const img = new Image();
    img.onload = tick;
    img.onerror = tick;
    img.src = (typeof ASSET_DATA !== 'undefined' && ASSET_DATA[n])
      ? ASSET_DATA[n]
      : `assets/${n}.${man[n].ext || 'png'}`;
    ASSETS[n] = img;
  }
}

// draw an asset in logical units, anchored at top-left
function drawA(ctx, name, x, y, w, h) {
  const img = ASSETS[name];
  if (!img || !img.width) return;
  if (w === undefined) { w = img.width * APIX; h = img.height * APIX; }
  else if (h === undefined) { h = w * img.height / img.width; }
  ctx.drawImage(img, x, y, w, h);
}

// ---- tweened frame playback ---------------------------------------------------
// Hand-drawn sheets are 3-4 frames per action, so at any honest frame rate they
// pop from pose to pose. This cross-fades the outgoing frame into the incoming one
// across the first slice of each frame's time, and eases the sub-frame phase, so a
// four-frame cycle reads as continuous motion instead of a flick-book.
//
//   frames  array of asset names
//   t       elapsed seconds
//   fps     frames per second of the cycle
//   opts    { loop=true, blend=0.45, cx, cy, w, h, flip, rot, alpha }
//
// blend is the fraction of one frame's duration spent cross-fading. 0 disables it
// (use that for anything that must read as crisp, like a UI icon strip).
function drawAnim(ctx, frames, t, fps, opts) {
  const n = frames.length;
  if (!n) return;
  const o = opts || {};
  const step = 1 / (fps || 8);
  const raw = t / step;
  let i = Math.floor(raw);
  const phase = raw - i;                       // 0..1 within the current frame
  if (o.loop === false) { if (i >= n) i = n - 1; } else i = ((i % n) + n) % n;
  const blend = o.blend === undefined ? 0.45 : o.blend;

  const put = (name, alpha) => {
    const img = ASSETS[name];
    if (!img || !img.width || alpha <= 0.004) return;
    let w = o.w, h = o.h;
    if (w === undefined && h === undefined) { w = img.width * APIX; h = img.height * APIX; }
    else if (h === undefined) h = w * img.height / img.width;
    else if (w === undefined) w = h * img.width / img.height;
    ctx.save();
    ctx.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * alpha;
    ctx.translate(o.cx || 0, o.cy || 0);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  // Outside the blend window there is only one frame to draw, which is the common
  // case — so the two-blit path costs nothing for most of each frame's life.
  if (blend <= 0 || phase >= blend) { put(frames[i], 1); return; }
  const prev = o.loop === false ? Math.max(0, i - 1) : (i - 1 + n) % n;
  // smoothstep the crossfade: a linear one reads as a double-exposure
  const k = phase / blend;
  const e = k * k * (3 - 2 * k);
  put(frames[prev], 1 - e);
  put(frames[i], e);
}

// draw centered at (cx, cy), optionally flipped horizontally
function drawAC(ctx, name, cx, cy, w, h, flip) {
  const img = ASSETS[name];
  if (!img || !img.width) return;
  if (w === undefined) w = img.width * APIX;
  if (h === undefined) h = w * img.height / img.width;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function assetH(name, w) {
  const img = ASSETS[name];
  return img && img.width ? w * img.height / img.width : w;
}

// item key -> asset icon (shells & processed goods use the uploaded art)
const ITEM_ART = {
  clam: 'shell_clam', mussel: 'shell_mussel', barnacle: 'shell_cockle',
  oyster: 'shell_scallop', abalone: 'shell_abalone', pearl: 'shell_pearl',
  roe: 'urchin_1',
  clamMeat: 'open_clam', musselMeat: 'open_mussel', oysterMeat: 'open_scallop',
  abalonePol: 'open_abalone', pearlPol: 'open_pearl',
};
// dive-wall species art per node kind
const NODE_ART = {
  clam: 'clam', mussel: 'mussel', barnacle: 'cockle', oyster: 'scallop', abalone: 'abalone',
};

function drawItemIcon(ctx, key, cx, cy, s = 10) {
  const a = ITEM_ART[key];
  if (a && ASSETS[a] && ASSETS[a].width) {
    const img = ASSETS[a];
    const w = img.width >= img.height ? s : s * img.width / img.height;
    const h = img.width >= img.height ? s * img.height / img.width : s;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
}
