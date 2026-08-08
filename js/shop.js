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
    // Same geometry as ever -- update() hit-tests against these exact rects --
    // but drawn in the game's own parchment-and-wood family. This used to be a
    // green CRT terminal: charming in isolation, and the single most jarring
    // screen in the game, because nothing else looks within a decade of it.
    // The laptop fiction survives in the title line; the pixels now match the
    // world the laptop sits in.
    const X = this.WX, Y = this.WY, WW = this.WW, HH = this.WH;
    const mx = Input.mouse.x, my = Input.mouse.y;
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    uiPanel(ctx, X, Y, WW, HH, 0.98, true);

    // ---- title bar ----
    text(ctx, 'CLAMNET', X + 12, Y + 7, { size: 9, color: '#4a3020', shadow: false });
    text(ctx, "the reef's little market", X + 62, Y + 9, { size: 6.5, color: '#a4805a', shadow: false });
    // close box, same hit rect as before
    const cHov = mx > X + WW - 28 && mx < X + WW - 4 && my > Y + 2 && my < Y + 22;
    uiPanel(ctx, X + WW - 24, Y + 6, 15, 13, cHov ? 1 : 0.85, !cHov);
    text(ctx, 'X', X + WW - 16.5, Y + 8.5, { size: 8, color: cHov ? '#f6e8c9' : '#5a3a22', align: 'center', shadow: false });

    // ---- balance ----
    drawAC(ctx, 'shell_pearl', X + WW - 106, Y + 32, 10);
    text(ctx, `${G.money}`, X + WW - 98, Y + 27.5, { size: 9, color: '#4a3020', shadow: false });

    // ---- tabs ----
    for (let i = 0; i < this.TABS.length; i++) {
      const tx = X + 12 + i * 50, ty = Y + 26, tw = 46, th = 16;
      const sel = i === this.tab;
      const hov = mx > tx && mx < tx + tw && my > ty && my < ty + th;
      if (sel) {
        uiPanel(ctx, tx, ty, tw, th, 1, false);
      } else {
        ctx.fillStyle = hov ? 'rgba(138,84,52,0.25)' : 'rgba(138,84,52,0.12)';
        ctx.fillRect(tx + 1, ty + 1, tw - 2, th - 2);
      }
      text(ctx, this.TABS[i], tx + tw / 2, ty + 4.5, {
        size: 6.5, align: 'center', shadow: false,
        color: sel ? '#f6e8c9' : (hov ? '#4a3020' : '#8a6a48'),
      });
    }

    // ---- rows ----
    const y0 = Y + 48, RH = 25;
    const vis = this._vis || 7;
    for (let i = 0; i < vis; i++) {
      const r = this._rows[i + this.scroll];
      if (!r) break;
      const ry = y0 + i * RH;
      if (r.info) {
        text(ctx, r.info, X + 16, ry + 8, { size: 6.5, color: '#8a6a48', shadow: false });
        continue;
      }
      const btnX = X + WW - 96, btnW = 84, btnH = 18;
      const hov = !!r.act && mx > btnX && mx < btnX + btnW && my > ry + 2 && my < ry + 2 + btnH;
      // a soft parchment-shade band per row, darker under the pointer
      ctx.fillStyle = hov ? 'rgba(138,84,52,0.16)' : 'rgba(138,84,52,0.07)';
      ctx.fillRect(X + 12, ry, WW - 24, RH - 3);
      let lx = X + 20;
      if (r.art || r.gart) {
        ctx.fillStyle = 'rgba(90,52,30,0.14)';
        ctx.fillRect(lx - 1, ry + 2, 19, 18);
        if (r.art) drawItemIcon(ctx, r.art, lx + 9, ry + 11, 15);
        else drawAC(ctx, r.gart, lx + 9, ry + 11, 15);
        lx += 24;
      }
      text(ctx, r.label, lx, ry + 3.5, { size: 8, color: '#4a3020', shadow: false });
      if (r.sub) text(ctx, r.sub, lx, ry + 13, { size: 6.5, color: '#8a6a48', shadow: false });
      if (r.btn) {
        const canAfford = r.price === undefined || G.money >= r.price;
        const active = !!r.act;
        if (active) uiPanel(ctx, btnX, ry + 2, btnW, btnH, hov ? 1 : 0.9, !canAfford);
        else { ctx.fillStyle = 'rgba(138,84,52,0.12)'; ctx.fillRect(btnX, ry + 2, btnW, btnH); }
        text(ctx, r.btn, btnX + btnW / 2, ry + 7, {
          size: 7.5, align: 'center', shadow: false,
          color: !active ? '#a4805a' : (canAfford ? '#f6e8c9' : '#b0483c'),
        });
      }
    }

    if (this._rows.length > vis) {
      const maxScroll = this._rows.length - vis;
      const ax = X + WW - 58, ay = y0 + vis * RH + 2;
      text(ctx, `${this.scroll + 1}-${this.scroll + vis} of ${this._rows.length}`, X + WW / 2, Y + HH - 15,
        { size: 6.5, color: '#a4805a', align: 'center', shadow: false });
      for (let i = 0; i < 2; i++) {
        const canGo = i === 0 ? this.scroll > 0 : this.scroll < maxScroll;
        uiPanel(ctx, ax + i * 24, ay, 20, 16, canGo ? 0.95 : 0.5, false);
        text(ctx, i === 0 ? '^' : 'v', ax + i * 24 + 10, ay + 4, {
          size: 8, align: 'center', shadow: false,
          color: canGo ? '#f6e8c9' : 'rgba(246,232,201,0.4)' });
      }
    }
    text(ctx, TouchUI.enabled ? 'tap X to close' : '[1-5] tabs   [Esc] close',
      X + 12, Y + HH - 13, { size: 6, color: '#a4805a', shadow: false });
  },
};
