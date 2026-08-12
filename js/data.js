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

// THE MAIN QUEST IS FINTAN'S, and it is the only quest that is not asked for by
// somebody else -- because he is the one who wrote to you.
//
// There used to be a sixteen-chapter STORY here: a list that advanced ITSELF the
// moment each condition came true, with nobody to talk to about it and no way to
// take it, refuse it, or hand it in. It ran in parallel with the errand board and
// the two never met -- one told you what had happened to you, the other let you
// do things for people. It is gone. Fintan's survey is the spine now, it lives in
// SIDE_QUESTS below with branch 'main', and you get every step of it the same way
// you get everything else out here: by going and talking to him.
//
// G.goal survives as a NUMBER and nothing more. Every gate in the game reads it
// (`goal >= 3` unlocks an errand, the kit gifts in js/integrate.js, the shop) and
// it is still the honest measure of how far in you are -- it is just how many
// steps of Fintan's survey you have handed in now, written by Side.handIn,
// instead of a chapter index the game advanced behind your back.

// ---- THE ERRAND BOARD -----------------------------------------------------------
//
// THE BOARD. Four branches, three neighbours, and every one of them has to be
// ASKED FOR: you walk up, they mention a job, you take it, you go and do it, and
// you come BACK to them and hand it over. That round trip is the whole point --
// it is what makes the three of them people who want things rather than three
// portraits that dispense a hint.
//
// A branch is a chain: step 2 is not offered until step 1 is handed in. They run
// in PARALLEL, so there is always more than one thing to be doing:
//
//   main   (Fintan) -- THE MAIN QUEST. His survey of the north pier, eight steps,
//                      and the one that moves G.goal and so gates everything else
//   garden (Sprout) -- planters, sowing, tending, harvesting
//   galley (Marlow) -- diving, cracking, and then cooking what you cracked
//   odd             -- unchained one-offs, so a branch run dry is never the end
//
// FIELDS
//   key      save id. Never reuse one; G.side is keyed by it.
//   from     NPC key -- 'farmer' (Sprout), 'angler' (Marlow), 'prof' (Fintan)
//   branch   'main' | 'garden' | 'galley' | 'odd'
//   step     position in the chain; 1 is offered first, n needs n-1 handed in
//   gate(g)  extra unlock on top of the chain (usually a main-quest step count)
//   deliver  { itemKey: n } -- counted across every stash, and SPENT on hand-in
//   done(g)  for errands that are not a delivery (place a thing, cook a thing)
//   prog(g)  { n, of } for the journal bar; deliver quests get one for free
//   ask      what they say when they offer it
//   thanks   what they say when you hand it in
//   cine     a Cine beat key played on hand-in (js/cutscene.js)
//   reward   { money, items:{}, seeds:{}, xp, perk, note }
//
// A note on the deliveries: they are deliberately things you MAKE, not things you
// buy. Every one can be met by playing, and most can only be met by playing --
// there is no SELL tab shortcut to a Clam Chowder.
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
    gate: (g) => g.goal >= 2,
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

  // ==== FINTAN — THE MAIN QUEST ===========================================
  // THE SURVEY OF THE NORTH PIER. He wrote you the letter, so he is the one with
  // something to finish, and this is it: eight steps that walk the whole game --
  // meet the bay, dive it, build a bench, sell a crate, twist rope and cut iron,
  // break stone, polish something worth keeping, and put it in his case.
  //
  // Handing one in is what moves G.goal, so this chain gates the errand board,
  // the kit gifts and the shop. Steps 1, 4 and 8 carry a Cine beat.
  {
    key: 'm_hello', from: 'prof', branch: 'main', step: 1,
    name: 'Say hello at the post',
    how: 'walk right with [D] and press [E] at the visitor post',
    brief: ['He is on the deck most mornings, pretending to be passing.'],
    ask: [
      'Fintan: "You came. Good. I half expected a letter back."',
      '"Then let us begin properly: I am doing a survey of this pier and I have',
      'been doing it alone for eleven years. Say you will help and I will stop',
      'saying so at parties."',
    ],
    thanks: [
      'Fintan: "Splendid. Consider yourself surveyed in."',
      'He hands over a small purse without any ceremony at all, which is his way',
      'of doing ceremony.',
    ],
    done: (g) => !!(g.friends && g.friends.prof && g.friends.prof.met),
    prog: (g) => ({ n: (g.friends && g.friends.prof && g.friends.prof.met) ? 1 : 0, of: 1 }),
    cine: 'arrive',
    reward: { money: 60, items: { driftwood: 2 }, xp: 6 },
  },
  {
    key: 'm_dive', from: 'prof', branch: 'main', step: 2,
    name: 'Five off the piling',
    how: '[E] at the piling to dive; hold to scrape the crust, release in the green to pry',
    brief: ['Three clam and two mussel, off the shallow bed.'],
    ask: [
      'Fintan: "First entry: what lives on the north piling. I cannot dive it --',
      'I am a whale, and it is a piling."',
      '"Three clam and two mussel. Scrape the crust off first; the shell comes',
      'away on timing, not on force."',
    ],
    thanks: [
      'He lays them out in a row and writes for some time.',
      'Fintan: "Healthy. Crowded, even. Almar would be unbearable about it."',
    ],
    deliver: { clam: 3, mussel: 2 },
    reward: { money: 90, items: { rope: 2 }, xp: 10 },
  },
  {
    key: 'm_bench', from: 'prof', branch: 'main', step: 3,
    name: 'A bench of your own',
    how: 'the anvil on the top rail opens crafting; build the Shell Workbench and place it on the deck',
    brief: ['Two driftwood and a stone. Everything else follows it.'],
    ask: [
      'Fintan: "Almar had a bench on that deck for forty years and the deck has',
      'been quieter than I like ever since."',
      '"Two driftwood, one stone. Build it, put it down where you can reach it',
      'from the ladder, and I shall stop mentioning it."',
    ],
    thanks: [
      'He runs a flipper along the top and finds it acceptable.',
      'Fintan: "Good. Timber, so you can build the next one without asking the',
      'sea nicely."',
    ],
    done: (g) => _hasTable(g, 'crack'),
    prog: (g) => ({ n: _hasTable(g, 'crack') ? 1 : 0, of: 1 }),
    reward: { money: 110, items: { driftwood: 4, rope: 2 }, xp: 14 },
  },
  {
    key: 'm_crate', from: 'prof', branch: 'main', step: 4,
    name: 'Send the first crate',
    how: '[E] at the house, open the laptop, SELL tab -- the drone pays on pickup',
    brief: ['A survey nobody funds is a hobby.'],
    ask: [
      'Fintan: "Now the vulgar part, which is the part that buys planks."',
      '"The laptop in your house reaches the market. List something, anything. A',
      'drone comes for the crate and leaves the money under a pebble, as is',
      'proper."',
    ],
    thanks: [
      'Fintan: "There. You are a going concern. I shall note the date."',
      'He does note the date. He notes it twice.',
    ],
    done: (g) => g.stats.sold >= 1,
    prog: (g) => ({ n: Math.min(1, g.stats.sold), of: 1 }),
    cine: 'crate',
    reward: { money: 150, items: { charcoal: 3 }, xp: 18 },
  },
  {
    key: 'm_cord', from: 'prof', branch: 'main', step: 5,
    name: 'Rope and rivets',
    how: 'kelp rope is one blade at the galley bench; iron comes off the seabed with a pick',
    brief: ['Four rope, two iron. The dull half of every good tool.'],
    ask: [
      'Fintan: "Nobody writes ballads about cordage, and yet."',
      '"Four rope -- twist it yourself from kelp, it is one blade a coil. And two',
      'iron. Salvage counts; I am not precious about provenance."',
    ],
    thanks: [
      'He coils the rope the proper way without appearing to think about it.',
      'Fintan: "Adequate. Which from me, as Marlow will tell you, is a great deal."',
    ],
    deliver: { rope: 4, iron: 2 },
    reward: { money: 190, xp: 22 },
  },
  {
    key: 'm_stone', from: 'prof', branch: 'main', step: 6,
    name: 'Strike the stone',
    how: '[E] a rock on the seabed to take it up, then time each swing to the bar',
    brief: ['Fifteen nodes. The bar is the whole skill.'],
    ask: [
      'Fintan: "The seabed here is a layer cake and I want to know what is in the',
      'middle of it."',
      '"Fifteen nodes, any kind. Take a rock up with [E] and swing ON the bar --',
      'the rock decides how fast, not you."',
    ],
    thanks: [
      'He spreads the samples out and goes quiet for a full minute.',
      'Fintan: "Iron under the sand shelf. Almar always said so and I told him he',
      'was guessing." A pause. "He was guessing. He was also right."',
    ],
    done: (g) => ((g.mining && g.mining.mined) || 0) >= 15,
    prog: (g) => ({ n: Math.min(15, (g.mining && g.mining.mined) || 0), of: 15 }),
    reward: { money: 240, items: { iron: 2, charcoal: 4 }, xp: 30 },
  },
  {
    key: 'm_case', from: 'prof', branch: 'main', step: 7,
    name: 'Something for the case',
    how: 'crack oysters for pearls, then polish pearl and abalone at the shell bench',
    brief: ['Two polished pearls and a polished abalone. Buffed, not raw.'],
    ask: [
      'Fintan: "There is a glass case in my study with a card in it that reads',
      'NORTH PIER, and nothing else. It has read that since Almar died."',
      '"Two pearls and an abalone, polished properly. I would like the card to',
      'have something to stand next to."',
    ],
    thanks: [
      'He sets them on the velvet, moves them a quarter inch, and stops.',
      'Fintan: "NORTH PIER. There. That is better than it has been."',
      'He does not say whose pier. He does not have to.',
    ],
    deliver: { pearlPol: 2, abalonePol: 1 },
    reward: { money: 420, items: { iron: 4, driftwood: 8 }, xp: 50 },
  },
  {
    key: 'm_survey', from: 'prof', branch: 'main', step: 8,
    name: 'The survey, finished',
    how: 'know all three neighbours, and have $2,500 put by',
    brief: ['A pier is the people on it. He wants both halves written down.'],
    ask: [
      'Fintan: "Last entry, and it is not a shell."',
      '"A pier is not timber, it is the people standing on it. Know all three of',
      'us properly. And have two and a half thousand put by -- I want the record',
      'to show the place PAYS, or the next otter will not come."',
    ],
    thanks: [
      'He closes the book, ties it, and puts it in your hands.',
      'Fintan: "Yours now. Eleven years of mine, and the last year the only one',
      'anybody enjoyed."',
      'The lamp is lit. Sprout has fallen asleep in the good chair. Marlow is',
      'pretending he did not come. Out past the planks the water goes on being',
      'exactly as generous as it ever was.',
    ],
    done: (g) => {
      const f = g.friends || {};
      return g.money >= 2500 && !!(f.farmer && f.farmer.met && f.prof && f.prof.met && f.angler && f.angler.met);
    },
    prog: (g) => {
      const f = g.friends || {};
      let n = 0;
      for (const k of ['farmer', 'prof', 'angler']) if (f[k] && f[k].met) n++;
      return { n: n + (g.money >= 2500 ? 1 : 0), of: 4 };
    },
    cine: 'survey',
    reward: { money: 900, xp: 80, note: 'The pier is yours, properly. It always was.' },
  },

  // ==== ODD JOBS — unchained, and always something left to do =============
  {
    key: 'o_posts', from: 'farmer', branch: 'odd', step: 1,
    name: 'Barnacles off the posts',
    gate: (g) => g.goal >= 1,
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
    gate: (g) => g.goal >= 3,
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
    gate: (g) => g.goal >= 4,
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
    gate: (g) => g.goal >= 5,
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
    gate: (g) => g.goal >= 6,
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

// The main chain, in step order, derived so there is one list and no second copy
// to fall out of sync. QUESTS and GOALS are the OLD names for the old chapter
// list; they point here now, because the tracker, the journal and the hint line
// all want "the thing you are working on for Fintan" and that is what this is.
const MAIN_QUESTS = SIDE_QUESTS.filter((q) => q.branch === 'main')
  .sort((a, b) => (a.step || 0) - (b.step || 0));
const QUESTS = MAIN_QUESTS;
const GOALS = MAIN_QUESTS;

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
