#pragma once
// =============================================================================
// discovery.h — what the player has SEEN of a body (WG-29, DW-36).
//
// DW-36 makes the map discoverable in survival: "you cannot see what you have
// never been to". That is WORLD state, not UI state, so it lives here beside the
// terrain it describes, it is deterministic, and it persists (DW-17).
//
// -----------------------------------------------------------------------------
// THE RULE, in one sentence, and it is a rule about SEEING rather than a radius
// somebody liked the look of:
//
//     A cell is discovered when the observer has been somewhere it was above
//     their horizon.
//
// The horizon is the sphere's own, so the radius is a consequence of altitude
// rather than a constant. Measured, as ground CHORDS on Forge: 1,428.3 m on
// foot, 108,642.9 m at 10 km up, 291,042.8 m at 80 km.
//
// (Those are the numbers `test_discovery.cpp` pins against the closed form. An
// earlier draft of this comment said "285 km", which was a recollection rather
// than a measurement and the suite caught it. Prose in a header is code that
// nothing compiles, so the test prints both the chord and the arc and the
// comment quotes the test.)
//
// That single rule has one problem, and it is the one Reid named: at 80 km one
// instant takes in 3.7% of Forge at a face centre and 7.5% at a cube corner
// (5.6% at an arbitrary site - the lattice is not equal-area, see below), and
// roughly 40% of it per orbit, so one lap would very nearly hand you the planet.
//
// THE ANSWER IS NOT A SMALLER RADIUS. It is that height buys EXTENT and costs
// RESOLUTION, which is how every real survey works and is the thing a single
// radius cannot express. So there are TWO grids, differing only in cell size and
// in how far one pass may reach:
//
//   * SURVEY  (coarse, ~9 km cells, horizon-limited, no cap). The shape of the
//     world. This is what the map SHADES. Orbit fills it in, and should.
//   * EXPLORE (fine, ~293 m cells, horizon-limited AND capped at 10 km). The
//     detail of the world: ore patches, and anything else worth finding. Walking
//     explores a 1.4 km disc; a 80 km orbit explores a 20 km-wide THREAD along
//     its ground track, which is 1.7% of Forge's AREA per lap and 1.2% of its
//     cell COUNT (the two differ because cells at a face centre are the biggest
//     ones, and a track that runs over face centres therefore spends fewer of
//     them for the same ground; neither number is a constant).
//
// So a lap of Forge gives you the continents and a stripe of detail under the
// track, and the ore in the next valley stays yours to find. That is the whole
// design, and both halves of Reid's constraint are met by ONE rule read at two
// resolutions rather than by two rules.
//
// EVERY NUMBER ABOVE IS IN DiscoveryTuning, with its derivation. There are no
// magic constants in the code paths (standing rule 11).
//
// -----------------------------------------------------------------------------
// NO TRANSCENDENTALS, ANYWHERE. CE-11/DW-15 name tan/asin/atan2/cos as a
// cross-toolchain hazard, and a 1 ULP difference here would flip a boundary cell
// and desync a SAVED set. It costs nothing to avoid, because both tests are
// algebraic:
//
//   horizon: a point at radius R is above the horizon of an observer at R+h
//            exactly when  dot(cellDir, obsDir) >= R / (R + h).
//   cap:     two unit directions separated by ground CHORD c satisfy
//            dot >= 1 - (c/R)^2 / 2.
//
// The cap is a chord and not an arc on purpose: at the 10 km cap on a 600 km
// body the two differ by 0.12 m, and the chord form is exact arithmetic while
// the arc form needs a cosine. This is the same trade enemies.h §4 took for the
// pollution lattice, for the same reason, and it is stated there in the same
// words: the grid does not need equal-area cells, it needs to be identical on
// every machine.
//
// -----------------------------------------------------------------------------
// THE LATTICE IS enemies.h's, DELIBERATELY AND CHECKED. SurfaceCellGrid below is
// the same raw-gnomonic cube-face grid PollutionField uses, with the same key
// packing, the same seam-crossing neighbour step and the same resolveBits. It is
// written out rather than included because enemies.h is the enemy MODEL and a
// spatial index should not drag it in, and because that header is another lane's.
//
// A second copy of a rule is exactly the failure this project has paid for five
// times, so it is not left as a claim: `test_discovery.cpp` includes BOTH headers
// and asserts the two lattices agree cell-for-cell over 200,000 directions and at
// every bit count they share. If either drifts, that test fails by name. The
// follow-up, which is not this lane's to make, is for enemies.h to adopt this
// grid so there is one copy rather than two agreeing ones.
//
// COST, and the claim is narrower than the obvious one. The FLOOD is O(cells in
// the disc) — O(AREA), and specifically NOT O(machines), O(ore patches) or
// O(vessels), because `observe` takes a direction and an altitude and cannot see
// an entity at all. Measured on Forge: 0.69 us on foot, 59 us at 10 km, 388 us
// at 80 km for the survey layer; the explore layer is capped so it costs about
// 420 us from any altitude above a kilometre. That is why the client samples at
// 1 Hz and not per frame.
//
// THE MERGE IS NOT O(AREA) AND SAYING IT WAS WOULD BE THE FALSE HALF. An earlier
// draft of this comment claimed re-observing known ground "merges nothing, so
// standing still is one dot product". The suite measured a warm pass costing
// 1.04x to 1.40x MORE than a cold one, because the cold store is empty and there
// is nothing to search. The TRUE property, which is what the test now asserts,
// is that a pass over known ground `added == 0` AND does not move the store's
// buffer — a `set_union` into a fresh vector must move it, so a no-op provably
// cannot have run. That is a structural check where a stopwatch would have been
// a threshold.
//
// What remains is a genuine and measured degradation in the SIZE of the known
// set: 557 us at 6.8k cells held, 1,890 us at 387k, so 56x the store for 3.39x
// the cost. Sublinear, asserted as such, and bounded — a fully lapped Forge is
// the worst case and it is 3.5 ms once a second. `mergeFound`'s cursor keeps the
// count loop off the log(N) path; collapsing the remaining `set_union` into the
// same walk is the next improvement and is not needed yet.
//
// Consumes cubed_sphere.h READ-ONLY (the face basis, which is the authority for
// what a face is) and nothing else. No terrain height, no solidity, no biome, no
// gameplay, no persistence.h.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <unordered_set>
#include <vector>

