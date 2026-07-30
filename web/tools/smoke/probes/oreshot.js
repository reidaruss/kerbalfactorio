// A CLOSE-UP of one ore boulder (RN-81's evaluation instrument): find the
// nearest outcrop of the requested kind, walk to it, aim at it, photograph it.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4272/ \
//     --evalfile=tools/smoke/probes/oreshot.js --evalargs='{"kind":3}'
//
// Kinds: 1 stone, 2 coal, 3 iron, 4 copper (GameCore.NODE_KIND). The approach
// and the aim search are deposit.js's own (walk on W, re-aim by minimising the
// perpendicular miss of the aim ray to the target), because a hand-guessed yaw
// convention is the trap mountainlook.js documents. The fixture is asserted:
// the probe fails if no outcrop of the kind exists or the approach never got
// inside 12 m, because a "close-up" from 40 m is a lie with a filename.
(async () => {
  const of = window.__of;
  const kind = OF_ARGS.kind ?? 3;
  const sunT = OF_ARGS.sunT ?? 0.30;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  await settle(1.5);
  of.setTime(sunT);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);

  const crops = of.nodes().filter((n) => n.kind === kind && n.remaining > 0);
  if (crops.length === 0) throw new Error(`oreshot: no outcrop of kind ${kind} in the world`);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  // pick: 'near' (default) or an index into the kind's outcrop list sorted by
  // distance, for when the nearest one stands in a pond (the stone patch at
  // the default spawn does, and a close-up shot from waist-deep water is not
  // a close-up).
  const sorted = [...crops].sort((a, b) => dist(eye(), a) - dist(eye(), b));
  let target = sorted[Math.min(OF_ARGS.pick ?? 0, sorted.length - 1)];

  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: target.x - e.x, y: target.y - e.y, z: target.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = (pitch) => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      let bestMiss = Infinity;
      let bestYaw = best;
      const span = step === 20 ? 9 : 5;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, pitch);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, pitch);
    return best;
  };

  aimAt(-8);
  let bestD = dist(eye(), target);
  let worse = 0;
  for (let i = 0; i < 60; ++i) {
    target = of.nodes().find((n) => n.index === target.index) ?? target;
    const d = dist(eye(), target);
    if (d < (OF_ARGS.standoffM ?? 4.2)) break;
    if (d < bestD - 0.05) { bestD = d; worse = 0; }
    else if (++worse >= 2) { aimAt(-8); worse = 0; }
    // Short steps near the target: a full-second stride from 5 m ends at
    // 1.6 m with the boulder under the chin and out of frame, which is how
    // the first four "close-ups" were shot.
    const stride = d > 8 ? 60 : 20;
    of.input.tape([{ hold: stride, keys: ['KeyW'] }]);
    await of.run(stride / 60 + 0.1, 60);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await settle(0.3);
  // Final aim, pitched to hold the boulder's bulk (~0.5 m up) in the frame's
  // centre from a ~1.7 m eye.
  const standoff = dist(eye(), target);
  aimAt(-Math.atan2(1.1, Math.max(2.5, standoff)) * 180 / Math.PI);
  of.setTime(sunT);
  await settle(1.0);
  if (standoff > 12) throw new Error(`oreshot: approach stalled at ${standoff.toFixed(1)} m`);

  const blob = await of.screenshot();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return {
    valid: true,
    kind,
    standoffM: +standoff.toFixed(2),
    node: { index: target.index, remaining: target.remaining, initial: target.initial },
    png: `data:image/png;base64,${btoa(s)}`,
  };
})()
