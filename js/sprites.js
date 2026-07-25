// ---- pixel sprites (authored as char grids at DPX density) ------------------
// Sprites are drawn at 2x texel density and rendered at half size via drawSpr,
// so a 32-wide grid occupies 16 logical px with twice the hand-placed detail.
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

// ---- Otto the otter: chibi biped with a scarf (24x36 texels = 12x18 logical),
// 3/4 view facing right --------------------------------------------------------
const OP = {
  'k': '#1a0f08', 'd': '#573a20', 'o': '#74512e', 'O': '#8f683c',
  'c': '#dcc094', 'C': '#efe0bc', 'p': '#c9856c', 'n': '#201409',
  'w': '#f8f4ea', 'e': '#2a1a10', 's': '#d0563c', 'S': '#e87a54',
};

function otterGrid(legA, legB, feet, eyeOpen) {
  const eyeT = eyeOpen ? 'w' : 'o';
  const eyeB = eyeOpen ? 'e' : 'k';
  return [
    '....kkk......kkk........',
    '...kopok....kopok.......',
    '...koook....koook.......',
    '..kkoooookkoooookk......',
    '..koooooooooooooook.....',
    '.koooooooooooooooook....',
    ('.koooooo' + eyeT + eyeB + 'ooooo' + eyeT + eyeB + 'ooook....'),
    ('.koooooo' + eyeB + eyeB + 'ooooo' + eyeB + eyeB + 'ooook....'),
    '.kooooooooocccoooooook..',
    '.koooooooccccnncccook...',
    '.kooooooocccnnnccccok...',
    '..koooooocccccccccok....',
    '..kooooooocccccccok.....',
    '...kooooooocccccok......',
    '....koooooooooook.......',
    '.....kkoooooookk........',
    '.....kssSSSSssk.........',
    '....ksSSssssSSsk........',
    '....ksskkssssok.........',
    '...koosskoooook.........',
    '...koosskoooooook.......',
    '..kooksskooooooook......',
    '..kodkskkoccccooook.....',
    '..kodk.koocCCcooook.....',
    '...kk..koocCCcooook.....',
    '.......koccCCccoook.....',
    'kk.....koccccccook......',
    'kdkk...koooooooook......',
    'kddookkkoooooooook......',
    'kdddooookkkkkkkkk.......',
    '.kddoook' + legA,
    '..kkook.' + legB,
    '........' + feet,
    '........................',
  ];
}

const OTTER_IDLE = makeSprite(otterGrid(
  'koook..koook....', 'koook..koook....', 'kddok..kddok....', true), OP);
const OTTER_BLINK = makeSprite(otterGrid(
  'koook..koook....', 'koook..koook....', 'kddok..kddok....', false), OP);
const OTTER_WALK1 = makeSprite(otterGrid(
  '.koook.koook....', '.koookkoook.....', 'kddok...kddok...', true), OP);
const OTTER_WALK2 = makeSprite(otterGrid(
  'koook.koook.....', 'koookkoook......', '..kddok.kddok...', true), OP);

// ---- gull (28x16 texels = 14x8 logical) --------------------------------------
const GP = { 'k': '#232830', 'w': '#f4f6f8', 'g': '#c9ced4', 'o': '#e8a13c' };
const GULL_UP = makeSprite([
  'kk......................kk..',
  'kwwk..................kwwk..',
  '.kwwwk..............kwwwk...',
  '..kwwwwk....kk....kwwwwk....',
  '...kgwwwwkkwwwwkkwwwwgk.....',
  '.....kgwwwwwwwwwwwwgk.......',
  '........kwwwwwwwwk..........',
  '.........kwwwwook...........',
  '..........kkkkk.............',
], GP);
const GULL_DOWN = makeSprite([
  '............................',
  '............kk..............',
  '..........kwwwwk............',
  '.....kkkwwwwwwwwwkkk........',
  '..kwwwwwwwwwwwwwwwwwwk......',
  '.kwwgkkwwwwwwwwwwkkgwwk.....',
  '.kkk....kwwwwwook....kkk....',
  '..........kkkkk.............',
  '............................',
], GP);

// ---- crab (16x8 texels = 8x4 logical) -----------------------------------------
const CP = { 'r': '#d6543c', 'R': '#f07a58', 'k': '#2a1410', 'w': '#f8f4ea' };
const CRAB1 = makeSprite([
  'rr............rr',
  '.r....k..k....r.',
  '..rRRkwkkwkRRr..',
  '..RRRRRRRRRRRR..',
  '.rRRRRRRRRRRRRr.',
  '..r.r..rr..r.r..',
  '.r...r....r...r.',
], CP);
const CRAB2 = makeSprite([
  'rr............rr',
  '.r....k..k....r.',
  '..rRRkwkkwkRRr..',
  '..RRRRRRRRRRRR..',
  '.rRRRRRRRRRRRRr.',
  '...r..r..r..r...',
  '..r..r....r..r..',
], CP);

