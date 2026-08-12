// ObjectiveList.ts - THE CHECKLIST ITSELF, as data.
//
// LIFTED VERBATIM OUT OF Objectives.ts (GP-350), which is GP-206's move for the
// fourth time and on the same argument: three flight rows took that file from
// 391 lines to 535 against a 400-line cap, and the cap is the cap. Nothing in
// the lift changed. The split is along the seam the code already had, and it is
// a seam this domain's charter names in as many words: **recipes, tech, quests
// and loot are DATA so balance iterates without code.** The rows are content;
// `Objectives` is the walk over them. One file is edited when the opening is
// reworded and the other when the machine changes, and those are different
// jobs done by different passes.
//
// Everything here is re-exported by `Objectives.ts`, so no consumer moved.

import { labelOf } from '../player/Bindings.js';
import type { Action } from '../player/Bindings.js';
import type { Gameplay } from './Gameplay.js';
import { bodyIsAirless } from './StarterContent.js';

/**
 * What the checklist is allowed to know about the assembly bay and flight.
 *
 * A PORT, set by the composition root once both exist, because both are
 * dynamically imported and neither is built when this list is defined. Null
 * with `?vab=0` or `?flight=0`, and the two objectives below retire themselves
 * in that case rather than stalling a checklist for ever on a feature the run
 * deliberately isolated.
 */
export interface RocketPort {
  /** Parts on the assembly bay's stand right now. */
  parts(): number;
  /** Vessels set down on the ground this session. */
  rollouts(): number;
  /** Times the player has climbed into one. */
  boardings(): number;
}

/**
 * GP-350. WHAT THE CHECKLIST IS ALLOWED TO KNOW ABOUT FLYING AND THE MAP.
 *
 * A SECOND port rather than three more methods on `RocketPort`, and the reason
 * is where each one can be wired. `RocketPort` is set in `Boot` beside the bay
 * and the flight mode; these three facts live in the MAP, which `bootMap`
 * builds afterwards and which owns both the open count and the planner's
 * selection. One port per composition site keeps each set by the thing that
 * knows it, instead of `Boot` reaching forward into an object it has not built
 * yet.
 *
 * NULL RETIRES THE ROWS, exactly as a null `RocketPort` retires the two before
 * them: `?flight=0` and `?gameplay=0` never build a map, and a checklist that
 * parked for ever on "fly it to orbit" in a run that deliberately isolated
 * flight would be GP-286's defect with a different cause. Because null makes
 * three rows report DONE, `Objectives.report().voyage` publishes whether the
 * port is wired, so a probe asserts the antecedent before it believes any of
 * them (INSTRUMENTS.md: an implication with a false antecedent is vacuously
 * true, and here the antecedent is "there is a map at all").
 */
export interface VoyagePort {
  /** `FlightSession.status`: CLAMPED / ASCENT / COAST / DOWN / ORBIT. Asked of
   *  the session rather than mirrored, so the row and the navball's own status
   *  chip cannot disagree about whether this is an orbit. */
  status(): string;
  /** Times the map has been opened this session. */
  mapOpens(): number;
  /** The planner's selected destination id. '' is "nothing picked", which is a
   *  real state and NOT the value the row is looking for. */
  destinationId(): string;
}

export interface Objective {
  id: string;
  /** The imperative. */
  text: string;
  /** GP-165: a FUNCTION of the live game, never a string, so a key or a slot
   *  number can only ever be derived. See the block comment above OBJECTIVES. */
  hint: (g: Gameplay) => string;
  done: (g: Gameplay, r: RocketPort | null, v: VoyagePort | null) => boolean;
  /**
   * GP-286. '' when this card applies to the world the player is standing on.
   * Otherwise the SENTENCE saying why this world cannot satisfy it.
   *
   * A checklist that names a task the world has refused to make possible is
   * GP-165's defect one level up: not a wrong KEY for a real task, a wrong
   * TASK. `Harvest a tree` has been the first thing a player reads on Cinder,
   * which is airless and on which `StarterContent`'s own invariant REFUSES to
   * place a tree. The card was impossible, the list parked on it, and nothing
   * downstream of it could ever be reached.
   *
   * A moot card is DRAWN AND NAMED rather than filtered out, which is GP-114's
   * rule (a locked thing named beats an absent thing) and is why this returns a
   * sentence rather than a boolean: "there are no trees here" teaches a player
   * something about where they are, and a list that silently got shorter
   * teaches them nothing and looks like a bug.
   */
  moot?: (g: Gameplay) => string;
}

/** How many ingots off an automated line count as "it ran without you". */
const AUTO_TARGET = 1;

