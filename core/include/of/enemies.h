#pragma once
// =============================================================================
// enemies.h — the pollution / evolution / nest-attack feedback loop (W11 lane E).
//
// THE THING BEING BUILT IS A LOOP, NOT A MONSTER LIST. The design brief is
// Factorio's, restated: a factory produces pollution, pollution SPREADS and
// DECAYS over the surface, nests that the cloud reaches ABSORB it and become
// aggressive in proportion to what they absorbed, absorbed pollution (with time
// and with nests killed) raises a global EVOLUTION factor that gates which
// enemy types appear, and nests SPREAD outward so cleared ground does not stay
// cleared. Every attack is CAUSED by the player's own production and is
// therefore legible and controllable. A wave timer would satisfy the word
// "enemies" and miss the entire point, so the negative control in
// test_enemies.cpp (a nest that absorbed nothing dispatches nothing, forever)
// is the single most load-bearing test in this file.
//
// WHAT THIS FILE OWNS (headless, deterministic, testable):
//   §2  the enemy-type catalogue, authored as DATA (gameplay.h §A.2 pattern)
//   §3  EnemyTuning — every balance number in ONE struct, no code change
//   §4  PollutionField — a coarse sparse grid over the surface + diffusion/decay
//   §5  emitters (the factory-sim hook, published in §11 — NOT wired here)
//   §6  nests: absorption, pollution ATTRIBUTION, attack budget, expansion
//   §7  evolution: three inputs, each separately accounted for the UI
//   §8  attack waves: dispatched at the emitter that actually fed the nest
//   §9  EnemySim — the orchestrator, plus the reports a UI needs
//   §10 persistence (templated byte cursor, voxel_terrain.h style) + stateHash
//
// WHAT THIS FILE DELIBERATELY DOES NOT OWN (published interface, then stop):
//   pathfinding, movement, combat resolution against structures, turrets,
//   weapons, damage models, and anything rendered. An AttackWave is emitted
//   with an origin, a target and a roster; a combat lane takes it from there
//   and reports back through damageNest()/destroyNest().
//
// COST. The field is a SPARSE sorted vector of cells that carry pollution; a
// cell that falls under EnemyTuning::pruneEpsilon is dropped. Cost per
// pollution tick is O(active cells), NOT O(machines): a thousand machines in
// one 128 m cell cost one cell. The field advances once per
// EnemyTuning::pollutionTickInterval sim ticks (default 60, i.e. 1 Hz against
// the 60 UPS SimClock), so the amortised per-sim-tick cost is that divided by
// sixty. Measured numbers are in test_enemies.cpp (perf_pollution_tick_cost).
//
// DETERMINISM (standing rule 4). This module is TRANSCENDENTAL-FREE by
// construction: it uses only +, -, *, /, sqrt, fabs and floor, every one of
// which IEEE-754 specifies exactly. That is deliberate. CE-11 / DW-14 record
// that tan/asin/atan2/cos differ by 1 ULP between mingw-w64 libm and
// emscripten/musl, which is why WASM is the canonical world generator; nothing
// in this file adds to that list. Concretely, the cell lattice uses the RAW
// gnomonic face coordinate rather than cubed_sphere.h's equal-angle tan() warp
// (EN-2), and nest expansion steps along a chord rather than a great circle
// (EN-7). Iteration order is a sorted key order everywhere.
//
// SURFACE AUTHORITY (standing rule 1). This module NEVER answers "where is the
// ground". Positions are unit DIRECTIONS from the body centre; a consumer that
// needs a world position asks surface_field.h for the radius at that direction.
// The cube-face lattice here is a SPATIAL INDEX, not a terrain sample, and it
// touches neither the voxel field nor cell solidity — deliberately, since the
// voxel representation is being replaced.
//
// Header-only. Consumes ONLY of/vec3.h and of/cubed_sphere.h (§0 hash + the
// face basis + BodyParams). No factory_sim.h, no surface_field.h, no
// voxel_terrain.h, no persistence.h, no UE, no rendering, no physics.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "of/cubed_sphere.h"
#include "of/vec3.h"

namespace of {
namespace enemies {

// =============================================================================
// §1 — Ids and small shared types.
//
// Id blocks are hand-assigned, stable, append-only and never reused, the same
// discipline gameplay.h §1 uses. Enemy types own 0x01..0x0F in this namespace
// only; they do NOT collide with gameplay.h's item/type/recipe spaces because
// they are a different id space entirely (of::enemies::EnemyTypeId).
// =============================================================================
using EmitterId = uint32_t;    // a pollution source (one machine, or a group)
using NestId = uint32_t;       // one nest
using EnemyTypeId = uint16_t;  // a row in the EnemyCatalogue
using CellKey = uint64_t;      // a pollution-grid cell (§4)
using WaveId = uint64_t;

static constexpr EmitterId kNoEmitter = 0;
static constexpr NestId kNoNest = 0;
static constexpr EnemyTypeId kNoEnemyType = 0;
static constexpr CellKey kNoCell = ~uint64_t(0);

// Deterministic value stream. mix64 IS the splitmix64 finalizer (cubed_sphere.h
// §0), so mix64(0), mix64(1), ... is exactly splitmix64 with a counter state.
// Used only for choices (wave composition, expansion bearing tie-breaks), never
// for physical quantities.
struct DetRng {
  uint64_t state = 0;
  explicit DetRng(uint64_t seed) : state(seed) {}
  uint64_t nextU64() { return worldgen::mix64(state++); }
  double nextUnit() { return worldgen::hashToUnit(nextU64()); }
};

inline Vec3 unitOf(const Vec3& v) {
  const double len = v.length();
  if (len <= 0.0) return Vec3(0, 0, 1);
  const double inv = 1.0 / len;
  return Vec3(v.x * inv, v.y * inv, v.z * inv);
}

inline Vec3 crossOf(const Vec3& a, const Vec3& b) {
  return Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z,
              a.x * b.y - a.y * b.x);
}

// Chord distance between two surface directions, in metres. Used for reports
// and for separation tests. Chord, not arc, on purpose: arc needs asin/acos and
// at the scales this module cares about (metres to a few km on a 600 km body)
// chord understates arc by under 1 part in 1e5. Transcendental-free.
inline double chordDistanceM(const Vec3& a, const Vec3& b, double radiusM) {
  const Vec3 d(a.x - b.x, a.y - b.y, a.z - b.z);
  return d.length() * radiusM;
}

// =============================================================================
// §2 — The enemy-type catalogue. AUTHORED AS DATA.
//
// A row is one enemy type. Evolution gates it through THREE knobs so the roster
// rotates rather than only growing: weight is zero below minEvolution, ramps to
// spawnWeight across [minEvolution, peakEvolution], holds until fadeEvolution,
// then decays toward kFadeFloor * spawnWeight. Nothing ever reaches exactly
// zero after unlocking, so the roster can never empty and leave a nest with a
// budget it cannot spend.
//
// budgetCost is the pollution a nest spends to field one of these, which is what
// makes "attack size is proportional to what reached this nest" a data
// statement rather than a code one.
//
// health / damagePerSecond / speedMps / reachM are carried for the COMBAT lane.
// This file never reads them except to total them into an AttackWave summary.
// =============================================================================
namespace types {
static constexpr EnemyTypeId Skitterer = 0x01;  // early swarm
static constexpr EnemyTypeId Ravager = 0x02;    // mid melee
static constexpr EnemyTypeId Lancer = 0x03;     // mid ranged
static constexpr EnemyTypeId Sunderer = 0x04;   // late melee, breaks walls
static constexpr EnemyTypeId Colossus = 0x05;   // late siege
}  // namespace types

struct EnemyTypeDef {
  EnemyTypeId id = kNoEnemyType;
  std::string name;
  double minEvolution = 0.0;   // below this the type does not exist
  double peakEvolution = 0.0;  // weight reaches spawnWeight here
  double fadeEvolution = 2.0;  // beyond this the weight decays (>1 = never)
  double spawnWeight = 1.0;    // relative pick weight at peak
  double budgetCost = 10.0;    // pollution units to field one
  double health = 10.0;
  double damagePerSecond = 1.0;
  double speedMps = 5.0;
  double reachM = 1.5;  // engagement range; > 2 m reads as ranged
};

// Residual weight a faded-out type keeps, so a roster never empties.
static constexpr double kFadeFloor = 0.05;

inline double weightAtEvolution(const EnemyTypeDef& d, double evo) {
  if (evo < d.minEvolution) return 0.0;
  double w = d.spawnWeight;
  if (evo < d.peakEvolution) {
    const double span = d.peakEvolution - d.minEvolution;
    const double t = span > 0.0 ? (evo - d.minEvolution) / span : 1.0;
    w = d.spawnWeight * (kFadeFloor + (1.0 - kFadeFloor) * t);
  } else if (evo > d.fadeEvolution) {
    const double span = 1.0 - d.fadeEvolution;
    const double t = span > 0.0 ? (evo - d.fadeEvolution) / span : 1.0;
    const double u = t > 1.0 ? 1.0 : t;
    w = d.spawnWeight * (1.0 - (1.0 - kFadeFloor) * u);
  }
  return w;
}

// Curated array in a registry object, no file format, no parser — the
// gameplay.h §A.2 / vessel.h §3 pattern. Extension is additive and
// append-only: registerType() refuses to override an existing id.
class EnemyCatalogue {
 public:
  EnemyCatalogue() { build(); }

