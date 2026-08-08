// ---- uibar: the two HUD icon buttons -------------------------------------------
//
// A trophy for the skill tree and a satchel for the bag, sitting under the Day
// badge. They exist because [K] and [Tab] are invisible: the buttons are the
// discoverable face of the same two panels, and their BADGES are the news
// ticker -- a gold count when skill points are waiting to be spent, a green
// count when learning something has just unlocked recipes you have not looked
// at. Click or tap either one; on touch the tap arrives as a synthesized mouse
// click (main.js does that), so one hit-test serves both.
//
// The icons are BAKED once at device resolution and blitted. Nothing here
// allocates per frame, and the recipe recount runs every 30th frame, not every
// frame -- 45 Forge.unlocked calls each frame would be paying real money for a
// number that changes a few times an hour.
'use strict';

const UIBar = {
  // under the Day panel (W-74..W-6, 6..26 plus the dial), right-aligned with it
  BX: 0, BY: 40, BW: 22, BH: 22, GAP: 5,
  _installed: false,
  _cv: null,            // [0] trophy, [1] satchel, baked side by side
  time: 0,
  _frame: 0,
  _recNow: 0,           // unlocked-recipe count, recounted every 30 frames
  _wasCraftOpen: false,

  buttons() {
    const x1 = W - 6 - this.BW;                    // satchel, outer
    const x0 = x1 - this.GAP - this.BW;            // trophy, inner
    return [
      { x: x0, y: this.BY, key: 'skills' },
      { x: x1, y: this.BY, key: 'bag' },
    ];
  },

  // ==== the baked icons ======================================================
  // ACTUAL PIXEL ART: two 16x16 grids, one character per pixel, painted once into
  // an offscreen canvas at DPX and then blitted. The previous pair were drawn with
  // quadratic curves and arcs, which is why they read as vector clip-art sitting
  // on top of a pixel game -- at this size every pixel is a deliberate decision
  // and a curve just guesses for you.
  //
  // '.' is transparent; every other character indexes PAL.
  PAL: {
    o: '#2a1b10',    // outline
    d: '#8a5a20',    // dark gold / dark leather
    m: '#e8b84e',    // mid gold
    l: '#ffd66e',    // light gold
    w: '#fff2c8',    // highlight
    b: '#7a4a2a',    // dark leather
    t: '#b07840',    // mid leather
    c: '#c99a5e',    // light leather
    s: '#5a3a18',    // shadow under things
  },
  TROPHY: [
    '................',
    '..oooooooooooo..',
    '.o.wmmmmmmmml.o.',
    'oo.wmmmmmmmml.oo',
    'o.o.mmmmmmmm.o.o',
    'o.o.wmmmmmml.o.o',
    'oo.o.mmmmmm.o.oo',
    '.oo.o.mmmm.o.oo.',
    '..o..ol..lo..o..',
    '.......dd.......',
    '.......dd.......',
    '......oddo......',
    '.....odddddo....',
    '....olmmmmmlo...',
    '....ooooooooo...',
    '................',
  ],
  SATCHEL: [
    '................',
    '.....bbbbbb.....',
    '....b......b....',
    '...b........b...',
    '...b........b...',
    '..oooooooooooo..',
    '.occccccccccco..',
    '.ocwwccccccwco..',
    '.occccccccccco..',
    '.otttttmmttttto.',
    '.ottttollottto..',
    '.ottttollottto..',
    '.otttttmmttttto.',
    '..ottttttttto...',
    '...ooooooooo....',
    '................',
  ],

  _icons() {
    if (this._cv) return this._cv;
    const S = 16, q = DPX;
    const cv = document.createElement('canvas');
    cv.width = S * 2 * q; cv.height = S * q;
    const c = cv.getContext('2d');
    const paint = (grid, ox) => {
      for (let y = 0; y < grid.length; y++) {
        const row = grid[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          const col = this.PAL[ch];
          if (!col) continue;
          c.fillStyle = col;
          c.fillRect((ox + x) * q, y * q, q, q);
        }
      }
    };
    paint(this.TROPHY, 0);
    paint(this.SATCHEL, S);
    this._cv = cv;
    return cv;
  },

  // ==== state reads ==========================================================
  _points() {
    try { return (typeof Skills !== 'undefined' && Skills.points) ? Skills.points() : 0; }
    catch (e) { return 0; }
  },

  _recount() {
    if (typeof Inv === 'undefined' || !Inv.RECIPES || typeof Forge === 'undefined') return;
    let n = 0;
    for (let i = 0; i < Inv.RECIPES.length; i++) if (Forge.unlocked(Inv.RECIPES[i].key)) n++;
    this._recNow = n;
  },

  _ui() {
    if (typeof G === 'undefined' || !G) return null;
    if (!G.ui || typeof G.ui !== 'object') G.ui = {};
    if (typeof G.ui.seenRecipes !== 'number') G.ui.seenRecipes = 0;
    return G.ui;
  },

  newRecipes() {
    const u = this._ui();
    if (!u) return 0;
    return Math.max(0, this._recNow - u.seenRecipes);
  },

  _peerOpen() {
    if (typeof Shop !== 'undefined' && Shop.open) return true;
    if (typeof Bench !== 'undefined' && Bench.open) return true;
    if (typeof Game !== 'undefined' && Game.helpOpen) return true;
    if (typeof Craft !== 'undefined' && Craft.open) return true;
    if (typeof NPCs !== 'undefined' && NPCs.open) return true;
    if (typeof Stock !== 'undefined' && Stock.open) return true;
    if (typeof Farm !== 'undefined' && Farm.open) return true;
    if (typeof Inv !== 'undefined' && Inv.open) return true;
    if (typeof Skills !== 'undefined' && Skills.open) return true;
    if (typeof Tame !== 'undefined' && Tame.open) return true;
    if (typeof Forge !== 'undefined' && Forge.open) return true;
    if (typeof MapChart !== 'undefined' && MapChart.open) return true;
    if (typeof Battle !== 'undefined' && Battle.active) return true;
    return false;
  },

  _visible() {
    if (typeof G === 'undefined' || !G) return false;
    if (typeof Game === 'undefined' || Game.scene === TitleScene) return false;
    if (typeof DiveScene !== 'undefined' && Game.scene === DiveScene) return false;
    return true;
  },

  // ==== per frame ============================================================
  update(dt) {
    this.time += dt;
    this._frame++;
    if (this._frame % 30 === 0) this._recount();

    // seeing the recipes clears the news: any craft surface counts as seeing
    const craftOpen = (typeof Inv !== 'undefined' && Inv.open) ||
                      (typeof Forge !== 'undefined' && Forge.open);
    if (craftOpen && !this._wasCraftOpen) {
      const u = this._ui();
      if (u && this._recNow > u.seenRecipes) { u.seenRecipes = this._recNow; Game.save(); }
    }
    this._wasCraftOpen = craftOpen;

    if (!this._visible() || this._peerOpen() || Game.fadeDir !== 0) return;
    if (!Input.mouse.clicked) return;
    const m = Input.mouse;
    for (const b of this.buttons()) {
      if (m.x < b.x || m.x > b.x + this.BW || m.y < b.y || m.y > b.y + this.BH) continue;
      Input.mouse.clicked = false;                 // consumed: the scene must not also act
      if (b.key === 'skills') { if (typeof Skills !== 'undefined' && Skills.openUI) Skills.openUI(); }
      else if (typeof Inv !== 'undefined' && Inv.toggleBag) Inv.toggleBag();
      if (typeof SND !== 'undefined') SND.click();
      return;
    }
  },

  draw(c) {
    if (!this._visible() || this._peerOpen()) return;
    const cv = this._icons();
    const S = 16, q = DPX;
    const m = Input.mouse;
    const pts = this._points();
    const fresh = this.newRecipes();

    for (const b of this.buttons()) {
      const hot = !TouchUI.enabled && m.x >= b.x && m.x <= b.x + this.BW && m.y >= b.y && m.y <= b.y + this.BH;
      const y = b.y - (hot ? 1 : 0);
      c.fillStyle = 'rgba(16,22,34,0.85)';
      c.fillRect(b.x, y, this.BW, this.BH);
      c.strokeStyle = hot ? '#ffd66e' : '#6a5030';
      c.lineWidth = PIX * 2;
      c.strokeRect(b.x + PIX, y + PIX, this.BW - PIX * 2, this.BH - PIX * 2);
      const si = b.key === 'skills' ? 0 : 1;
      c.drawImage(cv, si * S * q, 0, S * q, S * q, b.x + 3, y + 3, S, S);

      // the badge: what is waiting inside. A SQUARE tag on the pixel grid, not a
      // pulsing anti-aliased circle -- the circle was the one piece of web
      // chrome left on the HUD and it read as a notification dot from a phone.
      const n = b.key === 'skills' ? pts : fresh;
      if (n > 0) {
        const bw = 9, bh = 9;
        const bx = b.x + this.BW - bw + 2, by = y - 2;
        c.fillStyle = 'rgba(20,12,7,0.9)';
        c.fillRect(bx - PIX * 2, by - PIX * 2, bw + PIX * 4, bh + PIX * 4);
        c.fillStyle = b.key === 'skills' ? '#ffd66e' : '#a8d878';
        c.fillRect(bx, by, bw, bh);
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(bx, by, bw, PIX * 2);
        text(c, String(Math.min(n, 9)), bx + bw / 2, by + 1.4, { size: 7, color: '#3a2808', align: 'center', shadow: false });
      }
    }
  },

  // ==== install ==============================================================
  install() {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;

    const gU = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) { gU(dt); UIBar.update(dt); };

    // rides with the HUD: hides under modals for free, exactly like the hotbar
    const gH = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) { gH(c); UIBar.draw(c); };
  },
};

if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') UIBar.install();
else document.addEventListener('DOMContentLoaded', function () { UIBar.install(); }, { once: true });
