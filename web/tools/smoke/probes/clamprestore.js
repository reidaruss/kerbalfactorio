// clamprestore.js: THE LAUNCH CLAMP STILL WORKS ON A VESSEL THAT WAS PUT BACK.
//
//   node tools/smoke/run.mjs --url=... --sandbox=1 --debug=1 \
//     --evalfile=tools/smoke/probes/clamprestore.js
//
// WHY THIS PROBE EXISTS, and it is a specific fear rather than a general one.
// Reid spent a large part of a day behind a rocket bolted to the pad reading
// "clamp holding: TWR 0.00" (PH-20, then GP-73 to GP-76), and the cause was that
// `FlightSim::telemetry` is written by `step` and by nothing else, so a vessel
// nothing had stepped reported zero mass, therefore zero TWR, therefore a clamp
// that could never release, with every number on the HUD reading healthy.
//
// Vessel persistence (PH-64 to PH-67) reopens that door from a new side. A
// promoted vessel with nobody aboard is NEVER STEPPED, because
// `FlightSession.step` is reached only through `VesselObserver.step` and
// `ViewRouter` drives that only while the player is strapped in. So a rocket
// restored onto its pad at boot could have come back massless.
//
// The probe drives the exact path rather than reasoning about it: build the
// reference vehicle, roll it out, DEMOTE it and PROMOTE it again without ever
// boarding (which is what a reload does), and read the mass and the TWR at every
// stage. Then board it and actually leave the pad, because "the numbers look
// right" is not the claim; the claim is that the clamp lets go.
//
// TWO THINGS IT PINS THAT ARE EASY TO CONFUSE. An unattended clamped vessel
// reads TWR 0 and that is CORRECT: the engine is unlit, so thrust really is
// zero. The failure is massKg 0, which makes TWR structurally uncomputable and
// unable to cross 1 however much throttle is applied. The probe asserts the mass
// and asserts that the TWR is zero FOR THE RIGHT REASON.
//
// It also caught a defect that had nothing to do with restoring: a rocket that
// has just been ROLLED OUT and never boarded read `massKg 0` for the whole walk
// over to it. It never blocked anything, because boarding steps the vessel long
// before anyone throttles up, which is exactly why nobody had seen it.
(async () => {
  const of = window.__of;
  const sleep = (s) => of.run(s);
  const fails = [];
  const check = (n, ok, d) => { if (!ok) fails.push(d === undefined ? n : `${n}: ${d}`); };
  const log = [];
  // Build the reference rocket and roll it out, then DEMOTE and PROMOTE it so the
  // restore path runs, WITHOUT ever boarding. That is exactly what a reload does.
const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
  };
  // --- the fixture, same stack ascent.js flies -------------------------------
  of.vab('enter');
  await sleep(0.3);
  const cat = of.vab('catalogue');
  const idxOf = (id) => { const r = cat.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [PID.CommandPod, PID.Parachute, PID.TankLiquidSmall,
                     PID.EngineVacuumSmall, PID.DecouplerStackSmall,
                     PID.TankLiquidSmallLong, PID.EngineLiquidSmall]) {
    const i = idxOf(pid);
    if (i < 0) continue;
    of.vab('frame'); of.vab('take', i);
    await sleep(0.1);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); } else {
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const n = of.vab('nodes').filter((q) => q.parent === low.handle && q.onScreen
        && (q.kind === 'bottom' || q.kind === 'interstage'));
      if (n.length === 0) continue;
      of.vab('hover', n[0].ndc[0], n[0].ndc[1]);
      of.vab('place');
    }
    await sleep(0.12);
  }
  const sym = document.querySelector('[data-vab="sym"][data-n="4"]');
  if (sym) sym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(0.1);
  of.vab('frame'); of.vab('take', idxOf(PID.Fin));
  await sleep(0.1);
  {
    const parts = of.vab('report').parts;
    const tank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const rad = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen
      && (tank === undefined || n.parent === tank.handle));
    if (rad.length > 0) { of.vab('hover', rad[0].ndc[0], rad[0].ndc[1]); of.vab('place'); await sleep(0.2); }
  }
  of.vab('drop');
  const vr = of.vab('report');
  if (vr.parts.length !== 11) return { valid: false, why: `fixture ${vr.parts.length} parts` };
  of.vab('leave');
  await sleep(0.3);

  of.flight('rollout'); await sleep(1.0);
  const f0 = of.flight('report');
  check('ROLLED OUT and never boarded: the rocket already knows its own mass',
        f0.flight.massKg > 1000, `${f0.flight.massKg}`);
  log.push(`rolled out: live ${f0.flight.live} status ${f0.flight.status} mass ${f0.flight.massKg}`);
  // GP-1073: `list[0]` USED TO BE THE ROCKET, and stopped being that the day
  // PH-380/D-015 gave Anchorage a real one-part design instead of the empty
  // one `VesselDesign.fromJson([])` used to build. The registry now seeds
  // `Anchorage` (`SpaceStation.ts`'s `STATION_TAG = 'station:anchorage'`) BEFORE
  // a probe ever rolls anything out, so `list[0]` is the station and this
  // fixture's own rocket lands at `list[1]`. That is not a coincidence a probe
  // should lean on either: `promoteVessel` (`app/FlightVessels.ts`) has refused
  // to promote a station by NAME since the same PH-380 pass ("A PLACE, NOT A
  // VEHICLE, REFUSED BY NAME"), on purpose, so the station id is the one id in
  // the list `promote` can never succeed on. Filter it out the same way the
  // game code recognises it (`isStation`'s own predicate) rather than assuming
  // a position in the array.
  const rec = of.flight('vessels').list.find((r) => r.status !== 'station:anchorage');
  const id = rec ? rec.id : undefined;
  if (!id) return { valid: false, why: 'no record', vessels: of.flight('vessels') };
  of.flight('demote'); await sleep(0.5);
  const d1 = of.flight('report');
  check('demoted: no live session', d1.flight.live === false, JSON.stringify(d1.flight.live));
  const pr = of.flight('promote', id); await sleep(0.0);
  check('promote ok', pr.ok === true, JSON.stringify(pr.ok));
  // THE QUESTION: with NOBODY ABOARD, does the restored parked vessel know its
  // own mass, and can the clamp therefore ever release?
  const un = of.flight('report');
  const ro = of.flight('readout');
  log.push(`UNATTENDED after promote: status ${un.flight.status} massKg ${un.flight.massKg} twr ${ro.twr}`);
  check('UNATTENDED: the restored vessel knows its own MASS', un.flight.massKg > 1000,
        `${un.flight.massKg}`);
  // TWR 0 here is CORRECT and is the discriminator that matters: with the engine
  // unlit and the throttle shut, thrust IS zero, so a truthful TWR is zero. The
  // PH-20 failure is different and is what the mass row above catches: massKg 0
  // makes TWR structurally uncomputable, so it can never cross 1 however much
  // throttle is applied, and the clamp never lets go.
  check('UNATTENDED: TWR is zero because the ENGINE is unlit, not because mass is',
        ro.twr === 0 && un.flight.massKg > 1000, `twr ${ro.twr} mass ${un.flight.massKg}`);
  check('UNATTENDED: it is still on the ground, not moved by the priming step',
        un.flight.status === 'CLAMPED', un.flight.status);
  const aboardBefore = un.aboard;
  // Now board it the way a player does and confirm nothing regressed.
  for (let i = 0; i < 14 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30); await sleep(0.5);
  }
  of.input.act(['board'], 4); await sleep(1.0);
  const ab = of.flight('report');
  const ro2 = of.flight('readout');
  log.push(`ABOARD: aboard ${ab.aboard} mass ${ab.flight.massKg} twr ${ro2.twr} status ${ab.flight.status}`);
  check('ABOARD: still knows its mass', ab.flight.massKg > 1000, `${ab.flight.massKg}`);
  // And the whole point: throttle up, and the clamp must actually let go.
  of.input.act(['throttleFull'], 4); await sleep(0.5);
  of.input.act(['stage'], 4); await sleep(2.0);
  const fl = of.flight('report');
  log.push(`AFTER STAGE+THROTTLE: status ${fl.flight.status} twr ${of.flight('readout').twr} releases ${fl.flight.releases}`);
  check('THE CLAMP RELEASES on a RESTORED vessel', fl.flight.status !== 'CLAMPED',
        `${fl.flight.status}, releases ${fl.flight.releases}`);
  return { valid: true, pass: fails.length === 0, fails, log,
           aboardBefore, id };
})()
