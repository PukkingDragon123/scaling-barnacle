// The story layer: the title menu leads to the letter, the letter to the
// journal, the journal's chapters tick and pay, and the pearl band does what a
// pearl band should. Everything here goes through the same doors a player uses
// -- the menu row, the [J] key, the gift flow -- because the whole feature IS
// those doors.
//
// Usage: node dev/smoke-quest.js
const { chromium } = (() => { for (const m of ['playwright-core','playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) {} } throw new Error('no playwright'); })();
const path = require('path');
const fs = require('fs');
const OUT = path.join(require('os').tmpdir(), 'otto-shots');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await b.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => fails.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(
    () => typeof G !== 'undefined' && G && ASSETS.dock_11 && ASSETS.dock_11.width,
    null, { timeout: 60000 });

  // ---- 1. the front door: boot lands on the title, Enter walks in ------------
  const onTitle = await page.evaluate(() => Game.scene === TitleScene);
  if (!onTitle) fails.push('boot did not land on the title menu');
  await page.screenshot({ path: OUT + '/q-title.png' });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({
    scene: Game.scene === WorldScene ? 'world' : 'OTHER',
    letter: Quests.letter,
  }));
  console.log('through the door:', JSON.stringify(s1));
  if (s1.scene !== 'world') fails.push('the menu did not lead to the dock');
  if (!s1.letter) fails.push('a fresh game did not open with the letter');
  await page.screenshot({ path: OUT + '/q-letter.png' });

  // ---- 2. fold the letter, open the journal with [J] --------------------------
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => ({
    letter: Quests.letter, journal: Quests.open,
    flag: G.flags.letter, chapters: QUESTS.length, goal: G.goal,
  }));
  console.log('journal:', JSON.stringify(s2));
  if (s2.letter) fails.push('the letter did not fold away on [E]');
  if (!s2.journal) fails.push('[J] did not open the journal');
  if (s2.chapters < 12) fails.push('the questline is thin: ' + s2.chapters + ' chapters');
  await page.screenshot({ path: OUT + '/q-journal.png' });
  await page.keyboard.press('KeyJ');

  // ---- 3. chapter one ticks and pays when Fintan says hello -------------------
  const s3 = await page.evaluate(async () => {
    const money0 = G.money, goal0 = G.goal;
    NPCs.talk('prof');                       // the real door: talking sets met
    NPCs.open = false;                       // close the modal so the loop runs
    await new Promise(r => setTimeout(r, 600));
    return { goal0, goal: G.goal, paid: G.money - money0, met: G.friends.prof.met };
  });
  console.log('chapter one:', JSON.stringify(s3));
  if (!(s3.goal > s3.goal0)) fails.push('meeting Fintan did not turn the page');
  if (!(s3.paid >= 20)) fails.push('chapter one paid ' + s3.paid + ', expected the letter money');

  // ---- 4. the pearl band ------------------------------------------------------
  const s4 = await page.evaluate(() => {
    const out = {};
    // early ask: not consumed, no partner
    G.storage.pearlband = 1;
    G.friends.farmer.pts = 100;
    G.friends.farmer.giftDay = 0;
    out.earlyLine = NPCs.gift('farmer', 'pearlband');
    out.earlyKept = G.storage.pearlband === 1;
    out.earlyPartner = G.partner || null;
    // the professor declines gracefully and hands it back
    G.friends.prof.pts = 250; G.friends.prof.giftDay = 0;
    out.profLine = NPCs.gift('prof', 'pearlband');
    out.profKept = G.storage.pearlband === 1;
    // eight hearts: yes
    G.friends.farmer.pts = 210; G.friends.farmer.giftDay = 0;
    out.yesLine = NPCs.gift('farmer', 'pearlband');
    out.partner = G.partner;
    out.consumed = (G.storage.pearlband || 0) === 0;
    out.maxed = G.friends.farmer.pts === 250;
    return out;
  });
  console.log('pearl band:', JSON.stringify(s4, null, 1));
  if (!s4.earlyKept || s4.earlyPartner) fails.push('an early ask was consumed or bound');
  if (!s4.profKept) fails.push('the professor kept a band he declined');
  if (s4.partner !== 'farmer') fails.push('an accepted band did not set the partner');
  if (!s4.consumed) fails.push('an accepted band was not consumed');
  if (!s4.maxed) fails.push('acceptance did not fill the hearts');

  // ---- 5. the partner takes the visitor post daily ----------------------------
  const s5 = await page.evaluate(() => {
    G.day = 7; G.clock = 0.3;
    // read through the same override the deck uses
    const keep = NPCs.LIST;
    const spots = WorldScene.spots().filter(v => v.label && /Sprout|Marlow|Fintan/.test(v.label));
    return { post: spots.length ? spots[0].label : null };
  });
  console.log('the post:', JSON.stringify(s5));
  if (!s5.post || s5.post.indexOf('Sprout') < 0) fails.push('the partner does not hold the visitor post: ' + s5.post);

  // ---- 6. partner dialogue pool ------------------------------------------------
  const s6 = await page.evaluate(() => {
    G.friends.farmer.talkDay = 0;            // fresh chat today
    NPCs.talk('farmer');
    const flat = NPCs.pages.map(p => p.join(' ')).join(' ');
    NPCs.open = false;
    return { line: flat.slice(0, 90) };
  });
  console.log('partner says:', JSON.stringify(s6));

  await b.close();
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log('\nQUEST PASS: the story holds together');
})().catch(e => { console.error(e); process.exit(1); });