#include "of/cubed_sphere.h"
#include "of/vec3.h"

namespace of {
namespace worldgen {
namespace discovery {

using CellKey = uint64_t;
static constexpr CellKey kNoCell = ~uint64_t(0);

// Which of the two grids a question is about. Named, because "the fine one" and
// "the coarse one" is exactly the sort of shorthand that becomes a bug when a
// third resolution appears.
enum class Layer : uint8_t {
  Survey = 0,   // the shape of the world; what the map shades
  Explore = 1,  // the detail of the world; what gates an ore patch
};

// `!(len > 0)` rather than `len <= 0` so a NaN direction is REJECTED rather than
// normalised into a fixed face and silently discovering a real cell. enemies.h
// §1 makes the same point about the same trap.
inline Vec3 unitOfDir(const Vec3& v) {
  const double len = v.length();
  if (!(len > 0.0)) return Vec3(0, 0, 1);
  const double inv = 1.0 / len;
  return Vec3(v.x * inv, v.y * inv, v.z * inv);
}

// =============================================================================
// §1 — SurfaceCellGrid: the lattice.
//
// A cell is (cube face, i, j) on a 2^bits x 2^bits per-face grid, addressed
// through the RAW gnomonic face coordinate wu = dot(dir,right)/dot(dir,normal),
// NOT through cubed_sphere.h's equal-angle tan() warp. The warp gives nearly
// uniform cells; the raw projection gives cells up to 2.12x smaller in linear
// size at a face corner than at a face centre. That non-uniformity is the price
// of being transcendental-free and it is the right price to pay here.
//
// This is a SPATIAL INDEX and nothing else. It reads the cube-face basis and
// samples no field.
// =============================================================================
class SurfaceCellGrid {
 public:
  SurfaceCellGrid(double bodyRadiusM, double cellTargetM)
      : radiusM_(bodyRadiusM > 0.0 ? bodyRadiusM : 1.0),
        bits_(resolveBits(bodyRadiusM, cellTargetM)),
        side_(uint32_t(1) << bits_) {}

  uint32_t cellBits() const { return bits_; }
  uint32_t cellsPerFaceSide() const { return side_; }
  double bodyRadiusM() const { return radiusM_; }

  // Cell edge at a cube-face CENTRE. A face spans gnomonic wu in [-1,1] and at
  // the centre one unit of wu is one radian, so the edge is 2*R/side. At a face
  // CORNER it is up to 2.12x smaller; `cellSizeAtFaceCentreM` is the number to
  // quote and the only one that is ever quoted.
  double cellSizeAtFaceCentreM() const {
    return 2.0 * radiusM_ / static_cast<double>(side_);
  }

  // Total cells on the body if every one were touched. Not a capacity: the store
  // is sparse. It exists so a caller can say what fraction has been discovered.
  uint64_t totalCells() const {
    return 6ull * static_cast<uint64_t>(side_) * static_cast<uint64_t>(side_);
  }

  static uint32_t resolveBits(double radiusM, double targetM) {
    if (!(targetM > 0.0) || !(radiusM > 0.0)) return 14;
    const double want = 2.0 * radiusM / targetM;
    uint32_t b = 4;
    while (b < 24 &&
           static_cast<double>(uint64_t(1) << (b + 1)) <= want * 1.4142135623730951)
      ++b;
    return b;
  }

