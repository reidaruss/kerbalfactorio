// THE ENEMY CATALOGUE, READ ACROSS THE BRIDGE, NEVER AUTHORED HERE.
//
// `enemies.h` §2 annotates health / damagePerSecond / speedMps / reachM as
// "carried for the COMBAT lane". This is the combat lane collecting them, and
// the collection is a READ rather than a copy on purpose: a TypeScript table of
// the same five rows would be a second balance authority that a designer editing
// enemies.h could not reach, which is the two-authority failure this project has
// paid for six times.
//
// THE ONE THING THAT IS AUTHORED HERE IS THE LABEL AND THE PAINT. `of_en_type`
// carries no name string and no colour, because a name is a LOCALISABLE LABEL
// and a colour is a rendering choice, neither of which belongs in a
// transcendental-free deterministic sim. So NAMES and TINTS are keyed by the ids
// `enemyabi.ts` already publishes, and `unknownTypes` counts any id the bridge
// hands over that this file has no label for, because a creature drawn in
// default grey with the name "type 6" is a LOUD condition and a silent fallback
// is how a new roster row ships invisible.

import { enemyAbi, EnType, ENEMY_TYPE, EN_TYPE_WORDS } from '../sim/wasm/enemyabi.js';
import { scratchF64, type OfCoreModule } from '../sim/wasm/heap.js';

/** One row of `of_en_type`, copied out. Every number is /core's. */
export interface EnemyType {
  id: number;
  /** Authored here: a label, not balance. See the header. */
  name: string;
  /** Authored here: paint, not balance. */
  tint: number;
  /** Body radius in metres, for the bounding sphere a shot tests and for the
   *  size it is drawn at. Derived from `reachM` rather than authored as a second
   *  number: a creature whose bite lands at 1.5 m and whose body is 3 m across
   *  would bite from inside itself. */
  radiusM: number;
  health: number;
  damagePerSecond: number;
  speedMps: number;
  reachM: number;
  budgetCost: number;
  minEvolution: number;
  peakEvolution: number;
  fadeEvolution: number;
  spawnWeight: number;
  /** Pick weight at the evolution the sim was at when this was read. */
  weightNow: number;
}

/** Labels, by the ids `enemyabi.ts` publishes from `enemies.h`'s own namespace. */
const NAMES: Record<number, string> = {
  [ENEMY_TYPE.Skitterer]: 'Skitterer',
  [ENEMY_TYPE.Ravager]: 'Ravager',
  [ENEMY_TYPE.Lancer]: 'Lancer',
  [ENEMY_TYPE.Sunderer]: 'Sunderer',
  [ENEMY_TYPE.Colossus]: 'Colossus',
};

/** Paint. Warm for melee, cold for the ranged Lancer, so a player can tell at a
 *  glance which one outranges them. */
const TINTS: Record<number, number> = {
  [ENEMY_TYPE.Skitterer]: 0x7e6a3d,
  [ENEMY_TYPE.Ravager]: 0x8f4326,
  [ENEMY_TYPE.Lancer]: 0x2f6f86,
  [ENEMY_TYPE.Sunderer]: 0x5a3550,
  [ENEMY_TYPE.Colossus]: 0x2a2a30,
};

/** What an unlabelled row is drawn as. Deliberately obvious rather than
 *  plausible: an unnamed creature must LOOK wrong on screen, not blend in. */
export const UNKNOWN_TINT = 0xff00ff;

/**
 * Body radius from the engagement reach.
 *
 * A ranged type (`reachM` over 2 m, which is enemies.h's own stated threshold:
 * "> 2 m reads as ranged") must NOT become a barn door to shoot at, so the reach
 * is only allowed to set the body size for melee. Beyond that the body is
 * pinned. Half of the melee reach is the largest body that still lets the bite
 * land outside the creature.
 */
export function bodyRadiusM(reachM: number): number {
  const melee = reachM <= 2.6 ? reachM * 0.5 : 1.05;
  return Math.max(0.45, Math.min(2.2, melee));
}

/** The minimal shape a garrison composition needs off the catalogue: which
 *  rows exist and a lookup by id. Split out so EnemyGarrison.ts's headless
 *  check can hand it a plain fixture rather than a class only fillable from a
 *  WASM bridge (`load` needs a live `OfCoreModule`). */
export interface EnemyCatalogue {
  readonly all: readonly EnemyType[];
  byId(id: number): EnemyType | null;
}

export class EnemyTypes implements EnemyCatalogue {
  private rows: EnemyType[] = [];
  /** Ids the bridge published that this file has no label for. Must be 0. */
  unknownTypes = 0;

  /**
   * (Re)read the whole catalogue. Cheap, and called again whenever evolution has
   * moved, because `weightNow` is a function of it.
   *
   * Standing rule 5: the producing call FIRST, then the view, then copy out
   * before re-entering WASM. `of_en_type(i)` is a producing call, so the view is
   * taken and drained inside each iteration and never held across the loop.
   */
  load(M: OfCoreModule): EnemyType[] {
    const E = enemyAbi(M);
    const n = E._of_en_type_count();
    const out: EnemyType[] = [];
    let unknown = 0;
    for (let i = 0; i < n; i++) {
      if (E._of_en_type(i) !== EN_TYPE_WORDS) continue;
      const f = scratchF64(M, EN_TYPE_WORDS);
      const id = f[EnType.id];
      const name = NAMES[id];
      if (name === undefined) unknown++;
      out.push({
        id,
        name: name ?? `type ${id}`,
        tint: TINTS[id] ?? UNKNOWN_TINT,
        radiusM: bodyRadiusM(f[EnType.reachM]),
        health: f[EnType.health],
        damagePerSecond: f[EnType.damagePerSecond],
        speedMps: f[EnType.speedMps],
        reachM: f[EnType.reachM],
        budgetCost: f[EnType.budgetCost],
        minEvolution: f[EnType.minEvolution],
        peakEvolution: f[EnType.peakEvolution],
        fadeEvolution: f[EnType.fadeEvolution],
        spawnWeight: f[EnType.spawnWeight],
        weightNow: f[EnType.weightNow],
      });
    }
    this.rows = out;
    this.unknownTypes = unknown;
    return out;
  }

  get all(): readonly EnemyType[] { return this.rows; }

  /**
   * One row by id, or null.
   *
   * NULL RATHER THAN A DEFAULT ROW, deliberately. A missing type must make the
   * spawn refuse and be counted (`EnemySwarm.spawnsRefused`), because a
   * substituted default would field a wave of the wrong creature at the wrong
   * health and every counter downstream would read healthy.
   */
  byId(id: number): EnemyType | null {
    for (const r of this.rows) if (r.id === id) return r;
    return null;
  }

  report(): unknown {
    return {
      count: this.rows.length,
      unknownTypes: this.unknownTypes,
      rows: this.rows.map((r) => ({
        id: r.id, name: r.name, health: r.health, dps: r.damagePerSecond,
        speedMps: r.speedMps, reachM: r.reachM, radiusM: +r.radiusM.toFixed(3),
        budgetCost: r.budgetCost, minEvolution: r.minEvolution,
        weightNow: +r.weightNow.toFixed(6),
      })),
    };
  }
}
