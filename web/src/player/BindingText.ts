// GP-131. THE HUMAN-READABLE HALF OF THE BINDING TABLE.
//
// `Bindings.ts` owns what a key IS; this owns what to CALL it and where to show
// it. They are split because they change for different reasons and at different
// rates: a rebind edits the codes, a rewording edits the prose, and neither
// should be able to break the other. What binds them is the type: both are
// `Record<Action, ...>`, so an action added tomorrow must appear in BOTH or the
// build stops. That is the same enforcement `TYPE_ID` gives the build menu and
// `PART_INFO` gives the HUD, and it is why this can be a second file without
// becoming a second authority.
//
// WHY THIS EXISTS AT ALL, and it is not "a settings screen would be nice". This
// project has told the player the wrong key three times that anyone has counted:
// the mute hint said "(M)" for an hour after mute moved to Backslash and had to
// be fixed by reading `labelOf` instead of spelling it; the map panel still
// hardcodes `<b>M</b>` in its own hint (fixed in the same pass as this); and the
// assembly bay's launch key did nothing at all for a night because `board` was
// missing from `UI_ALLOWED`. Every one of those is the same defect: a place that
// states a control instead of asking. A screen that DERIVES the whole table from
// the one source cannot be wrong about any of it, and it makes the next
// discrepancy visible instead of leaving it to be discovered mid-flight.
//
// REBINDING IS NOT HERE YET, deliberately and by Admin's steer: showing the
// truth is most of the value, and a rebind UI has to answer conflict resolution,
// persistence and reset-to-default before it is worth having. The shape is
// reserved by `ControlRow.rebindable`, which is what a later pass turns on.

import { BINDINGS, actionsFor, labelOf, prettyCode, type Action } from './Bindings.js';

/** Where a control belongs on screen, in the order the groups are shown. */
export const CONTROL_GROUPS: readonly string[] = [
  'Moving', 'Hands and building', 'Hotbar', 'Screens', 'Flying', 'Autopilot',
  // GP-154. Last, because it is the group a player needs least often and the
  // one they are most likely to already know. It exists at all because the
  // menu now listens to these codes, and this screen claims to list every
  // control the game listens to.
  'Menus',
];

interface Desc { group: string; label: string }

/**
 * Every action, in plain words. `Record<Action, Desc>` so it is exhaustive by
 * construction: this is the one thing that stops a control being added and
 * silently never appearing on the screen that is supposed to list them all.
 */
