// ---- game data & balance -----------------------------------------------
'use strict';

const ITEMS = {
  // raw hauls (from diving)
  clam:       { name: 'Clam',            price: 7,   color: '#d9b98a' },
  mussel:     { name: 'Blue Mussel',     price: 11,  color: '#4a5f9e' },
  barnacle:   { name: 'Barnacle Bits',   price: 4,   color: '#a8b0ac' },
  oyster:     { name: 'Oyster',          price: 22,  color: '#93a48c' },
  abalone:    { name: 'Abalone',         price: 45,  color: '#66c2a8' },
  pearl:      { name: 'Pearl',           price: 150, color: '#fffdf4' },
  roe:        { name: 'Urchin Roe',      price: 30,  color: '#eda93e' },
  // processed at the workbench (cracked / polished)
  clamMeat:   { name: 'Clam Meat',       price: 14,  color: '#f2c9a0' },
  musselMeat: { name: 'Mussel Meat',     price: 20,  color: '#f2a06a' },
  oysterMeat: { name: 'Oyster Meat',     price: 40,  color: '#f2e2c9' },
  abalonePol: { name: 'Polished Abalone', price: 90, color: '#8ff0d8' },
  pearlPol:   { name: 'Lustrous Pearl',  price: 300, color: '#ffffff' },
};
const ITEM_KEYS = Object.keys(ITEMS);

const SCRAPERS = [
  { name: 'Rusty Scraper',   dmg: 1, tick: 0.13,  price: 0,   desc: 'Old faithful. Slow but honest.' },
  { name: 'Steel Scraper',   dmg: 2, tick: 0.11,  price: 150, desc: 'Twice the bite. Crust flies.' },
  { name: 'Electro-Scraper', dmg: 4, tick: 0.085, price: 600, desc: 'Buzzz. Crust practically jumps off.' },
];

const PRYBARS = [
  { name: 'Rusty Pry Bar',  bonus: 0,    speed: 1,    price: 0,   desc: 'Lever shells loose. Takes timing.' },
  { name: 'Steel Pry Bar',  bonus: 0.10, speed: 0.88, price: 180, desc: 'Wider sweet spot, steadier hand.' },
  { name: 'Hydraulic Pry',  bonus: 0.22, speed: 0.72, price: 700, desc: 'Shells barely stand a chance.' },
];

const TANKS = [
  { name: 'Snorkel',     air: 45,  price: 0,   desc: 'Hold your breath, mostly.' },
  { name: 'Air Tank I',  air: 90,  price: 120, desc: 'A real tank. 90s of air.' },
  { name: 'Air Tank II', air: 150, price: 450, desc: 'Big boy. 150s of air.' },
];

const SUITS = [
  { name: 'Just Fur',        def: 0,   price: 0,   desc: 'Nature gave you this.' },
  { name: 'Wetsuit',         def: 0.5, price: 100, desc: 'Halves the ouch.' },
  { name: 'Armored Wetsuit', def: 1,   price: 400, desc: 'Kevlar for otters.' },
];

const BAGS = [
  { name: 'Small Pouch',  cap: 8,  price: 0,   desc: 'Fits in one paw.' },
  { name: 'Mesh Bag',     cap: 16, price: 90,  desc: 'Carry 16 shells.' },
  { name: 'Big Net Sack', cap: 30, price: 280, desc: 'Carry 30 shells.' },
];

const GEAR_SINGLES = {
  lamp:   { name: 'Dive Headlamp',  price: 250, desc: 'The deep is dark. This helps.' },
  gloves: { name: 'Pry Gloves',     price: 220, desc: 'Pry urchins for roe safely.' },
};

const PILINGS = [
  { name: 'North Piling', depth: 520,  danger: 0 },
  { name: 'Mid Piling',   depth: 780,  danger: 1 },
  { name: 'Deep Piling',  depth: 1060, danger: 2 },
];

