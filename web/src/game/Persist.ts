// Turning the live world into a save slot, and a save slot back into the live
// world. The container and the byte format are SaveGame.ts's; what lives here is
// what counts as state.
//
// THE ORDER ON RESTORE IS NOT FREE. Nodes have to be drained BEFORE the miners
// are placed, because a miner is seeded from its node's remaining ore and would
// otherwise be handed a full deposit and start the world with ore that was mined
// out before the reload. Getting this backwards is the persistence version of
// the two-counters-for-one-pool failure Factory's header is about.
//
// AND WHAT IS NOT SAVED IS SAID OUT LOUD. `apply` returns a ledger with every
// unit it could not bring back, so "my fuel is gone" is a documented number
// rather than a mystery.

import * as THREE from 'three';
import { SAVE_VERSION, readSlot, writeSlot,
  type SaveMachine, type SaveSlot } from './SaveGame.js';
import type { BuildKind, Factory } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { Machines } from './Machines.js';
import type { NodeField } from './NodeField.js';
import type { Gameplay } from './Gameplay.js';
import { scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';

export interface RestoreLedger {
  buildings: number;
  machines: number;
  nodesDepleted: number;
  packUnits: number;
  /** Fuel a furnace was burning. There is no item to give back for a tick. */
  fuelTicksLost: number;
  savedAt: number;
}

export function snapshot(M: OfCoreModule, game: GameCore, field: NodeField,
                         factory: Factory, machines: Machines,
                         seed: number): SaveSlot {
  const n = M._of_gp_inventory_serialize();
  // Copied out of the heap IMMEDIATELY (standing rule 5): every call below
  // re-enters WASM and any growth detaches the view.
  const pack = n > 0 ? Array.from(scratchU8(M, n)) : [];

  const depletion: [number, number][] = [];
  for (const pl of field.placed) {
    const st = game.node(pl.index);
    if (st !== null && st.remaining < st.initial) depletion.push([pl.index, st.remaining]);
  }

  return {
    version: SAVE_VERSION,
    seed,
    savedAt: Date.now(),
    pack,
    depletion,
    buildings: factory.placed.map((p) => ({
      kind: p.kind, cell: p.cell, node: p.nodeIndex,
      pos: [p.pos.x, p.pos.y, p.pos.z] as [number, number, number],
      up: [p.up.x, p.up.y, p.up.z] as [number, number, number],
      fwd: [p.fwd.x, p.fwd.y, p.fwd.z] as [number, number, number],
    })),
    machines: machines.list.map((m): SaveMachine => {
      const st = game.furnaceState(m.handle);
      return {
        tier: m.tier,
        pos: [m.pos.x, m.pos.y, m.pos.z],
        quat: [m.quat.x, m.quat.y, m.quat.z, m.quat.w],
        ore: [st?.oreItem ?? 0, st?.oreCount ?? 0],
        out: [st?.outItem ?? 0, st?.outCount ?? 0],
        fuelTicks: st?.fuelTicks ?? 0,
      };
    }),
  };
}

export function apply(M: OfCoreModule, game: GameCore,
                      factory: Factory, machines: Machines,
                      slot: SaveSlot): RestoreLedger {
  // 1. THE NODES FIRST. of_gp_node_drain is the same call a miner uses, so the
  //    restored world is depleted through the one path that can deplete it.
  let depleted = 0;
  for (const [index, remaining] of slot.depletion) {
    const st = game.node(index);
    if (st === null) continue;
    const take = st.remaining - remaining;
    if (take > 0) { M._of_gp_node_drain(index, take); depleted++; }
  }

  // 2. The pack, from /core's own bytes.
  let packUnits = 0;
  if (slot.pack.length > 0) {
    M._of_gp_bytes_alloc(slot.pack.length);
    // The view is taken AFTER the alloc that sized it and used before anything
    // else re-enters WASM.
    scratchU8(M, slot.pack.length).set(slot.pack);
    packUnits = Math.max(0, M._of_gp_inventory_deserialize());
  }

  // 3. The plan, in one commit.
  const buildings = factory.restore(slot.buildings.map((b) => ({
    ...b, kind: b.kind as BuildKind,
  })));

  // 4. The hand-placed machines, then their contents.
  let restoredMachines = 0;
  let fuelTicksLost = 0;
  for (const s of slot.machines) {
    const m = machines.restore(s.tier,
      { x: s.pos[0], y: s.pos[1], z: s.pos[2] },
      new THREE.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3]));
    if (m === null) continue;
    restoredMachines++;
    // Contents go back through the PACK, because furnaceInsert is the only door
    // into the ore pool and it deducts from the pack by design (that is what
    // makes loading atomic). Adding then inserting the same count is a
    // round trip with no window in which the units exist twice.
    if (s.ore[0] > 0 && s.ore[1] > 0) {
      game.add(s.ore[0], s.ore[1]);
      game.furnaceInsert(m.handle, s.ore[0], s.ore[1]);
    }
    // Finished ingots have nowhere to be put back inside the machine, so they
    // go to the pack: the player keeps them, which is the honest direction for
    // a rounding error to fall.
    if (s.out[0] > 0 && s.out[1] > 0) game.add(s.out[0], s.out[1]);
    fuelTicksLost += s.fuelTicks;
  }

  return {
    buildings, machines: restoredMachines, nodesDepleted: depleted,
    packUnits, fuelTicksLost, savedAt: slot.savedAt,
  };
}

/**
 * The two calls Gameplay actually makes. They live here rather than there
 * because a save is a whole-world operation and Gameplay is a composition: the
 * type import is erased, so the apparent cycle costs nothing at runtime.
 */
export async function saveSlot(g: Gameplay): Promise<unknown> {
  const slot = snapshot(g.core, g.game, g.field, g.factory, g.machines, g.seed);
  const ok = await writeSlot(slot);
  if (ok) g.saves++;
  return ok ? {
    bytes: slot.pack.length, buildings: slot.buildings.length,
    machines: slot.machines.length, depletion: slot.depletion.length,
  } : null;
}

export async function loadSlot(g: Gameplay): Promise<RestoreLedger | null> {
  const slot = await readSlot();
  // A slot from another seed is a different planet, and loading it would drop
  // buildings onto terrain that is not there.
  if (slot === null || slot.seed !== g.seed) return null;
  g.restored = apply(g.core, g.game, g.factory, g.machines, slot);
  g.panel.invalidate();
  g.hud.flash(`restored ${g.restored.buildings} buildings, `
    + `${g.restored.packUnits} items`, 2.6);
  return g.restored;
}
