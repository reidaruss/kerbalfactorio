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
// on its own: `Input.setUiCapture` zeroes `fwd`, `right`, `up`, the look deltas,
// jump and use, so every panel in the game deliberately mutes walking while it
// is open.
//
// GP-820. `uiHeld` USED TO BE ONE BOOLEAN with no reference count and seven
// call sites (`MapBoot`, `VabBoot`, `MenuBoot` x2, `GameplayChrome` x3), each
// pairing its own true with its own false. Measured on that HEAD: pack open,
// pause open over it, one Escape (`ModalStack.closeTop` correctly closes the
// pause menu only) let the pause menu's own transition clear the ONE shared
// boolean anyway, and KeyW walked 4.173 m with the pack panel still on screen
// against a 4.250 m baseline. `Input.setUiCapture` now takes an OWNER token
// (`UI_OWNERS`) and holds a `Set`, so releasing one owner cannot touch
// another's hold. This probe is the acceptance for that mechanism, not just
// for the one case that found it: it sweeps every owner alone, and every
// ORDERED PAIR of the everyday panels stacked and unstacked both ways, own
// verb and Escape, asserting one invariant throughout -- movement is muted
// IFF at least one panel is up, never more and never less.
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
  //
  // GP-820 EXTENDS THE TRAP TO A SECOND TAPE-BACKED VERB. `of.input.act(...)`,
  // the only way to toggle the research/power/equipment screens, ALSO queues a
  // tape (`Debug.ts`'s `input.act`). So every step in the sweep below waits
  // with `advance`, never `settle`, between an action and the measurement that
  // follows it: the one safe rule is "never call `playTape` on top of a tape
  // that has not been consumed yet", and `settle` is exactly that call.
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

  // EVERY REACHABLE OWNER, as its OWN open/close pair through the real path a
  // player takes -- a debug setter for the three boolean panels, and the
  // ACTION toggle for the progress screen, which has no boolean setter at all.
  // `usesTape` says which wait function is safe after this owner's verb (see
  // `advance` above); a panel that gains a tape-backed verb later and is added
  // here with the wrong flag would re-open exactly the GP-794 trap, so the
  // flag travels WITH the verb rather than living in the runner's head.
  const PANELS = [
    { name: 'pack', open: () => of.panel(true), close: () => of.panel(false),
      usesTape: false },
    { name: 'pause', open: () => of.pause(true), close: () => of.pause(false),
      usesTape: false },
    { name: 'buildMenu', open: () => of.buildMenu(true),
      close: () => of.buildMenu(false), usesTape: false },
    // ProgressUi has no boolean setter (ProgressUi.ts): the equipment screen
    // is an ACTION TOGGLE, so "close" is the same call as "open" (press
    // again). `equipment` and not `research`: `research` carries D-019's own
    // station gate (ProgressUi.toggle refuses it with no station built), and
    // this sweep exists to measure the CAPTURE mechanism, not re-discover a
    // named gameplay rule as a false violation.
    { name: 'equipment', open: () => of.input.act(['equipment'], 4),
      close: () => of.input.act(['equipment'], 4), usesTape: true },
  ];

  // THE PANELS THAT ACTUALLY STACK IN ORDINARY PLAY: any of these three can be
  // opened over any other through `__of`, exactly as GP-795 opened pause over
  // pack. `equipment` is swept alone above and in two representative pairs
  // below rather than the full cross product, because every additional owner
  // multiplies the sweep by (owners - 1) x 2 scenarios and this file already
  // prices its own instrument (NUMBERS.md's rule): the STACKING mechanism is
  // owner-agnostic by construction (Input.ts unions `Set`s), so three owners
  // exercised exhaustively plus one more in two orders is the sweep that finds
  // a regression without turning every run into a multi-minute one.
  const STACK_PANELS = PANELS.slice(0, 3);

  /** One arrangement step: do `action`, then walk. `open` names the owner that
   *  SHOULD still hold capture afterward, or '' for nobody. */
  const STEP = (label, action, usesTape, open) => ({ label, action, usesTape, open });

  const scenarios = [];

  // Single-owner sweep: own verb, and Escape, over every reachable owner.
  for (const p of PANELS) {
    scenarios.push({ name: p.name, steps: [
      STEP('open', p.open, p.usesTape, p.name),
      STEP('close (own verb)', p.close, p.usesTape, ''),
    ] });
    scenarios.push({ name: `${p.name}+escape`, steps: [
      STEP('open', p.open, p.usesTape, p.name),
      STEP('escape', () => of.escape(), true, ''),
    ] });
  }

  // GP-820. THE STACK, SWEPT: every ORDERED pair of the everyday panels,
  // opened A-then-B and unstacked BOTH ways -- each one's own verb, and two
  // Escapes. This is GP-795's exact shape (open A, open B over it, release
  // ONE) generalised: a boolean could only ever be caught by the ONE ordering
  // somebody happened to test; a set of owner tokens should survive all of
  // them, which is the thing worth measuring instead of assuming from one
  // example. Every step walks, so the assertion covers "both up", "one
  // released, the other must still mute" and "both released, must not mute".
  for (const a of STACK_PANELS) {
    for (const b of STACK_PANELS) {
      if (a === b) continue;
      scenarios.push({ name: `${a.name}-then-${b.name}, own verbs`, steps: [
        STEP(`open ${a.name}`, a.open, a.usesTape, a.name),
        STEP(`open ${b.name} over it`, b.open, b.usesTape, b.name),
        STEP(`close ${b.name} (own verb)`, b.close, b.usesTape, a.name),
        STEP(`close ${a.name} (own verb)`, a.close, a.usesTape, ''),
      ] });
      scenarios.push({ name: `${a.name}-then-${b.name}, two escapes`, steps: [
        STEP(`open ${a.name}`, a.open, a.usesTape, a.name),
        STEP(`open ${b.name} over it`, b.open, b.usesTape, b.name),
        STEP('escape (closes the top one)', () => of.escape(), true, a.name),
        STEP('escape (closes what is left)', () => of.escape(), true, ''),
      ] });
    }
  }

  // Two representative cross-pairs for the fourth owner (`equipment`), rather
  // than the full cross product with all three stack panels (see STACK_PANELS
  // above): this is still GP-795's shape, just with the fourth caller in both
  // positions, and it is what would have caught a fix that only unioned three
  // of the four owners.
  const equipment = PANELS[3];
  const pack = PANELS[0];
  for (const [a, b] of [[pack, equipment], [equipment, pack]]) {
    scenarios.push({ name: `${a.name}-then-${b.name}, own verbs`, steps: [
      STEP(`open ${a.name}`, a.open, a.usesTape, a.name),
      STEP(`open ${b.name} over it`, b.open, b.usesTape, b.name),
      STEP(`close ${b.name} (own verb)`, b.close, b.usesTape, a.name),
      STEP(`close ${a.name} (own verb)`, a.close, a.usesTape, ''),
    ] });
  }

  const results = [];
  for (const scenario of scenarios) {
    let err = null;
    for (const step of scenario.steps) {
      if (err !== null) break;
      try { step.action(); } catch (e) { err = String(e); break; }
      // NEVER `settle` right after a tape-backed verb: see the `advance`
      // comment above. `advance` is also safe after a boolean setter (it
      // touches no tape), so it is used unconditionally here.
      await advance(step.usesTape ? 0.3 : 0.2);
      const modals = modalNames();
      const w = await walk();
      const expectMuted = step.open !== '';
      const moved = w.m > 0.25 * baseline.m;
      results.push({
        case: `${scenario.name}: ${step.label}`,
        error: null,
        expectedOpenOwner: step.open,
        modals,
        walkedM: w.m,
        ticks: w.ticks,
        moved,
        // THE INVARIANT: muted (not moved) iff an owner is expected to hold
        // capture; moved iff none is. Either direction failing is reported,
        // because GP-795's bug and its harmful mirror are the same missing
        // count read two ways.
        ok: expectMuted ? !moved : moved,
      });
    }
    if (err !== null) {
      results.push({ case: scenario.name, error: err, expectedOpenOwner: null,
        modals: null, walkedM: null, ticks: null, moved: null, ok: false });
    }
    // Put the world back before the next scenario, whatever this one did.
    await escapeAll();
    await settle(0.3);
  }

  const after = await walk();
  const violations = results.filter((r) => !r.ok);
  // Split the violations by direction, because they are different bugs.
  // GP-795's own shape: expected an owner to hold it, and movement leaked
  // through anyway.
  const unmutedLeaks = violations.filter((r) => r.expectedOpenOwner !== '');
  // The harmful mirror this whole probe exists to catch: nothing was
  // expected to hold it, and movement stayed dead -- a player-movement
  // freeze with a healthy frame rate and no panel on screen.
  const stuckMutes = violations.filter((r) => r.expectedOpenOwner === '');

  return {
    valid: baseline.m > 0.5 && baseline.ticks >= TICKS - 2,
    pass: violations.length === 0,
    baselineM: baseline.m,
    baselineTicks: baseline.ticks,
    afterAllM: after.m,
    scenarios: scenarios.length,
    steps: results.length,
    // THE HEADLINE, split by which half of the invariant broke.
    unmutedLeaks: unmutedLeaks.map((r) => r.case),
    stuckMutes: stuckMutes.map((r) => r.case),
    violations,
    results,
    site: { scenario: of.world().scenario, walkSpeedMps: of.config.walkSpeedMps, ticks: TICKS },
  };
})()
