// LOADING A PLAN OFF A SAVE, which is a SEAM and not a lifecycle step.
//
// Split out of Factory.ts when the port migration pushed that file past its
// 400-line cap, along a seam that was already there and is worth naming.
// Everything else in Factory is a transaction a PLAYER runs: place, turn, take,
// demolish, all of them starting from a world that is already coherent. This one
// starts from BYTES, written by a build that may not be this build, and its job
// is to end with a world that is coherent whatever those bytes say. That is a
// different kind of function with a different kind of failure, and FS-46 is the
// proof: the whole port migration hangs off one optional field being absent.

import * as THREE from 'three';
import { orient } from './Grid.js';
import { migrateToPorts, NO_MIGRATION } from './FactoryMigrate.js';
import { NO_RECIPE } from './FactoryRecipes.js';
import type { BuildKind, Factory } from './Factory.js';

/** One building as a save slot holds it. `SaveGame.SaveBuilding` is the same
 *  shape; this is the reader's view of it and deliberately structural, so the
 *  persistence layer can evolve its own type without dragging this along. */
export interface SavedBuilding {
  kind: BuildKind;
  pos: [number, number, number];
  cell: string;
  up: [number, number, number];
  fwd: [number, number, number];
  patch: number;
  /** Generators only. Absent on a slot written before ABI 9, which restores an
   *  empty generator: the honest answer, and the same one a reload has always
   *  given a furnace mid-burn. */
  fuel?: number;
  /** FS-70, chest only: `[ItemId, count]`. See SaveGame.SaveBuilding. */
  store?: [number, number];
  /** FS-46: placed under the PORT model? Absent on every slot written before it,
   *  and that absence is the migration's only hinge. Additive and optional on
   *  purpose; SaveGame.ts argues why the version must not move for it. */
  ports?: boolean;
  /**
   * FS-56, assemblers only: the OUTPUT ITEM of the selected recipe.
   *
   * Optional and additive for exactly the reason `fuel` and `ports` are, and the
   * same hinge argument applies: absent on every slot written before assemblers
   * existed, and absent means `NO_RECIPE`, which restores a placed but unset
   * machine. That is the honest answer for a save that never recorded one, and
   * it is a state the panel already has a sentence for. `SAVE_VERSION` does not
   * move: no existing field changed meaning.
   */
  recipe?: number;
}

/**
 * Rebuild the whole plan from saved records and commit ONCE.
 *
 * One commit, not one per building, because a commit throws the network away and
 * rebuilds it: doing that per record would count N-1 spurious rebuilds and,
 * worse, would wire partial plans on the way. Returns what was restored.
 */
export function restorePlan(f: Factory, rows: readonly SavedBuilding[]): number {
  f.placed.length = 0;
  // CLEARED FIRST, so a load that does NOT migrate cannot report the previous
  // load's repair. `probes/portmigrate.js` caught it on its first green run: its
  // negative control, whose whole point is that the repair did NOT run, read
  // `migration.ran: true` off the load before it. A report field that outlives
  // the thing it describes will be quoted one day and will be a lie.
  f.migration = NO_MIGRATION;
  for (const r of rows) {
    const up = new THREE.Vector3(r.up[0], r.up[1], r.up[2]);
    const fwd = new THREE.Vector3(r.fwd[0], r.fwd[1], r.fwd[2]);
    f.push({
      kind: r.kind, pos: { x: r.pos[0], y: r.pos[1], z: r.pos[2] },
      cell: r.cell, up, fwd, quat: orient(up, fwd),
      patch: r.patch, lastRemaining: 0, build: -1, entity: -1, run: -1,
      grid: -1, fuel: r.fuel ?? 0, recipe: r.recipe ?? NO_RECIPE,
      // FS-70. An absent `store` is an EMPTY chest, which is the only honest
      // reading for a world saved before chests existed. `commit()` below is
      // what puts these back into a real container.
      storeItem: r.store?.[0] ?? 0, storeCount: r.store?.[1] ?? 0,
    });
  }
  f.commit();
  // FS-46. The commit above is what makes `runs` exist, and the repair needs them
  // to know a head from a tail, so it cannot run first. A legacy slot therefore
  // commits TWICE on load. That costs one rebuild and no items: a rebuild loses
  // what is riding the belts, and a slot records the plan, not the cargo.
  if (rows.some((r) => r.ports !== true)) {
    f.migration = migrateToPorts(f);
    if (f.migration.turned > 0) f.commit();
  }
  return f.placed.length;
}
