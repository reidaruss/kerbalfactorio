// The ENEMY half of the /core bridge (ABI 15): enemies.h, §20 of the shim.
//
// It lives in its own file rather than in heap.ts for the reason vesselabi.ts
// and discabi.ts do, and it is not tidiness: heap.ts is at its line cap and this
// surface plus the six scratch layouts it publishes would blow through what is
// left. The wasm module is still ONE object; `enemyAbi(M)` is the single place
// the wider face is named, so there is exactly one cast in the client and every
// caller downstream of it is fully typed.
//
// WHAT THIS IS. Factorio's loop, restated: a factory produces pollution,
// pollution spreads and decays over the surface, nests the cloud reaches absorb
// it and become aggressive in proportion to what they absorbed, absorbed
// pollution raises a global evolution factor that gates which enemy types
// appear, and nests spread so cleared ground does not stay cleared. Every attack
// is CAUSED by the player's own production. A wave timer would satisfy the word
// "enemies" and miss the entire point.
//
// WHERE THE SEAM IS, and it is enemies.h's own line rather than one drawn here:
// /core owns the loop and emits an `AttackWave` with an origin, a target and a
// roster. It does NOT own pathfinding, movement, combat resolution or anything
// rendered. So the client spawns the individual creatures, walks them, draws
// them, shoots them, and reports a dead nest back through `of_en_damage_nest`.
//
// THE CLIENT NEVER AUTHORS AN ENEMY'S NUMBERS. health, damagePerSecond,
// speedMps and reachM come across through `of_en_type` because enemies.h
// annotates them as carried for the combat lane, and a TypeScript table of the
// same five rows would be a second balance authority that a designer editing
// enemies.h could not reach.
//
// Standing rule 5 applies here as everywhere: call the producing export FIRST,
// then take the scratch view through heap.ts's helpers, and copy out before the
// next call into WASM.
import type { OfCoreModule } from './heap.js';

/** Fixed strides of the scratch this ABI writes. These MUST equal the
 *  `kEn*Words` constants in `web/wasm/of_enemies_api.inc`; they are named at
 *  both ends so a change fails to compile rather than failing to run. */
export const EN_WAVE_WORDS = 12;
export const EN_THREAT_WORDS = 10;
export const EN_POLLUTION_WORDS = 12;
export const EN_EVOLUTION_WORDS = 7;
export const EN_TYPE_WORDS = 11;
export const EN_CELL_WORDS = 5;

/** Field offsets inside one `of_en_wave` row. A reader that indexed by a bare
 *  number would be a second definition of the layout waiting to drift. */
export const EnWave = {
  id: 0, sourceNest: 1, targetEmitter: 2, memberCount: 3, totalCount: 4,
  originX: 5, originY: 6, originZ: 7,
  targetX: 8, targetY: 9, targetZ: 10,
  slowestSpeedMps: 11,
} as const;

/** Field offsets inside one `of_en_type` row. `weightNow` is the type's pick
 *  weight at the CURRENT evolution, which is what makes "at 0.20, Ravagers
 *  appear" a number a UI can show rather than a sentence somebody typed. */
export const EnType = {
  id: 0, health: 1, damagePerSecond: 2, speedMps: 3, reachM: 4, budgetCost: 5,
  minEvolution: 6, peakEvolution: 7, fadeEvolution: 8, spawnWeight: 9,
  weightNow: 10,
} as const;

/** Field offsets inside the `of_en_pollution` row. */
export const EnPollution = {
  producedPerSecond: 0, totalInField: 1, absorbedPerSecond: 2,
  absorbedLifetime: 3, activeCells: 4, visibleCells: 5, cellSizeM: 6,
  extentM: 7, centroidX: 8, centroidY: 9, centroidZ: 10, absorbingNests: 11,
} as const;

/** Field offsets inside the `of_en_evolution` row. The three `from*` terms sum
 *  BIT-EXACTLY to `factor` by construction in enemies.h, so a UI showing the
 *  breakdown is showing a decomposition and not an estimate. */
export const EnEvolution = {
  factor: 0, fromTime: 1, fromPollution: 2, fromKills: 3,
  secondsElapsed: 4, pollutionAbsorbed: 5, nestsDestroyed: 6,
} as const;

/** Field offsets inside one `of_en_threats` row. */
export const EnThreat = {
  id: 0, generation: 1, health: 2, maxHealth: 3, absorbedLifetime: 4,
  fractionOfThreshold: 5, wavesDispatched: 6, dirX: 7, dirY: 8, dirZ: 9,
} as const;

/** `of_en_type` ids, matching `enemies.h`'s `types` namespace exactly. Present
 *  so the client can NAME a type; every NUMBER about one still comes across the
 *  bridge. */
export const ENEMY_TYPE = {
  Skitterer: 0x01, Ravager: 0x02, Lancer: 0x03, Sunderer: 0x04, Colossus: 0x05,
} as const;

export interface OfEnemiesModule extends OfCoreModule {
  _of_en_init(bodyHandle: number, seedLo: number, seedHi: number): number;
  _of_en_ready(): number;
  /** DW-28's three. Above zero means a CEILING is deciding the answer rather
   *  than the player, which is the one failure mode a healthy-looking sim can
   *  hide. The client puts them on the HUD. */
  _of_en_tuning_clamped(): number;
  _of_en_nests_refused(): number;
  _of_en_waves_truncated(): number;
  _of_en_cells_clipped(): number;

  _of_en_add_emitter(dx: number, dy: number, dz: number, ratePerSec: number): number;
  _of_en_set_emitter_rate(id: number, ratePerSec: number): number;
  _of_en_set_emitter_active(id: number, active: number): number;
  _of_en_remove_emitter(id: number): number;
  _of_en_emitter_count(): number;
  /** enemies.h §11's own per-machine rate table. The client never types one. */
  _of_en_machine_rate(machineTypeId: number): number;

  _of_en_add_nest(dx: number, dy: number, dz: number, generation: number): number;
  _of_en_nest_count(): number;
  /** Returns 1 if THIS call killed the nest, which is what credits evolution. */
  _of_en_damage_nest(id: number, damage: number): number;
  _of_en_destroy_nest(id: number): number;

  /** `n` SIM ticks at 60 UPS. Returns the tick index AFTER, so a probe can
   *  prove the loop advanced rather than trusting that it ran (DW-20). */
  _of_en_step(n: number): number;

  _of_en_drain_waves(): number;
  _of_en_wave(i: number): number;
  _of_en_wave_member(i: number, k: number): number;

  _of_en_type_count(): number;
  _of_en_type(i: number): number;

  _of_en_pollution(): number;
  _of_en_evolution(): number;
  /** Returns the type id that unlocks next, or 0 when nothing is left; the
   *  evolution it unlocks at lands in f64[0]. */
  _of_en_next_unlock(): number;
  _of_en_threats(maxRows: number): number;
  _of_en_cells(minAmount: number, maxRows: number): number;

  _of_en_serialize(): number;
  _of_en_alloc_bytes(n: number): void;
  _of_en_deserialize(): number;
  _of_en_state_hash_lo(): number;
}

export function enemyAbi(M: OfCoreModule): OfEnemiesModule {
  return M as OfEnemiesModule;
}
