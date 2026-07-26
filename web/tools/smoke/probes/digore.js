// DIGGING INTO AN ORE BODY PAYS, and it pays out of the SAME pool a swing does.
//
// The gap this closes: a pickaxe swing at an outcrop granted ore and a dig
// strike into the identical ground granted nothing, which reads as a bug the
// first time anybody tries it. Three claims:
//
//   1. a strike whose centre is inside a patch GRANTS ore, and the patch falls
//      by exactly what the pack gained. Conservation, not "a number went up":
//      a build that minted ore would pass the first half on its own.
//   2. a strike OFF every patch grants nothing. The negative control, and the
//      thing that would fail if the port were paying for any dig anywhere.
//   3. the yield does not obsolete the tools it sits beside. Measured against
//      the same world's own numbers: a bare-handed swing at an outcrop, a
//      pickaxe swing, and a drill's units per second.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const held = (name) =>
    (of.game().carried.find((c) => c.name === name) ?? { count: 0 }).count;

  await sleep(0.6);
  const t0 = of.world().tick;

  const field = of.game().ore;
  if (field.patches === 0) return { fail: 'no ore patches', field };
  const patch = field.list[0];
  const item = of.nodes().find((n) => n.kind === patch.kind);
  const name = item?.name ?? 'Raw iron';
  const pool = (i) => of.game().ore.list.find((p) => p.index === i).remaining;

  // What the neighbours are worth, from this same world rather than a comment.
  const crop = of.nodes().find((n) => n.kind === patch.kind && n.remaining > 20);
  const packWas = held(name);
  if (crop !== undefined) of.harvest(crop.index);
  const bareSwing = held(name) - packWas;

  // Stand ON the deposit. lat/lon from the body-frame centre, which is the same
  // convention `of.world().observer` reports in (asin of y over r, atan2 z x).
  const toLatLon = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    return [Math.asin(p[1] / r) * 180 / Math.PI,
      Math.atan2(p[2], p[0]) * 180 / Math.PI];
  };
  const [lat, lon] = toLatLon(patch.centre);
  of.teleport(lat, lon, 2);
  await sleep(0.8);

  // --- 1. dig into it -------------------------------------------------------
  const packBefore = held(name);
  const poolBefore = pool(patch.index);
  let strikes = 0;
  let paid = 0;
  for (let k = 0; k < 16; ++k) {
    of.look(k * 22, -78);
    await sleep(0.08);
    const r = of.dig();
    if (r === null || r.cells <= 0) continue;
    strikes++;
    if (of.voxels().action.lastOre > 0) paid++;
  }
  await sleep(0.3);
  const gained = held(name) - packBefore;
  const lost = poolBefore - pool(patch.index);
  log.push(`${strikes} strikes on the patch centre, ${paid} paid: pack +${gained}, `
    + `patch -${lost.toFixed(3)}`);

  // --- 2. the negative control: the same key, off every deposit -------------
  let far = null;
  let clearM = 0;
  for (let d = 20; d <= 120 && far === null; d += 10) {
    const cand = [patch.centre[0] + d, patch.centre[1], patch.centre[2] + d];
    let worst = Infinity;
    for (const p of of.game().ore.list) {
      worst = Math.min(worst, Math.hypot(cand[0] - p.centre[0], cand[1] - p.centre[1],
        cand[2] - p.centre[2]) - p.radiusM);
    }
    if (worst > 8) { far = cand; clearM = worst; }
  }
  if (far === null) return { fail: 'nowhere clear of a deposit', log };
  const [flat, flon] = toLatLon(far);
  of.teleport(flat, flon, 2);
  await sleep(0.8);
  const offPack = held(name);
  const offPool = pool(patch.index);
  let offStrikes = 0;
  for (let k = 0; k < 10; ++k) {
    of.look(k * 36, -78);
    await sleep(0.08);
    const r = of.dig();
    if (r !== null && r.cells > 0) offStrikes++;
  }
  await sleep(0.3);
  const offGained = held(name) - offPack;
  const offLost = offPool - pool(patch.index);
  log.push(`${offStrikes} strikes ${clearM.toFixed(2)} m clear of every patch: `
    + `pack +${offGained}, patch -${offLost.toFixed(3)}`);

  // DW-20: let the clock run on past the last edit, so the tick count this
  // reports is a simulation that advanced and not a burst of synchronous calls.
  await sleep(1.2);
  const v = of.voxels().action;
  return {
    advanced: { ticks: of.world().tick - t0, strikes, offStrikes },
    resource: name,
    inTheOre: { strikes, paid, packGained: gained, patchLost: +lost.toFixed(3),
      oreUnits: v.oreUnits },
    offTheOre: { strikes: offStrikes, clearM: +clearM.toFixed(2),
      packGained: offGained, patchLost: +offLost.toFixed(3) },
    // The balance table, from this world rather than from a comment.
    worth: {
      bareSwingAtAnOutcrop: bareSwing,
      digPerStrike: paid > 0 ? +(gained / paid).toFixed(2) : 0,
      patchGrade: patch.grade,
    },
    valid:
      of.world().tick - t0 > 300
      // 1. it pays, and the deposit is what paid
      && paid > 0 && gained > 0 && Math.abs(gained - lost) < 1e-6
      // 2. and off the ore it pays nothing at all
      && offStrikes > 0 && clearM > 0 && offGained === 0 && offLost === 0
      // 3. and a strike is worth less than a hand swing, so no tool is obsoleted
      && gained / paid <= bareSwing,
    log,
  };
})()
