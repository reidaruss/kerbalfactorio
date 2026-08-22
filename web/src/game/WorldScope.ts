// PS-49 to PS-51. R-BODY-2: THE BODY-SCOPED HALF OF A SAVE BELONGS TO THE BODY
// THE SLOT NAMES, AFTER AN IN-PAGE BODY SWITCH AS WELL AS BEFORE ONE.
//
// =============================================================================
// WHAT WAS WRONG, MEASURED ON THE SHIPPED CLIENT BEFORE ANY OF THIS EXISTED.
//
// `of.reboot(1)` rebuilds the body scope while the loop runs. `slot.body` is
// stamped from `Gameplay.bodyId`, which boot captured and which `reboot`
// deliberately does not rebuild, so a save taken on the moon still NAMES Forge
// -- and until this file it also carried the LIVE world under that name. Driven,
// sandbox, one browser context, reading the store raw:
//
//   Forge:            5,776 removed voxel cells / 6 ops, stored under body 0.
//   after reboot(1):  the same 5,776 / 6 still stored under body 0, because
//                     nothing in `web/src/game` is body-scoped at all.
//   3 strikes on the moon (hit radius 200,585 m, so genuinely Cinder's ground):
//                     8,786 cells / 9 ops STORED UNDER BODY 0. Forge's world in
//                     the slot now permanently carries the moon's digging.
//   back on Forge:    8,786 / 9. The corruption is not transient.
//
// AND ONE FIELD IS DESTROYED RATHER THAN CROSSED, which the count above hides.
// `poi` is read with `_of_poi_save(g.bodyHandle)`, and `WorldSession.reboot`
// FREES the old body handle (`newBody` -> `old.dispose()`), so on the moon that
// call is made against a dead handle, refuses, and the save writes ZERO poi
// bytes under body 0 over the 2 that were there. Same shape as PS-47's discovery
// finding: adopt-then-wipe, one field over.
//
// =============================================================================
// WHY THE FIX IS A FROZEN WORLD AND NOT A PER-FIELD REPAIR.
//
// PS-46/PS-47 fixed `discovery` by giving the LIVE field a body. That worked
// because /core's `g_disc` has a re-cut verb (`of_disc_reset`) and a serialised
// form, so the field could be made body-scoped for real. NONE of the other
// fourteen can be, from here: every one of their live producers is constructed
// once in `Gameplay`'s constructor with the BOOT body's handle and radius
// (`Factory`, `Machines`, `Structures`, `ResearchStations`, `Antennas`,
// `RockField`, `TreeField`, `OrePatches`, `Sites`, `VoxelMesh`), not one line of
// `web/src/game` is registered with a body `Lifetime`, and `Gameplay.populate`
// is called exactly once at boot. Re-cutting them is four domains' files and is
// R-BODY-2 proper, which is routed to core-engine.
//
// So the live world cannot be made to follow the body. What it CAN be made to
// do is stop pretending: **at the instant the session leaves the body its
// populations describe, they are copied, and from then on the save writes the
// copy.** Nothing is ever written under a body it does not describe, which is
// the whole of the complaint. What is given up is stated below and is a
// freeze, not a loss.
//
// =============================================================================
// THE THREE STATES, AND WHY THE MIDDLE ONE IS PERMANENT.
//
//  1. NOT FROZEN. The session is on the body its populations describe. Every
//     save is exactly what it was before this file existed, field for field.
//     This is every shipped path: nothing in the game calls `reboot`
//     (`DebugLifecycle.ts` says so), and the player's door to another body is a
//     page reload (`VisitWorlds.ts`), which resets this module along with
//     everything else.
//
//  2. THE MOMENT OF THE FREEZE. A scope build for a body that is not the
//     populations' body. The world captured during the OUTGOING scope's
//     teardown becomes the frozen copy.
//
//  3. FROZEN, AND IT DOES NOT THAW ON THE WAY HOME. This is the part that has
//     to be argued rather than assumed. Once the player has walked on Cinder,
//     the live populations hold Forge's world PLUS Cinder's tunnel, in one
//     un-attributable set: a voxel cell is an absolute body-frame metre and
//     nothing records which body it was cut on. Coming home does not separate
//     them, so thawing would write the moon's digging into Forge after all --
//     the original defect, arriving one switch later. Subtracting by radius was
//     considered and refused: inferring a body from a float is exactly what
//     R-BODY-1 already refuses about `SaveVessel`.
//
// WHAT A FREEZE COSTS, SAID PLAINLY: work done after an in-page switch is not
// saved. That is a page whose only door is `window.__of.reboot`, so it costs a
// probe and no player anything today. It is LOUD (one `console.warn` at the
// moment it happens, a row in the save receipt, a row in `of.life()`), because
// a save that silently stops moving is worse than one that refuses.
//
// REFUSING THE SAVE OUTRIGHT WAS CONSIDERED AND REFUSED, and the reason is
// PS-40's bucket boundary doing its job. The GLOBAL half of the slot -- the
// pack, the research, the milestones, the vessels, the day -- is still exactly
// right after a body switch, because none of it is about a place. Refusing the
// write would throw that away too, and would leave the last on-disk state at
// whatever the previous autosave happened to hold. Freezing one half and going
// on writing the other is strictly more of the player's world kept, and it is
// only expressible because the two halves were separated first.
//
// =============================================================================
// WHERE THE COPY IS TAKEN, AND WHY IT IS A TEARDOWN STEP.
//
// It has to be BEFORE `WorldSession.reboot` frees the old body handle, or `poi`
// is captured as the same zero the defect writes. `reboot`'s order is
// `lt.end()` -> `newBody()` (which disposes) -> `build()`, so a step registered
// on the body `Lifetime` is the one hook that runs early enough, and it is the
// shape the scope already uses for the carriers, the ride and the mounts. It is
// registered by the scope rather than called by the door, deliberately: the one
// caller of `reboot` today is a debug verb, and a capture the CALLER has to
// remember is a capture the next caller forgets (PS-41's rule).
//
// =============================================================================
// THE COPY IS PRODUCED BY THE FUNCTION THAT WRITES A SAVE, and that is the only
// way this can be right. A second enumeration of the fifteen body-scoped fields
// would be PS-13's defect again: two writers listing the same fields, one of
// them missing whatever the next lane adds. `snapshotOf(g)` builds a whole slot
// and `worldOf` takes its body-scoped half through `WORLD_KEYS`, so a field
// added to `SaveSlot` and classified body-scoped is frozen without this file
// being touched, and one that is NOT classified does not compile
// (`UnclassifiedSaveField`).

