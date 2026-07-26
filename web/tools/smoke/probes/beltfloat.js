// Does a machine placed on terraformed ground sit on the ground that is THERE?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//        --evalfile=tools/smoke/probes/beltfloat.js \
//        --out=docs/screenshots/RN_beltfloat.png
//
// WRITTEN BY THE RENDERING LANE AS A MEASUREMENT, kept by the gameplay lane as a
// REGRESSION GUARD once the three call sites it names were fixed (GP-28). The
// numbers it reported when it was written are in its `valid` now, inverted: what
// it proved was broken it must now prove is not.
//
// `_of_surface_radius(body, edits, dir)` takes the voxel edit set as its SECOND
// argument. `game/Grid.ts` snapToGround, `game/Machines.ts` and `game/BuildMode`
// all passed 0 there, which means "the pristine procedural world", while
// `game/OrePatches.ts` and `game/Structures.ts` passed the real handle. So on
// ground the player had cut or filled, half the build system read the surface as
// it was before they touched it. The measurement is the gap in metres between
// where a ghost lands and where the ground now is.
//
// TWO NUMBERS, because there were two halves. The ghost's HEIGHT over the edited
// surface was closed by the metric site grid, which routes its anchor through
// the one call site that was always right. The shallow-aim TARGETING error was
// not, and needed the march itself moved onto the live surface: it was 1.807 m
// and is now bounded by the grid snap, which is half a 1 m cell diagonal.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
  };

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.build === undefined) return { valid: false, why: 'no build mode (gameplay off?)' };
  await of.wipe();
  of.forgetTunnels();
  const bodyR = w0.bodyRadiusM;
  const tick0 = of.world().tick;

  // Dig a trench under the feet, which is the cheapest edit that moves the
  // surface by metres and is what a player does before laying a line into a cut.
  of.look(A.yawDeg ?? 0, -80);
  await settle(0.3);
  for (let k = 0; k < (A.strikes ?? 8); ++k) { of.dig(); await settle(0.08); }
  await settle(0.5);
  // ...and level a pad beside it, so the shallow-aim test below has metres of
  // moved ground to cross rather than a hole at the player's feet.
  of.look(A.yawDeg ?? 0, -55);
  await settle(0.2);
  await hold(1.4, ['KeyQ']);
  await settle(1.2);

  const feet = of.world().player.feet;
  const u = unit(feet);
  const s = of.surface(u[0], u[1], u[2]);
  log.push(`under the feet: base ${s.baseM.toFixed(2)} m, edited surface `
    + `${s.surfaceM.toFixed(2)} m, lowering ${s.loweringM.toFixed(2)} m`);

  // Put a BELT in hand and aim at the cut. The ghost reports its own snapped
  // position, so this reads what the build system decided, not what we think it
  // should have decided.
  of.build(A.menu ?? 2);
  await settle(0.3);
  let ghost = null;
  for (const pitch of [-70, -80, -60, -50, -40]) {
    of.look(A.yawDeg ?? 0, pitch);
    await settle(0.12);
    const b = of.build();
    if (b !== null && b.ghost !== null && b.ghost !== undefined) { ghost = b.ghost; break; }
  }
  of.build(0);

  let ghostAboveGroundM = null;
  let ghostVsPristineM = null;
  if (ghost !== null && Array.isArray(ghost.pos)) {
    const gu = unit(ghost.pos);
    const gr = Math.hypot(ghost.pos[0], ghost.pos[1], ghost.pos[2]);
    const gs = of.surface(gu[0], gu[1], gu[2]);
    ghostAboveGroundM = +(gr - (bodyR + gs.surfaceM)).toFixed(3);
    ghostVsPristineM = +(gr - (bodyR + gs.baseM)).toFixed(3);
    log.push(`ghost sits ${ghostAboveGroundM} m above the EDITED surface and `
      + `${ghostVsPristineM} m from the PRISTINE one`);
  }

  // SHALLOW AIM, which is how a line is actually laid: looking across the
  // ground rather than down at your own feet. BuildMode marches its aim ray
  // against `_of_surface_radius(body, 0, ...)`, so the further the ray has to
  // travel the further ahead of, or behind, the real ground it can stop.
  let shallow = null;
  of.build(A.menu ?? 2);
  await settle(0.2);
  for (const pitch of [-25, -30, -20, -35]) {
    of.look(A.yawDeg ?? 0, pitch);
    await settle(0.15);
    const b = of.build();
    if (b === null || b.ghost === null || b.ghost === undefined) continue;
    const ray = of.world().player.aim;
    const o = ray.origin, d = ray.dir;
    let hit = null;
    for (let t = 0.05; t <= 20; t += 0.05) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      const r = Math.hypot(x, y, z);
      if (r <= bodyR + of.surface(x / r, y / r, z / r).surfaceM) { hit = [x, y, z, t]; break; }
    }
    if (hit === null) continue;
    const gp = b.ghost.pos;
    shallow = { pitch, aimGroundDistM: +hit[3].toFixed(2),
      ghostFromAimPointM: +Math.hypot(gp[0] - hit[0], gp[1] - hit[1], gp[2] - hit[2]).toFixed(3) };
    break;
  }
  of.build(0);
  if (shallow !== null) {
    log.push(`shallow aim ${shallow.pitch} deg: the ground is ${shallow.aimGroundDistM} m `
      + `away and the ghost landed ${shallow.ghostFromAimPointM} m from it`);
  }

  // Half the diagonal of a 1 m cell. A snapped ghost CANNOT be closer to an
  // arbitrary aim point than this, so it is the floor the targeting error is
  // measured against rather than zero.
  const SNAP_BOUND_M = Math.SQRT2 * 0.5 + 1e-3;
  return {
    // The guard, and it asserts the LOWERING happened first: a probe that dug
    // nothing would satisfy every line below it for the wrong reason.
    valid: of.world().tick - tick0 > 300 && ghost !== null
      && Math.abs(s.loweringM) > 1
      && ghostAboveGroundM !== null && Math.abs(ghostAboveGroundM) <= 0.2
      && ghostVsPristineM !== null && Math.abs(ghostVsPristineM) > 1
      && shallow !== null && shallow.ghostFromAimPointM <= SNAP_BOUND_M,
    snapBoundM: +SNAP_BOUND_M.toFixed(3),
    shallow,
    // True when the ghost tracks the ground the player actually made.
    ghostFollowsTheEditedSurface: ghostAboveGroundM !== null
      && Math.abs(ghostAboveGroundM) <= (A.tolM ?? 0.2),
    // True when it is instead reading the world as it was before the dig, which
    // is what passing edits = 0 means.
    ghostReadsThePristineWorld: ghostVsPristineM !== null
      && Math.abs(ghostVsPristineM) <= (A.tolM ?? 0.2),
    loweringM: +s.loweringM.toFixed(3),
    ghostAboveGroundM,
    ghostVsPristineM,
    ghost,
    ticks: of.world().tick - tick0,
    log,
  };
})()
