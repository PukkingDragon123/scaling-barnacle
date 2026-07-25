// ---- input, game state, title screen, main loop ------------------------------
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

function resize() {
  const scaleRaw = Math.min(window.innerWidth / W, window.innerHeight / H);
  const scale = scaleRaw >= 1 ? Math.max(1, Math.floor(scaleRaw * 2) / 2) : scaleRaw;
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}
window.addEventListener('resize', resize);

window.addEventListener('keydown', (e) => {
  SND.init(); SND.resume();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { Input.keys[e.code] = true; Input.pressed.add(e.code); }
});
window.addEventListener('keyup', (e) => { Input.keys[e.code] = false; });

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) / r.width * W, 0, W),
    y: clamp((e.clientY - r.top) / r.height * H, 0, H),
  };
}
window.addEventListener('mousemove', (e) => {
  const p = toCanvas(e);
  Input.mouse.x = p.x; Input.mouse.y = p.y;
});
window.addEventListener('mousedown', (e) => {
  SND.init(); SND.resume();
  if (e.button === 0) { Input.mouse.down = true; Input.mouse.clicked = true; }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.mouse.down = false; });
window.addEventListener('wheel', (e) => { Input.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- game manager --------------------------------------------------------------
const Game = {
  scene: null, fade: 1, fadeDir: -1, pending: null,
  toasts: [], time: 0, saveT: 25, helpOpen: false,

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
    // hearts
    for (let i = 0; i < G.maxHearts; i++) {
      const kind = G.hearts >= i + 1 ? 'full' : (G.hearts >= i + 0.5 ? 'half' : 'empty');
      drawHeart(c, 8 + i * 9, 7, kind);
    }
    text(c, `$${G.money}`, 8, 16, { size: 9, color: '#ffe66e' });
    text(c, `Day ${G.day}`, W - 10, 7, { size: 8, color: '#e8eef2', align: 'right' });
    // little sun/moon clock icon
    const nite = isNight(G.clock);
    c.fillStyle = nite ? '#dfe4ee' : '#ffe66e';
    c.beginPath(); c.arc(W - 58, 11, 4, 0, TAU); c.fill();
    if (nite) { c.fillStyle = '#141c3a'; c.beginPath(); c.arc(W - 56, 10, 3.2, 0, TAU); c.fill(); }
    if (this.scene !== DiveScene)
      text(c, '[H] help', W - 10, 18, { size: 6, color: 'rgba(220,230,240,0.55)', align: 'right' });
  },

  drawToasts(c) {
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[this.toasts.length - 1 - i];
      const a = clamp(t.t, 0, 1);
      const y = H - 16 - i * 12;
      c.globalAlpha = a;
      const w = textWidth(c, t.msg, 7) + 10;
      rrect(c, W / 2 - w / 2, y - 2, w, 11, 'rgba(8,14,22,0.85)', 'rgba(90,140,160,0.5)');
      text(c, t.msg, W / 2, y, { size: 7, color: '#e8f2f8', align: 'center' });
      c.globalAlpha = 1;
    }
  },

  drawHelp(c) {
    c.fillStyle = 'rgba(4,8,14,0.82)';
    c.fillRect(0, 0, W, H);
    rrect(c, 60, 24, W - 120, H - 48, '#101a24', '#3c505e');
    text(c, "OTTO'S FIELD GUIDE", W / 2, 34, { size: 11, color: '#ffe6b0', align: 'center' });
    const lines = [
      ['ON THE SURFACE', '#5ad2f0'],
      ['  A/D or arrows ... walk        E ... interact', '#c8d4dc'],
      ['  Sell shells on the laptop; a drone pays on pickup.', '#c8d4dc'],
      ['  Sleep in bed: heal up, clams regrow, day advances.', '#c8d4dc'],
      ['UNDER THE SEA', '#5ad2f0'],
      ['  Hold LEFT MOUSE ... scrape    W/S or wheel ... swim', '#c8d4dc'],
      ['  Q ... surface   Watch the O2 bar!', '#c8d4dc'],
      ['  Purple urchins sting -- don\'t scrape them barehanded.', '#c8d4dc'],
      ['  A red "!" means a barracuda -- move your paw away!', '#c8d4dc'],
      ['  If the water goes quiet... DON\'T. MOVE.', '#e8434c'],
      ['', '#fff'],
      ['  M ... mute      H ... close this guide', '#7a94a4'],
    ];
    let y = 52;
    for (const [ln, col] of lines) {
      text(c, ln, 74, y, { size: 7, color: col });
      y += 13;
    }
  },

  drawCursor(c) {
    const m = Input.mouse;
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
    // dusk sky
    let g = c.createLinearGradient(0, 0, 0, 150);
    g.addColorStop(0, '#2c2148');
    g.addColorStop(1, '#e88a4e');
    c.fillStyle = g; c.fillRect(0, 0, W, 150);
    c.fillStyle = '#f5d9a0';
    c.beginPath(); c.arc(W / 2, 130, 26, 0, TAU); c.fill();
    // sea
    g = c.createLinearGradient(0, 150, 0, H);
    g.addColorStop(0, '#3a5a72');
    g.addColorStop(1, '#0e2334');
    c.fillStyle = g; c.fillRect(0, 150, W, H - 150);
    for (let row = 0; row < 8; row++) {
      const y = 156 + row * 13;
      c.fillStyle = `rgba(255,220,170,${0.14 - row * 0.012})`;
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
    // otter on a buoy
    const bob = Math.sin(this.time * 1.5) * 3;
    c.fillStyle = '#c8352a';
    c.beginPath(); c.arc(W / 2, 208 + bob, 13, 0, TAU); c.fill();
    c.fillStyle = '#f2ede2';
    c.fillRect(W / 2 - 12, 203 + bob, 24, 4);
    c.drawImage(SPR.otterR[0], W / 2 - 8, 182 + bob);
    // title
    const wob = Math.sin(this.time * 2) * 2;
    text(c, "MR. OTTO'S", W / 2, 44 + wob, { size: 26, color: '#ffe6b0', align: 'center' });
    text(c, 'CLAM FARM', W / 2, 74 - wob, { size: 30, color: '#5ad2f0', align: 'center' });
    text(c, 'a cozy clam-scraping sim ... mostly cozy', W / 2, 112, { size: 8, color: '#e8c8a0', align: 'center' });
    // prompt
    if (Math.sin(this.time * 4) > -0.3) {
      const label = Game.hasSave() ? 'Press ENTER to continue' : 'Press ENTER to start';
      text(c, label, W / 2, 236, { size: 10, color: '#fff', align: 'center' });
    }
    if (Game.hasSave())
      text(c, '[N] new game', W / 2, 252, { size: 7, color: '#9aacb8', align: 'center' });
    text(c, '[M] mute', 8, H - 12, { size: 6, color: '#8a94a0' });
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

  // global keys
  if (Input.p('KeyM')) {
    const muted = SND.toggleMute();
    Game.toast(muted ? 'Sound muted.' : 'Sound on.');
  }
  if (G && Game.scene !== TitleScene && !Shop.open && Input.p('KeyH'))
    Game.helpOpen = !Game.helpOpen;

  // updates
  if (Game.fadeDir === 0) {
    if (Game.helpOpen) {
      if (Input.p('Escape')) Game.helpOpen = false;
    } else if (Shop.open) {
      Shop.update(dt);
    } else if (Game.scene) {
      Game.scene.update(dt);
    }
  }
  if (G && Game.scene !== TitleScene) Game.globalUpdate(dt);
  Game.updateFade(dt);
  SND.update(G ? G.musicOn : true);

  // draw
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (Game.scene) Game.scene.draw(ctx);
  if (Shop.open) Shop.draw(ctx);
  if (G && Game.scene !== TitleScene) Game.drawHUD(ctx);
  Game.drawToasts(ctx);
  if (Game.helpOpen) Game.drawHelp(ctx);
  if (Game.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(Game.fade, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
  }
  Game.drawCursor(ctx);

  Input.endFrame();
  requestAnimationFrame(frame);
}

resize();
Game.scene = TitleScene;
TitleScene.enter();
requestAnimationFrame(frame);
