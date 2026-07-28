// FS-46: A FACTORY BUILT BEFORE PORTS EXISTED SURVIVES THE LOAD.
//
// THE THING THIS IS ACTUALLY PROTECTING. Reid has a base he has been playing for
// days. Every machine in it was wired by PROXIMITY: whatever was near enough was
// connected, and nothing ever constrained which way a smelter faced, because
// under the old rule the facing did not matter. Under FS-44 it decides
// everything. The failure this probe exists to make impossible is that he loads
// that world and his factory has quietly stopped, with no message, because a
// model change went in underneath it.
//
// WHY A SYNTHESISED SLOT AND NOT HIS SLOT. His save is on his machine and cannot
// be in a probe, so this builds a line that works, saves it, and then EDITS THE
// SAVED BYTES into exactly the shape a pre-FS-44 slot has: the `ports` flag
// stripped from every building (which is precisely what a slot written before
// FS-44 lacks, because the field did not exist), and the smelter's heading
// turned a quarter about its own up, which is the one variable proximity wiring
// never constrained and therefore the one a legacy save's yaw is arbitrary in.
// That is not a mock of the failure. It IS the failure, assembled deliberately.
//
// THE NEGATIVE CONTROL IS THE HALF THAT MAKES IT MEAN ANYTHING, and it is the
// lesson of standing rule 11 applied before the fact rather than after: a
// migration that runs on a save which would have loaded fine anyway proves
// nothing at all. So the SAME edited slot is loaded a second time with `ports`
// forced back ON, which is the one flag that makes `Factory.restore` skip the
// repair. If the links come back that time too, the migration is decoration and
// this probe must fail. Measured, it does not: the controlled load loses the
// connection and raises a refusal, and the migrating load gets it back.
//
// WHAT IT ASSERTS, in order:
//   every building comes back                  nothing is ever deleted
//   migration.ran, considered > 0              it recognised a legacy slot
//   migration.turned > 0                       it repaired by TURNING
//   migration.stranded === 0                   and nothing was left broken
//   the port link is back, gap and facing      by the same numbers as before
//   the line produces again                    unattended
//   control: no link, and a refusal            the repair is load bearing
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => { const o = of.aim().origin; return { x: o[0], y: o[1], z: o[2] }; };
  const fac = () => of.game().factory;
  const ore = () => of.nodes().find((n) => n.kind === 3 && n.remaining > 20)
            ?? of.nodes().find((n) => n.kind === 2 && n.remaining > 20);

  // --- the slot, opened the way the game opens it ----------------------------
  // `SaveGame.ts` holds these two names and this key. They are transcribed here
  // rather than exported, and that is a deliberate seam and not laziness: this
  // probe's whole job is to act as a THIRD PARTY that has written a slot the
  // client did not write, which is what a slot from an older build is. Reading
  // it through an exported helper would make the client validate its own bytes.
  const DB = 'orbital-foundry';
  const STORE = 'saves';
  const KEY = 'auto';
  const idb = (mode, run) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      r.onsuccess = () => { resolve(r.result); db.close(); };
      r.onerror = () => { reject(r.error); db.close(); };
    };
  });
  const readSlot = () => idb('readonly', (s) => s.get(KEY));
  const writeSlot = (v) => idb('readwrite', (s) => s.put(v, KEY));

  await sleep(0.5);
  let node = ore();
  if (node === undefined) return { fail: 'no ore node in the clearing' };

  // --- walk to the deposit (shortline.js's search, guard and all) ------------
  const miss = () => {
    const a = of.aim();
    const e = { x: a.origin[0], y: a.origin[1], z: a.origin[2] };
    const v = { x: node.x - e.x, y: node.y - e.y, z: node.z - e.z };
    const t = v.x * a.dir[0] + v.y * a.dir[1] + v.z * a.dir[2];
    if (t <= 0) return Infinity;
    return Math.hypot(v.x - a.dir[0] * t, v.y - a.dir[1] * t, v.z - a.dir[2] * t);
  };
  const aimAt = () => {
    let best = of.world().observer.yawDeg;
    for (const step of [20, 5, 1.5]) {
      const span = step === 20 ? 9 : 5;
      let bestMiss = Infinity;
      let bestYaw = best;
      for (let k = -span; k <= span; ++k) {
        of.look(best + k * step, -8);
        const m = miss();
        if (m < bestMiss) { bestMiss = m; bestYaw = best + k * step; }
      }
      best = bestYaw;
    }
    of.look(best, -8);
  };
  aimAt();
  let walked = 0;
  let closest = dist(eye(), node);
  let worse = 0;
  for (let i = 0; i < 45; ++i) {
    node = of.nodes().find((n) => n.index === node.index) ?? node;
    const d = dist(eye(), node);
    if (d < 5.0) break;
    if (d < closest - 0.05) { closest = d; worse = 0; }
    else if (++worse >= 2) { aimAt(); worse = 0; }
    of.input.tape([{ hold: 60, keys: ['KeyW'] }]);
    await sleep(1.1);
    walked++;
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.2);
  aimAt();
  const standoff = dist(eye(), node);
  log.push(`walked ${walked} bursts to ${standoff.toFixed(2)} m`);
  if (standoff > 10.6) return { fail: 'the walk never reached the deposit', standoff, log };

  let yaw = of.world().observer.yawDeg;
  const placeHere = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  const rotateTo = async (q) => {
    while (of.build().rotation !== q) {
      of.input.tape([{ hold: 3, keys: ['KeyR'] }, { hold: 3, keys: [] }]);
      await sleep(0.12);
    }
  };
  const ghostAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.035);
    return of.build().ghost;
  };
  const fromEye = (g) => { const e = eye(); return gdist(g.pos, [e.x, e.y, e.z]); };

  of.build(2);
  await rotateTo(2);
  {
    let bestYaw = yaw;
    for (const [span, step] of [[23, 2], [5, 0.4]]) {
      let by = bestYaw;
      let bd = -2;
      for (let k = -span; k <= span; ++k) {
        const g = await ghostAt(bestYaw + k * step, -26);
        if (g === null) continue;
        const a = of.aim();
        const d = -(a.dir[0] * g.fwd[0] + a.dir[1] * g.fwd[1] + a.dir[2] * g.fwd[2]);
        if (d > bd) { bd = d; by = bestYaw + k * step; }
      }
      bestYaw = by;
    }
    yaw = bestYaw;
  }

  const beltSweep = [];
  for (let p = -12; p >= -52; p -= 0.3) {
    const g = await ghostAt(yaw, p);
    if (g === null) continue;
    beltSweep.push({ pitch: p, ok: g.ok, pos: g.pos, prospective: g.prospective,
      reachM: +fromEye(g).toFixed(2) });
  }
  const tailAim = beltSweep.filter((s) => s.ok && s.reachM <= 7.7)
    .reduce((a, b) => (a === null || b.reachM > a.reachM ? b : a), null);
  if (tailAim === null) return { fail: 'no belt cell inside the reach band', log };
  of.look(yaw, tailAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) return { fail: 'the first belt press placed nothing', log };
  }
  const tail0 = fac().list.find((b) => b.kind === 'belt');
  let headAim = null;
  for (let p = tailAim.pitch - 0.1; p >= -52 && headAim === null; p -= 0.15) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.prospective === true) continue;
    const d = gdist(g.pos, tail0.pos);
    if (d > 1.45) break;
    if (d > 0.6) headAim = { pitch: p, pos: g.pos };
  }
  if (headAim === null) return { fail: 'no cell adjacent to the tail on this heading', log };
  of.look(yaw, headAim.pitch);
  await sleep(0.2);
  {
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings <= before) return { fail: 'the second belt press placed nothing', log };
  }
  await sleep(0.3);
  const laidEye = eye();
  const laid = fac().list.filter((b) => b.kind === 'belt')
    .map((b) => ({ id: b.id, pos: b.pos,
      fromEyeM: gdist(b.pos, [laidEye.x, laidEye.y, laidEye.z]) }))
    .sort((a, b) => b.fromEyeM - a.fromEyeM);
  if (laid.length !== 2) return { fail: 'did not lay exactly two belts', laid, log };
  const headBelt = laid[laid.length - 1];

  of.build(3);
  let smelterAt = null;
  for (let p = headAim.pitch - 0.2; p >= -62 && smelterAt === null; p -= 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok) continue;
    const d = gdist(g.pos, headBelt.pos);
    if (d < 0.5) continue;
    if (d > 2.6) break;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) smelterAt = { pitch: p, pos: g.pos };
  }
  if (smelterAt === null) return { fail: 'the smelter would not go down at the head', log };

  of.build(1);
  let drill = null;
  for (let p = tailAim.pitch + 0.2; p <= -8 && drill === null; p += 0.25) {
    const g = await ghostAt(yaw, p);
    if (g === null || !g.ok || g.patch < 0) continue;
    const d = gdist(g.pos, laid[0].pos);
    if (d < 0.5 || d > 2.6) continue;
    const before = fac().buildings;
    await placeHere();
    if (fac().buildings > before) drill = { pos: g.pos, rate: g.ratePerSec };
  }
  of.build(0);
  if (drill === null) return { fail: 'the drill would not go down beyond the tail', log };

  // --- the world as it stands, connected, before anything is faked -----------
  const before = fac();
  const smelter = before.list.find((b) => b.kind === 'smelter');
  const heads = new Set(before.runs.map((r) => r.head));
  const linkBefore = before.links.find((l) => heads.has(l.from) && l.to === smelter.id) ?? null;
  log.push('before: ' + JSON.stringify({ buildings: before.buildings,
    links: before.links.length, refusals: before.refusals.length, link: linkBefore }));
  if (linkBefore === null) {
    return { fail: 'the line was not connected before the save, so the migration '
      + 'would be measured against a broken world', before, log };
  }

  // --- SAVE, then FAKE IT OLD -----------------------------------------------
  const saved = await of.save();
  const slot = await readSlot();
  if (slot === undefined || slot === null || !Array.isArray(slot.buildings)) {
    return { fail: 'no slot came back out of indexedDB after save()', saved, log };
  }
  const wroteWithPorts = slot.buildings.filter((b) => b.ports === true).length;
  // A QUARTER TURN ABOUT ITS OWN UP, done here with a cross product because for
  // exactly 90 degrees Rodrigues collapses to one: with `up` perpendicular to
  // `fwd`, fwd' = up x fwd. Nothing else in the row is touched, so the smelter
  // stands in the same cell at the same height and only its heading is wrong,
  // which is exactly the state a proximity-era save leaves a machine in.
  const legacy = JSON.parse(JSON.stringify(slot));
  let faked = 0;
  for (const b of legacy.buildings) {
    delete b.ports;
    if (b.kind !== 'smelter') continue;
    const [ux, uy, uz] = b.up;
    const [fx, fy, fz] = b.fwd;
    b.fwd = [uy * fz - uz * fy, uz * fx - ux * fz, ux * fy - uy * fx];
    faked++;
  }
  log.push(`slot: ${slot.buildings.length} buildings, ${wroteWithPorts} carried `
    + `ports:true, ${faked} smelter headings turned, ports stripped from all`);
  if (wroteWithPorts !== slot.buildings.length || faked !== 1) {
    return { fail: 'the slot was not the shape this probe needs to fake',
      wroteWithPorts, faked, count: slot.buildings.length, log };
  }

  // --- LOAD IT. This is the moment Reid's base loads. ------------------------
  await writeSlot(legacy);
  await of.load();
  await sleep(1.0);
  const after = fac();
  const smelterAfter = after.list.find((b) => b.kind === 'smelter');
  const headsAfter = new Set(after.runs.map((r) => r.head));
  const linkAfter = after.links.find((l) => headsAfter.has(l.from)
    && l.to === smelterAfter?.id) ?? null;
  const mig = after.migration ?? null;
  log.push('migrated: ' + JSON.stringify({ buildings: after.buildings,
    links: after.links.length, refusals: after.refusals.length,
    migration: mig, link: linkAfter }));

  // Does it RUN, unattended, after the migration? The whole point.
  const WINDOW = 20;
  const s0 = after.list.find((b) => b.id === smelterAfter?.id);
  const t0 = after.coreTicks;
  await sleep(WINDOW);
  const ran = fac();
  const s1 = ran.list.find((b) => b.id === smelterAfter?.id);
  // NOT named `window`. It was, and the whole probe died at line 39 with
  // "Cannot access 'window' before initialization": a `const window` anywhere in
  // the function shadows the global for the ENTIRE scope, so `window.__of` at
  // the top was reading the temporal dead zone of a variable declared 250 lines
  // below it. Cheap here, and worth the comment because the error names a line
  // that is not the mistake.
  const win = {
    coreTicks: ran.coreTicks - t0,
    expected: WINDOW * 60,
    inputRose: (s1?.input ?? 0) > (s0?.input ?? 0),
    inputBefore: s0?.input ?? null, inputAfter: s1?.input ?? null,
    ironMade: (s1?.output ?? 0) - (s0?.output ?? 0),
    minedDelta: ran.minedFromNodes - after.minedFromNodes,
  };
  log.push('window after migration: ' + JSON.stringify(win));

  // --- THE NEGATIVE CONTROL: the same bad slot, migration SKIPPED ------------
  // One field changes and nothing else: `ports: true` tells `Factory.restore`
  // this slot has already been through the port model, so the repair does not
  // run. If the links come back anyway, the repair was never what fixed it.
  const control = JSON.parse(JSON.stringify(legacy));
  for (const b of control.buildings) b.ports = true;
  await writeSlot(control);
  await of.load();
  await sleep(1.0);
  const ctl = fac();
  const ctlSmelter = ctl.list.find((b) => b.kind === 'smelter');
  const ctlHeads = new Set(ctl.runs.map((r) => r.head));
  const ctlLink = ctl.links.find((l) => ctlHeads.has(l.from)
    && l.to === ctlSmelter?.id) ?? null;
  const ctlRefusal = ctl.refusals[0] ?? null;
  log.push('control (migration skipped): ' + JSON.stringify({
    buildings: ctl.buildings, links: ctl.links.length,
    refusals: ctl.refusals.length, link: ctlLink,
    migrationRan: ctl.migration?.ran ?? null, refusal: ctlRefusal }));

  // Put the world back the way the migration left it, so the probe does not
  // finish having deliberately broken the save it just proved it could fix.
  await writeSlot(legacy);
  await of.load();
  await sleep(0.5);
  const restored = fac();

  return {
    advanced: { ticks: win.coreTicks, expected: win.expected,
      walked, rebuilds: restored.rebuilds },
    before: { buildings: before.buildings, links: before.links.length,
      link: linkBefore },
    faked: { portsStripped: legacy.buildings.length, headingsTurned: faked },
    migrated: { buildings: after.buildings, links: after.links.length,
      refusals: after.refusals.length, migration: mig, link: linkAfter },
    window: win,
    control: { buildings: ctl.buildings, links: ctl.links.length,
      refusals: ctl.refusals.length, link: ctlLink, refusal: ctlRefusal,
      migrationRan: ctl.migration?.ran ?? null },
    valid:
      // DW-20: the sim really advanced through the measured window.
      Math.abs(win.coreTicks - win.expected) <= 90
      // NOTHING IS EVER DELETED. This is the promise, first.
      && after.buildings === before.buildings
      && ctl.buildings === before.buildings
      // It knew the slot was legacy, and repaired it by TURNING.
      && mig !== null && mig.ran === true && mig.considered > 0
      && mig.turned > 0 && mig.stranded === 0
      // The connection came back, through the same two ports, at the same
      // geometry it had before the save.
      && linkAfter !== null
      && linkAfter.fromPort === 'socket_belt_out'
      && linkAfter.toPort === 'socket_item_in'
      && Math.abs(linkAfter.gapM - linkBefore.gapM) < 1e-6
      && linkAfter.facing <= -0.85
      // And the factory RUNS again, with nobody feeding it.
      && win.inputRose === true
      && win.minedDelta > 0
      // THE CONTROL: without the repair, the same slot loses the connection and
      // says why. If this passed, the repair above proved nothing.
      && ctlLink === null
      && ctlRefusal !== null
      && typeof ctlRefusal.reason === 'string' && ctlRefusal.reason.length > 20,
    plan: restored.list,
    log,
  };
})()
