// GP-791. CAN THE GAME REACH A STATE IN WHICH KeyW MOVES NOBODY?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --scenario=walk \
//     --evalfile=tools/smoke/probes/keywmute.js
//
// WHY THIS EXISTS AND WHY IT IS NOT A PERFORMANCE PROBE. `probes/keywfreeze.js`
// measured the reported "~500-frame player-movement freeze on KeyW" as a timing
// event and could not find one: 24,945 frames and 1379.82 m of held KeyW with a
// worst frame of 47.6 ms and 100% of sim time kept. A freeze that leaves no mark
// in frame time, in tick count or in the walker's own blocked flags is not a
// freeze of the LOOP. The remaining shape that fits the words is a freeze of
// MOVEMENT ONLY: the loop runs, the frame rate is fine, and the walk axis is
// muted.
//
// THERE IS EXACTLY ONE THING IN THIS CLIENT THAT DOES THAT, and it is not a bug
// on its own: `Input.setUiCapture(true)` zeroes `fwd`, `right`, `up`, the look
// deltas, jump and use, so every panel in the game deliberately mutes walking
// while it is open. `uiHeld` is a SINGLE BOOLEAN with no reference count and
// eight independent callers (MapMode, MenuBoot x2, VabBoot, GameplayChrome x3,
// ProgressUi), each of which pairs its own true with its own false. A single
// boolean shared by eight owners is the classic shape for a leaked capture, and
// a leaked capture IS a player-movement freeze with a perfect frame rate.
//
// SO THIS PROBE ASKS THE QUESTION DIRECTLY, panel by panel: open it, close it
// through the real path, then hold KeyW and measure METRES. A baseline walk with
// nothing ever opened is the positive control, and the point of it is that a
// zero only means something beside a number that is not zero.
//
// THE NESTED CASE IS THE ONE WORTH THE TROUBLE. `ModalStack.closeTop()` closes
// the TOP modal only, and each panel's own transition then calls
// `setUiCapture(false)` unconditionally. With two panels open, one Escape
// therefore un-mutes while a panel is still up. That direction is the harmless
// one and it is measured here anyway, because the same missing reference count
// is what would produce the harmful direction, and a probe that only looks for
// the fault it expects will not see the one that is there.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const TICKS = A.ticks ?? 60;

  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });
  const posOf = (w) => [w.eyeRel[0] + w.origin.x, w.eyeRel[1] + w.origin.y,
    w.eyeRel[2] + w.origin.z];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
    await yield0();
  };

  // AND THE SAME ADVANCE WITHOUT TOUCHING THE TAPE, which is not a convenience.
  //
  // `Input.playTape` REPLACES whatever is still playing, and `of.escape()` IS a
  // tape (`[{hold:2, actions:['cancel']}, {hold:2, keys:[]}]`) that no tick has
  // consumed yet at the moment it returns. The first version of this probe
  // called `settle()` immediately after `of.escape()`, and `settle()`'s first
  // statement is `of.input.tape([...])`: the Escape was overwritten before a
  // single fixed tick could read it. The run then reported, entirely
  // consistently, that Escape closed NOTHING (openCount 1 -> 1, 2 -> 2, 3 -> 3),
  // that panels accumulated, and that KeyW moved 0.000 m with three panels up.
  // Every one of those numbers was true and every one of them was about this
  // probe. Recorded rather than quietly fixed, because "the key does nothing"
  // and "my harness ate the key" are indistinguishable from the report.
  const advance = async (secs) => { await of.run(secs, 60); await yield0(); };

  /** Hold KeyW for TICKS fixed ticks and return how far the feet went. */
  const walk = async () => {
    const before = of.world();
    of.input.tape([{ hold: TICKS + 30, keys: ['KeyW'] }]);
    await of.run(TICKS / 60, 60);
    await yield0();
    const after = of.world();
    of.input.tape([{ hold: 4, keys: [] }]);
    return {
      m: +dist(posOf(after), posOf(before)).toFixed(3),
      ticks: after.tick - before.tick,
      speedMps: after.player === null ? null : +after.player.speedMps.toFixed(2),
    };
  };

  const modalNames = () => {
    const r = of.modals();
    if (r === null || typeof r !== 'object') return { openCount: null, open: [] };
    return {
      openCount: r.openCount,
      open: (r.modals ?? []).filter((m) => m.open).map((m) => m.name),
    };
  };

  /** Escape until nothing is open, or until it stops making progress. */
  const escapeAll = async (max = 6) => {
    const pressed = [];
    for (let i = 0; i < max; ++i) {
      const before = modalNames().openCount;
      if (before === 0) break;
      of.escape();
      await advance(0.2);
      pressed.push(modalNames().openCount);
      if (modalNames().openCount === before) break;   // no progress, stop
    }
    return pressed;
  };

  await settle(1.0);
  if (of.world().player === null) return { valid: false, why: 'no character' };

  // THE POSITIVE CONTROL, first and last. First so every case below is compared
  // against a number from this same session and this same site; last so a case
  // that permanently broke walking is distinguishable from one that did not.
  const baseline = await walk();

  // Each case: a name, the open verb, the close verb. A verb that this build
  // does not have is REPORTED as absent rather than skipped silently, because a
  // panel that no longer answers to its debug verb is exactly the kind of thing
  // that turns this whole probe green while testing four panels instead of six.
  const cases = [
    { name: 'pack', open: () => of.panel(true), close: () => of.panel(false) },
    { name: 'pack+escape', open: () => of.panel(true), close: null },
    { name: 'pause', open: () => of.pause(true), close: () => of.pause(false) },
    { name: 'pause+escape', open: () => of.pause(true), close: null },
    { name: 'buildMenu', open: () => of.buildMenu(true), close: () => of.buildMenu(false) },
    { name: 'buildMenu+escape', open: () => of.buildMenu(true), close: null },
    // THE NESTED CASE. Two panels up, then ONE Escape, then walk: the state in
    // which `closeTop` has closed one and the other's capture is gone with it.
    {
      name: 'pack-then-pause, one escape',
      open: () => { of.panel(true); of.pause(true); },
      close: 'oneEscape',
    },
    {
      name: 'pause-then-pack, one escape',
      open: () => { of.pause(true); of.panel(true); },
      close: 'oneEscape',
    },
  ];

  const results = [];
  for (const c of cases) {
    let opened = null;
    let err = null;
    try { c.open(); } catch (e) { err = String(e); }
    await settle(0.25);
    opened = modalNames();
    let closedBy = null;
    if (err === null) {
      try {
        if (c.close === null) { closedBy = { escapes: await escapeAll() }; }
        else if (c.close === 'oneEscape') {
          of.escape(); await advance(0.25); closedBy = { escapes: 'exactly one' };
        } else { c.close(); closedBy = { verb: 'own' }; }
      } catch (e) { err = String(e); }
    }
    await settle(0.3);
    const afterClose = modalNames();
    const w = err === null ? await walk() : null;
    results.push({
      case: c.name,
      error: err,
      openedModals: opened,
      closedBy,
      modalsAfterClose: afterClose,
      walkedM: w === null ? null : w.m,
      ticks: w === null ? null : w.ticks,
      // THE VERDICT PER CASE. A quarter of the baseline is the same lenient
      // threshold walkfeel.js uses for a stall: it catches "did not move" and
      // not "moved slightly slower".
      moved: w !== null && w.m > 0.25 * baseline.m,
    });
    // Put the world back before the next case, whatever this one did.
    await escapeAll();
    await settle(0.3);
  }

  const after = await walk();
  const muted = results.filter((r) => r.error === null && !r.moved);
  return {
    valid: baseline.m > 0.5 && baseline.ticks >= TICKS - 2,
    baselineM: baseline.m,
    baselineTicks: baseline.ticks,
    afterAllM: after.m,
    // The headline: any case in which KeyW moved nobody while the baseline did.
    mutedCases: muted.map((r) => r.case),
    // And the one that would be a leak with NO panel left open, which is the
    // shape a player would report as "walking forward froze".
    leakedCaptureCases: muted
      .filter((r) => (r.modalsAfterClose.openCount ?? 1) === 0)
      .map((r) => r.case),
    results,
    site: { scenario: of.world().scenario, walkSpeedMps: of.config.walkSpeedMps, ticks: TICKS },
  };
})()
