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
  const dugCells = dug.removedCells;
  const dugFaces = dug.mesh.faces;
  const dugSolidity = solidity(inside);
  log.push(`dug ${dug.removedCells} cells over ${landed} strikes, `
    + `${inside.length} interior samples read ${dugSolidity}`);

  // --- 2. save --------------------------------------------------------------
  const written = await of.save();
  log.push(`saved ${JSON.stringify(written)}`);
  if (written === null) return { fail: 'the slot could not be written', log, inside };

  // --- 3. PUT THE ROCK BACK -------------------------------------------------
  const forgot = of.forgetTunnels();
  const goneFaces = of.voxels().mesh.faces;
  const goneSolidity = solidity(inside);
  log.push(`forgot: ${forgot.removedCells} cells left, ${goneFaces} mesh faces, `
    + `samples now ${goneSolidity}`);

  // --- 4. load --------------------------------------------------------------
  const ledger = await of.load();
  const backVox = of.voxels();
  const backCells = backVox.removedCells;
  const backFaces = backVox.mesh.faces;
  const backSolidity = solidity(inside);
  log.push(`restored ${JSON.stringify(ledger?.voxels ?? null)}, samples ${backSolidity}`);

  // --- 5. walk the restored tunnel, dig key never pressed -------------------
  await settle(0.5);
  let metres = 0;
  let prev = eye();
  let grounded = 0, ceiling = 0, closed = 0, blocked = 0;
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
    valid: landed > 0 && dug.removedCells > 0 && (w.tick - t0.tick) > 600
      && written.voxelBytes > 0 && written.voxelOps > 0
      && dug.mouth.sent === dug.mouth.applied,
    advanced: {
      ticks: w.tick - t0.tick, frames: w.frames - t0.frames,
      strikesLanded: landed, cellsDug: dug.removedCells,
    },
    // --- THE ACCEPTANCE -----------------------------------------------------
    // Air where the tunnel is, rock once the diff is gone, air again once it is
    // back, and the same cell count both times. The middle line is the one that
    // makes the last one mean anything.
    //
    // The near mesh is counted in FACES, not in "is it visible". Putting the
    // rock back does not empty it: the bricks it re-meshes still straddle the
    // natural surface, and a solid cell under open sky has an exposed face
    // whether or not anybody ever dug. What has to go is the tunnel's own cut
    // faces, and they have to come back.
    //
    // `>=` and not `===` on the way back, deliberately and with the reason
    // stated. A live strike re-meshes /core's DIRTY REGION, which is the AABB of
    // the cells actually removed; a restore has only the brush, whose box is a
    // superset (it includes cells that were already air). So the restored mesh
    // holds every face the live one did plus a few natural-surface faces from
    // bricks the live pass never had to visit. Measured at 1016 -> 1043, and
    // they are real rock faces in the right places, not tunnel that is not there.
    tunnelSurvivesReload:
      dugCells > 0 && dugSolidity === air
      && forgot.removedCells === 0 && goneSolidity === rock
      && goneFaces < dugFaces
      && backCells === dugCells && backSolidity === air
      && backFaces >= dugFaces && backVox.meshVisible,
    // ...and it is still a passage, walked with the dig key released. One
    // sample may land at the shaft, which has open sky over it by construction,
    // so the roof checks allow exactly one.
    stillWalkable: metres >= 3 && grounded >= n - 1 && ceiling >= n - 1
      && closed >= n - 1 && blocked === 0,
    forgot,
    solidity: { dug: dugSolidity, forgotten: goneSolidity, restored: backSolidity },
    cells: { dug: dugCells, forgotten: forgot.removedCells, restored: backCells },
    meshFaces: { dug: dugFaces, forgotten: goneFaces, restored: backFaces },
    slot: written,
    ledger,
    walked: { metresWalked: +metres.toFixed(2), samples: n, grounded,
      ceilingSolid: ceiling, columnClosed: closed, blocked },
    walk,
    mesh: backVox.mesh,
    meshVisible: backVox.meshVisible,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw },
    log,
  };
})()
