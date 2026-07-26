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
  if (w === undefined) { w = img.width / DPX; h = img.height / DPX; }
  else if (h === undefined) { h = w * img.height / img.width; }
  ctx.drawImage(img, x, y, w, h);
}

// draw centered at (cx, cy), optionally flipped horizontally
function drawAC(ctx, name, cx, cy, w, h, flip) {
  const img = ASSETS[name];
  if (!img || !img.width) return;
  if (w === undefined) w = img.width / DPX;
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
  } else if (SPR.icons[key]) {
    drawSpr(ctx, SPR.icons[key], cx - 4, cy - 3.5);
  }
}
