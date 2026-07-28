// =============================================================================
// of_enemies_api.inc: §20 of the bridge: THE POLLUTION / EVOLUTION / NEST LOOP
// (ABI 15, enemies.h).
//
// Included from of_core_api.cpp, after of_map_api.inc.
//
// WHAT CROSSES AND WHAT DOES NOT, and the line is enemies.h's own. That header
// says out loud what it does not own: "pathfinding, movement, combat resolution
// against structures, turrets, weapons, damage models, and anything rendered.
// An AttackWave is emitted with an origin, a target and a roster; a combat lane
// takes it from there and reports back through damageNest()/destroyNest()."
// This shim is exactly that seam and nothing more. It exports the loop
// (emitters in, pollution spreads, nests absorb, evolution rises, waves come
// out) and the two callbacks the combat lane owes back. The client spawns,
// paths, draws and kills the individual creatures, because a creature walking
// across a hillside is not a thing a transcendental-free deterministic surface
// model has any business knowing about.
//
// WHY THE LOOP IS NOT IN TYPESCRIPT. It is a diffusion field with a mass
// conservation claim, a plurality attribution estimate, a three-term evolution
// decomposition that has to sum bit-exactly, and a stable_sort whose stability
// is load-bearing for cross-toolchain identity. All of it is pinned by
// test_enemies.cpp. A TypeScript copy would be a SECOND answer to "why am I
// being attacked", which is the two-authority failure this project has paid for
// six times. Every attack a player sees is CAUSED by their own production and
// the causation is computed in exactly one place.
//
// ONE SIM, NOT A REGISTRY. Every other multi-instance surface here (bodies,
// flights, furnaces) is a Registry because a client legitimately holds several.
// There is one enemy loop per world, the same call shape `of_disc_*` uses for
// the same reason, and a registry would invite a second one whose pollution
// nobody could account for.
//
// SCRATCH DISCIPLINE (standing rule 5) is the house rule: call the producing
// export FIRST, then take the view, then copy out before re-entering WASM.
// =============================================================================
#include "of/enemies.h"

namespace en = of::enemies;

namespace {
std::unique_ptr<en::EnemySim> g_enemies;
// Waves drained out of the sim and not yet read row by row by the client. They
// are held HERE rather than being formatted in one call because a wave carries
// a variable-length roster, and a single flat array with a variable stride is
// the shape that gets mis-indexed. Two calls with fixed strides cannot be.
std::vector<en::AttackWave> g_drained;
en::EnemyTuning g_enTuning;
}  // namespace

// Fixed strides. Named so no caller ever types a magic number and a change here
// fails to COMPILE on the TypeScript side rather than failing to run.
static const int kEnWaveWords = 12;
static const int kEnThreatWords = 10;
static const int kEnPollutionWords = 12;
static const int kEnEvolutionWords = 7;
static const int kEnTypeWords = 11;
static const int kEnCellWords = 5;
// The cell overlay's cap. 4,096 cells at 146 m is a 60 km square of cloud, far
// past anything a HUD or a map draws, and it bounds one mistyped argument from
// asking for a gigabyte. Exhaustion is REPORTED (of_en_cells_clipped), never
// silent: a pollution overlay that quietly stopped at its cap would understate
// the cloud, and understating the cloud is understating the cause.
static const int kEnMaxCells = 4096;
static int g_enCellsClipped = 0;

// -----------------------------------------------------------------------------
// §20.1 Bring the loop up. Idempotent per body; a second call REPLACES it.
//
// The body is passed as a handle rather than as a radius, because enemies.h
// takes BodyParams and its cell lattice is derived from the radius: handing it
// a number would be a second authority on how big the world is, which is
// exactly what DW-18 cost this project sixteen times over on gravity.
// -----------------------------------------------------------------------------
OF_API int of_en_init(int bodyHandle, uint32_t seedLo, uint32_t seedHi) {
  wg::BodyParams* b = g_bodies.get(bodyHandle);
  if (!b) return 0;
  g_enTuning = en::EnemyTuning();
  g_enemies.reset(new en::EnemySim(*b, joinU64(seedLo, seedHi), g_enTuning));
  g_drained.clear();
  g_enCellsClipped = 0;
  return 1;
}