// G.bridge no longer lengthens the pier (world.js PIER_END is a constant now), so
// these are sold as what they actually buy: a piling rated for a deeper bed, and
// with it the far stations on the planks.
const BUILDS = {
  bridge2: { name: 'Piling Rated — Mid Bed',  price: 400,
             desc: 'Richer beds further down: oysters! Opens the far planks.' },
  bridge3: { name: 'Piling Rated — Deep Bed',  price: 1200,
             desc: 'Abalone & pearls. Something big lives down there.' },
  house2:  { name: 'House: Cozy Cabin',  price: 500,  desc: 'Warm walls, second window.' },
  house3:  { name: 'House: Sea Manor',   price: 1500, desc: 'The fanciest hut on the water.' },
};

const DECOR = [
  { id: 'rug',        name: 'Woven Kelp Rug',        price: 40,  desc: 'Ties the room together.' },
  { id: 'lamp',       name: 'Driftwood Lamp',        price: 60,  desc: 'Warm amber glow.' },
  { id: 'poster',     name: '"Hang In There" Poster',price: 35,  desc: 'A crab, hanging in there.' },
  { id: 'plant',      name: 'Sea Fern Pot',          price: 45,  desc: 'It thrives on neglect.' },
  { id: 'aquarium',   name: 'Tiny Aquarium',         price: 150, desc: 'Fish watching fish.' },
  { id: 'gramophone', name: 'Old Gramophone',        price: 120, desc: 'Toggle tunes at home.' },
  { id: 'trophy',     name: 'Golden Clam Trophy',    price: 200, desc: 'For services to shellfish.' },
  { id: 'lights',     name: 'String Lights',         price: 80,  desc: 'Outside. Cozy at night.' },
];

// Harvest nodes come in two stages: scrape the CRUST off, then PRY the shell
// loose with a timing minigame. Barnacles are scrape-only; urchins are
// pry-only (with gloves). Bigger, rarer, tougher than they used to be.
const NODE_DEFS = {
  clam:     { crust: 8,  r: 15, drop: 'clam',     pry: { speed: 4.2, win: 0.42 } },
  mussel:   { crust: 10, r: 14, drop: 'mussel',   pry: { speed: 4.8, win: 0.38 } },
  barnacle: { crust: 12, r: 12, drop: 'barnacle', pry: null },
  oyster:   { crust: 14, r: 17, drop: 'oyster',   pry: { speed: 5.4, win: 0.30 } },
  abalone:  { crust: 18, r: 18, drop: 'abalone',  pry: { speed: 6.2, win: 0.24 } },
  urchin:   { crust: 0,  r: 14, drop: 'roe',      pry: { speed: 5.0, win: 0.30 } },
};

// workbench recipes
const BENCH_CRACK = { clam: 'clamMeat', mussel: 'musselMeat', oyster: 'oysterMeat' };
const BENCH_POLISH = { abalone: 'abalonePol', pearl: 'pearlPol' };

