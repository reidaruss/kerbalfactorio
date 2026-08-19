// keycollide.js — GP-608. TWO KEY CODES ARE EACH BOUND TO TWO ACTIONS.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/keycollide.js
//
// BT-190: this probe never carried a real invocation; `extractCmd()`'s old
// first-match rule took a prose line further down ("CHECKS HELD. Measured
// directly against `run.mjs`...") as the command, which held zero real
// flags, so every prior sweep ran this at the runner's bare defaults (which
// happen to equal `--scenario=walk`, this probe's own on-foot fixture: a
// wall taken from the default build menu, matching `controls.js`'s
// unaffected sibling convention). No sandbox: the claim is about key
// bindings, not the economy.
//
// `Bindings.ts` is a `Record<Action, readonly string[]>`, which makes the map
// exhaustive in one direction only: every action must have codes. NOTHING has
// ever checked the other direction, so two actions may quietly claim the same
// code and the table stays type-correct.
//
//   KeyR -> flyUp   AND rotate
//   KeyF -> flyDown AND slot11
//
// THE STATIC HALF IS THE CHEAP HALF AND IT IS NOT THE CLAIM. A shared code is
// not automatically a defect: `demolish` and `demolishAsk` deliberately look at
// the same button (GP-605), and a code shared between two contexts that are
// never live together is fine by construction. So this probe does BOTH:
//
//   1. it enumerates every code claimed by more than one action, which is a
//      fact about the table and is where the audit lives; and
//   2. it PRESSES the two suspects on foot and reads whether both consumers
//      moved, which is the only thing that distinguishes "two actions share a
//      key" from "one keypress does two things to the player".
//
// The second is the one that matters and the one nobody has run. A player
// rotating a wall must not also be flying, and pressing the sidearm slot must
// not also be sinking them through the floor.
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
  // GP-609, AMENDED BT-270 to BT-274. A FAILED CHECK USED TO THROW, on the
  // theory that a returned `fails: [...]`/`valid:false` exits 0 and run.mjs
  // prints `smoke: PASS` for a human driving it by hand, and only a throw
  // (which rejects page.evaluate) reached the runner's own exit code. That
  // reasoning never accounted for the SWEEP: `probeall.mjs`'s audit of
  // `run.mjs` found its try/catch drops the ENTIRE report on a
  // page.evaluate throw, not just the eval field, so a correctly-diagnosed
  // RED here read as NO_OUTPUT, indistinguishable from a hard crash --
  // qolbuild2.js's "press aimed at the SKY places nothing" finding (BT-260
  // to BT-264) was exactly this shape. `finish()` now RETURNS `{ fails,
  // valid: fails.length === 0, log }` (verdictOf()'s convention 1) instead,
  // which probeall.mjs reads as a real RED with the failing check names
  // intact. The standalone-run honesty is kept the same way qolbuild2.js
  // keeps it: every failure still gets its own `console.error` line, and
  // `run.mjs` fails a standalone run's own exit code on any page
  // console.error independent of what is in the returned report, so `node
  // run.mjs ...` by hand still prints `smoke: FAILURES` and exits non-zero.
  // `bail()` (an early, self-diagnosed abandon: this file defines it but
  // never calls it) gets the same fix for the same reason, kept consistent
  // with the sibling probes (`navdraw.js`, `qolhandsafe.js`, `qolsandbox.js`)
  // that do call it: it now records the reason as a failure and returns
  // through `finish()` rather than throwing it away. `run.mjs` itself is
  // addressed separately (BT-270 to BT-274's own decision on its catch
  // block), not silently assumed fixed by this file alone.
  const bail = (why) => {
    fails.push(`ABANDONED :: ${why}`);
    log.push(`FAIL  ABANDONED  [${why}]`);
    return finish(out);
  };
  const finish = (out) => {
    for (const f of fails) console.error(`probe FAIL: ${f}`);
    return { ...out, valid: fails.length === 0, fails, log };
  };
  const out = { fails, log };

  await sleep(0.9);

  // ---- 1. THE TABLE, AUDITED IN THE DIRECTION THE TYPE CANNOT --------------
  const B = of.input.bindings();
  const byCode = new Map();
  for (const [action, codes] of Object.entries(B)) {
    for (const c of codes || []) {
      if (!byCode.has(c)) byCode.set(c, []);
      byCode.get(c).push(action);
    }
  }
  const shared = [...byCode.entries()].filter(([, a]) => a.length > 1)
    .map(([code, actions]) => ({ code, actions }));
  out.actionCount = Object.keys(B).length;
  out.codeCount = byCode.size;
  out.sharedCodes = shared;
  // NOT AN ASSERTION THAT `shared` IS EMPTY. GP-605 puts Mouse2 on two actions
  // on purpose, so an empty-set check would be false the day it was written.
  // The audit is the LIST, printed with its denominator so a reader can see
  // what it is a list OF.
  log.push(`AUDIT  ${shared.length} of ${out.codeCount} codes are claimed by more `
    + `than one action: ` + shared.map((s) => `${s.code}=${s.actions.join('+')}`).join(', '));
  check('the binding table was actually read (a non-empty table)',
        out.actionCount > 20 && out.codeCount > 20,
        `${out.actionCount} actions over ${out.codeCount} codes`);

  // ---- 2. FIXTURE: THE TWO SUSPECTS ARE STILL SHARED -----------------------
  // Asserted before anything is concluded from a press. If a later pass splits
  // them, these go red and the run below stops meaning what it says.
  const forCode = (c) => (byCode.get(c) || []).slice().sort();
  out.keyR = forCode('KeyR');
  out.keyF = forCode('KeyF');
  check('fixture: KeyR is claimed by both flyUp and rotate',
        out.keyR.includes('flyUp') && out.keyR.includes('rotate'),
        JSON.stringify(out.keyR));
  check('fixture: KeyF is claimed by both flyDown and slot11',
        out.keyF.includes('flyDown') && out.keyF.includes('slot11'),
        JSON.stringify(out.keyF));

  // ---- 3. DRIVE THEM ON FOOT ----------------------------------------------
  // A part in hand, so `rotate` has something to turn: rotating with an empty
  // hand is the identity case and would report no yaw change whether or not the
  // action fired (INSTRUMENTS.md: a fixture whose value is the identity of the
  // operation reads exactly like a pass).
  of.input.act(['build'], 4);
  await sleep(0.7);
  const tile = document.querySelector('#of-build .of-btile[data-build="wall"]');
  out.tileFound = tile !== null;
  if (tile !== null) tile.click();
  await sleep(0.6);
  out.handBeforeR = of.game().hotbar.label;
  check('fixture: a wall is in hand, so rotate has a subject',
        out.handBeforeR === 'wall', out.handBeforeR);

  // THE FIRST VERSION OF THIS READ `w.x, w.y, w.z` AND `observer` PUBLISHES NO
  // SUCH FIELDS, so every distance came out `NaN`, `NaN < 0.5` is false, and
  // the two claims went red for a reason that had nothing to do with the game.
  // The POSITIVE CONTROL is what caught it: KeyW also reported `NaN`, and a
  // control that cannot move the player is a broken instrument, not a finding
  // (INSTRUMENTS.md: when a result surprises you, suspect the harness first).
  //
  // `mustNum` is the runner's own guard and it is used here rather than a bare
  // read, precisely so the NEXT renamed field throws by name instead of
  // producing an arithmetic result that quietly fails every comparison.
  const pose = () => {
    const w = of.world().observer;
    const R = mustNum(of.world(), 'bodyRadiusM', 'world');
    const lat = mustNum(w, 'latDeg', 'observer');
    const lon = mustNum(w, 'lonDeg', 'observer');
    const alt = mustNum(w, 'altM', 'observer');
    // Metres, so the thresholds below are in the units a reader expects. The
    // longitude term is scaled by cos(lat) or a degree near the pole would read
    // as hundreds of metres of movement that did not happen.
    const d = Math.PI / 180;
    return { altM: alt, north: lat * d * R, east: lon * d * R * Math.cos(lat * d) };
  };
  const moved = (a, b) => Math.hypot(b.north - a.north, b.east - a.east);
  // `build.rotation` is the 0..3 quarter-turn THE GHOST is at, and it is the
  // right field. `build.turns` is NOT: FS-27 counts buildings turned in place
  // with an EMPTY hand, so with a wall in hand it stays 0 for ever and the
  // first version of this probe read `turns 0 -> 0` and called a working
  // rotate broken. Both are printed, so a reader can see which moved.
  //
  // `rotation` is modulo 4, so a full circle returns it to its start. That is
  // survivable here because this presses ONCE, and the fixture asserts the
  // starting value, so a 0 -> 0 would mean four presses landed from one tape
  // entry, which is a different bug and would be worth knowing about.
  const rotState = () => {
    const g = of.game().build;
    return g === null || g === undefined ? null
      : { rotation: g.rotation, turns: g.turns };
  };

  const p0 = pose();
  const y0 = rotState();
  out.rotPublished = y0 !== null && y0.turns !== undefined;
  check('fixture: the build report publishes rotation and turns',
        out.rotPublished, JSON.stringify(y0));
  out.beforeR = { pose: p0, rot: y0 };

  // KeyR, HELD, because `flyUp` is an AXIS and a 4-frame tap is the shortest
  // thing that could move it. 40 frames is two thirds of a second of thrust.
  of.input.tape([{ hold: 40, keys: ['KeyR'] }, { hold: 10, keys: [] }]);
  await sleep(1.2);
  const p1 = pose();
  const y1 = rotState();
  out.afterR = { pose: p1, rot: y1 };
  out.altMovedByR = Math.abs(p1.altM - p0.altM);
  out.posMovedByR = moved(p0, p1);
  out.ghostTurnedByR = y0 === null || y1 === null ? null
    : y1.rotation !== y0.rotation;

  // THE CLAIM. On foot, R is the rotate key the build hint tells you to press.
  // It must not also move the body.
  check('GP-608: 40 held frames of KeyR do not move the player',
        out.altMovedByR < 0.25 && out.posMovedByR < 0.5,
        `alt ${out.altMovedByR.toFixed(3)} m, pos ${out.posMovedByR.toFixed(3)} m`);
  check('GP-608: and KeyR DID reach rotate (the press was not simply lost)',
        out.ghostTurnedByR === true,
        `turns ${y0 && y0.turns} -> ${y1 && y1.turns}, `
        + `rotation ${y0 && y0.rotation} -> ${y1 && y1.rotation}`);

  // ---- 4. KeyF -------------------------------------------------------------
  await sleep(0.6);
  const p2 = pose();
  out.slotBeforeF = of.game().hotbar.selected;
  out.handBeforeF = of.game().hotbar.label;
  of.input.tape([{ hold: 40, keys: ['KeyF'] }, { hold: 10, keys: [] }]);
  await sleep(1.2);
  const p3 = pose();
  out.slotAfterF = of.game().hotbar.selected;
  out.handAfterF = of.game().hotbar.label;
  out.altMovedByF = Math.abs(p3.altM - p2.altM);
  out.posMovedByF = moved(p2, p3);
  check('GP-608: 40 held frames of KeyF do not move the player',
        out.altMovedByF < 0.25 && out.posMovedByF < 0.5,
        `alt ${out.altMovedByF.toFixed(3)} m, pos ${out.posMovedByF.toFixed(3)} m`);
  check('GP-608: and KeyF DID reach slot11 (the press was not simply lost)',
        out.slotAfterF !== out.slotBeforeF || out.handAfterF === 'sidearm',
        `slot ${out.slotBeforeF} -> ${out.slotAfterF}, hand ${out.handAfterF}`);

  // ---- 5. POSITIVE CONTROL: THE HARNESS CAN MOVE THE PLAYER ----------------
  // Without this, "R did not move the player" is satisfied by a probe whose
  // presses reach nothing at all, which is the most expensive kind of green.
  await sleep(0.5);
  const p4 = pose();
  of.input.tape([{ hold: 40, keys: ['KeyW'] }, { hold: 10, keys: [] }]);
  await sleep(1.2);
  const p5 = pose();
  out.posMovedByW = moved(p4, p5);
  check('POSITIVE CONTROL: a held KeyW does move the player, so the tape works',
        out.posMovedByW > 0.5, `${out.posMovedByW.toFixed(3)} m`);

  return finish(out);
})()
