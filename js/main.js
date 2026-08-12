// ---- input (keyboard + mouse + touch), game state, title, main loop ----------
'use strict';

let G = null;

const canvas = document.getElementById('game');
// the backing store always follows DPX, so bumping the density is a one-liner
canvas.width = W * DPX;
canvas.height = H * DPX;
const ctx = canvas.getContext('2d');

// The corner vignette, rendered once at device density and blitted every frame.
let _vigCv = null;
function vignette() {
  if (_vigCv) return _vigCv;
  _vigCv = document.createElement('canvas');
  _vigCv.width = W * DPX; _vigCv.height = H * DPX;
  const c = _vigCv.getContext('2d');
  c.scale(DPX, DPX);
  const vg = c.createRadialGradient(W / 2, H * 0.52, H * 0.40, W / 2, H * 0.52, H * 1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(6,10,30,0.38)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
  return _vigCv;
}
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

const Input = {
  keys: {}, pressed: new Set(),
  mouse: { x: 240, y: 135, down: false, clicked: false, speed: 0, lastX: 240, lastY: 135, idleT: 9 },
  wheelDelta: 0,
  p(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  },
  endFrame() { this.pressed.clear(); this.mouse.clicked = false; this.wheelDelta = 0; },
};

// The element that defines the space available to the canvas. When the game is
// embedded, a [data-fit] ancestor can own the sizing so the frame around the
// canvas is free to shrink-wrap it (its own width can't be the input, or the
// measurement would be circular). Optional --fit-inset accounts for that frame.
function fitHost() {
  return canvas.closest('[data-fit]') || canvas.parentElement;
}

function resize() {
  const host = fitHost();
  let availW = window.innerWidth, availH = window.innerHeight;
  if (host && host.clientWidth) {
    const inset = parseFloat(getComputedStyle(host).getPropertyValue('--fit-inset')) || 0;
    availW = host.clientWidth - inset;
    availH = host.clientHeight - inset;
  }
  // Snap to half-integer scales when upscaling: pixel art stays crisp, and the
  // shrink-wrapped frame means the leftover space costs nothing visually.
  const scaleRaw = Math.min(availW / W, availH / H);
  const scale = scaleRaw >= 1 ? Math.max(1, Math.floor(scaleRaw * 2) / 2) : Math.max(0.1, scaleRaw);
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) {
  const host = fitHost();
  if (host) new ResizeObserver(resize).observe(host);
}

window.addEventListener('keydown', (e) => {
  SND.init(); SND.resume();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { Input.keys[e.code] = true; Input.pressed.add(e.code); }
});
window.addEventListener('keyup', (e) => { Input.keys[e.code] = false; });

function toCanvasXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp((clientX - r.left) / r.width * W, 0, W),
    y: clamp((clientY - r.top) / r.height * H, 0, H),
  };
}
window.addEventListener('mousemove', (e) => {
  const p = toCanvasXY(e.clientX, e.clientY);
  Input.mouse.x = p.x; Input.mouse.y = p.y;
});
window.addEventListener('mousedown', (e) => {
  SND.init(); SND.resume();
  if (e.button === 0) { Input.mouse.down = true; Input.mouse.clicked = true; }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.mouse.down = false; });
