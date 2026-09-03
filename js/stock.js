// ---- ocean livestock: pens slung under the dock ------------------------------
// Otto buys fry at Sprout's stall, drops them into a net pen hanging off the
// planks, and feeds them every day. Fry mature over a few days; a fed adult
// spends the night making something and holds it until you collect it. Nothing
// ever dies here — neglect only makes an animal listless and unproductive, and
// a scratch behind the fin fixes most of it.
//
// The loop is: buy -> feed -> sleep -> collect -> pet, forever.
'use strict';

const Stock = {
  // ---- tuning ------------------------------------------------------------------
  DECK_Y: 214,        // deck surface line; keep in sync with world.js DECK_Y
  PEN_HW: 24,         // half-width of a pen, in logical units
  PEN_TOP: 216,       // just under the planks, so the net hangs from the deck
  PEN_H: 34,          // net depth; the bottom lands at 250, clear of the screen edge
  PEN_CAP: 4,         // berths per pen
  MAX_PENS: 3,        // hard cap, so a hand-edited save cannot grow the list forever
  UNFED_STOP: 3,      // unfed nights before an animal stops producing entirely
  HAPPY_FED: 0.05,    // happiness a meal is worth
  HAPPY_PET: 0.14,    // happiness a scratch is worth (the whole point of petting)
  HAPPY_HUNGRY: 0.12, // happiness lost per unfed night
  HAPPY_START: 0.6,   // a new arrival is already fairly pleased with the place
  BONUS_HAPPY: 0.85,  // at or above this, a collection can come out double
  BONUS_CHANCE: 0.25,
  FX_MAX: 60,         // purely cosmetic particles, hard capped

  // Species balance. Payback is deliberately flat at ~7-8 fed days once grown,
  // so the choice is about how long you can wait and what the kitchen needs,
  // not about which animal is secretly the correct one:
  //   puffer  190 -> 24/day after 3 days
  //   sunfish 280 -> 38/day after 4 days
  //   hogfish 380 -> 52/day after 5 days
  // The product KEYS are the ones js/craft.js, js/hotbar.js and js/npc.js already
  // know about (cook recipes, gift tables, hotbar labels) — do not rename them.
  SPECIES: [
    {
      key: 'puffer', name: 'Pufferfish', price: 190, matureDays: 3, h: 13, art: 'stock_puffer_3',
      product: { key: 'stock_puffer_p', name: 'Sea Milk', value: 24, art: 'stock_puffer_p' },
      desc: 'Round, patient, faintly indignant. Gives Sea Milk.',
    },
    {
      key: 'sunfish', name: 'Sunfish', price: 280, matureDays: 4, h: 15, art: 'stock_sunfish_3',
      product: { key: 'stock_sunfish_p', name: 'Roe Cluster', value: 38, art: 'stock_sunfish_p' },
      desc: 'Drifts about like a dinner plate. Gives Roe Clusters.',
    },
    {
      key: 'hogfish', name: 'Hogfish', price: 380, matureDays: 5, h: 14, art: 'stock_hogfish_3',
      product: { key: 'stock_hogfish_p', name: 'Fish Meat', value: 52, art: 'stock_hogfish_p' },
      desc: 'Grumbles, roots at the netting, eats anything. Gives Fish Meat.',
    },
  ],

  // Where each pen hangs, and the deck x Otto stands on to reach it. `b` is how
  // many pilings must exist before that stretch of deck is walkable.
  //
  // The deck is crowded and WorldScene picks ONE spot within 22 units, so these
  // x values are chosen to clear every other system by >= 22:
  //   pen 0 spot 662 — 22 from Marlow (640), 23 from the first far bed (685)
  //   pen 1 spot 797 — 22 from the last bed (775), 23 from the Deep Piling (820)
  //   pen 2 spot 882 — 24 from the cannon (858), inside the walk limit (890)
  // The pen ART for pen 0 is centred on 676 on purpose: that is where craft.js
  // builds its railing and trough, so the net hangs directly beneath them.
  PEN_DEF: [
    { x: 676, sx: 662, b: 2 },
    { x: 797, sx: 797, b: 3 },
    { x: 876, sx: 882, b: 3 },
  ],

  // Cozy names, handed out in order so two animals never share one.
  NAMES: {
    puffer: ['Pom', 'Bubble', 'Marbles', 'Tuck', 'Dumpling', 'Sprig'],
    sunfish: ['Sunny', 'Halo', 'Moony', 'Petal', 'Clover', 'Dot'],
    hogfish: ['Rosie', 'Biscuit', 'Piglet', 'Rusty', 'Barley', 'Nub'],
  },

  // ---- window geometry (the pen board) -------------------------------------------
  // Inside the 40..440 x 22..248 box every other modal respects.
  WX: 16, WY: 12, WW: 448, WH: 228,
  _openT: 0,
  ROW_H: 34,

  // ---- runtime state (never persisted) -------------------------------------------
  open: false,
  pen: 0,             // pen the board is showing
  sel: 0,             // berth the keyboard is on
  time: 0,
  fx: [],             // bubbles / hearts / sparks, in world space
  _nl: null, _nlLen: -1,   // the list array last normalised, and its length
  _mot: {},           // animal id -> swim parameters, built once per animal
  _motN: 0,
  _stamp: -1,         // dedupes update() — the wiring layer also ticks us
  _installed: false,
  _scratch: [],       // reused draw-order buffer; never allocate per frame

  // ---- species lookup ------------------------------------------------------------

  // linear scan over three entries, and no prototype walk: a corrupt save could
  // hold 'constructor' where a species key belongs
  byKey(key) {
    if (typeof key !== 'string') return null;
    for (let i = 0; i < this.SPECIES.length; i++) if (this.SPECIES[i].key === key) return this.SPECIES[i];
    return null;
  },

  productOf(key) { const s = this.byKey(key); return s ? s.product : null; },

  // product item key -> the species that makes it
  speciesOfProduct(pkey) {
    for (let i = 0; i < this.SPECIES.length; i++) if (this.SPECIES[i].product.key === pkey) return this.SPECIES[i];
    return null;
  },

  // ---- state plumbing ------------------------------------------------------------

  // Every public entry point starts here. G is null until loadAssets' callback
  // runs, and G.stock is a TOP-LEVEL object which Game.load does NOT deep-merge
  // — a save written by an older build replaces it wholesale — so the shape is
  // re-normalised defensively on every call instead of being trusted once.
  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    this.install();

    let s = G.stock;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      // tolerate a save that stored the bare animal array under G.stock
      s = { list: Array.isArray(G.stock) ? G.stock : [] };
      G.stock = s;
    }
    if (!Array.isArray(s.list)) s.list = [];

    // ensure() guards every entry point, draw() and update() included, so the
    // normalise pass below would rebuild the list and every animal in it sixty
    // times a second. Skip it once the array is known-clean: a load replaces the
    // array (new reference) and a mutation changes its length, and either of
    // those is enough to fall through and re-normalise.
    if (s.list === this._nl && s.list.length === this._nlLen) {
      if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day;
      if (s.lastDay > G.day) s.lastDay = G.day;
      return true;
    }

    // ids first: an animal without one needs a number nothing else is using
    let nid = Math.floor(s.nextId);
    if (!isFinite(nid) || nid < 1) nid = 1;
    for (const raw of s.list) {
      if (!raw || typeof raw !== 'object') continue;
      const id = Math.floor(raw.id);
      if (isFinite(id) && id >= nid) nid = id + 1;
    }
    const kept = [];
    for (const raw of s.list) {
      const a = this._clean(raw);
      if (!a) continue;
      if (!a.id) a.id = nid++;
      kept.push(a);
      if (kept.length >= this.MAX_PENS * this.PEN_CAP) break;
    }
    s.list = kept;
    s.nextId = nid;
    this._nl = kept;            // this exact array is now known-clean
    this._nlLen = kept.length;

    s.bought = Math.max(0, Math.round(s.bought) || 0);
    s.collected = Math.max(0, Math.round(s.collected) || 0);
    // lastDay = the calendar day the pens have already been advanced to
    if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day;
    if (s.lastDay > G.day) s.lastDay = G.day;   // save rollback / new game

    // swim parameters are cached per id; drop the lot rather than leak ids of
    // animals that no longer exist (they are rebuilt in one call)
    if (this._motN > 64) { this._mot = {}; this._motN = 0; }
    return true;
  },

  _clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const sp = this.byKey(raw.species);
    if (!sp) return null;               // unknown species: there is nothing to draw
    const happy = (typeof raw.happy === 'number' && isFinite(raw.happy)) ? clamp(raw.happy, 0, 1) : this.HAPPY_START;
    const id = Math.floor(raw.id);
    return {
      species: sp.key,
      name: (typeof raw.name === 'string' && raw.name) ? raw.name.slice(0, 14) : this._pickName(sp.key),
      age: clamp(Math.round(raw.age) || 0, 0, 999),
      fed: !!raw.fed,
      happy: happy,
      product: raw.product === sp.product.key ? sp.product.key : null,
      penIndex: clamp(Math.round(raw.penIndex) || 0, 0, this.MAX_PENS - 1),
      hungry: clamp(Math.round(raw.hungry) || 0, 0, 9),
      petted: !!raw.petted,
      id: (isFinite(id) && id > 0) ? id : 0,
    };
  },

  // ---- pens ----------------------------------------------------------------------

  // How many pens Otto actually has. The building system raises G.built.pen —
  // craft.js stores a boolean there today and a later build may store a count,
  // so both are accepted and anything else reads as "no pens yet".
  penCount() {
    if (typeof G === 'undefined' || !G) return 0;
    const b = G.built;
    if (!b || typeof b !== 'object') return 0;
    let n = 0;
    if (b.pen === true) n = 1;
    else if (typeof b.pen === 'number' && isFinite(b.pen)) n = Math.floor(b.pen);
    n = clamp(n, 0, this.MAX_PENS);
    // PEN_DEF is ordered by bridge requirement, so the reachable pens are always
    // a prefix of the list: stop at the first one whose deck does not exist yet.
    const bridge = G.bridge || 1;
    let out = 0;
    while (out < n && bridge >= this.PEN_DEF[out].b) out++;
    return out;
  },

  capacity() { return this.penCount() * this.PEN_CAP; },

  list() { return this.ensure() ? G.stock.list : []; },

  get(i) {
    if (!this.ensure()) return null;
    return G.stock.list[i | 0] || null;
  },

  // flat indices of the animals in a pen, in berth order — feed/pet/collect all
  // take a flat index, so this is how a caller turns a pen into buttons
  indicesIn(p) {
    const out = [];
    const l = this.list();
    for (let i = 0; i < l.length; i++) if (l[i].penIndex === (p | 0)) out.push(i);
    return out;
  },

  countIn(p) { return this.indicesIn(p).length; },

  // the first pen with a free berth, or -1
  freePen() {
    const pens = this.penCount();
    for (let p = 0; p < pens; p++) if (this.countIn(p) < this.PEN_CAP) return p;
    return -1;
  },

  adult(a) { const sp = this.byKey(a.species); return !!sp && a.age >= sp.matureDays; },
  daysToGrow(a) { const sp = this.byKey(a.species); return sp ? Math.max(0, sp.matureDays - a.age) : 0; },
  ready(a) { return !!(a && a.product); },
  listless(a) { return !!a && a.hungry >= this.UNFED_STOP; },

  readyCount() { let n = 0; for (const a of this.list()) if (a.product) n++; return n; },
  hungryCount() { let n = 0; for (const a of this.list()) if (!a.fed) n++; return n; },

  // ---- the produce bin -----------------------------------------------------------
  // G.storage is deep-merged by Game.load, so keys that are not in ITEMS survive
  // a save/load untouched — and it is where craft.js looks for cooking materials.
  // INTEGRATOR: re-point held()/give() to move produce somewhere else (a hotbar,
  // a dedicated crate); nothing else in this file touches counts.
  held(key) {
    if (typeof G === 'undefined' || !G || !G.storage) return 0;
    const n = Math.floor(G.storage[key]);
    return (isFinite(n) && n > 0) ? n : 0;
  },

  give(key, n) {
    if (typeof G === 'undefined' || !G || !G.storage) return false;
    G.storage[key] = this.held(key) + Math.max(1, Math.round(n) || 1);
    return true;
  },

  productTotal() { let n = 0; for (const s of this.SPECIES) n += this.held(s.product.key); return n; },
  productValue() { let v = 0; for (const s of this.SPECIES) v += this.held(s.product.key) * s.product.value; return v; },

  // ---- naming --------------------------------------------------------------------

  _pickName(species) {
    const pool = this.NAMES[species] || this.NAMES.puffer;
    const taken = {};
    if (typeof G !== 'undefined' && G && G.stock && Array.isArray(G.stock.list))
      for (const a of G.stock.list) if (a && typeof a.name === 'string') taken[a.name] = true;
    for (const n of pool) if (!taken[n]) return n;
    // pool exhausted: number them, which still reads fine on a name tag
    for (let k = 2; k < 20; k++) for (const n of pool) if (!taken[n + ' ' + k]) return n + ' ' + k;
    return pick(pool);
  },

  // ---- buying --------------------------------------------------------------------

  // Put a fry in the first free berth. -> pen index, or -1 if there was no room.
  _add(sp) {
    const pen = this.freePen();
    if (pen < 0) return -1;
    G.stock.list.push({
      species: sp.key, name: this._pickName(sp.key), age: 0, fed: false,
      happy: this.HAPPY_START, product: null, penIndex: pen, hungry: 0, petted: false,
      id: G.stock.nextId++,
    });
    G.stock.bought++;
    return pen;
  },

  // The APPLY half of a purchase, for a caller that has already taken the money
  // (js/shop.js does `this.buy(sp.price, () => Stock.buy(sp.key), sp.name)`).
  // If the pens turn out to be full the cash goes straight back, because the
  // shop cannot know that and the player must never pay for nothing.
  buy(speciesKey) {
    if (!this.ensure()) return false;
    const sp = this.byKey(speciesKey);
    if (!sp) return false;
    const pen = this._add(sp);
    if (pen < 0) {
      G.money += sp.price;
      SND.alarm();
      Game.toast('No free berth — your money is back.');
      return false;
    }
    const a = G.stock.list[G.stock.list.length - 1];
    Game.toast(`${a.name} settles into pen ${pen + 1}. A feed a day keeps it happy.`);
    this._firstTimeHint();
    Game.save();
    return true;
  },

  // The whole transaction, for any caller that is not already inside Shop.buy.
  buyAnimal(speciesKey) {
    if (!this.ensure()) return false;
    const sp = this.byKey(speciesKey);
    if (!sp) return false;
    if (this.penCount() <= 0) { SND.alarm(); Game.toast('A pen has to come first -- the crafting bench sells the kit.'); return false; }
    if (this.freePen() < 0) { SND.alarm(); Game.toast('Every pen is full.'); return false; }
    if (G.money < sp.price) { SND.alarm(); Game.toast('Not enough sand dollars.'); return false; }
    // reuse the canonical purchase helper so cash/toast/save behave identically
    Shop.buy(sp.price, () => this.buy(sp.key), `${sp.name} fry`);
    return true;
  },

  _firstTimeHint() {
    if (G.flags.seenStock) return;
    G.flags.seenStock = true;
    Game.toast('Fry grow up in a few days. Fed adults make produce overnight.');
  },

  // ---- the three verbs -----------------------------------------------------------

  feed(i) {
    const a = this.get(i);
    if (!a) return false;
    if (a.fed) { SND.blip(); Game.toast(`${a.name} has already eaten today.`); return false; }
    a.fed = true;
    a.happy = clamp(a.happy + this.HAPPY_FED, 0, 1);
    this._burst(a, 0, 5);
    SND.bubble();
    Game.toast(`${a.name} tucks into the kelp.`);
    Game.save();
    return true;
  },

  // The relationship bit: once a day, and worth roughly three meals of goodwill.
  pet(i) {
    const a = this.get(i);
    if (!a) return false;
    if (a.petted) { SND.blip(); Game.toast(`${a.name} has had plenty of fuss today.`); return false; }
    const before = a.happy;
    a.petted = true;
    a.happy = clamp(a.happy + this.HAPPY_PET, 0, 1);
    this._burst(a, 1, 3);
    SND.rub();
    if (a.happy >= 1 && before < 1) { SND.chime(); Game.toast(`${a.name} could not be happier.`); }
    else Game.toast(`${a.name} leans into your paw.`);
    Game.save();
    return true;
  },

  // -> the product item key, or null if there was nothing to take
  collect(i) {
    const a = this.get(i);
    if (!a || !a.product) return null;
    const sp = this.byKey(a.species);
    const key = a.product;
    a.product = null;
    // a devoted animal hands over a second one now and then: the payoff for petting
    const n = (a.happy >= this.BONUS_HAPPY && Math.random() < this.BONUS_CHANCE) ? 2 : 1;
    this.give(key, n);
    G.stock.collected += n;
    this._burst(a, 2, 8);
    SND.pop(1.2);
    if (n > 1) { SND.chime(); Game.toast(`${a.name} gives you ${n} x ${sp.product.name}.`); }
    else Game.toast(`Collected ${sp.product.name} from ${a.name}.`);
    Game.save();
    return key;
  },

  feedAll(p) {
    let n = 0;
    for (const i of this.indicesIn(p)) {
      const a = this.get(i);
      if (!a || a.fed) continue;
      a.fed = true;
      a.happy = clamp(a.happy + this.HAPPY_FED, 0, 1);
      this._burst(a, 0, 3);
      n++;
    }
    if (!n) { SND.blip(); Game.toast('Everyone in the pen has eaten.'); return 0; }
    SND.bubble();
    Game.toast(`Fed ${n} animal${n === 1 ? '' : 's'}.`);
    Game.save();
    return n;
  },

  collectAll(p) {
    let n = 0;
    for (const i of this.indicesIn(p)) if (this.collect(i)) n++;
    if (!n) { SND.blip(); Game.toast('Nothing to collect yet.'); }
    return n;
  },

  // Ship produce with the same drone crate the shell trade uses. ClamNet's SELL
  // tab only walks ITEM_KEYS, so produce needs its own way off the dock.
  shipProducts(keys) {
    if (!this.ensure()) return 0;
    let v = 0, c = 0;
    for (const k of keys) {
      const sp = this.speciesOfProduct(k);
      const n = this.held(k);
      if (!sp || n <= 0) continue;
      v += n * sp.product.value;
      c += n;
      G.storage[k] = 0;
    }
    if (!c) return 0;
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    SND.click();
    Game.toast(`Produce shipped: $${v} — drone en route!`);
    Game.save();
    return v;
  },

  // ---- the night pass ------------------------------------------------------------

  // Advance the pens to today. Idempotent per calendar day, so it is safe to call
  // from the sleep handler whether the day counter has been bumped yet or not:
  // whichever call sees the new G.day does the work and the other is a no-op.
  newDay() {
    if (!this.ensure()) return;
    const s = G.stock;
    if (s.lastDay >= G.day) return;
    let guard = 0;
    while (s.lastDay < G.day && guard++ < 30) { this._night(); s.lastDay++; }
    s.lastDay = G.day;   // absurd gaps (edited saves) collapse instead of hanging
    Game.save();
  },

  _night() {
    let made = 0, hungry = 0, grown = 0, sulking = 0;
    for (const a of G.stock.list) {
      const sp = this.byKey(a.species);
      const wasBaby = !this.adult(a);
      a.age++;
      if (wasBaby && this.adult(a)) grown++;

      if (a.fed) {
        // An animal starved for UNFED_STOP nights spends this one getting its
        // strength back instead of producing. It never dies — cozy game — it
        // just needs a day of care before the milk comes again.
        const runDown = this.listless(a);
        a.hungry = 0;
        a.happy = clamp(a.happy + this.HAPPY_FED, 0, 1);
        if (runDown) sulking++;
        else if (this.adult(a) && !a.product) { a.product = sp.product.key; made++; }
      } else {
        a.hungry++;
        a.happy = clamp(a.happy - this.HAPPY_HUNGRY, 0, 1);
        hungry++;
      }
      a.fed = false;      // the trough has to be filled again every morning
      a.petted = false;
    }
    const bits = [];
    if (made) bits.push(`${made} to collect`);
    if (grown) bits.push(`${grown} grown up`);
    if (hungry) bits.push(`${hungry} went hungry`);
    if (sulking) bits.push(`${sulking} run down`);
    if (bits.length) Game.toast(`Pens: ${bits.join('  ')}`);
  },

  // ---- world presence ------------------------------------------------------------

  penLabel(p) {
    const idx = this.indicesIn(p);
    const tag = `Fish Pen ${p + 1}`;
    if (!idx.length) return `${tag}  (empty)`;
    let ready = 0, hungry = 0;
    for (const i of idx) { const a = this.get(i); if (a.product) ready++; if (!a.fed) hungry++; }
    if (ready) return `${tag}  (${ready} to collect)`;
    if (hungry) return `${tag}  (${hungry} to feed)`;
    return `${tag}  (${idx.length} content)`;
  },

  // Merge straight into WorldScene.spots(). One spot per pen: the board it opens
  // is where Feed / Pet / Collect live, per animal, because the deck has nowhere
  // near enough room for three prompts per pen (see PEN_DEF) and the verbs are
  // per-animal anyway.
  spots() {
    if (!this.ensure()) return [];
    const out = [];
    const pens = this.penCount();
    for (let p = 0; p < pens; p++) {
      const idx = p;
      out.push({ x: this.PEN_DEF[p].sx, label: this.penLabel(p), act: () => this.openUI(idx) });
    }
    return out;
  },

  // ---- shop rows -----------------------------------------------------------------
  // Shop-shaped rows. shop.js's STALL tab already renders the buy side straight
  // out of SPECIES, so the row an integrator actually needs from here is the
  // shipping side: `rows = rows.concat(Stock.shipRows())`.
  shipRows() {
    if (!this.ensure()) return [];
    const rows = [];
    let total = 0;
    for (const sp of this.SPECIES) {
      const n = this.held(sp.product.key);
      if (n <= 0) continue;
      total += n * sp.product.value;
      rows.push({
        gart: sp.product.art,
        label: `${sp.product.name}  x${n}`,
        sub: `$${sp.product.value} each`,
        btn: `SHIP $${n * sp.product.value}`,
        act: () => this.shipProducts([sp.product.key]),
      });
    }
    if (total > 0)
      rows.push({
        label: 'SHIP ALL PRODUCE', sub: 'one big crate', btn: `$${total}`,
        act: () => this.shipProducts(this.SPECIES.map(s => s.product.key)),
      });
    return rows;
  },

  // buy rows + shipping rows, for a shop that wants the whole counter in one call
  shopRows() {
    if (!this.ensure()) return [];
    const rows = [];
    const pens = this.penCount();
    if (!pens) rows.push({ info: 'No pens yet — build a Livestock Pen at the crafting bench.' });
    else if (this.freePen() < 0) rows.push({ info: `Pens are full (${this.list().length}/${this.capacity()} berths).` });
    const full = pens <= 0 || this.freePen() < 0;
    for (const sp of this.SPECIES) {
      rows.push({
        gart: sp.art,
        label: `${sp.name} Fry`,
        sub: `${sp.desc}  •  grows in ${sp.matureDays}d  •  ${sp.product.name} $${sp.product.value}/day`,
        btn: full ? 'NO ROOM' : `$${sp.price}`,
        price: sp.price,
        act: full ? null : () => this.buyAnimal(sp.key),
      });
    }
    return rows.concat(this.shipRows());
  },

  // ---- per-frame -----------------------------------------------------------------

  update(dt) {
    this._openT = Math.min(1, this._openT + (dt || 0) * 4.5);
    if (!this.ensure()) return;
    // The wiring layer ticks us from Game.globalUpdate and so does our own hook;
    // whichever runs first in a frame does the work and the other returns.
    const now = typeof Game !== 'undefined' ? Game.time : this.time + dt;
    if (now === this._stamp) return;
    this._stamp = now;

    this.time += dt;
    if (G.stock.lastDay < G.day) this.newDay();   // the day rolls over mid-dive and under modals
    // the board cannot outlive its pen (a reload, a scene change, a fresh game)
    if (this.open && this.pen >= this.penCount()) this.open = false;

    // ambient bubbles, only from pens that are on screen and occupied
    const world = typeof WorldScene !== 'undefined' && typeof Game !== 'undefined' && Game.scene === WorldScene;
    if (world) {
      const cam = WorldScene.camX;
      const pens = this.penCount();
      for (let p = 0; p < pens; p++) {
        const d = this.PEN_DEF[p];
        if (d.x < cam - 40 || d.x > cam + W + 40) continue;
        if (!this.countIn(p)) continue;
        if (Math.random() < dt * 1.4)
          this._push(d.x + rand(-this.PEN_HW + 6, this.PEN_HW - 6), this.PEN_TOP + this.PEN_H - 3, 0, rand(-16, -9));
      }
    }

    if (this.fx.length) {
      for (const f of this.fx) {
        f.t -= dt;
        f.y += f.vy * dt;
        f.x += Math.sin((this.time + f.p) * 3.4) * 6 * dt;
      }
      this.fx = this.fx.filter(f => f.t > 0);
    }
  },

  // kind: 0 bubble, 1 heart, 2 collect spark
  _burst(a, kind, n) {
    const pos = this._where(a);
    if (!pos) return;
    for (let i = 0; i < n; i++)
      this._push(pos.x + rand(-4, 4), pos.y + rand(-3, 3), kind, kind === 1 ? rand(-14, -9) : rand(-24, -12));
  },

  _push(x, y, kind, vy) {
    if (this.fx.length >= this.FX_MAX) return;
    this.fx.push({
      x, y, vy, k: kind,
      t: kind === 1 ? rand(0.8, 1.3) : rand(0.5, 1.1),
      s: rand(0.5, 1.1), p: rand(TAU),
    });
  },

  // ---- swimming ------------------------------------------------------------------

  // Deterministic per-animal drift, derived from the id so it survives a reload
  // and never has to be persisted. The two frequencies are deliberately not
  // multiples of one another — that is what makes the lissajous figure wander
  // instead of retracing one loop.
  _motion(a) {
    let m = this._mot[a.id];
    if (m) return m;
    const rng = mulberry32(0x51000 + a.id * 2654);
    m = {
      ph: rng() * TAU,
      sp: 0.42 + rng() * 0.30,        // radians/sec around the figure
      ratio: 1.55 + rng() * 0.55,     // y frequency relative to x — never 1:1
      off: rng() * TAU,
      ax: 0.62 + rng() * 0.26,        // fraction of the usable half-width
      ay: 0.55 + rng() * 0.35,
      lane: rng() < 0.5 ? 0 : 1,      // upper or lower half, so four animals fit
    };
    this._mot[a.id] = m;
    this._motN++;
    return m;
  },

  // Where an animal is this instant, in world space, or null if its pen is gone.
  // The particle bursts use it too, so hearts pop out of the right fish.
  _where(a) {
    if (!a || a.penIndex >= this.penCount()) return null;
    const m = this._motion(a);
    const sp = this.byKey(a.species);
    if (!sp) return null;
    const h = this.adult(a) ? sp.h : sp.h * 0.62;
    const cx = this.PEN_DEF[a.penIndex].x;
    const swimW = this.PEN_HW - 6 - h * 0.35;
    // The band is only ~32 units tall between the planks and the hotbar strip, so
    // it is used to the edges: 3 off the top for the floats, 4 off the bottom so a
    // tail never pokes under the pen's bottom rope.
    const top = this.PEN_TOP + 3 + h * 0.5;
    const bot = this.PEN_TOP + this.PEN_H - 4 - h * 0.5;
    const midY = lerp(top, bot, m.lane ? 0.72 : 0.24);
    const swimH = (bot - top) * 0.26 * m.ay;
    const ph = this.time * m.sp + m.ph;
    return {
      x: cx + Math.sin(ph) * swimW * m.ax,
      // the slow vertical figure, plus a small independent bob
      y: midY + Math.sin(ph * m.ratio + m.off) * swimH + Math.sin(this.time * 2.4 + m.ph) * 0.6,
      // d(sin ph)/d(ph) — the direction of travel, which is what it must face
      vx: Math.cos(ph),
      h: h,
    };
  },

  // ---- drawing -------------------------------------------------------------------

  // WORLD SPACE: call from inside WorldScene.draw while ctx is still translated
  // by -camX (js/integrate.js does exactly that). camX is used for culling only.
  draw(ctx, camX) {
    if (!this.ensure()) return;
    const pens = this.penCount();
    if (!pens) return;
    const cam = camX || 0;
    const nite = (typeof nightness === 'function') ? nightness(G.clock) : 0;
    for (let p = 0; p < pens; p++) {
      const d = this.PEN_DEF[p];
      if (d.x + this.PEN_HW < cam - 20 || d.x - this.PEN_HW > cam + W + 20) continue;
      this._drawPen(ctx, p, d.x, nite);
    }
    this._drawFx(ctx, cam);
  },

  // for a caller that is NOT inside the camera transform yet
  drawScreen(ctx, camX) {
    const cam = camX || 0;
    ctx.save();
    ctx.translate(-cam, 0);
    this.draw(ctx, cam);
    ctx.restore();
  },

  _drawPen(ctx, p, cx, nite) {
    const hw = this.PEN_HW, top = this.PEN_TOP, bot = top + this.PEN_H;
    const idx = this.indicesIn(p);

    // ---- the water inside the pen reads a shade deeper than the open sea -----
    ctx.fillStyle = 'rgba(10,44,62,0.22)';
    ctx.fillRect(cx - hw, top, hw * 2, this.PEN_H);

    // ---- netting: a diagonal mesh, clipped to the pen and hairline thin ------
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - hw, top, hw * 2, this.PEN_H);
    ctx.clip();
    ctx.strokeStyle = 'rgba(201,162,113,0.28)';
    ctx.lineWidth = PIX;
    ctx.beginPath();
    for (let x = cx - hw - this.PEN_H; x < cx + hw + this.PEN_H; x += 7) {
      ctx.moveTo(x, top); ctx.lineTo(x + this.PEN_H, bot);
      ctx.moveTo(x, bot); ctx.lineTo(x + this.PEN_H, top);
    }
    ctx.stroke();
    ctx.restore();

    // ---- frame: two hanging ropes, a bottom bar, floats on the waterline ----
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(cx - hw - 0.5, top - 2, 1.2, this.PEN_H + 2);
    ctx.fillRect(cx + hw - 0.7, top - 2, 1.2, this.PEN_H + 2);
    ctx.fillRect(cx - hw, bot - 1, hw * 2, 1.2);
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(cx - hw, top - 2, hw * 2, 1.2);

    for (let i = 0; i < 3; i++) {
      const fxx = cx - hw + 7 + i * (hw - 1);
      const fy = top - 3.4 + Math.sin(this.time * 1.7 + i * 1.9) * 0.5;
      ctx.fillStyle = i === 1 ? '#e8434c' : '#f2e6c9';
      pixEllipse(ctx, fxx, fy, 2.6, 1.9);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(fxx - 1.4, fy - 1.4, 1.4, 0.5);
    }

    // ---- a coral sprig in the corner, fixed per pen so it never crawls -------
    const coral = 'coral_' + ((3 + p * 6) % 20);
    const cw = this._fitW(coral, 11);
    const ch = assetH(coral, cw);
    drawA(ctx, coral, cx + hw - cw - 2, bot - ch - 1, cw, ch);

    // ---- the trough, with kelp in it once anyone has been fed ---------------
    let fed = 0;
    for (const i of idx) if (this.get(i).fed) fed++;
    const tx = cx - hw + 4;
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(tx, top + 3, 9, 5);
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(tx, top + 3, 9, 1);
    if (fed > 0) {
      ctx.fillStyle = '#4a7a46';
      for (let i = 0; i < 3; i++) {
        const kx = tx + 1.5 + i * 2.6;
        const sway = Math.sin(this.time * 2.2 + i) * 0.4;
        ctx.fillRect(kx, top + 1.2, 1, 2.4);
        ctx.fillRect(kx + sway, top - 0.6, 1, 2);
      }
    }

    // ---- the animals, far lane first so they overlap believably -------------
    const sc = this._scratch;
    let n = 0;
    for (const i of idx) {
      const a = this.get(i);
      const pos = this._where(a);
      if (!pos) continue;
      if (!sc[n]) sc[n] = { a: null, pos: null };   // grow once, then reuse forever
      sc[n].a = a; sc[n].pos = pos;
      n++;
    }
    // insertion sort: n <= PEN_CAP, and it does not allocate
    for (let i = 1; i < n; i++) {
      const cur = sc[i];
      let j = i - 1;
      while (j >= 0 && sc[j].pos.y > cur.pos.y) { sc[j + 1] = sc[j]; j--; }
      sc[j + 1] = cur;
    }
    for (let i = 0; i < n; i++) this._drawAnimal(ctx, sc[i].a, sc[i].pos);

    // An empty pen should look empty on purpose, not broken.
    if (!idx.length)
      text(ctx, 'empty', cx, top + this.PEN_H * 0.5 - 3,
        { size: 6, color: 'rgba(226,214,190,0.45)', align: 'center', shadow: false });

    // The world's night wash is already down by the time this file draws, so the
    // pen has to dim itself or it glows like a lightbox after sunset.
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(8,12,38,${nite * 0.42})`;
      ctx.fillRect(cx - hw - 1, top - 4, hw * 2 + 2, this.PEN_H + 6);
    }
  },

  _drawAnimal(ctx, a, pos) {
    // frames: 0-2 baby idle, 3-5 adult idle, 6-8 producing
    const base = a.product ? 6 : (this.adult(a) ? 3 : 0);
    const m = this._motion(a);
    const step = Math.floor(this.time * 3.1 + m.ph) % 3;
    const art = `stock_${a.species}_${base + step}`;
    const img = ASSETS[art];
    const flip = pos.vx > 0;                       // every stock sheet faces LEFT
    if (img && img.width) {
      const h = pos.h, w = h * img.width / img.height;
      // a slow tail-driven roll, always into the direction of travel
      const tilt = Math.sin(this.time * 3 + m.ph) * 0.055 * (flip ? -1 : 1);
      ctx.save();
      ctx.translate(Math.round(pos.x * DPX) / DPX, Math.round(pos.y * DPX) / DPX);
      ctx.rotate(tilt);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // an unfed animal nudges the surface and puts up its own small "!"
    if (!a.fed && !a.product) {
      // clamped under the planks: anything above PEN_TOP would draw on the deck
      const py = Math.max(this.PEN_TOP + 1, pos.y - pos.h * 0.6 - 4.5)
        + Math.sin(this.time * 2.6 + m.ph) * 0.7;
      ctx.fillStyle = 'rgba(255,230,110,0.75)';
      ctx.fillRect(pos.x - 0.4, py, 0.8, 2.2);
      ctx.fillRect(pos.x - 0.4, py + 3, 0.8, 0.8);
    }

    if (a.product) this._drawProductBubble(ctx, a, pos);
  },

  // the "come and get it" flag: the product floating in a bubble over its head
  _drawProductBubble(ctx, a, pos) {
    const sp = this.byKey(a.species);
    const m = this._motion(a);
    const bx = pos.x;
    // The bubble rises to just under the planks and stays there — floating it a
    // fixed distance above the animal would put it on the deck. The lane offset
    // keeps two bubbles from sitting on top of each other.
    const by = Math.max(this.PEN_TOP + 7 + m.lane * 4, pos.y - pos.h * 0.6 - 8)
      + Math.sin(this.time * 1.9 + m.ph) * 1.1;

    ctx.fillStyle = 'rgba(150,225,245,0.26)';
    ctx.beginPath(); ctx.arc(bx, by, 6.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(230,250,255,0.55)';
    ctx.lineWidth = PIX;
    ctx.beginPath(); ctx.arc(bx, by, 6.6, 0, TAU); ctx.stroke();

    const iw = this._fitW(sp.product.art, 8);
    const ih = assetH(sp.product.art, iw);
    drawA(ctx, sp.product.art, bx - iw / 2, by - ih / 2, iw, ih);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(bx - 4, by - 4.4, 1.6, 0.6);
  },

  _drawFx(ctx, cam) {
    if (!this.fx.length) return;
    // one fillStyle per kind — never build a colour string inside the loop
    for (let k = 0; k < 3; k++) {
      let styled = false;
      for (const f of this.fx) {
        if (f.k !== k || f.x < cam - 20 || f.x > cam + W + 20) continue;
        ctx.globalAlpha = clamp(f.t * 1.6, 0, k === 1 ? 0.95 : 0.7);
        if (k === 1) { drawHeart(ctx, f.x - 3.5, f.y - 2.75, 'full'); continue; }
        if (!styled) { ctx.fillStyle = k === 0 ? '#bfe8f5' : '#e08a1a'; styled = true; }
        if (k === 0) { ctx.beginPath(); ctx.arc(f.x, f.y, f.s, 0, TAU); ctx.fill(); }
        else ctx.fillRect(f.x - f.s / 2, f.y - f.s / 2, f.s, f.s);
      }
    }
    ctx.globalAlpha = 1;
  },

  // inverse of assetH: the width that gives a sprite the height we want
  _fitW(name, h) {
    const img = ASSETS[name];
    if (!img || !img.width || !img.height) return h;   // same silent fallback as assetH
    return h * img.width / img.height;
  },

  // ---- the pen board (self-contained modal) --------------------------------------

  openUI(p) {
    if (!this.ensure()) return;
    if (Shop.open || Bench.open || Game.helpOpen) return;
    if (typeof Craft !== 'undefined' && Craft.open) return;
    if (typeof NPCs !== 'undefined' && NPCs.open) return;
    const pens = this.penCount();
    if (pens <= 0) { SND.alarm(); Game.toast('A pen has to come first.'); return; }
    this.pen = clamp(p | 0, 0, pens - 1);
    this.sel = 0;
    this.open = true;
    this._openT = 0;
    SND.blip();
    if (!G.flags.seenPen) {
      G.flags.seenPen = true;
      Game.toast('Feed every day, pet for goodwill, collect in the morning.');
    }
  },

  close() { this.open = false; SND.click(); },

  // ---- board geometry: one source of truth for update AND draw -------------------
  _closeRect() { return { x: this.WX + this.WW - 46, y: this.WY + 6, w: 22, h: 18 }; },
  // +34, not +8: uiPage puts the punch holes at +11 and the red margin at +22.
  _tabRect(i) { return { x: this.WX + 34 + i * 54, y: this.WY + 40, w: 50, h: 14 }; },
  _rowRect(i) { return { x: this.WX + 34, y: this.WY + 62 + i * this.ROW_H, w: this.WW - 68, h: this.ROW_H - 2 }; },
  _collectRect(i) { const r = this._rowRect(i); return { x: r.x + r.w - 70, y: r.y + 3, w: 66, h: 12 }; },
  _feedRect(i) { const r = this._rowRect(i); return { x: r.x + r.w - 70, y: r.y + 17, w: 32, h: 12 }; },
  _petRect(i) { const r = this._rowRect(i); return { x: r.x + r.w - 36, y: r.y + 17, w: 32, h: 12 }; },
  _feedAllRect() { return { x: this.WX + 34, y: this.WY + this.WH - 24, w: 58, h: 14 }; },
  _collectAllRect() { return { x: this.WX + 96, y: this.WY + this.WH - 24, w: 74, h: 14 }; },
  _in(r, mx, my) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; },

  _tap() { if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} } },

  // The board's own update, driven from the borrowed Game.globalUpdate slot.
  updateBoard(dt) {
    if (!this.ensure()) return;
    const pens = this.penCount();
    if (!pens) { this.open = false; return; }
    this.pen = clamp(this.pen, 0, pens - 1);
    this.sel = clamp(this.sel, 0, this.PEN_CAP - 1);
    const berths = this.indicesIn(this.pen);

    if (Input.p('Escape')) { this.close(); return; }
    if (Input.p('ArrowUp')) { this.sel = (this.sel + this.PEN_CAP - 1) % this.PEN_CAP; SND.blip(); }
    if (Input.p('ArrowDown')) { this.sel = (this.sel + 1) % this.PEN_CAP; SND.blip(); }
    if (pens > 1) {
      if (Input.p('ArrowLeft')) { this.pen = (this.pen + pens - 1) % pens; this.sel = 0; SND.blip(); return; }
      if (Input.p('ArrowRight')) { this.pen = (this.pen + 1) % pens; this.sel = 0; SND.blip(); return; }
    }
    const selIdx = berths[this.sel];
    if (selIdx !== undefined) {
      if (Input.p('KeyF')) { this.feed(selIdx); return; }
      if (Input.p('KeyP')) { this.pet(selIdx); return; }
      if (Input.p('KeyC')) { this._collectOrShrug(selIdx); return; }
    }

    if (!Input.mouse.clicked) return;
    const mx = Input.mouse.x, my = Input.mouse.y;
    if (this._in(this._closeRect(), mx, my)) { this._tap(); this.close(); return; }
    for (let i = 0; i < pens; i++) {
      if (!this._in(this._tabRect(i), mx, my)) continue;
      if (i !== this.pen) { this.pen = i; this.sel = 0; SND.blip(); }
      this._tap();
      return;
    }
    if (this._in(this._feedAllRect(), mx, my)) { this._tap(); this.feedAll(this.pen); return; }
    if (this._in(this._collectAllRect(), mx, my)) { this._tap(); this.collectAll(this.pen); return; }
    // rows: buttons before the row band, and return after one hit so a single
    // click can never fire two actions
    for (let i = 0; i < this.PEN_CAP; i++) {
      const idx = berths[i];
      if (idx === undefined) continue;
      if (this._in(this._collectRect(i), mx, my)) { this.sel = i; this._tap(); this._collectOrShrug(idx); return; }
      if (this._in(this._feedRect(i), mx, my)) { this.sel = i; this._tap(); this.feed(idx); return; }
      if (this._in(this._petRect(i), mx, my)) { this.sel = i; this._tap(); this.pet(idx); return; }
      if (this._in(this._rowRect(i), mx, my)) { this.sel = i; SND.blip(); return; }
    }
    // a click on the dimmed world behind the panel backs out, like tapping away
    if (mx < this.WX || mx > this.WX + this.WW || my < this.WY || my > this.WY + this.WH) this.close();
  },

  _collectOrShrug(i) {
    if (this.collect(i)) return;
    SND.blip();
    Game.toast('Nothing to collect from that one yet.');
  },

  _status(a) {
    const sp = this.byKey(a.species);
    if (a.product) return `${sp.product.name} ready to collect`;
    if (!this.adult(a)) {
      const d = this.daysToGrow(a);
      return `growing — ${d} day${d === 1 ? '' : 's'} to go`;
    }
    if (this.listless(a)) return 'run down — a fed day gets it going again';
    if (a.fed) return `fed — ${sp.product.name} in the morning`;
    return 'hungry — fill the trough today';
  },

  drawBoard(c) {
    if (!this.ensure()) return;
    const X = this.WX, Y = this.WY, WWi = this.WW, HHi = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const pens = Math.max(1, this.penCount());
    const berths = this.indicesIn(this.pen);

    c.fillStyle = 'rgba(6,14,18,0.70)';
    c.fillRect(0, 0, W, H);
    c.save();
    uiPageOpen(c, clamp(this._openT, 0, 1), X + WWi / 2, Y + HHi / 2);
    uiPage(c, X, Y, WWi, HHi, 1);

    // ---- title bar -----------------------------------------------------------
    text(c, 'FISH PENS', X + 34, Y + 12, { size: 12, color: '#662907', shadow: false });
    text(c, 'four berths, and everything in them', X + 34, Y + 25,
      { size: 7, color: '#914007', shadow: false });
    const bl = `${berths.length}/${this.PEN_CAP} berths`;
    const blw = textWidth(c, bl, 7) + 16;
    inkBox(c, X + WWi - 54 - blw, Y + 6, blw, 16, '#e08a1a', '#c56906', PIX * 2);
    text(c, bl, X + WWi - 54 - blw / 2, Y + 10.5,
      { size: 7, color: '#662907', align: 'center', shadow: false });
    const cr = this._closeRect();
    inkClose(c, cr, this._in(cr, mx, my));

    // ---- pen tabs (a single pen still gets its chip, so nothing shifts) ------
    for (let i = 0; i < pens; i++) {
      const r = this._tabRect(i);
      const sel = i === this.pen;
      const hov = this._in(r, mx, my);
      inkBox(c, r.x, r.y, r.w, r.h,
        sel ? '#e08a1a' : (hov ? '#f8d089' : '#e3ab61'),
        sel ? '#c56906' : '#914007', sel ? PIX * 3 : PIX * 2);
      text(c, `PEN ${i + 1}`, r.x + r.w / 2, r.y + 3.5,
        { size: 6.5, color: sel ? '#6b4a10' : '#7a6244', align: 'center', shadow: false });
    }

    // ---- berths --------------------------------------------------------------
    for (let i = 0; i < this.PEN_CAP; i++) {
      const r = this._rowRect(i);
      const idx = berths[i];
      if (idx === undefined) { this._drawEmptyBerth(c, r); continue; }
      const a = this.get(idx);
      inkBox(c, r.x, r.y, r.w, r.h,
        this.sel === i ? '#e08a1a' : (this._in(r, mx, my) ? '#f8d089' : '#e3ab61'),
        this.sel === i ? '#c56906' : '#914007', this.sel === i ? PIX * 3 : PIX * 2);

      // portrait: a fixed frame per state, so the list does not flicker
      const art = `stock_${a.species}_${a.product ? 7 : (this.adult(a) ? 4 : 1)}`;
      inkBox(c, r.x + 2, r.y + 3, 26, 26, '#f8d089', '#914007', PIX);
      const pw = Math.min(24, this._fitW(art, 22));
      drawAC(c, art, r.x + 15, r.y + 16, pw, assetH(art, pw));

      const sp = this.byKey(a.species);
      text(c, a.name, r.x + 33, r.y + 3, { size: 7.5, color: '#30150a', shadow: false });
      text(c, `${sp.name}  •  ${this.adult(a) ? 'adult' : 'fry'}`,
        r.x + 39 + textWidth(c, a.name, 7.5), r.y + 4, { size: 6, color: '#914007', shadow: false });
      text(c, this._status(a), r.x + 33, r.y + 12,
        { size: 6, shadow: false, color: a.product ? '#3f7a4e' : (a.fed ? '#914007' : '#b2601c') });

      // happiness as five hearts — the relationship, at a glance
      for (let h = 0; h < 5; h++) {
        const need = (h + 1) / 5;
        const kind = a.happy >= need - 0.001 ? 'full' : (a.happy >= need - 0.1 ? 'half' : 'empty');
        drawHeart(c, r.x + 33 + h * 8, r.y + 21, kind);
      }
      text(c, a.petted ? 'petted today' : 'wants a scratch', r.x + 78, r.y + 21.5,
        { size: 6, shadow: false, color: a.petted ? '#8a9484' : '#c56906' });

      this._drawBtn(c, this._collectRect(i), a.product ? 'COLLECT' : 'NOTHING YET', !!a.product, mx, my, '#a0f2b4');
      this._drawBtn(c, this._feedRect(i), a.fed ? 'FED' : 'FEED', !a.fed, mx, my, '#bfe8f5');
      this._drawBtn(c, this._petRect(i), 'PET', !a.petted, mx, my, '#ffb0c8');
    }

    // ---- footer --------------------------------------------------------------
    let ready = 0, hungry = 0;
    for (const i of berths) { const a = this.get(i); if (a.product) ready++; if (!a.fed) hungry++; }
    this._drawBtn(c, this._feedAllRect(), 'FEED ALL', hungry > 0, mx, my, '#bfe8f5');
    this._drawBtn(c, this._collectAllRect(), 'COLLECT ALL', ready > 0, mx, my, '#a0f2b4');
    text(c, TouchUI.enabled ? 'tap a berth, then FEED / PET / COLLECT' : '[F] feed  [P] pet  [C] collect  [Esc] close',
      X + 180, Y + HHi - 21, { size: 6.5, color: '#914007', shadow: false });
    text(c, `$${G.money}`, X + WWi - 34, Y + HHi - 21, { size: 6.5, color: '#3f7a4e', align: 'right', shadow: false });
    c.restore();
  },

  _drawEmptyBerth(c, r) {
    c.strokeStyle = '#914007';
    c.lineWidth = PIX * 2;
    c.setLineDash([2.5, 2.5]);
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    c.setLineDash([]);
    c.lineWidth = 1;
    text(c, 'empty berth', r.x + 10, r.y + 8, { size: 7, color: '#914007', shadow: false });
    text(c, "buy fry at Sprout's Stall", r.x + 10, r.y + 17, { size: 6, color: '#914007', shadow: false });
  },

  _drawBtn(c, r, label, active, mx, my, col) {
    const hov = active && this._in(r, mx, my);
    inkBox(c, r.x, r.y, r.w, r.h,
      active ? (hov ? '#f0a52c' : '#e08a1a') : '#d69a4e',
      active ? '#662907' : 'rgba(150,132,102,0.6)', active ? PIX * 2.5 : PIX * 2);
    text(c, label, r.x + r.w / 2, r.y + 3, {
      size: 6.5, align: 'center', shadow: false,
      color: active ? '#30150a' : 'rgba(140,124,96,0.85)',
    });
  },

  // Game.drawCursor hides the arrow after 3 idle seconds and only special-cases
  // Shop, so this pointer-driven board draws its own.
  _cursor(c) {
    const m = Input.mouse;
    c.save();
    c.translate(Math.round(m.x), Math.round(m.y));
    c.fillStyle = '#101820';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
    c.fillStyle = '#f2f4f6';
    c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
    c.restore();
  },

  // ---- self-contained wiring ------------------------------------------------------
  // main.js hardcodes Shop and Bench by name, so a third-party modal has to
  // borrow the slots instead: globalUpdate for update, drawHUD for draw (the same
  // z-order as Shop), Game.go for dismissal, TouchUI.layout to hide the walk
  // buttons, drawCursor for a pointer that does not time out.
  install() {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;
    const self = this;

    const gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      self.update(dt);          // no-ops if the wiring layer already ticked us
      if (self.open && Game.fadeDir === 0 && !Game.helpOpen && !Shop.open && !Bench.open
          && !(typeof Craft !== 'undefined' && Craft.open)
          && !(typeof NPCs !== 'undefined' && NPCs.open)) self.updateBoard(dt);
    };

    const gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.drawBoard(c); return; }
      gHUD(c);
    };

    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };

    const gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (self.open && !TouchUI.enabled) { self._cursor(c); return; }
      gCursor(c);
    };

    const tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return self.open ? [] : tLayout(); };

    // The scene under a borrowed-slot modal keeps updating, so Otto would walk
    // (and re-trigger the pen spot) behind the board. Freeze it instead.
    if (typeof WorldScene !== 'undefined' && WorldScene.update) {
      const wu = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (self.open) return; wu(dt); };
    }
  },
};

// The wiring layer draws the pens in world space; keep the NPCs-style name too,
// so a call site that expects drawWorld() finds it.
Stock.drawWorld = Stock.draw;

// This file may be loaded before OR after js/main.js. Game/TouchUI only exist
// once main.js has run, so install now if they are here and on DOMContentLoaded
// (which fires after every classic script in the body) if they are not.
if (typeof Game !== 'undefined') Stock.install();
else document.addEventListener('DOMContentLoaded', () => Stock.install(), { once: true });
