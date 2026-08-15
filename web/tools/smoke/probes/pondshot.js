// pondshot.js - frame the pond for a capture, and report what is in the frame
// so the picture is never the only evidence (WG-44).
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/pondshot.js
//
// Every OF_ARGS field below carries a safe default, so no --evalargs is
// required to run this.
//
// OF_ARGS: { distM, altM, pitchDeg, bearingDeg, swim }
//   distM/bearingDeg place the camera relative to the POND CENTRE, not the
//   spawn, so a moved pond moves the shot. `swim: true` drives the player into
//   the middle and lets buoyancy settle them at the float line first.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });

  const w0 = of.world();
  const R = w0.bodyRadiusM;
  const wq = of.water(w0.player.feet[0], w0.player.feet[1], w0.player.feet[2]);
  const disc = wq.disc;
  if (disc === null) return { valid: false, why: 'no pond' };

  const ux = disc.dirX, uy = disc.dirY, uz = disc.dirZ;
  let ex = -uz, ey = 0, ez = ux;
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const at = (distM, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang), t = distM / R;
    let dx = ux + t * (c * ex + s * nx);
    let dy = uy + t * (c * ey + s * ny);
    let dz = uz + t * (c * ez + s * nz);
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  };
  const headingOf = (dx, dy, dz) =>
    Math.atan2(dx * nx + dy * ny + dz * nz, dx * ex + dy * ey + dz * ez);

  const ang = ((A.bearingDeg ?? 0) * Math.PI) / 180;
  const distM = A.distM ?? 26;
  const here = at(distM, ang);
  const g = of.latlon(here[0], here[1], here[2]);
  of.teleport(g.latDeg, g.lonDeg, A.altM ?? 2);
  await of.settle(20);

  // Yaw is calibrated the same way pondwade.js calibrates it, for the same
  // reason: a shot aimed by an assumed convention photographs whatever happens
  // to be there instead of the subject.
  const sample = async (yawDeg) => {
    of.teleport(g.latDeg, g.lonDeg, 2);
    await of.settle(8);
    of.look(yawDeg, 0);
    const a = of.world().player.feet.slice();
    of.input.tape([{ hold: 90, actions: ['forward'] }]);
    await of.run(0.6, 60);
    await yield0();
    const b = of.world().player.feet;
    of.input.tape([{ hold: 20, actions: [] }]);
    await of.run(0.1, 60);
    return headingOf(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };
  const h0 = await sample(0);
  const h90 = await sample(90);
  let dh = h90 - h0;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  const sign = dh >= 0 ? 1 : -1;
  const yawFor = (h) => {
    let e = (h - h0) * sign;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    return (e * 180) / Math.PI;
  };

  of.teleport(g.latDeg, g.lonDeg, A.altM ?? 2);
  await of.settle(16);
  const inward = yawFor(ang + Math.PI);
  of.look(inward, A.pitchDeg ?? -8);

  if (A.swim) {
    // Walk to the middle and stop. Buoyancy then settles the capsule at the
    // float line with no further input, which is the state worth photographing.
    of.input.tape([{ hold: 900, actions: ['forward'] }]);
    for (let i = 0; i < 780; ++i) {
      await of.run(1 / 60, 60);
      if ((i & 15) === 15) await yield0();
      const p = of.world().player.feet;
      const pr = Math.hypot(p[0], p[1], p[2]);
      const d = R * Math.hypot(p[0] / pr - ux, p[1] / pr - uy, p[2] / pr - uz);
      if (d < 2.0) break;
    }
    of.input.tape([{ hold: 240, actions: [] }]);
    await of.run(2.0, 60);
    of.look(inward, A.pitchDeg ?? -8);
  }
  await of.settle(24);
  await yield0();

  const w = of.world();
  const p = w.player.feet;
  const pr = Math.hypot(p[0], p[1], p[2]);
  const sw = of.swim();
  const here2 = of.water(p[0] / pr, p[1] / pr, p[2] / pr);
  return {
    valid: w.tick > 60,
    tick: w.tick,
    distFromCentreM: R * Math.hypot(p[0] / pr - ux, p[1] / pr - uy, p[2] / pr - uz),
    yawDeg: inward,
    // What the camera is actually standing in, so the caption is measured.
    waterDepthUnderFeetM: here2.depthM,
    swim: sw,
    pond: { shorelineM: disc.shorelineM, levelM: disc.levelM, maxDepthM: disc.maxDepthM },
    biome: w.biome,
    surfaceHereM: w.surfaceHeightM,
  };
})()