window.addEventListener('wheel', (e) => { Input.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- touch controls ------------------------------------------------------------
const TouchUI = {
  enabled: false,
  pointerId: null,
  held: new Map(),   // touch identifier -> button
  buttons: [],

  layout() {
    const b = [];
    if (!G || !Game.scene || Game.scene === TitleScene) return b;
    if (typeof IntroScene !== 'undefined' && Game.scene === IntroScene) return b;
    if (Game.helpOpen || Shop.open || Bench.open) return b;
    const sc = Game.scene;
    if (sc === WorldScene || sc === HouseScene) {
      b.push({ x: 8, y: H - 52, w: 44, h: 44, key: 'ArrowLeft', icon: 'left' });
      b.push({ x: 58, y: H - 52, w: 44, h: 44, key: 'ArrowRight', icon: 'right' });
      b.push({ x: W - 52, y: H - 52, w: 44, h: 44, tap: 'KeyE', icon: 'act' });
      // NO CRAFTING PAD. It used to sit at (W-52, H-102) -- a second fat round
      // button stacked directly above interact, one thumb, two verbs, and the
      // top one got hit by accident every time. The crafting button is the
      // anvil on the top rail (js/uibar.js), which is where the bag and the
      // skills already live. One place for menus, one place for the world.
      b.push({ x: W - 26, y: 24, w: 20, h: 18, tap: 'KeyH', icon: 'help' });
    } else if (sc === DiveScene) {
      b.push({ x: W - 46, y: H - 122, w: 40, h: 40, key: 'KeyW', icon: 'up' });
      b.push({ x: W - 46, y: H - 76, w: 40, h: 40, key: 'KeyS', icon: 'down' });
    }
    return b;
  },

  // buttons are rebuilt every frame, so match by identity (icon), not reference
  isHeld(btn) {
    for (const v of this.held.values()) if (v.icon === btn.icon) return true;
    return false;
  },

  draw(c) {
    if (!this.enabled) return;
    for (const b of this.buttons) {
      const held = this.isHeld(b);
      if (b.icon === 'help') {
        uiPanel(c, b.x, b.y, b.w, b.h, held ? 0.98 : 0.6);
        text(c, '?', b.x + b.w / 2, b.y + 4, { size: 9, color: '#efe0bc', align: 'center' });
        continue;
      }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w / 2 - 2;
      c.fillStyle = held ? 'rgba(240,220,170,0.4)' : 'rgba(14,20,28,0.5)';
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(230,200,150,0.55)'; c.lineWidth = 1;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      c.fillStyle = held ? '#1a1108' : '#efe0bc';
      if (b.icon === 'left' || b.icon === 'right') {
        const d = b.icon === 'right' ? 1 : -1;
        c.beginPath();
        c.moveTo(cx + 6 * d, cy); c.lineTo(cx - 4 * d, cy - 7); c.lineTo(cx - 4 * d, cy + 7);
        c.closePath(); c.fill();
      } else if (b.icon === 'up' || b.icon === 'down') {
        const d = b.icon === 'down' ? 1 : -1;
        c.beginPath();
        c.moveTo(cx, cy + 6 * d); c.lineTo(cx - 7, cy - 4 * d); c.lineTo(cx + 7, cy - 4 * d);
        c.closePath(); c.fill();
      } else if (b.icon === 'craft') {
        // a hammer: head, claw, handle -- fillRects on the pad's own grid
        c.fillRect(cx - 7, cy - 6, 10, 5);
        c.fillRect(cx + 3, cy - 5, 3, 3);
        c.fillRect(cx - 2, cy - 1, 3, 9);
      } else if (b.icon === 'act') {
        // paw print
        c.beginPath(); c.ellipse(cx, cy + 3, 6, 4.5, 0, 0, TAU); c.fill();
        for (let i = -1; i <= 1; i++) {
          c.beginPath(); c.arc(cx + i * 5.5, cy - 4 + Math.abs(i) * 1.5, 2.2, 0, TAU); c.fill();
        }
      }
    }
  },
};

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  SND.init(); SND.resume();
  TouchUI.enabled = true;
  for (const t of e.changedTouches) {
    const p = toCanvasXY(t.clientX, t.clientY);
    const btn = TouchUI.buttons.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (btn) {
      TouchUI.held.set(t.identifier, btn);
      if (btn.key) Input.keys[btn.key] = true;
      if (btn.tap) Input.pressed.add(btn.tap);
    } else if (TouchUI.pointerId === null) {
      TouchUI.pointerId = t.identifier;
      Input.mouse.x = p.x; Input.mouse.y = p.y;
      Input.mouse.lastX = p.x; Input.mouse.lastY = p.y;
      Input.mouse.down = true; Input.mouse.clicked = true;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === TouchUI.pointerId) {
      const p = toCanvasXY(t.clientX, t.clientY);
      Input.mouse.x = p.x; Input.mouse.y = p.y;
    }
  }
}, { passive: false });

function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const btn = TouchUI.held.get(t.identifier);
    if (btn) {
      TouchUI.held.delete(t.identifier);
      if (btn.key && !TouchUI.isHeld(btn)) Input.keys[btn.key] = false;   // isHeld matches by icon
    }
    if (t.identifier === TouchUI.pointerId) {
      TouchUI.pointerId = null;
      Input.mouse.down = false;
    }
  }
}
canvas.addEventListener('touchend', touchEnd, { passive: false });
canvas.addEventListener('touchcancel', touchEnd, { passive: false });

