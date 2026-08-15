// noderegrow.js (CE-70 to CE-74, core-engine R-BODY-2 playability half):
// A HARVESTED ROCK OR TREE STAYS HARVESTED WHEN ITS CELL STREAMS BACK IN.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4431/ --sandbox=1 \
//     --scenario=walk --settle=10 --width=320 --height=180 \
//     --evalfile=tools/smoke/probes/noderegrow.js
//
// -----------------------------------------------------------------------------
// THE DEFECT, MEASURED BY THIS FILE'S OWN FIXTURE ON THE UNFIXED BUILD, AND IT
// IS NOT THE DEFECT THE LANE WAS BRIEFED WITH.
//
// The brief (persistence's PS-49..52 row) said an IN-PAGE BODY ROUND TRIP
// regrows the world's rocks and trees. The mechanism it named is right; the
// trigger is wrong. Verbatim from the red run, one body, NO `reboot` anywhere:
//
//   chopped:            idx 412 9.91/24.91, idx 411 13.89/28.89, idx 394 18.77/39.77
//   3 km away:          all three ABSENT (their cells left the ring)
//   back on that spot:  idx 1840 24.91/24.91, idx 1839 28.89/28.89, idx 1822 39.77/39.77
//
// and the body round trip in the same run is that reading once more (idx 2240,
// 2239, 2222, all full). `TREE_RADIUS_M` is 620 m, so **the case a player
// actually hits is walking away from a tree they chopped**, and the body switch
// is only the largest possible stream-out. On the fixed build the same three
// cells read `idx 1840 9.91/24.91, idx 1839 13.89/28.89, idx 1822 18.77/39.77`
// -- the SAME fresh indices, so nothing about which nodes get created moved.
//
// -----------------------------------------------------------------------------
// WHY "STILL DRAINED WHEN I COME BACK" IS NOT ENOUGH TO ASSERT, AND WHAT IS.
//
// A node that never left the ring is still drained too, so that check alone is
// green on a build with no streaming at all -- and green on a run whose walk
// was too short. This file therefore asserts the WHOLE round trip, in order:
//
//   the mark is ABSENT at 3 km      (its cell really did stream out)
//   it is PRESENT again at home     (its cell really did stream back in)
//   AT A DIFFERENT /core INDEX      (it really was re-materialised, not kept)
//   with `remaining` EXACTLY what the player left, and `initial` unmoved
//
// The third line is the one that makes the fourth mean something. Drop it and a
// build that simply stopped streaming cells out would pass every other check.
//
// -----------------------------------------------------------------------------
// THE NEGATIVE CONTROL IS INSIDE THE SAME READING AND COSTS NOTHING.
//
// `NodeField.populate` lays the spawn clearing's own nodes and they never
// stream out. Chopping some of those alongside the streamed ones gives, in one
// run: nodes that must keep their index and stay drained (the harvest itself
// worked) beside nodes that must change index and stay drained (the fix works).
// A build that re-drained indiscriminately, or one where the harvest never
// landed, fails one of the two. The classification is MEASURED at 3 km (absent
// = streamed, present = clearing) rather than guessed from an index range.
//
// -----------------------------------------------------------------------------
// TWO HARNESS TRAPS THIS FILE ALREADY PAID FOR, BOTH RED ON A CORRECT BUILD.
//
//  1. `of.teleport(lat, lon, alt)` MOVES THE OBSERVER, NOT THE WALKER.
//     `RockField.update` and `TreeField.update` take the WALKER'S FEET. A
//     teleport-only round trip leaves the rings scanning from wherever the feet
//     still are, every mark reads ABSENT on the way home, and it looks exactly
//     like a world that failed to stream. `of.standAt(x, y, z)` (PH-90) is the
//     verb that moves the feet.
//  2. A ROUND TRIP THAT DOES NOT RETURN TO THE SAME GROUND CANNOT TELL "REGREW"
//     FROM "NEVER CAME BACK". The first draft went home with
//     `of.teleport(0, 0, 0)`, which is 1,159 km from the spawn, and every mark
//     read ABSENT. Home here is a MARKED NODE'S OWN BODY-FRAME POSITION, which
//     is also the only identity that survives a re-place at a new /core index
//     (a node's position is a pure function of (seed, cell, k); its index is
//     assigned in visit order).
//
// -----------------------------------------------------------------------------
// THE ONE BOUND IN THIS FILE THAT IS NOT AN EXACT EQUALITY, AND WHY.
//
// `remaining` comes back a WHISKER low, and the first draft asserted exact
// equality and went red on the correct build for it:
//
//   9.909327030181885  -> 9.909326553344727    (4.76837158203125e-7 low)
//   18.765465259552002 -> 18.765464782714844   (the same 4.768e-7, exactly)
//   13.89078140258789  -> 13.89078140258789    (exact)
//
// A constant absolute crumb of 2^-21 on two of three marks is not arithmetic
// drift, it is a QUANTISATION, and it is one line in the WASM shim:
// `of_gp_node_drain` ends `n.RemainingAmount = static_cast<float>(...)` on a
// comment that says "`RemainingAmount` is a float". It is a **double**
// (`core/include/of/deposits.h:70`). The cast is a stale belief and it costs
// single precision on every drain. That is PRE-EXISTING and not this lane's to
// change: `restore()` has always re-drained through the same call, so a
// reloaded save has carried exactly this fidelity since it shipped, and the
// numeric behaviour of a shipped path is not something a playability lane
// should move on its own. Recorded and routed instead.
//
// So the amount is asserted to within ONE FLOAT32 ULP OF ITSELF, a bound taken
// from the cause rather than from the observed error. The headroom against the
// defect is six orders of magnitude: a regrow moves this node by 15.0 and the
// bound is 1.2e-6. Everything that IS exact is still asserted exactly --
// `initial`, the clearing control's amount, and the index changing.
//
// Standing rule 11: every other bound below is an exact equality against a
// number read off the client earlier in the same run, or a strict inequality
// whose direction is the defect. Nothing was tuned to make a run pass.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['world', 'run', 'nodes', 'harvest', 'standAt', 'reboot',
                   'game', 'save', 'teleport']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const RENDER_HZ = 12;                      // GP-726 / discbody.js's reason.
  const run = (s) => of.run(s, RENDER_HZ);
  const FORGE_R = 600000;
  const CINDER_R = 200000;

  /** The node standing at a body-frame point, or null. Position IS identity. */
  const at = (p) => (of.nodes() ?? []).find(
    (n) => Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) < 0.5) ?? null;
  const show = (n) => n === null ? 'ABSENT'
    : `idx ${n.index} ${n.remaining}/${n.initial}`;
  /** The two fields' own counters, summed: what the fix says it did. */
  const prevented = () => (of.game()?.rocks?.regrowsPrevented ?? 0)
    + (of.game()?.trees?.regrowsPrevented ?? 0);
  /** One float32 ulp of `v`, the quantum `of_gp_node_drain`'s cast imposes. */
  const ULP32 = (v) => Math.max(1, Math.abs(v)) * 1.2e-7;
  /** Worst |carried - left| seen, so the next reader inherits a number. */
  let worstDrift = 0;
  /** Did this mark come back as the player left it? Returns the complaint. */
  const carried = (m) => {
    const n = at(m);
    if (n === null) return `${m.name}@${m.distM.toFixed(0)}m ABSENT`;
    if (n.initial !== m.initial) {
      return `${m.name} initial ${m.initial} -> ${n.initial}`;
    }
    const d = Math.abs(n.remaining - m.remaining);
    if (d > worstDrift) worstDrift = d;
    if (d > ULP32(m.remaining)) {
      return `${m.name} idx${m.index}->${n.index} ${m.remaining} -> `
        + `${n.remaining} (off by ${d}, bound ${ULP32(m.remaining)})`;
    }
    if (!(n.remaining < n.initial)) {
      return `${m.name} idx${n.index} is back at FULL ${n.remaining}`;
    }
    return null;
  };

  await run(3.0);

  // ===========================================================================
  // §0 - PRECONDITIONS. DW-20: nothing below is believed until these are.
  // ===========================================================================
  check('§0 this run is SANDBOX', of.game()?.mode?.sandbox === true,
    JSON.stringify(of.game()?.mode ?? null));
  check('§0 the world boots on Forge', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  check('§0 the counter this file asserts on exists and starts at zero',
    prevented() === 0, `${prevented()}`);
  check('§0 there are nodes to chop at all', (of.nodes() ?? []).length > 0,
    `${(of.nodes() ?? []).length}`);

  // ===========================================================================
  // §1 - CHOP. Six nearest, three swings each; keep every one that drained.
  // ===========================================================================
  const marks = [];
  for (const n of (of.nodes() ?? []).slice(0, 6)) {
    for (let k = 0; k < 3; ++k) of.harvest(n.index);
    const after = at(n);
    if (after !== null && after.remaining < after.initial) {
      marks.push({ x: n.x, y: n.y, z: n.z, index: after.index,
        remaining: after.remaining, initial: after.initial, name: n.name,
        distM: n.distanceM });
    }
  }
  log.push(`§1 chopped ${marks.length}: ${marks.map(
    (m) => `${m.name}@${m.distM.toFixed(0)}m idx${m.index} `
      + `${m.remaining.toFixed(2)}/${m.initial.toFixed(2)}`).join(', ')}`);
  if (marks.length < 3) {
    return { valid: false, fails, log,
      why: `only ${marks.length} nodes drained; this file needs at least two `
        + 'STREAMED and one CLEARING node to say anything' };
  }
  // Nothing has re-materialised yet, so the fix must not have fired. A build
  // that re-drained on FIRST placement would be caught here rather than
  // silently satisfying every check below.
  check('§1 and no re-drain has happened yet, because nothing has streamed '
    + 'back in', prevented() === 0, `${prevented()}`);

  // ===========================================================================
  // §2 - 3 km OUT. Which marks are STREAMED is MEASURED here, not assumed.
  // ===========================================================================
  const home = marks[0];
  const R = Math.hypot(home.x, home.y, home.z);
  const a = 3000 / R, ca = Math.cos(a), sa = Math.sin(a);
  const awayPt = { x: home.x * ca - home.z * sa, y: home.y,
    z: home.x * sa + home.z * ca };
  of.standAt(awayPt.x, awayPt.y, awayPt.z);
  await run(4.0);
  for (const m of marks) m.streamed = at(m) === null;
  const streamed = marks.filter((m) => m.streamed);
  const clearing = marks.filter((m) => !m.streamed);
  log.push(`§2 at 3 km: ${marks.map((m) => show(at(m))).join(' | ')}`);
  log.push(`§2 ${streamed.length} streamed (left the ring), `
    + `${clearing.length} clearing (never do)`);
  if (streamed.length < 2 || clearing.length < 1) {
    return { valid: false, fails, log,
      why: `the fixture is ${streamed.length} streamed / ${clearing.length} `
        + 'clearing; this file needs at least 2 and 1' };
  }

  // ===========================================================================
  // §3 - HOME, SAME BODY, NO REBOOT. THE CLAIM.
  // ===========================================================================
  of.standAt(home.x, home.y, home.z);
  await run(6.0);
  const backA = marks.map((m) => at(m));
  log.push(`§3 home, same body: ${backA.map(show).join(' | ')}`);
  const gone = streamed.filter((m) => at(m) === null);
  check('§3 every streamed mark came back at all', gone.length === 0,
    `${gone.length} of ${streamed.length} still absent`);
  const kept = streamed.filter((m) => {
    const n = at(m);
    return n !== null && n.index === m.index;
  });
  check('§3 and it was RE-MATERIALISED, at a new /core index -- which is what '
    + 'makes the amount below a real claim', kept.length === 0,
    `${kept.length} of ${streamed.length} kept their old index`);
  const wrong = streamed.map(carried).filter((s) => s !== null);
  check('§3 THE CLAIM: a chopped node comes back chopped, to the amount the '
    + 'player left (within one float32 ulp), with its initial unmoved exactly',
    wrong.length === 0, wrong.join('; '));
  // The control, in the same reading: the clearing's own nodes never streamed,
  // so they must have kept BOTH their index and their amount. This is what
  // fails if the harvest never landed, or if something re-drained everything.
  const ctl = clearing.map((m) => {
    const n = at(m);
    if (n === null) return `${m.name} ABSENT`;
    if (n.index !== m.index) return `${m.name} idx ${m.index} -> ${n.index}`;
    if (n.remaining !== m.remaining) {
      return `${m.name} ${m.remaining} -> ${n.remaining}`;
    }
    return null;
  }).filter((s) => s !== null);
  check('§3 CONTROL: the spawn clearing\'s nodes never streamed, so they kept '
    + 'their index AND their amount', ctl.length === 0, ctl.join('; '));
  const prevA = prevented();
  check('§3 and the fields SAY they re-drained, once per streamed mark at '
    + 'least', prevA >= streamed.length,
    `regrowsPrevented ${prevA} against ${streamed.length} streamed marks`);
  log.push(`§3 regrowsPrevented ${prevA}; rocks `
    + `${of.game()?.rocks?.regrowsPrevented}, trees `
    + `${of.game()?.trees?.regrowsPrevented}`);

  // ===========================================================================
  // §4 - AND THE SAVE AGREES, which a live node count cannot show.
  // ===========================================================================
  // `serialize()` walks `known` and emits a row per node below full. Before the
  // fix a regrow left `known[key]` pointing at the fresh FULL node, so no row
  // was emitted and the next autosave agreed the tree had never been chopped.
  const saved = await of.save();
  const rows = (saved?.rocks ?? 0) + (saved?.trees ?? 0);
  check('§4 the depletion diff still carries the streamed marks after the '
    + 'round trip', rows >= streamed.length,
    `rocks ${saved?.rocks} + trees ${saved?.trees} = ${rows} against `
    + `${streamed.length} streamed marks`);
  log.push(`§4 save: depletion ${saved?.depletion}, rocks ${saved?.rocks}, `
    + `trees ${saved?.trees}`);

  // ===========================================================================
  // §5 - THE BODY ROUND TRIP, which is the brief's own case.
  // ===========================================================================
  let e1 = null;
  try { await of.reboot(1); } catch (e) { e1 = String(e); }
  check('§5 the world rebooted onto the moon', e1 === null, e1 ?? '');
  check('§5 and it really is Cinder', of.world().bodyRadiusM === CINDER_R,
    `${of.world().bodyRadiusM}`);
  of.teleport(0, 0, 0);
  await run(3.0);
  let e0 = null;
  try { await of.reboot(0); } catch (e) { e0 = String(e); }
  check('§5 and back onto the planet', e0 === null && of.world().bodyRadiusM === FORGE_R,
    `${e0 ?? ''} R${of.world().bodyRadiusM}`);
  of.standAt(home.x, home.y, home.z);
  await run(6.0);
  const backB = marks.map((m) => at(m));
  log.push(`§5 home after the body round trip: ${backB.map(show).join(' | ')}`);
  const wrongB = streamed.map(carried).filter((s) => s !== null);
  check('§5 THE BRIEF\'S CASE: after of.reboot(1) and back, every chopped node '
    + 'is still chopped to the amount the player left', wrongB.length === 0,
    wrongB.join('; '));
  const keptB = streamed.filter((m) => {
    const n = at(m);
    return n !== null && n.index === m.index;
  });
  check('§5 and those too were re-materialised at fresh indices',
    keptB.length === 0, `${keptB.length} kept their old index`);
  const ctlB = clearing.filter((m) => {
    const n = at(m);
    return n === null || n.remaining !== m.remaining;
  });
  check('§5 CONTROL: the clearing\'s nodes are still exactly as they were',
    ctlB.length === 0, `${ctlB.length} moved`);
  log.push(`§5 regrowsPrevented ${prevented()} (was ${prevA} before the switch)`);
  log.push(`§5 worst |carried - left| over every mark and both trips: `
    + `${worstDrift} (bound ${ULP32(home.remaining)}, one float32 ulp; a `
    + `regrow would be ${home.initial - home.remaining})`);

  return { valid: fails.length === 0, fails, log, worstDrift,
    marks: marks.map((m) => ({ name: m.name, streamed: m.streamed,
      index: m.index, remaining: m.remaining, initial: m.initial })),
    backA: backA.map((n) => n === null ? null : { index: n.index,
      remaining: n.remaining, initial: n.initial }),
    backB: backB.map((n) => n === null ? null : { index: n.index,
      remaining: n.remaining, initial: n.initial }),
    regrowsPrevented: prevented() };
})()
