// THE POINTER TRANSITIONS, and the construction of the three progression
// screens. Split out of Gameplay when research, power and equipment landed and
// the composition hit its 400-line cap, along a seam that was already there:
// Gameplay owns ORDER, and what these functions own is the one operation that
// is neither order nor rule, which is handing the mouse over.
//
// THE TRANSITION IS THE PART WORTH BEING CAREFUL ABOUT and the reason these are
// not two lines each. Opening a panel must release the lock, show the cursor
// and stop the camera dead in the same frame; closing it must take the lock
// back without the mouse having "moved" while the cursor was free.
// `Input.setUiCapture` does both halves, including clearing the accumulated
// deltas, because a frame's worth of unlocked movement applied on re-lock is a
// visible snap and reads as a bug.

import { ProgressUi } from './ProgressUi.js';
import { ASSETS } from '../assets/Registry.js';
import { screenView } from './MachineScreen.js';
import type { EquipSlotName } from '../player/Avatar.js';
import type { Gameplay } from './Gameplay.js';
import type { Machine } from './Machines.js';
import type { Placed } from './Factory.js';

/**
 * Powered machines that NO POLE REACHES, which run at zero.
 *
 * A different sentence from "you are short of power" and worth its own count:
 * the fix for one is a generator and the fix for the other is a pole, and a
 * panel that says the wrong one sends the player to build the wrong thing.
 * -1 from `networkOf` is /core's own "not covered", not an error code.
 */
export function offGridCount(g: Gameplay): number {
  if (!g.factory.power.enabled) return 0;
  let n = 0;
  for (const p of g.factory.placed) {
    if (p.kind !== 'esmelter' || p.build < 0) continue;
    if (g.factory.power.networkOf(p.build) < 0) n++;
  }
  return n;
}

/**
 * FS-53: AND THE SAME COUNT FOR GENERATORS, WHICH THIS PANEL COULD NOT SEE.
 *
 * Reid, live playtest: "i placed a few power poles and they connect to each
 * other but not to the generator." The panel above this one exists precisely to
 * answer that, and it could not, because `offGridCount` asks only about
 * `esmelter`: a generator was never a candidate for being reported off grid, so
 * the one readout that would have told him his generator had joined nothing was
 * structurally incapable of saying it. The empty-state text even ends with
 * "place a generator inside its supply area", which is the right instruction
 * from a panel that then never checks whether you did.
 *
 * IT IS A SEPARATE COUNT AND A SEPARATE SENTENCE, for the reason `offGridCount`
 * already gives about its own: the two faults have different fixes. A CONSUMER
 * off grid is running at zero and needs a pole near it; a GENERATOR off grid is
 * burning fuel that reaches nobody, and every machine on the real network is
 * short by exactly its output. Merging them into one number would produce "3
 * machines are not reached by any pole" for a base whose actual problem is that
 * its only power plant is talking to itself.
 *
 * The predicate is `Power.generatorOffGrid`, which argues why it is an inference
 * from /core's own solve rather than a supply radius copied into the client.
 */
export function offGridGenerators(g: Gameplay): number {
  if (!g.factory.power.enabled) return 0;
  let n = 0;
  for (const p of g.factory.placed) {
    if (p.kind !== 'generator' || p.grid < 0) continue;
    if (g.factory.power.generatorOffGrid(p.grid)) n++;
  }
  return n;
}

/** THE pointer transition for the Tab pack. One place, both halves. */
export function setPackPanel(g: Gameplay, open: boolean): void {
  g.panel.setOpen(open);
  if (open) g.modals.touch(g.panel);
  g.input.setUiCapture(open);
  g.hud.setVisible(!open);
  // The bar STAYS UP behind the pack, and takes the pointer: that is the one
  // moment a player has a cursor to rearrange it with.
  g.hotbarBar.setInteractive(open);
  if (open) g.panel.invalidate();
}

/**
 * Open the machine screen on a hand furnace `m` OR a factory building `b`, or
 * close it with both null. THE pointer transition, for both machine families
 * (GP-57): one panel, one modal entry, one capture.
 */
export function openMachinePanel(g: Gameplay, m: Machine | null,
                                 b: Placed | null = null): void {
  g.openMachine = m;
  g.openBuild = m !== null ? null : b;
  const open = m !== null || g.openBuild !== null;
  g.furnacePanel.setOpen(open);
  if (open) g.modals.touch(g.furnacePanel);
  g.input.setUiCapture(open);
  g.hud.setVisible(!open);
  g.hotbarBar.setVisible(!open);
  if (open) g.furnacePanel.render(screenView(g));
}

/**
 * Build the three progression screens and hand them the transition.
 *
 * Called from `Gameplay.create` rather than the constructor because it needs
 * the factory's own network handle: the grid panel MUST read the same network
 * the machines are on. Reading a second one would give a panel that is always
 * right about a grid nobody is standing in, which is the most expensive kind of
 * wrong a readout can be.
 */
export function attachProgress(g: Gameplay): ProgressUi {
  return new ProgressUi({
    core: g.core,
    host: g.host,
    modals: g.modals,
    game: g.game,
    mode: g.mode,
    power: g.factory.power,
    offGrid: () => offGridCount(g),
    offGridGenerators: () => offGridGenerators(g),
    setCapture: (open) => {
      g.input.setUiCapture(open);
      g.hud.setVisible(!open);
      g.hotbarBar.setVisible(!open);
    },
    flash: (msg, secs) => g.hud.flash(msg, secs),
    icon: (name) => g.icons.for(name),
    // H-4: the render half. Both halves have existed for a night and nothing
    // joined them, so armour was equipped, costed, saved and invisible. The
    // node name is /core's own (`progression.h armourNode`), handed through
    // rather than rebuilt here, because `Armour_Chest_LOD0` is FOUR primitives
    // and GLTFLoader splits it into `_0`.. `_3`: a name this file derived
    // itself would bind whatever it happened to spell.
    armour: (slotName, node, on) => {
      const a = g.avatar;
      if (a === null) return;
      if (on) void a.equip(slotName as EquipSlotName, ASSETS.armourSet, node);
      else a.unequip(slotName as EquipSlotName);
    },
  });
}
