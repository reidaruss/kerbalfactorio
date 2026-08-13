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
import { SAVE_VERSION, chestStore, type SaveMachine,
  type SaveProgress, type SaveSlot, type SaveStation } from './SaveGame.js';
import type { GameMode } from './GameMode.js';
import type { BuildKind, Factory } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { Machines } from './Machines.js';
import type { NodeField } from './NodeField.js';
import type { RockField } from './RockField.js';
import type { TreeField } from './TreeField.js';
import type { OreField } from './OreField.js';
import type { Structures } from './Structures.js';
import type { Hotbar } from './Hotbar.js';
import type { StructureView } from './StructureView.js';
import type { Gameplay } from './Gameplay.js';
import { restoreStructures, saveParts, saveSites } from './StructureSave.js';
import { restorePads, savePads } from './LaunchPadSave.js';
import type { LaunchPads } from './LaunchPad.js';
import type { ResearchStations } from './ResearchStations.js';
import { NO_VOXELS, restoreEdits, snapshotEdits, type VoxelMeshPort,
  type VoxelPort, type TerrainDigPort } from './VoxelSave.js';
import { keptWorlds } from './SaveWorlds.js';
import { scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';
import { discAbi } from '../sim/wasm/discabi.js';
import { poiAbi } from '../sim/wasm/poiabi.js';
import type { HealthBook } from './Health.js';
import type { PlayerHealthSave } from './PlayerHealth.js';
import { rebuildHealth } from './HealthCensus.js';

/** The three Services handles a whole-world save needs and gameplay does not own. */

export interface WorldPorts {
  voxels: VoxelPort | null;
  voxelMesh: VoxelMeshPort | null;
  terrain: TerrainDigPort | null;
}

// FS-82. The research and player half moved to `PersistProgress.ts` when the
// rescue copy pushed this file past its cap; re-exported because every caller in
// the client asks `Persist` for it, which is the same call `PersistLedger` made.
import { restoreProgress } from './PersistProgress.js';
export { restoreProgress, saveProgress } from './PersistProgress.js';

// The receipt a load hands back. It lives in its own file (this one is at its
// line cap) and is re-exported here, because every caller in the client asks
// `Persist` for it and moving a published name to make room is a worse trade
// than one line of forwarding, which is the same call `Structures.ts` made.
import type { RestoreLedger } from './PersistLedger.js';
export type { RestoreLedger } from './PersistLedger.js';

export function snapshot(M: OfCoreModule, game: GameCore, field: NodeField,
                         factory: Factory, machines: Machines,
                         seed: number, bodyId: number, bodyHandle: number,
                         ports: WorldPorts,
                         ore: OreField, structures: Structures,
                         pads: LaunchPads,
                         /** D-019. The research stations. Beside `pads` because
                          *  it is the same kind of thing: a placed structure
                          *  whose whole state is a transform. */
                         stations: ResearchStations,
                         hotbar: Hotbar, mode: GameMode,
                         progress: SaveProgress | undefined,
                         health: HealthBook,
                         vitals: PlayerHealthSave,
                         rocks: RockField, trees: TreeField): SaveSlot {
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

  // WG-151: the POI/site bridge's two bits (known, visited), read
  // straight off `/core`'s per-body catalog for the same reason `discovery`
  // is: it is world state that exists whether or not a panel is looking at
  // it. Same u8 arena, same rule: copy out before the next call.
  const pn = poiAbi(M)._of_poi_save(bodyHandle);
  const poi = pn > 0 ? Array.from(scratchU8(M, pn)) : [];

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
  // WG-116: and the world TREES, same reason, and now the majority of the node
  // array at a forested site: without this a reload drains a thousand strangers.
  const treeIdx = trees.coreIndices();
  const depletion: [number, number][] = [];
  for (const pl of field.placed) {
    if (outcrops.has(pl.index) || rockIdx.has(pl.index)
      || treeIdx.has(pl.index)) continue;
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
    // PS-40 / PS-41. WHICH BODY EVERYTHING BELOW IS ABOUT, and the worlds this
    // session is NOT standing on, put back exactly as they were loaded. Stamped
    // beside `seed` and `mode` because they are the same kind of fact and this
    // is the one place a slot is built. See SaveWorlds.ts for all of it.
    body: bodyId,
    others: keptWorlds(),
    // DW-31. The mode is written into the slot as well as deciding its key, so
    // a world can always answer what it is without anybody consulting where it
    // was found. SaveGame.ts has the argument for keeping both.
    mode,
    savedAt: Date.now(),
    pack,
    voxels,
    discovery,
    poi,
    depletion,
    patches,
    rocks: rocks.serialize(),
    trees: trees.serialize(),
    sites: saveSites(structures),
    structures: saveParts(structures),
    pads: savePads(pads),
    // D-019. A station holds nothing, so this is its whole state.
    stations: stations.list.map((st): SaveStation => ({
      pos: [st.pos.x, st.pos.y, st.pos.z],
      quat: [st.quat.x, st.quat.y, st.quat.z, st.quat.w],
    })),
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
                      carried: { hadWorld: boolean; others: number[] },
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

  // 0c. WHAT THE PLAYER HAD SCANNED OR VISITED (WG-151). Same
  //     three-state discipline as discovery above: 0 is "the slot carried
  //     none" (every save before ABI 24, honestly), -1 is `/core` REFUSING
  //     the stream, and anything else is ids actually restored.
  let poi = 0;
  const poiBytes = slot.poi ?? [];
  if (poiBytes.length > 0) {
    const P = poiAbi(M);
    P._of_poi_alloc_bytes(poiBytes.length);
    scratchU8(M, poiBytes.length).set(poiBytes);
    poi = P._of_poi_load(g.bodyHandle);
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
  const treesApplied = g.trees.restore(slot.trees);   // WG-116, the same path

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
  // 5a. WG-168. THE RUINS GO BACK INTO THE SOLID SET, IMMEDIATELY. The line
  //     above calls `Structures.reset()` -> `bodies.clear()` on the ONE set the
  //     walker reads, throwing away every solid in it including ones the base
  //     layer never heard of. A ruin is not save state (it regenerates from the
  //     seed; `Gameplay.create` placed it): nothing to restore, one to put back.
  const reseatedRuins = g.ruins.reseat(structures.bodies);
  // 5b. THE LAUNCH PADS, after the decks and for the same reason the decks come
  //     after the tunnels: a pad's base plane IS a deck's top face (GP-58), so
  //     restoring one before its platform would anchor it against a site that
  //     is not there yet. Its own batch is emptied first, exactly as the
  //     structural one is, or a demolished pad keeps drawing where it stood.
  for (const p of g.pads.list) g.padView.release(p.id);
  const restoredPads = restorePads(g.pads, slot.pads);

  // 5b-ii. D-019, THE RESEARCH STATIONS, after the decks for the pads' own
  //     reason: a station can stand on a foundation, and `restore` re-asks
  //     `onDeck` against the base, so restoring one before its platform would
  //     record it as standing on soil. The old set is thrown away FIRST, or a
  //     load into a live world would double every station: `reset` takes each
  //     one's solid back out of the walker's set as it goes, which is why it is
  //     a method there rather than a `length = 0` here.
  g.stations.reset();
  let restoredStations = 0;
  for (const s of slot.stations ?? []) {
    const st = g.stations.restore(
      { x: s.pos[0], y: s.pos[1], z: s.pos[2] },
      new THREE.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3]));
    if (st !== null) restoredStations++;
  }

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
    stations: restoredStations,
    // WG-168. Not a restore: ruin colliders the reset destroyed and this load
    // put back. DW-20, a claim needs a number. See PersistLedger.ts.
    ruinsReseated: reseatedRuins,
    machines: restoredMachines, nodesDepleted: depleted,
    rocks: rocksApplied,
    rocksPending: g.rocks.stats().pending,
    trees: treesApplied,
    treesPending: g.trees.stats().pending,
    patchesDepleted, packUnits, fuelTicksLost, voxels, hotbarRestored,
    progress, discovery, poi, health, vitals,
    // PS-40. Which body, whether the slot HELD one for it, and which others came
    // through. The middle one is the fact no count carries: a first visit and a
    // world restored to nothing are identical everywhere else on this receipt.
    body: slot.body ?? 0,
    bodyHadWorld: carried.hadWorld,
    otherBodies: carried.others,
    mode: slot.mode ?? 'survival',
    savedAt: slot.savedAt,
  };
}

// FS-82's move, made again for the same reason: the two calls Gameplay makes
// are in `PersistSlot.ts` because the body dimension pushed this file back over
// its 400-line cap. Re-exported because every caller in the client asks
// `Persist` for them, exactly as `RestoreLedger` and `saveProgress` are.
export { lastSlotRefusal, loadSlot, saveSlot } from './PersistSlot.js';
