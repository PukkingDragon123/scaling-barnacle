'use strict';
// js/mining.js -- resource harvesting in the open ocean.
//
// One top-level const, nothing else at file scope. No hooks are installed and
// nothing is monkeypatched: this is a system a SCENE drives, not a modal, so the
// ocean scene owns the calls and js/integrate.js owns the wiring. Nothing here
// runs at load time, so the file is safe anywhere in index.html's order.
//
// The contract with the scene is four calls:
//   Mining.reset(seed)                       on enter, once
//   Mining.ensureChunk(cx, cy, seed)         while it generates terrain
//   Mining.update(dt, px, py, cam)           every frame, px/py = Otto's centre
//   Mining.draw(ctx, camX, camY)             WORLD space (camera already applied)
// plus two hooks the integrator may re-point: Mining.xp and Mining.anim.
//
// Everything else (nodes, drifting loot, chips, fly-up labels) is preallocated in
// init() and recycled. The steady state allocates nothing: the frame budget here
// is shared with a filtered 1920x1080 backdrop, so a per-particle colour string or
// a per-frame gradient is not affordable. Chips carry a tone INDEX into a fixed
// palette, which caps the draw at one fillStyle per tone actually in use.
//
// Depth is the whole economy: NODES[k].band is a window in depth-fraction
// (world y / DEEP_MAX), and gold/crystal only open up past 0.62/0.78 of it. That
// is the reason to spend air going down.
const Mining = {

  // ---------------------------------------------------------------- tuning ----
  CHUNK_W: 480,          // one screen wide; the scene's chunk grid must match
  CHUNK_H: 280,
  DEEP_MAX: 2400,        // world y that counts as depth-fraction 1.0
  MIN_SEP: 58,           // no two nodes in a chunk closer than this (scaled with node width)
  MAX_NODES: 96,         // hard cap; the furthest-from-camera nodes are dropped
  MARGIN: 34,            // keep placements off the chunk seams

  SWING_T: 0.44,         // seconds per full opick_0..3 swing
  HIT_AT: 0.55,          // fraction of the swing where frame 2 (the strike) lands

  // ---- THE TIMING GAME --------------------------------------------------------
  // A sweep runs back and forth across a bar while you are on a node. Strike
  // inside the sweet spot and the blow lands harder; strike in the narrow core of
  // it and it lands MUCH harder. Miss and the swing still counts, it just does
  // the ordinary damage -- the game rewards skill, it never punishes you into a
  // stall. The window narrows as the node's tier goes up, which is what makes a
  // crystal cluster feel different from a log rather than merely slower.
  BAR_W: 74,             // logical width of the bar over the node
  SWEEP_T: 0.86,         // seconds for one full there-and-back
  ZONE_W: 0.30,          // fraction of the bar that is the good zone, at tier 0
  CORE_W: 0.11,          // ... and the perfect core inside it
  ZONE_TIGHTEN: 0.055,   // subtracted per node tier
  GOOD_MUL: 1.6,
  PERFECT_MUL: 2.6,
  REACH: 42,             // how far in front of Otto a node can be mined (nodes grew, so did this)
  CURSOR_R: 20,          // click slop when aiming with the pointer
  NOTE_GAP: 1.4,         // rate limit on the "too soft" complaint

  VAC_R: 44,             // drops inside this get sucked toward Otto
  GRAB_R: 9,
  VAC_ACC: 300,
  LOOT_LIFE: 26,         // a missed drop eventually gives up
  DRIFT_DRAG: 0.90,

  CHIP_MAX: 90,
  LOOT_MAX: 48,
  FLY_MAX: 10,

  // Chip colours are a FIXED palette; a chip stores an index into it so the draw
  // can bucket by tone and set fillStyle at most eight times a frame.
  CHIP_TONES: ['#c9a271', '#8a6434', '#8f9aa4', '#c9d4dc', '#e8a93c', '#5ad2f0', '#2f3038', '#6d4526'],

  // ------------------------------------------------------------- resources ----
  // key -> { name, art, value, tier }. `tier` is the pick tier that first yields
  // it, for shop/inventory copy. Sold value is per unit, in sand dollars.
  RES: {
    driftwood: { name: 'driftwood', art: 'res_driftwood', value: 3, tier: 0 },
    stone: { name: 'stone', art: 'res_stone', value: 2, tier: 0 },
    ore: { name: 'raw ore', art: 'res_ore', value: 7, tier: 1 },
    nail: { name: 'old nail', art: 'res_nail', value: 5, tier: 0 },
    plank: { name: 'salvaged plank', art: 'res_plank', value: 9, tier: 1 },
    ingot: { name: 'iron ingot', art: 'res_ingot', value: 16, tier: 2 },
    crystal: { name: 'sea crystal', art: 'res_crystal', value: 26, tier: 3 },
    // from the newest sheet: the softer finds a stone pick already turns up
    sand: { name: 'coarse sand', art: 'res_sand', value: 1, tier: 0 },
    glass: { name: 'sea glass', art: 'res_glass', value: 12, tier: 0 },
    beam: { name: 'oak beam', art: 'res_beam', value: 14, tier: 1 }
  },

  // THE INVENTORY SEAM. Everything mined is counted through _bin/have/give/take,
  // and BIN maps a resource key to its G.storage key. G.storage is the one
  // deep-merged bin on G, so extra keys survive an old save (Craft and Stock
  // exploit the same thing). `driftwood` deliberately shares Craft's material
  // key: mined driftwood feeds Craft's recipes with no extra wiring. Re-point
  // this table if that ever needs to change.
  BIN: {
    driftwood: 'driftwood',
    stone: 'stone',
    ore: 'ore',
    nail: 'nail',
    plank: 'plank',
    ingot: 'ingot',
    crystal: 'crystal'
  },

  // ------------------------------------------------------------- pickaxes -----
  // tier IS the index. power = hp removed per swing, so swings-to-break is
  // ceil(hardness / power) and a better pick is felt on every node, not just the
  // ones it unlocks. No pickaxe art exists in the manifest, so the icon is a
  // coded glyph (drawPickIcon) -- same trick Hotbar plays with 'g_hoe'.
  PICKS: [
    { name: 'shell pick', power: 1, price: 0, desc: 'chips timber and soft stone' },
    { name: 'stone pick', power: 1, price: 90, desc: 'bites coal, iron and scrap' },
    { name: 'iron pick', power: 2, price: 260, desc: 'splits gold and sunken wrecks' },
    { name: 'crystal pick', power: 3, price: 700, desc: 'the only thing that touches crystal' }
  ],

  // ---------------------------------------------------------------- nodes -----
  // hardness  : hp, i.e. swings at power 1
  // tier      : minimum pick tier, else "your pickaxe is too soft for this"
  // band      : [lo, hi] depth fraction where it can spawn; it ramps in over the
  //             first RAMP of the band so the good stuff thins out at its edge
  // weight    : relative frequency inside the band
  // loot      : [{ res, min, max, chance }]  chance 1 = always
  // chips     : two CHIP_TONES indices for the impact debris
  // snd       : 'scrape' | 'clink' | 'thump'   the swing ping
  NODES: {
    wood: {
      key: 'wood', name: 'sunken timber', art: 'node_wood', w: 46,
      hardness: 3, tier: 0, band: [0.00, 0.60], weight: 10, skill: 'foraging', xp: 3,
      chips: [0, 1], snd: 'thump',
      loot: [
        { res: 'driftwood', min: 1, max: 3, chance: 1 },
        { res: 'plank', min: 1, max: 1, chance: 0.22 },
        { res: 'nail', min: 1, max: 2, chance: 0.18 }
      ]
    },
    stone: {
      key: 'stone', name: 'stone outcrop', art: 'ore_stone', w: 54,
      hardness: 4, tier: 0, band: [0.00, 0.85], weight: 12, skill: 'mining', xp: 4,
      chips: [2, 3], snd: 'scrape',
      loot: [
        { res: 'stone', min: 1, max: 3, chance: 1 },
        { res: 'ore', min: 1, max: 1, chance: 0.10 }
      ]
    },
    scrap: {
      key: 'scrap', name: 'scrap pile', art: 'ore_scrap', w: 54,
      hardness: 6, tier: 1, band: [0.10, 0.80], weight: 5, skill: 'salvage', xp: 6,
      chips: [2, 7], snd: 'clink',
      loot: [
        { res: 'nail', min: 2, max: 4, chance: 1 },
        { res: 'plank', min: 1, max: 2, chance: 0.45 },
        { res: 'ingot', min: 1, max: 1, chance: 0.12 }
      ]
    },
    coal: {
      key: 'coal', name: 'coal seam', art: 'ore_coal', w: 54,
      hardness: 6, tier: 1, band: [0.18, 0.95], weight: 7, skill: 'mining', xp: 6,
      chips: [6, 2], snd: 'scrape',
      loot: [
        { res: 'stone', min: 2, max: 4, chance: 1 },
        { res: 'ore', min: 1, max: 2, chance: 0.55 }
      ]
    },
    iron: {
      key: 'iron', name: 'iron vein', art: 'ore_copper', w: 54,
      hardness: 8, tier: 1, band: [0.30, 1.00], weight: 6, skill: 'mining', xp: 9,
      chips: [2, 3], snd: 'clink',
      loot: [
        { res: 'ore', min: 2, max: 3, chance: 1 },
        { res: 'ingot', min: 1, max: 1, chance: 0.30 },
        { res: 'stone', min: 1, max: 2, chance: 0.5 }
      ]
    },
    wreck: {
      key: 'wreck', name: 'wreck timber', art: 'node_wreck', w: 52,
      hardness: 10, tier: 2, band: [0.35, 1.00], weight: 3, skill: 'salvage', xp: 12,
      chips: [7, 1], snd: 'thump',
      loot: [
        { res: 'plank', min: 2, max: 4, chance: 1 },
        { res: 'nail', min: 2, max: 5, chance: 0.8 },
        { res: 'ingot', min: 1, max: 2, chance: 0.35 }
      ]
    },
    gold: {
      key: 'gold', name: 'gold seam', art: 'ore_gold', w: 54,
      hardness: 12, tier: 2, band: [0.62, 1.00], weight: 3, skill: 'mining', xp: 16,
      chips: [4, 2], snd: 'clink',
      loot: [
        { res: 'ore', min: 2, max: 4, chance: 1 },
        { res: 'ingot', min: 1, max: 2, chance: 0.6 },
        { res: 'crystal', min: 1, max: 1, chance: 0.10 }
      ]
    },
    crystal: {
      key: 'crystal', name: 'crystal cluster', art: 'ore_crystal', w: 56,
      hardness: 14, tier: 3, band: [0.78, 1.00], weight: 2, skill: 'mining', xp: 22,
      chips: [5, 3], snd: 'clink',
      loot: [
        { res: 'crystal', min: 1, max: 3, chance: 1 },
        { res: 'ore', min: 1, max: 2, chance: 0.5 }
      ]
    }
  },
  KINDS: ['wood', 'stone', 'scrap', 'coal', 'iron', 'wreck', 'gold', 'crystal'],
  RAMP: 0.12,            // band fade-in width, in depth fraction

  // ---------------------------------------------------------------- state -----
  nodes: [],             // live nodes for the current area
  loot: [],              // the drift pool; entries with live === false are free
  chips: [],
  flys: [],
  seed: 1,
  cam: { x: 0, y: 0 },   // last camera the scene handed us
  // How many logical screen units the scene draws per world unit. The ocean zooms
  // its world layers, so a pointer position in screen units is NOT a world offset
  // any more -- it has to be divided by this before it is added to the camera, or
  // the cursor aims progressively further right and lower than it points. The scene
  // sets it; 1 keeps every other caller behaving exactly as before.
  camZoom: 1,
  target: null,          // node currently aimed at
  swinging: false,
  busy: false,           // true while a swing is in flight; scenes can gate on it
  swingT: 0,
  sweep: 0,              // 0..1 position of the timing cursor
  sweepDir: 1,
  sweepFor: null,        // the node uid the current sweep belongs to
  lastHit: '',           // 'perfect' | 'good' | '' -- for the flash
  lastHitT: 0,
  hitDone: false,
  aimX: 0, aimY: 0,      // world-space aim point
  holding: false,
  facing: 0,             // -1 / 0 / 1; set by the scene when pollInput is false
  pollInput: true,       // false => the scene drives hold()/setAim()/facing
  note: '', noteT: 0, noteX: 0, noteY: 0,
  combo: 0, comboT: 0,
  time: 0,
  _stamp: -1,            // double-call guard, keyed on Game.time
  _pool: false,
  _chunks: {},           // chunk id -> 1, "already asked for"
  _uids: {},             // node uid -> 1, so a re-asked chunk cannot double up
  _noteGap: 0,

  // XP goes out through this hook so mining knows nothing about the skills
  // module. The integrator points it at whatever exists; default is a no-op.
  xp: function (skill, n) { },

  // Otto's swing animation goes out the same way. Left at the default, a swing
  // asks the host scene to play its own pickaxe cycle if it has one (Ocean
  // publishes playMine(t) for exactly this), which is the same typeof-guarded
  // opt-in DiveScene uses for DiveFX. Point it anywhere to override, or at a
  // no-op to draw the swing yourself off pickFrame().
  anim: function (t) {
    if (typeof Ocean !== 'undefined' && Ocean && Ocean.playMine) Ocean.playMine(t);
  },

  // ------------------------------------------------------------------ save ----
  // G.mining = { pick, broken, lastDay, swings, mined, gems }
  // Only five keys on G are deep-merged and `mining` is not one of them, so this
  // re-normalises the whole subtree on EVERY entry point -- an older save, a
  // rolled-back save or a hand-edited one must not be able to poison draw.
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    var s = G.mining;
    if (!s || typeof s !== 'object') { s = G.mining = {}; }

    var p = Math.floor(s.pick);
    if (!isFinite(p)) p = 0;
    s.pick = p < 0 ? 0 : (p > this.PICKS.length - 1 ? this.PICKS.length - 1 : p);

    if (!s.broken || typeof s.broken !== 'object') s.broken = {};
    if (typeof s.swings !== 'number' || !isFinite(s.swings)) s.swings = 0;
    if (typeof s.mined !== 'number' || !isFinite(s.mined)) s.mined = 0;
    if (typeof s.gems !== 'number' || !isFinite(s.gems)) s.gems = 0;

    if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day;
    if (s.lastDay > G.day) s.lastDay = G.day;   // save rollback / new game

    if (!this._pool) this.init();
    return true;
  },

  // Fixed-size pools, built once. `live` false (or t <= 0 for chips) means free.
  init: function () {
    var i;
    this._pool = true;
    this.loot.length = 0;
    for (i = 0; i < this.LOOT_MAX; i++) {
      this.loot.push({ live: false, res: 'stone', n: 1, x: 0, y: 0, vx: 0, vy: 0, t: 0, sp: 0, vac: 0 });
    }
    this.chips.length = 0;
    for (i = 0; i < this.CHIP_MAX; i++) {
      // sz is the drawn size in logical units, snapped to the texel grid ONCE at
      // spawn so the draw loop stays a bare fillRect
      this.chips.push({ t: 0, x: 0, y: 0, vx: 0, vy: 0, sz: PIX * 2, tone: 0 });
    }
    this.flys.length = 0;
    for (i = 0; i < this.FLY_MAX; i++) {
      this.flys.push({ live: false, txt: '', x: 0, y: 0, t: 0, col: '#ffe66e' });
    }
  },

  // Nodes regrow overnight: clearing the broken set is the whole nightly pass.
  // Idempotent per calendar day and driven off a persisted lastDay, because the
  // clock-driven day roll in Game.globalUpdate is NOT hooked and would skip us.
  newDay: function () {
    if (!this.ensure()) return;
    var s = G.mining;
    if (s.lastDay >= G.day) return;
    var guard = 0;
    while (s.lastDay < G.day && guard++ < 30) { s.broken = {}; s.lastDay++; }
    s.lastDay = G.day;
    // Force a re-ask so last night's mined-out nodes come back. _uids keeps the
    // ones still on screen from being added a second time.
    this._chunks = {};
    if (typeof Game !== 'undefined') Game.save();
  },

  // ------------------------------------------------------------ resources -----
  resDef: function (key) {
    return Object.prototype.hasOwnProperty.call(this.RES, key) ? this.RES[key] : null;
  },
  resName: function (key) {
    var d = this.resDef(key);
    return d ? d.name : String(key);
  },
  resValue: function (key) {
    var d = this.resDef(key);
    return d ? d.value : 0;
  },
  binKey: function (key) {
    return Object.prototype.hasOwnProperty.call(this.BIN, key) ? this.BIN[key] : key;
  },
  _bin: function () {
    // One place decides which bag mining counts through.
    return (typeof G !== 'undefined' && G && G.storage) ? G.storage : null;
  },
  have: function (key) {
    if (!this.ensure()) return 0;
    var b = this._bin(), k = this.binKey(key);
    if (!b || !Object.prototype.hasOwnProperty.call(b, k)) return 0;
    var n = b[k];
    return (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
  },
  give: function (key, n) {
    if (!this.ensure()) return 0;
    n = Math.floor(n || 0);
    if (n <= 0) return 0;
    var b = this._bin();
    if (!b) return 0;
    var k = this.binKey(key);
    b[k] = this.have(key) + n;
    return n;
  },
  // All or nothing, like Craft.take -- a partial spend is always a bug.
  take: function (key, n) {
    n = Math.floor(n || 0);
    if (n <= 0) return true;
    if (this.have(key) < n) return false;
    var b = this._bin();
    b[this.binKey(key)] = this.have(key) - n;
    return true;
  },
  resTotal: function () {
    var t = 0, k;
    for (k in this.RES) {
      if (!Object.prototype.hasOwnProperty.call(this.RES, k)) continue;
      t += this.have(k);
    }
    return t;
  },
  resValueHeld: function () {
    var v = 0, k;
    for (k in this.RES) {
      if (!Object.prototype.hasOwnProperty.call(this.RES, k)) continue;
      v += this.have(k) * this.RES[k].value;
    }
    return v;
  },

  // Off-dock sale, same shape as Farm.sellProduce / Stock.shipProducts: the
  // money arrives with the next drone rather than instantly.
  sell: function (keys) {
    if (!this.ensure()) return 0;
    var list = keys && keys.length ? keys : this.resKeys();
    var v = 0, i, k, n;
    for (i = 0; i < list.length; i++) {
      k = list[i];
      if (!this.resDef(k)) continue;
      n = this.have(k);
      if (n <= 0) continue;
      v += n * this.RES[k].value;
      this.take(k, n);
    }
    if (v <= 0) { this._snd('blip'); return 0; }
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    if (typeof Game !== 'undefined') {
      Game.toast('crate away -- ' + v + ' sand dollars inbound');
      Game.save();
    }
    this._snd('cash');
    return v;
  },
  resKeys: function () {
    var out = [], k;
    for (k in this.RES) {
      if (Object.prototype.hasOwnProperty.call(this.RES, k)) out.push(k);
    }
    return out;
  },
  // Shop-row shaped, for whoever wires the sell counter.
  sellRows: function () {
    var rows = [], keys = this.resKeys(), i, k, n, d, self = this;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      n = this.have(k);
      if (n <= 0) continue;
      d = this.RES[k];
      rows.push({
        gart: d.art,
        label: d.name + ' x' + n,
        sub: d.value + ' ea',
        btn: 'ship ' + (n * d.value),
        act: (function (key) { return function () { self.sell([key]); }; })(k)
      });
    }
    if (!rows.length) rows.push({ info: 'nothing mined yet -- take a pick down a piling' });
    return rows;
  },

  // ------------------------------------------------------------- pickaxes -----
  tier: function () { return this.ensure() ? G.mining.pick : 0; },
  pickDef: function () { return this.PICKS[this.tier()]; },
  power: function () {
    var p = this.pickDef().power;
    // A steady buff from a hot meal helps the swing land; harmless if Craft is absent.
    if (typeof Craft !== 'undefined' && Craft.hasBuff && Craft.hasBuff('sharp')) p += 1;
    return p;
  },
  setPick: function (t, quiet) {
    if (!this.ensure()) return false;
    t = Math.floor(t || 0);
    if (t < 0) t = 0;
    if (t > this.PICKS.length - 1) t = this.PICKS.length - 1;
    if (t <= G.mining.pick) return false;         // never downgrade
    G.mining.pick = t;
    if (typeof Game !== 'undefined') {
      // quiet when a purchase already toasted "Bought: ..." for us
      if (!quiet) Game.toast('otto hefts the ' + this.PICKS[t].name);
      Game.save();
    }
    this._snd('chime');
    return true;
  },
  nextPick: function () {
    var t = this.tier() + 1;
    return t < this.PICKS.length ? this.PICKS[t] : null;
  },
  // Routed through Shop.buy so cash, sound, the failure toast and the save all
  // behave exactly like every other purchase in the game. Shop.buy returns
  // nothing, so success is reported out of the apply callback it runs inline.
  buyPick: function () {
    if (!this.ensure()) return false;
    var t = this.tier() + 1, self = this, ok = false;
    if (t >= this.PICKS.length) { this._snd('blip'); return false; }
    var d = this.PICKS[t];
    if (typeof Shop !== 'undefined' && Shop.buy) {
      Shop.buy(d.price, function () { ok = self.setPick(t, true); }, d.name);
      return ok;
    }
    if (G.money < d.price) {
      if (typeof Game !== 'undefined') Game.toast('Not enough sand dollars.');
      this._snd('alarm');
      return false;
    }
    G.money -= d.price;
    this._snd('cash');
    return this.setPick(t);
  },
  // Shop-row shaped, for a gear tab that wants to sell the upgrade.
  shopRows: function () {
    if (!this.ensure()) return [];
    var nx = this.nextPick(), self = this;
    if (!nx) return [{ info: 'the ' + this.pickDef().name + ' is the finest pick otto has ever owned' }];
    return [{
      label: nx.name,
      sub: nx.desc,
      btn: '$' + nx.price,
      price: nx.price,
      act: function () { self.buyPick(); }
    }];
  },
  canBreak: function (n) {
    return !!n && this.tier() >= this.NODES[n.kind].tier;
  },
  swingsLeft: function (n) {
    if (!n) return 0;
    return Math.ceil(n.hp / Math.max(1, this.power()));
  },
  label: function (n) {
    if (!n) return '';
    var d = this.NODES[n.kind];
    if (!this.canBreak(n)) return d.name + ' -- needs the ' + this.PICKS[d.tier].name;
    return d.name + ' -- ' + this.swingsLeft(n) + (this.swingsLeft(n) === 1 ? ' swing' : ' swings');
  },

  // ---------------------------------------------------------- generation ------
  // Where a node sits in the tier ladder, 0..1. With a flat shallow seabed under
  // the scene, y stopped sorting anything -- everything is within 430 units of the
  // surface -- so the ranking is DISTANCE FROM HOME when the scene publishes one.
  // Gold and crystal are a long swim out rather than a deep dive down, which is
  // also what the named zones already promise.
  depthFrac: function (y, x) {
    if (x !== undefined && typeof Ocean !== 'undefined' && Ocean && Ocean.remoteFrac) {
      return Ocean.remoteFrac(x);
    }
    var f = y / this.DEEP_MAX;
    return f < 0 ? 0 : (f > 1 ? 1 : f);
  },
  chunkXAt: function (x) { return Math.floor(x / this.CHUNK_W); },
  chunkYAt: function (y) { return Math.floor(y / this.CHUNK_H); },

  // Triangular-ish fade so a kind thins out at the shallow edge of its band
  // instead of popping into existence at full weight.
  weightAt: function (def, df) {
    var lo = def.band[0], hi = def.band[1];
    if (df < lo || df > hi) return 0;
    var w = def.weight, r = this.RAMP;
    if (r > 0 && df < lo + r) w *= 0.25 + 0.75 * ((df - lo) / r);
    if (r > 0 && df > hi - r && hi < 1) w *= 0.25 + 0.75 * ((hi - df) / r);
    return w;
  },

  _hash: function (cx, cy, seed) {
    // Cheap 32-bit mix; the point is that (cx, cy, seed) always lands on the
    // same stream so a chunk regenerates identically after a reload.
    var h = (seed | 0) * 0x27d4eb2d;
    h = (h ^ (cx * 0x9e3779b1)) | 0;
    h = (h ^ (cy * 0x85ebca6b)) | 0;
    h = (h ^ (h >>> 13)) | 0;
    return h | 0;
  },

  // Deterministic placements for one chunk. Pure: it neither registers the nodes
  // nor touches G beyond reading the broken set, so a scene may call it to peek.
  spawnFor: function (chunkX, chunkY, seed) {
    var out = [];
    if (!this.ensure()) return out;
    if (chunkY < 0) return out;                 // nothing to mine above the surface
    var rng = mulberry32(this._hash(chunkX, chunkY, seed === undefined ? this.seed : seed));
    var baseY = chunkY * this.CHUNK_H, baseX = chunkX * this.CHUNK_W;
    var df0 = this.depthFrac(baseY, baseX + this.CHUNK_W * 0.5);
    // Deeper water is a little denser; the surface layer stays sparse so the
    // first screen never reads as a quarry.
    var count = 2 + Math.floor(rng() * (df0 > 0.25 ? 3 : 2));
    var span = this.CHUNK_W - this.MARGIN * 2, spanY = this.CHUNK_H - this.MARGIN * 2;
    if (span < 8 || spanY < 8) return out;

    // Nodes SIT ON THE SEABED. A stone outcrop hanging in open water was the
    // loudest of the floating scenery, and it also made no sense to mine. When
    // the scene publishes a ground line (Ocean.floorAt), the picked x is dropped
    // onto it -- and only the chunk row that CONTAINS the floor at that x keeps
    // the node, or every row above the sand would stack its own copy on the same
    // spot. Rows of open water therefore spawn nothing, which is correct: there
    // is nothing to stand an ore vein on up there. Without a ground line (some
    // other scene hosting this module) the old mid-water placement still works.
    var grounded = typeof Ocean !== 'undefined' && Ocean && typeof Ocean.floorAt === 'function';
    var i, j, tries, x, y, fy, ok, df, kind, pairs, k, def, w, uid, node;
    for (i = 0; i < count; i++) {
      x = 0; y = 0; ok = false;
      for (tries = 0; tries < 6 && !ok; tries++) {
        x = baseX + this.MARGIN + rng() * span;
        y = baseY + this.MARGIN + rng() * spanY;
        ok = true;
        for (j = 0; j < out.length; j++) {
          if (Math.abs(out[j].x - x) < this.MIN_SEP && Math.abs(out[j].y - y) < this.MIN_SEP) { ok = false; break; }
        }
      }
      if (!ok) continue;

      if (grounded) {
        fy = Ocean.floorAt(x);
        if (!(fy >= baseY && fy < baseY + this.CHUNK_H)) continue;   // another row's sand
        y = fy;
      }

      df = this.depthFrac(y, x);
      pairs = [];
      for (j = 0; j < this.KINDS.length; j++) {
        k = this.KINDS[j];
        w = this.weightAt(this.NODES[k], df);
        if (w > 0) pairs.push([k, w]);
      }
      if (!pairs.length) continue;
      kind = weightedPick(pairs, rng());
      if (!kind || !Object.prototype.hasOwnProperty.call(this.NODES, kind)) continue;
      def = this.NODES[kind];
      uid = chunkX + ':' + chunkY + ':' + i;
      node = this._makeNode(uid, kind, def, x, y, rng);
      // the node is drawn centred, so lift half its height off the line and then
      // bed it in by a few units -- nothing balances on the sand, it sits in it
      if (grounded) node.y = Math.round((y - node.h * 0.5 + 3) * DPX) / DPX;
      out.push(node);
    }
    return out;
  },

  _makeNode: function (uid, kind, def, x, y, rng) {
    var n = {
      uid: uid, kind: kind,
      x: Math.round(x * DPX) / DPX, y: Math.round(y * DPX) / DPX,
      w: def.w, h: 0,
      hp: def.hardness, max: def.hardness,
      flip: rng() < 0.5,
      shakeT: 0, shakeA: 0, hitT: 0, hitL: 0.16, hitX: 0, hitY: 0,
      dead: false,
      cr: null
    };
    n.h = (typeof assetH === 'function') ? assetH(def.art, def.w) : def.w;
    // Crack segments are baked once, from the placement stream, so they never
    // crawl between frames (same discipline as Craft._grain / Farm._buildGrit).
    var cr = [], i;
    for (i = 0; i < 3; i++) {
      cr.push({
        x1: (rng() - 0.5) * 0.7, y1: (rng() - 0.5) * 0.7,
        x2: (rng() - 0.5) * 0.9, y2: (rng() - 0.5) * 0.9
      });
    }
    n.cr = cr;
    if (G.mining.broken && Object.prototype.hasOwnProperty.call(G.mining.broken, uid)) n.dead = true;
    return n;
  },

  // Ask-once wrapper the scene uses while it generates. Chunks already asked for
  // are skipped, so calling this every frame for the visible band is fine.
  ensureChunk: function (chunkX, chunkY, seed) {
    if (!this.ensure()) return;
    if (seed !== undefined) this.seed = seed | 0;
    var id = chunkX + ':' + chunkY;
    if (Object.prototype.hasOwnProperty.call(this._chunks, id)) return;
    this._chunks[id] = 1;
    var list = this.spawnFor(chunkX, chunkY, this.seed), i, n;
    for (i = 0; i < list.length; i++) {
      n = list[i];
      if (n.dead) continue;                                                  // mined out today
      if (Object.prototype.hasOwnProperty.call(this._uids, n.uid)) continue;  // already on screen
      this._uids[n.uid] = 1;
      this.nodes.push(n);
    }
    if (this.nodes.length > this.MAX_NODES) this._trim();
  },

  // Convenience: fill every chunk touching the given screen box.
  ensureAround: function (camX, camY, seed) {
    var x0 = this.chunkXAt(camX - this.CHUNK_W * 0.5), x1 = this.chunkXAt(camX + W + this.CHUNK_W * 0.5);
    var y0 = this.chunkYAt(camY - this.CHUNK_H * 0.5), y1 = this.chunkYAt(camY + H + this.CHUNK_H * 0.5);
    var cx, cy;
    if (y0 < 0) y0 = 0;
    for (cy = y0; cy <= y1; cy++) {
      for (cx = x0; cx <= x1; cx++) this.ensureChunk(cx, cy, seed);
    }
  },

  // Drop whatever is furthest from the camera. The chunk cache is cleared for
  // those ids so they regenerate identically if the player swims back.
  _trim: function () {
    var cam = this.cam, iz = this.camZoom > 0 ? 1 / this.camZoom : 1, i, n, d, dd, best,
      cy = cam.y + H * 0.5 * iz, cx = cam.x + W * 0.5 * iz;
    // Cheapest correct thing at this size: repeatedly drop the single furthest.
    while (this.nodes.length > this.MAX_NODES) {
      best = -1; d = -1;
      for (i = 0; i < this.nodes.length; i++) {
        n = this.nodes[i];
        dd = Math.abs(n.y - cy) + Math.abs(n.x - cx) * 0.5;
        if (dd > d) { d = dd; best = i; }
      }
      if (best < 0) break;
      this._forget(this.nodes[best]);
      this.nodes.splice(best, 1);
    }
  },

  // Drop a node's bookkeeping. The chunk id is released too, so swimming back
  // regenerates it identically from the same seed.
  _forget: function (n) {
    if (this.target === n) this.target = null;
    if (Object.prototype.hasOwnProperty.call(this._uids, n.uid)) delete this._uids[n.uid];
    var id = n.uid.substring(0, n.uid.lastIndexOf(':'));
    if (Object.prototype.hasOwnProperty.call(this._chunks, id)) delete this._chunks[id];
  },

  // Call on scene enter. seed should be stable for the area (e.g. G.seeds[p]).
  reset: function (seed) {
    if (!this.ensure()) return;
    this.seed = (seed === undefined ? 1 : seed) | 0;
    this.nodes.length = 0;
    this._chunks = {};
    this._uids = {};
    this.target = null;
    this.swinging = false;
    this.busy = false;
    this.swingT = 0;
    this.hitDone = false;
    this.combo = 0;
    this.comboT = 0;
    this.note = '';
    this.noteT = 0;
    this._noteGap = 0;
    var i;
    for (i = 0; i < this.loot.length; i++) this.loot[i].live = false;
    for (i = 0; i < this.chips.length; i++) this.chips[i].t = 0;
    for (i = 0; i < this.flys.length; i++) this.flys[i].live = false;
  },

  // ------------------------------------------------------------- aiming -------
  nodeAt: function (wx, wy, slop) {
    if (slop === undefined) slop = this.CURSOR_R;
    var best = null, bd = 1e9, i, n, dx, dy, d, r;
    for (i = 0; i < this.nodes.length; i++) {
      n = this.nodes[i];
      if (n.dead) continue;
      dx = wx - n.x; dy = wy - n.y;
      d = Math.sqrt(dx * dx + dy * dy);
      r = Math.max(n.w, n.h) * 0.5 + slop;
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  },

  // The node under the cursor wins; failing that, the nearest node within REACH,
  // biased to the side Otto is facing so a swing goes where he is looking.
  aim: function (px, py, dir, mx, my) {
    var hit = (mx === undefined) ? null : this.nodeAt(mx, my);
    if (hit && this._within(hit, px, py, this.REACH + 14)) return hit;
    var best = null, bd = 1e9, i, n, dx, dy, d;
    for (i = 0; i < this.nodes.length; i++) {
      n = this.nodes[i];
      if (n.dead) continue;
      dx = n.x - px; dy = n.y - py;
      d = Math.sqrt(dx * dx + dy * dy) - Math.max(n.w, n.h) * 0.4;
      if (dir && dx * dir < -8) d += 22;       // behind him: strongly deprioritised
      if (d < this.REACH && d < bd) { bd = d; best = n; }
    }
    return best;
  },
  _within: function (n, px, py, r) {
    var dx = n.x - px, dy = n.y - py;
    return Math.sqrt(dx * dx + dy * dy) - Math.max(n.w, n.h) * 0.4 < r;
  },

  // Scene-driven input (set pollInput = false first), mirroring Battle.
  hold: function (on) { this.holding = !!on; },
  setAim: function (wx, wy) { this.aimX = wx; this.aimY = wy; },

  // ---- ENGAGING A ROCK -------------------------------------------------------
  // Proximity used to be enough: swim past a rock and the sweep bar and progress
  // ring popped up on it unasked, so crossing a field of them strobed UI at you
  // and a stray click mined whatever happened to be nearest. Now a rock has to be
  // taken up deliberately -- `candidate` is merely what is in reach and gets the
  // [E] prompt, and `target` (the thing with the bar, the ring and the swings) is
  // only ever set by engage().
  //
  // Leaving reach drops it, which is the one implicit release: walking away from a
  // rock obviously means you are done with it, and making the player press a key
  // to confirm that would be pedantry.
  engage: function (n) {
    if (!n || n.dead) return false;
    if (this.target === n) { this.disengage(); return false; }
    this.target = n;
    this.sweepFor = null;                  // restart the sweep from the left
    this._engagedT = 0;
    if (typeof this.snd === 'function') this.snd('tap');
    return true;
  },
  disengage: function () {
    this.target = null;
    this.sweepFor = null;
    this.holding = false;
    if (!this.swinging) this.busy = false;
  },
  // Whether pressing the interact key right now would start mining something.
  canEngage: function () { return !!(this.candidate && !this.candidate.dead && this.candidate !== this.target); },

  // ------------------------------------------------------------- swinging -----
  // opick_0..3 = wind-up, raised, strike, recover. The hit lands as frame 2
  // comes up, which is what makes the ping read as contact.
  frameIndex: function () {
    if (!this.swinging) return -1;
    var f = this.swingT / this.SWING_T;
    var i = Math.floor(f * 4);
    return i < 0 ? 0 : (i > 3 ? 3 : i);
  },
  pickFrame: function () {
    var i = this.frameIndex();
    return i < 0 ? null : 'opick_' + i;
  },

  _startSwing: function () {
    this.swinging = true;
    this.busy = true;
    this.swingT = 0;
    this.hitDone = false;
    // Slightly longer than the swing so a held sequence never flickers back to
    // the swim cycle between blows. Both outward hooks are typeof-checked because
    // the integrator owns them and may have set them to anything.
    if (typeof this.anim === 'function') this.anim(this.SWING_T * 1.35);
  },

  // Half-width of the good zone and its core for this node, as fractions of the
  // bar. Centred at 0.5, so a zone is [0.5 - half, 0.5 + half].
  zoneFor: function (n) {
    var def = this.NODES[n.kind];
    var t = def ? def.tier : 0;
    var g = Math.max(0.12, this.ZONE_W - t * this.ZONE_TIGHTEN);
    var c = Math.max(0.05, this.CORE_W - t * this.ZONE_TIGHTEN * 0.5);
    return { good: g * 0.5, core: c * 0.5 };
  },

  // What the sweep is sitting on RIGHT NOW: 'perfect', 'good' or ''.
  sweepGrade: function (n) {
    if (!n) return '';
    var z = this.zoneFor(n);
    var d = Math.abs(this.sweep - 0.5);
    if (d <= z.core) return 'perfect';
    if (d <= z.good) return 'good';
    return '';
  },

  // The sweep only runs while a node is actually targeted, and it restarts from
  // the left whenever the target changes -- otherwise you could park on a node,
  // wait for the cursor to drift into the middle, and tap.
  _tickSweep: function (dt, target) {
    if (!target) { this.sweepFor = null; return; }
    if (this.sweepFor !== target.uid) {
      this.sweepFor = target.uid;
      this.sweep = 0;
      this.sweepDir = 1;
    }
    var sp = dt / this.SWEEP_T * 2;
    this.sweep += sp * this.sweepDir;
    if (this.sweep >= 1) { this.sweep = 1; this.sweepDir = -1; }
    else if (this.sweep <= 0) { this.sweep = 0; this.sweepDir = 1; }
    if (this.lastHitT > 0) this.lastHitT -= dt;
  },

  // Shock rings: a pooled expanding circle at the point of contact. Six is plenty
  // -- they last a third of a second -- and the pool is built lazily so nothing
  // is allocated on a boot that never mines.
  RING_MAX: 6,
  _ring: function (x, y, r) {
    if (!this.rings) {
      this.rings = [];
      for (var i = 0; i < this.RING_MAX; i++) this.rings.push({ t: 0, x: 0, y: 0, r: 0 });
      this._ri = 0;
    }
    var o = this.rings[this._ri];
    this._ri = (this._ri + 1) % this.RING_MAX;
    o.t = 0.34; o.x = x; o.y = y; o.r = r;
  },

  // The [E] hint over a rock in reach that is not yet taken up. This is the whole
  // visible difference the engage step makes: swimming past a rock field now shows
  // a small prompt on the nearest one instead of throwing a timing bar and a
  // progress ring onto every rock you drift near.
  //
  // Nothing here allocates: the bob is a sine of the caller's clock and the width
  // comes from textWidth, same as the "too soft" note below.
  _drawPrompt: function (ctx) {
    var n = this.candidate;
    if (!n || n.dead || n === this.target) return;
    // [E] is contested and rocks lose; don't advertise a key that another system
    // owns this frame. keyOwned is set by whoever drives mining (js/integrate.js);
    // undefined means nobody is arbitrating, so the prompt shows.
    if (this.keyOwned === false) return;
    if (typeof text !== 'function' || typeof uiPanel !== 'function') return;
    var bob = Math.sin((this.time || 0) * 4) * 0.8;
    var y = n.y - n.h * 0.5 - 13 + bob;
    var label = '[E] mine';
    var tw = textWidth(ctx, label, 7) + 9;
    uiPanel(ctx, n.x - tw * 0.5, y - 10, tw, 13, 0.86, false);
    text(ctx, label, n.x, y - 7, { size: 7, color: '#ffe6b0', align: 'center' });
  },

  // THE TIMING BAR, over the node you are on. The good zone and its core are drawn
  // as bands so the target is legible at a glance, and the cursor is a bright
  // needle. It only exists while a node is targeted, which is also the only time
  // the sweep is running.
  _drawSweep: function (ctx) {
    var n = this.target;
    if (!n || n.dead) return;
    var z = this.zoneFor(n);
    var w = this.BAR_W, h = 7;
    var x = n.x - w / 2, y = n.y - n.h * 0.5 - 22;

    // OPAQUE. Translucent bands over a dark track were nearly invisible against
    // the water -- and a timing game you cannot read the target of is just a
    // random multiplier.
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = '#3d5666';
    ctx.fillRect(x, y, w, h);
    // good zone, then the perfect core inside it
    ctx.fillStyle = '#5fc97a';
    ctx.fillRect(x + (0.5 - z.good) * w, y, z.good * 2 * w, h);
    ctx.fillStyle = '#ffd66e';
    ctx.fillRect(x + (0.5 - z.core) * w, y, z.core * 2 * w, h);
    // the needle
    var cx = x + this.sweep * w;
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(cx - 1.6, y - 3, 3.2, h + 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 0.8, y - 2.4, 1.6, h + 4.8);

    // a flash on the last graded hit, so the feedback lands on the bar too
    if (this.lastHitT > 0 && this.lastHit) {
      ctx.globalAlpha = clamp(this.lastHitT / 0.5, 0, 1) * 0.5;
      ctx.fillStyle = this.lastHit === 'perfect' ? '#ffd66e' : '#a0f2b4';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.globalAlpha = 1;
    }
  },

  _drawRings: function (ctx, camX, camY) {
    if (!this.rings) return;
    ctx.strokeStyle = '#ffe6b0';
    for (var i = 0; i < this.rings.length; i++) {
      var o = this.rings[i];
      if (o.t <= 0) continue;
      var k = 1 - o.t / 0.34;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.lineWidth = 2.4 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * (0.25 + k), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // One landed blow. Returns true if the node broke.
  _land: function (n) {
    var def = this.NODES[n.kind];
    if (!this.canBreak(n)) { this._tooSoft(n); return false; }

    // THE TIMING PAYS OFF HERE. Grade is read at the instant of contact, not when
    // the swing started, so what you are aiming at is what you see on the bar.
    var grade = this.grade || '';
    this.grade = '';
    var mul = grade === 'perfect' ? this.PERFECT_MUL : (grade === 'good' ? this.GOOD_MUL : 1);
    var dmg = Math.max(1, Math.round(this.power() * mul));
    this.lastHit = grade;
    this.lastHitT = grade ? 0.5 : 0;
    n.hp -= dmg;
    n.shakeT = grade === 'perfect' ? 0.4 : 0.22;
    n.shakeA = (1.1 + dmg * 0.25) * (grade === 'perfect' ? 1.7 : 1);
    // hitL is the spark's WHOLE lifetime and the draw divides by it. These used to
    // disagree: a perfect hit set hitT to 0.3 while the draw assumed 0.16, so for
    // the first 0.14s of every perfect strike the spark's radius came out negative
    // and ctx.arc THREW -- aborting the entire scene draw mid-frame. That was the
    // "game bugs out when I mine": rewarding a well-timed swing with a burst of
    // dropped, half-painted frames, worst for exactly the player who timed it best.
    n.hitL = grade === 'perfect' ? 0.3 : 0.16;
    n.hitT = n.hitL;
    // Where the blow lands, clamped INSIDE the rock: auto-targeting can leave the
    // cursor a long way off, and the spark and chips have to come off the node.
    n.hitX = clamp((this.aimX - n.x) * 0.4, -n.w * 0.34, n.w * 0.34);
    n.hitY = clamp((this.aimY - n.y) * 0.4, -n.h * 0.34, n.h * 0.34);
    G.mining.swings++;
    this.combo++;
    this.comboT = 1.6;

    // IMPACT. A graded blow throws far more debris, kicks a shock ring, shakes the
    // scene and says so -- the whole point of a timing game is that a good hit
    // LOOKS different from a bad one.
    var chips = 5 + Math.min(4, dmg * 2) + (grade === 'perfect' ? 16 : grade === 'good' ? 8 : 0);
    this._chipBurst(n.x + n.hitX, n.y + n.hitY, def, chips);
    if (grade) {
      this._ring(n.x + n.hitX, n.y + n.hitY, grade === 'perfect' ? 26 : 16);
      this._fly(grade === 'perfect' ? 'PERFECT!' : 'good hit',
        n.x, n.y - n.h * 0.5 - 8,
        grade === 'perfect' ? '#ffd66e' : '#a0f2b4');
      if (typeof Ocean !== 'undefined' && Ocean && grade === 'perfect') {
        Ocean.shakeT = Math.max(Ocean.shakeT || 0, 0.22);
      }
      this._vibe(grade === 'perfect' ? 45 : 22);
    }
    if (def.snd === 'thump') this._snd('thump', 0.35);
    else this._snd(def.snd === 'clink' ? 'clink' : 'scrape');
    if (grade === 'perfect') this._snd('ding', 1.2);
    this._xp(def.skill, grade === 'perfect' ? 3 : (grade ? 2 : 1));

    if (n.hp <= 0) { this._break(n); return true; }
    if (n.hp <= dmg) this._snd('ding');       // one more and it goes
    return false;
  },

  _tooSoft: function (n) {
    var def = this.NODES[n.kind];
    n.shakeT = 0.14;
    n.shakeA = 0.6;
    this.note = 'your pickaxe is too soft for this';
    this.noteT = 2.2;
    this.noteX = n.x;
    // Well clear of the node: the host scene draws Otto OVER this pass, and he is
    // standing on the node when he complains, so a tighter offset lands the text
    // behind his head.
    this.noteY = n.y - n.h * 0.5 - 30;
    this._chipBurst(n.x, n.y, def, 2);
    if (this._noteGap <= 0) {
      this._noteGap = this.NOTE_GAP;
      this._snd('alarm');
      if (typeof Game !== 'undefined') {
        Game.toast('too soft for ' + def.name + ' -- you need the ' + this.PICKS[def.tier].name);
      }
      this._vibe(40);
    }
  },

  _break: function (n) {
    var def = this.NODES[n.kind];
    n.dead = true;
    n.hp = 0;
    if (this.target === n) this.target = null;
    G.mining.broken[n.uid] = G.day;            // stays broken until dawn
    G.mining.mined++;

    this._chipBurst(n.x, n.y, def, 10 + Math.min(12, n.max));   // a wreck sprays more than a log
    this._spillLoot(n, def);
    this._snd('pop', 1 + Math.min(0.5, n.max * 0.02));
    this._snd('thump', 0.45);
    if (def.key === 'crystal' || def.key === 'gold') this._snd('chime');
    this._xp(def.skill, def.xp);
    this._vibe(22);

    // Dead nodes draw nothing, but the list is capped, so retire it immediately.
    var i = this.nodes.indexOf(n);
    if (i >= 0) { this._forget(n); this.nodes.splice(i, 1); }
    if (typeof Game !== 'undefined') Game.save();
  },

  // A little extra on a long unbroken run of swings; luck buffs feed in here too.
  _luck: function () {
    var l = 1 + Math.min(0.25, this.combo * 0.02);
    if (typeof Craft !== 'undefined' && Craft.luckMul) {
      var m = Craft.luckMul();
      if (typeof m === 'number' && isFinite(m) && m > 0) l *= m;
    }
    return l;
  },

  _spillLoot: function (n, def) {
    var luck = this._luck(), i, e, cnt, ang, sp;
    for (i = 0; i < def.loot.length; i++) {
      e = def.loot[i];
      if (e.chance < 1 && rand() > e.chance * luck) continue;
      cnt = irand(e.min, e.max);
      if (cnt <= 0) continue;
      // One drop per unit up to three, then it stacks -- three is enough to read
      // as a burst without flooding the pool from a wreck.
      var drops = cnt > 3 ? 3 : cnt;
      var per = Math.floor(cnt / drops), extra = cnt - per * drops, j;
      for (j = 0; j < drops; j++) {
        ang = -TAU * 0.25 + rand(-0.9, 0.9);
        sp = rand(26, 54);
        this._drop(e.res, per + (j === 0 ? extra : 0), n.x + rand(-4, 4), n.y + rand(-4, 4),
          Math.cos(ang) * sp, Math.sin(ang) * sp);
      }
    }
  },

  _freeDrop: function () {
    var i, d, oldest = null, ot = 1e9;
    for (i = 0; i < this.loot.length; i++) {
      d = this.loot[i];
      if (!d.live) return d;
      if (d.t < ot) { ot = d.t; oldest = d; }   // steal the one about to expire
    }
    return oldest;
  },
  _drop: function (res, n, x, y, vx, vy) {
    if (n <= 0) return;
    var d = this._freeDrop();
    if (!d) return;
    d.live = true;
    d.res = res;
    d.n = n;
    d.x = x; d.y = y;
    d.vx = vx; d.vy = vy;
    d.t = this.LOOT_LIFE;
    d.sp = rand(TAU);
    d.vac = 0;
  },

  _freeChip: function () {
    var i, c, oldest = this.chips[0], ot = 1e9;
    for (i = 0; i < this.chips.length; i++) {
      c = this.chips[i];
      if (c.t <= 0) return c;
      if (c.t < ot) { ot = c.t; oldest = c; }
    }
    return oldest;
  },
  _chipBurst: function (x, y, def, n) {
    var i, c, ang, sp;
    for (i = 0; i < n; i++) {
      c = this._freeChip();
      if (!c) return;
      ang = rand(TAU);
      sp = rand(24, 88);
      c.t = rand(0.3, 0.75);
      c.x = x; c.y = y;
      c.vx = Math.cos(ang) * sp;
      c.vy = Math.sin(ang) * sp - 12;
      // 2 to 6 device texels, on the grid: below that the debris disappears
      // into the backdrop at this density.
      c.sz = PIX * (2 + (Math.random() * 3 | 0) * 2);
      c.tone = def.chips[i % def.chips.length];
    }
  },

  _fly: function (txt, x, y, col) {
    var i, f = null;
    for (i = 0; i < this.flys.length; i++) {
      if (!this.flys[i].live) { f = this.flys[i]; break; }
      if (!f || this.flys[i].t < f.t) f = this.flys[i];
    }
    if (!f) return;
    f.live = true;
    f.txt = txt;
    f.x = x; f.y = y;
    f.t = 1.1;
    f.col = col || '#ffe66e';
  },

  _collect: function (d) {
    this.give(d.res, d.n);
    if (d.res === 'crystal') G.mining.gems += d.n;
    // Lifted well above the drop: a collection happens inside Otto's silhouette
    // and the host draws him on top of this pass.
    this._fly('+' + d.n + ' ' + this.resName(d.res), d.x, d.y - 22,
      d.res === 'crystal' ? '#5ad2f0' : (d.res === 'ingot' || d.res === 'ore' ? '#c9d4dc' : '#ffe66e'));
    d.live = false;
    this._snd('pop', d.res === 'crystal' ? 1.5 : 1.2);
  },

  // -------------------------------------------------------------- update ------
  // px, py = Otto's centre in world units. cam is optional; when omitted the
  // camera from the last draw()/setCam() is reused.
  update: function (dt, px, py, cam) {
    if (!this.ensure()) return;
    // Both a wiring layer and the scene may end up ticking us. Game.time
    // advances exactly once per frame, so first call in a frame wins.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (typeof dt !== 'number' || !isFinite(dt)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;                  // a tab-switch must not teleport loot
    if (cam) { this.cam.x = cam.x || 0; this.cam.y = cam.y || 0; }
    if (typeof px !== 'number' || !isFinite(px)) px = this.cam.x + W * 0.5 / (this.camZoom || 1);
    if (typeof py !== 'number' || !isFinite(py)) py = this.cam.y + H * 0.5 / (this.camZoom || 1);

    if (G.mining.lastDay < G.day) this.newDay();

    this.time += dt;
    if (this.rings) {
      for (var _r = 0; _r < this.rings.length; _r++) {
        if (this.rings[_r].t > 0) this.rings[_r].t -= dt;
      }
    }
    if (this._noteGap > 0) this._noteGap -= dt;
    if (this.noteT > 0) this.noteT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

    // ---- input ----
    var dir = this.facing > 0 ? 1 : (this.facing < 0 ? -1 : 0);
    if (this.pollInput && typeof Input !== 'undefined') {
      this.holding = !!(Input.mouse.down || Input.keys.KeyX);
      var iz = this.camZoom > 0 ? 1 / this.camZoom : 1;
      this.aimX = this.cam.x + Input.mouse.x * iz;
      this.aimY = this.cam.y + Input.mouse.y * iz;
      if (Input.keys.KeyD || Input.keys.ArrowRight) dir = 1;
      else if (Input.keys.KeyA || Input.keys.ArrowLeft) dir = -1;
    }
    if (typeof Game !== 'undefined' && (Game.fadeDir !== 0 || Game.helpOpen)) this.holding = false;

    // ---- aim + swing state machine ----
    // aim() no longer picks the target, only the CANDIDATE: what an [E] press
    // would take up. The engaged target survives until it dies or Otto swims out
    // of reach, so the bar never hops to a neighbouring rock mid-swing.
    this.candidate = this.aim(px, py, dir, this.aimX, this.aimY);
    // A click on a rock IS an interact, so the pointer still works without a
    // second key: the first press takes the rock up rather than being swallowed
    // as a swing on nothing. Computed after aim() so it acts on THIS frame's
    // candidate, not last frame's.
    if (this.pollInput && typeof Input !== 'undefined' &&
        !this.target && Input.mouse.down && this.candidate) {
      this.engage(this.candidate);
    }
    if (this.target && (this.target.dead || !this._within(this.target, px, py, this.REACH + 10))) {
      this.disengage();
    }
    if (this.target) this._engagedT = (this._engagedT || 0) + dt;
    this._tickSweep(dt, this.target);

    if (this.swinging) {
      this.swingT += dt;
      var f = this.swingT / this.SWING_T;
      if (!this.hitDone && f >= this.HIT_AT) {
        this.hitDone = true;
        // Re-check the target at the moment of impact: he may have drifted off it.
        var hitN = this.target && this._within(this.target, px, py, this.REACH + 10) ? this.target : null;
        // graded HERE, at contact, so what the bar shows is what the blow gets
        this.grade = hitN ? this.sweepGrade(hitN) : '';
        if (hitN) this._land(hitN);
        else this._snd('bubble');            // a whiff through open water
      }
      if (this.swingT >= this.SWING_T) {
        this.swinging = false;
        this.swingT = 0;
        // Hold to keep going, which is the whole feel of mining.
        if (this.holding && this.target) this._startSwing();
        else this.busy = false;
      }
    } else if (this.holding && this.target) {
      this._startSwing();     // the too-soft complaint lands with the blow, in _land
    } else {
      this.busy = false;
    }

    // ---- node cosmetics ----
    var i, n;
    for (i = 0; i < this.nodes.length; i++) {
      n = this.nodes[i];
      if (n.shakeT > 0) n.shakeT -= dt;
      if (n.hitT > 0) n.hitT -= dt;
    }

    // ---- drifting loot + vacuum ----
    // Both drags are frame-rate independent, and hoisted out of the loop: pow()
    // forty-eight times a frame for two distinct values is pure waste.
    var dragFree = Math.pow(this.DRIFT_DRAG, dt * 60);
    var dragVac = Math.pow(0.985, dt * 60);
    var d, dx, dy, dist, pull, drag;
    for (i = 0; i < this.loot.length; i++) {
      d = this.loot[i];
      if (!d.live) continue;
      d.t -= dt;
      if (d.t <= 0) { d.live = false; continue; }

      dx = px - d.x; dy = py - d.y;
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.GRAB_R) { this._collect(d); continue; }

      if (dist < this.VAC_R) {
        // Ramps hard as it closes, so the last stretch snaps in and the pickup
        // reads as automatic rather than as a chase.
        d.vac = 1;
        pull = this.VAC_ACC * (0.35 + 0.65 * (1 - dist / this.VAC_R));
        d.vx += (dx / dist) * pull * dt;
        d.vy += (dy / dist) * pull * dt;
      } else {
        d.vac = 0;
        d.vy += 14 * dt;                     // heavier than water, barely
        d.vx += Math.sin(this.time * 1.7 + d.sp) * 5 * dt;
      }
      drag = d.vac ? dragVac : dragFree;
      d.vx *= drag;
      d.vy *= drag;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.sp += dt * (d.vac ? 5 : 1.6);
    }

    // ---- chips ----
    var c;
    for (i = 0; i < this.chips.length; i++) {
      c = this.chips[i];
      if (c.t <= 0) continue;
      c.t -= dt;
      c.vy += 66 * dt;
      c.vx *= 0.94;
      c.vy *= 0.96;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }

    // ---- fly-ups ----
    var fl;
    for (i = 0; i < this.flys.length; i++) {
      fl = this.flys[i];
      if (!fl.live) continue;
      fl.t -= dt;
      fl.y -= 15 * dt;
      if (fl.t <= 0) fl.live = false;
    }
  },

  setCam: function (camX, camY) { this.cam.x = camX || 0; this.cam.y = camY || 0; },

  // ---------------------------------------------------------------- draw ------
  // WORLD SPACE. The caller has already applied translate(-camX, -camY), exactly
  // as integrate.js does for Stock.draw, NPCs.drawWorld and Craft.drawDock, so
  // everything here is drawn at its world coordinate and camX/camY are used ONLY
  // to cull. Use drawScreen() from a scene that has not translated yet.
  draw: function (ctx, camX, camY) {
    if (!this.ensure()) return;
    camX = camX || 0;
    camY = camY || 0;
    this.cam.x = camX;
    this.cam.y = camY;

    // one culling box, in world units, reused by every pass below
    var x0 = camX - 60, x1 = camX + W + 60, y0 = camY - 60, y1 = camY + H + 60;
    var i, n;
    for (i = 0; i < this.nodes.length; i++) {
      n = this.nodes[i];
      if (n.dead) continue;
      if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
      this._drawNode(ctx, n, n.x, n.y);
    }

    n = this.target;
    if (n && !n.dead && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) {
      this._drawRing(ctx, n, n.x, n.y);
    }

    this._drawRings(ctx, camX, camY);
    this._drawPrompt(ctx);
    this._drawSweep(ctx);
    this._drawChips(ctx, camX, camY);
    this._drawLoot(ctx, camX, camY);
    this._drawFlys(ctx, camX, camY);

    if (this.noteT > 0 && this.noteX > x0 - 40 && this.noteX < x1 + 40 &&
        this.noteY > y0 && this.noteY < y1) {
      ctx.save();
      ctx.globalAlpha = this.noteT > 0.4 ? 1 : this.noteT / 0.4;
      var tw = textWidth(ctx, this.note, 7) + 10;
      uiPanel(ctx, this.noteX - tw * 0.5, this.noteY - 11, tw, 13, 0.9, false);
      text(ctx, this.note, this.noteX, this.noteY - 8, { size: 7, color: '#ff5a4a', align: 'center' });
      ctx.restore();
    }
  },

  // For a caller that has NOT offset the canvas yet (Stock ships the same pair).
  drawScreen: function (ctx, camX, camY) {
    camX = camX || 0;
    camY = camY || 0;
    ctx.save();
    ctx.translate(-Math.round(camX * DPX) / DPX, -Math.round(camY * DPX) / DPX);
    this.draw(ctx, camX, camY);
    ctx.restore();
  },

  _drawNode: function (ctx, n, sx, sy) {
    var def = this.NODES[n.kind];
    var p = 1 - n.hp / n.max;
    var s = 1 - 0.14 * p;
    var ox = 0, oy = 0;
    if (n.shakeT > 0) {
      var k = n.shakeT / 0.22;
      ox = Math.sin(n.shakeT * 74) * n.shakeA * k;
      oy = Math.cos(n.shakeT * 61) * n.shakeA * 0.5 * k;
    }
    var w = n.w * s, h = n.h * s;

    ctx.save();
    ctx.translate(Math.round((sx + ox) * DPX) / DPX, Math.round((sy + oy) * DPX) / DPX);

    var img = (typeof ASSETS !== 'undefined') ? ASSETS[def.art] : null;
    if (img && img.width) drawAC(ctx, def.art, 0, 0, w, h, n.flip);
    else this._nodeGlyph(ctx, def, w, h);

    // Cracks earn their way in as the node gives: one line, then two, then three.
    if (p > 0.24 && n.cr) {
      var lines = p > 0.62 ? 3 : (p > 0.42 ? 2 : 1), i, c;
      ctx.strokeStyle = 'rgba(24,18,14,0.6)';
      ctx.lineWidth = PIX * 2;
      ctx.beginPath();
      for (i = 0; i < lines; i++) {
        c = n.cr[i];
        ctx.moveTo(c.x1 * w, c.y1 * h);
        ctx.lineTo(c.x2 * w, c.y2 * h);
      }
      ctx.stroke();
    }

    // Impact spark: a bright ring at the strike point, which is cheap and reads
    // as contact without needing to tint the sprite.
    if (n.hitT > 0) {
      // normalised by the spark's own lifetime (n.hitL), never a hard-coded one --
      // and the radius is clamped anyway, because ctx.arc on a negative radius
      // does not degrade, it THROWS, and one throw kills the whole frame.
      var hk = clamp(n.hitT / (n.hitL || 0.16), 0, 1);
      ctx.globalAlpha = hk;
      ctx.strokeStyle = '#ffe66e';
      ctx.lineWidth = PIX * 2;
      ctx.beginPath();
      ctx.arc(n.hitX, n.hitY, Math.max(0.1, 2 + (1 - hk) * 5), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  // Fallback rock when the art is missing: flat shapes only, one fillStyle each.
  _nodeGlyph: function (ctx, def, w, h) {
    var col = this.CHIP_TONES[def.chips[0]];
    ctx.fillStyle = '#3a2c22';
    ctx.fillRect(-w * 0.5, -h * 0.5 + h * 0.15, w, h * 0.85);
    ctx.fillStyle = col;
    ctx.fillRect(-w * 0.42, -h * 0.36, w * 0.84, h * 0.62);
    ctx.fillStyle = this.CHIP_TONES[def.chips[1]];
    ctx.fillRect(-w * 0.24, -h * 0.28, w * 0.34, h * 0.26);
  },

  _drawRing: function (ctx, n, sx, sy) {
    var r = Math.max(n.w, n.h) * 0.5 + 4;
    var p = 1 - n.hp / n.max;
    var soft = !this.canBreak(n);
    ctx.save();
    ctx.translate(Math.round(sx * DPX) / DPX, Math.round(sy * DPX) / DPX);
    ctx.lineWidth = PIX * 2;
    ctx.strokeStyle = soft ? 'rgba(232,67,76,0.55)' : 'rgba(255,255,255,0.30)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    if (!soft && p > 0) {
      ctx.strokeStyle = '#ffe66e';
      ctx.lineWidth = PIX * 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, -TAU * 0.25, -TAU * 0.25 + TAU * p);
      ctx.stroke();
    }
    ctx.restore();
  },

  // Batched by tone: fillStyle is set at most once per palette entry in use, and
  // per-chip variation is carried on globalAlpha. Never build a colour in here.
  _drawChips: function (ctx, camX, camY) {
    var tones = this.CHIP_TONES, ti, i, c, any, alive = 0;
    for (i = 0; i < this.chips.length; i++) if (this.chips[i].t > 0) { alive = 1; break; }
    if (!alive) return;                    // the common case: skip the tone sweep
    var x0 = camX - 20, x1 = camX + W + 20, y0 = camY - 20, y1 = camY + H + 20;
    ctx.save();
    for (ti = 0; ti < tones.length; ti++) {
      any = false;
      for (i = 0; i < this.chips.length; i++) {
        c = this.chips[i];
        if (c.t <= 0 || c.tone !== ti) continue;
        if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
        if (!any) { ctx.fillStyle = tones[ti]; any = true; }   // one set per tone
        ctx.globalAlpha = c.t > 0.35 ? 1 : c.t / 0.35;
        ctx.fillRect(Math.round(c.x * DPX) / DPX, Math.round(c.y * DPX) / DPX, c.sz, c.sz);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },

  _drawLoot: function (ctx, camX, camY) {
    var i, d, def, s, bob;
    var x0 = camX - 20, x1 = camX + W + 20, y0 = camY - 20, y1 = camY + H + 20;
    ctx.save();
    for (i = 0; i < this.loot.length; i++) {
      d = this.loot[i];
      if (!d.live) continue;
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      def = this.resDef(d.res);
      bob = Math.sin(d.sp) * (d.vac ? 0.6 : 1.4);
      s = d.vac ? 9.5 : 8.5;                  // a touch bigger once it is homing
      ctx.globalAlpha = d.t < 1.2 ? d.t / 1.2 : 1;
      ctx.save();
      ctx.translate(Math.round(d.x * DPX) / DPX, Math.round((d.y + bob) * DPX) / DPX);
      if (def && typeof ASSETS !== 'undefined' && ASSETS[def.art] && ASSETS[def.art].width) {
        drawAC(ctx, def.art, 0, 0, s);
      } else {
        ctx.fillStyle = '#c9d4dc';
        ctx.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
      }
      ctx.restore();
      if (d.n > 1) text(ctx, 'x' + d.n, d.x + 4, d.y + 1, { size: 6, color: '#f6e8c9' });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },

  _drawFlys: function (ctx, camX, camY) {
    var i, f;
    var x0 = camX - 60, x1 = camX + W + 60, y0 = camY - 20, y1 = camY + H + 20;
    ctx.save();
    for (i = 0; i < this.flys.length; i++) {
      f = this.flys[i];
      if (!f.live) continue;
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      ctx.globalAlpha = f.t > 0.5 ? 1 : f.t / 0.5;
      text(ctx, f.txt, f.x, f.y, { size: 7, color: f.col, align: 'center' });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },

  // Small pickaxe glyph for hotbars, shop rows and gear panels. No pickaxe art
  // exists in the manifest, so this is the icon. box = longest side in units.
  drawPickIcon: function (ctx, cx, cy, box) {
    if (box === undefined) box = 12;
    var s = box / 12;
    ctx.save();
    ctx.translate(Math.round(cx * DPX) / DPX, Math.round(cy * DPX) / DPX);
    ctx.fillStyle = '#6d4526';                       // handle, angled by stepping it
    ctx.fillRect(-1 * s, -4 * s, 2 * s, 5 * s);
    ctx.fillRect(0 * s, 1 * s, 2 * s, 5 * s);
    ctx.fillStyle = '#8f9aa4';                       // head: a swept arc, not a bar
    ctx.fillRect(-2 * s, -6 * s, 4 * s, 2 * s);
    ctx.fillRect(-5 * s, -5 * s, 3 * s, 2 * s);
    ctx.fillRect(2 * s, -5 * s, 3 * s, 2 * s);
    ctx.fillRect(-6 * s, -4 * s, 1 * s, 2 * s);      // the two tips drop away
    ctx.fillRect(5 * s, -4 * s, 1 * s, 2 * s);
    ctx.fillStyle = '#c9d4dc';                       // top highlight
    ctx.fillRect(-2 * s, -6 * s, 4 * s, PIX * 2);
    ctx.restore();
  },

  // A one-line status the scene can put in its own HUD strip.
  hudLine: function () {
    if (!this.ensure()) return '';
    var t = this.target;
    if (t) return this.label(t);
    return this.pickDef().name + '  ' + this.resTotal() + ' hauled';
  },

  // -------------------------------------------------------------- helpers -----
  // SND is a no-op when muted or unavailable, but it may be absent entirely if
  // audio.js failed to load, so every call goes through here.
  _snd: function (name, arg) {
    if (typeof SND === 'undefined' || !SND || typeof SND[name] !== 'function') return;
    if (arg === undefined) SND[name]();
    else SND[name](arg);
  },
  // The xp hook is owned by the integrator, so never trust its type.
  _xp: function (skill, n) {
    if (typeof this.xp === 'function') this.xp(skill, n);
  },
  _vibe: function (ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { } }
  }
};