  // face in bits 56..58, i in 28..55, j in 0..27. Every field is MASKED, because
  // packKey is public and `packKey(face, i - 1, j)` with unsigned i == 0 is a
  // real caller idiom: an unmasked i would spill into the face field and keyFace
  // indexes a 6-element array with no bounds check.
  static constexpr uint64_t kIdxMask = 0x0FFFFFFFull;
  static CellKey packKey(int face, uint32_t i, uint32_t j) {
    return ((static_cast<uint64_t>(face) & 7ull) << 56) |
           ((static_cast<uint64_t>(i) & kIdxMask) << 28) |
           (static_cast<uint64_t>(j) & kIdxMask);
  }
  static int keyFace(CellKey k) {
    // 6 and 7 are unreachable from packKey(faceOfDir(...)) but ARE reachable
    // from a corrupt deserialize, and this value indexes a 6-element array.
    const int f = static_cast<int>((k >> 56) & 7ull);
    return f < 6 ? f : 0;
  }
  static uint32_t keyI(CellKey k) {
    return static_cast<uint32_t>((k >> 28) & kIdxMask);
  }
  static uint32_t keyJ(CellKey k) { return static_cast<uint32_t>(k & kIdxMask); }

  // Direction -> cell. Dot products, one divide, a floor. No transcendentals.
  CellKey cellOf(const Vec3& dir) const {
    const Vec3 d = unitOfDir(dir);
    const int f = faceOfDir(d);
    const FaceBasis& b = faceBasis(f);
    const double n = d.dot(b.normal);
    if (!(n > 0.0)) return packKey(f, 0, 0);  // cannot happen; defensive
    return packKey(f, binOf(d.dot(b.right) / n), binOf(d.dot(b.up) / n));
  }

  // Cell -> the direction of its centre. The raw gnomonic combination of the
  // face basis, deliberately NOT cubed_sphere.h::unitDir, which applies the
  // tan() warp this lattice is defined to avoid.
  Vec3 cellCentreDir(CellKey key) const {
    const int f = keyFace(key);
    const double inv = 1.0 / static_cast<double>(side_);
    const double wu = -1.0 + 2.0 * ((static_cast<double>(keyI(key)) + 0.5) * inv);
    const double wv = -1.0 + 2.0 * ((static_cast<double>(keyJ(key)) + 0.5) * inv);
    return faceDir(f, wu, wv);
  }

  // The 4 axis neighbours. Inside a face this is integer arithmetic; at a face
  // edge it steps geometrically to just past the edge and re-derives the cell,
  // which crosses the seam with no adjacency table and no rotation bookkeeping.
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
        const double wu = -1.0 + 2.0 * ((static_cast<double>(ii) + 0.5) * inv);
        const double wv = -1.0 + 2.0 * ((static_cast<double>(jj) + 0.5) * inv);
        out[k] = cellOf(faceDir(f, wu, wv));
      }
    }
  }

  // The cell's four corner directions, counter-clockwise in face (wu,wv) order:
  // (i,j), (i+1,j), (i+1,j+1), (i,j+1). A map draws the cell by projecting these
  // four rather than by stamping a square at `cellCentreDir`, and that matters:
  // the map's projection is ORTHOGRAPHIC, so a cell near the limb foreshortens to
  // a sliver and a square would paint discovered ground over undiscovered.
  void cellCorners(CellKey key, Vec3 out[4]) const {
    const int f = keyFace(key);
    const double inv = 1.0 / static_cast<double>(side_);
    const double u0 = -1.0 + 2.0 * (static_cast<double>(keyI(key)) * inv);
    const double v0 = -1.0 + 2.0 * (static_cast<double>(keyJ(key)) * inv);
    const double d = 2.0 * inv;
    out[0] = faceDir(f, u0, v0);
    out[1] = faceDir(f, u0 + d, v0);
    out[2] = faceDir(f, u0 + d, v0 + d);
    out[3] = faceDir(f, u0, v0 + d);
  }

  static Vec3 faceDir(int face, double wu, double wv) {
    const FaceBasis& b = faceBasis(face);
    return unitOfDir(Vec3(b.normal.x + wu * b.right.x + wv * b.up.x,
                          b.normal.y + wu * b.right.y + wv * b.up.y,
                          b.normal.z + wu * b.right.z + wv * b.up.z));
  }

 private:
  uint32_t binOf(double w) const {
    const double t = (w + 1.0) * 0.5 * static_cast<double>(side_);
    if (!(t > 0.0)) return 0;
    const double f = std::floor(t);
    if (f >= static_cast<double>(side_)) return side_ - 1;
    return static_cast<uint32_t>(f);
  }

  double radiusM_;
  uint32_t bits_;
  uint32_t side_;
};

// =============================================================================
// §2 — DiscoveryTuning: every number the rule uses, with its derivation.
// =============================================================================
struct DiscoveryTuning {
  // A survey cell is the size of a map feature you would name: a range, a bay.
  // 10 km on Forge resolves to a 128-per-face grid, 9,375 m cells, 98,304 cells
  // for the whole planet, so a fully surveyed world is bounded and small.
  double surveyCellTargetM = 10000.0;

