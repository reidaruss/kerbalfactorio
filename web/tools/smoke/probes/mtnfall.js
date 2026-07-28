// DIAGNOSTIC (physics lane): catch the tick a walker stops having a floor.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5457/ --scenario=walk \
//        --evalfile=tools/smoke/probes/mtnfall.js --evalargs='{"seed":991733}'
//
// mtncave.js dug an irregular chamber into a mountainside with a jittered aim
// (the way a person digs) and, on seed 991733, the walker LEFT THE WORLD:
// 14 of 18 stops read `underRock` 0/240, `grounded` 0/240, `pushM` 0 on every
// tick, and the feet radius fell without limit, 29 km below the surface by the
// last stop and still accelerating.
//
// `underRock` false with the feet 152 m under the heightfield means
// `VoxelCollider.floorBelow` returned NULL, and `pushM` 0 means
// `resolveEmbedded` returned null too. WG-31 handed the null case to
// `resolveEmbedded` on the grounds that null IS an embedded capsule and
// `resolveEmbedded` owns it. It does not own it in general: a capsule buried
// deeper than one cell in every direction has no free position to be pushed
// to, so `resolveEmbedded` declines, and then NOTHING owns the player.
//
// This probe runs the same seeded drive with the trace armed CONTINUOUSLY,
// including while walking, and reports the twenty ticks either side of the last
// tick the player was grounded. That is the entry, which is the part a fix
// needs and a per-stop summary cannot show.
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
  let seed = A.seed ?? 991733;
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

  const strikes = A.strikes ?? 44;
  for (let i = 0; i < strikes; ++i) {
    const yj = (rnd() - 0.5) * (A.yawJitterDeg ?? 50);
    const pj = (rnd() - 0.5) * (A.pitchJitterDeg ?? 50);
    of.look((yaw0.yaw + yj + 720) % 360, pj);
    of.dig();
    await of.run(0.18, 60);
    const roll = rnd();
    const keys = roll < 0.55 ? ['KeyW'] : roll < 0.7 ? ['KeyA'] : roll < 0.85 ? ['KeyD'] : [];
    if (keys.length > 0) await hold(0.26, keys);
  }
  await settle(2.5);

  // --- WALK THE SAME PATTERN WITH THE TRACE ARMED THROUGHOUT ---------------
  let s = [];
  const drain = () => { s = s.concat(of.stand().samples.filter((x) => Number.isFinite(x.feetR))); of.stand(true); };
  of.stand(true);
  const marks = [];
  for (let k = 0; k < (A.stops ?? 18); ++k) {
    const roll = rnd();
    const keys = roll < 0.4 ? ['KeyW'] : roll < 0.6 ? ['KeyS'] : roll < 0.8 ? ['KeyA'] : ['KeyD'];
    await hold(0.3 + rnd() * 0.4, keys);
    await settle(1.0);
    drain();
    marks.push({ k, keys: keys.join(''), tick: s.length });
    await settle(4);
    drain();
  }
  of.stand(false);
  let t = 0;
  s = s.map((x) => ({ ...x, t: t++ }));

  // The last tick the player was grounded, and what happened either side.
  let lastGrounded = -1;
  for (let i = 0; i < s.length; ++i) if (s[i].grounded) lastGrounded = i;
  const lostFloor = lastGrounded >= 0 && lastGrounded < s.length - 60;
  const row = (x) => ({ t: x.t, feetR: r6(x.feetR), terrainR: Number.isFinite(x.terrainR) ? r6(x.terrainR) : String(x.terrainR),
    groundR: Number.isFinite(x.groundR) ? r6(x.groundR) : String(x.groundR),
    preSnapR: r6(x.preSnapR), fallM: r6(x.fallM), underRock: x.underRock,
    grounded: x.grounded, pushM: r6(x.pushM), pushUpM: r6(x.pushUpM) });

  // Once the floor is gone, is there ANY authority left? This is the finding:
  // `floorBelow` answers null (an embedded capsule, which WG-31 handed to
  // `resolveEmbedded`) and `resolveEmbedded` ALSO answers null, because a
  // capsule inside bedrock has no free position within one cell on any axis.
  // Neither of them is wrong on its own terms. Together they own nothing.
  const afterLoss = lastGrounded < 0 ? null : {
    ticks: s.length - lastGrounded - 1,
    underRockTicks: s.slice(lastGrounded + 1).filter((x) => x.underRock).length,
    pushTicks: s.slice(lastGrounded + 1).filter((x) => x.pushM > 0).length,
    groundedTicks: s.slice(lastGrounded + 1).filter((x) => x.grounded).length,
    maxFallPerTickM: r6(Math.max(...s.slice(lastGrounded + 1).map((x) => -x.fallM))),
  };

  const p = P();
  const u = unit(p.feet);
  const sf = of.surface(u[0], u[1], u[2]);
  const feetR = Math.hypot(...p.feet);
  log.push(`${s.length} traced ticks; last grounded tick ${lastGrounded}; `
    + `final feetR ${r6(feetR)}, ${r3(bodyR + sf.surfaceM - feetR)} m under the surface, `
    + `underRock ${p.underRock}, grounded ${p.grounded}`);

  // `valid` is THE RUN WAS SET UP; `pass` is THE ASSERTIONS HELD. They are two
  // booleans on purpose, and it is `tunnelmouth.js`'s split for `tunnelmouth`'s
  // reason: a probe whose assertions are false under a true top-level boolean
  // is precisely how `tunnelwalk.js` stayed quietly red for days. THIS PROBE IS
  // EXPECTED TO REPORT pass:false ON CURRENT MAIN. It ships with the diagnosis
  // so that whoever closes the gap has a failing assertion to close it against.
  const checks = [
    ['a walker that loses its floor is caught by SOME authority within a second',
      !lostFloor || (afterLoss !== null && afterLoss.groundedTicks > 0),
      lostFloor ? `${afterLoss?.ticks} ticks with 0 grounded` : 'never lost the floor'],
    ['a buried capsule is pushed out by resolveEmbedded rather than declined',
      !lostFloor || (afterLoss !== null && afterLoss.pushTicks > 0),
      lostFloor ? `${afterLoss?.pushTicks} pushes in ${afterLoss?.ticks} ticks` : 'n/a'],
    ['the player never ends the run below the surface by more than the bore is deep',
      Math.abs(bodyR + sf.surfaceM - feetR) < 200,
      r3(bodyR + sf.surfaceM - feetR)],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);

  return {
    valid: true,
    pass: failed.length === 0,
    failed,
    seed: A.seed ?? 991733,
    site: { lat: r6(site.lat), lon: r6(site.lon), yaw: yaw0.yaw },
    tracedTicks: s.length,
    lostFloor,
    lastGroundedTick: lastGrounded,
    finalDepthBelowSurfaceM: r3(bodyR + sf.surfaceM - feetR),
    finalUnderRock: p.underRock,
    finalGrounded: p.grounded,
    // Once the floor is gone, is there ANY authority left?
    afterLoss,
    around: lastGrounded < 0 ? null
      : s.slice(Math.max(0, lastGrounded - 12), lastGrounded + 14).map(row),
    marks,
    log,
  };
})()
