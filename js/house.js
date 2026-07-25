// ---- house interior: sleep, decorate, be cozy ---------------------------------
'use strict';

const HouseScene = {
  customCursor: false,
  px: 400, dir: -1, walkT: 0, idleT: 0, time: 0,
  sleeping: false, sleepT: 0,
  aquaFish: [],
  embers: [],

  enter(opts) {
    this.time = 0;
    this.sleeping = false;
    if (opts && opts.wake) {
      this.px = 90;
      Game.toast('You wake up at home. Your bag is gone...');
      Game.toast(`Day ${G.day}.`);
    } else {
      this.px = 410; this.dir = -1;
    }
    if (!this.aquaFish.length) {
      for (let i = 0; i < 3; i++) this.aquaFish.push({ x: rand(6, 26), y: rand(4, 14), vx: rand(4, 9) * (Math.random() < 0.5 ? 1 : -1) });
    }
    SND.setScene('house');
  },

  FLOOR: 210,

  spots() {
    const s = [
      { x: 78, label: 'Sleep  (next day, clams regrow)', act: () => this.sleep() },
      { x: 430, label: 'Go Outside', act: () => Game.go(WorldScene, { fromHouse: true }) },
    ];
    if (G.decor.gramophone) {
      s.push({
        x: 368, label: G.musicOn ? 'Gramophone: ON' : 'Gramophone: OFF',
        act: () => { G.musicOn = !G.musicOn; SND.click(); Game.toast(G.musicOn ? 'Music on.' : 'Music off.'); },
      });
    }
    return s;
  },

  sleep() {
    if (this.sleeping) return;
    this.sleeping = true;
    this.sleepT = 0;
    SND.sleepy();
  },

  update(dt) {
    this.time += dt;
    if (this.sleeping) {
      this.sleepT += dt;
      if (this.sleepT > 2.2) {
        this.sleeping = false;
        G.day++;
        G.clock = 0.28;
        G.hearts = G.maxHearts;
        Game.newDayRegrow(true);
        Game.save();
        Game.toast(`Day ${G.day} — the beds regrew overnight... some of them.`);
      }
      return;
    }
    let mv = 0;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    if (mv !== 0) {
      this.dir = mv;
      this.px = clamp(this.px + mv * 92 * dt, 62, 438);
      this.walkT += dt * 9;
      this.idleT = 0;
    } else this.idleT += dt;

    if (Input.p('KeyE') || Input.p('Space')) {
      let best = null, bd = 26;
      for (const s of this.spots()) {
        const d = Math.abs(this.px - s.x);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { SND.click(); best.act(); return; }
    }

    for (const f of this.aquaFish) {
      f.x += f.vx * dt;
      if (f.x < 4 || f.x > 28) f.vx *= -1;
      f.y += Math.sin(this.time * 2 + f.x) * 2 * dt;
      f.y = clamp(f.y, 3, 15);
    }

    // stove embers drifting up the pipe
    if (Math.random() < dt * 3) {
      this.embers.push({ x: 186 + rand(-2, 2), y: this.FLOOR - 24, vy: rand(-18, -10), t: rand(0.4, 0.9) });
    }
    for (const e of this.embers) { e.y += e.vy * dt; e.x += Math.sin(this.time * 6 + e.y) * 0.3; e.t -= dt; }
    this.embers = this.embers.filter(e => e.t > 0);
  },

  draw(ctx) {
    const FLOOR = this.FLOOR;
    const lvl = G.house;
    const nite = nightness(G.clock);
    const wallA = lvl >= 3 ? '#6e5a44' : (lvl === 2 ? '#5f4e38' : '#52422c');
    const wallB = lvl >= 3 ? '#645038' : (lvl === 2 ? '#554530' : '#493a24');
    const floorA = lvl >= 3 ? '#7a5c38' : '#66492a';
    const floorB = lvl >= 3 ? '#6f5230' : '#5c4124';

    // ---- walls: vertical paneling -------------------------------------------------
    for (let x = 0, i = 0; x < W; x += 24, i++) {
      ctx.fillStyle = i % 2 ? wallB : wallA;
      ctx.fillRect(x, 0, 24, FLOOR);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, 0, PIX * 2, FLOOR);
      const r = mulberry32(i * 51)();
      if (r > 0.7) {
        ctx.fillStyle = 'rgba(30,20,10,0.4)';
        ctx.beginPath(); ctx.ellipse(x + 6 + r * 12, 40 + r * 130, 1.6, 1, 0.3, 0, TAU); ctx.fill();
      }
    }
    // wainscot (lvl2+)
    if (lvl >= 2) {
      ctx.fillStyle = 'rgba(255,240,210,0.07)';
      ctx.fillRect(0, FLOOR - 42, W, 42);
      ctx.fillStyle = '#3a2c18';
      ctx.fillRect(0, FLOOR - 43, W, 2.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, FLOOR - 43, W, PIX);
    }
    // ceiling beam
    ctx.fillStyle = '#3a2c18';
    ctx.fillRect(0, 0, W, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 6, W, 1.5);
    ctx.fillStyle = '#4a3820';
    for (let x = 20; x < W; x += 70) ctx.fillRect(x, 0, 5, 7);

    // ---- floor: planks with grain -------------------------------------------------
    for (let x = 0, i = 0; x < W; x += 22, i++) {
      const r = mulberry32(i * 77)();
      ctx.fillStyle = r > 0.5 ? floorA : floorB;
      ctx.fillRect(x, FLOOR, 22, H - FLOOR);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, FLOOR, 1, H - FLOOR);
      ctx.fillStyle = 'rgba(40,26,12,0.35)';
      ctx.fillRect(x + 4 + r * 10, FLOOR + 8 + r * 30, 8, PIX * 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, FLOOR, W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, FLOOR - 1, W, 1);

    // ---- window with live sky, curtains, sill shells ------------------------------
    const [skyTopC, skyHorC, waterTopC] = skyColors(G.clock);
    const wx = 210, wy = 96, ww = 64, wh = 54;
    // frame
    ctx.fillStyle = '#2c2013';
    ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(wx - 3.5, wy - 3.5, ww + 7, wh + 7);
    // view
    let grd = ctx.createLinearGradient(0, wy, 0, wy + wh * 0.6);
    grd.addColorStop(0, skyTopC); grd.addColorStop(1, skyHorC);
    ctx.fillStyle = grd;
    ctx.fillRect(wx, wy, ww, wh * 0.6);
    ctx.fillStyle = waterTopC;
    ctx.fillRect(wx, wy + wh * 0.6, ww, wh * 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 3; i++)
      ctx.fillRect(wx + 6 + i * 18 + Math.sin(this.time + i) * 4, wy + wh * 0.65 + i * 6, 10, 1);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(230,238,255,0.9)';
      ctx.fillRect(wx + 12, wy + 8, 1.5, 1.5); ctx.fillRect(wx + 40, wy + 5, 1, 1); ctx.fillRect(wx + 52, wy + 14, 1, 1);
      ctx.fillStyle = '#e8ecf2';
      ctx.beginPath(); ctx.arc(wx + 48, wy + 10, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = skyTopC;
      ctx.beginPath(); ctx.arc(wx + 50, wy + 9, 3.4, 0, TAU); ctx.fill();
    } else if (G.clock > 0.1 && G.clock < 0.6) {
      // little sun in view
      ctx.fillStyle = '#fff2c8';
      ctx.beginPath(); ctx.arc(wx + 14, wy + 10, 4, 0, TAU); ctx.fill();
    }
    // panes
    ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2);
    ctx.stroke();
    // curtains with scalloped hems
    ctx.fillStyle = '#a85a42';
    ctx.beginPath();
    ctx.moveTo(wx - 5, wy - 5);
    ctx.quadraticCurveTo(wx + 8, wy + wh * 0.3, wx + 2, wy + wh + 4);
    ctx.lineTo(wx - 5, wy + wh + 4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wx + ww + 5, wy - 5);
    ctx.quadraticCurveTo(wx + ww - 8, wy + wh * 0.3, wx + ww - 2, wy + wh + 4);
    ctx.lineTo(wx + ww + 5, wy + wh + 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c86a4a';
    ctx.fillRect(wx - 5, wy - 5, 7, 4);
    ctx.fillRect(wx + ww - 2, wy - 5, 7, 4);
    // curtain rod
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(wx - 9, wy - 7, ww + 18, 2);
    ctx.beginPath(); ctx.arc(wx - 9, wy - 6, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(wx + ww + 9, wy - 6, 1.5, 0, TAU); ctx.fill();
    // sill with tiny shell collection
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(wx - 7, wy + wh + 4, ww + 14, 3);
    drawSpr(ctx, SPR.icons.clam, wx + 8, wy + wh - 1);
    drawSpr(ctx, SPR.icons.pearl, wx + 44, wy + wh - 1);

    // ---- bed with quilt ------------------------------------------------------------
    const bedW = lvl >= 2 ? 58 : 48;
    // frame
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(52, FLOOR - 18, bedW, 18);
    ctx.fillStyle = '#2c2013';
    ctx.fillRect(50, FLOOR - 28, 4, 28);
    ctx.fillRect(52 + bedW - 2, FLOOR - 22, 4, 22);
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(50, FLOOR - 28, 1.5, 28);
    ctx.fillRect(52 + bedW - 2, FLOOR - 22, 1.5, 22);
    // quilt: checkered patches
    const qa = lvl >= 3 ? '#7a4e9e' : '#4a6e9e';
    const qb = lvl >= 3 ? '#9068b8' : '#6288b8';
    for (let qx = 0; qx < bedW - 4; qx += 6) {
      for (let qy = 0; qy < 10; qy += 5) {
        ctx.fillStyle = ((qx / 6 + qy / 5) % 2) ? qa : qb;
        ctx.fillRect(54 + qx, FLOOR - 22 + qy, Math.min(6, bedW - 4 - qx), 5);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(54, FLOOR - 13, bedW - 4, 1);
    // pillow
    ctx.fillStyle = '#e8dcc0';
    ctx.beginPath(); ctx.ellipse(64, FLOOR - 22, 9, 4, -0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f4ecd8';
    ctx.beginPath(); ctx.ellipse(63, FLOOR - 23, 7, 2.8, -0.1, 0, TAU); ctx.fill();

    // ---- wood stove (always here — it's cold out at sea) ---------------------------
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(168, FLOOR - 26, 34, 26);
    ctx.fillStyle = '#2c2c32';
    ctx.fillRect(170, FLOOR - 24, 30, 22);
    // legs
    ctx.fillStyle = '#101014';
    ctx.fillRect(170, FLOOR - 3, 4, 3); ctx.fillRect(196, FLOOR - 3, 4, 3);
    // pipe
    ctx.fillStyle = '#26262c';
    ctx.fillRect(182, 7, 9, FLOOR - 33);
    ctx.fillStyle = '#33333a';
    ctx.fillRect(182, 7, 3, FLOOR - 33);
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(180, FLOOR - 33, 13, 3);
    // fire door with flicker
    const flick = 0.75 + Math.sin(this.time * 11) * 0.12 + Math.sin(this.time * 23) * 0.08;
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(175, FLOOR - 20, 14, 12);
    ctx.fillStyle = `rgba(255,140,40,${flick})`;
    ctx.fillRect(176.5, FLOOR - 18.5, 11, 9);
    ctx.fillStyle = `rgba(255,220,120,${flick})`;
    ctx.beginPath();
    ctx.moveTo(179, FLOOR - 10);
    ctx.quadraticCurveTo(180.5, FLOOR - 16 - Math.sin(this.time * 9) * 1.5, 182, FLOOR - 11);
    ctx.quadraticCurveTo(183.5, FLOOR - 17 + Math.sin(this.time * 13) * 1.5, 185, FLOOR - 10);
    ctx.closePath(); ctx.fill();
    // grill bars
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(175, FLOOR - 17, 14, 1);
    ctx.fillRect(175, FLOOR - 13.5, 14, 1);
    // warm glow
    ctx.fillStyle = `rgba(255,150,60,${0.08 + nite * 0.08})`;
    ctx.beginPath(); ctx.arc(185, FLOOR - 14, 30, 0, TAU); ctx.fill();
    // embers
    for (const e of this.embers) {
      ctx.fillStyle = `rgba(255,${140 + e.t * 80},60,${clamp(e.t, 0, 0.8)})`;
      ctx.fillRect(e.x, e.y, PIX * 2, PIX * 2);
    }
    // log basket beside
    ctx.fillStyle = '#5f4322';
    ctx.fillRect(206, FLOOR - 8, 14, 8);
    ctx.fillStyle = '#755428';
    ctx.beginPath(); ctx.arc(210, FLOOR - 8, 2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(215, FLOOR - 8, 2, 0, TAU); ctx.fill();

    // ---- decor -----------------------------------------------------------------------
    if (G.decor.rug) {
      ctx.fillStyle = '#3f7a5f';
      ctx.beginPath(); ctx.ellipse(280, FLOOR + 22, 58, 13, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2c5a44'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(280, FLOOR + 22, 47, 9, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#5a9a7c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(280, FLOOR + 22, 36, 6, 0, 0, TAU); ctx.stroke();
      // fringe
      ctx.fillStyle = '#2c5a44';
      for (let a = 0.15; a < Math.PI - 0.15; a += 0.18) {
        ctx.fillRect(280 - Math.cos(a) * 58, FLOOR + 22 + Math.sin(a) * 13, 1, 2.5);
      }
    }
    if (G.decor.lamp) {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(140, FLOOR - 34, 3, 34);
      ctx.fillStyle = '#6f5630';
      ctx.fillRect(140, FLOOR - 34, 1, 34);
      ctx.fillStyle = '#e8b84e';
      ctx.beginPath(); ctx.moveTo(132, FLOOR - 34); ctx.lineTo(151, FLOOR - 34); ctx.lineTo(146, FLOOR - 45); ctx.lineTo(137, FLOOR - 45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2cc72';
      ctx.beginPath(); ctx.moveTo(134, FLOOR - 34); ctx.lineTo(141, FLOOR - 34); ctx.lineTo(139, FLOOR - 44); ctx.lineTo(137.5, FLOOR - 44); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255,214,120,${0.1 + nite * 0.1})`;
      ctx.beginPath(); ctx.arc(141.5, FLOOR - 30, 26, 0, TAU); ctx.fill();
      // pull chain
      ctx.fillStyle = '#c8a03c';
      ctx.fillRect(148, FLOOR - 33, PIX * 2, 4);
    }
    if (G.decor.poster) {
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(298, 94, 38, 48);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(300, 96, 34, 44);
      // the crab, hanging in there (from a tiny rope)
      ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(317, 100); ctx.lineTo(317, 108); ctx.stroke();
      drawSpr(ctx, SPR.crab[0], 313, 108);
      text(ctx, 'HANG IN', 317, 122, { size: 5, color: '#4a3820', align: 'center', shadow: false });
      text(ctx, 'THERE', 317, 129, { size: 5, color: '#4a3820', align: 'center', shadow: false });
      ctx.fillStyle = '#c8a03c';
      ctx.fillRect(316, 95, 2, 2);
    }
    if (G.decor.plant) {
      ctx.fillStyle = '#a85a32';
      ctx.beginPath(); ctx.moveTo(106, FLOOR - 12); ctx.lineTo(122, FLOOR - 12); ctx.lineTo(120, FLOOR); ctx.lineTo(108, FLOOR); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c9713f';
      ctx.fillRect(106, FLOOR - 12, 16, 2.5);
      ctx.strokeStyle = '#3f8f4f'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(114, FLOOR - 12);
        ctx.quadraticCurveTo(114 + i * 7, FLOOR - 26 + Math.sin(this.time * 1.2 + i) * 1.5, 114 + i * 9, FLOOR - 30);
        ctx.stroke();
      }
      ctx.strokeStyle = '#5ab46a'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(114, FLOOR - 12);
      ctx.quadraticCurveTo(114, FLOOR - 24, 114 + Math.sin(this.time) * 2, FLOOR - 32);
      ctx.stroke();
    }
    if (G.decor.aquarium) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(312, FLOOR - 14, 40, 14);
      ctx.fillStyle = '#123c50';
      ctx.fillRect(310, FLOOR - 34, 44, 20);
      ctx.fillStyle = '#1e6480';
      ctx.fillRect(312, FLOOR - 32, 40, 16);
      // gravel + plant
      ctx.fillStyle = '#c9a06a';
      ctx.fillRect(312, FLOOR - 18, 40, 2);
      ctx.strokeStyle = '#2c8a5f'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(345, FLOOR - 18);
      ctx.quadraticCurveTo(347 + Math.sin(this.time * 2), FLOOR - 24, 345, FLOOR - 29);
      ctx.stroke();
      for (const f of this.aquaFish) {
        ctx.fillStyle = '#f2a83c';
        ctx.fillRect(310 + f.x, FLOOR - 32 + f.y, 3, 2);
        ctx.fillStyle = '#c87a1e';
        ctx.fillRect(310 + f.x - 1.5, FLOOR - 32 + f.y + 0.5, 1.5, 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(314, FLOOR - 31, 8, 1);
      // bubbles
      if (Math.sin(this.time * 3) > 0) {
        ctx.strokeStyle = 'rgba(200,230,240,0.5)'; ctx.lineWidth = PIX * 2;
        ctx.beginPath(); ctx.arc(348, FLOOR - 26 - (this.time * 8 % 8), 1, 0, TAU); ctx.stroke();
      }
    }
    if (G.decor.gramophone) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(360, FLOOR - 16, 24, 16);
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(360, FLOOR - 16, 24, 2);
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(362, FLOOR - 24, 12, 8);
      ctx.fillStyle = '#6f5630';
      ctx.fillRect(362, FLOOR - 24, 12, 1.5);
      // horn
      ctx.fillStyle = '#c8a03c';
      ctx.beginPath();
      ctx.moveTo(372, FLOOR - 24); ctx.lineTo(385, FLOOR - 39); ctx.lineTo(376, FLOOR - 41); ctx.lineTo(370, FLOOR - 26);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e0c46e';
      ctx.beginPath(); ctx.ellipse(380.5, FLOOR - 40, 5.5, 2.2, -0.7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a6a1c';
      ctx.beginPath(); ctx.ellipse(380.5, FLOOR - 40, 3, 1.1, -0.7, 0, TAU); ctx.fill();
      // spinning record
      if (G.musicOn) {
        ctx.fillStyle = '#14100c';
        ctx.beginPath(); ctx.ellipse(368, FLOOR - 24.5, 4.5, 1.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c8352a';
        ctx.fillRect(367 + Math.cos(this.time * 5) * 2, FLOOR - 25, 1, 1);
        const nt = (this.time * 1.5) % 2;
        text(ctx, '~', 386 + nt * 8, FLOOR - 48 - nt * 8, { size: 8, color: `rgba(255,240,200,${1 - nt / 2})`, shadow: false });
      }
    }
    if (G.decor.trophy) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(130, 114, 34, 4);
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(132, 118, 3, 4); ctx.fillRect(159, 118, 3, 4);
      // golden clam on a little plinth
      ctx.fillStyle = '#8a6210';
      ctx.fillRect(141, 110, 12, 4);
      drawSpr(ctx, SPR.icons.clam, 143, 103);
      ctx.fillStyle = 'rgba(255,220,100,0.4)';
      ctx.fillRect(143, 103, 8, 5);
      if (Math.sin(this.time * 3) > 0.8) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(142 + irand(0, 10), 102 + irand(0, 6), 1, 1);
      }
    }

    // ---- door ------------------------------------------------------------------------
    ctx.fillStyle = '#2c1e0e';
    ctx.fillRect(414, FLOOR - 64, 34, 64);
    ctx.fillStyle = '#57401f';
    ctx.fillRect(417, FLOOR - 61, 28, 61);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let dx = 422; dx < 445; dx += 6) ctx.fillRect(dx, FLOOR - 61, PIX, 61);
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(417, FLOOR - 52, 9, 2);
    ctx.fillRect(417, FLOOR - 16, 9, 2);
    ctx.fillStyle = '#e0b44c';
    ctx.fillRect(420, FLOOR - 34, 2.5, 2.5);
    // porthole
    ctx.fillStyle = '#8a6a40';
    ctx.beginPath(); ctx.arc(431, FLOOR - 48, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = nite > 0.3 ? '#1a2440' : '#9fc4d4';
    ctx.beginPath(); ctx.arc(431, FLOOR - 48, 3.4, 0, TAU); ctx.fill();

    // ---- player ------------------------------------------------------------------------
    const frames = this.dir >= 0 ? SPR.otterR : SPR.otterL;
    let frame = 0;
    if (this.walkT > 0 && this.idleT < 0.1) frame = 1 + (Math.floor(this.walkT) % 2);
    else if ((this.time % 3.6) < 0.13) frame = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.px, FLOOR + 0.5, 6, 1.5, 0, 0, TAU); ctx.fill();
    drawSpr(ctx, frames[frame], this.px - 6, FLOOR - 16.5);

    // prompt
    let best = null, bd = 26;
    for (const s of this.spots()) {
      const d = Math.abs(this.px - s.x);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      const label = (TouchUI.enabled ? '' : '[E] ') + best.label;
      const w = textWidth(ctx, label, 7) + 12;
      const bx = clamp(this.px, w / 2 + 4, W - w / 2 - 4);
      uiPanel(ctx, bx - w / 2, FLOOR - 40, w, 13, 0.85);
      text(ctx, label, bx, FLOOR - 37, { size: 7, color: '#fff8e0', align: 'center' });
    }

    // cozy dusk tint indoors — the stove and lamp keep it warm
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(10,10,30,${nite * (G.decor.lamp ? 0.14 : 0.2)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // sleep fade
    if (this.sleeping) {
      const a = this.sleepT < 1.1 ? this.sleepT / 1.1 : (2.2 - this.sleepT) / 1.1;
      ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      if (this.sleepT > 0.6 && this.sleepT < 1.6)
        text(ctx, 'Zzz...', W / 2, H / 2 - 6, { size: 12, color: '#c8d4e8', align: 'center' });
    }
  },
};