  // An explore cell is the size of a thing you would walk to. 250 km resolves to
  // 4,096 per face, 293 m cells. A 9 m ore patch is far inside one, which is the
  // point: the fine grid says "you have been HERE", not "you have seen that".
  double exploreCellTargetM = 250.0;

  // The observer's eye above their own feet, added to the altitude handed in, so
  // that standing on the ground has a horizon at all. 1.7 m is the walker's eye
  // height and is not a free parameter.
  double eyeHeightM = 1.7;

  // The balance dial, and the ONLY one. 1.0 is the true geometric horizon, which
  // is the derived value and therefore the default; lowering it tightens both
  // layers together without changing the rule. It is here so that "discovery is
  // too generous" is a number to move rather than a branch to add.
  double horizonFraction = 1.0;

  // How far one EXPLORE pass may reach, as a ground chord in metres. This is
  // what turns an 80 km pass from "40% of the planet" into "a 20 km thread", and
  // it is one survey cell wide by construction rather than by taste: the coarse
  // grid is the resolution at which height has already bought you everything, so
  // it is the natural place for the fine grid to stop.
  double exploreMaxRadiusM = 10000.0;

  // The SURVEY layer's own cap. 0 means uncapped, which is the derived value:
  // the horizon already limits it, and capping the coarse layer would be the
  // second rule this design exists to avoid.
  double surveyMaxRadiusM = 0.0;

  // Cells one pass may VISIT before it gives up. Not a silent ceiling: a pass
  // that hits it reports `budgetHit`, the caller is expected to shout, and
  // test_discovery asserts a normal pass is nowhere near it. DW-28's rule, that
  // a resource which silently drops work when full is worse than one that fails.
  // 65,536 is two thirds of a fully surveyed Forge, so no legal pass reaches it.
  uint32_t maxCellsPerPass = 65536;
};

// What one pass did. Counts taken INSIDE the pass, never re-derived from its
// inputs, which is the navball lane's lesson: a field that is present and never
// fed must be distinguishable from a live one.
struct ObservePass {
  uint32_t visited = 0;   // cells the flood touched, accepted or not
  uint32_t accepted = 0;  // cells inside the disc
  uint32_t added = 0;     // of those, ones not already known
  bool budgetHit = false;
  double radiusChordM = 0.0;  // the disc this pass actually swept
  double cosMin = 1.0;        // the threshold it used
};

// =============================================================================
// §3 — DiscoveryGrid: one resolution's sparse set of discovered cells.
//
// STORAGE. A vector of keys sorted ascending. Sorted means deterministic
// iteration with no hash, a cache-friendly scan, O(log n) membership, and a byte
// stream that is a pure function of the SET rather than of the order it was
// filled in. Only discovered cells exist.
//
// THE FLOOD. From the observer's own cell, breadth-first through `neighbours`,
// accepting a cell when its centre passes the dot test. The queue is a plain
// FIFO vector and the neighbour order is fixed, so the traversal ORDER is
// deterministic; the visited marker is a hash set, which is safe precisely
// because it answers a membership question and never an ordering one. That
// distinction is load-bearing: it is what lets a truncated pass be deterministic
// too, so `budgetHit` cannot produce a different world on a different toolchain.
//
// The observer's own cell is seeded UNCONDITIONALLY. Without that, a disc
// smaller than one cell (which is every survey pass taken on foot) would
// discover nothing at all, and "I am standing in it" is the one claim discovery
// can always make.
// =============================================================================
class DiscoveryGrid {
 public:
  DiscoveryGrid(double bodyRadiusM, double cellTargetM, double maxRadiusM,
                uint32_t maxCellsPerPass)
      : grid_(bodyRadiusM, cellTargetM),
        maxRadiusM_(maxRadiusM),
        maxCellsPerPass_(maxCellsPerPass > 0 ? maxCellsPerPass : 1) {}

  const SurfaceCellGrid& grid() const { return grid_; }
  const std::vector<CellKey>& cells() const { return cells_; }
  size_t size() const { return cells_.size(); }
  bool empty() const { return cells_.empty(); }
  void clear() { cells_.clear(); }
  /** Exchange the whole set. Exists so `WorldDiscovery::deserialize` can be
   *  ALL-OR-NOTHING; see the note there. Not a general setter: it does not
   *  validate, so nothing but a rollback should call it. */
  void swapCells(std::vector<CellKey>& other) { cells_.swap(other); }

  bool has(CellKey key) const {
    return std::binary_search(cells_.begin(), cells_.end(), key);
  }
  bool hasDir(const Vec3& dir) const { return has(grid_.cellOf(dir)); }

  // Fraction of the body discovered at this resolution, in [0,1]. Honest at both
  // ends because `totalCells` is the lattice's own count.
  double fraction() const {
    const uint64_t t = grid_.totalCells();
    return t == 0 ? 0.0 : static_cast<double>(cells_.size()) /
                              static_cast<double>(t);
  }

