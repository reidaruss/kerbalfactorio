// Everything __of.game() says, in one place.
//
// This is a first-class deliverable and not a debug afterthought (WR-11): every
// driven probe reads the world through it, so a number that is missing here is
// a claim that cannot be checked. Split out of Gameplay for the usual reason:
// shaping rows is not a responsibility, and the composition was at the cap.

import { screenReport } from './MachineScreen.js';
import { offGridGenerators } from './GameplayChrome.js';
import { structureReport } from './StructureSave.js';
import { lastSlotRefusal } from './Persist.js';
import { censusOf } from './HealthCensus.js';
import { saveInhibitReport } from '../sim/SaveInhibit.js';
import type { Gameplay } from './Gameplay.js';

export function gameplayReport(g: Gameplay): unknown {
  return {
      // DW-31, FIRST because it changes the meaning of every number below it.
      // A balance measurement taken in sandbox is not a balance measurement,
      // and a report that does not say which mode it came from cannot be read.
      mode: g.mode.report(),
      nodes: g.field.stats(),
      // WG-67: the streamed world rocks, with the delivery ratio over their own
      // ground and every refusal counted beside its denominator.
      rocks: g.rocks.stats(),
      // WG-116: the streamed world TREES, same shape and same discipline. The
      // ruling that made them nodes ("no scenery trees") is only checkable if
      // the delivery ratio and every refusal are published beside each other.
      trees: g.trees.stats(),
      placed: g.nodesPlaced,
      // GP-268 / R16. THE STARTER SPIRAL, per body, and every entry the airless
      // invariant refused. `refused` non-empty is a LOUD condition and not an
      // error: it means a table asked for a plant on a body with no air, which
      // is a content bug someone can now see. World-gen found 14 trees on
      // Cinder because nothing published any of this.
      starter: {
        bodyId: g.starterBodyId,
        planned: g.field.starterPlanned,
        plants: g.field.starterPlants,
        artPieces: g.nodesPlaced,
        refused: [...g.field.starterRefused],
        unknownBody: g.field.starterUnknownBody,
      },
      // THE DEPOSITS. A patch is the whole ore body, so `remaining` here is the
      // number a conservation check has to balance against: what a drill
      // extracted plus what a hand mined must equal what the patch lost.
      ore: g.oreField.report(),
      panelOpen: g.panel.isOpen,
      furnaceOpen: g.furnacePanel.isOpen,
      // GP-57 to GP-59: WHICH machine the one screen is showing, its slots, and
      // the bar's DRAWN width beside the sim counter it claims to be. Kept
      // beside `furnaceOpen` (which stays, and stays true for both machine
      // families) so nothing already reading that boolean moves.
      screen: screenReport(g),
      // GP-25 to GP-27: what is in hand, every menu that EXISTS, and what
      // Escape last did with them. Derived, so a new menu shows up here without
      // anybody adding a line.
      hotbar: g.hotbar.report(),
      // W11. The three progression layers that were green in /core and
      // unreachable from the game until ABI 9: the tech tree and what it still
      // holds locked, the electrical grid with /core's own Q16 satisfaction
      // integers carried through unrounded, and the player's own suit and
      // practice. `gatesHeld` is the number a sandbox probe once reported as
      // ZERO, which is how we knew none of this was wired.
      progress: g.progress.report(),
      // WHAT THE CROSSHAIR RESOLVED TO. DW-20: a probe that cannot tell "I
      // aimed at nothing" from "the verb is broken" is measuring neither, and
      // this lane lost an hour to exactly that on the hand-feed sweep.
      aimed: {
        machine: g.aimedMachine === null ? null : g.aimedMachine.tier,
        build: g.aimedBuild === null ? null
          : { id: g.aimedBuild.id, kind: g.aimedBuild.kind },
        part: g.aimedPart === null ? null : g.aimedPart.kind,
        // D-019. Published for exactly the reason the three above are: "E did
        // not open the tech tree" has two causes, and without this the probe
        // cannot tell a crosshair that missed the station from an interact
        // branch that never ran.
        station: g.aimedStation === null ? null : g.aimedStation.id,
      },
      modals: g.modals.report(),
      controls: g.keys.report(),
      placements: g.placements,
      machines: g.machines.report(),
      pointerLocked: g.pointerLocked,
      // W6 automation. `factory` is the plan and what /core says about it;
      // `build` is the menu and the ghost; `view` is what is actually drawn.
      factory: g.factory.report(),
      // FS-53. The off-grid GENERATOR count existed only as a rendered pixel:
      // `offGridGenerators` fed the power panel and nothing else, so no headless
      // caller could ask "how many generators are stranded" and `probes/genpole.js`
      // had to read it back out of the DOM. Reading the DOM is the stronger test
      // and stays; but a number a probe can only reach through a panel is a
      // number that vanishes the day the panel is restyled.
      offGridGenerators: offGridGenerators(g),
      build: g.build.report(),
      view: g.factoryView.stats(),
      // BASE BUILDING. `structures` is what stands and what it cost; `baseView`
      // is what is actually drawn, which is where a batch that has silently run
      // out of instances would show up.
      structures: structureReport(g.structures),
      baseView: g.structView.stats(),
      // GP-57. The launch pads: what stands, what it cost, and the clamp state
      // of each. `padView` is separate for the same reason `baseView` is: one
      // is the world and one is the pool, and conflating them hides a pool that
      // has quietly run out.
      pads: g.pads.report(),
      padView: g.padView.stats(),
      // D-019. The research stations. In the world report as well as on the
      // debug surface, because "is there one" is now a fact about the world
      // that changes what a KEY does, and a probe reading the gate in
      // `progress.stationGate` should be able to read the world it is a gate
      // over from the same snapshot.
      stations: g.stations.report(),
      // GP-65. WHAT EVERY PLACED THING CAN TAKE, and what is currently wrong
      // with it. `audit.missing` is the number that matters most and it is the
      // reason this is a report rather than a private map: a live buildable with
      // no health row would be immortal, and immortal is indistinguishable from
      // healthy unless somebody publishes the difference (DW-28). A probe holds
      // both `missing` and `stale` at zero.
      health: g.health.report(censusOf(g)),
      // GP-79. The PLAYER's health, separate from the buildings' book because
      // they are different subjects: one is the base and one is you.
      vitals: g.vitals.report(),
      // GP-86. THE GUN, with the four tells a shot has to produce counted
      // SEPARATELY: a weapon that fires correctly and shows nothing is the
      // failure the whole effects layer exists to prevent, and one combined
      // counter cannot tell it from a weapon that did not fire.
      gun: g.gun.report(),
      shootables: g.shootables.length,
      // GP-87 to GP-93. THE CAUSE AND ITS CONSEQUENCE, in one object: what the
      // base is emitting, what /core has done with it, the nests that ate it,
      // the creatures on the ground, and BOTH ceilings (the pool that would
      // stop drawing them and /core's own cap on wave size). `enabled` is first
      // because a safe sandbox world reports zeroes everywhere below it and
      // those zeroes mean something completely different (GP-93).
      enemies: g.enemies.report(),
      autoCollected: g.autoCollected,
      fx: {
        ...(g.fx.report() as object),
        smokeLive: g.machines.smoke.live, smokePuffs: g.machines.smoke.emitted,
        gains: g.hud.gains, banners: g.hud.banners,
      },
      audio: { ...(g.sfx.stats() as object), ambience: g.ambience.report() },
      // W7 icons. The BYTES of each baked picture, not just a count: a data URL
      // of 0 bytes is a render that produced nothing, which is exactly the
      // failure "14 icons loaded" would hide.
      icons: { ...g.icons.stats, bytes: g.icons.sizes() },
      // W7. The checklist reports the WORLD's verdict, not a stored flag: the
      // predicates are re-asked, so a report that says an objective is done is
      // the same evidence the panel drew.
      goals: g.goals.report(),
      // `slotRefused` is DW-31's negative evidence: '' means nothing was turned
      // away, 'mode' means a slot EXISTS under this key that the running mode
      // will not read. An absence alone cannot tell those apart (DW-20).
      // `saveInhibit` is the SAVE-side twin of `slotRefused`: a save that was
      // never written because the world could not be described (PH-30, a
      // vessel in flight) has to be tellable from a save that simply did not
      // come round yet, which is why the allowed ones are counted too.
      persist: { saves: g.saves, restored: g.restored,
        slotRefused: lastSlotRefusal(), saveInhibit: saveInhibitReport() },
      demolition: {
        buildings: g.factory.removals, machines: g.machines.removals,
        refunded: g.factory.refunded,
        itemsLost: g.factory.demolishedInFlight,
        oreLost: g.machines.oreLost,
      },
      interact: g.interact.report(),
      carried: g.game.carried(),
      recipes: g.game.recipes().map((r) => ({
        // GP-51: `craftable` is the INPUT side and `block` is the whole answer.
        // Both are reported because the pair is the assertion: a row whose
        // inputs are all present and which still will not craft is a full pack,
        // and a boolean cannot say that.
        name: g.game.itemName(r.output), craftable: r.craftable, block: r.block,
        // FS-56: the OUTPUT ITEM and the BILL, which this row could not answer
        // and now has to. `probes/assembler.js` asserts that the assembler's
        // recipe menu is /core's own `handRecipes()` and not a second table the
        // client grew, and that assertion is only worth anything if the probe's
        // reading is INDEPENDENT of the code under test. Reading the bill out of
        // the machine panel instead would be the client agreeing with itself,
        // which is the shape of a check that cannot fail. Same precedent and
        // same argument as FS-33, where the probe surface grew three published
        // rows so the claim could be measured rather than asserted.
        output: r.output,
        inputs: r.inputs.map((i) => [i.item, i.need]),
      })),
    };
}
