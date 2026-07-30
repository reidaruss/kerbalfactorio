// PH-86: THE DAY/NIGHT CLOCK. One full day plus night is DAY_CYCLE_S seconds of
// WORLD sim time, and this module is the one authority on the phase.
//
// Before this file the sun did not move at all: `SkyPass.sunT` was written once
// at boot (solved so the spawn is lit) and again only by `of.setTime`, so every
// site sat at a permanent time of day fixed by its longitude (RN-67 measured a
// candidate site "stuck at" a 9 degree sun; the driven-walk capture that "came
// back at night" was a TELEPORT to a longitude whose fixed phase was night, not
// a clock that had moved). RN-13's rationale said "the sun moves with sim time";
// the re-pinning practice it prescribes is right anyway, and with this file it
// stops being merely prophylactic.
//
// WHY THE CLIENT AND NOT /core: /core has no sun. `flight.h` carries
// `bodySpinRadS = 0.0` ("zero until core-engine publishes a rotation rate on
// BodyParams") and nothing else under core/ mentions a sun direction, so the
// day/night sweep is a RENDERING fact with no dynamic coupling: no launch-site
// velocity, no ground-track drift, no atmosphere co-rotation. The globe does not
// rotate; the sun revolves about the +Y pole (SkyPass.dirForT), which is the
// same sky for a ground observer and deliberately nothing for an orbit.
//
// THE CLOCK IS THE LOOP'S FIXED TICK, the same clock the wind, the water and the
// terrain cross-fade read (Loop.simSecs), so the sky pauses and advances exactly
// as they do. PHYSICS WARP is the one exception and it is credited explicitly:
// `of_fl_step_n` advances the VESSEL's time n steps per loop tick while the
// world stays at 1x, so a vessel warping through a night would otherwise watch
// the sun hang still for 30 real minutes. `dayWarpCredit` folds the surplus
// (n - 1 steps) into the day clock, so a day passes quickly under warp. The
// factory deliberately does NOT get the same credit: warp is flight-local by
// design (PH-26), and the incoherence between the vessel clock and the factory
// clock predates this file.
//
// `of.setTime(t)` PINS the phase and the cycle runs on from there, which is what
// keeps every screenshot probe deterministic: a pinned sun stays where it was
// put for the seconds a capture takes (1 s of run moves it 1/3600 of a turn,
// 0.1 degrees), and RN-13's re-pin-before-capture practice covers the rest.
//
// Save behaviour: the phase is stamped into the slot at the `writeSlot` choke
// point as `dayT` and stashed back at `readSlot`, so a save made at noon loads
// at noon. A slot with no field (every save written before tonight) seeds from
// the boot solve, which is the exact pre-cycle behaviour: the spawn boots lit.

/** One FULL day+night in seconds of world sim time at 1x. Reid: "i think 1 hr
 *  day night cycle is good" (2026-07-30). At the spawn's latitude (about 2 deg)
 *  the split is near-even: about 30 min of light, 30 min of dark. */
export const DAY_CYCLE_S = 3600;

let tTurns = 0;
let seeded = false;
let stashed: number | null = null;
let warpCreditS = 0;
/** Counters for the debug report: proof the clock is alive and who moved it. */
let advancedTicks = 0;
let warpCreditsS = 0;
let pins = 0;

/** Set the phase absolutely (of.setTime, the save restore). The cycle continues
 *  from the pinned value; nothing about the rate changes. */
export function dayPin(t: number): void {
  tTurns = wrap(t);
  seeded = true;
  pins += 1;
}

/**
 * Advance one fixed tick and return the phase in turns [0,1). `seedT` is the
 * sky's CURRENT angle and is adopted on the first call only: the boot solve
 * (or `?t=`) has already written it, so the cycle starts from what the boot
 * chose. A stashed save phase wins over the solve, and an EXPLICIT `?t=` wins
 * over the stash, because a probe that pins the sun on its command line must
 * get that sun whatever world it loaded (RN-13).
 */
export function dayAdvance(dtS: number, seedT: number, seedExplicit: boolean): number {
  if (!seeded) {
    tTurns = wrap(seedExplicit ? seedT : stashed ?? seedT);
    stashed = null;
    seeded = true;
  }
  const extra = warpCreditS;
  warpCreditS = 0;
  tTurns = wrap(tTurns + (dtS + extra) / DAY_CYCLE_S);
  advancedTicks += 1;
  return tTurns;
}

/** PH-26 physics warp: the vessel took n steps of dt this tick; the world took
 *  one. Credit the surplus so the sky keeps pace with the vessel's clock. */
export function dayWarpCredit(extraS: number): void {
  if (extraS > 0) { warpCreditS += extraS; warpCreditsS += extraS; }
}

/** The phase in turns [0,1). What `writeSlot` stamps into the slot. */
export function currentDayT(): number { return tTurns; }

/** `readSlot` hands the accepted slot's `dayT` here; boot adopts it on the
 *  first tick. Same stash-and-take shape as `VesselSave`, same reason: the
 *  save layer must not reach into the render layer. */
export function stashDayT(v: unknown): void {
  stashed = typeof v === 'number' && Number.isFinite(v) ? wrap(v) : null;
}

export function dayReport(): Record<string, unknown> {
  return { cycleS: DAY_CYCLE_S, t: tTurns, seeded, advancedTicks,
           warpCreditedS: Math.round(warpCreditsS * 1000) / 1000, pins };
}

function wrap(t: number): number { return ((t % 1) + 1) % 1; }
