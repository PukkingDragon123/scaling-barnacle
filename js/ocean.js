// ---- THE OPEN OCEAN: a free-swimming side-scrolling scene ---------------------
//
// Otto steps off the planks and swims. This is a full scene object
// (customCursor / enter / update / draw), so `Game.go(Ocean, { from: 'dock' })`
// is all it takes to get here, and Game.updateFade drives the rest.
//
// The whole point is the MOVEMENT. Thrust accelerates, water drags, and a little
// momentum survives every frame so the water feels buoyant instead of twitchy.
// On top of that sit two verbs: a DASH (shift, or a double-tapped direction) and
// a SPIN ROLL (space) that is both the show-off move and the dodge. Everything
// else in this file -- the parallax, the caustics, the air meter -- exists to
// make that movement read.
//
// FRAME BUDGET. The backing store is 1920x1080 with high-quality smoothing, so
// the two expensive mistakes are guarded against structurally:
//   * Nothing evaluates a gradient or filters a large source image per frame.
//     The blurred far layer, the caustic strip, the god-ray strip, the mid-band
//     tile and every silhouette are baked ONCE into caches and blitted.
//   * No batch builds a colour string inside its loop: particles set fillStyle
//     once per bucket and vary globalAlpha.
// Particles live in preallocated pools that are recycled, never grown, and the
// light layers are skipped outright once they are off-band (which is most of the
// time, because they only exist near the surface). There is also a small
// adaptive-quality watchdog: on a device that cannot hold the frame, the ray
// blit and half the motes drop out and come back when it recovers.
'use strict';