OF_API int of_en_ready(void) { return g_enemies ? 1 : 0; }

// DW-28. Three counters that exist so a ceiling cannot report success.
// `tuning_clamped` means EnemyTuning arrived with a value the model had to
// correct; `nests_refused` means maxNests is binding and a faction is being
// held down by a cap rather than by the player; `waves_truncated` means wave
// size is being set by maxWaveSize rather than by pollution, at which point the
// design's headline proportionality is no longer what a player sees.
OF_API int of_en_tuning_clamped(void) {
  return g_enemies && g_enemies->tuningWasClamped() ? 1 : 0;
}
OF_API int of_en_nests_refused(void) {
  return g_enemies ? static_cast<int>(g_enemies->nestPlacementsRefused()) : 0;
}
OF_API int of_en_waves_truncated(void) {
  return g_enemies ? static_cast<int>(g_enemies->wavesTruncated()) : 0;
}
OF_API int of_en_cells_clipped(void) { return g_enCellsClipped; }

// -----------------------------------------------------------------------------
// §20.2 Emitters. §11 of enemies.h is the contract and this is the call.
//
// A direction, not a position: enemies.h NEVER answers "where is the ground"
// (standing rule 1), so a caller hands it a unit direction from the body centre
// and asks surface_field.h separately if it needs a radius. The shim normalises
// nothing, deliberately, because enemies.h's own `unitOf` already rejects a
// zero or NaN direction and doing it twice would be a second authority on what
// a direction is.
// -----------------------------------------------------------------------------
OF_API int of_en_add_emitter(double dx, double dy, double dz, double ratePerSec) {
  if (!g_enemies) return 0;
  return static_cast<int>(g_enemies->addEmitter(vec(dx, dy, dz), ratePerSec));
}
OF_API int of_en_set_emitter_rate(int id, double ratePerSec) {
  if (!g_enemies) return 0;
  return g_enemies->setEmitterRate(static_cast<en::EmitterId>(id), ratePerSec) ? 1 : 0;
}
OF_API int of_en_set_emitter_active(int id, int active) {
  if (!g_enemies) return 0;
  return g_enemies->setEmitterActive(static_cast<en::EmitterId>(id), active != 0) ? 1 : 0;
}
OF_API int of_en_remove_emitter(int id) {
  if (!g_enemies) return 0;
  return g_enemies->removeEmitter(static_cast<en::EmitterId>(id)) ? 1 : 0;
}
OF_API int of_en_emitter_count(void) {
  return g_enemies ? static_cast<int>(g_enemies->emitters().size()) : 0;
}
// The pollution rate enemies.h publishes for a machine type id (§11's table).
// Exported so the CLIENT never authors a rate: a smelter's 2.0 is /core's
// number, and a second copy in TypeScript is how a rebalance reaches the sim
// and not the HUD.
OF_API double of_en_machine_rate(int machineTypeId) {
  return en::pollutionRateForMachine(static_cast<uint16_t>(machineTypeId));
}

// -----------------------------------------------------------------------------
// §20.3 Nests.
// -----------------------------------------------------------------------------
OF_API int of_en_add_nest(double dx, double dy, double dz, int generation) {
  if (!g_enemies) return 0;
  return static_cast<int>(g_enemies->addNest(
      vec(dx, dy, dz), generation < 0 ? 0u : static_cast<uint32_t>(generation)));
}
OF_API int of_en_nest_count(void) {
  return g_enemies ? static_cast<int>(g_enemies->aliveNestCount()) : 0;
}
// The combat lane reporting back, which is the other half of §8's handoff.
// Returns 1 if THIS call killed the nest, which is what credits evolution.
OF_API int of_en_damage_nest(int id, double damage) {
  if (!g_enemies) return 0;
  return g_enemies->damageNest(static_cast<en::NestId>(id), damage) ? 1 : 0;
}
OF_API int of_en_destroy_nest(int id) {
  if (!g_enemies) return 0;
  return g_enemies->destroyNest(static_cast<en::NestId>(id)) ? 1 : 0;
}