  const std::vector<EnemyTypeDef>& types() const { return defs_; }

  const EnemyTypeDef* type(EnemyTypeId id) const {
    for (const EnemyTypeDef& d : defs_)
      if (d.id == id) return &d;
    return nullptr;
  }

  bool registerType(const EnemyTypeDef& def) {
    if (type(def.id) != nullptr) return false;  // never reuse/override an id
    defs_.push_back(def);
    return true;
  }

  // Cheapest type currently unlocked, by budgetCost. Bounds wave composition.
  double minCostAt(double evo) const {
    double best = 0.0;
    bool any = false;
    for (const EnemyTypeDef& d : defs_) {
      if (weightAtEvolution(d, evo) <= 0.0) continue;
      if (!any || d.budgetCost < best) {
        best = d.budgetCost;
        any = true;
      }
    }
    return any ? best : 0.0;
  }

  // The next type that is NOT yet unlocked, lowest minEvolution first. This is
  // what a UI shows as "at 0.20, Ravagers appear" — the whole point of making
  // the difficulty curve legible instead of opaque.
  bool nextUnlock(double evo, EnemyTypeId& outId, double& outEvolution) const {
    bool found = false;
    for (const EnemyTypeDef& d : defs_) {
      if (d.minEvolution <= evo) continue;
      if (!found || d.minEvolution < outEvolution) {
        outId = d.id;
        outEvolution = d.minEvolution;
        found = true;
      }
    }
    return found;
  }

 private:
  void build() {
    // ---- The Tier-1 roster. Every number here is balance, not structure. ----
    // A Skitterer is 10 pollution; a full 400-pollution wave budget therefore
    // buys ~40 of them at evolution 0, which is the "early game is a swarm of
    // weak things" shape. A Colossus is 300, so the same budget buys one, which
    // is the "late game is a siege" shape. Costs are the difficulty curve.
    {
      EnemyTypeDef d;
      d.id = types::Skitterer;
      d.name = "Skitterer";
      d.minEvolution = 0.00;
      d.peakEvolution = 0.00;
      d.fadeEvolution = 0.35;
      d.spawnWeight = 100.0;
      d.budgetCost = 10.0;
      d.health = 15.0;
      d.damagePerSecond = 7.0;
      d.speedMps = 6.0;
      d.reachM = 1.5;
      defs_.push_back(d);
    }
    {
      EnemyTypeDef d;
      d.id = types::Ravager;
      d.name = "Ravager";
      d.minEvolution = 0.20;
      d.peakEvolution = 0.45;
      d.fadeEvolution = 0.75;
      d.spawnWeight = 80.0;
      d.budgetCost = 30.0;
      d.health = 75.0;
      d.damagePerSecond = 18.0;
      d.speedMps = 5.0;
      d.reachM = 2.0;
      defs_.push_back(d);
    }
    {
      EnemyTypeDef d;
      d.id = types::Lancer;
      d.name = "Lancer";
      d.minEvolution = 0.30;
      d.peakEvolution = 0.55;
      d.fadeEvolution = 2.0;  // ranged support never fades out
      d.spawnWeight = 45.0;
      d.budgetCost = 55.0;
      d.health = 60.0;
      d.damagePerSecond = 24.0;
      d.speedMps = 4.4;
      d.reachM = 12.0;  // ranged: outranges a short-reach turret
      defs_.push_back(d);
    }
    {
      EnemyTypeDef d;
      d.id = types::Sunderer;
      d.name = "Sunderer";
      d.minEvolution = 0.50;
      d.peakEvolution = 0.75;
      d.fadeEvolution = 2.0;
      d.spawnWeight = 50.0;
      d.budgetCost = 90.0;
      d.health = 350.0;
      d.damagePerSecond = 45.0;
      d.speedMps = 4.2;
      d.reachM = 2.5;
      defs_.push_back(d);
    }
    {
      EnemyTypeDef d;
      d.id = types::Colossus;
      d.name = "Colossus";
      d.minEvolution = 0.80;
      d.peakEvolution = 0.95;
      d.fadeEvolution = 2.0;
      d.spawnWeight = 20.0;
      d.budgetCost = 300.0;
      d.health = 1600.0;
      d.damagePerSecond = 120.0;
      d.speedMps = 3.4;
      d.reachM = 4.0;
      defs_.push_back(d);
    }
  }

  std::vector<EnemyTypeDef> defs_;
};

// =============================================================================
// §3 — EnemyTuning: EVERY balance number, in one struct.
//
// The brief's requirement was "tunable from data, the way gameplay.h authors
// recipes, so balance is a table rather than a code change". This struct IS the
// table. Nothing in this file reads a magic number that is not either here or
// in an EnemyTypeDef row.
// =============================================================================
struct EnemyTuning {
  // ---- pollution field (§4) ------------------------------------------------
  // Target cell edge at a cube-face CENTRE. The lattice is a power of two per
  // face side, so the REALISED size is the nearest power-of-two subdivision and
  // is reported by PollutionField::cellSizeAtFaceCentreM(), never assumed.
  // 200 m resolves to 2^13 cells/side on Forge (R = 600 km) = 146.484375 m and
  // 2^11 on Cinder (R = 200 km) = 195.3125 m.
  double cellTargetM = 200.0;
  // Sim ticks between pollution updates. 60 against a 60 UPS SimClock = 1 Hz,
  // which is also Factorio's pollution period. This is the single biggest cost
  // lever in the file: cost divides by it.
  uint32_t pollutionTickInterval = 60;
  // Fraction of a cell's pollution handed to EACH of its 4 neighbours per
  // pollution tick. Explicit-scheme stability needs 4*diffusionRate < 1.
  double diffusionRate = 0.15;
  // Fraction lost per pollution tick, applied after diffusion. Together these
  // set the cloud's e-folding radius: L = cellSize * sqrt(diffusion / decay),
  // here 146.48 * sqrt(0.15/0.0025) = 1,135 m on Forge, with a 277 s half-life.
  // Raising decayRate shrinks the cloud AND the per-tick cost, quadratically.
  double decayRate = 0.0025;
  // A cell under this is dropped. THE bound on active-cell count, and therefore
  // on per-tick cost. Raise it to make the sim cheaper and the cloud smaller.
  double pruneEpsilon = 0.05;
  // Cells under this are not worth drawing / not counted in the reported
  // extent. Purely a reporting threshold; it never changes the simulation.
  double minShownPerCell = 1.0;

  // ---- nests (§6) ----------------------------------------------------------
  // How fast ONE nest can eat. This is a real design lever, not just balance:
  // a low ceiling means a heavy cloud is not consumed by the nearest nest, so
  // it spreads and angers MORE nests instead of one nest becoming infinitely
  // angry. Distance and nest count both stay meaningful.
  double nestAbsorptionPerSecond = 8.0;
  double nestMaxHealth = 500.0;
  // Pollution a nest must have absorbed since its last wave before it attacks.
  // A nest eating at its full 8/s reaches this in 62.5 s.
  double attackThresholdPollution = 500.0;
  uint64_t attackCooldownTicks = 3600;  // 60 s at 60 UPS
  // A CEILING that protects the combat lane from an unbounded roster, not a
  // balance dial. Wave size should be set by the pollution budget (which is the
  // legible part) right up until this bites.
  uint32_t maxWaveSize = 100;
  // Per-source attribution half-life, so a wave targets what is polluting NOW
  // rather than what polluted an hour ago. 0.999/s is a ~11.5 min half-life.
  double sourceCreditDecayPerTick = 0.999;

  // ---- evolution (§7) ------------------------------------------------------
  // Factorio's three inputs, kept. Values are first-pass and playtest-tunable.
  // Time alone reaches 0.5 in ~69 min, which is Factorio's own pacing.
  double evoTimeFactorPerSecond = 2.4e-4;
  double evoPollutionFactorPerUnit = 1.2e-5;
  double evoKillFactorPerNest = 2.0e-3;
  // A single evolution step may consume at most this fraction of the remaining
  // headroom to 1.0, so the factor is bounded below 1 by construction.
  double evoMaxStepFractionOfHeadroom = 0.5;

  // ---- spreading (§6b) -----------------------------------------------------
  double expansionShareOfAbsorbed = 0.25;  // absorbed pollution feeds expansion
  double expansionIdlePerSecond = 0.5;     // scaled by evolution; frontier still
                                           // creeps with no pollution at all
  double expansionCost = 1200.0;
  uint64_t expansionCooldownTicks = 10800;  // 3 min at 60 UPS
  double expansionDistanceM = 900.0;
  double minNestSeparationM = 450.0;
  uint32_t expansionCandidates = 8;  // bearings sampled; best-pollution wins
  uint32_t maxNests = 512;           // hard ceiling; exhaustion is reported

