// ---- surface world: painted sea, modular dock, Otto's stilt house -------------
'use strict';

function nightness(clock) {
  if (clock > 0.74 || clock < 0.02) return 1;
  if (clock >= 0.62 && clock <= 0.74) return (clock - 0.62) / 0.12;
  if (clock >= 0.02 && clock <= 0.14) return 1 - (clock - 0.02) / 0.12;
  return 0;
}

const PILING_X = [460, 640, 820];
const DECK_Y = 176;

// house placement (the uploaded stilt hut)
const HOUSE_X = 30, HOUSE_W = 175;
// bridge of repeating dock modules
const SEG_START = 330, SEG_W = 88;

const WorldScene = {
  customCursor: false,
  px: 160, dir: 1, walkT: 0, idleT: 0,
  camX: 0, time: 0,
  gulls: [], smoke: [], stars: null,
  crab: { x: 250, dir: 1, t: 0 },
  perchedGull: { there: true, x: 388 },
  fishJumpT: 9, fishJump: null,
  dolphins: null,
  sprayT: 2, spray: [], dust: [], dustT: 0,
  _lampGlows: [],

  worldW() { return this.endX() + 80; },
  endX() { return 300 + G.bridge * 200; },
  houseTop() { return DECK_Y - assetH('house_ext', HOUSE_W) * 0.557; },

  enter(opts) {
    this.time = 0;
    if (opts && opts.at !== undefined) this.px = PILING_X[opts.at];
    else if (opts && opts.fromHouse) this.px = 150;
    if (!this.stars) {
      const rng = mulberry32(777);
      this.stars = [];
      for (let i = 0; i < 70; i++) this.stars.push({ x: rng() * W, y: rng() * 120, p: rng() * TAU, big: rng() < 0.2 });
    }
    SND.setScene('surface');
    if (!G.flags.seenWorld) {
      G.flags.seenWorld = true;
      Game.toast(TouchUI.enabled
        ? 'Welcome home, Otto!  Arrows: walk  •  Paw button: interact'
        : 'Welcome home, Otto!  A/D or arrows: walk  •  [E]: interact');
      Game.toast('Walk right along the dock and dive at a piling.');
    }
  },

  spots() {
    const s = [
      { x: 118, label: 'Enter House', act: () => Game.go(HouseScene, {}) },
      { x: 245, label: 'ClamNet  (sell & shop)', act: () => { Shop.openUI(); } },
      { x: 302, label: 'Workbench  (crack & polish)', act: () => { Bench.openUI(); } },
    ];
    for (let i = 0; i < G.bridge; i++) {
      s.push({
        x: PILING_X[i],
        label: `Dive — ${PILINGS[i].name}  (beds ~${Math.round(clamp(G.growth[i], 0, 1) * 100)}%)`,
        act: () => Game.go(DiveScene, i),
      });
    }
    return s;
  },

  update(dt) {
    this.time += dt;
    let mv = 0;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    if (mv !== 0) {
      this.dir = mv;
      this.px = clamp(this.px + mv * 92 * dt, 66, this.endX() - 10);
      this.walkT += dt * 9;
      this.idleT = 0;
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.24;
        this.dust.push({ x: this.px - mv * 5, y: DECK_Y - 0.5, s: rand(1, 1.8), t: rand(0.3, 0.5) });
      }
    } else {
      this.idleT += dt;
    }
    for (const d of this.dust) { d.t -= dt; d.y -= 3 * dt; d.x -= (this.dir || 1) * 2 * dt; }
    this.dust = this.dust.filter(d => d.t > 0);
    this.camX = clamp(this.px - W / 2, 0, this.worldW() - W);

    if (Input.p('KeyE') || Input.p('Space')) {
      let best = null, bd = 22;
      for (const s of this.spots()) {
        const d = Math.abs(this.px - s.x);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { SND.click(); best.act(); return; }
    }

    // chimney smoke
    if (Math.random() < dt * 2) {
      this.smoke.push({ x: HOUSE_X + HOUSE_W * 0.42 + rand(-1, 1), y: this.houseTop() + 6, vy: rand(-13, -8), t: rand(1.5, 3), s: rand(1.5, 3) });
    }
    for (const s of this.smoke) { s.y += s.vy * dt; s.x += Math.sin(this.time + s.y * 0.1) * 0.2 + 3 * dt; s.t -= dt; }
    this.smoke = this.smoke.filter(s => s.t > 0);

    // gulls
    if (Math.random() < dt / 8) {
      const fromLeft = Math.random() < 0.5;
      this.gulls.push({ x: fromLeft ? -20 : W + 20, y: rand(16, 70), vx: fromLeft ? rand(20, 36) : -rand(20, 36), f: 0 });
      if (Math.random() < 0.6) SND.gull();
    }
    for (const g of this.gulls) { g.x += g.vx * dt; g.f += dt * 6; }
    this.gulls = this.gulls.filter(g => g.x > -30 && g.x < W + 30);

    if (this.perchedGull.there && Math.abs(this.px - this.perchedGull.x) < 22) {
      this.perchedGull.there = false;
      this.gulls.push({ x: this.perchedGull.x - this.camX, y: DECK_Y - 20, vx: rand(24, 40) * (Math.random() < 0.5 ? -1 : 1), f: 0 });
      SND.gull();
      setTimeout(() => { this.perchedGull.there = true; this.perchedGull.x = pick([388, 420, 560]); }, 15000);
    }

    // crab
    const c = this.crab;
    c.t += dt * 6;
    c.x += c.dir * 8 * dt;
    if (c.x < 218 || c.x > 286) c.dir *= -1;

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

    // dolphins far out
    if (!this.dolphins && Math.random() < dt / 30) this.dolphins = { x: -30, t: 0 };
    if (this.dolphins) {
      this.dolphins.x += 34 * dt;
      this.dolphins.t += dt;
      if (this.dolphins.x > W + 60) this.dolphins = null;
    }

    // sea spray at posts
    this.sprayT -= dt;
    if (this.sprayT <= 0) {
      this.sprayT = rand(0.8, 1.8);
      const sx = SEG_START + Math.floor(rand(0, (this.endX() - SEG_START) / SEG_W)) * SEG_W;
      for (let i = 0; i < 3; i++)
        this.spray.push({ x: sx + rand(-3, 3), y: 202, vx: rand(-6, 6), vy: rand(-22, -10), t: rand(0.4, 0.8) });
    }
    for (const p of this.spray) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.t -= dt; }
    this.spray = this.spray.filter(p => p.t > 0);

    if (G.pendingCrate && G.pendingCrate.t < 10) SND.droneOn(); else SND.droneOff();
  },

  draw(ctx) {
    const cam = this.camX;
    const nite = nightness(G.clock);
    this._lampGlows = [];

    // the painted sea (animated), light horizontal parallax
    drawA(ctx, `bg_surf${Math.floor(this.time * 7) % 10}`, -20 - cam * 0.055, 0, 540, 270);

    // night stars + moon over the painted sky
    if (nite > 0.2) {
      for (const st of this.stars) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 0.8 + st.p));
        ctx.fillStyle = `rgba(230,238,255,${nite * tw * 0.8})`;
        ctx.fillRect(Math.round(st.x), Math.round(st.y), st.big ? 1 : PIX, st.big ? 1 : PIX);
      }
      ctx.fillStyle = `rgba(232,236,242,${nite})`;
      ctx.beginPath(); ctx.arc(W - 90, 42, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(160,175,205,${nite})`;
      ctx.fillRect(W - 94, 40, 2, 2); ctx.fillRect(W - 88, 44, 1.5, 1.5);
    }

    // dolphins on the horizon
    if (this.dolphins) {
      const d = this.dolphins;
      ctx.fillStyle = `rgba(30,70,110,${0.7 - nite * 0.3})`;
      for (let i = 0; i < 3; i++) {
        const px2 = d.x - i * 22;
        const ph = (d.t * 1.4 + i * 0.6) % TAU;
        const arc = Math.max(0, Math.sin(ph));
        if (arc < 0.05) continue;
        ctx.save();
        ctx.translate(px2, 128 - arc * 8);
        ctx.rotate(Math.cos(ph) * -0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 2.4, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-1, -1.5); ctx.lineTo(1.5, -4.5); ctx.lineTo(3.5, -1.5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // fish jump
    if (this.fishJump) {
      const f = this.fishJump, ft = f.t;
      const fy = 210 - Math.sin(ft * Math.PI) * 26;
      ctx.save();
      ctx.translate(f.x - cam, fy);
      ctx.rotate(ft * Math.PI - Math.PI / 2);
      ctx.fillStyle = '#4a7a9e';
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7ab0cc';
      ctx.beginPath(); ctx.ellipse(0.5, -0.5, 3, 1, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = PIX * 2;
      const rr = ft < 0.5 ? ft * 8 : (1 - ft) * 12 + 4;
      ctx.beginPath(); ctx.ellipse(f.x - cam, 212, rr, rr * 0.3, 0, 0, TAU); ctx.stroke();
    }

    ctx.save();
    ctx.translate(-cam, 0);
    const endX = this.endX();

    // boardwalk under everything, tying the modules together
    ctx.fillStyle = '#7a4a3c';
    ctx.fillRect(196, DECK_Y - 1, SEG_START - 186, 2.5);
    ctx.fillStyle = 'rgba(255,220,190,0.25)';
    ctx.fillRect(196, DECK_Y - 1, SEG_START - 186, PIX * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(196, DECK_Y + 1, SEG_START - 186, PIX * 2);

    // ---- the house (uploaded stilt hut): its platform IS the deck line ---------------
    const hh = assetH('house_ext', HOUSE_W);
    const hy = DECK_Y - hh * 0.557;
    drawA(ctx, 'house_ext', HOUSE_X, hy, HOUSE_W, hh);
    // upgrade accents
    if (G.house >= 2) {
      // bunting across the front
      const bx0 = HOUSE_X + HOUSE_W * 0.28, bx1 = HOUSE_X + HOUSE_W * 0.78, by = hy + hh * 0.30;
      ctx.strokeStyle = '#6a5030'; ctx.lineWidth = PIX;
      ctx.beginPath(); ctx.moveTo(bx0, by); ctx.quadraticCurveTo((bx0 + bx1) / 2, by + 5, bx1, by); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const fx = lerp(bx0, bx1, t), fy = by + Math.sin(t * Math.PI) * 4.5;
        ctx.fillStyle = ['#e8b84e', '#3f8f8f', '#c8352a'][i % 3];
        ctx.beginPath(); ctx.moveTo(fx - 2.4, fy); ctx.lineTo(fx + 2.4, fy); ctx.lineTo(fx, fy + 4); ctx.closePath(); ctx.fill();
      }
    }
    if (G.house >= 3) {
      // gilded roof finial glint
      ctx.fillStyle = '#f2cc5a';
      ctx.fillRect(HOUSE_X + HOUSE_W * 0.395, hy - 1, 4, 4);
      if (Math.sin(this.time * 3) > 0.7) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(HOUSE_X + HOUSE_W * 0.395 + rand(0, 3), hy - 1 + rand(0, 3), 1, 1);
      }
    }
    if (G.decor.lights) {
      for (let i = 0; i < 12; i++) {
        const lx = HOUSE_X + HOUSE_W * 0.22 + i * (HOUSE_W * 0.05);
        const ly = hy + hh * 0.22 + Math.sin(i * 1.2) * 2.5;
        ctx.fillStyle = ['#ffd66e', '#ff8a7a', '#8af2ff', '#a0f2b4'][i % 4];
        ctx.fillRect(lx, ly, 1.5, 1.5);
        if (nite > 0.3) {
          ctx.fillStyle = 'rgba(255,220,150,0.12)';
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, TAU); ctx.fill();
        }
      }
    }

    // ---- laptop stand (dock_1) + ClamNet laptop ------------------------------------
    const standW = 52, standH = assetH('dock_1', standW);
    const standY = DECK_Y - standH * 0.52;
    drawA(ctx, 'dock_1', 220, standY, standW, standH);
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(238, standY + standH * 0.30, 15, 10);
    ctx.fillStyle = nite > 0.3 ? '#9fe8ff' : '#5ad2f0';
    ctx.fillRect(239, standY + standH * 0.30 + 1, 13, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(240, standY + standH * 0.30 + 2, 5, 1);
    ctx.fillRect(240, standY + standH * 0.30 + 4, 8, 1);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(120,220,255,0.13)';
      ctx.beginPath(); ctx.arc(245, standY + standH * 0.30 + 5, 14, 0, TAU); ctx.fill();
    }

    // ---- workbench (dock_13 table w/ barrel + lantern) --------------------------------
    const wbW = 62, wbH = assetH('dock_13', wbW);
    const wbY = DECK_Y - wbH * 0.36;
    drawA(ctx, 'dock_13', 274, wbY, wbW, wbH);
    this._lampGlows.push({ x: 274 + wbW * 0.9, y: wbY + wbH * 0.12 });
    drawAC(ctx, 'shell_clam', 296, wbY + wbH * 0.30, 10);
    drawAC(ctx, 'shell_scallop', 306, wbY + wbH * 0.32, 9);

    // ---- bridge: one clean module, repeated and connected -----------------------------
    // lamp posts stand behind the deck every third segment
    const lpW = 17, lpH = assetH('dock_15', lpW);
    for (let x = SEG_START + SEG_W * 1.5; x < endX - 20; x += SEG_W * 3) {
      drawA(ctx, 'dock_15', x, DECK_Y - lpH + 2, lpW, lpH);
      this._lampGlows.push({ x: x + lpW * 0.55, y: DECK_Y - lpH + 6 });
    }
    const segH = assetH('dock_3', SEG_W + 2);
    for (let x = SEG_START; x < endX; x += SEG_W) {
      drawA(ctx, 'dock_3', x - 1, DECK_Y - segH * 0.20, SEG_W + 2, segH);
    }
    // end-of-bridge barrier
    if (G.bridge < 3) {
      const gw = 26, gh = assetH('dock_10', gw);
      drawA(ctx, 'dock_10', endX - 14, DECK_Y - gh * 0.96, gw, gh);
      ctx.fillStyle = '#c8a03c';
      ctx.fillRect(endX - 10, DECK_Y - 18, 18, 7);
      ctx.fillStyle = '#7a5c1c';
      for (let i = 0; i < 3; i++) ctx.fillRect(endX - 8 + i * 6.5, DECK_Y - 16.5, 3.5, 4);
    }

    // dive pilings: ladder + buoy
    for (let i = 0; i < G.bridge; i++) {
      const x = PILING_X[i];
      const lw = 17, lh = assetH('dock_9', lw);
      drawA(ctx, 'dock_9', x + 4, DECK_Y - 3, lw, lh);
      const by = 208 + Math.sin(this.time * 1.6 + i * 2) * 2.5;
      ctx.fillStyle = '#8a2620';
      ctx.beginPath(); ctx.arc(x + 30, by, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c8352a';
      ctx.beginPath(); ctx.arc(x + 29, by - 1, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2ede2';
      ctx.fillRect(x + 26, by - 2, 9, 2);
      if (nite > 0.4 && Math.sin(this.time * 3 + i) > 0) {
        ctx.fillStyle = 'rgba(255,80,60,0.95)';
        ctx.fillRect(x + 29, by - 7, 2, 2);
      }
    }

    // drone pad
    ctx.fillStyle = '#3c4448';
    ctx.fillRect(158, DECK_Y - 1, 44, 2);
    ctx.strokeStyle = '#9aa4a8'; ctx.lineWidth = PIX * 2;
    ctx.beginPath(); ctx.ellipse(180, DECK_Y - 0.5, 14, 1.6, 0, 0, TAU); ctx.stroke();
    text(ctx, 'H', 180, DECK_Y - 8, { size: 7, color: '#9aa4a8', align: 'center' });

    this.drawDrone(ctx);

    // crab + perched gull
    drawSpr(ctx, SPR.crab[Math.floor(this.crab.t) % 2], Math.round(this.crab.x), DECK_Y - 4);
    if (this.perchedGull.there) {
      const gx = this.perchedGull.x;
      ctx.fillStyle = '#f2f4f6';
      ctx.beginPath(); ctx.ellipse(gx, DECK_Y - 6, 3.5, 2.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 3, DECK_Y - 9.5, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8a13c';
      ctx.fillRect(gx + 5, DECK_Y - 10, 2, 1);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(gx + 3.5, DECK_Y - 10.5, 1, 1);
    }

    // smoke + spray + dust
    for (const s of this.smoke) {
      ctx.fillStyle = `rgba(220,220,225,${clamp(s.t / 3, 0, 0.45)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,248,250,0.7)';
    for (const p of this.spray) ctx.fillRect(p.x, p.y, PIX * 2, PIX * 2);
    for (const d of this.dust) {
      ctx.fillStyle = `rgba(200,186,150,${clamp(d.t * 1.6, 0, 0.5)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * (1.6 - d.t), 0, TAU); ctx.fill();
    }

    // ---- player: the uploaded otter, with squash & stretch ---------------------------
    const OTTER_WALK = ['o2_0', 'o2_1', 'o2_3', 'o2_4', 'o2_5'];
    const walking = this.walkT > 0 && this.idleT < 0.1;
    let frameN = 0, sqx = 1, sqy = 1, hop = 0;
    if (walking) {
      frameN = Math.floor(this.walkT * 0.9) % OTTER_WALK.length;
      const ph = this.walkT * 2.2;
      hop = Math.abs(Math.sin(ph)) * 1.6;
      sqy = 1 + Math.cos(ph * 2) * 0.045;
      sqx = 1 - (sqy - 1) * 0.85;
    } else {
      sqy = 1 + Math.sin(this.time * 2.1) * 0.02;
      sqx = 1 - (sqy - 1) * 0.7;
    }
    ctx.fillStyle = 'rgba(0,10,30,0.3)';
    ctx.beginPath(); ctx.ellipse(this.px, DECK_Y + 0.6, Math.max(4, 7 - hop * 0.9), 1.6, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS[walking ? OTTER_WALK[frameN] : 'o2_13'];
    if (oimg && oimg.width) {
      const oh = 27, ow = oh * oimg.width / oimg.height;
      ctx.save();
      ctx.translate(Math.round(this.px * DPX) / DPX, DECK_Y + 0.5 - hop);
      ctx.scale(this.dir >= 0 ? -sqx : sqx, sqy);   // sheet faces left
      ctx.drawImage(oimg, -ow / 2, -oh + 0.5, ow, oh);
      ctx.restore();
    }

    // interact prompt bubble
    let best = null, bd = 22;
    for (const s of this.spots()) {
      const d = Math.abs(this.px - s.x);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      const label = (TouchUI.enabled ? '' : '[E] ') + best.label;
      const w = textWidth(ctx, label, 7) + 12;
      const bx = clamp(this.px, cam + w / 2 + 4, cam + W - w / 2 - 4);
      uiPanel(ctx, bx - w / 2, DECK_Y - 48, w, 13, 0.95, true);
      text(ctx, label, bx, DECK_Y - 45, { size: 7, color: '#4a3020', align: 'center', shadow: false });
      ctx.fillStyle = 'rgba(246,232,201,0.95)';
      ctx.beginPath();
      ctx.moveTo(this.px - 3, DECK_Y - 35.5); ctx.lineTo(this.px + 3, DECK_Y - 35.5); ctx.lineTo(this.px, DECK_Y - 31.5);
      ctx.closePath(); ctx.fill();
    }

    // waves cut from the painted sea itself, two drifting layers over the post feet
    const wImg = ASSETS[`bg_surf${Math.floor(this.time * 7) % 10}`];
    if (wImg && wImg.width) {
      const sy = wImg.height * 0.66, sh = wImg.height * 0.15;
      for (let L = 0; L < 2; L++) {
        const bob = Math.sin(this.time * (1.1 + L * 0.6) + L * 2.2) * 2;
        const drift = (this.time * (9 + L * 7)) % 540;
        const dy = 216 + L * 10 + bob;
        ctx.globalAlpha = 0.9;
        for (let tx = cam - drift - 540; tx < cam + W + 540; tx += 540) {
          ctx.drawImage(wImg, 0, sy, wImg.width, sh, tx, dy, 540, 58 - L * 6);
        }
      }
      ctx.globalAlpha = 1;
    }

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

    // night: tint + warm glows
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(8,12,38,${nite * 0.45})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-cam, 0);
      // hut window glow
      const hh2 = assetH('house_ext', HOUSE_W);
      const hy2 = DECK_Y - hh2 * 0.557;
      ctx.fillStyle = `rgba(255,214,120,${nite * 0.18})`;
      ctx.beginPath(); ctx.arc(HOUSE_X + HOUSE_W * 0.63, hy2 + hh2 * 0.38, 15, 0, TAU); ctx.fill();
      // dock lanterns
      for (const g of this._lampGlows) {
        const fl = 0.8 + Math.sin(this.time * 8 + g.x) * 0.2;
        ctx.fillStyle = `rgba(255,200,110,${nite * 0.16 * fl})`;
        ctx.beginPath(); ctx.arc(g.x, g.y, 13, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(255,226,150,${nite * 0.85 * fl})`;
        ctx.fillRect(g.x - 1.5, g.y - 2, 3, 4);
      }
      ctx.restore();
    }
  },

  drawDrone(ctx) {
    const pc = G.pendingCrate;
    if (!pc) return;
    const padX = 180, padY = DECK_Y - 1;
    let crateY = padY - 10;
    let leaving = pc.t <= 1.1;
    if (pc.t <= 2.4 && pc.t > 1.1) crateY = padY - 10 - (2.4 - pc.t) * 30;
    if (!leaving) drawCrate(ctx, padX - 6, crateY);

    if (pc.t <= 10) {
      let dx, dy, img = 'drone_fly';
      if (pc.t > 4) {
        const f = (10 - pc.t) / 6;
        dx = lerp(this.worldW() + 30, padX, f);
        dy = lerp(34, 52, f);
      } else if (pc.t > 1.1) {
        dx = padX + Math.sin(this.time * 2) * 2;
        dy = 52 + Math.sin(this.time * 3) * 2;
        img = 'drone_claw';
        if (pc.t <= 2.4) {
          ctx.fillStyle = `rgba(120,220,255,${0.25 + Math.sin(this.time * 12) * 0.08})`;
          ctx.beginPath();
          ctx.moveTo(dx - 3, dy + 8); ctx.lineTo(dx + 3, dy + 8);
          ctx.lineTo(dx + 10, crateY + 8); ctx.lineTo(dx - 10, crateY + 8);
          ctx.closePath(); ctx.fill();
        }
      } else {
        const f = 1 - pc.t / 1.1;
        dx = lerp(padX, -60, f);
        dy = lerp(52, 18, f);
        img = Math.floor(this.time * 7) % 2 ? 'drone_go' : 'drone_go2';
      }
      if (img === 'drone_claw' && pc.t <= 2.4) img = Math.floor(this.time * 7) % 2 ? 'drone_lift' : 'drone_lift2';
      drawAC(ctx, img, dx, dy + Math.sin(this.time * 5) * 1.2, 30);
    }
  },
};