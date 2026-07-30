// Headless probe: ClamNet is SELL AND VALUABLES ONLY.
//
// Asserts: the shop's GEAR tab has no purchasable rows left (every row is a
// read-only craft pointer), the SELL flow still pays through the drone, the
// BUILD tab still sells construction, and the gear that used to be bought is
// now crafted -- Inv.craft('g_bag2') bumps G.gear.bag, higher tiers are gated
// by skill nodes AND by tier order, and cannonball crafting is untouched.
//
// Usage: CHROMIUM=/path/to/chromium node dev/smoke-net.js
// (CHROMIUM defaults to /opt/pw-browsers/chromium)

const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* try the next one */ }
  }
  throw new Error('install playwright-core (or playwright) to run this probe');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const errors = [];
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + msg); };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(GAME_URL);
  // the smoke.js boot contract: loader done, then the boot fade done
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.waitForTimeout(500);

  // ---- 1. GEAR tab: nothing purchasable ------------------------------------
  const gear = await page.evaluate(() => {
    Shop.openUI();
    Shop.tab = 2;
    const rows = Shop.buildRows();
    const bad = rows.filter(r => r.act || r.price !== undefined || r.btn);
    return { n: rows.length, bad: bad.map(r => r.label || r.info) };
  });
  ok(gear.n > 0, `GEAR tab still exists as a pointer (${gear.n} rows)`);
  ok(gear.bad.length === 0, 'no purchasable gear rows remain (act/price/btn all absent)' +
    (gear.bad.length ? ' -- offenders: ' + JSON.stringify(gear.bad) : ''));

  // ---- 2. BUILD tab still sells construction -------------------------------
  const build = await page.evaluate(() => {
    Shop.tab = 3;
    return Shop.buildRows().filter(r => r.act).map(r => r.label);
  });
  ok(build.length > 0, 'BUILD tab still purchasable: ' + JSON.stringify(build));

  // ---- 3. SELL flow still pays ----------------------------------------------
  const paid = await page.evaluate(() => {
    G.storage.clam = (G.storage.clam || 0) + 3;
    const before = G.money;
    Shop.tab = 0;
    Shop.sellKeys(['clam']);
    Shop.close();
    return { before, crate: G.pendingCrate ? G.pendingCrate.value : 0 };
  });
  ok(paid.crate > 0, `sell placed a drone order worth $${paid.crate}`);
  await page.waitForFunction(() => !G.pendingCrate, null, { timeout: 25000 });
  const after = await page.evaluate(() => G.money);
  ok(after - paid.before === paid.crate, `drone paid: $${after - paid.before} (expected $${paid.crate})`);

  // ---- 4. every ex-shop gear item is a registered recipe ---------------------
  const reg = await page.evaluate(() => {
    const keys = ['g_bag2', 'g_bag3', 'g_suit2', 'g_suit3', 'g_scraper2', 'g_scraper3',
      'g_pry2', 'g_pry3', 'g_tank2', 'g_tank3'];
    return keys.filter(k => !Inv.recipe(k));
  });
  ok(reg.length === 0, 'all 10 gear recipes registered' + (reg.length ? ' -- missing: ' + reg.join(',') : ''));

  // ---- 5. node gate holds before the node is learned ------------------------
  const tankWhy = await page.evaluate(() => Inv.missing('g_tank2'));
  ok(tankWhy === 'learn deep lungs to unlock', `Air Tank I locked behind its node ("${tankWhy}")`);

  // ---- 6. tier order holds even with the node learned -----------------------
  const orderWhy = await page.evaluate(() => {
    Skills.ensure();
    G.skills.clamming.pts = 5;                   // debug: bank points, buy the chain
    Skills.buy('c_lung');
    Skills.buy('c_sack');
    // materials for BOTH bag tiers, via the storage debug path
    Inv.add('rope', 12); Inv.add('driftwood', 8); Inv.add('plank', 4); Inv.add('nail', 6);
    return Inv.missing('g_bag3');
  });
  ok(orderWhy === 'craft the mesh bag first', `Big Net Sack refuses to skip tier 1 ("${orderWhy}")`);

  // ---- 7. craft the Mesh Bag through Inv.craft, goal satisfied ---------------
  const bag1 = await page.evaluate(() => {
    const before = G.gear.bag;
    const started = Inv.craft('g_bag2');
    // debug fast-forward: the job is real, just don't wait 10 wall-clock seconds
    for (const j of G.inv.jobs) j.t = j.dur;
    return { before, started };
  });
  ok(bag1.started, 'Inv.craft(g_bag2) accepted');
  await page.waitForFunction(() => G.gear.bag >= 1, null, { timeout: 8000 });
  const goal = await page.evaluate(() => ({ bag: G.gear.bag, done: GOAL_DONE[3](G), name: GOALS[3].name }));
  ok(goal.bag === 1 && bag1.before === 0, `G.gear.bag 0 -> ${goal.bag}`);
  ok(goal.done, `goal "${goal.name}" predicate satisfied by crafting`);

  // ---- 8. tier 2 now craftable, applies the same upgrade ----------------------
  const bag2 = await page.evaluate(() => {
    const started = Inv.craft('g_bag3');
    for (const j of G.inv.jobs) j.t = j.dur;
    return started;
  });
  ok(bag2, 'Inv.craft(g_bag3) accepted after tier 1');
  await page.waitForFunction(() => G.gear.bag >= 2, null, { timeout: 8000 });
  ok(await page.evaluate(() => G.gear.bag === 2), 'G.gear.bag reached 2 (Big Net Sack)');
  ok(await page.evaluate(() => Inv.missing('g_bag3') === 'otto already has one'),
    'tier 2 reports owned once crafted');

  // ---- 9. cannonball crafting untouched --------------------------------------
  const ball = await page.evaluate(() => {
    const r = Inv.recipe('a_ball');
    return r ? { out: r.out.key, node: Forge.RECIPE_NODE.a_ball } : null;
  });
  ok(!!ball && ball.out === 'cannonball' && ball.node === 'f_pow', 'a_ball recipe unchanged (Battle ammo)');

  console.log('---');
  if (errors.length) { console.log('JS ERRORS:'); errors.forEach(e => console.log(' ', e)); }
  if (fails.length) { console.log('FAILS:'); fails.forEach(f => console.log(' ', f)); }
  if (!errors.length && !fails.length) console.log('SMOKE-NET PASSED: the net sells, it does not stock tools');
  await browser.close();
  if (errors.length || fails.length) process.exit(1);
})().catch(e => { console.error('TEST CRASHED:', e.message); errors.forEach(x => console.log(' ', x)); fails.forEach(x => console.log(' ', x)); process.exit(1); });
