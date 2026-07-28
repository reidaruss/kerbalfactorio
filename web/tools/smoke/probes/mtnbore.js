// PHASE 1 of the reload experiment (physics lane): find a mountainside, bore a
// tunnel into it, walk in, and make sure the world has been SAVED.
//
// Driven by tools/smoke/mtnreload.mjs. It returns the site and the facing so
// phase 2, after a real browser reload, can walk back into the same tunnel.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
  const DEG = 180 / Math.PI;
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const fail = (why, extra) => ({ valid: false, fail: why, ...extra, log });
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const P = () => of.world().player;
  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;

  await settle(1.5);
  if (of.voxels() === null) return fail('no character, nothing can dig');
  const w0 = of.world();
  const bodyR = w0.bodyRadiusM;
  const uFeet = unit(w0.player.feet);
  const lat0 = A.latDeg ?? Math.asin(uFeet[1]) * DEG;
  const lon0 = A.lonDeg ?? Math.atan2(uFeet[2], uFeet[0]) * DEG;

  const INTO_M = A.intoM ?? 30;
  let site = null;
  const span = A.spanDeg ?? 0.30, step = A.stepDeg ?? 0.02;
  for (let a = -span; a <= span + 1e-9; a += step) {
    for (let b = -span; b <= span + 1e-9; b += step) {
      const la = ((lat0 + a) * Math.PI) / 180, lo = ((lon0 + b) * Math.PI) / 180;
      const u = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
      const h0 = hAt(u);
      if (h0 < 0) continue;
      const north = unit(add([0, 1, 0], u, -dot([0, 1, 0], u)));
      const east = cross(north, u);
      const ang = INTO_M / bodyR;
      let bestRise = -Infinity;
      for (let i = 0; i < 8; ++i) {
        const th = (Math.PI * i) / 4;
        const w = add(add([0, 0, 0], north, Math.cos(th)), east, Math.sin(th));
        const d = unit(add(add([0, 0, 0], u, Math.cos(ang)), w, Math.sin(ang)));
        const rise = hAt(d) - h0;
        if (rise > bestRise) bestRise = rise;
      }
      if (site === null || bestRise > site.riseM) site = { lat: lat0 + a, lon: lon0 + b, riseM: bestRise };
    }
  }
  if (site === null) return fail('no land in the sweep');
  of.teleport(site.lat, site.lon, 0);
  await settle(2.0);
  let bestYaw = null;
  for (let y = 0; y < 360; y += 15) {
    of.look(y, 0);
    await of.run(0.05, 60);
    const ray = of.aim();
    if (ray === null) continue;
    const u = unit(ray.origin);
    const f = unit(add(ray.dir, u, -dot(ray.dir, u)));
    const rise = hAt(unit(add(ray.origin, f, INTO_M))) - hAt(u);
    if (bestYaw === null || rise > bestYaw.riseM) bestYaw = { yaw: y, riseM: rise };
  }
  if (bestYaw === null) return fail('no aim ray');

  const strikes = A.strikes ?? 26;
  for (let i = 0; i < strikes; ++i) {
    of.look(bestYaw.yaw, A.pitchDeg ?? 0);
    of.dig();
    await of.run(0.2, 60);
    await hold(A.stepSecs ?? 0.30, ['KeyW']);
  }
  await settle(2.0);
  const p0 = P();
  const u0 = unit(p0.feet);
  const sf0 = of.surface(u0[0], u0[1], u0[2]);
  const feetR = Math.hypot(...p0.feet);

  // A SAVE HAS TO HAVE HAPPENED or phase 2 walks into pristine rock and the
  // whole experiment measures nothing. The autosave is on the sim clock at
  // 20 s, so run past it and then read the counter rather than assuming.
  const before = of.game()?.persist?.saves ?? null;
  await settle(23);
  const after = of.game()?.persist?.saves ?? null;
  const vx = of.voxels();
  log.push(`bored ${strikes} strikes at ${site.lat.toFixed(4)},${site.lon.toFixed(4)} `
    + `yaw ${bestYaw.yaw}; removed ${vx.removedCells} cells; saves ${before} -> ${after}`);
  return {
    valid: after !== null && after > 0,
    site: { latDeg: site.lat, lonDeg: site.lon, yaw: bestYaw.yaw },
    feetR: r6(feetR),
    overheadM: r3(bodyR + sf0.surfaceM - feetR),
    underRock: p0.underRock,
    removedCells: vx.removedCells,
    ops: vx.ops,
    saves: after,
    log,
  };
})()
