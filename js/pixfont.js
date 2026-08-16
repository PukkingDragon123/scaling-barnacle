// ---- PIXFONT: the game's own bitmap face ---------------------------------------
//
// Every line of text in this game was being set in "Courier New" -- a system
// font, hinted and anti-aliased by the OS, sitting on top of sprites authored at
// four texels per logical unit. No amount of styling fixes that: the glyph edges
// are grey, they land on fractional pixels, and they change shape between
// machines. It is the single loudest non-pixel-art thing on the screen.
//
// This is a hand-authored 4x6 face. Each glyph is four columns by six rows of
// ones and zeros; the top five rows carry caps and x-height, the sixth is the
// descender row for g j p q y. It is MONOSPACE on purpose -- half the panels in
// this game wrap by character count rather than by measuring, and a
// proportional face would silently break every one of them.
//
// The atlas is baked ONCE per (scale, colour) pair into an offscreen canvas and
// blitted per glyph, so drawing a line costs one drawImage per character and
// never touches a path. Colours are few and repeat constantly, so the cache
// stays tiny.
'use strict';

const PixFont = {
  W: 4, H: 6, GAP: 1,              // cell 4x6, one column of air after it

  // '.' is off, '#' is on. Six rows each, top-aligned; row 5 is the descender.
  G: {
    ' ': '....|....|....|....|....|....',
    '!': '.#..|.#..|.#..|....|.#..|....',
    '"': '#.#.|#.#.|....|....|....|....',
    '#': '#.#.|###.|#.#.|###.|#.#.|....',
    '$': '.##.|##..|.##.|.##.|##..|....',
    '%': '#..#|...#|..#.|.#..|#..#|....',
    '&': '.#..|#.#.|.#..|#.#.|.##.|....',
    "'": '.#..|.#..|....|....|....|....',
    '(': '..#.|.#..|.#..|.#..|..#.|....',
    ')': '.#..|..#.|..#.|..#.|.#..|....',
    '*': '#.#.|.#..|#.#.|....|....|....',
    '+': '....|.#..|###.|.#..|....|....',
    ',': '....|....|....|.#..|.#..|#...',
    '-': '....|....|###.|....|....|....',
    '.': '....|....|....|....|.#..|....',
    '/': '...#|..#.|.#..|#...|#...|....',
    '0': '.##.|#..#|#..#|#..#|.##.|....',
    '1': '.#..|##..|.#..|.#..|###.|....',
    '2': '##..|..#.|.#..|#...|###.|....',
    '3': '##..|..#.|.#..|..#.|##..|....',
    '4': '#.#.|#.#.|###.|..#.|..#.|....',
    '5': '###.|#...|##..|..#.|##..|....',
    '6': '.##.|#...|##..|#..#|.##.|....',
    '7': '###.|..#.|.#..|.#..|.#..|....',
    '8': '.##.|#..#|.##.|#..#|.##.|....',
    '9': '.##.|#..#|.###|..#.|##..|....',
    ':': '....|.#..|....|.#..|....|....',
    ';': '....|.#..|....|.#..|.#..|#...',
    '<': '..#.|.#..|#...|.#..|..#.|....',
    '=': '....|###.|....|###.|....|....',
    '>': '#...|.#..|..#.|.#..|#...|....',
    '?': '##..|..#.|.#..|....|.#..|....',
    '@': '.##.|#..#|#.##|#...|.##.|....',
    'A': '.##.|#..#|####|#..#|#..#|....',
    'B': '###.|#..#|###.|#..#|###.|....',
    'C': '.###|#...|#...|#...|.###|....',
    'D': '###.|#..#|#..#|#..#|###.|....',
    'E': '####|#...|###.|#...|####|....',
    'F': '####|#...|###.|#...|#...|....',
    'G': '.###|#...|#.##|#..#|.###|....',
    'H': '#..#|#..#|####|#..#|#..#|....',
    'I': '###.|.#..|.#..|.#..|###.|....',
    'J': '..##|...#|...#|#..#|.##.|....',
    'K': '#..#|#.#.|##..|#.#.|#..#|....',
    'L': '#...|#...|#...|#...|####|....',
    'M': '#..#|####|####|#..#|#..#|....',
    'N': '#..#|##.#|#.##|#..#|#..#|....',
    'O': '.##.|#..#|#..#|#..#|.##.|....',
    'P': '###.|#..#|###.|#...|#...|....',
    'Q': '.##.|#..#|#..#|#.#.|.#.#|....',
    'R': '###.|#..#|###.|#.#.|#..#|....',
    'S': '.###|#...|.##.|...#|###.|....',
    'T': '###.|.#..|.#..|.#..|.#..|....',
    'U': '#..#|#..#|#..#|#..#|.##.|....',
    'V': '#..#|#..#|#..#|.##.|.##.|....',
    'W': '#..#|#..#|####|####|#..#|....',
    'X': '#..#|.##.|.##.|.##.|#..#|....',
    'Y': '#..#|#..#|.##.|.#..|.#..|....',
    'Z': '####|..#.|.#..|#...|####|....',
    '[': '.##.|.#..|.#..|.#..|.##.|....',
    '\\': '#...|#...|.#..|..#.|...#|....',
    ']': '.##.|..#.|..#.|..#.|.##.|....',
    '^': '.#..|#.#.|....|....|....|....',
    '_': '....|....|....|....|####|....',
    '`': '#...|.#..|....|....|....|....',
    'a': '....|.##.|#.#.|#.#.|.###|....',
    'b': '#...|##..|#.#.|#.#.|##..|....',
    'c': '....|.##.|#...|#...|.##.|....',
    'd': '...#|.###|#..#|#..#|.###|....',
    'e': '....|.##.|####|#...|.##.|....',
    'f': '..#.|.#..|###.|.#..|.#..|....',
    'g': '....|.###|#..#|.###|...#|.##.',
    'h': '#...|##..|#.#.|#.#.|#.#.|....',
    'i': '.#..|....|##..|.#..|###.|....',
    'j': '..#.|....|..#.|..#.|..#.|##..',
    'k': '#...|#.#.|##..|##..|#.#.|....',
    'l': '##..|.#..|.#..|.#..|.##.|....',
    'm': '....|##.#|####|#.##|#..#|....',
    'n': '....|##..|#.#.|#.#.|#.#.|....',
    'o': '....|.##.|#..#|#..#|.##.|....',
    'p': '....|##..|#.#.|##..|#...|#...',
    'q': '....|.###|#.#.|.##.|..#.|..##',
    'r': '....|#.##|##..|#...|#...|....',
    's': '....|.###|.##.|..#.|###.|....',
    't': '.#..|###.|.#..|.#..|..##|....',
    'u': '....|#..#|#..#|#..#|.###|....',
    'v': '....|#..#|#..#|.##.|.##.|....',
    'w': '....|#..#|####|####|.##.|....',
    'x': '....|#..#|.##.|.##.|#..#|....',
    'y': '....|#..#|#..#|.###|...#|.##.',
    'z': '....|####|..#.|.#..|####|....',
    '{': '..##|.#..|##..|.#..|..##|....',
    '|': '.#..|.#..|.#..|.#..|.#..|....',
    '}': '##..|..#.|.###|..#.|##..|....',
    '~': '....|.#.#|#.#.|....|....|....',
  },

  _order: null,        // the atlas's character order, built once
  _idx: null,          // char -> column in the atlas
  _cache: null,        // "scale|colour" -> canvas
  _n: 0,

  _boot() {
    if (this._order) return;
    const chars = [];
    for (const k in this.G) if (Object.prototype.hasOwnProperty.call(this.G, k)) chars.push(k);
    this._order = chars;
    this._idx = {};
    for (let i = 0; i < chars.length; i++) this._idx[chars[i]] = i;
    this._cache = {};
    this._n = 0;
  },

  // The whole face, in one colour, at one scale, baked at device density. The
  // key is coarse on purpose: a handful of colours and four or five scales are
  // all this game ever asks for.
  atlas(px, colour) {
    this._boot();
    const key = px + '|' + colour;
    const hit = this._cache[key];
    if (hit) return hit;

    // A cache that only grows is a leak in a program that runs for hours. There
    // are never more than a few dozen live combinations, so past that, drop the
    // lot and let it refill rather than tracking ages.
    if (this._n > 96) { this._cache = {}; this._n = 0; }

    const cw = this.W * px, ch = this.H * px;
    const cv = document.createElement('canvas');
    cv.width = cw * this._order.length;
    cv.height = ch;
    const c = cv.getContext('2d');
    c.fillStyle = colour;
    for (let i = 0; i < this._order.length; i++) {
      const rows = this.G[this._order[i]].split('|');
      const ox = i * cw;
      for (let y = 0; y < rows.length && y < this.H; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length && x < this.W; x++) {
          if (row[x] !== '.') c.fillRect(ox + x * px, y * px, px, px);
        }
      }
    }
    this._cache[key] = cv;
    this._n++;
    return cv;
  },
};
