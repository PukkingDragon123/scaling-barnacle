// ---- coded pixel-art sky & sea: bands, sun, clouds, waves, wind -------------
// Everything here is drawn in logical units with flat colour bands and dithered
// seams so it reads as hand-placed pixels rather than a smooth gradient.
'use strict';

const SKY = {
  HORIZON: 118,        // where sky meets sea
  clouds: null,
  gusts: [],
  glints: [],
  birds: [],
  _cv: null, _ctx: null, _key: -1,

  // ---- palette keyed to the day cycle -----------------------------------------
  // [skyTop, skyMid, skyLow, seaFar, seaMid, seaNear, sunCol, hazeCol]
  KEYS: [
    { t: 0.00, c: ['#0a0f2c', '#141c44', '#22305c', '#0c1836', '#0a1430', '#080f26', '#cfd8f2', '#1a2450'] },
    { t: 0.09, c: ['#22214e', '#5a3268', '#b4566a', '#4a2c50', '#33203e', '#221630', '#ffb27a', '#7a3a5a'] },
    { t: 0.17, c: ['#1f4e8c', '#3f86c2', '#8ac6e2', '#3aa0bc', '#2385a8', '#166a92', '#fff0c0', '#7fb8d4'] },
    { t: 0.46, c: ['#12539e', '#2f8ccb', '#7cc4e6', '#33a8c8', '#1d8cb2', '#12719c', '#fff6d2', '#8ecbe4'] },
    { t: 0.60, c: ['#1a3f7e', '#4a6ea8', '#c8895e', '#3a7a94', '#2a5c78', '#1c4460', '#ffd28a', '#a06a58'] },
    { t: 0.70, c: ['#2a2350', '#6a3a58', '#c4614c', '#3a2c4e', '#281f3a', '#181228', '#ff9a5a', '#7a3c48'] },
    { t: 0.80, c: ['#0a0f2c', '#141c44', '#22305c', '#0c1836', '#0a1430', '#080f26', '#cfd8f2', '#1a2450'] },
    { t: 1.00, c: ['#0a0f2c', '#141c44', '#22305c', '#0c1836', '#0a1430', '#080f26', '#cfd8f2', '#1a2450'] },
  ],

  pal(clock) {
    let a = this.KEYS[0], b = this.KEYS[this.KEYS.length - 1];
    for (let i = 0; i < this.KEYS.length - 1; i++) {
      if (clock >= this.KEYS[i].t && clock <= this.KEYS[i + 1].t) { a = this.KEYS[i]; b = this.KEYS[i + 1]; break; }
    }
    const f = (clock - a.t) / Math.max(0.0001, b.t - a.t);
    const sat = (c) => {
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      return c.map(v => Math.round(clamp(lum + (v - lum) * 1.26, 0, 255)));
    };
    return a.c.map((hex, i) => sat(rgbLerp(hexRGB(hex), hexRGB(b.c[i]), f)));
  },

  init() {
    if (this.clouds) return;
    const rng = mulberry32(4242);
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const puffs = [];
      const n = 3 + Math.floor(rng() * 4);
      let px2 = 0;
      for (let p = 0; p < n; p++) {
        const r = 4 + rng() * 7;
        puffs.push({ dx: px2, dy: (rng() - 0.5) * 3, r });
        px2 += r * (0.8 + rng() * 0.5);
      }
      this.clouds.push({
        x: rng() * 620, y: 8 + rng() * 74, puffs, w: px2,
        speed: 1.6 + rng() * 3.4, scale: 0.55 + rng() * 0.85, layer: rng() < 0.4 ? 0 : 1,
      });
    }
    this.glints = [];
    for (let i = 0; i < 30; i++)
      this.glints.push({ x: rng() * W, row: Math.floor(rng() * 11), ph: rng() * TAU, sp: 0.6 + rng() * 1.4 });
    this.birds = [];
  },

  update(dt, time) {
    this.init();
    // wind gusts: little dashes that streak across the sky
    if (Math.random() < dt * 1.1) {
      this.gusts.push({ x: -20, y: 14 + rand(0, 90), v: rand(60, 130), len: rand(7, 20), t: 1 });
    }
    for (const g of this.gusts) { g.x += g.v * dt; g.t -= dt * 0.5; }
    this.gusts = this.gusts.filter(g => g.t > 0 && g.x < W + 60);
    // distant birds, occasionally, drawn as 3-pixel chevrons
    if (Math.random() < dt / 14) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = irand(3, 5), members = [];
      for (let i = 0; i < n; i++) members.push({ ox: -i * 7 - rand(0, 3), oy: rand(-5, 5), ph: rand(TAU) });
      this.birds.push({ x: dir > 0 ? -40 : W + 40, y: rand(16, 56), dir, v: rand(12, 22), members });
    }
    for (const b of this.birds) b.x += b.dir * b.v * dt;
    this.birds = this.birds.filter(b => b.x > -60 && b.x < W + 60);
  },

  // ---- the sky, cached per palette step ---------------------------------------
  skyCanvas(clock) {
    const key = Math.round(clock * 200);
    if (this._key === key && this._cv) return this._cv;
    if (!this._cv) {
      this._cv = document.createElement('canvas');
      this._cv.width = W * DPX; this._cv.height = this.HORIZON * DPX;
      this._ctx = this._cv.getContext('2d');
      this._ctx.scale(DPX, DPX);
    }
    const c = this._ctx;
    const [top, mid, low] = this.pal(clock);
    const HZ = this.HORIZON;
    // three-stop banded sky with dithered seams
    bandedFill(c, 0, 0, W, HZ * 0.55, top, mid, 7);
    bandedFill(c, 0, HZ * 0.55, W, HZ * 0.45, mid, low, 6);
    this._key = key;
    return this._cv;
  },

  drawSky(ctx, clock, time, cam) {
    this.init();   // draw can run before the first update (scene fade)
    const HZ = this.HORIZON;
    const [top, mid, low, seaFar, seaMid, seaNear, sunCol, haze] = this.pal(clock);
    const nite = nightness(clock);
    ctx.drawImage(this.skyCanvas(clock), 0, 0, W, HZ);

    // ---- stars ----
    if (nite > 0.15) {
      const rng = mulberry32(99);
      for (let i = 0; i < 80; i++) {
        const sx = rng() * W, sy = rng() * (HZ - 12), ph = rng() * TAU;
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + ph));
        ctx.fillStyle = `rgba(236,242,255,${nite * tw * 0.85})`;
        ctx.fillRect(Math.round(sx), Math.round(sy), rng() < 0.18 ? 1 : PIX, rng() < 0.18 ? 1 : PIX);
      }
    }

    // ---- sun / moon on an arc, with pixel rays ----
    const isDay = clock > 0.09 && clock < 0.72;
    const tt = isDay ? (clock - 0.09) / 0.63
      : clamp((clock >= 0.72 ? clock - 0.72 : clock + 0.28) / 0.37, 0, 1);
    const bx = 40 + tt * (W - 80);
    const by = HZ - 14 - Math.sin(tt * Math.PI) * (HZ - 46);
    const R = isDay ? 11 : 8;
    // glow discs
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = `rgba(${sunCol.join(',')},${0.05 * i})`;
      ctx.beginPath(); ctx.arc(bx, by, R + i * 6, 0, TAU); ctx.fill();
    }
    if (isDay) {
      // rotating pixel rays
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(time * 0.12);
      ctx.fillStyle = `rgba(${sunCol.join(',')},0.20)`;
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const len = 20 + Math.sin(time * 1.6 + i) * 5;
        ctx.beginPath();
        ctx.moveTo(-1.6, -R - 2); ctx.lineTo(1.6, -R - 2); ctx.lineTo(0, -R - len);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = cssRGB(sunCol);
    ctx.beginPath(); ctx.arc(bx, by, R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(bx - R * 0.3, by - R * 0.3, R * 0.45, 0, TAU); ctx.fill();
    if (!isDay) {   // moon bite
      ctx.fillStyle = cssRGB(mid);
      ctx.beginPath(); ctx.arc(bx + R * 0.45, by - R * 0.3, R * 0.85, 0, TAU); ctx.fill();
    }

    // ---- clouds: flat three-tone pixel puffs, wind-driven, two parallax layers ----
    const cloudLit = rgbLerp([252, 253, 255], rgbLerp(haze, [40, 48, 86], 0.35), nite * 0.7);
    const cloudBody = rgbLerp([226, 234, 246], rgbLerp(haze, [30, 38, 72], 0.4), nite * 0.7);
    const cloudDark = rgbLerp([186, 200, 222], rgbLerp(haze, [20, 26, 56], 0.45), nite * 0.7);
    for (const cl of this.clouds) {
      const par = cl.layer ? 0.35 : 0.16;
      const cx = ((cl.x + time * cl.speed - cam * par) % (W + 240)) - 120;
      const s = cl.scale;
      const puff = (col, dy, shrink) => {
        ctx.fillStyle = cssRGB(col);
        for (const p of cl.puffs) {
          ctx.beginPath();
          ctx.arc(cx + p.dx * s, cl.y + p.dy * s + dy, Math.max(0.5, p.r * s - shrink), 0, TAU);
          ctx.fill();
        }
        // flat bottom joins the puffs into one cloud
        const y0 = cl.y + dy;
        ctx.fillRect(cx, y0, cl.w * s, Math.max(1, 3 * s - shrink * 0.5));
      };
      puff(cloudDark, 1.6 * s, 0);
      puff(cloudBody, 0, 0.8 * s);
      puff(cloudLit, -1.4 * s, 2.2 * s);
    }

    // ---- distant birds ----
    for (const b of this.birds) {
      ctx.fillStyle = `rgba(30,36,50,${0.55 - nite * 0.25})`;
      for (const m of b.members) {
        const fx = b.x + m.ox * b.dir, fy = b.y + m.oy + Math.sin(time * 2 + m.ph) * 1.5;
        const flap = Math.sin(time * 7 + m.ph) * 1.6;
        ctx.fillRect(fx, fy, 1, 1);
        ctx.fillRect(fx - 2, fy - flap, 2, PIX * 2);
        ctx.fillRect(fx + 1, fy - flap, 2, PIX * 2);
      }
    }

    // ---- wind gusts ----
    for (const g of this.gusts) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(g.t, 0, 1) * 0.22})`;
      ctx.fillRect(g.x, g.y, g.len, PIX);
      ctx.fillRect(g.x + g.len * 0.25, g.y + 2, g.len * 0.5, PIX);
    }

    // ---- haze band right above the horizon ----
    ctx.fillStyle = `rgba(${haze.join(',')},0.5)`;
    ctx.fillRect(0, HZ - 7, W, 7);
    ctx.fillStyle = `rgba(${rgbLerp(haze, [255, 255, 255], 0.4).join(',')},0.4)`;
    ctx.fillRect(0, HZ - 3, W, 2);
  },

  // ---- the sea: banded rows with animated pixel wave caps ---------------------
  drawSea(ctx, clock, time, cam) {
    this.init();
    const HZ = this.HORIZON;
    const [, , , seaFar, seaMid, seaNear, sunCol] = this.pal(clock);
    const nite = nightness(clock);
    const rows = 13;
    const rh = (H - HZ) / rows;
    for (let r = 0; r < rows; r++) {
      const f = r / (rows - 1);
      const col = f < 0.5 ? rgbLerp(seaFar, seaMid, f * 2) : rgbLerp(seaMid, seaNear, (f - 0.5) * 2);
      const y = HZ + r * rh;
      ctx.fillStyle = cssRGB(col);
      ctx.fillRect(0, y, W, rh + 0.8);
      // dithered seam into the row above
      if (r > 0) {
        ctx.fillStyle = cssRGB(rgbLerp(col, [255, 255, 255], 0.05));
        for (let x = (r % 2) * 2; x < W; x += 4) ctx.fillRect(x, y, 1, PIX);
      }
      // wave caps: dashes that drift, faster and longer as they come nearer
      const amp = 0.6 + f * 2.2;
      const speed = 5 + f * 26;
      const dash = 4 + f * 9;
      const gap = 26 + f * 22;
      const off = (time * speed - cam * (0.05 + f * 0.5)) % gap;
      ctx.fillStyle = `rgba(255,255,255,${(0.07 + f * 0.16) * (1 - nite * 0.45)})`;
      for (let x = -gap; x < W + gap; x += gap) {
        const wx = x - off;
        const wy = y + rh * 0.4 + Math.sin((wx + r * 30) * 0.06 + time * (1 + f)) * amp;
        ctx.fillRect(wx, wy, dash, PIX * 2);
        if (f > 0.45) ctx.fillRect(wx + dash * 0.3, wy - 1.2, dash * 0.45, PIX);
      }
    }
    // sun glitter path down the water under the sun
    const isDay = clock > 0.09 && clock < 0.72;
    const tt = isDay ? (clock - 0.09) / 0.63
      : clamp((clock >= 0.72 ? clock - 0.72 : clock + 0.28) / 0.37, 0, 1);
    const sunX = 40 + tt * (W - 80);
    for (const g of this.glints) {
      const f = g.row / 12;
      const y = HZ + g.row * rh + rh * 0.45;
      const spread = 8 + f * 46;
      const gx = sunX + Math.sin(g.ph + time * g.sp) * spread;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.4 + g.ph));
      ctx.fillStyle = `rgba(${sunCol.join(',')},${tw * (0.5 - nite * 0.18)})`;
      ctx.fillRect(gx, y, 2 + f * 4, PIX * 2);
    }
  },
};
