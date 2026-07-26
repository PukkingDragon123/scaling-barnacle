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

    // ---- player -------------------------------------------------------------------------
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
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.px, FLOOR + 0.6, Math.max(4, 7 - hop * 0.9), 1.6, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS[walking ? OTTER_WALK[frameN] : 'o2_13'];
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
      uiPanel(ctx, bx - w / 2, FLOOR - 46, w, 13, 0.95, true);
      text(ctx, label, bx, FLOOR - 43, { size: 7, color: '#4a3020', align: 'center', shadow: false });
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
