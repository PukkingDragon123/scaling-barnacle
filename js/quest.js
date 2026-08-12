// ---- the journal: the story, the letter, and the little hooks ------------------
//
// The questline itself lives in js/data.js (QUESTS); main.js advances it and
// draws the banner. This module is everything around that:
//
//   * the OPENING LETTER, shown once over the dock on a brand new game, because a
//     game about inheriting a pier should start with the letter that says so
//   * the JOURNAL ([J], or click the banner): every chapter with who it came
//     from, its few lines of story, and a tick when it is done
//   * the PROGRESS HOOKS for the two chapters no existing stat covers -- planting
//     something and petting something -- set by wrapping Farm.plant and Tame.pet
//   * completion REWARDS, called from main.js when a chapter ticks over
//
// Written like every other modal here: one object, G-backed state, no per-frame
// allocation, and every outside reference typeof-guarded so a missing module
// degrades to "that feature is absent".
'use strict';

const Quests = {
  open: false,
  letter: false,       // the opening letter is on screen
  scroll: 0,           // first visible chapter row
  tab: 0,              // 0 STORY, 1 ERRANDS
  escroll: 0,          // first visible errand row
  _installed: false,
  _pulse: 0,           // banner glow when a chapter just finished

  ROWS: 7,             // chapter rows on screen at once
  EROWS: 5,            // errand rows (taller: they carry progress and a giver)

  // ---- the letter -------------------------------------------------------------
  // Quiet on purpose. It sets the whole register for the game's writing: an
  // uncle would not write "EMBARK ON YOUR ADVENTURE", he would mention a plank.
  LETTER: [
    'Otto --',
    '',
    'Your uncle Almar has left the pier to you. It stands',
    'a little east of my study, and it stands empty, which',
    'suits neither of us.',
    '',
    'Come and see it. The sea out front is generous if you',
    'are patient with it, and the neighbours are good folk,',
    'even the one who pretends not to be.',
    '',
    'I will be at the visitor post most mornings.',
    '',
    '                                -- Prof. F. Bellwether',
  ],

  GIVER_NAMES: { prof: 'Fintan', sprout: 'Sprout', angler: 'Marlow', farmer: 'Sprout', letter: 'the letter' },
  GIVER_ART: { prof: 'prof_0', sprout: 'dfarm_0', farmer: 'dfarm_0', angler: 'angler_0', letter: null },

  ensure() {
    if (typeof G === 'undefined' || !G) return false;
    if (!G.qflags || typeof G.qflags !== 'object') G.qflags = {};
    return true;
  },

  // ---- install ------------------------------------------------------------------
  // Called once from js/integrate.js. Wraps stay tiny: set a flag, nothing else.
  install() {
    if (this._installed) return;
    this._installed = true;
    const self = this;

    if (typeof Farm !== 'undefined' && Farm && Farm.plant) {
      const plant = Farm.plant.bind(Farm);
      Farm.plant = function (i, k) {
        const r = plant(i, k);
        if (r && self.ensure()) G.qflags.planted = true;
        return r;
      };
    }
    // (The petted flag is set by js/side.js, which hooks Tame._petApply -- the
    // one place a pat actually lands. This used to wrap Tame.pet and test
    // `r !== false`, but pet() returns a result object even for a refusal, so
    // the chapter ticked over the first time an animal bolted from you.)
  },

  // ---- completion --------------------------------------------------------------
  // main.js calls this the moment a chapter's condition comes true. The reward is
  // deliberately small -- the chapter was the point -- and the toast reads like a
  // note, not a fanfare.
  complete(q) {
    if (!this.ensure() || !q) return;
    const r = q.reward || {};
    if (r.money) {
      G.money += r.money;
      if (typeof SND !== 'undefined') SND.chime();
    }
    // the cinematic beat: letterbox bars slide in, the chapter's name gets its
    // tick, the reward reads under it, and the frame hands back. ~2.4s, skippable
    // by anything.
    this._card = { name: q.name, money: r.money || 0, note: r.note || '', t: 2.4 };
    this._pulse = 3;
  },

  // ---- per-frame ----------------------------------------------------------------
  update(dt) {
    if (!this.ensure()) return;
    if (this._pulse > 0) this._pulse -= dt;
    if (this._card) {
      this._card.t -= dt;
      if (this._card.t <= 0 || (typeof Input !== 'undefined' &&
          (Input.p('KeyE') || Input.p('Escape') || Input.mouse.clicked))) this._card = null;
    }

    // the letter owns every key while it is up; folding it away starts chapter one
    if (this.letter) {
      if (typeof Input !== 'undefined' &&
          (Input.p('KeyE') || Input.p('Enter') || Input.p('Space') || Input.p('Escape') || Input.mouse.clicked)) {
        this.letter = false;
        G.flags.letter = true;
        if (typeof SND !== 'undefined') SND.blip();
        Game.save();
      }
      return;
    }
    // (The letter is ARMED by the title menu, not here: TitleScene sets
    // Quests.letter when the player walks in through the front door. Anything
    // that jumps straight into a scene -- which is every headless test -- never
    // gets parked behind a prop it has no key to dismiss.)

    if (this.open) {
      const total = QUESTS.length;
      if (Input.p('Escape') || Input.p('KeyJ')) { this.open = false; SND.blip(); return; }
      if (Input.mouse.clicked && this._xRect) {
        const r = this._xRect, m = Input.mouse;
        if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) {
          this.open = false; SND.click(); return;
        }
      }
      // the two tabs: click them, or flick left/right
      if (Input.mouse.clicked && this._tabRects) {
        for (let i = 0; i < this._tabRects.length; i++) {
          const r = this._tabRects[i], m = Input.mouse;
          if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) {
            if (this.tab !== i) { this.tab = i; SND.click(); }
            return;
          }
        }
      }
      if (Input.p('ArrowRight') || Input.p('KeyD') || Input.p('Tab')) { this.tab = 1 - this.tab; SND.click(); return; }
      if (Input.p('ArrowLeft') || Input.p('KeyA')) { this.tab = 1 - this.tab; SND.click(); return; }

      if (this.tab === 1) {
        const rows = this._errandRows().length;
        const maxE = Math.max(0, rows - this.EROWS);
        if (Input.p('ArrowDown') || Input.p('KeyS')) this.escroll = Math.min(maxE, this.escroll + 1);
        if (Input.p('ArrowUp') || Input.p('KeyW')) this.escroll = Math.max(0, this.escroll - 1);
        if (Input.wheelDelta) this.escroll = clamp(this.escroll + Math.sign(Input.wheelDelta), 0, maxE);
        return;
      }
      if (Input.p('ArrowDown') || Input.p('KeyS')) this.scroll = Math.min(Math.max(0, Math.min(G.goal || 0, total - 1) - this.ROWS + 1), this.scroll + 1);
      if (Input.p('ArrowUp') || Input.p('KeyW')) this.scroll = Math.max(0, this.scroll - 1);
      if (Input.wheelDelta) this.scroll = clamp(this.scroll + Math.sign(Input.wheelDelta), 0, Math.max(0, total - this.ROWS));
      return;
    }

    // [J] opens the journal anywhere a modal is not already up
    if (Input.p('KeyJ') && !this._otherModal()) {
      this.open = true;
      // open ON the current chapter, with a row of context above it
      this.scroll = clamp((G.goal || 0) - 1, 0, Math.max(0, QUESTS.length - this.ROWS));
      SND.blip();
    }
  },

  _otherModal() {
    const up = (m) => typeof m !== 'undefined' && m && m.open;
    return (typeof Shop !== 'undefined' && Shop.open) || (typeof Bench !== 'undefined' && Bench.open) ||
      up(typeof Inv !== 'undefined' ? Inv : null) || up(typeof Skills !== 'undefined' ? Skills : null) ||
      up(typeof NPCs !== 'undefined' ? NPCs : null) || up(typeof Craft !== 'undefined' ? Craft : null) ||
      up(typeof Farm !== 'undefined' ? Farm : null) || up(typeof Tame !== 'undefined' ? Tame : null) ||
      up(typeof MapChart !== 'undefined' ? MapChart : null) ||
      (typeof Game !== 'undefined' && Game.helpOpen);
  },

  // ---- drawing -------------------------------------------------------------------
  draw(c) {
    if (this.letter) { this._drawLetter(c); return; }
    if (this.open) { this._drawJournal(c); return; }
    if (this._card) this._drawCard(c);
  },

  // the letterboxed chapter card: bars ease in, the name and its tick sit centre
  _drawCard(c) {
    const k = this._card.t;
    const inK = clamp((2.4 - k) / 0.3, 0, 1);
    const outK = clamp(k / 0.4, 0, 1);
    const a = Math.min(inK, outK);
    const bar = 22 * a;
    c.fillStyle = 'rgba(8,8,10,0.92)';
    c.fillRect(0, 0, W, bar);
    c.fillRect(0, H - bar, W, bar);
    c.globalAlpha = a;
    const cy = H / 2 - 70;
    // the tick, big, drawn in pixels
    c.fillStyle = '#3f9a58';
    c.fillRect(W / 2 - 12, cy + 5, 3, 5);
    c.fillRect(W / 2 - 9, cy + 8, 3, 3);
    c.fillRect(W / 2 - 6, cy + 2, 3, 6);
    c.fillRect(W / 2 - 3, cy - 2, 3, 4);
    text(c, this._card.name, W / 2 + 10, cy, { size: 11, color: '#ffe6b0', align: 'left' });
    if (this._card.money) text(c, `+$${this._card.money}`, W / 2, cy + 16, { size: 8, color: '#7dffb0', align: 'center' });
    if (this._card.note) text(c, this._card.note, W / 2, cy + 27, { size: 7, color: '#c8d8dc', align: 'center' });
    c.globalAlpha = 1;
  },

  _drawLetter(c) {
    c.fillStyle = 'rgba(6,10,16,0.62)';
    c.fillRect(0, 0, W, H);
    const w = 300, h = 190, x = (W - w) / 2, y = (H - h) / 2 - 4;
    // paper, not a UI panel: the letter is a prop, and it reads better warm
    c.fillStyle = '#f2e6c8';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#e0d0ac';
    c.fillRect(x, y + h - 4, w, 4);
    c.fillRect(x + w - 4, y, 4, h);
    c.strokeStyle = 'rgba(90,64,38,0.5)';
    c.lineWidth = PIX * 2;
    c.strokeRect(x + 3, y + 3, w - 6, h - 6);
    let ly = y + 16;
    for (let i = 0; i < this.LETTER.length; i++) {
      text(c, this.LETTER[i], x + 18, ly, { size: 7, color: '#5a4026', shadow: false });
      ly += this.LETTER[i] === '' ? 5 : 11;
    }
    if (Math.sin((typeof Game !== 'undefined' ? Game.time : 0) * 3) > -0.4) {
      text(c, '[E] fold it away', W / 2, y + h + 10, { size: 7, color: '#ffe6b0', align: 'center' });
    }
  },

  // The ERRANDS page, as rows: every ACTIVE errand first (they are what you are
  // meant to be doing), then what is on offer near you, then the ones you have
  // handed in, newest branch order. Built fresh each frame -- seventeen entries,
  // three predicates, and it saves keeping a second copy of the list in sync.
  _errandRows() {
    const rows = [];
    if (typeof Side === 'undefined' || !Side || !Side.ensure()) return rows;
    // the main chain has its own page; this one is everything else
    const all = Side.all().filter((q) => q.branch !== 'main');
    for (const q of all) if (Side.taken(q.key)) rows.push({ q, kind: Side.isDone(q) ? 'ready' : 'active' });
    for (const q of all) if (Side.offerable(q)) rows.push({ q, kind: 'offer' });
    for (const q of all) if (Side.finished(q.key)) rows.push({ q, kind: 'done' });
    return rows;
  },

  _drawJournal(c) {
    this.ensure();
    c.fillStyle = 'rgba(6,10,16,0.6)';
    c.fillRect(0, 0, W, H);
    const w = 380, h = 216, x = (W - w) / 2, y = (H - h) / 2;
    uiPanel(c, x, y, w, h, 0.98, true);

    // header: the star, the name, the count, and a real close box
    c.fillStyle = '#e8a93c';
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + i * TAU / 5;
      const ang2 = ang + TAU / 10;
      c.lineTo(x + 17 + Math.cos(ang) * 4.5, y + 12 + Math.sin(ang) * 4.5);
      c.lineTo(x + 17 + Math.cos(ang2) * 2, y + 12 + Math.sin(ang2) * 2);
    }
    c.closePath(); c.fill();
    text(c, "OTTO'S JOURNAL", x + 26, y + 8, { size: 10, color: '#4a3020', shadow: false });

    // ---- the two tabs, drawn as paper index tabs on the right of the header --
    // STORY is the chapters that happen to you; ERRANDS is the jobs you were
    // asked for. The errand tab carries a live count of what is waiting, since
    // that is the number a player actually wants at a glance.
    {
      const nAct = (typeof Side !== 'undefined' && Side && Side.ensure()) ? Side.activeCount() : 0;
      const labels = ['SURVEY', nAct ? `ERRANDS ${nAct}` : 'ERRANDS'];
      this._tabRects = [];
      let tx = x + 168;
      for (let i = 0; i < 2; i++) {
        const tw = Math.max(46, textWidth(c, labels[i], 7) + 14);
        const rc = { x: tx, y: y + 4, w: tw, h: 17 };
        this._tabRects.push(rc);
        const on = this.tab === i;
        const hov = Input.mouse.x >= rc.x && Input.mouse.x <= rc.x + rc.w &&
          Input.mouse.y >= rc.y && Input.mouse.y <= rc.y + rc.h;
        c.fillStyle = on ? '#f2dfae' : (hov ? '#dcc48f' : '#c9ab78');
        c.fillRect(rc.x, rc.y, rc.w, rc.h);
        c.fillStyle = '#8a6a44';
        c.fillRect(rc.x, rc.y, rc.w, 1);
        c.fillRect(rc.x, rc.y, 1, rc.h);
        c.fillRect(rc.x + rc.w - 1, rc.y, 1, rc.h);
        if (!on) { c.fillStyle = 'rgba(90,60,34,0.22)'; c.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 1); }
        text(c, labels[i], rc.x + rc.w / 2, rc.y + 4, {
          size: 7, align: 'center', shadow: false, color: on ? '#4a3020' : '#6d4f30' });
        tx += tw + 3;
      }
    }
    // no total: a notebook does not know how long the story is going to be
    const xr = { x: x + w - 26, y: y + 6, w: 17, h: 14 };
    this._xRect = xr;
    const hovX = Input.mouse.x >= xr.x && Input.mouse.x <= xr.x + xr.w &&
      Input.mouse.y >= xr.y && Input.mouse.y <= xr.y + xr.h;
    uiPanel(c, xr.x, xr.y, xr.w, xr.h, hovX ? 1 : 0.85, !hovX);
    text(c, 'X', xr.x + xr.w / 2, y + 8.5, { size: 8, color: hovX ? '#f6e8c9' : '#5a3a22', align: 'center', shadow: false });
    // a rope divider under the header: two-tone dashes, the pier's own line
    for (let dx2 = x + 12; dx2 < x + w - 12; dx2 += 6) {
      c.fillStyle = '#b08a5c';
      c.fillRect(dx2, y + 22, 4, 1.5);
      c.fillStyle = '#8a6a44';
      c.fillRect(dx2 + 1, y + 23.5, 4, 1);
    }

    if (this.tab === 1) { this._drawErrands(c, x, y, w, h); return; }

    const rowH = 26, listY = y + 29;
    const S_ = (typeof Side !== 'undefined' && Side && Side.ensure()) ? Side : null;
    const chain = S_ ? S_.main() : (typeof QUESTS !== 'undefined' ? QUESTS : []);
    const cur = S_ ? S_.mainDone() : (G.goal || 0);
    for (let i = 0; i < this.ROWS; i++) {
      const qi = this.scroll + i;
      if (qi >= chain.length) break;
      // a notebook does not list what has not happened yet: nothing is written
      // past the line you are on
      if (qi > cur) break;
      const q = chain[qi];
      const ry = listY + i * rowH;
      const done = qi < cur, active = qi === cur;
      const known = qi <= cur;
      const took = active && S_ ? S_.taken(q.key) : false;

      if (active) {
        c.fillStyle = 'rgba(232,169,60,0.16)';
        c.fillRect(x + 8, ry - 2, w - 16, rowH - 2);
      }

      // a CHECKBOX, because this page is a to-do list: inked square, ticked in
      // green when the chapter is done
      c.fillStyle = '#5a3c22';
      c.fillRect(x + 15, ry + 1, 11, 11);
      c.fillStyle = '#f2dfae';
      c.fillRect(x + 16.5, ry + 2.5, 8, 8);
      if (done) {
        c.fillStyle = '#3f9a58';
        c.fillRect(x + 17.5, ry + 6, 2, 3);
        c.fillRect(x + 19.5, ry + 7.5, 2, 2);
        c.fillRect(x + 21.5, ry + 4.5, 2, 4);
        c.fillRect(x + 23, ry + 3, 1.5, 2);
      }

      // state mark: a drawn tick, a star, or a dot
      const nm = known ? q.name : '. . .';
      text(c, nm, x + 34, ry, {
        size: 8, shadow: false,
        color: done ? '#8a7458' : (active ? '#4a3020' : '#a4805a'),
      });
      if (active) {
        // one line of the brief, then HOW in gold: the journal doubles as the
        // tutorial and the how-line carries the actual keys. An untaken step
        // says so instead -- you cannot be working on something you never took.
        if (!took) {
          text(c, 'not taken yet -- go and ask Fintan for it', x + 40, ry + 9,
            { size: 6.5, color: '#a4805a', shadow: false });
        } else {
          const lines = q.brief || [];
          if (lines.length) text(c, lines[0], x + 40, ry + 9, { size: 6.5, color: '#7a5c3c', shadow: false });
          if (q.how) text(c, q.how, x + 40, ry + 16, { size: 6.5, color: '#a8742a', shadow: false });
        }
        const rw = q.reward || {};
        if (rw.money) {
          text(c, `reward  $${rw.money}`, x + w - 16, ry, { size: 6.5, color: '#3f9a58', align: 'right', shadow: false });
        }
        const p = took && S_ ? S_.prog(q) : null;
        if (p) text(c, S_ && S_.isDone(q) ? 'ready' : `${p.n}/${p.of}`, x + w - 16, ry + 9,
          { size: 6.5, color: (S_ && S_.isDone(q)) ? '#3f9a58' : '#a4805a', align: 'right', shadow: false });
      } else if (done && q.from) {
        text(c, `for ${this.GIVER_NAMES[q.from] || q.from}`, x + 40, ry + 9, { size: 6.5, color: '#b09878', shadow: false });
      }
    }

    if (this.scroll > 0) text(c, '^', x + w - 14, listY, { size: 8, color: '#a4805a', shadow: false });
    if (this.scroll + this.ROWS < chain.length)
      text(c, 'v', x + w - 14, listY + this.ROWS * rowH - 12, { size: 8, color: '#a4805a', shadow: false });
    text(c, '[J] close   arrows scroll   [Tab] errands', x + 12, y + h - 12, { size: 6.5, color: '#a4805a', shadow: false });
  },

  // The errand page. Taller rows than the story page, because an errand has to
  // show four things a chapter does not: WHO wants it, WHAT it wants, HOW FAR
  // ALONG it is, and WHAT IT PAYS. A player deciding what to do next is reading
  // exactly those four.
  _drawErrands(c, x, y, w, h) {
    const rows = this._errandRows();
    const rowH = 34, listY = y + 29;
    const maxE = Math.max(0, rows.length - this.EROWS);
    this.escroll = clamp(this.escroll, 0, maxE);

    if (!rows.length) {
      text(c, 'Nobody has asked you for anything yet.', x + 22, y + 44, { size: 8, color: '#7a5c3c', shadow: false });
      text(c, 'Go and talk to the neighbours. They all want', x + 22, y + 58, { size: 6.5, color: '#a4805a', shadow: false });
      text(c, 'something, and they are all too polite to shout it.', x + 22, y + 68, { size: 6.5, color: '#a4805a', shadow: false });
      text(c, '[J] close   [Tab] the survey', x + 12, y + h - 12, { size: 6.5, color: '#a4805a', shadow: false });
      return;
    }

    for (let i = 0; i < this.EROWS; i++) {
      const ri = this.escroll + i;
      if (ri >= rows.length) break;
      const row = rows[ri], q = row.q;
      const ry = listY + i * rowH;
      const done = row.kind === 'done', ready = row.kind === 'ready', offer = row.kind === 'offer';

      if (ready) { c.fillStyle = 'rgba(63,154,88,0.18)'; c.fillRect(x + 8, ry - 2, w - 16, rowH - 3); }
      else if (row.kind === 'active') { c.fillStyle = 'rgba(232,169,60,0.14)'; c.fillRect(x + 8, ry - 2, w - 16, rowH - 3); }

      // the checkbox, ticked when handed in
      c.fillStyle = '#5a3c22';
      c.fillRect(x + 15, ry + 1, 11, 11);
      c.fillStyle = offer ? '#e6d2a2' : '#f2dfae';
      c.fillRect(x + 16.5, ry + 2.5, 8, 8);
      if (done) {
        c.fillStyle = '#3f9a58';
        c.fillRect(x + 17.5, ry + 6, 2, 3);
        c.fillRect(x + 19.5, ry + 7.5, 2, 2);
        c.fillRect(x + 21.5, ry + 4.5, 2, 4);
        c.fillRect(x + 23, ry + 3, 1.5, 2);
      } else if (ready) {
        // a gold pip: this one is finished and wants walking back
        c.fillStyle = '#e8a93c';
        c.fillRect(x + 18.5, ry + 4.5, 4, 4);
      }

      const giver = this.GIVER_NAMES[q.from] || q.from;
      text(c, q.name, x + 34, ry, {
        size: 8, shadow: false,
        color: done ? '#8a7458' : (offer ? '#7a5c3c' : '#4a3020'),
      });
      const bn = (typeof Side !== 'undefined' && Side.BRANCH_NAME[q.branch]) || '';
      text(c, `${giver}  ${bn}`, x + w - 16, ry, {
        size: 6.5, align: 'right', shadow: false, color: '#a4805a' });

      if (done) { continue; }

      if (offer) {
        text(c, `not taken yet -- ${giver} is waiting to be asked`, x + 40, ry + 10,
          { size: 6.5, color: '#a4805a', shadow: false });
        if (q.how) text(c, q.how, x + 40, ry + 19, { size: 6, color: '#b09878', shadow: false });
        continue;
      }

      // ACTIVE or READY: the delivery list or the counter, then the payout
      let line = '';
      if (typeof Side !== 'undefined' && Side) {
        if (q.deliver) line = Side.deliverText(q);
        else { const p = Side.prog(q); if (p) line = `${p.n} / ${p.of}`; }
      }
      text(c, line, x + 40, ry + 10, {
        size: 6.5, shadow: false, color: ready ? '#3f7a4e' : '#7a5c3c' });
      if (ready) text(c, `-- take it back to ${giver}`, x + 40 + textWidth(c, line, 6.5) + 6, ry + 10,
        { size: 6.5, color: '#3f9a58', shadow: false });
      else if (q.how) text(c, q.how, x + 40, ry + 19, { size: 6, color: '#a8742a', shadow: false });

      const rw = q.reward || {};
      const bits = [];
      if (rw.money) bits.push(`$${rw.money}`);
      if (rw.items) for (const k in rw.items) bits.push(`${rw.items[k]} ${typeof Side !== 'undefined' ? Side.itemName(k) : k}`);
      if (rw.seeds) bits.push('seed packets');
      if (rw.perk) bits.push('a standing favour');
      // The payout always sits on the FIRST sub-line, never the second: the
      // how-line under it is a whole sentence and ran straight through the
      // right-aligned reward when they shared a baseline.
      if (bits.length) text(c, `pays  ${bits.join(', ')}`, x + w - 16, ry + 10, {
        size: 6.5, align: 'right', color: '#3f9a58', shadow: false });
    }

    if (this.escroll > 0) text(c, '^', x + w - 14, listY, { size: 8, color: '#a4805a', shadow: false });
    if (this.escroll < maxE) text(c, 'v', x + w - 14, listY + this.EROWS * rowH - 14, { size: 8, color: '#a4805a', shadow: false });
    const nd = (typeof Side !== 'undefined' && Side) ? Side.doneCount() : 0;
    text(c, `[J] close   arrows scroll   [Tab] the survey`, x + 12, y + h - 12, { size: 6.5, color: '#a4805a', shadow: false });
    text(c, `${nd} done`, x + w - 16, y + h - 12, { size: 6.5, align: 'right', color: '#a4805a', shadow: false });
  },

};
