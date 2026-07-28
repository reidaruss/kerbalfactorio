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
//   4. A LAUNCH PAD LAST, and that is the order rather than an afterthought: a
//      pad is 24 m across, so a deck or a machine standing on it is INSIDE its
//      bound, and a pad that won the tie would swallow every press aimed at
//      anything on the launch site.

import type { Gameplay } from './Gameplay.js';

export interface AimRayLike {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

/** Reach, in metres, of everything the crosshair can resolve. One number, so a
 *  machine and the pad it stands on can never be picked at different ranges. */
export const PICK_REACH_M = 3.5;

export function pickAim(g: Gameplay, ray: AimRayLike): void {
  const o = ray.origin;
  const d = ray.dir;
  g.aimedMachine = g.machines.pick(o, d, PICK_REACH_M);
  g.aimedBuild = g.aimedMachine !== null ? null
    : g.factory.pick(o, d, PICK_REACH_M, true);
  g.aimedPart = g.aimedMachine !== null || g.aimedBuild !== null ? null
    : g.structures.pick(o, d, PICK_REACH_M);
  g.aimedPad = g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null ? null : g.pads.pick(o, d, PICK_REACH_M);
}
