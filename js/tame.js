'use strict';
// js/tame.js -- taming the wild things that live in the open ocean.
//
// This is the OTHER animal system. Stock is livestock: you buy it, it lives in a
// pen, it makes produce. Nothing here is bought. A wild animal has to be courted
// over several days, and once it comes home with you the player faces one real
// decision per animal:
//
//     HARVEST it on a cooldown, or BEFRIEND it and take a FAVOUR instead.
//
// Those are exclusive on purpose. Feed an animal day after day WITHOUT ever
// harvesting it and it stops being a crop: it grants its favour and never
// produces again. Harvest it and the bond resets to nothing. The favours are the
// real prize and other systems ask for them by name through one total query:
//
//     if (Tame.favour('ferry')) { ... }        // the whale carries you down free
//     if (Tame.favour('wrecks')) { ... }       // the narwhal opens locked wrecks
//     Tame.lootMul()                           // 2 with the bison's strong back
//
// favour() answers false for anything it does not recognise, so a caller never
// has to know whether this file even loaded.
//
// COURTSHIP, not capture. Every wild animal tracks `ease` -- how settled it is
// with you being here. Swimming slowly nearby raises it; a dash past drops it to
// nothing and sends the animal bolting. Only a settled animal will take food, and
// only two offers a day count for much, which is what makes taming take several
// ENCOUNTERS rather than one long hover. Wariness scales all of it, so a clown
// warms up in a couple of visits and a narwhal takes most of a week.
//
// THE SCENE DRIVES IT. This is a system, not a scene and not (mostly) a modal:
//   Tame.reset(seed)                 on Ocean.enter, once
//   Tame.update(dt, px, py)          every frame, px/py = Otto's centre
//   Tame.draw(ctx, camX, camY)       WORLD space (camera already applied)
// js/integrate.js already makes those three calls. The one panel in here -- the
// tide pool roster on the dock -- borrows main.js's slots the same way Craft and
// Stock do, and installs the full five wraps for it.
//
// FRAME BUDGET. Mobs, babies, puffs and labels all live in pools built once in
// _initPools and recycled; the steady state allocates nothing. Sprite frame names
// are precomputed per species (no string building in draw), puffs are drawn in two
// colour buckets so fillStyle is set twice for the whole field, nothing evaluates
// a gradient, and everything is culled against the camera rect before it costs a
// transform. The dive's measurement stands: there is no headroom here.
const Tame = {

  // ================================================================== config ====
  MAX_PETS: 6,             // room at the tide pool
  MAX_OUT: 3,              // how many may swim with you at once
  MAX_MOBS: 20,            // live animals (wild + following) in the water
  MAX_BABIES: 2,
  PUFF_MAX: 40,
  FLY_MAX: 8,
  // THE WAKE. Every moving animal lays down a short ribbon of fading points behind
  // it, so a fish reads as travelling THROUGH water rather than sliding across a
  // picture of it. 120 points across up to 20 animals is about six each, which at
  // WAKE_LIFE is a tail two body-lengths long -- long enough to see, short enough
  // that a crowded frame does not turn into spaghetti.
  WAKE_MAX: 120,
  WAKE_LIFE: 0.72,         // seconds a point survives
  WAKE_GAP: 7,             // world units of travel between drops (distance, NOT time,
                           // so a fast animal gets a longer trail and not a denser one)
  WILD_MEM: 64,            // remembered wild animals; the shyest are forgotten first

  // Ocean's chunk grid, so a stretch of water always holds the same animals.
  CHUNK_W: 512,
  CHUNK_H: 320,
  DEEP_MAX: 2400,          // world y that counts as depth-fraction 1.0
  MARGIN: 56,              // keep placements off the chunk seams
  SEEN_MAX: 260,           // spawned-chunk memory before a prune
  DESPAWN_R: 860,          // a wild animal this far away goes back to sleep
  SURFACE_Y: 26,
  FLOOR_Y: 3400,

  // ---- courtship tuning -------------------------------------------------------
  NOTICE_R: 152,           // it knows you are there
  OFFER_R: 46,             // how close you must be to hand food over
  STANDOFF: 30,            // how close a curious animal will come on its own
  // Friendlier water. These used to be 44/116 and animals read as terrified of
  // you: a normal cruise past one inside its notice ring sent it bolting, and
  // "move slowly" meant "hover". A curious reef should let you swim up at an
  // ordinary pace and only bolt when you charge or barge.
  CALM_SPEED: 62,          // swim slower than this and it settles
  SPOOK_SPEED: 175,        // faster than this inside NOTICE_R and it bolts
  BUMP_R: 14,              // barging into one always spooks it
  EASE_UP: 0.62,
  EASE_DOWN: 0.85,
  EASE_NEED: 0.42,         // ease required before it will come close
  FLEE_T: 2.7,
  FEED_T: 1.15,
  FOLLOW_GAP: 44,
  TRUST_MAX: 100,
  FEEDS_DAY: 2,            // offers a day that count for full value
  TIRED_MUL: 0.22,         // and what the ones after that are worth
  MOOD_FED: 0.2,
  MOOD_HUNGRY: 0.13,
  MOOD_WORK: 0.05,         // harvesting is work, and it knows

  // ---- the roster panel -------------------------------------------------------
  // Inside the 40..440 x 22..248 box every other panel respects, so it never
  // fights the HUD strip or the touch pads.
  WX: 16, WY: 12, WW: 448, WH: 228,
  _openT: 0,
  ROW_Y: 60, ROW_H: 36, VIS: 4,
  BW: 44, BH: 13, BGAP: 3,
  REL_T: 2.4,              // press "free" twice inside this to actually do it

  // The dock spot. Published as a table so js/integrate.js can move it the way it
  // already moves Farm.PLOT_DEF and Stock.PEN_DEF -- it owns the deck layout, not
  // this file. `b` is the bridge tier that has to be built for it to exist.
  SITE: { x: 430, b: 2 },

  // =================================================================== species ==
  // Shallow to deep. `band` is a window in depth-fraction and `weight` is the
  // relative frequency inside it, so the rare things are ALSO the deep things:
  // nothing but a clown lives in the first tenth of the water and the narwhal
  // never appears above 0.72 of it.
  //
  // box/baby are the longest side of the sprite in logical units. speed is the
  // cruising terminal speed (the drag below is tuned so acc/2.1 lands on it).
  // wary scales every trust gain down and every spook up. bond is how many days
  // of feeding-without-harvesting the favour costs.
  ORDER: ['clown', 'pig', 'cow', 'ray', 'bison', 'melon', 'clam', 'whale', 'narwhal'],
  SPECIES: {
    clown: {
      name: 'reef clown', box: 26, baby: 15, wary: 0.25, weight: 12,
      band: [0.00, 0.35], speed: 62, fps: 7, bob: 3.4, bobA: 3.2, babies: 2,
      fav: 'crop_berry_p', likes: ['roe', 'crop_moon_p'], grow: 3, cool: 2, bond: 5,
      favour: 'guard',
      prod: { key: 'tame_clown_p', name: 'anemone bead', value: 10 },
      blurb: 'bold for its size and endlessly curious.',
    },
    pig: {
      name: 'sea pig', box: 40, baby: 23, wary: 0.35, weight: 10,
      band: [0.00, 0.45], speed: 52, fps: 5.5, bob: 2.4, bobA: 2.6, babies: 2,
      fav: 'crop_gourd_p', likes: ['crop_berry_p', 'barnacle'], grow: 4, cool: 2, bond: 5,
      favour: 'forage',
      prod: { key: 'tame_pig_p', name: 'sea truffle', value: 18 },
      blurb: 'roots along the bottom and remembers who feeds it.',
    },
    cow: {
      name: 'sea cow', box: 60, baby: 34, wary: 0.3, weight: 9,
      band: [0.04, 0.50], speed: 40, fps: 4.2, bob: 1.7, bobA: 2.2, babies: 1,
      fav: 'crop_curl_p', likes: ['crop_blade_p', 'crop_moon_p'], grow: 5, cool: 1, bond: 6,
      favour: 'nourish',
      prod: { key: 'tame_cow_p', name: 'sea cow milk', value: 12 },
      blurb: 'slow, patient, and impossible to hurry.',
    },
    ray: {
      name: 'kite ray', box: 58, baby: 32, wary: 0.5, weight: 8,
      band: [0.10, 0.70], speed: 74, fps: 5, bob: 2.1, bobA: 4.4, babies: 1,
      fav: 'mussel', likes: ['clam', 'oyster'], grow: 5, cool: 2, bond: 6,
      favour: 'seek',
      prod: { key: 'tame_ray_p', name: 'ray silk', value: 15 },
      blurb: 'reads the seabed like a page.',
    },
    bison: {
      name: 'sea bison', box: 70, baby: 40, wary: 0.55, weight: 6,
      band: [0.18, 0.80], speed: 56, fps: 4.4, bob: 1.5, bobA: 2.4, babies: 2,
      fav: 'crop_blade_p', likes: ['crop_curl_p', 'crop_gourd_p'], grow: 6, cool: 3, bond: 6,
      favour: 'haul',
      prod: { key: 'tame_bison_p', name: 'bison wool', value: 14 },
      blurb: 'grazes the kelp shelves in slow herds.',
    },
    melon: {
      name: 'melon head', box: 62, baby: 35, wary: 0.6, weight: 5,
      band: [0.30, 0.85], speed: 88, fps: 6, bob: 2.6, bobA: 3.6, babies: 1,
      fav: 'musselMeat', likes: ['roe', 'clamMeat'], grow: 6, cool: 2, bond: 7,
      favour: 'calm',
      prod: { key: 'tame_melon_p', name: 'melon oil', value: 16 },
      blurb: 'hums a note you can feel in your teeth.',
    },
    clam: {
      name: 'great clam', box: 34, baby: 20, wary: 0.4, weight: 4,
      band: [0.34, 1.00], speed: 12, fps: 3, bob: 1.1, bobA: 1.4, babies: 0,
      fav: 'crop_moon_p', likes: ['barnacle', 'roe'], grow: 7, cool: 1, bond: 6,
      favour: 'pearl',
      prod: { key: 'tame_clam_p', name: 'great pearl', value: 26 },
      blurb: 'goes nowhere in particular, very slowly.',
    },
    whale: {
      name: 'grey whale', box: 96, baby: 54, wary: 0.7, weight: 2.5,
      band: [0.55, 1.00], speed: 66, fps: 3.6, bob: 1.2, bobA: 3.0, babies: 1,
      fav: 'roe', likes: ['musselMeat', 'crop_moon_p'], grow: 8, cool: 3, bond: 8,
      favour: 'ferry',
      prod: { key: 'tame_whale_p', name: 'ambergris', value: 30 },
      blurb: 'older than the pilings and in no hurry about it.',
    },
    narwhal: {
      name: 'pale narwhal', box: 78, baby: 44, wary: 0.9, weight: 1.5,
      band: [0.72, 1.00], speed: 96, fps: 6.5, bob: 2.2, bobA: 3.4, babies: 1,
      fav: 'abalone', likes: ['musselMeat', 'oysterMeat'], grow: 8, cool: 3, bond: 8,
      favour: 'wrecks',
      prod: { key: 'tame_narwhal_p', name: 'ivory shard', value: 28 },
      blurb: 'keeps to the cold dark and trusts nothing quickly.',
    },
  },

  // =================================================================== favours ==
  // The whole point of befriending. `sp` is the species that grants it. Other
  // systems ask by id OR by species key -- Tame.favour('haul') and
  // Tame.favour('bison') are the same question.
  FAVOURS: {
    guard:   { sp: 'clown',   name: 'the small bodyguard', desc: 'darts in and takes the odd hit for you.' },
    forage:  { sp: 'pig',     name: 'a nose for it',       desc: 'roots out a little something every morning.' },
    nourish: { sp: 'cow',     name: 'good milk',           desc: 'a meal mends more than it used to.' },
    seek:    { sp: 'ray',     name: "a reader's eye",      desc: 'finds seams and shells for you.' },
    haul:    { sp: 'bison',   name: 'the strong back',     desc: 'hauls double what you could carry.' },
    calm:    { sp: 'melon',   name: 'the calming song',    desc: 'hunting things lose interest faster.' },
    pearl:   { sp: 'clam',    name: 'a pearl a day',       desc: 'leaves a pearl on the boards each morning.' },
    ferry:   { sp: 'whale',   name: 'the long ride',       desc: 'carries you down without spending air.' },
    wrecks:  { sp: 'narwhal', name: 'the key horn',        desc: 'works a locked wreck open.' },
  },

  // ====================================================================== food ==
  // Everything an animal will look at twice. `farm` is the key the same produce
  // has inside G.farm.crops, which is a DIFFERENT stash from the bag -- both are
  // counted and both can be spent (see _have/_spend). `treat` is cooked food:
  // universally welcome, which quietly makes the kitchen a taming tool.
  FOOD_ORDER: [
    'crop_berry_p', 'crop_gourd_p', 'crop_curl_p', 'crop_blade_p', 'crop_moon_p',
    'roe', 'musselMeat', 'clamMeat', 'oysterMeat',
    'mussel', 'clam', 'oyster', 'barnacle', 'abalone',
    'chowder', 'custard', 'skewer', 'rolls', 'grill', 'tea',
  ],
  FOOD: {
    crop_berry_p: { name: 'reef berry', farm: 'berry' },
    crop_gourd_p: { name: 'sea gourd', farm: 'gourd' },
    crop_curl_p: { name: 'kelp curl', farm: 'curl' },
    crop_blade_p: { name: 'sea blade', farm: 'blade' },
    crop_moon_p: { name: 'moon bloom', farm: 'moon' },
    roe: { name: 'roe' },
    musselMeat: { name: 'mussel meat' },
    clamMeat: { name: 'clam meat' },
    oysterMeat: { name: 'oyster meat' },
    mussel: { name: 'mussel' },
    clam: { name: 'clam' },
    oyster: { name: 'oyster' },
    barnacle: { name: 'barnacle' },
    abalone: { name: 'abalone' },
    chowder: { name: 'chowder', treat: true },
    custard: { name: 'kelp custard', treat: true },
    skewer: { name: 'skewer', treat: true },
    rolls: { name: 'kelp rolls', treat: true },
    grill: { name: 'grilled catch', treat: true },
    tea: { name: 'kelp tea', treat: true },
  },

  // trust a single offer is worth before wariness, ease and tiredness scale it
  GAIN: { fav: 26, treat: 18, like: 15, ok: 7, wrong: -6, inedible: 0 },

  // ===================================================================== names ==
  NAMES: [
    'Barnaby', 'Pebble', 'Cordelia', 'Mister Tibbs', 'Wren', 'Onion', 'Halyard',
    'Pip', 'Marigold', 'Bosun', 'Clementine', 'Dorothy', 'Custard', 'Fennel',
    'Gasket', 'Hazel', 'Juniper', 'Kettle', 'Lumen', 'Mopsy', 'Nutmeg', 'Otis',
    'Parsnip', 'Quill', 'Rosin', 'Sixpence', 'Tuppence', 'Umber', 'Vesper',
    'Whistle', 'Yarrow', 'Zephyr',
  ],

  // reaction lines, by tier. Picked with the animal's own rng so a species reads
  // consistently within an encounter.
  LINES: {
    fav: [
      'takes it out of your paw and hums.',
      'eats the lot and bumps your shoulder.',
      'is delighted. it circles you twice.',
    ],
    treat: [
      'has never had anything cooked before.',
      'eats it very carefully, then looks for more.',
      'seems to think you are a good cook.',
    ],
    like: [
      'chews it over and stays close.',
      'accepts it politely.',
      'eats, and watches you eat nothing.',
    ],
    ok: [
      'nibbles the edge of it.',
      'takes it, unconvinced.',
      'eats around the parts it likes.',
    ],
    wrong: [
      'spits it out and backs off.',
      'is offended. that was not food.',
      'turns its whole body away from you.',
    ],
    inedible: [
      'noses at it and loses interest.',
      'will not even look at that.',
      'is waiting for something edible.',
    ],
  },

  // ============================================================ mutable state ==
  open: false,
  sel: 0,
  scroll: 0,
  seed: 0,
  time: 0,
  mobs: null,
  puffs: null,
  flys: null,
  wake: null,
  _pi: 0, _fi: 0, _wi: 0,   // pool cursors
  _seen: null, _seenN: 0,
  _fav: null, _favDirty: true,
  _offerable: null,
  _lpx: null, _lpy: null, _pspd: 0,
  _note: '', _noteT: 0,
  _relIdx: -1, _relT: 0,
  _label: '', _labelKey: '',
  _stamp: -1, _uiStamp: -1,
  _installed: false, _init: false,
  _nt: null, _nlen: -1,
  _wsc: null,
  _spot: null, _spots: null, _noSpots: null,

  // ===================================================================== hooks ==
  // Both default to something harmless so this file never depends on a wiring
  // layer existing. js/integrate.js repoints xp at Skills.gain.
  xp: function (skill, n) { },

  // Where a harvested product goes. Returns the LEFTOVER that would not fit, so a
  // caller can decide; the default never drops anything (flat storage has no cap).
  give: function (key, n) {
    n = Math.floor(n) || 0;
    if (n <= 0 || typeof key !== 'string' || !key) return 0;
    if (typeof Inv !== 'undefined' && Inv && Inv.add) {
      var left = Inv.add(key, n) || 0;
      if (left > 0) this._store(key, left);
      return 0;
    }
    this._store(key, n);
    return 0;
  },

  // ======================================================================= save =
  // G.tame is a brand new top-level key and Game.load only deep-merges five
  // (storage, gear, stats, flags, decor), so this subtree arrives from an old save
  // exactly as it was written and never gains the fields a newer build expects.
  // ensure() therefore re-normalises it defensively at the top of EVERY public
  // entry point, draw and update included.
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    var s = G.tame;
    if (!s || typeof s !== 'object') s = G.tame = {};
    if (!this._init) this._initPools();

    // Rule 10: this runs 60 times a second, so once the structure is known-clean
    // it short-circuits. A load replaces the object (new identity) and any
    // mutation changes the pet count -- either falls through and re-normalises.
    if (s === this._nt && s.pets && s.pets.length === this._nlen && !this._dirty) {
      if (typeof s.lastDay !== 'number' || s.lastDay > G.day) s.lastDay = G.day;
      return true;
    }
    this._dirty = false;

    if (!Array.isArray(s.pets)) s.pets = [];
    if (s.pets.length > this.MAX_PETS) s.pets.length = this.MAX_PETS;
    if (!s.wild || typeof s.wild !== 'object') s.wild = {};
    if (typeof s.nextId !== 'number' || !isFinite(s.nextId) || s.nextId < 1) s.nextId = 1;
    s.nextId = Math.floor(s.nextId);
    if (typeof s.tamed !== 'number' || !isFinite(s.tamed)) s.tamed = 0;
    if (typeof s.harvested !== 'number' || !isFinite(s.harvested)) s.harvested = 0;
    if (typeof s.granted !== 'number' || !isFinite(s.granted)) s.granted = 0;
    if (typeof s.released !== 'number' || !isFinite(s.released)) s.released = 0;
    if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day;
    if (s.lastDay > G.day) s.lastDay = G.day;    // hand-edited save, or a new game

    var i, p, out = 0;
    for (i = s.pets.length - 1; i >= 0; i--) {
      p = s.pets[i];
      // A pet whose species this build does not know cannot be drawn or fed, so
      // it goes rather than poisoning every frame after it.
      if (!p || typeof p !== 'object' || !this._sp(p.sp)) { s.pets.splice(i, 1); continue; }
      if (typeof p.id !== 'number' || !isFinite(p.id)) p.id = s.nextId++;
      if (typeof p.name !== 'string' || !p.name) p.name = this._pickName();
      p.adult = !!p.adult;
      p.favour = !!p.favour;
      p.out = !!p.out;
      p.age = this._num(p.age, 0, 0, 9999);
      p.trust = this._num(p.trust, this.TRUST_MAX, 0, this.TRUST_MAX);
      p.mood = this._num(p.mood, 0.7, 0, 1);
      p.bond = this._num(p.bond, 0, 0, 99);
      p.cd = this._num(p.cd, 0, 0, 30);
      p.babies = this._num(p.babies, 0, 0, this.MAX_BABIES) | 0;
      p.fedDay = this._num(p.fedDay, -1, -1, 1e7) | 0;
      p.harvDay = this._num(p.harvDay, -1, -1, 1e7) | 0;
      if (typeof p.wid !== 'string') p.wid = '';
      if (p.favour) p.cd = 0;                    // a friend is not on a cooldown
    }
    // more than MAX_OUT marked as swimming with you is not a state the panel can
    // produce, but a hand-edited save can: the surplus stays home
    for (i = 0; i < s.pets.length; i++) {
      if (!s.pets[i].out) continue;
      out++;
      if (out > this.MAX_OUT) s.pets[i].out = false;
    }

    this._normWild(s);
    if (this.sel >= s.pets.length) this.sel = Math.max(0, s.pets.length - 1);
    this._clampScroll();
    this._nt = s;
    this._nlen = s.pets.length;
    this._favDirty = true;
    return true;
  },

  // The wild-animal memory: id -> { t: trust, f: offers today, d: that day,
  // k: 1 if it was taken home (so it never respawns wild) }. Bounded, because it
  // is persisted whole and the ocean is endless.
  _normWild: function (s) {
    var w = s.wild, keys = Object.keys(w), i, r, k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      r = w[k];
      if (!r || typeof r !== 'object') { delete w[k]; continue; }
      r.t = this._num(r.t, 0, 0, this.TRUST_MAX);
      r.f = this._num(r.f, 0, 0, 99) | 0;
      r.d = this._num(r.d, -1, -1, 1e7) | 0;
      r.k = r.k ? 1 : 0;
      if (!r.k && r.t <= 0) delete w[k];          // nothing worth remembering
    }
    keys = Object.keys(w);
    if (keys.length <= this.WILD_MEM) return;
    // Forget the least invested first; a kept animal is never forgotten.
    keys.sort(function (a, b) {
      var ra = w[a], rb = w[b];
      if (ra.k !== rb.k) return rb.k - ra.k;
      return rb.t - ra.t;
    });
    for (i = this.WILD_MEM; i < keys.length; i++) delete w[keys[i]];
  },

  _num: function (v, def, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) return def;
    return v < lo ? lo : (v > hi ? hi : v);
  },

  _sp: function (key) {
    if (typeof key !== 'string' || !key) return null;
    if (!Object.prototype.hasOwnProperty.call(this.SPECIES, key)) return null;
    return this.SPECIES[key];
  },

  _store: function (key, n) {
    if (typeof G === 'undefined' || !G || !G.storage) return;
    var have = G.storage[key];
    if (typeof have !== 'number' || !isFinite(have) || have < 0) have = 0;
    G.storage[key] = have + n;
  },

  _save: function () { if (typeof Game !== 'undefined' && Game.save) Game.save(); },
  _toast: function (m) { if (typeof Game !== 'undefined' && Game.toast) Game.toast(m); },
  _snd: function (n, a) { if (typeof SND !== 'undefined' && SND && SND[n]) SND[n](a); },
  _buzz: function (ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { } } },

  // Skills is total -- an unknown buff name returns its identity -- but Skills
  // itself may be absent, so every read goes through here.
  _buff: function (name, def) {
    if (typeof Skills !== 'undefined' && Skills && Skills.buff) {
      var v = Skills.buff(name);
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return def;
  },

  _xp: function (skill, n) {
    if (typeof this.xp !== 'function' || !(n > 0)) return;
    try { this.xp(skill, n); } catch (e) { }
  },

  // ====================================================================== pools =
  _initPools: function () {
    if (this._init) return;
    this._init = true;
    var i, j, sp, k;

    // Precompute per-species frame names. Building 'tame_' + key + '_' + n inside
    // draw would allocate a string per animal per frame; the sheets are 0-2 baby
    // and 3-5 adult, and 0,1,2,1 reads as a glide cycle.
    for (i = 0; i < this.ORDER.length; i++) {
      k = this.ORDER[i];
      sp = this.SPECIES[k];
      sp.key = k;
      sp.frB = ['tame_' + k + '_0', 'tame_' + k + '_1', 'tame_' + k + '_2', 'tame_' + k + '_1'];
      sp.frA = ['tame_' + k + '_3', 'tame_' + k + '_4', 'tame_' + k + '_5', 'tame_' + k + '_4'];
      sp.prod.art = 'tame_' + k + '_p';
      sp.acc = sp.speed * 2.12;             // drag below is pow(0.12, dt)
      sp.idx = i;
    }

    this.mobs = new Array(this.MAX_MOBS);
    for (i = 0; i < this.MAX_MOBS; i++) {
      this.mobs[i] = {
        live: false, kind: 0, id: '', ck: '', sp: '', spr: null, petId: -1,
        x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, tx: 0, ty: 0,
        dir: 1, bank: 0, ph: 0, animT: 0, alpha: 0,
        state: 0, stateT: 0, ease: 0, trust: 0, adult: true, babies: 0,
        wanderT: 0, tagT: 0, rng: null, bph: [0, 0], slot: 0,
        // swim: distance travelled, which drives BOTH the wake drop spacing and the
        // tail-beat phase. Using distance instead of wall-clock is what stops a
        // hovering animal from flapping on the spot.
        swim: 0, wakeD: 0,
      };
    }

    this.puffs = new Array(this.PUFF_MAX);
    for (i = 0; i < this.PUFF_MAX; i++) this.puffs[i] = { t: 0, x: 0, y: 0, vx: 0, vy: 0, r: 1, tone: 0 };

    this.flys = new Array(this.FLY_MAX);
    for (i = 0; i < this.FLY_MAX; i++) this.flys[i] = { t: 0, x: 0, y: 0, txt: '', tone: 0 };

    // wake points: r is the radius at birth, tone picks one of two fill colours so
    // the whole ribbon costs two fillStyle writes for the entire frame
    this.wake = new Array(this.WAKE_MAX);
    for (i = 0; i < this.WAKE_MAX; i++) this.wake[i] = { t: 0, x: 0, y: 0, r: 1, tone: 0 };

    this._seen = {};
    this._fav = {};
    this._wsc = new Array(this.ORDER.length);
    for (j = 0; j < this._wsc.length; j++) this._wsc[j] = 0;

    // spots() runs up to three times a frame, so its array and its one spot
    // object are built once and mutated in place.
    var self = this;
    this._spot = { x: this.SITE.x, label: 'Tide Pool', act: function () { self.openUI(); } };
    this._spots = [this._spot];
    this._noSpots = [];
  },

  // Called by js/integrate.js from Ocean.enter. Everything in the water is
  // dropped (their trust is banked first) and the chunk memory is cleared, so a
  // fresh trip re-streams from wherever you dived in.
  reset: function (seed) {
    if (!this.ensure()) return;
    this.seed = (seed | 0) || 1;
    this._freeAll();
    this._seen = {};
    this._seenN = 0;
    this._lpx = null;
    this._lpy = null;
    this._pspd = 0;
    this._offerable = null;
    for (var i = 0; i < this.PUFF_MAX; i++) this.puffs[i].t = 0;
    // and the wake, or a fresh trip opens with trails hanging where the last one
    // left animals swimming
    for (var w = 0; w < this.WAKE_MAX; w++) this.wake[w].t = 0;
    for (var j = 0; j < this.FLY_MAX; j++) this.flys[j].t = 0;
  },

  _freeAll: function () {
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live) continue;
      if (m.kind === 0) this._bank(m);
      m.live = false;
    }
  },

  _freeMob: function (m) {
    if (m.kind === 0) {
      this._bank(m);
      if (m.ck) delete this._seen[m.ck];   // let that stretch of water refill
    }
    m.live = false;
  },

  // Write a wild animal's progress back to the save. Called on every offer too,
  // so quitting mid-courtship never loses a day of patience.
  _bank: function (m) {
    if (typeof G === 'undefined' || !G || !G.tame || !m.id) return;
    var r = G.tame.wild[m.id];
    if (!r) r = G.tame.wild[m.id] = { t: 0, f: 0, d: -1, k: 0 };
    r.t = Math.max(0, Math.min(this.TRUST_MAX, m.trust));
  },

  _slot: function () {
    for (var i = 0; i < this.MAX_MOBS; i++) if (!this.mobs[i].live) return this.mobs[i];
    return null;
  },

  // ================================================================== spawning ==
  // Deterministic wild placements for one chunk of open water. Pure: it reads no
  // state and mutates nothing, so a caller can ask about a chunk it is nowhere
  // near (the minimap, a goal, a test) and get the same answer as the streamer.
  //
  // Returns a fresh array of { id, key, x, y, adult, babies }. Called once per
  // chunk per visit, which is why allocating here is fine and allocating in
  // update/draw is not.
  spawnFor: function (chunkX, chunkY, seed) {
    var out = [];
    chunkX = chunkX | 0;
    chunkY = chunkY | 0;
    if (chunkY < 0) return out;                 // nothing swims above the surface
    var cw = this.CHUNK_W, ch = this.CHUNK_H;
    var y0 = chunkY * ch;
    var df = this._df(y0 + ch * 0.5, chunkX * cw + cw * 0.5);
    var rng = mulberry32((Math.imul(chunkX, 73856093) ^ Math.imul(chunkY, 19349663) ^
      Math.imul((seed | 0) || 1, 83492791)) | 0);

    // The open ocean is mostly empty water -- that is what makes finding
    // something an event. Shallows are busier than the deep.
    // DENSITY. These used to be lower, and the sea still looked busy -- because
    // half of what you saw was the same animal stacked on itself, and the other
    // half included a whole chunk row spawned under the sand. With both fixed the
    // honest count showed up: one animal every few screens. Raised so the water
    // reads alive on the strength of real animals only.
    var r0 = rng();
    var n = df < 0.14 ? (r0 < 0.62 ? 1 : (r0 < 0.90 ? 2 : 0))
      : (r0 < 0.50 ? 1 : (r0 < 0.78 ? 2 : 0));
    if (n <= 0) return out;

    for (var i = 0; i < n; i++) {
      var key = this._pickSpecies(df, rng());
      if (!key) continue;
      var sp = this.SPECIES[key];
      // Thirds of the chunk, so two animals in one chunk never overlap.
      var lane = n === 1 ? 0.5 : (i === 0 ? 0.28 : 0.74);
      var x = chunkX * cw + this.MARGIN + (cw - this.MARGIN * 2) * (lane + (rng() - 0.5) * 0.16);
      var y = y0 + this.MARGIN + (ch - this.MARGIN * 2) * rng();
      if (y < this.SURFACE_Y + 20) y = this.SURFACE_Y + 20;
      // ...and nothing swims INSIDE THE SAND. The streamer walks a 3x3 grid of
      // 320-unit chunk rows around Otto, and the seabed out here sits around 320
      // -- so the row below him is entirely buried, and every animal it rolled
      // was placed under the floor. They are pushed up to a body's length above
      // the sand instead, and a chunk with no water left in it spawns nothing.
      var fl = this._floorAt(x);
      if (fl !== null) {
        if (y0 + this.MARGIN > fl - 24) continue;      // this row is all sand
        if (y > fl - 24) y = fl - 24;
      }
      var adult = rng() < 0.72;
      var babies = 0;
      if (adult && sp.babies > 0 && rng() < 0.42) babies = 1 + (rng() < 0.35 && sp.babies > 1 ? 1 : 0);
      out.push({
        id: chunkX + '_' + chunkY + '_' + i,
        key: key, x: x, y: y, adult: adult, babies: babies,
      });
    }
    return out;
  },

  // The seabed height at x, or null when no scene publishes one.
  _floorAt: function (x) {
    if (typeof Ocean === 'undefined' || !Ocean || !Ocean.floorAt) return null;
    var f = Ocean.floorAt(x);
    return (typeof f === 'number' && isFinite(f)) ? f : null;
  },

  // Where this patch of sea sits in the species ladder, 0..1. The seabed is a
  // flat shallow shelf now, so depth stopped sorting anything and DISTANCE FROM
  // HOME does the job instead -- narwhals live a long swim out, not a deep dive
  // down. Falls back to depth if the scene publishes no such axis.
  _df: function (y, x) {
    if (x !== undefined && typeof Ocean !== 'undefined' && Ocean && Ocean.remoteFrac) {
      return Ocean.remoteFrac(x);
    }
    return clamp(y / this.DEEP_MAX, 0, 1);
  },

  // Weighted by frequency AND by how central the depth is inside the species'
  // band, so an animal thins out towards the edges of where it lives instead of
  // stopping dead at a line.
  _pickSpecies: function (df, r) {
    var total = 0, i, sp, w;
    for (i = 0; i < this.ORDER.length; i++) {
      sp = this.SPECIES[this.ORDER[i]];
      w = 0;
      if (df >= sp.band[0] && df <= sp.band[1]) {
        var span = Math.max(0.001, sp.band[1] - sp.band[0]);
        var k = (df - sp.band[0]) / span;        // 0..1 across the band
        w = sp.weight * (0.35 + 0.65 * Math.sin(k * Math.PI));
      }
      this._wsc[i] = w;
      total += w;
    }
    if (total <= 0) return null;
    var x = r * total;
    for (i = 0; i < this.ORDER.length; i++) {
      x -= this._wsc[i];
      if (x <= 0) return this.ORDER[i];
    }
    return this.ORDER[this.ORDER.length - 1];
  },

  // Bring one chunk's animals into the water if they are not already there.
  // Exposed so a scene can drive streaming itself; update() does it for you.
  ensureChunk: function (chunkX, chunkY, seed) {
    if (!this.ensure()) return;
    var ck = chunkX + ',' + chunkY;
    if (this._seen[ck]) return;
    var list = this.spawnFor(chunkX, chunkY, (seed === undefined ? this.seed : seed));
    var all = true;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var rec = G.tame.wild[p.id];
      if (rec && rec.k) continue;               // this one already came home
      // ALREADY IN THE WATER? THEN DO NOT SPAWN IT AGAIN.
      //
      // This is THE stacking bug. A chunk is only remembered once EVERY animal in
      // it found a pool slot -- a sensible rule, since a full pool must not
      // silently erase one. But the animals that DID get slots stayed live, and
      // the chunk came round again on the very next frame, and spawned them a
      // second time: same id, same chunk key, same x and y, exactly on top of
      // themselves. Then a third. Then the pool hit its cap of twenty with the
      // same two or three animals stacked ten deep, which is what "there's like
      // 20 of them stacking" is.
      //
      // The id is already the identity (chunkX_chunkY_index), so the test is a
      // scan for it, and a present animal counts as placed.
      if (this._liveById(p.id)) continue;
      if (!this._spawnWild(p, rec, ck)) all = false;
    }
    // Only remember the chunk once everything in it actually made it into the
    // water; a full pool must not silently erase an animal.
    if (all) {
      this._seen[ck] = 1;
      this._seenN++;
      if (this._seenN > this.SEEN_MAX) this._pruneSeen();
    }
  },

  // The chunk memory is unbounded otherwise. Rebuilding it keeps only the chunks
  // that currently hold a live animal, so nothing near the player double-spawns.
  _pruneSeen: function () {
    var fresh = {}, n = 0;
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (m.live && m.kind === 0 && m.ck && !fresh[m.ck]) { fresh[m.ck] = 1; n++; }
    }
    this._seen = fresh;
    this._seenN = n;
  },

  // Is this exact animal already swimming? ids are stable per chunk, so this is
  // the whole duplicate test. Linear over 20 slots, called only while streaming.
  _liveById: function (id) {
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (m.live && m.kind === 0 && m.id === id) return true;
    }
    return false;
  },

  _spawnWild: function (p, rec, ck) {
    var m = this._slot();
    if (!m) return false;
    var sp = this.SPECIES[p.key];
    m.live = true;
    m.kind = 0;
    m.id = p.id;
    m.ck = ck;
    m.sp = p.key;
    m.spr = sp;
    m.petId = -1;
    m.x = p.x; m.y = p.y;
    m.hx = p.x; m.hy = p.y;
    m.tx = p.x; m.ty = p.y;
    m.vx = 0; m.vy = 0;
    m.dir = 1; m.bank = 0;
    m.alpha = 0;
    m.adult = p.adult;
    m.babies = p.babies;
    m.trust = rec ? rec.t : 0;
    m.ease = m.trust > 0 ? 0.25 : 0;             // it half-remembers you
    m.state = 0; m.stateT = 0;
    m.wanderT = 0; m.tagT = 0;
    m.animT = 0;
    m.rng = mulberry32((Math.imul(p.x | 0, 374761393) ^ Math.imul(p.y | 0, 668265263) ^ sp.idx) | 0);
    m.ph = m.rng() * TAU;
    m.bph[0] = m.rng() * TAU;
    m.bph[1] = m.rng() * TAU;
    return true;
  },

  // Pets that are marked as swimming with you get a mob the first frame of a trip.
  _ensurePets: function (px, py) {
    var pets = G.tame.pets, i, j, m, found;
    for (i = 0; i < pets.length; i++) {
      var p = pets[i];
      if (!p.out) continue;
      found = false;
      for (j = 0; j < this.MAX_MOBS; j++) {
        m = this.mobs[j];
        if (m.live && m.kind === 1 && m.petId === p.id) { found = true; break; }
      }
      if (found) continue;
      m = this._slot();
      if (!m) return;
      var sp = this._sp(p.sp);
      if (!sp) continue;
      m.live = true;
      m.kind = 1;
      m.id = 'pet' + p.id;
      m.ck = '';
      m.sp = p.sp;
      m.spr = sp;
      m.petId = p.id;
      m.slot = i;
      m.x = px - 36 - i * 10; m.y = py + 8 + i * 6;
      m.hx = m.x; m.hy = m.y;
      m.tx = m.x; m.ty = m.y;
      m.vx = 0; m.vy = 0;
      m.dir = 1; m.bank = 0; m.alpha = 0;
      m.adult = p.adult;
      m.babies = p.babies;
      m.trust = p.trust;
      m.ease = 1;
      m.state = 4; m.stateT = 0;
      m.animT = 0; m.wanderT = 0; m.tagT = 0;
      m.rng = mulberry32((p.id * 2654435761) | 0);
      m.ph = m.rng() * TAU;
      m.bph[0] = m.rng() * TAU;
      m.bph[1] = m.rng() * TAU;
    }
    // and drop any mob whose pet was released or left at home
    for (j = 0; j < this.MAX_MOBS; j++) {
      m = this.mobs[j];
      if (!m.live || m.kind !== 1) continue;
      var p2 = this.petById(m.petId);
      if (!p2 || !p2.out) m.live = false;
    }
  },

  // ================================================================== queries ===
  pets: function () { return this.ensure() ? G.tame.pets : []; },
  petCount: function () { return this.ensure() ? G.tame.pets.length : 0; },

  pet: function (i) {
    if (!this.ensure()) return null;
    var pets = G.tame.pets;
    return (i >= 0 && i < pets.length) ? pets[i] : null;
  },

  petById: function (id) {
    if (!this.ensure()) return null;
    var pets = G.tame.pets;
    for (var i = 0; i < pets.length; i++) if (pets[i].id === id) return pets[i];
    return null;
  },

  speciesOf: function (p) { return p ? this._sp(p.sp) : null; },

  // Ready to harvest? A friend never is -- that is the trade.
  ready: function (p) { return !!p && !p.favour && p.adult && p.cd <= 0; },
  readyCount: function () {
    if (!this.ensure()) return 0;
    var pets = G.tame.pets, n = 0;
    for (var i = 0; i < pets.length; i++) if (this.ready(pets[i])) n++;
    return n;
  },
  hungryCount: function () {
    if (!this.ensure()) return 0;
    var pets = G.tame.pets, n = 0;
    for (var i = 0; i < pets.length; i++) if (pets[i].fedDay !== G.day) n++;
    return n;
  },
  outCount: function () {
    if (!this.ensure()) return 0;
    var pets = G.tame.pets, n = 0;
    for (var i = 0; i < pets.length; i++) if (pets[i].out) n++;
    return n;
  },

  // Days of feeding still owed before the favour lands.
  bondLeft: function (p) {
    var sp = this.speciesOf(p);
    if (!sp || !p || p.favour) return 0;
    return Math.max(0, sp.bond - p.bond);
  },

  // ---- THE favour query -------------------------------------------------------
  // Accepts a favour id ('haul') or the species that grants it ('bison'), so a
  // caller can ask whichever way reads better at the call site. Total: an
  // unknown name is false, and a missing G is false.
  favour: function (name) {
    if (typeof name !== 'string' || !name) return false;
    if (!this.ensure()) return false;
    if (this._favDirty) this._rebuildFav();
    return Object.prototype.hasOwnProperty.call(this._fav, name) && this._fav[name] === true;
  },

  // Live list of granted favour ids, for help text and goals. Allocates -- call it
  // from a click or a draw that already has the budget, not from a hot loop.
  favours: function () {
    if (!this.ensure()) return [];
    if (this._favDirty) this._rebuildFav();
    var out = [], k;
    for (k in this.FAVOURS) {
      if (!Object.prototype.hasOwnProperty.call(this.FAVOURS, k)) continue;
      if (this._fav[k] === true) out.push(k);
    }
    return out;
  },

  _rebuildFav: function () {
    var f = this._fav, k;
    for (k in f) if (Object.prototype.hasOwnProperty.call(f, k)) f[k] = false;
    var pets = G.tame.pets;
    for (var i = 0; i < pets.length; i++) {
      var p = pets[i];
      if (!p.favour) continue;
      var sp = this.speciesOf(p);
      if (!sp) continue;
      f[sp.favour] = true;
      f[p.sp] = true;            // ask by species too
    }
    this._favDirty = false;
  },

  // ---- thin readers other systems can multiply blindly ------------------------
  // Each is total and cheap; a caller never has to know a favour exists.
  lootMul: function () { return this.favour('haul') ? 2 : 1; },          // bison
  airCostMul: function () { return this.favour('ferry') ? 0 : 1; },      // whale
  calmMul: function () { return this.favour('calm') ? 0.6 : 1; },        // melon
  healMul: function () { return this.favour('nourish') ? 1.5 : 1; },     // cow
  guardChance: function () { return this.favour('guard') ? 0.25 : 0; },  // clown
  seekRange: function () { return this.favour('seek') ? 150 : 0; },      // ray
  opensWrecks: function () { return this.favour('wrecks'); },            // narwhal

  // ================================================================ the pantry ==
  // Food may sit in the bag, the hotbar, flat storage, or -- for crop produce --
  // in G.farm.crops, which is a different stash entirely. _have and _spend walk
  // the SAME bins in the SAME order, so anything that reads as held can always be
  // spent. (The one asymmetry this codebase already has, where Craft.have sees
  // G.crafted but take() cannot spend it, is not repeated here.)
  isFood: function (key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(this.FOOD, key);
  },

  _bagHave: function (key) {
    var n = 0;
    if (typeof Inv !== 'undefined' && Inv && Inv.have) return Inv.have(key) || 0;
    if (typeof Hotbar !== 'undefined' && Hotbar && Hotbar.count) n += Hotbar.count('item', key) || 0;
    if (typeof G !== 'undefined' && G && G.storage &&
      Object.prototype.hasOwnProperty.call(G.storage, key)) {
      var s = G.storage[key];
      if (typeof s === 'number' && isFinite(s) && s > 0) n += Math.floor(s);
    }
    return n;
  },

  _farmHave: function (key) {
    var f = this.FOOD[key];
    if (!f || !f.farm) return 0;
    if (typeof G === 'undefined' || !G || !G.farm || !G.farm.crops) return 0;
    var n = G.farm.crops[f.farm];
    return (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
  },

  _have: function (key) {
    if (!this.isFood(key)) return 0;
    return this._bagHave(key) + this._farmHave(key);
  },

  // Offers and feeds always cost exactly ONE item, which is what keeps this
  // all-or-nothing without a partial-spend rollback.
  _spend: function (key) {
    if (this._have(key) < 1) return false;
    if (this._bagHave(key) >= 1) {
      if (typeof Inv !== 'undefined' && Inv && Inv.spend) { if (Inv.spend(key, 1)) return true; }
      else {
        if (typeof Hotbar !== 'undefined' && Hotbar && Hotbar.take && Hotbar.take('item', key, 1) >= 1) return true;
        if (G && G.storage && G.storage[key] >= 1) { G.storage[key] -= 1; return true; }
      }
    }
    if (this._farmHave(key) >= 1) {
      G.farm.crops[this.FOOD[key].farm] -= 1;
      return true;
    }
    return false;
  },

  // Every food key the player is holding, favourites-first for a species. Builds
  // an array, so this is for clicks and panels only.
  foodHeld: function (spKey) {
    var out = [], i, k, sp = this._sp(spKey);
    if (sp && this._have(sp.fav) > 0) out.push(sp.fav);
    if (sp) for (i = 0; i < sp.likes.length; i++) {
      k = sp.likes[i];
      if (out.indexOf(k) < 0 && this._have(k) > 0) out.push(k);
    }
    for (i = 0; i < this.FOOD_ORDER.length; i++) {
      k = this.FOOD_ORDER[i];
      if (out.indexOf(k) < 0 && this._have(k) > 0) out.push(k);
    }
    return out;
  },

  itemName: function (key) {
    if (typeof ITEMS !== 'undefined' && ITEMS && ITEMS[key] && ITEMS[key].name) return ITEMS[key].name;
    if (this.isFood(key) && this.FOOD[key].name) return this.FOOD[key].name;
    if (typeof Inv !== 'undefined' && Inv && Inv.name) return Inv.name(key);
    if (typeof Hotbar !== 'undefined' && Hotbar && Hotbar.ITEM_NAMES && Hotbar.ITEM_NAMES[key])
      return Hotbar.ITEM_NAMES[key];
    return typeof key === 'string' ? key : '?';
  },

  // =================================================================== courtship =
  // How an animal rates a mouthful.
  tierOf: function (spKey, itemKey) {
    var sp = this._sp(spKey);
    if (!sp || !this.isFood(itemKey)) return 'inedible';
    if (itemKey === sp.fav) return 'fav';
    if (sp.likes.indexOf(itemKey) >= 0) return 'like';
    if (this.FOOD[itemKey].treat) return 'treat';
    return 'ok';
  },

  // Is this animal close enough and settled enough to take something?
  canOffer: function (m) {
    if (!m || !m.live) return false;
    if (m.state === 2) return false;                        // bolting
    if (this._lpx === null) return false;
    var dx = this._lpx - m.x, dy = this._lpy - m.y;
    if (dx * dx + dy * dy > this.OFFER_R * this.OFFER_R) return false;
    if (m.kind === 1) return true;                          // your own will always eat
    return m.ease >= this.EASE_NEED * 0.6;
  },

  // The nearest animal that would take food right now, or null. Recomputed once a
  // frame in update, so the touch layout and the prompt agree.
  offerable: function () { return this._offerable; },

  nearest: function (px, py, r) {
    var best = null, bd = (r === undefined ? this.NOTICE_R : r);
    bd = bd * bd;
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live) continue;
      var dx = px - m.x, dy = py - m.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  },

  // ---- THE verb ---------------------------------------------------------------
  // Tame.offer(animal, itemKey) -> { ok, react, delta, trust, tier, tamed }
  //
  // `animal` may be a live mob, a mob id string, or a pet record. The item is
  // SPENT here (exactly one), so this is the single entry point and no caller has
  // to remember to pay. A refusal spends nothing.
  offer: function (animal, itemKey) {
    var res = { ok: false, react: '', delta: 0, trust: 0, tier: 'inedible', tamed: false };
    if (!this.ensure()) return res;
    var m = this._resolve(animal);
    if (!m) { res.react = 'there is nothing there to feed.'; return res; }
    var sp = m.spr;
    res.trust = m.trust;

    if (!this.isFood(itemKey)) {
      res.tier = 'inedible';
      res.react = this._who(m) + ' ' + this._line(m, 'inedible');
      this._snd('blip');
      this._say(res.react);
      return res;                                       // nothing spent, no harm
    }
    if (!this.canOffer(m)) {
      res.react = m.state === 2
        ? this._who(m) + ' is not letting you anywhere near it.'
        : 'get closer, and slower.';
      this._snd('blip');
      this._say(res.react);
      return res;
    }
    if (this._have(itemKey) < 1) {
      res.react = 'you have no ' + this.itemName(itemKey) + '.';
      this._snd('blip');
      this._say(res.react);
      return res;
    }

    // A pet is not being courted any more; feeding it is care, not trust.
    if (m.kind === 1) {
      var p = this.petById(m.petId);
      if (p) {
        var fed = this.feed(this._petIndex(p), itemKey);
        res.ok = fed;
        res.tier = this.tierOf(m.sp, itemKey);
        res.react = this._note;
        res.trust = p.trust;
        if (fed) { m.state = 3; m.stateT = this.FEED_T; }
        return res;
      }
    }

    if (!this._spend(itemKey)) {
      res.react = 'you have no ' + this.itemName(itemKey) + '.';
      this._snd('blip');
      this._say(res.react);
      return res;
    }

    var tier = this.tierOf(m.sp, itemKey);
    res.tier = tier;
    var rec = G.tame.wild[m.id];
    if (!rec) rec = G.tame.wild[m.id] = { t: m.trust, f: 0, d: G.day, k: 0 };
    if (rec.d !== G.day) { rec.d = G.day; rec.f = 0; rec.p = 0; }

    // Wariness, how settled it is, and how much it has already had today. The
    // day cap is what makes taming take several ENCOUNTERS instead of one hover.
    var base = this.GAIN[tier];
    var tired = rec.f >= this.FEEDS_DAY ? this.TIRED_MUL : 1;
    var settle = 0.45 + 0.55 * clamp(m.ease, 0, 1);
    var delta = base * (1 - sp.wary * 0.45) * settle * tired * this._buff('tameChance', 1);
    delta = Math.round(delta * 10) / 10;

    m.trust = clamp(m.trust + delta, 0, this.TRUST_MAX);
    rec.f++;
    rec.t = m.trust;
    res.delta = delta;
    res.trust = m.trust;
    res.ok = true;

    if (delta >= 0) {
      m.ease = clamp(m.ease + 0.3, 0, 1);
      m.state = 3;                                    // eating
      m.stateT = this.FEED_T;
      m.vx *= 0.3; m.vy *= 0.3;
      this._fly(m.x, m.y - sp.box * 0.5, '+' + (delta >= 10 ? Math.round(delta) : delta) + ' trust', 0);
      this._snd(tier === 'fav' ? 'chime' : 'pop', 1.1);
      this._buzz(tier === 'fav' ? 15 : 12);
      this._xp('taming', tier === 'fav' ? 5 : 3);
    } else {
      this._spookMob(m, 0.7);
      this._snd('clank');
      this._buzz(40);
    }

    res.react = this._who(m) + ' ' + this._line(m, tier);
    if (tier !== 'fav' && tier !== 'wrong' && this._have(sp.fav) <= 0)
      res.react += ' (it would rather have ' + this.itemName(sp.fav) + '.)';
    this._say(res.react);

    if (m.trust >= this.TRUST_MAX) {
      var adopted = this._adopt(m);
      res.tamed = adopted;
      if (!adopted) {
        // No room at home. Hold it just short of tame so nothing is wasted and the
        // player can come back once they have made space.
        m.trust = this.TRUST_MAX - 6;
        rec.t = m.trust;
        res.react = 'the tide pool is full -- ' + this._who(m) + ' cannot come home with you.';
        this._say(res.react);
      }
    }
    this._save();
    return res;
  },

  // ---- PETTING ------------------------------------------------------------------
  // Swim up to anything and pet it. No food, no inventory, no menu: get close,
  // press the verb, and it warms to you. Food still exists and is still faster
  // (and a favourite much faster), but nothing in the sea is gated behind
  // carrying the right item any more -- petting alone will tame anything, it just
  // takes more visits.
  //
  // The day cap is what keeps it a courtship rather than a hold-to-win: after
  // PETS_DAY the animal has had enough of you until tomorrow.
  PET_GAIN: 4,
  PETS_DAY: 6,

  canPet: function (m) {
    if (!m || !m.live) return false;
    if (m.state === 2) return false;                        // bolting
    if (this._lpx === null) return false;
    var dx = this._lpx - m.x, dy = this._lpy - m.y;
    return dx * dx + dy * dy <= this.OFFER_R * this.OFFER_R;
  },

  // ---- the petting game -------------------------------------------------------
  // [E] on an animal starts a short sweep over its head. [E] again stops it: in
  // the heart zone the pet lands PERFECT (double trust, a burst of hearts);
  // anywhere else it is still a pet. Let it run out and the animal gets a plain
  // pat. Three seconds, no fail state: the game is a chance at a bonus, never a
  // way to lose the moment.
  petGame: null,

  pet: function (animal) {
    var res = { ok: false, react: '', delta: 0, trust: 0, tamed: false };
    if (!this.ensure()) return res;
    if (this.petGame) {
      var g = this.petGame;
      var perfect = Math.abs(g.sweep - 0.5) < 0.14;
      this.petGame = null;
      return this._petApply(g.m, perfect ? 2 : 1, perfect);
    }
    var m = this._resolve(animal);
    if (!m) return res;
    if (this.canPet(m)) {
      m.state = 3; m.stateT = 3.4;
      m.vx *= 0.3; m.vy *= 0.3;
      this.petGame = { m: m, t: 0, sweep: rand(1), dir: 1 };
      this._snd('blip');
      res.ok = true;
      return res;
    }
    return this._petRefuse(m, res);
  },

  _petRefuse: function (m, res) {
    res.react = m.state === 2 ? this._who(m) + ' will not let you close.' : 'get closer, and slower.';
    this._snd('blip'); this._say(res.react);
    return res;
  },

  _petApply: function (animal, mult, perfect) {
    var res = { ok: false, react: '', delta: 0, trust: 0, tamed: false };
    if (!this.ensure()) return res;
    var m = this._resolve(animal);
    if (!m) return res;
    if (!this.canPet(m)) {
      return this._petRefuse(m, res);
    }
    var sp = m.spr;
    res.trust = m.trust;

    // An already-tamed companion just enjoys it: hearts, no trust to gain.
    if (m.kind === 1) {
      m.state = 3; m.stateT = this.FEED_T;
      m.vx *= 0.3; m.vy *= 0.3;
      this._hearts(m, 3);
      this._snd('chime', 1.15);
      res.ok = true;
      res.react = this._who(m) + ' leans into your paw.';
      this._say(res.react);
      return res;
    }

    // Same per-animal, per-day record the feeding path keeps; `p` is the pet
    // counter and rides along with `f`, both cleared on the day roll below.
    var rec = G.tame.wild[m.id];
    if (!rec) rec = G.tame.wild[m.id] = { t: m.trust, f: 0, d: G.day, k: 0, p: 0 };
    if (rec.d !== G.day) { rec.d = G.day; rec.f = 0; rec.p = 0; }
    if (typeof rec.p !== 'number') rec.p = 0;
    if (rec.p >= this.PETS_DAY) {
      res.react = this._who(m) + ' has had enough fuss for one day.';
      this._snd('blip'); this._say(res.react);
      return res;
    }

    var settle = 0.45 + 0.55 * clamp(m.ease, 0, 1);
    var delta = Math.round(this.PET_GAIN * (mult || 1) * (1 - sp.wary * 0.5) * settle *
                           this._buff('tameChance', 1) * 10) / 10;
    m.trust = clamp(m.trust + delta, 0, this.TRUST_MAX);
    m.ease = clamp(m.ease + 0.34, 0, 1);
    rec.p++;
    rec.t = m.trust;
    m.state = 3; m.stateT = this.FEED_T;
    m.vx *= 0.3; m.vy *= 0.3;

    this._hearts(m, perfect ? 5 : 2);
    this._fly(m.x, m.y - sp.box * 0.5, (perfect ? 'perfect!  ' : '') + '+' + delta + ' trust', 0);
    this._snd(perfect ? 'chime' : 'pop', 1.05);
    this._buzz(10);
    this._xp('taming', 2);
    res.ok = true;
    res.delta = delta;
    res.trust = m.trust;
    res.react = this._who(m) + ' likes that.';
    this._say(res.react);

    if (m.trust >= this.TRUST_MAX) {
      var adopted = this._adopt(m);
      res.tamed = adopted;
      if (!adopted) {
        m.trust = this.TRUST_MAX - 6;
        rec.t = m.trust;
        res.react = 'the tide pool is full -- ' + this._who(m) + ' cannot come home with you.';
        this._say(res.react);
      }
    }
    this._save();
    return res;
  },

  // little hearts off the animal, reusing the puff pool's flyer channel
  _hearts: function (m, n) {
    for (var i = 0; i < n; i++) {
      this._fly(m.x + rand(-8, 8), m.y - (m.spr.box * 0.4) - i * 6, '<3', 1);
    }
  },

  // Is there anything in the bag this animal would actually take? Petting is the
  // fallback precisely when this is false.
  _hasAnyFoodFor: function (m) {
    if (!m || !m.spr) return false;
    if (this._have(m.spr.fav) > 0) return true;
    for (var k in this.FOOD) {
      if (!Object.prototype.hasOwnProperty.call(this.FOOD, k)) continue;
      if (this._have(k) > 0) return true;
    }
    return false;
  },

  // The nearest animal close enough to pet, ignoring whether it would eat.
  // Petting has no food gate, so this window is wider than _offerable's.
  pettable: function () {
    if (this._lpx === null) return null;
    var best = null, bd = this.OFFER_R * this.OFFER_R;
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live || m.state === 2) continue;
      var dx = this._lpx - m.x, dy = this._lpy - m.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  },

  // Offer whatever is sensible from what the player is carrying: the selected
  // hotbar item if it is food, otherwise the animal's favourite, otherwise
  // anything edible. This is what the [T] key and the touch pad call.
  offerSelected: function (target) {
    if (!this.ensure()) return null;
    var m = this._resolve(target || this._offerable);
    if (!m) { this._say('nothing close enough to feed.'); this._snd('blip'); return null; }
    var key = null;
    if (typeof Hotbar !== 'undefined' && Hotbar && Hotbar.selected) {
      var s = Hotbar.selected();
      if (s && s.kind === 'item' && this.isFood(s.key) && this._have(s.key) > 0) key = s.key;
    }
    if (!key) {
      var held = this.foodHeld(m.sp);
      if (!held.length) {
        this._say('you have nothing it would want to eat.');
        this._snd('blip');
        return null;
      }
      key = held[0];
    }
    return this.offer(m, key);
  },

  _resolve: function (a) {
    if (!a) return null;
    var i, m;
    if (typeof a === 'string') {
      for (i = 0; i < this.MAX_MOBS; i++) { m = this.mobs[i]; if (m.live && m.id === a) return m; }
      return null;
    }
    if (a.live !== undefined) return a.live ? a : null;      // already a mob
    if (a.id !== undefined && a.sp !== undefined) {          // a pet record
      for (i = 0; i < this.MAX_MOBS; i++) {
        m = this.mobs[i];
        if (m.live && m.kind === 1 && m.petId === a.id) return m;
      }
    }
    return null;
  },

  _who: function (m) {
    if (m.kind === 1) {
      var p = this.petById(m.petId);
      if (p) return p.name;
    }
    return 'the ' + m.spr.name;
  },

  _line: function (m, tier) {
    var pool = this.LINES[tier] || this.LINES.ok;
    var r = m.rng ? m.rng() : Math.random();
    return pool[Math.floor(r * pool.length) % pool.length];
  },

  // it follows you home
  _adopt: function (m) {
    var pets = G.tame.pets;
    if (pets.length >= this.MAX_PETS) return false;
    var sp = m.spr;
    var p = {
      id: G.tame.nextId++,
      sp: m.sp,
      name: this._pickName(),
      adult: m.adult,
      age: m.adult ? sp.grow : 0,
      trust: this.TRUST_MAX,
      mood: 0.75,
      bond: 0,
      cd: m.adult ? 1 : sp.grow,
      babies: m.babies,
      favour: false,
      out: this.outCount() < this.MAX_OUT,
      fedDay: G.day,
      harvDay: -1,
      wid: m.id,
    };
    pets.push(p);
    G.tame.tamed++;
    this._dirty = true;

    var rec = G.tame.wild[m.id];
    if (!rec) rec = G.tame.wild[m.id] = { t: this.TRUST_MAX, f: 0, d: G.day, k: 1 };
    rec.k = 1;                                   // never respawns as wild again
    rec.t = this.TRUST_MAX;

    // the same animal, still in the water -- it just follows you now
    m.kind = 1;
    m.petId = p.id;
    m.trust = this.TRUST_MAX;
    m.ease = 1;
    m.state = 4;
    m.stateT = 0;
    if (!p.out) m.live = false;

    this._snd('chime');
    this._buzz(22);
    this._xp('taming', 45);
    this._toast(p.name + ' the ' + sp.name + ' is coming home with you!');
    if (!G.flags.seenTameHome) {
      G.flags.seenTameHome = 1;
      this._toast('find the tide pool on the dock -- or press [T] anywhere on the planks.');
    }
    this.ensure();
    this._favDirty = true;
    this._save();
    return true;
  },

  _pickName: function () {
    var used = {}, pets = (G && G.tame && Array.isArray(G.tame.pets)) ? G.tame.pets : [], i;
    for (i = 0; i < pets.length; i++) if (pets[i] && pets[i].name) used[pets[i].name] = 1;
    var start = Math.floor(rand(this.NAMES.length));
    for (i = 0; i < this.NAMES.length; i++) {
      var n = this.NAMES[(start + i) % this.NAMES.length];
      if (!used[n]) return n;
    }
    return 'Number ' + (pets.length + 1);
  },

  _petIndex: function (p) {
    var pets = G.tame.pets;
    for (var i = 0; i < pets.length; i++) if (pets[i] === p) return i;
    return -1;
  },

  // ================================================================= pet verbs ==
  // Feed a companion. Once a day it counts towards the BOND -- the road to a
  // favour -- and any day at all it lifts the mood. Costs one item.
  feed: function (i, itemKey) {
    if (!this.ensure()) return false;
    var p = this.pet(i);
    if (!p) return false;
    var sp = this.speciesOf(p);
    if (!sp) return false;
    if (!itemKey) {
      var held = this.foodHeld(p.sp);
      if (!held.length) { this._say('nothing in your bag it would eat.'); this._snd('blip'); return false; }
      itemKey = held[0];
    }
    if (!this.isFood(itemKey) || this._have(itemKey) < 1) {
      this._say('you have no ' + this.itemName(itemKey) + '.');
      this._snd('blip');
      return false;
    }
    var firstToday = p.fedDay !== G.day;
    if (!firstToday && p.mood >= 0.999) {
      this._say(p.name + ' has had plenty today.');
      this._snd('blip');
      return false;
    }
    if (!this._spend(itemKey)) { this._snd('alarm'); return false; }

    var tier = this.tierOf(p.sp, itemKey);
    var gain = this.MOOD_FED * (tier === 'fav' ? 1.35 : (tier === 'treat' ? 1.2 : (tier === 'like' ? 1 : 0.7)));
    p.mood = clamp(p.mood + gain * this._buff('happyGain', 1), 0, 1);
    p.trust = clamp(p.trust + (firstToday ? 1 : 0), 0, this.TRUST_MAX);

    var note = p.name + ' eats the ' + this.itemName(itemKey) + '.';
    if (firstToday) {
      p.fedDay = G.day;
      // The bond only advances while you are NOT taking produce off it. That is
      // the whole choice, so it is checked here rather than at harvest time.
      if (!p.favour) {
        p.bond++;
        var left = this.bondLeft(p);
        if (left > 0) note += ' bond ' + p.bond + '/' + sp.bond + '.';
        if (left <= 0 && p.mood >= 0.8 && p.adult) this._grant(p, sp);
        else if (left <= 0 && !p.adult) note += ' still growing.';
        else if (left <= 0) note += ' it wants a happier day than this.';
      }
    }
    this._say(note);
    this._snd(tier === 'fav' ? 'chime' : 'pop', 1);
    this._buzz(12);
    this._xp('taming', firstToday ? 4 : 1);
    this._dirty = true;
    this._save();
    return true;
  },

  _grant: function (p, sp) {
    p.favour = true;
    p.cd = 0;
    G.tame.granted++;
    this._favDirty = true;
    this._dirty = true;
    var f = this.FAVOURS[sp.favour];
    this._snd('chime');
    this._buzz(22);
    this._xp('taming', 60);
    this._toast(p.name + ' will never be a crop now -- ' + (f ? f.name : sp.favour) + '.');
    if (f) this._toast(f.desc);
  },

  // Take the produce. Resets the bond to nothing: you cannot have both.
  harvest: function (i) {
    if (!this.ensure()) return null;
    var p = this.pet(i);
    if (!p) return null;
    var sp = this.speciesOf(p);
    if (!sp) return null;
    if (p.favour) {
      this._say(p.name + ' is a friend now, not a crop.');
      this._snd('blip');
      return null;
    }
    if (!p.adult) {
      this._say(p.name + ' is still small. give it ' + Math.max(1, sp.grow - p.age) + ' more days.');
      this._snd('blip');
      return null;
    }
    if (p.cd > 0) {
      this._say(p.name + ' has nothing for you for ' + Math.ceil(p.cd) + ' more day' + (p.cd > 1 ? 's' : '') + '.');
      this._snd('blip');
      return null;
    }
    var n = 1;
    if (p.mood > 0.85 && rand() < 0.3) n = 2;
    n = Math.max(1, Math.round(n * this._buff('stockYield', 1)));
    this.give(sp.prod.key, n);

    p.cd = sp.cool;
    p.harvDay = G.day;
    p.mood = clamp(p.mood - this.MOOD_WORK, 0, 1);
    // the streak breaks -- the whole point of the other path
    var lost = p.bond;
    p.bond = 0;
    G.tame.harvested += n;
    this._dirty = true;

    this._snd('pop', 1.2);
    this._buzz(15);
    this._xp('taming', 7);
    var note = 'took ' + n + ' ' + sp.prod.name + (n > 1 ? 's' : '') + ' from ' + p.name + '.';
    if (lost > 0) note += ' the bond starts over.';
    this._say(note);
    this._toast(note);
    this._save();
    return sp.prod.key;
  },

  // Bring it along, or leave it at the tide pool.
  toggleOut: function (i) {
    if (!this.ensure()) return false;
    var p = this.pet(i);
    if (!p) return false;
    if (!p.out && this.outCount() >= this.MAX_OUT) {
      this._say('only ' + this.MAX_OUT + ' can swim with you at once.');
      this._snd('blip');
      return false;
    }
    p.out = !p.out;
    this._say(p.out ? p.name + ' will come along.' : p.name + ' will wait at the pool.');
    this._snd('click');
    this._dirty = true;
    this._save();
    return true;
  },

  // Back to the sea. It remembers you -- most of the way, anyway -- so a released
  // animal is easier to win back than a stranger.
  release: function (i) {
    if (!this.ensure()) return false;
    var p = this.pet(i);
    if (!p) return false;
    var sp = this.speciesOf(p);
    var name = p.name;
    if (p.wid && G.tame.wild[p.wid]) {
      G.tame.wild[p.wid].k = 0;
      G.tame.wild[p.wid].t = this.TRUST_MAX * 0.6;
    }
    for (var j = 0; j < this.MAX_MOBS; j++) {
      var m = this.mobs[j];
      if (m.live && m.kind === 1 && m.petId === p.id) m.live = false;
    }
    G.tame.pets.splice(i, 1);
    G.tame.released++;
    this._dirty = true;
    this._favDirty = true;
    if (this.sel >= G.tame.pets.length) this.sel = Math.max(0, G.tame.pets.length - 1);
    this._clampScroll();
    this._snd('splash');
    this._toast(name + ' the ' + (sp ? sp.name : 'animal') + ' swims off into the blue.');
    this._say(name + ' is free.');
    this._save();
    return true;
  },

  // ================================================================ the night ===
  // Two independent code paths increment G.day and only the sleep path fires the
  // per-system newDay hooks, so this is an idempotent catch-up driven off a
  // persisted lastDay -- exactly like Farm and Stock. update() re-checks it every
  // frame, so the clock-driven roll is covered too.
  newDay: function () {
    if (!this.ensure()) return;
    var s = G.tame;
    if (s.lastDay >= G.day) return;
    var guard = 0;
    while (s.lastDay < G.day && guard++ < 30) { this._night(); s.lastDay++; }
    s.lastDay = G.day;               // absurd gaps (edited saves) collapse
    this._dirty = true;
    this.ensure();
    this._save();
  },

  _night: function () {
    var pets = G.tame.pets, i, ready = 0, hungry = 0, grown = 0, gifts = 0;
    for (i = 0; i < pets.length; i++) {
      var p = pets[i];
      var sp = this.speciesOf(p);
      if (!sp) continue;
      p.age++;
      if (!p.adult && p.age >= sp.grow) { p.adult = true; grown++; }

      var fedYesterday = p.fedDay >= G.tame.lastDay;
      if (fedYesterday) {
        p.mood = clamp(p.mood + 0.04 * this._buff('happyGain', 1), 0, 1);
      } else {
        p.mood = clamp(p.mood - this.MOOD_HUNGRY, 0, 1);
        hungry++;
        // patience is a habit, and habits lapse
        if (p.bond > 0 && !p.favour) p.bond = Math.max(0, p.bond - 1);
      }

      if (!p.favour) {
        if (p.cd > 0) p.cd = Math.max(0, p.cd - 1);
        if (this.ready(p)) ready++;
      } else {
        // the two favours that pay out every morning
        if (sp.favour === 'pearl') { this.give('pearl', 1); gifts++; }
        if (sp.favour === 'forage') { this.give('driftwood', 1); gifts++; }
      }
    }
    var bits = [];
    if (ready) bits.push(ready + ' to harvest');
    if (grown) bits.push(grown + ' grown up');
    if (hungry) bits.push(hungry + ' unfed');
    if (gifts) bits.push(gifts + ' left you something');
    if (bits.length) this._toast('Tide pool: ' + bits.join('  '));
  },

  // ================================================================ selling =====
  // Shop-shaped rows, the same contract Stock.shipRows() publishes, so an
  // integrator can do `rows = rows.concat(Tame.shipRows())` on the SELL tab.
  // Shop's own SELL tab only walks ITEM_KEYS, which is why this exists.
  held: function (key) {
    if (typeof G === 'undefined' || !G || !G.storage) return 0;
    var n = 0;
    if (Object.prototype.hasOwnProperty.call(G.storage, key)) {
      var s = G.storage[key];
      if (typeof s === 'number' && isFinite(s) && s > 0) n += Math.floor(s);
    }
    if (typeof Inv !== 'undefined' && Inv && Inv.count) n += Inv.count(key) || 0;
    return n;
  },

  productOf: function (key) {
    for (var i = 0; i < this.ORDER.length; i++) {
      var sp = this.SPECIES[this.ORDER[i]];
      if (sp.prod.key === key) return sp;
    }
    return null;
  },

  productValue: function () {
    var v = 0;
    for (var i = 0; i < this.ORDER.length; i++) {
      var sp = this.SPECIES[this.ORDER[i]];
      v += this.held(sp.prod.key) * sp.prod.value;
    }
    return v;
  },

  shipProducts: function (keys) {
    if (!this.ensure()) return 0;
    var v = 0, c = 0, i;
    for (i = 0; i < keys.length; i++) {
      var sp = this.productOf(keys[i]);
      if (!sp) continue;
      var n = this.held(keys[i]);
      if (n <= 0) continue;
      v += n * sp.prod.value;
      c += n;
      if (G.storage) G.storage[keys[i]] = 0;
      if (typeof Inv !== 'undefined' && Inv && Inv.remove && Inv.count) {
        var inBag = Inv.count(keys[i]);
        if (inBag > 0) Inv.remove(keys[i], inBag);
      }
    }
    if (!c) return 0;
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    this._snd('click');
    this._toast('Companion produce shipped: $' + v + ' -- drone en route!');
    this._save();
    return v;
  },

  shipRows: function () {
    if (!this.ensure()) return [];
    var rows = [], total = 0, all = [], self = this;
    for (var i = 0; i < this.ORDER.length; i++) {
      var sp = this.SPECIES[this.ORDER[i]];
      var n = this.held(sp.prod.key);
      if (n <= 0) continue;
      var val = n * sp.prod.value;
      total += val;
      all.push(sp.prod.key);
      rows.push(this._shipRow(sp, n, val));
    }
    if (total > 0) rows.push({
      label: 'SHIP ALL COMPANION PRODUCE', sub: 'one big crate', btn: '$' + total,
      act: function () { self.shipProducts(all); },
    });
    return rows;
  },

  _shipRow: function (sp, n, val) {
    var self = this, key = sp.prod.key;
    return {
      gart: sp.prod.art,
      label: sp.prod.name + '  x' + n,
      sub: '$' + sp.prod.value + ' each',
      btn: 'SHIP $' + val,
      act: function () { self.shipProducts([key]); },
    };
  },

  // ==================================================================== update ==
  // dt, and Otto's centre in world units. js/integrate.js calls this from its
  // Ocean.update wrapper.
  update: function (dt, px, py) {
    this._openT = Math.min(1, this._openT + (dt || 0) * 4.5);
    if (!this.ensure()) return;
    // A wiring layer and a self-installed hook may both tick us; Game.time
    // advances exactly once per frame, so the first call in a frame wins.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;              // a tab-switch must not teleport anything
    this.time += dt;
    if (G.tame.lastDay < G.day) this.newDay();

    if (typeof px !== 'number' || !isFinite(px)) px = this._lpx === null ? 0 : this._lpx;
    if (typeof py !== 'number' || !isFinite(py)) py = this._lpy === null ? 0 : this._lpy;

    // Approach speed is the whole taming mechanic and no caller passes it, so it
    // is measured here and smoothed the way Input.mouse.speed is.
    if (this._lpx === null) { this._pspd = 0; }
    else {
      var dx = px - this._lpx, dy = py - this._lpy;
      var inst = Math.sqrt(dx * dx + dy * dy) / Math.max(dt, 0.001);
      this._pspd = lerp(this._pspd, inst, 0.4);
    }
    this._lpx = px;
    this._lpy = py;

    this._stream(px, py);
    this._ensurePets(px, py);
    this._ai(dt, px, py);
    this._updatePuffs(dt);
    this._updateWake(dt);

    // the petting sweep: ping-pong needle, three-second patience, and it lets go
    // if the animal breaks or the player drifts off
    if (this.petGame) {
      var pg = this.petGame;
      pg.t += dt;
      pg.sweep += pg.dir * dt * 1.5;
      if (pg.sweep > 1) { pg.sweep = 1; pg.dir = -1; }
      if (pg.sweep < 0) { pg.sweep = 0; pg.dir = 1; }
      var pm = pg.m;
      var gone = !pm || !pm.live || pm.state === 2;
      if (!gone && typeof Ocean !== 'undefined') {
        var pdx = pm.x - Ocean.px, pdy = pm.y - Ocean.py;
        gone = (pdx * pdx + pdy * pdy) > 60 * 60;
      }
      if (gone) this.petGame = null;
      else if (pg.t >= 3) { this.petGame = null; this._petApply(pm, 1, false); }
    }
    this._updateFlys(dt);
    this._pickOfferable(px, py);
    this._verbInput();
    if (this._noteT > 0) this._noteT -= dt;
  },

  _stream: function (px, py) {
    var cw = this.CHUNK_W, ch = this.CHUNK_H;
    var c0 = Math.floor((px - cw) / cw), c1 = Math.floor((px + cw) / cw);
    var r0 = Math.floor((py - ch) / ch), r1 = Math.floor((py + ch) / ch);
    for (var cx = c0; cx <= c1; cx++)
      for (var cy = r0; cy <= r1; cy++) this.ensureChunk(cx, cy, this.seed);
  },

  // ---- the AI -----------------------------------------------------------------
  // States: 0 wander, 1 curious, 2 flee, 3 eating, 4 following.
  _ai: function (dt, px, py) {
    var far = this.DESPAWN_R * this.DESPAWN_R;
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live) continue;
      var sp = m.spr;
      var dx = px - m.x, dy = py - m.y;
      var d2 = dx * dx + dy * dy;

      if (m.kind === 0 && d2 > far) { this._freeMob(m); continue; }

      m.animT += dt;
      m.alpha = Math.min(1, m.alpha + dt * 2.2);        // fade in, never pop in
      if (m.tagT > 0) m.tagT -= dt;

      if (m.kind === 1) this._aiPet(m, sp, dt, px, py, dx, dy, d2);
      else this._aiWild(m, sp, dt, px, py, dx, dy, d2);

      this._move(m, sp, dt);
    }
  },

  _aiWild: function (m, sp, dt, px, py, dx, dy, d2) {
    var near = d2 < this.NOTICE_R * this.NOTICE_R;
    var d = Math.sqrt(d2);

    if (m.state === 3) {                                // eating: hold still
      m.stateT -= dt;
      m.tx = m.x; m.ty = m.y;
      if (px !== m.x) m.dir = px > m.x ? 1 : -1;
      if (m.stateT <= 0) { m.state = 1; m.stateT = 0; }
      return;
    }

    if (m.state === 2) {                                // bolting
      m.stateT -= dt;
      var away = d > 0.01 ? 1 / d : 0;
      m.tx = m.x - dx * away * 240;
      m.ty = m.y - dy * away * 240 + (m.ph > 3 ? -40 : 40);
      if (m.stateT <= 0) { m.state = 0; m.wanderT = 0; }
      return;
    }

    // Barging into one always costs you, however slowly you were going.
    if (d < this.BUMP_R + sp.box * 0.3) { this._spookMob(m, 1); return; }

    if (near) {
      var spook = this.SPOOK_SPEED * (1 + m.trust / 260) * (1 + (1 - sp.wary) * 0.35);
      if (this._pspd > spook) { this._spookMob(m, 1); return; }
      if (this._pspd < this.CALM_SPEED) m.ease = clamp(m.ease + dt * this.EASE_UP * (1 - sp.wary * 0.5), 0, 1);
      else m.ease = clamp(m.ease - dt * this.EASE_DOWN * 0.5, 0, 1);
    } else {
      m.ease = clamp(m.ease - dt * this.EASE_DOWN * 0.35, 0, 1);
    }

    if (near && m.ease >= this.EASE_NEED) {
      if (m.state !== 1) {
        m.state = 1;
        if (typeof G !== 'undefined' && G && G.flags && !G.flags.seenTame) {
          G.flags.seenTame = 1;
          this._toast('something is curious about you. move slowly -- speed spooks them.');
          this._toast(this._touch() ? 'swim up and tap it to pet it -- food is faster, but not needed.'
            : 'swim up and press [E] to pet it -- food is faster, but not needed.');
          this._save();
        }
      }
      // hover at a standoff on the side it is already on
      var stand = this.STANDOFF + sp.box * 0.35;
      var side = m.x < px ? -1 : 1;
      m.tx = px + side * stand;
      m.ty = py + Math.sin(this.time * 0.7 + m.ph) * 10;
      m.dir = px > m.x ? 1 : -1;
      return;
    }

    if (m.state === 1) { m.state = 0; m.wanderT = 0; }
    this._wander(m, sp, dt);
  },

  _wander: function (m, sp, dt) {
    m.wanderT -= dt;
    var dx = m.tx - m.x, dy = m.ty - m.y;
    if (m.wanderT <= 0 || dx * dx + dy * dy < 64) {
      var r = m.rng || Math.random;
      m.wanderT = 2.4 + (m.rng ? m.rng() : 0.5) * 3.4;
      var rad = sp.speed < 20 ? 22 : 120;         // a clam does not go far
      m.tx = m.hx + (r() - 0.5) * rad * 2;
      m.ty = m.hy + (r() - 0.5) * rad;
      if (m.ty < this.SURFACE_Y + 18) m.ty = this.SURFACE_Y + 18;
      if (m.ty > this.FLOOR_Y) m.ty = this.FLOOR_Y;
    }
  },

  _aiPet: function (m, sp, dt, px, py, dx, dy, d2) {
    if (m.state === 3) {
      m.stateT -= dt;
      m.tx = m.x; m.ty = m.y;
      if (m.stateT <= 0) m.state = 4;
      return;
    }
    m.state = 4;
    var p = this.petById(m.petId);
    var slot = m.slot || 0;
    // trail behind and a little below, fanned out so three companions read as
    // three animals rather than one smear
    var side = px >= (this._lpx === null ? px : this._lpx) ? -1 : 1;
    var gap = this.FOLLOW_GAP + slot * 16 + sp.box * 0.25;
    m.tx = px + side * gap;
    m.ty = py + 10 + slot * 12 + Math.sin(this.time * 0.9 + m.ph) * 8;
    if (m.ty < this.SURFACE_Y + 14) m.ty = this.SURFACE_Y + 14;
    // a sulking animal lags; a happy one keeps up
    m.ease = p ? clamp(0.4 + p.mood * 0.6, 0, 1) : 1;
  },

  _spookMob: function (m, hard) {
    if (m.kind !== 0) return;
    if (m.state !== 2) {
      this._puff(m.x, m.y, 3, 40);
      m.tagT = 1.2;
    }
    m.state = 2;
    m.stateT = this.FLEE_T * (0.6 + 0.4 * hard);
    m.ease = Math.max(0, m.ease - 0.55 * hard);
    // Trust survives a scare -- it is the SESSION that resets, not the courtship.
    m.trust = Math.max(0, m.trust - 1.5 * hard * m.spr.wary);
    this._bank(m);
  },

  // Steering with drag. sp.acc/2.12 is the terminal speed, so a species' `speed`
  // is the number it actually cruises at.
  _move: function (m, sp, dt) {
    var dx = m.tx - m.x, dy = m.ty - m.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var boost = 1;
    if (m.state === 2) boost = 1.9;
    else if (m.state === 4) boost = d > 140 ? 1.8 : (d > 60 ? 1.25 : 0.9);
    else if (m.state === 1) boost = 0.85;
    else if (m.state === 3) boost = 0;
    else boost = 0.55;                            // an unbothered animal ambles

    if (d > 1.5 && boost > 0) {
      var acc = sp.acc * boost;
      m.vx += (dx / d) * acc * dt;
      m.vy += (dy / d) * acc * dt * 0.85;         // less eager vertically
    }
    var drag = Math.pow(0.12, dt);
    m.vx *= drag;
    m.vy *= drag;

    var max = sp.speed * boost * 1.15 + 8;
    var sp2 = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    if (sp2 > max) { var k = max / sp2; m.vx *= k; m.vy *= k; }

    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.y < this.SURFACE_Y) { m.y = this.SURFACE_Y; if (m.vy < 0) m.vy *= -0.3; }
    if (m.y > this.FLOOR_Y) { m.y = this.FLOOR_Y; if (m.vy > 0) m.vy *= -0.3; }

    // Face travel, with hysteresis so a hovering animal does not flicker.
    if (m.vx > 10) m.dir = 1;
    else if (m.vx < -10) m.dir = -1;

    // Bank into the turn: the tilt is the climb/dive angle, eased so it lags the
    // velocity the way a real body does.
    var want = clamp(Math.atan2(m.vy, Math.max(24, Math.abs(m.vx))), -0.55, 0.55);
    m.bank = lerp(m.bank, want, Math.min(1, dt * 4));

    // A moving animal trails the occasional bubble; a bolting one trails several.
    if (m.state === 2 && m.rng && m.rng() < dt * 6) this._puff(m.x - m.dir * 6, m.y, 1, 26);

    // ---- the wake ------------------------------------------------------------
    // Both of these run off DISTANCE TRAVELLED, not elapsed time. That single
    // choice is what fixes the old "weird" swim: the tail-beat and the trail are
    // properties of moving, so an animal holding station goes still instead of
    // flapping and shedding bubbles while parked.
    var moved = Math.sqrt(m.vx * m.vx + m.vy * m.vy) * dt;
    m.swim += moved;
    m.wakeD += moved;
    if (m.wakeD >= this.WAKE_GAP && m.alpha > 0.15) {
      m.wakeD = 0;
      // dropped at the TAIL, which is behind the nose -- and the sheets face left,
      // so "behind" is +dir
      var bx = m.x - m.dir * (m.spr ? m.spr.box * 0.34 : 8);
      // spread across the tail's height, so the trail is a ribbon with some body
      // to it rather than a one-pixel line
      this._wakePt(bx, m.y + (m.rng ? (m.rng() - 0.5) * 6 : 0), sp2);
    }
  },

  // One point of wake. Size tracks speed so a bolting animal leaves a fatter trail
  // than an ambling one, which is most of what sells the difference between the two.
  _wakePt: function (x, y, speed) {
    var p = this.wake[this._wi];
    this._wi = (this._wi + 1) % this.WAKE_MAX;
    p.t = this.WAKE_LIFE;
    p.x = x;
    p.y = y;
    p.r = 1.5 + clamp(speed / 90, 0, 1) * 2.4;
    p.tone = (this._wi & 1);
  },

  _updateWake: function (dt) {
    for (var i = 0; i < this.WAKE_MAX; i++) {
      var p = this.wake[i];
      if (p.t <= 0) continue;
      p.t -= dt;
      p.y -= 5 * dt;                                // the disturbed water lifts a little
    }
  },

  // The whole ribbon in two fillStyle writes. Points shrink and fade together, so a
  // trail tapers toward its oldest end without any per-point colour work.
  _drawWake: function (ctx, camX, camY) {
    if (!this.wake) return;
    var x0 = camX - 20, x1 = camX + W + 20, y0 = camY - 20, y1 = camY + H + 20;
    var tone, i, p, k, r;
    for (tone = 0; tone < 2; tone++) {
      ctx.fillStyle = tone === 0 ? '#cfeeff' : '#9fd2ea';
      for (i = 0; i < this.WAKE_MAX; i++) {
        p = this.wake[i];
        if (p.t <= 0 || p.tone !== tone) continue;
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        k = p.t / this.WAKE_LIFE;                   // 1 at birth, 0 at death
        r = p.r * (0.35 + k * 0.65);
        // Falloff is k^1.5, not k^2. Squared looked right on paper but the trail
        // was gone within a third of its life, so on screen it read as a hairline
        // scratch behind the animal rather than a wake -- invisible at a glance,
        // which is the same as not having built it.
        ctx.globalAlpha = k * Math.sqrt(k) * 0.5;
        ctx.fillRect(p.x - r * 0.5, p.y - r * 0.5, r, r);
      }
    }
    ctx.globalAlpha = 1;
  },

  _pickOfferable: function (px, py) {
    var best = null, bd = (this.OFFER_R + 12) * (this.OFFER_R + 12);
    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live || m.state === 2) continue;
      var dx = px - m.x, dy = py - m.y, d = dx * dx + dy * dy;
      if (d < bd && this.canOffer(m)) { bd = d; best = m; }
    }
    this._offerable = best;
  },

  // The one keyboard verb this module claims in the water. Also honours a tap
  // directly on the animal, which is how touch reaches it if the pad is missing.
  _verbInput: function () {
    if (typeof Input === 'undefined' || !Input) return;
    if (typeof Game !== 'undefined' && (Game.helpOpen || Game.fadeDir !== 0)) return;
    if (this.open) return;
    // [T] is one verb with a preference order: hand food over if you are carrying
    // something it wants and it is willing, otherwise just pet it. That way the
    // key never does nothing when an animal is right in front of you, which is
    // what made taming feel gated on inventory.
    if (Input.p('KeyT')) {
      if (this._offerable && this._hasAnyFoodFor(this._offerable)) this.offerSelected(this._offerable);
      else this.pet(this.pettable());
      return;
    }
    if (!this._touch() || !Input.mouse || !Input.mouse.clicked) return;
    // touch only: a tap on the animal's body. Kept tight so it does not fight the
    // pointer verbs the ocean's other systems own.
    var m = this._offerable || this.pettable();
    if (!m) return;
    // World -> SCREEN, and the ocean zooms its world layers, so the offset from the
    // camera has to be scaled by the same factor the draw used. Without the zoom
    // term a tap lands short of the animal by more the further right it is.
    var z = (typeof Ocean !== 'undefined' && Ocean && Ocean.ZOOM) || 1;
    var sx = (m.x - this._camX) * z, sy = (m.y - this._camY) * z;
    var box = (m.adult ? m.spr.box : m.spr.baby) * 0.6 * z;
    if (Math.abs(Input.mouse.x - sx) < box && Math.abs(Input.mouse.y - sy) < box) {
      if (this._offerable === m && this._hasAnyFoodFor(m)) this.offerSelected(m);
      else this.pet(m);
    }
  },

  _touch: function () { return typeof TouchUI !== 'undefined' && TouchUI && TouchUI.enabled; },

  // ---- particles --------------------------------------------------------------
  _puff: function (x, y, n, speed) {
    for (var i = 0; i < n; i++) {
      var p = this.puffs[this._pi];
      this._pi = (this._pi + 1) % this.PUFF_MAX;     // ring: the oldest gives way
      p.t = 0.5 + rand(0.5);
      p.x = x + rand(-4, 4);
      p.y = y + rand(-4, 4);
      p.vx = rand(-speed, speed) * 0.4;
      p.vy = -speed * rand(0.3, 0.8);
      p.r = rand(0.7, 1.8);
      p.tone = rand() < 0.5 ? 0 : 1;
    }
  },

  _updatePuffs: function (dt) {
    for (var i = 0; i < this.PUFF_MAX; i++) {
      var p = this.puffs[i];
      if (p.t <= 0) continue;
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 26 * dt;                              // bubbles rise, and keep rising
      p.vx *= 0.96;
    }
  },

  _fly: function (x, y, txt, tone) {
    var f = this.flys[this._fi];
    this._fi = (this._fi + 1) % this.FLY_MAX;
    f.t = 1.5;
    f.x = x;
    f.y = y;
    f.txt = txt;
    f.tone = tone;
  },

  _updateFlys: function (dt) {
    for (var i = 0; i < this.FLY_MAX; i++) {
      var f = this.flys[i];
      if (f.t <= 0) continue;
      f.t -= dt;
      f.y -= 16 * dt;
    }
  },

  // ====================================================================== draw ===
  // WORLD SPACE. The caller has already applied translate(-camX, -camY) -- exactly
  // how js/integrate.js calls it from Ocean's back prop pass -- so everything is
  // drawn at its world coordinate and camX/camY are used ONLY for culling.
  draw: function (ctx, camX, camY) {
    if (!this.ensure()) return;
    camX = camX || 0;
    camY = camY || 0;
    this._camX = camX;
    this._camY = camY;
    var x0 = camX - 120, x1 = camX + W + 120, y0 = camY - 120, y1 = camY + H + 120;

    // The wake goes down before any animal, so every trail is behind every body
    // rather than only behind the ones drawn later in the pool.
    this._drawWake(ctx, camX, camY);

    for (var i = 0; i < this.MAX_MOBS; i++) {
      var m = this.mobs[i];
      if (!m.live) continue;
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      this._drawMob(ctx, m);
    }
    this._drawPuffs(ctx, camX, camY);
    this._drawTags(ctx, camX, camY);
    this._drawPetGame(ctx);
    this._drawFlys(ctx, camX, camY);
  },

  _drawMob: function (ctx, m) {
    var sp = m.spr;
    var frames = m.adult ? sp.frA : sp.frB;
    var fi = Math.floor(m.animT * sp.fps) % 4;
    if (fi < 0) fi = 0;
    var box = m.adult ? sp.box : sp.baby;

    // THE BOUNCE. This used to be a plain sine of wall-clock time at a fixed
    // amplitude, and that is what read as weird: an animal holding station bobbed
    // up and down on the spot like a float, and a bolting one bobbed by exactly the
    // same amount, so the motion never had anything to do with the swimming.
    //
    // Now the phase advances with DISTANCE SWUM, so the beat belongs to the body
    // moving through water, and the amplitude scales with speed on top of a small
    // idle float -- an animal at rest breathes, an animal at a sprint surges. The
    // 0.06 is per world unit, which puts a typical cruise near the old cadence.
    var spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    var drive = clamp(spd / (sp.speed || 60), 0, 1.4);
    var amp = sp.bobA * (0.22 + drive * 0.85);
    var bob = Math.sin(m.swim * 0.06 * sp.bob + this.time * 0.9 + m.ph) * amp;
    // and a touch of surge along the travel axis, so the beat pushes as well as
    // lifts. Quarter-phase behind the lift, which is what makes it read as a stroke.
    var surge = Math.cos(m.swim * 0.06 * sp.bob + this.time * 0.9 + m.ph) * amp * 0.35 * drive;

    // No trailing babies: a lone animal you can swim up to and pet is the whole
    // interaction now, and a shoal of half-size copies behind it read as clutter.
    this._blit(ctx, frames[fi], m.x - m.dir * surge, m.y + bob, box, m.dir, m.bank, m.alpha);
  },

  _blit: function (ctx, name, x, y, box, dir, bank, alpha) {
    var img = ASSETS[name];
    if (!img || !img.width) return;
    var wide = img.width >= img.height;
    var w = wide ? box : box * img.width / img.height;
    var h = wide ? box * img.height / img.width : box;
    ctx.save();
    ctx.translate(Math.round(x * DPX) / DPX, Math.round(y * DPX) / DPX);
    // THE SHEETS FACE LEFT. Every uploaded creature sheet is drawn nose-left, so
    // the unflipped sprite is the LEFT-facing one and it is dir > 0 that needs the
    // mirror. This was inverted, which is why every animal in the sea swam
    // backwards. Rotation is applied before the mirror, so the bank sign flips
    // with it to keep the nose tilting into the direction of travel.
    if (bank) ctx.rotate(dir > 0 ? -bank : bank);
    if (dir > 0) ctx.scale(-1, 1);
    if (alpha < 1) ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  },

  // The petting sweep, over the animal's head: dark track, a heart-red centre
  // zone, a bright needle. Opaque like the mining bar, for the same reason -- a
  // timing game you cannot read is a coin flip.
  _drawPetGame: function (ctx) {
    var g = this.petGame;
    if (!g || !g.m || !g.m.live) return;
    var m = g.m;
    var w = 46, h = 6;
    var x = m.x - w / 2, y = m.y - (m.spr ? m.spr.box * 0.5 : 14) - 16;
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = '#3d4a66';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e8637a';
    ctx.fillRect(x + w * 0.36, y, w * 0.28, h);
    ctx.fillStyle = '#ffd4dc';
    ctx.fillRect(x + w * 0.47, y, w * 0.06, h);
    var nx = x + g.sweep * w;
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(nx - 1.4, y - 2.5, 2.8, h + 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nx - 0.7, y - 2, 1.4, h + 4);
    drawHeart(ctx, x + w / 2 - 3.5, y - 10, 'full');
    text(ctx, '[E]', x + w + 5, y - 1, { size: 6, color: '#ffe6b0', shadow: false });
  },

  // Two fillStyle writes for the whole bubble field; alpha varies per particle.
  _drawPuffs: function (ctx, camX, camY) {
    var x0 = camX - 20, x1 = camX + W + 20, y0 = camY - 20, y1 = camY + H + 20;
    var tone, i, p;
    for (tone = 0; tone < 2; tone++) {
      ctx.fillStyle = tone === 0 ? '#dff4ff' : '#a8d8ee';
      for (i = 0; i < this.PUFF_MAX; i++) {
        p = this.puffs[i];
        if (p.t <= 0 || p.tone !== tone) continue;
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        ctx.globalAlpha = clamp(p.t, 0, 1) * 0.6;
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
    }
    ctx.globalAlpha = 1;
  },

  // Trust pips over an interested animal, and a scare mark over a bolting one.
  // Five quads per animal in two buckets -- drawHeart is 150 fillRects with a
  // colour string per cell and has no business inside a per-animal loop.
  _drawTags: function (ctx, camX, camY) {
    var x0 = camX - 40, x1 = camX + W + 40, y0 = camY - 40, y1 = camY + H + 40;
    var i, m, n, filled, px, py, j;
    // pass 1: the filled pips
    ctx.fillStyle = '#e08a1a';
    for (i = 0; i < this.MAX_MOBS; i++) {
      m = this.mobs[i];
      if (!m.live || m.kind !== 0 || m.state === 2) continue;
      if (m.ease < 0.18 && m.trust <= 0) continue;
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      n = Math.round(m.trust / this.TRUST_MAX * 5);
      py = m.y - (m.adult ? m.spr.box : m.spr.baby) * 0.5 - 8;
      px = m.x - 11;
      for (j = 0; j < n; j++) ctx.fillRect(px + j * 4.5, py, 3, 3);
    }
    // pass 2: the empty ones
    ctx.fillStyle = 'rgba(10,20,28,0.55)';
    for (i = 0; i < this.MAX_MOBS; i++) {
      m = this.mobs[i];
      if (!m.live || m.kind !== 0 || m.state === 2) continue;
      if (m.ease < 0.18 && m.trust <= 0) continue;
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      n = Math.round(m.trust / this.TRUST_MAX * 5);
      py = m.y - (m.adult ? m.spr.box : m.spr.baby) * 0.5 - 8;
      px = m.x - 11;
      for (j = n; j < 5; j++) ctx.fillRect(px + j * 4.5, py, 3, 3);
    }
    // the scare mark: two quads, no font switch
    ctx.fillStyle = '#ff5a4a';
    for (i = 0; i < this.MAX_MOBS; i++) {
      m = this.mobs[i];
      if (!m.live || m.tagT <= 0) continue;
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      ctx.globalAlpha = clamp(m.tagT, 0, 1);
      py = m.y - (m.adult ? m.spr.box : m.spr.baby) * 0.5 - 12;
      ctx.fillRect(m.x - 1, py, 2, 6);
      ctx.fillRect(m.x - 1, py + 7.5, 2, 2);
    }
    ctx.globalAlpha = 1;

    // The prompt over whatever is in reach. Petting needs nothing, so the fallback
    // target is the merely-close animal, not only the one that would eat.
    var o = this._offerable || this.pettable();
    if (o && o.live && !this.open) {
      var oy = o.y - (o.adult ? o.spr.box : o.spr.baby) * 0.5 - 22;
      var canFeed = this._offerable === o && this._hasAnyFoodFor(o);
      var label = this._touch()
        ? (canFeed ? 'tap to offer food' : 'tap to pet')
        : (canFeed ? '[T] offer food' : '[E] pet');
      var tw = textWidth(ctx, label, 7) + 10;
      uiNote(ctx, o.x - tw / 2, oy - 2, tw, 12, {});
      text(ctx, label, o.x, oy + 1, { size: 7, color: '#30150a', align: 'center', shadow: false });
    }
  },

  _drawFlys: function (ctx, camX, camY) {
    var x0 = camX - 60, x1 = camX + W + 60, y0 = camY - 20, y1 = camY + H + 20;
    for (var i = 0; i < this.FLY_MAX; i++) {
      var f = this.flys[i];
      if (f.t <= 0) continue;
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      ctx.globalAlpha = clamp(f.t / 1.5, 0, 1);
      text(ctx, f.txt, f.x, f.y, { size: 7, color: f.tone === 0 ? '#a0f2b4' : '#e08a1a', align: 'center' });
      ctx.globalAlpha = 1;
    }
  },

  // ---- the tide pool on the dock ----------------------------------------------
  // WORLD SPACE, like Stock.draw and Craft.drawDock: call it inside the dock's
  // translate(-camX, 0). Companions left at home paddle in the water under the
  // planks, below DECK_Y, where the pen nets already live.
  drawDock: function (ctx, camX) {
    if (!this.ensure()) return;
    var pets = G.tame.pets;
    if (!pets.length) return;
    var cx = this.SITE.x;
    if (cx + 60 < camX - 20 || cx - 60 > camX + W + 20) return;
    if (typeof G.bridge === 'number' && G.bridge < this.SITE.b) return;
    var deck = (typeof DECK_Y !== 'undefined' ? DECK_Y : 214);
    var top = deck + 6;

    // the pool itself: three flat bands, no gradient
    ctx.fillStyle = 'rgba(24,70,96,0.55)';
    ctx.fillRect(cx - 34, top, 68, 30);
    ctx.fillStyle = 'rgba(44,116,146,0.4)';
    ctx.fillRect(cx - 34, top, 68, 8);
    ctx.fillStyle = 'rgba(201,162,113,0.9)';
    ctx.fillRect(cx - 36, top - 2, 72, 2);

    var shown = 0, i;
    for (i = 0; i < pets.length && shown < 4; i++) {
      var p = pets[i];
      if (p.out) continue;                       // that one is in the water with you
      var sp = this.speciesOf(p);
      if (!sp) continue;
      var ph = i * 1.7;
      var t = this.time * 0.5 + ph;
      var x = cx + Math.sin(t) * 22;
      var y = top + 14 + Math.cos(t * 1.3) * 5 + (shown % 2) * 3;
      var dir = Math.cos(t) >= 0 ? 1 : -1;
      var box = Math.min(26, (p.adult ? sp.box : sp.baby) * 0.45);
      var frames = p.adult ? sp.frA : sp.frB;
      var fi = Math.floor(this.time * 3 + i) % 4;
      this._blit(ctx, frames[fi], x, y, box, dir, 0, 1);
      // a pip when there is something to collect
      if (this.ready(p)) {
        ctx.fillStyle = '#e08a1a';
        ctx.fillRect(x - 1, y - box * 0.5 - 6, 2, 4);
      }
      shown++;
    }
  },

  // ==================================================================== spots ===
  // Merged into WorldScene.spots() by the wrap in install(). One spot: the roster
  // is per-animal and the deck has nowhere near enough room for four verbs each.
  spots: function () {
    if (!this.ensure()) return this._noSpots;
    if (typeof G.bridge === 'number' && G.bridge < this.SITE.b) return this._noSpots;
    this._spot.x = this.SITE.x;
    this._spot.label = this._siteLabel();
    return this._spots;
  },

  // spots() runs up to three times a frame, so the string is rebuilt only when
  // what it says actually changes.
  _siteLabel: function () {
    var n = G.tame.pets.length, r = this.readyCount(), h = this.hungryCount();
    var key = n + '/' + r + '/' + h;
    if (key === this._labelKey) return this._label;
    this._labelKey = key;
    if (!n) this._label = 'Tide Pool  (no companions yet)';
    else if (r) this._label = 'Tide Pool  (' + r + ' to harvest)';
    else if (h) this._label = 'Tide Pool  (' + h + ' to feed)';
    else this._label = 'Tide Pool  (' + n + ' settled)';
    return this._label;
  },

  // A one-line next step, the shape NPCs.hint() publishes, for help text or goals.
  hint: function () {
    if (!this.ensure()) return 'wild things live out past the pilings. swim slowly.';
    var pets = G.tame.pets;
    if (!pets.length) return 'swim out into the open ocean and drift near something wild.';
    var i, p;
    for (i = 0; i < pets.length; i++) if (this.ready(pets[i])) return pets[i].name + ' has produce waiting at the tide pool.';
    for (i = 0; i < pets.length; i++) if (pets[i].fedDay !== G.day) return pets[i].name + ' has not been fed today.';
    for (i = 0; i < pets.length; i++) {
      p = pets[i];
      if (!p.favour && this.bondLeft(p) > 0)
        return 'feed ' + p.name + ' for ' + this.bondLeft(p) + ' more day' + (this.bondLeft(p) > 1 ? 's' : '') + ' without harvesting for a favour.';
    }
    return 'the pool is content. there are rarer things further down.';
  },

  // ============================================================= the roster UI ==
  openUI: function () {
    if (!this.ensure()) return;
    // Every peer is checked by hand -- there is no modal manager in this codebase.
    if (typeof Shop !== 'undefined' && Shop.open) return;
    if (typeof Bench !== 'undefined' && Bench.open) return;
    if (typeof Game !== 'undefined' && Game.helpOpen) return;
    if (typeof Craft !== 'undefined' && Craft.open) return;
    if (typeof NPCs !== 'undefined' && NPCs.open) return;
    if (typeof Stock !== 'undefined' && Stock.open) return;
    if (typeof Inv !== 'undefined' && Inv.open) return;
    if (typeof Skills !== 'undefined' && Skills.open) return;
    if (typeof Battle !== 'undefined' && Battle.active) return;
    this.open = true;
    this._openT = 0;
    this.sel = clamp(this.sel, 0, Math.max(0, G.tame.pets.length - 1));
    this._clampScroll();
    this._relIdx = -1;
    this._relT = 0;
    this._note = '';
    this._noteT = 0;
    this._snd('blip');
  },

  close: function () {
    if (!this.open) return;
    this.open = false;
    this._relIdx = -1;
    this._relT = 0;
    this._snd('click');
  },

  _say: function (m) { this._note = m; this._noteT = 4.5; },

  _clampScroll: function () {
    var n = (G && G.tame && G.tame.pets) ? G.tame.pets.length : 0;
    var max = Math.max(0, n - this.VIS);
    if (this.scroll > max) this.scroll = max;
    if (this.scroll < 0) this.scroll = 0;
  },

  // ---- geometry: update() and draw() share these, so a hit box can never drift
  _in: function (r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },
  _closeRect: function () { return { x: this.WX + this.WW - 26, y: this.WY + 3, w: 22, h: 18 }; },
  _rowRect: function (i) {
    return { x: this.WX + 8, y: this.ROW_Y + i * this.ROW_H, w: this.WW - 16, h: this.ROW_H - 2 };
  },
  // 2x2 grid on the right of a row: feed / harvest over take / free
  _btnRect: function (i, b) {
    var r = this._rowRect(i);
    var gw = this.BW * 2 + this.BGAP;
    var bx = r.x + r.w - 6 - gw;
    return {
      x: bx + (b % 2) * (this.BW + this.BGAP),
      y: r.y + 3 + ((b >> 1) * (this.BH + this.BGAP)),
      w: this.BW, h: this.BH,
    };
  },
  _arrowRect: function (d) {
    return { x: this.WX + this.WW - 18, y: d < 0 ? this.ROW_Y : this.ROW_Y + this.VIS * this.ROW_H - 14, w: 14, h: 14 };
  },

  // ---- update -----------------------------------------------------------------
  // Driven from the Game.globalUpdate wrapper, which is the only slot that runs
  // every frame while a scene is live. Also carries the [T] hotkey and the
  // nightly catch-up, so neither depends on the wiring layer.
  uiUpdate: function (dt) {
    if (!this.ensure()) return;
    if (typeof Game !== 'undefined') {
      if (Game.time === this._uiStamp) return;
      this._uiStamp = Game.time;
    }
    if (G.tame.lastDay < G.day) this.newDay();
    if (this._relT > 0) { this._relT -= dt; if (this._relT <= 0) this._relIdx = -1; }
    if (!this.open && this._noteT > 0) this._noteT -= dt;

    if (typeof Input === 'undefined' || !Input) return;

    if (!this.open) {
      // The dock hotkey. Only where the roster makes sense -- in the water [T] is
      // the offer verb (see _verbInput) and the scene consumes it first anyway.
      if (typeof Game === 'undefined' || Game.fadeDir !== 0 || Game.helpOpen) return;
      if (typeof Shop !== 'undefined' && Shop.open) return;
      if (typeof Bench !== 'undefined' && Bench.open) return;
      var sc = Game.scene;
      var onDeck = (typeof WorldScene !== 'undefined' && sc === WorldScene) ||
        (typeof HouseScene !== 'undefined' && sc === HouseScene);
      if (onDeck && Input.p('KeyT')) this.openUI();
      return;
    }

    // Open: eat the verbs the scene underneath would otherwise act on, exactly as
    // Craft does, so the deck spot cannot re-fire under the panel.
    Input.p('KeyE');
    Input.p('Space');
    if (Input.p('Escape') || Input.p('KeyT')) { this.close(); return; }

    var pets = G.tame.pets;
    if (Input.p('ArrowDown')) this._move(0);       // placeholder; replaced below
    if (Input.p('ArrowUp')) this._move(0);
    if (Input.wheelDelta) { this.scroll += Input.wheelDelta; this._clampScroll(); }

    if (Input.mouse && Input.mouse.clicked) this.click(Input.mouse.x, Input.mouse.y);
    if (pets.length === 0) this.sel = 0;
  },

  _nudge: function (d) {
    var n = G.tame.pets.length;
    if (!n) return;
    this.sel = clamp(this.sel + d, 0, n - 1);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel > this.scroll + this.VIS - 1) this.scroll = this.sel - this.VIS + 1;
    this._clampScroll();
    this._snd('blip');
  },

  // One click router, most specific first, with a return after every hit so a
  // single click can never fire two actions.
  click: function (mx, my) {
    if (!this.ensure() || !this.open) return;
    if (this._in(this._closeRect(), mx, my)) { this.close(); return; }
    // outside the window closes, the way Craft and Farm's picker do
    if (mx < this.WX || mx > this.WX + this.WW || my < this.WY || my > this.WY + this.WH) {
      this.close();
      return;
    }
    if (this._in(this._arrowRect(-1), mx, my)) { this.scroll--; this._clampScroll(); this._snd('blip'); return; }
    if (this._in(this._arrowRect(1), mx, my)) { this.scroll++; this._clampScroll(); this._snd('blip'); return; }

    var pets = G.tame.pets;
    for (var v = 0; v < this.VIS; v++) {
      var i = this.scroll + v;
      if (i >= pets.length) break;
      var r = this._rowRect(v);
      if (my < r.y || my > r.y + r.h) continue;
      for (var b = 0; b < 4; b++) {
        if (!this._in(this._btnRect(v, b), mx, my)) continue;
        this.sel = i;
        this._act(i, b);
        return;
      }
      this.sel = i;
      this._relIdx = -1;
      this._snd('blip');
      var p = pets[i], sp = this.speciesOf(p);
      if (sp) this._say(p.name + ': ' + sp.blurb);
      return;
    }
  },

  _act: function (i, b) {
    var pets = G.tame.pets;
    var p = pets[i];
    if (!p) return;
    if (b !== 3) { this._relIdx = -1; this._relT = 0; }
    if (b === 0) { this.feed(i); return; }
    if (b === 1) { this.harvest(i); return; }
    if (b === 2) { this.toggleOut(i); return; }
    // free: two presses, because there is no undo
    if (this._relIdx === i && this._relT > 0) { this.release(i); this._relIdx = -1; this._relT = 0; return; }
    this._relIdx = i;
    this._relT = this.REL_T;
    this._snd('warn');
    this._say('press free again to let ' + p.name + ' go.');
  },

  // ---- draw -------------------------------------------------------------------
  drawUI: function (c) {
    if (!this.ensure()) return;
    var WX = this.WX, WY = this.WY, WW = this.WW, WH = this.WH;

    // one flat dim, never a gradient
    c.fillStyle = 'rgba(6,12,18,0.5)';
    c.fillRect(0, 0, W, H);
    c.save();
    uiPageOpen(c, clamp(this._openT, 0, 1), WX + WW / 2, WY + WH / 2);
    uiPage(c, WX, WY, WW, WH, 1);

    text(c, 'THE TIDE POOL', WX + 34, WY + 12, { size: 12, color: '#662907', shadow: false });
    var pets = G.tame.pets;
    var favs = this.favours();
    var sub = pets.length + '/' + this.MAX_PETS + ' companions';
    if (this.outCount()) sub += '   ' + this.outCount() + ' swimming with you';
    if (favs.length) {
      var names = '';
      for (var q = 0; q < favs.length; q++) names += (q ? ', ' : '') + this.FAVOURS[favs[q]].name;
      sub += '   favours: ' + names;
    }
    text(c, sub, WX + 34, WY + 26, { size: 7, color: '#914007', shadow: false });

    var cr = this._closeRect();
    inkClose(c, cr, this._in && this._in(cr, Input.mouse.x, Input.mouse.y));

    if (!pets.length) {
      text(c, 'nothing lives here yet.', WX + 20, this.ROW_Y + 14, { size: 8, color: '#d8ccb4' });
      text(c, 'swim out into the open ocean and drift -- slowly -- near something wild.',
        WX + 20, this.ROW_Y + 28, { size: 7, color: '#8a9484' });
      text(c, 'offer it food it likes, a couple of times a day, for a few days running.',
        WX + 20, this.ROW_Y + 40, { size: 7, color: '#8a9484' });
      text(c, 'then choose: harvest what it makes, or feed it and never harvest at all.',
        WX + 20, this.ROW_Y + 52, { size: 7, color: '#8a9484' });
      text(c, 'the second road is longer. the favours are worth it.',
        WX + 20, this.ROW_Y + 64, { size: 7, color: '#914007' });
    }

    for (var v = 0; v < this.VIS; v++) {
      var i = this.scroll + v;
      if (i >= pets.length) break;
      this._drawRow(c, v, i, pets[i]);
    }

    // scroll arrows (touch has no wheel)
    if (pets.length > this.VIS) {
      var up = this._arrowRect(-1), dn = this._arrowRect(1);
      this._arrow(c, up, -1, this.scroll > 0);
      this._arrow(c, dn, 1, this.scroll < pets.length - this.VIS);
    }

    if (this._noteT > 0 && this._note)
      text(c, this._note, WX + 34, WY + WH - 30, { size: 7, color: '#662907', shadow: false });
    text(c, this._touch() ? 'tap x to close' : '[Esc] or [T] close',
      WX + WW - 34, WY + WH - 16, { size: 7, color: '#914007', align: 'right', shadow: false });
    c.restore();
  },

  _arrow: function (c, r, d, on) {
    c.fillStyle = on ? '#ffe6b0' : 'rgba(216,204,180,0.25)';
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    c.beginPath();
    if (d < 0) { c.moveTo(cx, cy - 4); c.lineTo(cx + 4.5, cy + 3); c.lineTo(cx - 4.5, cy + 3); }
    else { c.moveTo(cx, cy + 4); c.lineTo(cx + 4.5, cy - 3); c.lineTo(cx - 4.5, cy - 3); }
    c.closePath();
    c.fill();
  },

  _drawRow: function (c, v, i, p) {
    var r = this._rowRect(v);
    var sp = this.speciesOf(p);
    if (!sp) return;
    var selected = (i === this.sel);
    rrect(c, r.x, r.y, r.w, r.h, selected ? 'rgba(90,210,240,0.12)' : 'rgba(255,235,190,0.05)',
      selected ? 'rgba(90,210,240,0.5)' : 'rgba(226,200,150,0.18)');

    // portrait
    var frames = p.adult ? sp.frA : sp.frB;
    this._icon(c, frames[0], r.x + 17, r.y + r.h / 2, 26);

    var tx = r.x + 34;
    var nm = p.name;
    text(c, nm, tx, r.y + 3, { size: 8, color: '#ffe6b0' });
    var tag = sp.name + (p.adult ? '' : ' (young)');
    text(c, tag, tx + textWidth(c, nm, 8) + 6, r.y + 4, { size: 7, color: '#8a9484' });

    // line 2: where this animal stands
    var st, col = '#d8ccb4';
    if (p.favour) {
      st = 'friend -- ' + this.FAVOURS[sp.favour].name;
      col = '#a0f2b4';
    } else if (!p.adult) {
      st = 'growing: ' + Math.max(1, sp.grow - p.age) + ' day' + (sp.grow - p.age > 1 ? 's' : '') + ' to go';
    } else if (p.cd > 0) {
      st = sp.prod.name + ' in ' + Math.ceil(p.cd) + ' day' + (p.cd > 1 ? 's' : '');
    } else {
      st = sp.prod.name + ' ready';
      col = '#e08a1a';
    }
    if (!p.favour) {
      var left = this.bondLeft(p);
      st += left > 0 ? '   bond ' + p.bond + '/' + sp.bond : '   bond ready -- feed it';
    }
    text(c, st, tx, r.y + 14, { size: 7, color: col });

    // line 3: mood, and whether it has eaten
    var moodCol = p.mood > 0.75 ? '#a0f2b4' : (p.mood > 0.4 ? '#e08a1a' : '#e8434c');
    rrect(c, tx, r.y + 25, 70, 4, '#2a1f14', 'rgba(226,200,150,0.25)');
    c.fillStyle = moodCol;
    c.fillRect(tx + 0.5, r.y + 25.5, 69 * clamp(p.mood, 0, 1), 3);
    text(c, p.fedDay === G.day ? 'fed today' : 'hungry', tx + 76, r.y + 23,
      { size: 7, color: p.fedDay === G.day ? '#8a9484' : '#e08a1a' });
    if (p.out) text(c, 'swimming with you', tx + 132, r.y + 23, { size: 7, color: '#5ad2f0' });

    // buttons
    var canFeed = this.foodHeld(p.sp).length > 0;
    this._btn(c, v, 0, 'feed', canFeed);
    this._btn(c, v, 1, 'harvest', this.ready(p));
    this._btn(c, v, 2, p.out ? 'leave' : 'take', true);
    this._btn(c, v, 3, this._relIdx === i && this._relT > 0 ? 'sure?' : 'free', true);
  },

  _btn: function (c, v, b, label, on) {
    var r = this._btnRect(v, b);
    rrect(c, r.x, r.y, r.w, r.h, on ? 'rgba(122,74,48,0.55)' : 'rgba(60,50,40,0.4)',
      on ? 'rgba(255,235,190,0.45)' : 'rgba(255,235,190,0.15)');
    text(c, label, r.x + r.w / 2, r.y + 3, {
      size: 7, color: on ? '#ffe6b0' : 'rgba(216,204,180,0.35)', align: 'center',
    });
  },

  _icon: function (c, name, cx, cy, box) {
    var img = ASSETS[name];
    if (!img || !img.width) {
      // Missing art is silent everywhere else in this codebase; a flat chip keeps
      // the row readable instead of leaving a hole.
      rrect(c, cx - box / 2, cy - box / 2, box, box, 'rgba(90,210,240,0.15)', 'rgba(90,210,240,0.35)');
      return;
    }
    var wide = img.width >= img.height;
    var w = wide ? box : box * img.width / img.height;
    var h = wide ? box * img.height / img.width : box;
    c.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  },

  _cursor: function (c) {
    if (typeof Input === 'undefined') return;
    var m = Input.mouse;
    c.save();
    c.translate(Math.round(m.x), Math.round(m.y));
    c.fillStyle = '#101820';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
    c.fillStyle = '#f2f4f6';
    c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
    c.restore();
  },

  // =================================================================== install ==
  // The five wraps every third-party panel in this codebase needs, plus the two
  // scene freezes and the spots merge. Every one of them is load-order guarded.
  install: function () {
    if (this._installed) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;
    var self = this;

    // 1. the only slot that runs every frame while a scene is live
    var gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      if (Game.fadeDir !== 0) return;
      if (self.open && (Game.helpOpen ||
        (typeof Shop !== 'undefined' && Shop.open) ||
        (typeof Bench !== 'undefined' && Bench.open))) return;
      self.uiUpdate(dt);
    };

    // 2. Shop's exact z-order: after the colour grade, under the toasts and help
    var gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.drawUI(c); return; }
      gHUD(c);
    };

    // 3. a scene change must dismiss us (Shop and Bench get this from updateFade)
    var gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };

    // 4. Game.drawCursor hides the arrow after 3s idle, so draw our own
    var gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (self.open && !(TouchUI && TouchUI.enabled)) { self._cursor(c); return; }
      gCursor(c);
    };

    // 5. otherwise the walk pads stay live under the panel and steal the taps.
    //    In the ocean we also add the offer pad, since Ocean's own layout replaces
    //    the list wholesale for its scene.
    var tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (self.open) return [];
      var b = tLayout();
      if (typeof Ocean !== 'undefined' && Game.scene === Ocean && self._offerable && b.length)
        b.push({ x: W - 46, y: H - 144, w: 40, h: 40, tap: 'KeyT', icon: 'tfeed' });
      return b;
    };

    // TouchUI.draw only knows six icon names and draws an empty circle for
    // anything else, so label the offer pad ourselves.
    var tDraw = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tDraw(c);
      if (!this.enabled) return;
      for (var i = 0; i < this.buttons.length; i++) {
        var b = this.buttons[i];
        if (b.icon !== 'tfeed') continue;
        var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        // a morsel in an open paw
        c.fillStyle = 'rgba(255,235,190,0.9)';
        c.beginPath(); c.arc(cx, cy - 3, 3, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(255,235,190,0.85)';
        c.lineWidth = 1.4;
        c.beginPath(); c.arc(cx, cy + 3, 6, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      }
    };

    // 6. the scene under a borrowed-slot modal keeps updating, so Otto would walk
    //    (and re-trigger the spot) behind the panel
    if (typeof WorldScene !== 'undefined') {
      var wu = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (self.open) return; wu(dt); };
      var ws = WorldScene.spots.bind(WorldScene);
      WorldScene.spots = function () { return ws().concat(self.spots()); };
    }
    if (typeof HouseScene !== 'undefined') {
      var hu = HouseScene.update.bind(HouseScene);
      HouseScene.update = function (dt) { if (self.open) return; hu(dt); };
    }
  },
};

// Load-order-agnostic install: Game and TouchUI are const in js/main.js, so if
// this file is pulled in ahead of it the wraps have to wait for the document.
// Registering after Ocean's listener also puts our TouchUI.layout wrap OUTSIDE
// its scene-specific one, which is what lets the offer pad reach the ocean.
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Tame.install();
else document.addEventListener('DOMContentLoaded', function () { Tame.install(); }, { once: true });
