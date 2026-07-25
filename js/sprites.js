// ---- pixel sprites (authored as char grids) -------------------------------
'use strict';

function makeSprite(rows, pal) {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

function flipSprite(img) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext('2d');
  c.translate(img.width, 0); c.scale(-1, 1);
  c.drawImage(img, 0, 0);
  return cv;
}

// otter palette
const OP = {
  'k': '#1d130b', 'o': '#6b4a2f', 'O': '#8a6444', 'c': '#d9c092',
  'n': '#14100c', 'w': '#f5efe0',
};

// 16x16, facing right
const OTTER_IDLE = makeSprite([
  '................',
  '.....kkkk.......',
  '....koooOk......',
  '...koOOOOOk.....',
  '...koOnOcOk.....',
  '...koOOcccnk....',
  '....koOcccak....',
  '.kk..koOOk......',
  'koook.koOOkk....',
  'koOOoooOOOOOk...',
  '.koOOOcccOOOOk..',
  '..koOOcccOOOOk..',
  '...koOOOOOOOk...',
  '....kooooook....',
  '.....kok.kok....',
  '.....kk...kk....',
], OP);

const OTTER_WALK1 = makeSprite([
  '................',
  '.....kkkk.......',
  '....koooOk......',
  '...koOOOOOk.....',
  '...koOnOcOk.....',
  '...koOOcccnk....',
  '....koOcccak....',
  '.kk..koOOk......',
  'koook.koOOkk....',
  'koOOoooOOOOOk...',
  '.koOOOcccOOOOk..',
  '..koOOcccOOOOk..',
  '...koOOOOOOOk...',
  '....kooooook....',
  '....kok...kok...',
  '...kk......kk...',
], OP);

const OTTER_WALK2 = makeSprite([
  '................',
  '.....kkkk.......',
  '....koooOk......',
  '...koOOOOOk.....',
  '...koOnOcOk.....',
  '...koOOcccnk....',
  '....koOcccak....',
  '.kk..koOOk......',
  'koook.koOOkk....',
  'koOOoooOOOOOk...',
  '.koOOOcccOOOOk..',
  '..koOOcccOOOOk..',
  '...koOOOOOOOk...',
  '....kooooook....',
  '......kok.......',
  '......kk........',
], OP);

const SPR = {
  otterR: [OTTER_IDLE, OTTER_WALK1, OTTER_WALK2],
  otterL: [flipSprite(OTTER_IDLE), flipSprite(OTTER_WALK1), flipSprite(OTTER_WALK2)],

  gull: [
    makeSprite([
      'kk........kk',
      '.wwk....kww.',
      '..kwwkkww k.',
      '....kwwk....',
      '....kwok....',
    ], { 'k': '#20242c', 'w': '#f2f4f6', 'o': '#e8a13c' }),
    makeSprite([
      '............',
      '..k......k..',
      '.kwwk..kwwk.',
      '...kwwwwk...',
      '....kwok....',
    ], { 'k': '#20242c', 'w': '#f2f4f6', 'o': '#e8a13c' }),
  ],

  icons: {
    clam: makeSprite([
      '..kkkk..',
      '.kddldk.',
      'kdldldlk',
      'kldldldk',
      'kddddddk',
      '.kkkkkk.',
      '..k..k..',
    ], { 'k': '#5a3a20', 'd': '#c9a06a', 'l': '#e8cf9e' }),
    mussel: makeSprite([
      '.....kk.',
      '....kBbk',
      '...kBbk.',
      '..kBbk..',
      '.kBbk...',
      'kBbk....',
      'kbk.....',
    ], { 'k': '#101830', 'b': '#2c3a6e', 'B': '#4a5f9e' }),
    barnacle: makeSprite([
      '...kk...',
      '..kggk..',
      '.kgddgk.',
      '.kgddgk.',
      'kggddggk',
      'kggggggk',
      'kkkkkkkk',
    ], { 'k': '#3c4442', 'g': '#a8b0ac', 'd': '#2c3432' }),
    oyster: makeSprite([
      '..kkkk..',
      '.kmmmmk.',
      'kmMMMmmk',
      'kmMMMMmk',
      'kmmMMmmk',
      '.kmmmmk.',
      '..kkkk..',
    ], { 'k': '#3a423a', 'm': '#6e7d6a', 'M': '#93a48c' }),
    abalone: makeSprite([
      '..kkkk..',
      '.kaAgAk.',
      'kaAgpAak',
      'kAgpAgAk',
      'kaAgAgak',
      '.kaaaak.',
      '..kkkk..',
    ], { 'k': '#1e4a40', 'a': '#3f8f7f', 'A': '#66c2a8', 'p': '#b48ac2', 'g': '#8fd0c0' }),
    pearl: makeSprite([
      '..kkk...',
      '.kwWwk..',
      'kwWWWwk.',
      'kwWwwwk.',
      'kwwwwwk.',
      '.kwwwk..',
      '..kkk...',
    ], { 'k': '#8a8478', 'w': '#e8e2d4', 'W': '#fffdf4' }),
    roe: makeSprite([
      '..kkk...',
      '.koook..',
      'koOOook.',
      'koOOOok.',
      'koOOook.',
      '.koook..',
      '..kkk...',
    ], { 'k': '#7a4410', 'o': '#c87a1e', 'O': '#eda93e' }),
  },

  crab: [
    makeSprite([
      'r......r',
      '.rkrrkr.',
      '.rrrrrr.',
      'r.r..r.r',
    ], { 'r': '#d6543c', 'k': '#2a1410' }),
    makeSprite([
      'r......r',
      '.rkrrkr.',
      '.rrrrrr.',
      '.r.rr.r.',
    ], { 'r': '#d6543c', 'k': '#2a1410' }),
  ],
};

// procedural drone (rotors animate)
function drawDrone(ctx, x, y, t, hasCrate) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.fillStyle = '#2a3038';
  ctx.fillRect(-7, -2, 14, 5);          // body
  ctx.fillStyle = '#3d4854';
  ctx.fillRect(-5, -3, 10, 2);
  ctx.fillStyle = '#5ad2f0';
  ctx.fillRect(-2, 0, 4, 2);            // eye/light
  ctx.fillStyle = '#20242a';
  ctx.fillRect(-12, -2, 5, 1);          // arms
  ctx.fillRect(7, -2, 5, 1);
  // rotors: shimmer with time
  const rw = 5 + Math.sin(t * 40) * 2;
  ctx.fillStyle = 'rgba(200,220,230,0.8)';
  ctx.fillRect(-11 - rw / 2, -4, rw, 1);
  ctx.fillRect(11 - rw / 2, -4, rw, 1);
  if (hasCrate) {
    ctx.strokeStyle = '#889'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(-3, 7); ctx.moveTo(4, 3); ctx.lineTo(3, 7); ctx.stroke();
    drawCrate(ctx, -5, 7, 10);
  }
  ctx.restore();
}

function drawCrate(ctx, x, y, s = 12) {
  ctx.fillStyle = '#8a6434';
  ctx.fillRect(x, y, s, s * 0.8);
  ctx.fillStyle = '#6b4a24';
  ctx.fillRect(x, y, s, 2);
  ctx.fillRect(x, y + s * 0.8 - 2, s, 2);
  ctx.fillRect(x + s / 2 - 1, y, 2, s * 0.8);
  ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s * 0.8 - 1);
}
