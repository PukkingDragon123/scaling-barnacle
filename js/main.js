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
    if (Game.helpOpen || Shop.open || Bench.open) return b;
    const sc = Game.scene;
    if (sc === WorldScene || sc === HouseScene) {
      b.push({ x: 8, y: H - 52, w: 44, h: 44, key: 'ArrowLeft', icon: 'left' });
      b.push({ x: 58, y: H - 52, w: 44, h: 44, key: 'ArrowRight', icon: 'right' });
      b.push({ x: W - 52, y: H - 52, w: 44, h: 44, tap: 'KeyE', icon: 'act' });
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

  toast(msg) {
    this.toasts.push({ msg, t: 4.5 });
    if (this.toasts.length > 4) this.toasts.shift();
  },

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
      for (const k of ['storage', 'gear', 'stats', 'flags', 'decor'])
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
        this.toast(`Drone pickup: +$${G.pendingCrate.value}!`);
        G.pendingCrate = null;
        this.save();
      }
    }
    // Otto's plan: advance the current goal when its condition is met
    if (G.goal < GOALS.length && GOAL_DONE[G.goal](G)) {
      const done = GOALS[G.goal];
      G.goal++;
      G.money += 25;
      SND.chime();
      this.toast(`Goal complete: ${done.name}!  (+$25)`);
      if (G.goal >= GOALS.length) this.toast('Otto is living the dream. You did it!');
      this.save();
    }
    // autosave
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 25; this.save(); }
    // toasts
    if (this.plunge !== null) this.plunge += this.plunge >= 0 ? dt : -dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter(t => t.t > 0);
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
    if (this.scene !== DiveScene && !TouchUI.enabled)
      text(c, '[H] help', W - 12, 29, { size: 6.5, color: 'rgba(255,255,255,0.75)', align: 'right' });

    // centre: current goal
    const goalTxt = G.goal < GOALS.length ? GOALS[G.goal].name : 'Living the dream';
    const gw = textWidth(c, goalTxt, 7) + 28;
    uiPanel(c, W / 2 - gw / 2, 6, gw, 15, 0.92, true);
    c.fillStyle = '#e8a93c';
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + i * TAU / 5;
      const ang2 = ang + TAU / 10;
      c.lineTo(W / 2 - gw / 2 + 11 + Math.cos(ang) * 4, 13.5 + Math.sin(ang) * 4);
      c.lineTo(W / 2 - gw / 2 + 11 + Math.cos(ang2) * 1.8, 13.5 + Math.sin(ang2) * 1.8);
    }
    c.closePath(); c.fill();
    text(c, goalTxt, W / 2 + 6, 9.5, { size: 7, color: '#6a4420', align: 'center', shadow: false });
  },

  drawToasts(c) {
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[this.toasts.length - 1 - i];
      const a = clamp(t.t, 0, 1);
      const y = H - 18 - i * 14;
      c.globalAlpha = a;
      const w = textWidth(c, t.msg, 7) + 14;
      uiPanel(c, W / 2 - w / 2, y - 3, w, 13, 0.96, true);
      text(c, t.msg, W / 2, y, { size: 7, color: '#4a3020', align: 'center', shadow: false });
      c.globalAlpha = 1;
    }
  },

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
    // the plan, right in the guide
    text(c, "OTTO'S PLAN", 66, y + 2, { size: 7, color: '#ffe66e' });
    const cur = G.goal < GOALS.length ? GOALS[G.goal] : null;
    text(c, cur
      ? `  ${G.goal}/${GOALS.length} done  >  ${cur.name} — ${cur.hint}`
      : `  All ${GOALS.length} goals complete. Otto is living the dream!`,
      66, y + 14, { size: 7, color: '#d8ccb4' });
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
  time: 0, fin: null, finT: 5,

  enter() { this.time = 0; SND.setScene('title'); },

  update(dt) {
    this.time += dt;
    this.finT -= dt;
    if (this.finT <= 0 && !this.fin) {
      this.fin = { x: -20 };
      this.finT = rand(9, 18);
    }
    if (this.fin) {
      this.fin.x += 46 * dt;
      if (this.fin.x > W + 20) this.fin = null;
    }
    if (Input.p('Enter') || Input.p('Space') || Input.mouse.clicked) {
      if (Game.hasSave()) Game.load(); else Game.newGame();
      Game.go(WorldScene, {});
      return;
    }
    if (Input.p('KeyN')) {
      Game.newGame();
      Game.go(WorldScene, {});
    }
  },

  draw(c) {
    // the painted sea, alive
    SKY.update(0, this.time);
    SKY.drawSky(c, 0.62, this.time, 0);
    SKY.drawSea(c, 0.62, this.time, 0);
    // shark fin drive-by (a promise of things to come)
    if (this.fin) {
      c.fillStyle = '#141c26';
      c.beginPath();
      c.moveTo(this.fin.x - 8, 186);
      c.quadraticCurveTo(this.fin.x, 168, this.fin.x + 6, 186);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(this.fin.x - 12, 186, 22, 1);
    }
    // drifting shells
    for (let i = 0; i < 3; i++) {
      const keys = ['clam', 'mussel', 'scallop'];
      const bx = 70 + i * 160 + Math.sin(this.time * 0.7 + i * 2) * 8;
      const by = 232 + Math.sin(this.time * 1.2 + i * 2.6) * 3;
      c.globalAlpha = 0.9;
      drawAC(c, `shell_${keys[i]}`, bx, by, 15);
      c.globalAlpha = 1;
    }
    // otter on a buoy
    const bob = Math.sin(this.time * 1.5) * 3;
    c.fillStyle = '#8a2620';
    c.beginPath(); c.arc(W / 2, 209 + bob, 13, 0, TAU); c.fill();
    c.fillStyle = '#c8352a';
    c.beginPath(); c.arc(W / 2 - 1, 208 + bob, 11.5, 0, TAU); c.fill();
    c.fillStyle = '#f2ede2';
    c.fillRect(W / 2 - 12, 203 + bob, 24, 4);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(W / 2, 222 + bob * 0.4, 15, 3, 0, 0, TAU); c.fill();
    const br = Math.sin(this.time * 2.1) * 0.02;
    const oimg = ASSETS.o2_10;   // waving hello
    if (oimg && oimg.width) {
      c.save();
      c.translate(W / 2, 204 + bob);
      c.scale(1 - br * 0.7, 1 + br);
      c.drawImage(oimg, -13, -26, 26 * oimg.width / oimg.height, 26);
      c.restore();
    }
    // title with layered drop shadow
    const wob = Math.sin(this.time * 2) * 2;
    text(c, "MR. OTTO'S", W / 2 + 2, 40 + wob + 2, { size: 26, color: 'rgba(30,12,24,0.8)', align: 'center', shadow: false });
    text(c, "MR. OTTO'S", W / 2, 40 + wob, { size: 26, color: '#ffe6b0', align: 'center', shadow: false });
    text(c, 'CLAM FARM', W / 2 + 3, 70 - wob + 3, { size: 32, color: 'rgba(20,30,50,0.85)', align: 'center', shadow: false });
    text(c, 'CLAM FARM', W / 2, 70 - wob, { size: 32, color: '#5ad2f0', align: 'center', shadow: false });
    text(c, 'a cozy clam-scraping sim ... mostly cozy', W / 2, 112, { size: 8, color: '#f4d4a8', align: 'center' });
    // prompt
    if (Math.sin(this.time * 4) > -0.3) {
      const label = TouchUI.enabled || matchMedia('(pointer: coarse)').matches
        ? 'TAP to ' + (Game.hasSave() ? 'continue' : 'start')
        : (Game.hasSave() ? 'Press ENTER to continue' : 'Press ENTER to start');
      text(c, label, W / 2, 240, { size: 10, color: '#fff', align: 'center' });
    }
    if (Game.hasSave())
      text(c, '[N] new game', W / 2, 255, { size: 7, color: '#c8b49a', align: 'center' });
    text(c, '[M] mute', 8, H - 12, { size: 6, color: '#a89478' });
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
  if (Input.p('KeyM')) {
    const muted = SND.toggleMute();
    Game.toast(muted ? 'Sound muted.' : 'Sound on.');
  }
  if (G && Game.scene !== TitleScene && !Shop.open && !Bench.open && Input.p('KeyH'))
    Game.helpOpen = !Game.helpOpen;

  // one-time landscape hint on phones
  if (TouchUI.enabled && !Game.rotHinted && window.innerHeight > window.innerWidth) {
    Game.rotHinted = true;
    Game.toast('Tip: rotate your phone for a bigger view!');
  }

  // updates
  if (Game.fadeDir === 0) {
    if (Game.helpOpen) {
      if (Input.p('Escape') || Input.mouse.clicked) Game.helpOpen = false;
    } else if (Shop.open) {
      Shop.update(dt);
    } else if (Bench.open) {
      Bench.update(dt);
    } else if (Game.scene) {
      Game.scene.update(dt);
    }
  }
  if (G && Game.scene !== TitleScene) Game.globalUpdate(dt);
  Game.updateFade(dt);
  SND.update(G ? G.musicOn : true);

  // draw — everything in logical 480x270 units at DPX texel density
  ctx.save();
  ctx.scale(DPX, DPX);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (Game.scene) Game.scene.draw(ctx);
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
    // gradient over every device pixel each frame is far too expensive
    ctx.drawImage(vignette(), 0, 0, W, H);
    ctx.restore();
  }
  // the HUD goes under the modals — a full-screen panel would collide with it
  if (G && Game.scene !== TitleScene && !Shop.open && !Bench.open) Game.drawHUD(ctx);
  if (Shop.open) Shop.draw(ctx);
  if (Bench.open) Bench.draw(ctx);
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
  // straight into the game — no menu
  if (Game.hasSave()) Game.load(); else Game.newGame();
  Game.scene = WorldScene;
  WorldScene.enter({});
  requestAnimationFrame(frame);
});
