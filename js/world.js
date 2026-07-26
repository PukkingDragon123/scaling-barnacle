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

// Every structure is anchored by its MEASURED deck-surface line (fraction of
// sprite height) so nothing floats: deck surfaces all land exactly on DECK_Y.
const HOUSE_X = 44, HOUSE_W = 116, HOUSE_DECK = 0.42;
const PIER_START = 128, SEG_W = 88, PIER_DECK = 0.035;   // dock_11 trestle module

// place a sprite so its deck surface sits on DECK_Y
function drawOnDeck(ctx, name, x, w, deckFrac) {
  const h = assetH(name, w);
  drawA(ctx, name, x, DECK_Y - h * deckFrac, w, h);
  return h;
}
// place a sprite standing ON the deck (its feet at DECK_Y)
function drawStanding(ctx, name, cx, w, sink = 1) {
  const h = assetH(name, w);
  drawA(ctx, name, cx - w / 2, DECK_Y - h + sink, w, h);
  return h;
}

const WorldScene = {
  customCursor: false,
  px: 160, dir: 1, walkT: 0, idleT: 0,
  camX: 0, time: 0,
  smoke: [], stars: null,
  dust: [], dustT: 0,
  _lampGlows: [],

  worldW() { return this.endX() + 80; },
  endX() { return 300 + G.bridge * 200; },
  houseTop() { return DECK_Y - assetH('house_ext', HOUSE_W) * 0.557; },

  enter(opts) {
    this.time = 0;
    if (opts && opts.at !== undefined) this.px = PILING_X[opts.at];
    else if (opts && opts.fromHouse) this.px = 112;
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
      { x: 82, label: 'Enter House', act: () => Game.go(HouseScene, {}) },
      { x: 232, label: 'ClamNet  (sell & shop)', act: () => { Shop.openUI(); } },
      { x: 296, label: 'Workbench  (crack & polish)', act: () => { Bench.openUI(); } },
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
      this.px = clamp(this.px + mv * 92 * dt, 52, this.endX() - 10);
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

    if (G.pendingCrate && G.pendingCrate.t < 10) SND.droneOn(); else SND.droneOff();
  },

  draw(ctx) {
    const cam = this.camX;
    const nite = nightness(G.clock);
    this._lampGlows = [];

    // the painted sea (animated), light horizontal parallax
    drawA(ctx, `bg_surf${Math.floor(this.time * 6) % 8}`, -20 - cam * 0.055, 0, 540, 270);

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

    ctx.save();
    ctx.translate(-cam, 0);
    const endX = this.endX();

    // ---- the pier: ONE trestle module tiled edge to edge -------------------------
    const pierH = assetH('dock_11', SEG_W);
    const pierTop = DECK_Y - pierH * PIER_DECK;
    const pierEnd = Math.max(endX, cam + W + SEG_W);
    for (let x = PIER_START; x < pierEnd; x += SEG_W - 1) {
      drawA(ctx, 'dock_11', x, pierTop, SEG_W, pierH);
    }
    // end-of-pier gate
    if (G.bridge < 3) {
      const gw = 30;
      drawOnDeck(ctx, 'dock_10', endX - 16, gw, 0.035);
    }

    // ---- the house, its platform flush with the pier deck --------------------------
    const hh = drawOnDeck(ctx, 'house_ext', HOUSE_X, HOUSE_W, HOUSE_DECK);
    const hy = DECK_Y - hh * HOUSE_DECK;
    if (G.house >= 2) {
      const bx0 = HOUSE_X + HOUSE_W * 0.30, bx1 = HOUSE_X + HOUSE_W * 0.72, by = hy + hh * 0.10;
      ctx.strokeStyle = '#6a5030'; ctx.lineWidth = PIX;
      ctx.beginPath(); ctx.moveTo(bx0, by); ctx.quadraticCurveTo((bx0 + bx1) / 2, by + 5, bx1, by); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const fx = lerp(bx0, bx1, t), fy = by + Math.sin(t * Math.PI) * 4.5;
        ctx.fillStyle = ['#e8b84e', '#3f8f8f', '#c8352a'][i % 3];
        ctx.beginPath(); ctx.moveTo(fx - 2.4, fy); ctx.lineTo(fx + 2.4, fy); ctx.lineTo(fx, fy + 4); ctx.closePath(); ctx.fill();
      }
    }
    if (G.decor.lights) {
      for (let i = 0; i < 12; i++) {
        const lx = HOUSE_X + HOUSE_W * 0.24 + i * (HOUSE_W * 0.045);
        const ly = hy + hh * 0.06 + Math.sin(i * 1.2) * 2.5;
        ctx.fillStyle = ['#ffd66e', '#ff8a7a', '#8af2ff', '#a0f2b4'][i % 4];
        ctx.fillRect(lx, ly, 1.5, 1.5);
        if (nite > 0.3) {
          ctx.fillStyle = 'rgba(255,220,150,0.12)';
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, TAU); ctx.fill();
        }
      }
    }

    // ---- lamp posts standing on the deck -------------------------------------------
    for (let x = PIER_START + SEG_W * 2.5; x < pierEnd; x += SEG_W * 3) {
      const lh = drawStanding(ctx, 'dock_15', x, 15, 5);
      this._lampGlows.push({ x, y: DECK_Y - lh + 6 });
    }

    // ---- ClamNet: a table on the deck with the laptop on it -------------------------
    const tblH = drawStanding(ctx, 'furn_2', 232, 32, 1);
    const topY = DECK_Y - tblH + 1;
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(225, topY - 10, 15, 10);
    ctx.fillStyle = nite > 0.3 ? '#9fe8ff' : '#5ad2f0';
    ctx.fillRect(226, topY - 9, 13, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(227, topY - 8, 5, 1);
    ctx.fillRect(227, topY - 6, 8, 1);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(120,220,255,0.13)';
      ctx.beginPath(); ctx.arc(232, topY - 5, 14, 0, TAU); ctx.fill();
    }

    // ---- Workbench: desk + barrel + crate on the deck --------------------------------
    const bH = drawStanding(ctx, 'furn_5', 296, 36, 1);
    const bTop = DECK_Y - bH + 1;
    drawAC(ctx, 'shell_clam', 289, bTop - 4, 9);
    drawAC(ctx, 'shell_scallop', 301, bTop - 4, 8);
    drawStanding(ctx, 'furn_9', 318, 14, 1);
    drawStanding(ctx, 'furn_17', 271, 14, 1);

    // drone landing pad
    ctx.fillStyle = 'rgba(60,68,72,0.9)';
    ctx.fillRect(152, DECK_Y - 2, 38, 2);
    ctx.strokeStyle = '#c8cdd0'; ctx.lineWidth = PIX * 2;
    ctx.beginPath(); ctx.ellipse(171, DECK_Y - 1, 12, 1.6, 0, 0, TAU); ctx.stroke();

    this.drawDrone(ctx);

    // smoke + dust
    for (const s of this.smoke) {
      ctx.fillStyle = `rgba(220,220,225,${clamp(s.t / 3, 0, 0.45)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }
    for (const d of this.dust) {
      ctx.fillStyle = `rgba(200,186,150,${clamp(d.t * 1.6, 0, 0.5)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * (1.6 - d.t), 0, TAU); ctx.fill();
    }

    // ---- player: the uploaded otter, with squash & stretch ---------------------------
    const OTTER_WALK = ['o3_4', 'o3_5', 'o3_6', 'o3_7'];
    const OTTER_IDLE = ['o3_0', 'o3_1', 'o3_2', 'o3_3'];
    const walking = this.walkT > 0 && this.idleT < 0.1;
    let frameN = 0, sqx = 1, sqy = 1, hop = 0;
    if (walking) {
      frameN = Math.floor(this.walkT * 0.8) % OTTER_WALK.length;
      const ph = this.walkT * 2.2;
      hop = Math.abs(Math.sin(ph)) * 1.6;
      sqy = 1 + Math.cos(ph * 2) * 0.045;
      sqx = 1 - (sqy - 1) * 0.85;
    } else {
      sqy = 1 + Math.sin(this.time * 2.1) * 0.02;
      sqx = 1 - (sqy - 1) * 0.7;
    }
    ctx.fillStyle = 'rgba(40,20,10,0.18)';
    ctx.beginPath(); ctx.ellipse(this.px, DECK_Y + 0.8, Math.max(3.5, 6 - hop * 0.9), 1.3, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS[walking ? OTTER_WALK[frameN] : OTTER_IDLE[Math.floor(this.time * 2.2) % 4]];
    if (oimg && oimg.width) {
      const oh = 30, ow = oh * oimg.width / oimg.height;
      ctx.save();
      ctx.translate(Math.round(this.px * DPX) / DPX, DECK_Y + 0.5 - hop);
      ctx.scale(this.dir >= 0 ? sqx : -sqx, sqy);   // sheet faces left
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

    ctx.restore();

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
    const padX = 171, padY = DECK_Y - 1;
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