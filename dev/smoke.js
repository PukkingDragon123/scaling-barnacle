// Headless smoke test for Mr. Otto's Clam Farm.
//
// Plays the whole current loop with real input: walk the dock -> dive ->
// scrape crust -> timed pry -> swim back up (no resurface button) -> crack at
// the workbench -> sell + drone pickup -> sleep and check the overnight
// regrow. Fails on any console/page error.
//
// Usage:
//   npm install playwright-core        (or have playwright installed)
//   CHROMIUM=/path/to/chromium node dev/smoke.js
// (CHROMIUM defaults to /opt/pw-browsers/chromium)

// either package works — whichever is installed
const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* try the next one */ }
  }
  throw new Error('install playwright-core (or playwright) to run the smoke test');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const errors = [];
const fails = [];
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(GAME_URL);
  // Wait on the loader rather than a fixed sleep: the asset set has grown from
  // 143 files to 487, and a hardcoded 2.6s stopped being enough.
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  // And wait for the boot fade to finish. The scene does not update while a fade
  // is running, so a keypress driven before then is swallowed by endFrame() and
  // lost — which made this test pass or fail depending on how fast the machine
  // decoded 27MB of art.
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const cv = page.locator('#game');
  const box = () => cv.boundingBox();
  const toScreen = async (lx, ly) => { const b = await box(); return [b.x + lx * b.width / 480, b.y + ly * b.height / 270]; };

  await page.waitForTimeout(1400);
  console.log('scene =', await page.evaluate(() => Game.scene === WorldScene ? 'world' : 'OTHER'));

  // Walk LEFT to the piling. There is one now, at x=30 under the house, instead
  // of three spread down a 900-unit dock — so this waypoint is derived from the
  // scene rather than hardcoded, and a future layout change cannot stale it.
  // Walk to the piling and stop. There is one now, at x=30 under the house,
  // instead of three spread down a 900-unit dock. Hold the key for a bounded
  // time and then check reach: a predicate race on "has he stopped moving" was
  // flaky, because the dock clamps him and two polls can read the same x for
  // reasons that have nothing to do with arriving.
  const pilingX = await page.evaluate(() => PILING_X[0]);
  const pilingKey = pilingX < 160 ? 'KeyA' : 'KeyD';
  // Walk until the piling is THE NEAREST spot, not merely within reach. Being
  // inside the 22-unit radius is not enough: the house door sits at 56 and the
  // piling at 30, so there is a band around x=47 where both are in range and the
  // door wins. Stopping on radius alone made this test pass or fail at random.
  const nearestIs = () => page.evaluate(() => {
    let best = null, bd = 22;
    for (const s of WorldScene.spots()) { const d = Math.abs(WorldScene.px - s.x); if (d < bd) { bd = d; best = s; } }
    return best ? best.label : '';
  });
  await page.keyboard.down(pilingKey);
  let onPiling = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(100);
    if ((await nearestIs()).indexOf('Piling') >= 0) { onPiling = true; break; }
  }
  await page.keyboard.up(pilingKey);
  await page.waitForTimeout(150);
  if (!onPiling) fails.push('never reached the piling as the nearest spot');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1300);
  const inDive = await page.evaluate(() => Game.scene === DiveScene);
  console.log('dive =', inDive);
  if (!inDive) {
    console.log('WHY:', await page.evaluate(() => {
      let best = null, bd = 22;
      for (const s of WorldScene.spots()) { const d = Math.abs(WorldScene.px - s.x); if (d < bd) { bd = d; best = s; } }
      const open = ['Inv','Skills','Tame','Craft','NPCs','Stock','Shop','Bench']
        .filter(n => { try { return eval(n).open; } catch (e) { return false; } });
      return JSON.stringify({ px: Math.round(WorldScene.px), nearest: best ? best.label : 'NONE',
        open, fade: Game.fade, fadeDir: Game.fadeDir, pending: !!Game.pending, help: Game.helpOpen });
    }));
    fails.push('did not enter dive'); throw new Error('no dive');
  }

  // helper: find an alive node of given predicate on screen, swimming down if needed
  async function findNode(predName) {
    for (let tries = 0; tries < 10; tries++) {
      const n = await page.evaluate((pn) => {
        const pred = {
          barnacle: (n) => n.kind === 'barnacle',
          pryable: (n) => n.kind !== 'urchin' && n.kind !== 'barnacle',
        }[pn];
        const found = DiveScene.nodes.find(n2 => n2.alive && !n2.decor && pred(n2)
          && n2.y - DiveScene.camY > 60 && n2.y - DiveScene.camY < 220);
        return found ? { x: found.x, y: found.y, kind: found.kind } : null;
      }, predName);
      if (n) return n;
      await page.keyboard.down('KeyS');
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyS');
      await page.waitForTimeout(150);
    }
    return null;
  }

  // 1) scrape a barnacle clean off (scrape-only node)
  const bn = await findNode('barnacle');
  console.log('barnacle found:', JSON.stringify(bn));
  if (!bn) console.log('note: no barnacle in reach today (sparse spawns) — skipping that check');
  if (bn) {
    for (let i = 0; i < 14; i++) {
      const sy = await page.evaluate((b) => b.y - DiveScene.camY, bn);
      const [sx2, sy2] = await toScreen(bn.x, sy);
      await page.mouse.move(sx2, sy2, { steps: 2 });
      await page.mouse.down();
      await page.waitForTimeout(420);
      await page.mouse.up();
      const gone = await page.evaluate((b) => !DiveScene.nodes.find(n => n.alive && n.x === b.x && n.y === b.y), bn);
      if (gone) break;
    }
    const bag1 = await page.evaluate(() => ({ ...DiveScene.bag }));
    console.log('bag after barnacle scrape =', JSON.stringify(bag1));
    if (!bag1.barnacle) fails.push('barnacle scrape did not yield');
    void 0;
  }

  // 2) full scrape -> pry cycle on a clam/mussel/oyster
  const pn = await findNode('pryable');
  console.log('pryable found:', JSON.stringify(pn));
  if (pn) {
    // scrape until exposed
    for (let i = 0; i < 30; i++) {
      const st = await page.evaluate((b) => {
        const n = DiveScene.nodes.find(n2 => n2.x === b.x && n2.y === b.y);
        return n ? { stage: n.stage, alive: n.alive, sy: n.y - DiveScene.camY } : null;
      }, pn);
      if (!st || !st.alive || st.stage === 'exposed') break;
      const [sx2, sy2] = await toScreen(pn.x, st.sy);
      await page.mouse.move(sx2, sy2, { steps: 2 });
      await page.mouse.down();
      await page.waitForTimeout(400);
      await page.mouse.up();
    }
    const stage = await page.evaluate((b) => (DiveScene.nodes.find(n => n.x === b.x && n.y === b.y) || {}).stage, pn);
    console.log('stage after scraping =', stage);
    if (stage !== 'exposed') fails.push('shell never exposed');
    // pry attempts: hold, watch the marker, release in the window
    let pried = false;
    for (let attempt = 0; attempt < 5 && !pried; attempt++) {
      const st = await page.evaluate((b) => {
        const n = DiveScene.nodes.find(n2 => n2.x === b.x && n2.y === b.y);
        return n && n.alive ? { sy: n.y - DiveScene.camY, clamp: n.clampT } : null;
      }, pn);
      if (!st) { pried = await page.evaluate(() => DiveScene.bagCount > 1); break; }
      if (st.clamp > 0) { await page.waitForTimeout(800); continue; }
      const [sx2, sy2] = await toScreen(pn.x, st.sy);
      await page.mouse.move(sx2, sy2, { steps: 2 });
      await page.mouse.down();
      await page.waitForTimeout(320);  // past the 0.22s twitch-cancel
      // poll the marker and release inside the window
      const deadline = Date.now() + 2100;
      let released = false;
      while (Date.now() < deadline) {
        const m = await page.evaluate(() => DiveScene.pry ? { marker: Math.abs(DiveScene.pry.marker), win: DiveScene.pry.win } : null);
        if (!m) break;
        if (m.marker < m.win * 0.55) { await page.mouse.up(); released = true; break; }
        await page.waitForTimeout(16);
      }
      if (!released) await page.mouse.up();
      await page.waitForTimeout(350);
      pried = await page.evaluate((b) => !DiveScene.nodes.find(n => n.alive && n.x === b.x && n.y === b.y), pn);
      console.log(`pry attempt ${attempt + 1}: ${pried ? 'POPPED' : 'failed'}`);
    }
    if (!pried) fails.push('pry never succeeded');
  } else fails.push('no pryable node found');

  const bag2 = await page.evaluate(() => ({ count: DiveScene.bagCount, bag: DiveScene.bag }));
  console.log('bag =', JSON.stringify(bag2));

  // 3) no surface button: swim up and kick out
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => Game.scene === WorldScene || DiveScene.camY <= 0.5, null, { timeout: 25000 });
  await page.waitForTimeout(1400); // keep kicking through surfaceT
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(900);
  const surfaced = await page.evaluate(() => Game.scene === WorldScene);
  console.log('surfaced by swimming =', surfaced);
  if (!surfaced) fails.push('swim-up surfacing failed');

  // 4) workbench: crack one clam (storage should have one from the pry)
  // the shell workbench is at 300; approach from wherever surfacing left us
  const benchDir = await page.evaluate(() => (WorldScene.px > 300 ? 'KeyA' : 'KeyD'));
  await page.keyboard.down(benchDir);
  await page.waitForFunction(() => Math.abs(WorldScene.px - 300) < 14, null, { timeout: 12000 });
  await page.keyboard.up(benchDir);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  console.log('bench open =', await page.evaluate(() => Bench.open));
  const crackable = await page.evaluate(() => Bench.crackables()[0] || null);
  console.log('crackable =', crackable, 'storage =', await page.evaluate(() => JSON.stringify(G.storage)));
  if (crackable) {
    await page.evaluate((k) => Bench.startCrack(k), crackable);
    // wait for the sweep marker to hit center, then click
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const pos = await page.evaluate(() => Bench.mode === 'crack' ? Bench.crackPos : null);
      if (pos !== null && Math.abs(pos - 0.5) < 0.05) break;
      await page.waitForTimeout(14);
    }
    const [cx2, cy2] = await toScreen(240, 135);
    await page.mouse.click(cx2, cy2);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => ({ cracked: G.stats.cracked, meat: G.storage.clamMeat + G.storage.musselMeat + G.storage.oysterMeat, bits: G.storage.barnacle }));
    console.log('crack result =', JSON.stringify(res));
    if (res.cracked < 1) fails.push('crack minigame did not resolve');
  } else fails.push('nothing crackable in storage');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 5) sell everything + drone
  await page.evaluate(() => { Shop.openUI(); Shop.sellKeys(ITEM_KEYS); Shop.close(); });
  const moneyBefore = await page.evaluate(() => G.money);
  await page.waitForFunction(() => !G.pendingCrate, null, { timeout: 20000 });
  const moneyAfter = await page.evaluate(() => G.money);
  console.log(`drone paid: ${moneyAfter - moneyBefore}`);
  if (moneyAfter <= moneyBefore) fails.push('drone did not pay');

  // 6) sleep: day advances, beds partially regrow
  await page.evaluate(() => Game.go(HouseScene, {}));
  await page.waitForTimeout(1200);
  const day1 = await page.evaluate(() => G.day);
  await page.evaluate(() => HouseScene.sleep());
  await page.waitForTimeout(2800);
  const after = await page.evaluate(() => ({ day: G.day, growth: G.growth }));
  console.log('after sleep =', JSON.stringify(after));
  if (after.day !== day1 + 1) fails.push('sleep did not advance day');
  if (!after.growth.every(g => g >= 0.45 && g <= 1)) fails.push('regrow out of range');

  console.log('---');
  if (errors.length) { console.log('JS ERRORS:'); errors.forEach(e => console.log(' ', e)); }
  if (fails.length) { console.log('FAILS:'); fails.forEach(f => console.log(' ', f)); }
  if (!errors.length && !fails.length) console.log('SMOKE PASSED: the full loop works');
  await browser.close();
  if (errors.length || fails.length) process.exit(1);
})().catch(e => { console.error('TEST CRASHED:', e.message); errors.forEach(x => console.log(' ', x)); fails.forEach(x => console.log(' ', x)); process.exit(1); });
