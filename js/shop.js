// ---- ClamNet: the laptop shop overlay ---------------------------------------
'use strict';

const Shop = {
  open: false,
  tab: 0,
  scroll: 0,
  TABS: ['SELL', 'GEAR', 'BUILD', 'DECOR'],
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
        const tx = this.WX + 12 + i * 58;
        if (mx > tx && mx < tx + 54 && my > this.WY + 26 && my < this.WY + 42) {
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
    ctx.fillStyle = 'rgba(6,10,16,0.66)';
    ctx.fillRect(0, 0, W, H);
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    uiPanel(ctx, X, Y, WW, HH, 0.97, true);

    // header
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X + 3, Y + 3, WW - 6, 19, 2.5); else ctx.rect(X + 3, Y + 3, WW - 6, 19);
    ctx.fillStyle = '#2c5a6a'; ctx.fill();
    ctx.restore();
    text(ctx, 'ClamNet  ~  otto.sea/market', X + 12, Y + 8, { size: 8, color: '#d6f0f8', shadow: false });
    const cHov = mx > X + WW - 28 && mx < X + WW - 4 && my > Y + 2 && my < Y + 24;
    ctx.fillStyle = cHov ? '#e8434c' : '#1d3f4c';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X + WW - 24, Y + 5, 16, 15, 2.5); else ctx.rect(X + WW - 24, Y + 5, 16, 15);
    ctx.fill();
    text(ctx, 'X', X + WW - 16, Y + 8, { size: 8, color: '#d6f0f8', align: 'center', shadow: false });

    // purse
    drawAC(ctx, 'shell_pearl', X + WW - 68, Y + 32, 13);
    text(ctx, `${G.money}`, X + WW - 58, Y + 27, { size: 10, color: '#8a6420', shadow: false });

    // tabs as pills
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = X + 12 + i * 58, ty = Y + 26, tw = 54, th = 16;
      const sel = i === this.tab;
      const hov = mx > tx && mx < tx + tw && my > ty && my < ty + th;
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, 3); else ctx.rect(tx, ty, tw, th);
      ctx.fillStyle = sel ? '#7a4a2c' : (hov ? '#e6d2ae' : '#e0cba6');
      ctx.fill();
      if (!sel) { ctx.strokeStyle = 'rgba(122,74,48,0.4)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
      text(ctx, this.TABS[i], tx + tw / 2, ty + 4.5, { size: 7, color: sel ? '#ffe9c4' : '#7a5a3a', align: 'center', shadow: false });
    }

    // rows
    const y0 = Y + 48, RH = 25;
    const vis = this._vis || 7;
    for (let i = 0; i < vis; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * RH;
      if (r.info) {
        text(ctx, r.info, X + 16, ry + 8, { size: 7, color: '#8a6a4a', shadow: false });
        continue;
      }
      const btnX = X + WW - 96, btnW = 84, btnH = 18;
      const hov = !!r.act && mx > btnX && mx < btnX + btnW && my > ry + 2 && my < ry + 2 + btnH;
      // card
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X + 12, ry, WW - 24, RH - 3, 3); else ctx.rect(X + 12, ry, WW - 24, RH - 3);
      ctx.fillStyle = hov ? '#f4e2c0' : '#ecdbb8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(122,74,48,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      let lx = X + 18;
      if (r.art || r.gart) {
        ctx.fillStyle = 'rgba(122,74,48,0.14)';
        ctx.beginPath(); ctx.arc(lx + 9, ry + 11, 9.5, 0, TAU); ctx.fill();
        if (r.art) drawItemIcon(ctx, r.art, lx + 9, ry + 11, 15);
        else drawAC(ctx, r.gart, lx + 9, ry + 11, 15);
        lx += 23;
      }
      text(ctx, r.label, lx, ry + 3.5, { size: 8, color: '#4a3020', shadow: false });
      if (r.sub) text(ctx, r.sub, lx, ry + 13, { size: 6.5, color: '#8a6a4a', shadow: false });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(btnX, ry + 2, btnW, btnH, 3); else ctx.rect(btnX, ry + 2, btnW, btnH);
        ctx.fillStyle = !active ? '#d8c6a4' : (canAfford ? (hov ? '#3f9a58' : '#4aa862') : '#c88a8a');
        ctx.fill();
        ctx.strokeStyle = !active ? 'rgba(122,74,48,0.3)' : 'rgba(30,70,40,0.55)';
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        text(ctx, r.btn, btnX + btnW / 2, ry + 7, {
          size: 7.5, align: 'center', shadow: false,
          color: !active ? '#9a8464' : '#ffffff',
        });
      }
    }

    if (this._rows.length > vis) {
      const maxScroll = this._rows.length - vis;
      const ax = X + WW - 58, ay = y0 + vis * RH + 2;
      text(ctx, `${this.scroll + 1}-${this.scroll + vis} of ${this._rows.length}`, X + WW / 2, Y + HH - 15, { size: 6.5, color: '#8a6a4a', align: 'center', shadow: false });
      for (let i = 0; i < 2; i++) {
        const canGo = i === 0 ? this.scroll > 0 : this.scroll < maxScroll;
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(ax + i * 24, ay, 21, 17, 3); else ctx.rect(ax + i * 24, ay, 21, 17);
        ctx.fillStyle = canGo ? '#7a4a2c' : '#d8c6a4';
        ctx.fill(); ctx.restore();
        ctx.fillStyle = canGo ? '#ffe9c4' : '#b0a084';
        const cx2 = ax + i * 24 + 10.5, cy2 = ay + 8.5, d = i === 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(cx2, cy2 + 4 * d); ctx.lineTo(cx2 - 4.5, cy2 - 3 * d); ctx.lineTo(cx2 + 4.5, cy2 - 3 * d);
        ctx.closePath(); ctx.fill();
      }
    }
    text(ctx, TouchUI.enabled ? 'tap X to close' : '[1-4] tabs   [Esc] close', X + 14, Y + HH - 15, { size: 6.5, color: '#8a6a4a', shadow: false });
  },
};
