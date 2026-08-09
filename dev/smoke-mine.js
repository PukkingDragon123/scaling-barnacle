// Probe for the mining timing game: the sweep runs on a targeted node, the
// centre of the bar grades as perfect, the edge grades as a miss, and a perfect
// blow out-damages a mistimed one. Screenshots are full-frame on purpose --
// pinning the camera with a setInterval to frame a crop starves the raf loop and
// captures a half-composited frame, which looks exactly like a rendering bug.
//
// Usage: node dev/smoke-mine.js
const { chromium } = (() => { for (const m of ['playwright-core','playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) {} } throw new Error('no playwright'); })();
const OUT = require('path').join(require('os').tmpdir(), 'otto-shots');
require('fs').mkdirSync(OUT, { recursive: true });
const fails=[];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--allow-file-access-from-files','--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => fails.push('pageerror: ' + e.message));
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G && ASSETS.dock_11 && ASSETS.dock_11.width, null, {timeout:60000});
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, {timeout:30000});
  await page.evaluate(() => { if (typeof TitleScene !== 'undefined' && Game.scene === TitleScene) { Game.scene = WorldScene; WorldScene.enter({}); } if (G && G.flags) G.flags.letter = true; if (typeof Quests !== 'undefined') Quests.letter = false; Mining.ensure(); G.mining.hasPick = true; }); // tests skip the title menu, like the old boot
  await page.evaluate(() => Game.go(Ocean));
  // Wait for chunk generation rather than a fixed sleep: nodes are spawned as the
  // camera reaches new chunks, so a timeout raced it and reported NO NODES.
  await page.waitForFunction(
    () => typeof Mining !== 'undefined' && Mining.nodes && Mining.nodes.some(n => !n.dead),
    null, { timeout: 25000 });
  // find a node and park Otto on it
  const info = await page.evaluate(() => {
    const n = Mining.nodes.find(v => !v.dead);
    if (!n) return null;
    Ocean.px = n.x - 18; Ocean.py = n.y; Ocean.vx = 0; Ocean.vy = 0;
    Ocean.camX = Ocean.px - W*0.5; Ocean.camY = Ocean.py - H*0.42;
    return { kind: n.kind, hp: n.hp, x: Math.round(n.x), y: Math.round(n.y), w: n.w };
  });
  if (!info) { console.log('NO NODES'); process.exit(1); }
  console.log('node:', JSON.stringify(info));
  // the camera EASES toward Otto and buoyancy moves him, so pin both while we look
  await page.evaluate((n) => {
    window.__pin = setInterval(() => {
      Ocean.px = n.x - 18; Ocean.py = n.y; Ocean.vx = 0; Ocean.vy = 0;
      Ocean.camX = Ocean.px - W*0.5; Ocean.camY = Ocean.py - H*0.42;
    }, 8);
  }, info);
  await page.waitForTimeout(600);
  // ENGAGE IS REQUIRED NOW. Parking next to a rock must leave it a candidate and
  // nothing more -- proximity used to throw a timing bar and a progress ring onto
  // whatever you drifted near, and this suite asserted that, so the assertion is
  // inverted here rather than deleted: "no target while merely parked" is the
  // behaviour worth protecting, and "engage() takes it up" is the other half.
  const idle = await page.evaluate(() => ({
    candidate: !!Mining.candidate, target: !!Mining.target, sweep: Mining.sweep,
  }));
  console.log('parked (no engage):', JSON.stringify(idle));
  if (!idle.candidate) fails.push('parked on a node but it is not even a candidate');
  if (idle.target) fails.push('a node is targeted WITHOUT an engage -- proximity still mines');
  await page.screenshot({ path: OUT + '/mine-prompt.png', fullPage: false });

  const sw = await page.evaluate(() => {
    Mining.engage(Mining.candidate);
    return { sweep: Mining.sweep, target: !!Mining.target, zone: Mining.target ? Mining.zoneFor(Mining.target) : null };
  });
  await page.waitForTimeout(300);
  console.log('after engage:', JSON.stringify(sw));
  if (!sw.target) fails.push('engage() did not take up the node in reach');
  if (!sw.zone) fails.push('no timing zone once engaged');
  await page.screenshot({ path: OUT + '/mine-bar.png', fullPage: false });
  // force a perfect hit and a miss, compare damage
  const dmg = await page.evaluate(() => {
    const n = Mining.target;
    const out = {};
    n.hp = 999; Mining.sweep = 0.5; Mining.grade = Mining.sweepGrade(n);
    out.gradeAtCentre = Mining.grade;
    let before = n.hp; Mining._land(n); out.perfect = before - n.hp;
    n.hp = 999; Mining.sweep = 0.02; Mining.grade = Mining.sweepGrade(n);
    out.gradeAtEdge = Mining.grade;
    before = n.hp; Mining._land(n); out.miss = before - n.hp;
    return out;
  });
  console.log('damage:', JSON.stringify(dmg));
  if (!(dmg.perfect > dmg.miss)) fails.push('a perfect hit does not out-damage a mistimed one');
  if (dmg.gradeAtCentre !== 'perfect') fails.push('centre of the bar is not graded perfect');
  if (dmg.gradeAtEdge !== '') fails.push('the edge of the bar is graded as a hit');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/mine-hit.png', fullPage: false });
  await b.close();
  if (fails.length) { console.log('FAILS:'); fails.forEach(f=>console.log('  '+f)); process.exit(1); }
  console.log('MINING PASS');
})();
