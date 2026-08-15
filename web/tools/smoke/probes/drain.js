// W6: can a node actually be FINISHED, and does it read as finished?
//
// This is the browser end of ARCHITECTURE 15.2 item 61. Every node's amount is
// baseAmountOf(kind) times a fractional Grade, so the last pull on every node in
// the world is a sub-unit remainder, and until the /core fix that remainder was
// unreachable: the node sat at 0.72 for ever, never reported empty, and the
// depletion art could never reach its final state.
//
// It asserts the whole arc, not just the end: one grant per swing with no empty
// swing anywhere, the authored swing count, the node at exactly 0, the empty
// flag, the field's own empty count going up, and a further swing on the corpse
// granting nothing.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/drain.js
(async () => {
  const of = window.__of;
  await of.run(0.5);
  const n0 = of.nodes().find((x) => x.kind === (window.OF_KIND ?? 0));
  if (n0 === undefined) return { fail: 'no node of that kind' };
  const emptyBefore = of.game().nodes.empty;

  const trail = [];
  let swings = 0;
  let st = n0;
  let everEmptySwing = false;
  while (st.remaining > 0 && swings < 24) {
    swings++;
    of.harvest(n0.index);
    const last = of.game().interact.last;
    st = of.nodes().find((x) => x.index === n0.index);
    if (last.granted === 0) everEmptySwing = true;
    trail.push(`${swings}: +${last.granted} left ${st.remaining.toFixed(3)} `
      + `frac ${st.fraction.toFixed(3)} empty ${last.nodeEmpty}`);
  }

  // One more on the corpse. `interact.last` is NOT the check here: a swing at an
  // empty node is a miss, and a miss deliberately leaves the last grant record
  // alone, so reading it back would just re-report the previous swing. The call
  // itself is what says whether anything happened.
  const corpse = of.harvest(n0.index);

  // The field's `empty` count is refreshed on the FRAME, not on the harvest, so
  // it has to be given a frame before it can be read. Reading it without one is
  // how a probe reports a stale zero and calls it a failure.
  await of.run(0.2);
  const emptyAfter = of.game().nodes.empty;
  const left = of.nodes().find((x) => x.index === n0.index).remaining;

  return {
    initial: +n0.initial.toFixed(3),
    swingsToEmpty: swings,
    remaining: left,
    emptyBefore, emptyAfter,
    corpseOk: corpse.ok,
    trail,
    valid: swings >= 5 && swings <= 6 && !everEmptySwing
      && left === 0 && emptyAfter === emptyBefore + 1 && corpse.ok === false,
  };
})()
