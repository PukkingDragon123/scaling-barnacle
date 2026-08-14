// ---- the opening: Otto swims home ---------------------------------------------
//
// A short letterboxed cutscene on a new game, built entirely from art that is
// already loaded: the animated ocean loop, the pier the dock scene stands on,
// and Otto's own swim cycle. He crosses the open water, the pier slides into
// frame, he reaches the ladder, and the day begins. Anything dismisses it --
// this is a hello, not a hostage situation.
//
// Two shots, one camera move, no dialogue: the letter that follows does the
// talking. Runs as an ordinary scene so the main loop needs nothing special.
'use strict';

const IntroScene = {
  customCursor: false,
  time: 0,
  DUR: 8.6,             // total length; the pier arrives about halfway

  enter() {
    this.time = 0;
    if (typeof SND !== 'undefined' && SND.setScene) SND.setScene('title');
  },

  _finish() {
    Game.go(WorldScene, {});
    // the letter follows the cutscene, same as it would follow the menu
    if (typeof Quests !== 'undefined' && G && G.flags && !G.flags.letter) Quests.letter = true;
  },

  update(dt) {
    this.time += dt;
    const skip = Input.p('Enter') || Input.p('Space') || Input.p('Escape') ||
      Input.p('KeyE') || Input.mouse.clicked;
    if (skip || this.time >= this.DUR) { this._finish(); return; }
  },

  draw(c) {
    const t = this.time;
    const k = clamp(t / this.DUR, 0, 1);

    // the sea, moving -- the same loop the dock and the menu stand in front of
    const oc = ASSETS[`ocean${Math.floor(t * 8) % 12}`];
    const sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    if (oc && oc.width) c.drawImage(oc, 0, 0, W, H);
    else { c.fillStyle = '#3aa7c9'; c.fillRect(0, 0, W, H); }

    // ---- the pier, arriving -----------------------------------------------------
    // It eases in from off the right edge over the second half of the shot: the
    // camera is riding alongside Otto, and home comes to meet him.
    const arrive = clamp((t - 3.6) / 3.4, 0, 1);
    const ease = 1 - (1 - arrive) * (1 - arrive);
    const pierX = W + 30 - ease * 190;
    const seg = ASSETS.dock_11, house = ASSETS.house_body, lad = ASSETS.kit_ladder;
    const deckY = 176;
    if (seg && seg.width) {
      const sw = 92, sh = sw * seg.height / seg.width;
      c.drawImage(seg, pierX, deckY, sw, sh);
      c.drawImage(seg, pierX + sw - 2, deckY, sw, sh);
      if (house && house.width) {
        const hw = 80, hh = hw * house.height / house.width;
        c.drawImage(house, pierX + 52, deckY - hh + 2, hw, hh);
      }
      if (lad && lad.width) {
        const lw = 13, lh = lw * lad.height / lad.width;
        c.drawImage(lad, pierX + 8, deckY + 4, lw, lh);
      }
    }

    // ---- Otto, swimming home ------------------------------------------------------
    // The cruise cycle, on the surface line, easing across the frame. He slows as
    // the pier arrives, the way anyone does at their own ladder.
    const swimK = clamp(t / (this.DUR - 1.2), 0, 1);
    const ox = lerp(-30, pierX - 24, Math.min(1, swimK * 1.15));
    const oy = 188 + Math.sin(t * 2.2) * 2.2;
    const fr = ASSETS[`oswim_${Math.floor(t * 6.5) % 4}`];
    if (fr && fr.width) {
      const ow = 40, oh = ow * fr.height / fr.width;
      // HE FACES RIGHT ALREADY. The oswim sheet is drawn head-right -- unlike the
      // creature sheets, which face left -- and this flipped him anyway, so the
      // whole opening had Otto swimming backwards towards his own front door,
      // tail first, for eight and a half seconds.
      c.drawImage(fr, ox - ow / 2, oy - oh / 2, ow, oh);
      // his wake: a couple of fading dashes behind him
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 1; i <= 3; i++) {
        c.fillRect(ox - ow / 2 - i * 9, oy + 2 + Math.sin(t * 3 + i) * 1.2, 6 - i, 1.2);
      }
    }
    c.imageSmoothingEnabled = sm;

    // ---- letterbox + the card -----------------------------------------------------
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, W, 26);
    c.fillRect(0, H - 26, W, 26);
    // one quiet line, early, then it gets out of the way
    if (t > 0.8 && t < 3.4) {
      c.globalAlpha = clamp((t - 0.8) / 0.5, 0, 1) * clamp((3.4 - t) / 0.5, 0, 1);
      text(c, 'the sea, a while later', W / 2, H / 2 - 40, { size: 9, color: '#f4e8cc', align: 'center' });
      c.globalAlpha = 1;
    }
    if (Math.sin(t * 3) > -0.2) {
      text(c, 'press any key to skip', W - 10, H - 18, { size: 6, color: 'rgba(255,255,255,0.55)', align: 'right', shadow: false });
    }
    // the closing fade belongs to the scene, so the cut lands on black
    const out = clamp((t - (this.DUR - 0.7)) / 0.7, 0, 1);
    if (out > 0) {
      c.fillStyle = `rgba(0,0,0,${out})`;
      c.fillRect(0, 0, W, H);
    }
  },
};

