// ---- game data & balance -----------------------------------------------
'use strict';

const ITEMS = {
  clam:     { name: 'Clam',          price: 4,   color: '#d9b98a' },
  mussel:   { name: 'Blue Mussel',   price: 7,   color: '#4a5f9e' },
  barnacle: { name: 'Barnacle Bits', price: 2,   color: '#a8b0ac' },
  oyster:   { name: 'Oyster',        price: 14,  color: '#93a48c' },
  abalone:  { name: 'Abalone',       price: 30,  color: '#66c2a8' },
  pearl:    { name: 'Pearl',         price: 120, color: '#fffdf4' },
  roe:      { name: 'Urchin Roe',    price: 22,  color: '#eda93e' },
};
const ITEM_KEYS = Object.keys(ITEMS);

const SCRAPERS = [
  { name: 'Rusty Scraper',   dmg: 1, tick: 0.13,  price: 0,   desc: 'Old faithful. Slow but honest.' },
  { name: 'Steel Scraper',   dmg: 2, tick: 0.11,  price: 150, desc: 'Twice the bite. Shells tremble.' },
  { name: 'Electro-Scraper', dmg: 4, tick: 0.085, price: 600, desc: 'Buzzz. Crust practically jumps off.' },
];

const TANKS = [
  { name: 'Snorkel',     air: 40,  price: 0,   desc: 'Hold your breath, mostly.' },
  { name: 'Air Tank I',  air: 80,  price: 120, desc: 'A real tank. 80s of air.' },
  { name: 'Air Tank II', air: 140, price: 450, desc: 'Big boy. 140s of air.' },
];

const SUITS = [
  { name: 'Just Fur',        def: 0,   price: 0,   desc: 'Nature gave you this.' },
  { name: 'Wetsuit',         def: 0.5, price: 100, desc: 'Halves the ouch.' },
  { name: 'Armored Wetsuit', def: 1,   price: 400, desc: 'Kevlar for otters.' },
];

const BAGS = [
  { name: 'Small Pouch',  cap: 12, price: 0,   desc: 'Fits in one paw.' },
  { name: 'Mesh Bag',     cap: 26, price: 90,  desc: 'Carry 26 shells.' },
  { name: 'Big Net Sack', cap: 50, price: 280, desc: 'Carry 50 shells.' },
];

const GEAR_SINGLES = {
  lamp:   { name: 'Dive Headlamp',  price: 250, desc: 'The deep is dark. This helps.' },
  gloves: { name: 'Pry Gloves',     price: 220, desc: 'Harvest urchin roe safely.' },
};

const PILINGS = [
  { name: 'North Piling', depth: 520,  danger: 0 },
  { name: 'Mid Piling',   depth: 780,  danger: 1 },
  { name: 'Deep Piling',  depth: 1060, danger: 2 },
];

const BUILDS = {
  bridge2: { name: 'Bridge East — Mid Piling',  price: 400,
             desc: 'Richer beds: oysters! Barracudas patrol here.' },
  bridge3: { name: 'Bridge Far — Deep Piling',  price: 1200,
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

// what each scraped node drops
const NODE_DEFS = {
  clam:     { hp: 3, r: 8,  drop: 'clam' },
  mussel:   { hp: 4, r: 7,  drop: 'mussel' },
  barnacle: { hp: 2, r: 6,  drop: 'barnacle' },
  oyster:   { hp: 6, r: 9,  drop: 'oyster' },
  abalone:  { hp: 9, r: 10, drop: 'abalone' },
  urchin:   { hp: 8, r: 9,  drop: 'roe' }, // only harvestable with gloves
};

const SAVE_KEY = 'ottoClamFarm.v1';

function defaultState() {
  return {
    day: 1,
    money: 25,
    hearts: 3, maxHearts: 3,
    storage: { clam: 0, mussel: 0, barnacle: 0, oyster: 0, abalone: 0, pearl: 0, roe: 0 },
    gear: { scraper: 0, tank: 0, suit: 0, bag: 0, lamp: false, gloves: false },
    bridge: 1,      // pilings built (1..3)
    house: 1,       // house level (1..3)
    decor: {},      // id -> true
    growth: [1, 1, 1],
    seeds: [11, 22, 33],
    clock: 0.30,    // 0..1 day cycle; 0.30 = morning
    pendingCrate: null, // { value, t }
    stats: { scraped: 0, sharkSurvived: 0, deaths: 0, pearls: 0 },
    flags: {},      // tutorial flags
    musicOn: true,
  };
}

function isNight(clock) { return clock > 0.62 || clock < 0.06; }
