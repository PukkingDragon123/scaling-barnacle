// ---- house interior: sleep, decorate, be cozy -------------------------------
'use strict';

const HouseScene = {
  customCursor: false,
  px: 400, dir: -1, walkT: 0, idleT: 0, time: 0,
  sleeping: false, sleepT: 0,
  aquaFish: [],

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
        G.growth = G.growth.map((g, i) => {
          if (g < 1) G.seeds[i]++;
          return 1;
        });
        Game.save();
        Game.toast(`Day ${G.day} — a fresh crust of clams awaits!`);
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
  },

  draw(ctx) {
    const FLOOR = this.FLOOR;
    const lvl = G.house;
    const wallCol = lvl >= 3 ? '#6e5a44' : (lvl === 2 ? '#5f4e38' : '#52422c');
    const floorCol = lvl >= 3 ? '#7a5c38' : '#66492a';

    // walls
    ctx.fillStyle = wallCol;
    ctx.fillRect(0, 0, W, FLOOR);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let y = 8; y < FLOOR; y += 10) ctx.fillRect(0, y, W, 1);
    // wainscot (lvl2+)
    if (lvl >= 2) {
      ctx.fillStyle = 'rgba(255,240,210,0.08)';
      ctx.fillRect(0, FLOOR - 40, W, 40);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, FLOOR - 41, W, 2);
    }
    // floor
    ctx.fillStyle = floorCol;
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < W; x += 22) ctx.fillRect(x, FLOOR, 1, H - FLOOR);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, FLOOR, W, 2);

    // window with live sky
    const [skyTop, skyHor, waterTop] = skyColors(G.clock);
    const wx = 210, wy = 100, ww = 64, wh = 52;
    ctx.fillStyle = '#2c2013';
    ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
    let grd = ctx.createLinearGradient(0, wy, 0, wy + wh * 0.6);
    grd.addColorStop(0, skyTop); grd.addColorStop(1, skyHor);
    ctx.fillStyle = grd;
    ctx.fillRect(wx, wy, ww, wh * 0.6);
    ctx.fillStyle = waterTop;
    ctx.fillRect(wx, wy + wh * 0.6, ww, wh * 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 3; i++)
      ctx.fillRect(wx + 6 + i * 18 + Math.sin(this.time + i) * 4, wy + wh * 0.65 + i * 6, 10, 1);
    const nite = nightness(G.clock);
    if (nite > 0.3) {
      ctx.fillStyle = 'rgba(230,238,255,0.9)';
      ctx.fillRect(wx + 12, wy + 8, 2, 2); ctx.fillRect(wx + 40, wy + 5, 1, 1); ctx.fillRect(wx + 52, wy + 14, 1, 1);
    }
    ctx.strokeStyle = '#2c2013'; ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();

    // ---- bed --------------------------------------------------------------------
    const bedW = lvl >= 2 ? 58 : 48;
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(52, FLOOR - 18, bedW, 18);
    ctx.fillStyle = lvl >= 3 ? '#7a4e9e' : '#4a6e9e';
    ctx.fillRect(54, FLOOR - 22, bedW - 4, 10);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(56, FLOOR - 24, 16, 8);
    ctx.fillStyle = '#2c2013';
    ctx.fillRect(50, FLOOR - 26, 4, 26);
    ctx.fillRect(52 + bedW - 2, FLOOR - 22, 4, 22);

    // ---- decor -------------------------------------------------------------------
    if (G.decor.rug) {
      ctx.fillStyle = '#3f7a5f';
      ctx.beginPath(); ctx.ellipse(240, FLOOR + 20, 55, 12, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2c5a44';
      ctx.beginPath(); ctx.ellipse(240, FLOOR + 20, 44, 8, 0, 0, TAU); ctx.stroke();
    }
    if (G.decor.lamp) {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(148, FLOOR - 34, 3, 34);
      ctx.fillStyle = '#e8b84e';
      ctx.beginPath(); ctx.moveTo(140, FLOOR - 34); ctx.lineTo(159, FLOOR - 34); ctx.lineTo(154, FLOOR - 44); ctx.lineTo(145, FLOOR - 44); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,214,120,0.12)';
      ctx.beginPath(); ctx.arc(150, FLOOR - 30, 26, 0, TAU); ctx.fill();
    }
    if (G.decor.poster) {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(300, 96, 34, 44);
      ctx.fillStyle = '#d6543c';
      ctx.fillRect(310, 106, 14, 10);
      ctx.fillStyle = '#2a1410';
      ctx.fillRect(313, 109, 2, 2); ctx.fillRect(319, 109, 2, 2);
      text(ctx, 'HANG IN', 317, 122, { size: 5, color: '#4a3820', align: 'center', shadow: false });
      text(ctx, 'THERE', 317, 129, { size: 5, color: '#4a3820', align: 'center', shadow: false });
    }
    if (G.decor.plant) {
      ctx.fillStyle = '#a85a32';
      ctx.fillRect(104, FLOOR - 12, 14, 12);
      ctx.strokeStyle = '#3f8f4f'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(111, FLOOR - 12);
        ctx.quadraticCurveTo(111 + i * 7, FLOOR - 26 + Math.sin(this.time * 1.2 + i) * 1.5, 111 + i * 9, FLOOR - 30);
        ctx.stroke();
      }
    }
    if (G.decor.aquarium) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(312, FLOOR - 14, 40, 14);
      ctx.fillStyle = '#123c50';
      ctx.fillRect(310, FLOOR - 34, 44, 20);
      ctx.fillStyle = '#1e6480';
      ctx.fillRect(312, FLOOR - 32, 40, 16);
      for (const f of this.aquaFish) {
        ctx.fillStyle = '#f2a83c';
        ctx.fillRect(310 + f.x, FLOOR - 32 + f.y, 3, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(314, FLOOR - 31, 8, 1);
    }
    if (G.decor.gramophone) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(360, FLOOR - 16, 24, 16);
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(362, FLOOR - 24, 12, 8);
      ctx.fillStyle = '#c8a03c';
      ctx.beginPath();
      ctx.moveTo(372, FLOOR - 24); ctx.lineTo(384, FLOOR - 38); ctx.lineTo(376, FLOOR - 40); ctx.lineTo(370, FLOOR - 26);
      ctx.closePath(); ctx.fill();
      if (G.musicOn) {
        const nt = (this.time * 1.5) % 2;
        text(ctx, '~', 384 + nt * 8, FLOOR - 48 - nt * 8, { size: 8, color: `rgba(255,240,200,${1 - nt / 2})`, shadow: false });
      }
    }
    if (G.decor.trophy) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(168, 118, 30, 4);
      ctx.drawImage(SPR.icons.clam, 178, 108);
      ctx.fillStyle = 'rgba(255,220,100,0.35)';
      ctx.fillRect(178, 108, 8, 7);
      if (Math.sin(this.time * 3) > 0.8) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(177 + irand(0, 9), 107 + irand(0, 7), 1, 1);
      }
    }

    // door
    ctx.fillStyle = '#3a2a14';
    ctx.fillRect(416, FLOOR - 62, 30, 62);
    ctx.fillStyle = '#57401f';
    ctx.fillRect(419, FLOOR - 59, 24, 59);
    ctx.fillStyle = '#c8a03c';
    ctx.fillRect(421, FLOOR - 34, 3, 3);

    // player
    const frames = this.dir >= 0 ? SPR.otterR : SPR.otterL;
    let frame = 0;
    if (this.walkT > 0 && this.idleT < 0.1) frame = 1 + (Math.floor(this.walkT) % 2);
    ctx.drawImage(frames[frame], Math.round(this.px - 8), FLOOR - 16);

    // prompt
    let best = null, bd = 26;
    for (const s of this.spots()) {
      const d = Math.abs(this.px - s.x);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) text(ctx, `[E] ${best.label}`, clamp(this.px, 70, W - 70), FLOOR - 36, { size: 7, color: '#fff8e0', align: 'center' });

    // cozy night tint indoors
    if (nite > 0.05 && !G.decor.lamp) {
      ctx.fillStyle = `rgba(10,10,30,${nite * 0.22})`;
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
