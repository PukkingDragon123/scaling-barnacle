// ---- levels, skills and skill trees -------------------------------------------
//
// Five professions -- clamming, mining, fighting, farming, taming -- each with its
// own XP track, its own level, its own pool of unspent points and its own tree of
// eight nodes across four tiers.
//
// The whole point of this file is ONE cheap, total read: Skills.buff(name). Every
// other system multiplies (or adds) blindly and never has to know whether the
// player owns anything:
//
//     const v = base * Skills.buff('shellValue');            // 1 when unowned
//     if (Math.random() < Skills.buff('doubleOre')) { ... }   // 0 when unowned
//
// That is why the buff values live in a flat preallocated object rebuilt only when
// the owned set actually changes -- buff() is one hasOwnProperty and one property
// read, no allocation, no loops. A name nobody registered returns 1, the
// multiplicative identity, so a typo degrades to "no effect" rather than NaN.
//
// XP comes in through Skills.gain(skill, xp). `skill` is matched loosely: mining
// reports 'foraging' and 'salvage' for driftwood and wrecks, and those fold into
// clamming and mining respectively (see ALIAS), so a producer never has to know
// the profession list.
//
// Points are PER PROFESSION. XP you earn cracking shells buys clamming nodes and
// nothing else -- that is what makes a "clamming run" a real decision. There are
// no refunds and no respec: a spent point is gone. Every tree costs exactly 10
// points for all eight nodes, so a tree finishes at profession level 11.
//
// Persisted as G.skills = { hearts, <prof>: { lv, xp, pts, nodes } }. `skills` is
// NOT one of the five deep-merged keys on G, so ensure() re-normalises the entire
// subtree whenever the object identity changes (i.e. after a load) and prunes any
// node whose prerequisites are not also owned -- a hand-edited save must not be
// able to hand out a keystone or poison draw.
'use strict';