  double fixedDt = 1.0 / 60.0;  // seconds per sim tick (matches of::SimClock)

  double pollutionSecondsPerTick() const {
    return fixedDt * static_cast<double>(pollutionTickInterval);
  }
};

// =============================================================================
// §4 — PollutionField: a coarse SPARSE grid over the body surface.
//
// LATTICE (EN-2). A cell is (cube face, i, j) on a 2^bits x 2^bits per-face
// grid, addressed through the RAW gnomonic face coordinate wu = dot(dir,right)
// / dot(dir,normal), NOT through cubed_sphere.h's equal-angle tan() warp. The
// warp would give near-uniform cells; the raw projection gives cells that are
// up to 2.12x smaller in linear size at a face corner than at a face centre
// (measured in test_enemies.cpp). That non-uniformity is the price paid for
// being transcendental-free, and it is the right trade: CE-11/DW-15 make
// tan/atan a named cross-toolchain hazard and a pollution grid does not need
// equal-area cells, it needs to be identical on every machine.
//
// This is a SPATIAL INDEX. It reads the cube-face basis (the authority for what
// a face is) and nothing else. It never samples terrain height or solidity.
//
// STORAGE. A vector of cells sorted by key. Sorted = deterministic iteration
// with no hash, cache-friendly, and O(log n) lookup by binary search. Only
// cells carrying pollution exist, so cost is O(cloud), never O(machines).
//
// DIFFUSION (SCATTER form). Per pollution tick each cell hands
// diffusionRate * amount to EACH of its 4 neighbours and keeps the rest, then
// everything is multiplied by (1 - decayRate). Scatter rather than gather is
// deliberate: it conserves mass EXACTLY even where the neighbour relation is
// not symmetric, which is what happens at a cube-face seam. Away from a seam
// the two forms are algebraically identical:
//     next[c] = cur[c] - 4D*cur[c] + D*sum(neighbours)   ==   cur + D*laplacian
//
// ATTRIBUTION. Each cell carries the id of its single largest contributing
// emitter and that contributor's share of the cell. This is a plurality
// ESTIMATE, not an exact per-source decomposition (which would cost one field
// per source). It is what lets a wave be dispatched at the part of the base
// that actually fed the nest.
// =============================================================================
struct PollutionCellView {
  CellKey key = kNoCell;
  double amount = 0.0;
  double sourceAmount = 0.0;   // share attributed to `source`
  EmitterId source = kNoEmitter;
};

class PollutionField {
 public:
  PollutionField(const worldgen::BodyParams& body, const EnemyTuning& tuning)
      : body_(body), tuning_(tuning) {
    bits_ = resolveBits(body.radiusM, tuning.cellTargetM);
    side_ = uint32_t(1) << bits_;
  }

  // --- lattice geometry ----------------------------------------------------
  uint32_t cellsPerFaceSide() const { return side_; }
  uint32_t cellBits() const { return bits_; }
  // Cell edge at a cube-face CENTRE. A face spans gnomonic wu in [-1,1] and at
  // the centre one unit of wu is one radian, so the edge is 2*R/side.
  double cellSizeAtFaceCentreM() const {
    return 2.0 * body_.radiusM / static_cast<double>(side_);
  }

  static uint32_t resolveBits(double radiusM, double targetM) {
    // side ~= 2R/target, rounded to the nearest power of two, clamped so the
    // packed key always fits: 3 face bits + 24 + 24 < 64.
    if (targetM <= 0.0) return 14;
    const double want = 2.0 * radiusM / targetM;
    uint32_t b = 4;
    while (b < 24 && (double)(uint64_t(1) << (b + 1)) <= want * 1.4142135623730951)
      ++b;
    return b;
  }

  static CellKey packKey(int face, uint32_t i, uint32_t j) {
    return (static_cast<uint64_t>(face) << 56) |
           (static_cast<uint64_t>(i) << 28) | static_cast<uint64_t>(j);
  }
  static int keyFace(CellKey k) { return static_cast<int>(k >> 56); }
  static uint32_t keyI(CellKey k) {
    return static_cast<uint32_t>((k >> 28) & 0x0FFFFFFFull);
  }
  static uint32_t keyJ(CellKey k) {
    return static_cast<uint32_t>(k & 0x0FFFFFFFull);
  }

  // Direction -> cell. Transcendental-free: dot products, one divide, a floor.
  CellKey cellOf(const Vec3& dir) const {
    const Vec3 d = unitOf(dir);
    const int f = worldgen::faceOfDir(d);
    const worldgen::FaceBasis& b = worldgen::faceBasis(f);
    const double n = d.dot(b.normal);
    if (!(n > 0.0)) return packKey(f, 0, 0);  // cannot happen; defensive
    const double wu = d.dot(b.right) / n;
    const double wv = d.dot(b.up) / n;
    return packKey(f, binOf(wu), binOf(wv));
  }

  // Cell -> the direction of its centre. The raw gnomonic combination of the
  // face basis (deliberately NOT cubed_sphere.h::unitDir, which applies the
  // tan() warp this lattice is defined to avoid).
  Vec3 cellCentreDir(CellKey key) const {
    const int f = keyFace(key);
    const double inv = 1.0 / static_cast<double>(side_);
    const double wu = -1.0 + 2.0 * ((static_cast<double>(keyI(key)) + 0.5) * inv);
    const double wv = -1.0 + 2.0 * ((static_cast<double>(keyJ(key)) + 0.5) * inv);
    return faceDir(f, wu, wv);
  }

