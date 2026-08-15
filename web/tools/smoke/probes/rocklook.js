// WG-69: stand next to a WORLD ROCK with the harvest prompt up.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/rocklook.js \
//        --out=docs/screenshots/WG69_rock_prompt.png
//
// The whole feature in one frame: a rock that is an actual object, the accent
// crosshair on it, and the prompt naming Stone with its percentage. The ladder
// frames cannot show this (27 rocks over 90,000 m2 is a few per cent of any
// wide frame, the RN-61 composition lesson), so this probe walks to one and
// lets the runner take the picture with the UI left ON.
(async () => {
  const of = window.__of;
  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const feet = () => of.world().player.aim.origin;

  await of.run(1.5);
  // A WORLD rock, told from a patch outcrop by its pool size (<= 60, which is
  // /core's baseAmountOf(Rock); an outcrop reports its patch's thousands).
  const target = of.nodes().find((n) => n.kind === 1 && n.initial <= 60.5
    && n.distanceM > 4 && n.distanceM < 160);
  if (target === undefined) return { valid: false, fail: 'no world rock in range' };

  const faceIt = () => {
    const eye = feet();
    const want = norm(sub([target.x, target.y, target.z], eye));
    let bestYaw = 0, bestDot = -2;
    const st = of.world().observer;
    for (let a = 0; a < 360; a += 4) {
      of.look(a, st.pitchDeg);
      if (dot(of.aim().dir, want) > bestDot) {
        bestDot = dot(of.aim().dir, want); bestYaw = a;
      }
    }
    let bestPitch = 0; bestDot = -2;
    for (let p = -45; p <= 15; p += 2) {
      of.look(bestYaw, p);
      if (dot(of.aim().dir, want) > bestDot) {
        bestDot = dot(of.aim().dir, want); bestPitch = p;
      }
    }
    of.look(bestYaw, bestPitch);
  };

  for (let i = 0; i < 60; ++i) {
    const row = of.nodes().find((n) => n.x === target.x && n.y === target.y
      && n.z === target.z);
    if (row === undefined || row.distanceM < 2.8) break;
    faceIt();
    of.input.tape([{ hold: 40, keys: ['KeyW'] }]);
    await of.run(0.8);
  }
  faceIt();
  await of.run(0.4);
  const aimed = of.game().interact.target;
  return {
    valid: aimed !== null && aimed.kind === 1,
    aimed,
    rock: { x: target.x, y: target.y, z: target.z, initial: target.initial },
  };
})()
