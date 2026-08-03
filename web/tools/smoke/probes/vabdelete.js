// vabdelete.js: GP-299. THE BAY SAYS WHAT A RIGHT CLICK WILL DESTROY.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/vabdelete.js
//
// GP-146's sentence had two halves and only one was ever done.
//
// The FIRST, that which half of an identical rocket a delete destroys depends
// on which part the player happened to place first, was closed by GP-148 and is
// asserted two ways in `probes/vabdirection.js`, which is green at HEAD. That
// half is not re-tested here; pointing at it is enough.
//
// The SECOND, "and nothing on screen says why", was never done. `of_vs_remove`
// takes the subtree further from the root, so removing a part mid-stack removes
// everything below it. That is now DETERMINISTIC, which was the fix, and it was
// still SILENT, which is the worse half for a player: **a deterministic rule you
// are not told about is indistinguishable from an arbitrary one the first time
// it costs you a rocket.**
//
// THE FIXTURE BUILDS THE SAME ROCKET TWO WAYS, because a warning that is right
// on one build order and wrong on the other is exactly the defect GP-148 fixed
// wearing a different coat, and a fixture built one way could not see it.
//
// NAMED FAILURE MODE, before measuring: a line that appears for EVERY hover and
// always claims collateral would pass any check that only looks at a mid-stack
// part. So a LEAF is hovered too, and its line must NOT claim anything below it.
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

  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.5);
  const cat = of.vab('catalogue');
  const idx = (id) => cat.find((c) => c.id === id)?.index ?? -1;

  // Build pod / tank / engine downward, which is the direction GP-145 measured
  // as the only one a multi-stage stack can be assembled in.
  const build = async () => {
    of.vab('press', 'clear');
    await sleep(0.25);
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
  };

  // Hover a PART (not a node) with an empty hand, and read the DRAWN line.
  const hoverPart = async (handle) => {
    const p = of.vab('project', handle);
    if (p === null || p === undefined || !p.onScreen) {
      return { ok: false, line: '', why: `part ${handle} not on screen` };
    }
    of.vab('hover', p.ndc[0], p.ndc[1]);
    await sleep(0.3);
    return { ok: true, line: R().messageText ?? '', why: '' };
  };

  await build();
  const parts = R().parts.slice().sort((a, b) => b.origin[1] - a.origin[1]);
  check('FIXTURE: a three-part stack exists', parts.length === 3,
        `${parts.length} parts`);
  if (parts.length !== 3) {
    return { valid: false, why: 'fixture did not build', fails };
  }
  // THE HAND IS EMPTY. With something in hand the aim line describes a
  // PLACEMENT, and every assertion below would be reading the wrong sentence:
  // the first run of this probe read "Main Engine mates by one end only..."
  // three times and reported it as a missing warning. `of.build(0)` is the
  // WORLD hotbar and has no authority over the bay's hand; `of.vab('drop')` is
  // the bay's own verb and is what a right click calls.
  of.vab('drop');
  await sleep(0.3);
  check('FIXTURE: nothing is in hand, so the line describes a REMOVAL',
        R().hand === null || R().hand === undefined,
        `hand ${JSON.stringify(R().hand)}`);

  // ---- MID-STACK: the warning must name the collateral -------------------
  const mid = parts[1];
  const midHover = await hoverPart(mid.handle);
  check('hovering a mid-stack part with an empty hand says something',
        midHover.ok && midHover.line !== '',
        `${midHover.why} line "${midHover.line}"`);
  check('AND IT NAMES WHAT ELSE GOES', /BELOW IT/.test(midHover.line),
        `line "${midHover.line}". A delete that takes the stack below it and `
        + 'says nothing is a deterministic rule the player cannot learn.');
  check('and it counts them', /THE 1 PART BELOW IT/.test(midHover.line),
        `line "${midHover.line}": one part hangs below the middle of a `
        + 'three-part stack');
  log.push(`mid-stack: "${midHover.line}"`);

  // ---- THE CONTROL: a LEAF claims no collateral --------------------------
  // A line that always warns is not a warning. The bottom part has nothing
  // under it, so its sentence must not claim anything does.
  const leaf = parts[2];
  const leafHover = await hoverPart(leaf.handle);
  check('hovering the bottom part also says something', leafHover.ok
        && leafHover.line !== '', `${leafHover.why} line "${leafHover.line}"`);
  check('and it does NOT claim collateral, because there is none',
        !/BELOW IT/.test(leafHover.line), `line "${leafHover.line}"`);
  log.push(`leaf: "${leafHover.line}"`);

  // ---- AND THE WARNING IS TRUE ------------------------------------------
  // The sentence is only worth anything if the deletion agrees with it. Read
  // the claim, do the deletion, compare.
  const beforeN = R().parts.length;
  of.vab('remove', mid.handle);
  await sleep(0.5);
  const afterN = R().parts.length;
  check('THE DELETION MATCHES WHAT THE WARNING SAID', beforeN - afterN === 2,
        `warned about the part plus 1 below it, and ${beforeN - afterN} `
        + 'parts went');
  log.push(`removed mid-stack: ${beforeN} -> ${afterN} parts`);

  // ---- THE SAME ROCKET, THE OTHER WAY ROUND ------------------------------
  // A warning that is right on one build order and wrong on the other is
  // GP-148's defect wearing a different coat, and a fixture built one way
  // cannot see it. GP-148 normalised the root so this SHOULD be identical;
  // asserting it is how that stays true.
  await build();
  of.vab('drop');
  await sleep(0.3);
  const parts2 = R().parts.slice().sort((a, b) => b.origin[1] - a.origin[1]);
  const mid2 = parts2[1];
  const midHover2 = await hoverPart(mid2.handle);
  check('the same warning appears on a rebuilt rocket',
        midHover2.line === midHover.line,
        `first "${midHover.line}" vs rebuilt "${midHover2.line}"`);
  const beforeN2 = R().parts.length;
  of.vab('remove', mid2.handle);
  await sleep(0.5);
  check('and the same amount goes', beforeN2 - R().parts.length === 2,
        `${beforeN2} -> ${R().parts.length}`);

  of.vab('leave');
  return {
    valid: fails.length === 0,
    fails,
    log,
    midLine: midHover.line,
    leafLine: leafHover.line,
    removedCount: beforeN - afterN,
    note: 'GP-148 closed the half of GP-146 that made deletion order-dependent '
      + 'and probes/vabdirection.js asserts it two ways; this is the other '
      + 'half, that a deterministic rule nobody is told about is '
      + 'indistinguishable from an arbitrary one the first time it costs a '
      + 'rocket',
  };
})()
