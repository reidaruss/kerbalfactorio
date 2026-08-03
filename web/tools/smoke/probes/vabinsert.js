// vabinsert.js: GP-294. A FIXTURE THAT REVISES.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/vabinsert.js
//
// THE FIXTURE IS THE POINT OF THIS FILE, more than the assertions are.
//
// Reid reported "snapping is broken" and "you can only build bottom-up". Two
// lanes measured the bay, both found something real, both fixed it, and the
// complaint survived both. GP-290 found why: `attachNodes` omits a face the
// moment something is attached to it, so a joint between two parts is not a
// place, and inserting into a finished stack is unrepresentable rather than
// hard. The only route was deleting back to the joint, and `of_vs_remove` takes
// the whole subtree with it.
//
// The reason two correct passes could not see it is the reason this probe
// exists: **every existing VAB fixture builds a rocket ONCE, from nothing, in a
// single pass.** A fixture that never revises cannot exhibit a defect in
// revising. It could not have failed, so it passed forever while the complaint
// stood. That belongs beside the ascent test that straddled its own threshold.
//
// So this one BUILDS AND THEN CHANGES ITS MIND, which is what a player does the
// moment they want an Autopilot Module on a rocket that already exists, and
// that is not a hypothetical: the module is a class-S STACK part, so fitting
// one IS this operation.
//
// WHAT WOULD MAKE IT VACUOUS, named before measuring: if the insert silently
// did nothing, the part count would be unchanged and every downstream check
// would be about the ORIGINAL rocket, which is a perfectly healthy rocket. So
// the count, the parent chain and the stage table are asserted as a DELTA
// against the design captured before the insert, never against a constant.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const R = () => of.vab('report');

  const POD = 0x0100;
  const TANK = 0x0101;
  const ENGINE = 0x0103;
  const AUTOPILOT = 0x010d;

  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.5);
  const cat = of.vab('catalogue');
  const idx = (id) => cat.find((c) => c.id === id)?.index ?? -1;
  check('the Autopilot Module is in the catalogue', idx(AUTOPILOT) >= 0,
        'without it there is nothing to insert and the whole point is moot');

  // ---- PHASE 1: BUILD A ROCKET THE ORDINARY WAY --------------------------
  of.vab('press', 'clear');
  await sleep(0.2);
  for (const pid of [POD, TANK, ENGINE]) {
    const i = idx(pid);
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.15);
    const parts = R().parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.15); continue; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.15);
  }
  await sleep(0.4);
  const before = R();
  check('FIXTURE: a three-part rocket exists', before.parts.length === 3,
        `${before.parts.length} parts`);
  if (before.parts.length !== 3) {
    return { valid: false, why: 'fixture did not build', fails, before };
  }
  const beforeIds = before.parts.map((p) => p.partId);
  const beforeLen = before.stats?.lengthM ?? 0;
  log.push(`built: [${beforeIds.map((i) => '0x' + i.toString(16)).join(', ')}], `
    + `${beforeLen.toFixed(3)} m`);

  // THE FIXTURE'S OWN GUARD (GP-142's rule). The joint being inserted into has
  // to be a REAL joint with a part on each side, or the operation degenerates
  // into an ordinary attach at a free face and proves nothing about insertion.
  // Index 1 is the tank: pod above it, engine below it.
  const b = before.parts[1];
  check('FIXTURE: the target joint has a part on BOTH sides',
        b.parent >= 0 && before.parts.some((q) => q.parent === b.handle),
        'index 1 must be mid-stack; an end joint is a plain attach and would '
        + 'pass without insertion existing at all');

  // ---- PHASE 2: CHANGE YOUR MIND -----------------------------------------
  // Everything that follows is the operation the bay could not represent.
  const ins = of.vab('insert', 1, AUTOPILOT);
  check('the insert was accepted', ins.ok === true, ins.why);
  await sleep(0.5);
  const after = R();

  check('THE PART COUNT WENT UP BY EXACTLY ONE',
        after.parts.length === before.parts.length + 1,
        `${before.parts.length} -> ${after.parts.length}. Unchanged means the `
        + 'splice did nothing and every check below is about the old rocket.');
  const afterIds = after.parts.map((p) => p.partId);
  check('and the arriving part is the Autopilot Module',
        afterIds.filter((i) => i === AUTOPILOT).length === 1,
        `[${afterIds.map((i) => '0x' + i.toString(16)).join(', ')}]`);
  // EVERY ORIGINAL PART SURVIVED. The failure this replaces is deleting back to
  // the joint, so "the rocket is still the rocket" is the claim.
  for (const pid of beforeIds) {
    check(`the original 0x${pid.toString(16)} survived the insert`,
          afterIds.filter((i) => i === pid).length
          === beforeIds.filter((i) => i === pid).length,
          `[${afterIds.map((i) => '0x' + i.toString(16)).join(', ')}]`);
  }

  // ---- THE CHAIN IS INTACT AND THE NEW PART IS IN IT ----------------------
  const ap = after.parts.find((p) => p.partId === AUTOPILOT);
  check('the inserted part is in the tree', ap !== undefined);
  if (ap !== undefined) {
    check('it has a parent, so it is not a second root', ap.parent >= 0,
          `parent ${ap.parent}`);
    const kids = after.parts.filter((q) => q.parent === ap.handle);
    check('AND SOMETHING HANGS FROM IT, which is what makes this an insert '
          + 'rather than an append', kids.length >= 1,
          `${kids.length} children. Zero means it was bolted onto a free face `
          + 'and the stack below it was orphaned or lost.');
  }
  // NOTHING IS ORPHANED. A splice that dropped a parent index leaves a part
  // whose parent handle names nothing, and /core would still draw it.
  const handles = new Set(after.parts.map((p) => p.handle));
  const orphans = after.parts.filter((p) => p.parent >= 0 && !handles.has(p.parent));
  check('no part was orphaned by the reparent', orphans.length === 0,
        JSON.stringify(orphans.map((p) => ({ id: p.partId, parent: p.parent }))));

  // ---- THE ROCKET GOT LONGER BY THE PART THAT ARRIVED ---------------------
  // Asserted as a DELTA and with a direction, not against a literal: the module
  // is 0.30 m and a length that did not move means the tree changed and the
  // geometry did not, which is the shape a bad reparent leaves behind.
  const afterLen = after.stats?.lengthM ?? 0;
  const grew = afterLen - beforeLen;
  check('THE STACK GOT LONGER, by about the height of the part inserted',
        grew > 0.2 && grew < 0.5,
        `${beforeLen.toFixed(3)} -> ${afterLen.toFixed(3)} m, delta `
        + `${grew.toFixed(3)}. The Autopilot Module is 0.30 m.`);

  // ---- THE STAGE TABLE SURVIVED ------------------------------------------
  // The stage lists are INDICES into the same array the splice shifted.
  // Forgetting to remap them does not throw: it moves parts between stages and
  // surfaces on the pad as a rocket that drops the wrong half.
  check('the design still has its stages', (after.stages?.length ?? 0)
        === (before.stages?.length ?? 0),
        `${before.stages?.length} -> ${after.stages?.length}`);
  check('and the pre-flight verdict still has an opinion',
        typeof after.verdict?.ok === 'boolean',
        JSON.stringify(after.verdict));
  log.push(`after: ${after.parts.length} parts, ${afterLen.toFixed(3)} m, `
    + `${after.stages?.length} stages, verdict ok ${after.verdict?.ok}`);

  // ---- THE GESTURE: AIM AT A SEAM AND CLICK ------------------------------
  //
  // Everything above drives `of.vab('insert', ...)`, which is the VERB. That
  // was GP-293 and it is only half of Reid's sentence: he said snapping is
  // broken AND you can only build bottom-up, and those are one cause. The
  // splice fixed the second half. THIS is the first half, and it is the half he
  // can actually see.
  //
  // Driven, not screenshotted. The claim is that a seam is now a place the
  // player can aim at, so the probe hovers the node the bay itself publishes
  // and presses the same button a player presses.
  const seams = of.vab('nodes').filter((n) => n.kind === 'insert');
  check('THE BAY NOW OFFERS SEAMS AS NODES', seams.length > 0,
        `kinds on offer: [${[...new Set(of.vab('nodes').map((n) => n.kind))].join(', ')}]. `
        + 'Zero means attachNodes still omits every occupied face and a player '
        + 'aiming at a joint finds nothing there, which IS the complaint.');
  // AND THEY CARRY BOTH SIDES. An insert node with no child is an attach node
  // wearing a different name, and the splice would have nothing to displace.
  check('and each seam names the part it would displace',
        seams.every((n) => typeof n.child === 'number' && n.child >= 0),
        JSON.stringify(seams.map((n) => ({ k: n.kind, p: n.parent, c: n.child }))));
  const onScreen = seams.filter((n) => n.onScreen);
  check('at least one seam is actually aimable on screen', onScreen.length > 0,
        `${seams.length} seams, ${onScreen.length} on screen`);

  let gestureGrew = 0;
  if (onScreen.length > 0) {
    const partsBefore = R().parts.length;
    const lenBefore = R().stats?.lengthM ?? 0;
    const apIdx = idx(AUTOPILOT);
    of.vab('take', apIdx);
    await sleep(0.25);
    const seam = onScreen[0];
    of.vab('hover', seam.ndc[0], seam.ndc[1]);
    await sleep(0.25);
    // THE SNAP CAUGHT THE SEAM, asserted before the click: if the hover landed
    // on some other node the click below would attach normally and the part
    // count would still go up, which reads exactly like a pass.
    const act = R().snapped;
    check('aiming at a seam SNAPS to it',
          act !== null && act !== undefined && act.kind === 'insert',
          `snapped node is ${act === null || act === undefined ? 'null' : act.kind}`);
    // GP-297. IT READS AS INSERTION BEFORE THE CLICK, which is the whole of the
    // cosmetic half: the arriving part is drawn at the seam either way, so the
    // picture alone cannot say the stack is about to grow. The sentence is read
    // off the DRAWN element (`messageText`, GP-64's rule) and not off the model
    // that produced it.
    const aimText = R().messageText ?? '';
    check('the bay SAYS it is an insert and names what moves',
          /INTO the joint/.test(aimText) && /pushing/.test(aimText),
          `drawn line "${aimText}"`);
    check('and the ghost carries the insert tint rather than the plain valid '
          + 'green', R().ghostInsert === true,
          `ghostInsert ${R().ghostInsert}`);
    of.vab('place');
    await sleep(0.5);
    const partsAfter = R().parts.length;
    gestureGrew = (R().stats?.lengthM ?? 0) - lenBefore;
    check('and clicking there INSERTS through the gesture',
          partsAfter === partsBefore + 1,
          `${partsBefore} -> ${partsAfter} parts`);
    check('the stack grew by the inserted part, not by a part on the end',
          gestureGrew > 0.2 && gestureGrew < 0.5,
          `grew ${gestureGrew.toFixed(3)} m`);
    log.push(`gesture: aimed at a seam, ${partsBefore} -> ${partsAfter} parts, `
      + `grew ${gestureGrew.toFixed(3)} m`);
  }

  // ---- THE REFUSALS, EACH REACHABLE --------------------------------------
  // A gate with no reachable refusing case is decoration, so each is driven.
  // THE CONTROL FOR BOTH CUES. A tint that is on for every ghost and a sentence
  // that appears for every hover say nothing at all, so an ordinary free face is
  // hovered and both must be ABSENT. Without this, the two checks above pass on
  // a build that simply always claims to be inserting.
  const frees = of.vab('nodes').filter((n) => n.kind !== 'insert' && n.onScreen);
  check('there is a free face to use as the control', frees.length > 0,
        'every node on screen is a seam, so the tint and the sentence prove '
        + 'nothing');
  if (frees.length > 0) {
    of.vab('hover', frees[0].ndc[0], frees[0].ndc[1]);
    await sleep(0.35);
    check('a FREE face does not claim to be an insert',
          R().ghostInsert === false
          && !/INTO the joint/.test(R().messageText ?? ''),
          `on a ${frees[0].kind} node: ghostInsert ${R().ghostInsert}, `
          + `drawn "${R().messageText}"`);
  }

  // REBASED ON THE STATE THE GESTURE LEFT, not on `after`. The gesture section
  // above deliberately inserts a SECOND module, so every count from here on is
  // measured against a fresh reading: comparing against a baseline the run has
  // since moved past is how a probe reports a failure that is its own
  // bookkeeping rather than the code's.
  const settled = R();
  const settledParts = settled.parts.length;
  const settledLen = settled.stats?.lengthM ?? 0;
  const rRoot = of.vab('insert', 0, AUTOPILOT);
  check('inserting at the ROOT is refused, because nothing is above it',
        rRoot.ok === false && /top of the stack/i.test(rRoot.why ?? ''),
        JSON.stringify(rRoot));
  const rGone = of.vab('insert', 99, AUTOPILOT);
  check('inserting at a joint that does not exist is refused',
        rGone.ok === false && /no part at that joint/i.test(rGone.why ?? ''),
        JSON.stringify(rGone));
  check('and a refused insert changed nothing',
        R().parts.length === settledParts,
        `${R().parts.length} vs ${settledParts}`);

  // ---- AND IT SURVIVES A ROUND TRIP --------------------------------------
  // The splice rebuilds through `fromJson`, which is the same path a save and
  // load takes, so a design that came out of a splice must go back through it
  // unchanged. GP-142's strap-on slid on exactly this journey.
  const nameSave = 'insert probe';
  // THE REAL SAVE CONTROLS, through the panel's own name box and button.
  // `press` clicks a button by attribute and cannot carry a name, which is why
  // the first version of this saved nothing and the load found nothing: the
  // round trip was asserting against a slot that had never been written.
  of.vab('save', nameSave);
  await sleep(0.6);
  of.vab('press', 'clear');
  await sleep(0.3);
  check('cleared for the round trip', R().parts.length === 0,
        `${R().parts.length}`);
  of.vab('load', nameSave);
  await sleep(0.5);
  const back = R();
  check('the spliced design round-trips through save and load',
        back.parts.length === settledParts,
        `${settledParts} -> ${back.parts.length}`);
  check('and comes back the same length',
        Math.abs((back.stats?.lengthM ?? 0) - settledLen) < 1e-6,
        `${settledLen.toFixed(6)} -> ${(back.stats?.lengthM ?? 0).toFixed(6)} m`);

  of.vab('leave');
  return {
    valid: fails.length === 0,
    fails,
    log,
    beforeParts: beforeIds.map((i) => '0x' + i.toString(16)),
    afterParts: afterIds.map((i) => '0x' + i.toString(16)),
    beforeLenM: beforeLen,
    afterLenM: afterLen,
    grewM: grew,
    roundTripParts: back.parts.length,
    seams: seams.length,
    seamsOnScreen: onScreen.length,
    gestureGrewM: gestureGrew,
    note: 'the fixture is the deliverable: it BUILDS and then CHANGES ITS MIND, '
      + 'because every previous VAB fixture built once from nothing in a single '
      + 'pass and therefore could not exhibit a defect in revising',
  };
})()
