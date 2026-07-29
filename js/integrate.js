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
  for (const n of ['Farm', 'Hotbar', 'NPCs', 'Craft', 'Battle', 'Stock', 'DiveFX',
                 'Ocean', 'Mining', 'Inv', 'Skills', 'Tame', 'Hood']) {
    try { M[n] = eval(n); } catch (e) { M[n] = undefined; }
  }

  // ---- deck layout ---------------------------------------------------------------
  // One [E] drives every spot on the dock via a nearest-within-22 search, so two
  // things closer than that fight and the first one registered always wins. This
  // is the single place that owns who stands where, spaced so nothing collides:
  //
  // The dock is now 610 long instead of 900, so the far content has to come in
  // with it. Both Farm and Stock publish their layout tables, so this is the one
  // place that decides where everything on the planks lives:
  //
  //   30 piling dive | 56 house | 82 Marlow | 110 jump in | 150 Sprout
  //   190 stall | 232 ClamNet | 268 the elder | 300 workbench
  //   340,370,400,460,490 farm beds | 520 pen 1 | 550 crafting bench | 578 pen 2
  //   endX = 340 + bridge*90
  //
  // Every pair is >= 22 apart, which is the radius the world's single [E] search
  // uses — anything closer and two things fight over the same keypress.
  const STALL_X = 190;
  if (M.NPCs && M.NPCs.LIST) {
    const at = { farmer: 150, prof: 268, angler: 82 };
    for (const n of M.NPCs.LIST) if (at[n.key] !== undefined) n.x = at[n.key];
  }
  if (M.Farm && M.Farm.PLOT_DEF) {
    // three beds per bridge tier, all inside that tier's walk limit
    const beds = [
      { x: 340, b: 1 }, { x: 370, b: 1 }, { x: 400, b: 1 },
      { x: 460, b: 2 }, { x: 490, b: 2 },
    ];
    M.Farm.PLOT_DEF.length = 0;
    for (const b of beds) M.Farm.PLOT_DEF.push(b);
  }
  if (M.Stock && M.Stock.PEN_DEF) {
    const pens = [{ x: 520, sx: 520, b: 3 }, { x: 578, sx: 578, b: 3 }];
    M.Stock.PEN_DEF.length = 0;
    for (const p of pens) M.Stock.PEN_DEF.push(p);
    if (M.Stock.MAX_PENS > pens.length) M.Stock.MAX_PENS = pens.length;
  }
  if (M.Battle) M.Battle.CANNON_X = 268;   // the fight happens amidships now
  // Craft plants its bench at 434 by default, which lands on a farm bed now.
  // Marlow goes to the near end (he is a fisherman; the ladder end suits him)
  // and the bench sits between the two pens.
  if (M.Craft && M.Craft.SITES && M.Craft.SITES.bench) M.Craft.SITES.bench.x = 550;

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
                        (M.Stock && M.Stock.open) || (M.Battle && M.Battle.active) ||
                        (M.Inv && M.Inv.open) || (M.Skills && M.Skills.open) ||
                        (M.Tame && M.Tame.open);

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
    if (M.Inv) M.Inv.open = false;
    if (M.Tame) M.Tame.open = false;
    if (M.Skills) M.Skills.open = false;
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

  // ---- the open ocean, and everything that lives in it ---------------------------------
  // Ocean owns movement and the layers; Mining owns nodes and loot; Tame owns the
  // wildlife; Hood owns the neighbours' homes. None of them knows about the
  // others, so the scene calls belong here.
  //
  // Ocean and Mining use DIFFERENT chunk grids (512x320 vs 480x280), so the
  // chunk indices one produces are meaningless to the other. Mining's chunks are
  // therefore driven straight off the visible rect in Mining's own units.
  if (M.Ocean) {
    const O = M.Ocean;

    const oEnter = O.enter.bind(O);
    O.enter = function (arg) {
      oEnter(arg);
      const seed = (G && G.ocean && G.ocean.seed) | 0;
      if (M.Mining && M.Mining.reset) M.Mining.reset(seed);
      if (M.Tame && M.Tame.reset) M.Tame.reset(seed);
      if (M.Hood && M.Hood.reset) M.Hood.reset(seed);
    };

    const oUpdate = O.update.bind(O);
    O.update = function (dt) {
      oUpdate(dt);
      const seed = (G && G.ocean && G.ocean.seed) | 0;
      if (M.Mining) {
        // Mining owns its own chunk grid (480x280, not the ocean's 512x320) and
        // ships ensureAround for exactly this — it derives the indices with its
        // own chunkXAt/chunkYAt and clamps the rows above the waterline. Rolling
        // that by hand here produced indices from the wrong origin and spawned
        // nothing at all.
        if (M.Mining.ensureAround) M.Mining.ensureAround(O.camX, O.camY, seed);
        if (M.Mining.update) M.Mining.update(dt, O.px, O.py, { x: O.camX, y: O.camY });
      }
      if (M.Tame && M.Tame.update) M.Tame.update(dt, O.px, O.py);
      if (M.Hood && M.Hood.update) M.Hood.update(dt);
    };

    // Nodes, loot and animals belong in world space, between the mid layer and
    // Otto — so they sit behind him but in front of the scenery.
    const oProps = O._drawProps.bind(O);
    O._drawProps = function (ctx, t, front) {
      oProps(ctx, t, front);
      if (front) return;                 // the back pass only, once per frame
      ctx.save();
      ctx.translate(-Math.round(this.camX * DPX) / DPX, -Math.round(this.camY * DPX) / DPX);
      if (M.Hood && M.Hood.draw) M.Hood.draw(ctx, this.camX, this.camY);
      if (M.Mining && M.Mining.draw) M.Mining.draw(ctx, this.camX, this.camY);
      if (M.Tame && M.Tame.draw) M.Tame.draw(ctx, this.camX, this.camY);
      ctx.restore();
    };

    // Loot and animal produce both go into the new bag when there is one, and fall
    // back to flat storage so nothing is silently dropped on the seabed.
    const stow = function (key, n) {
      if (M.Inv && M.Inv.add) return M.Inv.add(key, n);
      if (G && G.storage) { G.storage[key] = (G.storage[key] || 0) + n; return 0; }
      return n;
    };
    if (M.Mining) M.Mining.give = stow;
    if (M.Tame && M.Tame.give) M.Tame.give = stow;
  }

  // ---- the tamed animals that followed you home ----------------------------------------
  // They live on the dock, so their care verbs join the deck's spot list, and they
  // age and produce on the same nightly clock as everything else.
  if (M.Tame) {
    // NOTE: Tame and Inv both register their own dock spots in their install(),
    // so they must NOT be concatenated again here — doing so listed the tide pool
    // twice and stacked three spots on x=430.
    if (M.Tame.drawWorld) {
      const wd2 = WorldScene.draw.bind(WorldScene);
      WorldScene.draw = function (ctx) {
        wd2(ctx);
        ctx.save();
        ctx.translate(-this.camX, 0);
        M.Tame.drawWorld(ctx, this.camX);
        ctx.restore();
      };
    }
    if (M.Tame.newDay) {
      const hu3 = HouseScene.update.bind(HouseScene);
      let rolled = -1;
      HouseScene.update = function (dt) {
        const before = G ? G.day : 0;
        hu3(dt);
        if (G && G.day !== before && G.day !== rolled) { rolled = G.day; M.Tame.newDay(); }
      };
    }
  }

  // ---- skills: who feeds XP in, and who reads the buffs back out -----------------------
  // Skills.buff() is total — an unknown name returns the identity value — so every
  // reader below can multiply blindly without checking whether the module loaded.
  if (M.Skills) {
    const S = M.Skills;
    const gain = (skill, n) => S.gain(skill, n);
    if (M.Mining) M.Mining.xp = gain;
    if (M.Tame) M.Tame.xp = gain;
    if (M.Inv) M.Inv.levelOf = (skill) => S.level(skill);

    // Clamming XP and the shell-value buff: popping a shell loose is the whole
    // skill, so that is where the XP is paid.
    if (typeof DiveScene !== 'undefined' && DiveScene.popNode) {
      const pop = DiveScene.popNode.bind(DiveScene);
      DiveScene.popNode = function (n) {
        pop(n);
        gain('clamming', n && n.kind === 'barnacle' ? 4 : 11);
      };
    }
    if (typeof Shop !== 'undefined' && Shop.sellKeys) {
      const sell = Shop.sellKeys.bind(Shop);
      Shop.sellKeys = function (keys) {
        const before = G.pendingCrate ? G.pendingCrate.value : 0;
        sell(keys);
        // pay the buff on the crate the sale just created or grew
        const mul = S.buff('shellValue');
        if (mul !== 1 && G.pendingCrate) {
          const added = G.pendingCrate.value - before;
          if (added > 0) G.pendingCrate.value = Math.round(before + added * mul);
        }
      };
    }
    // Farming XP, and the buff that shortens a crop's watering schedule.
    if (M.Farm) {
      if (M.Farm.harvest) {
        const harv = M.Farm.harvest.bind(M.Farm);
        M.Farm.harvest = function (i) { const r = harv(i); if (r) gain('farming', 9); return r; };
      }
      if (M.Farm.plant) {
        const plant = M.Farm.plant.bind(M.Farm);
        M.Farm.plant = function (i, k) { const r = plant(i, k); if (r) gain('farming', 3); return r; };
      }
    }
    // Taming XP for the care verbs on penned animals.
    if (M.Stock) {
      for (const verb of ['feed', 'pet', 'collect']) {
        if (!M.Stock[verb]) continue;
        const fn = M.Stock[verb].bind(M.Stock);
        const xp = verb === 'collect' ? 6 : 2;
        M.Stock[verb] = function (i) { const r = fn(i); if (r) gain('taming', xp); return r; };
      }
    }
    // Fighting XP on a landed cannon shot.
    if (M.Battle && M.Battle.onHit) {
      const oh = M.Battle.onHit;
      M.Battle.onHit = function () { const r = oh.apply(M.Battle, arguments); gain('fighting', 5); return r; };
    }
    // An extra heart is the fighting tree's early prize, so it has to reach G.
    const extra = S.buff('maxHearts');
    if (extra > 0 && G && G.maxHearts < 3 + extra) {
      G.maxHearts = 3 + extra;
      if (G.hearts > G.maxHearts) G.hearts = G.maxHearts;
    }
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
