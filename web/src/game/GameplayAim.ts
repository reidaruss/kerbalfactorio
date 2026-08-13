// WHAT THE CROSSHAIR IS ON, and the ORDER, which is the whole content of this
// file.
//
// Extracted out of `Gameplay` unchanged, behaviour for behaviour, because that
// composition is ninety lines over the 400-line cap and picking is a RULE with
// an argument rather than a piece of orchestration. It is the same call
// `PersistLedger.ts`, `Gunnery.ts` and `GameplayChrome.ts` already made.
//
// THE ORDER IS THE RULE, and each step of it was paid for:
//
//   1. A MACHINE first. It is the nearest, largest object, and a belt tile
//      behind it must not steal the press (Demolition.ts says the same thing
//      about the demolish key, and the two must agree or a player aims at one
//      thing and removes another).
//   2. A FACTORY BUILDING next, belts included, because a belt is demolishable
//      even though it is not interactive.
//   3. A STRUCTURAL PART next.
//   4. A RESEARCH STATION next (D-019). It is machine-scale and picked by the
//      same centre-and-radius test a hand machine is, so it sits with the
//      objects of its own size rather than with the 24 m pad; it is after the
//      structural part because a station stands ON a deck exactly as a furnace
//      does, and the deck is the larger, nearer surface.
//   5. A SCANNING ANTENNA next (GP-533), on the identical argument as the
//      station immediately above it and picked by the identical test: it is
//      machine-scale, it can stand on a deck, and it is a separate object from
//      the station rather than a second kind the station's own pick tests, so
//      a press cannot resolve to "whichever of the two is nearer" silently.
//   6. A RUIN'S INVESTIGATE SOCKET next (L7, GP-546 to GP-549), on the same
//      argument as the station and the antenna immediately above it: it is a
//      small, point-scale target picked by the identical centre-and-radius
//      test. It goes AFTER every player-placed thing rather than before,
//      because a ruin is world content, not something the player built, and
//      it must never steal a press aimed at a machine standing inside it
//      (GP-623's own finding, generalised).
//   7. A LAUNCH PAD LAST, and that is the order rather than an afterthought: a
//      pad is 24 m across, so a deck or a machine standing on it is INSIDE its
//      bound, and a pad that won the tie would swallow every press aimed at
//      anything on the launch site.

import { Sites } from '../world/Sites.js';
import { pickInvestigate } from './RuinInteract.js';
import type { Gameplay } from './Gameplay.js';

export interface AimRayLike {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

/**
 * Reach of everything the crosshair can resolve, in metres PAST THE SURFACE of
 * whatever is being reached for. One number, so a machine and the pad it stands
 * on can never be picked at different ranges.
 *
 * FS-93 RENAMED IT FROM `PICK_REACH_M` TO STATE ITS FRAME, and the finding is
 * sharper than the number: one constant was handed to four pickers and MEANT TWO
 * DIFFERENT THINGS, with nothing saying so.
 *
 *   `structures.pick` and `pads.pick` go through `StructureBody.rayPick`, which
 *   marches the ray and returns the first point INSIDE the solid. For those two
 *   3.5 m has always been a reach to the SURFACE and has always been correct.
 *
 *   `machines.pick` and `factory.pick` measure `t` to a CENTRE. For those two
 *   the same 3.5 m silently meant "3.5 m minus half a housing", which is the
 *   FS-63 defect class: an 8 m assembler's centre is 4.000 m inside its own face,
 *   so it could not be aimed at from any position that exists in the world while
 *   every table, port, link and report field read healthy.
 *
 * So the frame is now in the NAME, the two ray-marching callers are unchanged
 * bit for bit, and the two centre-based callers add the candidate's own
 * half-extent on the way in (`FactoryKinds.reachToCentreM` for a `BuildKind`,
 * `FactorySolids.tangentHalfExtentM` off the collision proxy for a hand
 * machine). A name that states its frame is what stops the third centre-based
 * picker being written against the wrong one.
 */
export const PICK_REACH_PAST_SURFACE_M = 3.5;

export function pickAim(g: Gameplay, ray: AimRayLike): void {
  const o = ray.origin;
  const d = ray.dir;
  const reach = PICK_REACH_PAST_SURFACE_M;
  g.aimedMachine = g.machines.pick(o, d, reach);
  g.aimedBuild = g.aimedMachine !== null ? null
    : g.factory.pick(o, d, reach, true);
  g.aimedPart = g.aimedMachine !== null || g.aimedBuild !== null ? null
    : g.structures.pick(o, d, reach);
  g.aimedStation = g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null ? null : g.stations.pick(o, d, reach);
  g.aimedAntenna = g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null || g.aimedStation !== null
    ? null : g.antennas.pick(o, d, reach);
  g.aimedInvestigate = g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null || g.aimedStation !== null || g.aimedAntenna !== null
    ? null : pickInvestigate(g.ruins, new Sites(g.core, g.bodyHandle), o, d, reach);
  g.aimedPad = g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null || g.aimedStation !== null || g.aimedAntenna !== null
    || g.aimedInvestigate !== null
    ? null : g.pads.pick(o, d, reach);
}