  // The 4 axis neighbours. Inside a face this is integer arithmetic. At a face
  // edge it steps geometrically to just past the edge and re-derives the cell,
  // which crosses the seam correctly with no adjacency table and no rotation
  // bookkeeping. Mass conservation does not depend on this being symmetric.
  void neighbours(CellKey key, CellKey out[4]) const {
    static const int kD[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    const int f = keyFace(key);
    const int64_t i = static_cast<int64_t>(keyI(key));
    const int64_t j = static_cast<int64_t>(keyJ(key));
    const int64_t n = static_cast<int64_t>(side_);
    const double inv = 1.0 / static_cast<double>(side_);
    for (int k = 0; k < 4; ++k) {
      const int64_t ii = i + kD[k][0];
      const int64_t jj = j + kD[k][1];
      if (ii >= 0 && ii < n && jj >= 0 && jj < n) {
        out[k] = packKey(f, static_cast<uint32_t>(ii), static_cast<uint32_t>(jj));
      } else {
        // wu / wv land just outside [-1,1], so the direction lies on the
        // ADJACENT face and faceOfDir picks it up.
        const double wu = -1.0 + 2.0 * ((static_cast<double>(ii) + 0.5) * inv);
        const double wv = -1.0 + 2.0 * ((static_cast<double>(jj) + 0.5) * inv);
        out[k] = cellOf(faceDir(f, wu, wv));
      }
    }
  }

  // --- content -------------------------------------------------------------
  const std::vector<PollutionCellView>& cells() const { return cells_; }
  size_t activeCells() const { return cells_.size(); }

  double totalMass() const {
    double t = 0.0;
    for (const PollutionCellView& c : cells_) t += c.amount;
    return t;
  }

  double amountAt(CellKey key) const {
    const PollutionCellView* c = find(key);
    return c != nullptr ? c->amount : 0.0;
  }

  const PollutionCellView* find(CellKey key) const {
    auto it = std::lower_bound(cells_.begin(), cells_.end(), key, byKey());
    if (it == cells_.end() || it->key != key) return nullptr;
    return &(*it);
  }

  void deposit(CellKey key, double amount, EmitterId src) {
    if (!(amount > 0.0)) return;
    auto it = std::lower_bound(cells_.begin(), cells_.end(), key, byKey());
    if (it == cells_.end() || it->key != key) {
      PollutionCellView c;
      c.key = key;
      c.amount = amount;
      c.sourceAmount = amount;
      c.source = src;
      cells_.insert(it, c);
      return;
    }
    it->amount += amount;
    if (src == it->source) {
      it->sourceAmount += amount;
    } else if (amount > it->sourceAmount) {
      it->source = src;
      it->sourceAmount = amount;
    }
  }

  // Remove up to `want` from a cell. Reports how much came out and, of that,
  // how much is attributable to which emitter (the rest is unattributed).
  double take(CellKey key, double want, EmitterId& outSrc, double& outAttributed) {
    outSrc = kNoEmitter;
    outAttributed = 0.0;
    if (!(want > 0.0)) return 0.0;
    auto it = std::lower_bound(cells_.begin(), cells_.end(), key, byKey());
    if (it == cells_.end() || it->key != key) return 0.0;
    const double took = it->amount < want ? it->amount : want;
    if (!(took > 0.0)) return 0.0;
    const double frac = it->sourceAmount / it->amount;  // amount > 0 here
    outSrc = it->source;
    outAttributed = took * frac;
    it->amount -= took;
    it->sourceAmount -= outAttributed;
    if (it->amount < tuning_.pruneEpsilon) cells_.erase(it);
    return took;
  }

  // ONE pollution tick: scatter, then decay, then prune.
  void diffuseAndDecay() {
    const double D = tuning_.diffusionRate;
    const double keep = 1.0 - 4.0 * D;
    const double survive = 1.0 - tuning_.decayRate;
    scratch_.clear();
    scratch_.reserve(cells_.size() * 5);
    CellKey nb[4];
    for (const PollutionCellView& c : cells_) {
      const double srcFrac = c.amount > 0.0 ? c.sourceAmount / c.amount : 0.0;
      // retained
      scratch_.push_back({c.key, c.amount * keep, c.amount * keep * srcFrac, c.source});
      const double give = c.amount * D;
      if (give > 0.0) {
        neighbours(c.key, nb);
        const double giveSrc = give * srcFrac;
        for (int k = 0; k < 4; ++k)
          scratch_.push_back({nb[k], give, giveSrc, c.source});
      }
    }
    // Sort by (key, source) so the merge below is a single linear pass and the
    // plurality tie-break is "lowest emitter id wins", deterministically.
    std::sort(scratch_.begin(), scratch_.end(),
              [](const PollutionCellView& a, const PollutionCellView& b) {
                if (a.key != b.key) return a.key < b.key;
                return a.source < b.source;
              });
    cells_.clear();
    size_t p = 0;
    while (p < scratch_.size()) {
      const CellKey key = scratch_[p].key;
      double total = 0.0;
      double bestSrcAmount = 0.0;
      EmitterId bestSrc = kNoEmitter;
      size_t q = p;
      while (q < scratch_.size() && scratch_[q].key == key) {
        const EmitterId src = scratch_[q].source;
        double runSrc = 0.0;
        while (q < scratch_.size() && scratch_[q].key == key &&
               scratch_[q].source == src) {
          total += scratch_[q].amount;
          runSrc += scratch_[q].sourceAmount;
          ++q;
        }
        if (src != kNoEmitter && runSrc > bestSrcAmount) {
          bestSrcAmount = runSrc;
          bestSrc = src;
        }
      }
      const double amount = total * survive;
      if (amount >= tuning_.pruneEpsilon) {
        PollutionCellView c;
        c.key = key;
        c.amount = amount;
        c.sourceAmount = bestSrcAmount * survive;
        c.source = bestSrc;
        cells_.push_back(c);
      }
      p = q;
    }
  }

  void clear() { cells_.clear(); }

  // --- persistence (§10) ---------------------------------------------------
  template <typename Writer>
  void serialize(Writer& w) const {
    w.varint(cells_.size());
    for (const PollutionCellView& c : cells_) {
      w.varint(c.key);
      w.f64(c.amount);
      w.f64(c.sourceAmount);
      w.varint(c.source);
    }
  }
  template <typename Reader>
  void deserialize(Reader& r) {
    const uint64_t n = r.varint();
    cells_.clear();
    cells_.reserve(static_cast<size_t>(n));
    for (uint64_t k = 0; k < n; ++k) {
      PollutionCellView c;
      c.key = r.varint();
      c.amount = r.f64();
      c.sourceAmount = r.f64();
      c.source = static_cast<EmitterId>(r.varint());
      cells_.push_back(c);
    }
  }

 private:
  struct byKey {
    bool operator()(const PollutionCellView& c, CellKey k) const {
      return c.key < k;
    }
    bool operator()(CellKey k, const PollutionCellView& c) const {
      return k < c.key;
    }
  };

  uint32_t binOf(double w) const {
    const double t = (w + 1.0) * 0.5 * static_cast<double>(side_);
    if (!(t > 0.0)) return 0;
    const double f = std::floor(t);
    if (f >= static_cast<double>(side_)) return side_ - 1;
    return static_cast<uint32_t>(f);
  }

  // Raw gnomonic face combination. wu/wv MAY sit slightly outside [-1,1]; that
  // is how neighbours() crosses a seam.
  static Vec3 faceDir(int face, double wu, double wv) {
    const worldgen::FaceBasis& b = worldgen::faceBasis(face);
    return unitOf(Vec3(b.normal.x + wu * b.right.x + wv * b.up.x,
                       b.normal.y + wu * b.right.y + wv * b.up.y,
                       b.normal.z + wu * b.right.z + wv * b.up.z));
  }

  worldgen::BodyParams body_;
  EnemyTuning tuning_;
  uint32_t bits_ = 14;
  uint32_t side_ = 1u << 14;
  std::vector<PollutionCellView> cells_;
  std::vector<PollutionCellView> scratch_;
};

// =============================================================================
// §5 — Emitters. The factory-sim hook, kept at arm's length ON PURPOSE.
//
// An emitter is a pollution source at a surface direction with a rate in
// units/second. It is NOT a machine: factory_sim.h is owned by another lane
// tonight and is not edited here. The contract factory-sim implements is in
// §11 (pollutionRateForMachine) plus these three calls. Until that lands, a
// caller drives emitters directly, which is exactly how the tests do it.
// =============================================================================
struct Emitter {
  EmitterId id = kNoEmitter;
  Vec3 dir;  // unit direction from the body centre; NOT a world position
  double ratePerSecond = 0.0;
  bool active = true;
};

// =============================================================================
// §6 — Nests: absorption, attribution, attack budget, expansion budget.
// =============================================================================
struct SourceCredit {
  EmitterId source = kNoEmitter;
  double absorbed = 0.0;  // decayed; drives WHERE the next wave goes
  Vec3 lastKnownDir;
};

static constexpr size_t kMaxNestSources = 8;

struct Nest {
  NestId id = kNoNest;
  Vec3 dir;
  uint32_t generation = 0;  // 0 = seeded at worldgen; n = expanded n times
  bool alive = true;
  double health = 0.0;
  double maxHealth = 0.0;
  // Lifetime, never decayed. The negative control reads this.
  double absorbedLifetime = 0.0;
  double attackBudget = 0.0;     // spent on waves
  double expansionBudget = 0.0;  // spent on children
  uint64_t lastAttackTick = 0;
  uint64_t lastExpandTick = 0;
  uint64_t wavesDispatched = 0;
  uint32_t children = 0;
  std::vector<SourceCredit> sources;

  // The emitter this nest is currently angriest about.
  const SourceCredit* topSource() const {
    const SourceCredit* best = nullptr;
    for (const SourceCredit& s : sources) {
      if (s.source == kNoEmitter || !(s.absorbed > 0.0)) continue;
      if (best == nullptr || s.absorbed > best->absorbed ||
          (s.absorbed == best->absorbed && s.source < best->source))
        best = &s;
    }
    return best;
  }
};

// =============================================================================
// §7 — Evolution. Factorio's THREE inputs, ALL THREE KEPT, each accounted
// separately so a UI can say WHY the number moved.
//
//   delta_x = factor_x * input_x * (1 - evolution)^2
//   evolution = fromTime + fromPollution + fromKills      (exactly, always)
//
// The (1-e)^2 coupling makes evolution saturating, so the same input buys less
// late than early; the per-term accounting applies the SAME scale to all three,
// so the three stored terms sum bit-exactly to the factor and the UI's
// breakdown is a decomposition rather than an estimate.
//
// THE ONE DELIBERATE DEVIATION FROM FACTORIO (EN-4): the pollution input is
// pollution ABSORBED BY NESTS, not pollution PRODUCED. Producing pollution that
// never reaches a nest does not evolve anything. That is the legibility
// requirement made mechanical: distance, decay, and killing the nests that are
// eating your cloud all become real mitigations, and "why is evolution rising"
// always has an answer that points at a specific nest.
// =============================================================================
struct EvolutionState {
  double factor = 0.0;         // in [0, 1)
  double fromTime = 0.0;       // the three terms, summing to `factor`
  double fromPollution = 0.0;
  double fromKills = 0.0;
  // Raw inputs, for a UI that wants "you have absorbed 12,400 pollution".
  double secondsElapsed = 0.0;
  double pollutionAbsorbed = 0.0;
  uint64_t nestsDestroyed = 0;
};

// =============================================================================
// §8 — Attack waves. The handoff to the combat lane, and where this file stops.
// =============================================================================
struct WaveMember {
  EnemyTypeId typeId = kNoEnemyType;
  uint32_t count = 0;
};

struct AttackWave {
  WaveId id = 0;
  NestId sourceNest = kNoNest;
  Vec3 originDir;  // where it spawns: the nest
  Vec3 targetDir;  // where it is going: the emitter that fed this nest
  EmitterId targetEmitter = kNoEmitter;
  double pollutionSpent = 0.0;
  double evolutionAtDispatch = 0.0;
  uint64_t dispatchTick = 0;
  std::vector<WaveMember> members;
  uint32_t totalCount = 0;
  double totalHealth = 0.0;        // summed from the catalogue, for the UI
  double totalDamagePerSecond = 0.0;
  double slowestSpeedMps = 0.0;    // the wave moves at its slowest member
};

// =============================================================================
// §9 — Reports. The numbers a UI needs to make the loop LEGIBLE.
//
// "An opaque difficulty curve is the failure mode here." Everything a player
// would need to answer "why am I being attacked and what would reduce it" is
// published here and nowhere else.
// =============================================================================
struct PollutionReport {
  double producedPerSecond = 0.0;   // sum over ACTIVE emitters
  double totalInField = 0.0;        // pollution currently spread over the world
  double absorbedPerSecond = 0.0;   // what nests took on the last pollution tick
  double absorbedLifetime = 0.0;
  uint32_t activeCells = 0;         // the cost driver
  uint32_t visibleCells = 0;        // cells over minShownPerCell
  double cellSizeM = 0.0;
  double extentM = 0.0;             // furthest visible cell from the base centre
  Vec3 centroidDir;                 // rate-weighted centre of production
  uint32_t absorbingNests = 0;      // nests that took pollution last tick
  uint32_t emitters = 0;
};

struct NestThreat {
  NestId id = kNoNest;
  Vec3 dir;
  uint32_t generation = 0;
  double health = 0.0;
  double maxHealth = 0.0;
  double absorbedLifetime = 0.0;
  double attackBudget = 0.0;
  double fractionOfAttackThreshold = 0.0;  // 1.0 = a wave is imminent
  uint64_t wavesDispatched = 0;
  EmitterId angriestAt = kNoEmitter;  // the emitter it will come for
  double distanceToTargetM = 0.0;
};

// =============================================================================
// §9b — EnemySim: the orchestrator.
//
// step() is ONE sim tick at the SimClock's 60 UPS. The expensive work runs once
// every EnemyTuning::pollutionTickInterval ticks; every other tick costs one
// modulo. Ordering inside the slow tick is fixed and is the loop itself:
//   emit -> spread+decay -> absorb -> evolve -> dispatch waves -> expand.
// =============================================================================
class EnemySim {
 public:
  EnemySim(const worldgen::BodyParams& body, uint64_t worldSeed,
           const EnemyTuning& tuning = EnemyTuning(),
           const EnemyCatalogue& catalogue = EnemyCatalogue())
      : body_(body),
        seed_(worldgen::mix64(worldSeed ^ 0xE7E31E5Full)),  // "enemies" salt
        tuning_(tuning),
        catalogue_(catalogue),
        field_(body, tuning) {}

