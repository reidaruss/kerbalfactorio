// THE BINDING TABLE, and it is the only place a key code appears.
//
// Everything downstream of this file asks for an ACTION ("use", "interact",
// "slot3") and never for a key. That is not tidiness: the remap this file exists
// for changed E from harvest to interact and moved place off G onto the left
// mouse button, and roughly twenty driven probes were pressing E and G by name.
// A probe that presses `use` keeps working through the next remap; a probe that
// presses KeyG has to be found and edited, and the ones nobody finds go red.
//
// MOUSE BUTTONS ARE CODES TOO. `Mouse0` and `Mouse2` join the same held-key set
// the keyboard uses, so a scripted tape can click and a human click and a
// scripted click are the same event to every consumer (ARCHITECTURE 11.2).

/** Every verb the game has. Adding one here is the whole registration. */
export type Action =
  | 'forward' | 'back' | 'strafeLeft' | 'strafeRight' | 'flyUp' | 'flyDown'
  | 'jump' | 'sprint'
  | 'use' | 'interact' | 'cancel'
  | 'pack' | 'level' | 'demolish' | 'view' | 'lamp'
  | 'rotate' | 'freeSnap' | 'mute' | 'goals' | 'assembly' | 'build'
  // W11 PROGRESSION SCREENS. Three panels, three verbs, no raw codes anywhere
  // downstream (H-5). They landed as literal 'KeyJ'/'KeyU'/'KeyK' inside
  // `game/ProgressUi.ts` only because this file was another lane's that night,
  // and three raw codes break the one property that made a whole control remap
  // cost a single file: everything asks for an ACTION and nothing else in the
  // client names a key.
  | 'research' | 'power' | 'equipment'
  // W9 FLIGHT. Board is the one context-sensitive verb (roll out / board /
  // disembark); everything else means exactly one thing and only while flying.
  // GP-74. `recover` is the way OUT: it takes the vessel off the world and
  // gives the pad back, from on foot or from the cockpit.
  | 'board' | 'recover' | 'stage' | 'throttleUp' | 'throttleDown' | 'throttleFull'
  | 'throttleCut' | 'pitchUp' | 'pitchDown' | 'yawLeft' | 'yawRight'
  | 'rollLeft' | 'rollRight' | 'sasToggle' | 'sasMode' | 'warpUp' | 'warpDown'
  // W12 MAP AND NODES. `map` is M because M is the map in KSP and Reid asked
  // for it by name. The eight SAS modes take the digit row, which is the
  // hotbar on foot and dead in a rocket, exactly the precedent `throttleDown`
  // set on KeyK. Node HANDLES are deliberately NOT keys: they are on-screen
  // buttons, because eight more bindings to nudge four numbers is a worse
  // trade than four pairs of buttons the player can see.
  | 'map'
  | 'sasStability' | 'sasPrograde' | 'sasRetrograde'
  | 'sasNormal' | 'sasAntinormal' | 'sasRadialIn' | 'sasRadialOut' | 'sasNode'
  | 'sasGuidance'
  | 'slotNext' | 'slotPrev'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'slot6' | 'slot7' | 'slot8' | 'slot9' | 'slot10' | 'slot11'
  // GP-154. MOVING AROUND A MENU WITHOUT A MOUSE. They live here rather than as
  // raw `ArrowUp` inside `ui/PauseMenu.ts` for the reason at the top of this
  // file: this is the only place a key code appears, and a screen that lists
  // "every control the game listens to" (GP-131) becomes a liar the moment the
  // game listens to a code this table has never heard of. Nothing in gameplay
  // pulls them, so adding them costs the player nothing outside a menu.
  | 'menuUp' | 'menuDown' | 'menuSelect';

/**
 * Action -> the codes that fire it. `Mouse0` is the left button.
 *
 * `slotNext`/`slotPrev` have no codes: they are the wheel, which is a delta and
 * not a held state, so `Input` produces them from `frame.wheel` instead. They
 * are still Actions so a probe can ask for "one notch down" by name.
 */
