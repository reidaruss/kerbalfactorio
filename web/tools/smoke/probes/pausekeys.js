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
  return { valid: false, why: 'not yet written: prediction header only' };
})()
