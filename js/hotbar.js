// ---- the hotbar: 10 quick slots for tools and stacks -------------------------
'use strict';

const Hotbar = {
  SLOTS: 10,
  CELL: 19,        // cell size in logical units
  GAP: 2,
  LIFT: 2,         // how far the selected cell rises out of the bar
  ICON: 13,        // art fits inside this box, centred in the cell
  MAX_STACK: 99,
  NAME_T: 1.5,     // seconds the floating name stays up after a change

  nameT: 0,

  // Tool key -> asset name. Only the diving tools shipped with art; the farm
  // tools resolve to names that do not exist in the manifest ON PURPOSE, so
  // _glyph() draws them until real art lands (drawA would silently no-op).
  // Every tool now points at real uploaded art. 'g_can' and 'g_hoe' were named
  // for assets that never existed, so those two silently drew a coded glyph while
  // the actual watering can and hoe sat unused in the manifest as ftool_1/ftool_0.
  TOOL_ART: {
    scraper: 'g_scraper',
    pry: 'g_crowbar',
    hoe: 'ftool_0',        // hoe
    can: 'ftool_1',        // watering can
    spade: 'ftool_2',
    rake: 'ftool_3',
    sickle: 'ftool_4',
    shears: 'ftool_5',
    trowel: 'ftool_6',
    fork: 'ftool_7',
    seedbag: 'ftool_8',    // the seed sack, not a net bag
    basket: 'ftool_9',
    bucket: 'ftool_10',
    gloves: 'ftool_11',
    // The three pickaxe tiers have their own art now, so a better pick LOOKS
    // better in the bar instead of every tier sharing a swing frame.
    pick: 'pick_stone',
    pick_stone: 'pick_stone',
    pick_iron: 'pick_iron',
    pick_crystal: 'pick_crystal',
    pot: 'res_pot',
    lens: 'res_lens',
    cutlass: 'wpn_cutlass',
    flint: 'wpn_flint',
    bomb: 'wpn_bomb',
    cannon: 'wpn_cannon',
  },

  TOOL_NAMES: {
    scraper: 'Scraper',
    pry: 'Pry Bar',
    can: 'Watering Can',
    hoe: 'Hoe',
    spade: 'Spade',
    rake: 'Rake',
    sickle: 'Sickle',
    shears: 'Shears',
    trowel: 'Trowel',
    fork: 'Pitchfork',
    basket: 'Basket',
    bucket: 'Bucket',
    gloves: 'Work Gloves',
    pick: 'Pickaxe',
    pick_stone: 'Stone Pickaxe',
    pick_iron: 'Iron Pickaxe',
    pick_crystal: 'Crystal Pickaxe',
    pot: 'Crab Pot',
    lens: 'Jeweller\u2019s Lens',
    cutlass: 'Cutlass',
    flint: 'Flintlock',
    bomb: 'Powder Bomb',
    seedbag: 'Seed Bag',
    cannon: 'Cannon',
  },

  // Display names for item keys that are not in ITEMS (crops, produce, cooking).
  // Anything missing here falls back to a prettified key, so a caller can invent
  // a key without editing this file.
  ITEM_NAMES: {
    crop_gourd_seed: 'Gourd Seeds', crop_gourd_p: 'Sea Gourd',
    crop_curl_seed: 'Curl Seeds', crop_curl_p: 'Kelp Curl',
    crop_berry_seed: 'Berry Seeds', crop_berry_p: 'Reef Berry',
    crop_blade_seed: 'Blade Seeds', crop_blade_p: 'Sea Blade',
    crop_moon_seed: 'Moon Seeds', crop_moon_p: 'Moon Bloom',
    stock_puffer_p: 'Puffer Milk',
    stock_sunfish_p: 'Sunfish Roe',
    stock_hogfish_p: 'Hogfish Cut',
  },

  // Item key -> asset name, for item keys that are neither an ITEMS key nor an
  // asset name themselves. Resolution order lives in _itemArt().
  ITEM_ART: {},

  // ---- state -----------------------------------------------------------------
  // G.hotbar is an array of SLOTS slot objects; G.hotbarSel is the index.
  // Both are created lazily because G is null until loadAssets' callback runs.
  _empty() { return { kind: null, key: null, n: 0 }; },

  // Rebuild one slot from whatever JSON.parse handed back — a hand-edited or
  // older save must never be able to poison draw/update with junk.
  _clean(s) {
    if (!s || typeof s !== 'object') return this._empty();
    const kind = (s.kind === 'tool' || s.kind === 'item') ? s.kind : null;
    if (!kind || typeof s.key !== 'string' || !s.key) return this._empty();
    if (kind === 'tool') return { kind: 'tool', key: s.key, n: 1 };
    const n = Math.floor(s.n);
    if (!isFinite(n) || n <= 0) return this._empty();
    return { kind: 'item', key: s.key, n: Math.min(n, this.MAX_STACK) };
  },

  // Call at the top of every public entry point. Returns false while G is null
  // (title screen / before boot) so callers can bail without a null check.
  _ensure() {
    if (typeof G === 'undefined' || !G) return false;
    const cur = G.hotbar;
    if (!Array.isArray(cur) || cur.length !== this.SLOTS) {
      const next = [];
      for (let i = 0; i < this.SLOTS; i++)
        next.push(Array.isArray(cur) ? this._clean(cur[i]) : this._empty());
      G.hotbar = next;
    } else {
      for (let i = 0; i < this.SLOTS; i++) {
        const s = cur[i];
        if (!s || typeof s !== 'object' || (s.kind !== null && s.kind !== 'tool' && s.kind !== 'item'))
          cur[i] = this._clean(s);
      }
    }
    const sel = Math.round(G.hotbarSel);
    G.hotbarSel = isFinite(sel) ? clamp(sel, 0, this.SLOTS - 1) : 0;
    return true;
  },

  slots() { return this._ensure() ? G.hotbar : []; },
  index() { return this._ensure() ? G.hotbarSel : 0; },
  selected() { return this._ensure() ? G.hotbar[G.hotbarSel] : this._empty(); },

  slot(i) {
    if (!this._ensure() || i < 0 || i >= this.SLOTS) return null;
    return G.hotbar[i];
  },

  isEmpty(s) { return !s || !s.kind || (s.kind === 'item' && s.n <= 0); },

  label(s) {
    if (this.isEmpty(s)) return '';
    if (s.kind === 'tool') return this.TOOL_NAMES[s.key] || this._pretty(s.key);
    if (typeof ITEMS !== 'undefined' && ITEMS[s.key]) return ITEMS[s.key].name;
    return this.ITEM_NAMES[s.key] || this._pretty(s.key);
  },

  // 'crop_moon_p' -> 'Crop Moon P'. Ugly, but never blank and never a crash.
  _pretty(key) {
    return String(key).replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  },

  // ---- selection ---------------------------------------------------------------
  select(i, quiet) {
    if (!this._ensure()) return;
    i = clamp(Math.round(i) || 0, 0, this.SLOTS - 1);
    const changed = i !== G.hotbarSel;
    G.hotbarSel = i;
    this.nameT = this.NAME_T;
    if (changed && !quiet) {
      SND.blip();
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    }
  },

  cycle(dir) { this.select((this.index() + (dir > 0 ? 1 : this.SLOTS - 1)) % this.SLOTS); },

  // ---- inventory ---------------------------------------------------------------
  // Stacks into matching slots first, then fills empties. Returns the count that
  // did NOT fit so the caller can spill it into storage / drop it / warn.
  give(kind, key, n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0) return 0;
    if (!this._ensure() || (kind !== 'tool' && kind !== 'item') || !key) return n;
    const slots = G.hotbar;

    if (kind === 'tool') {
      // Tools are unique on the bar: a duplicate is "already delivered", not lost.
      for (let i = 0; i < this.SLOTS; i++)
        if (slots[i].kind === 'tool' && slots[i].key === key) return 0;
      for (let i = 0; i < this.SLOTS; i++) {
        if (this.isEmpty(slots[i])) { slots[i] = { kind: 'tool', key: key, n: 1 }; return 0; }
      }
      return n;
    }

    let left = n;
    for (let i = 0; i < this.SLOTS && left > 0; i++) {
      const s = slots[i];
      if (s.kind !== 'item' || s.key !== key) continue;
      const room = this.MAX_STACK - s.n;
      if (room <= 0) continue;
      const take = Math.min(room, left);
      s.n += take; left -= take;
    }
    for (let i = 0; i < this.SLOTS && left > 0; i++) {
      if (!this.isEmpty(slots[i])) continue;
      const take = Math.min(this.MAX_STACK, left);
      slots[i] = { kind: 'item', key: key, n: take };
      left -= take;
    }
    return left;
  },

  // Remove n from the SELECTED stack. Returns how many were actually removed.
  consume(n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0 || !this._ensure()) return 0;
    const s = G.hotbar[G.hotbarSel];
    if (!s || s.kind !== 'item') return 0;   // tools are never used up
    const got = Math.min(s.n, n);
    s.n -= got;
    if (s.n <= 0) G.hotbar[G.hotbarSel] = this._empty();
    return got;
  },

  // Remove n of a specific thing from anywhere on the bar, smallest stacks first
  // so partial stacks get tidied up. Returns how many were removed.
  take(kind, key, n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0 || !this._ensure()) return 0;
    const slots = G.hotbar;
    let left = n, got = 0;
    const order = [];
    for (let i = 0; i < this.SLOTS; i++)
      if (slots[i].kind === kind && slots[i].key === key) order.push(i);
    order.sort((a, b) => slots[a].n - slots[b].n);
    for (let j = 0; j < order.length && left > 0; j++) {
      const s = slots[order[j]];
      const amt = Math.min(s.n, left);
      s.n -= amt; left -= amt; got += amt;
      if (s.n <= 0) slots[order[j]] = this._empty();
    }
    return got;
  },

  count(kind, key) {
    if (!this._ensure()) return 0;
    let c = 0;
    for (let i = 0; i < this.SLOTS; i++) {
      const s = G.hotbar[i];
      if (s.kind === kind && s.key === key) c += s.n;
    }
    return c;
  },

  has(kind, key, n) { return this.count(kind, key) >= (n === undefined ? 1 : n); },

  clearSlot(i) {
    if (!this._ensure() || i < 0 || i >= this.SLOTS) return;
    G.hotbar[i] = this._empty();
  },

  setSlot(i, kind, key, n) {
    if (!this._ensure() || i < 0 || i >= this.SLOTS) return;
    G.hotbar[i] = this._clean({ kind: kind, key: key, n: n === undefined ? 1 : n });
  },

  swap(i, j) {
    if (!this._ensure()) return;
    if (i < 0 || j < 0 || i >= this.SLOTS || j >= this.SLOTS || i === j) return;
    const t = G.hotbar[i]; G.hotbar[i] = G.hotbar[j]; G.hotbar[j] = t;
  },

  // ---- geometry ----------------------------------------------------------------
  barW() { return this.SLOTS * this.CELL + (this.SLOTS - 1) * this.GAP; },
  // Centred, hugging the bottom edge. Whole footprint (backing + lifted cell) is
  // 23 units tall, clear of the y<=36 HUD strip and of the touch pads at x<110.
  barX() { return Math.round((W - this.barW()) / 2); },
  barY() { return H - 4 - this.CELL; },
  cellX(i) { return this.barX() + i * (this.CELL + this.GAP); },
  cellY(i) { return this.barY() - (i === this.index() ? this.LIFT : 0); },

  hit(mx, my) {
    const y0 = this.barY() - this.LIFT, y1 = this.barY() + this.CELL;
    if (my < y0 || my > y1) return -1;
    const rel = mx - this.barX();
    if (rel < 0) return -1;
    const step = this.CELL + this.GAP;
    const i = Math.floor(rel / step);
    if (i < 0 || i >= this.SLOTS) return -1;
    if (rel - i * step > this.CELL) return -1;   // in the gutter between cells
    return i;
  },

  // ---- update --------------------------------------------------------------------
  // Returns true when it swallowed this frame's click (a slot was tapped), so a
  // caller can skip its own click handling.
  update(dt) {
    if (!this._ensure()) return false;
    if (this.nameT > 0) this.nameT = Math.max(0, this.nameT - dt);

    // A modal owns the keyboard while it is up — Shop reads Digit1..4 for tabs —
    // and nothing should move during a fade. Keep ticking the label, take nothing.
    if (Game.fadeDir !== 0 || Game.helpOpen) return false;
    if (typeof Shop !== 'undefined' && Shop.open) return false;
    if (typeof Bench !== 'undefined' && Bench.open) return false;

    for (let i = 0; i < this.SLOTS; i++) {
      // slot 10 sits under Digit0, the way every hotbar since Doom has done it
      if (Input.p('Digit' + ((i + 1) % 10))) { this.select(i); return false; }
    }
    if (Input.wheelDelta) this.cycle(Input.wheelDelta);
    if (Input.mouse.clicked) {
      const i = this.hit(Input.mouse.x, Input.mouse.y);
      if (i >= 0) { this.select(i); return true; }
    }
    return false;
  },

  // ---- art ------------------------------------------------------------------------
  _hasArt(name) { return !!(name && typeof ASSETS !== 'undefined' && ASSETS[name] && ASSETS[name].width); },

  // Draw an asset scaled so its longest side fits `box`, centred on (cx, cy).
  _drawFit(ctx, name, cx, cy, box) {
    const img = ASSETS[name];
    const w = img.width >= img.height ? box : box * img.width / img.height;
    drawAC(ctx, name, cx, cy, w);
  },

  _itemArt(key) {
    if (this._hasArt(this.ITEM_ART[key])) return this.ITEM_ART[key];
    if (this._hasArt(key)) return key;          // callers may pass an asset name directly
    return null;
  },

  drawSlotArt(ctx, s, cx, cy, box) {
    if (this.isEmpty(s)) return;
    if (s.kind === 'tool') {
      const name = this.TOOL_ART[s.key];
      if (this._hasArt(name)) this._drawFit(ctx, name, cx, cy, box);
      else this._glyph(ctx, s.key, cx, cy, box);
      return;
    }
    // drawItemIcon resolves through the full art chain now and reports whether it
    // drew anything -- so it goes FIRST for every key, not only the ITEMS ones,
    // and the coded glyph is what happens when the whole chain comes up empty.
    if (typeof drawItemIcon === 'function' && drawItemIcon(ctx, s.key, cx, cy, box)) return;
    const art = this._itemArt(s.key);
    if (art) this._drawFit(ctx, art, cx, cy, box);
    else this._glyph(ctx, s.key, cx, cy, box);
  },

  // Hand-coded stand-ins, so a missing asset reads as a tool and not as an empty
  // slot. Every shape sets fillStyle once — no colour strings built in a loop.
  _glyph(ctx, key, cx, cy, box) {
    const u = box / 12;                       // glyph units: the art is drawn on a 12x12 grid
    const wood = '#8a6434', dark = '#5a3a1e', steel = '#c9d4dc', iron = '#8f9aa4';
    ctx.save();
    ctx.translate(cx, cy);
    if (key === 'can') {
      ctx.fillStyle = iron;
      ctx.fillRect(-4 * u, -2 * u, 7 * u, 6 * u);          // body
      ctx.fillRect(3 * u, -4 * u, 3 * u, 1.4 * u);         // spout arm
      ctx.fillRect(5 * u, -5.4 * u, 1.6 * u, 2 * u);       // rose
      ctx.fillStyle = steel;
      ctx.fillRect(-4 * u, -2 * u, 7 * u, 1.2 * u);        // rim highlight
      ctx.fillRect(-2.5 * u, -4.6 * u, 1.2 * u, 2.6 * u);  // handle
      ctx.fillStyle = '#5ad2f0';
      ctx.fillRect(5.4 * u, -3 * u, 0.8 * u, 1.6 * u);     // a drip
    } else if (key === 'hoe') {
      ctx.fillStyle = wood;
      ctx.fillRect(-0.7 * u, -5.5 * u, 1.4 * u, 9 * u);
      ctx.fillStyle = iron;
      ctx.fillRect(-3.6 * u, 3 * u, 4.4 * u, 1.6 * u);     // blade
      ctx.fillRect(-1.2 * u, 1.8 * u, 2 * u, 1.6 * u);     // neck
    } else if (key === 'seedbag') {
      ctx.fillStyle = '#c9a271';
      ctx.beginPath();
      ctx.moveTo(-3.6 * u, -1 * u); ctx.lineTo(3.6 * u, -1 * u);
      ctx.lineTo(4.4 * u, 5 * u); ctx.lineTo(-4.4 * u, 5 * u);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(-2.4 * u, -2.6 * u, 4.8 * u, 1.8 * u);  // tied neck
      ctx.fillStyle = '#a0f2b4';
      ctx.fillRect(-1.6 * u, 1.4 * u, 1.4 * u, 1.4 * u);   // spilled seed
      ctx.fillRect(0.6 * u, 2.4 * u, 1.4 * u, 1.4 * u);
    } else if (key === 'scraper') {
      ctx.fillStyle = wood;
      ctx.fillRect(-4.5 * u, 1 * u, 5 * u, 1.8 * u);
      ctx.fillStyle = steel;
      ctx.fillRect(0.5 * u, -0.4 * u, 4.4 * u, 3.4 * u);
    } else if (key === 'pry') {
      ctx.fillStyle = iron;
      ctx.fillRect(-1 * u, -5 * u, 1.8 * u, 9 * u);
      ctx.fillRect(-3.6 * u, -5 * u, 3 * u, 1.8 * u);      // the hooked end
    } else if (key === 'cannon') {
      ctx.fillStyle = dark;
      ctx.fillRect(-5 * u, -2.6 * u, 8 * u, 3.6 * u);      // barrel
      ctx.fillStyle = iron;
      ctx.fillRect(2.6 * u, -3.2 * u, 1.6 * u, 4.8 * u);   // muzzle ring
      ctx.fillStyle = wood;
      ctx.beginPath(); ctx.arc(-2 * u, 2.6 * u, 2.4 * u, 0, TAU); ctx.fill();
    } else {
      // unknown item: a parchment tag with the first two letters
      ctx.fillStyle = '#f2e6c9';
      ctx.fillRect(-4 * u, -4 * u, 8 * u, 8 * u);
      ctx.fillStyle = dark;
      ctx.fillRect(-4 * u, -4 * u, 8 * u, 1 * u);
      text(ctx, String(key).slice(0, 2).toUpperCase(), 0, -1.5 * u, {
        size: Math.max(5, 4.6 * u), color: '#6a4420', align: 'center', shadow: false });
    }
    ctx.restore();
  },

  // ---- draw ---------------------------------------------------------------------
  _cellPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  },

  draw(ctx) {
    if (!this._ensure()) return;
    const C = this.CELL, x0 = this.barX(), y0 = this.barY();
    const sel = G.hotbarSel;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const hov = TouchUI.enabled ? -1 : this.hit(mx, my);

    ctx.save();
    // backing plank
    uiPanel(ctx, x0 - 3, y0 - 2, this.barW() + 6, C + 4, 0.72);

    for (let i = 0; i < this.SLOTS; i++) {
      const s = G.hotbar[i];
      const on = i === sel;
      const cx = this.cellX(i), cy = y0 - (on ? this.LIFT : 0);

      this._cellPath(ctx, cx, cy, C, C, 2.5);
      ctx.fillStyle = on ? 'rgba(94,66,40,0.95)' : (i === hov ? 'rgba(46,32,20,0.9)' : 'rgba(30,20,12,0.78)');
      ctx.fill();
      ctx.strokeStyle = on ? '#ffe66e' : 'rgba(226,200,150,0.32)';
      ctx.lineWidth = on ? 1.2 : 1;
      ctx.stroke();

      // key hint, top-left, dimmed so it never fights the art
      if (!TouchUI.enabled) {
        text(ctx, String((i + 1) % 10), cx + 1.6, cy + 1, {
          size: 5, color: on ? 'rgba(255,230,110,0.85)' : 'rgba(226,200,150,0.4)', shadow: false });
      }

      if (this.isEmpty(s)) continue;
      this.drawSlotArt(ctx, s, cx + C / 2, cy + C / 2 - 0.5, this.ICON);
      if (s.kind === 'item' && s.n > 1) {
        text(ctx, String(s.n), cx + C - 1.6, cy + C - 7.5, {
          size: 6.5, color: '#fff8e0', align: 'right' });
      }
    }

    // selected-slot glow, drawn last so it sits over its neighbours' borders
    const gx = this.cellX(sel), gy = y0 - this.LIFT;
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(Game.time * 3);
    this._cellPath(ctx, gx - 1, gy - 1, C + 2, C + 2, 3.5);
    ctx.strokeStyle = '#ffe66e'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // floating name, fading out over the last 0.4 s
    const s = G.hotbar[sel];
    if (this.nameT > 0 && !this.isEmpty(s)) {
      const name = this.label(s);
      const w = textWidth(ctx, name, 7) + 14;
      const nx = clamp(gx + C / 2 - w / 2, 4, W - 4 - w);
      const ny = gy - 15;
      ctx.globalAlpha = clamp(this.nameT / 0.4, 0, 1);
      uiPanel(ctx, nx, ny, w, 13, 0.95, true);
      text(ctx, name, nx + w / 2, ny + 3, { size: 7, color: '#4a3020', align: 'center', shadow: false });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },
};
