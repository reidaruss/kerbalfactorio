// PH-77: DOES THE ROCKET, THE PAD AND THE BODY COME WITH THE PLAYER ACROSS A
// FLOATING-ORIGIN REBASE?
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --rebase=4000 \
//     --url=http://127.0.0.1:5505/ --evalfile=tools/smoke/probes/vesselrebase.js
//
// THE QUESTION, AND WHY IT IS ASKED AT ALL. The world-gen lane proved that every
// scattered prop detaches on a rebase: a driven 4 km walk measured `staleMaxM`
// 4,000.089191 m across 43 of 43 chunks, the rebase delta to six decimals, and
// it DECAYED raggedly over about ten seconds rather than snapping back, because
// a chunk was only re-placed when it happened to be rebuilt. The scatter was one
// of several consumers composing an engine-space transform, and NOTHING audits
// the rest. `FloatingOrigin` has exactly one emit site and five subscribers, and
// no vessel, flight or pad file is any of them. If a rolled-out rocket, the pad
// under it or the player's own body cached an engine transform, each would be
// left four kilometres behind the first time anybody walked anywhere.
//
// WHY NOTHING IN THIS LANE COULD HAVE FOUND IT. EVERY probe on this project
// TELEPORTS. A teleport moves the player 4 km in one step, which puts every
// resident chunk outside its radius, so the near scene is dropped and rebuilt
// and any stale state is released before a frame is drawn. The defect needs the
// player to ARRIVE at the rebase CONTINUOUSLY, with the rocket already standing
// behind them. `vesselreload.mjs`, `probes/flyto.js`, `probes/pad.js` and
// `probes/padclear.js` all teleport, which is precisely the blind spot, so this
// probe walks for its whole measured section and never teleports after setup.
// That is the only reason it can see anything.
//
// THE INSTRUMENT IS A SUBTRACTION AND NOT A PICTURE. At four kilometres a
// detached rocket is not a wrong-looking rocket, it is an ABSENT one, and "the
// rocket vanished" is equally consistent with a recover, a failed part load, a
// culling bug and the first-person hull cull. A distance between where a thing
// is DRAWN and where it now IS reads non-zero for exactly one reason, and its
// magnitude names the delta.
//
// THE CORRECT VALUE IS A HARD 0.000000 AND NOT A TOLERANCE. Every drawn
// transform below was written through the same f64 `FloatingOrigin.toEngine`
// this re-derives it through, from the same body-frame anchor, so a subject in
// step is bit-identical. There is no band to tune and therefore nothing to
// quietly tune it to.
//
// FOUR SUBJECTS, EACH READ OFF WHAT IS REALLY DRAWN AND NEVER OFF A MIRROR OF
// THE DECISION THAT DREW IT (standing rule 11: a check recomputed out of the
// same assumptions as the thing it checks agrees with it by construction and can
// never fail):
//   rocket  `flight('report').view.drawnEngineM` is `VesselView.root.position`,
//           the Group the meshes hang off, against the sim's own body-frame
//           position taken through `flight('sync')` + `flight('railsAt')`, which
//           the registry DERIVES and never caches (DW-26).
//   pad     `game().padView.staleMaxM` reads the matrix the `BatchedMesh` will
//           really draw with, through `MachineBatch.matrixAt`.
//   body    `stats().avatar.drawnEngineM` is the avatar Group's own transform,
//           against `world().player.feet`, the f64 capsule.
//   record  a DEMOTED vessel is not drawn at all, so the question is different:
//           its stored position must be body-frame and must therefore not move
//           by one millimetre when the origin does. Measured as the drift of
//           `railsAt(id).pos` across the rebase.
//
// `rebasesObserved` IS A VALIDITY TERM AND NOT A REPORTED CURIOSITY (DW-20). A
// walk that never crossed the threshold has tested nothing, and a probe that
// returns green for it is worse than no probe. `drawnPads` and `live` are the
// same term for the other subjects: a zero measured over zero pads, or over a
// vessel that does not exist, is the cheapest and most expensive kind of green
// there is.
//
// THREE LEGS IN ONE UNBROKEN WALK, because demoting and promoting are the two
// states a rebase could be mishandled in differently and stopping between them
// would let the near scene settle:
//   1  promoted, parked on the pad, nobody aboard   -> rocket + pad + body
//   2  demoted to a record                          -> record + pad + body
//   3  promoted again from that record              -> rocket + pad + body
// The tape is laid once and never lifted; `flight('demote')` and
// `flight('promote')` move nothing and advance no frames.
//
// `?rebase=` IS WHAT LETS ALL THREE LEGS FIT IN A SMOKE BUDGET. `Config.rebaseM`
// is `max(16, num(p, 'rebase', 4000))`, so a low threshold forces real rebases
// inside a short walk. The DEFECT does not care what the threshold is: the
// scatter failure was the full delta whatever the delta was, because the
// mechanism is a cached transform and not a magnitude. The shipped 4,000 m is
// still run, because the headline claim is about the number the game ships.
//
// MODE: SANDBOX. This proves the MECHANISM and not the economy; a survival run
// would have to mine 1,440 Stone and smelt 60 Iron before the first measurement
// could be taken. The platform, pad and reference-vehicle routine is
// `probes/padclear.js`'s, copied rather than reinvented for its own stated
// reason: a second way to put a pad down would be a second thing to keep
// correct.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function' || typeof of.vab !== 'function') {
    return { valid: false, why: 'no flight or vab' };
  }
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const D = 180 / Math.PI;
  const r6 = (v) => +v.toFixed(6);

  // Sprint, because the shipped threshold is 4,000 m and the walk has to cover
  // it three times over. The keys are the same queue a keyboard fills.
  const keys = OF_ARGS.keys ?? ['KeyW', 'ShiftLeft'];
  const sliceSecs = OF_ARGS.sliceSecs ?? 4;
  const hz = OF_ARGS.hz ?? 12;
  const legSecs = OF_ARGS.legSecs ?? 900;
  // How long to keep walking AFTER a rebase, so the samples show the SETTLED
  // consequence and not only the instant. The scatter failure decayed over about
  // ten seconds, so a probe that stopped at the rebase frame would have caught
  // its worst value and missed its shape.
  const tailSecs = OF_ARGS.tailSecs ?? 8;

  await sleep(1.0);
  check('this run is SANDBOX', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  // Off `Config` and never off a literal: the threshold is a boot parameter
  // (`?rebase=`) and a probe that assumed 4,000 would silently describe the
  // wrong run the first time somebody lowered it.
  const thresholdM = mustNum(of.config, 'rebaseM', 'config');
  log.push(`rebase threshold ${thresholdM} m`);

  const st = of.structures();
  const pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };

  // =========================================================================
  // SETUP. Teleports are allowed HERE and nowhere below: this is the world
  // being built, not the measurement. Everything from here to the end of
  // section S3 is padclear.js's working routine.
  // =========================================================================

  // ---- aiming at a POINT, by calibration rather than by assumed convention --
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
      if (l < 0.5) { of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue; }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      const pitch = Math.max(-82, Math.min(82, pitchOf(a.origin, u)));
      of.look(horizAngle(a.origin, u) + yawOffset, pitch);
      await sleep(1 / 60);
    }
  };

  // ---- S1. THE PLATFORM. GP-58: a pad stands on 36 decks. -------------------
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };
  const padSlot = slotOf('launchpad');
  const fSlot = slotOf('foundation');
  check('the launch pad has a hotbar slot', padSlot >= 0,
    JSON.stringify(bar().slots.map((s) => s.part)));
  const CELLS = pads.cells(st.module.cellM);
  await hold(fSlot);
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  const site = st.sites[st.sites.length - 1];
  if (site === undefined) return { valid: false, fails, log, why: 'no site' };
  const C = st.module.cellM;
  const cellPoint = (i, j) => ({
    x: site.o.x + site.east.x * (i + 0.5) * C + site.north.x * (j + 0.5) * C,
    y: site.o.y + site.east.y * (i + 0.5) * C + site.north.y * (j + 0.5) * C,
    z: site.o.z + site.east.z * (i + 0.5) * C + site.north.z * (j + 0.5) * C,
  });
  const firstDeck = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = firstDeck?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF;
  const j0 = base[1] - HALF;
  for (let di = 0; di < CELLS; ++di) {
    for (let dj = 0; dj < CELLS; ++dj) {
      await aimAt(cellPoint(i0 + di, j0 + dj));
      of.input.act(['use'], 3);
      await sleep(1 / 30);
    }
  }
  // The repair pass, and padclear.js's reason for it: `aimPoint` marches against
  // what is already BUILT as well as against the ground, so a crosshair swung
  // across a platform stops on the nearest deck's top face. A player solves this
  // by walking; so does this.
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
  }
  const blocked = of.game().structures.parts.filter((p) => p.kind === 'foundation'
    && p.addr !== null && p.addr[0] >= i0 && p.addr[0] < i0 + CELLS
    && p.addr[1] >= j0 && p.addr[1] < j0 + CELLS && p.addr[2] === 0);
  check("the pad's own 6 x 6 block is COMPLETE", blocked.length === CELLS * CELLS,
    blocked.length);

  // ---- S2. THE PAD ----------------------------------------------------------
  await hold(padSlot);
  {
    const c = cellPoint(base[0], base[1]);
    const cr = Math.hypot(c.x, c.y, c.z) || 1;
    of.teleport(Math.asin(c.y / cr) * D, Math.atan2(c.z, c.x) * D, 0);
    await sleep(0.6);
    of.look(of.world().observer.yawDeg, -82);
    await sleep(0.4);
  }
  const padsBefore = pads.list.length;
  of.input.act(['use'], 4);
  await sleep(0.5);
  check('the launch pad went down', pads.list.length === padsBefore + 1,
    `${padsBefore} -> ${pads.list.length}`);
  const pad = pads.list[pads.list.length - 1];
  if (pad === undefined) return { valid: false, fails, log, why: 'no pad placed' };
  log.push(`pad #${pad.id} site ${pad.siteId} cell ${pad.i},${pad.j},${pad.level}`);

  // ---- S3. THE REFERENCE VEHICLE, then the roll-out ONTO the pad ------------
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
  of.vab('leave');
  await sleep(0.3);

  const F = () => of.flight('report');
  {
    const r = Math.hypot(pad.pos.x, pad.pos.y, pad.pos.z) || 1;
    of.teleport(Math.asin(pad.pos.y / r) * D,
      Math.atan2(pad.pos.z, pad.pos.x) * D, 0);
  }
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
  check('a vessel is LIVE on the pad', f1.flight.live === true && f1.flight.parts > 0,
    `live ${f1.flight.live} parts ${f1.flight.parts}`);
  // PROMOTED AND NOT ABOARD is subject (b) and it is the state the whole walk is
  // taken in: the player is on foot, the rocket is standing behind them, and
  // `FlightMode.frame` is drawing it every frame with nobody in it.
  check('and nobody is aboard', f1.aboard === false, f1.aboard);

  // =========================================================================
  // THE MEASUREMENT. Nothing below teleports.
  // =========================================================================
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const feetOf = (w) => (w.player === null ? null : w.player.feet);

  /** The promoted vessel's own body-frame position, DERIVED. `sync` folds the
   *  live sim into the record and `railsAt` reads it back at this tick; neither
   *  advances a frame, so both describe the instant the last frame drew. */
  const vesselBodyPos = () => {
    of.flight('sync');
    const a = of.flight('railsAt');
    return (a === null || a.error !== undefined) ? null : a.pos;
  };
  const recordBodyPos = (id) => {
    const a = of.flight('railsAt', { id });
    return (a === null || a.error !== undefined) ? null : a.pos;
  };

  /** ONE SLICE'S WORTH OF SUBTRACTION, for every subject that exists right now.
   *  `null` where a subject is absent, never 0: a zero over an absent subject is
   *  a pass nobody earned. */
  const measure = (t, leg, recordId, recordPos0) => {
    const w = of.world();
    const o = [w.origin.x, w.origin.y, w.origin.z];
    const eng = (p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const g = of.game();
    const fr = F();
    const row = {
      t, leg,
      rebases: mustNum(w.origin, 'rebases', 'world().origin'),
      speedMps: w.player === null ? 0 : +w.player.speedMps.toFixed(2),
      grounded: w.player === null ? null : w.player.grounded,
      live: fr.flight.live,
    };
    // --- the body ---
    const av = of.stats().avatar;
    const drawnBody = av === null ? null : mustHave(av, 'drawnEngineM', 'stats().avatar');
    const feet = feetOf(w);
    row.bodyM = (drawnBody === null || feet === null) ? null
      : r6(d3(drawnBody, eng(feet)));
    // --- the pad ---
    row.padsDrawn = mustNum(g.padView, 'drawnPads', 'game().padView');
    row.padM = r6(mustNum(g.padView, 'staleMaxM', 'game().padView'));
    // --- the rocket ---
    if (fr.flight.live === true) {
      const drawn = mustHave(fr.view, 'drawnEngineM', 'flight().view');
      const body = vesselBodyPos();
      row.rocketM = body === null ? null : r6(d3(drawn, eng(body)));
      row.rocketParts = fr.view.parts;
    } else {
      row.rocketM = null;
      row.rocketParts = 0;
    }
    // --- the demoted record ---
    if (recordId > 0 && recordPos0 !== null) {
      const p = recordBodyPos(recordId);
      row.recordDriftM = p === null ? null : r6(d3(p, recordPos0));
    } else {
      row.recordDriftM = null;
    }
    return row;
  };

  const samples = [];
  const worst = { bodyM: 0, padM: 0, rocketM: 0, recordDriftM: 0 };
  const seen = { bodyM: 0, padM: 0, rocketM: 0, recordDriftM: 0 };
  const noteWorst = (row) => {
    for (const k of Object.keys(worst)) {
      const v = row[k];
      if (typeof v !== 'number') continue;
      seen[k] += 1;
      if (v > worst[k]) worst[k] = v;
    }
  };

  const start = feetOf(of.world());
  const rebases0 = mustNum(of.world().origin, 'rebases', 'world().origin');
  let elapsed = 0;

  // THE TAPE HAS TO OUTLAST THE WHOLE RUN or the walk stops mid way and the
  // distance quietly stops growing (walk.js's own note). Laid ONCE, for all
  // three legs, so nothing between them is a pause.
  of.input.tape([{ hold: Math.ceil(60 * legSecs * 3) + 600, keys }]);
  // Look along the walk, and level: a crosshair still pitched at the pad's deck
  // walks the player into the ground on the first slope.
  of.look(of.world().observer.yawDeg, 0);

  /** Walk, sampling, until the origin has rebased once more, then keep walking
   *  `tailSecs` so the SETTLED consequence is on the tape too. */
  const walkLeg = async (leg, recordId, recordPos0) => {
    const r0 = mustNum(of.world().origin, 'rebases', 'world().origin');
    let seenRebase = false;
    let tailLeft = tailSecs;
    let spent = 0;
    let atRebase = null;
    while (spent < legSecs) {
      await of.run(sliceSecs, hz);
      spent += sliceSecs;
      elapsed += sliceSecs;
      const row = measure(elapsed, leg, recordId, recordPos0);
      row.metresWalked = +d3(start, feetOf(of.world()) ?? start).toFixed(1);
      samples.push(row);
      noteWorst(row);
      if (!seenRebase && row.rebases > r0) { seenRebase = true; atRebase = row; }
      if (seenRebase) { tailLeft -= sliceSecs; if (tailLeft <= 0) break; }
    }
    return { leg, crossed: seenRebase, secs: spent, atRebase,
      rebases: mustNum(of.world().origin, 'rebases', 'world().origin') - r0 };
  };

  // ---- LEG 1: promoted, parked on the pad, nobody aboard -------------------
  const leg1 = await walkLeg('promoted-on-pad', 0, null);

  // ---- LEG 2: demoted to a record. Still walking. --------------------------
  const dem = of.flight('demote');
  const recordId = typeof dem?.id === 'number' ? dem.id : 0;
  check('the vessel demoted to a record', recordId > 0, JSON.stringify(dem?.id));
  const recordPos0 = recordId > 0 ? recordBodyPos(recordId) : null;
  check('and the record has a position to be moved off',
    recordPos0 !== null && Math.hypot(...recordPos0) > 0,
    JSON.stringify(recordPos0));
  const leg2 = await walkLeg('demoted-record', recordId, recordPos0);

  // ---- LEG 3: promoted again out of that record. Still walking. ------------
  const pro = of.flight('promote', recordId);
  check('the record promoted back to a live vessel', pro?.ok === true,
    JSON.stringify(pro?.ok));
  const leg3 = await walkLeg('promoted-again', 0, null);

  const w = of.world();
  const metresWalked = +d3(start, feetOf(w) ?? start).toFixed(1);
  const rebasesObserved = mustNum(w.origin, 'rebases', 'world().origin') - rebases0;

  // =========================================================================
  // THE VERDICT.
  // =========================================================================
  // VALIDITY FIRST, and stated as failures rather than as a quiet `valid:false`,
  // because a run that tested nothing must not be readable as a pass.
  if (rebasesObserved < 1) {
    fails.push(`walked ${metresWalked} m in ${elapsed} s and NEVER crossed the `
      + `${thresholdM} m rebase threshold: this run tested nothing`);
  }
  for (const l of [leg1, leg2, leg3]) {
    if (!l.crossed) {
      fails.push(`leg "${l.leg}" ran its whole ${l.secs} s budget without a `
        + `rebase, so that leg's subjects were never asked the question`);
    }
  }
  if (seen.rocketM === 0) {
    fails.push('no slice ever measured a LIVE rocket: a zero over an absent '
      + 'vessel is not evidence');
  }
  if (seen.recordDriftM === 0) {
    fails.push('no slice ever measured a demoted RECORD');
  }
  if (seen.bodyM === 0) fails.push('no slice ever measured the drawn body');
  const padsDrawn = Math.max(0, ...samples.map((s) => s.padsDrawn ?? 0));
  if (padsDrawn < 1) {
    fails.push('no slice ever measured a drawn PAD: a zero over zero pads is '
      + 'the cheapest green there is');
  }

  // THE PROPERTY. Hard zero for each subject, stated as four separate claims so
  // a failure says WHICH ONE let go of the origin.
  const claim = (what, v, why) => {
    if (v !== 0) fails.push(`${what} was displaced by up to ${v} m across `
      + `${rebasesObserved} rebase(s) of ${thresholdM} m; ${why}`);
  };
  claim('THE ROCKET', worst.rocketM,
    'VesselView.root was drawn somewhere FlightMode.frame no longer says it is');
  claim('THE LAUNCH PAD', worst.padM,
    'LaunchPadView.sync left a stale matrix in the BatchedMesh');
  claim("THE PLAYER'S OWN BODY", worst.bodyM,
    'Avatar.place left the group where the old origin put it');
  claim('THE DEMOTED RECORD', worst.recordDriftM,
    'a VesselRecord is storing an engine-space position, so it is not a record');

  return {
    valid: rebasesObserved >= 1 && leg1.crossed && leg2.crossed && leg3.crossed
      && seen.rocketM > 0 && seen.recordDriftM > 0 && seen.bodyM > 0
      && padsDrawn > 0,
    fails,
    drove: {
      metresWalked, simSeconds: elapsed, rebasesObserved,
      rebaseThresholdM: thresholdM, keysHeld: keys, teleportsDuringWalk: 0,
      legs: [leg1, leg2, leg3].map((l) => ({ leg: l.leg, crossed: l.crossed,
        secs: l.secs, rebases: l.rebases })),
    },
    // THE ANSWER, one number a subject. 0 means it came with the player.
    worstM: worst,
    slicesMeasured: seen,
    padsDrawn,
    atRebase: { leg1: leg1.atRebase, leg2: leg2.atRebase, leg3: leg3.atRebase },
    log,
    samples,
  };
})()