// ---- game manager ---------------------------------------------------------------
const Game = {
  scene: null, fade: 1, fadeDir: -1, pending: null, plunge: null,
  toasts: [], time: 0, saveT: 25, helpOpen: false,
  rotHinted: false,

  go(scene, arg) {
    // going over the side gets the plunge animation, drawn over the fade
    if (scene === DiveScene && this.scene === WorldScene) this.plunge = 0;
    else if (scene === WorldScene && this.scene === DiveScene) this.plunge = -1;
    this.pending = { scene, arg };
    if (this.fadeDir !== 1) this.fadeDir = 1;
  },

  // Otto tipping over the rail and knifing into the water, or breaking back out
  // of it. Runs on top of the scene fade so the cut never feels like a cut.
  drawPlunge(c) {
    if (this.plunge === null) return;
    const down = this.plunge >= 0;
    const t = Math.abs(this.plunge);
    if (t > 1.15) { this.plunge = null; return; }
    const k = Math.min(1, t / 0.85);
    const img = ASSETS[down ? 'o4_dive' : 'o4_swim'];
    if (!img || !img.width) return;
    const oh = down ? 58 : 52, ow = oh * img.width / img.height;
    // he accelerates downward, or decelerates on the way up
    const ease = down ? k * k : 1 - (1 - k) * (1 - k);
    const y = down ? -40 + ease * (H + 80) : H + 40 - ease * (H + 80);
    c.save();
    c.translate(W / 2 + Math.sin(t * 3) * 6, y);
    c.rotate(down ? 0.5 + k * 0.5 : -0.7);
    c.globalAlpha = clamp(1.2 - t, 0, 1);
    c.drawImage(img, -ow / 2, -oh / 2, ow, oh);
    c.globalAlpha = 1;
    c.restore();
    // the splash he makes crossing the surface
    const sy = H * 0.46;
    if (Math.abs(y - sy) < 50) {
      const s = 1 - Math.abs(y - sy) / 50;
      c.strokeStyle = `rgba(214,246,255,${s * 0.7})`;
      c.lineWidth = 1.5;
      for (let i = 1; i <= 3; i++) {
        c.beginPath();
        c.ellipse(W / 2, sy, 16 * i * (0.5 + s), 4 * i * (0.4 + s * 0.6), 0, 0, TAU);
        c.stroke();
      }
      c.fillStyle = `rgba(236,252,255,${s * 0.55})`;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        c.fillRect(W / 2 + Math.cos(a) * (18 + s * 26), sy + Math.sin(a) * (6 + s * 9), 2, 2);
      }
    }
  },

  updateFade(dt) {
    if (this.fadeDir === 1) {
      this.fade += dt * 3;
      if (this.fade >= 1) {
        this.fade = 1;
        const p = this.pending; this.pending = null;
        Shop.open = false;        // scene changes always dismiss modals
        Bench.open = false;
        this.helpOpen = false;
        this.scene = p.scene;
        this.scene.enter(p.arg);
        this.fadeDir = -1;
      }
    } else if (this.fadeDir === -1) {
      this.fade -= dt * 3;
      if (this.fade <= 0) { this.fade = 0; this.fadeDir = 0; }
    }
  },

  // ONE line at a time. Toasts used to stack four deep and sit for 4.5 seconds
  // each, so any scene change built a wall of pills across the play field --
  // which is most of what made the screen read as noise. Now a single chip
  // shows for a couple of seconds and the rest wait their turn in a short
  // queue; anything beyond the queue is dropped, because if three messages are
  // fighting for the same two seconds none of them was important.
  toast(msg) {
    if (this.toasts.some(t => t.msg === msg) || this._toastQ.some(m => m === msg)) return;
    if (this.toasts.length === 0) this.toasts.push({ msg, t: 2.6 });
    else if (this._toastQ.length < 2) this._toastQ.push(msg);
  },
  _toastQ: [],

  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  },
  save() {
    if (!G) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {}
  },
  load() {
    const base = defaultState();
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) { G = base; return; }
      G = Object.assign(base, d);
      for (const k of ['storage', 'gear', 'stats', 'flags', 'qflags', 'decor'])
        G[k] = Object.assign(defaultState()[k], d[k] || {});
      if (!Array.isArray(G.growth) || G.growth.length !== 3) G.growth = [1, 1, 1];
      if (!Array.isArray(G.seeds) || G.seeds.length !== 3) G.seeds = [11, 22, 33];
    } catch (e) { G = base; }
  },
  newGame() {
    G = defaultState();
    this.save();
  },

  // Shell beds only come back overnight — and only some of them. Each piling
  // rolls its own fortune; a lucky day is a bounty, a poor one sends you deeper.
  newDayRegrow(force) {
    if (!force && this.scene === DiveScene) { G.flags.pendingRegrow = true; return; }
    for (let i = 0; i < 3; i++) {
      G.growth[i] = clamp(rand(0.5, 0.78) + (Math.random() < 0.15 ? 0.22 : 0), 0, 1);
      G.seeds[i]++;
    }
    delete G.flags.pendingRegrow;
  },

  globalUpdate(dt) {
    this.time += dt;
    // day cycle: one full day = 5 real minutes
    G.clock += dt / 300;
    if (G.clock >= 1) {
      G.clock -= 1;
      G.day++;
      this.toast(`Day ${G.day} dawns.`);
      this.newDayRegrow(false);
      this.save();
    }
    // drone shipment
    if (G.pendingCrate) {
      G.pendingCrate.t -= dt;
      if (G.pendingCrate.t <= 0) {
        G.money += G.pendingCrate.value;
        G.stats.sold++;
        SND.cash();
        SND.droneOff();
        this.toast(`The drone came by: +$${G.pendingCrate.value}.`);
        G.pendingCrate = null;
        this.save();
      }
    }
    // (NOTHING ADVANCES THE STORY BEHIND YOUR BACK ANY MORE. A sixteen-chapter
    // list used to be polled here every frame and turned its own page the moment
    // a condition came true -- a story that happened TO you, with nobody to talk
    // to about it. The main quest is Fintan's survey now: you take each step from
    // him and you hand it back to him, and Side.handIn is the only thing that
    // moves G.goal. See js/side.js.)
    // autosave
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 25; this.save(); }
    // toasts
    if (this.plunge !== null) this.plunge += this.plunge >= 0 ? dt : -dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter(t => t.t > 0);
    if (this.toasts.length === 0 && this._toastQ.length) this.toasts.push({ msg: this._toastQ.shift(), t: 2.6 });
  },

  drawHUD(c) {
    // left: hearts + purse
    const pw = Math.max(G.maxHearts * 10 + 14, 62);
    uiPanel(c, 6, 6, pw, 30, 0.9, true);
    for (let i = 0; i < G.maxHearts; i++) {
      const kind = G.hearts >= i + 1 ? 'full' : (G.hearts >= i + 0.5 ? 'half' : 'empty');
      drawHeart(c, 11 + i * 10, 10, kind);
    }
    drawAC(c, 'shell_pearl', 15, 27, 12);
    text(c, `${G.money}`, 24, 22.5, { size: 9, color: '#6a4420', shadow: false });

    // right: day + time dial
    uiPanel(c, W - 74, 6, 68, 20, 0.9, true);
    text(c, `Day ${G.day}`, W - 12, 11, { size: 8, color: '#6a4420', align: 'right', shadow: false });
    const dx = W - 60, dy = 20, dr = 8;
    c.strokeStyle = 'rgba(122,74,48,0.4)'; c.lineWidth = 1;
    c.beginPath(); c.arc(dx, dy, dr, Math.PI, 0); c.stroke();
    const day = G.clock > 0.06 && G.clock < 0.66;
    const tt = day ? (G.clock - 0.06) / 0.6 : clamp((G.clock >= 0.66 ? G.clock - 0.66 : G.clock + 0.34) / 0.4, 0, 1);
    const a = Math.PI + tt * Math.PI;
    c.fillStyle = day ? '#e8a93c' : '#8a9ab8';
    c.beginPath(); c.arc(dx + Math.cos(a) * dr, dy + Math.sin(a) * dr, 2.4, 0, TAU); c.fill();
    // (the [H]/[J] hint used to live here; the tracker below is the affordance
    // now, and the help screen itself lists the keys)

    // ---- the chapter tracker, on the RIGHT side like a proper quest log tab.
    // It used to be a banner parked dead centre over the play field; now it
    // hangs under the day panel, shows the chapter, its live progress when the
    // chapter is countable, and the current hint -- and clicking it (or [J])
    // opens the journal.
    {
      // the main quest is whichever step of Fintan's survey is still open, and
      // whether you have TAKEN it is part of what the tracker has to say
      const S_ = (typeof Side !== 'undefined' && Side && Side.ensure()) ? Side : null;
      const q = S_ ? S_.mainNow() : null;
      const took = q && S_ ? S_.taken(q.key) : false;
      const ready = q && took && S_ ? S_.isDone(q) : false;
      const name = q ? q.name : 'The pier, at ease';
      const hint = !q ? ''
        : (!took ? 'Fintan has the next one -- go and ask'
          : (ready ? 'done -- take it back to Fintan' : (q.how || '')));
      const p = (q && took && S_) ? S_.prog(q) : null;
      const tw = 118;
      const th = p ? 40 : 34;
      const tx = W - tw - 6, ty = 68;   // below the day panel and the icon buttons
      this._goalRect = { x: tx, y: ty, w: tw, h: th };
      if (typeof Quests !== 'undefined' && Quests._pulse > 0) {
        c.globalAlpha = 0.3 + 0.2 * Math.sin(this.time * 6);
        c.fillStyle = '#ffe6b0';
        c.fillRect(tx - 2, ty - 2, tw + 4, th + 4);
        c.globalAlpha = 1;
      }
      uiPanel(c, tx, ty, tw, th, 0.94, true);
      // the little star, then the chapter name, clipped to the panel
      c.save();
      c.beginPath(); c.rect(tx + 4, ty + 3, tw - 8, th - 6); c.clip();
      c.fillStyle = '#e8a93c';
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI / 2 + i * TAU / 5;
        const ang2 = ang + TAU / 10;
        c.lineTo(tx + 10 + Math.cos(ang) * 3.5, ty + 9 + Math.sin(ang) * 3.5);
        c.lineTo(tx + 10 + Math.cos(ang2) * 1.6, ty + 9 + Math.sin(ang2) * 1.6);
      }
      c.closePath(); c.fill();
      text(c, name, tx + 17, ty + 5.5, { size: 6.5, color: '#4a3020', shadow: false });
      text(c, hint, tx + 7, ty + 16, { size: 5.5, color: '#8a6a48', shadow: false });
      if (p) {
        // the progress bar, with the count on it
        const bw = tw - 14, bx = tx + 7, by2 = ty + 26;
        c.fillStyle = 'rgba(90,52,30,0.30)';
        c.fillRect(bx, by2, bw, 6);
        c.fillStyle = '#5f9e4a';
        c.fillRect(bx, by2, bw * clamp(p.n / p.of, 0, 1), 6);
        text(c, `${p.n}/${p.of}`, bx + bw / 2, by2 - 0.5, { size: 5.5, color: '#f6e8c9', align: 'center', shadow: false });
      }
      c.restore();

      // ---- and under it, the ERRANDS strip. One line, and it names the errand
      // rather than counting them, because "3 errands" tells you nothing and
      // "Ten blades of kelp 6/10" tells you where to swim. A finished one takes
      // the slot and turns green: that is the cue to go and hand it over.
      if (typeof Side !== 'undefined' && Side && Side.ensure()) {
        const act = Side.active();
        if (act.length) {
          let show = null;
          for (const q of act) if (Side.isDone(q)) { show = q; break; }
          const ready = !!show;
          if (!show) show = act[0];
          const sp = Side.prog(show);
          const ey = ty + th + 4;
          this._sideRect = { x: tx, y: ey, w: tw, h: 24 };
          uiPanel(c, tx, ey, tw, 24, 0.94, true);
          c.save();
          c.beginPath(); c.rect(tx + 4, ey + 3, tw - 8, 18); c.clip();
          c.fillStyle = ready ? '#3f9a58' : '#8a6a44';
          c.fillRect(tx + 7, ey + 6, 4, 4);
          text(c, show.name, tx + 15, ey + 4, { size: 6, color: ready ? '#2f6b40' : '#4a3020', shadow: false });
          const tail = ready
            ? `ready -- ${(typeof Quests !== 'undefined' && Quests.GIVER_NAMES[show.from]) || show.from} is waiting`
            : (sp ? `${sp.n}/${sp.of}` : '');
          text(c, tail + (act.length > 1 ? `   (+${act.length - 1} more)` : ''), tx + 15, ey + 13,
            { size: 5.5, color: ready ? '#3f9a58' : '#8a6a48', shadow: false });
          c.restore();
        } else { this._sideRect = null; }
      }
    }
  },

  // Toasts no longer render. The queue machinery stays (systems still call
  // Game.toast and some tests read it) but nothing is painted: the tracker, the
  // journal, the prompts and the world itself carry the information now, and
  // the little bottom chip was the last notification left to remove.
  drawToasts(c) {},


  drawHelp(c) {
    c.fillStyle = 'rgba(4,7,11,0.8)';
    c.fillRect(0, 0, W, H);
    uiPanel(c, 52, 20, W - 104, H - 40, 0.97);
    text(c, "~ OTTO'S FIELD GUIDE ~", W / 2, 30, { size: 11, color: '#ffe6b0', align: 'center' });
    const touch = TouchUI.enabled;
    const lines = touch ? [
      ['ON THE SURFACE', '#5ad2f0'],
      ['  Arrow buttons walk. The paw button interacts.', '#d8ccb4'],
      ['  Laptop sells (drone pays on pickup). Workbench', '#d8ccb4'],
      ['  cracks shells & polishes treasures -- worth more!', '#d8ccb4'],
      ['  Sleep to heal. Beds regrow overnight... partly.', '#d8ccb4'],
      ['UNDER THE SEA', '#5ad2f0'],
      ['  Scrape crust off a shell, then HOLD to pry --', '#d8ccb4'],
      ['  let go in the green! No button gets you home:', '#d8ccb4'],
      ['  SWIM UP before your O2 runs out.', '#ffe6b0'],
      ['  Urchins sting, jellyfish numb, eels lunge from dens,', '#d8ccb4'],
      ['  If the water goes quiet... DON\'T. MOVE.', '#e8434c'],
      ['  Tap anywhere to close this guide.', '#8a9484'],
    ] : [
      ['ON THE SURFACE', '#5ad2f0'],
      ['  A/D or arrows ... walk        E ... interact', '#d8ccb4'],
      ['  Laptop sells (drone pays on pickup). Workbench', '#d8ccb4'],
      ['  cracks shells & polishes treasures -- worth more!', '#d8ccb4'],
      ['  Sleep to heal. Beds regrow overnight... partly.', '#d8ccb4'],
      ['UNDER THE SEA', '#5ad2f0'],
      ['  Scrape crust (hold LMB), then HOLD on the shell to', '#d8ccb4'],
      ['  pry -- release in the green! W/S ... swim.', '#d8ccb4'],
      ['  No surface button: SWIM UP before O2 runs out.', '#ffe6b0'],
      ['  Urchins sting, jellyfish numb, eels lunge from dens,', '#d8ccb4'],
      ['  If the water goes quiet... DON\'T. MOVE.', '#e8434c'],
      ['  M ... mute      H ... close this guide', '#8a9484'],
    ];
    let y = 46;
    for (const [ln, col] of lines) {
      text(c, ln, 66, y, { size: 7, color: col });
      y += 12;
    }
    // the plan, right in the guide. It read `cur.hint` -- a field the old chapter
    // list had and the survey does not -- so the guide printed the word
    // "undefined" at the player on every single open.
    text(c, "OTTO'S PLAN", 66, y + 2, { size: 7, color: '#ffe66e' });
    const S_ = (typeof Side !== 'undefined' && Side && Side.ensure()) ? Side : null;
    const cur = S_ ? S_.mainNow() : null;
    const n = S_ ? S_.mainDone() : 0, of = S_ ? S_.main().length : 0;
    let line;
    if (!cur) line = `  The survey is finished. ${of}/${of}.`;
    else if (S_ && !S_.taken(cur.key)) line = `  ${n}/${of} done  >  ask Fintan for "${cur.name}"`;
    else line = `  ${n}/${of} done  >  ${cur.name} — ${cur.how || ''}`;
    text(c, line, 66, y + 14, { size: 7, color: '#d8ccb4' });
  },

  drawCursor(c) {
    const m = Input.mouse;
    if (TouchUI.enabled) return;
    const custom = this.scene && this.scene.customCursor && !Shop.open && !this.helpOpen;
    if (custom) return; // dive scene draws its own scraper-paw
    if (m.idleT > 3 && !Shop.open && this.scene !== TitleScene && !this.helpOpen) return;
    c.save();
    c.translate(Math.round(m.x), Math.round(m.y));
    c.fillStyle = '#101820';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.lineTo(3, 8); c.lineTo(7, 8); c.closePath(); c.fill();
    c.fillStyle = '#f2f4f6';
    c.beginPath(); c.moveTo(1, 2); c.lineTo(1, 8.5); c.lineTo(2.8, 7); c.lineTo(5, 7); c.closePath(); c.fill();
    c.restore();
  },
};

