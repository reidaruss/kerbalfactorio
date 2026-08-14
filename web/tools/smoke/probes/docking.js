// docking.js: PH-360 to PH-369. MANUAL DOCKING, END TO END (D-015's first
// layer, R93's missing bridge, and the button that presses it).
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/docking.js
//
// =============================================================================
// WHAT THIS IS FOR.
//
// R93's finding was that `of_fl_dock_*` had no client caller and no `of_dk_*`
// symbol existed at all, "so the client cannot even ask". ABI 26 added five
// exports and `app/FlightDock.ts` is the one thing that calls them. This probe
// drives the whole chain in a real browser: the candidate query, the four
// refusals, the capture, the join, the save shape and the release.
//
// =============================================================================
// WHY THE VESSEL IS DEBUG-PLACED AND NOT FLOWN, SAID FIRST BECAUSE IT IS THE
// BIGGEST THING THIS PROBE GIVES UP.
//
// A hand-flown rendezvous is minutes of wall clock and `phrendezvous.js`
// already measures that half (it flew one: 0.23133 m/s relative at 108.87 m).
// What is under test HERE is the latch, and a probe that spent four minutes
// flying would be measuring the pilot. So `of.flight('place')` writes /core's
// state directly, which is honest as long as the thing it writes is not the
// thing being asserted -- and it is not: every verdict below comes from
// `of_dk_candidate`, i.e. from `of/docking.h`, run against whatever state
// happens to be there.
//
// THE PLACEMENT IS ALSO NOT A SECOND COPY OF THE MATING ARITHMETIC. It reads
// the LIVE port pose off `of.flight('dockTarget')`, which is the same object
// the capture test is armed with, and offsets along it. If this probe and the
// game disagreed about where the port is, the placement would land somewhere
// the game refuses, and that is a finding rather than a false pass.
//
// `of.standAt` CANNOT BOARD THE MOVING STATION (StationMount.ts CE-41: it
// zeroes the velocity, which on a carrier moving at 1879 m/s leaves the player
// behind). Nothing here tries: the player stays strapped into the vessel for
// the whole run, which is what a docking is anyway.
//
// =============================================================================
// WHAT WOULD MAKE THIS VACUOUS, NAMED BEFORE MEASURING.
//
//  1. NO STATION. Every check would be about a `hasTarget: false` publication
//     and would pass having asserted nothing. Section 0 fails loudly on it.
//  2. NO PORT ON THE ROCKET. Same shape: the control is dark for the whole run
//     and every "it refused" check passes. Section 0 asserts `dock.hasPort`.
//  3. A CONTROL THAT IS ALWAYS DARK. Four refusals in a row would pass a suite
//     that never saw a capture, so section 4 is the positive control and the
//     probe fails if the dock never becomes available.
//  4. A CONTROL THAT IS ALWAYS LIT. Section 1 is the negative control: 100 km
//     out, the answer must be no, and it must say which no.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const rows = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const rec = (k, v, note) => rows.push(note === undefined ? [k, v] : [k, v, note]);
  const sleep = (n) => of.run(n);
  const F = () => of.flight('report');
  const D = () => of.flight('report').dock;
  const V = () => of.flight('vessels');
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const n3 = (a) => { const l = len3(a) || 1; return mul(a, 1 / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];

  // ==========================================================================
  // SECTION 0. THE FIXTURE: A ROCKET WITH A PORT ON THE NOSE, IN ORBIT.
  // ==========================================================================
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);

  // Pod first, then the DOCKING PORT ON ITS TOP NODE, then the tank and engine
  // below. The order matters: the stack builds DOWNWARD from the lowest part,
  // so the port has to go on before there is anything under the pod to confuse
  // "lowest" with "nose".
  const takePlace = async (pid, wantKind) => {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) return false;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); return true; }
    let pick = parts[0];
    for (const p of parts) {
      if (wantKind === 'top' ? p.origin[1] > pick.origin[1]
                             : p.origin[1] < pick.origin[1]) pick = p;
    }
    const kinds = wantKind === 'top' ? ['top'] : ['bottom', 'interstage'];
    const nodes = of.vab('nodes').filter((n) => n.parent === pick.handle
      && n.onScreen && kinds.includes(n.kind));
    if (nodes.length === 0) return false;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
    return true;
  };
  await takePlace(0x0100, 'bottom');            // Pod
  const portPlaced = await takePlace(0x0115, 'top');   // Docking Port, on top
  await takePlace(0x0101, 'bottom');            // Tank
  await takePlace(0x0103, 'bottom');            // Engine
  rec('vab parts after build', of.vab('report').parts.map((p) => p.partId));
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && F().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  document.querySelector('#of-pause button[data-cheat="fuel"]')?.click();
  await sleep(0.5);
  of.pause(false);
  await sleep(1.2);

  check('fixture: aboard and in orbit',
        F().flight.status === 'ORBIT' && F().aboard === true,
        `status ${F().flight.status} aboard ${F().aboard}`);
  // ANTECEDENT 2. Without the port every "the control refused" check below is
  // true for the wrong reason.
  check('fixture: the rocket carries a docking port', D().hasPort === true,
        `hasPort ${D().hasPort} placed ${portPlaced} `
        + `parts ${JSON.stringify(F().flight.parts ?? [])}`);
  // ANTECEDENT 1.
  check('fixture: there is a station to dock with', D().hasTarget === true,
        `hasTarget ${D().hasTarget} target "${D().targetName}"`);
  if (D().hasTarget !== true || D().hasPort !== true) {
    return { valid: false, why: 'fixture incomplete', fails, rows, dock: D() };
  }
  rec('dock target', D().targetName);
  rec('/core limits [radius m, cone deg, closing m/s]',
      [D().captureRadiusM, D().coneLimitDeg, D().maxClosingMS],
      'read off the PART through docking::Limits, never typed on this side');
  check('the limits are /core\'s own shipped numbers, not zeros',
        Math.abs(D().captureRadiusM - 0.60) < 1e-9
        && Math.abs(D().coneLimitDeg - 30) < 1e-6
        && Math.abs(D().maxClosingMS - 2.0) < 1e-9,
        `${D().captureRadiusM} / ${D().coneLimitDeg} / ${D().maxClosingMS}`);

  const station = V().list.find((v) => v.status === 'station:anchorage') ?? null;
  check('fixture: Anchorage is a registry record', station !== null);
  if (station === null) return { valid: false, why: 'no station', fails, rows };

  // ==========================================================================
  // SECTION 1. THE NEGATIVE CONTROL: OUT OF RANGE REFUSES, AND SAYS SO.
  // ==========================================================================
  const far = D();
  rec('SECTION 1  separation at the fixture orbit (m)', far.separationM);
  check('a control 100 km from the port is NOT offered',
        far.available === false, `available ${far.available}`);
  check('and it names RANGE rather than going dark',
        far.why === 'out of range', `why "${far.why}"`);
  check('and the separation it reports is a real distance',
        far.separationM > 1000,
        `${far.separationM} m -- a small number here means the target pose is `
        + 'stale or zero, which is the failure PH-357 found one layer up');

  const refusals0 = F().refusals;
  const pressFar = of.flight('dock');
  rec('SECTION 1  press at 100 km -> ok', pressFar.ok);
  check('pressing it refuses', pressFar.ok === false);
  check('and the refusal is COUNTED, so it is visible from outside',
        pressFar.report.refusals === refusals0 + 1,
        `${refusals0} -> ${pressFar.report.refusals}`);
  check('and the message says which gate is shut',
        typeof pressFar.report.message === 'string'
        && pressFar.report.message.includes('out of range'),
        `"${pressFar.report.message}"`);
  check('and nothing latched', pressFar.report.dock.docked === false);

  // ==========================================================================
  // SECTION 2. AT THE PORT BUT TOO FAST.
  //
  // THE PLACEMENT READS THE GAME'S OWN PORT POSE. `dockTarget` is the object
  // the capture test is armed with, so this cannot be a second opinion about
  // where the port is.
  // ==========================================================================
  const port = () => of.flight('dockTarget');
  const p0 = port();
  check('the client publishes a live port pose', Array.isArray(p0?.posM),
        JSON.stringify(p0));
  if (!Array.isArray(p0?.posM)) {
    return { valid: false, why: 'no dockTarget pose', fails, rows };
  }
  rec('station port pos (body frame)', p0.posM.map((v) => Math.round(v)));
  rec('station port face', p0.faceAxis.map((v) => +v.toFixed(4)));
  rec('station port speed (m/s)', +len3(p0.velMS).toFixed(3));

  // WHERE THE VESSEL GOES, AND WHY THE PROBE MEASURES THE OFFSET RATHER THAN
  // KNOWING IT.
  //
  // The vessel's own port sits some distance up its nose, and that distance is
  // a fact about the stack the VAB happened to build (`FlightSession.rollOut`
  // puts the origin at the TOP of the stack, so it is small, but "small" is not
  // a number). Hardcoding it here would be this probe's own opinion about the
  // vessel's geometry, and the first draft of this file did exactly that: it
  // guessed 1.5 m, the game reported a 1.5005 m separation, and every capture
  // check failed on an arithmetic error that had nothing to do with docking.
  //
  // So `mate` PLACES, READS THE GAME'S OWN `separationM`, AND CORRECTS BY IT.
  // The correction is a closed loop on the number under test, which is legal
  // precisely because the assertions afterwards are about the VERDICT and not
  // about the separation: if the game's separation were wrong, the corrected
  // placement would land somewhere it refuses and the capture check would fail.
  let portUpM = 0.30;   // the seed; the first `mate` replaces it with the truth
  const place = (gapM, alongVel) => {
    const t = port();
    const face = n3(t.faceAxis);
    // The nose points BACK at the station's port (-face), so the vessel's own
    // port is along +face from its origin and the origin sits
    // (portUpM + gap) along +face from the station's mating plane.
    const pos = add(t.posM, mul(face, portUpM + gapM));
    const fwd = mul(face, -1);
    // Any right axis perpendicular to fwd; the cone test has no opinion on roll.
    let right = cross(fwd, [0, 1, 0]);
    if (len3(right) < 1e-6) right = cross(fwd, [1, 0, 0]);
    of.flight('place', { pos, vel: add(t.velMS, mul(face, -alongVel)),
                         fwd, right: n3(right) });
  };
  const mate = async (gapM, alongVel) => {
    place(gapM, 0);            // still, so the read is not chasing a moving hull
    await sleep(0.05);
    const measured = D().separationM;
    // measured = (portUpM + gap) - trueOffset  ->  trueOffset = portUpM + gap - measured
    portUpM = portUpM + gapM - measured;
    place(gapM, alongVel);
    await sleep(0.05);
  };

  await mate(0.30, 12.0);
  rec('SECTION 2  measured vessel port offset up the nose (m)', +portUpM.toFixed(4),
      'read off the game rather than assumed; the first draft guessed 1.5 m');
  const fast = D();
  rec('SECTION 2  [separation m, closing m/s, verdict]',
      [+fast.separationM.toFixed(3), +fast.closingMS.toFixed(2), fast.why]);
  check('inside the envelope at 12 m/s the control is NOT offered',
        fast.available === false, `available ${fast.available}`);
  check('and it says TOO FAST rather than out of range, which is the one '
        + 'sentence the bridge\'s own reasonOf bug used to get wrong',
        fast.why === 'closing too fast', `why "${fast.why}"`);
  check('and the separation confirms it really is inside the radius',
        fast.separationM <= fast.captureRadiusM + 1e-6,
        `${fast.separationM} vs ${fast.captureRadiusM}`);
  const pressFast = of.flight('dock');
  check('pressing it at 12 m/s refuses', pressFast.ok === false);
  check('and the refusal names the speed',
        String(pressFast.report.message).includes('too fast'),
        `"${pressFast.report.message}"`);

  // ==========================================================================
  // SECTION 3. AT THE PORT, DEAD SLOW, POINTING THE WRONG WAY.
  // ==========================================================================
  {
    const t = port();
    const face = n3(t.faceAxis);
    const pos = add(t.posM, mul(face, portUpM));
    // Nose along +face: pointing AWAY from the station's port, 180 degrees out.
    let right = cross(face, [0, 1, 0]);
    if (len3(right) < 1e-6) right = cross(face, [1, 0, 0]);
    of.flight('place', { pos, vel: t.velMS, fwd: face, right: n3(right) });
  }
  await sleep(0.25);
  const wrongWay = D();
  rec('SECTION 3  [cone error deg, verdict]',
      [+wrongWay.coneErrorDeg.toFixed(2), wrongWay.why]);
  check('a port pointing the wrong way is refused',
        wrongWay.available === false, `available ${wrongWay.available}`);
  check('and it is told about the POINTING, which is the one thing on a '
        + 'navball a player can see',
        wrongWay.why === 'not lined up', `why "${wrongWay.why}"`);
  check('and the cone error is the 180 degrees it actually is',
        wrongWay.coneErrorDeg > 150,
        `${wrongWay.coneErrorDeg} deg against a ${wrongWay.coneLimitDeg} limit`);

  // ==========================================================================
  // SECTION 4. THE POSITIVE CONTROL: IN THE ENVELOPE, THE CONTROL LIGHTS AND
  // THE PRESS LATCHES.
  // ==========================================================================
  await mate(0.20, 0.02);
  const ready = D();
  rec('SECTION 4  [separation m, closing m/s, cone deg, verdict]',
      [+ready.separationM.toFixed(3), +ready.closingMS.toFixed(3),
       +ready.coneErrorDeg.toFixed(2), ready.why]);
  check('in the envelope, dead slow and lined up, the control IS offered',
        ready.available === true,
        `available ${ready.available} why "${ready.why}" `
        + `sep ${ready.separationM} closing ${ready.closingMS} `
        + `cone ${ready.coneErrorDeg}`);
  check('and it says so in words rather than only in a colour',
        ready.why === 'ready to dock', `why "${ready.why}"`);

  // THE CHIP. `report()` is the client's account of itself; this is the pixels.
  // A control that is true in the report and absent on the screen is the exact
  // asymmetry FlightNav.ts's header is about.
  const chipText = () => {
    const el = document.querySelector('#of-navball .chip.dock');
    return el === null ? null : el.textContent.trim();
  };
  rec('SECTION 4  the DOM chip while ready', chipText());
  check('THE BUTTON IS ON THE SCREEN AND IT SAYS IT IS READY',
        chipText() !== null && /DOCK/i.test(chipText()),
        `chip ${JSON.stringify(chipText())}`);
  check('and the chip carries the measurement AND the limit, not just a word',
        chipText() !== null && chipText().includes('0.60'),
        `chip ${JSON.stringify(chipText())}`);

  const docks0 = F().dock.docks;
  const press = of.flight('dock');
  await sleep(0.4);
  const latched = F().dock;
  rec('SECTION 4  press -> ok', press.ok);
  rec('SECTION 4  after the press', [latched.docked, latched.why,
                                     latched.docks, latched.hostId]);
  check('THE PRESS LATCHES', press.ok === true,
        `message "${press.report.message}"`);
  check('and the client says it is docked', latched.docked === true);
  check('and the counter moved, so the latch is not a redraw',
        latched.docks === docks0 + 1, `${docks0} -> ${latched.docks}`);
  check('and it is latched to ANCHORAGE by id, not to "something"',
        latched.hostId === station.id,
        `hostId ${latched.hostId} vs station ${station.id}`);
  check('and it recorded WHICH port', latched.hostPort === 'socket_dock',
        `"${latched.hostPort}"`);

  // THE CENSUS AGREES, which is the "one vessel" claim measured rather than
  // asserted by the thing that made it.
  const censusRow = V().list.find((v) => v.promoted === true) ?? null;
  rec('SECTION 4  census row for the flown vessel',
      censusRow === null ? null : [censusRow.id, censusRow.docked]);
  check('the CENSUS carries the latch too, not only the flight report',
        censusRow !== null && censusRow.docked !== null
        && censusRow.docked.hostId === station.id,
        JSON.stringify(censusRow?.docked ?? null));
  check('and exactly ONE record is docked (a self-dock or a double latch '
        + 'would show up here as two)',
        V().list.filter((v) => v.docked !== null).length === 1,
        JSON.stringify(V().list.map((v) => [v.id, v.docked !== null])));
  check('and the station itself is NOT marked docked to anything',
        (V().list.find((v) => v.id === station.id)?.docked ?? null) === null);

  // THE JOIN PUT IT ON THE PORT. /core's `matedPose` decided where; this only
  // checks the answer arrived.
  const afterSep = latched.separationM;
  const originGap = latched.originToPortM;
  rec('SECTION 4  [reported separation m, origin-to-port m]',
      [afterSep, +originGap.toFixed(3)]);
  check('the reported separation is zero once latched', afterSep === 0);
  check('and the hull is still a sensible distance off the port rather than '
        + 'teleported to the station centre',
        originGap > 0.2 && originGap < 30,
        `${originGap} m -- the station\'s own port is 30.4 m off its centre, `
        + 'so a reading near 30 would mean the origin went to the hub');

  // A SECOND PRESS MUST NOT LATCH TWICE.
  const again = of.flight('dock');
  await sleep(0.3);
  rec('SECTION 4  second press (should UNDOCK, not re-latch)', again.ok);
  check('the latch key is a TOGGLE: the second press releases',
        again.ok === true && again.report.dock.docked === false,
        `ok ${again.ok} docked ${again.report.dock.docked}`);
  check('and it counted an undock rather than a second dock',
        again.report.dock.undocks === 1 && again.report.dock.docks === docks0 + 1,
        `docks ${again.report.dock.docks} undocks ${again.report.dock.undocks}`);

  // ==========================================================================
  // SECTION 5. THE RELEASE ACTUALLY GETS OUT.
  //
  // A release that left the two hulls at 0.00 m would read as a successful
  // undock and be a trap. This measures the separation growing.
  // ==========================================================================
  const sepAtRelease = D().separationM;
  await sleep(2.0);
  const sepLater = D().separationM;
  const rate = (sepLater - sepAtRelease) / 2.0;
  rec('SECTION 5  separation at release / 2 s later / rate (m, m, m/s)',
      [+sepAtRelease.toFixed(3), +sepLater.toFixed(3), +rate.toFixed(3)]);
  check('the two hulls are MOVING APART after an undock',
        sepLater > sepAtRelease, `${sepAtRelease} -> ${sepLater}`);
  check('and at a SAFE rate: fast enough to clear the 0.60 m envelope, slow '
        + 'enough that a mis-pressed undock is recoverable',
        rate > 0.05 && rate < 1.0,
        `${rate} m/s against docking::kReleaseSepMS = 0.20`);
  check('and the drift is the release push and not an orbital divergence',
        Math.abs(rate - 0.20) < 0.15, `${rate} vs 0.20`);

  // ==========================================================================
  // SECTION 6. THE SAVE CARRIES THE LATCH.
  //
  // Re-dock, write the slot, and apply it back over the live world -- which is
  // `of.load()`, the reload path. NOT a real page reload: `reload.mjs` crosses
  // seams this cannot (chestsave.js's header is the authority on the
  // difference), and a real-reload pair is the follow-up this probe names
  // rather than pretends to be.
  // ==========================================================================
  await mate(0.15, 0.02);
  const redock = of.flight('dock');
  check('SECTION 6 fixture: it re-docks after an undock', redock.ok === true,
        `"${redock.report.message}"`);
  await sleep(0.4);

  const wrote = await of.save();
  rec('SECTION 6  save summary [version, vessels, docked]',
      [wrote?.version, wrote?.vessels, wrote?.dockedVessels]);
  check('the save was written rather than refused',
        wrote !== null && wrote.refused === undefined, JSON.stringify(wrote));
  check('the SLOT carries the latch: exactly one vessel in it is docked',
        wrote?.dockedVessels === 1,
        `dockedVessels ${wrote?.dockedVessels} of ${wrote?.vessels}`);
  // SAVE_VERSION DID NOT MOVE, and that is an assertion rather than a note:
  // a bump destroys every existing world (SaveGame.ts), and an additive
  // optional field whose absence reads as "not docked" does not need one.
  check('SAVE_VERSION stayed at 5: an additive optional field must not '
        + 'destroy every existing world', wrote?.version === 5,
        `version ${wrote?.version}`);

  await of.load();
  await sleep(2.0);
  const restored = V().list.find((v) => v.docked !== null) ?? null;
  rec('SECTION 6  after of.load(), the docked record',
      restored === null ? null : [restored.id, restored.docked]);
  check('THE LATCH SURVIVES THE RESTORE PATH', restored !== null,
        JSON.stringify(V().list.map((v) => [v.id, v.name, v.docked])));
  check('and it still points at Anchorage, through the named port, with a '
        + 'local pose that is three finite numbers rather than a hole',
        restored !== null && restored.docked.hostId === station.id
        && restored.docked.hostPort === 'socket_dock'
        && Array.isArray(restored.docked.localPos)
        && restored.docked.localPos.every((v) => Number.isFinite(v)),
        JSON.stringify(restored?.docked ?? null));
  check('and no latch was orphaned, which would mean the host did not come '
        + 'back or came back with a different id',
        V().orphanLatches === 0, `orphanLatches ${V().orphanLatches}`);

  check('POSITIVE CONTROL: the run reached the end of the file', true);

  return {
    valid: true, reachedEnd: true, fails, failCount: fails.length, rows,
    summary: {
      limits: [D().captureRadiusM, D().coneLimitDeg, D().maxClosingMS],
      farSeparationM: far.separationM,
      tooFastVerdict: fast.why,
      notFacingDeg: wrongWay.coneErrorDeg,
      readyVerdict: ready.why,
      docked: press.ok,
      hostId: latched.hostId,
      releaseRateMS: rate,
      saveVersion: wrote?.version ?? null,
      dockedInSlot: wrote?.dockedVessels ?? null,
      survivedRestore: restored !== null,
    },
  };
})()
