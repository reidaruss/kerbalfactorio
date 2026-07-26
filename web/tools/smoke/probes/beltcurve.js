// W7: a belt that turns a corner is drawn as a curve.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/beltcurve.js \
//        --out=docs/screenshots/W7_belt_curve.png
//
// belt_curve_l.glb and belt_curve_r.glb have been built and validated since
// Tier 0 and nothing ever drew one, so a line that turned was two straight tiles
// meeting at a right angle with a notch in the deck.
//
// HOW THE L IS LAID, and why it is no longer R.
//
// This probe used to lay three tiles in a straight line and press R before the
// last one, on the theory that a tile's flow is whatever the crosshair had when
// it went down. That stopped being true: `FactoryCommit.pitchRuns` re-derives
// every tile's heading from the POSITIONS of the run it is in, so that a belt
// following a hillside is a smooth ramp instead of a flight of steps. A corner
// is therefore a fact about GEOMETRY now, not about which way a tile was facing
// when it was placed, and a straight row of tiles is a straight run however each
// one was rotated. Rotating the last tile of a run no longer bends anything.
//
// So the L is laid the way a player lays one: PRESS AND HOLD the left button and
// move the crosshair. `BuildMode.dragRun` fills every cell between the head of
// the run and wherever the crosshair is, turning each tile to point at its
// successor as it goes, and `stepToward` walks the dominant axis first. Jumping
// the crosshair out along one axis and then straight across the other therefore
// lays a clean L with exactly one corner in it, which is precisely the input the
// curve renderer reads.
//
// AND THE TARGET CELL IS SEARCHED FOR, NOT ASSUMED. A yaw sweep at a fixed pitch
// traces an ARC, and the arc drifts a cell inwards before the crosshair has
// moved two cells across; aiming by dead reckoning lays a staircase of four
// corners instead of one. The two-dimensional search below asks the ghost where
// it actually is until it reports the cell the L needs, which is what a player
// does by watching the preview.
//
// BOTH HANDS ARE TESTED. Two legs are laid back to back, and the turn direction
// of each is chosen by the SIGN of the cross product of its straight step with
// its turn step, computed from the cell addresses. So the two legs are opposite
// by construction rather than by hoping the geometry works out, and a sign error
// in the tangent frame would draw them as each other, which a single-corner test
// would pass.
(async () => {
  const of = window.__of;
  const log = [];
  // `of.run` and NOT a neutral input tape: playTape REPLACES whatever is
  // playing, so a settle that lays down an empty tape wipes the button that was
  // being held and ends the drag. The first version of this probe placed
  // nothing at all for exactly that reason.
  const settle = (secs) => of.run(secs, 60);
  const fac = () => of.game().factory;
  const view = () => of.game().view;

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  const yaw0 = of.world().observer.yawDeg;
  of.build(2);                              // the belt, i.e. the 2 key
  await settle(0.2);

  // A machine cell key is `m<siteId>:<i>,<j>` (MachinePlacement.machineCellKey).
  const addr = (c) => {
    const k = c.indexOf(':');
    const ij = c.slice(k + 1).split(',').map(Number);
    return { site: c.slice(0, k), i: ij[0], j: ij[1] };
  };
  const ghostAt = async (y, p) => {
    of.look((y + 720) % 360, p);
    await settle(0.05);
    const g = of.build().ghost;
    return g === null ? null
      : { cell: g.cell, ...addr(g.cell), ok: g.ok, yaw: y, pitch: p };
  };

  // ONE TILE FIRST, TO ADOPT A SITE. Until a site exists every ghost founds a
  // fresh PROSPECTIVE one on the lattice cell under its own aim point
  // (MachinePlacement.siteAt), so every cell it reports is 0,0 and no two aims
  // can be told apart. Nothing below can be searched for until that is fixed,
  // and one press fixes it. The tile is not wasted: the first leg absorbs it.
  of.look(yaw0, -55);
  await settle(0.2);
  of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 6, keys: [] }]);
  await settle(0.4);
  if (fac().buildings === 0) return { valid: false, why: 'the seed tile would not go down' };
  log.push(`site adopted at ${fac().list[0].cell}`);

  /**
   * One leg: a straight run out along one grid axis, then a square turn across
   * the other. `wantCross` is the sign of (straight x turn) in cell coordinates,
   * so +1 and -1 are the two hands.
   */
  const leg = async (base, wantCross) => {
    // 1. Walk the pitch and record every distinct cell the ghost lands on. The
    //    near end is where the drag starts and the far end is where it turns.
    const pit = [];
    for (let p = -60; p <= -16; p += 0.4) {
      const s = await ghostAt(base, p);
      if (s === null) continue;
      const last = pit[pit.length - 1];
      if (last !== undefined && last.cell === s.cell) continue;
      pit.push(s);
    }
    const c0 = pit.find((s) => s.ok);
    if (c0 === undefined) return { fail: 'no start cell on this heading' };
    // The FARTHEST cell on the same row: the straight leg has to be long enough
    // that the corner is unmistakably in the middle of a run and not at its end.
    let c1 = null;
    for (const s of pit) {
      if (s.ok && s.site === c0.site && s.j === c0.j && Math.abs(s.i - c0.i) >= 3) c1 = s;
    }
    if (c1 === null) return { fail: 'no straight leg on this heading', c0 };
    const si = Math.sign(c1.i - c0.i);
    const sj = si * wantCross;

    // 2. The turn target: the SAME i, at least two cells across in j. Two, not
    //    one, because the LAST tile of a run borrows the heading INTO it, so a
    //    corner on the final tile is invisible to `cornersOf` by construction
    //    and would report zero curves for a line that visibly turns.
    let c2 = null;
    for (let dy = 2; dy <= 46 && c2 === null; dy += 2) {
      for (const side of [1, -1]) {
        for (let dp = -8; dp <= 8 && c2 === null; dp += 2) {
          const s = await ghostAt(base + side * dy, c1.pitch + dp);
          if (s === null || !s.ok || s.site !== c1.site || s.i !== c1.i) continue;
          const dj = s.j - c1.j;
          if (Math.sign(dj) !== sj || Math.abs(dj) < 2) continue;
          c2 = s;
        }
      }
    }
    if (c2 === null) return { fail: 'no square turn cell within reach', si, sj, c0, c1 };

    // 3. The gesture. ONE tape for the whole of it: two tapes would put a
    //    released frame between them, which is a second PRESS and not a hold,
    //    and the drag would restart from the new cell instead of running on.
    const before = fac().buildings;
    of.look(base, c0.pitch);
    await settle(0.15);
    of.input.tape([{ hold: 400, actions: ['use'] }]);
    await settle(0.25);
    of.look(base, c1.pitch);          // straight out: di only
    await settle(0.5);
    of.look((c2.yaw + 720) % 360, c2.pitch);   // square across: dj only
    await settle(0.5);
    of.input.tape([{ hold: 6, keys: [] }]);
    await settle(0.4);

    const laidHere = fac().buildings - before;
    log.push(`leg ${((base + 720) % 360).toFixed(0)}: ${c0.cell} -> ${c1.cell} `
      + `-> ${c2.cell} (step ${si},0 then 0,${sj}; cross ${wantCross}), `
      + `${laidHere} tiles`);
    return { c0: c0.cell, c1: c1.cell, c2: c2.cell, si, sj, wantCross,
      tiles: laidHere };
  };

  const legs = [await leg(yaw0, 1), await leg(yaw0 + 180, -1)];
  of.build(0);
  await settle(0.6);

  const f = fac();
  const v = view();
  const turns = v.curveTiles.map((c) => c.turn).sort().join('');
  log.push(`${f.runs.length} runs, ${v.curves} curve tiles (${turns || 'none'})`);
  const legsOk = legs.every((l) => l.fail === undefined);

  // Frame the shot on the corner: stand back and look down the line.
  of.look(yaw0, -34);
  await settle(0.6);

  return {
    valid: legsOk && f.buildings >= 8 && (of.world().tick - t0.tick) > 200
      // Two legs, two runs, and nothing laid that is not on one of them.
      && f.runs.length === 2
      && f.runs.reduce((a, r) => a + r.tiles, 0) === f.buildings,
    // --- THE ACCEPTANCE -----------------------------------------------------
    // Exactly one corner per leg, and the two legs turn opposite ways: a sign
    // error would give 'll' or 'rr' and a missing detection would give ''.
    cornersAreCurved: v.curves === 2 && turns === 'lr',
    // And the straights are still straight: a rule that curved everything would
    // pass the line above.
    straightsStayStraight: v.curves < f.buildings,
    curves: v.curveTiles,
    turns,
    buildings: f.buildings,
    runs: f.runs,
    runCount: f.runs.length,
    legs,
    cells: f.list.map((b) => b.cell),
    view: v,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
    log,
  };
})()