  // THE THRESHOLD, and the whole geometry of the rule, in four lines of algebra.
  // `altM` is above the local surface; the eye height is added by the caller's
  // tuning before it arrives here.
  double cosMinFor(double heightM, double horizonFraction) const {
    const double R = grid_.bodyRadiusM();
    double h = heightM;
    if (!(h > 0.0)) h = 0.0;
    // The horizon: dot >= R/(R+h). Scaling the ANGLE by horizonFraction would
    // need a cosine, so scale the HEIGHT instead, which is monotone in the same
    // direction, is exact arithmetic, and is 1.0 by default anyway.
    double f = horizonFraction;
    if (!(f > 0.0)) f = 0.0;
    if (f > 1.0) f = 1.0;
    double cosMin = R / (R + h * f);
    if (maxRadiusM_ > 0.0) {
      // The cap, as a ground chord: dot >= 1 - (c/R)^2 / 2.
      const double u = maxRadiusM_ / R;
      const double capCos = 1.0 - 0.5 * u * u;
      if (capCos > cosMin) cosMin = capCos;
    }
    if (cosMin > 1.0) cosMin = 1.0;
    if (cosMin < -1.0) cosMin = -1.0;
    return cosMin;
  }

  // The ground chord this threshold corresponds to, for a report. Inverse of the
  // chord form above, and still transcendental-free.
  double chordFor(double cosMin) const {
    const double R = grid_.bodyRadiusM();
    double c2 = 2.0 * (1.0 - cosMin);
    if (!(c2 > 0.0)) c2 = 0.0;
    return R * std::sqrt(c2);
  }

  // ONE pass. Returns what it did; mutates only on `added > 0`.
  ObservePass observe(const Vec3& dirIn, double heightM, double horizonFraction) {
    ObservePass rep;
    const Vec3 dir = unitOfDir(dirIn);
    const double cosMin = cosMinFor(heightM, horizonFraction);
    rep.cosMin = cosMin;
    rep.radiusChordM = chordFor(cosMin);

    found_.clear();
    queue_.clear();
    seen_.clear();

    const CellKey seed = grid_.cellOf(dir);
    queue_.push_back(seed);
    seen_.insert(seed);
    found_.push_back(seed);  // unconditional: you are standing in it
    rep.visited = 1;
    rep.accepted = 1;

    CellKey nb[4];
    for (size_t head = 0; head < queue_.size(); ++head) {
      const CellKey cur = queue_[head];
      grid_.neighbours(cur, nb);
      for (int k = 0; k < 4; ++k) {
        if (!seen_.insert(nb[k]).second) continue;
        rep.visited += 1;
        if (rep.visited >= maxCellsPerPass_) { rep.budgetHit = true; break; }
        if (grid_.cellCentreDir(nb[k]).dot(dir) < cosMin) continue;
        rep.accepted += 1;
        found_.push_back(nb[k]);
        queue_.push_back(nb[k]);
      }
      if (rep.budgetHit) break;
    }

    rep.added = mergeFound();
    return rep;
  }

  // GP-716. EVERY CELL AT ONCE. Returns how many were NEW.
  //
  // THIS IS NOT AN OBSERVATION AND IT DOES NOT PRETEND TO BE ONE. `observe` is
  // the rule about SEEING and every cell it accepts was above somebody's
  // horizon. This is a different authority: a survey handed over, the whole
  // shape of the world arriving at once because of something that happened in
  // the fiction rather than because of where an eye was. Modelling it as a
  // flood from an impossible altitude was the alternative and it is worse in
  // three measurable ways, all of which are why this exists instead: one
  // `observe` can never exceed a HEMISPHERE (cosMin bottoms out at R/(R+h) -> 0),
  // so it would take six of them; six passes at a face centre each drag the
  // EXPLORE layer's capped 10 km disc along with them, handing out six patches
  // of ore detail on ground nobody has walked; and a hemispherical flood on this
  // lattice visits ~49k cells against a 65,536 budget, so on any body bigger
  // than Forge at the same cell target it would trip `budgetHit` and reveal
  // PART of the world with nothing but a flag to say so.
  //
  // THE KEYS COME OUT ASCENDING FOR FREE, which is the whole reason this is four
  // lines rather than a fill-then-sort. `packKey` lays face in bits 56..58, i in
  // 28..55 and j in 0..27, and `resolveBits` caps bits at 24, so side <= 2^24
  // and both indices fit their fields with room to spare. Iterating face, then
  // i, then j therefore emits keys in strictly increasing order by construction,
  // which is exactly the invariant `cells_` is required to hold and every
  // `binary_search` here depends on.
  //
  // IT REPLACES RATHER THAN MERGES, and that is not a shortcut: the full set is
  // a superset of every possible prior set, so `set_union` could only ever
  // produce this same vector at the cost of building it twice.
  uint32_t fillAll() {
    const uint64_t total = grid_.totalCells();
    const uint32_t before = static_cast<uint32_t>(cells_.size());
    if (static_cast<uint64_t>(before) >= total) return 0;
    const uint32_t side = grid_.cellsPerFaceSide();
    std::vector<CellKey> all;
    all.reserve(static_cast<size_t>(total));
    for (int f = 0; f < 6; ++f)
      for (uint32_t i = 0; i < side; ++i)
        for (uint32_t j = 0; j < side; ++j)
          all.push_back(SurfaceCellGrid::packKey(f, i, j));
    cells_.swap(all);
    return static_cast<uint32_t>(cells_.size()) - before;
  }

