// ---- the cannon duel: Otto versus the CRAB PUNK ------------------------------
//
// A full scene (Game.go(Battle, wave)) rather than a modal, because it needs the
// whole screen and its own ambience. The player pushes a deck cannon left and
// right along the planks: the SAME control both aims/charges the shot and dodges
// the crab's counter-fire, so there is never a moment where you are only doing
// one of the two.
//
// Everything that crosses a module boundary is a hook the integrator points at
// its own systems: Battle.ammo / Battle.spendAmmo / Battle.give / Battle.done.
// Nothing in here reaches into Craft, Hotbar or the Farm.
'use strict';

// ---- arena geometry (logical units; the deck line is shared with the world) ----
const BAT_DECK_END = 448;   // the planks stop here; past it is open water
const BAT_WATER_Y = 236;    // splash line for anything that clears the dock
const BAT_GRAV = 300;       // shot gravity: tuned so a full-power arc peaks ~90 up
const BAT_PX_MIN = 26, BAT_PX_MAX = 244;    // the cannon's run of deck
const BAT_CX_MIN = 272, BAT_CX_MAX = 430;   // the crab's half of the dock

// All twelve crab frames are drawn at ONE pixel scale so his body never changes
// size when he swaps to a taller frame (4..11 are 340px tall, 0..3 are 295px).
const BAT_CRAB_S = 40 / 295;
// Art orientation, isolated as a flag: if the sheet turns out to face the other
// way this is the only edit needed.
const BAT_CRAB_FACES_LEFT = true;

// Particle colours. Kept to eight so the draw pass can set fillStyle once per
// colour and never build a colour string inside the loop.
const BAT_PCOL = [
  '#ffe66e',   // 0 muzzle gold
  '#ff9a3c',   // 1 ember
  '#e8434c',   // 2 blood-red / danger
  '#f6e8c9',   // 3 cream smoke
  '#c9a271',   // 4 plank dust
  '#8a6434',   // 5 splinter
  '#bfe8f5',   // 6 spray
  '#3a2a1a',   // 7 soot
];
// particle kinds
const BAT_K_DOT = 0, BAT_K_DEBRIS = 1, BAT_K_SMOKE = 2, BAT_K_SPARK = 3, BAT_K_RING = 4;

const BAT_MAT_NAMES = {
  crabClaw: 'Crab Claw',
  brassScrap: 'Brass Scrap',
  cannonball: 'Cannonball',
};

