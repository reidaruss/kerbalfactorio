// WG-22 terraforming: can the player flatten a spot and build on it?
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/level.js \
//        --out=docs/screenshots/W8_level_pad.png
//
// FIVE THINGS, AND THE SECOND ONE IS THE POINT.
//
//   1. It moved ground. Cells cut AND cells placed, from /core's own counters,
//      because a levelling tool that only cuts is a digging tool.
//   2. The height SPREAD across the disc collapsed. A count of cells changed
//      would be satisfied by an op that moved entirely the wrong ones, so the
//      claim is measured in metres of terrain, before and after.
//   3. THE NEGATIVE CONTROL: points outside the radius are unchanged to the
//      millimetre. A tool that flattened the whole planet would pass 1 and 2.
//   4. The player can walk onto the pad and the ground does not fight them.
//      Rendered height and collided height agreeing is not a nicety here: it is
//      the failure this project has now shipped four times.
//   5. It survives a save and a reload, with the rock PUT BACK in between, the
//      technique probes/tunnelpersist.js established. A restore that "worked"
//      because the live world still held the answer is the classic false pass.
//
// DW-20: input drains on the 60 Hz tick, not the render frame, so every wait
// here is real time through of.run and every claim is checked against a tick
// delta first.
(async () => {
  const of = window.__of;
  const R = OF_ARGS.radiusM ?? 6.0;
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  // The EYE, in body-frame absolutes. Not the feet: nothing on __of publishes
  // the capsule's base, so this probe measures the eye's altitude above the ONE
  // surface and asserts it stays CONSTANT rather than asserting it is zero. A
  // constant eye height over a walk is the same claim — the ground the walker
  // resolves against and the ground the oracle reports are one surface — and it
  // is the claim that can actually be made from here.
  const eye = () => {
    const w = of.world();
    return w.player === null ? null : w.player.aim.origin;
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  // A ring of sample DIRECTIONS at `metres` tangential from `u`. Directions and
  // not positions, because the origin rebases and a direction does not.
  const ring = (u, metres, n, radiusM) => {
    const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cx = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]];
    let e1 = cx(u, seed);
    const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
    const e2 = cx(u, e1);
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = (2 * Math.PI * i) / n;
      out.push(unit([0, 1, 2].map((k) =>
        u[k] * radiusM + (e1[k] * Math.cos(a) + e2[k] * Math.sin(a)) * metres)));
    }
    return out;
  };
  // Every height here comes from of.surface, i.e. from surface_field.h. Nothing
  // in this probe re-derives a terrain height (standing rule 1 applies to the
  // verification too, or the harness becomes a fifth surface).
  const heights = (dirs) => dirs.map((d) => of.surface(d[0], d[1], d[2]).surfaceM);
  const spreadOf = (hs) => Math.max(...hs) - Math.min(...hs);
  const round = (a) => a.map((v) => +v.toFixed(3));

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character, nothing can level' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();

  const bodyR = w0.bodyRadiusM;
  const t0 = of.world();

  // --- 1. FIND A SLOPE, because flat ground cannot prove a levelling tool ---
  //
  // The spawn clearing spans about 1.5 m across a 12 m disc, which is already
  // inside the 1 m voxel lattice's own resolution: levelling it and levelling
  // nothing would produce the same numbers. So the probe walks a grid of
  // candidate sites through the SAME teleport a player-facing debug call uses,
  // measures each one through the oracle, and takes the steepest one a person
  // could still stand on. This search is the reason the headline number below
  // means anything.
  const spawn = of.world().observer;
  const site = { latDeg: spawn.latDeg, lonDeg: spawn.lonDeg, spread: -1, scanned: 0 };
  // Two passes: coarse over kilometres to find the hill, fine over metres to
  // find its steepest face. One pass would have to choose between reach and
  // resolution, and the spawn plain needs reach.
  const scan = (cLat, cLon, stepDeg, span, maxM) => {
    for (let i = -span; i <= span; ++i) {
      for (let j = -span; j <= span; ++j) {
        const lat = cLat + i * stepDeg;
        const lon = cLon + j * stepDeg;
        of.teleport(lat, lon, 2.0);
        const uu = unit(eye());
        site.scanned++;
        const s = spreadOf(heights([uu, ...ring(uu, R * 0.7, 4, bodyR),
          ...ring(uu, R, 4, bodyR)]));
        // Steep enough to be worth flattening, shallow enough to walk onto: a
        // cliff would be levelled correctly and then be untestable on foot.
        if (s > site.spread && s <= maxM) {
          site.spread = s; site.latDeg = lat; site.lonDeg = lon;
        }
      }
    }
  };
  const maxSlopeM = OF_ARGS.maxSlopeM ?? 9.0;
  scan(spawn.latDeg, spawn.lonDeg, OF_ARGS.coarseStepDeg ?? 0.02, 10, maxSlopeM);
  scan(site.latDeg, site.lonDeg, OF_ARGS.fineStepDeg ?? 0.0016, 6, maxSlopeM);
  of.teleport(site.latDeg, site.lonDeg, 2.0);
  // A long settle: this can be kilometres from the spawn, so the streamer has a
  // whole resident set to rebuild before anything measured here is trustworthy.
  await settle(OF_ARGS.arriveSecs ?? 3.0);
  log.push(`site: lat ${site.latDeg.toFixed(5)} lon ${site.lonDeg.toFixed(5)} `
    + `after ${site.scanned} candidates, probe spread ${site.spread.toFixed(3)} m `
    + `(the spawn plain spans well under one voxel)`);

  // Look STEEPLY down, so the disc lands under the player rather than a few
  // metres downhill. This matters and it cost a run to learn: the disc is
  // centred on the AIM POINT, the sample rings are centred on the PLAYER, and at
  // a shallow pitch on a slope those are metres apart, so the rings sat half
  // outside the pad and reported a collapse of 1.39x for a tool that had
  // levelled its disc perfectly. Aim and measurement have to describe the same
  // ground or the measurement is of something else.
  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -72);
  await settle(0.4);

  // Sample the PAD, not its rim. The disc is centred on the aim point, about
  // 0.5 m ahead of the player at this pitch, so a ring at 0.6R already reaches
  // 4.3 m of a 6 m radius; add the up-to-0.87 m offset between a sample
  // direction and the CENTRE of the cell the oracle probes in that column and a
  // sample lands on the boundary, where a column is legitimately half cut. Two
  // outer-ring points reading their original height was that, measured, not a
  // bug: the rim of a voxel pad is a staircase and the tool is honest about it.
  const u = unit(eye());
  const inner = ring(u, R * 0.25, 8, bodyR);
  const mid = ring(u, R * 0.45, 8, bodyR);
  const inside = [u, ...inner, ...mid];
  // The control ring is at 2.5x the radius, clear of the disc under any aim
  // offset a steep pitch can produce.
  const outside = ring(u, R * 2.5, 12, bodyR);

  const inBefore = heights(inside);
  const outBefore = heights(outside);
  const spreadBefore = spreadOf(inBefore);
  log.push(`before: inside spread ${spreadBefore.toFixed(3)} m over ${inside.length} pts, `
    + `outside spread ${spreadOf(outBefore).toFixed(3)} m`);

  // --- 2. level it WITH THE KEY --------------------------------------------
  // The Q key and nothing else, because the difference between testing the tool
  // and testing a function nobody can call is whether a keypress reaches it. The
  // target is latched from the player's own feet by the handler, not passed in
  // here, so this is the same thing a person holding Q would get.
  const beforeKey = of.terraform().action.levels;
  await hold(OF_ARGS.holdSecs ?? 1.6, ['KeyQ']);
  const afterKey = of.terraform().action.levels;
  await settle(0.6);

  // ...and then the extra applications, which must report ZERO. An op that kept
  // finding work to do on ground it had just levelled would be creeping, and a
  // held key would sink or raise the pad without limit.
  const passes = [];
  for (let i = 0; i < (OF_ARGS.passes ?? 2); ++i) {
    const r = of.level();
    passes.push(r === null ? null : { dug: r.dug, filled: r.filled, scanned: r.scanned });
    await settle(0.3);
  }

  const tf = of.terraform();
  const inAfter = heights(inside);
  const outAfter = heights(outside);
  const spreadAfter = spreadOf(inAfter);
  // Millimetre tolerance rather than exact equality: the control ring is read
  // through the same float pipeline twice, so 0 is the expected answer and a
  // 1 mm band says so without pretending bitwise identity was asked for.
  let outMoved = 0;
  let outMaxDeltaM = 0;
  for (let i = 0; i < outside.length; ++i) {
    const d = Math.abs(outAfter[i] - outBefore[i]);
    if (d > outMaxDeltaM) outMaxDeltaM = d;
    if (d > 0.001) outMoved++;
  }
  log.push(`after: inside spread ${spreadAfter.toFixed(3)} m, `
    + `outside max delta ${outMaxDeltaM.toFixed(6)} m over ${outside.length} pts`);
  log.push(`cells dug ${tf.action.cellsDug} filled ${tf.action.cellsFilled}, `
    + `removed set ${tf.removedCells} added set ${tf.addedCells}`);

  // --- 3. the surface and the solid AGREE -----------------------------------
  // For every sample on the pad: the cell just below the reported surface is
  // rock and the cell 1.5 m above it is air. If these ever disagree the player
  // floats over the pad or sinks into it, which is the five-surfaces bug back.
  let agree = 0;
  const disagree = [];
  for (let i = 0; i < inside.length; ++i) {
    const d = inside[i];
    const rr = bodyR + inAfter[i];
    const below = of.solidAt(d[0] * (rr - 0.5), d[1] * (rr - 0.5), d[2] * (rr - 0.5));
    const above = of.solidAt(d[0] * (rr + 1.5), d[1] * (rr + 1.5), d[2] * (rr + 1.5));
    if (below && !above) agree++;
    else disagree.push({ i, below, above, h: +inAfter[i].toFixed(2) });
  }

  // --- 4. walk it, with the level key RELEASED ------------------------------
  // Every metre covered here is pre-existing pad. `blockedByRock` is the tell
  // that the collision shape and the drawn ground have parted company.
  await settle(0.4);
  let metres = 0;
  let prev = eye();
  let grounded = 0, blocked = 0;
  const walk = [];
  const sample = () => {
    const p = eye();
    const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    metres += d;
    prev = p;
    const wv = of.world();
    const up = unit(p);
    const col = of.surface(up[0], up[1], up[2]);
    // The eye's altitude above the ONE surface. Over a walk on a flat pad it
    // must not wander: if it climbs the walker is riding ground the oracle does
    // not report, and if it drops the walker is sinking into ground it does.
    const altM = Math.hypot(p[0], p[1], p[2]) - (bodyR + col.surfaceM);
    if (wv.player.grounded) grounded++;
    if (wv.player.blockedByRock) blocked++;
    walk.push({ stepM: +d.toFixed(2), grounded: wv.player.grounded,
      blocked: wv.player.blockedByRock, eyeAltM: +altM.toFixed(3),
      loweringM: +col.loweringM.toFixed(3) });
  };
  // Short steps, and back again: the pad is 12 m across, so a long walk would
  // leave it and then measure the hillside instead of the floor.
  prev = eye();
  for (let i = 0; i < 3; ++i) { await hold(0.15, ['KeyW']); sample(); }
  for (let i = 0; i < 3; ++i) { await hold(0.15, ['KeyS']); sample(); }
  await settle(0.5);
  const n = walk.length;
  // Only the GROUNDED samples: a sample taken mid-step-up is airborne by
  // definition and says nothing about whether the two surfaces agree.
  const eyeAlt = walk.filter((s) => s.grounded).map((s) => s.eyeAltM);
  const eyeAltSpread = eyeAlt.length > 1 ? Math.max(...eyeAlt) - Math.min(...eyeAlt) : 0;

  // --- 5. save, PUT THE ROCK BACK, load ------------------------------------
  const padBefore = heights(inside);
  const written = await of.save();
  const forgot = of.forgetTunnels();
  // Read BOTH counts from /core rather than from what forgetTunnels chose to
  // return: its ledger predates the added set, and "the field I wanted was
  // undefined" is exactly how a persistence check passes without checking.
  const gone = of.terraform();
  const goneHeights = heights(inside);
  const goneSpread = spreadOf(goneHeights);
  const ledger = await of.load();
  const backHeights = heights(inside);
  const back = of.terraform();
  // The pad has to come back to the SAME heights, not merely to some heights.
  let restoredMaxDeltaM = 0;
  let forgottenMaxDeltaM = 0;
  for (let i = 0; i < padBefore.length; ++i) {
    const d = Math.abs(backHeights[i] - padBefore[i]);
    if (d > restoredMaxDeltaM) restoredMaxDeltaM = d;
    const g = Math.abs(goneHeights[i] - padBefore[i]);
    if (g > forgottenMaxDeltaM) forgottenMaxDeltaM = g;
  }
  log.push(`persist: saved ${written === null ? 'null' : written.voxelBytes + ' B'}, `
    + `forgot -> pad moved ${forgottenMaxDeltaM.toFixed(3)} m, restored max delta `
    + `${restoredMaxDeltaM.toFixed(6)} m`);

  const wEnd = of.world();

  // --- 6. frame the capture -------------------------------------------------
  // Standing ON the pad and looking down photographs the inside of its own cut
  // walls: at 1.6 m of eye height a 6 m disc fills the frame with unlit
  // polygons and says nothing. So back away across the slope, turn round, and
  // look at the pad from outside it, in third person, where the flat step in
  // the hillside and the player standing on it are both visible.
  // Third person is NOT used for it, though it would show the player standing on
  // the pad: `ViewMode.springArm` probes only `oracle.surfaceRadius`, so against
  // a steep face every candidate is already below the heightfield and the arm
  // collapses to 0.5 m, putting the camera inside the player's own head. That is
  // a known open defect (STATUS.md) and not this pass's to fix, so the capture
  // stays in first person: stand on the pad and look out across it, where the
  // flat floor in the foreground meets the untouched slope beyond.
  await settle(0.4);
  await hold(OF_ARGS.reframeSecs ?? 0.35, ['KeyW']);
  await settle(0.5);
  // Put the sun near the zenith for the capture. The cut walls of a pad face
  // sideways, so at the scenario's default low sun the whole foreground is in
  // its own shadow and photographs as a black mass. This changes only the light,
  // never the geometry, and every number above was taken before it.
  of.setTime(OF_ARGS.shotSunT ?? 0.25);
  of.look(OF_ARGS.shotYawDeg ?? (OF_ARGS.yawDeg ?? 0), OF_ARGS.shotPitchDeg ?? -25);
  await settle(1.2);

  return {
    // DW-20 first: the sim actually advanced, and the tool actually ran.
    valid: (wEnd.tick - t0.tick) > 400
      && tf.action.levels > 0
      && (tf.action.cellsDug + tf.action.cellsFilled) > 0
      && tf.mouth.sent === tf.mouth.applied,
    advanced: {
      ticks: wEnd.tick - t0.tick, frames: wEnd.frames - t0.frames,
      levels: tf.action.levels, noops: tf.action.noops, misses: tf.action.misses,
    },

    // --- THE ACCEPTANCE -----------------------------------------------------
    // 1 + 2: it cut AND filled, and the terrain spread collapsed. The threshold
    // is two voxels, because a Cartesian 1 m lattice cut by a plane that is not
    // axis-aligned terminates on a staircase: a pad is flat to about one voxel
    // and never to zero. The collapse FACTOR is asserted too, or ground that
    // was already flat would pass.
    padIsFlat: tf.action.cellsDug > 0 && tf.action.cellsFilled > 0
      && spreadAfter <= 2.0 && spreadAfter * 2 < spreadBefore,
    // 3: and only inside the radius.
    outsideUntouched: outMoved === 0,
    // The surface the mesh draws and the solidity collision reads are the same
    // answer at every sample on the pad.
    surfaceAgreesWithSolid: agree === inside.length,
    // 4: walkable, with the level key released the whole way.
    padIsWalkable: metres >= 1.5 && grounded >= n - 2 && blocked === 0
      && eyeAlt.length >= 3 && eyeAltSpread <= 0.35,
    // 5: and it is still there after a reload, having been genuinely removed
    // in between (the middle line is what makes the last one mean anything).
    padSurvivesReload: written !== null && written.voxelBytes > 0
      && forgottenMaxDeltaM > 0.5
      && gone.removedCells === 0 && gone.addedCells === 0
      && restoredMaxDeltaM <= 0.001
      && back.addedCells === tf.addedCells && back.removedCells === tf.removedCells,
    // The Q key reaches the tool, and re-applying it finds nothing left to do.
    keyDrivesTheTool: afterKey > beforeKey,
    idempotent: passes.every((p) => p !== null && p.dug === 0 && p.filled === 0),

    site,

    spreadM: { before: +spreadBefore.toFixed(3), after: +spreadAfter.toFixed(3),
      forgotten: +goneSpread.toFixed(3),
      collapse: +(spreadBefore / Math.max(spreadAfter, 1e-6)).toFixed(2) },
    outside: { points: outside.length, moved: outMoved,
      maxDeltaM: +outMaxDeltaM.toFixed(6) },
    cells: { dug: tf.action.cellsDug, filled: tf.action.cellsFilled,
      removedSet: tf.removedCells, addedSet: tf.addedCells,
      scannedLast: tf.action.lastScanned },
    agreement: { samples: inside.length, agree, disagree },
    passes,
    keys: { levelsBeforeKey: beforeKey, levelsAfterKey: afterKey },
    walked: { metresWalked: +metres.toFixed(2), samples: n, grounded, blocked,
      groundedSamples: eyeAlt.length,
      eyeAltSpreadM: +eyeAltSpread.toFixed(3),
      eyeAltM: eyeAlt.map((v) => +v.toFixed(3)) },
    walk,
    persist: {
      slot: written, forgot,
      gone: { removedCells: gone.removedCells, addedCells: gone.addedCells },
      ledger: ledger?.voxels ?? null,
      restoredMaxDeltaM: +restoredMaxDeltaM.toFixed(6),
      forgottenMaxDeltaM: +forgottenMaxDeltaM.toFixed(3),
      cellsBack: { added: back.addedCells, removed: back.removedCells },
    },
    heights: {
      insideBefore: round(inBefore), insideAfter: round(inAfter),
      insideRestored: round(backHeights),
    },
    ring: tf.ring,
    action: tf.action,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw,
      levelMs: tf.action.lastMs },
    log,
  };
})()
