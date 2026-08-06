// Boot + integration probe for seabed farming (js/farm.js in the open ocean).
//
// dev/smoke.js proves the dive loop; this asks the questions the farming move
// actually decides:
//   * the deck plants NOTHING any more — no bed/till spot at any bridge tier,
//     and the remaining deck spots still respect the 22-unit [E] radius
//   * Farm's lazy hooks really install (integrate.js must drive the first
//     ensure(); nothing else reaches Farm on a boot that skips the stall)
//   * beds sit ON the sand: bedY(plot) === Ocean.floorAt(plot.x), and no two
//     beds are inside one swim reach of each other
//   * the whole verb chain runs through the real [E] path while swimming:
//     till -> seed picker -> plant (Digit1) -> tend -> harvest
//   * planting persists through Game.save() + a full page reload — including
//     the bed HEIGHT, which is a cache that used to poison at FLOOR_DEEP when
//     ensure() ran dockside before the ocean built its column caches
//   * a day advance (G.day++ + Farm.newDay()) moves the growth stage
//   * farming XP lands on plant and harvest
//   * touch parity: with a bed in reach the ocean layout gains a tap:'KeyE' pad
//
// Usage: CHROMIUM=/opt/pw-browsers/chromium node dev/smoke-seafarm.js
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

async function boot(page) {
  await page.goto(GAME_URL);
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.evaluate(() => { if (typeof TitleScene !== 'undefined' && Game.scene === TitleScene) { Game.scene = WorldScene; WorldScene.enter({}); } if (G && G.flags) G.flags.letter = true; if (typeof Quests !== 'undefined') Quests.letter = false; }); // tests skip the title menu, like the old boot
  await page.waitForTimeout(600);
}

