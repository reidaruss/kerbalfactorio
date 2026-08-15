// What a swing is actually worth, in the browser, per kind.
//
// THREE DIFFERENT CLAIMS, because there are now three different things a swing
// can be and one number cannot describe them.
//
//   A TREE is a thing you FELL. gameplay.h S.2a authors swings-to-clear (6 bare,
//   3 with the axe) and derives the yield from the node's own size, so a tree is
//   a handful of swings and then it is gone.
//
//   A ROCK OUTCROP is a PLACE you may work BARE-HANDED. Its patch holds
//   thousands of units (deposits.h S.P), so the same pacing would hand over six
//   hundred stone in one swing; the authored numbers there are the yields
//   themselves, 3 bare and 9 with the pickaxe.
//
//   A COAL / IRON / COPPER OUTCROP IS A PLACE YOU MAY NOT TOUCH BARE-HANDED.
//   GP-506 made the tool a GATE rather than a multiplier on those three kinds
//   (gameplay.h `requiresToolFor`), so a bare swing is REFUSED outright with a
//   named code, grants nothing, and leaves the patch exactly where it was.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/balance.js
//
// THE BOOTSTRAP IS THE POINT OF ALL THREE, and the gate is what gives it its
// shape. Storyline rung 2: gather wood, gather loose stones, craft a pickaxe,
// and only THEN mine coal, iron and copper. GP-506 prices both tools at
// Stone x2 + Wood x1, never in ore, so the bare tree swing and the bare rock
// swings below buy the whole toolset and no fresh spawn can deadlock. That is
// tested here rather than asserted, because a drill is the thing you cannot
// build until you have mined by hand.
//
// FS-116, 2026-08-16: THIS FILE USED TO READ THE WRONG NUMBER AND REPORTED A
// CONSERVATION DEFECT THAT DOES NOT EXIST. `swingAt` returned
// `of.game().interact.last`, which `Interact.grant` only writes ON A GRANT. A
// refused swing leaves it holding the PREVIOUS swing's record, so the three
// gated kinds each reported the ROCK swing that ran before them: `perSwing` 3
// and `usedTool` false, three times, identical to rock's because it WAS rock's.
// Against that phantom grant the patch of course did not move, and the file
// published `patchFell: 0` as a candidate defect in /core (recorded in
// factory-sim.md R10 and gameplay.md GP-908, both now corrected). The pack in
// its own report said otherwise the whole time: `Coal 9` after a bare swing of
// "3" and a tooled swing of 9 is one grant, not two. Every swing below now
// reads `of.harvest`'s OWN return value, which carries `ok`, the pack, and the
// refusal for THAT attempt, and the units are the pack delta rather than
// anybody's record of what it meant to hand over.
//
// It does NOT drive the swing animation: probes/impact.js proves the swing, the
// impact frame and the feedback. This one is about the numbers.
(async () => {
  const of = window.__of;
  await of.run(0.5);
  const ORE = { rock: 1, coal: 2, iron: 3, copper: 4 };
  // The three gated kinds, as DATA rather than as three copies of a sentence.
  // Mirrors gameplay.h `requiresToolFor`; a kind moving across that line is
  // meant to move here too, and the two negative controls below are what make
  // a stale copy fail loudly instead of quietly asserting nothing.
  const GATED = ['coal', 'iron', 'copper'];

  const patchOf = (i) => of.game().ore.list.find((p) => p.index === i);
  // Which patch an outcrop belongs to. An outcrop is a VIEW of its patch and
  // one patch per kind is laid out (NodeArt PATCH_KINDS), so the KIND is the
  // whole identification -- and `patchesOfKind` is published beside it so a
  // second patch of one kind appearing later fails this loudly rather than
  // silently measuring whichever one came first.
  const patchesOfKind = (kind) => of.game().ore.list.filter((p) => p.kind === kind);
  const patchUnder = (n) => patchesOfKind(n.kind)[0];

  // ONE SWING, AND WHAT IT WAS ACTUALLY WORTH.
  //
  // `of.harvest` publishes the outcome of THIS attempt: `ok` is /core's own
  // "something was granted", `refusal` is `Interact.lastRefusal`, which
  // `grant()` clears unconditionally before every attempt so it can never
  // describe an older one, and `carried` is the pack afterwards. The units are
  // the TOTAL pack delta: a swing can only add its own resource, so the total
  // needs no item mapping and cannot be fooled by a kind this file has not
  // heard of. `usedTool` is read from `interact.last` ONLY when the swing
  // granted, which is exactly the case in which that record is this swing's.
  const totalHeld = (list) => list.reduce((s, c) => s + c.count, 0);
  const swingAt = (n) => {
    const before = totalHeld(of.game().carried);
    const r = of.harvest(n.index);
    if (r === null) return { ok: false, granted: 0, usedTool: false, refusal: -1 };
    return {
      ok: r.ok,
      granted: totalHeld(r.carried) - before,
      usedTool: r.ok ? (of.game().interact.last?.usedTool ?? false) : false,
      // 0 = nothing refused it, 1 = HarvestRefusal::ToolRequired.
      refusal: r.refusal === null ? 0 : r.refusal.code,
    };
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

  // --- the ore, bare handed: one kind pays, three refuse -------------------
  // CONSERVATION AND THE GATE ARE MEASURED BY THE SAME THREE READINGS, per
  // kind: what the pack gained, what the patch lost, and what /core said about
  // the attempt. A kind that pays must take it out of its patch; a gated kind
  // must grant nothing, be refused BY NAME, and leave the pool untouched.
  const bare = {};
  for (const [name, kind] of Object.entries(ORE)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining > 50);
    if (n === undefined) continue;
    const cand = patchesOfKind(kind);
    const p = cand[0];
    const before = p === undefined ? null : p.remaining;
    const r = swingAt(n);
    const after = p === undefined ? null : patchOf(p.index).remaining;
    bare[name] = {
      perSwing: r.granted, usedTool: r.usedTool, refusal: r.refusal,
      patchesOfKind: cand.length,
      patchInitial: p === undefined ? null : Math.round(p.initial),
      patchFell: before === null ? null : +(before - after).toFixed(3),
    };
  }

  // GP-905 to GP-919: TOP UP STONE BEFORE CRAFTING. GP-506 moved BOTH tools
  // off RawIron and onto Stone x2 + Wood x1 each, so the bootstrap needs
  // 4 Stone + 2 Wood total, not the 1 iron + 1 wood this file's own header
  // once described. The ONE bare swing at the rock outcrop above grants 3
  // Stone, which covers the pickaxe's 2 and leaves 1, one short of the axe's
  // 2. Extra bare swings on the same outcrop, not counted toward `bare.rock`
  // (that measurement is already taken above), are exactly what a player who
  // hit this shortfall would do -- and the fact that they are possible at all
  // is the bootstrap: stone is one of the two kinds the gate lets through.
  const held = (name) =>
    (of.game().carried.find((c) => c.name === name) ?? { count: 0 }).count;
  for (let guard = 0; guard < 8 && held('Stone') < 4; ++guard) {
    const n = of.nodes().find((x) => x.kind === ORE.rock && x.remaining > 50);
    if (n === undefined) break;
    swingAt(n);
  }

  const madePick = of.craft(0);
  const madeAxe = of.craft(1);

  // --- the ore, with the pickaxe: every kind pays, and out of its patch ----
  // This is where the conservation claim for the three gated kinds lives now.
  // It could not live in the bare pass, because a refused swing is not a swing
  // that moved nothing: it is a swing that never happened.
  const tooled = {};
  for (const [name, kind] of Object.entries(ORE)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining > 50);
    if (n === undefined) continue;
    const p = patchUnder(n);
    const before = p === undefined ? null : p.remaining;
    const r = swingAt(n);
    const after = p === undefined ? null : patchOf(p.index).remaining;
    tooled[name] = {
      perSwing: r.granted, usedTool: r.usedTool, refusal: r.refusal,
      patchInitial: p === undefined ? null : Math.round(p.initial),
      patchFell: before === null ? null : +(before - after).toFixed(3),
    };
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
  const gated = GATED.filter((k) => bare[k] !== undefined);
  return {
    madePick, madeAxe, tree, bare, tooled,
    // The bootstrap: the bare tree and bare ROCK swings paid for both tools,
    // and neither tool is priced in anything the gate refuses.
    bootstrap: madePick && madeAxe,
    // A tree is a handful of swings and the axe halves it.
    treeIsAHandful: tree.bare.perSwing > 0
      && tree.bare.swingsToClear >= 4 && tree.bare.swingsToClear <= 6
      && tree.tooled !== undefined && tree.tooled.usedTool === true
      && tree.tooled.swingsToClear <= 3,
    // Stone is bare-handed, and what the player kept came out of the patch.
    stoneIsBareHanded: bare.rock !== undefined && bare.rock.perSwing > 0
      && bare.rock.usedTool === false && bare.rock.refusal === 0
      && Math.abs(bare.rock.patchFell - bare.rock.perSwing) < 0.01,
    // GP-506's gate, as the player meets it: a bare hand on coal, iron or
    // copper is refused BY NAME, grants nothing, and costs the patch nothing.
    oreIsGatedBehindTheTool: gated.length === 3
      && gated.every((k) => bare[k].perSwing === 0 && bare[k].refusal === 1
        && bare[k].patchFell === 0),
    // A deposit pays a fixed pull out of one pool, and the pool falls by
    // exactly what was kept. Measured with the tool, which is the only way
    // three of the four kinds can be measured at all.
    oreIsAPlaceNotAPebble: kinds.length >= 3
      && kinds.every((k) => tooled[k].perSwing > 0 && tooled[k].usedTool === true
        && tooled[k].patchInitial > 500
        && bare[k].patchesOfKind === 1
        && Math.abs(tooled[k].patchFell - tooled[k].perSwing) < 0.01),
    // THE PICKAXE TRIPLES THE PULL, and rock is where that is measurable: it
    // is the one patch kind with both a bare number and a tooled one.
    toolTriplesThePull: bare.rock !== undefined && tooled.rock !== undefined
      && tooled.rock.perSwing === 3 * bare.rock.perSwing,
    valid: madePick && madeAxe && kinds.length >= 3 && gated.length === 3
      && tree.bare.swingsToClear >= 4 && tree.bare.swingsToClear <= 6
      && tree.tooled !== undefined && tree.tooled.swingsToClear <= 3
      && bare.rock !== undefined && bare.rock.perSwing > 0
      && bare.rock.usedTool === false
      && Math.abs(bare.rock.patchFell - bare.rock.perSwing) < 0.01
      && gated.every((k) => bare[k].perSwing === 0 && bare[k].refusal === 1
        && bare[k].patchFell === 0)
      && kinds.every((k) => tooled[k].perSwing > 0 && tooled[k].usedTool === true
        && bare[k].patchesOfKind === 1
        && Math.abs(tooled[k].patchFell - tooled[k].perSwing) < 0.01)
      && tooled.rock.perSwing === 3 * bare.rock.perSwing,
    carried: of.game().carried,
  };
})()
