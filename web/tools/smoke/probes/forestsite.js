// What does the world look like, and what does it COST, at each of the sites a
// forest has to be correct at?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4203/ \
//     --evalfile=tools/smoke/probes/forestsite.js
//
// WHY A LADDER OF SITES AND NOT ONE CAMERA.
//
// The RN-15 camera is the published invariant camera and this probe reports it
// first, but it is a camera in ONE biome at ONE altitude, and a treeline is by
// construction a term that is zero above it and zero off-biome. A pass measured
// only at RN-15 would therefore be able to report "no change" whether the work
// shipped or not, which is INSTRUMENTS.md's "a term measured only where it
// cannot work reports its own absence" with the sign that flatters the lane.
//
// So every site in section 6.1's spawn shortlist is measured, plus RN-15, and
// each row carries the two facts that decide whether the term should be
// non-zero there at all: the /core biome index and the altitude in metres. A
// zero in a Mountains row at 4.7 km is a PASS; the same zero in the Forest row
// at 27 m is a failure. The probe cannot tell those apart on its own and does
// not try to: it publishes the condition beside the number so the reader can.
//
// Every reading is taken from ONE binary at a settled frame, and the sun is set
// per site rather than shared, because `setTime` sets one vector in the BODY
// frame and a fixed t is a different local time at every longitude (WG-53).
// `sky.elevationDot` is read rather than the post stack's sun, which freezes
// below the horizon (INSTRUMENTS.md).
(async () => {
  const of = window.__of;

  // lat, lon, and the yaw the shot faces. The seven are section 6.1's
  // shortlist; `rn15` is the published invariant camera.
  const SITES = OF_ARGS.sites ?? [
    { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 },
    { name: 'current', lat: 2.0, lon: 144.0, yaw: 300, pitch: -6 },
    { name: 'forest', lat: -19.85, lon: -72.7853, yaw: 300, pitch: -6 },
    { name: 'plains', lat: -7.9675, lon: 116.53189, yaw: 300, pitch: -6 },
    { name: 'hills', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -6 },
    { name: 'hills2', lat: 22.286, lon: 108.84406, yaw: 300, pitch: -6 },
    { name: 'beach', lat: -35.6028, lon: 53.30131, yaw: 300, pitch: -6 },
  ];
  const settle = OF_ARGS.settle ?? 60;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  // Local solar noon for a longitude. `setTime` is a BODY-frame direction, so
  // the same t is a different hour at every meridian; solving for the site's
  // own noon is what makes two rows comparable at all (WG-53 instrument note).
  const noonT = (lon) => {
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < 240; ++i) {
      const t = i / 240;
      of.setTime(t);
      const d = of.stats().sky.elevationDot;
      if (d > bestDot) { bestDot = d; best = t; }
    }
    return { t: best, dot: bestDot };
  };

  const rows = [];
  const t0Tick = of.world().tick;
  for (const s of SITES) {
    of.teleport(s.lat, s.lon, 2.0);
    of.look(s.yaw, s.pitch);
    await of.run(1.0);
    const sun = noonT(s.lon);
    of.setTime(sun.t);
    // Wait for the streamer to converge, then let the scatter backlog drain:
    // BUILDS_PER_UPDATE is 1, so a freshly teleported ring is not finished the
    // frame the chunks arrive and a count taken there is a count of a partial
    // world. Both loops are bounded and both publish what they reached.
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
    let drain = 0;
    while (of.stats().props.scatterBacklog > 0 && drain++ < 400) await of.run(1 / 60);
    await of.run(settle / 60, settle);

    const w = of.world();
    const st = of.stats();
    const pr = st.props;
    rows.push({
      site: s.name,
      // --- the CONDITION the numbers below are true under. `surfaceHeightM` is
      // the GROUND, which is what a treeline is a function of; `altM` is the
      // eye and carries the 1.62 m of character on top of it.
      biome: w.biome,
      groundM: +w.surfaceHeightM.toFixed(1),
      altM: +w.altM.toFixed(1),
      sunT: +sun.t.toFixed(4),
      elevationDot: +sun.dot.toFixed(4),
      converged: w.chunks.converged,
      convergeSpins: spin,
      drainFrames: drain,
      // --- the DW-5 invariant table.
      calls: st.draw.calls,
      triangles: st.draw.triangles,
      programs: st.draw.programs,
      geometries: st.draw.geometries,
      textures: st.draw.textures,
      vramEstimateMB: st.vramEstimateMB,
      // --- what the scatter itself did.
      propsPlaced: pr.propsPlaced,
      chunksScattered: pr.chunks,
      groundM2: pr.groundM2,
      placedPerM2: pr.placedPerM2,
      wantedPerM2: pr.wantedPerM2,
      deliveredFraction: pr.deliveredFraction,
      chunksCapped: pr.chunksCapped,
      cellsCapped: pr.cellsCapped,
      scatterBacklog: pr.scatterBacklog,
      scatterBuildMs: pr.buildMs,
      poolRefused: pr.refused ?? pr.exhausted ?? 0,
      instances: pr.instances ?? null,
      capacity: pr.capacity ?? null,
      // --- the canopy, on its own ground, with its own delivery ratio and its
      // own two refusal counters. `canopyRadiusM` travels with the row so a row
      // can never be attributed to the wrong side of the control.
      canopyRadiusM: pr.canopyRadiusM,
      canopyShade: pr.canopyShade,
      canopyProps: pr.canopyProps,
      canopyM2: pr.canopyM2,
      canopyPerM2: pr.canopyPerM2,
      canopyDelivered: pr.canopyDelivered,
      canopyOfferedCells: pr.canopyOfferedCells,
      canopySlopeCells: pr.canopySlopeCells,
      canopyBareCells: pr.canopyBareCells,
      slopeRejectCells: pr.slopeRejectCells,
    });
  }

  return {
    // DW-20: a run that rendered nothing is visible in its own output.
    ticksAdvanced: of.world().tick - t0Tick,
    stamp: of.boot,
    rows,
  };
})()
