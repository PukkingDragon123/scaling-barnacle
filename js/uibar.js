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
  // Two 18x18-logical drawings at DPX texels: a trophy cup and a flap satchel.
  // Three shades and a highlight each -- the difference between an icon and a
  // coloured rectangle is entirely in these few strokes.
  _icons() {
    if (this._cv) return this._cv;
    const S = 18, q = DPX;
    const cv = document.createElement('canvas');
    cv.width = S * 2 * q; cv.height = S * q;
    const c = cv.getContext('2d');
    c.scale(q, q);

    // ---- trophy ----
    c.save();
    c.translate(0, 0);
    c.fillStyle = '#8a5a20';                       // plinth
    c.fillRect(5.5, 14, 7, 2);
    c.fillRect(7.5, 12.5, 3, 2);
    c.fillStyle = '#e8b84e';                       // cup
    c.beginPath();
    c.moveTo(4.5, 3); c.lineTo(13.5, 3);
    c.lineTo(12.6, 9); c.quadraticCurveTo(9, 12.4, 5.4, 9);
    c.closePath(); c.fill();
    c.strokeStyle = '#e8b84e';                     // handles
    c.lineWidth = 1.3;
    c.beginPath(); c.arc(4.2, 5.4, 2.2, Math.PI * 0.5, Math.PI * 1.5); c.stroke();
    c.beginPath(); c.arc(13.8, 5.4, 2.2, -Math.PI * 0.5, Math.PI * 0.5); c.stroke();
    c.fillStyle = '#fff2c8';                       // shine
    c.fillRect(6.2, 4, 1.6, 4.2);
    c.fillStyle = '#a87820';                       // bowl shadow
    c.fillRect(5.2, 3, 7.6, 1);
    c.fillStyle = '#ffd66e';                       // the star on the plinth
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5, r1 = 1.8, r2 = 0.8;
      const a2 = a + TAU / 10;
      c.lineTo(9 + Math.cos(a) * r1, 15 + Math.sin(a) * r1);
      c.lineTo(9 + Math.cos(a2) * r2, 15 + Math.sin(a2) * r2);
    }
    c.closePath(); c.fill();
    c.restore();

    // ---- satchel ----
    c.save();
    c.translate(S, 0);
    c.strokeStyle = '#8a5a30';                     // strap
    c.lineWidth = 1.4;
    c.beginPath(); c.arc(9, 8, 6.4, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    c.fillStyle = '#b07840';                       // body
    c.beginPath();
    c.moveTo(3.4, 7.5); c.lineTo(14.6, 7.5);
    c.quadraticCurveTo(15.4, 15, 12.5, 15.4);
    c.lineTo(5.5, 15.4);
    c.quadraticCurveTo(2.6, 15, 3.4, 7.5);
    c.closePath(); c.fill();
    c.fillStyle = '#8a5a30';                       // under-flap shadow
    c.fillRect(3.6, 7.5, 10.8, 1.6);
    c.fillStyle = '#c99a5e';                       // flap
    c.beginPath();
    c.moveTo(3.2, 7.5); c.lineTo(14.8, 7.5);
    c.lineTo(14, 11); c.quadraticCurveTo(9, 12.6, 4, 11);
    c.closePath(); c.fill();
    c.fillStyle = '#ffd66e';                       // buckle
    c.fillRect(8.1, 10, 1.8, 2.4);
    c.fillStyle = '#fff2c8';                       // flap highlight
    c.fillRect(4.4, 8, 8, 0.8);
    c.restore();

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
    const S = 18, q = DPX;
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
      c.drawImage(cv, si * S * q, 0, S * q, S * q, b.x + 2, y + 2, S, S);

      // the badge: what is waiting inside
      const n = b.key === 'skills' ? pts : fresh;
      if (n > 0) {
        const pulse = 1 + 0.14 * Math.sin(this.time * TAU);
        const r = 5 * pulse;
        const bx = b.x + this.BW - 2.5, by = y + 2.5;
        c.fillStyle = b.key === 'skills' ? '#ffd66e' : '#7de08a';
        c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(20,16,8,0.65)';
        c.lineWidth = PIX * 2;
        c.beginPath(); c.arc(bx, by, r, 0, TAU); c.stroke();
        text(c, String(Math.min(n, 9)), bx, by - 3.4, { size: 7, color: '#3a2808', align: 'center', shadow: false });
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
