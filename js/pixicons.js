// ---- PIXICONS: hand-authored icon art, in code ---------------------------------
//
// The HUD's trophy and satchel proved the point: a 16x16 grid where every pixel
// is a deliberate decision reads as ART, and the same shape drawn with arcs and
// quadratic curves reads as vector clip-art sitting on top of a pixel game. This
// is that idea taken across the whole UI -- professions, states, verbs, the
// small nouns the interface keeps needing -- so nothing has to fall back on a
// scaled-down game sprite or a letter in a box.
//
// Every glyph is 12x12, one character per pixel, painted from UIPAL plus a
// handful of accents. They are baked ONCE per (icon, scale) into an atlas strip
// and blitted, so drawing one costs a single drawImage and allocates nothing.
//
// Animation lives here too, because it belongs to the icon rather than to each
// call site: pass a `t` and an effect and the same glyph bobs, ticks, spins or
// pulses identically everywhere it appears.
'use strict';

const PixIcons = {
  S: 12,

  // '.' is transparent. Everything else is a key into PAL. The ramps are three
  // tones deep -- shadow, body, light -- because a flat fill at this size reads
  // as a sticker, and one highlight pixel in the right place is the difference
  // between a shape and an object.
  PAL: {
    o: '#2a1206',  // outline, near-black brown
    O: '#4a2410',  // soft outline / contact shadow
    // wood + gold: the panel ramp, so an icon and its frame share a family
    d: '#662907', m: '#914007', f: '#c56906', w: '#e3ab61', p: '#f4bf69', h: '#f8d089',
    u: '#7a4a22', U: '#b07a3a',                       // plain wood
    // metal
    s: '#4e5a68', S: '#8a97a6', T: '#c9d6e4', k: '#fff6e0',
    // red
    r: '#8f2020', R: '#d63b2e', E: '#ff8b72',
    // green
    g: '#2a6b34', G: '#4fa84f', N: '#9ee87f',
    // blue + water
    b: '#1d4a78', B: '#3f8fd0', C: '#86d8f0', c: '#c9f4fb',
    // sun + amber
    x: '#c96a06', y: '#ffc21e', Y: '#fff2a8',
    // violet
    v: '#5b3a8f', V: '#9b6fe0',
    // coral + pink
    z: '#a8436f', n: '#e06a9c', q: '#ffb0cd',
    // teal
    t: '#1f7d78', L: '#48c2b4',
  },

  G: {
    // ---- the five trades ----------------------------------------------------
    shell: [
      '............', '....oooo....', '..oozqqzoo..', '.oznqqqqnzo.',
      'oznqnqqnqnzo', 'ozqnqqqqnqzo', 'oznqnqqnqnzo', '.oznqqqqnzo.',
      '..ozznnzzo..', '...oooooo...', '............', '............',
    ],
    pick: [
      '............', '............', '.oooooooooo.', 'oTSSSSSSSSTo',
      'oSsSSooSSsSo', '.oooOUUOooo.', '....oUUo....', '....oUuo....',
      '....oUuo....', '....oUuo....', '....oooo....', '............',
    ],
    sword: [
      '.......ooo..', '......oTSo..', '.....oTSSo..', '....oTSSo...',
      '...oTSSo....', '..oTSSo.....', '.oTSSo......', 'ofpSfo......',
      'offdfo......', 'oduo........', 'ooo.........', '............',
    ],
    seed: [
      '.....oo.....', '....oNGo....', '...oNGGo.o..', '..oNGGGooGo.',
      '...oGGGNGo..', '....oGgo....', '....ogo.....', '...oUuo.....',
      '..oUUUUo....', '.oUhpphUo...', '..oooooo....', '............',
    ],
    fish: [
      '............', '.......oo...', 'oo....oBCo..', 'oBoooBBBBBo.',
      'oBBoBCCCCkBo', 'oBBoCCCCCoBo', 'oBBoBCCCCCBo', 'oBoooBBBBBo.',
      'oo....oBbo..', '............', '............', '............',
    ],

    // ---- states -------------------------------------------------------------
    star: [
      '.....oo.....', '....oYyo....', '....oYyo....', 'oooooYyooooo',
      'oYYYyyyyyxxo', '.oYyyyyyyxo.', '..oyyyyyxo..', '..oyyooyxo..',
      '.oyyo..oxxo.', '.oxo....oxo.', '.oo......oo.', '............',
    ],
    lock: [
      '............', '....oooo....', '...oTSSTo...', '...oS..So...',
      '.oooooooooo.', '.oxYyyyyyxo.', '.oxyyooyyxo.', '.oxyyooyyxo.',
      '.oxyyyyyyxo.', '.oooooooooo.', '............', '............',
    ],
    check: [
      '............', '.........ooo', '........oNGo', '.......oNGGo',
      '.oo...oNGGo.', 'oNGo.oNGGo..', 'oNGGooGGo...', '.oGGGGGo....',
      '..oggGo.....', '...ooo......', '............', '............',
    ],
    heart: [
      '............', '..oo....oo..', '.oEEo..oRRo.', 'oEkERoooRRro',
      'oEkERRRRRRro', 'oERRRRRRRrro', '.oRRRRRRrro.', '..oRRRRrro..',
      '...oRRrro...', '....oRro....', '.....oo.....', '............',
    ],
    coin: [
      '............', '....oooo....', '..ooxppxoo..', '.oxphhhhpxo.',
      'oxphYYkhhpxo', 'oxphYkkhhpxo', 'oxphhkkhhpxo', 'oxphhhhhhpxo',
      '.oxphhhhpxo.', '..ooxppxoo..', '....oooo....', '............',
    ],
    clock: [
      '............', '....oooo....', '..ooSTTSoo..', '.oSkkrkkkSo.',
      'oSTkkrkkkTSo', 'oSTkkrkkkTSo', 'oSTkkrrrkTSo', 'oSTkkkkkkTSo',
      '.oSkkkkkkSo.', '..ooSTTSoo..', '....oooo....', '............',
    ],
    bubble: [
      '............', '....oooo....', '..ootCCtoo..', '.otCccCCCto.',
      'otCcckCCCCto', 'otCCcCCCCCto', 'otCCCCCCCCto', '.otCCCCCCto.',
      '..oottCCoo..', '....oooo....', '............', '............',
    ],

    // ---- verbs --------------------------------------------------------------
    hammer: [
      '............', '..oooooo....', '.oTSSSSso...', 'osSTkSSSso..',
      '.osSSSSso...', '..oooUooo...', '....oUo.....', '....oUo.....',
      '....oUuo....', '....oUuo....', '....ooo.....', '............',
    ],
    bag: [
      '............', '...oo..oo...', '..oUo..oUo..', '.oooooooooo.',
      '.ohppppppho.', '.owppppppwo.', '.oooooooooo.', '.oUUUUUUUUo.',
      '.oUUoyyoUUo.', '.oUUoyyoUUo.', '.ouuuuuuuuo.', '..oooooooo..',
    ],
    plus: [
      '............', '....oooo....', '....oNGo....', '....oNGo....',
      '.ooooNGoooo.', '.oNNNNGGGGo.', '.oGGGGGGGGo.', '.ooooGgoooo.',
      '....oGgo....', '....oGgo....', '....oooo....', '............',
    ],
    minus: [
      '............', '............', '............', '............',
      '.oooooooooo.', '.oEEEEEEEEo.', '.oRRRRRRRRo.', '.oooooooooo.',
      '............', '............', '............', '............',
    ],
    close: [
      '............', '.oo......oo.', 'oEEo....oEEo', '.oEEo..oEEo.',
      '..oEEooEEo..', '...oERREo...', '...oERREo...', '..oERooREo..',
      '.oERo..oREo.', 'oERo....oREo', '.oo......oo.', '............',
    ],
    arrowR: [
      '............', '....oo......', '....oho.....', '....ohho....',
      '.ooooohho...', '.ohhhhhhho..', '.owwwwwwwho.', '.ooooowwo...',
      '....owwo....', '....owo.....', '....oo......', '............',
    ],
    spark: [
      '............', '.....oo.....', '.....Yo.....', '....oYyo....',
      '..ooYYyyoo..', '.oYYYkYyyyo.', '.oyYYkkYyyo.', '..ooyYyyoo..',
      '....oyyo....', '.....yo.....', '.....oo.....', '............',
    ],
    sun: [
      '.....yy.....', '..y..oo..y..', '....oyyo....', '..ooyYYyoo..',
      '.oyYYYYYYyo.', 'yoYYYYYYYYoy', 'yoYYYYYYYYoy', '.oyYYYYYYyo.',
      '..ooyYYyoo..', '....oyyo....', '..y..oo..y..', '.....yy.....',
    ],
    moon: [
      '............', '....oooo....', '..ooTkkTo...', '.oTkkkkToo..',
      'oTkkkkToo...', 'oTkSkkTo....', 'oTkkkSTo....', 'oTkkkkToo...',
      '.oTkkkkToo..', '..ooTkkTo...', '....oooo....', '............',
    ],
    expand: [
      '............', '.oooo..oooo.', '.oTTo..oTTo.', '.oTooooooTo.',
      '.oTo....oTo.', '.oo......oo.', '.oo......oo.', '.oTo....oTo.',
      '.oTooooooTo.', '.oTTo..oTTo.', '.oooo..oooo.', '............',
    ],
    shrink: [
      '............', '.o........o.', '.oo......oo.', '.oTo....oTo.',
      '..oTooooTo..', '...oTTTTo...', '...oTTTTo...', '..oTooooTo..',
      '.oTo....oTo.', '.oo......oo.', '.o........o.', '............',
    ],
    gear: [
      '............', '...o.oo.o...', '..oSoSSoSo..', '.ooTTSSSSoo.',
      '.oSSSooSSSo.', 'ooSSo..oSSoo', 'ooSSo..oSSoo', '.oSSSooSSSo.',
      '.ooSSSSSSoo.', '..oSoSSoSo..', '...o.oo.o...', '............',
    ],
  },

  _atlas: null,      // "px" -> { cv, idx }
  _order: null,
  _n: 0,

  _boot() {
    if (this._order) return;
    this._order = [];
    for (const k in this.G) if (Object.prototype.hasOwnProperty.call(this.G, k)) this._order.push(k);
    this._idx = {};
    for (let i = 0; i < this._order.length; i++) this._idx[this._order[i]] = i;
    this._atlas = {};
  },

  // The whole sheet at one scale, baked at device density. `px` is DEVICE pixels
  // per icon pixel, so it is always an integer and a glyph can never land on a
  // half pixel.
  sheet(px) {
    this._boot();
    const hit = this._atlas[px];
    if (hit) return hit;
    if (this._n > 12) { this._atlas = {}; this._n = 0; }   // never grows forever

    const S = this.S, cw = S * px;
    const cv = document.createElement('canvas');
    cv.width = cw * this._order.length;
    cv.height = cw;
    const c = cv.getContext('2d');
    for (let i = 0; i < this._order.length; i++) {
      const grid = this.G[this._order[i]], ox = i * cw;
      for (let y = 0; y < grid.length && y < S; y++) {
        const row = grid[y];
        for (let x = 0; x < row.length && x < S; x++) {
          const col = this.PAL[row[x]];
          if (!col) continue;
          c.fillStyle = col;
          c.fillRect(ox + x * px, y * px, px, px);
        }
      }
    }
    const rec = { cv, cw };
    this._atlas[px] = rec;
    this._n++;
    return rec;
  },

  // Draw `name` centred on (cx, cy) at `size` logical units across.
  //
  // opts.t         a clock, for the effects below
  // opts.fx        'bob' | 'pulse' | 'tick' | 'spin' | 'shake' | none
  // opts.phase     offset so a row of icons does not move in lockstep
  // opts.alpha
  // opts.pop       0..1, a one-shot squash-and-settle (1 = just fired)
  draw(ctx, name, cx, cy, size, opts) {
    this._boot();
    const i = this._idx[name];
    if (i === undefined) return;
    const o = opts || {};
    // an integer number of device pixels per icon pixel: that is what keeps the
    // art crisp, so the requested size is honoured to the nearest whole texel
    const px = Math.max(1, Math.floor(size / this.S * DPX));
    const rec = this.sheet(px);
    const w = px * this.S / DPX;

    const t = o.t || 0, ph = o.phase || 0;
    let dx = 0, dy = 0, sx = 1, sy = 1, rot = 0;
    switch (o.fx) {
      case 'bob':   dy = Math.round(Math.sin(t * 2.6 + ph) * 1.2 / APIX) * APIX; break;
      case 'pulse': sx = sy = 1 + Math.sin(t * 4 + ph) * 0.08; break;
      case 'tick':  rot = Math.sin(t * 3 + ph) * 0.10; break;
      case 'spin':  rot = t * 1.4 + ph; break;
      case 'shake': dx = Math.round(Math.sin(t * 26 + ph) * 0.8 / APIX) * APIX; break;
      default: break;
    }
    if (o.pop > 0) {                       // squash out, settle back
      const k = Math.sin(o.pop * Math.PI);
      sx *= 1 + k * 0.35; sy *= 1 - k * 0.18;
    }

    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    if (o.alpha !== undefined) { ctx.save(); ctx.globalAlpha = o.alpha; }
    if (rot || sx !== 1 || sy !== 1) {
      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.drawImage(rec.cv, i * rec.cw, 0, rec.cw, rec.cw, -w / 2, -w / 2, w, w);
      ctx.restore();
    } else {
      const q = 1 / DPX;
      ctx.drawImage(rec.cv, i * rec.cw, 0, rec.cw, rec.cw,
        Math.round((cx + dx - w / 2) / q) * q, Math.round((cy + dy - w / 2) / q) * q, w, w);
    }
    if (o.alpha !== undefined) ctx.restore();
    ctx.imageSmoothingEnabled = sm;
  },

  has(name) { this._boot(); return this._idx[name] !== undefined; },
};