// -----------------------------------------------------------------------------
// §20.4 The tick. `n` SIM ticks at the 60 UPS SimClock, exactly as step()
// defines them; the expensive work runs once per pollutionTickInterval inside.
// Returns the sim's tick index afterwards, so a caller can PROVE it advanced
// (DW-20) rather than trusting that the loop ran.
// -----------------------------------------------------------------------------
OF_API int of_en_step(int n) {
  if (!g_enemies) return 0;
  if (n > 0) g_enemies->step(static_cast<uint64_t>(n));
  return static_cast<int>(g_enemies->tickIndex());
}

// -----------------------------------------------------------------------------
// §20.5 Waves out. Drain, then read row by row.
//
// `of_en_drain_waves` MOVES the pending waves out of the sim into this shim and
// returns how many. `of_en_wave(i)` writes one fixed-stride header and
// `of_en_wave_member(i, k)` writes one roster pair. A drained wave stays
// readable until the next drain, so a client can take the count, loop, and copy
// out at its own pace without a re-entrancy rule to remember.
// -----------------------------------------------------------------------------
OF_API int of_en_drain_waves(void) {
  if (!g_enemies) return 0;
  g_drained = g_enemies->drainWaves();
  return static_cast<int>(g_drained.size());
}

// f64 scratch, kEnWaveWords doubles:
//   0 id, 1 sourceNest, 2 targetEmitter, 3 memberCount, 4 totalCount,
//   5..7 originDir xyz, 8..10 targetDir xyz, 11 slowestSpeedMps
// The two directions are UNIT DIRECTIONS from the body centre, not positions.
OF_API int of_en_wave(int i) {
  resetF64(kEnWaveWords);
  if (i < 0 || static_cast<size_t>(i) >= g_drained.size()) return 0;
  const en::AttackWave& w = g_drained[static_cast<size_t>(i)];
  g_f64.push_back(static_cast<double>(w.id));
  g_f64.push_back(static_cast<double>(w.sourceNest));
  g_f64.push_back(static_cast<double>(w.targetEmitter));
  g_f64.push_back(static_cast<double>(w.members.size()));
  g_f64.push_back(static_cast<double>(w.totalCount));
  g_f64.push_back(w.originDir.x); g_f64.push_back(w.originDir.y); g_f64.push_back(w.originDir.z);
  g_f64.push_back(w.targetDir.x); g_f64.push_back(w.targetDir.y); g_f64.push_back(w.targetDir.z);
  g_f64.push_back(w.slowestSpeedMps);
  return kEnWaveWords;
}

// f64 scratch, 2 doubles: typeId, count.
OF_API int of_en_wave_member(int i, int k) {
  resetF64(2);
  if (i < 0 || static_cast<size_t>(i) >= g_drained.size()) return 0;
  const en::AttackWave& w = g_drained[static_cast<size_t>(i)];
  if (k < 0 || static_cast<size_t>(k) >= w.members.size()) return 0;
  g_f64.push_back(static_cast<double>(w.members[static_cast<size_t>(k)].typeId));
  g_f64.push_back(static_cast<double>(w.members[static_cast<size_t>(k)].count));
  return 2;
}

// -----------------------------------------------------------------------------
// §20.6 The catalogue. THE CLIENT NEVER AUTHORS AN ENEMY'S NUMBERS.
//
// health, damagePerSecond, speedMps and reachM are annotated in enemies.h as
// "carried for the COMBAT lane", and this is the lane collecting them. A
// TypeScript table of the same five rows would be a second balance authority
// that a designer editing enemies.h could not reach.
//
// f64 scratch, kEnTypeWords doubles:
//   0 id, 1 health, 2 damagePerSecond, 3 speedMps, 4 reachM, 5 budgetCost,
//   6 minEvolution, 7 peakEvolution, 8 fadeEvolution, 9 spawnWeight,
//   10 weightAtCurrentEvolution
// -----------------------------------------------------------------------------
OF_API int of_en_type_count(void) {
  return g_enemies ? static_cast<int>(g_enemies->catalogue().types().size())
                   : static_cast<int>(en::EnemyCatalogue().types().size());
}