export const BINDINGS: Record<Action, readonly string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  flyUp: ['KeyR'],
  flyDown: ['KeyF'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  // THE TWO THE PLAYER COMPLAINED ABOUT. Placing, swinging and digging are all
  // one button, chosen by what is in the hotbar; E stops being harvest and
  // becomes "talk to the thing I am looking at", which is what every game in
  // this genre means by E.
  use: ['Mouse0'],
  interact: ['KeyE'],
  cancel: ['Escape'],
  pack: ['Tab'],
  level: ['KeyQ'],
  // RIGHT CLICK is the genre's demolish and X is kept because it was already
  // documented. Neither belongs on the hotbar: levelling and removing apply to
  // whatever is under the crosshair whatever is in hand, so putting them in
  // slots would cost two of nine and force a swap-and-swap-back for a two
  // second action, exactly when the player is mid-way through laying a base.
  demolish: ['KeyX', 'Mouse2'],
  view: ['KeyV'],
  lamp: ['KeyL'],
  rotate: ['KeyR'],
  // GP-113. B MOVED OFF FREE PLACEMENT AND ONTO THE BUILD MENU, because Reid
  // asked for that key by name: "let's make b, the letter b, a build menu".
  //
  // Free placement went to N, and the collision that looks like is not one. N is
  // `stage`'s SECOND code (Space is the primary), and `stage` is a flight verb:
  // `Gameplay.fixedStep` returns before `keys.world` while `suspended`, so the
  // build ghost cannot exist in a rocket, and on foot `stage` reaches nothing.
  // The rule this file already states covers it exactly: a code may fire two
  // actions provided only one of the two consumers is ever live, and you are
  // either walking or strapped in.
  freeSnap: ['KeyN'],
  // GP-111. THE BUILD MENU. It joins the modal stack, so it needs the same
  // survivorship `pack` and `assembly` have: the key that opened it has to keep
  // working while it owns the pointer, or the only way out would be Escape.
  build: ['KeyB'],
  // MUTE MOVED OFF KeyM, and this is the one binding change that is not an
  // addition. M is the map key in KSP and Reid asked for it by name, and the
  // "a code may fire two actions" rule below has a precondition that mute
  // BREAKS: only one of the two consumers may ever be live, and `mute` is read
  // in `GameplayInput.chrome`, which runs above the `suspended` return and is
  // therefore live in a rocket. Left as it was, one press of M would open the
  // map AND silence the game, which is the silent-second-effect class this
  // project keeps paying for. Backslash is a holding pen, not a design: see
  // the physics lane's report for the one-word follow-up it needs (the HUD
  // still flashes "sound off  (M)", in a file this lane may not touch).
  mute: ['Backslash'],
  goals: ['KeyH'],
  // W8. The assembly bay is a PLACE you go, so it gets a key of its own rather
  // than a hotbar slot: a slot decides what the LEFT BUTTON does, and the bay is
  // not something the left button does.
  assembly: ['KeyC'],
  // W11. The three progression screens. `equipment` on KeyK is deliberate and
  // not a leftover: KeyK is `throttleDown`, which means something in a rocket
  // and nothing on foot, which is exactly the precedent stated below for the
  // flight block. The panels are gated on the walking context, so the two
  // consumers are never live at once.
  research: ['KeyJ'],
  power: ['KeyU'],
  equipment: ['KeyK'],
  // W9 FLIGHT. Two rules picked the codes below and neither is taste.
  //
  // (1) The keys that mean something on foot and NOTHING in a rocket are reused
  // for the verb the genre already puts on them, so a KSP player has muscle
  // memory here on the first flight: Space stages, Shift throttles up, X cuts
  // the throttle, W/A/S/D and Q/E fly the attitude. A code may fire two actions
  // (Bindings maps code -> action LIST), and only one of the two consumers is
  // ever live, because you are either walking or strapped in.
  //
  // (2) Everything with no genre home takes a key from the free set, so nothing
  // already documented moves.
  board: ['KeyG'],
  // GP-74. `Delete`, and it had to be a non-letter: every one of the 26 letter
  // keys is already bound in this table, on foot or in a rocket or both, so
  // there was no free letter left to take. Delete is also the right word for
  // it. NOT `Backspace` as a second code, though a laptop without a Delete key
  // is a real case: the bay carries a text input for design names and
  // Backspace inside it means something else, and a key with two meanings one
  // of which eats your typing is worse than a key some keyboards make awkward.
  recover: ['Delete'],
  stage: ['Space', 'KeyN'],
  throttleUp: ['ShiftLeft', 'ShiftRight', 'KeyI'],
  throttleDown: ['KeyK'],
  throttleFull: ['KeyZ'],
  throttleCut: ['KeyX'],
  pitchDown: ['KeyW'],
  pitchUp: ['KeyS'],
  yawLeft: ['KeyA'],
  yawRight: ['KeyD'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  sasToggle: ['KeyT'],
  sasMode: ['KeyY'],
  warpUp: ['KeyP'],
  warpDown: ['KeyO'],
  // W12. The map, and the SAS modes on the digit row. Every digit is a hotbar
  // slot on foot and nothing at all in a rocket, so the pair is never live at
  // once: the same argument `equipment` on KeyK already makes.
  map: ['KeyM'],
  sasStability: ['Digit1'],
  sasPrograde: ['Digit2'],
  sasRetrograde: ['Digit3'],
  sasNormal: ['Digit4'],
  sasAntinormal: ['Digit5'],
  sasRadialIn: ['Digit6'],
  sasRadialOut: ['Digit7'],
  sasNode: ['Digit8'],
  // The NINTH SAS key. The ribbon has been drawn since W12 and nothing could
  // point at it, so reaching orbit was the one link a player had to hand-fly.
  sasGuidance: ['Digit9'],
  slotNext: [],
  slotPrev: [],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'],
  slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  slot7: ['Digit7'], slot8: ['Digit8'], slot9: ['Digit9'],
  // GP-57. The tenth slot, on the key that sits next to the ninth. The bar
  // grew because the game grew: `Hotbar.SLOT_COUNT` was 9 with 9 defaults, so
  // a tenth buildable had nowhere to be held, and a buildable nothing can hold
  // is GP-56's failure class by construction.
  slot10: ['Digit0'],
  // GP-86. The eleventh slot is the GUN, and it deliberately has no digit: the
  // digit row is full at ten and a weapon on `F` is the convention every
  // shooter has taught, so the muscle memory is already there. The wheel still
  // reaches it because the wheel wraps, so the bar has no unreachable slot.
  slot11: ['KeyF'],
  // GP-154. The arrows and Enter, which are what a player already tries. They
  // are NOT in `UI_ALLOWED`: that list is what survives `Input`'s capture for
  // the GAME to consume, and these are consumed by the menu's own listener
  // instead, so putting them there would offer them to the world as well.
  menuUp: ['ArrowUp'],
  menuDown: ['ArrowDown'],
  menuSelect: ['Enter', 'NumpadEnter'],
};

/**
 * What survives while ANY panel owns the pointer.
 *
 * `pack` because Tab has to close the panel it opened, `interact` because a
 * machine screen closes with the key that opened it, and `cancel` because
 * Escape closing any menu is the whole point of the change. Everything else,
 * `use` above all, is swallowed: a click on a Craft button must not also swing
 * a pickaxe at whatever the crosshair happened to be resting on.
 *
 * `assembly` is here for the same reason as `pack`: the bay takes the pointer
 * while it is open, so the key that opened it has to survive to close it.
 *
 * NOTHING WAS ADDED HERE FOR THE BAY'S LAUNCH KEY, AND THAT IS THE DECISION.
 * Reid built a rocket, pressed G at it and the game did nothing, because
 * `board` is not on this list. The obvious repair is to add it, and it is
 * wrong: this list is GLOBAL, so `board` here would also fire from the
 * inventory, the research tree and the power panel, where G means nothing a
 * player intended and where it would either plant a rocket behind them or
 * strap them into one from inside a menu. A panel's own actions belong to that
 * panel, which is what `Input.setUiCapture`'s second argument is for.
 */
export const UI_ALLOWED: readonly Action[] =
  ['pack', 'interact', 'cancel', 'assembly', 'build',
    // Same rule as `pack`: each of the three progression screens takes the
    // pointer while it is open, so the key that opened it has to survive to
    // close it. All three, not one, because a guarantee that holds for two
    // panels out of three is the shape of bug ModalStack's derived list exists
    // to prevent (GP-25).
    'research', 'power', 'equipment'];

/**
 * THE MAP'S OWN ALLOW LIST, passed to `Input.setUiCapture`'s second argument.
 *
 * The decision here is deliberate and it is the opposite of a panel's. An
 * inventory screen swallows the world because a click on a Craft button must
 * not also swing a pickaxe. The map is not that: it is a VIEW of a flight that
 * is still happening, at whatever warp it was already at, and in KSP every
 * flight control stays live in map view. So EVERY flight action survives here,
 * including `board` and `stage`, which are the two that could surprise you.
 *
 * They survive for the reason the `board` note above gives from the other
 * side: `board` is not in the GLOBAL list because G from an inventory screen
 * means nothing a player intended. G from the MAP, strapped into a rocket,
 * means exactly what it means from the navball, and the map draws
 * `FlightMode.message`, so a refusal is visible rather than silent. A key that
 * does nothing at all teaches the player the feature does not exist.
 *
 * What is NOT here: the on-foot verbs (`use`, `demolish`, `level`, the hotbar
 * slots, `view`, `lamp`). Every one of them is already dead while strapped in,
 * because `Gameplay.fixedStep` returns early on `suspended`, so listing them
 * would change nothing except to imply they might work.
 */
export const MAP_ALLOWED: readonly Action[] = [
  'map', 'board', 'recover', 'stage',
  'throttleUp', 'throttleDown', 'throttleFull', 'throttleCut',
  'pitchUp', 'pitchDown', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight',
  'sasToggle', 'sasMode', 'warpUp', 'warpDown',
  'sasStability', 'sasPrograde', 'sasRetrograde', 'sasNormal',
  'sasAntinormal', 'sasRadialIn', 'sasRadialOut', 'sasNode', 'sasGuidance',
];

const CODE_TO_ACTIONS = new Map<string, Action[]>();
for (const [a, codes] of Object.entries(BINDINGS) as [Action, string[]][]) {
  for (const c of codes) {
    const list = CODE_TO_ACTIONS.get(c) ?? [];
    list.push(a);
    CODE_TO_ACTIONS.set(c, list);
  }
}

const ACTIONS = new Set(Object.keys(BINDINGS) as Action[]);

export function isAction(name: string): name is Action {
  return ACTIONS.has(name as Action);
}

/** The codes that fire an action, or the name itself when it is already a code. */
export function codesFor(name: string): readonly string[] {
  return isAction(name) ? BINDINGS[name] : [name];
}

/** Which actions a raw code fires. For the binding table the HUD prints. */
export function actionsFor(code: string): readonly Action[] {
  return CODE_TO_ACTIONS.get(code) ?? [];
}

/**
 * GP-140. ONE CODE, ONE SPELLING, everywhere in the client.
 *
 * There were two of these. `labelOf` turned `ShiftLeft` into "Shift" for the
 * one-key hints, and `BindingText.prettyCode` turned it into "Left Shift" for
 * the controls screen, so the launch guide said "Hold Shift to throttle up"
 * while the screen that lists every control said "Left Shift". Nobody had
 * noticed, because the two are never on screen together;
 * `probes/launchguide.js` found it by asserting the guide against the binding
 * table rather than against a literal, which is exactly why that assertion is
 * written that way.
 *
 * It is the defect class this file already carries three scars from (the mute
 * hint, the map hint, H-5's raw key codes) one level further in: not a second
 * copy of WHICH key, but a second copy of how to SAY it. The precise spelling
 * wins, because a controls screen listing both shift keys has to tell them
 * apart and a hint that reads "Left Shift" loses nothing. The mouse buttons
 * are capitalised for the same reason: they are KEY NAMES, they are drawn in
 * <kbd> chips, and they start sentences ("Left click swings").
 */
export function prettyCode(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Mouse0', 'Left click')
    .replace('Mouse2', 'Right click')
    .replace('ShiftLeft', 'Left Shift')
    .replace('ShiftRight', 'Right Shift')
    .replace('Backquote', '`')
    .replace('Backslash', '\\');
}

/** How a binding reads on screen. `Mouse0` is not a key name a player knows. */
export function labelOf(action: Action): string {
  const codes = BINDINGS[action];
  if (codes.length === 0) return action === 'slotNext' ? 'wheel down' : 'wheel up';
  return prettyCode(codes[0]);
}