  const worldgen::BodyParams& body() const { return body_; }
  const EnemyTuning& tuning() const { return tuning_; }
  const EnemyCatalogue& catalogue() const { return catalogue_; }
  const PollutionField& field() const { return field_; }
  PollutionField& mutableField() { return field_; }
  uint64_t tickIndex() const { return tick_; }

  // --- emitters ------------------------------------------------------------
  EmitterId addEmitter(const Vec3& dir, double ratePerSecond) {
    Emitter e;
    e.id = nextEmitterId_++;
    e.dir = unitOf(dir);
    e.ratePerSecond = ratePerSecond;
    e.active = true;
    emitters_.push_back(e);
    return e.id;
  }
  bool setEmitterRate(EmitterId id, double ratePerSecond) {
    Emitter* e = emitter(id);
    if (e == nullptr) return false;
    e->ratePerSecond = ratePerSecond;
    return true;
  }
  bool setEmitterActive(EmitterId id, bool active) {
    Emitter* e = emitter(id);
    if (e == nullptr) return false;
    e->active = active;
    return true;
  }
  bool removeEmitter(EmitterId id) {
    for (size_t i = 0; i < emitters_.size(); ++i) {
      if (emitters_[i].id != id) continue;
      emitters_.erase(emitters_.begin() + static_cast<ptrdiff_t>(i));
      return true;
    }
    return false;
  }
  const std::vector<Emitter>& emitters() const { return emitters_; }
  double pollutionPerSecond() const {
    double r = 0.0;
    for (const Emitter& e : emitters_)
      if (e.active && e.ratePerSecond > 0.0) r += e.ratePerSecond;
    return r;
  }

  // --- nests ---------------------------------------------------------------
  NestId addNest(const Vec3& dir, uint32_t generation = 0) {
    if (nests_.size() >= tuning_.maxNests) {
      ++nestPlacementsRefused_;
      return kNoNest;
    }
    Nest n;
    n.id = nextNestId_++;
    n.dir = unitOf(dir);
    n.generation = generation;
    n.maxHealth = tuning_.nestMaxHealth;
    n.health = n.maxHealth;
    n.lastAttackTick = tick_;
    n.lastExpandTick = tick_;
    nests_.push_back(n);
    return n.id;
  }
  const std::vector<Nest>& nests() const { return nests_; }
  const Nest* nest(NestId id) const {
    for (const Nest& n : nests_)
      if (n.id == id) return &n;
    return nullptr;
  }
  uint32_t aliveNestCount() const {
    uint32_t c = 0;
    for (const Nest& n : nests_)
      if (n.alive) ++c;
    return c;
  }
  // A pool that silently drops work is worse than one that fails (DW-28). If a
  // caller ever sees this above zero, maxNests is binding.
  uint64_t nestPlacementsRefused() const { return nestPlacementsRefused_; }

  // The combat lane calls these. Returns true if the nest died on this call.
  bool damageNest(NestId id, double damage) {
    Nest* n = mutableNest(id);
    if (n == nullptr || !n->alive || !(damage > 0.0)) return false;
    n->health -= damage;
    if (n->health > 0.0) return false;
    n->health = 0.0;
    n->alive = false;
    ++pendingKills_;
    return true;
  }
  bool destroyNest(NestId id) {
    Nest* n = mutableNest(id);
    if (n == nullptr || !n->alive) return false;
    n->health = 0.0;
    n->alive = false;
    ++pendingKills_;
    return true;
  }

  // --- the tick ------------------------------------------------------------
  void step() {
    ++tick_;
    if (tuning_.pollutionTickInterval == 0 ||
        (tick_ % tuning_.pollutionTickInterval) != 0)
      return;
    slowTick();
  }
  void step(uint64_t n) {
    for (uint64_t i = 0; i < n; ++i) step();
  }

  // --- outputs -------------------------------------------------------------
  const std::vector<AttackWave>& pendingWaves() const { return waves_; }
  std::vector<AttackWave> drainWaves() {
    std::vector<AttackWave> out;
    out.swap(waves_);
    return out;
  }
  const EvolutionState& evolution() const { return evo_; }
  bool nextUnlock(EnemyTypeId& outId, double& outEvolution) const {
    return catalogue_.nextUnlock(evo_.factor, outId, outEvolution);
  }

  PollutionReport pollutionReport() const {
    PollutionReport r;
    r.producedPerSecond = pollutionPerSecond();
    r.totalInField = field_.totalMass();
    r.absorbedPerSecond = lastAbsorbed_ / tuning_.pollutionSecondsPerTick();
    r.absorbedLifetime = evo_.pollutionAbsorbed;
    r.activeCells = static_cast<uint32_t>(field_.activeCells());
    r.cellSizeM = field_.cellSizeAtFaceCentreM();
    r.absorbingNests = lastAbsorbingNests_;
    r.emitters = static_cast<uint32_t>(emitters_.size());
    r.centroidDir = productionCentroid();
    for (const PollutionCellView& c : field_.cells()) {
      if (c.amount < tuning_.minShownPerCell) continue;
      ++r.visibleCells;
      const double d =
          chordDistanceM(field_.cellCentreDir(c.key), r.centroidDir, body_.radiusM);
      if (d > r.extentM) r.extentM = d;
    }
    return r;
  }

  // Sorted most-dangerous-first, so a UI can show the top N.
  std::vector<NestThreat> threatReport() const {
    std::vector<NestThreat> out;
    out.reserve(nests_.size());
    for (const Nest& n : nests_) {
      if (!n.alive) continue;
      NestThreat t;
      t.id = n.id;
      t.dir = n.dir;
      t.generation = n.generation;
      t.health = n.health;
      t.maxHealth = n.maxHealth;
      t.absorbedLifetime = n.absorbedLifetime;
      t.attackBudget = n.attackBudget;
      t.fractionOfAttackThreshold =
          tuning_.attackThresholdPollution > 0.0
              ? n.attackBudget / tuning_.attackThresholdPollution
              : 0.0;
      t.wavesDispatched = n.wavesDispatched;
      const SourceCredit* s = n.topSource();
      if (s != nullptr) {
        t.angriestAt = s->source;
        t.distanceToTargetM = chordDistanceM(n.dir, s->lastKnownDir, body_.radiusM);
      }
      out.push_back(t);
    }
    std::sort(out.begin(), out.end(), [](const NestThreat& a, const NestThreat& b) {
      if (a.fractionOfAttackThreshold != b.fractionOfAttackThreshold)
        return a.fractionOfAttackThreshold > b.fractionOfAttackThreshold;
      return a.id < b.id;
    });
    return out;
  }