/**
 * GP-165. THE NUMBER KEY FOR WHATEVER SLOT HOLDS `part` RIGHT NOW, read off
 * the live hotbar, because the bar is editable (GP-108) and a hint that says
 * "press 4" about a slot the player emptied is teaching a dead key. Falls back
 * to naming the build menu, which can always put the part in hand.
 */
function slotOf(g: Gameplay, part: string): string {
  const i = g.hotbar.slots.findIndex((s) => s.kind === 'part' && s.part === part);
  return i >= 0 ? labelOf(`slot${i + 1}` as Action)
    : `the build menu (${labelOf('build')})`;
}

/**
 * GP-550. THE WHOLE PHRASE, not a bare key, for the hints that need a verb in
 * front of it. `slotOf` returns "2" or "the build menu (B)", and both of those
 * were being spliced into sentences that then read "craft a furnace, 2 and Left
 * click place it" and "press the build menu (B), then Left click". The
 * derivation is untouched (GP-165's whole point) and only the grammar moves:
 * one branch needs "press", the other needs "open", and only the function that
 * knows which branch it took can say which.
 */
function holdPhrase(g: Gameplay, part: string): string {
  const i = g.hotbar.slots.findIndex((s) => s.kind === 'part' && s.part === part);
  return i >= 0 ? `press ${labelOf(`slot${i + 1}` as Action)}`
    : `open the build menu (${labelOf('build')})`;
}

/**
 * GP-602. A STEP THE MODE HAS ALREADY SATISFIED SAYS SO, RATHER THAN
 * INSTRUCTING THE PLAYER TO DO IT.
 *
 * The pad hint read `research Launch Facilities (J), then press 0 ...` in
 * SANDBOX, where `ModeRules.researchGated` is false, the tech gates nothing,
 * and the build menu two keys away was already offering the pad for free. So
 * the very first sentence a sandbox player read about the launch pad sent them
 * to a screen that could not help them, to buy a thing they already had.
 *
 * This is GP-165's argument one level up. GP-165 made every KEY in a hint
 * derived so a remap could not leave a wrong control on screen. A gate is the
 * same kind of fact: it is true in one mode and false in another, and a hint
 * that hard-codes it is a wrong instruction in exactly the mode Reid plays.
 * So the prerequisite CLAUSE is derived from the mode too, and a future row
 * that names a gate gets it right by calling this rather than by remembering.
 *
 * It does NOT delete the tech's name in sandbox, deliberately. Reid uses
 * sandbox to test the real game, so the sentence still tells him what survival
 * would ask for; it just stops telling him to go and do it.
 */
function gateClause(g: Gameplay, tech: string): string {
  return g.mode.researchGated
    ? `research ${tech} (${labelOf('research')}), then `
    : `${tech} is not needed in sandbox, so `;
}

/** The furnace's own slot, same derivation (it is a `furnace` kind, not a part). */
function furnaceHold(g: Gameplay): string {
  const i = g.hotbar.slots.findIndex((s) => s.kind === 'furnace');
  return i >= 0 ? `press ${labelOf(`slot${i + 1}` as Action)}`
    : `open the build menu (${labelOf('build')})`;
}

/**
 * GP-165. EVERY KEY AND SLOT IN A HINT IS DERIVED, never typed.
 *
 * The first six hints a new player read carried FIVE wrong controls between
 * them: "hold E" for a harvest the left button does (GP-26 moved it), "G to
 * place" for a placement that is a click (GP-27 moved it), "press 1" for a
 * drill that sits on slot 3, and "press 2 for belt, 3 for smelter" about
 * slots 4 and 5. Every one was true when written and nobody re-read this file
 * across two control remaps and a hotbar rework, which is the project's
 * fourth wrong-key-on-screen incident (the mute hint, the map hint, GP-140's
 * two prettifiers). Same fix as all three: the ONE binding table spells every
 * control, and a slot number comes off the LIVE bar, so an edited hotbar
 * re-teaches its own layout. `probes/goalhints.js` reassigns the drill
 * mid-run and watches the drawn hint follow it, which no prose can pass.
 */
