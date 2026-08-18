// ---- surface world: painted sea, modular dock, Otto's stilt house -------------
'use strict';

// DAY/NIGHT IS OFF. Every scene, prop, house and creature dims itself by this one
// number, and the dark half of the cycle was draining the colour out of art that
// is meant to be bright. Returning a constant 0 pins the whole world at noon in a
// single place -- no call site had to be touched, and turning the cycle back on
// later is restoring this function body.
function nightness(clock) {
  return 0;
}

// The pier is SMALL: Otto's front porch, not a high street. The piling, the
// house, the pens and tide pool, a visitor post, and open planks for whatever
// tables he crafts and places. Everything commercial moved into the house (the
// ClamNet terminal on the desk) or out to sea (the neighbours, the farm), so the
// deck ships with nothing to sell at and nothing to work at.
//
// PIER_END IS A CONSTANT, and that is load-bearing. The jump-in spot lives at the
// one pier edge and the deck's single [E] is a nearest-within-22 search — while
// the pier grew with G.bridge that spot swept across the deck and landed on a
// different station at every tier. Bridge upgrades buy DEPTH at the one piling,
// not planks.
const PIER_END = 300;
const PILING_X = [30, 30, 30];
const DECK_Y = 214;   // the dock sits low in frame, water filling the bottom

// THE HARBOUR ZOOM. The dock was framed at the full 480x270 while the open sea
// had been pulled in to 1.5, so stepping out of the water zoomed you OUT and the
// pier sat small under two thirds of empty sky. 1.5 matches the ocean exactly --
// same slice, same crisp setting (a sprite texel on three whole device pixels),
// so the two scenes finally read as one place at one scale.
// ZOOM. A sprite texel covers APIX * DPX * ZOOM device pixels, so only whole
// multiples keep the art crisp: 1.5 gives 3, 1.0 gives 2, and 1.25 would give
// 2.5 -- uneven texels and a shimmer. Stepping out from 1.5 therefore means 1.0,
// which shows half again as much deck.
const WORLD_ZOOM = 1.0;
const WVW = W / WORLD_ZOOM, WVH = H / WORLD_ZOOM;
// With the zoom on, DECK_Y (214) sits past the bottom of a 180-unit slice, so the
// world needs a vertical camera too. This puts the deck at 74% of the frame: the
// pier and its trestles fill the lower third, the horizon and sky take the rest.
const WORLD_CAMY = DECK_Y - WVH * 0.74;

// THE HARBOUR'S WORLD SPACE, in one place.
//
// WorldScene.draw opens with scale(WORLD_ZOOM) then translate(-camX, -WORLD_CAMY)
// and CLOSES both before it returns. Every bolt-on module that draws props on the
// deck (NPCs and the livestock pens in js/integrate.js, the crafted tables in
// js/craftgate.js, the tide pool in Tame) hangs off that same draw and so runs
// AFTER the restore -- in screen space. Each of them was doing translate(-camX, 0)
// and nothing else, which is wrong twice over:
//
//   * no zoom, so a neighbour was drawn at 1/1.5 the size of the pier they were
//     standing on -- which is why making Fintan taller did nothing you could see
//   * no -WORLD_CAMY, so their feet landed 14 units BELOW the plank line and
//     everyone stood shin-deep in the deck
//
// This is that transform, exactly as world.js applies it. Call it inside a save()
// and every prop lands in the same space as the boards.
function worldSpace(ctx, camX) {
  ctx.scale(WORLD_ZOOM, WORLD_ZOOM);
  ctx.imageSmoothingEnabled = false;
  ctx.translate(-camX, -WORLD_CAMY);
}

// Every structure is anchored by its MEASURED deck-surface line (fraction of
// sprite height) so nothing floats: deck surfaces all land exactly on DECK_Y.
// The house is the BUILDING only (house_body) — its own deck and stairs are
// cropped away in the asset pipeline, so the pier is the single deck in the
// scene and the two can't disagree about plank style or thickness.
const HOUSE_X = 34, HOUSE_W = 86;
const SEG_W = 88, PIER_DECK = 0.0352;   // dock_11 trestle module
const PIER_START = -SEG_W;              // the deck runs off the left edge, under the house

