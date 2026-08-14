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
  ACC: ['#5ad2f0', '#c9d4dc', '#e8434c', '#a0f2b4', '#ffe66e'],
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
  WX: 40, WY: 24, WW: 400, WH: 222,
  TX: 46, TY: 92, TW: 200, TH: 142,     // the tree canvas (lower: the header grew a rule and a subtitle)
  IX: 258, IW: 174,                     // the info column
  NS: 24,                               // node box, logical units
  ROW: 36,                              // tier spacing
  // Courier is monospace at 0.6em advance, so wrapping by character count is
  // exact and needs no measuring: (IW - 12 padding) / (6px * 0.6) = 37.
  COLS: 37,
  FX_MAX: 24,

  // ----------------------------------------------------------------- state ----
  open: false,
  tab: 0,
  sel: 0,                 // index into TREES[prof] for the current tab
  hover: '',              // node key under the pointer, '' for none
  time: 0,
  _note: '', _noteT: 0,
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
    this._applyHearts();

    this._say('learned ' + nd.name);
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
  list: function () { return this.TREES[this.prof()]; },

  _closeRect: function () { return { x: this.WX + this.WW - 26, y: this.WY + 3, w: 22, h: 18 }; },

  _tabRect: function (i) {
    var inner = this.WW - 16, gap = 2;
    var w = (inner - gap * 4) / 5;
    return { x: this.WX + 8 + i * (w + gap), y: this.WY + 30, w: w, h: 16 };
  },

  // A node's box. Rows are tiers; a row of k nodes is spread evenly across TW so
  // the branches read as branches without a hand-authored x per node.
  _nodeRect: function (nd) {
    var s = this.NS;
    var cx = this.TX + this.TW * (nd.col + 1) / (nd.wide + 1);
    var cy = this.TY + 20 + nd.tier * this.ROW;
    return { x: cx - s / 2, y: cy - s / 2, w: s, h: s };
  },

  _in: function (r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },

  _hit: function (mx, my) {
    var list = this.list(), i, nd, r;
    for (i = 0; i < list.length; i++) {
      nd = list[i];
      r = this._nodeRect(nd);
      // a couple of units of slop: 24-unit boxes on a 480-wide screen are small
      // under a finger
      if (mx >= r.x - 3 && mx <= r.x + r.w + 3 && my >= r.y - 3 && my <= r.y + r.h + 3) return i;
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
    this.sel = 0;
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

    for (i = 0; i < 5; i++) if (Input.p('Digit' + (i + 1))) { this.setTab(i); return; }

    if (Input.p('ArrowLeft')) this._move(-1, 0);
    else if (Input.p('ArrowRight')) this._move(1, 0);
    else if (Input.p('ArrowUp')) this._move(0, -1);
    else if (Input.p('ArrowDown')) this._move(0, 1);

    if (Input.wheelDelta) {
      // the wheel walks tabs: there is nothing to scroll, the tree always fits
      var d = Input.wheelDelta > 0 ? 1 : -1;
      var t = this.tab + d;
      if (t < 0) t = 4;
      if (t > 4) t = 0;
      this.setTab(t);
    }

    if (Input.p('Enter')) {
      var cur = this.list()[this.sel];
      if (cur) this.buy(cur.key);
      return;
    }

    // ---- pointer
    var idx = this._hit(m.x, m.y);
    this.hover = idx >= 0 ? this.list()[idx].key : '';

    if (m.clicked) {
      // most specific first, and return after the first hit so one click can
      // never fire two actions
      if (this._in(this._closeRect(), m.x, m.y)) { this.close(); return; }
      for (i = 0; i < 5; i++) {
        if (this._in(this._tabRect(i), m.x, m.y)) { this.setTab(i); return; }
      }
      if (idx >= 0) { this.sel = idx; this.buy(this.list()[idx].key); return; }
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
    var W_ = W, H_ = H;

    // one flat rect, not a gradient: this runs over every device pixel
    c.fillStyle = 'rgba(10,14,20,0.62)';
    c.fillRect(0, 0, W_, H_);

    uiPanel(c, this.WX, this.WY, this.WW, this.WH, 0.95, false);

    var prof = this.prof(), r = G.skills[prof], acc = this.ACC[this.tab];

    text(c, "OTTO'S TRADES", this.WX + 10, this.WY + 5, { size: 9, color: '#e9c07a' });
    text(c, 'five things worth getting good at', this.WX + 10, this.WY + 16,
      { size: 6, color: '#a8895e' });
    var total = this.points();
    if (total > 0) {
      // an unspent point is the reason you opened this, so it gets a plate
      var pt = total + (total > 1 ? ' points to spend' : ' point to spend');
      var pw = textWidth(c, pt, 7) + 12;
      uiPanel(c, this.WX + this.WW - 34 - pw, this.WY + 4, pw, 15, 0.96, true);
      text(c, pt, this.WX + this.WW - 34 - pw / 2, this.WY + 7,
        { size: 7, color: '#4a3020', align: 'center', shadow: false });
    }
    uiRule(c, this.WX + 8, this.WY + 25, this.WW - 16, false);

    // ---- close: the frame in miniature, not a bare x
    var cr = this._closeRect();
    var mo = !TouchUI.enabled && this._in(cr, Input.mouse.x, Input.mouse.y);
    uiClose(c, cr, mo, false);

    this._drawTabs(c);
    this._drawBar(c, r, acc);
    this._drawTree(c, prof);
    this._drawInfo(c, prof, r);
    this._drawFx(c);

    text(c, TouchUI.enabled ? 'tap a node to learn it  --  tap x to close'
                            : '[1-5] tab  [arrows] move  [Enter] learn  [Esc] close',
      this.WX + this.WW / 2, this.WY + this.WH - 11, { size: 6, color: '#8a9484', align: 'center' });
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
        { size: 6, color: on ? '#7a5232' : '#5f4526', align: 'right', shadow: false });
      if (pts > 0) {
        // an unmissable dot for "you have something to spend here"
        c.fillStyle = '#ffe66e';
        c.fillRect(r.x + 2.5, r.y + 2.5, 2, 2);
      }
    }
  },

  // Three rows in the 24 units between the tabs (ending at WY+33) and the tree
  // canvas (starting at TY): label at +34, bar at +44, caption at +51, whose
  // 6-unit glyph box ends exactly one unit above TY.
  _drawBar: function (c, r, acc) {
    var x = this.WX + 10, y = this.WY + 48, w = this.WW - 20;
    var need = this.need(r.lv);
    var capped = r.lv >= this.MAX_LV;
    var frac = capped ? 1 : (need > 0 ? r.xp / need : 0);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;

    text(c, this.prof() + '  lv ' + r.lv, x, y, { size: 7, color: '#f6e8c9' });
    var right = capped ? 'mastered' : (r.xp + ' / ' + need + ' xp');
    text(c, right, x + w, y, { size: 7, color: '#a89878', align: 'right' });

    // a bevelled trough with a lit fill, not a flat rectangle in a hairline box
    var by = y + 10, bh = 6;
    c.globalAlpha = capped ? 0.85 : 1;
    uiMeter(c, x, by, w, bh, frac, acc, false);
    c.globalAlpha = 1;

    var pts = r.pts;
    text(c, this.owned(this.prof()) + ' / ' + this.list().length + ' learned',
      x, by + 7, { size: 6, color: '#8a9484' });
    // (the unspent-point count is on its own plate in the header now; it was
    // printed twice, once there and once here, three lines apart)
    if (pts > 0) {
      text(c, 'a node with a lit ring is one you can afford',
        x + w, by + 7, { size: 6, color: '#8a7a5a', align: 'right', shadow: false });
    }
  },

  _drawTree: function (c, prof) {
    var list = this.TREES[prof], i, j, nd, pr, a, b;

    // ---- links first, so nodes sit on top of them. Two passes so the lit links
    // never hide behind a dim one, and each pass sets its colour exactly once.
    c.lineWidth = PIX * 2;
    for (j = 0; j < 2; j++) {
      c.strokeStyle = j ? 'rgba(232,169,60,0.9)' : 'rgba(122,74,48,0.85)';
      c.beginPath();
      for (i = 0; i < list.length; i++) {
        nd = list[i];
        a = this._nodeRect(nd);
        for (var q = 0; q < nd.req.length; q++) {
          pr = this.node(nd.req[q]);
          if (!pr) continue;
          var live = this._own[nd.key] && this._own[pr.key] ? 1 : 0;
          if (live !== j) continue;
          b = this._nodeRect(pr);
          c.moveTo(b.x + b.w / 2, b.y + b.h);
          c.lineTo(a.x + a.w / 2, a.y);
        }
      }
      c.stroke();
    }

    var selKey = list[this.sel] ? list[this.sel].key : '';
    for (i = 0; i < list.length; i++) this._drawNode(c, list[i], list[i].key === selKey);
  },

  _drawNode: function (c, nd, isSel) {
    var r = this._nodeRect(nd);
    var st = this.state(nd.key);
    var fill, edge, alpha;

    if (st === 'owned') { fill = 'rgba(122,74,48,0.96)'; edge = '#e8a93c'; alpha = 1; }
    else if (st === 'ready') { fill = 'rgba(109,69,38,0.9)'; edge = '#ffe66e'; alpha = 0.95; }
    else if (st === 'broke') { fill = 'rgba(90,58,30,0.9)'; edge = '#a4805a'; alpha = 0.55; }
    else { fill = 'rgba(50,35,23,0.92)'; edge = '#7a5232'; alpha = 0.3; }

    rrect(c, r.x, r.y, r.w, r.h, fill, edge);

    // a keystone gets a cyan corner pip so it reads as different at a glance
    if (nd.star) {
      c.fillStyle = '#5ad2f0';
      c.globalAlpha = st === 'locked' ? 0.45 : 1;
      c.fillRect(r.x + r.w - 4.5, r.y + 1.5, 3, 3);
      c.globalAlpha = 1;
    }

    // icon: snapped to the device grid so the pixel art stays crisp
    var cx = Math.round((r.x + r.w / 2) * DPX) / DPX;
    var cy = r.y + r.h / 2;
    var box = 15;
    c.globalAlpha = alpha;
    var img = typeof ASSETS !== 'undefined' ? ASSETS[nd.art] : null;
    if (img && img.width) {
      var w = img.width >= img.height ? box : box * img.width / img.height;
      var h = img.width >= img.height ? box * img.height / img.width : box;
      drawAC(c, nd.art, cx, cy, w, h);
    } else {
      // missing art is silent in drawA, so ship a glyph. One fillStyle each.
      c.fillStyle = this.ACC[nd.profIdx];
      c.beginPath();
      c.moveTo(cx, cy - 6); c.lineTo(cx + 6, cy); c.lineTo(cx, cy + 6); c.lineTo(cx - 6, cy);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(cx - 2, cy - 2, 4, 4);
    }
    c.globalAlpha = 1;

    // cost pip, bottom-left, only while it still costs something
    if (st !== 'owned') {
      c.fillStyle = st === 'ready' ? '#ffe66e' : '#7a5232';
      for (var i = 0; i < nd.cost; i++) c.fillRect(r.x + 2 + i * 3.5, r.y + r.h - 4, 2.5, 2.5);
    } else {
      c.fillStyle = '#e8a93c';
      c.fillRect(r.x + 2, r.y + r.h - 4, r.w - 4, PIX * 2);
    }

    // selection / hover ring
    var ring = isSel || this.hover === nd.key;
    if (ring) {
      c.strokeStyle = this.hover === nd.key ? '#ffe66e' : '#f6e8c9';
      c.lineWidth = PIX * 2;
      c.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }
  },

  _drawInfo: function (c, prof, rec) {
    var x = this.IX, y = this.TY, w = this.IW, h = this.TH;
    rrect(c, x, y, w, h, 'rgba(0,0,0,0.32)', 'rgba(226,200,150,0.22)');

    var key = this.hover || (this.list()[this.sel] ? this.list()[this.sel].key : '');
    var nd = this.node(key);
    var tx = x + 6, ty = y + 6, cols = this.COLS, i, lines;

    if (!nd) {
      text(c, prof, tx, ty, { size: 7, color: '#ffe6b0' });
      lines = this._wrap(this.BLURB[this.tab], cols);
      for (i = 0; i < lines.length; i++)
        text(c, lines[i], tx, ty + 12 + i * 8, { size: 6, color: '#d8ccb4' });
      return;
    }

    var st = this.state(key);
    text(c, nd.name, tx, ty, { size: 7, color: nd.star ? '#5ad2f0' : '#ffe6b0' });

    var tag = st === 'owned' ? 'learned'
      : st === 'locked' ? 'locked'
      : nd.cost + (nd.cost > 1 ? ' points' : ' point');
    var tagCol = st === 'owned' ? '#a0f2b4' : st === 'ready' ? '#ffe66e' : st === 'broke' ? '#e8a93c' : '#8a9484';
    text(c, tag, x + w - 6, ty, { size: 6, color: tagCol, align: 'right' });

    var ly = ty + 11;
    if (nd.star) {
      text(c, 'keystone', tx, ly, { size: 6, color: '#5ad2f0' });
      ly += 8;
    }

    lines = this._wrap(nd.desc, cols);
    for (i = 0; i < lines.length; i++) {
      text(c, lines[i], tx, ly, { size: 6, color: '#d8ccb4' });
      ly += 8;
    }

    // the numbers, spelled out, so nobody has to trust the prose
    ly += 2;
    var b = nd.buff, name;
    if (b) {
      for (name in b) {
        if (!Object.prototype.hasOwnProperty.call(b, name)) continue;
        if (ly > y + h - 34) break;   // never encroach on the state line below
        text(c, this._buffLine(name, b[name]), tx, ly, { size: 6, color: '#a4805a' });
        ly += 7.5;
      }
    }

    if (st === 'locked') {
      text(c, 'needs ' + this._reqNames(nd), tx, y + h - 24, { size: 6, color: '#e8434c' });
    } else if (st === 'broke') {
      text(c, 'otto has ' + rec.pts + ' of ' + nd.cost, tx, y + h - 24, { size: 6, color: '#e8a93c' });
    } else if (st === 'ready') {
      text(c, TouchUI.enabled ? 'tap the node to learn' : '[Enter] to learn',
        tx, y + h - 24, { size: 6, color: '#a0f2b4' });
    }

    if (this._noteT > 0) {
      c.globalAlpha = this._noteT > 1 ? 1 : this._noteT;
      lines = this._wrap(this._note, cols);
      // only the last two lines fit above the bottom edge
      for (i = 0; i < lines.length && i < 2; i++)
        text(c, lines[i], tx, y + h - 16 + i * 7.5, { size: 6, color: '#ffe66e' });
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
    text(c, lbl, r.x + r.w / 2, r.y + 3.5, { size: 6, color: hot ? '#ffe66e' : '#a89878', align: 'center' });
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
