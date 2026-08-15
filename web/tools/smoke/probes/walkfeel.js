// WALK FEEL. The playtest complaint, verbatim: "moving across the ground feels
// like you are always getting stuck unless you jump."
//
//   node tools/smoke/run.mjs --evalfile=tools/smoke/probes/walkfeel.js
//
// The headline number is metres TRAVELLED over metres COMMANDED on ordinary
// ground with the jump key never pressed. A walker that is snagging returns a
// ratio well under 1 and a large stallTicks count; a walker that is fine returns
// a ratio at 1 and a handful of stalls.
//
// DW-20. Every leg is driven through of.run() on the synthetic clock, which is
// the ONLY thing in this client that reliably advances the 60 Hz fixed tick
// headless: input is drained by fixedTick, not by the render frame, so a probe
// that waits on requestAnimationFrame reads state that no tick has touched. The
// per-sample tick delta is read back from world().tick and every rate below is
// divided by the ticks that actually ran, so a run that advanced nothing reports
// nothing rather than reporting zeros as success.
//
// THE NEGATIVE CONTROL is a vertical rock wall: sink a shaft with the dig key,
// stand at the bottom and walk into its side. A step-up generous enough to make
// rough ground smooth is also generous enough to walk a player up a cliff, and
// this is the check that catches it. The wall height is whatever the shaft
// actually reached and the control refuses to grade itself below 2.5 m, because
// 2.5 m is more than double the largest ledge the voxel resolver is allowed to
// climb (VoxelCollision STEP_UP_M tops out at 1.1 m) and four times the surface
// step tolerance, so a climb-out cannot be mistaken for a legal step.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const DT = 1 / 60;
  const EYE_M = 1.62;          // CAPSULE.eyeHeightM
  const FOOT_SAMPLE_M = 0.15;  // CAPSULE_SAMPLES_M[0]
  const walkMps = of.config.walkSpeedMps;
  const legSecs = A.legSecs ?? 4;
  const yaws = A.yaws ?? [0, 90, 180, 270];
  // Ticks discarded at the head of a leg: groundAccel 34 m/s^2 needs 0.135 s to
  // reach 4.6 m/s, so counting the ramp as a stall would libel every leg.
  const WARMUP = A.warmup ?? 12;
  // A tick that covered less than this fraction of its commanded distance while
  // a direction key was held is a stall. A quarter is deliberately lenient: it
  // catches "did not move" and not "moved slightly slower".
  const STALL_FRAC = 0.25;
  // GP-875 to GP-889. The validity gate used to require `walkTicks > 500` and
  // `(w.tick - start.tick) > 800`, sized for a host that delivers close to the
  // ~960 ticks phase 1 actually asks the fixed clock for (four legs of
  // `legSecs * 60` ticks each). MEASURED REPEATEDLY on Reid's Windows desktop,
  // `of.run` does not deliver that here: `walkTicks` lands anywhere from about
  // a fifth to two-fifths of what was asked, while every reading computed FROM
  // those ticks (`surface.ratio`, `stallPct`, the wall's own `wallHolds`) is
  // healthy on every single run. The floor was grading HOST THROUGHPUT, not
  // walking feel, and a correct walk on a loaded host read red forever.
  //
  // The fix does not loosen what "healthy" means (STALL_FRAC and the wall's
  // own bounds are untouched below); it changes what "enough happened to
  // trust the reading" means. MIN_SIGNAL_TICKS is not a throughput target: 60
  // ticks is one second of the fixed clock, comfortably below the worst this
  // host has ever measured (203) and is only large enough to keep a ratio
  // computed over a handful of ticks from being called a verdict. What still
  // makes a genuinely broken walk fail is `legMinFrac` just below: it compares
  // each leg's ticks against what THIS RUN, ON THIS HOST, actually delivered
  // to its OTHER legs, so a stall confined to one heading (a muted axis, a
  // freeze on one bearing) cannot hide behind three healthy ones the way a
  // single combined floor could.
  const MIN_SIGNAL_TICKS = 60;
  const LEG_MIN_FRAC = 0.25;

  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const len = (p) => Math.hypot(p[0], p[1], p[2]);
  const posOf = (w) => [w.eyeRel[0] + w.origin.x, w.eyeRel[1] + w.origin.y,
    w.eyeRel[2] + w.origin.z];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
    await yield0();
  };

  // The column under a body-frame point: the ONE surface authority, asked once.
  const column = (p) => {
    const r = len(p);
    const u = [p[0] / r, p[1] / r, p[2] / r];
    const s = of.surface(u[0], u[1], u[2]);
    return { r, u, s };
  };

  /**
   * Hold `keys` for `secs` and sample EVERY tick. of.run(1/60, 60) advances one
   * fixed tick, so this is a per-tick trace and not a per-frame one.
   */
  const drive = async (label, secs, keys, traceTicks = 0) => {
    const ticks = Math.ceil(secs * 60);
    of.input.tape([{ hold: ticks + 120, keys }]);
    const moving = keys.some((k) => k === 'KeyW' || k === 'KeyS'
      || k === 'KeyA' || k === 'KeyD');
    let w = of.world();
    const t0 = w.tick;
    let prev = posOf(w);
    let prevTick = w.tick;
    let prevGrounded = w.player.grounded;
    const leg = {
      label, ticks: 0, travelledM: 0, commandedM: 0, stallTicks: 0,
      airborneTransitions: 0, largestStepM: 0, largestDropM: 0,
      pushTicks: 0, maxPushM: 0, blockedTicks: 0, phantomSolidTicks: 0,
      proudHalfMetreTicks: 0,
      airTicks: 0, minSlopeCos: 1, maxFloatM: 0, worstTick: null, trace: [],
      // Radial rise over the LAST quarter of the leg. A wall converges to zero
      // here; a ladder does not, however slowly it climbs.
      riseTailM: 0,
    };
    const bodyR = w.bodyRadiusM;
    for (let i = 0; i < ticks; ++i) {
      await of.run(DT, 60);
      if ((i & 7) === 7) await yield0();
      w = of.world();
      const dTick = w.tick - prevTick;
      prevTick = w.tick;
      if (dTick <= 0) continue;
      const p = posOf(w);
      const dR = len(p) - len(prev);
      const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      const dT = Math.sqrt(Math.max(0, d * d - dR * dR));
      prev = p;
      const g = w.player.grounded;
      if (prevGrounded && !g) leg.airborneTransitions++;
      prevGrounded = g;
      if (i < WARMUP) continue;
      leg.ticks += dTick;
      leg.travelledM += dT;
      const want = walkMps * DT * dTick;
      if (moving) leg.commandedM += want;
      if (!g) leg.airTicks += dTick;
      if (w.player.blockedByRock) leg.blockedTicks += dTick;
      if (w.player.voxelPushM > 1e-6) leg.pushTicks += dTick;
      if (w.player.voxelPushM > leg.maxPushM) leg.maxPushM = w.player.voxelPushM;
      if (g && w.player.slopeCos < leg.minSlopeCos) leg.minSlopeCos = w.player.slopeCos;
      if (moving && dT < STALL_FRAC * want) {
        leg.stallTicks += dTick;
        if (leg.worstTick === null || dT < leg.worstTick.dT) {
          leg.worstTick = {
            dT: +dT.toFixed(4), dR: +dR.toFixed(3), grounded: g,
            speedMps: +w.player.speedMps.toFixed(2),
            slopeCos: +w.player.slopeCos.toFixed(3),
            voxelPushM: +w.player.voxelPushM.toFixed(3),
            blockedByRock: w.player.blockedByRock,
            underRock: w.player.underRock,
          };
        }
      }
      if (g && dR > leg.largestStepM) leg.largestStepM = dR;
      if (g && -dR > leg.largestDropM) leg.largestDropM = -dR;
      if (i >= ticks * 0.75) leg.riseTailM += dR;
      if (leg.trace.length < traceTicks) {
        leg.trace.push([+dT.toFixed(3), +dR.toFixed(3), g ? 1 : 0,
          w.player.underRock ? 1 : 0, w.player.blockedByRock ? 1 : 0,
          +w.player.voxelPushM.toFixed(3)]);
      }
      // THE PHANTOM COLLIDER TEST. Ask the ONE oracle both of its questions
      // about the same point: the point 0.15 m of clear air above the WALKABLE
      // surface of the column the player is standing in, which is where the
      // capsule's lowest sample sits when the feet are on the ground. Is the
      // voxel cell containing that point solid?
      //
      // It must not be, and when it is, the walker is colliding with rock that
      // is not there. Deliberately sampled from the surface and not from the
      // player, so it reports the state of the GROUND rather than the state the
      // resolver has already pushed the player into: a post-resolution sample
      // always reads clear, which is what makes this bug invisible from the
      // player's own position.
      const c = column(p);
      const surfR = bodyR + c.s.surfaceM;
      const float = (c.r - EYE_M) - surfR;
      if (g && float > leg.maxFloatM) leg.maxFloatM = float;
      const airR = surfR + FOOT_SAMPLE_M;
      if (of.solidAt(c.u[0] * airR, c.u[1] * airR, c.u[2] * airR)) {
        leg.phantomSolidTicks += dTick;
      }
      // How far the phantom rock stands PROUD of the ground, which is the size
      // of the defect rather than its frequency. Half a metre is chest-high on
      // the capsule's lowest sample and is not a rounding error.
      const proudR = surfR + 0.5;
      if (of.solidAt(c.u[0] * proudR, c.u[1] * proudR, c.u[2] * proudR)) {
        leg.proudHalfMetreTicks += dTick;
      }
    }
    leg.ticksAdvanced = of.world().tick - t0;
    leg.travelledM = +leg.travelledM.toFixed(2);
    leg.commandedM = +leg.commandedM.toFixed(2);
    leg.ratio = leg.commandedM > 0 ? +(leg.travelledM / leg.commandedM).toFixed(3) : null;
    leg.largestStepM = +leg.largestStepM.toFixed(3);
    leg.largestDropM = +leg.largestDropM.toFixed(3);
    leg.maxPushM = +leg.maxPushM.toFixed(3);
    leg.maxFloatM = +leg.maxFloatM.toFixed(3);
    leg.riseTailM = +leg.riseTailM.toFixed(3);
    leg.minSlopeCos = +leg.minSlopeCos.toFixed(3);
    return leg;
  };

  // ---------------------------------------------------------------------------
  // PHASE 1 - ordinary rough ground, four bearings, and the jump key NEVER held.
  // ---------------------------------------------------------------------------
  await settle(1.2);
  const start = of.world();
  if (start.player === null) return { valid: false, why: 'no character to walk' };
  const legs = [];
  for (const y of yaws) {
    of.look(y, 0);
    await settle(0.3);
    legs.push(await drive(`yaw${y}`, legSecs, ['KeyW']));
  }
  const sum = (f) => legs.reduce((a, l) => a + f(l), 0);
  const travelledM = +sum((l) => l.travelledM).toFixed(2);
  const commandedM = +sum((l) => l.commandedM).toFixed(2);
  const walkTicks = sum((l) => l.ticks);
  const surface = {
    ratio: commandedM > 0 ? +(travelledM / commandedM).toFixed(3) : null,
    travelledM,
    commandedM,
    ticks: walkTicks,
    stallTicks: sum((l) => l.stallTicks),
    stallPct: walkTicks > 0 ? +((100 * sum((l) => l.stallTicks)) / walkTicks).toFixed(1) : null,
    airborneTransitions: sum((l) => l.airborneTransitions),
    airTicks: sum((l) => l.airTicks),
    largestStepClimbedM: +Math.max(...legs.map((l) => l.largestStepM)).toFixed(3),
    largestDropM: +Math.max(...legs.map((l) => l.largestDropM)).toFixed(3),
    voxelPushTicks: sum((l) => l.pushTicks),
    maxVoxelPushM: +Math.max(...legs.map((l) => l.maxPushM)).toFixed(3),
    blockedByRockTicks: sum((l) => l.blockedTicks),
    phantomSolidTicks: sum((l) => l.phantomSolidTicks),
    phantomPct: walkTicks > 0
      ? +((100 * sum((l) => l.phantomSolidTicks)) / walkTicks).toFixed(1) : null,
    proudHalfMetrePct: walkTicks > 0
      ? +((100 * sum((l) => l.proudHalfMetreTicks)) / walkTicks).toFixed(1) : null,
    maxFloatAboveGroundM: +Math.max(...legs.map((l) => l.maxFloatM)).toFixed(3),
    minSlopeCos: +Math.min(...legs.map((l) => l.minSlopeCos)).toFixed(3),
  };

  // ---------------------------------------------------------------------------
  // PHASE 2 - THE NEGATIVE CONTROL. A vertical rock wall the walker must refuse.
  //
  // Sink a shaft straight down, stand in it, and walk into the side for two and
  // a half seconds. Depth is measured against the PRISTINE base height of the
  // player's own column (of.surface().baseM), not against the reconciled
  // surface, because the reconciled surface follows the player down the shaft
  // and would report a depth of roughly zero from the bottom of a mine.
  // ---------------------------------------------------------------------------
  const nc = { ran: false };
  if (of.voxels() !== null) {
    // Back to the spawn site first. The four walk legs are a loop, but tick
    // jitter leaves the player a metre or two off each run, and whether a
    // downward strike sinks the shaft depends on the ground it lands on: some
    // sites reconcile and some do not. Digging from a fixed site is the
    // difference between a control that grades itself every run and one that
    // reports `meaningful: false` on a third of them.
    of.teleport(start.observer.latDeg, start.observer.lonDeg, 0);
    await settle(0.8);
    const depthOf = () => {
      const c = column(posOf(of.world()));
      return (of.world().bodyRadiusM + c.s.baseM) - c.r;
    };
    // Dig to a DEPTH, not for a fixed number of strikes. A strike that lands in
    // rock already removed takes the shaft no deeper, and how many of those
    // happen depends on exactly where the walk legs left the player, so a fixed
    // count made the control silently shallow on some runs. `meaningful` still
    // refuses to grade a shaft that never got deep enough.
    of.look(A.wallYaw ?? 45, -88);
    const strikes = [];
    const wantDepth = A.shaftDepthM ?? 6;
    for (let i = 0; i < (A.maxStrikes ?? 24) && depthOf() < wantDepth; ++i) {
      strikes.push(of.dig());
      await settle(0.3);
    }
    await settle(0.8);
    of.look(A.wallYaw ?? 45, 0);
    await settle(0.4);
    const startDepth = depthOf();
    // Prove there IS a wall to refuse: how far along the heading, at EYE
    // height, the first rock is. Without this a shaft that collapsed into a
    // ramp would pass simply by being walkable, which is the classic vacuous
    // negative control. The shaft is about 3 m across, so the search starts
    // beyond its own radius and stops before it could find the far side of
    // anything but this pit.
    const aim = of.aim();
    const e = posOf(of.world());
    let wallAtM = null;
    for (let d = 1.0; d <= 4.0; d += 0.25) {
      if (of.solidAt(e[0] + aim.dir[0] * d, e[1] + aim.dir[1] * d,
        e[2] + aim.dir[2] * d)) { wallAtM = +d.toFixed(2); break; }
    }
    const leg = await drive('wall', A.wallSecs ?? 2.5, ['KeyW'], A.trace ?? 0);
    const endDepth = depthOf();
    nc.ran = true;
    nc.wallHeightM = +startDepth.toFixed(2);
    nc.depthAfterM = +endDepth.toFixed(2);
    nc.climbedM = +(startDepth - endDepth).toFixed(2);
    nc.rockAheadAtEyeHeightM = wallAtM;
    nc.strikesLanded = strikes.filter((s) => s !== null && s.cells > 0).length;
    nc.leg = leg;
    // A shallower shaft than this cannot distinguish a wall from a legal step.
    nc.meaningful = startDepth >= 2.5 && wallAtM !== null && nc.strikesLanded > 0;
    // The wall HOLDS on two counts, and the second is the one that matters.
    //
    // One legal step (CAPSULE.stepUpM, 1.1 m) plus one ground snap
    // (CAPSULE.groundSnapM, 0.35 m) is allowed, because the shaft has rubble at
    // its own foot and stepping onto it is not climbing out. But a threshold
    // alone cannot tell a wall from a slow ladder:
    // the baseline climbed 12 m at a dead-constant 0.097 m per tick, and half a
    // second of that would have passed any threshold you care to name. So the
    // real assertion is that the climb has CONVERGED: no radial rise at all over
    // the last quarter of the leg, with the key still held.
    nc.riseTailM = leg.riseTailM;
    nc.wallHolds = nc.meaningful && nc.climbedM <= 1.5 && leg.riseTailM <= 0.05;
  }

  const w = of.world();
  // GP-875 to GP-889. `legMinTicks` is the SMALLEST tick count any one leg
  // delivered; `legMeanTicks` is what this run's four legs delivered on
  // average. A host that is merely slow delivers all four proportionally
  // (every leg the same fraction short), so the ratio between them stays
  // near 1 regardless of how few ticks arrived in total; a leg that stalled
  // for a real reason (a freeze, a muted axis on one heading) delivers far
  // fewer ticks than its own run's siblings, which this catches without
  // naming a host-speed constant at all.
  const legTicksArr = legs.map((l) => l.ticks);
  const legMeanTicks = legTicksArr.reduce((a, t) => a + t, 0) / Math.max(1, legTicksArr.length);
  const legMinTicks = Math.min(...legTicksArr);
  const legMinFrac = legMeanTicks > 0 ? +(legMinTicks / legMeanTicks).toFixed(3) : 0;
  return {
    // DW-20, RE-DERIVED. Not "did the host run enough ticks in my time
    // window" (that is wall-clock throughput and this project's own headless
    // Chrome does not deliver it reliably, GP-875) but "is there enough
    // SIGNAL for the ratios above to mean anything, and did every leg
    // actually contribute one". A run that advanced nothing still reports
    // nothing rather than reporting zeros as success: `walkTicks` at 0 fails
    // `MIN_SIGNAL_TICKS`, `commandedM`/`travelledM` at 0 fail their own
    // checks, and `legMinFrac` catches a stall confined to one leg even when
    // the other three are healthy. What still turns this red: `of.run`
    // genuinely delivering nothing (not merely delivering it slowly), a walk
    // that stalls on one heading and not the others, a walker that never
    // commands or covers any distance, or a `surface`/`negativeControl`
    // reading outside the feel thresholds elsewhere in this file (STALL_FRAC,
    // `wallHolds`'s own bounds), none of which this change touches.
    valid: walkTicks >= MIN_SIGNAL_TICKS && commandedM > 0 && travelledM > 0
      && legs.every((l) => l.ticks > 0 && l.commandedM > 0)
      && legMinFrac >= LEG_MIN_FRAC
      && (nc.ran === false || nc.leg.ticks > 0),
    drove: {
      ticksAdvanced: w.tick - start.tick,
      framesRendered: w.frames - start.frames,
      walkTicksCounted: walkTicks,
      legMeanTicks: +legMeanTicks.toFixed(1),
      legMinTicks,
      legMinFrac,
      chunksResident: w.chunks.resident,
      converged: w.chunks.converged,
    },
    // --- THE HEADLINE ---------------------------------------------------------
    // Never a jump: no leg holds Space, so every metre here is walked.
    surface,
    // --- THE NEGATIVE CONTROL -------------------------------------------------
    negativeControl: nc,
    legs,
    site: {
      lat: +w.observer.latDeg.toFixed(5), lon: +w.observer.lonDeg.toFixed(5),
      altM: +w.observer.altM.toFixed(2), biome: w.biome,
      walkSpeedMps: walkMps, maxDepth: of.config.maxDepth,
    },
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw },
  };
})()