  // ---- persistence ----------------------------------------------------------
  //
  //   [varint kMagic][varint kVersion][varint bits][varint count]
  //   { [varint (key - previousKey)] }
  //
  // Keys ascend, so the stream is DELTA-encoded and each cell costs one or two
  // varint bytes instead of a packed eight. That is not a micro-optimisation: a
  // fully explored region is tens of thousands of cells and this is the
  // difference between a save that is a few KB and one that is hundreds.
  //
  // `bits` is written so a reader can REFUSE a stream cut at a different cell
  // size rather than silently reinterpreting the keys as a different lattice,
  // which would place the discovered world somewhere else entirely.
  //
  // Templated over the SaveWriter / SaveReader cursors WITHOUT including
  // persistence.h, so this header stays leaf, exactly as voxel_field.h does.
  // Returns false for "not my stream" rather than throwing, same as DensityField.
  static constexpr uint64_t kMagic = 0x4F464453ull;  // 'OFDS'
  static constexpr uint64_t kVersion = 1;

  template <typename Writer>
  void serialize(Writer& w) const {
    w.varint(kMagic);
    w.varint(kVersion);
    w.varint(static_cast<uint64_t>(grid_.cellBits()));
    w.varint(static_cast<uint64_t>(cells_.size()));
    uint64_t prev = 0;
    for (CellKey k : cells_) {
      w.varint(k - prev);  // cells_ is sorted ascending, so this never wraps
      prev = k;
    }
  }

  template <typename Reader>
  bool deserialize(Reader& r) {
    const uint64_t magic = r.varint();
    if (magic == 0) { clear(); return true; }  // the legal empty stream
    if (magic != kMagic) return false;
    const uint64_t version = r.varint();
    if (version != kVersion) return false;
    const uint64_t bits = r.varint();
    const uint64_t n = r.varint();
    if (bits != static_cast<uint64_t>(grid_.cellBits())) {
      // A stream from a different lattice. Consume it so the cursor is left
      // where the caller expects, then refuse: reading it would place the
      // discovered world somewhere it never was, which is worse than losing it.
      uint64_t prev = 0;
      for (uint64_t i = 0; i < n; ++i) prev += r.varint();
      (void)prev;
      clear();
      return false;
    }
    cells_.clear();
    // RESERVE AGAINST THE LATTICE, NOT AGAINST THE STREAM. `n` is a varint off
    // a save file, so it can say 2^64 - 1; reserving that throws bad_alloc
    // before a single key has been looked at, which turns a corrupt save into a
    // crash rather than into a refusal. The set can never legitimately exceed
    // the lattice's own cell count, so that is the honest ceiling, and a stream
    // claiming more is refused below when its deltas fail to ascend.
    const uint64_t cap = grid_.totalCells();
    cells_.reserve(static_cast<size_t>(n < cap ? n : cap));
    uint64_t prev = 0;
    bool ascending = true;
    for (uint64_t i = 0; i < n; ++i) {
      const uint64_t d = r.varint();
      const uint64_t next = prev + d;
      // A corrupt stream must not leave an UNSORTED vector, because every query
      // here is a binary search and would then answer wrongly rather than
      // loudly. The delta is allowed to be 0 only for the first cell, AND the
      // accumulator must not have WRAPPED: a hostile delta near 2^64 makes
      // `prev` go backwards with d != 0, which a `d == 0` test alone waves
      // through. `next <= prev` is the one comparison that catches both, and it
      // is exactly free on the legal path (deltas are strictly positive there,
      // so this is never taken). test_discovery.cpp pins it with a hand-built
      // wrapping stream.
      if (i > 0 && next <= prev) ascending = false;
      prev = next;
      cells_.push_back(prev);
    }
    if (!ascending) {
      std::sort(cells_.begin(), cells_.end());
      cells_.erase(std::unique(cells_.begin(), cells_.end()), cells_.end());
    }
    return true;
  }