const Skills = {
  // ------------------------------------------------------------------ config ----
  MAX_LV: 20,
  PROFS: ['clamming', 'mining', 'fighting', 'farming', 'taming'],
  TABS: ['CLAM', 'MINE', 'FIGHT', 'FARM', 'TAME'],
  // one accent per profession, used for the tab underline and the XP bar
  ACC: ['#5ad2f0', '#c9d4dc', '#e8434c', '#a0f2b4', '#e08a1a'],
  BLURB: [
    'shells, pearls and the long breath it takes to reach them.',
    'rock, timber and every seam of ore under the pilings.',
    'powder, timing and standing your ground on the planks.',
    'beds, water and getting two crops where one grew.',
    'patience with anything that has fins and an opinion.'
  ],

  // What producers may call a profession. Kept loose on purpose: mining tags its
  // nodes 'mining' / 'foraging' / 'salvage' and should not have to care.
  ALIAS: {
    clam: 'clamming', clams: 'clamming', shell: 'clamming', shells: 'clamming',
    dive: 'clamming', diving: 'clamming', foraging: 'clamming', forage: 'clamming',
    mine: 'mining', ore: 'mining', salvage: 'mining', digging: 'mining',
    fight: 'fighting', combat: 'fighting', battle: 'fighting', cannon: 'fighting',
    farm: 'farming', crop: 'farming', crops: 'farming', garden: 'farming',
    tame: 'taming', taming: 'taming', stock: 'taming', animals: 'taming',
    ranch: 'taming', beast: 'taming'
  },

  // Every buff name this file can ever produce, with its identity. 'mul' values
  // multiply together and start at 1; 'add' values sum and start at 0. Callers
  // treat the two differently, so the kind is part of the published contract.
  BUFF_DEF: {
    // clamming
    shellValue: 'mul', airMax: 'mul', airDrain: 'mul', pryWindow: 'mul',
    pearlLuck: 'mul', sharkCalm: 'mul', bagCap: 'add', doubleShell: 'add',
    vacRange: 'mul',
    // mining
    pickPower: 'mul', pickTier: 'add', oreValue: 'mul', revealRange: 'mul',
    swingSpeed: 'mul', smeltBonus: 'add', doubleOre: 'add',
    // fighting
    maxHearts: 'add', cannonDmg: 'mul', damageTaken: 'mul', reloadTime: 'mul',
    critMul: 'mul', iframe: 'mul', dashCharges: 'add', multishot: 'add',
    // farming
    plantSpeed: 'mul', growSpeed: 'mul', produceValue: 'mul', waterDays: 'add',
    seedSaveChance: 'add', doubleHarvest: 'add', cropRegrow: 'add',
    nightGrowth: 'add',
    // taming
    tameChance: 'mul', stockYield: 'mul', stockGrow: 'mul', happyGain: 'mul',
    happyPet: 'mul', hungerRate: 'mul', swimSpeed: 'mul', penCap: 'add'
  },

  // ------------------------------------------------------------------- trees ----
  // tier is the row (0..3). Ordering inside a tier is the drawing order, left to
  // right. `req` lists node keys that must already be owned. `abil` names an
  // unlocked verb so a system can ask Skills.can('vacuum') instead of memorising a
  // node key. `star` marks the one node per tree worth planning a run around.
  TREES: {
    clamming: [
      { key: 'c_eye', tier: 0, cost: 1, name: 'keen eye', art: 'g_mask', req: [],
        buff: { shellValue: 1.15 },
        desc: 'otto knows a good shell from a pretty one. every shell is worth 15% more.' },
      { key: 'c_lung', tier: 0, cost: 1, name: 'deep lungs', art: 'g_tank', req: [],
        buff: { airMax: 1.2 },
        desc: 'one fifth more air in the tank, on every dive, forever.' },

      { key: 'c_grip', tier: 1, cost: 1, name: 'sure grip', art: 'g_crowbar', req: ['c_eye'],
        buff: { pryWindow: 1.35 },
        desc: 'the prying window is a third wider. stubborn shells stop costing hearts.' },
      { key: 'c_sack', tier: 1, cost: 1, name: 'wide sack', art: 'g_netbag', req: ['c_lung'],
        buff: { bagCap: 6 },
        desc: 'six more slots in the bag before otto has to surface.' },

      { key: 'c_pearl', tier: 2, cost: 1, name: 'pearl diver', art: 'shell_pearl', req: ['c_eye', 'c_grip'],
        buff: { pearlLuck: 2 },
        desc: 'double the odds of a pearl in any shell worth opening.' },
      { key: 'c_calm', tier: 2, cost: 1, name: 'calm blood', art: 'g_fins', req: ['c_lung', 'c_sack'],
        buff: { airDrain: 0.82, sharkCalm: 0.75 },
        desc: 'air lasts 18% longer and sharks lose interest sooner. panic is expensive.' },

      { key: 'c_vac', tier: 3, cost: 2, name: 'current sense', art: 'shell_conch',
        req: ['c_calm'], abil: 'vacuum', buff: { vacRange: 1.8 },
        desc: 'otto reads the drift. loose pickings are pulled in from nearly twice as far.' },
      { key: 'c_tide', tier: 3, cost: 2, name: 'tidewalker', art: 'shell_abalone',
        req: ['c_pearl'], abil: 'tidewalk', star: true, buff: { doubleShell: 0.3, shellValue: 1.1 },
        desc: 'three shells in ten come up twinned, and the rest sell for another 10%. a full bag stops being a bag and starts being a payday.' }
    ],

    mining: [
      { key: 'm_arm', tier: 0, cost: 1, name: 'quarry arms', art: 'opick_2', req: [],
        buff: { pickPower: 1.25 },
        desc: 'a quarter more rock off every swing. fewer swings, more seams.' },
      { key: 'm_pack', tier: 0, cost: 1, name: 'ore pack', art: 'res_ore', req: [],
        buff: { oreValue: 1.15 },
        desc: 'otto hauls it out clean instead of chipped. stone and ore fetch 15% more.' },

      { key: 'm_hone', tier: 1, cost: 1, name: 'honed edge', art: 'tbl_anvil', req: ['m_arm'],
        buff: { pickTier: 1 },
        desc: 'otto keeps an edge no shop can sell. the pick bites one tier above its make.' },
      { key: 'm_mag', tier: 1, cost: 1, name: 'lodestone', art: 'node_iron', req: ['m_pack'],
        buff: { vacRange: 1.6 },
        desc: 'a chip of loadstone on the belt. drops come to otto from 60% further out.' },

      { key: 'm_seam', tier: 2, cost: 2, name: 'seam reader', art: 'g_torch', req: ['m_arm', 'm_hone'],
        buff: { revealRange: 1.7 }, abil: 'seamsight',
        desc: 'ore glows through the gloom at nearly double the distance. no more swimming past a wreck.' },
      { key: 'm_smelt', tier: 2, cost: 1, name: 'field smelter', art: 'tbl_forge', req: ['m_pack', 'm_mag'],
        buff: { smeltBonus: 1 }, abil: 'smelt',
        desc: 'otto cooks it down where it falls. every ingot or crystal node gives one extra.' },

      { key: 'm_tire', tier: 3, cost: 1, name: 'tireless', art: 'res_ingot', req: ['m_smelt'],
        buff: { swingSpeed: 1.3 },
        desc: 'the swing cycle runs 30% faster. it adds up over a long seam.' },
      { key: 'm_mother', tier: 3, cost: 2, name: 'motherlode', art: 'node_crystal',
        req: ['m_seam'], star: true, buff: { doubleOre: 0.3, pickPower: 1.1 },
        desc: 'three nodes in ten give up their whole haul twice. with a crystal pick and a deep run this is the difference between a pocketful and a shed full.' }
    ],

    fighting: [
      { key: 'f_heart', tier: 0, cost: 1, name: 'thick hide', art: 'g_suit', req: [],
        buff: { maxHearts: 1 },
        desc: 'one more heart, permanently. it is applied the moment you learn it.' },
      { key: 'f_pow', tier: 0, cost: 1, name: 'powder monkey', art: 'wpn_flint', req: [],
        buff: { cannonDmg: 1.2 },
        desc: 'otto packs the charge properly. every shot hits 20% harder.' },

      { key: 'f_guard', tier: 1, cost: 1, name: 'barnacle guard', art: 'g_helmet', req: ['f_heart'],
        buff: { damageTaken: 0.8 },
        desc: 'a fifth off everything that lands on otto, from a crab to a shark.' },
      { key: 'f_load', tier: 1, cost: 1, name: 'quick load', art: 'g_plier', req: ['f_pow'],
        buff: { reloadTime: 0.75 },
        desc: 'a quarter off the reload. the deck stops feeling so crowded.' },

      { key: 'f_dash', tier: 2, cost: 2, name: 'roll and dodge', art: 'oswim_5', req: ['f_heart', 'f_guard'],
        abil: 'dash2', buff: { dashCharges: 1, iframe: 1.15 },
        desc: 'a second dash charge, and a slightly longer breath of invulnerability after a hit. two dashes is a different game.' },
      { key: 'f_crit', tier: 2, cost: 1, name: 'sweet spot', art: 'wpn_cutlass', req: ['f_pow', 'f_load'],
        buff: { critMul: 1.25 },
        desc: 'a perfectly timed shot does a quarter more on top of its bonus.' },

      { key: 'f_iron', tier: 3, cost: 1, name: 'ironhide', art: 'g_belt', req: ['f_dash'],
        buff: { damageTaken: 0.88, iframe: 1.25 },
        desc: 'another 12% off incoming, and longer mercy frames. otto stops being fragile.' },
      { key: 'f_broad', tier: 3, cost: 2, name: 'broadside', art: 'wpn_cannon',
        req: ['f_crit'], abil: 'broadside', star: true, buff: { multishot: 2, cannonDmg: 1.1 },
        desc: 'a full charge throws three shots instead of one. a raid you were dreading becomes one good hold of the space bar.' }
    ],

    farming: [
      { key: 'a_hoe', tier: 0, cost: 1, name: 'steady hoe', art: 'ftool_0', req: [],
        buff: { plantSpeed: 1.4 },
        desc: 'tilling and planting go 40% quicker. mornings get shorter.' },
      { key: 'a_soil', tier: 0, cost: 1, name: 'rich soil', art: 'ftool_6', req: [],
        buff: { growSpeed: 1.15 },
        desc: 'otto works the beds properly. everything comes up 15% sooner.' },

      { key: 'a_seed', tier: 1, cost: 1, name: 'seed thrift', art: 'ftool_8', req: ['a_hoe'],
        buff: { seedSaveChance: 0.25 },
        desc: 'one planting in four costs no seed at all.' },
      { key: 'a_mulch', tier: 1, cost: 1, name: 'mulch', art: 'ftool_10', req: ['a_soil'],
        buff: { waterDays: -1 },
        desc: 'the beds hold their damp. every crop needs one less watering day.' },

      { key: 'a_price', tier: 2, cost: 1, name: 'market eye', art: 'ftool_9', req: ['a_hoe', 'a_seed'],
        buff: { produceValue: 1.2 },
        desc: 'otto grades and packs it himself. produce sells for a fifth more.' },
      { key: 'a_bloom', tier: 2, cost: 2, name: 'second bloom', art: 'crop_berry_p', req: ['a_soil', 'a_mulch'],
        abil: 'regrow', buff: { cropRegrow: 1 },
        desc: 'harvested plants come back once on their own. the bed keeps working while otto dives.' },

      { key: 'a_lantern', tier: 3, cost: 1, name: 'night lanterns', art: 'crop_moon_p', req: ['a_price'],
        abil: 'nightgrow', buff: { nightGrowth: 1, growSpeed: 1.05 },
        desc: 'lamps over the beds. the crops keep growing after dark.' },
      { key: 'a_bumper', tier: 3, cost: 2, name: 'bumper crop', art: 'crop_gourd_p',
        req: ['a_bloom'], star: true, buff: { doubleHarvest: 0.3, produceValue: 1.1 },
        desc: 'three harvests in ten come in double, and all of them sell 10% better. stacked with second bloom one bed feeds the whole dock.' }
    ],

    taming: [
      { key: 't_calm', tier: 0, cost: 1, name: 'gentle hands', art: 'ftool_11', req: [],
        buff: { tameChance: 1.25 },
        desc: 'a quarter better odds of a wild thing deciding otto is fine.' },
      { key: 't_feed', tier: 0, cost: 1, name: 'full trough', art: 'tame_melon_p', req: [],
        buff: { happyGain: 1.3 },
        desc: 'feeding is worth 30% more happiness. content animals give more.' },

      { key: 't_grow', tier: 1, cost: 1, name: 'quick growers', art: 'tame_pig_3', req: ['t_calm'],
        buff: { stockGrow: 0.8 },
        desc: 'a fifth off the days to adulthood. the pen turns over faster.' },
      { key: 't_yield', tier: 1, cost: 2, name: 'fine coats', art: 'tame_cow_p', req: ['t_feed'],
        buff: { stockYield: 1.25 },
        desc: 'every animal produces 25% more. the flat, honest one.' },

      { key: 't_bond', tier: 2, cost: 1, name: 'bonded', art: 'tame_clown_0', req: ['t_calm', 't_grow'],
        buff: { happyPet: 2 },
        desc: 'a scratch behind the fins counts double. otto is their favourite otter.' },
      { key: 't_pen', tier: 2, cost: 1, name: 'roomy pens', art: 'coral_11', req: ['t_feed', 't_yield'],
        buff: { penCap: 2 },
        desc: 'two more berths in every pen. nobody has to be sold to make room.' },

      { key: 't_herd', tier: 3, cost: 1, name: 'herd sense', art: 'tame_whale_3', req: ['t_pen'],
        buff: { hungerRate: 0.6 },
        desc: 'the herd looks after itself. hunger sets in 40% slower, so a long dive costs nothing.' },
      { key: 't_ride', tier: 3, cost: 2, name: 'sea-broke', art: 'tame_narwhal_3',
        req: ['t_bond'], abil: 'mount', star: true, buff: { swimSpeed: 1.25, stockYield: 1.1 },
        desc: 'a grown, happy animal will carry otto. open water gets 25% faster and the whole pen yields another 10%. the deep stops being a trek.' }
    ]
  },

  // -------------------------------------------------------------- geometry ----
  // update() and draw() share every rect through these, so a hit box can never
  // drift from the thing it is drawn under.
  WX: 16, WY: 12, WW: 448, WH: 246,
  _openT: 0,
  // THE HIVE'S CANVAS, and the whole reason the geometry below is written down
  // rather than guessed at. Four tiers radiating from a hub need
  //   2 * (4 * RING + HR)  of room, and the five spokes at 72 degrees make the
  // envelope 1.902r wide by 1.809r tall -- so HEIGHT is what binds, always. Get
  // HR wrong by four units and the outer cells land off the page, which is
  // exactly what "sprayed ghost hexagons over the paper" looks like.
  // THE HIVE'S CANVAS. These are ABSOLUTE screen coordinates, and they used to
  // be TX:22 -- which is left of this page's own punch holes (WX+11 = 27) and
  // its red margin (WX+22 = 38). The comb was being drawn over the binding and
  // clipped against the torn edge. Content on this page starts at WX+34, the
  // same as every other panel, and stops short of the info column.
  TX: 50, TY: 56, TW: 244, TH: 180,     // the hive's canvas
  IX: 302, IY: 42, IW: 154, IH: 190,    // the info column
  NS: 24,                               // node box, logical units
  ROW: 36,                              // tier spacing
  // Courier is monospace at 0.6em advance, so wrapping by character count is
  // exact and needs no measuring: (IW - 16 padding) / (6px * 0.6) = 38.
  COLS: 37,
  FX_MAX: 24,

  // ----------------------------------------------------------------- state ----
  open: false,
  tab: 0,
  sel: 0,                 // index into TREES[prof] for the current tab
  hover: '',              // node key under the pointer, '' for none
  time: 0,
  _note: '', _noteT: 0,
  _pan: null,
  _lvT: 0, _lvTab: -1,    // level-up flash, so the tab pulses when it happens
  _stamp: -1,             // double-call guard, keyed on Game.time
  _installed: false,
  _init: false,
  _cobj: null,            // the G.skills we last normalised, by reference
  _cache: null,           // buff name -> value. rebuilt only when ownership moves
  _buffKeys: null,        // the cache's key list, so a rebuild never allocates
  _ident: null,           // the same names at their identities, for the pre-save read
  _own: null,             // node key -> bool
  _flat: null,            // every node, flat, for cheap whole-tree walks
  _byKey: null,
  _abil: null,            // ability name -> node key
  _tiers: null,           // prof -> [[node,...] per tier]
  _wrapC: null,           // wrapped tooltip lines, cached by (cols, string)
  _fx: null,

  // ------------------------------------------------------------------ boot ----
  // Pure derivation from the tables above, so it is safe long before G exists.
  _boot: function () {
    if (this._init) return;
    this._init = true;

    var flat = [], byKey = {}, abil = {}, tiers = {}, p, list, i, nd, t;

    for (p = 0; p < this.PROFS.length; p++) {
      var prof = this.PROFS[p];
      list = this.TREES[prof];
      tiers[prof] = [[], [], [], []];
      for (i = 0; i < list.length; i++) {
        nd = list[i];
        nd.prof = prof;
        nd.profIdx = p;
        t = nd.tier < 0 ? 0 : (nd.tier > 3 ? 3 : nd.tier);
        nd.tier = t;
        nd.prof = prof;                   // the hive draws all five at once
        nd.col = tiers[prof][t].length;   // position inside the row
        tiers[prof][t].push(nd);
        flat.push(nd);
        byKey[nd.key] = nd;
        if (nd.abil) abil[nd.abil] = nd.key;
      }
      // row width is needed by _nodeRect, and only known once the row is full
      for (t = 0; t < 4; t++)
        for (i = 0; i < tiers[prof][t].length; i++) tiers[prof][t][i].wide = tiers[prof][t].length;
    }

    this._flat = flat;
    this._byKey = byKey;
    this._abil = abil;
    this._tiers = tiers;
    this._wrapC = {};

    // The buff cache holds EVERY registered name from the start, so buff() is a
    // single property read and a rebuild never allocates.
    var cache = {};
    var keys = [];
    for (var name in this.BUFF_DEF) {
      if (!Object.prototype.hasOwnProperty.call(this.BUFF_DEF, name)) continue;
      cache[name] = this.BUFF_DEF[name] === 'mul' ? 1 : 0;
      keys.push(name);
    }
    this._cache = cache;
    this._buffKeys = keys;
    // the same table frozen at its identities, so buff() has something to answer
    // with before a save exists without branching on the kind
    var ident = {};
    for (i = 0; i < keys.length; i++) ident[keys[i]] = cache[keys[i]];
    this._ident = ident;

    var own = {};
    for (i = 0; i < flat.length; i++) own[flat[i].key] = false;
    this._own = own;

    // fixed-size sparkle pool; t <= 0 means free. Purely cosmetic, drawn inside
    // the panel when a node is learned.
    var fx = [];
    for (i = 0; i < this.FX_MAX; i++) fx.push({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, c: 0 });
    this._fx = fx;
  },

  // ----------------------------------------------------------------- save -----
  // G.skills is not deep-merged, so the whole subtree is re-normalised whenever
  // its object identity changes -- which is exactly once per load. The fast path
  // is a single reference compare, because buff() sits behind this.
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    if (!this._init) this._boot();

    var s = G.skills;
    if (s && typeof s === 'object' && s === this._cobj) return true;

    if (!s || typeof s !== 'object') s = G.skills = {};

    var p, prof, r, i, nd;

    var granted = Math.floor(s.hearts);
    s.hearts = isFinite(granted) ? (granted < 0 ? 0 : (granted > 6 ? 6 : granted)) : 0;

    for (p = 0; p < this.PROFS.length; p++) {
      prof = this.PROFS[p];
      r = s[prof];
      if (!r || typeof r !== 'object') r = s[prof] = {};

      var lv = Math.floor(r.lv);
      if (!isFinite(lv) || lv < 1) lv = 1;
      if (lv > this.MAX_LV) lv = this.MAX_LV;
      r.lv = lv;

      var xp = Math.floor(r.xp);
      if (!isFinite(xp) || xp < 0) xp = 0;
      r.xp = xp;

      var pts = Math.floor(r.pts);
      if (!isFinite(pts) || pts < 0) pts = 0;
      if (pts > 400) pts = 400;
      r.pts = pts;

      // Rebuild `nodes` from scratch so an unknown key from a hand-edited save
      // cannot survive, and never walk the prototype chain to read it.
      var src = (r.nodes && typeof r.nodes === 'object') ? r.nodes : {};
      var clean = {};
      var list = this.TREES[prof];
      for (i = 0; i < list.length; i++) {
        nd = list[i];
        if (Object.prototype.hasOwnProperty.call(src, nd.key) && src[nd.key]) clean[nd.key] = true;
      }
      // Prune anything whose prerequisites are not owned. Iterate until stable:
      // dropping a tier-1 node has to drop the tier-2 node that stood on it.
      var guard = 0, changed = true;
      while (changed && guard++ < 8) {
        changed = false;
        for (i = 0; i < list.length; i++) {
          nd = list[i];
          if (!clean[nd.key]) continue;
          for (var q = 0; q < nd.req.length; q++) {
            if (!clean[nd.req[q]]) { delete clean[nd.key]; changed = true; break; }
          }
        }
      }
      r.nodes = clean;

      this._absorb(r);   // an edited xp figure above the threshold still levels
    }

    this._cobj = s;
    this._recache();
    this._applyHearts();
    return true;
  },

  // xp needed to go from `lv` to `lv + 1`. Roughly 50 * lv^1.5: 50, 141, 260,
  // 400, 559 ... 4363 at level 19. That is 7,133 xp to reach level 11, which is
  // where a tree's ten points are all earned, and 33,567 to cap a track at 20.
  need: function (lv) {
    if (lv >= this.MAX_LV) return 0;
    if (lv < 1) lv = 1;
    return Math.round(50 * Math.pow(lv, 1.5));
  },

  // Spend banked xp on as many levels as it covers. Returns levels gained.
  _absorb: function (r) {
    var gained = 0, guard = 0, n;
    while (r.lv < this.MAX_LV && guard++ < 128) {
      n = this.need(r.lv);
      if (r.xp < n) break;
      r.xp -= n;
      r.lv++;
      r.pts++;
      gained++;
    }
    if (r.lv >= this.MAX_LV) r.xp = 0;   // capped: no phantom progress bar
    return gained;
  },

  // Rebuild the flat buff table and the ownership set. Called only when the owned
  // set moves (a purchase) or a save is loaded -- never per frame.
  _recache: function () {
    var c = this._cache, own = this._own, keys = this._buffKeys, def = this.BUFF_DEF;
    var i, k;

    for (i = 0; i < keys.length; i++) { k = keys[i]; c[k] = def[k] === 'mul' ? 1 : 0; }
    for (i = 0; i < this._flat.length; i++) own[this._flat[i].key] = false;

    var s = G.skills;
    for (i = 0; i < this._flat.length; i++) {
      var nd = this._flat[i];
      var r = s[nd.prof];
      if (!r || !r.nodes || !Object.prototype.hasOwnProperty.call(r.nodes, nd.key)) continue;
      if (!r.nodes[nd.key]) continue;
      own[nd.key] = true;
      var b = nd.buff;
      if (!b) continue;
      for (k in b) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
        if (!Object.prototype.hasOwnProperty.call(c, k)) continue;   // unregistered: ignore
        if (def[k] === 'mul') c[k] *= b[k]; else c[k] += b[k];
      }
    }
  },

  // The one buff with a persistent side effect: hearts live on G, not in a
  // multiplier. Track how many Skills has handed out so re-applying on every load
  // is a no-op instead of a stacking bug.
  _applyHearts: function () {
    var s = G.skills;
    var want = Math.round(this._cache.maxHearts);
    var had = s.hearts | 0;
    if (want === had) return;
    var d = want - had;
    var mh = Math.round((typeof G.maxHearts === 'number' && isFinite(G.maxHearts)) ? G.maxHearts : 3) + d;
    if (mh < 1) mh = 1;
    if (mh > 12) mh = 12;       // the HUD strip only has room for so many
    G.maxHearts = mh;
    var h = (typeof G.hearts === 'number' && isFinite(G.hearts)) ? G.hearts : mh;
    if (d > 0) h += d;          // a new heart arrives full, not empty
    if (h > mh) h = mh;
    if (h < 0) h = 0;
    G.hearts = Math.round(h * 2) / 2;   // hearts are counted in halves everywhere
    s.hearts = want;
  },

  // ------------------------------------------------------------ public read ----
  // Match a producer's label to a profession. Returns '' for something it cannot
  // place, so gain() can drop it silently rather than inventing a track.
  resolve: function (skill) {
    if (typeof skill !== 'string') return '';
    var k = skill.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(this.TREES, k)) return k;
    if (Object.prototype.hasOwnProperty.call(this.ALIAS, k)) return this.ALIAS[k];
    return '';
  },

  level: function (skill) {
    if (!this.ensure()) return 1;
    var k = this.resolve(skill);
    return k ? G.skills[k].lv : 1;
  },

  // xp banked toward the NEXT level (0 at the cap). Use need(level(skill)) for
  // the denominator.
  xp: function (skill) {
    if (!this.ensure()) return 0;
    var k = this.resolve(skill);
    return k ? G.skills[k].xp : 0;
  },

  // Unspent points. With a profession, that track's pool; with no argument, the
  // total across all five (which is what a HUD badge wants).
  points: function (skill) {
    if (!this.ensure()) return 0;
    if (skill !== undefined) {
      var k = this.resolve(skill);
      return k ? G.skills[k].pts : 0;
    }
    var n = 0;
    for (var i = 0; i < this.PROFS.length; i++) n += G.skills[this.PROFS[i]].pts;
    return n;
  },

  // Owned? Total and allocation-free: one hasOwnProperty on a preallocated table.
  has: function (nodeKey) {
    if (!this._init) this._boot();
    if (typeof G === 'undefined' || !G) return false;
    if (G.skills !== this._cobj) { if (!this.ensure()) return false; }
    return Object.prototype.hasOwnProperty.call(this._own, nodeKey) && this._own[nodeKey] === true;
  },

  // Is the unlocked verb `name` available? Sugar over has(), so callers do not
  // have to hardcode node keys.
  can: function (name) {
    if (!this._init) this._boot();
    var k = Object.prototype.hasOwnProperty.call(this._abil, name) ? this._abil[name] : '';
    return k ? this.has(k) : false;
  },

  // THE interface. Multiply or add blindly; a miss is the identity value.
  //   value * Skills.buff('shellValue')          -> unchanged when unowned
  //   rand() < Skills.buff('doubleOre')          -> never when unowned
  //
  // Hot path is two property reads and a typeof: the table is preallocated with
  // every registered name, so there is nothing to build and nothing to allocate.
  // The typeof check is what makes it prototype-safe -- buff('toString') would
  // otherwise hand back a function -- so it stands in for hasOwnProperty here.
  buff: function (name) {
    var c = this._cache;
    if (c === null) { this._boot(); c = this._cache; }
    if (typeof G === 'undefined' || !G) {
      var i = this._ident[name];
      return typeof i === 'number' ? i : 1;
    }
    if (G.skills !== this._cobj) { this.ensure(); c = this._cache; }
    var v = c[name];
    return typeof v === 'number' ? v : 1;
  },

  // Convenience for the additive chance buffs: one roll, no allocation.
  roll: function (name) { return Math.random() < this.buff(name); },

  node: function (key) {
    if (!this._init) this._boot();
    return Object.prototype.hasOwnProperty.call(this._byKey, key) ? this._byKey[key] : null;
  },

  tree: function (prof) {
    var k = this.resolve(prof);
    return k ? this.TREES[k] : null;
  },

  // Prerequisites all owned?
  unlocked: function (key) {
    var nd = this.node(key);
    if (!nd) return false;
    for (var i = 0; i < nd.req.length; i++) if (!this.has(nd.req[i])) return false;
    return true;
  },

  // Owned, unlocked-and-affordable, unlocked-but-broke, or locked.
  state: function (key) {
    var nd = this.node(key);
    if (!nd) return 'locked';
    if (this.has(key)) return 'owned';
    if (!this.unlocked(key)) return 'locked';
    return this.points(nd.prof) >= nd.cost ? 'ready' : 'broke';
  },

  owned: function (prof) {
    var k = this.resolve(prof);
    if (!k || !this.ensure()) return 0;
    var list = this.TREES[k], n = 0;
    for (var i = 0; i < list.length; i++) if (this._own[list[i].key]) n++;
    return n;
  },

  // --------------------------------------------------------------- earning ----
  // The one entry point producers call. Deliberately does NOT save on every tick:
  // xp arrives on every swing and every shell, and the 25 s autosave covers it.
  // A level-up does save, because that is the part a player would miss.
  gain: function (skill, amount) {
    if (!this.ensure()) return 0;
    var k = this.resolve(skill);
    if (!k) return 0;
    var n = Math.floor(amount);
    if (!isFinite(n) || n <= 0) return 0;
    if (n > 100000) n = 100000;

    var r = G.skills[k];
    if (r.lv >= this.MAX_LV) return 0;      // capped: swallow it quietly

    r.xp += n;
    var gained = this._absorb(r);
    if (!gained) return 0;

    this._recache();          // levels do not grant buffs, but points changed
    var idx = this.PROFS.indexOf(k);
    this._lvT = 1.6;
    this._lvTab = idx;
    if (typeof Game !== 'undefined') {
      Game.toast(k + ' is now level ' + r.lv + '  --  +' + gained +
        (gained > 1 ? ' skill points' : ' skill point') + '  [K]');
      Game.save();
    }
    if (typeof SND !== 'undefined') SND.chime();
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    return gained;
  },

  // --------------------------------------------------------------- spending ----
  // No refunds, no respec. A point leaves the pool and that is the end of it --
  // which is the whole reason the trees are worth thinking about.
  buy: function (key) {
    if (!this.ensure()) return false;
    var nd = this.node(key);
    if (!nd) return false;

    if (this.has(key)) { this._say('already learned'); this._snd('blip'); return false; }
    if (!this.unlocked(key)) {
      this._say('needs ' + this._reqNames(nd) + ' first');
      this._snd('alarm');
      return false;
    }
    var r = G.skills[nd.prof];
    if (r.pts < nd.cost) {
      this._say('needs ' + nd.cost + ' ' + nd.prof + ' point' + (nd.cost > 1 ? 's' : '') +
        ' -- otto has ' + r.pts);
      this._snd('alarm');
      return false;
    }

    r.pts -= nd.cost;
    r.nodes[key] = true;
    this._recache();
    // THE HIVE OPENS. The cell you just bought pops, and so does every cell this
    // purchase has now made visible -- which is the whole point of the layout:
    // spending somewhere makes its neighbours appear, with a beat you can see.
    if (!this._revT) this._revT = {};
    this._revT[key] = this.REV_T;
    for (var rv = 0; rv < this._flat.length; rv++) {
      var n2 = this._flat[rv];
      if (this.has(n2.key) || !n2.req || n2.req.indexOf(key) < 0) continue;
      if (this.shown(n2)) this._revT[n2.key] = this.REV_T * 1.4;
    }
    this._applyHearts();

    this._say('learned ' + nd.name);
    if (typeof FX !== 'undefined' && FX.ring) {
      var rc0 = this._nodeRect(nd);
      FX.ring(rc0.x + rc0.w / 2, rc0.y + rc0.h / 2, this.ACC[nd.profIdx] || '#e08a1a');
    }
    if (typeof SND !== 'undefined') SND.chime();
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    var rc = this._nodeRect(nd);
    this._burst(rc.x + rc.w / 2, rc.y + rc.h / 2, nd.star ? 12 : 8, nd.profIdx);
    if (typeof Game !== 'undefined') {
      Game.toast('learned: ' + nd.name + (nd.star ? '  (keystone!)' : ''));
      Game.save();
    }
    return true;
  },

  _reqNames: function (nd) {
    var out = '', i, m;
    for (i = 0; i < nd.req.length; i++) {
      if (this.has(nd.req[i])) continue;
      m = this.node(nd.req[i]);
      if (!m) continue;
      out += (out ? ' and ' : '') + m.name;
    }
    return out || 'an earlier skill';
  },

  _say: function (m) { this._note = m; this._noteT = 3.0; },
  _snd: function (n) { if (typeof SND !== 'undefined' && SND[n]) SND[n](); },

  // ------------------------------------------------------------------- fx ------
  // Recycled pool, capped, never allocates. Colours are batched at draw time.
  _burst: function (x, y, n, ci) {
    var fx = this._fx, made = 0, i, f, a, sp;
    for (i = 0; i < fx.length && made < n; i++) {
      f = fx[i];
      if (f.t > 0) continue;
      a = Math.random() * TAU;
      sp = 24 + Math.random() * 46;
      f.x = x; f.y = y;
      f.vx = Math.cos(a) * sp;
      f.vy = Math.sin(a) * sp - 12;
      f.life = 0.45 + Math.random() * 0.4;
      f.t = f.life;
      f.c = ci;
      made++;
    }
  },

  // --------------------------------------------------------------- geometry ----
  prof: function () { return this.PROFS[this.tab]; },
  // With one screen and no tabs, `tab` is not a page any more -- it is simply
  // which trade the header and the xp bar are reporting on, and it follows
  // whatever cell is selected.
  _syncTab: function () {
    var nd = this._flat && this._flat[this.sel];
    if (!nd) return;
    var i = this.PROFS.indexOf(nd.prof);
    if (i >= 0) this.tab = i;
  },
  // THE WHOLE HIVE. There are no tabs any more -- every trade is on the one
  // screen -- so the selection, the hit test and the draw all walk one list.
  list: function () { return this._flat || []; },
  listOf: function (prof) { return this.TREES[prof]; },

  _closeRect: function () { return { x: this.WX + this.WW - 32, y: this.WY + 10, w: 20, h: 17 }; },

  // An iPad has no scroll wheel, so the zoom needs something to press.
  _zoomRect: function (d) {
    return { x: this.TX + this.TW - 39 + (d > 0 ? 0 : 20), y: this.TY + this.TH - 19, w: 18, h: 17 };
  },

  // Zoom about the middle of the view, so the cell you are looking at stays put.
  _zoom: function (d) {
    var z = clamp(Math.round((this.Z + d) * 4) / 4, this.ZMIN, this.ZMAX);
    if (z === this.Z) return;
    this.Z = z;
    this._clampCam();
    this._wantX = this._cx; this._wantY = this._cy;
    this._snd('blip');
  },

  _tabRect: function (i) {
    var inner = this.WW - 16, gap = 2;
    var w = (inner - gap * 4) / 5;
    return { x: this.WX + 8 + i * (w + gap), y: this.WY + 30, w: w, h: 16 };
  },

  // A node's box. Rows are tiers; a row of k nodes is spread evenly across TW so
  // the branches read as branches without a hand-authored x per node.
  // ---- THE HIVE ---------------------------------------------------------------
  //
  // ONE SCREEN, five trades, no tabs. The five professions radiate from a hub in
  // the middle at 72 degrees apart; each one runs outward in four TIERS of two,
  // and every cell is a flat-top hexagon packed at the pitch its neighbours sit
  // on, so the whole thing reads as a honeycomb rather than five separate lists
  // you have to page between.
  //
  //   HR      hex radius, centre to corner
  //   RING    distance between tiers. Cells in a hex grid are sqrt(3)*HR apart,
  //           so anything under 1.732 * HR makes neighbouring tiers OVERLAP.
  //   SIDE    the sideways offset of the two nodes in a tier, = 0.87 * HR
  //
  // With TH = 198 of room and an envelope of 1.809 * (4 * RING) + 2 * HR, HR = 12
  // at RING = 1.8 * HR fills the canvas and stays inside it. That pair is not
  // taste, it is the largest cell the page has room for.
  //
  // Angles start at -90 (straight up) so CLAM is at the top and the rest go
  // clockwise, which is the order the tab strip used to read in.
  HR: 12,
  RING: 1.8,
  hubXY: function () { return { x: this.WX + 142, y: this.WY + 136 }; },

  // ---- THE CAMERA ----------------------------------------------------------
  // HR cannot simply be made bigger: five spokes of four tiers need
  // 16.1 * HR of HEIGHT, and the page has 198, which is what pins HR at 12.
  // The way to see the comb bigger is therefore to look at less of it -- a
  // camera over the hive, following the selection. Z is device-friendly at
  // half steps and the pan is quantised to the same pitch, because a smoothly
  // easing camera over nearest-neighbour sprites re-rasterises every icon on
  // every frame and the whole comb shimmers.
  Z: 1.1,
  ZMIN: 0.5, ZMAX: 3,
  _cx: 0, _cy: 0,          // where the camera is looking, in hive units
  _cinit: false,

  // The camera must be somewhere sensible before ANYTHING reads it. openUI()
  // aims it at the selection, but `open` is a public field and the panel can be
  // raised by setting it directly -- in which case the camera sat at the hive's
  // ORIGIN, which is up and left of the whole comb, and the page drew blank.
  // Cheap, idempotent, and called from both update() and draw().
  _camEnsure: function () {
    if (this._cinit) return;
    this._cinit = true;
    var h = this.hubXY();
    this._cx = this._wantX = h.x;
    this._cy = this._wantY = h.y;
    this._clampCam();
  },

  // The hive's full extent, so the camera can be clamped to it rather than
  // wandering off into blank paper.
  _bounds: function () {
    var l = this._flat, i, p, r = this.HR + 4;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < l.length; i++) {
      p = this.hexAt(l[i]);
      if (p.x - r < x0) x0 = p.x - r;
      if (p.y - r < y0) y0 = p.y - r;
      if (p.x + r > x1) x1 = p.x + r;
      if (p.y + r > y1) y1 = p.y + r;
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  },

  // Keep the camera so the comb never pulls away from the edge of its canvas.
  // When the hive is SMALLER than the view at this zoom, centre it instead --
  // clamp(v, lo, hi) with hi < lo returns hi, which would jam it in a corner.
  _clampCam: function () {
    var b = this._bounds(), z = this.Z;
    var hw = this.TW / (2 * z), hh = this.TH / (2 * z);
    var lo, hi;
    lo = b.x0 + hw; hi = b.x1 - hw;
    this._cx = hi < lo ? (b.x0 + b.x1) / 2 : clamp(this._cx, lo, hi);
    lo = b.y0 + hh; hi = b.y1 - hh;
    this._cy = hi < lo ? (b.y0 + b.y1) / 2 : clamp(this._cy, lo, hi);
  },

  // Screen point -> hive point. Every hit test goes through this, so the boxes
  // can never drift from what is drawn.
  _toHive: function (x, y) {
    var z = this.Z;
    return {
      x: (x - (this.TX + this.TW / 2)) / z + this._cx,
      y: (y - (this.TY + this.TH / 2)) / z + this._cy,
    };
  },

  _camTo: function (nd, snap) {
    if (!nd) return;
    var p = this.hexAt(nd);
    if (snap) { this._cx = p.x; this._cy = p.y; }
    this._wantX = p.x; this._wantY = p.y;
  },
  _wantX: 0, _wantY: 0,
  profAngle: function (pi) { return -Math.PI / 2 + pi * TAU / 5; },

  // Where a node sits, in screen units. Everything else -- the hit test, the
  // links, the reveal animation -- reads this one function.
  hexAt: function (nd) {
    // A STAGGERED CHAIN PER TRADE, not a spoke with cells hung off its sides.
    //
    // The old layout put two cells per tier, offset PERPENDICULAR to a spoke.
    // That is fine within one trade, and fatal between two: five spokes are 72
    // apart, and each one's perpendicular points a different way, so the "+side"
    // cell of one arm and the "-side" cell of the next walk straight into each
    // other. At HR 12 they landed 8.5 units apart where a hexagon needs 20.8 to
    // clear its neighbour -- which is the pile-up on screen: cells stacked on
    // cells around the hub.
    //
    // Each trade is now a single chain of eight cells zigzagging outward. With a
    // radial step of 0.866*PITCH and the perpendicular alternating by a quarter
    // pitch either side, consecutive cells are EXACTLY one pitch apart, and the
    // nearest cell on the next arm is over two pitches away. It cannot overlap,
    // and it reads as a vine growing out of the hub rather than a lattice that
    // has been forced into five.
    var pi = this.PROFS.indexOf(nd.prof);
    if (pi < 0) pi = 0;
    var a = this.profAngle(pi);
    var P = this.HR * 1.732;                       // hex pitch: centre to centre
    var i = (nd.tier | 0) * 2 + (nd.col | 0);      // 0..7 along the chain
    var r = (i + 2) * 0.866 * P;                   // +2 keeps arm 0 clear of arm 1
    var off = (i & 1 ? 0.25 : -0.25) * P;
    var hub = this.hubXY();
    return {
      x: hub.x + Math.cos(a) * r - Math.sin(a) * off,
      y: hub.y + Math.sin(a) * r + Math.cos(a) * off,
    };
  },

  _nodeRect: function (nd) {
    var c = this.hexAt(nd), s = this.HR * 1.8;
    return { x: c.x - s / 2, y: c.y - s / 2, w: s, h: s };
  },

  // One hexagon. `wob` is how far the pen wanders off the true corner -- it is
  // hashed from the CENTRE, so a given cell wobbles identically on every frame.
  // A wobble reseeded per frame is a crawling outline, which reads as a bug.
  _hexPath: function (c, cx, cy, r, wob) {
    var w = wob || 0, i, a, rr, x, y, px = 0, py = 0;
    c.beginPath();
    for (i = 0; i <= 6; i++) {
      a = (i % 6) * Math.PI / 3;
      rr = r + (w ? inkN(cx + i * 13, cy - i * 7) * w : 0);
      x = cx + Math.cos(a) * rr;
      y = cy + Math.sin(a) * rr;
      if (i === 0) { c.moveTo(x, y); } else if (w) { inkCurveTo(c, px, py, x, y, w * 0.6); } else { c.lineTo(x, y); }
      px = x; py = y;
    }
    c.closePath();
  },

  // Outline a hex the way a pen does: once firmly, once lightly and a shade off
  // register. Two passes is the whole trick -- one clean stroke always reads as
  // vector art no matter how much the corners wobble.
  _hexInk: function (c, cx, cy, r, col, lw) {
    this._hexPath(c, cx, cy, r, 0.9);
    c.strokeStyle = col;
    c.lineWidth = lw;
    c.stroke();
    var a = c.globalAlpha;
    c.globalAlpha = a * 0.38;
    this._hexPath(c, cx + 0.45, cy + 0.4, r, 1.3);
    c.lineWidth = lw * 0.66;
    c.stroke();
    c.globalAlpha = a;
    c.lineWidth = 1;
  },

  // A node is SHOWN once it is learned or every one of its requirements is --
  // so the hive opens outward as you spend, and an unlock makes its neighbours
  // appear. _revT holds the per-key pop timer that animation rides on.
  REV_T: 0.5,
  _revT: null,
  shown: function (nd) {
    if (this.has(nd.key)) return true;
    if (!nd.req || !nd.req.length) return true;
    for (var i = 0; i < nd.req.length; i++) if (!this.has(nd.req[i])) return false;
    return true;
  },

  _in: function (r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },

  _hit: function (mx, my) {
    // outside the hive's canvas there is nothing to hit, whatever the camera
    if (mx < this.TX || mx > this.TX + this.TW || my < this.TY || my > this.TY + this.TH) return -1;
    var h = this._toHive(mx, my);
    var list = this.list(), i, nd, r;
    var slop = 3 / this.Z;
    for (i = 0; i < list.length; i++) {
      nd = list[i];
      r = this._nodeRect(nd);
      // a couple of units of slop: 24-unit boxes on a 480-wide screen are small
      // under a finger
      if (h.x >= r.x - slop && h.x <= r.x + r.w + slop &&
          h.y >= r.y - slop && h.y <= r.y + r.h + slop) return i;
    }
    return -1;
  },

  // ------------------------------------------------------------- open / close ---
  // Guards on every peer it can see. There is no modal manager in this game; each
  // panel checks the others by hand and publishes its own `open` for them.
  openUI: function (prof) {
    if (!this.ensure()) return;
    if (this.open) return;
    if (typeof Game !== 'undefined' && (Game.helpOpen || Game.fadeDir !== 0)) return;
    if (typeof Shop !== 'undefined' && Shop.open) return;
    if (typeof Bench !== 'undefined' && Bench.open) return;
    if (typeof Craft !== 'undefined' && Craft.open) return;
    if (typeof NPCs !== 'undefined' && NPCs.open) return;
    if (typeof Stock !== 'undefined' && Stock.open) return;
    if (typeof Farm !== 'undefined' && Farm.open) return;
    if (typeof Inv !== 'undefined' && Inv.open) return;
    if (typeof Battle !== 'undefined' && Battle.active) return;

    var k = prof ? this.resolve(prof) : '';
    if (k) this.tab = this.PROFS.indexOf(k);
    this.open = true;
    this._openT = 0;              // the page gets put down again every time
    this.sel = 0;
    // start looking at the first cell of the trade that was asked for, snapped
    this._cinit = true;
    this._camTo(this._flat[0], true);
    this._clampCam();
    this.hover = '';
    this._note = '';
    this._noteT = 0;
    this._snd('blip');
  },

  close: function () {
    if (!this.open) return;
    this.open = false;
    this.hover = '';
    this._snd('click');
    if (typeof Game !== 'undefined') Game.save();
  },

  setTab: function (i) {
    if (i < 0) i = 0;
    if (i > 4) i = 4;
    if (i === this.tab) return;
    this.tab = i;
    this.sel = 0;
    this._note = '';
    this._noteT = 0;
    this._snd('blip');
  },

  // Move the keyboard selection. dx walks the current tier, dy changes tier and
  // keeps roughly the same column.
  _move: function (dx, dy) {
    var list = this.list();
    var cur = list[this.sel] || list[0];
    if (!cur) return;
    var tiers = this._tiers[this.prof()];
    var t = cur.tier, col = cur.col, nd = null, i;

    if (dx) {
      col += dx;
      var row = tiers[t];
      if (col < 0) col = row.length - 1;
      if (col >= row.length) col = 0;
      nd = row[col];
    } else if (dy) {
      for (i = 0; i < 4; i++) {
        t += dy;
        if (t < 0) t = 3;
        if (t > 3) t = 0;
        if (tiers[t].length) break;
      }
      var r2 = tiers[t];
      nd = r2[col < r2.length ? col : r2.length - 1];
    }
    if (!nd) return;
    for (i = 0; i < list.length; i++) if (list[i] === nd) { this.sel = i; break; }
    this._snd('blip');
  },

  // ----------------------------------------------------------------- update ----
  update: function (dt) {
    this._openT = Math.min(1, this._openT + dt * 4.5);
    if (this.open) {
      this._camEnsure();
      var k = Math.min(1, dt * 9);
      this._cx += (this._wantX - this._cx) * k;
      this._cy += (this._wantY - this._cy) * k;
      this._clampCam();
    }
    if (!this.ensure()) return;
    // Two layers may end up ticking us; Game.time advances exactly once a frame.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (dt > 0.1) dt = 0.1;

    this.time += dt;
    if (this._noteT > 0) this._noteT -= dt;
    if (this._lvT > 0) this._lvT -= dt;

    // particles run whether or not the panel is up, so a burst finishes cleanly
    var fx = this._fx, i, f;
    for (i = 0; i < fx.length; i++) {
      f = fx[i];
      if (f.t <= 0) continue;
      f.t -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 96 * dt;
      f.vx *= 0.94;
    }
    if (!this.open) return;

    var m = Input.mouse;

    // ---- keys. While the panel is up it owns the digits and the arrows, and it
    // eats the verbs the scene underneath would otherwise act on -- exactly what
    // Craft does, so the interact spot cannot re-open us every frame.
    Input.p('KeyE');
    Input.p('Space');
    Input.p('KeyH');

    if (Input.p('Escape') || Input.p('KeyK')) { this.close(); return; }

    // digits jump the SELECTION to that trade's first cell -- there are no tabs
    // to switch any more, the whole hive is on screen
    for (i = 0; i < 5; i++) {
      if (!Input.p('Digit' + (i + 1))) continue;
      var f0 = this._flat;
      for (var z = 0; z < f0.length; z++) {
        if (f0[z].prof !== this.PROFS[i] || f0[z].tier !== 0) continue;
        this.sel = z; this.tab = i; this._camTo(f0[z]); break;
      }
      return;
    }
    if (this._revT) for (var rk in this._revT) if (this._revT[rk] > 0) this._revT[rk] -= dt;

    var mvx = 0, mvy = 0;
    if (Input.p('ArrowLeft')) mvx = -1;
    else if (Input.p('ArrowRight')) mvx = 1;
    else if (Input.p('ArrowUp')) mvy = -1;
    else if (Input.p('ArrowDown')) mvy = 1;
    if (mvx || mvy) {
      // NEAREST CELL IN THAT DIRECTION. A hive has no rows and columns to step
      // through, so the arrows pick the closest cell whose bearing is within
      // sixty degrees of the way you pressed.
      var here = this._flat[this.sel];
      if (here) {
        var hp = this.hexAt(here), best = -1, bd = 1e9;
        for (var q2 = 0; q2 < this._flat.length; q2++) {
          if (q2 === this.sel) continue;
          var np = this.hexAt(this._flat[q2]);
          var dx = np.x - hp.x, dy = np.y - hp.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          if ((dx / len) * mvx + (dy / len) * mvy < 0.5) continue;   // wrong way
          if (len < bd) { bd = len; best = q2; }
        }
        if (best >= 0) { this.sel = best; this._syncTab(); this._camTo(this._flat[best]); this._snd('blip'); }
      }
      return;
    }

    // the wheel ZOOMS. There is a camera over the hive now, and a wheel over a
    // map that walks a list instead of zooming is the wrong answer everywhere.
    if (Input.wheelDelta) this._zoom(Input.wheelDelta > 0 ? -0.25 : 0.25);
    if (Input.p('Minus') || Input.p('NumpadSubtract')) this._zoom(-0.25);
    if (Input.p('Equal') || Input.p('NumpadAdd')) this._zoom(0.25);

    if (Input.p('Enter')) {
      var cur = this.list()[this.sel];
      if (cur) this.buy(cur.key);
      return;
    }

    // ---- pointer
    var idx = this._hit(m.x, m.y);
    this.hover = idx >= 0 ? this.list()[idx].key : '';

    // DRAG THE PAPER. Only a drag that STARTS on blank comb pans -- a press on a
    // cell is a purchase, and Input.mouse.clicked fires on the press, so a
    // drag-anywhere pan would buy whatever the finger went down on first.
    var inCanvas = m.x >= this.TX && m.x <= this.TX + this.TW &&
                   m.y >= this.TY && m.y <= this.TY + this.TH;
    if (m.down && inCanvas) {
      if (!this._pan && idx < 0) this._pan = { x: m.x, y: m.y };
      else if (this._pan) {
        this._cx -= (m.x - this._pan.x) / this.Z;
        this._cy -= (m.y - this._pan.y) / this.Z;
        this._pan.x = m.x; this._pan.y = m.y;
        this._clampCam();
        this._wantX = this._cx; this._wantY = this._cy;   // do not ease against the finger
      }
    } else if (!m.down) this._pan = null;

    if (m.clicked) {
      // most specific first, and return after the first hit so one click can
      // never fire two actions
      if (this._in(this._closeRect(), m.x, m.y)) { this.close(); return; }
      if (this._in(this._zoomRect(1), m.x, m.y)) { this._zoom(0.25); return; }
      if (this._in(this._zoomRect(-1), m.x, m.y)) { this._zoom(-0.25); return; }
      // (NO TAB HIT TEST. The strip is not drawn any more, and an invisible row
      // of rects across the top of the page silently ate clicks meant for the
      // title band.)
      if (idx >= 0) { this.sel = idx; this._syncTab(); this._camTo(this.list()[idx]); this.buy(this.list()[idx].key); return; }
      // a click outside the window closes, the way Craft and Farm's picker do
      if (m.x < this.WX || m.x > this.WX + this.WW || m.y < this.WY || m.y > this.WY + this.WH) {
        this.close();
        return;
      }
    }
  },

  // ------------------------------------------------------------------ draw -----
  draw: function (c) {
    if (!this.ensure()) return;
    this._camEnsure();
    var W_ = W, H_ = H;

    // one flat rect, not a gradient: this runs over every device pixel
    c.fillStyle = 'rgba(10,14,20,0.62)';
    c.fillRect(0, 0, W_, H_);

    c.save();
    uiPageOpen(c, clamp(this._openT, 0, 1), this.WX + this.WW / 2, this.WY + this.WH / 2);
    uiPage(c, this.WX, this.WY, this.WW, this.WH, 1);

    var prof = this.prof(), r = G.skills[prof], acc = this.ACC[this.tab];

    text(c, "OTTO'S TRADES", this.WX + 34, this.WY + 12, { size: 12, color: '#662907', shadow: false });
    text(c, 'five things worth getting good at', this.WX + 34, this.WY + 25,
      { size: 7, color: '#914007', shadow: false });
    var total = this.points();
    if (total > 0) {
      // an unspent point is the reason you opened this, so it gets a drawn
      // sticky note -- circled in pencil, the way you would mark it yourself
      var pt = total + (total > 1 ? ' points to spend' : ' point to spend');
      var pw = textWidth(c, pt, 7) + 16;
      var px = this.WX + this.WW - 40 - pw, py = this.WY + 5;
      c.globalAlpha = 0.85 + 0.15 * Math.sin(this.time * 3);
      inkBox(c, px, py, pw, 16, '#e08a1a', '#c56906', PIX * 2);
      c.globalAlpha = 1;
      text(c, pt, px + pw / 2, py + 4.5,
        { size: 7, color: '#662907', align: 'center', shadow: false });
    }

    // ---- close: the frame in miniature, not a bare x
    var cr = this._closeRect();
    var mo = !TouchUI.enabled && this._in(cr, Input.mouse.x, Input.mouse.y);
    inkClose(c, cr, mo);

    // ---- the note pinned beside the comb, drawn once so the bar and the node
    // detail share one card rather than sitting on two
    inkBox(c, this.IX, this.IY, this.IW, this.IH, '#f8d089', '#914007', PIX * 2);

    // (NO TAB STRIP. The hive is one screen -- all five trades at once -- so
    // there is nothing to page between. The header reports whichever trade the
    // selected cell belongs to.)
    this._drawBar(c, r, acc);
    this._drawTree(c, prof);
    this._drawZoom(c);
    this._drawInfo(c, prof, r);

    text(c, TouchUI.enabled ? 'tap a cell to learn it  --  drag the comb to look around'
                            : '[arrows] move  [Enter] learn  drag to pan  wheel to zoom  [Esc] close',
      this.WX + this.WW / 2, this.WY + this.WH - 15, { size: 6.5, color: '#914007', align: 'center', shadow: false });
    c.restore();
  },

  _drawTabs: function (c) {
    var i, t, r, on, lit;
    for (i = 0; i < 5; i++) {
      r = this._tabRect(i);
      on = i === this.tab;
      lit = this._lvT > 0 && this._lvTab === i;
      var hov = !TouchUI.enabled && this._in(r, Input.mouse.x, Input.mouse.y);
      // paper index tabs, each carrying its track's colour along the foot
      c.globalAlpha = lit ? 0.65 + 0.35 * Math.sin(this.time * 12) : 1;
      uiTab(c, r, this.TABS[i], on, hov, this.ACC[i]);
      c.globalAlpha = 1;
      var lv = G.skills[this.PROFS[i]].lv;
      var pts = G.skills[this.PROFS[i]].pts;
      text(c, String(lv), r.x + r.w - 4, r.y + (on ? 3 : 4),
        { size: 6, color: on ? '#662907' : '#5f4526', align: 'right', shadow: false });
      if (pts > 0) {
        // an unmissable dot for "you have something to spend here"
        c.fillStyle = '#e08a1a';
        c.fillRect(r.x + 2.5, r.y + 2.5, 2, 2);
      }
    }
  },

  // The head of the info column: which trade the selection belongs to, its
  // level, and how far along the track is. It lives in the right column rather
  // than across the top because the hive needs every unit of the page's HEIGHT
  // and none of its right-hand width.
  _drawBar: function (c, r, acc) {
    var x = this.IX + 8, y = this.IY + 7, w = this.IW - 16;
    var need = this.need(r.lv);
    var capped = r.lv >= this.MAX_LV;
    var frac = capped ? 1 : (need > 0 ? r.xp / need : 0);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;

    // the trade's own drawn badge, so the column is never just words
    var MARK = ['shell', 'pick', 'sword', 'seed', 'fish'];
    PixIcons.draw(c, MARK[this.tab] || 'shell', x + 6, y + 4, 13,
      { t: this.time, phase: this.tab, fx: 'bob' });
    text(c, this.prof(), x + 15, y, { size: 8, color: '#662907', shadow: false });
    text(c, 'lv ' + r.lv, x + w, y, { size: 8, color: '#662907', align: 'right', shadow: false });

    var by = y + 12, bh = 6;
    c.globalAlpha = capped ? 0.85 : 1;
    uiMeter(c, x, by, w, bh, frac, acc, true);
    c.globalAlpha = 1;

    text(c, capped ? 'mastered' : (r.xp + ' / ' + need + ' xp'),
      x, by + 9, { size: 6.5, color: '#914007', shadow: false });
    text(c, this.owned(this.prof()) + ' / ' + this.listOf(this.prof()).length + ' learned',
      x + w, by + 9, { size: 6.5, color: '#914007', align: 'right', shadow: false });
  },

  // THE HIVE, painted. Everything here is clipped to TX/TY/TW/TH: a cell that
  // lands outside its canvas is a geometry bug, and clipping means it reads as
  // one instead of quietly spraying hexagons across the page.
  _drawTree: function (c, prof) {
    var list = this._flat, i, nd, pr, j, q;
    var hub = this.hubXY();
    var t = this.time;
    var HR = this.HR;

    c.save();
    c.beginPath();
    c.rect(this.TX, this.TY, this.TW, this.TH);
    c.clip();
    // THE CAMERA. Quantised to a whole device texel at the current zoom: an
    // easing camera over nearest-neighbour sprites re-rasterises every icon
    // every frame, and the whole comb crawls.
    var q = 1 / (DPX * this.Z);
    c.translate(this.TX + this.TW / 2, this.TY + this.TH / 2);
    c.scale(this.Z, this.Z);
    c.translate(-Math.round(this._cx / q) * q, -Math.round(this._cy / q) * q);
    c.imageSmoothingEnabled = false;

    // (NO WATERMARK HONEYCOMB. There was a decorative hex lattice drawn under
    // all this, and because it could not line up with a RADIAL layout it just
    // competed with the unopened cells at a second pitch. The unopened cells ARE
    // the comb -- drawing them properly is what makes the shape legible.)

    // ---- the links. Two passes: everything unspent as a dashed pencil line,
    // everything learned as a firm bowed stroke. A learned branch therefore
    // reads as inked-in all the way back to the hub.
    for (j = 0; j < 2; j++) {
      if (j) {
        c.setLineDash([]);
        c.strokeStyle = 'rgba(120,88,52,0.85)';
        c.lineWidth = PIX * 3;
      } else {
        c.setLineDash([2, 2.5]);
        c.strokeStyle = 'rgba(140,116,84,0.42)';
        c.lineWidth = PIX * 2;
      }
      c.beginPath();
      for (i = 0; i < list.length; i++) {
        nd = list[i];
        if (!this.shown(nd)) continue;
        if ((this.has(nd.key) ? 1 : 0) !== j) continue;
        var a = this.hexAt(nd);
        if (!nd.req || !nd.req.length) { inkLine(c, hub.x, hub.y, a.x, a.y, 1.6); continue; }
        for (q = 0; q < nd.req.length; q++) {
          pr = this.node(nd.req[q]);
          if (!pr) continue;
          var b = this.hexAt(pr);
          inkLine(c, b.x, b.y, a.x, a.y, 1.6);
        }
      }
      c.stroke();
    }
    c.setLineDash([]);
    c.lineWidth = 1;

    // ---- beads running outward along the learned links: the branch is live.
    // Brightness is a wave in distance-from-hub, so the whole comb pulses from
    // the middle out rather than every link blinking on its own clock.
    for (i = 0; i < list.length; i++) {
      nd = list[i];
      if (!this.has(nd.key)) continue;
      var na = this.hexAt(nd);
      var src = (nd.req && nd.req.length) ? this.node(nd.req[0]) : null;
      var nb = src ? this.hexAt(src) : hub;
      for (q = 1; q <= 3; q++) {
        var u = q / 4;
        var bx = nb.x + (na.x - nb.x) * u, by = nb.y + (na.y - nb.y) * u;
        var d = Math.hypot(bx - hub.x, by - hub.y);
        var w2 = Math.sin(t * 2.6 - d * 0.05);
        if (w2 <= 0.2) continue;
        c.globalAlpha = (w2 - 0.2) * 0.9;
        c.fillStyle = '#fff0c0';
        c.fillRect(bx - PIX, by - PIX, PIX * 2.5, PIX * 2.5);
      }
    }
    c.globalAlpha = 1;

    // ---- the hub: Otto in the middle, with an arc per trade around the rim in
    // that trade's colour, filled by how much of it is learned.
    // (NO GAUGE ARCS. There were five, one per trade, drawn on a ring at
    // HR * 1.5 -- which is INSIDE the tier-0 cells, so every one of them was
    // painted underneath a cell and never seen. The comb already says how far
    // each arm has come, by how much of it is inked in.)
    c.globalAlpha = 0.5;
    this._hexPath(c, hub.x + 0.9, hub.y + 1.6, HR * 1.24, 0.8);
    c.fillStyle = 'rgba(120,92,58,0.5)'; c.fill();
    c.globalAlpha = 1;
    this._hexPath(c, hub.x, hub.y, HR * 1.24, 0.8);
    c.fillStyle = '#f8d089'; c.fill();
    // a warm ring inside the rim, so the queen cell reads as the middle of it all
    c.save();
    c.clip();
    c.fillStyle = 'rgba(255,214,110,0.22)';
    c.fillRect(hub.x - HR * 1.3, hub.y - HR * 0.1, HR * 2.6, HR * 1.4);
    c.restore();
    this._hexInk(c, hub.x, hub.y, HR * 1.24, '#662907', PIX * 3.5);
    var oimg = ASSETS.o4_0;
    if (oimg && oimg.width) {
      // a slow bob, quantised to the sprite's own texel so it cannot shimmer
      var bob = Math.round(Math.sin(t * 1.7) * 1.2 / APIX) * APIX;
      var ow = HR * 1.55, oh = ow * oimg.height / oimg.width;
      c.drawImage(oimg, hub.x - ow / 2, hub.y - oh / 2 + 1 + bob, ow, oh);
    }

    // ---- the cells
    var selNd = list[this.sel], selKey = selNd && selNd.key;
    for (i = 0; i < list.length; i++) {
      nd = list[i];
      var show = this.shown(nd);
      var pos = this.hexAt(nd);
      var pi = this.PROFS.indexOf(nd.prof);
      var acc = this.ACC[pi < 0 ? 0 : pi];
      var owned = this.has(nd.key);
      var can = !owned && show && this.points(nd.prof) >= nd.cost;
      var isSel = nd.key === selKey;
      var isHov = this.hover === nd.key;

      // A CELL THAT IS STILL CAPPED. These are most of the comb for most of the
      // game, and they are what makes the hive read as a hive rather than as a
      // handful of loose badges -- so they get drawn properly: a waxed-over cell
      // with a pencilled outline and a dot where the icon will go.
      if (!show) {
        this._hexPath(c, pos.x, pos.y, HR * 0.92, 0.9);
        c.fillStyle = '#d69a4e';
        c.fill();
        c.globalAlpha = 0.5;
        c.setLineDash([2, 2]);
        this._hexPath(c, pos.x, pos.y, HR * 0.92, 0.9);
        c.strokeStyle = '#8a6a44'; c.lineWidth = PIX * 2; c.stroke();
        c.setLineDash([]);
        c.lineWidth = 1;
        c.fillStyle = '#8a6a44';
        c.fillRect(pos.x - 1, pos.y - 1, 2, 2);
        c.globalAlpha = 1;
        continue;
      }

      // the reveal pop: set in buy(), eased out here
      var rv = this._revT && this._revT[nd.key] > 0 ? this._revT[nd.key] : 0;
      var k = rv > 0 ? 1 + Math.sin(rv / this.REV_T * Math.PI) * 0.35 : 1;
      if (isSel) k *= 1.06 + Math.sin(this.time * 3.4) * 0.03;   // the pick breathes
      var lift = (isSel || isHov) ? 1 : 0;                // the cell picks up off the page

      // an affordable cell breathes a ring outward: "spend here"
      if (can) {
        var pu = (t * 0.85 + i * 0.11) % 1;
        c.globalAlpha = (1 - pu) * 0.5;
        this._hexPath(c, pos.x, pos.y - lift, HR * k * (1 + pu * 0.45), 0.7);
        c.strokeStyle = acc; c.lineWidth = PIX * 2; c.stroke(); c.lineWidth = 1;
        c.globalAlpha = 1;
      }

      // the shadow it casts on the paper
      this._hexPath(c, pos.x + 0.7, pos.y + 1.3 + lift, HR * k, 0.8);
      c.fillStyle = 'rgba(116,88,54,' + (lift ? 0.32 : 0.2) + ')';
      c.fill();

      // the wax: paper, then a wash of the trade's colour once it is yours
      this._hexPath(c, pos.x, pos.y - lift, HR * k, 0.9);
      c.fillStyle = owned ? '#f8d089' : (can ? '#f8d089' : '#d69a4e');
      c.fill();
      if (owned) {
        c.globalAlpha = 0.34; c.fillStyle = acc; c.fill();
        // a shimmer crossing the wax, on a phase per cell so the comb does not
        // blink in unison
        var sh = Math.sin(t * 1.3 - i * 0.5);
        if (sh > 0.86) {
          c.globalAlpha = (sh - 0.86) * 5;
          c.fillStyle = UIPAL.w; c.fill();
        }
        c.globalAlpha = 1;
      }
      // a lit top-left facet, so the cell has a thickness
      c.save();
      c.clip();
      c.fillStyle = 'rgba(255,255,255,0.30)';
      c.fillRect(pos.x - HR, pos.y - lift - HR, HR * 2, HR * 0.55);
      c.fillStyle = 'rgba(120,92,58,0.13)';
      c.fillRect(pos.x - HR, pos.y - lift + HR * 0.42, HR * 2, HR * 0.6);
      c.restore();

      // the outline, gone over twice. Learnable rims breathe in their colour.
      if (can) c.globalAlpha = 0.72 + 0.28 * Math.sin(t * 4 + i);
      this._hexInk(c, pos.x, pos.y - lift, HR * k,
        owned ? acc : (can ? acc : '#914007'),
        (owned || can) ? PIX * 3 : PIX * 2);
      c.globalAlpha = 1;

      var img = ASSETS[nd.art];
      if (img && img.width) {
        // FIT INSIDE THE HEXAGON, not inside its bounding box. A flat-top hex of
        // circumradius HR is only HR*0.866 from centre to EDGE, and it narrows
        // further toward the top and bottom -- so an icon sized off HR (1.2 wide,
        // 1.32 tall) had its corners hanging outside the cell and overlapping the
        // neighbours. Fit both axes into a box the hex fully contains.
        var box = HR * 1.02 * k;
        var iw = box, ih = box * img.height / img.width;
        if (ih > box) { ih = box; iw = box * img.width / img.height; }
        c.globalAlpha = owned ? 1 : 0.7;
        c.drawImage(img, pos.x - iw / 2, pos.y - lift - ih / 2, iw, ih);
        c.globalAlpha = 1;
      }

      // a keystone wears a drawn star; a learned cell gets a pen tick
      if (nd.star) PixIcons.draw(c, 'star', pos.x + HR * 0.62, pos.y - lift - HR * 0.6, 9,
        { t: t, phase: i, fx: owned ? 'pulse' : null, alpha: owned ? 1 : 0.65 });
      if (owned) {
        PixIcons.draw(c, 'check', pos.x - HR * 0.42, pos.y - lift + HR * 0.5, 10, { t: t });
      } else {
        // the price, as pips along the bottom edge
        for (q = 0; q < nd.cost; q++) {
          var qx = pos.x + (q - (nd.cost - 1) / 2) * 3.4;
          c.fillStyle = can ? '#c8922e' : '#914007';
          c.fillRect(qx - 1, pos.y - lift + HR * 0.6, 2, 2);
        }
      }

      if (isSel) {                                         // the selection ring
        c.setLineDash([3, 2.5]);
        c.lineDashOffset = -t * 9;
        this._hexPath(c, pos.x, pos.y - lift, HR * k + 3.4, 0);
        c.strokeStyle = '#662907'; c.lineWidth = PIX * 2; c.stroke();
        c.setLineDash([]);
        c.lineDashOffset = 0;
        c.lineWidth = 1;
      }
    }

    this._drawFx(c);        // inside the camera: a burst belongs to its cell
    c.restore();

    // ---- THE EDGE OF THE COMB -----------------------------------------------
    // The camera clip cuts cells in half at the canvas boundary, which reads as
    // a rendering fault rather than as 'there is more this way'. Feather it in
    // steps of the paper's own colours -- dither, not alpha, so it stays pixel
    // art -- and the comb looks like it carries on under the page instead.
    this._fade(c);
  },

  // The zoom pair. Drawn after the hive and outside its camera, so they stay
  // put in the corner of the canvas while the comb slides about underneath.
  _drawZoom: function (c) {
    var i, r, d, on, lbl, can;
    for (i = 0; i < 2; i++) {
      d = i ? -1 : 1;
      r = this._zoomRect(d);
      on = !TouchUI.enabled && this._in(r, Input.mouse.x, Input.mouse.y);
      can = d > 0 ? this.Z < this.ZMAX : this.Z > this.ZMIN;
      inkBox(c, r.x, r.y, r.w, r.h,
        can ? (on ? '#f0a52c' : 'rgba(255,247,226,0.92)') : 'rgba(230,220,196,0.65)',
        can ? '#662907' : 'rgba(150,132,102,0.55)', PIX * 2);
      PixIcons.draw(c, d > 0 ? 'plus' : 'minus', r.x + r.w / 2, r.y + r.h / 2, 12,
        { t: this.time, fx: on ? 'pulse' : null, alpha: can ? 1 : 0.4 });
    }
    text(c, 'x' + this.Z.toFixed(2).replace(/0$/, ''), this._zoomRect(1).x - 5,
      this._zoomRect(1).y + 5, { size: 6, color: '#7a4a2a', align: 'right', shadow: false });
  },

  // Four stepped bands of paper along each edge of the hive's canvas: solid at
  // the very edge, then two dithered half-tones, then nothing.
  _fade: function (c) {
    // Dither the comb out at the canvas edge so a half-cut cell reads as "there
    // is more this way" rather than as a clipping fault. The solid band that
    // used to sit at the very edge drew a visible RECTANGLE once the page went
    // gold -- it was painting the old cream over the new interior -- so this is
    // dither only, in the interior's own lower tone.
    var S = APIX, n = 4, i, t, x = this.TX, y = this.TY, w = this.TW, h = this.TH;
    for (i = 1; i <= n; i++) {
      t = S * 2 * (n - i + 1);
      c.save();
      c.beginPath();
      c.rect(x, y + t - S * 2, w, S * 2); c.rect(x, y + h - t, w, S * 2);
      c.rect(x + t - S * 2, y, S * 2, h); c.rect(x + w - t, y, S * 2, h);
      c.clip();
      pixDither(c, x, y, w, h, UIPAL.warm, i);
      c.restore();
    }
  },

  // A little drawn star, for the one node per trade worth planning around.
  _star: function (c, x, y, r, col) {
    var i, a, rr;
    c.beginPath();
    for (i = 0; i < 10; i++) {
      a = -Math.PI / 2 + i * Math.PI / 5;
      rr = (i & 1) ? r * 0.44 : r;
      if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
    c.fillStyle = col; c.fill();
    c.strokeStyle = 'rgba(90,64,34,0.7)'; c.lineWidth = PIX; c.stroke(); c.lineWidth = 1;
  },

  // A note pinned beside the comb. INK ON CREAM -- every colour here used to be
  // the light-on-dark palette the panel wore before it became a page, which is
  // why it read as washed out: pale text on pale paper.
  _drawInfo: function (c, prof, rec) {
    var x = this.IX, y = this.IY + 48, w = this.IW, h = this.IH - 48;

    var key = this.hover || (this.list()[this.sel] ? this.list()[this.sel].key : '');
    var nd = this.node(key);
    var tx = x + 8, ty = y + 8, cols = this.COLS, i, lines;

    uiRule(c, x + 6, y - 8, w - 12, true);

    if (!nd) {
      text(c, prof, tx, ty, { size: 7, color: '#662907', shadow: false });
      lines = this._wrap(this.BLURB[this.tab], cols);
      for (i = 0; i < lines.length; i++)
        text(c, lines[i], tx, ty + 12 + i * 8, { size: 6, color: '#7a6244', shadow: false });
      return;
    }

    var st = this.state(key);
    // the node's own icon, so the note and the cell you are looking at match
    var img = ASSETS[nd.art];
    var nx = tx;
    if (img && img.width) {
      var ih = 13, iw = ih * img.width / img.height;
      if (iw > 14) { iw = 14; ih = iw * img.height / img.width; }
      c.drawImage(img, tx, ty - 2, iw, ih);
      nx = tx + 17;
    }
    text(c, nd.name, nx, ty, { size: 7, color: nd.star ? '#662907' : '#30150a', shadow: false });

    var tag = st === 'owned' ? 'learned'
      : st === 'locked' ? 'locked'
      : nd.cost + (nd.cost > 1 ? ' pts' : ' pt');
    var tagCol = st === 'owned' ? '#3f7a4e' : st === 'ready' ? '#c56906' : st === 'broke' ? '#b2601c' : '#907c5c';
    text(c, tag, x + w - 8, ty + 1, { size: 6, color: tagCol, align: 'right', shadow: false });

    var ly = ty + 14;
    if (nd.star) {
      PixIcons.draw(c, 'star', tx + 5, ly + 3, 11, { t: this.time, fx: 'pulse' });
      text(c, 'keystone', tx + 12, ly, { size: 6, color: '#662907', shadow: false });
      ly += 9;
    }

    lines = this._wrap(nd.desc, cols);
    for (i = 0; i < lines.length; i++) {
      text(c, lines[i], tx, ly, { size: 6, color: '#662907', shadow: false });
      ly += 8;
    }

    // the numbers, spelled out, so nobody has to trust the prose
    ly += 3;
    var b = nd.buff, name;
    if (b) {
      for (name in b) {
        if (!Object.prototype.hasOwnProperty.call(b, name)) continue;
        if (ly > y + h - 32) break;   // never encroach on the state line below
        c.fillStyle = '#3f7a4e';
        c.fillRect(tx, ly + 2.5, 2, 2);
        text(c, this._buffLine(name, b[name]), tx + 6, ly, { size: 6, color: '#4e6f52', shadow: false });
        ly += 8;
      }
    }

    if (st === 'locked') {
      lines = this._wrap('needs ' + this._reqNames(nd), cols);
      for (i = 0; i < lines.length && i < 2; i++)
        text(c, lines[i], tx, y + h - 30 + i * 7.5, { size: 6, color: '#b23a34', shadow: false });
    } else if (st === 'broke') {
      text(c, 'otto has ' + rec.pts + ' of ' + nd.cost, tx, y + h - 30, { size: 6, color: '#b2601c', shadow: false });
    } else if (st === 'ready') {
      text(c, TouchUI.enabled ? 'tap the cell to learn' : '[Enter] to learn',
        tx, y + h - 30, { size: 6, color: '#3f7a4e', shadow: false });
    }

    if (this._noteT > 0) {
      c.globalAlpha = this._noteT > 1 ? 1 : this._noteT;
      lines = this._wrap(this._note, cols);
      // only the last two lines fit above the bottom edge
      for (i = 0; i < lines.length && i < 2; i++)
        text(c, lines[i], tx, y + h - 17 + i * 7.5, { size: 6, color: '#662907', shadow: false });
      c.globalAlpha = 1;
    }
  },

  // "+15% shell value" / "-1 water day" / "x2 pearl luck", derived from the
  // registry so the copy can never drift from the number.
  _buffLine: function (name, v) {
    var label = this._label(name);
    if (this.BUFF_DEF[name] === 'add') {
      if (name === 'doubleShell' || name === 'doubleOre' || name === 'doubleHarvest' ||
          name === 'seedSaveChance') {
        return Math.round(v * 100) + '% chance: ' + label;
      }
      if (v === 1 && (name === 'cropRegrow' || name === 'nightGrowth' || name === 'smeltBonus')) {
        return label;
      }
      return (v > 0 ? '+' : '') + v + ' ' + label;
    }
    if (v > 1) return '+' + Math.round((v - 1) * 100) + '% ' + label;
    if (v < 1) return '-' + Math.round((1 - v) * 100) + '% ' + label;
    return label;
  },

  LABELS: {
    shellValue: 'shell value', airMax: 'air capacity', airDrain: 'air used',
    pryWindow: 'pry window', pearlLuck: 'pearl luck', sharkCalm: 'shark interest',
    bagCap: 'bag slots', doubleShell: 'a twinned shell', vacRange: 'pickup reach',
    pickPower: 'pick power', pickTier: 'pick tier', oreValue: 'ore value',
    revealRange: 'ore sight', swingSpeed: 'swing speed',
    smeltBonus: 'one extra ingot or crystal', doubleOre: 'a doubled haul',
    maxHearts: 'heart', cannonDmg: 'shot damage', damageTaken: 'damage taken',
    reloadTime: 'reload time', critMul: 'perfect shot', iframe: 'mercy frames',
    dashCharges: 'dash charge', multishot: 'extra shots per volley',
    plantSpeed: 'planting speed', growSpeed: 'growth speed',
    produceValue: 'produce value', waterDays: 'watering day',
    seedSaveChance: 'the seed is kept', doubleHarvest: 'a doubled harvest',
    cropRegrow: 'harvested plants regrow once', nightGrowth: 'crops grow at night',
    tameChance: 'taming odds', stockYield: 'animal produce', stockGrow: 'days to grow',
    happyGain: 'happiness from feeding', happyPet: 'happiness from petting',
    hungerRate: 'hunger rate', swimSpeed: 'swim speed', penCap: 'pen berths'
  },

  _label: function (name) {
    return Object.prototype.hasOwnProperty.call(this.LABELS, name) ? this.LABELS[name] : name;
  },

  // Cached, because the node descriptions never change: a modal that re-splits
  // fifteen strings every frame is wasted budget for no reason.
  _wrap: function (str, cols) {
    var ck = cols + '|' + str;
    if (Object.prototype.hasOwnProperty.call(this._wrapC, ck)) return this._wrapC[ck];
    var words = String(str).split(' '), out = [], line = '', i, w;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      if (!line.length) { line = w; continue; }
      if (line.length + 1 + w.length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    if (line.length) out.push(line);
    this._wrapC[ck] = out;
    return out;
  },

  // One fillStyle per colour bucket, alpha varied per particle. Building a colour
  // string per particle has blown this game's frame budget before.
  _drawFx: function (c) {
    var fx = this._fx, i, f, k, any = false;
    for (i = 0; i < fx.length; i++) if (fx[i].t > 0) { any = true; break; }
    if (!any) return;
    for (k = 0; k < this.ACC.length; k++) {
      c.fillStyle = this.ACC[k];
      for (i = 0; i < fx.length; i++) {
        f = fx[i];
        if (f.t <= 0 || f.c !== k) continue;
        c.globalAlpha = f.t / f.life;
        c.fillRect(f.x, f.y, PIX * 3, PIX * 3);
      }
    }
    c.globalAlpha = 1;
  },

  // The pointer-driven panels have to draw their own arrow: Game.drawCursor hides
  // it after three idle seconds and only special-cases Shop.
  _cursor: function (c) {
    var m = Input.mouse;
    var x = Math.round(m.x * DPX) / DPX, y = Math.round(m.y * DPX) / DPX;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(x - 0.5, y - 0.5, 5, 1.5);
    c.fillRect(x - 0.5, y - 0.5, 1.5, 5);
    c.fillStyle = '#ffe6b0';
    c.fillRect(x, y, 4, 1);
    c.fillRect(x, y, 1, 4);
  },

  // A small badge so touch players (who have no [K]) can reach the panel, and so
  // an unspent point is never invisible. y 38..51 is the one free band left: the
  // HUD owns everything above 36, Craft's buff chips stop at x 390, and the touch
  // help button sits at x 454..474 -- so x 394..440 is clear of all three.
  _tagRect: function () { return { x: W - 86, y: 38, w: 46, h: 13 }; },

  _drawTag: function (c) {
    // SUPERSEDED. js/uibar.js draws a pixel-art trophy button in this corner with
    // the unspent-point count on it, and two overlapping "you have skill points"
    // widgets in the same band read as a bug. The rect and the click handler stay
    // live -- they are the touch fallback if uibar is ever absent -- but nothing
    // is painted while it IS present.
    if (typeof UIBar !== 'undefined' && UIBar && UIBar._installed) return;
    if (!this.ensure()) return;
    var n = this.points();
    if (!n && !TouchUI.enabled) return;      // keyboard players only see it when it matters
    if (!this._hostOk()) return;
    var r = this._tagRect();
    var hot = n > 0;
    rrect(c, r.x, r.y, r.w, r.h,
      hot ? 'rgba(122,74,48,0.9)' : 'rgba(50,35,23,0.78)',
      hot ? 'rgba(255,230,110,0.8)' : 'rgba(226,200,150,0.35)');
    var lbl = hot ? (TouchUI.enabled ? 'skills +' + n : '[K] +' + n)
                  : (TouchUI.enabled ? 'skills' : '[K] skills');
    text(c, lbl, r.x + r.w / 2, r.y + 3.5, { size: 6, color: hot ? '#e08a1a' : '#a89878', align: 'center' });
  },

  // ---------------------------------------------------------------- install ----
  // The five mandatory wraps, plus a scene freeze for every scene that can host
  // us. Game.globalUpdate is the only slot that runs every frame while a scene is
  // live, so it is the one that has to carry both [K] and our update.
  install: function () {
    if (this._installed) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;
    this._boot();

    var self = this;

    var gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      var live = Game.fadeDir === 0 && !Game.helpOpen &&
        !(typeof Shop !== 'undefined' && Shop.open) &&
        !(typeof Bench !== 'undefined' && Bench.open);

      if (self.open) {
        if (live) self.update(dt);
        return;
      }
      // the panel is closed: keep the particles and timers ticking, then look
      // for the open verb
      self.update(dt);
      if (!live) return;
      if (typeof Battle !== 'undefined' && Battle.active) return;
      if (typeof Craft !== 'undefined' && Craft.open) return;
      if (typeof NPCs !== 'undefined' && NPCs.open) return;
      if (typeof Stock !== 'undefined' && Stock.open) return;
      if (typeof Farm !== 'undefined' && Farm.open) return;
      if (typeof Inv !== 'undefined' && Inv.open) return;

      if (Input.p('KeyK')) { self.openUI(); return; }
      // touch has no keyboard, so the badge is the way in
      if (Input.mouse.clicked && self._visibleTag() &&
          !(typeof UIBar !== 'undefined' && UIBar && UIBar._installed) &&
          self._in(self._tagRect(), Input.mouse.x, Input.mouse.y)) {
        self.openUI();
      }
    };

    var gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.draw(c); return; }
      gHUD(c);
      self._drawTag(c);
    };

    var gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };

    var gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (self.open && !TouchUI.enabled) { self._cursor(c); return; }
      gCursor(c);
    };

    var tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return self.open ? [] : tLayout(); };

    // Freeze whatever is underneath, or Otto keeps walking and the interact spot
    // re-fires beneath the panel. Every scene that can be live gets the same wrap.
    var freeze = function (sc) {
      if (typeof sc === 'undefined' || !sc || typeof sc.update !== 'function') return;
      var u = sc.update.bind(sc);
      sc.update = function (dt) { if (self.open) return; u(dt); };
    };
    freeze(typeof WorldScene !== 'undefined' ? WorldScene : null);
    freeze(typeof HouseScene !== 'undefined' ? HouseScene : null);
    freeze(typeof DiveScene !== 'undefined' ? DiveScene : null);
    freeze(typeof Ocean !== 'undefined' ? Ocean : null);
  },

  // The dive owns the whole screen (and its own cursor), so the badge stays out of
  // it -- [K] still works there. Guarded by typeof: this module has to survive any
  // subset of the others being absent.
  _hostOk: function () {
    if (typeof Game === 'undefined' || !Game.scene) return false;
    if (typeof DiveScene !== 'undefined' && Game.scene === DiveScene) return false;
    if (typeof TitleScene !== 'undefined' && Game.scene === TitleScene) return false;
    return true;
  },

  _visibleTag: function () {
    if (!this._hostOk()) return false;
    return TouchUI.enabled || this.points() > 0;
  }
};

// Load-order-agnostic tail: Game, TouchUI and the scenes are all script-scope
// consts in files that may load after this one, so installing at file scope is
// only safe once they exist. DOMContentLoaded fires after every classic script.
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Skills.install();
else document.addEventListener('DOMContentLoaded', function () { Skills.install(); }, { once: true });
