// ---- DIVE MODE: first-person scraping minigame ----------------------------
'use strict';

const DiveScene = {
  customCursor: true,
  WALL_X: 150, WALL_W: 180,

  p: 0, nodes: [], totalHarv: 1,
  camY: 0, maxCam: 0, camVel: 0,
  air: 0, airMax: 0, airBeepT: 0,
  bag: {}, bagCount: 0, bagPulse: 0,
  particles: [], floaters: [], flyIcons: [], fish: [], snow: [], bubbles: [],
  combo: 0, comboT: 0, scrapeT: 0,
  barra: null,
  shark: null, sharkCooldown: 45, sharkRollT: 1,
  whaleT: 25,
  gloom: 0, gloomTarget: 0,
  shakeT: 0, flash: 0, flashCol: '232,60,60', slowT: 0,
  msg: '', msgT: 0, banner: '', bannerT: 0,
  time: 0, wallCanvas: null,
  over: false, overT: 0,

  enter(p) {
    this.p = p;
    this.time = 0;
    this.camY = 0; this.camVel = 0;
    this.maxCam = 1e9;   // the sea has no floor — your O2 does
    this.scars = [];
    this.reward = null;
    this.airMax = TANKS[G.gear.tank].air;
    this.air = this.airMax;
    this.airBeepT = 0;
    this.bag = {}; this.bagCount = 0; this.bagPulse = 0;
    this.particles = []; this.floaters = []; this.flyIcons = []; this.bubbles = [];
    this.combo = 0; this.comboT = 0; this.scrapeT = 0;
    this.msg = ''; this.msgT = 0; this.banner = ''; this.bannerT = 0;
    this.shakeT = 0; this.flash = 0; this.slowT = 0;
    this.over = false; this.overT = 0;
    this.gloom = 0; this.gloomTarget = 0;
    this.shark = null;
    this.sharkCooldown = rand(40, 70);
    this.sharkRollT = 1;
    this.whaleT = rand(20, 50);
    this.barra = { state: 'idle', t: rand(8, 16), y: 0, x: 0, dir: 1, hit: false };
    this.pry = null;          // active pry minigame { n, t, speed, win, marker }
    this.numbT = 0;           // jellyfish sting lockout
    this.surfaceT = 0;        // held-up-at-top timer
    this.genChunks = 0;
    this.nodes = [];
    this.ensureDepth(H * 2);
    // jellyfish drift up through the water column
    this.jellies = [];
    const jcount = 3 + (p >= 1 ? 1 : 0);
    for (let i = 0; i < jcount; i++) {
      this.jellies.push({
        x: Math.random() < 0.6 ? (Math.random() < 0.5 ? rand(20, this.WALL_X - 20) : rand(this.WALL_X + this.WALL_W + 20, W - 20)) : rand(this.WALL_X, this.WALL_X + this.WALL_W),
        wy: rand(120, 900), vy: rand(6, 13), sway: rand(TAU), r: rand(8, 13), cd: 0,
      });
    }
    // schools of little fish weaving behind the piling
    this.schools = [];
    for (let s = 0; s < 2; s++) {
      const members = [];
      const count = irand(5, 8);
      for (let i = 0; i < count; i++) members.push({ ox: -i * 7 - rand(0, 4), oy: rand(-8, 8), ph: rand(TAU) });
      this.schools.push({ x: rand(0, W), y: rand(40, H - 40), dir: Math.random() < 0.5 ? 1 : -1, speed: rand(22, 34), ph: rand(TAU), members, flee: false });
    }
    // night plankton
    this.plankton = [];
    for (let i = 0; i < 26; i++) this.plankton.push({ x: rand(W), y: rand(H), v: rand(2, 6), ph: rand(TAU) });
    // ambient fish
    this.fish = [];
    for (let i = 0; i < 9; i++) {
      const left = Math.random() < 0.5;
      this.fish.push({
        x: left ? rand(0, this.WALL_X - 10) : rand(this.WALL_X + this.WALL_W + 10, W),
        y: rand(20, H - 20), vx: rand(6, 18) * (Math.random() < 0.5 ? 1 : -1),
        size: rand(3, 6), phase: rand(TAU), flee: false, alpha: 1, side: left ? 0 : 1,
      });
    }
    this.snow = [];
    for (let i = 0; i < 40; i++) this.snow.push({ x: rand(W), y: rand(H), v: rand(3, 9), drift: rand(TAU) });
    SND.setScene('dive');
    SND.splash();
    if (!G.flags.seenDive) {
      G.flags.seenDive = true;
      Game.toast('Scrape the crust off a shell... then HOLD on it to pry —');
      Game.toast('release when the marker is in the GREEN!');
      Game.toast('No magic resurfacing: swim UP yourself, and mind your O2!');
    }
    if (this.p === 2 && !G.flags.seenDeep) {
      G.flags.seenDeep = true;
      Game.toast('It\'s dark down here. And very quiet...');
    }
  },

  // ---- endless chunked generation: the deeper you go, the richer it gets --------
  depthFrac() { return clamp((this.camY + this.p * 350) / 1600, 0, 1); },

  ensureDepth(y) {
    const CH = 560;
    while (this.genChunks * CH < y + H) this.genChunk(this.genChunks++);
  },

  genChunk(ci) {
    const p = this.p;
    const CH = 560;
    const rng = mulberry32(G.seeds[p] * 7919 + p * 101 + ci * 131 + 13);
    const harvested = new Set(G.harvested && G.harvested[p] ? G.harvested[p] : []);
    const y0 = ci * CH;
    for (let r = 0; r < 10; r++) {
      const wy = y0 + r * 56 + rng() * 24;
      if (wy < 84) continue;
      const depth = wy + p * 350;
      const d = clamp(depth / 1400, 0, 1);
      const count = rng() < 0.3 + d * 0.25 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const kind = weightedPick([
          ['clam', 5 - 3 * d],
          ['mussel', 1.2 + 1.5 * d],
          ['barnacle', Math.max(0.6, 2.2 - d)],
          ['oyster', depth > 320 ? 0.5 + 2.4 * d : 0],
          ['abalone', depth > 750 ? 2.6 * d : 0],
          ['urchin', 0.4 + 1.6 * d],
        ], rng());
        const nd = NODE_DEFS[kind];
        const id = ci * 100 + r * 4 + i;
        const aliveRoll = rng();
        const alive = !harvested.has(id) && (kind === 'urchin'
          || aliveRoll < clamp(G.growth[p] * (0.55 + 0.9 * Math.min(1, wy / 1500)), 0, 1));
        this.nodes.push({
          id,
          x: this.WALL_X + 28 + rng() * (this.WALL_W - 56) + (count === 2 ? (i === 0 ? -34 : 34) : 0),
          y: wy,
          kind, r: nd.r * (0.9 + rng() * 0.25),
          hp: Math.max(1, nd.crust), maxHp: Math.max(1, nd.crust),
          stage: nd.crust > 0 ? 'crusted' : 'exposed',
          seed: Math.floor(rng() * 99999), alive, shake: 0, phase: rng() * TAU, clampT: 0,
        });
      }
    }
    // one moray den per chunk or so, once past the shallows
    if (y0 > 220 && rng() < 0.7) {
      this.nodes.push({
        kind: 'eelhole', decor: true, alive: true,
        x: this.WALL_X + 34 + rng() * (this.WALL_W - 68), y: y0 + 80 + rng() * (CH - 160),
        r: 12, seed: Math.floor(rng() * 99999), phase: rng() * TAU,
        eel: { state: 'hidden', t: 3 + rng() * 5 },
      });
    }
  },


  // ---- helpers --------------------------------------------------------------
  bagValue() {
    let v = 0;
    for (const k in this.bag) v += (ITEMS[k] ? ITEMS[k].price : 0) * this.bag[k];
    return v;
  },

  msgSet(m, t = 2.2) { this.msg = m; this.msgT = t; },
  bannerSet(m, t = 1.6) { this.banner = m; this.bannerT = t; },

  nodeAt(mx, my) {
    for (const n of this.nodes) {
      if (!n.alive || n.decor) continue;
      const dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  },

  // ---- pry minigame -----------------------------------------------------------
  startPry(n) {
    const pd = NODE_DEFS[n.kind].pry;
    if (!pd) return;
    const bar = PRYBARS[G.gear.pry];
    this.pry = { n, t: 0, speed: pd.speed * bar.speed, win: pd.win + bar.bonus, marker: 0 };
    SND.pryCreak();
  },

  resolvePry(success) {
    const n = this.pry.n;
    this.pry = null;
    if (success) {
      this.popNode(n);
    } else {
      n.clampT = 0.7;
      n.shake = 1;
      SND.clank();
      this.msgSet(pick(['It clamps down tight!', 'Slipped!', 'Almost had it...']));
      if (n.kind === 'urchin') this.hurtPlayer(0.5);
      this.shakeT = Math.max(this.shakeT, 0.15);
    }
  },

  hurtPlayer(amount) {
    const def = SUITS[G.gear.suit].def;
    const dmg = Math.max(0.5, amount - def);
    G.hearts = Math.round((G.hearts - dmg) * 2) / 2;
    SND.hurt();
    this.flash = 0.5; this.flashCol = '232,60,60';
    this.shakeT = Math.max(this.shakeT, 0.3);
    if (G.hearts <= 0) { G.hearts = 0; this.blackout(); }
  },

  blackout() {
    if (this.over) return;
    this.over = true; this.overT = 0;
    SND.padOff();
    SND.setScene('surface');
  },

  spillBag(n) {
    const keys = Object.keys(this.bag).filter(k => this.bag[k] > 0);
    let spilled = 0;
    while (n-- > 0 && keys.length) {
      const k = pick(keys);
      this.bag[k]--; this.bagCount--; spilled++;
      if (this.bag[k] <= 0) keys.splice(keys.indexOf(k), 1);
      for (let i = 0; i < 3; i++)
        this.particles.push({
          x: Input.mouse.x + rand(-6, 6), y: Input.mouse.y + this.camY + rand(-6, 6),
          vx: rand(-30, 30), vy: rand(20, 70), t: rand(0.6, 1.2), col: ITEMS[k].color, s: 2,
        });
    }
    if (spilled) this.msgSet(`Dropped ${spilled} shells!`);
  },

  popNode(n) {
    n.alive = false;
    const drop = NODE_DEFS[n.kind].drop;
    const gained = [drop];
    // loose pearls are a rare dive treat — most come from cracking at the bench
    if (n.kind === 'oyster' && Math.random() < 0.04 + this.depthFrac() * 0.05) gained.push('pearl');
    for (const it of gained) {
      this.bag[it] = (this.bag[it] || 0) + 1;
      this.bagCount++;
    }
    G.stats.scraped++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 2.2;
    SND.pop(1 + Math.min(this.combo, 12) * 0.05);
    if (gained.includes('pearl')) {
      SND.chime(); this.bannerSet('* PEARL! *'); G.stats.pearls++;
    }
    const col = ITEMS[drop].color;
    // spinning shell chunks + dust + a pop ring
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: n.x + rand(-3, 3), y: n.y + rand(-3, 3),
        vx: rand(-60, 60), vy: rand(-80, 15), t: rand(0.4, 0.9),
        col: Math.random() < 0.3 ? '#fff' : col, s: rand(1, 2.4),
        rot: rand(TAU), vr: rand(-9, 9), chunk: true,
      });
    }
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        x: n.x + rand(-4, 4), y: n.y + rand(-4, 4),
        vx: rand(-20, 20), vy: rand(-30, 5), t: rand(0.3, 0.6),
        col: 'rgba(210,200,180,0.7)', s: 1,
      });
    }
    this.particles.push({ x: n.x, y: n.y, t: 0.35, ring: true, r: 2, vr: 52, col: 'rgba(255,255,255,0.8)' });
    // remember the harvest for the rest of the day + leave a scraped scar decal
    if (n.id !== undefined) {
      if (!G.harvested) G.harvested = {};
      if (!G.harvested[this.p]) G.harvested[this.p] = [];
      G.harvested[this.p].push(n.id);
    }
    this.scars.push({ x: n.x, y: n.y, rx: n.r * 0.8, ry: n.r * 0.6 });
    // stardew-style reward pop: the shell rises, shining, then dives into the bag
    this.reward = { art: ITEM_ART[drop] || 'shell_clam', name: ITEMS[drop].name, t: 0, x: clamp(n.x, 60, W - 60), y: n.y - this.camY, extra: gained.length > 1 };

    if (navigator.vibrate) { try { navigator.vibrate(this.combo >= 5 ? 22 : 12); } catch (e) {} }
    this.slowT = 0.06;
    this.shakeT = Math.max(this.shakeT, 0.05);
  },

  surface(forced) {
    // deposit bag into storage
    let count = 0, value = 0;
    for (const k in this.bag) {
      G.storage[k] = (G.storage[k] || 0) + this.bag[k];
      count += this.bag[k];
      value += ITEMS[k].price * this.bag[k];
    }
    if (G.flags.pendingRegrow) Game.newDayRegrow(true);
    SND.splash();
    SND.setScene('surface');
    if (count > 0) Game.toast(`Stored ${count} shells (worth ~$${value})`);
    if (forced) Game.toast('You surfaced gasping for air! (-1 heart)');
    Game.save();
    Game.go(WorldScene, { at: this.p });
  },


  // ---- shark event -----------------------------------------------------------
  startShark() {
    this.shark = { state: 'omen', t: 4.2, x: -220, y: H * 0.35, s: 0.55, alpha: 0, sus: 0, dir: 1, bit: false };
    this.gloomTarget = 0.5;
    for (const f of this.fish) f.flee = true;
    SND.setScene('shark');
    this.msgSet('...the water goes quiet.', 3);
  },

  updateShark(dt) {
    const sh = this.shark;
    if (!sh) {
      this.sharkCooldown -= dt;
      this.sharkRollT -= dt;
      if (this.sharkCooldown <= 0 && this.sharkRollT <= 0) {
        this.sharkRollT = 1;
        const depthFrac = this.depthFrac();
        const pch = 0.004 + 0.012 * depthFrac + (isNight(G.clock) ? 0.008 : 0)
          + 0.004 * this.p + Math.min(0.004, this.bagValue() / 30000);
        if (Math.random() < pch) this.startShark();
      }
      return;
    }
    sh.t -= dt;
    if (sh.state === 'omen') {
      sh.alpha = 0;
      if (sh.t <= 0) {
        sh.state = 'pass'; sh.t = 4; sh.alpha = 0.35;
        sh.x = -220; sh.y = H * rand(0.25, 0.5); sh.dir = 1; sh.s = 0.55;
        SND.whale();
      }
    } else if (sh.state === 'pass') {
      sh.x += (W + 440) / 4 * dt;
      if (sh.t <= 0) {
        sh.state = 'stare'; sh.t = rand(5.5, 8.5);
        sh.sus = 0; sh.alpha = 0.9;
        sh.x = W + 200; sh.y = H * 0.45; sh.dir = -1; sh.s = 0.8;
        sh.armed = !Input.mouse.down;   // don't bust a click held from before
        this.msgSet('', 0);
      }
    } else if (sh.state === 'stare') {
      // drifts to center, watching you
      sh.x = lerp(sh.x, W * 0.5 + Math.sin(this.time * 0.8) * 30, dt * 1.5);
      sh.y = lerp(sh.y, H * 0.42 + Math.cos(this.time * 0.6) * 12, dt * 1.5);
      sh.s = Math.min(1.2, sh.s + dt * 0.08);
      // suspicion: movement is death
      const spd = Input.mouse.speed;
      if (spd > 26) sh.sus += (spd - 26) * dt * 0.004;
      if (Math.abs(this.camVel) > 4) sh.sus += dt * 0.6;
      if (!Input.mouse.down) sh.armed = true;
      else if (sh.armed) sh.sus = 9;
      if (sh.sus >= 1) {
        sh.state = 'attack'; sh.t = 0.9; sh.bit = false;
      } else if (sh.t <= 0) {
        sh.state = 'leave'; sh.t = 3;
        G.stats.sharkSurvived++;
        SND.relief();
        this.gloomTarget = 0;
        this.msgSet('...it loses interest.', 3);
        this.sharkCooldown = rand(70, 110);
        SND.setScene('dive');
      }
    } else if (sh.state === 'attack') {
      const prog = 1 - sh.t / 0.9;
      sh.s = 1.2 + prog * 5;
      sh.x = lerp(sh.x, W / 2, dt * 6);
      sh.y = lerp(sh.y, H / 2, dt * 6);
      if (!sh.bit && prog > 0.5) {
        sh.bit = true;
        SND.bite();
        this.flash = 0.7; this.flashCol = '255,255,255';
        this.shakeT = 0.6;
        const lose = Math.ceil(this.bagCount * 0.35);
        this.spillBag(lose);
        this.hurtPlayer(2.5);
        this.msgSet('IT GOT YOU', 2);
      }
      if (sh.t <= 0) {
        sh.state = 'leave'; sh.t = 2.5; sh.alpha = 0.5; sh.s = 1.4;
        this.gloomTarget = 0;
        this.sharkCooldown = rand(70, 110);
        SND.setScene('dive');
      }
    } else if (sh.state === 'leave') {
      sh.x -= 170 * dt;   // faces left in every non-pass state, so swim off left
      sh.alpha = Math.max(0, sh.alpha - dt * 0.4);
      if (sh.t <= 0) this.shark = null;
    }
  },

  // ---- update ---------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const eff = this.slowT > 0 ? dt * 0.3 : dt;   // micro slow-mo on pops
    this.slowT -= dt;
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flash > 0) this.flash -= dt * 1.6;
    if (this.bagPulse > 0) this.bagPulse -= dt;
    if (this.msgT > 0) this.msgT -= dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.gloom = lerp(this.gloom, this.gloomTarget, dt * 1.2);

    // blackout sequence
    if (this.over) {
      this.overT += dt;
      if (this.overT > 3) {
        G.stats.deaths++;
        G.hearts = G.maxHearts;
        this.bag = {}; this.bagCount = 0;
        G.day++; G.clock = 0.3;
        Game.newDayRegrow(true);
        Game.save();
        Game.go(HouseScene, { wake: true });
      }
      return;
    }

    // swimming
    let move = 0;
    if (Input.keys['KeyW'] || Input.keys['ArrowUp']) move -= 1;
    if (Input.keys['KeyS'] || Input.keys['ArrowDown']) move += 1;
    const targetVel = move * 85 + Input.wheelDelta * 14;
    this.camVel = lerp(this.camVel, targetVel, dt * 8);
    const before = this.camY;
    this.camY = clamp(this.camY + this.camVel * dt, 0, this.maxCam);
    if (this.camY === 0 || this.camY === this.maxCam) this.camVel *= 0.5;

    // oxygen
    this.air -= dt;
    if (this.air <= 12) {
      this.airBeepT -= dt;
      if (this.airBeepT <= 0) { this.airBeepT = 1; SND.alarm(); }
    }
    if (this.air <= 0) {
      this.hurtPlayer(1);
      if (!this.over) this.surface(true);
      return;
    }

    // the sea keeps going: generate more pole as you descend
    this.ensureDepth(this.camY + H);
    // reward pop lifecycle
    if (this.reward) {
      this.reward.t += dt;
      if (this.reward.t > 1.0) {
        this.flyIcons.push({ art: this.reward.art, x: this.reward.x, y: this.reward.y - 26, t: 0, rot: rand(-0.4, 0.4), vr: rand(-5, 5) });
        this.reward = null;
      }
    }

    // surfacing: no magic button — swim to the top and keep kicking
    const holdingUp = Input.keys['KeyW'] || Input.keys['ArrowUp'];
    if (this.camY <= 1 && holdingUp) {
      this.surfaceT += dt;
      if (this.surfaceT > 0.45) { this.surface(false); return; }
    } else {
      this.surfaceT = Math.max(0, this.surfaceT - dt * 2);
    }

    // ---- working the wall: scrape crust, then pry the shell loose --------------
    this.scrapeT -= dt;
    if (this.numbT > 0) this.numbT -= dt;
    const scr = SCRAPERS[G.gear.scraper];
    const mx = Input.mouse.x, my = Input.mouse.y + this.camY;
    const stareLock = this.shark && this.shark.state === 'stare';

    if (this.pry) {
      // pry in progress: marker swings, release in the window
      const p = this.pry;
      p.t += dt;
      p.marker = Math.sin(p.t * p.speed);
      if (!p.n.alive) this.pry = null;
      else if (!Input.mouse.down) {
        if (p.t < 0.22) this.pry = null;              // twitch: cancel, no penalty
        else this.resolvePry(Math.abs(p.marker) <= p.win);
      } else if (p.t > 2.6) {
        this.resolvePry(false);                        // held too long: it clamps
      }
    } else if ((Input.mouse.down || Input.mouse.clicked) && this.numbT <= 0 && !stareLock) {
      const n = this.nodeAt(mx, my);
      if (n) {
        if (n.stage === 'exposed') {
          if (n.kind === 'urchin' && !G.gear.gloves) {
            if (this.scrapeT <= 0) {
              this.scrapeT = 0.55;
              this.hurtPlayer(1);
              this.msgSet('OUCH! Sea urchin! (Pry Gloves would help)');
              for (let i = 0; i < 6; i++)
                this.particles.push({ x: n.x, y: n.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0.5, col: '#5a3a8a', s: 1 });
            }
          } else if (this.bagCount >= BAGS[G.gear.bag].cap) {
            if (this.scrapeT <= 0) {
              this.scrapeT = 0.5;
              this.msgSet('Bag full! Swim up to the surface!');
              SND.alarm();
            }
          } else if (n.clampT <= 0 && Input.mouse.down) {
            this.startPry(n);
          }
        } else if (n.stage === 'crusted' && this.scrapeT <= 0) {
          this.scrapeT = scr.tick;
          n.hp -= scr.dmg; n.shake = 1;
          SND.scrape();
          for (let i = 0; i < 4; i++)
            this.particles.push({
              x: mx + rand(-5, 5), y: my + rand(-5, 5),
              vx: rand(-30, 30), vy: rand(-45, 10), t: rand(0.25, 0.55),
              col: Math.random() < 0.55 ? '#8a9484' : (G.gear.scraper === 2 && Math.random() < 0.5 ? '#ffe66e' : '#cfc8b8'), s: 1,
            });
          if (Math.random() < 0.4)
            this.bubbles.push({ x: mx + rand(-4, 4), y: Input.mouse.y, r: rand(1, 2.5), v: rand(18, 34), wob: rand(TAU) });
          if (n.hp <= 0) {
            if (n.kind === 'barnacle') {
              // barnacles come straight off with the crust
              if (this.bagCount >= BAGS[G.gear.bag].cap) { n.hp = 1; this.msgSet('Bag full! Swim up to the surface!'); }
              else this.popNode(n);
            } else {
              n.stage = 'exposed';
              n.shake = 1;
              SND.ding();
              this.floaters.push({ x: n.x, y: n.y - n.r - 6, t: 1, txt: 'Exposed! Hold to pry', col: '#a0f2b4' });
              for (let i = 0; i < 8; i++)
                this.particles.push({
                  x: n.x + rand(-n.r, n.r) * 0.7, y: n.y + rand(-n.r, n.r) * 0.6,
                  vx: rand(-40, 40), vy: rand(-55, 5), t: rand(0.3, 0.7),
                  col: '#8a9484', s: rand(1, 2), rot: rand(TAU), vr: rand(-8, 8), chunk: true,
                });
            }
          }
        }
      } else if (this.scrapeT <= 0) {
        this.scrapeT = 0.16;
        if (mx > this.WALL_X && mx < this.WALL_X + this.WALL_W && Math.random() < 0.5) {
          SND.clink();
          this.particles.push({ x: mx, y: my, vx: rand(-15, 15), vy: rand(-25, 5), t: 0.3, col: '#8a8478', s: 1 });
        }
      }
    }
    for (const n of this.nodes) {
      if (n.shake > 0) n.shake -= dt * 4;
      if (n.clampT > 0) n.clampT -= dt;
    }

    // ---- jellyfish -------------------------------------------------------------
    for (const j of this.jellies) {
      j.wy -= j.vy * dt;
      j.x += Math.sin(this.time * 0.9 + j.sway) * 7 * dt;
      if (j.wy < this.camY - 160) { j.wy = this.camY + H + rand(40, 160); j.x = rand(20, W - 20); }
      if (j.cd > 0) j.cd -= dt;
      const sy = j.wy - this.camY;
      if (sy > -20 && sy < H + 20 && j.cd <= 0) {
        const dx = Input.mouse.x - j.x, dy = Input.mouse.y - sy;
        if (dx * dx + dy * dy < (j.r + 5) * (j.r + 5) && (Input.mouse.down || this.pry)) {
          j.cd = 1.4;
          this.pry = null;
          this.numbT = 1.6;
          this.hurtPlayer(0.5);
          SND.zap();
          this.msgSet('Jellyfish sting! Your paw is numb...');
        }
      }
    }

    // ---- moray eels ------------------------------------------------------------
    for (const n of this.nodes) {
      if (n.kind !== 'eelhole') continue;
      const e = n.eel;
      e.t -= dt;
      if (e.state === 'hidden' && e.t <= 0) { e.state = 'peek'; e.t = 2.2 + rand(0, 1.2); }
      else if (e.state === 'peek') {
        const dx = Input.mouse.x - n.x, dy = (Input.mouse.y + this.camY) - n.y;
        const near = dx * dx + dy * dy < 36 * 36;
        if (near && (Input.mouse.down || this.pry)) {
          e.state = 'strike'; e.t = 0.5; e.bit = false;
        } else if (e.t <= 0) { e.state = 'hidden'; e.t = 3.5 + rand(0, 4); }
      } else if (e.state === 'strike') {
        if (!e.bit && e.t < 0.3) {
          e.bit = true;
          const dx = Input.mouse.x - n.x, dy = (Input.mouse.y + this.camY) - n.y;
          if (dx * dx + dy * dy < 48 * 48) {
            this.pry = null;
            this.hurtPlayer(1);
            this.spillBag(2);
            SND.bite();
            this.msgSet('Moray bite! Watch the dens!');
          }
        }
        if (e.t <= 0) { e.state = 'hidden'; e.t = 5 + rand(0, 4); }
      }
    }

    // ---- schools of fish ---------------------------------------------------------
    for (const s of this.schools) {
      if (this.shark && !s.flee) { s.flee = true; s.speed *= 4; }
      if (!this.shark && s.flee) { s.flee = false; s.speed = rand(22, 34); }
      s.x += s.dir * s.speed * dt;
      s.y += Math.sin(this.time * 0.5 + s.ph) * 8 * dt - (this.camY - before) * 0.2;
      s.y = clamp(s.y, 20, H - 20);
      if (s.x < -80) { s.x = W + 80; s.y = rand(40, H - 40); }
      if (s.x > W + 80) { s.x = -80; s.y = rand(40, H - 40); }
    }

    // barracuda (only past the first piling, or at night)
    if (this.p >= 1 || isNight(G.clock)) {
      const b = this.barra;
      b.t -= dt;
      if (b.state === 'idle' && b.t <= 0 && !this.shark) {
        b.state = 'warn'; b.t = 0.85;
        b.y = clamp(Input.mouse.y, 20, H - 20);
        b.dir = Math.random() < 0.5 ? 1 : -1;
        b.hit = false;
        SND.warn();
      } else if (b.state === 'warn' && b.t <= 0) {
        b.state = 'dash'; b.t = 0.55;
        b.x = b.dir > 0 ? -50 : W + 50;
      } else if (b.state === 'dash') {
        b.x += b.dir * ((W + 120) / 0.55) * dt;
        // on touch, a lifted finger means the paw is pulled back — safe
        const pawOut = Input.mouse.down || !TouchUI.enabled;
        if (!b.hit && pawOut && Math.abs(Input.mouse.x - b.x) < 26 && Math.abs(Input.mouse.y - b.y) < 20) {
          b.hit = true;
          this.hurtPlayer(1);
          SND.bite();
          this.spillBag(3);
          this.msgSet('Barracuda bite!');
        }
        if (b.t <= 0) { b.state = 'idle'; b.t = rand(9, 22); }
      }
    }

    // shark
    this.updateShark(dt);

    // ambient whale groans in the deep
    this.whaleT -= dt;
    if (this.whaleT <= 0) {
      this.whaleT = rand(35, 80);
      if (this.depthFrac() > 0.4 && !this.shark) {
        SND.whale();
        if (Math.random() < 0.4) this.msgSet('...you hear something, far away.', 3);
      }
    }

    // particles / floaters / icons / bubbles
    const dcam = this.camY - before;
    for (const pt of this.particles) {
      if (pt.ring) { pt.r += pt.vr * eff; pt.t -= dt; continue; }
      pt.x += pt.vx * eff; pt.y += pt.vy * eff;
      pt.vy += 40 * eff; pt.vx *= (1 - eff * 1.5);
      if (pt.chunk) pt.rot += pt.vr * eff;
      pt.t -= dt;
    }
    this.particles = this.particles.filter(pt => pt.t > 0);
    for (const f of this.floaters) { f.y -= 14 * dt; f.t -= dt * 0.8; }
    this.floaters = this.floaters.filter(f => f.t > 0);
    for (const fi of this.flyIcons) {
      fi.t += dt * 2.2;
      if (fi.t >= 1) this.bagPulse = 0.25;
    }
    this.flyIcons = this.flyIcons.filter(fi => fi.t < 1);
    for (const bu of this.bubbles) {
      bu.y -= bu.v * dt; bu.x += Math.sin(this.time * 3 + bu.wob) * 0.4;
    }
    this.bubbles = this.bubbles.filter(bu => bu.y > -5);
    if (Math.random() < dt * 0.8)
      this.bubbles.push({ x: rand(W), y: H + 4, r: rand(1, 3), v: rand(12, 26), wob: rand(TAU) });

    // fish
    for (const f of this.fish) {
      if (f.flee) {
        f.vx = (f.vx > 0 ? 1 : -1) * 160;
        f.alpha = Math.max(0, f.alpha - dt * 1.5);
      }
      f.x += f.vx * eff;
      f.y += Math.sin(this.time * 2 + f.phase) * 6 * eff - dcam * 0.25;
      const inWall = f.x > this.WALL_X - 8 && f.x < this.WALL_X + this.WALL_W + 8;
      if (!f.flee && (f.x < 4 || f.x > W - 4 || inWall)) f.vx *= -1;
      if (f.y < 6 || f.y > H - 6) f.y = clamp(f.y, 6, H - 6);
      if (f.flee && (f.x < -30 || f.x > W + 30)) {
        // respawn later, calm
        if (!this.shark) { f.flee = false; f.alpha = 1; f.x = f.side ? W - 10 : 10; }
      }
    }

    // marine snow
    for (const s of this.snow) {
      s.y += s.v * eff - dcam * 0.5;
      s.x += Math.sin(this.time + s.drift) * 0.15;
      if (s.y > H) { s.y = -2; s.x = rand(W); }
      if (s.y < -4) { s.y = H; s.x = rand(W); }
    }
  },

  // ---- drawing ---------------------------------------------------------------
  drawNode(ctx, n, sy) {
    if (n.kind === 'eelhole') { this.drawEelhole(ctx, n, sy); return; }
    const sx = n.x + (n.shake > 0 ? rand(-1.3, 1.3) : 0);
    const jy = sy + (n.shake > 0 ? rand(-1, 1) : 0);
    ctx.save();
    ctx.translate(Math.round(sx * DPX) / DPX, Math.round(jy * DPX) / DPX);
    if (n.clampT > 0) ctx.scale(1, 0.88);   // clamped down tight
    ctx.rotate(((n.seed % 5) - 2) * 0.05);
    const w = n.r * 2.35;
    // soft contact shadow — grown on, not floating
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(1, 1.6, n.r * 1.02, n.r * 0.78, 0, 0, TAU); ctx.fill();

    if (n.kind === 'urchin') {
      const pulse = 1 + Math.sin(this.time * 1.5 + n.phase) * 0.04;
      drawAC(ctx, `urchin_${n.seed % 4}`, 0, 0, w * pulse);
      const dx = Input.mouse.x - n.x, dy = (Input.mouse.y + this.camY) - n.y;
      if (dx * dx + dy * dy < (n.r + 10) * (n.r + 10)) {
        ctx.strokeStyle = 'rgba(232,60,60,0.55)';
        ctx.lineWidth = PIX * 2;
        ctx.beginPath(); ctx.arc(0, 0, n.r + 5, 0, TAU); ctx.stroke();
      }
    } else {
      const art = NODE_ART[n.kind];
      // the clean shell underneath...
      drawAC(ctx, `shell_${art}`, 0, 0, w);
      // ...revealed as the crust chips away
      if (n.stage === 'crusted') {
        ctx.globalAlpha = clamp(n.hp / n.maxHp, 0, 1);
        drawAC(ctx, `crust_${art}`, 0, 0, w * 1.06);
        ctx.globalAlpha = 1;
      }
      if (n.stage === 'exposed') {
        ctx.strokeStyle = `rgba(160,242,180,${0.28 + Math.sin(this.time * 3 + n.phase) * 0.16})`;
        ctx.lineWidth = PIX * 2;
        ctx.beginPath(); ctx.ellipse(0, 0.5, n.r * 1.16, n.r * 0.95, 0, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();
  },



  drawEelhole(ctx, n, sy) {
    ctx.save();
    ctx.translate(Math.round(n.x * DPX) / DPX, Math.round(sy * DPX) / DPX);
    // rocky rim + dark den
    ctx.fillStyle = '#1c1610';
    ctx.beginPath(); ctx.ellipse(0, 0, n.r + 2, n.r * 0.8 + 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0805';
    ctx.beginPath(); ctx.ellipse(0, 0, n.r, n.r * 0.75, 0, 0, TAU); ctx.fill();
    const rrng = mulberry32(n.seed);
    ctx.fillStyle = '#4a4238';
    for (let i = 0; i < 7; i++) {
      const a = rrng() * TAU;
      ctx.fillRect(Math.cos(a) * (n.r + 1.5), Math.sin(a) * (n.r * 0.8 + 1), 2, 1.5);
    }
    const e = n.eel;
    if (e.state === 'peek') {
      // eyes glowing in the dark, sizing you up
      const g = 0.65 + Math.sin(this.time * 5 + n.phase) * 0.3;
      ctx.fillStyle = `rgba(150,255,140,${g})`;
      ctx.fillRect(-4, -2, 2, 2);
      ctx.fillRect(2, -2, 2, 2);
      ctx.fillStyle = 'rgba(60,80,50,0.8)';
      ctx.beginPath(); ctx.ellipse(0, 2, n.r * 0.5, n.r * 0.3, 0, 0, TAU); ctx.fill();
    } else if (e.state === 'strike') {
      const prog = 1 - e.t / 0.5;
      const ext = Math.sin(prog * Math.PI) * 42;
      const ang = Math.atan2((Input.mouse.y + this.camY) - n.y, Input.mouse.x - n.x);
      ctx.rotate(ang);
      // the moray lunges out of its den (uploaded eel, stretched with the lunge)
      const eimg = ASSETS.eel_1;
      if (eimg && eimg.width) {
        const eh = 13, ew = Math.max(14, ext + 14);
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(eimg, -ew, -eh / 2, ew, eh);
        ctx.restore();
      }
      ctx.fillStyle = '#f2ff9a';
      ctx.fillRect(ext - 3, -3.5, 2, 2);
    }
    ctx.restore();
  },

  drawShark(ctx, sh) {
    if (!sh || sh.alpha <= 0 || sh.state === 'omen') return;
    ctx.save();
    ctx.globalAlpha = clamp(sh.alpha, 0, 1);
    ctx.translate(sh.x, sh.y);
    const dir = sh.state === 'pass' ? 1 : -1;
    ctx.scale(sh.s * dir, sh.s);
    const body = '#1c262e', belly = '#2a3742';
    // body
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, 62, 17, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = belly;
    ctx.beginPath(); ctx.ellipse(0, 5, 56, 10, 0, 0, TAU); ctx.fill();
    // tail
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-58, 0); ctx.lineTo(-84, -16 + Math.sin(this.time * 6) * 3); ctx.lineTo(-78, 0);
    ctx.lineTo(-84, 12); ctx.closePath(); ctx.fill();
    // dorsal fin
    ctx.beginPath(); ctx.moveTo(-8, -14); ctx.lineTo(4, -30); ctx.lineTo(14, -14); ctx.closePath(); ctx.fill();
    // pectoral
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(-6, 24); ctx.lineTo(20, 12); ctx.closePath(); ctx.fill();
    // gills
    ctx.strokeStyle = '#101820'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(22 + i * 4, -8); ctx.lineTo(20 + i * 4, 8); ctx.stroke();
    }
    // old scars across the snout — this one has survived worse than you
    ctx.strokeStyle = 'rgba(178,188,192,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(34, -13); ctx.lineTo(41, -8);
    ctx.moveTo(38, -14); ctx.lineTo(45, -9);
    ctx.moveTo(52, 0); ctx.lineTo(58, -2);
    ctx.stroke();
    // eye — the horror bit
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath(); ctx.arc(44, -5, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(44 + (sh.state === 'stare' ? 1 : 0), -5, 1.6, 0, TAU); ctx.fill();
    if (sh.state === 'stare' && Math.sin(this.time * 9) > 0.7) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(45, -7, 1, 1);
    }
    // mouth
    if (sh.state === 'attack') {
      ctx.fillStyle = '#4a0e12';
      ctx.beginPath(); ctx.moveTo(62, 2); ctx.lineTo(30, 14); ctx.lineTo(62, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e4da';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(36 + i * 5, 6 + i * 0.8); ctx.lineTo(39 + i * 5, 11 + i * 0.8); ctx.lineTo(42 + i * 5, 6 + i * 0.8);
        ctx.closePath(); ctx.fill();
      }
    } else {
      ctx.strokeStyle = '#101820'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(58, 6); ctx.lineTo(40, 9); ctx.stroke();
    }
    ctx.restore();
  },

  drawJaws(ctx, prog) {
    // full-screen jaws closing from top and bottom
    const close = clamp(prog, 0, 1);
    const reach = close * (H / 2 + 10);
    ctx.fillStyle = '#0a0508';
    ctx.fillRect(0, 0, W, reach - 14);
    ctx.fillRect(0, H - reach + 14, W, reach);
    ctx.fillStyle = '#e8e4da';
    for (let i = 0; i < 12; i++) {
      const x = i * (W / 12) + 8;
      ctx.beginPath();
      ctx.moveTo(x - 14, reach - 14); ctx.lineTo(x, reach + 12); ctx.lineTo(x + 14, reach - 14);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 14 + 16, H - reach + 14); ctx.lineTo(x + 16, H - reach - 12); ctx.lineTo(x + 14 + 16, H - reach + 14);
      ctx.closePath(); ctx.fill();
    }
  },

  draw(ctx) {
    ctx.save();
    if (this.shakeT > 0) ctx.translate(irand(-2, 2), irand(-2, 2));

    // painted deep water, drifting with your depth
    const depthFrac = this.depthFrac();
    const night = isNight(G.clock) ? 0.55 : 0;
    const bgH = 432, bgOver = bgH - H;
    const bgOff = Math.min(bgOver, this.camY * 0.06);
    drawA(ctx, `bg_deep${Math.floor(this.time * 5) % 8}`, 0, -bgOff, W, bgH);
    // the deeper you go, the bluer and blacker it gets (headlamp overlay handles the rest)
    ctx.fillStyle = `rgba(3,10,22,${clamp(depthFrac * 0.45 + night * 0.3, 0, 0.7)})`;
    ctx.fillRect(0, 0, W, H);
    // god-ray shafts near the surface
    if (this.camY < 260 && !night) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * (1 - this.camY / 260);
      drawA(ctx, `bg_rays${Math.floor(this.time * 6) % 6}`, 0, -this.camY * 0.35, W, 184);
      ctx.restore();
    }

    // shark far pass (behind wall)
    if (this.shark && this.shark.state === 'pass') this.drawShark(ctx, this.shark);

    // ambient fish
    for (const f of this.fish) {
      if (f.alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = f.alpha * 0.8;
      ctx.fillStyle = '#0e2c3a';
      const fd = f.vx > 0 ? 1 : -1;
      ctx.translate(f.x, f.y);
      ctx.scale(fd, 1);
      ctx.beginPath(); ctx.ellipse(0, 0, f.size, f.size * 0.45, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-f.size, 0); ctx.lineTo(-f.size - 3, -2); ctx.lineTo(-f.size - 3, 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // schools of little fish weaving behind the piling
    for (const s of this.schools) {
      for (const m of s.members) {
        const fx = s.x + m.ox * s.dir;
        const fy = s.y + m.oy + Math.sin(this.time * 3 + m.ph) * 2.2;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(s.dir, 1);
        ctx.fillStyle = 'rgba(122,172,192,0.55)';
        ctx.beginPath(); ctx.ellipse(0, 0, 2.8, 1.2, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(-4.4, -1.4); ctx.lineTo(-4.4, 1.4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // the great pole, tiled forever downward
    const poleW = 208;
    const poleH = assetH('pole', poleW);
    const px0 = this.WALL_X - 14;
    for (let ti = Math.floor(this.camY / poleH); ti * poleH < this.camY + H; ti++) {
      drawA(ctx, 'pole', px0, ti * poleH - this.camY, poleW, poleH);
    }
    // freshly-scraped scars where shells used to sit
    for (const s of this.scars) {
      const sy2 = s.y - this.camY;
      if (sy2 < -20 || sy2 > H + 20) continue;
      ctx.fillStyle = 'rgba(96,52,38,0.55)';
      ctx.beginPath(); ctx.ellipse(s.x, sy2, s.rx, s.ry, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(196,132,96,0.4)';
      ctx.beginPath(); ctx.ellipse(s.x, sy2, s.rx * 0.6, s.ry * 0.6, 0, 0, TAU); ctx.fill();
    }

    // nodes
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const sy = n.y - this.camY;
      if (sy < -30 || sy > H + 30) continue;
      this.drawNode(ctx, n, sy);
    }

    // pry minigame bar above the shell being levered
    if (this.pry) {
      const p = this.pry;
      const bx = clamp(p.n.x, 60, W - 60);
      const by = p.n.y - this.camY - p.n.r - 18;
      uiPanel(ctx, bx - 30, by - 2, 60, 12, 0.92);
      // green window
      const halfW = 26;
      const winPx = p.win * halfW;
      ctx.fillStyle = '#14301c';
      ctx.fillRect(bx - halfW, by + 1, halfW * 2, 6);
      ctx.fillStyle = '#3f9a58';
      ctx.fillRect(bx - winPx, by + 1, winPx * 2, 6);
      ctx.fillStyle = 'rgba(180,255,200,0.5)';
      ctx.fillRect(bx - winPx, by + 1, winPx * 2, 1);
      // swinging marker
      const mxk = bx + p.marker * halfW;
      ctx.fillStyle = '#ffe66e';
      ctx.beginPath();
      ctx.moveTo(mxk, by + 7.5); ctx.lineTo(mxk - 3, by + 12.5); ctx.lineTo(mxk + 3, by + 12.5);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(mxk - PIX, by + 1, PIX * 2, 6);
      text(ctx, 'release!', bx, by - 10, { size: 7, color: '#ffe6b0', align: 'center' });
    }

    // particles (world space)
    for (const pt of this.particles) {
      ctx.globalAlpha = clamp(pt.t * 2, 0, 1);
      if (pt.ring) {
        ctx.strokeStyle = pt.col; ctx.lineWidth = PIX * 2;
        ctx.beginPath(); ctx.arc(pt.x, pt.y - this.camY, pt.r, 0, TAU); ctx.stroke();
      } else if (pt.chunk) {
        ctx.save();
        ctx.translate(pt.x, pt.y - this.camY);
        ctx.rotate(pt.rot);
        ctx.fillStyle = pt.col;
        ctx.fillRect(-pt.s / 2, -pt.s / 2, pt.s, pt.s * 0.7);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-pt.s / 2, -pt.s / 2, pt.s, PIX);
        ctx.restore();
      } else {
        ctx.fillStyle = pt.col;
        ctx.fillRect(Math.round(pt.x), Math.round(pt.y - this.camY), pt.s, pt.s);
      }
    }
    ctx.globalAlpha = 1;

    // floaters
    for (const f of this.floaters) {
      ctx.globalAlpha = clamp(f.t, 0, 1);
      text(ctx, f.txt, f.x, f.y - this.camY, { size: 7, color: f.col, align: 'center' });
    }
    ctx.globalAlpha = 1;

    // bubbles
    ctx.strokeStyle = 'rgba(200,230,240,0.5)';
    for (const bu of this.bubbles) {
      ctx.beginPath(); ctx.arc(bu.x, bu.y, bu.r, 0, TAU); ctx.stroke();
    }

    // marine snow
    ctx.fillStyle = 'rgba(210,225,230,0.35)';
    for (const s of this.snow) ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);

    // jellyfish
    for (const j2 of this.jellies) {
      const sy2 = j2.wy - this.camY;
      if (sy2 < -40 || sy2 > H + 40) continue;
      const pulse = 1 + Math.sin(this.time * 2.2 + j2.sway) * 0.12;
      ctx.save();
      ctx.translate(j2.x, sy2);
      ctx.scale(pulse, 2 - pulse);
      ctx.globalAlpha = 0.92;
      drawAC(ctx, `jelly_${j2.r > 10.5 ? 3 : 0}`, 0, 0, j2.r * 2.4);
      ctx.restore();
      ctx.globalAlpha = 1;
      if (night) {
        ctx.fillStyle = 'rgba(248,190,225,0.1)';
        ctx.beginPath(); ctx.arc(j2.x, sy2, j2.r * 1.7, 0, TAU); ctx.fill();
      }
    }

    // bioluminescent plankton after dark
    if (night) {
      for (const pl of this.plankton) {
        const py = ((pl.y - this.time * pl.v) % H + H) % H;
        const tw = Math.abs(Math.sin(this.time * 1.4 + pl.ph));
        ctx.fillStyle = `rgba(122,242,232,${0.25 + tw * 0.45})`;
        ctx.fillRect(pl.x + Math.sin(this.time * 0.7 + pl.ph) * 4, py, PIX * 2, PIX * 2);
      }
    }

    // barracuda
    const b = this.barra;
    if (b && b.state === 'warn') {
      const bx = b.dir > 0 ? 10 : W - 14;
      if (Math.sin(this.time * 18) > 0) text(ctx, '!', bx, b.y - 6, { size: 14, color: '#ff5a4a', align: 'center' });
    } else if (b && b.state === 'dash') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(b.dir, 1);
      // motion streaks
      ctx.fillStyle = 'rgba(122,158,172,0.28)';
      ctx.fillRect(-58, -2, 26, 1);
      ctx.fillRect(-48, 1, 18, 1);
      ctx.fillRect(-52, -4.5, 14, 1);
      // body with belly sheen
      ctx.fillStyle = '#33505c';
      ctx.beginPath(); ctx.ellipse(0, 0, 27, 5.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a7e8c';
      ctx.beginPath(); ctx.ellipse(2, 1.5, 23, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8fb0ba';
      ctx.beginPath(); ctx.ellipse(4, 2.4, 18, 1.4, 0, 0, TAU); ctx.fill();
      // tail + fins
      ctx.fillStyle = '#20343c';
      ctx.beginPath(); ctx.moveTo(-25, 0); ctx.lineTo(-36, -7); ctx.lineTo(-33, 0); ctx.lineTo(-36, 7); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, -4.5); ctx.lineTo(2, -9); ctx.lineTo(7, -4.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 4.5); ctx.lineTo(4, 8); ctx.lineTo(9, 4.5); ctx.closePath(); ctx.fill();
      // toothy jaw + eye
      ctx.strokeStyle = '#141f26'; ctx.lineWidth = PIX * 2;
      ctx.beginPath(); ctx.moveTo(26, 1.5); ctx.lineTo(16, 3.5); ctx.stroke();
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(19, 1.5, 1, 1.5);
      ctx.fillRect(22, 1.2, 1, 1.5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(20, -2.5, 2, 2);
      ctx.fillStyle = '#0a0f14';
      ctx.fillRect(20.7, -2, 1, 1);
      ctx.restore();
    }

    // darkness of the deep (with headlamp hole)
    const darkBase = clamp(depthFrac * 0.72 + night * 0.35, 0, 0.9) + this.gloom * 0.5;
    const dark = clamp(darkBase, 0, 0.94);
    if (dark > 0.02) {
      if (!this._darkCv) {
        this._darkCv = document.createElement('canvas');
        this._darkCv.width = W * DPX; this._darkCv.height = H * DPX;
        this._darkCtx = this._darkCv.getContext('2d');
        this._darkCtx.scale(DPX, DPX);
      }
      const dc = this._darkCtx;
      dc.clearRect(0, 0, W, H);
      dc.fillStyle = `rgba(2,6,10,${dark})`;
      dc.fillRect(0, 0, W, H);
      if (G.gear.lamp) {
        dc.globalCompositeOperation = 'destination-out';
        const rg = dc.createRadialGradient(Input.mouse.x, Input.mouse.y, 10, Input.mouse.x, Input.mouse.y, 95);
        rg.addColorStop(0, 'rgba(0,0,0,0.95)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        dc.fillStyle = rg;
        dc.beginPath(); dc.arc(Input.mouse.x, Input.mouse.y, 96, 0, TAU); dc.fill();
        dc.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(this._darkCv, 0, 0, W, H);
      if (G.gear.lamp) {
        ctx.fillStyle = 'rgba(255,240,190,0.06)';
        ctx.beginPath(); ctx.arc(Input.mouse.x, Input.mouse.y, 60, 0, TAU); ctx.fill();
      }
    }

    // shark stare / attack / leave (in front)
    if (this.shark && this.shark.state !== 'pass') this.drawShark(ctx, this.shark);
    if (this.shark && this.shark.state === 'attack') {
      const prog = 1 - this.shark.t / 0.9;
      if (prog > 0.3) this.drawJaws(ctx, (prog - 0.3) / 0.25);
    }

    // fly-to-bag icons (arc, spin, and a little scale pop)
    for (const fi of this.flyIcons) {
      const t = fi.t;
      const tx = W - 44, ty = H - 20;
      const x = lerp(fi.x, tx, t);
      const y = lerp(fi.y, ty, t) - Math.sin(t * Math.PI) * 42;
      const sc = 1 + Math.sin(t * Math.PI) * 0.35;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(fi.rot + t * fi.vr);
      ctx.scale(sc, sc);
      if (fi.art) drawAC(ctx, fi.art, 0, 0, 11);
      else if (fi.img) drawSpr(ctx, fi.img, -4, -4);
      ctx.restore();
    }

    // stardew-style reward: the prize rises, shining
    if (this.reward) {
      const r = this.reward, t = r.t;
      const k = Math.min(1, t * 2.2);
      const rise = 1 - Math.pow(1 - k, 3);
      const y = r.y - rise * 28;
      const pulse = 1 + Math.sin(k * Math.PI) * 0.3;
      ctx.save();
      ctx.translate(r.x, y);
      const ba = clamp(1.1 - t, 0, 1);
      ctx.save();
      ctx.rotate(t * 1.4);
      ctx.fillStyle = `rgba(255,246,200,${ba * 0.5})`;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(2.5, -17 - t * 8); ctx.lineTo(-2.5, -17 - t * 8); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = `rgba(255,255,255,${ba * 0.25})`;
      ctx.beginPath(); ctx.arc(0, 0, 15 + t * 6, 0, TAU); ctx.fill();
      drawAC(ctx, r.art, 0, 0, 24 * pulse);
      ctx.restore();
      text(ctx, '+' + r.name + (r.extra ? ' +!' : ''), r.x, y - 22, { size: 8, color: '#fff8e0', align: 'center' });
    }

    // depth chart along the right edge — where you are in the deep
    const gx = W - 13, gy0 = 46, gy1 = H - 50;
    const yFor = (d) => gy0 + (gy1 - gy0) * Math.sqrt(Math.min(1, d / 2400));
    uiPanel(ctx, gx - 5, gy0 - 7, 17, gy1 - gy0 + 16, 0.6);
    const zones = [[0, '#7ad2e8'], [300, '#3f9ab8'], [800, '#1f5c86'], [1600, '#0c2c48']];
    for (let i = 0; i < zones.length; i++) {
      const top = yFor(zones[i][0]);
      const bot = i + 1 < zones.length ? yFor(zones[i + 1][0]) : gy1;
      ctx.fillStyle = zones[i][1];
      ctx.fillRect(gx - 1, top, 8, bot - top);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const zd of [300, 800, 1600]) ctx.fillRect(gx - 2.5, yFor(zd), 11, PIX);
    text(ctx, '0', gx - 4.5, gy0 - 1, { size: 5, color: '#bfe8f5', align: 'right' });
    text(ctx, '~', gx - 4.5, gy1 - 5, { size: 5, color: '#5a7484', align: 'right' });
    // you are here
    const my2 = yFor(this.camY);
    ctx.fillStyle = '#ffe66e';
    ctx.beginPath(); ctx.moveTo(gx - 3.5, my2); ctx.lineTo(gx - 8, my2 - 3); ctx.lineTo(gx - 8, my2 + 3); ctx.closePath(); ctx.fill();
    ctx.fillRect(gx - 1.5, my2 - 1, 9, 2);

    // ---- HUD -----------------------------------------------------------------
    // O2 gauge in a driftwood capsule
    const o2Frac = clamp(this.air / this.airMax, 0, 1);
    const low = this.air <= 12;
    const o2Pulse = low && Math.sin(this.time * 10) > 0;
    uiPanel(ctx, 6, H - 28, 108, 15, 0.85);
    // bubble icon
    ctx.strokeStyle = o2Pulse ? '#ff5a4a' : '#bfe8f5'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(15, H - 20.5, 3.5, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(18.5, H - 24, 1.4, 0, TAU); ctx.stroke();
    rrect(ctx, 24, H - 24.5, 84, 8, '#08141c', '#2c4654');
    ctx.fillStyle = low ? '#e8434c' : '#5ad2f0';
    ctx.fillRect(25, H - 23.5, 82 * o2Frac, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(25, H - 23.5, 82 * o2Frac, 1.5);
    // tick marks
    ctx.fillStyle = 'rgba(8,20,28,0.7)';
    for (let i = 1; i < 4; i++) ctx.fillRect(24 + i * 21, H - 24, PIX * 2, 7);
    // bag: little net sack + count
    const cap = BAGS[G.gear.bag].cap;
    const bagFull = this.bagCount >= cap;
    const bp = this.bagPulse > 0 ? 1 + this.bagPulse * 1.2 : 1;
    uiPanel(ctx, W - 74, H - 28, 68, 15, 0.85);
    ctx.save();
    ctx.translate(W - 63, H - 20);
    ctx.scale(bp, bp);
    ctx.fillStyle = '#8a7040';
    ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(4, -5); ctx.lineTo(5.5, 5); ctx.lineTo(-5.5, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,28,12,0.8)'; ctx.lineWidth = PIX;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * 3 - 1, -5); ctx.lineTo(i * 3.5 - 1, 5); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-4.7, -1); ctx.lineTo(4.7, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5.2, 2); ctx.lineTo(5.2, 2); ctx.stroke();
    ctx.fillStyle = '#5a4526';
    ctx.fillRect(-4.5, -6.5, 9, 2);
    ctx.restore();
    text(ctx, `${this.bagCount}/${cap}`, W - 52, H - 24, { size: 8, color: bagFull ? '#ff5a4a' : '#ffe6b0' });
    // depth panel
    uiPanel(ctx, W - 46, 26, 42, 13, 0.75);
    text(ctx, `${Math.round((this.camY + H * 0.5) / 12)}m`, W - 9, 29, { size: 8, color: '#9fc4d4', align: 'right' });
    ctx.fillStyle = '#5ad2f0';
    ctx.beginPath(); ctx.moveTo(W - 41, 30); ctx.lineTo(W - 38, 35.5); ctx.lineTo(W - 35, 30); ctx.closePath(); ctx.fill();
    // near the top: the surface itself shimmers into view + kick-up prompt
    if (this.camY < 46) {
      const wl = 20 - this.camY;   // waterline screen y
      if (wl > -8) {
        ctx.fillStyle = 'rgba(220,245,255,0.35)';
        for (let x = 0; x < W; x += 7)
          ctx.fillRect(x, wl + Math.sin(x * 0.09 + this.time * 2.4) * 2.2, 5, 1.2);
        ctx.fillStyle = 'rgba(190,230,250,0.12)';
        ctx.fillRect(0, 0, W, Math.max(0, wl));
      }
      const bob = Math.sin(this.time * 3.2) * 2.5;
      const active = this.surfaceT > 0;
      ctx.fillStyle = active ? '#ffe66e' : 'rgba(200,235,250,0.8)';
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2, 30 + bob + i * 7);
        ctx.lineTo(W / 2 - 6, 37 + bob + i * 7);
        ctx.lineTo(W / 2 + 6, 37 + bob + i * 7);
        ctx.closePath(); ctx.fill();
      }
      text(ctx, active ? 'kick! kick!' : 'swim up to surface', W / 2, 48 + bob, { size: 7, color: active ? '#ffe66e' : 'rgba(200,235,250,0.8)', align: 'center' });
      if (active) {
        rrect(ctx, W / 2 - 20, 58 + bob, 40, 4, '#08141c', '#2c4654');
        ctx.fillStyle = '#ffe66e';
        ctx.fillRect(W / 2 - 19, 59 + bob, 38 * clamp(this.surfaceT / 0.45, 0, 1), 2);
      }
    }
    // combo
    if (this.combo >= 3) {
      const cs = 9 + Math.min(this.combo, 15);
      text(ctx, `x${this.combo}`, Input.mouse.x + 14, Input.mouse.y - 16, { size: Math.min(cs, 16), color: '#ffe66e', align: 'center' });
    }
    // messages
    if (this.msgT > 0 && this.msg)
      text(ctx, this.msg, W / 2, H - 50, { size: 9, color: '#ffe6b0', align: 'center' });
    if (this.bannerT > 0 && this.banner) {
      const bs = 16 + Math.sin(this.bannerT * 10) * 2;
      text(ctx, this.banner, W / 2, H / 2 - 40, { size: bs, color: '#fffdf4', align: 'center' });
    }
    // DON'T MOVE prompt
    if (this.shark && this.shark.state === 'stare') {
      const jx = rand(-1.5, 1.5), jy = rand(-1.5, 1.5);
      text(ctx, "DON'T MOVE", W / 2 + jx, 36 + jy, { size: 18, color: '#e8434c', align: 'center' });
      // suspicion meter
      rrect(ctx, W / 2 - 40, 60, 80, 5, '#180a0c', '#4a1a20');
      ctx.fillStyle = '#e8434c';
      ctx.fillRect(W / 2 - 39, 61, Math.round(78 * clamp(this.shark.sus, 0, 1)), 3);
    }

    // scraper cursor
    this.drawCursor(ctx);

    // hit flash
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashCol},${clamp(this.flash, 0, 0.55)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,10,${0.35 + this.gloom * 0.4})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();

    // blackout overlay
    if (this.over) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(this.overT / 1.2, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      if (this.overT > 1.2)
        text(ctx, 'Everything goes dark...', W / 2, H / 2 - 6, { size: 10, color: '#8a9aa8', align: 'center' });
    }
  },

  drawCursor(ctx) {
    const mx = Input.mouse.x, my = Input.mouse.y;
    const scraping = Input.mouse.down;
    const hover = this.nodeAt(mx, my + this.camY);
    const pryMode = !!this.pry || (hover && hover.stage === 'exposed' && (hover.kind !== 'urchin' || G.gear.gloves));
    ctx.save();
    ctx.translate(mx, my);
    if (this.numbT > 0) {
      ctx.translate(rand(-1, 1), rand(-1, 1));
      if (Math.random() < 0.4) {
        ctx.fillStyle = '#f2b8d0';
        ctx.fillRect(rand(-9, 9), rand(-9, 9), 1, 1);
      }
    }
    if (pryMode) {
      const lean = this.pry ? this.pry.marker * 0.5 : -0.3;
      ctx.rotate(lean);
      drawAC(ctx, 'g_crowbar', 3, 3, 20);
    } else {
      if (scraping) ctx.rotate(Math.sin(this.time * 40) * 0.14);
      drawAC(ctx, 'g_scraper', 3, 3, 18);
      if (G.gear.scraper === 2 && scraping && Math.random() < 0.5) {
        ctx.fillStyle = '#ffe66e';
        ctx.fillRect(rand(-8, 0), rand(-8, -2), 1, 1);
      }
    }
    ctx.restore();
  },

};
