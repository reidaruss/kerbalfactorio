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
  | 'rotate' | 'freeSnap' | 'mute' | 'goals' | 'assembly'
  // W11 PROGRESSION SCREENS. Three panels, three verbs, no raw codes anywhere
  // downstream (H-5). They landed as literal 'KeyJ'/'KeyU'/'KeyK' inside
  // `game/ProgressUi.ts` only because this file was another lane's that night,
  // and three raw codes break the one property that made a whole control remap
  // cost a single file: everything asks for an ACTION and nothing else in the
  // client names a key.
  | 'research' | 'power' | 'equipment'
  // W9 FLIGHT. Board is the one context-sensitive verb (roll out / board /
  // disembark); everything else means exactly one thing and only while flying.
  | 'board' | 'stage' | 'throttleUp' | 'throttleDown' | 'throttleFull'
  | 'throttleCut' | 'pitchUp' | 'pitchDown' | 'yawLeft' | 'yawRight'
  | 'rollLeft' | 'rollRight' | 'sasToggle' | 'sasMode' | 'warpUp' | 'warpDown'
  | 'slotNext' | 'slotPrev'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'slot6' | 'slot7' | 'slot8' | 'slot9';

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
  freeSnap: ['KeyB'],
  mute: ['KeyM'],
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
  slotNext: [],
  slotPrev: [],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'],
  slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  slot7: ['Digit7'], slot8: ['Digit8'], slot9: ['Digit9'],
};

/**
 * What survives while a panel owns the pointer.
 *
 * `pack` because Tab has to close the panel it opened, `interact` because a
 * machine screen closes with the key that opened it, and `cancel` because
 * Escape closing any menu is the whole point of the change. Everything else,
 * `use` above all, is swallowed: a click on a Craft button must not also swing
 * a pickaxe at whatever the crosshair happened to be resting on.
 *
 * `assembly` is here for the same reason as `pack`: the bay takes the pointer
 * while it is open, so the key that opened it has to survive to close it.
 */
export const UI_ALLOWED: readonly Action[] =
  ['pack', 'interact', 'cancel', 'assembly',
    // Same rule as `pack`: each of the three progression screens takes the
    // pointer while it is open, so the key that opened it has to survive to
    // close it. All three, not one, because a guarantee that holds for two
    // panels out of three is the shape of bug ModalStack's derived list exists
    // to prevent (GP-25).
    'research', 'power', 'equipment'];

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

/** How a binding reads on screen. `Mouse0` is not a key name a player knows. */
export function labelOf(action: Action): string {
  const codes = BINDINGS[action];
  if (codes.length === 0) return action === 'slotNext' ? 'wheel down' : 'wheel up';
  return codes[0]
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Mouse0', 'left click')
    .replace('Mouse2', 'right click')
    .replace('ShiftLeft', 'Shift')
    .replace('Backquote', '`');
}