// THE STORY, one chapter at a time. This used to be a bare list of goal strings;
// it is the questline now -- each entry carries who it comes from, a few quiet
// lines for the journal, and a small thank-you at the end. The old GOALS /
// GOAL_DONE pair is derived from it below, so the banner, the help line and the
// advance hook in main.js keep working, and an old save's G.goal index still
// points at a sensible chapter.
//
// The writing rule for every line in here: say it the way a neighbour would.
// Nothing shouts, nothing explains twice, and nobody is excited on your behalf.
const QUESTS = [
  {
    key: 'hello', from: 'prof',
    name: 'Say hello at the post',
    hint: 'Someone is waiting on the deck',
    brief: [
      'The letter said the neighbours were good folk.',
      'One of them is already standing at the visitor post,',
      'pretending he only happened to be passing.',
    ],
    done: (g) => !!(g.friends && g.friends.prof && g.friends.prof.met),
    reward: { money: 20, note: 'Fintan slips you a little starting money.' },
  },
  {
    key: 'shells', from: 'prof',
    name: 'Five shells for the pantry',
    hint: 'Dive at the piling and scrape',
    brief: [
      'Start the way everyone here started:',
      'dive at the piling, scrape five shells loose,',
      'and climb back up before your air runs thin.',
    ],
    done: (g) => g.stats.scraped >= 5,
    prog: (g) => ({ n: Math.min(5, g.stats.scraped), of: 5 }),
    reward: { money: 40 },
  },
  {
    key: 'crate', from: 'prof',
    name: 'Send the first crate',
    hint: 'Sell on the house laptop; the drone pays on pickup',
    brief: [
      'The laptop in the house reaches the market.',
      'List what you scraped. A drone comes for the crate',
      'and leaves the money under a pebble, as is proper.',
    ],
    done: (g) => g.stats.sold >= 1,
    reward: { money: 60 },
  },
  {
    key: 'knife', from: 'angler',
    name: 'The knack of the knife',
    hint: 'Crack a shell at the workbench, tap on the centre',
    brief: [
      'Marlow says a shell opens for timing, not force.',
      'Crack one at the workbench. Wait for the middle.',
      'You will know the sound when you hear it.',
    ],
    done: (g) => g.stats.cracked >= 1,
    reward: { money: 40 },
  },
  {
    key: 'bag', from: 'sprout',
    name: 'A bag that fits',
    hint: 'Workbench: rope and driftwood',
    brief: [
      'Pockets only go so far.',
      'Twist some rope, save some driftwood,',
      'and make yourself a proper mesh bag.',
    ],
    done: (g) => g.gear.bag >= 1,
    reward: { money: 50 },
  },
  {
    key: 'neighbours', from: 'sprout',
    name: 'Meet the neighbours',
    hint: 'All three of them, wherever you find them',
    brief: [
      'Three of them live out on the water.',
      'Sprout grows things, Fintan measures things,',
      'and Marlow catches things. Say hello properly.',
    ],
    done: (g) => {
      const f = g.friends || {};
      return !!(f.farmer && f.farmer.met && f.prof && f.prof.met && f.angler && f.angler.met);
    },
    prog: (g) => {
      const f = g.friends || {};
      let n = 0;
      for (const k of ['farmer', 'prof', 'angler']) if (f[k] && f[k].met) n++;
      return { n, of: 3 };
    },
    reward: { money: 40, note: 'It is a small bay. Now everyone knows your name.' },
  },
  {
    key: 'planted', from: 'sprout',
    name: 'Something planted',
    hint: 'Set the planter on the sand, then a packet in it',
    brief: [
      'Sprout left you a planter and will not stop',
      'mentioning it. Set it down on the seabed by the',
      'pier, buy a packet, and give the sand a job.',
    ],
    done: (g) => !!(g.qflags && g.qflags.planted),
    reward: { money: 60 },
  },
  {
    key: 'midbed', from: 'prof',
    name: 'Room to grow',
    hint: 'BUILD tab: rate the piling for the mid bed',
    brief: [
      'The shallows are honest work, but the oysters',
      'live a little further down. Rate the piling',
      'and the mid bed is yours to tend.',
    ],
    done: (g) => g.bridge >= 2,
    reward: { money: 80 },
  },
  {
    key: 'petted', from: 'sprout',
    name: 'A gentle touch',
    hint: 'Swim up slowly and press [T]',
    brief: [
      'The animals out there are curious about you.',
      'Move slowly, let one look you over,',
      'and pet it before it changes its mind.',
    ],
    done: (g) => !!(g.qflags && g.qflags.petted),
    reward: { money: 40 },
  },
  {
    key: 'mined', from: 'angler',
    name: 'Stone and spark',
    hint: 'Take up a rock with [E] and mind the timing bar',
    brief: [
      'The seabed keeps stone, coal and old iron.',
      'Take a rock up with [E] and swing on the beat.',
      'Five good chunks will do to start.',
    ],
    done: (g) => !!(g.mining && g.mining.mined >= 5),
    prog: (g) => ({ n: Math.min(5, (g.mining && g.mining.mined) || 0), of: 5 }),
    reward: { money: 60 },
  },
  {
    key: 'pearl', from: 'prof',
    name: 'A pearl of your own',
    hint: 'Crack oysters; clean cracks find more',
    brief: [
      'An irritation, wrapped in patience, until it shines.',
      'Fintan has a whole lecture about it.',
      'Find one and you will only get the short version.',
    ],
    done: (g) => g.stats.pearls >= 1,
    reward: { money: 100 },
  },
  {
    key: 'polish', from: 'prof',
    name: 'Polish and pride',
    hint: 'Pearls and abalone gleam at the workbench',
    brief: [
      'Anything worth keeping is worth the buffing wheel.',
      'Polish something precious and see what the',
      'market ledger makes of it.',
    ],
    done: (g) => g.stats.polished >= 1,
    reward: { money: 80 },
  },
  {
    key: 'deepbed', from: 'angler',
    name: 'The deep bed',
    hint: 'BUILD tab; bring a headlamp',
    brief: [
      'Below the mid bed the light gives up.',
      'Marlow fishes down there and says it is fine,',
      'which from Marlow is a glowing review.',
    ],
    done: (g) => g.bridge >= 3,
    reward: { money: 120 },
  },
  {
    key: 'still', from: 'angler',
    name: 'Hold steady',
    hint: 'When the water goes quiet, stop moving',
    brief: [
      'Sooner or later the gray one drifts past.',
      'Marlow has said it a dozen ways and means it:',
      'go still as a piling, and it goes on by.',
    ],
    done: (g) => g.stats.sharkSurvived >= 1,
    reward: { money: 150, note: 'Marlow nods at you differently now.' },
  },
  {
    key: 'close', from: 'sprout',
    name: 'A heart alongside',
    hint: 'Talk most days; gifts help; eight hearts',
    brief: [
      'The work fills the days, but not the evenings.',
      'Keep showing up for somebody -- little gifts,',
      'a chat most days -- and see what grows.',
    ],
    done: (g) => {
      const f = g.friends || {};
      for (const k in f) { if (f[k] && f[k].pts >= 200) return true; }
      return false;
    },
    reward: { note: 'The stall quietly starts stocking keepsakes.' },
  },
  {
    key: 'dream', from: 'letter',
    name: 'The dream: save $5,000',
    hint: 'A manor, a trophy, and a full coin purse',
    brief: [
      'The letter never said get rich.',
      'It said fix the place up and sleep well.',
      'Still. Five thousand would fix a lot of planks.',
    ],
    done: (g) => g.money >= 5000,
    prog: (g) => ({ n: Math.min(5000, g.money), of: 5000 }),
    reward: { note: 'The pier is yours, properly. It always was.' },
  },
];

