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
// 3. A-6, the axe. Chopping a tree plays `Swing_Axe` and puts `crude_axe.glb`
//    in the hand. The assertion is on the PLAYING CLIP NAME and the HELD FILE,
//    not on a swing counter, because the swing counter was already green while
//    the player mined trees with a pickaxe.
//
// 4. A-10, armour. Each piece is bound to the BODY's skeleton (an object
//    identity, so it is exact) and the frame's triangle count rises by exactly
//    the pieces' own triangles and returns when they come off. The identity is
//    what breaks silently: a SkinnedMesh cloned out of another glTF keeps its
//    OWN skeleton, renders a T-posed shell that never moves, and looks entirely
//    plausible in a still frame of a standing character.
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
  const w0 = of.world();
  let chopped = null;
  let mined = null;
  let sweeps = 0;
  let aimsSeen = 0;
  const kindsSeen = {};
  for (let step = 0; step < 40 && (chopped === null || mined === null); ++step) {
    for (let a = 0; a < 24 && (chopped === null || mined === null); ++a) {
      of.look(a * 15, -12);
      await of.run(0.06);
      sweeps++;
      const t = of.game()?.interact?.target ?? null;
      if (t === null || t.empty) continue;
      aimsSeen++;
      kindsSeen[t.kind] = (kindsSeen[t.kind] ?? 0) + 1;
      if ((t.kind === 0) === (chopped !== null)) continue;
      of.input.tape([{ hold: 6, keys: ['Mouse0'] }, { hold: 30, keys: [] }]);
      // Sample INSIDE the swing, not after it: the clip clamps when finished
      // and `playing` would still read the right name, so a test taken after
      // the swing cannot tell a played clip from a selected one.
      await of.run(0.15);
      const av = of.stats().avatar ?? null;
      const seen = {
        kind: t.kind, playing: av?.playing ?? '', playingFp: av?.playingFp ?? '',
        holding: av?.holding ?? '', holdingFp: av?.holdingFp ?? '',
        swingKind: av?.swingKind ?? '', swingLeft: av?.swingLeft ?? 0,
      };
      if (t.kind === 0) chopped = seen; else mined = seen;
      await of.run(0.8);
    }
    if (chopped === null || mined === null) {
      of.look(step * 47, -6);
      of.input.tape([{ hold: 140, keys: ['KeyW'] }, { hold: 10, keys: [] }]);
      await of.run(2.5);
    }
  }

  // --- 4. Armour, measured on the drawn frame.
  await of.run(0.3);
  const triBare = of.stats().draw.triangles;
  const wornOn = await of.armourSet(true);
  await of.run(0.3);
  const triArmed = of.stats().draw.triangles;
  const drift = of.armourDrift();
  const armourTris = drift.reduce((a, d) => a + d.triangles, 0);
  const wornOff = await of.armourSet(false);
  await of.run(0.3);
  const triOff = of.stats().draw.triangles;

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
    // --- PROPERTY 3: the right tool for the right node.
    tool: {
      chopped, mined, sweeps, aimsSeen, kindsSeen,
      ok: chopped !== null && chopped.playing === 'Swing_Axe'
        && chopped.playingFp === 'FP_Swing_Axe'
        && chopped.holding.endsWith('crude_axe.glb')
        && chopped.holdingFp.endsWith('crude_axe.glb')
        && chopped.swingLeft > 0
        && mined !== null && mined.playing === 'Swing_Pickaxe'
        && mined.holding.endsWith('crude_pickaxe.glb'),
    },
    // --- PROPERTY 4: armour is on the body's own skeleton and on the screen.
    armour: {
      worn: wornOn, wornAfterRemove: wornOff, drift,
      trianglesBare: triBare, trianglesArmed: triArmed, trianglesAfterRemove: triOff,
      armourTriangles: armourTris,
      deltaOn: triArmed - triBare, deltaOff: triArmed - triOff,
      passes: armourTris > 0 ? (triArmed - triBare) / armourTris : 0,
      // The frame counter sums the MAIN pass and the three shadow cascades, so
      // the delta is the armour's triangles times the number of passes it is
      // drawn in. Asserting an exact multiple plus exact reversibility is
      // stronger than asserting a constant 4: it holds with `?shadows=0` too,
      // and it fails on any piece that is drawn in some passes and not others.
      ok: wornOn.length === 4 && wornOff.length === 0
        && drift.length === 4 && drift.every((d) => d.sameSkeleton)
        && drift.every((d) => d.bones === d.bodyBones && d.bones > 0)
        && armourTris > 0
        && (triArmed - triBare) % armourTris === 0
        && (triArmed - triBare) / armourTris >= 1
        && triArmed - triBare === triArmed - triOff,
    },
    cost: { drawCalls: s.draw.calls, triangles: s.draw.triangles, frameMs: s.frameMs },
  };
})()