 private:
  // Merge this pass's accepted cells into the sorted store. Returns how many
  // were NEW. Costs nothing at all when the pass found only ground already held,
  // which is the common case and is why standing still is free.
  uint32_t mergeFound() {
    if (found_.empty()) return 0;
    std::sort(found_.begin(), found_.end());
    found_.erase(std::unique(found_.begin(), found_.end()), found_.end());
    // Count first, so the common "nothing new" case allocates and copies nothing.
    // ONE ADVANCING CURSOR, not a fresh binary search per key. Both ranges are
    // sorted ascending, so each search may start where the last one stopped:
    // the count is O(F log(N/F)) instead of O(F log N), and on the common case
    // (a pass entirely inside ground already held) it degenerates to a single
    // forward walk. The suite measured a warm pass costing MORE than a cold one
    // because a cold store is empty and a warm one is not, which is what this
    // removes most of; the remaining cost is the set_union below, and that only
    // runs when something is actually new.
    uint32_t fresh = 0;
    auto cur = cells_.begin();
    for (CellKey k : found_) {
      cur = std::lower_bound(cur, cells_.end(), k);
      if (cur == cells_.end() || *cur != k) ++fresh;
    }
    if (fresh == 0) return 0;
    merged_.clear();
    merged_.reserve(cells_.size() + fresh);
    std::set_union(cells_.begin(), cells_.end(), found_.begin(), found_.end(),
                   std::back_inserter(merged_));
    cells_.swap(merged_);
    return fresh;
  }

  SurfaceCellGrid grid_;
  double maxRadiusM_;
  uint32_t maxCellsPerPass_;
  std::vector<CellKey> cells_;
  // Pass scratch, kept as members so a 1 Hz pass does not allocate.
  std::vector<CellKey> found_;
  std::vector<CellKey> queue_;
  std::vector<CellKey> merged_;
  std::unordered_set<CellKey> seen_;
};

// =============================================================================
// §4 — WorldDiscovery: the two layers, and the ONE call that feeds both.
//
// Two named questions rather than one boolean with a resolution argument, for
// GameMode.ts's stated reason: a branch written months later gets the right
// answer without anybody remembering which layer it meant.
// =============================================================================
class WorldDiscovery {
 public:
  WorldDiscovery(double bodyRadiusM, const DiscoveryTuning& t = DiscoveryTuning())
      : tuning_(t),
        survey_(bodyRadiusM, t.surveyCellTargetM, t.surveyMaxRadiusM,
                t.maxCellsPerPass),
        explore_(bodyRadiusM, t.exploreCellTargetM, t.exploreMaxRadiusM,
                 t.maxCellsPerPass) {}

  const DiscoveryTuning& tuning() const { return tuning_; }
  const DiscoveryGrid& survey() const { return survey_; }
  const DiscoveryGrid& explore() const { return explore_; }
  DiscoveryGrid& surveyMut() { return survey_; }
  DiscoveryGrid& exploreMut() { return explore_; }

  /** The body this field is currently cut for. Not necessarily the radius it was
   *  CONSTRUCTED at: `deserialize` moves it to the stream's (see below). Read it
   *  to ask "which body is this field about?" rather than assuming. */
  double bodyRadiusM() const { return survey_.grid().bodyRadiusM(); }

  void clear() { survey_.clear(); explore_.clear(); observations_ = 0; }
  uint64_t observations() const { return observations_; }

  /** Has the SHAPE of the world here been seen? What the map shades. */
  bool surveyed(const Vec3& dir) const { return survey_.hasDir(dir); }
  /** Has the DETAIL here been seen? What gates an ore patch. */
  bool explored(const Vec3& dir) const { return explore_.hasDir(dir); }

  /** One observation. `altM` is height above the local surface; the eye height
   *  is added here, in the one place, so no caller has to remember it. */
  void observe(const Vec3& dir, double altM, ObservePass& outSurvey,
               ObservePass& outExplore) {
    double h = altM + tuning_.eyeHeightM;
    if (!(h > tuning_.eyeHeightM)) h = tuning_.eyeHeightM;
    outSurvey = survey_.observe(dir, h, tuning_.horizonFraction);
    outExplore = explore_.observe(dir, h, tuning_.horizonFraction);
    observations_ += 1;
  }

  /**
   * GP-716. REVEAL ONE LAYER ENTIRELY. Returns the cells it added.
   *
   * ONE LAYER AND NOT BOTH, taken as an argument rather than assumed, because
   * the two layers answer different questions and a caller that wanted "the
   * whole map" almost certainly did not mean "and every ore patch on the
   * planet". The SURVEY layer is the shape of the world and is what a handed-
   * over survey would contain; the EXPLORE layer is the detail you get by
   * walking there, and it is the one that gates a patch. `observe` feeds both
   * from one call because one RULE covers both; this is not that rule, so it
   * does not inherit that coupling.
   *
   * `observations_` IS DELIBERATELY NOT BUMPED. It counts `observe` calls, and
   * `of_disc_report[12]` publishes it as such; incrementing it here would make
   * a reveal indistinguishable from somebody having looked, in the one counter
   * that exists to say how much looking has happened.
   */
  uint32_t reveal(Layer layer) {
    return layer == Layer::Explore ? explore_.fillAll() : survey_.fillAll();
  }

