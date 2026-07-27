// Everything __of.game() says, in one place.
//
// This is a first-class deliverable and not a debug afterthought (WR-11): every
// driven probe reads the world through it, so a number that is missing here is
// a claim that cannot be checked. Split out of Gameplay for the usual reason:
// shaping rows is not a responsibility, and the composition was at the cap.

import { structureReport } from './StructureSave.js';
import { lastSlotRefusal } from './Persist.js';
import type { Gameplay } from './Gameplay.js';

export function gameplayReport(g: Gameplay): unknown {
  return {
      // DW-31, FIRST because it changes the meaning of every number below it.
      // A balance measurement taken in sandbox is not a balance measurement,
      // and a report that does not say which mode it came from cannot be read.
      mode: g.mode.report(),
      nodes: g.field.stats(),
      placed: g.nodesPlaced,
      // THE DEPOSITS. A patch is the whole ore body, so `remaining` here is the
      // number a conservation check has to balance against: what a drill
      // extracted plus what a hand mined must equal what the patch lost.
      ore: g.oreField.report(),
      panelOpen: g.panel.isOpen,
      furnaceOpen: g.furnacePanel.isOpen,
      // GP-25 to GP-27: what is in hand, every menu that EXISTS, and what
      // Escape last did with them. Derived, so a new menu shows up here without
      // anybody adding a line.
      hotbar: g.hotbar.report(),
      modals: g.modals.report(),
      controls: g.keys.report(),
      placements: g.placements,
      machines: g.machines.report(),
      pointerLocked: g.pointerLocked,
      // W6 automation. `factory` is the plan and what /core says about it;
      // `build` is the menu and the ghost; `view` is what is actually drawn.
      factory: g.factory.report(),
      build: g.build.report(),
      view: g.factoryView.stats(),
      // BASE BUILDING. `structures` is what stands and what it cost; `baseView`
      // is what is actually drawn, which is where a batch that has silently run
      // out of instances would show up.
      structures: structureReport(g.structures),
      baseView: g.structView.stats(),
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
      persist: { saves: g.saves, restored: g.restored,
        slotRefused: lastSlotRefusal() },
      demolition: {
        buildings: g.factory.removals, machines: g.machines.removals,
        refunded: g.factory.refunded,
        itemsLost: g.factory.demolishedInFlight,
        oreLost: g.machines.oreLost,
      },
      interact: g.interact.report(),
      carried: g.game.carried(),
      recipes: g.game.recipes().map((r) => ({
        name: g.game.itemName(r.output), craftable: r.craftable,
      })),
    };
}
