// ---- wiring: the systems modules into the scenes that host them ---------------
//
// Each system (Farm, Hotbar, NPCs, Craft, Battle, Stock, DiveFX) is written as a
// self-contained module that knows nothing about the others. Everything that
// crosses a boundary lives here, so no module ever has to reach into another and
// the scene files stay about their own scene.
//
// Every reference is guarded with a typeof check: a module that failed to load
// degrades to "that feature is absent" rather than taking the whole game down.
'use strict';

(function () {
  const has = (n) => typeof window[n] !== 'undefined' && window[n];

  // These are declared with const at script scope, so they are NOT on window.
  // Resolve them through a try so a missing module is just undefined.
  const M = {};
  for (const n of ['Farm', 'Hotbar', 'NPCs', 'Craft', 'Battle', 'Stock', 'DiveFX']) {
    try { M[n] = eval(n); } catch (e) { M[n] = undefined; }
  }

  // ---- deck layout ---------------------------------------------------------------
  // One [E] drives every spot on the dock via a nearest-within-22 search, so two
  // things closer than that fight and the first one registered always wins. This
  // is the single place that owns who stands where, spaced so nothing collides:
  //
  //   56 house door | 150 Sprout | 190 her stall | 232 ClamNet | 268 the professor
  //   300 workbench | 348..775 farm beds (Farm.PLOT_DEF) | 640 Marlow, between beds
  //
  const STALL_X = 190;
  if (M.NPCs && M.NPCs.LIST) {
    const at = { farmer: 150, prof: 268, angler: 640 };
    for (const n of M.NPCs.LIST) if (at[n.key] !== undefined) n.x = at[n.key];
  }

  // ---- the deck's interaction list ---------------------------------------------
  // Every system that puts something on the dock contributes spots; the world
  // scene's own nearest-spot search then drives them all with one [E].
  const worldSpots = WorldScene.spots.bind(WorldScene);
  WorldScene.spots = function () {
    // people and buildings come BEFORE the beds: on an exact tie the first
    // registered spot wins, and standing on a bed should never hide a neighbour
    let s = worldSpots();
    if (M.NPCs && M.NPCs.spots) s = s.concat(M.NPCs.spots());
    if (M.Stock && M.Stock.spots) s = s.concat(M.Stock.spots());
    if (M.Craft && M.Craft.spots) s = s.concat(M.Craft.spots());
    if (M.Battle && M.Battle.spots) s = s.concat(M.Battle.spots());
    if (M.Farm && M.Farm.spots) s = s.concat(M.Farm.spots());
    return s;
  };

  // ---- the deck itself ----------------------------------------------------------
  // Drawn inside the world's camera transform, behind Otto. Farm installs its own
  // draw hook, so only the systems that do not are called here.
  const worldDraw = WorldScene.draw.bind(WorldScene);
  WorldScene.draw = function (ctx) {
    worldDraw(ctx);
    const cam = this.camX;
    ctx.save();
    ctx.translate(-cam, 0);
    if (M.Stock && M.Stock.draw) M.Stock.draw(ctx, cam);
    if (M.NPCs && M.NPCs.drawWorld) M.NPCs.drawWorld(ctx, cam);
    ctx.restore();
    if (M.Craft && M.Craft.drawBuffs) M.Craft.drawBuffs(ctx);
  };

  // ---- a new day ------------------------------------------------------------------
  // Sleeping is the clock for every simulation: crops grow, animals age and
  // produce, gifts and chats become available again.
  const sleep = HouseScene.sleep.bind(HouseScene);
  let lastRolled = -1;
  HouseScene.sleep = function () { sleep(); };
  const houseUpdate = HouseScene.update.bind(HouseScene);
  HouseScene.update = function (dt) {
    const before = G ? G.day : 0;
    houseUpdate(dt);
    // roll the systems exactly once, on the frame the day actually ticks over
    if (G && G.day !== before && G.day !== lastRolled) {
      lastRolled = G.day;
      if (M.Farm && M.Farm.newDay) M.Farm.newDay();
      if (M.Stock && M.Stock.newDay) M.Stock.newDay();
      if (M.NPCs && M.NPCs.newDay) M.NPCs.newDay();
      if (M.Battle && M.Battle.newDay) M.Battle.newDay();
      Game.save();
    }
  };

  // ---- per-frame ticks not owned by a scene ----------------------------------------
  // Craft uses [1-3] for its shelves and NPCs eat clicks, but the hotbar also
  // claims Digit1..0 — so it only gets the keys when no modal owns them. Hotbar
  // guards itself against Shop and Bench; these two it cannot know about.
  const modalUp = () => (M.Craft && M.Craft.open) || (M.NPCs && M.NPCs.open) ||
                        (M.Stock && M.Stock.open) || (M.Battle && M.Battle.active);

  const gUpdate = Game.globalUpdate.bind(Game);
  Game.globalUpdate = function (dt) {
    gUpdate(dt);
    if (M.Hotbar && M.Hotbar.update && !modalUp()) M.Hotbar.update(dt);
    if (M.Craft && M.Craft.update) M.Craft.update(dt);
    if (M.Stock && M.Stock.update) M.Stock.update(dt);
    if (M.DiveFX && M.DiveFX.update && Game.scene === DiveScene) M.DiveFX.update(dt);
  };

  // ---- HUD stack --------------------------------------------------------------------
  // The hotbar rides with the HUD, so it hides under modals for free.
  const gHUD = Game.drawHUD.bind(Game);
  Game.drawHUD = function (c) {
    gHUD(c);
    if (M.Hotbar && M.Hotbar.draw && Game.scene !== DiveScene && !modalUp()) M.Hotbar.draw(c);
  };

  // ---- modal stack ------------------------------------------------------------------
  // Craft is a third modal alongside Shop and Bench; it has to dismiss on a scene
  // change like they do, and draw in the same slot.
  const gGo = Game.go.bind(Game);
  Game.go = function (scene, arg) {
    if (M.Craft) M.Craft.open = false;
    return gGo(scene, arg);
  };

  // ---- the seed and stock stall ------------------------------------------------------
  // ClamNet sells what you have caught; Sprout's stall is where you BUY the things
  // that start a production chain — seeds, and the animals themselves.
  if (M.Farm || M.Stock) {
    WorldScene.spots = (function (prev) {
      return function () {
        const s = prev.call(this);
        s.push({
          x: STALL_X, label: "Sprout's Stall  (seeds & stock)",
          act: () => { if (typeof Shop !== 'undefined') { Shop.openUI(); Shop.tab = Shop.STALL_TAB || 1; } },
        });
        return s;
      };
    })(WorldScene.spots);
  }

  // ---- what you start the game holding --------------------------------------------------
  // Once per save, not per boot: the flag lives in G so a player who rearranges or
  // spends their starting kit does not get it silently handed back.
  if (M.Hotbar) {
    const wu2 = WorldScene.update.bind(WorldScene);
    WorldScene.update = function (dt) {
      if (G && G.flags && !G.flags.kitted) {
        G.flags.kitted = true;
        M.Hotbar.give('tool', 'scraper', 1);
        M.Hotbar.give('tool', 'pry', 1);
        M.Hotbar.give('tool', 'can', 1);      // the watering can
        M.Hotbar.give('tool', 'hoe', 1);
        Game.save();
      }
      wu2(dt);
    };
  }

  // ---- Craft's material lookup --------------------------------------------------------
  // Craft reads materials through one hook so the integrator decides what counts as
  // "held". Here that is storage plus anything sitting in the hotbar.
  if (M.Craft) {
    M.Craft.have = function (key) {
      let n = 0;
      if (G && G.storage && G.storage[key]) n += G.storage[key];
      if (G && G.crafted && G.crafted[key]) n += G.crafted[key];
      if (M.Hotbar && M.Hotbar.count) n += M.Hotbar.count(key);
      return n;
    };
  }

  // ---- Battle's ammunition -------------------------------------------------------------
  if (M.Battle) {
    M.Battle.ammo = function () {
      let n = 0;
      if (G && G.crafted && G.crafted.cannonball) n += G.crafted.cannonball;
      if (M.Hotbar && M.Hotbar.count) n += M.Hotbar.count('cannonball');
      return n;
    };
    M.Battle.spendAmmo = function (k) {
      if (M.Hotbar && M.Hotbar.take && M.Hotbar.take('cannonball', k)) return true;
      if (G && G.crafted && G.crafted.cannonball >= k) { G.crafted.cannonball -= k; return true; }
      return false;
    };
  }
})();
