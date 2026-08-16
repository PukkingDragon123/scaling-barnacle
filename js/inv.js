// ---- the bag, and the four benches that fill it ------------------------------
//
// Two screens live in this file and they are deliberately different animals:
//
//   1. THE BAG (Tab / I)   a real grid inventory. Stacks with per-item caps,
//      drag to rearrange, click to shuttle a stack to or from the hotbar,
//      sort / stack / gather, and a parchment detail card that doubles as the
//      hover tooltip.
//
//   2. THE STATIONS ([E] on the deck, or Inv.station('forge'))  four benches,
//      each with its own recipe set, its own layout and its own look:
//        bench  tbl_bench   tools, tackle, the small gear upgrades   (cards)
//        forge  tbl_forge   smelting, and it BURNS CHARCOAL to do it (rows)
//        mill   tbl_mill    driftwood -> planks -> beams, stone -> grit (rows)
//        anvil  tbl_anvil   weapons, armour and the pickaxe tiers    (cards)
//      A recipe with time > 0 QUEUES: it finishes over real seconds whether or
//      not the panel is open, so a smelt is something you set going and come
//      back to. Each station runs one job at a time and holds a short queue.
//
// EVERYTHING PERSISTS UNDER ONE TOP-LEVEL KEY, G.inv. Only storage/gear/stats/
// flags/decor are deep-merged by Game.load, so G.inv arrives from an old save
// exactly as it was written and never gains the fields a newer build expects.
// ensure() therefore re-normalises the whole subtree defensively on EVERY public
// entry point, draw and update included.
//
// THE COUNTING SEAM. count() is the bag alone (that is what a bag means), but
// recipes cost things that may still be sitting in the hotbar or in flat
// G.storage from before the bag existed. have() and spend() walk the SAME bin
// list in the SAME order, so anything that reads as held can always be spent --
// the one asymmetry this codebase already has (Craft.have sees G.crafted, take()
// cannot spend it) is not repeated here.
//
// HOOKS the integrator repoints (all default to something harmless):
//   Inv.levelOf(skill) -> 99      gate recipes behind a skill level
//   Inv.xp(skill, n)              where crafting xp goes
//   Inv.onMade(recipe, key, n)    a thing was finished (equip it, bump a tier)
//   Inv.canOpenIn(scene) -> bool  which scenes allow rummaging
'use strict';

