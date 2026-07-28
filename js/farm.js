// ---- dock farming: seed packets, tilled beds, and slow honest growth ---------
// Otto tills shallow beds straight into the pier planks, plants packets bought
// on ClamNet, and waters them every day. Growth only happens overnight, so the
// loop is: plant -> water -> sleep -> water -> sleep -> harvest.
'use strict';

const Farm = {
  // ---- tuning ------------------------------------------------------------------
  DECK_Y: 214,        // deck surface line; the integrator syncs this with world.js DECK_Y
  REACH: 15,          // half the plot spacing, so exactly one plot ever claims an x
  DRY_DEATH: 2,       // consecutive unwatered nights a crop survives
  STAGES: 3,          // sprite stages 0,1,2 — stage 2 is ready to harvest
  BED_W: 22,          // soil bed width in logical units
  FX_MAX: 140,        // hard cap on live particles (they are purely cosmetic)

  // Crop balance. profit/day climbs with the seed price AND with how long the
  // bed is locked up, so blade is the safe early trickle and moon is the
  // late-game money press you need a full dock of beds to exploit.
  //   blade  10 ->  18 over 2d  (+8  ->  4.0/day)
  //   curl   30 ->  51 over 4d  (+21 ->  5.3/day)
  //   berry  55 ->  80 over 4d  (+25 ->  6.3/day)
  //   gourd  95 -> 150 over 6d  (+55 ->  9.2/day)
  //   moon  180 -> 360 over 8d  (+180 -> 22.5/day)
  ORDER: ['blade', 'curl', 'berry', 'gourd', 'moon'],
  CROPS: {
    blade: {
      name: 'Kelp Blade', seedName: 'Kelp Blade Seeds', seedPrice: 10,
      sd: 1, qty: 2, value: 9, bonus: 0.10, mh: 20,
      desc: 'Ready in 2 days. Pocket money that keeps coming.',
    },
    curl: {
      name: 'Sea Curl', seedName: 'Sea Curl Seeds', seedPrice: 30,
      sd: 2, qty: 3, value: 17, bonus: 0.12, mh: 17,
      desc: 'Ready in 4 days. Three curls a bed, reliably.',
    },
    berry: {
      name: 'Tide Berry', seedName: 'Tide Berry Seeds', seedPrice: 55,
      sd: 2, qty: 2, value: 40, bonus: 0.18, mh: 18,
      desc: 'Ready in 4 days. Often throws a bonus berry.',
    },
    gourd: {
      name: 'Reef Gourd', seedName: 'Reef Gourd Seeds', seedPrice: 95,
      sd: 3, qty: 2, value: 75, bonus: 0.15, mh: 19,
      desc: 'Ready in 6 days. Heavy, slow, worth it.',
    },
    moon: {
      name: 'Moonbloom', seedName: 'Moonbloom Bulbs', seedPrice: 180,
      sd: 4, qty: 3, value: 120, bonus: 0.20, mh: 22,
      desc: 'Ready in 8 days. The pearl of the plank garden.',
    },
  },

  // Built from CROPS at load so the shop and any inventory UI never restate
  // prices or art names. SEEDS: [{key,name,price,art,desc}]  PRODUCE: key -> {name,value,art}
  SEEDS: [],
  PRODUCE: {},

  // Bed layout along the pier. Every x keeps >= 45 units of clearance from the
  // ClamNet table (232), the workbench (300) and the pilings (460/640/820) so
  // the world's nearest-spot search never fights over a prompt. `b` is the
  // number of pilings that must exist before that stretch of deck is walkable.
  PLOT_DEF: [
    { x: 348, b: 1 }, { x: 378, b: 1 }, { x: 408, b: 1 },
    { x: 505, b: 2 }, { x: 535, b: 2 }, { x: 565, b: 2 }, { x: 595, b: 2 },
    { x: 685, b: 3 }, { x: 715, b: 3 }, { x: 745, b: 3 }, { x: 775, b: 3 },
  ],

  // ---- runtime state (never persisted) -------------------------------------------
  fx: [],             // water droplets / soil crumbs / harvest sparks, in world space
  time: 0,
  open: false,        // seed-pouch picker modal
  plot: -1,           // plot the picker will plant into
  sel: 0,
  _stamp: -1,         // dedupes update() if the integrator also calls it
  _hooked: false,
  _grit: null,        // per-bed soil speck offsets, built once

  // ---- picker window geometry ------------------------------------------------------
  WX: 122, WY: 50, WW: 236, WH: 164,
  ROW_H: 24,

  // ---- state plumbing ---------------------------------------------------------------

  // Every public entry point starts here: G does not exist at file-scope time and
  // G.farm is a top-level object, which Game.load does NOT deep-merge — so the
  // whole shape has to be re-normalised defensively rather than trusted.
  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    this._hook();
    let f = G.farm;
    if (!f || typeof f !== 'object') { f = {}; G.farm = f; }
    if (!Array.isArray(f.plots)) f.plots = [];
    for (let i = 0; i < this.PLOT_DEF.length; i++) {
      let p = f.plots[i];
      if (!p || typeof p !== 'object') { p = this._blank(); f.plots[i] = p; }
      p.i = i;
      p.x = this.PLOT_DEF[i].x;         // bed layout is code-owned; a save never moves one
      p.tilled = !!p.tilled;
      if (!this._def(p.crop)) p.crop = null;
      p.stage = clamp(Math.round(p.stage) || 0, 0, this.STAGES - 1);
      p.days = Math.max(0, Math.round(p.days) || 0);
      p.dry = Math.max(0, Math.round(p.dry) || 0);
      p.watered = !!p.watered;
      p.dead = !!p.dead;
      if (!p.crop) { p.dead = false; p.watered = false; p.days = 0; p.dry = 0; p.stage = 0; }
    }
    f.plots.length = this.PLOT_DEF.length;
    if (!f.seeds || typeof f.seeds !== 'object') f.seeds = {};
    if (!f.crops || typeof f.crops !== 'object') f.crops = {};
    for (const k of this.ORDER) {
      f.seeds[k] = Math.max(0, Math.round(f.seeds[k]) || 0);
      f.crops[k] = Math.max(0, Math.round(f.crops[k]) || 0);
    }
    f.planted = Math.max(0, Math.round(f.planted) || 0);
    f.reaped = Math.max(0, Math.round(f.reaped) || 0);
    // lastDay = the calendar day the beds have already been advanced to
    if (typeof f.lastDay !== 'number' || !isFinite(f.lastDay)) f.lastDay = G.day;
    if (f.lastDay > G.day) f.lastDay = G.day;   // save rollback / new game
    return true;
  },

  _blank() {
    return { x: 0, tilled: false, crop: null, stage: 0, watered: false, days: 0, dry: 0, dead: false };
  },

  // own-property lookup only: a corrupt save could hold 'constructor' and walk the prototype
  _def(key) {
    return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(this.CROPS, key))
      ? this.CROPS[key] : null;
  },

  // Game/TouchUI live in main.js, which loads AFTER this file, so the modal hooks
  // cannot be installed at file scope (temporal dead zone). They go in on the
  // first ensure(), i.e. the first world frame.
  _hook() {
    if (this._hooked) return;
    if (typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._hooked = true;
    const self = this;

    // Game.globalUpdate runs every frame while a scene is live (even under Shop
    // or Bench), which makes it the one safe update slot for a bolt-on module.
    const gUpdate = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) {
      gUpdate(dt);
      self.update(dt);
      if (self.open && Game.fadeDir === 0 && !Game.helpOpen && !Shop.open && !Bench.open) self.updatePicker(dt);
    };
    // Game.drawHUD is called only when no other modal is up and after the colour
    // grade — exactly Shop's z-order. Returning early hides the HUD like Shop does.
    const gHUD = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (self.open) { self.drawPicker(c); return; }
      gHUD(c);
    };
    // scene changes must dismiss the picker (Shop/Bench get this from updateFade)
    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { self.open = false; return gGo(scene, arg); };
    // hide the walk/paw buttons under the picker so touches reach its rows
    const layout = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () { return self.open ? [] : layout(); };
    // main.js does not know about us, so the scene would keep walking underneath
    if (typeof WorldScene !== 'undefined' && WorldScene.update) {
      const wUpdate = WorldScene.update.bind(WorldScene);
      WorldScene.update = function (dt) { if (self.open) return; wUpdate(dt); };
    }
  },

  // ---- queries ------------------------------------------------------------------------

  plots() { return this.ensure() ? G.farm.plots : []; },

  // a bed only exists once the deck it sits on has been built out
  available(p) { return !!p && (G.bridge || 1) >= this.PLOT_DEF[p.i].b; },

  ready(p) { return !!(p && p.crop && !p.dead && p.stage >= this.STAGES - 1); },

  totalDays(key) { const c = this._def(key); return c ? c.sd * (this.STAGES - 1) : 0; },

  daysLeft(p) {
    if (!p || !p.crop || p.dead) return 0;
    return Math.max(0, this.totalDays(p.crop) - p.days);
  },

  stageFor(key, days) {
    const c = this._def(key);
    if (!c) return 0;
    return clamp(Math.floor(days / c.sd), 0, this.STAGES - 1);
  },

  seedCount(key) { return this.ensure() ? (G.farm.seeds[key] || 0) : 0; },
  produceCount(key) { return this.ensure() ? (G.farm.crops[key] || 0) : 0; },
  seedTotal() { let n = 0; for (const k of this.ORDER) n += this.seedCount(k); return n; },
  produceTotal() { let n = 0; for (const k of this.ORDER) n += this.produceCount(k); return n; },
  produceValue() { let v = 0; for (const k of this.ORDER) v += this.produceCount(k) * this.PRODUCE[k].value; return v; },

  readyCount() { let n = 0; for (const p of this.plots()) if (this.available(p) && this.ready(p)) n++; return n; },
  thirstyCount() {
    let n = 0;
    for (const p of this.plots()) if (this.available(p) && p.crop && !p.dead && !p.watered) n++;
    return n;
  },

  // nearest bed to a world x, within reach — the whole spatial API the world needs
  at(x) {
    if (!this.ensure()) return null;
    let best = null, bd = this.REACH;
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      const d = Math.abs(p.x - x);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  // ---- actions ---------------------------------------------------------------------------

  _get(i) {
    if (!this.ensure()) return null;
    const p = G.farm.plots[i | 0];
    return (p && this.available(p)) ? p : null;
  },

  till(i) {
    const p = this._get(i);
    if (!p || p.tilled) return false;
    p.tilled = true;
    this.burst(p.x, this.DECK_Y - 1, 1, 10);
    SND.scrape();
    Game.toast('Bed tilled. Plant a seed packet!');
    Game.save();
    return true;
  },

  // one button for "get rid of what's here": pull the crop, or un-till a bare bed
  clear(i) {
    const p = this._get(i);
    if (!p) return false;
    if (p.crop) {
      const wasDead = p.dead;
      p.crop = null; p.dead = false; p.stage = 0; p.days = 0; p.dry = 0; p.watered = false;
      this.burst(p.x, this.DECK_Y - 2, 1, 12);
      SND.clink();
      Game.toast(wasDead ? 'Cleared the withered crop.' : 'Pulled up the crop.');
    } else if (p.tilled) {
      p.tilled = false;
      SND.clink();
      Game.toast('Planks put back.');
    } else {
      return false;
    }
    Game.save();
    return true;
  },

  plant(i, key) {
    const p = this._get(i);
    const c = this._def(key);
    if (!p || !c) return false;
    if (!p.tilled) { SND.alarm(); Game.toast('Till the bed first.'); return false; }
    if (p.crop) { SND.alarm(); Game.toast('Something is already growing there.'); return false; }
    if (this.seedCount(key) <= 0) {
      SND.alarm();
      Game.toast(`No ${c.name} seeds — buy packets on ClamNet.`);
      return false;
    }
    G.farm.seeds[key]--;
    G.farm.planted++;
    p.crop = key; p.stage = 0; p.days = 0; p.dry = 0; p.dead = false; p.watered = false;
    this.burst(p.x, this.DECK_Y - 2, 1, 8);
    SND.pop(1.15);
    Game.toast(`Planted ${c.name} — water it daily.`);
    Game.save();
    return true;
  },

  water(i) {
    const p = this._get(i);
    if (!p || !p.crop || p.dead) return false;
    if (p.watered) { SND.blip(); Game.toast('Already watered today.'); return false; }
    p.watered = true;
    p.dry = 0;
    this.burst(p.x, this.DECK_Y - 4, 0, 18);
    SND.bubble();
    Game.save();
    return true;
  },

  // -> { key, count, name } or null
  harvest(i) {
    const p = this._get(i);
    if (!this.ready(p)) return null;
    const key = p.crop, c = this.CROPS[key];
    const count = c.qty + (Math.random() < c.bonus ? 1 : 0);
    G.farm.crops[key] += count;
    G.farm.reaped += count;
    p.crop = null; p.stage = 0; p.days = 0; p.dry = 0; p.watered = false; p.dead = false;
    this.burst(p.x, this.DECK_Y - 8, 2, 16);
    SND.pop(1.35);
    if (c.value >= 75) SND.chime();
    Game.toast(`Harvested ${count} x ${c.name}  (+$${count * c.value})`);
    Game.save();
    return { key, count, name: c.name };
  },

  // context action for a bed — what the [E] prompt does, in priority order
  act(i) {
    const p = this._get(i);
    if (!p) return;
    if (!p.tilled) { this.till(i); return; }
    if (p.dead) { this.clear(i); return; }
    if (!p.crop) { this.openPicker(i); return; }
    if (this.ready(p)) { this.harvest(i); return; }
    if (!p.watered) { this.water(i); return; }
    const c = this.CROPS[p.crop];
    Game.toast(`${c.name}: ${this.daysLeft(p)} day(s) to go. Watered.`);
    SND.blip();
  },

  label(p) {
    if (!p.tilled) return 'Till Bed';
    if (p.dead) return 'Clear Withered Crop';
    if (!p.crop) return this.seedTotal() > 0 ? 'Plant Seeds' : 'Plant Seeds  (none — see ClamNet)';
    const c = this.CROPS[p.crop];
    if (this.ready(p)) return `Harvest ${c.name}`;
    if (!p.watered) return p.dry > 0 ? `Water ${c.name}  (wilting!)` : `Water ${c.name}`;
    return `${c.name} — ${this.daysLeft(p)}d to go`;
  },

  // merge straight into WorldScene.spots()
  spots() {
    if (!this.ensure()) return [];
    const out = [];
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      const i = p.i;
      out.push({ x: p.x, label: this.label(p), act: () => this.act(i) });
    }
    return out;
  },

  // ---- shop / inventory bridge --------------------------------------------------------

  buySeed(key, n) {
    if (!this.ensure()) return false;
    const c = this._def(key);
    if (!c) return false;
    n = Math.max(1, Math.round(n) || 1);
    const price = c.seedPrice * n;
    if (G.money < price) { SND.alarm(); Game.toast('Not enough sand dollars!'); return false; }
    // reuse the canonical purchase helper so cash/toast/save behave identically
    Shop.buy(price, () => { G.farm.seeds[key] += n; }, `${c.seedName} x${n}`);
    return true;
  },

  // ship produce with the same drone crate the shell trade uses
  sellProduce(keys) {
    if (!this.ensure()) return 0;
    let v = 0, c = 0;
    for (const k of keys) {
      const n = this.produceCount(k);
      if (n <= 0) continue;
      v += n * this.PRODUCE[k].value;
      c += n;
      G.farm.crops[k] = 0;
    }
    if (c === 0) return 0;
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    SND.click();
    Game.toast(`Produce shipped: $${v} — drone en route!`);
    Game.save();
    return v;
  },

  // ---- the night pass -----------------------------------------------------------------

  // Advance the beds to today. Idempotent per calendar day, so it is safe to call
  // from sleep() whether the day counter has been bumped yet or not — whichever
  // call sees the new G.day does the work and the other becomes a no-op.
  newDay() {
    if (!this.ensure()) return;
    const f = G.farm;
    if (f.lastDay >= G.day) return;
    let guard = 0;
    while (f.lastDay < G.day && guard++ < 30) { this._night(); f.lastDay++; }
    f.lastDay = G.day;   // absurd gaps (edited saves) collapse instead of hanging
    Game.save();
  },

  _night() {
    let ripe = 0, thirsty = 0, died = 0;
    for (const p of G.farm.plots) {
      if (!p.crop || p.dead) continue;
      if (p.watered) {
        p.days++;
        p.dry = 0;
        p.stage = this.stageFor(p.crop, p.days);
        if (this.ready(p)) ripe++;
      } else {
        p.dry++;
        if (p.dry >= this.DRY_DEATH) { p.dead = true; died++; }
        else thirsty++;
      }
      p.watered = false;   // the can has to come out again every morning
    }
    const bits = [];
    if (ripe) bits.push(`${ripe} ready`);
    if (thirsty) bits.push(`${thirsty} thirsty`);
    if (died) bits.push(`${died} withered`);
    if (bits.length) Game.toast(`Dock farm: ${bits.join('  ')}`);
  },

  // ---- particles -------------------------------------------------------------------------

  // kind: 0 water, 1 soil, 2 harvest spark
  burst(x, y, kind, n) {
    for (let i = 0; i < n; i++) {
      if (this.fx.length >= this.FX_MAX) break;
      const sp = kind === 0 ? rand(14, 46) : rand(10, 34);
      const a = rand(-2.5, -0.65);   // upward fan
      this.fx.push({
        x: x + rand(-8, 8), y: y + rand(-2, 1),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        gy: this.DECK_Y - 1, k: kind, t: rand(0.42, 0.95), s: kind === 2 ? rand(0.6, 1.1) : rand(0.4, 0.85),
      });
    }
  },

  update(dt) {
    if (!this.ensure()) return;
    // self-driven from the Game.globalUpdate hook; ignore a duplicate call in the same frame
    if (Game.time === this._stamp) return;
    this._stamp = Game.time;

    this.time += dt;
    if (G.farm.lastDay < G.day) this.newDay();   // day can roll over mid-dive or under a modal

    if (this.fx.length) {
      for (const p of this.fx) {
        p.t -= dt;
        p.vy += (p.k === 2 ? 42 : 150) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > p.gy && p.vy > 0) { p.y = p.gy; p.vy *= -0.3; p.vx *= 0.55; }   // splat off the planks
      }
      this.fx = this.fx.filter(p => p.t > 0);
    }
  },

  // ---- drawing ----------------------------------------------------------------------------

  // Applies its own camera translate. If you are already inside WorldScene's
  // `ctx.translate(-camX, 0)` block, call drawInWorld() instead.
  draw(ctx, camX) {
    const cam = camX || 0;
    ctx.save();
    ctx.translate(-cam, 0);
    this.drawInWorld(ctx, cam);
    ctx.restore();
  },

  drawInWorld(ctx, camX) {
    if (!this.ensure()) return;
    const cam = camX || 0;
    if (!this._grit) this._buildGrit();
    for (const p of G.farm.plots) {
      if (!this.available(p)) continue;
      if (p.x < cam - 40 || p.x > cam + W + 40) continue;   // cull: the dock is 900 units long
      this._drawPlot(ctx, p);
    }
    this._drawFx(ctx, cam);
  },

  // deterministic soil specks, built once — never allocate per frame
  _buildGrit() {
    const rng = mulberry32(4242);
    this._grit = [];
    for (let i = 0; i < this.PLOT_DEF.length; i++) {
      const g = [];
      for (let j = 0; j < 9; j++) {
        g.push({ dx: (rng() - 0.5) * (this.BED_W - 4), dy: rng() * 3.2, lit: rng() < 0.42 });
      }
      this._grit.push(g);
    }
  },

  _drawPlot(ctx, p) {
    const x = p.x, dy = this.DECK_Y;
    const hw = this.BED_W / 2;

    if (!p.tilled) {
      // an untilled bed reads as a chalked-out square of planking with corner pegs
      ctx.strokeStyle = 'rgba(230,200,150,0.22)';
      ctx.lineWidth = PIX;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x - hw, dy - 3, this.BED_W, 3.5);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(109,69,38,0.75)';
      ctx.fillRect(x - hw, dy - 3.5, 1, 1.5);
      ctx.fillRect(x + hw - 1, dy - 3.5, 1, 1.5);
      return;
    }

    // ---- the bed: a shallow trough cut into the planks ---------------------------
    ctx.fillStyle = 'rgba(18,11,6,0.55)';
    ctx.fillRect(x - hw - 0.5, dy - 4, this.BED_W + 1, 5.5);
    ctx.fillStyle = p.watered ? '#3a2411' : '#6a4526';
    ctx.fillRect(x - hw, dy - 3.5, this.BED_W, 4.5);
    ctx.fillStyle = p.watered ? '#4a3018' : '#7a5232';
    ctx.fillRect(x - hw, dy - 3.5, this.BED_W, 0.75);     // sunlit crest of the mound

    const grit = this._grit[p.i];
    ctx.fillStyle = p.watered ? '#28180b' : '#5a3a1e';
    for (const s of grit) if (!s.lit) ctx.fillRect(x + s.dx, dy - 3.2 + s.dy, PIX * 2, PIX * 2);
    ctx.fillStyle = p.watered ? '#5a3a1e' : '#8a6434';
    for (const s of grit) if (s.lit) ctx.fillRect(x + s.dx, dy - 3.2 + s.dy, PIX * 2, PIX * 2);

    // bed frame
    ctx.fillStyle = '#8a6434';
    ctx.fillRect(x - hw - 0.5, dy - 4, 0.5, 5.5);
    ctx.fillRect(x + hw, dy - 4, 0.5, 5.5);

    if (p.watered) this._drawSheen(ctx, x, dy);
    if (p.crop) this._drawCrop(ctx, p, x, dy - 1.5);
  },

  _drawSheen(ctx, x, dy) {
    const hw = this.BED_W / 2;
    ctx.fillStyle = 'rgba(120,205,235,0.18)';
    ctx.fillRect(x - hw, dy - 3.5, this.BED_W, 4.5);
    // three slow-winking beads of standing water
    ctx.fillStyle = '#bfe8f5';
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.time * 2.2 + i * 2.1 + x);
      ctx.fillRect(x - 6 + i * 6, dy - 2.6 + (i % 2) * 1.4, 1, 0.5);
    }
    ctx.globalAlpha = 1;
  },

  _drawCrop(ctx, p, x, soilY) {
    const c = this.CROPS[p.crop];
    const name = `crop_${p.crop}_${p.stage}`;
    const ripe = this.ready(p);
    const grow = c.mh * [0.36, 0.66, 1][p.stage];
    const w = this._widthFor(name, grow);
    const h = assetH(name, w);
    // ready crops bob; everything else breathes, so the eye is drawn to the payout
    const bob = ripe
      ? Math.sin(this.time * 2.4 + p.i * 1.1) * 0.8
      : Math.sin(this.time * 1.1 + p.i) * 0.25;

    if (p.dead) {
      // wilted: squashed flat and drained of colour, unmistakable at a glance
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.translate(Math.round(x * DPX) / DPX, soilY);
      ctx.scale(1.06, 0.55);
      drawA(ctx, name, -w / 2, -h, w, h);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#7a6a58';
      ctx.lineWidth = PIX * 2;
      const cy = soilY - h * 0.33;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, cy - 2.5); ctx.lineTo(x + 2.5, cy + 2.5);
      ctx.moveTo(x + 2.5, cy - 2.5); ctx.lineTo(x - 2.5, cy + 2.5);
      ctx.stroke();
      return;
    }

    drawA(ctx, name, Math.round((x - w / 2) * DPX) / DPX, soilY - h + bob, w, h);

    if (!ripe) {
      // a two-pip progress tick under the bed: how many nights are banked
      const total = this.totalDays(p.crop);
      const done = clamp(p.days / Math.max(1, total), 0, 1);
      ctx.fillStyle = 'rgba(12,8,4,0.5)';
      ctx.fillRect(x - 7, soilY + 2.2, 14, 1.25);
      ctx.fillStyle = p.dry > 0 ? '#e8434c' : '#a0f2b4';
      ctx.fillRect(x - 7, soilY + 2.2, 14 * done, 1.25);
      return;
    }

    this._drawReady(ctx, p, x, soilY - h + bob);
  },

  // the "come collect me" flag: halo, floating produce icon, twinkles
  _drawReady(ctx, p, x, topY) {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + p.i);
    ctx.fillStyle = 'rgba(255,230,110,0.09)';
    ctx.beginPath();
    ctx.arc(x, topY + 4, 8 + pulse * 2.5, 0, TAU);
    ctx.fill();

    const art = this.PRODUCE[p.crop].art;
    const iy = topY - 10 - pulse * 1.2;
    ctx.fillStyle = 'rgba(20,14,8,0.4)';
    ctx.beginPath();
    ctx.arc(x, iy + 3.5, 5, 0, TAU);
    ctx.fill();
    const iw = this._widthFor(art, 7);
    drawA(ctx, art, x - iw / 2, iy, iw, assetH(art, iw));

    ctx.fillStyle = '#ffe66e';
    for (let i = 0; i < 3; i++) {
      const a = this.time * 1.6 + i * (TAU / 3);
      const s = 0.9 + 0.7 * Math.abs(Math.sin(this.time * 3.4 + i * 1.7));
      this._star(ctx, x + Math.cos(a) * 9, topY + 2 + Math.sin(a) * 5, s);
    }
  },

  _star(ctx, x, y, s) {
    ctx.fillRect(x - s, y - PIX, s * 2, PIX * 2);
    ctx.fillRect(x - PIX, y - s, PIX * 2, s * 2);
  },

  // inverse of assetH: the width that gives a sprite the height we want
  _widthFor(name, h) {
    const img = ASSETS[name];
    if (!img || !img.width || !img.height) return h;   // same silent fallback as assetH
    return h * img.width / img.height;
  },

  _drawFx(ctx, cam) {
    if (!this.fx.length) return;
    // one fillStyle per kind — never build a colour string inside the loop
    const PAL = ['#bfe8f5', '#7a5232', '#ffe66e'];
    for (let k = 0; k < 3; k++) {
      let first = true;
      for (const p of this.fx) {
        if (p.k !== k || p.x < cam - 20 || p.x > cam + W + 20) continue;
        if (first) { ctx.fillStyle = PAL[k]; first = false; }
        ctx.globalAlpha = clamp(p.t * 1.8, 0, k === 0 ? 0.9 : 0.75);
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
  },

  // ---- seed pouch picker (self-contained modal) --------------------------------------

  openPicker(i) {
    if (!this.ensure()) return;
    if (Shop.open || Bench.open) return;
    if (this.seedTotal() <= 0) {
      SND.alarm();
      Game.toast('No seed packets. Buy some on ClamNet!');
      return;
    }
    this.plot = i | 0;
    this.open = true;
    this.sel = 0;
    for (let s = 0; s < this.SEEDS.length; s++) {
      if (this.seedCount(this.SEEDS[s].key) > 0) { this.sel = s; break; }
    }
    SND.blip();
    if (!G.flags.seenFarm) {
      G.flags.seenFarm = true;
      Game.toast('Water a crop every day or it withers in two.');
    }
  },

  closePicker() { this.open = false; SND.click(); },

  _rowRect(i) {
    return { x: this.WX + 8, y: this.WY + 28 + i * this.ROW_H, w: this.WW - 16, h: this.ROW_H - 2 };
  },
  _closeRect() { return { x: this.WX + this.WW - 26, y: this.WY + 2, w: 24, h: 18 }; },
  _in(r, mx, my) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; },

  updatePicker(dt) {
    this.time += dt;
    const p = this._get(this.plot);
    if (!p || !p.tilled || p.crop) { this.open = false; return; }   // world changed under us

    if (Input.p('Escape')) { this.closePicker(); return; }
    for (let i = 0; i < this.SEEDS.length; i++) {
      if (Input.p(`Digit${i + 1}`)) { this.sel = i; this._tryPlant(i); return; }
    }
    if (Input.wheelDelta) this.sel = clamp(this.sel + Input.wheelDelta, 0, this.SEEDS.length - 1);

    if (!Input.mouse.clicked) return;
    const mx = Input.mouse.x, my = Input.mouse.y;
    if (this._in(this._closeRect(), mx, my)) { this.closePicker(); return; }
    for (let i = 0; i < this.SEEDS.length; i++) {
      if (this._in(this._rowRect(i), mx, my)) { this.sel = i; this._tryPlant(i); return; }
    }
    // a click on the dimmed world behind the panel backs out, like tapping away
    if (mx < this.WX || mx > this.WX + this.WW || my < this.WY || my > this.WY + this.WH) this.closePicker();
  },

  _tryPlant(i) {
    const s = this.SEEDS[i];
    if (!s) return;
    if (this.seedCount(s.key) <= 0) {
      SND.alarm();
      Game.toast(`No ${s.name} in the pouch.`);
      return;
    }
    if (this.plant(this.plot, s.key)) this.open = false;
  },

  drawPicker(c) {
    if (!this.ensure()) return;
    const X = this.WX, Y = this.WY, WWi = this.WW;
    c.fillStyle = 'rgba(4,10,8,0.66)';
    c.fillRect(0, 0, W, H);
    uiPanel(c, X, Y, WWi, this.WH, 0.95);

    text(c, 'SEED POUCH', X + 10, Y + 6, { size: 8, color: '#ffe6b0' });
    const p = this._get(this.plot);
    text(c, p ? `Bed ${this.plot + 1}` : '', X + WWi - 34, Y + 7, { size: 6, color: '#a89878', align: 'right' });
    const cr = this._closeRect();
    const overClose = this._in(cr, Input.mouse.x, Input.mouse.y);
    text(c, 'X', cr.x + cr.w / 2, cr.y + 4, { size: 9, color: overClose ? '#ffe66e' : '#c9a271', align: 'center' });
    c.fillStyle = 'rgba(226,200,150,0.22)';
    c.fillRect(X + 8, Y + 22, WWi - 16, PIX);

    for (let i = 0; i < this.SEEDS.length; i++) {
      const s = this.SEEDS[i];
      const cd = this.CROPS[s.key];
      const n = this.seedCount(s.key);
      const r = this._rowRect(i);
      const hot = this._in(r, Input.mouse.x, Input.mouse.y) || this.sel === i;
      if (hot) rrect(c, r.x, r.y, r.w, r.h, n > 0 ? 'rgba(226,200,150,0.14)' : 'rgba(226,200,150,0.06)');

      const iw = this._widthFor(s.art, 13);
      c.globalAlpha = n > 0 ? 1 : 0.4;
      drawA(c, s.art, r.x + 10 - iw / 2, r.y + 4, iw, assetH(s.art, iw));
      c.globalAlpha = 1;

      text(c, `${i + 1}. ${cd.name}`, r.x + 22, r.y + 3,
        { size: 7, color: n > 0 ? '#f6e8c9' : '#8a7a5a' });
      text(c, `${this.totalDays(s.key)}d  •  ${cd.qty}x $${cd.value}  •  packet $${cd.seedPrice}`,
        r.x + 22, r.y + 12, { size: 6, color: n > 0 ? '#a89878' : '#6a5c44' });
      text(c, n > 0 ? `x${n}` : '—', r.x + r.w - 46, r.y + 6,
        { size: 7, color: n > 0 ? '#ffe66e' : '#6a5c44', align: 'right' });
      text(c, n > 0 ? 'PLANT' : 'NONE', r.x + r.w - 6, r.y + 6,
        { size: 7, color: n > 0 ? '#a0f2b4' : '#6a5c44', align: 'right' });
    }

    text(c, TouchUI.enabled ? 'tap a packet to plant  •  X to close' : '[1-5] plant   [Esc] close',
      X + 10, Y + this.WH - 13, { size: 6, color: '#8a9484' });
    text(c, `$${G.money}`, X + WWi - 10, Y + this.WH - 13, { size: 6, color: '#ffe66e', align: 'right' });

    // Game.drawCursor hides the arrow after 3 idle seconds and only special-cases
    // Shop, so this pointer-driven panel draws its own.
    const m = Input.mouse;
    if (!TouchUI.enabled && m.idleT > 3) {
      c.save();
      c.translate(Math.round(m.x), Math.round(m.y));
      c.fillStyle = '#101820';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
      c.fillStyle = '#f2f4f6';
      c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
      c.restore();
    }
  },
};

// ---- derive the shop catalogue from the crop table (one source of truth) --------
for (const k of Farm.ORDER) {
  const c = Farm.CROPS[k];
  Farm.SEEDS.push({
    key: k,
    name: c.seedName,
    price: c.seedPrice,
    art: `crop_${k}_seed`,
    desc: c.desc,
  });
  Farm.PRODUCE[k] = { name: c.name, value: c.value, art: `crop_${k}_p` };
}
