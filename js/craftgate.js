// ---- craftgate: recipe unlocks, craftable tables, and the body menu ----------
//
// Three things live in this file, and they are one feature: crafting stops being
// ambient and starts being something you EARN, BUILD and CARRY.
//
//   1. UNLOCKS. Every recipe Inv knows maps to a skill-tree node in RECIPE_NODE.
//      Until that node is learned the recipe is not merely greyed out -- it is a
//      silhouette ('? ? ?') whose only copy is "learn <node> to unlock", and it
//      cannot be crafted even if something calls Inv.craft on it directly. Three
//      starters are deliberately open from the first frame (planks, a crude
//      workbench, a stone pick), because everything else is downstream of them.
//
//   2. THE TABLES THEMSELVES ARE CRAFTED AND PLACED. Inv.SITES ships four
//      benches sitting on the planks for free; this file empties them. You make a
//      Crude Workbench in your paws, then PLACE it: a ghost follows Otto along the
//      dock, a real placement mode with its own validity rules, and on confirm the
//      table becomes an interaction spot. The bench then opens the BUILD tab, and
//      the sawmill / furnace / smithy each cost materials only the previous tier
//      can make -- planks and rope by hand, grit from the mill, iron from the
//      furnace, so the chain enforces its own order without a single level check.
//
//   3. THE BODY MENU. [C] anywhere on land: a compact 2x2 panel, deliberately
//      unlike the four big station screens, offering only the handful of recipes
//      flagged hand-craftable. No table required, which is the whole point -- a
//      player with nothing has somewhere to start.
//
// EVERYTHING IS AN EXTENSION. Inv and Skills are read and wrapped through their
// published API (have/spend/add/craft/recipesAt/locked/missing, Skills.has/node/
// gain); neither file is modified. With Inv absent the hand recipes fall back to
// flat G.storage; with Skills absent every node reads as learned. The feature
// degrades to "a smaller crafting menu", never to an exception.
//
// PERSISTENCE. G.placed is [{ key, x }] and is NOT one of the five deep-merged
// keys, so ensure() re-normalises the whole array (and only when the reference
// changed, the way Inv does) on every public entry point.
'use strict';

