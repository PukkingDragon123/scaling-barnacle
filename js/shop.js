// ---- ClamNet: the laptop shop overlay ---------------------------------------
'use strict';

const Shop = {
  open: false,
  tab: 0,
  scroll: 0,
  TABS: ['SELL', 'STALL', 'GEAR', 'BUILD', 'DECOR'],
  STALL_TAB: 1,          // Sprout's counter: seeds and livestock

  WX: 40, WY: 22, WW: 400, WH: 226,
  _rows: [],

  openUI() {
    this.open = true;
    this.tab = 0;
    this.scroll = 0;
    SND.blip();
    if (!G.flags.seenShop) {
      G.flags.seenShop = true;
      Game.toast('Sell shells here — a drone picks them up and pays you!');
    }
  },

  close() { this.open = false; SND.click(); },

  buy(price, apply, name) {
    if (G.money < price) {
      SND.alarm();
      Game.toast('Not enough sand dollars!');
      return;
    }
    G.money -= price;
    apply();
    SND.cash();
    Game.toast(`Bought: ${name}`);
    Game.save();
  },

  sellKeys(keys) {
    let v = 0, c = 0;
    for (const k of keys) {
      const n = G.storage[k] || 0;
      v += n * ITEMS[k].price; c += n;
      G.storage[k] = 0;
    }
    if (c === 0) return;
    if (G.pendingCrate) G.pendingCrate.value += v;
    else G.pendingCrate = { value: v, t: 16 };
    SND.click();
    Game.toast(`Order placed: $${v} — drone en route!`);
    Game.save();
  },

  buildRows() {
    const rows = [];
    const push = (r) => rows.push(r);
    if (this.tab === 0) {
      // SELL
      if (G.pendingCrate)
        push({ info: `Drone en route with your crate — $${G.pendingCrate.value} on pickup (${Math.ceil(G.pendingCrate.t)}s)` });
      let total = 0, any = false;
      for (const k of ITEM_KEYS) {
        const n = G.storage[k] || 0;
        if (n <= 0) continue;
        any = true;
        total += n * ITEMS[k].price;
        push({
          art: k,
          label: `${ITEMS[k].name}  x${n}`,
          sub: `$${ITEMS[k].price} each`,
          btn: `SELL $${n * ITEMS[k].price}`,
          act: () => this.sellKeys([k]),
        });
      }
      if (!any) push({ info: 'Storage is empty. Go scrape the pilings!' });
      else push({ label: 'SELL EVERYTHING', sub: 'one big crate', btn: `$${total}`, act: () => this.sellKeys(ITEM_KEYS) });
    } else if (this.tab === this.STALL_TAB) {
      // STALL — the only place you BUY things that start a production chain.
      // Both catalogues are owned by their own module; this just renders them.
      const F = typeof Farm !== 'undefined' ? Farm : null;
      const S = typeof Stock !== 'undefined' ? Stock : null;
      if (F && F.SEEDS) {
        push({ info: 'SEEDS — plant on a tilled bed, water it daily' });
        for (const sd of F.SEEDS) {
          const held = F.seedCount ? F.seedCount(sd.key) : 0;
          push({
            gart: sd.art, label: sd.name,
            sub: (sd.desc || '') + (held ? `   (holding ${held})` : ''),
            btn: `$${sd.price}`, price: sd.price,
            act: () => F.buySeed(sd.key, 1),
          });
        }
      }
      if (S && S.SPECIES) {
        const pens = (G.built && G.built.pen) || 0;
        push({ info: pens
          ? `LIVESTOCK — ${pens} pen${pens > 1 ? 's' : ''} built, room for ${pens * (S.PEN_CAP || 3)}`
          : 'LIVESTOCK — build a pen at the crafting bench first' });
        for (const sp of S.SPECIES) {
          push({
            gart: 'stock_' + sp.key + '_3', label: sp.name,
            sub: `${sp.desc}  Matures in ${sp.matureDays}d.`,
            btn: pens ? `$${sp.price}` : 'NO PEN', price: sp.price,
            // buyAnimal owns the whole transaction (pen check, cash, naming, save)
            act: pens ? () => S.buyAnimal(sp.key) : null,
          });
        }
      }
      if (!F && !S) push({ info: 'The stall is shuttered.' });
    } else if (this.tab === 2) {
      // GEAR -- read-only since ClamNet went sell-and-valuables-only: tools are
      // crafted at the Forge tables now. NO row here may carry act/price/btn;
      // dev/smoke-net.js asserts that stays true.
      push({ info: 'ClamNet no longer ships tools. Otto crafts his own — [C] on the dock.' });
      const at = (arr, cur, gart, where) => {
        if (cur + 1 < arr.length) push({ gart, label: arr[cur + 1].name, sub: `craft at the ${where}  (now: ${arr[cur].name})` });
        else push({ gart, label: arr[cur].name, sub: 'Top of the line.' });
      };
      at(BAGS, G.gear.bag, 'g_netbag', 'workbench');
      at(SUITS, G.gear.suit, 'g_suit', G.gear.suit ? 'smithy' : 'workbench');
      at(SCRAPERS, G.gear.scraper, 'g_scraper', 'smithy');
      at(PRYBARS, G.gear.pry, 'g_crowbar', 'smithy');
      at(TANKS, G.gear.tank, 'g_tank', 'smithy');
      const singleArt = { lamp: 'g_torch', gloves: 'g_plier' };
      for (const key of ['lamp', 'gloves']) {
        const it = GEAR_SINGLES[key];
        push({ gart: singleArt[key], label: it.name, sub: G.gear[key] ? 'Owned.' : 'craft at the workbench' });
      }
    } else if (this.tab === 3) {
      // BUILD
      if (G.bridge < 3) {
        const b = G.bridge === 1 ? BUILDS.bridge2 : BUILDS.bridge3;
        push({ label: b.name, sub: b.desc, btn: `$${b.price}`, price: b.price, act: () => this.buy(b.price, () => { G.bridge++; }, b.name) });
      } else push({ info: 'The piling is rated for the deepest bed there is.' });
      if (G.house < 3) {
        const h = G.house === 1 ? BUILDS.house2 : BUILDS.house3;
        push({ label: h.name, sub: h.desc, btn: `$${h.price}`, price: h.price, act: () => this.buy(h.price, () => { G.house++; }, h.name) });
      } else push({ info: 'Your house is the finest on the sea.' });
    } else {
      // DECOR
      for (const d of DECOR) {
        if (G.decor[d.id]) push({ label: d.name, sub: d.desc, btn: 'OWNED' });
        else push({ label: d.name, sub: d.desc, btn: `$${d.price}`, price: d.price, act: () => this.buy(d.price, () => { G.decor[d.id] = true; }, d.name) });
      }
    }
    return rows;
  },

  update(dt) {
    if (Input.p('Escape')) { this.close(); return; }
    for (let i = 0; i < this.TABS.length; i++)
      if (Input.p('Digit' + (i + 1))) { this.tab = i; this.scroll = 0; SND.blip(); }
    this.scroll = clamp(this.scroll + Input.wheelDelta, 0, 30);

    this._rows = this.buildRows();
    // when the list overflows, the 8th row band becomes the scroll-arrow strip
    this._vis = this._rows.length > 7 ? 6 : 7;
    const maxScroll = Math.max(0, this._rows.length - this._vis);
    this.scroll = clamp(this.scroll, 0, maxScroll);

    if (Input.mouse.clicked) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      // close button (generous hit box for touch)
      if (mx > this.WX + this.WW - 28 && my > this.WY && my < this.WY + 24) { this.close(); return; }
      // scroll arrows (touch has no wheel)
      const ay = this.WY + 48 + this._vis * 25 + 2;
      if (maxScroll > 0 && mx > this.WX + this.WW - 58 && mx < this.WX + this.WW - 12 && my > ay && my < ay + 18) {
        this.scroll = clamp(this.scroll + (mx > this.WX + this.WW - 34 ? 1 : -1), 0, maxScroll);
        SND.blip();
        return;
      }
      // tabs
      for (let i = 0; i < this.TABS.length; i++) {
        const tx = this.WX + 12 + i * 50;
        if (mx > tx && mx < tx + 46 && my > this.WY + 26 && my < this.WY + 42) {
          this.tab = i; this.scroll = 0; SND.blip(); return;
        }
      }
      // rows
      const y0 = this.WY + 48;
      for (let i = 0; i < this._vis; i++) {
        const r = this._rows[i + this.scroll];
        if (!r || r.info || !r.act) continue;
        const ry = y0 + i * 25;
        if (mx > this.WX + this.WW - 96 && mx < this.WX + this.WW - 12 && my > ry + 2 && my < ry + 20) {
          r.act();
          return;
        }
      }
    }
  },

  draw(ctx) {
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const t = Game.time;
    // ---- CRT terminal shell -------------------------------------------------------
    ctx.fillStyle = 'rgba(2,6,8,0.80)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X, Y, WW, HH, 4); else ctx.rect(X, Y, WW, HH);
    ctx.fillStyle = 'rgba(4,16,14,0.97)';
    ctx.fill();
    ctx.strokeStyle = '#2ef2a0'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    // outer glow
    ctx.strokeStyle = 'rgba(46,242,160,0.14)'; ctx.lineWidth = 3;
    ctx.strokeRect(X - 1.5, Y - 1.5, WW + 3, HH + 3);
    // scanlines
    ctx.save();
    ctx.beginPath(); ctx.rect(X, Y, WW, HH); ctx.clip();
    ctx.fillStyle = 'rgba(46,242,160,0.045)';
    for (let y = Y + (t * 8 % 3); y < Y + HH; y += 3) ctx.fillRect(X, y, WW, 1);
    // faint grid
    ctx.strokeStyle = 'rgba(46,242,160,0.05)'; ctx.lineWidth = PIX;
    for (let gx = X + 12; gx < X + WW; gx += 24) { ctx.beginPath(); ctx.moveTo(gx, Y); ctx.lineTo(gx, Y + HH); ctx.stroke(); }

    // ---- title bar ----
    ctx.fillStyle = 'rgba(46,242,160,0.12)';
    ctx.fillRect(X + 2, Y + 2, WW - 4, 18);
    ctx.fillStyle = '#2ef2a0';
    ctx.fillRect(X + 2, Y + 19.4, WW - 4, PIX * 2);
    text(ctx, '> CLAMNET v2.4  //  otto@reef:~$', X + 10, Y + 6.5, { size: 7.5, color: '#7dffcf', shadow: false });
    if (Math.sin(t * 6) > 0) text(ctx, '_', X + 10 + textWidth(ctx, '> CLAMNET v2.4  //  otto@reef:~$ ', 7.5), Y + 6.5, { size: 7.5, color: '#2ef2a0', shadow: false });
    // connection blips
    for (let i = 0; i < 3; i++) {
      const on = Math.sin(t * (3 + i) + i) > -0.2;
      ctx.fillStyle = on ? '#2ef2a0' : 'rgba(46,242,160,0.22)';
      ctx.fillRect(X + WW - 66 + i * 5, Y + 8, 3, 6);
    }
    const cHov = mx > X + WW - 28 && mx < X + WW - 4 && my > Y + 2 && my < Y + 22;
    ctx.strokeStyle = cHov ? '#ff5a6a' : '#2ef2a0'; ctx.lineWidth = 1;
    ctx.strokeRect(X + WW - 24.5, Y + 5.5, 15, 13);
    text(ctx, 'X', X + WW - 17, Y + 7.5, { size: 8, color: cHov ? '#ff5a6a' : '#2ef2a0', align: 'center', shadow: false });

    // ---- balance readout ----
    text(ctx, 'BAL', X + WW - 116, Y + 27, { size: 6.5, color: 'rgba(125,255,207,0.6)', shadow: false });
    text(ctx, `$${G.money}`.padStart(7, ' '), X + WW - 92, Y + 25, { size: 10, color: '#2ef2a0', shadow: false });

    // ---- tabs as terminal switches ----
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = X + 12 + i * 50, ty = Y + 26, tw = 46, th = 16;
      const sel = i === this.tab;
      const hov = mx > tx && mx < tx + tw && my > ty && my < ty + th;
      ctx.fillStyle = sel ? 'rgba(46,242,160,0.20)' : (hov ? 'rgba(46,242,160,0.10)' : 'rgba(46,242,160,0.04)');
      ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = sel ? '#2ef2a0' : 'rgba(46,242,160,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
      text(ctx, `[${i + 1}]${this.TABS[i]}`, tx + tw / 2, ty + 4.5, {
        size: 6, color: sel ? '#baffe6' : 'rgba(125,255,207,0.65)', align: 'center', shadow: false });
    }

    // ---- rows as log lines ----
    const y0 = Y + 48, RH = 25;
    const vis = this._vis || 7;
    for (let i = 0; i < vis; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * RH;
      if (r.info) {
        text(ctx, '  ! ' + r.info, X + 14, ry + 8, { size: 6.5, color: '#ffd45a', shadow: false });
        continue;
      }
      const btnX = X + WW - 96, btnW = 84, btnH = 18;
      const hov = !!r.act && mx > btnX && mx < btnX + btnW && my > ry + 2 && my < ry + 2 + btnH;
      ctx.fillStyle = hov ? 'rgba(46,242,160,0.10)' : 'rgba(46,242,160,0.035)';
      ctx.fillRect(X + 12, ry, WW - 24, RH - 3);
      ctx.fillStyle = hov ? '#2ef2a0' : 'rgba(46,242,160,0.35)';
      ctx.fillRect(X + 12, ry, PIX * 3, RH - 3);
      let lx = X + 20;
      if (r.art || r.gart) {
        ctx.strokeStyle = 'rgba(46,242,160,0.3)'; ctx.lineWidth = PIX;
        ctx.strokeRect(lx - 0.5, ry + 2.5, 18, 17);
        if (r.art) drawItemIcon(ctx, r.art, lx + 9, ry + 11, 15);
        else drawAC(ctx, r.gart, lx + 9, ry + 11, 15);
        lx += 24;
      }
      text(ctx, r.label, lx, ry + 3.5, { size: 8, color: '#d8fff0', shadow: false });
      if (r.sub) text(ctx, '  ' + r.sub, lx, ry + 13, { size: 6.5, color: 'rgba(125,255,207,0.62)', shadow: false });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        const col = !active ? 'rgba(46,242,160,0.28)' : (canAfford ? '#2ef2a0' : '#ff6a7a');
        ctx.fillStyle = active && canAfford && hov ? 'rgba(46,242,160,0.24)' : 'rgba(46,242,160,0.06)';
        ctx.fillRect(btnX, ry + 2, btnW, btnH);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.strokeRect(btnX + 0.5, ry + 2.5, btnW - 1, btnH - 1);
        text(ctx, (active ? '> ' : '') + r.btn, btnX + btnW / 2, ry + 7, { size: 7.5, align: 'center', color: col, shadow: false });
      }
    }

    if (this._rows.length > vis) {
      const maxScroll = this._rows.length - vis;
      const ax = X + WW - 58, ay = y0 + vis * RH + 2;
      text(ctx, `[${this.scroll + 1}..${this.scroll + vis}/${this._rows.length}]`, X + WW / 2, Y + HH - 15,
        { size: 6.5, color: 'rgba(125,255,207,0.6)', align: 'center', shadow: false });
      for (let i = 0; i < 2; i++) {
        const canGo = i === 0 ? this.scroll > 0 : this.scroll < maxScroll;
        ctx.strokeStyle = canGo ? '#2ef2a0' : 'rgba(46,242,160,0.2)'; ctx.lineWidth = 1;
        ctx.strokeRect(ax + i * 24 + 0.5, ay + 0.5, 20, 16);
        text(ctx, i === 0 ? '^' : 'v', ax + i * 24 + 10.5, ay + 4, {
          size: 8, color: canGo ? '#2ef2a0' : 'rgba(46,242,160,0.25)', align: 'center', shadow: false });
      }
    }
    // the hint lives in the title bar — the last log line owns the bottom edge
    text(ctx, TouchUI.enabled ? 'tap X to disconnect' : '[1-5] tabs  [Esc] disconnect',
      X + WW - 74, Y + 7.5, { size: 6, color: 'rgba(125,255,207,0.5)', align: 'right', shadow: false });
    ctx.restore();
  },
};
