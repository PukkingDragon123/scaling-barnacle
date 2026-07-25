// ---- surface world: Otto's house, the bridge, the sea ------------------------
'use strict';

// [skyTop, skyHorizon, waterTop, waterDeep]
const SKY_KEYS = [
  { t: 0.00, c: ['#0a1026', '#141c3a', '#0c2030', '#061018'] },
  { t: 0.10, c: ['#3a2c4e', '#c9705e', '#3a5a6e', '#12303e'] },
  { t: 0.30, c: ['#3a8ec4', '#a8dce8', '#2a7a9e', '#0e3a50'] },
  { t: 0.52, c: ['#3a8ec4', '#a8dce8', '#2a7a9e', '#0e3a50'] },
  { t: 0.64, c: ['#4e3060', '#e88a4e', '#3a5a72', '#102838'] },
  { t: 0.74, c: ['#0a1026', '#141c3a', '#0c2030', '#061018'] },
  { t: 1.00, c: ['#0a1026', '#141c3a', '#0c2030', '#061018'] },
];

function skyRGBs(clock) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (clock >= SKY_KEYS[i].t && clock <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const f = (clock - a.t) / span;
  return a.c.map((hex, i) => rgbLerp(hexRGB(hex), hexRGB(b.c[i]), f));
}

function skyColors(clock) { return skyRGBs(clock).map(cssRGB); }

function nightness(clock) {
  if (clock > 0.74 || clock < 0.02) return 1;
  if (clock >= 0.62 && clock <= 0.74) return (clock - 0.62) / 0.12;
  if (clock >= 0.02 && clock <= 0.14) return 1 - (clock - 0.02) / 0.12;
  return 0;
}

const PILING_X = [460, 640, 820];
const DECK_Y = 176;
const HORIZON = 148;
const LANTERN_X = [226, 350, 545, 728];

