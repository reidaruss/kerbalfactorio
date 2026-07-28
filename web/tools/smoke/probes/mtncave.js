// DIAGNOSTIC (physics lane): dig the way a PERSON digs, not the way a probe
// does, and stand still all over the result.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5457/ --scenario=walk \
//        --evalfile=tools/smoke/probes/mtncave.js
//
// Every measurement so far has been taken in a CLEAN BORE: one yaw, one pitch,
// evenly spaced strikes, a floor that is a tidy descending staircase. Reid dug
// through a mountain over a session, looking around while he did it, which
// leaves an irregular chamber with a lumpy floor, overhangs and pillars. If the
// walker's two ground authorities disagree on some particular floor shape, a
// tidy bore is exactly the shape least likely to produce it.
//
// So the aim is jittered on both axes from a seeded generator (repeatable: a
// defect found here has to be findable again), and the stand points are chosen
// by walking a random key pattern rather than by stepping down a line.
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
  // Seeded, so a chamber that breaks the walker can be dug again.
  let seed = A.seed ?? 20260727;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

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
  let yaw0 = null;
  for (let y = 0; y < 360; y += 15) {
    of.look(y, 0);
    await of.run(0.05, 60);
    const ray = of.aim();
    if (ray === null) continue;
    const u = unit(ray.origin);
    const f = unit(add(ray.dir, u, -dot(ray.dir, u)));
    const rise = hAt(unit(add(ray.origin, f, INTO_M))) - hAt(u);
    if (yaw0 === null || rise > yaw0.riseM) yaw0 = { yaw: y, riseM: rise };
  }
  if (yaw0 === null) return fail('no aim ray');

  // --- DIG LIKE A PERSON ----------------------------------------------------
  const strikes = A.strikes ?? 44;
  for (let i = 0; i < strikes; ++i) {
    const yj = (rnd() - 0.5) * (A.yawJitterDeg ?? 50);
    const pj = (rnd() - 0.5) * (A.pitchJitterDeg ?? 50);
    of.look((yaw0.yaw + yj + 720) % 360, pj);
    of.dig();
    await of.run(0.18, 60);
    // Sometimes step, sometimes strafe, sometimes stand and swing again.
    const roll = rnd();
    const keys = roll < 0.55 ? ['KeyW'] : roll < 0.7 ? ['KeyA'] : roll < 0.85 ? ['KeyD'] : [];
    if (keys.length > 0) await hold(0.26, keys);
  }
  await settle(2.5);

  // --- STAND ALL OVER IT ----------------------------------------------------
  const gTick = 9.81 / 3600;
  const STOP_S = A.stopSecs ?? 4;
  const STOPS = A.stops ?? 18;
  const stops = [];
  for (let k = 0; k < STOPS; ++k) {
    const roll = rnd();
    const keys = roll < 0.4 ? ['KeyW'] : roll < 0.6 ? ['KeyS'] : roll < 0.8 ? ['KeyA'] : ['KeyD'];
    await hold(0.3 + rnd() * 0.4, keys);
    await settle(1.0);
    of.stand(true);
    await settle(STOP_S);
    const d = of.stand();
    of.stand(false);
    const s = d.samples.filter((x) => Number.isFinite(x.feetR));
    if (s.length < 60) continue;
    const p = P();
    const u = unit(p.feet);
    const sf = of.surface(u[0], u[1], u[2]);
    const feetR = Math.hypot(...p.feet);
    const rs = s.map((x) => x.feetR);
    let ups = 0, downs = 0, bigUp = 0;
    const upT = [];
    for (let i = 1; i < s.length; ++i) {
      const dd = s[i].feetR - s[i - 1].feetR;
      if (dd > gTick * 1.5) { ups++; upT.push(s[i].tick); if (dd > bigUp) bigUp = dd; }
      else if (dd < -gTick * 1.5) downs++;
    }
    const per = [];
    for (let i = 1; i < upT.length; ++i) per.push(upT[i] - upT[i - 1]);
    stops.push({
      k, keys: keys.join(''), ticks: s.length,
      feetR: r6(feetR), overheadM: r3(bodyR + sf.surfaceM - feetR),
      loweringM: r3(sf.loweringM),
      underRockTicks: s.filter((x) => x.underRock).length,
      underRockFlips: s.filter((x, i) => i > 0 && x.underRock !== s[i - 1].underRock).length,
      groundedTicks: s.filter((x) => x.grounded).length,
      spreadM: r6(Math.max(...rs) - Math.min(...rs)),
      ups, downs, biggestUpM: r6(bigUp),
      meanPeriodTicks: per.length === 0 ? null : r6(per.reduce((a, b) => a + b, 0) / per.length),
      pushTicks: s.filter((x) => x.pushM > 0).length,
      maxPushM: r6(Math.max(0, ...s.map((x) => x.pushM))),
      ratifyingTicks: s.filter((x) => x.underRock && Math.abs(x.terrainR - x.preSnapR) < 1e-9).length,
      blockedByRock: p.blockedByRock,
      series: s.slice(0, 30).map((x) => [x.tick, r6(x.feetR - Math.min(...rs)),
        r6(x.terrainR - Math.min(...rs)), r6(x.preSnapR - Math.min(...rs)),
        x.underRock ? 1 : 0, x.grounded ? 1 : 0, r6(x.pushM)]),
    });
  }
  const moved = stops.filter((x) => x.spreadM > 1e-6);
  const vx = of.voxels();
  log.push(`${vx.removedCells} cells removed over ${strikes} jittered strikes; `
    + `${stops.length} stops, ${moved.length} of them moved the feet`);
  const worst = stops.slice().sort((a, b) => b.spreadM - a.spreadM)[0] ?? null;
  return {
    valid: stops.length > 0,
    seed: A.seed ?? 20260727,
    site: { lat: r6(site.lat), lon: r6(site.lon), yaw: yaw0.yaw },
    removedCells: vx.removedCells,
    reproduced: moved.length > 0,
    worst,
    stops: stops.map((x) => ({ ...x, series: undefined })),
    log,
  };
})()