export const OBJECTIVES: Objective[] = [
  {
    id: 'wood', text: 'Harvest a tree',
    hint: () => `aim at one and hold ${labelOf('use')}`,
    done: (g) => g.game.count(g.game.ids.wood) >= 4,
    // THE SAME AUTHORITY THAT REFUSED TO PLACE THE TREE. Not a body name and
    // not a second atmosphere test: `bodyIsAirless` is the one copy of the
    // question, so the day a body grows an atmosphere its trees and this card
    // come back together.
    moot: (g) => (bodyIsAirless(g.core, g.starterBodyId)
      ? 'nothing grows here: this body has no air, so there is no tree to '
        + 'harvest and no wood on it at all.' : ''),
  },
  {
    id: 'stone', text: 'Gather loose stone',
    hint: () => `aim at a rock and hold ${labelOf('use')}`,
    done: (g) => g.game.count(g.game.ids.stone) >= 2,
    // GP-506. THE SAME DEFERRAL WOOD'S CARD ALREADY NAMES, one card later:
    // RockTuning's moon densities are 0 (WG-67..72 deferred the moon pass),
    // so an airless body has no rock nodes any more than it has trees. Spawn
    // never actually lands there (StarterContent: Cinder is arrived at, not
    // spawned on), but the card names the impossibility rather than parking
    // silently, exactly like `wood` does, if that ever changes.
    moot: (g) => (bodyIsAirless(g.core, g.starterBodyId)
      ? 'nothing grows here: this body has no air, and no rock node has been '
        + 'placed on it either.' : ''),
  },
  {
    id: 'tool', text: 'Craft a pickaxe',
    // GP-506: the bill is Stone x2 + Wood x1, never ore — that is the whole
    // point (ore is gated behind the tool this recipe makes).
    hint: () => `2 stone + 1 wood, ${labelOf('pack')} opens the pack`,
    done: (g) => g.game.count(g.game.ids.pickaxe) >= 1,
  },
  {
    id: 'ore', text: 'Mine iron ore',
    // GP-506: bare hands are refused on ore now (harvestGate), so the hint
    // says what unlocks it rather than just where it is.
    hint: () => 'the grey-blue patch of ground — needs the pickaxe in hand',
    done: (g) => g.game.count(g.game.ids.rawIron) >= 5,
  },
  {
    id: 'smelt', text: 'Smelt it into iron',
    hint: (g) => `craft a furnace, ${furnaceHold(g)} to hold it, `
      + `${labelOf('use')} to place it, then ${labelOf('interact')} opens it`,
    done: (g) => g.game.count(g.game.ids.iron) >= 1,
  },
  {
    id: 'miner', text: 'Put a drill on an ore patch',
    hint: (g) => `${holdPhrase(g, 'miner')}, then ${labelOf('use')}`,
    done: (g) => g.factory.placed.some((p) => p.kind === 'miner'),
  },
  {
    id: 'belt', text: 'Run a belt from it to a smelter',
    hint: (g) => `${slotOf(g, 'belt')} is belt, ${slotOf(g, 'smelter')} is `
      + `smelter, ${labelOf('rotate')} turns`,
    done: (g) => g.factory.placed.some((p) => p.kind === 'belt')
      && g.factory.placed.some((p) => p.kind === 'smelter'),
  },
  {
    id: 'auto', text: 'Walk away, then take what it made',
    hint: () => `${labelOf('interact')} opens the smelter, click its output`,
    done: (g) => g.autoCollected >= AUTO_TARGET,
  },
  // ==========================================================================
  // D-019. THE RESEARCH STATION, AND IT IS A RUNG RATHER THAN A FOOTNOTE.
  //
  // `story_line_outline_v1.txt` puts BUILDING it after belts and smelting and
  // before the scanning antenna, and that ORDER is the thing this card teaches:
  // it sits immediately after `auto` (the belt-and-smelter rung that proves the
  // factory runs without you) and before `pad`, so a player reads the chain in
  // the order the storyline states it. Until tonight there was no research card
  // here at all, which is the same failure GP-53 names about the space half:
  // the tech tree has been in the build for months and NOTHING on screen led a
  // player to it.
  //
  // THE ROW RETIRES ON THE STATION EXISTING, not on a tech being bought, for
  // the pad row's own reason: what the player has to do is build the thing, and
  // a checklist that ticks itself when you press a research button has taught
  // them nothing about where the station goes.
  //
  // THE HINT NAMES THE BUILD MENU DIRECTLY, and not through `holdPhrase`. The
  // station is not a `PartKind` and can never occupy a bar slot (Hotbar.ts says
  // why), so `holdPhrase` would search the bar, find nothing and take its
  // fallback branch every single time: the right sentence reached by a lookup
  // that is guaranteed to miss, which reads as derivation and is not. GP-165's
  // rule is that no KEY is ever typed, and none is: `labelOf('build')` is the
  // one binding table, so a remap moves this hint exactly as it moves the rest.
  {
    id: 'station', text: 'Build a research station',
    hint: () => `open the build menu (${labelOf('build')}), ${labelOf('use')} `
      + `to place it, then ${labelOf('interact')} at it opens the tech tree`,
    done: (g) => g.stations.list.length >= 1,
  },
  // GP-53. THE SPACE HALF OF THE GAME HAD NO ENTRANCE. The assembly bay and
  // flight have been in the build since W8 and W9 and NOTHING on screen named
  // either of them: not the HUD, not the pack, not the hotbar, not this list.
  // Reid built a base and then had to ask "how do i build a launchpad and
  // rocket, i cant find it in the menu", and he was right, it was not there.
  //
  // This list is the answer rather than a HUD line or a menu entry, for three
  // reasons. It already teaches the opening step by step and RETIRES itself
  // when done, so it costs nothing after the first hour where a permanent HUD
  // line is clutter for ever. It is data, so the wording iterates without code.
  // And it is ORDERED, so the rocket appears after the factory that pays for
  // it, which is DW-29's "ground progression first" stated where a player can
  // actually read it. Both rows are visible as upcoming from the first minute,
  // which is the part that answers "I cannot find it".
  // GP-57. THE PAD, NAMED, and BEFORE the rocket rather than after it.
  //
  // The order is the teaching. A player who builds a rocket first and then
  // discovers it needs a launch site has done the two halves in the order that
  // makes the second one feel like a tax; doing the platform first makes the
  // rocket the reward. It is also the honest order for the costs: 36
  // foundations plus 60 Iron is a project, and finding that out AFTER assembling
  // a vehicle is the sort of thing that makes a player put a game down.
  //
  // The row RETIRES on the pad existing rather than on the tech being bought,
  // because what the player has to do is build the thing, and a checklist that
  // ticks itself when you press a research button has taught you nothing about
  // where the pad goes.
  {
    id: 'pad', text: 'Build a launch pad on a 6 x 6 foundation platform',
    hint: (g) => `${gateClause(g, 'Launch Facilities')}`
      + `${holdPhrase(g, 'launchpad')} to put one in your hand`,
    done: (g) => g.pads.list.length >= 1,
  },
  {
    id: 'rocket', text: 'Build a rocket in the assembly bay',
    hint: () => `press ${labelOf('assembly')} to go in, click parts onto the stack`,
    done: (_g, r) => r === null || r.parts() >= 2,
  },
  {
    id: 'launch', text: 'Roll it out and climb aboard',
    hint: () => `${labelOf('board')} rolls it onto the pad, ${labelOf('board')} `
      + `again straps you in`,
    done: (_g, r) => r === null || r.boardings() >= 1,
  },
  // ==========================================================================
  // GP-350. THE CHAIN CONTINUES PAST THE PAD.
  //
  // Every row above this one is on the ground, and the list ENDED at the pad,
  // so a player who did everything the game asked of them was handed a rocket
  // and no next sentence. The space half of this game has an orbit, a map, a
  // station, a moon and an autopilot in it, and NOTHING on screen led from the
  // one to the other: `launchStep` hands off at ORBIT with "M opens the map"
  // and that was the whole thread.
  //
  // THESE THREE ADD NO CONTENT AND THAT IS DELIBERATE. What is actually worth
  // going to the moon FOR (the science, the loot, the resource gate) is a
  // design question that is not this lane's to invent, and inventing it here
  // would be authoring a progression spine inside a hint string. The thread and
  // the reward are different questions: a player is entitled to know that the
  // map exists and has places on it long before anybody decides what is at
  // them. So the last row asks only that a destination be LOOKED at.
  //
  // THEY ARE THE FIRST ROWS IN THIS LIST THAT CANNOT BE DONE ON FOOT, which is
  // why `stepGoals` pins the panel open in the cockpit: every composition root
  // hides the checklist with the walker's HUD, and the act that reaches these
  // rows is exactly the act that hides it.
  {
    id: 'orbit', text: 'Fly it to orbit',
    // NOT a second flying tutorial. `LaunchSteps.launchStep` already draws the
    // standing instruction under the navball, one state at a time, and a
    // second copy here would be two vocabularies for one act (GP-270's rule)
    // and would go stale the first time that ladder changed. This names the two
    // keys that start it and then points at the line that knows the rest.
    hint: () => `${labelOf('stage')} lights it, ${labelOf('throttleUp')} `
      + 'throttles up; the line under the ball says what is next',
    done: (_g, _r, v) => v === null || v.status() === 'ORBIT',
  },
  {
    id: 'map', text: 'Open the map',
    hint: () => `${labelOf('map')} opens it, on the ground or in orbit`,
    done: (_g, _r, v) => v === null || v.mapOpens() >= 1,
  },
  {
    id: 'where', text: 'Pick a destination on the map',
    hint: () => 'the Autopilot list: the station in orbit, the moon, or an '
      + 'orbit you name yourself',
    done: (_g, _r, v) => v === null || v.destinationId() !== '',
  },
];
