// ---- house interior: the painted cutaway, furnished with the uploaded props ----
'use strict';

// The hut sprite shown whole, fitted by height. Measured off the art: the porch
// deck slab runs y 292..321 of 434, and spans x 0.104..0.892 — so the boards you
// stand on are at 0.70 of the sprite height, between those two edges.
const HUT_H = 252, HUT_W = Math.round(HUT_H * 575 / 434);
const HUT_X = Math.round((W - HUT_W) / 2), HUT_Y = 8;
const PORCH_L = HUT_X + HUT_W * 0.135, PORCH_R = HUT_X + HUT_W * 0.865;
const BED_X = Math.round(PORCH_L + 50), TABLE_X = Math.round(PORCH_R - 44);

const HouseScene = {
  customCursor: false,
  px: 380, dir: -1, walkT: 0, idleT: 0, time: 0,
  sleeping: false, sleepT: 0,
  aquaFish: [],
  embers: [],

  FLOOR: 184,      // the porch boards, measured off the hut sprite

  enter(opts) {
    this.time = 0;
    this.sleeping = false;
    if (opts && opts.wake) {
      this.px = BED_X;
      Game.toast('You wake up at home. Your bag is gone...');
      Game.toast(`Day ${G.day}.`);
    } else {
      this.px = Math.round(PORCH_R - 16); this.dir = -1;
    }
    SND.setScene('house');
  },

  spots() {
    const s = [
      { x: BED_X, label: 'Sleep  (next day, beds regrow)', act: () => this.sleep() },
      { x: Math.round(PORCH_R - 12), label: 'Go Outside', act: () => Game.go(WorldScene, { fromHouse: true }) },
    ];
    if (G.decor.gramophone) {
      s.push({
        x: Math.round(TABLE_X + 30), label: G.musicOn ? 'Gramophone: ON' : 'Gramophone: OFF',
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
      this.px = clamp(this.px + mv * 92 * dt, PORCH_L + 8, PORCH_R - 8);
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

    // the ocean visible past the open front
    drawA(ctx, `ocean${Math.floor(this.time * 8) % 12}`, -30, 0, 540, 270);
    SKY.tint(ctx, G.clock, this.time);

    // The dock, tiled behind the hut at the porch line and scaled to match this
    // view — outside, the house is part of the pier, so it has to be here too or
    // it reads as a shed adrift in open water.
    const segW = Math.round(88 * HUT_W / 124);   // the exterior's 88 at this zoom
    const segH = assetH('dock_11', segW);
    // align deck TOPS: the hut's porch boards start at 0.6728 of its sprite
    const segTop = HUT_Y + HUT_H * 0.6728 - segH * 0.0352;
    for (let x = HUT_X % (segW - 1) - segW; x < W + segW; x += segW - 1) {
      drawA(ctx, 'dock_11', x, segTop, segW, segH);
    }

    // the whole hut sprite, unzoomed — you see the roof, the porch and the stilts
    drawA(ctx, 'hut_full', HUT_X, HUT_Y, HUT_W, HUT_H);

    // furniture, standing on the porch boards
    const stand = (name, cx, w) => {
      const h = assetH(name, w);
      drawA(ctx, name, cx - w / 2, FLOOR - h + 1, w, h);
    };
    // the roof throws the back of the porch into shade — gives the flat wall depth
    const shadeTop = HUT_Y + HUT_H * 0.30;
    const gsh = ctx.createLinearGradient(0, shadeTop, 0, FLOOR);
    gsh.addColorStop(0, 'rgba(28,14,6,0.34)');
    gsh.addColorStop(0.55, 'rgba(28,14,6,0.14)');
    gsh.addColorStop(1, 'rgba(28,14,6,0)');
    ctx.save();
    ctx.beginPath();
    ctx.rect(PORCH_L, shadeTop, PORCH_R - PORCH_L, FLOOR - shadeTop);
    ctx.clip();
    ctx.fillStyle = gsh;
    ctx.fillRect(PORCH_L, shadeTop, PORCH_R - PORCH_L, FLOOR - shadeTop);
    ctx.restore();

    stand('furn_0', BED_X, 62);          // the bed
    const tblH = assetH('furn_2', 40);
    stand('furn_2', TABLE_X, 40);        // the table
    const lampY = FLOOR - tblH - 5;
    drawAC(ctx, 'furn_14', TABLE_X + 6, lampY, 10);   // a lantern on it
    // and the light it throws, once the day is going
    const glow = clamp(nite * 1.2, 0, 1) * 0.9 + 0.1;
    const gl = ctx.createRadialGradient(TABLE_X + 6, lampY, 2, TABLE_X + 6, lampY, 46);
    gl.addColorStop(0, `rgba(255,206,120,${glow * 0.34})`);
    gl.addColorStop(0.5, `rgba(255,186,100,${glow * 0.12})`);
    gl.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(TABLE_X - 40, lampY - 46, 92, 92);

    // ---- player -------------------------------------------------------------------------
    const OTTER_WALK = ['o4_4', 'o4_5', 'o4_6', 'o4_7'];
    const OTTER_IDLE = ['o4_0', 'o4_1', 'o4_2', 'o4_3'];
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
    ctx.fillStyle = 'rgba(40,20,10,0.2)';
    ctx.beginPath(); ctx.ellipse(this.px, FLOOR + 0.8, Math.max(3.5, 6 - hop * 0.9), 1.3, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS[walking ? OTTER_WALK[frameN] : OTTER_IDLE[Math.floor(this.time * 2.2) % 4]];
    if (oimg && oimg.width) {
      const oh = 30, ow = oh * oimg.width / oimg.height;
      ctx.save();
      ctx.translate(Math.round(this.px * DPX) / DPX, FLOOR + 0.5 - hop);
      ctx.scale(this.dir >= 0 ? sqx : -sqx, sqy);
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
