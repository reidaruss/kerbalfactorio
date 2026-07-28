// FS-45: WHY A BELT DID NOT CONNECT, AND WHAT TO DO ABOUT IT.
//
// Split out of `FactoryPorts` the moment that file crossed the 400-line cap,
// and split along a seam that was already there rather than at the line the cap
// happened to fall on. `FactoryPorts` answers a question about GEOMETRY: do
// these two sockets meet. This file answers a question about a PLAYER: you
// pointed a belt at that machine and nothing happened, here is why and here is
// the fix. The two have different audiences and different failure modes, and
// the sentences below are the only part of the port model that a person reads.
//
// WHY THERE IS A FILE FOR THIS AT ALL, which is the decision worth recording.
// A port model refuses far more often than proximity wiring did, and that is
// the point: FS-17's permanent deadlock and FS-41's coal-to-iron smelter were
// both connections nobody asked for, made silently. But a refusal that is only
// an ABSENCE is a worse deadlock than the one it replaces, because a missing
// connection looks exactly like a machine that has not started yet. So every
// refusal carries two strings, and neither is optional: `reason` says what is
// wrong in terms of the thing the player can see, naming the building and the
// socket, and `fix` says which key to press or which way to move. The ghost
// shows them before the button goes down (`FactoryGhost.portPreview`), the
// crosshair shows them for ever afterwards (`FactoryReport.buildPrompt`), and
// the factory report publishes them so a probe can assert on the sentence
// rather than on its absence.

import * as THREE from 'three';
import { FOOTPRINT, type BuildKind } from './FactoryKinds.js';
import { fitOf, portsOf, PORT_BEHIND_M, PORT_FACE_DOT, PORT_MATE_M,
  type PortDef, type PortFit, type PortHost, type PortWorld } from './FactoryPorts.js';
import { MACHINE_TILE_M } from './MachinePlacement.js';

/**
 * How far PAST A MACHINE'S OWN FACE a belt's end port may be and still be
 * considered "the thing this belt was aimed at", for the purpose of REFUSING out
 * loud rather than saying nothing.
 *
 * A belt that stops three cells short of a smelter has not failed to connect, it
 * simply is not near it, and shouting about that would make the refusal channel
 * worthless within one base.
 *
 * FS-75: THIS WAS `REFUSAL_NOTICE_M = 2.6` AND THE HOUSING WAS COUNTED TWICE.
 * The constant's own comment justified 2.6 as a distance to the machine's CENTRE
 * that already contained the housing ("the far side of a 2 m housing is 1.0 m of
 * that budget"), and then the one call site added `FOOTPRINT * 0.5` on top of it,
 * so the bound a 2 m machine actually enforced was 3.6 m and not the 2.6 m the
 * prose claimed. Nothing failed, because nothing had ever measured it; it is the
 * shape INSTRUMENTS.md calls a constant that encodes a size, one layer further in
 * than DW-33 found it.
 *
 * So the quantity authored here is the one the call site actually wants, a
 * clearance past the FACE, and it is derived rather than picked: one grid cell,
 * because a belt one cell short of mating is exactly the case that must still be
 * noticed, plus `PORT_MATE_M`, because that is the envelope inside which a port
 * pair is judged at all. 1.00 + 0.65 = 1.65 m, which puts a 2 m machine at
 * 2.65 m to its centre, i.e. within 0.05 m of the number the old comment always
 * SAID it was enforcing, and a 4 m machine at 3.65 m. The double count is gone
 * and the intent is unchanged.
 */
const NOTICE_PAST_FACE_M = MACHINE_TILE_M + PORT_MATE_M;

/**
 * FS-45: WHY A BELT DID NOT CONNECT, IN A SENTENCE THE PLAYER CAN ACT ON.
 *
 * A refusal that is only an absence is the deadlock this whole change exists to
 * prevent, restated. The old proximity wiring never refused anything: it wired
 * whatever was near, which is how a smelter ended up on the tail of the run whose
 * head fed it (FS-17) and how coal ended up inside an iron recipe (FS-41). A port
 * model refuses much more often and that is the point, so every refusal has to
 * arrive with the reason and with the fix, or the model has traded a silent wrong
 * connection for a silent missing one, which is not an improvement.
 */
export interface PortRefusal {
  /** The plan id of the part that was trying to connect, and of what it hit. */
  from: number;
  to: number;
  /** The port that was presented, and the nearest port on the other building. */
  fromPort: string;
  nearestPort: string;
  gapM: number;
  facing: number;
  /** FS-76: the SIGNED separation along the offering port's own face. Negative
   *  means the inlet is BEHIND that face, i.e. the belt is standing inside the
   *  housing. Carried on the refusal because "both numbers" is what makes a
   *  refusal checkable: `gapM` alone cannot tell a belt that is short of a port
   *  from one that has gone through it. -1 on the no-ports branch, where there
   *  is no port to measure against. */
  alongM: number;
  /** What is wrong, and what to do about it. Both are shown to the player. */
  reason: string;
  fix: string;
}

/**
 * Classify a failed hand-off. `from` is the outlet doing the offering.
 *
 * THE ORDER OF THE TESTS IS THE ORDER OF THE FIXES, which is why it is fixed
 * here and not left to whichever branch happens to match. A player whose belt is
 * pointed at the wrong FACE needs to hear that before they hear that it is also
 * 1.8 m away, because turning the machine fixes both and moving the belt closer
 * fixes neither.
 */
