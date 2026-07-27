// DW-17, the last gap: a tunnel that is still there after a reload.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnelpersist.js \
//        --out=docs/screenshots/W7_tunnel_persisted.png
//
// THE ASSERTION IS ABOUT THE ROCK, NOT ABOUT THE CALL. A save that "worked"
// because the live world still held the answer is the classic false pass, so
// this drives dig -> save -> PUT THE ROCK BACK -> load, and the middle step is
// checked as hard as the last one: every sample point taken inside the tunnel
// must read SOLID once the edits are gone and AIR again once they are back.
// `of.solidAt` goes through the one surface authority, so it is the same
// question the walker and the mesher ask.
//
// WHY THERE IS NO TICK BETWEEN FORGET AND LOAD. `Gameplay.create` populates the
// world and then applies the diff over it before the first tick runs; a page
// that reloaded is never in the intermediate state for a frame. Stepping the sim
// there would only measure what the walker does to a player embedded in restored
// rock, which is a different question and not this one's.
//
// AND THEN IT WALKS IT. The final phase never touches the dig key, so every
// metre it covers is a metre of tunnel that came out of IndexedDB.
//
// TWO HALVES, AND ONE OF THEM WAS DEAD FOR WEEKS. The solidity half asks /core
// what is rock; the geometry half asks the near mesher what it is drawing. The
// geometry half read `voxels().mesh.faces`, a field WG-24 deleted when the
// greedy cube mesher became surface nets, so all three of its readings were
// `undefined` and every comparison between them was vacuous. It is now
// `triangles`/`vertices`/`bricks` read through `mustNum`, which throws on a
// field the client does not publish. See the note at the acceptance.
(async () => {
  const of = window.__of;
  const ramp = OF_ARGS.rampStrikes ?? 6;
  const strikes = OF_ARGS.strikes ?? 12;
  const yaw = OF_ARGS.yawDeg ?? 0;
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const eye = () => {
    const w = of.world(); const e = w.eyeRel; const o = w.origin;
    return [e[0] + o.x, e[1] + o.y, e[2] + o.z];
  };
  // Solidity at every recorded interior point, as a string so a single compare
  // can say "all air" or "all rock" without hiding a mixed answer.
  const solidity = (pts) => pts.map((p) => (of.solidAt(p[0], p[1], p[2]) ? 'R' : '.')).join('');

  await settle(1.2);
  if (of.voxels() === null) return { valid: false, why: 'no character, nothing can dig' };
  await of.wipe();
  of.forgetTunnels();
  const t0 = of.world();

  // --- 1. dig a tunnel ------------------------------------------------------
  let landed = 0;
  for (let i = 0; i < ramp; ++i) {
    of.look(yaw, -85);
    const r = of.dig();
    if (r !== null && r.cells > 0) landed++;
    await settle(0.3);
  }
  for (let i = 0; i < strikes; ++i) {
    of.look(yaw, OF_ARGS.pitchDeg ?? -12);
    const r = of.dig();
    if (r !== null && r.cells > 0) landed++;
    await of.run(0.2, 60);
    await hold(OF_ARGS.stepSecs ?? 0.22, ['KeyW']);
  }
  await settle(0.8);

  // Sample points INSIDE the passage: the eye, and a metre below it, at several
  // places along the walk. Body-frame absolutes, so they mean the same thing
  // after the origin rebases.
  const inside = [];
  const mark = () => {
    const p = eye();
    const r = Math.hypot(p[0], p[1], p[2]);
    inside.push(p);
    inside.push([p[0] * (1 - 0.9 / r), p[1] * (1 - 0.9 / r), p[2] * (1 - 0.9 / r)]);
  };
  mark();
  for (let i = 0; i < 3; ++i) { await hold(0.35, ['KeyS']); mark(); }
  await settle(0.4);

  const dug = of.voxels();
  // COPIED, not held. of.voxels().mesh is the LIVE stats object by reference, so
  // keeping it and comparing later compares a reading with itself: the first
  // version of this probe "proved" the face count was unchanged three times
  // over because all three readings were the same object.
  //
  // AND READ THROUGH `mustNum`, WHICH IS THE SECOND HALF OF THE SAME LESSON.
  // Copying the value is not enough if the NAME is dead. This probe read
  // `mesh.faces` from WG-24, when the greedy cube mesher became surface nets and
  // `faces`/`quads`/`mergeRatio` stopped being published, until 2026-07-27. All
  // three readings were `undefined`.
  //
  // BE PRECISE ABOUT WHICH WAY IT BROKE, because the two ways cost different
  // things. `undefined < undefined` and `undefined >= undefined` are both FALSE,
  // so the geometry terms did not turn into a silent pass: they nailed
  // `tunnelSurvivesReload` to false and it could not go green however well the
  // tunnel survived. Measured against the pre-fix file on this world: false, with
  // a `meshFaces` block that JSON.stringify emitted as `{}` because it drops
  // undefined values. That is a stuck verdict, and a stuck verdict is worth
  // exactly as little as a vacuous one: it carries no information about the
  // system either way, and it is WORSE to live with, because a check that is
  // always red trains everyone to explain it away. This one was: the probe was
  // already known red for `stillWalkable`, so a second red term next to it read
  // as the same known problem, and the check that proves a dug tunnel survives a
  // reload sat dead for weeks in plain sight. `mustNum` throws on a field the
  // client does not publish and names the fields it does, so neither polarity is
  // reachable any more.
  //
  // The published counter is TRIANGLES, not faces: surface nets emits a triangle
  // soup with a real gradient normal per vertex, so there is no quad and nothing
  // to merge (VoxelMeshStats in src/world/VoxelMesh.ts).
  const dugCells = dug.removedCells;
  const dugTris = mustNum(dug.mesh, 'triangles', 'voxels().mesh');
  const dugVerts = mustNum(dug.mesh, 'vertices', 'voxels().mesh');
  const dugBricks = mustNum(dug.mesh, 'bricks', 'voxels().mesh');
  const dugSolidity = solidity(inside);
  log.push(`dug ${dug.removedCells} cells over ${landed} strikes, `
    + `${inside.length} interior samples read ${dugSolidity}`);

  // --- 2. save --------------------------------------------------------------
  const written = await of.save();
  log.push(`saved ${JSON.stringify(written)}`);
  if (written === null) return { fail: 'the slot could not be written', log, inside };

  // --- 3. PUT THE ROCK BACK -------------------------------------------------
  const forgot = of.forgetTunnels();
  const goneMesh = of.voxels().mesh;
  const goneTris = mustNum(goneMesh, 'triangles', 'voxels().mesh');
  const goneVerts = mustNum(goneMesh, 'vertices', 'voxels().mesh');
  const goneBricks = mustNum(goneMesh, 'bricks', 'voxels().mesh');
  const goneSolidity = solidity(inside);
  log.push(`forgot: ${forgot.removedCells} cells left, ${goneTris} mesh triangles `
    + `over ${goneBricks} bricks, samples now ${goneSolidity}`);

  // --- 4. load --------------------------------------------------------------
  const ledger = await of.load();
  const backVox = of.voxels();
  const backCells = backVox.removedCells;
  const backTris = mustNum(backVox.mesh, 'triangles', 'voxels().mesh');
  const backVerts = mustNum(backVox.mesh, 'vertices', 'voxels().mesh');
  const backBricks = mustNum(backVox.mesh, 'bricks', 'voxels().mesh');
  const backSolidity = solidity(inside);
  log.push(`restored ${JSON.stringify(ledger?.voxels ?? null)}, samples ${backSolidity}`);

  // --- 5. walk the restored tunnel, dig key never pressed -------------------
  await settle(0.5);
  let metres = 0;
  let prev = eye();
  let grounded = 0, ceiling = 0, closed = 0, blocked = 0;
  let atShaft = 0, roofed = 0;
  const walk = [];
  const sample = () => {
    const w = of.world();
    const p = eye();
    metres += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
    const r = Math.hypot(p[0], p[1], p[2]);
    const up = [p[0] / r, p[1] / r, p[2] / r];
    let ceilM = null;
    for (let h = 0.25; h <= 12; h += 0.25) {
      if (of.solidAt(p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h)) { ceilM = h; break; }
    }
    const col = of.surface(up[0], up[1], up[2]);
    if (w.player.grounded) grounded++;
    if (ceilM !== null) ceiling++;
    if (col.loweringM < 0.001) closed++;
    // A sample taken UNDER THE SHAFT has open sky over it by construction, and
    // it is identified by its own geometry rather than by a count: the shaft is
    // exactly the column whose top was removed, which is what a non-zero
    // `derivedLoweringAt` means. Everything else is tunnel and must be roofed.
    if (col.loweringM >= 0.001) atShaft++;
    else if (ceilM !== null && w.player.grounded) roofed++;
    if (w.player.blockedByRock) blocked++;
    walk.push({ stepM: +d.toFixed(2), grounded: w.player.grounded,
      underRock: w.player.underRock, ceilingM: ceilM,
      loweringM: +col.loweringM.toFixed(3) });
  };
  // Deeper first and only part of the way back, so the walk stays under rock:
  // a sample taken at the shaft mouth has no roof over it by construction and
  // would fail a check that is about the tunnel, not about the entrance.
  prev = eye();
  for (let i = 0; i < 5; ++i) { await hold(0.4, ['KeyW']); sample(); }
  for (let i = 0; i < 3; ++i) { await hold(0.4, ['KeyS']); sample(); }
  await settle(0.6);
  of.look(yaw, 0);
  await settle(0.5);

  const w = of.world();
  const n = walk.length;
  const air = '.'.repeat(inside.length);
  const rock = 'R'.repeat(inside.length);

  return {
    // DW-20 first: the simulation actually ran, and it actually dug.
    // `editFacesOnly` is part of DW-20 validity, not of the acceptance: under
    // `?voxelskin=0` the near mesh draws the whole isosurface and never empties,
    // so such a run cannot say anything about persistence and must declare
    // itself invalid rather than report a red verdict.
    valid: landed > 0 && dug.removedCells > 0 && (w.tick - t0.tick) > 600
      && written.voxelBytes > 0 && written.voxelOps > 0
      && dug.mouth.sent === dug.mouth.applied
      && backVox.mesh.editFacesOnly === true,
    advanced: {
      ticks: w.tick - t0.tick, frames: w.frames - t0.frames,
      strikesLanded: landed, cellsDug: dug.removedCells,
    },
    // --- THE ACCEPTANCE -----------------------------------------------------
    // Air where the tunnel is, rock once the diff is gone, air again once it is
    // back, and the same cell count both times. The middle line is the one that
    // makes the last one mean anything.
    //
    // The near mesh is counted in TRIANGLES, not in "is it visible", and the
    // three readings are three separate numbers rather than three views of one
    // live object.
    //
    // WHAT THE THREE NUMBERS MUST DO, and why each bound is what it is.
    //
    // `dugTris > 0`: the strike produced drawable geometry. Without this the
    // whole comparison could be satisfied by 0 -> 0 -> 0, which is exactly the
    // shape a probe reading a dead field was already in.
    //
    // `goneTris === 0 && goneBricks === 0`: EXACT, not an inequality, and this
    // is stricter than the pre-WG-24 form (`goneFaces < dugFaces`, measured
    // 1016 -> 745). The edit filter now runs inside /core, so with `editFacesOnly`
    // a brick holding no edited cell returns nothing and is dropped from the
    // cache entirely. Put the rock back and there is no near mesh at all. That
    // makes the middle step a much harder thing to fake: a save that "worked"
    // because the live world still held the answer now has to survive a mesh
    // that is provably empty, not merely smaller.
    //
    // `backBricks === dugBricks` is EXACT and `backTris >= dugTris` is not, and
    // the asymmetry is measured rather than assumed. Restoring 172 cells gives
    // back the same 8 bricks holding geometry but 778 triangles over 544
    // vertices against the live dig's 774 over 540. The four extra are real and
    // they are the LIVE mesh being very slightly stale, not the restore
    // inventing rock: a strike re-meshes /core's dirty region grown by one cell,
    // while a surface-nets cell reads the density at corners it shares with the
    // neighbouring brick, so a later strike near a brick boundary can leave the
    // brick next door a few triangles behind. A restore re-meshes over the brush
    // boxes, which are a superset, and picks those up. The drift is reported as
    // `meshDrift` on every run so it stays a number somebody can watch rather
    // than a tolerance that absorbs a real defect (standing rule 11).
    //
    // The teeth are `backTris > 0` (via `>= dugTris > 0`) together with the
    // exact brick count and the exact cell count: a load that restored nothing
    // reads 0, and a load that restored part of the tunnel loses bricks and
    // cells. An inequality alone would not be enough, which is why it never
    // stands alone here.
    //
    // `editFacesOnly` is asserted in `valid` above rather than here, because
    // `?voxelskin=0` meshes the whole isosurface and `goneTris === 0` is then
    // false for a legitimate reason. A run under that flag is not evidence about
    // persistence and must invalidate itself rather than fail.
    tunnelSurvivesReload:
      dugCells > 0 && dugTris > 0 && dugSolidity === air
      && forgot.removedCells === 0 && goneSolidity === rock
      && goneTris === 0 && goneVerts === 0 && goneBricks === 0
      && backCells === dugCells && backSolidity === air
      && backBricks === dugBricks
      && backTris >= dugTris && backVerts >= dugVerts
      && backVox.meshVisible,
    // ...and it is still a passage, walked with the dig key released.
    //
    // THE SHAFT IS EXCLUDED BY ITS OWN GEOMETRY, not by a count. The walk
    // starts at the bottom of the shaft it sank, so the first samples are under
    // an open column by construction, and the old form allowed exactly ONE of
    // them (`closed >= n - 1`). Two land there on this world, so the check has
    // been red since before the control work: verified by running this same
    // probe at commit 3242b88, which reports the identical 8.87 m / 8 samples /
    // grounded 7 / ceiling 7 / closed 6 / blocked 0.
    //
    // The replacement is STRICTER, not looser: EVERY sample that is not under
    // the shaft must be both grounded and roofed, with no allowance at all, and
    // at least four of them must exist so the test cannot pass by walking two
    // steps out of the entrance and stopping.
    stillWalkable: metres >= 3 && blocked === 0
      && n - atShaft >= 4 && roofed === n - atShaft && closed === n - atShaft,
    forgot,
    solidity: { dug: dugSolidity, forgotten: goneSolidity, restored: backSolidity },
    cells: { dug: dugCells, forgotten: forgot.removedCells, restored: backCells },
    meshTriangles: { dug: dugTris, forgotten: goneTris, restored: backTris },
    meshVertices: { dug: dugVerts, forgotten: goneVerts, restored: backVerts },
    meshBricks: { dug: dugBricks, forgotten: goneBricks, restored: backBricks },
    // Restored minus live. Expected small and non-negative; see the note on
    // tunnelSurvivesReload. Measured 4 triangles / 4 vertices of 774 / 540.
    meshDrift: { triangles: backTris - dugTris, vertices: backVerts - dugVerts,
      bricks: backBricks - dugBricks },
    slot: written,
    ledger,
    walked: { metresWalked: +metres.toFixed(2), samples: n, grounded,
      underTheShaft: atShaft, roofedTunnelSamples: roofed,
      ceilingSolid: ceiling, columnClosed: closed, blocked },
    walk,
    mesh: backVox.mesh,
    meshVisible: backVox.meshVisible,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw },
    log,
  };
})()