// ---- item icons (16-wide texel grids = 8 logical) ------------------------------
const SPR_ICONS = {
  clam: makeSprite([
    '......kkkk......',
    '....kkddddkk....',
    '...kdlddddldk...',
    '..kdldlddldldk..',
    '..kdldldldldlk..',
    '.kddldldldldddk.',
    '.kdddddddddddk..',
    '..kkkkkkkkkkk...',
    '....kk...kk.....',
  ], { 'k': '#4a2f16', 'd': '#c9a06a', 'l': '#ecd4a4' }),
  mussel: makeSprite([
    '...........kkk.',
    '.........kkBBk.',
    '.......kkBBLbk..'.replace('L', 'l'),
    '.....kkBBlbbk...',
    '...kkBBlbbk.....',
    '..kBBlbbk.......',
    '.kBlbbk.........',
    '.kbbkk..........',
    '..kk............',
  ], { 'k': '#0e1428', 'b': '#26335e', 'B': '#4a5f9e', 'l': '#7c92cc' }),
  barnacle: makeSprite([
    '......kkkk......',
    '....kkgggGkk....',
    '...kgGgddgggk...',
    '..kggGddddggGk..',
    '..kgGgddddgggk..',
    '.kggggGddgggggk.',
    '.kgggggggggGggk.',
    '.kkkkkkkkkkkkkk.',
  ], { 'k': '#39413f', 'g': '#a8b0ac', 'G': '#c9d0cc', 'd': '#232b29' }),
  oyster: makeSprite([
    '....kkkkkk......',
    '..kkmmmmmmkk....',
    '.kmMMMMMmmmmk...',
    'kmMMWWMMMmmmmk..'.replace('WW', 'MM'),
    'kmMMMMMMMmmmk...',
    '.kmmMMMMmmmmk...',
    '..kmmmmmmmkk....',
    '...kkkkkkk......',
  ], { 'k': '#333d33', 'm': '#6e7d6a', 'M': '#9aac90' }),
  abalone: makeSprite([
    '....kkkkkk......',
    '..kkaAgAAakk....',
    '.kaAgpAgAgAak...',
    'kaAgpAgAgpAgak..',
    'kAgAgAgpAgAgk...',
    '.kaagAgAgaak....',
    '..kkaaaaakk.....',
    '....kkkkk.......',
  ], { 'k': '#173b32', 'a': '#3f8f7f', 'A': '#6cc9ad', 'p': '#b48ac2', 'g': '#93d4c2' }),
  pearl: makeSprite([
    '.....kkkk.......',
    '...kkwwWwkk.....',
    '..kwWWWWWwwk....',
    '..kwWWwWWwwk....',
    '.kwwWwwwwwwwk...',
    '..kwwwwwwwwk....',
    '...kkwwwwkk.....',
    '.....kkkk.......',
  ], { 'k': '#7d7768', 'w': '#e8e2d4', 'W': '#fffdf4' }),
  roe: makeSprite([
    '.....kkkk.......',
    '...kkooOokk.....',
    '..koOOOOOook....',
    '..koOOoOOOok....',
    '.koOOOOOoOOk....',
    '..koooOOOok.....',
    '...kkooookk.....',
    '.....kkkk.......',
  ], { 'k': '#6b3a0c', 'o': '#c87a1e', 'O': '#f2b44e' }),
};

// coin for money displays (14x12 texels = 7x6 logical) — solid gold, tiny clam mark
const COIN = makeSprite([
  '....kkkkkk....',
  '..kkggggggkk..',
  '.kgwwgggggGk..',
  '.kwwggdddgGGk.',
  'kgwggdgggdgGGk',
  'kgggdggggggGGk'.replace('dggggg', 'dgggdg'),
  'kggggdgdgdgGGk',
  'kgggggdddggGGk',
  '.kggggggggGGk.',
  '.kggggggGGGGk.',
  '..kkgGGGGGkk..',
  '....kkkkkk....',
], { 'k': '#6b4a0c', 'g': '#e8b83c', 'G': '#b8871f', 'w': '#ffeda0', 'd': '#8a6210' });

