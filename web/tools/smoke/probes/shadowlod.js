// RN-681. WHAT THE SHADOW-CASCADE LOD COSTS AND SAVES, AS SIX INVARIANTS AND A
// RULE YOU CAN AUDIT.
//
// Run it TWICE against ONE binary, and the only difference is one query flag:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<p>/ --scenario=walk \
//     --evalfile=tools/smoke/probes/shadowlod.js --wait=900 \
//     --evalargs='{"site":{"name":"rn15","lat":12,"lon":150,"yaw":300,"pitch":-10}}'
//   ... and again with --shadowlod=0
//
// TWO PAGE LOADS AND NOT ONE, for the reason `portcost.js` gives: `shadowlod` is
// read once at module load, because a flag that can change mid-run turns a
// before-and-after into two halves of one ambiguous number. The tiers are not
// even ADDED to the geometry pools when it is off, so `geometries` and the
// vertex-buffer size are part of the control rather than only the draw is.
//
// DW-20 THROUGHOUT. A probe that measured an empty scene reports a beautiful
// saving. So the scene is asserted before any number is believed: the cascades
// are actually published, the batches actually hold instances, the pools have
// refused nothing, and the flag the URL asked for is the flag the client read.
//
// WHAT MAKES THE OFF SIDE A REAL CONTROL. `shadowlodOn === false` must come with
// `swaps === 0` AND with every machine ladder holding one rung, because those are
// two independent ways for the control to be vacuous: a hook that is installed
// but never fires, and a hook that is absent while the tiers are resident anyway.
// GP-156's shape, checked from both ends.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const sleep = (n) => of.run(n);
  const log = [];

  const site = A.site ?? { name: 'rn15', lat: 12, lon: 150, yaw: 300, pitch: -10 };
  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await sleep(A.settle ?? 1.2);

  // --- THE SUN, READ AND NOT ASSUMED ----------------------------------------
  // `__ofPost.state().sun` freezes below the horizon (rendering.md 2.6), so the
  // elevation comes off the sky model. `graze` is the RISING side only, so a
  // target elevation names one time of day rather than two.
  let sun = null;
  if (A.sunDot !== undefined && A.sunDot !== null) {
    const scan = [];
    let prev = -2;
    for (let i = 0; i < 360; ++i) {
      const t = i / 360;
      of.setTime(t);
      const e = of.stats().sky.elevationDot;
      scan.push({ t, e, rising: e > prev });
      prev = e;
    }
    let best = scan[0];
    let err = 9;
    for (const s of scan) {
      if (!s.rising) continue;
      const d = Math.abs(s.e - A.sunDot);
      if (d < err) { err = d; best = s; }
    }
    of.setTime(best.t);
    await sleep(0.5);
    of.setTime(best.t);
    sun = { want: A.sunDot, t: best.t, dot: of.stats().sky.elevationDot, err: +err.toFixed(4) };
    log.push(`sun ${JSON.stringify(sun)}`);
  }

  // --- OPTIONALLY BUILD A FACTORY -------------------------------------------
  // `portcost.js`'s scene, in its shape and for its reasons: the machines go
  // down while the player BACKS AWAY from them, so the row grows towards the
  // player and `machineClash` never refuses on the player's own feet, and the
  // belts are a hold-drag because a belt is the cheapest building to lay in bulk.
  const scene = { built: 0, smelters: 0, belts: 0 };
  if (A.build === true) {
    const fac = () => of.game().factory;
    const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const eye = () => { const o = of.aim().origin; return [o[0], o[1], o[2]]; };
    of.build(3);
    const yaw = of.world().observer.yawDeg;
    let pitch = null;
    for (let p = -18; p >= -50; p -= 1.0) {
      of.look(yaw, p);
      await sleep(0.035);
      const g = of.build().ghost;
      if (g === null || !g.ok) continue;
      const d = gd(g.pos, eye());
      if (d < 2.2 || d > 4.2) continue;
      pitch = p;
      break;
    }
    if (pitch === null) return { fail: 'no ground cell would take a smelter', log };
    for (let i = 0; i < 64 && scene.smelters < (A.smelters ?? 22); ++i) {
      of.look(yaw, pitch);
      await sleep(0.05);
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
      await sleep(0.16);
      if (fac().buildings > before) scene.smelters++;
      of.input.tape([{ hold: 13, keys: ['KeyS'] }, { hold: 2, keys: [] }]);
      await sleep(0.32);
    }
    of.build(2);
    for (let d = 0; d < 3; ++d) {
      of.look(yaw + 90 + d * 30, -32);
      await sleep(0.2);
      const before = fac().buildings;
      of.input.tape([{ hold: 220, actions: ['use', 'forward'] }]);
      await sleep(3.7);
      of.input.tape([{ hold: 8, keys: [] }]);
      await sleep(0.5);
      scene.belts += fac().buildings - before;
    }
    of.build(0);
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(1.4);
    // Look AT the factory, and the heading is `yaw` and NOT `yaw + 180`.
    //
    // The row is laid while the player BACKS AWAY from it (see above), so it
    // grows towards the player and ends up in FRONT of them on the original
    // heading. The half turn this line used to do was pointing the camera at
    // the empty ground the player had just retreated over, which cost nothing
    // in the triangle numbers (the batch is drawn either way, `frustumCulled`
    // is false) and quietly produced a comparison SCREENSHOT with no factory in
    // it. A framing bug is invisible in an aggregate and fatal in a picture.
    of.look(yaw, A.lookPitch ?? -8);
    await sleep(1.0);
    scene.built = fac().buildings;
    log.push(`built ${scene.built} (${scene.smelters} smelters, ${scene.belts} belts)`);
  }

  await sleep(A.hold ?? 1.0);

  // --- THE SIX INVARIANTS ----------------------------------------------------
  const s = of.stats();
  const r = window.__ofShadowLod.report();
  const invariants = {
    drawCalls: mustNum(s.draw, 'calls', 'stats.draw'),
    programs: mustNum(s.draw, 'programs', 'stats.draw'),
    triangles: mustNum(s.draw, 'triangles', 'stats.draw'),
    geometries: mustNum(s.draw, 'geometries', 'stats.draw'),
    textures: mustNum(s.draw, 'textures', 'stats.draw'),
    vramMB: mustNum(s, 'vramEstimateMB', 'stats'),
  };

  // --- THE RULE'S INPUTS, so the tier assignment can be audited and not taken --
  // RN-1478: the machine pool publishes one ladder set PER AUTHORED FAMILY
  // (`factoryMachines:panel`, `factoryMachines:stone`, ...), so the control
  // below has to read all of them or it silently reads none and passes
  // vacuously. The bare name is still matched, for the pools that carry one
  // family and for any build predating the split.
  const machines = {
    rows: r.pools.filter((p) => p.pool === 'factoryMachines'
      || p.pool.startsWith('factoryMachines:')).flatMap((p) => p.rows),
  };
  const ladders = r.pools.flatMap((p) => p.rows.map((x) => ({
    pool: p.pool, label: x.label, tris: x.tris, devMM: x.devMM,
    tier: x.tierPerCascade, tierK2: x.tierPerCascadeK2,
  })));
  // The whole point, per instance, per pass: what one of each template costs the
  // eye plus its three cascades, before and after the rule.
  const perTemplate = ladders.map((l) => {
    const at = (t) => { for (let i = Math.min(t, l.tris.length - 1); i >= 0; --i) if (l.tris[i] > 0) return l.tris[i]; return 0; };
    const before = l.tris[0] * (1 + r.cascades.length);
    const after = l.tris[0] + l.tier.reduce((a, t) => a + at(t), 0);
    return { pool: l.pool, label: l.label, before, after,
      cutPct: before === 0 ? 0 : +(100 * (before - after) / before).toFixed(2) };
  });

  const askedOff = new URLSearchParams(location.search).get('shadowlod') === '0';
  // THE CONTROL IS REAL, checked two ways (see the header).
  const controlIsReal = !askedOff
    || (r.flag.on === false && r.swaps === 0
        && machines.rows.every((x) => x.tris[1] === 0 && x.tris[2] === 0));
  const bootDefaultAsserted = new URLSearchParams(location.search).get('shadowlod') === null
    ? (r.flag.raw === null && r.flag.on === true) : null;

  const pools = (of.game().pools ?? null);
  const view = of.game().view ?? null;

  return {
    site: site.name, sun,
    flag: r.flag, askedOff, controlIsReal, bootDefaultAsserted,
    // RN-696: the k POLICY and its inputs, so the per-cascade k can be
    // re-derived from the rig's own geometry rather than taken on trust.
    budget: r.budget,
    cascades: r.cascades,
    swaps: r.swaps, instancesSwept: r.instances,
    savedTriangles: r.savedTriangles, passes: r.passes, batches: r.batches,
    // THE NUMBER TO CHECK THE FRAME DELTA AGAINST, and an UPPER BOUND on it: it
    // counts swapped instances and cannot see the per-instance frustum cull that
    // runs after the swap. Exact for the machine pools (culling off), an
    // over-count for the node pools (culling on). A saving that lives here and
    // not in `invariants.triangles` is either a swap three never re-read or a
    // caster the cascade dropped, and only the A/B can tell you which.
    savedPerFrame: r.savedPerFrame,
    measureMs: r.measure.ms, measureCalls: r.measure.calls,
    invariants,
    scene,
    machineInstances: view === null ? null : (view.instances ?? null),
    ladders,
    perTemplate,
    valid:
      // The cascades EXIST and published a texel, or the rule had no input and
      // every tier answer below is the trivial one.
      r.cascades.length > 0
      && r.cascades.every((c) => c.texelM > 0)
      // Section 2.1's number, re-derived rather than remembered. A cascade 0
      // that stopped being 15.47 mm would silently change every tier here.
      && Math.abs(r.cascades[0].texelMM - 15.47) < 0.05
      // RN-696. The screen footprint is the whole basis of the per-cascade k, so
      // it is asserted rather than assumed: cascade 0's texel must be about 3x
      // coarser ON SCREEN than cascade 1's, which is the asymmetry the policy
      // exists for. If the splits or the FOV ever make them equal, one k would
      // be correct again and this check is what would say so.
      && r.cascades[0].pxPerTexel > 2.4 * r.cascades[1].pxPerTexel
      // The measurement ran at all, ON THE SIDE THAT HAS ONE. `calls === 0` with
      // a full ladder table would be a deviation array of zeroes admitting every
      // tier; but the control side deliberately never adds a tier 1 or 2 to a
      // machine pool, so it has nothing to measure and zero is its right answer.
      // Asserting it unconditionally would have failed every control run, which
      // is a probe declaring its own negative control invalid.
      && (r.flag.on === false || r.measure.calls > 0)
      && invariants.triangles > 0
      && invariants.drawCalls > 0
      && controlIsReal
      && (bootDefaultAsserted === null || bootDefaultAsserted === true)
      && (A.build !== true || scene.built >= 24),
    log,
  };
})()