  // Rate-weighted centre of production: "where the base is", for the UI's
  // pollution extent and for anything that wants to point at the cause.
  Vec3 productionCentroid() const {
    Vec3 acc;
    double w = 0.0;
    for (const Emitter& e : emitters_) {
      if (!e.active || !(e.ratePerSecond > 0.0)) continue;
      acc = acc + e.dir * e.ratePerSecond;
      w += e.ratePerSecond;
    }
    if (!(w > 0.0)) return Vec3(0, 0, 1);
    return unitOf(acc);
  }

  // --- determinism / persistence (§10) -------------------------------------
  uint64_t stateHash() const;
  template <typename Writer>
  void serialize(Writer& w) const;
  template <typename Reader>
  void deserialize(Reader& r);

 private:
  Emitter* emitter(EmitterId id) {
    for (Emitter& e : emitters_)
      if (e.id == id) return &e;
    return nullptr;
  }
  const Emitter* emitter(EmitterId id) const {
    for (const Emitter& e : emitters_)
      if (e.id == id) return &e;
    return nullptr;
  }
  Nest* mutableNest(NestId id) {
    for (Nest& n : nests_)
      if (n.id == id) return &n;
    return nullptr;
  }

  // ---- the loop, in order --------------------------------------------------
  void slowTick() {
    const double dt = tuning_.pollutionSecondsPerTick();
    emitStep(dt);
    field_.diffuseAndDecay();
    const double absorbed = absorbStep(dt);
    evolveStep(dt, absorbed);
    waveStep();
    expandStep(dt);
  }

  void emitStep(double dt) {
    for (const Emitter& e : emitters_) {
      if (!e.active || !(e.ratePerSecond > 0.0)) continue;
      field_.deposit(field_.cellOf(e.dir), e.ratePerSecond * dt, e.id);
    }
  }

  double absorbStep(double dt) {
    const double want = tuning_.nestAbsorptionPerSecond * dt;
    double total = 0.0;
    uint32_t absorbing = 0;
    for (Nest& n : nests_) {
      // Credits decay whether or not this nest absorbed, so the target follows
      // what is polluting NOW.
      for (SourceCredit& s : n.sources)
        s.absorbed *= tuning_.sourceCreditDecayPerTick;
      if (!n.alive) continue;
      EmitterId src = kNoEmitter;
      double attributed = 0.0;
      const double took =
          field_.take(field_.cellOf(n.dir), want, src, attributed);
      if (!(took > 0.0)) continue;
      ++absorbing;
      total += took;
      n.absorbedLifetime += took;
      n.attackBudget += took;
      n.expansionBudget += took * tuning_.expansionShareOfAbsorbed;
      if (src != kNoEmitter && attributed > 0.0) creditSource(n, src, attributed);
    }
    lastAbsorbed_ = total;
    lastAbsorbingNests_ = absorbing;
    return total;
  }

  void creditSource(Nest& n, EmitterId src, double amount) {
    Vec3 dir;
    const Emitter* e = emitter(src);
    for (SourceCredit& s : n.sources) {
      if (s.source != src) continue;
      s.absorbed += amount;
      if (e != nullptr) s.lastKnownDir = e->dir;
      return;
    }
    if (e != nullptr) dir = e->dir;
    if (n.sources.size() < kMaxNestSources) {
      SourceCredit s;
      s.source = src;
      s.absorbed = amount;
      s.lastKnownDir = dir;
      n.sources.push_back(s);
      return;
    }
    // Replace the weakest entry if this one already beats it. Ties keep the
    // incumbent, and the scan order is the vector order, which is deterministic.
    size_t weakest = 0;
    for (size_t i = 1; i < n.sources.size(); ++i)
      if (n.sources[i].absorbed < n.sources[weakest].absorbed) weakest = i;
    if (amount <= n.sources[weakest].absorbed) return;
    n.sources[weakest].source = src;
    n.sources[weakest].absorbed = amount;
    n.sources[weakest].lastKnownDir = dir;
  }

  void evolveStep(double dt, double absorbed) {
    const uint64_t kills = pendingKills_;
    pendingKills_ = 0;
    evo_.secondsElapsed += dt;
    evo_.pollutionAbsorbed += absorbed;
    evo_.nestsDestroyed += kills;

    const double head = 1.0 - evo_.factor;
    if (!(head > 0.0)) return;
    const double scale = head * head;
    double dT = tuning_.evoTimeFactorPerSecond * dt * scale;
    double dP = tuning_.evoPollutionFactorPerUnit * absorbed * scale;
    double dK =
        tuning_.evoKillFactorPerNest * static_cast<double>(kills) * scale;
    if (dT < 0.0) dT = 0.0;
    if (dP < 0.0) dP = 0.0;
    if (dK < 0.0) dK = 0.0;
    const double sum = dT + dP + dK;
    const double cap = head * tuning_.evoMaxStepFractionOfHeadroom;
    if (sum > cap && sum > 0.0) {
      const double k = cap / sum;
      dT *= k;
      dP *= k;
      dK *= k;
    }
    evo_.fromTime += dT;
    evo_.fromPollution += dP;
    evo_.fromKills += dK;
    // Re-sum rather than accumulate, so the identity the UI shows
    // (factor == fromTime + fromPollution + fromKills) holds BIT-EXACTLY.
    evo_.factor = evo_.fromTime + evo_.fromPollution + evo_.fromKills;
  }

  void waveStep() {
    for (Nest& n : nests_) {
      if (!n.alive) continue;
      if (n.attackBudget < tuning_.attackThresholdPollution) continue;
      if (tick_ - n.lastAttackTick < tuning_.attackCooldownTicks) continue;
      const SourceCredit* target = n.topSource();
      if (target == nullptr) continue;  // nothing fed it: nothing to attack
      AttackWave w = composeWave(n, *target);
      if (w.totalCount == 0) continue;
      n.attackBudget -= w.pollutionSpent;
      if (n.attackBudget < 0.0) n.attackBudget = 0.0;
      n.lastAttackTick = tick_;
      ++n.wavesDispatched;
      waves_.push_back(w);
    }
  }

  AttackWave composeWave(const Nest& n, const SourceCredit& target) {
    AttackWave w;
    w.id = nextWaveId_++;
    w.sourceNest = n.id;
    w.originDir = n.dir;
    w.targetEmitter = target.source;
    w.targetDir = target.lastKnownDir;
    w.evolutionAtDispatch = evo_.factor;
    w.dispatchTick = tick_;

    double budget = n.attackBudget;
    const double minCost = catalogue_.minCostAt(evo_.factor);
    if (!(minCost > 0.0)) return w;

    // Build the currently-unlocked pool with its evolution-scaled weights.
    struct Pick {
      const EnemyTypeDef* def;
      double weight;
    };
    std::vector<Pick> pool;
    for (const EnemyTypeDef& d : catalogue_.types()) {
      const double wgt = weightAtEvolution(d, evo_.factor);
      if (wgt > 0.0 && d.budgetCost > 0.0) pool.push_back({&d, wgt});
    }
    if (pool.empty()) return w;

    DetRng rng(worldgen::hashCombine(seed_, worldgen::mix64(
                   (static_cast<uint64_t>(n.id) << 32) ^ w.id)));
    std::vector<WaveMember> tally;
    uint32_t total = 0;
    while (budget >= minCost && total < tuning_.maxWaveSize && !pool.empty()) {
      double totalWeight = 0.0;
      for (const Pick& p : pool) totalWeight += p.weight;
      if (!(totalWeight > 0.0)) break;
      double roll = rng.nextUnit() * totalWeight;
      size_t picked = pool.size() - 1;
      for (size_t i = 0; i < pool.size(); ++i) {
        roll -= pool[i].weight;
        if (roll <= 0.0) {
          picked = i;
          break;
        }
      }
      const EnemyTypeDef* d = pool[picked].def;
      if (d->budgetCost > budget) {
        pool.erase(pool.begin() + static_cast<ptrdiff_t>(picked));
        continue;
      }
      budget -= d->budgetCost;
      ++total;
      bool found = false;
      for (WaveMember& m : tally) {
        if (m.typeId != d->id) continue;
        ++m.count;
        found = true;
        break;
      }
      if (!found) tally.push_back({d->id, 1});
    }
    if (total == 0) return w;

    std::sort(tally.begin(), tally.end(),
              [](const WaveMember& a, const WaveMember& b) {
                return a.typeId < b.typeId;
              });
    w.members = tally;
    w.totalCount = total;
    w.pollutionSpent = n.attackBudget - budget;
    for (const WaveMember& m : w.members) {
      const EnemyTypeDef* d = catalogue_.type(m.typeId);
      if (d == nullptr) continue;
      const double c = static_cast<double>(m.count);
      w.totalHealth += d->health * c;
      w.totalDamagePerSecond += d->damagePerSecond * c;
      if (w.slowestSpeedMps == 0.0 || d->speedMps < w.slowestSpeedMps)
        w.slowestSpeedMps = d->speedMps;
    }
    return w;
  }

