// radialdrain.js: DOES A BURN ACTUALLY DRAIN A RADIALLY ATTACHED TANK? (PH-84)
//
// THE QUESTION. The gameplay lane measured the VAB half of this cleanly with a
// controlled triple in which only the joint differs, and found B and C
// BIT-IDENTICAL:
//
//   A  core tank + engine              4300 kg   69.578 s   4179.36 m/s
//   B  + the same tank STACKED         8600 kg  139.156 s   5319.63 m/s
//   C  + the same tank RADIAL          8600 kg  139.156 s   5319.63 m/s
//
// `of_vs_stage_performance` pools propellant by STAGE MEMBERSHIP, so there is
// no crossfeed rule traversing a radial edge because there is no traversal at
// all. If the FLIGHT half instead drains per-tank by some plumbing rule, the
// VAB's delta-v readout is already optimistic for radial parts and Reid plans
// flights against that readout. This file measures the flight half.
//
// THE MEASUREMENT. Light an engine on a design whose CORE TANK ALONE holds
// 4300 kg and watch the LIQUID FUEL aboard fall past 4300.
//   falls past 4300  -> the radial tank is feeding and the VAB is honest.
//   stops dead at 4300 -> it is not feeding and the VAB is lying.
//
// TWO CONTROLS, BOTH MANDATORY, AND BOTH ARE WHY THIS FILE IS LONG:
//
// (1) THE ENGINE MUST BE PROVEN LIT before any propellant number counts as
//     evidence. The previous attempt failed exactly here: it read a flat trace
//     and could not tell "the tank is not feeding" from "the engine never fired
//     at all", and correctly called it a non-result. Section 4 asserts thrust
//     in newtons, the clamp released, and a MEASURED altitude gain under power
//     before section 5 interprets one kilogram.
//
// (2) CASE B, THE STACKED TANK, IS THE POSITIVE CONTROL. B is known-good in the
//     VAB. If B also fails to drain past 4300 the defect is not about radial
//     joints at all and the conclusion changes completely, so all three cases
//     are run and the verdict names which of them fed.
//
// THE READ IS `of.flight('tanks')` AND NOT `of.flight('report').propellantKg`,
// and that distinction is the whole reason the previous pass measured nothing.
// `FlightSession.propellantKg()` sums the CACHED `partRows`, which `refreshParts`
// only rewrites on a roll-out and on a staging, so the reported total DOES NOT
// MOVE while an engine burns. `FlightCheats.ts` documents this beside
// `livePropellantKg`; a probe that watches the reported number during a burn is
// watching a constant. Both numbers are traced below so the disagreement is
// visible rather than assumed.
//
// A FOURTH CASE, D, WAS ADDED BY WHAT THE FIRST RUN OF C FOUND. The bay
// REFUSES to put a liquid tank on a radial node: vessel.h sets `radialMount =
// true` on exactly one propellant-carrying part, the Solid Booster, so case C
// as specified is not a vehicle a player can assemble and has to be built
// through the design library instead (see the block that does it). Case D is
// the same experiment on the strap-on a player CAN build, which is the only
// radially attached tank the shipped game actually has.
//
// EACH CASE IS AN INDEPENDENT PAGE LOAD. `--evalargs='{"case":"C"}'` runs one
// case in one browser, the bay is CLEARED before anything is placed, and no
// case reads a design, a site or a vessel any other case left behind. Running
// the three in one page would have made the third measurement a function of the
// first two, which is not a measurement.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5515/ --sandbox=1 --settle=4 \
//     --evalfile=tools/smoke/probes/radialdrain.js --evalargs='{"case":"A"}'
//
// It REFUSES without --sandbox=1 rather than going green: the full catalogue is
// needed to build the fixture, and a probe that quietly measures a different
// vehicle from the one it names is worse than a red line.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.flight !== 'function') return { valid: false, why: 'no __of.flight' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };

  const CASE = (typeof OF_ARGS === 'object' && OF_ARGS && OF_ARGS.case) || 'A';
  if (['A', 'B', 'C', 'D'].indexOf(CASE) < 0) {
    return { valid: false, why: `unknown case ${CASE}, want A, B, C or D` };
  }
  // How long to burn, in SIM seconds, and the render rate the sim is advanced
  // at. 61.8010 kg/s off one Main Engine empties 4300 kg in 69.578 s, so 95 s
  // is comfortably past the threshold on B and C and past DRY on A.
  const BURN_S = (typeof OF_ARGS === 'object' && OF_ARGS && OF_ARGS.burnS) || 95;
  const HZ = (typeof OF_ARGS === 'object' && OF_ARGS && OF_ARGS.hz) || 45;

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  const F = () => of.flight('report');
  const FL = () => F().flight;
  const TANKS = () => of.flight('tanks');

  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, SolidBooster: 0x0105,
  };
  // vessel.h's own authored figures for the parts used here. Nothing below
  // recomputes them; they are the numbers the assertions are against.
  const CORE = {
    tankCapacityKg: 4300,     // TankLiquidSmallLong.propellantCapacityKg
    boosterCapacityKg: 9000,  // SolidBooster, its own SolidFuel
    podMonopropKg: 40,        // CommandPod, a DIFFERENT propellant kind
    mdotKgS: 61.8010,         // EngineLiquidSmall at any altitude
    burnOneTankS: 69.578,     // 4300 / 61.8010
  };
  // THE PARTS WHOSE PROPELLANT COUNTS, per case. The pod's 40 kg of
  // MONOPROPELLANT is excluded from every case deliberately: the engine
  // consumes LiquidFuel, `feedGroup` filters on the propellant kind, and a
  // total carrying the pod's monoprop would sit 40 kg above the 4300 kg
  // threshold this whole file turns on, which is the difference between
  // "crossed it" and "stopped just above it".
  const PROP_PARTS = CASE === 'D'
    ? [PID.TankLiquidSmallLong, PID.SolidBooster]
    : [PID.TankLiquidSmall, PID.TankLiquidSmallLong];
  const ATTACH_RADIAL = 3;    // sim/wasm/vesselabi.ts

  /** The propellant aboard right now, per part and summed, re-read from /core
   *  on every call. */
  const lf = () => {
    const t = TANKS();
    if (t === null || t.live !== true) return null;
    const rows = t.parts.filter((p) => PROP_PARTS.indexOf(p.partId) >= 0);
    let sum = 0;
    for (const p of rows) sum += p.propellantKg;
    return { sum, rows, cachedTotalKg: t.cachedTotalKg, liveTotalKg: t.liveTotalKg };
  };

  // ==========================================================================
  // 0. SETUP PROOF. Nothing below is believed until this passes.
  // ==========================================================================
  const gm = of.game().mode;
  const modeName = typeof gm === 'string' ? gm : (gm && gm.mode);
  if (modeName !== 'sandbox') {
    // A REFUSAL, not a failed check. The catalogue this fixture needs is not
    // offered outside sandbox, so every number after this point would be about
    // a different vehicle. Going green here would be the worst outcome.
    return { valid: false, why: 'this probe REFUSES without --sandbox=1: the '
      + 'full part catalogue is needed to build the fixture, and the flag is a '
      + 'RUNNER flag (a query string in --url is discarded)', mode: modeName };
  }
  check('the loop is ticking', of.world().tick > 0, `tick ${of.world().tick}`);
  const f0 = F();
  check('the flight lane loaded its meshes', f0.loaded === true);
  check('no vessel exists yet', f0.flight.live === false);
  check('and the tank read agrees there is nothing to read',
        TANKS().live === false, JSON.stringify(TANKS()));
  if (fails.length > 0) return { valid: false, why: 'setup', fails, case: CASE };

  // ==========================================================================
  // 1. BUILD THE CASE. One stack, one stage, no decoupler, so `feedGroup`'s
  //    "same stage as the engine" is satisfied by every tank on the vehicle and
  //    the ONLY difference between B and C is the joint.
  //
  //    A: pod / tank / engine                       4300 kg LF, 3 parts
  //    B: pod / tank / tank / engine                8600 kg LF, 4 parts
  //    C: pod / tank / engine + tank RADIAL on tank 8600 kg LF, 4 parts
  // ==========================================================================
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  // CLEARED FIRST, every time. The bay persists designs, and a case that
  // inherited three parts from whatever ran before it would be measuring the
  // previous run.
  of.vab('press', 'clear');
  await sleep(0.2);
  check('the bay started empty', of.vab('report').parts.length === 0,
        `${of.vab('report').parts.length} parts survived the clear`);
  // SYMMETRY 1, asserted rather than assumed: at 4 the radial press would put
  // FOUR tanks on and case C would hold 21500 kg instead of 8600.
  const sym1 = document.querySelector('[data-vab="sym"][data-n="1"]');
  if (sym1) sym1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.12);
  check('symmetry is 1, so one radial press puts ONE tank on',
        of.vab('report').symmetry === 1, `${of.vab('report').symmetry}`);

  /**
   * PUT `pid` IN HAND AND PROVE IT IS THERE.
   *
   * `take` is a real click on the catalogue entry, and that click TOGGLES: case
   * B places the same large tank twice in a row, the second click landed on a
   * part the hand already held, the bay put it down again, and the placement
   * that followed refused with "nothing in hand" while the probe reported it as
   * a failed PLACEMENT. Two clicks are one round trip, so the second click is
   * unconditional-if-needed rather than clever, and the hand is read back
   * (`handIndex`) rather than assumed.
   */
  const takeInHand = async (i) => {
    for (let k = 0; k < 3; ++k) {
      if (of.vab('report').handIndex === i) return true;
      of.vab('take', i);
      await sleep(0.12);
    }
    return of.vab('report').handIndex === i;
  };

  /** Place `pid` on the BOTTOM node of the lowest part on the stack, which is
   *  how the shipped ascent fixture is assembled. */
  const stackOn = async (pid) => {
    const i = idxOf(pid);
    if (i < 0) { log.push(`part ${pid.toString(16)} not offered`); return false; }
    of.vab('frame');
    if (!await takeInHand(i)) {
      log.push(`could not get part ${pid.toString(16)} into the hand`);
      return false;
    }
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); return true; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const n = of.vab('nodes').filter((q) => q.parent === low.handle && q.onScreen
      && (q.kind === 'bottom' || q.kind === 'interstage'));
    if (n.length === 0) { log.push(`no bottom node under ${low.handle}`); return false; }
    // EVERY offered node is tried, not just the first. `projectNodes` orders by
    // whatever the node list happens to hold, and a single-candidate placement
    // that refuses reports "the part did not go on" when what actually happened
    // is that one particular socket was occupied. Trying them all and REPORTING
    // the refusal keeps those two readings apart.
    for (const q of n) {
      of.vab('hover', q.ndc[0], q.ndc[1]);
      const r = of.vab('place');
      await sleep(0.15);
      if (r.ok === true) return true;
      log.push(`refused on ${low.handle}/${q.kind}: `
        + `${r.report.message} blocked=${JSON.stringify(r.report.blocked)} `
        + `snapped=${JSON.stringify(r.report.snapped)}`);
    }
    return false;
  };

  const chain = CASE === 'B'
    ? [PID.CommandPod, PID.TankLiquidSmallLong, PID.TankLiquidSmallLong, PID.EngineLiquidSmall]
    : [PID.CommandPod, PID.TankLiquidSmallLong, PID.EngineLiquidSmall];
  for (const pid of chain) {
    const ok = await stackOn(pid);
    check(`placed part ${pid.toString(16)}`, ok);
  }

  // ------------------------------------------------------------------------
  // THE RADIAL JOINT. It is the only thing that differs between B and C, and
  // getting it on the rocket at all is a finding in its own right.
  //
  // THE BAY REFUSES IT: `fitAt` in game/VesselNodes.ts turns away anything
  // whose `radialMount` is false at a radial node, and vessel.h sets
  // `radialMount = true` on exactly one propellant-carrying part, the Solid
  // Booster, which carries its OWN SolidFuel and can never crossfeed by
  // construction. Placing a Fuel Tank (large) on a hull answers "Fuel Tank
  // (large) [S] has no radial mount", MEASURED below rather than asserted, so
  // the refusal is a recorded fact and not a claim about a file.
  //
  // The case is therefore built the only way it can be: as a DESIGN, through
  // `Vab.fromJson`, which calls `_of_vs_attach` with Attach::Radial directly.
  // /core's `attach` takes any part at any joint (vessel.h has no mount check),
  // so the vehicle the gameplay lane measured in the bay does exist. THIS IS
  // NOT A PLAYER PATH and the report says so; it is the only way to ask the
  // flight half of the question about a vehicle the bay will not assemble.
  //
  // Case D is the player path: the Solid Booster, strapped on through the real
  // snap search, which is the shipped answer to "radial propellant".
  // ------------------------------------------------------------------------
  let radialParent = -1;
  let radialRefusal = '';
  let builtVia = 'the bay, part by part';
  if (CASE === 'C') {
    const pre = of.vab('report').parts;
    const core = pre.find((p) => p.partId === PID.TankLiquidSmallLong);
    check('case C found the core tank to strap to', core !== undefined);
    if (core !== undefined) {
      // (a) THE REFUSAL, MEASURED. A real take, a real hover on a real radial
      //     node, a real press.
      of.vab('frame');
      check('case C got a second large tank into the hand',
            await takeInHand(idxOf(PID.TankLiquidSmallLong)),
            `handIndex ${of.vab('report').handIndex}`);
      const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
        && n.parent === core.handle);
      check('the core tank does offer radial nodes to aim at', rad.length > 0,
            `${rad.length} radial nodes on handle ${core.handle}`);
      if (rad.length > 0) {
        of.vab('hover', rad[0].ndc[0], rad[0].ndc[1]);
        const r = of.vab('place');
        await sleep(0.2);
        radialRefusal = r.ok === true ? '' : String(r.report.message);
        check('THE BAY REFUSES a liquid tank at a radial node, and says why',
              r.ok === false && /no radial mount/.test(radialRefusal),
              `ok ${r.ok}, message "${radialRefusal}"`);
      }
      of.vab('drop');
      await sleep(0.15);

      // (b) THE SAME VEHICLE, BUILT AS A DESIGN. Saved through the real save
      //     control, one row appended, loaded back through the real design
      //     button. Nothing here reaches into `Vab`: it edits the library
      //     `VabStore` reads and then presses load.
      const KEY = 'of-vab-designs-v1';
      of.vab('save', 'rd-core');
      await sleep(0.25);
      let lib = {};
      try { lib = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { lib = {}; }
      const src = lib['rd-core'];
      check('the core stack saved to the design library', src !== undefined
            && Array.isArray(src.parts) && src.parts.length === 3,
            JSON.stringify(Object.keys(lib)));
      if (src !== undefined && Array.isArray(src.parts)) {
        const coreIdx = src.parts.findIndex((q) => q.p === PID.TankLiquidSmallLong);
        check('the core tank is in the saved rows', coreIdx >= 0,
              JSON.stringify(src.parts));
        const rows = src.parts.slice();
        rows.push({
          p: PID.TankLiquidSmallLong, parent: coreIdx, a: ATTACH_RADIAL,
          ang: 0,
          // Halfway up a 4.00 m tank, so the strap-on sits alongside the core
          // rather than hanging off one end. `off` is `radialOffsetM`, the
          // height up the PARENT the mount sits at (ABI 20 / PH-81).
          off: 2.0,
          // The SAME stage word every other row carries, so `feedGroup`'s
          // "same stage as the engine" cannot be what excludes it. Copied
          // rather than written as a literal: 0x7fffffff is `NEVER` and means
          // "let the derivation decide", and hard-coding a 0 here would be a
          // different experiment.
          st: src.parts[coreIdx].st,
        });
        // THE EXISTING NAME IS OVERWRITTEN rather than a new one added, and
        // that is a workaround with a measured reason. `of.vab('load', n)` is a
        // real click on the real `[data-vab="design"][data-name=n]` button, and
        // that button has to be in the DOM: `VabPanel` rebuilds its body only
        // when its render key moves and the design LIBRARY is not in that key,
        // so a name written straight into localStorage is listed by `report()`
        // (which reads the store) while no button for it ever appears. Measured
        // on the first attempt: report().designs held ["rd-core","rd-radial"],
        // the DOM held only ["rd-core"], and the load answered "no design named
        // rd-radial". Rewriting `rd-core` under the button that already exists
        // keeps the press a real press.
        lib['rd-core'] = { ...src, name: 'rd-core', parts: rows };
        localStorage.setItem(KEY, JSON.stringify(lib));
        await sleep(0.3);
        const loadRes = of.vab('load', 'rd-core');
        await sleep(0.5);
        log.push(`load rd-core (now carrying the radial row): ${
          loadRes && loadRes.error ? loadRes.error
            : `message "${of.vab('report').message}"`}`);
        builtVia = 'the design library (Vab.fromJson -> _of_vs_attach with '
          + 'Attach::Radial), because the bay refuses this joint';
        const after = of.vab('report').parts;
        const rr = after.find((p) => p.attach === ATTACH_RADIAL);
        check('the loaded design has the radial tank on it', rr !== undefined,
              JSON.stringify(after.map((p) => ({ id: p.partId, a: p.attach }))));
        radialParent = rr === undefined ? -1 : rr.parent;
        check('and it hangs off the CORE TANK, not off the pod or the engine',
              rr !== undefined && after.some(
                (p) => p.handle === rr.parent && p.partId === PID.TankLiquidSmallLong),
              JSON.stringify(after.map((p) => ({ h: p.handle, id: p.partId,
                                                 parent: p.parent }))));
      }
    }
  }

  // CASE D: THE SHIPPED RADIAL PROPELLANT PART, through the real snap search.
  // The Solid Booster is the one part in the catalogue that both carries
  // propellant and mounts radially, so it is the only radially attached tank a
  // player can actually build, and what it does in flight is the question that
  // is actually about the shipped game.
  if (CASE === 'D') {
    const pre = of.vab('report').parts;
    const core = pre.find((p) => p.partId === PID.TankLiquidSmallLong);
    check('case D found the core tank to strap to', core !== undefined);
    if (core !== undefined) {
      of.vab('frame');
      check('case D got a Solid Booster into the hand',
            await takeInHand(idxOf(PID.SolidBooster)),
            `handIndex ${of.vab('report').handIndex}`);
      const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
        && n.parent === core.handle);
      check('the core tank offers a radial node on screen', rad.length > 0,
            `${rad.length} radial nodes on handle ${core.handle}`);
      let on = false;
      for (const q of rad) {
        of.vab('hover', q.ndc[0], q.ndc[1]);
        const r = of.vab('place');
        await sleep(0.2);
        if (r.ok === true) { on = true; radialParent = core.handle; break; }
        log.push(`D refused at a radial node: ${r.report.message}`);
      }
      check('THE BOOSTER STRAPPED ON through the real snap search, so this case '
            + 'is a vehicle a player can build', on === true);
    }
  }
  of.vab('drop');
  await sleep(0.15);

  const vr = of.vab('report');
  const wantParts = CASE === 'A' ? 3 : 4;
  check('the case assembled with the right part count',
        vr.parts.length === wantParts, `${vr.parts.length}, wanted ${wantParts}`);
  const wantLfKg = CASE === 'D'
    ? CORE.tankCapacityKg + CORE.boosterCapacityKg
    : (CASE === 'A' ? 1 : 2) * CORE.tankCapacityKg;
  // THE VAB'S OWN CLAIM, recorded so the flight can be held against it. This is
  // the number the gameplay lane found identical for B and C, and it is the
  // number that is either honest or optimistic once the engine lights.
  const vabStats = vr.stats;
  // A BAND, not an equality, and the band is exactly the pod's monopropellant.
  // Whether `DesignStats.propellantKg` counts the pod's 40 kg of a DIFFERENT
  // propellant kind is a question about the bay's totals and not about this
  // measurement, so the check is written so that either answer passes and the
  // reported number says which it was.
  check('the VAB agrees this design holds what vessel.h says the tanks hold',
        vabStats !== undefined && vabStats.propellantKg >= wantLfKg - 1
          && vabStats.propellantKg <= wantLfKg + CORE.podMonopropKg + 1,
        `${vabStats && vabStats.propellantKg} kg against ${wantLfKg} LF `
        + `(+${CORE.podMonopropKg} monoprop at most)`);
  const vabStage0 = (vr.stages && vr.stages[0]) || null;
  // THE VAB'S OWN STAGE POOL: the number the gameplay lane found IDENTICAL for
  // B and C. It is asserted here so that "the bay pools by stage membership" is
  // a measurement this file took rather than a fact it inherited. Case D holds
  // two DIFFERENT propellants, and the stage pool is a per-kind number, so the
  // equality is only meaningful for the three single-propellant cases.
  if (CASE !== 'D') {
    check('the VAB pools this stage at every tank aboard',
          vabStage0 !== null && Math.abs(vabStage0.propellantKg - wantLfKg) <= 1,
          `${vabStage0 && vabStage0.propellantKg} kg against ${wantLfKg}`);
  }
  const wantRadial = (CASE === 'C' || CASE === 'D') ? 1 : 0;
  const radialRows = vr.parts.filter((p) => p.attach === ATTACH_RADIAL);
  check(wantRadial === 1 ? `case ${CASE} has exactly ONE radial joint`
        : `case ${CASE} has NO radial joint (it is the control)`,
        radialRows.length === wantRadial, `${radialRows.length} radial parts`);
  if (wantRadial === 1) {
    check('and the radial row reports the offset it is mounted at',
          radialRows.length === 1 && typeof radialRows[0].radialOffsetM === 'number',
          JSON.stringify(radialRows));
  }
  // EVERY TANK IN THE ENGINE'S STAGE. `feedGroup` filters on `p.stage ==
  // engine.stage`, so a radial tank that landed in a different stage would be
  // excluded by that rule and not by anything about radial joints, and the two
  // readings need different fixes. Not asked of case D, whose booster is its
  // own engine and its own tank and joins no group at all.
  const engRow = vr.parts.find((p) => p.partId === PID.EngineLiquidSmall);
  const tankRows = vr.parts.filter((p) => PROP_PARTS.indexOf(p.partId) >= 0);
  if (CASE !== 'D') {
    check('every tank is in the ENGINE\'S OWN stage, so the stage rule cannot be '
          + 'what excludes one of them',
          engRow !== undefined && tankRows.every((p) => p.stage === engRow.stage),
          JSON.stringify({ engine: engRow && engRow.stage,
                           tanks: tankRows.map((p) => p.stage) }));
  }
  log.push(`case ${CASE} in the bay: ${vr.parts.length} parts, `
    + `${vabStats && vabStats.propellantKg} kg propellant, `
    + `dv ${vabStats && vabStats.totalDeltaV}, `
    + `stage 0 pool ${vabStage0 && vabStage0.propellantKg} kg over `
    + `${vabStage0 && vabStage0.burnTimeS} s, `
    + `radial joints ${radialRows.length}`);
  of.vab('leave');
  await sleep(0.3);
  if (fails.length > 0) {
    return { valid: false, why: 'the fixture did not assemble', case: CASE,
             fails, log, vab: vr };
  }

  // ==========================================================================
  // 2. ROLL OUT AND BOARD. Same two presses ascent.js makes, and the walk is
  //    the same walk: the vessel is planted out of boarding range on purpose.
  // ==========================================================================
  of.input.act(['board'], 4);
  await sleep(0.4);
  let r = F();
  check('a vessel rolled out', r.rollouts === 1 && r.flight.live === true,
        JSON.stringify({ rollouts: r.rollouts, live: r.flight.live }));
  check('the whole vehicle came across the bridge',
        r.flight.parts === wantParts, `${r.flight.parts} of ${wantParts}`);
  check('it is HELD BY THE CLAMP, not falling', r.flight.status === 'CLAMPED',
        r.flight.status);
  for (let i = 0; i < 14 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.input.act(['board'], 4);
  await sleep(0.4);
  r = F();
  check('the player boarded it', r.aboard === true && r.boardings === 1,
        `aboard ${r.aboard}, boardings ${r.boardings}`);
  if (fails.length > 0) {
    return { valid: false, why: 'never got aboard', case: CASE, fails, log,
             flight: F() };
  }

  // ==========================================================================
  // 3. THE TANKS ON THE PAD, before anything is lit. This is the baseline every
  //    later kilogram is measured against, and it is READ FROM /core rather
  //    than assumed from the catalogue.
  // ==========================================================================
  const pad = lf();
  check('the live per-tank read came back', pad !== null, JSON.stringify(TANKS()));
  check('the right number of tanks are aboard',
        pad !== null && pad.rows.length === (CASE === 'A' ? 1 : 2),
        pad === null ? 'null' : `${pad.rows.length} tanks`);
  check('and they are FULL to vessel.h\'s capacity on the pad',
        pad !== null && Math.abs(pad.sum - wantLfKg) <= 1,
        pad === null ? 'null' : `${pad.sum.toFixed(1)} kg against ${wantLfKg}`);
  const padRows = pad === null ? [] : pad.rows.map((p) => ({
    handle: p.handle, parent: p.parent, attach: p.attach, stage: p.stage,
    radialOffsetM: +p.radialOffsetM.toFixed(3),
    kg: +p.propellantKg.toFixed(1),
  }));
  log.push(`on the pad: ${JSON.stringify(padRows)}`);

  // ==========================================================================
  // 4. PROVE THE ENGINE IS LIT. THIS IS THE GATE. Nothing after it is believed
  //    until every line here is green, because a flat propellant trace under an
  //    UNLIT engine is evidence of nothing at all, and that is precisely the
  //    non-result this measurement exists to replace.
  //
  //    Four independent witnesses, because any one of them alone has a way of
  //    lying: thrust in newtons off /core's telemetry; the clamp having let go;
  //    MASS FALLING, which no readout can fake because it is the propellant
  //    leaving by another name; and ALTITUDE GAINED UNDER POWER.
  // ==========================================================================
  const aglOnPad = FL().altitudeAglM;
  of.input.act(['throttleFull'], 4);
  await sleep(0.4);
  r = F();
  check('the throttle is wide open', Math.abs(r.flight.throttle - 1) < 1e-6,
        `${r.flight.throttle}`);
  check('and the clamp still holds an UNLIT rocket (the negative control: if '
        + 'this fails the clamp is not what releases on ignition)',
        r.flight.status === 'CLAMPED' && r.flight.thrustN === 0,
        `${r.flight.status}, thrust ${r.flight.thrustN} N`);
  const massBeforeIgnition = FL().massKg;

  of.input.act(['stage'], 6);
  await sleep(0.8);
  r = F();
  const thrustN = r.flight.thrustN;
  check('WITNESS 1: THE ENGINE IS LIT, in newtons off /core\'s telemetry',
        thrustN > 1e5, `${thrustN} N`);
  check('WITNESS 2: the clamp released', r.flight.status !== 'CLAMPED',
        r.flight.status);
  await sleep(4);
  r = F();
  const aglAfter = FL().altitudeAglM;
  const massAfter = FL().massKg;
  check('WITNESS 3: MASS IS FALLING, which is propellant leaving under another '
        + 'name and is the one witness no readout can fake',
        massAfter < massBeforeIgnition - 100,
        `${massBeforeIgnition.toFixed(1)} -> ${massAfter.toFixed(1)} kg`);
  check('WITNESS 4: IT LEFT THE GROUND under power',
        r.flight.liftedOff === true && aglAfter > aglOnPad + 5,
        `agl ${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m`);
  check('and it is going UP', r.flight.verticalMS > 1, `${r.flight.verticalMS} m/s`);
  log.push(`IGNITION PROVEN: thrust ${thrustN.toFixed(0)} N, mass `
    + `${massBeforeIgnition.toFixed(1)} -> ${massAfter.toFixed(1)} kg, agl `
    + `${aglOnPad.toFixed(2)} -> ${aglAfter.toFixed(2)} m, `
    + `${r.flight.verticalMS.toFixed(1)} m/s up`);
  if (fails.length > 0) {
    // A HARD STOP, and it is the point of the whole file. Reporting a
    // propellant trace taken behind an unproven ignition is how the last
    // attempt produced a number that meant nothing.
    return { valid: false, case: CASE,
             why: 'THE ENGINE WAS NOT PROVEN LIT, so no propellant reading '
               + 'below would have been evidence of anything',
             fails, log, flight: F(), tanks: TANKS() };
  }

  // ==========================================================================
  // 5. THE BURN, AND THE TRACE. Straight up, hands off the pitch keys, so the
  //    only thing changing is how much is left in the tanks. Nothing steers,
  //    nothing stages, nothing warps: warp resamples the stick and this run has
  //    no pilot to lose, but it also changes the step size, and the one number
  //    being measured is a per-tick integral.
  // ==========================================================================
  const trace = [];
  const sample = (tag) => {
    const q = lf();
    const s = FL();
    if (q === null) return null;
    const row = {
      tag, metS: +s.metS.toFixed(2), thrustN: Math.round(s.thrustN),
      massKg: +s.massKg.toFixed(1),
      lfKg: +q.sum.toFixed(1),
      // The two totals side by side. `cached` is what
      // `flight('report').propellantKg` sums and is expected to sit frozen at
      // its roll-out value for the whole burn; `live` is the re-read. They are
      // printed together so the disagreement is a measurement rather than a
      // claim made in a comment.
      cachedKg: +q.cachedTotalKg.toFixed(1),
      liveKg: +q.liveTotalKg.toFixed(1),
      reportedKg: s.propellantKg,
      tanks: q.rows.map((p) => +p.propellantKg.toFixed(1)),
    };
    trace.push(row);
    return row;
  };
  sample('ignition+4s');

  const SLICE_S = 5;
  const slices = Math.ceil(BURN_S / SLICE_S);
  let crossed = null;         // the first sample at or below one tank's worth
  let dry = null;             // the first sample with nothing left
  for (let i = 0; i < slices; ++i) {
    await of.run(SLICE_S, HZ);
    const row = sample(`t+${(i + 1) * SLICE_S}s`);
    if (row === null) break;
    if (crossed === null && row.lfKg < CORE.tankCapacityKg - 1) crossed = row;
    if (dry === null && row.lfKg <= 1) { dry = row; break; }
    if (FL().status === 'DOWN') { log.push('the vehicle came down mid-burn'); break; }
  }
  const last = trace[trace.length - 1];

  // ==========================================================================
  // 6. THE VERDICT, PER CASE.
  // ==========================================================================
  const spentKg = pad.sum - last.lfKg;
  log.push(`case ${CASE}: ${pad.sum.toFixed(1)} -> ${last.lfKg.toFixed(1)} kg LF `
    + `in ${last.metS.toFixed(1)} s of mission time, ${spentKg.toFixed(1)} kg spent`);

  check('propellant actually left the tanks', spentKg > 100,
        `${spentKg.toFixed(1)} kg`);
  // THE RATE, against vessel.h's authored 61.8010 kg/s. A drain that is real
  // but at the wrong rate is a different defect from a drain that does not
  // happen, and a check that only asks "did it fall" cannot tell them apart.
  // Case D burns two engines on two different propellants at once, so its rate
  // is a sum this file has no single authored number for and does not assert.
  const rate = last.metS > 1 ? spentKg / last.metS : 0;
  if (CASE !== 'D') {
    check('and it left at ONE engine\'s authored mass flow',
          Math.abs(rate - CORE.mdotKgS) < 4,
          `${rate.toFixed(3)} kg/s against vessel.h's ${CORE.mdotKgS}`);
  }

  if (CASE === 'D') {
    // THE PLAYER-REACHABLE RADIAL PROPELLANT CASE. The booster is its own tank
    // and its own engine, so the question is not crossfeed: it is whether a
    // RADIALLY ATTACHED part's propellant is consumed at all. The two rows are
    // asked separately, because "the total fell" is satisfied by the core tank
    // alone and would say nothing about the strap-on.
    const rowOf = (pid) => {
      const i = pad.rows.findIndex((p) => p.partId === pid);
      return i < 0 ? null : { i, padKg: pad.rows[i].propellantKg };
    };
    const boost = rowOf(PID.SolidBooster);
    const core = rowOf(PID.TankLiquidSmallLong);
    check('D: the booster row was found on the pad', boost !== null);
    check('D: the core tank row was found on the pad', core !== null);
    if (boost !== null && core !== null) {
      const bLast = last.tanks[boost.i];
      const cLast = last.tanks[core.i];
      log.push(`D: booster ${boost.padKg.toFixed(1)} -> ${bLast.toFixed(1)} kg, `
        + `core tank ${core.padKg.toFixed(1)} -> ${cLast.toFixed(1)} kg`);
      check('D: THE RADIALLY ATTACHED BOOSTER BURNED ITS OWN PROPELLANT',
            bLast < boost.padKg - 100,
            `${boost.padKg.toFixed(1)} -> ${bLast.toFixed(1)} kg`);
      check('D: and the core tank drained too, so both ends of the vehicle ran',
            cLast < core.padKg - 100,
            `${core.padKg.toFixed(1)} -> ${cLast.toFixed(1)} kg`);
    }
  } else if (CASE === 'A') {
    // The single-tank control. It must run DRY, and the whole vehicle only ever
    // held one tank's worth, so "fell past 4300" is meaningless here by
    // construction and is not asserted.
    check('A: the one tank ran DRY inside the burn budget', dry !== null,
          `${last.lfKg.toFixed(1)} kg left after ${last.metS.toFixed(1)} s`);
    check('A: and it took about the burn time vessel.h implies',
          dry !== null && Math.abs(dry.metS - CORE.burnOneTankS) < 8,
          dry === null ? 'never dry' : `${dry.metS} s against ${CORE.burnOneTankS}`);
  } else {
    // THE MEASUREMENT. Both B and C hold two tanks' worth; falling past what
    // ONE tank holds is only possible if the second tank fed the engine.
    check(`${CASE}: THE TOTAL FELL PAST ${CORE.tankCapacityKg} kg, which one `
          + 'tank alone could not do, so BOTH tanks fed the engine',
          crossed !== null,
          `lowest seen ${last.lfKg.toFixed(1)} kg after ${last.metS.toFixed(1)} s`);
    // WHICH TANK EMPTIES FIRST is the plumbing rule itself, and a total that
    // falls past 4300 proves feeding without telling us the rule. Proportional
    // draw keeps the two rows equal all the way down; a sequential rule empties
    // one and leaves the other full. Both are reported either way.
    const t = last.tanks;
    const spread = t.length === 2 ? Math.abs(t[0] - t[1]) : 0;
    log.push(`${CASE}: per-tank at the end ${JSON.stringify(t)}, spread `
      + `${spread.toFixed(1)} kg`);
    check(`${CASE}: the two tanks drained TOGETHER (proportional), not one after `
          + 'the other', t.length === 2 && spread < 50,
          `${JSON.stringify(t)}`);
  }

  // THE CACHED READOUT, MEASURED. `flight('report').propellantKg` is expected
  // to sit frozen at its roll-out value while the live read falls, and that
  // frozen number is what the previous attempt was watching. It is asserted so
  // that if it is ever fixed this line goes red and says so, rather than the
  // finding quietly rotting into a comment nobody rereads.
  const first = trace[0];
  const cachedMoved = Math.abs(last.cachedKg - first.cachedKg) > 1;
  const liveMoved = Math.abs(last.liveKg - first.liveKg) > 1;
  log.push(`the two readouts: cached ${first.cachedKg} -> ${last.cachedKg} `
    + `(moved ${cachedMoved}), live ${first.liveKg} -> ${last.liveKg} `
    + `(moved ${liveMoved}), report().propellantKg ${first.reportedKg} -> `
    + `${last.reportedKg}`);

  return {
    valid: true,
    pass: fails.length === 0,
    case: CASE,
    fails,
    log,
    vab: {
      parts: vr.parts.length, stats: vabStats, stage0: vabStage0,
      radialParent, radialRows, builtVia,
      // The bay's own sentence when a liquid tank is offered a radial node.
      // Empty on every case that never asked.
      radialRefusal,
    },
    ignition: {
      thrustN, massBeforeIgnition: +massBeforeIgnition.toFixed(1),
      massAfterKg: +massAfter.toFixed(1),
      aglOnPadM: +aglOnPad.toFixed(2), aglAfterM: +aglAfter.toFixed(2),
    },
    padTanks: padRows,
    threshold: { oneTankKg: CORE.tankCapacityKg, startedKg: +pad.sum.toFixed(1),
                 lowestKg: +last.lfKg.toFixed(1),
                 fellPastOneTank: crossed !== null,
                 crossedAtS: crossed === null ? -1 : crossed.metS,
                 dryAtS: dry === null ? -1 : dry.metS,
                 spentKg: +spentKg.toFixed(1),
                 rateKgS: +rate.toFixed(3) },
    staleReadout: { cachedMoved, liveMoved,
                    cachedFirst: first.cachedKg, cachedLast: last.cachedKg,
                    liveFirst: first.liveKg, liveLast: last.liveKg },
    trace,
    flight: FL(),
  };
})()
