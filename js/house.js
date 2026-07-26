// ---- house interior: the painted cutaway, furnished with the uploaded props ----
'use strict';

const HouseScene = {
  customCursor: false,
  px: 380, dir: -1, walkT: 0, idleT: 0, time: 0,
  sleeping: false, sleepT: 0,
  aquaFish: [],
  embers: [],

  FLOOR: 143,

  enter(opts) {
    this.time = 0;
    this.sleeping = false;
    if (opts && opts.wake) {
      this.px = 150;
      Game.toast('You wake up at home. Your bag is gone...');
      Game.toast(`Day ${G.day}.`);
    } else {
      this.px = 400; this.dir = -1;
    }
    if (!this.aquaFish.length) {
      for (let i = 0; i < 3; i++) this.aquaFish.push({ x: rand(6, 26), y: rand(4, 14), vx: rand(4, 9) * (Math.random() < 0.5 ? 1 : -1) });
    }
    SND.setScene('house');
  },

  spots() {
    const s = [
      { x: 128, label: 'Sleep  (next day, beds regrow)', act: () => this.sleep() },
      { x: 428, label: 'Go Outside', act: () => Game.go(WorldScene, { fromHouse: true }) },
    ];
    if (G.decor.gramophone) {
      s.push({
        x: 330, label: G.musicOn ? 'Gramophone: ON' : 'Gramophone: OFF',
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
      this.px = clamp(this.px + mv * 92 * dt, 108, 446);
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
    if (Math.random() < dt * 2.5) {
      this.embers.push({ x: 226 + rand(-2, 2), y: this.FLOOR - 26, vy: rand(-16, -9), t: rand(0.4, 0.9) });
    }
    for (const e of this.embers) { e.y += e.vy * dt; e.x += Math.sin(this.time * 6 + e.y) * 0.3; e.t -= dt; }
    this.embers = this.embers.filter(e => e.t > 0);
  },

  draw(ctx) {
    const FLOOR = this.FLOOR;
    const nite = nightness(G.clock);

    // sea behind the cutaway
    drawA(ctx, `bg_surf${Math.floor(this.time * 7) % 10}`, -30, 0, 540, 270);
    if (nite > 0.2) {
      ctx.fillStyle = `rgba(8,12,38,${nite * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    // the painted interior
    drawA(ctx, 'house_int', 0, 0, 480);

    // ---- furniture (uploaded props) -----------------------------------------------
    const put = (n, x, w, dy = 0) => {
      const h = assetH(n, w);
      drawA(ctx, n, x, FLOOR - h + dy, w, h);
      return h;
    };
    put('furn_0', 106, 58);                 // bed
    put('furn_2', 214, 48);                 // table
    drawAC(ctx, 'furn_14', 238, FLOOR - assetH('furn_2', 48) - 7, 11);   // lantern on the table
    put('furn_3', 266, 21);                 // chair
    put('furn_9', 370, 27);                 // barrel
    put('furn_15', 400, 15);                // bucket
    put('furn_17', 344, 22);                // tackle box
    // wall net + shelf with shells
    drawA(ctx, 'furn_12', 282, 88, 48);
    drawA(ctx, 'furn_8', 148, 110, 46);
    drawAC(ctx, 'shell_scallop', 162, 109, 9);
    drawAC(ctx, 'shell_mussel', 176, 109, 9);
    // oar leaning by the door
    ctx.save();
    ctx.translate(102, FLOOR - 2);
    ctx.rotate(-0.32);
    drawA(ctx, 'furn_16', -4, -34, 8, 34);
    ctx.restore();

    // stove glow (little coded fire keeps the room warm)
    const flick = 0.75 + Math.sin(this.time * 11) * 0.12 + Math.sin(this.time * 23) * 0.08;
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(214, FLOOR - 24, 26, 24);
    ctx.fillStyle = '#2c2c32';
    ctx.fillRect(216, FLOOR - 22, 22, 20);
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(219, FLOOR - 18, 16, 11);
    ctx.fillStyle = `rgba(255,140,40,${flick})`;
    ctx.fillRect(220.5, FLOOR - 16.5, 13, 8);
    ctx.fillStyle = `rgba(255,220,120,${flick})`;
    ctx.beginPath();
    ctx.moveTo(223, FLOOR - 9);
    ctx.quadraticCurveTo(225, FLOOR - 15 - Math.sin(this.time * 9) * 1.5, 227, FLOOR - 10);
    ctx.quadraticCurveTo(229, FLOOR - 16 + Math.sin(this.time * 13) * 1.5, 231, FLOOR - 9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(219, FLOOR - 15, 16, 1);
    ctx.fillStyle = `rgba(255,150,60,${0.07 + nite * 0.08})`;
    ctx.beginPath(); ctx.arc(227, FLOOR - 13, 28, 0, TAU); ctx.fill();
    for (const e of this.embers) {
      ctx.fillStyle = `rgba(255,${140 + e.t * 80},60,${clamp(e.t, 0, 0.8)})`;
      ctx.fillRect(e.x, e.y, PIX * 2, PIX * 2);
    }

    // ---- decor -----------------------------------------------------------------------
    if (G.decor.rug) {
      ctx.fillStyle = '#3f7a5f';
      ctx.beginPath(); ctx.ellipse(290, FLOOR + 8, 52, 10, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2c5a44'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(290, FLOOR + 8, 42, 7, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#5a9a7c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(290, FLOOR + 8, 32, 4.5, 0, 0, TAU); ctx.stroke();
    }
    if (G.decor.lamp) {
      put('furn_4', 186, 20);
      drawAC(ctx, 'furn_14', 196, FLOOR - assetH('furn_4', 20) - 7, 11);
      ctx.fillStyle = `rgba(255,214,120,${0.1 + nite * 0.12})`;
      ctx.beginPath(); ctx.arc(196, FLOOR - 22, 24, 0, TAU); ctx.fill();
    }
    if (G.decor.poster) {
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(196, 96, 38, 48);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(198, 98, 34, 44);
      ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(215, 102); ctx.lineTo(215, 110); ctx.stroke();
      drawSpr(ctx, SPR.crab[0], 211, 110);
      text(ctx, 'HANG IN', 215, 124, { size: 5, color: '#4a3820', align: 'center', shadow: false });
      text(ctx, 'THERE', 215, 131, { size: 5, color: '#4a3820', align: 'center', shadow: false });
    }
    if (G.decor.plant) {
      ctx.fillStyle = '#a85a32';
      ctx.beginPath(); ctx.moveTo(444, FLOOR - 12); ctx.lineTo(458, FLOOR - 12); ctx.lineTo(456, FLOOR); ctx.lineTo(446, FLOOR); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3f8f4f'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(451, FLOOR - 12);
        ctx.quadraticCurveTo(451 + i * 6, FLOOR - 24 + Math.sin(this.time * 1.2 + i) * 1.5, 451 + i * 8, FLOOR - 27);
        ctx.stroke();
      }
    }
    if (G.decor.aquarium) {
      ctx.fillStyle = '#3a2a14';
      ctx.fillRect(300, FLOOR - 14, 40, 14);
      ctx.fillStyle = '#123c50';
      ctx.fillRect(298, FLOOR - 34, 44, 20);
      ctx.fillStyle = '#1e6480';
      ctx.fillRect(300, FLOOR - 32, 40, 16);
      ctx.fillStyle = '#c9a06a';
      ctx.fillRect(300, FLOOR - 18, 40, 2);
      for (const f of this.aquaFish) {
        ctx.fillStyle = '#f2a83c';
        ctx.fillRect(298 + f.x, FLOOR - 32 + f.y, 3, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(302, FLOOR - 31, 8, 1);
    }
    if (G.decor.gramophone) {
      put('furn_10', 318, 26);
      ctx.fillStyle = '#c8a03c';
      ctx.beginPath();
      ctx.moveTo(330, FLOOR - assetH('furn_10', 26) - 2);
      ctx.lineTo(342, FLOOR - assetH('furn_10', 26) - 16);
      ctx.lineTo(334, FLOOR - assetH('furn_10', 26) - 18);
      ctx.lineTo(327, FLOOR - assetH('furn_10', 26) - 4);
      ctx.closePath(); ctx.fill();
      if (G.musicOn) {
        const nt = (this.time * 1.5) % 2;
        text(ctx, '~', 344 + nt * 8, FLOOR - 52 - nt * 8, { size: 8, color: `rgba(255,240,200,${1 - nt / 2})`, shadow: false });
      }
    }
    if (G.decor.trophy) {
      drawA(ctx, 'furn_8', 246, 112, 34);
      drawAC(ctx, 'shell_clam', 260, 108, 12);
      ctx.fillStyle = 'rgba(255,220,100,0.4)';
      ctx.fillRect(254, 103, 12, 9);
      if (Math.sin(this.time * 3) > 0.8) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(253 + irand(0, 12), 102 + irand(0, 8), 1, 1);
      }
    }

    // ---- player -------------------------------------------------------------------------
    const walking = this.walkT > 0 && this.idleT < 0.1;
    let frameN = 0, sqx = 1, sqy = 1, hop = 0;
    if (walking) {
      frameN = Math.floor(this.walkT * 0.9) % 4;
      const ph = this.walkT * 2.2;
      hop = Math.abs(Math.sin(ph)) * 1.6;
      sqy = 1 + Math.cos(ph * 2) * 0.045;
      sqx = 1 - (sqy - 1) * 0.85;
    } else {
      sqy = 1 + Math.sin(this.time * 2.1) * 0.02;
      sqx = 1 - (sqy - 1) * 0.7;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.px, FLOOR + 0.6, Math.max(4, 7 - hop * 0.9), 1.6, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS['otter_' + frameN];
    if (oimg && oimg.width) {
      const oh = 27, ow = oh * oimg.width / oimg.height;
      ctx.save();
      ctx.translate(Math.round(this.px * DPX) / DPX, FLOOR + 0.5 - hop);
      ctx.scale(this.dir >= 0 ? -sqx : sqx, sqy);
      ctx.drawImage(oimg, -ow / 2, -oh + 0.5, ow, oh);
      ctx.restore();
    }

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
      uiPanel(ctx, bx - w / 2, FLOOR - 44, w, 13, 0.85);
      text(ctx, label, bx, FLOOR - 41, { size: 7, color: '#fff8e0', align: 'center' });
    }

    // evening warmth
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(10,10,30,${nite * (G.decor.lamp ? 0.12 : 0.18)})`;
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