const Forge = {
  // ==== knobs ===============================================================
  // A locked recipe is listed as a silhouette by default: hiding it entirely is
  // tidier but tells a player nothing about what learning a node would buy them.
  HIDE_LOCKED: false,
  // Crafting XP is paid from onMade, routed to the profession that owns the
  // recipe's node. Set false if a wiring layer would rather pay it itself.
  PAY_XP: true,
  // Set false BEFORE DOMContentLoaded if the wiring layer concats Forge.spots()
  // and calls Forge.drawPlaced itself (the Inv.selfWire arrangement).
  selfWire: true,

  // Deck rules. The world's single [E] is a nearest-within-22 search, so a table
  // needs MORE than 22 units of clearance or it would shadow (or be shadowed by)
  // whatever it landed next to. 24 is the smallest honest number.
  MIN_GAP: 24,
  PLACE_MIN: 16,        // WorldScene's own walk clamp -- Otto cannot stand left of this
  PLACE_PAD: 12,        // ... and stops this far short of endX()
  PLACE_MAX: 900,       // sanity clamp for a save from a longer dock
  MAX_PER: 1,           // one of each table: a second bench shares the first one's queue
  MAX_PLACED: 8,

  // ==== the panel ===========================================================
  // Deliberately small. The station screens own the 40..440 x 22..248 box; this
  // one borrows the farm picker's cosy footprint instead so the two never read as
  // the same screen.
  WX: 118, WY: 48, WW: 244, WH: 172,
  CELL: 22, CGAP: 3,          // the 2x2 grid
  ROW_H: 15, ROW_VIS: 7,
  FX_MAX: 18,

  PAL: {
    ink: '#f6e8c9', dim: '#a89878', hi: '#ffe66e', warm: '#c9a271',
    good: '#a0f2b4', bad: '#ff6a7a', wood: '#8a6434',
  },

  // ==== recipe -> skill node ================================================
  // The gate. A recipe whose node is null is open from the first frame; a recipe
  // that is not in this table at all is also open, so a module that adds a recipe
  // later is never silently invisible.
  //
  // Nodes are picked for meaning, not for balance: the trees already say what
  // Otto has learned to respect, and several recipes can hang off one node.
  RECIPE_NODE: {
    // -- hand (this file) --------------------------------------------------
    h_plank: null,          // the three starters, and nothing else, are free
    h_pick: null,
    h_rope: null,
    h_torch: null,

    // -- workbench ---------------------------------------------------------
    b_pot: 't_feed',        // trapping is animal husbandry by other means
    b_netbag: 'c_sack',
    b_basket: 'a_price',
    b_bucket: 'a_soil',
    b_hoe: 'a_hoe',
    b_can: 'a_mulch',
    b_spade: 'm_arm',
    b_rake: 'a_soil',
    b_sickle: 'a_price',
    b_gloves: 't_calm',
    b_lamp: 'm_seam',       // the seam reader's node art IS the torch

    // -- furnace -----------------------------------------------------------
    f_kiln: 'm_smelt',
    f_ingot: 'm_smelt',
    f_melt: 'm_mag',
    f_glass: 'm_hone',
    f_lens: 'm_mother',

    // -- sawmill -----------------------------------------------------------
    m_plank: null,          // STARTER: boards are the floor of every other chain
    m_grit: 'm_arm',
    m_beam: 'm_hone',
    m_board: 'm_tire',

    // -- smithy ------------------------------------------------------------
    a_nail: 'm_smelt',
    a_ball: 'f_pow',
    a_pick2: null,          // STARTER: no pick, no ore, no anything
    a_pick3: 'm_hone',
    a_pick4: 'm_mother',
    a_cutlass: 'f_crit',
    a_flint: 'f_load',
    a_bomb: 'f_pow',
    a_helm: 'c_lung',
    a_vest: 'f_guard',
    a_cannon: 'f_broad',
  },

  // Which tree pays for a nodeless recipe. Planks and picks are quarry work.
  DEFAULT_XP_PROF: 'mining',

  // ==== two new materials ===================================================
  // Pushed into Inv.DEF at install so the bag, the hotbar shuttle and every cost
  // line know their names. Rope has no art in the manifest, so Inv would fall
  // back to its parchment tag -- _ownIcon draws a real coil instead, through a
  // wrap on Inv.drawIcon so the bag gets it too.
  ITEM_DEF: {
    rope:  { name: 'Bark Rope', value: 5, desc: 'Bark stripped in long strips and twisted damp.' },
    torch: { name: 'Driftwood Torch', art: 'g_torch', value: 8, desc: 'Rag, tar, and a stick. Burns long enough to work by.' },
  },

  // ==== hand recipes ========================================================
  // station 'hand' is not one of Inv.STATIONS, which is exactly why this works:
  // _buildIndex files them in _byKey (so Inv.craft, Inv.missing and Inv.recipe
  // all work on them) but NOT in _byStation, so they can never appear on a bench.
  //
  // time MUST stay 0. Inv._tickJobs walks Inv.STATIONS, so a queued job with
  // st:'hand' would never tick a second -- and a 2x2 in your paws should be
  // instant anyway.
  HAND: [
    {
      key: 'h_plank', name: 'Split Planks', station: 'hand', time: 0, xp: 2, lvl: 1,
      cost: { driftwood: 2 }, out: { key: 'plank', n: 1 }, art: 'res_plank',
      desc: 'Knee, knife and patience. One board, and a splinter.',
    },
    {
      key: 'h_rope', name: 'Bark Rope', station: 'hand', time: 0, xp: 2, lvl: 1,
      cost: { driftwood: 2 }, out: { key: 'rope', n: 2 }, art: null,
      desc: 'Strip the bark long, twist it damp, let it dry tight.',
    },
    {
      key: 'h_torch', name: 'Driftwood Torch', station: 'hand', time: 0, xp: 3, lvl: 1,
      cost: { driftwood: 1, rope: 1 }, out: { key: 'torch', n: 2 }, art: 'g_torch',
      desc: 'Two of them, and the furnace has something to light it.',
    },
    {
      key: 'h_pick', name: 'Crude Stone Pick', station: 'hand', time: 0, xp: 8, lvl: 1,
      cost: { driftwood: 2, stone: 3, rope: 1 }, out: { key: 'pick_stone', n: 1 }, art: null,
      desc: 'Lashed, not nailed. It still bites coal.',
    },
  ],

  // ==== the tables ==========================================================
  // `hand: true` puts it in the body menu; everything else needs `need` placed
  // first. The MATERIALS are the real gate on order: rope is hand work, sand only
  // comes off the mill, ingots only out of the furnace, beams only off the mill.
  // So bench -> mill -> furnace -> smithy falls out of the costs, with no levels.
  TABLES: [
    {
      key: 'bench', art: 'tbl_bench', name: 'Crude Workbench', short: 'Workbench',
      w: 19, hand: true, need: null, cost: { plank: 4, driftwood: 2 }, xp: 10,
      desc: 'Four boards on a trestle. Everything else starts here.',
    },
    {
      key: 'mill', art: 'tbl_mill', name: 'Sawmill', short: 'Sawmill',
      w: 30, hand: false, need: 'bench', cost: { plank: 6, stone: 4, rope: 2 }, xp: 14,
      desc: 'A rope drive and a stone wheel. Logs in, boards out.',
    },
    {
      key: 'forge', art: 'tbl_forge', name: 'Furnace', short: 'Furnace',
      w: 21, hand: false, need: 'bench', cost: { stone: 12, sand: 6, torch: 2 }, xp: 18,
      desc: 'Stacked stone, lined with grit off the sawmill.',
    },
    {
      key: 'anvil', art: 'tbl_anvil', name: 'Smithy', short: 'Smithy',
      w: 23, hand: false, need: 'bench', cost: { ingot: 4, beam: 1, stone: 6 }, xp: 24,
      desc: 'Anvil and tongs, out of iron the furnace made.',
    },
  ],

  // ==== state ===============================================================
  open: false,
  tab: 0,               // 0 MAKE (hand), 1 BUILD (tables)
  sel: 0,
  scroll: 0,
  placing: null,        // { key, moveIdx, x, why } -- a mode, not a modal
  note: '',
  noteT: 0,
  time: 0,

  _installed: false,
  _booted: false,
  _nl: null,            // the G.placed array we last normalised
  _stamp: -1,
  _wasDown: false,
  _hinted: false,
  _rowCache: null,
  _fx: null,
  // gate cache: the filtered recipe lists, invalidated by an epoch counter
  _gepoch: 0,
  _gobj: null,
  _gcache: null,
  _silc: null,

  // ==== module handles ======================================================
  // Everything crossing a boundary goes through these, so one absent module is
  // "that half of the feature is missing" rather than a thrown reference.
  _I: function () { return typeof Inv !== 'undefined' && Inv ? Inv : null; },
  _S: function () { return typeof Skills !== 'undefined' && Skills ? Skills : null; },

  _boot: function () {
    if (this._booted) return;
    this._booted = true;
    this._gcache = {};
    this._silc = {};
    this._rowCache = {};
    var fx = [], i;
    for (i = 0; i < this.FX_MAX; i++) fx.push({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, c: 0 });
    this._fx = fx;
  },

  // ==== persistence =========================================================
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    if (!this._booted) this._boot();

    if (!Array.isArray(G.placed)) { G.placed = []; this._nl = null; }
    // Deep pass ONLY when this is not the array we already cleaned: Game.load
    // hands back a brand new reference and every write in here is well formed,
    // so the steady state is a single reference compare.
    if (G.placed !== this._nl) {
      var src = G.placed, keep = [], count = {}, i, e, k, x;
      for (i = 0; i < src.length && keep.length < this.MAX_PLACED; i++) {
        e = src[i];
        if (!e || typeof e !== 'object') continue;
        k = String(e.key);
        if (!this.table(k)) continue;                       // a table this build dropped
        x = Number(e.x);
        if (!isFinite(x)) continue;
        count[k] = (count[k] || 0) + 1;
        if (count[k] > this.MAX_PER) continue;
        x = Math.round(clamp(x, this.PLACE_MIN, this.PLACE_MAX));
        keep.push({ key: k, x: x });
      }
      G.placed = keep;
      this._nl = keep;
      this._rowCache = {};
    }
    return true;
  },

  // ==== tables and placements ==============================================
  table: function (key) {
    for (var i = 0; i < this.TABLES.length; i++) if (this.TABLES[i].key === key) return this.TABLES[i];
    return null;
  },

  placed: function () { return this.ensure() ? G.placed : []; },

  countPlaced: function (key) {
    if (!this.ensure()) return 0;
    var n = 0, a = G.placed, i;
    for (i = 0; i < a.length; i++) if (a[i].key === key) n++;
    return n;
  },

  hasPlaced: function (key) { return this.countPlaced(key) > 0; },

  // ==== the gate ============================================================
  nodeFor: function (recipeKey) {
    var m = this.RECIPE_NODE;
    if (!recipeKey || !Object.prototype.hasOwnProperty.call(m, recipeKey)) return '';
    return m[recipeKey] || '';
  },

  nodeName: function (nodeKey) {
    if (!nodeKey) return '';
    var S = this._S();
    var nd = S && S.node ? S.node(nodeKey) : null;
    return nd && nd.name ? nd.name : nodeKey;
  },

  // The one question the rest of the file asks. No Skills module, or no node, and
  // the answer is always yes -- an absent skill tree must not lock the game.
  unlocked: function (recipeKey) {
    var node = this.nodeFor(recipeKey);
    if (!node) return true;
    var S = this._S();
    if (!S || typeof S.has !== 'function') return true;
    return !!S.has(node);
  },

  lockLine: function (recipeKey) {
    var node = this.nodeFor(recipeKey);
    if (!node) return null;
    if (this.unlocked(recipeKey)) return null;
    return 'learn ' + this.nodeName(node) + ' to unlock';
  },

  // Ownership only moves on Skills.buy or a save load, so the filtered lists are
  // cached against this counter instead of being rebuilt per frame.
  _epoch: function () {
    var so = (typeof G !== 'undefined' && G) ? G.skills : null;
    if (so !== this._gobj) { this._gobj = so; this._gepoch++; }
    return this._gepoch;
  },

  // A locked recipe, masked. The clone keeps its key, so Inv.locked / Inv.missing
  // still resolve the real thing (Inv.craft re-resolves by key, which is why a
  // clone can never be crafted by accident).
  _silhouette: function (r) {
    var s = this._silc[r.key];
    if (s && s.__src === r) return s;
    s = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) s[k] = r[k];
    s.name = '? ? ?';
    s.art = null;
    s.cost = {};                 // a silhouette does not hand out its shopping list
    s.money = 0;
    s.desc = (this.lockLine(r.key) || 'not yet') + '.';
    s.__sil = true;
    s.__src = r;
    this._silc[r.key] = s;
    return s;
  },

  _gateList: function (stKey, list) {
    var ep = this._epoch();
    var c = this._gcache[stKey];
    if (c && c.ep === ep && c.src === list) return c.out;
    var out = [], i, r;
    for (i = 0; i < list.length; i++) {
      r = list[i];
      if (this.unlocked(r.key)) { out.push(r); continue; }
      if (this.HIDE_LOCKED) continue;
      out.push(this._silhouette(r));
    }
    this._gcache[stKey] = { ep: ep, src: list, out: out };
    return out;
  },

  // ==== materials ===========================================================
  // Inv.have / Inv.spend walk bag -> hotbar -> flat storage in the same order and
  // are guaranteed symmetric, so anything that reads as held can be spent. With
  // no Inv at all, flat G.storage is the whole world.
  have: function (key) {
    var I = this._I();
    if (I && I.have) return I.have(key);
    if (typeof G !== 'undefined' && G && G.storage) {
      var n = Number(G.storage[key]);
      return isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return 0;
  },

  spend: function (key, n) {
    var I = this._I();
    if (I && I.spend) return I.spend(key, n);
    if (this.have(key) < n) return false;
    G.storage[key] = (G.storage[key] || 0) - n;
    return true;
  },

  give: function (key, n) {
    var I = this._I();
    if (I && I.add) return I.add(key, n);
    if (typeof G !== 'undefined' && G && G.storage) {
      G.storage[key] = (G.storage[key] || 0) + n;
      return 0;
    }
    return n;
  },

  name: function (key) {
    var I = this._I();
    if (I && I.name) return I.name(key);
    if (this.ITEM_DEF[key]) return this.ITEM_DEF[key].name;
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) return ITEMS[key].name;
    return key;
  },

  // Why this cost cannot be paid, as player-facing copy, or null.
  _costWhy: function (cost) {
    var k, need;
    for (k in cost) {
      if (!Object.prototype.hasOwnProperty.call(cost, k)) continue;
      need = cost[k] - this.have(k);
      if (need > 0) return 'need ' + need + ' more ' + String(this.name(k)).toLowerCase();
    }
    return null;
  },

  // ==== hand crafting =======================================================
  handRecipe: function (key) {
    for (var i = 0; i < this.HAND.length; i++) if (this.HAND[i].key === key) return this.HAND[i];
    return null;
  },

  handWhy: function (r) {
    if (!r) return 'nothing to make';
    var lock = this.lockLine(r.key);
    if (lock) return lock;
    var I = this._I();
    // With Inv present let IT answer: it also knows about bag room, sand dollars
    // and 'otto already has one', and it is the code that will do the spending.
    if (I && I.missing && I.recipe && I.recipe(r.key)) return I.missing(r.key);
    return this._costWhy(r.cost);
  },

  makeHand: function (key) {
    if (!this.ensure()) return false;
    var r = this.handRecipe(key);
    if (!r) return false;
    var why = this.handWhy(r);
    if (why) { this._say(why); SND.alarm(); return false; }

    var I = this._I();
    if (I && I.craft && I.recipe && I.recipe(r.key)) {
      // The registered path: Inv spends, delivers, toasts, pays xp and saves.
      if (!I.craft(r.key)) return false;
    } else {
      // Standalone fallback: same contract, flat storage.
      var k;
      for (k in r.cost) {
        if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
        this.spend(k, r.cost[k]);
      }
      if (r.out) this.give(r.out.key, r.out.n);
      this._payXp(r.key, r.xp);
      Game.toast((r.out && r.out.n > 1 ? r.out.n + 'x ' : '') + this.name(r.out ? r.out.key : r.key) + ' -- done');
      Game.save();
    }
    this._say(r.name + ' -- made');
    SND.pop(1.1);
    this._burst(this._resultRect(), 7);
    this._rowCache = {};
    return true;
  },

  _payXp: function (recipeKey, amount) {
    if (!this.PAY_XP || !amount) return;
    var S = this._S();
    if (!S || typeof S.gain !== 'function') return;
    var node = this.nodeFor(recipeKey);
    var nd = node && S.node ? S.node(node) : null;
    S.gain(nd && nd.prof ? nd.prof : this.DEFAULT_XP_PROF, amount);
  },

  // ==== placement ===========================================================
  // Not a modal: Otto keeps walking, because "put it where you are standing" is
  // the only placement rule a one-key dock can afford. The world scene's [E] is
  // eaten from inside its own update wrap, which is the only place early enough
  // to beat the spot search to the press.
  placeWhy: function (x, key, moveIdx) {
    if (typeof WorldScene === 'undefined' || Game.scene !== WorldScene) return 'out on the planks only';
    var maxX = (WorldScene.endX ? WorldScene.endX() : 430) - this.PLACE_PAD;
    if (x < this.PLACE_MIN) return 'not out over the water';
    if (x > maxX) return 'the planks end here';
    var spots = [], i, s, d;
    try { spots = WorldScene.spots() || []; } catch (e) { spots = []; }
    for (i = 0; i < spots.length; i++) {
      s = spots[i];
      if (!s || typeof s.x !== 'number') continue;
      d = Math.abs(s.x - x);
      if (d >= this.MIN_GAP) continue;
      return 'too close to ' + this._shortLabel(s.label);
    }
    return null;
  },

  _shortLabel: function (label) {
    var s = String(label || 'something');
    var cut = s.indexOf('  ');
    if (cut > 0) s = s.slice(0, cut);
    cut = s.indexOf(' -- ');
    if (cut > 0) s = s.slice(0, cut);
    return s.toLowerCase();
  },

  // moveIdx >= 0 relocates an existing table for free instead of building one.
  beginPlace: function (key, moveIdx) {
    if (!this.ensure()) return false;
    var t = this.table(key);
    if (!t) return false;
    var moving = typeof moveIdx === 'number' && moveIdx >= 0;
    if (typeof WorldScene === 'undefined' || Game.scene !== WorldScene) {
      Game.toast('Tables go out on the planks -- try it outside.');
      SND.blip();
      return false;
    }
    if (!moving) {
      var why = this.buildWhy(t);
      if (why) { this._say(why); SND.alarm(); return false; }
    }
    if (this.open) this.close(true);
    this.placing = { key: key, moveIdx: moving ? moveIdx : -1, x: Math.round(WorldScene.px), why: null };
    this._track();
    SND.blip();
    Game.toast(TouchUI.enabled
      ? (moving ? 'Walk it somewhere better, then tap the paw.' : 'Walk to a clear spot and tap the paw to set it down.')
      : (moving ? 'Walk it somewhere better, then [E] to set it down.' : 'Walk to a clear spot and press [E] to set it down.'));
    return true;
  },

  cancelPlace: function (quiet) {
    if (!this.placing) return;
    this.placing = null;
    if (!quiet) { SND.click(); Game.toast('Left it in your paws.'); }
  },

  _track: function () {
    var p = this.placing;
    if (!p || typeof WorldScene === 'undefined') return;
    // The ghost simply IS Otto's position, snapped to a whole unit so the sprite
    // lands on the texel grid and does not shimmer as he walks.
    p.x = Math.round(clamp(WorldScene.px, this.PLACE_MIN,
      (WorldScene.endX ? WorldScene.endX() : 430) - this.PLACE_PAD));
    p.why = this.placeWhy(p.x, p.key, p.moveIdx);
  },

  confirmPlace: function () {
    if (!this.ensure() || !this.placing) return false;
    var p = this.placing, t = this.table(p.key);
    if (!t) { this.placing = null; return false; }
    this._track();
    if (p.why) { Game.toast(p.why.charAt(0).toUpperCase() + p.why.slice(1) + '.'); SND.alarm(); return false; }

    if (p.moveIdx >= 0) {
      var e = G.placed[p.moveIdx];
      if (e) e.x = p.x;
      Game.toast(t.short + ' moved.');
    } else {
      var why = this.buildWhy(t);
      if (why) { Game.toast(why.charAt(0).toUpperCase() + why.slice(1) + '.'); SND.alarm(); return false; }
      var k;
      for (k in t.cost) {
        if (!Object.prototype.hasOwnProperty.call(t.cost, k)) continue;
        this.spend(k, t.cost[k]);
      }
      G.placed.push({ key: t.key, x: p.x });
      this._payXp('', t.xp);        // no node: table work pays the default tree
      Game.toast(t.name + ' -- built and set down.');
      if (t.key === 'bench') Game.toast('The bench opens up bigger builds -- press [C].');
    }
    this.placing = null;
    this._rowCache = {};
    if (SND.clank) SND.clank(); else SND.clink();
    if (SND.thump) SND.thump(0.5);
    Game.save();
    return true;
  },

  // Why this table cannot be built right now, or null.
  buildWhy: function (t) {
    if (!t) return 'nothing to build';
    if (t.need && !this.hasPlaced(t.need)) {
      var nt = this.table(t.need);
      return 'build a ' + String(nt ? nt.short : t.need).toLowerCase() + ' first';
    }
    if (this.countPlaced(t.key) >= this.MAX_PER) return 'otto already has one';
    return this._costWhy(t.cost);
  },

  // ==== deck presence =======================================================
  // Merge into WorldScene.spots(). Kept cheap and side-effect-free: it is called
  // two or three times a frame, and once more per frame while placing.
  spots: function () {
    if (!this.ensure()) return [];
    var out = [], a = G.placed, i, e, t;
    var skip = this.placing && this.placing.moveIdx >= 0 ? this.placing.moveIdx : -1;
    for (i = 0; i < a.length; i++) {
      if (i === skip) continue;              // in your paws, not on the planks
      e = a[i];
      t = this.table(e.key);
      if (!t) continue;
      out.push(this._spotFor(t, e.x, i));
    }
    return out;
  },

  _spotFor: function (t, x, idx) {
    var self = this;
    var I = this._I();
    var st = I && I.station_ ? I.station_(t.key) : null;
    return {
      x: x,
      label: t.short + '  (' + (st ? st.verb : 'use') + ')',
      act: function () { self.use(t.key, idx); },
    };
  },

  // [E] on a placed table. The table's whole job is to BE the station, so this
  // hands straight over to Inv; with no Inv there is still the build menu.
  use: function (key, idx) {
    if (!this.ensure()) return false;
    var I = this._I();
    if (I && I.station) {
      if (I.station(key)) return true;
      return false;
    }
    return this.openBuild();
  },

  // ==== opening and closing =================================================
  // Every peer panel is checked by hand here, exactly as they check each other.
  // They cannot check US (their guard lists ship without Forge), so this file
  // also closes itself the moment a peer opens -- see update().
  _peerOpen: function () {
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
    if (typeof Battle !== 'undefined' && Battle.active) return true;
    return false;
  },

  // Hand crafting needs no table, but it is still not a free pause button: the
  // dive and the open ocean keep draining air under a borrowed-slot panel.
  canOpenIn: function (scene) {
    if (typeof WorldScene !== 'undefined' && scene === WorldScene) return true;
    if (typeof HouseScene !== 'undefined' && scene === HouseScene) return true;
    return false;
  },

  _allowed: function () {
    if (typeof Game === 'undefined' || Game.fadeDir !== 0) return false;
    if (this.placing) return false;
    if (this._peerOpen()) return false;
    if (typeof this.canOpenIn === 'function' && !this.canOpenIn(Game.scene)) return false;
    return true;
  },

  openHand: function () {
    if (!this.ensure() || !this._allowed()) return false;
    this.open = true;
    this.tab = 0;
    this.sel = 0;
    this.scroll = 0;
    this.note = '';
    this.noteT = 0;
    this._wasDown = Input.mouse.down;
    this._rowCache = {};
    SND.blip();
    return true;
  },

  openBuild: function () {
    if (!this.openHand()) return false;
    if (this.hasPlaced('bench')) this.tab = 1;
    return true;
  },

  toggle: function () {
    if (this.open) { this.close(); return; }
    if (this.openHand()) return;
    SND.blip();
    // Say why once a session. A refused keypress is otherwise just a beep.
    if (!this._hinted && !this._peerOpen() && !this.placing && Game.fadeDir === 0) {
      this._hinted = true;
      Game.toast('Otto needs dry paws to whittle -- try it on the dock.');
    }
  },

  close: function (quiet) {
    if (!this.open) return;
    this.open = false;
    if (!quiet) SND.click();
    if (typeof G !== 'undefined' && G) Game.save();
  },

  _say: function (msg) { this.note = msg || ''; this.noteT = 2.6; },

  // ==== rows ================================================================
  // Static per (tab, unlock epoch, placement count) -- the affordability of a row
  // is recomputed at draw time, but the ARRAY is not rebuilt every frame.
  rows: function (tab) {
    if (!this.ensure()) return [];
    var ep = this._epoch(), np = G.placed.length;
    var c = this._rowCache[tab];
    if (c && c.ep === ep && c.np === np) return c.out;
    var out = [], i, r, t;
    if (tab === 0) {
      for (i = 0; i < this.HAND.length; i++) {
        r = this.HAND[i];
        if (this.unlocked(r.key)) out.push({ kind: 'recipe', r: r, key: r.key, name: r.name });
        else if (!this.HIDE_LOCKED) out.push({ kind: 'locked', r: r, key: r.key, name: '? ? ?' });
      }
      for (i = 0; i < this.TABLES.length; i++) {
        t = this.TABLES[i];
        if (!t.hand) continue;
        out.push({ kind: 'table', t: t, key: t.key, name: t.name });
      }
    } else {
      for (i = 0; i < this.TABLES.length; i++) {
        t = this.TABLES[i];
        if (t.hand) continue;
        out.push({ kind: 'table', t: t, key: t.key, name: t.name });
      }
    }
    this._rowCache[tab] = { ep: ep, np: np, out: out };
    return out;
  },

  rowWhy: function (row) {
    if (!row) return 'nothing to make';
    if (row.kind === 'locked') return this.lockLine(row.key) || 'not yet';
    if (row.kind === 'table') return this.buildWhy(row.t);
    return this.handWhy(row.r);
  },

  rowOk: function (row) { return this.rowWhy(row) === null; },

  rowCost: function (row) {
    if (!row) return null;
    if (row.kind === 'locked') return null;
    return row.kind === 'table' ? row.t.cost : row.r.cost;
  },

  rowDesc: function (row) {
    if (!row) return '';
    if (row.kind === 'locked') return (this.lockLine(row.key) || 'not yet') + '.';
    return (row.kind === 'table' ? row.t.desc : row.r.desc) || '';
  },

  // The verb the button offers, and what pressing it does.
  rowVerb: function (row) {
    if (!row) return '--';
    if (row.kind === 'locked') return 'LOCKED';
    if (row.kind !== 'table') return 'MAKE';
    if (this.countPlaced(row.t.key) >= this.MAX_PER) return 'MOVE';
    return 'BUILD';
  },

  act: function (row) {
    if (!row) return false;
    if (row.kind === 'locked') { this._say(this.rowWhy(row)); SND.blip(); return false; }
    if (row.kind === 'recipe') return this.makeHand(row.key);
    // A table already standing offers a free relocation instead of a second one.
    if (this.countPlaced(row.t.key) >= this.MAX_PER) {
      var idx = -1, a = G.placed, i;
      for (i = 0; i < a.length; i++) if (a[i].key === row.t.key) { idx = i; break; }
      if (idx < 0) return false;
      return this.beginPlace(row.t.key, idx);
    }
    return this.beginPlace(row.t.key, -1);
  },

  _row: function () {
    var rows = this.rows(this.tab);
    return this.sel >= 0 && this.sel < rows.length ? rows[this.sel] : null;
  },

  // ==== update ==============================================================
  update: function (dt) {
    if (!this.ensure()) return;
    // Several layers may tick us; Game.time advances exactly once a frame, so the
    // first call in a frame wins. The same guard Inv, Ocean and Skills use.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    if (this.noteT > 0) this.noteT -= dt;
    this._tickFx(dt);

    // A scene change or a peer panel dismisses both of our modes. Peer guard
    // lists ship without Forge, so this side has to give way.
    if (this.placing && (Game.fadeDir !== 0 || Game.scene !== WorldScene)) this.cancelPlace(true);
    if (this.open && (Game.fadeDir !== 0 || !this.canOpenIn(Game.scene) || this._peerOpen())) {
      this.close(true);
      return;
    }

    if (!this.open) {
      // [C] from anywhere it is allowed. Read even while placing so the key can
      // never be left pending for something else to pick up next frame.
      var kc = Input.p('KeyC');
      if (kc && !this.placing) this.toggle();
      this._wasDown = Input.mouse.down;
      return;
    }

    // Eat the verbs the scene and the peer panels would otherwise act on. Our
    // globalUpdate hook is installed at parse time, so it runs BEFORE Inv's and
    // Skills' own hooks -- which is what makes eating Tab / KeyI / KeyK work.
    Input.p('KeyE');
    Input.p('Space');
    Input.p('KeyH');
    Input.p('Tab');
    Input.p('KeyI');
    Input.p('KeyK');
    Input.p('KeyT');
    if (Input.p('Escape') || Input.p('KeyC')) { this.close(); return; }

    this._panelInput(dt);
    this._wasDown = Input.mouse.down;
  },

  _panelInput: function (dt) {
    var rows = this.rows(this.tab), n = rows.length;

    if (Input.p('Digit1')) this.setTab(0);
    if (Input.p('Digit2')) this.setTab(1);
    if (Input.p('ArrowLeft')) this.setTab(0);
    if (Input.p('ArrowRight')) this.setTab(1);
    if (n > 0) {
      if (Input.p('ArrowUp')) { this.sel = (this.sel + n - 1) % n; SND.blip(); }
      if (Input.p('ArrowDown')) { this.sel = (this.sel + 1) % n; SND.blip(); }
    }
    if (Input.wheelDelta && n > this.ROW_VIS) {
      this.scroll = Math.round(clamp(this.scroll + Input.wheelDelta, 0, n - this.ROW_VIS));
    }
    if (Input.p('Enter')) { this.act(this._row()); return; }
    this._keepSelVisible();

    if (Input.mouse.clicked) this.click(Input.mouse.x, Input.mouse.y);
  },

  setTab: function (i) {
    i = i ? 1 : 0;
    if (i === this.tab) return;
    if (i === 1 && !this.hasPlaced('bench')) {
      this._say('build a workbench first');
      SND.blip();
      return;
    }
    this.tab = i;
    this.sel = 0;
    this.scroll = 0;
    SND.blip();
  },

  _keepSelVisible: function () {
    var n = this.rows(this.tab).length;
    var max = Math.max(0, n - this.ROW_VIS);
    if (this.sel < this.scroll) this.scroll = this.sel;
    else if (this.sel >= this.scroll + this.ROW_VIS) this.scroll = this.sel - this.ROW_VIS + 1;
    this.scroll = Math.round(clamp(this.scroll, 0, max));
  },

  // Public so a wiring layer can route a click it already owns.
  click: function (mx, my) {
    if (!this.open) return false;
    var i, r, rows = this.rows(this.tab);

    if (this._in(this._closeRect(), mx, my)) { this.close(); return true; }
    for (i = 0; i < 2; i++) {
      if (!this._in(this._tabRect(i), mx, my)) continue;
      this.setTab(i);
      return true;
    }
    var vis = Math.min(this.ROW_VIS, rows.length);
    for (i = 0; i < vis; i++) {
      r = this._rowRect(i);
      if (!this._in(r, mx, my)) continue;
      var idx = this.scroll + i;
      // First click selects, second acts -- so a stray click never spends.
      if (idx === this.sel) this.act(rows[idx]);
      else { this.sel = idx; SND.blip(); }
      return true;
    }
    if (this._in(this._btnRect(), mx, my)) { this.act(this._row()); return true; }
    if (rows.length > this.ROW_VIS) {
      if (this._in(this._arrowRect(-1), mx, my)) { this.scroll = Math.max(0, this.scroll - 1); SND.blip(); return true; }
      if (this._in(this._arrowRect(1), mx, my)) {
        this.scroll = Math.min(rows.length - this.ROW_VIS, this.scroll + 1); SND.blip(); return true;
      }
    }
    // A click anywhere else inside the panel is absorbed, not passed through.
    return this._in({ x: this.WX, y: this.WY, w: this.WW, h: this.WH }, mx, my);
  },

  // Placement input. Called from inside the WorldScene.update wrap, BEFORE the
  // scene's own spot search, because Input.p consumes the edge and whoever calls
  // it first wins. Nothing else can beat the scene to [E].
  _placeInput: function (dt) {
    if (!this.placing) return;
    if (Game.fadeDir !== 0) { this.cancelPlace(true); return; }
    if (Input.p('Escape')) { this.cancelPlace(false); return; }
    var go = Input.p('KeyE') || Input.p('Space');
    if (Input.mouse.clicked) {
      if (this._in(this._placeBtn(1), Input.mouse.x, Input.mouse.y)) go = true;
      else if (this._in(this._placeBtn(0), Input.mouse.x, Input.mouse.y)) { this.cancelPlace(false); return; }
    }
    if (go) this.confirmPlace();
  },

  // ==== fx ==================================================================
  // Preallocated and recycled; the oldest is reused when the pool is dry.
  _take: function () {
    var fx = this._fx, best = 0, bt = Infinity, i;
    for (i = 0; i < fx.length; i++) {
      if (fx[i].t <= 0) return fx[i];
      if (fx[i].t < bt) { bt = fx[i].t; best = i; }
    }
    return fx[best];
  },

  _burst: function (r, n) {
    if (!this.open || !this._fx) return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, i, f;
    for (i = 0; i < n; i++) {
      f = this._take();
      f.t = f.life = 0.45 + Math.random() * 0.45;
      f.x = cx + (Math.random() - 0.5) * r.w;
      f.y = cy + (Math.random() - 0.5) * r.h;
      f.vx = (Math.random() - 0.5) * 26;
      f.vy = -16 - Math.random() * 24;
      f.c = Math.random() < 0.5 ? 0 : 1;
    }
  },

  _tickFx: function (dt) {
    var fx = this._fx, i, f;
    if (!fx) return;
    for (i = 0; i < fx.length; i++) {
      f = fx[i];
      if (f.t <= 0) continue;
      f.t -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 62 * dt;
    }
  },

  _drawFx: function (c) {
    var fx = this._fx, i, f, a;
    if (!fx) return;
    // One fillStyle per colour bucket, alpha per particle: building a colour
    // string per sparkle is the thing this codebase has been burned by.
    for (var bucket = 0; bucket < 2; bucket++) {
      c.fillStyle = bucket === 0 ? this.PAL.hi : this.PAL.warm;
      for (i = 0; i < fx.length; i++) {
        f = fx[i];
        if (f.t <= 0 || f.c !== bucket) continue;
        a = f.t / f.life;
        c.globalAlpha = a < 0 ? 0 : (a > 1 ? 1 : a);
        c.fillRect(Math.round(f.x * DPX) / DPX, Math.round(f.y * DPX) / DPX, PIX * 2, PIX * 2);
      }
    }
    c.globalAlpha = 1;
  },

  // ==== geometry ============================================================
  _in: function (r, x, y) { return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },
  _closeRect: function () { return { x: this.WX + this.WW - 22, y: this.WY + 4, w: 18, h: 14 }; },
  _tabRect: function (i) { return { x: this.WX + 10 + i * 58, y: this.WY + 20, w: 54, h: 14 }; },
  _gridCell: function (i) {
    var s = this.CELL + this.CGAP;
    return { x: this.WX + 12 + (i % 2) * s, y: this.WY + 46 + ((i / 2) | 0) * s, w: this.CELL, h: this.CELL };
  },
  _resultRect: function () { return { x: this.WX + 74, y: this.WY + 54, w: 26, h: 26 }; },
  _btnRect: function () { return { x: this.WX + 12, y: this.WY + 118, w: 90, h: 18 }; },
  _listX: function () { return this.WX + 116; },
  _listW: function () { return this.WW - 116 - 12; },
  _rowRect: function (i) {
    return { x: this._listX(), y: this.WY + 40 + i * this.ROW_H, w: this._listW(), h: this.ROW_H - 1 };
  },
  _arrowRect: function (dir) {
    var x = this._listX() + this._listW() - 12;
    return dir < 0 ? { x: x, y: this.WY + 24, w: 12, h: 12 }
                   : { x: x, y: this.WY + 40 + this.ROW_V() * this.ROW_H, w: 12, h: 12 };
  },
  ROW_V: function () { return this.ROW_VIS; },
  // the placement hint bar lives just under the HUD strip (y 0..36 is Game's)
  _placeBar: function () { return { x: 92, y: 38, w: 296, h: 24 }; },
  _placeBtn: function (ok) {
    var b = this._placeBar();
    return ok ? { x: b.x + b.w - 62, y: b.y + 5, w: 54, h: 14 }
              : { x: b.x + b.w - 122, y: b.y + 5, w: 54, h: 14 };
  },

  // ==== icons ===============================================================
  // Rope has no art, so Inv would draw its parchment tag. Our own coil is nicer,
  // and a wrap on Inv.drawIcon means the bag and the cost bars get it too.
  _own: { rope: 1 },

  icon: function (c, key, cx, cy, box) {
    if (this._own[key]) { this._ownIcon(c, key, cx, cy, box); return; }
    var I = this._I();
    if (I && I.drawIcon) { I.drawIcon(c, key, cx, cy, box); return; }
    if (typeof drawItemIcon === 'function') drawItemIcon(c, key, cx, cy, box);
  },

  _ownIcon: function (c, key, cx, cy, box) {
    var u = box / 12;
    c.save();
    c.translate(Math.round(cx * DPX) / DPX, Math.round(cy * DPX) / DPX);
    // a coil of rope: two rings and a tail
    c.strokeStyle = '#c9a271';
    c.lineWidth = 1.6 * u;
    c.beginPath(); c.arc(0, 0, 3.6 * u, 0, TAU); c.stroke();
    c.strokeStyle = '#a4805a';
    c.lineWidth = 1.1 * u;
    c.beginPath(); c.arc(0, 0, 1.9 * u, 0, TAU); c.stroke();
    c.strokeStyle = '#c9a271';
    c.lineWidth = 1.2 * u;
    c.beginPath();
    c.moveTo(2.6 * u, 2.6 * u);
    c.lineTo(4.6 * u, 4.4 * u);
    c.stroke();
    c.restore();
  },

  // ==== draw: the panel =====================================================
  draw: function (c) {
    if (!this.open || !this.ensure()) return;
    var P = this.PAL, m = Input.mouse;
    var rows = this.rows(this.tab), row = this._row();

    uiPanel(c, this.WX, this.WY, this.WW, this.WH, 0.95, false);
    // a warm inner rule, so the cosy panel does not read as a station screen
    c.strokeStyle = 'rgba(201,162,113,0.35)';
    c.lineWidth = PIX * 2;
    c.strokeRect(this.WX + 3, this.WY + 3, this.WW - 6, this.WH - 6);

    text(c, 'in otto’s paws', this.WX + 10, this.WY + 6, { size: 8, color: P.ink });

    // close box
    var cr = this._closeRect(), onC = this._in(cr, m.x, m.y);
    rrect(c, cr.x, cr.y, cr.w, cr.h, onC ? 'rgba(232,67,76,0.85)' : 'rgba(0,0,0,0.3)');
    text(c, 'x', cr.x + cr.w / 2, cr.y + 3, { size: 7, color: P.ink, align: 'center' });

    this._drawTabs(c, m);
    this._drawGrid(c, row);
    this._drawButton(c, row, m);
    this._drawList(c, rows, m);
    this._drawFooter(c, row);
    this._drawFx(c);
  },

  _drawTabs: function (c, m) {
    var P = this.PAL, names = ['MAKE', 'BUILD'], i, r, on, sel, locked;
    for (i = 0; i < 2; i++) {
      r = this._tabRect(i);
      sel = this.tab === i;
      locked = i === 1 && !this.hasPlaced('bench');
      on = this._in(r, m.x, m.y);
      rrect(c, r.x, r.y, r.w, r.h,
        sel ? 'rgba(201,162,113,0.85)' : (on ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)'));
      text(c, locked ? names[i] + ' –' : names[i], r.x + r.w / 2, r.y + 3.5,
        { size: 7, color: sel ? '#4a3020' : (locked ? '#7a6a55' : P.dim), align: 'center' });
    }
  },

  // The 2x2. Four cost slots, an arrow, and what comes out -- the one shape every
  // player already knows what to do with.
  _drawGrid: function (c, row) {
    var P = this.PAL, i, cell, cost = this.rowCost(row);
    var keys = [], k;
    if (cost) for (k in cost) if (Object.prototype.hasOwnProperty.call(cost, k)) keys.push(k);

    for (i = 0; i < 4; i++) {
      cell = this._gridCell(i);
      rrect(c, cell.x, cell.y, cell.w, cell.h, 'rgba(0,0,0,0.34)', 'rgba(201,162,113,0.35)');
      if (i >= keys.length) continue;
      k = keys[i];
      var need = cost[k], held = this.have(k);
      this.icon(c, k, cell.x + cell.w / 2, cell.y + cell.h / 2 - 2, 14);
      text(c, held + '/' + need, cell.x + cell.w - 1.5, cell.y + cell.h - 8,
        { size: 6, color: held >= need ? P.good : P.bad, align: 'right' });
    }

    // arrow
    var ax = this.WX + 62, ay = this.WY + 66;
    c.fillStyle = P.dim;
    c.fillRect(ax, ay - 1, 8, 2);
    c.beginPath();
    c.moveTo(ax + 8, ay - 4); c.lineTo(ax + 12, ay); c.lineTo(ax + 8, ay + 4);
    c.closePath();
    c.fill();

    // result
    var rr = this._resultRect();
    rrect(c, rr.x, rr.y, rr.w, rr.h, 'rgba(0,0,0,0.4)', 'rgba(255,230,110,0.4)');
    if (!row) return;
    if (row.kind === 'locked') {
      text(c, '?', rr.x + rr.w / 2, rr.y + 8, { size: 11, color: '#7a6a55', align: 'center' });
    } else if (row.kind === 'table') {
      this._tableArt(c, row.t, rr.x + rr.w / 2, rr.y + rr.h / 2, 18);
    } else if (row.r.out) {
      this.icon(c, row.r.out.key, rr.x + rr.w / 2, rr.y + rr.h / 2, 18);
      if (row.r.out.n > 1) {
        text(c, 'x' + row.r.out.n, rr.x + rr.w - 1.5, rr.y + rr.h - 8,
          { size: 6, color: this.PAL.ink, align: 'right' });
      }
    }
  },

  _tableArt: function (c, t, cx, cy, box) {
    if (this._hasArt(t.art)) {
      var img = ASSETS[t.art];
      var w = img.width >= img.height ? box : box * img.width / img.height;
      drawAC(c, t.art, cx, cy, w);
      return;
    }
    c.fillStyle = this.PAL.wood;
    c.fillRect(Math.round((cx - box / 2) * DPX) / DPX, cy - 4, box, 8);
  },

  _drawButton: function (c, row, m) {
    var P = this.PAL, r = this._btnRect(), ok = this.rowOk(row), on = this._in(r, m.x, m.y);
    rrect(c, r.x, r.y, r.w, r.h,
      ok ? (on ? 'rgba(255,230,110,0.95)' : 'rgba(246,232,201,0.9)') : 'rgba(60,42,28,0.85)',
      ok ? P.hi : 'rgba(226,200,150,0.28)');
    text(c, this.rowVerb(row), r.x + r.w / 2, r.y + 5,
      { size: 7, color: ok ? '#4a3020' : '#8a9484', align: 'center', shadow: false });

    // the reason, or the flavour line, wrapped by character count the way npc.js,
    // skills.js and inv.js all do it -- Courier is monospace, so it is exact.
    var msg, col;
    if (this.noteT > 0) { msg = this.note; col = P.hi; }
    else {
      var why = this.rowWhy(row);
      msg = why || this.rowDesc(row);
      col = why ? P.bad : P.dim;
    }
    var cols = Math.floor(90 / (6 * 0.6));
    var lines = this._wrap(msg, cols), i;
    for (i = 0; i < lines.length && i < 3; i++) {
      c.globalAlpha = this.noteT > 0 ? clamp(this.noteT, 0, 1) : 1;
      text(c, lines[i], r.x, r.y + 22 + i * 8, { size: 6, color: col });
      c.globalAlpha = 1;
    }
  },

  _drawList: function (c, rows, m) {
    var P = this.PAL, i, r, row, idx, vis = Math.min(this.ROW_VIS, rows.length);

    if (!rows.length) {
      text(c, this.tab === 1 ? 'a workbench first.' : 'nothing to whittle.',
        this._listX(), this.WY + 44, { size: 6.5, color: P.dim });
      return;
    }
    for (i = 0; i < vis; i++) {
      idx = this.scroll + i;
      row = rows[idx];
      if (!row) break;
      r = this._rowRect(i);
      var sel = idx === this.sel, on = this._in(r, m.x, m.y);
      if (sel || on) rrect(c, r.x, r.y, r.w, r.h, sel ? 'rgba(201,162,113,0.32)' : 'rgba(255,255,255,0.07)');

      if (row.kind === 'locked') {
        // silhouette: a flat plate where the icon would be
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(r.x + 3, r.y + 3, 8, 8);
      } else if (row.kind === 'table') {
        this._tableArt(c, row.t, r.x + 7, r.y + r.h / 2, 11);
      } else {
        this.icon(c, row.r.out ? row.r.out.key : row.key, r.x + 7, r.y + r.h / 2, 11);
      }

      var ok = this.rowOk(row);
      var built = row.kind === 'table' && this.countPlaced(row.t.key) >= this.MAX_PER;
      text(c, this._clip(row.name, 15), r.x + 15, r.y + 3,
        { size: 6.5, color: row.kind === 'locked' ? '#7a6a55' : (sel ? P.hi : P.ink) });
      // one glyph of status per row, right-aligned: built, ready, or short
      text(c, built ? '✓' : (ok ? '•' : '×'), r.x + r.w - 3, r.y + 3,
        { size: 6.5, color: built ? P.good : (ok ? P.good : 'rgba(255,106,122,0.7)'), align: 'right' });
    }

    if (rows.length <= this.ROW_VIS) return;
    var a0 = this._arrowRect(-1), a1 = this._arrowRect(1);
    text(c, '▲', a0.x + 6, a0.y + 2, { size: 6, color: this.scroll > 0 ? P.ink : P.dim, align: 'center' });
    text(c, '▼', a1.x + 6, a1.y + 2,
      { size: 6, color: this.scroll < rows.length - this.ROW_VIS ? P.ink : P.dim, align: 'center' });
  },

  _drawFooter: function (c, row) {
    var P = this.PAL, y = this.WY + this.WH - 13;
    var hint = TouchUI.enabled ? 'tap a row twice to make it' : '[1/2] tabs   arrows pick   [enter] make   [C] close';
    text(c, hint, this.WX + 10, y, { size: 6, color: 'rgba(168,152,120,0.8)' });
  },

  // ==== draw: the dock ======================================================
  // Call inside WorldScene's camera transform. Draws every placed table standing
  // on the planks, plus the placement ghost, so a wiring layer that only calls
  // this one function still gets the whole feature.
  drawPlaced: function (c, camX) {
    if (!this.ensure()) return;
    var deckY = (typeof DECK_Y !== 'undefined') ? DECK_Y : 214;
    var a = G.placed, i, e, t;
    var skip = this.placing && this.placing.moveIdx >= 0 ? this.placing.moveIdx : -1;
    for (i = 0; i < a.length; i++) {
      if (i === skip) continue;
      e = a[i];
      t = this.table(e.key);
      if (!t) continue;
      if (e.x < camX - 50 || e.x > camX + W + 50) continue;   // cull, like every world drawer here
      this._drawTable(c, t, e.x, deckY, 1);
    }
    if (this.placing) this._drawGhost(c, camX, deckY);
  },

  _drawTable: function (c, t, x, deckY, alpha) {
    var w = t.w, h = w;
    c.save();
    c.translate(Math.round(x * DPX) / DPX, 0);
    if (alpha < 1) c.globalAlpha = alpha;
    if (this._hasArt(t.art)) {
      h = assetH(t.art, w);
      drawA(c, t.art, -w / 2, deckY - h, w, h);
    } else {
      h = 13;
      c.fillStyle = this.PAL.wood;
      c.fillRect(-w / 2, deckY - h, w, h * 0.42);
      c.fillStyle = '#6d4526';
      c.fillRect(-w / 2 + 1, deckY - h * 0.55, 2, h * 0.55);
      c.fillRect(w / 2 - 3, deckY - h * 0.55, 2, h * 0.55);
    }
    c.globalAlpha = 1;
    c.restore();
    if (alpha < 1) return h;

    // A job on this bench shows over it, so the dock itself says it is busy.
    var I = this._I();
    if (!I || !I.activeJob) return h;
    var j = I.activeJob(t.key);
    if (!j) return h;
    var bx = x - 12, by = deckY - h - 8;
    if (I.jobReady && I.jobReady(j)) {
      var pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
      c.globalAlpha = pulse;
      uiPanel(c, bx - 2, by - 4, 28, 10, 0.9, true);
      text(c, 'ready', bx + 12, by - 1.5, { size: 6, color: '#4a3020', align: 'center', shadow: false });
      c.globalAlpha = 1;
    } else if (j.dur > 0) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(bx, by, 24, 4);
      c.fillStyle = this.PAL.hi;
      c.fillRect(bx, by, 24 * clamp(j.t / j.dur, 0, 1), 4);
    }
    return h;
  },

  _drawGhost: function (c, camX, deckY) {
    var p = this.placing, t = this.table(p.key);
    if (!t) return;
    if (p.x < camX - 60 || p.x > camX + W + 60) return;
    var ok = !p.why;
    var pulse = 0.42 + 0.16 * Math.sin(this.time * 6);
    var h = this._drawTable(c, t, p.x, deckY, pulse + 0.2);

    // a footprint bracket on the planks: green where it will land, red where not
    var w = t.w + 6, x0 = Math.round((p.x - w / 2) * DPX) / DPX;
    c.fillStyle = ok ? 'rgba(160,242,180,0.5)' : 'rgba(255,90,74,0.5)';
    c.fillRect(x0, deckY - 1, w, PIX * 2);
    c.fillRect(x0, deckY - 5, PIX * 2, 4);
    c.fillRect(x0 + w - PIX * 2, deckY - 5, PIX * 2, 4);
  },

  // The placement bar rides in HUD space, under the day dial, so it never fights
  // the hotbar (x 133..347 at the bottom) or the HUD strip (y 0..36).
  drawPlaceBar: function (c) {
    if (!this.placing) return;
    var p = this.placing, t = this.table(p.key), P = this.PAL;
    if (!t) return;
    var b = this._placeBar(), ok = !p.why, m = Input.mouse;
    uiPanel(c, b.x, b.y, b.w, b.h, 0.9, true);
    text(c, (p.moveIdx >= 0 ? 'Moving ' : 'Placing ') + t.short, b.x + 8, b.y + 4,
      { size: 7, color: '#4a3020', shadow: false });
    text(c, ok ? 'looks like a good spot' : this._clip(p.why, 30), b.x + 8, b.y + 13,
      { size: 6, color: ok ? '#3a6a3a' : '#a03028', shadow: false });

    var r1 = this._placeBtn(1), r0 = this._placeBtn(0);
    rrect(c, r1.x, r1.y, r1.w, r1.h, ok ? 'rgba(160,242,180,0.95)' : 'rgba(120,110,96,0.5)',
      ok ? '#3a6a3a' : 'rgba(74,48,32,0.3)');
    text(c, TouchUI.enabled ? 'SET' : '[E] SET', r1.x + r1.w / 2, r1.y + 3.5,
      { size: 6.5, color: ok ? '#2a4a2a' : '#6a5a4a', align: 'center', shadow: false });
    rrect(c, r0.x, r0.y, r0.w, r0.h, this._in(r0, m.x, m.y) ? 'rgba(232,67,76,0.5)' : 'rgba(0,0,0,0.16)',
      'rgba(74,48,32,0.3)');
    text(c, TouchUI.enabled ? 'CANCEL' : '[esc] DROP', r0.x + r0.w / 2, r0.y + 3.5,
      { size: 6.5, color: '#4a3020', align: 'center', shadow: false });
  },

  // ==== small helpers =======================================================
  _hasArt: function (n) {
    return !!(n && typeof ASSETS !== 'undefined' && ASSETS[n] && ASSETS[n].width);
  },

  _clip: function (s, n) {
    s = String(s === undefined || s === null ? '' : s);
    return s.length <= n ? s : s.slice(0, n - 1) + '.';
  },

  _wrap: function (s, cols) {
    var words = String(s === undefined || s === null ? '' : s).split(' ');
    var lines = [], line = '', i, t;
    for (i = 0; i < words.length; i++) {
      t = line ? line + ' ' + words[i] : words[i];
      if (t.length > cols && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  },

  _cursor: function (c) {
    var m = Input.mouse;
    c.save();
    c.translate(Math.round(m.x), Math.round(m.y));
    c.fillStyle = '#101820';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
    c.fillStyle = '#f2f4f6';
    c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
    c.restore();
  },

  // ==== install =============================================================
  install: function () {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;
    this._boot();

    this._wireInv();
    this._wireSkills();

    // --- 1. the only slot that ticks every frame while a scene is live -------
    var gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      Forge.update(dt);
    };

    // --- 2. Shop's exact z-order: after the colour grade, under toasts -------
    // The placement bar is NOT a modal, so it draws over the HUD instead of
    // replacing it.
    var gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (Forge.open) { Forge.draw(c); return; }
      gHUD(c);
      if (Forge.placing) Forge.drawPlaceBar(c);
    };

    // --- 3. a scene change dismisses both modes ------------------------------
    var gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) {
      if (Forge.open) { Forge.open = false; }
      if (Forge.placing) Forge.placing = null;
      return gGo(scene, arg);
    };

    // --- 4. Game.drawCursor only knows about Shop --------------------------
    var gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (Forge.open && !TouchUI.enabled) { Forge._cursor(c); return; }
      gCursor(c);
    };

    // --- 5. pads: gone under the panel, plus a cancel pad while placing ------
    var tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (Forge.open) return [];
      var b = tLayout();
      if (Forge.placing && typeof WorldScene !== 'undefined' && Game.scene === WorldScene) {
        // 'act' (tap KeyE) is already in the world layout and confirms for us;
        // this is the way back out.
        b.push({ x: W - 52, y: H - 98, w: 44, h: 44, tap: 'Escape', icon: 'fcancel' });
      }
      return b;
    };
    // TouchUI.draw only knows six icons and paints an empty circle for anything
    // else, so the cancel pad gets its glyph here -- the ocean.js / tame.js idiom.
    var tDraw = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tDraw(c);
      if (!this.enabled || !Forge.placing) return;
      for (var i = 0; i < this.buttons.length; i++) {
        var b = this.buttons[i];
        if (b.icon !== 'fcancel') continue;
        var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        c.strokeStyle = 'rgba(255,106,122,0.9)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(cx - 6, cy - 6); c.lineTo(cx + 6, cy + 6);
        c.moveTo(cx + 6, cy - 6); c.lineTo(cx - 6, cy + 6);
        c.stroke();
      }
    };

    // --- 6. freeze the host scenes, and steal [E] while placing --------------
    if (typeof WorldScene !== 'undefined') {
      var wu = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) {
        if (Forge.open) return;
        // Placement input MUST run before the scene's nearest-spot search:
        // Input.p consumes the edge and whoever asks first wins.
        if (Forge.placing) Forge._placeInput(dt);
        wu(dt);
        if (Forge.placing) Forge._track();     // the ghost follows Otto's new x
      };
    }
    if (typeof HouseScene !== 'undefined') {
      var hu = HouseScene.update.bind(HouseScene);
      HouseScene.update = function (dt) { if (Forge.open) return; hu(dt); };
    }

    if (!this.selfWire) return;

    // --- deck presence ------------------------------------------------------
    // The fallback that makes placed tables real without an integrate.js edit:
    // set Forge.selfWire = false there and concat Forge.spots() / call
    // Forge.drawPlaced inside the world's camera transform yourself.
    if (typeof WorldScene !== 'undefined' && WorldScene.spots) {
      var ws = WorldScene.spots.bind(WorldScene);
      WorldScene.spots = function () { return ws().concat(Forge.spots()); };
      var wd = WorldScene.draw.bind(WorldScene);
      WorldScene.draw = function (ctx) {
        wd(ctx);
        ctx.save();
        ctx.translate(-Math.round(this.camX * DPX) / DPX, 0);
        Forge.drawPlaced(ctx, this.camX);
        ctx.restore();
      };
    }
  },

  // Everything that reaches into Inv, in one place.
  _wireInv: function () {
    var I = this._I();
    if (!I) return;

    // 1. the two new materials, so the bag knows their names and icons
    var k;
    for (k in this.ITEM_DEF) {
      if (!Object.prototype.hasOwnProperty.call(this.ITEM_DEF, k)) continue;
      if (!I.DEF[k]) I.DEF[k] = this.ITEM_DEF[k];
    }

    // 2. the hand recipes. station 'hand' is not an Inv station, so _buildIndex
    //    files them in _byKey (craft/missing/recipe all work) and in NO station
    //    list -- they can never show up on a bench. _byKey is built lazily, so
    //    dropping it is the sanctioned way to make it pick these up.
    if (I.RECIPES) {
      for (var i = 0; i < this.HAND.length; i++) {
        if (I.recipe && I._byKey && I.recipe(this.HAND[i].key)) continue;
        I.RECIPES.push(this.HAND[i]);
      }
      I._byKey = null;
      I._byStation = null;
    }

    // 3. THE GATE. Levels are no longer the gate -- nodes are -- and leaving
    //    Inv.levelOf pointed at Skills.level() would lock every lvl >= 2 recipe
    //    forever, because 'crafting' / 'smelting' / 'carpentry' / 'smithing' are
    //    not Skills professions and resolve to level 1.
    I.levelOf = function () { return 99; };

    var iLocked = I.locked.bind(I);
    I.locked = function (r) {
      if (r && !Forge.unlocked(r.key)) return true;
      return iLocked(r);
    };

    var iMissing = I.missing.bind(I);
    I.missing = function (r) {
      var key = r && typeof r === 'object' ? r.key : r;
      var line = Forge.lockLine(key);
      if (line) return line;
      return iMissing(r);
    };

    // Hide or silhouette locked rows. This is the single seam the station panel
    // reads for BOTH its draw and its click handling, so the indices can never
    // drift apart.
    var iAt = I.recipesAt.bind(I);
    I.recipesAt = function (stKey) { return Forge._gateList(stKey, iAt(stKey)); };

    // Rope has no art in the manifest; give it a real icon everywhere.
    if (I.drawIcon) {
      var iIcon = I.drawIcon.bind(I);
      I.drawIcon = function (c, key, cx, cy, box) {
        if (Forge._own[key]) { Forge._ownIcon(c, key, cx, cy, box); return; }
        iIcon(c, key, cx, cy, box);
      };
    }

    // 4. Crafting xp, routed to the tree that owns the recipe's node.
    var iMade = typeof I.onMade === 'function' ? I.onMade.bind(I) : null;
    I.onMade = function (recipe, key, n) {
      if (iMade) iMade(recipe, key, n);
      if (recipe) Forge._payXp(recipe.key, recipe.xp);
    };

    // 5. A STATION IS NO LONGER AMBIENT SCENERY. Inv ships four sites on the
    //    planks and a tinkering table indoors that reaches all four; both would
    //    hand the player everything this file asks them to build. Emptying
    //    SITES.x also frees x=430, which Inv's bench and Tame's tide pool were
    //    fighting over.
    if (I.SITES) {
      for (k in I.SITES) {
        if (!Object.prototype.hasOwnProperty.call(I.SITES, k)) continue;
        I.SITES[k].x = null;
      }
    }
    I.houseSpots = function () { return []; };
    I.drawHouse = function () { };
  },

  _wireSkills: function () {
    var S = this._S();
    if (!S) return;

    // Buying a node is the only thing that moves ownership mid-session, so it is
    // the only thing that has to invalidate the filtered recipe lists.
    if (typeof S.buy === 'function') {
      var sBuy = S.buy.bind(S);
      S.buy = function (key) {
        var r = sBuy(key);
        if (r) { Forge._gepoch++; Forge._rowCache = {}; }
        return r;
      };
    }

    // Inv's station skills are not professions and are not in Skills.ALIAS, so
    // anything that pays them xp currently drops it on the floor. Point them at a
    // real tree; harmless if a later build gives them their own.
    if (S.ALIAS) {
      var alias = { crafting: 'mining', carpentry: 'mining', smelting: 'mining', smithing: 'fighting' };
      for (var k in alias) {
        if (!Object.prototype.hasOwnProperty.call(alias, k)) continue;
        if (!S.ALIAS[k]) S.ALIAS[k] = alias[k];
      }
    }
  },
};

// Load-order-agnostic install, the tail every module in this codebase ships:
// Game and TouchUI are script-scoped consts in js/main.js, so a file that loads
// before it must wait for DOMContentLoaded (which fires after every classic
// script in <body>).
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Forge.install();
else document.addEventListener('DOMContentLoaded', function () { Forge.install(); }, { once: true });
