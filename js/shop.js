// ---- ClamNet: the laptop shop overlay ---------------------------------------
'use strict';

const Shop = {
  open: false,
  tab: 0,
  scroll: 0,
  TABS: ['SELL', 'GEAR', 'BUILD', 'DECOR'],
  WX: 24, WY: 16, WW: 432, WH: 238,
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
    } else if (this.tab === 1) {
      // GEAR
      const tier = (arr, cur, applyKey, gart) => {
        if (cur + 1 < arr.length) {
          const nx = arr[cur + 1];
          push({
            gart, label: nx.name, sub: `${nx.desc}  (now: ${arr[cur].name})`,
            btn: `$${nx.price}`, price: nx.price,
            act: () => this.buy(nx.price, () => { G.gear[applyKey]++; }, nx.name),
          });
        } else {
          push({ gart, label: arr[cur].name, sub: 'Top of the line.', btn: 'MAX' });
        }
      };
      tier(SCRAPERS, G.gear.scraper, 'scraper', 'g_scraper');
      tier(PRYBARS, G.gear.pry, 'pry', 'g_crowbar');
      tier(TANKS, G.gear.tank, 'tank', 'g_tank');
      tier(SUITS, G.gear.suit, 'suit', 'g_suit');
      tier(BAGS, G.gear.bag, 'bag', 'g_netbag');
      const singleArt = { lamp: 'g_torch', gloves: 'g_plier' };
      for (const key of ['lamp', 'gloves']) {
        const it = GEAR_SINGLES[key];
        if (G.gear[key]) push({ gart: singleArt[key], label: it.name, sub: it.desc, btn: 'OWNED' });
        else push({ gart: singleArt[key], label: it.name, sub: it.desc, btn: `$${it.price}`, price: it.price, act: () => this.buy(it.price, () => { G.gear[key] = true; }, it.name) });
      }
    } else if (this.tab === 2) {
      // BUILD
      if (G.bridge < 3) {
        const b = G.bridge === 1 ? BUILDS.bridge2 : BUILDS.bridge3;
        push({ label: b.name, sub: b.desc, btn: `$${b.price}`, price: b.price, act: () => this.buy(b.price, () => { G.bridge++; }, b.name) });
      } else push({ info: 'The bridge reaches as far as it can go.' });
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
    for (let i = 0; i < 4; i++)
      if (Input.p('Digit' + (i + 1))) { this.tab = i; this.scroll = 0; SND.blip(); }
    this.scroll = clamp(this.scroll + Input.wheelDelta, 0, 30);

    this._rows = this.buildRows();
    // when the list overflows, the 8th row band becomes the scroll-arrow strip
    this._vis = this._rows.length > 8 ? 7 : 8;
    const maxScroll = Math.max(0, this._rows.length - this._vis);
    this.scroll = clamp(this.scroll, 0, maxScroll);

    if (Input.mouse.clicked) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      // close button (generous hit box for touch)
      if (mx > this.WX + this.WW - 26 && mx < this.WX + this.WW + 4 && my > this.WY - 4 && my < this.WY + 20) { this.close(); return; }
      // scroll arrows (touch has no wheel)
      const ay = this.WY + 44 + 7 * 23;
      if (maxScroll > 0 && mx > this.WX + this.WW - 56 && mx < this.WX + this.WW - 8 && my > ay && my < ay + 20) {
        this.scroll = clamp(this.scroll + (mx > this.WX + this.WW - 32 ? 1 : -1), 0, maxScroll);
        SND.blip();
        return;
      }
      // tabs
      for (let i = 0; i < this.TABS.length; i++) {
        const tx = this.WX + 10 + i * 62;
        if (mx > tx && mx < tx + 56 && my > this.WY + 20 && my < this.WY + 36) {
          this.tab = i; this.scroll = 0; SND.blip(); return;
        }
      }
      // rows
      const y0 = this.WY + 44;
      for (let i = 0; i < this._vis; i++) {
        const r = this._rows[i + this.scroll];
        if (!r || r.info || !r.act) continue;
        const ry = y0 + i * 23;
        if (mx > this.WX + this.WW - 96 && mx < this.WX + this.WW - 12 && my > ry && my < ry + 20) {
          r.act();
          return;
        }
      }
    }
  },

  draw(ctx) {
    // dim world behind
    ctx.fillStyle = 'rgba(4,8,14,0.62)';
    ctx.fillRect(0, 0, W, H);
    // driftwood window
    uiPanel(ctx, this.WX, this.WY, this.WW, this.WH, 0.97);
    // title bar
    ctx.fillStyle = 'rgba(58,42,22,0.95)';
    ctx.fillRect(this.WX + 2, this.WY + 2, this.WW - 4, 15);
    ctx.fillStyle = 'rgba(230,200,150,0.25)';
    ctx.fillRect(this.WX + 2, this.WY + 2, this.WW - 4, PIX);
    // little shell buttons
    ['#e8434c', '#e8b84e', '#4fae6a'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(this.WX + 9 + i * 8, this.WY + 9.5, 2.2, 0, TAU); ctx.fill();
    });
    text(ctx, 'ClamNet  ~  otto.sea/market', this.WX + 36, this.WY + 6, { size: 7, color: '#d8c8a8' });
    text(ctx, 'X', this.WX + this.WW - 11, this.WY + 5.5, { size: 8, color: '#e8434c', align: 'center' });
    // money with coin
    drawSpr(ctx, SPR.coin, this.WX + this.WW - 52, this.WY + 22);
    text(ctx, `${G.money}`, this.WX + this.WW - 42, this.WY + 23, { size: 9, color: '#ffe66e' });
    // tabs as hanging wooden tags
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = this.WX + 10 + i * 62;
      const sel = i === this.tab;
      ctx.fillStyle = sel ? '#7a5c34' : '#2e2314';
      ctx.fillRect(tx, this.WY + 21, 56, 15);
      ctx.fillStyle = sel ? 'rgba(255,235,190,0.4)' : 'rgba(255,235,190,0.08)';
      ctx.fillRect(tx, this.WY + 21, 56, 1);
      ctx.fillStyle = sel ? '#c8a03c' : '#4a3a20';
      ctx.fillRect(tx + 26, this.WY + 23, 3, 3);
      text(ctx, this.TABS[i], tx + 28, this.WY + 27, { size: 7, color: sel ? '#ffe6b0' : '#8a7758', align: 'center' });
    }
    // rows: card slats
    const y0 = this.WY + 44;
    const vis = this._vis || 8;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (let i = 0; i < vis; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * 23;
      if (r.info) {
        text(ctx, r.info, this.WX + 16, ry + 6, { size: 7, color: '#b8a888' });
        continue;
      }
      ctx.fillStyle = 'rgba(56,42,24,0.55)';
      ctx.fillRect(this.WX + 8, ry, this.WW - 16, 21);
      ctx.fillStyle = 'rgba(230,200,150,0.12)';
      ctx.fillRect(this.WX + 8, ry, this.WW - 16, PIX);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(this.WX + 8, ry + 20.5, this.WW - 16, PIX);
      let lx = this.WX + 14;
      if (r.art) { drawItemIcon(ctx, r.art, lx + 6, ry + 10.5, 13); lx += 15; }
      else if (r.gart) { drawAC(ctx, r.gart, lx + 6, ry + 10.5, 13); lx += 15; }
      text(ctx, r.label, lx, ry + 3, { size: 8, color: '#f4e8cc' });
      if (r.sub) text(ctx, r.sub, lx, ry + 12, { size: 6, color: '#a89272' });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        const hov = active && mx > this.WX + this.WW - 96 && mx < this.WX + this.WW - 12 && my > ry && my < ry + 20;
        rrect(ctx, this.WX + this.WW - 96, ry + 2, 84, 17,
          active ? (hov ? '#2c5a44' : '#1c3a2c') : 'rgba(24,18,10,0.7)',
          active ? (canAfford ? '#4fae6a' : '#7a4444') : '#4a3a24');
        text(ctx, r.btn, this.WX + this.WW - 54, ry + 6, {
          size: 7, align: 'center',
          color: !active ? '#6a5a42' : (canAfford ? '#a0f2b4' : '#e88a8a'),
        });
      }
    }
    if (this._rows.length > vis) {
      text(ctx, `${this.scroll + 1}-${this.scroll + vis} of ${this._rows.length}`, this.WX + this.WW / 2, this.WY + this.WH - 12, { size: 6, color: '#8a7758', align: 'center' });
      // tappable scroll arrows in the freed 8th-row band
      const maxScroll = this._rows.length - vis;
      const ax = this.WX + this.WW - 56, ay = y0 + 7 * 23;
      for (let i = 0; i < 2; i++) {
        const canGo = i === 0 ? this.scroll > 0 : this.scroll < maxScroll;
        uiPanel(ctx, ax + i * 24, ay, 22, 19, canGo ? 0.92 : 0.4);
        ctx.fillStyle = canGo ? '#efe0bc' : '#5a4c34';
        const cx2 = ax + i * 24 + 11, cy2 = ay + 9.5, d = i === 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(cx2, cy2 + 4 * d); ctx.lineTo(cx2 - 5, cy2 - 3 * d); ctx.lineTo(cx2 + 5, cy2 - 3 * d);
        ctx.closePath(); ctx.fill();
      }
    }
    text(ctx, TouchUI.enabled ? 'tap X to close' : '[1-4] tabs   [Esc] close', this.WX + 12, this.WY + this.WH - 12, { size: 6, color: '#8a7758' });
  },
};
