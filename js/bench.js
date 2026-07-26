// ---- the workbench: crack shells open, polish treasures ----------------------
'use strict';

const Bench = {
  open: false,
  mode: 'menu',        // menu | crack | polish
  item: null,          // raw item key being worked
  t: 0,
  crackPos: 0,         // 0..1 sweep position
  result: null, resultT: 0,
  shine: 0, lastRubX: 0, rubbing: false, sparkles: [],
  WX: 90, WY: 30, WW: 300, WH: 210,

  openUI() {
    this.open = true;
    this.mode = 'menu';
    this.result = null;
    SND.blip();
    if (!G.flags.seenBench) {
      G.flags.seenBench = true;
      Game.toast('Crack shells for meat, polish treasures — worth way more!');
    }
  },

  close() { this.open = false; SND.click(); },

  crackables() { return Object.keys(BENCH_CRACK).filter(k => (G.storage[k] || 0) > 0); },
  polishables() { return Object.keys(BENCH_POLISH).filter(k => (G.storage[k] || 0) > 0); },

  startCrack(k) {
    this.mode = 'crack'; this.item = k; this.t = 0;
    this.result = null; this.resultT = 0;
    SND.click();
  },

  startPolish(k) {
    this.mode = 'polish'; this.item = k;
    this.shine = 0; this.result = null; this.resultT = 0; this.sparkles = [];
    SND.click();
  },

  resolveCrack() {
    const pos = this.crackPos;
    const off = Math.abs(pos - 0.5);
    G.storage[this.item]--;
    G.stats.cracked++;
    if (off < 0.07) {
      G.storage[BENCH_CRACK[this.item]]++;
      let msg = 'Clean crack!';
      if (this.item === 'oyster' && Math.random() < 0.18) { G.storage.pearl++; msg = 'Clean crack... A PEARL!'; SND.chime(); G.stats.pearls++; }
      this.result = { good: 2, msg };
      SND.crackHit(true);
    } else if (off < 0.17) {
      G.storage[BENCH_CRACK[this.item]]++;
      let msg = 'Cracked it.';
      if (this.item === 'oyster' && Math.random() < 0.06) { G.storage.pearl++; msg = 'Cracked it... a pearl!'; SND.chime(); G.stats.pearls++; }
      this.result = { good: 1, msg };
      SND.crackHit(false);
    } else {
      G.storage.barnacle++;   // smashed to useful bits, at least
      this.result = { good: 0, msg: 'Smashed it to bits...' };
      SND.smash();
    }
    this.resultT = 0.9;
    if (navigator.vibrate) { try { navigator.vibrate(this.result.good ? 15 : 40); } catch (e) {} }
    Game.save();
  },

  finishPolish() {
    G.storage[this.item]--;
    G.storage[BENCH_POLISH[this.item]]++;
    G.stats.polished++;
    this.result = { good: 2, msg: 'Gleaming!' };
    this.resultT = 0.9;
    SND.chime();
    if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) {} }
    Game.save();
  },

  update(dt) {
    if (Input.p('Escape')) {
      if (this.mode === 'menu') this.close();
      else { this.mode = 'menu'; SND.click(); }
      return;
    }
    const mx = Input.mouse.x, my = Input.mouse.y;

    if (this.resultT > 0) {
      this.resultT -= dt;
      if (this.resultT <= 0) {
        // chain into the next one of the same shell, or fall back to the menu
        const left = G.storage[this.item] || 0;
        if (left > 0 && this.mode === 'crack') { this.t = 0; this.result = null; }
        else if (left > 0 && this.mode === 'polish') { this.shine = 0; this.result = null; this.sparkles = []; }
        else { this.mode = 'menu'; this.result = null; }
      }
      return;
    }

    if (this.mode === 'menu') {
      if (Input.mouse.clicked) {
        // close X
        if (mx > this.WX + this.WW - 26 && my < this.WY + 20) { this.close(); return; }
        const rows = this.menuRows();
        for (let i = 0; i < rows.length; i++) {
          const ry = this.WY + 46 + i * 26;
          if (my > ry && my < ry + 23 && mx > this.WX + 10 && mx < this.WX + this.WW - 10) {
            rows[i].act();
            return;
          }
        }
      }
    } else if (this.mode === 'crack') {
      this.t += dt;
      this.crackPos = (Math.sin(this.t * 3.4 - Math.PI / 2) + 1) / 2;
      if (Input.mouse.clicked) this.resolveCrack();
    } else if (this.mode === 'polish') {
      const overItem = Math.abs(mx - (this.WX + this.WW / 2)) < 46 && Math.abs(my - (this.WY + 104)) < 40;
      if (Input.mouse.down && overItem) {
        const dx = Math.abs(mx - this.lastRubX);
        if (dx > 0.5) {
          this.shine = Math.min(1, this.shine + dx * 0.006);
          if (Math.random() < 0.35) SND.rub();
          if (Math.random() < 0.5)
            this.sparkles.push({ x: mx + rand(-6, 6), y: my + rand(-8, 4), t: rand(0.3, 0.7) });
        }
        this.rubbing = true;
      } else this.rubbing = false;
      this.lastRubX = mx;
      for (const s of this.sparkles) s.t -= dt;
      this.sparkles = this.sparkles.filter(s => s.t > 0);
      if (this.shine >= 1) this.finishPolish();
    }
  },

  menuRows() {
    const rows = [];
    for (const k of this.crackables())
      rows.push({ art: k, label: `Crack ${ITEMS[k].name}  x${G.storage[k]}`, sub: `-> ${ITEMS[BENCH_CRACK[k]].name} ($${ITEMS[BENCH_CRACK[k]].price})`, act: () => this.startCrack(k) });
    for (const k of this.polishables())
      rows.push({ art: k, label: `Polish ${ITEMS[k].name}  x${G.storage[k]}`, sub: `-> ${ITEMS[BENCH_POLISH[k]].name} ($${ITEMS[BENCH_POLISH[k]].price})`, act: () => this.startPolish(k) });
    return rows;
  },

  draw(ctx) {
    ctx.fillStyle = 'rgba(4,8,14,0.62)';
    ctx.fillRect(0, 0, W, H);
    uiPanel(ctx, this.WX, this.WY, this.WW, this.WH, 0.97);
    ctx.fillStyle = 'rgba(58,42,22,0.95)';
    ctx.fillRect(this.WX + 2, this.WY + 2, this.WW - 4, 15);
    text(ctx, "~ OTTO'S WORKBENCH ~", this.WX + this.WW / 2, this.WY + 6, { size: 8, color: '#ffe6b0', align: 'center' });
    text(ctx, 'X', this.WX + this.WW - 11, this.WY + 5.5, { size: 8, color: '#e8434c', align: 'center' });

    if (this.mode === 'menu') {
      const rows = this.menuRows();
      if (!rows.length) {
        text(ctx, 'Nothing to work on.', this.WX + this.WW / 2, this.WY + 80, { size: 9, color: '#b8a888', align: 'center' });
        text(ctx, 'Dive for clams, oysters, abalone or pearls!', this.WX + this.WW / 2, this.WY + 96, { size: 7, color: '#8a7758', align: 'center' });
      }
      const mx = Input.mouse.x, my = Input.mouse.y;
      for (let i = 0; i < rows.length && i < 6; i++) {
        const ry = this.WY + 46 + i * 26;
        const hov = my > ry && my < ry + 23 && mx > this.WX + 10 && mx < this.WX + this.WW - 10;
        ctx.fillStyle = hov ? 'rgba(90,66,36,0.7)' : 'rgba(56,42,24,0.55)';
        ctx.fillRect(this.WX + 10, ry, this.WW - 20, 23);
        ctx.fillStyle = 'rgba(230,200,150,0.12)';
        ctx.fillRect(this.WX + 10, ry, this.WW - 20, PIX);
        drawItemIcon(ctx, rows[i].art, this.WX + 24, ry + 11.5, 15);
        text(ctx, rows[i].label, this.WX + 32, ry + 3.5, { size: 8, color: '#f4e8cc' });
        text(ctx, rows[i].sub, this.WX + 32, ry + 13, { size: 6, color: '#a0d2ac' });
      }
      text(ctx, 'crack: tap when the marker hits center  *  polish: rub!', this.WX + this.WW / 2, this.WY + this.WH - 14, { size: 6, color: '#8a7758', align: 'center' });
      return;
    }

    // shared: the item, big, on a work cloth
    const cx = this.WX + this.WW / 2, cy = this.WY + 104;
    ctx.fillStyle = '#5f4a2e';
    ctx.beginPath(); ctx.ellipse(cx, cy + 26, 62, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a6240';
    ctx.beginPath(); ctx.ellipse(cx, cy + 24, 54, 9, 0, 0, TAU); ctx.fill();
    // the shell itself, big on the work cloth — cracked open on success
    const showOpen = this.result && this.result.good > 0 && this.mode === 'crack';
    const artName = showOpen ? ('open_' + (NODE_ART[this.item] || 'clam'))
      : (this.mode === 'polish' && this.result ? ITEM_ART[BENCH_POLISH[this.item]] : ITEM_ART[this.item]) || 'shell_clam';
    ctx.save();
    ctx.translate(cx, cy + 2);
    if (this.mode === 'polish' && this.rubbing) ctx.rotate(Math.sin(Input.mouse.x * 0.35) * 0.06);
    if (this.result) {
      const rp = 1 + Math.sin(clamp(0.9 - this.resultT, 0, 0.9) * Math.PI) * 0.12;
      ctx.scale(rp, rp);
      // starburst behind the reveal
      ctx.save();
      ctx.rotate(this.resultT * 1.5);
      ctx.fillStyle = `rgba(255,246,200,${clamp(this.resultT, 0, 0.55)})`;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(5, -44); ctx.lineTo(-5, -44); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    drawAC(ctx, artName, 0, 0, 62);
    ctx.restore();

    if (this.mode === 'crack') {
      text(ctx, `Cracking: ${ITEMS[this.item].name}  (x${G.storage[this.item]})`, cx, this.WY + 28, { size: 8, color: '#f4e8cc', align: 'center' });
      // sweep bar
      const bw = 180, bx = cx - bw / 2, by = this.WY + 158;
      rrect(ctx, bx - 2, by - 2, bw + 4, 16, '#181008', '#7e5c34');
      ctx.fillStyle = '#2c1f12';
      ctx.fillRect(bx, by, bw, 12);
      // zones
      ctx.fillStyle = '#3f6a3f';
      ctx.fillRect(bx + bw * 0.33, by, bw * 0.34, 12);
      ctx.fillStyle = '#4fae5e';
      ctx.fillRect(bx + bw * 0.43, by, bw * 0.14, 12);
      ctx.fillStyle = 'rgba(200,255,210,0.6)';
      ctx.fillRect(bx + bw * 0.43, by, bw * 0.14, 1.5);
      // marker
      const mxp = bx + this.crackPos * bw;
      ctx.fillStyle = '#ffe66e';
      ctx.fillRect(mxp - 1, by - 4, 2, 20);
      ctx.beginPath(); ctx.moveTo(mxp, by - 5); ctx.lineTo(mxp - 4, by - 10); ctx.lineTo(mxp + 4, by - 10); ctx.closePath(); ctx.fill();
      if (!this.result)
        text(ctx, TouchUI.enabled ? 'TAP when the marker is centered!' : 'CLICK when the marker is centered!', cx, by + 22, { size: 7, color: '#ffe6b0', align: 'center' });
    } else if (this.mode === 'polish') {
      text(ctx, `Polishing: ${ITEMS[this.item].name}  (x${G.storage[this.item]})`, cx, this.WY + 28, { size: 8, color: '#f4e8cc', align: 'center' });
      // shine meter
      const bw = 180, bx = cx - bw / 2, by = this.WY + 162;
      rrect(ctx, bx - 2, by - 2, bw + 4, 12, '#181008', '#7e5c34');
      ctx.fillStyle = '#2c1f12';
      ctx.fillRect(bx, by, bw, 8);
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#8ff0d8'); grad.addColorStop(1, '#fffdf4');
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw * this.shine, 8);
      // rub sparkles
      for (const s of this.sparkles) {
        ctx.fillStyle = `rgba(255,255,240,${clamp(s.t * 2, 0, 1)})`;
        ctx.fillRect(s.x, s.y, 1.5, 1.5);
        ctx.fillRect(s.x - 1.5, s.y + 1.5, 1, 1);
      }
      // gleam sweep on the item as shine grows
      ctx.save();
      ctx.globalAlpha = this.shine * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 40 + this.shine * 60, cy - 30, 4, 60);
      ctx.restore();
      if (!this.result)
        text(ctx, TouchUI.enabled ? 'RUB it back and forth!' : 'Hold and RUB side to side!', cx, by + 18, { size: 7, color: '#ffe6b0', align: 'center' });
    }

    if (this.result) {
      const col = this.result.good === 2 ? '#a0f2b4' : (this.result.good === 1 ? '#ffe6b0' : '#e88a8a');
      text(ctx, this.result.msg, cx, this.WY + 62, { size: 11, color: col, align: 'center' });
    }
    text(ctx, '[Esc] back', this.WX + 12, this.WY + this.WH - 14, { size: 6, color: '#8a7758' });
  },
};
