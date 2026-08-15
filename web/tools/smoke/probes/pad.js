// THE LAUNCH PAD, ACCEPTANCE. Placed, saved, reloaded, launched from, and the
// clamps let go at the same instant the launch clamp does.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/pad.js
//
// WHAT THIS ASSERTS AND WHY EACH ONE IS A PROPERTY RATHER THAN A NUMBER
// SOMEBODY LIKED (standing rule 11):
//
//  A. THE PLATFORM RULE (GP-58) with the refusal COUNTING DOWN. A boolean
//     "refused on bare ground" passes on a rule that refuses everything, so this
//     lays the platform and asserts the missing-cell count falls 36 -> 0 and
//     that the ghost turns valid exactly when it reaches 0. A rule that had
//     simply been switched off would have to count.
//  B. THE ROLLOUT OFFSET, MEASURED and not asserted at a tolerance somebody
//     tuned. The pad publishes `socket_vessel` in body-frame metres through the
//     same call the roll-out makes; the vessel's BASE is derived back out of the
//     flight sim's own reported position; the two are differenced. The bound is
//     1 mm, which is orders above double residue at a 600 km radius and orders
//     BELOW the 2.00 m the answer would be wrong by if the socket were ignored,
//     so it cannot be satisfied by an accident in either direction.
//  C. THE CLAMPS, as a CO-OCCURRENCE of two independently stamped fixed ticks:
//     `FlightSession.releasedAtTick`, written inside `tryRelease` when TWR
//     crosses 1, and `PadPart.releasedAtTick`, written by the pad from its own
//     caller in `Systems`. Same tick or this fails. With a NEGATIVE CONTROL on
//     the same pad and the same rocket: a stage press with the throttle SHUT
//     leaves the launch clamp holding AND the arms shut, which is what separates
//     "the arms follow the clamp" from "the arms open on the stage key".
//  D. THE SAVE, through the real autosave path, with the pad RE-MEASURED after
//     the reload rather than merely counted: a pad that came back at the
//     planet's centre is still one pad.
//
// MODE: SANDBOX. This proves the MECHANISM and deliberately not the economy. A
// survival run would have to mine 1,440 Stone for the platform and smelt 60 Iron
// for the pad before the first assertion could be made, and DW-31 built sandbox
// for exactly this. The research GATE, which sandbox switches off by definition,
// is `probes/padgate.js`'s job and is not faked here.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const r6 = (v) => +v.toFixed(6);
  const D = 180 / Math.PI;
  // Same clamp as `pitchOf` below, same reason: `y / r` is mathematically in
  // [-1, 1] but at this body's 600 km scale double precision lands it a few
  // ULPs outside that range often enough to matter, and every `of.teleport`
  // call in this file derives its latitude from exactly this asin. Shared so
  // the fix lives in one place rather than three.
  const latDeg = (y, r) => Math.asin(Math.max(-1, Math.min(1, y / (r || 1)))) * D;

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));

  const st = of.structures();
  const pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };

  // ---- aiming at a POINT, by calibration rather than by assumed convention ---
  // `of.look` takes yaw and pitch in the observer's own frame and this file has
  // no business knowing what that frame is. So it reads one aim ray, derives the
  // frame's yaw offset from it, and thereafter solves for any target. The
  // placement itself is still the real aim MARCH from the real eye through the
  // real key: nothing here places anything by fiat.
  const aimRay = () => of.world().player.aim;
  let yawOffset = 0;
  const horizAngle = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    const u = [o[0] / r, o[1] / r, o[2] / r];
    const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k];
    // ANY fixed tangent pair will do, because only the DIFFERENCE against the
    // reported yaw is used and the offset absorbs the choice.
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
    // CLAMP BEFORE asin, NOT AFTER (CE-53's class: asin near +-1 is an
    // amplifier). `d` is already a unit vector and `o` a large-radius position,
    // so their dot product over r is nominally cos(theta) in [-1, 1], but a
    // near-vertical aim (repair-pass cell 0,-3 on the 6x6 block, measured) lands
    // the ratio a few ULPs past 1 in double precision. `Math.asin` of anything
    // outside [-1, 1] is NaN, which then survives the pitch clamp two lines
    // below unchanged (`Math.max(-82, Math.min(82, NaN))` is NaN, not -82), so
    // `of.look` was called with a NaN pitch and the aim ray came back
    // `dir: [null, null, null]` for the rest of the run: exactly the site:-1
    // "no base here" failure this file's own comment above already diagnosed
    // once for the straight-down case, recurring here from float error rather
    // than from true verticality.
    const ratio = Math.max(-1, Math.min(1,
      (d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / r));
    return Math.asin(ratio) * D;
  };
  {
    const a = aimRay();
    yawOffset = of.world().observer.yawDeg - horizAngle(a.origin, a.dir);
  }
  /** Point the crosshair at a body-frame point. Two passes, because the eye
   *  moves a little with the pitch. */
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = aimRay();
      const d = [p.x - a.origin[0], p.y - a.origin[1], p.z - a.origin[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      // A TARGET UNDER THE FEET HAS NO HORIZONTAL COMPONENT, so the yaw solve is
      // atan2(0, 0) and the observer's own pitch clamp then makes the aim ray
      // disagree with the angle that was asked for. Both are handled by refusing
      // to look straight down: -82 degrees still lands inside a 4 m cell from a
      // 1.6 m eye (0.22 m of horizontal run) and leaves the solve well
      // conditioned. Found by measurement, not by suspicion: aiming at 90
      // produced a NaN aim, which read as `site: -1` and "there is no base here"
      // while standing on 36 foundations.
      if (l < 0.5) { of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue; }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const pitch = Math.max(-82, Math.min(82, pitchOf(a.origin, u)));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };

  // ======================================================================
  // 0. THE ASSET, MEASURED. Every number the placement and the roll-out use
  //    comes off the shipped .glb; if this block is wrong nothing below means
  //    anything.
  // ======================================================================
  const m = pads.module;
  log.push(`pad module: ${JSON.stringify(m)}`);
  check('the pad is 24 m in plan', Math.abs(m.spanM - 24) < 0.01, m.spanM);
  check('the pad is 28 m to the crown', Math.abs(m.heightM - 28) < 0.01, m.heightM);
  check('socket_vessel stands a rocket 2.00 m up',
    Math.abs(m.standM - 2.0) < 1e-4, m.standM);
  check('socket_clamp is on a 1.90 m circle',
    Math.abs(m.clampRadiusM - 1.9) < 1e-4, m.clampRadiusM);
  check('the umbilical is at 13.6 m', Math.abs(m.umbilicalM - 13.6) < 0.01,
    m.umbilicalM);
  check('four clamps are fanned out from the ONE shipped socket', m.clamps === 4,
    m.clamps);
  check('Clamp_Release runs 0.4 s', Math.abs(m.swingSecs - 0.4) < 1e-3, m.swingSecs);
  check('Clamp_Release swings 70 degrees BACK (negative about X)',
    m.swingRad < 0 && Math.abs(Math.abs(m.swingRad) - 70 * Math.PI / 180) < 1e-3,
    (m.swingRad * D).toFixed(3));
  check('and retracts radially as it swings', Math.abs(m.retractM - 0.06) < 1e-3,
    m.retractM);
  const CELLS = pads.cells(st.module.cellM);
  check('a pad covers 6 x 6 structural cells', CELLS === 6,
    `${CELLS} at cellM ${st.module.cellM}`);

  // ======================================================================
  // 1. THE HAND. GP-56: a researched, priced, placeable thing nothing can hold
  //    is not shipped, so the pad is reached by a KEY.
  // ======================================================================
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const padSlot = slotOf('launchpad');
  check('the launch pad has a hotbar slot', padSlot >= 0,
    JSON.stringify(bar().slots.map((s) => s.part)));
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };
  await hold(padSlot);
  check('that slot puts a launch pad in hand', bar().part === 'launchpad',
    JSON.stringify(bar().part));

  // ======================================================================
  // 2. THE PLATFORM RULE (GP-58), counted down.
  // ======================================================================
  const ghost = () => of.game().build.padGhost;
  of.look(of.world().observer.yawDeg, -30);
  await sleep(0.3);
  const g0 = ghost();
  check('a pad on bare ground is REFUSED', g0 !== null && g0.ok === false,
    JSON.stringify(g0));
  check('and the refusal says a platform is what is missing',
    /platform/.test(g0?.reason ?? ''), g0?.reason);
  log.push(`bare ground: "${g0?.reason}"`);

  // Found a site with ONE foundation, then lay the block around it by aiming at
  // each cell in turn. The site frame comes from the site the first foundation
  // founded, so nothing here invents a grid.
  const fSlot = slotOf('foundation');
  await hold(fSlot);
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  check('the first foundation founded a site', st.sites.length >= 1,
    st.sites.length);
  const site = st.sites[st.sites.length - 1];
  const C = st.module.cellM;
  const cellPoint = (i, j) => ({
    x: site.o.x + site.east.x * (i + 0.5) * C + site.north.x * (j + 0.5) * C,
    y: site.o.y + site.east.y * (i + 0.5) * C + site.north.y * (j + 0.5) * C,
    z: site.o.z + site.east.z * (i + 0.5) * C + site.north.z * (j + 0.5) * C,
  });
  // Which cell the first one landed in, so the block is laid AROUND it. The
  // offsets are `padBlockAt`'s own: a pad aimed at cell (a, b) claims
  // [a - 3 .. a + 2], so the probe lays exactly that and then aims at (a, b).
  // Deriving the block from the same rule the ghost uses is the point: a probe
  // that laid its own idea of a 6 x 6 would be testing its own arithmetic.
  const first = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = first?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF;
  const j0 = base[1] - HALF;
  let placed = 0;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      await aimAt(cellPoint(i0 + di, j0 + dj));
      const before = of.game().structures.parts.length;
      of.input.act(['use'], 3);
      await sleep(1 / 30);
      if (of.game().structures.parts.length > before) placed++;
    }
  }
  // A REPAIR PASS, and it exists because of a real rule rather than probe
  // flakiness: `aimPoint` marches against what is already BUILT as well as
  // against the ground (it has to, or no upper storey could ever be aimed at),
  // so a crosshair swung across a platform stops on the nearest deck's top face
  // and addresses THAT cell. A player solves this by walking; so does this. The
  // placement is still the same aim march and the same key.
  const laidAt = (i, j) => {
    const p = of.game().structures.parts.find((q) => q.kind === 'foundation'
      && q.addr !== null && q.addr[0] === i && q.addr[1] === j && q.addr[2] === 0);
    return p !== undefined;
  };
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
    of.teleport(latDeg(c.y, cr), Math.atan2(c.z, c.x) * D, 0);
    await sleep(0.35);
    await aimAt(c);
    const preGhost = of.game().build.structGhost;
    of.input.act(['use'], 3);
    await sleep(1 / 20);
    if (!laidAt(gap[0], gap[1])) {
      // GP-905 to GP-919: measured, not guessed. The ghost aimed AT the gap
      // (0,-3) resolved to a DIFFERENT address before the key was even
      // pressed, and pressing it still placed something (a foundation landed,
      // parts count rose), just not at the cell that was aimed at. That is
      // GP-37's socket snap (`SNAP_FRACTION = 0.75`, a 3 m capture radius on a
      // 4 m cell) catching a neighbour's socket instead of the bare-grid
      // answer for a cell enclosed on multiple sides, where every point in the
      // cell's interior is within capture range of some already-built
      // neighbour. Recorded as a candidate game defect, not fixed here (see
      // controller log): the raw grid target and the ghost's resolved target
      // diverge by a full cell.
      log.push(`cell ${gap} would not take a foundation, ghost resolved to `
        + `${JSON.stringify(preGhost?.addr)} instead: ${preGhost?.reason}`);
      break;
    }
    placed++;
  }
  const decks = of.game().structures.parts.filter((p) => p.kind === 'foundation');
  log.push(`platform: ${decks.length} foundations, ${placed} new this pass`);
  check('a 6 x 6 platform went down', decks.length >= CELLS * CELLS,
    decks.length);
  const blocked = of.game().structures.parts.filter((p) => p.kind === 'foundation'
    && p.addr !== null && p.addr[0] >= i0 && p.addr[0] < i0 + CELLS
    && p.addr[1] >= j0 && p.addr[1] < j0 + CELLS && p.addr[2] === 0);
  log.push(`inside the pad's own block: ${blocked.length} of ${CELLS * CELLS}`);
  check('and the block the pad will claim is COMPLETE',
    blocked.length === CELLS * CELLS, blocked.length);

  // ======================================================================
  // 3. THE PAD.
  // ======================================================================
  await hold(padSlot);
  // Stand back at the block's own centre before aiming the pad, so the ghost's
  // block is the one that was just laid.
  {
    const c = cellPoint(base[0], base[1]);
    const cr = Math.hypot(c.x, c.y, c.z) || 1;
    of.teleport(latDeg(c.y, cr), Math.atan2(c.z, c.x) * D, 0);
    await sleep(0.6);
    of.look(of.world().observer.yawDeg, -82);
    await sleep(0.2);
  }
  await sleep(0.2);
  const gOk = ghost();
  log.push(`pad ghost on the platform: ${JSON.stringify(gOk)}`);
  check('with the platform complete the count is ZERO',
    gOk !== null && gOk.missingCells === 0, JSON.stringify(gOk));
  check('and the ghost turned VALID exactly there',
    gOk !== null && gOk.ok === true, gOk?.reason);
  check('the refusal on bare ground had COUNTED, not merely refused',
    (g0?.missingCells ?? 0) === CELLS * CELLS, g0?.missingCells);

  const padsBefore = pads.list.length;
  of.input.act(['use'], 4);
  await sleep(0.5);
  check('the launch pad went down', pads.list.length === padsBefore + 1,
    `${padsBefore} -> ${pads.list.length}`);
  const pad = pads.list[pads.list.length - 1];
  if (pad === undefined) return { valid: false, fails, log, why: 'no pad placed' };
  log.push(`pad #${pad.id} site ${pad.siteId} cell ${pad.i},${pad.j},${pad.level}`);

  await sleep(0.2);
  const g2 = ghost();
  check('a second pad on the same platform is refused BY OVERLAP',
    g2 !== null && g2.ok === false && /too close/.test(g2.reason), g2?.reason);

  // ======================================================================
  // 4. THE PAD IS SOLID: it joined the walker's own body set, so its deck, its
  //    launch table over the flame trench and its tower all block.
  // ======================================================================
  // ACROSS the pad, not along it. The flame trench runs the length of the pad
  // between the two deck banks, so a point 8 m along the pad's forward axis at
  // the centre line is OVER THE TRENCH and correctly answers "not solid": that
  // is the trench doing its job, and asserting it solid would have been the
  // probe demanding the hole be filled in.
  const side = { x: pad.up.y * pad.fwd.z - pad.up.z * pad.fwd.y,
    y: pad.up.z * pad.fwd.x - pad.up.x * pad.fwd.z,
    z: pad.up.x * pad.fwd.y - pad.up.y * pad.fwd.x };
  const at = (du, ds, df = 0) => of.solidBuild(
    pad.pos.x + pad.up.x * du + side.x * ds + pad.fwd.x * df,
    pad.pos.y + pad.up.y * du + side.y * ds + pad.fwd.y * df,
    pad.pos.z + pad.up.z * du + side.z * ds + pad.fwd.z * df);
  check('the launch table over the trench is SOLID', at(1.7, 0) === true,
    'at(1.7, 0)');
  check('the deck bank 8 m ACROSS is SOLID', at(1.0, 8) === true, 'at(1.0, 8)');
  check('the deck bank 8 m across the OTHER way is SOLID', at(1.0, -8) === true,
    'at(1.0, -8)');
  // CONTROL: the flame trench is a HOLE and reads as one, 8 m along the pad on
  // its centre line where the launch table does not reach.
  check('CONTROL: the flame trench is NOT solid', at(1.0, 0, 8) === false,
    'at(1.0, 0, 8)');
  check('and the air 4 m over the mount is NOT solid', at(4.0, 0) === false,
    'at(4.0, 0)');

  // ======================================================================
  // 5. SAVE, RELOAD, RE-MEASURE (DW-17).
  // ======================================================================
  const wrote = await of.save();
  log.push(`save: ${JSON.stringify(wrote)}`);
  check('the slot carries the pad', (wrote?.pads ?? 0) === pads.list.length,
    JSON.stringify(wrote));
  const posBefore = [pad.pos.x, pad.pos.y, pad.pos.z];
  const anchorBefore = pads.vesselAnchor(pad, { x: 0, y: 0, z: 0 });
  await of.load();
  await sleep(0.5);
  const padsAfter = of.pads().list;
  check('the pad came back', padsAfter.length === 1, padsAfter.length);
  const pad2 = padsAfter[0];
  if (pad2 !== undefined) {
    const moved = Math.hypot(pad2.pos.x - posBefore[0], pad2.pos.y - posBefore[1],
      pad2.pos.z - posBefore[2]);
    check('and it came back WHERE IT WAS, not merely counted', moved < 1e-6,
      `${moved} m`);
    const a2 = of.pads().vesselAnchor(pad2, { x: 0, y: 0, z: 0 });
    const anchorMoved = Math.hypot(a2.x - anchorBefore.x, a2.y - anchorBefore.y,
      a2.z - anchorBefore.z);
    check('so its rollout anchor survived the round trip', anchorMoved < 1e-6,
      `${anchorMoved} m`);
    check('and it is HOLDING again, never mid-swing', pad2.clampT === 0
      && pad2.solid.shut === true,
      JSON.stringify({ t: pad2.clampT, shut: pad2.solid?.shut }));
    log.push(`reload: pad moved ${r6(moved)} m, anchor ${r6(anchorMoved)} m`);
  }
  const live = of.pads().list[0];
  if (live === undefined) return { valid: false, fails, log, why: 'pad lost on load' };

  // ======================================================================
  // 6. BUILD THE REFERENCE VEHICLE, exactly as probes/ascent.js does, so the
  //    thing standing on the pad is the fixture every flight number is pinned
  //    against rather than a rocket invented here.
  // ======================================================================
  // The reference stack's PartIds, taken from probes/ascent.js verbatim so the
  // thing standing on the pad IS the fixture every flight number is pinned
  // against, rather than a rocket invented here.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
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
  log.push(`vessel: ${vr.parts.length} parts, dv ${vr.stats?.totalDeltaV}`);
  check('a rocket was assembled', vr.parts.length >= 7, vr.parts.length);
  of.vab('leave');
  await sleep(0.3);

  // ======================================================================
  // 7. THE ROLL-OUT, ONTO THE PAD, AT THE PUBLISHED SOCKET.
  // ======================================================================
  const r = Math.hypot(live.pos.x, live.pos.y, live.pos.z) || 1;
  of.teleport(latDeg(live.pos.y, r),
    Math.atan2(live.pos.z, live.pos.x) * D, 0);
  await sleep(1.0);
  const f0 = of.flight('report');
  of.input.act(['board'], 4);
  await sleep(0.9);
  const f1 = of.flight('report');
  log.push(`rollout: ${JSON.stringify({ onPad: f1.onPad,
    padRollouts: f1.padRollouts, gapM: f1.padSocketGapM, msg: f1.message })}`);
  check('the roll-out happened', f1.rollouts === f0.rollouts + 1,
    `${f0.rollouts} -> ${f1.rollouts}`);
  check('IT WENT ONTO THE PAD, not onto the R12 stand-in ground',
    f1.onPad === true && f1.padRollouts >= 1,
    `onPad ${f1.onPad} padRollouts ${f1.padRollouts}`);
  check('and the message SAYS pad rather than stand-in',
    /pad/i.test(f1.message) && !/stand-in/i.test(f1.message), f1.message);
  check('THE VESSEL BASE SITS ON socket_vessel',
    f1.padSocketGapM >= 0 && f1.padSocketGapM < 1e-3, `${f1.padSocketGapM} m`);
  log.push(`OFFSET base -> socket_vessel: ${r6(f1.padSocketGapM)} m`);
  // An INDEPENDENT route to the same claim: the sim recorded the pad's own
  // socket radius, not the ground's, and the two differ by the deck height.
  const a3 = of.pads().vesselAnchor(live, { x: 0, y: 0, z: 0 });
  const sockR = Math.hypot(a3.x, a3.y, a3.z);
  check('the flight session stood on the PAD radius, not the ground radius',
    Math.abs(f1.padRadiusM - sockR) < 1e-3, `${f1.padRadiusM} vs ${sockR}`);
  const groundR = of.surface(a3.x, a3.y, a3.z);
  if (typeof groundR === 'number') {
    check('and those two are genuinely different numbers',
      Math.abs(sockR - groundR) > 1.0, `${sockR - groundR} m apart`);
    log.push(`pad socket radius ${r6(sockR)} vs ground ${r6(groundR)}`);
  }

  // ======================================================================
  // 8. THE CLAMPS. Negative control FIRST, on the same pad and rocket.
  // ======================================================================
  const padNow = () => of.game().pads.pads.find((p) => p.id === live.id) ?? null;
  check('the clamps are HOLDING before launch',
    padNow()?.holding === true && padNow()?.clampT === 0,
    JSON.stringify(padNow()));
  of.input.act(['board'], 4);
  await sleep(0.7);
  check('aboard', of.flight('report').aboard === true);
  of.input.act(['stage'], 6);
  await sleep(1.2);
  const held = of.flight('report');
  check('CONTROL: with the throttle shut the clamp still HOLDS',
    held.flight.status === 'CLAMPED', held.flight.status);
  check('CONTROL: and the pad arms have NOT moved', padNow()?.clampT === 0
    && padNow()?.holding === true, JSON.stringify(padNow()));
  check('CONTROL: nothing has released', held.clampReleases === 0,
    held.clampReleases);
  log.push(`control: status ${held.flight.status}, clampT ${padNow()?.clampT}`);

  // FULL throttle, through the key that means full throttle. Ramping with
  // `throttleUp` is what the control above used and it reached TWR 0.978, i.e.
  // just under the release threshold: a partial throttle really does leave the
  // clamp holding, which is the rule working, and a probe that had ramped a
  // little further would have called it a bug in the pad.
  of.input.act(['throttleFull'], 6);
  await sleep(1.2);
  const rel = of.flight('report');
  const ro = of.flight('readout');
  log.push(`release: ${JSON.stringify({ status: rel.flight.status, twr: ro.twr,
    releases: rel.clampReleases, flightTick: rel.clampReleasedAtTick,
    padTick: rel.padReleasedAtTick, clampT: rel.padClampT })}`);
  check('the launch clamp released', rel.flight.status !== 'CLAMPED'
    && rel.clampReleases === 1, `${rel.flight.status} / ${rel.clampReleases}`);
  check('it released because TWR crossed 1', ro.twr >= 1.0, ro.twr);
  // THE ASSERTION THIS FEATURE EXISTS FOR: two ticks, stamped by two systems.
  check('THE PAD CLAMPS FIRED ON THE SAME FIXED TICK AS THE LAUNCH CLAMP',
    rel.padReleasedAtTick >= 0 && rel.padReleasedAtTick === rel.clampReleasedAtTick,
    `pad ${rel.padReleasedAtTick} vs flight ${rel.clampReleasedAtTick}`);
  check('and the arms are swinging back', rel.padClampT > 0, rel.padClampT);
  await sleep(0.9);
  const swung = of.flight('report');
  check('the arms reach the fully-open pose', swung.padClampT >= 0.999,
    swung.padClampT);
  check('and an open clamp stops blocking', padNow()?.holding === false,
    JSON.stringify(padNow()));

  await sleep(2.0);
  const climb = of.flight('report');
  log.push(`climbing: agl ${climb.flight.altitudeAglM} m, met ${climb.flight.metS} s`);
  check('the rocket LEFT the pad', climb.flight.altitudeAglM > 5,
    climb.flight.altitudeAglM);

  return {
    valid: fails.length === 0,
    fails,
    log,
    padModule: m,
    cells: CELLS,
    rolloutOffsetM: r6(f1.padSocketGapM),
    clamp: {
      flightTick: rel.clampReleasedAtTick,
      padTick: rel.padReleasedAtTick,
      sameTick: rel.padReleasedAtTick === rel.clampReleasedAtTick,
      twrAtRelease: ro.twr,
    },
    pads: of.game().pads,
    padView: of.game().padView,
    draws: of.stats().calls,
  };
})()
