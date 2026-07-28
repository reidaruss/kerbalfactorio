// THE CAUSE. This file drives `/core`'s pollution / evolution / nest loop and
// reads its answers back. It spawns nothing, draws nothing and hurts nobody.
//
// GP-87. THE SEAM IS enemies.h's OWN LINE, not one drawn here. That header says
// what it does not own: "pathfinding, movement, combat resolution against
// structures, turrets, weapons, damage models, and anything rendered. An
// AttackWave is emitted with an origin, a target and a roster; a combat lane
// takes it from there." So `/core` owns WHY an attack happens and this file is
// the two-way pipe; `EnemySwarm` owns what the creatures then do.
//
// GP-88. EMITTERS ARE DERIVED FROM THE LIVE BUILDING POPULATION, NEVER
// REGISTERED AT A SPAWN SITE. `enemies.h` §11 offers the registration shape (mint
// an emitter on build, deactivate on idle, remove on demolish) and that shape is
// declined for the reason `HealthCensus.ts` gives at length and this project has
// now paid for twice: the seventh place that places a building is written next
// month, it does not have the call, the building pollutes nothing, and NOTHING
// ANYWHERE SAYS SO. A base that silently stopped angering anything is
// indistinguishable from a base nobody is angry at. `sync` reads the four
// populations every pollution window and makes /core agree with them, so a new
// buildable is covered the moment its kind has a TYPE_ID, and `of_en_emitter_count`
// is asserted equal to the derived row count so a drift is a LOUD condition.
//
// GP-87 (second half). NESTS ARE SEEDED BY THE CLIENT, from the world seed,
// and that is a gap being paid for openly rather than a design. `enemies.h`
// expects nests "seeded at worldgen" (generation 0) and world-gen has no nest
// pass, so somebody has to place the first ones. Doing it here keeps the
// placement deterministic from the seed and reproducible, and the day world-gen
// grows a POI pass this call is deleted and `of_en_add_nest` is made from there
// instead. What is NOT done here is choosing when they attack: that is the whole
// point of the loop and it stays in /core.

import { enemyAbi, EnEvolution, EnPollution, EnThreat, EnWave, EN_EVOLUTION_WORDS,
  EN_POLLUTION_WORDS, EN_THREAT_WORDS, EN_WAVE_WORDS } from '../sim/wasm/enemyabi.js';
import { scratchF64, type OfCoreModule } from '../sim/wasm/heap.js';

export interface Vec3 { x: number; y: number; z: number }

/** One thing of the player's that pollutes. `key` is stable for its lifetime. */
export interface EmitterRow {
  key: string;
  /** UNIT DIRECTION from the body centre. enemies.h never takes a position. */
  dir: Vec3;
  ratePerSec: number;
}

/** One nest as /core reports it, copied out of `of_en_threats`. */
export interface NestRow {
  id: number;
  generation: number;
  dir: Vec3;
  health: number;
  maxHealth: number;
  absorbedLifetime: number;
  fractionOfThreshold: number;
  wavesDispatched: number;
}

/** One wave, copied out of `of_en_wave` plus its roster. */
export interface WaveRow {
  id: number;
  sourceNest: number;
  targetEmitter: number;
  originDir: Vec3;
  targetDir: Vec3;
  totalCount: number;
  slowestSpeedMps: number;
  members: { typeId: number; count: number }[];
}

/** Sim ticks between emitter syncs and nest re-reads. 60 = enemies.h's own
 *  `pollutionTickInterval`, so nothing is refreshed more often than the model
 *  can act on it. */
export const SYNC_TICKS = 60;

/** Where the first nests are put, and how many. Balance, authored as data. The
 *  ring is inside the 1,135 m e-folding radius of the cloud on Forge (enemies.h
 *  §3 derives it), so a base that pollutes hard reaches them and one that does
 *  not never will, which is the whole causal chain in one constant. */
export const NEST_RING = {
  count: 4,
  minM: 620,
  maxM: 1150,
} as const;

