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
    how: 'walk right with [D], press [E] at the visitor post',
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
    how: '[E] at the piling to dive; hold to scrape, release in the green to pry',
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
    how: '[E] at the house, open the laptop, SELL tab',
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
    how: '[C] opens crafting: make a Shell Workbench, place it, then [E] it',
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
    how: 'hand-craft a Crude Workbench ([C]), place it, craft the Mesh Bag there',
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
    how: 'swim out ([E] at pier edge) -- their houses are east; [E] to talk',
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
    how: '[E] on the sand by the pier to set the planter, [E] again to till and plant',
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
    how: 'laptop, BEDS tab',
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
    how: 'swim close and slow, [E] starts the petting game, [E] again in the heart',
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
    how: '[E] a rock to take it up, then time your swings to the bar',
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
    how: 'crack oysters at the shell bench -- clean timing finds more',
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
    how: 'the polish tab at the shell bench: pearls and abalone',
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
    how: 'laptop, BEDS tab -- craft a headlamp first',
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
    how: 'when the water goes quiet, release every key and wait',
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
    how: 'talk daily, gift often ([E] them, then GIFT)',
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
    how: 'sell, grow, polish -- the ledger does the rest',
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

// ---- THE ERRAND BOARD -----------------------------------------------------------
//
// QUESTS above is the STORY: one chapter at a time, in order, and it advances by
// itself the moment its condition comes true. That is the spine. It is not,
// however, a game -- it never asks you for anything, it never pays you in
// anything but coin, and every line of it comes from whoever the writer felt
// like naming.
//
// This is the other half. An ERRAND has to be ASKED FOR: you walk up to a
// neighbour, they mention a job, you take it, you go and do it, and you come
// BACK to them and hand it over. That round trip is the whole point -- it is
// what makes the three of them feel like people who want things rather than
// three portraits that dispense a hint.
//
// Each neighbour owns a BRANCH, and a branch is a chain: step 2 is not offered
// until step 1 is handed in. The three branches teach three different halves of
// the game and they run in PARALLEL, so there is always more than one thing to
// be doing:
//
//   garden (Sprout)  -- planters, sowing, tending, harvesting
//   galley (Marlow)  -- diving, cracking, and then cooking what you cracked
//   works  (Fintan)  -- driftwood, rope, the bench, the pick, the polished thing
//
// ODD JOBS are the fourth kind: unchained one-offs, any of the three may hold
// one, and they exist so a branch you have run dry is never the end of the list.
//
// FIELDS
//   key      save id. Never reuse one; G.side is keyed by it.
//   from     NPC key -- 'farmer' (Sprout), 'angler' (Marlow), 'prof' (Fintan)
//   branch   'garden' | 'galley' | 'works' | 'odd'
//   step     position in the chain; 1 is offered first, n needs n-1 handed in
//   gate(g)  extra unlock on top of the chain (usually a story chapter)
//   deliver  { itemKey: n } -- counted across every stash, and SPENT on hand-in
//   done(g)  for errands that are not a delivery (place a thing, cook a thing)
//   prog(g)  { n, of } for the journal bar; deliver quests get one for free
//   ask      what they say when they offer it
//   thanks   what they say when you hand it in
//   reward   { money, items:{}, seeds:{}, xp, perk, note }
//
// A note on the deliveries: they are deliberately things you make, not things
// you buy. Every one of them can be met by playing, and most of them can only be
// met by playing -- there is no SELL tab shortcut to a Clam Chowder.
const _hasTable = (g, k) => Array.isArray(g.placed) && g.placed.some((e) => e && e.key === k);
const _crops = (g) => (g.farm && g.farm.crops) || {};
const _sown = (g) => {
  const out = {};
  const pl = (g.farm && g.farm.plots) || [];
  const n = Math.min(pl.length, (g.farm && g.farm.placed) || 0);
  for (let i = 0; i < n; i++) if (pl[i] && pl[i].crop) out[pl[i].crop] = true;
  return out;
};

