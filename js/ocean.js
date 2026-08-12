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
// THERE IS A SEABED, and it is the spine of the whole look. floorAt(x) is the one
// answer to "where is the ground here": a shelf that falls away from the dock plus
// three octaves of value noise, sampled into a per-column cache so nothing
// recomputes noise per frame. Every coral, weed, shell, boulder and vent is
// PLANTED on that line -- their base sits on it and they sway from the base, like
// plants. Nothing but driftwood (and bubbles, motes and wildlife) is allowed to
// hang in open water, because floating scenery is exactly what makes a sea read as
// a blue void with stickers in it.
//
// Two consequences worth knowing before you edit:
//   * Planted things CANNOT be parallaxed. A prop drawn at 0.92 while the sand is
//     drawn at 1.0 slides off the sand the moment the camera moves vertically, and
//     that slide is the "floating" the player sees. Ground contact wins; the depth
//     read comes from size, alpha and the hazed layers behind instead.
//   * Depth is distance from home. The shelf runs from FLOOR_TOP just off the
//     pilings to FLOOR_DEEP a few thousand units out, so swimming OUT is how you
//     get DOWN -- which is also what keeps Mining's deep bands reachable now that
//     the sand is solid.
// Above the water line the scene switches treatments: real sky from SKY's day
// palette, a cloud bank on the horizon, sun/moon, chop with foam caps. The switch
// is a lerped camera limit and a screen-space split at the water line, so crossing
// it is continuous rather than a cut.
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
  // The dock ladder: the one way out of the open ocean, at the world origin
  // (Ocean x 0 is directly under Otto's pier).
  DOCK_X: 0, DOCK_R: 46, DOCK_TOP: 54,
  BANK_MAX: 1.02,         // how far the sprite is allowed to pitch into a turn
  IFRAME: 1.1,
  HURT_T: 0.7,
  KNOCK: 210,

  // ---- world tuning -----------------------------------------------------------
  CW: 512, CH: 320,       // chunk size in world units
  CHUNK_CAP: 96,          // cached chunks; eviction is free, they regenerate
  // The sea is a shallow flat shelf now, so both of these come in with it or the
  // palette never leaves its first stop and the light never fades at all.
  DEEP: 520,              // world y where the palette bottoms out
  LIGHT_END: 420,         // world y where surface light (rays, caustics) is gone
  FAR_W: 648,             // on-screen width of one far-layer copy (1.35 screens)
  MID_H: 60, MID_GAP: 560,
  // The layer speeds, and the whole depth read: far 0.16, mid 0.55, the props
  // that sit behind Otto 0.92, Otto and anything gameplay places 1.0, and the
  // near-field props 1.1 -- so the foreground whips past faster than he swims.
  // PAR_BACK and PAR_FRONT now belong to the layers with no ground contact: the
  // distant ridge behind the sand takes PAR_BACK horizontally, and PAR_FRONT is
  // kept for anything a wiring layer wants to put in the near field. Props that
  // stand on the seabed draw at world scale, see the header.
  PAR_FAR: 0.16, PAR_MID: 0.55, PAR_BACK: 0.86, PAR_FRONT: 1.1,
  PX_PER_M: 12,           // matches the dive's depth readout

  // ---- the seabed -------------------------------------------------------------
  // The coast is ZONED. Each zone is a stretch of x with its own depth range,
  // relief, sand palette and species mix, so swimming out is a journey through
  // places rather than a gradient getting darker. RELIEF is the second column:
  // how hard the noise is allowed to push the base line around, which is what
  // separates a lagoon's dunes from the ridge's seamounts.
  //
  // The base line itself comes from SPINE: control points (x, depth) smoothstepped
  // in between. It is authored, not derived — the trench is where the trench is.
  ZONES: [
    { x0: -99999, x1: -2400, key: 'deepwest', name: 'The Dark Shoulder', relief: 7,
      sand: [96, 104, 120], mix: [['thicket', 1], ['ridge', 1.6], ['sparse', 3]] },
    { x0: -2400, x1: -700, key: 'kelp', name: 'Kelp Shelf', relief: 7,
      sand: [148, 158, 128], mix: [['thicket', 4], ['garden', 1], ['sparse', 1]] },
    { x0: -700, x1: 700, key: 'lagoon', name: 'Otter Lagoon', relief: 7,
      sand: [226, 206, 160], mix: [['garden', 2.4], ['sparse', 1.4], ['rubble', 0.8]] },
    { x0: 700, x1: 2500, key: 'gardens', name: 'Coral Gardens', relief: 7,
      sand: [214, 178, 158], mix: [['garden', 4], ['thicket', 1.4], ['rubble', 1]] },
    { x0: 2500, x1: 4600, key: 'ridge', name: 'Dragonback Ridge', relief: 7,
      sand: [104, 96, 104], mix: [['ridge', 3.4], ['rubble', 1.6], ['sparse', 1]] },
    { x0: 4600, x1: 6200, key: 'trench', name: 'The Trench', relief: 7,
      sand: [64, 72, 96], mix: [['ridge', 1.4], ['sparse', 3.4]] },
    { x0: 6200, x1: 99999, key: 'abyss', name: 'Abyssal Plain', relief: 7,
      sand: [140, 138, 148], mix: [['sparse', 4], ['rubble', 1], ['ridge', 0.6]] },
  ],
  // FLAT. The seabed is a gentle shelf and nothing more: it drops away from the
  // pilings and then runs level. The hills, trenches and seamounts read as noise
  // rather than as terrain at this scale, and a floor that heaves under a
  // side-scroller mostly gets in the way of swimming. Relief is a couple of units
  // of drift so the line is not a ruler.
  SPINE: [
    [-9000, 430], [-2400, 400], [-900, 360], [-300, 330], [0, 320],
    [300, 330], [900, 360], [2400, 400], [9999, 430],
  ],  FLOOR_TOP: 230,         // shallowest sand, right off the pilings (lagoon floor)
  FLOOR_DEEP: 3000,       // the trench bottom; depthFrac and fog max out here
  FLOOR_STEP: 8,          // world units between cached profile samples
  FLOOR_CLEAR: 9,         // how close Otto's centre may get to the sand
  FLOOR_SAND: 13,         // thickness of the pale sand band under the lip
  FLOOR_SILT: 22,         // and of the silt band under that
  COL_CAP: 32,            // cached seabed columns (32 * CW = 16k units of coast)

  // ---- pool sizes -------------------------------------------------------------
  BUB_MAX: 96, MOTE_MAX: 72, RING_MAX: 10, SPILL_MAX: 8, SIL_MAX: 3, DROP_MAX: 30,

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
  leaving: 0, forcedExit: false, surfT: 0, atDock: false,
  over: false, overT: 0,
  flash: 0, shakeT: 0, splashT: 0,
  msg: '', msgT: 0,
  time: 0, quality: 1,

  // ---- ZOOM -------------------------------------------------------------------
  // The open sea was framed at the same 480x270 as the dock, and at that width Otto
  // is a small thing in a lot of empty blue -- the sprites, the sand and the plants
  // all lose out. The world layers are drawn through a scale() of ZOOM, so the
  // visible slice of the world is VW x VH logical units instead of W x H.
  //
  // WHAT HAD TO CHANGE, AND WHAT DELIBERATELY DID NOT. Anything that CENTRES on the
  // frame, or measures from its far edge, has to use VW/VH or it aims at a point
  // that is now off screen -- the camera targets, the sky lift, and the few places
  // that sample the world at "the middle of the screen". Those are fixed below.
  //
  // Culling bounds (`if (sx > W) continue`) are deliberately left at W/H. The
  // visible area is now SMALLER than W x H, so a W-wide test is merely generous: it
  // admits a little more than it needs to and can never cull something that is
  // still on screen. Tightening them would buy back a few props' worth of fill and
  // risk a pop-in seam on every one of ~140 call sites, which is a bad trade.
  // Full-frame fills are safe for the mirror-image reason: a W x H rect drawn under
  // the scale over-covers the viewport rather than leaving a gap.
  //
  // The HUD is unaffected -- it is drawn after the world's restore(), in screen
  // space, so it keeps the full 480x270 and stays pixel-exact.
  //
  // WHY A MULTIPLE OF 0.5. The zoom has to keep the art on whole device pixels or
  // the scene goes soft, which would undo more than the zoom gains. Sprites are
  // authored at APIX (0.5 logical units per texel) on a DPX of 4, so one sprite
  // texel covers APIX * DPX * ZOOM = 2 * ZOOM device pixels -- an integer only when
  // ZOOM is a multiple of 0.5. 1.25 would put every sprite on 2.5 device pixels and
  // leave it half a pixel soft, so the usable settings are 1.0, 1.5, 2.0 and there
  // is no fine adjustment between them.
  //
  // 1.5 framed 320x180 and that was a step too far in -- the open sea stopped
  // feeling open. 1.25 backs off to a 384x216 slice, still a clear zoom over the
  // dock's 480x270 but with room to see what is coming.
  //
  // 1.25 puts a sprite texel on 2.5 device pixels, which is OFF the whole-pixel
  // grid: texels come out alternating 2 and 3 device pixels wide. That is uneven,
  // but it is only BLURRY if the sampler interpolates -- so the ocean's world block
  // now disables smoothing for every layer inside it (see draw()). Nearest sampling
  // at 2.5x is crisp with slightly uneven texel widths, which at this size does not
  // read; a bilinear tap at 2.5x would soften the entire scene.
  // back to 1.5 by request: tighter on Otto, and it is the crisp setting (a
  // sprite texel lands on exactly 3 device pixels)
  ZOOM: 1.5,
  // How tall the painted sand strip stands, in logical units: SAND_TILE_W scaled by
  // the strip art's aspect (1447x83). The camera's floor cap is measured off this,
  // so the two cannot drift apart.
  // ---- CURRENTS ---------------------------------------------------------------
  // Sprint is not a button any more. Some stretches of water are MOVING, and while
  // you are in one you are carried -- that is the sprint, and it happens because of
  // where you are rather than because you are holding a key. It gives the open
  // ocean somewhere that is faster than everywhere else, which a flat sea did not
  // have, and it means the touch pad can spend that slot on interact instead.
  //
  // Deterministic per chunk column, like everything else out here, so a stretch of
  // water that pulled you east still pulls you east when you swim back.
  CUR_EVERY: 3,            // roughly one column in three carries one
  CUR_PUSH: 190,           // units/sec the water itself is moving
  CUR_BAND: 120,           // how tall the moving band is
  SAND_TILE_W: 340,
  get SAND_STRIP_H() {
    const s = typeof ASSETS !== 'undefined' && ASSETS['sandstrip_0'];
    return s && s.width ? this.SAND_TILE_W * s.height / s.width : 20;
  },
  get VW() { return W / this.ZOOM; },
  get VH() { return H / this.ZOOM; },

  _bdCv: null, _bdCtx: null,
  _stamp: -1, _installed: false, _init: false,
  _ft: 0.016, _qt: 0,
  _prevDir: null, _tapT: null, _prevDash: false,
  bubbles: null, motes: null, rings: null, spills: null, sils: null, drops: null,
  _chunks: null, _order: null,
  // seabed: one 1-D cache keyed by chunk COLUMN, plus two scratch sample rows for
  // the bed and the ridge behind it (allocated once, refilled every frame)
  _cols: null, _colOrder: null, _fs: 0,
  _fy: null, _gy: null,
  _clouds: null, _sky: 0, _sp: null, _spKey: -1, _landT: 0,
  _farCv: null, _midCv: null, _caCv: null, _rayCv: null, _silCv: null,
  _farW: 0, _farH: 0, _midW: 0, _caW: 0, _caH: 0, _rayW: 0, _rayH: 0,
  SIL_W: 220,             // canonical silhouette bake width; blits scale from it

  // ---- palette ----------------------------------------------------------------
  // Depth stops, lerped per frame. The whole scene reads off these so the water,
  // the haze, the sand and the props can never disagree about how deep it is.
  // Seven stops, not five: the shallow end has to be a green-tinged teal and the
  // 500-1200 range has to move fast, or every depth looks like the same blue.
  STOPS: [
    [0, [86, 190, 206]],
    [190, [52, 156, 190]],
    [520, [30, 112, 160]],
    [1100, [18, 74, 124]],
    [1900, [11, 44, 86]],
    [2900, [6, 22, 52]],
    [4600, [3, 10, 26]],
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
    // The seed IS the world, and both the chunk cache and the seabed profile are
    // derived from it. If a different save is loaded into a live session (new game
    // from the title, mostly) every one of those caches is now a lie.
    if (this._fs !== s.seed) {
      this._fs = s.seed;
      this._chunks.clear(); this._order.length = 0;
      this._cols.clear(); this._colOrder.length = 0;
    }
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
    // Two things share this pool because they are the same draw: a 1x2 speck with
    // an alpha. tone 0 is water thrown off a breach, tone 1 is silt kicked off the
    // sand -- one arcs and dies at the water line, the other swells and settles.
    this.drops = mk(this.DROP_MAX, { r: 1, tone: 0 });
    this.bag = {};
    this._chunks = new Map();
    this._order = [];
    this._cols = new Map();
    this._colOrder = [];
    // Screen-space sample rows for the seabed and the ridge behind it. Sized for
    // the widest step either pass uses, refilled in place every frame.
    this._fy = new Float32Array(Math.ceil(W / this.FLOOR_STEP) + 4);
    this._gy = new Float32Array(Math.ceil(W / 16) + 4);
    this._prevDir = [false, false, false, false];
    this._tapT = [0, 0, 0, 0];
    this.sils = new Array(this.SIL_MAX);
    for (let i = 0; i < this.SIL_MAX; i++) this.sils[i] = { art: '', fx: 0, fy: 0, vx: 0, w: 120, ph: 0 };
    // The cloud bank. Fixed count, fixed art, deterministic layout: it scrolls in
    // its own wide space and is pinned to the horizon, so it never needs updating.
    const crng = mulberry32(0x0C10D5);
    this._clouds = new Array(9);
    for (let i = 0; i < this._clouds.length; i++) {
      this._clouds[i] = {
        i: (crng() * 3) | 0,
        x: crng() * this.CLOUD_SPAN,
        alt: 6 + crng() * 96,               // logical units above the water line
        s: 1.5 + crng() * 2.6,
      };
    }
  },

  CLOUD_SPAN: 900,          // the cloud bank's own wrap-around width

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
    this.leaving = 0; this.forcedExit = false; this.surfT = 0; this.atDock = false;
    this.over = false; this.overT = 0;
    this.flash = 0; this.shakeT = 0; this.splashT = 0;
    this._sky = clamp(-this.py / 26, 0, 1);   // he drops in under the surface
    this._landT = 0;
    this.msg = ''; this.msgT = 0;
    this.anim = 'cruise'; this.animFrame = 'oswim_0';
    this.animPrev = 'oswim_0'; this.animMix = 1; this.animT = 0;
    for (let i = 0; i < this.bubbles.length; i++) this.bubbles[i].t = 0;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].t = 0;
    for (let i = 0; i < this.spills.length; i++) this.spills[i].t = 0;
    for (let i = 0; i < this.drops.length; i++) this.drops[i].t = 0;
    this._prevDash = false;
    for (let i = 0; i < 4; i++) { this._prevDir[i] = false; this._tapT[i] = 0; }
    this._seedMotes();
    this._seedSils();
    s.trips++; s.today++;
    if (typeof SND !== 'undefined') { SND.setScene('dive'); SND.splash(); }
    this._puff(this.px, this.py, 12, 60);
    this._ring(this.px, 2, 3, 160);
    // (the old first-visit toast stack lived here; the journal teaches now)
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
    if (this.forcedExit) Game.toast('You surface gasping. Closer than it needed to be.');
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
  // THE SEABED
  // =============================================================================
  // One function answers "where is the ground here", and everything else in the
  // scene -- the sand, the plants, the vents, the landmarks, the physics -- reads
  // it. It has to be deterministic (the same stretch of coast tomorrow), cheap
  // (called ~130 times a frame) and single-valued in x, which is what makes a
  // 1-D column cache the right shape: the chunk grid is 2-D and the ground is not.

  // 32-bit value hash on the lattice. Folded with the world seed, so a new game is
  // a genuinely different coastline.
  _h1(i) {
    let h = Math.imul((i | 0) ^ this._fs, 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  },

  // Smoothstepped value noise, 0..1. Two hashes per octave; three octaves is all
  // the seabed needs and it only ever runs while a column is being baked.
  _vn(u) {
    const i = Math.floor(u), f = u - i;
    const a = this._h1(i), b = this._h1(i + 1);
    return a + (b - a) * (f * f * (3 - 2 * f));
  },

  // The raw profile. PRIVATE: everything else goes through floorAt so the cache is
  // never bypassed.
  // Which zone owns this x. Linear scan of seven entries; only ever runs while a
  // column is baked or a ridge line is traced, never per pixel.
  zoneAt(x) {
    const Z = this.ZONES;
    for (let i = 0; i < Z.length; i++) if (x < Z[i].x1) return Z[i];
    return Z[Z.length - 1];
  },

  _profile(x) {
    // The authored base line: smoothstep between SPINE control points, so the
    // lagoon is flat where it should be flat and the trench wall is a wall.
    const P = this.SPINE;
    let i = 1;
    while (i < P.length - 1 && x > P[i][0]) i++;
    const a = P[i - 1], b = P[i];
    const t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    const base = a[1] + (b[1] - a[1]) * (t * t * (3 - 2 * t));

    // Relief on top, scaled by the zone: a lagoon ripples, the ridge heaves.
    const z = this.zoneAt(x);
    const n = (this._vn(x / 1700) - 0.5) * 1.24
            + (this._vn(x / 520 + 11.3) - 0.5) * 0.56
            + (this._vn(x / 165 + 41.7) - 0.5) * 0.2;
    let y = base + n * z.relief;

    return Math.max(150, y);
  },

  // One chunk column's worth of seabed: the sampled profile plus every piece of
  // dressing that stands on it. Baked once, then it is pure lookup.
  // How hard the water at (x, y) is moving, and which way. Zero almost everywhere.
  //
  // Derived straight from the column index rather than stored on the column: it is
  // two hashes and a falloff, so caching it would cost more than recomputing, and
  // it stays correct for columns that have not been generated yet (the camera and
  // the animals both ask about water they have not reached).
  _currentAt(x, y) {
    const ci = Math.floor(x / this.CW);
    if (((Math.imul(ci, 374761393) >>> 8) % this.CUR_EVERY) !== 0) return 0;
    // never at the pier: being shoved off the ladder while trying to climb out is
    // the one place a current would only ever be a nuisance
    if (Math.abs(x - this.DOCK_X) < this.DOCK_R * 3) return 0;
    const h = Math.imul(ci, 2654435761) >>> 0;
    const dir = (h & 1) ? 1 : -1;
    // the band sits at its own depth in the column, and fades at both edges so you
    // swim into it rather than hitting a wall of moving water
    const mid = 40 + ((h >>> 3) % 260);
    const d = Math.abs(y - mid);
    if (d > this.CUR_BAND) return 0;
    const k = 1 - d / this.CUR_BAND;
    return dir * k * k * this.CUR_PUSH;
  },

  _col(ci) {
    const key = ci | 0;
    const had = this._cols.get(key);
    if (had) return had;

    const step = this.FLOOR_STEP;
    const n = Math.max(2, Math.round(this.CW / step));
    const x0 = key * this.CW;
    const ys = new Float32Array(n + 1);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= n; i++) {
      const y = this._profile(x0 + i * step);
      ys[i] = y;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const mid = ys[n >> 1];
    // `band` is how deep THIS STRETCH OF SAND is, not how deep the chunk row is.
    // That is the difference between a species mix that follows the coast and one
    // that changes every 320 units of nothing.
    const band = clamp(mid / 2600, 0, 1);

    const rng = mulberry32((Math.imul(this._fs, 2654435761) ^ Math.imul(key, 1597334677)) | 0);
    // The MIX belongs to the ZONE now — the Kelp Shelf is thickets, the Gardens
    // are gardens — with the column rng picking within it, so a zone has an
    // identity and still is not wallpaper.
    const zone = this.zoneAt(x0 + this.CW / 2);
    const kind = weightedPick(zone.mix, rng());
    const rocky = kind === 'ridge' || kind === 'rubble';

    // NO CODED SCENERY. The ripples, pebbles, boulders, rock arches, kelp forests
    // and whale ribs that used to be generated here are gone. Every one of them
    // was drawn with paths rather than art, and against the uploaded sprites they
    // read exactly as what they were -- procedural filler. The sand is a clean
    // line now, and everything standing on it is a sprite the player drew.

    // The FOREGROUND: a handful of oversized, dark, translucent fronds rooted on
    // this column's own sand, drawn in front of Otto. They are the near plane of
    // the three (far ridges / the playfield / these), and they are rooted rather
    // than parallaxed for the same reason everything else is -- a frond sliding
    // across the sand it grows from is floating scenery, and size and blur read
    // as "close" without the lie. Kelp and garden columns only; the ridge stays
    // bare so its skyline shows.
    // Real sprites now, not stroked lines: oversized tall plants from the lush
    // set, translucent, swaying from the root. Even the sparse plain gets the
    // odd one -- a near-plane that only exists in busy places reads as a bug.
    const fg = [];
    {
      const nf = kind === 'thicket' ? 2 + ((rng() * 2) | 0)
        : kind === 'garden' ? 1 + ((rng() * 2) | 0)
        : rng() < 0.25 ? 1 : 0;
      for (let i = 0; i < nf; i++) {
        fg.push({
          x: x0 + rng() * this.CW,
          art: 'lush_' + ((rng() * 8) | 0),          // the tall row
          s: 95 + rng() * 85,                        // far larger than the mid props
          ph: rng() * TAU,
          lean: (rng() - 0.5) * 0.3,
          flip: rng() < 0.5,
          a: 0.42 + rng() * 0.2,
        });
      }
    }

    const c = { ci: key, x0, step, n, y: ys, lo, hi, mid, band, kind, zone, fg, ext: {} };
    this._cols.set(key, c);
    this._colOrder.push(key);
    while (this._colOrder.length > this.COL_CAP) {
      const drop = this._colOrder.shift();
      if (drop !== key) this._cols.delete(drop);
    }
    return c;
  },

  // PUBLIC: the world y of the seabed at x. Linear between 8-unit samples, which
  // is far finer than the shortest wavelength in the profile, so it is smooth.
  // Anything that wants to sit on the ground -- here, in mining.js, in tame.js --
  // should place itself against this and nothing else.
  floorAt(x) {
    if (typeof G === 'undefined' || !G || !this._cols) return this.FLOOR_DEEP;
    if (!isFinite(x)) return this.FLOOR_DEEP;
    const c = this._col(Math.floor(x / this.CW));
    const u = (x - c.x0) / c.step;
    let i = Math.floor(u);
    if (i < 0) i = 0; else if (i > c.n - 1) i = c.n - 1;
    const f = u - i;
    return c.y[i] + (c.y[i + 1] - c.y[i]) * f;
  },

  // how far Otto is off the bottom, in world units (negative means he is in it)
  altitude() { return this.floorAt(this.px) - this.py; },

  // DISTANCE IS THE NEW DEPTH. The seabed is flat and shallow, so "how deep am I"
  // no longer sorts the world -- how far from home does. Every system that used
  // to rank its content by y (ore bands, species bands) reads this instead, and
  // the zones in ZONES are the same axis expressed as names. 0 at the pilings,
  // 1 out past the abyssal plain.
  REMOTE_RUN: 6800,
  remoteFrac(x) {
    const v = Math.abs(x === undefined ? this.px : x) / this.REMOTE_RUN;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
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

  // Everything a chunk owns is either PLANTED on the seabed or ADRIFT in open
  // water, and planted things belong to whichever chunk ROW the sand happens to
  // run through -- `owns` below is that test. Without it every row in a column
  // would dress the same line of sand and the seabed would grow eight coral
  // gardens stacked on one spot.
  SHELL_ART: ['shell_clam', 'shell_mussel', 'shell_cockle', 'shell_scallop', 'urchin_1', 'urchin_3'],
  // WHOLE sprites only. This used to be drift_0/1/2, the driftwood bundle chopped
  // into three "loose logs" -- but the bundle is tied, so every crop carried rope
  // fringe down one edge and a hard chop across the grain, and at scenery size that
  // is what you actually noticed. The cuts are gone from the pipeline (see the
  // driftwood note in dev/process-assets.py for why they cannot be rescued).
  //
  // Variety comes from the per-piece `rot`, `flip` and `s` these props already
  // carry, which is enough: two sprites at random angles and sizes read as scatter,
  // where a chopped stub read as a bug.
  DRIFT_ART: ['res_driftwood', 'res_plank', 'res_driftwood', 'res_plank'],

  _gen(ci, cj, key) {
    // Mix the two axes into the seed with large odd multipliers so neighbours
    // never share a layout (a plain ci+cj*k visibly rhymes along diagonals).
    const seed = ((G.ocean.seed * 7919) ^ Math.imul(ci, 374761393) ^ Math.imul(cj, 668265263)) | 0;
    const rng = mulberry32(seed);
    const x0 = ci * this.CW, y0 = cj * this.CH;
    // The species mix and the depth band come off the COLUMN, because they are
    // properties of this stretch of coast rather than of a 320-unit slice of water.
    const col = this._col(ci);
    const band = col.band;                        // 0 sunlit shelf, 1 the deep plain
    const kind = col.kind;
    // LUSH. Densities roughly doubled across the board: the sand should read as
    // a meadow with clearings, not a desert with the odd plant. Sparse columns
    // stay genuinely sparse so the busy ones have something to contrast with.
    // Two zooms tighter than when these were tuned, the doubled densities read
    // as clutter -- every screen was FULL of plants. Trimmed back toward gardens
    // with clearings; the lush mix itself is unchanged.
    const dens = kind === 'garden' ? 1.3 : kind === 'thicket' ? 1.15
      : kind === 'ridge' ? 0.6 : kind === 'rubble' ? 0.55 : 0.3;
    const shellCh = kind === 'rubble' ? 0.3 : kind === 'sparse' ? 0.2 : 0.1;
    const nBack = Math.round((5 + rng() * 8) * dens);
    const nFront = Math.round((3 + rng() * 4) * dens);
    const props = [];
    const owns = (fy) => fy >= y0 && fy < y0 + this.CH;

    // Coral art is 20 variants; pick a small palette per chunk and stay with it so
    // a chunk has an identity instead of being confetti.
    const palette = (rng() * 20) | 0;
    const weedPal = (rng() * 12) | 0;
    // A thicket is WEED (the twelve uploaded plants), a garden is CORAL, and both
    // scatter the odd shell. Picking the family off the zone's own kind is what
    // makes the Kelp Shelf look like a kelp shelf.
    const weedy = kind === 'thicket';
    const plant = (front) => {
      const x = x0 + rng() * this.CW;
      const shell = rng() < shellCh;
      // Three families now: the 32-piece lush set (tall 0..7, small 8..15,
      // flowering 16..23, berried 24..31), the original weeds, and the corals.
      // Thickets leans hard into lush greens; gardens mix flowering lush with
      // coral so they read as planted rather than merely overgrown.
      const r = rng();
      const lushSp = (weedPal + ((rng() * 3) | 0)) % 8;
      const art = shell
        ? this.SHELL_ART[(rng() * this.SHELL_ART.length) | 0]
        : weedy
          ? (r < 0.45 ? 'lush_' + lushSp                       // tall
            : r < 0.7 ? 'lush_' + (8 + lushSp)                 // small
            : r < 0.82 ? 'lush_' + (24 + lushSp)               // berried
            : 'weed_' + ((weedPal + ((rng() * 4) | 0)) % 12))
          : (r < 0.3 ? 'lush_' + (16 + lushSp)                 // flowering
            : r < 0.5 ? 'lush_' + (8 + lushSp)
            : 'coral_' + ((palette + ((rng() * 4) | 0)) % 20));
      const soft = !shell && rng() < (kind === 'thicket' ? 0.78 : 0.42);
      // Near-field props are bigger AND crisper; the back row is small and dim.
      // With no parallax left to sell depth, this ratio is doing that whole job.
      const s = shell ? (front ? 9 + rng() * 7 : 5 + rng() * 4)
        : front ? 34 + rng() * 24 * (1 - band * 0.3) : 14 + rng() * 18;
      const fy = this.floorAt(x);
      if (!owns(fy)) return;                      // another row's patch of sand
      props.push({
        art,
        x,
        y: fy,                                    // y IS THE BASE for a planted prop
        s,
        front,
        base: true,
        // bedded in by a texel or three, so nothing balances on the line
        sink: shell ? 1 + rng() * 1.6 : 2 + rng() * 3.5,
        // seaweed sways, hard coral barely moves, a shell not at all; stiffness is
        // what the sway reads as
        stiff: shell ? 1 : soft ? 0.16 + rng() * 0.22 : 0.7 + rng() * 0.26,
        ph: rng() * TAU,
        flip: rng() < 0.5,
        // BRIGHT. These used to be multiplied down by depth and again by night,
        // and the two together drained the colour out of art that is already
        // painted with its own shading. The back row stays a little softer than
        // the near row -- that is depth -- but nothing is washed out any more.
        dim: front ? 1 : 0.82 + rng() * 0.18,
        wreck: false,
        rot: 0,
      });
    };
    for (let i = 0; i < nBack; i++) plant(false);
    for (let i = 0; i < nFront; i++) plant(true);

    // ADRIFT: driftwood, and only driftwood. It is the one thing that has any
    // business hanging in open water, so it is the one thing allowed to.
    const nd = rng() < 0.55 ? 1 + ((rng() * 2) | 0) : 0;
    for (let i = 0; i < nd; i++) {
      const x = x0 + rng() * this.CW;
      const y = y0 + 18 + rng() * (this.CH - 36);
      // keep it clear of the bed, or a "floating" plank lands in the sand and
      // reintroduces exactly the thing we are fixing
      if (y > this.floorAt(x) - 34) continue;
      props.push({
        art: this.DRIFT_ART[(rng() * this.DRIFT_ART.length) | 0],
        x, y,
        s: 11 + rng() * 13,
        front: rng() < 0.3,
        base: false,
        sink: 0,
        stiff: 1,
        ph: rng() * TAU,
        flip: rng() < 0.5,
        dim: 0.9 + rng() * 0.1,
        wreck: false,
        rot: (rng() - 0.5) * 1.2,                 // its own resting angle
      });
    }

    // Deep water gets the occasional sunken ship, held as a silhouette and RESTING
    // ON THE SAND. It is the one thing out there big enough to navigate by.
    if (band > 0.4 && rng() < 0.12) {
      const x = x0 + rng() * this.CW;
      const fy = this.floorAt(x);
      if (owns(fy)) {
        props.push({
          art: 'ship', x, y: fy,
          s: 190 + rng() * 90, front: false, base: true, sink: 10 + rng() * 16,
          stiff: 1, ph: rng() * TAU, flip: rng() < 0.5,
          dim: 0.72 + rng() * 0.18, wreck: true, rot: 0,
        });
      }
    }

    // Air pockets: a vent hissing out of the seabed is a lung down here, and it is
    // what makes the deep worth committing to.
    const vents = [];
    const nv = rng() < 0.4 ? 1 + ((rng() * 2) | 0) : 0;
    for (let i = 0; i < nv; i++) {
      const x = x0 + rng() * this.CW;
      const fy = this.floorAt(x);
      if (!owns(fy)) continue;
      vents.push({ x, y: fy - 2, next: rng() * 0.8, ph: rng() * TAU });
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

    // THE WAY HOME IS THE DOCK. Surfacing anywhere used to end the trip, which
    // made the whole sea one screen deep -- you never had to know where you were,
    // because up was always out. Now the only exit is the ladder under your own
    // pier: swim back to it and climb. Breaking the surface mid-ocean does
    // exactly what it should, which is let you breathe.
    if (this.leaving) {
      if (this.py <= 0.5) { this._exit(); return; }
      return;
    }
    this.atDock = Math.abs(this.px - this.DOCK_X) < this.DOCK_R &&
                  this.py < this.DOCK_TOP && this.py > -60;
    if (this.atDock && Input.p('KeyE')) { this.surface(false); return; }
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
      if (this.py < -5) {
        // An AIRBORNE roll keeps its spin but hands the arc to gravity: the pin
        // to rdx/rdy below would hold him at roll speed forever above the water,
        // and it is exactly this hand-off that turns a surface roll into a leap.
        this.vy += this.GRAV_AIR * dt;
        this.vx *= Math.pow(0.75, dt);
        this.spin = 1 - k;
      } else {
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
      }
      if (this.rollT <= 0) { this.rollT = 0; this.spin = 0; }
    } else if (this.py < -5) {
      // properly airborne after a hard ascent: no purchase on anything, just an
      // arc. The -5 band above the water still steers, because a floating otter
      // sits a shade above zero and must never lose control there.
      this.vy += this.GRAV_AIR * dt;
      this.vx *= Math.pow(0.6, dt);
    } else {
      // THE CURRENT CARRIES YOU. Applied before the swim so it is water moving Otto
      // rather than Otto swimming faster: it works whatever he is doing, including
      // nothing, and it pushes him sideways while he holds still. `cur` is also
      // what the sprint pose and the HUD pip read, so the sprint IS the current.
      const cur = this._currentAt(this.px, this.py);
      this.cur = cur;
      if (cur !== 0) {
        // pull his velocity TOWARD the water's, not add to it -- adding would let a
        // long current accelerate him without limit
        const want = cur;
        this.vx += (want - this.vx) * clamp(dt * 1.7, 0, 1);
        if (Math.random() < dt * 12) {
          this._puff(this.px - Math.sign(cur) * 10, this.py + rand(-8, 8), 1, 16);
        }
      }
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
    // High enough that a roll-launch has a real arc in it; the sky camera opens
    // up to follow, so the ceiling is about physics, not about the frame.
    if (this.py < -150) { this.py = -150; if (this.vy < 0) this.vy = 0; }

    // ---- the sand is solid ------------------------------------------------------
    // A soft stop, not a wall: he beds into it, keeps his sideways momentum (sand
    // is draggy, so a little less of it), and kicks up silt when he lands hard.
    // This is also what makes the seabed read as ground rather than as a painting.
    if (this._landT > 0) this._landT -= dt;
    const fy = this.floorAt(this.px) - this.FLOOR_CLEAR;
    if (this.py > fy) {
      const impact = this.vy;
      this.py = fy;
      if (this.vy > 0) this.vy = -this.vy * 0.16;
      this.vx *= Math.pow(0.55, dt);
      if (impact > 70 && this._landT <= 0) {
        this._landT = 0.35;
        this._silt(this.px, fy + this.FLOOR_CLEAR - 1, impact > 160 ? 7 : 4);
        if (typeof SND !== 'undefined') SND.thump(clamp(impact / 260, 0.2, 1));
      }
    }

    // breaking the surface, in either direction
    if (wasAbove !== (this.py < 0) && Math.abs(this.vy) > 45) {
      // THE LAUNCH. A spin roll carried through the surface keeps its energy and
      // gets more: the roll becomes a leap. This is the one place speed is added
      // rather than bled, and it is gated on the roll so an ordinary ascent still
      // breaches like a swimmer and not like a missile.
      if (!wasAbove && this.rollT > 0 && this.vy < 0) {
        this.vy = -clamp(Math.abs(this.vy) * 1.5, 200, 300);
        this.rollT = Math.max(this.rollT, 0.45);   // keep spinning through the arc
        this._drip(this.px, -2, 10, 160);
        this._ring(this.px, 0, 4, 260);
      }
      this.splashT = 0.45;
      this._puff(this.px, 0, 9, 70);
      this._ring(this.px, 0, 3, 200);
      // Water thrown clear of the sea is the whole reason a breach reads as one.
      this._drip(this.px, -2, 12, Math.abs(this.vy));
      if (typeof SND !== 'undefined') SND.splash();
    }
    // and a trail of it while he is genuinely airborne
    if (this.py < -3 && this.speed() > 55 && Math.random() < dt * 20) this._drip(this.px, this.py, 1, 40);

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

  // Water thrown off a breach: it arcs, and it dies the instant it touches the sea
  // again, which is what sells the water line as a boundary.
  _drip(x, y, n, force) {
    const f = clamp((force || 60) / 140, 0.4, 1.6);
    for (let i = 0; i < n; i++) {
      const d = this._take(this.drops);
      d.x = x + rand(-5, 5); d.y = y + rand(-4, 2);
      d.vx = rand(-70, 70) * f + this.vx * 0.22;
      d.vy = rand(-150, -30) * f;
      d.r = rand(0.7, 1.6);
      d.tone = 0;
      d.life = d.t = rand(0.4, 1.1);
    }
  },

  // Silt kicked off the bottom: it swells, drifts and settles instead of falling.
  _silt(x, y, n) {
    for (let i = 0; i < n; i++) {
      const d = this._take(this.drops);
      d.x = x + rand(-7, 7); d.y = y + rand(-3, 2);
      d.vx = rand(-26, 26); d.vy = rand(-16, -3);
      d.r = rand(2.4, 5.5);
      d.tone = 1;
      d.life = d.t = rand(0.7, 1.5);
    }
  },

  _particles(dt) {
    this._bokehTick(dt);
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
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.tone === 0) {
        d.vy += 320 * dt;                               // in air, so it just falls
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.y > 0.5) d.t = 0;                          // back in the sea
      } else {
        const f = Math.pow(0.18, dt);
        d.vx *= f; d.vy *= f;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.r += 7 * dt;                                   // a cloud, not a pellet
      }
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
      // ...and come to rest on the sand instead of sinking forever
      const fl = this.floorAt(s.x) - 2;
      if (s.y > fl) { s.y = fl; if (s.vy > 0) s.vy *= -0.2; s.vr *= 0.4; }
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

      // ---- ambient life in the water ------------------------------------------
      // A slow seep of tiny bubbles off the meadow (any random x near the camera
      // whose sand is in frame), and Otto's own breath: a little cluster off his
      // head every few seconds. Neither costs anything -- both feed the existing
      // recycled pool -- and together they are most of what makes the water feel
      // inhabited rather than merely tinted.
      if (Math.random() < dt * 4) {
        const sx = this.camX + Math.random() * W;
        const sy = this.floorAt(sx);
        if (sy - this.camY < H + 10) {
          const b = this._take(this.bubbles);
          b.x = sx; b.y = sy - 3;
          b.vx = rand(-3, 3); b.vy = rand(-14, -8);
          b.r = rand(0.5, 1.3);
          b.wob = rand(TAU); b.sp = rand(0.8, 2);
          b.air = false;
          b.life = b.t = rand(2, 4);
        }
      }
      this._breathT = (this._breathT || 0) - dt;
      if (this._breathT <= 0 && this.py > 4) {
        this._breathT = rand(2.2, 3.8);
        this._puff(this.px + this.face * 7, this.py - 4, 2 + (Math.random() * 2 | 0), 20);
      }
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
    // VW/VH, not W/H: the frame shows a smaller slice of the world now, so
    // centring on W/2 would park Otto well right of centre.
    const tx = this.px - this.VW * 0.5 + clamp(this.vx * 0.28, -52, 52);
    const ty = this.py - this.VH * 0.46 + clamp(this.vy * 0.20, -34, 40);
    // How much sky the frame is allowed to give up. Underwater the water line stays
    // near the top -- the interesting things are below him. Once he is genuinely
    // clear of the sea it opens to nearly two thirds of the frame, so a breach
    // shows real sky instead of a blue ceiling. `_sky` is lerped and the camera
    // itself eases, so the two treatments cross over continuously: there is no cut.
    // The sky share starts opening BEFORE he leaves the water: swimming along the
    // top at py~0 already gives about a third of the frame to the sky, so the
    // surface is a place you can look around from, not a ceiling you hug. A full
    // launch still opens it to nearly two thirds.
    const airK = clamp((10 - this.py) / 44, 0, 1);
    this._sky = lerp(this._sky, airK, clamp(dt * 3.2, 0, 1));
    const lift = lerp(this.VH * 0.24, this.VH * 0.66, this._sky);
    const k = 1 - Math.pow(0.0025, dt);
    // THE CURRENT: a slow figure-of-eight drift that fades in as Otto slows down
    // and vanishes entirely at speed. Hovering, the frame breathes like the water
    // it is looking through; swimming, the camera is all business. Applied to the
    // TARGET, not the camera, so the ease above keeps smoothing it.
    // The idle "current" sway is gone: a camera that drifts on its own reads as
    // the picture wobbling, not as water. The camera moves only when Otto does.
    const swx = 0, swy = 0;
    this.camX += (tx + swx - this.camX) * k;

    // ---- the floor clamp -------------------------------------------------------
    // The camera used to follow Otto all the way down with no lower bound, so
    // sitting on the seabed put the sand line near the middle of the frame and gave
    // the bottom half of the screen to whatever is UNDER the sand. That was survivable
    // while four stacked palette bands lived down there; now that the sand is one
    // painted strip over one fill, it is a large flat field and there is nothing to
    // look at. The honest fix is not to draw more mass under the floor, it is to stop
    // pointing the camera at it: the sand line is held at 80% of the frame or lower,
    // so the fill is only ever the thin dark hem beneath the strip.
    //
    // GUARDED, because the two bounds can cross. In shallow water the bed cap can sit
    // ABOVE the sky lift, and applying them in the wrong order would pin the camera to
    // the wrong one -- the same trap as the dock's clamp(v, 0, negative), which
    // returned the negative and slid the whole scene.
    // The cap is measured from the SAND SPRITE, not from a fraction of the frame.
    // The strip is seated 6 units above the floor line and stands SAND_STRIP_H tall,
    // so stopping the camera with its bottom edge just past the strip's bottom puts
    // the painted sand along the very bottom of the screen and shows none of the
    // fill beneath it -- which is the whole point of having replaced the old
    // stacked bands with one colour.
    let tyc = Math.max(ty + swy, -lift);
    const bedCap = this.floorAt(this.px) + this.SAND_STRIP_H - 6 - this.VH;
    if (bedCap > -lift) tyc = Math.min(tyc, bedCap);
    this.camY += (tyc - this.camY) * k;
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
    // riding a current uses the same streamlined pose as a dash: being swept along
    // fast should not look like an idle paddle
    else if (Math.abs(this.cur || 0) > this.CUR_PUSH * 0.45 &&
             this.cur * this.vx > 0 && this.speed() > 90) a = 'dash';
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
    // baked soft, like the far layer: distance underwater IS blur
    if (typeof c.filter === 'string') c.filter = 'blur(1.1px)';
    c.drawImage(img, 0, 0, pw, ph);
    if (typeof c.filter === 'string') c.filter = 'none';
    // sea_mid is a JPEG: no alpha, its own flat water behind the reef. Drawn
    // as-is the tile's top edge is a razor line of the WRONG blue -- the slab
    // artifact. Fade the top half out (baked once, so the gradient is allowed)
    // and the silhouettes rise out of open water instead.
    const g = c.createLinearGradient(0, 0, 0, ph);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = g;
    c.fillRect(0, 0, pw, ph);
    c.globalCompositeOperation = 'source-over';
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
    // THE ZOOM. Everything from here to the matching restore() draws into a
    // VW x VH viewport; see the ZOOM note up in the state block. The shake is
    // applied outside it on purpose, so a knock is the same distance on screen
    // whatever the zoom is.
    if (this.ZOOM !== 1) ctx.scale(this.ZOOM, this.ZOOM);
    // NEAREST for the whole world block. Every layer in here is either pixel art or
    // a baked soft image whose blur is already in the bake -- the rays, the
    // caustics and the far band each say so at their own draw site, having each
    // been measured as a filtered-blit cost. Setting it once at the top makes the
    // zoom safe at 1.25 (see ZOOM) and retires several local save/restore pairs
    // worth of the same flag. Restored by the matching restore() below.
    const _worldSm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    // The four backdrop layers together cover roughly five screens of fill, and
    // on a software canvas at 1920x1080 that alone measured 110ms a frame. They
    // are all soft, out-of-focus things, so they are composited at HALF device
    // resolution into a reused canvas and upscaled in one blit: a quarter of the
    // fill for a difference the haze hides anyway. The surface line stays on the
    // main context — it is the one crisp thing up there.
    // STRAIGHT TO THE SCREEN. These four layers used to be composited into a
    // half-resolution scratch canvas and blitted up in one go, which was a real
    // saving on fill -- but that canvas-to-canvas blit turned out to be the bug
    // you hit: INTERMITTENTLY (about two runs in three) it painted a single flat
    // colour over the whole frame instead of the backdrop, while the backdrop
    // canvas itself was provably correct every time. Chromium's accelerated
    // canvas can serve a stale/degenerate read of a source surface that was
    // written in the same frame, and no amount of ordering made it reliable.
    //
    // Drawing them directly costs more fill and is worth every millisecond: the
    // layers are cheap now (flat bands and source-clipped blits, not the 46ms
    // full-copy the optimisation was originally built for).
    this._drawWater(ctx, t);
    this._drawFar(ctx, t);
    this._drawMid(ctx, t);
    this._drawFloorFar(ctx);
    this._drawHaze(ctx);
    this._drawSurfaceLine(ctx, t);
    this._drawRays(ctx, t);
    this._drawSunGlow(ctx, t);
    // The seabed is the one crisp thing in the distance, so it lands on the main
    // context rather than in the half-res backdrop -- and it goes down AFTER the
    // rays, because light shafts stop at the sand.
    this._drawFloor(ctx, t);
    this._drawHome(ctx, t);
    this._drawProps(ctx, t, false);
    this._drawMotes(ctx, t);
    this._drawBubbles(ctx);
    this._drawDrops(ctx);
    this._drawSpills(ctx);
    this._drawOtto(ctx, t);
    this._drawProps(ctx, t, true);
    this._drawForeground(ctx, t);
    this._drawCaustics(ctx, t);
    this._drawRings(ctx);
    this._drawSurfaceFoam(ctx, t);
    this._drawDeepTint(ctx);
    this._drawWaterVeil(ctx);
    this._drawBokeh(ctx, t);

    ctx.imageSmoothingEnabled = _worldSm;
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
  // Where on screen the water starts. Everything that is "underwater treatment"
  // (the bands, the haze, the deep tint) is clipped to below this by arithmetic
  // rather than by ctx.clip, because a clip is a per-pixel cost and this is a
  // horizontal split.
  _waterTop() { return clamp(-this.camY, 0, this.VH); },

  _drawWater(ctx, t) {
    const wy0 = this._waterTop();
    if (wy0 > 0.5) this._drawSky(ctx, t, wy0);
    if (wy0 >= H) return;
    // Twelve flat bands, each sampling the depth ramp at its OWN centre rather than
    // lerping two endpoints -- the ramp is deliberately non-linear now, and that is
    // what makes the descent read. A canvas gradient over 1920x1080 every frame is
    // exactly the thing this codebase has been burned by; twelve fillRects cost
    // nothing.
    const nf = this._nightF();
    const BANDS = 12, bh = (H - wy0) / BANDS;
    for (let i = 0; i < BANDS; i++) {
      let c = this._tintAt(this.camY + wy0 + (i + 0.5) * bh);
      if (nf > 0) c = rgbLerp(c, [6, 14, 34], nf * 0.6);
      ctx.fillStyle = cssRGB(c);
      ctx.fillRect(0, wy0 + i * bh, W, bh + 0.6);
    }
  },

  // ---- above the water --------------------------------------------------------
  // SKY.pal is the game's day palette and reusing it is the only way the open sea
  // and the pier can agree about what time it is. It allocates eight arrays, so it
  // is cached per clock step (the clock advances 1/300 per second: a step every
  // 2.5s) instead of being called per frame.
  _skyPal(clock) {
    const key = Math.round(clock * 120);
    if (this._spKey === key && this._sp) return this._sp;
    if (typeof SKY !== 'undefined' && SKY.pal) {
      this._sp = SKY.pal(clock);
      this._spKey = key;
      return this._sp;
    }
    // SKY missing is not a crash: a plain day sky, once.
    if (!this._sp) {
      this._sp = [[18, 87, 184], [58, 146, 216], [143, 212, 242],
        [99, 210, 234], [65, 191, 226], [42, 166, 212], [255, 251, 224], [255, 255, 255]];
      this._spKey = key;
    }
    return this._sp;
  },

  // sh = how many screen units of sky there are, measured down to the water line.
  _drawSky(ctx, t, sh) {
    const clock = typeof G !== 'undefined' && G ? G.clock : 0.3;
    const p = this._skyPal(clock);
    const nite = typeof nightness === 'function' ? nightness(clock) : 0;

    // Seven bands, top colour into mid into low. Flat fills, no gradient.
    const BN = 7, bh = sh / BN;
    for (let i = 0; i < BN; i++) {
      const f = i / (BN - 1);
      const c = f < 0.5 ? rgbLerp(p[0], p[1], f * 2) : rgbLerp(p[1], p[2], (f - 0.5) * 2);
      ctx.fillStyle = cssRGB(c);
      ctx.fillRect(0, i * bh, W, bh + 0.6);
    }

    // Stars: one fillStyle, alpha per star, deterministic positions.
    if (nite > 0.12 && sh > 22) {
      const rng = mulberry32(0x57A45);
      ctx.fillStyle = '#eef4ff';
      for (let i = 0; i < 40; i++) {
        const sx = rng() * W, sy = rng() * (sh - 8), ph = rng() * TAU;
        ctx.globalAlpha = nite * (0.35 + 0.5 * Math.abs(Math.sin(t * 0.9 + ph)));
        ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // Sun or moon on the same arc the pier uses, so they rise together.
    if (sh > 8) {
      const isDay = clock > 0.09 && clock < 0.72;
      const tt = isDay ? (clock - 0.09) / 0.63
        : clamp((clock >= 0.72 ? clock - 0.72 : clock + 0.28) / 0.37, 0, 1);
      const bx = 44 + tt * (W - 88);
      const by = sh - 8 - Math.sin(tt * Math.PI) * (sh * 0.62 + 20);
      const R = isDay ? 10 : 7;
      const col = p[6];
      for (let i = 3; i >= 1; i--) {
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.06 * i})`;
        ctx.beginPath(); ctx.arc(bx, by, R + i * 5, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = cssRGB(col);
      ctx.beginPath(); ctx.arc(bx, by, R, 0, TAU); ctx.fill();
      if (!isDay) {
        // bite a crescent out of the moon with the sky behind it
        ctx.fillStyle = cssRGB(rgbLerp(p[0], p[1], 0.4));
        ctx.beginPath(); ctx.arc(bx + R * 0.55, by - R * 0.3, R * 0.92, 0, TAU); ctx.fill();
      }
    }

    // The cloud bank, pinned to the horizon and scrolling at a hair of the camera:
    // three canvases baked by sprites.js, blitted, never rebuilt.
    if (typeof SPR !== 'undefined' && SPR.clouds) {
      const SPAN = this.CLOUD_SPAN;
      ctx.globalAlpha = 0.9 * (1 - nite * 0.55);
      for (let i = 0; i < this._clouds.length; i++) {
        const c = this._clouds[i];
        const cv = SPR.clouds[c.i % SPR.clouds.length];
        if (!cv) continue;
        const w = cv.width / DPX * c.s, hh = cv.height / DPX * c.s;
        let x = c.x - this.camX * 0.045;
        x = ((x % SPAN) + SPAN) % SPAN - 210;
        const y = sh - c.alt - hh;
        if (x > W + 20 || x + w < -20 || y + hh < -8) continue;
        ctx.drawImage(cv, x, y, w, hh);
      }
      ctx.globalAlpha = 1;
    }

    // The sea meeting the sky. A couple of flat bands of the far-water colour is
    // all a side-on horizon needs, and it stops the water line from looking like a
    // cut edge.
    const far = p[3];
    ctx.fillStyle = `rgba(${far[0]},${far[1]},${far[2]},0.85)`;
    ctx.fillRect(0, sh - 3.5, W, 3.5);
    ctx.fillStyle = `rgba(${p[5][0]},${p[5][1]},${p[5][2]},0.5)`;
    ctx.fillRect(0, sh - 6, W, 2.6);
  },

  // The water line, from either side. Seen from below it is a bright wobbling lip
  // -- the thing that makes "up" legible from any depth. Seen from above it is a
  // skyline: a far chop row, the line itself, a near chop row with white caps and
  // sun glitter. `air` crossfades between the two treatments off the same geometry,
  // so swimming up through it is continuous.
  _drawSurfaceLine(ctx, t) {
    const surf = -this.camY;
    if (surf < -8 || surf > H + 8) return;
    const cx = this.camX;
    const air = clamp(surf / 46, 0, 1);
    const p = this._skyPal(typeof G !== 'undefined' && G ? G.clock : 0.3);

    // FAR CHOP: a low, desaturated row a few units above the line. This is the one
    // thing that turns a flat waterline into open sea once the camera is above it.
    if (air > 0.02) {
      const far = p[4];
      ctx.fillStyle = cssRGB(far);
      for (let x = 0; x < W; x += 6) {
        const w1 = Math.sin(t * 1.1 + (x + cx) * 0.035) * 1.1 + Math.sin(t * 2.3 + (x + cx) * 0.012) * 0.8;
        ctx.globalAlpha = 0.5 * air;
        ctx.fillRect(x, surf - 4 + w1, 6, 1.7);
      }
      ctx.globalAlpha = 1;
    }

    // the line itself: brightest thing in frame, from below especially
    ctx.fillStyle = `rgba(226,248,255,${(0.5 - air * 0.16).toFixed(3)})`;
    ctx.fillRect(0, surf - 1, W, 1.4);

    // NEAR CHOP + CAPS. One fillStyle for the whole row; the crest drives alpha and
    // the caps, which is the house rule for anything this repetitive.
    ctx.fillStyle = '#eaf9ff';
    for (let x = 0; x < W; x += 5) {
      const ph = (x + cx) * 0.07;
      const crest = Math.sin(t * 1.7 + ph) * 0.6 + Math.sin(t * 3.1 + ph * 0.31) * 0.4;
      const y = surf - 2.2 + crest * (1.5 + air * 2.1);
      ctx.globalAlpha = 0.16 + 0.16 * (crest + 1);
      ctx.fillRect(x, y, 5, 1);
      if (air > 0.12 && crest > 0.6) {
        ctx.globalAlpha = 0.5 * air;
        ctx.fillRect(x + 0.6, y - 1.7, 3.4, 1.4);
      }
    }

    // Sun glitter, anchored in WORLD space on a 34-unit lattice so it twinkles in
    // place instead of sliding along with the camera.
    const clock = typeof G !== 'undefined' && G ? G.clock : 0.3;
    if (air > 0.1 && clock > 0.12 && clock < 0.7) {
      const i0 = Math.floor(cx / 34);
      for (let i = 0; i <= 15; i++) {
        const wx = (i0 + i) * 34;
        const sx = wx - cx;
        if (sx < -6 || sx > W + 6) continue;
        const tw = Math.sin(t * 3.1 + wx * 0.21);
        if (tw < 0.3) continue;
        ctx.globalAlpha = (tw - 0.3) * 0.85 * air;
        ctx.fillRect(sx, surf - 2, 2.4, 1.2);
      }
    }
    ctx.globalAlpha = 1;
  },

  // ---- far layer + silhouettes ------------------------------------------------
  _drawFar(ctx, t) {
    const fade = clamp(1 - Math.max(0, this.camY) / 900, 0, 1);
    if (fade <= 0.01) return;
    const cv = this._farLayer();
    if (!cv) return;
    // UNFILTERED. Since the half-res backdrop went away this draws at full device
    // resolution, and a bilinear tap on ~2M destination pixels was measured at
    // 65ms -- the same lesson as the rays and the caustics, relearned a third
    // time. The layer is baked blurred; nearest sampling of it is invisible.
    const _sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const lw = this._farW, lh = this._farH;
    // 0.16 is the slowest thing on screen; the whole depth read hangs off the
    // ratio between this, the mid band (0.55) and the props (1.0)
    const ox = this.camX * this.PAR_FAR;
    // Slide within the layer's slack, but never above the water line: sea_bg is
    // an underwater painting and must not be drawn over the sky.
    const oy = Math.max(-this.camY, clamp(-this.camY * 0.1, -(lh - H), 0));
    const i0 = Math.floor(ox / lw);
    ctx.save();
    // The far layer is meant to be a suggestion, not a painting you can read: it
    // stays soft and low-contrast so the mid band and the seabed carry the depth.
    ctx.globalAlpha = 0.6 * fade * (1 - this._nightF() * 0.55);
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
    ctx.imageSmoothingEnabled = _sm;

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
    // The reef band SITS ON the distant ridge — the same parallax, profile and
    // lift as the nearer of _drawFloorFar's two lines, whose fill is drawn right
    // after this and so covers the tile's bottom edge. It used to repeat at fixed
    // heights through the whole water column, and a reef strip hanging mid-water
    // with a razor bottom edge was the single worst "everything is floating" in
    // the scene. Now it only exists where its ground does; deep open water gets
    // haze and silhouettes instead, which is what deep open water looks like.
    const par = 0.78, lift = 46;
    const cx = this.camX * par, cy = this.camY * par;
    const nf = this._nightF();
    const _sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;           // baked soft; see _drawFar
    const i0 = Math.floor(cx / tw);
    for (let i = i0; i * tw - cx < W; i++) {
      const x = i * tw - cx;
      if (x + tw < 0) continue;
      // The ridge slopes under the flat-bottomed tile, so sample the line at both
      // ends and the middle and seat the tile on the LOWEST of them: a reef half
      // buried in a dune is a reef; a reef with water under one corner is floating.
      const p0 = this._profile(x + cx), p1 = this._profile(x + tw / 2 + cx), p2 = this._profile(x + tw + cx);
      const gy = Math.max(p0, p1, p2) - lift - cy;
      const sy = gy - this.MID_H + 4;
      if (sy > H || sy + this.MID_H < -20) continue;
      const fade = clamp(1 - Math.max(0, p1) / 3200, 0.15, 1) * (1 - nf * 0.5);
      ctx.globalAlpha = 0.8 * fade;
      // flip every other tile: the source tiles cleanly, and this stops the eye
      // from finding the repeat
      if (i & 1) {
        ctx.save();
        ctx.translate(x + tw, sy);
        ctx.scale(-1, 1);
        ctx.drawImage(cv, 0, 0, tw, this.MID_H);
        ctx.restore();
      } else {
        ctx.drawImage(cv, x, sy, tw, this.MID_H);
      }
    }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = _sm;
  },

  // ---- the seabed -------------------------------------------------------------
  // Its palette is keyed to the depth of the sand in frame, so the same bank is
  // warm cream in the lagoon and cold grey out on the plain. Quantised and cached:
  // the strings only get rebuilt when the depth or the hour has actually moved.
  _bpal: null, _bkey: -1,

  _bedPal(mid) {
    const nf = this._nightF();
    const key = (((mid / 12) | 0) * 32) + ((nf * 16) | 0);
    if (this._bkey === key && this._bpal) return this._bpal;
    const wt = this._tintAt(mid);
    const df = clamp(mid / this.DEEP, 0, 1);
    const k = 0.3 + df * 0.44;
    // one helper, so every tone drowns in the same water colour at the same rate
    const tone = (base, mix) => {
      let c = rgbLerp(base, wt, clamp(mix, 0, 1));
      if (nf > 0) c = rgbLerp(c, [6, 14, 34], nf * 0.5);
      return cssRGB(c);
    };
    const o = this._bpal || (this._bpal = {});
    o.lip = tone([252, 240, 212], k * 0.55);
    o.sand = tone([224, 202, 160], k);
    o.silt = tone([150, 126, 94], k + 0.08);
    o.dark = tone([52, 44, 36], 0.2 + df * 0.22);
    o.peb0 = tone([198, 178, 140], k * 0.85);
    o.peb1 = tone([104, 90, 70], k + 0.05);
    o.rip = tone([246, 232, 201], k * 0.6);
    o.mark = tone([28, 30, 36], 0.34 + df * 0.2);
    this._bkey = key;
    return o;
  },

  // The ridge BEHIND the sand: same profile, sampled in its own parallax space and
  // held a fixed distance above the near bed. It is what gives the bottom a middle
  // distance instead of one hard edge. Lives in the half-res backdrop, so it comes
  // out soft and hazed for free.
  // ---- the sand ------------------------------------------------------------------
  // A clean, bright, near-flat bank. Three stacked fills of the same traced line:
  // a lit lip, the sand body, and the dark mass under it. Nothing procedural is
  // scattered on top -- the ripples, pebbles, boulders and rock arches that used
  // to live here were drawn with paths, and next to the uploaded sprites they
  // read as exactly what they were. What stands on the sand now is art.
  _drawFloorFar(ctx) {
    const water = this._tintAt(this.camY + this.VH * 0.62);
    const step = 48;
    const par = 0.72, lift = 40;
    const cx = this.camX * par, cy = this.camY * par;
    const n = Math.ceil((W + step * 3) / step);
    const gx0 = Math.floor((cx - step) / step) * step;
    let top = 1e9;
    for (let i = 0; i <= n; i += 2) {
      const y = this._profile(gx0 + i * step) - lift - cy;
      if (y < top) top = y;
    }
    if (top > H + 4) return;
    ctx.fillStyle = cssRGB(rgbLerp(water, [120, 140, 130], 0.2));
    ctx.beginPath();
    ctx.moveTo(-6, H + 6);
    for (let i = 0; i <= n; i++) {
      const wx = gx0 + i * step;
      ctx.lineTo(wx - cx, this._profile(wx) - lift - cy);
    }
    ctx.lineTo(W + 6, H + 6);
    ctx.closePath();
    ctx.fill();
  },

  // The colour to fill the world with UNDER the painted sand strip, sampled from
  // the strip's own bottom rows so the two cannot read as separate layers.
  //
  // Two levels of caching, because there are two different costs. The SAMPLE is a
  // getImageData -- a pipeline stall -- and never changes, so it is taken once. The
  // tinted result changes with depth and daylight, so it is cached the same way
  // _bedPal caches its tones: quantised into a key, recomputed only when the key
  // moves. Both matter; a getImageData per frame would be far worse than the
  // banding this replaces.
  //
  // The mix goes through the water tint rather than the palette's dark tone so the
  // sand under the strip drowns in the water at the same rate as everything else
  // on the bed -- the same rule tone() follows in _bedPal.
  _sandUnderCol(mid) {
    if (this._underRGB === undefined) {
      this._underRGB = null;
      const img = ASSETS['sandstrip_0'];
      if (img && img.width) {
        const cv = document.createElement('canvas');
        cv.width = Math.min(64, img.width);
        cv.height = 4;
        const c = cv.getContext('2d', { willReadFrequently: true });
        // just the bottom four rows of the strip, squeezed across
        c.drawImage(img, 0, img.height - 4, img.width, 4, 0, 0, cv.width, 4);
        let r = 0, g = 0, b = 0, n = 0;
        try {
          const d = c.getImageData(0, 0, cv.width, 4).data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;        // the strip is keyed; skip the cut-out
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
        } catch (e) { n = 0; }                    // a tainted canvas is not worth a crash
        if (n) this._underRGB = [r / n, g / n, b / n];
      }
    }
    if (!this._underRGB) return null;
    const nf = this._nightF();
    const key = (((mid / 12) | 0) * 32) + ((nf * 16) | 0);
    if (this._ukey === key && this._ucol) return this._ucol;
    const df = clamp(mid / this.DEEP, 0, 1);
    // BARELY any water in this mix. The first cut faded toward the water tint the
    // way _bedPal's tones do (up to 0.7 at depth) -- but those tones are stacked
    // UNDER a sprite that gets no water fade at all, so at that strength the fill
    // came out teal, and the strip's bottom edge became the hard seam this was
    // supposed to remove. It has to read as the same sand continuing, so the tint
    // is a hint (0.06..0.18) and the darkening does the rest of the work.
    let c = rgbLerp(this._underRGB, this._tintAt(mid), 0.04 + df * 0.08);
    // Only a WHISPER darker than the strip's face. The strip's bottom rows are
    // solid sand at about (195,166,110); mixing a fifth of the way to a brown put
    // the fill ~30 levels below that, and a 30-level step along a dead straight
    // edge is a line you can see. Measured, not guessed -- the strip's bottom row
    // is fully opaque across its whole width, so this fill butts directly against
    // a known colour and any mismatch shows.
    c = rgbLerp(c, [46, 38, 30], 0.07);
    if (nf > 0) c = rgbLerp(c, [6, 14, 34], nf * 0.5);
    this._ukey = key;
    this._ucol = cssRGB(c);
    return this._ucol;
  },

  _drawFloor(ctx, t) {
    if (typeof G === 'undefined' || !G || !this._cols) return;
    const STEP = this.FLOOR_STEP;
    const n = Math.min(this._fy.length - 1, Math.ceil(W / STEP) + 2);
    const fy = this._fy;
    let top = 1e9;
    for (let i = 0; i < n; i++) {
      const sy = this.floorAt(this.camX + i * STEP) - this.camY;
      fy[i] = sy;
      if (sy < top) top = sy;
    }
    if (top > H + 2) return;
    const pal = this._bedPal(this.floorAt(this.camX + this.VW * 0.5));
    const right = (n - 1) * STEP;

    const fill = (off, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-2, fy[0] + off);
      for (let i = 1; i < n; i++) ctx.lineTo(i * STEP, fy[i] + off);
      ctx.lineTo(right, H + 2);
      ctx.lineTo(-2, H + 2);
      ctx.closePath();
      ctx.fill();
    };
    // NO STACKED BANDS. This used to be four fills of the same traced line offset
    // down the page -- a lit lip, the sand, silt, then a dark mass -- and with the
    // painted strip laid over the top of them the leftovers showed below it as
    // three hard horizontal bands of flat colour. That banding is the "layer below
    // the sand" and it is the most obviously code-drawn thing left on screen.
    //
    // What is under the strip now is ONE fill, in the strip's own bottom-edge
    // colour, so there is no seam to see: the sand simply continues down out of
    // frame. The fill still has to exist -- the strip is only ~60 logical tall and
    // the bed can sit high in the frame, so without it the bottom of the screen
    // would show open water under the seabed.
    //
    // The old palette bands stay as the FALLBACK for a missing strip asset, since
    // art that fails to load is silent in this codebase and a bare line would read
    // as a hole in the world.
    const under = this._sandUnderCol(this.floorAt(this.camX + this.VW * 0.5));
    if (under) {
      fill(0, under);
    } else {
      fill(0, pal.lip);
      fill(2.5, pal.sand);
      fill(this.FLOOR_SAND, pal.silt);
      fill(this.FLOOR_SAND + this.FLOOR_SILT, pal.dark);
    }

    // ---- PAINTED SAND over the fills: the uploaded strips, tiled along the
    // line. The strip's own bumpy top edge is what makes the floor read as a
    // beach instead of a graph -- shells, starfish and speckle are in the art.
    // Tiles are anchored to WORLD x (not screen), mirrored on parity so the
    // repeat never reads, and seated 6 units into the fills so the strip's
    // ragged top is the visible surface. Source-clipped: only the on-screen
    // slice of each 1447px strip is sampled.
    const s0 = ASSETS['sandstrip_0'], s1 = ASSETS['sandstrip_1'];
    if (s0 && s0.width) {
      // unfiltered: a full-width near-1:1 blit, per-destination-pixel priced
      const _sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      const TW = this.SAND_TILE_W;                       // logical width per tile
      const i0 = Math.floor(this.camX / TW);
      const i1 = Math.floor((this.camX + W) / TW);
      // ONE height for every tile on screen. Seating each tile on its own patch
      // of floor put neighbouring tiles a few units apart, and the joint read as
      // a cliff line marching along the sand. The floor is near flat, so the
      // height at the screen centre serves the whole frame.
      const sy = this.floorAt(this.camX + this.VW / 2) - this.camY - 6;
      for (let i = i0; i <= i1; i++) {
        const img = (i & 1) && s1 && s1.width ? s1 : s0;
        const th = TW * img.height / img.width;
        const sx = i * TW - this.camX;
        const vx0 = Math.max(0, sx), vx1 = Math.min(W, sx + TW);
        if (vx1 <= vx0) continue;
        const scale = img.width / TW;
        if (i & 2) {
          // every other pair mirrored; the source span measures from the far edge
          ctx.save();
          ctx.translate(vx1, sy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, (sx + TW - vx1) * scale, 0, (vx1 - vx0) * scale, img.height,
            0, 0, vx1 - vx0, th);
          ctx.restore();
        } else {
          ctx.drawImage(img, (vx0 - sx) * scale, 0, (vx1 - vx0) * scale, img.height,
            vx0, sy, vx1 - vx0, th);
        }
      }
      ctx.imageSmoothingEnabled = _sm;
    }

    // ---- glints: a scatter of twinkling points on the sand, deterministic per
    // column so they hold still while the camera moves. One fillStyle, alpha per
    // point -- the cheapest possible sparkle.
    ctx.fillStyle = '#fff6d8';
    const c0 = Math.floor(this.camX / this.CW), c1 = Math.floor((this.camX + W) / this.CW);
    for (let ci = c0; ci <= c1; ci++) {
      const rng = mulberry32((Math.imul(ci, 2246822519) ^ 0x9E37) | 0);
      for (let g = 0; g < 7; g++) {
        const gx = ci * this.CW + rng() * this.CW;
        const ph = rng() * TAU, sp = 0.7 + rng() * 1.6;
        const sx = gx - this.camX;
        if (sx < -2 || sx > W + 2) continue;
        const gy = this.floorAt(gx) - this.camY + 2 + rng() * 6;
        if (gy < -2 || gy > H + 2) continue;
        const tw = Math.sin(t * sp + ph);
        if (tw < 0.55) continue;                          // dark most of the time: a glint, not a lamp
        ctx.globalAlpha = (tw - 0.55) * 1.6;
        ctx.fillRect(sx, gy, 1.2, 1.2);
      }
    }
    ctx.globalAlpha = 1;
  },

  _drawHaze(ctx) {
    const wy0 = this._waterTop();
    if (wy0 >= H) return;                     // nothing but sky in frame
    const d = this.depthFrac();
    const base = this._tintAt(this.camY + this.VH * 0.5);
    const a0 = 0.16 + d * 0.4;
    const BANDS = 8, bh = (H - wy0) / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const a = a0 * (0.45 + 0.55 * (i / (BANDS - 1)));
      ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${a.toFixed(3)})`;
      ctx.fillRect(0, wy0 + i * bh, W, bh + 0.6);
    }
  },

  // A last, weak tint over everything so the deep genuinely closes in. The
  // corner vignette is already applied by the main loop; this is only colour.
  // The water column itself: a flat translucent wash that thickens with depth. It
  // is the honest, safe half of "everything looks underwater" -- one fillRect,
  // no filter, and it reads as water between you and the scene.
  _drawWaterVeil(ctx) {
    const d = this.depthFrac();
    const a = 0.06 + d * 0.10;
    ctx.fillStyle = `rgba(46,132,150,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  },

  _drawDeepTint(ctx) {
    const d = this.depthFrac();
    const nf = this._nightF();
    // half what it was: this is meant to read as water, not as a lights-out
    const a = d * 0.17;
    if (a <= 0.01) return;
    const wy0 = this._waterTop();
    if (wy0 >= H) return;                     // the sky is not the deep
    ctx.fillStyle = `rgba(3,10,24,${a.toFixed(3)})`;
    ctx.fillRect(0, wy0, W, H - wy0);
  },

  // ---- surface light ----------------------------------------------------------
  _drawRays(ctx, t) {
    if (this.quality <= 0) return;               // the first thing to go
    const fade = clamp(1 - Math.max(0, this.camY) / this.LIGHT_END, 0, 1) * (1 - this._nightF());
    if (fade <= 0.02) return;
    const cv = this._rayStrip();
    if (!cv) return;
    // 170 logical tall, not the full light band: the shafts are strongest right
    // under the surface anyway, so the height is where the budget gets spent or
    // saved. Measured by ablation (dev/prof-ocean.js): this one blit was 46 ms of
    // a 114 ms surface frame before the two fixes below.
    const h = 170;
    const sy = -this.camY + 2;                   // pinned just under the surface
    if (sy > H) return;
    // 0.28 parallax and a slow drift: the shafts belong to the sun, not the diver
    const ox = -(((this.camX * 0.28 + t * 5) % W + W) % W);
    ctx.save();
    // TWO separate costs, and they multiply. 'lighter' is priced per destination
    // pixel; a SMOOTHED magnify is priced the same way again, because every
    // destination pixel is a filter tap. The strip is soft blurred light with no
    // detail finer than a shaft, so nearest-neighbour sampling of it is invisible
    // and the saving is most of the pass. (Same finding as the backdrop upscale,
    // which went 171 ms -> 17 ms on this single flag.)
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * fade;
    ctx.drawImage(cv, ox, sy, this._rayW, h);
    ctx.imageSmoothingEnabled = sm;
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
    //
    // And the magnify must not be filtered. Ablation put this pass at 50 ms of a
    // 114 ms surface frame; a bilinear tap per destination pixel was most of it,
    // on a source that is nothing but soft blurred bands.
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    if (this.quality > 0) {
      // The bright additive copy is the SHORTER one: its cutoff is a razor line
      // over a lit scene, so it hands over to the taller, fainter copy and the
      // light steps down instead of stopping.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.44 * fade;
      ctx.drawImage(ca.cv, ca.ax, top, ca.w, 76);
      // the second copy slides the other way; the interference IS the shimmer
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.24 * fade;
      ctx.drawImage(ca.cv, ca.bx, top + 8, ca.w, 116);
    } else {
      // Once the watchdog has given up on the frame, the additive pass is the
      // first thing to go: the light is still there, it just stops glowing.
      ctx.globalAlpha = 0.5 * fade;
      ctx.drawImage(ca.cv, ca.ax, top, ca.w, 100);
    }
    ctx.imageSmoothingEnabled = sm;
    ctx.restore();
  },

  // =============================================================================
  // THE SAND
  // =============================================================================
  // floorAt(x) says where the ground is; these three draw it. Everything here is
  // flat fills and short strokes -- no gradient is evaluated, no image is
  // filtered, and no colour string is built inside a loop. The body of the sand
  // is three stacked fills of the SAME path at increasing offsets, which is what
  // makes a lit lip, a pale sand band and a dark mass out of three fill calls
  // instead of a clip or a gradient.

  // The colour of sand HERE: the zone's own palette (shell-warm lagoon, green-grey
  // kelp shelf, basalt ridge, bone-pale abyss), pulled toward grey with depth and
  // then fogged toward the water's own colour -- because sand that keeps its
  // contrast at 2000 units down reads as a painted backdrop, and the fog is the
  // only thing that puts water between you and it.
  // ---- home ------------------------------------------------------------------------
  // Otto's own pier, seen from underneath, at the world origin. It is the only way
  // out of the open ocean now, so it has to be VISIBLE from a distance and
  // obviously climbable: posts going up out of frame, cross-bracing, and a ladder
  // with real rungs running from the deck down past the waterline.
  // THE REAL PIER, not a drawing of one. Every plank here used to be fillRect and
  // stroke: three tapering posts, two crossed lines for bracing, two bars for the
  // deck lip, and a ladder built from a loop of little rectangles. It was the most
  // obviously code-drawn object in the game and it sat at the one spot every trip
  // begins and ends at.
  //
  // It is the same art the dock scene stands on now -- dock_11 trestle modules at
  // the same SEG_W, the hut on top, kit_ladder for the ladder -- so the structure
  // you climb down from is recognisably the structure you were just standing on,
  // and it runs the pier's full length instead of stopping after three posts.
  PIER_SPAN: 300,          // world units of pier, matching world.js PIER_END
  PIER_SEG: 88,            // dock_11 module width, matching world.js SEG_W

  _drawHome(ctx, t) {
    const sx = this.DOCK_X - this.camX;
    const surf = -this.camY;
    if (surf > H + 120) return;                 // the whole thing is above the frame
    // The pier runs LANDWARD from the ladder, which is -x: the ladder is at the
    // seaward end, the way it is on the dock, where you jump in off the last plank.
    const x0 = sx - this.PIER_SPAN, x1 = sx + 40;
    if (x1 < -40 || x0 > W + 40) return;

    const seg = ASSETS['dock_11'];
    ctx.save();
    // pixel art at a fixed scale: nearest, always
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    if (seg && seg.width) {
      const segH = this.PIER_SEG * seg.height / seg.width;
      // seated so the DECK sits on the waterline; the trestle hangs below it
      const top = surf - segH * 0.30;
      for (let x = x0; x < x1; x += this.PIER_SEG) {
        if (x > W + 8 || x + this.PIER_SEG < -8) continue;
        ctx.drawImage(seg, x, top, this.PIER_SEG, segH);
      }
      // THE SAME DOCK, from the water. This used to put hut_full up here -- a
      // different building entirely from the house_body the dock scene stands
      // you in front of, so climbing out teleported you to somewhere you had
      // never seen. Same art, same proportions, same relative position now:
      // world x maps to ocean x by (wx - PIER_END), so the house at world 34
      // lands at ocean -266, exactly where the deck above your head says it is.
      const hut = ASSETS['house_body'];
      if (hut && hut.width && top > -160) {
        const hw = 86, hh = hw * hut.height / hut.width;
        ctx.drawImage(hut, x0 + 34, top - hh + 2 * APIX, hw, hh);
      }
      // (No coded deck lip here any more. Two flat fillRects spanning the whole
      // pier drew a solid untextured bar across the top of the trestles -- the
      // "weird cube on the harbour". dock_11 already contains its own deck; a
      // second one painted in flat colour could only ever look like a slab.)
    } else {
      // no art: a plain bar at the waterline, so the exit still exists
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(x0, surf - 6, x1 - x0, 8);
    }

    // THE LADDER: the affordance and the hit box are the same object, so it is
    // drawn from the ladder art at the exact reach the dock check uses.
    const lx = sx + 18;
    const lTop = surf - 30, lBot = surf + this.DOCK_TOP;
    const lad = ASSETS['kit_ladder'];
    if (lad && lad.width) {
      const lw = 15;
      // tiled down its own length rather than stretched, so the rungs keep their
      // spacing however deep the ladder has to reach
      const lh = lw * lad.height / lad.width;
      for (let y = lTop; y < lBot; y += lh) {
        const cut = Math.min(lh, lBot - y);
        ctx.drawImage(lad, 0, 0, lad.width, lad.height * (cut / lh),
          lx - lw / 2, y, lw, cut);
      }
    } else {
      ctx.fillStyle = '#a4805a';
      ctx.fillRect(lx - 6, lTop, 2, lBot - lTop);
      ctx.fillRect(lx + 4, lTop, 2, lBot - lTop);
      ctx.fillStyle = this.atDock ? '#ffd66e' : '#c9a271';
      for (let ry = lTop + 5; ry < lBot; ry += 7) ctx.fillRect(lx - 6, ry, 12, 1.8);
    }

    // a soft glow on it while he is in reach, so the exit is never lost
    if (this.atDock) {
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 4);
      ctx.fillStyle = '#ffe6b0';
      ctx.fillRect(lx - 12, lTop - 4, 24, lBot - lTop + 8);
      ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = sm;
    ctx.restore();
  },

  _drawForeground(ctx, t) {
    if (this.quality <= 0) return;
    // The near plane: big translucent plants swaying past the camera. Alpha does
    // the depth-of-field work -- at 0.4-0.6 over the lit scene they read as out
    // of focus without a single filter. Rooted on their own sand and drawn at
    // world scale, like everything else that grows here.
    //
    // UNFILTERED: these are the biggest magnified blits in the scene (up to ~180
    // logical = 720 device pixels tall), and a bilinear tap per destination pixel
    // is the priced-per-pixel trap again. At 0.4-0.6 alpha over a busy scene the
    // nearest-neighbour edges are invisible.
    const _sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const c0 = Math.floor((this.camX - 96) / this.CW);
    const c1 = Math.floor((this.camX + W + 96) / this.CW);
    for (let ci = c0; ci <= c1; ci++) {
      const c = this._col(ci);
      if (!c.fg || !c.fg.length) continue;     // an EMPTY column must not end the pass
      for (let i = 0; i < c.fg.length; i++) {
        const f = c.fg[i];
        const img = ASSETS[f.art];
        if (!img || !img.width) continue;
        const bx = f.x - this.camX;
        if (bx < -110 || bx > W + 110) continue;
        const by = this.floorAt(f.x) - this.camY + 6;
        const h = f.s;
        if (by < -20 || by - h > H + 20) continue;
        const w = h * img.width / img.height;
        const sway = Math.sin(t * 0.5 + f.ph) * 0.06 + f.lean * 0.1;
        ctx.save();
        ctx.globalAlpha = f.a;
        ctx.translate(Math.round(bx * DPX) / DPX, by);
        ctx.rotate(sway);
        if (f.flip) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.restore();
      }
    }
    ctx.imageSmoothingEnabled = _sm;
  },


  // ---- the sun, underwater --------------------------------------------------------
  // A soft ball of light hanging at the water line where the sky's sun is, fading
  // with depth and daylight. The gradient is baked ONCE; per frame it is a single
  // small additive blit.
  _sunGlowCv() {
    if (this._glowCv) return this._glowCv;
    const q = DPX / 2, R = 70;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(R * 2 * q);
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(R * q, R * q, 2, R * q, R * q, R * q);
    g.addColorStop(0, 'rgba(255,244,200,0.55)');
    g.addColorStop(0.35, 'rgba(255,238,180,0.22)');
    g.addColorStop(1, 'rgba(255,238,180,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, cv.width, cv.height);
    this._glowCv = cv;
    return cv;
  },

  _drawSunGlow(ctx, t) {
    if (typeof G === 'undefined' || !G) return;
    const clock = G.clock;
    const isDay = clock > 0.09 && clock < 0.72;
    if (!isDay) return;
    const fade = clamp(1 - Math.max(0, this.camY) / (this.LIGHT_END * 0.9), 0, 1)
               * (1 - this._nightF());
    if (fade <= 0.03) return;
    const cv = this._sunGlowCv();
    // the same arc _drawSky puts the sun on, so the glow hangs under the sun
    const tt = (clock - 0.09) / 0.63;
    const bx = 44 + tt * (W - 88);
    const by = -this.camY + 8;
    const R = 70;
    ctx.save();
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * fade * (0.85 + 0.15 * Math.sin(t * 0.7));
    ctx.drawImage(cv, bx - R, by - R * 0.6, R * 2, R * 2);
    ctx.imageSmoothingEnabled = sm;
    ctx.restore();
  },

  // ---- lens bokeh -------------------------------------------------------------------
  // A few large, faint discs of light drifting over the frame: the "underwater
  // blur". They live on the lens, not in the world -- screen space, slow drift,
  // wrapping at the edges -- and each one is a blit of the one baked soft circle.
  _bokehInit() {
    const rng = mulberry32(0xB0CE);
    this._bok = [];
    for (let i = 0; i < 9; i++) {
      this._bok.push({
        x: rng() * W, y: rng() * H,
        r: 14 + rng() * 30,
        vx: (rng() - 0.5) * 3.4, vy: -1 - rng() * 2.2,
        ph: rng() * TAU,
      });
    }
  },

  _drawBokeh(ctx, t) {
    if (this.quality <= 0) return;
    const d = this.depthFrac();
    // strongest in the sunlit band, still present (dimmer, slower-reading) deep
    const base = (0.05 + 0.05 * (1 - d)) * (1 - this._nightF() * 0.7);
    if (base <= 0.015) return;
    if (!this._bok) this._bokehInit();
    const cv = this._sunGlowCv();          // the same soft disc works for both
    ctx.save();
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this._bok.length; i++) {
      const b = this._bok[i];
      ctx.globalAlpha = base * (0.6 + 0.4 * Math.sin(t * 0.4 + b.ph));
      ctx.drawImage(cv, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    ctx.imageSmoothingEnabled = sm;
    ctx.restore();
  },

  _bokehTick(dt) {
    if (!this._bok) return;
    for (let i = 0; i < this._bok.length; i++) {
      const b = this._bok[i];
      b.x += (b.vx - this.vx * 0.012) * dt;
      b.y += (b.vy - this.vy * 0.012) * dt;
      if (b.x < -b.r) b.x = W + b.r; else if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r; else if (b.y > H + b.r) b.y = -b.r;
    }
  },

  // Water thrown off a breach, and silt kicked off the bottom. Two buckets, two
  // fillStyle writes: the tone is baked in at spawn precisely so this loop never
  // has to decide anything.
  _drawDrops(ctx) {
    let any = false;
    for (let i = 0; i < this.drops.length; i++) if (this.drops[i].t > 0) { any = true; break; }
    if (!any) return;

    ctx.fillStyle = '#e4f6ff';
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.t <= 0 || d.tone !== 0) continue;
      const sx = d.x - this.camX, sy = d.y - this.camY;
      if (sx < -6 || sx > W + 6 || sy < -6 || sy > H + 6) continue;
      ctx.globalAlpha = clamp(d.t / Math.max(d.life, 0.01), 0, 1) * 0.85;
      // stretched along the fall, which is what reads as a droplet and not a dot
      ctx.fillRect(sx - d.r / 2, sy - d.r, d.r, d.r * 2.2);
    }

    ctx.fillStyle = this._bedPal(this.floorAt(this.px)).sand;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.t <= 0 || d.tone !== 1) continue;
      const sx = d.x - this.camX, sy = d.y - this.camY;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      // a cloud thins as it swells, so alpha falls off faster than the timer
      const k = clamp(d.t / Math.max(d.life, 0.01), 0, 1);
      ctx.globalAlpha = k * k * 0.34;
      ctx.beginPath();
      ctx.arc(sx, sy, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
  // Two populations with different rules, in one pass:
  //
  //   PLANTED (p.base): the y in the record is the BASE of the sprite, sitting on
  //     floorAt(x). Drawn at world scale with NO parallax. This is not a style
  //     choice -- a prop parallaxed at 0.86 against sand drawn at 1.0 slides off
  //     the sand the instant the camera moves vertically, and that slide is
  //     precisely the "everything is floating" the seabed exists to fix. The depth
  //     read is carried by size, alpha and the hazed layers behind instead.
  //
  //   ADRIFT (driftwood, and only driftwood): centred on its y, with its own
  //     resting angle and a slow bob. Buoyant things are allowed to hang in open
  //     water because that is what buoyant means.
  //
  // BOTH draw at world scale. Parallaxing the adrift layer would be free depth,
  // but the chunk query window would then have to live in the parallax layer's
  // space, and at 2400 units down a 1.1 layer is 240 units out of register with
  // the window -- so planks would pop in and out along the bottom of the frame.
  // PAR_BACK / PAR_FRONT stay declared for the hazed layers that have no ground
  // contact and for anything a wiring layer wants in the near field.
  _drawProps(ctx, t, front) {
    const nf = this._nightF();
    this.eachVisibleChunk((c) => {
      for (let i = 0; i < c.props.length; i++) {
        const p = c.props[i];
        if (!!p.front !== !!front) continue;
        const planted = p.base !== false;
        const sx = p.x - this.camX;
        const sy = p.y - this.camY;
        const half = p.s;
        if (sx + half < -24 || sx - half > W + 24) continue;
        if (sy + half < -24 || sy - half > H + 24) continue;
        if (p.wreck) {
          // a hull half-buried in the sand: the silhouette is anchored by its
          // waterline-equivalent, so shift the centre up off the base
          const r = this._sil(p.art);
          const hh = r ? p.s * r.ar : p.s;
          this._silDraw(ctx, p.art, sx, sy - hh / 2 + (p.sink || 0), p.s, p.flip,
                        p.dim * (1 - nf * 0.4));
          continue;
        }
        const img = ASSETS[p.art];
        if (!img || !img.width) continue;
        // fit the longest side to p.s, the same rule drawItemIcon uses
        const wide = img.width >= img.height;
        const w = wide ? p.s : p.s * img.width / img.height;
        const h = wide ? p.s * img.height / img.width : p.s;
        ctx.save();
        ctx.globalAlpha = clamp(p.dim, 0.1, 1);
        if (planted) {
          // Pin the BASE, bedded in by p.sink, and pivot the sway there: a plant
          // bends from its root and a shell does not move at all.
          const by = sy + (p.sink || 0);
          const sway = Math.sin(t * (1.5 - p.stiff) + p.ph) * (1 - p.stiff) * 0.3;
          ctx.translate(Math.round(sx * DPX) / DPX, by);
          if (sway) ctx.rotate(sway);
          if (p.flip) ctx.scale(-1, 1);
          ctx.drawImage(img, -w / 2, -h, w, h);
        } else {
          const bob = Math.sin(t * 0.7 + p.ph) * 2.2;
          const roll = p.rot + Math.sin(t * 0.5 + p.ph * 1.7) * 0.08;
          ctx.translate(Math.round(sx * DPX) / DPX, sy + bob);
          ctx.rotate(roll);
          if (p.flip) ctx.scale(-1, 1);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
        }
        ctx.restore();
      }
    }, 140, 1);
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

    // (The dash/roll readiness pips used to sit here, stacked on top of the air
    // gauge. Sprint is a CURRENT now -- the water carries you, there is no key
    // and no cooldown to watch -- so the '>>' pip was reporting on a mechanic
    // that no longer exists, and the roll's own cooldown is short enough to read
    // off the roll itself. The air bar owns this corner alone.)

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

    // The ladder prompt, and only when he is actually at it.
    if (!this.over && !this.leaving && this.atDock) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 3);
      text(ctx, touch ? 'tap the paw to climb the ladder' : '[E] climb the ladder home',
        W / 2, 42, { size: 7, color: '#ffe6b0', align: 'center' });
      ctx.globalAlpha = 1;
    } else if (!this.over && !this.leaving && this.py < 20) {
      // Up top and not home: say which way home is, because the sea is wide and
      // the exit is a place now rather than a keypress.
      const d = this.DOCK_X - this.px;
      if (Math.abs(d) > this.DOCK_R) {
        ctx.globalAlpha = 0.5;
        text(ctx, (d < 0 ? '\u25c0 ' : '') + 'the pier is ' + Math.round(Math.abs(d) / this.PX_PER_M) +
          'm ' + (d < 0 ? 'west' : 'east') + (d > 0 ? ' \u25b6' : ''),
          W / 2, 42, { size: 7, color: '#d8ccb4', align: 'center' });
        ctx.globalAlpha = 1;
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
        // INTERACT, where the sprint button used to be. Sprint is not a button any
        // more -- currents carry you (see _currentAt) -- and [E] had no touch
        // control at all, so the ladder, the farm beds and now taking up a rock to
        // mine were all unreachable without a keyboard. This is the better use of
        // the slot by a distance.
        { x: W - 92, y: H - 52, w: 40, h: 40, tap: 'KeyE', icon: 'act' },
        { x: W - 92, y: H - 98, w: 40, h: 40, tap: 'Space', icon: 'oroll' },
        // (no crafting pad -- the rail anvil is the crafting button everywhere)
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
          // 'E', not '>>': this slot is interact now, not sprint
          text(c, 'E', cx, cy - 4, { size: 9, color: 'rgba(255,235,190,0.9)', align: 'center' });
        }
      }
    };
  },
};

// Load-order-agnostic install: Game/TouchUI are const in main.js, so if this file
// is pulled in ahead of it the wrap has to wait for the document.
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Ocean.install();
else document.addEventListener('DOMContentLoaded', () => Ocean.install(), { once: true });
