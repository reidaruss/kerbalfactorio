// THE COMPOSITION: what `Gameplay`'s constructor builds, in the order it
// built it (GP-1076, split out under the 400-line cap).
//
// Gameplay.ts's own header has always said the class is "a COMPOSITION, not a
// god object", and this is that sentence made structural: the wiring lives
// here in four ordered phases and the class keeps ORDER and the pointer.
//
// THE ORDER IS THE RULE AND IT IS UNCHANGED. The four run back to back exactly
// where the constructor's four stretches ran, each phase holds a CONTIGUOUS
// run of the original constructor, and every boundary already fell between two
// statements. `showGoals` stays in the constructor between phases two and
// three, at its original position, because it READS `g.goalPanel` (Objectives.
// ts) and so cannot run until the constructor has taken phase two's fields.
//
// EACH PHASE RETURNS ITS FIELDS RATHER THAN ASSIGNING THEM, which is what
// keeps `readonly` and strict definite-assignment on all twenty-eight of them:
// a phase that assigned through the instance would need every field marked `!`
// and TypeScript would stop checking that they are set at all. The price is
// the constructor's assignment list, and it is a price worth paying because it
// is the thing a reader can check against this file line by line.
//
// A PHASE MAY READ `g` FOR A FIELD AN EARLIER PHASE BUILT (the constructor has
// already taken it) and for the inline-initialised ones (`modals`, `hotbar`,
// `goals`, `sfx`), which are live before the constructor body runs at all.
// Closures capturing `g` are deferred by definition and were deferred before.
import { GameCore } from './GameCore.js';
import { NodeField } from './NodeField.js';
import { RockField } from './RockField.js';
import { TreeField } from './TreeField.js';
import { OreField } from './OreField.js';
import { Interact } from '../player/Interact.js';
import { GameHud } from '../ui/GameHud.js';
import { HotbarBar } from '../ui/HotbarBar.js';
import { InventoryPanel } from '../ui/InventoryPanel.js';
import { FurnacePanel } from '../ui/FurnacePanel.js';
import { ObjectivePanel } from '../ui/ObjectivePanel.js';
import { Machines } from './Machines.js';
import { Feedback } from './Feedback.js';
import { Factory } from './Factory.js';
import { FactoryView } from './FactoryView.js';
import { BuildMode } from './BuildMode.js';
import { Structures } from './Structures.js';
import { StructureView } from './StructureView.js';
import { LaunchPads } from './LaunchPad.js';
import { LaunchPadView } from './LaunchPadView.js';
import { ResearchStations } from './ResearchStations.js';
import { Antennas } from './Antennas.js';
import { RuinSites } from './RuinSites.js';
import { Wreckage } from './Wreckage.js';
import { Enemies } from './Enemies.js';
import { Ambience } from './Ambience.js';
import { assignToBar, craft, switchMode } from './GameplayActions.js';
import { loadInto, setRecipe, takeInput, takeOut } from './MachineScreen.js';
import { labelOf } from '../player/Bindings.js';
import type { Gameplay } from './Gameplay.js';
import type { GameplayDeps } from './GameplayDeps.js';

/** Phase one: the ground and what grows on it, plus the player's reach into
 *  it. The only phase that never touches the instance: everything in it is a
 *  pure function of the deps, which is why it takes no `g`. */
export function composeGround(d: GameplayDeps) {
  const game = new GameCore(d.core);
  const field = new NodeField(game, d.origin, d.nodeArt);
  const oreField = new OreField(d.core, d.bodyHandle, field, d.origin);
  // WG-67: the rocks of the world, streamed as REAL harvest nodes. The edits
  // handle is a thunk for the same reason the scatter's is: voxels are
  // created after this and a rock streaming in over a dug pit must seat on
  // the edited surface.
  const rocks = new RockField(d.core, game, field, d.bodyHandle,
    d.seed, d.rocks?.enabled ?? true, d.rocks?.density ?? 1,
    d.bodyRadiusM, d.water,
    () => d.ports?.voxels?.handle ?? 0);
  // WG-116: the trees, on the rocks' lattice contract and their edits thunk.
  const trees = new TreeField(d.core, game, field, d.bodyHandle,
    d.seed, d.trees?.radiusM ?? 0, d.trees?.density ?? 1,
    d.bodyRadiusM, d.water,
    () => d.ports?.voxels?.handle ?? 0);
  const interact = new Interact(game, field, d.player, d.avatar);
  return { game, field, oreField, rocks, trees, interact };
}

/** Phase two: the chrome. The HUD, the bar, the feedback channel and the two
 *  panels that were up before any machine existed. */
export function composeChrome(d: GameplayDeps, g: Gameplay) {
  // The badge is handed in rather than read, so the one place that decides
  // what a mode is called stays GameMode.ts.
  const hud = new GameHud(d.host, g.mode.badge);
  const hotbarBar = new HotbarBar(d.host);
  // Arranging the bar is a POINTER gesture, so it only works while the pack is
  // open: during play the pointer is locked to the canvas and there is no
  // cursor to click a slot with.
  hotbarBar.onSelect = (i) => { g.hotbar.select(i); hotbarBar.invalidate(); };
  hotbarBar.onSwap = (a, b) => { g.hotbar.swap(a, b); hotbarBar.invalidate(); };
  const fx = new Feedback(hud, g.field, g.sfx);
  const panel = new InventoryPanel(d.host, g.modals, (i) => craft(g, i),
    g.mode, (m) => switchMode(g, m), (item) => assignToBar(g, item));
  panel.closer = () => g.setPanel(false);
  const goalPanel = new ObjectivePanel(d.host);
  return { hud, hotbarBar, fx, panel, goalPanel };
}