  // ---- §6b spreading: the frontier moves, and it moves TOWARD the pollution.
  void expandStep(double dt) {
    const double idle = tuning_.expansionIdlePerSecond * evo_.factor * dt;
    const size_t before = nests_.size();
    for (size_t i = 0; i < before; ++i) {
      Nest& n = nests_[i];
      if (!n.alive) continue;
      n.expansionBudget += idle;
      if (n.expansionBudget < tuning_.expansionCost) continue;
      if (tick_ - n.lastExpandTick < tuning_.expansionCooldownTicks) continue;
      if (nests_.size() >= tuning_.maxNests) {
        ++nestPlacementsRefused_;
        continue;
      }
      Vec3 dest;
      if (!chooseExpansionSite(n, dest)) continue;
      n.expansionBudget -= tuning_.expansionCost;
      n.lastExpandTick = tick_;
      ++n.children;
      const uint32_t gen = n.generation + 1;
      // addNest() may reallocate nests_, so `n` must not be touched after this.
      addNest(dest, gen);
    }
  }

  bool chooseExpansionSite(const Nest& n, Vec3& out) const {
    // Fixed bearings on the local tangent plane. Constants, not sin/cos.
    constexpr double kR2 = 0.70710678118654752440;
    static constexpr double kBearing[8][2] = {
        {1, 0},  {kR2, kR2},   {0, 1},  {-kR2, kR2},
        {-1, 0}, {-kR2, -kR2}, {0, -1}, {kR2, -kR2}};
    const uint32_t count = tuning_.expansionCandidates == 0
                               ? 8u
                               : (tuning_.expansionCandidates > 8u
                                      ? 8u
                                      : tuning_.expansionCandidates);
    // Tangent basis. The polar axis is only a reference for "east"; at the pole
    // it degenerates, so fall back to a different axis there.
    Vec3 axis(0, 1, 0);
    if (std::fabs(n.dir.y) > 0.999) axis = Vec3(1, 0, 0);
    const Vec3 east = unitOf(crossOf(axis, n.dir));
    const Vec3 north = crossOf(n.dir, east);

    double bestPollution = -1.0;
    int bestIdx = -1;
    Vec3 bestDir;
    for (uint32_t k = 0; k < count; ++k) {
      const double dx = kBearing[k][0] * tuning_.expansionDistanceM;
      const double dy = kBearing[k][1] * tuning_.expansionDistanceM;
      // Chord step: normalise(dir*R + tangent). At 900 m on a 600 km body the
      // difference from a true great-circle step is ~3 mm, and it costs no
      // transcendental (EN-7).
      const Vec3 cand = unitOf(Vec3(n.dir.x * body_.radiusM + east.x * dx + north.x * dy,
                                    n.dir.y * body_.radiusM + east.y * dx + north.y * dy,
                                    n.dir.z * body_.radiusM + east.z * dx + north.z * dy));
      if (tooCloseToANest(cand)) continue;
      const double p = field_.amountAt(field_.cellOf(cand));
      if (p > bestPollution) {
        bestPollution = p;
        bestIdx = static_cast<int>(k);
        bestDir = cand;
      }
    }
    if (bestIdx < 0) return false;
    if (bestPollution <= 0.0) {
      // No pollution anywhere nearby: the frontier still creeps, but the
      // direction is a deterministic hash rather than "always east".
      DetRng rng(worldgen::hashCombine(
          seed_, worldgen::mix64((static_cast<uint64_t>(n.id) << 20) ^
                                 static_cast<uint64_t>(n.children) ^ 0x5EED1u)));
      const uint32_t start = static_cast<uint32_t>(rng.nextU64() % count);
      for (uint32_t s = 0; s < count; ++s) {
        const uint32_t k = (start + s) % count;
        const double dx = kBearing[k][0] * tuning_.expansionDistanceM;
        const double dy = kBearing[k][1] * tuning_.expansionDistanceM;
        const Vec3 cand =
            unitOf(Vec3(n.dir.x * body_.radiusM + east.x * dx + north.x * dy,
                        n.dir.y * body_.radiusM + east.y * dx + north.y * dy,
                        n.dir.z * body_.radiusM + east.z * dx + north.z * dy));
        if (tooCloseToANest(cand)) continue;
        out = cand;
        return true;
      }
      return false;
    }
    out = bestDir;
    return true;
  }

  bool tooCloseToANest(const Vec3& d) const {
    for (const Nest& other : nests_) {
      if (!other.alive) continue;
      if (chordDistanceM(d, other.dir, body_.radiusM) < tuning_.minNestSeparationM)
        return true;
    }
    return false;
  }

