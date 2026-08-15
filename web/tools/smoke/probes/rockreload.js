// WG-70 setup probe for reload.mjs: harvest a WORLD ROCK through the real
// swing path, save, and hand the runner the rock's identity so phase 2 can
// prove the depletion survived a real reload.
//
// PROBEALL-EXCLUDE: two-phase setup probe driven by tools/smoke/reload.mjs,
// not run.mjs standalone.
//
// The rock is named by its bit-exact body-frame POSITION, never by its /core
// index: a streamed rock's index is its visit order, and visit order across a
// reload is precisely the thing this proof must not assume. If the cell-keyed
// diff (RockField.serialize) is broken, the position lookup after reload finds
// a FULL rock, and the runner's exact-remaining assertion goes red by name.
//
// DRIVEN, per harvest.js: real look(), real KeyW tape, real `use` action on the
// impact frame, and a proof-of-advance block the runner can read.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const feet = () => of.world().player.aim.origin;

  await sleep(1.5);
  const t0 = of.world().tick;
  const s0 = of.game().rocks;
  if (s0.enabled !== true || s0.live < 1) {
    return { valid: false, fail: `no world rocks here: ${JSON.stringify(s0)}` };
  }
  // The nearest WORLD rock. Kind 1 rows also include the clearing's stone
  // outcrops, which are patch-linked and report their PATCH's pool; the first
  // run of this probe harvested one at 3,511 units and proved the patch path
  // by accident (a fixture that cannot exhibit the defect, INSTRUMENTS.md).
  // A world rock's pool is /core's baseAmountOf(Rock) * grade, at most 60, so
  // the pool size is the discriminator, and the fixture is asserted below
  // before anything is swung at.
  const target = of.nodes().find((n) => n.kind === 1 && n.initial <= 60.5
    && n.distanceM > 4 && n.distanceM < 160);
  if (target === undefined) {
    return { valid: false, fail: 'no world rock within 160 m' };
  }
  if (!(target.initial > 0 && target.initial <= 60.5)) {
    return { valid: false, fail: `fixture is not a world rock: ${target.initial}` };
  }

  const faceIt = () => {
    const eye = feet();
    const want = norm(sub([target.x, target.y, target.z], eye));
    let bestYaw = 0, bestDot = -2;
    const st = of.world().observer;
    for (let a = 0; a < 360; a += 6) {
      of.look(a, st.pitchDeg);
      if (dot(of.aim().dir, want) > bestDot) {
        bestDot = dot(of.aim().dir, want); bestYaw = a;
      }
    }
    let bestPitch = 0; bestDot = -2;
    for (let p = -40; p <= 20; p += 2) {
      of.look(bestYaw, p);
      if (dot(of.aim().dir, want) > bestDot) {
        bestDot = dot(of.aim().dir, want); bestPitch = p;
      }
    }
    of.look(bestYaw, bestPitch);
  };

  let walked = 0;
  for (let i = 0; i < 60; ++i) {
    const row = of.nodes().find((n) => n.x === target.x && n.y === target.y
      && n.z === target.z);
    if (row === undefined || row.distanceM < 3.0) break;
    faceIt();
    const a = feet();
    of.input.tape([{ hold: 40, keys: ['KeyW'] }]);
    await sleep(0.8);
    walked += V(sub(feet(), a));
  }
  faceIt();
  await sleep(0.2);

  of.input.tape([
    { hold: 6, actions: ['use'] }, { hold: 32, keys: [] },
    { hold: 6, actions: ['use'] }, { hold: 32, keys: [] },
    { hold: 6, actions: ['use'] }, { hold: 32, keys: [] },
  ]);
  await sleep(2.6);

  const g = of.game();
  const after = of.nodes().find((n) => n.x === target.x && n.y === target.y
    && n.z === target.z);
  if (after === undefined) return { valid: false, fail: 'lost the rock' };
  const depleted = after.initial - after.remaining;
  const stone = g.carried.find((c) => /stone/i.test(c.name));

  // THE SAVE, explicitly, so phase 2 is reading a slot this probe wrote.
  const saved = await of.save();

  const ticks = of.world().tick - t0;
  return {
    valid: ticks > 200 && depleted > 0 && g.interact.grants >= 2
      && saved !== null && (stone?.count ?? 0) > 0,
    rock: {
      x: after.x, y: after.y, z: after.z,
      remaining: after.remaining, initial: after.initial,
    },
    advanced: {
      ticks, metresWalked: +walked.toFixed(1),
      swings: g.interact.swings, grants: g.interact.grants,
      granted: g.interact.granted, depleted: +depleted.toFixed(3),
    },
    stoneCarried: stone?.count ?? 0,
    rockStats: g.rocks,
    // Re-read AFTER the save above: `g` predates it and its counter is stale.
    saves: of.game().persist?.saves ?? 0,
    savedReport: saved,
    buildings: g.factory ? g.factory.buildings : 0,
  };
})()
