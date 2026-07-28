// ---- underwater feel: the tool in your paws, the reef, and the water ----------
//
// A drop-in layer for the first-person dive. The dive scene owns the simulation;
// this owns how it FEELS — a tool with real weight, chips and shockwaves when it
// bites, a reef that sways, and water that moves.
//
// Everything here is allocation-free in the steady state: particles live in
// preallocated pools and are recycled, and a batch sets fillStyle once and varies
// ctx.globalAlpha. Building a colour string per particle has blown this game's
// frame budget before.
'use strict';

const DiveFX = {
  // ---- tuning -------------------------------------------------------------------
  TOOL_H: 62,          // the scraper's on-screen height. Was 18: this is the ask.
  BAR_H: 74,           // the pry bar is longer still
  LAG: 13,             // how hard the tool chases the cursor (spring stiffness)
  DAMP: 0.72,          // ...and how much of last frame's velocity survives
  KICK: 26,            // recoil, in logical units, when the tool bites

  CHIP_MAX: 90,
  PUFF_MAX: 40,
  RING_MAX: 12,
  MOTE_MAX: 54,
  SPARK_MAX: 34,

  // ---- tool spring state (the caller only passes a target) -----------------------
  tx: 240, ty: 135,    // where the tool actually is
  tvx: 0, tvy: 0,      // and how fast it is getting there
  tilt: 0, tvr: 0,
  recoil: 0,           // decays to 0; pushes the tool back along its own axis
  bite: 0,             // 0..1, how hard it is currently chewing

  // ---- screen kick ---------------------------------------------------------------
  shx: 0, shy: 0, shakeT: 0, shakeAmp: 0,

  // ---- pools ---------------------------------------------------------------------
  chips: null, puffs: null, rings: null, motes: null, sparks: null,
  reef: null, reefSeed: -1,
  time: 0,
  _init: false,

  init() {
    if (this._init) return;
    this._init = true;
    // Every pool entry is created once and reused. `t` <= 0 means free.
    const mk = (n, extra) => {
      const a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1 }, extra);
      return a;
    };
    this.chips = mk(this.CHIP_MAX, { r: 1, rot: 0, vr: 0, kind: 0 });
    this.puffs = mk(this.PUFF_MAX, { r: 3, gr: 8 });
    this.rings = mk(this.RING_MAX, { r: 2, vr: 60, w: 1.4 });
    this.sparks = mk(this.SPARK_MAX, { r: 1 });
    // motes drift forever; they are seeded once and never freed
    this.motes = mk(this.MOTE_MAX, { r: 1, ph: 0, sp: 1 });
    for (const m of this.motes) {
      m.x = Math.random() * W; m.y = Math.random() * H;
      m.r = 0.5 + Math.random() * 1.3;
      m.ph = Math.random() * TAU;
      m.sp = 0.3 + Math.random() * 0.9;
      m.vy = -2 - Math.random() * 7;
      m.t = 1; m.life = 1;
    }
  },

  // first free slot, or the oldest one if the pool is saturated
  _take(pool) {
    let oldest = 0, best = 1e9;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].t <= 0) return pool[i];
      if (pool[i].t < best) { best = pool[i].t; oldest = i; }
    }
    return pool[oldest];
  },

  // ---- the current: everything underwater sways with it --------------------------
  // One shared function so the tool, the reef and the motes all agree about which
  // way the water is pushing at a given depth.
  surge(t, depth) {
    return Math.sin(t * 0.42 + depth * 0.004) * 3.4
         + Math.sin(t * 0.17 + depth * 0.0013) * 2.1;
  },

  shake() { return { x: this.shx, y: this.shy }; },

  kick(amp, dur) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur || 0.22);
  },

  // ---- per-frame ------------------------------------------------------------------
  update(dt) {
    this.init();
    if (dt > 0.1) dt = 0.1;           // a tab-switch must not teleport anything
    this.time += dt;

    // screen kick: a fast decaying random offset, snapped to whole texels so it
    // reads as a jolt rather than a blur
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.22);
      this.shx = Math.round((Math.random() * 2 - 1) * a * DPX) / DPX;
      this.shy = Math.round((Math.random() * 2 - 1) * a * DPX) / DPX;
      if (this.shakeT <= 0) { this.shx = 0; this.shy = 0; this.shakeAmp = 0; }
    }

    this.recoil *= Math.pow(0.0016, dt);      // ~fast attack, slow-ish release
    this.bite *= Math.pow(0.02, dt);

    const step = (p, gravity, dragPow) => {
      for (let i = 0; i < p.length; i++) {
        const o = p[i];
        if (o.t <= 0) continue;
        o.t -= dt;
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (gravity) o.vy += gravity * dt;
        if (dragPow) { const d = Math.pow(dragPow, dt); o.vx *= d; o.vy *= d; }
      }
    };
    // chips sink and tumble; water drag is strong, so they slow fast
    step(this.chips, 46, 0.22);
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      if (c.t > 0) c.rot += c.vr * dt;
    }
    step(this.puffs, -6, 0.05);        // dust rises slightly and stalls
    step(this.sparks, 10, 0.1);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.t <= 0) continue;
      r.t -= dt;
      r.r += r.vr * dt;
      r.vr *= Math.pow(0.3, dt);
    }
    // motes: endless slow drift, wrapping at the edges
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.y += m.vy * dt;
      m.x += Math.sin(this.time * m.sp + m.ph) * 6 * dt;
      if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
      if (m.x < -4) m.x = W + 4; else if (m.x > W + 4) m.x = -4;
    }
  },

  // ---- the tool in your paws --------------------------------------------------------
  // opts: { tool:'scraper'|'pry', scraping, prying, power, dt }
  // The caller passes only the cursor; the spring, tilt, recoil and follow-through
  // live here, which is what makes it read as a held object instead of a decal.
  drawTool(ctx, x, y, opts) {
    this.init();
    const o = opts || {};
    const dt = Math.min(0.05, o.dt || 1 / 60);
    const pry = o.tool === 'pry';

    // spring toward the cursor
    const k = this.LAG, d = Math.pow(this.DAMP, dt * 60);
    this.tvx = (this.tvx + (x - this.tx) * k * dt) * d;
    this.tvy = (this.tvy + (y - this.ty) * k * dt) * d;
    this.tx += this.tvx; this.ty += this.tvy;

    // it tilts INTO the swing: lead with the head, trail the handle
    const want = clamp(this.tvx * 0.024, -0.5, 0.5) + (pry ? -0.34 : 0.16);
    this.tvr = (this.tvr + (want - this.tilt) * 15 * dt) * Math.pow(0.6, dt * 60);
    this.tilt += this.tvr;

    // chewing wobble while a scrape is landing, and the pry lean while loaded
    let tilt = this.tilt;
    if (o.scraping) tilt += Math.sin(this.time * 42) * 0.085 * (0.4 + this.bite);
    if (o.prying) tilt += (o.power || 0) * 0.5;

    const h = pry ? this.BAR_H : this.TOOL_H;
    // recoil pushes the tool back along its own axis
    const back = this.recoil * this.KICK;
    const cx = this.tx - Math.sin(tilt) * back * 0.3;
    const cy = this.ty + Math.cos(tilt) * back * 0.3;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);

    // a soft shadow on the wall behind it, offset by the depth of the swing
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#04121c';
    ctx.beginPath();
    ctx.ellipse(4, 5, h * 0.16, h * 0.30, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    const img = ASSETS[pry ? 'g_crowbar' : 'g_scraper'];
    if (img && img.width) {
      const w = h * img.width / img.height;
      // squash a touch on the bite, so the impact has follow-through
      const sq = 1 + this.bite * 0.09;
      ctx.scale(1 / sq, sq);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      // No rim-light strip: these sprites are hooked and narrow, so a bar down
      // the sprite's left edge lands in empty space and reads as a loose decal.
    }
    ctx.restore();

    // the paw grip: two dark knuckle blobs at the handle end, so the tool is held
    const gx = cx + Math.sin(tilt) * h * 0.34;
    const gy = cy + Math.cos(tilt) * h * 0.34;
    ctx.fillStyle = '#3b2a1e';
    ctx.beginPath(); ctx.ellipse(gx, gy, 5.4, 4.2, tilt, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a4331';
    ctx.beginPath(); ctx.ellipse(gx - 1, gy - 1, 3.6, 2.6, tilt, 0, TAU); ctx.fill();

    // the sweet spot glows while a pry is in its window
    if (o.prying && o.power !== undefined && Math.abs(o.power) < 0.3) {
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 30) * 0.2;
      ctx.fillStyle = '#ffe66e';
      ctx.beginPath();
      ctx.arc(this.tx - Math.sin(tilt) * h * 0.42, this.ty - Math.cos(tilt) * h * 0.42, 5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  // ---- scrape juice -------------------------------------------------------------------
  // Called every time the scrape actually removes crust. Fast attack: chips fly
  // NOW, dust lingers, and a ring snaps out so the hit lands on the eye.
  scrapeHit(x, y, kind) {
    this.init();
    this.bite = 1;
    this.recoil = 1;
    this.kick(1.1, 0.1);

    const n = 5 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const c = this._take(this.chips);
      const a = -Math.PI * 0.5 + rand(-1.5, 1.5);
      const sp = rand(50, 150);
      c.x = x + rand(-3, 3); c.y = y + rand(-3, 3);
      c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp;
      c.r = rand(0.9, 2.4);
      c.rot = rand(0, TAU); c.vr = rand(-14, 14);
      c.kind = (Math.random() * 3) | 0;
      c.life = c.t = rand(0.5, 1.05);
    }
    for (let i = 0; i < 3; i++) {
      const p = this._take(this.puffs);
      p.x = x + rand(-5, 5); p.y = y + rand(-5, 5);
      p.vx = rand(-14, 14); p.vy = rand(-16, -3);
      p.r = rand(2.5, 5); p.gr = rand(9, 17);
      p.life = p.t = rand(0.55, 1.0);
    }
    const r = this._take(this.rings);
    r.x = x; r.y = y; r.r = 1.5; r.vr = 130; r.w = 1.5;
    r.life = r.t = 0.26;
    // a couple of bright sparks where steel meets shell
    for (let i = 0; i < 2; i++) {
      const s = this._take(this.sparks);
      const a = rand(0, TAU);
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * rand(40, 110); s.vy = Math.sin(a) * rand(40, 110);
      s.r = rand(0.6, 1.3);
      s.life = s.t = rand(0.1, 0.24);
    }
  },

  // The payoff. Overshoot everything: this is the moment the shell comes free.
  pryPop(x, y) {
    this.init();
    this.recoil = 1.4;
    this.kick(2.6, 0.3);

    for (let i = 0; i < 16; i++) {
      const c = this._take(this.chips);
      const a = (i / 16) * TAU + rand(-0.2, 0.2);
      const sp = rand(90, 230);
      c.x = x; c.y = y;
      c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp - 30;
      c.r = rand(1, 2.8);
      c.rot = rand(0, TAU); c.vr = rand(-20, 20);
      c.kind = (Math.random() * 3) | 0;
      c.life = c.t = rand(0.6, 1.3);
    }
    for (let i = 0; i < 3; i++) {
      const r = this._take(this.rings);
      r.x = x; r.y = y; r.r = 2 + i * 5; r.vr = 190 - i * 40; r.w = 2.2 - i * 0.5;
      r.life = r.t = 0.42 + i * 0.1;
    }
    for (let i = 0; i < 10; i++) {
      const p = this._take(this.puffs);
      const a = rand(0, TAU);
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * rand(12, 50); p.vy = Math.sin(a) * rand(12, 50) - 12;
      p.r = rand(3, 7); p.gr = rand(14, 26);
      p.life = p.t = rand(0.7, 1.3);
    }
    for (let i = 0; i < 14; i++) {
      const s = this._take(this.sparks);
      const a = rand(0, TAU);
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * rand(60, 200); s.vy = Math.sin(a) * rand(60, 200);
      s.r = rand(0.7, 1.6);
      s.life = s.t = rand(0.16, 0.4);
    }
  },

  // ---- the reef -----------------------------------------------------------------------
  // Deterministic from the seed, so the same piling looks the same every dive but
  // two pilings never look alike. Plants are bucketed by depth so drawing only
  // walks the ones near the camera.
  seedReef(seed, depth) {
    this.init();
    if (this.reefSeed === seed && this.reef) return;
    this.reefSeed = seed;
    const rng = mulberry32(1000 + seed * 977);
    const plants = [];
    const span = Math.max(2600, depth || 2600);
    for (let y = 40; y < span; y += 34 + rng() * 60) {
      const n = 1 + ((rng() * 2.4) | 0);
      for (let i = 0; i < n; i++) {
        const art = 'coral_' + ((rng() * 20) | 0);
        // seaweed sways; hard coral barely moves. Index tells them apart well
        // enough for feel, and stiffness is what the sway actually reads off.
        const soft = rng() < 0.45;
        const front = rng() < 0.42;
        plants.push({
          art,
          x: rng() < 0.5 ? rand(6, 108) : rand(W - 118, W - 8),
          y: y + rng() * 26,
          h: (front ? 26 : 15) + rng() * (front ? 22 : 14),
          front,
          stiff: soft ? 0.15 + rng() * 0.2 : 0.72 + rng() * 0.24,
          ph: rng() * TAU,
          flip: rng() < 0.5,
          dim: front ? 1 : 0.62 + rng() * 0.2,
        });
      }
    }
    plants.sort((a, b) => a.y - b.y);
    this.reef = plants;
  },

  // back = behind the piling (parallaxed, dimmer, smaller); front = in front
  drawReef(ctx, camY, front) {
    if (!this.reef) return;
    const t = this.time;
    // front plants sit closer to the camera, so they scroll faster than the wall
    const par = front ? 1.16 : 0.82;
    for (let i = 0; i < this.reef.length; i++) {
      const p = this.reef[i];
      if (!!p.front !== !!front) continue;
      const sy = p.y - camY * par;
      if (sy < -50 || sy > H + 50) continue;
      const img = ASSETS[p.art];
      if (!img || !img.width) continue;

      const sway = Math.sin(t * (1.5 - p.stiff) + p.ph) * (1 - p.stiff) * 0.32
                 + this.surge(t, p.y) * 0.02 * (1 - p.stiff);
      const h = p.h, w = h * img.width / img.height;
      ctx.save();
      ctx.translate(p.x, sy);
      ctx.globalAlpha = p.dim;
      // pivot at the base: a plant bends from where it is rooted
      ctx.translate(0, h / 2);
      ctx.rotate(sway);
      ctx.translate(0, -h / 2);
      if (p.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  },

  // ---- water ---------------------------------------------------------------------------
  drawWater(ctx, camY, t) {
    this.init();
    // drifting motes: one fillStyle, alpha per particle
    ctx.fillStyle = '#dff2ff';
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      ctx.globalAlpha = 0.10 + 0.22 * (0.5 + 0.5 * Math.sin(t * m.sp * 2 + m.ph));
      ctx.fillRect(m.x, m.y, m.r, m.r);
    }
    ctx.globalAlpha = 1;

    // No coded god rays here: the bg_rays frames already paint them, and four
    // full-height polygon fills on top cost ~13ms a frame at this density — it
    // dropped the dive from 60 to 33fps, which is exactly the kind of slowdown
    // that makes the timed pry unplayable.
  },

  // chips, dust, rings and sparks. Drawn after the nodes so debris sits in front.
  drawDebris(ctx) {
    this.init();

    // dust puffs first: they are the softest and belong behind the hard bits
    ctx.fillStyle = '#b9a68c';
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (p.t <= 0) continue;
      const k = p.t / p.life;
      ctx.globalAlpha = k * 0.34;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (1 - k) * p.gr, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // shockwave rings
    ctx.strokeStyle = '#e8fbff';
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.t <= 0) continue;
      const k = r.t / r.life;
      ctx.globalAlpha = k * 0.6;
      ctx.lineWidth = r.w * k;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // crust chips: three shell-ish tones, batched per tone so fillStyle is set
    // three times a frame instead of once per chip
    const TONE = ['#cbb79a', '#9c8468', '#e6dcc4'];
    for (let tone = 0; tone < 3; tone++) {
      ctx.fillStyle = TONE[tone];
      for (let i = 0; i < this.chips.length; i++) {
        const c = this.chips[i];
        if (c.t <= 0 || c.kind !== tone) continue;
        ctx.globalAlpha = Math.min(1, c.t / c.life * 1.6);
        // a rotated chip, drawn as a short bar: cheaper than save/rotate/restore
        const co = Math.cos(c.rot) * c.r, si = Math.sin(c.rot) * c.r;
        ctx.fillRect(c.x - co, c.y - si, Math.max(1, c.r * 1.7), Math.max(1, c.r));
      }
    }
    ctx.globalAlpha = 1;

    // sparks last, brightest
    ctx.fillStyle = '#fff6d0';
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      if (s.t <= 0) continue;
      ctx.globalAlpha = Math.min(1, s.t / s.life);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  },
};
