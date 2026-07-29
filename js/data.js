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

// Otto's plan: one clear goal at a time, from first scrape to the dream.
const GOALS = [
  { name: 'Scrape together 5 shells',    hint: 'Dive at the North Piling' },
  { name: 'Send a crate to market',      hint: 'Sell on the laptop; the drone pays on pickup' },
  { name: 'Crack a shell at the workbench', hint: 'Tap when the marker is centered' },
  { name: 'Buy the Mesh Bag',            hint: 'GEAR tab on the laptop' },
  { name: 'Rate the piling for the Mid Bed', hint: 'BUILD tab — oysters live further down' },
  { name: 'Find a pearl',                hint: 'Crack oysters — clean cracks find more' },
  { name: 'Polish something precious',   hint: 'Pearls & abalone gleam at the workbench' },
  { name: 'Reach the Deep Bed',          hint: 'BUILD tab — bring a headlamp' },
  { name: 'Survive the Gray One',        hint: "When the water goes quiet: DON'T MOVE" },
  { name: 'The dream: save $5,000',      hint: 'A manor, a trophy, and a full coin purse' },
];
const GOAL_DONE = [
  (g) => g.stats.scraped >= 5,
  (g) => g.stats.sold >= 1,
  (g) => g.stats.cracked >= 1,
  (g) => g.gear.bag >= 1,
  (g) => g.bridge >= 2,
  (g) => g.stats.pearls >= 1,
  (g) => g.stats.polished >= 1,
  (g) => g.bridge >= 3,
  (g) => g.stats.sharkSurvived >= 1,
  (g) => g.money >= 5000,
];

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
    musicOn: true,
  };
}

function isNight(clock) { return clock > 0.62 || clock < 0.06; }
