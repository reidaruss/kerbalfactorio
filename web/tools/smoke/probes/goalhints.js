// GP-165: EVERY KEY AND SLOT THE CHECKLIST NAMES IS DERIVED, and the drawn
// hint follows a hotbar edit.
//
//   cd web
//   node tools/smoke/run.mjs --scenario=walk --settle=6 \
//        --evalfile=tools/smoke/probes/goalhints.js
//
// WHAT IT CATCHES, found by screenshot on 2026-07-30: the first six hints a
// new player read carried five wrong controls between them, all hardcoded
// prose that two control remaps and a hotbar rework had walked away from:
// "hold E" for a harvest the LEFT BUTTON does, "G to place" for a click,
// "press 1" for a drill on slot 3, "press 2 for belt, 3 for smelter" about
// slots 4 and 5. The fixture assertions pin the live binding table FIRST, so
// the literal expectations below are honest: if a binding moves, the fixture
// fails by name instead of the text checks lying.
//
// THE CONTROL THAT PROSE CANNOT PASS: the drill is reassigned to another slot
// mid-run through the same Hotbar.assign the pack's drag gesture reaches, and
// the resolved hint must FOLLOW it. A hardcoded hint fails that by
// construction, which is what makes this an assertion about the derivation
// and not about today's wording.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };

  await sleep(1.0);

  // --- fixture: pin the table this run derives from --------------------------
  const B = of.input.bindings();
  check('fixture: use is the left button', B.use[0] === 'Mouse0',
    JSON.stringify(B.use));
  check('fixture: interact is KeyE', B.interact[0] === 'KeyE',
    JSON.stringify(B.interact));
  check('fixture: goals is KeyH', B.goals[0] === 'KeyH',
    JSON.stringify(B.goals));
  const hb = of.hotbar().slots;
  const slotIdx = (part) => hb.findIndex((s) => s.part === part) + 1;
  check('fixture: the drill starts on slot 3', slotIdx('miner') === 3,
    String(slotIdx('miner')));
  check('fixture: belt on 4 and smelter on 5',
    slotIdx('belt') === 4 && slotIdx('smelter') === 5,
    `${slotIdx('belt')}, ${slotIdx('smelter')}`);

  // --- the DRAWN current hint (objective 0, wood) ----------------------------
  const drawn = document.querySelector('#of-goals .hint')?.textContent ?? '';
  check('the drawn harvest hint names the left button', drawn.includes('Left click'),
    drawn);
  check('the drawn harvest hint no longer says hold E', !drawn.includes('hold E'),
    drawn);
  const header = document.querySelector('#of-goals h4')?.textContent ?? '';
  check('the header hide-key is the goals binding', header.includes('H'), header);

  // --- every resolved hint, from the same functions the panel draws ----------
  const hints = Object.fromEntries(of.goals().hints.map((h) => [h.id, h.hint]));
  check('the smelt hint names the click and E, not G',
    hints.smelt.includes('Left click') && hints.smelt.includes('E')
    && !hints.smelt.includes('G to place'), hints.smelt);
  check('the miner hint names the slot the drill is actually on',
    hints.miner.includes('press 3'), hints.miner);
  check('the belt hint names slots 4 and 5',
    hints.belt.includes('4 is belt') && hints.belt.includes('5 is'),
    hints.belt);
  check('the pad hint names the research key from the table',
    hints.pad.includes('(J)'), hints.pad);
  check('the rocket hint names the assembly key from the table',
    hints.rocket.includes('press C'), hints.rocket);

  // --- THE CONTROL: move the drill, and the hint must follow ----------------
  // MOVE, not copy: the first draft assigned slot 7 and left the drill on 3
  // as well, and the hint truthfully kept saying 3, which was the probe's
  // fixture being degenerate rather than the derivation being wrong (GP-142's
  // class: the operation was tested at an input where it cannot show).
  of.assignSlot(3, 'empty');
  of.assignSlot(7, 'miner');            // the same Hotbar.assign a drag reaches
  await sleep(0.2);
  check('fixture: the drill is now ONLY on slot 7',
    of.hotbar().slots.filter((s) => s.part === 'miner').length === 1
    && of.hotbar().slots[6].part === 'miner',
    JSON.stringify(of.hotbar().slots.map((s) => s.part ?? s.kind)));
  const moved = Object.fromEntries(of.goals().hints.map((h) => [h.id, h.hint]));
  check('after moving the drill to slot 7 the hint says press 7',
    moved.miner.includes('press 7') && !moved.miner.includes('press 3'),
    moved.miner);
  // Slot 7 held the floor and now holds the drill. Put both back so the world
  // this probe leaves behind is the one it found.
  const backDefault = (() => {
    of.assignSlot(3, 'miner');
    of.assignSlot(7, 'floor');
    return of.hotbar().slots;
  })();
  check('the loadout was restored', backDefault[2].part === 'miner'
    && backDefault[6].part === 'floor',
    JSON.stringify(backDefault.map((s) => s.part ?? s.kind)));
  const restored = Object.fromEntries(of.goals().hints.map((h) => [h.id, h.hint]));
  check('and the hint followed it back', restored.miner.includes('press 3'),
    restored.miner);

  return { valid: fails.length === 0, fails, drawn, header,
    hints: restored };
})()
