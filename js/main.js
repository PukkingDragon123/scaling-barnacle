// ---- input (keyboard + mouse + touch), game state, title, main loop ----------
'use strict';

let G = null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

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
    if (Game.helpOpen || Shop.open) return b;
    const sc = Game.scene;
    if (sc === WorldScene || sc === HouseScene) {
      b.push({ x: 8, y: H - 52, w: 44, h: 44, key: 'ArrowLeft', icon: 'left' });
      b.push({ x: 58, y: H - 52, w: 44, h: 44, key: 'ArrowRight', icon: 'right' });
      b.push({ x: W - 52, y: H - 52, w: 44, h: 44, tap: 'KeyE', icon: 'act' });
      b.push({ x: W - 26, y: 24, w: 20, h: 18, tap: 'KeyH', icon: 'help' });
    } else if (sc === DiveScene) {
      b.push({ x: W - 46, y: H - 122, w: 40, h: 40, key: 'KeyW', icon: 'up' });
      b.push({ x: W - 46, y: H - 76, w: 40, h: 40, key: 'KeyS', icon: 'down' });
      b.push({ x: 8, y: 34, w: 62, h: 20, tap: 'KeyQ', icon: 'surface' });
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
      if (b.icon === 'surface') {
        uiPanel(c, b.x, b.y, b.w, b.h, held ? 0.98 : 0.7);
        text(c, 'SURFACE', b.x + b.w / 2 + 4, b.y + 6, { size: 7, color: held ? '#ffe66e' : '#bfe8f5', align: 'center' });
        c.fillStyle = held ? '#ffe66e' : '#bfe8f5';
        c.beginPath();
        c.moveTo(b.x + 7, b.y + 13); c.lineTo(b.x + 10.5, b.y + 7); c.lineTo(b.x + 14, b.y + 13);
        c.closePath(); c.fill();
        continue;
      }
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
  scene: null, fade: 1, fadeDir: -1, pending: null,
  toasts: [], time: 0, saveT: 25, helpOpen: false,
  rotHinted: false,

  go(scene, arg) {
    this.pending = { scene, arg };
    if (this.fadeDir !== 1) this.fadeDir = 1;
  },

  updateFade(dt) {
    if (this.fadeDir === 1) {
      this.fade += dt * 3;
      if (this.fade >= 1) {
        this.fade = 1;
        const p = this.pending; this.pending = null;
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

  globalUpdate(dt) {
    this.time += dt;
    // day cycle: one full day = 5 real minutes
    G.clock += dt / 300;
    if (G.clock >= 1) {
      G.clock -= 1;
      G.day++;
      this.toast(`Day ${G.day} dawns.`);
      this.save();
    }
    // clam regrowth while not diving
    if (this.scene !== DiveScene) {
      for (let i = 0; i < 3; i++) {
        if (G.growth[i] < 1) {
          G.growth[i] = Math.min(1, G.growth[i] + dt * 0.0045);
          if (G.growth[i] >= 1) G.seeds[i]++;
        }
      }
    }
    // drone shipment
    if (G.pendingCrate) {
      G.pendingCrate.t -= dt;
      if (G.pendingCrate.t <= 0) {
        G.money += G.pendingCrate.value;
        SND.cash();
        SND.droneOff();
        this.toast(`Drone pickup: +$${G.pendingCrate.value}!`);
        G.pendingCrate = null;
        this.save();
      }
    }
    // autosave
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 25; this.save(); }
    // toasts
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter(t => t.t > 0);
  },

  drawHUD(c) {
    // left panel: hearts over coin purse
    const pw = Math.max(G.maxHearts * 9 + 12, 58);
    uiPanel(c, 4, 4, pw, 27, 0.8);
    for (let i = 0; i < G.maxHearts; i++) {
      const kind = G.hearts >= i + 1 ? 'full' : (G.hearts >= i + 0.5 ? 'half' : 'empty');
      drawHeart(c, 9 + i * 9, 8, kind);
    }
    drawSpr(c, SPR.coin, 8, 16.5);
    text(c, `${G.money}`, 18, 17, { size: 8, color: '#ffe66e' });
    // right panel: day + sun/moon dial
    uiPanel(c, W - 68, 4, 64, 18, 0.8);
    text(c, `Day ${G.day}`, W - 9, 9, { size: 8, color: '#efe0bc', align: 'right' });
    // dial: dot travels an arc across a tiny horizon
    const dx = W - 57, dy = 16, dr = 7;
    c.fillStyle = 'rgba(230,200,150,0.4)';
    c.fillRect(dx - dr, dy, dr * 2, PIX);
    const day = G.clock > 0.06 && G.clock < 0.66;
    const tt = day ? (G.clock - 0.06) / 0.6 : clamp((G.clock >= 0.66 ? G.clock - 0.66 : G.clock + 0.34) / 0.4, 0, 1);
    const a = Math.PI + tt * Math.PI;
    c.fillStyle = day ? '#ffe66e' : '#dfe4ee';
    c.fillRect(dx + Math.cos(a) * dr - 1, dy + Math.sin(a) * dr - 1, 2, 2);
    if (this.scene !== DiveScene && !TouchUI.enabled)
      text(c, '[H] help', W - 9, 24, { size: 6, color: 'rgba(220,230,240,0.55)', align: 'right' });
  },

  drawToasts(c) {
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[this.toasts.length - 1 - i];
      const a = clamp(t.t, 0, 1);
      const y = H - 18 - i * 14;
      c.globalAlpha = a;
      const w = textWidth(c, t.msg, 7) + 14;
      uiPanel(c, W / 2 - w / 2, y - 3, w, 13, 0.9);
      text(c, t.msg, W / 2, y, { size: 7, color: '#f4e8cc', align: 'center' });
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
      ['  Sell shells on the laptop; a drone pays on pickup.', '#d8ccb4'],
      ['  Sleep in bed: heal up, clams regrow, day advances.', '#d8ccb4'],
      ['UNDER THE SEA', '#5ad2f0'],
      ['  Hold your paw on shells to scrape them loose.', '#d8ccb4'],
      ['  Right-side arrows swim. SURFACE before O2 runs out!', '#d8ccb4'],
      ['  Purple urchins sting -- don\'t scrape them barehanded.', '#d8ccb4'],
      ['  A red "!" means a barracuda -- lift your paw away!', '#d8ccb4'],
      ['  If the water goes quiet... DON\'T. MOVE.', '#e8434c'],
      ['', '#fff'],
      ['  Tap anywhere to close this guide.', '#8a9484'],
    ] : [
      ['ON THE SURFACE', '#5ad2f0'],
      ['  A/D or arrows ... walk        E ... interact', '#d8ccb4'],
      ['  Sell shells on the laptop; a drone pays on pickup.', '#d8ccb4'],
      ['  Sleep in bed: heal up, clams regrow, day advances.', '#d8ccb4'],
      ['UNDER THE SEA', '#5ad2f0'],
      ['  Hold LEFT MOUSE ... scrape    W/S or wheel ... swim', '#d8ccb4'],
      ['  Q ... surface   Watch the O2 bar!', '#d8ccb4'],
      ['  Purple urchins sting -- don\'t scrape them barehanded.', '#d8ccb4'],
      ['  A red "!" means a barracuda -- move your paw away!', '#d8ccb4'],
      ['  If the water goes quiet... DON\'T. MOVE.', '#e8434c'],
      ['', '#fff'],
      ['  M ... mute      H ... close this guide', '#8a9484'],
    ];
    let y = 48;
    for (const [ln, col] of lines) {
      text(c, ln, 66, y, { size: 7, color: col });
      y += 13.5;
    }
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
    // banded sunset sky
    bandedFill(c, 0, 0, W, 150, hexRGB('#241b40'), hexRGB('#f09a52'), 14);
    // sun with halo rings
    c.fillStyle = 'rgba(255,220,150,0.18)';
    c.beginPath(); c.arc(W / 2, 128, 38, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,224,160,0.3)';
    c.beginPath(); c.arc(W / 2, 128, 31, 0, TAU); c.fill();
    c.fillStyle = '#f8dca2';
    c.beginPath(); c.arc(W / 2, 128, 25, 0, TAU); c.fill();
    c.fillStyle = '#fdf2cc';
    c.beginPath(); c.arc(W / 2 - 5, 122, 12, 0, TAU); c.fill();
    // clouds drifting past, faint so they never fight the title
    for (let i = 0; i < 2; i++) {
      const cl = SPR.clouds[i];
      const cx = ((this.time * (3 + i * 2) + i * 260) % (W + 160)) - 80;
      c.globalAlpha = 0.32;
      drawSpr(c, cl, cx, 18 + i * 108);
      c.globalAlpha = 1;
    }
    // banded sea
    bandedFill(c, 0, 150, W, H - 150, hexRGB('#3f5f78'), hexRGB('#0b1d2c'), 11);
    // sun glint path
    c.fillStyle = 'rgba(255,214,150,0.3)';
    for (let y = 152; y < H; y += 4) {
      const w2 = 16 + (y - 150) * 0.5;
      c.fillRect(W / 2 - w2 / 2 + Math.sin(y * 0.5 + this.time * 2) * 4, y, w2, 1);
    }
    // wave dashes
    for (let row = 0; row < 8; row++) {
      const y = 156 + row * 13;
      c.fillStyle = `rgba(255,220,170,${0.15 - row * 0.014})`;
      for (let x = -20; x < W + 20; x += 30) {
        const ox = Math.sin(this.time * 1.3 + row * 2 + x * 0.05) * 9;
        c.fillRect(Math.round(x + ox), y, 14, 1);
      }
    }
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
      const icons = [SPR.icons.clam, SPR.icons.mussel, SPR.icons.oyster];
      const bx = 60 + i * 160 + Math.sin(this.time * 0.7 + i * 2) * 8;
      const by = 228 + Math.sin(this.time * 1.2 + i * 2.6) * 3;
      c.globalAlpha = 0.85;
      drawSpr(c, icons[i], bx, by);
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
    const blink = (this.time % 3.4) < 0.14;
    drawSpr(c, SPR.otterR[blink ? 3 : 0], W / 2 - 8, 190 + bob);
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
  if (G && Game.scene !== TitleScene && !Shop.open && Input.p('KeyH'))
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
  if (Shop.open) Shop.draw(ctx);
  if (G && Game.scene !== TitleScene) Game.drawHUD(ctx);
  TouchUI.draw(ctx);
  Game.drawToasts(ctx);
  if (Game.helpOpen) Game.drawHelp(ctx);
  if (Game.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(Game.fade, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
  }
  Game.drawCursor(ctx);
  ctx.restore();

  Input.endFrame();
  requestAnimationFrame(frame);
}

resize();
Game.scene = TitleScene;
TitleScene.enter();
requestAnimationFrame(frame);
