// assisted.js: A CHEAT IN SURVIVAL MARKS THE SAVE, FOR EVER (GP-102).
//
// Run it twice, and the second run is the control:
//
//   node tools/smoke/run.mjs --url=... --evalfile=probes/assisted.js
//   node tools/smoke/run.mjs --url=... --sandbox=1 --evalfile=probes/assisted.js
//
// Survival records; sandbox records nothing at all, because DW-31 makes sandbox
// the mode you are MEANT to use to skip the grind and its slot already says
// `mode: sandbox` on its face, which is a stronger and more honest statement
// than any flag could add.
//
// THE ROUND TRIP IS THE WHOLE PROBE, and it needs a negative control that most
// persistence proofs do not. The assisted record is MODULE STATE in
// game/Assisted.ts, so a save-then-load inside one page passes trivially: the
// flag is still sitting in memory whether or not a single byte of it ever
// reached the slot, and `restoreAssisted` deliberately UNIONS rather than
// replaces, so it cannot even be told apart by a value change. So the record is
// explicitly forgotten in memory between the write and the read, through
// `__of.cheat('forgetassist')`, which touches the slot not at all. After that,
// a flag that comes back can only have come off disk. That is the same shape as
// `forgetTunnels` and `repopulate` in DebugGameplay and it exists for the same
// reason: a probe with no way to clear its own subject proves nothing.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.cheat !== 'function') return { valid: false, why: 'no of.cheat' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const A = () => of.cheat();
  const sandbox = of.sandbox().sandbox;

  await sleep(0.6);

  const before = A();
  check('a fresh world starts unmarked', before.assisted === false,
    JSON.stringify(before.used));

  // A cheat that needs nothing built and no craft flying, so the mark is the
  // only thing under test. Pressed through the REAL button in the REAL menu.
  of.pause(true);
  await sleep(0.4);
  const sel = '#of-pause button[data-cheat="fuel"]';
  const btn = document.querySelector(sel);
  check('the Infinite fuel button is there to press', btn !== null);
  btn?.dispatchEvent(new PointerEvent('pointerdown',
    { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
  await sleep(0.12);
  (document.querySelector(sel) ?? btn)?.click();
  await sleep(0.5);

  const used = A();
  if (sandbox) {
    check('SANDBOX RECORDS NOTHING', used.assisted === false && used.used.length === 0,
      JSON.stringify(used.used));
    // And it is not because the press did nothing: the toggle really moved.
    check('even though the control really did fire', used.infiniteFuel === true,
      JSON.stringify(used.infiniteFuel));
    of.pause(false);
    await sleep(0.2);
    return { valid: fails.length === 0, fails, sandbox, before, used,
      note: 'sandbox is never marked; the survival half of this probe is the '
        + 'same file run without --sandbox=1' };
  }

  check('SURVIVAL IS MARKED the moment a control is used', used.assisted === true,
    JSON.stringify(used));
  check('and it names WHICH control, not just that one was used',
    used.used.includes('fuel'), JSON.stringify(used.used));
  check('with a timestamp, so "when" is answerable later', used.firstAtMs > 0,
    `${used.firstAtMs}`);

  // --- the round trip -------------------------------------------------------
  of.pause(false);
  await sleep(0.3);
  await of.save();
  await sleep(0.5);
  of.cheat('forgetassist');
  await sleep(0.2);
  const forgotten = A();
  check('the in-memory record really was cleared before the load',
    forgotten.assisted === false && forgotten.used.length === 0,
    JSON.stringify(forgotten.used));
  await of.load();
  await sleep(0.5);
  const back = A();
  check('THE MARK CAME BACK OFF DISK', back.assisted === true, JSON.stringify(back));
  check('and it came back naming the same control',
    back.used.join(',') === used.used.join(','),
    `${used.used.join(',')} -> ${back.used.join(',')}`);
  check('and the same timestamp, so it is the record and not a fresh one',
    back.firstAtMs === used.firstAtMs, `${used.firstAtMs} -> ${back.firstAtMs}`);

  return {
    valid: fails.length === 0, fails, sandbox,
    before, used, forgotten, back,
    slotKey: back.slotKey,
  };
})()
