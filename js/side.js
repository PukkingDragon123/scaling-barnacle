// ---- the errand board: the quests you have to go and ASK for --------------------
//
// js/quest.js owns the STORY -- one chapter at a time, advancing by itself, with
// nobody to talk to about it. This owns the other half: seventeen errands that
// three neighbours hand out, chained into three parallel branches plus a set of
// unchained odd jobs. The data is SIDE_QUESTS in js/data.js; this is the
// machinery, and it is deliberately small:
//
//   * WHO HAS WHAT   offerFor / readyFor, so the dialogue box can put a TASK
//     button on the footer and the world can float a mark over their head
//   * TAKING IT      accept() -- state 0 -> 1, nothing else happens
//   * DOING IT       done(g), which is either an explicit test or a delivery
//   * HANDING IT IN  handIn() -- SPENDS the delivery, pays the reward, 1 -> 2
//
// THE ONE INTERESTING PROBLEM here is that this game has FOUR stashes. Shells,
// meat and materials live in G.storage; plants live in G.farm.crops; the hotbar
// holds its own stacks; and G.crafted is a legacy bin that some old saves still
// carry. A delivery of "4 Tide Berry and 2 Reef Gourd" has to count across all
// of them and spend across all of them, or the errand is unfinishable while the
// player is looking straight at the berries. _have and _spend walk the lot.
//
// State is G.side: { errandKey: 1 taken | 2 handed in }. It is a flat map of
// small integers on purpose -- Game.load's Object.assign carries it forward
// whole, and an errand key that a save has never heard of just reads 0.
'use strict';