const Battle = {
  // ---- scene contract --------------------------------------------------------
  customCursor: false,

  // ---- public surface --------------------------------------------------------
  active: false,        // true from enter() until the fight is handed back
  ammoKey: 'cannonball',
  loot: null,           // last result: { wave, money, mats, keys, flawless }
                        // money is NEGATIVE on a loss (what he stole)
  done: null,           // function(win, loot) — set by the integrator
  pollInput: true,      // false = the host drives click()/press()/release() only

  // Ammunition hooks. The defaults are deliberately empty so an unwired Battle
  // still plays — just with the weak fallback shot the whole time.
  ammo() { return 0; },
  spendAmmo(n) { return false; },
  // Reward hook. Falls back to storage for real ITEMS keys, else G.crafted.
  give(key, n) {
    if (!G) return false;
    if (G.storage && Object.prototype.hasOwnProperty.call(G.storage, key)) { G.storage[key] += n; return true; }
    if (!G.crafted) G.crafted = {};
    G.crafted[key] = (G.crafted[key] || 0) + n;
    return true;
  },

  // ---- tuning ----------------------------------------------------------------
  CHARGE_T: 0.85,       // seconds from tap to full power
  SWEET_LO: 0.78, SWEET_HI: 0.96,   // release band that lands a PERFECT shot
  FIRE_CD: 0.22,
  HEAVY_DMG: 12, WEAK_DMG: 4,
  PERFECT_MUL: 1.35,
  // The window has to be longer than one charge-fire-fly cycle (~1.2s measured)
  // or the reward for staggering him is theoretical.
  STAGGER_T: 1.8,       // length of the open damage window
  STAGGER_CD: 3.0,      // he shrugs off the next big hit for this long after,
                        // which is what buys him a whole attack between windows
  IFRAME_T: 1.1,
  HIT_STOP: 0.08,       // 80ms freeze on a solid hit

  // ---- state -----------------------------------------------------------------
  wave: 1, phase: 1, pendingPhase: 0,
  mode: 'fight',        // fight | won | lost | fled
  time: 0, outT: 0,
  px: 90, walkT: 0, moveDir: 0, recoil: 0,
  aimX: 330, aimY: 150,
  charging: false, charge: 0, fireCd: 0,
  invT: 0, hitsTaken: 0, shotsFired: 0, hitsLanded: 0,
  shakeT: 0, shakeMag: 0, stopT: 0, slowT: 0,
  flash: 0, flashCol: '255,255,255',
  banner: '', bannerT: 0, bannerLife: 1, bannerCol: '#ffe66e',
  retreatT: 0, ammoWarnT: 0,
  crab: null,
  balls: null, parts: null, nums: null, marks: null,
  _bi: 0, _pi: 0, _ni: 0, _mi: 0,
  _prx: null, _pry: null,
  _blockHold: true, _injHold: false, _injMove: 0, _tap: null, _escQ: 0,
  _installed: false,

  // ---- pools -----------------------------------------------------------------
  // Allocated exactly once for the lifetime of the page and then reused: the hot
  // path only ever writes fields on objects that already exist.
  MAXB: 40, MAXP: 320, MAXN: 16, MAXM: 8, MAXPR: 80,

  _initPools() {
    if (this.balls) return;
    this.balls = [];
    for (let i = 0; i < this.MAXB; i++)
      this.balls.push({ live: false, x: 0, y: 0, vx: 0, vy: 0, r: 3, dmg: 0, foe: false, kind: 0, spin: 0, perfect: false, trailT: 0, t: 0 });
    this.parts = [];
    for (let i = 0; i < this.MAXP; i++)
      this.parts.push({ live: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, t: 0, life: 1, s: 1, col: 0, kind: 0, bounce: false });
    this.nums = [];
    for (let i = 0; i < this.MAXN; i++)
      this.nums.push({ live: false, x: 0, y: 0, vy: 0, t: 0, life: 1, val: 0, crit: false, txt: '' });
    this.marks = [];
    for (let i = 0; i < this.MAXM; i++)
      this.marks.push({ live: false, x: 0, t: 0, life: 1 });
    this._prx = new Array(this.MAXPR).fill(0);
    this._pry = new Array(this.MAXPR).fill(0);
  },

  // A ball must never be dropped silently, so if every slot is busy the oldest
  // one is recycled — 40 in flight is already far past anything playable.
  _ball() {
    const a = this.balls;
    for (let i = 0; i < a.length; i++) {
      const b = a[(this._bi + i) % a.length];
      if (!b.live) { this._bi = (this._bi + i + 1) % a.length; return b; }
    }
    const b = a[this._bi];
    this._bi = (this._bi + 1) % a.length;
    return b;
  },

  // Particles are a plain ring buffer: the newest burst is always the one you
  // are looking at, so overwriting the oldest is the right failure mode.
  _pp(x, y, vx, vy, life, s, col, kind, g, bounce) {
    const p = this.parts[this._pi];
    this._pi = (this._pi + 1) % this.parts.length;
    p.live = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.t = life; p.life = life; p.s = s; p.col = col; p.kind = kind;
    p.g = g || 0; p.bounce = !!bounce;
    return p;
  },

  _num(x, y, txt, crit) {
    const n = this.nums[this._ni];
    this._ni = (this._ni + 1) % this.nums.length;
    n.live = true; n.x = x; n.y = y; n.vy = -26; n.t = 0.95; n.life = 0.95;
    n.txt = txt; n.crit = !!crit;
  },

  _mark(x, life) {
    const m = this.marks[this._mi];
    this._mi = (this._mi + 1) % this.marks.length;
    m.live = true; m.x = x; m.t = life; m.life = life;
    return m;
  },

  // ---- save-shape guard --------------------------------------------------------
  // Everything persisted lives under G.flags, which Game.load DOES deep-merge,
  // so an older save picks up new keys instead of erasing them.
  _ensure() {
    if (!G) return false;
    if (!G.flags) G.flags = {};
    if (typeof G.flags.battleWins !== 'number') G.flags.battleWins = 0;
    if (typeof G.flags.battleBest !== 'number') G.flags.battleBest = 0;
    return true;
  },

  // ---- entry points --------------------------------------------------------------
  start(wave) {
    this._pendWave = Math.max(1, Math.floor(wave || 1));
    Game.go(Battle, this._pendWave);
  },

  // A raid is pending; the integrator can surface this on the deck.
  raidReady() { return !!(G && G.flags && G.flags.battleRaid); },

  spots() {
    if (!this.raidReady()) return [];
    const w = (G.flags.battleBest || 0) + 1;
    return [{
      x: 388,
      label: `Man the Cannon  (RAID — wave ${w})`,
      act: () => { G.flags.battleRaid = false; Game.save(); Battle.start(w); },
    }];
  },

  // Called from the integrator's day rollover. The crab shows up on his own
  // schedule so the fight is an event, not a menu item.
  newDay() {
    if (!this._ensure()) return;
    if (G.flags.battleRaid) return;              // he is already at the door
    if (G.day < 4) return;
    const overdue = G.day >= 7 && !G.flags.battleWins;
    if (overdue || Math.random() < 0.22) {
      G.flags.battleRaid = true;
      Game.toast('Cannon smoke on the horizon... a raid is coming.');
    }
  },

  enter(arg) {
    this._initPools();
    this._ensure();
    let w = 1;
    if (typeof arg === 'number') w = arg;
    else if (arg && typeof arg.wave === 'number') w = arg.wave;
    else if (this._pendWave) w = this._pendWave;
    if (arg && typeof arg.done === 'function') this.done = arg.done;
    this.wave = clamp(Math.floor(w), 1, 9);
    this._pendWave = 0;

    this.active = true;
    this.mode = 'fight';
    this.time = 0; this.outT = 0;
    this.px = 90; this.walkT = 0; this.moveDir = 0; this.recoil = 0;
    this.aimX = 330; this.aimY = 150;
    this.charging = false; this.charge = 0; this.fireCd = 0.5;
    this.invT = 0; this.hitsTaken = 0; this.shotsFired = 0; this.hitsLanded = 0;
    this.shakeT = 0; this.shakeMag = 0; this.stopT = 0; this.slowT = 0;
    this.flash = 0;
    this.retreatT = 0; this.ammoWarnT = 0;
    this.phase = 1; this.pendingPhase = 0;
    this.loot = null;
    // a button still held from the click that started the fight must be released
    // once before it charges, or the fight opens by charging on its own
    this._blockHold = true;
    this._injHold = false; this._injMove = 0; this._tap = null; this._escQ = 0;
    for (const b of this.balls) b.live = false;
    for (const p of this.parts) p.live = false;
    for (const n of this.nums) n.live = false;
    for (const m of this.marks) m.live = false;

    // Sized so a good player needs roughly a dozen landed shots: long enough to
    // see all three phases and every attack, short enough to stay a set piece.
    const hpMax = Math.round(240 * (1 + 0.35 * (this.wave - 1)));
    this.crab = {
      x: 500, face: -1, dir: -1,
      hp: hpMax, hpMax, hpShown: hpMax,
      st: 'arrive', t: 1.9, sub: 0,
      next: 'throw', shots: 0, shotT: 0, targetX: 120,
      hurtT: 0, stagCd: 0, invT: 0,
      walk: 0, bob: 0, tilt: 0, fall: 0,
      banjo: false, banjoT: 0, taunt: 0, aimAt: 120,
    };

    SND.setScene('shark');        // gloomy pad + heartbeat: the boss ambience
    this._say(`WAVE ${this.wave}  —  THE CRAB PUNK`, 2.4, '#e8434c');
    if (!G.flags.seenBattle) {
      G.flags.seenBattle = true;
      Game.toast(TouchUI.enabled
        ? 'Drag to aim, hold to charge, let go to FIRE. Arrows dodge.'
        : 'Aim with the mouse, HOLD to charge, release to FIRE. A/D dodge.');
    }
  },

  _say(msg, life, col) {
    this.banner = msg; this.bannerT = life; this.bannerLife = life;
    this.bannerCol = col || '#ffe66e';
  },

  // ---- host-driven input -------------------------------------------------------
  // These exist so a host that owns the pointer (a tutorial, a replay, a touch
  // shell) can drive the fight without Battle reading Input at all: set
  // Battle.pollInput = false and call these.
  click(x, y) {
    if (!this.active) return false;
    if (typeof x === 'number') { this.aimX = x; this.aimY = y; }
    // A bare click is a snap shot at a readable mid power — holding is how you
    // get the strong ones, and that stays true however the input arrives.
    this._tap = this.charging ? this.charge : 0.55;
    return true;
  },

  press(code) {
    if (!this.active) return;
    if (code === 'Space' || code === 'Fire') { this._injHold = true; return; }
    if (code === 'KeyA' || code === 'ArrowLeft') { this._injMove = -1; return; }
    if (code === 'KeyD' || code === 'ArrowRight') { this._injMove = 1; return; }
    if (code === 'Escape') { this._escQ++; }
  },

  release(code) {
    if (!this.active) return;
    if (code === 'Space' || code === 'Fire') { this._injHold = false; return; }
    if (code === 'KeyA' || code === 'ArrowLeft') { if (this._injMove < 0) this._injMove = 0; return; }
    if (code === 'KeyD' || code === 'ArrowRight') { if (this._injMove > 0) this._injMove = 0; }
  },

  // ---- geometry helpers ---------------------------------------------------------
  pivX() { return this.px + 4 - this.recoil; },
  pivY() { return DECK_Y - 13; },

  aimAngle() {
    // The barrel only swings through the right-hand arc: the crab is always over
    // there, and letting it point back down the dock would just be a way to
    // waste a shot.
    let dx = this.aimX - this.pivX();
    const dy = this.aimY - this.pivY();
    if (dx < 8) dx = 8;
    return clamp(Math.atan2(dy, dx), -1.40, 0.12);
  },

  // Range, not just damage, is what separates the two shots. A full-power iron
  // ball crosses the whole dock (v^2/g = 385 units); the scrap shot tops out at
  // 234, so with an empty crate you have to shove the cannon forward into his
  // half of the deck to reach him at all. Weak, but never useless.
  _speed(power, heavy) {
    return heavy ? lerp(130, 340, power) : lerp(110, 265, power);
  },

  // Every attack of his scales gently with the wave, so a late-game player in an
  // Armored Wetsuit (def 1) is not simply immune to the whole fight.
  _atk(base) { return base + (this.wave - 1) * 0.2; },

  _art(name, scale) {
    const img = ASSETS[name];
    if (!img || !img.width) return null;
    return { w: img.width * scale, h: img.height * scale };
  },

  // Two scratch rects, filled in place. They are read every frame by the ball
  // sweep and the arc preview, and a boss fight has no business minting garbage
  // sixty times a second.
  _cbox: { x0: 0, x1: 0, y0: 0, y1: 0 },
  _obox: { x0: 0, x1: 0, y0: 0, y1: 0 },

  _crabBox() {
    const c = this.crab, b = this._cbox;
    b.x0 = c.x - 15; b.x1 = c.x + 15; b.y0 = DECK_Y - 34; b.y1 = DECK_Y - 1;
    return b;
  },

  _ottoBox() {
    const b = this._obox;
    b.x0 = this.px - 19; b.x1 = this.px + 10; b.y0 = DECK_Y - 26; b.y1 = DECK_Y;
    return b;
  },

  // ---- update -------------------------------------------------------------------
  update(dt) {
    if (!this._ensure()) return;
    this.time += dt;

    // Hit-stop: the world freezes for 80ms but the shake and flash keep running,
    // so the frame the ball lands on reads as an impact instead of a stall.
    if (this.stopT > 0) {
      this.stopT -= dt;
      this._decay(dt);
      if (this.pollInput) { this.aimX = Input.mouse.x; this.aimY = Input.mouse.y; }
      return;
    }

    const eff = this.slowT > 0 ? dt * 0.28 : dt;   // slow-mo pinch on the kill
    if (this.slowT > 0) this.slowT -= dt;
    this._decay(dt);

    this._input(eff);
    this._playerUpdate(eff);
    if (this.mode === 'fight') this._crabUpdate(eff);
    else this._outro(dt);
    this._ballsUpdate(eff);
    this._partsUpdate(eff);
  },

  _decay(dt) {
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flash > 0) this.flash -= dt * 2.2;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.retreatT > 0) this.retreatT -= dt;
    if (this.ammoWarnT > 0) this.ammoWarnT -= dt;
    if (this.invT > 0) this.invT -= dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 26);
    const c = this.crab;
    if (c) {
      if (c.hurtT > 0) c.hurtT -= dt;
      if (c.stagCd > 0) c.stagCd -= dt;
      if (c.invT > 0) c.invT -= dt;
      c.hpShown = lerp(c.hpShown, c.hp, Math.min(1, dt * 7));
    }
    for (const m of this.marks) {
      if (!m.live) continue;
      m.t -= dt;
      if (m.t <= 0) m.live = false;
    }
    for (const n of this.nums) {
      if (!n.live) continue;
      n.t -= dt; n.y += n.vy * dt; n.vy += 52 * dt;
      if (n.t <= 0) n.live = false;
    }
  },

  _shake(mag, t) {
    this.shakeMag = Math.max(this.shakeMag * (this.shakeT > 0 ? 1 : 0), mag);
    this.shakeT = Math.max(this.shakeT, t);
  },

  _input(dt) {
    // pointer / aim
    if (this.pollInput) { this.aimX = Input.mouse.x; this.aimY = Input.mouse.y; }

    // retreat: Escape asks, Escape again inside the window actually leaves
    let esc = this._escQ > 0;
    this._escQ = 0;
    if (this.pollInput && Input.p('Escape')) esc = true;
    if (esc && this.mode === 'fight' && (!this.crab || this.crab.st !== 'dead')) {
      if (this.retreatT > 0) { this._flee(); return; }
      this.retreatT = 2.4;
      SND.blip();
    }

    // movement
    let mv = this._injMove;
    if (this.pollInput) {
      if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
      if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    }
    this.moveDir = clamp(mv, -1, 1);

    // charge / fire
    let hold = !!this._injHold;
    if (this.pollInput && (Input.mouse.down || Input.keys['Space'])) hold = true;
    const canAct = this.mode === 'fight' && this.fireCd <= 0;
    // Holding is a STATE, not an edge: while the button is down and the cannon is
    // free, it charges. This cannot auto-refire, because firing only happens on
    // RELEASE — and it means a press that arrives during the reload, or a charge
    // knocked out of Otto's paws by a hit, resumes on its own instead of leaving
    // a dead cannon in the player's hand until they think to let go and re-press.
    if (!hold) this._blockHold = false;
    if (hold && !this._blockHold && !this.charging && canAct) {
      this.charging = true; this.charge = 0;
      SND.tone({ f: 190, f2: 240, type: 'triangle', a: 0.01, d: 0.09, v: 0.12 });
    }
    if (this.charging) {
      const prev = this.charge;
      this.charge = Math.min(1, this.charge + dt / this.CHARGE_T);
      // one click as the meter enters the sweet band: the timing cue is audible,
      // so you can charge with your eyes on the crab
      if (prev < this.SWEET_LO && this.charge >= this.SWEET_LO) SND.click();
      if (!hold) {
        // a shot in hand when the fight ends is dropped, not spent
        if (this.mode === 'fight') this._fire(this.charge);
        else { this.charging = false; this.charge = 0; }
      }
    }

    // a queued snap shot from click()
    if (this._tap !== null && this._tap !== undefined) {
      const p = this._tap;
      this._tap = null;
      if (canAct) { this.charging = true; this._fire(p); }
    }
  },

  _playerUpdate(dt) {
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.mode !== 'fight') { this.charging = false; return; }
    if (this.moveDir !== 0) {
      // the carriage is heavy: he shoves it, he does not sprint
      this.px = clamp(this.px + this.moveDir * 74 * dt, BAT_PX_MIN, BAT_PX_MAX);
      this.walkT += dt * 9;
      if (Math.random() < dt * 9)
        this._pp(this.px - this.moveDir * 8, DECK_Y - 0.5, -this.moveDir * rand(6, 14), rand(-9, -2), rand(0.3, 0.5), rand(0.8, 1.6), 4, BAT_K_DOT, 24, false);
    }
  },

  _fire(power) {
    this.charging = false;
    this.charge = 0;
    this.fireCd = this.FIRE_CD;
    power = clamp(power, 0.14, 1);
    const perfect = power >= this.SWEET_LO && power <= this.SWEET_HI;

    // Real shot or the fallback. spendAmmo is asked BEFORE the shot exists so a
    // hook that refuses (empty crate, locked chest) degrades cleanly.
    let heavy = false;
    if (this.ammo() > 0 && this.spendAmmo(1)) heavy = true;
    if (!heavy && this.ammoWarnT <= 0) {
      this.ammoWarnT = 3.5;
      SND.alarm();
      Game.toast('Out of cannonballs! Otto packs scrap and hope.');
    }

    const a = this.aimAngle();
    const sp = this._speed(power, heavy);
    const px0 = this.pivX(), py0 = this.pivY();
    const mx = px0 + Math.cos(a) * 15, my = py0 + Math.sin(a) * 15;

    const b = this._ball();
    b.live = true; b.x = mx; b.y = my;
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    b.r = heavy ? 3.4 : 2.1;
    b.dmg = heavy ? this.HEAVY_DMG * (perfect ? this.PERFECT_MUL : 1) : this.WEAK_DMG;
    b.foe = false; b.kind = heavy ? 0 : 1; b.spin = 0; b.perfect = perfect;
    b.trailT = 0; b.t = 6;
    this.shotsFired++;

    // ---- juice: recoil, smoke ring, sparks, shake ----------------------------
    this.recoil = heavy ? 5 : 2.5;
    this._shake(heavy ? (perfect ? 3.2 : 2.4) : 1.1, heavy ? 0.22 : 0.1);
    const cs = Math.cos(a), sn = Math.sin(a);
    const puffs = heavy ? 10 : 4;
    for (let i = 0; i < puffs; i++) {
      const sp2 = rand(18, 62) * (heavy ? 1 : 0.6);
      const spread = rand(-0.5, 0.5);
      this._pp(mx, my, Math.cos(a + spread) * sp2, Math.sin(a + spread) * sp2 - rand(2, 14),
        rand(0.35, 0.8), rand(1.6, 3.4), i % 3 === 0 ? 7 : 3, BAT_K_SMOKE, -8, false);
    }
    const sparks = heavy ? 14 : 5;
    for (let i = 0; i < sparks; i++) {
      const spread = rand(-0.34, 0.34);
      const sp2 = rand(90, 250);
      this._pp(mx, my, Math.cos(a + spread) * sp2, Math.sin(a + spread) * sp2,
        rand(0.12, 0.3), rand(0.7, 1.5), i % 2 ? 0 : 1, BAT_K_SPARK, 120, false);
    }
    if (heavy) {
      const r = this._pp(mx + cs * 2, my + sn * 2, 0, 0, 0.28, 3, perfect ? 0 : 3, BAT_K_RING, 0, false);
      r.vx = 0; r.vy = 0;
    }
    if (heavy) {
      SND.tone({ f: 96, f2: 38, type: 'square', a: 0.004, d: 0.26, v: 0.3 });
      SND.noise({ d: 0.34, v: 0.3, f: 220, f2: 70, q: 0.7 });
      if (perfect) SND.tone({ f: 1180, f2: 1760, type: 'triangle', a: 0.002, d: 0.16, v: 0.12, fx: true });
    } else {
      SND.pop(0.7);
      SND.noise({ d: 0.12, v: 0.14, f: 480, f2: 220, q: 1.4 });
    }
  },

  // ---- projectiles ---------------------------------------------------------------
  _ballsUpdate(dt) {
    const cbox = this._crabBox();
    const obox = this._ottoBox();
    for (const b of this.balls) {
      if (!b.live) continue;
      b.t -= dt;
      b.vy += BAT_GRAV * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += dt * 9;

      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.035;
        this._pp(b.x, b.y, rand(-6, 6), rand(-6, 6), rand(0.2, 0.45), b.kind === 0 ? 1.5 : 1,
          b.foe ? 2 : (b.perfect ? 0 : 7), BAT_K_SMOKE, -6, false);
      }

      if (b.t <= 0 || b.x < -30 || b.x > W + 90) { b.live = false; continue; }

      // ---- who does it hit -----------------------------------------------------
      if (!b.foe && this.crab.st !== 'dead' &&
          b.x + b.r > cbox.x0 && b.x - b.r < cbox.x1 && b.y + b.r > cbox.y0 && b.y - b.r < cbox.y1) {
        b.live = false;
        this._hitCrab(b);
        continue;
      }
      if (b.foe && this.invT <= 0 && this.mode === 'fight' &&
          b.x + b.r > obox.x0 && b.x - b.r < obox.x1 && b.y + b.r > obox.y0 && b.y - b.r < obox.y1) {
        b.live = false;
        this._burst(b.x, b.y, 10, 2);
        this._hurt(b.dmg);
        continue;
      }

      // ---- ground / water ------------------------------------------------------
      if (b.y >= DECK_Y && b.x < BAT_DECK_END) {
        b.live = false;
        this._deckHit(b);
        continue;
      }
      if (b.y >= BAT_WATER_Y) {
        b.live = false;
        this._splash(b.x, BAT_WATER_Y, b.kind === 0 ? 1 : 0.6);
      }
    }
  },

  _deckHit(b) {
    const x = clamp(b.x, 2, BAT_DECK_END);
    // plank dust and splinters kicked along the deck
    for (let i = 0; i < 9; i++)
      this._pp(x, DECK_Y - 1, rand(-52, 52), rand(-70, -14), rand(0.35, 0.7), rand(0.9, 2.1), 4, BAT_K_DOT, 210, false);
    for (let i = 0; i < 5; i++)
      this._pp(x, DECK_Y - 2, rand(-70, 70), rand(-96, -30), rand(0.5, 0.9), rand(1.2, 2.2), 5, BAT_K_DEBRIS, 260, true);
    this._pp(x, DECK_Y - 2, 0, 0, 0.22, 2.5, 4, BAT_K_RING, 0, false);
    this._shake(b.foe ? 1.8 : 1.2, 0.1);
    SND.clink();
    SND.noise({ d: 0.09, v: 0.16, f: 300, f2: 120, q: 1.6 });

    // the crab's shells crack open with a small blast: standing in the dust hurts.
    // His cannon shot (kind 4) throws the wider one — that is the attack you are
    // meant to be running away from.
    if (b.foe && b.dmg > 0 && this.mode === 'fight') {
      const reach = b.kind === 4 ? 20 : 13;
      this._pp(x, DECK_Y - 3, 0, 0, 0.3, reach * 0.6, 2, BAT_K_RING, 0, false);
      if (Math.abs(this.px - x) < reach && this.invT <= 0) this._hurt(b.dmg);
    }
  },

  _splash(x, y, scale) {
    for (let i = 0; i < Math.round(14 * scale); i++)
      this._pp(x, y, rand(-40, 40), rand(-110, -40) * scale, rand(0.35, 0.8), rand(0.9, 2.2), 6, BAT_K_DOT, 240, false);
    for (let i = 0; i < 4; i++)
      this._pp(x, y, rand(-16, 16), rand(-26, -6), rand(0.5, 1.0), rand(2, 4), 3, BAT_K_SMOKE, -4, false);
    this._pp(x, y, 0, 0, 0.34, 3 * scale, 6, BAT_K_RING, 0, false);
    SND.splash();
  },

  _burst(x, y, n, col) {
    for (let i = 0; i < n; i++)
      this._pp(x, y, rand(-120, 120), rand(-130, 40), rand(0.25, 0.55), rand(0.8, 1.8), col, BAT_K_SPARK, 170, false);
  },

  // ---- damage to the crab ---------------------------------------------------------
  _hitCrab(b) {
    const c = this.crab;
    if (c.invT > 0) {
      // guarded during a taunt: the shot rings off his shell and tells you so
      this._burst(b.x, b.y, 8, 3);
      this._num(b.x, b.y - 6, 'GUARD', false);
      SND.clank();
      this._shake(1.0, 0.08);
      return;
    }
    const staggered = c.st === 'stagger';
    let dmg = b.dmg * (staggered ? 2 : 1);
    dmg = Math.round(dmg);
    c.hp = Math.max(0, c.hp - dmg);
    this.hitsLanded++;

    this._num(b.x, DECK_Y - 40, String(dmg), staggered || b.perfect);
    this.flash = staggered ? 0.5 : 0.34;
    this.flashCol = staggered ? '255,230,110' : '255,255,255';
    this._shake(staggered ? 3.6 : 2.8, 0.26);
    this.stopT = this.HIT_STOP;

    // debris burst: shell chips, sparks and a shockwave ring
    for (let i = 0; i < 16; i++)
      this._pp(b.x, b.y, rand(-150, 90), rand(-160, 20), rand(0.3, 0.75), rand(1, 2.4),
        i % 3 === 0 ? 2 : (i % 3 === 1 ? 1 : 5), BAT_K_DEBRIS, 280, true);
    this._burst(b.x, b.y, 12, 0);
    this._pp(b.x, b.y, 0, 0, 0.3, 4, staggered ? 0 : 3, BAT_K_RING, 0, false);

    if (b.perfect) SND.crackHit(true); else SND.bite();

    if (c.hp <= 0) { this._kill(); return; }

    // A solid hit staggers him and opens the damage window; the cooldown stops a
    // stocked-up player from simply locking him down forever. An iron ball is
    // always solid — a scrap shot only counts if it was released in the band, so
    // an empty crate leaves you one way to stay in the fight: perfect timing.
    const solid = b.kind === 0 || b.perfect;
    if (solid && !staggered && c.stagCd <= 0 && c.st !== 'interlude') {
      this._stagger();
    } else {
      c.hurtT = 0.22;
      if (staggered) c.t = Math.max(c.t, 0.35);   // a little extra hang on a follow-up
    }
    this._checkPhase();
  },

  _stagger() {
    const c = this.crab;
    c.st = 'stagger'; c.t = this.STAGGER_T; c.sub = 0;
    c.stagCd = this.STAGGER_T + this.STAGGER_CD;
    c.shots = 0;
    this._say('STAGGERED!  HIT HIM', 1.1, '#ffe66e');
    SND.ding();
    for (let i = 0; i < 10; i++)
      this._pp(c.x + rand(-10, 10), DECK_Y - 34, rand(-24, 24), rand(-40, -12), rand(0.5, 0.9), rand(1.2, 2), 0, BAT_K_DOT, 40, false);
  },

  _checkPhase() {
    const c = this.crab;
    const f = c.hp / c.hpMax;
    if (this.phase === 1 && f <= 2 / 3) this.pendingPhase = 2;
    else if (this.phase === 2 && f <= 1 / 3) this.pendingPhase = 3;
  },

  _kill() {
    const c = this.crab;
    c.st = 'dead'; c.t = 2.0; c.tilt = 0; c.fall = 0;
    this.slowT = 1.5;              // the pinch: everything drags on the last hit
    this.stopT = 0.13;
    this.flash = 0.9; this.flashCol = '255,255,255';
    this._shake(5, 0.6);
    this._say('DOWN YOU GO, PUNK!', 2.2, '#a0f2b4');
    for (let i = 0; i < 34; i++)
      this._pp(c.x + rand(-14, 14), DECK_Y - rand(6, 34), rand(-170, 170), rand(-210, -20),
        rand(0.5, 1.2), rand(1, 2.6), i % 4 === 0 ? 0 : (i % 4 === 1 ? 2 : 5), BAT_K_DEBRIS, 300, true);
    this._pp(c.x, DECK_Y - 18, 0, 0, 0.5, 6, 0, BAT_K_RING, 0, false);
    SND.bite();
    SND.relief();
  },

  // ---- damage to Otto ---------------------------------------------------------------
  _hurt(amount) {
    if (this.invT > 0 || this.mode !== 'fight') return;
    const def = SUITS[G.gear.suit].def;
    const dmg = Math.max(0.5, amount - def);
    G.hearts = Math.round((G.hearts - dmg) * 2) / 2;
    this.hitsTaken++;
    this.invT = this.IFRAME_T;
    this.charging = false; this.charge = 0;
    this.flash = 0.6; this.flashCol = '232,67,76';
    this._shake(3.4, 0.34);
    this.stopT = 0.05;
    SND.hurt();
    for (let i = 0; i < 12; i++)
      this._pp(this.px - 6, DECK_Y - 16, rand(-90, 90), rand(-120, -10), rand(0.3, 0.6), rand(1, 2), 2, BAT_K_DOT, 200, false);
    if (G.hearts <= 0) { G.hearts = 0; this._lose(); }
  },

  // ---- the crab's brain ---------------------------------------------------------------
  // One flat state machine. Every attack is preceded by 'alert' (crab_10) so the
  // player always gets a readable beat to move in.
  _crabUpdate(dt) {
    const c = this.crab;
    c.t -= dt;
    c.bob += dt;

    switch (c.st) {
      case 'arrive': {
        const f = 1 - clamp(c.t / 1.9, 0, 1);
        c.x = lerp(500, 400, f);
        c.face = -1;
        c.walk += dt * 8;
        if (Math.random() < dt * 12)
          this._pp(c.x + rand(-10, 10), DECK_Y - 1, rand(-30, 10), rand(-30, -6), rand(0.3, 0.6), rand(1, 2), 4, BAT_K_DOT, 120, false);
        if (c.t <= 0) { this._say('FIGHT!', 1.2, '#ffe66e'); this._toScuttle(0.9); }
        break;
      }

      case 'scuttle': {
        const spd = 40 + this.phase * 14 + this.wave * 3;
        c.x += c.dir * spd * dt;
        c.walk += dt * (6 + spd * 0.05);
        // he keeps his distance: crowded, he backs off toward his own end
        if (c.x < BAT_CX_MIN) { c.x = BAT_CX_MIN; c.dir = 1; }
        if (c.x > BAT_CX_MAX) { c.x = BAT_CX_MAX; c.dir = -1; }
        c.face = c.dir < 0 ? -1 : 1;
        if (c.t <= 0) {
          c.next = this._pickAttack();
          c.st = 'alert'; c.t = 0.44;
          c.face = -1;
          SND.warn();
        }
        break;
      }

      case 'alert': {
        c.face = -1;
        if (c.t <= 0) {
          c.st = c.next;
          if (c.st === 'charge') {
            c.targetX = clamp(this.px, BAT_PX_MIN + 8, 300);
            c.t = 2.4; c.sub = 0;
            SND.scrape();
          } else if (c.st === 'throw') {
            c.t = 0.42; c.sub = 0;
            c.shots = this.phase === 1 ? 1 : (this.phase === 2 ? 2 : 3);
            c.shotT = 0;
          } else {   // cannon / volley
            c.t = 0.62; c.sub = 0;
            c.shots = c.st === 'volley' ? 3 : (this.phase >= 3 ? 2 : 1);
            c.shotT = 0;
            SND.pryCreak();
          }
        }
        break;
      }

      case 'charge': {
        const spd = 140 + this.phase * 26 + this.wave * 6;
        if (c.sub === 0) {
          c.x += (c.targetX < c.x ? -1 : 1) * spd * dt;
          c.face = c.targetX < c.x ? -1 : 1;
          c.walk += dt * 16;
          if (Math.random() < dt * 26)
            this._pp(c.x + rand(-8, 8), DECK_Y - 1, rand(20, 70), rand(-40, -8), rand(0.3, 0.6), rand(1, 2.2), 4, BAT_K_DOT, 140, false);
          // the cutlass connects
          const ob = this._ottoBox();
          if (c.x - 14 < ob.x1 && c.x + 14 > ob.x0) {
            this._hurt(this._atk(1.25));
            this._burst(this.px, DECK_Y - 14, 14, 2);
          }
          if (Math.abs(c.x - c.targetX) < 6 || c.t <= 0.6) { c.sub = 1; c.t = 1.8; }
        } else {
          c.x += (BAT_CX_MIN + 40 - c.x) * Math.min(1, dt * 2.4);
          c.face = 1;
          c.walk += dt * 8;
          if (c.x > BAT_CX_MIN + 24 || c.t <= 0) this._toScuttle(1.2);
        }
        break;
      }

      case 'throw': {
        if (c.sub === 0) {
          c.face = -1;
          if (c.t <= 0) { c.sub = 1; c.shotT = 0; }
        } else {
          c.shotT -= dt;
          if (c.shotT <= 0 && c.shots > 0) {
            c.shots--;
            c.shotT = 0.3;
            this._lob(c.x - 12, DECK_Y - 26, clamp(this.px + rand(-14, 14), 20, 360), 1.05, 3, this._atk(0.5));
            SND.pop(1.3);
          }
          if (c.shots <= 0 && c.shotT <= 0.05) this._toScuttle(this.phase >= 3 ? 0.9 : 1.5);
        }
        break;
      }

      case 'cannon':
      case 'volley': {
        c.face = -1;
        if (c.sub === 0) {
          if (c.t <= 0) { c.sub = 1; c.shotT = 0; }
          break;
        }
        c.shotT -= dt;
        if (c.sub === 1) {
          // paint the deck where the shot will land, then commit to that spot
          if (c.shotT <= 0 && c.shots > 0) {
            const lead = c.st === 'volley' ? 0.42 : 0.55;
            const m = this._mark(clamp(this.px + this.moveDir * 16, 16, BAT_DECK_END - 8), lead);
            c.aimAt = m.x;
            c.shotT = lead;
            c.sub = 2;
            SND.tone({ f: 620, f2: 620, type: 'square', a: 0.003, d: 0.06, v: 0.1 });
          } else if (c.shots <= 0 && c.shotT <= 0) {
            // wait out the last shot's recoil so the smoke has time to read
            this._toScuttle(this.phase >= 3 ? 1.0 : 1.6);
          }
        } else if (c.sub === 2 && c.shotT <= 0) {
          c.shots--;
          this._lob(c.x - 16, DECK_Y - 20, c.aimAt, c.st === 'volley' ? 0.62 : 0.72, 4, this._atk(1));
          this._shake(2.2, 0.14);
          SND.tone({ f: 84, f2: 34, type: 'square', a: 0.004, d: 0.24, v: 0.26 });
          SND.noise({ d: 0.3, v: 0.26, f: 200, f2: 60, q: 0.8 });
          const a = Math.PI * 0.92;
          for (let i = 0; i < 9; i++)
            this._pp(c.x - 18, DECK_Y - 20, Math.cos(a + rand(-0.4, 0.4)) * rand(30, 80), Math.sin(a + rand(-0.4, 0.4)) * rand(20, 60) - 10,
              rand(0.3, 0.7), rand(1.6, 3), i % 3 ? 3 : 7, BAT_K_SMOKE, -8, false);
          c.sub = 1;
          c.shotT = 0.36;
        }
        break;
      }

      case 'stagger': {
        c.face = -1;
        c.x += Math.sin(this.time * 5) * 6 * dt;
        if (c.t <= 0) {
          if (this.pendingPhase) this._interlude();
          else this._toScuttle(0.7);
        }
        break;
      }

      case 'interlude': {
        c.invT = Math.max(c.invT, 0.05);   // held up so the breather cannot be skipped
        c.face = -1;
        if (c.sub === 0 && c.t <= this.INTER_T * 0.55) {
          c.sub = 1;
          this.phase = this.pendingPhase;
          this.pendingPhase = 0;
          this._say(`PHASE ${this.phase}`, 1.6, '#e8434c');
          SND.chime();
        }
        if (c.banjoT > 0) {
          c.banjoT -= dt;
          if (c.banjoT <= 0 && c.taunt < 5) {
            c.taunt++;
            c.banjoT = 0.24;
            // a pentatonic pluck per beat: he is enjoying himself
            SND.tone({ f: [392, 440, 523, 587, 659][c.taunt % 5], type: 'triangle', a: 0.003, d: 0.28, v: 0.14, fx: true });
          }
        }
        if (c.t <= 0) { c.invT = 0; this._toScuttle(0.8); }
        break;
      }

      case 'dead': {
        // lies flat ON the planks — any further and he sinks through the trestle
        c.tilt = Math.min(1.1, c.tilt + dt * 2.0);
        c.fall = Math.min(2.5, c.fall + dt * 5);
        if (Math.random() < dt * 8)
          this._pp(c.x + rand(-12, 12), DECK_Y - rand(4, 20), rand(-20, 20), rand(-40, -10), rand(0.4, 0.9), rand(1.4, 3), 7, BAT_K_SMOKE, -10, false);
        if (c.t <= 0) this._win();
        break;
      }
    }
  },

  INTER_T: 2.9,

  _toScuttle(t) {
    const c = this.crab;
    // A phase change is owed the moment his health crosses a third, but it can
    // only be spent between attacks. Claiming it here as well as out of a
    // stagger means a player who never lands a solid hit still sees phase 2 and 3.
    if (this.pendingPhase && c.st !== 'interlude') { this._interlude(); return; }
    c.st = 'scuttle';
    c.t = Math.max(0.4, t - this.phase * 0.12);
    c.sub = 0;
    c.dir = this.px < c.x ? -1 : 1;
  },

  _interlude() {
    const c = this.crab;
    c.st = 'interlude'; c.t = this.INTER_T; c.sub = 0;
    c.invT = this.INTER_T;
    c.taunt = 0;
    // half the time he plays a bar of banjo, half the time he just points and
    // laughs. Either way it is the only moment in the fight nobody is shooting.
    c.banjo = Math.random() < 0.5;
    c.banjoT = c.banjo ? 0.2 : 0;
    if (!c.banjo) SND.blip();
    this._say(c.banjo ? 'he is... playing banjo at you' : 'HE POINTS AND LAUGHS', 1.5, '#ffe6b0');
  },

  _pickAttack() {
    const p = this.phase;
    if (p === 1) return weightedPick([['throw', 5], ['charge', 3]], Math.random());
    if (p === 2) return weightedPick([['cannon', 4], ['charge', 3], ['throw', 3]], Math.random());
    return weightedPick([['volley', 4], ['charge', 4], ['cannon', 3], ['throw', 2]], Math.random());
  },

  // Solve the arc that puts a projectile at (tx, DECK_Y) in T seconds. Used for
  // every one of the crab's attacks so his shots always land where they aimed.
  _lob(x, y, tx, T, kind, dmg) {
    const b = this._ball();
    b.live = true; b.x = x; b.y = y;
    b.vx = (tx - x) / T;
    b.vy = ((DECK_Y - 2) - y - 0.5 * BAT_GRAV * T * T) / T;
    b.r = kind === 4 ? 3.2 : 2.6;
    b.dmg = dmg; b.foe = true; b.kind = kind;
    b.spin = 0; b.perfect = false; b.trailT = 0; b.t = T + 2;
    return b;
  },

  // ---- particles ------------------------------------------------------------------
  _partsUpdate(dt) {
    for (const p of this.parts) {
      if (!p.live) continue;
      p.t -= dt;
      if (p.t <= 0) { p.live = false; continue; }
      if (p.kind === BAT_K_RING) continue;   // rings only grow, they do not travel
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.bounce && p.y > DECK_Y) {
        p.y = DECK_Y;
        p.vy = -p.vy * 0.34;
        p.vx *= 0.7;
        if (Math.abs(p.vy) < 12) { p.vy = 0; p.g = 0; p.bounce = false; }
      }
    }
  },

  // ---- endgame ---------------------------------------------------------------------
  _makeLoot() {
    const w = this.wave;
    const flawless = this.hitsTaken === 0;
    const money = 45 + 30 * w + (flawless ? 25 + 10 * w : 0);
    const mats = {};
    mats.crabClaw = 1 + Math.floor(w / 2) + (flawless ? 1 : 0);
    mats.brassScrap = irand(1, 2) + w;
    if (Math.random() < 0.18 + 0.1 * w) mats.pearl = 1;
    return { wave: w, money, mats, flawless, keys: Object.keys(mats) };
  },

  _win() {
    this.mode = 'won';
    this.outT = 3.2;
    this.loot = this._makeLoot();
    G.money += this.loot.money;
    for (const k in this.loot.mats) this.give(k, this.loot.mats[k]);
    G.flags.battleWins = (G.flags.battleWins || 0) + 1;
    G.flags.battleBest = Math.max(G.flags.battleBest || 0, this.wave);
    G.flags.battleRaid = false;
    if (this.loot.flawless) G.flags.battleFlawless = true;
    Game.save();
    this._say(this.loot.flawless ? 'FLAWLESS VICTORY' : 'VICTORY', 2.6, '#a0f2b4');
    SND.setScene('surface');
    SND.chime();
    SND.cash();
    for (let i = 0; i < 30; i++)
      this._pp(rand(120, 360), rand(40, 120), rand(-40, 40), rand(-20, 20), rand(0.9, 1.8), rand(1.2, 2.4), i % 3, BAT_K_DOT, 60, false);
  },

  _lose() {
    this.mode = 'lost';
    this.outT = 3.4;
    this.charging = false;
    // He does not kill you, he robs you. Losing costs money and a day's pride.
    const stolen = Math.min(G.money, 15 + 6 * this.wave);
    G.money -= stolen;
    G.hearts = 1;
    G.stats.deaths++;
    G.flags.battleRaid = true;      // he will be back tomorrow
    // same shape as a win, so a `done` callback can read it without branching
    this.loot = { wave: this.wave, money: -stolen, mats: {}, flawless: false, keys: [] };
    Game.save();
    this._say('THE DOCK IS RAIDED...', 2.8, '#e8434c');
    this.flash = 0.9; this.flashCol = '232,67,76';
    this._shake(4, 0.5);
    SND.setScene('surface');
    SND.alarm();
    if (stolen > 0) Game.toast(`The crab punk made off with ${stolen} sand dollars!`);
  },

  _flee() {
    this.mode = 'fled';
    this.outT = 1.2;
    this._say('OTTO RETREATS', 1.2, '#ffe6b0');
    SND.setScene('surface');
    SND.blip();
    G.flags.battleRaid = true;      // an unfinished raid is still a raid
    Game.save();
    Game.toast('You back off down the dock. He is still out there.');
  },

  _outro(dt) {
    this.outT -= dt;
    if (this.mode === 'won' && Math.random() < dt * 6)
      this._pp(rand(120, 360), -4, rand(-20, 20), rand(20, 50), rand(1.2, 2.2), rand(1.2, 2.2), irand(0, 2), BAT_K_DOT, 20, false);
    if (this.outT <= 0) this._finish(this.mode === 'won');
  },

  _finish(win) {
    this.active = false;
    SND.setScene('surface');
    Game.save();
    const cb = this.done;
    if (typeof cb === 'function') cb(win, this.loot);
    // Self-healing: if nobody moved us on, walk back out to the dock rather than
    // leaving the player stuck in a finished fight. No `at:` — that would teleport
    // Otto to a piling the bridge may not have reached yet.
    if (!Game.pending && Game.scene === Battle) Game.go(WorldScene, {});
  },

  // ---- draw ---------------------------------------------------------------------------
  draw(ctx) {
    if (!G || !this.crab) return;
    this._initPools();
    const shake = this.shakeT > 0 ? this.shakeMag * clamp(this.shakeT * 4, 0, 1) : 0;

    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    // ---- sea and sky: the same painted ocean the dock always sits in --------------
    const oc = `ocean${Math.floor(this.time * 8) % 12}`;
    drawA(ctx, oc, -20 - (this.time * 6) % 30, 0, 540, 270);
    SKY.tint(ctx, G.clock, this.time);

    this._drawDeck(ctx);
    this._drawMarks(ctx);
    this._drawCrab(ctx);
    this._drawOtto(ctx);
    this._drawBalls(ctx);
    this._drawParts(ctx);
    if (this.charging && this.mode === 'fight') this._drawArc(ctx);
    this._drawNums(ctx);

    ctx.restore();

    // ---- screen-space UI (inside the scene, so it takes the colour grade too) -----
    this._drawBossBar(ctx);
    this._drawAmmo(ctx);
    this._drawBanner(ctx);
    if (this.mode === 'won' && this.loot) this._drawLoot(ctx);
    if (this.retreatT > 0 && this.mode === 'fight') {
      const msg = TouchUI.enabled ? 'tap the corner again to retreat' : 'press [Esc] again to retreat';
      const w = textWidth(ctx, msg, 7) + 14;
      uiPanel(ctx, W / 2 - w / 2, 222, w, 13, 0.95, true);
      text(ctx, msg, W / 2, 225, { size: 7, color: '#7a5232', align: 'center', shadow: false });
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashCol},${clamp(this.flash, 0, 1) * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  },

  _drawDeck(ctx) {
    // one trestle module tiled across, exactly as the world scene lays it
    const pierH = assetH('dock_11', SEG_W);
    const pierTop = DECK_Y - pierH * PIER_DECK;
    for (let x = -SEG_W; x < BAT_DECK_END + SEG_W; x += SEG_W - 1)
      drawA(ctx, 'dock_11', x, pierTop, SEG_W, pierH);
    // the end gate, and lamps to read the depth of the stage against
    drawOnDeck(ctx, 'dock_10', BAT_DECK_END - 18, 30, 0.035);
    drawStanding(ctx, 'dock_15', 20, 15, 5);
    drawStanding(ctx, 'dock_15', 240, 15, 5);
    // scorch marks build up where shots have landed: the deck remembers
    ctx.fillStyle = 'rgba(30,20,12,0.16)';
    for (let i = 0; i < 5; i++) {
      const sx = 60 + i * 82 + Math.sin(i * 2.7) * 14;
      ctx.beginPath();
      ctx.ellipse(sx, DECK_Y - 1, 7 + (i % 3) * 2, 1.6, 0, 0, TAU);
      ctx.fill();
    }
  },

  // The single most important readability element in the fight: this is the
  // "move or eat a cannonball" telegraph. A thin stroke disappeared into the
  // plank texture, so it gets a filled wash, a dark rim, and a chevron that
  // falls toward the deck as the fuse burns down.
  _drawMarks(ctx) {
    for (const m of this.marks) {
      if (!m.live) continue;
      const f = 1 - m.t / m.life;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(f * 16));
      const rx = lerp(17, 9, f), ry = lerp(5, 2.6, f);
      const my = DECK_Y - 3;
      ctx.fillStyle = `rgba(232,67,76,${(0.16 + 0.24 * pulse).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(m.x, my, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,8,8,0.55)';
      ctx.lineWidth = PIX * 4;
      ctx.beginPath(); ctx.ellipse(m.x, my, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(255,120,110,${(0.55 + 0.45 * pulse).toFixed(3)})`;
      ctx.lineWidth = PIX * 2;
      ctx.beginPath(); ctx.ellipse(m.x, my, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.x - rx * 0.45, my); ctx.lineTo(m.x + rx * 0.45, my);
      ctx.moveTo(m.x, my - ry * 0.8); ctx.lineTo(m.x, my + ry * 0.8);
      ctx.stroke();
      // incoming chevron, dropping onto the mark
      const cy = lerp(my - 30, my - 9, f);
      ctx.fillStyle = 'rgba(20,8,8,0.5)';
      ctx.beginPath();
      ctx.moveTo(m.x - 4.5, cy - 4.5); ctx.lineTo(m.x + 4.5, cy - 4.5); ctx.lineTo(m.x, cy + 1.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8434c';
      ctx.beginPath();
      ctx.moveTo(m.x - 3.2, cy - 3.6); ctx.lineTo(m.x + 3.2, cy - 3.6); ctx.lineTo(m.x, cy + 0.6);
      ctx.closePath(); ctx.fill();
    }
  },

  _crabFrame() {
    const c = this.crab;
    if (c.st === 'dead') return 'crab_11';
    if (c.st === 'stagger') return 'crab_9';
    if (c.hurtT > 0) return 'crab_11';
    if (c.st === 'alert') return 'crab_10';
    if (c.st === 'charge') return 'crab_4';
    if (c.st === 'throw') return c.sub === 0 ? 'crab_5' : (Math.floor(c.bob * 9) % 2 ? 'crab_4' : 'crab_5');
    // frame 8 IS him with the cannon shouldered, so the artillery states use it
    // directly rather than pasting a prop next to him
    if (c.st === 'cannon' || c.st === 'volley') return c.sub === 0 ? 'crab_6' : 'crab_8';
    if (c.st === 'interlude') return c.banjo ? 'crab_7' : 'crab_5';
    if (c.st === 'arrive') return 'crab_4';
    return `crab_${Math.floor(c.walk * 0.5) % 4}`;   // scuttling: the four idles
  },

  _drawCrab(ctx) {
    const c = this.crab;
    const name = this._crabFrame();
    const a = this._art(name, BAT_CRAB_S);
    const flip = BAT_CRAB_FACES_LEFT ? c.face > 0 : c.face < 0;

    // contact shadow, tight when he is planted and wide mid-scuttle
    ctx.fillStyle = 'rgba(30,16,8,0.22)';
    ctx.beginPath();
    ctx.ellipse(c.x, DECK_Y + 1, 15, 2.2, 0, 0, TAU);
    ctx.fill();

    if (!a) return;
    const bob = c.st === 'scuttle' ? Math.abs(Math.sin(c.walk * 0.9)) * 1.6 : 0;
    const wob = c.st === 'stagger' ? Math.sin(this.time * 17) * 0.09 : 0;
    // Tipping over rotates about his feet, which would swing the body down
    // through the trestle — so the pivot rises as he goes over and he ends up
    // lying ACROSS the planks instead of hanging under them.
    const lay = Math.sin(c.tilt) * a.w * 0.45;
    ctx.save();
    ctx.translate(Math.round(c.x * DPX) / DPX, DECK_Y + 0.5 + c.fall - lay);
    ctx.rotate(wob + c.tilt);
    ctx.scale(flip ? -1 : 1, 1);
    // the hurt frame flashes white by drawing it twice with a lighten pass
    ctx.drawImage(ASSETS[name], -a.w / 2, -a.h - bob, a.w, a.h);
    if (c.hurtT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(c.hurtT * 3, 0, 0.7);
      ctx.drawImage(ASSETS[name], -a.w / 2, -a.h - bob, a.w, a.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // stagger stars, and the guard shimmer during a taunt
    if (c.st === 'stagger') {
      ctx.fillStyle = '#ffe66e';
      for (let i = 0; i < 3; i++) {
        const ang = this.time * 4 + i * TAU / 3;
        const sx = c.x + Math.cos(ang) * 12, sy = DECK_Y - 38 + Math.sin(ang) * 3;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }
    if (c.invT > 0) {
      // dark rim under a bright one, or the shimmer vanishes into the sky and the
      // player cannot tell why their shots are bouncing off
      const puls = 0.5 + 0.5 * Math.sin(this.time * 9);
      ctx.lineWidth = PIX * 5;
      ctx.strokeStyle = 'rgba(10,30,44,0.4)';
      ctx.beginPath(); ctx.ellipse(c.x, DECK_Y - 17, 19, 21, 0, 0, TAU); ctx.stroke();
      ctx.lineWidth = PIX * 2.5;
      ctx.strokeStyle = `rgba(150,235,255,${(0.45 + 0.35 * puls).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(c.x, DECK_Y - 17, 19, 21, 0, 0, TAU); ctx.stroke();
    }
  },

  // The deck gun has no art of its own — crab_8 is the crab HOLDING a cannon, not
  // a prop — so the carriage is drawn in code from the same driftwood-and-iron
  // palette as the dock. Wheels first, then the trail, then the barrel on top.
  _drawCarriage(ctx) {
    const cx = this.pivX(), wy = DECK_Y - 3.2;
    // trail: a wooden wedge braced against the planks
    ctx.fillStyle = '#5a3a1e';
    ctx.beginPath();
    ctx.moveTo(cx - 11, DECK_Y - 1); ctx.lineTo(cx + 5, DECK_Y - 8);
    ctx.lineTo(cx + 9, DECK_Y - 5.5); ctx.lineTo(cx - 9, DECK_Y + 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a6434';
    ctx.beginPath();
    ctx.moveTo(cx - 11, DECK_Y - 1); ctx.lineTo(cx + 5, DECK_Y - 8);
    ctx.lineTo(cx + 6, DECK_Y - 7); ctx.lineTo(cx - 10, DECK_Y - 0.2);
    ctx.closePath(); ctx.fill();
    // cheeks the trunnion sits in
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(cx - 4, DECK_Y - 14, 9, 8);
    ctx.fillStyle = '#c9a271';
    ctx.fillRect(cx - 4, DECK_Y - 14, 9, 1.2);
    // wheels
    for (let i = 0; i < 2; i++) {
      const wx = cx + (i ? 5.5 : -5.5);
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath(); ctx.arc(wx, wy, 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a6434';
      ctx.beginPath(); ctx.arc(wx, wy, 2.4, 0, TAU); ctx.fill();
      // spokes: turn with the roll so the rig reads as moving
      ctx.strokeStyle = '#5a3a1e';
      ctx.lineWidth = PIX * 2;
      const rot = this.px * 0.35;
      for (let k = 0; k < 2; k++) {
        const ang = rot + k * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(wx - Math.cos(ang) * 2.2, wy - Math.sin(ang) * 2.2);
        ctx.lineTo(wx + Math.cos(ang) * 2.2, wy + Math.sin(ang) * 2.2);
        ctx.stroke();
      }
    }
  },

  _drawOtto(ctx) {
    const px = this.px;
    ctx.fillStyle = 'rgba(30,16,8,0.22)';
    ctx.beginPath();
    ctx.ellipse(px, DECK_Y + 1, 16, 2.2, 0, 0, TAU);
    ctx.fill();

    // ---- Otto, one step behind the breech ---------------------------------------
    const walking = this.moveDir !== 0;
    const blink = this.invT > 0 && Math.floor(this.time * 20) % 2 === 0;
    const frames = walking ? ['o4_4', 'o4_5', 'o4_6', 'o4_7'] : ['o4_0', 'o4_1', 'o4_2', 'o4_3'];
    const fname = frames[Math.floor(walking ? this.walkT * 0.8 : this.time * 2.2) % 4];
    const img = ASSETS[fname];
    if (img && img.width && !blink) {
      const oh = 30, ow = oh * img.width / img.height;
      const hop = walking ? Math.abs(Math.sin(this.walkT * 2.2)) * 1.4 : 0;
      const sqy = 1 + Math.sin(this.time * 2.1) * 0.02 + (this.charging ? this.charge * 0.05 : 0);
      ctx.save();
      ctx.translate(Math.round((px - 13) * DPX) / DPX, DECK_Y + 0.5 - hop);
      ctx.scale(1 / (sqy > 0 ? sqy : 1), sqy);
      ctx.drawImage(img, -ow / 2, -oh + 0.5, ow, oh);
      ctx.restore();
    }

    // ---- the gun: carriage over Otto's paws, barrel swinging with the aim --------
    this._drawCarriage(ctx);
    const a = this.aimAngle();
    const pxp = this.pivX(), pyp = this.pivY();
    ctx.save();
    ctx.translate(pxp, pyp);
    ctx.rotate(a);
    ctx.fillStyle = '#3a4046';
    ctx.fillRect(-4, -2.8, 19, 5.6);
    ctx.fillStyle = '#5a636b';
    ctx.fillRect(-4, -2.8, 19, 1.6);
    ctx.fillStyle = '#c9a271';
    ctx.fillRect(12.5, -3.4, 2.6, 6.8);
    ctx.fillRect(1, -3.2, 1.6, 6.4);
    ctx.fillStyle = '#14181c';
    ctx.fillRect(15, -2.2, 1.4, 4.4);
    ctx.restore();
    // the trunnion cap hides the pivot seam
    ctx.fillStyle = '#6d4526';
    ctx.beginPath();
    ctx.arc(pxp, pyp, 3.2, 0, TAU);
    ctx.fill();

    // ---- hearts, riding above the rig so they are where the action is -----------
    const hearts = G.maxHearts;
    const hw = hearts * 7.2;
    ctx.save();
    ctx.globalAlpha = this.invT > 0 ? 1 : 0.82;
    ctx.translate(px - hw / 2, DECK_Y - 44 + (this.invT > 0 ? Math.sin(this.time * 30) * 0.6 : 0));
    ctx.scale(0.72, 0.72);
    for (let i = 0; i < hearts; i++) {
      const kind = G.hearts >= i + 1 ? 'full' : (G.hearts >= i + 0.5 ? 'half' : 'empty');
      drawHeart(ctx, i * 10, 0, kind);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // ---- power meter, bolted to the carriage -------------------------------------
    if (this.charging || this.fireCd > 0) {
      const mw = 30, mx = px - mw / 2, my = DECK_Y - 34;
      const f = this.charging ? this.charge : 0;
      rrect(ctx, mx, my, mw, 4, 'rgba(20,14,10,0.75)', 'rgba(226,200,150,0.5)');
      // the sweet band, marked so the timing is learnable
      ctx.fillStyle = 'rgba(255,230,110,0.35)';
      ctx.fillRect(mx + 1 + (mw - 2) * this.SWEET_LO, my + 1, (mw - 2) * (this.SWEET_HI - this.SWEET_LO), 2);
      const sweet = f >= this.SWEET_LO && f <= this.SWEET_HI;
      ctx.fillStyle = sweet ? '#ffe66e' : (f >= 1 ? '#ff9a3c' : '#5ad2f0');
      ctx.fillRect(mx + 1, my + 1, (mw - 2) * f, 2);
      if (sweet) {
        text(ctx, 'NOW', px, my - 9, { size: 7, color: '#ffe66e', align: 'center' });
      }
    }
  },

  _drawBalls(ctx) {
    for (const b of this.balls) {
      if (!b.live) continue;
      if (b.kind === 3) {
        // a thrown shell, spinning
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        drawAC(ctx, 'shell_cockle', 0, 0, 8);
        ctx.restore();
        continue;
      }
      if (b.kind === 0) {
        ctx.fillStyle = b.perfect ? '#ffe66e' : '#2a2f33';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.fillStyle = b.perfect ? '#fff8e0' : '#6a747c';
        ctx.fillRect(b.x - b.r * 0.5, b.y - b.r * 0.7, b.r * 0.7, b.r * 0.5);
      } else if (b.kind === 1) {
        ctx.fillStyle = '#8a6434';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9a271';
        ctx.fillRect(b.x - 0.8, b.y - 1.2, 1, 1);
      } else {
        ctx.fillStyle = '#241a12';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8434c';
        ctx.fillRect(b.x - 0.6, b.y - 0.6, 1.2, 1.2);
      }
    }
  },

  // One pass per colour so fillStyle is set at most eight times a frame and no
  // colour string is ever built inside the loop.
  _drawParts(ctx) {
    const parts = this.parts;
    for (let ci = 0; ci < BAT_PCOL.length; ci++) {
      let set = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p.live || p.col !== ci || p.kind === BAT_K_RING) continue;
        if (!set) { ctx.fillStyle = BAT_PCOL[ci]; set = true; }
        const f = p.t / p.life;
        if (p.kind === BAT_K_SMOKE) {
          ctx.globalAlpha = clamp(f * 0.55, 0, 0.55);
          const r = p.s * (1 + (1 - f) * 1.5);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        } else if (p.kind === BAT_K_SPARK) {
          ctx.globalAlpha = clamp(f * 1.4, 0, 1);
          // streak along the dominant axis: no per-particle transform needed
          const L = 1 + Math.min(6, (Math.abs(p.vx) + Math.abs(p.vy)) * 0.022);
          if (Math.abs(p.vx) > Math.abs(p.vy)) ctx.fillRect(p.x, p.y, p.vx > 0 ? L : -L, p.s);
          else ctx.fillRect(p.x, p.y, p.s, p.vy > 0 ? L : -L);
        } else if (p.kind === BAT_K_DEBRIS) {
          ctx.globalAlpha = clamp(f * 1.6, 0, 1);
          ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        } else {
          ctx.globalAlpha = clamp(f * 1.3, 0, 1);
          const r = p.s * (0.5 + f * 0.7);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    // rings stroke instead of fill; there are never more than a handful alive
    ctx.lineWidth = PIX * 3;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.live || p.kind !== BAT_K_RING) continue;
      const f = p.t / p.life;
      ctx.globalAlpha = clamp(f, 0, 1) * 0.8;
      ctx.strokeStyle = BAT_PCOL[p.col];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s + (1 - f) * 16, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  _drawNums(ctx) {
    for (const n of this.nums) {
      if (!n.live) continue;
      const f = n.t / n.life;
      ctx.globalAlpha = clamp(f * 1.6, 0, 1);
      const size = n.crit ? 13 - f * 2 : 9;
      text(ctx, n.txt, n.x, n.y, {
        size, align: 'center',
        color: n.crit ? '#ffe66e' : '#f6e8c9',
      });
      ctx.globalAlpha = 1;
    }
  },

  // Dotted parabola from the muzzle, sampled with the same gravity the shot uses,
  // so what you see is exactly what the ball will do.
  _drawArc(ctx) {
    const heavy = this.ammo() > 0;
    const a = this.aimAngle();
    const sp = this._speed(clamp(this.charge, 0.14, 1), heavy);
    let x = this.pivX() + Math.cos(a) * 15, y = this.pivY() + Math.sin(a) * 15;
    let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
    const step = 0.028;   // dense enough to read as a line over a 350-unit arc
    const cb = this._crabBox();
    let n = 0, hit = false;
    for (let i = 0; i < this.MAXPR; i++) {
      vy += BAT_GRAV * step;
      x += vx * step;
      y += vy * step;
      if (x > cb.x0 && x < cb.x1 && y > cb.y0 && y < cb.y1) { hit = true; }
      this._prx[n] = x; this._pry[n] = y; n++;
      if (hit) break;
      if (y >= DECK_Y && x < BAT_DECK_END) break;
      if (y >= BAT_WATER_Y || x > W + 40) break;
    }
    // Two passes, dark under bright: a single pale colour vanished completely
    // against the bright painted sky, which is most of where the arc lives.
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? '#14202a' : (hit ? '#ffe66e' : '#fff8e0');
      const s = pass === 0 ? 2.6 : 1.7;
      for (let i = 0; i < n; i++) {
        if (i % 3) continue;                     // dotted, not a solid line
        ctx.globalAlpha = ((1 - i / n) * 0.6 + 0.4) * (pass === 0 ? 0.55 : 1);
        ctx.fillRect(this._prx[i] - s / 2, this._pry[i] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    // landing marker
    if (n > 0) {
      const lx = this._prx[n - 1], ly = this._pry[n - 1];
      ctx.strokeStyle = hit ? '#ffe66e' : 'rgba(191,232,245,0.7)';
      ctx.lineWidth = PIX * 2;
      ctx.beginPath();
      ctx.moveTo(lx - 3, ly - 3); ctx.lineTo(lx + 3, ly + 3);
      ctx.moveTo(lx + 3, ly - 3); ctx.lineTo(lx - 3, ly + 3);
      ctx.stroke();
    }
  },

  // ---- UI --------------------------------------------------------------------------
  _drawBossBar(ctx) {
    const c = this.crab;
    // sits just under the HUD strip (y 6..36) so nothing overlaps
    const bx = 96, by = 40, bw = 288, bh = 9;
    uiPanel(ctx, bx - 4, by - 12, bw + 8, bh + 16, 0.86);
    text(ctx, 'CRAB PUNK', bx, by - 10, { size: 8, color: '#e8434c' });
    text(ctx, `WAVE ${this.wave}`, bx + bw, by - 10, { size: 7, color: '#c9a271', align: 'right' });

    rrect(ctx, bx, by, bw, bh, 'rgba(16,10,8,0.85)');
    const fShown = clamp(c.hpShown / c.hpMax, 0, 1);
    const fReal = clamp(c.hp / c.hpMax, 0, 1);
    // the chip bar lags behind, so a big hit reads as a chunk coming off
    ctx.fillStyle = '#f6e8c9';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * fShown, bh - 2);
    ctx.fillStyle = c.st === 'stagger' ? '#ffe66e' : '#e8434c';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * fReal, bh - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * fReal, 2);
    // phase dividers at the thirds
    ctx.fillStyle = 'rgba(10,6,4,0.8)';
    ctx.fillRect(bx + (bw / 3) - 0.5, by, 1, bh);
    ctx.fillRect(bx + (2 * bw / 3) - 0.5, by, 1, bh);
    ctx.strokeStyle = 'rgba(226,200,150,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    // phase pips
    for (let i = 0; i < 3; i++) {
      const on = this.phase >= 3 - i;
      ctx.fillStyle = on ? '#ffe66e' : 'rgba(226,200,150,0.25)';
      ctx.fillRect(bx + bw - 4 - i * 6, by + bh + 2.5, 4, 3);
    }
    if (c.st === 'stagger')
      text(ctx, 'x2 DAMAGE', bx + bw / 2, by + bh + 2, { size: 7, color: '#ffe66e', align: 'center' });
  },

  _drawAmmo(ctx) {
    const n = this.ammo();
    uiPanel(ctx, 6, 40, 74, 20, 0.88, true);
    // an iron ball, drawn rather than borrowed: no asset in the manifest is one
    ctx.fillStyle = n > 0 ? '#2a2f33' : 'rgba(42,47,51,0.35)';
    ctx.beginPath(); ctx.arc(16, 50, 5, 0, TAU); ctx.fill();
    if (n > 0) {
      ctx.fillStyle = '#6a747c';
      ctx.fillRect(13.5, 46.8, 2.6, 1.8);
    }
    const col = n > 0 ? '#4a3020' : '#e8434c';
    text(ctx, n > 0 ? `x${n}` : 'EMPTY', 26, 46.5, { size: 8, color: col, shadow: false });
    if (n <= 0)
      text(ctx, 'scrap shot', 26, 53.5, { size: 6, color: '#7a5232', shadow: false });
  },

  _drawBanner(ctx) {
    if (this.bannerT <= 0) return;
    const f = this.bannerT / this.bannerLife;
    // pop in fast, hold, fade out
    const pop = f > 0.85 ? 1 + (f - 0.85) * 2.6 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(f * 2.4, 0, 1);
    ctx.translate(W / 2, 96);
    ctx.scale(pop, pop);
    text(ctx, this.banner, 0, 0, { size: 14, color: this.bannerCol, align: 'center' });
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  _matName(k) {
    if (BAT_MAT_NAMES[k]) return BAT_MAT_NAMES[k];
    if (typeof ITEMS !== 'undefined' && ITEMS[k]) return ITEMS[k].name;
    return k.charAt(0).toUpperCase() + k.slice(1);
  },

  _drawLoot(ctx) {
    const keys = this.loot.keys || [];
    const h = 46 + keys.length * 13;
    const w = 176, x = W / 2 - w / 2, y = 118;
    uiPanel(ctx, x, y, w, h, 0.95, true);
    text(ctx, 'SPOILS OF THE DOCK', x + w / 2, y + 6, { size: 8, color: '#7a5232', align: 'center', shadow: false });
    drawAC(ctx, 'shell_pearl', x + 16, y + 24, 12);
    text(ctx, `+${this.loot.money} sand dollars`, x + 26, y + 20, { size: 8, color: '#4a3020', shadow: false });
    let ly = y + 36;
    for (const k of keys) {
      if (typeof ITEMS !== 'undefined' && ITEMS[k]) {
        drawItemIcon(ctx, k, x + 16, ly + 4, 11);
      } else {
        // no art for a crafting material: a small stamped chip stands in
        ctx.fillStyle = '#8a6434';
        ctx.beginPath();
        ctx.moveTo(x + 16, ly - 1); ctx.lineTo(x + 21, ly + 4); ctx.lineTo(x + 16, ly + 9); ctx.lineTo(x + 11, ly + 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c9a271';
        ctx.fillRect(x + 14.5, ly + 2.5, 3, 3);
      }
      text(ctx, `${this._matName(k)} x${this.loot.mats[k]}`, x + 26, ly, { size: 8, color: '#4a3020', shadow: false });
      ly += 13;
    }
    if (this.loot.flawless)
      text(ctx, 'not a scratch on you', x + w / 2, y + h - 12, { size: 7, color: '#3f9a58', align: 'center', shadow: false });
  },

  // ---- self-contained wiring ---------------------------------------------------------
  // Battle is a SCENE, so main.js drives update/draw for free — the only thing it
  // cannot know about is the touch layout, which returns nothing for a scene it has
  // never heard of. Aiming and firing already work on touch: a touch that misses a
  // button IS the virtual mouse, so drag-to-aim / release-to-fire comes for free,
  // and only the two dodge buttons have to be added.
  install() {
    if (this._installed || typeof TouchUI === 'undefined' || typeof Game === 'undefined') return;
    this._installed = true;
    const tLayout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (Battle.active && Game.scene === Battle) {
        const b = [];
        if (Game.helpOpen) return b;
        b.push({ x: 8, y: H - 52, w: 44, h: 44, key: 'ArrowLeft', icon: 'left' });
        b.push({ x: 58, y: H - 52, w: 44, h: 44, key: 'ArrowRight', icon: 'right' });
        return b;
      }
      return tLayout();
    };
  },
};

// This file loads before js/main.js, so Game/TouchUI/Input do not exist yet —
// install on DOMContentLoaded (which fires after every classic script in the
// body) and cope with either order, exactly as the other systems do.
if (typeof Game !== 'undefined') Battle.install();
else document.addEventListener('DOMContentLoaded', () => Battle.install(), { once: true });
