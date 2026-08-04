// qolhandsafe.js: GP-604 and GP-605. THE TWO DESTRUCTIVE-AND-SILENT GESTURES.
//
// Both were found by playing, not by reading, and both share a shape: an action
// that changes the world and draws nothing about it. A probe that reads state
// cannot see either, because the state changes are CORRECT. What was wrong is
// that the player was never told.
//
//   GP-604  Escape with something in hand emptied the hand and said NOTHING,
//           so the commonest reason to press it mid-build (reach the menu) cost
//           you your pick with no sentence and no hint a second press was now
//           needed. Measured in GP-557 as `slot6` -> `hands` in silence.
//   GP-605  `demolish` was `['KeyX', 'Mouse2']`, so a right-click reflex
//           destroyed a building. Mouse2 now ANSWERS with the key that works
//           instead of removing, and is not merely unbound: a control that
//           silently does nothing is the same defect wearing a different coat.
//
// EVERY CLAIM HERE IS TWO-SIDED, because one-sided is how this class hides:
//   - Escape must both EMPTY the hand AND draw a sentence. Asserting only the
//     sentence would pass on an Escape that stopped working.
//   - Mouse2 must both LEAVE THE BUILDING STANDING AND SPEAK. Asserting only
//     the building count would pass on a dead button, which is the thing this
//     change was careful not to ship.
//   - X must still REMOVE, or the fix has traded a destructive reflex for a
//     game you cannot un-build in. That is the reachable positive control.
(async () => {
  const of = window.__of;
  if (!of) throw new Error('probe: no __of on the page');
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
    if (!ok) fails.push(`${name} :: ${detail}`);
  };
  // GP-609. A FAILED CHECK NOW THROWS, BECAUSE `smoke: PASS` DOES NOT MEAN THE
  // CHECKS HELD. Measured directly against `run.mjs`: a probe returning
  // `fails: ['DELIBERATE FAILURE']` exits **0** and prints `smoke: PASS`, and
  // so does one returning `valid: false`. The runner's exit code is a function
  // of console errors and failed requests ONLY. So every probe on this project
  // that reports through a `fails` array has been relying on a human reading
  // the JSON, and a suite whose green is unconditional is a suite that cannot
  // go red.
  //
  // A THROW is the one thing that does reach the exit code: it rejects
  // `page.evaluate`, and the runner already treats that as a FAILURE with a
  // non-zero exit (its own PRELUDE comment says so about `mustNum`). Verified
  // both ways before adopting it: throwing gives exit 1 with the failing names
  // printed, and the same shape with nothing failing still gives exit 0.
  //
  // `run.mjs` itself is NOT changed here. It is build-tooling's file, another
  // lane has uncommitted work in it, and flipping its exit semantics would turn
  // every currently-green run in the repo red at once. That is Admin's call,
  // and it is raised rather than taken.
  // GP-609. AN EARLY BAIL-OUT THROWS TOO. `valid:false` exits 0 (measured), so a
  // probe that gives up half way through, having explicitly recorded that it
  // measured nothing, was reporting `smoke: PASS` for a run that tested nothing.
  // That is the exact failure this retrofit exists to remove, and returning a
  // flag instead of throwing would have left it in place at the one point where
  // the probe already KNOWS it has failed.
  const bail = (why) => { throw new Error(`probe: ABANDONED, ${why}`); };
  const finish = (out) => {
    if (fails.length > 0) {
      throw new Error(`probe: ${fails.length} of ${log.length} checks failed:\n  `
        + fails.join('\n  '));
    }
    return { ...out, valid: true, log };
  };
  const txt = (el) => (el === null || el === undefined ? null
    : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  // GP-151 / GP-557: an element that is in the DOM but not laid out reads its
  // own text back perfectly. The toast also FADES, so `offsetParent` alone is
  // not enough and the `show` class is read too. Nothing below concludes
  // anything from a string without this.
  const toastNow = () => {
    const el = document.querySelector('#of-toast');
    if (el === null || el.offsetParent === null) return null;
    return el.classList.contains('show') ? txt(el) : null;
  };
  const out = { fails, log, sandbox: of.sandbox().sandbox };

  await sleep(0.9);

  // ---- FIXTURE: what the binding table now says --------------------------
  const B = of.input.bindings();
  out.demolishCodes = B.demolish;
  out.demolishAskCodes = B.demolishAsk;
  check('fixture: demolish is KeyX and no longer Mouse2',
        Array.isArray(B.demolish) && B.demolish.includes('KeyX')
        && !B.demolish.includes('Mouse2'), JSON.stringify(B.demolish));
  check('fixture: Mouse2 is now demolishAsk and is still LISTENED TO',
        Array.isArray(B.demolishAsk) && B.demolishAsk.includes('Mouse2'),
        JSON.stringify(B.demolishAsk));

  // ---- GP-604: ESCAPE WITH SOMETHING IN HAND -----------------------------
  // Taken from the BUILD MENU, which is the route GP-557 measured and the one
  // that makes the loss expensive: an override is not a slot, so `select`
  // cannot bring it back.
  of.input.act(['build'], 4);
  await sleep(0.6);
  const tile = document.querySelector('#of-build .of-btile[data-build="foundation"]');
  out.tileFound = tile !== null;
  check('a foundation tile exists to click', out.tileFound);
  if (tile !== null) tile.click();
  await sleep(0.5);
  out.handAfterPick = of.game().hotbar.label;
  // FIXTURE ASSERTED BEFORE THE BEHAVIOUR: if the pick did not land there is
  // nothing to lose, and the Escape check below would pass having tested
  // nothing (INSTRUMENTS.md, the arming-step rule).
  check('fixture: the pick actually put a foundation in hand',
        out.handAfterPick === 'foundation', out.handAfterPick);

  // Clear any leftover toast so the sentence read below is THIS press's.
  await sleep(2.6);
  out.toastBeforeEscape = toastNow();
  check('fixture: no toast is showing before the Escape',
        out.toastBeforeEscape === null, out.toastBeforeEscape);

  of.input.act(['cancel'], 4);
  await sleep(0.45);
  out.handAfterEscape = of.game().hotbar.label;
  out.escapeToast = toastNow();
  check('GP-604: Escape still empties the hand (GP-25 is not weakened)',
        out.handAfterEscape === 'hands', out.handAfterEscape);
  check('GP-604: and it SAYS what it put down',
        out.escapeToast !== null && /foundation/i.test(out.escapeToast),
        out.escapeToast);
  check('GP-604: and it says a second press reaches the menu',
        out.escapeToast !== null && /again/i.test(out.escapeToast),
        out.escapeToast);

  // ---- BUILD SOMETHING TO AIM AT ----------------------------------------
  // A belt, because it is one cell, needs no platform, and the QOL survey
  // proved a foundation is refused on the spawn slope.
  of.input.act(['build'], 4);
  await sleep(0.6);
  const belt = document.querySelector('#of-build .of-btile[data-build="belt"]');
  if (belt !== null) belt.click();
  await sleep(0.5);
  const yaw = of.world().observer.yawDeg;
  of.look(yaw, -35);
  await sleep(0.3);
  of.input.tape([{ hold: 5, actions: ['use'] }, { hold: 10, keys: [] }]);
  await sleep(0.7);
  const built0 = of.game().factory.buildings;
  out.builtBefore = built0;
  // THE REACHABLE SUBJECT. Without a building standing, "Mouse2 did not
  // destroy anything" is true of an empty clearing and means nothing.
  check('fixture: a building is standing to aim at', built0 > 0, `${built0}`);
  if (built0 <= 0) return bail('nothing was built, so the demolish half was NOT measured');

  // Put the hand down so nothing else claims the buttons, then aim at it.
  of.input.act(['cancel'], 4);
  await sleep(0.4);
  let aimed = null;
  for (let p = -70; p <= -10; p += 3) {
    of.look(yaw, p);
    await sleep(0.06);
    if (of.game().aimed && of.game().aimed.build) { aimed = p; break; }
  }
  out.aimPitch = aimed;
  check('fixture: the crosshair is on the building', aimed !== null, `${aimed}`);

  // ---- GP-605: THE RIGHT-CLICK REFLEX -----------------------------------
  await sleep(2.6);
  out.toastBeforeMouse2 = toastNow();
  of.input.tape([{ hold: 4, keys: ['Mouse2'] }, { hold: 10, keys: [] }]);
  await sleep(0.5);
  out.builtAfterMouse2 = of.game().factory.buildings;
  out.mouse2Toast = toastNow();
  check('GP-605: right click leaves the building STANDING',
        out.builtAfterMouse2 === built0,
        `${built0} -> ${out.builtAfterMouse2}`);
  check('GP-605: and right click is NOT a dead button, it names the key',
        out.mouse2Toast !== null && /right click/i.test(out.mouse2Toast)
        && /\bX\b/.test(out.mouse2Toast), out.mouse2Toast);

  // ---- THE POSITIVE CONTROL: X STILL REMOVES ----------------------------
  // Without this the two checks above are satisfied by a build in which
  // nothing can be demolished at all.
  await sleep(2.6);
  of.input.tape([{ hold: 4, keys: ['KeyX'] }, { hold: 10, keys: [] }]);
  await sleep(0.6);
  out.builtAfterX = of.game().factory.buildings;
  out.xToast = toastNow();
  check('POSITIVE CONTROL: X still removes it',
        out.builtAfterX === built0 - 1, `${built0} -> ${out.builtAfterX}`);
  check('POSITIVE CONTROL: and X still says what came back',
        out.xToast !== null && out.xToast !== '', out.xToast);

  return finish(out);
})()