// place a sprite so its deck surface sits on DECK_Y
function drawOnDeck(ctx, name, x, w, deckFrac) {
  const h = assetH(name, w);
  drawA(ctx, name, x, DECK_Y - h * deckFrac, w, h);
  return h;
}
// place a sprite standing ON the deck (its feet at DECK_Y)
function drawStanding(ctx, name, cx, w, sink = 1) {
  const h = assetH(name, w);
  drawA(ctx, name, cx - w / 2, DECK_Y - h + sink, w, h);
  return h;
}

const WorldScene = {
  customCursor: false,
  px: 160, dir: 1, walkT: 0, idleT: 0,
  camX: 0, time: 0,
  smoke: [], stars: null,
  dust: [], dustT: 0,
  _lampGlows: [],

  worldW() { return this.endX() + 20; },   // just past the last plank, no empty runway
  endX() { return PIER_END; },
  houseTop() { return DECK_Y - assetH('house_body', HOUSE_W); },

  enter(opts) {
    this.time = 0;
    if (opts && opts.at !== undefined) this.px = PILING_X[opts.at];
    else if (opts && opts.fromHouse) this.px = 80;
    if (!this.stars) {
      const rng = mulberry32(777);
      this.stars = [];
      for (let i = 0; i < 70; i++) this.stars.push({ x: rng() * W, y: rng() * 120, p: rng() * TAU, big: rng() < 0.2 });
    }
    SND.setScene('surface');
    // (the old first-visit toast stack lived here; the journal teaches now)
  },

  // WHICH SPOT [E] MEANS.
  //
  // This was duplicated between update() and drawPrompt() -- the same loop
  // written twice, which is how the label and the action drift apart. One
  // function now, called by both.
  //
  // Two things it does that the old loop did not:
  //
  //   * a spot may declare its own REACH. A flat 22 units is fine for a hatch in
  //     the planks and much too tight for a person: the cast WALK, so a
  //     conversation meant lining Otto up inside a 44-unit window against a
  //     moving target, which is what "it is really hard to talk to him" is.
  //     People get 34.
  //   * a spot may declare a PRIORITY, and priority beats distance. Otherwise a
  //     scenery spot standing a unit nearer silently eats the only interaction
  //     that advances the quest.
  pick() {
    let best = null, bd = 1e9, bp = -1;
    for (const s of this.spots()) {
      const reach = s.r || 22;
      const d = Math.abs(this.px - s.x);
      if (d > reach) continue;
      const prio = s.prio || 0;
      if (prio > bp || (prio === bp && d < bd)) { bp = prio; bd = d; best = s; }
    }
    return best;
  },

  spots() {
    const s = [
      { x: 56, label: 'Enter House', act: () => Game.go(HouseScene, {}) },
      // ClamNet lives INSIDE the house now (the terminal on the desk), and the
      // crack-and-polish workbench is something Otto crafts and places himself --
      // the deck ships with nothing to sell at and nothing to work at.
    ];
    // ONE piling, under the house. Which bed you work is the deepest your bridge
    // has been rated for, so an upgrade makes the same dive richer instead of
    // adding another walk.
    const deepest = clamp(G.bridge, 1, 3) - 1;
    s.push({
      x: PILING_X[0],
      label: `Dive at the Piling — ${PILINGS[deepest].name}  (beds ~${Math.round(clamp(G.growth[deepest], 0, 1) * 100)}%)`,
      act: () => Game.go(DiveScene, deepest),
    });
    // You go in off the END of the pier, where the planks stop — walking to the
    // edge and jumping reads as entering the water; a hatch in the middle of the
    // deck did not. The gate sprite marks it, so the affordance is visible.
    if (typeof Ocean !== 'undefined') {
      s.push({
        x: this.endX() - 14, label: 'Jump In  (open ocean)',
        act: () => Game.go(Ocean, { from: 'dock' }),
      });
    }
    return s;
  },

  update(dt) {
    this.time += dt;
    SKY.update(dt, this.time);
    let mv = 0;
    if (Input.keys['KeyA'] || Input.keys['ArrowLeft']) mv -= 1;
    if (Input.keys['KeyD'] || Input.keys['ArrowRight']) mv += 1;
    if (mv !== 0) {
      this.dir = mv;
      this.px = clamp(this.px + mv * 92 * dt, 16, this.endX() - 10);
      this.walkT += dt * 9;
      this.idleT = 0;
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.24;
        this.dust.push({ x: this.px - mv * 5, y: DECK_Y - 0.5, s: rand(1, 1.8), t: rand(0.3, 0.5) });
      }
    } else {
      this.idleT += dt;
    }
    for (const d of this.dust) { d.t -= dt; d.y -= 3 * dt; d.x -= (this.dir || 1) * 2 * dt; }
    this.dust = this.dust.filter(d => d.t > 0);
    // THE UPPER BOUND MUST NEVER GO NEGATIVE. The pier is 300 units and the screen
    // is 480, so worldW() - W is -160 -- and clamp(v, 0, -160) returns -160, not 0,
    // because it tests the low bound first and the high bound second. That scrolled
    // the camera 160 units LEFT of the world origin the moment you walked right:
    // the whole dock slid across the frame and the house went off the edge. With
    // the world narrower than the screen there is nothing to scroll, so the camera
    // pins at 0 and the open sea past the pier end fills the rest of the frame --
    // which is what you should see, having just walked to the edge of it.
    this.camX = clamp(this.px - WVW / 2, 0, Math.max(0, this.worldW() - WVW));

    if (Input.p('KeyE') || Input.p('Space')) {
      const best = this.pick();
      if (best) { SND.click(); best.act(); return; }
    }

    // chimney smoke
    if (Math.random() < dt * 2) {
      this.smoke.push({ x: HOUSE_X + HOUSE_W * 0.245 + rand(-1, 1), y: this.houseTop() + 4, vy: rand(-13, -8), t: rand(1.5, 3), s: rand(1.5, 3) });
    }
    for (const s of this.smoke) { s.y += s.vy * dt; s.x += Math.sin(this.time + s.y * 0.1) * 0.2 + 3 * dt; s.t -= dt; }
    this.smoke = this.smoke.filter(s => s.t > 0);

    if (G.pendingCrate && G.pendingCrate.t < 10) SND.droneOn(); else SND.droneOff();
  },

  // THE INTERACT PROMPT, drawn as the very last thing in the harbour.
  //
  // It used to be painted inside draw()'s zoom block, which put it UNDER every
  // bolt-on prop layer -- NPCs, the crafted tables, the pens, the tide pool --
  // because all of those chain onto WorldScene.draw and therefore run after it.
  // Nobody noticed while the neighbours were being drawn tiny and half-sunk;
  // the moment they stood up at full size, Fintan's chest was in front of the
  // one label telling you that you could talk to him.
  //
  // So it owns its own transform and main.js calls it after the scene, which is
  // what a prompt is: the topmost thing in the world, under the HUD.
  drawPrompt(ctx) {
    if (!G) return;
    const cam = this.camX;
    const best = this.pick();
    if (!best) return;
    ctx.save();
    worldSpace(ctx, cam);
    const label = (TouchUI.enabled ? '' : '[E] ') + best.label;
    const w = textWidth(ctx, label, 7) + 12;
    const bx = clamp(this.px, cam + w / 2 + 4, cam + WVW - w / 2 - 4);
    uiNote(ctx, bx - w / 2, DECK_Y - 48, w, 13, {});
    text(ctx, label, bx, DECK_Y - 45, { size: 7, color: '#30150a', align: 'center', shadow: false });
    ctx.fillStyle = 'rgba(246,232,201,0.95)';
    ctx.beginPath();
    ctx.moveTo(this.px - 3, DECK_Y - 35.5); ctx.lineTo(this.px + 3, DECK_Y - 35.5); ctx.lineTo(this.px, DECK_Y - 31.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },

  draw(ctx) {
    const cam = this.camX;
    const nite = nightness(G.clock);
    this._lampGlows = [];

    // Everything from here to the matching restore() draws into a WVW x WVH
    // viewport. The backdrop scales with it so the horizon keeps its place in
    // the frame, and nearest sampling keeps the sea's pixels honest at 1.5.
    ctx.save();
    ctx.scale(WORLD_ZOOM, WORLD_ZOOM);
    const _wsm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    // the animated pixel-art ocean, with a gentle horizontal drift. Drawn to fill
    // the slice in SCREEN space (before the world translate) so the horizon keeps
    // its height in frame however the camera moves.
    const oc = `ocean${Math.floor(this.time * 8) % 12}`;
    drawA(ctx, oc, -30 - (cam * 0.05) % 30, 0, 540 / WORLD_ZOOM + 60, WVH);
    SKY.tint(ctx, G.clock, this.time);

    ctx.save();
    ctx.translate(-cam, -WORLD_CAMY);
    const endX = this.endX();

    // ---- the pier: ONE trestle module tiled edge to edge -------------------------
    const pierH = assetH('dock_11', SEG_W);
    const pierTop = DECK_Y - pierH * PIER_DECK;
    // The deck STOPS at endX. It used to tile out to the camera edge, which meant
    // there was no visible end to the pier — and "walk to the edge and jump in"
    // needs an edge you can see. The last module is clipped to the exact plank
    // line so the boards finish cleanly instead of being cut mid-beam.
    const pierEnd = endX;
    for (let x = PIER_START; x < pierEnd; x += SEG_W - 1) {
      const over = (x + SEG_W) - pierEnd;
      if (over <= 0) { drawA(ctx, 'dock_11', x, pierTop, SEG_W, pierH); continue; }
      const keep = SEG_W - over;
      if (keep <= 1) break;
      const img = ASSETS['dock_11'];
      if (img && img.width) {
        const sw = img.width * (keep / SEG_W);
        ctx.drawImage(img, 0, 0, sw, img.height, x, pierTop, keep, pierH);
      }
    }
    // The end-of-pier gate marks the edge you jump from, so it stands at every
    // bridge level now — it used to vanish at bridge 3, which left the jump-in
    // spot with nothing to look at.
    drawOnDeck(ctx, 'dock_10', endX - 16, 30, 0.035);

    // ---- the house, its platform flush with the pier deck --------------------------
    const hh = assetH('house_body', HOUSE_W);
    const hy = DECK_Y - hh;
    drawA(ctx, 'house_body', HOUSE_X, hy, HOUSE_W, hh);
    if (G.house >= 2) {
      const bx0 = HOUSE_X + HOUSE_W * 0.30, bx1 = HOUSE_X + HOUSE_W * 0.72, by = hy + hh * 0.10;
      ctx.strokeStyle = '#6a5030'; ctx.lineWidth = PIX;
      ctx.beginPath(); ctx.moveTo(bx0, by); ctx.quadraticCurveTo((bx0 + bx1) / 2, by + 5, bx1, by); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const fx = lerp(bx0, bx1, t), fy = by + Math.sin(t * Math.PI) * 4.5;
        ctx.fillStyle = ['#e8b84e', '#3f8f8f', '#c8352a'][i % 3];
        ctx.beginPath(); ctx.moveTo(fx - 2.4, fy); ctx.lineTo(fx + 2.4, fy); ctx.lineTo(fx, fy + 4); ctx.closePath(); ctx.fill();
      }
    }
    if (G.decor.lights) {
      for (let i = 0; i < 12; i++) {
        const lx = HOUSE_X + HOUSE_W * 0.24 + i * (HOUSE_W * 0.045);
        const ly = hy + hh * 0.06 + Math.sin(i * 1.2) * 2.5;
        ctx.fillStyle = ['#ffd66e', '#ff8a7a', '#8af2ff', '#a0f2b4'][i % 4];
        ctx.fillRect(lx, ly, 1.5, 1.5);
        if (nite > 0.3) {
          ctx.fillStyle = 'rgba(255,220,150,0.12)';
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, TAU); ctx.fill();
        }
      }
    }

    // ---- lamp posts standing on the deck -------------------------------------------
    for (let x = 120; x < pierEnd - 10; x += SEG_W * 1.6) {
      const lh = drawStanding(ctx, 'dock_15', x, 15, 5);
      this._lampGlows.push({ x, y: DECK_Y - lh + 6 });
    }

    // (The ClamNet laptop moved indoors -- HouseScene draws the terminal -- and
    // the workbench is a Forge table now, drawn by Forge.drawPlaced wherever the
    // player put it.)

    // (NO LANDING PAD. A grey bar with an anti-aliased ellipse stroked on it, on
    // a deck of painted planks -- it was the one piece of scenery in the harbour
    // drawn with vector primitives, and it looked like a decal somebody left on.
    // The drone lands fine without a marker painted under it.)

    this.drawDrone(ctx);

    // smoke + dust
    for (const s of this.smoke) {
      ctx.fillStyle = `rgba(220,220,225,${clamp(s.t / 3, 0, 0.45)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }
    for (const d of this.dust) {
      ctx.fillStyle = `rgba(200,186,150,${clamp(d.t * 1.6, 0, 0.5)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * (1.6 - d.t), 0, TAU); ctx.fill();
    }

    // ---- player: the uploaded otter, with squash & stretch ---------------------------
    const OTTER_WALK = ['o4_4', 'o4_5', 'o4_6', 'o4_7'];
    const OTTER_IDLE = ['o4_0', 'o4_1', 'o4_2', 'o4_3'];
    const walking = this.walkT > 0 && this.idleT < 0.1;
    let frameN = 0, sqx = 1, sqy = 1, hop = 0;
    if (walking) {
      frameN = Math.floor(this.walkT * 0.8) % OTTER_WALK.length;
      const ph = this.walkT * 2.2;
      hop = Math.abs(Math.sin(ph)) * 2.2;
      sqy = 1 - Math.cos(ph * 2) * 0.07;
      sqx = 1 - (sqy - 1) * 0.9;
    } else {
      // he breathes standing still: two beats, a slow chest rise and a slower sway
      sqy = 1 + Math.sin(this.time * 2.1) * 0.03;
      sqx = 1 - (sqy - 1) * 0.7;
      hop = Math.max(0, Math.sin(this.time * 2.1)) * 0.35;
    }
    ctx.fillStyle = 'rgba(40,20,10,0.18)';
    ctx.beginPath(); ctx.ellipse(this.px, DECK_Y + 0.8, Math.max(3.5, 6 - hop * 0.9), 1.3, 0, 0, TAU); ctx.fill();
    const oimg = ASSETS[walking ? OTTER_WALK[frameN] : OTTER_IDLE[Math.floor(this.time * 2.2) % 4]];
    if (oimg && oimg.width) {
      // EVERYTHING THAT MOVES HIM IS QUANTISED TO A SPRITE TEXEL.
      //
      // This is the same fault that made the swimming otter look like a bad
      // cutout, and it was still here on land: a continuously-changing,
      // non-integer ctx.scale re-rasterises the sprite EVERY FRAME, and so does
      // an unquantised hop and a per-frame rotate. The edge pixels reshuffle
      // sixty times a second, which reads as the sprite boiling rather than as
      // squash and stretch.
      //
      // So the squash is applied to the drawn SIZE, snapped to whole texels,
      // instead of to the transform; the hop is snapped to the same pitch; and
      // the lean is gone, because there is no such thing as a rotation that
      // does not resample. The bounce is smaller too -- 3.6 units on a 30-unit
      // otter was a pogo stick.
      const qw = APIX * WORLD_ZOOM;
      const snapq = (v) => Math.round(v / qw) * qw;
      const oh = 30, ow = oh * oimg.width / oimg.height;
      const dw = Math.max(qw, snapq(ow * sqx));
      const dh = Math.max(qw, snapq(oh * sqy));
      ctx.save();
      ctx.translate(snapq(this.px), snapq(DECK_Y + 0.5 - hop));
      if (this.dir < 0) ctx.scale(-1, 1);          // whole-number flip only
      ctx.drawImage(oimg, -dw / 2, -dh + 0.5, dw, dh);
      ctx.restore();
    }

    // (the interact prompt used to be drawn here. It is drawPrompt() now, called
    // LAST -- see the method for why.)

    ctx.restore();
    // close the harbour zoom: everything after this is screen space again
    ctx.imageSmoothingEnabled = _wsm;
    ctx.restore();

    // golden hour: let the low sun fall on the dock and props too
    const warmth = clamp(1 - Math.abs(G.clock - 0.615) / 0.13, 0, 1)
                 + clamp(1 - Math.abs(G.clock - 0.155) / 0.10, 0, 1);
    if (warmth > 0.01) {
      ctx.fillStyle = `rgba(255,150,74,${warmth * 0.20})`;
      ctx.fillRect(0, 0, W, H);
    }

    // night: tint + warm glows
    if (nite > 0.05) {
      ctx.fillStyle = `rgba(8,12,38,${nite * 0.45})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-cam, 0);
      // hut window glow
      const hh2 = assetH('house_body', HOUSE_W);
      const hy2 = DECK_Y - hh2;
      ctx.fillStyle = `rgba(255,214,120,${nite * 0.18})`;
      ctx.beginPath(); ctx.arc(HOUSE_X + HOUSE_W * 0.535, hy2 + hh2 * 0.60, 12, 0, TAU); ctx.fill();
      // dock lanterns
      for (const g of this._lampGlows) {
        const fl = 0.8 + Math.sin(this.time * 8 + g.x) * 0.2;
        ctx.fillStyle = `rgba(255,200,110,${nite * 0.16 * fl})`;
        ctx.beginPath(); ctx.arc(g.x, g.y, 13, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(255,226,150,${nite * 0.85 * fl})`;
        ctx.fillRect(g.x - 1.5, g.y - 2, 3, 4);
      }
      ctx.restore();
    }
  },

  drawDrone(ctx) {
    const pc = G.pendingCrate;
    if (!pc) return;
    const padX = 171, padY = DECK_Y - 1;
    let crateY = padY - 10;
    let leaving = pc.t <= 1.1;
    if (pc.t <= 2.4 && pc.t > 1.1) crateY = padY - 10 - (2.4 - pc.t) * 30;
    if (!leaving) drawCrate(ctx, padX - 6, crateY);

    if (pc.t <= 10) {
      let dx, dy, img = 'drone_fly';
      if (pc.t > 4) {
        const f = (10 - pc.t) / 6;
        dx = lerp(this.worldW() + 30, padX, f);
        dy = lerp(34, 52, f);
      } else if (pc.t > 1.1) {
        dx = padX + Math.sin(this.time * 2) * 2;
        dy = 52 + Math.sin(this.time * 3) * 2;
        img = 'drone_claw';
        if (pc.t <= 2.4) {
          ctx.fillStyle = `rgba(120,220,255,${0.25 + Math.sin(this.time * 12) * 0.08})`;
          ctx.beginPath();
          ctx.moveTo(dx - 3, dy + 8); ctx.lineTo(dx + 3, dy + 8);
          ctx.lineTo(dx + 10, crateY + 8); ctx.lineTo(dx - 10, crateY + 8);
          ctx.closePath(); ctx.fill();
        }
      } else {
        const f = 1 - pc.t / 1.1;
        dx = lerp(padX, -60, f);
        dy = lerp(52, 18, f);
        img = Math.floor(this.time * 7) % 2 ? 'drone_go' : 'drone_go2';
      }
      if (img === 'drone_claw' && pc.t <= 2.4) img = Math.floor(this.time * 7) % 2 ? 'drone_lift' : 'drone_lift2';
      drawAC(ctx, img, dx, dy + Math.sin(this.time * 5) * 1.2, 30);
    }
  },
};