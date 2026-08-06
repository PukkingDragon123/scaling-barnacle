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
  _installed: false,
  _pulse: 0,           // banner glow when a chapter just finished

  ROWS: 7,             // chapter rows on screen at once

  // ---- the letter -------------------------------------------------------------
  // Quiet on purpose. It sets the whole register for the game's writing: an
  // uncle would not write "EMBARK ON YOUR ADVENTURE", he would mention a plank.
  LETTER: [
    'Otto --',
    '',
    'The pier is yours now. Mind the third plank; it complains.',
    '',
    'The sea out front is generous if you are patient with it,',
    'and the neighbours are good folk, even the one who',
    'pretends not to be.',
    '',
    'Scrape a few shells. Fix the place up. Sleep when the',
    'light goes soft. That is the whole of it, really.',
    '',
    '                                        -- Uncle Almar',
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
    if (typeof Tame !== 'undefined' && Tame && Tame.pet) {
      const pet = Tame.pet.bind(Tame);
      Tame.pet = function (m) {
        const r = pet(m);
        if (r !== false && self.ensure()) G.qflags.petted = true;
        return r;
      };
    }
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
    if (typeof Game !== 'undefined' && Game.toast) {
      Game.toast(`journal: "${q.name}" -- done.` + (r.money ? `  +$${r.money}` : ''));
      if (r.note) Game.toast(r.note);
    }
    this._pulse = 3;
  },

  // ---- per-frame ----------------------------------------------------------------
  update(dt) {
    if (!this.ensure()) return;
    if (this._pulse > 0) this._pulse -= dt;

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
      if (Input.p('ArrowDown') || Input.p('KeyS')) this.scroll = Math.min(total - this.ROWS, this.scroll + 1);
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
    if (this.open) this._drawJournal(c);
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

  _drawJournal(c) {
    this.ensure();
    c.fillStyle = 'rgba(6,10,16,0.6)';
    c.fillRect(0, 0, W, H);
    const w = 380, h = 216, x = (W - w) / 2, y = (H - h) / 2;
    uiPanel(c, x, y, w, h, 0.97, true);
    text(c, "OTTO'S JOURNAL", x + 12, y + 8, { size: 10, color: '#4a3020', shadow: false });
    const doneN = Math.min(G.goal || 0, QUESTS.length);
    text(c, `${doneN}/${QUESTS.length} chapters`, x + w - 12, y + 10, { size: 7, color: '#a4805a', align: 'right', shadow: false });

    const rowH = 26, listY = y + 24;
    const cur = G.goal || 0;
    for (let i = 0; i < this.ROWS; i++) {
      const qi = this.scroll + i;
      if (qi >= QUESTS.length) break;
      const q = QUESTS[qi];
      const ry = listY + i * rowH;
      const done = qi < cur, active = qi === cur;
      // chapters you have not reached stay folded -- the story is not a menu
      const known = qi <= cur;

      if (active) {
        c.fillStyle = 'rgba(232,169,60,0.14)';
        c.fillRect(x + 8, ry - 2, w - 16, rowH - 2);
      }
      // tick / dot / blank
      c.fillStyle = done ? '#3f9a58' : (active ? '#e8a93c' : 'rgba(122,74,48,0.35)');
      if (done) {
        text(c, 'x', x + 16, ry + 2, { size: 8, color: '#3f9a58', shadow: false });
      } else {
        c.fillRect(x + 15, ry + 4, 4, 4);
      }
      const nm = known ? q.name : '. . .';
      text(c, `${qi + 1}. ${nm}`, x + 28, ry, {
        size: 8, shadow: false,
        color: done ? '#8a7458' : (active ? '#4a3020' : '#a4805a'),
      });
      if (active) {
        // the current chapter shows its story lines; finished ones just their hint
        const lines = q.brief || [];
        for (let l = 0; l < Math.min(2, lines.length); l++) {
          text(c, lines[l], x + 34, ry + 9 + l * 7, { size: 6.5, color: '#7a5c3c', shadow: false });
        }
      } else if (done && q.from) {
        text(c, `for ${this.GIVER_NAMES[q.from] || q.from}`, x + 34, ry + 9, { size: 6.5, color: '#b09878', shadow: false });
      }
    }

    // scroll hints
    if (this.scroll > 0) text(c, '^', x + w - 14, listY, { size: 8, color: '#a4805a', shadow: false });
    if (this.scroll + this.ROWS < QUESTS.length)
      text(c, 'v', x + w - 14, listY + this.ROWS * rowH - 12, { size: 8, color: '#a4805a', shadow: false });
    text(c, '[J] close   arrows scroll', x + 12, y + h - 12, { size: 6.5, color: '#a4805a', shadow: false });
  },
};
