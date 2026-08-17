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

  // '.' transparent. Colours are UIPAL where they can be, so an icon and the
  // panel under it are cut from the same ramp.
  PAL: {
    o: '#30150a',  // outline
    d: '#662907',  // dark
    m: '#914007',  // mid
    f: '#c56906',  // frame / bright brown
    w: '#e3ab61',  // warm
    p: '#f4bf69',  // panel gold
    h: '#f8d089',  // highlight
    // accents, used sparingly and only where meaning needs a colour
    r: '#c8392f',  // red
    R: '#f0645a',  // light red
    g: '#3f8f4e',  // green
    G: '#7fd08a',  // light green
    b: '#2a5f8f',  // blue
    B: '#5aa8d8',  // light blue
    c: '#7fe0e8',  // cyan
    s: '#8a929c',  // steel
    S: '#d8dee6',  // light steel
    k: '#fff6e0',  // white
    v: '#7a4a9c',  // violet
  },

  G: {
    // ---- the five trades ----------------------------------------------------
    shell: [
      '............', '....oooo....', '..oowwwwoo..', '.owpppppwo..',
      '.opphppphpo.', 'opphppphppo.', 'oppphpppppo.', 'oppphppppo..',
      '.opphpppo...', '..owpppo....', '...oooo.....', '............',
    ],
    pick: [
      '............', '.oo......oo.', 'oSSo....oSSo', 'oSSSoooSSSo.',
      '.oSSSSSSSo..', '..ooSSSoo...', '....odo.....', '....odo.....',
      '....odo.....', '....odo.....', '....ooo.....', '............',
    ],
    sword: [
      '.......oo...', '......oSSo..', '.....oSSSo..', '....oSSSo...',
      '...oSSSo....', '..oSSSo.....', '.oSSSo......', 'ofSfo.......',
      'offfo.......', 'odo.........', 'oo..........', '............',
    ],
    seed: [
      '.....oo.....', '....ogGo....', '...ogGGo....', '..ogGGGo....',
      '...oggo.....', '....odo.....', '....odo.....', '...oddo.....',
      '..owwwwo....', '.owppppwo...', '..oooooo....', '............',
    ],
    fish: [
      '............', '.......oo...', '......oBBo..', '.ooo.oBBBo..',
      'oBBBoBBBBo..', 'oBkBBBBBBo..', 'oBBBBBBBBo..', 'oBBBoBBBBo..',
      '.ooo.oBBBo..', '......oBBo..', '.......oo...', '............',
    ],

    // ---- states -------------------------------------------------------------
    star: [
      '.....oo.....', '.....hh.....', '....ohho....', 'oo..ohho..oo',
      'ohoohhhhooho', '.ohhhhhhhho.', '..ohhhhhho..', '..ohhhhhho..',
      '.ohho..ohho.', '.oho....oho.', '.oo......oo.', '............',
    ],
    lock: [
      '............', '...oooooo...', '..od....do..', '..od....do..',
      '.oooooooooo.', '.offffffffo.', '.offoooffffo', '.offo..offfo',
      '.offoooffffo', '.offffffffo.', '.oooooooooo.', '............',
    ],
    check: [
      '............', '..........oo', '.........oGo', '........oGo.',
      '.oo....oGo..', 'oGo...oGo...', '.oGo.oGo....', '..oGoGo.....',
      '...oGo......', '....o.......', '............', '............',
    ],
    heart: [
      '............', '..oo....oo..', '.oRRo..oRRo.', 'oRkRRooRRRo.',
      'oRkRRRRRRRo.', 'oRRRRRRRRRo.', '.oRRRRRRRo..', '..oRRRRRo...',
      '...oRRRo....', '....oRo.....', '.....o......', '............',
    ],
    coin: [
      '............', '....oooo....', '..oohhhhoo..', '.ohppffppho.',
      'ohpfhhhhfpo.', 'ohpfhoohfpo.', 'ohpfhoohfpo.', 'ohpfhhhhfpo.',
      '.ohpffffpho.', '..oohhhhoo..', '....oooo....', '............',
    ],
    clock: [
      '............', '....oooo....', '..oohhhhoo..', '.ohpppppppo.',
      'ohppodppppo.', 'ohppodppppo.', 'ohppoddddpo.', 'ohpppppppo..',
      '.ohppppppo..', '..oohhhhoo..', '....oooo....', '............',
    ],
    bubble: [
      '............', '....oooo....', '..oocccco...', '.ockkcccco..',
      'ockkccccco..', 'occcccccco..', 'occcccccco..', '.occccccco..',
      '..occccco...', '....oooo....', '............', '............',
    ],

    // ---- verbs --------------------------------------------------------------
    hammer: [
      '............', '..oooooo....', '.osSSSSso...', 'osSSkSSSso..',
      '.osSSSSso...', '..ooodooo...', '....odo.....', '....odo.....',
      '....odo.....', '....odo.....', '....ooo.....', '............',
    ],
    bag: [
      '............', '...oo..oo...', '..od....do..', '.oooooooooo.',
      'ofwwwwwwwwfo', 'ofwhhwwhhwfo', 'ofwwwwwwwwfo', 'offffddffffo',
      'offffddffffo', '.offffffffo.', '..oooooooo..', '............',
    ],
    plus: [
      '............', '....oooo....', '....ohho....', '....ohho....',
      '.oooohhoooo.', '.ohhhhhhhho.', '.ohhhhhhhho.', '.oooohhoooo.',
      '....ohho....', '....ohho....', '....oooo....', '............',
    ],
    minus: [
      '............', '............', '............', '............',
      '.oooooooooo.', '.ohhhhhhhho.', '.ohhhhhhhho.', '.oooooooooo.',
      '............', '............', '............', '............',
    ],
    close: [
      '............', '.oo......oo.', 'ohho....ohho', '.ohho..ohho.',
      '..ohhoohho..', '...ohhhho...', '...ohhhho...', '..ohhoohho..',
      '.ohho..ohho.', 'ohho....ohho', '.oo......oo.', '............',
    ],
    arrowR: [
      '............', '....oo......', '....oho.....', '....ohho....',
      '.oooohhho...', '.ohhhhhhho..', '.ohhhhhhho..', '.oooohhho...',
      '....ohho....', '....oho.....', '....oo......', '............',
    ],
    spark: [
      '............', '.....o......', '....oho.....', '.....o......',
      '..o..h..o...', '.oho.h.oho..', 'ohhhhhhhhho.', '.oho.h.oho..',
      '..o..h..o...', '.....o......', '....oho.....', '.....o......',
    ],
    sun: [
      '.....oo.....', '..o..hh..o..', '..oh.hh.ho..', '....oooo....',
      '.o.ohhhhoo.o', '.hhohhhhhhoh', '.hhohhhhhhoh', '.o.ohhhhoo.o',
      '....oooo....', '..oh.hh.ho..', '..o..hh..o..', '.....oo.....',
    ],
    moon: [
      '............', '....oooo....', '..oohhhho...', '.ohhhhhoo...',
      'ohhhhhoo....', 'ohhhhho.....', 'ohhhhho.....', 'ohhhhhoo....',
      '.ohhhhhoo...', '..oohhhho...', '....oooo....', '............',
    ],
    gear: [
      '............', '...o.oo.o...', '..ofoffofo..', '.ooffffffoo.',
      '.offfooffffo', 'ooffo..offfo', 'ooffo..offfo', '.offfooffffo',
      '.ooffffffoo.', '..ofoffofo..', '...o.oo.o...', '............',
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
