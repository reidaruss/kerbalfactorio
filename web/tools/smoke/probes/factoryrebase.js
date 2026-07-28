// FS-89: DOES THE BASE SURVIVE A FLOATING-ORIGIN REBASE?
//
// THE QUESTION, and why it is asked at all. The world-gen lane proved that every
// scattered prop detaches on a rebase: a driven 4 km walk measured `staleMaxM`
// 4,000.089191 m across 43 of 43 chunks, the rebase delta to six decimals, and it
// DECAYED rather than snapping back (43 stale to 23 over five seconds) because a
// chunk was only re-placed when it happened to be rebuilt at one per frame. So
// for about ten seconds after every four kilometres of walking, the world's
// entire ground cover was four kilometres away.
//
// The scatter was one of several things composing an engine transform, and
// nothing audits whether every such consumer is on the rebase hook. If buildings
// are not, Reid's roughly 140-structure base detaches and flies four kilometres
// away the first time he walks anywhere, which is strictly worse than the ground
// cover doing it, and he has been fast-travelling, so nobody would have seen it.
//
// WHY NOTHING HAS CAUGHT THIS, AND WHY IT APPLIES TO THIS LANE'S PROBES TOO.
// EVERY probe on this project teleports. A teleport moves the player 4 km in one
// step, so every resident chunk falls outside the radius, is dropped and rebuilt,
// and the stale matrices are released before a frame is drawn. The defect
// requires the player to ARRIVE at the rebase continuously, with the ground under
// their feet already placed. `beltsnap`, `shortline`, `autoline`, `machineports`
// and `rescale` all place buildings and then teleport, which is precisely the
// blind spot, so this probe walks and never teleports. That is the only reason it
// can see anything.
//
// THE INSTRUMENT IS A SUBTRACTION, NOT A PICTURE. At four kilometres a detached
// building is not a wrong-looking building, it is an ABSENT one, and "the base
// vanished" is equally consistent with a pool refusal, a streaming stall and a
// culling bug. `staleMaxM` is the distance between where a building is drawn and
// where it now is, so it reads non-zero for EXACTLY ONE REASON and its magnitude
// names the delta. See `FactoryStale.ts`.
//
// THE BOUND IS NOT A HARD ZERO HERE, AND THE REASON IS THE FINDING. The scatter
// probe asserts an exact 0 because both of its readings are f64. This one cannot,
// and it is worth being precise about why rather than quietly widening a
// threshold, which is the thing standing rule 11 warns about by name.
//
// `MachineBatch.matrixAt` reads the matrix back out of the `BatchedMesh`, and a
// BatchedMesh stores instance matrices as FLOAT32 because they are on their way
// to the GPU. So the comparison is an f64 composition against a float32
// round-trip of itself, and the residual is quantisation, not staleness.
// Measured at a 200 m rebase threshold: worst 1.2465e-5 m, which is about half a
// float32 ULP at 200 m (200 * 2^-23 = 2.4e-5). It is a floor, not a drift.
//
// So the bound is DERIVED from that floor rather than picked: four ULP of the
// engine-space magnitude, which is the rebase threshold, because no instance can
// be further from the origin than that. What makes the assertion worth anything
// is the separation, and it is not close: a DETACHED instance is stale by the
// full rebase delta, so at a 200 m threshold the defect reads 200 m against a
// bound of 9.5e-5 m, a factor of about two million. `staleFraction` is reported
// beside the metres for exactly this reason, because it is scale free: rounding
// is order 1e-7 of the delta and a detachment is 1.0 of it.
//
// `rebasesObserved` IS A VALIDITY TERM, NOT A REPORTED CURIOSITY. A walk that
// never crossed the threshold has tested nothing, and a probe that returns green
// for it is worse than no probe. `drawnParts` is the second validity term for the
// same reason: a zero measured over zero buildings is the cheapest and most
// expensive kind of green there is.
//
// `?rebase=` IS WHAT MAKES THIS FIT IN A SMOKE BUDGET. `Config.rebaseM` is
// `max(16, num(p, 'rebase', 4000))`, so a low threshold forces real rebases
// inside a walk of a few hundred metres. The DEFECT does not care what the
// threshold is: the scatter failure was the full delta whatever the delta was,
// because the mechanism is a cached transform and not a magnitude.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(name);
    log.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : `  ${detail}`}`);
    return ok;
  };
  const view = () => mustHave(of.game(), 'view', 'game()');
  const fac = () => of.game().factory;
  const rebases = () => mustNum(of.world().origin, 'rebases', 'world().origin');
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return [o[0], o[1], o[2]]; };

  await sleep(0.6);
  // Not published by the client, so it is reported from the flag the runner was
  // given rather than invented here. The assertion below is on rebasesObserved,
  // which is the fact that matters, not on the threshold that produced it.
  const threshold = OF_ARGS.rebaseM ?? null;
  log.push(`rebase threshold ${threshold} m`);

  // --- lay a real line through the real ghost --------------------------------
  // Four belt tiles and a smelter, placed the way a player places them. It does
  // NOT need to be a big base: the defect is per instance and one detached
  // building proves it exactly as well as a hundred, and a small scene leaves
  // the budget for the walk, which is the part that cannot be shortened.
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const ghostAt = async (y, p) => { of.look(y, p); await sleep(0.035); return of.build().ghost; };
  let yaw = of.world().observer.yawDeg;
  of.build(2);
  await sleep(0.2);
  {
    let best = yaw;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = best;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(best + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = best + k * step; }
      }
      best = by;
    }
    yaw = best;
  }
  const sweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g !== null && g.ok) sweep.push({ pitch: p, reachM: gdist(g.pos, eye()) });
  }
  const tailAim = sweep.filter((s) => s.reachM <= 5.5)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { valid: false, why: 'no belt cell in reach', log };
  of.look(yaw, tailAim.pitch);
  await sleep(0.2);
  await placeHere();
  const first = fac().list[0];
  if (first === undefined) return { valid: false, why: 'the first press placed nothing', log };
  let laid = 1;
  for (let n = 0; n < 3; ++n) {
    let aimed = null;
    const last = fac().list[fac().list.length - 1];
    for (let p = tailAim.pitch - 0.1 - n * 0.9; p >= -52 && aimed === null; p -= 0.15) {
      const g = await ghostAt(yaw, p);
      if (g === null || !g.ok || g.prospective === true) continue;
      const d = gdist(g.pos, last.pos);
      if (d > 1.45) break;
      if (d > 0.6) aimed = p;
    }
    if (aimed === null) break;
    of.look(yaw, aimed);
    await sleep(0.2);
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) laid++;
  }
  of.build(0);
  await sleep(0.4);
  log.push(`laid ${laid} belt tiles`);

  // FOUR FLOAT32 ULP AT THE LARGEST ENGINE MAGNITUDE ANY INSTANCE CAN HAVE, which
  // is the rebase threshold itself. Derived, not picked: see the header. Falls
  // back to the shipped 4 km default when the runner did not say, which makes the
  // bound LOOSER and is therefore the safe direction for a fallback.
  const engineMaxM = threshold === null ? 4000 : threshold;
  const roundingM = engineMaxM * Math.pow(2, -23) * 4;
  log.push(`float32 readback floor: bound ${roundingM.toExponential(3)} m `
    + `at an engine magnitude of ${engineMaxM} m`);
  const st0 = view().staleMaxM;
  const drawn0 = view().drawnParts;
  // BEFORE THE WALK, so a base that was already stale cannot be reported as a
  // walk that broke it. The scatter probe makes the same check for the same
  // reason: a control that cannot tell "already wrong" from "made wrong" is not
  // measuring the thing in its name.
  check('notStaleBeforeTheWalk', st0 < roundingM,
    `staleMaxM ${st0.toExponential(4)} m over ${drawn0} drawn, `
    + `bound ${roundingM.toExponential(3)} m`);
  check('somethingIsDrawn', drawn0 >= 2, `drawnParts ${drawn0}`);

  // --- WALK. Never teleport. -------------------------------------------------
  const r0 = rebases();
  const home = fac().list.map((b) => ({ id: b.id, pos: b.pos.slice() }));
  let worstStale = 0;
  let worstAt = null;
  let staleSlices = 0;
  const slices = [];
  // Face away from the line and hold W. Sampling every slice, because the
  // scatter failure DECAYED over about ten seconds rather than persisting, so a
  // single reading taken at the end of the walk would have missed it entirely.
  of.look(yaw + 180, -6);
  for (let i = 0; i < 90; ++i) {
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.0);
    const s = view();
    if (s.staleMaxM > worstStale) { worstStale = s.staleMaxM; worstAt = i; }
    if (s.staleMaxM > 0) staleSlices++;
    if (i % 10 === 0 || s.staleMaxM > 0) {
      slices.push({ slice: i, rebases: rebases() - r0,
        staleMaxM: s.staleMaxM, staleParts: s.staleParts, drawnParts: s.drawnParts });
    }
    if (rebases() - r0 >= 2 && i > 20) break;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.6);

  const rebasesObserved = rebases() - r0;
  const after = view();
  // THE BODY-FRAME POSITIONS MUST NOT HAVE MOVED EITHER. A rebase is a change of
  // engine origin and nothing else, so the saved coordinates of the base are the
  // one thing in this test that is not allowed to be different at the end. If
  // these moved, the plan itself was rewritten, which no probe above would catch
  // because every drawn matrix would agree with the new, wrong, plan.
  const moved = fac().list.map((b) => {
    const was = home.find((h) => h.id === b.id);
    return was === undefined ? 0 : gdist(b.pos, was.pos);
  });
  const worstMoved = moved.length === 0 ? -1 : Math.max(...moved);

  check('theWalkCrossedARebase', rebasesObserved >= 1,
    `${rebasesObserved} rebase(s) over ${slices.length} sampled slices`);
  check('stillDrawn', after.drawnParts === drawn0,
    `drawnParts ${drawn0} -> ${after.drawnParts}`);
  // THE HEADLINE. A detached instance is stale by the WHOLE rebase delta, so this
  // is the assertion that separates "the base flew four kilometres away" from
  // "float32 rounded in the seventh decimal", and the two are seven orders of
  // magnitude apart.
  check('nothingWentStaleDuringTheWalk', worstStale < roundingM,
    `worst staleMaxM ${worstStale.toExponential(4)} m`
    + (worstAt === null ? '' : ` at slice ${worstAt}`)
    + `, bound ${roundingM.toExponential(3)} m, which is `
    + `${(worstStale / engineMaxM).toExponential(2)} of one rebase delta `
    + `against 1.0 for a detachment`);
  check('nothingIsStaleNow', after.staleMaxM < roundingM,
    `staleMaxM ${after.staleMaxM.toExponential(4)} m over ${after.drawnParts} drawn`);
  check('thePlanDidNotMove', worstMoved === 0,
    `worst body-frame displacement ${worstMoved} m`);

  return {
    valid: rebasesObserved >= 1 && drawn0 >= 2,
    pass: fails.length === 0 && rebasesObserved >= 1 && drawn0 >= 2,
    fails, rebaseThresholdM: threshold, rebasesObserved,
    drawnParts: after.drawnParts, staleMaxM: after.staleMaxM,
    worstStaleM: worstStale, staleSlices, worstBodyFrameMoveM: worstMoved,
    roundingBoundM: roundingM,
    staleFraction: worstStale / engineMaxM,
    slices, log,
  };
})()