// swim to a bed the cheap way: place Otto just above its sand and settle a frame
async function standOnBed(page, i) {
  await page.evaluate((idx) => {
    const p = Farm.plots()[idx];
    Ocean.px = p.x;
    Ocean.py = Farm.bedY(p) - Ocean.FLOOR_CLEAR - 2;
    Ocean.vx = 0; Ocean.vy = 0;
    Ocean.camX = Ocean.px - W * 0.5;
    Ocean.camY = Ocean.py - H * 0.42;
  }, i);
  await page.waitForTimeout(250);   // let _oceanUpdate compute reach
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await boot(page);

  // ---- 1. the deck no longer plants anything --------------------------------
  const deck = await page.evaluate(() => {
    const keep = G.bridge;
    const clashes = [], beds = [], seen = {};
    for (let b = 1; b <= 3; b++) {
      G.bridge = b;
      const s = WorldScene.spots();
      seen[b] = s.map(v => v.label.replace(/\s+/g, ' ').trim() + '@' + Math.round(v.x)).join('  ');
      // farm verb labels only — the dive spots talk about CLAM beds ("beds ~75%")
      for (const v of s) if (/till bed|seabed|plant seed|fan current|smothered/i.test(v.label)) beds.push('bridge ' + b + ': ' + v.label);
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) {
          if (Math.abs(s[i].x - s[j].x) < 22) {
            clashes.push('bridge ' + b + ': ' + s[i].label.trim() + ' @' + Math.round(s[i].x) +
                         '  vs  ' + s[j].label.trim() + ' @' + Math.round(s[j].x));
          }
        }
      }
    }
    G.bridge = keep;
    return { clashes, beds, seen };
  });
  note('bridge 1 deck: ' + deck.seen[1]);
  if (deck.beds.length) fails.push('the deck still offers farm verbs:\n      ' + deck.beds.join('\n      '));
  if (deck.clashes.length) fails.push('dock spot collisions:\n      ' + deck.clashes.join('\n      '));

  // ---- 2. Farm's hooks installed without anyone opening the stall ------------
  const hooked = await page.evaluate(() => ({
    hooked: !!Farm._hooked,
    plots: Farm.PLOT_DEF.length,
    firstX: Farm.PLOT_DEF.length ? Farm.PLOT_DEF[0].x : -1,
  }));
  note('Farm hooked=' + hooked.hooked + ' beds=' + hooked.plots + ' first bed x=' + hooked.firstX);
  if (!hooked.hooked) fails.push('Farm._hook never installed — nothing drives Farm.ensure() at boot');
  if (hooked.plots < 5) fails.push('PLOT_DEF looks like the old dock table (' + hooked.plots + ' beds)');

  // ---- 3. bed geometry: on the sand, and one bed per reach -------------------
  const geo = await page.evaluate(() => {
    const bad = [], gaps = [];
    for (const p of Farm.plots()) {
      const by = Farm.bedY(p), fy = Ocean.floorAt(p.x);
      if (Math.abs(by - fy) > 0.01) bad.push('bed ' + p.i + ': bedY ' + by.toFixed(1) + ' vs floorAt ' + fy.toFixed(1));
    }
    const D = Farm.PLOT_DEF;
    for (let i = 1; i < D.length; i++) {
      if (D[i].x - D[i - 1].x < 2 * Farm.REACH) gaps.push(D[i - 1].x + '..' + D[i].x);
    }
    return { bad, gaps, ys: Farm.plots().map(p => Math.round(Farm.bedY(p))) };
  });
  note('bed sand heights: ' + JSON.stringify(geo.ys));
  if (geo.bad.length) fails.push('beds not seated on floorAt:\n      ' + geo.bad.join('\n      '));
  if (geo.gaps.length) fails.push('beds inside one reach of each other: ' + geo.gaps.join(', '));
  if (geo.ys.some(y => y >= 1000)) fails.push('a bed cached the FLOOR_DEEP fallback height — floorAt ran before Ocean.ensure()');

  // ---- 4. seeds via the debug path, then into the water ----------------------
  await page.evaluate(() => { Farm.ensure(); G.farm.seeds.kelp = 3; Game.save(); });
  await page.evaluate(() => { Game.go(Ocean, { from: 'dock' }); });
  await page.waitForFunction(() => Game.scene === Ocean && Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);

  await standOnBed(page, 0);
  const reach = await page.evaluate(() => ({
    reach: Farm.reach ? Farm.reach.i : null,
    label: Farm.reach ? Farm.label(Farm.reach) : '',
  }));
  note('in reach of bed ' + reach.reach + ': "' + reach.label + '"');
  if (reach.reach !== 0) fails.push('standing on bed 0, Farm.atPoint found ' + reach.reach);

  // touch parity: the swim layout must grow a KeyE pad while a bed is in reach
  const pad = await page.evaluate(() => {
    const was = TouchUI.enabled;
    TouchUI.enabled = true;
    const pads = TouchUI.layout();
    TouchUI.enabled = was;
    return {
      n: pads.length,
      farm: pads.some(b => b.tap === 'KeyE' && b.icon === 'ftend'),
      swim: pads.some(b => b.key === 'ArrowLeft'),
    };
  });
  note('touch pads in reach: ' + pad.n + ' (swim pads=' + pad.swim + ', farm KeyE pad=' + pad.farm + ')');
  if (!pad.swim) fails.push('the ocean swim pads are gone from the touch layout');
  if (!pad.farm) fails.push('no tap:KeyE farm pad in the ocean touch layout while a bed is in reach');

  // ---- 5. [E]: till, then the picker, then Digit1 plants ---------------------
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const tilled = await page.evaluate(() => Farm.plots()[0].tilled);
  note('[E] tilled = ' + tilled);
  if (!tilled) fails.push('[E] over an untouched bed did not turn the seabed');

  const xp0 = await page.evaluate(() => G.skills && G.skills.farming ? G.skills.farming.xp : -1);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const picker = await page.evaluate(() => Farm.open);
  note('[E] opened seed pouch = ' + picker);
  if (!picker) fails.push('[E] over a tilled bed did not open the seed pouch');
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  const planted = await page.evaluate(() => {
    const p = Farm.plots()[0];
    return { open: Farm.open, crop: p.crop, stage: p.stage, seeds: G.farm.seeds.kelp,
             xp: G.skills && G.skills.farming ? G.skills.farming.xp : -1 };
  });
  note('planted: ' + JSON.stringify(planted));
  if (planted.open) fails.push('the pouch stayed open after planting');
  if (planted.crop !== 'kelp') fails.push('Digit1 did not plant kelp blade (crop=' + planted.crop + ')');
  if (planted.seeds !== 2) fails.push('planting did not spend a seed packet (left=' + planted.seeds + ')');
  if (planted.xp <= xp0) fails.push('planting paid no farming XP (' + xp0 + ' -> ' + planted.xp + ')');

  // ---- 6. [E] again is the daily tend -----------------------------------------
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const tended = await page.evaluate(() => Farm.plots()[0].watered);
  note('[E] tended (current fanned) = ' + tended);
  if (!tended) fails.push('[E] over a fresh crop did not tend it');

  // ---- 7. persistence: save, RELOAD, and the plot (and its height) survive ---
  await page.evaluate(() => Game.save());
  await boot(page);
  const persisted = await page.evaluate(() => {
    const p = Farm.plots()[0];
    return { crop: p.crop, tilled: p.tilled, watered: p.watered, days: p.days,
             y: Math.round(Farm.bedY(p)), seeds: G.farm.seeds.kelp };
  });
  note('after reload: ' + JSON.stringify(persisted));
  if (persisted.crop !== 'kelp' || !persisted.tilled) fails.push('the planted bed did not survive a reload');
  if (!persisted.watered) fails.push('the tended flag did not survive a reload');
  if (persisted.seeds !== 2) fails.push('the seed pouch did not survive a reload');
  if (persisted.y >= 1000) fails.push('after reload the bed height cached the FLOOR_DEEP fallback (' + persisted.y + ')');

  // ---- 8. a night passes: the stage advances ---------------------------------
  const grown = await page.evaluate(() => {
    G.day++;
    Farm.newDay();
    const p = Farm.plots()[0];
    return { days: p.days, stage: p.stage, watered: p.watered };
  });
  note('after one night: ' + JSON.stringify(grown));
  if (grown.days !== 1) fails.push('the night did not bank a growth day (days=' + grown.days + ')');
  if (grown.stage !== 1) fails.push('the stage did not advance (stage=' + grown.stage + ')');
  if (grown.watered) fails.push('the silt did not settle back overnight (watered stayed true)');

  // ---- 9. tend again, one more night, and [E] harvests ------------------------
  await page.evaluate(() => { Game.go(Ocean, { from: 'dock' }); });
  await page.waitForFunction(() => Game.scene === Ocean && Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await standOnBed(page, 0);
  await page.keyboard.press('KeyE');   // tend day 2
  await page.waitForTimeout(300);
  const ready = await page.evaluate(() => {
    G.day++;
    Farm.newDay();
    const p = Farm.plots()[0];
    return { days: p.days, stage: p.stage, ready: Farm.ready(p), label: Farm.label(p) };
  });
  note('after two nights: ' + JSON.stringify(ready));
  if (!ready.ready) fails.push('kelp blade was not ready after two tended nights: ' + JSON.stringify(ready));

  await standOnBed(page, 0);
  const xph = await page.evaluate(() => G.skills.farming.xp);
  await page.keyboard.press('KeyE');   // harvest
  await page.waitForTimeout(300);
  const reaped = await page.evaluate(() => ({
    crop: Farm.plots()[0].crop,
    got: G.farm.crops.blade,
    xp: G.skills.farming.xp,
  }));
  note('harvest: ' + JSON.stringify(reaped));
  if (reaped.crop !== null) fails.push('[E] did not harvest the ready crop');
  if (!(reaped.got >= 2)) fails.push('the harvest paid no produce (blade=' + reaped.got + ')');
  if (reaped.xp <= xph) fails.push('harvesting paid no farming XP (' + xph + ' -> ' + reaped.xp + ')');

  await browser.close();
  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log('  ' + e)); }
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); }
  const bad = errors.length + fails.length;
  console.log(bad ? '\nFAIL (' + bad + ')' : '\nPASS');
  process.exit(bad ? 1 : 0);
})();
