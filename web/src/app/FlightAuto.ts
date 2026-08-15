// =============================================================================
// FlightAuto.ts - R99's AUTO-APPROACH, THE CLIENT SIDE OF IT. (PH-383..PH-386.)
//
// The docking control has two halves and they are two files for the reason
// `FlightRcs.ts` and `AutopilotRun.ts` are separate from their siblings: the
// planning/manual half and the executing half are separate questions with
// separate failure modes, and `FlightDock.ts` was already over the 400 line cap
// before this existed (R53's rule: the new work is the file that does not make
// that worse).
//
// WHAT LIVES HERE: the progression GATE, the publication a screen draws, the
// AUTO verb, and the bookkeeping for a join the sim made on its own.
// WHAT DOES NOT: the flight law, which is `of::approach::guide` in /core and is
// reached through `sim/FlightApproach.ts`; and the rig, which is
// `FlightDock.ts`'s and is aimed by `armDock` every frame.
// =============================================================================
import { approachReport, legWord } from '../sim/FlightApproach.js';
import { dockStatus } from '../sim/FlightAbi.js';
import { registry } from '../sim/VesselRegistry.js';
import { MILESTONE } from '../game/Research.js';
import { dockPublication, latchFrom } from './FlightDock.js';
import type { FlightMode } from './FlightMode.js';

// =============================================================================
// PH-383 to PH-385. THE AUTO-APPROACH: THE GATE, THE VERB, AND THE JOIN.
//
// THE GATE IS `milestones::StationBoarded` AND IT IS REID'S RULING, NOT A
// BALANCE CHOICE (task 39, recorded in CLAUDE.md): "the first station mission is
// hand flown and difficult on purpose", and "the autopilot moves BEHIND the
// station visit rather than being research-gated before it".
//
// THAT SECOND CLAUSE IS WHY THIS IS A MILESTONE AND NOT A TECH, which is worth
// spelling out because the obvious move is the wrong one. `research.h` already
// ships `techs::FlightAutopilot`, and its `requiresMilestone` is `ReachedOrbit`
// -- a rung the player passes BEFORE the station, since you cannot fly to
// Anchorage without reaching orbit. Hanging auto-approach off that tech would
// therefore have made it available for the very mission it is meant to sit
// behind, which is the exact ordering the ruling forbids. `StationBoarded` is
// granted by `StationReveal.ts` on the rising edge of the walker standing on
// Anchorage's frame, i.e. by the hand-flown mission itself, so gating on it
// makes the order true by construction rather than by a balance number.
//
// It is read through a PORT (`FlightDeps.milestone`) rather than by giving
// flight a reference to gameplay: flight already reaches the pads and the HUD
// that way, and a flight mode that could see the whole research tree would be
// able to grow opinions about it.
// =============================================================================

/** What the flight UI needs to draw the AUTO control truthfully. Same shape and
 *  same rules as `DockPublication`: `why` is NEVER '' and the numbers beside it
 *  are /core's. */
export interface ApproachPublication {
  /** The player has earned it. FALSE is a progression fact and is a different
   *  sentence from "you cannot use it here". */
  unlocked: boolean;
  /** The program is flying the vehicle right now. */
  running: boolean;
  /** The press would arm it. */
  available: boolean;
  /** `approach::Leg` as a short stable word: OFF / ALIGNING / CORRIDOR / FINAL
   *  / CONTACT / ABORTED. */
  legWord: string;
  /** THE LAW'S OWN SENTENCE while it runs, or the refusal while it does not.
   *  Printed verbatim, never branched on. */
  why: string;
  rangeM: number;
  lateralM: number;
  closingMS: number;
  aimErrorDeg: number;
}

const NO_APPROACH_PUB: ApproachPublication = {
  unlocked: false, running: false, available: false, legWord: 'OFF',
  why: '', rangeM: 0, lateralM: 0, closingMS: 0, aimErrorDeg: 180,
};

/** Has the player boarded Anchorage yet? A missing port reads as NOT earned,
 *  which is the honest default: a boot with no gameplay has no progression to
 *  have passed, and a gate that fails open is a gate. */
export function approachUnlocked(m: FlightMode): boolean {
  return m.d.milestone?.(MILESTONE.StationBoarded) ?? false;
}

/** The live state of the AUTO control, composed for a screen. Pure, so the
 *  chip, the report and the key press all ask the same question. */
