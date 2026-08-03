// RN-845. Point the camera at another celestial body and photograph it.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4207/ \
//     --evalfile=tools/smoke/probes/skybody.js \
//     --evalargs='{"body":"Cinder","sunDot":0.2}' \
//     --out=docs/screenshots/RN845_cinder.png
//
// THE AIM IS NOT SEARCHED, IT IS SOLVED. `__ofBodies.aim()` inverts
// ObserverCamera's own forward expression through the same
// `ViewSource.tangentFrame` the camera uses, so the yaw/pitch this probe hands
// to `of.look` is the aim the camera adopts rather than one that agrees with it
// by luck. A numerical search over yaw and pitch would need a settle per sample
// and would still be a second convention.
//
// `checks` is the point of this file as much as the picture is. Three claims
// that a screenshot cannot make and that a wrong one would not disturb:
//   uvResidual   the bake's parameterisation against the mesh's, at every
//                vertex. A mirrored or quarter-turned map renders a perfectly
//                plausible moon with the wrong face toward you.
//   refusedId    the id `of_body_facts` refused, which is what terminates the
//                discovery loop. If it ever comes back -1 the loop ran to its
//                bound and the refusal is not being exercised.
//   aimResid     `aim().distanceM` reconstructed from the report's own `posM`
//                and `eyeM`. THIS CHECK WAS WRONG FIRST TIME AND THE WRONGNESS
//                IS THE POINT. It compared the two ANGULAR DIAMETERS and
//                demanded they agree to well under a per-cent; they differ by
//                4.45 per cent, because `aim` measures from the EYE and
//                `report` from the body CENTRE, and Forge's 600 km radius is 5
//                per cent of 1.2e7 m. A tighter tolerance would have "caught" a
//                planet's radius. The identity below has no tolerance to guess:
//                two code paths, one ephemeris, agreement to float precision.
(async () => {
  const of = window.__of;
  const B = window.__ofBodies;
  if (B === undefined) throw new Error('probe: __ofBodies is not installed');

  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const alt = OF_ARGS.alt ?? 2.0;
  const want = OF_ARGS.body ?? null;
  const sunDot = OF_ARGS.sunDot ?? null;
  const sunT = OF_ARGS.sunT ?? null;
  const pitchBias = OF_ARGS.pitchBias ?? 0;
  const yawBias = OF_ARGS.yawBias ?? 0;
  const fov = OF_ARGS.fov ?? null;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const w0 = of.world();
  of.teleport(lat, lon, alt);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (OF_ARGS.props === false) of.propsVisible(false);
  if (fov !== null) B.setFov(fov);
  if (OF_ARGS.debug === true) B.setDebug(true);
  if (OF_ARGS.relief !== undefined) B.setRelief(OF_ARGS.relief);
  if (OF_ARGS.detail !== undefined) B.setDetail(OF_ARGS.detail);

  // The sun is set AFTER the teleport, because `?sundot=` is solved once at
  // boot against the SPAWN's local up and a probe that teleports keeps the
  // phase and loses the elevation (RN-844). `of.setSunElev` re-solves here and
  // reports its miss, so an unreachable ask is visible rather than rounded.
  let sunSolve = null;
  if (sunT !== null) of.setTime(sunT);
  else if (sunDot !== null) sunSolve = of.setSunElev(sunDot);

  await of.settle(4);
  let aims = B.aim();
  let a = want === null ? aims[0] : aims.find((x) => x.name === want);
  if (a === undefined || a === null) {
    throw new Error(`probe: no body named ${want}; drawn = `
      + JSON.stringify(B.report().drawn) + ' reason=' + B.report().reason);
  }
  of.look(a.yawDeg + yawBias, a.pitchDeg + pitchBias);
  if (sunT !== null) of.setTime(sunT);
  await of.settle(30);

  // Re-read AFTER the settle: the aim is recomputed from the same ephemeris at
  // the instant the frame was taken, so what is reported is what was drawn.
  aims = B.aim();
  a = want === null ? aims[0] : aims.find((x) => x.name === want);
  const rep = B.report();
  const rb = rep.bodies.find((x) => x.name === a.name) ?? null;
  const w = of.world();
  const s = of.stats();
  const aimResid = rb === null ? null : (() => {
    const e = rep.eyeM;
    const dx = rb.posM[0] - e[0], dy = rb.posM[1] - e[1], dz = rb.posM[2] - e[2];
    return Math.abs(Math.hypot(dx, dy, dz) - a.distanceM) / a.distanceM;
  })();
  return {
    valid: w.tick > w0.tick && w.chunks.converged && rep.present,
    checks: {
      uvResidual: rep.uvResidual,
      refusedId: rep.refusedId,
      aimResid,
      reason: rep.reason,
    },
    aim: a,
    report: rep,
    sunSolve,
    sky: s.sky ?? null,
    camera: { lat, lon, alt, fov, yawDeg: a.yawDeg + yawBias, pitchDeg: a.pitchDeg + pitchBias },
    triangles: s.draw.triangles, drawCalls: s.draw.calls, programs: s.draw.programs,
  };
})()
