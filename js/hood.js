'use strict';
// ---- js/hood.js -- THE NEIGHBOURHOOD: three homes out at sea, three residents
// with somewhere to be ------------------------------------------------------------
//
// Everybody Otto knows used to be a sprite standing on his own pier. This file
// gives each of them a HOUSE of their own, a long way out in the open ocean, and
// a DAY to spend. Two halves, one module:
//
//   1. THE HOMES. Three stilt houses at three fixed world positions, spread right
//      across the ocean's x range. Their decks sit ABOVE the waterline, so from
//      underwater a home reads as a silhouette on legs that you swim up to and
//      CLIMB:  Hood.climbAt(px, py) -> the home in reach, Hood.climb(home) takes
//      you up. The deck is a small walkable scene (Hood is a scene object, so
//      `Game.go(Hood, home)` is all the transition takes) with the resident on
//      it, a door to knock on, their planter, props and a rail to dive off.
//      Leaving puts you back in the water exactly where you climbed in, with
//      your bag intact.
//
//   2. THE RESIDENTS. Not wander timers. Each one is a small agent with:
//        * a DAY PLAN of {fromHour, toHour, act, where} slots -- sleeping, fishing
//          a favourite spot, tending their own planter, visiting a neighbour,
//          coming down to the player's pier, drifting home. They TRAVEL between
//          those places: real swimming, with a wake, on a line the player can
//          cut across mid-water and stop for a chat.
//        * a MEMORY -- the last thing they talked about, whether they have
//          greeted you today, whether they clocked what you were carrying, and
//          what they were doing the last time you met. Every line is picked from
//          those, and no line is ever said twice in a row.
//        * a MOOD that comes off the world and not off a die: delighted if you
//          are carrying something they love, worried if their crop is dry,
//          grumpy in the rain or the small hours, pleased if you are on good
//          terms, level otherwise.
//
// THE CLOCK IS ALWAYS RUNNING. Hood.update() is hooked into Game.globalUpdate, the
// one slot that ticks in every scene (and under Shop and Bench), so the schedules
// keep turning while the player is on his own deck or asleep in bed. That is the
// whole point: swim out at dusk and Marlow really is somewhere else.
//
// WHO CALLS WHAT. js/integrate.js already drives the ocean side --
// Hood.reset(seed) on Ocean.enter, Hood.update(dt) each ocean frame and
// Hood.draw(ctx, camX, camY) inside the back pass of Ocean._drawProps (world
// space, camera already applied). update() carries the standard Game.time
// double-tick guard, so being called from both places costs nothing. Everything
// else this file needs it installs itself, the way the other bolt-ons do.
//
// DIALOGUE IS DELEGATED. Meeting somebody hands the conversation to
// NPCs.talk(key) when that module is loaded -- it owns the friendship points, the
// gift grid and the typewriter box. What this file adds on top is the situational
// half: a speech bubble in world space saying where they are and what they are
// doing, which npc.js has no way of knowing. With npc.js absent the bubble alone
// still carries the scene.
//
// FRAME BUDGET. Three homes, three agents, one recycled wake pool. Nothing
// allocates in the hot path, nothing builds a colour string inside a loop
// (the wake is two buckets, two fillStyle writes), nothing evaluates a gradient
// or filters an image -- the submerged wash and the lamp glow are flat bands and
// four arcs. Every world-space drawer culls against the camera rect first.
const Hood = {

  // ============================================================== config ======
  SWIM: 88,               // travelling speed, world units/sec
  CLIMB_SPEED: 46,        // the last leg up their own ladder
  ARRIVE: 13,             // how close counts as "there"
  TALK_R: 46,             // how near you must be mid-water to strike up a chat
  CLIMB_R: 34,            // horizontal reach of a ladder
  CLIMB_TOP: -10,         // highest y the ladder can be grabbed from
  CLIMB_BOT: 76,          // deepest y the ladder can be grabbed from
  HOLD_T: 7,              // how long a resident stays put after you speak to them
  SAY_T: 5.4,             // speech bubble lifetime
  WAKE_MAX: 36,
  BUBBLE_COLS: 36,        // character wrap width of a speech bubble
  BUBBLE_LINES: 5,

  // The pier, in ocean world coordinates. G.ocean.x starts at 0 and that is where
  // Otto drops in off his own planks, so the origin IS home water.
  DOCK_AT: { x: 6, y: 6 },

  // ---- the deck scene ---------------------------------------------------------
  FLOOR: 178,             // deck surface, screen y (the sea starts at SKY.HORIZON 118)
  DL: 96, DR: 384,        // walkable span
  customCursor: false,    // keyboard scene; let Game.drawCursor keep the arrow

  // Where things stand on the deck, in screen units. The [E] search is the same
  // nearest-within-26 the house uses, so every pair here is >= 30 apart or two of
  // them would fight over one keypress and the loser would be unreachable. The
  // draw code reads these same numbers, so a hit box can never drift off its art.
  PLOT_X: 148, DOOR_X: 240, PROP_X: 318, EXIT_X: 378,
  POST_TEND: 178,               // a resident who is tending stands at the planter
  POSTS: [208, 118, 96],        // ...otherwise they take the next free post

  // ---- clock ------------------------------------------------------------------
  // G.clock is a 0..1 day cycle whose landmarks are fixed elsewhere: 0.06 is the
  // first light nightness() admits, 0.30 is "morning", 0.62 is dusk and 0.74 is
  // full night. Plans want to be readable as times of day, so the clock is mapped
  // onto a 24h face through those anchors. The day starts at 03:00 because that
  // is where clock 0 lands.
  HOUR_ANCHORS: [
    [0, 3], [0.06, 5], [0.14, 7], [0.30, 10],
    [0.50, 15], [0.62, 19], [0.74, 22], [1, 27],
  ],

  // ============================================================== the homes ====
  // Authored geometry, never derived from art: deckY is the world y of the deck
  // surface and the climb box hangs off climbDX, so a missing sprite changes how
  // this looks and not how it plays. deckFrac is the only art-dependent number --
  // how far down the sprite its own deck line sits -- and it is used for placing
  // the sprite against the authored deck, not the other way round.
  HOMES: [
    {
      key: 'lamp', who: 'prof', art: 'nhouse_light',
      name: 'The Lamp Rock', of: "Fintan's lighthouse",
      x: -1480, w: 106, deckY: -30, deckFrac: 0.70,
      climbDX: 40, plotDX: -34, doorDX: 16, propDX: 34,
      fish: { x: -1180, y: 96 },
    },
    {
      key: 'cottage', who: 'farmer', art: 'nhouse_cottage',
      name: 'Kelprow Cottage', of: "Sprout's cottage",
      x: 880, w: 114, deckY: -27, deckFrac: 0.62,
      climbDX: -44, plotDX: 36, doorDX: -12, propDX: -30,
      fish: { x: 1240, y: 62 },
    },
    {
      key: 'shack', who: 'angler', art: 'nhouse_shack',
      name: 'The Lean-To', of: "Marlow's shack",
      x: 2380, w: 100, deckY: -24, deckFrac: 0.63,
      climbDX: 38, plotDX: -32, doorDX: 14, propDX: 30,
      fish: { x: 2760, y: 148 },
    },
  ],

  // Public: the world-position list, so the ocean scene (or a map, or a compass)
  // can ask where the neighbourhood is without knowing anything else in here.
  homes: null,

  // ============================================================== the cast =====
  // dking_* is the pink dolphin elder with the trident, dfarm_* the dolphin
  // farmhand; Marlow keeps the anglerfish sheet he already had. All three are 4x4
  // sheets: 0-3 idle, 4-7 walking, 8-11 working, 12-15 the expressive row.
  CAST: {
    prof: {
      key: 'prof', name: 'Fintan', short: 'the elder', art: 'dking',
      h: 30, deckH: 44, faceR: true,
      idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], work: [8, 9, 10, 11], wave: [12, 13, 14, 15],
      crop: 'moon',
      loves: ['pearl', 'pearlPol', 'abalonePol', 'crystal', 'abalone'],
    },
    farmer: {
      key: 'farmer', name: 'Sprout', short: 'the farmhand', art: 'dfarm',
      h: 26, deckH: 38, faceR: true,
      idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], work: [8, 9, 10, 11], wave: [12, 13, 14, 15],
      crop: 'berry',
      loves: ['crop_berry_p', 'crop_gourd_p', 'crop_moon_p', 'crop_curl_p', 'crop_blade_p'],
    },
    angler: {
      key: 'angler', name: 'Marlow', short: 'the fisherman', art: 'angler',
      h: 28, deckH: 40, faceR: true,
      idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], work: [8, 9, 10, 11], wave: [12, 13],
      crop: 'blade',
      loves: ['roe', 'musselMeat', 'abalone', 'mussel', 'clamMeat'],
    },
  },

  // ============================================================== day plans ====
  // fromHour..toHour on the 24h face above; a slot may wrap past midnight. Every
  // plan tiles the whole day, and `where` names a place _target() understands:
  //   'home'  their own deck        'plot' their own planter
  //   'fish'  their fishing spot    'dock' the player's pier
  //   a home key ('lamp'|'cottage'|'shack') -- a neighbour's deck
  PLANS: {
    // The elder keeps a scholar's hours: up before the light to read his kelp,
    // out over the shelf while the water is bright, then a call at the pier.
    prof: [
      { fromHour: 22, toHour: 5, act: 'sleep', where: 'home' },
      { fromHour: 5, toHour: 8, act: 'tend', where: 'plot' },
      { fromHour: 8, toHour: 12, act: 'fish', where: 'fish' },
      { fromHour: 12, toHour: 15, act: 'dock', where: 'dock' },
      { fromHour: 15, toHour: 18, act: 'visit', where: 'cottage' },
      { fromHour: 18, toHour: 20, act: 'tend', where: 'plot' },
      { fromHour: 20, toHour: 22, act: 'drift', where: 'home' },
    ],
    // The farmhand is a morning worker and an early night.
    farmer: [
      { fromHour: 21, toHour: 6, act: 'sleep', where: 'home' },
      { fromHour: 6, toHour: 10, act: 'tend', where: 'plot' },
      { fromHour: 10, toHour: 13, act: 'dock', where: 'dock' },
      { fromHour: 13, toHour: 16, act: 'fish', where: 'fish' },
      { fromHour: 16, toHour: 19, act: 'visit', where: 'shack' },
      { fromHour: 19, toHour: 21, act: 'drift', where: 'home' },
    ],
    // An anglerfish works the dark. He is on his lines at 2am and asleep at 6.
    angler: [
      { fromHour: 0, toHour: 4, act: 'fish', where: 'fish' },
      { fromHour: 4, toHour: 9, act: 'sleep', where: 'home' },
      { fromHour: 9, toHour: 11, act: 'tend', where: 'plot' },
      { fromHour: 11, toHour: 14, act: 'fish', where: 'fish' },
      { fromHour: 14, toHour: 17, act: 'visit', where: 'lamp' },
      { fromHour: 17, toHour: 20, act: 'dock', where: 'dock' },
      { fromHour: 20, toHour: 24, act: 'drift', where: 'home' },
    ],
  },

  // ============================================================== the words ====
  // Situational copy, indexed the same way the agent is: by what they are doing,
  // by mood, and by what the memory holds. Every pool has several entries and the
  // composer refuses to repeat the line it said last time, so the same encounter
  // twice running never reads the same.
  SAY: {
    prof: {
      hello: {
        dawn: ['Up with the grey light too, I see.', 'The water is honest at this hour. Morning.'],
        day: ['Ah -- Otto. Good. I was hoping for a second opinion.', 'Otto! Mind the current, it sets east today.'],
        dusk: ['Evening. The lamp wants lighting soon.', 'Dusk already. Where does a day go.'],
        night: ['Late for a swim, even for you.', 'Careful out here in the dark, lad.'],
      },
      act: {
        sleep: ['You have caught me half asleep on my own porch.', 'Mmh. I was dreaming of a very large whale.'],
        tend: ['Moonbloom is a fussy tenant. Water, dark, patience.', 'My kelp reading-garden. Nothing rushes it.'],
        fish: ['I am not fishing, I am LISTENING. There is a difference.',
          'Whale song, two ridges out. Hold still a moment.'],
        visit: ['Just paying a call. One should.', 'A neighbour is a library you can argue with.'],
        dock: ['I came down to your pier. Fine planks, terrible coffee.',
          'Your dock is the best listening post on this coast.'],
        drift: ['Drifting home. The lamp will not light itself.', 'Homeward. My chair is expecting me.'],
        travel: ['On my way -- talk and swim, I can manage both.',
          'Do not let me stop, I am late for my own schedule.'],
      },
      mood: {
        delighted: ['Is that -- may I see it? Closer. CLOSER.', 'You are carrying something remarkable and you know it.'],
        worried: ['My planter has gone dry and I am not there. Bother.', 'Dry soil at home. I can feel it from here.'],
        grumpy: ['Water is cold, hour is wrong, back aches. Otherwise splendid.',
          'At my age one is allowed to be short about the dark.'],
        pleased: ['I am always glad it is you.', 'You have become good company, you know.'],
        plain: ['Well. Ask me something.', 'Mm. Go on then.'],
      },
      again: ['We spoke already. I have not run out of words.',
        'Twice in a day. I shall start charging tuition.',
        'Back so soon? Good.'],
      recall: ['Still turning over %t%, if you want the truth.',
        'I have thought more about %t%. I was right.',
        'That business of %t% will not leave me alone.'],
      sawAct: ['Last time you found me %p%. Today, as you see, otherwise.',
        'You caught me %p% when we last met. Life moves.'],
      sawCarry: ['You had %i% on you last time. Did it find a buyer?',
        'Last we met you were hauling %i%. Well?'],
      door: ['Come in, come in -- mind the charts.', 'The door is open. The kettle is a rumour.'],
      asleep: ['...mmh. The lamp is lit. Go away.', 'A civilised creature knocks at NOON.'],
      note: 'Note on the door, in a very neat hand: "%w%"',
      thanks: ['You watered it. That is -- genuinely kind.', 'My moonbloom thanks you. So do I.'],
    },
    farmer: {
      hello: {
        dawn: ['Morning! Best part of the day, this.', 'Up early! Good, good.'],
        day: ['Otto! Hello hello.', 'There you are. Was just thinking about you.'],
        dusk: ['Evening! Nearly done for the day.', "Look at that sky. Worth the aching back."],
        night: ['Oh -- hello. I should be in bed.', 'Shh. Everything is asleep except us.'],
      },
      act: {
        sleep: ['Mmf. Is it morning? It is not morning.', 'Five more minutes. Five.'],
        tend: ['Tide berries! Look at them. LOOK at them.', 'Just watering. It is the whole job, really.'],
        fish: ['Fishing badly, but fishing.', 'Marlow says I hold the line wrong. Marlow is right.'],
        visit: ['Off visiting. It is nice to be nosy.', 'Bringing someone a berry. That is the errand.'],
        dock: ['Came to see your beds! Yours are tidier than mine.',
          'Your dock always smells of good work.'],
        drift: ['Heading home. Supper, then sleep.', 'Home! My cottage, my kettle, my bed.'],
        travel: ['Swim with me a bit? I am going that way anyway.',
          'Do not mind me, I am mid-errand.'],
      },
      mood: {
        delighted: ['Oh! Oh that is one of MINE. Is that for me?',
          'You are carrying exactly the thing I like best.'],
        worried: ['My planter is thirsty and I am out here. I am a fraud.',
          'Dry soil, dry soil, dry soil. I keep thinking about it.'],
        grumpy: ['Wet, dark and I have lost a glove. Sorry.', 'Ignore me, I am in a mood the weather made.'],
        pleased: ['You are my favourite neighbour, do not tell the others.',
          'It is a better day when you turn up.'],
        plain: ['So! What is the news.', 'Anyway. You.'],
      },
      again: ['Twice! I do not mind twice.', 'Hello again -- still me.', 'Back for more chat? Fine by me.'],
      recall: ['I am still on about %t%, sorry.', 'Been thinking about %t% all morning.',
        'That thing about %t% -- I have decided how I feel.'],
      sawAct: ['Last time you found me %p%. Busy life, mine.',
        'You caught me %p% before, did you not?'],
      sawCarry: ['You had %i% last time! Did you keep it?', 'Still got that %i%?'],
      door: ['It is open! It is always open.', 'Come in, mind the seed trays.'],
      asleep: ['...zzz... go away nicely...', 'Mmf! Knocking! At THIS hour!'],
      note: 'A note pinned crooked to the door: "%w%"',
      thanks: ['You watered my planter! You wonderful creature.', 'Oh you DID it. Thank you, truly.'],
    },
    angler: {
      hello: {
        dawn: ['Grey light. Fish bite. Morning.', 'Early. Good. Fewer fools about.'],
        day: ['Otto. Water is warm and the fish are lazy.', 'Hah. The clam boy.'],
        dusk: ['Best hour coming up. Watch and learn.', 'Evening. Now it gets interesting.'],
        night: ['Now you are talking. Night is for working.', 'Dark suits me. Suits you too, apparently.'],
      },
      act: {
        sleep: ['...you woke me. In the daylight. On purpose.', 'Fish sleep in the day. So do I.'],
        tend: ['Kelp blades. Cheap, quick, keeps the pot full.', 'Weeding. Do not laugh.'],
        fish: ['Lines are out. Do not thrash about.', 'Been on this spot forty years. It still surprises me.'],
        visit: ['Going to bore the professor for an hour.', 'Off to see a neighbour. Do not tell anyone I am sociable.'],
        dock: ['Tied up at your pier. Your knots are improving.',
          'Came to look at your pilings. They will hold. Probably.'],
        drift: ['Heading in. Lean-to, stove, silence.', 'Home. It leaks. I like it.'],
        travel: ['Swimming. Talk if you must.', 'Keep up, then.'],
      },
      mood: {
        delighted: ['Now THAT is worth stopping for. Let me see.', 'You are carrying my supper and you do not know it.'],
        worried: ['Left my blades dry. Serves me right.', 'Soil at home is dust. I know it. I am here anyway.'],
        grumpy: ['Cold, wet, late. Say your piece.', 'I am old and the water is rude tonight.'],
        pleased: ['You have grown on me, boy. Like barnacles.', 'Good to see you. There, I said it.'],
        plain: ['Well?', 'Speak up.'],
      },
      again: ['Said my words already.', 'Again? Fine. I have more.', 'You are persistent. I respect it.'],
      recall: ['Still chewing on %t%.', 'I gave %t% some more thought. Did not help.',
        'That %t% business. Hm.'],
      sawAct: ['Last time you found me %p%. Not today.', 'Caught me %p% before. Better hour, that.'],
      sawCarry: ['You had %i% on you. Should have sold it to me.', 'Last time: %i%. I remember cargo.'],
      door: ['It is not locked. Nothing worth taking.', 'Push. It sticks.'],
      asleep: ['...knock again and I will use the gaff...', 'Daylight. Sleeping. Work it out.'],
      note: 'Chalked on the door: "%w%"',
      thanks: ['You watered my blades. Hmph. Decent of you.', 'Aye. Thanks. Do not make a thing of it.'],
    },
  },

  // How an activity reads in the third person -- used for door notes and for the
  // "what you were doing when we last met" memory line.
  DOING: {
    sleep: 'asleep at home', fish: 'out on the fishing marks', tend: 'tending the planter',
    visit: 'round at a neighbour', dock: "down at Otto's pier", drift: 'pottering at home',
    travel: 'swimming somewhere else',
  },
  NOTES: {
    sleep: 'Asleep. Knock only if it is on fire.',
    fish: 'Gone fishing. Back when the light goes.',
    tend: 'Out at the planter. Shout.',
    visit: 'Gone next door. Help yourself to nothing.',
    dock: "Down at Otto's pier. Back later.",
    drift: 'Somewhere on the deck. Look harder.',
    travel: 'Out. Genuinely out.',
  },

  // ============================================================== live state ===
  agents: null,
  _wakes: null, _wi: 0,
  time: 0,
  _stamp: -1, _installed: false, _booted: false, _touchHooked: false,
  _cobj: null,                     // identity of the G.hood we normalised
  // ocean-side interaction
  _reach: null, _reachKind: '',    // what [E] would do right now: 'climb' | 'talk'
  _talking: '',                    // resident whose delegated dialogue is open
  // deck scene
  px: 240, dir: -1, walkT: 0, idleT: 0, dtime: 0,
  home: null, resident: null,
  _ret: { x: 0, y: 20 },
  _resume: null,                   // bag/position stash for the swim back
  _carrySrc: null, _carryStamp: -1,
  _spots: null, _present: null, _spotObjs: null, _lovesCache: null,
  _noSpots: [],                    // shared empty result; never written to

  // =============================================================================
  // SAVE STATE
  // =============================================================================
  // G.hood is a brand new top-level key and Game.load only deep-merges five
  // (storage, gear, stats, flags, decor), so every field is re-typed here and
  // ensure() runs at the top of every public entry point. Positions are
  // deliberately NOT persisted: they are a pure function of the plan and the
  // clock, so _snap() can put everybody exactly where they belong on load.
  ensure: function () {
    if (typeof G === 'undefined' || !G) return false;
    var s = G.hood;
    if (!s || typeof s !== 'object') s = G.hood = {};
    if (s === this._cobj && this._booted) return true;   // fast path: same object

    if (typeof s.lastDay !== 'number' || !isFinite(s.lastDay)) s.lastDay = G.day || 1;
    s.lastDay = Math.floor(s.lastDay);
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    if (!s.who || typeof s.who !== 'object') s.who = {};
    if (!s.plots || typeof s.plots !== 'object') s.plots = {};

    var i, k;
    for (i = 0; i < this.HOMES.length; i++) {
      var hm = this.HOMES[i];
      s.seen[hm.key] = !!s.seen[hm.key];
      var p = s.plots[hm.key];
      if (!p || typeof p !== 'object') p = s.plots[hm.key] = {};
      var cast = this.CAST[hm.who];
      p.crop = this._cropKey(p.crop, cast ? cast.crop : 'blade');
      p.stage = Math.floor(clamp(typeof p.stage === 'number' && isFinite(p.stage) ? p.stage : 0, 0, 2));
      p.days = Math.floor(clamp(typeof p.days === 'number' && isFinite(p.days) ? p.days : 0, 0, 99));
      p.water = clamp(typeof p.water === 'number' && isFinite(p.water) ? p.water : 1, 0, 1);
      p.dry = Math.floor(clamp(typeof p.dry === 'number' && isFinite(p.dry) ? p.dry : 0, 0, 9));
      p.tendDay = Math.floor(typeof p.tendDay === 'number' && isFinite(p.tendDay) ? p.tendDay : 0);
    }
    for (k in this.CAST) {
      if (!Object.prototype.hasOwnProperty.call(this.CAST, k)) continue;
      var m = s.who[k];
      if (!m || typeof m !== 'object') m = s.who[k] = {};
      m.greetDay = Math.floor(typeof m.greetDay === 'number' && isFinite(m.greetDay) ? m.greetDay : 0);
      m.knockDay = Math.floor(typeof m.knockDay === 'number' && isFinite(m.knockDay) ? m.knockDay : 0);
      m.waterDay = Math.floor(typeof m.waterDay === 'number' && isFinite(m.waterDay) ? m.waterDay : 0);
      m.visits = Math.floor(clamp(typeof m.visits === 'number' && isFinite(m.visits) ? m.visits : 0, 0, 99999));
      m.meets = Math.floor(clamp(typeof m.meets === 'number' && isFinite(m.meets) ? m.meets : 0, 0, 99999));
      m.topic = typeof m.topic === 'string' ? m.topic.slice(0, 40) : '';
      m.lastAct = typeof m.lastAct === 'string' ? m.lastAct.slice(0, 12) : '';
      m.carry = typeof m.carry === 'string' ? m.carry.slice(0, 24) : '';
      m.lastLine = typeof m.lastLine === 'string' ? m.lastLine.slice(0, 160) : '';
    }
    this._cobj = s;
    this._boot();
    // A different G.hood object means a load, or a new game: nobody's remembered
    // position means anything any more, so put everybody where the clock says
    // they are instead of letting them swim in from wherever they were.
    this._snap();
    return true;
  },

  _cropKey: function (want, fallback) {
    var list = (typeof Farm !== 'undefined' && Farm && Farm.ORDER && Farm.ORDER.length)
      ? Farm.ORDER : ['blade', 'curl', 'berry', 'gourd', 'moon'];
    if (typeof want === 'string' && list.indexOf(want) >= 0) return want;
    if (list.indexOf(fallback) >= 0) return fallback;
    return list[0];
  },

  // One-time build of the live objects. Pools are allocated here and recycled
  // forever after; the steady state allocates nothing.
  _boot: function () {
    if (this._booted) return;
    this._booted = true;
    this.homes = this.HOMES;
    var i;
    this.agents = [];
    for (i = 0; i < this.HOMES.length; i++) {
      var hm = this.HOMES[i];
      var cast = this.CAST[hm.who];
      if (!cast) continue;
      this.agents.push({
        key: hm.who, cast: cast, homeI: i,
        x: hm.x, y: hm.deckY, vx: 0, vy: 0, face: 1,
        act: 'drift', slot: null, arrived: true, climbing: false,
        tx: hm.x, ty: hm.deckY,
        animT: rand(0, 3), ph: rand(0, TAU), bob: 0,
        holdT: 0, workT: 0,
        say: null, sayT: 0, mood: 'plain',
        toldDay: -1,                 // last day we toasted their arrival at the pier
      });
    }
    this._wakes = [];
    for (i = 0; i < this.WAKE_MAX; i++) this._wakes.push({ t: 0, x: 0, y: 0, vx: 0, vy: 0, r: 1, warm: false });

    // The deck's spot list, built ONCE. spots() runs two or three times a frame
    // (the [E] search, the prompt, and any wrapper), so it refills these in place
    // rather than handing back five fresh closures every time.
    var self = this;
    this._spots = [];
    this._present = [];
    this._spotObjs = {
      res: [
        { x: 0, label: '', act: function () { self.meet(self._present[0]); } },
        { x: 0, label: '', act: function () { self.meet(self._present[1]); } },
        { x: 0, label: '', act: function () { self.meet(self._present[2]); } },
      ],
      door: { x: 0, label: '', act: function () { self.knock(); } },
      plot: { x: 0, label: '', act: function () { self.waterPlot(); } },
      prop: { x: 0, label: '', act: function () { self.poke(); } },
      exit: { x: 0, label: '', act: function () { self.leave(); } },
    };
    // merged love lists, resolved once: npc.js's adore+loved concat would
    // otherwise allocate on every mood check, which is every agent every frame
    this._lovesCache = null;
  },

  // Called from js/integrate.js on Ocean.enter. The seed only phases the idle
  // animation -- where anybody IS comes from the clock, so entering the water
  // never shuffles the neighbourhood.
  reset: function (seed) {
    if (!this.ensure()) return;
    var rng = mulberry32((seed | 0) || 1);
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      a.ph = rng() * TAU;
      a.animT = rng() * 3;
    }
    for (var j = 0; j < this._wakes.length; j++) this._wakes[j].t = 0;
    this._snap();
  },

  // Nightly bookkeeping. Two independent code paths bump G.day and only sleeping
  // fires the hooks, so this catches up off its own persisted lastDay -- the same
  // contract Farm, Ocean, Mining and Inv all use. Idempotent per calendar day.
  newDay: function () {
    if (!this.ensure()) return;
    var s = G.hood;
    var guard = 0;
    while (s.lastDay < G.day && guard++ < 30) {
      s.lastDay++;
      this._night();
    }
    if (s.lastDay > G.day) s.lastDay = G.day;
  },

  _night: function () {
    var s = G.hood;
    for (var i = 0; i < this.HOMES.length; i++) {
      var hm = this.HOMES[i];
      var p = s.plots[hm.key];
      // Whether the resident got to their planter yesterday is the whole
      // simulation: a watered night grows the crop, a missed one dries it out, and
      // a dry planter is what puts its owner in a mood the next morning.
      if (p.water > 0.4) {
        p.days++;
        p.dry = 0;
        if (p.days >= 3 && p.stage < 2) { p.stage++; p.days = 0; }
        // ripe and looked after: the owner lifts it and starts again. Their crop
        // is scenery with a life, not a bed the player can harvest.
        else if (p.stage >= 2 && p.days >= 2) { p.stage = 0; p.days = 0; }
      } else if (p.dry < 9) {
        // clamped at the same ceiling ensure() enforces: an unvisited planter must
        // not grow an unbounded number in the save file
        p.dry++;
      }
      p.water = 0;                 // the sun takes it back every night
    }
    // Greetings, gifts and door-knocks all come round again with the date; the
    // per-day flags are compared against G.day so nothing to clear here.
    this._snap();
  },

  // =============================================================================
  // THE CLOCK AND THE PLAN
  // =============================================================================
  hour: function () {
    if (typeof G === 'undefined' || !G) return 10;
    var c = clamp(typeof G.clock === 'number' && isFinite(G.clock) ? G.clock : 0.3, 0, 1);
    var A = this.HOUR_ANCHORS;
    var h = A[A.length - 1][1];
    for (var i = 1; i < A.length; i++) {
      if (c <= A[i][0]) {
        var t = (c - A[i - 1][0]) / (A[i][0] - A[i - 1][0]);
        h = lerp(A[i - 1][1], A[i][1], t);
        break;
      }
    }
    while (h >= 24) h -= 24;
    while (h < 0) h += 24;
    return h;
  },

  timeOfDay: function () {
    var h = this.hour();
    if (h >= 4.5 && h < 8) return 'dawn';
    if (h >= 8 && h < 17.5) return 'day';
    if (h >= 17.5 && h < 21) return 'dusk';
    return 'night';
  },

  // A slot may wrap past midnight (fromHour > toHour), which is how anybody gets
  // to sleep through the small hours.
  slotFor: function (key, hour) {
    var plan = this.PLANS[key];
    if (!plan || !plan.length) return null;
    for (var i = 0; i < plan.length; i++) {
      var s = plan[i];
      if (s.fromHour <= s.toHour) {
        if (hour >= s.fromHour && hour < s.toHour) return s;
      } else if (hour >= s.fromHour || hour < s.toHour) return s;
    }
    return plan[0];
  },

  // Where a `where` token lands, in world coordinates. Everything above the
  // waterline is a deck, and a deck is reached by the ladder, so those targets
  // come back flagged `up`.
  _target: function (a, where, out) {
    var hm = this.HOMES[a.homeI];
    if (where === 'fish') { out.x = hm.fish.x; out.y = hm.fish.y; out.up = false; return out; }
    if (where === 'dock') { out.x = this.DOCK_AT.x; out.y = this.DOCK_AT.y; out.up = false; return out; }
    var tgt = hm;
    if (where !== 'home' && where !== 'plot') {
      var other = this.homeByKey(where);
      if (other) tgt = other;
    }
    if (where === 'plot') { out.x = tgt.x + tgt.plotDX; out.y = tgt.deckY; out.up = true; return out; }
    // standing on somebody's deck: their side of it, so two residents visiting
    // the same house do not occupy the same plank
    out.x = tgt.x + (tgt === hm ? tgt.doorDX * 1.6 : -tgt.doorDX * 1.4);
    out.y = tgt.deckY;
    out.up = true;
    return out;
  },

  _tmp: { x: 0, y: 0, up: false },

  homeByKey: function (key) {
    for (var i = 0; i < this.HOMES.length; i++) if (this.HOMES[i].key === key) return this.HOMES[i];
    return null;
  },
  homeOf: function (who) {
    for (var i = 0; i < this.HOMES.length; i++) if (this.HOMES[i].who === who) return this.HOMES[i];
    return null;
  },
  agentOf: function (who) {
    if (!this.agents) return null;
    for (var i = 0; i < this.agents.length; i++) if (this.agents[i].key === who) return this.agents[i];
    return null;
  },
  plotOf: function (homeKey) {
    if (!this.ensure()) return null;
    return G.hood.plots[homeKey] || null;
  },
  memOf: function (who) {
    if (!this.ensure()) return null;
    return G.hood.who[who] || null;
  },

  // Teleport everybody to where their plan says they are. Used on load, on reset
  // and after a night, so a player who closes the tab for a week does not come
  // back to three dolphins mid-ocean swimming the wrong way.
  _snap: function () {
    if (!this.agents) return;
    var hour = this.hour();
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      var s = this.slotFor(a.key, hour);
      a.slot = s;
      a.act = s ? s.act : 'drift';
      var t = this._target(a, s ? s.where : 'home', this._tmp);
      a.x = t.x; a.y = t.y; a.tx = t.x; a.ty = t.y;
      a.vx = 0; a.vy = 0;
      a.arrived = true; a.climbing = false;
      a.holdT = 0; a.sayT = 0; a.say = null;
    }
  },

  // =============================================================================
  // MOOD -- read off the world, never rolled
  // =============================================================================
  // Rain is asked for through a guarded read so a weather system dropped in later
  // is honoured without touching this file; with none loaded it is simply never
  // raining and the small hours carry the grumpiness on their own.
  raining: function () {
    if (typeof SKY !== 'undefined' && SKY && SKY.rain) return true;
    if (typeof G !== 'undefined' && G && G.weather === 'rain') return true;
    return false;
  },

  hearts: function (who) {
    if (typeof NPCs !== 'undefined' && NPCs && NPCs.hearts) {
      var h = NPCs.hearts(who);
      if (typeof h === 'number' && isFinite(h)) return h;
    }
    var m = this.memOf(who);
    return m ? Math.min(10, Math.floor(m.meets / 3)) : 0;
  },

  // What the player is holding right now, in whichever pocket the current scene
  // fills: the swim bag out in the water, flat storage on the planks. The source
  // is looked up once per frame and then only read, so this costs a handful of
  // property lookups per agent.
  _carry: function () {
    var stamp = (typeof Game !== 'undefined') ? Game.time : this.time;
    if (this._carryStamp === stamp) return this._carrySrc;
    this._carryStamp = stamp;
    var src = null;
    var scene = (typeof Game !== 'undefined') ? Game.scene : null;
    if (typeof Ocean !== 'undefined' && Ocean && Ocean.bag && scene === Ocean) src = Ocean.bag;
    // up on somebody's porch he is still holding the haul he climbed out with
    else if (scene === this && this._resume && this._resume.bag) src = this._resume.bag;
    if (!src && typeof G !== 'undefined' && G) src = G.storage;
    this._carrySrc = src || null;
    return this._carrySrc;
  },

  // Two different questions, deliberately separate.
  //
  // lovedOn  -- are you carrying a thing THIS PERSON loves? That is what makes
  //             them delighted, because the mood line is "that is one of MINE".
  // notableOn-- would they clock it at all? Their loves, or anything precious
  //             enough that a stranger would look twice. That is what the memory
  //             records, so "you had a pearl on you last time" works for everyone.
  PRECIOUS: ['pearlPol', 'pearl', 'abalonePol', 'crystal', 'lens', 'ingot'],

  lovedOn: function (who) {
    var src = this._carry();
    if (!src) return '';
    var loves = this._loves(who);
    for (var i = 0; i < loves.length; i++) if (src[loves[i]] > 0) return loves[i];
    return '';
  },

  notableOn: function (who) {
    var got = this.lovedOn(who);
    if (got) return got;
    var src = this._carry();
    if (!src) return '';
    for (var i = 0; i < this.PRECIOUS.length; i++) if (src[this.PRECIOUS[i]] > 0) return this.PRECIOUS[i];
    return '';
  },

  // Resolved once and cached: this is read for every agent on every frame, and
  // npc.js's adore list has to be merged with its loved list to get the order
  // right -- doing that with concat() per call would allocate three arrays a frame
  // forever, which is exactly the thing the budget rules forbid.
  _loves: function (who) {
    var cache = this._lovesCache;
    if (!cache) cache = this._lovesCache = {};
    var got = cache[who];
    if (got) return got;
    var out = null;
    if (typeof NPCs !== 'undefined' && NPCs && NPCs.byKey) {
      var n = NPCs.byKey(who);
      if (n) {
        // adore beats loved beats liked, and npc.js already keeps them in that order
        if (n.adore && n.adore.length) out = n.adore.concat(n.loved || []);
        else if (n.loved && n.loved.length) out = n.loved;
      }
    }
    if (!out) {
      var c = this.CAST[who];
      out = (c && c.loves) || [];
    }
    cache[who] = out;
    return out;
  },

  itemName: function (key) {
    if (typeof ITEMS !== 'undefined' && ITEMS && ITEMS[key] && ITEMS[key].name) return ITEMS[key].name;
    if (typeof NPC_ITEM_NAMES !== 'undefined' && NPC_ITEM_NAMES && NPC_ITEM_NAMES[key]) return NPC_ITEM_NAMES[key];
    if (typeof Inv !== 'undefined' && Inv && Inv.name) {
      var n = Inv.name(key);
      if (n && n !== key) return n;
    }
    return key;
  },

  // Priority, most specific first. Everything here is a fact about the world:
  // what you are carrying, how dry their soil is, what hour it is, how you stand
  // with them.
  moodOf: function (a) {
    // delighted is for THEIR treasure, not any treasure
    if (this.lovedOn(a.key)) return 'delighted';
    var hm = this.HOMES[a.homeI];
    var p = this.plotOf(hm.key);
    if (p && (p.dry > 0 || (p.water < 0.35 && a.act !== 'tend'))) return 'worried';
    var h = this.hour();
    if (this.raining() || h >= 22.5 || h < 4.5) return 'grumpy';
    if (this.hearts(a.key) >= 5) return 'pleased';
    return 'plain';
  },

  // =============================================================================
  // UPDATE -- one entry point, two jobs
  // =============================================================================
  // This is both the module's tick (hooked into Game.globalUpdate so the schedules
  // run in every scene) AND the scene update for the deck, because a scene's
  // update() is called by name. Whoever gets here first in a frame does the work;
  // Game.time advances exactly once per frame.
  update: function (dt) {
    if (!this.ensure()) return;
    if (typeof Game !== 'undefined') {
      if (Game.time === this._stamp) return;
      this._stamp = Game.time;
    }
    if (dt > 0.05) dt = 0.05;
    // the touch pads hook themselves on the first frame -- see _hookTouch for why
    // it cannot happen at load time
    if (!this._touchHooked) this._hookTouch();
    this.time += dt;
    if (G.hood.lastDay < G.day) this.newDay();

    // the delegated dialogue closing is what releases the ocean again
    if (this._talking && !(typeof NPCs !== 'undefined' && NPCs && NPCs.open)) this._talking = '';

    var frozen = this.dialogueUp();
    this._tickAgents(frozen ? 0 : dt);
    this._tickWakes(frozen ? 0 : dt);

    var onDeck = (typeof Game !== 'undefined' && Game.scene === this);
    if (onDeck) this._deckUpdate(dt);
    else this._oceanUpdate(dt);
  },

  // True while a conversation this module started owns the screen. Ocean freezes
  // itself against this in install(); npc.js only knows how to freeze the dock.
  dialogueUp: function () {
    return !!(this._talking && typeof NPCs !== 'undefined' && NPCs && NPCs.open);
  },

  // The canonical peer-modal guard. A borrowed-slot panel (Skills, Inv, ...) can
  // open over this scene without knowing it exists, so the deck must stop walking
  // and stop eating [E] whenever one of them is up.
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

  // ---- the agents -------------------------------------------------------------
  _tickAgents: function (dt) {
    var hour = this.hour();
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      a.animT += dt;
      a.bob = Math.sin(this.time * 1.5 + a.ph);
      if (a.sayT > 0) a.sayT -= dt;
      if (a.holdT > 0) a.holdT -= dt;
      a.mood = this.moodOf(a);

      // ---- the plan decides where, always
      var slot = this.slotFor(a.key, hour);
      if (slot !== a.slot) {
        a.slot = slot;
        a.act = slot.act;
        a.arrived = false;
        a.climbing = false;
        this._announce(a, slot);
      }
      var t = this._target(a, slot ? slot.where : 'home', this._tmp);
      a.tx = t.x; a.ty = t.y;

      if (dt <= 0) continue;
      if (a.holdT > 0) { a.vx *= Math.pow(0.02, dt); a.vy *= Math.pow(0.02, dt); continue; }

      this._travel(a, t, dt);
      if (a.arrived) this._doActivity(a, dt);
    }
  },

  // Real travel, on a line the player can cut across. A deck target is reached in
  // two legs: swim to the water under the ladder, then climb. That is what makes
  // "he is on his way home" something you can actually intercept.
  _travel: function (a, t, dt) {
    var dx = t.x - a.x, dy = t.y - a.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d <= this.ARRIVE) {
      if (!a.arrived) { a.arrived = true; a.workT = 0; }
      a.vx *= Math.pow(0.05, dt); a.vy *= Math.pow(0.05, dt);
      a.x += a.vx * dt; a.y += a.vy * dt;
      return;
    }
    a.arrived = false;

    // Waypoint. A deck is only reachable up its own ladder, so anybody heading
    // for one swims to the water underneath it first and climbs the last leg --
    // which is what leaves them out in the open, crossing the map, where the
    // player can cut them off.
    var wx = t.x, wy = t.y;
    a.climbing = false;
    if (t.up && Math.abs(a.x - t.x) > 20) wy = 14;   // still travelling: stay wet
    else if (t.up) a.climbing = true;

    var sp = a.climbing ? this.CLIMB_SPEED : this.SWIM;
    var vdx = wx - a.x, vdy = wy - a.y;
    var vd = Math.sqrt(vdx * vdx + vdy * vdy) || 1;
    var wantX = vdx / vd * sp, wantY = vdy / vd * sp;
    // a swimmer has mass: steer toward the wanted velocity instead of snapping
    var k = clamp(dt * (a.climbing ? 8 : 3.4), 0, 1);
    a.vx = lerp(a.vx, wantX, k);
    a.vy = lerp(a.vy, wantY, k);
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    if (a.vx > 4) a.face = 1; else if (a.vx < -4) a.face = -1;

    // No swimming through the sky: nothing rises above the deck it is climbing
    // to. Clamping against their OWN deck would strand a visitor whose host sits
    // higher up, so the ceiling is whichever of the two is further up.
    var ceil = this.HOMES[a.homeI].deckY;
    if (t.up && t.y < ceil) ceil = t.y;
    if (a.y < ceil) a.y = ceil;
    if (!a.climbing && !t.up && a.y < 2) a.y = 2;

    // a wake, but only while actually swimming
    if (a.y > 3 && (a.vx * a.vx + a.vy * a.vy) > 900 && Math.random() < dt * 14) {
      this._wake(a.x - a.face * 8, a.y + rand(-4, 4), -a.vx * 0.16, -a.vy * 0.16, false);
    }
  },

  // Standing in the right place, doing the thing. Tending is the one activity with
  // a consequence: it waters their planter, which is what keeps `worried` honest.
  _doActivity: function (a, dt) {
    a.workT += dt;
    if (a.act === 'tend') {
      var hm = this.HOMES[a.homeI];
      var p = this.plotOf(hm.key);
      if (p && a.workT > 1.6 && p.water < 1) {
        p.water = 1;
        p.dry = 0;                 // they have dealt with it, so the worry lifts
        p.tendDay = G.day;
        if (Math.random() < 0.5) this._wake(a.x + a.face * 6, a.y + 4, 0, -10, true);
      }
    } else if (a.act === 'fish' && a.y > 3 && Math.random() < dt * 1.2) {
      this._wake(a.x + rand(-6, 6), a.y - rand(2, 8), 0, -14, false);
    }
  },

  // A neighbour turning up at the player's pier is worth saying out loud -- it is
  // the cheapest possible window onto a simulation the player cannot see.
  _announce: function (a, slot) {
    if (!slot || slot.act !== 'dock') return;
    if (a.toldDay === G.day) return;
    a.toldDay = G.day;
    if (typeof Game === 'undefined' || !Game.toast) return;
    if (typeof G.hood.seen === 'object' && !G.hood.seen[this.HOMES[a.homeI].key]) return;  // not met yet
    Game.toast(a.cast.name + ' is heading over to your pier.');
  },

  // ---- the wake pool ----------------------------------------------------------
  _wake: function (x, y, vx, vy, warm) {
    var p = this._wakes[this._wi];
    this._wi = (this._wi + 1) % this._wakes.length;
    p.t = rand(0.5, 1.1); p.x = x; p.y = y;
    p.vx = vx + rand(-6, 6); p.vy = vy + rand(-14, -4);
    p.r = rand(0.8, 2.1); p.warm = !!warm;
  },

  _tickWakes: function (dt) {
    if (dt <= 0) return;
    for (var i = 0; i < this._wakes.length; i++) {
      var p = this._wakes[i];
      if (p.t <= 0) continue;
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.5, dt);
    }
  },

  // =============================================================================
  // OUT IN THE WATER: reach, climb, and stopping somebody mid-swim
  // =============================================================================
  // The home in reach of a climb, or null. Public, so the ocean scene (or a
  // tutorial, or a favour) can ask without knowing the geometry.
  climbAt: function (px, py) {
    if (!this.ensure()) return null;
    if (py < this.CLIMB_TOP || py > this.CLIMB_BOT) return null;
    var best = null, bd = this.CLIMB_R;
    for (var i = 0; i < this.HOMES.length; i++) {
      var hm = this.HOMES[i];
      var d = Math.abs(px - (hm.x + hm.climbDX));
      if (d < bd) { bd = d; best = hm; }
    }
    return best;
  },

  // The resident close enough to talk to out in the water. Anyone standing on a
  // deck is excluded: you visit those, you do not shout up at them.
  agentAt: function (px, py) {
    if (!this.ensure()) return null;
    var best = null, bd = this.TALK_R;
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      if (a.y < -2) continue;
      var dx = a.x - px, dy = a.y - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  },

  // Per-frame probe while the ocean has the screen: work out what [E] would do,
  // hand out the discovery toast, then honour the key.
  _oceanUpdate: function (dt) {
    this._reach = null; this._reachKind = '';
    if (typeof Ocean === 'undefined' || typeof Game === 'undefined') return;
    if (Game.scene !== Ocean) return;
    if (Ocean.over || Ocean.leaving) return;

    var px = Ocean.px, py = Ocean.py;

    // discovery: swim within a screen of a home and it goes on the record
    for (var i = 0; i < this.HOMES.length; i++) {
      var hm = this.HOMES[i];
      if (G.hood.seen[hm.key]) continue;
      if (Math.abs(px - hm.x) > 190) continue;
      if (py > 270) continue;                 // swimming under it in the dark is not finding it
      G.hood.seen[hm.key] = true;
      if (typeof SND !== 'undefined' && SND.chime) SND.chime();
      Game.toast('You found ' + hm.name + ' -- ' + hm.of + '.');
      Game.toast('Swim to the ladder and press ' +
        ((typeof TouchUI !== 'undefined' && TouchUI.enabled) ? 'the climb pad' : '[E]') + ' to climb up.');
      Game.save();
    }

    var hmn = this.climbAt(px, py);
    var agn = this.agentAt(px, py);
    if (hmn && agn) {
      var dh = Math.abs(px - (hmn.x + hmn.climbDX));
      var da = Math.sqrt((agn.x - px) * (agn.x - px) + (agn.y - py) * (agn.y - py));
      if (da <= dh) hmn = null; else agn = null;
    }
    if (hmn) { this._reach = hmn; this._reachKind = 'climb'; }
    else if (agn) { this._reach = agn; this._reachKind = 'talk'; }

    if (Game.fadeDir !== 0 || this._peerOpen()) return;
    if (!this._reach) return;
    if (Input.p('KeyE')) {
      if (this._reachKind === 'climb') this.climb(this._reach);
      else this.meet(this._reach);
    }
  },

  // Lift Otto out of the water and onto that deck. Both halves of the contract
  // live here: called with a home while the scene is something else it starts the
  // transition, and Game.updateFade calls it again as the scene's own enter().
  enter: function (arg) {
    if (typeof Game === 'undefined') return;
    var home = this._resolveHome(arg);
    // Called as a REQUEST (Hood.enter(house) from anywhere) the scene is still
    // whatever it was, so start the transition; called as the SCENE's own enter,
    // Game.updateFade has already made us current, so do the setup.
    if (Game.scene !== this) { this.climb(home); return; }
    if (!this.ensure()) return;
    if (!home) home = this.HOMES[0];
    this.home = home;
    this.resident = this.agentOf(home.who);
    this.dtime = 0;
    this.walkT = 0; this.idleT = 0;
    // he comes up the ladder at the exit end and turns to face the deck
    this.px = this.EXIT_X - 14;
    this.dir = -1;
    if (typeof SND !== 'undefined') {
      if (SND.setScene) SND.setScene('surface');
      if (SND.splash) SND.splash();
    }
    var m = this.memOf(home.who);
    if (m) m.visits++;
    if (G.hood.seen) G.hood.seen[home.key] = true;
    Game.toast('You climb up onto ' + home.name + '.');
    if (!this.presentAt(home).length) Game.toast(this._nobodyHome(home));
    Game.save();
  },

  _resolveHome: function (arg) {
    if (!arg) return null;
    if (typeof arg === 'string') return this.homeByKey(arg);
    if (arg.key && this.homeByKey(arg.key)) return this.homeByKey(arg.key);
    if (arg.home) return this._resolveHome(arg.home);
    if (arg.who) return this.homeOf(arg.who);
    return null;
  },

  // Start the climb: remember the water we came out of (and the bag we came out
  // with -- Ocean.enter starts a fresh trip, so the haul has to be carried across
  // by hand) and hand over to the scene machinery.
  climb: function (home) {
    if (!this.ensure()) return;
    home = this._resolveHome(home) || home;
    if (!home || !home.key) return;
    if (typeof Game === 'undefined' || Game.fadeDir !== 0) return;
    var stash = null;
    if (typeof Ocean !== 'undefined' && Ocean && typeof Game !== 'undefined' && Game.scene === Ocean) {
      if (Ocean.over || Ocean.leaving) return;
      this._ret.x = Ocean.px;
      this._ret.y = Math.max(14, Ocean.py);
      stash = {
        bag: Ocean.bag, bagCount: Ocean.bagCount,
        x: this._ret.x, y: this._ret.y,
        air: Ocean.air, airMax: Ocean.airMax,
      };
    } else {
      this._ret.x = home.x + home.climbDX;
      this._ret.y = 22;
    }
    this._resume = stash;
    if (typeof SND !== 'undefined' && SND.thump) SND.thump(0.5);
    Game.go(this, home);
  },

  // Off the rail and back into the water exactly where we climbed in.
  leave: function () {
    if (typeof Game === 'undefined') return;
    if (typeof SND !== 'undefined' && SND.splash) SND.splash();
    if (typeof Ocean !== 'undefined') {
      Game.go(Ocean, { x: this._ret.x, y: Math.max(14, this._ret.y), from: 'hood' });
    } else {
      Game.go(WorldScene, {});
    }
  },

  // =============================================================================
  // MEETING SOMEBODY
  // =============================================================================
  // The situational half is ours; the friendship, the gifts and the box are
  // npc.js's. Both happen: the bubble says where they are and what they are
  // doing, then the dialogue opens on top of it.
  meet: function (a) {
    if (!this.ensure() || !a) return;
    var m = G.hood.who[a.key];
    if (!m) return;
    var line = this.compose(a);
    this.speak(a, line);
    a.holdT = this.HOLD_T;
    a.face = this._facePlayer(a);
    m.meets++;
    m.lastAct = a.act;
    m.carry = this.notableOn(a.key);
    m.greetDay = G.day;
    if (typeof SND !== 'undefined' && SND.blip) SND.blip();
    if (typeof NPCs !== 'undefined' && NPCs && NPCs.talk && NPCs.byKey && NPCs.byKey(a.key)) {
      this._talking = a.key;
      NPCs.talk(a.key);
    }
    Game.save();
  },

  _facePlayer: function (a) {
    var px = null;
    if (typeof Game !== 'undefined' && typeof Ocean !== 'undefined' && Game.scene === Ocean) px = Ocean.px;
    if (px === null) return a.face;
    return px >= a.x ? 1 : -1;
  },

  // Hang a speech bubble over them, in world space, wrapped by character count
  // (Courier is monospace at 0.6em, so measuring in a loop would be waste).
  speak: function (a, str) {
    if (!a) return;
    a.say = this._wrap(str, this.BUBBLE_COLS, this.BUBBLE_LINES);
    a.sayT = this.SAY_T;
  },

  _wrap: function (str, cols, maxLines) {
    var words = String(str).split(' ');
    var out = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!cur.length) { cur = w; continue; }
      if (cur.length + 1 + w.length <= cols) { cur += ' ' + w; continue; }
      out.push(cur); cur = w;
      if (out.length >= maxLines) break;
    }
    if (cur.length && out.length < maxLines) out.push(cur);
    if (out.length > maxLines) out.length = maxLines;
    if (!out.length) out.push('...');
    return out;
  },

  // ---- the composer -----------------------------------------------------------
  // Two sentences, both earned: an OPENER that depends on the memory (have we
  // spoken today, what were they doing last time, what were you carrying, what
  // were we talking about) and a SITUATIONAL half that depends on where they are,
  // what they are doing and the mood the world put them in. The result is
  // checked against the last thing they said and re-rolled if it matches.
  compose: function (a) {
    var S = this.SAY[a.key];
    if (!S) return '...';
    var m = G.hood.who[a.key];
    var best = '';
    for (var attempt = 0; attempt < 6; attempt++) {
      var line = this._composeOnce(a, S, m);
      if (!best) best = line;
      if (line !== m.lastLine) { best = line; break; }
    }
    m.lastLine = best;
    m.topic = this._topicFor(a);
    return best;
  },

  _composeOnce: function (a, S, m) {
    var parts = [];
    var greeted = m.greetDay === G.day;

    // ---- opener
    if (!greeted) {
      parts.push(pick(S.hello[this.timeOfDay()] || S.hello.day));
    } else {
      var pool = [];
      pool.push(pick(S.again));
      if (m.topic) pool.push(pick(S.recall).replace('%t%', m.topic));
      if (m.lastAct && m.lastAct !== a.act && this.DOING[m.lastAct]) {
        pool.push(pick(S.sawAct).replace('%p%', this.DOING[m.lastAct]));
      }
      if (m.carry) pool.push(pick(S.sawCarry).replace('%i%', this.itemName(m.carry)));
      parts.push(pick(pool));
    }

    // ---- what is happening right now, and how they feel about the world
    var actKey = a.arrived ? a.act : 'travel';
    var actPool = S.act[actKey] || S.act.travel;
    parts.push(pick(actPool));
    if (a.mood !== 'plain' || Math.random() < 0.4) parts.push(pick(S.mood[a.mood] || S.mood.plain));

    return parts.join(' ');
  },

  // The "last thing they talked about" is derived from what they were actually
  // doing, so the memory line always refers to something that happened.
  TOPICS: {
    sleep: 'that dream of yours', fish: 'the fishing off the shelf',
    tend: 'the state of the soil', visit: 'the neighbours',
    dock: 'those planks of yours', drift: 'the long way home',
    travel: 'the current out here',
  },
  _topicFor: function (a) {
    var t = this.TOPICS[a.arrived ? a.act : 'travel'];
    return t || 'the weather';
  },

  // =============================================================================
  // THE DECK SCENE
  // =============================================================================
  // Which home's deck is this agent standing on, if any? Their PLAN answers it --
  // there is no "is home" flag to get out of step with where they actually are.
  // Note this is deliberately not "is the owner in": a neighbour who walked here
  // on their visit slot is standing on this deck too, and should be found.
  deckOf: function (a) {
    if (!a || !a.arrived) return '';
    if (a.act === 'sleep') return '';                     // in, but not out here
    if (a.act === 'fish' || a.act === 'dock') return '';  // not at any house
    var where = a.slot ? a.slot.where : 'home';
    if (where === 'home' || where === 'plot') return this.HOMES[a.homeI].key;
    return where;                                         // a neighbour's key
  },

  // Everybody currently on this deck, newest arrival last. Refills a reused array
  // -- spots() and the deck draw both ask, two or three times a frame.
  presentAt: function (home) {
    var out = this._present;
    out.length = 0;
    if (!home || !this.agents) return out;
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      if (this.deckOf(a) !== home.key) continue;
      if (out.length >= this._spotObjs.res.length) break;
      out.push(a);
    }
    return out;
  },

  // Where somebody on this deck stands, in screen units. Whoever is tending takes
  // the post by the planter; everyone else queues along the posts. The spot list
  // and the draw both read this, so the label always sits over the right body.
  postFor: function (a, idx) {
    if (a && a.act === 'tend') return this.POST_TEND;
    var posts = this.POSTS;
    return posts[Math.min(idx, posts.length - 1)];
  },

  // The owner, if the owner is the one at home. Kept as the friendly name for the
  // common case (and for the arrival toast).
  residentHome: function (home) {
    if (!home) return null;
    var a = this.agentOf(home.who);
    return (a && this.deckOf(a) === home.key) ? a : null;
  },

  _nobodyHome: function (home) {
    var a = this.agentOf(home.who);
    var cast = this.CAST[home.who];
    var who = cast ? cast.name : 'the owner';
    if (!a) return 'Nobody home.';
    if (a.act === 'sleep' && a.arrived) return who + ' is asleep inside.';
    var where;
    if (!a.arrived) where = 'still out in the water, on their way';
    else if (a.act === 'fish') where = 'out on the fishing marks';
    else if (a.act === 'dock') where = 'down at your own pier';
    else if (a.act === 'visit') {
      var oh = this.homeByKey(a.slot ? a.slot.where : '');
      where = oh ? 'over at ' + oh.name : 'visiting a neighbour';
    } else where = 'about somewhere';
    return who + ' is ' + where + '.';
  },

  // Refilled in place two or three times a frame (the [E] search, the prompt, and
  // any wrapper), so nothing here allocates: the spot objects and the array were
  // built once in _boot and only their x and label move.
  spots: function () {
    // Public, and callable before there is a save at all (a wiring layer that
    // concatenated this into WorldScene.spots() would otherwise take the title
    // screen down), so the pools have to be proven before they are touched.
    if (!this.ensure() || !this._spots) return this._noSpots;
    var out = this._spots;
    out.length = 0;
    var home = this.home;
    if (!home) return out;
    var S = this._spotObjs;
    var here = this.presentAt(home);
    var p = this.plotOf(home.key);
    var i;

    // whoever is actually standing here, at the post they are drawn on
    for (i = 0; i < here.length; i++) {
      var sp = S.res[i];
      sp.x = this.postFor(here[i], i);
      sp.label = 'Talk to ' + here[i].cast.name;
      out.push(sp);
    }
    S.door.x = this.DOOR_X;
    S.door.label = here.length ? 'The door  (someone is in)' : 'Knock on the door';
    out.push(S.door);
    if (p) {
      S.plot.x = this.PLOT_X;
      S.plot.label = this._plotLabel(p);
      out.push(S.plot);
    }
    S.prop.x = this.PROP_X;
    S.prop.label = 'Poke about';
    out.push(S.prop);
    S.exit.x = this.EXIT_X;
    S.exit.label = 'Dive back in';
    out.push(S.exit);
    return out;
  },

  _plotLabel: function (p) {
    var name = this._cropName(p.crop);
    if (p.water >= 0.4) return name + ' planter  (watered)';
    return 'Water the ' + name + ' planter';
  },

  _cropName: function (key) {
    if (typeof Farm !== 'undefined' && Farm && Farm.CROPS && Farm.CROPS[key] && Farm.CROPS[key].name) {
      return Farm.CROPS[key].name;
    }
    return key;
  },

  knock: function () {
    if (!this.ensure() || !this.home) return;
    var home = this.home;
    var S = this.SAY[home.who];
    var a = this.agentOf(home.who);
    if (typeof SND !== 'undefined' && SND.clank) SND.clank();
    // somebody out here answers before the door does -- the owner for preference,
    // otherwise whichever neighbour happens to be standing on the planks
    var here = this.presentAt(home);
    if (here.length) {
      var who = here[0];
      for (var i = 0; i < here.length; i++) if (here[i].key === home.who) who = here[i];
      this.meet(who);
      return;
    }
    if (a && a.act === 'sleep' && a.arrived) {
      var m = G.hood.who[home.who];
      Game.toast(pick(S.asleep));
      // waking somebody up costs you a little, but only once a day
      if (m && m.knockDay !== G.day) {
        m.knockDay = G.day;
        if (typeof NPCs !== 'undefined' && NPCs && NPCs.add && NPCs.byKey && NPCs.byKey(home.who)) {
          NPCs.add(home.who, -2);
        }
      }
      Game.save();
      return;
    }
    // the note on the door is the schedule, made readable
    var act = a ? (a.arrived ? a.act : 'travel') : 'travel';
    Game.toast(S.note.replace('%w%', this.NOTES[act] || this.NOTES.travel));
  },

  waterPlot: function () {
    if (!this.ensure() || !this.home) return;
    var home = this.home;
    var p = this.plotOf(home.key);
    if (!p) return;
    var m = G.hood.who[home.who];
    if (p.water >= 0.4) {
      Game.toast('The ' + this._cropName(p.crop) + ' has had its water. Stage ' + (p.stage + 1) + ' of 3.');
      return;
    }
    p.water = 1;
    p.dry = 0;
    if (typeof SND !== 'undefined' && SND.splash) SND.splash();
    for (var i = 0; i < 6; i++) {
      this._wake(home.x + home.plotDX + rand(-6, 6), home.deckY + rand(-2, 4), rand(-6, 6), rand(-18, -6), true);
    }
    // a favour is a favour, but only the first one each day counts
    if (m && m.waterDay !== G.day) {
      m.waterDay = G.day;
      Game.toast(pick(this.SAY[home.who].thanks));
      if (typeof NPCs !== 'undefined' && NPCs && NPCs.add && NPCs.byKey && NPCs.byKey(home.who)) {
        NPCs.add(home.who, 6);
      } else if (typeof SND !== 'undefined' && SND.chime) SND.chime();
    } else {
      Game.toast('Watered.');
    }
    Game.save();
  },

  POKE: {
    lamp: ['Charts, all of them of the same stretch of water.',
      'A brass tube on a stand, pointed at nothing in particular.',
      'A logbook. Today reads: "heard it again. louder."'],
    cottage: ['Seed trays, labelled, then relabelled, then crossed out.',
      'A watering can with a repaired handle. Repaired twice.',
      'Somebody has been drying kelp on the rail.'],
    shack: ['Hooks. Hundreds of hooks, all in order.',
      'A crate of lines, coiled the way only forty years coils them.',
      'A very old kettle with a very new dent.'],
  },
  poke: function () {
    if (!this.home) return;
    var pool = this.POKE[this.home.key];
    if (typeof SND !== 'undefined' && SND.rub) SND.rub();
    Game.toast(pick(pool || ['Somebody else\'s things.']));
  },

  _deckUpdate: function (dt) {
    this.dtime += dt;
    if (typeof SKY !== 'undefined' && SKY.update) SKY.update(dt, this.dtime);
    if (typeof Game !== 'undefined' && Game.fadeDir !== 0) return;
    if (this._peerOpen()) return;

    var mv = 0;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    if (mv !== 0) {
      this.dir = mv;
      this.px = clamp(this.px + mv * 92 * dt, this.DL, this.DR);
      this.walkT += dt * 9;
      this.idleT = 0;
    } else this.idleT += dt;

    if (Input.p('Escape')) { this.leave(); return; }

    if (Input.p('KeyE') || Input.p('Space')) {
      var best = null, bd = 26;
      var sp = this.spots();
      for (var i = 0; i < sp.length; i++) {
        var d = Math.abs(this.px - sp[i].x);
        if (d < bd) { bd = d; best = sp[i]; }
      }
      if (best) {
        if (typeof SND !== 'undefined' && SND.click) SND.click();
        best.act();
        return;
      }
    }
  },

  // ---- deck draw --------------------------------------------------------------
  draw: function (ctx, camX, camY) {
    // Two callers, two jobs. js/integrate.js calls draw(ctx, camX, camY) inside
    // Ocean's world-space back pass; main.js calls draw(ctx) because we are also
    // a scene. The argument count tells them apart.
    if (arguments.length >= 3) { this._drawWorld(ctx, camX, camY); return; }
    this._drawDeck(ctx);
  },

  _drawDeck: function (ctx) {
    if (!this.ensure()) return;
    var home = this.home;
    if (!home) { ctx.fillStyle = '#0a1622'; ctx.fillRect(0, 0, W, H); return; }
    var FLOOR = this.FLOOR;
    var t = this.dtime;
    var nite = (typeof nightness === 'function') ? nightness(G.clock) : 0;

    // ---- sky and sea, the same ones the dock uses so the two read as one world
    if (typeof SKY !== 'undefined') {
      SKY.drawSky(ctx, G.clock, t, 0);
      SKY.drawSea(ctx, G.clock, t, 0);
    } else {
      ctx.fillStyle = '#2a6a8a'; ctx.fillRect(0, 0, W, H);
    }

    // ---- the house, sat behind the deck with its stilts running off the bottom
    var hw = 176;
    var hh = assetH(home.art, hw);
    var hx = 240 - hw / 2;
    var hy = FLOOR + 34 - hh;
    drawA(ctx, home.art, hx, hy, hw, hh);

    // ---- the deck: pier segments, so a neighbour's planks match Otto's own
    var segW = 88;
    var segH = assetH('dock_11', segW);
    var segTop = FLOOR - segH * 0.0352;          // deck top to deck top
    for (var x = this.DL - segW; x < this.DR + segW; x += segW - 1) {
      drawA(ctx, 'dock_11', x, segTop, segW, segH);
    }
    // and a drawn lip, in case the art never loaded
    ctx.fillStyle = 'rgba(109,69,38,0.9)';
    ctx.fillRect(this.DL - 14, FLOOR, this.DR - this.DL + 28, 2);

    this._drawDoor(ctx, FLOOR, nite);
    this._drawDeckPlot(ctx, FLOOR, t);
    this._drawProps(ctx, FLOOR, t);

    // ---- everybody standing here, each on the post their spot is anchored to,
    // which may be the owner, a visiting neighbour, or both at once
    var here = this.presentAt(home);
    var i;
    for (i = 0; i < here.length; i++) {
      this._drawPerson(ctx, here[i], this.postFor(here[i], i), FLOOR, here[i].cast.deckH, t, true);
    }

    // ---- Otto
    this._drawOtto(ctx, FLOOR, t);

    // ---- the rail, in FRONT of everybody: it is the front lip of the deck
    this._drawRail(ctx, FLOOR, this.DL - 10, this.DR + 10);

    // ---- prompt: the same nearest-within-26 search the update runs, so the
    // bubble always names the thing [E] would actually do
    var best = null, bd = 26;
    var sp = this.spots();
    for (i = 0; i < sp.length; i++) {
      var d = Math.abs(this.px - sp[i].x);
      if (d < bd) { bd = d; best = sp[i]; }
    }
    if (best) {
      var touch = (typeof TouchUI !== 'undefined' && TouchUI.enabled);
      var label = (touch ? '' : '[E] ') + best.label;
      var lw = textWidth(ctx, label, 7) + 12;
      var bx = clamp(this.px, lw / 2 + 4, W - lw / 2 - 4);
      uiPanel(ctx, bx - lw / 2, FLOOR - 52, lw, 13, 0.95, true);
      text(ctx, label, bx, FLOOR - 49, { size: 7, color: '#4a3020', align: 'center', shadow: false });
    }

    // ---- a name plate, so you always know whose porch you are standing on
    var nm = home.name;
    var nw = textWidth(ctx, nm, 7) + 14;
    uiPanel(ctx, W - nw - 8, 44, nw, 13, 0.9, true);
    text(ctx, nm, W - nw / 2 - 8, 47, { size: 7, color: '#6a4420', align: 'center', shadow: false });

    if (nite > 0.05) {
      ctx.fillStyle = 'rgba(10,12,34,' + (nite * 0.3).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // the speech bubble sits over whoever is talking, on this deck too
    for (i = 0; i < here.length; i++) {
      if (here[i].sayT <= 0) continue;
      this._drawBubble(ctx, this.postFor(here[i], i), FLOOR - here[i].cast.deckH - 12, here[i], 0, 0);
    }
  },

  // A drawn door rather than a hotspot on somebody else's art: it reads the same
  // whichever house sprite is behind it, and it can be lit from the inside.
  _drawDoor: function (ctx, FLOOR, nite) {
    var home = this.home;
    var dx = Math.round(this.DOOR_X);
    var dw = 17, dh = 27;
    var dy = FLOOR - dh;
    var here = this.presentAt(home).length > 0;
    var a = this.agentOf(home.who);
    var inside = !!(a && a.act === 'sleep' && a.arrived);

    // the light coming out from under and around it -- four flat arcs, no gradient
    if ((inside || here) && nite > 0.08) {
      var glow = clamp(nite, 0, 1) * 0.5;
      ctx.fillStyle = '#ffd27a';
      for (var i = 4; i >= 1; i--) {
        ctx.globalAlpha = glow * 0.09 * i / 4;
        ctx.beginPath();
        ctx.arc(dx, dy + dh * 0.6, 5 + i * 7, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(dx - dw / 2 - 1.5, dy - 2, dw + 3, dh + 2);
    ctx.fillStyle = inside ? '#8a6434' : '#6d4526';
    ctx.fillRect(dx - dw / 2, dy, dw, dh);
    // planks
    ctx.fillStyle = 'rgba(40,24,10,0.35)';
    ctx.fillRect(dx - dw / 2 + 5, dy + 1, PIX, dh - 2);
    ctx.fillRect(dx - dw / 2 + 11, dy + 1, PIX, dh - 2);
    // lintel and knob
    ctx.fillStyle = '#a4805a';
    ctx.fillRect(dx - dw / 2 - 2, dy - 4, dw + 4, 2.5);
    ctx.fillStyle = '#ffe66e';
    ctx.fillRect(dx + dw / 2 - 4, dy + dh * 0.5, 1.6, 1.6);
    if (inside) {
      // somebody is home and asleep: a warm slit under the door
      ctx.fillStyle = 'rgba(255,206,120,0.5)';
      ctx.fillRect(dx - dw / 2, FLOOR - 1.4, dw, 1.4);
    }
  },

  _drawRail: function (ctx, FLOOR, x0, x1) {
    var y = FLOOR - 15;
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(x0, y, x1 - x0, 1.6);
    ctx.fillRect(x0, y + 6, x1 - x0, 1.2);
    ctx.fillStyle = '#6d4526';
    for (var x = x0 + 6; x < x1; x += 26) ctx.fillRect(Math.round(x), y, 2, 15);
  },

  _drawDeckPlot: function (ctx, FLOOR, t) {
    var home = this.home;
    var p = this.plotOf(home.key);
    if (!p) return;
    var cx = Math.round(this.PLOT_X);
    var bw = 30, bh = 9;
    var by = FLOOR - bh;
    ctx.fillStyle = '#5a4526';
    ctx.fillRect(cx - bw / 2, by, bw, bh);
    ctx.fillStyle = p.water >= 0.4 ? '#3a2a16' : '#6a5636';
    ctx.fillRect(cx - bw / 2 + 1.5, by + 1.5, bw - 3, bh - 3);
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(cx - bw / 2, by, bw, 1.4);
    var art = 'crop_' + p.crop + '_' + p.stage;
    var chh = 14 + p.stage * 7;
    var img = ASSETS[art];
    if (img && img.width) {
      var cw = chh * img.width / img.height;
      ctx.save();
      ctx.translate(Math.round(cx * DPX) / DPX, by + 1);
      ctx.rotate(Math.sin(t * 1.4) * 0.04);
      ctx.drawImage(img, -cw / 2, -chh, cw, chh);
      ctx.restore();
    }
    if (p.water < 0.4) {
      // a thirsty planter says so, from across the deck
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3);
      text(ctx, '!', cx, by - chh - 9, { size: 8, color: '#ff5a4a', align: 'center' });
      ctx.globalAlpha = 1;
    }
  },

  // Two props per house, both from art that is definitely in the manifest, plus a
  // procedural crate so the deck is never bare even with no art at all.
  PROPS: {
    lamp: [{ art: 'furn_2', w: 34 }, { art: 'furn_14', w: 9, lift: 12 }],
    cottage: [{ art: 'furn_5', w: 30 }, { art: 'ftool_1', w: 11 }],
    shack: [{ art: 'furn_12', w: 32 }, { art: 'g_netbag', w: 12 }],
  },
  _drawProps: function (ctx, FLOOR, t) {
    var home = this.home;
    var list = this.PROPS[home.key] || [];
    var bx = this.PROP_X;
    for (var i = 0; i < list.length; i++) {
      var pr = list[i];
      var w = pr.w;
      var h = assetH(pr.art, w);
      var px = bx + (i === 0 ? 0 : 14);
      drawA(ctx, pr.art, px - w / 2, FLOOR - h - (pr.lift || 0), w, h);
    }
    // the procedural crate needs no art at all, so the deck is never bare
    if (typeof drawCrate === 'function') drawCrate(ctx, bx - 32, FLOOR - 12, 12);
  },

  _drawOtto: function (ctx, FLOOR, t) {
    var WALK = ['o4_4', 'o4_5', 'o4_6', 'o4_7'];
    var IDLE = ['o4_0', 'o4_1', 'o4_2', 'o4_3'];
    var walking = this.walkT > 0 && this.idleT < 0.1;
    var frameN = 0, sqx = 1, sqy = 1, hop = 0;
    if (walking) {
      frameN = Math.floor(this.walkT * 0.8) % WALK.length;
      var ph = this.walkT * 2.2;
      hop = Math.abs(Math.sin(ph)) * 1.6;
      sqy = 1 + Math.cos(ph * 2) * 0.045;
      sqx = 1 - (sqy - 1) * 0.85;
    } else {
      sqy = 1 + Math.sin(t * 2.1) * 0.02;
      sqx = 1 - (sqy - 1) * 0.7;
    }
    ctx.fillStyle = 'rgba(40,20,10,0.2)';
    ctx.beginPath();
    ctx.ellipse(this.px, FLOOR + 0.8, Math.max(3.5, 6 - hop * 0.9), 1.3, 0, 0, TAU);
    ctx.fill();
    var img = ASSETS[walking ? WALK[frameN] : IDLE[Math.floor(t * 2.2) % 4]];
    if (img && img.width) {
      var oh = 30, ow = oh * img.width / img.height;
      ctx.save();
      ctx.translate(Math.round(this.px * DPX) / DPX, FLOOR + 0.5 - hop);
      ctx.scale(this.dir >= 0 ? sqx : -sqx, sqy);
      ctx.drawImage(img, -ow / 2, -oh + 0.5, ow, oh);
      ctx.restore();
    }
  },

  // =============================================================================
  // WORLD DRAW -- the homes and everybody swimming, from inside the ocean
  // =============================================================================
  // Called with the camera transform already applied, so everything here is in
  // world units. Culled per home and per agent before it costs a transform.
  _drawWorld: function (ctx, camX, camY) {
    if (!this.ensure()) return;
    var t = this.time;
    var i;
    for (i = 0; i < this.HOMES.length; i++) this._drawHome(ctx, this.HOMES[i], camX, camY, t);
    this._drawWakes(ctx, camX, camY);
    for (i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      if (a.x < camX - 90 || a.x > camX + W + 90) continue;
      if (a.y < camY - 90 || a.y > camY + H + 90) continue;
      if (a.act === 'sleep' && a.arrived) continue;             // indoors
      // above the waterline they are standing on a deck, so the sprite is anchored
      // at the feet; in the water it is anchored at the body centre
      var onDeck = a.y <= -2;
      this._drawPerson(ctx, a, a.x, a.y, a.cast.h, t, onDeck);
      if (a.sayT > 0) {
        this._drawBubble(ctx, a.x, a.y - a.cast.h * (onDeck ? 1 : 0.5) - 8, a, camX, camY);
      }
    }
    this._drawReachMark(ctx, t);
  },

  _drawHome: function (ctx, hm, camX, camY, t) {
    var w = hm.w;
    if (hm.x + w < camX - 70 || hm.x - w > camX + W + 70) return;
    var hh = assetH(hm.art, w);
    var top = hm.deckY - hh * hm.deckFrac;
    var bottom = top + hh;

    // ---- stilts, carried down past the sprite so the house always stands on
    // something. There is no seabed out here, so they fade instead of landing.
    var legs = [hm.x - w * 0.3, hm.x, hm.x + w * 0.3];
    var legTop = hm.deckY + 2;
    var legBot = legTop + 118;
    ctx.fillStyle = '#3a2a18';
    for (var l = 0; l < legs.length; l++) {
      var lx = Math.round(legs[l] * DPX) / DPX;
      // five bands of falling alpha instead of a gradient
      for (var b = 0; b < 5; b++) {
        var y0 = legTop + (legBot - legTop) * (b / 5);
        var y1 = legTop + (legBot - legTop) * ((b + 1) / 5);
        ctx.globalAlpha = 0.85 * (1 - b / 5);
        ctx.fillRect(lx - 2, y0, 4, y1 - y0 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    // cross bracing, which is what makes it read as built and not as posts
    ctx.strokeStyle = 'rgba(58,42,24,0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(legs[0], legTop + 16); ctx.lineTo(legs[1], legTop + 40);
    ctx.moveTo(legs[1], legTop + 16); ctx.lineTo(legs[2], legTop + 40);
    ctx.stroke();

    // ---- the deck slab, then the house on top of it
    var dW = w * 1.12;
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(hm.x - dW / 2, hm.deckY, dW, 3.5);
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(hm.x - dW / 2, hm.deckY, dW, 1.4);
    drawA(ctx, hm.art, hm.x - w / 2, top, w, hh);

    // ---- rail along the front of the deck
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(hm.x - dW / 2, hm.deckY - 9, dW, 1.2);
    ctx.fillStyle = '#6d4526';
    for (var r = hm.x - dW / 2 + 4; r < hm.x + dW / 2; r += 22) {
      ctx.fillRect(Math.round(r), hm.deckY - 9, 1.6, 9);
    }

    // ---- the ladder: the thing you climb, drawn where climbAt() says it is
    var cx = hm.x + hm.climbDX;
    ctx.fillStyle = '#a4805a';
    ctx.fillRect(cx - 5, hm.deckY - 2, 1.6, 62);
    ctx.fillRect(cx + 3.4, hm.deckY - 2, 1.6, 62);
    ctx.fillStyle = '#c9a271';
    for (var s = 0; s < 9; s++) ctx.fillRect(cx - 5, hm.deckY + 4 + s * 6.5, 10, 1.4);

    // ---- their planter, up on the deck
    var p = this.plotOf(hm.key);
    if (p) {
      var px = hm.x + hm.plotDX;
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(px - 11, hm.deckY - 7, 22, 7);
      var art = 'crop_' + p.crop + '_' + p.stage;
      var img = ASSETS[art];
      if (img && img.width) {
        var ch = 9 + p.stage * 5;
        var cw = ch * img.width / img.height;
        ctx.save();
        ctx.translate(Math.round(px * DPX) / DPX, hm.deckY - 6);
        ctx.rotate(Math.sin(t * 1.4 + hm.x) * 0.05);
        ctx.drawImage(img, -cw / 2, -ch, cw, ch);
        ctx.restore();
      }
    }

    // ---- lamplight, and the sleeper's window
    var nite = (typeof nightness === 'function') ? nightness(G.clock) : 0;
    var a = this.agentOf(hm.who);
    if (nite > 0.08) {
      var win = top + hh * (hm.deckFrac * 0.45);
      ctx.fillStyle = '#ffd27a';
      for (var g = 4; g >= 1; g--) {
        ctx.globalAlpha = nite * 0.075 * g / 4;
        ctx.beginPath();
        ctx.arc(hm.x, win, 8 + g * 9, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (a && a.act === 'sleep' && a.arrived) {
      // z's over the roof: the schedule, legible from the water
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 1.4);
      text(ctx, 'z', hm.x + 10, top + 6 - Math.sin(t) * 2, { size: 7, color: '#dff2ff', align: 'center' });
      text(ctx, 'z', hm.x + 16, top - 2 - Math.sin(t + 1) * 2, { size: 5, color: '#dff2ff', align: 'center' });
      ctx.globalAlpha = 1;
    }

    // ---- and the wash of water over everything below the surface. This is what
    // turns the whole thing into a silhouette you swim up to.
    if (bottom > 0) {
      var wy0 = Math.max(0, top);
      var bands = 4;
      ctx.fillStyle = '#0c2e4e';
      for (var k = 0; k < bands; k++) {
        var b0 = wy0 + (bottom - wy0) * (k / bands);
        var b1 = wy0 + (bottom - wy0) * ((k + 1) / bands);
        ctx.globalAlpha = 0.14 + 0.1 * k;
        ctx.fillRect(hm.x - dW / 2 - 6, b0, dW + 12, b1 - b0 + 0.5);
      }
      ctx.globalAlpha = 1;
    }
  },

  // One person, upright on a deck or tilted into their own swim.
  _drawPerson: function (ctx, a, cx, feetY, boxH, t, upright) {
    var cast = a.cast;
    var frames = upright
      ? (a.act === 'tend' && a.arrived ? cast.work : (a.holdT > 0 ? cast.wave : cast.idle))
      : (a.arrived ? cast.idle : cast.walk);
    if (!frames || !frames.length) frames = cast.idle;
    var fps = upright ? (a.act === 'tend' && a.arrived ? 5 : 2.6) : (a.arrived ? 2.6 : 7);
    var fi = frames[Math.floor(a.animT * fps) % frames.length];
    var img = ASSETS[cast.art + '_' + fi];
    var bob = upright ? 0 : a.bob * 1.6;
    var flip = cast.faceR ? a.face < 0 : a.face > 0;

    if (upright) {
      ctx.fillStyle = 'rgba(20,14,8,0.22)';
      ctx.beginPath();
      ctx.ellipse(cx, feetY + 0.8, boxH * 0.2, 1.3, 0, 0, TAU);
      ctx.fill();
    }
    if (!img || !img.width) return;
    var h = boxH, w = h * img.width / img.height;
    ctx.save();
    ctx.translate(Math.round(cx * DPX) / DPX, feetY + bob);
    if (upright) {
      // standing on planks: the anchor is the feet, like every other sprite that
      // stands on a deck in this game
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h, w, h);
    } else {
      // In the water the anchor is the BODY CENTRE (that is what agent y means out
      // there, and what hits/talk radii measure from), so the lean rotates about
      // the middle instead of swinging the whole sprite around its tail.
      var sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
      var lean = sp > 8 ? Math.atan2(a.vy, Math.abs(a.vx) + 0.001) * 0.55 : Math.sin(t * 1.3 + a.ph) * 0.06;
      ctx.rotate(clamp(lean, -0.7, 0.7) * (flip ? -1 : 1));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  },

  // camX/camY are the camera origin in whatever space cx/cy are given in (0,0 for
  // the deck scene, the ocean camera out in the water), so a bubble on somebody at
  // the edge of the frame is nudged back inside instead of being half cut off.
  _drawBubble: function (ctx, cx, cy, a, camX, camY) {
    var lines = a.say;
    if (!lines || !lines.length) return;
    var alpha = clamp(a.sayT, 0, 1);
    var size = 6.5;
    var wmax = 0;
    for (var i = 0; i < lines.length; i++) {
      var lw = textWidth(ctx, lines[i], size);
      if (lw > wmax) wmax = lw;
    }
    var bw = wmax + 12, bh = lines.length * 8 + 8;
    var c0 = camX || 0, r0 = camY || 0;
    cx = clamp(cx, c0 + bw / 2 + 3, c0 + W - bw / 2 - 3);
    cy = clamp(cy, r0 + bh + 3, r0 + H - 3);
    var bx = cx - bw / 2, by = cy - bh;
    ctx.globalAlpha = alpha;
    uiPanel(ctx, bx, by, bw, bh, 0.95, true);
    // the little tail
    ctx.fillStyle = 'rgba(246,232,201,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - 3, by + bh - 0.5);
    ctx.lineTo(cx + 3, by + bh - 0.5);
    ctx.lineTo(cx, by + bh + 4);
    ctx.closePath();
    ctx.fill();
    for (i = 0; i < lines.length; i++) {
      text(ctx, lines[i], bx + bw / 2, by + 4 + i * 8, {
        size: size, color: '#4a3020', align: 'center', shadow: false,
      });
    }
    ctx.globalAlpha = 1;
  },

  _drawWakes: function (ctx, camX, camY) {
    var i, p;
    // two buckets, two fillStyle writes for the whole field
    ctx.fillStyle = '#dff2ff';
    for (i = 0; i < this._wakes.length; i++) {
      p = this._wakes[i];
      if (p.t <= 0 || p.warm) continue;
      if (p.x < camX - 20 || p.x > camX + W + 20 || p.y < camY - 20 || p.y > camY + H + 20) continue;
      ctx.globalAlpha = clamp(p.t, 0, 1) * 0.5;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.fillStyle = '#a0f2b4';
    for (i = 0; i < this._wakes.length; i++) {
      p = this._wakes[i];
      if (p.t <= 0 || !p.warm) continue;
      if (p.x < camX - 20 || p.x > camX + W + 20 || p.y < camY - 20 || p.y > camY + H + 20) continue;
      ctx.globalAlpha = clamp(p.t, 0, 1) * 0.55;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
  },

  // A ring around whatever [E] is currently pointed at, in world space, so the
  // prompt in the HUD has something to refer to.
  _drawReachMark: function (ctx, t) {
    if (!this._reach) return;
    var x, y, r;
    if (this._reachKind === 'climb') {
      x = this._reach.x + this._reach.climbDX;
      y = this._reach.deckY + 26;
      r = 13;
    } else {
      x = this._reach.x;
      y = this._reach.y - this._reach.cast.h * 0.4;
      r = 15;
    }
    ctx.strokeStyle = 'rgba(255,230,110,0.75)';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 4);
    ctx.beginPath();
    ctx.arc(x, y, r + Math.sin(t * 4) * 1.2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  // The one bit of screen-space UI out in the water: what [E] would do. Drawn in
  // Ocean's own HUD slot so it takes the colour grade with everything else, and
  // parked centre-low where neither the air capsule, the readiness pips, the bag
  // nor the hotbar live.
  drawOceanPrompt: function (ctx) {
    if (!this._reach) return;
    if (typeof Game === 'undefined' || typeof Ocean === 'undefined') return;
    if (Game.scene !== Ocean || Ocean.over || Ocean.leaving) return;
    if (this._peerOpen()) return;
    var touch = (typeof TouchUI !== 'undefined' && TouchUI.enabled);
    var label;
    if (this._reachKind === 'climb') {
      label = (touch ? '' : '[E] ') + 'Climb up to ' + this._reach.name;
    } else {
      var a = this._reach;
      label = (touch ? '' : '[E] ') + 'Talk to ' + a.cast.name + '  (' +
        (a.arrived ? this.DOING[a.act] || 'about' : 'swimming past') + ')';
    }
    var w = textWidth(ctx, label, 7) + 14;
    var x = W / 2 - w / 2;
    uiPanel(ctx, x, H - 46, w, 13, 0.92, true);
    text(ctx, label, W / 2, H - 43, { size: 7, color: '#4a3020', align: 'center', shadow: false });
  },

  // =============================================================================
  // INSTALL
  // =============================================================================
  // js/integrate.js already calls reset/update/draw for the ocean side. What is
  // left is everything main.js and ocean.js cannot know about: the tick that must
  // run in EVERY scene, the prompt, the touch pads, the bag that has to survive a
  // house call, and freezing the swim under a dialogue we opened ourselves.
  install: function () {
    if (this._installed) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;
    var self = this;

    // 1. the only slot that ticks in every scene, and under Shop and Bench too.
    //    This is what keeps the schedules running while the player is elsewhere.
    var gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      self.update(dt);
    };

    // 2. the [E] prompt, in Ocean's HUD so it takes the same colour grade.
    if (typeof Ocean !== 'undefined' && Ocean && Ocean._drawHUD) {
      var oHUD = Ocean._drawHUD.bind(Ocean);
      Ocean._drawHUD = function (ctx) {
        oHUD(ctx);
        self.drawOceanPrompt(ctx);
      };
    }

    // 3. Coming back off a deck is the SAME trip, not a new one: Ocean.enter
    //    hands out a fresh empty bag and counts a trip, so the haul is carried
    //    across by hand and the bookkeeping is put back. This wrap is installed
    //    after integrate.js's, so it runs outside it and sees the finished state.
    if (typeof Ocean !== 'undefined' && Ocean && Ocean.enter) {
      var oEnter = Ocean.enter.bind(Ocean);
      Ocean.enter = function (arg) {
        var st = self._resume;
        self._resume = null;
        oEnter(arg);
        if (!st) return;
        Ocean.bag = st.bag || {};
        Ocean.bagCount = st.bagCount || 0;
        Ocean.px = st.x; Ocean.py = st.y;
        Ocean.vx = 0; Ocean.vy = 26;
        Ocean.camX = Ocean.px - W * 0.5;
        Ocean.camY = Ocean.py - H * 0.42;
        // he was only up on a porch, so the trip counters must not double up
        if (G && G.ocean) {
          if (G.ocean.trips > 0) G.ocean.trips--;
          if (G.ocean.today > 0) G.ocean.today--;
        }
      };
    }

    // 3b. ...and a stash only ever means "he is up a ladder and going back down".
    //    Any other destination (a blackout hauls him home to bed, for instance)
    //    abandons the visit, so the stash must not be waiting to be restored into
    //    some unrelated dive days later.
    var gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) {
      var back = (typeof Ocean !== 'undefined') ? Ocean : null;
      if (self._resume && scene !== self && scene !== back) self._resume = null;
      return gGo(scene, arg);
    };

    // 4. npc.js freezes the dock scenes under its box but has never heard of the
    //    open water, so a conversation started mid-swim would let Otto drift off
    //    while the pages typed. Only OUR dialogue is frozen against.
    if (typeof Ocean !== 'undefined' && Ocean && Ocean.update) {
      var oUpdate = Ocean.update.bind(Ocean);
      Ocean.update = function (dt) {
        if (self.dialogueUp()) return;
        oUpdate(dt);
      };
    }

    this._hookTouch();
  },

  // ---- the touch wrap, deliberately LAZY ---------------------------------------
  // index.html loads this file after js/main.js, so install() runs at parse time --
  // which is EARLIER than ocean.js's own TouchUI.layout wrap (that one waits for
  // DOMContentLoaded). Ocean's wrap does not chain when its scene is up: it returns
  // its seven pads outright. Wrapping at parse time would therefore bury this one
  // where the ocean can never reach it and the climb pad would never appear.
  //
  // So the touch wrap is installed from the FIRST FRAME instead, the way farm.js
  // and craft.js hook themselves, which puts it outside every DOMContentLoaded
  // installer. The wrap chain rule still holds: always call the captured previous.
  _hookTouch: function () {
    if (this._touchHooked) return;
    if (typeof TouchUI === 'undefined' || typeof Game === 'undefined') return;
    this._touchHooked = true;
    var self = this;

    var tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (typeof Game === 'undefined' || !G) return tLayout();
      if (Game.scene === self) {
        if (Game.helpOpen || self._peerOpen()) return [];
        return [
          { x: 8, y: H - 52, w: 44, h: 44, key: 'ArrowLeft', icon: 'left' },
          { x: 58, y: H - 52, w: 44, h: 44, key: 'ArrowRight', icon: 'right' },
          { x: W - 52, y: H - 52, w: 44, h: 44, tap: 'KeyE', icon: 'act' },
          { x: W - 52, y: H - 100, w: 44, h: 44, tap: 'Escape', icon: 'hdive' },
          { x: W - 26, y: 24, w: 20, h: 18, tap: 'KeyH', icon: 'help' },
        ];
      }
      var b = tLayout();
      if (typeof Ocean !== 'undefined' && Game.scene === Ocean && self._reach && b.length) {
        b.push({ x: 6, y: H - 100, w: 40, h: 40, tap: 'KeyE', icon: 'hclimb' });
      }
      return b;
    };

    // TouchUI.draw only knows six icon names and paints an empty circle for
    // anything else, so our two get their glyphs here. The wrap chain rule
    // applies: call the captured previous one first, always.
    var tDraw = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tDraw(c);
      if (!this.enabled) return;
      for (var i = 0; i < this.buttons.length; i++) {
        var btn = this.buttons[i];
        if (btn.icon !== 'hdive' && btn.icon !== 'hclimb') continue;
        var cx = btn.x + btn.w / 2, cy = btn.y + btn.h / 2;
        c.strokeStyle = 'rgba(255,235,190,0.85)';
        c.fillStyle = 'rgba(255,235,190,0.85)';
        c.lineWidth = 1.4;
        if (btn.icon === 'hclimb') {
          // a ladder
          c.beginPath();
          c.moveTo(cx - 4, cy - 8); c.lineTo(cx - 4, cy + 8);
          c.moveTo(cx + 4, cy - 8); c.lineTo(cx + 4, cy + 8);
          for (var r = -6; r <= 6; r += 4) { c.moveTo(cx - 4, cy + r); c.lineTo(cx + 4, cy + r); }
          c.stroke();
        } else {
          // an arrow going down into water
          c.beginPath();
          c.moveTo(cx, cy - 9); c.lineTo(cx, cy + 3);
          c.stroke();
          c.beginPath();
          c.moveTo(cx - 4, cy + 1); c.lineTo(cx + 4, cy + 1); c.lineTo(cx, cy + 7);
          c.closePath(); c.fill();
          c.beginPath();
          c.moveTo(cx - 8, cy + 9);
          c.lineTo(cx - 3, cy + 7); c.lineTo(cx + 3, cy + 11); c.lineTo(cx + 8, cy + 9);
          c.stroke();
        }
      }
    };
  },
};

// Load-order-agnostic install: Game and TouchUI are script-scoped consts in
// js/main.js, so a file pulled in ahead of it has to wait for the document.
// index.html has this file at slot 26 -- after js/main.js and BEFORE
// js/integrate.js, which is what matters: integrate resolves `Hood` by eval at its
// own parse time, so a later slot would leave it undefined and the ocean would
// never call reset/update/draw. The touch wrap is the one piece that must be
// installed later still; _hookTouch does that from the first frame.
if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') Hood.install();
else document.addEventListener('DOMContentLoaded', function () { Hood.install(); }, { once: true });