/** 32-bit integer hash, for the nest ring only. Deliberately NOT used for any
 *  physical quantity: /core owns every number that matters and this decides
 *  bearings. */
function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
function unit01(a: number, b: number): number { return hash32(a, b) / 4294967296; }

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** A tangent basis at a surface direction. Any pair will do; this one is stable
 *  everywhere because the seed axis is chosen away from `d`. */
export function tangentAt(d: Vec3): { east: Vec3; north: Vec3 } {
  const a = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = norm({ x: a.y * d.z - a.z * d.y, y: a.z * d.x - a.x * d.z,
    z: a.x * d.y - a.y * d.x });
  const north = { x: d.y * east.z - d.z * east.y, y: d.z * east.x - d.x * east.z,
    z: d.x * east.y - d.y * east.x };
  return { east, north: norm(north) };
}

/** Walk `distM` from `d` along `bearingRad`, on a sphere of `radiusM`. */
export function offsetDir(d: Vec3, bearingRad: number, distM: number,
                          radiusM: number): Vec3 {
  const t = distM / radiusM;
  const { east, north } = tangentAt(d);
  const bx = east.x * Math.cos(bearingRad) + north.x * Math.sin(bearingRad);
  const by = east.y * Math.cos(bearingRad) + north.y * Math.sin(bearingRad);
  const bz = east.z * Math.cos(bearingRad) + north.z * Math.sin(bearingRad);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return norm({ x: d.x * c + bx * s, y: d.y * c + by * s, z: d.z * c + bz * s });
}

export class EnemyLoop {
  /** True once `of_en_init` has taken. Everything below is inert while false. */
  ready = false;
  /** Emitter ids by the key of the thing that owns them. */
  private readonly emitters = new Map<string, number>();
  private readonly rates = new Map<string, number>();
  nests: NestRow[] = [];
  nestsSeeded = 0;
  /** Waves /core has dispatched over this world's life. */
  wavesDispatched = 0;
  /** DW-28: rows the sync wanted and /core refused. Must be 0. */
  emitterRefusals = 0;

  constructor(private readonly M: OfCoreModule,
              private readonly bodyRadiusM: number) {}

  init(bodyHandle: number, seed: number): boolean {
    const E = enemyAbi(this.M);
    const lo = seed >>> 0;
    const hi = Math.floor(Math.abs(seed) / 4294967296) >>> 0;
    this.ready = E._of_en_init(bodyHandle, lo, hi) === 1 && E._of_en_ready() === 1;
    this.emitters.clear();
    this.rates.clear();
    return this.ready;
  }

  /**
   * Put the generation-0 nests on the ring. Deterministic from the seed.
   *
   * REFUSALS ARE COUNTED, not swallowed: `of_en_add_nest` returns 0 when the
   * maxNests ceiling is binding, and a ring that quietly placed three of four
   * nests would look exactly like a world that is simply quiet.
   */
  seedNests(spawnDir: Vec3, seed: number): number {
    if (!this.ready) return 0;
    const E = enemyAbi(this.M);
    const d = norm(spawnDir);
    let made = 0;
    for (let i = 0; i < NEST_RING.count; i++) {
      const bearing = ((i + unit01(seed, i * 2 + 1) * 0.7) / NEST_RING.count)
        * Math.PI * 2;
      const distM = NEST_RING.minM
        + (NEST_RING.maxM - NEST_RING.minM) * unit01(seed, i * 2 + 2);
      const n = offsetDir(d, bearing, distM, this.bodyRadiusM);
      if (E._of_en_add_nest(n.x, n.y, n.z, 0) !== 0) made++;
    }
    this.nestsSeeded = made;
    this.readNests();
    return made;
  }

