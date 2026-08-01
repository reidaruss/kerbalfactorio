// WG-119 setup probe for reload.mjs: chop a STREAMED WORLD TREE through the
// real swing path, save, and hand the runner the tree's identity so phase 2 can
// prove the depletion survived a real reload.
//
// The tree is named by its bit-exact body-frame POSITION, never by its /core
// index: a streamed tree's index is its visit order, and visit order across a
// reload is precisely the thing this proof must not assume. If the cell-keyed
// diff (TreeField.serialize) is broken, the position lookup after reload finds
// a FULL tree and the runner's exact-remaining assertion goes red by name.
//
// THE FIXTURE MUST BE A STREAMED TREE AND NOT ONE OF THE CLEARING'S. The spawn
// clearing's 14 trees are laid by NodeField.populate on a golden-angle spiral
// out to about 57 m and are saved by /core INDEX, so chopping one would prove
// the OLD path and pass while the new one was broken (INSTRUMENTS.md: a fixture
// that cannot exhibit the defect). Distance is the discriminator, it is
// asserted below, and TreeField's own clearing keep-out is what makes the
// 70 m floor safe rather than lucky.
//
// DRIVEN, per harvest.js and rockreload.js: real look(), real KeyW tape, real
// `use` action, and a proof-of-advance block the runner can read.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const feet = () => of.world().player.aim.origin;

  await sleep(1.0);
  // Drain the cell queue: a 620 m ring is built 12 cells to a frame, so a probe
  // that picks its fixture early picks from a partial forest.
  let n = 0;
  while (of.game().trees.backlog > 0 && n++ < 3000) await sleep(1 / 60);
  await sleep(0.5);

  const t0 = of.world().tick;
  const s0 = of.game().trees;
  if (s0.enabled !== true || s0.live < 1) {
    return { valid: false, fail: `no world trees here: ${JSON.stringify(s0)}` };
  }
  const CLEARING_M = 70;
  const target = of.nodes().find((t) => t.kind === 0
    && t.distanceM > CLEARING_M && t.distanceM < 150);
  if (target === undefined) {
    return { valid: false, fail: `no streamed tree between ${CLEARING_M} and 150 m` };
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
  for (let i = 0; i < 90; ++i) {
    const row = of.nodes().find((t) => t.x === target.x && t.y === target.y
      && t.z === target.z);
    if (row === undefined || row.distanceM < 3.2) break;
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
  const after = of.nodes().find((t) => t.x === target.x && t.y === target.y
    && t.z === target.z);
  if (after === undefined) return { valid: false, fail: 'lost the tree' };
  const depleted = after.initial - after.remaining;
  const wood = g.carried.find((c) => /wood/i.test(c.name));

  // THE SAVE, explicitly, so phase 2 is reading a slot this probe wrote.
  const saved = await of.save();

  const ticks = of.world().tick - t0;
  return {
    valid: ticks > 200 && depleted > 0 && g.interact.grants >= 2
      && saved !== null && (wood?.count ?? 0) > 0,
    // `rock` is the key name reload.mjs's shared assertions already read; the
    // tree branch has its own block and its own key.
    tree: {
      x: after.x, y: after.y, z: after.z,
      remaining: after.remaining, initial: after.initial,
      distanceM: +target.distanceM.toFixed(1),
    },
    advanced: {
      ticks, metresWalked: +walked.toFixed(1),
      swings: g.interact.swings, grants: g.interact.grants,
      granted: g.interact.granted, depleted: +depleted.toFixed(3),
    },
    woodCarried: wood?.count ?? 0,
    treeStats: g.trees,
    saves: of.game().persist?.saves ?? 0,
    savedReport: saved,
    buildings: g.factory ? g.factory.buildings : 0,
  };
})()
