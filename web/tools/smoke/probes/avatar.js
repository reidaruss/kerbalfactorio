// DW-34, A-6, A-10 and A-13 on one driven run: does the shipped character art
// actually reach the screen, and does the hitch DW-34 names still exist?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --view=tp \
//     --url=http://127.0.0.1:4182/ --evalfile=tools/smoke/probes/avatar.js \
//     --out=docs/screenshots/RN_avatar_after.png
//
// FOUR PROPERTIES, all asserted as properties (standing rule 11).
//
// 1. DW-34, the dead hold. Every clip's first keyframe is at t = 0 EXACTLY.
//    This is an equality, not a tolerance: `frame / 60` into a float32 makes
//    frame 0 exactly 0.0, so a tolerance would only give the defect somewhere
//    to hide. The broken value is 0.016666668 s, a whole 60 Hz frame, and the
//    probe reports the hitch it implies in millimetres of ground at 4.5 m/s so
//    the number is in the units the player feels it in.
//
// 2. A-6, unreachable clips. Neither rig has an unmapped state. The FP rig used
//    to map jumpStart, jumpLoop, jumpLand and fall to null, so the arms were
//    dead still in the air while four authored clips sat in the file.
//
// 3. A-6, the axe, and GP-506's gate. Chopping a tree plays `Swing_Axe` and
//    puts `crude_axe.glb` in the hand; mining ore plays `Swing_Pickaxe` and
//    swaps `crude_pickaxe.glb` in, but ONLY once a pickaxe is in the pack. The
//    assertion is on the PLAYING CLIP NAME and the HELD FILE, not on a swing
//    counter, because the swing counter was already green while the player
//    mined trees with a pickaxe.
//
// 4. A-10, armour. Each piece is bound to the BODY's skeleton (an object
//    identity, so it is exact) and the AVATAR'S OWN triangle count rises by
//    exactly the pieces' own triangles and returns to its bare value when
//    they come off. The identity is what breaks silently: a SkinnedMesh
//    cloned out of another glTF keeps its OWN skeleton, renders a T-posed
//    shell that never moves, and looks entirely plausible in a still frame of
//    a standing character.
//
//    GP-1055. This used to read `of.stats().draw.triangles`, the GLOBAL scene
//    counter (terrain + foliage + props + every rig, main pass plus three
//    shadow cascades), and difference three timed samples of it. That counts
//    the whole session, not the armour: the unmodified probe measured a
//    bare-minus-removed delta of 4 triangles on one run and 2048 on the next,
//    with nothing to do with armour, a background task spawning something
//    between samples. It now reads `of.avatarTriangles()`
//    (`PlayerRig.triangleCount`), which walks only the body rig's own
//    subtree (`this.group`: loaded scene, held tool, worn armour) and
//    nothing else the scene is doing concurrently can reach. Because that
//    count is exact geometry, not a multi-pass frame counter, the claim also
//    got STRONGER: the delta is asserted equal to `armourTris` (not merely a
//    positive multiple of it), and bare-before equals bare-after exactly.
(async () => {
  const of = window.__of;
  const clips = of.avatarClips();
  const all = [...clips.body, ...clips.fp];

  // --- 1. DW-34.
  const held = all.filter((c) => c.firstKeyT !== 0);
  const run = clips.body.find((c) => c.name === 'Run') ?? null;
  const swing = clips.body.find((c) => c.name === 'Swing_Pickaxe') ?? null;
  const worstHoldS = all.reduce((a, c) => Math.max(a, c.firstKeyT), 0);

  // --- 3. Drive a real swing at a real tree, in the world, through the tick.
  //
  // Hunt rather than assume: sweep the yaw in place, and if nothing is in reach
  // step forward and sweep again. `sweeps` and `aimsSeen` are reported so a null
  // result can never be read as "the axe did not play" when it means "the probe
  // never found a tree", which are opposite conclusions.
  //
  // GP-1040. WHY `tool.ok` WAS RED, and why nobody's name was on it. Three
  // lanes confirmed the red pre-existing and bit-identical against the base
  // tool binaries and each correctly moved on, so the reading was never
  // interpreted. It was the fixture, not the game, and it is the sixth probe
  // caught by the same gate as the GP-890 / GP-995 cluster.
  //
  // GP-506 added a BARE-HAND GATE: gameplay.h `requiresToolFor` refuses
  // CoalSeam, IronOre and CopperOre outright unless a Crude pickaxe is in the
  // pack, and `Interact.step` asks `harvestGate` BEFORE it commits, so a
  // refused press pays no cooldown and starts no clip AT ALL. This probe drove
  // a fresh sandbox player, who carries nothing, at the one IronOre node its
  // sweep could find (published `kindsSeen {0: 18, 3: 1}`, kind 3 being
  // IronOre) and read back precisely what a CORRECT refusal looks like:
  // `playing: 'Idle'`, the axe still in hand from the chop before it,
  // `swingLeft 0`. Nothing was broken. The held-tool state machine and the
  // animation binding were both doing their job; the expectation had stopped
  // being true.
  //
  // Fixed the way GP-995 fixed build.js: stock the pack bare-handed, craft the
  // pickaxe that storyline rung 2 says to craft, THEN mine. Both arms are now
  // driven at the SAME node, which is the part that makes this property mean
  // something. The pickaxe swing on its own could go green with the gate
  // deleted; the refusal that precedes it could go green with the animation
  // dead. Only the pair says "the gate is there AND the tool that opens it
  // reaches the hand".
  const w0 = of.world();
  let chopped = null;
  let mined = null;
  // The refusal arm: the same gated node, pressed BEFORE the pickaxe exists.
  let barehand = null;
  let sweeps = 0;
  let aimsSeen = 0;
  const kindsSeen = {};

  // Stock the pickaxe's bill bare-handed, which is the only path a fresh spawn
  // has (Tree and Rock are the two kinds `requiresToolFor` leaves ungated, and
  // that is deliberate — priced in ore, the pickaxe would be a deadlock).
  //
  // FARTHEST FIRST, capped at three swings a node and never below 12 m: the
  // hunt below has to find a standing tree and a standing ore node, and
  // emptying the one node in reach would trade this fix for a different silent
  // failure. `of.harvest` is `harvestNow`, which grants without the swing, so
  // stocking cannot contaminate the animation readings it exists to enable.
  const carriedOf = (name) =>
    of.game().carried.find((c) => c.name === name)?.count ?? 0;
  const WANT = { Wood: 8, Stone: 12 };
  const ITEM_OF_KIND = { 0: 'Wood', 1: 'Stone' };
  const stock = { swings: 0, skippedNear: 0 };
  for (const n of of.nodes().filter((x) => x.kind === 0 || x.kind === 1).reverse()) {
    const item = ITEM_OF_KIND[n.kind];
    if (carriedOf(item) >= WANT[item] || n.remaining <= 0) continue;
    if (n.distanceM < 12) { stock.skippedNear++; continue; }
    for (let k = 0; k < 3 && carriedOf(item) < WANT[item]; ++k) {
      if (!(of.harvest(n.index)?.ok ?? false)) break;
      stock.swings++;
    }
  }
  const packAfterStock = Object.fromEntries(
    of.game().carried.map((c) => [c.name, c.count]));

  // The gate, measured on the counters rather than inferred from the clip.
  const gate = {
    refusalsBefore: 0, refusalsAfter: 0, swingsBefore: 0, swingsAfter: 0,
    code: 0, pickaxeSwingsBefore: 0, pickaxeSwingsAfter: 0,
    recipe: null, crafted: false, pickaxesHeld: 0,
  };
  const sample = (kind) => {
    const av = of.stats().avatar ?? null;
    return {
      kind, playing: av?.playing ?? '', playingFp: av?.playingFp ?? '',
      holding: av?.holding ?? '', holdingFp: av?.holdingFp ?? '',
      swingKind: av?.swingKind ?? '', swingLeft: av?.swingLeft ?? 0,
    };
  };
  // Sample INSIDE the swing, not after it: the clip clamps when finished and
  // `playing` would still read the right name, so a test taken after the swing
  // cannot tell a played clip from a selected one.
  const press = async () => {
    of.input.tape([{ hold: 6, keys: ['Mouse0'] }, { hold: 30, keys: [] }]);
    await of.run(0.15);
  };

  for (let step = 0; step < 40 && (chopped === null || mined === null); ++step) {
    for (let a = 0; a < 24 && (chopped === null || mined === null); ++a) {
      of.look(a * 15, -12);
      await of.run(0.06);
      sweeps++;
      const t = of.game()?.interact?.target ?? null;
      if (t === null || t.empty) continue;
      aimsSeen++;
      kindsSeen[t.kind] = (kindsSeen[t.kind] ?? 0) + 1;
      // Written out per arm rather than as `(t.kind === 0) === (chopped !== null)`,
      // which was the old form and quietly meant something else: with `chopped`
      // still null it skipped EVERY non-tree, so the mine arm could only ever
      // be reached after a tree had been felled and a gated node sighted first
      // would be thrown away and possibly never seen again.
      if (t.kind === 0 ? chopped !== null : mined !== null) continue;

      if (t.kind === 0) {
        await press();
        chopped = sample(t.kind);
        await of.run(0.8);
        continue;
      }

      // A gated node. ARM ONE: press with nothing in the pack. GP-506 says
      // this must be refused before the swing commits, so the counters must
      // show a refusal, `swings` must not move, and no swing clip may start.
      const i0 = of.game().interact;
      gate.refusalsBefore = i0.refusals;
      gate.swingsBefore = i0.swings;
      gate.pickaxeSwingsBefore = i0.swingKinds.pickaxe;
      await press();
      barehand = sample(t.kind);
      const i1 = of.game().interact;
      gate.refusalsAfter = i1.refusals;
      gate.swingsAfter = i1.swings;
      gate.code = i1.lastRefusal?.code ?? 0;
      await of.run(0.6);

      // ARM TWO: craft the pickaxe out of what bare hands gathered, standing
      // at the same node, and press again. The recipe is found BY NAME out of
      // the shipped list, so a reordered `handRecipes()` cannot silently craft
      // something else the way a hard-coded index 0 would.
      const ri = of.game().recipes.findIndex((r) => r.name === 'Crude pickaxe');
      gate.recipe = ri >= 0 ? of.game().recipes[ri] : null;
      gate.crafted = ri >= 0 && of.craft(ri);
      gate.pickaxesHeld = carriedOf('Crude pickaxe');
      await of.run(0.2);
      await press();
      mined = sample(t.kind);
      gate.pickaxeSwingsAfter = of.game().interact.swingKinds.pickaxe;
      await of.run(0.8);
    }
    if (chopped === null || mined === null) {
      of.look(step * 47, -6);
      of.input.tape([{ hold: 140, keys: ['KeyW'] }, { hold: 10, keys: [] }]);
      await of.run(2.5);
    }
  }

  // --- 4. Armour, measured on the AVATAR'S OWN subtree (GP-1055), not on
  // `of.stats().draw.triangles`, which is the whole scene.
  await of.run(0.3);
  const triBare = of.avatarTriangles();
  const wornOn = await of.armourSet(true);
  await of.run(0.3);
  const triArmed = of.avatarTriangles();
  const drift = of.armourDrift();
  const armourTris = drift.reduce((a, d) => a + d.triangles, 0);
  const wornOff = await of.armourSet(false);
  await of.run(0.3);
  const triOff = of.avatarTriangles();

  const s = of.stats();
  const w = of.world();
  return {
    avatarReport: s.avatar,
    valid: all.length > 0 && w.tick > w0.tick && s.avatar !== null,
    drove: {
      clipsSeen: all.length, bodyClips: clips.body.length, fpClips: clips.fp.length,
      ticksAdvanced: w.tick - w0.tick,
    },
    // --- PROPERTY 1: no clip opens with a dead hold.
    deadHold: {
      clipsWithHold: held.length,
      worstHoldMs: +(worstHoldS * 1000).toFixed(4),
      // What that hold is worth on the ground, which is the unit it is felt in.
      runHitchCm: +(worstHoldS * 4.5 * 100).toFixed(2),
      runDurationS: run && +run.duration.toFixed(9),
      swingDurationS: swing && +swing.duration.toFixed(9),
      offenders: held.slice(0, 6).map((c) => `${c.name}@${c.firstKeyT}`),
      ok: held.length === 0,
    },
    // --- PROPERTY 2: nothing shipped is unreachable through the state map.
    unmapped: {
      body: clips.bodyUnmapped, fp: clips.fpUnmapped,
      ok: clips.bodyUnmapped.length === 0 && clips.fpUnmapped.length === 0,
    },
    // --- PROPERTY 3: the right tool for the right node, and the gate that
    // decides whether the node may be swung at in the first place.
    tool: {
      chopped, barehand, mined, sweeps, aimsSeen, kindsSeen,
      stock, packAfterStock, gate,
      // Split so a red says WHICH half, rather than making the next reader
      // re-derive it from six fields. That is the whole reason this was
      // uninterpreted for three lanes.
      choppedOk: chopped !== null && chopped.playing === 'Swing_Axe'
        && chopped.playingFp === 'FP_Swing_Axe'
        && chopped.holding.endsWith('crude_axe.glb')
        && chopped.holdingFp.endsWith('crude_axe.glb')
        && chopped.swingLeft > 0,
      // The control. A bare-hand press at a gated node buys a refusal and
      // NOTHING else: no swing counted, no clip started, the hand unchanged.
      gateOk: barehand !== null
        && gate.refusalsAfter > gate.refusalsBefore
        && gate.code === 1
        && gate.swingsAfter === gate.swingsBefore
        && gate.pickaxeSwingsBefore === 0
        && barehand.playing !== 'Swing_Pickaxe'
        && barehand.playingFp !== 'FP_Swing_Pickaxe'
        && barehand.swingLeft === 0,
      craftOk: gate.recipe !== null && gate.recipe.craftable === true
        && gate.crafted === true && gate.pickaxesHeld >= 1,
      minedOk: mined !== null && mined.playing === 'Swing_Pickaxe'
        && mined.playingFp === 'FP_Swing_Pickaxe'
        && mined.holding.endsWith('crude_pickaxe.glb')
        && mined.holdingFp.endsWith('crude_pickaxe.glb')
        && mined.swingKind === 'pickaxe'
        && mined.swingLeft > 0
        && gate.pickaxeSwingsAfter > gate.pickaxeSwingsBefore,
      ok: chopped !== null && chopped.playing === 'Swing_Axe'
        && chopped.playingFp === 'FP_Swing_Axe'
        && chopped.holding.endsWith('crude_axe.glb')
        && chopped.holdingFp.endsWith('crude_axe.glb')
        && chopped.swingLeft > 0
        && barehand !== null
        && gate.refusalsAfter > gate.refusalsBefore
        && gate.code === 1
        && gate.swingsAfter === gate.swingsBefore
        && gate.pickaxeSwingsBefore === 0
        && barehand.playing !== 'Swing_Pickaxe'
        && barehand.playingFp !== 'FP_Swing_Pickaxe'
        && barehand.swingLeft === 0
        && gate.recipe !== null && gate.recipe.craftable === true
        && gate.crafted === true && gate.pickaxesHeld >= 1
        && mined !== null && mined.playing === 'Swing_Pickaxe'
        && mined.playingFp === 'FP_Swing_Pickaxe'
        && mined.holding.endsWith('crude_pickaxe.glb')
        && mined.holdingFp.endsWith('crude_pickaxe.glb')
        && mined.swingKind === 'pickaxe'
        && mined.swingLeft > 0
        && gate.pickaxeSwingsAfter > gate.pickaxeSwingsBefore,
    },
    // --- PROPERTY 4: armour is on the body's own skeleton and its geometry
    // is actually attached to (and detached from) the avatar's own subtree.
    armour: {
      worn: wornOn, wornAfterRemove: wornOff, drift,
      trianglesBare: triBare, trianglesArmed: triArmed, trianglesAfterRemove: triOff,
      armourTriangles: armourTris,
      deltaOn: triArmed - triBare, deltaOff: triArmed - triOff,
      // `avatarTriangles()` is an exact walk of the rig's own geometry, not a
      // multi-pass frame counter, so there is no "number of passes" to
      // recover any more (GP-1055): the delta IS the armour's own triangle
      // count, once, and bare-before must equal bare-after exactly, because
      // nothing outside the rig's subtree can move this number between the
      // three samples.
      ok: wornOn.length === 4 && wornOff.length === 0
        && drift.length === 4 && drift.every((d) => d.sameSkeleton)
        && drift.every((d) => d.bones === d.bodyBones && d.bones > 0)
        && armourTris > 0
        && triArmed - triBare === armourTris
        && triOff === triBare,
    },
    cost: { drawCalls: s.draw.calls, triangles: s.draw.triangles, frameMs: s.frameMs },
  };
})()