export function approachPublication(m: FlightMode): ApproachPublication {
  const a = approachReport(m.session);
  const unlocked = approachUnlocked(m);
  const running = a.armed === true;
  const leg = legWord(Number(a.leg ?? -1));
  const base = {
    ...NO_APPROACH_PUB, unlocked, running,
    legWord: running ? leg : 'OFF',
    rangeM: Number(a.rangeM ?? 0), lateralM: Number(a.lateralM ?? 0),
    closingMS: Number(a.closingMS ?? 0),
    aimErrorDeg: Number(a.aimErrorDeg ?? 180),
  };
  // THE ORDER OF THESE REFUSALS IS THE ORDER A PLAYER CAN FIX THEM IN, which is
  // GP-56's rule read forwards: the progression gate first, because no amount
  // of flying will open it; then the bridge; then the geometry.
  if (!unlocked) {
    return { ...base, why: 'auto-approach is locked: dock with the station by '
      + 'hand first' };
  }
  const waiting = String(a.waitingOn ?? '');
  if (waiting !== '') {
    return { ...base, why: `auto-approach needs a wasm rebuild: ${waiting}` };
  }
  if (running) return { ...base, available: true, why: String(a.note ?? '') };
  const d = dockPublication(m);
  if (!d.hasTarget) return { ...base, why: d.why };
  if (d.docked) return { ...base, why: 'already docked' };
  return { ...base, available: true, why: 'ready to fly the approach' };
}

/**
 * THE AUTO KEY: arm when it is off, cancel when it is on.
 *
 * One verb with two meanings decided by state, on `toggleDock`'s own precedent
 * ("ONE key, three meanings, decided by where you are standing"). Returns true
 * when something happened; a refusal flashes its reason and is counted, so a
 * probe can prove the refusal fired rather than infer it from nothing.
 */
export function toggleApproach(m: FlightMode): boolean {
  if (!m.aboard || !m.session.live) { m.refuse('not flying'); return false; }
  if (m.session.approachArmed) {
    m.session.stopApproach('auto-approach off: you have the controls');
    return true;
  }
  const p = approachPublication(m);
  if (!p.available) { m.refuse(p.why); return false; }
  // `armApproach` refuses on the BRIDGE and on the RIG; `approachPublication`
  // refuses on the GATE. Two refusers because they answer two questions, and
  // both sentences reach the player through the same one line.
  const why = m.session.armApproach();
  if (why !== '') { m.refuse(why); return false; }
  m.approaches += 1;
  m.flash(`auto-approach armed for ${m.dockTarget?.hostName ?? 'the port'}: `
    + 'any control input takes it back');
  return true;
}

/**
 * PH-385. THE JOIN THE STEP MADE, BOOKED ON THIS SIDE.
 *
 * Under auto-latch the capture happens INSIDE `of_fl_step` (`dkCaptureStep`
 * calls `dkJoin`), and nothing on this side is told. The manual door does its
 * own bookkeeping inside `dock()`; this is the same bookkeeping for the door
 * that has no press, and it is deliberately the SAME `latchFrom` rather than a
 * second derivation, because "where a docked vessel sits relative to its host"
 * must have exactly one answer (see `VesselDock`).
 *
 * IT IS EDGE-TRIGGERED ON /core's OWN `captured`, NOT ON A LEG. The program's
 * `Contact` leg means "the capture test now decides", which is a different
 * claim from "it decided yes": a vessel can sit in Contact for many ticks with
 * the cone still out. Reading the mechanism's own flag is the only version of
 * this that cannot book a dock that did not happen.
 *
 * Called once per frame from `FlightMode.frame`, after `armDock`. A frame is
 * the right rate because nothing here is physics: the join already happened,
 * at the right tick, in the sim.
 */
export function syncAutoDock(m: FlightMode): void {
  if (!m.session.live) return;
  const rec = registry.promoted;
  if (rec === null || rec.docked !== undefined) return;
  const t = m.dockTarget;
  if (t === null) return;
  if (!dockStatus(m.d.M, m.session.handle).captured) return;
  // The sim moved the vehicle onto the port when it latched; read it back
  // before deriving the local pose from it.
  m.session.sample();
  rec.docked = latchFrom(m, t);
  m.docks += 1;
  m.session.stopApproach('');
  m.flash(`auto-approach complete: docked with ${t.hostName}`);
}
