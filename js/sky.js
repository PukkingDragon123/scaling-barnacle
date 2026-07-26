// ---- coded pixel-art sky & sea: bands, sun, clouds, waves, wind -------------
// Everything here is drawn in logical units with flat colour bands and dithered
// seams so it reads as hand-placed pixels rather than a smooth gradient.
'use strict';

const SKY = {
  HORIZON: 118,        // where sky meets sea (legacy coded sea)
  OCEAN_HZ: 175,       // the horizon line painted into the ocean background art
  clouds: null,
  gusts: [],
  glints: [],
  birds: [],
  _cv: null, _ctx: null, _key: -1,

  // ---- palette keyed to the day cycle -----------------------------------------
  // [skyTop, skyMid, skyLow, seaFar, seaMid, seaNear, sunCol, hazeCol]
  // [skyTop, skyMid, skyLow, seaFar, seaMid, seaNear, sunCol, cloudCol]
  KEYS: [
    { t: 0.00, c: ['#070a24', '#0d1338', '#161f4c', '#12325c', '#0d2748', '#091c36', '#c6d2f0', '#5a6a96'] },
    { t: 0.09, c: ['#1c1c48', '#4c2a60', '#a8506a', '#3a5c86', '#2c4670', '#1e3356', '#ffb27a', '#c08098'] },
    { t: 0.18, c: ['#1257b8', '#3a92d8', '#8fd4f2', '#63d2ea', '#41bfe2', '#2aa6d4', '#fffbe0', '#ffffff'] },
    { t: 0.46, c: ['#0d5ad2', '#2f9ae8', '#a2e4fa', '#79e2f4', '#54cfec', '#33b6e0', '#ffffff', '#ffffff'] },
    { t: 0.60, c: ['#1a4b96', '#5f7fc0', '#f0a468', '#6ec4d8', '#4aa2c2', '#2f7fa4', '#ffd28a', '#ffd8c0'] },
    { t: 0.70, c: ['#221e46', '#5c3560', '#c05a4e', '#3e5e78', '#2c4258', '#1c2c3c', '#ff9a5a', '#c47a70'] },
    { t: 0.80, c: ['#070a24', '#0d1338', '#161f4c', '#12325c', '#0d2748', '#091c36', '#c6d2f0', '#5a6a96'] },
    { t: 1.00, c: ['#070a24', '#0d1338', '#161f4c', '#12325c', '#0d2748', '#091c36', '#c6d2f0', '#5a6a96'] },
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

  BANK_W: 1400,        // the cloud bank scrolls in its own wide space

  init() {
    if (this.clouds) return;
    const rng = mulberry32(4242);
    // A cumulus BANK sitting on the horizon, like a real sea skyline: many
    // overlapping puff clusters along one baseline rather than floating blobs.
    this.clouds = [];
    let x = 0;
    while (x < this.BANK_W) {
      const cluster = [];
      const n = 4 + Math.floor(rng() * 6);
      const bigness = 0.5 + rng() * rng() * 1.5;      // mostly small, a few towers
      let cx = 0, top = 0;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const r = (4 + rng() * 8) * bigness * (0.5 + Math.sin(t * Math.PI) * 0.8);
        cluster.push({ dx: cx, dy: -r * (0.35 + rng() * 0.4), r });
        top = Math.max(top, r);
        cx += r * (0.55 + rng() * 0.35);
      }
      this.clouds.push({ x, w: cx, puffs: cluster, layer: rng() < 0.35 ? 0 : 1 });
      x += cx + rng() * 26;
    }
    // 4-point sparkles over sky and water
    this.sparks = [];
    for (let i = 0; i < 34; i++)
      this.sparks.push({ x: rng() * W, y: rng() * H, ph: rng() * TAU, sp: 0.5 + rng() * 1.6, big: rng() < 0.3 });
    this.glints = [];
    for (let i = 0; i < 26; i++)
      this.glints.push({ x: rng() * W, row: Math.floor(rng() * 11), ph: rng() * TAU, sp: 0.6 + rng() * 1.4 });
    this.birds = [];
  },

  // a 4-point pixel star, like the reference sparkles
  spark(ctx, x, y, s, col) {
    ctx.fillStyle = col;
    ctx.fillRect(x - s, y, s * 2, PIX * 2);
    ctx.fillRect(x, y - s, PIX * 2, s * 2);
    ctx.fillRect(x - s * 0.45, y - s * 0.45, PIX * 2, PIX * 2);
    ctx.fillRect(x + s * 0.3, y + s * 0.3, PIX * 2, PIX * 2);
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

  // ---- day-cycle tint over the painted ocean ---------------------------------
  // The background art is bright midday; these washes carry it through dawn,
  // dusk and night without dulling the colour.
  tint(ctx, clock, time) {
    this.init();
    const nite = nightness(clock);
    const HZ = this.OCEAN_HZ;      // the horizon painted into the background art
    const lit = 1 - nite;
    // gull flocks drifting over the water, and sparkles on the swell
    if (lit > 0.15) {
      for (const b of this.birds) {
        for (const m of b.members) {
          const bx = Math.round(b.x + m.ox * b.dir), by = Math.round(b.y + m.oy);
          const fl = Math.sin(time * 7 + m.ph) * 1.6;
          ctx.fillStyle = `rgba(56,66,92,${lit * 0.55})`;
          ctx.fillRect(bx, by, PIX * 2, PIX * 2);
          ctx.fillRect(bx - 2, by - fl * 0.5, 2, PIX * 2);
          ctx.fillRect(bx + 2, by + fl * 0.5, 2, PIX * 2);
        }
      }
      for (const s of this.sparks) {
        const tw = Math.sin(time * s.sp + s.ph);
        if (tw < 0.72) continue;
        this.spark(ctx, Math.round(s.x), Math.round(s.y * 0.62 + 26), s.big ? 2.5 : 1.6,
          `rgba(255,255,255,${lit * (tw - 0.72) / 0.28 * 0.7})`);
      }
    }
    // warm low sun at either end of the day
    const warm = clamp(1 - Math.abs(clock - 0.615) / 0.13, 0, 1)
               + clamp(1 - Math.abs(clock - 0.155) / 0.10, 0, 1);
    // no sun disc: the light is all in the sky and on the water. The wash is
    // baked per 5%-of-warm step — three full-screen gradients per frame at
    // device density is more than the budget allows.
    if (warm > 0.01) ctx.drawImage(this.warmCanvas(warm), 0, 0, W, H);
    if (nite > 0.01) {
      // night: deepen and cool, keeping the water readable
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${Math.round(lerp(255, 60, nite))},${Math.round(lerp(255, 78, nite))},${Math.round(lerp(255, 150, nite))},1)`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      // stars over the sky half — globalAlpha instead of a colour string each
      ctx.fillStyle = '#ecf2ff';
      const rng = mulberry32(99);
      for (let i = 0; i < 70; i++) {
        const sx = rng() * W, sy = rng() * (HZ - 10), ph = rng() * TAU;
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + ph));
        ctx.globalAlpha = nite * tw * 0.9;
        ctx.fillRect(Math.round(sx), Math.round(sy), rng() < 0.2 ? 1 : PIX, rng() < 0.2 ? 1 : PIX);
      }
      ctx.globalAlpha = 1;
      // no moon disc — just a cold sheen on the water so the night still reads
      const gm = ctx.createLinearGradient(0, HZ - 4, 0, HZ + 20);
      gm.addColorStop(0, 'rgba(190,214,255,0)');
      gm.addColorStop(0.35, `rgba(200,220,255,${nite * 0.13})`);
      gm.addColorStop(1, 'rgba(170,196,240,0)');
      ctx.fillStyle = gm;
      ctx.fillRect(0, HZ - 4, W, 24);
    }
    // a couple of wind streaks so the air feels alive
    for (const g of this.gusts) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(g.t, 0, 1) * 0.16})`;
      ctx.fillRect(g.x, g.y, g.len, PIX);
    }
  },

  // ---- the golden-hour wash, cached per warmth step --------------------------
  warmCanvas(warm) {
    const key = Math.round(clamp(warm, 0, 1) * 20);
    if (this._wKey === key && this._wCv) return this._wCv;
    if (!this._wCv) {
      this._wCv = document.createElement('canvas');
      this._wCv.width = W * DPX; this._wCv.height = H * DPX;
      this._wCtx = this._wCv.getContext('2d');
      this._wCtx.scale(DPX, DPX);
    }
    const c = this._wCtx, HZ = this.OCEAN_HZ, k = key / 20;
    c.clearRect(0, 0, W, H);
    // the sky as a sunset ramp — multiplying a blue sky only turns it green, so
    // this lays real colour over it and lets the clouds read through
    const gs = c.createLinearGradient(0, 0, 0, HZ + 2);
    gs.addColorStop(0, `rgba(74,84,166,${k * 0.46})`);
    gs.addColorStop(0.38, `rgba(196,104,132,${k * 0.50})`);
    gs.addColorStop(0.72, `rgba(255,132,84,${k * 0.58})`);
    gs.addColorStop(1, `rgba(255,190,110,${k * 0.66})`);
    c.fillStyle = gs;
    c.fillRect(0, 0, W, HZ + 2);
    // and the water under it
    const gw = c.createLinearGradient(0, HZ, 0, H);
    gw.addColorStop(0, `rgba(255,178,104,${k * 0.46})`);
    gw.addColorStop(0.5, `rgba(226,124,96,${k * 0.30})`);
    gw.addColorStop(1, `rgba(150,86,110,${k * 0.26})`);
    c.fillStyle = gw;
    c.fillRect(0, HZ, W, H - HZ);
    // a bright band of low light right along the waterline
    const gh = c.createLinearGradient(0, HZ - 8, 0, HZ + 26);
    gh.addColorStop(0, 'rgba(255,224,160,0)');
    gh.addColorStop(0.3, `rgba(255,232,178,${k * 0.34})`);
    gh.addColorStop(1, 'rgba(255,206,140,0)');
    c.fillStyle = gh;
    c.fillRect(0, HZ - 8, W, 34);
    this._wKey = key;
    return this._wCv;
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
    const [top, mid, low, seaFar, seaMid, seaNear, sunCol, cloudC] = this.pal(clock);
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
      // long straight god-rays fanning UP from the sun, as in the reference
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, HZ); ctx.clip();
      ctx.translate(bx, by);
      for (let i = 0; i < 13; i++) {
        const a = -Math.PI / 2 + (i - 6) * 0.20 + Math.sin(time * 0.25 + i) * 0.012;
        const wide = (0.030 + (i % 3) * 0.014);
        ctx.fillStyle = `rgba(${sunCol.join(',')},${0.13 - Math.abs(i - 6) * 0.008})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a - wide) * 300, Math.sin(a - wide) * 300);
        ctx.lineTo(Math.cos(a + wide) * 300, Math.sin(a + wide) * 300);
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

    // ---- the cloud bank on the horizon --------------------------------------------
    const cLit = rgbLerp([255, 255, 255], cloudC, 0.10);
    const cBody = rgbLerp(cloudC, [206, 226, 244], 0.55);
    const cDark = rgbLerp(cloudC, [150, 182, 214], 0.75);
    for (const cl of this.clouds) {
      const par = cl.layer ? 0.30 : 0.13;
      const baseY = HZ - (cl.layer ? 3 : 9);
      const drift = time * (cl.layer ? 2.6 : 1.3) + cam * par;
      const cx = ((cl.x - drift) % this.BANK_W + this.BANK_W) % this.BANK_W - 90;
      if (cx > W + 90) continue;
      const puff = (col, dy, shrink) => {
        ctx.fillStyle = cssRGB(col);
        for (const p of cl.puffs) {
          const r = p.r - shrink;
          if (r <= 0.4) continue;
          ctx.beginPath(); ctx.arc(cx + p.dx, baseY + p.dy + dy, r, 0, TAU); ctx.fill();
        }
        ctx.fillRect(cx - 1, baseY + dy - 1, cl.w + 2, Math.max(1, 3 - shrink * 0.4));
      };
      puff(cDark, 1.4, 0);
      puff(cBody, 0, 1.1);
      puff(cLit, -1.6, 2.8);
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

    // ---- bright horizon line, like the reference ----
    ctx.fillStyle = `rgba(255,255,255,${0.62 - nite * 0.4})`;
    ctx.fillRect(0, HZ - 2, W, 1.4);
    ctx.fillStyle = `rgba(${rgbLerp(seaFar, [255, 255, 255], 0.55).join(',')},0.85)`;
    ctx.fillRect(0, HZ - 0.6, W, 1.6);
    // sparkles in the sky half
    for (const s of this.sparks) {
      if (s.y > HZ - 6) continue;
      const tw = Math.sin(time * s.sp + s.ph);
      if (tw < 0.4) continue;
      this.spark(ctx, s.x, s.y, (s.big ? 3.2 : 2) * tw, `rgba(255,255,255,${tw * 0.8})`);
    }
  },

  // ---- the sea: reflection band, caustic net, wave crests, glitter ------------
  drawSea(ctx, clock, time, cam) {
    this.init();
    const HZ = this.HORIZON;
    const [, , , seaFar, seaMid, seaNear, sunCol, cloudC] = this.pal(clock);
    const nite = nightness(clock);
    const SH = H - HZ;

    // base water: a few wide bands, near water lightest (shallow lagoon look)
    const rows = 9, rh = SH / rows;
    for (let r = 0; r < rows; r++) {
      const f = r / (rows - 1);
      const col = f < 0.5 ? rgbLerp(seaFar, seaMid, f * 2) : rgbLerp(seaMid, seaNear, (f - 0.5) * 2);
      const y = HZ + r * rh;
      ctx.fillStyle = cssRGB(col);
      ctx.fillRect(0, y, W, rh + 0.8);
      if (r > 0) {   // dithered seam
        ctx.fillStyle = cssRGB(rgbLerp(col, [255, 255, 255], 0.07));
        for (let x = (r % 2) * 2; x < W; x += 4) ctx.fillRect(x, y, 1, PIX);
      }
    }

    // mirrored cloud bank reflected just under the horizon
    ctx.save();
    ctx.beginPath(); ctx.rect(0, HZ, W, SH * 0.30); ctx.clip();
    ctx.globalAlpha = 0.16 - nite * 0.09;
    const refl = rgbLerp(cloudC, seaFar, 0.35);
    for (const cl of this.clouds) {
      const par = cl.layer ? 0.30 : 0.13;
      const drift = time * (cl.layer ? 2.6 : 1.3) + cam * par;
      const cx = ((cl.x - drift) % this.BANK_W + this.BANK_W) % this.BANK_W - 90;
      if (cx > W + 90) continue;
      ctx.fillStyle = cssRGB(refl);
      for (const p of cl.puffs) {
        const ry = HZ + (-p.dy) * 0.75 + 2 + Math.sin(time * 1.4 + cl.x * 0.05) * 0.6;
        ctx.beginPath(); ctx.ellipse(cx + p.dx, ry, p.r * 0.85, p.r * 0.42, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();

    // ---- caustic net: warped mesh of bright cells, cells grow toward the viewer
    ctx.save();
    ctx.beginPath(); ctx.rect(0, HZ + SH * 0.14, W, SH); ctx.clip();
    const bands = 11;
    for (let b = 0; b < bands; b++) {
      const f = 0.14 + (b / bands) * 0.86;             // 0 at horizon, 1 at bottom
      const y = HZ + SH * f;
      const cell = 12 + f * 46;                        // perspective: bigger nearer
      const amp = 1.2 + f * 5.5;
      const scroll = (time * (3 + f * 16) + cam * (0.05 + f * 0.35));
      const alpha = (0.30 + f * 0.46) * (1 - nite * 0.6);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = Math.max(PIX * 2, 0.7 + f * 1.5);
      // horizontal strand of the mesh
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 5) {
        const yy = y + Math.sin((x + scroll) * 0.055 + b * 1.7) * amp
                     + Math.sin((x - scroll * 0.6) * 0.021 + b) * amp * 0.5;
        if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
      // vertical strands close the mesh into cells
      ctx.lineWidth = Math.max(PIX * 2, 0.6 + f * 1.1);
      for (let x = -cell; x < W + cell; x += cell) {
        const px2 = x - (scroll % cell);
        const y0 = y, y1 = HZ + SH * Math.min(1, f + 0.86 / bands);
        ctx.beginPath();
        for (let yy = y0; yy <= y1; yy += 4) {
          const g = (yy - y0) / Math.max(1, y1 - y0);
          const xx = px2 + Math.sin((yy + scroll * 0.4) * 0.08 + b * 2.3) * amp * 0.9 + g * amp * 0.6;
          if (yy === y0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // ---- long white wave crests rolling across, a couple per screen ----
    for (let i = 0; i < 3; i++) {
      const f = 0.30 + i * 0.24;
      const y = HZ + SH * f;
      const speed = 8 + f * 22;
      const period = 340 - i * 60;
      const cx = ((time * speed + i * 150 - cam * (0.1 + f * 0.4)) % (W + period)) - period * 0.5;
      const len = 60 + f * 90;
      ctx.fillStyle = `rgba(255,255,255,${(0.5 - nite * 0.3)})`;
      for (let x = 0; x < len; x += 4) {
        const t = x / len;
        const th = Math.sin(t * Math.PI) * (1.4 + f * 1.6);
        if (th < 0.4) continue;
        ctx.fillRect(cx + x, y + Math.sin((x + time * 40) * 0.06) * (1 + f * 1.5), 4.2, th);
      }
    }

    // ---- sun glitter path + water sparkles ----
    const isDay = clock > 0.09 && clock < 0.72;
    const tt = isDay ? (clock - 0.09) / 0.63
      : clamp((clock >= 0.72 ? clock - 0.72 : clock + 0.28) / 0.37, 0, 1);
    const sunX = 40 + tt * (W - 80);
    for (const g of this.glints) {
      const f = 0.1 + (g.row / 11) * 0.9;
      const y = HZ + SH * f;
      const spread = 10 + f * 60;
      const gx = sunX + Math.sin(g.ph + time * g.sp) * spread;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.4 + g.ph));
      ctx.fillStyle = `rgba(${sunCol.join(',')},${tw * (0.55 - nite * 0.25)})`;
      ctx.fillRect(gx, y, 3 + f * 6, PIX * 2);
    }
    for (const s of this.sparks) {
      if (s.y < HZ + 4) continue;
      const tw = Math.sin(time * s.sp + s.ph);
      if (tw < 0.55) continue;
      this.spark(ctx, s.x, s.y, (s.big ? 3.4 : 2.2) * tw, `rgba(255,255,255,${tw * 0.85})`);
    }
  },
};
