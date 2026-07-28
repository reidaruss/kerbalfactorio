// PH-64 to PH-69. ONE call from `Boot.ts`, because Boot is at its line cap and
// because everything below is one idea: THE WORLD COMES BACK AS IT WAS LEFT.
//
// Order is the whole content of this file and every line of it is load-bearing:
//
//   1. Install the hooks FIRST. `saveVessels` and `savePlayerAnchor` are called
//      from `SaveGame.writeSlot`, which fires from a 20 second autosave timer
//      that is gated on nothing. If the hooks are installed after the first
//      autosave can fire, one slot gets written with no vessel in it and the
//      restored one is gone. That is the failure `SaveInhibit` was written about
//      in the first place, running backwards.
//   2. Adopt the saved records. `SaveGame.readSlot` stashed them at boot; they
//      are inert data until this point, which is why nothing has to reach into
//      the flight lane from the save layer.
//   3. Promote at most the parked one, so a rocket left on a pad is drawn and
//      boardable. A vessel on rails stays a record (FlightVessels explains why).
//   4. Put the body back, LAST, because it rebases the floating origin and every
//      near-scene position is expressed around that point.
//
// =============================================================================
// §5. THE SEAM FOR THE CONTROL HANDOFF. PUBLISHED, NOT BUILT (PH-69).
//
// Reid's destination is: fly a rocket up manually, LEAVE it in orbit, carry on
// playing as the walker, and come back to it later. This lane deliberately built
// the foundation and not the feature, because a handoff on top of a vessel that
// does not persist gives you a rocket you can leave and then lose, which is
// worse than not having the handoff. What follows is the contract the handoff
// lane binds to. None of it is speculative: every name below exists and is
// exercised by `probes/vesselrails.js`.
//
// HOW A VESSEL IS IDENTIFIED. `VesselRecord.id`: a positive integer, allocated
// by `VesselRegistry.allocateId`, stable for the life of the world, NEVER reused
// (unlike a `/core` handle, which is reused the instant a slot frees). It is the
// only durable name a vessel has and it is what a save, a map marker and a
// "switch to" command must all agree on.
//
// HOW ONE IS SELECTED. `promoteVessel(flight, id, tick)`. It is idempotent on
// the already-promoted id, it demotes whatever was promoted first, and it
// returns false rather than half-promoting. The natural selection GESTURE is
// already shipped: the map switches focus to orbital objects (WG-29 / DW-36), so
// the handoff lane wires that focus change to this call and needs no new UI
// concept. `registry.list()` is the enumeration to draw markers from, and
// `stateOf(M, registry, rec, tick)` gives each one a position without promoting
// it, which is exactly what a map needs and exactly what a map must not pay a
// simulation for.
//
// WHAT THE PLAYER'S BODY DOES. Decided in `PlayerAnchor.ts` (PH-68): it PARKS
// COHERENTLY. It is not stepped while control is elsewhere, and its position is
// recorded so returning to it is a fact rather than a hope. `SavePlayerAnchor`
// carries `aboard` and `vesselId`, so a handoff can tell "the player was flying
// vessel 3" from "the player was walking", which is the question a re-entry UI
// opens with.
//
// WHAT A HANDOFF MAY NOT DO, and this is the part worth arguing about. It may
// not leave a vessel that is FROZEN. `VesselRecord.mode` is `parked | rails |
// frozen`, and a frozen vessel is one in the atmosphere or under thrust, which
// no arithmetic can advance (PH-65). Leaving one would produce a rocket that
// hangs motionless mid-ascent for as long as you are away, which is not a
// simulation and not a story. `mayLeave` below is the published predicate, and
// the honest refusal is "you cannot leave a vessel under power in the
// atmosphere: cut the engine and coast above 60 km first", which is also exactly
// the skill DW-29 says reaching orbit is supposed to teach.
//
// FROZEN still EXISTS, and it must, because closing a browser tab is not a
// choice the game gets to refuse. A reload restores a frozen vessel exactly
// where it was; what `mayLeave` governs is the voluntary handoff.
// =============================================================================
import { promoteOnBoot, resetVesselWatch, setDesignSource, syncPromoted,
         currentVesselTick } from './FlightVessels.js';
import { applyPlayerAnchor, installPlayerAnchor } from './PlayerAnchor.js';
import { adoptSaved, setVesselSyncHook, takeStashedVessels } from '../game/VesselSave.js';
import { registry } from '../sim/VesselRegistry.js';
import type { VesselRecord } from '../sim/VesselRegistry.js';
import type { FlightMode } from './FlightMode.js';
import type { Vab } from '../game/Vab.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** PH-69. May control be handed away from this vessel, leaving it unattended?
 *  A record with no way to advance itself is a record nothing should be allowed
 *  to walk away from. */
export function mayLeave(rec: VesselRecord): boolean {
  return rec.mode === 'parked' || rec.mode === 'rails';
}

export function whyNotLeave(rec: VesselRecord): string {
  if (mayLeave(rec)) return '';
  return 'cannot leave a vessel under power or in the atmosphere: '
       + 'cut the engine and coast above 60 km first';
}

export interface ResumeDeps {
  flight: FlightMode | null;
  vab: Vab | null;
  router: ViewRouter;
  origin: FloatingOrigin;
}

export interface ResumeReport {
  adopted: number;
  promoted: number;
  anchored: boolean;
}

let last: ResumeReport = { adopted: 0, promoted: 0, anchored: false };
/** What the last boot restored. Read by `of.flight('vessels')`, because a
 *  restore that silently did nothing and a world that had nothing to restore
 *  must be distinguishable (DW-20). */
export function resumeReport(): ResumeReport { return last; }

export function resumeWorld(d: ResumeDeps): ResumeReport {
  resetVesselWatch();
  registry.clear();

  const vab = d.vab;
  setDesignSource(vab === null ? null
    : () => (vab.design.parts.length > 0 ? vab.design.toJson('rolled out') : null));
  const fm = d.flight;
  setVesselSyncHook(() => syncPromoted(fm, currentVesselTick()));
  installPlayerAnchor(d.router, () => fm?.aboard === true);

  const rows = takeStashedVessels();
  const adopted = rows === null ? 0 : adoptSaved(rows);
  const promoted = promoteOnBoot(fm, 0);
  const anchor = applyPlayerAnchor(d.router, d.origin);
  last = { adopted, promoted, anchored: anchor !== null };
  return last;
}