OF_API int of_en_type(int i) {
  resetF64(kEnTypeWords);
  static const en::EnemyCatalogue kFallback;
  const en::EnemyCatalogue& c = g_enemies ? g_enemies->catalogue() : kFallback;
  if (i < 0 || static_cast<size_t>(i) >= c.types().size()) return 0;
  const en::EnemyTypeDef& d = c.types()[static_cast<size_t>(i)];
  const double evo = g_enemies ? g_enemies->evolution().factor : 0.0;
  g_f64.push_back(static_cast<double>(d.id));
  g_f64.push_back(d.health);
  g_f64.push_back(d.damagePerSecond);
  g_f64.push_back(d.speedMps);
  g_f64.push_back(d.reachM);
  g_f64.push_back(d.budgetCost);
  g_f64.push_back(d.minEvolution);
  g_f64.push_back(d.peakEvolution);
  g_f64.push_back(d.fadeEvolution);
  g_f64.push_back(d.spawnWeight);
  g_f64.push_back(en::weightAtEvolution(d, evo));
  return kEnTypeWords;
}

// -----------------------------------------------------------------------------
// §20.7 The reports, which are what make the loop LEGIBLE.
//
// enemies.h §9 exists because "an opaque difficulty curve is the failure mode
// here". Everything a player needs to answer "why am I being attacked and what
// would reduce it" is published there and crosses here unchanged. Publishing
// the three evolution TERMS separately rather than only the factor is the whole
// point: the UI can say WHY the number moved, and the three sum bit-exactly to
// the factor by construction, so the breakdown is a decomposition and not an
// estimate.
// -----------------------------------------------------------------------------

// f64 scratch, kEnPollutionWords doubles:
//   0 producedPerSecond, 1 totalInField, 2 absorbedPerSecond, 3 absorbedLifetime,
//   4 activeCells, 5 visibleCells, 6 cellSizeM, 7 extentM,
//   8..10 centroidDir xyz, 11 absorbingNests
OF_API int of_en_pollution(void) {
  resetF64(kEnPollutionWords);
  if (!g_enemies) return 0;
  const en::PollutionReport r = g_enemies->pollutionReport();
  g_f64.push_back(r.producedPerSecond);
  g_f64.push_back(r.totalInField);
  g_f64.push_back(r.absorbedPerSecond);
  g_f64.push_back(r.absorbedLifetime);
  g_f64.push_back(static_cast<double>(r.activeCells));
  g_f64.push_back(static_cast<double>(r.visibleCells));
  g_f64.push_back(r.cellSizeM);
  g_f64.push_back(r.extentM);
  g_f64.push_back(r.centroidDir.x); g_f64.push_back(r.centroidDir.y); g_f64.push_back(r.centroidDir.z);
  g_f64.push_back(static_cast<double>(r.absorbingNests));
  return kEnPollutionWords;
}

// f64 scratch, kEnEvolutionWords doubles:
//   0 factor, 1 fromTime, 2 fromPollution, 3 fromKills,
//   4 secondsElapsed, 5 pollutionAbsorbed, 6 nestsDestroyed
OF_API int of_en_evolution(void) {
  resetF64(kEnEvolutionWords);
  if (!g_enemies) return 0;
  const en::EvolutionState& e = g_enemies->evolution();
  g_f64.push_back(e.factor);
  g_f64.push_back(e.fromTime);
  g_f64.push_back(e.fromPollution);
  g_f64.push_back(e.fromKills);
  g_f64.push_back(e.secondsElapsed);
  g_f64.push_back(e.pollutionAbsorbed);
  g_f64.push_back(static_cast<double>(e.nestsDestroyed));
  return kEnEvolutionWords;
}

// The type that unlocks NEXT, which is what a UI shows as "at 0.20, Ravagers
// appear". Returns the type id, or 0 when everything is unlocked; the
// evolution it unlocks at goes into f64[0].
OF_API int of_en_next_unlock(void) {
  resetF64(1);
  if (!g_enemies) return 0;
  en::EnemyTypeId id = en::kNoEnemyType;
  double at = 0.0;
  if (!g_enemies->nextUnlock(id, at)) return 0;
  g_f64.push_back(at);
  return static_cast<int>(id);
}

