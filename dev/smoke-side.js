// The ERRAND BOARD, played the way a player plays it: walk up to a neighbour,
// take the job they are offering, go and do it, walk back, hand it over.
//
// Every assertion here goes through the same doors the game does -- NPCs.talk,
// the TASK button's own doTask(), Side.handIn -- so a regression in the wiring
// fails here even if the data still looks right. The four things worth pinning:
//
//   1. an errand cannot be handed in before it is done, and cannot be taken twice
//   2. handing one in SPENDS the delivery and PAYS the reward (money, items,
//      seeds, perk), across all four stashes
//   3. the chain gates: step 2 is invisible until step 1 is handed in
//   4. the branches belong to the right people -- Sprout's line is not offered
//      by Marlow, which is the entire point of "get quests from different NPCs"
//
// Usage: node dev/smoke-side.js
const { chromium } = (() => { for (const m of ['playwright-core','playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) {} } throw new Error('no playwright'); })();
const path = require('path');
const fs = require('fs');
const OUT = path.join(require('os').tmpdir(), 'otto-shots');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const ok = (m) => console.log('ok    ' + m);
const bad = (m) => { fails.push(m); console.log('FAIL  ' + m); };

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
  await page.evaluate(() => { Game.newGame(); Game.go(WorldScene, {}); });
  await page.waitForFunction(() => Game.fadeDir === 0 && Game.fade === 0, null, { timeout: 30000 });

  // ---- 0. the shape of the board ---------------------------------------------
  const shape = await page.evaluate(() => {
    const byFrom = {}, byBranch = {}, keys = {};
    let dupes = 0, noAsk = 0, noThanks = 0, noPay = 0, badGiver = 0, chainHole = 0;
    const npcKeys = NPCs.LIST.map(n => n.key);
    for (const q of SIDE_QUESTS) {
      if (keys[q.key]) dupes++;
      keys[q.key] = true;
      byFrom[q.from] = (byFrom[q.from] || 0) + 1;
      byBranch[q.branch] = (byBranch[q.branch] || 0) + 1;
      if (!q.ask || !q.ask.length) noAsk++;
      if (!q.thanks || !q.thanks.length) noThanks++;
      const r = q.reward || {};
      if (!r.money && !r.items && !r.seeds && !r.perk) noPay++;
      if (npcKeys.indexOf(q.from) < 0) badGiver++;
      // every errand must be reachable: either it is step 1 or its predecessor exists
      if ((q.step || 1) > 1) {
        const prev = SIDE_QUESTS.some(p => p.branch === q.branch && p.from === q.from && (p.step || 1) === (q.step || 1) - 1);
        if (!prev) chainHole++;
      }
      // and it must have SOME way to finish
      if (!q.deliver && !q.done) chainHole++;
    }
    return { n: SIDE_QUESTS.length, byFrom, byBranch, dupes, noAsk, noThanks, noPay, badGiver, chainHole };
  });
  console.log('the board:', JSON.stringify(shape));
  if (shape.dupes) bad(`${shape.dupes} duplicate errand keys -- G.side would collide`);
  if (shape.noAsk) bad(`${shape.noAsk} errands nobody says out loud`);
  if (shape.noThanks) bad(`${shape.noThanks} errands with no thank-you`);
  if (shape.noPay) bad(`${shape.noPay} errands that pay nothing`);
  if (shape.badGiver) bad(`${shape.badGiver} errands from an NPC who does not exist`);
  if (shape.chainHole) bad(`${shape.chainHole} errands that are unreachable or unfinishable`);
  if (Object.keys(shape.byFrom).length < 3) bad('the errands do not come from three different neighbours');
  if (Object.keys(shape.byBranch).length < 4) bad('there are fewer than four branches');
  ok(`${shape.n} errands, ${Object.keys(shape.byFrom).length} givers, ${Object.keys(shape.byBranch).length} branches`);

  // ---- 1. nothing is on offer before its gate --------------------------------
  const gated = await page.evaluate(() => {
    G.goal = 0;
    return { offers: SIDE_QUESTS.filter(q => Side.offerable(q)).map(q => q.key) };
  });
  if (gated.offers.length) bad(`day one, chapter zero, and ${gated.offers.length} errands are already on offer: ${gated.offers}`);
  else ok('nothing is offered before its story gate');

  // ---- 2. each neighbour offers their OWN branch ------------------------------
  const owners = await page.evaluate(() => {
    G.goal = 6;
    const out = {};
    for (const k of ['farmer', 'angler', 'prof']) {
      const q = Side.offerFor(k);
      out[k] = q ? { key: q.key, branch: q.branch, from: q.from } : null;
    }
    return out;
  });
  console.log('who is offering what:', JSON.stringify(owners));
  for (const k in owners) {
    if (!owners[k]) { bad(`${k} has nothing to offer at chapter 6`); continue; }
    if (owners[k].from !== k) bad(`${k} is offering ${owners[k].from}'s errand`);
  }
  const branches = Object.keys(owners).map(k => owners[k] && owners[k].branch);
  if (new Set(branches.filter(Boolean)).size < 3) bad('the three neighbours are offering the same branch');
  else ok('each neighbour offers their own branch');

  // ---- 3. the round trip, through the dialogue box ----------------------------
  // Sprout's first: take it, fail to hand it in, do it, hand it in, get paid.
  const trip = await page.evaluate(async () => {
    const out = {};
    G.goal = 6;
    const q = Side.byKey('g_frame');
    out.stateBefore = Side.state(q.key);

    // take it the way the player does: talk, then the TASK button
    NPCs.talk('farmer');
    out.labelOffer = NPCs._taskLabel('farmer');
    NPCs.doTask('farmer');
    out.stateAfterAsk = Side.state(q.key);
    out.reOfferable = Side.offerable(q);          // must be false: already taken

    // hand-in refused while unfinished
    out.doneEarly = Side.isDone(q);
    out.paidEarly = Side.handIn(q);
    out.moneyEarly = G.money;

    // do it: a planter on the sand
    Farm.ensure();
    G.storage.planter = 1;
    Farm.place(0);
    out.placed = G.farm.placed;
    out.doneNow = Side.isDone(q);
    out.labelReady = NPCs._taskLabel('farmer');
    out.markReady = Side.mark('farmer');

    // hand it in
    const m0 = G.money, s0 = (G.farm.seeds.kelp || 0);
    NPCs.talk('farmer');
    NPCs.doTask('farmer');
    out.stateAfterIn = Side.state(q.key);
    out.moneyGain = G.money - m0;
    out.seedGain = (G.farm.seeds.kelp || 0) - s0;
    out.flash = !!Side._flash;
    // and step 2 is only now visible
    out.step2Open = Side.offerable(Side.byKey('g_blades'));
    NPCs.close();
    return out;
  });
  console.log('the round trip:', JSON.stringify(trip));
  if (trip.stateBefore !== 0) bad('g_frame did not start unknown');
  if (trip.labelOffer !== 'A JOB?') bad(`the TASK button read "${trip.labelOffer}" when a job was on offer`);
  if (trip.stateAfterAsk !== 1) bad('the TASK button did not take the errand');
  if (trip.reOfferable) bad('a taken errand is still on offer -- it could be taken twice');
  if (trip.doneEarly) bad('g_frame read as done before a planter was placed');
  if (trip.paidEarly) bad('an unfinished errand was handed in');
  if (!trip.doneNow) bad('placing a planter did not finish g_frame');
  if (trip.labelReady !== 'HAND IN') bad(`the button read "${trip.labelReady}" with a finished errand in hand`);
  if (trip.markReady !== '!') bad(`the head mark read "${trip.markReady}", not "!"`);
  if (trip.stateAfterIn !== 2) bad('handing in did not close the errand');
  if (trip.moneyGain !== 45) bad(`the reward paid $${trip.moneyGain}, not $45`);
  if (trip.seedGain !== 3) bad(`the reward gave ${trip.seedGain} kelp packets, not 3`);
  if (!trip.flash) bad('no hand-in slip was raised');
  if (!trip.step2Open) bad('step 2 of the garden branch did not unlock');
  if (!fails.length) ok('take -> do -> hand in -> get paid, and the chain advances');

  // ---- 4. a DELIVERY errand actually spends the goods --------------------------
  const deliv = await page.evaluate(() => {
    const out = {};
    const q = Side.byKey('g_blades');
    Side.accept(q);
    // blades live in G.farm.crops, NOT G.storage -- the whole reason _have walks
    // every stash. Nine is one short.
    G.farm.crops.blade = 9;
    out.shortDone = Side.isDone(q);
    out.shortText = Side.deliverText(q);
    G.farm.crops.blade = 12;
    out.fullDone = Side.isDone(q);
    const m0 = G.money;
    out.paid = Side.handIn(q);
    out.moneyGain = G.money - m0;
    out.bladesLeft = G.farm.crops.blade;                 // 12 - 10
    out.fert = G.storage.fertiliser || 0;
    return out;
  });
  console.log('a delivery:', JSON.stringify(deliv));
  if (deliv.shortDone) bad('9 of 10 blades counted as done');
  if (deliv.shortText.indexOf('9/10') < 0) bad(`the delivery line read "${deliv.shortText}"`);
  if (!deliv.fullDone) bad('12 blades did not satisfy a 10-blade delivery');
  if (!deliv.paid) bad('the delivery would not hand in');
  if (deliv.bladesLeft !== 2) bad(`the delivery spent the wrong amount: ${deliv.bladesLeft} left of 12, expected 2`);
  if (deliv.moneyGain !== 95) bad(`the delivery paid $${deliv.moneyGain}, not $95`);
  if (deliv.fert < 2) bad('the delivery did not pay out its fertiliser');
  else ok('a delivery counts across stashes, spends what it asked for, and pays');

  // ---- 5. the capstone perk is real ---------------------------------------------
  const perk = await page.evaluate(() => {
    const before = Farm.seedPrice('ruby', 1);
    G.side.g_row = 2;
    const q = Side.byKey('g_basket');
    Side.accept(q);
    G.farm.crops.berry = 4; G.farm.crops.curl = 4; G.farm.crops.gourd = 2;
    const paid = Side.handIn(q);
    return { paid, before, after: Farm.seedPrice('ruby', 1), perk: Side.perk('seedDeal') };
  });
  console.log('the capstone:', JSON.stringify(perk));
  if (!perk.paid) bad('the garden capstone would not hand in');
  if (!perk.perk) bad('the capstone did not grant the seedDeal perk');
  if (!(perk.after < perk.before)) bad(`seedDeal changed nothing: seeds still $${perk.after}`);
  else ok(`the capstone perk holds: ruby packets $${perk.before} -> $${perk.after}`);

  // ---- 6. the journal's second page draws --------------------------------------
  const jr = await page.evaluate(async () => {
    Quests.open = true; Quests.tab = 1; Quests.escroll = 0;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { rows: Quests._errandRows().length, tabs: (Quests._tabRects || []).length, active: Side.activeCount() };
  });
  await page.screenshot({ path: OUT + '/side-journal.png' });
  console.log('the journal:', JSON.stringify(jr));
  if (jr.tabs !== 2) bad('the journal did not draw its two tabs');
  if (!jr.rows) bad('the errand page listed nothing');
  else ok(`the errand page draws ${jr.rows} rows`);

  // ---- 7. a pat is counted once, and only when it lands -------------------------
  const pats = await page.evaluate(async () => {
    Quests.open = false;
    G.stats.petted = 0;
    Game.go(Ocean);
    await new Promise(r => setTimeout(r, 1200));
    const m = Tame.mobs.find(v => v.live);
    if (!m) return { noMob: true };
    m.vx = 0; m.vy = 0;
    Ocean.px = m.x - 10; Ocean.py = m.y; Ocean.vx = 0; Ocean.vy = 0;
    await new Promise(r => setTimeout(r, 160));
    m.x = Ocean.px + 10; m.y = Ocean.py; m.vx = 0; m.vy = 0;
    m.trust = 0; m.state = 0; m.stateT = 0; m.ease = 1;
    Tame.pet(m);                       // starts the sweep -- must NOT count
    const mid = G.stats.petted;
    if (Tame.petGame) { Tame.petGame.sweep = 0.5; Tame.pet(); }
    return { mid, after: G.stats.petted, qflag: !!G.qflags.petted };
  });
  console.log('pats:', JSON.stringify(pats));
  if (!pats.noMob) {
    if (pats.mid !== 0) bad('starting the petting sweep already counted as a pat');
    if (pats.after !== 1) bad(`a single pat counted ${pats.after} times`);
    if (!pats.qflag) bad('a landed pat did not set the journal flag');
    else ok('a pat counts exactly once, and only when it lands');
  }

  await b.close();
  if (fails.length) {
    console.log('\nFAILS:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('\nSIDE PASS: the errand board holds together');
})();
