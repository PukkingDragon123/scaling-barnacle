// Does the ocean actually PAINT?
//
// Every other suite here asserts state -- positions, inventory, flags -- and all
// of them passed while the ocean was rendering as one flat colour. State being
// right is not the same as pixels being right, and nothing was watching the
// pixels. This does: enter the ocean by playing (walk the dock, press [E]),
// then sample a column of the real backing store and count distinct colours.
// A rendered frame has dozens; a blank one has one.
//
// It runs several times because the failure is INTERMITTENT -- roughly two runs
// in three at the time of writing -- so a single pass proves nothing.
//
// Usage: CHROMIUM=/opt/pw-browsers/chromium node dev/smoke-render.js
const { chromium } = (() => {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* next */ }
  }
  throw new Error('install playwright-core (or playwright)');
})();
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const RUNS = Number(process.env.RUNS || 4);
const MIN_COLOURS = 5;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const errs = [];
  let flat = 0;
  for (let run = 1; run <= RUNS; run++) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', e => errs.push('run ' + run + ' pageerror: ' + e.message));
    await page.goto(GAME_URL);
    await page.waitForFunction(
      () => typeof G !== 'undefined' && G && typeof ASSETS !== 'undefined' && ASSETS.dock_11 && ASSETS.dock_11.width,
      null, { timeout: 90000 });
    await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });

    const dock = await sample(page);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(1600); await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(2600);
    const inOcean = await page.evaluate(() => typeof Ocean !== 'undefined' && Game.scene === Ocean);
    const sea = await sample(page);
    console.log('run ' + run + ': dock ' + dock.n + ' colours, ocean ' + sea.n + ' colours' +
                (inOcean ? '' : '  (NOT IN THE OCEAN)'));
    if (dock.n < MIN_COLOURS) { flat++; errs.push('run ' + run + ': the DOCK rendered blank (' + dock.n + ')'); }
    if (inOcean && sea.n < MIN_COLOURS) { flat++; errs.push('run ' + run + ': the OCEAN rendered blank (' + sea.n + ' colour, ' + sea.px + ')'); }
    await page.close();
  }
  await browser.close();
  if (errs.length) { console.log('\nFAILS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log(flat ? '\nFAIL: ' + flat + ' blank frame(s) in ' + RUNS + ' runs' : '\nRENDER PASS: every frame painted');
  process.exit(errs.length ? 1 : 0);
})();

async function sample(page) {
  return page.evaluate(() => {
    const cv = document.getElementById('game');
    const c = cv.getContext('2d');
    const s = new Set();
    let first = '';
    for (let i = 1; i < 25; i++) {
      const d = c.getImageData(Math.floor(cv.width * 0.49), Math.floor(cv.height * i / 25), 1, 1).data;
      const k = d[0] + ',' + d[1] + ',' + d[2];
      if (!first) first = k;
      s.add(k);
    }
    return { n: s.size, px: first };
  });
}
