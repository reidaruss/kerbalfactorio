// padclear.js: DOES A CLEARED PAD STAY CLEARED? (GP-66, phase 1 of a REAL
// browser reload driven by tools/smoke/reload.mjs.)
//
// This is a SETUP probe and not a whole acceptance: it drives the world up to
// the moment of the reload and hands the measured before-state back to the
// runner, which reloads the page in the same browser context (so IndexedDB is
// the same store a person pressing F5 has) and re-measures. Nothing here asserts
// what comes back; that half is reload.mjs's, because only it can see both
// sides.
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5433/ \
//     --setup=probes/padclear.js --setupargs='{"mode":"recover"}'
//
// PROBEALL-EXCLUDE: setup probe driven by tools/smoke/reload.mjs (see the invocation above), not run.mjs standalone
//
// TWO MODES, ONE SCRIPT, AND THAT IS THE WHOLE POINT.
//   mode "recover": build a pad, roll a rocket out onto it, press the recover
//     key, let an autosave land, stop.
//   mode "leave":   the same script with the recover press removed.
// The two runs differ by ONE key press and are re-measured by the same
// assertions, which is what makes "the pad came back empty" mean something in
// the first run: the second run is the control that says whether an UNcleared
// pad comes back empty too. `FlightRecover.ts` claims it does (PH-30: a flown or
// parked vessel is not in the save slot at all), and a claim about what the save
// does NOT contain can only be measured by running the case that would contain
// it. A control run whose vessel came back would mean the recover verb is
// load-bearing for persistence in a way nobody has accounted for.
//
// THE PAD ROUTINE IS pad.js's, copied rather than reinvented. Finding a site,
// laying the 6 x 6 platform GP-58 requires, aiming the pad through the real
// crosshair and building the reference stack in the bay are all that file's
// working code, and a second way to put a pad down would be a second thing to
// keep correct. The parts pad.js needs that this does not (the .glb
// measurements, the solidity probe, the in-page save round trip, the launch and
// the clamp co-occurrence) are left there.
//
// MODE: SANDBOX, for pad.js's reason: this proves the MECHANISM and not the
// economy, and reload.mjs boots ?sandbox=1 anyway.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function' || typeof of.vab !== 'function') {
    return { valid: false, why: 'no flight or vab' };
  }
  const MODE = (typeof OF_ARGS === 'object' && OF_ARGS && OF_ARGS.mode) || 'recover';
  if (MODE !== 'recover' && MODE !== 'leave') {
    return { valid: false, why: `unknown mode ${MODE} (want recover or leave)` };
  }
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const r6 = (v) => +v.toFixed(6);
  const D = 180 / Math.PI;

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));

  const st = of.structures();
  const pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };

  // ---- aiming at a POINT, by calibration rather than by assumed convention ---
  // pad.js's, verbatim: read one real aim ray, derive the observer frame's yaw
  // offset from it, then solve for any body-frame target. The placement below is
  // still the real aim march from the real eye through the real key.
  const aimRay = () => of.world().player.aim;
  let yawOffset = 0;
  const horizAngle = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    const u = [o[0] / r, o[1] / r, o[2] / r];
    const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k];
    const e = [-u[1], u[0], 0];
    const el = Math.hypot(e[0], e[1], e[2]) || 1;
    const ex = [e[0] / el, e[1] / el, e[2] / el];
    const nx = [u[1] * ex[2] - u[2] * ex[1], u[2] * ex[0] - u[0] * ex[2],
      u[0] * ex[1] - u[1] * ex[0]];
    return Math.atan2(h[0] * ex[0] + h[1] * ex[1] + h[2] * ex[2],
      h[0] * nx[0] + h[1] * nx[1] + h[2] * nx[2]) * D;
  };
  const pitchOf = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    return Math.asin((d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / r) * D;
  };
  {
    const a = aimRay();
    yawOffset = of.world().observer.yawDeg - horizAngle(a.origin, a.dir);
  }
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = aimRay();
      const d = [p.x - a.origin[0], p.y - a.origin[1], p.z - a.origin[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      // Never straight down: the yaw solve is atan2(0, 0) there and the eye's
      // own pitch clamp then disagrees with the angle that was asked for.
      if (l < 0.5) { of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue; }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const pitch = Math.max(-82, Math.min(82, pitchOf(a.origin, u)));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };

  // ======================================================================
  // 1. THE HAND (pad.js section 1).
  // ======================================================================
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const padSlot = slotOf('launchpad');
  check('the launch pad has a hotbar slot', padSlot >= 0,
    JSON.stringify(bar().slots.map((s) => s.part)));
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };

  // ======================================================================
  // 2. THE PLATFORM (pad.js section 2). GP-58: a pad stands on 36 decks.
  // ======================================================================
  const fSlot = slotOf('foundation');
  const CELLS = pads.cells(st.module.cellM);
  await hold(fSlot);
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  check('the first foundation founded a site', st.sites.length >= 1,
    st.sites.length);
  const site = st.sites[st.sites.length - 1];
  if (site === undefined) return { valid: false, fails, log, why: 'no site' };
  const C = st.module.cellM;
  const cellPoint = (i, j) => ({
    x: site.o.x + site.east.x * (i + 0.5) * C + site.north.x * (j + 0.5) * C,
    y: site.o.y + site.east.y * (i + 0.5) * C + site.north.y * (j + 0.5) * C,
    z: site.o.z + site.east.z * (i + 0.5) * C + site.north.z * (j + 0.5) * C,
  });
  const first = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = first?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF;
  const j0 = base[1] - HALF;
  let placed = 0;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      await aimAt(cellPoint(i0 + di, j0 + dj));
      const n0 = of.game().structures.parts.length;
      of.input.act(['use'], 3);
      await sleep(1 / 30);
      if (of.game().structures.parts.length > n0) placed++;
    }
  }
  // The repair pass, and pad.js's reason for it: `aimPoint` marches against what
  // is already BUILT as well as against the ground, so a crosshair swung across
  // a platform stops on the nearest deck's top face. A player solves this by
  // walking; so does this.
  const laidAt = (i, j) => of.game().structures.parts.find((q) => q.kind === 'foundation'
    && q.addr !== null && q.addr[0] === i && q.addr[1] === j && q.addr[2] === 0) !== undefined;
  for (let pass = 0; pass < 40; ++pass) {
    let gap = null;
    for (let di = 0; di < CELLS && gap === null; ++di) {
      for (let dj = 0; dj < CELLS && gap === null; ++dj) {
        if (!laidAt(i0 + di, j0 + dj)) gap = [i0 + di, j0 + dj];
      }
    }
    if (gap === null) break;
    const c = cellPoint(gap[0], gap[1]);
    const cr = Math.hypot(c.x, c.y, c.z) || 1;
    of.teleport(Math.asin(c.y / cr) * D, Math.atan2(c.z, c.x) * D, 0);
    await sleep(0.35);
    await aimAt(c);
    of.input.act(['use'], 3);
    await sleep(1 / 20);
    if (!laidAt(gap[0], gap[1])) {
      log.push(`cell ${gap} would not take a foundation: `
        + `${of.game().build.structGhost?.reason}`);
      break;
    }
    placed++;
  }
  const blocked = of.game().structures.parts.filter((p) => p.kind === 'foundation'
    && p.addr !== null && p.addr[0] >= i0 && p.addr[0] < i0 + CELLS
    && p.addr[1] >= j0 && p.addr[1] < j0 + CELLS && p.addr[2] === 0);
  log.push(`platform: ${placed} laid, ${blocked.length} of ${CELLS * CELLS} inside the pad block`);
  check("the pad's own 6 x 6 block is COMPLETE", blocked.length === CELLS * CELLS,
    blocked.length);

  // ======================================================================
  // 3. THE PAD (pad.js section 3).
  // ======================================================================
  await hold(padSlot);
  {
    const c = cellPoint(base[0], base[1]);
    const cr = Math.hypot(c.x, c.y, c.z) || 1;
    of.teleport(Math.asin(c.y / cr) * D, Math.atan2(c.z, c.x) * D, 0);
    await sleep(0.6);
    of.look(of.world().observer.yawDeg, -82);
    await sleep(0.4);
  }
  const gOk = of.game().build.padGhost;
  check('the pad ghost is VALID on the finished platform',
    gOk !== null && gOk.ok === true && gOk.missingCells === 0,
    JSON.stringify(gOk));
  const padsBefore = pads.list.length;
  of.input.act(['use'], 4);
  await sleep(0.5);
  check('the launch pad went down', pads.list.length === padsBefore + 1,
    `${padsBefore} -> ${pads.list.length}`);
  const pad = pads.list[pads.list.length - 1];
  if (pad === undefined) return { valid: false, fails, log, why: 'no pad placed' };
  log.push(`pad #${pad.id} site ${pad.siteId} cell ${pad.i},${pad.j},${pad.level}`);
  check('a fresh pad has never been rolled out on', pad.rollouts === 0, pad.rollouts);

  // ======================================================================
  // 4. THE REFERENCE VEHICLE (pad.js section 6), so the thing standing on the
  //    pad is the fixture every flight number is pinned against.
  // ======================================================================
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a,
  };
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => cat.find((c) => c.id === id)?.index ?? -1;
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [PID.CommandPod, PID.Parachute, PID.TankLiquidSmall,
    PID.EngineVacuumSmall, PID.DecouplerStackSmall, PID.TankLiquidSmallLong,
    PID.EngineLiquidSmall]) {
    const idx = idxOf(pid);
    if (idx < 0) continue;
    of.vab('frame');
    of.vab('take', idx);
    await sleep(0.1);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); } else {
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
        && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) continue;
      of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
      of.vab('place');
    }
    await sleep(0.12);
  }
  of.vab('drop');
  const vr = of.vab('report');
  check('a rocket was assembled', vr.parts.length >= 7, vr.parts.length);
  log.push(`vessel: ${vr.parts.length} parts`);
  of.vab('leave');
  await sleep(0.3);

  // ======================================================================
  // 5. THE ROLL-OUT, ONTO THE PAD (pad.js section 7). On foot throughout: this
  //    probe never boards, in EITHER mode, so PH-30's save inhibit is never
  //    engaged and the two runs' autosaves are the same autosave.
  // ======================================================================
  const F = () => of.flight('report');
  const r = Math.hypot(pad.pos.x, pad.pos.y, pad.pos.z) || 1;
  of.teleport(Math.asin(pad.pos.y / r) * D,
    Math.atan2(pad.pos.z, pad.pos.x) * D, 0);
  await sleep(1.0);
  const f0 = F();
  of.input.act(['board'], 4);
  await sleep(0.9);
  const f1 = F();
  log.push(`rollout: onPad ${f1.onPad} gap ${r6(f1.padSocketGapM)} m "${f1.message}"`);
  check('the roll-out happened', f1.rollouts === f0.rollouts + 1,
    `${f0.rollouts} -> ${f1.rollouts}`);
  check('IT WENT ONTO THE PAD, not onto the R12 stand-in ground',
    f1.onPad === true && f1.padRollouts >= 1,
    `onPad ${f1.onPad} padRollouts ${f1.padRollouts}`);
  check('THE VESSEL BASE SITS ON socket_vessel',
    f1.padSocketGapM >= 0 && f1.padSocketGapM < 1e-3, `${f1.padSocketGapM} m`);
  check('the pad now records the roll-out', pad.rollouts === 1, pad.rollouts);
  check('a vessel is LIVE on the pad before the branch', f1.flight.live === true
    && f1.flight.parts > 0, `live ${f1.flight.live} parts ${f1.flight.parts}`);
  check('and nobody is aboard', f1.aboard === false, f1.aboard);

  // ======================================================================
  // 6. THE ONE KEY THAT SEPARATES THE TWO RUNS.
  // ======================================================================
  // Through the KEY and not through `of.flight('recover')`, because the key is
  // what a player has and GP-66 bound it to Delete: driving the method directly
  // would leave the binding untested and would still have passed if `recover`
  // were reachable from nowhere.
  const preRecover = F();
  if (MODE === 'recover') {
    of.input.act(['recover'], 4);
    await sleep(0.6);
    const f2 = F();
    log.push(`recover: "${f2.message}"`);
    check('the recover key fired exactly once',
      f2.recoveries === preRecover.recoveries + 1,
      `${preRecover.recoveries} -> ${f2.recoveries}`);
    check('and it refused nothing', f2.refusals === preRecover.refusals,
      `${preRecover.refusals} -> ${f2.refusals}`);
    check('THE VESSEL IS OFF THE WORLD', f2.flight.live === false
      && f2.flight.parts === 0,
      `live ${f2.flight.live} parts ${f2.flight.parts}`);
    check('the pad it was standing on was released back',
      f2.padId === -1, f2.padId);
    check('and the clamps went back on an empty pad',
      pad.clampT === 0 && pad.solid.shut === true && pad.releasing === false,
      JSON.stringify({ t: pad.clampT, shut: pad.solid.shut, rel: pad.releasing }));
    check('the roll-out is NOT undone on the pad monument counter',
      pad.rollouts === 1, pad.rollouts);
  } else {
    const f2 = F();
    check('CONTROL: nothing was recovered', f2.recoveries === 0, f2.recoveries);
    check('CONTROL: the vessel is still standing on the pad',
      f2.flight.live === true && f2.flight.parts > 0,
      `live ${f2.flight.live} parts ${f2.flight.parts}`);
  }

  // ======================================================================
  // 7. LET AN AUTOSAVE LAND. The cadence is 20 sim seconds (Gameplay's
  //    AUTOSAVE_TICKS), so this waits for the COUNTER to move rather than
  //    sleeping a number that ought to be enough: a run that reloaded before a
  //    write would be measuring the previous save and would pass by accident.
  // ======================================================================
  const savesOf = () => of.game().persist.saves;
  const s0 = savesOf();
  let waitedS = 0;
  while (waitedS < 45 && savesOf() === s0) { await sleep(1.0); waitedS += 1; }
  const s1 = savesOf();
  log.push(`autosave: ${s0} -> ${s1} after ${waitedS} sim s`);
  check('an autosave landed AFTER the branch', s1 > s0, `${s0} -> ${s1}`);
  check('and it was not refused',
    (of.game().persist.saveInhibit?.refused ?? 0) === 0,
    JSON.stringify(of.game().persist.saveInhibit));

  const fin = F();
  const live = of.pads().list;
  return {
    valid: fails.length === 0,
    mode: MODE,
    fails,
    log,
    // The generic rows reload.mjs asserts for every setup.
    saves: s1,
    buildings: of.game().factory ? of.game().factory.buildings : -1,
    // THE BEFORE HALF of the reload comparison. reload.mjs re-measures each of
    // these after the page comes back.
    pads: {
      count: live.length,
      id: pad.id,
      cell: [pad.i, pad.j, pad.level],
      pos: [pad.pos.x, pad.pos.y, pad.pos.z],
      rollouts: pad.rollouts,
      clampT: pad.clampT,
      holding: pad.solid.shut,
    },
    flightLive: fin.flight.live,
    aboard: fin.aboard,
    flightParts: fin.flight.parts,
    rollouts: fin.rollouts,
    padRollouts: fin.padRollouts,
    recoveries: fin.recoveries,
    refusals: fin.refusals,
    padSocketGapM: r6(f1.padSocketGapM),
    autosave: { from: s0, to: s1, waitedS },
    message: fin.message,
  };
})()
