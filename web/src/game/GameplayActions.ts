// The verbs: what a key press actually DOES to the pack, a machine or a recipe.
//
// Split out of Gameplay when the W7 checklist landed and the composition crossed
// its 400-line cap, and split along the seam that was already there. Gameplay
// owns ORDER and the POINTER; these thirteen functions own the small
// transactions, and every one of them is the same shape: ask /core, then say so
// out loud.
//
// SAYING SO OUT LOUD IS THE POINT, and it is why they are not one-liners on
// GameCore. A player who presses G with an empty pack must be told why nothing
// happened. The rule is /core's; the sentence is this file's.
//
// BT-295 line-cap batch 3: this file crossed 400 lines itself and became a pure
// barrel, split along the same PACK-versus-WORLD seam the header above already
// drew. `GameplayCraft.ts` holds the pack verbs (slots, recipes, collectFrom,
// refuel, feedMachine, craft); `GameplayBuild.ts` holds the world verbs
// (placeMachine, placeStation, placeAntenna, stepBuild, raze, assignToBar,
// switchMode). Every call site still imports from this path unchanged.

export { slots, recipes, collectFrom, refuel, feedMachine, craft } from './GameplayCraft.js';
export {
  placeMachine, placeStation, placeAntenna, stepBuild, raze, assignToBar, switchMode,
} from './GameplayBuild.js';
