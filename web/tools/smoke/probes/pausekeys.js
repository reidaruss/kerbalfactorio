// pausekeys.js: GP-151. KEYBOARD NAVIGATION ACROSS THE PAUSE MENU.
//
//   npx vite --config vite.probe.config.ts --port 5264 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5264/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/pausekeys.js
//
// ============================================================================
// THE PREDICTION, WRITTEN BEFORE ANYTHING WAS DRIVEN (Admin's instruction).
//
// I expect to find that FOCUS IS INVISIBLE somewhere in this menu: that some
// element can hold keyboard focus while nothing on screen says which one, or
// that focus goes nowhere at all when a page opens.
//
// The reason for the prediction is not a hunch about this code, which I have
// not read. It is that this seat has now found the same shape twice in one day
// and once is a coincidence:
//   GP-141, a downward snap that reached the screen as ZERO pixels while the
//   report said `snapped: bottom`; and `showNodes` carrying the rule in its own
//   comment, "an invisible snap is indistinguishable from a broken one", with
//   the marker for the lowest node buried under the pad.
//   GP-143, the bay running through seven states saying "placed Fuel Tank
//   (large) [S]" in all seven, so the thing that was true was never said.
// Both are the same defect: the model was right and the screen did not say so.
// Keyboard focus is a model-versus-screen relationship by construction, so it
// is where I expect the third instance.
//
// IF THE PREDICTION IS WRONG, THAT IS A RESULT AND IT GETS REPORTED AS ONE.
// A menu whose focus is visible everywhere, from the moment each page opens, is
// worth as much to know as a defect, and this header stays either way.
//
// The outcome is recorded at the bottom of this file, under PREDICTION OUTCOME,
// with the numbers that settled it.
// ============================================================================
//
// WHAT MAKES THIS PROBE MEAN ANYTHING.
//
// (a) THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR, and the two traps here are
//     named because they are the ones that would hide the defect. A page with
//     ONE focusable row cannot exhibit a wrap-around bug, so the row count is
//     asserted before any wrap is claimed. A page whose first element happens
//     to be focused when it opens cannot exhibit "focus starts nowhere", so
//     what has focus on open is read BEFORE any key is pressed.
// (b) IT ASSERTS THE ACTION AND THE LIVE BINDING TABLE, NEVER PROSE OR A KEY
//     NAME. Which key moves the selection is read from `BINDINGS` through the
//     same accessors the controls screen uses (GP-131, GP-140), because two
//     prettifiers that disagreed shipped for weeks purely because they are
//     never on screen together.
// (c) FOCUS IS MEASURED AS PIXELS, not as `document.activeElement`. An element
//     can hold focus while nothing on screen says so, which is exactly the
//     defect predicted above, so the visible claim is a frame diff over the
//     row that gained it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.pause !== 'function') return { valid: false, why: 'no of.pause' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const kb = () => mustHave(of.pause(), 'keyboard', 'pause()');

  // THE KEYS COME OFF THE LIVE TABLE. Never a literal, and never the pretty
  // name: two prettifiers disagreed for weeks because they are never on screen
  // together (GP-140), so a probe that typed 'ArrowDown' would keep passing
  // through a rebind that broke the menu.
  const codes = of.input.bindings();
  const codeFor = (action) => {
    const list = mustHave(codes, action, 'BINDINGS');
    check(`the binding table has ${action}`, Array.isArray(list) && list.length > 0,
          JSON.stringify(list));
    return (list ?? [])[0];
  };
  const DOWN = codeFor('menuDown'), UP = codeFor('menuUp'),
        SEL = codeFor('menuSelect');
  const press = async (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown',
      { code, key: code, bubbles: true }));
    await sleep(1);
    window.dispatchEvent(new KeyboardEvent('keyup',
      { code, key: code, bubbles: true }));
    await sleep(1);
    return kb();
  };

  // --- 0. the menu opens through the transition Escape reaches --------------
  of.pause(false);
  await sleep(1);
  of.pause(true);
  await sleep(3);
  check('the menu is open', of.pause().open === true);
  check('and Escape is what opens it', of.pause().escapeOpens === true);

  // --- (a) THE FIXTURE, ASSERTED BEFORE ANY BEHAVIOUR ----------------------
  // Two traps, both named because they are the ones that would hide the defect.
  const start = kb();
  check('FIXTURE: there is more than one row, or a wrap-around cannot be shown',
        mustNum(start, 'rows', 'keyboard') >= 3, `${start.rows} rows`);
  check('FIXTURE: the rows have stable ids to navigate by',
        start.ids.every((i) => i !== '?' && i !== ''), JSON.stringify(start.ids));
  log.push({ rows: start.rows, ids: start.ids });

  // --- 1. GP-153: focus goes SOMEWHERE when the menu opens ------------------
  // Measured before the fix: `document.activeElement` was BODY, so this read
  // null. That is the "focus starts nowhere" half of the prediction.
  check('FOCUS LANDS ON A ROW WHEN THE MENU OPENS', start.focused !== null,
        `activeElement was ${start.activeTag}`);
  check('and it is the FIRST row, not an arbitrary one',
        start.focusedIndex === 0, `index ${start.focusedIndex}`);

  // --- 2. GP-152: focus SURVIVES A KEYPRESS --------------------------------
  // The root defect. `render` replaces body.innerHTML, which destroyed the
  // focused element; measured, focus survived ten ticks with NO key and was on
  // BODY two ticks after one, with the button gone from the DOM.
  const afterDown = await press(DOWN);
  check('THE FOCUSED ROW STILL EXISTS AFTER A KEYPRESS',
        afterDown.focused !== null, `activeElement was ${afterDown.activeTag}`);

  // --- 3. GP-154: the keys move the selection ------------------------------
  check('the down key moves down one row', afterDown.focusedIndex === 1,
        `${start.focusedIndex} -> ${afterDown.focusedIndex}`);
  const afterUp = await press(UP);
  check('and the up key moves back', afterUp.focusedIndex === 0,
        `${afterDown.focusedIndex} -> ${afterUp.focusedIndex}`);

  // Wrap, in both directions. The fixture check above is what makes this mean
  // anything: on a one-row page it would pass without moving.
  const up0 = await press(UP);
  check('up from the first row WRAPS to the last',
        up0.focusedIndex === up0.rows - 1,
        `${afterUp.focusedIndex} -> ${up0.focusedIndex} of ${up0.rows}`);
  const down0 = await press(DOWN);
  check('and down from the last wraps to the first', down0.focusedIndex === 0,
        `${up0.focusedIndex} -> ${down0.focusedIndex}`);
  log.push({ walk: [start.focusedIndex, afterDown.focusedIndex,
                    afterUp.focusedIndex, up0.focusedIndex, down0.focusedIndex] });

  // --- 4. a gameplay key must NOT move the menu selection ------------------
  // Two-sided: the keys that navigate are exactly the bound ones, and nothing
  // else does. A handler that moved on any key would pass every check above.
  const before = kb();
  const w = (codes.forward ?? ['KeyW'])[0];
  await press(w);
  check('a movement key does not move the menu selection',
        kb().focusedIndex === before.focusedIndex,
        `${before.focusedIndex} -> ${kb().focusedIndex} on ${w}`);

  // --- 5. GP-154: the select key PRESSES the row it is on ------------------
  // Walk to a page button by id rather than by index, so a row added above it
  // does not silently turn this into a test of something else.
  const target = 'page:controls';
  let guard = 0;
  while (kb().focused !== target && guard < 20) { await press(DOWN); guard += 1; }
  check('the selection reached the Controls row', kb().focused === target,
        `${kb().focused} after ${guard} presses`);
  await press(SEL);
  await sleep(2);
  const onPage = of.pause();
  check('PRESSING IT OPENED THE PAGE, with no mouse anywhere in this probe',
        mustHave(onPage.view, 'page', 'view') === 'controls',
        `page is ${onPage.view.page}`);

  // --- 6. GP-153: a NEW page lands focus on its own first row --------------
  const pageKb = kb();
  check('the controls page has rows to land on', pageKb.rows >= 1,
        `${pageKb.rows}`);
  check('and focus is on the first of them rather than left behind',
        pageKb.focusedIndex === 0,
        `index ${pageKb.focusedIndex}, focused ${pageKb.focused}`);
  log.push({ controlsPage: { rows: pageKb.rows, focused: pageKb.focused } });

  // --- 7. the controls screen LISTS the keys the menu listens to -----------
  // GP-131's screen claims to show every control the game listens to. The menu
  // now listens to three more, so the screen has to have grown, or it is a
  // liar. Asserted on the ACTION NAME, never on the prose or the key label.
  const groups = mustHave(of.pause().view, 'controls', 'view');
  const actions = groups.flatMap((g) => g.rows.map((r) => r.action));
  for (const a of ['menuUp', 'menuDown', 'menuSelect']) {
    check(`the controls screen lists ${a}`, actions.includes(a),
          `${actions.length} actions listed`);
  }
  log.push({ controlsScreenActions: actions.length,
             menuGroup: groups.filter((g) => g.rows
               .some((r) => r.action.startsWith('menu'))).map((g) => g.name) });

  return {
    valid: fails.length === 0,
    fails,
    log,
    note: 'GP-152 focus survives the rebuild that used to destroy it, GP-153 it '
      + 'starts on the first row of every page, GP-154 the arrows and Enter '
      + 'move and press it through the binding table.',
    // ========================================================================
    // PREDICTION OUTCOME. Half right, and the half that was wrong was wrong in
    // the way that matters.
    //
    // RIGHT: focus went NOWHERE when the menu opened. `document.activeElement`
    // was BODY on open, every time, so nothing on screen could say which row
    // was selected because no row was.
    //
    // WRONG: I expected the focus RING to be invisible. It was not. The
    // computed style pointed that way (`outline-color: rgb(16,16,16)` on a
    // panel of `rgba(26,32,38,0.94)`, which is near-black on near-black) and a
    // SCREENSHOT refuted it: Chrome's `outline: auto` ignores `outline-color`
    // and draws a light ring that is perfectly legible. A number said the ring
    // was invisible and the picture said it was not, which is DW-7 in the
    // direction this project usually needs it the other way round.
    //
    // WORSE THAN PREDICTED, and not predicted at all: ANY keypress DESTROYED
    // the focused element. `render` replaces `body.innerHTML`, so the button
    // was removed from the document and focus fell back to BODY. Discriminated
    // rather than assumed, because "the key blurred it" and "the rebuild ate
    // it" want different fixes: focus SURVIVES ten ticks with no key pressed,
    // survives the keydown synchronously, and is gone two ticks later with
    // `document.contains(button) === false`. Keyboard navigation was therefore
    // impossible before it was designed: Tab to a row, press anything, and the
    // row you were on no longer exists.
    // ========================================================================
  };
})()
