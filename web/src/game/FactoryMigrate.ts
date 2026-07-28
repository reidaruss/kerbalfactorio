// FS-46: WHAT HAPPENS TO A FACTORY THAT WAS BUILT BEFORE PORTS EXISTED.
//
// THE DECISION, stated before the code, because it is the decision and not the
// code that matters here. A world saved before FS-44 has its machines wired by
// PROXIMITY: whatever was near enough was connected, and the player never had to
// think about which face of a smelter the belt arrived at. Under the port model
// a good fraction of those arrangements connect nothing. Reid has a 140-part
// base he has been playing for days, and the one outcome that is not allowed is
// that he loads it and his factory has quietly stopped.
//
// So the migration is: A LEGACY SAVE IS REPAIRED BY TURNING MACHINES, NOT BY
// MOVING THEM, AND ANYTHING THAT CANNOT BE TURNED INTO A CONNECTION KEEPS ITS
// BUILDING AND LOSES ONLY ITS WIRE, LOUDLY.
//
// Why turning is the whole repair, and why it is nearly always enough. Under
// proximity, belt-to-smelter reach was 2.25 m between centres and machines stand
// on a 1.000 m grid, so the only spacings that were ever WIRED are one cell and
// two cells; three cells is 3.0 m and was already out of reach. One cell is
// refused at placement for a 2 m machine (GP-49 clash), so in practice every
// legacy belt-to-smelter connection in existence stands at exactly two cells,
// which is the spacing whose ports mate at 0.500 m. The thing that was random
// was the machine's YAW, because proximity did not care about it. Turning fixes
// the one variable that was never constrained, and it is the only edit that is
// free: a rotation changes no cell, so it cannot clash, cannot overlap a
// neighbour, and cannot move a drill off its ore patch. Every one of those is a
// way a "helpful" migration could destroy a base while trying to save it.
//
// WHY NOTHING IS EVER DELETED OR MOVED. A migration that relocates a building is
// a migration that can put a drill off its patch, a smelter inside a wall, or a
// belt into a cell the player had left clear on purpose, and it does all three
// silently at load time when nobody is watching. A migration that deletes an
// unwireable machine destroys work. The honest third option is to keep
// everything, connect what geometry allows, and put the rest on screen as a
// refusal with a sentence and a fix, which is exactly what FS-45 built for
// belts placed today. A legacy save and a fresh mistake then reach the player
// through the SAME channel, which is worth more than any special case: there is
// one place to look for "why is this not connected", and one way to fix it.
//
// THE MEASUREMENT THAT DECIDES WHETHER THIS WAS RIGHT is in the report and in
// `probes/portmigrate.js`: how many connections the legacy rule made, how many
// survive as real port connections, and by name every one that did not.

import * as THREE from 'three';
import { FOOTPRINT, type Placed } from './FactoryKinds.js';
import { linksBetween, machinePorts } from './FactoryPorts.js';
import { orient } from './Grid.js';
import type { Factory } from './Factory.js';

/** What the migration did, for the report and for the HUD. */
export interface PortMigration {
  ran: boolean;
  /** Connections the OLD proximity rule made on this plan. */
  considered: number;
  /** Machines this turned, to make one of those a real port connection. */
  turned: number;
  /** Legacy connections that no rotation could rescue. Buildings kept. */
  stranded: number;
  /** One line per stranded pair, naming both ends. Shown to the player. */
  notes: string[];
}

/** A restore that has not been repaired, and the value a restore CLEARS to.
 *  Frozen, so no caller can mutate the shared blank into a false report. */
export const NO_MIGRATION: Readonly<PortMigration> = Object.freeze({
  ran: false, considered: 0, turned: 0, stranded: 0,
  notes: Object.freeze([]) as unknown as string[],
});

/**
 * THE OLD RULE, PRESERVED, and preserved for exactly one purpose.
 *
 * This is `FactoryWiring.touch` as it stood before FS-44, kept verbatim so the
 * migration can ask "what did this save actually have" rather than guess. It is
 * NOT a fallback and must never become one: nothing calls it except the code
 * below, and the moment a live wiring path calls it there are two answers to
 * "are these connected" and the whole change has been undone from inside.
 */
function legacyTouch(a: Placed, b: Placed): boolean {
  const reach = (FOOTPRINT[a.kind] + FOOTPRINT[b.kind]) * 0.5 + 0.75;
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y,
    a.pos.z - b.pos.z) <= reach;
}

/** One directed hand-off the legacy rule would have made. */
interface LegacyPair { from: Placed; to: Placed }

