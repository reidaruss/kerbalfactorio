// W5 acceptance. Digs a pit, then a HORIZONTAL tunnel, and asserts the thing
// happened rather than that the call returned (W4 caught three silent
// successes; this probe is written against that failure mode).
//
//   node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/dig.js \
//        --evalargs='{"mode":"tunnel"}' --out=docs/screenshots/W5_tunnel_inside.png
//
// The load-bearing assertion is CEILING INTACT: after driving a tunnel sideways
// into a hillside, the heightfield surface directly above the tunnel must be
// UNCHANGED, because derivedLoweringAt only opens a column whose TOP is removed
// (surface_field.h section 3). A tunnel that lowers the ground above it is not a
// tunnel, it is a trench, and it would look identical from inside.
(async () => {
  const of = window.__of;
  const mode = OF_ARGS.mode ?? 'pit';
  const strikes = OF_ARGS.strikes ?? 8;

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const walk = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };

  await settle(1.5);
  const t0 = of.world();
  const v0 = of.voxels();
  if (v0 === null) return { valid: false, why: 'no character, nothing can dig' };

  // The surface height at the site BEFORE any dig, from the one oracle. This is
  // the number the ceiling test compares against.
  const siteBefore = {
    lat: t0.observer.latDeg, lon: t0.observer.lonDeg,
    surfaceHeightM: t0.surfaceHeightM,
  };

  const shots = [];
  // Per-strike trace. Guessing why a dig missed is exactly the habit DW-20
  // exists to stop, so every strike records where the player was and what the
  // ray found.
  const trace = [];
  const mark = (phase, r) => {
    const ww = of.world();
    trace.push({
      phase,
      cells: r === null ? null : r.cells,
      distM: r === null ? null : +r.distM.toFixed(2),
      altM: +ww.observer.altM.toFixed(2),
      grounded: ww.player.grounded,
      surfaceM: +ww.surfaceHeightM.toFixed(2),
    });
  };
  if (mode === 'pit') {
    of.look(0, -85);                       // straight down
    for (let i = 0; i < strikes; ++i) { shots.push(of.dig()); await of.run(0.25, 60); }
    if (OF_ARGS.lookAfter) of.look(OF_ARGS.lookAfter[0], OF_ARGS.lookAfter[1]);
  } else {
    // A tunnel is dug the way a player digs one: sink a SHAFT (the walker
    // descends as derivedLoweringAt opens those columns), then LEVEL OFF and
    // drive forward. The drive is aimed slightly BELOW eye height so the brush
    // clears the floor as well as the head: centred at eye level it would leave
    // the feet in rock and the voxel push would eject the player upward.
    // The near-level drive is what makes it a tunnel and not a trench: the ray
    // never points at the sky, so every cell it removes has solid ground above
    // it and derivedLoweringAt must report NO lowering for those columns.
    const yaw = OF_ARGS.yawDeg ?? 0;
    const ramp = OF_ARGS.rampStrikes ?? 6;
    // Sink in place: walking during the shaft phase just carries the player off
    // the hole they are standing over.
    for (let i = 0; i < ramp; ++i) {
      of.look(yaw, OF_ARGS.rampPitchDeg ?? -85);
      { const r = of.dig(); shots.push(r); await settle(0.4); mark('shaft', r); }
    }
    for (let i = 0; i < strikes; ++i) {
      of.look(yaw, OF_ARGS.pitchDeg ?? -12);
      { const r = of.dig(); shots.push(r); await of.run(0.2, 60); mark('drive', r); }
      await walk(OF_ARGS.stepSecs ?? 0.22, ['KeyW']);  // step INTO the cut
    }
    of.look(yaw, 0);
  }
  await settle(1.5);

  const w = of.world();
  const v = of.voxels();
  const hits = shots.filter((s) => s !== null && s.cells > 0);

  // Where the player is now, in body-frame metres, from render space.
  const e = w.eyeRel, o = w.origin;
  const ex = e[0] + o.x, ey = e[1] + o.y, ez = e[2] + o.z;
  const er = Math.hypot(ex, ey, ez);
  const up = [ex / er, ey / er, ez / er];

  // --- THE CEILING TEST, at the player's OWN column (not the start site, which
  // is metres away by now). surface() returns the pristine base and the edited
  // surface from the one oracle: loweringM is derivedLoweringAt. A tunnel under
  // intact ground MUST report 0 lowering here, because the top of this column
  // was never removed. A trench reports metres.
  const col = of.surface(up[0], up[1], up[2]);

  // And independently: is there actually rock overhead? March up from the eye.
  let ceilingM = null;
  for (let h = 0.25; h <= 12; h += 0.25) {
    if (of.solidAt(ex + up[0] * h, ey + up[1] * h, ez + up[2] * h)) { ceilingM = h; break; }
  }
  // Depth of the eye BELOW the pristine surface. Positive means underground.
  const eyeBelowSurfaceM = +((w.bodyRadiusM + col.baseM) - er).toFixed(2);

  return {
    // DW-20: ticks, metres and chunks first; the dig numbers mean nothing if
    // the simulation did not run.
    valid: hits.length > 0 && v.removedCells > 0 && v.mouth.sent === v.mouth.applied,
    drove: {
      ticksAdvanced: w.tick - t0.tick,
      framesRendered: w.frames - t0.frames,
      chunksResident: w.chunks.resident,
      converged: w.chunks.converged,
    },
    mode,
    strikes,
    trace,
    hits: hits.length,
    misses: shots.length - hits.length,
    removedCells: v.removedCells,
    harvestedM3: v.harvestedM3,
    // The mouth reconciliation: every dig must have reached the worker AND come
    // back. sent != applied is a lost dig, which is a silent surface split.
    mouth: v.mouth,
    mesh: v.mesh,
    meshVisible: v.meshVisible,
    action: v.action,
    // --- the acceptance numbers.
    surfaceStartM: +siteBefore.surfaceHeightM.toFixed(3),
    // The player's own column: base is the pristine designed surface, lowering
    // is derivedLoweringAt. 0 lowering + rock overhead == an intact ceiling.
    column: {
      baseM: +col.baseM.toFixed(3),
      surfaceM: +col.surfaceM.toFixed(3),
      loweringM: +col.loweringM.toFixed(3),
    },
    /** Metres of rock above the eye, or null for open sky. */
    ceilingAboveEyeM: ceilingM,
    eyeBelowSurfaceM,
    /**
     * THE ACCEPTANCE TEST. Standing inside a tunnel means: underground, rock
     * overhead, and the heightfield above STILL CLOSED. Any one of the three
     * alone is satisfiable by a trench or by a hole in the mesh.
     */
    standingInsideTunnel: mode === 'tunnel' && ceilingM !== null
      && col.loweringM < 0.001 && eyeBelowSurfaceM > 1.0,
    site: { lat: +w.observer.latDeg.toFixed(5), lon: +w.observer.lonDeg.toFixed(5),
      altM: +w.observer.altM.toFixed(2), biome: w.biome },
    cost: {
      frameMs: of.stats().frameMs, draw: of.stats().draw,
      terrain: of.stats().terrain,
    },
  };
})()
