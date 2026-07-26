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
  const drive = async (label, secs, keys) => {
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
      airTicks: 0, minSlopeCos: 1, maxFloatM: 0, worstTick: null,
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
    }
    leg.ticksAdvanced = of.world().tick - t0;
    leg.travelledM = +leg.travelledM.toFixed(2);
    leg.commandedM = +leg.commandedM.toFixed(2);
    leg.ratio = leg.commandedM > 0 ? +(leg.travelledM / leg.commandedM).toFixed(3) : null;
    leg.largestStepM = +leg.largestStepM.toFixed(3);
    leg.largestDropM = +leg.largestDropM.toFixed(3);
    leg.maxPushM = +leg.maxPushM.toFixed(3);
    leg.maxFloatM = +leg.maxFloatM.toFixed(3);
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
    of.look(A.wallYaw ?? 45, -88);
    const strikes = [];
    for (let i = 0; i < (A.shaftStrikes ?? 8); ++i) {
      strikes.push(of.dig());
      await settle(0.3);
    }
    await settle(0.8);
    const depthOf = () => {
      const c = column(posOf(of.world()));
      return (of.world().bodyRadiusM + c.s.baseM) - c.r;
    };
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
    const leg = await drive('wall', A.wallSecs ?? 2.5, ['KeyW']);
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
    // The wall HOLDS if the player is still down the shaft. 0.7 m of allowance
    // covers one legal step onto rubble at the shaft's own foot.
    nc.wallHolds = nc.meaningful && nc.climbedM <= 0.7;
  }

  const w = of.world();
  return {
    // DW-20 first. Ticks actually advanced, and metres actually covered.
    valid: (w.tick - start.tick) > 800 && walkTicks > 500 && travelledM > 5,
    drove: {
      ticksAdvanced: w.tick - start.tick,
      framesRendered: w.frames - start.frames,
      walkTicksCounted: walkTicks,
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