export const ACTION_TEXT: Record<Action, Desc> = {
  forward: { group: 'Moving', label: 'Walk forward' },
  back: { group: 'Moving', label: 'Walk back' },
  strafeLeft: { group: 'Moving', label: 'Step left' },
  strafeRight: { group: 'Moving', label: 'Step right' },
  jump: { group: 'Moving', label: 'Jump' },
  sprint: { group: 'Moving', label: 'Sprint' },
  flyUp: { group: 'Moving', label: 'Fly up (no-clip)' },
  flyDown: { group: 'Moving', label: 'Fly down (no-clip)' },
  view: { group: 'Moving', label: 'First or third person' },
  lamp: { group: 'Moving', label: 'Headlamp' },

  use: { group: 'Hands and building', label: 'Use what is in your hand' },
  interact: { group: 'Hands and building', label: 'Interact (open, take, work a door)' },
  demolish: { group: 'Hands and building', label: 'Remove what you are aiming at' },
  // GP-605. LISTED, because this screen's whole claim is that it shows every
  // control the game listens to, and Mouse2 is still listened to: it now says
  // which key removes instead of removing. A control that exists to correct a
  // reflex has to be findable by the player having the reflex.
  demolishAsk: { group: 'Hands and building',
    label: 'Right click: says which key removes (it no longer removes)' },
  rotate: { group: 'Hands and building', label: 'Turn the part in hand' },
  freeSnap: { group: 'Hands and building', label: 'Free placement (ignore the grid)' },
  level: { group: 'Hands and building', label: 'Level the ground' },
  build: { group: 'Hands and building', label: 'Build menu' },

  slot1: { group: 'Hotbar', label: 'Hotbar slot 1' },
  slot2: { group: 'Hotbar', label: 'Hotbar slot 2' },
  slot3: { group: 'Hotbar', label: 'Hotbar slot 3' },
  slot4: { group: 'Hotbar', label: 'Hotbar slot 4' },
  slot5: { group: 'Hotbar', label: 'Hotbar slot 5' },
  slot6: { group: 'Hotbar', label: 'Hotbar slot 6' },
  slot7: { group: 'Hotbar', label: 'Hotbar slot 7' },
  slot8: { group: 'Hotbar', label: 'Hotbar slot 8' },
  slot9: { group: 'Hotbar', label: 'Hotbar slot 9' },
  slot10: { group: 'Hotbar', label: 'Hotbar slot 10' },
  slot11: { group: 'Hotbar', label: 'Hotbar slot 11 (sidearm)' },
  slotNext: { group: 'Hotbar', label: 'Next slot' },
  slotPrev: { group: 'Hotbar', label: 'Previous slot' },

  pack: { group: 'Screens', label: 'Pack and hand crafting' },
  cancel: { group: 'Screens', label: 'Close a menu, drop what is in hand, or open this menu' },
  research: { group: 'Screens', label: 'Research' },
  power: { group: 'Screens', label: 'Power grid' },
  equipment: { group: 'Screens', label: 'Equipment' },
  assembly: { group: 'Screens', label: 'Assembly bay' },
  map: { group: 'Screens', label: 'Map (in flight)' },
  goals: { group: 'Screens', label: 'Show or hide the checklist' },
  mute: { group: 'Screens', label: 'Mute sound' },

  board: { group: 'Flying', label: 'Roll out, or climb in and out' },
  recover: { group: 'Flying', label: 'Recover the vessel and clear the pad' },
  stage: { group: 'Flying', label: 'Stage' },
  throttleUp: { group: 'Flying', label: 'Throttle up' },
  throttleDown: { group: 'Flying', label: 'Throttle down' },
  throttleFull: { group: 'Flying', label: 'Full throttle' },
  throttleCut: { group: 'Flying', label: 'Cut throttle' },
  pitchUp: { group: 'Flying', label: 'Pitch up' },
  pitchDown: { group: 'Flying', label: 'Pitch down' },
  yawLeft: { group: 'Flying', label: 'Yaw left' },
  yawRight: { group: 'Flying', label: 'Yaw right' },
  rollLeft: { group: 'Flying', label: 'Roll left' },
  rollRight: { group: 'Flying', label: 'Roll right' },
  warpUp: { group: 'Flying', label: 'Time warp up' },
  warpDown: { group: 'Flying', label: 'Time warp down' },

  sasToggle: { group: 'Autopilot', label: 'SAS on or off' },
  sasMode: { group: 'Autopilot', label: 'Cycle SAS mode' },
  sasStability: { group: 'Autopilot', label: 'Hold attitude' },
  sasPrograde: { group: 'Autopilot', label: 'Hold prograde' },
  sasRetrograde: { group: 'Autopilot', label: 'Hold retrograde' },
  sasNormal: { group: 'Autopilot', label: 'Hold normal' },
  sasAntinormal: { group: 'Autopilot', label: 'Hold antinormal' },
  sasRadialIn: { group: 'Autopilot', label: 'Hold radial in' },
  sasRadialOut: { group: 'Autopilot', label: 'Hold radial out' },
  sasNode: { group: 'Autopilot', label: 'Hold the maneuver node' },
  sasGuidance: { group: 'Autopilot', label: 'Follow the ascent guidance' },

  rcsFore: { group: 'Flying', label: 'RCS: push toward the nose' },
  rcsAft: { group: 'Flying', label: 'RCS: push toward the tail' },
  rcsLeft: { group: 'Flying', label: 'RCS: slide left' },
  rcsRight: { group: 'Flying', label: 'RCS: slide right' },
  rcsUp: { group: 'Flying', label: 'RCS: slide up' },
  rcsDown: { group: 'Flying', label: 'RCS: slide down' },

  menuUp: { group: 'Menus', label: 'Move up the menu' },
  menuDown: { group: 'Menus', label: 'Move down the menu' },
  menuSelect: { group: 'Menus', label: 'Press the highlighted row' },
};

/** One line of the controls screen. Plain data: src/ui knows nothing else. */
export interface ControlRow {
  action: string;
  label: string;
  /** Every code, already turned into something a player recognises. */
  keys: string[];
  /**
   * The OTHER actions that share one of these codes, if any.
   *
   * Shown rather than hidden, and that is the decision this screen exists to
   * make good on. `Bindings.ts` permits a code to fire two actions provided only
   * one consumer is ever live (you are either walking or strapped in), and that
   * precondition has been broken once already: mute sat on M beside the map and
   * one press did both, because `mute` is read above the `suspended` return.
   * A screen that quietly drew Space twice would be hiding the exact condition
   * that rule depends on. Empty for the great majority of rows.
   */
  sharedWith: string[];
  /** Reserved for the rebind pass. False everywhere today, and said out loud on
   *  the screen rather than implied by a control that does nothing. */
  rebindable: boolean;
}

export interface ControlGroup { name: string; rows: ControlRow[] }

/**
 * The whole screen, derived from `BINDINGS` on every call.
 *
 * Nothing is cached and nothing is transcribed: the codes come from the one
 * table, the display strings from `labelOf` (the same function the HUD hints
 * use), and the collisions from `actionsFor`. There is no path here by which
 * this screen can show a key the game does not actually listen to.
 */
export function controlGroups(): ControlGroup[] {
  const rows = (Object.keys(BINDINGS) as Action[]).map((a): ControlRow => {
    const codes = BINDINGS[a];
    const shared = new Set<string>();
    for (const c of codes) {
      for (const other of actionsFor(c)) if (other !== a) shared.add(other);
    }
    return {
      action: a,
      label: ACTION_TEXT[a].label,
      // `labelOf` only ever reads the FIRST code, because a hint has room for
      // one. This screen has room for all of them, so it labels each in turn
      // through the same transformation rather than inventing a second one.
      keys: codes.length === 0 ? [labelOf(a)] : codes.map(prettyCode),
      sharedWith: [...shared].sort(),
      rebindable: false,
    };
  });
  return CONTROL_GROUPS.map((name) => ({
    name, rows: rows.filter((r) => ACTION_TEXT[r.action as Action].group === name),
  })).filter((g) => g.rows.length > 0);
}