// Derived views, kept because main.js (the banner, the advance hook, the help
// line) and anything else that predates the questline reads these names.
const GOALS = QUESTS;
const GOAL_DONE = QUESTS.map((q) => q.done);

const SAVE_KEY = 'ottoClamFarm.v1';

function defaultState() {
  return {
    day: 1,
    money: 25,
    hearts: 3, maxHearts: 3,
    storage: Object.fromEntries(ITEM_KEYS.map(k => [k, 0])),
    gear: { scraper: 0, pry: 0, tank: 0, suit: 0, bag: 0, lamp: false, gloves: false },
    bridge: 1,      // pilings built (1..3)
    house: 1,       // house level (1..3)
    decor: {},      // id -> true
    growth: [0.75, 0.7, 0.7],
    seeds: [11, 22, 33],
    clock: 0.30,    // 0..1 day cycle; 0.30 = morning
    pendingCrate: null, // { value, t }
    stats: { scraped: 0, sharkSurvived: 0, deaths: 0, pearls: 0, cracked: 0, polished: 0, sold: 0 },
    goal: 0,
    flags: {},      // tutorial flags
    qflags: {},     // quest progress flags (planted, petted, ...) -- see js/quest.js
    partner: null,  // NPC key once a pearl band is accepted -- see js/npc.js gift()
    musicOn: true,
  };
}

function isNight(clock) { return clock > 0.62 || clock < 0.06; }
