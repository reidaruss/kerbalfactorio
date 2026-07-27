// A SAVE THE WORLD CANNOT DESCRIBE MUST NOT BE WRITTEN (PH-30, physics R11).
//
// The world save has no field for a vessel, and the autosave fires every 20
// seconds regardless of what the player is doing (`Gameplay.ts` AUTOSAVE_TICKS,
// above the `uiOpen || suspended` return, so it fires while strapped in). A slot
// written while the player is in orbit is therefore a perfectly VALID GROUND
// state: reload it and the base, the pack and the tunnels all come back, the
// player is standing at the scenario spawn, and the rocket they were flying
// simply never existed. Every number in that save is correct. Nothing anywhere
// says the flight was dropped.
//
// That is the shape of defect this project keeps paying for: self-consistent,
// instrument-clean, and wrong. So while a save cannot describe the world it is
// REFUSED, and the refusal is
//   (a) COUNTED, so a probe can prove the gate FIRED rather than prove that
//       nothing happened, which DW-20 says is a different claim, and
//   (b) SHOWN, as a standing chip on the navball, so the player learns it
//       before they reload instead of afterwards.
//
// The last slot on disk stays the last GROUND state, which is exactly where a
// reload should put somebody whose flight was not saved.
//
// WHY A LATCH AND NOT AN EVENT. There is no before-save hook in the save path;
// there is no hook of any kind (`Persist.ts` `snapshot`/`apply` are 11 and 10
// positional parameters of concrete collaborators). Threading a flight
// reference through both to carry one boolean would couple the save format to
// the flight lane for no gain. A module latch is the smaller commitment and it
// is trivially removable the day a vessel really is serialised.
//
// NOT INHIBITED: a vessel PARKED on the ground while the player walks around.
// That save describes the player and the base correctly and loses only the
// rolled-out hull, which costs one key press to put back because the DESIGN is
// persisted separately (`VabStore`, localStorage). Inhibiting there would mean
// a player who rolls out a rocket and then lays track for ten minutes never
// autosaves again, which trades a small loss for a large one.

let reason = '';
let refused = 0;
let allowed = 0;

/** Refuse world saves, and say why in words a player can read. */
export function inhibitSave(why: string): void { reason = why; }

/** Let world saves through again. */
export function allowSave(): void { reason = ''; }

/** The current refusal, or '' when saving is allowed. */
export function saveInhibit(): string { return reason; }

/** Called by the save path itself, on both branches. Counting the ALLOWED ones
 *  as well is what makes a gate that is stuck ON distinguishable from a world
 *  that simply never tried to save. */
export function noteSave(wasRefused: boolean): void {
  if (wasRefused) refused += 1; else allowed += 1;
}

export function saveInhibitReport(): { reason: string; refused: number; allowed: number } {
  return { reason, refused, allowed };
}