// ---- title screen -----------------------------------------------------------------
const TitleScene = {
  customCursor: false,
  time: 0,
  sel: 0,
  confirm: false,      // "start over?" armed on the New Tide row

  enter() { this.time = 0; this.sel = 0; this.confirm = false; SND.setScene('title'); },

  // The rows are built per frame because hasSave() can change under us (New Tide
  // wipes it). Continue leads when there is a save; otherwise Begin stands alone.
  _rows() {
    const rows = [];
    if (Game.hasSave()) rows.push({ key: 'continue', label: 'continue' });
    rows.push({ key: 'new', label: Game.hasSave() ? (this.confirm ? 'start over -- sure?' : 'new tide') : 'begin' });
    rows.push({ key: 'sound', label: SND.muted ? 'sound: off' : 'sound: on' });
    return rows;
  },
  // The board is LEFT of centre so Otto's working column has the right third to
  // itself. Both the draw and the hit test read these two, so they cannot drift.
  _boardX() { return Math.round(W * 0.5 - 168 - 18); },
  _rowY(i) { return 176 + i * 17; },

  _activate(row) {
    if (row.key === 'continue') {
      Game.load();
      Game.go(WorldScene, {});
      this._armLetter();
    } else if (row.key === 'new') {
      // a saved pier deserves one "are you sure" -- and only one
      if (Game.hasSave() && !this.confirm) { this.confirm = true; SND.blip(); return; }
      this.confirm = false;
      Game.newGame();
      // the opening: Otto swims home. It arms the letter itself, and every key
      // skips it, so the worst case is two seconds of nice water.
      if (typeof IntroScene !== 'undefined') Game.go(IntroScene, {});
      else { Game.go(WorldScene, {}); this._armLetter(); }
    } else if (row.key === 'sound') {
      SND.toggleMute();
      SND.blip();
    }
  },

  // The opening letter is armed HERE, at the front door, and only here -- so a
  // player always gets it once, and a test harness that jumps straight into a
  // scene is never parked behind a prop it has no key for.
  _armLetter() {
    if (typeof Quests !== 'undefined' && G && G.flags && !G.flags.letter) Quests.letter = true;
  },

  update(dt) {
    this.time += dt;
    const rows = this._rows();
    this.sel = clamp(this.sel, 0, rows.length - 1);
    if (Input.p('ArrowDown') || Input.p('KeyS')) { this.sel = (this.sel + 1) % rows.length; this.confirm = false; SND.blip(); }
    if (Input.p('ArrowUp') || Input.p('KeyW')) { this.sel = (this.sel + rows.length - 1) % rows.length; this.confirm = false; SND.blip(); }
    if (Input.p('Escape')) this.confirm = false;
    if (Input.p('Enter') || Input.p('Space')) { this._activate(rows[this.sel]); return; }
    // pointer: hover selects, click activates; a click anywhere else continues,
    // because "tap to play" is still the promise on a phone
    const m = Input.mouse;
    let overRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const y = this._rowY(i);
      const bx0 = this._boardX();
      if (m.y >= y - 5 && m.y <= y + 10 && m.x > bx0 && m.x < bx0 + 168) overRow = i;
    }
    if (overRow >= 0 && overRow !== this.sel) { this.sel = overRow; this.confirm = false; }
    if (m.clicked) {
      if (overRow >= 0) this._activate(rows[overRow]);
      else this._activate(rows[0]);
    }
  },

  draw(c) {
    // THE MENU IS THE GAME. Not a painted approximation of it: this runs the real
    // Ocean scene -- its water, its light, its seabed, its plants, its bubbles --
    // with the camera parked on a quiet stretch and Otto's own swim cycle diving
    // down to tend a bed. Everything you see here is the thing you are about to
    // play, which is the only way a title screen can honestly promise anything.
    //
    // Ocean.draw() is called with the HUD suppressed (Game.scene is TitleScene, so
    // main.js already skips drawHUD), and Ocean.update is never called -- the
    // camera and Otto are posed by hand below, so no game state moves.
    const t = this.time;
    let live = false;
    if (typeof Ocean !== 'undefined' && Ocean.ensure && G) {
      try {
        if (Ocean.ensure()) {
          // pose: a slow drift east along a garden stretch, Otto descending to a
          // bed and rising again on a long cycle
          const CY = 15;
          const k = (t % CY) / CY;
          // A FIXED quiet stretch. The camera used to creep east and, given a
          // minute, sailed straight into a neighbour's house (they stand at 880,
          // 2380 and beyond). 1500 is open garden between two of them; the shot
          // breathes on a slow sine instead of travelling.
          const bx = 1500 + Math.sin(t * 0.12) * 26;
          // He is framed RIGHT OF CENTRE. Posed dead centre he swam straight
          // through the menu -- the "continue" plate had an otter lying across
          // it -- and no amount of transparency fixes a character standing where
          // the buttons are. The camera is offset so his working column sits in
          // the right third and the board owns the left.
          const OFF = 62;
          const dive = Math.sin(k * TAU) * 0.5 + 0.5;   // 0 at the surface, 1 at the sand
          const floor = Ocean.floorAt(bx);
          Ocean.time = t;
          Ocean.px = bx;
          // He works the BEDS: the cycle runs between hovering over the garden and
          // settling onto it, never up to the surface, so he stays clear of the
          // logo and the menu rows and always reads as tending something.
          Ocean.py = lerp(floor - 68, floor - 18, dive);
          Ocean.vx = 6; Ocean.vy = Math.cos(k * TAU) * 40;
          Ocean.face = 1;
          Ocean.anim = dive > 0.55 ? 'dive' : 'cruise';
          Ocean.animT = t;
          Ocean.animFrame = (dive > 0.55 ? 'oswim_1' : 'oswim_' + (Math.floor(t * 6.5) % 4));
          Ocean.camX = bx - Ocean.VW * 0.5 - OFF;
          // frame the sand along the bottom, Otto a little below centre
          Ocean.camY = floor + 4 - Ocean.VH;   // sand along the very bottom, no dead fill under it
          // The scene's own HUD -- air gauge, bag, prompts -- has no business on a
          // title screen, and Ocean.draw paints it internally. Stub it for this one
          // call and put it straight back, so nothing about the real scene changes.
          const hud = Ocean._drawHUD;
          Ocean._drawHUD = function () {};
          try { Ocean.draw(c); } finally { Ocean._drawHUD = hud; }
          live = true;
        }
      } catch (e) { live = false; }
    }
    if (!live) {
      // the sea loop, if the ocean could not be posed for any reason
      const sm0 = c.imageSmoothingEnabled;
      c.imageSmoothingEnabled = false;
      const oc = ASSETS[`ocean${Math.floor(t * 8) % 12}`];
      if (oc && oc.width) c.drawImage(oc, 0, 0, W, H); else { c.fillStyle = '#2a6a8a'; c.fillRect(0, 0, W, H); }
      c.imageSmoothingEnabled = sm0;
    }

    // THE FURNITURE. Everything below is a HANGING SIGN and a BOARD, drawn from
    // the same wood as every panel in the game, because the title screen was the
    // one place still setting bare text straight onto the water:
    //
    //   * the name floated on the seaweed with a drop shadow and nothing behind
    //     it, so it read as text over a screenshot
    //   * only the SELECTED row had a plate; the other two were loose text, so
    //     the menu changed shape as you arrowed down it
    //   * three stacked translucent rects were supposed to calm the water and
    //     instead put three hard horizontal steps across the whole screen
    //   * and Otto swam straight through all of it
    //
    // A sign and a board fix every one of those at once: they are opaque, so the
    // scene passes BEHIND them, and they are the game's own furniture, so the
    // menu is made of the same thing the journal is.

    // ---- the hanging sign ---------------------------------------------------
    const sw = 268, sh = 72, sx = (W - sw) / 2, sy = 14;
    // two ropes up out of frame, swaying a hair with the sign
    const sway = Math.sin(t * 0.6) * 0.6;
    c.fillStyle = '#6b4a2a';
    c.fillRect(sx + 26, 0, 2, sy + 4);
    c.fillRect(sx + sw - 28, 0, 2, sy + 4);
    c.save();
    c.translate(W / 2, sy);
    c.rotate(sway * 0.0035);
    c.translate(-W / 2, -sy);
    uiPanel(c, sx, sy, sw, sh, 0.97, true);
    text(c, "MR. OTTO'S", W / 2, sy + 8, { size: 14, color: '#7a5232', align: 'center', shadow: false });
    text(c, 'CLAM FARM', W / 2, sy + 24, { size: 22, color: '#3f6d86', align: 'center', shadow: false });
    // a rule and the tagline, on the sign where a sign would carry it
    for (let dx2 = sx + 22; dx2 < sx + sw - 22; dx2 += 6) {
      c.fillStyle = '#b08a5c'; c.fillRect(dx2, sy + 52, 4, 1.5);
      c.fillStyle = '#8a6a44'; c.fillRect(dx2 + 1, sy + 53.5, 4, 1);
    }
    text(c, 'a little life on the water', W / 2, sy + 57, { size: 7, color: '#8a6a48', align: 'center', shadow: false });
    c.restore();

    // ---- the menu board -----------------------------------------------------
    const rows = this._rows();
    const bw = 168, bh = 24 + rows.length * 17;
    const bx2 = this._boardX(), by2 = this._rowY(0) - 12;
    uiPanel(c, bx2, by2, bw, bh, 0.97, true);
    for (let i = 0; i < rows.length; i++) {
      const y = this._rowY(i);
      const on = i === this.sel;
      if (on) {
        // the selected line gets an inked plate and a pointing paw-print dot,
        // so the shape of the board never changes as you move down it
        c.fillStyle = 'rgba(122,74,48,0.20)';
        c.fillRect(bx2 + 7, y - 5, bw - 14, 15);
        c.fillStyle = '#8a5a2c';
        c.fillRect(bx2 + 11, y + 1, 3, 3);
      }
      text(c, rows[i].label, bx2 + bw / 2 + 4, y, {
        size: 9, align: 'center', shadow: false,
        color: on ? '#4a3020' : '#8a6a48',
      });
    }
    // the hint lives ON the board: under it, it sat on the sand and vanished
    for (let dx3 = bx2 + 14; dx3 < bx2 + bw - 14; dx3 += 6) {
      c.fillStyle = '#c9ab78'; c.fillRect(dx3, by2 + bh - 15, 4, 1);
    }
    text(c, TouchUI.enabled || matchMedia('(pointer: coarse)').matches
      ? 'tap a line' : 'arrows + enter', bx2 + bw / 2, by2 + bh - 11,
      { size: 6, color: '#a4805a', align: 'center', shadow: false });
  },
};

