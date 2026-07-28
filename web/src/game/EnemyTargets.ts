// WHAT THE PLAYER OWNS, AS TWO DERIVED LISTS: what pollutes, and what can be
// bitten. Both are rebuilt from the live populations, never registered.
//
// GP-88. This is `HealthCensus.ts`'s argument applied twice more, and it is
// applied rather than restated because the failure it prevents has now happened
// to this project twice: a per-spawn-site `register` call covers the six sites
// that existed when it was written and silently misses the seventh. A building
// with no emitter row angers nothing and a building with no target row is
// invulnerable, and BOTH read exactly like a quiet world.
//
// THE TWO LISTS ARE DELIBERATELY NOT ONE. A belt is a target (80 hp, "the
// easiest thing to cut") and emits nothing; a pole is a target and emits
// nothing; a generator is both. Merging them would need a zero-rate sentinel,
// and a zero that means "does not pollute" is indistinguishable from a zero that
// means "nobody filled this in", which is the DW-28 failure class in a single
// field.
//
// THE KEYS ARE `Health.ts`'s KEYS, unchanged and re-derived through its own
// functions. A second key scheme over the same four populations is precisely the
// second authority that GP-60 cost a day to, and it would be worse here because
// the symptom is damage landing on nothing: `HealthBook.damage` on an unknown key
// returns `applied: 0` and every other counter in the game reads healthy.

import { factoryHealthKey, machineHealthKey, padHealthKey, structureHealthKey }
  from './Health.js';
import { TYPE_ID, type BuildKind } from './FactoryKinds.js';
import { enemyAbi } from '../sim/wasm/enemyabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { EmitterRow, Vec3 } from './EnemyLoop.js';

/** One thing a creature can stop and chew. */
export interface TargetRow {
  /** The `Health.ts` key. Damage goes nowhere without it. */
  key: string;
  /** For the HUD line and the report: "wall", "generator". */
  kind: string;
  /** Body-frame metres. */
  pos: Vec3;
  /** How close a creature must be to the CENTRE before its reach applies. A
   *  4 m foundation bitten at its centre would need a creature standing in the
   *  middle of it, so the body radius is added to the creature's own reach. */
  radiusM: number;
}

/**
 * Bite radii, authored here as data because they are a COMBAT parameter (how
 * close is close enough) rather than a geometry fact. A pad is 24 m across, so
 * its 12 is not generosity: without it a creature would walk to the centre of
 * the deck to attack the deck it is standing on.
 */
const BITE_RADIUS_M: Record<string, number> = {
  foundation: 2.0, floor: 2.0, wall: 2.0, door: 2.0,
  miner: 1.0, belt: 0.6, smelter: 1.0, esmelter: 1.0, pole: 0.4, generator: 1.2,
  furnace: 1.0, launchpad: 12.0,
};
const DEFAULT_BITE_M = 1.0;

function biteOf(kind: string): number {
  return BITE_RADIUS_M[kind] ?? DEFAULT_BITE_M;
}

/** The read-only shapes of the four populations. Hand-written for the reason
 *  `HealthCensus.ts` gives: importing the classes would drag in three lanes'
 *  modules to read four fields. */
export interface TargetPopulations {
  structures: { parts: readonly { key: string; kind: string;
    pos: { x: number; y: number; z: number } }[] };
  factory: { placed: readonly { cell: string; kind: BuildKind;
    pos: { x: number; y: number; z: number } }[] };
  machines: { list: readonly { tier: number;
    pos: { x: number; y: number; z: number } }[] };
  pads: { list: readonly { siteId: number; i: number; j: number; level: number;
    pos: { x: number; y: number; z: number } }[] };
}

/** Everything standing, with the key its health is filed under. */
export function targetsOf(p: TargetPopulations): TargetRow[] {
  const out: TargetRow[] = [];
  for (const s of p.structures.parts) {
    out.push({ key: structureHealthKey(s.key), kind: s.kind,
      pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z }, radiusM: biteOf(s.kind) });
  }
  for (const f of p.factory.placed) {
    out.push({ key: factoryHealthKey(f.cell), kind: f.kind,
      pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z }, radiusM: biteOf(f.kind) });
  }
  for (const m of p.machines.list) {
    out.push({ key: machineHealthKey(m.pos), kind: m.tier === 1 ? 'smelter' : 'furnace',
      pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z }, radiusM: biteOf('furnace') });
  }
  for (const d of p.pads.list) {
    out.push({ key: padHealthKey(d.siteId, d.i, d.j, d.level), kind: 'launchpad',
      pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z }, radiusM: biteOf('launchpad') });
  }
  return out;
}

/**
 * Everything that pollutes, at /core's OWN rate for its type.
 *
 * `of_en_machine_rate` is asked per row rather than cached in a TypeScript
 * table, which is one WASM call per building per pollution window and is the
 * cheapest possible way to guarantee that a rebalance in `enemies.h` §11 reaches
 * the game rather than only the header. A local copy of {miner 1.0, smelter 2.0,
 * generator 6.0} is exactly the second authority this whole seam exists to
 * avoid.
 *
 * A HAND FURNACE POLLUTES AT THE SMELTER'S RATE, deliberately, and it is the one
 * judgement call in this file. `enemies.h` §11 keys its table by gameplay.h's
 * `EntityDef::typeId`, and a survival `Furnace` is a gameplay-layer type with no
 * row of its own (GP-19 made it deliberately not a factory-sim machine). Giving
 * it zero would mean a base of twenty hand furnaces angers nobody, which is both
 * wrong and the exact shape of an invisible gap; giving it the smelter's row is
 * /core's own number for the same verb.
 */
export function emittersOf(M: OfCoreModule, p: TargetPopulations): EmitterRow[] {
  const E = enemyAbi(M);
  const out: EmitterRow[] = [];
  const rate = new Map<number, number>();
  const rateFor = (typeId: number): number => {
    const have = rate.get(typeId);
    if (have !== undefined) return have;
    const r = E._of_en_machine_rate(typeId);
    rate.set(typeId, r);
    return r;
  };
  const push = (key: string, pos: { x: number; y: number; z: number },
                typeId: number): void => {
    const r = rateFor(typeId);
    // A ZERO-RATE ROW IS NOT REGISTERED. A belt and a pole emit nothing by
    // /core's own table, and an emitter with rate 0 would still occupy an
    // emitter id, still be a candidate `targetEmitter`, and could therefore
    // aim a wave at a length of belt on the far side of the base. Waves must
    // point at the CAUSE.
    if (!(r > 0)) return;
    const l = Math.hypot(pos.x, pos.y, pos.z) || 1;
    out.push({ key, dir: { x: pos.x / l, y: pos.y / l, z: pos.z / l },
      ratePerSec: r });
  };
  for (const f of p.factory.placed) push(factoryHealthKey(f.cell), f.pos, TYPE_ID[f.kind]);
  for (const m of p.machines.list) push(machineHealthKey(m.pos), m.pos, TYPE_ID.smelter);
  return out;
}