// chunky pixel clouds — flat bottoms, sunlit tops
function makeCloud(len, tall) {
  const cv = document.createElement('canvas');
  cv.width = len; cv.height = tall;
  const c = cv.getContext('2d');
  const rng = mulberry32(len * 31 + tall * 7);
  const lobes = 3 + Math.floor(rng() * 3);
  c.fillStyle = '#f6f9fb';
  for (let i = 0; i < lobes; i++) {
    const r = tall * (0.32 + rng() * 0.26);
    const lx = clamp(8 + (len - 20) * (i / (lobes - 1)), r + 1, len - r - 1);
    c.beginPath(); c.arc(lx, tall - r * 0.75, r, 0, TAU); c.fill();
  }
  c.fillRect(4, tall - tall * 0.4, len - 8, tall * 0.4 - 1);
  // shaded underside
  c.fillStyle = '#c9d8e2';
  c.fillRect(4, tall - 3, len - 8, 2);
  c.fillRect(8, tall - 5, len - 20, 2);
  return cv;
}

const SPR = {
  otterR: [OTTER_IDLE, OTTER_WALK1, OTTER_WALK2, OTTER_BLINK],
  otterL: [flipSprite(OTTER_IDLE), flipSprite(OTTER_WALK1), flipSprite(OTTER_WALK2), flipSprite(OTTER_BLINK)],
  gull: [GULL_UP, GULL_DOWN],
  crab: [CRAB1, CRAB2],
  icons: SPR_ICONS,
  coin: COIN,
  clouds: [makeCloud(72, 22), makeCloud(96, 26), makeCloud(52, 18)],
};

// ---- procedural drone (finer texels via PIX) -----------------------------------
function drawDrone(ctx, x, y, t, hasCrate) {
  ctx.save();
  ctx.translate(Math.round(x * DPX) / DPX, Math.round(y * DPX) / DPX);
  // body
  ctx.fillStyle = '#242a32';
  ctx.fillRect(-7, -2, 14, 5);
  ctx.fillStyle = '#3d4854';
  ctx.fillRect(-5.5, -3, 11, 2);
  ctx.fillStyle = '#57646f';
  ctx.fillRect(-5.5, -3, 11, PIX);
  // eye/light
  ctx.fillStyle = '#5ad2f0';
  ctx.fillRect(-2, 0, 4, 1.5);
  ctx.fillStyle = '#bfeffb';
  ctx.fillRect(-1.5, 0, 1, PIX * 2);
  // blinking nav light
  if (Math.sin(t * 6) > 0.2) {
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(5.5, -1, 1, 1);
  }
  // arms
  ctx.fillStyle = '#181c22';
  ctx.fillRect(-12, -2, 5, 1);
  ctx.fillRect(7, -2, 5, 1);
  // rotor shimmer
  const rw = 5 + Math.sin(t * 40) * 2;
  ctx.fillStyle = 'rgba(210,225,235,0.85)';
  ctx.fillRect(-11 - rw / 2, -4, rw, PIX * 2);
  ctx.fillRect(11 - rw / 2, -4, rw, PIX * 2);
  if (hasCrate) {
    ctx.strokeStyle = '#8a94a0'; ctx.lineWidth = PIX;
    ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(-3, 7); ctx.moveTo(4, 3); ctx.lineTo(3, 7); ctx.stroke();
    drawCrate(ctx, -5, 7, 10);
  }
  ctx.restore();
}

function drawCrate(ctx, x, y, s = 12) {
  const h = s * 0.8;
  ctx.fillStyle = '#8a6434';
  ctx.fillRect(x, y, s, h);
  // plank lines
  ctx.fillStyle = '#755428';
  ctx.fillRect(x, y + h * 0.33, s, PIX);
  ctx.fillRect(x, y + h * 0.66, s, PIX);
  // frame
  ctx.fillStyle = '#5f4322';
  ctx.fillRect(x, y, s, 1.5);
  ctx.fillRect(x, y + h - 1.5, s, 1.5);
  ctx.fillRect(x, y, 1.5, h);
  ctx.fillRect(x + s - 1.5, y, 1.5, h);
  // diagonal brace + nails
  ctx.strokeStyle = '#5f4322'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 1.5, y + 1.5); ctx.lineTo(x + s - 1.5, y + h - 1.5); ctx.stroke();
  ctx.fillStyle = '#c8a03c';
  ctx.fillRect(x + 1, y + 1, PIX, PIX);
  ctx.fillRect(x + s - 1.5, y + 1, PIX, PIX);
  ctx.fillRect(x + 1, y + h - 1.5, PIX, PIX);
  ctx.fillRect(x + s - 1.5, y + h - 1.5, PIX, PIX);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 1.5, y + h - 1, s - 3, PIX);
  // top highlight
  ctx.fillStyle = 'rgba(240,220,170,0.35)';
  ctx.fillRect(x + 1.5, y + PIX, s - 3, PIX);
}
