// ---- dock folk: three neighbours, their moods, and their hearts --------------
'use strict';

// Friendship is stored as POINTS, not hearts, so a gift can move you a fraction
// of a heart. 25 points per heart, ten hearts, so 250 is the ceiling.
const NPC_HEART_PTS = 25;
const NPC_MAX_HEARTS = 10;
const NPC_MAX_PTS = NPC_HEART_PTS * NPC_MAX_HEARTS;

// Gift value by taste tier. 'adore' exists for exactly one thing in the world:
// the professor and a proper cup of tea.
const NPC_GIFT_PTS = { adore: 80, loved: 50, liked: 25, neutral: 8, disliked: -15 };

// First talk of the day is the cheap, reliable way to build a friendship.
const NPC_TALK_PTS = 12;

// Display names for item keys that are not in ITEMS (tea, crops, livestock
// produce). Anything missing falls back to a prettified key, so another module
// can invent a gift key without editing this file.
const NPC_ITEM_NAMES = {
  tea: 'Tea',
  crop_gourd_p: 'Sea Gourd', crop_curl_p: 'Kelp Curl', crop_berry_p: 'Reef Berry',
  crop_blade_p: 'Sea Blade', crop_moon_p: 'Moon Bloom',
  crop_gourd_seed: 'Gourd Seeds', crop_curl_seed: 'Curl Seeds',
  crop_berry_seed: 'Berry Seeds', crop_blade_seed: 'Blade Seeds',
  crop_moon_seed: 'Moon Seeds',
  stock_puffer_p: 'Puffer Milk', stock_sunfish_p: 'Sunfish Roe',
  stock_hogfish_p: 'Hogfish Cut',
  pearlband: 'Pearl Band',
  planter: 'Sea Planter',
};