import type { SaveSlot } from './SaveGame.js';
import { slotWithWorld, worldOf, type SaveWorld } from './SaveWorlds.js';

/** A whole slot built off the live world. `PersistSlot.snapshotOf`, handed in
 *  as a thunk so this file does not reach for `Gameplay`. */
export type LiveSlot = () => SaveSlot;

/**
 * Which body the LIVE populations describe.
 *
 * NOT which body the player is standing on, and the distinction is the whole
 * file. It is set once, by the first scope build, and it never moves, because
 * nothing re-cuts `Factory` / `Machines` / `Structures` / `RockField` /
 * `TreeField` / `OrePatches` / the voxel edit set for a new body. The day
 * something does, this becomes a value with more than one writer and the single
 * `frozen` slot below becomes a map.
 */
let liveBody: number | null = null;

/** The last reading of `liveBody`'s world taken while it was still that body's,
 *  or null while the session has never left it. */
let frozen: SaveWorld | null = null;

/** The world captured by the outgoing scope's teardown, not yet judged. The
 *  teardown does not know where the session is going; the arrival does. */
let pending: SaveWorld | null = null;

/** Freezes so far, for the report. A same-body reboot must never produce one. */
let freezes = 0;

/** Reset everything. For a test harness; no shipped caller. */
export function resetWorldScope(): void {
  liveBody = null; frozen = null; pending = null; freezes = 0;
}

/**
 * THE OUTGOING SCOPE IS BEING TAKEN APART. Take the reading now, while the old
 * body handle is still alive and the populations are still whole.
 *
 * Registered as a teardown step by `buildBodyScope`, so it also runs on a
 * SAME-body reboot, where `arriveOnBody` throws the reading away again. Taking
 * it unconditionally and judging it on arrival is what keeps this side from
 * needing to know the destination, which it cannot know.
 *
 * `live` is null under `?gameplay=0`: no populations, nothing to freeze.
 * Already frozen means the reading would be of a world that is nobody's, which
 * is state 3 above, so it is not taken.
 */
export function captureLeavingWorld(live: LiveSlot | null): void {
  if (live === null || liveBody === null || frozen !== null) return;
  pending = worldOf(live());
}

/** What one arrival did, for the caller's log and for the probe. */
export interface WorldArrival {
  /** The body the populations describe, after this call. */
  liveBody: number;
  /** True when this arrival froze the body-scoped half of the save. */
  froze: boolean;
  /** True when the save was already frozen before this arrival. */
  wasFrozen: boolean;
}

