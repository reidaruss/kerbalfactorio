// vab.js: the assembly bay acceptance (W8, DW-29 / DW-30 item 4).
//
// Run it in BOTH modes, from web/, against the probe server (5199, no hot
// reload, restart it after any src edit):
//
//   npx vite --config vite.probe.config.ts
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vab.js
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --settle=6 \
//        --evalfile=tools/smoke/probes/vab.js
//
// NOTE THE FLAG POSITION. `--sandbox=1` is a RUNNER flag, not part of --url.
// run.mjs builds the page URL from --url plus a fixed allow-list of its OWN
// arguments, so a query string written into --url is DISCARDED without a word.
// Putting it there costs a run and a confusing report. This probe checks its own
// setup for exactly that reason (section 0 fails if the URL flag and the game
// disagree), and that is what caught it.
//
// WHY IT IS SHAPED THIS WAY.
//
// (1) Nearly every action below is a REAL DOM EVENT on a REAL ELEMENT. The
//     probe suite drives input ACTIONS, which never generate DOM events, and
//     that once hid a completely inert left mouse button through twenty green
//     probes (probes/realclick.js). The bay is mouse-driven from end to end, so
//     a probe that drove it through method calls would be testing the layer
//     underneath the bug. The catalogue rows, the stage arrows, Save, the design
//     chips and one whole part placement all go through dispatched events.
//
// (2) The delta-v is checked against /core's OWN fixture, not against itself.
//     core/tests/test_vessel.cpp builds "Ascender I" and pins 1857.79 + 3065.12
//     = 4922.91 m/s vacuum, 9845 kg on the pad, pad TWR 1.6567, 12.10 m. If this
//     screen shows different numbers for the same design, this screen is wrong.
//
// (3) The joint gap is MEASURED on the drawn scene, by walking to each mated
//     pair of glTF sockets and taking the world-space distance between them. It
//     deliberately does not consult the layout it was built from, because a
//     check that reads the model it drew agrees with itself whatever the
//     renderer does. Same move probes/buildtol.js makes for foundations.
//
// (4) DW-20: it proves the sim advanced AND that its own setup worked before
//     any measurement is believed. Section 0 is the setup proof.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };

  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

  // The reference vehicle, by PartId, in the order test_vessel.cpp builds it.
  const PID = {
    CommandPod: 0x0100, TankLiquidSmall: 0x0101, TankLiquidSmallLong: 0x0102,
    EngineLiquidSmall: 0x0103, EngineVacuumSmall: 0x0104,
    DecouplerStackSmall: 0x0106, Parachute: 0x010a, Fin: 0x010b,
    TankLiquidLarge: 0x0117,
  };
  // The /core fixture. Any disagreement here is a defect in the screen.
  const CORE = {
    parts: 24, stage0DV: 1857.79, stage1DV: 3065.12, totalDV: 4922.91,
    massKg: 9845, padTwr: 1.6567, lengthM: 12.10,
  };

  const rep = () => of.vab('report');
  const cat = () => of.vab('catalogue');
  const indexOfPart = (pid) => {
    const rows = cat();
    for (let i = 0; i < rows.length; ++i) if (rows[i].id === pid) return rows[i].index;
    return -1;
  };

  const canvas = document.querySelector('canvas');
  if (!canvas) return { valid: false, why: 'no canvas' };

  // A real pointer gesture at a normalised-device point on the canvas.
  const clientOf = (ndc) => {
    const r = canvas.getBoundingClientRect();
    return {
      clientX: r.left + (ndc[0] * 0.5 + 0.5) * r.width,
      clientY: r.top + (-ndc[1] * 0.5 + 0.5) * r.height,
    };
  };
  const realPointerClick = async (ndc) => {
    const c = clientOf(ndc);
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, ...c };
    canvas.dispatchEvent(new PointerEvent('pointermove', opts));
    await sleep(0.1);
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.08);
    window.dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(0.15);
  };

  // ==========================================================================
  // 0. SETUP PROOF. Nothing below is believable without these.
  // ==========================================================================
  const t0 = of.world().tick;
  const urlSandbox = new URLSearchParams(location.search).get('sandbox') === '1';
  let r = of.vab('enter');
  await sleep(0.4);
  r = rep();
  check('the bay opened', r.open === true);
  check('the URL flag and the game agree', r.mode === (urlSandbox ? 'sandbox' : 'survival'),
        `${r.mode} vs url ${urlSandbox}`);
  // The bay joins the DERIVED modal list (GP-25), which is what makes Escape
  // close it without a second handler. Section 8 is the assertion.
  const modalsOpen = JSON.stringify(of.modals());
  log.push(`modals while the bay is open: ${modalsOpen}`);
  const sandbox = r.mode === 'sandbox';

  // Start from nothing, through the panel's own Clear button.
  of.vab('press', 'clear');
  await sleep(0.2);
  check('the bay starts empty', rep().parts.length === 0, `${rep().parts.length} parts`);

  // ==========================================================================
  // 1. THE CATALOGUE, AND EVERY PART HAS A MESH
  // ==========================================================================
  const rows = cat();
  check('24 parts in the catalogue', rows.length === CORE.parts, `${rows.length}`);
  const noMesh = rows.filter((p) => !p.hasMesh).map((p) => p.asset);
  check('every part has a shipped mesh', noMesh.length === 0, noMesh.join(', '));
  // The rename debt is BOUNDED and asserted, so it cannot grow quietly. Two
  // catalogue names disagree with the glb (vessel.h calls them
  // LiquidEngineVacuumSmall and DecouplerRadial; the file calls them
  // EngineVacuumSmall and RadialDecoupler). Raised to the physics lane.
  check('the asset rename debt is exactly 2', r.renameDebt === 2, `${r.renameDebt}`);
  check('no more than the known renames were used',
        r.assetsRenamed.length <= r.renameDebt, r.assetsRenamed.join(', '));
  const dupNames = rows.map((p) => p.name).filter((n, i, a) => a.indexOf(n) !== i);
  check('no two parts share a display name', dupNames.length === 0, dupNames.join(', '));
  const noItem = rows.filter((p) => !(p.itemId >= 0x50 && p.itemId <= 0x6a));
  check('every part has an ItemId in the 0x0050 block', noItem.length === 0,
        noItem.map((p) => p.name).join(', '));

  // ==========================================================================
  // 2. THE MODE GATE. Sandbox offers everything, survival does not, and /core's
  //    own affordability answer is published in BOTH (GP-29).
  // ==========================================================================
  check('the offered catalogue matches the mode',
        r.offered === (sandbox ? 24 : 13), `${r.offered} offered in ${r.mode}`);
  const coreSaysYes = rows.filter((p) => p.affordInCore).length;
  log.push(`/core says ${coreSaysYes} of ${rows.length} parts are affordable right now`);

  // ==========================================================================
  // 3. BUILD "Ascender I" THROUGH THE UI, one part at a time.
  //    Each part: click its catalogue row (real DOM), aim at the pixel the
  //    target node is drawn at, place. In survival the pack is empty, so the
  //    same sequence must REFUSE and build nothing, which is the negative
  //    control that proves the cost gate is real.
  // ==========================================================================
  const stack = [
    PID.CommandPod, PID.Parachute, PID.TankLiquidSmall, PID.EngineVacuumSmall,
    PID.DecouplerStackSmall, PID.TankLiquidSmallLong, PID.EngineLiquidSmall,
  ];
  let realEventPlacements = 0;
  const placeLog = [];

  for (let i = 0; i < stack.length; ++i) {
    const idx = indexOfPart(stack[i]);
    if (idx < 0) { placeLog.push(`part ${stack[i].toString(16)} not offered`); continue; }
    // Re-frame first. The bay does NOT auto-zoom as the rocket grows, on
    // purpose (KSP does not either, and a view that moves under a player who
    // just aimed is worse than one that does not), so the node at the bottom of
    // a 12 m stack falls off screen exactly the way it does for a human who has
    // not scrolled out yet. Framing is what the player would do.
    of.vab('frame');
    of.vab('take', idx);                       // REAL DOM click on the row
    await sleep(0.12);
    const before = rep().parts.length;
    if (before === 0) {
      of.vab('place');                         // the root needs no node
    } else {
      // The lowest part in the stack is the one with the smallest origin Y.
      const parts = rep().parts;
      let low = parts[0];
      for (const p of parts) if (p.origin[1] < low.origin[1]) low = p;
      const nodes = of.vab('nodes').filter((n) => n.parent === low.handle && n.onScreen
        && (n.kind === 'bottom' || n.kind === 'interstage'));
      if (nodes.length === 0) { placeLog.push(`no visible bottom node under ${low.handle}`); continue; }
      // The FIRST attach of the run goes through a real pointer gesture on the
      // canvas, so at least one placement is proven to work through the browser
      // event path and not only through the method the debug surface calls.
      if (realEventPlacements === 0) {
        await realPointerClick(nodes[0].ndc);
        realEventPlacements += 1;
      } else {
        of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
        of.vab('place');
      }
    }
    await sleep(0.15);
    placeLog.push(`${stack[i].toString(16)}: ${before} -> ${rep().parts.length}`);
  }

  // Four fins, radially, in one press: symmetry is what makes the reference
  // vehicle a click rather than four.
  let finsPlaced = 0;
  if (sandbox) {
    of.vab('press', 'sym');   // falls to the first symmetry button; set 4 below
    const symBtn = document.querySelector('[data-vab="sym"][data-n="4"]');
    if (symBtn) { symBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    await sleep(0.1);
    check('symmetry is 4', rep().symmetry === 4, `${rep().symmetry}`);
    const finIdx = indexOfPart(PID.Fin);
    of.vab('frame');
    of.vab('take', finIdx);
    await sleep(0.12);
    const parts = rep().parts;
    const longTank = parts.find((p) => p.partId === PID.TankLiquidSmallLong);
    const radial = of.vab('nodes')
      .filter((n) => n.kind === 'radial' && n.onScreen
        && (longTank === undefined || n.parent === longTank.handle));
    if (radial.length > 0) {
      const n0 = radial[0];
      of.vab('hover', n0.ndc[0], n0.ndc[1]);
      const b = rep().parts.length;
      of.vab('place');
      await sleep(0.2);
      finsPlaced = rep().parts.length - b;
    }
    of.vab('drop');
  }

  r = rep();
  const built = r.parts.length;
  if (sandbox) {
    check('the seven-part stack assembled', built >= 7, `${built} parts`);
    check('one press placed four fins', finsPlaced === 4, `${finsPlaced}`);
    check('at least one placement came from a REAL pointer event',
          realEventPlacements >= 1 && r.pointer.clicks >= 1,
          `realEvents ${realEventPlacements}, pointer.clicks ${r.pointer.clicks}`);
  } else {
    // THE NEGATIVE CONTROL. An empty survival pack cannot buy a command pod, so
    // the identical sequence must build nothing and say why.
    check('survival with an empty pack builds nothing', built === 0, `${built} parts`);
    check('and it refused out loud', r.refused > 0, `${r.refused} refusals`);
    check('and the refusal names the cost', /need \d+ /.test(r.message), r.message);
  }

  // ==========================================================================
  // 4. THE NUMBERS, against /core's own fixture.
  // ==========================================================================
  let dv = { total: null, s0: null, s1: null };
  let pinned = null;
  if (sandbox && built >= 7) {
    const s = r.stats;
    pinned = {
      massKg: s.massKg, padTwr: s.padTwr, lengthM: s.lengthM,
      staticMarginM: s.staticMarginM, stable: s.stable, crew: s.crew,
    };
    dv = {
      total: s.totalDeltaV,
      s0: r.stages[0] ? r.stages[0].deltaVVacuumMS : null,
      s1: r.stages[1] ? r.stages[1].deltaVVacuumMS : null,
    };
    // Tolerance 0.01 m/s: the core figure is quoted to 2 dp, and the bridge is
    // a copy of a double, so anything larger than rounding is a real defect.
    check('two stages were derived', r.stages.length === 2, `${r.stages.length}`);
    check('stage 0 delta-v matches /core', near(dv.s0, CORE.stage0DV, 0.01),
          `${dv.s0} vs ${CORE.stage0DV}`);
    check('stage 1 delta-v matches /core', near(dv.s1, CORE.stage1DV, 0.01),
          `${dv.s1} vs ${CORE.stage1DV}`);
    check('total delta-v matches /core', near(dv.total, CORE.totalDV, 0.01),
          `${dv.total} vs ${CORE.totalDV}`);
    check('launch mass matches /core', near(s.massKg, CORE.massKg, 0.5),
          `${s.massKg} vs ${CORE.massKg}`);
    check('pad TWR matches /core', near(s.padTwr, CORE.padTwr, 0.001),
          `${s.padTwr} vs ${CORE.padTwr}`);
    check('length matches /core', near(s.lengthM, CORE.lengthM, 0.01),
          `${s.lengthM} vs ${CORE.lengthM}`);
    // The fins sit at a sampled radial height rather than the fixture's 0.15 m,
    // which moves the centre of pressure a little. The SIGN is the claim.
    check('four fins make it statically stable', s.stable === true,
          `margin ${s.staticMarginM}`);
  }

  // ==========================================================================
  // 5. THE SNAP GAP, measured on the DRAWN scene.
  // ==========================================================================
  const gapsReport = of.vab('gaps');
  if (sandbox && built >= 7) {
    // Exactly ONE joint is unmeasurable and it is a known one: the decoupler
    // under the vacuum engine, where the art contract publishes no socket on the
    // bell side. Asserted as exactly one so a second silent gap cannot appear.
    check('six stack joints exist', gapsReport.joints === 6, `${gapsReport.joints}`);
    check('exactly one joint is unmeasurable (the interstage)',
          gapsReport.unmeasurable === 1,
          `${gapsReport.unmeasurable} joints had no socket on one side`);
    check('five stack joints were measured', gapsReport.measured >= 5,
          `${gapsReport.measured}`);
    // A mated pair of sockets is the SAME point. Anything above a micrometre is
    // a real seam, not floating point, at these coordinates.
    check('every joint closes to under 1e-6 m',
          gapsReport.worstM !== null && gapsReport.worstM < 1e-6,
          `worst ${gapsReport.worstM} m`);
  }

  // ==========================================================================
  // 6. STAGING REORDER. It must change the numbers, in the direction a wrong
  //    staging order changes them, and it must come BACK exactly.
  // ==========================================================================
  let reorder = null;
  if (sandbox && r.stages.length === 2) {
    const beforeTotal = rep().stats.totalDeltaV;
    const beforeStages = rep().stages.map((s) => s.deltaVVacuumMS);
    of.vab('stageDown', 0);                    // REAL DOM click on the arrow
    await sleep(0.2);
    const swapped = rep();
    of.vab('stageUp', 1);                      // and back
    await sleep(0.2);
    const restored = rep();
    reorder = {
      beforeTotal, beforeStages,
      swappedTotal: swapped.stats.totalDeltaV,
      swappedStages: swapped.stages.map((s) => s.deltaVVacuumMS),
      restoredTotal: restored.stats.totalDeltaV,
    };
    check('a reorder changed the total',
          reorder.swappedTotal !== reorder.beforeTotal,
          `${reorder.swappedTotal} vs ${reorder.beforeTotal}`);
    // Direction: firing the upper stage first strands the lower stage's fuel
    // behind an engine that is no longer lit, so the budget can only fall.
    check('the wrong order costs delta-v', reorder.swappedTotal < reorder.beforeTotal,
          `${reorder.swappedTotal} >= ${reorder.beforeTotal}`);
    check('the per-stage numbers moved',
          reorder.swappedStages.join() !== reorder.beforeStages.join(),
          reorder.swappedStages.join(' / '));
    check('reordering back restores the exact figures',
          reorder.restoredTotal === reorder.beforeTotal,
          `${reorder.restoredTotal} vs ${reorder.beforeTotal}`);
  }

  // ==========================================================================
  // 7. SAVE AND RELOAD A DESIGN. A player who cannot keep a rocket they liked
  //    will not iterate on one.
  // ==========================================================================
  let design = null;
  if (sandbox && built >= 7) {
    const name = `probe-${Date.now() % 100000}`;
    of.vab('save', name);                      // REAL DOM: type + click Save
    await sleep(0.2);
    const savedList = rep().designs;
    of.vab('press', 'clear');
    await sleep(0.2);
    const afterClear = rep();
    const loadResult = of.vab('load', name);   // REAL DOM click on the chip
    await sleep(0.3);
    const loaded = rep();
    design = {
      name, listed: savedList.includes(name),
      loadError: loadResult && loadResult.error ? loadResult.error : null,
      partsAfterClear: afterClear.parts.length,
      partsAfterLoad: loaded.parts.length,
      dvAfterLoad: loaded.stats.totalDeltaV,
      stagesAfterLoad: loaded.stages.length,
    };
    check('the design was listed', design.listed, savedList.join(', '));
    check('Clear really cleared', design.partsAfterClear === 0,
          `${design.partsAfterClear}`);
    check('the design reloaded whole', design.partsAfterLoad === built,
          `${design.partsAfterLoad} vs ${built}`);
    check('and its delta-v survived the round trip',
          near(design.dvAfterLoad, CORE.totalDV, 0.01),
          `${design.dvAfterLoad} vs ${CORE.totalDV}`);
    check('and so did its staging', design.stagesAfterLoad === 2,
          `${design.stagesAfterLoad}`);
    of.vab('forget', name);
    await sleep(0.15);
    check('and it could be deleted again', !rep().designs.includes(name));
  }

  // ==========================================================================
  // 8. THE MODE IS A PLACE. Escape leaves it, through the DERIVED modal list.
  // ==========================================================================
  const drawWhileOpen = of.stats().draw.calls;
  of.escape();
  await sleep(0.3);
  const afterEscape = rep();
  check('Escape left the bay', afterEscape.open === false);
  of.vab('enter');
  await sleep(0.3);
  check('and it can be re-entered', rep().open === true);
  const finalReport = rep();

  // ==========================================================================
  // DW-20: did the simulation actually advance under all of that?
  // ==========================================================================
  await sleep(1.5);
  const ticks = of.world().tick - t0;
  check('the simulation advanced', ticks > 200, `${ticks} ticks`);

  return {
    valid: fails.length === 0,
    mode: finalReport.mode, sandbox, urlSandbox,
    fails, log, advanced: ticks,
    catalogue: {
      parts: rows.length, offered: finalReport.offered,
      meshesMissing: finalReport.meshesMissing,
      assetsRenamed: finalReport.assetsRenamed, renameDebt: finalReport.renameDebt,
      itemIdBlock: `0x${rows[0].itemId.toString(16)}..0x${rows[rows.length - 1].itemId.toString(16)}`,
      coreAffordable: coreSaysYes,
    },
    assembly: {
      placed: finalReport.placed, refused: finalReport.refused,
      parts: built, finsFromOnePress: finsPlaced,
      realPointerPlacements: realEventPlacements,
      pointer: finalReport.pointer, placeLog,
    },
    numbers: {
      core: CORE, measured: dv,
      pinned,
    },
    snap: {
      joints: gapsReport.joints, measured: gapsReport.measured,
      unmeasurable: gapsReport.unmeasurable, worstGapM: gapsReport.worstM,
    },
    reorder, design,
    render: { drawCallsInBay: drawWhileOpen },
    note: 'delta-v, mass, TWR and length are pinned against core/tests/test_vessel.cpp',
  };
})()
