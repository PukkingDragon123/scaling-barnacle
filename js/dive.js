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
    this.maxCam = PILINGS[p].depth - H + 40;
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
    this.nodes = this.gen(p);
    this.buildWall();
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
      Game.toast('Hold LEFT MOUSE on shells to scrape them off!');
      Game.toast('W/S or wheel: swim.  [Q] surface.  Watch your O2!');
    }
    if (this.p === 2 && !G.flags.seenDeep) {
      G.flags.seenDeep = true;
      Game.toast('It\'s dark down here. And very quiet...');
    }
  },

  // ---- node generation ----------------------------------------------------
  gen(p) {
    const def = PILINGS[p];
    const rng = mulberry32(G.seeds[p] * 7919 + p * 101 + 13);
    const nodes = [];
    const rows = Math.floor((def.depth - 80) / 30);
    for (let r = 0; r < rows; r++) {
      const d = r / rows;
      const count = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const kind = weightedPick([
          ['clam', 5 - 2.5 * d],
          ['mussel', 1.2 + 1.5 * d],
          ['barnacle', 2.4],
          ['oyster', (p >= 1) ? 0.5 + 2.2 * d : (d > 0.55 ? 0.7 : 0)],
          ['abalone', (p >= 2 && d > 0.45) ? 2.2 * d : 0],
          ['urchin', 0.35 + 1.5 * d + 0.3 * p],
        ], rng());
        const nd = NODE_DEFS[kind];
        nodes.push({
          x: this.WALL_X + 16 + rng() * (this.WALL_W - 32),
          y: 60 + r * 30 + rng() * 16,
          kind, r: nd.r * (0.85 + rng() * 0.4),
          hp: nd.hp, maxHp: nd.hp,
          seed: Math.floor(rng() * 99999), alive: true, shake: 0, phase: rng() * TAU,
        });
      }
    }
    // apply regrowth: knock out (1 - growth) of harvestable nodes, deterministically
    const harv = nodes.filter(n => n.kind !== 'urchin');
    const shuffled = harv.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const dead = Math.round((1 - clamp(G.growth[p], 0, 1)) * shuffled.length);
    for (let i = 0; i < dead; i++) shuffled[i].alive = false;
    this.totalHarv = Math.max(1, shuffled.length);
    return nodes;
  },

  buildWall() {
    const depth = PILINGS[this.p].depth;
    const cw = this.WALL_W + 24;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = depth;
    const c = cv.getContext('2d');
    const rng = mulberry32(G.seeds[this.p] * 31 + 7);
    // wood base
    c.fillStyle = '#42311f';
    c.fillRect(0, 0, cw, depth);
    // vertical plank seams
    for (let x = 12; x < cw - 12; x += 34) {
      c.fillStyle = '#332516';
      c.fillRect(x, 0, 2, depth);
    }
    // wood grain
    for (let i = 0; i < depth * 0.6; i++) {
      c.fillStyle = rng() < 0.5 ? 'rgba(90,66,40,0.5)' : 'rgba(40,28,16,0.5)';
      c.fillRect(12 + rng() * (cw - 24), rng() * depth, 1 + rng() * 8, 1);
    }
    // cross beams
    for (let y = 100; y < depth; y += 150) {
      c.fillStyle = '#2c2013';
      c.fillRect(6, y, cw - 12, 8);
      c.fillStyle = '#4c3a24';
      c.fillRect(6, y, cw - 12, 2);
    }
    // algae blotches (greener near top, darker deep)
    for (let i = 0; i < depth / 4; i++) {
      const y = rng() * depth, d = y / depth;
      c.fillStyle = `rgba(${40 - d * 20},${90 - d * 50},${50 - d * 30},${0.25 + rng() * 0.3})`;
      const w = 3 + rng() * 12;
      c.fillRect(12 + rng() * (cw - 24 - w), y, w, 2 + rng() * 4);
    }
    // crust speckles
    for (let i = 0; i < depth / 2; i++) {
      c.fillStyle = rng() < 0.5 ? 'rgba(150,150,140,0.35)' : 'rgba(200,195,180,0.22)';
      c.fillRect(12 + rng() * (cw - 24), rng() * depth, 2, 2);
    }
    // dark edges
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 0, 12, depth);
    c.fillRect(cw - 12, 0, 12, depth);
    this.wallCanvas = cv;
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
      if (!n.alive) continue;
      const dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
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
    if (n.kind === 'oyster' && Math.random() < 0.07 + 0.03 * this.p) gained.push('pearl');
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
    for (let i = 0; i < 9; i++) {
      this.particles.push({
        x: n.x + rand(-3, 3), y: n.y + rand(-3, 3),
        vx: rand(-55, 55), vy: rand(-70, 20), t: rand(0.4, 0.9),
        col: Math.random() < 0.3 ? '#fff' : col, s: irand(1, 2),
      });
    }
    this.floaters.push({ x: n.x, y: n.y - 8, t: 1, txt: '+' + ITEMS[drop].name, col: '#fff' });
    for (const it of gained) {
      this.flyIcons.push({ img: SPR.icons[it], x: n.x, y: n.y - this.camY, t: 0 });
    }
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
    // remember regrowth state
    this.exitGrowth();
    SND.splash();
    SND.setScene('surface');
    if (count > 0) Game.toast(`Stored ${count} shells (worth ~$${value})`);
    if (forced) Game.toast('You surfaced gasping for air! (-1 heart)');
    Game.save();
    Game.go(WorldScene, { at: this.p });
  },

  exitGrowth() {
    const alive = this.nodes.filter(n => n.kind !== 'urchin' && n.alive).length;
    G.growth[this.p] = alive / this.totalHarv;
  },

  // ---- shark event -----------------------------------------------------------
  startShark() {
    this.shark = { state: 'omen', t: 4.2, x: -220, y: H * 0.35, s: 0.55, alpha: 0, sus: 0, dir: 1, bit: false };
    this.gloomTarget = 0.5;
    for (const f of this.fish) f.flee = true;
    SND.setScene('shark');
    this.msgSet('...the water goes quiet.', 3);
  },

  sharkBlocksSurface() {
    return this.shark && ['omen', 'pass', 'stare', 'attack'].includes(this.shark.state);
  },

  updateShark(dt) {
    const sh = this.shark;
    if (!sh) {
      this.sharkCooldown -= dt;
      this.sharkRollT -= dt;
      if (this.sharkCooldown <= 0 && this.sharkRollT <= 0) {
        this.sharkRollT = 1;
        const depthFrac = this.camY / Math.max(1, this.maxCam);
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
        this.exitGrowth();
        G.day++; G.clock = 0.3;
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

    // surfacing
    if (Input.p('KeyQ') || Input.p('KeyE')) {
      if (this.sharkBlocksSurface()) {
        this.msgSet('You are frozen with fear.');
      } else {
        this.surface(false);
        return;
      }
    }

    // scraping
    this.scrapeT -= dt;
    const scr = SCRAPERS[G.gear.scraper];
    const mx = Input.mouse.x, my = Input.mouse.y + this.camY;
    if (Input.mouse.down && !(this.shark && this.shark.state === 'stare')) {
      if (this.scrapeT <= 0) {
        const n = this.nodeAt(mx, my);
        if (n) {
          if (n.kind === 'urchin') {
            if (G.gear.gloves) {
              this.scrapeT = scr.tick * 1.4;
              n.hp -= 1; n.shake = 1;
              SND.scrape();
              if (n.hp <= 0) {
                if (this.bagCount >= BAGS[G.gear.bag].cap) { n.hp = 1; this.msgSet('Bag full! Surface with [Q]'); }
                else this.popNode(n);
              }
            } else {
              this.scrapeT = 0.55;
              this.hurtPlayer(1);
              this.msgSet('OUCH! Sea urchin! (Pry Gloves would help)');
              for (let i = 0; i < 6; i++)
                this.particles.push({ x: n.x, y: n.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0.5, col: '#5a3a8a', s: 1 });
            }
          } else if (this.bagCount >= BAGS[G.gear.bag].cap) {
            this.scrapeT = 0.4;
            this.msgSet('Bag full! Surface with [Q]');
            SND.alarm();
          } else {
            this.scrapeT = scr.tick;
            n.hp -= scr.dmg; n.shake = 1;
            SND.scrape();
            for (let i = 0; i < 3; i++)
              this.particles.push({
                x: mx + rand(-4, 4), y: my + rand(-4, 4),
                vx: rand(-25, 25), vy: rand(-40, 10), t: rand(0.25, 0.5),
                col: G.gear.scraper === 2 && Math.random() < 0.4 ? '#ffe66e' : '#cfc8b8', s: 1,
              });
            if (Math.random() < 0.4)
              this.bubbles.push({ x: mx + rand(-4, 4), y: Input.mouse.y, r: rand(1, 2.5), v: rand(18, 34), wob: rand(TAU) });
            if (n.hp <= 0) this.popNode(n);
          }
        } else {
          this.scrapeT = 0.16;
          if (mx > this.WALL_X && mx < this.WALL_X + this.WALL_W && Math.random() < 0.5) {
            SND.clink();
            this.particles.push({ x: mx, y: my, vx: rand(-15, 15), vy: rand(-25, 5), t: 0.3, col: '#8a8478', s: 1 });
          }
        }
      }
    }
    for (const n of this.nodes) if (n.shake > 0) n.shake -= dt * 4;

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
        if (!b.hit && Math.abs(Input.mouse.x - b.x) < 26 && Math.abs(Input.mouse.y - b.y) < 20) {
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
      if (this.camY / Math.max(1, this.maxCam) > 0.4 && !this.shark) {
        SND.whale();
        if (Math.random() < 0.4) this.msgSet('...you hear something, far away.', 3);
      }
    }

    // particles / floaters / icons / bubbles
    const dcam = this.camY - before;
    for (const pt of this.particles) {
      pt.x += pt.vx * eff; pt.y += pt.vy * eff;
      pt.vy += 40 * eff; pt.vx *= (1 - eff * 1.5);
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
    const sx = n.x + (n.shake > 0 ? rand(-1.3, 1.3) : 0);
    const jy = sy + (n.shake > 0 ? rand(-1, 1) : 0);
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(jy));
    const rng = mulberry32(n.seed);
    const r = n.r;
    if (n.kind === 'clam') {
      const base = ['#c9a06a', '#d9b98a', '#b98f5c'][Math.floor(rng() * 3)];
      ctx.fillStyle = '#5a3a20';
      ctx.beginPath(); ctx.arc(0, 2, r, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(0, 2, r - 1.5, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,58,32,0.8)'; ctx.lineWidth = 1;
      for (let a = -2; a <= 2; a++) {
        ctx.beginPath(); ctx.moveTo(0, 2);
        ctx.lineTo(Math.sin(a * 0.4) * (r - 2), 2 - Math.cos(a * 0.4) * (r - 2));
        ctx.stroke();
      }
    } else if (n.kind === 'mussel') {
      ctx.save(); ctx.rotate(rng() * 0.9 - 0.45);
      ctx.fillStyle = '#101830';
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.55, 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2c3a6e';
      ctx.beginPath(); ctx.ellipse(0, 0, r - 1.5, r * 0.55 - 1.5, 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a71b4';
      ctx.fillRect(-r * 0.4, -r * 0.35, r * 0.5, 1.5);
      ctx.restore();
    } else if (n.kind === 'barnacle') {
      ctx.fillStyle = '#5c6462';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a8b0ac';
      ctx.beginPath(); ctx.arc(0, 0, r - 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2c3432';
      ctx.beginPath(); ctx.arc(0, 0.5, r * 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(230,232,228,0.7)';
      ctx.fillRect(-r * 0.5, -r * 0.6, 2, 1);
    } else if (n.kind === 'oyster') {
      ctx.fillStyle = '#3a423a';
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.8, rng(), 0, TAU); ctx.fill();
      ctx.fillStyle = '#6e7d6a';
      ctx.beginPath(); ctx.ellipse(0, 0, r - 1.5, r * 0.8 - 1.5, rng(), 0, TAU); ctx.fill();
      ctx.fillStyle = '#93a48c';
      ctx.beginPath(); ctx.ellipse(-1, -1, r * 0.5, r * 0.35, rng(), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(40,50,40,0.8)';
      ctx.beginPath(); ctx.moveTo(-r + 2, 1); ctx.lineTo(r - 2, 0); ctx.stroke();
    } else if (n.kind === 'abalone') {
      ctx.fillStyle = '#1e4a40';
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.7, 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3f8f7f';
      ctx.beginPath(); ctx.ellipse(0, 0, r - 1.5, r * 0.7 - 1.5, 0.3, 0, TAU); ctx.fill();
      const cols = ['#66c2a8', '#b48ac2', '#8fd0c0', '#d0c26e'];
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = cols[Math.floor(rng() * cols.length)];
        ctx.fillRect((rng() - 0.5) * r * 1.2, (rng() - 0.5) * r * 0.8, 1.5, 1.5);
      }
      ctx.fillStyle = '#14332c';
      for (let i = 0; i < 4; i++) ctx.fillRect(-r * 0.5 + i * 3, -r * 0.35, 1, 1);
    } else if (n.kind === 'urchin') {
      const wig = Math.sin(this.time * 1.5 + n.phase) * 0.1;
      ctx.strokeStyle = '#3a2354';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU + wig;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3)); ctx.stroke();
      }
      ctx.fillStyle = '#2a1840';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a3a8a';
      ctx.beginPath(); ctx.arc(-1, -1, r * 0.45, 0, TAU); ctx.fill();
      // hint of danger when hovered
      const dx = Input.mouse.x - n.x, dy = (Input.mouse.y + this.camY) - n.y;
      if (dx * dx + dy * dy < (r + 10) * (r + 10)) {
        ctx.strokeStyle = 'rgba(232,60,60,0.5)';
        ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU); ctx.stroke();
      }
    }
    // cracks
    if (n.hp < n.maxHp && n.kind !== 'urchin') {
      const frac = 1 - n.hp / n.maxHp;
      ctx.strokeStyle = 'rgba(20,12,6,0.85)';
      ctx.lineWidth = 1;
      const cracks = Math.ceil(frac * 3);
      const crng = mulberry32(n.seed + 5);
      for (let i = 0; i < cracks; i++) {
        const a = crng() * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
        ctx.lineTo(Math.cos(a + crng() * 0.8) * r * 0.9, Math.sin(a + crng() * 0.8) * r * 0.9);
        ctx.stroke();
      }
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

    // background gradient by depth
    const depthFrac = this.camY / (this.maxCam + 1);
    const night = isNight(G.clock) ? 0.55 : 0;
    const mixTop = clamp(depthFrac + night * 0.4, 0, 1);
    const c1 = [lerp(26, 4, mixTop), lerp(106, 18, mixTop), lerp(138, 30, mixTop)];
    const c2 = [lerp(12, 2, mixTop), lerp(60, 8, mixTop), lerp(88, 16, mixTop)];
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, `rgb(${c1.map(Math.round).join(',')})`);
    grd.addColorStop(1, `rgb(${c2.map(Math.round).join(',')})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // god rays near the surface
    if (this.camY < 180 && !night) {
      ctx.save();
      ctx.globalAlpha = 0.1 * (1 - this.camY / 180);
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 100 + Math.sin(this.time * 0.4 + i) * 18;
        ctx.fillStyle = '#cfeaf5';
        ctx.beginPath();
        ctx.moveTo(x, -10); ctx.lineTo(x + 34, -10);
        ctx.lineTo(x + 90, H); ctx.lineTo(x + 40, H);
        ctx.closePath(); ctx.fill();
      }
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

    // the piling wall
    if (this.wallCanvas) {
      ctx.drawImage(this.wallCanvas,
        0, this.camY, this.wallCanvas.width, H,
        this.WALL_X - 12, 0, this.wallCanvas.width, H);
    }

    // nodes
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const sy = n.y - this.camY;
      if (sy < -24 || sy > H + 24) continue;
      this.drawNode(ctx, n, sy);
    }

    // particles (world space)
    for (const pt of this.particles) {
      ctx.fillStyle = pt.col;
      ctx.globalAlpha = clamp(pt.t * 2, 0, 1);
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y - this.camY), pt.s, pt.s);
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

    // barracuda
    const b = this.barra;
    if (b && b.state === 'warn') {
      const bx = b.dir > 0 ? 10 : W - 14;
      if (Math.sin(this.time * 18) > 0) text(ctx, '!', bx, b.y - 6, { size: 14, color: '#ff5a4a', align: 'center' });
    } else if (b && b.state === 'dash') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(b.dir, 1);
      ctx.fillStyle = '#3c5a66';
      ctx.beginPath(); ctx.ellipse(0, 0, 26, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a7e8c';
      ctx.beginPath(); ctx.ellipse(2, 1.5, 22, 2.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#20343c';
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-34, -6); ctx.lineTo(-34, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(20, -2, 2, 2);
      ctx.restore();
    }

    // darkness of the deep (with headlamp hole)
    const darkBase = clamp(depthFrac * 0.72 + night * 0.35, 0, 0.9) + this.gloom * 0.5;
    const dark = clamp(darkBase, 0, 0.94);
    if (dark > 0.02) {
      if (!this._darkCv) {
        this._darkCv = document.createElement('canvas');
        this._darkCv.width = W; this._darkCv.height = H;
      }
      const dc = this._darkCv.getContext('2d');
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
      ctx.drawImage(this._darkCv, 0, 0);
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

    // fly-to-bag icons
    for (const fi of this.flyIcons) {
      const t = fi.t;
      const tx = W - 40, ty = H - 22;
      const x = lerp(fi.x, tx, t);
      const y = lerp(fi.y, ty, t) - Math.sin(t * Math.PI) * 40;
      ctx.drawImage(fi.img, Math.round(x - 4), Math.round(y - 4));
    }

    // ---- HUD -----------------------------------------------------------------
    // O2
    const o2Frac = clamp(this.air / this.airMax, 0, 1);
    const low = this.air <= 12;
    text(ctx, 'O2', 10, H - 24, { size: 8, color: low && Math.sin(this.time * 10) > 0 ? '#ff5a4a' : '#bfe8f5' });
    rrect(ctx, 28, H - 23, 74, 7, '#08141c', '#2c4654');
    ctx.fillStyle = low ? '#e8434c' : '#5ad2f0';
    ctx.fillRect(29, H - 22, Math.round(72 * o2Frac), 5);
    // bag
    const cap = BAGS[G.gear.bag].cap;
    const bagCol = this.bagCount >= cap ? '#ff5a4a' : '#ffe6b0';
    const scale = this.bagPulse > 0 ? 1 : 0;
    ctx.drawImage(SPR.icons.clam, W - 62, H - 24 - scale);
    text(ctx, `${this.bagCount}/${cap}`, W - 50, H - 23 - scale, { size: 8, color: bagCol });
    // depth
    text(ctx, `${Math.round((this.camY + H * 0.5) / 12)}m`, W - 10, 30, { size: 8, color: '#9fc4d4', align: 'right' });
    text(ctx, '[Q] surface', 10, H - 36, { size: 7, color: 'rgba(200,225,235,0.65)' });
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
    ctx.save();
    ctx.translate(mx, my);
    if (scraping) ctx.rotate(Math.sin(this.time * 40) * 0.12);
    // paw
    ctx.fillStyle = '#6b4a2f';
    ctx.beginPath(); ctx.arc(6, 8, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a6444';
    ctx.beginPath(); ctx.arc(6, 8, 3.4, 0, TAU); ctx.fill();
    // handle
    ctx.fillStyle = '#7a3c1e';
    ctx.fillRect(1, 2, 3, 8);
    // blade
    const bladeCol = ['#9aa0a0', '#c8d0d4', '#ffe66e'][G.gear.scraper];
    ctx.fillStyle = bladeCol;
    ctx.beginPath();
    ctx.moveTo(-6, -6); ctx.lineTo(4, -1); ctx.lineTo(4, 3); ctx.lineTo(-8, -1);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(-6, -5, 6, 1);
    if (G.gear.scraper === 2 && scraping && Math.random() < 0.5) {
      ctx.fillStyle = '#ffe66e';
      ctx.fillRect(rand(-8, 0), rand(-8, -2), 1, 1);
    }
    ctx.restore();
  },
};
