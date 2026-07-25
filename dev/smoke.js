// Headless smoke test for Mr. Otto's Clam Farm.
//
// Plays through the whole loop with real input: title -> walk -> dive ->
// scrape -> shark stare (survives it) -> surface -> sell -> drone pickup ->
// house -> sleep. Fails on any console/page error.
//
// Usage:
//   npm install playwright-core
//   CHROMIUM=/path/to/chromium node dev/smoke.js
// (CHROMIUM defaults to /opt/pw-browsers/chromium)

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const SHOTS = path.join(__dirname, 'shots');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(GAME_URL);
  await page.waitForTimeout(1200);
  const canvas = page.locator('#game');
  await canvas.screenshot({ path: path.join(SHOTS, '1-title.png') });

  // start game
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  let scene = await page.evaluate(() => Game.scene === WorldScene ? 'world' : 'other');
  console.log('after Enter, scene =', scene);
  await canvas.screenshot({ path: path.join(SHOTS, '2-world.png') });

  // walk right to first piling (x=460)
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => WorldScene.px >= 455, null, { timeout: 8000 });
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(200);

  // dive
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  scene = await page.evaluate(() => Game.scene === DiveScene ? 'dive' : 'other');
  console.log('after E at piling, scene =', scene);
  await canvas.screenshot({ path: path.join(SHOTS, '3-dive.png') });

  // find live non-urchin nodes on screen and scrape them
  for (let round = 0; round < 4; round++) {
    const node = await page.evaluate(() => {
      const n = DiveScene.nodes.find(n =>
        n.alive && n.kind !== 'urchin' && n.y - DiveScene.camY > 30 && n.y - DiveScene.camY < 240);
      return n ? { x: n.x, y: n.y - DiveScene.camY } : null;
    });
    if (!node) break;
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + node.x * (box.width / 480), box.y + node.y * (box.height / 270), { steps: 4 });
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
  }
  const bag = await page.evaluate(() => ({ count: DiveScene.bagCount, bag: DiveScene.bag, hearts: G.hearts }));
  console.log('bag after scraping =', JSON.stringify(bag));
  if (bag.count < 1) errors.push('scraping produced no shells');
  await canvas.screenshot({ path: path.join(SHOTS, '4-scraping.png') });

  // swim down a bit
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyS');

  // force the shark encounter and survive it by holding still
  await page.evaluate(() => DiveScene.startShark());
  await page.waitForTimeout(4600);
  await canvas.screenshot({ path: path.join(SHOTS, '5-shark-pass.png') });
  await page.waitForTimeout(4200);
  console.log('shark state =', await page.evaluate(() => DiveScene.shark && DiveScene.shark.state));
  await canvas.screenshot({ path: path.join(SHOTS, '6-shark-stare.png') });
  await page.waitForFunction(() => !DiveScene.shark || DiveScene.shark.state === 'leave', null, { timeout: 12000 });
  const survived = await page.evaluate(() => G.stats.sharkSurvived);
  console.log('sharks survived =', survived);
  if (survived < 1) errors.push('did not survive the shark while motionless');

  // surface
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1200);
  scene = await page.evaluate(() => Game.scene === WorldScene ? 'world' : 'other');
  console.log('after Q, scene =', scene, 'storage =', await page.evaluate(() => JSON.stringify(G.storage)));

  // walk back to the laptop and open the shop
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => WorldScene.px <= 256, null, { timeout: 8000 });
  await page.keyboard.up('KeyA');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  console.log('shop open =', await page.evaluate(() => Shop.open));
  await canvas.screenshot({ path: path.join(SHOTS, '7-shop.png') });

  // sell everything, close shop, wait for the drone to pay
  await page.evaluate(() => Shop.sellKeys(ITEM_KEYS));
  await page.keyboard.press('Escape');
  const moneyBefore = await page.evaluate(() => G.money);
  await page.waitForTimeout(9000);
  await canvas.screenshot({ path: path.join(SHOTS, '8-drone.png') });
  await page.waitForFunction(() => !G.pendingCrate, null, { timeout: 15000 });
  const moneyAfter = await page.evaluate(() => G.money);
  console.log(`money: ${moneyBefore} -> ${moneyAfter} (drone paid ${moneyAfter - moneyBefore})`);
  if (moneyAfter <= moneyBefore) errors.push('drone pickup did not pay');

  // deck out the house and go inside
  await page.evaluate(() => {
    for (const d of DECOR) G.decor[d.id] = true;
  });
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => WorldScene.px <= 195, null, { timeout: 8000 });
  await page.keyboard.up('KeyA');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  console.log('house scene =', await page.evaluate(() => Game.scene === HouseScene ? 'house' : 'other'));
  await canvas.screenshot({ path: path.join(SHOTS, '9-house.png') });

  // sleep
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => HouseScene.px <= 85, null, { timeout: 8000 });
  await page.keyboard.up('KeyA');
  const dayBefore = await page.evaluate(() => G.day);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(3000);
  const dayAfter = await page.evaluate(() => G.day);
  console.log('day:', dayBefore, '->', dayAfter);
  if (dayAfter !== dayBefore + 1) errors.push('sleeping did not advance the day');

  console.log('---');
  if (errors.length) {
    console.log('ERRORS:');
    errors.forEach(e => console.log(' ', e));
    process.exitCode = 1;
  } else {
    console.log('No errors. Smoke test passed.');
  }
  await browser.close();
})().catch(e => {
  console.error('TEST FAILED:', e.message);
  errors.forEach(er => console.log(' ', er));
  process.exit(1);
});
