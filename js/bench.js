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
      Game.toast('Crack shells for the meat; polish the precious ones. Both sell better.');
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
    // a plain plank board — hand-cut, nothing fancy
    ctx.fillStyle = '#c9a271';
    ctx.fillRect(X, Y, WW, HH);
    for (let by = Y; by < Y + HH; by += 13) {   // board seams
      ctx.fillStyle = 'rgba(120,80,44,0.20)';
      ctx.fillRect(X, by, WW, PIX * 2);
    }
    ctx.fillStyle = 'rgba(255,238,205,0.35)';
    ctx.fillRect(X, Y, WW, 1.4);
    ctx.strokeStyle = '#6d4526'; ctx.lineWidth = 2;
    ctx.strokeRect(X + 1, Y + 1, WW - 2, HH - 2);
    // four nails
    ctx.fillStyle = '#5d5348';
    for (const [nx, ny] of [[X + 6, Y + 6], [X + WW - 7, Y + 6], [X + 6, Y + HH - 7], [X + WW - 7, Y + HH - 7]]) {
      ctx.beginPath(); ctx.arc(nx, ny, 1.6, 0, TAU); ctx.fill();
    }
    text(ctx, "otto's workbench", X + WW / 2, Y + 8, { size: 9, color: '#5a3a1e', align: 'center', shadow: false });
    ctx.fillStyle = 'rgba(90,58,30,0.5)';
    ctx.fillRect(X + WW / 2 - 46, Y + 19, 92, PIX * 2);
    // close
    const mx = Input.mouse.x, my = Input.mouse.y;
    const cHov = mx > X + WW - 26 && mx < X + WW - 4 && my > Y + 2 && my < Y + 22;
    ctx.strokeStyle = cHov ? '#a83a2a' : '#6d4526'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X + WW - 22, Y + 7); ctx.lineTo(X + WW - 12, Y + 17);
    ctx.moveTo(X + WW - 12, Y + 7); ctx.lineTo(X + WW - 22, Y + 17);
    ctx.stroke();

    if (this.mode === 'menu') {
      const rows = this.menuRows();
      text(ctx, 'what shall we work on?', X + WW / 2, Y + 26, { size: 7, color: '#7a5232', align: 'center', shadow: false });
      if (!rows.length) {
        const ey = Y + HH / 2 - 14;
        // an empty tag hanging on the board, so the bare state still reads as bench
        ctx.fillStyle = '#f2e6c9';
        ctx.fillRect(X + 40, ey - 6, WW - 80, 40);
        ctx.strokeStyle = 'rgba(122,74,48,0.4)'; ctx.lineWidth = 1;
        ctx.strokeRect(X + 40.5, ey - 5.5, WW - 81, 39);
        ctx.fillStyle = '#8a5a2c';
        ctx.beginPath(); ctx.arc(X + 47, ey + 14, 1.4, 0, TAU); ctx.fill();
        text(ctx, 'nothing to work on', X + WW / 2, ey + 2, { size: 9, color: '#7a5a3a', align: 'center', shadow: false });
        text(ctx, 'dive for clams, oysters, abalone or pearls', X + WW / 2, ey + 17, { size: 6.5, color: '#a98a68', align: 'center', shadow: false });
      }
      for (let i = 0; i < rows.length && i < 5; i++) {
        const ry = Y + 44 + i * 31;
        const hov = my > ry && my < ry + 28 && mx > X + 12 && mx < X + WW - 12;
        // card
        // a paper tag tied to the board
        ctx.fillStyle = hov ? '#fbf1da' : '#f2e6c9';
        ctx.fillRect(X + 12, ry, WW - 24, 28);
        ctx.strokeStyle = hov ? '#8a5a2c' : 'rgba(122,74,48,0.4)';
        ctx.lineWidth = hov ? 1.4 : 1;
        ctx.strokeRect(X + 12.5, ry + 0.5, WW - 25, 27);
        ctx.fillStyle = 'rgba(122,74,48,0.18)';
        ctx.fillRect(X + 12, ry + 27, WW - 24, PIX * 2);
        // string hole
        ctx.fillStyle = '#8a5a2c';
        ctx.beginPath(); ctx.arc(X + 18, ry + 14, 1.4, 0, TAU); ctx.fill();
        drawItemIcon(ctx, rows[i].art, X + 34, ry + 14, 19);
        text(ctx, rows[i].label, X + 50, ry + 5, { size: 8, color: '#4a3020', shadow: false });
        text(ctx, rows[i].sub, X + 50, ry + 16, { size: 7, color: '#2f6f46', shadow: false });
        // go chevron
        ctx.strokeStyle = hov ? '#7a4a2c' : '#b09070'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(X + WW - 27, ry + 10); ctx.lineTo(X + WW - 21, ry + 14); ctx.lineTo(X + WW - 27, ry + 18);
        ctx.stroke();
      }
      text(ctx, 'crack for meat  ~  polish for shine', X + WW / 2, Y + HH - 20, { size: 6.5, color: '#7a5232', align: 'center', shadow: false });
      return;
    }

    // ---- working view -------------------------------------------------------------
    const cx = X + WW / 2, cy = Y + 108;
    text(ctx, (this.mode === 'crack' ? 'CRACKING' : 'POLISHING') + '  ~  ' + ITEMS[this.item].name
      + '  x' + (G.storage[this.item] || 0), cx, Y + 30, { size: 8, color: '#6a4420', align: 'center', shadow: false });
    // work surface
    // a folded work cloth
    ctx.fillStyle = '#b8956a';
    ctx.fillRect(cx - 78, cy + 22, 156, 20);
    ctx.fillStyle = '#cfae82';
    ctx.fillRect(cx - 72, cy + 24, 144, 14);
    ctx.fillStyle = 'rgba(120,80,44,0.25)';
    for (let sx = cx - 72; sx < cx + 72; sx += 9) ctx.fillRect(sx, cy + 24, PIX * 2, 14);

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
      ctx.fillStyle = '#6d4526'; ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#48301c';
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
      ctx.fillStyle = '#6d4526'; ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#48301c';
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
    text(ctx, '[Esc] back', X + 14, Y + HH - 13, { size: 6.5, color: '#7a5232', shadow: false });
  },
};
