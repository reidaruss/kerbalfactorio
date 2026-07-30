// Turning the live world into a save slot, and a save slot back into the live
// world. The container and the byte format are SaveGame.ts's; what lives here is
// what counts as state.
//
// THE ORDER ON RESTORE IS NOT FREE. The ore PATCHES have to be drained BEFORE
// the drills are placed, because a drill is seeded from its patch's remaining
// ore and would otherwise be handed a full deposit and start the world with ore
// that was mined out before the reload. Getting this backwards is the
// persistence version of the two-counters-for-one-pool failure Factory's header
// is about.
//
// AND WHAT IS NOT SAVED IS SAID OUT LOUD. `apply` returns a ledger with every
// unit it could not bring back, so "my fuel is gone" is a documented number
// rather than a mystery.

import * as THREE from 'three';
import { rescueBefore } from './FactoryRescue.js';
import { SAVE_VERSION, chestStore, readSlot, slotKey, writeSlot, type SaveMachine,
  type SaveProgress, type SaveSlot, type SlotRefusal } from './SaveGame.js';
import type { GameMode } from './GameMode.js';
import type { BuildKind, Factory } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { Machines } from './Machines.js';
import type { NodeField } from './NodeField.js';
import type { RockField } from './RockField.js';
import type { OreField } from './OreField.js';
import type { Structures } from './Structures.js';
import type { Hotbar } from './Hotbar.js';
import type { StructureView } from './StructureView.js';
import type { Gameplay } from './Gameplay.js';
import { restoreStructures, saveParts, saveSites } from './StructureSave.js';
import { restorePads, savePads } from './LaunchPadSave.js';
import type { LaunchPads } from './LaunchPad.js';
import { NO_VOXELS, restoreEdits, snapshotEdits, type VoxelMeshPort,
  type VoxelPort, type TerrainDigPort } from './VoxelSave.js';
import { scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';
import { discAbi } from '../sim/wasm/discabi.js';
import { noteSave, saveInhibit } from '../sim/SaveInhibit.js';
import type { HealthBook } from './Health.js';
import type { PlayerHealthSave } from './PlayerHealth.js';
import { rebuildHealth } from './HealthCensus.js';

/** The three Services handles a whole-world save needs and gameplay does not own. */
/**
 * Why the last load refused a slot that EXISTS, for the report.
 *
 * Module state rather than a field on Gameplay because the refusal happens
 * before anything is restored, so there is no ledger to hang it on, and DW-20
 * says a harness must be able to prove its own setup: a probe asserting "the
 * survival boot did not read the sandbox world" needs to see the refusal, not
 * just an absence.
 */
let lastRefusal: SlotRefusal = '';
export function lastSlotRefusal(): SlotRefusal { return lastRefusal; }

export interface WorldPorts {
  voxels: VoxelPort | null;
  voxelMesh: VoxelMeshPort | null;
  terrain: TerrainDigPort | null;
}

// FS-82. The research and player half moved to `PersistProgress.ts` when the
// rescue copy pushed this file past its cap; re-exported because every caller in
// the client asks `Persist` for it, which is the same call `PersistLedger` made.
import { restoreProgress, saveProgress } from './PersistProgress.js';
export { restoreProgress, saveProgress } from './PersistProgress.js';

// The receipt a load hands back. It lives in its own file (this one is at its
// line cap) and is re-exported here, because every caller in the client asks
// `Persist` for it and moving a published name to make room is a worse trade
// than one line of forwarding, which is the same call `Structures.ts` made.
import type { RestoreLedger } from './PersistLedger.js';
export type { RestoreLedger } from './PersistLedger.js';

export function snapshot(M: OfCoreModule, game: GameCore, field: NodeField,
                         factory: Factory, machines: Machines,
                         seed: number, ports: WorldPorts,
                         ore: OreField, structures: Structures,
                         pads: LaunchPads,
                         hotbar: Hotbar, mode: GameMode,
                         progress: SaveProgress | undefined,
                         health: HealthBook,
                         vitals: PlayerHealthSave,
                         rocks: RockField): SaveSlot {
  // THE TUNNELS FIRST, because of_edits_serialize and of_gp_inventory_serialize
  // write into the SAME u8 scratch: the second call would silently overwrite the
  // first one's bytes if they were not copied out one at a time.
  const voxels = snapshotEdits(M, ports.voxels);
  const n = M._of_gp_inventory_serialize();
  // Copied out of the heap IMMEDIATELY (standing rule 5): every call below
  // re-enters WASM and any growth detaches the view.
  const pack = n > 0 ? Array.from(scratchU8(M, n)) : [];
  // DW-36 / DW-17: WHAT THE PLAYER HAS SEEN goes in the same atomic slot as
  // everything else. It is read straight off /core rather than through the map,
  // because the discovery field is world state that lives in `discovery.h` and
  // the map is only one of its readers - a save that had to wait for a panel to
  // exist would be a save that is wrong whenever `?flight=0`. Same u8 scratch,
  // so same rule: copy out before the next call.
  const dn = discAbi(M)._of_disc_serialize();
  const discovery = dn > 0 ? Array.from(scratchU8(M, dn)) : [];

  // Nodes first, and NOT the outcrops. An outcrop reports its patch's pool, so
  // writing it here would record the same ore once per outcrop and drain it that
  // many times on load: the diff is keyed by what OWNS the ore, and for ore that
  // is the patch. The outcrops are named exactly, not inferred from where they
  // stand, because a tree growing on an ore body would be misread and its own
  // depletion silently dropped.
  const outcrops = ore.outcropIndices();
  // WG-70: world rocks are excluded here and saved under their own CELL key.
  // A rock's array index is its visit order, so the index-keyed diff below
  // would drain somebody else's node on a differently-walked reload.
  const rockIdx = rocks.coreIndices();
  const depletion: [number, number][] = [];
  for (const pl of field.placed) {
    if (outcrops.has(pl.index) || rockIdx.has(pl.index)) continue;
    const st = game.node(pl.index);
    if (st === null || st.remaining >= st.initial) continue;
    depletion.push([pl.index, st.remaining]);
  }
  const patches: [number, number][] = [];
  for (let i = 0; i < ore.patches.count; ++i) {
    const p = ore.patches.patch(i);
    if (p !== null && p.remaining < p.initial) patches.push([i, p.remaining]);
  }

  return {
    version: SAVE_VERSION,
    seed,
    // DW-31. The mode is written into the slot as well as deciding its key, so
    // a world can always answer what it is without anybody consulting where it
    // was found. SaveGame.ts has the argument for keeping both.
    mode,
    savedAt: Date.now(),
    pack,
    voxels,
    discovery,
    depletion,
    patches,
    rocks: rocks.serialize(),
    sites: saveSites(structures),
    structures: saveParts(structures),
    pads: savePads(pads),
    hotbar: hotbar.serialize(),
    progress,
    // GP-65. The WOUNDS, and only the wounds: the book is the one authority on
    // the number, so nothing here re-derives it.
    health: health.serialize(),
    // GP-79. The player is world state too.
    vitals,
    buildings: factory.placed.map((p) => ({
      kind: p.kind, cell: p.cell, patch: p.patch,
      // Read LIVE off the grid rather than off the record, so a generator that
      // has been burning since the last commit saves what it actually holds.
      fuel: p.kind === 'generator' && p.grid >= 0
        ? factory.power.generatorFuel(p.grid) : p.fuel,
      pos: [p.pos.x, p.pos.y, p.pos.z] as [number, number, number],
      up: [p.up.x, p.up.y, p.up.z] as [number, number, number],
      fwd: [p.fwd.x, p.fwd.y, p.fwd.z] as [number, number, number],
      // FS-46. A slot written from here has been through the port model, so it
      // must never be migrated again: a second rotation pass over a base the
      // player has since re-aimed by hand would turn machines they turned on
      // purpose. Absent on every slot written before FS-44, and that absence is
      // the migration's only hinge.
      ports: true,
      recipe: p.recipe, store: chestStore(factory.line, p),  // FS-56 / FS-70.
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

export function apply(g: Gameplay, M: OfCoreModule, game: GameCore,
                      factory: Factory, machines: Machines,
                      slot: SaveSlot, ports: WorldPorts,
                      ore: OreField, structures: Structures,
                      structView: StructureView, hotbar: Hotbar,
                      rescue = ''): RestoreLedger {
  // 0. THE TUNNELS, before anything reads the ground. A restored dig lowers the
  //    surface the oracle reports, and a miner or a machine placed against the
  //    old, un-dug column would sit at the wrong height.
  const voxels = restoreEdits(M, ports.voxels, ports.voxelMesh, ports.terrain,
    slot.voxels ?? NO_VOXELS);

  // 0b. WHAT THE PLAYER HAD SEEN (DW-36). Before the ore, because an ore patch
  //     the map may draw is gated on the fine discovery grid and a frame drawn
  //     between the two would flash every patch on the planet. A slot written
  //     before this field simply has none, which reads as an unexplored world
  //     and is the honest answer for a save that never recorded one.
  //     `restored` is -1 when /core REFUSED the stream (a different lattice, or
  //     not ours). That is surfaced in the ledger rather than swallowed: a world
  //     that quietly forgets where you have been is exactly what DW-17 exists
  //     to prevent, and a zero would be indistinguishable from a new game.
  let discovery = 0;
  const dbytes = slot.discovery ?? [];
  if (dbytes.length > 0) {
    const D = discAbi(M);
    D._of_disc_alloc_bytes(dbytes.length);
    scratchU8(M, dbytes.length).set(dbytes);
    discovery = D._of_disc_deserialize();
  }

  // 1. THE ORE PATCHES, and then the standalone nodes. Both go back through the
  //    SAME extraction call the live world uses (of_gp_patch_drain /
  //    of_gp_node_drain), so a restored world is depleted through the one path
  //    that can deplete it and a save can never invent a state mining cannot
  //    reach. Patches first, because a drill placed in step 3 is seeded from one.
  let patchesDepleted = 0;
  for (const [index, remaining] of slot.patches ?? []) {
    const p = ore.patches.patch(index);
    if (p === null) continue;
    const take = p.remaining - remaining;
    if (take > 0) { ore.patches.drain(index, take); patchesDepleted++; }
  }
  let depleted = 0;
  for (const [index, remaining] of slot.depletion) {
    const st = game.node(index);
    if (st === null) continue;
    const take = st.remaining - remaining;
    if (take > 0) { M._of_gp_node_drain(index, take); depleted++; }
  }
  // 1b. THE WORLD ROCKS (WG-70), cell-keyed. Rocks standing in the streamed
  //     ring drain now; the rest go pending and drain the moment they
  //     materialise, through the same of_gp_node_drain the trees use.
  const rocksApplied = g.rocks.restore(slot.rocks);

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
  })), rescue);

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

  // 5. THE BASE. Last, because a part rests on the ground and the ground has to
  //    have finished moving: a restored dig lowers the surface, and a foundation
  //    placed against the un-dug column would read as floating.
  //    The batch is emptied FIRST or every old instance keeps drawing where it
  //    stood, which is the same bug FactoryView.release exists to prevent.
  for (const p of structures.parts) structView.release(p.id);
  const restoredParts = restoreStructures(structures, slot.sites ?? [],
    slot.structures ?? []);
  // 5b. THE LAUNCH PADS, after the decks and for the same reason the decks come
  //     after the tunnels: a pad's base plane IS a deck's top face (GP-58), so
  //     restoring one before its platform would anchor it against a site that
  //     is not there yet. Its own batch is emptied first, exactly as the
  //     structural one is, or a demolished pad keeps drawing where it stood.
  for (const p of g.pads.list) g.padView.release(p.id);
  const restoredPads = restorePads(g.pads, slot.pads);

  // 5c. WHAT IS BROKEN (GP-65). LAST of the world steps, because every
  //     population has to be standing before the book can be told what is wrong
  //     with it: a wound applied earlier would land on a key nothing answers to
  //     and be counted as an orphan. The three-step order lives in `HealthCensus`
  //     with its reasoning, as one call, so a caller cannot get it wrong.
  const health = rebuildHealth(g.health, g, slot.health);
  // GP-79. Independent of the base: a player's health belongs to the player.
  const vitals = g.vitals.restore(slot.vitals);

  // 6. THE BAR. Last and independent of everything above: it is a setting, not
  //    a piece of the world, and a malformed row falls back to empty rather
  //    than throwing, because a save must never be able to brick a boot.
  const hotbarRestored = hotbar.restore(slot.hotbar);
  const progress = restoreProgress(g, slot.progress);

  // 7. THE PROGRESSION SPINE, after the pack, and that ORDER MATTERS: armour
  //    is restored WITHOUT touching the pack (the pack already came back from
  //    its own bytes at step 2, with the worn pieces correctly absent from it),
  //    so doing it the other way round would take four items out of an
  //    inventory that never had them. Techs restore through the unlock-set path
  //    rather than by replaying the purchases. MILESTONES RESTORE SEPARATELY
  //    and deliberately: a load that silently granted one would hand out
  //    DW-29's autopilot to anybody who pressed F5.

  return {
    buildings, structures: restoredParts, pads: restoredPads,
    machines: restoredMachines, nodesDepleted: depleted,
    rocks: rocksApplied,
    rocksPending: g.rocks.stats().pending,
    patchesDepleted, packUnits, fuelTicksLost, voxels, hotbarRestored,
    progress, discovery, health, vitals,
    mode: slot.mode ?? 'survival',
    savedAt: slot.savedAt,
  };
}

/**
 * The two calls Gameplay actually makes. They live here rather than there
 * because a save is a whole-world operation and Gameplay is a composition: the
 * type import is erased, so the apparent cycle costs nothing at runtime.
 */
export async function saveSlot(g: Gameplay): Promise<unknown> {
  // PH-30 / physics R11. A save that cannot describe the world is refused here
  // rather than written and hoped over: the slot has no field for a vessel, so
  // one written mid-flight is a VALID GROUND state that silently deletes the
  // flight on the next load. Refusing leaves the last GROUND save on disk,
  // which is where a reload should put somebody whose flight was not saved,
  // and the navball says so while it is happening.
  const inhibit = saveInhibit();
  if (inhibit !== '') { noteSave(true); return { refused: inhibit }; }
  noteSave(false);
  const slot = snapshot(g.core, g.game, g.field, g.factory, g.machines,
    g.seed, g.ports, g.oreField, g.structures, g.pads, g.hotbar, g.mode.mode,
    saveProgress(g), g.health, g.vitals.serialize(), g.rocks);
  const ok = await writeSlot(slot);
  if (ok) g.saves++;
  return ok ? {
    mode: slot.mode,
    bytes: slot.pack.length, buildings: slot.buildings.length,
    structures: slot.structures?.length ?? 0, sites: slot.sites?.length ?? 0,
    pads: slot.pads?.length ?? 0,
    machines: slot.machines.length, depletion: slot.depletion.length,
    patches: slot.patches.length, rocks: slot.rocks?.length ?? 0,
    health: slot.health?.length ?? 0,
    voxelBytes: slot.voxels.cells.length, voxelOps: slot.voxels.ops.length,
  } : null;
}

export async function loadSlot(g: Gameplay): Promise<RestoreLedger | null> {
  const read = await readSlot(g.mode.mode);
  const slot = read.slot;
  // DW-31. A slot refused for its MODE is said out loud rather than dropped: a
  // world that silently arrives empty is the single most alarming thing a save
  // system can do, and "that save was made in sandbox mode" is the sentence that
  // stops the player thinking their base is gone. Their base is not gone; it is
  // under the other mode's key and nothing here will write over it.
  lastRefusal = read.refusal;
  if (read.refusal === 'mode' && read.foundMode !== null) {
    g.hud.flash(`that save was made in ${read.foundMode} mode, `
      + `this world is ${g.mode.mode}`, 3.2);
  }
  // A slot from another seed is a different planet, and loading it would drop
  // buildings onto terrain that is not there.
  if (slot === null || slot.seed !== g.seed) return null;
  // FS-79. THE RESCUE COPY, TAKEN BEFORE `apply` TOUCHES ANYTHING, and returning
  // '' both when none was needed and when one could not be written. Passing it in
  // is what makes it a PRECONDITION: `restorePlan` will not re-space a plan
  // without the key of a copy that already exists.
  const rescue = await rescueBefore(slotKey(g.mode.mode), slot);
  g.restored = apply(g, g.core, g.game, g.factory, g.machines, slot, g.ports,
    g.oreField, g.structures, g.structView, g.hotbar, rescue);
  g.hotbarBar.invalidate();
  g.panel.invalidate();
  const dug = g.restored.voxels.cells;
  g.hud.flash(`restored ${g.restored.buildings} buildings, `
    + `${g.restored.packUnits} items`
    + (dug > 0 ? `, ${dug} m³ of tunnel` : ''), 2.6);
  return g.restored;
}
