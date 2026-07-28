// THE BURIED CAPSULE, CONSTRUCTED AT A CHOSEN DEPTH, WITH NO SEED IN IT.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5457/ --scenario=walk \
//        --evalfile=tools/smoke/probes/burylevel.js
//
// R18 was found on ONE seed, by a jittered dig that happened to leave the
// player inside rock (`probes/mtnfall.js`). A fix held only to that run is a fix
// fitted to a sample. This probe reaches the same state on FLAT GROUND with a
// shipped player tool and no seed anywhere in it: the levelling tool (WG-22) is
// allowed to RAISE terrain, so levelling a pad to `ground + N` with the player
// standing in it buries the player by N metres. LevelAction.ts:180 already says
// out loud that levelling raises the ground under your feet; nothing anywhere
// said what happens to the person standing there.
//
// MEASURED ON THE PRE-FIX BUILD: a 3 m raise and a 12 m raise each drop the
// player 508.052 m through the world in ten seconds, 0 of 600 ticks grounded,
// 0 pushes. So R18 is not a curiosity of one dig on one seed. It is one press
// of the levelling key on flat ground.
//
// The point of the sweep is that N is a FREE PARAMETER. Whatever owns a buried
// capsule has to own it wherever the ground is put, and a probe that only ever
// buries somebody by one depth cannot tell an authority from a lucky rung.
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
  const P = () => of.world().player;
  const unit = (p) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; };
  const depthOf = (bodyR) => {
    const p = P();
    const u = unit(p.feet);
    return bodyR + of.surface(u[0], u[1], u[2]).surfaceM - Math.hypot(...p.feet);
  };

  await settle(1.5);
  if (of.voxels() === null) return fail('no character, nothing can level');
  const bodyR = of.world().bodyRadiusM;
  const DEG = 180 / Math.PI;
  const u0 = unit(P().feet);
  const lat0 = Math.asin(u0[1]) * DEG;
  const lon0 = Math.atan2(u0[2], u0[0]) * DEG;
  // The walker's own deep threshold, so the sweep straddles it rather than
  // reciting it: under this the heightfield still owns the ground and no
  // burial is possible, over it the voxel floor query does.
  const DEEP_M = 1.5;

  const depths = A.depths ?? [1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 20.0];
  const rows = [];
  const degPerM = DEG / bodyR;
  for (let i = 0; i < depths.length; ++i) {
    const N = depths[i];
    of.teleport(lat0 + (i - depths.length / 2) * 60 * degPerM, lon0, 0);
    await settle(1.2);

    const uB = unit(P().feet);
    const groundBefore = of.surface(uB[0], uB[1], uB[2]).surfaceM;
    const feetBefore = Math.hypot(...P().feet);

    // Aim at the ground just in front of the feet, which is what a player
    // levelling the spot they are standing on does, then raise the pad to
    // `ground + N`. The tool's own radius is 10 m, so the player is inside it.
    of.look(0, -60);
    await of.run(0.1, 60);
    // ARM BEFORE THE STRIKE. The first version armed it a quarter of a second
    // AFTER, and on the fixed build the rescue had already happened by then:
    // the probe reported 0 ejects and 0 buried ticks and looked like a walker
    // that had never been buried at all. A trace that starts after the event is
    // DW-20's failure inside the instrument.
    of.stand(true);
    const lv = of.level(groundBefore + N);
    await settle(0.25);

    const uA = unit(P().feet);
    const groundAfter = of.surface(uA[0], uA[1], uA[2]).surfaceM;
    const raisedM = groundAfter - groundBefore;
    const buriedM = depthOf(bodyR);

    // PHASE 1, THE RESCUE. Two seconds is 120 ticks; whatever owns this state
    // has had every chance.
    await settle(2.0);
    const s1 = of.stand().samples.filter((x) => Number.isFinite(x.feetR));
    const ejects = s1.filter((x) => (x.ejectM ?? 0) > 0).length;
    const ejectMaxM = Math.max(0, ...s1.map((x) => x.ejectM ?? 0));
    const buriedTicks = s1.filter((x) => x.buried === true).length;
    const depthAfterRescue = depthOf(bodyR);

    // PHASE 2, THE STEADY STATE. The rescue is allowed to move the player. What
    // happens next is not: a walker standing still has a spread of zero.
    of.stand(true);
    await settle(10.0);
    const st = of.stand();
    const s2 = st.samples.filter((x) => Number.isFinite(x.feetR));
    of.stand(false);
    const after = P();
    const feet = s2.map((x) => x.feetR);

    rows.push({
      depthM: N,
      levelled: lv !== null && Math.abs(raisedM - N) < 0.5,
      raisedM: r3(raisedM),
      buriedAtLevelM: r3(buriedM),
      rescueTicks: s1.length, steadyTicks: s2.length, traceTotal: st.total,
      ejects, ejectMaxM: r3(ejectMaxM), buriedTicks,
      depthAfterRescueM: r3(depthAfterRescue),
      depthEndM: r3(depthOf(bodyR)),
      grounded: after.grounded, underRock: after.underRock,
      groundedTicks: s2.filter((x) => x.grounded).length,
      pushTicks: s2.filter((x) => x.pushM > 0).length,
      feetSpreadM: r6(Math.max(...feet) - Math.min(...feet)),
    });
    log.push(`raise ${N} m: ground +${r3(raisedM)}, buried ${r3(buriedM)} m, `
      + `${ejects} ejects (max ${r3(ejectMaxM)} m), after rescue `
      + `${r3(depthAfterRescue)} m under, end ${r3(depthOf(bodyR))} m under, `
      + `grounded ${after.grounded}, steady spread ${r6(Math.max(...feet) - Math.min(...feet))} m`);
    void feetBefore;
  }

  // DW-20: a probe that did not advance the sim measures nothing.
  if (!rows.every((r) => r.rescueTicks > 60 && r.steadyTicks > 400)) {
    return fail('the sim did not advance in some row', { rows });
  }
  // The construction has to have worked, or every check below is green for the
  // wrong reason. The gate is a property of the WORLD (the ground really rose
  // past the walker's own deep threshold), never of the walker: gating on "the
  // player was measurably buried" would make a working fix look like a
  // construction that failed, which is the same green-for-the-wrong-reason it
  // is there to prevent.
  const buriedRows = rows.filter((r) => r.levelled && r.raisedM > DEEP_M);
  if (buriedRows.length < 3) {
    return fail('the level tool did not raise the ground at enough depths',
      { rows, buriedRows: buriedRows.length });
  }

  const checks = [
    ['the walker really did enter the buried state, at EVERY depth',
      buriedRows.every((r) => r.buriedTicks > 0),
      buriedRows.map((r) => `${r.depthM}:${r.buriedTicks}`).join(' ')],
    ['the burial is over within a quarter of a second, at EVERY depth',
      buriedRows.every((r) => r.buriedAtLevelM < 1.0),
      buriedRows.map((r) => `${r.depthM}->${r.buriedAtLevelM}`).join(' ')],
    ['a buried capsule ends up somewhere legal, at EVERY depth',
      buriedRows.every((r) => r.depthEndM < 1.0),
      buriedRows.map((r) => `${r.depthM}->${r.depthEndM}`).join(' ')],
    ['a buried capsule is grounded again, at EVERY depth',
      buriedRows.every((r) => r.grounded === true),
      buriedRows.map((r) => `${r.depthM}:${r.grounded}`).join(' ')],
    ['the rescue is a ONE-TICK event, not a per-tick lift',
      buriedRows.every((r) => r.ejects <= 2),
      buriedRows.map((r) => `${r.depthM}:${r.ejects}`).join(' ')],
    // Bounded against the RAISE, which is what put the player in rock, and not
    // against the depth measured afterwards: on a build that fixes this the
    // measured depth is 0 and a bound built on it would demand the rescue lift
    // nobody anywhere. Post-rescue quantities cannot bound a rescue.
    ['the rescue never lifts further than the burial it undoes',
      buriedRows.every((r) => r.ejectMaxM <= r.raisedM + 1.0),
      buriedRows.map((r) => `${r.depthM}:${r.ejectMaxM}`).join(' ')],
    ['nothing moves afterwards: a standing walker has zero spread',
      buriedRows.every((r) => r.feetSpreadM === 0),
      buriedRows.map((r) => r.feetSpreadM).join(' ')],
    ['and it is grounded on every steady tick, not just the last one',
      buriedRows.every((r) => r.groundedTicks === r.steadyTicks),
      buriedRows.map((r) => `${r.groundedTicks}/${r.steadyTicks}`).join(' ')],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => `${c[0]}  [${c[2]}]`);

  return { valid: true, pass: failed.length === 0, failed, rows, log };
})()