export function refusalFor(from: PortWorld, aim: AimedBuilding,
                           up: THREE.Vector3): PortRefusal | null {
  const other = aim.build;
  const cand = aim.ports;
  const label = `#${other.id} ${other.kind}`;
  // A PART WITH NO PORTS AT ALL still gets a sentence, and it has to: a pole and
  // a generator are grid citizens with no item IO whatever (FactoryKinds says
  // so), and a player who has just belted ore into the side of a generator is
  // owed the reason rather than a silent nothing.
  if (cand.length === 0) {
    return {
      from: from.build.id, to: other.id, fromPort: from.name,
      nearestPort: '', gapM: -1, facing: 0, alongM: -1,
      reason: `${label} has no item ports at all, so a belt cannot connect to it`,
      fix: 'belt into a smelter, or take the line somewhere else',
    };
  }
  // The nearest port on the other building, whatever its direction: naming the
  // port a player is standing closest to is the only way the sentence points
  // anywhere.
  let near = cand[0];
  let nearFit = fitOf(from, near, up);
  for (const c of cand) {
    const f = fitOf(from, c, up);
    if (f.gapM < nearFit.gapM) { near = c; nearFit = f; }
  }
  const ins = cand.filter((c) => c.dir === 'in');
  if (ins.length === 0) {
    return row(from, near, nearFit, other,
      `${label} has no input port, so nothing can be belted into it`,
      'move the belt, or put a machine that takes input here');
  }
  // Is there an inlet that would have taken it but for one rule?
  let best = ins[0];
  let bestFit = fitOf(from, best, up);
  for (const c of ins) {
    const f = fitOf(from, c, up);
    // Rank by facing first: a well aimed inlet that is too far is a different
    // fault from a close one pointing the wrong way, and the first is the one
    // worth reporting.
    if (f.facing < bestFit.facing - 1e-6
      || (Math.abs(f.facing - bestFit.facing) <= 1e-6 && f.gapM < bestFit.gapM)) {
      best = c; bestFit = f;
    }
  }
  if (bestFit.facing > PORT_FACE_DOT) {
    return row(from, best, bestFit, other,
      `the belt runs into the housing of ${label}, not into a port: `
      + `its ${best.name} faces the other way`,
      `turn ${label} with the rotate key until its input faces the belt`);
  }
  // FS-76: THE PORT IS BEHIND THE FACE, NOT SHORT OF IT, AND THOSE ARE DIFFERENT
  // SENTENCES. `gapM` is a magnitude, so a belt half a metre INSIDE a housing and
  // a belt half a metre short of it produce the identical number, and the sentence
  // below would tell a player whose belt is buried in a smelter to move it
  // closer. The signed `alongM` is what separates them, and this branch exists
  // because a world saved before FS-73's rescale is full of exactly this
  // arrangement: the machine grew outward around a belt that did not move.
  if (bestFit.alongM <= -PORT_BEHIND_M) {
    return row(from, best, bestFit, other,
      `the belt ends ${(-bestFit.alongM).toFixed(2)} m INSIDE ${label}: its `
      + `${best.name} is behind the belt's own end, not in front of it`,
      `move the belt back one cell, away from ${label}`);
  }
  return row(from, best, bestFit, other,
    `the belt stops ${bestFit.gapM.toFixed(2)} m short of ${label}'s ${best.name}`,
    bestFit.gapM > PORT_MATE_M
      ? 'move the belt one cell along, so its end meets the port'
      : 'move the belt so its end meets the port');
}

function row(from: PortWorld, near: PortWorld, fit: PortFit, other: PortHost,
             reason: string, fix: string): PortRefusal {
  return {
    from: from.build.id, to: other.id, fromPort: from.name,
    nearestPort: near.name, gapM: +fit.gapM.toFixed(3),
    facing: +fit.facing.toFixed(3), alongM: +fit.alongM.toFixed(3), reason, fix,
  };
}

/**
 * Which buildings an unconnected outlet was plainly AIMED at, nearest first.
 *
 * "Plainly aimed at" is two tests and neither is optional. The building has to
 * be inside `NOTICE_PAST_FACE_M` of the port's own face, which keeps the channel
 * quiet, and
 * it has to be roughly AHEAD of the port rather than behind it, which is what
 * stops the tail of a run complaining about the drill that feeds it.
 */
export interface AimedBuilding { build: PortHost; ports: PortWorld[]; distM: number }

export function aimedAt(from: PortWorld, placed: readonly PortHost[],
                        ports: ReadonlyMap<BuildKind, PortDef[]>):
AimedBuilding | null {
  let best: AimedBuilding | null = null;
  for (const b of placed) {
    if (b === from.build || b.kind === 'belt') continue;
    const dx = b.pos.x - from.world.x;
    const dy = b.pos.y - from.world.y;
    const dz = b.pos.z - from.world.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > NOTICE_PAST_FACE_M + FOOTPRINT[b.kind] * 0.5) continue;
    if (dx * from.face.x + dy * from.face.y + dz * from.face.z <= 0) continue;
    if (best !== null && d >= best.distM) continue;
    best = { build: b, ports: portsOf(b, ports), distM: d };
  }
  return best;
}
