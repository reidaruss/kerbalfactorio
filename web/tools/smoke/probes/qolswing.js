// qolswing.js: THE SWING, through the real key, and what the screen SAYS when
// it works, when the node is empty, and when it misses.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=20 \
//        --evalfile=tools/smoke/probes/qolswing.js
//
// THE DEFAULT IS THE SUBJECT. No `of.harvest`, no teleport onto a convenient
// node: a player walks over and holds the left button, so that is what runs.
// `aimAtPoint`/`walkTo` are assembler.js's, unchanged, for its own reason (the
// observer yaw lives in a tangent frame that cannot be recomputed here).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const out = { steps: [] };
  const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => of.aim().origin;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u, v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -10;
    for (const step of [16, 4, 1, 0.3]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  const walkTo = async (pt, stopM) => {
    aimAtPoint(pt);
    let d = gd(eye(), pt);
    for (let i = 0; i < 30 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60, Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimAtPoint(pt);
      d = gd(eye(), pt);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  const centreText = () => {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const near = [];
    const walk = (el) => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const own = [...c.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s).join(' ');
        const r = c.getBoundingClientRect();
        if (own && own.length < 200 && r.width > 0
            && Math.abs(r.x + r.width / 2 - cx) < 500
            && Math.abs(r.y + r.height / 2 - cy) < 320) {
          near.push(own);
        }
        walk(c);
      }
    };
    walk(document.body);
    return near;
  };
  const inter = () => of.game()?.interact ?? null;

  await sleep(1.2);

  const tree = of.nodes().filter((n) => n.kind === 0)
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (!tree) return { valid: false, why: 'no tree in the world' };
  out.tree = { name: tree.name, distanceM: +tree.distanceM.toFixed(1),
               remaining: tree.remaining };

  // --- WALK THERE ---------------------------------------------------------
  out.walkedToM = await walkTo([tree.x, tree.y, tree.z], 3.0);
  aimAtPoint([tree.x, tree.y, tree.z]);
  await sleep(0.4);
  out.steps.push({ when: 'standing at the tree, aimed at it',
                   target: inter()?.target ?? null, centre: centreText() });

  // --- HOLD THE LEFT BUTTON, exactly what the hint tells you to do --------
  const a0 = inter();
  of.input.act(['use'], 200);
  await sleep(4.0);
  const a1 = inter();
  out.steps.push({ when: 'held the left button for 200 frames',
                   swings: a1.swings - a0.swings, grants: a1.grants - a0.grants,
                   granted: a1.granted - a0.granted, misses: a1.misses - a0.misses,
                   last: a1.last, centre: centreText() });

  // --- DRAIN IT AND SWING AT THE EMPTY STUMP ------------------------------
  const idx = tree.index;
  for (let k = 0; k < 60; ++k) of.harvest(idx);
  await sleep(0.5);
  aimAtPoint([tree.x, tree.y, tree.z]);
  await sleep(0.3);
  const b0 = inter();
  const emptyTarget = b0?.target ?? null;
  of.input.act(['use'], 200);
  await sleep(4.0);
  const b1 = inter();
  out.steps.push({ when: 'held the left button at the DRAINED node',
                   targetSeen: emptyTarget,
                   swings: b1.swings - b0.swings, grants: b1.grants - b0.grants,
                   misses: b1.misses - b0.misses, centre: centreText() });

  // --- SWING AT THE SKY ---------------------------------------------------
  of.look(of.world().observer.yawDeg, 55);
  await sleep(0.4);
  const c0 = inter();
  of.input.act(['use'], 200);
  await sleep(4.0);
  const c1 = inter();
  out.steps.push({ when: 'held the left button at the SKY',
                   swings: c1.swings - c0.swings, misses: c1.misses - c0.misses,
                   target: c1.target, centre: centreText() });

  // --- SWING AT BARE GROUND: does it dig, and does anything say so? -------
  of.look(of.world().observer.yawDeg, -80);
  await sleep(0.4);
  const d0 = inter();
  const dug0 = of.voxels ? of.voxels() : null;
  of.input.act(['use'], 200);
  await sleep(4.0);
  const d1 = inter();
  const dug1 = of.voxels ? of.voxels() : null;
  out.steps.push({ when: 'held the left button at BARE GROUND',
                   swings: d1.swings - d0.swings, digKind: d1.swingKinds,
                   dugBefore: dug0?.cells ?? dug0?.ops ?? null,
                   dugAfter: dug1?.cells ?? dug1?.ops ?? null,
                   centre: centreText() });
  return { valid: true, ...out }
})()
