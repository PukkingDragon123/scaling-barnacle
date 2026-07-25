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
          icon: SPR.icons[k],
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
      const tier = (arr, cur, name, applyKey) => {
        if (cur + 1 < arr.length) {
          const nx = arr[cur + 1];
          push({
            label: nx.name, sub: `${nx.desc}  (now: ${arr[cur].name})`,
            btn: `$${nx.price}`, price: nx.price,
            act: () => this.buy(nx.price, () => { G.gear[applyKey]++; }, nx.name),
          });
        } else {
          push({ label: arr[cur].name, sub: 'Top of the line.', btn: 'MAX' });
        }
      };
      tier(SCRAPERS, G.gear.scraper, 'scraper', 'scraper');
      tier(TANKS, G.gear.tank, 'tank', 'tank');
      tier(SUITS, G.gear.suit, 'suit', 'suit');
      tier(BAGS, G.gear.bag, 'bag', 'bag');
      for (const key of ['lamp', 'gloves']) {
        const it = GEAR_SINGLES[key];
        if (G.gear[key]) push({ label: it.name, sub: it.desc, btn: 'OWNED' });
        else push({ label: it.name, sub: it.desc, btn: `$${it.price}`, price: it.price, act: () => this.buy(it.price, () => { G.gear[key] = true; }, it.name) });
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
    const maxScroll = Math.max(0, this._rows.length - 8);
    this.scroll = clamp(this.scroll, 0, maxScroll);

    if (Input.mouse.clicked) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      // close button
      if (mx > this.WX + this.WW - 18 && mx < this.WX + this.WW - 2 && my > this.WY + 2 && my < this.WY + 16) { this.close(); return; }
      // tabs
      for (let i = 0; i < this.TABS.length; i++) {
        const tx = this.WX + 10 + i * 62;
        if (mx > tx && mx < tx + 56 && my > this.WY + 20 && my < this.WY + 36) {
          this.tab = i; this.scroll = 0; SND.blip(); return;
        }
      }
      // rows
      const y0 = this.WY + 44;
      for (let i = 0; i < 8; i++) {
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
    ctx.fillStyle = 'rgba(4,8,14,0.6)';
    ctx.fillRect(0, 0, W, H);
    // window
    rrect(ctx, this.WX, this.WY, this.WW, this.WH, '#1a222c', '#3c505e');
    rrect(ctx, this.WX, this.WY, this.WW, 18, '#0e141c', '#3c505e');
    // traffic lights + title
    ['#e8434c', '#e8b84e', '#4fae6a'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(this.WX + 6 + i * 8, this.WY + 7, 4, 4);
    });
    text(ctx, 'ClamNet  ~  otto.sea/market', this.WX + 36, this.WY + 5, { size: 7, color: '#7a9aae' });
    text(ctx, 'X', this.WX + this.WW - 12, this.WY + 5, { size: 8, color: '#e8434c', align: 'center' });
    // money
    text(ctx, `$${G.money}`, this.WX + this.WW - 30, this.WY + 24, { size: 9, color: '#ffe66e', align: 'right' });
    // tabs
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = this.WX + 10 + i * 62;
      const sel = i === this.tab;
      rrect(ctx, tx, this.WY + 22, 56, 14, sel ? '#2c4654' : '#131b24', sel ? '#5ad2f0' : '#2c3a44');
      text(ctx, this.TABS[i], tx + 28, this.WY + 25, { size: 7, color: sel ? '#bfe8f5' : '#5a7484', align: 'center' });
    }
    // rows
    const y0 = this.WY + 44;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (let i = 0; i < 8; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * 23;
      if (r.info) {
        text(ctx, r.info, this.WX + 16, ry + 6, { size: 7, color: '#8aa4b4' });
        continue;
      }
      rrect(ctx, this.WX + 8, ry, this.WW - 16, 21, '#131b24', '#22303c');
      let lx = this.WX + 14;
      if (r.icon) { ctx.drawImage(r.icon, lx, ry + 6); lx += 12; }
      text(ctx, r.label, lx, ry + 3, { size: 8, color: '#e8eef2' });
      if (r.sub) text(ctx, r.sub, lx, ry + 12, { size: 6, color: '#7a94a4' });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        const hov = active && mx > this.WX + this.WW - 96 && mx < this.WX + this.WW - 12 && my > ry && my < ry + 20;
        rrect(ctx, this.WX + this.WW - 96, ry + 2, 84, 17,
          active ? (hov ? '#2c5a44' : '#1c3a2c') : '#1a222c',
          active ? (canAfford ? '#4fae6a' : '#7a4444') : '#2c3a44');
        text(ctx, r.btn, this.WX + this.WW - 54, ry + 6, {
          size: 7, align: 'center',
          color: !active ? '#5a7484' : (canAfford ? '#a0f2b4' : '#e88a8a'),
        });
      }
    }
    if (this._rows.length > 8)
      text(ctx, 'scroll for more...', this.WX + this.WW / 2, this.WY + this.WH - 12, { size: 6, color: '#5a7484', align: 'center' });
    text(ctx, '[1-4] tabs   [Esc] close', this.WX + 12, this.WY + this.WH - 12, { size: 6, color: '#5a7484' });
  },
};
