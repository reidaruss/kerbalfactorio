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

  // ---- THE REFUSALS, EACH REACHABLE --------------------------------------
  // A gate with no reachable refusing case is decoration, so each is driven.
  const rRoot = of.vab('insert', 0, AUTOPILOT);
  check('inserting at the ROOT is refused, because nothing is above it',
        rRoot.ok === false && /top of the stack/i.test(rRoot.why ?? ''),
        JSON.stringify(rRoot));
  const rGone = of.vab('insert', 99, AUTOPILOT);
  check('inserting at a joint that does not exist is refused',
        rGone.ok === false && /no part at that joint/i.test(rGone.why ?? ''),
        JSON.stringify(rGone));
  check('and a refused insert changed nothing',
        R().parts.length === after.parts.length,
        `${R().parts.length} vs ${after.parts.length}`);

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
        back.parts.length === after.parts.length,
        `${after.parts.length} -> ${back.parts.length}`);
  check('and comes back the same length',
        Math.abs((back.stats?.lengthM ?? 0) - afterLen) < 1e-6,
        `${afterLen.toFixed(6)} -> ${(back.stats?.lengthM ?? 0).toFixed(6)} m`);

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
    note: 'the fixture is the deliverable: it BUILDS and then CHANGES ITS MIND, '
      + 'because every previous VAB fixture built once from nothing in a single '
      + 'pass and therefore could not exhibit a defect in revising',
  };
})()
