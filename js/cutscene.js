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
      // the swim sheet faces LEFT (like every creature sheet); he travels right
      c.save();
      c.translate(ox, oy);
      c.scale(-1, 1);
      c.drawImage(fr, -ow / 2, -oh / 2, ow, oh);
      c.restore();
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
