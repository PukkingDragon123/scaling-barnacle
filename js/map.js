// ---- map: the sea chart ---------------------------------------------------------
//
// [M] opens a side-view cross-section of the whole coast, because the game IS a
// side-scroller: depth down, coastline across, exactly the shape of the space the
// player actually moves through. A top-down map of a 2D sea would be a lie.
//
// The chart teaches three things at a glance: where you are, how deep the world
// gets (the zones and the trench), and where the neighbours live -- but only the
// homes you have actually FOUND are named. The rest show as faint question marks
// at a deliberately rounded x, an invitation rather than a spoiler.
//
// The expensive part -- tracing Ocean.floorAt across ten thousand world units --
// is baked into an offscreen canvas once and re-baked only when the discovery
// state changes (the sig string). Per frame this draws one blit plus a handful of
// markers.
'use strict';

const MapChart = {
  open: false,
  _installed: false,
  _base: null, _sig: '',
  time: 0,

  // chart geometry: world window and panel box, shared by the bake and the markers
  WX0: -2800, WX1: 7400,
  DEEP: 3400,
  PX: 10, PY: 22, PW: 460, PH: 226,     // the panel
  SURF: 64,                             // chart y of the water line

  cx(wx) { return this.PX + 8 + (wx - this.WX0) / (this.WX1 - this.WX0) * (this.PW - 16); },
  cy(wy) { return this.SURF + Math.max(0, wy) / this.DEEP * (this.PY + this.PH - 14 - this.SURF); },

  // ==== opening ==============================================================
  _peerOpen() {
    if (typeof Shop !== 'undefined' && Shop.open) return true;
    if (typeof Bench !== 'undefined' && Bench.open) return true;
    if (typeof Game !== 'undefined' && Game.helpOpen) return true;
    if (typeof Craft !== 'undefined' && Craft.open) return true;
    if (typeof NPCs !== 'undefined' && NPCs.open) return true;
    if (typeof Stock !== 'undefined' && Stock.open) return true;
    if (typeof Farm !== 'undefined' && Farm.open) return true;
    if (typeof Inv !== 'undefined' && Inv.open) return true;
    if (typeof Skills !== 'undefined' && Skills.open) return true;
    if (typeof Tame !== 'undefined' && Tame.open) return true;
    if (typeof Forge !== 'undefined' && (Forge.open || Forge.placing)) return true;
    if (typeof Battle !== 'undefined' && Battle.active) return true;
    return false;
  },

  update(dt) {
    this.time += dt;
    if (typeof G === 'undefined' || !G || Game.scene === TitleScene) return;

    if (!this.open) {
      if (Game.fadeDir === 0 && !this._peerOpen() && Input.p('KeyM')) {
        this.open = true;
        if (typeof SND !== 'undefined') SND.click();
      }
      return;
    }
    // while open: a peer stealing the screen dismisses us, and the scene verbs
    // are eaten so the world under the chart holds still (craftgate's idiom)
    if (Game.fadeDir !== 0 || this._peerOpen()) { this.open = false; return; }
    Input.p('KeyE'); Input.p('Space'); Input.p('Tab');
    Input.p('KeyI'); Input.p('KeyK'); Input.p('KeyT'); Input.p('KeyC');
    if (Input.p('Escape') || Input.p('KeyM')) {
      this.open = false;
      if (typeof SND !== 'undefined') SND.click();
    }
  },

  // ==== the baked chart ======================================================
  _seenSig() {
    let s = 'v1';
    if (typeof G !== 'undefined' && G && G.hood && G.hood.seen) {
      for (const k in G.hood.seen) if (G.hood.seen[k]) s += ':' + k;
    }
    return s;
  },

  _bake() {
    const sig = this._seenSig();
    if (this._base && this._sig === sig) return this._base;
    this._sig = sig;
    const q = DPX;
    const cv = this._base || document.createElement('canvas');
    // a fresh canvas is 300x150 by default -- NOT zero -- so size it by
    // comparison, never by truthiness
    if (cv.width !== W * q) { cv.width = W * q; cv.height = H * q; }
    const c = cv.getContext('2d');
    c.setTransform(q, 0, 0, q, 0, 0);
    c.clearRect(0, 0, W, H);

    // dimmed world behind, then the chart panel in the HUD's own materials
    c.fillStyle = 'rgba(6,10,20,0.72)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,26,40,0.94)';
    c.fillRect(this.PX, this.PY, this.PW, this.PH);
    c.strokeStyle = '#6a5030';
    c.lineWidth = PIX * 2;
    c.strokeRect(this.PX + PIX, this.PY + PIX, this.PW - PIX * 2, this.PH - PIX * 2);

    const x0 = this.PX + 4, x1 = this.PX + this.PW - 4;
    const yBot = this.PY + this.PH - 4;

    // water: five flat bands, surface to depth
    const bands = [[26, 62, 96], [20, 48, 80], [15, 36, 64], [11, 26, 50], [8, 18, 38]];
    for (let i = 0; i < bands.length; i++) {
      const by0 = this.SURF + (yBot - this.SURF) * (i / bands.length);
      const by1 = this.SURF + (yBot - this.SURF) * ((i + 1) / bands.length);
      c.fillStyle = cssRGB(bands[i]);
      c.fillRect(x0, by0, x1 - x0, by1 - by0 + 0.5);
    }
    // sky sliver above the line
    c.fillStyle = '#7ec4e2';
    c.fillRect(x0, this.PY + 16, x1 - x0, this.SURF - this.PY - 16);
    c.fillStyle = '#eaf9ff';
    c.fillRect(x0, this.SURF - 0.6, x1 - x0, 1.2);

    // ---- the seabed itself, off the real profile --------------------------------
    if (typeof Ocean !== 'undefined' && Ocean.floorAt) {
      c.fillStyle = '#8a7a58';
      c.beginPath();
      c.moveTo(x0, yBot);
      const step = 40;
      for (let wx = this.WX0; wx <= this.WX1; wx += step) {
        c.lineTo(clamp(this.cx(wx), x0, x1), Math.min(yBot, this.cy(Ocean.floorAt(wx))));
      }
      c.lineTo(x1, yBot);
      c.closePath();
      c.fill();
      // a brighter lip on the line, same trick the real sand uses
      c.strokeStyle = '#c9b98a';
      c.lineWidth = PIX * 2;
      c.beginPath();
      let first = true;
      for (let wx = this.WX0; wx <= this.WX1; wx += step) {
        const px = clamp(this.cx(wx), x0, x1), py = Math.min(yBot, this.cy(Ocean.floorAt(wx)));
        if (first) { c.moveTo(px, py); first = false; } else c.lineTo(px, py);
      }
      c.stroke();

      // zone names along their spans, on the sand
      if (Ocean.ZONES) {
        for (const z of Ocean.ZONES) {
          const zx0 = Math.max(z.x0, this.WX0), zx1 = Math.min(z.x1, this.WX1);
          if (zx1 - zx0 < 900) continue;
          const mid = (zx0 + zx1) / 2;
          const ty = Math.min(yBot - 6, this.cy(Ocean.floorAt(mid)) + 10);
          text(c, z.name.toUpperCase(), this.cx(mid), ty, { size: 5, color: 'rgba(240,228,190,0.5)', align: 'center', shadow: false });
        }
      }
    }

    // depth ticks down the left edge, in the dive HUD's metres
    const pxm = (typeof Ocean !== 'undefined' && Ocean.PX_PER_M) ? Ocean.PX_PER_M : 12;
    for (let m = 50; m * pxm < this.DEEP; m += 50) {
      const ty = this.cy(m * pxm);
      c.fillStyle = 'rgba(240,228,190,0.35)';
      c.fillRect(x0, ty, 5, 0.8);
      text(c, m + 'm', x0 + 7, ty - 2.4, { size: 5, color: 'rgba(240,228,190,0.45)', shadow: false });
    }

    // the dock: home. A little pier over the waterline at x=0.
    const dx = this.cx(0);
    c.fillStyle = '#c9a271';
    c.fillRect(dx - 7, this.SURF - 3, 14, 1.6);
    c.fillStyle = '#8a6434';
    c.fillRect(dx - 5, this.SURF - 1.6, 1.2, 3);
    c.fillRect(dx + 4, this.SURF - 1.6, 1.2, 3);
    c.fillStyle = '#e8d4a8';
    c.fillRect(dx - 2.4, this.SURF - 7.5, 5, 4.6);
    text(c, "OTTO'S DOCK", dx, this.SURF - 13, { size: 5, color: '#ffd66e', align: 'center', shadow: false });

    // title
    text(c, 'SEA CHART', this.PX + 8, this.PY + 5, { size: 8, color: '#f4e4c8', shadow: false });
    text(c, '[M] close', this.PX + this.PW - 8, this.PY + 6, { size: 6, color: '#a89478', align: 'right', shadow: false });

    this._base = cv;
    return cv;
  },

  // ==== per frame ============================================================
  draw(c) {
    const base = this._bake();
    const sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    c.drawImage(base, 0, 0, W, H);
    c.imageSmoothingEnabled = sm;
    const t = this.time;
    const x0 = this.PX + 4, x1 = this.PX + this.PW - 4;
    const yBot = this.PY + this.PH - 4;

    // the sea garden, when the farm publishes one
    if (typeof Farm !== 'undefined' && Farm.PLOT_DEF && Farm.PLOT_DEF.length && typeof Ocean !== 'undefined' && Ocean.floorAt) {
      let lo = 1e9, hi = -1e9;
      for (const p of Farm.PLOT_DEF) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
      const gx = this.cx((lo + hi) / 2);
      const gy = Math.min(yBot - 3, this.cy(Ocean.floorAt((lo + hi) / 2)));
      c.strokeStyle = '#7de08a';
      c.lineWidth = PIX * 2;
      c.beginPath();
      c.moveTo(gx, gy - 1); c.lineTo(gx, gy - 5);
      c.moveTo(gx, gy - 3.4); c.lineTo(gx - 2.2, gy - 5.4);
      c.moveTo(gx, gy - 3.4); c.lineTo(gx + 2.2, gy - 5.4);
      c.stroke();
      text(c, 'sea garden', gx, gy + 2, { size: 5, color: '#7de08a', align: 'center', shadow: false });
    }

    // the neighbours: found ones by name, unfound ones as a rounded-off rumour
    if (typeof Hood !== 'undefined' && Hood.HOMES) {
      const seen = (typeof G !== 'undefined' && G && G.hood && G.hood.seen) ? G.hood.seen : {};
      for (const hm of Hood.HOMES) {
        if (seen[hm.key]) {
          const hx = this.cx(hm.x);
          c.fillStyle = '#e8d4a8';
          c.fillRect(hx - 2.6, this.SURF - 6.4, 5.2, 4.4);
          c.fillStyle = '#c8352a';
          c.beginPath();
          c.moveTo(hx - 3.4, this.SURF - 6); c.lineTo(hx, this.SURF - 9.4); c.lineTo(hx + 3.4, this.SURF - 6);
          c.closePath(); c.fill();
          text(c, hm.name, hx, this.SURF - 15, { size: 5, color: '#f4e4c8', align: 'center', shadow: false });
        } else {
          // rounded to 400 so the chart hints at a direction, not an address
          const hx = this.cx(Math.round(hm.x / 400) * 400);
          c.globalAlpha = 0.4 + 0.2 * Math.sin(t * 2 + hm.x);
          text(c, '?', hx, this.SURF - 10, { size: 8, color: '#8a9aa8', align: 'center', shadow: false });
          c.globalAlpha = 1;
        }
      }
    }

    // Otto: a pulsing dot exactly where he is
    let ox = 0, oy = 0;
    if (typeof Ocean !== 'undefined' && Game.scene === Ocean) { ox = Ocean.px; oy = Ocean.py; }
    const mx = clamp(this.cx(ox), x0, x1);
    const my = clamp(this.cy(Math.max(0, oy)), this.SURF - 2, yBot);
    const pr = 2 + 0.7 * Math.sin(t * 5);
    c.strokeStyle = 'rgba(255,214,110,0.5)';
    c.lineWidth = PIX * 2;
    c.beginPath(); c.arc(mx, my, pr + 2.5, 0, TAU); c.stroke();
    c.fillStyle = '#ffd66e';
    c.beginPath(); c.arc(mx, my, pr, 0, TAU); c.fill();
    text(c, 'you', mx + 6, my - 3, { size: 5, color: '#ffd66e', shadow: false });
  },

  // ==== install ==============================================================
  install() {
    if (this._installed || typeof Game === 'undefined' || typeof TouchUI === 'undefined') return;
    this._installed = true;

    const gU = Game.globalUpdate.bind(Game);
    Game.globalUpdate = function (dt) { gU(dt); MapChart.update(dt); };

    const gH = Game.drawHUD.bind(Game);
    Game.drawHUD = function (c) {
      if (MapChart.open) { MapChart.draw(c); return; }
      gH(c);
    };

    const gGo = Game.go.bind(Game);
    Game.go = function (scene, arg) { MapChart.open = false; return gGo(scene, arg); };

    // touch: a close pad while the chart is up; an open pad while swimming
    const tL = TouchUI.layout.bind(TouchUI);
    TouchUI.layout = function () {
      if (MapChart.open) return [{ x: W - 52, y: 28, w: 40, h: 40, tap: 'Escape', icon: 'mapx' }];
      const b = tL();
      if (typeof Ocean !== 'undefined' && Game.scene === Ocean && !MapChart._peerOpen()) {
        b.push({ x: 8, y: H - 196, w: 40, h: 40, tap: 'KeyM', icon: 'mapo' });
      }
      return b;
    };
    const tD = TouchUI.draw.bind(TouchUI);
    TouchUI.draw = function (c) {
      tD(c);
      if (!this.enabled) return;
      for (let i = 0; i < this.buttons.length; i++) {
        const b = this.buttons[i];
        if (b.icon === 'mapx') {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          c.strokeStyle = 'rgba(255,106,122,0.9)';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(cx - 6, cy - 6); c.lineTo(cx + 6, cy + 6);
          c.moveTo(cx + 6, cy - 6); c.lineTo(cx - 6, cy + 6);
          c.stroke();
        } else if (b.icon === 'mapo') {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          c.strokeStyle = 'rgba(240,228,190,0.9)';
          c.lineWidth = 1.6;
          c.strokeRect(cx - 7, cy - 5, 14, 10);
          c.beginPath();
          c.moveTo(cx - 5, cy + 1);
          c.quadraticCurveTo(cx - 2, cy - 4, cx, cy);
          c.quadraticCurveTo(cx + 2, cy + 3, cx + 5, cy - 2);
          c.stroke();
        }
      }
    };
  },
};

if (typeof Game !== 'undefined' && typeof TouchUI !== 'undefined') MapChart.install();
else document.addEventListener('DOMContentLoaded', function () { MapChart.install(); }, { once: true });
