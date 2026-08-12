// ---- ClamNet: the laptop shop overlay ---------------------------------------
'use strict';

const Shop = {
  open: false,
  tab: 0,
  scroll: 0,
  // DECOR is gone and so are the house upgrades -- ClamNet sells what the sea
  // needs: your hauls out, seeds and stock in, and the piling ratings that open
  // deeper beds. BEDS keeps BUILD's old index because dev/smoke-net.js (and the
  // digit keys) address tabs by position.
  TABS: ['SELL', 'SHOP', 'GEAR', 'BEDS'],
  STALL_TAB: 1,          // Sprout's counter: seeds and livestock

  WX: 40, WY: 22, WW: 400, WH: 226,
  _rows: [],

  openUI() {
    this.open = true;
    this.tab = 0;
    this.scroll = 0;
    SND.blip();
    // (the old first-visit toast stack lived here; the journal teaches now)
  },

  close() { this.open = false; SND.click(); },

  buy(price, apply, name) {
    if (G.money < price) {
      SND.alarm();
      Game.toast('Not enough sand dollars.');
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
      if (!any) push({ info: 'Nothing in storage yet. The pilings are just outside.' });
      else push({ label: 'SELL EVERYTHING', sub: 'one big crate', btn: `$${total}`, act: () => this.sellKeys(ITEM_KEYS) });
    } else if (this.tab === this.STALL_TAB) {
      // STALL — the only place you BUY things that start a production chain.
      // Both catalogues are owned by their own module; this just renders them.
      const F = typeof Farm !== 'undefined' ? Farm : null;
      const S = typeof Stock !== 'undefined' ? Stock : null;
      if (F && F.PLOT_DEF) {
        const placed = (G.farm && G.farm.placed) || 0;
        const left = F.PLOT_DEF.length - placed;
        const held = (G.storage && G.storage.planter) || 0;
        push({ info: `GARDEN — beds go where you put them (${placed}/${F.PLOT_DEF.length} placed)` });
        push({
          gart: 'bed_1', label: 'Sea Planter',
          sub: 'Set it on the sand by the pier. Seeds go in after.' + (held ? `   (holding ${held})` : ''),
          btn: left > held ? '$40' : 'ENOUGH', price: 40,
          act: left > held ? () => {
            if (G.money < 40) { SND.alarm(); return; }
            G.money -= 40;
            G.storage.planter = held + 1;
            SND.chime();
            Game.save();
          } : null,
        });
      }
      if (F && F.SEEDS) {
        push({ info: 'SEEDS — plant on a tilled bed, water it daily' });
        for (const sd of F.SEEDS) {
          const held = F.seedCount ? F.seedCount(sd.key) : 0;
          // the LISTED price has to be the price buySeed actually charges, or
          // Sprout's standing 25% off (the seedDeal perk) reads as a bug
          const pr = F.seedPrice ? F.seedPrice(sd.key, 1) : sd.price;
          const cut = pr < sd.price;
          push({
            gart: sd.art, label: sd.name,
            sub: (sd.desc || '') + (held ? `   (holding ${held})` : '') + (cut ? '   [Sprout\'s price]' : ''),
            btn: `$${pr}`, price: pr,
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
      // KEEPSAKES -- one item, and it is not for you. Appears once somebody is at
      // eight hearts (the journal's 'A heart alongside' chapter), because selling
      // a proposal to a stranger is a strange thing for a stall to do.
      {
        let close = false;
        const f = (G && G.friends) || {};
        for (const k in f) { if (f[k] && f[k].pts >= 200) { close = true; break; } }
        if (close && !(G && G.partner)) {
          push({ info: 'KEEPSAKES -- for asking someone to stay' });
          const held = (G.storage && G.storage.pearlband) || 0;
          push({
            gart: 'open_pearl', label: 'Pearl Band',
            sub: 'A promise, worn small. Give it to someone dear.' + (held ? '   (holding 1)' : ''),
            btn: held ? 'HELD' : '$900', price: 900,
            act: held ? null : () => {
              if (G.money < 900) { SND.alarm(); return; }
              G.money -= 900;
              G.storage.pearlband = 1;
              SND.chime();
              Game.toast('The pearl band is in your pocket. No hurry.');
              Game.save();
            },
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
      // BEDS: the piling ratings, and nothing else -- the house keeps itself
      push({ info: 'DIVE BEDS -- a rated piling opens a deeper bed' });
      if (G.bridge < 3) {
        const b = G.bridge === 1 ? BUILDS.bridge2 : BUILDS.bridge3;
        push({ gart: 'dock_15', label: b.name, sub: b.desc, btn: `$${b.price}`, price: b.price, act: () => this.buy(b.price, () => { G.bridge++; }, b.name) });
      } else push({ info: 'The piling is rated for the deepest bed there is.' });
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
    // A WEBSITE, because it is one: ClamNet runs on the house laptop, and the
    // one screen in the game that is literally a computer should read as a slick
    // little storefront, not as furniture. Dark glass, cyan accents, an address
    // bar, product rows with thumbnails and a bright BUY chip -- pixel-art
    // e-commerce. Every hit rect is IDENTICAL to before (update() owns them);
    // only the paint changed.
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const t = Game.time;
    ctx.fillStyle = 'rgba(4,8,14,0.72)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#05070c';
    ctx.fillRect(X - 2, Y - 2, WW + 4, HH + 4);
    ctx.fillStyle = '#0d1622';
    ctx.fillRect(X, Y, WW, HH);
    ctx.fillStyle = 'rgba(120,220,255,0.05)';
    ctx.fillRect(X, Y, WW, 34);

    // ---- browser chrome: address bar + wallet + close --------------------------
    ctx.fillStyle = '#101c2c';
    ctx.fillRect(X, Y, WW, 20);
    ctx.fillStyle = '#39e6ff';
    ctx.fillRect(X, Y + 19.5, WW, PIX * 2);
    for (let i = 0; i < 4; i++) ctx.fillRect(X + 9 + i * 3, Y + 8 + ((i % 2) ? 2 : 0), 2, 4);
    text(ctx, 'CLAMNET', X + 24, Y + 5.5, { size: 8.5, color: '#e8fbff', shadow: false });
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(X + 78, Y + 4, 150, 12);
    ctx.fillStyle = 'rgba(57,230,255,0.35)';
    ctx.fillRect(X + 78, Y + 4, 150, PIX * 2);
    text(ctx, 'https://reef.net/shop', X + 84, Y + 6.5, { size: 6, color: '#6fa8bc', shadow: false });
    if (Math.sin(t * 4) > 0) text(ctx, '_', X + 84 + textWidth(ctx, 'https://reef.net/shop', 6), Y + 6.5, { size: 6, color: '#39e6ff', shadow: false });
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(X + WW - 96, Y + 4, 62, 12);
    drawAC(ctx, 'shell_pearl', X + WW - 88, Y + 10, 8);
    text(ctx, `$${G.money}`, X + WW - 80, Y + 6, { size: 7.5, color: '#7dffb0', shadow: false });
    const cHov = mx > X + WW - 28 && mx < X + WW - 4 && my > Y + 2 && my < Y + 22;
    ctx.fillStyle = cHov ? '#ff4a5e' : '#16283c';
    ctx.fillRect(X + WW - 24, Y + 5, 15, 11);
    text(ctx, 'X', X + WW - 16.5, Y + 6.5, { size: 7.5, color: cHov ? '#fff' : '#7ca2b8', align: 'center', shadow: false });

    // ---- nav tabs (same rects) --------------------------------------------------
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = X + 12 + i * 50, ty = Y + 26, tw = 46, th = 16;
      const sel = i === this.tab;
      const hov = mx > tx && mx < tx + tw && my > ty && my < ty + th;
      ctx.fillStyle = sel ? '#39e6ff' : (hov ? '#1c3350' : '#142639');
      ctx.fillRect(tx, ty, tw, th);
      if (sel) { ctx.fillStyle = '#0d1622'; ctx.fillRect(tx, ty + th - PIX * 2, tw, PIX * 2); }
      text(ctx, this.TABS[i], tx + tw / 2, ty + 4.5, {
        size: 6.5, align: 'center', shadow: false,
        color: sel ? '#06222c' : (hov ? '#c8ecf8' : '#6fa8bc'),
      });
    }

    // ---- product rows (same rects) ------------------------------------------------
    const y0 = Y + 48, RH = 25;
    const vis = this._vis || 7;
    for (let i = 0; i < vis; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * RH;
      if (r.info) {
        ctx.fillStyle = '#39e6ff';
        ctx.fillRect(X + 14, ry + 8, 3, 3);
        text(ctx, r.info.toUpperCase(), X + 21, ry + 6, { size: 6, color: '#6fa8bc', shadow: false });
        continue;
      }
      const btnX = X + WW - 96, btnW = 84, btnH = 18;
      const hov = !!r.act && mx > btnX && mx < btnX + btnW && my > ry + 2 && my < ry + 2 + btnH;
      ctx.fillStyle = hov ? '#1a2c42' : '#142334';
      ctx.fillRect(X + 12, ry, WW - 24, RH - 3);
      ctx.fillStyle = 'rgba(57,230,255,0.18)';
      ctx.fillRect(X + 12, ry, WW - 24, PIX * 2);
      let lx = X + 20;
      if (r.art || r.gart) {
        ctx.fillStyle = '#0d1826';
        ctx.fillRect(lx - 2, ry + 2, 20, 19);
        if (r.art) drawItemIcon(ctx, r.art, lx + 8, ry + 11.5, 15);
        else drawAC(ctx, r.gart, lx + 8, ry + 11.5, 15);
        lx += 24;
      }
      text(ctx, r.label, lx, ry + 3, { size: 8, color: '#e8fbff', shadow: false });
      if (r.sub) text(ctx, r.sub, lx, ry + 13, { size: 6.5, color: '#6fa8bc', shadow: false });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        ctx.fillStyle = !active ? '#16283c' : (canAfford ? (hov ? '#7dffcf' : '#39e6ff') : '#3c1c28');
        ctx.fillRect(btnX, ry + 2, btnW, btnH);
        if (active && canAfford) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(btnX, ry + 2, btnW, PIX * 2); }
        text(ctx, r.btn, btnX + btnW / 2, ry + 7, {
          size: 7.5, align: 'center', shadow: false,
          color: !active ? '#4a687c' : (canAfford ? '#06222c' : '#ff8a96'),
        });
      }
    }

    if (this._rows.length > vis) {
      const maxScroll = this._rows.length - vis;
      const ax = X + WW - 58, ay = y0 + vis * RH + 2;
      text(ctx, `${this.scroll + 1}-${Math.min(this.scroll + vis, this._rows.length)} of ${this._rows.length}`,
        X + WW / 2, Y + HH - 15, { size: 6.5, color: '#6fa8bc', align: 'center', shadow: false });
      for (let i = 0; i < 2; i++) {
        const canGo = i === 0 ? this.scroll > 0 : this.scroll < maxScroll;
        ctx.fillStyle = canGo ? '#1c3350' : '#111e2e';
        ctx.fillRect(ax + i * 24, ay, 20, 16);
        text(ctx, i === 0 ? '^' : 'v', ax + i * 24 + 10, ay + 4, {
          size: 8, align: 'center', shadow: false,
          color: canGo ? '#39e6ff' : '#31506a' });
      }
    }
    text(ctx, TouchUI.enabled ? 'tap X to close' : '[1-4] tabs   [Esc] close',
      X + 12, Y + HH - 13, { size: 6, color: '#39536a', shadow: false });
  },
};
