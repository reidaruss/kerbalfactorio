// Everything __of.game() says, in one place.
//
// This is a first-class deliverable and not a debug afterthought (WR-11): every
// driven probe reads the world through it, so a number that is missing here is
// a claim that cannot be checked. Split out of Gameplay for the usual reason:
// shaping rows is not a responsibility, and the composition was at the cap.

import type { Gameplay } from './Gameplay.js';

export function gameplayReport(g: Gameplay): unknown {
  return {
      nodes: g.field.stats(),
      placed: g.nodesPlaced,
      panelOpen: g.panel.isOpen,
      furnaceOpen: g.furnacePanel.isOpen,
      placements: g.placements,
      machines: g.machines.report(),
      pointerLocked: g.pointerLocked,
      // W6 automation. `factory` is the plan and what /core says about it;
      // `build` is the menu and the ghost; `view` is what is actually drawn.
      factory: g.factory.report(),
      build: g.build.report(),
      view: g.factoryView.stats(),
      autoCollected: g.autoCollected,
      fx: {
        ...(g.fx.report() as object),
        smokeLive: g.machines.smoke.live, smokePuffs: g.machines.smoke.emitted,
        gains: g.hud.gains, banners: g.hud.banners,
      },
      audio: g.sfx.stats(),
      persist: { saves: g.saves, restored: g.restored },
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
