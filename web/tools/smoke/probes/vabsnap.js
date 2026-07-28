// vabsnap.js: the assembly bay acceptance for GP-115 to GP-121.
//
//   npx vite --config vite.probe.config.ts --port 5241 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5241/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabsnap.js
//
// Reid's four complaints from one build session, plus R10 and R11:
//   1. "if im using the Fuel Tank large L i cant snap anything on top of it,
//       even after using the adapter"
//   2. "Things dont snap to the radial decouplers."
//   3. "i have to start with the engine and build up"
//   4. "the menu on the left should be tabbed ... i shouldnt have to horizontal
//       scroll to see stuff"
//   R10 per-stage TWR and a hopeless design refused BEFORE roll-out.
//   R11 the `recover` verb, which has had a key since GP-74 and no button.
//
// WHAT MAKES THIS PROBE MEAN ANYTHING.
//
// (a) Section 1 is a BEFORE-AND-AFTER on the same page. The shipped snap search
//     filtered candidate nodes by `fitAt` before ranking, so a node that existed
//     and did not fit was invisible: measured on the old build, a 1.25 m tank
//     over a bare 2.50 m tank snapped on 0 of 1681 screen cells and the click
//     was refused with "no attachment node there", a false statement about a
//     face the player was pointing at. The assertion here is not that the
//     placement fails (it must still fail, the classes really do not mate) but
//     that the REFUSAL NAMES BOTH DIAMETERS AND THE REMEDY.
// (b) Section 3 carries its own negative control, and it is the point of the
//     section: GP-73 measured pod / tank / engine / decoupler producing burn 0
//     at 0 engines and burn 1 at TWR 3.7026, and that vehicle LIFTS. A
//     pre-flight check written to the brief's literal wording would refuse it.
//     So the same probe that proves a 0.98 design is refused proves that one is
//     not, or the check is a cage rather than a guard.
// (c) Section 4 measures the LIST ELEMENT'S OWN scrollWidth against its
//     clientWidth. Counting tabs would go green while the sideways scrollbar
//     Reid actually complained about was still there.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };

  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const PID = {
    Pod: 0x0100, TankS: 0x0101, TankSLong: 0x0102, EngineS: 0x0103,
    SolidBooster: 0x0105, DecouplerStackS: 0x0106, DecouplerRadial: 0x0107,
    NoseCone: 0x0109, Fin: 0x010b,
    TankL: 0x0117, EngineL: 0x0118, Adapter: 0x011a,
  };
  const cat = of.vab('catalogue');
  const idx = {};
  for (const k of Object.keys(PID)) {
    const r = cat.find((x) => x.id === PID[k]);
    idx[k] = r === undefined ? -1 : r.index;
    check(`catalogue has ${k}`, idx[k] >= 0, `PartId 0x${PID[k].toString(16)} missing`);
  }

  // --- 0. setup proof (DW-20) ----------------------------------------------
  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));
  check('sandbox offers the whole catalogue', boot.offered === 24,
        `offered ${boot.offered}, mode ${boot.mode}`);
  log.push({ mode: boot.mode, offered: boot.offered, catalogue: boot.catalogue });

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (part) => { of.vab('drop'); of.vab('take', idx[part]); await sleep(1); };
  const nodesOf = (pred) => of.vab('nodes').filter(pred);
  /** Aim at a node's own drawn pixel and report what the snap answered. */
  const aimAt = async (node) => {
    // A missing node is a FAILURE BY NAME in whichever check asked for it, never
    // a throw here: a nobbled build that publishes no node at all must still get
    // through to the assertion that says which node it lost.
    if (node === undefined || node === null) return of.vab('report');
    of.vab('hover', node.ndc[0], node.ndc[1]);
    await sleep(1);
    return of.vab('report');
  };

  // --- 1. COMPLAINT 1: the class transition ---------------------------------
  await clear();
  await hold('TankL');
  const rootOk = of.vab('place');
  check('a large tank starts a stack', rootOk.ok === true, rootOk.report.message);

  // 1a. an S part straight onto an L face: refused, but by NAME.
  await hold('TankS');
  const lTop = nodesOf((n) => n.kind === 'top');
  check('the large tank publishes a top face', lTop.length === 1,
        `top nodes ${lTop.length}`);
  check('and it is a 2.50 m face', lTop[0] !== undefined
        && Math.abs(lTop[0].cls - 2.5) < 1e-9, JSON.stringify(lTop[0]));
  const missRep = await aimAt(lTop[0]);
  check('a 1.25 m part does not snap to it', missRep.snapped === null,
        JSON.stringify(missRep.snapped));
  check('but the near miss IS held', missRep.blocked !== null
        && missRep.blocked.kind === 'top', JSON.stringify(missRep.blocked));
  const miss = of.vab('place');
  check('and the placement is refused', miss.ok === false, miss.report.message);
  const why = miss.report.message;
  check('the refusal names the part diameter', why.includes('1.25 m'), why);
  check('the refusal names the face diameter', why.includes('2.50 m'), why);
  check('the refusal names the remedy', why.includes('Stack Adapter'), why);
  check('the old lie is gone', !why.includes('no attachment node there'), why);
  check('nothing was placed', miss.report.parts.length === 1,
        `${miss.report.parts.length} parts`);
  log.push({ classRefusal: why });

  // 1b. the adapter mates, and then the S part mates on the adapter.
  await hold('Adapter');
  const aTop = nodesOf((n) => n.kind === 'top');
  await aimAt(aTop[0]);
  const adapt = of.vab('place');
  check('the adapter takes the 2.50 m face', adapt.ok === true, adapt.report.message);
  await hold('TankS');
  const sTop = nodesOf((n) => n.kind === 'top');
  check('the adapter presents a 1.25 m face', sTop[0] !== undefined
        && Math.abs(sTop[0].cls - 1.25) < 1e-9, JSON.stringify(sTop[0]));
  const onAdapter = await aimAt(sTop[0]);
  check('the small tank snaps to it', onAdapter.snapped !== null
        && onAdapter.snapped.kind === 'top', JSON.stringify(onAdapter.snapped));
  const stacked = of.vab('place');
  check('and it commits', stacked.ok === true, stacked.report.message);
  check('three parts on the stack', stacked.report.parts.length === 3,
        `${stacked.report.parts.length} parts`);
  // MEASURED on the drawn scene, not on the model it was built from.
  const gaps = of.vab('gaps');
  check('every joint of the L stack is measurable', gaps.unmeasurable === 0,
        JSON.stringify(gaps));
  check('and the worst joint gap is zero to floating point',
        gaps.worstM !== null && gaps.worstM < 1e-6, `worst ${gaps.worstM}`);
  log.push({ largeStack: { parts: stacked.report.parts.length,
                           lengthM: stacked.report.stats.lengthM,
                           worstGapM: gaps.worstM } });

  // --- 2. COMPLAINT 2: the radial decoupler ---------------------------------
  await clear();
  await hold('TankSLong');
  of.vab('place');
  await sleep(2);
  await hold('DecouplerRadial');
  // MID-HULL on purpose. A ring node near an end face sits within SNAP_M of
  // that face, so the negative control below would be answered by the tank's own
  // bottom node rather than by the pylon, which is what the first run of this
  // probe measured happening (a pod snapping to `parent 4 kind bottom`). The
  // 4.00 m tank's middle ring is 2.29 m from one face and 1.71 m from the other,
  // both outside the 1.60 m snap radius.
  const ring = nodesOf((n) => n.kind === 'radial' && n.onScreen)
    .sort((a, b) => Math.abs(a.offsetM - 2.0) - Math.abs(b.offsetM - 2.0));
  check('the tank offers radial mounts', ring.length > 0, `${ring.length}`);
  check('and one of them is clear of both end faces',
        ring[0] !== undefined && Math.abs(ring[0].offsetM - 2.0) < 0.6,
        JSON.stringify(ring[0] && ring[0].offsetM));
  await aimAt(ring[0]);
  const pylon = of.vab('place');
  check('the radial decoupler goes on', pylon.ok === true, pylon.report.message);
  const decHandle = pylon.report.parts[1] === undefined ? -1
    : pylon.report.parts[1].handle;

  // The whole complaint, as one number: how many nodes hang off the decoupler?
  await hold('SolidBooster');
  const onDec = nodesOf((n) => n.parent === decHandle);
  check('the decoupler now publishes a node', onDec.length === 1,
        `${onDec.length} nodes on handle ${decHandle}`);
  check('and it is a pylon, not a 72-node cage',
        onDec[0] !== undefined && onDec[0].kind === 'pylon',
        JSON.stringify(onDec[0]));

  // NEGATIVE CONTROL FIRST, while the pylon is still empty. A part with no
  // radial mount is refused BY NAME, which is the same GP-115 machinery and is
  // what proves the pylon is a rule and not a hole. A pod has no radial mount
  // and never should.
  await hold('Pod');
  const podPylon = nodesOf((n) => n.parent === decHandle && n.kind === 'pylon');
  const podAim = await aimAt(podPylon[0]);
  check('a pod does not snap to the pylon',
        podAim.snapped === null || podAim.snapped.parent !== decHandle,
        JSON.stringify(podAim.snapped));
  check('and the pylon is held as the NAMED near miss',
        podAim.blocked !== null && podAim.blocked.kind === 'pylon',
        JSON.stringify(podAim.blocked));
  const podRef = of.vab('place');
  check('and the refusal says why', podRef.ok === false
        && podRef.report.message.includes('radial mount'), podRef.report.message);
  check('and nothing was placed by it', podRef.report.parts.length === 2,
        `${podRef.report.parts.length}`);
  log.push({ pylonRefusal: podRef.report.message });

  // Now the booster, on a pylon that has just been proven selective.
  await hold('SolidBooster');
  const boostNode = nodesOf((n) => n.parent === decHandle && n.kind === 'pylon');
  const aimed = await aimAt(boostNode[0]);
  check('a booster snaps to the pylon', aimed.snapped !== null
        && aimed.snapped.parent === decHandle, JSON.stringify(aimed.snapped));
  const strapped = of.vab('place');
  check('and it commits', strapped.ok === true, strapped.report.message);
  const booster = strapped.report.parts[2];
  check('the booster hangs off the DECOUPLER, not the tank',
        booster !== undefined && booster.parent === decHandle,
        JSON.stringify(booster));
  check('three parts after the strap-on', strapped.report.parts.length === 3,
        `${strapped.report.parts.length}`);
  // It must stand OUTBOARD of the core, or it is inside the tank it straps to.
  const rBooster = booster === undefined ? 0
    : Math.hypot(booster.origin[0], booster.origin[2]);
  check('and it stands outboard of the core hull', rBooster > 0.62,
        `mount radius ${rBooster.toFixed(4)} m`);
  // ONE tenant per pylon: a second booster must have nowhere to go.
  await hold('SolidBooster');
  check('the pylon is spent once something is on it',
        nodesOf((n) => n.parent === decHandle).length === 0,
        `${nodesOf((n) => n.parent === decHandle).length} nodes left`);
  log.push({ pylon: { decouplerHandle: decHandle, nodesOnDecoupler: onDec.length,
                      boosterMountRadiusM: rBooster } });

  // --- 3. COMPLAINT 3: building DOWNWARD ------------------------------------
  await clear();
  await hold('Pod');
  of.vab('place');
  await sleep(2);
  const down = [];
  for (const part of ['TankSLong', 'EngineS']) {
    await hold(part);
    const bot = nodesOf((n) => n.kind === 'bottom');
    if (bot.length === 0) { down.push({ part, err: 'no bottom node' }); continue; }
    await aimAt(bot[0]);
    const r = of.vab('place');
    down.push({ part, ok: r.ok, onScreen: bot[0].onScreen, msg: r.report.message });
    await sleep(2);
  }
  check('a tank goes UNDER the pod', down[0] !== undefined && down[0].ok === true,
        JSON.stringify(down[0]));
  check('and an engine goes under that', down[1] !== undefined && down[1].ok === true,
        JSON.stringify(down[1]));
  const built = of.vab('report');
  check('the downward stack is three parts', built.parts.length === 3,
        `${built.parts.length}`);
  check('and it grew downward in the vessel frame',
        built.parts[2] !== undefined && built.parts[2].origin[1] < 0,
        JSON.stringify(built.parts.map((p) => p.origin[1])));
  check('the whole stack is still on screen', down.every((d) => d.onScreen === true),
        JSON.stringify(down.map((d) => d.onScreen)));
  // GP-122: and the camera followed it down rather than letting it walk off the
  // bottom of the view, which is the half of complaint 3 that was real.
  check('the camera followed the stack downward', built.reframes > 0,
        `${built.reframes} reframes`);
  const camY = built.camera.target[1];
  check('and its target sits on the stack, not above where the pod used to be',
        camY < 1.0, `target y ${camY}`);
  log.push({ downward: down, originsY: built.parts.map((p) => p.origin[1]),
             lengthM: built.stats.lengthM });

  // --- R10: the pre-flight verdict -----------------------------------------
  // 3 continues as the NEGATIVE CONTROL for R10: pod / tank / engine is a
  // vehicle that flies, and it must not be refused.
  const goodV = of.vab('verdict');
  check('a flyable stack is flight ready', goodV.ok === true,
        JSON.stringify(goodV.faults));
  check('and the band says so on screen',
        of.vab('verdictBand').fault === false
        && of.vab('verdictBand').text.includes('FLIGHT READY'),
        of.vab('verdictBand').text);
  check('and the verdict names the burn that lifts', goodV.liftBurn === 0
        && goodV.liftTwr > 1, `burn ${goodV.liftBurn} twr ${goodV.liftTwr}`);
  const goodBand = of.vab('report');
  log.push({ flyable: { liftBurn: goodV.liftBurn, liftTwr: goodV.liftTwr,
                        summary: goodV.summary, stages: goodBand.stages.length } });

  // R10a: THE GP-73 SHAPE. Add a stack decoupler under the engine bell, which
  // GP-32 permits and which gives burn 0 zero engines and one decoupler. This
  // vehicle LIFTS (GP-73 measured burn 1 at TWR 3.7026), so a check written to
  // the brief's literal "any burn with zero engines that is not the last one"
  // would refuse a rocket that works. It must come back OK with a warning.
  await hold('DecouplerStackS');
  const inter = nodesOf((n) => n.kind === 'interstage');
  check('the engine bell offers an interstage', inter.length === 1, `${inter.length}`);
  if (inter[0] !== undefined) {
    await aimAt(inter[0]);
    const r = of.vab('place');
    check('the decoupler hangs under the bell', r.ok === true, r.report.message);
  }
  await sleep(2);
  const gp73 = of.vab('verdict');
  const gp73rep = of.vab('report');
  const burn0 = gp73rep.stages[0];
  check('GP-73 shape: burn 0 has no engines', burn0 !== undefined
        && burn0.engines === 0, JSON.stringify(burn0));
  // vessel.h: pressing stage k DROPS burn k-1 and LIGHTS burn k, so burn 0's
  // own decouple list is empty by construction on every staged rocket. That is
  // why the brief's "zero engines and not the last" cannot be a fault: it is the
  // normal shape, and this vehicle flies.
  check('GP-73 shape: burn 0 drops nothing either, by vessel.h construction',
        burn0 !== undefined && burn0.decouplers === 0, JSON.stringify(burn0));
  check('GP-73 shape is NOT refused', gp73.ok === true,
        JSON.stringify(gp73.faults));
  check('it is a warning, and a named one',
        gp73.warnings.some((w) => w.code === 'idle-stage'),
        JSON.stringify(gp73.warnings.map((w) => w.code)));
  check('and the verdict points at the burn that DOES lift', gp73.liftBurn === 1
        && gp73.liftTwr > 1, `burn ${gp73.liftBurn} twr ${gp73.liftTwr}`);
  check('while stage 0 still reads TWR 0, which is why the label had to change',
        burn0 !== undefined && burn0.twr === 0, JSON.stringify(burn0 && burn0.twr));
  log.push({ gp73: { stages: gp73rep.stages.map((s) => ({ e: s.engines, d: s.decouplers,
                                                          twr: Number(s.twr.toFixed(4)) })),
                     ok: gp73.ok, liftBurn: gp73.liftBurn,
                     liftTwr: gp73.liftTwr, summary: gp73.summary,
                     warnings: gp73.warnings.map((w) => w.code) } });

  // R10b: NO ENGINE AT ALL. Reid's "empty first stage" in its purest form.
  await clear();
  await hold('Pod');
  of.vab('place');
  await sleep(1);
  await hold('TankSLong');
  const bot2 = nodesOf((n) => n.kind === 'bottom');
  if (bot2[0] !== undefined) { await aimAt(bot2[0]); of.vab('place'); }
  await sleep(2);
  const noEng = of.vab('verdict');
  check('a rocket with no engine is refused', noEng.ok === false, JSON.stringify(noEng));
  check('and the fault is named no-engine',
        noEng.faults.some((f) => f.code === 'no-engine'),
        JSON.stringify(noEng.faults.map((f) => f.code)));

  // R10b2: AN ENGINE WITH NOTHING TO BURN, which is the most literal reading of
  // "an empty first stage" and the one shape a TWR check waves straight through:
  // a bare engine has enormous thrust-to-weight and burns for 0.0 s.
  await clear();
  await hold('EngineS');
  of.vab('place');
  await sleep(2);
  const dry = of.vab('verdict');
  const dryRep = of.vab('report');
  check('a bare engine has a TWR well above 1', dry.liftTwr > 1,
        `${dry.liftTwr}`);
  check('and no propellant at all', dryRep.stages[0] !== undefined
        && dryRep.stages[0].propellantKg === 0, JSON.stringify(dryRep.stages[0]));
  check('so it is refused as dry-burn, which TWR alone would have missed',
        dry.ok === false && dry.faults.some((f) => f.code === 'dry-burn'),
        JSON.stringify(dry.faults.map((f) => f.code)));
  log.push({ dryBurn: { liftTwr: dry.liftTwr, burnTimeS: dryRep.stages[0].burnTimeS,
                        codes: dry.faults.map((f) => f.code) } });

  // R10c: TWR BELOW 1. Reid lost a cycle to 0.98. Stack tanks on one small
  // engine until /core's OWN pad TWR crosses under 1, then read the verdict.
  await clear();
  await hold('EngineS');
  of.vab('place');
  await sleep(1);
  let piled = 0;
  for (let i = 0; i < 14; ++i) {
    await hold('TankL');
    const tops = nodesOf((n) => n.kind === 'top');
    if (tops.length === 0) break;
    await aimAt(tops[0]);
    const r = of.vab('place');
    if (!r.ok) {
      // The class transition again: an L tank will not sit on a 1.25 m face.
      await hold('TankSLong');
      const t2 = nodesOf((n) => n.kind === 'top');
      if (t2.length === 0) break;
      await aimAt(t2[0]);
      if (!of.vab('place').ok) break;
    }
    piled += 1;
    await sleep(1);
    if (of.vab('verdict').liftTwr < 1) break;
  }
  const heavy = of.vab('verdict');
  const heavyRep = of.vab('report');
  check('a design was piled up until it could not lift', heavy.liftTwr < 1,
        `twr ${heavy.liftTwr} after ${piled} tanks`);
  check('and the fault is named twr-below-1',
        heavy.faults.some((f) => f.code === 'twr-below-1'),
        JSON.stringify(heavy.faults.map((f) => f.code)));
  check('the verdict TWR is the pad TWR core itself reports',
        Math.abs(heavy.liftTwr - heavyRep.stats.padTwr) < 1e-9,
        `${heavy.liftTwr} vs ${heavyRep.stats.padTwr}`);
  check('the drawn band says WILL NOT FLY', of.vab('verdictBand').fault === true,
        JSON.stringify(of.vab('verdictBand')));
  check('and the band NAMES the TWR on screen',
        of.vab('verdictBand').text.includes(heavy.liftTwr.toFixed(2)),
        of.vab('verdictBand').text);
  log.push({ hopeless: { tanks: piled, liftTwr: heavy.liftTwr,
                         padTwr: heavyRep.stats.padTwr,
                         massKg: heavyRep.stats.massKg,
                         band: of.vab('verdictBand').text } });

  // R10d: THE REFUSAL, driven through the button a player presses.
  const before = of.vab('report');
  const first = of.vab('rollout');
  check('the first Roll out press is REFUSED', first.refused === 1 && first.forced === 0,
        JSON.stringify({ refused: first.refused, forced: first.forced }));
  check('the bay is still open after the refusal', first.report.open === true);
  check('and the refusal says what is wrong and how to override',
        first.report.message.includes('TWR')
        && first.report.message.includes('again'), first.report.message);
  check('nothing left the bay', first.report.parts.length === before.parts.length,
        `${first.report.parts.length} vs ${before.parts.length}`);
  check('a second press is armed', first.armed === true, `${first.armed}`);
  log.push({ refusal: first.report.message });

  // --- 4. COMPLAINT 4: the tabbed rail --------------------------------------
  const tabs = of.vab('tabs');
  check('the parts rail is tabbed', Array.isArray(tabs.tabs) && tabs.tabs.length >= 5,
        JSON.stringify(tabs.tabs));
  check('one tab is active', typeof tabs.active === 'string' && tabs.active !== '',
        `${tabs.active}`);
  check('the rail shows ONE group, not all 24 rows',
        tabs.rowsShown > 0 && tabs.rowsShown < tabs.rowsTotal,
        `${tabs.rowsShown} of ${tabs.rowsTotal}`);
  // THE AXIS WAS MISDIAGNOSED AND THE MEASUREMENT SAID SO. Reid said horizontal;
  // with the CSS fix removed the list still measured 0 px of sideways overflow
  // at 1600, 900 and 760 px of window, because its rows are block-level at
  // width 100% inside an `overflow-y: auto` column. What overflowed was the
  // OTHER axis: the nine tab lists sum to 6237 px of content in a 693 px rail.
  // Both axes are asserted, so neither claim can quietly become the other.
  check('the list cannot scroll sideways', tabs.overflowPx <= 0,
        `overflow ${tabs.overflowPx} px (scroll ${tabs.listScrollWidth}, `
        + `client ${tabs.listClientWidth})`);
  check('no row is wider than the list it sits in',
        tabs.widestRowPx <= tabs.listClientWidth,
        `widest row ${tabs.widestRowPx} px in ${tabs.listClientWidth} px`);
  check('and the bottom bar still fits after gaining a button',
        tabs.barOverflowPx <= 0, `${tabs.barOverflowPx} px`);
  // Every tab is REACHABLE and every one paints rows: a tab that opens to an
  // empty list is the horizontal-scroll complaint replaced by a blank one.
  const perTab = [];
  for (const g of tabs.tabs) {
    const t = of.vab('tab', g);
    perTab.push({ g, active: t.active, rows: t.rowsShown, overflow: t.overflowPx,
                  scrollPx: t.scrollPx, contentPx: t.listScrollHeight });
    check(`tab ${g} activates`, t.active === g, `${t.active}`);
    check(`tab ${g} has rows`, t.rowsShown > 0, `${t.rowsShown}`);
    check(`tab ${g} does not overflow sideways`, t.overflowPx <= 0, `${t.overflowPx}`);
    // The real complaint: a group you have to scroll to read is the list Reid
    // was already scrolling. Every tab must FIT.
    check(`tab ${g} needs no scrolling at all`, t.scrollPx <= 0,
          `${t.scrollPx} px of content past a ${t.listClientHeight} px rail`);
  }
  const sum = perTab.reduce((a, t) => a + t.rows, 0);
  check('the tabs partition the catalogue exactly', sum === tabs.rowsTotal,
        `${sum} rows across ${perTab.length} tabs, catalogue ${tabs.rowsTotal}`);
  log.push({ tabs: perTab, railPx: tabs.railClientWidth,
             railHeightPx: tabs.listClientHeight,
             untabbedColumnPx: perTab.reduce((a, t) => a + t.contentPx, 0) });

  // --- R11: the recover button ---------------------------------------------
  const recEl = of.vab('recoverBtn');
  check('the bay has a Clear pad control', recEl.error === undefined,
        JSON.stringify(recEl.error));
  check('and it answers in the BAY, which is the only visible surface',
        recEl.report !== undefined && recEl.report.message !== '',
        JSON.stringify(recEl.report && recEl.report.message));
  log.push({ recover: recEl.report === undefined ? null : recEl.report.message });

  // --- R10e: THE OVERRIDE, and it is the half that stops this being a cage ---
  // Last, because a forced roll-out really does leave the bay and put a rocket
  // on the pad, which is the point: the guard yields to an intention.
  await clear();
  await hold('EngineS');
  of.vab('place');
  await sleep(1);
  for (let i = 0; i < 14; ++i) {
    await hold('TankSLong');
    const t = nodesOf((n) => n.kind === 'top');
    if (t.length === 0) break;
    await aimAt(t[0]);
    if (!of.vab('place').ok) break;
    await sleep(1);
    if (of.vab('verdict').liftTwr < 1) break;
  }
  check('a second hopeless design was built', of.vab('verdict').ok === false,
        JSON.stringify(of.vab('verdict').faults.map((f) => f.code)));
  const p1 = of.vab('rollout');
  check('press one is refused again', p1.report.open === true
        && p1.forced === 0, JSON.stringify({ open: p1.report.open, forced: p1.forced }));
  const p2 = of.vab('rollout');
  check('press two launches it anyway', p2.forced === 1, `${p2.forced}`);
  check('and the bay is closed behind it', p2.report.open === false,
        `${p2.report.open}`);
  log.push({ override: { refused: p2.refused, forced: p2.forced,
                         bayOpen: p2.report.open } });

  return {
    valid: fails.length === 0,
    fails,
    log,
    note: 'GP-115 near-miss refusals, GP-116 the pylon, GP-118 the pre-flight '
      + 'verdict with GP-73 as its negative control, GP-120 tabs, GP-121 recover',
  };
})()
