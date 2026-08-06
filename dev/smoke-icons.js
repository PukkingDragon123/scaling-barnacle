// Every key the bag can hold must resolve to REAL uploaded art, never to a
// hand-coded glyph.
//
// Why this needs a suite of its own: missing art is silent here. Inv.drawIcon
// falls back to _glyph() and paints a plausible little shape, so a key with no
// sprite does not look broken in a screenshot -- it just quietly makes the game
// look hand-drawn in code instead of showing the art that was uploaded for it.
// Thirty-two of forty-two keys were in that state before Inv.ART_MAP existed and
// nothing anywhere failed.
//
// The catalogues below are the same ones Inv resolves through, so a new item added
// to any of them is picked up here automatically and fails until it has art.
//
// Usage: node dev/smoke-icons.js
const { chromium } = (() => { for (const m of ['playwright-core','playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) {} } throw new Error('no playwright'); })();
const path = require('path');
const fs = require('fs');
const OUT = path.join(require('os').tmpdir(), 'otto-shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });

  const res = await page.evaluate(() => {
    const keys = new Set();
    // Only string keys: some catalogues are arrays, and their indices are not items.
    const add = (o) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return;
      Object.keys(o).forEach(k => { if (!/^\d+$/.test(k)) keys.add(k); });
    };
    if (typeof Craft !== 'undefined') { add(Craft.RES); add(Craft.ITEMS); add(Craft.MATS); }
    if (typeof Inv !== 'undefined') { add(Inv.DEF); add(Inv.ITEMS); }
    if (typeof ITEMS !== 'undefined') add(ITEMS);
    if (typeof Farm !== 'undefined') { add(Farm.PRODUCE); add(Farm.SEEDS); }
    if (typeof Mining !== 'undefined') add(Mining.RES);
    if (typeof Tame !== 'undefined') add(Tame.PRODUCE);

    const glyph = [], art = [];
    keys.forEach(k => {
      const a = Inv._artOf(k);
      if (a) art.push(k + ' -> ' + a); else glyph.push(k);
    });
    return { total: keys.size, art: art.sort(), glyph: glyph.sort() };
  });

  console.log('bag keys checked: ' + res.total);
  console.log('resolved to real art: ' + res.art.length);
  if (res.glyph.length) {
    console.log('\nSTILL FALLING BACK TO A CODED GLYPH (' + res.glyph.length + '):');
    res.glyph.forEach(k => console.log('  ' + k));
  }

  // Draw them all so a human can see the mapping is sensible, not merely non-null:
  // a wrong-but-present sprite passes the assertion and this catches that.
  const dataUrl = await page.evaluate((keys) => {
    const BOX = 20, PAD = 8, S = 4, COLS = 10;
    const rows = Math.ceil(keys.length / COLS);
    const cv = document.createElement('canvas');
    cv.width = COLS * (BOX + PAD) * S;
    cv.height = rows * (BOX + PAD * 2) * S;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#2b1d14';
    c.fillRect(0, 0, cv.width, cv.height);
    c.save(); c.scale(S, S);
    keys.forEach((k, i) => {
      const cx = (i % COLS) * (BOX + PAD) + BOX / 2 + PAD / 2;
      const cy = Math.floor(i / COLS) * (BOX + PAD * 2) + BOX / 2 + PAD;
      Inv.drawIcon(c, k, cx, cy, BOX);
    });
    c.restore();
    return cv.toDataURL();
  }, res.art.map(s => s.split(' -> ')[0]).concat(res.glyph));
  fs.writeFileSync(OUT + '/icons-all.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('sheet: ' + OUT + '/icons-all.png');

  await b.close();
  const fails = [];
  if (res.glyph.length) fails.push(res.glyph.length + ' bag key(s) have no real art');
  errs.forEach(e => fails.push(e));
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log('\nICONS PASS: every bag key draws uploaded art');
})().catch(e => { console.error(e); process.exit(1); });
