// GP-102. WHAT A CHEAT MEANS IN SURVIVAL: it is recorded on the save, for ever.
//
// DW-31 already answers the easy half. Sandbox exists so a designer does not
// have to grind, so a cheat in sandbox is not a cheat at all: it is the mode
// doing its job, and the slot already says `mode: sandbox` on its face, which is
// a stronger and more honest statement than any flag this file could add. So
// sandbox records NOTHING and this file is deliberately inert there.
//
// SURVIVAL IS THE HALF WORTH DECIDING. Reid wants these buttons for testing, and
// nothing here refuses him one: every cheat works in survival exactly as it does
// in sandbox. What survival does is REMEMBER. One list of names, written into
// the slot, restored from it, and never cleared by anything except Start Fresh,
// which destroys the world it belongs to anyway.
//
// WHY WRITE IT NOW RATHER THAN WHEN IT MATTERS. It matters at DW-27, when this
// ships on Steam and an achievement has to decide whether a world earned it. On
// that day the question is asked of worlds that ALREADY EXIST, and a flag that
// started being written on the day it was needed can only answer "no cheat since
// the update", which is not the question. GP-65 proved the same lesson three
// weeks ago by putting health on every buildable before any damage source
// existed: retrofitting state onto live saves is the expensive half, and it is
// the half you cannot do later. The flag costs one optional array today.
//
// IT IS MODULE STATE, not a field on Gameplay, for two reasons. Gameplay is 79
// lines over its 400-line cap and may not grow. And more to the point, the flag
// is a property of the SLOT rather than of the world: `SaveGame.writeSlot` is
// the single choke point every write in the client goes through, so putting the
// read there means no future snapshot path can forget it. Derived at the choke
// point, never registered at the call sites, which is the same rule
// `HealthCensus` states for health and `ModalStack` states for Escape.

import type { GameMode } from './GameMode.js';

/** What the slot carries. Optional and additive: an absent record is a world
 *  nobody cheated in, which is what every world written before tonight is. */
export interface AssistedRecord {
  /** Cheat ids, in the order each was FIRST used. Names rather than a boolean,
   *  because "teleported once" and "flew the whole game on infinite fuel" are
   *  different claims and a bit cannot tell them apart. */
  used: string[];
  /** Epoch millis of the first one. */
  firstAtMs: number;
}

let used: string[] = [];
let firstAtMs = 0;

/**
 * Record that `id` was used, if the mode is one where that means anything.
 *
 * Returns true when this call was the FIRST use of any cheat in a survival
 * world, which is the moment worth telling the player about: they should find
 * out that the world has been marked at the instant it happens, not on the day
 * an achievement quietly does not fire.
 */
export function noteCheat(id: string, mode: GameMode): boolean {
  if (mode === 'sandbox') return false;
  const first = used.length === 0;
  if (!used.includes(id)) used.push(id);
  if (first) firstAtMs = Date.now();
  return first;
}

/** The record to write into `mode`'s slot, or undefined when there is none. */
export function assistedFor(mode: GameMode): AssistedRecord | undefined {
  if (mode === 'sandbox' || used.length === 0) return undefined;
  return { used: [...used], firstAtMs };
}

/**
 * Put a loaded record back. Takes `unknown` and VALIDATES for the same reason
 * `Hotbar.restore` does: a slot is data from disk and must never brick a boot.
 *
 * It UNIONS rather than replaces. A player who cheated this session and then
 * loaded a slot written before they did has still cheated in this world, and a
 * load that could clear the flag would be a one-keystroke way to launder it.
 */
export function restoreAssisted(v: unknown): void {
  const o = v as { used?: unknown; firstAtMs?: unknown } | null | undefined;
  if (o === null || o === undefined || !Array.isArray(o.used)) return;
  for (const e of o.used) {
    if (typeof e === 'string' && e !== '' && !used.includes(e)) used.push(e);
  }
  const t = typeof o.firstAtMs === 'number' && o.firstAtMs > 0 ? o.firstAtMs : 0;
  if (t > 0 && (firstAtMs === 0 || t < firstAtMs)) firstAtMs = t;
}

/** Start Fresh, and nothing else. The world is being destroyed, so the mark on
 *  it goes with it; keeping it would make a wiped slot permanently guilty of
 *  something no surviving state remembers. */
export function clearAssisted(): void { used = []; firstAtMs = 0; }

/** True once anything has been recorded. Sandbox is never assisted: see the
 *  header, and `ModeRules.sandbox` is the stronger statement anyway. */
export function isAssisted(): boolean { return used.length > 0; }

export function assistedReport(): unknown {
  return { assisted: used.length > 0, used: [...used], firstAtMs };
}
