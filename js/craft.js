// ---- craft, cook & build: otto's second bench --------------------------------
// One modal, three tabs, all of it hand-cut wood and paper tags. CRAFT turns
// tide-junk into tackle, tools and cannonballs; COOK turns produce and meat
// into hot food that mends hearts and grants a timed buff; BUILD spends money
// and materials to put a structure on the dock and raises a flag in G.built
// that the farm / livestock / battle systems read.
//
// The whole file talks to the inventory through exactly three functions —
// Craft.have / Craft.take / Craft.give — so re-pointing them at a unified
// inventory later is a three-line change (see the INVENTORY section).
'use strict';

const Craft = {
  // ---- window geometry ---------------------------------------------------
  // Sits inside the 40..440 x 22..248 box every other modal respects, so it
  // never fights the HUD strip or the touch buttons.
  WX: 44, WY: 24, WW: 392, WH: 222,
  ROW_H: 28,          // row band pitch; the card itself is CARD_H tall
  CARD_H: 25,
  VIS: 5,             // rows on screen; the rest scrolls
  DECK_Y: 214,        // deck surface line — keep in sync with world.js DECK_Y
  FX_MAX: 48,         // cosmetic sparks only, hard capped

  TABS: [
    { id: 'craft', name: 'CRAFT', verb: 'MAKE',  blurb: 'tackle, tools and ammunition' },
    { id: 'cook',  name: 'COOK',  verb: 'COOK',  blurb: 'hot food mends hearts' },
    { id: 'build', name: 'BUILD', verb: 'BUILD', blurb: 'put it up on the dock' },
  ],

  // Where the bench and each built structure stands on the pier. `b` is how many
  // pilings must exist before that stretch of deck is walkable.
  //
  // The near dock is full: house door 56, Sprout 150, her stall 190, ClamNet 232,
  // the professor 268, the workbench 300, farm beds 348..775, Marlow 640, pilings
  // 460/640/820. The bench takes the last free gap on the day-one deck (the
  // 420..456 band, between the third bed and the North Piling) and everything
  // bulky goes out past the beds. Retune any of these in one line — nothing else
  // in the file hard-codes an x.
  SITES: {
    bench:  { x: 434, b: 1 },   // the crafting bench itself — always there
    barrel: { x: 448, b: 1 },   // tucked against the bench, part of the cluster
    scarer: { x: 490, b: 1 },   // downwind of the beds, which is the point of it
    shed:   { x: 618, b: 2 },
    pen:    { x: 676, b: 2 },
    cannon: { x: 858, b: 3 },   // far end of the dock, pointing out to sea
  },

  // ---- runtime state (never persisted) -----------------------------------
  open: false,
  tab: 0,
  scroll: 0,
  sel: -1,            // row the footer is describing (touch taps it)
  buffs: [],          // [{ key, name, t }] — in memory: a buff dies with the session
  time: 0,
  fx: [],
  _rows: [],
  _note: '', _noteT: 0,
  _hooked: false,
  _stamp: -1,
  _buffStamp: -1,
  _grain: null,

  // ---- materials, dishes and produce names -------------------------------
  // Anything that is not an ITEMS key needs a name and an icon here. Entries
  // marked `mine` are the keys this module creates, so ensure() can give them
  // a storage slot; the rest are produce owned by the farm / livestock modules
  // and are listed only so a cost chip still reads correctly without them.
  MATS: {
    driftwood:  { name: 'Driftwood',        glyph: 'plank',   mine: true, desc: 'Planks the tide gave back.' },
    rope:       { name: 'Kelp Rope',        glyph: 'rope',    mine: true, desc: 'Twisted kelp, sun-dried.' },
    iron:       { name: 'Iron Scrap',       glyph: 'iron',    mine: true, desc: 'Salvage off an old trawler.' },
    charcoal:   { name: 'Charcoal',         glyph: 'coal',    mine: true, desc: 'Burnt driftwood. Burns hot.' },
    water:      { name: 'Fresh Water',      glyph: 'water',   mine: true, desc: 'Rain, caught in the barrel.' },
    cannonball: { name: 'Cannonball',       glyph: 'ball',    mine: true, desc: 'Shell grit packed hard. Fits the cannon.' },
    crabpot:    { name: 'Crab Pot',         glyph: 'pot',     mine: true, desc: 'Sink it off the dock overnight.' },
    fertiliser: { name: 'Shell Fertiliser', glyph: 'sack',    mine: true, desc: 'The beds drink it up.' },
    tea:        { name: 'Kelp Tea',         glyph: 'cup',     mine: true },
    chowder:    { name: 'Clam Chowder',     glyph: 'bowl',    mine: true },
    grill:      { name: 'Grilled Hogfish',  glyph: 'plate',   mine: true },
    custard:    { name: 'Moon Custard',     glyph: 'custard', mine: true },
    skewer:     { name: 'Urchin Skewer',    glyph: 'skewer',  mine: true },
    rolls:      { name: 'Curl & Roe Rolls', glyph: 'roll',    mine: true },
    // farm produce (Farm.CROPS keys)
    blade: { name: 'Kelp Blade', art: 'crop_blade_p' },
    curl:  { name: 'Sea Curl',   art: 'crop_curl_p' },
    berry: { name: 'Tide Berry', art: 'crop_berry_p' },
    gourd: { name: 'Reef Gourd', art: 'crop_gourd_p' },
    moon:  { name: 'Moonbloom',  art: 'crop_moon_p' },
    // livestock produce
    stock_puffer_p:  { name: 'Puffer Milk',  art: 'stock_puffer_p' },
    stock_sunfish_p: { name: 'Sunfish Roe',  art: 'stock_sunfish_p' },
    stock_hogfish_p: { name: 'Hogfish Cut',  art: 'stock_hogfish_p' },
  },

  // Keys this module owns, derived from MATS at the bottom of the file.
  MAT_KEYS: [],

  // ---- buffs -------------------------------------------------------------
  // `mul` fields are read through Craft.factor(field) so a system can ask for a
  // number instead of branching on buff keys.
  BUFFS: {
    warm:  { name: 'Warm Inside', color: '#ffd45a', air: 0.75,   desc: 'Calm breathing — air lasts longer.' },
    swift: { name: 'Swift Paws',  color: '#a0f2b4', speed: 1.25, desc: 'Otto walks and swims quicker.' },
    sharp: { name: 'Sharp Eye',   color: '#5ad2f0', scrape: 1.3, desc: 'The scraper bites deeper.' },
    lucky: { name: 'Moonlucky',   color: '#e0b0ff', luck: 1.5,   desc: 'The reef feels generous.' },
    steady: { name: 'Steady Paws', color: '#ffc07a', pry: 1.2, def: 0.7, desc: 'Wider pry window, and knocks hurt less.' },
  },
  MAX_BUFFS: 6,

  // ---- recipes -----------------------------------------------------------
  // { key, name, tab, cost:{itemKey:n}, money, out:{key,n}, desc, art }
  // Optional extras used by the tabs:
  //   buy      true  -> money-only supply order, drawn under its own heading
  //   heal     hearts restored when the dish is eaten (cook)
  //   buff     { key, t } applied on eating (cook)
  //   flag     G.built.<flag> = true on success (build)
  //   counter  G.built.<counter>++ on success, capped by `max` (build)
  //   glyph    coded stand-in icon name, when there is no art and no output
  //   req(g)   gate; reqText is shown greyed when it fails
  //   done(g)  already-owned test; doneText is the inert button label
  //   apply()  side effect that is not an item (e.g. a gear tier)
  //   label(g) dynamic display name
  //   moneyFor(g) dynamic price, overrides `money`
  RECIPES: [
    // ---- CRAFT: supply orders ------------------------------------------
    // No system ships a driftwood/coal/iron drop yet, so these keep every
    // recipe below reachable. Delete them once beachcombing exists — nothing
    // else in the file depends on them.
    { key: 'buy_wood', name: 'Driftwood Bundle', tab: 'craft', buy: true,
      cost: {}, money: 8, out: { key: 'driftwood', n: 3 }, art: null,
      desc: 'Three good planks, dropped off by the supply drone.' },
    { key: 'buy_rope', name: 'Coil of Rope', tab: 'craft', buy: true,
      cost: {}, money: 16, out: { key: 'rope', n: 2 }, art: null,
      desc: 'Shop-bought. Twisting your own kelp is cheaper.' },
    { key: 'buy_coal', name: 'Sack of Charcoal', tab: 'craft', buy: true,
      cost: {}, money: 12, out: { key: 'charcoal', n: 3 }, art: null,
      desc: 'Smells like a bonfire. Cooks like one too.' },
    { key: 'buy_iron', name: 'Iron Scrap', tab: 'craft', buy: true,
      cost: {}, money: 22, out: { key: 'iron', n: 1 }, art: null,
      desc: 'A hull plate off a wreck, cut down to size.' },

    // ---- CRAFT: real recipes -------------------------------------------
    { key: 'water', name: 'Draw Fresh Water', tab: 'craft',
      cost: {}, money: 0, out: { key: 'water', n: 3 }, art: null,
      req: (g) => !!g.built.barrel, reqText: 'needs the Rain Barrel',
      desc: 'The barrel catches rain all night. Free, if you carry it.' },
    { key: 'rope', name: 'Kelp Rope', tab: 'craft',
      cost: { blade: 1 }, money: 0, out: { key: 'rope', n: 2 }, art: null,
      desc: 'Twist a kelp blade while it is still wet and it sets like cord.' },
    { key: 'crabpot', name: 'Crab Pot', tab: 'craft',
      cost: { driftwood: 3, rope: 2 }, money: 0, out: { key: 'crabpot', n: 1 }, art: null,
      desc: 'Bait it, sink it off the planks, haul it up in the morning.' },
    { key: 'fertiliser', name: 'Shell Fertiliser', tab: 'craft',
      cost: { barnacle: 4, blade: 1 }, money: 0, out: { key: 'fertiliser', n: 2 }, art: null,
      desc: 'Ground barnacle and kelp. The beds drink it up.' },
    { key: 'cannonball', name: 'Cannonballs', tab: 'craft',
      cost: { barnacle: 3, charcoal: 2 }, money: 0, out: { key: 'cannonball', n: 4 }, art: null,
      desc: 'Shell grit packed hard around coal. The crab punks hate these.' },
    { key: 'scraperhead', name: 'Forge a Scraper Head', tab: 'craft',
      cost: { iron: 2, driftwood: 1 }, money: 40, out: null, art: 'g_scraper', btn: 'FORGE',
      done: (g) => typeof SCRAPERS !== 'undefined' && g.gear.scraper >= SCRAPERS.length - 1,
      doneText: 'MAX',
      apply() { G.gear.scraper = Math.min(SCRAPERS.length - 1, G.gear.scraper + 1); },
      label: (g) => (typeof SCRAPERS !== 'undefined' && SCRAPERS[g.gear.scraper + 1])
        ? 'Forge: ' + SCRAPERS[g.gear.scraper + 1].name : 'Forge a Scraper Head',
      desc: 'Hammer iron onto a fresh handle — one scraper tier, no shop needed.' },

    // ---- COOK ------------------------------------------------------------
    { key: 'tea', name: 'Kelp Tea', tab: 'cook',
      cost: { blade: 1, water: 1 }, money: 0, out: { key: 'tea', n: 1 }, art: null,
      heal: 0.5, buff: { key: 'warm', t: 150 },
      desc: "Steeped kelp, no sugar. The professor's favourite — bring him one." },
    { key: 'chowder', name: 'Clam Chowder', tab: 'cook',
      cost: { clamMeat: 2, gourd: 1 }, money: 0, out: { key: 'chowder', n: 1 }, art: null,
      heal: 2,
      desc: 'Thick, hot, full of clam. Mends two whole hearts.' },
    { key: 'skewer', name: 'Urchin Skewer', tab: 'cook',
      cost: { roe: 1, blade: 1, charcoal: 1 }, money: 0, out: { key: 'skewer', n: 1 }, art: null,
      heal: 1, buff: { key: 'sharp', t: 150 },
      desc: 'Roe over the coals. Wakes the eyes right up.' },
    { key: 'grill', name: 'Grilled Hogfish', tab: 'cook',
      cost: { stock_hogfish_p: 1, berry: 1, charcoal: 1 }, money: 0, out: { key: 'grill', n: 1 }, art: null,
      heal: 1, buff: { key: 'swift', t: 180 },
      desc: 'Charred outside, sweet inside. Otto fairly skips afterwards.' },
    { key: 'rolls', name: 'Curl & Roe Rolls', tab: 'cook',
      cost: { stock_sunfish_p: 1, curl: 1 }, money: 0, out: { key: 'rolls', n: 1 }, art: null,
      heal: 1.5, buff: { key: 'steady', t: 180 },
      desc: 'Sea curl wrapped round sunfish roe. Settles the nerves and the paws.' },
    { key: 'custard', name: 'Moon Custard', tab: 'cook',
      cost: { moon: 1, stock_puffer_p: 1 }, money: 0, out: { key: 'custard', n: 1 }, art: null,
      heal: 4, buff: { key: 'lucky', t: 240 },
      desc: 'Moonbloom set in puffer milk. Feast food — fills you right up.' },

    // ---- BUILD -----------------------------------------------------------
    { key: 'b_barrel', name: 'Rain Barrel', tab: 'build',
      cost: { driftwood: 3, iron: 1 }, money: 60, out: null, art: null, glyph: 'water', flag: 'barrel',
      desc: 'Staves and two hoops. Free fresh water every morning.' },
    { key: 'b_shed', name: 'Seed Shed', tab: 'build',
      cost: { driftwood: 5, iron: 1 }, money: 160, out: null, art: 'crop_curl_seed', flag: 'shed',
      desc: 'A dry shelf by the door. Packets keep instead of going mouldy.' },
    { key: 'b_scarer', name: 'Gull Scarer', tab: 'build',
      cost: { driftwood: 2, rope: 2 }, money: 90, out: null, art: null, glyph: 'rope', flag: 'scarer',
      desc: 'A pole, a rag, and a very stern painted face. Gulls hate it.' },
    { key: 'b_pen', name: 'Livestock Pen', tab: 'build',
      cost: { driftwood: 6, rope: 3 }, money: 220, out: null, art: 'stock_puffer_3', flag: 'pen',
      req: (g) => g.bridge >= 2, reqText: 'needs the bridge east',
      desc: 'Railed pen and a trough out on the far planks. Room for stock.' },
    { key: 'b_cannon', name: 'Cannon Emplacement', tab: 'build',
      cost: { iron: 4, driftwood: 4 }, money: 300, out: null, art: 'crab_8', flag: 'cannon',
      req: (g) => g.bridge >= 3, reqText: 'needs the far bridge',
      desc: 'Bolted to the deck at the end of the dock. Load it with cannonballs.' },
    { key: 'b_plots', name: 'Extra Farm Plots', tab: 'build',
      cost: { driftwood: 4 }, money: 120, out: null, art: 'crop_blade_1',
      counter: 'plots', max: 3, doneText: 'MAX',
      moneyFor: (g) => 120 + 90 * (g.built.plots || 0),
      label: (g) => `Extra Farm Plots  (${g.built.plots || 0}/3)`,
      desc: 'Till two more beds straight into the planks.' },
  ],

  // Built from the cook recipes at the bottom of the file: item key -> effect.
  DISHES: {},

  // ---- state plumbing ----------------------------------------------------

  // Every public entry point starts here. G is null until loadAssets' callback
  // runs, and G.built is a TOP-LEVEL object which Game.load does NOT deep-merge
  // — a save written by an older build replaces it wholesale — so the shape is
  // re-normalised defensively on every call instead of being trusted once.
  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    this.hook();
    let b = G.built;
    if (!b || typeof b !== 'object') { b = {}; G.built = b; }
    for (const k of ['barrel', 'shed', 'scarer', 'pen', 'cannon']) b[k] = !!b[k];
    b.plots = clamp(Math.round(b.plots) || 0, 0, 3);
    if (G.storage && typeof G.storage === 'object') {
      // storage IS deep-merged by Game.load, so our extra keys survive; they
      // just have to be finite integers before anything spends them.
      for (const k of this.MAT_KEYS) {
        const n = Math.floor(G.storage[k]);
        G.storage[k] = (isFinite(n) && n > 0) ? n : 0;
      }
    }
    return true;
  },

  // Game / TouchUI / WorldScene live in main.js and world.js, which load AFTER
  // this file, so the modal hooks cannot be installed at file scope. They go in
  // on the first entry point that runs — idempotent, so call it whenever.
  hook() {
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
    };
    // Game.drawHUD is called only when no built-in modal is open and only after
    // the colour grade — exactly Shop's z-order. Returning early hides the HUD
    // the same way Shop and Bench do.
    const gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.draw(c); return; }
      gHUD(c);
      if (!Game.helpOpen) self.drawBuffs(c);
    };
    // scene changes must dismiss the modal (Shop/Bench get this from updateFade)
    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };
    // hide the walk/paw buttons underneath so touches reach our rows
    const layout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return self.open ? [] : layout(); };
    // main.js does not know about us, so the scene would keep walking (and
    // re-fire its spot) underneath the modal.
    for (const sc of [typeof WorldScene !== 'undefined' ? WorldScene : null,
                      typeof HouseScene !== 'undefined' ? HouseScene : null]) {
      if (!sc || !sc.update) continue;
      const inner = sc.update.bind(sc);
      sc.update = function (dt) { if (self.open) return; inner(dt); };
    }
  },

  // ---- INVENTORY ---------------------------------------------------------
  // Every count in this file goes through have / take / give, and all three go
  // through _bin(). G.storage is the bin today: Game.load deep-merges storage,
  // so material keys that are not in ITEMS survive a save/load untouched.
  //
  // INTEGRATOR: to source some keys from somewhere else (Farm produce lives in
  // G.farm.crops, Hotbar stacks live in G.hotbar) re-point _bin — one line and
  // reads, spends and payouts all stay consistent:
  //   Craft._bin = function (key) {
  //     if (typeof Farm !== 'undefined' && Farm.CROPS[key]) return G.farm.crops;
  //     return G.storage;
  //   };
  // Overriding have/take/give directly works too; nothing else touches counts.
  _bin(key) {
    if (typeof G === 'undefined' || !G || !G.storage) return null;
    return G.storage;
  },

  // what the bin itself holds — never routed through have(), because have() is
  // the hook an integrator overrides (and may report hotbar/farm stock too)
  _raw(key) {
    const bin = this._bin(key);
    if (!bin) return 0;
    const n = Math.floor(bin[key]);
    return (isFinite(n) && n > 0) ? n : 0;
  },

  have(key) { return this._raw(key); },

  // All or nothing: a short take must spend NOTHING, or a failed recipe would
  // quietly eat half its cost.
  take(key, n) {
    n = Math.max(1, Math.floor(n || 1));
    const bin = this._bin(key);
    const inBin = bin ? this._raw(key) : 0;
    // If have() was widened to count hotbar stacks, part of the cost may be
    // sitting there; Hotbar.take happily takes a partial amount, so its stock is
    // counted up front rather than trusted afterwards.
    const hot = (typeof Hotbar !== 'undefined' && Hotbar.take && Hotbar.count) ? Hotbar : null;
    const inHot = hot ? (hot.count('item', key) || 0) : 0;
    if (inBin + inHot < n) return false;
    const spend = Math.min(inBin, n);
    if (spend > 0) bin[key] = inBin - spend;
    if (n - spend > 0) hot.take('item', key, n - spend);
    return true;
  },

  give(key, n) {
    n = Math.max(1, Math.floor(n || 1));
    const bin = this._bin(key);
    if (!bin) return false;
    bin[key] = this._raw(key) + n;
    return true;
  },

  // ---- recipe queries ----------------------------------------------------

  recipe(key) {
    for (const r of this.RECIPES) if (r.key === key) return r;
    return null;
  },

  tabRecipes(id) {
    const out = [];
    for (const r of this.RECIPES) if (r.tab === id) out.push(r);
    return out;
  },

  name(r) { return (r && r.label && G) ? r.label(G) : (r ? r.name : ''); },

  price(r) {
    if (!r) return 0;
    const p = r.moneyFor && G ? r.moneyFor(G) : r.money;
    const n = Math.round(p);
    return isFinite(n) && n > 0 ? n : 0;
  },

  // true once the thing exists / is maxed out, so the row goes inert
  done(r) {
    if (!r || !this.ensure()) return false;
    if (r.done) return !!r.done(G);
    if (r.flag) return !!G.built[r.flag];
    if (r.counter) return (G.built[r.counter] || 0) >= (r.max || 1);
    return false;
  },

  // null when it can be made, otherwise a short lower-case reason for the UI
  missing(r) {
    if (!this.ensure() || !r) return 'not ready';
    if (r.req && !r.req(G)) return r.reqText || 'not yet';
    if (this.done(r)) return 'already done';
    if (G.money < this.price(r)) return 'not enough sand dollars';
    for (const k in r.cost) {
      if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
      if (this.have(k) < r.cost[k]) return 'need ' + this.itemName(k).toLowerCase();
    }
    return null;
  },

  can(r) { return !this.missing(r); },

  // ---- making ------------------------------------------------------------

  // Spends money and materials, produces the output, returns true on success.
  // Accepts a recipe object or its key.
  make(r) {
    if (typeof r === 'string') r = this.recipe(r);
    if (!r || !this.ensure()) return false;
    // an inert row (locked / already built) is a nudge, not a mistake — the
    // alarm is reserved for "you are actually short of something"
    if (this.done(r)) { SND.blip(); this._say(r.doneText ? 'already the best you can do' : 'already built'); return false; }
    if (r.req && !r.req(G)) { SND.blip(); this._say(r.reqText || 'not yet'); return false; }
    const why = this.missing(r);
    if (why) {
      SND.alarm();
      this._say(why);
      return false;
    }
    const cost = this.price(r);
    if (cost > 0) G.money -= cost;
    for (const k in r.cost) {
      if (!Object.prototype.hasOwnProperty.call(r.cost, k)) continue;
      this.take(k, r.cost[k]);
    }
    if (r.out) this.give(r.out.key, r.out.n);
    if (r.flag) G.built[r.flag] = true;
    if (r.counter) G.built[r.counter] = (G.built[r.counter] || 0) + 1;
    if (r.apply) r.apply();

    // counters live in G.flags because that object IS deep-merged by Game.load
    const bucket = r.tab === 'cook' ? 'cooked' : (r.tab === 'build' ? 'builtCount' : 'crafted');
    G.flags[bucket] = (G.flags[bucket] || 0) + 1;

    if (r.tab === 'build') { SND.cash(); SND.thump(0.6); Game.toast(`Built: ${this.name(r)}`); }
    else if (r.tab === 'cook') { SND.chime(); Game.toast(`Cooked: ${this.name(r)}`); }
    else if (r.buy) { SND.cash(); Game.toast(`Ordered: ${this.name(r)}`); }
    else { SND.clink(); Game.toast(`Made: ${this.name(r)}`); }

    this._spark(r.tab === 'build' ? '#c9a271' : '#ffe66e');
    this._say('');
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    Game.save();
    return true;
  },

  // ---- eating ------------------------------------------------------------

  // Dishes are ordinary items, so anything (a gift, a shop, a hotbar) can hold
  // one; eating is the only thing that turns it into hearts and a buff.
  eat(key) {
    if (!this.ensure()) return false;
    const d = this.DISHES[key];
    if (!d) return false;
    if (this.have(key) < 1) { SND.alarm(); this._say('none cooked yet'); return false; }
    this.take(key, 1);
    const gained = this.heal(d.heal || 0);
    if (d.buff) this.addBuff(d.buff.key, d.buff.t);
    SND.pop(0.85);
    let msg = `Ate the ${this.itemName(key)}.`;
    if (gained > 0) msg = `${this.itemName(key)}: +${gained === 0.5 ? 'half a' : gained} heart${gained > 1 ? 's' : ''}!`;
    else if (d.buff) msg = `${this.itemName(key)}: ${this.BUFFS[d.buff.key].name}!`;
    Game.toast(msg);
    this._spark('#ffb0a0');
    Game.save();
    return true;
  },

  // hearts are counted in halves everywhere else, so round to 0.5
  heal(n) {
    if (!G || n <= 0) return 0;
    const before = G.hearts;
    G.hearts = Math.min(G.maxHearts, Math.round((G.hearts + n) * 2) / 2);
    return G.hearts - before;
  },

  // ---- buffs -------------------------------------------------------------

  addBuff(key, t) {
    const def = this.BUFFS[key];
    if (!def) return;
    for (const b of this.buffs) {
      if (b.key !== key) continue;
      b.t = Math.max(b.t, t);   // refresh, never stack
      return;
    }
    this.buffs.push({ key, name: def.name, t });
    if (this.buffs.length > this.MAX_BUFFS) this.buffs.shift();
  },

  hasBuff(key) {
    for (const b of this.buffs) if (b.key === key && b.t > 0) return true;
    return false;
  },

  buffTime(key) {
    for (const b of this.buffs) if (b.key === key) return Math.max(0, b.t);
    return 0;
  },

  clearBuffs() { this.buffs.length = 0; },

  // Multiplies every active buff's `field`, so a caller asks for a number
  // instead of branching: DiveScene does air *= Craft.factor('air').
  factor(field) {
    let m = 1;
    for (const b of this.buffs) {
      const def = this.BUFFS[b.key];
      if (def && typeof def[field] === 'number') m *= def[field];
    }
    return m;
  },

  airMul() { return this.factor('air'); },        // multiply air DRAIN by this
  speedMul() { return this.factor('speed'); },
  scrapeMul() { return this.factor('scrape'); },
  luckMul() { return this.factor('luck'); },
  pryMul() { return this.factor('pry'); },        // widen the pry sweet spot
  defMul() { return this.factor('def'); },        // multiply incoming damage by this

  // ---- little helpers other systems want ---------------------------------

  built(flag) { return this.ensure() ? !!G.built[flag] : false; },
  extraPlots() { return this.ensure() ? (G.built.plots || 0) : 0; },
  ammo() { return this.have('cannonball'); },
  useAmmo(n) { return this.take('cannonball', n || 1); },

  // A night's sleep ends the day and every buff with it. Optional hook — call
  // it from the sleep handler / Game.newDayRegrow.
  newDay() {
    if (this.buffs.length) Game.toast('You slept off the last of your supper.');
    this.clearBuffs();
    this.fx.length = 0;
  },

  // The world spot. spots() is the shape the wiring layer merges (every other
  // module exposes the same); spot() is the single object, for a caller that
  // wants to push one entry itself.
  spot() {
    const self = this;
    return { x: this.SITES.bench.x, label: 'Crafting Bench  (make & cook)', act() { self.openUI(); } };
  },

  spots() { return [this.spot()]; },

  // ---- modal lifecycle ---------------------------------------------------

  openUI() {
    if (!this.ensure()) return;
    this.open = true;
    this.scroll = 0;
    this.sel = -1;
    this._say('');
    SND.blip();
    if (!G.flags.seenCraft) {
      G.flags.seenCraft = true;
      Game.toast('Craft tackle, cook supper, build on the dock!');
    }
  },

  close() { this.open = false; this.sel = -1; SND.click(); },

  setTab(i) {
    i = clamp(i | 0, 0, this.TABS.length - 1);
    if (i === this.tab) return;
    this.tab = i;
    this.scroll = 0;
    this.sel = -1;
    this._say('');
    SND.blip();
  },

  nudge(d) {
    const max = Math.max(0, this._rows.length - this.VIS);
    const next = clamp(this.scroll + (d > 0 ? 1 : -1), 0, max);
    if (next !== this.scroll) { this.scroll = next; SND.blip(); }
  },

  rows() { return this.tabRecipes(this.TABS[this.tab].id); },

  _say(msg) { this._note = msg || ''; this._noteT = msg ? 2.4 : 0; },

  _spark(col) {
    const cx = this.WX + this.WW / 2, cy = this.WY + this.WH / 2;
    for (let i = 0; i < 12 && this.fx.length < this.FX_MAX; i++) {
      const a = rand(TAU);
      this.fx.push({ x: cx, y: cy, vx: Math.cos(a) * rand(20, 70), vy: Math.sin(a) * rand(20, 70) - 20, t: rand(0.3, 0.7), col });
    }
  },

  // ---- update ------------------------------------------------------------
  // Driven by the Game.globalUpdate wrapper installed in hook(), so it runs
  // every frame a scene is live — buffs tick whether or not the modal is up.
  update(dt) {
    this.hook();
    if (typeof Game !== 'undefined' && Game.time === this._stamp) return;  // double-call guard
    if (typeof Game !== 'undefined') this._stamp = Game.time;
    this.time += dt;

    for (let i = this.buffs.length - 1; i >= 0; i--) {
      const b = this.buffs[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.buffs.splice(i, 1);
      Game.toast(`${b.name} wore off.`);
    }
    if (this._noteT > 0) this._noteT -= dt;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const p = this.fx[i];
      p.t -= dt;
      if (p.t <= 0) { this.fx.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 130 * dt;
    }

    if (!this.open) return;
    // never drive the UI behind a fade or another modal
    if (Game.fadeDir !== 0 || Game.helpOpen) return;
    if (typeof Shop !== 'undefined' && Shop.open) return;
    if (typeof Bench !== 'undefined' && Bench.open) return;
    this.uiUpdate(dt);
  },

  uiUpdate(dt) {
    // Claim the keys the scene would otherwise act on: Input.p CONSUMES, so the
    // bench spot cannot re-fire underneath us. (KeyH is polled by main.js earlier
    // in the frame, so help can still open on top — update() bails while it is.)
    Input.p('KeyH'); Input.p('KeyE'); Input.p('Space');
    if (Input.p('Escape')) { this.close(); return; }
    for (let i = 0; i < this.TABS.length; i++) if (Input.p('Digit' + (i + 1))) this.setTab(i);
    if (Input.p('ArrowUp')) this.nudge(-1);
    if (Input.p('ArrowDown')) this.nudge(1);
    if (Input.wheelDelta) this.nudge(Input.wheelDelta);

    this._rows = this.rows();
    this.scroll = clamp(this.scroll, 0, Math.max(0, this._rows.length - this.VIS));

    if (Input.mouse.clicked) this.click(Input.mouse.x, Input.mouse.y);
  },

  // ---- hit rects ---------------------------------------------------------
  // update() and draw() share these on purpose: the geometry exists once, so a
  // button can never drift away from its hit box.
  _in(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },
  _closeRect() { return { x: this.WX + this.WW - 26, y: this.WY + 3, w: 22, h: 18 }; },
  _tabRect(i) { return { x: this.WX + 12 + i * 80, y: this.WY + 22, w: 76, h: 16 }; },
  _rowRect(i) { return { x: this.WX + 12, y: this.WY + 44 + i * this.ROW_H, w: this.WW - 24, h: this.CARD_H }; },
  _btnRect(i) { const r = this._rowRect(i); return { x: this.WX + this.WW - 90, y: r.y + 4, w: 78, h: 17 }; },
  _eatRect(i) { const r = this._rowRect(i); return { x: this.WX + this.WW - 132, y: r.y + 4, w: 38, h: 17 }; },
  _arrowRect(d) { return { x: this.WX + this.WW - (d < 0 ? 52 : 28), y: this.WY + 202, w: 20, h: 14 }; },

  // Single click router — top-most / most specific first, and it returns after
  // the first hit so one click can never fire two actions.
  click(mx, my) {
    if (!this.ensure()) return false;
    if (!this._rows.length) this._rows = this.rows();   // safe if an integrator routes clicks itself
    if (this._in(this._closeRect(), mx, my)) { this.close(); return true; }

    for (let i = 0; i < this.TABS.length; i++) {
      if (this._in(this._tabRect(i), mx, my)) { this.setTab(i); return true; }
    }

    const max = Math.max(0, this._rows.length - this.VIS);
    if (max > 0) {
      for (const d of [-1, 1]) {
        if (this._in(this._arrowRect(d), mx, my)) { this.nudge(d); return true; }
      }
    }

    for (let i = 0; i < this.VIS; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const dish = r.out && this.DISHES[r.out.key];
      if (dish && this.have(r.out.key) > 0 && this._in(this._eatRect(i), mx, my)) {
        this.eat(r.out.key);
        return true;
      }
      if (this._in(this._btnRect(i), mx, my)) { this.make(r); return true; }
      if (this._in(this._rowRect(i), mx, my)) {
        // tapping the card just selects it, so touch players can read the desc
        this.sel = i + this.scroll;
        SND.blip();
        return true;
      }
    }

    // clicking the bare deck around the board puts the tools down
    if (mx < this.WX || mx > this.WX + this.WW || my < this.WY || my > this.WY + this.WH) {
      this.close();
      return true;
    }
    return false;
  },

  // ---- names & icons -----------------------------------------------------

  itemName(key) {
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) return ITEMS[key].name;
    const m = this.MATS[key];
    if (m) return m.name;
    if (typeof Farm !== 'undefined' && Farm.PRODUCE && Farm.PRODUCE[key]) return Farm.PRODUCE[key].name;
    if (typeof Hotbar !== 'undefined' && Hotbar.ITEM_NAMES && Hotbar.ITEM_NAMES[key]) return Hotbar.ITEM_NAMES[key];
    return String(key).replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  },

  // width that makes `name` fit inside a box x box square (assetH returns the
  // box width unchanged for a missing image, which lands on box — harmless)
  _fitW(name, box) {
    const h = assetH(name, box);
    return h > box ? box * box / h : box;
  },

  drawIcon(ctx, key, cx, cy, box) {
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) { drawItemIcon(ctx, key, cx, cy, box); return; }
    const m = this.MATS[key];
    const art = (m && m.art) || (typeof Farm !== 'undefined' && Farm.PRODUCE && Farm.PRODUCE[key] ? Farm.PRODUCE[key].art : null);
    if (art && ASSETS[art] && ASSETS[art].width) {
      const w = this._fitW(art, box);
      drawAC(ctx, art, cx, cy, w);
      return;
    }
    this._glyph(ctx, (m && m.glyph) || 'plank', cx, cy, box);
  },

  // Hand-coded stand-ins for the materials and dishes that have no art yet, so
  // a row reads as a thing and not as an empty box. Every shape sets fillStyle
  // once — no colour strings built inside a loop.
  _glyph(ctx, g, cx, cy, box) {
    const u = box / 12;                 // glyphs are drawn on a 12x12 grid
    const wood = '#8a6434', dark = '#5a3a1e', iron = '#8f9aa4', steel = '#c9d4dc';
    const cream = '#f6e8c9', kelp = '#4a7a46';
    ctx.save();
    ctx.translate(cx, cy);
    if (g === 'plank') {
      ctx.fillStyle = wood;
      ctx.fillRect(-5 * u, -3.4 * u, 10 * u, 2.6 * u);
      ctx.fillRect(-4 * u, 0.4 * u, 9 * u, 2.6 * u);
      ctx.fillStyle = dark;
      ctx.fillRect(-5 * u, -1.2 * u, 10 * u, 0.6 * u);
      ctx.fillRect(-4 * u, 2.6 * u, 9 * u, 0.6 * u);
    } else if (g === 'rope') {
      ctx.strokeStyle = '#c9a271';
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath(); ctx.arc(0, 0, 3.6 * u, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0.8 * u, 1.8 * u, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,58,30,0.45)';
      ctx.lineWidth = 0.5 * u;
      ctx.beginPath(); ctx.arc(0, 0, 4.2 * u, 0, TAU); ctx.stroke();
    } else if (g === 'iron') {
      ctx.fillStyle = iron;
      ctx.beginPath();
      ctx.moveTo(-4.6 * u, 1 * u); ctx.lineTo(-2 * u, -3.6 * u); ctx.lineTo(2.4 * u, -2.4 * u);
      ctx.lineTo(4.6 * u, 2 * u); ctx.lineTo(-1 * u, 3.6 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = steel;
      ctx.fillRect(-2.2 * u, -2 * u, 3.4 * u, 1 * u);
      ctx.fillStyle = '#6b5a4a';                 // rust
      ctx.fillRect(1 * u, 0.6 * u, 2 * u, 1.2 * u);
    } else if (g === 'coal') {
      ctx.fillStyle = '#2a2622';
      ctx.beginPath(); ctx.arc(-2 * u, 1 * u, 2.4 * u, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(2.2 * u, 0.4 * u, 2 * u, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -2.4 * u, 1.8 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a534c';
      ctx.fillRect(-2.6 * u, -0.4 * u, 1.4 * u, 0.7 * u);
      ctx.fillRect(1.6 * u, -0.6 * u, 1.2 * u, 0.6 * u);
    } else if (g === 'water') {
      ctx.fillStyle = '#9fc4d4';
      ctx.fillRect(-3 * u, -2 * u, 6 * u, 6 * u);
      ctx.fillStyle = '#5ad2f0';
      ctx.fillRect(-2.2 * u, -1.2 * u, 4.4 * u, 4.4 * u);
      ctx.fillStyle = '#bfe8f5';
      ctx.fillRect(-2.2 * u, -1.2 * u, 4.4 * u, 1 * u);
      ctx.fillStyle = '#9fc4d4';
      ctx.fillRect(-2 * u, -3.4 * u, 4 * u, 1.4 * u);   // neck
      ctx.fillRect(2.8 * u, -1 * u, 1.6 * u, 2.6 * u);  // handle
    } else if (g === 'ball') {
      ctx.fillStyle = '#2f3338';
      ctx.beginPath(); ctx.arc(0, 0.4 * u, 4 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#575d63';
      ctx.beginPath(); ctx.arc(-1.3 * u, -1.1 * u, 1.5 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8f9aa4';
      ctx.beginPath(); ctx.arc(-1.6 * u, -1.5 * u, 0.7 * u, 0, TAU); ctx.fill();
    } else if (g === 'pot') {
      ctx.strokeStyle = wood;
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath(); ctx.arc(0, 1.6 * u, 4.4 * u, Math.PI, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.4 * u, 1.6 * u); ctx.lineTo(4.4 * u, 1.6 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2.2 * u, 1.6 * u); ctx.lineTo(-2.2 * u, -2.2 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2.2 * u, 1.6 * u); ctx.lineTo(2.2 * u, -2.2 * u); ctx.stroke();
      ctx.fillStyle = kelp;
      ctx.fillRect(-1 * u, -0.6 * u, 2 * u, 2 * u);     // the bait
    } else if (g === 'sack') {
      ctx.fillStyle = '#c9a271';
      ctx.beginPath();
      ctx.moveTo(-3.4 * u, -1 * u); ctx.lineTo(3.4 * u, -1 * u);
      ctx.lineTo(4.2 * u, 4.4 * u); ctx.lineTo(-4.2 * u, 4.4 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(-2.2 * u, -2.6 * u, 4.4 * u, 1.8 * u);
      ctx.fillStyle = '#a8b0ac';
      ctx.fillRect(-1.6 * u, 1 * u, 1.2 * u, 1.2 * u);
      ctx.fillRect(0.6 * u, 2.2 * u, 1.2 * u, 1.2 * u);
    } else if (g === 'cup') {
      ctx.fillStyle = cream;
      ctx.fillRect(-3 * u, -1 * u, 5.6 * u, 4.4 * u);
      ctx.fillStyle = '#6a8a4a';                        // the brew
      ctx.fillRect(-2.4 * u, -0.4 * u, 4.4 * u, 1.2 * u);
      ctx.fillStyle = cream;
      ctx.fillRect(-3.6 * u, 3.4 * u, 6.8 * u, 1 * u);  // saucer
      ctx.strokeStyle = cream;
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath(); ctx.arc(3.2 * u, 0.8 * u, 1.4 * u, -1, 1.6); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';       // steam
      ctx.lineWidth = 0.6 * u;
      ctx.beginPath();
      ctx.moveTo(-1 * u, -2 * u); ctx.quadraticCurveTo(0.4 * u, -3.2 * u, -0.6 * u, -4.6 * u);
      ctx.stroke();
    } else if (g === 'bowl') {
      ctx.fillStyle = '#f2e2c9';
      ctx.beginPath(); ctx.arc(0, 0.6 * u, 4.4 * u, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#e8c48a';
      ctx.fillRect(-4.4 * u, -0.4 * u, 8.8 * u, 1.4 * u);
      ctx.fillStyle = '#d9b98a';
      ctx.fillRect(-2 * u, 0.2 * u, 1.4 * u, 0.8 * u);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.6 * u;
      ctx.beginPath();
      ctx.moveTo(0.6 * u, -1.6 * u); ctx.quadraticCurveTo(1.8 * u, -2.8 * u, 0.8 * u, -4.2 * u);
      ctx.stroke();
    } else if (g === 'plate') {
      ctx.fillStyle = '#f2e6c9';
      ctx.beginPath(); ctx.ellipse(0, 1.6 * u, 5 * u, 2.2 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c98a52';                        // the fish
      ctx.beginPath(); ctx.ellipse(-0.4 * u, 0.4 * u, 3.4 * u, 1.6 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a86432';
      ctx.beginPath();
      ctx.moveTo(2.8 * u, 0.4 * u); ctx.lineTo(4.6 * u, -1 * u); ctx.lineTo(4.6 * u, 1.8 * u);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(-2.6 * u, -0.4 * u, 4.6 * u, 0.5 * u);  // grill marks
      ctx.fillRect(-2.2 * u, 0.8 * u, 4.2 * u, 0.5 * u);
    } else if (g === 'custard') {
      ctx.fillStyle = '#e8e2f2';
      ctx.fillRect(-3.4 * u, -0.6 * u, 6.8 * u, 4 * u);
      ctx.fillStyle = '#fff4c9';                        // set custard
      ctx.beginPath(); ctx.ellipse(0, -0.6 * u, 3.4 * u, 1.4 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0b0ff';                        // moonbloom petal
      ctx.beginPath(); ctx.arc(0.8 * u, -1.4 * u, 1.1 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#cfc8dc';
      ctx.fillRect(-3.4 * u, 3.4 * u, 6.8 * u, 0.8 * u);
    } else if (g === 'roll') {
      ctx.fillStyle = '#3f6a3a';                        // two kelp-wrapped rolls
      ctx.beginPath(); ctx.ellipse(-2.4 * u, 0.6 * u, 2.6 * u, 3 * u, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(2.6 * u, 1 * u, 2.6 * u, 3 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2e6c9';                        // the pale middle
      ctx.beginPath(); ctx.ellipse(-2.4 * u, 0.6 * u, 1.5 * u, 1.9 * u, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(2.6 * u, 1 * u, 1.5 * u, 1.9 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#eda93e';                        // roe
      ctx.beginPath(); ctx.arc(-2.4 * u, 0.6 * u, 0.9 * u, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(2.6 * u, 1 * u, 0.9 * u, 0, TAU); ctx.fill();
    } else if (g === 'skewer') {
      ctx.fillStyle = wood;
      ctx.fillRect(-0.5 * u, -4.6 * u, 1 * u, 9.2 * u);
      ctx.fillStyle = '#eda93e';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.arc(0, i * 2.4 * u, 1.8 * u, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(-1.4 * u, -3 * u, 1 * u, 1 * u);
    }
    ctx.restore();
  },

  // ---- draw --------------------------------------------------------------

  // The one action button on a row. Split out because the finished-structure
  // rows skip the cost chips but still need an identical button.
  _rowButton(ctx, i, rec, isDone, blocked, ok, tabId, mx, my) {
    const btn = this._btnRect(i);
    const bHov = this._in(btn, mx, my);
    let bLabel = rec.btn || (rec.buy ? 'ORDER' : this.TABS[this.tab].verb);
    let bCol = '#4a3020', bFill = 'rgba(160,120,74,0.30)', bEdge = 'rgba(90,58,30,0.55)';
    if (isDone) { bLabel = rec.doneText || (tabId === 'build' ? 'BUILT' : 'DONE'); bCol = '#8a7a62'; bFill = 'rgba(160,120,74,0.14)'; }
    else if (blocked) { bLabel = 'LOCKED'; bCol = '#8a7a62'; bFill = 'rgba(160,120,74,0.14)'; }
    else if (!ok) { bCol = '#a83030'; bFill = 'rgba(168,48,48,0.12)'; bEdge = 'rgba(168,48,48,0.45)'; }
    else if (bHov) { bFill = '#e8c48a'; bEdge = '#7a4a2c'; }
    ctx.fillStyle = bFill;
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = bEdge;
    ctx.lineWidth = ok && bHov ? 1.4 : 1;
    ctx.strokeRect(btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1);
    text(ctx, bLabel, btn.x + btn.w / 2, btn.y + 4.5, { size: 7.5, color: bCol, align: 'center', shadow: false });
  },

  draw(ctx) {
    if (!this.ensure()) return;
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    // rebuilt every frame, like Shop.buildRows: money, stock and built flags can
    // all change under the modal (Game.globalUpdate keeps running)
    this._rows = this.rows();

    ctx.fillStyle = 'rgba(8,12,10,0.68)';
    ctx.fillRect(0, 0, W, H);

    // ---- the board: sawn planks, nailed down ----------------------------
    ctx.fillStyle = '#c9a271';
    ctx.fillRect(X, Y, WW, HH);
    ctx.fillStyle = 'rgba(120,80,44,0.20)';
    for (let by = Y + 13; by < Y + HH; by += 13) ctx.fillRect(X, by, WW, PIX * 2);
    ctx.fillStyle = 'rgba(120,80,44,0.13)';           // grain, fixed once at load
    for (const g of this._grain) ctx.fillRect(X + g[0], Y + g[1], g[2], PIX * 2);
    ctx.fillStyle = 'rgba(255,238,205,0.35)';
    ctx.fillRect(X, Y, WW, 1.4);
    ctx.strokeStyle = '#6d4526';
    ctx.lineWidth = 2;
    ctx.strokeRect(X + 1, Y + 1, WW - 2, HH - 2);
    ctx.fillStyle = '#5d5348';
    for (const n of [[X + 6, Y + 6], [X + WW - 7, Y + 6], [X + 6, Y + HH - 7], [X + WW - 7, Y + HH - 7]]) {
      ctx.beginPath(); ctx.arc(n[0], n[1], 1.6, 0, TAU); ctx.fill();
    }

    // ---- title, purse, close -------------------------------------------
    text(ctx, "otto's crafting bench", X + WW / 2, Y + 6, { size: 9, color: '#5a3a1e', align: 'center', shadow: false });
    ctx.fillStyle = 'rgba(90,58,30,0.5)';
    ctx.fillRect(X + WW / 2 - 58, Y + 17, 116, PIX * 2);
    text(ctx, `$${G.money}`, X + 12, Y + 7, { size: 8, color: '#6a4420', shadow: false });

    const cr = this._closeRect();
    const cHov = this._in(cr, mx, my);
    ctx.strokeStyle = cHov ? '#a83a2a' : '#6d4526';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cr.x + 5, cr.y + 4); ctx.lineTo(cr.x + 15, cr.y + 14);
    ctx.moveTo(cr.x + 15, cr.y + 4); ctx.lineTo(cr.x + 5, cr.y + 14);
    ctx.stroke();

    // ---- tabs: three carved tags ---------------------------------------
    for (let i = 0; i < this.TABS.length; i++) {
      const r = this._tabRect(i), sel = i === this.tab;
      const hov = this._in(r, mx, my);
      ctx.fillStyle = sel ? '#f6e8c9' : (hov ? 'rgba(246,232,201,0.45)' : 'rgba(109,69,38,0.30)');
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = sel ? '#7a4a2c' : 'rgba(90,58,30,0.45)';
      ctx.lineWidth = sel ? 1.4 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (sel) {                                     // the tag sits proud of the board
        ctx.fillStyle = 'rgba(90,58,30,0.22)';
        ctx.fillRect(r.x, r.y + r.h, r.w, PIX * 2);
      }
      text(ctx, `${i + 1}. ${this.TABS[i].name}`, r.x + r.w / 2, r.y + 4,
        { size: 7.5, color: sel ? '#4a3020' : '#7a5232', align: 'center', shadow: false });
    }
    text(ctx, this.TABS[this.tab].blurb, X + WW - 12, Y + 26, { size: 6.5, color: '#7a5232', align: 'right', shadow: false });

    // ---- rows: paper tags tied to the board ----------------------------
    const tabId = this.TABS[this.tab].id;
    let shown = 0;
    for (let i = 0; i < this.VIS; i++) {
      const rec = this._rows[i + this.scroll];
      if (!rec) break;
      shown++;
      const r = this._rowRect(i);
      const btn = this._btnRect(i);
      const isDone = this.done(rec);
      const blocked = rec.req && !rec.req(G);
      const ok = this.can(rec);
      const hov = this._in(r, mx, my);

      ctx.fillStyle = isDone ? 'rgba(240,232,208,0.62)' : (hov ? '#fbf1da' : '#f2e6c9');
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = hov ? '#8a5a2c' : 'rgba(122,74,48,0.4)';
      ctx.lineWidth = hov ? 1.4 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = 'rgba(122,74,48,0.18)';
      ctx.fillRect(r.x, r.y + r.h, r.w, PIX * 2);
      ctx.fillStyle = '#8a5a2c';                       // the string hole
      ctx.beginPath(); ctx.arc(r.x + 6, r.y + r.h / 2, 1.4, 0, TAU); ctx.fill();
      if (rec.buy) {                                   // supply orders get a stamp edge
        ctx.fillStyle = 'rgba(122,74,48,0.30)';
        ctx.fillRect(r.x + 1, r.y + 1, PIX * 3, r.h - 2);
      }

      // icon: the recipe's own art, else the output's icon
      ctx.globalAlpha = isDone ? 0.5 : 1;
      if (rec.art && ASSETS[rec.art] && ASSETS[rec.art].width) {
        drawAC(ctx, rec.art, r.x + 22, r.y + r.h / 2, this._fitW(rec.art, 19));
      } else if (rec.out) {
        this.drawIcon(ctx, rec.out.key, r.x + 22, r.y + r.h / 2, 19);
      } else {
        this._glyph(ctx, rec.glyph || 'plank', r.x + 22, r.y + r.h / 2, 19);
      }
      ctx.globalAlpha = 1;

      // name (+ how many you already have of the output)
      const nameX = r.x + 36;
      const label = this.name(rec);
      text(ctx, label, nameX, r.y + 3, { size: 8, color: isDone ? '#8a7a62' : '#4a3020', shadow: false });
      if (rec.out) {
        const n = this.have(rec.out.key);
        if (n > 0)
          text(ctx, `x${n}`, nameX + textWidth(ctx, label, 8) + 6, r.y + 3.5,
            { size: 7, color: '#2f7a4a', shadow: false });
      }

      // cost chips — a finished structure shows its state instead of its bill
      let cx2 = nameX;
      const chipY = r.y + 14;
      if (isDone) {
        text(ctx, rec.flag ? 'standing on the dock' : (rec.counter ? 'as many as the planks will hold' : 'done'),
          nameX, chipY, { size: 6.5, color: '#7a5232', shadow: false });
        this._rowButton(ctx, i, rec, isDone, false, false, tabId, mx, my);
        continue;
      }
      const cost$ = this.price(rec);
      if (cost$ > 0) {
        const afford = G.money >= cost$;
        text(ctx, `$${cost$}`, cx2, chipY, { size: 6.5, color: afford ? '#6a4420' : '#a83030', shadow: false });
        cx2 += textWidth(ctx, `$${cost$}`, 6.5) + 8;
      }
      for (const k in rec.cost) {
        if (!Object.prototype.hasOwnProperty.call(rec.cost, k)) continue;
        const need = rec.cost[k], got = this.have(k);
        this.drawIcon(ctx, k, cx2 + 4, chipY + 3.5, 9);
        const s = `${got}/${need}`;
        text(ctx, s, cx2 + 10, chipY, { size: 6.5, color: got >= need ? '#2f7a4a' : '#a83030', shadow: false });
        cx2 += 12 + textWidth(ctx, s, 6.5) + 7;
      }
      if (cost$ === 0 && cx2 === nameX)
        text(ctx, 'free', cx2, chipY, { size: 6.5, color: '#7a5232', shadow: false });

      // EAT button, for a dish you already have one of
      const dish = rec.out && this.DISHES[rec.out.key];
      if (dish && this.have(rec.out.key) > 0) {
        const er = this._eatRect(i);
        const eHov = this._in(er, mx, my);
        ctx.fillStyle = eHov ? '#e8b45a' : 'rgba(232,180,90,0.55)';
        ctx.fillRect(er.x, er.y, er.w, er.h);
        ctx.strokeStyle = '#7a4a2c';
        ctx.lineWidth = 1;
        ctx.strokeRect(er.x + 0.5, er.y + 0.5, er.w - 1, er.h - 1);
        text(ctx, 'EAT', er.x + er.w / 2, er.y + 4.5, { size: 7.5, color: '#4a3020', align: 'center', shadow: false });
      }

      this._rowButton(ctx, i, rec, isDone, blocked, ok, tabId, mx, my);

      // buff / heal note for a dish, on the button's left edge
      if (dish) {
        const bits = [];
        if (dish.heal) bits.push(`+${dish.heal} hp`);
        if (dish.buff) bits.push(this.BUFFS[dish.buff.key].name);
        if (bits.length && !(this.have(rec.out.key) > 0))
          text(ctx, bits.join('  '), btn.x - 6, r.y + 9, { size: 6.5, color: '#2f6f46', align: 'right', shadow: false });
      }
    }

    if (!shown) {
      const ey = Y + HH / 2 - 20;
      ctx.fillStyle = '#f2e6c9';
      ctx.fillRect(X + 44, ey, WW - 88, 34);
      ctx.strokeStyle = 'rgba(122,74,48,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(X + 44.5, ey + 0.5, WW - 89, 33);
      text(ctx, 'nothing on this shelf yet', X + WW / 2, ey + 11, { size: 8, color: '#7a5a3a', align: 'center', shadow: false });
    }

    // ---- desc strip: the tag you are pointing at -----------------------
    const dy = Y + 186;
    ctx.fillStyle = 'rgba(90,58,30,0.16)';
    ctx.fillRect(X + 12, dy, WW - 24, 13);
    let note = '';
    let noteCol = '#5a3a1e';
    if (this._noteT > 0 && this._note) { note = '! ' + this._note; noteCol = '#a83030'; }
    else {
      let idx = -1;
      for (let i = 0; i < this.VIS; i++) {
        if (this._rows[i + this.scroll] && this._in(this._rowRect(i), mx, my)) { idx = i + this.scroll; break; }
      }
      if (idx < 0) idx = this.sel;
      const rec = this._rows[idx];
      note = rec ? rec.desc : 'pick a tag to read it';
      if (rec && rec.req && !rec.req(G)) { note = (rec.reqText || 'not yet') + ' — ' + rec.desc; noteCol = '#8a5a2c'; }
    }
    text(ctx, note, X + 18, dy + 3, { size: 6.5, color: noteCol, shadow: false });

    // ---- footer: hint, page, arrows ------------------------------------
    text(ctx, TouchUI.enabled ? 'tap a tag to read  •  X to put the tools down' : '[1-3] shelves  [wheel] scroll  [Esc] done',
      X + 14, Y + 206, { size: 6.5, color: '#7a5232', shadow: false });
    const max = Math.max(0, this._rows.length - this.VIS);
    if (max > 0) {
      text(ctx, `${this.scroll + 1}-${Math.min(this._rows.length, this.scroll + this.VIS)} / ${this._rows.length}`,
        X + WW - 62, Y + 206, { size: 6.5, color: '#7a5232', align: 'right', shadow: false });
      for (const d of [-1, 1]) {
        const ar = this._arrowRect(d);
        const canGo = d < 0 ? this.scroll > 0 : this.scroll < max;
        const aHov = canGo && this._in(ar, mx, my);
        ctx.fillStyle = aHov ? '#e8c48a' : 'rgba(160,120,74,0.28)';
        ctx.fillRect(ar.x, ar.y, ar.w, ar.h);
        ctx.strokeStyle = canGo ? 'rgba(90,58,30,0.55)' : 'rgba(90,58,30,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ar.x + 0.5, ar.y + 0.5, ar.w - 1, ar.h - 1);
        text(ctx, d < 0 ? '^' : 'v', ar.x + ar.w / 2, ar.y + 2.5,
          { size: 8, color: canGo ? '#4a3020' : '#a08a68', align: 'center', shadow: false });
      }
    }

    // ---- sparks from the last successful make --------------------------
    if (this.fx.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(X, Y, WW, HH); ctx.clip();
      for (const p of this.fx) {
        ctx.globalAlpha = clamp(p.t * 2, 0, 1);
        ctx.fillStyle = p.col;                        // one colour per particle, no string building
        ctx.fillRect(p.x, p.y, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Game.drawCursor hides the arrow after 3 idle seconds and only special-cases
    // Shop, so this pointer-driven panel draws its own.
    if (!TouchUI.enabled && Input.mouse.idleT > 3) {
      ctx.save();
      ctx.translate(Math.round(mx), Math.round(my));
      ctx.fillStyle = '#101820';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 11); ctx.lineTo(3, 8); ctx.lineTo(7, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2f4f6';
      ctx.beginPath(); ctx.moveTo(1, 2); ctx.lineTo(1, 8.5); ctx.lineTo(2.8, 7); ctx.lineTo(5, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  },

  // ---- buff chips near the HUD -------------------------------------------
  // Drawn from the Game.drawHUD slot, so it is NOT colour-graded — same as the
  // hearts and the purse. Sits under them at x 6, clear of the goal pill.
  drawBuffs(ctx) {
    if (!this.buffs.length) return;
    // A wiring layer may call this from the scene draw AND our HUD hook may call
    // it again in the same frame; the chips are semi-transparent, so drawing them
    // twice reads as a darker panel. First call in a frame wins.
    if (typeof Game !== 'undefined') {
      if (Game.time === this._buffStamp) return;
      this._buffStamp = Game.time;
    }
    const y = 38;
    let x = 6;
    for (const b of this.buffs) {
      const def = this.BUFFS[b.key];
      if (!def) continue;
      const w = 40;
      uiPanel(ctx, x, y, w, 13, 0.86);
      // a fat pip in the buff's colour, then the seconds left
      ctx.fillStyle = def.color;
      ctx.fillRect(x + 3, y + 4, 4, 5);
      text(ctx, `${Math.ceil(b.t)}s`, x + w - 4, y + 3, { size: 6.5, color: '#f6e8c9', align: 'right' });
      // timer bar along the bottom edge, full width at 60s and above
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x + 2, y + 11, (w - 4) * clamp(b.t / 60, 0.04, 1), PIX * 2);
      ctx.globalAlpha = 1;
      x += w + 3;
      if (x > W - 90) break;      // never run under the day/time dial
    }
  },

  // ---- structures on the dock --------------------------------------------
  // WORLD SPACE: call this from inside WorldScene.draw, after the deck props
  // and before Otto, while ctx is still translated by -camX.
  drawDock(ctx) {
    if (!this.ensure()) return;
    const D = this.DECK_Y, bridge = G.bridge || 1;
    const site = (id) => (bridge >= this.SITES[id].b ? this.SITES[id].x : -1);

    // ---- the crafting bench itself: a plank table and a tool rack -------
    const bx = site('bench');
    if (bx > 0) {
      ctx.fillStyle = '#8a6434';                     // legs
      ctx.fillRect(bx - 13, D - 10, 2.5, 10);
      ctx.fillRect(bx + 10.5, D - 10, 2.5, 10);
      ctx.fillStyle = '#c9a271';                     // top
      ctx.fillRect(bx - 16, D - 13, 32, 3.4);
      ctx.fillStyle = 'rgba(255,238,205,0.35)';
      ctx.fillRect(bx - 16, D - 13, 32, 0.8);
      ctx.fillStyle = '#6d4526';                     // rack posts + crossbar
      ctx.fillRect(bx - 14, D - 34, 2, 21);
      ctx.fillRect(bx + 12, D - 34, 2, 21);
      ctx.fillRect(bx - 14, D - 34, 28, 2);
      drawAC(ctx, 'g_scraper', bx - 7, D - 26, this._fitW('g_scraper', 11));
      drawAC(ctx, 'g_plier', bx + 2, D - 26, this._fitW('g_plier', 10));
      drawAC(ctx, 'g_knife', bx + 9, D - 26, this._fitW('g_knife', 9));
      // a half-finished pot on the bench, so it always looks in use
      this._glyph(ctx, 'pot', bx + 8, D - 17, 9);
    }

    // ---- rain barrel ---------------------------------------------------
    const rx = site('barrel');
    if (rx > 0 && G.built.barrel) {
      // belly out the staves a little, or a 12x17 box reads as a crate
      ctx.fillStyle = '#8a6434';
      ctx.fillRect(rx - 5.4, D - 18, 10.8, 18);
      ctx.fillRect(rx - 6.2, D - 14, 12.4, 10);
      ctx.fillStyle = 'rgba(90,58,30,0.35)';
      for (let i = 0; i < 3; i++) ctx.fillRect(rx - 4 + i * 3.4, D - 18, PIX * 2, 18);
      ctx.fillStyle = '#5a3a1e';                     // iron hoops
      ctx.fillRect(rx - 6.4, D - 14.6, 12.8, 1.4);
      ctx.fillRect(rx - 6.4, D - 5.4, 12.8, 1.4);
      ctx.fillStyle = '#9fc4d4';                     // rim, seen from slightly above
      ctx.beginPath(); ctx.ellipse(rx, D - 18, 5.6, 1.7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5ad2f0';                     // rainwater
      ctx.beginPath(); ctx.ellipse(rx, D - 17.8, 4.4, 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(191,232,245,0.75)';
      ctx.fillRect(rx - 3.4, D - 18.4, 5, 0.6);
    }

    // ---- seed shed -----------------------------------------------------
    const sx = site('shed');
    if (sx > 0 && G.built.shed) {
      ctx.fillStyle = '#c9a271';
      ctx.fillRect(sx - 12, D - 22, 24, 22);
      ctx.fillStyle = 'rgba(120,80,44,0.22)';
      for (let i = 1; i < 4; i++) ctx.fillRect(sx - 12, D - 22 + i * 5.5, 24, PIX * 2);
      ctx.fillStyle = '#6d4526';                     // roof
      ctx.beginPath();
      ctx.moveTo(sx - 15, D - 22); ctx.lineTo(sx, D - 30); ctx.lineTo(sx + 15, D - 22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6434';                     // door
      ctx.fillRect(sx - 4.5, D - 15, 9, 15);
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(sx + 2.5, D - 9, 1.4, 1.4);
      drawAC(ctx, 'crop_curl_seed', sx + 8, D - 17, this._fitW('crop_curl_seed', 8));
    }

    // ---- gull scarer ---------------------------------------------------
    const gx = site('scarer');
    if (gx > 0 && G.built.scarer) {
      const sway = Math.sin(this.time * 1.4) * 1.6;
      // coded post: the `pole` asset is 514x1106, so any sane width makes it far
      // too short to stand a scarecrow on
      ctx.fillStyle = '#8a6434';
      ctx.fillRect(gx - 1.2, D - 38, 2.4, 38);
      ctx.fillStyle = 'rgba(90,58,30,0.4)';
      ctx.fillRect(gx + 0.6, D - 38, 0.8, 38);
      ctx.fillStyle = '#6d4526';                     // arms
      ctx.fillRect(gx - 9, D - 30, 18, 1.8);
      ctx.fillStyle = '#b8452c';                     // rag, flapping
      ctx.beginPath();
      ctx.moveTo(gx + 8, D - 30);
      ctx.lineTo(gx + 15 + sway, D - 27 + sway * 0.6);
      ctx.lineTo(gx + 8, D - 22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2e6c9';                     // stern face
      ctx.beginPath(); ctx.arc(gx, D - 35, 4.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2a1e';
      ctx.fillRect(gx - 2.6, D - 36.6, 1.6, 1.6);
      ctx.fillRect(gx + 1, D - 36.6, 1.6, 1.6);
      ctx.fillRect(gx - 2, D - 33.4, 4, 1);
    }

    // ---- livestock pen -------------------------------------------------
    const px = site('pen');
    if (px > 0 && G.built.pen) {
      ctx.fillStyle = '#8a6434';                     // posts
      for (let i = 0; i < 4; i++) ctx.fillRect(px - 21 + i * 14, D - 15, 2.2, 15);
      ctx.fillStyle = '#c9a271';                     // rails
      ctx.fillRect(px - 21, D - 14, 44, 1.8);
      ctx.fillRect(px - 21, D - 8, 44, 1.8);
      ctx.fillStyle = '#6d4526';                     // trough
      ctx.fillRect(px + 8, D - 5, 14, 5);
      ctx.fillStyle = '#4a7a46';
      ctx.fillRect(px + 9, D - 4.2, 12, 1.6);
      ctx.fillStyle = '#f2e6c9';                     // little sign
      ctx.fillRect(px - 24, D - 22, 11, 7);
      ctx.fillStyle = '#8a5a2c';
      ctx.fillRect(px - 22, D - 20, 7, PIX * 2);
      ctx.fillRect(px - 22, D - 18.4, 5, PIX * 2);
    }

    // ---- cannon emplacement --------------------------------------------
    const cx = site('cannon');
    if (cx > 0 && G.built.cannon) {
      ctx.fillStyle = '#6d4526';                     // sandbag-ish plank berm
      ctx.fillRect(cx - 17, D - 8, 34, 8);
      ctx.fillStyle = '#8a6434';
      ctx.fillRect(cx - 17, D - 8, 34, 2);
      drawAC(ctx, 'crab_8', cx, D - 15, this._fitW('crab_8', 30));
      const ammo = this.have('cannonball');
      if (ammo > 0) {                                // a neat pyramid of shot
        ctx.fillStyle = '#2f3338';
        const n = Math.min(3, ammo);
        for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(cx + 13 + i * 3.4, D - 2.4, 2.2, 0, TAU); ctx.fill(); }
        if (ammo >= 4) { ctx.beginPath(); ctx.arc(cx + 16.4, D - 6, 2.2, 0, TAU); ctx.fill(); }
      }
    }
  },
};

// ---- derived tables ----------------------------------------------------------
// Item keys this module owns (so ensure() can hand them a storage slot) and the
// dish effect table (so eat() works from a bare item key, wherever it came from).
for (const k in Craft.MATS) {
  if (!Object.prototype.hasOwnProperty.call(Craft.MATS, k)) continue;
  if (Craft.MATS[k].mine) Craft.MAT_KEYS.push(k);
}
for (const r of Craft.RECIPES) {
  if (r.tab !== 'cook' || !r.out) continue;
  Craft.DISHES[r.out.key] = { heal: r.heal || 0, buff: r.buff || null, from: r.key };
}
// Board grain, laid out once with a fixed seed: the planks must not crawl.
Craft._grain = (function () {
  const rng = mulberry32(0x0777);
  const g = [];
  for (let i = 0; i < 18; i++) g.push([rng() * (Craft.WW - 40) + 8, rng() * (Craft.WH - 16) + 8, rng() * 40 + 14]);
  return g;
})();
