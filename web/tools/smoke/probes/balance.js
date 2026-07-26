// W6 balance probe: what a swing is actually worth, in the browser, per kind.
//
// The pacing lives in gameplay.h (S.2a) and the browser passes 0/0, so this is
// the check that the authored numbers survive the bridge and land on the real
// nodes the clearing generates. It reports the yield and the swings-to-clear
// bare handed and with the matching tool, for every kind in the clearing.
//
// It does NOT drive the swing animation: probes/impact.js is what proves the
// swing, the impact frame and the feedback. This one is about the numbers.
(async () => {
  const of = window.__of;
  await of.run(0.5);
  const KINDS = { tree: 0, rock: 1, coal: 2, iron: 3, copper: 4 };

  // Bare hands first, on a node that is still untouched.
  const bare = {};
  for (const [name, kind] of Object.entries(KINDS)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining === x.initial);
    if (n === undefined) continue;
    // __of.harvest returns {ok, node, carried}; the grant itself is on the
    // interact record, which is the same object the HUD reads.
    of.harvest(n.index);
    const r = of.game().interact.last;
    bare[name] = {
      initial: +n.initial.toFixed(2), perSwing: r.granted, usedTool: r.usedTool,
      swingsToClear: r.granted > 0 ? Math.ceil(n.initial / r.granted) : null,
    };
  }

  // Both tools cost 1 raw iron + 1 wood, and the five bare swings above already
  // paid for them twice over. That is the bootstrap claim, tested rather than
  // asserted: ONE swing at a tree and ONE at an iron node buys the whole
  // toolset, so a player is never more than two swings from an upgrade and
  // there is no deadlock to fall into.
  const madePick = of.craft(0);
  const madeAxe = of.craft(1);

  const tooled = {};
  for (const [name, kind] of Object.entries(KINDS)) {
    const n = of.nodes().find((x) => x.kind === kind && x.remaining === x.initial);
    if (n === undefined) continue;
    // __of.harvest returns {ok, node, carried}; the grant itself is on the
    // interact record, which is the same object the HUD reads.
    of.harvest(n.index);
    const r = of.game().interact.last;
    tooled[name] = {
      initial: +n.initial.toFixed(2), perSwing: r.granted, usedTool: r.usedTool,
      swingsToClear: r.granted > 0 ? Math.ceil(n.initial / r.granted) : null,
    };
  }

  const kinds = Object.keys(tooled);
  return {
    madePick, madeAxe, bare, tooled,
    valid: madePick && madeAxe && kinds.length >= 4
      // Bare hands always work, every node is a handful, and the tool is a real
      // upgrade rather than a rounding error: it at least doubles the pull.
      // The claim is about SWINGS, not about units, and it has to be: the two
      // nodes compared have different grades, so their per-swing yields are not
      // comparable in units at all. Comparing raw yields across nodes is the
      // easiest way to write an assertion that means nothing.
      && kinds.every((k) => bare[k] !== undefined && bare[k].perSwing > 0
        && bare[k].swingsToClear >= 4 && bare[k].swingsToClear <= 6
        && tooled[k].usedTool === true && tooled[k].perSwing > 0
        && tooled[k].swingsToClear <= 3
        && tooled[k].swingsToClear * 2 <= bare[k].swingsToClear + 1
        // ... and about the yield, normalised by the node's own size: one
        // tooled swing takes at least 1.8x the fraction a bare one does.
        && (tooled[k].perSwing / tooled[k].initial)
           >= 1.8 * (bare[k].perSwing / bare[k].initial)),
    carried: of.game().carried,
  };
})()