  /**
   * Make /core's emitter set equal `rows`. Adds, removes and re-rates in place.
   *
   * IN PLACE rather than clear-and-refill, and that is load bearing rather than
   * an optimisation: a nest carries at most `kMaxNestSources` SourceCredits and
   * a wave is dispatched at the emitter that actually fed it, so re-minting every
   * emitter id once a second would leave every nest angry at ids that no longer
   * exist and every wave aimed at nothing.
   */
  sync(rows: readonly EmitterRow[]): void {
    if (!this.ready) return;
    const E = enemyAbi(this.M);
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.key);
      const have = this.emitters.get(r.key);
      if (have === undefined) {
        const id = E._of_en_add_emitter(r.dir.x, r.dir.y, r.dir.z, r.ratePerSec);
        if (id === 0) { this.emitterRefusals++; continue; }
        this.emitters.set(r.key, id);
        this.rates.set(r.key, r.ratePerSec);
        continue;
      }
      if (this.rates.get(r.key) !== r.ratePerSec) {
        E._of_en_set_emitter_rate(have, r.ratePerSec);
        this.rates.set(r.key, r.ratePerSec);
      }
    }
    for (const [key, id] of [...this.emitters]) {
      if (seen.has(key)) continue;
      E._of_en_remove_emitter(id);
      this.emitters.delete(key);
      this.rates.delete(key);
    }
  }

  /** Emitters this file believes it has registered, against what /core holds.
   *  The two must be equal; see the header. */
  emitterAudit(): { derived: number; inCore: number } {
    return { derived: this.emitters.size,
      inCore: this.ready ? enemyAbi(this.M)._of_en_emitter_count() : 0 };
  }

  /**
   * ONE sim tick of the cause. Returns whatever waves /core dispatched on this
   * tick, which is none on almost all of them.
   *
   * The periodic `sync`/`readNests` is deliberately NOT folded in here: the
   * caller owns that cadence because it is the caller that derives the emitter
   * rows, and two counters ticking the same period in two files is how they end
   * up one tick out of phase and nobody can say which list /core is running on.
   */
  step(): WaveRow[] {
    if (!this.ready) return [];
    enemyAbi(this.M)._of_en_step(1);
    return this.drain();
  }

  /**
   * `n` sim ticks of the CAUSE in one call, then one drain.
   *
   * This is the same `of_en_step` the tick makes, with the loop's own tick
   * counter advancing exactly as it would have. It exists because pollution has
   * to cross a kilometre and a nest has to eat 500 units of it before anything
   * happens, so a driven proof of the causal chain would otherwise need ten
   * minutes of wall clock per run. Waves accumulate inside /core between drains,
   * so nothing is lost by draining once at the end.
   *
   * IT COMPRESSES TIME, IT DOES NOT MANUFACTURE A WAVE. Every unit of pollution
   * still has to be produced by a machine the player placed and still has to
   * reach a nest; a world with no emitters advances this way for ever and
   * dispatches nothing, which is exactly the negative control.
   */
  stepMany(n: number): WaveRow[] {
    if (!this.ready || !(n > 0)) return [];
    enemyAbi(this.M)._of_en_step(Math.floor(n));
    return this.drain();
  }

  /** Waves out of /core and into JS, copied. Empty on almost every tick. */
  private drain(): WaveRow[] {
    const E = enemyAbi(this.M);
    const n = E._of_en_drain_waves();
    if (n <= 0) return [];
    const out: WaveRow[] = [];
    for (let i = 0; i < n; i++) {
      if (E._of_en_wave(i) !== EN_WAVE_WORDS) continue;
      const f = scratchF64(this.M, EN_WAVE_WORDS);
      const w: WaveRow = {
        id: f[EnWave.id], sourceNest: f[EnWave.sourceNest],
        targetEmitter: f[EnWave.targetEmitter],
        originDir: { x: f[EnWave.originX], y: f[EnWave.originY], z: f[EnWave.originZ] },
        targetDir: { x: f[EnWave.targetX], y: f[EnWave.targetY], z: f[EnWave.targetZ] },
        totalCount: f[EnWave.totalCount],
        slowestSpeedMps: f[EnWave.slowestSpeedMps],
        members: [],
      };
      const mc = f[EnWave.memberCount];
      for (let k = 0; k < mc; k++) {
        if (E._of_en_wave_member(i, k) !== 2) continue;
        const g = scratchF64(this.M, 2);
        w.members.push({ typeId: g[0], count: g[1] });
      }
      out.push(w);
      this.wavesDispatched++;
    }
    return out;
  }

  /** The nests, re-read rather than remembered, so an EXPANDED nest (a child
   *  /core grew on its own) is drawn and shootable with no event to subscribe
   *  to and nothing to forget. */
  readNests(): NestRow[] {
    if (!this.ready) return this.nests;
    const E = enemyAbi(this.M);
    const n = E._of_en_threats(256);
    const f = n > 0 ? scratchF64(this.M, n * EN_THREAT_WORDS) : null;
    const out: NestRow[] = [];
    for (let i = 0; i < n && f !== null; i++) {
      const o = i * EN_THREAT_WORDS;
      out.push({
        id: f[o + EnThreat.id], generation: f[o + EnThreat.generation],
        dir: { x: f[o + EnThreat.dirX], y: f[o + EnThreat.dirY], z: f[o + EnThreat.dirZ] },
        health: f[o + EnThreat.health], maxHealth: f[o + EnThreat.maxHealth],
        absorbedLifetime: f[o + EnThreat.absorbedLifetime],
        fractionOfThreshold: f[o + EnThreat.fractionOfThreshold],
        wavesDispatched: f[o + EnThreat.wavesDispatched],
      });
    }
    this.nests = out;
    return out;
  }

  /** The combat lane reporting back (enemies.h §8's other half). Returns true
   *  when THIS call killed the nest, which is what credits evolution. */
  damageNest(id: number, amount: number): boolean {
    if (!this.ready) return false;
    const dead = enemyAbi(this.M)._of_en_damage_nest(id, amount) === 1;
    this.readNests();
    return dead;
  }

  pollution(): Record<string, number> {
    if (!this.ready || enemyAbi(this.M)._of_en_pollution() !== EN_POLLUTION_WORDS) {
      return {};
    }
    const f = scratchF64(this.M, EN_POLLUTION_WORDS);
    return {
      producedPerSecond: f[EnPollution.producedPerSecond],
      totalInField: f[EnPollution.totalInField],
      absorbedPerSecond: f[EnPollution.absorbedPerSecond],
      absorbedLifetime: f[EnPollution.absorbedLifetime],
      activeCells: f[EnPollution.activeCells],
      cellSizeM: f[EnPollution.cellSizeM],
      extentM: f[EnPollution.extentM],
      absorbingNests: f[EnPollution.absorbingNests],
    };
  }

  evolution(): Record<string, number> {
    if (!this.ready || enemyAbi(this.M)._of_en_evolution() !== EN_EVOLUTION_WORDS) {
      return {};
    }
    const f = scratchF64(this.M, EN_EVOLUTION_WORDS);
    return {
      factor: f[EnEvolution.factor], fromTime: f[EnEvolution.fromTime],
      fromPollution: f[EnEvolution.fromPollution], fromKills: f[EnEvolution.fromKills],
      secondsElapsed: f[EnEvolution.secondsElapsed],
      pollutionAbsorbed: f[EnEvolution.pollutionAbsorbed],
      nestsDestroyed: f[EnEvolution.nestsDestroyed],
    };
  }

  /** DW-28's three, straight off the bridge. Above zero means a CEILING is
   *  deciding the answer rather than the player. */
  ceilings(): { tuningClamped: boolean; nestsRefused: number;
                wavesTruncated: number; cellsClipped: number } {
    const E = enemyAbi(this.M);
    return {
      tuningClamped: this.ready && E._of_en_tuning_clamped() === 1,
      nestsRefused: this.ready ? E._of_en_nests_refused() : 0,
      wavesTruncated: this.ready ? E._of_en_waves_truncated() : 0,
      cellsClipped: this.ready ? E._of_en_cells_clipped() : 0,
    };
  }
}