/**
 * A SCOPE HAS BEEN BUILT FOR `bodyId`. Decide what that means for the save.
 *
 * Three outcomes and no fourth:
 *   nothing has ever said  -> this is boot; the populations are this body's;
 *   `bodyId` is the populations' body -> a same-body reboot (the negative
 *      control): the pending reading is thrown away and nothing changes;
 *   `bodyId` is another body -> the pending reading becomes the frozen world,
 *      once, loudly.
 */
export function arriveOnBody(bodyId: number): WorldArrival {
  const wasFrozen = frozen !== null;
  if (liveBody === null) {
    liveBody = bodyId;
    pending = null;
    return { liveBody: bodyId, froze: false, wasFrozen };
  }
  if (bodyId === liveBody || wasFrozen) {
    pending = null;
    return { liveBody, froze: false, wasFrozen };
  }
  // The reading may legitimately be null: `?gameplay=0` has no world, and a
  // scope build that threw before registering its teardown step leaves none.
  // Freezing on a null reading would write an EMPTY world over the player's,
  // which is the destructive answer, so the freeze does not happen and the
  // warning says which case this is.
  if (pending === null) {
    console.warn(`[of] body switch ${liveBody} -> ${bodyId}: no reading of body `
      + `${liveBody}'s world was taken, so the save is UNCHANGED and will go on `
      + `writing the live world under body ${liveBody}`);
    return { liveBody, froze: false, wasFrozen };
  }
  frozen = pending;
  pending = null;
  freezes++;
  console.warn(`[of] body switch ${liveBody} -> ${bodyId}: the body-scoped half `
    + `of the save is now FROZEN at body ${liveBody}'s world as it was left. `
    + `Nothing built, dug or mined from here on is saved, because the live world `
    + `is body ${liveBody}'s populations and cannot describe body ${bodyId} `
    + `(persistence R-BODY-2). The pack, research, vessels and time of day go on `
    + `saving normally.`);
  return { liveBody, froze: true, wasFrozen };
}

/**
 * THE SLOT AS IT SHOULD BE WRITTEN: the live one until the session has left the
 * body it describes, the frozen world's fifteen fields over it afterwards.
 *
 * `bodyId` is what the slot NAMES (`Gameplay.bodyId`). Today it is always
 * `liveBody`, because both are the boot body and neither has a second writer;
 * the guard is here so that the day `Gameplay.bodyId` becomes live, a mismatch
 * leaves the live half alone rather than silently stamping one body's world
 * under another's name. That branch is unreachable now and is not tested, which
 * is said rather than hidden.
 */
export function slotForBody(slot: SaveSlot, bodyId: number): SaveSlot {
  if (frozen === null || bodyId !== liveBody) return slot;
  return slotWithWorld(slot, frozen);
}

/** The scope's own state, for the save receipt, `of.life()` and the probe.
 *  Counts and not the world: a report that shipped a base per call would be
 *  read every frame by somebody eventually (PS-46's rule for `stash`). */
export function worldScopeReport(): {
  liveBody: number | null; frozen: boolean; freezes: number;
  frozenCounts: Record<string, number> | null;
} {
  return {
    liveBody, frozen: frozen !== null, freezes,
    frozenCounts: frozen === null ? null : countsOf(frozen),
  };
}

/** How big each half of a frozen world is, in the units the probe asserts on.
 *  Derived from the world rather than listed beside it, so a field added to
 *  `WORLD_KEYS` shows up here without this function being edited. */
function countsOf(w: SaveWorld): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w as unknown as Record<string, unknown>)) {
    // PS-53. `fieldGen` is skipped by name rather than by falling off the end
    // of the two branches below, because a body-scoped field that is a NUMBER
    // is new here and a silent skip is how a later one gets lost. It is a
    // stamp, not a count, and `fieldGenReport()` is where it is read.
    if (k === 'body' || k === 'fieldGen') continue;
    if (Array.isArray(v)) out[k] = v.length;
    else if (v !== null && typeof v === 'object') {
      // The one non-array body-scoped field, `voxels`, which is two arrays.
      // `cells` is renamed to `bytes` on the way out, because that is what it
      // is: `snapshotEdits` stores `_of_edits_serialize`'s BYTES, and a reader
      // comparing that length against /core's own cell tally
      // (`of.voxels().removedCells`) is two orders of magnitude out. The first
      // draft of `probes/bodyfields.js` did exactly that and went red on a
      // correct build; `PersistSlot`'s summary has always called it
      // `voxelBytes`, and this is the same honesty one layer down.
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(v2)) out[`${k}.${k2 === 'cells' ? 'bytes' : k2}`] = v2.length;
      }
    }
  }
  return out;
}
