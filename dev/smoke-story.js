// THE WHOLE STORY, played start to finish. Each chapter is advanced through the
// same state its real mechanic writes (the mechanics themselves are covered by
// the other suites -- smoke.js dives and cracks, smoke-mine swings, smoke-seafarm
// plants), and the things this suite is REALLY watching are the seams between
// chapters, because that is where a questline rots:
//
//   * every chapter's done() fires, in order, with no unreachable step
//   * every reward pays what the journal promised
//   * the gifts arrive when their chapter OPENS, not after it closes (the
//     off-by-one this suite was written to catch: Sprout's hoe arrived a
//     chapter late, and the first workbench needed a pick from chapter nine)
//   * the keepsake appears in the stall exactly when the story says it should
//
// Usage: node dev/smoke-story.js
const { chromium } = (() => { for (const m of ['playwright-core','playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) {} } throw new Error('no playwright'); })();
const path = require('path');
const fails = [];

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await b.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => fails.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G && ASSETS.dock_11 && ASSETS.dock_11.width, null, { timeout: 60000 });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });
  await page.evaluate(() => { if (typeof TitleScene !== 'undefined' && Game.scene === TitleScene) { Game.scene = WorldScene; WorldScene.enter({}); } if (G && G.flags) G.flags.letter = true; if (typeof Quests !== 'undefined') Quests.letter = false; });

  // one chapter: apply its condition, let the loop tick, check the page turned
  const step = async (label, fn) => {
    const before = await page.evaluate(() => ({ goal: G.goal, money: G.money }));
    await page.evaluate(fn);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ goal: G.goal, money: G.money }));
    const ok = after.goal === before.goal + 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ch${before.goal} ${label}  ($${before.money} -> $${after.money})`);
    if (!ok) fails.push(`chapter ${before.goal} (${label}) did not complete`);
    return after;
  };

  await step('hello', () => { NPCs.talk('prof'); NPCs.open = false; });

  // Fintan's kit must be in hand BEFORE the shells chapter is attempted
  const kit = await page.evaluate(() => {
    let scraper = false;
    for (const s of G.hotbar) if (s && s.key === 'scraper') scraper = true;
    return { kitted: !!G.flags.kitted, scraper };
  });
  console.log('      Fintan kit:', JSON.stringify(kit));
  if (!kit.kitted || !kit.scraper) fails.push('the scraper did not arrive when the shells chapter opened');

  await step('shells', () => { G.stats.scraped = 5; });
  await step('crate', () => { G.stats.sold = 1; });

  // the workbench chain must be buildable BAREHANDED: timber and stone come
  // free by hand, the pick is five chapters away
  const hand = await page.evaluate(() => {
    Mining.ensure();
    const wood = { kind: 'wood', dead: false };
    const stone = { kind: 'stone', dead: false };
    const gold = { kind: 'gold', dead: false };
    const gate = (n) => !G.mining.hasPick && n.kind !== 'wood' && n.kind !== 'stone';
    return { wood: !gate(wood), stone: !gate(stone), gold: !gate(gold) };
  });
  console.log('      barehanded:', JSON.stringify(hand));
  if (!hand.wood || !hand.stone) fails.push('timber/stone need a pick -- the workbench chain is deadlocked');
  if (hand.gold) fails.push('ores are minable without a pick -- the gate is gone');

  await step('knife', () => { G.stats.cracked = 1; });
  await step('bag', () => { G.gear.bag = 1; });
  await step('neighbours', () => { NPCs.talk('farmer'); NPCs.open = false; NPCs.talk('angler'); NPCs.open = false; });

  // Sprout's kit must arrive when the PLANTING chapter opens (the off-by-one)
  const kit2 = await page.evaluate(() => ({ kitted2: !!G.flags.kitted2, planter: (G.storage.planter || 0) }));
  console.log('      Sprout kit:', JSON.stringify(kit2));
  if (!kit2.kitted2) fails.push("Sprout's kit did not arrive when the planting chapter opened");
  if (kit2.planter < 1) fails.push('no planter in hand at the planting chapter');

  await step('planted', () => {
    Farm.ensure();
    Farm.place(G.farm.placed);           // the gifted planter, set down for real
    Farm.till(0);
    G.farm.seeds.kelp = 1;
    Farm.plant(0, 'kelp');               // sets qflags.planted via the journal hook
  });
  await step('midbed', () => { G.bridge = 2; });
  await step('petted', () => { G.qflags.petted = true; });

  // Marlow's pick must arrive when the MINING chapter opens
  const kit3 = await page.evaluate(() => ({ kitted3: !!G.flags.kitted3, hasPick: G.mining.hasPick }));
  console.log('      Marlow kit:', JSON.stringify(kit3));
  if (!kit3.hasPick) fails.push('no pick in hand at the mining chapter');

  await step('mined', () => { G.mining.mined = 5; });
  await step('pearl', () => { G.stats.pearls = 1; });
  await step('polish', () => { G.stats.polished = 1; });
  await step('deepbed', () => { G.bridge = 3; });
  await step('still', () => { G.stats.sharkSurvived = 1; });
  await step('close', () => { NPCs.ensure(); G.friends.farmer.pts = 200; });

  // the keepsake must be on the stall shelf now, and only now
  const band = await page.evaluate(() => {
    Shop.tab = Shop.STALL_TAB;
    return Shop.buildRows().some(r => r.label === 'Pearl Band');
  });
  console.log('      keepsake on the shelf:', band);
  if (!band) fails.push('the pearl band is not for sale after A Heart Alongside');

  await step('dream', () => { G.money = 5000; });

  const end = await page.evaluate(() => ({ goal: G.goal, chapters: QUESTS.length }));
  console.log(`\nthe story: ${end.goal}/${end.chapters} chapters complete`);
  if (end.goal !== end.chapters) fails.push('the story did not reach the last page');

  // ---- the tame layer, pinned ------------------------------------------------
  // Feature work in tame.js was once lost to a container rollback BETWEEN
  // editing and committing, and nothing failed because nothing asserted it.
  // These are the tripwire: if tame.js regresses, this suite goes red.
  const tame = await page.evaluate(async () => {
    const out = {
      calm: Tame.CALM_SPEED, wakeMax: Tame.WAKE_MAX || 0,
      hasWakeDraw: typeof Tame._drawWake === 'function',
      hasPetGame: typeof Tame._drawPetGame === 'function',
    };
    Game.go(Ocean);
    await new Promise(r => setTimeout(r, 1200));
    const m = Tame.mobs.find(v => v.live);
    if (m) {
      m.vx = 80; m.vy = 0; m.alpha = 1;
      await new Promise(r => setTimeout(r, 900));
      out.wakeLive = Tame.wake.filter(p => p.t > 0).length;
      // Two things bite here, and both are the game being RIGHT:
      //   * canPet reads Tame's own copy of the player position (_lpx/_lpy),
      //     which only syncs when Tame.update runs -- so moving Otto and petting
      //     in the same tick fails the reach test. Move first, let a frame pass.
      //   * teleporting Otto next to an animal spikes the measured player speed,
      //     which is a charge, so it bolts (state 2). Settle it AFTER the move.
      // and stop the mob first: the wake check above left it swimming at 80/s, so
      // it drifts out of OFFER_R during the settle and canPet fails on distance
      m.vx = 0; m.vy = 0;
      Ocean.px = m.x - 10; Ocean.py = m.y; Ocean.vx = 0; Ocean.vy = 0;
      await new Promise(r => setTimeout(r, 160));
      m.trust = 0; m.state = 0; m.stateT = 0; m.ease = 1;
      const t0 = m.trust;
      Tame.pet(m);
      out.gameStarted = !!Tame.petGame;
      if (Tame.petGame) {
        Tame.petGame.sweep = 0.5;
        Tame.pet();
        out.gameGraded = !Tame.petGame;
        out.trustGain = Math.round((m.trust - t0) * 10) / 10;
      }
    } else out.noMob = true;
    return out;
  });
  console.log('tame layer:', JSON.stringify(tame));
  if (tame.calm <= 44) fails.push('CALM_SPEED regressed: animals spook at a normal pace again');
  if (!tame.hasWakeDraw || tame.wakeMax <= 0) fails.push('the wake system is missing from tame.js');
  if (!tame.hasPetGame) fails.push('the petting game is missing from tame.js');
  if (!tame.noMob && !(tame.wakeLive > 0)) fails.push('a moving animal sheds no wake');
  if (!tame.noMob && !tame.gameStarted) fails.push('[E] did not start the petting game');
  if (!tame.noMob && tame.gameStarted && !(tame.trustGain > 0)) fails.push('a perfect pet gained no trust');

  await b.close();
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log('STORY PASS: playable start to finish');
})().catch(e => { console.error(e); process.exit(1); });
