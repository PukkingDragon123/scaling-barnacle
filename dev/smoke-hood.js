// Boot + integration probe for js/hood.js (neighbour homes & resident AI) and
// js/craftgate.js (skill-gated recipes, craftable/placeable tables, body menu).
//
// This is not a gameplay run — dev/smoke.js does that. This asks the narrower
// questions that load order and wrap order actually decide:
//   * did both modules resolve and install at all
//   * did integrate.js see Hood (it resolves modules by eval AT PARSE TIME, so
//     a hood.js tag placed after it silently yields M.Hood === undefined and the
//     homes never draw)
//   * does the deck still have no two spots inside the 22-unit [E] radius
//   * does [C] open the body menu on the deck, and close again
//   * does the ocean run frames with three homes and three residents live
//
// Usage: CHROMIUM=/opt/pw-browsers/chromium node dev/smoke-hood.js
const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* next */ }
  }
  throw new Error('install playwright-core (or playwright) to run this');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const errors = [];
const fails = [];
const note = (m) => console.log('  ' + m);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(GAME_URL);
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.waitForTimeout(600);

  // ---- 1. both modules resolved and installed -------------------------------
  const boot = await page.evaluate(() => {
    const r = {};
    try { r.hood = !!Hood; r.hoodInstalled = !!Hood._installed; r.homes = (Hood.homes || Hood.HOMES || []).length; }
    catch (e) { r.hood = false; r.hoodErr = String(e); }
    try { r.forge = !!Forge; r.forgeInstalled = !!Forge._installed; r.hand = (Forge.HAND || []).length; }
    catch (e) { r.forge = false; r.forgeErr = String(e); }
    return r;
  });
  note('Hood  present=' + boot.hood + ' installed=' + boot.hoodInstalled + ' homes=' + boot.homes);
  note('Forge present=' + boot.forge + ' installed=' + boot.forgeInstalled + ' hand recipes=' + boot.hand);
  if (!boot.hood) fails.push('Hood did not resolve: ' + boot.hoodErr);
  if (!boot.forge) fails.push('Forge did not resolve: ' + boot.forgeErr);
  if (boot.hood && !boot.hoodInstalled) fails.push('Hood.install() never ran');
  if (boot.forge && !boot.forgeInstalled) fails.push('Forge.install() never ran');

  // ---- 2. integrate.js actually saw Hood ------------------------------------
  // Its module table is closed over inside an IIFE, so the observable proof is
  // that the wiring it owns is live: Hood.reset must have been called by
  // Ocean.enter, giving the residents a seeded day. A stale tag order shows up
  // here as "reset never ran".
  await page.evaluate(() => { if (typeof Hood !== 'undefined') Hood._probeReset = 0; });
  await page.evaluate(() => {
    if (typeof Hood === 'undefined' || !Hood.reset) return;
    const r = Hood.reset.bind(Hood);
    Hood.reset = function (s) { Hood._probeReset++; return r(s); };
  });

  // ---- 3. no two dock spots inside the [E] radius, AT ANY BRIDGE LEVEL -------
  // Farm beds and pens are gated on G.bridge, so a single-level check only ever
  // sees a third of the deck -- and the jump-in spot MOVES with endX(), which is
  // exactly what makes a later tier collide.
  const clash = await page.evaluate(() => {
    const keep = G.bridge;
    const out = [], seen = {};
    for (let b = 1; b <= 3; b++) {
      G.bridge = b;
      const s = WorldScene.spots();
      seen[b] = s.map(v => v.label.replace(/\s+/g, ' ').trim() + '@' + Math.round(v.x)).join('  ');
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) {
          if (Math.abs(s[i].x - s[j].x) < 22) {
            out.push('bridge ' + b + ': ' + s[i].label.trim() + ' @' + Math.round(s[i].x) +
                     '  vs  ' + s[j].label.trim() + ' @' + Math.round(s[j].x));
          }
        }
      }
    }
    G.bridge = keep;
    return { out, seen };
  });
  for (const b of [1, 2, 3]) note('bridge ' + b + ' deck: ' + clash.seen[b]);
  if (clash.out.length) fails.push('dock spot collisions:\n      ' + clash.out.join('\n      '));

  // ---- 4. the body menu opens on [C] and closes again ----------------------
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(350);
  let bodyOpen = await page.evaluate(() => typeof Forge !== 'undefined' && !!Forge.open);
  note('[C] body menu opened = ' + bodyOpen);
  if (!bodyOpen) fails.push('[C] did not open the body crafting menu on the deck');
  // While it is up, Tab and I must not open the peer panels underneath.
  await page.keyboard.press('Tab');
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(300);
  const peer = await page.evaluate(() => ({
    inv: typeof Inv !== 'undefined' && !!Inv.open,
    skills: typeof Skills !== 'undefined' && !!Skills.open,
    forge: typeof Forge !== 'undefined' && !!Forge.open,
  }));
  if (peer.inv || peer.skills) fails.push('a peer panel opened under the body menu: ' + JSON.stringify(peer));
  if (!peer.forge) fails.push('the body menu was dismissed by Tab/I instead of eating them');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => typeof Forge !== 'undefined' && !Forge.open);
  if (!closed) fails.push('Escape did not close the body menu');
  note('Escape closed it = ' + closed);

  // ---- 5. locked recipes really are locked --------------------------------
  const gate = await page.evaluate(() => {
    if (typeof Inv === 'undefined' || typeof Forge === 'undefined') return null;
    const all = (Inv.RECIPES || []).map(r => r.key);
    const open = all.filter(k => Forge.unlocked(k));
    const shut = all.filter(k => !Forge.unlocked(k));
    return { total: all.length, open, shutN: shut.length, sampleShut: shut.slice(0, 4) };
  });
  if (gate) {
    note('recipes: ' + gate.total + ' total, ' + gate.open.length + ' open at start (' +
         gate.open.join(', ') + '), ' + gate.shutN + ' skill-locked');
    if (!gate.open.length) fails.push('every recipe is locked at boot — nothing to start from');
    if (!gate.shutN) fails.push('no recipe is skill-locked — the gate is not doing anything');
  }

  // ---- 6. the tables are not free any more --------------------------------
  const sites = await page.evaluate(() => {
    if (typeof Inv === 'undefined') return null;
    const S = Inv.SITES || {};
    const free = Object.keys(S).filter(k => typeof S[k].x === 'number');
    return { sites: Object.keys(S).length, free, placed: (G.placed || []).length };
  });
  if (sites) {
    note('bench definitions = ' + sites.sites + ', still on the planks for free = ' +
         (sites.free.length ? sites.free.join(', ') : 'none') + ', placed tables = ' + sites.placed);
    if (sites.free.length) fails.push('Inv.SITES still puts ' + sites.free.join('/') + ' on the planks for free');
  }

  // ---- 7. the ocean runs with the homes in it ------------------------------
  await page.evaluate(() => { Game.go(Ocean); });
  await page.waitForTimeout(1800);
  const sea = await page.evaluate(() => {
    const r = { scene: Game.scene === Ocean ? 'ocean' : 'other', reset: Hood._probeReset };
    r.homes = (Hood.homes || []).map(h => ({ key: h.key, x: Math.round(h.x) }));
    r.folk = (Hood.agents || []).map(p => ({
      who: p.who, act: p.act, x: Math.round(p.x), y: Math.round(p.y), mood: p.mood,
    }));
    return r;
  });
  note('scene = ' + sea.scene + ', Hood.reset calls seen = ' + sea.reset);
  note('homes: ' + JSON.stringify(sea.homes));
  note('folk : ' + JSON.stringify(sea.folk));
  if (sea.scene !== 'ocean') fails.push('Ocean.enter() did not land in the ocean');
  if (!sea.homes.length) fails.push('no neighbour homes exist in the ocean');
  if (!sea.folk.length) fails.push('no residents exist');

  // 60 frames of real swimming past a home, to shake out draw-path exceptions
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowRight');
  // teleport to the nearest home and try the climb
  const climbed = await page.evaluate(() => {
    const h = Hood.HOMES[0];
    Ocean.px = h.x + h.climbDX;
    Ocean.py = (Hood.CLIMB_TOP + Hood.CLIMB_BOT) / 2;
    Ocean.camX = Ocean.px - W * 0.5; Ocean.camY = Ocean.py - H * 0.42;
    const reach = Hood.climbAt ? Hood.climbAt(Ocean.px, Ocean.py) : null;
    return { home: h.key, ladder: Math.round(Ocean.px), y: Ocean.py,
             reach: reach ? reach.key : null };
  });
  note('climb probe: ' + JSON.stringify(climbed));
  if (climbed && !climbed.reach) fails.push('standing at a home, Hood.climbAt() found nothing in reach');
  await page.waitForTimeout(400);
  const upstairs = await page.evaluate(() => {
    if (!Hood.climb) return null;
    Hood.climb(Hood.HOMES[0]);
    return true;
  });
  await page.waitForTimeout(1400);
  const deck = await page.evaluate(() => ({
    onDeck: Game.scene === Hood,
    home: Hood.home ? Hood.home.key : null,
    resident: Hood.home && Hood.home.who ? Hood.home.who : null,
  }));
  note('after climb: ' + JSON.stringify(deck));
  if (upstairs && !deck.onDeck) fails.push('Hood.climb() did not put us on the porch scene');
  // and back down into the water, with the bag intact
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({ scene: Game.scene === Ocean ? 'ocean' : (Game.scene === Hood ? 'hood' : 'other'), trips: G.ocean && G.ocean.trips }));
  note('after diving off: ' + JSON.stringify(back));
  if (back.scene !== 'ocean') fails.push('leaving a porch did not put us back in the water');

  // ---- 8. a frame-time sample on the ocean --------------------------------
  const ms = await page.evaluate(() => new Promise(res => {
    const t = [];
    let last = performance.now();
    let n = 0;
    const tick = () => {
      const now = performance.now();
      t.push(now - last); last = now;
      if (++n < 90) requestAnimationFrame(tick);
      else { t.sort((a, b) => a - b); res(Math.round(t[Math.floor(t.length / 2)] * 10) / 10); }
    };
    requestAnimationFrame(tick);
  }));
  note('ocean median frame = ' + ms + ' ms');

  await browser.close();
  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log('  ' + e)); }
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); }
  const bad = errors.length + fails.length;
  console.log(bad ? '\nFAIL (' + bad + ')' : '\nPASS');
  process.exit(bad ? 1 : 0);
})();
