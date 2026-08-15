// What a swing is actually worth, in the browser, per kind.
//
// TWO DIFFERENT CLAIMS, because there are now two different things to swing at
// and one number cannot describe both.
//
//   A TREE is a thing you FELL. gameplay.h S.2a authors swings-to-clear (6 bare,
//   3 with the axe) and derives the yield from the node's own size, so a tree is
//   a handful of swings and then it is gone.
//
//   AN ORE PATCH is a PLACE. It holds thousands of units (deposits.h S.P), so
//   the same pacing would hand over six hundred ore in one swing. The authored
//   numbers there are the yields themselves: 3 bare, 9 with the pickaxe. A
//   deposit is not something you clear by hand; it is somewhere you come back to
//   with a drill, and the hand is the bootstrap rather than the method.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/balance.js
//
// THE BOOTSTRAP IS THE POINT OF BOTH. GP-506 prices both tools at Stone x2 +
// Wood x1, so the bare tree swing and the bare swings at each ore kind below
// (one of which is Stone) buy the whole toolset with a little topping up.
// That is tested here rather than asserted, because a drill is the thing you
// cannot build until you have mined by hand.
//
// It does NOT drive the swing animation: probes/impact.js proves the swing, the
// impact frame and the feedback. This one is about the numbers.
(async () => {
  const of = window.__of;
  await of.run(0.5);
  const ORE = { rock: 1, coal: 2, iron: 3, copper: 4 };
  const patchOf = (i) => of.game().ore.list.find((p) => p.index === i);
  // Which patch an outcrop belongs to, by the pool it reports. An outcrop is a
  // VIEW of its patch, so the two numbers are the same number.
  const patchUnder = (n) => of.game().ore.list.find(
    (p) => Math.abs(p.remaining - n.remaining) < 0.51 && p.kind === n.kind);

  const swingAt = (n) => {
    of.harvest(n.index);
    return of.game().interact.last;
  };

  // --- the tree: a handful of swings, bare handed --------------------------
  const t0 = of.nodes().find((x) => x.kind === 0 && x.remaining === x.initial);
  if (t0 === undefined) return { fail: 'no untouched tree in the clearing' };
  const treeBare = swingAt(t0);
  const tree = {
    bare: {
      initial: +t0.initial.toFixed(2), perSwing: treeBare.granted,
      usedTool: treeBare.usedTool,
      swingsToClear: Math.ceil(t0.initial / Math.max(1, treeBare.granted)),
    },
  };

  // --- the ore: a fixed pull out of a large pool ---------------------------
  const bare = {};
  for (const [name, kind] of Object.entries(ORE)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining > 50);
    if (n === undefined) continue;
    const p = patchUnder(n);
    const before = p === undefined ? null : p.remaining;
    const r = swingAt(n);
    const after = p === undefined ? null : patchOf(p.index).remaining;
    bare[name] = {
      perSwing: r.granted, usedTool: r.usedTool,
      patchInitial: p === undefined ? null : Math.round(p.initial),
      // CONSERVATION, per kind: what the player kept came out of the patch.
      // GP-905 to GP-919: MEASURED, NOT WEAKENED. `rock` (Stone) conserves
      // correctly (patchFell === perSwing), but coal/iron/copper reliably
      // show `patchFell === 0` while `perSwing` still grants 3: `patchUnder`
      // uniquely identifies the right patch by `remaining` (confirmed, one
      // candidate every time) and it does not move. Traced one level down:
      // `of_gp_node_harvest` (of_core_api.cpp) only deducts from a patch's
      // own pool when `patchOfNode(i)` finds `g_gpNodePatch[i]` set; when it
      // is not set the call falls through to the node-only `harvestNode`
      // path, which still grants ore but touches no patch. That the SAME
      // check passes for `rock` and fails identically for the other three
      // every run says this is not this probe's own arithmetic. Recorded as
      // a candidate conservation defect for factory-sim/gameplay (see the
      // controller log), not fixed here: fixing it means finding why only
      // the rock outcrop's node index is linked into `g_gpNodePatch`, which
      // is core C++ content this lane does not own.
      patchFell: before === null ? null : +(before - after).toFixed(3),
    };
  }

  // GP-905 to GP-919: TOP UP STONE BEFORE CRAFTING. GP-506 moved BOTH tools
  // off RawIron and onto Stone x2 + Wood x1 each, so the bootstrap needs
  // 4 Stone + 2 Wood total, not the 1 iron + 1 wood this file's own header
  // still describes (stale since GP-506, the same class the furnace-cluster
  // lane found in controls.js/machinepanel.js/machineshot.js). The ONE bare
  // swing at the rock outcrop above grants 3 Stone, which covers the
  // pickaxe's 2 and leaves 1, one short of the axe's 2. Extra bare swings on
  // the same outcrop, not counted toward `bare.rock` (that measurement is
  // already taken above), are exactly what a player who hit this shortfall
  // would do.
  const held = (name) =>
    (of.game().carried.find((c) => c.name === name) ?? { count: 0 }).count;
  for (let guard = 0; guard < 8 && held('Stone') < 4; ++guard) {
    const n = of.nodes().find((x) => x.kind === ORE.rock && x.remaining > 50);
    if (n === undefined) break;
    swingAt(n);
  }

  const madePick = of.craft(0);
  const madeAxe = of.craft(1);

  const tooled = {};
  for (const [name, kind] of Object.entries(ORE)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining > 50);
    if (n === undefined) continue;
    const r = swingAt(n);
    tooled[name] = { perSwing: r.granted, usedTool: r.usedTool };
  }
  const t1 = of.nodes().find((x) => x.kind === 0 && x.remaining === x.initial);
  const treeTooled = t1 === undefined ? null : swingAt(t1);
  if (t1 !== undefined && treeTooled !== null) {
    tree.tooled = {
      initial: +t1.initial.toFixed(2), perSwing: treeTooled.granted,
      usedTool: treeTooled.usedTool,
      swingsToClear: Math.ceil(t1.initial / Math.max(1, treeTooled.granted)),
    };
  }

  const kinds = Object.keys(tooled);
  return {
    madePick, madeAxe, tree, bare, tooled,
    // The bootstrap: the two bare swings above paid for both tools.
    bootstrap: madePick && madeAxe,
    // A tree is a handful of swings and the axe halves it.
    treeIsAHandful: tree.bare.perSwing > 0
      && tree.bare.swingsToClear >= 4 && tree.bare.swingsToClear <= 6
      && tree.tooled !== undefined && tree.tooled.usedTool === true
      && tree.tooled.swingsToClear <= 3,
    // A deposit pays a fixed pull out of one pool, the pickaxe triples it, and
    // the pool falls by exactly what was kept.
    oreIsAPlaceNotAPebble: kinds.length >= 3
      && kinds.every((k) => bare[k].perSwing > 0 && bare[k].usedTool === false
        && bare[k].patchInitial > 500
        && Math.abs(bare[k].patchFell - bare[k].perSwing) < 0.01
        && tooled[k].usedTool === true
        && tooled[k].perSwing >= 3 * bare[k].perSwing),
    valid: madePick && madeAxe && kinds.length >= 3
      && tree.bare.swingsToClear >= 4 && tree.bare.swingsToClear <= 6
      && tree.tooled !== undefined && tree.tooled.swingsToClear <= 3
      && kinds.every((k) => bare[k].perSwing > 0 && bare[k].usedTool === false
        && Math.abs(bare[k].patchFell - bare[k].perSwing) < 0.01
        && tooled[k].perSwing >= 3 * bare[k].perSwing),
    carried: of.game().carried,
  };
})()
