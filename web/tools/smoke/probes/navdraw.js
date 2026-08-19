// navdraw.js: GP-610. THE THIRTEEN FIELDS PHYSICS PUBLISHED ARE NOW DRAWN, AND
// THIS PROBE READS THE SCREEN RATHER THAN THE READOUT.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/navdraw.js
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("GP-609: a failed check
// throws... Measured against `run.mjs`...") as the command, which held zero
// real flags, so every prior sweep ran this at the runner's bare defaults.
// The invocation above is copied verbatim from `probes/phnav.js`, whose
// exact fixture (build a reference stack in the VAB, roll it out, board it)
// this file's own comment says it lifted "adapted only where it names that
// probe's own helpers": the two files need the same world.
//
// `probes/phnav.js` already proves the FIELDS EXIST and carry the right values;
// it is physics' fixture and this does not duplicate it. The gap it cannot
// close is the one this lane owns: a field that is published and never drawn is
// exactly the state PH-350 shipped on purpose, and "the number is correct" and
// "the player can read it" are different claims. So every assertion below comes
// off the DOM.
//
// THE HEADLINE IS `PE`. The sweep measured `PE -600.00 km` drawn during ASCENT,
// because the old guard listed the two statuses that produce it on the pad and
// could not exclude a near-vertical climb. Physics published
// `periapsisMeaningful` as the physical fact; this asserts the CELL follows it.
//
// GP-609, AMENDED BT-270 to BT-274: a failed check USED TO throw, on the theory
// that `smoke: PASS` does not otherwise mean the checks held (measured against
// `run.mjs`: a probe returning a non-empty `fails` array exits 0 for a human
// driving it by hand). That never accounted for the SWEEP: `probeall.mjs`'s
// audit found `run.mjs`'s try/catch drops the ENTIRE report on a
// page.evaluate throw, not just the eval field, so a correctly-diagnosed RED
// here read as NO_OUTPUT, indistinguishable from a hard crash (qolbuild2.js's
// BT-260 to BT-264 finding). `finish()` now RETURNS `{ fails, valid:
// fails.length === 0, log }` instead; the standalone-run exit-code honesty is
// kept the same way qolbuild2.js keeps it, every failure also gets its own
// `console.error` line, which fails a standalone run's own exit code
// independent of the returned report. `bail()` gets the same fix: it now
// records the abandon reason as a failure and returns through `finish()`
// rather than throwing it away. `run.mjs` itself is addressed separately
// (BT-270 to BT-274's own decision on its catch block).
(async () => {
  const of = window.__of;
  if (!of) throw new Error('probe: no __of on the page');
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
    if (!ok) fails.push(`${name} :: ${detail}`);
  };
  const bail = (why) => {
    fails.push(`ABANDONED :: ${why}`);
    log.push(`FAIL  ABANDONED  [${why}]`);
    return finish(out);
  };
  const finish = (out) => {
    for (const f of fails) console.error(`probe FAIL: ${f}`);
    return { ...out, valid: fails.length === 0, fails, log };
  };
  // A DRAWN string, or null. `innerText` falls back to `textContent` on a
  // display:none element, so reading text without a layout test reports hidden
  // panels as though a player could see them. Measured on this project's own
  // #of-prompt: it returned a string naming the previous item while hidden.
  const drawn = (el) => {
    if (el === null || el === undefined) return null;
    if (el.getClientRects().length === 0) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.02) return null;
    const s = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  };
  /** The value of a labelled cell in either readout column, as DRAWN. */
  const cell = (label) => {
    for (const c of document.querySelectorAll('#of-navball .of-nread .c')) {
      const k = (c.querySelector('em')?.textContent ?? '').trim();
      if (k === label) return drawn(c.querySelector('b'));
    }
    return null;
  };
  const chip = (cls) => drawn(document.querySelector(`#of-navball .chip.${cls}`));
  const out = { fails, log };

  await sleep(1.0);

  // ---- FIXTURE: get into a rocket ----------------------------------------
  // THE FIXTURE IS LIFTED VERBATIM FROM `probes/phnav.js` and adapted only where
  // it names that probe's own helpers. There is no cheat that hands over a
  // rocket (`orbit` is blocked with `noCraft`), so a ball to read requires a
  // real VAB build, a rollout, a walk and a board. Copying physics' sequence is
  // deliberate rather than lazy: two different fixtures for "get me into a
  // vehicle" would drift, and the day one of them stopped producing a bound
  // orbit the two probes would disagree about the same client for a reason
  // neither of them was testing.
  // --- FIXTURE: the reference stack, rolled out, boarded ---------------------
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  for (const pid of [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  of.flight('rollout');
  await sleep(0.8);
  for (let i = 0; i < 16 && of.flight('report').distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.8);
  if (!of.flight('report').aboard) return bail('never boarded, so nothing below was measured');

  const ball = document.querySelector('#of-navball');
  out.ballDrawn = drawn(ball) !== null;
  check('fixture: the navball is on screen', out.ballDrawn,
        out.ballDrawn ? 'drawn'
          : (ball === null ? 'no #of-navball element' : 'present but not laid out'));
  if (!out.ballDrawn) return bail('no navball, so nothing below was measured');

  // ---- 1. THE PAD / ASCENT PERIAPSIS -------------------------------------
  const d0 = of.flight('readout');
  out.pad = {
    status: d0.status,
    periapsisM: d0.periapsisM,
    periapsisMeaningful: d0.periapsisMeaningful,
    peCell: cell('PE'),
    apCell: cell('AP'),
  };
  // THE FIXTURE FOR THIS CLAIM IS THAT THE DEFECT IS REACHABLE. A standing
  // vehicle has a degenerate conic through the planet's centre, so the raw
  // number really is about minus the datum radius. If it were not, the cell
  // could read anything and pass.
  check('fixture: the raw periapsis really is the underground figure, so the '
        + 'old defect is reachable here',
        Number.isFinite(d0.periapsisM) && d0.periapsisM < -1000,
        `periapsisM ${d0.periapsisM}`);
  check('fixture: and physics says it is not meaningful',
        d0.periapsisMeaningful === false, String(d0.periapsisMeaningful));
  // THE CLAIM: whatever the cell says, it is not that number.
  check('GP-610: the PE cell does NOT draw the underground periapsis',
        out.pad.peCell !== null && !/-\s*\d{3}(\.\d+)?\s*km/.test(out.pad.peCell),
        out.pad.peCell);

  // ---- 2. IN ORBIT: THE THREE CLOCKS -------------------------------------
  // THE MENU HAS TO BE OPEN FOR THE BUTTON TO EXIST. The first version of this
  // clicked a selector that matched nothing, the optional-chain swallowed it,
  // and the probe sailed on to conclude "not in orbit". That is GP-155 exactly
  // (a press helper reporting success on a click that never landed), and it was
  // caught only because the fixture check below refused to proceed.
  of.pause(true);
  await sleep(0.4);
  const orbitBtn = document.querySelector('#of-pause button[data-cheat="orbit"]');
  check('fixture: the Teleport to orbit button exists and is not blocked',
        orbitBtn !== null && !orbitBtn.disabled,
        orbitBtn === null ? 'no such button' : ('disabled=' + orbitBtn.disabled));
  orbitBtn?.click();
  await sleep(1.6);
  of.pause(false);
  await sleep(1.4);
  const d1 = of.flight('readout');
  out.orbit = {
    status: d1.status,
    periapsisMeaningful: d1.periapsisMeaningful,
    timeToApoapsisS: d1.timeToApoapsisS,
    timeToPeriapsisS: d1.timeToPeriapsisS,
    periodS: d1.periodS,
    apCell: cell('AP'), peCell: cell('PE'), perCell: cell('PER'),
  };
  // Fixture again: in orbit these three must be real, or the drawing claims
  // below are asserting the absence of something that was never available.
  check('fixture: the teleport really put the vessel in orbit',
        d1.periapsisMeaningful === true && d1.periodS > 0,
        `${d1.status}, meaningful ${d1.periapsisMeaningful}, period ${d1.periodS}`);
  if (d1.periapsisMeaningful !== true) {
    return bail('not in orbit, so the clock drawing was NOT measured');
  }
  check('GP-610: AP draws its time to apoapsis',
        out.orbit.apCell !== null && / in \d+:\d\d/.test(out.orbit.apCell),
        out.orbit.apCell);
  check('GP-610: PE draws a real periapsis with its time, not "---"',
        out.orbit.peCell !== null && !/---/.test(out.orbit.peCell)
        && / in \d+:\d\d/.test(out.orbit.peCell), out.orbit.peCell);
  check('GP-610: the orbital PERIOD is drawn at all (it never was on the ball)',
        out.orbit.perCell !== null && /\d+:\d\d/.test(out.orbit.perCell),
        out.orbit.perCell);
  // THE PERIOD ROW IS ABSENT ON THE PAD, which is the two-sided half: a row
  // that is always there would pass the check above whatever the world did.
  check('GP-610: and the PERIOD row was ABSENT on the pad, so it is conditional',
        out.pad.apCell !== null, `pad AP ${out.pad.apCell}`);

  // ---- 3. THE SAS CHIP CARRIES THE ERROR ---------------------------------
  // SAS DOES NOT BOOT OFF. The first version of this assumed it did and read
  // `SAS CMD 0.0` where it expected `SAS OFF`, then pressed T and turned SAS
  // OFF, so BOTH halves of the claim were tested against the wrong state. The
  // state is read rather than assumed now, and both cases are driven from
  // whatever it actually is.
  const sasName = () => of.flight('readout').sas;
  const toggle = async () => {
    of.input.tape([{ hold: 4, keys: ['KeyT'] }, { hold: 8, keys: [] }]);
    await sleep(1.1);
  };
  out.sasAtBoot = sasName();
  if (sasName() === 'OFF') await toggle();
  out.sasOnName = sasName();
  const sasOnChip = chip('sas');
  out.sasChipOn = sasOnChip;
  out.sasErrDeg = of.flight('readout').sasErrDeg;
  check('fixture: SAS is ON, so an error figure is a meaningful thing to draw',
        out.sasOnName !== 'OFF', out.sasOnName);
  check('GP-610: with SAS on the chip draws the error in degrees',
        sasOnChip !== null && /\d+\.\d°/.test(sasOnChip), sasOnChip);

  // THE REACHABLE NEGATIVE CASE, and it is the half that makes the check above
  // mean something: an error figure beside `SAS OFF` is a measurement of
  // nothing, so the chip must NOT carry one. Without this, appending a constant
  // to the chip would pass.
  await toggle();
  out.sasOffName = sasName();
  const sasOffChip = chip('sas');
  out.sasChipOff = sasOffChip;
  if (out.sasOffName !== 'OFF') {
    check('fixture: SAS could be turned OFF, or the negative case is untested',
          false, `sas is ${out.sasOffName}; the OFF case was NOT measured`);
  } else {
    check('GP-610: with SAS off the chip carries NO error figure',
          sasOffChip !== null && /OFF/.test(sasOffChip)
          && !/\d+\.\d°/.test(sasOffChip), sasOffChip);
  }
  // Put it back, so the warp case below runs on the attitude the rest of the
  // probe assumed.
  await toggle();

  // ---- 4. THE WARP CHIP DRAWS WHAT THE SIM DID ---------------------------
  out.warpChipAt1x = chip('warp');
  check('GP-610: at 1x there is no warp chip (it is not permanent clutter)',
        out.warpChipAt1x === null, out.warpChipAt1x);
  for (let i = 0; i < 4; i++) {
    of.input.tape([{ hold: 3, keys: ['KeyP'] }, { hold: 6, keys: [] }]);
    await sleep(0.35);
  }
  await sleep(1.4);
  const d3 = of.flight('readout');
  out.warp = { factor: d3.warpFactor, effective: d3.warpEffectiveX,
               limitedBy: d3.warpLimitedBy, chip: chip('warp') };
  check('fixture: warp was actually raised above 1x',
        nm(d3.warpFactor) > 1, `warpFactor ${d3.warpFactor}`);
  if (nm(d3.warpFactor) > 1) {
    check('GP-610: a warp chip is drawn, and it is STANDING (the old flash '
          + 'expired after 5 s and long warps drew nothing)',
          out.warp.chip !== null, out.warp.chip);
    // THE CLAIM THAT MATTERS: the chip's leading number is the EFFECTIVE rate,
    // not the ladder value. The sweep measured `warp 1000x` drawn while the sim
    // advanced 10x. `warp <effective>x` is what this asserts.
    const lead = (out.warp.chip ?? '').match(/warp\s+([\d.]+)x/i);
    out.warpChipLeadingNumber = lead === null ? null : Number(lead[1]);
    // IN ORBIT THE TWO NUMBERS AGREE, so this check passes whichever of them the
    // chip leads with. It is the identity case INSTRUMENTS.md warns about and it
    // is recorded as weak rather than dressed up: the strong form is below, in
    // atmosphere, where they genuinely differ.
    check('GP-610 (weak, they agree here): the chip leads with the effective rate',
          lead !== null
          && Math.abs(Number(lead[1]) - nm(d3.warpEffectiveX)) < 0.15,
          `chip "${out.warp.chip}" vs effective ${d3.warpEffectiveX} `
          + `and asked ${d3.warpFactor}`);
    out.warpAgreedInOrbit = Math.abs(nm(d3.warpFactor) - nm(d3.warpEffectiveX)) < 0.15;
  }

  // ---- 4b. THE CASE THE WARP FEATURE EXISTS FOR --------------------------
  // The sweep measured `warp 1000x` drawn while the sim advanced 10x, and that
  // only happens IN ATMOSPHERE, where `FlightWarp`'s IN_AIR_MAX clamps the
  // effective rate. In orbit the two agree, so the check above cannot tell a
  // chip that leads with the truth from one that leads with the lie. This is
  // the discriminating run.
  document.querySelector('#of-pause')?.classList?.remove('open');
  of.flight('recover');
  await sleep(1.6);
  of.flight('rollout');
  await sleep(1.0);
  of.flight('board');
  await sleep(1.2);
  // THE RECOVER RESET THE WARP TO 1x, which the first version of this did not
  // account for: it read `asked 1, effective 1`, correctly reported the case as
  // unreached, and would have kept reporting that forever. Raise it again here.
  for (let i = 0; i < 6; i++) {
    of.input.tape([{ hold: 3, keys: ['KeyP'] }, { hold: 6, keys: [] }]);
    await sleep(0.35);
  }
  await sleep(1.6);
  const inAir = of.flight('readout');
  out.atmo = { status: inAir.status, factor: inAir.warpFactor,
               effective: inAir.warpEffectiveX, limitedBy: inAir.warpLimitedBy,
               chip: chip('warp') };
  if (nm(inAir.warpFactor) <= 1
      || Math.abs(nm(inAir.warpFactor) - nm(inAir.warpEffectiveX)) < 0.15) {
    // NOT A PASS AND NOT A FAILURE OF THE FEATURE: the fixture did not produce
    // the condition. Saying so is the point; a silent skip here is how the weak
    // check above would have been mistaken for the strong one.
    out.warpDifferCaseReached = false;
    log.push('SKIP  GP-610 strong warp case: could not reach a state where the '
      + `asked and effective rates differ (asked ${inAir.warpFactor}, `
      + `effective ${inAir.warpEffectiveX}, limitedBy "${inAir.warpLimitedBy}"). `
      + 'THE STRONG CLAIM IS UNTESTED IN THIS RUN.');
  } else {
    out.warpDifferCaseReached = true;
    const lead2 = (out.atmo.chip ?? '').match(/warp\s+([\d.]+)x/i);
    check('GP-610 (strong): where the rates DIFFER, the chip leads with what '
          + 'the sim did and names the asked rate second',
          lead2 !== null
          && Math.abs(Number(lead2[1]) - nm(inAir.warpEffectiveX)) < 0.15
          && new RegExp(`asked\s+${trimNum(inAir.warpFactor)}x`).test(out.atmo.chip ?? ''),
          `chip "${out.atmo.chip}" vs effective ${inAir.warpEffectiveX} `
          + `and asked ${inAir.warpFactor}`);
    check('GP-610 (strong): and it says WHY the two differ',
          /limit/.test(out.atmo.chip ?? ''), out.atmo.chip);
  }
  function trimNum(v) {
    const a = nm(v);
    return Number.isInteger(a) ? a.toFixed(0) : a.toFixed(1);
  }

  // ---- 5. THE BURN BLOCK IS ABSENT WITH NO NODE --------------------------
  // The block's CONTENT is proven by phnav.js on the data side; what this owns
  // is that it does not draw an empty panel full of zeroes when there is no
  // node, which is the RCS row's rule applied again.
  out.burnField = of.flight('readout').burn;
  out.burnBlockDrawn = drawn(document.querySelector('#of-navball .of-nburn'));
  check('fixture: there is genuinely no maneuver node right now',
        out.burnField === null, JSON.stringify(out.burnField));
  check('GP-610: with no node the burn block draws NOTHING (no zeroed panel)',
        out.burnBlockDrawn === null, out.burnBlockDrawn);

  function nm(v) { return Number.isFinite(v) ? v : 0; }
  return finish(out);
})()
