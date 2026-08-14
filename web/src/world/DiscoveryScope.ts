// PS-46 / GP-725. THE DISCOVERY FIELD FOLLOWS THE BODY.
//
// =============================================================================
// WHAT WAS WRONG, MEASURED BEFORE ANY OF THIS WAS WRITTEN.
//
// `Boot.ts` builds the map OUTSIDE `buildBodyScope` -- it has to, because the
// map needs gameplay, the bay and flight, none of which exist when the first
// body scope is built -- so the `Discovery` driver is constructed once with the
// BOOT body's id and `WorldSession.reboot` never re-cuts the field underneath
// it. /core keeps ONE `g_disc` whose lattice resolution is a function of the
// body radius, so after a switch the player walks on a 200 km moon and their
// observations land in a 600 km planet's lattice at that planet's cell size.
//
// Driven on the shipped client (`probes/discbody.js`, twelve red checks):
// after `of.reboot(1)` the world was Cinder (`bodyRadiusM` 200,000) while the
// discovery field still reported 600,000 m, a 9,375 m survey cell and Forge's
// 98,304 cells -- INCLUDING `surveyFraction` 1, a moon reporting a completely
// surveyed map because a station in Forge orbit had handed one over. Four
// teleport hops on the moon then added 1,872 EXPLORE cells to Forge's lattice,
// and the return trip brought all of them home: Forge's serialized stream went
// from 106,609 bytes (hash 3753296933) to 108,738 (hash 2274255402) without the
// player taking a step on Forge.
//
// =============================================================================
// WHY A RE-SEAT AND NOT A REBUILD, AND WHY THE STASH IS NOT OPTIONAL.
//
// The driver object is held by `MapWorld`, `MapTerrain` and `Map3D`, so it
// cannot be replaced without rebuilding the map; and the map cannot be built
// inside the body scope for the reason above. This is exactly R17's shape one
// domain over (`StationMount.installAndMountStation`): the composition root
// keeps a holder, the scope build calls it, and the object that outlives the
// body is re-seated rather than reconstructed. `WorldSession.ts` states the
// rule this follows -- re-seat what outlives the body, rebuild what caches it.
//
// THE STASH IS THE HALF THAT IS EASY TO LEAVE OUT AND FATAL TO LEAVE OUT. A
// re-cut with no stash turns a POLLUTED field into a DESTROYED one: the moment
// the field is reset for Cinder, Forge's whole explored world is gone from
// memory, and the 20 s autosave then writes the empty-or-foreign set over the
// save. That is the same failure `of_disc_ensure` was invented to stop, arriving
// through a different door, so the outgoing stream is serialized BEFORE the
// reset and put back on the way home.
//
// The stash is SESSION state and never touches disk. Its unit is /core's own
// serialized stream, which is the same bytes the save carries, so nothing here
// is a second encoding of a discovered world.
//
// =============================================================================
// THE ONE INVARIANT: `liveBody` IS WHICH BODY THE FIELD IN /core IS CUT FOR.
//
// It has exactly two writers, and both are places where the field's body
// actually changes: `noteDiscoveryBody` (the boot-time driver construction, and
// `Persist.apply` after it has streamed a body's world into the field) and
// `reseatDiscovery` below. Nothing infers it, and nothing re-derives it from a
// radius: two bodies with equal radii would be one lattice to /core and would
// have to be one entry here too, and keying on the id keeps that /core's
// problem rather than making it a second convention.
//
// `null` means nothing has ever said, which is a real state (`?gameplay=0` has
// no save, no map and no field) and is read as "there is nothing to be wrong
// about": every consumer below falls back to today's behaviour on it.
// =============================================================================

import { discAbi } from '../sim/wasm/discabi.js';
import { scratchU8 } from '../sim/wasm/heap.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Discovery } from './Discovery.js';

/** Which body /core's one field is currently cut for, or null if nothing has
 *  ever said. See the header: two writers, both of them real transitions. */
let liveBody: number | null = null;

/** Body id -> that body's serialized discovery stream, for the bodies this
 *  session has been on and is not on now. /core's own bytes, never re-encoded. */
const stash = new Map<number, number[]>();

/** What one re-seat did, for the caller's log and for the probe. */
export interface DiscoveryReseat {
  /** The body the field was cut for before, or null if nothing had said. */
  from: number | null;
  to: number;
  /** True when /core accepted `to`; false is an unknown body and NOTHING was
   *  changed, which is deliberately distinguishable from "changed to empty". */
  ok: boolean;
  /** Bytes stashed for `from`. -1 when there was nothing to stash. */
  stashed: number;
  /** Cells put back for `to` from a previous visit, or 0 for a first visit. */
  restored: number;
}

/**
 * The field in /core now describes `bodyId`. Say so.
 *
 * Called from the two places that make it true: `Discovery`'s constructor
 * (which runs `of_disc_ensure`) and `Persist.apply` (which streams one body's
 * saved world into the field, and knows which body's view it was handed).
 */
export function noteDiscoveryBody(bodyId: number): void { liveBody = bodyId; }

/** Which body the field is cut for, or null. Published for the debug surface. */
export function discoveryLiveBody(): number | null { return liveBody; }