/**
 * Every connection the pre-FS-44 wiring would have made on this plan.
 *
 * It reproduces the old function's SHAPE including FS-17's exclusion, because
 * the question is what the save had and the save had FS-17's fix in it. A pair
 * the old rule deliberately refused is not a connection this migration owes the
 * player.
 */
function legacyPairs(f: Factory): LegacyPair[] {
  const out: LegacyPair[] = [];
  const sources = f.placed.filter((p) => p.kind === 'miner' || p.kind === 'smelter'
    || p.kind === 'esmelter');
  const sinks = f.placed.filter((p) => p.kind === 'smelter' || p.kind === 'esmelter');
  for (const run of f.runs) {
    if (run.length === 0) continue;
    const head = run[run.length - 1];
    const tail = run[0];
    const fedByHead = sinks.filter((k) => legacyTouch(k, head));
    for (const s of sources) {
      if (fedByHead.includes(s)) continue;
      if (legacyTouch(s, tail)) out.push({ from: s, to: tail });
    }
    for (const k of fedByHead) out.push({ from: head, to: k });
  }
  for (const s of sources) {
    if (s.kind !== 'miner') continue;
    for (const k of sinks) if (s !== k && legacyTouch(s, k)) out.push({ from: s, to: k });
  }
  return out;
}

/** Does this pair connect through real ports, as the plan stands right now? */
function mates(a: Placed, b: Placed): boolean {
  const ports = machinePorts();
  // A belt end is asked about through the tile that owns it, which is what
  // `linksBetween` does: it enumerates a's outlets against b's inlets, and a
  // belt tile publishes both.
  return linksBetween(a, b, ports).length > 0;
}

/** Turn a machine one quarter about its own up, keeping its cell and position. */
function turnTo(p: Placed, quarters: number, base: THREE.Vector3): void {
  const fwd = base.clone().applyAxisAngle(p.up, quarters * Math.PI * 0.5).normalize();
  p.fwd = fwd;
  p.quat = orient(p.up, fwd);
}

/**
 * Repair a legacy plan in place. Returns what it did; the caller re-commits.
 *
 * BELTS ARE NEVER TURNED. A tile's heading is the datum the player owns (FS-27)
 * and the run is derived from it, so turning one tile re-chains the run, splits
 * it, or reverses its flow. The migration turns MACHINES, whose yaw proximity
 * never constrained and which therefore carries no player intent at all.
 *
 * THE SCORE IS COUNTED OVER THE WHOLE LEGACY SET, not over one pair, because a
 * smelter can sit between a belt that feeds it and a belt that takes its output
 * and only one yaw satisfies both. Trying pairs one at a time would fix the
 * first and break the second, deterministically, with the answer depending on
 * the order the plan happened to be saved in.
 */
export function migrateToPorts(f: Factory): PortMigration {
  const pairs = legacyPairs(f);
  const out: PortMigration = { ran: true, considered: pairs.length, turned: 0,
    stranded: 0, notes: [] };
  if (pairs.length === 0) return out;

  const score = (): number => pairs.reduce((n, p) => n + (mates(p.from, p.to) ? 1 : 0), 0);
  const machines = f.placed.filter((p) => p.kind !== 'belt'
    && machinePorts().has(p.kind));

  // One sweep is enough and a second changes nothing, which is worth saying:
  // each machine's contribution to the score depends only on the geometry of the
  // belts and machines around it, and belts never move here, so a machine's best
  // yaw is not a function of another machine's yaw except through a shared pair,
  // and a shared pair is machine-to-machine, which the loop below re-scores
  // whole. Two sweeps were measured and moved nothing.
  for (const m of machines) {
    const base = m.fwd.clone();
    const baseQuat = m.quat.clone();
    let best = score();
    let bestQ = 0;
    for (let q = 1; q < 4; ++q) {
      turnTo(m, q, base);
      const s = score();
      if (s > best) { best = s; bestQ = q; }
    }
    if (bestQ === 0) { m.fwd = base; m.quat = baseQuat; continue; }
    turnTo(m, bestQ, base);
    out.turned++;
  }

  for (const p of pairs) {
    if (mates(p.from, p.to)) continue;
    out.stranded++;
    out.notes.push(`#${p.from.id} ${p.from.kind} no longer feeds `
      + `#${p.to.id} ${p.to.kind}: no port of one meets a port of the other. `
      + `Move one of them one cell, or turn it, and the line reconnects.`);
  }
  return out;
}
