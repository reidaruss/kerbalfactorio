// A picture of sandbox mode, framing only. `sandbox.js` is the acceptance.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/sandboxshot.js \
//        --out=docs/screenshots/W9_sandbox_base.png
//
// The whole point of the image is what is NOT in it: the pack readout bottom
// right says "empty" while a base stands in front of the player and a SANDBOX
// badge sits over the crosshair. Nothing was mined, nothing was crafted, and
// nothing was spent.
//
//   --evalargs='{"panel":1}' opens the pack instead, which is the other half of
//   the evidence: every recipe live on an empty pack, and the mode row with the
//   switch a player actually clicks.
(async (A) => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  await sleep(0.8);
  const yaw0 = of.world().observer.yawDeg;
  if (!of.game().mode.sandbox) return { fail: 'not a sandbox world, pass --sandbox=1' };

  const ghost = () => of.build().structGhost;
  const place = async (menu, want, lo, hi, yaws) => {
    of.build(menu);
    await sleep(0.1);
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2) {
        of.look((yaw0 + dy + 360) % 360, p);
        await sleep(0.05);
        const g = ghost();
        if (g === null || !g.ok || !want(g)) continue;
        of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
        await sleep(0.22);
        return true;
      }
    }
    return false;
  };

  // A block of foundations, then walls on two edges. Every one of them is free,
  // and the pack is never touched.
  const AROUND = [0, 25, -25, 50, -50, 75, -75];
  let decks = 0;
  for (let i = 0; i < 9; ++i) {
    if (await place(4, (g) => g.addr !== null, -84, -30, AROUND)) decks++;
  }
  let walls = 0;
  for (let i = 0; i < 6; ++i) {
    if (await place(6, (g) => g.addr !== null, -60, -14, AROUND)) walls++;
  }
  // And a drill's worth of factory, so the shot says "anything", not "a base".
  let machines = 0;
  for (const slot of [3, 5]) {
    of.hotbar(slot);
    await sleep(0.15);
    of.look((yaw0 + 120) % 360, -26);
    await sleep(0.15);
    const n = of.game().machines.length;
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.4);
    machines += of.game().machines.length - n;
  }
  log.push(`${decks} foundations, ${walls} walls, ${machines} machines, `
    + `pack ${JSON.stringify(of.game().carried)}`);

  // Empty the hand so no ghost sits over the frame, back off, then aim at where
  // the base ACTUALLY is rather than where it was expected to be: the parts
  // report their own positions, so a miss is a miss and not a framing guess.
  of.hotbar(1);
  of.input.tape([{ hold: 55, actions: ['back'] }, { hold: 6, keys: [] }]);
  await sleep(1.4);
  const parts = of.game().structures.parts;
  if (parts.length > 0) {
    const c = parts.reduce((a, p) => [a[0] + p.pos[0] / parts.length,
      a[1] + p.pos[1] / parts.length, a[2] + p.pos[2] / parts.length], [0, 0, 0]);
    let bestYaw = yaw0, bestPitch = -20, best = -2;
    for (let y = 0; y < 360; y += 3) {
      for (let p = -45; p <= 0; p += 3) {
        of.look(y, p);
        const a = of.aim();
        const v = [c[0] - a.origin[0], c[1] - a.origin[1], c[2] - a.origin[2]];
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        const k = (a.dir[0] * v[0] + a.dir[1] * v[1] + a.dir[2] * v[2]) / l;
        if (k > best) { best = k; bestYaw = y; bestPitch = p; }
      }
    }
    of.look(bestYaw, bestPitch);
    log.push(`framed the base at dot ${best.toFixed(3)}`);
  }
  await sleep(0.6);

  if (A && A.panel) { of.panel(true); await sleep(0.6); }

  return {
    valid: true, log,
    mode: of.game().mode,
    built: { foundations: decks, walls, machines },
    // THE NUMBER THE PICTURE IS ABOUT.
    packAfterBuildingAll: of.game().carried,
    coreStillSaysCannotAfford: of.game().structures.costs
      .map((c) => [c.kind, c.affordInCore]),
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