const Ocean = {
  // ---- scene contract ---------------------------------------------------------
  // Swimming is entirely keyboard/touch driven -- there is no pointer verb here,
  // so claiming customCursor means Game.drawCursor leaves the screen clean.
  customCursor: true,

  // ---- movement tuning --------------------------------------------------------
  // The drag numbers are per-second survival factors used as pow(f, dt), so
  // terminal speed is ACC / -ln(f): 340 / 3.0 ~= 113 u/s cruising, and coasting
  // keeps half its speed for ~0.38s, which is the "buoyant" part.
  ACC: 340,
  DRAG_THRUST: 0.05,
  DRAG_COAST: 0.16,
  DRAG_DASH: 0.55,
  BUOY: 34,               // gentle upward drift: descending has to be worked for
  GRAV_AIR: 300,          // once he breaks the surface he is a thrown otter
  MAX_SPEED: 190,
  // DASH_SPEED is the number the dash actually reaches: the kick starts it at
  // ~0.62 of that and DASH_ACC carries it the rest of the way inside DASH_T.
  DASH_SPEED: 300, DASH_ACC: 620, DASH_T: 0.26, DASH_CD: 0.62, DASH_AIR: 1.6,
  ROLL_SPEED: 265, ROLL_END: 135, ROLL_T: 0.52, ROLL_CD: 0.8, ROLL_INV: 0.62, ROLL_AIR: 1.1,
  DTAP: 0.26,             // double-tap window for the dash
  SURF_HOLD: 0.9,         // how long UP must be held at the top to climb out
  BANK_MAX: 1.02,         // how far the sprite is allowed to pitch into a turn
  IFRAME: 1.1,
  HURT_T: 0.7,
  KNOCK: 210,

  // ---- world tuning -----------------------------------------------------------
  CW: 512, CH: 320,       // chunk size in world units
  CHUNK_CAP: 96,          // cached chunks; eviction is free, they regenerate
  DEEP: 2400,             // world y where the palette bottoms out
  LIGHT_END: 520,         // world y where surface light (rays, caustics) is gone
  FAR_W: 648,             // on-screen width of one far-layer copy (1.35 screens)
  MID_H: 60, MID_GAP: 560,
  // The layer speeds, and the whole depth read: far 0.16, mid 0.55, the props
  // that sit behind Otto 0.92, Otto and anything gameplay places 1.0, and the
  // near-field props 1.1 -- so the foreground whips past faster than he swims.
  PAR_FAR: 0.16, PAR_MID: 0.55, PAR_BACK: 0.92, PAR_FRONT: 1.1,
  PX_PER_M: 12,           // matches the dive's depth readout

  // ---- pool sizes -------------------------------------------------------------
  BUB_MAX: 96, MOTE_MAX: 72, RING_MAX: 10, SPILL_MAX: 8, SIL_MAX: 3,

  // ---- animation table --------------------------------------------------------
  // `box` is the longest side of the sprite in logical units, so a wide cruise
  // frame and a tall curled-up hurt frame both land at a sane size. Frame lists
  // are read straight off the 4x4 sheets described in the manifest.
  ANIM: {
    cruise: { f: ['oswim_0', 'oswim_1', 'oswim_2', 'oswim_3'], fps: 6.5, box: 54 },
    dive:   { f: ['oswim_12', 'oswim_13', 'oswim_14', 'oswim_15'], fps: 7, box: 54 },
    dash:   { f: ['oswim_4', 'oswim_5', 'oswim_6', 'oswim_7'], fps: 15, box: 58 },
    roll:   { f: ['oswim_8', 'oswim_9', 'oswim_10', 'oswim_11'], fps: 0, box: 52 },
    hurt:   { f: ['ohurt_0', 'ohurt_1', 'ohurt_2', 'ohurt_3', 'ohurt_4', 'ohurt_5', 'ohurt_6', 'ohurt_7'], fps: 0, box: 46 },
    limp:   { f: ['ohurt_8', 'ohurt_9', 'ohurt_10', 'ohurt_11', 'ohurt_12', 'ohurt_13', 'ohurt_14', 'ohurt_15'], fps: 0, box: 50 },
    mine:   { f: ['opick_0', 'opick_1', 'opick_2', 'opick_3'], fps: 8, box: 50 },
  },

  // ---- live state (all in memory; only the little that must persist is on G) ---
  px: 0, py: 0, vx: 0, vy: 0,
  camX: 0, camY: 0,
  face: 1, bank: 0, spin: 0,
  ix: 0, iy: 0, nx: 0, ny: 0, inMag: 0,
  anim: 'cruise', animFrame: 'oswim_0', animPrev: 'oswim_0', animMix: 1,
  animBox: 54, animT: 0,
  air: 0, airMax: 0, airBeepT: 0, drownT: 0,
  bag: null, bagCount: 0, bagPulse: 0,
  dashT: 0, dashCD: 0, ddx: 1, ddy: 0,
  rollT: 0, rollCD: 0, rdx: 1, rdy: 0,
  iframe: 0, hurtT: 0, mineT: 0,
  leaving: 0, forcedExit: false, surfT: 0,
  over: false, overT: 0,
  flash: 0, shakeT: 0, splashT: 0,
  msg: '', msgT: 0,
  time: 0, quality: 1,
  _bdCv: null, _bdCtx: null,
  _stamp: -1, _installed: false, _init: false,
  _ft: 0.016, _qt: 0,
  _prevDir: null, _tapT: null, _prevDash: false,
  bubbles: null, motes: null, rings: null, spills: null, sils: null,
  _chunks: null, _order: null,
  _farCv: null, _midCv: null, _caCv: null, _rayCv: null, _silCv: null,
  _farW: 0, _farH: 0, _midW: 0, _caW: 0, _caH: 0, _rayW: 0, _rayH: 0,
  SIL_W: 220,             // canonical silhouette bake width; blits scale from it

  // ---- palette ----------------------------------------------------------------
  // Depth stops, lerped per frame. The whole scene reads off these so the water,
  // the haze and the props can never disagree about how deep it is.
  STOPS: [
    [0, [74, 178, 200]],
    [260, [42, 138, 178]],
    [700, [26, 92, 140]],
    [1400, [16, 56, 100]],
    [2400, [9, 30, 62]],
    [4600, [4, 14, 34]],
  ],

  // =============================================================================
  // SAVE STATE
  // =============================================================================
  // G.ocean is a brand new top-level key, and Game.load only deep-merges five
  // (storage, gear, stats, flags, decor) -- everything else is taken wholesale
  // from whatever the save happened to contain. So every field is re-checked and
  // re-typed here, and ensure() runs at the top of EVERY public entry point.
  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    let s = G.ocean;
    if (!s || typeof s !== 'object') s = G.ocean = {};
    // The seed is the whole world: once chosen it must never change, or the same
    // stretch of water would look different tomorrow.
    if (typeof s.seed !== 'number' || !isFinite(s.seed) || (s.seed | 0) === 0) s.seed = irand(1, 0x7ffffff);
    s.seed = s.seed | 0;
    if (typeof s.x !== 'number' || !isFinite(s.x)) s.x = 0;
    s.x = clamp(s.x, -2e6, 2e6);
    if (typeof s.deepest !== 'number' || !isFinite(s.deepest)) s.deepest = 0;
    s.deepest = clamp(s.deepest, 0, 1e6);
    if (typeof s.trips !== 'number' || !isFinite(s.trips)) s.trips = 0;
    if (typeof s.today !== 'number' || !isFinite(s.today)) s.today = 0;
    if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day;
    if (s.lastDay > G.day) s.lastDay = G.day;   // hand-edited save or a new game
    if (!this._init) this._initPools();
    return true;
  },

  // The nightly pass. Two independent code paths increment G.day and only the
  // sleep path fires the per-system newDay hooks, so this is written as an
  // idempotent catch-up driven off a persisted lastDay, exactly like Farm/Stock.
  newDay() {
    if (!this.ensure()) return;
    const s = G.ocean;
    if (s.lastDay >= G.day) return;
    let guard = 0;
    while (s.lastDay < G.day && guard++ < 30) { s.today = 0; s.lastDay++; }
    s.lastDay = G.day;
    this._save();
  },

  _save() { if (typeof Game !== 'undefined' && Game.save) Game.save(); },

  // =============================================================================
  // POOLS
  // =============================================================================
  _initPools() {
    if (this._init) return;
    this._init = true;
    const mk = (n, extra) => {
      const a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1 }, extra);
      return a;
    };
    // `t` <= 0 means free for everything except motes, which drift forever.
    this.bubbles = mk(this.BUB_MAX, { r: 1, wob: 0, sp: 1, air: false });
    this.rings = mk(this.RING_MAX, { r: 2, vr: 90, w: 1.4 });
    this.spills = mk(this.SPILL_MAX, { key: '', rot: 0, vr: 0 });
    this.motes = mk(this.MOTE_MAX, { r: 1, ph: 0, sp: 1, glow: false });
    this.bag = {};
    this._chunks = new Map();
    this._order = [];
    this._prevDir = [false, false, false, false];
    this._tapT = [0, 0, 0, 0];
    this.sils = new Array(this.SIL_MAX);
    for (let i = 0; i < this.SIL_MAX; i++) this.sils[i] = { art: '', fx: 0, fy: 0, vx: 0, w: 120, ph: 0 };
  },

  _take(pool) {
    let oldest = 0, best = 1e9;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].t <= 0) return pool[i];
      if (pool[i].t < best) { best = pool[i].t; oldest = i; }
    }
    return pool[oldest];
  },

  _seedMotes() {
    // Motes are world-space so they hold still relative to the water, and are
    // recycled across the camera rect instead of being spawned and destroyed.
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.x = this.camX + rand(-40, W + 40);
      m.y = this.camY + rand(-40, H + 40);
      m.r = rand(0.5, 1.9);
      m.ph = rand(TAU);
      m.sp = rand(0.3, 1.2);
      m.vx = rand(-5, 5); m.vy = rand(-9, -1);
      m.glow = Math.random() < 0.28;
      m.t = 1; m.life = 1;
    }
  },

  _seedSils() {
    // The far layer's drifting shapes: something big, out there, minding its own
    // business. Deterministic art choice per slot; the drift is not persisted.
    const ART = ['tame_whale_3', 'tame_ray_3', 'tame_narwhal_3'];
    const WID = [176, 122, 142];
    for (let i = 0; i < this.sils.length; i++) {
      const s = this.sils[i];
      s.art = ART[i % ART.length];
      s.w = WID[i % WID.length];
      s.fx = this.camX * 0.35 + rand(-400, W + 400);
      s.fy = this.camY * 0.35 + rand(-120, H + 160);
      s.vx = (Math.random() < 0.5 ? -1 : 1) * rand(5, 13);
      s.ph = rand(TAU);
    }
  },

  // =============================================================================
  // SCENE: ENTER
  // =============================================================================
  enter(arg) {
    this.install();
    if (!this.ensure()) return;
    const s = G.ocean;
    this.time = 0;
    // Coming off the dock he drops in where he last left the water, so the sea
    // has continuity, but always just under the surface.
    this.px = (arg && typeof arg.x === 'number' && isFinite(arg.x)) ? arg.x : s.x;
    this.py = (arg && typeof arg.y === 'number' && isFinite(arg.y)) ? arg.y : 16;
    this.vx = 0; this.vy = 34;
    this.face = 1; this.bank = 0.35; this.spin = 0;
    this.camX = this.px - W * 0.5;
    this.camY = this.py - H * 0.42;
    const tank = TANKS[Math.floor(clamp(G.gear.tank || 0, 0, TANKS.length - 1))];
    // Open water is a longer errand than the piling, so the same tank goes
    // further out here -- and the surface is always a gulp of air away.
    this.airMax = Math.max(20, tank.air * 1.6);
    this.air = this.airMax;
    this.airBeepT = 0; this.drownT = 0;
    this.bag = {}; this.bagCount = 0; this.bagPulse = 0;
    this.dashT = 0; this.dashCD = 0; this.rollT = 0; this.rollCD = 0;
    this.iframe = 0; this.hurtT = 0; this.mineT = 0;
    this.leaving = 0; this.forcedExit = false; this.surfT = 0;
    this.over = false; this.overT = 0;
    this.flash = 0; this.shakeT = 0; this.splashT = 0;
    this.msg = ''; this.msgT = 0;
    this.anim = 'cruise'; this.animFrame = 'oswim_0';
    this.animPrev = 'oswim_0'; this.animMix = 1; this.animT = 0;
    for (let i = 0; i < this.bubbles.length; i++) this.bubbles[i].t = 0;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].t = 0;
    for (let i = 0; i < this.spills.length; i++) this.spills[i].t = 0;
    this._prevDash = false;
    for (let i = 0; i < 4; i++) { this._prevDir[i] = false; this._tapT[i] = 0; }
    this._seedMotes();
    this._seedSils();
    s.trips++; s.today++;
    if (typeof SND !== 'undefined') { SND.setScene('dive'); SND.splash(); }
    this._puff(this.px, this.py, 12, 60);
    this._ring(this.px, 2, 3, 160);
    if (!G.flags.seenOcean) {
      G.flags.seenOcean = true;
      Game.toast(TouchUI.enabled
        ? 'Open water! Pads swim  --  paw: dash  --  swirl: spin roll'
        : 'Open water! WASD/arrows swim  --  [Shift] dash  --  [Space] spin roll');
      Game.toast('The spin roll dodges anything and carries you a long way.');
      Game.toast('Air runs out down deep -- surface to breathe, or hold UP up top to climb out.');
    }
    this._save();
  },

  // =============================================================================
  // QUERIES (public: other systems read the swim through these)
  // =============================================================================
  depth() { return Math.max(0, this.py) / this.PX_PER_M; },            // metres down
  depthFrac() { return clamp(Math.max(0, this.py) / this.DEEP, 0, 1); },
  speed() { return Math.sqrt(this.vx * this.vx + this.vy * this.vy); },
  screenX(x) { return x - this.camX; },
  screenY(y) { return y - this.camY; },
  rolling() { return this.rollT > 0; },
  invulnerable() { return this.iframe > 0 || this.rollT > 0 || this.over; },
  bagCap() {
    if (typeof G === 'undefined' || !G) return 8;
    return BAGS[Math.floor(clamp(G.gear.bag || 0, 0, BAGS.length - 1))].cap;
  },
  bagValue() {
    let v = 0;
    for (const k in this.bag) {
      if (!Object.prototype.hasOwnProperty.call(this.bag, k)) continue;
      const it = Object.prototype.hasOwnProperty.call(ITEMS, k) ? ITEMS[k] : null;
      v += (it ? it.price : 4) * this.bag[k];
    }
    return v;
  },
  // circle test against Otto, for anything that wants to hit or be picked up
  hits(x, y, r) {
    const dx = x - this.px, dy = y - this.py;
    const rr = (r || 0) + 11;
    return dx * dx + dy * dy <= rr * rr;
  },
  // shove him: an impulse in world units per second
  push(ax, ay) { this.vx += ax || 0; this.vy += ay || 0; },

  msgSet(m, t) { this.msg = m; this.msgT = t === undefined ? 2.2 : t; },

  // Craft's buffs are declared as multipliers and read through one function each.
  _airMul() {
    if (typeof Craft !== 'undefined' && Craft.airMul) {
      const m = Craft.airMul();
      if (typeof m === 'number' && isFinite(m) && m > 0) return clamp(m, 0.4, 2);
    }
    return 1;
  },
  _speedMul() {
    if (typeof Craft !== 'undefined' && Craft.speedMul) {
      const m = Craft.speedMul();
      if (typeof m === 'number' && isFinite(m) && m > 0) return clamp(m, 0.6, 1.8);
    }
    return 1;
  },
  _defMul() {
    if (typeof Craft !== 'undefined' && Craft.defMul) {
      const m = Craft.defMul();
      if (typeof m === 'number' && isFinite(m) && m > 0) return clamp(m, 0.3, 2);
    }
    return 1;
  },

  // =============================================================================
  // CARRYING
  // =============================================================================
  // Returns the count that did NOT fit, matching Hotbar.give's contract.
  give(key, n) {
    if (!this.ensure() || !key) return n || 0;
    let want = Math.max(0, Math.floor(n === undefined ? 1 : n));
    const room = Math.max(0, this.bagCap() - this.bagCount);
    const take = Math.min(room, want);
    if (take > 0) {
      this.bag[key] = (this.bag[key] || 0) + take;
      this.bagCount += take;
      this.bagPulse = 0.4;
    }
    if (take < want) this.msgSet('Bag is full!');
    return want - take;
  },

  // A knock spills a little of what he is carrying -- visibly, so the player
  // feels it, but never the whole bag.
  spill(n) {
    let left = Math.max(0, Math.floor(n || 1));
    const keys = [];
    for (const k in this.bag) {
      if (Object.prototype.hasOwnProperty.call(this.bag, k) && this.bag[k] > 0) keys.push(k);
    }
    let dropped = 0;
    while (left-- > 0 && keys.length) {
      const k = pick(keys);
      this.bag[k]--; this.bagCount--; dropped++;
      if (this.bag[k] <= 0) { delete this.bag[k]; keys.splice(keys.indexOf(k), 1); }
      const s = this._take(this.spills);
      s.key = k;
      s.x = this.px + rand(-6, 6); s.y = this.py + rand(-6, 6);
      s.vx = rand(-50, 50); s.vy = rand(-40, 20);
      s.rot = rand(TAU); s.vr = rand(-6, 6);
      s.life = s.t = 1.5;
    }
    if (dropped) this.msgSet(`Dropped ${dropped}!`);
    return dropped;
  },

  // =============================================================================
  // DAMAGE / BLACKOUT / LEAVING
  // =============================================================================
  // fromX is where the hit came from; the knockback pushes him away from it.
  hurt(amount, fromX) {
    if (!this.ensure()) return false;
    if (this.over || this.iframe > 0 || this.rollT > 0) return false;   // the roll IS the dodge
    let kx, ky;
    if (typeof fromX === 'number' && isFinite(fromX)) {
      const d = this.px - fromX;
      kx = d === 0 ? -this.face : (d > 0 ? 1 : -1);
      ky = -0.45;
    } else {
      const sp = this.speed();
      kx = sp > 6 ? -this.vx / sp : -this.face;
      ky = sp > 6 ? -this.vy / sp * 0.6 - 0.3 : -0.5;
    }
    return this._damage(amount, kx, ky, false);
  },

  _damage(amount, kx, ky, quiet) {
    const def = SUITS[Math.floor(clamp(G.gear.suit || 0, 0, SUITS.length - 1))].def;
    const dmg = Math.max(0.5, (amount - def) * this._defMul());
    G.hearts = Math.round((G.hearts - dmg) * 2) / 2;
    this.iframe = this.IFRAME;
    this.flash = 0.5;
    this.shakeT = Math.max(this.shakeT, quiet ? 0.16 : 0.3);
    if (!quiet) {
      this.hurtT = this.HURT_T;
      // cancel whatever he was doing; getting hit interrupts everything
      this.dashT = 0; this.mineT = 0;
      const kn = this.KNOCK;
      this.vx = kx * kn; this.vy = ky * kn;
      this.spill(irand(1, 2));
      this._puff(this.px, this.py, 8, 70);
      this._ring(this.px, this.py, 3, 190);
    }
    if (typeof SND !== 'undefined') SND.hurt();
    if (navigator.vibrate) { try { navigator.vibrate(quiet ? 15 : 40); } catch (e) {} }
    if (G.hearts <= 0) { G.hearts = 0; this.blackout(); }
    return true;
  },

  // Passing out, not a game over: he goes limp, floats belly-up while the screen
  // dims, and wakes up at home having lost the bag.
  blackout() {
    if (!this.ensure() || this.over) return;
    this.over = true; this.overT = 0;
    this.anim = 'limp'; this.animT = 0;
    this.dashT = 0; this.rollT = 0; this.hurtT = 0; this.mineT = 0;
    this.leaving = 0;
    this.vx *= 0.2; this.vy = -14;
    this.msg = ''; this.msgT = 0;
    if (typeof SND !== 'undefined') { SND.padOff(); SND.setScene('surface'); SND.sleepy(); }
    this._puff(this.px, this.py, 10, 40);
  },

  // Swim back up and climb out. Public, so a spot, an NPC or a timer can send
  // him home; the ascent is animated rather than instant.
  surface(forced) {
    if (!this.ensure() || this.over || this.leaving) return;
    this.leaving = 1;
    this.forcedExit = !!forced;
    this.msgSet(forced ? 'Out of air -- heading up!' : 'Heading up...', 3);
    if (typeof SND !== 'undefined') SND.bubble();
  },

  _exit() {
    const s = G.ocean;
    let count = 0, value = 0;
    for (const k in this.bag) {
      if (!Object.prototype.hasOwnProperty.call(this.bag, k)) continue;
      const n = this.bag[k];
      if (!(n > 0)) continue;
      G.storage[k] = (G.storage[k] || 0) + n;
      count += n;
      const it = Object.prototype.hasOwnProperty.call(ITEMS, k) ? ITEMS[k] : null;
      value += (it ? it.price : 4) * n;
    }
    this.bag = {}; this.bagCount = 0;
    s.x = Math.round(this.px);
    s.deepest = Math.max(s.deepest, Math.round(this.depth()));
    if (G.flags.pendingRegrow) Game.newDayRegrow(true);
    if (typeof SND !== 'undefined') { SND.splash(); SND.setScene('surface'); }
    if (count > 0) Game.toast(`Hauled in ${count} finds (worth ~$${value})`);
    if (this.forcedExit) Game.toast('You surfaced gasping for air!');
    Game.save();
    Game.go(WorldScene, {});
  },

  // Other systems (mining a seabed node, prying at a wreck) can borrow the
  // animation: Otto swings his pickaxe for `t` seconds and Ocean.anim reads
  // 'mine' the whole time.
  playMine(t) {
    if (!this.ensure() || this.over) return;
    this.mineT = Math.max(this.mineT, t === undefined ? 0.5 : t);
  },

  // =============================================================================
  // CHUNKS -- the endless world
  // =============================================================================
  // Deterministic from one persisted seed, so the same water always looks the
  // same, in both directions and all the way down. Chunks are cached with a hard
  // cap; eviction costs nothing because regeneration is pure.
  chunkAt(x, y) {
    if (!this.ensure()) return null;
    return this.chunk(Math.floor(x / this.CW), Math.floor(y / this.CH));
  },

  chunk(ci, cj) {
    if (!this.ensure()) return null;
    const key = ci + ':' + cj;
    const had = this._chunks.get(key);
    if (had) return had;
    const made = this._gen(ci, cj, key);
    this._chunks.set(key, made);
    this._order.push(key);
    while (this._order.length > this.CHUNK_CAP) {
      const drop = this._order.shift();
      if (drop !== key) this._chunks.delete(drop);
    }
    return made;
  },

  _gen(ci, cj, key) {
    // Mix the two axes into the seed with large odd multipliers so neighbours
    // never share a layout (a plain ci+cj*k visibly rhymes along diagonals).
    const seed = ((G.ocean.seed * 7919) ^ Math.imul(ci, 374761393) ^ Math.imul(cj, 668265263)) | 0;
    const rng = mulberry32(seed);
    const x0 = ci * this.CW, y0 = cj * this.CH;
    const band = clamp(y0 / 2600, 0, 1);          // 0 sunlit, 1 the deep
    // The MIX is per chunk, not global: gardens, kelp thickets, bare ridges and
    // the odd empty stretch. This is what stops a scrolled background from
    // reading as wallpaper.
    const kind = weightedPick([
      ['garden', 3.2 - band * 2.4],
      ['thicket', 2.2 - band],
      ['ridge', 1.4 + band * 0.6],
      ['sparse', 0.8 + band * 3.4],
    ], rng());
    const dens = kind === 'garden' ? 1 : kind === 'thicket' ? 0.85 : kind === 'ridge' ? 0.6 : 0.28;
    const nBack = Math.round((3 + rng() * 7) * dens);
    const nFront = Math.round((2 + rng() * 4) * dens);
    const props = [];
    const push = (front) => {
      // Coral art is 20 variants; pick a small palette per chunk and stay with it
      // so a chunk has an identity instead of being confetti.
      const base = (rng() * 20) | 0;
      const art = 'coral_' + ((base + ((rng() * 4) | 0)) % 20);
      const soft = rng() < (kind === 'thicket' ? 0.75 : 0.42);
      const s = front ? 34 + rng() * 30 * (1 - band * 0.35) : 15 + rng() * 17;
      props.push({
        art,
        x: x0 + rng() * this.CW,
        y: y0 + rng() * this.CH,
        s,
        front,
        // seaweed sways, hard coral barely moves; stiffness is what the sway reads
        stiff: soft ? 0.16 + rng() * 0.22 : 0.7 + rng() * 0.26,
        ph: rng() * TAU,
        flip: rng() < 0.5,
        dim: (front ? 0.86 + rng() * 0.14 : 0.5 + rng() * 0.28) * (1 - band * 0.4),
        wreck: false,
      });
    };
    for (let i = 0; i < nBack; i++) push(false);
    for (let i = 0; i < nFront; i++) push(true);
    // Deep water gets the occasional sunken ship, held as a silhouette. It is the
    // one thing out there big enough to be a landmark.
    if (band > 0.42 && rng() < 0.1) {
      props.push({
        art: 'ship', x: x0 + rng() * this.CW, y: y0 + 40 + rng() * (this.CH - 80),
        s: 190 + rng() * 90, front: false, stiff: 1, ph: rng() * TAU, flip: rng() < 0.5,
        dim: 0.5 + rng() * 0.22, wreck: true,
      });
    }
    // Air pockets: a vent trickling bubbles is a lung down here, and it is what
    // makes the deep worth committing to.
    const vents = [];
    const nv = rng() < 0.34 ? 1 + ((rng() * 2) | 0) : 0;
    for (let i = 0; i < nv; i++) {
      vents.push({ x: x0 + rng() * this.CW, y: y0 + rng() * this.CH, next: rng() * 0.8, ph: rng() * TAU });
    }
    return { key, ci, cj, x0, y0, w: this.CW, h: this.CH, seed, band, kind, props, vents, ext: {} };
  },

  // Iterate the chunks touching the camera. cb(chunk) -- used by the draw passes
  // and available to anything that wants to place things near the player.
  // `par` shifts the query into a parallax layer's own space: a layer that
  // scrolls at 1.1 shows the chunks around camX * 1.1, and because that is still
  // a bounded window the cache behaves exactly the same.
  eachVisibleChunk(cb, pad, par) {
    if (!this.ensure()) return;
    const p = pad === undefined ? 96 : pad;
    const k = par || 1;
    const cx = this.camX * k, cy = this.camY * k;
    const ci0 = Math.floor((cx - p) / this.CW), ci1 = Math.floor((cx + W + p) / this.CW);
    const cj0 = Math.floor((cy - p) / this.CH), cj1 = Math.floor((cy + H + p) / this.CH);
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        if (cj < 0) continue;                    // there is nothing above the sky
        const c = this.chunk(ci, cj);
        if (c) cb(c);
      }
    }
  },

  // =============================================================================
  // UPDATE
  // =============================================================================
  update(dt) {
    if (!this.ensure()) return;
    // A wiring layer may also tick us from Game.globalUpdate; Game.time advances
    // exactly once per frame, so the first call in a frame wins.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (dt > 0.05) dt = 0.05;
    this.time += dt;
    this._watchdog(dt);
    if (G.ocean.lastDay < G.day) this.newDay();

    if (this.flash > 0) this.flash -= dt * 1.6;
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.splashT > 0) this.splashT -= dt;
    if (this.msgT > 0) this.msgT -= dt;
    if (this.bagPulse > 0) this.bagPulse -= dt;

    if (this.over) { this._updateBlackout(dt); return; }

    if (this.iframe > 0) this.iframe -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.mineT > 0) this.mineT -= dt;
    if (this.dashCD > 0) this.dashCD -= dt;
    if (this.rollCD > 0) this.rollCD -= dt;
    for (let i = 0; i < 4; i++) if (this._tapT[i] > 0) this._tapT[i] -= dt;

    this._input(dt);
    this._move(dt);
    this._air(dt);
    this._particles(dt);
    this._camera(dt);

    // deepest-point bookkeeping, so goals and NPCs can talk about it
    const d = Math.round(this.depth());
    if (d > G.ocean.deepest) G.ocean.deepest = d;

    this._setAnim(dt);

    // Out the top: no magic exit button. Hold UP at the surface for a beat, the
    // same contract the dive uses, so breaching mid-jump never boots you out.
    if (this.leaving) {
      if (this.py <= 0.5) { this._exit(); return; }
    } else if (this.py <= 2 && this._held(2)) {
      // deliberately unhurried: the surface is also where he BREATHES, so a
      // quick gulp of air must never be mistaken for asking to go home
      this.surfT += dt;
      if (this.surfT > this.SURF_HOLD) this.surface(false);
    } else {
      this.surfT = Math.max(0, this.surfT - dt * 2);
    }
  },

  _updateBlackout(dt) {
    this.overT += dt;
    // limp and rising: the water carries him up while everything dims
    this.vx *= Math.pow(0.25, dt);
    this.vy = lerp(this.vy, -16, clamp(dt * 2, 0, 1));
    this.px += this.vx * dt;
    this.py = Math.max(-6, this.py + this.vy * dt);
    this._particles(dt);
    this._camera(dt);
    this._setAnim(dt);
    if (this.overT > 3.4) {
      G.stats.deaths++;
      G.hearts = G.maxHearts;
      this.bag = {}; this.bagCount = 0;
      G.ocean.x = Math.round(this.px);
      G.day++; G.clock = 0.3;
      Game.newDayRegrow(true);
      Game.save();
      Game.toast('You woke up at home. Someone hauled you out -- your bag did not make it.');
      Game.go(HouseScene, { wake: true });
    }
  },

  // ---- input ------------------------------------------------------------------
  // Held state comes off Input.keys (reading it never consumes), and the press
  // EDGES are tracked here so a double-tap can be recognised without stealing
  // Input.p from anybody.
  DIRS: [['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'], ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']],

  _held(i) {
    const l = this.DIRS[i];
    return !!(Input.keys[l[0]] || Input.keys[l[1]]);
  },

  _input(dt) {
    let ix = 0, iy = 0;
    const L = this._held(0), R = this._held(1), U = this._held(2), D = this._held(3);
    if (L) ix -= 1;
    if (R) ix += 1;
    if (U) iy -= 1;
    if (D) iy += 1;

    // press edges + the double-tap window
    let dtapDir = -1;
    const now = [L, R, U, D];
    for (let i = 0; i < 4; i++) {
      if (now[i] && !this._prevDir[i]) {
        if (this._tapT[i] > 0) dtapDir = i;
        this._tapT[i] = this.DTAP;
      }
      this._prevDir[i] = now[i];
    }

    const shift = !!(Input.keys['ShiftLeft'] || Input.keys['ShiftRight']);
    const dashEdge = (shift && !this._prevDash) || dtapDir >= 0;
    this._prevDash = shift;
    // Space is also delivered by the touch pad as a tap, which only lands in
    // Input.pressed -- so the roll reads the edge through Input.p.
    let rollEdge = Input.p('Space') || Input.p('KeyJ');
    // Escape asks to go home without the hold. Nothing else in a scene reads it
    // (only the modals do), and Game.helpOpen is handled before we ever update.
    if (Input.p('Escape') && !this.over) this.surface(false);

    if (this.leaving) {
      // autopilot ascent: he swims himself out, the player can still steer sideways
      iy = -1;
      if (this.py > 60) iy = -1;
      rollEdge = false;
    }

    this.ix = ix; this.iy = iy;
    const mag = Math.sqrt(ix * ix + iy * iy);
    this.inMag = mag;
    if (mag > 0) { this.nx = ix / mag; this.ny = iy / mag; } else { this.nx = 0; this.ny = 0; }

    if (this.over || this.hurtT > 0) return;

    // A dash while hauling the stick hard against your own momentum becomes a
    // roll: it is the same instinct, and it turns the dodge into something you
    // discover by playing rather than by reading the help screen.
    let wantRoll = rollEdge;
    if (dashEdge && mag > 0 && this.speed() > 90) {
      const sp = this.speed();
      const dot = (this.vx / sp) * this.nx + (this.vy / sp) * this.ny;
      if (dot < -0.35) wantRoll = true;
    }
    if (wantRoll && this.rollT <= 0 && this.rollCD <= 0) { this._startRoll(); return; }
    if (dashEdge && this.dashT <= 0 && this.dashCD <= 0 && this.rollT <= 0) this._startDash(dtapDir);
  },

  _dirVec(i) {
    return i === 0 ? [-1, 0] : i === 1 ? [1, 0] : i === 2 ? [0, -1] : [0, 1];
  },

  _startDash(dtapDir) {
    let dx = this.nx, dy = this.ny;
    if (this.inMag <= 0) {
      if (dtapDir >= 0) { const v = this._dirVec(dtapDir); dx = v[0]; dy = v[1]; }
      else { dx = this.face; dy = 0; }
    }
    this.ddx = dx; this.ddy = dy;
    this.dashT = this.DASH_T;
    this.dashCD = this.DASH_CD + this.DASH_T;
    // a dash starts with a real kick, not a ramp
    const sp = this.DASH_SPEED * this._speedMul();
    this.vx = dx * sp * 0.62 + this.vx * 0.2;
    this.vy = dy * sp * 0.62 + this.vy * 0.2;
    this.air -= this.DASH_AIR;
    this._puff(this.px - dx * 10, this.py - dy * 10, 7, 55);
    if (typeof SND !== 'undefined') SND.splash();
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  },

  _startRoll() {
    let dx = this.nx, dy = this.ny;
    if (this.inMag <= 0) {
      const sp = this.speed();
      if (sp > 20) { dx = this.vx / sp; dy = this.vy / sp; } else { dx = this.face; dy = 0; }
    }
    this.rdx = dx; this.rdy = dy;
    this.rollT = this.ROLL_T;
    this.rollCD = this.ROLL_CD;
    this.iframe = Math.max(this.iframe, this.ROLL_INV);
    this.dashT = 0; this.mineT = 0;
    this.spin = 0;
    this.air -= this.ROLL_AIR;
    this.anim = 'roll'; this.animT = 0;
    // the payoff: a full sleeve of bubbles and a shockwave ring
    this._puff(this.px, this.py, 14, 90);
    this._ring(this.px, this.py, 3, 210);
    if (typeof SND !== 'undefined') { SND.pop(1.35); SND.bubble(); }
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  },

  // ---- physics ----------------------------------------------------------------
  _move(dt) {
    const spMul = this._speedMul();

    if (this.rollT > 0) {
      this.rollT -= dt;
      const k = clamp(this.rollT / this.ROLL_T, 0, 1);
      // fast at the start, still carrying speed when it ends: the roll should
      // launch you somewhere, not park you
      const sp = lerp(this.ROLL_END, this.ROLL_SPEED, k * k) * spMul;
      if (this.inMag > 0) {
        // steerable, but only a little -- it is a committed move
        const s = clamp(dt * 3.4, 0, 1);
        this.rdx = lerp(this.rdx, this.nx, s);
        this.rdy = lerp(this.rdy, this.ny, s);
        const m = Math.sqrt(this.rdx * this.rdx + this.rdy * this.rdy) || 1;
        this.rdx /= m; this.rdy /= m;
      }
      this.vx = this.rdx * sp;
      this.vy = this.rdy * sp;
      this.spin = 1 - k;
      if (Math.random() < dt * 45) this._puff(this.px - this.rdx * 8, this.py - this.rdy * 8, 1, 40);
      if (this.rollT <= 0) { this.rollT = 0; this.spin = 0; }
    } else if (this.py < -5) {
      // properly airborne after a hard ascent: no purchase on anything, just an
      // arc. The -5 band above the water still steers, because a floating otter
      // sits a shade above zero and must never lose control there.
      this.vy += this.GRAV_AIR * dt;
      this.vx *= Math.pow(0.6, dt);
    } else {
      if (this.dashT > 0) {
        this.dashT -= dt;
        this.vx += this.ddx * this.DASH_ACC * spMul * dt;
        this.vy += this.ddy * this.DASH_ACC * spMul * dt;
        const d = Math.pow(this.DRAG_DASH, dt);
        this.vx *= d; this.vy *= d;
        // a dash chained onto existing momentum still has a ceiling, or a stacked
        // dash out of a roll would launch him clean across the screen
        const dcap = this.DASH_SPEED * 1.12 * spMul;
        const dsp = this.speed();
        if (dsp > dcap) { const f = dcap / dsp; this.vx *= f; this.vy *= f; }
        if (Math.random() < dt * 40) this._puff(this.px - this.ddx * 9, this.py - this.ddy * 9, 1, 40);
      } else {
        if (this.hurtT <= 0) {
          const acc = this.ACC * spMul * (this.leaving ? 1.5 : 1);
          this.vx += this.nx * acc * dt;
          this.vy += this.ny * acc * dt;
        }
        // Buoyancy: he floats unless he works at going down. Above the water
        // line it turns into a gentle settle instead, so he beds into the
        // surface rather than hovering a hair above it forever.
        if (this.py >= 0) {
          const buoy = this.BUOY * (this.iy > 0 ? 0.35 : 1) * (this.leaving ? 2.6 : 1);
          this.vy -= buoy * dt;
        } else {
          this.vy += this.GRAV_AIR * 0.4 * dt;
        }
        const d = Math.pow(this.inMag > 0 ? this.DRAG_THRUST : this.DRAG_COAST, dt);
        this.vx *= d; this.vy *= d;
      }
      // Speed ceiling, bled off rather than clamped: a dash or a roll should
      // hand you its momentum on the way out, not hit a wall the frame it ends.
      if (this.dashT <= 0) {
        const cap = this.MAX_SPEED * spMul;
        const sp = this.speed();
        if (sp > cap) {
          const f = lerp(1, cap / sp, clamp(dt * 3, 0, 1));
          this.vx *= f; this.vy *= f;
        }
      }
    }

    const wasAbove = this.py < 0;
    this.px += this.vx * dt;
    this.py += this.vy * dt;
    if (this.py < -46) { this.py = -46; if (this.vy < 0) this.vy = 0; }

    // breaking the surface, in either direction
    if (wasAbove !== (this.py < 0) && Math.abs(this.vy) > 45) {
      this.splashT = 0.45;
      this._puff(this.px, 0, 9, 70);
      this._ring(this.px, 0, 3, 200);
      if (typeof SND !== 'undefined') SND.splash();
    }

    // facing + bank. He points where he is going, leans into the turn, and the
    // lean is smoothed so a flick of the keys does not snap him around.
    if (Math.abs(this.vx) > 14) this.face = this.vx > 0 ? 1 : -1;
    else if (this.inMag > 0 && Math.abs(this.nx) > 0.45) this.face = this.nx > 0 ? 1 : -1;
    // the +26 keeps the pitch finite when vx passes through zero
    let want = Math.atan2(this.vy, Math.abs(this.vx) + 26);
    want = clamp(want, -this.BANK_MAX, this.BANK_MAX);
    this.bank += (want - this.bank) * clamp(dt * 9, 0, 1);

    // a trickle of bubbles whenever he is actually moving
    if (this.dashT <= 0 && this.rollT <= 0 && this.speed() > 40 && Math.random() < dt * 7) {
      this._puff(this.px - this.face * 9, this.py + rand(-3, 3), 1, 26);
    }
  },

  // ---- air --------------------------------------------------------------------
  _air(dt) {
    const d = this.depthFrac();
    if (this.py <= 3) {
      // gulping at the surface. This is the loop: dive deep, come up, go again.
      const was = this.air;
      this.air = Math.min(this.airMax, this.air + 30 * dt);
      if (was < this.airMax * 0.5 && this.air >= this.airMax * 0.5 && typeof SND !== 'undefined') SND.relief();
      this.drownT = 0;
    } else {
      let rate = (1 + d * 1.5) * this._airMul();
      if (this.dashT > 0) rate += 2.2;
      if (this.leaving) rate *= 0.35;      // the way out is never a death sentence
      this.air -= rate * dt;
    }
    if (this.air < 0) this.air = 0;

    if (this.air <= 12 && this.air > 0) {
      this.airBeepT -= dt;
      if (this.airBeepT <= 0) { this.airBeepT = 1; if (typeof SND !== 'undefined') SND.alarm(); }
    }
    if (this.air <= 0) {
      this.drownT -= dt;
      if (this.drownT <= 0) {
        this.drownT = 1.7;
        this._damage(0.5, 0, 0, true);
        if (!this.over) this.msgSet('No air! Get to the surface!', 1.6);
      }
      // he is not asked to notice on his own: the ascent starts itself
      if (!this.over && !this.leaving && G.hearts <= 1) this.surface(true);
    }
  },

  // ---- particles --------------------------------------------------------------
  _puff(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const b = this._take(this.bubbles);
      const a = rand(0, TAU);
      b.x = x + rand(-4, 4); b.y = y + rand(-4, 4);
      b.vx = Math.cos(a) * rand(6, speed) * 0.4;
      b.vy = Math.sin(a) * rand(6, speed) * 0.4 - 14;
      b.r = rand(0.7, 2.4);
      b.wob = rand(TAU); b.sp = rand(0.8, 2.4);
      b.air = false;
      b.life = b.t = rand(0.7, 1.7);
    }
  },

  _ring(x, y, r, vr) {
    const o = this._take(this.rings);
    o.x = x; o.y = y; o.r = r; o.vr = vr; o.w = 1.6;
    o.life = o.t = 0.4;
  },

  _particles(dt) {
    // bubbles rise, wobble and expire
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.t <= 0) continue;
      b.t -= dt;
      b.vy -= 26 * dt;                                  // buoyancy
      const d = Math.pow(0.14, dt);
      b.vx *= d; b.vy *= Math.pow(0.6, dt);
      b.x += b.vx * dt + Math.sin(this.time * b.sp + b.wob) * 7 * dt;
      b.y += b.vy * dt;
      if (b.y < -4) b.t = 0;                            // popped at the surface
      // air pockets are worth swimming through
      if (b.air && b.t > 0 && !this.over && this.hits(b.x, b.y, b.r + 4)) {
        b.t = 0;
        this.air = Math.min(this.airMax, this.air + 6);
        if (typeof SND !== 'undefined') SND.bubble();
      }
    }
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.t <= 0) continue;
      r.t -= dt;
      r.r += r.vr * dt;
      r.vr *= Math.pow(0.25, dt);
    }
    for (let i = 0; i < this.spills.length; i++) {
      const s = this.spills[i];
      if (s.t <= 0) continue;
      s.t -= dt;
      s.vy += 26 * dt;                                  // shells sink
      const d = Math.pow(0.3, dt);
      s.vx *= d; s.vy *= d;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.vr * dt;
    }
    // motes: endless drift, recycled across the camera rect so the pool never
    // grows and the specks stay anchored to the water rather than the screen
    const n = this.quality > 0 ? this.motes.length : (this.motes.length >> 1);
    for (let i = 0; i < n; i++) {
      const m = this.motes[i];
      m.x += m.vx * dt + Math.sin(this.time * m.sp + m.ph) * 5 * dt;
      m.y += m.vy * dt;
      if (m.x < this.camX - 50) m.x = this.camX + W + 40;
      else if (m.x > this.camX + W + 50) m.x = this.camX - 40;
      if (m.y < this.camY - 50) m.y = this.camY + H + 40;
      else if (m.y > this.camY + H + 50) m.y = this.camY - 40;
    }
    // vents keep trickling: they emit into the shared bubble pool, so a vent off
    // screen costs nothing at all
    if (!this.over) {
      this.eachVisibleChunk((c) => {
        for (let i = 0; i < c.vents.length; i++) {
          const v = c.vents[i];
          v.next -= dt;
          if (v.next > 0) continue;
          v.next = rand(0.5, 1.3);
          const b = this._take(this.bubbles);
          b.x = v.x + rand(-3, 3); b.y = v.y;
          b.vx = rand(-6, 6); b.vy = rand(-26, -14);
          b.r = rand(2.2, 3.6);
          b.wob = rand(TAU); b.sp = rand(0.6, 1.6);
          b.air = true;
          b.life = b.t = rand(3.5, 5.5);
        }
      }, 40);
    }
    // the far layer's drifting shapes
    for (let i = 0; i < this.sils.length; i++) {
      const s = this.sils[i];
      s.fx += s.vx * dt;
      const sx = s.fx - this.camX * 0.35;
      const sy = s.fy - this.camY * 0.35;
      if (sx < -s.w - 120) s.fx += W + s.w * 2 + 200;
      else if (sx > W + s.w + 120) s.fx -= W + s.w * 2 + 200;
      if (sy < -200) s.fy += H + 340;
      else if (sy > H + 200) s.fy -= H + 340;
    }
  },

  // ---- camera -----------------------------------------------------------------
  _camera(dt) {
    // leads the direction of travel a touch, so you see where you are going
    const tx = this.px - W * 0.5 + clamp(this.vx * 0.28, -52, 52);
    const ty = this.py - H * 0.46 + clamp(this.vy * 0.20, -34, 40);
    const k = 1 - Math.pow(0.0025, dt);
    this.camX += (tx - this.camX) * k;
    // never let the camera climb so far that the sky owns the frame
    this.camY += (Math.max(ty, -H * 0.24) - this.camY) * k;
  },

  // ---- animation state machine ------------------------------------------------
  // Ocean.anim is the public read: 'cruise' | 'dive' | 'dash' | 'roll' | 'hurt' |
  // 'limp' | 'mine'. Ocean.animFrame is the asset name currently on screen.
  _setAnim(dt) {
    let a;
    if (this.over) a = 'limp';
    else if (this.hurtT > 0) a = 'hurt';
    else if (this.rollT > 0) a = 'roll';
    else if (this.mineT > 0) a = 'mine';
    else if (this.dashT > 0) a = 'dash';
    else if (this.vy > 58 && Math.abs(this.vx) < 95) a = 'dive';
    else a = 'cruise';
    if (a !== this.anim) { this.anim = a; this.animT = 0; }
    // cruising slows its cycle when he is barely moving, so an idle otter drifts
    const rate = a === 'cruise' ? 0.5 + Math.min(1.6, this.speed() / 95) : 1;
    this.animT += dt * rate;

    const def = Object.prototype.hasOwnProperty.call(this.ANIM, a) ? this.ANIM[a] : this.ANIM.cruise;
    // A continuous position through the cycle, not just an index: the fractional
    // part is what lets the draw cross-fade one pose into the next. These sheets
    // are 4 frames per action, so without a blend they visibly flick.
    let pos, wrap = true;
    if (a === 'roll') {
      pos = (1 - this.rollT / this.ROLL_T) * 4; wrap = false;   // one revolution
    } else if (a === 'hurt') {
      pos = (1 - this.hurtT / this.HURT_T) * 8; wrap = false;
    } else if (a === 'limp') {
      // 8..11 goes limp, then 12..15 floats belly-up and stays there
      if (this.overT < 1.3) { pos = this.overT / 0.33; wrap = false; }
      else { pos = 4 + ((this.overT - 1.3) * 2.2) % 4; }
    } else {
      pos = this.animT * def.fps;
    }
    const n = def.f.length;
    let idx = Math.floor(pos);
    const phase = pos - idx;
    idx = wrap ? ((idx % n) + n) % n : clamp(idx, 0, n - 1);
    const prev = wrap ? ((idx - 1 + n) % n) : Math.max(0, idx - 1);
    this.animFrame = def.f[idx];
    this.animPrev = def.f[prev];
    // Cross-fade across the first 45% of each frame's dwell. Beyond that only one
    // frame is drawn, so the two-blit path is the exception, not the rule.
    const BL = 0.45;
    if (phase >= BL || prev === idx) this.animMix = 1;
    else { const k = phase / BL; this.animMix = k * k * (3 - 2 * k); }
    this.animBox = def.box;
  },

  // ---- adaptive quality -------------------------------------------------------
  // The light layers are the only optional cost in here. If a device cannot hold
  // the frame they come out, and they come back when it can.
  _watchdog(dt) {
    this._ft = lerp(this._ft, dt, 0.06);
    if (this.quality > 0 && this._ft > 0.026) {
      this._qt += dt;
      if (this._qt > 1.5) { this.quality = 0; this._qt = 0; }
    } else if (this.quality === 0 && this._ft < 0.019) {
      this._qt += dt;
      if (this._qt > 3) { this.quality = 1; this._qt = 0; }
    } else {
      this._qt = 0;
    }
  },

  // =============================================================================
  // BAKED LAYERS -- built once, blitted forever
  // =============================================================================

  // The far layer, pre-blurred. The blur IS the half-density cache: baking at
  // DPX/2 and blitting up through the canvas filter costs nothing per frame and
  // gives exactly the soft focus deep water wants.
  // Half-resolution scratch for the soft background layers. Allocated once; the
  // context is pre-scaled so the layer code draws in the same logical units.
  _backdrop() {
    const bw = Math.max(1, Math.round(W * DPX / 2)), bh = Math.max(1, Math.round(H * DPX / 2));
    if (this._bdCv && this._bdCv.width === bw && this._bdCv.height === bh) return this._bdCv;
    const cv = document.createElement('canvas');
    cv.width = bw; cv.height = bh;
    const c = cv.getContext('2d');
    if (!c) return null;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'low';   // it is about to be softened by the upscale
    c.scale(DPX / 2, DPX / 2);
    this._bdCv = cv; this._bdCtx = c;
    return cv;
  },

  _farLayer() {
    if (this._farCv) return this._farCv;
    const img = ASSETS['sea_bg'];
    if (!img || !img.width) return null;      // not loaded yet: try again next frame
    const q = DPX / 2;
    const lw = this.FAR_W, lh = lw * img.height / img.width;
    const pw = Math.round(lw * q), ph = Math.round(lh * q);
    const half = document.createElement('canvas');
    half.width = Math.max(1, pw >> 1); half.height = Math.max(1, ph >> 1);
    const hc = half.getContext('2d');
    hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
    hc.drawImage(img, 0, 0, half.width, half.height);
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    // A real blur where it is available; the two-step downscale is already soft
    // enough to pass without it.
    if (typeof c.filter === 'string') c.filter = 'blur(1.6px)';
    c.drawImage(half, 0, 0, pw, ph);
    if (typeof c.filter === 'string') c.filter = 'none';
    this._farCv = cv;
    this._farW = lw; this._farH = lh;
    return cv;
  },

  // One sea_mid tile at its exact on-screen size, so the per-frame work is a 1:1
  // blit instead of a filtered downscale of a 768x192 source, eight times over.
  _midTile() {
    if (this._midCv) return this._midCv;
    const img = ASSETS['sea_mid'];
    if (!img || !img.width) return null;
    const lw = this.MID_H * img.width / img.height;     // keep the band's aspect
    const pw = Math.round(lw * DPX), ph = Math.round(this.MID_H * DPX);
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, pw, ph);
    this._midCv = cv;
    this._midW = lw;
    return cv;
  },

  // Moving caustic light bands. Baked ONCE at half density (they are meant to be
  // soft) into a strip whose content is exactly W-periodic, so a single blit at a
  // wrapped offset covers the screen with no seam and no second draw call.
  // Returns { cv, w, h, ax, bx } -- the two scroll offsets for time t, because
  // two copies of the same strip sliding against each other is what makes the
  // pattern shimmer instead of merely pan.
  caustics(t) {
    if (!this._caCv) {
      const q = DPX / 2;
      const lw = W * 2, lh = 128;
      const cv = document.createElement('canvas');
      cv.width = Math.round(lw * q); cv.height = Math.round(lh * q);
      const c = cv.getContext('2d');
      c.scale(q, q);
      c.globalCompositeOperation = 'lighter';
      if (typeof c.filter === 'string') c.filter = 'blur(2.5px)';
      c.strokeStyle = '#cdeaff';          // set ONCE for all 46 bands
      c.lineCap = 'round';
      const rng = mulberry32(0x0CE7A11);
      for (let i = 0; i < 46; i++) {
        // an integer number of periods across W keeps the strip tileable
        const k = 1 + ((rng() * 6) | 0);
        const per = W / k;
        const y0 = rng() * lh, amp = 5 + rng() * 15, ph = rng() * TAU;
        c.globalAlpha = 0.05 + rng() * 0.11;
        c.lineWidth = 0.8 + rng() * 3.6;
        c.beginPath();
        for (let x = 0; x <= lw; x += 10) {
          const y = y0 + Math.sin(x / per * TAU + ph) * amp
                       + Math.sin(x / per * TAU * 3 + ph * 2) * amp * 0.28;
          if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
      if (typeof c.filter === 'string') c.filter = 'none';
      this._caCv = cv;
      this._caW = lw; this._caH = lh;
    }
    const t2 = t || 0;
    return {
      cv: this._caCv, w: this._caW, h: this._caH,
      ax: -(((t2 * 17) % W + W) % W),
      bx: -(((-t2 * 26) % W + W) % W),
    };
  },

  // Drifting god-ray shafts, same trick: baked once, W-periodic, one blit.
  _rayStrip() {
    if (this._rayCv) return this._rayCv;
    const q = DPX / 2;
    const lw = W * 2, lh = 200;
    const cv = document.createElement('canvas');
    cv.width = Math.round(lw * q); cv.height = Math.round(lh * q);
    const c = cv.getContext('2d');
    c.scale(q, q);
    c.globalCompositeOperation = 'lighter';
    if (typeof c.filter === 'string') c.filter = 'blur(3px)';
    c.fillStyle = '#bfe4ff';              // set ONCE for all the shafts
    const rng = mulberry32(0x0A1B2C3);
    for (let i = 0; i < 14; i++) {
      const x = (i / 14) * W + rng() * 22;
      const topW = 5 + rng() * 16, botW = topW * (2.2 + rng() * 2.4);
      const lean = -22 + rng() * 44;
      c.globalAlpha = 0.05 + rng() * 0.07;
      // one shaft is one quad -- the whole strip is baked, so this never runs again
      for (let copy = 0; copy < 2; copy++) {
        const ox = x + copy * W;
        c.beginPath();
        c.moveTo(ox - topW / 2, -6);
        c.lineTo(ox + topW / 2, -6);
        c.lineTo(ox + lean + botW / 2, lh);
        c.lineTo(ox + lean - botW / 2, lh);
        c.closePath();
        c.fill();
      }
    }
    if (typeof c.filter === 'string') c.filter = 'none';
    this._rayCv = cv;
    this._rayW = lw; this._rayH = lh;
    return cv;
  },

  // A tinted silhouette of a sprite, baked ONCE PER ART at one canonical width
  // and half density -- callers scale at blit time, so two wrecks of different
  // sizes cannot fight over the same cache entry. Drawing the image and then
  // filling over it with 'source-atop' keeps only the opaque pixels, which is
  // what turns a bright dolphin into a shape in the murk.
  _sil(name) {
    if (!this._silCv) this._silCv = {};
    if (Object.prototype.hasOwnProperty.call(this._silCv, name)) return this._silCv[name];
    const img = ASSETS[name];
    if (!img || !img.width) return null;      // not loaded yet: do not cache the miss
    const q = DPX / 2;
    const w = this.SIL_W, h = w * img.height / img.width;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * q)); cv.height = Math.max(1, Math.round(h * q));
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = '#0b1e30';
    c.fillRect(0, 0, cv.width, cv.height);
    const rec = { cv, w, h, ar: h / w };
    this._silCv[name] = rec;
    return rec;
  },

  // centred, at whatever width the caller wants
  _silDraw(ctx, name, cx, cy, w, flip, alpha) {
    const r = this._sil(name);
    if (!r) return 0;
    const h = w * r.ar;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(cx, cy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(r.cv, -w / 2, -h / 2, w, h);
    ctx.restore();
    return h;
  },

  // ---- palette ----------------------------------------------------------------
  _tintAt(y) {
    const S = this.STOPS;
    if (y <= S[0][0]) return S[0][1];
    for (let i = 1; i < S.length; i++) {
      if (y <= S[i][0]) {
        const t = (y - S[i - 1][0]) / (S[i][0] - S[i - 1][0]);
        return rgbLerp(S[i - 1][1], S[i][1], t);
      }
    }
    return S[S.length - 1][1];
  },

  _nightF() {
    if (typeof nightness !== 'function' || typeof G === 'undefined' || !G) return 0;
    // night matters at the surface and matters less the deeper you are, where it
    // was already dark
    return nightness(G.clock) * (1 - this.depthFrac() * 0.55);
  },

  // =============================================================================
  // DRAW
  // =============================================================================
  draw(ctx) {
    if (!this.ensure()) return;
    const t = this.time;
    ctx.save();
    if (this.shakeT > 0) {
      const a = Math.min(2.5, this.shakeT * 8);
      ctx.translate(Math.round(rand(-a, a) * DPX) / DPX, Math.round(rand(-a, a) * DPX) / DPX);
    }

    // The four backdrop layers together cover roughly five screens of fill, and
    // on a software canvas at 1920x1080 that alone measured 110ms a frame. They
    // are all soft, out-of-focus things, so they are composited at HALF device
    // resolution into a reused canvas and upscaled in one blit: a quarter of the
    // fill for a difference the haze hides anyway. The surface line stays on the
    // main context — it is the one crisp thing up there.
    const bd = this._backdrop();
    if (bd) {
      const b = this._bdCtx;
      this._drawWater(b, t);
      this._drawFar(b, t);
      this._drawMid(b, t);
      this._drawHaze(b);
      // A FILTERED 2x magnify of 960x540 costs as much as the fill it saved, so
      // the upscale is nearest-neighbour. On a blurred, hazed backdrop the
      // difference is invisible; the cost difference is most of the frame.
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bd, 0, 0, W, H);
      ctx.imageSmoothingEnabled = sm;
    } else {
      this._drawWater(ctx, t);
      this._drawFar(ctx, t);
      this._drawMid(ctx, t);
      this._drawHaze(ctx);
    }
    this._drawSurfaceLine(ctx, t);
    this._drawRays(ctx, t);
    this._drawProps(ctx, t, false);
    this._drawMotes(ctx, t);
    this._drawBubbles(ctx);
    this._drawSpills(ctx);
    this._drawOtto(ctx, t);
    this._drawProps(ctx, t, true);
    this._drawCaustics(ctx, t);
    this._drawRings(ctx);
    this._drawSurfaceFoam(ctx, t);
    this._drawDeepTint(ctx);

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(232,60,60,${clamp(this.flash, 0, 1) * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    this._drawHUD(ctx);

    if (this.over) {
      ctx.fillStyle = `rgba(2,6,14,${clamp(this.overT / 1.6, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      if (this.overT > 1.5) {
        text(ctx, 'you black out...', W / 2, H / 2 - 6, { size: 10, color: '#8a9aa8', align: 'center' });
      }
    }
  },

  // ---- the water itself -------------------------------------------------------
  _drawWater(ctx, t) {
    // Twelve flat bands from the tint at the top of the screen to the tint at the
    // bottom. A canvas gradient over 1920x1080 every frame is exactly the thing
    // this codebase has been burned by; twelve fillRects cost nothing.
    const top = this._tintAt(this.camY), bot = this._tintAt(this.camY + H);
    const nf = this._nightF();
    const BANDS = 12, bh = H / BANDS;
    for (let i = 0; i < BANDS; i++) {
      let c = rgbLerp(top, bot, i / (BANDS - 1));
      if (nf > 0) c = rgbLerp(c, [6, 14, 34], nf * 0.6);
      ctx.fillStyle = cssRGB(c);
      ctx.fillRect(0, i * bh, W, bh + 0.6);
    }
    // the sky, when the surface is in frame
    const surf = -this.camY;
    if (surf > 0.5) {
      const day = 1 - nf;
      const skyTop = rgbLerp([22, 30, 58], [126, 196, 226], day);
      const skyBot = rgbLerp([44, 52, 84], [232, 222, 186], day);
      const sh = Math.min(H, surf);
      const SB = 6, sbh = sh / SB;
      for (let i = 0; i < SB; i++) {
        ctx.fillStyle = cssRGB(rgbLerp(skyTop, skyBot, i / (SB - 1)));
        ctx.fillRect(0, i * sbh, W, sbh + 0.6);
      }
    }
  },

  // The underside of the surface: a bright wobbling lip. Drawn after the haze so
  // the water line stays the brightest thing in frame, which is what makes "up"
  // legible from any depth it is visible at.
  _drawSurfaceLine(ctx, t) {
    const surf = -this.camY;
    if (surf < -6 || surf > H + 6) return;
    ctx.fillStyle = 'rgba(226,248,255,0.5)';
    ctx.fillRect(0, surf - 1, W, 1.4);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let x = 0; x < W; x += 4) {
      const wob = Math.sin(t * 1.7 + (x + this.camX) * 0.07) * 1.3
                + Math.sin(t * 3.1 + (x + this.camX) * 0.021) * 0.9;
      ctx.fillRect(x, surf - 2.2 + wob, 4, 1);
    }
  },

  // ---- far layer + silhouettes ------------------------------------------------
  _drawFar(ctx, t) {
    const fade = clamp(1 - Math.max(0, this.camY) / 900, 0, 1);
    if (fade <= 0.01) return;
    const cv = this._farLayer();
    if (!cv) return;
    const lw = this._farW, lh = this._farH;
    // 0.16 is the slowest thing on screen; the whole depth read hangs off the
    // ratio between this, the mid band (0.55) and the props (1.0)
    const ox = this.camX * this.PAR_FAR;
    // Slide within the layer's slack, but never above the water line: sea_bg is
    // an underwater painting and must not be drawn over the sky.
    const oy = Math.max(-this.camY, clamp(-this.camY * 0.1, -(lh - H), 0));
    const i0 = Math.floor(ox / lw);
    ctx.save();
    ctx.globalAlpha = 0.9 * fade * (1 - this._nightF() * 0.55);
    // One copy of this layer is 648x364 logical — 2592x1456 device pixels, of
    // which at most 480x270 can ever land on screen. Blitting the whole rect and
    // letting the canvas clip cost 46ms a frame on a software canvas, so the
    // source rectangle is computed and only the visible slice is drawn.
    const sxScale = cv.width / lw, syScale = cv.height / lh;
    const vy0 = Math.max(0, oy), vy1 = Math.min(H, oy + lh);
    if (vy1 > vy0) {
      const sy = (vy0 - oy) * syScale, sh = (vy1 - vy0) * syScale;
      for (let i = i0; i * lw - ox < W; i++) {
        const x = i * lw - ox;
        const vx0 = Math.max(0, x), vx1 = Math.min(W, x + lw);
        if (vx1 <= vx0) continue;
        const sw = (vx1 - vx0) * sxScale;
        if (i & 1) {
          // alternate copies are mirrored: the source is a painted scene, not a
          // tileable strip, and a mirrored seam is invisible at this speed.
          // Mirroring means the source span is measured from the far edge.
          const sx = (x + lw - vx1) * sxScale;
          ctx.save();
          ctx.translate(vx1, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(cv, sx, sy, sw, sh, 0, vy0, vx1 - vx0, vy1 - vy0);
          ctx.restore();
        } else {
          ctx.drawImage(cv, (vx0 - x) * sxScale, sy, sw, sh, vx0, vy0, vx1 - vx0, vy1 - vy0);
        }
      }
    }
    ctx.restore();

    // something big, out in the blue
    for (let i = 0; i < this.sils.length; i++) {
      const s = this.sils[i];
      const sx = s.fx - this.camX * 0.35;
      const sy = s.fy - this.camY * 0.35 + Math.sin(t * 0.4 + s.ph) * 5;
      if (sx + s.w < -40 || sx - s.w > W + 40 || sy < -160 || sy > H + 160) continue;
      if (sy < -this.camY) continue;                  // never above the water line
      this._silDraw(ctx, s.art, sx, sy, s.w, s.vx < 0, 0.3 * fade);
    }
  },

  // ---- mid band ---------------------------------------------------------------
  _drawMid(ctx, t) {
    const cv = this._midTile();
    if (!cv) return;
    const tw = this._midW;
    const par = this.PAR_MID;
    const ox = this.camX * par;
    const oy = this.camY * par;
    // bands of reef every MID_GAP through the column; which ones are on screen
    // falls out of the parallaxed offset
    const n0 = Math.floor((oy - this.MID_H) / this.MID_GAP);
    const n1 = Math.floor((oy + H) / this.MID_GAP);
    const i0 = Math.floor(ox / tw);
    for (let n = n0; n <= n1; n++) {
      const wy = n * this.MID_GAP + 90;
      const sy = wy - oy;
      if (sy > H || sy + this.MID_H < 0) continue;
      const fade = clamp(1 - Math.max(0, wy) / 3000, 0.12, 1) * (1 - this._nightF() * 0.5);
      ctx.save();
      ctx.globalAlpha = 0.85 * fade;
      for (let i = i0; i * tw - ox < W; i++) {
        const x = i * tw - ox;
        // flip every other tile and every other band: the source tiles cleanly,
        // and this stops the eye from finding the repeat
        if ((i + n) & 1) {
          ctx.save();
          ctx.translate(x + tw, sy);
          ctx.scale(-1, 1);
          ctx.drawImage(cv, 0, 0, tw, this.MID_H);
          ctx.restore();
        } else {
          ctx.drawImage(cv, x, sy, tw, this.MID_H);
        }
      }
      ctx.restore();
    }
  },

  // ---- aerial perspective -----------------------------------------------------
  // The haze goes over the background layers and UNDER Otto, which is what keeps
  // him readable while the distance drowns in water colour.
  _drawHaze(ctx) {
    const d = this.depthFrac();
    const base = this._tintAt(this.camY + H * 0.5);
    const a0 = 0.16 + d * 0.4;
    const BANDS = 8, bh = H / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const a = a0 * (0.45 + 0.55 * (i / (BANDS - 1)));
      ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${a.toFixed(3)})`;
      ctx.fillRect(0, i * bh, W, bh + 0.6);
    }
  },

  // A last, weak tint over everything so the deep genuinely closes in. The
  // corner vignette is already applied by the main loop; this is only colour.
  _drawDeepTint(ctx) {
    const d = this.depthFrac();
    const nf = this._nightF();
    const a = d * 0.34 + nf * 0.22;
    if (a <= 0.01) return;
    ctx.fillStyle = `rgba(3,10,24,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  },

  // ---- surface light ----------------------------------------------------------
  _drawRays(ctx, t) {
    if (this.quality <= 0) return;               // the first thing to go
    const fade = clamp(1 - Math.max(0, this.camY) / this.LIGHT_END, 0, 1) * (1 - this._nightF());
    if (fade <= 0.02) return;
    const cv = this._rayStrip();
    if (!cv) return;
    // 170 logical tall, not the full light band: this blit is ~1.3M device pixels
    // of 'lighter' compositing and the shafts are strongest right under the
    // surface anyway, so the height is where the budget gets spent or saved.
    const h = 170;
    const sy = -this.camY + 2;                   // pinned just under the surface
    if (sy > H) return;
    // 0.28 parallax and a slow drift: the shafts belong to the sun, not the diver
    const ox = -(((this.camX * 0.28 + t * 5) % W + W) % W);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * fade;
    ctx.drawImage(cv, ox, sy, this._rayW, h);
    ctx.restore();
  },

  _drawCaustics(ctx, t) {
    const fade = clamp(1 - Math.max(0, this.camY) / this.LIGHT_END, 0, 1) * (1 - this._nightF() * 0.9);
    if (fade <= 0.02) return;
    const ca = this.caustics(t);
    if (!ca.cv) return;
    const top = -this.camY + 6;
    if (top > H || top + 130 < 0) return;
    ctx.save();
    // 'lighter' is additive and its cost is per DESTINATION pixel: two copies
    // over a 480x130 band measured 35ms a frame on a software canvas, which was
    // the whole difference between 18fps and 60 at the surface. Over a dark blue
    // backdrop a plain source-over blit of the same bright strip reads almost
    // identically, so only the top band stays additive.
    if (this.quality > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.44 * fade;
      ctx.drawImage(ca.cv, ca.ax, top, ca.w, 112);
      // the second copy slides the other way; the interference IS the shimmer
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.24 * fade;
      ctx.drawImage(ca.cv, ca.bx, top + 8, ca.w, 74);
    } else {
      // Once the watchdog has given up on the frame, the additive pass is the
      // first thing to go: the light is still there, it just stops glowing.
      ctx.globalAlpha = 0.5 * fade;
      ctx.drawImage(ca.cv, ca.ax, top, ca.w, 100);
    }
    ctx.restore();
  },

  _drawSurfaceFoam(ctx, t) {
    if (this.splashT <= 0) return;
    const k = clamp(this.splashT / 0.45, 0, 1);
    const sx = this.px - this.camX, sy = -this.camY;
    if (sy < -30 || sy > H + 30) return;
    ctx.fillStyle = '#eaf9ff';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI * 0.5 + (i / 9 - 0.5) * 2.1;
      const r = (1 - k) * 34 + 4;
      ctx.globalAlpha = k * 0.7;
      ctx.fillRect(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.7, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  },

  // ---- props ------------------------------------------------------------------
  _drawProps(ctx, t, front) {
    const nf = this._nightF();
    const par = front ? this.PAR_FRONT : this.PAR_BACK;
    const cx = this.camX * par, cy = this.camY * par;
    this.eachVisibleChunk((c) => {
      for (let i = 0; i < c.props.length; i++) {
        const p = c.props[i];
        if (!!p.front !== !!front) continue;
        // wrecks are landmarks, so they ride at world scale like Otto does
        const sx = p.x - (p.wreck ? this.camX : cx);
        const sy = p.y - (p.wreck ? this.camY : cy);
        const half = p.s;
        if (sx + half < -20 || sx - half > W + 20 || sy + half < -20 || sy - half > H + 20) continue;
        if (p.wreck) {
          this._silDraw(ctx, p.art, sx, sy, p.s, p.flip, p.dim * (1 - nf * 0.4));
          continue;
        }
        const img = ASSETS[p.art];
        if (!img || !img.width) continue;
        // fit the longest side to p.s, the same rule drawItemIcon uses
        const wide = img.width >= img.height;
        const w = wide ? p.s : p.s * img.width / img.height;
        const h = wide ? p.s * img.height / img.width : p.s;
        const sway = Math.sin(t * (1.5 - p.stiff) + p.ph) * (1 - p.stiff) * 0.3;
        ctx.save();
        ctx.translate(Math.round(sx * DPX) / DPX, sy);
        ctx.globalAlpha = clamp(p.dim, 0.1, 1) * (1 - nf * 0.45);
        // a plant bends from where it is rooted, so pivot at its base
        ctx.translate(0, h / 2);
        ctx.rotate(sway);
        ctx.translate(0, -h / 2);
        if (p.flip) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }, 120, par);
  },

  // ---- particles --------------------------------------------------------------
  _drawMotes(ctx, t) {
    const n = this.quality > 0 ? this.motes.length : (this.motes.length >> 1);
    const d = this.depthFrac();
    // two buckets, two fillStyle writes for the whole field: pale drifting silt,
    // and the bioluminescent specks that take over down deep
    ctx.fillStyle = '#dff2ff';
    for (let i = 0; i < n; i++) {
      const m = this.motes[i];
      if (m.glow) continue;
      const sx = m.x - this.camX, sy = m.y - this.camY;
      if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
      ctx.globalAlpha = 0.08 + 0.2 * (0.5 + 0.5 * Math.sin(t * m.sp * 2 + m.ph));
      ctx.fillRect(sx, sy, m.r, m.r);
    }
    ctx.fillStyle = '#9ef7d8';
    for (let i = 0; i < n; i++) {
      const m = this.motes[i];
      if (!m.glow) continue;
      const sx = m.x - this.camX, sy = m.y - this.camY;
      if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
      ctx.globalAlpha = (0.1 + 0.34 * (0.5 + 0.5 * Math.sin(t * m.sp * 2.4 + m.ph))) * (0.3 + d * 0.7);
      ctx.fillRect(sx, sy, m.r + 0.4, m.r + 0.4);
    }
    ctx.globalAlpha = 1;
  },

  _drawBubbles(ctx) {
    // one stroke colour for every bubble; the air pockets get a second pass
    ctx.strokeStyle = '#dff4ff';
    ctx.lineWidth = PIX * 2;
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.t <= 0) continue;
      const sx = b.x - this.camX, sy = b.y - this.camY;
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      ctx.globalAlpha = clamp(b.t / b.life, 0, 1) * 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, b.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(190,240,255,0.5)';
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.t <= 0 || !b.air) continue;
      const sx = b.x - this.camX, sy = b.y - this.camY;
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, b.r * 0.75, 0, TAU);
      ctx.fill();
    }
    ctx.lineWidth = 1;
  },

  _drawRings(ctx) {
    ctx.strokeStyle = '#e8fbff';
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.t <= 0) continue;
      const k = r.t / r.life;
      ctx.globalAlpha = k * 0.55;
      ctx.lineWidth = r.w * k;
      ctx.beginPath();
      ctx.arc(r.x - this.camX, r.y - this.camY, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  },

  _drawSpills(ctx) {
    for (let i = 0; i < this.spills.length; i++) {
      const s = this.spills[i];
      if (s.t <= 0) continue;
      const sx = s.x - this.camX, sy = s.y - this.camY;
      if (sx < -12 || sx > W + 12 || sy < -12 || sy > H + 12) continue;
      ctx.save();
      ctx.globalAlpha = clamp(s.t / s.life * 1.4, 0, 1);
      ctx.translate(sx, sy);
      ctx.rotate(s.rot);
      // drawItemIcon draws nothing for a key it does not know, so fall back to a
      // plain chip in the item's colour when a system stashed something exotic
      if (Object.prototype.hasOwnProperty.call(ITEM_ART, s.key)) {
        drawItemIcon(ctx, s.key, 0, 0, 9);
      } else {
        const it = Object.prototype.hasOwnProperty.call(ITEMS, s.key) ? ITEMS[s.key] : null;
        ctx.fillStyle = it ? it.color : '#c9a271';
        ctx.fillRect(-3, -2.5, 6, 5);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  // ---- Otto -------------------------------------------------------------------
  _drawOtto(ctx, t) {
    const sx = this.px - this.camX, sy = this.py - this.camY;

    // speed streaks behind a dash or a roll: one strokeStyle, six lines
    const sp = this.speed();
    if (sp > 150) {
      const k = clamp((sp - 150) / 160, 0, 1);
      const ux = -this.vx / sp, uy = -this.vy / sp;
      ctx.strokeStyle = '#dff4ff';
      ctx.lineWidth = PIX * 2;
      for (let i = 0; i < 6; i++) {
        const o = 6 + i * 7;
        const j = (i % 2 ? 1 : -1) * (3 + (i & 3) * 2.2);
        ctx.globalAlpha = k * 0.4 * (1 - i / 6);
        ctx.beginPath();
        ctx.moveTo(sx + ux * o - uy * j, sy + uy * o + ux * j);
        ctx.lineTo(sx + ux * (o + 11) - uy * j, sy + uy * (o + 11) + ux * j);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    const img = ASSETS[this.animFrame];
    if (!img || !img.width) return;
    // blink through the invulnerability window; the roll's own frames read
    // clearly enough that it does not need to blink as well
    if (this.iframe > 0 && this.rollT <= 0 && Math.floor(this.time * 22) % 2) {
      ctx.globalAlpha = 0.4;
    }
    const box = this.animBox || 54;
    const wide = img.width >= img.height;
    const w = wide ? box : box * img.width / img.height;
    const h = wide ? box * img.height / img.width : box;

    // the roll squashes and stretches through its revolution, which is what
    // gives a flipbook barrel roll any weight
    let sqx = 1, sqy = 1;
    if (this.rollT > 0) {
      const k = 1 - this.rollT / this.ROLL_T;
      sqy = 1 - Math.sin(k * Math.PI) * 0.26;
      sqx = 1 + Math.sin(k * Math.PI) * 0.1;
    } else if (this.dashT > 0) {
      sqx = 1.08; sqy = 0.94;
    }

    ctx.save();
    ctx.translate(Math.round(sx * DPX) / DPX, Math.round(sy * DPX) / DPX);
    // bank toward the velocity vector; mirrored when he swims left so the lean
    // still points the way he is going
    ctx.rotate(this.face > 0 ? this.bank : -this.bank);
    if (this.face < 0) ctx.scale(-1, 1);
    ctx.scale(sqx, sqy);
    if (this.over) {
      // belly-up: the limp frames already sag, this rolls him the rest of the way
      ctx.rotate(clamp((this.overT - 1.1) * 0.9, 0, 1) * Math.PI * (this.face > 0 ? 1 : -1) * 0.9);
    }
    // Cross-fade the outgoing pose into the incoming one. Only during the first
    // slice of each frame's dwell, so this is one blit for most of every frame.
    if (this.animMix < 1) {
      const pimg = ASSETS[this.animPrev];
      if (pimg && pimg.width) {
        const pw = pimg.width >= pimg.height ? box : box * pimg.width / pimg.height;
        const ph = pimg.width >= pimg.height ? box * pimg.height / pimg.width : box;
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * (1 - this.animMix);
        ctx.drawImage(pimg, -pw / 2, -ph / 2, pw, ph);
        ctx.globalAlpha = base * this.animMix;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.globalAlpha = base;
      } else {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    } else {
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  // ---- HUD --------------------------------------------------------------------
  // Drawn inside the scene (so it takes the colour grade, exactly like the dive's
  // gauges do) and laid out around the touch pads and the hotbar strip.
  _drawHUD(ctx) {
    const touch = typeof TouchUI !== 'undefined' && TouchUI.enabled;
    const frac = clamp(this.air / Math.max(1, this.airMax), 0, 1);
    const low = this.air <= 12;
    const pulse = low && Math.sin(this.time * 10) > 0;

    // air + depth capsule. Above the pads on touch, bottom-left otherwise --
    // either way clear of the hotbar, which owns x 133..347 at the very bottom.
    const gy = touch ? H - 74 : H - 28;
    uiPanel(ctx, 6, gy, 126, 15, 0.85);
    ctx.strokeStyle = pulse ? '#ff5a4a' : '#bfe8f5';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(15, gy + 7.5, 3.5, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(18.5, gy + 4, 1.4, 0, TAU); ctx.stroke();
    rrect(ctx, 24, gy + 3.5, 62, 8, '#08141c', '#2c4654');
    ctx.fillStyle = low ? '#e8434c' : '#5ad2f0';
    ctx.fillRect(25, gy + 4.5, 60 * frac, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(25, gy + 4.5, 60 * frac, 1.5);
    ctx.fillStyle = 'rgba(8,20,28,0.7)';
    for (let i = 1; i < 3; i++) ctx.fillRect(24 + i * 20.6, gy + 4, PIX * 2, 7);
    text(ctx, `${Math.round(this.depth())}m`, 128, gy + 4, { size: 8, color: '#9fc4d4', align: 'right' });

    // dash / roll readiness, right where the eye already is
    this._pip(ctx, 6, gy - 13, '>>', this.dashCD <= 0, this.dashCD / Math.max(0.01, this.DASH_CD + this.DASH_T));
    this._pip(ctx, 34, gy - 13, 'O', this.rollCD <= 0, this.rollCD / Math.max(0.01, this.ROLL_CD));

    // the bag
    const cap = this.bagCap();
    const full = this.bagCount >= cap;
    const by = touch ? 58 : H - 28;   // clear of the help tab at y 24..42
    const bp = this.bagPulse > 0 ? 1 + this.bagPulse * 1.1 : 1;
    uiPanel(ctx, W - 74, by, 68, 15, 0.85);
    ctx.save();
    ctx.translate(W - 63, by + 7.5);
    ctx.scale(bp, bp);
    ctx.fillStyle = '#8a7040';
    ctx.beginPath();
    ctx.moveTo(-4, -5); ctx.lineTo(4, -5); ctx.lineTo(5.5, 5); ctx.lineTo(-5.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,28,12,0.8)';
    ctx.lineWidth = PIX;
    ctx.beginPath(); ctx.moveTo(-4.7, -1); ctx.lineTo(4.7, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5.2, 2); ctx.lineTo(5.2, 2); ctx.stroke();
    ctx.fillStyle = '#5a4526';
    ctx.fillRect(-4.5, -6.5, 9, 2);
    ctx.restore();
    text(ctx, `${this.bagCount}/${cap}`, W - 52, by + 4, { size: 8, color: full ? '#ff5a4a' : '#ffe6b0' });

    // how to get out, while he is up near the light
    if (!this.over && !this.leaving && this.py < 34) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 3);
      text(ctx, touch ? 'hold the UP pad at the surface to climb out' : 'hold UP at the surface to climb out  ([Esc] anywhere)',
        W / 2, 42, { size: 7, color: '#d8ccb4', align: 'center' });
      ctx.globalAlpha = 1;
      // and while he is holding it, show the beat filling up
      if (this.surfT > 0.02) {
        const k = clamp(this.surfT / this.SURF_HOLD, 0, 1);
        rrect(ctx, W / 2 - 20, 52, 40, 3, '#08141c', '#2c4654');
        ctx.fillStyle = '#a0f2b4';
        ctx.fillRect(W / 2 - 19, 52.5, 38 * k, 2);
      }
    }
    if (this.leaving && !this.over) {
      text(ctx, 'climbing out...', W / 2, 42, { size: 7, color: '#a0f2b4', align: 'center' });
    }

    if (this.msgT > 0) {
      const a = clamp(this.msgT, 0, 1);
      ctx.globalAlpha = a;
      const w = textWidth(ctx, this.msg, 8) + 16;
      uiPanel(ctx, W / 2 - w / 2, H * 0.28, w, 15, 0.86);
      text(ctx, this.msg, W / 2, H * 0.28 + 4, { size: 8, color: '#ffe6b0', align: 'center' });
      ctx.globalAlpha = 1;
    }
  },

  _pip(ctx, x, y, glyph, ready, cd) {
    uiPanel(ctx, x, y, 26, 12, 0.8);
    if (!ready) {
      // the cooldown drains right to left inside the chip
      ctx.fillStyle = 'rgba(90,210,240,0.22)';
      ctx.fillRect(x + 1, y + 1, 24 * (1 - clamp(cd, 0, 1)), 10);
    }
    text(ctx, glyph, x + 13, y + 2.5, { size: 7, color: ready ? '#5ad2f0' : '#6a7a84', align: 'center' });
  },

  // =============================================================================
  // INSTALL -- the only thing this module reaches out and touches
  // =============================================================================
  // Ocean is a scene, so it does not need the modal's five wraps: main.js already
  // calls scene.update/draw and Game.updateFade already swaps us out. The one
  // thing main.js cannot know about is our touch layout.
  install() {
    if (this._installed) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;

    const tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (typeof Game === 'undefined' || Game.scene !== Ocean) return tLayout();
      if (!G || Game.helpOpen || (typeof Shop !== 'undefined' && Shop.open) ||
          (typeof Bench !== 'undefined' && Bench.open)) return [];
      // swim on the left, verbs on the right, mirroring the dive's pad placement
      return [
        { x: 6, y: H - 52, w: 40, h: 40, key: 'ArrowLeft', icon: 'left' },
        { x: 52, y: H - 52, w: 40, h: 40, key: 'ArrowRight', icon: 'right' },
        { x: W - 46, y: H - 98, w: 40, h: 40, key: 'ArrowUp', icon: 'up' },
        { x: W - 46, y: H - 52, w: 40, h: 40, key: 'ArrowDown', icon: 'down' },
        // a held key for the dash so the same edge detection serves both inputs,
        // and a tap for the roll so it fires exactly once per press
        { x: W - 92, y: H - 52, w: 40, h: 40, key: 'ShiftLeft', icon: 'act' },
        { x: W - 92, y: H - 98, w: 40, h: 40, tap: 'Space', icon: 'oroll' },
        // same help tab the dock has, in the same place
        { x: W - 26, y: 24, w: 20, h: 18, tap: 'KeyH', icon: 'help' },
      ];
    };

    // TouchUI.draw only knows six icon names and draws an empty circle for
    // anything else, so label our two verbs ourselves.
    const tDraw = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tDraw(c);
      if (!this.enabled || typeof Game === 'undefined' || Game.scene !== Ocean) return;
      for (let i = 0; i < this.buttons.length; i++) {
        const b = this.buttons[i];
        if (b.icon !== 'oroll' && b.icon !== 'act') continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (b.icon === 'oroll') {
          // a curled arrow: the spin roll
          c.strokeStyle = 'rgba(255,235,190,0.85)';
          c.lineWidth = 1.4;
          c.beginPath();
          c.arc(cx, cy, 8, 0.5, TAU * 0.86);
          c.stroke();
          c.fillStyle = 'rgba(255,235,190,0.85)';
          c.beginPath();
          c.moveTo(cx + 8, cy - 5); c.lineTo(cx + 3.5, cy - 7.5); c.lineTo(cx + 9.5, cy - 9.5);
          c.closePath(); c.fill();
        } else {
          text(c, '>>', cx, cy - 4, { size: 8, color: 'rgba(255,235,190,0.9)', align: 'center' });
        }
      }
    };
  },
};

// Load-order-agnostic install: Game/TouchUI are const in main.js, so if this file
// is pulled in ahead of it the wrap has to wait for the document.
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Ocean.install();
else document.addEventListener('DOMContentLoaded', () => Ocean.install(), { once: true });