const NPCs = {
  // ---- modal state (NPCs.open is the flag, exactly like Shop.open) ------------
  open: false,
  who: null,           // LIST key of the character being spoken to
  mode: 'talk',        // talk | gift
  pages: [['']],       // array of pages; each page is an array of wrapped lines
  page: 0,
  shown: 0,            // characters revealed on the current page (float)
  animT: 0,
  gpage: 0,            // gift grid page
  gain: null, gainT: 0,   // floating "+12" beside the heart row
  _blipT: 0,
  _installed: false,

  SPEED: 52,           // typewriter characters per second
  COLS: 68,            // wrap width in characters (Courier is monospace: 0.6em)
  MAXL: 4,             // lines per page

  // FRAMES. Each cast sheet is 4x4. Row 0 (0-3) is the idle; ROW 1 (4-7) IS A
  // WALK CYCLE -- legs mid-stride, body leaning into it -- and it had never been
  // drawn once, in any scene, because no frame map named it. The visitor walks a
  // round of the deck now, so it finally has somewhere to go.
  //
  // ---- the cast ---------------------------------------------------------------
  // x = spot on the deck. The dock is crowded: the house sits at 34..120, the
  // laptop at 232, the workbench at 300, lamp posts at 348 + 264n, and dive
  // spots at PILING_X. These three x's are the gaps left over.
  //
  // h = drawn height in logical units, and it is measured AGAINST OTTO, who is
  // 30. The old numbers had Fintan -- a whale, a professor, the biggest thing
  // that ever visits this pier -- at 42, barely a head taller than the otter,
  // and Sprout at 31, which read as the same person in a different hat. A
  // dolphin should look down at you (48), and a whale should fill the frame
  // (56). Nothing else in the layout depends on h; the sprite grows from the
  // deck line, so raising it just makes them stand taller in the same spot.
  LIST: [
    {
      key: 'farmer', name: 'Sprout', full: 'Sprout', role: 'dolphin farmhand',
      // dfarm, NOT farmer. The 'farmer' sheet is the SEAL; Sprout is the pink
      // dolphin with the basket of greens. Hood already drew her from dfarm out at
      // sea, so the dock was the only place still showing the wrong species -- and
      // the dialogue portrait is exactly where you notice. Both sheets are 4x4, so
      // the frame map below carries over unchanged.
      art: 'dfarm', x: 128, h: 42, flip: false,
      frames: { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], talk: [9, 8], emote: [12, 9, 13], happy: [12, 13], sad: [14, 15] },
      adore: [],
      loved: ['crop_berry_p', 'crop_gourd_p', 'crop_moon_p', 'crop_curl_p', 'crop_blade_p'],
      liked: ['clam', 'mussel', 'clamMeat', 'musselMeat', 'tea'],
      disliked: ['barnacle', 'roe'],
      lines: {
        first: [
          "Oh -- hello. I'm Sprout. I do the growing around here. Kelp, gourds, moon blooms... anything that holds still long enough.",
          'Give me a seed and a wet patch of sand and I can usually make dinner out of it. Come find me when you want to plant something.',
        ],
        low: [
          'Seeds first, water second, patience third. That really is the whole job.',
          'Everything out here grows in saltwater. Lucky, since saltwater is all we have.',
          'Moon blooms only open at night. I stayed up to watch once. Worth being sleepy for.',
        ],
        mid: [
          'Your shell beds and my seed beds are the same beds, really. Mine just do not pinch.',
          'I planted a barnacle once, to see. Something happened. Not growing, exactly. Something.',
          'The professor says I am unscientific. My gourds say otherwise. We have agreed to both be right.',
        ],
        high: [
          'I have worked a few docks. This one is my favourite. I do not really mean the dock.',
          'I saved you the biggest berry. It has been in my pocket a while. It is... mostly fine.',
          'Some evening, when the crates are stacked and the light goes low, remind me to just sit here a minute with you.',
        ],
        again: [
          'I told you everything already. Twice would just be showing off.',
          'Go plant something. Or dive. Either is good.',
          'Still me. Still glad you stopped by.',
        ],
        partner: [
          'There you are. The kelp missed you. Fine -- I missed you.',
          'I made two cups of tea out of habit. It is a good habit. Come sit.',
          'I was going to say something about the weather, but really I was just watching for you.',
        ],
      },
      react: {
        adore: 'Oh -- that is my favourite. You remembered.',
        loved: '%s! That is the good stuff and you know it. Thank you.',
        liked: '%s? Yes please. I will put it somewhere safe and forget where.',
        neutral: '%s. Thank you. I keep everything, so it will be in good company.',
        disliked: 'Oh. %s. It is... very grey. Thank you, though. Truly.',
      },
      romance: true,
    },
    {
      key: 'prof', name: 'Fintan', full: 'Prof. Fintan Bellwether', role: 'whale scholar',
      art: 'prof', x: 378, h: 46, flip: false,
      frames: { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], talk: [9, 8], emote: [11, 10, 12], happy: [12, 13], sad: [14, 15] },
      adore: ['tea', 'teaLeaf', 'crop_tea_p'],
      loved: ['pearl', 'pearlPol', 'abalonePol'],
      liked: ['oyster', 'oysterMeat', 'abalone', 'crop_moon_p'],
      disliked: ['barnacle', 'roe'],
      lines: {
        first: [
          'Ah. You must be Otto. Professor Fintan Bellwether: cetacean, scholar, and, when the kettle allows, a tea drinker.',
          'I have been charting these beds for forty years. Ask me anything and I shall answer at length, whether you like it or not.',
        ],
        low: [
          'The crust on a shell is armour and nothing more. Scrape it away, then lever the shell loose. Force is for amateurs.',
          'Air is borrowed time. Surface with some to spare. The sea keeps no change.',
          'Every bed regrows overnight, but only partly. A patient farmer out-earns a greedy one, and lives longer besides.',
        ],
        mid: [
          'I read your hauls in the market ledger. Steady paws, that otter, they say. I do not correct them.',
          'Marlow claims the deep piling is haunted. Marlow also claims his hat is lucky. Weigh the evidence accordingly.',
          'Do you know why a pearl forms? An irritation, wrapped in patience, over and over, until it shines. Rather like a career.',
        ],
        high: [
          'Sit a moment. The tide is out, the kettle is on, and there is nobody I would rather bore about mollusc taxonomy.',
          'I have willed you my field notes. Do not look alarmed: whales are long-lived, and the notes are dreadful.',
          'You have built something here. I have only ever measured things. I begin to suspect yours is the better trade.',
        ],
        again: [
          'Mm? Oh. We have spoken today. Go on, the water will not scrape itself.',
          'Still here? My tea is going cold on your account.',
          'Twice in one day. Flattering. The beds, however, are not flattered.',
        ],
      },
      react: {
        adore: 'Tea. Genuine tea. Otto, you magnificent creature. Sit down, sit down, I shall fetch two cups.',
        loved: '%s. Extraordinary. Look at the lustre on it. I shall label this and never shut up about it.',
        liked: '%s. Thoughtful of you. Into the collection it goes, with a small card in my best hand.',
        neutral: 'Ah. %s. Yes. Quite. Thank you, Otto.',
        disliked: '%s. You have brought me bits. I shall treasure the gesture, if not the gift.',
      },
      // The professor is your patron: hearts pay out, once each, when you talk.
      rewards: [
        { h: 2, money: 75, item: null,
          line: 'Here. A small grant from the Bellwether Institute, which is to say from me. Do not spend it all on rope.' },
        { h: 4, money: 0, item: { key: 'oyster', n: 3 },
          line: 'Three oysters from my own study bed. Crack them cleanly at the bench and tell me what you find inside.' },
        { h: 6, money: 300, item: null,
          line: 'A research stipend. You are the field half of this partnership and the field half should be paid.' },
        { h: 8, money: 0, item: { key: 'pearl', n: 1 },
          line: 'My finest specimen, and I want you to have it. Polish it, sell it, do as you like. It was only ever in a drawer.' },
        { h: 10, money: 1200, item: null,
          line: 'The whole endowment, Otto. Forty years of grants and nothing to spend them on but a friend. Take it.' },
      ],
    },
    {
      key: 'angler', name: 'Marlow', full: 'Old Marlow', role: 'anglerfish, fisherman',
      art: 'angler', x: 428, h: 48, flip: false,
      frames: { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], talk: [8, 9], emote: [10, 8, 13], happy: [12, 13], sad: [14, 15] },
      adore: [],
      loved: ['roe', 'musselMeat', 'abalone'],
      liked: ['mussel', 'clam', 'oyster', 'clamMeat', 'stock_hogfish_p', 'stock_sunfish_p'],
      disliked: ['pearl', 'tea'],
      lines: {
        first: [
          'Marlow. Old Marlow, if you are feeling formal. I fish the dark side of the pilings, on account of that is where the fish are.',
          'You bring me bait and I will bring you tackle worth having. That is the whole arrangement, and it has never needed writing down.',
        ],
        low: [
          'Roe. Urchin roe. Best bait in the bay and every fish in it agrees with me.',
          'You dive with your eyes, I fish with a lamp on my face. We are not so different, you and I.',
          'Mussels off the mid piling. Thread one on a hook and the hogfish queue up like it is payday.',
        ],
        mid: [
          'Caught something last Tuesday I still cannot name. Threw it back. It waved.',
          'A line has to be slack enough to lie and tight enough to tell the truth. Applies to most things.',
          'Bad weather is fine weather for fishing. Nobody tells the fish it is raining.',
        ],
        high: [
          'Kept a hook back for you. Nothing fancy. Just old. Old is better.',
          'If the gray one ever comes up under you, go still, otter. Still as a piling. I have seen what moves.',
          'You are the only one on this dock who lets me finish a story. Do not think I have not noticed.',
        ],
        again: [
          'Said my piece already. Fish do not wait on conversation.',
          'Twice? What is this, a survey?',
          'Go on. Tide is turning and it will not turn back for you.',
        ],
        partner: [
          'Evening, otter. Kept the good spot on the rail for you. Do not tell the gulls.',
          'Caught nothing all day and found I did not mind. Knew you would be along.',
          'You. Me. Two lines in the water and no talking for an hour. Best plan I have.',
        ],
      },
      react: {
        adore: 'Well now. That is something.',
        loved: '%s! Now that is bait. You have made my week, otter, and it was a poor week.',
        liked: '%s. Aye, that will do nicely. Ta.',
        neutral: '%s. Hm. I will find a use. I generally do.',
        disliked: 'Cannot bait a hook with %s. Cannot eat it either. Thanks, I suppose.',
      },
      romance: true,
    },
  ],

  // ---- state plumbing ---------------------------------------------------------
  // G.friends is a top-level object, so Game.load does NOT deep-merge it: an old
  // save wins wholesale and any sub-key added later would be undefined. Every
  // entry point calls ensure() to normalise it (and to survive a hand-edited save).
  ensure() {
    if (!G) return;
    if (!G.friends || typeof G.friends !== 'object') G.friends = {};
    for (let i = 0; i < this.LIST.length; i++) {
      const k = this.LIST[i].key;
      const r = G.friends[k];
      if (!r || typeof r !== 'object') {
        G.friends[k] = { pts: 0, talkDay: 0, giftDay: 0, gifts: 0, rew: 0, met: false };
        continue;
      }
      r.pts = clamp(Math.round(Number(r.pts) || 0), 0, NPC_MAX_PTS);
      r.talkDay = Number(r.talkDay) || 0;
      r.giftDay = Number(r.giftDay) || 0;
      r.gifts = Number(r.gifts) || 0;
      r.rew = clamp(Number(r.rew) || 0, 0, 99);
      r.met = !!r.met;
    }
  },

  byKey(key) {
    for (let i = 0; i < this.LIST.length; i++) if (this.LIST[i].key === key) return this.LIST[i];
    return null;
  },
  rec(key) { this.ensure(); return G && G.friends ? G.friends[key] : null; },
  points(key) { const r = this.rec(key); return r ? r.pts : 0; },
  hearts(key) { return Math.min(NPC_MAX_HEARTS, Math.floor(this.points(key) / NPC_HEART_PTS)); },
  cur() { return this.byKey(this.who); },

  // The one way friendship moves. Returns the new point total.
  add(key, points) {
    const n = this.byKey(key);
    const r = this.rec(key);
    if (!n || !r) return 0;
    const before = Math.floor(r.pts / NPC_HEART_PTS);
    r.pts = clamp(Math.round(r.pts + points), 0, NPC_MAX_PTS);
    const after = Math.floor(r.pts / NPC_HEART_PTS);
    if (points) {
      this.gain = (points > 0 ? '+' : '') + Math.round(points);
      this.gainT = 2.4;
    }
    if (after > before) {
      SND.chime();
      Game.toast(`${n.name} warms to you.  (${after}/${NPC_MAX_HEARTS} hearts)`);
    } else if (after < before) {
      Game.toast(`${n.name} cools toward you.`);
    }
    Game.save();
    return r.pts;
  },

  // ---- what the professor teaches ----------------------------------------------
  // One concrete next step, read off the actual save. Ordered by urgency, so the
  // first true branch is the thing that is genuinely holding the player up.
  hint() {
    if (!G) return 'Get your paws wet. There are shells on every piling.';
    const st = G.storage || {};
    const n = (k) => st[k] || 0;
    const raw = n('clam') + n('mussel') + n('barnacle') + n('oyster') + n('abalone') + n('roe') + n('pearl');
    const processed = n('clamMeat') + n('musselMeat') + n('oysterMeat') + n('abalonePol') + n('pearlPol');
    const crackable = n('clam') + n('mussel') + n('oyster');
    const polishable = n('abalone') + n('pearl');
    const seeds = this._seedInfo();

    if (G.hearts <= 1) return 'You are a half-heart from trouble. Go home and sleep before you go under again.';
    if (!G.stats || !G.stats.scraped) return 'Walk east to the North Piling and dive. Hold to scrape the crust, then pry the shell loose.';
    if (raw + processed === 0) return 'Your storage is bare. Take a piling down and fill that bag before you do anything clever.';
    if (crackable > 0 && !G.stats.cracked) return 'Carry a clam to the workbench and crack it. The meat is worth double the shell it came in.';
    if (!G.stats.sold) return 'Sell at the laptop. ClamNet sends a drone, and the drone pays you when it lifts the crate.';
    if (polishable > 0) return 'Polish that treasure at the workbench before you sell it. A dull pearl is half a pearl.';
    if (seeds.known && seeds.owned === 0) return 'You have a haul and no seeds. Buy seeds from Sprout and plant while the beds regrow.';
    if (crackable >= 5) return 'You have shells stacked up. Crack them at the bench, then sell the meat in one crate.';
    if (G.gear.bag === 0) return `Your pouch holds ${BAGS[0].cap}. Craft the ${BAGS[1].name} at your workbench; you are leaving shells on the piling.`;
    if (G.gear.tank === 0 && G.bridge >= 2) return `Air is time and you are short of both. Hammer out an ${TANKS[1].name} at the smithy, and do not argue.`;
    if (G.bridge < 3) {
      const b = G.bridge === 1 ? BUILDS.bridge2 : BUILDS.bridge3;
      if (G.money >= b.price) return `You can afford it: ${b.name}. Deeper water, richer beds, worse neighbours.`;
    }
    if (G.bridge >= 3 && !G.gear.lamp) return 'The deep piling is dark as a drawer. Craft the dive lamp at your workbench before you go down there again.';
    if (G.gear.gloves === false && G.bridge >= 2) return 'Urchins are all roe and grievance. Make work gloves at the workbench and take the roe safely.';
    if (typeof Side !== 'undefined' && Side && Side.ensure()) {
      const mq = Side.mainNow();
      if (mq) return Side.taken(mq.key)
        ? `${mq.name}. ${mq.how || ''}`
        : `Ask me about the survey -- ${mq.name.toLowerCase()} is next.`;
    }
    return 'You have done everything I set you. Astonishing. Now do it again, slower, and enjoy it.';
  },

  // Seed keys belong to the farming module, not to us. If no seed key exists in
  // storage at all, farming is not installed and we never mention it.
  _seedInfo() {
    const st = (G && G.storage) || {};
    let known = false, owned = 0;
    for (const k in st) {
      if (!Object.prototype.hasOwnProperty.call(st, k)) continue;
      if (k.length > 5 && k.slice(-5) === '_seed') { known = true; owned += st[k] || 0; }
    }
    return { known: known, owned: owned };
  },

  // ---- talking -----------------------------------------------------------------
  talk(key) {
    if (!G) return;
    this.ensure();
    const n = this.byKey(key);
    const r = this.rec(key);
    if (!n || !r) return;
    // Never let two modals own the screen at once; ours suppresses their update.
    if (typeof Shop !== 'undefined') Shop.open = false;
    if (typeof Bench !== 'undefined') Bench.open = false;

    const first = !r.met;
    const spoke = r.talkDay === G.day;
    const hz = this.hearts(key);
    let said;
    if (first) {
      r.met = true;
      said = n.lines.first.slice();
    } else {
      const partnered = G.partner === key && n.lines.partner;
      const pool = spoke ? n.lines.again
        : partnered ? n.lines.partner
        : (hz >= 7 ? n.lines.high : (hz >= 3 ? n.lines.mid : n.lines.low));
      const v = pick(pool);
      said = Array.isArray(v) ? v.slice() : [v];
    }

    this.who = key;
    this.mode = 'talk';
    this.gpage = 0;
    this.gain = null; this.gainT = 0;
    this.open = true;
    SND.blip();

    if (!spoke) {
      r.talkDay = G.day;
      this.add(key, NPC_TALK_PTS);
    }
    if (n.rewards) said = said.concat(this._claimRewards(n, r));
    // (THE HINT IS NOT PART OF THE GREETING ANY MORE. Every conversation with
    // Fintan used to end with 'Now then. Your next step, and I have thought about
    // it: ...' whether you wanted it or not, stapled onto whatever random line
    // the pool had picked and whatever reward had just landed -- three unrelated
    // paragraphs read as one, which is what made it not make sense. It is a
    // question you ASK now: the ADVICE button.)
    // and then, last, whether they have work for you -- said plainly, because
    // the whole point of an errand is that somebody asked
    const tk = this._taskOf(key);
    // NO KEYSTROKE IN THE PROSE. This used to read "[Q] hand it over" -- naming a
    // key for something that has a labelled button an inch below it, in a game
    // that is played on a tablet as often as not. The button says HAND IN or
    // A JOB? on its face and wears a blinking pip when something is waiting.
    if (tk && tk.kind === 'in') said.push(`(${n.name} has noticed what you are carrying.)`);
    else if (tk && tk.kind === 'ask') said.push(`(${n.name} has a job that wants doing.)`);

    this._setPages(said);
    Game.save();
  },

  // Milestone payouts, granted the moment you next speak to him.
  _claimRewards(n, r) {
    const out = [];
    const hz = Math.floor(r.pts / NPC_HEART_PTS);
    while (r.rew < n.rewards.length && hz >= n.rewards[r.rew].h) {
      const rw = n.rewards[r.rew];
      if (rw.money) G.money += rw.money;
      if (rw.item) G.storage[rw.item.key] = (G.storage[rw.item.key] || 0) + rw.item.n;
      r.rew++;
      let tail = '';
      if (rw.money) tail = `  (+$${rw.money})`;
      else if (rw.item) tail = `  (+${rw.item.n} ${this._itemName(rw.item.key)})`;
      out.push(rw.line + tail);
      SND.cash();
    }
    return out;
  },

  close() {
    if (!this.open) return;
    this.open = false;
    this.mode = 'talk';
    SND.click();
    Game.save();
  },

  advance() {
    const full = this._pageLen();
    if (this.shown < full - 0.001) { this.shown = full; return; }
    if (this.page < this.pages.length - 1) { this.page++; this.shown = 0; SND.click(); return; }
    this.close();
  },

  // ---- gifting -------------------------------------------------------------------
  tierOf(key, itemKey) {
    const n = this.byKey(key);
    if (!n) return 'neutral';
    if (n.adore && n.adore.indexOf(itemKey) >= 0) return 'adore';
    if (n.loved && n.loved.indexOf(itemKey) >= 0) return 'loved';
    if (n.liked && n.liked.indexOf(itemKey) >= 0) return 'liked';
    if (n.disliked && n.disliked.indexOf(itemKey) >= 0) return 'disliked';
    return 'neutral';
  },

  // Hands one of itemKey over. Returns the reaction line (also returned for a
  // refusal, so a caller can always just show the string).
  gift(key, itemKey) {
    if (!G) return '';
    this.ensure();
    const n = this.byKey(key);
    const r = this.rec(key);
    if (!n || !r) return '';
    if ((G.storage[itemKey] || 0) <= 0) {
      SND.alarm();
      return `You have no ${this._itemName(itemKey)} to give.`;
    }
    if (r.giftDay === G.day) {
      SND.alarm();
      return `${n.name} is still admiring today's gift. Come back tomorrow.`;
    }
    // ---- the pearl band -----------------------------------------------------
    // The one gift that is a question. Handled before the tier machinery because
    // none of it applies: a declined band is NOT consumed (nobody loses a
    // keepsake for asking early), it never counts as the day's gift, and saying
    // yes sets the only piece of state romance adds -- G.partner.
    if (itemKey === 'pearlband') {
      if (!n.romance) {
        SND.click();
        return `${n.name} turns it over gently and hands it back. "Keep this for the right someone. I mean that kindly."`;
      }
      if (G.partner === key) {
        SND.click();
        return 'One was enough. It still gets worn every day, mind.';
      }
      if (r.pts < 200) {
        SND.click();
        return `${n.name} goes very quiet, then smiles. "Not yet. Ask me again when we know each other properly."`;
      }
      G.storage.pearlband = (G.storage.pearlband || 0) - 1;
      G.partner = key;
      r.pts = NPC_MAX_PTS;
      r.giftDay = G.day;
      SND.chime();
      Game.save();
      return key === 'angler'
        ? 'Marlow looks at the band a long time. "Aye," he says, and that is everything. He ties it into his line, where he can always see it.'
        : 'Sprout holds the band up to the light, then presses it to her chest. "Yes. Obviously yes. I have been hoping you would ask."';
    }
    const tier = this.tierOf(key, itemKey);
    G.storage[itemKey] = (G.storage[itemKey] || 0) - 1;
    r.giftDay = G.day;
    r.gifts++;
    this.add(key, NPC_GIFT_PTS[tier]);
    if (tier === 'adore' || tier === 'loved') SND.chime();
    else if (tier === 'disliked') SND.clank();
    else SND.click();
    if (navigator.vibrate) { try { navigator.vibrate(tier === 'disliked' ? 40 : 15); } catch (e) {} }
    Game.save();
    return n.react[tier].replace('%s', this._itemName(itemKey));
  },

  canGift(key) {
    const r = this.rec(key);
    return !!r && r.giftDay !== G.day && this.giftKeys().length > 0;
  },

  // Everything in storage, ITEMS order first so the familiar shells lead.
  giftKeys() {
    const out = [];
    if (!G || !G.storage) return out;
    for (let i = 0; i < ITEM_KEYS.length; i++) {
      const k = ITEM_KEYS[i];
      if ((G.storage[k] || 0) > 0) out.push(k);
    }
    for (const k in G.storage) {
      if (!Object.prototype.hasOwnProperty.call(G.storage, k)) continue;
      if (ITEMS[k]) continue;
      if ((G.storage[k] || 0) > 0) out.push(k);
    }
    return out;
  },

  openGift() {
    this.mode = 'gift';
    this.gpage = 0;
    SND.blip();
  },

  // ---- text layout ------------------------------------------------------------
  // Courier is monospace (0.6em advance), so wrapping by character count matches
  // the rendered width exactly and needs no ctx to measure.
  _paginate(str) {
    const cols = this.COLS, lines = [];
    const words = String(str).split(/\s+/);
    let line = '';
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (!w.length) continue;
      while (w.length > cols) {        // a pathological unbroken word
        if (line.length) { lines.push(line); line = ''; }
        lines.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!line.length) line = w;
      else if (line.length + 1 + w.length <= cols) line += ' ' + w;
      else { lines.push(line); line = w; }
    }
    if (line.length) lines.push(line);
    const pages = [];
    for (let i = 0; i < lines.length; i += this.MAXL) pages.push(lines.slice(i, i + this.MAXL));
    if (!pages.length) pages.push(['']);
    return pages;
  },

  _setPages(list) {
    let pages = [];
    for (let i = 0; i < list.length; i++) pages = pages.concat(this._paginate(list[i]));
    this.pages = pages;
    this.page = 0;
    this.shown = 0;
    this._blipT = 0;
  },

  _pageLen() {
    const p = this.pages[this.page] || [''];
    let n = 0;
    for (let i = 0; i < p.length; i++) n += p[i].length;
    return n;
  },

  _itemName(key) {
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) return ITEMS[key].name;
    if (NPC_ITEM_NAMES[key]) return NPC_ITEM_NAMES[key];
    const parts = String(key).replace(/^(crop|stock)_/, '').split(/[_\s]+/);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      out += (out ? ' ' : '') + parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
    }
    return out || String(key);
  },

  // ---- update ------------------------------------------------------------------
  update(dt) {
    if (!G) return;
    this.ensure();
    this.animT += dt;
    if (this.gainT > 0) this.gainT -= dt;

    const n = this.cur();
    if (!n) { this.open = false; return; }

    // typewriter
    if (this.mode === 'talk') {
      const full = this._pageLen();
      if (this.shown < full) {
        this.shown = Math.min(full, this.shown + dt * this.SPEED);
        this._blipT -= dt;
        if (this._blipT <= 0) {
          this._blipT = 0.055;
          // a soft two-tone mutter: cheap, and it makes the box feel spoken
          SND.tone({ f: 300 + (Math.floor(this.shown) % 3) * 55, type: 'square', a: 0.002, d: 0.035, v: 0.045 });
        }
      }
    }

    const mx = Input.mouse.x, my = Input.mouse.y;
    const clicked = Input.mouse.clicked;
    const adv = Input.p('KeyE') || Input.p('Space');

    if (Input.p('Escape')) {
      if (this.mode === 'gift') { this.mode = 'talk'; SND.click(); }
      else this.close();
      return;
    }

    if (this.mode === 'gift') {
      const back = this._btn('back');
      const keys = this.giftKeys();
      const per = 18;
      const maxPage = Math.max(0, Math.ceil(keys.length / per) - 1);
      this.gpage = clamp(this.gpage, 0, maxPage);
      if (adv) { this.mode = 'talk'; SND.click(); return; }
      if (!clicked) return;
      if (this._in(back, mx, my)) { this.mode = 'talk'; SND.click(); return; }
      if (maxPage > 0) {
        for (let i = 0; i < 2; i++) {
          const rc = this._pageBtn(i);
          if (this._in(rc, mx, my)) {
            this.gpage = clamp(this.gpage + (i ? 1 : -1), 0, maxPage);
            SND.blip();
            return;
          }
        }
      }
      for (let i = 0; i < per; i++) {
        const k = keys[this.gpage * per + i];
        if (!k) break;
        const rc = this._giftRect(i);
        if (this._in(rc, mx, my)) {
          const line = this.gift(this.who, k);
          this.mode = 'talk';
          this._setPages([line]);
          return;
        }
      }
      return;
    }

    // talk mode: buttons first, so a click on one never also advances the page.
    // They are only LIVE while they are DRAWN -- the draw shows them once the last
    // page has finished typing -- or a click aimed at the page turn would land on
    // a button that had not appeared yet.
    const shown = this.shown >= this._pageLen() && this.page >= this.pages.length - 1;
    if (clicked && shown) {
      const bye = this._btn('bye');
      if (this._in(bye, mx, my)) { this.close(); return; }
      const gb = this._btn('gift');
      if (this._in(gb, mx, my)) {
        if (this.canGift(this.who)) this.openGift();
        else { SND.alarm(); }
        return;
      }
      const tb = this._btn('task');
      if (this._in(tb, mx, my)) { this.doTask(this.who); return; }
      const ab = this._btn('ask');
      if (this._in(ab, mx, my)) {
        const nn = this.byKey(this.who);
        this._setPages([`${nn ? nn.name : 'They'} thinks for a moment. "${this.hint()}"`]);
        SND.click();
        return;
      }
    }
    // [Q] is the keyboard's version of the TASK button, so an errand can be
    // taken and handed in without a mouse.
    if (Input.p('KeyQ')) { this.doTask(this.who); return; }
    if (clicked || adv) this.advance();
  },

  // ---- geometry (kept in one place so draw and update cannot drift) -------------
  _rect() {
    return this.mode === 'gift'
      ? { x: 18, y: 118, w: 444, h: 130 }
      : { x: 18, y: 156, w: 444, h: 92 };
  },
  _btn(which) {
    const r = this._rect();
    const y = r.y + r.h - 20;
    if (which === 'next') return { x: r.x + 88, y: y, w: 60, h: 16 };
    if (which === 'ask') return { x: r.x + 184, y: y, w: 58, h: 16 };
    if (which === 'task') return { x: r.x + r.w - 200, y: y, w: 62, h: 16 };
    if (which === 'gift') return { x: r.x + r.w - 134, y: y, w: 58, h: 16 };
    return { x: r.x + r.w - 70, y: y, w: 56, h: 16 };   // 'bye' and 'back' share the slot
  },

  // ---- errands -------------------------------------------------------------------
  // What this neighbour's TASK button does right now. Three states, and all
  // three are worth a click: hand one in, take a new one, or ask how the one you
  // are carrying is going.
  _taskOf(key) {
    if (typeof Side === 'undefined' || !Side || !Side.ensure()) return null;
    const ready = Side.readyFor(key);
    if (ready) return { q: ready, kind: 'in' };
    const offer = Side.offerFor(key);
    if (offer) return { q: offer, kind: 'ask' };
    const act = Side.activeFor(key);
    if (act.length) return { q: act[0], kind: 'wait' };
    return null;
  },
  _taskLabel(key) {
    const t = this._taskOf(key);
    if (!t) return 'NO JOBS';
    return t.kind === 'in' ? 'HAND IN' : (t.kind === 'ask' ? 'A JOB?' : 'HOW GOES');
  },

  // Clicking it swaps the dialogue pages -- no new mode, no second modal. The
  // errand's own written lines do the talking, and a short mechanical line is
  // appended so the player is never left guessing what just changed.
  doTask(key) {
    const t = this._taskOf(key);
    const n = this.byKey(key);
    if (!t || !n) { SND.alarm(); return; }
    const q = t.q;
    if (t.kind === 'in') {
      const paid = Side.handIn(q);
      if (!paid) { SND.alarm(); return; }
      const said = (q.thanks || []).slice();
      const r = q.reward || {};
      const bits = [];
      if (r.money) bits.push(`$${r.money}`);
      if (r.items) for (const k in r.items) bits.push(`${r.items[k]} ${Side.itemName(k)}`);
      if (r.seeds) for (const k in r.seeds) bits.push(`${r.seeds[k]} seed packets`);
      if (bits.length) said.push(`(You are handed ${bits.join(', ')}.)`);
      if (r.note) said.push(`(${r.note})`);
      this._setPages(said);
      return;
    }
    if (t.kind === 'ask') {
      if (!Side.accept(q)) { SND.alarm(); return; }
      const said = (q.ask || []).slice();
      said.push(`(Errand taken: "${q.name}". It is in the journal -- [J].)`);
      if (q.how) said.push(`(${q.how})`);
      this._setPages(said);
      return;
    }
    // still carrying it: they ask how it is going, and the answer is the numbers
    const p = Side.prog(q);
    const said = [`${n.name}: "How is that going, then -- ${q.name.toLowerCase()}?"`];
    if (q.deliver) said.push(`(You have ${Side.deliverText(q)}.)`);
    else if (p) said.push(`(${p.n} of ${p.of} so far.)`);
    if (q.how) said.push(`(${q.how})`);
    SND.blip();
    this._setPages(said);
  },
  _giftRect(i) {
    const r = this._rect();
    const col = i % 9, row = (i / 9) | 0;
    return { x: r.x + 84 + col * 38, y: r.y + 32 + row * 36, w: 36, h: 34 };
  },
  _pageBtn(i) {
    const r = this._rect();
    return { x: r.x + 84 + i * 20, y: r.y + r.h - 20, w: 17, h: 16 };
  },
  _in(rc, mx, my) { return mx >= rc.x && mx <= rc.x + rc.w && my >= rc.y && my <= rc.y + rc.h; },

  // ---- draw --------------------------------------------------------------------
  draw(c) {
    if (!G) return;
    this.ensure();
    const n = this.cur();
    if (!n) return;
    const r = this._rect();
    const mx = Input.mouse.x, my = Input.mouse.y;

    c.fillStyle = 'rgba(6,10,16,0.58)';
    c.fillRect(0, 0, W, H);
    uiNote(c, r.x, r.y, r.w, r.h, { tape: true, rules: true });

    // ---- portrait ----------------------------------------------------------------
    const bx = r.x + 8, by = r.y + 8, bw = 68, bh = r.h - 16;
    const talking = this.mode === 'talk' && this.shown < this._pageLen();
    const pool = talking ? n.frames.talk : n.frames.idle;
    const fi = Math.floor(this.animT * (talking ? 7 : 2.1)) % pool.length;
    const art = n.art + '_' + pool[fi];
    const bob = Math.sin(this.animT * 2.4) * 0.8;
    c.save();
    c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
    // THE SEA BEHIND THEM, not a flat brown rectangle. This is the uploaded ocean
    // loop the dock and the house already stand in front of; running it here puts
    // the character somewhere instead of on a swatch, and it is the same twelve
    // frames on the same global clock, so it costs one blit and no new state.
    //
    // Cover-fit, anchored on the horizon: the frames are 2:1 and this box is
    // portrait, so fitting by width would leave sky above and below. Scaling by
    // HEIGHT and centring horizontally keeps the waterline across the middle,
    // which is where a standing character wants it.
    const ocf = `ocean${Math.floor((typeof Game !== 'undefined' ? Game.time : this.animT) * 8) % 12}`;
    const oim = typeof ASSETS !== 'undefined' && ASSETS[ocf];
    if (oim && oim.width) {
      const ow = bh * oim.width / oim.height;
      c.globalAlpha = 0.85;                    // sits back so the sprite reads first
      c.drawImage(oim, bx + (bw - ow) / 2, by, ow, bh);
      c.globalAlpha = 1;
      // a warm scrim so the panel's wood still owns the frame
      c.fillStyle = 'rgba(122,74,48,0.16)';
      c.fillRect(bx, by, bw, bh);
    } else {
      c.fillStyle = 'rgba(122,74,48,0.10)';
      c.fillRect(bx, by, bw, bh);
    }
    drawAC(c, art, bx + bw / 2, by + bh / 2 + bob, Math.min(bw - 6, bh - 4));
    c.restore();
    // the frame goes on AFTER the clip is released, so its stroke is not clipped
    inkBox(c, bx - 2, by - 2, bw + 4, bh + 4, null, 'rgba(122,74,48,0.6)', PIX * 2);

    // ---- name + role -------------------------------------------------------------
    const tx = r.x + 84;
    text(c, n.full, tx, r.y + 5, { size: 9, color: '#30150a', shadow: false });
    // the pearl band, worn: partners get a small heart by their name instead of a
    // title change -- the game does not need to say the word out loud
    const partnered = G.partner === this.who;
    if (partnered) drawHeart(c, tx + textWidth(c, n.full, 9) + 5, r.y + 5, 'full');
    text(c, n.role, tx + textWidth(c, n.full, 9) + (partnered ? 16 : 8), r.y + 7.5, { size: 6.5, color: '#914007', shadow: false });

    // ---- heart row ---------------------------------------------------------------
    const pts = this.points(this.who);
    const hx = r.x + r.w - 12 - NPC_MAX_HEARTS * 7.5, hy = r.y + 5;
    for (let i = 0; i < NPC_MAX_HEARTS; i++) {
      const kind = pts >= (i + 1) * NPC_HEART_PTS ? 'full'
        : (pts >= i * NPC_HEART_PTS + NPC_HEART_PTS / 2 ? 'half' : 'empty');
      drawHeart(c, hx + i * 7.5, hy, kind);
    }
    // progress inside the current heart
    const frac = clamp((pts % NPC_HEART_PTS) / NPC_HEART_PTS, 0, 1);
    const barW = NPC_MAX_HEARTS * 7.5 - 3;
    c.fillStyle = 'rgba(122,74,48,0.25)';
    c.fillRect(hx, hy + 8, barW, 1.6);
    c.fillStyle = pts >= NPC_MAX_PTS ? '#e8a93c' : '#c9536a';
    c.fillRect(hx, hy + 8, pts >= NPC_MAX_PTS ? barW : barW * frac, 1.6);
    // NO SCORE FLOATING OFF A FRIENDSHIP. This printed "+12" beside the hearts,
    // which is the relationship-as-progress-bar the label already stopped doing.
    // A liking went up: the hearts sparkle and the bar under them moves, and
    // that is the whole report.
    if (this.gainT > 0 && this.gain && this.gain.charAt(0) !== '-') {
      const k = clamp(this.gainT / 2.4, 0, 1);
      c.globalAlpha = k;
      for (let i = 0; i < 3; i++) {
        const a = this.animT * 3 + i * 2.1;
        PixIcons.draw(c, 'spark', hx + barW * (0.2 + 0.3 * i) + Math.sin(a) * 2,
          hy + 6 - (1 - k) * 7, 7, { t: this.animT, phase: i * 1.7 });
      }
      c.globalAlpha = 1;
    }

    if (this.mode === 'gift') { this._drawGift(c, r, mx, my); return; }

    // ---- the line, typewritten ----------------------------------------------------
    const lines = this.pages[this.page] || [''];
    let budget = this.shown;
    let ly = r.y + 21;
    for (let i = 0; i < lines.length; i++) {
      const take = clamp(Math.floor(budget), 0, lines[i].length);
      if (take > 0) text(c, lines[i].slice(0, take), tx, ly, { size: 8, color: '#30150a', shadow: false });
      budget -= lines[i].length;
      ly += 10.5;
      if (budget <= 0) break;
    }

    // ---- footer ---------------------------------------------------------------------
    const done = this.shown >= this._pageLen();
    const more = this.page < this.pages.length - 1;
    if (done) {
      // a nudging chevron in the corner of the text block
      const cy = r.y + r.h - 13 + Math.sin(this.animT * 5) * 0.9;
      c.fillStyle = '#8a5a2c';
      c.beginPath();
      c.moveTo(tx - 10, cy - 3); c.lineTo(tx - 3, cy - 3); c.lineTo(tx - 6.5, cy + 2);
      c.closePath(); c.fill();
      // ...and a button to press, rather than the name of a key. Clicking
      // anywhere in the box still turns the page, so this is an affordance and
      // not a new gate -- but it is the thing a thumb goes for.
      if (more) this._button(c, this._btn('next'), 'NEXT', true, mx, my);
    }

    // ---- THE CHOICES, and they arrive when the talking stops ------------------
    //
    // They used to be on screen from the first character of the first page, which
    // is why a conversation felt like a form rather than a conversation: you were
    // being asked to choose before anybody had finished a sentence. Now the box
    // says its piece -- NEXT, NEXT -- and when there is nothing left to read, the
    // four things you can do about it appear together.
    if (!done || more) return;
    const canG = this.canGift(this.who);
    const gRec = this.rec(this.who);
    const gaveToday = gRec && gRec.giftDay === G.day;
    const tk = this._taskOf(this.who);
    this._button(c, this._btn('ask'), 'ADVICE', true, mx, my);
    // a hand-in waiting is worth a nudge: the button gets a gold pip on it
    const tr = this._btn('task');
    this._button(c, tr, this._taskLabel(this.who), !!tk, mx, my);
    if (tk && tk.kind === 'in') {
      c.fillStyle = Math.sin(this.animT * 5) > 0 ? '#ffd45a' : '#e8a93c';
      c.fillRect(tr.x + 3, tr.y + 3, 3, 3);
    }
    this._button(c, this._btn('gift'), gaveToday ? 'GIVEN' : 'GIFT', canG, mx, my);
    this._button(c, this._btn('bye'), 'BYE', true, mx, my);
  },

  _drawGift(c, r, mx, my) {
    const tx = r.x + 84;
    const keys = this.giftKeys();
    const per = 18;
    const maxPage = Math.max(0, Math.ceil(keys.length / per) - 1);
    let hoverName = keys.length ? 'One gift a day. Choose well.' : 'You are carrying nothing to give.';

    for (let i = 0; i < per; i++) {
      const k = keys[this.gpage * per + i];
      if (!k) break;
      const rc = this._giftRect(i);
      const hov = this._in(rc, mx, my);
      if (hov) hoverName = `${this._itemName(k)}  x${G.storage[k]}`;
      inkBox(c, rc.x, rc.y, rc.w, rc.h,
        hov ? '#e08a1a' : '#e3ab61',
        hov ? '#c56906' : '#914007', hov ? PIX * 3 : PIX * 2);
      this._icon(c, k, rc.x + rc.w / 2, rc.y + rc.h / 2 - 3, 20);
      text(c, 'x' + (G.storage[k] || 0), rc.x + rc.w - 3, rc.y + rc.h - 9, {
        size: 6.5, align: 'right', color: '#662907', shadow: false });
    }
    text(c, hoverName, tx, r.y + 20, { size: 7, color: '#662907', shadow: false });

    if (maxPage > 0) {
      for (let i = 0; i < 2; i++) {
        const rc = this._pageBtn(i);
        const can = i ? this.gpage < maxPage : this.gpage > 0;
        this._button(c, rc, i ? '>' : '<', can, mx, my);
      }
      text(c, `${this.gpage + 1}/${maxPage + 1}`, r.x + 128, r.y + r.h - 16,
        { size: 6.5, color: '#914007', shadow: false });
    }
    this._button(c, this._btn('back'), 'BACK', true, mx, my);
  },

  _button(c, rc, label, enabled, mx, my) {
    inkButton(c, rc, label, enabled, enabled && this._in(rc, mx, my), this.animT || 0);
  },

  // Item art, in resolution order: an ITEMS key, then a raw asset name (crops and
  // livestock produce are named after their art), then the hand-drawn teacup,
  // then an initial in a box so an unknown key is still clickable and legible.
  _icon(c, key, cx, cy, s) {
    if (typeof ITEMS !== 'undefined' && ITEMS[key]) { drawItemIcon(c, key, cx, cy, s); return; }
    const img = ASSETS[key];
    if (img && img.width) { drawAC(c, key, cx, cy, s); return; }
    if (key === 'tea' || key === 'teaLeaf' || key === 'crop_tea_p') { this._teacup(c, cx, cy, s); return; }
    inkBox(c, cx - s / 2, cy - s / 2, s, s, '#e3ab61', '#914007', PIX * 2);
    text(c, String(key).charAt(0).toUpperCase(), cx, cy - s / 2 + 2, {
      size: s * 0.7, align: 'center', color: '#662907', shadow: false });
  },

  // The professor's one true love has no art in the manifest, so we draw it.
  _teacup(c, cx, cy, s) {
    const w = s * 0.7, h = s * 0.46;
    const x = cx - w / 2, y = cy - h / 2 + s * 0.08;
    c.fillStyle = '#f6e8c9';
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w * 0.82, y + h); c.lineTo(x + w * 0.18, y + h);
    c.closePath(); c.fill();
    c.strokeStyle = '#662907'; c.lineWidth = PIX * 2; c.stroke();
    c.fillStyle = '#8a5a2c';
    c.fillRect(x + w * 0.10, y + h * 0.14, w * 0.80, h * 0.22);
    c.strokeStyle = '#662907'; c.lineWidth = PIX * 2;
    c.beginPath(); c.arc(x + w + s * 0.03, y + h * 0.45, s * 0.11, -1.2, 1.2); c.stroke();
    c.fillStyle = '#c9a271';
    c.fillRect(x - w * 0.12, y + h, w * 1.24, PIX * 3);
    // steam
    c.strokeStyle = 'rgba(122,74,48,0.45)'; c.lineWidth = PIX * 1.5;
    for (let i = 0; i < 2; i++) {
      const sx = cx - s * 0.12 + i * s * 0.24;
      c.beginPath();
      c.moveTo(sx, y - s * 0.06);
      c.quadraticCurveTo(sx + s * 0.08, y - s * 0.18, sx, y - s * 0.3);
      c.stroke();
    }
  },

  // Our modal hides the shared arrow cursor (main.js only special-cases Shop),
  // so we draw the same arrow ourselves while the box is up.
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

  // ---- world presence -------------------------------------------------------------
  spots() {
    if (!G) return [];
    this.ensure();
    const out = [];
    for (let i = 0; i < this.LIST.length; i++) {
      const n = this.LIST[i];
      const key = n.key;
      const fresh = this.rec(key).talkDay !== G.day;
      out.push({
        x: n.x,
        // A person is wide and a walking person is a moving target, so 22 units
        // was a window you had to line up in. And priority, because talking is
        // what advances the game: a hatch in the planks standing one unit nearer
        // must not swallow the only interaction that does.
        r: 34,
        prio: 2,
        // NO RELATIONSHIP NUMBER. The label used to read "(3/10 hearts)" --
        // spelling out the affection score as a fraction turns a friendship into
        // a progress bar. The hearts are drawn in the dialogue box where they
        // belong; out here it is just a name, and a star when they have not been
        // spoken to today.
        label: `Talk to ${n.name}${fresh ? '  *' : ''}`,
        act: () => this.talk(key),
      });
    }
    return out;
  },

  // Draws the cast standing on the deck. Call this in WORLD space (with the
  // camera translate active); camX is used for culling and for the marker.
  drawWorld(c, camX) {
    if (!G) return;
    this.ensure();
    const t = typeof Game !== 'undefined' ? Game.time : 0;
    const px = typeof WorldScene !== 'undefined' ? WorldScene.px : -9999;
    for (let i = 0; i < this.LIST.length; i++) {
      const n = this.LIST[i];
      if (n.x < camX - 70 || n.x > camX + W + 70) continue;

      // Idle bob plus a short emote every few seconds. Both are derived from the
      // global clock, so drawWorld needs no per-frame state of its own.
      // WALKING beats everything: a moving sprite playing an idle loop is the
      // thing that reads as sliding. n.walking and n.walkT are set for the one
      // frame by whoever is driving them (js/integrate.js's visitor).
      const cyc = 8.5 + i * 2.7;
      const ph = (t + i * 3.9) % cyc;
      const walking = !!n.walking && n.frames.walk;
      const emoting = !walking && ph < 1.8;
      const pool = walking ? n.frames.walk : (emoting ? n.frames.emote : n.frames.idle);
      const fi = walking ? Math.floor(n.walkT || 0) % pool.length
        : (emoting ? Math.floor(ph * 2.2) % pool.length : Math.floor(t * 2 + i) % pool.length);
      // A WALK BOUNCES OFF THE BOARDS; AN IDLE BREATHES.
      //
      // Four drawn frames is a thin cycle, and "add more frames" is not something
      // a sheet of sixteen can be talked into. What it CAN do is carry the motion
      // between them: a step has a rise and a fall, the body squashes as the foot
      // lands and stretches as it leaves, and the whole animal leans into the
      // direction of travel. Those three, driven off the same walkT the frame
      // index uses, put a beat between every pair of frames -- so four frames
      // read as eight and the stride lands instead of sliding.
      const wph = (n.walkT || 0) * Math.PI * 0.5;
      const bob = walking
        ? Math.abs(Math.sin(wph)) * 1.7
        : Math.sin(t * 1.6 + i * 2.1) * 0.7 + (emoting ? Math.abs(Math.sin(ph * 5)) * 0.9 : 0);
      // squash on the down beat, stretch on the up; volume roughly conserved
      const sq = walking ? 1 - Math.cos(wph * 2) * 0.045 : 1;
      const sx2 = walking ? 1 + Math.cos(wph * 2) * 0.045 : 1;
      const lean = walking ? Math.sin(wph) * 0.035 : 0;

      c.fillStyle = 'rgba(40,20,10,0.18)';
      c.beginPath();
      c.ellipse(n.x, DECK_Y + 0.8, n.h * 0.22, 1.4, 0, 0, TAU);
      c.fill();

      const img = ASSETS[n.art + '_' + pool[fi]];
      if (img && img.width) {
        const hh = n.h, ww = hh * img.width / img.height;
        const sx = Math.round(n.x * DPX) / DPX;
        c.save();
        c.translate(sx, DECK_Y + 0.5 - bob);
        c.rotate(lean * (n.flip ? -1 : 1));
        if (n.flip) c.scale(-1, 1);
        c.scale(sx2, sq);
        c.drawImage(img, -ww / 2, -hh, ww, hh);
        c.restore();
        // and the boards give a little dust back on each footfall, the same way
        // Otto's do -- it is what makes a walk land on something
        if (walking && Math.sin(wph) > 0.94) {
          c.fillStyle = 'rgba(226,206,168,0.5)';
          const d0 = (n.flip ? 1 : -1) * (2 + (Math.floor(n.walkT || 0) % 2));
          c.fillRect(sx + d0 - 1, DECK_Y - 1.5, 3, 1.5);
          c.fillStyle = 'rgba(226,206,168,0.25)';
          c.fillRect(sx + d0 * 2 - 1, DECK_Y - 3, 2, 1);
        }
      }

      // Over their head, in priority order: an ERRAND mark ('!' they are owed a
      // hand-in, '?' they are holding a job) beats the plain unspoken-to tag,
      // because the errand is the thing worth crossing the deck for. Both are
      // hidden while Otto is close enough for WorldScene's own prompt bubble to
      // be sitting in the same airspace.
      const far = Math.abs(px - n.x) >= 26;
      const mk = (typeof Side !== 'undefined' && Side) ? Side.mark(n.key) : '';
      if (mk && far) {
        // scale 3: the glyph is 4x9 texels, so at APIX that would be two logical
        // units wide -- a speck. Three makes it six wide and thirteen tall,
        // which is the same weight as the talk tag it replaces.
        Side.drawMark(c, n.x, DECK_Y - n.h - 9 - bob, mk, 3);
      } else if (mk && !far) {
        // nothing: the prompt says it better from two paces
      } else if (this.rec(n.key).talkDay !== G.day && far) {
        const my = DECK_Y - n.h - 10 - bob + Math.sin(t * 3 + i) * 0.8;
        uiNote(c, n.x - 5, my, 10, 11, {});
        text(c, '!', n.x, my + 2, { size: 7.5, color: '#8a5a2c', align: 'center', shadow: false });
      }
    }
  },

  // ---- self-contained wiring ------------------------------------------------------
  // main.js hardcodes Shop and Bench by name, so a third modal has to borrow the
  // slots instead: globalUpdate for update, drawHUD for draw (same z-order as
  // Shop), Game.go for dismissal, TouchUI.layout to hide the walk buttons.
  install() {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;

    const gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      if (NPCs.open && Game.fadeDir === 0 && !Game.helpOpen && !Shop.open && !Bench.open) NPCs.update(dt);
    };

    const gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (NPCs.open) { NPCs.draw(c); return; }
      gHUD(c);
    };

    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { NPCs.open = false; return gGo(scene, arg); };

    const gCursor = Game.drawCursor.bind(Game);
    Game.drawCursor = function (c) {
      if (NPCs.open && !TouchUI.enabled) { NPCs._cursor(c); return; }
      gCursor(c);
    };

    const tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return NPCs.open ? [] : tLayout(); };

    // The scene under a borrowed-slot modal keeps updating, so Otto would walk
    // (and re-trigger the talk spot) behind the box. Freeze the scenes instead.
    if (typeof WorldScene !== 'undefined') {
      const wu = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (NPCs.open) return; wu(dt); };
    }
    if (typeof HouseScene !== 'undefined') {
      const hu = HouseScene.update.bind(HouseScene);
      HouseScene.update = function (dt) { if (NPCs.open) return; hu(dt); };
    }
  },
};

// This file may be loaded before OR after js/main.js. Game/TouchUI only exist
// once main.js has run, so install now if they are here and on DOMContentLoaded
// (which fires after every classic script in the body) if they are not.
if (typeof Game !== 'undefined') NPCs.install();
else document.addEventListener('DOMContentLoaded', () => NPCs.install(), { once: true });
