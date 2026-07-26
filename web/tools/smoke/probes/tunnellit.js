// W5 underground lighting acceptance: is it actually DARK down there, and does
// the lamp actually do the work?
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/tunnellit.js \
//        --evalargs='{"strikes":16}' --out=docs/screenshots/W5_tunnel_lit.png
//
// The drive phase is tunnelwalk's, unchanged in spirit: sink a shaft, cut
// forward, step into the cut, then WALK the finished passage with no digging.
// DW-20 is the whole reason it is here. Strikes landed, cells removed, ticks
// advanced and metres walked all have to be real before a single luminance
// number below is worth reading.
//
// The measurement is `__of.framehash()`, which renders one frame and reports
// mean luminance per tile off the actual presented pixels. That makes "it is
// lit" a number rather than an impression, and the A/B is the honest one: the
// SAME eye, the SAME aim, the SAME frame, with only `__of.lamp()` changed. Sky
// occlusion does not move between the two halves, so any difference is the lamp.
(async () => {
  const of = window.__of;
  const strikes = OF_ARGS.strikes ?? 16;
  const ramp = OF_ARGS.rampStrikes ?? 6;
  const yaw = OF_ARGS.yawDeg ?? 0;

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
  // Mean luminance of the presented frame, 0..255, with the HUD text column
  // excluded: the overlay is bright white glyphs over roughly the left third of
  // the top half, and it would put a floor under the "dark" reading that has
  // nothing to do with the scene. 16x9 tiles, drop tile columns 0..5 of rows
  // 0..4. The tail of the tile array is the bottom of the screen.
  const luma = () => {
    const f = of.framehash(16, 9);
    let sum = 0, n = 0;
    for (let ty = 0; ty < 9; ++ty) {
      for (let tx = 0; tx < 16; ++tx) {
        if (ty < 5 && tx < 6) continue;
        sum += f.tiles[ty * 16 + tx]; n++;
      }
    }
    return { mean: +(sum / n).toFixed(2), litPct: f.litPct, hash: f.hash };
  };
  // Read after the ambient has settled: the fade out of daylight is a 0.6 s
  // eye-adaptation constant on purpose, so a measurement taken immediately
  // would be reading the ramp rather than the state.
  //
  // `programs` is here because three excludes an INVISIBLE light from the
  // lights state hash, so a lamp that switches `visible` switches every
  // material onto a different program: a full recompile of the world at the
  // exact moment the player steps into a tunnel. The count going up across a
  // toggle is that recompile, in one number.
  const measure = async (on) => {
    of.lamp(on);
    await settle(1.2);
    const a = luma(); const b = luma();
    const st = of.stats();
    return {
      ...of.lamp(), luma: b, lumaRepeat: a.mean,
      programs: st.draw.programs, worstMs: +st.frameMs.worst.toFixed(1),
    };
  };

  await settle(1.5);
  const t0 = of.world();
  if (of.voxels() === null) return { valid: false, why: 'no character, nothing can dig' };

  // Daylight reference, taken BEFORE a single cell is removed, at the same site
  // and the same time of day. This is the no-regression baseline: the surface
  // must still read as daylight once the ambient is under Headlamp's control.
  of.look(yaw, -6);
  await settle(0.8);
  const surface = {
    ...of.lamp(), luma: luma(),
    programs: of.stats().draw.programs, worstMs: +of.stats().frameMs.worst.toFixed(1),
    draw: of.stats().draw.calls, frameMsP50: of.stats().frameMs.p50,
    frameMsP99: of.stats().frameMs.p99,
  };

  // --- DRIVE: sink a shaft, then cut forward, stepping into the cut. ---------
  const shots = [];
  for (let i = 0; i < ramp; ++i) {
    of.look(yaw, -85);
    shots.push(of.dig());
    await settle(0.35);
  }
  for (let i = 0; i < strikes; ++i) {
    of.look(yaw, OF_ARGS.pitchDeg ?? -12);
    shots.push(of.dig());
    await of.run(0.2, 60);
    await hold(OF_ARGS.stepSecs ?? 0.22, ['KeyW']);
  }
  await settle(1.0);

  // --- WALK: no digging from here. Every metre is pre-existing tunnel. ------
  let metres = 0;
  let prev = eye();
  let grounded = 0, underRock = 0, ceilingSolid = 0, columnClosed = 0, n = 0;
  const sample = () => {
    const w = of.world();
    const p = eye();
    metres += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
    const r = Math.hypot(p[0], p[1], p[2]);
    const up = [p[0] / r, p[1] / r, p[2] / r];
    let ceilM = null;
    for (let h = 0.25; h <= 12; h += 0.25) {
      if (of.solidAt(p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h)) { ceilM = h; break; }
    }
    const col = of.surface(up[0], up[1], up[2]);
    if (w.player.grounded) grounded++;
    if (w.player.underRock) underRock++;
    if (ceilM !== null) ceilingSolid++;
    if (col.loweringM < 0.001) columnClosed++;
    n++;
  };
  const slices = OF_ARGS.slices ?? 5;
  const sliceSecs = OF_ARGS.sliceSecs ?? 0.4;
  prev = eye();
  for (let i = 0; i < slices; ++i) { await hold(sliceSecs, ['KeyW']); sample(); }
  for (let i = 0; i < slices; ++i) { await hold(sliceSecs, ['KeyS']); sample(); }

  // Frame the capture: level, down the passage, from inside it. `shotView` runs
  // the whole A/B in third person, which is the case where a lamp bolted to the
  // CAMERA rather than to the player's own head is instantly obvious.
  if (OF_ARGS.shotView === 'TP') of.setView('TP');
  of.look(yaw, 0);
  await settle(0.8);
  const p = eye();
  const r = Math.hypot(p[0], p[1], p[2]);
  const col = of.surface(p[0] / r, p[1] / r, p[2] / r);
  const deepEnough = col.loweringM < 0.001;

  // --- THE KEY --------------------------------------------------------------
  // `__of.lamp()` is a debug door. This is the door the PLAYER uses: a real L on
  // the input tape, edge-detected on the fixed tick, which is the only evidence
  // that the toggle a human presses is wired to the lamp a probe can see.
  const keyStates = [of.lamp().enabled];
  for (let i = 0; i < 2; ++i) {
    of.input.press('KeyL', 12);
    await of.run(0.5, 60);
    keyStates.push(of.lamp().enabled);
  }
  const keyToggles = keyStates[0] !== keyStates[1] && keyStates[1] !== keyStates[2];

  // --- THE A/B --------------------------------------------------------------
  const off = await measure(false);
  const on = await measure(true);
  // A third reading, back to off and on again, so a program count that grew on
  // the first toggle can be told apart from one that grows on EVERY toggle.
  const off2 = await measure(false);
  const on2 = await measure(true);
  // frameMs is read with the lamp ON and after the toggle, so it includes both
  // the extra light and whatever the program cache had to do about it.
  const st = of.stats();
  await settle(0.4);
  const stAfter = of.stats();

  const w = of.world();
  const v = of.voxels();
  const hits = shots.filter((s) => s !== null && s.cells > 0);
  const ratio = +(on.luma.mean / Math.max(0.01, off.luma.mean)).toFixed(2);

  return {
    // DW-20 first. Nothing below counts unless the simulation actually moved.
    valid: hits.length > 0 && v.removedCells > 0 && v.mouth.sent === v.mouth.applied
      && (w.tick - t0.tick) > 600 && metres > 4
      && ceilingSolid === n && columnClosed === n && deepEnough,
    drove: {
      ticksAdvanced: w.tick - t0.tick,
      framesRendered: w.frames - t0.frames,
      strikesLanded: hits.length,
      removedCells: v.removedCells,
      metresWalked: +metres.toFixed(2),
      samples: n, groundedSamples: grounded, underRockSamples: underRock,
      ceilingSolidSamples: ceilingSolid, columnClosedSamples: columnClosed,
    },
    // --- THE ACCEPTANCE TEST -------------------------------------------------
    // 1. underground with the lamp OFF is genuinely dark, not the old grey box,
    // 2. the lamp makes a large, measured difference to the SAME frame,
    // 3. the surface is still daylight, well above both.
    undergroundIsDark: off.luma.mean < surface.luma.mean * 0.3,
    lampDoesTheWork: ratio >= 1.6 && on.luma.mean > off.luma.mean + 6,
    surfaceNotRegressed: surface.luma.mean > 40 && surface.skyVis > 0.9
      && surface.lampCd === 0 && surface.sunScale > 0.99,
    // Toggling the lamp compiles NOTHING: one lights configuration for the
    // session. The surface-to-underground delta is allowed to be small and
    // non-zero because the voxel mesh's own materials are created by the first
    // dig and have to compile once, which is not a lighting cost.
    noRecompileOnToggle: off.programs === on.programs && off2.programs === on.programs
      && on2.programs === on.programs,
    programsFromDigging: on.programs - surface.programs,
    worstMsUnderground: Math.max(off.worstMs, on.worstMs),
    keyToggles,
    keyStates,
    lumaRatio: ratio,
    surface,
    lampOff: off,
    lampOn: on,
    lampOffAgain: { luma: off2.luma, programs: off2.programs },
    lampOnAgain: { luma: on2.luma, programs: on2.programs },
    finalColumn: { baseM: +col.baseM.toFixed(2), loweringM: +col.loweringM.toFixed(3) },
    site: { lat: +w.observer.latDeg.toFixed(5), lon: +w.observer.lonDeg.toFixed(5),
      altM: +w.observer.altM.toFixed(2), biome: w.biome },
    cost: {
      frameMs: st.frameMs, frameMsAfter: stAfter.frameMs,
      draw: st.draw, programs: st.programs, triangles: st.triangles,
      passes: st.passes ?? null,
    },
  };
})()
