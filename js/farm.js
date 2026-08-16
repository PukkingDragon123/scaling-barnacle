// ---- seabed farming: seed packets, turned sand, and slow honest growth --------
// Otto no longer plants in the planks. A bed is a patch of SEABED out in the open
// ocean: he swims down to a marked patch, turns it over, plants a packet bought at
// the stall, and comes back every day to FAN FRESH CURRENT over it so the silt
// never settles. Growth still only happens overnight, so the loop is unchanged:
// plant -> tend -> sleep -> tend -> sleep -> harvest.
//
// Two things follow from the move and are worth knowing before you edit:
//   * A bed's y is NOT authored. It is the height of the sand at that x, read from
//     Ocean.floorAt(x) and cached per bed (invalidated on the ocean seed), because
//     a bed that does not sit ON the seabed reads as a sticker floating in blue.
//   * The dock has no beds any more, so spots() hands the deck's [E] search
//     nothing. Interaction happens while SWIMMING: this file runs its own probe
//     against Ocean.px/py, draws its own prompt in Ocean's HUD slot and honours
//     [E] itself, the way js/hood.js does for its ladders.
'use strict';

const Farm = {
  // ---- tuning ------------------------------------------------------------------
  DECK_Y: 214,        // legacy deck line; kept because the integrator syncs it
  FLOOR_Y: 244,       // fallback seabed y used when Ocean (and so floorAt) is absent
  REACH: 24,          // horizontal reach to a bed while swimming past it
  REACH_Y: 40,        // how high above a bed he may float and still work it
  REACH_UNDER: 14,    // and how far below its lip (he can be nose-down in the sand)
  DRY_DEATH: 2,       // consecutive un-tended nights a crop survives under the silt
  STAGES: 3,          // sprite stages 0,1,2 — stage 2 is ready to harvest
  BED_W: 22,          // turned-sand bed width in logical units
  FX_MAX: 140,        // hard cap on live particles (they are purely cosmetic)

  // Crop balance. profit/day climbs with the seed price AND with how long the
  // bed is locked up, so blade is the safe early trickle and moon is the
  // late-game money press you need a whole garden of beds to exploit.
  //   blade  10 ->  18 over 2d  (+8  ->  4.0/day)
  //   curl   30 ->  51 over 4d  (+21 ->  5.3/day)
  //   berry  55 ->  80 over 4d  (+25 ->  6.3/day)
  //   gourd  95 -> 150 over 6d  (+55 ->  9.2/day)
  //   moon  180 -> 360 over 8d  (+180 -> 22.5/day)
  // THE NEW ROSTER: the eight painted sea plants (DFE68B18, one row each: three
  // growth stages plus a harvested-bundle icon) and four shell spat lines. Two
  // rules hold it together:
  //
  //   * `out` is the PRODUCE BIN a harvest credits. Five of the plants alias the
  //     legacy keys (blade/curl/berry/gourd/moon) so every recipe, NPC gift list
  //     and cooking cost that names them keeps working -- the art is new, the
  //     economy underneath is not. The other three coin their own keys.
  //   * `bin: 'storage'` sends the harvest to G.storage instead -- that is where
  //     shells live, so a grown clam is exactly a dived clam to ClamNet, the
  //     workbench and every heart in the game. SHELLS ARE FARMED NOW: you buy
  //     spat from the terminal and raise it, instead of waiting on wild spawns.
  //
  // art = sprite prefix ('sea_kelp' -> sea_kelp_0/1/2); shell = drawn from the
  // shell sprite at three scales instead. pack = the packet icon in the shop.
  ORDER: ['kelp', 'grass', 'ruby', 'ember', 'fan', 'bluefan', 'jade', 'goldw',
          'spat_clam', 'spat_mussel', 'spat_oyster', 'spat_abalone'],
  CROPS: {
    kelp: {
      name: 'Kelp Blade', seedName: 'Kelp Seeds', seedPrice: 10, out: 'blade',
      art: 'sea_kelp', pack: 'pack_plant_0',
      sd: 1, qty: 2, value: 9, bonus: 0.10, mh: 22,
      desc: 'Ready in 2 days. Pocket money that keeps coming.',
    },
    grass: {
      name: 'Sea Curl', seedName: 'Seagrass Seeds', seedPrice: 30, out: 'curl',
      art: 'sea_grass', pack: 'pack_plant_1',
      sd: 2, qty: 3, value: 17, bonus: 0.12, mh: 18,
      desc: 'Ready in 4 days. Three bundles a bed, reliably.',
    },
    ruby: {
      name: 'Tide Berry', seedName: 'Ruby Weed Seeds', seedPrice: 55, out: 'berry',
      art: 'sea_ruby', pack: 'pack_plant_2',
      sd: 2, qty: 2, value: 40, bonus: 0.18, mh: 19,
      desc: 'Ready in 4 days. Often throws a bonus sprig.',
    },
    ember: {
      name: 'Reef Gourd', seedName: 'Ember Coral Cuttings', seedPrice: 95, out: 'gourd',
      art: 'sea_ember', pack: 'pack_plant_5',
      sd: 3, qty: 2, value: 75, bonus: 0.15, mh: 19,
      desc: 'Ready in 6 days. Heavy, slow, worth it.',
    },
    fan: {
      name: 'Moonbloom', seedName: 'Moonfan Bulbs', seedPrice: 180, out: 'moon',
      art: 'sea_fan', pack: 'pack_plant_3',
      sd: 4, qty: 3, value: 120, bonus: 0.20, mh: 22,
      desc: 'Ready in 8 days. The pearl of the seabed garden.',
    },
    bluefan: {
      name: 'Blue Fan', seedName: 'Blue Fan Spores', seedPrice: 90, out: 'bluefan',
      art: 'sea_bluefan', pack: 'pack_plant_4',
      sd: 3, qty: 2, value: 70, bonus: 0.14, mh: 20,
      desc: 'Ready in 6 days. Cool colour, warm margin.',
    },
    jade: {
      name: 'Jade Frond', seedName: 'Jade Frond Spores', seedPrice: 150, out: 'jade',
      art: 'sea_jade', pack: 'pack_plant_6',
      sd: 4, qty: 2, value: 110, bonus: 0.16, mh: 20,
      desc: 'Ready in 8 days. Collectors pay for the shine.',
    },
    goldw: {
      name: 'Gold Weed', seedName: 'Gold Weed Seeds', seedPrice: 260, out: 'goldw',
      art: 'sea_goldw', pack: 'pack_plant_7',
      sd: 5, qty: 3, value: 150, bonus: 0.20, mh: 22,
      desc: 'Ready in 10 days. The late-game money press.',
    },

    spat_clam: {
      name: 'Clam', seedName: 'Clam Spat', seedPrice: 14, out: 'clam', bin: 'storage',
      shell: 'shell_clam', pack: 'pack_shell_0',
      sd: 1, qty: 2, value: 8, bonus: 0.15, mh: 12,
      desc: 'Grows a clam in 2 days. Farmed beats foraged.',
    },
    spat_mussel: {
      name: 'Mussel', seedName: 'Mussel Spat', seedPrice: 30, out: 'mussel', bin: 'storage',
      shell: 'shell_mussel', pack: 'pack_shell_2',
      sd: 2, qty: 2, value: 14, bonus: 0.15, mh: 12,
      desc: 'Grows mussels in 4 days, rope-cultured.',
    },
    spat_oyster: {
      name: 'Oyster', seedName: 'Oyster Spat', seedPrice: 70, out: 'oyster', bin: 'storage',
      shell: 'shell_scallop', pack: 'pack_shell_3',
      sd: 3, qty: 2, value: 34, bonus: 0.12, mh: 13,
      desc: 'Grows oysters in 6 days. Crack for pearls.',
    },
    spat_abalone: {
      name: 'Abalone', seedName: 'Abalone Spat', seedPrice: 160, out: 'abalone', bin: 'storage',
      shell: 'shell_abalone', pack: 'pack_shell_7',
      sd: 4, qty: 1, value: 90, bonus: 0.20, mh: 14,
      desc: 'One abalone in 8 days, worth the wait.',
    },
  },

  // Built from CROPS at load so the shop and any inventory UI never restate
  // prices or art names. SEEDS: [{key,name,price,art,desc}]  PRODUCE: key -> {name,value,art}
  SEEDS: [],
  PRODUCE: {},

  // ---- the garden ---------------------------------------------------------------
  // OCEAN world x, not deck x. Ocean px 0 is under the pilings and the shelf falls
  // away as you swim out, so the garden runs seaward from the dock: the first beds
  // are a short swim from the drop-in point and the later ones are further out and
  // deeper. 52 units apart, which is more than twice REACH, so exactly one bed can
  // ever claim a point in the water.
  //
  // `b` is still "pilings that must exist first" — it is the progression gate, and
  // it now reads as how far from home Otto trusts himself to plant. y is NOT here:
  // it is the sand's own height at that x, see bedY().
  PLOT_DEF: [
    { x: 120, b: 1 }, { x: 172, b: 1 }, { x: 224, b: 1 },
    { x: 288, b: 2 }, { x: 340, b: 2 },
    { x: 404, b: 3 }, { x: 456, b: 3 },
  ],

  // ---- runtime state (never persisted) -------------------------------------------
  fx: [],             // current wisps / silt / harvest sparks, in ocean world space
  time: 0,
  open: false,        // seed-pouch picker modal
  plot: -1,           // plot the picker will plant into
  sel: 0,
  reach: null,        // the bed [E] would work right now, or null
  _stamp: -1,         // dedupes update() if the integrator also calls it
  _dstamp: -1,        // ...and dedupes the world draw for the same reason
  _hooked: false,
  _grit: null,        // per-bed sand speck offsets, built once
  _bedY: null,        // per-bed seabed height cache
  _bedSeed: null,     // the ocean seed those heights were sampled from

  // ---- picker window geometry ------------------------------------------------------
  // Sized for the full roster: twelve packets in TWO COLUMNS of six. One column
  // of 24-unit rows only ever fit five -- the old roster's count -- and rows six
  // through twelve would draw clean off the panel.
  WX: 16, WY: 12, WW: 448, WH: 228,
  _openT: 0,
  ROW_H: 25, COL_ROWS: 6,

  // ---- state plumbing ---------------------------------------------------------------

  // Every public entry point starts here: G does not exist at file-scope time and
  // G.farm is a top-level object, which Game.load does NOT deep-merge — so the
  // whole shape has to be re-normalised defensively rather than trusted.
  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    this._hook();
    let f = G.farm;
    if (!f || typeof f !== 'object') { f = {}; G.farm = f; }
    if (!Array.isArray(f.plots)) f.plots = [];
    for (let i = 0; i < this.PLOT_DEF.length; i++) {
      let p = f.plots[i];
      if (!p || typeof p !== 'object') { p = this._blank(); f.plots[i] = p; }
      p.i = i;
      p.x = this.PLOT_DEF[i].x;         // bed layout is code-owned; a save never moves one
      p.y = this.bedY(p);               // ...and the sand owns the height, always
      p.tilled = !!p.tilled;
      if (!this._def(p.crop)) p.crop = null;
      p.stage = clamp(Math.round(p.stage) || 0, 0, this.STAGES - 1);
      p.days = Math.max(0, Math.round(p.days) || 0);
      p.dry = Math.max(0, Math.round(p.dry) || 0);
      p.watered = !!p.watered;          // 'tended today' — the field name is persisted
      p.dead = !!p.dead;
      if (!p.crop) { p.dead = false; p.watered = false; p.days = 0; p.dry = 0; p.stage = 0; }
    }
    f.plots.length = this.PLOT_DEF.length;
    // PLACED PLANTERS. Beds do not exist until a Sea Planter is set down on the
    // sand -- planting starts with placing now, not with finding furniture that
    // was always there. Old saves that were already farming keep every bed.
    let placed = Math.max(0, Math.round(f.placed) || 0);
    if (placed === 0 && f.plots.some((p) => p.tilled || p.crop)) placed = this.PLOT_DEF.length;
    f.placed = Math.min(this.PLOT_DEF.length, placed);
    if (!f.seeds || typeof f.seeds !== 'object') f.seeds = {};
    if (!f.crops || typeof f.crops !== 'object') f.crops = {};
    for (const k of this.ORDER) {
      f.seeds[k] = Math.max(0, Math.round(f.seeds[k]) || 0);
      // produce is BINNED BY `out`, not by crop key -- that is what lets a new
      // plant refill a legacy bin (kelp -> blade) and keeps the ledger keys
      // stable if a crop is ever renamed. Shell lines bank in G.storage instead.
      const c = this.CROPS[k];
      if (c.bin !== 'storage') f.crops[c.out] = Math.max(0, Math.round(f.crops[c.out]) || 0);
    }
    f.planted = Math.max(0, Math.round(f.planted) || 0);
    f.reaped = Math.max(0, Math.round(f.reaped) || 0);
    // lastDay = the calendar day the beds have already been advanced to
    if (typeof f.lastDay !== 'number' || !isFinite(f.lastDay)) f.lastDay = G.day;
    if (f.lastDay > G.day) f.lastDay = G.day;   // save rollback / new game
    return true;
  },

  _blank() {
    return {
      x: 0, y: 0, tilled: false, crop: null, stage: 0,
      watered: false, days: 0, dry: 0, dead: false,
    };
  },

  // own-property lookup only: a corrupt save could hold 'constructor' and walk the prototype
  _def(key) {
    return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(this.CROPS, key))
      ? this.CROPS[key] : null;
  },

  // ---- where the sand is -------------------------------------------------------------

  // Ocean owns the seabed profile; floorAt(x) is its one answer to "where is the
  // ground here". Sampling it per bed per frame would be wasteful (and it does not
  // exist at all if ocean.js failed to load), so the answer is cached and thrown
  // away only when the ocean seed changes — a new game or a save loaded into a live
  // session, which are exactly the two moments the seabed is a different seabed.
  _floorAt(x) {
    if (typeof Ocean !== 'undefined' && Ocean && typeof Ocean.floorAt === 'function') {
      // floorAt answers FLOOR_DEEP until Ocean.ensure() has built its column
      // caches — and on a loaded save the seed is already its real value, so
      // bedY would cache that 3000-deep fallback and never invalidate it.
      // ensure() is Ocean's own top-of-every-entry-point idiom; run it first.
      if (Ocean.ensure && !Ocean.ensure()) return this.FLOOR_Y;
      const y = Ocean.floorAt(x);
      if (typeof y === 'number' && isFinite(y)) return y;
    }
    return this.FLOOR_Y;
  },

  bedY(p) {
    if (!p) return this.FLOOR_Y;
    const i = p.i | 0;
    const seed = (typeof G !== 'undefined' && G && G.ocean) ? (G.ocean.seed | 0) : 0;
    if (this._bedSeed !== seed || !this._bedY || this._bedY.length !== this.PLOT_DEF.length) {
      this._bedSeed = seed;
      this._bedY = new Array(this.PLOT_DEF.length);
    }
    const hit = this._bedY[i];
    if (typeof hit === 'number') return hit;
    const def = this.PLOT_DEF[i];
    const y = this._floorAt(def ? def.x : (p.x || 0));
    this._bedY[i] = y;
    return y;
  },

  // Game/TouchUI live in main.js, which loads AFTER this file, so the modal hooks
  // cannot be installed at file scope (temporal dead zone). They go in on the
  // first ensure(), i.e. the first world frame — which also puts every wrap
  // OUTSIDE ocean.js's own DOMContentLoaded installer, the only place from which
  // a pad can be added to the swim layout at all (Ocean returns its seven pads
  // without chaining, so an inner wrap would be buried).
  _hook() {
    if (this._hooked) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._hooked = true;
    const self = this;

    // Game.globalUpdate runs every frame while a scene is live (even under Shop
    // or Bench), which makes it the one safe update slot for a bolt-on module.
    const gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      self.update(dt);
      if (self.open && Game.fadeDir === 0 && !Game.helpOpen && !Shop.open && !Bench.open) self.updatePicker(dt);
    };
    // Game.drawHUD is called only when no other modal is up and after the colour
    // grade — exactly Shop's z-order. Returning early hides the HUD like Shop does.
    const gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.drawPicker(c); return; }
      gHUD(c);
    };
    // scene changes must dismiss the picker (Shop/Bench get this from updateFade)
    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };
    // hide the walk/paw buttons under the picker so touches reach its rows, and
    // give the swim layout a [E] pad whenever a bed is actually in reach
    const layout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (self.open) return [];
      const b = layout();
      if (typeof Ocean !== 'undefined' && Game.scene === Ocean && self.reach && b.length) {
        // clear of Ocean's own pads and of Hood's climb pad at (6, H-100)
        b.push({ x: 6, y: H - 148, w: 40, h: 40, tap: 'KeyE', icon: 'ftend' });
      }
      return b;
    };
    // TouchUI.draw only knows six icon names and paints an empty circle for
    // anything else, so ours gets its glyph here. Always call the captured one.
    const tDraw = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tDraw(c);
      if (!this.enabled) return;
      for (let i = 0; i < this.buttons.length; i++) {
        const btn = this.buttons[i];
        if (btn.icon !== 'ftend') continue;
        const cx = btn.x + btn.w / 2, cy = btn.y + btn.h / 2;
        c.strokeStyle = 'rgba(160,242,180,0.9)';
        c.lineWidth = 1.4;
        c.beginPath();                                  // a sprout: stem plus two fronds
        c.moveTo(cx, cy + 8); c.lineTo(cx, cy - 4);
        c.moveTo(cx, cy - 1); c.bezierCurveTo(cx - 7, cy - 3, cx - 7, cy - 9, cx - 1, cy - 8);
        c.moveTo(cx, cy - 3); c.bezierCurveTo(cx + 7, cy - 5, cx + 7, cy - 11, cx + 1, cy - 10);
        c.stroke();
      }
    };
    // main.js does not know about us, so the host scene would keep going
    // underneath: Otto would swim off the bed while the pouch was open.
    if (typeof WorldScene !== 'undefined' && WorldScene.update) {
      const wUpdate = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (self.open) return; wUpdate(dt); };
    }
    if (typeof Ocean !== 'undefined' && Ocean && Ocean.update) {
      const oUpdate = Ocean.update.bind(Ocean);
      Ocean.update = function (dt) { if (self.open) return; oUpdate(dt); };
    }
    // The beds are world-space content in the water: they belong in the BACK prop
    // pass, behind Otto but in front of the scenery. drawOceanInWorld carries a
    // per-frame stamp, so an integrator that also calls it cannot double-draw.
    if (typeof Ocean !== 'undefined' && Ocean && Ocean._drawProps) {
      const oProps = Ocean._drawProps.bind(Ocean);
      Ocean._drawProps = function (ctx, t, front) {
        oProps(ctx, t, front);
        if (front) return;
        self.drawOcean(ctx, this.camX, this.camY);
      };
    }
    // ...and the [E] prompt goes in Ocean's own HUD so it takes the colour grade
    // with everything else in the scene.
    if (typeof Ocean !== 'undefined' && Ocean && Ocean._drawHUD) {
      const oHUD = Ocean._drawHUD.bind(Ocean);
      Ocean._drawHUD = function (ctx) {
        oHUD(ctx);
        self.drawOceanPrompt(ctx);
      };
    }
  },

  // Every panel in the game publishes an `open` flag and checks everyone else's by
  // hand; this is that list, minus ourselves.
  _peerOpen() {
    if (typeof Shop !== 'undefined' && Shop.open) return true;
    if (typeof Bench !== 'undefined' && Bench.open) return true;
    if (typeof Game !== 'undefined' && Game.helpOpen) return true;
    if (typeof Craft !== 'undefined' && Craft.open) return true;
    if (typeof NPCs !== 'undefined' && NPCs.open) return true;
    if (typeof Stock !== 'undefined' && Stock.open) return true;
    if (typeof Inv !== 'undefined' && Inv.open) return true;
    if (typeof Skills !== 'undefined' && Skills.open) return true;
    if (typeof Tame !== 'undefined' && Tame.open) return true;
    if (typeof Forge !== 'undefined' && Forge.open) return true;
    if (typeof Battle !== 'undefined' && Battle.active) return true;
    if (typeof Hood !== 'undefined' && Hood.dialogueUp && Hood.dialogueUp()) return true;
    return false;
  },

  // ---- queries ------------------------------------------------------------------------

  plots() { return this.ensure() ? G.farm.plots : []; },

  // a bed only exists once the pier has been built out far enough to trust it
  available(p) {
    if (!p) return false;
    const def = this.PLOT_DEF[p.i];
    if (!def || (G.bridge || 1) < def.b) return false;
    return p.i < (G.farm.placed || 0);          // a bed exists once its planter is down
  },

  ready(p) { return !!(p && p.crop && !p.dead && p.stage >= this.STAGES - 1); },

  totalDays(key) { const c = this._def(key); return c ? c.sd * (this.STAGES - 1) : 0; },

  daysLeft(p) {
    if (!p || !p.crop || p.dead) return 0;
    return Math.max(0, this.totalDays(p.crop) - p.days);
  },

  stageFor(key, days) {
    const c = this._def(key);
    if (!c) return 0;
    return clamp(Math.floor(days / c.sd), 0, this.STAGES - 1);
  },

  seedCount(key) { return this.ensure() ? (G.farm.seeds[key] || 0) : 0; },
  // `key` may be a crop key or an out-bin key; both resolve to the same bin
  produceCount(key) {
    if (!this.ensure()) return 0;
    const c = this.CROPS[key];
    if (c && c.bin === 'storage') return G.storage[c.out] || 0;
    return G.farm.crops[c ? c.out : key] || 0;
  },
  seedTotal() { let n = 0; for (const k of this.ORDER) n += this.seedCount(k); return n; },
  produceTotal() { let n = 0; for (const k of this.ORDER) n += this.produceCount(k); return n; },
  produceValue() {
    let v = 0;
    for (const k of this.ORDER) {
      const c = this.CROPS[k];
      if (c.bin === 'storage') continue;         // shells sell through ClamNet
      v += this.produceCount(k) * c.value;
    }
    return v;
  },

  readyCount() { let n = 0; for (const p of this.plots()) if (this.available(p) && this.ready(p)) n++; return n; },
  // beds whose crop has not had a current fanned over it today (the old name is
  // kept: several callers and the HUD copy already read it)
  thirstyCount() {
    let n = 0;
    for (const p of this.plots()) if (this.available(p) && p.crop && !p.dead && !p.watered) n++;
    return n;
  },
  siltedCount() { return this.thirstyCount(); },

  // nearest bed to a world x, ignoring depth — kept for anything that only has an x
  at(x) {
    if (!this.ensure()) return null;
    let best = null, bd = this.REACH;
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      const d = Math.abs(p.x - x);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  // the swimmer's version: a bed is in reach if he is beside it AND near the sand
  // it sits on, so hanging in open water forty units up is not "standing on it".
  atPoint(x, y) {
    if (!this.ensure()) return null;
    let best = null, bd = this.REACH;
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      const dx = Math.abs(p.x - x);
      if (dx >= bd) continue;
      const dy = this.bedY(p) - y;              // positive => he is above the bed
      if (dy > this.REACH_Y || dy < -this.REACH_UNDER) continue;
      bd = dx; best = p;
    }
    return best;
  },

  // ---- actions ---------------------------------------------------------------------------

  _get(i) {
    if (!this.ensure()) return null;
    const p = G.farm.plots[i | 0];
    return (p && this.available(p)) ? p : null;
  },

  till(i) {
    const p = this._get(i);
    if (!p || p.tilled) return false;
    p.tilled = true;
    this.burst(p.x, this.bedY(p) - 1, 1, 12);
    SND.scrape();
    Game.toast('Seabed turned. It could take a seed packet now.');
    Game.save();
    return true;
  },

  // one button for "get rid of what's here": pull the crop, or smooth a bare bed back
  clear(i) {
    const p = this._get(i);
    if (!p) return false;
    const by = this.bedY(p);
    if (p.crop) {
      const wasDead = p.dead;
      p.crop = null; p.dead = false; p.stage = 0; p.days = 0; p.dry = 0; p.watered = false;
      this.burst(p.x, by - 2, 1, 14);
      SND.clink();
      Game.toast(wasDead ? 'Cleared the smothered crop.' : 'Pulled up the crop.');
    } else if (p.tilled) {
      p.tilled = false;
      SND.clink();
      Game.toast('Sand raked flat again.');
    } else {
      return false;
    }
    Game.save();
    return true;
  },

  plant(i, key) {
    const p = this._get(i);
    const c = this._def(key);
    if (!p || !c) return false;
    if (!p.tilled) { SND.alarm(); Game.toast('Turn the seabed first.'); return false; }
    if (p.crop) { SND.alarm(); Game.toast('Something is already growing there.'); return false; }
    if (this.seedCount(key) <= 0) {
      SND.alarm();
      Game.toast(`No ${c.name} seeds — buy packets at Sprout's stall.`);
      return false;
    }
    G.farm.seeds[key]--;
    G.farm.planted++;
    p.crop = key; p.stage = 0; p.days = 0; p.dry = 0; p.dead = false; p.watered = false;
    p.popT = 0.45;                               // the swell-into-place animation
    this.burst(p.x, this.bedY(p) - 2, 1, 8);
    this.burst(p.x, this.bedY(p) - 6, 3, 26);    // and a proper puff of sand
    SND.pop(1.15);
    Game.toast(`Planted ${c.name} — fan a fresh current over it daily.`);
    Game.save();
    return true;
  },

  // The daily care action. Underwater there is nothing to water: what a bed needs
  // is the silt swept off it and clean water moving through, so Otto fans a
  // current over it. The cadence is deliberately identical to the old watering —
  // once per day, two missed days kills it — so the growth maths is untouched.
  tend(i) {
    const p = this._get(i);
    if (!p || !p.crop || p.dead) return false;
    if (p.watered) { SND.blip(); Game.toast('Already tended today.'); return false; }
    p.watered = true;
    p.dry = 0;
    this.burst(p.x, this.bedY(p) - 4, 0, 20);
    SND.bubble();
    Game.save();
    return true;
  },

  // the old name, kept so nothing that learned it breaks
  water(i) { return this.tend(i); },

  // -> { key, count, name } or null
  harvest(i) {
    const p = this._get(i);
    if (!this.ready(p)) return null;
    const key = p.crop, c = this.CROPS[key];
    const count = c.qty + (Math.random() < c.bonus ? 1 : 0);
    // Produce goes into the ledger its consumers read: G.farm.crops[out] for the
    // plants (Shop, Craft and NPCs all read it), G.storage for the shell lines --
    // a farmed clam IS a dived clam to everything downstream.
    if (c.bin === 'storage') G.storage[c.out] = (G.storage[c.out] || 0) + count;
    else G.farm.crops[c.out] = (G.farm.crops[c.out] || 0) + count;
    G.farm.reaped += count;
    p.crop = null; p.stage = 0; p.days = 0; p.dry = 0; p.watered = false; p.dead = false;
    this.burst(p.x, this.bedY(p) - 8, 2, 16);
    SND.pop(1.35);
    if (c.value >= 75) SND.chime();
    Game.toast(`Harvested ${count} x ${c.name}  (+$${count * c.value})`);
    Game.save();
    return { key, count, name: c.name };
  },

  // context action for a bed — what the [E] prompt does, in priority order
  act(i) {
    const p = this._get(i);
    if (!p) return;
    // NO TILLING BARE SEABED. A plot only exists where a Sea Planter has been
    // put down, and a planter arrives already full of soil -- so if a placed
    // plot somehow reads untilled, that is bookkeeping from an older save, not
    // a job for the player. Fix it silently and fall through to sowing.
    if (!p.tilled) { p.tilled = true; }
    if (p.dead) { this.clear(i); return; }
    if (!p.crop) { this.openPicker(i); return; }
    if (this.ready(p)) { this.harvest(i); return; }
    if (!p.watered) { this.tend(i); return; }
    const c = this.CROPS[p.crop];
    Game.toast(`${c.name}: ${this.daysLeft(p)} day(s) to go. Tended.`);
    SND.blip();
  },

  label(p) {
    if (!p) return '';
    if (!p.tilled) return 'Sow the Planter';
    if (p.dead) return 'Clear Smothered Crop';
    if (!p.crop) return this.seedTotal() > 0 ? 'Plant Seeds' : 'Plant Seeds  (none — see the stall)';
    const c = this.CROPS[p.crop];
    if (this.ready(p)) return `Harvest ${c.name}`;
    if (!p.watered) return p.dry > 0 ? `Fan Current on ${c.name}  (silting up!)` : `Fan Current on ${c.name}`;
    return `${c.name} — ${this.daysLeft(p)}d to go`;
  },

  // ---- who is asking -------------------------------------------------------------------

  // The beds are underwater, so the DECK's [E] list gets nothing from us any more.
  // Pass a scene to be explicit; with no argument the current scene decides, which
  // keeps every existing `s.concat(Farm.spots())` caller correct for free.
  spots(scene) {
    const sc = scene || ((typeof Game !== 'undefined' && Game) ? Game.scene : null);
    if (typeof Ocean !== 'undefined' && Ocean && sc === Ocean) return this.oceanSpots();
    return [];
  },

  // Ocean has no nearest-spot search of its own (this file runs its own probe, see
  // _oceanUpdate), but the list is published in the same shape anyway so a wiring
  // layer can drive the beds from somewhere else if it ever wants to. Note the
  // extra `y`: a spot in the water needs a depth as well as an x.
  oceanSpots() {
    if (!this.ensure()) return [];
    const out = [];
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      const i = p.i;
      out.push({ x: p.x, y: this.bedY(p), label: this.label(p), act: () => this.act(i) });
    }
    return out;
  },

  // ---- shop / inventory bridge --------------------------------------------------------

  // What a seed packet costs, as a multiplier. Finishing Sprout's garden branch
  // (SIDE_QUESTS 'g_basket') earns the seedDeal perk and she sells you packets at
  // what she pays for them -- a standing 25% off, for good. Anything that quotes
  // a seed price must go through here or the stall will lie about the total.
  seedRate() {
    return (typeof Side !== 'undefined' && Side && Side.perk('seedDeal')) ? 0.75 : 1;
  },
  seedPrice(key, n) {
    const c = this._def(key);
    if (!c) return 0;
    return Math.max(1, Math.round(c.seedPrice * Math.max(1, Math.round(n) || 1) * this.seedRate()));
  },

  buySeed(key, n) {
    if (!this.ensure()) return false;
    const c = this._def(key);
    if (!c) return false;
    n = Math.max(1, Math.round(n) || 1);
    const price = Math.max(1, Math.round(c.seedPrice * n * this.seedRate()));
    if (G.money < price) { SND.alarm(); Game.toast('Not enough sand dollars.'); return false; }
    // reuse the canonical purchase helper so cash/toast/save behave identically
    Shop.buy(price, () => { G.farm.seeds[key] += n; }, `${c.seedName} x${n}`);
    return true;
  },

  // ship produce with the same drone crate the shell trade uses
  sellProduce(keys) {
    if (!this.ensure()) return 0;
    let v = 0, c = 0;
    for (const k of keys) {
      if (!this.PRODUCE[k]) continue;            // shell bins are ClamNet's to sell
      const n = G.farm.crops[k] || 0;
      if (n <= 0) continue;
      v += n * this.PRODUCE[k].value;
      c += n;
      G.farm.crops[k] = 0;
    }
    if (c === 0) return 0;
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    SND.click();
    Game.toast(`Produce shipped: $${v} — drone en route!`);
    Game.save();
    return v;
  },

  // ---- the night pass -----------------------------------------------------------------

  // Advance the beds to today. Idempotent per calendar day, so it is safe to call
  // from sleep() whether the day counter has been bumped yet or not — whichever
  // call sees the new G.day does the work and the other becomes a no-op.
  newDay() {
    if (!this.ensure()) return;
    const f = G.farm;
    if (f.lastDay >= G.day) return;
    let guard = 0;
    while (f.lastDay < G.day && guard++ < 30) { this._night(); f.lastDay++; }
    f.lastDay = G.day;   // absurd gaps (edited saves) collapse instead of hanging
    Game.save();
  },

  _night() {
    let ripe = 0, silted = 0, died = 0;
    for (const p of G.farm.plots) {
      if (!p.crop || p.dead) continue;
      if (p.watered) {
        p.days++;
        p.dry = 0;
        p.stage = this.stageFor(p.crop, p.days);
        if (this.ready(p)) ripe++;
      } else {
        p.dry++;
        if (p.dry >= this.DRY_DEATH) { p.dead = true; died++; }
        else silted++;
      }
      p.watered = false;   // the silt settles again every single night
    }
    const bits = [];
    if (ripe) bits.push(`${ripe} ready`);
    if (silted) bits.push(`${silted} silting`);
    if (died) bits.push(`${died} smothered`);
    if (bits.length) Game.toast(`Seabed garden: ${bits.join('  ')}`);
  },

  // ---- particles -------------------------------------------------------------------------

  // kind: 0 current wisp (rises), 1 silt (settles back onto the sand), 2 harvest spark
  // y is the bed's own soil line, so the silt has something to land on.
  burst(x, y, kind, n) {
    const gy = (typeof y === 'number' && isFinite(y)) ? y + 1.5 : this.FLOOR_Y;
    for (let i = 0; i < n; i++) {
      if (this.fx.length >= this.FX_MAX) break;
      const sp = kind === 0 ? rand(12, 34) : rand(8, 24);
      const a = rand(-2.5, -0.65);   // upward fan
      this.fx.push({
        x: x + rand(-8, 8), y: y + rand(-3, 1),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        gy, k: kind, t: rand(0.55, 1.25), s: kind === 2 ? rand(0.6, 1.1) : rand(0.4, 0.85),
      });
    }
  },

  update(dt) {
    this._openT = Math.min(1, this._openT + (dt || 0) * 4.5);
    if (!this.ensure()) return;
    // self-driven from the Game.globalUpdate hook; ignore a duplicate call in the same frame
    if (Game.time === this._stamp) return;
    this._stamp = Game.time;

    this.time += dt;
    // decay the plant-pop timers; transient, so a reload simply skips the wiggle
    for (const pl of G.farm.plots) if (pl.popT > 0) pl.popT -= dt;
    if (G.farm.lastDay < G.day) this.newDay();   // day can roll over mid-dive or under a modal

    if (this.fx.length) {
      // water, not air: everything is dragged almost to a stop, silt sinks slowly
      // and a fanned current wisp drifts UP. One pow() for the frame, never per particle.
      const drag = Math.pow(0.34, dt);
      for (const p of this.fx) {
        p.t -= dt;
        p.vy += (p.k === 0 ? -46 : p.k === 1 ? 26 : -8) * dt;
        p.vx *= drag; p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // silt settles onto the bed instead of bouncing off planks
        if (p.k === 1 && p.y > p.gy && p.vy > 0) { p.y = p.gy; p.vy = 0; p.vx *= 0.4; }
      }
      this.fx = this.fx.filter(p => p.t > 0);
    }

    if (!this.open) this._oceanUpdate();
  },

  // Per-frame probe while the ocean has the screen: work out which bed [E] would
  // work, then honour the key. Ocean has no spot search, and the dock's one is no
  // use to us any more, so this is the whole interaction path.
  _oceanUpdate() {
    this.reach = null;
    if (typeof Ocean === 'undefined' || typeof Game === 'undefined') return;
    if (Game.scene !== Ocean) return;
    if (Ocean.over || Ocean.leaving) return;

    const p = this.atPoint(Ocean.px, Ocean.py);
    // no bed here -- but maybe a planter could go here
    this.reachPlace = null;
    if (!p) {
      const slot = this.placeSlot(Ocean.px, Ocean.py);
      if (slot !== -1) {
        this.reachPlace = slot;
        if (Game.fadeDir === 0 && !this._peerOpen() &&
            !(typeof Hood !== 'undefined' && Hood && Hood._reach) &&
            Input.p('KeyE')) this.place(slot);
      }
      return;
    }
    this.reach = p;

    if (Game.fadeDir !== 0 || this._peerOpen()) return;
    // Hood claims [E] for its ladders and its neighbours; its probe runs before
    // ours (its globalUpdate wrap is inner), so defer rather than double-fire.
    if (typeof Hood !== 'undefined' && Hood && Hood._reach) return;
    if (Input.p('KeyE')) this.act(p.i);
  },

  // The next unplaced slot within reach, IF he is carrying a planter. Slots fill
  // left to right, so the garden grows outward from the pier the way a real one
  // would -- no leapfrogging a gap to plant at the far end.
  placeSlot(x, y) {
    if (!this.ensure()) return -1;
    if (((G.storage && G.storage.planter) || 0) <= 0) return -1;
    const i = G.farm.placed || 0;
    const def = this.PLOT_DEF[i];
    if (!def || (G.bridge || 1) < def.b) return -1;
    if (Math.abs(def.x - x) >= this.REACH) return -1;
    const fake = { i, x: def.x };
    const dy = this.bedY(fake) - y;
    if (dy > this.REACH_Y || dy < -this.REACH_UNDER) return -1;
    return i;
  },

  place(i) {
    if (!this.ensure()) return false;
    if (i !== (G.farm.placed || 0)) return false;
    if (((G.storage && G.storage.planter) || 0) <= 0) return false;
    G.storage.planter--;
    G.farm.placed = i + 1;
    const p = G.farm.plots[i];
    if (p) { p.tilled = true; p.popT = 0.45; this._burst && this._burst(p); }
    if (typeof SND !== 'undefined') SND.chime();
    if (typeof Game !== 'undefined' && Game.toast) Game.toast('The planter settles into the sand.');
    Game.save();
    return true;
  },

  // ---- drawing ----------------------------------------------------------------------------

  // Applies its own camera translate. If you are already inside the ocean's
  // `translate(-camX, -camY)` block, call drawInWorld() instead.
  draw(ctx, camX, camY) {
    const cx = camX || 0, cy = camY || 0;
    ctx.save();
    // snap the camera to the device-texel grid, the way the ocean's own layers do
    ctx.translate(-Math.round(cx * DPX) / DPX, -Math.round(cy * DPX) / DPX);
    this.drawInWorld(ctx, cx, cy);
    ctx.restore();
  },
  // clearer names for the same two entry points, now that the garden is at sea
  drawOcean(ctx, camX, camY) { this.draw(ctx, camX, camY); },
  drawOceanInWorld(ctx, camX, camY) { this.drawInWorld(ctx, camX, camY); },

  drawInWorld(ctx, camX, camY) {
    if (!this.ensure()) return;
    // this file hooks Ocean's prop pass itself; if a wiring layer ALSO calls us,
    // the second call in the same frame is a no-op rather than a double-draw
    if (typeof Game !== 'undefined' && Game.time === this._dstamp) return;
    this._dstamp = (typeof Game !== 'undefined') ? Game.time : -1;

    const cx = camX || 0, cy = camY || 0;
    if (!this._grit || this._grit.length !== this.PLOT_DEF.length) this._buildGrit();
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      if (p.x < cx - 40 || p.x > cx + W + 40) continue;      // cull: the garden is a few screens long
      const by = this.bedY(p);
      if (by < cy - 60 || by > cy + H + 40) continue;         // ...and the shelf falls away below
      this._drawPlot(ctx, p, by);
    }
    if (this.reach) this._drawReachMark(ctx);
    this._drawFx(ctx, cx, cy);
  },

  // deterministic sand specks, built once — never allocate per frame
  _buildGrit() {
    const rng = mulberry32(4242);
    this._grit = [];
    for (let i = 0; i < this.PLOT_DEF.length; i++) {
      const g = [];
      for (let j = 0; j < 9; j++) {
        g.push({ dx: (rng() - 0.5) * (this.BED_W - 4), dy: rng() * 3.2, lit: rng() < 0.42 });
      }
      this._grit.push(g);
    }
  },

  _drawPlot(ctx, p, by) {
    const x = p.x;
    const hw = this.BED_W / 2;

    if (!p.tilled) {
      // an unclaimed patch: two boundary stones and a line scratched in the sand
      ctx.strokeStyle = 'rgba(208,232,226,0.20)';
      ctx.lineWidth = PIX;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x - hw, by - 2.5, this.BED_W, 3);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(118,132,124,0.85)';
      ctx.fillRect(x - hw - 1, by - 3, 2, 3.5);
      ctx.fillRect(x + hw - 1, by - 3, 2, 3.5);
      return;
    }

    // ---- the bed is ART now: the painted garden box, seated on the sand line.
    // The plain box is the working bed; the ornate gold-and-pearl one is the
    // READY state, so a garden you can harvest announces itself from across the
    // screen without a single icon. (bed_1 / bedr_1 -- the second width of five;
    // BED_W hasn't moved, so reach and spacing are untouched.)
    const ripeNow = p.crop && !p.dead && this.ready(p);
    const bedArt = ripeNow ? 'bedr_1' : 'bed_1';
    const bw = this.BED_W + 12;
    const bh = assetH(bedArt, bw);
    ctx.fillStyle = 'rgba(4,12,16,0.42)';
    ctx.fillRect(x - hw - 1.5, by - 0.5, this.BED_W + 3, 2.5);        // contact shadow
    drawA(ctx, bedArt, x - bw / 2, by - bh + 3, bw, bh);

    if (p.crop && !p.dead) {
      if (p.watered) this._drawCurrent(ctx, x, by);
      else this._drawSilt(ctx, x, by, p);
    }
    if (p.crop) this._drawCrop(ctx, p, x, by - 4.5);
  },

  // tended: clean water moving over the bed, read as three pale streaks drifting
  _drawCurrent(ctx, x, by) {
    ctx.fillStyle = '#bfe8f5';
    for (let i = 0; i < 3; i++) {
      const ph = this.time * 0.9 + i * 2.1 + x * 0.05;
      const dx = ((ph % 1) - 0.5) * this.BED_W;
      ctx.globalAlpha = 0.10 + 0.22 * Math.sin(this.time * 2.2 + i * 2.1);
      ctx.fillRect(x + dx, by - 6.5 - i * 1.6, 4.5, PIX * 2);
    }
    ctx.globalAlpha = 1;
  },

  // untended: a grey film of settled silt, thicker the longer it has been left
  _drawSilt(ctx, x, by, p) {
    const hw = this.BED_W / 2;
    const k = clamp(0.16 + p.dry * 0.14, 0, 0.46);
    ctx.fillStyle = 'rgba(168,180,168,' + (Math.round(k * 100) / 100) + ')';
    ctx.fillRect(x - hw, by - 5.5, this.BED_W, 5.5);
  },

  _drawCrop(ctx, p, x, soilY) {
    const c = this.CROPS[p.crop];
    // Plants come off the painted crop sheet (sea_<key>_<stage>); shell lines
    // draw the shell itself at three sizes -- a clam growing IS a clam getting
    // bigger, and no separate sheet says it better.
    const name = c.shell || `${c.art}_${p.stage}`;
    const ripe = this.ready(p);
    let grow = c.mh * (c.shell ? [0.45, 0.72, 1][p.stage] : [0.36, 0.66, 1][p.stage]);
    // the pop: a freshly planted or just-advanced crop swells into place
    if (p.popT > 0) {
      const k = 1 - p.popT / 0.45;
      grow *= 0.3 + 0.7 * (1 - (1 - k) * (1 - k)) + Math.sin(k * Math.PI) * 0.12;
    }
    const w = this._widthFor(name, grow);
    const h = assetH(name, w);
    // Everything down here sways from where it is rooted — a crop that bobbed up
    // and down would be floating, which is the one thing the sea must never look
    // like. Ready crops sway wider and slower so the eye is drawn to the payout.
    const sway = ripe
      ? Math.sin(this.time * 1.5 + p.i * 1.1) * 0.13
      : Math.sin(this.time * 1.15 + p.i) * 0.07;

    if (p.dead) {
      // smothered: squashed flat and drained of colour, unmistakable at a glance
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.translate(Math.round(x * DPX) / DPX, soilY);
      ctx.scale(1.06, 0.55);
      drawA(ctx, name, -w / 2, -h, w, h);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#7a8a84';
      ctx.lineWidth = PIX * 2;
      const cy = soilY - h * 0.33;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, cy - 2.5); ctx.lineTo(x + 2.5, cy + 2.5);
      ctx.moveTo(x + 2.5, cy - 2.5); ctx.lineTo(x - 2.5, cy + 2.5);
      ctx.stroke();
      return;
    }

    ctx.save();
    ctx.translate(Math.round(x * DPX) / DPX, soilY);
    ctx.rotate(sway);
    drawA(ctx, name, -w / 2, -h, w, h);          // base of the sprite ON the soil line
    ctx.restore();

    if (!ripe) {
      // a progress tick on the sand beside the bed: how many nights are banked
      const total = this.totalDays(p.crop);
      const done = clamp(p.days / Math.max(1, total), 0, 1);
      ctx.fillStyle = 'rgba(6,14,18,0.5)';
      ctx.fillRect(x - 7, soilY + 5.5, 14, 1.25);
      ctx.fillStyle = p.dry > 0 ? '#e8434c' : '#a0f2b4';
      ctx.fillRect(x - 7, soilY + 5.5, 14 * done, 1.25);
      return;
    }

    this._drawReady(ctx, p, x, soilY - h + Math.sin(sway) * h * 0.5);
  },

  // the "come collect me" flag: halo, floating produce icon, twinkles
  _drawReady(ctx, p, x, topY) {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + p.i);
    ctx.fillStyle = 'rgba(255,230,110,0.09)';
    ctx.beginPath();
    ctx.arc(x, topY + 4, 8 + pulse * 2.5, 0, TAU);
    ctx.fill();

    const cdef = this.CROPS[p.crop];
    const art = cdef.shell || (cdef.art + '_p');
    const iy = topY - 10 - pulse * 1.2;
    ctx.fillStyle = 'rgba(6,14,18,0.4)';
    ctx.beginPath();
    ctx.arc(x, iy + 3.5, 5, 0, TAU);
    ctx.fill();
    const iw = this._widthFor(art, 7);
    drawA(ctx, art, x - iw / 2, iy, iw, assetH(art, iw));

    ctx.fillStyle = '#ffe66e';
    for (let i = 0; i < 3; i++) {
      const a = this.time * 1.6 + i * (TAU / 3);
      const s = 0.9 + 0.7 * Math.abs(Math.sin(this.time * 3.4 + i * 1.7));
      this._star(ctx, x + Math.cos(a) * 9, topY + 2 + Math.sin(a) * 5, s);
    }
  },

  // a ring around whatever [E] is pointed at, so the prompt has a referent
  _drawReachMark(ctx) {
    // holding a planter near the next open slot: a ghost of the bed, breathing
    if (this.reachPlace !== null && this.reachPlace !== undefined && this.reachPlace !== -1) {
      const def = this.PLOT_DEF[this.reachPlace];
      if (def) {
        const fake = { i: this.reachPlace, x: def.x };
        const by = this.bedY(fake);
        const img = ASSETS['bed_1'];
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 3);
        if (img && img.width) {
          const bw = this.BED_W + 12, bh = bw * img.height / img.width;
          ctx.drawImage(img, def.x - bw / 2, by - bh + 3, bw, bh);
        }
        ctx.globalAlpha = 1;
        text(ctx, '[E] set the planter down', def.x, by - 30, { size: 7, color: '#ffe6b0', align: 'center' });
      }
    }
    const p = this.reach;
    if (!p) return;
    const by = this.bedY(p);
    ctx.strokeStyle = 'rgba(255,230,110,0.75)';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(this.time * 4);
    ctx.beginPath();
    ctx.arc(p.x, by - 4, this.BED_W * 0.62 + Math.sin(this.time * 4) * 1.2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  _star(ctx, x, y, s) {
    ctx.fillRect(x - s, y - PIX, s * 2, PIX * 2);
    ctx.fillRect(x - PIX, y - s, PIX * 2, s * 2);
  },

  // inverse of assetH: the width that gives a sprite the height we want
  _widthFor(name, h) {
    const img = ASSETS[name];
    if (!img || !img.width || !img.height) return h;   // same silent fallback as assetH
    return h * img.width / img.height;
  },

  _drawFx(ctx, camX, camY) {
    if (!this.fx.length) return;
    // one fillStyle per kind — never build a colour string inside the loop
    const PAL = ['#cfeef8', '#b3a58a', '#ffe66e'];
    for (let k = 0; k < 3; k++) {
      let first = true;
      for (const p of this.fx) {
        if (p.k !== k) continue;
        if (p.x < camX - 20 || p.x > camX + W + 20) continue;
        if (p.y < camY - 20 || p.y > camY + H + 20) continue;
        if (first) { ctx.fillStyle = PAL[k]; first = false; }
        ctx.globalAlpha = clamp(p.t * 1.8, 0, k === 0 ? 0.85 : 0.7);
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
  },

  // The one bit of screen-space UI out in the water: what [E] would do here.
  // Drawn in Ocean's own HUD slot so it takes the colour grade with everything
  // else, and parked where neither the air capsule, the bag, the readiness pips
  // nor the hotbar live.
  drawOceanPrompt(ctx) {
    if (!this.reach || this.open) return;
    if (typeof Game === 'undefined' || typeof Ocean === 'undefined') return;
    if (Game.scene !== Ocean || Ocean.over || Ocean.leaving) return;
    if (this._peerOpen()) return;
    if (typeof Hood !== 'undefined' && Hood && Hood._reach) return;   // its prompt owns that line
    const touch = (typeof TouchUI !== 'undefined' && TouchUI.enabled);
    const label = (touch ? '' : '[E] ') + this.label(this.reach);
    const w = textWidth(ctx, label, 7) + 14;
    uiPanel(ctx, W / 2 - w / 2, H - 46, w, 13, 0.92, true);
    text(ctx, label, W / 2, H - 43, { size: 7, color: '#4a3020', align: 'center', shadow: false });
  },

  // ---- seed pouch picker (self-contained modal) --------------------------------------

  openPicker(i) {
    this._openT = 0;
    if (!this.ensure()) return;
    if (this._peerOpen()) return;
    if (this.seedTotal() <= 0) {
      SND.alarm();
      Game.toast("No seed packets. Buy some at Sprout's stall!");
      return;
    }
    this.plot = i | 0;
    this.open = true;
    this.sel = 0;
    for (let s = 0; s < this.SEEDS.length; s++) {
      if (this.seedCount(this.SEEDS[s].key) > 0) { this.sel = s; break; }
    }
    SND.blip();
    // (the old first-visit toast stack lived here; the journal teaches now)
  },

  closePicker() { this.open = false; SND.click(); },

  _rowRect(i) {
    // +34 on the left, not +8: uiPage puts the punch holes at +11 and the red
    // margin rule at +22, and a column starting at +8 sat on top of both.
    const colW = (this.WW - 76) / 2;
    const col = Math.floor(i / this.COL_ROWS), row = i % this.COL_ROWS;
    return { x: this.WX + 34 + col * (colW + 8), y: this.WY + 56 + row * this.ROW_H, w: colW, h: this.ROW_H - 2 };
  },
  _closeRect() { return { x: this.WX + this.WW - 46, y: this.WY + 6, w: 22, h: 18 }; },
  _in(r, mx, my) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; },

  updatePicker(dt) {
    this.time += dt;
    const p = this._get(this.plot);
    if (!p || !p.tilled || p.crop) { this.open = false; return; }   // world changed under us

    if (Input.p('Escape')) { this.closePicker(); return; }
    for (let i = 0; i < this.SEEDS.length; i++) {
      if (Input.p(`Digit${i + 1}`)) { this.sel = i; this._tryPlant(i); return; }
    }
    if (Input.wheelDelta) this.sel = clamp(this.sel + Input.wheelDelta, 0, this.SEEDS.length - 1);
    // arrows walk the two-column grid; Enter plants the selection. Digits only
    // reach the first nine packets, and the roster is twelve now.
    if (Input.p('ArrowUp')) this.sel = clamp(this.sel - 1, 0, this.SEEDS.length - 1);
    if (Input.p('ArrowDown')) this.sel = clamp(this.sel + 1, 0, this.SEEDS.length - 1);
    if (Input.p('ArrowLeft')) this.sel = clamp(this.sel - this.COL_ROWS, 0, this.SEEDS.length - 1);
    if (Input.p('ArrowRight')) this.sel = clamp(this.sel + this.COL_ROWS, 0, this.SEEDS.length - 1);
    if (Input.p('Enter')) { this._tryPlant(this.sel); return; }

    if (!Input.mouse.clicked) return;
    const mx = Input.mouse.x, my = Input.mouse.y;
    if (this._in(this._closeRect(), mx, my)) { this.closePicker(); return; }
    for (let i = 0; i < this.SEEDS.length; i++) {
      if (this._in(this._rowRect(i), mx, my)) { this.sel = i; this._tryPlant(i); return; }
    }
    // a click on the dimmed world behind the panel backs out, like tapping away
    if (mx < this.WX || mx > this.WX + this.WW || my < this.WY || my > this.WY + this.WH) this.closePicker();
  },

  _tryPlant(i) {
    const s = this.SEEDS[i];
    if (!s) return;
    if (this.seedCount(s.key) <= 0) {
      SND.alarm();
      Game.toast(`No ${s.name} in the pouch.`);
      return;
    }
    if (this.plant(this.plot, s.key)) this.open = false;
  },

  drawPicker(c) {
    if (!this.ensure()) return;
    const X = this.WX, Y = this.WY, WWi = this.WW;
    c.fillStyle = 'rgba(4,10,8,0.66)';
    c.fillRect(0, 0, W, H);
    c.save();
    uiPageOpen(c, clamp(this._openT, 0, 1), X + WWi / 2, Y + this.WH / 2);
    uiPage(c, X, Y, WWi, this.WH, 1);

    text(c, 'SEED POUCH', X + 34, Y + 12, { size: 12, color: '#7a5232', shadow: false });
    text(c, 'what otto has to put in the ground', X + 34, Y + 25,
      { size: 7, color: '#a8895e', shadow: false });
    const p = this._get(this.plot);
    if (p) {
      const bl = `bed ${this.plot + 1}`;
      const blw = textWidth(c, bl, 7) + 16;
      inkBox(c, X + WWi - 54 - blw, Y + 6, blw, 16, '#ffe9a8', '#a8761a', PIX * 2);
      text(c, bl, X + WWi - 54 - blw / 2, Y + 10.5,
        { size: 7, color: '#6b4a22', align: 'center', shadow: false });
    }
    const cr = this._closeRect();
    inkClose(c, cr, this._in(cr, Input.mouse.x, Input.mouse.y));
    uiRule(c, X + 34, Y + 44, WWi - 68, true);

    for (let i = 0; i < this.SEEDS.length; i++) {
      const s = this.SEEDS[i];
      const cd = this.CROPS[s.key];
      const n = this.seedCount(s.key);
      const r = this._rowRect(i);
      const hot = this._in(r, Input.mouse.x, Input.mouse.y) || this.sel === i;
      inkBox(c, r.x, r.y, r.w, r.h,
        hot ? (n > 0 ? 'rgba(255,236,182,0.96)' : 'rgba(246,240,224,0.9)') : 'rgba(247,240,220,0.9)',
        hot && n > 0 ? '#a8761a' : 'rgba(146,116,76,0.45)', hot && n > 0 ? PIX * 3 : PIX * 2);

      const iw = this._widthFor(s.art, 13);
      c.globalAlpha = n > 0 ? 1 : 0.4;
      drawA(c, s.art, r.x + 10 - iw / 2, r.y + 4, iw, assetH(s.art, iw));
      c.globalAlpha = 1;

      text(c, `${i + 1}. ${cd.name}`, r.x + 22, r.y + 3,
        { size: 7, shadow: false, color: n > 0 ? '#4a3020' : '#a08a68' });
      text(c, `${this.totalDays(s.key)}d  •  ${cd.qty}x$${cd.value}`,
        r.x + 22, r.y + 12, { size: 6, shadow: false, color: n > 0 ? '#8a7454' : '#b0a084' });
      text(c, n > 0 ? `x${n}` : '—', r.x + r.w - 6, r.y + 6,
        { size: 7, align: 'right', shadow: false, color: n > 0 ? '#a8761a' : '#b0a084' });
    }

    text(c, TouchUI.enabled ? 'tap a packet to plant  •  X to close' : '[1-9] or arrows + Enter   [Esc] close',
      X + WWi / 2, Y + this.WH - 15, { size: 6.5, color: '#8a7454', align: 'center', shadow: false });
    c.restore();
    text(c, `$${G.money}`, X + WWi - 34, Y + this.WH - 15, { size: 6.5, color: '#3f7a4e', align: 'right', shadow: false });

    // Game.drawCursor hides the arrow after 3 idle seconds, only special-cases
    // Shop, and draws nothing at all in a customCursor scene like the ocean — so
    // this pointer-driven panel draws its own, WHILE the mouse is live. (The
    // condition was inverted: > 3 showed the arrow only once it had gone idle,
    // which is exactly backwards.)
    const m = Input.mouse;
    if (!TouchUI.enabled && m.idleT <= 3) {
      c.save();
      c.translate(Math.round(m.x), Math.round(m.y));
      c.fillStyle = '#101820';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
      c.fillStyle = '#f2f4f6';
      c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
      c.restore();
    }
  },
};

// ---- derive the shop catalogue from the crop table (one source of truth) --------
for (const k of Farm.ORDER) {
  const c = Farm.CROPS[k];
  Farm.SEEDS.push({
    key: k,
    name: c.seedName,
    price: c.seedPrice,
    art: c.pack,                                   // the painted packet IS the icon
    desc: c.desc,
  });
  // PRODUCE is keyed by the OUT bin. Shell lines skip it: their harvest lands in
  // G.storage and is priced by ITEMS like any dived shell.
  if (c.bin !== 'storage') {
    Farm.PRODUCE[c.out] = { name: c.name, value: c.value, art: c.art + '_p' };
  }
}