  worldgen::BodyParams body_;
  uint64_t seed_ = 0;
  EnemyTuning tuning_;
  EnemyCatalogue catalogue_;
  PollutionField field_;
  std::vector<Emitter> emitters_;
  std::vector<Nest> nests_;
  std::vector<AttackWave> waves_;
  EvolutionState evo_;
  uint64_t tick_ = 0;
  uint64_t pendingKills_ = 0;
  uint64_t nestPlacementsRefused_ = 0;
  EmitterId nextEmitterId_ = 1;
  NestId nextNestId_ = 1;
  WaveId nextWaveId_ = 1;
  double lastAbsorbed_ = 0.0;
  uint32_t lastAbsorbingNests_ = 0;
};

// =============================================================================
// §10 — Determinism hash and persistence.
//
// DW-17 puts the whole world in ONE atomic save, and a world that forgets its
// evolution factor on reload is broken — so this serialises EVERYTHING that
// step() reads, including the emitter/nest/wave id counters (reusing an id
// after a reload would silently mis-attribute a wave).
//
// Templated on the byte cursor, the voxel_terrain.h idiom, so this header does
// not include persistence.h and persistence.h does not need a new DomainId
// until Admin decides to add one. A caller passes of::persist::SaveWriter /
// SaveReader and it just works.
// =============================================================================
static constexpr uint64_t kEnemiesMagic = 0x4F464E31ull;  // 'OFN1'
static constexpr uint64_t kEnemiesVersion = 1;

inline uint64_t hashDouble(uint64_t h, double v) {
  return worldgen::hashCombine(h, worldgen::bitsOf(v));
}
inline uint64_t hashVec(uint64_t h, const Vec3& v) {
  return hashDouble(hashDouble(hashDouble(h, v.x), v.y), v.z);
}

inline uint64_t EnemySim::stateHash() const {
  uint64_t h = worldgen::mix64(kEnemiesMagic ^ tick_);
  h = worldgen::hashCombine(h, seed_);
  h = hashDouble(h, evo_.factor);
  h = hashDouble(h, evo_.fromTime);
  h = hashDouble(h, evo_.fromPollution);
  h = hashDouble(h, evo_.fromKills);
  h = hashDouble(h, evo_.secondsElapsed);
  h = hashDouble(h, evo_.pollutionAbsorbed);
  h = worldgen::hashCombine(h, evo_.nestsDestroyed);
  h = worldgen::hashCombine(h, nextEmitterId_);
  h = worldgen::hashCombine(h, nextNestId_);
  h = worldgen::hashCombine(h, nextWaveId_);
  for (const Emitter& e : emitters_) {
    h = worldgen::hashCombine(h, e.id);
    h = hashVec(h, e.dir);
    h = hashDouble(h, e.ratePerSecond);
    h = worldgen::hashCombine(h, e.active ? 1u : 0u);
  }
  for (const PollutionCellView& c : field_.cells()) {
    h = worldgen::hashCombine(h, c.key);
    h = hashDouble(h, c.amount);
    h = hashDouble(h, c.sourceAmount);
    h = worldgen::hashCombine(h, c.source);
  }
  for (const Nest& n : nests_) {
    h = worldgen::hashCombine(h, n.id);
    h = hashVec(h, n.dir);
    h = worldgen::hashCombine(h, n.generation);
    h = worldgen::hashCombine(h, n.alive ? 1u : 0u);
    h = hashDouble(h, n.health);
    h = hashDouble(h, n.absorbedLifetime);
    h = hashDouble(h, n.attackBudget);
    h = hashDouble(h, n.expansionBudget);
    h = worldgen::hashCombine(h, n.lastAttackTick);
    h = worldgen::hashCombine(h, n.lastExpandTick);
    h = worldgen::hashCombine(h, n.wavesDispatched);
    for (const SourceCredit& s : n.sources) {
      h = worldgen::hashCombine(h, s.source);
      h = hashDouble(h, s.absorbed);
      h = hashVec(h, s.lastKnownDir);
    }
  }
  for (const AttackWave& w : waves_) {
    h = worldgen::hashCombine(h, w.id);
    h = worldgen::hashCombine(h, w.sourceNest);
    h = worldgen::hashCombine(h, w.targetEmitter);
    h = hashDouble(h, w.pollutionSpent);
    h = hashVec(h, w.targetDir);
    for (const WaveMember& m : w.members)
      h = worldgen::hashCombine(h, (static_cast<uint64_t>(m.typeId) << 32) | m.count);
  }
  return h;
}

template <typename Writer>
void EnemySim::serialize(Writer& w) const {
  w.varint(kEnemiesMagic);
  w.varint(kEnemiesVersion);
  w.varint(tick_);
  w.varint(pendingKills_);
  w.varint(nextEmitterId_);
  w.varint(nextNestId_);
  w.varint(nextWaveId_);
  w.f64(lastAbsorbed_);
  w.varint(lastAbsorbingNests_);
  w.varint(nestPlacementsRefused_);

  w.f64(evo_.factor);
  w.f64(evo_.fromTime);
  w.f64(evo_.fromPollution);
  w.f64(evo_.fromKills);
  w.f64(evo_.secondsElapsed);
  w.f64(evo_.pollutionAbsorbed);
  w.varint(evo_.nestsDestroyed);

  w.varint(emitters_.size());
  for (const Emitter& e : emitters_) {
    w.varint(e.id);
    w.f64(e.dir.x);
    w.f64(e.dir.y);
    w.f64(e.dir.z);
    w.f64(e.ratePerSecond);
    w.u8(e.active ? 1 : 0);
  }

  field_.serialize(w);

  w.varint(nests_.size());
  for (const Nest& n : nests_) {
    w.varint(n.id);
    w.f64(n.dir.x);
    w.f64(n.dir.y);
    w.f64(n.dir.z);
    w.varint(n.generation);
    w.u8(n.alive ? 1 : 0);
    w.f64(n.health);
    w.f64(n.maxHealth);
    w.f64(n.absorbedLifetime);
    w.f64(n.attackBudget);
    w.f64(n.expansionBudget);
    w.varint(n.lastAttackTick);
    w.varint(n.lastExpandTick);
    w.varint(n.wavesDispatched);
    w.varint(n.children);
    w.varint(n.sources.size());
    for (const SourceCredit& s : n.sources) {
      w.varint(s.source);
      w.f64(s.absorbed);
      w.f64(s.lastKnownDir.x);
      w.f64(s.lastKnownDir.y);
      w.f64(s.lastKnownDir.z);
    }
  }

  w.varint(waves_.size());
  for (const AttackWave& a : waves_) {
    w.varint(a.id);
    w.varint(a.sourceNest);
    w.f64(a.originDir.x);
    w.f64(a.originDir.y);
    w.f64(a.originDir.z);
    w.f64(a.targetDir.x);
    w.f64(a.targetDir.y);
    w.f64(a.targetDir.z);
    w.varint(a.targetEmitter);
    w.f64(a.pollutionSpent);
    w.f64(a.evolutionAtDispatch);
    w.varint(a.dispatchTick);
    w.varint(a.totalCount);
    w.f64(a.totalHealth);
    w.f64(a.totalDamagePerSecond);
    w.f64(a.slowestSpeedMps);
    w.varint(a.members.size());
    for (const WaveMember& m : a.members) {
      w.varint(m.typeId);
      w.varint(m.count);
    }
  }
}

template <typename Reader>
void EnemySim::deserialize(Reader& r) {
  const uint64_t magic = r.varint();
  (void)magic;  // exact-match-or-refuse is the container's job (persistence.h)
  const uint64_t version = r.varint();
  (void)version;
  tick_ = r.varint();
  pendingKills_ = r.varint();
  nextEmitterId_ = static_cast<EmitterId>(r.varint());
  nextNestId_ = static_cast<NestId>(r.varint());
  nextWaveId_ = r.varint();
  lastAbsorbed_ = r.f64();
  lastAbsorbingNests_ = static_cast<uint32_t>(r.varint());
  nestPlacementsRefused_ = r.varint();

  evo_.factor = r.f64();
  evo_.fromTime = r.f64();
  evo_.fromPollution = r.f64();
  evo_.fromKills = r.f64();
  evo_.secondsElapsed = r.f64();
  evo_.pollutionAbsorbed = r.f64();
  evo_.nestsDestroyed = r.varint();

  emitters_.clear();
  uint64_t n = r.varint();
  for (uint64_t i = 0; i < n; ++i) {
    Emitter e;
    e.id = static_cast<EmitterId>(r.varint());
    e.dir.x = r.f64();
    e.dir.y = r.f64();
    e.dir.z = r.f64();
    e.ratePerSecond = r.f64();
    e.active = r.u8() != 0;
    emitters_.push_back(e);
  }

  field_.deserialize(r);

  nests_.clear();
  n = r.varint();
  for (uint64_t i = 0; i < n; ++i) {
    Nest t;
    t.id = static_cast<NestId>(r.varint());
    t.dir.x = r.f64();
    t.dir.y = r.f64();
    t.dir.z = r.f64();
    t.generation = static_cast<uint32_t>(r.varint());
    t.alive = r.u8() != 0;
    t.health = r.f64();
    t.maxHealth = r.f64();
    t.absorbedLifetime = r.f64();
    t.attackBudget = r.f64();
    t.expansionBudget = r.f64();
    t.lastAttackTick = r.varint();
    t.lastExpandTick = r.varint();
    t.wavesDispatched = r.varint();
    t.children = static_cast<uint32_t>(r.varint());
    const uint64_t sc = r.varint();
    for (uint64_t k = 0; k < sc; ++k) {
      SourceCredit s;
      s.source = static_cast<EmitterId>(r.varint());
      s.absorbed = r.f64();
      s.lastKnownDir.x = r.f64();
      s.lastKnownDir.y = r.f64();
      s.lastKnownDir.z = r.f64();
      t.sources.push_back(s);
    }
    nests_.push_back(t);
  }

  waves_.clear();
  n = r.varint();
  for (uint64_t i = 0; i < n; ++i) {
    AttackWave a;
    a.id = r.varint();
    a.sourceNest = static_cast<NestId>(r.varint());
    a.originDir.x = r.f64();
    a.originDir.y = r.f64();
    a.originDir.z = r.f64();
    a.targetDir.x = r.f64();
    a.targetDir.y = r.f64();
    a.targetDir.z = r.f64();
    a.targetEmitter = static_cast<EmitterId>(r.varint());
    a.pollutionSpent = r.f64();
    a.evolutionAtDispatch = r.f64();
    a.dispatchTick = r.varint();
    a.totalCount = static_cast<uint32_t>(r.varint());
    a.totalHealth = r.f64();
    a.totalDamagePerSecond = r.f64();
    a.slowestSpeedMps = r.f64();
    const uint64_t mc = r.varint();
    for (uint64_t k = 0; k < mc; ++k) {
      WaveMember m;
      m.typeId = static_cast<EnemyTypeId>(r.varint());
      m.count = static_cast<uint32_t>(r.varint());
      a.members.push_back(m);
    }
    waves_.push_back(a);
  }
}

// =============================================================================
// §11 — THE FACTORY-SIM HOOK. Published, not wired.
//
// factory_sim.h is owned by another lane tonight, so this is the contract
// rather than the call. What factory-sim has to do is exactly three things:
//
//   1. On BUILD of a machine at surface direction `dir` with type id `t`:
//          m.pollutionEmitter = enemies.addEmitter(dir, pollutionRateForMachine(t));
//   2. On the machine going idle / powered-down / removed:
//          enemies.setEmitterActive(id, false)   /  enemies.removeEmitter(id)
//   3. Optionally scale the rate by actual activity (a smelter that is not
//          smelting should not pollute):
//          enemies.setEmitterRate(id, pollutionRateForMachine(t) * dutyCycle);
//
// That is the WHOLE interface. It is deliberately three calls and no header
// dependency in either direction: enemies.h does not include factory_sim.h and
// factory_sim.h does not need to include enemies.h — the wiring lives in
// whatever composes them, the way automation.h composes factory_sim.h today.
//
// Rates are per machine per second, keyed by gameplay.h's EntityDef::typeId
// values (0x10..0x16). The numbers are data: a Generator burning fuel is the
// dominant polluter, which is what makes "build more power" the decision that
// brings the enemies, exactly as in Factorio. Belts, boxes and poles emit
// nothing, so a big logistics network is free of aggro.
// =============================================================================
struct MachinePollutionRow {
  uint16_t machineTypeId = 0;
  double perSecond = 0.0;
  const char* note = "";
};

inline const std::vector<MachinePollutionRow>& defaultMachinePollution() {
  static const std::vector<MachinePollutionRow> kRows = {
      {0x10, 1.0, "Miner — mechanical, modest"},
      {0x11, 0.0, "Belt — none"},
      {0x12, 2.0, "Smelter — heat"},
      {0x13, 1.5, "Assembler — process"},
      {0x14, 0.0, "Box — none"},
      {0x15, 6.0, "Generator — burning fuel is the dominant polluter"},
      {0x16, 0.0, "PowerPole — none"},
  };
  return kRows;
}

inline double pollutionRateForMachine(uint16_t machineTypeId) {
  for (const MachinePollutionRow& r : defaultMachinePollution())
    if (r.machineTypeId == machineTypeId) return r.perSecond;
  return 0.0;
}

}  // namespace enemies
}  // namespace of