// Threats, sorted most-imminent-first by enemies.h's own comparator. Returns the
// COUNT written; the f64 scratch holds count * kEnThreatWords:
//   0 id, 1 generation, 2 health, 3 maxHealth, 4 absorbedLifetime,
//   5 fractionOfAttackThreshold, 6 wavesDispatched, 7..9 dir xyz
OF_API int of_en_threats(int maxRows) {
  resetF64(0);
  if (!g_enemies) return 0;
  const std::vector<en::NestThreat> t = g_enemies->threatReport();
  const int n = maxRows > 0 && static_cast<size_t>(maxRows) < t.size()
                    ? maxRows : static_cast<int>(t.size());
  resetF64(static_cast<size_t>(n) * kEnThreatWords);
  for (int i = 0; i < n; ++i) {
    const en::NestThreat& r = t[static_cast<size_t>(i)];
    g_f64.push_back(static_cast<double>(r.id));
    g_f64.push_back(static_cast<double>(r.generation));
    g_f64.push_back(r.health);
    g_f64.push_back(r.maxHealth);
    g_f64.push_back(r.absorbedLifetime);
    g_f64.push_back(r.fractionOfAttackThreshold);
    g_f64.push_back(static_cast<double>(r.wavesDispatched));
    g_f64.push_back(r.dir.x); g_f64.push_back(r.dir.y); g_f64.push_back(r.dir.z);
  }
  return n;
}

// The CLOUD itself, for an overlay. Returns the count written; the f64 scratch
// holds count * kEnCellWords: 0..2 the cell centre DIRECTION xyz, 3 amount,
// 4 the emitter this cell is mostly attributable to.
//
// Only cells at or above `minAmount` are written, so a caller asking for the
// drawable cloud does not pay for the pruned tail. Clipping at the cap is
// COUNTED into of_en_cells_clipped rather than being silent.
OF_API int of_en_cells(double minAmount, int maxRows) {
  resetF64(0);
  if (!g_enemies) return 0;
  const int cap = maxRows > 0 && maxRows < kEnMaxCells ? maxRows : kEnMaxCells;
  const en::PollutionField& f = g_enemies->field();
  int n = 0;
  resetF64(static_cast<size_t>(cap) * kEnCellWords);
  for (const en::PollutionCellView& c : f.cells()) {
    if (c.amount < minAmount) continue;
    if (n >= cap) { ++g_enCellsClipped; break; }
    const Vec3 d = f.cellCentreDir(c.key);
    g_f64.push_back(d.x); g_f64.push_back(d.y); g_f64.push_back(d.z);
    g_f64.push_back(c.amount);
    g_f64.push_back(static_cast<double>(c.source));
    ++n;
  }
  return n;
}

// -----------------------------------------------------------------------------
// §20.8 Persistence and determinism.
//
// DW-17 puts the whole world in ONE atomic save, and a world that forgets its
// evolution factor on reload is broken. enemies.h §10 serialises everything
// step() reads, including the id counters, and it is templated over the
// persistence.h cursors, so the bytes a browser writes are byte-for-byte the
// ones the native suites read. Same u8 arena as the inventory, the tunnels and
// the discovery stream, so a save routine does one of them at a time.
// -----------------------------------------------------------------------------
OF_API int of_en_serialize(void) {
  g_u8.clear();
  if (!g_enemies) return -1;
  of::persist::SaveWriter w;
  g_enemies->serialize(w);
  g_u8 = w.bytes();
  return static_cast<int>(g_u8.size());
}
OF_API void of_en_alloc_bytes(int n) { g_u8.assign(n > 0 ? n : 0, 0); }
// Returns the alive nest count restored, or -1 on refusal. An EMPTY arena is
// refused before anything is read: the reader throws past the end and this
// module is built with exceptions off, so a zero-byte stream would take the
// whole instance down rather than return. That is the same guard
// of_disc_deserialize needed and for the same reason.
OF_API int of_en_deserialize(void) {
  if (g_u8.empty()) return -1;
  if (!g_enemies) return -1;
  of::persist::SaveReader r(g_u8.data(), g_u8.size());
  g_enemies->deserialize(r);
  g_drained.clear();
  return static_cast<int>(g_enemies->aliveNestCount());
}
OF_API uint32_t of_en_state_hash_lo(void) {
  return splitLo(g_enemies ? g_enemies->stateHash() : 0ull);
}