/** Phase three: the machines, their screen, and the registration that makes
 *  THE HAND A MODAL TOO. */
export function composeMachines(d: GameplayDeps, g: Gameplay) {
  // GP-39: the site registry is handed over LAZILY, because `structures` is
  // built by phase four below and a machine only asks at placement
  // time. That is also what lets a hand furnace land on a foundation.
  const machines = new Machines(d.core, g.game, d.origin, d.bodyHandle,
    () => d.ports?.voxels?.handle ?? 0, g.mode, () => g.structures);
  const furnacePanel = new FurnacePanel(d.host, g.modals,
    (item) => loadInto(g, item), () => takeOut(g), () => takeInput(g),
    (output) => setRecipe(g, output));   // FS-56's fourth verb.
  furnacePanel.closer = () => g.openFurnace(null);
  // THE HAND IS A MODAL TOO, and registering it here rather than special-casing
  // it in the Escape handler is what keeps the guarantee derived: the probe
  // walks `modals.all()` and would catch a menu, or a mode, that skipped it.
  const hotbar = g.hotbar;
  g.modals.register({
    modalName: 'hand',
    get isOpen(): boolean { return hotbar.partInHand !== null; },
    // GP-604. IT SAYS WHAT IT PUT DOWN.
    //
    // Measured in the QOL sweep (GP-557): with a foundation in hand the FIRST
    // Escape returned the hand to `hands` with the menu still shut and the
    // SECOND opened the menu, and NEITHER press drew a single character. The
    // modal stack is behaving exactly as GP-100 designed it and the design is
    // right; what was missing is that a destructive, invisible action was
    // also a SILENT one, so the commonest reason to press Escape mid-build
    // (reach the menu) cost the player their pick with no explanation and no
    // hint that a second press was now needed.
    //
    // THE LABEL IS READ BEFORE THE HAND IS CLEARED, which is the only order
    // that works: `hotbar.label` is derived from what is held, so reading it
    // after `clearHand()` reports `hands` every time. That is the same class
    // as GP-557's own harness bug and it is worth the comment, because the
    // wrong order still compiles, still runs, and still prints a sentence.
    //
    // GP-25 IS NOT WEAKENED. Escape still empties the hand on the first press
    // and still opens the menu on the second; the derivation is untouched.
    // Only the silence goes.
    requestClose: () => {
      const what = hotbar.label;
      if (hotbar.clearHand()) {
        g.hud.flash(`put the ${what} down  (${labelOf('cancel')} again `
          + 'for the menu)', 1.8);
      }
    },
  });
  return { machines, furnacePanel };
}

/** Phase four: everything that stands in the world, the plan that edits it,
 *  and the swarm that comes for it. Ambience leads the phase because it led
 *  this stretch of the constructor; the order is preserved, not tidied. */
export function composeBuildings(d: GameplayDeps, g: Gameplay) {
  const ambience = new Ambience(d.core, d.bodyHandle);
  // The factory ticks on the SIM clock, like everything else that is a rule.
  // DW-24: the edits handle is read LIVE, so a pad flattened with Q reads as
  // flat on the very next tick and the invalid ghost turns valid in the frame
  // the player levels it.
  const structures = new Structures(d.core, g.game, d.bodyHandle,
    () => d.ports?.voxels?.handle ?? 0, g.mode);
  const factory = new Factory(d.core, g.game, d.bodyHandle, 1 / 60,
    g.oreField.patches, structures);
  const factoryView = new FactoryView(d.origin);
  const structView = new StructureView(d.origin);
  const pads = new LaunchPads(g.game, g.mode, structures.bodies);
  const padView = new LaunchPadView(d.origin);
  // D-019. The same argument list `machines` takes, and for the same reasons:
  // the LIVE edits handle so a station put down in a pit belongs in the pit,
  // and the site registry LAZILY so a station can stand on a foundation.
  const stations = new ResearchStations(d.core, g.game, d.origin,
    d.bodyHandle, () => d.ports?.voxels?.handle ?? 0, g.mode,
    () => structures);
  // GP-533. The same argument list the station takes, and for the same
  // reasons.
  const antennas = new Antennas(d.core, g.game, d.origin,
    d.bodyHandle, () => d.ports?.voxels?.handle ?? 0, g.mode,
    () => structures);
  // WG-166. Its own `origin` port and nothing else from this composition: a
  // ruin is world content, not a building, so it takes no `GameCore`, no mode
  // and no site registry. The solid set and the enemy loop are handed to it
  // at the two call sites that need them (`create` and `Persist.apply`),
  // which is what keeps `Gameplay` out of the placement's business.
  const ruins = new RuinSites(d.core, d.bodyHandle, d.origin);
  // D1. Its own `origin` port and nothing else, for the ruin's own reason:
  // rubble is a prop, not a building, so it takes no `GameCore`, no mode and
  // no site registry. The four populations it removes FROM are handed to
  // `fell` at the one call site that needs them (`applyDamage`,
  // GameplayRaze.ts).
  const wreckage = new Wreckage(d.origin);
  const build = new BuildMode(factory, factoryView,
    structures, structView, pads, padView);
  // A hand furnace marks its ingots AT the furnace (GP-64: no roaming toast).
  // Merge note: both lanes wrote this independently and agreed on the
  // behaviour; only the constructor's argument list differed, because the
  // pad lane had added `pads`/`padView` alongside.
  const enemies = new Enemies(d.core, d.bodyHandle, d.origin, g.mode);
  g.machines.onSmelt = (m, n) => g.fx.ingot(n, m.pos, m.up,
    g.game.itemName(g.game.furnaceState(m.handle)?.outItem ?? 0));
  return { ambience, structures, factory, factoryView, structView, pads,
    padView, stations, antennas, ruins, wreckage, build, enemies };
}
