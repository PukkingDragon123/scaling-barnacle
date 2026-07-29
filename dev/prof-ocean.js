// Per-layer cost of the open-ocean frame, measured by ABLATION.
//
// Wrapping each drawer in performance.now() pairs was measured and is useless
// here: Canvas2D calls are queued, not executed, so the wrap times how long it
// takes to *record* the call. It reported 5 ms of work inside a 130 ms frame. The
// real cost is rasterisation, and the only honest way to attribute it from script
// is to turn a layer off and see what the frame gains.
//
// So: measure the raf-to-raf gap with everything on, then again with one layer
// stubbed out, and print the difference. Runs at three depths, because which
// layers exist changes with depth (the surface band draws foam, rays and caustics
// that the deep does not).
//
// Usage: CHROMIUM=/opt/pw-browsers/chromium node dev/prof-ocean.js
const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* next */ }
  }
  throw new Error('install playwright-core (or playwright)');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Ocean's own layers, plus the two full-screen passes main.js does over every
// frame (the 'overlay' colour grade and the vignette blit), which are priced per
// destination pixel on a 1920x1080 backing store and are prime suspects.
const LAYERS = ['_drawWater', '_drawFar', '_drawMid', '_drawHaze', '_drawSurfaceLine',
  '_drawRays', '_drawProps', '_drawMotes', '_drawBubbles', '_drawSpills', '_drawOtto',
  '_drawCaustics', '_drawRings', '_drawSurfaceFoam', '_drawDeepTint', '_drawHUD'];

const SAMPLE_MS = 2200;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => console.log('pageerror: ' + e.message));
  await page.goto(GAME_URL);
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.evaluate(() => { Game.go(Ocean); });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.__orig = {};
    window.__off = null;
    // Stubbing is a swap, not a delete, so a layer can be put back between samples.
    window.__stub = (name) => {
      if (window.__off) { Ocean[window.__off] = window.__orig[window.__off]; window.__off = null; }
      if (!name) return;
      if (typeof Ocean[name] !== 'function') return;
      if (!window.__orig[name]) window.__orig[name] = Ocean[name];
      Ocean[name] = function () {};
      window.__off = name;
    };
  });

  // Ablating the frame loop's own two full-screen passes needs a flag main.js
  // reads, which it does not have — so they are measured by patching the context
  // methods they use instead: a no-op fillRect at exactly full-screen size, and a
  // no-op drawImage of the vignette canvas.
  await page.evaluate(() => {
    const c = document.getElementById('game').getContext('2d');
    window.__gradeOff = false;
    const fr = c.fillRect.bind(c);
    c.fillRect = function (x, y, w, h) {
      if (window.__gradeOff && x === 0 && y === 0 && w === W && h === H &&
          c.globalCompositeOperation === 'overlay') return;
      return fr(x, y, w, h);
    };
    window.__vigOff = false;
    const di = c.drawImage.bind(c);
    c.drawImage = function (img) {
      if (window.__vigOff && arguments.length === 5 && arguments[3] === W && arguments[4] === H &&
          img && img.__isVignette) return;
      return di.apply(c, arguments);
    };
    if (typeof vignette === 'function') { try { vignette().__isVignette = true; } catch (e) {} }
  });

  const gap = async (y, quality, stub, gradeOff, vigOff) => {
    await page.evaluate((a) => {
      Ocean.py = a.y; Ocean.camY = Ocean.py - H * 0.42; Ocean.quality = a.q;
      window.__stub(a.stub);
      window.__gradeOff = !!a.gradeOff;
      window.__vigOff = !!a.vigOff;
      // The adaptive-quality watchdog and the swim both fight the pinned depth.
      window.__pin = setInterval(() => { Ocean.py = a.y; Ocean.vy = 0; Ocean.quality = a.q; }, 8);
    }, { y, q: quality, stub, gradeOff, vigOff });
    const r = await page.evaluate((ms) => new Promise(res => {
      const t = [];
      let last = performance.now();
      const stop = last + ms;
      const tick = () => {
        const now = performance.now();
        t.push(now - last); last = now;
        if (now < stop) requestAnimationFrame(tick);
        else { t.sort((a, b) => a - b); res(t[Math.floor(t.length / 2)]); }
      };
      requestAnimationFrame(tick);
    }), SAMPLE_MS);
    await page.evaluate(() => { clearInterval(window.__pin); window.__stub(null); window.__gradeOff = false; window.__vigOff = false; });
    return r;
  };

  const run = async (label, y, quality) => {
    const base = await gap(y, quality, null, false, false);
    console.log('\n== ' + label + '  y=' + y + ' quality=' + quality +
                '  baseline median frame = ' + base.toFixed(1) + ' ms  (' + (1000 / base).toFixed(0) + ' fps)');
    const rows = [];
    for (const n of LAYERS) {
      const m = await gap(y, quality, n, false, false);
      rows.push([n, base - m]);
    }
    rows.push(["main.js 'overlay' grade", base - await gap(y, quality, null, true, false)]);
    rows.push(['main.js vignette blit', base - await gap(y, quality, null, false, true)]);
    rows.sort((a, b) => b[1] - a[1]);
    for (const [n, d] of rows) {
      if (d < 0.6) continue;
      console.log('   ' + d.toFixed(1).padStart(6) + ' ms  ' + n);
    }
  };

  await run('surface band', 40, 1);
  await run('mid water', 700, 1);
  await run('the 1400 band', 1400, 1);
  await run('deep', 2200, 1);

  await browser.close();
})();