// ---- main loop -------------------------------------------------------------------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000) || 0.016;
  lastT = now;

  // mouse speed (used by the shark's stare)
  const m = Input.mouse;
  const dist = Math.hypot(m.x - m.lastX, m.y - m.lastY);
  m.speed = lerp(m.speed, dist / Math.max(dt, 0.001), 0.5);
  m.lastX = m.x; m.lastY = m.y;
  m.idleT = dist > 0.5 ? 0 : m.idleT + dt;

  // touch button layout must exist before events land between frames
  TouchUI.buttons = TouchUI.layout();

  // global keys
  // [M] belongs to the sea chart now; mute moved to the key next door.
  if (Input.p('KeyN')) {
    const muted = SND.toggleMute();
    Game.toast(muted ? 'Sound muted.' : 'Sound on.');
  }
  if (G && Game.scene !== TitleScene && !Shop.open && !Bench.open && Input.p('KeyH'))
    Game.helpOpen = !Game.helpOpen;

  // one-time landscape hint on phones
  if (TouchUI.enabled && !Game.rotHinted && window.innerHeight > window.innerWidth) {
    Game.rotHinted = true;
    Game.toast('Sideways is roomier, if you like.');
  }

  // updates
  // The journal (and the opening letter) run BEFORE the branch so [J] can open
  // them, and they park the scene while up -- same standing as Shop and Bench.
  if (Game.fadeDir === 0 && G && Game.scene !== TitleScene &&
      typeof Quests !== 'undefined' && !Shop.open && !Bench.open && !Game.helpOpen) {
    Quests.update(dt);
    if (typeof Cine !== 'undefined') Cine.update(dt);
    // clicking the chapter banner is the mouse's way into the journal
    if (!Quests.open && !Quests.letter && Input.mouse.clicked && Game._goalRect) {
      const r = Game._goalRect, m = Input.mouse;
      if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) {
        Quests.open = true;
        Quests.tab = 0;
        Quests.scroll = clamp((G.goal || 0) - 1, 0, Math.max(0, QUESTS.length - Quests.ROWS));
        SND.blip();
      }
    }
    // and the errand strip under it opens the journal on the OTHER page
    if (!Quests.open && !Quests.letter && Input.mouse.clicked && Game._sideRect) {
      const r = Game._sideRect, m = Input.mouse;
      if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) {
        Quests.open = true; Quests.tab = 1; Quests.escroll = 0;
        SND.blip();
      }
    }
  }
  const questUp = typeof Quests !== 'undefined' && (Quests.open || Quests.letter);
  if (Game.fadeDir === 0) {
    if (Game.helpOpen) {
      if (Input.p('Escape') || Input.mouse.clicked) Game.helpOpen = false;
    } else if (Shop.open) {
      Shop.update(dt);
    } else if (Bench.open) {
      Bench.update(dt);
    } else if (questUp) {
      // parked: the journal or the letter has the frame
    } else if (Game.scene) {
      Game.scene.update(dt);
    }
  }
  if (G && Game.scene !== TitleScene && !questUp) Game.globalUpdate(dt);
  Game.updateFade(dt);
  SND.update(G ? G.musicOn : true);

  // draw — everything in logical 480x270 units at DPX texel density.
  //
  // THE TRANSFORM IS RESET, NOT RESTORED. This used to be a bare save/scale and
  // trust the matching restore at the bottom, and one unbalanced ctx.save()
  // anywhere in a scene broke the whole game: the trailing restore() popped the
  // wrong level, scale(DPX) survived the frame, and the NEXT frame multiplied it
  // again. Four, sixteen, sixty-four... measured at 9.8e+55 after a couple of
  // seconds, at which point one fillRect covers the canvas and everything else
  // lands somewhere past the heat death of the coordinate system. What the player
  // sees is the ocean turning into a single flat blue rectangle, intermittently,
  // depending on whether the leaking path ran.
  //
  // Starting each frame from a known identity makes a leak cost one frame instead
  // of the session, and costs nothing.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.scale(DPX, DPX);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (Game.scene) Game.scene.draw(ctx);
  // the harbour's interact prompt goes on last, over every prop layer that
  // chains onto WorldScene.draw -- see WorldScene.drawPrompt
  if (Game.scene === WorldScene && WorldScene.drawPrompt) WorldScene.drawPrompt(ctx);
  // colour grade the world (never the UI): richer colour, deeper shadows.
  // Re-draw the finished frame through a filter — blend modes would scramble hue.
  if (Game.scene) {
    ctx.save();
    // one gentle contrast pass — a global multiply would grey out the whites
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(46,96,132,0.16)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    // corner vignette to seat the scene, baked once — evaluating a radial
    // gradient over every device pixel each frame is far too expensive. The cache
    // is already at device resolution so this maps 1:1, and saying so explicitly
    // keeps it off the bilinear path: a filtered blit is priced per destination
    // pixel whether or not the scale factor turns out to be 1.
    const vsm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(vignette(), 0, 0, W, H);
    ctx.imageSmoothingEnabled = vsm;
    ctx.restore();
  }
  // the HUD goes under the modals — a full-screen panel would collide with it
  // A CUT OWNS THE FRAME. The intro is a whole scene; a Cine beat plays over
  // whatever you were standing in -- and a letterboxed shot with the hearts, the
  // day panel and two quest trackers still lit in the corners is not a cut, it is
  // a screenshot with black bars on it. Both suppress the HUD the same way.
  const cine = (typeof IntroScene !== 'undefined' && Game.scene === IntroScene) ||
    (typeof Cine !== 'undefined' && Cine.cur);
  if (G && Game.scene !== TitleScene && !cine && !Shop.open && !Bench.open) Game.drawHUD(ctx);
  if (Shop.open) Shop.draw(ctx);
  if (Bench.open) Bench.draw(ctx);
  // the journal and the opening letter sit above the HUD, below the touch pads
  if (G && Game.scene !== TitleScene && !cine && typeof Quests !== 'undefined') Quests.draw(ctx);
  // the errand hand-in slip sits above everything but the touch pads: it goes up
  // WHILE the dialogue box is still open, which is the moment it is about
  if (G && Game.scene !== TitleScene && !cine && typeof Side !== 'undefined') Side.draw(ctx);
  // the cinematic beats go OVER everything but the fade: they are cuts, and a cut
  // is the top of the frame by definition
  if (G && Game.scene !== TitleScene && typeof Cine !== 'undefined') Cine.draw(ctx);
  TouchUI.draw(ctx);
  Game.drawToasts(ctx);
  if (Game.helpOpen) Game.drawHelp(ctx);
  if (Game.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(Game.fade, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
  }
  Game.drawPlunge(ctx);
  Game.drawCursor(ctx);
  ctx.restore();

  Input.endFrame();
  requestAnimationFrame(frame);
}

resize();
ctx.save();
ctx.scale(DPX, DPX);
ctx.fillStyle = '#0a1420';
ctx.fillRect(0, 0, W, H);
text(ctx, 'loading the sea...', W / 2, H / 2 - 4, { size: 10, color: '#9fc4d4', align: 'center' });
ctx.restore();
loadAssets(() => {
  // The game state is created HERE, before the menu, on purpose: everything in
  // the codebase (and every test harness) treats "G exists" as "the game is up",
  // and the title is just the front porch. Continue re-loads over this; New Tide
  // replaces it. Nothing is lost either way because nothing has happened yet.
  //
  // The pixel font finishes loading first, or the opening frames render in
  // fallback Courier and visibly swap a beat later. Both paths of the promise
  // boot -- a font is never worth a black screen.
  const boot = () => {
    if (Game.hasSave()) Game.load(); else Game.newGame();
    Game.scene = TitleScene;
    TitleScene.enter();
    requestAnimationFrame(frame);
  };
  if (typeof FONT_READY !== 'undefined' && FONT_READY && FONT_READY.then) FONT_READY.then(boot, boot);
  else boot();
});