const Side = {
  _installed: false,
  _flash: null,        // { name, money, items, t } -- the hand-in card
  _mark: 0,            // animation clock for the head marks

  // branch -> the skill its xp feeds; odd jobs fall back on their giver
  BRANCH_SKILL: { garden: 'farming', galley: 'clamming', works: 'mining' },
  GIVER_SKILL: { farmer: 'farming', angler: 'clamming', prof: 'mining' },
  BRANCH_NAME: { garden: 'The Garden', galley: 'The Galley', works: 'The Workshop', odd: 'Odd Jobs' },

  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    if (!G.side || typeof G.side !== 'object') G.side = {};
    if (!G.perks || typeof G.perks !== 'object') G.perks = {};
    return true;
  },

  // Called once on boot: an old save carries a chapter-index G.goal that no
  // longer means anything, so it is rewritten from what has actually been handed
  // in. A brand new game starts at 0 either way.
  bootGoal() {
    if (!this.ensure()) return;
    G.goal = this.mainDone();
  },

  // ---- the list ------------------------------------------------------------------
  all() { return typeof SIDE_QUESTS !== 'undefined' ? SIDE_QUESTS : []; },
  byKey(k) { for (const q of this.all()) if (q.key === k) return q; return null; },

  state(k) {
    if (!this.ensure()) return 0;
    const s = G.side[k];
    return s === 2 ? 2 : (s === 1 ? 1 : 0);
  },
  taken(k) { return this.state(k) === 1; },
  finished(k) { return this.state(k) === 2; },

  // A chain step is locked until the step before it in the SAME branch, from the
  // SAME neighbour, has been handed in. Odd jobs are all step 1, so they are only
  // ever gated by their own gate().
  _chainOpen(q) {
    if ((q.step || 1) <= 1) return true;
    for (const p of this.all()) {
      if (p.branch === q.branch && p.from === q.from && (p.step || 1) === (q.step || 1) - 1)
        return this.finished(p.key);
    }
    return true;
  },

  // offerable = never taken, chain open, gate passed
  offerable(q) {
    if (!this.ensure() || this.state(q.key) !== 0) return false;
    if (!this._chainOpen(q)) return false;
    if (q.gate && !q.gate(G)) return false;
    return true;
  },

  // The one errand this neighbour would bring up today, in list order: their
  // branch comes before their odd jobs, so a chain never stalls behind a favour.
  offerFor(npcKey) {
    for (const q of this.all()) if (q.from === npcKey && q.branch !== 'odd' && this.offerable(q)) return q;
    for (const q of this.all()) if (q.from === npcKey && q.branch === 'odd' && this.offerable(q)) return q;
    return null;
  },

  // an errand of theirs that is TAKEN and finished, waiting to be handed over
  readyFor(npcKey) {
    for (const q of this.all())
      if (q.from === npcKey && this.taken(q.key) && this.isDone(q)) return q;
    return null;
  },

  activeFor(npcKey) {
    const out = [];
    for (const q of this.all()) if (q.from === npcKey && this.taken(q.key)) out.push(q);
    return out;
  },
  active() {
    const out = [];
    for (const q of this.all()) if (this.taken(q.key)) out.push(q);
    return out;
  },
  activeCount() { return this.active().length; },
  doneCount() { let n = 0; for (const q of this.all()) if (this.finished(q.key)) n++; return n; },

  // What floats over a neighbour's head on the deck and out at sea:
  //   '?'  they are holding an errand you have not taken
  //   '!'  you are carrying one of theirs that is finished
  // '!' wins, because handing in is the thing you came over for.
  mark(npcKey) {
    if (!this.ensure()) return '';
    if (this.readyFor(npcKey)) return '!';
    if (this.offerFor(npcKey)) return '?';
    return '';
  },

  // ---- the four stashes ------------------------------------------------------------
  // Every count and every spend in this file goes through these two. Order is
  // storage, then plants, then the legacy bin, then the hotbar.
  _bins() {
    const out = [];
    if (G.storage && typeof G.storage === 'object') out.push(G.storage);
    if (G.farm && G.farm.crops && typeof G.farm.crops === 'object') out.push(G.farm.crops);
    if (G.crafted && typeof G.crafted === 'object') out.push(G.crafted);
    return out;
  },

  _have(key) {
    if (!this.ensure()) return 0;
    let n = 0;
    for (const b of this._bins()) {
      const v = Math.floor(b[key]);
      if (isFinite(v) && v > 0) n += v;
    }
    if (typeof Hotbar !== 'undefined' && Hotbar && Hotbar.count) {
      const h = Hotbar.count('item', key);
      if (isFinite(h) && h > 0) n += h;
    }
    return n;
  },

  // All or nothing: checked in full before a single unit moves, so a short
  // delivery never eats half of itself.
  _spend(key, n) {
    n = Math.max(1, Math.floor(n || 1));
    if (this._have(key) < n) return false;
    let left = n;
    for (const b of this._bins()) {
      if (left <= 0) break;
      const v = Math.floor(b[key]);
      if (!isFinite(v) || v <= 0) continue;
      const take = Math.min(v, left);
      b[key] = v - take;
      left -= take;
    }
    if (left > 0 && typeof Hotbar !== 'undefined' && Hotbar && Hotbar.take)
      left -= Hotbar.take('item', key, left) || 0;
    return left <= 0;
  },

  // Payouts route the other way: a plant goes back to the plant bin so the farm
  // ledger and the stall stay honest about where produce came from.
  _giveTo(key) {
    if (typeof Farm !== 'undefined' && Farm && Farm.CROPS) {
      for (const ck in Farm.CROPS) {
        const c = Farm.CROPS[ck];
        if (c && c.out === key && c.bin !== 'storage') return (G.farm && G.farm.crops) || G.storage;
      }
    }
    return G.storage;
  },
  _give(key, n) {
    const bin = this._giveTo(key);
    if (!bin) return;
    const v = Math.floor(bin[key]);
    bin[key] = ((isFinite(v) && v > 0) ? v : 0) + Math.max(1, Math.floor(n || 1));
  },

  // ---- progress --------------------------------------------------------------------
  prog(q) {
    if (!this.ensure() || !q) return null;
    if (q.deliver) {
      let n = 0, of = 0;
      for (const k in q.deliver) {
        const want = q.deliver[k];
        of += want;
        n += Math.min(want, this._have(k));
      }
      return { n, of };
    }
    return q.prog ? q.prog(G) : null;
  },

  isDone(q) {
    if (!this.ensure() || !q) return false;
    if (q.deliver) {
      for (const k in q.deliver) if (this._have(k) < q.deliver[k]) return false;
      return true;
    }
    return q.done ? !!q.done(G) : false;
  },

  // The delivery list, rendered for a dialogue line or a journal row:
  // "4/4 Tide Berry, 1/2 Reef Gourd"
  deliverText(q) {
    if (!q || !q.deliver) return '';
    const parts = [];
    for (const k in q.deliver) parts.push(`${Math.min(q.deliver[k], this._have(k))}/${q.deliver[k]} ${this.itemName(k)}`);
    return parts.join(',  ');
  },

  itemName(k) {
    if (typeof ITEMS !== 'undefined' && ITEMS[k] && ITEMS[k].name) return ITEMS[k].name;
    if (typeof Craft !== 'undefined' && Craft && Craft.MATS && Craft.MATS[k] && Craft.MATS[k].name) return Craft.MATS[k].name;
    if (k === 'planter') return 'Sea Planter';
    return k;
  },

  // ---- taking and handing in -------------------------------------------------------
  accept(q) {
    if (!this.ensure() || !q || !this.offerable(q)) return false;
    G.side[q.key] = 1;
    if (typeof SND !== 'undefined') SND.blip();
    if (typeof Game !== 'undefined' && Game.save) Game.save();
    return true;
  },

  handIn(q) {
    if (!this.ensure() || !q || !this.taken(q.key) || !this.isDone(q)) return false;
    // spend the delivery -- checked in full first, so a race cannot half-take it
    if (q.deliver) {
      for (const k in q.deliver) if (this._have(k) < q.deliver[k]) return false;
      for (const k in q.deliver) this._spend(k, q.deliver[k]);
    }
    G.side[q.key] = 2;

    const r = q.reward || {};
    if (r.money) G.money += r.money;
    if (r.items) for (const k in r.items) this._give(k, r.items[k]);
    if (r.seeds && G.farm && G.farm.seeds)
      for (const k in r.seeds) G.farm.seeds[k] = (G.farm.seeds[k] || 0) + r.seeds[k];
    if (r.perk) G.perks[r.perk] = true;
    if (r.xp && typeof Skills !== 'undefined' && Skills && Skills.gain)
      Skills.gain(this.BRANCH_SKILL[q.branch] || this.GIVER_SKILL[q.from] || 'clamming', r.xp);

    // the neighbour also warms to you -- an errand is a favour, and favours count
    if (typeof NPCs !== 'undefined' && NPCs && NPCs.add) {
      try { NPCs.add(q.from, 30); } catch (e) {}
    }

    this._syncGoal();
    // the burst: gold for the coin, green for the goods, thrown up out of the
    // slip so the payout has a moment instead of just appearing
    if (typeof FX !== 'undefined') {
      FX.burst(84, 48, 16, { col: '#ffd45a', spread: 46, g: 62, up: 26, s: 1, star: true, life: 0.75 });
      FX.burst(84, 48, 10, { col: '#7dffb0', spread: 34, g: 54, up: 18, s: 1, life: 0.6 });
    }
    this._flash = { name: q.name, money: r.money || 0, items: r.items || null, note: r.note || '', t: 3.0 };
    // a main-quest step gets the cinematic beat as well as the slip
    if (q.branch === 'main' && typeof Quests !== 'undefined' && Quests.complete) Quests.complete(q);
    if (q.cine && typeof Cine !== 'undefined' && Cine.play) Cine.play(q.cine);
    if (typeof SND !== 'undefined') SND.cash();
    if (typeof Game !== 'undefined' && Game.save) Game.save();
    return true;
  },

  perk(name) { return this.ensure() ? !!G.perks[name] : false; },

  // ---- the main chain --------------------------------------------------------------
  // Fintan's survey. It is an ordinary branch in every way except two: it is the
  // one G.goal counts, and the journal gives it its own page.
  main() { return typeof MAIN_QUESTS !== 'undefined' ? MAIN_QUESTS : []; },
  mainDone() { let n = 0; for (const q of this.main()) if (this.finished(q.key)) n++; return n; },
  // the step you are on: the first one not handed in
  mainNow() { for (const q of this.main()) if (!this.finished(q.key)) return q; return null; },

  // G.goal IS the main chain's progress. It used to be a chapter index that the
  // game advanced on its own; every gate in the codebase reads it (`goal >= 3`
  // unlocks an errand, the kit gifts in js/integrate.js, the shop), so it stays a
  // real saved number -- it is just written HERE now, by handing a step in, and
  // never by anything happening to you quietly.
  _syncGoal() {
    if (!this.ensure()) return;
    const n = this.mainDone();
    if (G.goal !== n) G.goal = n;
  },

  // ---- per-frame -------------------------------------------------------------------
  update(dt) {
    this._mark += dt;
    if (this._flash) {
      this._flash.t -= dt;
      if (this._flash.t <= 0) this._flash = null;
    }
  },

  // The hand-in card: a small slip in the top-left, out of the way of the
  // dialogue box that is usually still open behind it. Not a toast -- it lists
  // what you were actually paid, which is the part worth reading.
  draw(c) {
    if (!this._flash) return;
    const f = this._flash;
    const a = clamp(Math.min((3.0 - f.t) / 0.25, f.t / 0.45), 0, 1);
    const rows = [];
    if (f.money) rows.push(`+$${f.money}`);
    if (f.items) for (const k in f.items) rows.push(`+${f.items[k]}  ${this.itemName(k)}`);
    if (f.note) rows.push(f.note);
    const w = 150, h = 30 + rows.length * 10;
    const x = 10, y = 34;
    c.save();
    c.globalAlpha = a;
    uiPanel(c, x, y, w, h, 0.97, true);
    text(c, 'ERRAND DONE', x + 10, y + 7, { size: 7.5, color: '#3f7a4e', shadow: false });
    text(c, f.name, x + 10, y + 17, { size: 7, color: '#4a3020', shadow: false });
    let ry = y + 28;
    for (const r of rows) {
      text(c, r, x + 12, ry, { size: 6.5, color: r.charAt(0) === '+' ? '#3f9a58' : '#7a5c3c', shadow: false });
      ry += 10;
    }
    c.restore();
  },

  // The '?' / '!' over a neighbour's head, in pixels. Called by the NPC painters
  // with the top of the sprite, in whatever space they are drawing in.
  drawMark(c, x, y, ch, scale = 1) {
    if (!ch) return;
    const S = APIX * scale;
    const bob = Math.round(Math.sin(this._mark * 3.4) * 1.2) * S;
    const GLYPH = ch === '!'
      ? ['.oo.', 'oyyo', 'oyyo', 'oyyo', '.oo.', '....', '.oo.', 'oyyo', '.oo.']
      : ['.oo.', 'oyyo', 'o..o', '..oo', '.oyo', '.oo.', '....', '.oo.', 'oyyo'];
    const col = ch === '!' ? { o: '#3a2408', y: '#ffd45a' } : { o: '#0e2a34', y: '#7de3ff' };
    const wpx = GLYPH[0].length * S;
    // a soft plate behind it, so a gold '!' still reads against a bright sky
    c.fillStyle = 'rgba(20,12,6,0.30)';
    c.fillRect(x - wpx / 2 - S, y + bob - S, wpx + S * 2, GLYPH.length * S + S * 2);
    for (let r = 0; r < GLYPH.length; r++) {
      for (let i = 0; i < GLYPH[r].length; i++) {
        const g = GLYPH[r][i];
        if (g === '.') continue;
        c.fillStyle = col[g];
        c.fillRect(x - wpx / 2 + i * S, y + bob + r * S, S, S);
      }
    }
  },

  // ---- install ---------------------------------------------------------------------
  // Called once from js/integrate.js, after every module exists.
  install() {
    if (this._installed) return;
    this._installed = true;
    const self = this;

    // One counter the errands need that nothing else was keeping. It hangs off
    // _petApply, NOT pet(): pet() is called twice per pat (once to start the
    // sweep, once to grade it) and it returns a result object even when the
    // animal refuses, so counting there counts refusals and counts them double.
    // _petApply is the single place a pat actually lands, and it reports ok.
    if (typeof Tame !== 'undefined' && Tame && Tame._petApply) {
      const apply = Tame._petApply.bind(Tame);
      Tame._petApply = function (animal, mult, perfect) {
        const r = apply(animal, mult, perfect);
        if (r && r.ok && self.ensure() && G.stats) {
          G.stats.petted = (G.stats.petted || 0) + 1;
          if (G.qflags) G.qflags.petted = true;
        }
        return r;
      };
    }

    // ride Game.globalUpdate, the one slot that runs under every modal
    if (typeof Game !== 'undefined' && Game.globalUpdate) {
      const gu = Game.globalUpdate.bind(Game);
      Game.globalUpdate = function (dt) { gu(dt); self.update(dt); };
    }
  },
};
