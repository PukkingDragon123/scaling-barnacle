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
  WX: 68, WY: 26, WW: 344, WH: 218,

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
        if (mx > this.WX + this.WW - 28 && my > this.WY && my < this.WY + 24) { this.close(); return; }
        const rows = this.menuRows();
        for (let i = 0; i < rows.length && i < 5; i++) {
          const ry = this.WY + 44 + i * 31;
          if (my > ry && my < ry + 28 && mx > this.WX + 12 && mx < this.WX + this.WW - 12) {
            rows[i].act();
            return;
          }
        }
      }
    } else if (this.mode === 'crack') {
      if (Input.mouse.clicked && mx > this.WX + this.WW - 28 && my > this.WY && my < this.WY + 24) {
        this.mode = 'menu'; SND.click(); return;
      }
      this.t += dt;
      this.crackPos = (Math.sin(this.t * 3.4 - Math.PI / 2) + 1) / 2;
      if (Input.mouse.clicked) this.resolveCrack();
    } else if (this.mode === 'polish') {
      const overItem = Math.abs(mx - (this.WX + this.WW / 2)) < 52 && Math.abs(my - (this.WY + 110)) < 44;
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
    // dim the world, then a warm bench panel
    ctx.fillStyle = 'rgba(6,10,16,0.66)';
    ctx.fillRect(0, 0, W, H);
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    uiPanel(ctx, X, Y, WW, HH, 0.97, true);
    // header bar
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X + 3, Y + 3, WW - 6, 19, 2.5); else ctx.rect(X + 3, Y + 3, WW - 6, 19);
    ctx.fillStyle = '#7a4a2c';
    ctx.fill();
    ctx.restore();
    drawAC(ctx, 'g_crowbar', X + 18, Y + 12.5, 15);
    text(ctx, "OTTO'S WORKBENCH", X + WW / 2, Y + 7.5, { size: 9, color: '#ffe9c4', align: 'center', shadow: false });
    // close
    const mx = Input.mouse.x, my = Input.mouse.y;
    const cHov = mx > X + WW - 26 && mx < X + WW - 4 && my > Y + 2 && my < Y + 22;
    ctx.fillStyle = cHov ? '#e8434c' : '#5a3220';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X + WW - 24, Y + 5, 16, 15, 2.5); else ctx.rect(X + WW - 24, Y + 5, 16, 15);
    ctx.fill();
    text(ctx, 'X', X + WW - 16, Y + 8, { size: 8, color: '#ffe9c4', align: 'center', shadow: false });

    if (this.mode === 'menu') {
      const rows = this.menuRows();
      text(ctx, 'WHAT SHALL WE WORK ON?', X + WW / 2, Y + 30, { size: 7, color: '#8a6a4a', align: 'center', shadow: false });
      if (!rows.length) {
        text(ctx, 'Nothing to work on.', X + WW / 2, Y + 92, { size: 10, color: '#7a5a3a', align: 'center', shadow: false });
        text(ctx, 'Dive for clams, oysters, abalone or pearls!', X + WW / 2, Y + 108, { size: 7, color: '#9a7a5a', align: 'center', shadow: false });
      }
      for (let i = 0; i < rows.length && i < 5; i++) {
        const ry = Y + 44 + i * 31;
        const hov = my > ry && my < ry + 28 && mx > X + 12 && mx < X + WW - 12;
        // card
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(X + 12, ry, WW - 24, 28, 3); else ctx.rect(X + 12, ry, WW - 24, 28);
        ctx.fillStyle = hov ? '#f6e4c2' : '#eddcba';
        ctx.fill();
        ctx.strokeStyle = hov ? '#b07a3c' : 'rgba(122,74,48,0.45)';
        ctx.lineWidth = hov ? 1.6 : 1;
        ctx.stroke();
        ctx.restore();
        // icon well
        ctx.fillStyle = 'rgba(122,74,48,0.16)';
        ctx.beginPath(); ctx.arc(X + 30, ry + 14, 11, 0, TAU); ctx.fill();
        drawItemIcon(ctx, rows[i].art, X + 30, ry + 14, 18);
        text(ctx, rows[i].label, X + 47, ry + 5, { size: 8, color: '#4a3020', shadow: false });
        text(ctx, rows[i].sub, X + 47, ry + 16, { size: 7, color: '#2f7a4a', shadow: false });
        // go chevron
        ctx.fillStyle = hov ? '#7a4a2c' : '#b09070';
        ctx.beginPath();
        ctx.moveTo(X + WW - 26, ry + 10); ctx.lineTo(X + WW - 20, ry + 14); ctx.lineTo(X + WW - 26, ry + 18);
        ctx.closePath(); ctx.fill();
      }
      text(ctx, 'crack for meat  *  polish for shine', X + WW / 2, Y + HH - 14, { size: 6.5, color: '#9a7a5a', align: 'center', shadow: false });
      return;
    }

    // ---- working view -------------------------------------------------------------
    const cx = X + WW / 2, cy = Y + 108;
    text(ctx, (this.mode === 'crack' ? 'CRACKING' : 'POLISHING') + '  ~  ' + ITEMS[this.item].name
      + '  x' + (G.storage[this.item] || 0), cx, Y + 30, { size: 8, color: '#6a4420', align: 'center', shadow: false });
    // work surface
    ctx.fillStyle = '#c9ab82';
    ctx.beginPath(); ctx.ellipse(cx, cy + 34, 76, 15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#dcc09a';
    ctx.beginPath(); ctx.ellipse(cx, cy + 31, 66, 11, 0, 0, TAU); ctx.fill();

    const showOpen = this.result && this.result.good > 0 && this.mode === 'crack';
    const artName = showOpen ? ('open_' + (NODE_ART[this.item] || 'clam'))
      : (this.mode === 'polish' && this.result ? ITEM_ART[BENCH_POLISH[this.item]] : ITEM_ART[this.item]) || 'shell_clam';
    ctx.save();
    ctx.translate(cx, cy + 2);
    if (this.mode === 'polish' && this.rubbing) ctx.rotate(Math.sin(Input.mouse.x * 0.35) * 0.06);
    if (this.result) {
      const rp = 1 + Math.sin(clamp(0.9 - this.resultT, 0, 0.9) * Math.PI) * 0.12;
      ctx.scale(rp, rp);
      ctx.save();
      ctx.rotate(this.resultT * 1.5);
      ctx.fillStyle = `rgba(255,236,170,${clamp(this.resultT, 0, 0.5)})`;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(6, -50); ctx.lineTo(-6, -50); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    drawAC(ctx, artName, 0, 0, 66);
    ctx.restore();

    if (this.mode === 'crack') {
      const bw = 210, bx = cx - bw / 2, by = Y + 166;
      // track
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx - 3, by - 3, bw + 6, 18, 3); else ctx.rect(bx - 3, by - 3, bw + 6, 18);
      ctx.fillStyle = '#5a3a22'; ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#3a2414';
      ctx.fillRect(bx, by, bw, 12);
      ctx.fillStyle = '#4a7a46';
      ctx.fillRect(bx + bw * 0.33, by, bw * 0.34, 12);
      ctx.fillStyle = '#68c268';
      ctx.fillRect(bx + bw * 0.43, by, bw * 0.14, 12);
      ctx.fillStyle = 'rgba(220,255,220,0.55)';
      ctx.fillRect(bx + bw * 0.43, by, bw * 0.14, 2);
      // marker
      const mxp = bx + this.crackPos * bw;
      ctx.fillStyle = '#ffe66e';
      ctx.fillRect(mxp - 1.2, by - 5, 2.4, 22);
      ctx.beginPath(); ctx.moveTo(mxp, by - 6); ctx.lineTo(mxp - 5, by - 13); ctx.lineTo(mxp + 5, by - 13); ctx.closePath(); ctx.fill();
      if (!this.result)
        text(ctx, TouchUI.enabled ? 'TAP in the green!' : 'CLICK in the green!', cx, by + 20, { size: 8, color: '#6a4420', align: 'center', shadow: false });
    } else if (this.mode === 'polish') {
      const bw = 210, bx = cx - bw / 2, by = Y + 170;
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx - 3, by - 3, bw + 6, 14, 3); else ctx.rect(bx - 3, by - 3, bw + 6, 14);
      ctx.fillStyle = '#5a3a22'; ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#3a2414';
      ctx.fillRect(bx, by, bw, 8);
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#8ff0d8'); grad.addColorStop(1, '#fffdf4');
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw * this.shine, 8);
      for (const s of this.sparkles) {
        ctx.fillStyle = `rgba(255,255,240,${clamp(s.t * 2, 0, 1)})`;
        ctx.fillRect(s.x, s.y, 1.5, 1.5);
      }
      if (!this.result)
        text(ctx, TouchUI.enabled ? 'RUB back and forth!' : 'Hold and RUB side to side!', cx, by + 16, { size: 8, color: '#6a4420', align: 'center', shadow: false });
    }

    if (this.result) {
      const col = this.result.good === 2 ? '#2f7a4a' : (this.result.good === 1 ? '#8a6420' : '#a83030');
      text(ctx, this.result.msg, cx, Y + 46, { size: 12, color: col, align: 'center', shadow: false });
    }
    text(ctx, '[Esc] back', X + 14, Y + HH - 14, { size: 6.5, color: '#9a7a5a', shadow: false });
  },
};
