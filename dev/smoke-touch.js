// Headless touch-control test for Mr. Otto's Clam Farm.
//
// Drives the game with synthetic TouchEvents on a phone-sized viewport: taps to
// switch into touch mode, holds a finger to scrape crust, times a lift to pry,
// and holds the up button to swim all the way back to the surface.
//
// Usage:
//   CHROMIUM=/path/to/chromium node dev/smoke-touch.js

// either package works — whichever is installed
const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* try the next one */ }
  }
  throw new Error('install playwright-core (or playwright) to run the touch test');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const errors = [];
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const p = await b.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(GAME_URL);
  await p.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const cv = document.getElementById('game');
    window.touchAt = (id, type, lx, ly) => {
      const r = cv.getBoundingClientRect();
      const t = new Touch({ identifier: id, target: cv, clientX: r.left + lx * r.width / 480, clientY: r.top + ly * r.height / 270 });
      cv.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
  });
  await p.evaluate(() => { touchAt(1, 'touchstart', 5, 260); touchAt(1, 'touchend', 5, 260); });
  await p.waitForTimeout(1400);
  console.log('touch mode =', await p.evaluate(() => TouchUI.enabled), '| dive buttons =', await p.evaluate(() => { Game.go(DiveScene, 0); return true; }));
  await p.waitForTimeout(1300);
  console.log('buttons in dive =', await p.evaluate(() => JSON.stringify(TouchUI.buttons.map(x => x.icon))));

  // touch-scrape a crusted node: hold finger on it
  const node = await p.evaluate(() => {
    const n = DiveScene.nodes.find(n2 => n2.alive && !n2.decor && n2.stage === 'crusted' && n2.y - DiveScene.camY > 50 && n2.y - DiveScene.camY < 210);
    return n ? { x: n.x, y: n.y } : null;
  });
  if (node) {
    const hp0 = await p.evaluate((nd) => DiveScene.nodes.find(n => n.x === nd.x && n.y === nd.y).hp, node);
    const sy = await p.evaluate((nd) => nd.y - DiveScene.camY, node);
    await p.evaluate(({ nd, sy2 }) => touchAt(3, 'touchstart', nd.x, sy2), { nd: node, sy2: sy });
    await p.waitForTimeout(1000);
    await p.evaluate(({ nd, sy2 }) => touchAt(3, 'touchend', nd.x, sy2), { nd: node, sy2: sy });
    const hp1 = await p.evaluate((nd) => { const n = DiveScene.nodes.find(n2 => n2.x === nd.x && n2.y === nd.y); return n ? n.hp : -99; }, node);
    console.log(`touch-scrape: hp ${hp0} -> ${hp1} (${hp1 < hp0 ? 'OK' : 'FAIL'})`);
    // scrape to exposed, then touch-pry with timed lift
    for (let i = 0; i < 25; i++) {
      const st = await p.evaluate((nd) => (DiveScene.nodes.find(n => n.x === nd.x && n.y === nd.y) || {}).stage, node);
      if (st !== 'crusted') break;
      const sy2 = await p.evaluate((nd) => nd.y - DiveScene.camY, node);
      await p.evaluate(({ nd, s }) => touchAt(4, 'touchstart', nd.x, s), { nd: node, s: sy2 });
      await p.waitForTimeout(380);
      await p.evaluate(({ nd, s }) => touchAt(4, 'touchend', nd.x, s), { nd: node, s: sy2 });
    }
    const stage = await p.evaluate((nd) => (DiveScene.nodes.find(n => n.x === nd.x && n.y === nd.y) || {}).stage, node);
    console.log('stage =', stage);
    let popped = false;
    for (let a = 0; a < 5 && !popped; a++) {
      const st = await p.evaluate((nd) => {
        const n = DiveScene.nodes.find(n2 => n2.x === nd.x && n2.y === nd.y);
        return n && n.alive ? { sy: n.y - DiveScene.camY, clamp: n.clampT } : null;
      }, node);
      if (!st) { popped = true; break; }
      if (st.clamp > 0) { await p.waitForTimeout(800); continue; }
      await p.evaluate(({ nd, s }) => touchAt(5, 'touchstart', nd.x, s), { nd: node, s: st.sy });
      await p.waitForTimeout(300);
      const deadline = Date.now() + 2100;
      while (Date.now() < deadline) {
        const m = await p.evaluate(() => DiveScene.pry ? { m: Math.abs(DiveScene.pry.marker), w: DiveScene.pry.win } : null);
        if (!m) break;
        if (m.m < m.w * 0.55) break;
        await p.waitForTimeout(16);
      }
      await p.evaluate(({ nd, s }) => touchAt(5, 'touchend', nd.x, s), { nd: node, s: st.sy });
      await p.waitForTimeout(350);
      popped = await p.evaluate((nd) => !DiveScene.nodes.find(n => n.alive && n.x === nd.x && n.y === nd.y), node);
    }
    console.log(`touch-pry: ${popped ? 'POPPED (OK)' : 'FAIL'}`);
  } else console.log('no crusted node visible: FAIL');

  // swim up via held button all the way to the surface
  const up = await p.evaluate(() => TouchUI.buttons.find(b2 => b2.icon === 'up'));
  await p.evaluate((btn) => touchAt(6, 'touchstart', btn.x + btn.w / 2, btn.y + btn.h / 2), up);
  await p.waitForFunction(() => Game.scene === WorldScene, null, { timeout: 25000 });
  await p.evaluate((btn) => touchAt(6, 'touchend', btn.x + btn.w / 2, btn.y + btn.h / 2), up);
  console.log('touch swim-up surface: OK');
  console.log(errors.length ? 'ERRORS:\n ' + errors.join('\n ') : 'no page errors');
  await b.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); errors.forEach(x => console.log(' ', x)); process.exit(1); });