// ---- CINE: short scripted beats, played over whatever scene you are standing in
//
// The intro above is a whole scene, which is right for an opening and much too
// heavy for a moment. This is the light version: letterbox bars slide in, a
// couple of lines type themselves over a dimmed frame, one hand-drawn flourish
// plays behind them, and it hands the game straight back. Two to five seconds,
// skippable by anything, and it never takes control away -- the world keeps
// updating underneath, so a beat can fire mid-swim without the game stopping.
//
// Beats are pure data (BEATS below) so a quest can name one and nothing else has
// to know. js/side.js fires them by key on a main-quest hand-in.
const Cine = {
  cur: null,          // { key, t, dur, lines, art }
  _t: 0,

  BEATS: {
    // step 1 -- the survey begins. His book, opening.
    arrive: {
      dur: 4.6,
      art: 'book',
      lines: [
        'THE NORTH PIER SURVEY',
        'entry one, in a hand that has waited eleven years',
        'for somebody to hold the other end of the tape',
      ],
    },
    // step 4 -- the drone lifts the first crate. The pier earns.
    crate: {
      dur: 4.2,
      art: 'drone',
      lines: [
        'THE FIRST CRATE',
        'it goes out at noon and the money is under a pebble by three',
        'which is, Fintan notes, how a place starts paying for itself',
      ],
    },
    // step 8 -- the case, the card, and the book changing hands.
    survey: {
      dur: 6.4,
      art: 'case',
      lines: [
        'NORTH PIER',
        'the card in the case has company now',
        'the lamp is lit, the good chair is taken,',
        'and the water goes on being exactly as generous as it was',
      ],
    },
  },

  play(key) {
    const b = this.BEATS[key];
    if (!b) return false;
    this.cur = { key, t: 0, dur: b.dur, lines: b.lines, art: b.art };
    if (typeof SND !== 'undefined' && SND.chime) SND.chime();
    return true;
  },

  update(dt) {
    if (!this.cur) return;
    this.cur.t += dt;
    this._t += dt;
    const skip = typeof Input !== 'undefined' &&
      (Input.p('Escape') || Input.p('Enter') || Input.p('Space') || Input.mouse.clicked);
    if (skip || this.cur.t >= this.cur.dur) this.cur = null;
  },

  draw(c) {
    if (!this.cur) return;
    const b = this.cur, t = b.t;
    // bars in over 0.35s, out over 0.5s -- the whole grammar of a cut
    const a = Math.min(clamp(t / 0.35, 0, 1), clamp((b.dur - t) / 0.5, 0, 1));
    const bar = 34 * a;
    c.save();
    c.fillStyle = `rgba(6,7,10,${0.42 * a})`;
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, W, bar);
    c.fillRect(0, H - bar, W, bar);
    c.globalAlpha = a;

    this._art(c, b.art, t);

    // the lines type on, one after another, and hold
    let ly = H / 2 - 4;
    for (let i = 0; i < b.lines.length; i++) {
      const start = 0.5 + i * 0.75;
      if (t < start) break;
      const s = b.lines[i];
      const shown = Math.min(s.length, Math.floor((t - start) * 52));
      const big = i === 0;
      text(c, s.slice(0, shown), W / 2, ly, {
        size: big ? 11 : 7, align: 'center',
        color: big ? '#ffe6b0' : '#dfe9ee',
        shadow: false,
      });
      ly += big ? 18 : 11;
    }
    c.globalAlpha = 1;
    c.restore();
  },

  // One flourish per beat, drawn from art that is already loaded plus a few
  // fillRects. Nothing here allocates and nothing here is a gradient.
  _art(c, kind, t) {
    const cx = W / 2, cy = H / 2 - 52;
    if (kind === 'book') {
      // a book opening: two pages swinging up from the spine
      const open = clamp((t - 0.3) / 1.1, 0, 1);
      const e = 1 - (1 - open) * (1 - open);
      const pw = 30 * e, ph = 24;
      c.fillStyle = '#7a5232';
      c.fillRect(cx - 2, cy - ph / 2, 4, ph);
      c.fillStyle = '#f2dfae';
      c.fillRect(cx - 2 - pw, cy - ph / 2 + 1, pw, ph - 2);
      c.fillRect(cx + 2, cy - ph / 2 + 1, pw, ph - 2);
      c.fillStyle = '#c9ab78';
      for (let i = 0; i < 5; i++) {
        const ly = cy - ph / 2 + 5 + i * 4;
        c.fillRect(cx - pw, ly, Math.max(0, pw - 4), 1);
        c.fillRect(cx + 5, ly, Math.max(0, pw - 6), 1);
      }
    } else if (kind === 'drone') {
      // the drone lifting a crate out of frame, rotor blur and all
      const rise = clamp((t - 0.4) / 2.6, 0, 1);
      const y = cy + 22 - rise * 44;
      const d = ASSETS.drone_lift || ASSETS.drone_fly;
      if (d && d.width) {
        const dw = 34, dh = dw * d.height / d.width;
        c.drawImage(d, cx - dw / 2, y - dh, dw, dh);
      }
      const cr = ASSETS.ic_crate;
      if (cr && cr.width) {
        const cw2 = 16, chh = cw2 * cr.height / cr.width;
        c.drawImage(cr, cx - cw2 / 2, y + 2, cw2, chh);
      }
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 3; i++) c.fillRect(cx - 10 + i * 8, y + 22 + (i % 2) * 3, 3, 1);
    } else if (kind === 'case') {
      // the glass case: a card, then two pearls and an abalone set beside it
      const w2 = 74, h2 = 30;
      c.fillStyle = '#3a2617';
      c.fillRect(cx - w2 / 2 - 2, cy - h2 / 2 - 2, w2 + 4, h2 + 4);
      c.fillStyle = 'rgba(190,225,235,0.30)';
      c.fillRect(cx - w2 / 2, cy - h2 / 2, w2, h2);
      c.fillStyle = '#f2dfae';
      c.fillRect(cx - 30, cy + 4, 22, 9);
      text(c, 'NORTH PIER', cx - 19, cy + 5, { size: 4.5, color: '#5a4026', align: 'center', shadow: false });
      const set = clamp((t - 1.2) / 2.0, 0, 1);
      const items = ['pearlPol', 'pearlPol', 'abalonePol'];
      for (let i = 0; i < 3; i++) {
        const k = clamp((set - i * 0.22) / 0.5, 0, 1);
        if (k <= 0) continue;
        c.globalAlpha = k;
        const ix = cx + 2 + i * 15, iy = cy + 2 - (1 - k) * 10;
        if (typeof drawItemIcon === 'function') drawItemIcon(c, items[i], ix, iy, 13);
        c.globalAlpha = 1;
      }
      // a slow shine across the glass
      const sx = cx - w2 / 2 + ((t * 26) % (w2 + 30)) - 15;
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(sx, cy - h2 / 2, 6, h2);
    }
  },
};