const Inv = {
  // ---- the bag -------------------------------------------------------------
  COLS: 8,
  ROWS: 5,
  CELL: 26,
  GAP: 3,
  DEF_STACK: 99,

  // THE BAG IS A PAGE. It fills the screen down to y 240 and stops there --
  // the hotbar sits at H - 4 - CELL = 247 and is drawn ON TOP of us, so a page
  // that ran to the bottom would have the bar lying across its footer.
  BWX: 16, BWY: 12, BWW: 448, BWH: 228,
  GX: 50, GY: 50,                     // grid origin
  CARD_X: 296, CARD_Y: 50, CARD_W: 152, CARD_H: 166,
  _openT: 0,

  // ---- the stations --------------------------------------------------------
  SWX: 44, SWY: 24, SWW: 392, SWH: 222,
  TAB_Y: 46, TAB_W: 92, TAB_H: 16, TAB_GAP: 3,
  LIST_X: 154, LIST_Y: 66, LIST_W: 254,
  ROW_H: 26, ROW_VIS: 5,
  CARDW: 122, CARDH: 42, CARD_GAP: 6, CARD_COLS: 2, CARD_ROWS: 3,
  BAR_Y: 210, BAR_H: 30,              // the cost + verb bar under the list

  MAX_JOBS: 3,                        // queued jobs per station
  FUEL_PER_COAL: 34,                  // seconds of furnace burn from one charcoal
  FX_MAX: 44,                         // hard particle cap, pool is preallocated

  // Deck placement. The dock's single [E] does a nearest-within-22 search, so a
  // site needs 22 units of clearance from every other spot on the planks. The
  // integrator owns the deck plan (js/integrate.js re-places Farm, Stock, Craft
  // and the NPCs), so only the workbench ships with an x: 430 is the one gap in
  // the current layout that clears 400 and 460 by 30 either side. Give the other
  // three an x from integrate.js when the deck is re-planned; until then all four
  // are reachable from the station rail inside any station's panel.
  SITES: {
    bench: { x: 430, b: 2 },
    forge: { x: null, b: 2 },
    mill:  { x: null, b: 2 },
    anvil: { x: null, b: 3 },
  },
  // Indoors the reach is 26 and the floor runs 184.8..372.6; 290 is clear of the
  // bed (217) and the door (369) by more than that, so the tinkering table is
  // available from day one, before the dock is long enough for a workshop.
  HOUSE_X: 290,

  // ---- items ---------------------------------------------------------------
  // name / desc / value feed the detail card; art is an asset name and glyph is
  // the coded stand-in for the keys the manifest has no art for (missing art is
  // silent in this codebase, so an unguarded name would just draw nothing).
  // stack defaults to DEF_STACK. hot is the hotbar shape this item takes when
  // you send it to the bar -- mapping 'tool_hoe' onto the hotbar's existing
  // 'hoe' tool means a crafted hoe IS the hoe the rest of the game knows.
  // Declaration order is the sort order.
  DEF: {
    driftwood:  { name: 'Driftwood',    art: 'res_driftwood', value: 3,  desc: 'Planks the tide gave back. Saws well, burns well.' },
    stone:      { name: 'Sea Stone',    art: 'res_stone',     value: 2,  desc: 'Wet grey rock. Grinds down to grit.' },
    sand:       { name: 'Grit Sand',    art: 'res_sand',      value: 1,  desc: 'Ground stone, sharp as salt. Melts into glass.' },
    ore:        { name: 'Raw Ore',      art: 'res_ore',       value: 7,  desc: 'Rusty lumps off the seabed. Smelt for iron.' },
    charcoal:   { name: 'Charcoal',     glyph: 'coal',        value: 6,  desc: 'Burnt driftwood. The furnace runs on it.' },
    nail:       { name: 'Old Nail',     art: 'res_nail',      value: 5,  desc: 'Straightened on the anvil, good as new.' },
    plank:      { name: 'Cut Plank',    art: 'res_plank',     value: 9,  desc: 'Sawn square and stacked to dry.' },
    beam:       { name: 'Oak Beam',     art: 'res_beam',      value: 34, desc: 'Heavy timber. Holds up whatever you build.' },
    ingot:      { name: 'Iron Ingot',   art: 'res_ingot',     value: 16, desc: 'One bar of clean iron, still warm.' },
    glass:      { name: 'Sea Glass',    art: 'res_glass',     value: 22, desc: 'Melted grit, cooled slow and clear.' },
    crystal:    { name: 'Sea Crystal',  art: 'res_crystal',   value: 26, desc: 'Cold, clear, and faintly humming.' },
    lens:       { name: 'Crystal Lens', art: 'res_lens',      value: 64, desc: 'Ground and polished. It gathers light.' },
    cannonball: { name: 'Cannonball',   art: 'res_ball',      value: 12, desc: 'Shell grit packed hard. Fits the deck cannon.' },
    crabpot:    { name: 'Crab Pot',     art: 'res_pot', value: 30, stack: 20, desc: 'Sink it off the dock overnight.' },
    bomb:       { name: 'Powder Bomb',  art: 'wpn_bomb', value: 45, stack: 20, desc: 'Short fuse. Throw it and mean it.' },

    tool_hoe:    { name: 'Hoe',             art: 'ftool_0',  value: 35,  stack: 1, hot: 'hoe',     desc: 'Turns a bed over in one clean pass.' },
    tool_can:    { name: 'Watering Can',    art: 'ftool_1',  value: 30,  stack: 1, hot: 'can',     desc: 'Holds enough for a whole row of beds.' },
    tool_spade:  { name: 'Spade',           art: 'ftool_2',  value: 32,  stack: 1, hot: 'spade',   desc: 'For digging where the sand is soft.' },
    tool_rake:   { name: 'Rake',            art: 'ftool_3',  value: 28,  stack: 1, hot: 'rake',    desc: 'Combs the kelp and the grit off the planks.' },
    tool_sickle: { name: 'Sickle',          art: 'ftool_4',  value: 38,  stack: 1, hot: 'sickle',  desc: 'Takes a crop off at the root, gently.' },
    tool_basket: { name: 'Harvest Basket',  art: 'ftool_9',  value: 26,  stack: 1, hot: 'basket',  desc: 'Woven driftwood. Carries a lot of dinner.' },
    tool_bucket: { name: 'Bucket',          art: 'ftool_10', value: 20,  stack: 1, hot: 'bucket',  desc: 'A bucket. Otto is very fond of it.' },
    tool_netbag: { name: 'Net Bag',         art: 'g_netbag', value: 24,  stack: 1, hot: 'seedbag', desc: 'Loose mesh -- the grit falls straight out.' },

    pick_stone:   { name: 'Stone Pick',   art: 'pick_stone',   value: 70,  stack: 1, hot: 'pick_stone',   desc: 'Bites coal, iron and scrap.' },
    pick_iron:    { name: 'Iron Pick',    art: 'pick_iron',    value: 220, stack: 1, hot: 'pick_iron',    desc: 'Splits gold and sunken wrecks.' },
    pick_crystal: { name: 'Crystal Pick', art: 'pick_crystal', value: 620, stack: 1, hot: 'pick_crystal', desc: 'The only thing that touches crystal.' },

    cutlass:    { name: 'Cutlass',     art: 'wpn_cutlass', value: 180, stack: 1, hot: 'cutlass',   desc: 'Heavy, curved, and very persuasive.' },
    flintlock:  { name: 'Flintlock',   art: 'wpn_flint',   value: 260, stack: 1, hot: 'flintlock', desc: 'One shot, then a long and awkward reload.' },
    cannon_kit: { name: 'Deck Cannon', art: 'wpn_cannon',  value: 520, stack: 1, desc: 'A cannon in pieces, ready to be mounted.' },
    helm:       { name: 'Diving Helm', art: 'g_helmet',    value: 150, stack: 1, desc: 'Brass and glass. Keeps the deep out.' },
    vest:       { name: 'Plate Vest',  art: 'g_suit',      value: 210, stack: 1, desc: 'Iron scales over canvas. Slow, but safe.' },
  },

  // ---- stations ------------------------------------------------------------
  // pal: bg = the panel wash, ink = body text, hi = the accent, warm = the
  // secondary accent. layout picks the list engine; deco picks the backdrop.
  STATIONS: [
    {
      key: 'bench', name: "otto's workbench", art: 'tbl_bench', verb: 'make',
      skill: 'crafting', layout: 'cards', deco: 'peg',
      blurb: 'tools, tackle and the small comforts',
      pal: { bg: 'rgba(52,36,23,0.96)', ink: '#f6e8c9', dim: '#a89878', hi: '#ffe66e', warm: '#c9a271' },
    },
    {
      key: 'forge', name: 'the furnace', art: 'tbl_forge', verb: 'smelt',
      skill: 'smelting', layout: 'rows', deco: 'brick', fuel: true,
      blurb: 'ore in, iron out -- and it eats charcoal',
      pal: { bg: 'rgba(44,24,18,0.96)', ink: '#f6e0c0', dim: '#a4805a', hi: '#e8a93c', warm: '#ff5a4a' },
    },
    {
      key: 'mill', name: 'the sawmill', art: 'tbl_mill', verb: 'saw',
      skill: 'carpentry', layout: 'rows', deco: 'grain',
      blurb: 'timber down to planks, planks up to beams',
      pal: { bg: 'rgba(46,34,22,0.96)', ink: '#f6e8c9', dim: '#a89878', hi: '#c9a271', warm: '#a0f2b4' },
    },
    {
      key: 'anvil', name: 'the smithy', art: 'tbl_anvil', verb: 'forge',
      skill: 'smithing', layout: 'cards', deco: 'iron',
      blurb: 'weapons, armour and honest pickaxes',
      pal: { bg: 'rgba(30,32,38,0.96)', ink: '#e6ecf2', dim: '#8a9484', hi: '#c9d4dc', warm: '#5ad2f0' },
    },
  ],

  // ---- recipes -------------------------------------------------------------
  // { key, name, station, cost, out, time, xp, desc, art } plus the optionals:
  //   money    sand dollars on top of the materials
  //   lvl      required level in the station's skill (via Inv.levelOf)
  //   nofuel   the furnace does not need to be lit for this one (it IS the fire)
  //   apply(g) side effect instead of / as well as an output
  //   done(g)  true once it is pointless to make again (gear you already own)
  // time is in seconds of real, wall-clock crafting.
  RECIPES: [
    // -- workbench ---------------------------------------------------------
    { key: 'b_pot',    name: 'Crab Pot',        station: 'bench', cost: { plank: 2, nail: 2 },            out: { key: 'crabpot', n: 1 },    time: 8,  xp: 4,  lvl: 1, art: null,       desc: 'Slatted dome, baited with scraps.' },
    { key: 'b_netbag', name: 'Net Bag',         station: 'bench', cost: { driftwood: 2, nail: 2 },        out: { key: 'tool_netbag', n: 1 }, time: 10, xp: 5,  lvl: 1, art: 'g_netbag', desc: 'Loose mesh. The grit falls straight out.' },
    { key: 'b_basket', name: 'Harvest Basket',  station: 'bench', cost: { driftwood: 3, nail: 2 },        out: { key: 'tool_basket', n: 1 }, time: 9,  xp: 4,  lvl: 1, art: 'ftool_9',  desc: 'Woven wide, for a proper armful.' },
    { key: 'b_bucket', name: 'Bucket',          station: 'bench', cost: { plank: 2, nail: 2 },            out: { key: 'tool_bucket', n: 1 }, time: 8,  xp: 4,  lvl: 1, art: 'ftool_10', desc: 'Watertight, mostly.' },
    { key: 'b_hoe',    name: 'Hoe',             station: 'bench', cost: { plank: 1, ingot: 1, nail: 2 },  out: { key: 'tool_hoe', n: 1 },    time: 12, xp: 6,  lvl: 1, art: 'ftool_0',  desc: 'Turns a bed over in one pass.' },
    { key: 'b_can',    name: 'Watering Can',    station: 'bench', cost: { ingot: 2, nail: 2 },            out: { key: 'tool_can', n: 1 },    time: 12, xp: 6,  lvl: 1, art: 'ftool_1',  desc: 'Rose spout, so it never floods a bed.' },
    { key: 'b_spade',  name: 'Spade',           station: 'bench', cost: { plank: 1, ingot: 1 },           out: { key: 'tool_spade', n: 1 },  time: 10, xp: 5,  lvl: 2, art: 'ftool_2',  desc: 'Short handle, wide blade.' },
    { key: 'b_rake',   name: 'Rake',            station: 'bench', cost: { plank: 2, nail: 4 },            out: { key: 'tool_rake', n: 1 },   time: 10, xp: 5,  lvl: 2, art: 'ftool_3',  desc: 'Combs kelp and grit off the planks.' },
    { key: 'b_sickle', name: 'Sickle',          station: 'bench', cost: { ingot: 2, plank: 1 },           out: { key: 'tool_sickle', n: 1 }, time: 14, xp: 8,  lvl: 2, art: 'ftool_4',  desc: 'Takes a crop off at the root.' },
    {
      key: 'b_gloves', name: 'Work Gloves', station: 'bench', cost: { plank: 1, nail: 2 }, money: 40,
      out: null, time: 10, xp: 8, lvl: 1, art: 'ftool_11', desc: 'Barnacles stop biting back.',
      apply: function (g) { g.gear.gloves = true; },
      done: function (g) { return !!g.gear.gloves; },
    },
    {
      key: 'b_lamp', name: 'Dive Lamp', station: 'bench', cost: { lens: 1, ingot: 1, nail: 2 },
      out: null, time: 22, xp: 20, lvl: 3, art: 'g_torch', desc: 'The deep stops being a rumour.',
      apply: function (g) { g.gear.lamp = true; },
      done: function (g) { return !!g.gear.lamp; },
    },

    // -- furnace -----------------------------------------------------------
    { key: 'f_kiln',  name: 'Charcoal',     station: 'forge', cost: { driftwood: 3 }, out: { key: 'charcoal', n: 2 }, time: 14, xp: 3,  lvl: 1, nofuel: true, art: null, desc: 'Bank the driftwood, choke the air, wait.' },
    { key: 'f_ingot', name: 'Iron Ingot',   station: 'forge', cost: { ore: 2 },       out: { key: 'ingot', n: 1 },    time: 18, xp: 6,  lvl: 1, art: 'res_ingot', desc: 'Ore down to a bar, slag off the top.' },
    { key: 'f_melt',  name: 'Scrap Melt',   station: 'forge', cost: { nail: 6 },      out: { key: 'ingot', n: 1 },    time: 20, xp: 5,  lvl: 2, art: 'res_ingot', desc: 'A jar of old nails is still iron.' },
    { key: 'f_glass', name: 'Sea Glass',    station: 'forge', cost: { sand: 3 },      out: { key: 'glass', n: 1 },    time: 16, xp: 6,  lvl: 2, art: null, desc: 'Grit, held white-hot until it runs.' },
    { key: 'f_lens',  name: 'Crystal Lens', station: 'forge', cost: { glass: 1, crystal: 1 }, out: { key: 'lens', n: 1 }, time: 30, xp: 18, lvl: 3, art: null, desc: 'Slow heat, slower cooling, no cracks.' },

    // -- sawmill -----------------------------------------------------------
    { key: 'm_plank', name: 'Cut Planks', station: 'mill', cost: { driftwood: 2 },      out: { key: 'plank', n: 2 }, time: 6,  xp: 3, lvl: 1, art: 'res_plank', desc: 'Two good boards out of every log.' },
    { key: 'm_grit',  name: 'Grit Sand',  station: 'mill', cost: { stone: 2 },          out: { key: 'sand', n: 3 },  time: 8,  xp: 3, lvl: 1, art: null,        desc: 'The grindstone eats rock for breakfast.' },
    { key: 'm_beam',  name: 'Oak Beam',   station: 'mill', cost: { plank: 3, nail: 2 }, out: { key: 'beam', n: 1 },  time: 16, xp: 8, lvl: 2, art: null,        desc: 'Three boards laminated into one timber.' },
    { key: 'm_board', name: 'Split Beam', station: 'mill', cost: { beam: 1 },           out: { key: 'plank', n: 5 }, time: 12, xp: 6, lvl: 3, art: 'res_plank', desc: 'A beam back down to boards, at a profit.' },

    // -- smithy ------------------------------------------------------------
    { key: 'a_nail',   name: 'Nails',        station: 'anvil', cost: { ingot: 1 },                     out: { key: 'nail', n: 6 },       time: 8,  xp: 3,  lvl: 1, art: 'res_nail',    desc: 'Six from a bar, if you are quick.' },
    { key: 'a_ball',   name: 'Cannonballs',  station: 'anvil', cost: { ingot: 1, stone: 2 },           out: { key: 'cannonball', n: 3 }, time: 12, xp: 5,  lvl: 1, art: null,          desc: 'Iron skin over a stone core.' },
    { key: 'a_pick2',  name: 'Stone Pick',   station: 'anvil', cost: { plank: 2, stone: 4, nail: 2 },  out: { key: 'pick_stone', n: 1 }, time: 20, xp: 10, lvl: 1, art: null,          desc: 'Bites coal, iron and scrap.' },
    { key: 'a_pick3',  name: 'Iron Pick',    station: 'anvil', cost: { beam: 1, ingot: 3, nail: 4 },   out: { key: 'pick_iron', n: 1 },  time: 30, xp: 18, lvl: 2, art: null,          desc: 'Splits gold and sunken wrecks.' },
    { key: 'a_pick4',  name: 'Crystal Pick', station: 'anvil', cost: { beam: 1, ingot: 4, crystal: 2 }, out: { key: 'pick_crystal', n: 1 }, time: 45, xp: 34, lvl: 4, art: null,      desc: 'The only thing that touches crystal.' },
    { key: 'a_cutlass', name: 'Cutlass',     station: 'anvil', cost: { ingot: 3, plank: 1, nail: 2 },  out: { key: 'cutlass', n: 1 },    time: 26, xp: 16, lvl: 2, art: 'wpn_cutlass', desc: 'Folded twice, edged once, kept sharp.' },
    { key: 'a_flint',  name: 'Flintlock',    station: 'anvil', cost: { ingot: 2, beam: 1, crystal: 1 }, out: { key: 'flintlock', n: 1 }, time: 34, xp: 24, lvl: 3, art: 'wpn_flint',   desc: 'A crystal for a flint. It sparks blue.' },
    { key: 'a_bomb',   name: 'Powder Bombs', station: 'anvil', cost: { glass: 1, charcoal: 2, sand: 2 }, out: { key: 'bomb', n: 2 },     time: 18, xp: 10, lvl: 2, art: 'wpn_bomb',    desc: 'Two jars, short fuses, handle gently.' },
    { key: 'a_helm',   name: 'Diving Helm',  station: 'anvil', cost: { ingot: 2, glass: 1, nail: 2 },  out: { key: 'helm', n: 1 },       time: 24, xp: 14, lvl: 2, art: 'g_helmet',    desc: 'Brass and glass. Keeps the deep out.' },
    { key: 'a_vest',   name: 'Plate Vest',   station: 'anvil', cost: { ingot: 4, nail: 4 },            out: { key: 'vest', n: 1 },       time: 30, xp: 20, lvl: 3, art: 'g_suit',      desc: 'Iron scales over canvas. Slow, but safe.' },
    { key: 'a_cannon', name: 'Deck Cannon',  station: 'anvil', cost: { ingot: 6, beam: 2, nail: 8 },   out: { key: 'cannon_kit', n: 1 }, time: 60, xp: 45, lvl: 4, art: 'wpn_cannon',  desc: 'Sixty seconds of hammering. Worth it.' },
  ],

  // ---- integrator hooks ----------------------------------------------------
  // Permissive by default: with no skills module every recipe is unlocked.
  levelOf: function (skill) { return 99; },
  xp: function (skill, n) { },
  onMade: function (recipe, key, n) { },
  // Rummaging is fine on the planks and indoors. It is NOT fine mid-dive: those
  // scenes keep updating under a borrowed-slot modal (air drains, sharks close),
  // and freezing them instead would just be a free pause button.
  canOpenIn: function (scene) {
    if (typeof WorldScene !== 'undefined' && scene === WorldScene) return true;
    if (typeof HouseScene !== 'undefined' && scene === HouseScene) return true;
    return false;
  },
  // Set false BEFORE DOMContentLoaded if js/integrate.js concats Inv.spots() and
  // calls Inv.drawDock itself; otherwise this module wires its own deck presence.
  selfWire: true,

  // ---- state ---------------------------------------------------------------
  open: false,
  mode: null,          // null | 'bag' | 'station'
  st: 'bench',         // station key the panel is showing
  sel: 0,              // selected recipe, index into the station's recipe list
  scroll: 0,
  hover: -1,           // hovered bag cell
  pick: -1,            // selected bag cell (the detail card falls back to it)
  // A drag NEVER lifts the stack out of the grid -- it only remembers which cell
  // the gesture started in. The autosave fires every 25 s and would otherwise be
  // able to persist a bag with a stack in mid-air, i.e. lose it.
  drag: null,          // { from }
  note: '',
  noteT: 0,
  time: 0,
  fx: null,
  _stamp: -1,
  _installed: false,
  _waterHinted: false,
  _hbStamp: -1,
  _wasDown: false,
  _pressX: 0,
  _pressY: 0,
  _byKey: null,
  _byStation: null,
  _hotTool: null,
  _order: null,
  _deco: null,
  _nl: null,           // the slot array we last deep-normalised
  _nj: null,           // ditto for the job array

  // ==== normalising =========================================================
  _emptyState: function () {
    return { slots: [], jobs: [], fuel: 0, tab: 'bench', lastDay: 1 };
  },

  _cleanStack: function (s) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.key !== 'string' || !s.key) return null;
    var n = Math.floor(s.n);
    if (!isFinite(n) || n <= 0) return null;
    var cap = this.stackCap(s.key);
    return { key: s.key, n: n > cap ? cap : n };
  },

  // Called at the top of EVERY entry point. False while G is null (before boot)
  // so callers can bail without a null check of their own.
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    if (!this._byKey) this._buildIndex();

    var s = G.inv;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { s = G.inv = this._emptyState(); }

    var n = this.COLS * this.ROWS, i;
    // Deep pass only when the array is not the one we already normalised: a load
    // hands back a new reference, and every mutation in here goes through the
    // helpers below, so a clean array stays clean.
    if (s.slots !== this._nl || !Array.isArray(s.slots) || s.slots.length !== n) {
      var old = Array.isArray(s.slots) ? s.slots : [];
      var next = new Array(n);
      for (i = 0; i < n; i++) next[i] = this._cleanStack(old[i]);
      s.slots = next;
      // A grid that shrank between builds must not silently eat the overflow.
      for (i = n; i < old.length; i++) {
        var extra = this._cleanStack(old[i]);
        if (extra) this._fill(next, extra.key, extra.n);
      }
      this._nl = s.slots;
    }

    // Same story for the queue: rebuild it only when the array is not the one we
    // already cleaned. Every push in here is already a well-formed job, so
    // re-validating twelve objects sixty times a second would be pure garbage.
    if (!Array.isArray(s.jobs)) { s.jobs = []; this._nj = s.jobs; }
    if (s.jobs !== this._nj) {
      var keep = [];
      for (i = 0; i < s.jobs.length && keep.length < this.MAX_JOBS * this.STATIONS.length; i++) {
        var j = this._cleanJob(s.jobs[i]);
        if (j) keep.push(j);
      }
      s.jobs = keep;
      this._nj = s.jobs;
    }

    var f = Number(s.fuel);
    s.fuel = isFinite(f) && f > 0 ? f : 0;
    if (!this.station_(s.tab)) s.tab = 'bench';
    var d = Math.floor(s.lastDay);
    if (!isFinite(d) || d < 1) d = G.day;
    // a rolled-back save or a new game must not leave a nightly pass in the future
    s.lastDay = d > G.day ? G.day : d;
    return true;
  },

  _cleanJob: function (j) {
    if (!j || typeof j !== 'object') return null;
    var r = this.recipe(j.key);
    if (!r) return null;
    var dur = Number(j.dur);
    if (!isFinite(dur) || dur <= 0) dur = r.time > 0 ? r.time : 1;
    var t = Number(j.t);
    if (!isFinite(t) || t < 0) t = 0;
    if (t > dur) t = dur;
    return { st: r.station, key: r.key, t: t, dur: dur };
  },

  // Recipe / station lookup tables and the reverse hotbar map, built once.
  _buildIndex: function () {
    var i, r;
    this._byKey = {};
    this._byStation = {};
    for (i = 0; i < this.STATIONS.length; i++) this._byStation[this.STATIONS[i].key] = [];
    for (i = 0; i < this.RECIPES.length; i++) {
      r = this.RECIPES[i];
      this._byKey[r.key] = r;
      if (this._byStation[r.station]) this._byStation[r.station].push(r);
    }
    this._hotTool = {};
    this._order = {};
    var k, o = 0;
    for (k in this.DEF) {
      if (!Object.prototype.hasOwnProperty.call(this.DEF, k)) continue;
      this._order[k] = o++;
      var d = this.DEF[k];
      if (d.hot && d.stack === 1) this._hotTool[d.hot] = k;
    }
    this._buildDeco();
    this._buildFx();
  },

  // ==== item lookup =========================================================
  def: function (key) {
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(this.DEF, key)) return this.DEF[key];
    return null;
  },

  name: function (key) {
    var d = this.def(key);
    if (d) return d.name;
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) return ITEMS[key].name;
    if (typeof Craft !== 'undefined' && Craft.MATS && Craft.MATS[key] && Craft.MATS[key].name) return Craft.MATS[key].name;
    if (typeof Mining !== 'undefined' && Mining.RES && Mining.RES[key] && Mining.RES[key].name) return Mining.RES[key].name;
    if (typeof Hotbar !== 'undefined' && Hotbar.ITEM_NAMES && Hotbar.ITEM_NAMES[key]) return Hotbar.ITEM_NAMES[key];
    return this._pretty(key);
  },

  desc: function (key) {
    var d = this.def(key);
    if (d && d.desc) return d.desc;
    if (typeof Craft !== 'undefined' && Craft.MATS && Craft.MATS[key] && Craft.MATS[key].desc) return Craft.MATS[key].desc;
    return 'Otto is not sure what this is for yet.';
  },

  value: function (key) {
    var d = this.def(key);
    if (d && typeof d.value === 'number') return d.value;
    if (typeof ITEMS !== 'undefined' && ITEMS[key] && typeof ITEMS[key].price === 'number') return ITEMS[key].price;
    if (typeof Mining !== 'undefined' && Mining.RES && Mining.RES[key] && typeof Mining.RES[key].value === 'number') return Mining.RES[key].value;
    return 0;
  },

  stackCap: function (key) {
    var d = this.def(key);
    if (d && typeof d.stack === 'number' && d.stack > 0) return Math.floor(d.stack);
    return this.DEF_STACK;
  },

  _pretty: function (key) {
    var s = String(key).replace(/[_-]+/g, ' ');
    return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  },

  _hasArt: function (n) {
    return !!(n && typeof ASSETS !== 'undefined' && ASSETS[n] && ASSETS[n].width);
  },

  // ==== ICON MAP ============================================================
  // Every key the bag can hold that no catalogue already names art for. Missing
  // art is SILENT in this codebase -- drawIcon quietly falls back to a hand-coded
  // glyph -- so a key with no art does not look broken, it looks like a different,
  // blander game. Thirty-two of forty-two keys were drawing coded shapes while the
  // real sprites for nearly all of them sat unused in assets/.
  //
  // The three shell families do most of the work here, and they map by MEANING:
  //   shell_*  a whole shell, closed          -> the shell you collect
  //   open_*   the same shell opened, meat in -> the meat you shuck out of it
  //   crust_*  the same shell under barnacles -> barnacle
  // so clamMeat is an open clam rather than a generic lump, and the polished goods
  // get the opened, bright version of the shell they came from.
  //
  // dev/smoke-icons.js walks every catalogue and fails if ANY bag key still falls
  // through to a glyph, so this table cannot silently rot as items are added.
  ART_MAP: {
    // shells, as collected
    clam: 'shell_clam',
    mussel: 'shell_mussel',
    oyster: 'ic_oyster',
    abalone: 'shell_abalone',
    pearl: 'shell_pearl',
    // shucked: the open shell with what is inside on show
    clamMeat: 'open_clam',
    musselMeat: 'open_mussel',
    oysterMeat: 'open_scallop',
    // polished: the bright inner faces, so they read as a step up from the raw shell
    pearlPol: 'open_pearl',
    abalonePol: 'open_abalone',
    barnacle: 'crust_cockle',

    // raw materials
    charcoal: 'ore_coal',
    iron: 'ore_scrap',
    rope: 'ic_rope',
    water: 'ic_barrel',
    fertiliser: 'ic_coalsack',

    // cooking. Two of these borrow an animal's product sprite, which is the right
    // picture rather than a shortcut: roe IS the sunfish's roe cluster, and Moon
    // Custard is a bottle of cream. Sharing art between two keys is fine -- what
    // matters is that the icon shows the thing.
    roe: 'stock_sunfish_p',
    custard: 'stock_puffer_p',
    chowder: 'ic_chowder',
    pearlband: 'open_pearl',   // the keepsake: a pearl in an open shell reads as a ring box
    planter: 'bed_1',
    grill: 'ic_grill',
    rolls: 'ic_rolls',
    skewer: 'ic_skewer',
    tea: 'ic_tea',
  },

  _artOf: function (key) {
    var d = this.def(key);
    if (d && this._hasArt(d.art)) return d.art;
    if (this.ART_MAP[key] && this._hasArt(this.ART_MAP[key])) return this.ART_MAP[key];
    if (typeof Mining !== 'undefined' && Mining.RES && Mining.RES[key] && this._hasArt(Mining.RES[key].art)) return Mining.RES[key].art;
    // Farm keys its produce by the PRODUCE BIN ('blade'), not by the crop or the
    // sprite ('sea_kelp_p'), so nothing here could ever have guessed the asset name
    // from the key. Same for its seed packets and for animal produce.
    if (typeof Farm !== 'undefined' && Farm) {
      if (Farm.PRODUCE && Farm.PRODUCE[key] && this._hasArt(Farm.PRODUCE[key].art)) return Farm.PRODUCE[key].art;
      if (Farm.SEEDS && Farm.SEEDS[key] && this._hasArt(Farm.SEEDS[key].art)) return Farm.SEEDS[key].art;
    }
    if (typeof Tame !== 'undefined' && Tame && Tame.PRODUCE && Tame.PRODUCE[key] &&
        this._hasArt(Tame.PRODUCE[key].art)) return Tame.PRODUCE[key].art;
    if (typeof Craft !== 'undefined' && Craft) {
      if (Craft.RES && Craft.RES[key] && this._hasArt(Craft.RES[key].art)) return Craft.RES[key].art;
      if (Craft.ITEMS && Craft.ITEMS[key] && this._hasArt(Craft.ITEMS[key].art)) return Craft.ITEMS[key].art;
    }
    if (this._hasArt(key)) return key;
    return null;
  },

  // ==== the bag =============================================================
  slots: function () { return this.ensure() ? G.inv.slots : []; },
  capacity: function () { return this.COLS * this.ROWS; },

  count: function (key) {
    if (!this.ensure() || !key) return 0;
    var a = G.inv.slots, c = 0;
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].key === key) c += a[i].n;
    return c;
  },

  used: function () {
    if (!this.ensure()) return 0;
    var a = G.inv.slots, c = 0;
    for (var i = 0; i < a.length; i++) if (a[i]) c++;
    return c;
  },

  free: function () { return this.capacity() - this.used(); },

  totalValue: function () {
    if (!this.ensure()) return 0;
    var a = G.inv.slots, v = 0;
    for (var i = 0; i < a.length; i++) if (a[i]) v += this.value(a[i].key) * a[i].n;
    return v;
  },

  // Room for n of key without displacing anything, so a caller can check before
  // it commits (a finished job asks this before it hands the output over).
  room: function (key, n) {
    if (!this.ensure()) return 0;
    var a = G.inv.slots, cap = this.stackCap(key), r = 0, i;
    for (i = 0; i < a.length; i++) {
      if (!a[i]) r += cap;
      else if (a[i].key === key && a[i].n < cap) r += cap - a[i].n;
      if (r >= n) return n;
    }
    return r;
  },

  // Fills matching stacks first, then empty slots. Returns the LEFTOVER, so the
  // caller decides whether to spill, refuse or warn. js/integrate.js already
  // routes Mining's loot through here.
  add: function (key, n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0) return 0;
    if (!this.ensure() || typeof key !== 'string' || !key) return n;
    return this._fill(G.inv.slots, key, n);
  },

  _fill: function (a, key, n) {
    var cap = this.stackCap(key), i, take;
    for (i = 0; i < a.length && n > 0; i++) {
      if (!a[i] || a[i].key !== key || a[i].n >= cap) continue;
      take = cap - a[i].n;
      if (take > n) take = n;
      a[i].n += take;
      n -= take;
    }
    for (i = 0; i < a.length && n > 0; i++) {
      if (a[i]) continue;
      take = n > cap ? cap : n;
      a[i] = { key: key, n: take };
      n -= take;
    }
    return n;
  },

  // All or nothing: a partial spend is always a bug.
  remove: function (key, n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0) return true;
    if (!this.ensure() || this.count(key) < n) return false;
    var a = G.inv.slots, i, take;
    // smallest stacks first, so partials get tidied away
    var order = [];
    for (i = 0; i < a.length; i++) if (a[i] && a[i].key === key) order.push(i);
    order.sort(function (x, y) { return a[x].n - a[y].n; });
    for (i = 0; i < order.length && n > 0; i++) {
      take = a[order[i]].n < n ? a[order[i]].n : n;
      a[order[i]].n -= take;
      n -= take;
      if (a[order[i]].n <= 0) a[order[i]] = null;
    }
    return true;
  },

  // ---- the wider counting seam --------------------------------------------
  // The bins a cost may be paid from, in spend order. have() and spend() walk
  // this same list so "held" and "spendable" can never disagree.
  // One accessor for the optional hotbar. `typeof` alone is not enough: a module
  // that half-loaded can leave the name bound to null, and `!null.count` throws.
  _hb: function () {
    if (typeof Hotbar === 'undefined' || !Hotbar) return null;
    return Hotbar;
  },

  _hotCount: function (key) {
    var hb = this._hb();
    if (!hb || !hb.count) return 0;
    return hb.count('item', key);          // BOTH arguments -- see hotbar.js
  },

  _storeCount: function (key) {
    if (!G || !G.storage) return 0;
    if (!Object.prototype.hasOwnProperty.call(G.storage, key)) return 0;
    var n = G.storage[key];
    return (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
  },

  have: function (key) {
    if (!this.ensure()) return 0;
    return this.count(key) + this._hotCount(key) + this._storeCount(key);
  },

  spend: function (key, n) {
    n = Math.floor(n === undefined ? 1 : n);
    if (!isFinite(n) || n <= 0) return true;
    if (!this.ensure() || this.have(key) < n) return false;
    var got = this.count(key);
    if (got > 0) {
      var fromBag = got < n ? got : n;
      this.remove(key, fromBag);
      n -= fromBag;
    }
    var hb = this._hb();
    if (n > 0 && hb && hb.take) n -= hb.take('item', key, n);
    if (n > 0) {
      var s = this._storeCount(key);
      var fromStore = s < n ? s : n;
      if (fromStore > 0) { G.storage[key] = s - fromStore; n -= fromStore; }
    }
    return n <= 0;
  },

  // Materials go back where there is room; the bag first, then flat storage so a
  // refund can never evaporate because the grid happened to be full.
  _refund: function (key, n) {
    var left = this.add(key, n);
    if (left > 0 && G && G.storage) G.storage[key] = this._storeCount(key) + left;
  },

  // ---- tidying -------------------------------------------------------------
  stackAll: function () {
    if (!this.ensure()) return 0;
    var a = G.inv.slots, i, j, merged = 0, cap;
    for (i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      cap = this.stackCap(a[i].key);
      if (a[i].n >= cap) continue;
      for (j = i + 1; j < a.length && a[i].n < cap; j++) {
        if (!a[j] || a[j].key !== a[i].key) continue;
        var take = cap - a[i].n;
        if (take > a[j].n) take = a[j].n;
        a[i].n += take;
        a[j].n -= take;
        merged += take;
        if (a[j].n <= 0) a[j] = null;
      }
    }
    return merged;
  },

  sort: function () {
    if (!this.ensure()) return;
    this.stackAll();
    var a = G.inv.slots, list = [], i;
    for (i = 0; i < a.length; i++) if (a[i]) list.push(a[i]);
    var self = this;
    list.sort(function (x, y) {
      var ox = Object.prototype.hasOwnProperty.call(self._order, x.key) ? self._order[x.key] : 900;
      var oy = Object.prototype.hasOwnProperty.call(self._order, y.key) ? self._order[y.key] : 900;
      if (ox !== oy) return ox - oy;
      var nx = self.name(x.key), ny = self.name(y.key);
      if (nx !== ny) return nx < ny ? -1 : 1;
      return y.n - x.n;
    });
    for (i = 0; i < a.length; i++) a[i] = i < list.length ? list[i] : null;
    this.pick = -1;
  },

  // Pull the bag's own material keys out of flat G.storage. Diving hauls and farm
  // produce are deliberately left alone: Shop's SELL tab walks G.storage, so
  // hoovering those up would break selling them.
  gather: function () {
    if (!this.ensure() || !G.storage) return 0;
    var moved = 0, k, n, left;
    for (k in this.DEF) {
      if (!Object.prototype.hasOwnProperty.call(this.DEF, k)) continue;
      n = this._storeCount(k);
      if (n <= 0) continue;
      left = this.add(k, n);
      if (left === n) continue;
      G.storage[k] = left;
      moved += n - left;
    }
    return moved;
  },

  // ---- hotbar shuttle ------------------------------------------------------
  _hotShape: function (key) {
    var d = this.def(key);
    if (d && d.hot && d.stack === 1) return { kind: 'tool', key: d.hot };
    return { kind: 'item', key: key };
  },

  // bag slot -> hotbar. Returns true if anything moved.
  toBar: function (i) {
    var hb = this._hb();
    if (!this.ensure() || !hb || !hb.give) return false;
    var s = G.inv.slots[i];
    if (!s) return false;
    var shape = this._hotShape(s.key);
    if (shape.kind === 'tool') {
      // Hotbar.give returns 0 for a duplicate tool as well as for a placement,
      // so ask first -- otherwise a second hoe would vanish out of the bag.
      if (hb.count && hb.count('tool', shape.key) > 0) {
        this._say('already on the bar');
        SND.blip();
        return false;
      }
      if (hb.give('tool', shape.key, 1) > 0) { this._say('the bar is full'); SND.blip(); return false; }
      this.remove(s.key, 1);
    } else {
      var left = hb.give('item', shape.key, s.n);
      if (left >= s.n) { this._say('the bar is full'); SND.blip(); return false; }
      this.remove(s.key, s.n - left);
    }
    SND.click();
    this._buzz(8);
    Game.save();
    return true;
  },

  // hotbar slot -> bag.
  fromBar: function (i) {
    var hb = this._hb();
    if (!this.ensure() || !hb || !hb.slot || !hb.take) return false;
    var s = hb.slot(i);
    if (!s || !s.kind) return false;
    var key = s.kind === 'tool' ? (this._hotTool[s.key] || s.key) : s.key;
    var n = s.kind === 'tool' ? 1 : s.n;
    var left = this.add(key, n);
    if (left >= n) { this._say('the bag is full'); SND.blip(); return false; }
    hb.take(s.kind, s.key, n - left);
    SND.click();
    this._buzz(8);
    Game.save();
    return true;
  },

  // ==== recipes =============================================================
  recipe: function (key) {
    if (!key) return null;
    if (!this._byKey) this._buildIndex();
    if (typeof key === 'object') return this._byKey[key.key] || null;
    return Object.prototype.hasOwnProperty.call(this._byKey, key) ? this._byKey[key] : null;
  },

  station_: function (key) {
    for (var i = 0; i < this.STATIONS.length; i++) if (this.STATIONS[i].key === key) return this.STATIONS[i];
    return null;
  },

  stationIndex: function (key) {
    for (var i = 0; i < this.STATIONS.length; i++) if (this.STATIONS[i].key === key) return i;
    return 0;
  },

  recipesAt: function (stKey) {
    if (!this._byKey) this._buildIndex();
    return this._byStation[stKey] || [];
  },

  skillOf: function (r) {
    if (r.skill) return r.skill;
    var s = this.station_(r.station);
    return s ? s.skill : 'crafting';
  },

  levelFor: function (r) { return Math.max(1, Math.floor(r.lvl || 1)); },

  locked: function (r) {
    var lv = 0;
    if (typeof this.levelOf === 'function') lv = Number(this.levelOf(this.skillOf(r)));
    if (!isFinite(lv)) lv = 99;
    return lv < this.levelFor(r);
  },

  jobsAt: function (stKey) {
    if (!this.ensure()) return [];
    var out = [], a = G.inv.jobs;
    for (var i = 0; i < a.length; i++) if (a[i].st === stKey) out.push(a[i]);
    return out;
  },

  // The one job a station is actually working on. Everything else waits.
  activeJob: function (stKey) {
    if (!this.ensure()) return null;
    var a = G.inv.jobs;
    for (var i = 0; i < a.length; i++) if (a[i].st === stKey) return a[i];
    return null;
  },

  jobReady: function (j) { return !!j && j.t >= j.dur; },

  // Why this cannot be made right now, as a line of player-facing copy, or null.
  missing: function (r) {
    if (!this.ensure()) return 'nothing to make';
    r = this.recipe(r);
    if (!r) return 'nothing to make';
    if (this.locked(r)) return 'needs ' + this.skillOf(r) + ' ' + this.levelFor(r);
    if (typeof r.done === 'function' && r.done(G)) return 'otto already has one';
    if (this.jobsAt(r.station).length >= this.MAX_JOBS) return 'the queue is full';
    if (r.money && G.money < r.money) return 'Not enough sand dollars!';
    var k, need;
    for (k in r.cost) {
      if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
      need = r.cost[k] - this.have(k);
      if (need > 0) return 'need ' + need + ' more ' + this.name(k).toLowerCase();
    }
    if (!r.time && r.out && this.room(r.out.key, r.out.n) < r.out.n) return 'the bag is full';
    return null;
  },

  can: function (r) { return this.missing(r) === null; },

  // Spend the cost and either finish now (time 0) or queue the job.
  craft: function (r) {
    if (!this.ensure()) return false;
    r = this.recipe(r);
    if (!r) return false;
    var why = this.missing(r);
    if (why) {
      this._say(why);
      if (why === 'Not enough sand dollars!') { Game.toast(why); SND.alarm(); }
      else if (why === 'the queue is full' || why === 'otto already has one') SND.blip();
      else SND.alarm();
      return false;
    }

    var k;
    for (k in r.cost) {
      if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
      this.spend(k, r.cost[k]);
    }
    if (r.money) G.money -= r.money;

    if (r.time > 0) {
      G.inv.jobs.push({ st: r.station, key: r.key, t: 0, dur: r.time });
      this._say(r.name + ' -- started');
      this._stationSound(r.station);
      this._burst(r.station, 6);
    } else {
      this._deliver({ st: r.station, key: r.key, t: 1, dur: 1 });
    }
    this._buzz(15);
    Game.save();
    return true;
  },

  // Hand a finished job's output over. Returns false when the bag has no room,
  // in which case the job STAYS ready and waits to be collected.
  _deliver: function (job) {
    var r = this.recipe(job.key);
    if (!r) return true;
    var madeKey = null, madeN = 0;
    if (r.out) {
      if (this.room(r.out.key, r.out.n) < r.out.n) return false;
      this.add(r.out.key, r.out.n);
      madeKey = r.out.key;
      madeN = r.out.n;
    }
    if (typeof r.apply === 'function') r.apply(G);
    if (r.xp && typeof this.xp === 'function') this.xp(this.skillOf(r), r.xp);
    if (typeof this.onMade === 'function') this.onMade(r, madeKey, madeN);
    var label = madeKey ? (madeN > 1 ? madeN + 'x ' + this.name(madeKey) : this.name(madeKey)) : r.name;
    Game.toast(label + ' -- done');
    if (r.xp >= 18) SND.chime(); else SND.pop(1.1);
    this._burst(r.station, 8);
    return true;
  },

  // Drop a queued job and hand the materials back.
  cancelJob: function (job) {
    if (!this.ensure() || !job) return false;
    var a = G.inv.jobs, i = a.indexOf(job);
    if (i < 0) return false;
    var r = this.recipe(job.key);
    a.splice(i, 1);
    if (r) {
      var k;
      for (k in r.cost) {
        if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
        this._refund(k, r.cost[k]);
      }
      if (r.money) G.money += r.money;
      this._say(r.name + ' pulled off the bench');
    }
    SND.blip();
    Game.save();
    return true;
  },

  collectJob: function (job) {
    if (!this.ensure() || !this.jobReady(job)) return false;
    if (!this._deliver(job)) { this._say('the bag is full'); SND.alarm(); return false; }
    var a = G.inv.jobs, i = a.indexOf(job);
    if (i >= 0) a.splice(i, 1);
    this._buzz(12);
    Game.save();
    return true;
  },

  // ---- the furnace's fire --------------------------------------------------
  fuel: function () { return this.ensure() ? G.inv.fuel : 0; },
  fuelFrac: function () { return clamp(this.fuel() / this.FUEL_PER_COAL, 0, 1); },

  // Burn one charcoal. Called by hand from the [stoke] button and automatically
  // when a smelt would otherwise stall, so the player is never stuck poking a
  // gauge -- the charcoal is the cost, the clicking is not.
  stoke: function (quiet) {
    if (!this.ensure()) return false;
    if (!this.spend('charcoal', 1)) {
      if (!quiet) { this._say('no charcoal -- burn some driftwood first'); SND.alarm(); }
      return false;
    }
    G.inv.fuel += this.FUEL_PER_COAL;
    if (!quiet) { SND.thump(0.45); this._say('the furnace takes the coal'); }
    this._burst('forge', 7);
    return true;
  },

  // One job per station at a time; the rest of that station's queue waits. A
  // finished job that the bag has no room for STAYS ready and blocks the bench
  // until it is collected, which is the honest way to tell the player.
  _tickJobs: function (dt) {
    var s = G.inv, a = s.jobs, i, j, r, st;
    for (i = 0; i < this.STATIONS.length; i++) {
      st = this.STATIONS[i];
      j = null;
      for (var q = 0; q < a.length; q++) if (a[q].st === st.key) { j = a[q]; break; }
      if (!j) continue;
      if (j.t >= j.dur) {
        if (this._deliver(j)) a.splice(a.indexOf(j), 1);
        continue;
      }
      r = this.recipe(j.key);
      if (!r) { a.splice(a.indexOf(j), 1); continue; }
      if (st.fuel && !r.nofuel) {
        if (s.fuel <= 0) this.stoke(true);
        if (s.fuel <= 0) continue;                 // stalled cold, nothing burns
        s.fuel -= dt;
        if (s.fuel < 0) s.fuel = 0;
      }
      j.t += dt;
      if (j.t >= j.dur) {
        j.t = j.dur;
        if (this._deliver(j)) a.splice(a.indexOf(j), 1);
        Game.save();
      }
    }
  },

  stalled: function (stKey) {
    var st = this.station_(stKey);
    if (!st || !st.fuel) return false;
    var j = this.activeJob(stKey);
    if (!j || this.jobReady(j)) return false;
    var r = this.recipe(j.key);
    return !!r && !r.nofuel && this.fuel() <= 0;
  },

  // ---- the nightly pass ----------------------------------------------------
  // Sleeping is eight hours: every bench finishes what it was holding. Driven
  // off a persisted lastDay because the clock-driven day roll in
  // Game.globalUpdate is NOT hooked by integrate.js -- only sleeping is.
  newDay: function () {
    if (!this.ensure()) return;
    var s = G.inv;
    if (s.lastDay >= G.day) return;
    var guard = 0;
    while (s.lastDay < G.day && guard++ < 30) { this._night(); s.lastDay++; }
    s.lastDay = G.day;
    Game.save();
  },

  _night: function () {
    var a = G.inv.jobs, i;
    for (i = a.length - 1; i >= 0; i--) {
      a[i].t = a[i].dur;
      if (this._deliver(a[i])) a.splice(i, 1);
    }
  },

  // ==== opening and closing =================================================
  _peerOpen: function () {
    if (typeof Shop !== 'undefined' && Shop.open) return true;
    if (typeof Bench !== 'undefined' && Bench.open) return true;
    if (typeof Game !== 'undefined' && Game.helpOpen) return true;
    if (typeof Craft !== 'undefined' && Craft.open) return true;
    if (typeof NPCs !== 'undefined' && NPCs.open) return true;
    if (typeof Stock !== 'undefined' && Stock.open) return true;
    if (typeof Farm !== 'undefined' && Farm.open) return true;
    if (typeof Battle !== 'undefined' && Battle.active) return true;
    return false;
  },

  _allowed: function () {
    if (typeof Game === 'undefined' || Game.fadeDir !== 0) return false;
    if (this._peerOpen()) return false;
    if (typeof this.canOpenIn === 'function' && !this.canOpenIn(Game.scene)) return false;
    return true;
  },

  openBag: function () {
    if (!this.ensure() || !this._allowed()) return false;
    this.mode = 'bag';
    this.open = true;
    this._openT = 0;
    this.hover = -1;
    this.pick = -1;
    this.drag = null;
    this._wasDown = Input.mouse.down;
    this.note = '';
    this.noteT = 0;
    // one-shot tutorial line; G.flags IS deep-merged, so this survives a save
    // that predates the bag
    if (!G.flags.invSeenBag) {
      G.flags.invSeenBag = true;
      Game.toast('drag a stack onto the bar to carry it');
    }
    SND.blip();
    return true;
  },

  station: function (key) {
    if (!this.ensure()) return false;
    if (this.open && this.mode === 'station' && this.st === key) return true;
    if (!this.open && !this._allowed()) return false;
    var st = this.station_(key) ? key : G.inv.tab;
    if (!this.station_(st)) st = 'bench';
    this.mode = 'station';
    this.open = true;
    this.st = st;
    G.inv.tab = st;
    // Nothing is selected to begin with, on purpose: a click on a row both
    // selects and (on the second click) makes, so a pre-selected first row would
    // turn one stray click into a spent recipe.
    this.sel = -1;
    this.scroll = 0;
    this.drag = null;
    this._wasDown = Input.mouse.down;
    this.note = '';
    this.noteT = 0;
    if (!G.flags.invSeenBench) {
      G.flags.invSeenBench = true;
      Game.toast('a job keeps working while you walk away');
    }
    SND.blip();
    return true;
  },

  close: function () {
    if (!this.open) return;
    this.drag = null;
    this.open = false;
    this.mode = null;
    SND.click();
    if (typeof G !== 'undefined' && G) Game.save();
  },

  toggleBag: function () {
    if (this.open && this.mode === 'bag') { this.close(); return; }
    if (this.open) { this.mode = 'bag'; this.hover = -1; SND.blip(); return; }
    if (this.openBag()) return;
    SND.blip();
    // Say why once a session, otherwise a refused keypress is just a mystery
    // beep. Not persisted: it is a reminder, not a tutorial.
    if (!this._waterHinted && !this._peerOpen() && Game.fadeDir === 0) {
      this._waterHinted = true;
      Game.toast('otto keeps the bag shut in the water');
    }
  },

  // ==== update ==============================================================
  update: function (dt) {
    this._openT = Math.min(1, this._openT + (dt || 0) * 4.5);
    if (!this.ensure()) return;
    // Both our own globalUpdate hook and a wiring layer may tick us; Game.time
    // advances exactly once a frame, so the first call in a frame wins.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    if (this.noteT > 0) this.noteT -= dt;

    if (G.inv.lastDay < G.day) this.newDay();
    this._tickJobs(dt);
    this._tickFx(dt);

    // The bag key works from anywhere it is allowed; while open it also closes.
    // Both edges are read (not short-circuited) so neither key can be left
    // pending in Input.pressed for something else to pick up next frame.
    if (Game.fadeDir === 0 && !Game.helpOpen) {
      var kTab = Input.p('Tab'), kI = Input.p('KeyI');
      if (kTab || kI) this.toggleBag();
    }

    if (!this.open) { this._wasDown = Input.mouse.down; return; }
    if (Game.fadeDir !== 0) { this.close(); return; }
    if (Game.helpOpen || (typeof Shop !== 'undefined' && Shop.open) ||
        (typeof Bench !== 'undefined' && Bench.open)) return;

    // Eat the keys the scene under us would otherwise act on, exactly as Craft
    // does: without this the deck spot re-fires and reopens the panel.
    Input.p('KeyE');
    Input.p('Space');
    Input.p('KeyH');
    if (Input.p('Escape')) { this.close(); return; }

    if (this.mode === 'bag') this._bagInput(dt);
    else this._stationInput(dt);
    this._wasDown = Input.mouse.down;
  },

  // ---- bag input -----------------------------------------------------------
  _bagInput: function (dt) {
    var m = Input.mouse, i;
    this.hover = this._cellAt(m.x, m.y);

    var pressed = m.clicked;
    var released = this._wasDown && !m.down;

    if (pressed) {
      this._pressX = m.x;
      this._pressY = m.y;
      if (this._in(this._closeRect(), m.x, m.y)) { this.close(); return; }
      if (this._in(this._btn('sort'), m.x, m.y)) {
        this.sort(); SND.scrape(); this._say('bag tidied'); Game.save(); return;
      }
      if (this._in(this._btn('stack'), m.x, m.y)) {
        var n = this.stackAll();
        if (n > 0) { SND.pop(1.2); this._say(n + ' merged into fuller stacks'); Game.save(); }
        else { SND.blip(); this._say('nothing left to merge'); }
        return;
      }
      if (this._in(this._btn('gather'), m.x, m.y)) {
        var g = this.gather();
        if (g > 0) { SND.pop(1); this._say('pulled ' + g + ' in from the crates'); Game.save(); }
        else { SND.blip(); this._say('the crates are empty'); }
        return;
      }
      // start a drag out of a filled cell (the stack stays put until we drop)
      if (this.hover >= 0 && G.inv.slots[this.hover] && !this.drag) {
        this.pick = this.hover;
        this.drag = { from: this.hover };
        return;
      }
      var hb = this._barAt(m.x, m.y);
      if (hb >= 0 && !this.drag) {
        // pick a stack up off the bar, or pull it straight into the bag
        this.fromBar(hb);
        return;
      }
      if (this.hover < 0 && hb < 0 && !this._in(this._window(), m.x, m.y)) { this.close(); return; }
    }

    if (released && this.drag) {
      var from = this.drag.from;
      var moved = Math.abs(m.x - this._pressX) + Math.abs(m.y - this._pressY);
      var cell = this._cellAt(m.x, m.y);
      var bar = this._barAt(m.x, m.y);
      this.drag = null;
      if (bar >= 0 || (moved < 3 && cell === from)) {
        // dropped on the bar, or a click rather than a drag: same intent either
        // way -- send it to the hotbar. toBar() says why when it cannot.
        this.toBar(from);
      } else if (cell >= 0 && cell !== from) {
        this._moveStack(from, cell);
        SND.click();
        this._buzz(8);
        Game.save();
      }
      return;
    }

    // wheel over the grid nudges the selection, which keeps the detail card
    // usable with no pointer at all
    if (Input.wheelDelta) {
      var cap = this.capacity();
      i = this.pick < 0 ? 0 : this.pick + (Input.wheelDelta > 0 ? 1 : -1);
      this.pick = ((i % cap) + cap) % cap;
    }
  },

  // Move the stack in `from` onto `to`: pour into it when the keys match, else
  // swap the two cells. Two full stacks of the same thing swap rather than
  // silently doing nothing, so the gesture always reads as having worked.
  _moveStack: function (from, to) {
    var a = G.inv.slots, s = a[from], t = a[to];
    if (!s || from === to) return;
    if (t && t.key === s.key) {
      var take = this.stackCap(s.key) - t.n;
      if (take > s.n) take = s.n;
      if (take > 0) {
        t.n += take;
        s.n -= take;
        if (s.n <= 0) a[from] = null;
      } else {
        a[from] = t;
        a[to] = s;
      }
    } else {
      a[from] = t || null;
      a[to] = s;
    }
    this.pick = to;
  },

  // ---- station input -------------------------------------------------------
  _stationInput: function (dt) {
    var m = Input.mouse, st = this.station_(this.st);
    if (!st) { this.st = this.STATIONS[0].key; return; }
    var list = this.recipesAt(this.st);
    var vis = st.layout === 'cards' ? this.CARD_COLS * this.CARD_ROWS : this.ROW_VIS;
    var maxScroll = Math.max(0, list.length - vis);
    var step = st.layout === 'cards' ? this.CARD_COLS : 1;

    // Digit1..4 pick a station when nothing upstream has eaten them (the hotbar
    // also wants those keys); the arrows always work, which is why they are the
    // documented way in.
    for (var i = 0; i < this.STATIONS.length; i++) {
      if (Input.p('Digit' + (i + 1))) { this.setStation(this.STATIONS[i].key); return; }
    }
    if (Input.p('ArrowLeft')) { this.setStation(this.STATIONS[(this.stationIndex(this.st) + this.STATIONS.length - 1) % this.STATIONS.length].key); return; }
    if (Input.p('ArrowRight')) { this.setStation(this.STATIONS[(this.stationIndex(this.st) + 1) % this.STATIONS.length].key); return; }
    if (Input.p('ArrowUp')) this._move(-1);
    if (Input.p('ArrowDown')) this._move(1);
    if (Input.wheelDelta) {
      this.scroll = clamp(this.scroll + (Input.wheelDelta > 0 ? step : -step), 0, maxScroll);
    }
    if (this.sel >= list.length) this.sel = Math.max(0, list.length - 1);
    this.scroll = clamp(this.scroll, 0, maxScroll);

    if (!m.clicked) return;

    if (this._in(this._closeRect(), m.x, m.y)) { this.close(); return; }
    for (i = 0; i < this.STATIONS.length; i++) {
      if (this._in(this._tabRect(i), m.x, m.y)) { this.setStation(this.STATIONS[i].key); return; }
    }
    if (this._in(this._arrow(-1), m.x, m.y)) { this.scroll = clamp(this.scroll - step, 0, maxScroll); SND.blip(); return; }
    if (this._in(this._arrow(1), m.x, m.y)) { this.scroll = clamp(this.scroll + step, 0, maxScroll); SND.blip(); return; }
    if (st.fuel && this._in(this._stokeRect(), m.x, m.y)) { this.stoke(false); return; }
    if (this._in(this._verbRect(), m.x, m.y)) {
      if (this.sel < 0 || this.sel >= list.length) { this._say('pick something off the shelf'); SND.blip(); }
      else this.craft(list[this.sel]);
      return;
    }

    // queue: ready jobs collect, running jobs cancel back to materials
    var jobs = this.jobsAt(this.st);
    for (i = 0; i < jobs.length && i < this.MAX_JOBS; i++) {
      if (!this._in(this._jobRect(i), m.x, m.y)) continue;
      if (this.jobReady(jobs[i])) this.collectJob(jobs[i]);
      else this.cancelJob(jobs[i]);
      return;
    }

    // rows / cards: first click selects, a second click on the same one makes it
    for (i = 0; i < vis; i++) {
      var idx = this.scroll + i;
      if (idx >= list.length) break;
      if (!this._in(this._itemRect(i), m.x, m.y)) continue;
      if (this.sel === idx) this.craft(list[idx]);
      else { this.sel = idx; SND.blip(); }
      return;
    }

    if (!this._in(this._window(), m.x, m.y)) this.close();
  },

  setStation: function (key) {
    if (!this.station_(key) || !this.ensure()) return;
    if (this.st === key) return;
    this.st = key;
    G.inv.tab = key;
    this.sel = -1;
    this.scroll = 0;
    SND.blip();
  },

  _move: function (d) {
    var list = this.recipesAt(this.st), st = this.station_(this.st);
    if (!list.length || !st) return;
    this.sel = clamp(this.sel + d, 0, list.length - 1);
    var vis = st.layout === 'cards' ? this.CARD_COLS * this.CARD_ROWS : this.ROW_VIS;
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + vis) this.scroll = this.sel - vis + 1;
    SND.blip();
  },

  // ==== geometry (shared by update and draw, so a hit box cannot drift) =====
  _in: function (r, x, y) { return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },

  _window: function () {
    if (this.mode === 'bag') return { x: this.BWX, y: this.BWY, w: this.BWW, h: this.BWH };
    return { x: this.SWX, y: this.SWY, w: this.SWW, h: this.SWH };
  },

  _closeRect: function () {
    var w = this._window();
    return { x: w.x + w.w - 26, y: w.y + 3, w: 22, h: 18 };
  },

  _cellRect: function (i) {
    var step = this.CELL + this.GAP;
    return {
      x: this.GX + (i % this.COLS) * step,
      y: this.GY + Math.floor(i / this.COLS) * step,
      w: this.CELL, h: this.CELL,
    };
  },

  _cellAt: function (x, y) {
    var step = this.CELL + this.GAP;
    var cx = Math.floor((x - this.GX) / step), cy = Math.floor((y - this.GY) / step);
    if (cx < 0 || cy < 0 || cx >= this.COLS || cy >= this.ROWS) return -1;
    if (x - this.GX - cx * step > this.CELL) return -1;    // in the gutter
    if (y - this.GY - cy * step > this.CELL) return -1;
    return cy * this.COLS + cx;
  },

  _btn: function (which) {
    var y = this.GY + this.ROWS * (this.CELL + this.GAP) + 6;
    if (which === 'sort') return { x: this.GX, y: y, w: 44, h: 15 };
    if (which === 'stack') return { x: this.GX + 48, y: y, w: 52, h: 15 };
    return { x: this.GX + 104, y: y, w: 58, h: 15 };       // gather
  },

  _cardRect: function () { return { x: this.CARD_X, y: this.CARD_Y, w: this.CARD_W, h: this.CARD_H }; },

  _barAt: function (x, y) {
    var hb = this._hb();
    if (this.mode !== 'bag' || !hb || !hb.hit) return -1;
    return hb.hit(x, y);
  },

  _tabRect: function (i) {
    return { x: this.SWX + 8 + i * (this.TAB_W + this.TAB_GAP), y: this.TAB_Y, w: this.TAB_W, h: this.TAB_H };
  },

  _itemRect: function (i) {
    var st = this.station_(this.st);
    if (st && st.layout === 'cards') {
      var c = i % this.CARD_COLS, r = Math.floor(i / this.CARD_COLS);
      return {
        x: this.LIST_X + c * (this.CARDW + this.CARD_GAP),
        y: this.LIST_Y + r * (this.CARDH + this.CARD_GAP),
        w: this.CARDW, h: this.CARDH,
      };
    }
    return { x: this.LIST_X, y: this.LIST_Y + i * this.ROW_H, w: this.LIST_W, h: this.ROW_H - 2 };
  },

  _arrow: function (d) {
    var x = this.LIST_X + this.LIST_W + 6;
    return d < 0 ? { x: x, y: this.LIST_Y, w: 14, h: 16 } : { x: x, y: this.LIST_Y + 120, w: 14, h: 16 };
  },

  _verbRect: function () {
    return { x: this.SWX + this.SWW - 78, y: this.BAR_Y + 6, w: 70, h: 18 };
  },

  _panelL: function () { return { x: this.SWX + 8, y: this.LIST_Y, w: 96, h: 62 }; },
  _stokeRect: function () { return { x: this.SWX + 8, y: this.LIST_Y + 78, w: 96, h: 14 }; },
  _jobRect: function (i) { return { x: this.SWX + 8, y: this.LIST_Y + 106 + i * 20, w: 96, h: 18 }; },

  // ==== draw ================================================================
  draw: function (c) {
    if (!this.ensure() || !this.open) return;
    c.save();
    c.fillStyle = 'rgba(8,12,18,0.55)';
    c.fillRect(0, 0, W, H);
    if (this.mode === 'bag') this._drawBag(c);
    else this._drawStation(c);
    c.restore();
  },

  _cellPath: function (c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  },

  _bar: function (c, x, y, w, h, frac, fill, back) {
    c.fillStyle = back || 'rgba(14,10,6,0.7)';
    c.fillRect(x, y, w, h);
    c.fillStyle = fill;
    c.fillRect(x + PIX, y + PIX, Math.max(0, (w - PIX * 2) * clamp(frac, 0, 1)), h - PIX * 2);
    c.strokeStyle = 'rgba(226,200,150,0.35)';
    c.lineWidth = PIX;
    c.strokeRect(x + PIX / 2, y + PIX / 2, w - PIX, h - PIX);
  },

  _hintText: function () {
    if (typeof TouchUI !== 'undefined' && TouchUI.enabled) return 'tap X to close';
    return this.mode === 'bag' ? '[Tab] or [I] close' : '[Esc] close';
  },

  // ---- the bag screen ------------------------------------------------------
  _drawBag: function (c) {
    var w = this._window(), i, r, s;
    c.save();
    uiPageOpen(c, clamp(this._openT, 0, 1), w.x + w.w / 2, w.y + w.h / 2);
    uiPage(c, w.x, w.y, w.w, w.h, 1);
    // (NO WOOD GRAIN. The window is paper now; a grain overlay on it read as
    // dirt rather than as timber.)

    text(c, "OTTO'S BAG", w.x + 34, w.y + 12, { size: 12, color: '#7a5232', shadow: false });
    text(c, 'everything he is carrying right now', w.x + 34, w.y + 25,
      { size: 7, color: '#a8895e', shadow: false });
    var slots = this.used() + ' / ' + this.capacity() + ' slots';
    var sw = textWidth(c, slots, 7) + 16;
    inkBox(c, w.x + w.w - 40 - sw, w.y + 5, sw, 16, '#ffe9a8', '#a8761a', PIX * 2);
    text(c, slots, w.x + w.w - 40 - sw / 2, w.y + 9.5,
      { size: 7, color: '#6b4a22', align: 'center', shadow: false });

    r = this._closeRect();
    inkClose(c, r, this._in(r, Input.mouse.x, Input.mouse.y));

    // the grid: pockets ruled onto the page
    var mx = Input.mouse.x, my = Input.mouse.y;
    for (i = 0; i < this.capacity(); i++) {
      r = this._cellRect(i);
      s = G.inv.slots[i];
      var on = i === this.hover, sel = i === this.pick;
      inkBox(c, r.x, r.y, r.w, r.h,
        sel ? 'rgba(255,228,150,0.62)' : (on ? 'rgba(255,255,255,0.55)' : 'rgba(236,224,196,0.45)'),
        sel ? '#a8761a' : 'rgba(146,116,76,' + (on ? 0.8 : 0.5) + ')',
        sel ? PIX * 3 : PIX * 2);
      if (!s) continue;
      // the cell a drag started in reads as lifted, not as empty
      var lifted = this.drag && this.drag.from === i;
      if (lifted) c.globalAlpha = 0.35;
      this.drawIcon(c, s.key, r.x + r.w / 2, r.y + r.h / 2 - 0.5, 18);
      if (s.n > 1) {
        text(c, String(s.n), r.x + r.w - 2, r.y + r.h - 8.5,
          { size: 6.5, color: '#4a3020', align: 'right', shadow: false });
      }
      if (lifted) c.globalAlpha = 1;
    }

    // sort / stack / gather
    this._drawBtn(c, this._btn('sort'), 'sort', mx, my);
    this._drawBtn(c, this._btn('stack'), 'stack', mx, my);
    this._drawBtn(c, this._btn('gather'), 'gather', mx, my);

    var by = this._btn('sort').y;
    text(c, 'worth ' + this.totalValue() + ' sd', this.GX + 172, by + 4,
      { size: 7, color: '#3f7a4e', shadow: false });
    if (this.noteT > 0) {
      c.globalAlpha = clamp(this.noteT, 0, 1);
      text(c, this.note, this.GX, by + 21, { size: 6.5, color: '#8a5a24', shadow: false });
      c.globalAlpha = 1;
    }

    this._drawDetail(c);

    text(c, 'drag to rearrange  --  click a stack to send it to the bar  --  ' + this._hintText(),
      w.x + w.w / 2, w.y + w.h - 14, { size: 6.5, color: '#8a7454', align: 'center', shadow: false });
    c.restore();

    // The hotbar rides with the HUD, which we replaced -- draw it ourselves so
    // there is something to drag onto. OUTSIDE the page transform: it belongs to
    // the screen, not to the sheet, and it must not slide in with the page.
    var hb = this._hb();
    if (hb && hb.draw) hb.draw(c);

    this._drawTooltip(c);
    this._drawDrag(c);
  },

  _drawBtn: function (c, r, label, mx, my) {
    inkButton(c, r, label, true, this._in(r, mx, my), this.t || 0);
  },

  // The detail card doubles as the tooltip body: hover wins, otherwise the last
  // cell you touched, so it never blanks out mid-drag.
  _detailKey: function () {
    var i = this.drag ? this.drag.from : (this.hover >= 0 ? this.hover : this.pick);
    if (i < 0 || i >= G.inv.slots.length) return null;
    var s = G.inv.slots[i];
    return s ? s.key : null;
  },

  _drawDetail: function (c) {
    var r = this._cardRect();
    inkBox(c, r.x, r.y, r.w, r.h, 'rgba(255,251,236,0.78)', 'rgba(146,116,76,0.65)', PIX * 2);
    var key = this._detailKey();
    if (!key) {
      text(c, 'nothing picked up', r.x + r.w / 2, r.y + r.h / 2 - 10, { size: 7, color: '#a4805a', align: 'center', shadow: false });
      text(c, 'hover a stack to read it', r.x + r.w / 2, r.y + r.h / 2, { size: 6.5, color: '#a89878', align: 'center', shadow: false });
      return;
    }
    var held = this.count(key), cap = this.stackCap(key), val = this.value(key);
    this.drawIcon(c, key, r.x + 26, r.y + 28, 36);
    text(c, this.name(key), r.x + 50, r.y + 12, { size: 8, color: '#4a3020', shadow: false });
    text(c, held + ' held  --  stacks to ' + cap, r.x + 50, r.y + 24, { size: 6.5, color: '#7a5232', shadow: false });
    text(c, 'worth ' + val + ' sd each', r.x + 50, r.y + 34, { size: 6.5, color: '#6a4420', shadow: false });

    c.fillStyle = 'rgba(122,74,48,0.35)';
    c.fillRect(r.x + 8, r.y + 50, r.w - 16, PIX);

    var lines = this._wrap(this.desc(key), 40), i;
    for (i = 0; i < lines.length && i < 5; i++) {
      text(c, lines[i], r.x + 8, r.y + 56 + i * 9, { size: 6.5, color: '#6a4420', shadow: false });
    }

    var shape = this._hotShape(key);
    var bar = shape.kind === 'tool' ? 'a tool -- the bar holds one' : 'stacks onto the bar';
    if (!this._hb()) bar = '';
    text(c, bar, r.x + 8, r.y + r.h - 26, { size: 6, color: '#a4805a', shadow: false });
    if (val > 0) {
      text(c, 'all of it: ' + (val * held) + ' sd', r.x + 8, r.y + r.h - 15, { size: 6.5, color: '#7a5232', shadow: false });
    }
  },

  // Small chip beside the pointer -- the fast read while the eye is on the grid.
  _drawTooltip: function (c) {
    if (this.drag || this.hover < 0) return;
    if (typeof TouchUI !== 'undefined' && TouchUI.enabled) return;
    var s = G.inv.slots[this.hover];
    if (!s) return;
    var label = this.name(s.key) + '  x' + s.n + '   ' + this.value(s.key) + ' sd';
    var w = textWidth(c, label, 6.5) + 12, h = 13;
    var x = clamp(Input.mouse.x + 8, this.BWX + 2, this.BWX + this.BWW - w - 2);
    var y = clamp(Input.mouse.y - 16, this.BWY + 2, this.BWY + this.BWH - h - 2);
    inkBox(c, x, y, w, h, '#fff6dc', '#8a6440', PIX * 2);
    text(c, label, x + w / 2, y + 3, { size: 6.5, color: '#4a3020', align: 'center', shadow: false });
  },

  _drawDrag: function (c) {
    if (!this.drag) return;
    var s = G.inv.slots[this.drag.from];
    if (!s) return;
    var x = Input.mouse.x, y = Input.mouse.y;
    c.globalAlpha = 0.9;
    inkBox(c, x - 11, y - 11, 22, 22, '#fff3d2', '#a8761a', PIX * 2.5);
    this.drawIcon(c, s.key, x, y, 15);
    if (s.n > 1) text(c, String(s.n), x + 10, y + 3,
      { size: 6.5, color: '#4a3020', align: 'right', shadow: false });
    c.globalAlpha = 1;
  },

  // ---- the station screen --------------------------------------------------
  _drawStation: function (c) {
    var st = this.station_(this.st) || this.STATIONS[0], pal = st.pal, w = this._window();
    var mx = Input.mouse.x, my = Input.mouse.y, i, r;

    // panel: the station's own wash over the standard driftwood frame
    uiPanel(c, w.x, w.y, w.w, w.h, 0.95);
    c.save();
    this._cellPath(c, w.x + 1.5, w.y + 1.5, w.w - 3, w.h - 3, 3);
    c.clip();
    c.fillStyle = pal.bg;
    c.fillRect(w.x, w.y, w.w, w.h);
    this._drawDeco(c, st, w);
    c.restore();

    text(c, st.name, w.x + 10, w.y + 4, { size: 8, color: pal.hi });
    text(c, this._hintText(), w.x + w.w - 32, w.y + 6, { size: 6, color: pal.dim, align: 'right' });

    r = this._closeRect();
    var overX = this._in(r, mx, my);
    uiPanel(c, r.x, r.y, r.w, r.h, overX ? 0.95 : 0.7);
    text(c, 'x', r.x + r.w / 2, r.y + 4, { size: 8, color: overX ? pal.hi : pal.dim, align: 'center' });

    text(c, st.blurb, w.x + 10, w.y + 15, { size: 6.5, color: pal.dim });
    if (!TouchUI.enabled) {
      text(c, '[<-] [->] bench', w.x + w.w - 32, w.y + 15, { size: 6, color: pal.dim, align: 'right' });
    }

    // station rail
    for (i = 0; i < this.STATIONS.length; i++) {
      var s2 = this.STATIONS[i], on = s2.key === this.st;
      r = this._tabRect(i);
      var hov = this._in(r, mx, my);
      this._cellPath(c, r.x, r.y, r.w, r.h, 2.5);
      c.fillStyle = on ? 'rgba(246,232,201,0.92)' : (hov ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)');
      c.fill();
      c.strokeStyle = on ? s2.pal.hi : 'rgba(226,200,150,0.3)';
      c.lineWidth = on ? 1.2 : 1;
      c.stroke();
      var busy = this.activeJob(s2.key);
      text(c, (i + 1) + '. ' + s2.verb, r.x + 6, r.y + 4.5,
        { size: 7, color: on ? '#4a3020' : pal.ink, shadow: !on });
      if (busy) {
        // a little dot per station that has something on the go
        c.fillStyle = this.jobReady(busy) ? '#a0f2b4' : s2.pal.warm;
        c.beginPath();
        c.arc(r.x + r.w - 8, r.y + r.h / 2, 2.2, 0, TAU);
        c.fill();
      }
    }

    this._drawStationSide(c, st);
    if (st.layout === 'cards') this._drawCards(c, st, mx, my);
    else this._drawRows(c, st, mx, my);
    this._drawCostBar(c, st, mx, my);
    this._drawFx(c);
  },

  // left column: the station itself, its gauge and its queue
  _drawStationSide: function (c, st) {
    var p = this._panelL(), pal = st.pal, i;
    uiPanel(c, p.x, p.y, p.w, p.h, 0.55, false);
    var art = st.art, box = 52;
    if (this._hasArt(art)) {
      var img = ASSETS[art];
      var aw = img.width >= img.height ? box : box * img.width / img.height;
      drawAC(c, art, p.x + p.w / 2, p.y + p.h / 2 + 1, aw);
    } else {
      text(c, st.verb, p.x + p.w / 2, p.y + p.h / 2 - 4, { size: 8, color: pal.ink, align: 'center' });
    }

    var j = this.activeJob(this.st);

    if (st.fuel) {
      // the furnace's charcoal gauge, with the [stoke] button under it
      var fy = p.y + 66;
      text(c, 'fire', p.x, fy, { size: 6.5, color: pal.dim });
      var frac = this.fuelFrac();
      this._bar(c, p.x + 20, fy + 0.5, p.w - 20, 7, frac, frac > 0.25 ? pal.hi : '#e8434c');
      var sr = this._stokeRect(), on = this._in(sr, Input.mouse.x, Input.mouse.y);
      var coal = this.have('charcoal');
      uiPanel(c, sr.x, sr.y, sr.w, sr.h, on ? 0.98 : 0.85, true);
      text(c, 'stoke  (' + coal + ')', sr.x + sr.w / 2, sr.y + 3.5,
        { size: 6.5, color: coal > 0 ? '#4a3020' : '#a4805a', align: 'center', shadow: false });
    } else {
      var line = j ? 'working' : 'idle';
      text(c, line, p.x, p.y + 68, { size: 6.5, color: pal.dim });
    }

    text(c, 'on the bench', p.x, this._jobRect(0).y - 10, { size: 6.5, color: pal.dim });
    var jobs = this.jobsAt(this.st);
    for (i = 0; i < this.MAX_JOBS; i++) {
      var r = this._jobRect(i), job = jobs[i];
      this._cellPath(c, r.x, r.y, r.w, r.h, 2.5);
      c.fillStyle = 'rgba(0,0,0,0.32)';
      c.fill();
      c.strokeStyle = 'rgba(226,200,150,0.22)';
      c.lineWidth = PIX * 2;
      c.stroke();
      if (!job) {
        text(c, '--', r.x + r.w / 2, r.y + 5, { size: 6.5, color: pal.dim, align: 'center' });
        continue;
      }
      var rec = this.recipe(job.key);
      var ready = this.jobReady(job);
      var outKey = rec && rec.out ? rec.out.key : null;
      if (outKey) this.drawIcon(c, outKey, r.x + 10, r.y + r.h / 2, 13);
      else if (rec && this._hasArt(rec.art)) drawAC(c, rec.art, r.x + 10, r.y + r.h / 2, 13);
      text(c, this._clip(rec ? rec.name : '?', 12), r.x + 20, r.y + 2,
        { size: 6.5, color: ready ? '#a0f2b4' : pal.ink });
      if (ready) {
        text(c, 'collect', r.x + 20, r.y + 10, { size: 6, color: '#ffe66e' });
      } else if (i === 0) {
        var stall = this.stalled(this.st);
        this._bar(c, r.x + 20, r.y + 11, r.w - 26, 5, job.t / job.dur, stall ? '#e8434c' : pal.hi);
        if (stall) text(c, 'cold', r.x + r.w - 4, r.y + 2, { size: 6, color: '#e8434c', align: 'right' });
        else text(c, Math.ceil(job.dur - job.t) + 's', r.x + r.w - 4, r.y + 2, { size: 6, color: pal.dim, align: 'right' });
      } else {
        text(c, 'waiting', r.x + 20, r.y + 10, { size: 6, color: pal.dim });
      }
    }
    text(c, 'click: collect / cancel', p.x, this._jobRect(this.MAX_JOBS - 1).y + 22,
      { size: 6, color: pal.dim });
  },

  _drawRows: function (c, st, mx, my) {
    var list = this.recipesAt(this.st), pal = st.pal, i;
    for (i = 0; i < this.ROW_VIS; i++) {
      var idx = this.scroll + i;
      if (idx >= list.length) break;
      var r = this._itemRect(i), rec = list[idx];
      var sel = idx === this.sel, hov = this._in(r, mx, my);
      var lock = this.locked(rec), ok = !lock && this.can(rec);
      this._cellPath(c, r.x, r.y, r.w, r.h, 2.5);
      c.fillStyle = sel ? 'rgba(255,255,255,0.16)' : (hov ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.26)');
      c.fill();
      c.strokeStyle = sel ? pal.hi : 'rgba(226,200,150,0.2)';
      c.lineWidth = sel ? 1.1 : PIX * 2;
      c.stroke();

      this._drawRecipeIcon(c, rec, r.x + 14, r.y + r.h / 2, 18, lock);
      text(c, rec.name, r.x + 28, r.y + 3, { size: 7.5, color: lock ? pal.dim : pal.ink });
      text(c, this._costLine(rec), r.x + 28, r.y + 13, { size: 6.5, color: ok ? pal.dim : '#e8434c' });

      var right = r.x + r.w - 5;
      if (lock) text(c, 'lvl ' + this.levelFor(rec), right, r.y + 4, { size: 6.5, color: '#e8434c', align: 'right' });
      else if (rec.out) text(c, 'x' + rec.out.n, right, r.y + 4, { size: 7, color: pal.warm, align: 'right' });
      text(c, rec.time + 's', right, r.y + 13, { size: 6, color: pal.dim, align: 'right' });
    }
    this._drawArrows(c, st, list.length, this.ROW_VIS, mx, my);
  },

  _drawCards: function (c, st, mx, my) {
    var list = this.recipesAt(this.st), pal = st.pal, i;
    var vis = this.CARD_COLS * this.CARD_ROWS;
    for (i = 0; i < vis; i++) {
      var idx = this.scroll + i;
      if (idx >= list.length) break;
      var r = this._itemRect(i), rec = list[idx];
      var sel = idx === this.sel, hov = this._in(r, mx, my);
      var lock = this.locked(rec);
      var had = typeof rec.done === 'function' && rec.done(G);
      var ok = !lock && !had && this.can(rec);
      this._cellPath(c, r.x, r.y, r.w, r.h, 3);
      c.fillStyle = sel ? 'rgba(255,255,255,0.17)' : (hov ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)');
      c.fill();
      c.strokeStyle = sel ? pal.hi : 'rgba(226,200,150,0.22)';
      c.lineWidth = sel ? 1.2 : PIX * 2;
      c.stroke();

      // art tile on the left of the card, cosy little frame around it
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(r.x + 3, r.y + 3, 32, r.h - 6);
      this._drawRecipeIcon(c, rec, r.x + 19, r.y + r.h / 2, 26, lock);

      text(c, this._clip(rec.name, 15), r.x + 39, r.y + 4, { size: 7.5, color: lock ? pal.dim : pal.ink });
      text(c, this._clip(this._costLine(rec), 20), r.x + 39, r.y + 14,
        { size: 6.5, color: ok ? pal.dim : (had ? '#a0f2b4' : '#e8434c') });
      if (had) text(c, 'owned', r.x + 39, r.y + 25, { size: 6.5, color: '#a0f2b4' });
      else if (lock) text(c, 'needs ' + this.skillOf(rec) + ' ' + this.levelFor(rec), r.x + 39, r.y + 25, { size: 6, color: '#e8434c' });
      else text(c, rec.time + 's' + (rec.out && rec.out.n > 1 ? '   x' + rec.out.n : ''), r.x + 39, r.y + 25,
        { size: 6.5, color: pal.warm });
    }
    this._drawArrows(c, st, list.length, vis, mx, my);
  },

  _drawArrows: function (c, st, total, vis, mx, my) {
    if (total <= vis) return;
    var pal = st.pal, d, r, on;
    for (d = -1; d <= 1; d += 2) {
      r = this._arrow(d);
      on = this._in(r, mx, my);
      this._cellPath(c, r.x, r.y, r.w, r.h, 2);
      c.fillStyle = on ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.32)';
      c.fill();
      c.strokeStyle = 'rgba(226,200,150,0.25)';
      c.lineWidth = PIX * 2;
      c.stroke();
      c.fillStyle = pal.ink;
      c.beginPath();
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (d < 0) { c.moveTo(cx, cy - 3.5); c.lineTo(cx - 4, cy + 2.5); c.lineTo(cx + 4, cy + 2.5); }
      else { c.moveTo(cx, cy + 3.5); c.lineTo(cx - 4, cy - 2.5); c.lineTo(cx + 4, cy - 2.5); }
      c.closePath();
      c.fill();
    }
    // how far down the list we are, as a thin rail between the arrows
    var a0 = this._arrow(-1), a1 = this._arrow(1);
    var railY = a0.y + a0.h + 3, railH = a1.y - railY - 3;
    if (railH > 6) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(a0.x + 5, railY, 4, railH);
      var frac = total > vis ? this.scroll / (total - vis) : 0;
      var kh = Math.max(6, railH * vis / total);
      c.fillStyle = pal.hi;
      c.fillRect(a0.x + 5, railY + (railH - kh) * frac, 4, kh);
    }
  },

  _drawCostBar: function (c, st, mx, my) {
    var list = this.recipesAt(this.st), pal = st.pal;
    var x = this.LIST_X, y = this.BAR_Y, w = this.SWW - (this.LIST_X - this.SWX) - 8;
    uiPanel(c, x, y, w, this.BAR_H, 0.5, false);
    var rec = this.sel >= 0 ? list[this.sel] : null;
    if (!rec) {
      text(c, list.length ? 'pick something off the shelf' : 'nothing on this bench yet',
        x + 8, y + 10, { size: 7, color: pal.dim });
      return;
    }

    // note line wins for a couple of seconds after an action
    if (this.noteT > 0) {
      c.globalAlpha = clamp(this.noteT, 0, 1);
      text(c, this.note, x + 8, y + 4, { size: 7, color: pal.hi });
      c.globalAlpha = 1;
    } else {
      text(c, this._clip(rec.desc || '', 46), x + 8, y + 4, { size: 6.5, color: pal.dim });
    }

    // cost, as icons with a held/needed count under each
    var cx = x + 10, k, need, held;
    for (k in rec.cost) {
      if (!Object.prototype.hasOwnProperty.call(rec.cost, k)) continue;
      need = rec.cost[k];
      held = this.have(k);
      this.drawIcon(c, k, cx, y + 20, 13);
      text(c, held + '/' + need, cx + 8, y + 17, { size: 6, color: held >= need ? '#a0f2b4' : '#e8434c' });
      cx += 34;
      if (cx > x + w - 110) break;
    }
    if (rec.money) {
      text(c, rec.money + ' sd', cx, y + 17, { size: 6.5, color: G.money >= rec.money ? '#a0f2b4' : '#e8434c' });
    }

    var r = this._verbRect(), on = this._in(r, mx, my), ok = this.can(rec);
    this._cellPath(c, r.x, r.y, r.w, r.h, 2.5);
    c.fillStyle = ok ? (on ? 'rgba(255,230,110,0.95)' : 'rgba(246,232,201,0.9)') : 'rgba(60,42,28,0.85)';
    c.fill();
    c.strokeStyle = ok ? pal.hi : 'rgba(226,200,150,0.3)';
    c.lineWidth = 1;
    c.stroke();
    text(c, st.verb + (rec.time > 0 ? ' (' + rec.time + 's)' : ''), r.x + r.w / 2, r.y + 5,
      { size: 7, color: ok ? '#4a3020' : '#8a9484', align: 'center', shadow: false });
  },

  _costLine: function (r) {
    var out = [], k;
    for (k in r.cost) {
      if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
      out.push(r.cost[k] + ' ' + this.name(k).toLowerCase());
    }
    if (r.money) out.push(r.money + ' sd');
    return out.join(', ');
  },

  _clip: function (s, n) {
    s = String(s);
    return s.length <= n ? s : s.slice(0, n - 1) + '.';
  },

  _wrap: function (s, cols) {
    // Courier is monospace, so a character count is an exact measure and cheaper
    // than measureText -- the same trick NPCs uses for its dialogue.
    var words = String(s).split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (t.length > cols && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  },

  // ==== icons ===============================================================
  // Longest side fits `box`, centred. Resolution order: our own art, ITEMS art,
  // an asset named after the key, then a coded glyph -- because missing art is
  // silent in this codebase and a blank cell reads as an empty slot.
  drawIcon: function (c, key, cx, cy, box) {
    var art = this._artOf(key);
    if (art) {
      var img = ASSETS[art];
      var w = img.width >= img.height ? box : box * img.width / img.height;
      drawAC(c, art, cx, cy, w);
      return;
    }
    if (typeof drawItemIcon === 'function' && drawItemIcon(c, key, cx, cy, box)) return;
    var d = this.def(key);
    this._glyph(c, d && d.glyph ? d.glyph : key, cx, cy, box, d && d.tone ? d.tone : 0);
  },

  _drawRecipeIcon: function (c, rec, cx, cy, box, dim) {
    if (dim) c.globalAlpha = 0.45;
    if (rec.out) this.drawIcon(c, rec.out.key, cx, cy, box);
    else if (this._hasArt(rec.art)) {
      var img = ASSETS[rec.art];
      var w = img.width >= img.height ? box : box * img.width / img.height;
      drawAC(c, rec.art, cx, cy, w);
    } else this._glyph(c, 'tag', cx, cy, box, 0);
    if (dim) c.globalAlpha = 1;
  },

  // Hand-coded stand-ins for the keys with no art. Every shape sets fillStyle
  // once; no colour string is ever built inside a loop.
  _glyph: function (c, kind, cx, cy, box, tone) {
    var u = box / 12;
    var wood = '#c9a271', dark = '#5a3a1e', edge = '#6d4526';
    var iron = '#8f9aa4', steel = '#c9d4dc', cyan = '#5ad2f0';
    c.save();
    c.translate(Math.round(cx * DPX) / DPX, Math.round(cy * DPX) / DPX);
    if (kind === 'beam') {
      c.fillStyle = wood;
      c.fillRect(-5 * u, -4 * u, 10 * u, 2.6 * u);
      c.fillRect(-5 * u, -0.8 * u, 10 * u, 2.6 * u);
      c.fillRect(-5 * u, 2.4 * u, 10 * u, 2.6 * u);
      c.fillStyle = edge;
      c.fillRect(-5 * u, -1.6 * u, 10 * u, 0.8 * u);
      c.fillRect(-5 * u, 1.6 * u, 10 * u, 0.8 * u);
      c.fillStyle = dark;
      c.fillRect(3.4 * u, -4 * u, 0.9 * u, 9 * u);
    } else if (kind === 'sand') {
      c.fillStyle = '#e2cd9a';
      c.beginPath();
      c.moveTo(-5 * u, 4 * u); c.lineTo(0, -2.4 * u); c.lineTo(5 * u, 4 * u);
      c.closePath(); c.fill();
      c.fillStyle = '#c9a271';
      c.fillRect(-5 * u, 3.2 * u, 10 * u, 0.9 * u);
      c.fillStyle = '#fff2cf';
      c.fillRect(-1.2 * u, -0.6 * u, 0.9 * u, 0.9 * u);
      c.fillRect(1.4 * u, 1.4 * u, 0.9 * u, 0.9 * u);
    } else if (kind === 'glass') {
      c.fillStyle = 'rgba(90,210,240,0.55)';
      c.beginPath();
      c.moveTo(-3.4 * u, -4 * u); c.lineTo(3.8 * u, -3 * u);
      c.lineTo(3 * u, 4.2 * u); c.lineTo(-3.8 * u, 3.4 * u);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(216,255,240,0.85)';
      c.fillRect(-2.2 * u, -2.6 * u, 1 * u, 5.4 * u);
      c.strokeStyle = cyan;
      c.lineWidth = PIX * 2;
      c.stroke();
    } else if (kind === 'lens') {
      c.fillStyle = 'rgba(90,210,240,0.5)';
      c.beginPath(); c.arc(0, 0, 4.4 * u, 0, TAU); c.fill();
      c.strokeStyle = steel;
      c.lineWidth = PIX * 3;
      c.beginPath(); c.arc(0, 0, 4.4 * u, 0, TAU); c.stroke();
      c.fillStyle = '#d8fff0';
      c.beginPath(); c.arc(-1.4 * u, -1.4 * u, 1.4 * u, 0, TAU); c.fill();
    } else if (kind === 'coal') {
      c.fillStyle = '#2b2b31';
      c.fillRect(-4.4 * u, -1.4 * u, 4.6 * u, 4.4 * u);
      c.fillRect(0.4 * u, -3 * u, 4 * u, 4 * u);
      c.fillStyle = '#4a4a54';
      c.fillRect(-3.4 * u, -0.4 * u, 1.6 * u, 1.6 * u);
      c.fillStyle = '#ff5a4a';
      c.fillRect(1.6 * u, -1.4 * u, 1.2 * u, 1.2 * u);
    } else if (kind === 'ball') {
      c.fillStyle = '#31353c';
      c.beginPath(); c.arc(0, 0.5 * u, 4.2 * u, 0, TAU); c.fill();
      c.fillStyle = '#5a6068';
      c.beginPath(); c.arc(-1.4 * u, -1 * u, 1.4 * u, 0, TAU); c.fill();
    } else if (kind === 'pot') {
      c.fillStyle = edge;
      c.beginPath();
      c.moveTo(-5 * u, 3.6 * u); c.lineTo(-3.6 * u, -3 * u);
      c.lineTo(3.6 * u, -3 * u); c.lineTo(5 * u, 3.6 * u);
      c.closePath(); c.fill();
      c.fillStyle = wood;
      c.fillRect(-4.4 * u, -1.6 * u, 8.8 * u, 0.8 * u);
      c.fillRect(-4.8 * u, 1 * u, 9.6 * u, 0.8 * u);
      c.fillStyle = dark;
      c.fillRect(-1.4 * u, -3 * u, 2.8 * u, 1.2 * u);
    } else if (kind === 'pick') {
      c.fillStyle = wood;
      c.fillRect(-0.8 * u, -1.6 * u, 1.6 * u, 6.4 * u);
      c.fillStyle = tone >= 3 ? cyan : (tone === 2 ? steel : iron);
      c.beginPath();
      c.moveTo(-5 * u, -1.8 * u); c.lineTo(0, -4.4 * u); c.lineTo(5 * u, -1.8 * u);
      c.lineTo(3.4 * u, -0.6 * u); c.lineTo(0, -2.6 * u); c.lineTo(-3.4 * u, -0.6 * u);
      c.closePath(); c.fill();
    } else {
      // unknown key: a parchment tag with its first two letters, never blank
      c.fillStyle = '#f2e6c9';
      c.fillRect(-4 * u, -4 * u, 8 * u, 8 * u);
      c.fillStyle = edge;
      c.fillRect(-4 * u, -4 * u, 8 * u, 1 * u);
      text(c, String(kind).slice(0, 2).toUpperCase(), 0, -1.4 * u,
        { size: Math.max(5, 4.4 * u), color: '#6a4420', align: 'center', shadow: false });
    }
    c.restore();
  },

  // ==== backdrops ===========================================================
  // Deterministic, built ONCE with a fixed seed: pegboard holes must not crawl
  // and rivets must not shuffle between frames.
  _buildDeco: function () {
    var rnd = mulberry32(0x1B49), i;
    var peg = [], brick = [], grain = [], iron = [];
    for (i = 0; i < 96; i++) peg.push({ x: rnd(), y: rnd() });
    for (i = 0; i < 54; i++) brick.push({ x: rnd(), y: rnd(), w: 0.6 + rnd() * 0.6 });
    for (i = 0; i < 64; i++) grain.push({ x: rnd(), y: rnd(), w: 0.02 + rnd() * 0.09 });
    for (i = 0; i < 40; i++) iron.push({ x: rnd(), y: rnd() });
    this._deco = { peg: peg, brick: brick, grain: grain, iron: iron };
  },

  _drawDeco: function (c, st, w) {
    if (!this._deco) this._buildDeco();
    var i, d, x, y;
    if (st.deco === 'peg') {
      d = this._deco.peg;
      c.fillStyle = 'rgba(0,0,0,0.22)';
      for (i = 0; i < d.length; i++) {
        x = w.x + 6 + d[i].x * (w.w - 12);
        y = w.y + 20 + d[i].y * (w.h - 30);
        c.fillRect(Math.round(x * DPX) / DPX, Math.round(y * DPX) / DPX, PIX * 2, PIX * 2);
      }
    } else if (st.deco === 'brick') {
      d = this._deco.brick;
      c.fillStyle = 'rgba(0,0,0,0.2)';
      for (i = 0; i < d.length; i++) {
        x = w.x + 4 + d[i].x * (w.w - 8);
        y = w.y + 18 + d[i].y * (w.h - 26);
        c.fillRect(x, y, 16 * d[i].w, PIX * 2);
      }
      c.fillStyle = 'rgba(232,169,60,0.09)';
      c.fillRect(w.x, w.y + w.h - 26, w.w, 26);       // heat glow off the floor
    } else if (st.deco === 'grain') {
      d = this._deco.grain;
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (i = 0; i < d.length; i++) {
        x = w.x + 4 + d[i].x * (w.w - 8);
        y = w.y + 18 + d[i].y * (w.h - 26);
        c.fillRect(x, y, d[i].w * w.w, PIX);
      }
    } else {
      d = this._deco.iron;
      c.fillStyle = 'rgba(255,255,255,0.09)';
      for (i = 0; i < d.length; i++) {
        x = w.x + 8 + d[i].x * (w.w - 16);
        y = w.y + 20 + d[i].y * (w.h - 30);
        c.beginPath();
        c.arc(x, y, 1.1, 0, TAU);
        c.fill();
      }
    }
  },

  // The bag's panel gets the same treatment: fixed specks so the wood reads as
  // wood without a texture upload.
  _drawGrain: function (c, x, y, w, h) {
    if (!this._deco) this._buildDeco();
    var d = this._deco.grain, i;
    c.fillStyle = 'rgba(255,235,190,0.07)';
    for (i = 0; i < d.length; i++) {
      c.fillRect(x + d[i].x * w, y + 14 + d[i].y * (h - 20), d[i].w * w, PIX);
    }
  },

  // ==== particles ===========================================================
  // Preallocated pool, recycled by oldest, batched by tone so fillStyle is set
  // three times a frame instead of once per particle.
  TONES: ['#ffb347', '#e2cd9a', '#d8fff0'],

  _buildFx: function () {
    this.fx = new Array(this.FX_MAX);
    for (var i = 0; i < this.FX_MAX; i++) {
      this.fx[i] = { t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, tone: 0, sz: PIX * 2 };
    }
  },

  _take: function () {
    var best = 0, bt = 1e9, i;
    for (i = 0; i < this.fx.length; i++) {
      if (this.fx[i].t <= 0) return this.fx[i];
      if (this.fx[i].t < bt) { bt = this.fx[i].t; best = i; }
    }
    return this.fx[best];
  },

  // A puff at the station's left panel: embers for the forge, sawdust for the
  // mill, sparks for the anvil, wood chips for the bench.
  _burst: function (stKey, n) {
    if (!this.fx) this._buildFx();
    if (!this.open || this.mode !== 'station' || this.st !== stKey) return;
    var p = this._panelL(), cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    var tone = stKey === 'forge' ? 0 : (stKey === 'anvil' ? 2 : 1);
    for (var i = 0; i < n; i++) {
      var f = this._take();
      f.t = f.life = 0.5 + Math.random() * 0.5;
      f.x = cx + (Math.random() - 0.5) * 26;
      f.y = cy + (Math.random() - 0.5) * 16;
      f.vx = (Math.random() - 0.5) * 26;
      f.vy = -14 - Math.random() * 26;
      f.tone = tone;
      f.sz = PIX * 2;
    }
  },

  _tickFx: function (dt) {
    if (!this.fx) this._buildFx();
    var i, f;
    for (i = 0; i < this.fx.length; i++) {
      f = this.fx[i];
      if (f.t <= 0) continue;
      f.t -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 26 * dt;
    }
    // an idle furnace with a job on it still breathes embers
    var st = this.station_(this.st);
    if (this.open && this.mode === 'station' && st && st.fuel && this.fuel() > 0 &&
        this.activeJob(this.st) && Math.random() < dt * 8) this._burst(this.st, 1);
  },

  _drawFx: function (c) {
    if (!this.fx) return;
    var t, i, f, any = false;
    for (t = 0; t < this.TONES.length; t++) {
      var set = false;
      for (i = 0; i < this.fx.length; i++) {
        f = this.fx[i];
        if (f.t <= 0 || f.tone !== t) continue;
        if (!set) { c.fillStyle = this.TONES[t]; set = true; any = true; }
        c.globalAlpha = clamp(f.t / f.life, 0, 1);
        c.fillRect(f.x, f.y, f.sz, f.sz);
      }
    }
    if (any) c.globalAlpha = 1;
  },

  // ==== the deck ============================================================
  spots: function () {
    if (!this.ensure()) return [];
    var out = [], i, st, site;
    for (i = 0; i < this.STATIONS.length; i++) {
      st = this.STATIONS[i];
      site = this.SITES[st.key];
      if (!site || typeof site.x !== 'number') continue;
      if ((site.b || 1) > G.bridge) continue;
      out.push(this._spotFor(st, site.x));
    }
    return out;
  },

  _spotFor: function (st, x) {
    var self = this;
    return {
      x: x,
      label: st.name.replace(/^the /, '').replace(/^otto's /, '') + '  (' + st.verb + ')',
      act: function () { self.station(st.key); },
    };
  },

  houseSpots: function () {
    if (!this.ensure()) return [];
    var self = this;
    return [{
      x: this.HOUSE_X,
      label: 'Tinkering Table  (4 stations)',
      act: function () { self.station(G.inv.tab); },
    }];
  },

  // WORLD SPACE: call inside translate(-camX, 0). Culled by camera like every
  // other dock prop.
  drawDock: function (c, camX) {
    if (!this.ensure()) return;
    var i, st, site, x, deckY = (typeof DECK_Y !== 'undefined') ? DECK_Y : 214;
    for (i = 0; i < this.STATIONS.length; i++) {
      st = this.STATIONS[i];
      site = this.SITES[st.key];
      if (!site || typeof site.x !== 'number') continue;
      if ((site.b || 1) > G.bridge) continue;
      x = site.x;
      if (x < camX - 40 || x > camX + W + 40) continue;
      this._drawSite(c, st, x, deckY);
    }
  },

  _drawSite: function (c, st, x, deckY) {
    var w = 20, h = w;
    if (this._hasArt(st.art)) {
      h = assetH(st.art, w);
      c.save();
      c.translate(Math.round(x * DPX) / DPX, 0);
      drawA(c, st.art, -w / 2, deckY - h, w, h);
      c.restore();
    } else {
      c.fillStyle = '#6d4526';
      c.fillRect(Math.round((x - 9) * DPX) / DPX, deckY - 12, 18, 12);
      h = 12;
    }
    // a job in progress shows over the table, so the dock tells you it is busy
    var j = this.activeJob(st.key);
    if (!j) return;
    var bx = x - 12, by = deckY - h - 8;
    if (this.jobReady(j)) {
      var pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
      c.globalAlpha = pulse;
      uiPanel(c, bx - 2, by - 4, 28, 10, 0.9, true);
      text(c, 'ready', bx + 12, by - 1.5, { size: 6, color: '#4a3020', align: 'center', shadow: false });
      c.globalAlpha = 1;
    } else {
      this._bar(c, bx, by, 24, 4, j.t / j.dur, this.stalled(st.key) ? '#e8434c' : st.pal.hi);
    }
  },

  // Indoors: the tinkering table, drawn on the house floor.
  drawHouse: function (c) {
    if (!this.ensure()) return;
    var floor = (typeof HouseScene !== 'undefined' && HouseScene.FLOOR) ? HouseScene.FLOOR : 173;
    var st = this.station_(G.inv.tab) || this.STATIONS[0];
    var w = 22, h = this._hasArt(st.art) ? assetH(st.art, w) : 16;
    c.save();
    c.translate(Math.round(this.HOUSE_X * DPX) / DPX, 0);
    if (this._hasArt(st.art)) drawA(c, st.art, -w / 2, floor - h, w, h);
    else { c.fillStyle = '#6d4526'; c.fillRect(-9, floor - 12, 18, 12); }
    c.restore();
    var j = this.activeJob(st.key);
    if (j && !this.jobReady(j)) this._bar(c, this.HOUSE_X - 12, floor - h - 7, 24, 4, j.t / j.dur, st.pal.hi);
  },

  // ==== odds and ends =======================================================
  _say: function (msg) { this.note = msg; this.noteT = 2.6; },

  _stationSound: function (stKey) {
    if (stKey === 'mill') SND.scrape();
    else if (stKey === 'forge') SND.thump(0.4);
    else SND.clink();
  },

  _buzz: function (ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
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
  // The five mandatory wraps, plus the two scene freezes and (unless the
  // integrator says otherwise) our own deck presence. Idempotent.
  install: function () {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;

    // 1. the only slot that ticks every frame while a scene is live -- the queue
    //    has to keep burning charcoal whether or not a panel is up.
    var gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      Inv.update(dt);
    };

    // 2. Shop's exact z-order: after the colour grade, under toasts and help.
    var gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (Inv.open) { Inv.draw(c); return; }
      gHUD(c);
    };

    // 3. a scene change dismisses us, the way updateFade does for Shop/Bench.
    var gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) {
      if (Inv.open) { Inv.open = false; Inv.mode = null; Inv.drag = null; }
      return gGo(scene, arg);
    };

    // 4. Game.drawCursor hides the arrow after 3 idle seconds and only knows
    //    about Shop, so a pointer-driven panel would go cursorless.
    var gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (Inv.open && !TouchUI.enabled) { Inv._cursor(c); return; }
      gCursor(c);
    };

    // 5. otherwise the walk and paw pads stay live under the panel.
    var tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return Inv.open ? [] : tLayout(); };

    // 6. freeze the host scene: without this Otto walks under the panel and the
    //    deck spot re-fires every frame.
    if (typeof WorldScene !== 'undefined') {
      var wu = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (Inv.open) return; wu(dt); };
    }
    if (typeof HouseScene !== 'undefined') {
      var hu = HouseScene.update.bind(HouseScene);
      HouseScene.update = function (dt) { if (Inv.open) return; hu(dt); };
    }

    // The bag screen draws the hotbar itself so there is something to drag onto.
    // Whether the wiring layer ALSO draws it depends on where this file's script
    // tag sits, and the bar's backing plank is semi-transparent -- drawn twice it
    // reads as a darker plank. First call in a frame wins, the same guard
    // Craft.drawBuffs uses.
    var hbar = this._hb();
    if (hbar && hbar.draw) {
      var hdraw = hbar.draw.bind(hbar);
      hbar.draw = function (c) {
        if (typeof Game !== 'undefined' && Game.time === Inv._hbStamp) return;
        if (typeof Game !== 'undefined') Inv._hbStamp = Game.time;
        hdraw(c);
      };
    }

    if (!this.selfWire) return;

    // Deck presence. js/integrate.js owns the deck plan, so this is the fallback
    // that makes the stations reachable when nothing has wired them: set
    // Inv.selfWire = false there and concat Inv.spots() / call Inv.drawDock.
    if (typeof WorldScene !== 'undefined' && WorldScene.spots) {
      var ws = WorldScene.spots.bind(WorldScene);
      WorldScene.spots = function () { return ws().concat(Inv.spots()); };
      var wd = WorldScene.draw.bind(WorldScene);
      WorldScene.draw = function (ctx) {
        wd(ctx);
        ctx.save();
        ctx.translate(-this.camX, 0);
        Inv.drawDock(ctx, this.camX);
        ctx.restore();
      };
    }
    if (typeof HouseScene !== 'undefined' && HouseScene.spots) {
      var hs = HouseScene.spots.bind(HouseScene);
      HouseScene.spots = function () { return hs().concat(Inv.houseSpots()); };
      var hd = HouseScene.draw.bind(HouseScene);
      HouseScene.draw = function (ctx) { hd(ctx); Inv.drawHouse(ctx); };
    }
  },
};

// Load-order-agnostic install: DOMContentLoaded fires after every classic script
// in <body>, so this works whether the tag sits before or after js/main.js.
if (typeof Game !== 'undefined') Inv.install();
else document.addEventListener('DOMContentLoaded', function () { Inv.install(); }, { once: true });