const WorldScene = {
  customCursor: false,
  px: 160, dir: 1, walkT: 0, idleT: 0,
  camX: 0, time: 0,
  gulls: [], smoke: [], stars: null, clouds: null,
  crab: { x: 260, dir: 1, t: 0 },
  perchedGull: { there: true, x: 375 },
  fishJumpT: 9, fishJump: null,
  sprayT: 2,
  spray: [],
  _atmo: { key: -1, cv: null },

  worldW() { return this.endX() + 80; },
  endX() { return 300 + G.bridge * 200; },

  enter(opts) {
    this.time = 0;
    if (opts && opts.at !== undefined) this.px = PILING_X[opts.at];
    else if (opts && opts.fromHouse) this.px = 205;
    if (!this.stars) {
      const rng = mulberry32(777);
      this.stars = [];
      for (let i = 0; i < 70; i++) this.stars.push({ x: rng() * W, y: rng() * HORIZON * 0.9, p: rng() * TAU, big: rng() < 0.2 });
      this.clouds = [];
      for (let i = 0; i < 4; i++)
        this.clouds.push({ img: SPR.clouds[i % SPR.clouds.length], x: rng() * W, y: 16 + rng() * 62, v: 2 + rng() * 4, a: 0.55 + rng() * 0.4 });
    }
    SND.setScene('surface');
    if (!G.flags.seenWorld) {
      G.flags.seenWorld = true;
      Game.toast(TouchUI.enabled
        ? 'Welcome home, Otto!  Arrows: walk  •  Paw button: interact'
        : 'Welcome home, Otto!  A/D or arrows: walk  •  [E]: interact');
      Game.toast('Walk right along the bridge and dive at a piling.');
    }
  },

  spots() {
    const s = [
      { x: 191, label: 'Enter House', act: () => Game.go(HouseScene, {}) },
      { x: 252, label: 'ClamNet  (sell & shop)', act: () => { Shop.openUI(); } },
      { x: 315, label: 'Workbench  (crack & polish)', act: () => { Bench.openUI(); } },
    ];
    for (let i = 0; i < G.bridge; i++) {
      s.push({
        x: PILING_X[i],
        label: `Dive — ${PILINGS[i].name}  (${Math.round(clamp(G.growth[i], 0, 1) * 100)}% grown)`,
        act: () => Game.go(DiveScene, i),
      });
    }
    return s;
  },

  update(dt) {
    this.time += dt;
    // walking
    let mv = 0;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    if (mv !== 0) {
      this.dir = mv;
      this.px = clamp(this.px + mv * 92 * dt, 56, this.endX() - 10);
      this.walkT += dt * 9;
      this.idleT = 0;
    } else {
      this.idleT += dt;
    }
    this.camX = clamp(this.px - W / 2, 0, this.worldW() - W);

    // interact
    if (Input.p('KeyE') || Input.p('Space')) {
      let best = null, bd = 20;
      for (const s of this.spots()) {
        const d = Math.abs(this.px - s.x);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { SND.click(); best.act(); return; }
    }

    // chimney smoke
    if (Math.random() < dt * 2.2) {
      this.smoke.push({ x: 102 + rand(-1, 1), y: this.houseTop() - 8, vy: rand(-14, -8), t: rand(1.5, 3), s: rand(1.5, 3) });
    }
    for (const s of this.smoke) { s.y += s.vy * dt; s.x += Math.sin(this.time + s.y * 0.1) * 0.2 + 3 * dt; s.t -= dt; }
    this.smoke = this.smoke.filter(s => s.t > 0);

    // gulls
    if (Math.random() < dt / 8) {
      const fromLeft = Math.random() < 0.5;
      this.gulls.push({ x: fromLeft ? -20 : W + 20, y: rand(20, 80), vx: fromLeft ? rand(20, 36) : -rand(20, 36), f: 0 });
      if (Math.random() < 0.6) SND.gull();
    }
    for (const g of this.gulls) { g.x += g.vx * dt; g.f += dt * 6; }
    this.gulls = this.gulls.filter(g => g.x > -30 && g.x < W + 30);

    // perched gull startles
    if (this.perchedGull.there && Math.abs(this.px - this.perchedGull.x) < 22) {
      this.perchedGull.there = false;
      this.gulls.push({ x: this.perchedGull.x - this.camX, y: DECK_Y - 20, vx: rand(24, 40) * (Math.random() < 0.5 ? -1 : 1), f: 0 });
      SND.gull();
      setTimeout(() => { this.perchedGull.there = true; this.perchedGull.x = pick([375, 420, 560]); }, 15000);
    }

    // crab
    const c = this.crab;
    c.t += dt * 6;
    c.x += c.dir * 8 * dt;
    if (c.x < 224 || c.x > 296) c.dir *= -1;

    // fish jump
    this.fishJumpT -= dt;
    if (this.fishJumpT <= 0) {
      this.fishJumpT = rand(8, 20);
      this.fishJump = { x: rand(this.camX + 40, this.camX + W - 40), t: 0 };
      if (Math.random() < 0.5) SND.splash();
    }
    if (this.fishJump) {
      this.fishJump.t += dt;
      if (this.fishJump.t > 1) this.fishJump = null;
    }

    // a pod of dolphins passing far out, now and then
    if (!this.dolphins && Math.random() < dt / 30) {
      this.dolphins = { x: -30, t: 0 };
    }
    if (this.dolphins) {
      this.dolphins.x += 34 * dt;
      this.dolphins.t += dt;
      if (this.dolphins.x > W + 60) this.dolphins = null;
    }

    // sea spray at stilts
    this.sprayT -= dt;
    if (this.sprayT <= 0) {
      this.sprayT = rand(0.6, 1.6);
      const sx = 60 + Math.floor(rand(0, (this.endX() - 60) / 60)) * 60 + 3;
      for (let i = 0; i < 3; i++)
        this.spray.push({ x: sx + rand(-3, 3), y: 200, vx: rand(-6, 6), vy: rand(-22, -10), t: rand(0.4, 0.8) });
    }
    for (const p of this.spray) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.t -= dt; }
    this.spray = this.spray.filter(p => p.t > 0);

    // drone hum only audible outside
    if (G.pendingCrate && G.pendingCrate.t < 10) SND.droneOn(); else SND.droneOff();
  },

  houseTop() { return G.house >= 3 ? 84 : (G.house === 2 ? 100 : 108); },

  // sky + sea rendered as dithered pixel bands, cached and rebuilt as the clock moves
  atmosphere() {
    const key = Math.round(G.clock * 240);
    if (this._atmo.key === key && this._atmo.cv) return this._atmo.cv;
    if (!this._atmo.cv) {
      this._atmo.cv = document.createElement('canvas');
      this._atmo.cv.width = W * DPX; this._atmo.cv.height = H * DPX;
      this._atmo.ctx = this._atmo.cv.getContext('2d');
      this._atmo.ctx.scale(DPX, DPX);
    }
    const c = this._atmo.ctx;
    const [top, hor, wtop, wdeep] = skyRGBs(G.clock);
    bandedFill(c, 0, 0, W, HORIZON, top, hor, 13);
    bandedFill(c, 0, HORIZON, W, H - HORIZON, wtop, wdeep, 10);
    // horizon shimmer line
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(0, HORIZON, W, PIX);
    this._atmo.key = key;
    return this._atmo.cv;
  },

  draw(ctx) {
    const cam = this.camX;
    const [skyTopC, skyHorC, waterTopC] = skyColors(G.clock);
    const wtopRGB = skyRGBs(G.clock)[2];
    const nite = nightness(G.clock);

    ctx.drawImage(this.atmosphere(), 0, 0, W, H);

    // stars
    if (nite > 0.2) {
      for (const st of this.stars) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 0.8 + st.p));
        ctx.fillStyle = `rgba(230,238,255,${nite * tw * 0.85})`;
        const s = st.big ? 1 : PIX;
        ctx.fillRect(Math.round(st.x), Math.round(st.y), s, s);
      }
    }

    // sun / moon
    if (G.clock > 0.06 && G.clock < 0.66) {
      const st = (G.clock - 0.06) / 0.6;
      const sx = 30 + st * (W - 60), sy = 130 - Math.sin(st * Math.PI) * 95;
      const low = st > 0.85 || st < 0.12;
      ctx.fillStyle = low ? 'rgba(245,170,90,0.2)' : 'rgba(255,240,200,0.18)';
      ctx.beginPath(); ctx.arc(sx, sy, 15, 0, TAU); ctx.fill();
      ctx.fillStyle = low ? '#f5b46e' : '#fff2c8';
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = low ? '#fdd9a8' : '#fffbe8';
      ctx.beginPath(); ctx.arc(sx - 2, sy - 2, 4.5, 0, TAU); ctx.fill();
    } else {
      const mtRaw = G.clock >= 0.66 ? (G.clock - 0.66) / 0.4 : (G.clock + 0.34) / 0.4;
      const mt = clamp(mtRaw, 0, 1);
      const mx = 30 + mt * (W - 60), my = 120 - Math.sin(mt * Math.PI) * 85;
      ctx.fillStyle = 'rgba(220,230,250,0.12)';
      ctx.beginPath(); ctx.arc(mx, my, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8ecf2';
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.fill();
      // craters
      ctx.fillStyle = '#c2cad8';
      ctx.fillRect(mx - 3, my - 2, 2, 2);
      ctx.fillRect(mx + 1, my + 2, 1.5, 1.5);
      ctx.fillRect(mx + 2, my - 4, 1, 1);
    }

    // clouds
    for (const cl of this.clouds) {
      const cx = ((cl.x + this.time * cl.v) % (W + 160)) - 80;
      ctx.globalAlpha = cl.a * (1 - nite * 0.65);
      drawSpr(ctx, cl.img, cx, cl.y);
      ctx.globalAlpha = 1;
    }

    // distant island with a tiny lighthouse
    const ix = W - 70 - cam * 0.1;
    ctx.fillStyle = `rgba(28,38,58,${0.55 - nite * 0.15})`;
    ctx.beginPath();
    ctx.moveTo(ix - 34, HORIZON);
    ctx.quadraticCurveTo(ix - 6, HORIZON - 15, ix + 26, HORIZON);
    ctx.fill();
    ctx.fillStyle = `rgba(40,52,74,${0.6 - nite * 0.15})`;
    ctx.fillRect(ix - 2, HORIZON - 17, 4, 10);
    ctx.fillRect(ix - 3.5, HORIZON - 19, 7, 2);
    if (nite > 0.3 && Math.sin(this.time * 2.2) > 0.3) {
      ctx.fillStyle = 'rgba(255,230,140,0.9)';
      ctx.fillRect(ix - 1, HORIZON - 18.5, 2, 1.5);
      ctx.fillStyle = 'rgba(255,230,140,0.12)';
      ctx.beginPath(); ctx.arc(ix, HORIZON - 18, 8, 0, TAU); ctx.fill();
    }

    // wave glints
    for (let row = 0; row < 10; row++) {
      const y = HORIZON + 4 + row * 12;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.11 - row * 0.007 - nite * 0.02)})`;
      for (let x = -20; x < W + 20; x += 26) {
        const ox = Math.sin(this.time * 1.4 + row * 1.7 + x * 0.08) * 8;
        ctx.fillRect(Math.round(x + ox - (cam * (0.2 + row * 0.05)) % 26), Math.round(y), 12, 1);
        if (Math.sin(this.time * 2.5 + x + row * 3) > 0.93) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(Math.round(x + ox + 4), Math.round(y - 1), 2, 1);
          ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.11 - row * 0.007 - nite * 0.02)})`;
        }
      }
    }
    // moon glint path
    if (nite > 0.5) {
      ctx.fillStyle = `rgba(220,230,245,${(nite - 0.5) * 0.25})`;
      for (let y = HORIZON + 4; y < H; y += 5)
        ctx.fillRect(W * 0.55 + Math.sin(y * 0.4 + this.time * 2) * 6, y, 22 + (y - HORIZON) * 0.3, 1);
    }

    // dolphin pod arcing along the horizon (screen space, far water)
    if (this.dolphins) {
      const d = this.dolphins;
      ctx.fillStyle = `rgba(40,60,84,${0.75 - nite * 0.3})`;
      for (let i = 0; i < 3; i++) {
        const px2 = d.x - i * 22;
        const ph = (d.t * 1.4 + i * 0.6) % TAU;
        const arc = Math.max(0, Math.sin(ph));
        if (arc < 0.05) continue;
        const py2 = 164 - arc * 9;
        ctx.save();
        ctx.translate(px2, py2);
        ctx.rotate(Math.cos(ph) * -0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 2.4, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-1, -1.5); ctx.lineTo(1.5, -4.5); ctx.lineTo(3.5, -1.5); ctx.closePath(); ctx.fill();
        ctx.restore();
        if (arc < 0.3) {
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(px2 - 4, 165, 8, 1);
          ctx.fillStyle = `rgba(40,60,84,${0.75 - nite * 0.3})`;
        }
      }
    }

    // fish jump
    if (this.fishJump) {
      const f = this.fishJump, ft = f.t;
      const fy = 215 - Math.sin(ft * Math.PI) * 26;
      ctx.save();
      ctx.translate(f.x - cam, fy);
      ctx.rotate(ft * Math.PI - Math.PI / 2);
      ctx.fillStyle = '#7a9eb4';
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a8c4d4';
      ctx.beginPath(); ctx.ellipse(0.5, -0.5, 3, 1, 0, 0, TAU); ctx.fill();
      ctx.restore();
      // entry/exit ripples
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = PIX * 2;
      const rr = ft < 0.5 ? ft * 8 : (1 - ft) * 12 + 4;
      ctx.beginPath(); ctx.ellipse(f.x - cam, 216, rr, rr * 0.3, 0, 0, TAU); ctx.stroke();
    }

    ctx.save();
    ctx.translate(-cam, 0);

    const endX = this.endX();

    // ---- stilts (behind deck) ---------------------------------------------------
    for (let x = 60; x < endX; x += 60) {
      ctx.fillStyle = '#2c2013';
      ctx.fillRect(x, DECK_Y + 6, 6, 80);
      ctx.fillStyle = '#413019';
      ctx.fillRect(x, DECK_Y + 6, 2, 80);
      // wet band + barnacle freckles at waterline
      ctx.fillStyle = '#1a130a';
      ctx.fillRect(x, 196, 6, 8);
      ctx.fillStyle = 'rgba(168,176,172,0.55)';
      ctx.fillRect(x + 1, 197 + Math.sin(this.time + x) * 1.5, 1.5, 1.5);
      ctx.fillRect(x + 3.5, 200 + Math.cos(this.time + x) * 1.5, 1.5, 1.5);
      // ripple ring
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = PIX * 2;
      const rp = (this.time * 0.7 + x * 0.13) % 1;
      ctx.beginPath(); ctx.ellipse(x + 3, 203, 4 + rp * 7, 1.2 + rp * 2, 0, 0, TAU); ctx.stroke();
    }

    // dive pilings (thick posts)
    for (let i = 0; i < G.bridge; i++) {
      const x = PILING_X[i];
      ctx.fillStyle = '#241a0e';
      ctx.fillRect(x - 8, DECK_Y + 6, 16, 90);
      ctx.fillStyle = '#3a2c18';
      ctx.fillRect(x - 8, DECK_Y + 6, 5, 90);
      ctx.fillStyle = '#171008';
      ctx.fillRect(x + 5, DECK_Y + 6, 3, 90);
      // rope wrap near top
      ctx.fillStyle = '#8a7040';
      ctx.fillRect(x - 8, DECK_Y + 9, 16, 1.5);
      ctx.fillRect(x - 8, DECK_Y + 11.5, 16, 1.5);
      // wet band
      ctx.fillStyle = '#120c06';
      ctx.fillRect(x - 8, 196, 16, 8);
      ctx.fillStyle = 'rgba(168,176,172,0.5)';
      ctx.fillRect(x - 5, 198, 2, 2);
      ctx.fillRect(x + 2, 200, 2, 2);
      // ladder
      ctx.strokeStyle = '#5a4526'; ctx.lineWidth = 1;
      for (let ly = DECK_Y + 10; ly < DECK_Y + 34; ly += 6) {
        ctx.beginPath(); ctx.moveTo(x + 10, ly); ctx.lineTo(x + 16, ly); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x + 10, DECK_Y + 6); ctx.lineTo(x + 10, DECK_Y + 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, DECK_Y + 6); ctx.lineTo(x + 16, DECK_Y + 36); ctx.stroke();
      // buoy
      const by = 206 + Math.sin(this.time * 1.6 + i * 2) * 2.5;
      ctx.fillStyle = '#8a2620';
      ctx.beginPath(); ctx.arc(x + 26, by, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c8352a';
      ctx.beginPath(); ctx.arc(x + 25, by - 1, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2ede2';
      ctx.fillRect(x + 22, by - 2, 9, 2);
      if (nite > 0.4 && Math.sin(this.time * 3 + i) > 0) {
        ctx.fillStyle = 'rgba(255,80,60,0.95)';
        ctx.fillRect(x + 25, by - 7, 2, 2);
        ctx.fillStyle = 'rgba(255,80,60,0.15)';
        ctx.beginPath(); ctx.arc(x + 26, by - 6, 5, 0, TAU); ctx.fill();
      }
    }

    // ---- railing with sagging ropes (behind player) ------------------------------
    for (let x = 52; x < endX; x += 40) {
      ctx.fillStyle = '#3c2d18';
      ctx.fillRect(x, DECK_Y - 14, 3, 15);
      ctx.fillStyle = '#553f20';
      ctx.fillRect(x, DECK_Y - 14, 1, 15);
      ctx.fillStyle = '#2a1e0e';
      ctx.fillRect(x, DECK_Y - 14, 3, 1);
    }
    ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1;
    for (let x = 52; x + 40 < endX + 40; x += 40) {
      const x2 = Math.min(x + 40, endX - 2);
      ctx.beginPath();
      ctx.moveTo(x + 1.5, DECK_Y - 12);
      ctx.quadraticCurveTo((x + x2) / 2, DECK_Y - 9.5, x2 + 1.5, DECK_Y - 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 1.5, DECK_Y - 6);
      ctx.quadraticCurveTo((x + x2) / 2, DECK_Y - 3.5, x2 + 1.5, DECK_Y - 6);
      ctx.stroke();
    }

    // lantern posts along the walk
    for (const lx of LANTERN_X) {
      if (lx > endX - 10) continue;
      ctx.fillStyle = '#2e2210';
      ctx.fillRect(lx, DECK_Y - 30, 2.5, 31);
      ctx.fillRect(lx, DECK_Y - 30, 8, 1.5);
      const sway = Math.sin(this.time * 1.3 + lx) * 0.8;
      const ly = DECK_Y - 28.5, lxx = lx + 7 + sway;
      ctx.strokeStyle = '#2e2210'; ctx.lineWidth = PIX * 2;
      ctx.beginPath(); ctx.moveTo(lx + 7, ly); ctx.lineTo(lxx, ly + 3); ctx.stroke();
      // lantern body
      ctx.fillStyle = '#1c140a';
      ctx.fillRect(lxx - 2.5, ly + 3, 5, 6.5);
      const lit = nite > 0.25;
      const flick = lit ? 0.85 + Math.sin(this.time * 9 + lx) * 0.15 : 0;
      ctx.fillStyle = lit ? `rgba(255,206,110,${flick})` : '#4a3c22';
      ctx.fillRect(lxx - 1.5, ly + 4, 3, 4.5);
      if (lit) {
        ctx.fillStyle = `rgba(255,200,110,${0.13 * flick})`;
        ctx.beginPath(); ctx.arc(lxx, ly + 6, 14, 0, TAU); ctx.fill();
      }
    }

    // ---- deck planks with hand-laid variation -------------------------------------
    const plankRng = mulberry32(4242);
    ctx.fillStyle = '#6b4f2c';
    ctx.fillRect(40, DECK_Y, endX - 40, 7);
    for (let x = 40, i = 0; x < endX; x += 13, i++) {
      const r = mulberry32(i * 97)();
      ctx.fillStyle = ['#6b4f2c', '#75572f', '#614727', '#6f5230'][Math.floor(r * 4)];
      ctx.fillRect(x, DECK_Y, 13, 7);
      ctx.fillStyle = '#4a3418';
      ctx.fillRect(x, DECK_Y, PIX * 2, 7);
      // nails
      ctx.fillStyle = '#3a2a12';
      ctx.fillRect(x + 3, DECK_Y + 1.5, PIX * 2, PIX * 2);
      ctx.fillRect(x + 9, DECK_Y + 4.5, PIX * 2, PIX * 2);
      // occasional knot or moss
      if (r > 0.82) {
        ctx.fillStyle = '#503a1a';
        ctx.beginPath(); ctx.arc(x + 6.5, DECK_Y + 3.5, 1.2, 0, TAU); ctx.fill();
      } else if (r < 0.1) {
        ctx.fillStyle = 'rgba(90,140,80,0.5)';
        ctx.fillRect(x + 4, DECK_Y + 5.5, 4, 1);
      }
    }
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(40, DECK_Y, endX - 40, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(40, DECK_Y + 6, endX - 40, 1);

    // end-of-bridge barrier
    if (G.bridge < 3) {
      ctx.fillStyle = '#8a6434';
      ctx.fillRect(endX - 4, DECK_Y - 22, 4, 22);
      ctx.fillStyle = '#c8a03c';
      ctx.fillRect(endX - 13, DECK_Y - 20, 22, 8);
      ctx.fillStyle = '#7a5c1c';
      for (let i = 0; i < 3; i++) ctx.fillRect(endX - 11 + i * 8, DECK_Y - 18, 4, 4);
    }

    // ---- house ---------------------------------------------------------------------
    this.drawHouse(ctx, nite);

    // props: barrel + rope coil + crab pot
    ctx.fillStyle = '#5f4322';
    ctx.fillRect(62, DECK_Y - 12, 11, 12);
    ctx.fillStyle = '#755428';
    ctx.fillRect(63, DECK_Y - 12, 3, 12);
    ctx.fillStyle = '#3a2c14';
    ctx.fillRect(62, DECK_Y - 10, 11, 1.5);
    ctx.fillRect(62, DECK_Y - 5, 11, 1.5);
    ctx.fillStyle = '#8a6a40';
    ctx.beginPath(); ctx.ellipse(67.5, DECK_Y - 12, 5.5, 1.5, 0, 0, TAU); ctx.fill();
    // rope coil
    ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(222, DECK_Y - 2, 5, 2, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(222, DECK_Y - 2, 2.5, 1, 0, 0, TAU); ctx.stroke();
    // crab pot cage
    ctx.strokeStyle = '#4a3c26'; ctx.lineWidth = PIX * 2;
    ctx.strokeRect(342, DECK_Y - 9, 12, 9);
    ctx.beginPath();
    ctx.moveTo(342, DECK_Y - 4.5); ctx.lineTo(354, DECK_Y - 4.5);
    ctx.moveTo(346, DECK_Y - 9); ctx.lineTo(346, DECK_Y);
    ctx.moveTo(350, DECK_Y - 9); ctx.lineTo(350, DECK_Y);
    ctx.stroke();

    // ---- workbench: vise, hammer, shell pile ---------------------------------------
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(300, DECK_Y - 13, 32, 3.5);
    ctx.fillStyle = '#5f4a2c';
    ctx.fillRect(300, DECK_Y - 13, 32, 1);
    ctx.fillStyle = '#3a2c16';
    ctx.fillRect(303, DECK_Y - 9.5, 3, 9.5);
    ctx.fillRect(326, DECK_Y - 9.5, 3, 9.5);
    ctx.fillRect(302, DECK_Y - 5, 28, 2);   // shelf
    // vise on the left end
    ctx.fillStyle = '#3c4448';
    ctx.fillRect(303, DECK_Y - 18, 7, 5);
    ctx.fillStyle = '#5a646c';
    ctx.fillRect(303, DECK_Y - 18, 7, 1.5);
    ctx.fillStyle = '#2a3036';
    ctx.fillRect(305.5, DECK_Y - 20.5, 2, 3);
    // hammer resting on the bench
    ctx.fillStyle = '#7a5c34';
    ctx.save();
    ctx.translate(319, DECK_Y - 14);
    ctx.rotate(-0.45);
    ctx.fillRect(0, 0, 9, 1.5);
    ctx.fillStyle = '#4a5258';
    ctx.fillRect(7.5, -2, 3.5, 5);
    ctx.restore();
    // little pile of shells waiting
    drawSpr(ctx, SPR.icons.clam, 312, DECK_Y - 19);
    drawSpr(ctx, SPR.icons.oyster, 318, DECK_Y - 17.5);
    // lantern hook glow at night
    if (nightness(G.clock) > 0.3) {
      ctx.fillStyle = 'rgba(255,206,110,0.1)';
      ctx.beginPath(); ctx.arc(316, DECK_Y - 14, 13, 0, TAU); ctx.fill();
    }

    // ---- laptop table under a striped awning ---------------------------------------
    // awning
    const awnX = 236, awnW = 34;
    ctx.fillStyle = '#2e2210';
    ctx.fillRect(awnX, DECK_Y - 34, 2, 34);
    ctx.fillRect(awnX + awnW - 2, DECK_Y - 34, 2, 34);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#e8dcc0' : '#3f8f8f';
      ctx.beginPath();
      ctx.moveTo(awnX - 3 + (awnW + 6) * (i / 6), DECK_Y - 34);
      ctx.lineTo(awnX - 3 + (awnW + 6) * ((i + 1) / 6), DECK_Y - 34);
      ctx.lineTo(awnX - 1 + (awnW + 2) * ((i + 1) / 6), DECK_Y - 27);
      ctx.lineTo(awnX - 1 + (awnW + 2) * (i / 6), DECK_Y - 27);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(awnX - 1, DECK_Y - 28, awnW + 2, 1);
    // scalloped edge
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? '#d4c8ac' : '#377f7f';
      ctx.beginPath();
      ctx.arc(awnX - 1 + (awnW + 2) * ((i + 0.5) / 9), DECK_Y - 27, 2, 0, Math.PI);
      ctx.fill();
    }
    // table
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(240, DECK_Y - 12, 26, 3);
    ctx.fillStyle = '#5f4a2c';
    ctx.fillRect(240, DECK_Y - 12, 26, 1);
    ctx.fillStyle = '#3a2c16';
    ctx.fillRect(243, DECK_Y - 9, 2.5, 9);
    ctx.fillRect(260, DECK_Y - 9, 2.5, 9);
    // laptop
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(246, DECK_Y - 21, 14, 9);
    ctx.fillStyle = nite > 0.3 ? '#9fe8ff' : '#5ad2f0';
    ctx.fillRect(247, DECK_Y - 20, 12, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(248, DECK_Y - 19, 4, 1);
    ctx.fillRect(248, DECK_Y - 17, 7, 1);
    ctx.fillStyle = '#20262c';
    ctx.fillRect(245, DECK_Y - 12.5, 16, 1.5);
    // steaming mug
    ctx.fillStyle = '#c8523c';
    ctx.fillRect(263.5, DECK_Y - 15.5, 3.5, 3.5);
    ctx.strokeStyle = '#c8523c'; ctx.lineWidth = PIX * 2;
    ctx.beginPath(); ctx.arc(267.5, DECK_Y - 13.8, 1.2, -1.2, 1.2); ctx.stroke();
    ctx.fillStyle = `rgba(240,240,235,${0.4 + Math.sin(this.time * 2) * 0.15})`;
    ctx.fillRect(264.5 + Math.sin(this.time * 3) * 0.8, DECK_Y - 18.5, 1, 2);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(120,220,255,0.13)';
      ctx.beginPath(); ctx.arc(253, DECK_Y - 16, 14, 0, TAU); ctx.fill();
    }

    // drone pad
    ctx.fillStyle = '#3c4448';
    ctx.fillRect(78, DECK_Y - 1, 44, 2);
    ctx.fillStyle = '#c8a03c';
    ctx.fillRect(80, DECK_Y - 1, 4, 1); ctx.fillRect(116, DECK_Y - 1, 4, 1);
    ctx.strokeStyle = '#9aa4a8'; ctx.lineWidth = PIX * 2;
    ctx.beginPath(); ctx.ellipse(100, DECK_Y - 0.5, 14, 1.6, 0, 0, TAU); ctx.stroke();
    text(ctx, 'H', 100, DECK_Y - 8, { size: 7, color: '#9aa4a8', align: 'center' });

    // pending crate + drone
    this.drawDrone(ctx);

    // crab
    const cb = this.crab;
    drawSpr(ctx, SPR.crab[Math.floor(cb.t) % 2], Math.round(cb.x), DECK_Y - 4);

    // perched gull
    if (this.perchedGull.there) {
      const gx = this.perchedGull.x;
      ctx.fillStyle = '#f2f4f6';
      ctx.beginPath(); ctx.ellipse(gx, DECK_Y - 17, 3.5, 2.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 3, DECK_Y - 20.5, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9ced4';
      ctx.fillRect(gx - 2.5, DECK_Y - 17, 3.5, 1.5);
      ctx.fillStyle = '#e8a13c';
      ctx.fillRect(gx + 5, DECK_Y - 21, 2, 1);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(gx + 3.5, DECK_Y - 21.5, 1, 1);
    }

    // smoke
    for (const s of this.smoke) {
      ctx.fillStyle = `rgba(200,200,205,${clamp(s.t / 3, 0, 0.5)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }

    // spray
    ctx.fillStyle = 'rgba(240,248,250,0.7)';
    for (const p of this.spray) ctx.fillRect(p.x, p.y, PIX * 2, PIX * 2);

    // ---- player ----------------------------------------------------------------------
    const frames = this.dir >= 0 ? SPR.otterR : SPR.otterL;
    let frame = 0;
    if (this.walkT > 0 && this.idleT < 0.1) frame = 1 + (Math.floor(this.walkT) % 2);
    else if ((this.time % 3.6) < 0.13) frame = 3;
    const bob = frame === 2 ? -0.5 : 0;
    // soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(this.px, DECK_Y + 0.5, 6, 1.5, 0, 0, TAU); ctx.fill();
    drawSpr(ctx, frames[frame], this.px - 6, DECK_Y - 16.5 + bob);

    // interact prompt bubble
    let best = null, bd = 20;
    for (const s of this.spots()) {
      const d = Math.abs(this.px - s.x);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      const label = (TouchUI.enabled ? '' : '[E] ') + best.label;
      const w = textWidth(ctx, label, 7) + 12;
      const bx = clamp(this.px, cam + w / 2 + 4, cam + W - w / 2 - 4);
      uiPanel(ctx, bx - w / 2, DECK_Y - 42, w, 13, 0.85);
      text(ctx, label, bx, DECK_Y - 39, { size: 7, color: '#fff8e0', align: 'center' });
      ctx.fillStyle = 'rgba(26,17,10,0.85)';
      ctx.beginPath();
      ctx.moveTo(this.px - 3, DECK_Y - 29); ctx.lineTo(this.px + 3, DECK_Y - 29); ctx.lineTo(this.px, DECK_Y - 25);
      ctx.closePath(); ctx.fill();
    }

    // foreground wave band (in front of stilts)
    ctx.fillStyle = waterTopC;
    ctx.beginPath();
    ctx.moveTo(cam - 10, H);
    ctx.lineTo(cam - 10, 202);
    for (let x = cam - 10; x <= cam + W + 10; x += 8) {
      ctx.lineTo(x, 202 + Math.sin(x * 0.05 + this.time * 1.8) * 3);
    }
    ctx.lineTo(cam + W + 10, H);
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    // foam crest with occasional bubbles
    for (let x = cam - 10; x <= cam + W + 10; x += 8) {
      const wy = 202 + Math.sin(x * 0.05 + this.time * 1.8) * 3;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, wy, 5, 1);
      if (Math.sin(x * 1.7 + this.time * 3) > 0.9) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x + 2, wy - 1.5, 1.5, 1.5);
      }
    }
    // structure reflections shimmering in the foreground water
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#0a0f14';
    for (let x = 60; x < endX; x += 60) {
      for (let y = 208; y < 250; y += 3)
        ctx.fillRect(x + Math.sin(y * 0.5 + this.time * 2) * 1.5, y, 6, 1.5);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // gulls (screen space)
    for (const g of this.gulls) {
      const img = SPR.gull[Math.floor(g.f) % 2];
      if (g.vx < 0) {
        ctx.save(); ctx.translate(Math.round(g.x), Math.round(g.y)); ctx.scale(-1, 1);
        drawSpr(ctx, img, -7, 0); ctx.restore();
      } else {
        drawSpr(ctx, img, Math.round(g.x), Math.round(g.y));
      }
    }

    // night darkness + glows
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(8,10,30,${nite * 0.42})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-cam, 0);
      // window glow
      ctx.fillStyle = `rgba(255,214,120,${nite * 0.16})`;
      ctx.beginPath(); ctx.arc(112, 148, 22, 0, TAU); ctx.fill();
      if (G.house >= 2) { ctx.beginPath(); ctx.arc(148, 148, 18, 0, TAU); ctx.fill(); }
      // string lights
      if (G.decor.lights) {
        for (let i = 0; i < 14; i++) {
          const lx = 70 + i * 11;
          const ly = this.houseTop() + 10 + Math.sin(i * 1.1) * 3;
          ctx.fillStyle = ['#ffd66e', '#ff8a7a', '#8af2ff', '#a0f2b4'][i % 4];
          ctx.fillRect(lx, ly, 2, 2);
          ctx.fillStyle = 'rgba(255,220,150,0.12)';
          ctx.beginPath(); ctx.arc(lx + 1, ly + 1, 5, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
  },

  drawHouse(ctx, nite) {
    const lvl = G.house;
    const top = this.houseTop();
    const x0 = lvl >= 3 ? 64 : 78, x1 = lvl >= 3 ? 212 : 202;
    const wallA = lvl >= 3 ? '#7a6248' : (lvl === 2 ? '#6e5a40' : '#5f4a30');
    const wallB = lvl >= 3 ? '#6e563c' : (lvl === 2 ? '#634e36' : '#544026');
    const roof = lvl >= 3 ? '#8a3c30' : (lvl === 2 ? '#7a4838' : '#4a3826');
    const roofDark = lvl >= 3 ? '#6e2c22' : (lvl === 2 ? '#623428' : '#3a2c1c');
    const trim = lvl >= 3 ? '#3f8f8f' : (lvl === 2 ? '#4a8f7a' : '#3a2c18');

    // walls: horizontal siding planks, alternating tones with knots
    const rng = mulberry32(99 + lvl);
    for (let y = top + 12, i = 0; y < DECK_Y; y += 5, i++) {
      ctx.fillStyle = i % 2 ? wallB : wallA;
      ctx.fillRect(x0, y, x1 - x0, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x0, y, x1 - x0, PIX);
      if (rng() > 0.6) {
        ctx.fillStyle = 'rgba(30,20,10,0.45)';
        ctx.fillRect(x0 + 6 + rng() * (x1 - x0 - 16), y + 1.5, 2, 1.5);
      }
    }
    // corner trim boards
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(x0, top + 12, 3, DECK_Y - top - 12);
    ctx.fillRect(x1 - 3, top + 12, 3, DECK_Y - top - 12);

    // roof: hand-laid shingles
    const ridgeX = (x0 + x1) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 - 9, top + 15);
    ctx.lineTo(ridgeX, top - 11);
    ctx.lineTo(x1 + 9, top + 15);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = roof;
    ctx.fillRect(x0 - 9, top - 11, x1 - x0 + 18, 27);
    for (let ry = top - 10, row = 0; ry < top + 16; ry += 4, row++) {
      for (let sx = x0 - 10 + (row % 2) * 4; sx < x1 + 10; sx += 8) {
        ctx.fillStyle = mulberry32(sx * 13 + row * 7)() > 0.5 ? roof : roofDark;
        ctx.fillRect(sx, ry, 7.5, 3.5);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(sx, ry + 3.5, 7.5, PIX);
      }
    }
    ctx.restore();
    // roof outline + ridge cap
    ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 - 9, top + 15); ctx.lineTo(ridgeX, top - 11); ctx.lineTo(x1 + 9, top + 15);
    ctx.stroke();
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(ridgeX - 5, top - 12, 10, 2);
    // eave shadow on wall
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x0, top + 12, x1 - x0, 2);

    // chimney with bricks
    ctx.fillStyle = '#4a3c34';
    ctx.fillRect(97, top - 8, 11, 20);
    ctx.fillStyle = '#3a2e28';
    for (let by = top - 6, r = 0; by < top + 10; by += 3, r++)
      for (let bx = 97 + (r % 2) * 2.5; bx < 107; bx += 5)
        ctx.fillRect(bx, by, PIX * 2, 3);
    ctx.fillStyle = '#5a4c42';
    ctx.fillRect(96, top - 10, 13, 3);

    // window(s): portholes with panes, curtains, sill
    const winLit = nite > 0.3;
    const drawWin = (wx, wy) => {
      ctx.fillStyle = '#2c2013';
      ctx.beginPath(); ctx.arc(wx, wy, 9.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a6a40';
      ctx.beginPath(); ctx.arc(wx, wy, 8.5, 0, TAU); ctx.fill();
      ctx.fillStyle = winLit ? '#ffd66e' : '#9fc4d4';
      ctx.beginPath(); ctx.arc(wx, wy, 7, 0, TAU); ctx.fill();
      if (!winLit) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(wx - 4, wy - 4, 3, 2);
      }
      // curtains
      ctx.fillStyle = winLit ? '#c86a4a' : '#a85a42';
      ctx.beginPath(); ctx.moveTo(wx - 6.5, wy - 3); ctx.quadraticCurveTo(wx - 3, wy, wx - 4.5, wy + 5.5); ctx.lineTo(wx - 6.8, wy + 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(wx + 6.5, wy - 3); ctx.quadraticCurveTo(wx + 3, wy, wx + 4.5, wy + 5.5); ctx.lineTo(wx + 6.8, wy + 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(wx - 7, wy); ctx.lineTo(wx + 7, wy); ctx.moveTo(wx, wy - 7); ctx.lineTo(wx, wy + 7); ctx.stroke();
      // sill
      ctx.fillStyle = trim === '#3a2c18' ? '#4a3820' : trim;
      ctx.fillRect(wx - 8, wy + 9, 16, 2);
    };
    drawWin(112, 148);
    if (lvl >= 2) drawWin(148, 148);
    if (lvl >= 3) drawWin(130, 116);

    // door: plank door with strap hinges + porthole
    ctx.fillStyle = '#2c1e0e';
    ctx.fillRect(179, DECK_Y - 31, 22, 31);
    ctx.fillStyle = '#57401f';
    ctx.fillRect(181, DECK_Y - 29, 18, 29);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let dx = 185; dx < 199; dx += 4.5) ctx.fillRect(dx, DECK_Y - 29, PIX, 29);
    // strap hinges
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(181, DECK_Y - 25, 7, 1.5);
    ctx.fillRect(181, DECK_Y - 10, 7, 1.5);
    // porthole in door
    ctx.fillStyle = '#8a6a40';
    ctx.beginPath(); ctx.arc(190, DECK_Y - 22, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = winLit ? '#ffd66e' : '#7ba4b4';
    ctx.beginPath(); ctx.arc(190, DECK_Y - 22, 2.3, 0, TAU); ctx.fill();
    // knob
    ctx.fillStyle = '#e0b44c';
    ctx.fillRect(196.5, DECK_Y - 15, 2, 2);
    // welcome mat
    ctx.fillStyle = '#7a6a4a';
    ctx.fillRect(180, DECK_Y - 1, 20, 2);
    ctx.fillStyle = '#95815a';
    ctx.fillRect(182, DECK_Y - 0.5, 16, 1);

    // hanging sign on chains, gently swinging
    const swing = Math.sin(this.time * 1.6) * 0.9;
    ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = PIX * 2;
    ctx.beginPath();
    ctx.moveTo(160, top + 14); ctx.lineTo(160 + swing, DECK_Y - 29);
    ctx.moveTo(176, top + 14); ctx.lineTo(176 + swing, DECK_Y - 29);
    ctx.stroke();
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(157 + swing, DECK_Y - 29, 22, 10);
    ctx.fillStyle = '#c9b896';
    ctx.fillRect(157 + swing, DECK_Y - 21, 22, 2);
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = PIX * 2;
    ctx.strokeRect(157 + swing, DECK_Y - 29, 22, 10);
    text(ctx, "OTTO'S", 168 + swing, DECK_Y - 27, { size: 6, color: '#4a3820', align: 'center', shadow: false });

    // flower box (lvl2+)
    if (lvl >= 2) {
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(103, 159, 18, 4);
      ctx.fillStyle = '#3f8f4f';
      ctx.fillRect(104, 156, 16, 3);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = ['#e86a8a', '#ffd66e', '#c88af2', '#ff8a5a'][i];
        ctx.fillRect(105 + i * 4, 154.5, 2, 2);
      }
    }
    // weathervane (lvl3)
    if (lvl >= 3) {
      ctx.strokeStyle = '#c8ccd0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(138, top - 11); ctx.lineTo(138, top - 21); ctx.stroke();
      ctx.fillStyle = '#c8ccd0';
      ctx.beginPath(); ctx.moveTo(138, top - 21); ctx.lineTo(144, top - 19); ctx.lineTo(138, top - 17); ctx.closePath(); ctx.fill();
      ctx.fillRect(135, top - 20.5, 2, 1);
    }
  },

  drawDrone(ctx) {
    const pc = G.pendingCrate;
    if (!pc) return;
    const padX = 100, padY = DECK_Y - 1;
    // crate waiting on pad (rises during pickup)
    let crateY = padY - 10;
    let crateWithDrone = false;
    if (pc.t <= 2.4 && pc.t > 1.1) crateY = padY - 10 - (2.4 - pc.t) * 30;
    if (pc.t <= 1.1) crateWithDrone = true;
    if (!crateWithDrone) drawCrate(ctx, padX - 6, crateY);

    if (pc.t <= 10) {
      let dx, dy;
      if (pc.t > 4) {
        const f = (10 - pc.t) / 6;
        dx = lerp(this.worldW() + 30, padX, f);
        dy = lerp(36, 56, f);
      } else if (pc.t > 1.1) {
        dx = padX + Math.sin(this.time * 2) * 2;
        dy = 56 + Math.sin(this.time * 3) * 2;
        // tractor beam
        if (pc.t <= 2.4) {
          ctx.fillStyle = `rgba(120,220,255,${0.25 + Math.sin(this.time * 12) * 0.08})`;
          ctx.beginPath();
          ctx.moveTo(dx - 3, dy + 4); ctx.lineTo(dx + 3, dy + 4);
          ctx.lineTo(dx + 10, crateY + 8); ctx.lineTo(dx - 10, crateY + 8);
          ctx.closePath(); ctx.fill();
        }
      } else {
        const f = 1 - pc.t / 1.1;
        dx = lerp(padX, -60, f);
        dy = lerp(56, 20, f);
      }
      drawDrone(ctx, dx, dy, this.time, crateWithDrone);
    }
  },
};