/**
 * RE-CUT THE FIELD FOR `toBodyId`, KEEPING WHAT THE BODY BEING LEFT HAD.
 *
 * Three steps that are only correct together, which is why they are one call
 * (PS-41's rule): stash the outgoing stream under the body it belongs to, cut a
 * fresh field for the incoming body, and put back what that body had if this
 * session has been there before.
 *
 * `of_disc_reset` and NOT `of_disc_ensure`, and the difference matters exactly
 * here. `ensure` keeps a field whose RADIUS matches, which is the right rule for
 * a boot path that must not wipe what a load just restored; this path has
 * already taken a copy, so the unconditional form is safe, and it is also the
 * only one that is right for two bodies of equal radius.
 *
 * `disc` is the driver, or null: under `?flight=0` there is no map and no
 * driver, but there is still a field and a save, so the re-seat is NOT
 * conditional on a panel existing.
 */
export function reseatDiscovery(M: OfCoreModule, toBodyId: number,
                                disc: Discovery | null): DiscoveryReseat {
  const D = discAbi(M);
  const from = liveBody;
  if (from === toBodyId) return { from, to: toBodyId, ok: true, stashed: -1, restored: 0 };
  // 1. WHAT IS THERE, KEPT UNDER ITS OWN BODY. Serialized before anything is
  //    reset, because the reset is what would destroy it.
  let stashed = -1;
  if (from !== null) {
    const n = D._of_disc_serialize();
    // Copied out immediately (standing rule 5): the next call into WASM may
    // grow the heap and detach the view.
    const bytes = n > 0 ? Array.from(scratchU8(M, n)) : [];
    stash.set(from, bytes);
    stashed = bytes.length;
  }
  // 2. A FIELD FOR THE BODY THE PLAYER IS ON. A 0 here is an unknown body, and
  //    /core changed nothing, so neither does this: the old field stays live and
  //    `liveBody` keeps naming it, which is a wrong world honestly labelled
  //    rather than a wrong world labelled right.
  const ok = D._of_disc_reset(toBodyId) === 1;
  if (!ok) return { from, to: toBodyId, ok: false, stashed, restored: 0 };
  // 3. WHAT THIS BODY HAD, PUT BACK. Absent is a first visit and restores as the
  //    empty field step 2 just made, which is the honest answer for a body
  //    nobody has been to in this session.
  let restored = 0;
  const bytes = stash.get(toBodyId) ?? null;
  if (bytes !== null && bytes.length > 0) {
    D._of_disc_alloc_bytes(bytes.length);
    scratchU8(M, bytes.length).set(bytes);
    restored = D._of_disc_deserialize();
  }
  liveBody = toBodyId;
  // The driver's derived state describes a field that is gone: its gap ratio and
  // its last observation point are about a pass whose cells are no longer held.
  disc?.reseated();
  return { from, to: toBodyId, ok: true, stashed, restored };
}

/**
 * PS-47. THE DISCOVERY STREAM FOR THE BODY A SLOT NAMES, which is not always
 * the live field.
 *
 * `snapshot` writes a slot stamped `body: Gameplay.bodyId`, and that id is
 * captured at boot and deliberately not rebuilt by `WorldSession.reboot`
 * (persistence R-BODY-2, core-engine's residue, measured in VisitWorlds.ts).
 * So a save taken after an in-page body switch names one body and would
 * otherwise carry another body's lattice, which on the next boot is not
 * pollution but total loss: `of_disc_deserialize` ADOPTS the stream's radius and
 * the following `of_disc_ensure` then wipes the mismatch.
 *
 * The rule this enforces is one line long: **the bytes in a slot belong to the
 * body the slot names.** On every shipped path `liveBody` IS that body and this
 * returns exactly what the old inline serialize returned, byte for byte.
 *
 * THE EMPTY RETURN IS THE ONE LOSSY BRANCH AND IT IS LOUD. It needs the named
 * body to be neither live nor stashed, which cannot happen while `liveBody` is
 * only ever moved by `reseatDiscovery` (which always stashes what it leaves).
 * There is no non-lossy answer available at that point -- a slot carries one
 * stream for the body it names -- so it says so rather than writing a lattice
 * that would destroy the world it is written into.
 */
export function discoveryBytesFor(M: OfCoreModule, bodyId: number): number[] {
  const D = discAbi(M);
  if (liveBody === null || liveBody === bodyId) {
    const n = D._of_disc_serialize();
    return n > 0 ? Array.from(scratchU8(M, n)) : [];
  }
  const bytes = stash.get(bodyId) ?? null;
  if (bytes === null) {
    console.warn(`[of] save names body ${bodyId} but the discovery field is cut `
      + `for ${liveBody} and no stream is held for ${bodyId}: writing none`);
    return [];
  }
  return bytes.slice();
}

/** The scope's own state, for the debug surface and the probe. Bytes and not
 *  the streams: a report that shipped 100 KB of array per call would be read
 *  every frame by somebody eventually. */
export function discoveryScopeReport(): {
  liveBody: number | null; stashed: { body: number; bytes: number }[];
} {
  return {
    liveBody,
    stashed: [...stash.entries()].map(([body, b]) => ({ body, bytes: b.length })),
  };
}
