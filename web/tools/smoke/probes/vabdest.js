// vabdest.js: GP-266. THE BAY'S DESTINATION PICKER, DRIVEN.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=20 \
//        --evalfile=tools/smoke/probes/vabdest.js
//
// Reid's first autopilot ask, in the bay: pick a remote target and be told
// whether this rocket can get there. This probe drives that screen with real
// PointerEvents and asserts four separate things, three of which a report-only
// probe could not have seen.
//
// WHAT MAKES IT MEAN ANYTHING.
//
// (a) EVERY PRESS RETURNS A RECEIPT, NOT A BOOLEAN THAT AN ELEMENT EXISTED.
//     `press` reads the selection back OFF THE DOM after the click and hands it
//     to the caller, so a button that is present and inert fails here. That is
//     GP-155's finding: a press helper that could not fail is worth nothing.
//
// (b) THE SEAM IS ASSERTED ON BOTH SIDES, AND WHICH SIDE RAN IS MEASURED.
//     The mission cost is the physics lane's `of_ap_design_reach`, which landed
//     mid-session (PH-147 to PH-149). Before it, the screen had to say
//     `REACH PENDING` and name the export; after it, the screen must give a
//     decided verdict and must NEVER still say pending. `solverPresent` is read
//     off the model and PUBLISHED in the result, so a green run cannot hide
//     that it took the trivial branch: an implication whose antecedent is never
//     asserted proves nothing.
//
// (c) THE VEHICLE FIGURE IS ASSERTED EQUAL TO /core's OWN, in the same frame.
//     The whole point of R43 is that there is ONE delta-v authority. If this
//     screen ever grows its own arithmetic, `drawnDv === statsDv` breaks.
//
// (d) THE TYPING RULE IS ASSERTED AS A NEGATIVE. GP-136: a panel that
//     re-rendered mid-keystroke wiped the box the player was typing in. Here
//     the alt box is typed into and then a render is FORCED by placing a part;
//     the box must still hold what was typed. A probe that only typed and read
//     back immediately would pass a build with that defect.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const opts = { bubbles: true, cancelable: true, pointerId: 1,
                 pointerType: 'mouse', isPrimary: true, button: 0 };

  // A PRESS RETURNS WHAT MOVED. Not "the element was there": the selection as
  // the SCREEN reports it afterwards, so an inert button fails at the call site.
  const press = async (destId) => {
    const sel = `#of-vab [data-dest="${destId}"]`;
    const el = document.querySelector(sel);
    if (el === null) return { landed: false, why: `no row ${destId}`, sel: '' };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    const again = document.querySelector(sel);
    if (again === null) return { landed: false, why: 'row vanished', sel: '' };
    again.dispatchEvent(new PointerEvent('pointerup', opts));
    again.click();
    await sleep(0.2);
    return { landed: true, why: '', sel: of.vab('dest').drawn.selectedRowId };
  };

  const type = async (box, text) => {
    box.focus();
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(0.2);
  };

  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);

  // BOTH MODES. In sandbox a rocket is assembled so the vehicle figure is a
  // real number; in survival an empty pack cannot pay for one, and the point of
  // running there is the OPPOSITE assertion, that the list and the gate still
  // draw with nothing on the pad. A probe that only ever ran in sandbox is the
  // trap this brief named: a gated screen looks perfect in every probe and is
  // dead in Reid's world.
  //
  // THE MODE IS READ OFF THE BAY'S OWN `modeRules`, and a mode this probe
  // cannot name is a REFUSAL rather than a default. The first draft wrote
  // `of.sandbox() === true`; `__of.sandbox()` returns an OBJECT, so that
  // expression was false in both modes and the sandbox run quietly took the
  // survival branch and passed. An assertion that passes for a reason nobody
  // reads is worth no more than one that fails for one (GP-133).
  const modeName = of.vab('report').mode;
  if (modeName !== 'sandbox' && modeName !== 'survival') {
    return { valid: false, why: `cannot tell which mode this is: ${modeName}` };
  }
  const sandbox = modeName === 'sandbox';
  // A REAL ROCKET, so the vehicle figure on the screen is a real number and not
  // the zero an empty bay would make every comparison below pass against.
  const PID = { Pod: 0x0100, TankS: 0x0101, TankSLong: 0x0102,
                EngineS: 0x0103, EngineV: 0x0104, DecouplerS: 0x0106 };
  const cat0 = of.vab('catalogue');
  const idxOf = (id) => { const r = cat0.find((c) => c.id === id); return r ? r.index : -1; };
  of.vab('press', 'clear');
  await sleep(0.2);
  for (const pid of (sandbox ? [PID.Pod, PID.TankS, PID.EngineV, PID.DecouplerS,
                                PID.TankSLong, PID.EngineS] : [])) {
    const i = idxOf(pid);
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
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
  of.vab('drop');
  await sleep(0.2);
  const built = of.vab('report');
  if (sandbox) {
    check('a rocket was assembled', built.parts.length >= 5,
          `${built.parts.length} parts`);
    check('the rocket has delta-v', built.stats.totalDeltaV > 100,
          `totalDeltaV ${built.stats.totalDeltaV}`);
  } else {
    // SURVIVAL, and this is the assertion that matters here: an empty pad is a
    // legitimate state and the destination screen must still be a screen.
    check('survival: nothing was built (an empty pack cannot pay)',
          built.parts.length === 0, `${built.parts.length} parts`);
    check('survival: the vehicle figure is honestly zero',
          built.stats.totalDeltaV === 0, `totalDeltaV ${built.stats.totalDeltaV}`);
  }

  const d0 = of.vab('dest');
  check('the bay is open', of.vab('report').open === true);
  check('the destination block is on screen', d0.drawn.rowIds.length > 0,
        `rowIds ${JSON.stringify(d0.drawn.rowIds)}`);

  // --- 1. THE PART, AND THE THREE STATES OF THE MODULE GATE ----------------
  //
  // GP-267 landed the catalogue row, so `partMissingFromCatalogue` is now FALSE
  // and this block asserts the opposite of what it asserted last night. That is
  // the fixture doing its job: it was written to go red the day the row landed.
  //
  // The three states are NOT interchangeable and the probe drives all three:
  //   not in the catalogue  -> a broken build, and nobody's fault
  //   locked by a tech      -> survival, before Flight Autopilot
  //   not fitted            -> sandbox, or survival after the unlock
  const gate = d0.model;
  const apRow = cat0.find((c) => c.id === 0x010d);
  check('the Autopilot Module is in the catalogue', apRow !== undefined,
        `catalogue has ${cat0.length} parts`);
  check('gate: the catalogue-missing state is behind us',
        gate.partMissingFromCatalogue === false,
        `partMissingFromCatalogue ${gate.partMissingFromCatalogue}`);
  check('gate: no module counted on a bare rocket', gate.moduleCount === 0,
        `count ${gate.moduleCount}`);
  // THE ITEM ID THE RESEARCH GATE HANGS ON, asserted against the catalogue's
  // own row rather than against the constant that produced it. `research.h`
  // carries a hand-written copy of `0x0050 + (PartId - 0x0100)` and the wasm
  // carries a static_assert pinning the two; this is the client leg of the same
  // invariant. Wrong here and the gate would test an item nobody can hold,
  // which reads on screen as "not researched" for ever.
  check('the part item id is 0x005d, off /core\'s own catalogue row',
        apRow !== undefined && apRow.itemId === 0x005d,
        apRow === undefined ? 'no row' : `itemId 0x${apRow.itemId.toString(16)}`);

  if (sandbox) {
    check('sandbox: the gate says FIT ONE, not RESEARCH ONE',
          gate.lockedByTech === '' && /fit one/i.test(gate.moduleReason),
          `lockedByTech "${gate.lockedByTech}" reason "${gate.moduleReason}"`);
    check('sandbox: the part is offered', of.vab('report').offeredIds.includes(0x010d),
          JSON.stringify(of.vab('report').offeredIds));
  } else {
    // THE BRANCH NO SANDBOX PROBE CAN REACH. `GameMode.researchGated` is
    // `!sandbox`, so a feature gated behind a tech looks perfect in every
    // sandbox run and is locked in Reid's actual world. This is that case.
    check('survival: the gate says the tech, by name',
          gate.lockedByTech !== '', `lockedByTech "${gate.lockedByTech}"`);
    check('survival: the tech named is Flight Autopilot',
          /autopilot/i.test(gate.lockedByTech), gate.lockedByTech);
    check('survival: the reason is DRAWN and says researched',
          /researched/i.test(d0.drawn.gate), d0.drawn.gate);
    check('survival: the part is WITHHELD from the catalogue',
          !of.vab('report').offeredIds.includes(0x010d),
          JSON.stringify(of.vab('report').offeredIds));
    check('survival: exactly 13 parts offered before the unlock',
          of.vab('report').offered === 13, `${of.vab('report').offered}`);
  }

  // --- 2. THE LIST: three kinds, one row type ------------------------------
  const ids = d0.drawn.rowIds;
  const vesselRows = ids.filter((i) => i.startsWith('v:'));
  const bodyRows = ids.filter((i) => i.startsWith('b:'));
  check('the list has at least one vessel row', vesselRows.length >= 1,
        `rows ${JSON.stringify(ids)}`);
  check('the list has the body row', bodyRows.includes('b:cinder'),
        `rows ${JSON.stringify(ids)}`);
  check('the list has the requested-orbit row', ids.includes('orbit'),
        `rows ${JSON.stringify(ids)}`);
  // The DRAWN blocked set must equal the MODEL's. Two readings of one rule.
  check('drawn blocked set == model blocked set',
        JSON.stringify(d0.drawn.blockedRowIds) === JSON.stringify(d0.model.blockedIds),
        `drawn ${JSON.stringify(d0.drawn.blockedRowIds)} vs `
        + `model ${JSON.stringify(d0.model.blockedIds)}`);
  check('the body row is drawn blocked', d0.drawn.blockedRowIds.includes('b:cinder'),
        JSON.stringify(d0.drawn.blockedRowIds));

  // --- 3. SELECTION, WITH A RECEIPT ----------------------------------------
  const station = vesselRows[0];
  const p1 = await press(station);
  check('pressing a vessel row LANDED', p1.landed, p1.why);
  check('pressing a vessel row selected it', p1.sel === station,
        `drawn selection ${p1.sel}, expected ${station}`);
  check('the model agrees with the screen',
        of.vab('dest').model.selectedId === station,
        `model ${of.vab('dest').model.selectedId}`);
  const p2 = await press(station);
  check('pressing it again deselected', p2.sel === '', `drawn selection ${p2.sel}`);

  // --- 4. THE BLOCKED ROW SAYS WHY, AND REFUSES ----------------------------
  await press('b:cinder');
  const dCinder = of.vab('dest');
  check('a blocked row still selects (so it can explain itself)',
        dCinder.drawn.selectedRowId === 'b:cinder', dCinder.drawn.selectedRowId);
  check('the blocked verdict is CANNOT PLAN',
        dCinder.drawn.verdict.includes('CANNOT PLAN'), dCinder.drawn.verdict);
  check('the blocked reason names the hand-off',
        /hand-off/.test(dCinder.drawn.reachText), dCinder.drawn.reachText);
  check('a blocked row never claims a margin',
        !/CAN REACH/.test(dCinder.drawn.verdict), dCinder.drawn.verdict);

  // --- 5. THE SEAM: BOTH BRANCHES, AND WHICH ONE RAN IS MEASURED -----------
  //
  // The physics lane's four `of_ap_*` exports landed mid-session (PH-147 to
  // PH-149), so this probe has to be true on either side of that bridge. It is
  // NOT written as "pending or fine either way": the antecedent is MEASURED
  // (`solverPresent`, off the model's own `waitingOn`), it is PUBLISHED in the
  // result, and each branch carries real assertions. An implication whose
  // antecedent is never asserted proves nothing, and a probe that could
  // silently take the trivial branch is the same defect wearing a hat.
  await press('orbit');
  const dOrbit = of.vab('dest');
  check('the orbit row selected', dOrbit.drawn.selectedRowId === 'orbit',
        dOrbit.drawn.selectedRowId);
  check('the two orbit boxes appear with it', dOrbit.drawn.orbitBoxesShown === true);
  const solverPresent = String(dOrbit.model.waitingOn) === '';
  if (!solverPresent) {
    check('no solver: the verdict is REACH PENDING',
          dOrbit.drawn.verdict.includes('REACH PENDING'), dOrbit.drawn.verdict);
    check('no solver: the sentence names the export it waits for',
          dOrbit.drawn.reachText.includes('of_ap_design_reach'),
          dOrbit.drawn.reachText);
    check('no solver: and NO confident verdict is shown',
          !/CAN REACH/.test(dOrbit.drawn.verdict), dOrbit.drawn.verdict);
  } else {
    // THE SOLVER IS ON THE BRIDGE. The verdict must now be one of the two real
    // ones, must never still say PENDING, and the margin must be exactly
    // available minus required: that identity is what catches a screen that
    // started doing its own arithmetic, which is the whole thing this feature
    // is forbidden from doing.
    const m = dOrbit.model;
    check('solver present: the verdict is decided, not pending',
          /CAN REACH|CANNOT REACH/.test(dOrbit.drawn.verdict)
          && !/PENDING/.test(dOrbit.drawn.verdict), dOrbit.drawn.verdict);
    check('solver present: a real mission cost came back',
          Number.isFinite(m.dvRequiredMS) && m.dvRequiredMS > 0,
          `dvRequiredMS ${m.dvRequiredMS}`);
    check('solver present: margin IS available minus required, to the bit',
          Math.abs(m.marginMS - (m.dvAvailableMS - m.dvRequiredMS)) < 1e-9,
          `${m.marginMS} vs ${m.dvAvailableMS - m.dvRequiredMS}`);
    check('solver present: the verdict agrees with the sign of the margin',
          (m.marginMS >= 0) === /(?<!CANNOT )CAN REACH/.test(dOrbit.drawn.verdict),
          `margin ${m.marginMS}, verdict "${dOrbit.drawn.verdict}"`);
    check('solver present: feasible agrees with the margin too',
          m.feasible === (m.marginMS >= 0),
          `feasible ${m.feasible}, margin ${m.marginMS}`);
  }

  // --- 6. ONE DELTA-V AUTHORITY --------------------------------------------
  // The screen's vehicle figure must BE /core's, to the digit it prints.
  // /core's own total for this design, straight off the vehicle readout, in the
  // SAME frame. If this screen ever grows its own arithmetic these diverge.
  const coreDv = Number(of.vab('report').stats.totalDeltaV);
  const drawnDv = (() => {
    const m = /vehicle dV\s*([\d.-]+|---)/.exec(dOrbit.drawn.reachText);
    return m === null ? NaN : Number(m[1]);
  })();
  check('the screen prints a vehicle delta-v', Number.isFinite(drawnDv),
        `reachText ${dOrbit.drawn.reachText}`);
  check('the drawn vehicle dV IS /core\'s own figure',
        Math.abs(drawnDv - Math.round(coreDv)) < 1,
        `drawn ${drawnDv} vs /core ${coreDv}`);
  check('the model carries the same number',
        Math.abs(Number(dOrbit.model.dvAvailableMS) - coreDv) < 1e-9,
        `model ${dOrbit.model.dvAvailableMS} vs /core ${coreDv}`);

  // --- 7. THE TYPING RULE, AS A NEGATIVE -----------------------------------
  const altBox = document.querySelector('#of-vd-alt');
  const incBox = document.querySelector('#of-vd-inc');
  check('the orbit boxes are in the DOM', altBox !== null && incBox !== null);
  let typedSurvives = false;
  let detailFollowed = false;
  if (altBox !== null) {
    await type(altBox, '250');
    const after = of.vab('dest');
    detailFollowed = after.model.altKm === 250;
    // FORCE A RENDER the way a player would: take a part in hand. That is the
    // path that wiped the save panel's name box at GP-136.
    const cat = of.vab('catalogue');
    const pod = cat.find((x) => x.id === 0x0100);
    if (pod !== undefined) of.vab('take', pod.index);
    await sleep(0.3);
    of.vab('drop');
    await sleep(0.2);
    typedSurvives = of.vab('dest').drawn.altBox === '250';
  }
  check('typing moved the model', detailFollowed,
        `altKm ${of.vab('dest').model.altKm}`);
  check('a forced render did NOT wipe the box the player typed in',
        typedSurvives, `altBox now ${of.vab('dest').drawn.altBox}`);

  // --- 8. THE ORBIT ROW'S OWN LINE FOLLOWS THE TYPING ----------------------
  const orbitRow = document.querySelector('#of-vab [data-dest="orbit"] .det');
  check('the orbit row line follows what was typed',
        orbitRow !== null && orbitRow.textContent.includes('250 km'),
        orbitRow === null ? 'no row' : orbitRow.textContent);

  // --- 9. THE GATE ITSELF, /core's OWN TWO ANSWERS ------------------------
  //
  // Not the sentence the gate produced: the two booleans it is made of.
  // `partLock` is empty for an UNGATED item and for an unlocked one;
  // `partUnlockedByTech` is true only for a gated-and-earned one. Reading one
  // without the other is exactly the mistake this pass made and measured: the
  // first draft offered on `lock === ''` and put 24 of 25 parts in a survival
  // bay that offers 13.
  const g9 = of.vab('dest').model;
  check('the gate is read on the part item, 0x005d', g9.partItemId === 0x005d,
        '0x' + Number(g9.partItemId).toString(16));
  if (sandbox) {
    check('sandbox: /core reports no lock', g9.partLock === '', g9.partLock);
    check('sandbox: and no tech unlock is claimed',
          g9.partUnlockedByTech === false, String(g9.partUnlockedByTech));
  } else {
    check('survival: /core names the tech that locks it',
          g9.partLock !== '' && /autopilot/i.test(g9.partLock), g9.partLock);
    check('survival: and it is NOT unlocked by tech',
          g9.partUnlockedByTech === false, String(g9.partUnlockedByTech));
    check('survival: which is exactly why the row is withheld',
          !of.vab('report').offeredIds.includes(0x010d),
          JSON.stringify(of.vab('report').offeredIds));
  }

  // --- 10. THE PROMISE: NO MODULE, NO PLANNER; ONE MODULE, PLANNER --------
  //
  // The brief's rule is that the PART'S PRESENCE unlocks the feature. Asserted
  // by actually fitting one through the bay's own snap path (sandbox only:
  // survival withholds the row, which section 9 just proved).
  let fittedAfter = null;
  let gateAfterFit = null;
  if (sandbox) {
    const ap = cat0.find((c) => c.id === 0x010d);
    if (ap !== undefined) {
      of.vab('frame');
      of.vab('take', ap.index);
      await sleep(0.15);
      // TRY EVERY NODE THE CURSOR COULD REACH, not one guessed by geometry.
      // The first draft aimed at the lowest part's bottom face; the lowest
      // part is the Main Engine and an engine publishes only
      // `socket_stack_top`, so there was no node there and nothing was placed.
      // The refusal reason is captured either way, so a future failure says
      // WHY rather than 'count 0'.
      const cands = of.vab('nodes').filter((q) => q.onScreen);
      let placedIt = false;
      const why = [];
      for (const nd of cands) {
        of.vab('hover', nd.ndc[0], nd.ndc[1]);
        await sleep(0.05);
        const res = of.vab('place');
        if (res && res.ok) { placedIt = true; break; }
        const b = of.vab('report').blocked;
        if (b && b.why) why.push(nd.kind + ': ' + b.why);
      }
      check('the autopilot part found a node it could take', placedIt,
            'tried ' + cands.length + ' nodes; ' + why.slice(0, 3).join(' | '));
      await sleep(0.3);
      of.vab('drop');
      await sleep(0.25);
      const m = of.vab('dest');
      fittedAfter = m.model.moduleFitted;
      gateAfterFit = m.drawn.gate;
      check('fitting the part turns the module gate ON', fittedAfter === true,
            'moduleFitted ' + String(fittedAfter) + ', count '
            + String(m.model.moduleCount));
      check('the gate line says so on the SCREEN',
            /fitted/i.test(gateAfterFit), gateAfterFit);
      check('exactly one module counted', m.model.moduleCount === 1,
            String(m.model.moduleCount));
    }
  }

  const dEnd = of.vab('dest');
  return {
    valid: fails.length === 0,
    fails,
    mode: modeName,
    rowIds: dEnd.drawn.rowIds,
    blocked: dEnd.drawn.blockedRowIds,
    gateDrawn: dEnd.drawn.gate,
    verdictDrawn: dEnd.drawn.verdict,
    // WHICH BRANCH RAN, published so a green run cannot hide that it took
    // the trivial one. Reading 'solverPresent: false' after PH-149 is
    // itself a finding.
    solverPresent,
    waitingOn: dEnd.model.waitingOn,
    dvRequiredMS: dEnd.model.dvRequiredMS,
    marginMS: dEnd.model.marginMS,
    feasible: dEnd.model.feasible,
    dvAvailableMS: dEnd.model.dvAvailableMS,
    drawnDv,
    altKm: dEnd.model.altKm,
    altBox: dEnd.drawn.altBox,
    partMissingFromCatalogue: dEnd.model.partMissingFromCatalogue,
    lockedByTech: dEnd.model.lockedByTech,
    partLock: dEnd.model.partLock,
    partUnlockedByTech: dEnd.model.partUnlockedByTech,
    offered: of.vab('report').offered,
    autopilotOffered: of.vab('report').offeredIds.includes(0x010d),
    fittedAfter, gateAfterFit,
    note: 'the mission-cost half is of_ap_design_reach and is the physics '
      + 'lane; every vehicle figure here is /core\'s own',
  };
})()
