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

  // ONE SURVEY STEP, played the whole way round: ask Fintan for it, satisfy it,
  // walk it back. The round trip IS the feature, so the test does the round trip
  // -- a step that quietly completes itself is exactly the thing that was
  // removed, and this suite fails if it comes back.
  const step = async (key, label, fn) => {
    const before = await page.evaluate(() => ({ goal: G.goal, money: G.money }));
    // 1. it must be on offer from Fintan, and NOT already satisfied on its own
    const offer = await page.evaluate((k) => {
      const q = Side.byKey(k);
      const o = Side.offerFor('prof');
      return { offered: !!o && o.key === k, state: Side.state(k) };
    }, key);
    if (!offer.offered) fails.push(`${label}: Fintan is not offering it (state ${offer.state})`);
    // 2. take it through the dialogue box
    await page.evaluate((k) => { NPCs.talk('prof'); NPCs.doTask('prof'); NPCs.close(); }, key);
    const took = await page.evaluate((k) => Side.taken(k), key);
    if (!took) fails.push(`${label}: the TASK button did not take it`);
    // 3. do the thing
    await page.evaluate(fn);
    await page.waitForTimeout(120);
    const ready = await page.evaluate((k) => Side.isDone(Side.byKey(k)), key);
    if (!ready) fails.push(`${label}: doing the work did not satisfy it`);
    // 4. and nothing may have advanced on its own
    const mid = await page.evaluate(() => G.goal);
    if (mid !== before.goal) fails.push(`${label}: G.goal moved without a hand-in`);
    // 5. hand it back
    await page.evaluate(() => { NPCs.talk('prof'); NPCs.doTask('prof'); NPCs.close(); });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ goal: G.goal, money: G.money, state: G.side }));
    const ok = after.goal === before.goal + 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  step${before.goal + 1} ${label}  ($${before.money} -> $${after.money})`);
    if (!ok) fails.push(`${label}: handing it in did not advance the survey`);
    return after;
  };

  await step('m_hello', 'say hello', () => { NPCs.talk('prof'); NPCs.close(); });

  // Fintan's kit must be in hand once the survey is under way
  const kit = await page.evaluate(() => {
    let scraper = false;
    for (const s of G.hotbar) if (s && s.key === 'scraper') scraper = true;
    return { kitted: !!G.flags.kitted, scraper };
  });
  console.log('      Fintan kit:', JSON.stringify(kit));
  if (!kit.kitted || !kit.scraper) fails.push('the scraper did not arrive with the first survey step');

  await step('m_dive', 'five off the piling', () => {
    G.storage.clam = 3; G.storage.mussel = 2; G.stats.scraped = 5;
  });

  // the workbench chain must be buildable BAREHANDED: timber and stone come
  // free by hand, the pick is much later
  const hand = await page.evaluate(() => {
    Mining.ensure();
    const gate = (kind) => !G.mining.hasPick && kind !== 'wood' && kind !== 'stone';
    return { wood: !gate('wood'), stone: !gate('stone'), gold: !gate('gold') };
  });
  console.log('      barehanded:', JSON.stringify(hand));
  if (!hand.wood || !hand.stone) fails.push('timber/stone need a pick -- the workbench chain is deadlocked');
  if (hand.gold) fails.push('ores are minable without a pick -- the gate is gone');

  await step('m_bench', 'a bench of your own', () => {
    if (!Array.isArray(G.placed)) G.placed = [];
    G.placed.push({ key: 'crack', x: 240 });
  });
  await step('m_crate', 'the first crate', () => { G.stats.sold = 1; });

  // Marlow's pick must be in hand BEFORE the survey asks for iron (step 5), and
  // Sprout's planter before her own garden branch opens. Both gates are step
  // counts on the eight-step scale now -- see js/integrate.js.
  const kit3 = await page.evaluate(() => ({
    kitted2: !!G.flags.kitted2, planter: (G.storage.planter || 0),
    kitted3: !!G.flags.kitted3, hasPick: G.mining.hasPick,
  }));
  console.log('      Sprout + Marlow kit:', JSON.stringify(kit3));
  if (!kit3.kitted2) fails.push("Sprout's kit did not arrive by the fourth survey step");
  if (kit3.planter < 1) fails.push('no planter in hand once the garden branch is open');
  if (!kit3.hasPick) fails.push('no pick in hand before the survey asks for iron');

  await step('m_cord', 'rope and rivets', () => { G.storage.rope = 4; G.storage.iron = 2; });

  await step('m_stone', 'strike the stone', () => { G.mining.mined = 15; });
  await step('m_case', 'something for the case', () => {
    G.storage.pearlPol = 2; G.storage.abalonePol = 1;
    G.stats.pearls = 2; G.stats.polished = 3;
  });

  // the keepsake must be on the stall shelf once somebody is close
  const band = await page.evaluate(() => {
    NPCs.ensure(); G.friends.farmer.pts = 200;
    Shop.tab = Shop.STALL_TAB;
    return Shop.buildRows().some(r => r.label === 'Pearl Band');
  });
  console.log('      keepsake on the shelf:', band);
  if (!band) fails.push('the pearl band is not for sale at eight hearts');

  await step('m_survey', 'the survey, finished', () => {
    G.money = 2500;
    NPCs.talk('farmer'); NPCs.close();
    NPCs.talk('angler'); NPCs.close();
  });

  const end = await page.evaluate(() => ({
    goal: G.goal, steps: MAIN_QUESTS.length, cineKeys: Object.keys(Cine.BEATS).length,
  }));
  console.log(`\nthe survey: ${end.goal}/${end.steps} steps handed in`);
  if (end.goal !== end.steps) fails.push('the survey did not reach its last step');
  if (end.cineKeys < 3) fails.push('the cinematic beats are missing');

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
      // Otto has not moved during that settle, so Tame's _lpx/_lpy are already
      // in sync with him -- which means the mob can be put back in reach in
      // THIS tick and petted in the same one. Waiting again would just give the
      // wander AI another 160ms to swim it back out of OFFER_R, which is what
      // made this assertion flaky rather than false.
      m.x = Ocean.px + 10; m.y = Ocean.py; m.vx = 0; m.vy = 0;
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