  // ---- persistence ---------------------------------------------------------
  //
  //   [varint kWorldMagic][varint kWorldVersion][f64 bodyRadiusM]
  //   [survey layer][explore layer]
  //
  // THE STREAM IS SELF-DESCRIBING, AND THE REASON IS BOOT ORDER RATHER THAN
  // TIDINESS. A layer stream carries `bits`, which says what the keys mean but
  // not what body they are on, so a reader had to be told the radius by
  // somebody else BEFORE it could read. That made loading order-dependent: in
  // the browser the save is applied while the world is still coming up, before
  // anything has said which planet this is, so the field did not exist yet, the
  // load refused, and the freshly built empty field was then written back over
  // the save by the next autosave. What the player had explored was lost, and
  // permanently. Measured: `reload.mjs --phase=ground` reported
  // `restored.discovery = -1` while the in-page save/load round trip passed.
  //
  // Carrying the radius in the BYTES removes the dependency instead of managing
  // it: `deserialize` below rebuilds both lattices at the stream's radius when
  // it differs, so a load may happen before anything has told the field which
  // body it is on. THAT is what makes the boot order not matter, and it is why
  // the radius is here rather than in a caller's argument.
  //
  // The format is UNRELEASED — nothing has ever been saved with it in a shipped
  // build — so it was changed outright rather than versioned around.
  static constexpr uint64_t kWorldMagic = 0x4F464457ull;  // 'OFDW'
  static constexpr uint64_t kWorldVersion = 1;

  template <typename Writer>
  void serialize(Writer& w) const {
    w.varint(kWorldMagic);
    w.varint(kWorldVersion);
    w.f64(bodyRadiusM());
    survey_.serialize(w);
    explore_.serialize(w);
  }

  /**
   * ALL OR NOTHING, and this is a fix rather than a nicety.
   *
   * The first version ran survey then explore and returned `a && b`, which put
   * a HALF-LOADED world behind a `false`: a stream whose survey half read and
   * whose explore half was cut at a different cell size left the coarse map
   * filled in and the fine map empty while the caller was told the load had
   * failed. A caller that then reset would be right; a caller that carried on
   * would be showing a world that never existed, and nothing would say so.
   *
   * It also stopped at the wrong place. A magic mismatch does NOT consume the
   * layer's payload, because the length was never read, so the cursor is
   * untrustworthy from that byte on and the second layer would deserialize
   * whatever bytes happened to be next. So: survey failing aborts BEFORE explore
   * is attempted, and either failure restores both layers to what they were.
   *
   * THE PREAMBLE OBEYS THE SAME RULE, and the rollback got wider with it. A
   * stream at a different radius REBUILDS both lattices before the layers are
   * read, so a refusal after that point has to put the LATTICE back as well as
   * the keys — restoring the cells into the wrong grid would be exactly the
   * "world that never existed" this method exists to prevent. `keepR` is what
   * makes that possible and is the only reason it is captured.
   *
   * A wrong magic is refused WITHOUT consuming a payload it cannot measure (the
   * length lives after the magic), so the cursor stops on the first byte the
   * caller can still reason about.
   *
   * The cost is one copy of two key vectors on a path taken once per load.
   */
  template <typename Reader>
  bool deserialize(Reader& r) {
    if (r.varint() != kWorldMagic) return false;   // not ours; nothing touched
    if (r.varint() != kWorldVersion) return false;
    const double streamR = r.f64();

    const double keepR = bodyRadiusM();
    std::vector<CellKey> keepS = survey_.cells();
    std::vector<CellKey> keepE = explore_.cells();
    // Exact comparison on purpose: both sides are the SAME body constant, one
    // of them through an f64 round trip that is bit-exact by construction
    // (persistence.h writes the IEEE-754 bits). A tolerance here would be a
    // second, fuzzier answer to "is this the same body".
    const bool rebuilt = (streamR > 0.0) && (streamR != keepR);
    if (rebuilt) rebuildAt(streamR);

    if (!survey_.deserialize(r) || !explore_.deserialize(r)) {
      if (rebuilt) rebuildAt(keepR);
      survey_.swapCells(keepS);
      explore_.swapCells(keepE);
      return false;
    }
    return true;
  }

 private:
  /** Cut both layers fresh at `radiusM`, keeping the tuning. The tuning is
   *  already held, so the lattice is the only thing the radius decides. */
  void rebuildAt(double radiusM) {
    survey_ = DiscoveryGrid(radiusM, tuning_.surveyCellTargetM,
                            tuning_.surveyMaxRadiusM, tuning_.maxCellsPerPass);
    explore_ = DiscoveryGrid(radiusM, tuning_.exploreCellTargetM,
                             tuning_.exploreMaxRadiusM, tuning_.maxCellsPerPass);
  }

  DiscoveryTuning tuning_;
  DiscoveryGrid survey_;
  DiscoveryGrid explore_;
  uint64_t observations_ = 0;
};

}  // namespace discovery
}  // namespace worldgen
}  // namespace of
