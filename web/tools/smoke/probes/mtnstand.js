// PHASE 2 of the reload experiment (physics lane): walk back into a tunnel that
// came out of IndexedDB and stand still in it for a long time.
//
// Driven by tools/smoke/mtnreload.mjs with the site phase 1 returned. Nothing
// here digs: every metre of this tunnel was restored, not cut.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const log = [];
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

  await settle(2.0);
  if (of.voxels() === null) return fail('no character');
  const restored = of.voxels().removedCells;
  if (restored <= 0) return fail('no voxel edits came back from the save', { restored });
  log.push(`${restored} removed cells restored from IndexedDB`);

  const bodyR = of.world().bodyRadiusM;
  of.teleport(A.latDeg, A.lonDeg, 0);
  await settle(2.5);
  of.look(A.yaw, 0);
  await settle(0.5);

  // Walk in. No dig key is pressed anywhere in this file.
  let reached = P().underRock ? 'spawn' : null;
  const walk = [];
  for (let i = 0; i < 40 && reached === null; ++i) {
    await hold(0.35, ['KeyW']);
    await of.run(0.15, 60);
    const p = P();
    walk.push({ i, feetR: r6(Math.hypot(...p.feet)), underRock: p.underRock, grounded: p.grounded });
    if (p.underRock) reached = 'walked';
  }
  if (reached === null) return fail('never got under rock after the reload', { walk, restored, log });
  // A few more steps so the stand is under intact roof and not in the doorway.
  for (let i = 0; i < (A.extraLegs ?? 8); ++i) { await hold(0.35, ['KeyW']); await of.run(0.15, 60); }
  await settle(2.5);

  const p0 = P();
  if (!p0.underRock) return fail('walked back out of the tunnel', { p0 });
  const u0 = unit(p0.feet);
  const sf0 = of.surface(u0[0], u0[1], u0[2]);
  const feetR0 = Math.hypot(...p0.feet);
  const overheadM = bodyR + sf0.surfaceM - feetR0;
  log.push(`standing under ${r3(overheadM)} m of restored rock, lowering ${r3(sf0.loweringM)} m`);

  // --- STAND STILL, PER TICK, FOR A LONG TIME ------------------------------
  const gTick = 9.81 / 3600;
  const SLICE_S = A.sliceSecs ?? 5;
  const SLICES = A.slices ?? 10;
  of.stand(true);
  let s = [];
  for (let k = 0; k < SLICES; ++k) {
    await settle(SLICE_S);
    s = s.concat(of.stand().samples.filter((x) => Number.isFinite(x.feetR)));
    of.stand(true);
  }
  of.stand(false);
  let t = 0;
  s = s.map((x) => ({ ...x, t: t++ }));
  const rs = s.map((x) => x.feetR);
  const minR = Math.min(...rs);
  const ups = [], downs = [];
  for (let i = 1; i < s.length; ++i) {
    const d = s[i].feetR - s[i - 1].feetR;
    if (d > gTick * 1.5) ups.push({ t: s[i].t, dM: r6(d), push: r6(s[i].pushM) });
    else if (d < -gTick * 1.5) downs.push({ t: s[i].t, dM: r6(d) });
  }
  const periods = [];
  for (let i = 1; i < ups.length; ++i) periods.push(ups[i].t - ups[i - 1].t);
  return {
    valid: true,
    restoredCells: restored,
    site: { latDeg: A.latDeg, lonDeg: A.lonDeg, yaw: A.yaw },
    overheadRockM: r3(overheadM),
    loweringM: r3(sf0.loweringM),
    still: {
      ticks: s.length,
      spreadM: r6(Math.max(...rs) - minR),
      oneTickOfGravityM: r6(gTick),
      snapUps: ups.length,
      snapDowns: downs.length,
      biggestUpM: ups.length === 0 ? null : r6(Math.max(...ups.map((x) => x.dM))),
      meanPeriodTicks: periods.length === 0 ? null
        : r6(periods.reduce((a, b) => a + b, 0) / periods.length),
      periodsTicks: periods.slice(0, 30),
      underRockTicks: s.filter((x) => x.underRock).length,
      underRockFlips: s.filter((x, i) => i > 0 && x.underRock !== s[i - 1].underRock).length,
      groundedTicks: s.filter((x) => x.grounded).length,
      pushTicks: s.filter((x) => x.pushM > 0).length,
      ratifyingTicks: s.filter((x) => x.underRock && Math.abs(x.terrainR - x.preSnapR) < 1e-9).length,
    },
    ups: ups.slice(0, 40),
    seriesM: s.filter((_, i) => i % 6 === 0).map((x) => [x.t, r6(x.feetR - minR),
      r6(x.terrainR - minR), r6(x.preSnapR - minR), x.underRock ? 1 : 0,
      x.grounded ? 1 : 0, r6(x.pushM)]),
    log,
  };
})()
