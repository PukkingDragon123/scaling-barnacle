// ---- surface world: Otto's house, the bridge, the sea ----------------------
'use strict';

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

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

function skyColors(clock) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (clock >= SKY_KEYS[i].t && clock <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const f = (clock - a.t) / span;
  return a.c.map((hex, i) => {
    const ca = hex2rgb(hex), cb = hex2rgb(b.c[i]);
    return `rgb(${Math.round(lerp(ca[0], cb[0], f))},${Math.round(lerp(ca[1], cb[1], f))},${Math.round(lerp(ca[2], cb[2], f))})`;
  });
}

function nightness(clock) {
  if (clock > 0.74 || clock < 0.02) return 1;
  if (clock >= 0.62 && clock <= 0.74) return (clock - 0.62) / 0.12;
  if (clock >= 0.02 && clock <= 0.14) return 1 - (clock - 0.02) / 0.12;
  return 0;
}

const PILING_X = [460, 640, 820];
const DECK_Y = 176;
const HORIZON = 148;

const WorldScene = {
  customCursor: false,
  px: 160, dir: 1, walkT: 0, idleT: 0,
  camX: 0, time: 0,
  gulls: [], smoke: [], stars: null, clouds: null,
  crab: { x: 260, dir: 1, t: 0 },
  perchedGull: { there: true, x: 330 },
  fishJumpT: 9, fishJump: null,

  worldW() { return this.endX() + 80; },
  endX() { return 300 + G.bridge * 200; },

  enter(opts) {
    this.time = 0;
    if (opts && opts.at !== undefined) this.px = PILING_X[opts.at];
    else if (opts && opts.fromHouse) this.px = 205;
    if (!this.stars) {
      const rng = mulberry32(777);
      this.stars = [];
      for (let i = 0; i < 60; i++) this.stars.push({ x: rng() * W, y: rng() * HORIZON * 0.9, p: rng() * TAU });
      this.clouds = [];
      for (let i = 0; i < 4; i++) this.clouds.push({ x: rng() * W, y: 20 + rng() * 60, s: 14 + rng() * 22, v: 2 + rng() * 4 });
    }
    SND.setScene('surface');
    if (!G.flags.seenWorld) {
      G.flags.seenWorld = true;
      Game.toast('Welcome home, Otto!  A/D or arrows: walk  •  [E]: interact');
      Game.toast('Walk right along the bridge and dive at a piling.');
    }
  },

  spots() {
    const s = [
      { x: 191, label: 'Enter House', act: () => Game.go(HouseScene, {}) },
      { x: 252, label: 'ClamNet  (sell & shop)', act: () => { Shop.openUI(); } },
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
      this.smoke.push({ x: 103 + rand(-1, 1), y: this.houseTop() + 2, vy: rand(-14, -8), t: rand(1.5, 3), s: rand(1.5, 3) });
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
      setTimeout(() => { this.perchedGull.there = true; this.perchedGull.x = pick([330, 380, 560]); }, 15000);
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

    // drone hum only audible outside
    if (G.pendingCrate && G.pendingCrate.t < 10) SND.droneOn(); else SND.droneOff();
  },

  houseTop() { return G.house >= 3 ? 84 : (G.house === 2 ? 100 : 108); },

  draw(ctx) {
    const cam = this.camX;
    const [skyTop, skyHor, waterTop, waterDeep] = skyColors(G.clock);
    const nite = nightness(G.clock);

    // sky
    let grd = ctx.createLinearGradient(0, 0, 0, HORIZON);
    grd.addColorStop(0, skyTop); grd.addColorStop(1, skyHor);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, HORIZON);

    // stars
    if (nite > 0.2) {
      for (const st of this.stars) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 0.8 + st.p));
        ctx.fillStyle = `rgba(230,238,255,${nite * tw * 0.8})`;
        ctx.fillRect(Math.round(st.x), Math.round(st.y), 1, 1);
      }
    }

    // sun / moon
    if (G.clock > 0.06 && G.clock < 0.66) {
      const st = (G.clock - 0.06) / 0.6;
      const sx = 30 + st * (W - 60), sy = 130 - Math.sin(st * Math.PI) * 95;
      ctx.fillStyle = st > 0.85 || st < 0.12 ? '#f5b46e' : '#fff2c8';
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.25)';
      ctx.beginPath(); ctx.arc(sx, sy, 14, 0, TAU); ctx.fill();
    } else {
      const mtRaw = G.clock >= 0.66 ? (G.clock - 0.66) / 0.4 : (G.clock + 0.34) / 0.4;
      const mt = clamp(mtRaw, 0, 1);
      const mx = 30 + mt * (W - 60), my = 120 - Math.sin(mt * Math.PI) * 85;
      ctx.fillStyle = '#e8ecf2';
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = skyTop;
      ctx.beginPath(); ctx.arc(mx + 3, my - 2, 6, 0, TAU); ctx.fill();
    }

    // clouds
    for (const cl of this.clouds) {
      const cx = ((cl.x + this.time * cl.v) % (W + 140)) - 70;
      ctx.fillStyle = `rgba(245,248,250,${0.75 - nite * 0.55})`;
      ctx.beginPath();
      ctx.ellipse(cx, cl.y, cl.s, cl.s * 0.35, 0, 0, TAU);
      ctx.ellipse(cx + cl.s * 0.6, cl.y + 2, cl.s * 0.7, cl.s * 0.28, 0, 0, TAU);
      ctx.fill();
    }

    // distant island
    ctx.fillStyle = `rgba(30,40,60,${0.5 - nite * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(W - 90 - cam * 0.1, HORIZON);
    ctx.quadraticCurveTo(W - 60 - cam * 0.1, HORIZON - 16, W - 20 - cam * 0.1, HORIZON);
    ctx.fill();

    // sea
    grd = ctx.createLinearGradient(0, HORIZON, 0, H);
    grd.addColorStop(0, waterTop); grd.addColorStop(1, waterDeep);
    ctx.fillStyle = grd; ctx.fillRect(0, HORIZON, W, H - HORIZON);

    // wave glints
    for (let row = 0; row < 10; row++) {
      const y = HORIZON + 4 + row * 12;
      const amp = 1 + row * 0.3;
      ctx.fillStyle = `rgba(255,255,255,${0.10 - row * 0.006 + nite * -0.02})`;
      for (let x = -20; x < W + 20; x += 26) {
        const ox = Math.sin(this.time * 1.4 + row * 1.7 + x * 0.08) * 8;
        ctx.fillRect(Math.round(x + ox - (cam * (0.2 + row * 0.05)) % 26), Math.round(y + Math.sin(this.time + x) * amp * 0.4), 12, 1);
      }
    }
    // moon glint path
    if (nite > 0.5) {
      ctx.fillStyle = `rgba(220,230,245,${(nite - 0.5) * 0.25})`;
      for (let y = HORIZON + 4; y < H; y += 5)
        ctx.fillRect(W * 0.55 + Math.sin(y * 0.4 + this.time * 2) * 6, y, 22 + (y - HORIZON) * 0.3, 1);
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
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(f.x - cam - 3, 214, 6, 1);
    }

    ctx.save();
    ctx.translate(-cam, 0);

    // stilts under everything
    const endX = this.endX();
    for (let x = 60; x < endX; x += 60) {
      ctx.fillStyle = '#2c2013';
      ctx.fillRect(x, DECK_Y + 6, 6, 80);
      ctx.fillStyle = 'rgba(160,160,150,0.4)';
      ctx.fillRect(x, 196 + Math.sin(this.time + x) * 1.5, 6, 2);
    }
    // dive pilings (thick)
    for (let i = 0; i < G.bridge; i++) {
      const x = PILING_X[i];
      ctx.fillStyle = '#241a0e';
      ctx.fillRect(x - 8, DECK_Y + 6, 16, 90);
      ctx.fillStyle = '#3a2c18';
      ctx.fillRect(x - 8, DECK_Y + 6, 4, 90);
      // ladder
      ctx.strokeStyle = '#5a4526'; ctx.lineWidth = 1;
      for (let ly = DECK_Y + 10; ly < DECK_Y + 34; ly += 6) {
        ctx.beginPath(); ctx.moveTo(x + 10, ly); ctx.lineTo(x + 16, ly); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x + 10, DECK_Y + 6); ctx.lineTo(x + 10, DECK_Y + 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, DECK_Y + 6); ctx.lineTo(x + 16, DECK_Y + 36); ctx.stroke();
      // buoy
      const by = 206 + Math.sin(this.time * 1.6 + i * 2) * 2.5;
      ctx.fillStyle = '#c8352a';
      ctx.beginPath(); ctx.arc(x + 26, by, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2ede2';
      ctx.fillRect(x + 22, by - 2, 9, 2);
      if (nite > 0.4 && Math.sin(this.time * 3 + i) > 0) {
        ctx.fillStyle = 'rgba(255,80,60,0.9)';
        ctx.fillRect(x + 25, by - 7, 2, 2);
      }
    }

    // rail (behind player)
    ctx.strokeStyle = '#4a3820'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(44, DECK_Y - 13); ctx.lineTo(endX, DECK_Y - 13); ctx.stroke();
    for (let x = 52; x < endX; x += 40) {
      ctx.fillStyle = '#3c2d18';
      ctx.fillRect(x, DECK_Y - 13, 3, 14);
    }

    // deck planks
    ctx.fillStyle = '#6b4f2c';
    ctx.fillRect(40, DECK_Y, endX - 40, 7);
    ctx.fillStyle = '#57401f';
    for (let x = 40; x < endX; x += 13) ctx.fillRect(x, DECK_Y, 1, 7);
    ctx.fillStyle = '#7d5e38';
    ctx.fillRect(40, DECK_Y, endX - 40, 1);

    // end-of-bridge barrier
    if (G.bridge < 3) {
      ctx.fillStyle = '#8a6434';
      ctx.fillRect(endX - 4, DECK_Y - 22, 4, 22);
      ctx.fillStyle = '#c8a03c';
      ctx.fillRect(endX - 13, DECK_Y - 20, 22, 8);
      ctx.fillStyle = '#3a2a10';
      text(ctx, '!', endX - 3, DECK_Y - 19, { size: 7, color: '#3a2a10', shadow: false, align: 'center' });
    }

    // ---- house ---------------------------------------------------------------
    this.drawHouse(ctx, nite);

    // laptop table
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(242, DECK_Y - 12, 22, 3);
    ctx.fillRect(245, DECK_Y - 9, 3, 9); ctx.fillRect(258, DECK_Y - 9, 3, 9);
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(247, DECK_Y - 20, 13, 8);
    ctx.fillStyle = nite > 0.3 ? '#9fe8ff' : '#5ad2f0';
    ctx.fillRect(248, DECK_Y - 19, 11, 6);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(120,220,255,0.12)';
      ctx.beginPath(); ctx.arc(253, DECK_Y - 15, 14, 0, TAU); ctx.fill();
    }

    // drone pad
    ctx.fillStyle = '#3c4448';
    ctx.fillRect(78, DECK_Y - 1, 44, 2);
    ctx.fillStyle = '#c8a03c';
    ctx.fillRect(80, DECK_Y - 1, 4, 1); ctx.fillRect(116, DECK_Y - 1, 4, 1);
    text(ctx, 'H', 100, DECK_Y - 8, { size: 7, color: '#9aa4a8', align: 'center' });

    // pending crate + drone
    this.drawDrone(ctx);

    // crab
    const cb = this.crab;
    ctx.drawImage(SPR.crab[Math.floor(cb.t) % 2], Math.round(cb.x), DECK_Y - 4);

    // perched gull
    if (this.perchedGull.there) {
      const gx = this.perchedGull.x;
      ctx.fillStyle = '#f2f4f6';
      ctx.beginPath(); ctx.ellipse(gx, DECK_Y - 17, 3.5, 2.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 3, DECK_Y - 20, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8a13c';
      ctx.fillRect(gx + 5, DECK_Y - 20, 2, 1);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(gx + 3, DECK_Y - 21, 1, 1);
    }

    // smoke
    for (const s of this.smoke) {
      ctx.fillStyle = `rgba(200,200,205,${clamp(s.t / 3, 0, 0.5)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }

    // ---- player ----------------------------------------------------------------
    const frames = this.dir >= 0 ? SPR.otterR : SPR.otterL;
    let frame = 0;
    if (this.walkT > 0 && this.idleT < 0.1) frame = 1 + (Math.floor(this.walkT) % 2);
    const bob = frame > 0 ? -(Math.floor(this.walkT * 2) % 2) : 0;
    ctx.drawImage(frames[frame], Math.round(this.px - 8), DECK_Y - 16 + bob);

    // interact prompt
    let best = null, bd = 20;
    for (const s of this.spots()) {
      const d = Math.abs(this.px - s.x);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      text(ctx, `[E] ${best.label}`, this.px, DECK_Y - 34, { size: 7, color: '#fff8e0', align: 'center' });
    }

    // foreground wave band (in front of stilts)
    ctx.fillStyle = waterTop;
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
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let x = cam - 10; x <= cam + W + 10; x += 8) {
      ctx.fillRect(x, 202 + Math.sin(x * 0.05 + this.time * 1.8) * 3, 5, 1);
    }

    ctx.restore();

    // gulls (screen space)
    for (const g of this.gulls) {
      ctx.drawImage(SPR.gull[Math.floor(g.f) % 2], Math.round(g.x), Math.round(g.y));
    }

    // night darkness + glows
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(8,10,30,${nite * 0.45})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-cam, 0);
      // window glow
      ctx.fillStyle = `rgba(255,214,120,${nite * 0.15})`;
      ctx.beginPath(); ctx.arc(112, 148, 22, 0, TAU); ctx.fill();
      // string lights
      if (G.decor.lights) {
        for (let i = 0; i < 14; i++) {
          const lx = 70 + i * 11;
          const ly = this.houseTop() + 4 + Math.sin(i * 1.1) * 3 + 6;
          ctx.fillStyle = ['#ffd66e', '#ff8a7a', '#8af2ff', '#a0f2b4'][i % 4];
          ctx.fillRect(lx, ly, 2, 2);
          ctx.fillStyle = 'rgba(255,220,150,0.1)';
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
    const wall = lvl >= 3 ? '#7a6248' : (lvl === 2 ? '#6e5a40' : '#5f4a30');
    const roof = lvl >= 3 ? '#8a3c30' : (lvl === 2 ? '#7a4838' : '#4a3826');

    // walls
    ctx.fillStyle = wall;
    ctx.fillRect(x0, top + 12, x1 - x0, DECK_Y - top - 12);
    // siding lines
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = top + 16; y < DECK_Y; y += 6) ctx.fillRect(x0, y, x1 - x0, 1);
    // roof
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x0 - 8, top + 14);
    ctx.lineTo((x0 + x1) / 2, top - 10);
    ctx.lineTo(x1 + 8, top + 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x0 - 8, top + 12, x1 - x0 + 16, 2);
    // chimney
    ctx.fillStyle = '#3c3430';
    ctx.fillRect(98, top - 6, 9, 18);
    ctx.fillStyle = '#55493f';
    ctx.fillRect(97, top - 8, 11, 3);
    // window(s)
    const winLit = nite > 0.3;
    const drawWin = (wx, wy) => {
      ctx.fillStyle = '#2c2013';
      ctx.beginPath(); ctx.arc(wx, wy, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = winLit ? '#ffd66e' : '#9fc4d4';
      ctx.beginPath(); ctx.arc(wx, wy, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(wx - 7, wy); ctx.lineTo(wx + 7, wy); ctx.moveTo(wx, wy - 7); ctx.lineTo(wx, wy + 7); ctx.stroke();
    };
    drawWin(112, 148);
    if (lvl >= 2) drawWin(148, 148);
    if (lvl >= 3) drawWin(130, 118);
    // door
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(180, DECK_Y - 30, 20, 30);
    ctx.fillStyle = '#57401f';
    ctx.fillRect(182, DECK_Y - 28, 16, 28);
    ctx.fillStyle = '#c8a03c';
    ctx.fillRect(195, DECK_Y - 16, 2, 2);
    // sign
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(160, DECK_Y - 26, 16, 9);
    text(ctx, 'OTTO', 168, DECK_Y - 25, { size: 5, color: '#4a3820', align: 'center', shadow: false });
    // flower box (lvl2+)
    if (lvl >= 2) {
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(103, 158, 18, 4);
      ctx.fillStyle = '#3f8f4f';
      ctx.fillRect(104, 155, 16, 3);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = ['#e86a8a', '#ffd66e', '#c88af2', '#ff8a5a'][i];
        ctx.fillRect(105 + i * 4, 154, 2, 2);
      }
    }
    // weathervane (lvl3)
    if (lvl >= 3) {
      ctx.strokeStyle = '#c8ccd0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(138, top - 10); ctx.lineTo(138, top - 20); ctx.stroke();
      ctx.fillStyle = '#c8ccd0';
      ctx.beginPath(); ctx.moveTo(138, top - 20); ctx.lineTo(144, top - 18); ctx.lineTo(138, top - 16); ctx.closePath(); ctx.fill();
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