const SIDE_QUESTS = [
  // ==== SPROUT — THE GARDEN LINE ==========================================
  {
    key: 'g_frame', from: 'farmer', branch: 'garden', step: 1,
    name: 'Sand under a frame',
    gate: (g) => g.goal >= 3,
    how: 'buy a Sea Planter at the stall, swim down, [E] on the sand by the pier',
    brief: ['A planter is a box of good soil with legs.', 'Nothing grows on bare seabed. Ask anyone.'],
    ask: [
      'Sprout: "Right. The sand by your pier is doing nothing at all,',
      'and that is a waste of perfectly good sand."',
      '"Get a planter off the stall and set it down out there. One is',
      'enough to start. I will know when you have -- I always know."',
    ],
    thanks: [
      'Sprout: "There it is. Legs in the sand, soil in the box."',
      '"Take these. Kelp is forgiving and it grows in three days,',
      'which makes it the right thing to be wrong with first."',
    ],
    done: (g) => ((g.farm && g.farm.placed) || 0) >= 1,
    prog: (g) => ({ n: Math.min(1, (g.farm && g.farm.placed) || 0), of: 1 }),
    reward: { money: 45, seeds: { kelp: 3 }, xp: 8 },
  },
  {
    key: 'g_blades', from: 'farmer', branch: 'garden', step: 2,
    name: 'Ten blades of kelp',
    how: 'sow the planter ([E]), fan the current on it daily, harvest when it is ready',
    brief: ['Sow, fan, wait, cut. Four verbs and a farm.'],
    ask: [
      'Sprout: "Now the boring part, which is the actual part."',
      '"Sow it. Fan a current over it every day or it silts up and sulks.',
      'Three days later you cut it. Bring me ten blades and I will believe',
      'you did it on purpose."',
    ],
    thanks: [
      'Sprout counts them twice, because she is like that.',
      '"Ten. And not one of them yellow. Here -- ground barnacle.',
      'Work it in and the next lot comes up faster."',
    ],
    deliver: { blade: 10 },
    reward: { money: 95, items: { fertiliser: 2 }, xp: 14 },
  },
  {
    key: 'g_row', from: 'farmer', branch: 'garden', step: 3,
    name: 'Three planters, two crops',
    how: 'set three planters on the sand and keep at least two different crops growing',
    brief: ['One crop is a hobby. Two is a garden.'],
    ask: [
      'Sprout: "One planter is a window box. I want a ROW."',
      '"Three of them down, and do not put kelp in all three -- a garden',
      'that grows one thing is just a big kelp."',
    ],
    thanks: [
      'Sprout walks the row twice, hands behind her back, saying nothing.',
      '"Yes," she decides. "Have a fourth planter. You have earned the',
      'right to make it messier."',
    ],
    done: (g) => ((g.farm && g.farm.placed) || 0) >= 3 && Object.keys(_sown(g)).length >= 2,
    prog: (g) => ({ n: Math.min(3, (g.farm && g.farm.placed) || 0) + Math.min(2, Object.keys(_sown(g)).length), of: 5 }),
    reward: { money: 170, items: { planter: 1 }, seeds: { ruby: 2 }, xp: 22 },
  },
  {
    key: 'g_basket', from: 'farmer', branch: 'garden', step: 4,
    name: 'A basket for the market',
    how: 'grow and bring: 4 Tide Berry, 4 Sea Curl, 2 Reef Gourd',
    brief: ['The stall wants a spread, not a pile.'],
    ask: [
      'Sprout: "There is a market boat on Thursdays and it is embarrassing',
      'what we send it."',
      '"Berries, curl and gourd. Four, four and two. Grow them, do not buy',
      'them -- I can tell, and so can the boat."',
    ],
    thanks: [
      'Sprout packs the basket herself, tucking the curl round the edges.',
      '"That is a proper basket. Right -- from now on the seed packets go',
      'to you at what I pay for them. Do not tell Marlow."',
    ],
    deliver: { berry: 4, curl: 4, gourd: 2 },
    reward: { money: 400, xp: 40, perk: 'seedDeal', note: 'Seed packets cost you a quarter less, for good.' },
  },

  // ==== MARLOW — THE GALLEY LINE ==========================================
  {
    key: 'k_twelve', from: 'angler', branch: 'galley', step: 1,
    name: 'Twelve for the pot',
    gate: (g) => g.goal >= 2,
    how: '[E] at the piling to dive; hold to scrape, release in the green to pry',
    brief: ['Eight clams and four mussels. Shells, not meat -- not yet.'],
    ask: [
      'Marlow: "You want to be useful? Be useful at the piling."',
      '"Eight clam, four mussel. In the shell. I do not want your idea of',
      'shelling, I want mine."',
    ],
    thanks: [
      'Marlow looks in the sack without picking anything up.',
      '"Aye. Take the charcoal -- you will want it before I do."',
    ],
    deliver: { clam: 8, mussel: 4 },
    reward: { money: 80, items: { charcoal: 3 }, xp: 10 },
  },
  {
    key: 'k_meat', from: 'angler', branch: 'galley', step: 2,
    name: 'Meat, not shell',
    how: 'crafting rail: build a Shell Workbench, put it down, [E] it, crack on the beat',
    brief: ['A shell is worth a shell. What is inside is worth double.'],
    ask: [
      'Marlow: "A shell sells for the price of a shell. Now open them."',
      '"Shell bench. Two driftwood and a stone, you can build it by hand.',
      'Six clam meat. Mind the timing -- force it and you get grit."',
    ],
    thanks: [
      'Marlow: "Clean cracks. You listened, which is rare."',
      '"Barrel water. You will need it the minute you touch a pot."',
    ],
    deliver: { clamMeat: 6 },
    reward: { money: 120, items: { water: 3 }, xp: 16 },
  },
  {
    key: 'k_hot', from: 'angler', branch: 'galley', step: 3,
    name: 'Something hot',
    how: 'build a Galley Bench (3 driftwood, 1 rope), place it, [E] it, COOK tab',
    brief: ['Kelp Tea is one blade and one water. Start there.'],
    ask: [
      'Marlow: "You have been eating raw shellfish over a bucket. I have',
      'watched you do it. Stop."',
      '"Galley bench. Three driftwood and a rope. Cook ONE thing. Tea',
      'counts -- a blade of kelp and a cup of water, and it mends you."',
    ],
    thanks: [
      'Marlow: "Hot food. Look at you."',
      '"Here is the makings of another. A man who can cook once can cook',
      'twice, and a man who can cook twice does not drown hungry."',
    ],
    done: (g) => ((g.flags && g.flags.cooked) || 0) >= 1 && _hasTable(g, 'cook'),
    prog: (g) => ({ n: (_hasTable(g, 'cook') ? 1 : 0) + Math.min(1, (g.flags && g.flags.cooked) || 0), of: 2 }),
    reward: { money: 100, items: { blade: 2, water: 2, charcoal: 2 }, xp: 18 },
  },
  {
    key: 'k_supper', from: 'angler', branch: 'galley', step: 4,
    name: 'Supper for the bay',
    how: 'chowder: 2 clam meat + 1 reef gourd. tea: 1 kelp blade + 1 water. skewer: roe + blade + charcoal',
    brief: ['Three dishes, one table, everybody sitting down.'],
    ask: [
      'Marlow: "Once a year the four of us eat at the same table. This year',
      'it is your table, because you have the room and I have the excuse."',
      '"Chowder, tea and a skewer. One each. I will bring the chair."',
    ],
    thanks: [
      'They come at dusk and nobody hurries. Fintan talks through the',
      'chowder. Sprout falls asleep in the good chair.',
      'Marlow, washing up: "Same time next year, then." It is not a',
      'question, and you would not answer it differently.',
    ],
    deliver: { chowder: 1, tea: 1, skewer: 1 },
    reward: { money: 360, items: { custard: 1 }, xp: 45, note: 'The good chair is Sprout\'s now. That is settled.' },
  },

  // ==== FINTAN — THE WORKSHOP LINE ========================================
  {
    key: 'w_bench', from: 'prof', branch: 'works', step: 1,
    name: 'A bench of your own',
    gate: (g) => g.goal >= 2,
    how: 'the anvil on the top rail opens crafting; build the Shell Workbench and place it on the deck',
    brief: ['Two driftwood and a stone. Everything else follows it.'],
    ask: [
      'Fintan: "Almar had a bench on that deck for forty years and the',
      'deck has been quieter than I like ever since."',
      '"Two driftwood, one stone. Build it, put it down where you can',
      'reach it from the ladder. I shall stop mentioning it after that."',
    ],
    thanks: [
      'Fintan runs a flipper along the top and finds it acceptable.',
      '"Good. Timber, so you can build the next one without asking',
      'the sea nicely."',
    ],
    done: (g) => _hasTable(g, 'crack'),
    prog: (g) => ({ n: _hasTable(g, 'crack') ? 1 : 0, of: 1 }),
    reward: { money: 70, items: { driftwood: 4, rope: 2 }, xp: 12 },
  },
  {
    key: 'w_cord', from: 'prof', branch: 'works', step: 2,
    name: 'Rope and rivets',
    how: 'kelp rope is one blade at the galley bench; iron comes off the seabed with a pick',
    brief: ['Four rope, two iron. The dull half of every good tool.'],
    ask: [
      'Fintan: "Nobody writes ballads about cordage, and yet."',
      '"Four rope -- twist it yourself from kelp, it is one blade a coil.',
      'And two iron. Salvage counts; I am not precious about provenance."',
    ],
    thanks: [
      'Fintan coils the rope the proper way without appearing to think.',
      '"Adequate. Which from me, as Marlow will tell you, is a great deal."',
    ],
    deliver: { rope: 4, iron: 2 },
    reward: { money: 150, xp: 20 },
  },
  {
    key: 'w_stone', from: 'prof', branch: 'works', step: 3,
    name: 'Strike the stone',
    how: '[E] a rock on the seabed to take it up, then time each swing to the bar',
    brief: ['Fifteen nodes. The bar is the whole skill.'],
    ask: [
      'Fintan: "The seabed here is a layer cake and I want to know what is',
      'in the middle of it."',
      '"Fifteen nodes, any kind. Take a rock up with [E] and swing ON the',
      'bar -- the rock decides how fast, not you."',
    ],
    thanks: [
      'Fintan spreads the samples out and goes quiet for a full minute.',
      '"Iron under the sand shelf. Almar always said so and I told him he',
      'was guessing." A pause. "He was guessing. He was also right."',
    ],
    done: (g) => ((g.mining && g.mining.mined) || 0) >= 15,
    prog: (g) => ({ n: Math.min(15, (g.mining && g.mining.mined) || 0), of: 15 }),
    reward: { money: 190, items: { iron: 2, charcoal: 4 }, xp: 28 },
  },
  {
    key: 'w_case', from: 'prof', branch: 'works', step: 4,
    name: 'Something for the case',
    how: 'crack oysters for pearls, then polish pearl and abalone at the shell bench',
    brief: ['Two polished pearls and a polished abalone. Buffed, not raw.'],
    ask: [
      'Fintan: "There is a glass case in my study with a card in it that',
      'says NORTH PIER, and nothing else. It has said that since Almar died."',
      '"Two pearls and an abalone, polished properly. I would like the card',
      'to have something to stand next to."',
    ],
    thanks: [
      'He sets them on the velvet, moves them a quarter inch, and stops.',
      'Fintan: "NORTH PIER. There. That is better than it has been."',
      'He does not say whose pier. He does not have to.',
    ],
    deliver: { pearlPol: 2, abalonePol: 1 },
    reward: { money: 450, items: { iron: 4, driftwood: 8 }, xp: 55, note: 'The card in the case has company now.' },
  },

  // ==== ODD JOBS — unchained, and always something left to do =============
  {
    key: 'o_posts', from: 'farmer', branch: 'odd', step: 1,
    name: 'Barnacles off the posts',
    gate: (g) => g.goal >= 2,
    how: 'barnacles scrape off the piling like anything else down there',
    brief: ['Six barnacles. They grow back. They always grow back.'],
    ask: [
      'Sprout: "Your pilings have a beard. Six barnacles off them and I',
      'will grind the lot into feed."',
    ],
    thanks: ['Sprout: "Cleaner already. It will be back by Thursday."'],
    deliver: { barnacle: 6 },
    reward: { money: 55, items: { fertiliser: 1 }, xp: 8 },
  },
  {
    key: 'o_pot', from: 'angler', branch: 'odd', step: 1,
    name: 'A pot to replace a pot',
    gate: (g) => g.goal >= 4,
    how: 'crab pot: 3 driftwood and 2 rope at the galley bench',
    brief: ['Three driftwood, two rope. He lost his on the rocks.'],
    ask: [
      'Marlow: "Lost a pot on the rocks. My own fault, which is why I am',
      'asking instead of complaining."',
      '"Three driftwood, two rope. You can make it standing up."',
    ],
    thanks: ['Marlow ties it to the rail without a word and pays you what the chandler would.'],
    deliver: { crabpot: 1 },
    reward: { money: 90, xp: 10 },
  },
  {
    key: 'o_tea', from: 'prof', branch: 'odd', step: 1,
    name: 'One cup, no sugar',
    gate: (g) => g.goal >= 5,
    how: 'kelp tea: 1 kelp blade + 1 fresh water, COOK tab at the galley bench',
    brief: ['He has asked for it four times now, quite politely.'],
    ask: [
      'Fintan: "I am not going to pretend this is research. I would simply',
      'like a cup of kelp tea and I have run out of kelp."',
    ],
    thanks: [
      'He drinks it looking out at the water and does not lecture once.',
      'Fintan: "Thank you. That was the whole of it, and it was plenty."',
    ],
    deliver: { tea: 1 },
    reward: { money: 110, xp: 12 },
  },
  {
    key: 'o_friend', from: 'farmer', branch: 'odd', step: 1,
    name: 'Make three friends',
    gate: (g) => g.goal >= 8,
    how: 'swim close and slow, [E] to start the petting game, [E] again inside the heart',
    brief: ['Pet three of them. Slowly. They can tell when you are in a hurry.'],
    ask: [
      'Sprout: "The little ones out there know your shape by now. Go and',
      'be known back. Three of them, properly -- slow up first."',
    ],
    thanks: [
      'Sprout: "There. Now when you are out there past dark, something',
      'out there is glad it is you."',
    ],
    done: (g) => ((g.stats && g.stats.petted) || 0) >= 3,
    prog: (g) => ({ n: Math.min(3, (g.stats && g.stats.petted) || 0), of: 3 }),
    reward: { money: 130, xp: 20 },
  },
  {
    key: 'o_lamp', from: 'angler', branch: 'odd', step: 1,
    name: 'Dark water',
    gate: (g) => g.goal >= 10,
    how: 'the dive lamp is a gear recipe; iron and charcoal make the housing',
    brief: ['He will not go down to the deep bed with you until you own a light.'],
    ask: [
      'Marlow: "You are not coming down to the deep bed on my say-so with',
      'no lamp. Get one. Then we will talk about the deep bed."',
    ],
    thanks: ['Marlow: "Right. Now I can stop watching you like a gull."'],
    done: (g) => !!(g.gear && g.gear.lamp),
    prog: (g) => ({ n: (g.gear && g.gear.lamp) ? 1 : 0, of: 1 }),
    reward: { money: 160, items: { charcoal: 4 }, xp: 22 },
  },
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
    stats: { scraped: 0, sharkSurvived: 0, deaths: 0, pearls: 0, cracked: 0, polished: 0, sold: 0, petted: 0 },
    goal: 0,
    flags: {},      // tutorial flags
    qflags: {},     // quest progress flags (planted, petted, ...) -- see js/quest.js
    side: {},       // errand key -> 1 taken, 2 handed in -- see js/side.js
    perks: {},      // permanent unlocks earned by finishing a branch (seedDeal, ...)
    partner: null,  // NPC key once a pearl band is accepted -- see js/npc.js gift()
    musicOn: true,
  };
}

function isNight(clock) { return clock > 0.62 || clock < 0.06; }
