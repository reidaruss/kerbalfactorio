// Headless tests for the SINGLE SURFACE AUTHORITY (surface_field.h, WG-21) : the
// "surface oracle" that replaces the five competing surface definitions.
// Proves:
//   - oracle BASE is DESIGNED everywhere unedited, bit-identical (baseHeight ==
//     sampleDesignedHeight).
//   - VOXEL SOLIDITY is consistent with the oracle base: a point just UNDER the
//     DESIGNED surface is solid, a point just above is air (the old raw/designed
//     gap case: a cell between raw and designed used to be misclassified).
//   - digging a voxel COLUMN drops surfaceHeight, and derivedLoweringAt is
//     exactly baseHeight minus surfaceHeight (the two views cannot disagree).
//   - the ONE bedrock clamp is honoured from the single definition.
//   - a horizontal TUNNEL below the surface produces NO surface lowering (the
//     topmost crossing has not moved, so the ceiling/heightfield is intact).
//   - determinism: same (body, edits) -> same surface bits.
// WG-22 adds the TERRAFORMING half: fill is representable at all, it raises the
// same one surface, dig and fill are inverses, and levelArea flattens a disc and
// only that disc.
//
// WG-24 PORT. The edit store underneath this oracle changed from VoxelEdits (two
// sparse sets of CELL ids, binary occupancy) to DensityField (a sparse SIGNED
// DISTANCE per lattice CORNER, voxel_field.h), meshed by surface nets. Every
// PROPERTY above survives; some of the NUMBERS could not, and each one that moved
// is re-baselined in place with a comment saying what it counts now. The three
// classes of legitimate movement are:
//
//   * COUNTS. A cell brush counted cells; a field brush writes CORNERS, and a
//     0.87 m carve at a cell centre writes the 8 corners of that cell plus the
//     shell of corners one cell out (whose signed distance to the carved sphere
//     genuinely changed). removedCount/addedCount become airCount/rockCount over
//     corners, so the numbers are larger and are re-measured rather than derived.
//   * EXACT METRES. The old model quantised the surface to whole cells, so "dug 3
//     cells, therefore the surface dropped exactly 3.0 m" held by construction.
//     A dig is now a SPHERE and the surface drops by what the sphere removed, so
//     those become measured bounds. Each is printed, in the style of
//     test_voxel_field.cpp, because a bound nobody can see is a bound nobody can
//     audit.
//   * FLOOR THICKNESS. A 1-cell-thick floor between two carved cells has ALL
//     EIGHT of its corners inside those two carves, so on a corner-sampled field
//     it cannot exist. pit_lowers_only_to_first_solid therefore leaves a TWO-cell
//     floor. The property (an isolated pocket under intact rock does not deepen
//     the heightfield) is unchanged; only the geometry proving it is thickened.
//
// What did NOT move, and must not: baseHeight is bit-identical to
// sampleDesignedHeight; surfaceHeight with an EMPTY field is bit-identical to
// baseHeight; the ONE bedrock clamp at 80 m and its WG-22 fill mirror at 24 m;
// determinism of both the bits and the serialized bytes.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/voxel_terrain.h"
#include "of/voxel_field.h"
#include "of/surface_field.h"
#include "of/surface_nets.h"

using namespace of;
using namespace of::worldgen;

namespace {

// The byte cursor the serializer is templated over. Written out here rather than
// pulled from persistence.h so this suite stays leaf and cannot be broken by
// churn in a header it does not test; the shape is persistence.h's SaveWriter /
// SaveReader varint pair exactly, which is what the WASM bridge passes.
struct ByteWriter {
  std::vector<uint8_t> buf;
  void varint(uint64_t v) {
    while (v >= 0x80) { buf.push_back(uint8_t(v) | 0x80u); v >>= 7; }
    buf.push_back(uint8_t(v));
  }
};
struct ByteReader {
  const std::vector<uint8_t>& b;
  size_t i = 0;
  explicit ByteReader(const std::vector<uint8_t>& v) : b(v) {}
  uint64_t varint() {
    uint64_t v = 0;
    int s = 0;
    while (i < b.size()) {
      const uint8_t c = b[i++];
      v |= uint64_t(c & 0x7f) << s;
      if (!(c & 0x80)) break;
      s += 7;
    }
    return v;
  }
};

uint64_t asBits(double d) {
  uint64_t u = 0;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}

// A direction safely on open surface (away from cube seams) for digging.
Vec3 sampleDir() { return latLonToDir(0.20, 0.55); }

// -----------------------------------------------------------------------------
// The WG-24 stand-in for VoxelEdits::digCell / fillCell. A signed field has no
// single-cell carve, because a cell is not the unit of storage any more: the
// corners are. 0.87 m is half a cell diagonal rounded up (0.8660 -> 0.87), so a
// sphere of that radius about a cell centre drives all EIGHT of that cell's
// corners just negative and the cell's own centre samples as air, while the next
// cell out keeps a positive mean and stays rock. That is the closest thing the
// field has to "carve exactly this cell", and using it everywhere the old file
// said digCell keeps the ported cases geometrically comparable.
//
// Returns the number of CELLS whose solidity flipped, the same unit the old
// whole-cell brush returned.
// -----------------------------------------------------------------------------
constexpr double kCellBrushR = 0.87;

int digCell(const BodyParams& body, DensityField& f, const VoxelCell& c) {
  return f.digSphere(body, cellCenter(c), kCellBrushR);
}
int fillCell(const BodyParams& body, DensityField& f, const VoxelCell& c) {
  return f.fillSphere(body, cellCenter(c), kCellBrushR);
}

// -----------------------------------------------------------------------------
// The first `n` DISTINCT cells along a radial, walking outward from `fromR` in
// the direction `step` (-1 down into the rock, +1 up into the air).
//
// The old file wrote `cellForPos(u * (surfR - (k + 0.5)))` for k = 0..N-1 and
// called that "the top N cells". It is not: stepping 1 m along a radial that is
// not axis-aligned regularly lands twice in the same 1 m cell, and MEASURED at
// sampleDir() k=4 and k=5 are the same cell going down, and k=0 and k=1 are the
// same cell going up. On the cell model that was harmless, because digCell on an
// already-dug cell was a no-op and removedCount counted a SET. On the field it is
// not harmless: the second carve reports zero cells flipped, and a case that
// asserts "this cell was solid and is now air" tests the wrong cell. So the port
// takes the DISTINCT cells, which is what the old file meant.
// -----------------------------------------------------------------------------
void columnCells(const Vec3& u, double fromR, int step, size_t n,
                 std::vector<VoxelCell>& out) {
  for (int k = 0; out.size() < n && k < 400; ++k) {
    const VoxelCell c =
        cellForPos(u * (fromR + step * (k + 0.5) * kVoxelSizeM));
    bool seen = false;
    for (size_t i = 0; i < out.size(); ++i) if (out[i] == c) { seen = true; break; }
    if (!seen) out.push_back(c);
  }
}

// -----------------------------------------------------------------------------
// WG-250. THE THREE THINGS EVERY DIG CASE BELOW NEEDS SO IT CAN ASSERT OVER N
// GROUNDS INSTEAD OF ONE.
//
// WG-240 measured what a one-ground dig bracket costs. Sweeping a height-field
// amplitude over nine values -- nine unbiased samples of the ground the fixture
// sits on -- the two dig brackets in this file failed at EVERY nonzero
// amplitude, 2 to 6 checks a run, not because a carve broke but because the
// voxel lattice landed differently under the same radial. Any change to the
// planet height field therefore turned this suite red for a reason unrelated
// to the change, which is a freeze on the field (world-gen.md R21 / 6.11.7).
//
// The brackets that replace them are computed from the BRUSH and the LATTICE at
// each ground, never read off a measurement, and the tolerance on each one is
// the instrument's own resolution rather than slack.
// -----------------------------------------------------------------------------

// THE ROOT FIND'S OWN RESOLUTION, and it is quoted rather than guessed:
// `columnSurfaceHeight` marches one cell at a time, then bisects only until its
// bracket is a QUARTER of a cell (voxel_field.h, "(rA - rB) > 0.25 *
// kVoxelSizeM") and chords across whatever is left. Every height it returns
// therefore carries a quarter of a cell of its own, so every bound derived
// against a height gets exactly that much tolerance and no more.
constexpr double kRootFindBracketM = 0.25 * kVoxelSizeM;

// Half a cell diagonal: the DW-26 quantisation of "carve exactly this cell",
// and the radius kCellBrushR is rounded up from.
const double kHalfCellDiagM = 0.5 * std::sqrt(3.0) * kVoxelSizeM;

// N GROUNDS. Ground 0 is the historical fixture site so nothing that used to be
// covered stops being covered; the rest are a Fibonacci spread over the WHOLE
// body, which is the only cheap construction that cannot alias into re-sampling
// the same patch under a different index.
Vec3 groundDir(int i, int n) {
  if (i == 0) return unitOf(latLonToDir(0.20, 0.55));
  const double zz = -1.0 + 2.0 * (static_cast<double>(i) - 0.5) /
                              static_cast<double>(n - 1);
  const double rr = std::sqrt(std::max(0.0, 1.0 - zz * zz));
  const double ph = static_cast<double>(i) * 2.39996322972865332;
  return unitOf(Vec3(rr * std::cos(ph), zz, rr * std::sin(ph)));
}

// Signed distance along the radial through `u` to a point.
double alongRadial(const Vec3& u, const Vec3& p) {
  return p.x * u.x + p.y * u.y + p.z * u.z;
}

// THE GUARANTEED-AIR RUN, and this is the whole lower-bound derivation.
//
// kCellBrushR is 0.87 m and every one of a cell's eight corners is exactly
// 0.8660 m from its centre, so a carve at a cell centre drives all eight
// negative and the TRILINEAR field is air throughout that cell, with no appeal
// to any measurement. Marching the radial down from the surface, the contiguous
// run of CARVED cells it passes through is therefore air, and the topmost
// crossing must lie at or below the bottom of that run.
//
// It is deliberately CONSERVATIVE. Where the radial leaves the carved set
// immediately below the surface the run is zero and the bound says nothing at
// that ground, which is honest: nothing is guaranteed there. Roughly two
// grounds in five are informative, and the count is printed every run.
double guaranteedAirRunM(const Vec3& u, double surfR,
                         const std::vector<VoxelCell>& carved) {
  const double dr = 0.002;
  double depth = 0.0;
  for (int i = 0; i < 20000; ++i) {
    const double r = surfR - (i + 0.5) * dr;
    const VoxelCell c = cellForPos(u * r);
    bool in = false;
    for (size_t k = 0; k < carved.size(); ++k) if (carved[k] == c) { in = true; break; }
    if (!in) break;
    depth = surfR - r;
  }
  return depth;
}

// THE UPPER BOUND, also purely geometric. `digSphere` writes `min(d, |p-c|-R)`,
// which is non-negative outside the sphere, so no corner beyond R of a carve
// centre is ever made air. The deepest crossing is therefore R below the
// deepest carve centre, plus the half cell diagonal that separates a corner
// from the cell it bounds.
double carveDepthCapM(const Vec3& u, double surfR,
                      const std::vector<VoxelCell>& carved, double brushR) {
  double deepest = 1e300;
  for (size_t k = 0; k < carved.size(); ++k)
    deepest = std::min(deepest, alongRadial(u, cellCenter(carved[k])));
  return (surfR - deepest) + brushR + kHalfCellDiagM;
}

// "Procedurally solid but now air" / "procedurally air but now solid": the two
// questions VoxelEdits::isRemoved / isAdded used to answer off a cell-id set.
bool isRemovedCell(const BodyParams& body, const DensityField& f,
                   const VoxelCell& c) {
  return isProcSolid(body, c) && !f.solidCell(body, c);
}
bool isAddedCell(const BodyParams& body, const DensityField& f,
                 const VoxelCell& c) {
  return !isProcSolid(body, c) && f.solidCell(body, c);
}

// WG-250. THE TOPMOST CELL THE UNEDITED FIELD CALLS ROCK, AND THE LOWEST IT
// CALLS AIR, ASKED AS PROPERTIES RATHER THAN COUNTED OFF A GRID.
//
// `columnCells(u, surfR, -1, 1, ...)` was standing in for "the topmost solid
// cell". It is not one: it returns the cell containing a point half a metre
// below the surface, and whether that cell's CENTRE is above or below the
// designed surface depends only on where this ground's surface sits inside its
// own cell. Over 48 body-wide grounds it hands back a procedurally AIR cell
// often enough to fail `isRemovedCell`, which is the same lattice-phase pinning
// the brackets had, one assertion over.
VoxelCell topmostProcSolidCell(const BodyParams& body, const Vec3& u, double surfR) {
  for (int k = 0; k < 256; ++k) {
    const VoxelCell c = cellForPos(u * (surfR - (k + 0.5) * 0.25 * kVoxelSizeM));
    if (isProcSolid(body, c)) return c;
  }
  return cellForPos(u * (surfR - 0.5 * kVoxelSizeM));
}
VoxelCell lowestProcAirCell(const BodyParams& body, const Vec3& u, double surfR) {
  for (int k = 0; k < 256; ++k) {
    const VoxelCell c = cellForPos(u * (surfR + (k + 0.5) * 0.25 * kVoxelSizeM));
    if (!isProcSolid(body, c)) return c;
  }
  return cellForPos(u * (surfR + 0.5 * kVoxelSizeM));
}
// The first `n` distinct cells above the surface that the unedited field calls
// AIR, in order. `columnCells(u, surfR, +1, n, ...)` is the same trap seen from
// the other side: it can hand back an already-solid cell.
void airCellsUp(const BodyParams& body, const Vec3& u, double surfR, size_t n,
                std::vector<VoxelCell>& out) {
  for (int k = 0; out.size() < n && k < 512; ++k) {
    const VoxelCell c = cellForPos(u * (surfR + (k + 0.5) * 0.25 * kVoxelSizeM));
    if (isProcSolid(body, c)) continue;
    bool seen = false;
    for (size_t i = 0; i < out.size(); ++i) if (out[i] == c) { seen = true; break; }
    if (!seen) out.push_back(c);
  }
}

Vec3 crossOf(const Vec3& a, const Vec3& b) {
  return Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

// A ring of dirs at `metresOut` tangential metres from `u`, for sampling a disc.
void ringDirs(const BodyParams& body, const Vec3& u, double metresOut, int n,
              std::vector<Vec3>& out) {
  const Vec3 seed = (std::fabs(u.x) < 0.9) ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
  Vec3 e1 = crossOf(u, seed);
  e1 = e1 * (1.0 / e1.length());
  const Vec3 e2 = crossOf(u, e1);
  const double R = body.radiusM;
  for (int i = 0; i < n; ++i) {
    const double a = (2.0 * 3.14159265358979323846 * i) / n;
    const Vec3 p = u * R + (e1 * std::cos(a) + e2 * std::sin(a)) * metresOut;
    out.push_back(unitOf(p));
  }
}

}  // namespace

// =============================================================================
// BASE is DESIGNED everywhere unedited (bit-identical). RAW is NOT the base.
//
// PROTECTED. Neither half of this may be relaxed. The second half (an EMPTY
// DensityField reads back the designed height bit for bit) is the guard on the
// whole seed+diff model: if it ever fails, the field has become a second surface
// definition and the five-surfaces bug is back.
// =============================================================================
TEST(oracle_base_is_designed_bit_identical) {
  const BodyParams forge = makeForge(20260616ull);
  const BodyParams cinder = makeCinder(4242ull);
  // A spread of dirs across faces / latitudes.
  for (int i = 0; i < 200; ++i) {
    const double lat = -1.4 + (2.8 * i) / 200.0;
    const double lon = -3.0 + (6.0 * ((i * 7) % 200)) / 200.0;
    const Vec3 d = latLonToDir(lat, lon);
    CHECK(asBits(baseHeight(forge, d)) == asBits(sampleDesignedHeight(forge, d)));
    CHECK(asBits(baseHeight(cinder, d)) == asBits(sampleDesignedHeight(cinder, d)));
    // surfaceHeight with no edits == baseHeight, bit-for-bit (undug path).
    DensityField none;
    CHECK(asBits(surfaceHeight(forge, d, none)) == asBits(baseHeight(forge, d)));
    CHECK(asBits(surfaceHeight(forge, d)) == asBits(baseHeight(forge, d)));
  }
}

// =============================================================================
// VOXEL SOLIDITY consistent with the ORACLE (designed) base. A point just under
// the DESIGNED surface is solid; a point just above is air. This is the exact
// case the old RAW solidity got wrong wherever designed != raw (mountains x1.6).
//
// Unchanged by the port: solidAt now reads the sign of the interpolated density
// rather than a cell-radius comparison, but the base it is built on is the same
// designed height, so the answers are the same and the tolerances hold.
// =============================================================================
TEST(voxel_solidity_matches_designed_surface) {
  const BodyParams forge = makeForge(20260616ull);
  DensityField none;
  // Sample many dirs; the designed surface radius is what solidity must key off.
  int checked = 0, gapCases = 0;
  for (int i = 0; i < 400; ++i) {
    const double lat = -1.2 + (2.4 * i) / 400.0;
    const double lon = -2.9 + (5.8 * ((i * 13) % 400)) / 400.0;
    const Vec3 d = latLonToDir(lat, lon);
    const double desR = forge.radiusM + sampleDesignedHeight(forge, d);
    const double rawR = forge.radiusM + sampleHeightField(forge, d);

    // 3 m below the DESIGNED surface -> solid; 3 m above -> air.
    const Vec3 below = d * (desR - 3.0);
    const Vec3 above = d * (desR + 3.0);
    CHECK(solidAt(forge, below, none));       // designed-based: solid under designed
    CHECK(!solidAt(forge, above, none));      // air above designed
    ++checked;

    // Where designed and raw diverge by > a few metres, a point BETWEEN them
    // exposes the old bug: it is solid under DESIGNED but air under RAW.
    if (desR - rawR > 4.0) {
      const Vec3 mid = d * ((rawR + desR) * 0.5);
      CHECK(solidAt(forge, mid, none));
      ++gapCases;
    } else if (rawR - desR > 4.0) {
      const Vec3 mid = d * ((rawR + desR) * 0.5);
      CHECK(!solidAt(forge, mid, none));       // above designed -> air
      ++gapCases;
    }
  }
  CHECK(checked > 0);
  CHECK(gapCases > 0);   // the raw/designed gap actually occurs (biomes reshape relief)
}

// =============================================================================
// DIG A VOXEL COLUMN -> surfaceHeight drops, and the two VIEWS of that drop
// (derivedLoweringAt and baseHeight - surfaceHeight) are the same number.
//
// The bracket on the drop is re-baselined TWICE OVER, and the reason is worth
// stating because it is a property of the medium that the port discovered.
//
// Carving the top six cells ONE CELL AT A TIME with a 0.87 m sphere does NOT
// open six metres of column. A radial that is not axis-aligned steps DIAGONALLY
// through the lattice, so consecutive cells in the column frequently meet only
// along an EDGE, sharing two corners rather than four. A 0.87 m carve at each
// centre drives those two shared corners negative and leaves the other six of
// the lower cell at +0.788, so a thin positive MEMBRANE survives between them
// and the root find stops there. MEASURED: the column opens 3.77 m, and the
// radial density profile shows the membrane at 4.0 m down (+0.027 m).
//
// That is not a defect in the oracle, it is a defect in "carve exactly one cell"
// as an operation, which is why the game does not have one: the pickaxe carves a
// SPHERE. So this case asserts the ported geometry with an honest bracket, and
// then asserts the sharp claim (dig N metres, the surface drops N metres) with
// the brush the game actually uses.
//
// The DEFINITIONAL identity at the end is NOT relaxed, because it is what stops
// the lowering view and the height view from ever drifting apart.
// =============================================================================
// WG-250 REWRITE. `CHECK(lowering > kVoxelSizeM)` on part (a) read 0.7240 m at
// height-field coefficient 0.045 and failed. It was never a property of the
// carve: it was a reading of where one ground's surface happened to sit inside
// its own topmost cell. Part (a) now runs over N grounds against a bracket
// computed from the brush and the lattice at each one (see guaranteedAirRunM
// and carveDepthCapM above), and part (b), which was already ground-independent
// and is the sharp claim, runs over the same N.
TEST(dig_column_lowers_surface_by_derived_amount) {
  const BodyParams forge = makeForge(20260616ull);
  const int kGrounds = 48;
  const size_t N = 6;

  int informative = 0;
  double worstRunMargin = 1e300, worstCapMargin = 1e300;
  double worstBrushLo = 1e300, worstBrushHi = 1e300, sumRun = 0.0;
  for (int gi = 0; gi < kGrounds; ++gi) {
    const Vec3 u = groundDir(gi, kGrounds);
    const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);
    const double base = baseHeight(forge, u);

    // (a) the ported geometry: the top N distinct cells, carved one at a time.
    std::vector<VoxelCell> col;
    columnCells(u, surfR, -1, N, col);
    CHECK(col.size() == N);

    DensityField edits;
    int flipped = 0;
    for (size_t k = 0; k < col.size(); ++k) flipped += digCell(forge, edits, col[k]);
    // WG-250: NOT `flipped >= N`. `digCell` returns how many cells' SOLIDITY
    // flipped, and a carve's corner writes reach one cell past its own brush, so
    // a later carve legitimately finds a cell the previous one already emptied.
    // Over 48 body-wide grounds that undercounts at three of the ten height
    // fields swept. The property is that each named cell IS air, which is the
    // line below, and it holds at every ground.
    CHECK(flipped > 0);
    for (size_t k = 0; k < col.size(); ++k) CHECK(!edits.solidCell(forge, col[k]));

    const double lowering = derivedLoweringAt(forge, u, edits);
    const double sh = surfaceHeight(forge, u, edits);
    const double run = guaranteedAirRunM(u, surfR, col);
    const double cap = carveDepthCapM(u, surfR, col, kCellBrushR);
    sumRun += run;
    if (run > 0.0) ++informative;

    // DERIVED FLOOR: everything inside a carved cell is air, so the surface is
    // at or below the bottom of the run the radial takes through the carved
    // set, to within the root find's own quarter-cell bracket.
    CHECK(lowering >= run - kRootFindBracketM);
    // DERIVED CEILING: no corner beyond the brush radius of a carve centre was
    // made air, so the crossing cannot be deeper than that.
    CHECK(lowering <= cap);
    // NOT a tolerance: derivedLoweringAt is defined as baseHeight -
    // surfaceHeight, and if these two ever disagree the mesher and the walker
    // are reading different surfaces again.
    CHECK_NEAR(base - sh, lowering, 1e-9);
    worstRunMargin = std::min(worstRunMargin, lowering - (run - kRootFindBracketM));
    worstCapMargin = std::min(worstCapMargin, cap - lowering);

    // (b) THE SHARP CLAIM, with the brush the pickaxe actually uses.
    // Overlapping 1.6 m spheres one metre apart down the radial cannot leave a
    // membrane at any lattice phase, which is why this half needed no rewrite:
    // it reads 6.92 to 7.09 m over every ground and every height field swept.
    DensityField brush;
    for (size_t k = 0; k < N; ++k)
      brush.digSphere(forge, u * (surfR - (k + 0.5) * kVoxelSizeM), 1.6);
    const double brushLow = derivedLoweringAt(forge, u, brush);
    CHECK(brushLow >= N * kVoxelSizeM);
    CHECK(brushLow <= N * kVoxelSizeM + 1.6 + 0.9);
    CHECK_NEAR(baseHeight(forge, u) - surfaceHeight(forge, u, brush), brushLow, 1e-9);
    CHECK(surfaceHeight(forge, u, brush) < base);
    worstBrushLo = std::min(worstBrushLo, brushLow - N * kVoxelSizeM);
    worstBrushHi = std::min(worstBrushHi, (N * kVoxelSizeM + 1.6 + 0.9) - brushLow);
  }
  std::printf("    dig column over %d grounds, cell by cell: worst margin above "
              "the guaranteed-air run %+.4f m (tolerance is the root find's own "
              "%.2f m bracket), worst margin below the carve cap %+.4f m; the "
              "run is informative at %d of %d grounds, mean %.3f m\n",
              kGrounds, worstRunMargin, kRootFindBracketM, worstCapMargin,
              informative, kGrounds, sumRun / kGrounds);
  std::printf("    dig column, 1.6 m brush, same %d grounds: worst margin above "
              "%zu m %+.4f m, worst margin below %zu m + 1.6 + 0.9 %+.4f m\n",
              kGrounds, N, worstBrushLo, N, worstBrushHi);
  CHECK(informative > 0);
}

// =============================================================================
// THE ONE BEDROCK CLAMP: dig past maxDigDepth -> surfaceHeight bottoms at
// base - maxDigDepth and no further, from the single definition here.
//
// PROTECTED (contract item 4). The clamp is exact and stays at 1e-9: it is an
// assignment in surface_field.h, not a measurement.
// =============================================================================
TEST(bedrock_clamp_from_single_definition) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double maxDig = 20.0;   // a small explicit floor for the test
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  DensityField edits;
  // Carve WAY past the clamp (down to 40 m). Radius 1.6 m rather than the
  // single-cell 0.87 m so the shaft is a continuous open column over 40 m and
  // the test measures the CLAMP rather than the first gap in a lumpy tube.
  for (int k = 0; k < 40; ++k)
    edits.digSphere(forge, u * (surfR - (k + 0.5) * kVoxelSizeM), 1.6);

  const double lowering = derivedLoweringAt(forge, u, edits, maxDig);
  CHECK_NEAR(lowering, maxDig, 1e-9);          // lowering capped at the clamp

  const double base = baseHeight(forge, u);
  const double sh = surfaceHeight(forge, u, edits, maxDig);
  CHECK_NEAR(sh, base - maxDig, 1e-9);         // surface bottoms exactly at bedrock

  // And the SHIPPED clamp, the one the game actually runs with, is 80 m.
  const double deep = surfaceHeight(forge, u, edits);
  CHECK(deep >= base - kSurfaceMaxDigDepthM - 1e-9);
}

// =============================================================================
// TUNNEL: a horizontal removed run a few metres BELOW the surface, under solid
// ground, produces NO surface lowering (the topmost crossing has not moved, so
// the ceiling is intact). The heightfield view never sees the tunnel; only the
// voxel layer does.
//
// PROTECTED as a property (contract item 3). The TOLERANCE moves: on the cell
// model an untouched column returned the designed height bit for bit, because
// nothing in the column was in the edit set. On the field, a column that passes
// within a cell of an override root-finds the TRILINEAR zero level instead of
// reading the exact designed height, and the two differ by the field's own
// interpolation error. That residual is measured and printed below; it is the
// honest price of the model and it bought a 0.87 m draw-versus-collide shell.
// =============================================================================
TEST(horizontal_tunnel_no_surface_lowering) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 d = sampleDir();
  const Vec3 u = unitOf(d);
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  // Horizontal tangent at the surface.
  Vec3 tangent(-u.z, 0.0, u.x);
  const double tl = tangent.length();
  tangent = Vec3(tangent.x / tl, tangent.y / tl, tangent.z / tl);

  DensityField edits;
  // Carve a horizontal run 5 m below the surface (leaves ~3.6 m of solid ceiling).
  const Vec3 start = u * (surfR - 5.0);
  int removed = 0;
  for (int s = 0; s <= 12; ++s) {
    const Vec3 p = start + tangent * static_cast<double>(s);
    removed += edits.digSphere(forge, p, 1.4);
  }
  CHECK(removed > 0);

  // The column straight down from the surface hits SOLID before any carved
  // ground, so there is no lowering. Sample a few columns across.
  int noLowering = 0, cols = 0;
  double worst = 0.0;
  for (int s = 0; s <= 12; s += 3) {
    const Vec3 colDir = unitOf(start + tangent * static_cast<double>(s));
    const double low = derivedLoweringAt(forge, colDir, edits);
    if (low < 0.5) ++noLowering;   // effectively zero (ceiling intact)
    ++cols;
    const double e = std::fabs(surfaceHeight(forge, colDir, edits) -
                               baseHeight(forge, colDir));
    if (e > worst) worst = e;
    // The rock above the bore is genuinely still there, at the point AND at the
    // cell: the tunnel did not quietly open the ceiling.
    CHECK(solidAt(forge, colDir * (forge.radiusM +
                                   baseHeight(forge, colDir) - 2.0), edits));
  }
  std::printf("    tunnel: %d of %d surface columns unmoved above a 5 m-deep "
              "12 m bore; worst |surfaceHeight - baseHeight| %.4f m "
              "(interpolation residual, not lowering)\n", noLowering, cols, worst);
  CHECK(noLowering == cols);   // EVERY column over the tunnel keeps its ceiling
  // MEASURED worst residual 0.0003 m at this site. Bounded at 0.10 m, which is
  // the same bound test_voxel_field.cpp's tunnel case carries, rather than the
  // old 1e-9: a root find on a trilinear field is not the closed-form height.
  CHECK(worst < 0.10);
}

// =============================================================================
// A dig-DOWN pit over an isolated pocket: the pit column DOES lower, but the
// pocket beneath the intact floor does not deepen the surface further.
//
// PROTECTED as a property (contract item 5). The GEOMETRY is thickened: the old
// file left ONE solid cell between the pit and the pocket, which a corner-sampled
// field cannot represent, because that cell's eight corners are exactly the
// bottom face of the carve above it and the top face of the carve below it, so
// both carves drive all eight negative and the floor evaporates. A floor needs
// two cells of thickness to exist on this lattice. That is a statement about the
// MEDIUM, and it is asserted directly below (the floor cells read solid) so the
// case cannot pass by having no floor at all.
// =============================================================================
// WG-250 REWRITE, and it changes the geometry as well as the bracket.
//
// TWO things were pinned. `lowering >= 2.0 && lowering <= 4.0` read 0.7240 m at
// height-field coefficient 0.045, for the same lattice-phase reason as the dig
// column. And the TWO-cell floor was itself a coin flip: `columnCells` returns
// the DISTINCT cells a radial passes, which on a diagonal radial can be
// EDGE-adjacent rather than face-adjacent, so a nominal two-cell floor can be
// thinner than two cells and the pocket's carve then reaches the pit. Measured
// over 48 body-wide grounds, the two-cell floor let the pocket change the answer
// at 1 to 8 grounds per height field. A five-cell floor with the pocket at cells
// 8 and 9 cannot: the carve reach is R + one cell and the gap is four.
//
// THE PROPERTY IS NOW ASSERTED AS A CONTRAST, WHICH NEEDS NO CEILING AT ALL.
// "The pocket adds nothing" is exactly "the same pit with and without the pocket
// answers the same", and that is asserted BITWISE. Over 480 grounds (10 height
// fields x 48) it holds every time. The brackets around it are the derived pair
// from the dig column, and they are the weaker half.
TEST(pit_lowers_only_to_first_solid) {
  const BodyParams forge = makeForge(20260616ull);
  const int kGrounds = 48;
  int informative = 0, contrasted = 0;
  double worstRunMargin = 1e300, worstCapMargin = 1e300;
  for (int gi = 0; gi < kGrounds; ++gi) {
    const Vec3 u = groundDir(gi, kGrounds);
    const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);
    std::vector<VoxelCell> col;
    columnCells(u, surfR, -1, 10, col);
    CHECK(col.size() == 10);
    const std::vector<VoxelCell> pitCells(col.begin(), col.begin() + 3);

    DensityField edits, pitOnly;
    // Open the top 3 cells (a shallow pit), in both fields...
    for (int k = 0; k < 3; ++k) {
      digCell(forge, edits, col[k]);
      digCell(forge, pitOnly, col[k]);
    }
    // ...leave cells 3 to 7 SOLID (the floor)...
    // ...then carve cells 8 and 9 in ONE of them (an isolated pocket).
    digCell(forge, edits, col[8]);
    digCell(forge, edits, col[9]);

    // The floor is REALLY there. Without this the case would pass trivially the
    // day the floor stops existing, which on a corner-sampled field is exactly
    // what a thin floor does.
    for (int k = 3; k <= 7; ++k) {
      CHECK(edits.solidCell(forge, col[k]));
      CHECK(solidAt(forge, cellCenter(col[k]), edits));
    }
    // ...and the pit and the pocket are REALLY open, so there is something to
    // lower and something to not-see. `isRemovedCell` is asked of col[2] and
    // col[8] rather than col[0], because col[0] is only PROCEDURALLY solid at
    // the lattice phases where the surface happens to sit high in its own cell:
    // asking it there is the pinning defect, not the property.
    CHECK(!edits.solidCell(forge, col[0]));
    CHECK(!edits.solidCell(forge, col[8]));
    CHECK(isRemovedCell(forge, edits, col[2]));      // was proc-solid, now air
    CHECK(isRemovedCell(forge, edits, col[8]));

    const double lowering = derivedLoweringAt(forge, u, edits);
    const double withoutPocket = derivedLoweringAt(forge, u, pitOnly);
    // THE PROPERTY, ceiling-free and bitwise: the pocket under an intact floor
    // is invisible to the heightfield.
    CHECK(asBits(lowering) == asBits(withoutPocket));
    if (asBits(lowering) == asBits(withoutPocket)) ++contrasted;

    const double run = guaranteedAirRunM(u, surfR, pitCells);
    const double cap = carveDepthCapM(u, surfR, pitCells, kCellBrushR);
    if (run > 0.0) ++informative;
    CHECK(lowering >= run - kRootFindBracketM);
    CHECK(lowering <= cap);
    worstRunMargin = std::min(worstRunMargin, lowering - (run - kRootFindBracketM));
    worstCapMargin = std::min(worstCapMargin, cap - lowering);
  }
  std::printf("    pit over %d grounds: a 3-cell pit over a 5-cell floor over a "
              "2-cell pocket 8 m down answers BITWISE the same as the pit alone "
              "at %d of %d; worst margin above the guaranteed-air run %+.4f m, "
              "worst margin below the pit's own carve cap %+.4f m (run "
              "informative at %d)\n",
              kGrounds, contrasted, kGrounds, worstRunMargin, worstCapMargin,
              informative);
  CHECK(contrasted == kGrounds);
  CHECK(informative > 0);
}

// =============================================================================
// Determinism: same (body, edits) -> same surface bits; SurfaceField view agrees
// with the free functions.
//
// PROTECTED (contract items 6 and 9), unchanged by the port.
// =============================================================================
TEST(determinism_and_surfacefield_view) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + sampleDesignedHeight(forge, u);

  DensityField a, b;
  for (int k = 0; k < 5; ++k) {
    const VoxelCell c = cellForPos(u * (surfR - (k + 0.5) * kVoxelSizeM));
    digCell(forge, a, c);
    digCell(forge, b, c);
  }
  CHECK(asBits(surfaceHeight(forge, u, a)) == asBits(surfaceHeight(forge, u, b)));
  CHECK(a.overrideCount() == b.overrideCount());

  // SurfaceField binder matches the free functions.
  SurfaceField field(forge, &a);
  CHECK(asBits(field.heightAt(u)) == asBits(surfaceHeight(forge, u, a)));
  CHECK(asBits(field.baseHeightAt(u)) == asBits(baseHeight(forge, u)));
  CHECK_NEAR(field.loweringAt(u), derivedLoweringAt(forge, u, a), 1e-12);
  CHECK_NEAR(field.radiusAt(u), surfaceRadius(forge, u, a), 1e-12);
  CHECK(field.solid(cellForPos(u * (surfR - 8.0))) ==
        a.solidCell(forge, cellForPos(u * (surfR - 8.0))));
  CHECK(field.solidAtPos(u * (surfR - 8.0)) == a.solidAt(forge, u * (surfR - 8.0)));

  // A null-edits SurfaceField is the undug base everywhere.
  SurfaceField undug(forge, nullptr);
  CHECK(asBits(undug.heightAt(u)) == asBits(baseHeight(forge, u)));
  CHECK(undug.solid(cellForPos(u * (surfR - 3.0))));       // solid under designed
  CHECK(!undug.solid(cellForPos(u * (surfR + 3.0))));      // air above

  // The bound loweringFn matches derivedLoweringAt (what buildChunk consumes).
  auto fn = field.loweringFn();
  CHECK_NEAR(fn(u), derivedLoweringAt(forge, u, a), 1e-12);
}

// =============================================================================
// WG-24 NEW CASE : THE ORACLE AND THE PICTURE ARE THE SAME SURFACE.
//
// This replaces the old file's "surfaceHeight fell by exactly the derived
// lowering", which on a cell lattice was true by construction and therefore
// proved nothing. The stronger statement the signed field makes possible is the
// one this project has paid for six times: mesh-versus-collision disagreement.
//
// For every vertex surface nets DRAWS, ask the oracle what the surface radius is
// along that vertex's own direction and compare. If the number is small, the
// player stands on what they can see. If it is not, something floats.
//
// Two honest caveats, both reported rather than hidden:
//   * The oracle is a HEIGHTFIELD. It answers with the topmost crossing along a
//     radial, so it has no opinion about the underside of an overhang. The
//     comparison is therefore reported both over every vertex and over the
//     heightfield-representable ones (surface normal within 60 degrees of up).
//   * A vertex over UNTOUCHED ground is drawn from the trilinear field while the
//     oracle short-circuits to the exact designed height, so those two differ by
//     the interpolation residual the tunnel case also measures.
// =============================================================================
TEST(the_oracle_and_the_drawn_mesh_are_the_same_surface) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const Vec3 site = u * (forge.radiusM + baseHeight(forge, u));

  DensityField edits;
  CHECK(edits.digSphere(forge, site, 3.0) > 20);

  SurfaceNetsOpts o;
  o.editedOnly = false;                  // draw the untouched ground too
  const SurfaceNetsMesh m = surfaceNetsAround(forge, edits, site, 10.0, o);
  CHECK(m.positions.size() > 200);
  CHECK(m.normals.size() == m.positions.size());

  double worstAll = 0.0, worstUp = 0.0;
  int nUp = 0;
  for (size_t i = 0; i < m.positions.size(); ++i) {
    const Vec3 v = m.positions[i];
    const Vec3 vu = unitOf(v);
    const double oracleR = forge.radiusM + surfaceHeight(forge, vu, edits);
    const double e = std::fabs(v.length() - oracleR);
    if (e > worstAll) worstAll = e;
    const Vec3& n = m.normals[i];
    if (n.x * vu.x + n.y * vu.y + n.z * vu.z >= 0.5) {   // within 60 deg of up
      ++nUp;
      if (e > worstUp) worstUp = e;
    }
  }
  std::printf("    ORACLE vs DRAWN MESH: %zu vertices over a 3 m crater, worst "
              "|drawn radius - oracle radius| %.6f m over all of them, %.6f m "
              "over the %d heightfield-representable ones\n",
              m.positions.size(), worstAll, worstUp, nUp);
  CHECK(nUp > 50);
  // MEASURED 0.175320 m, over every vertex and over the up-facing ones alike
  // (the worst vertex is up-facing). The bound is stated at a quarter of a cell
  // for the heightfield-representable vertices, which is the same 0.25 m
  // test_voxel_field.cpp asserts for drawn-versus-collided, and at half a cell
  // over every vertex including the near-vertical crater wall, where a radial
  // root find is ill-conditioned by geometry rather than by disagreement.
  CHECK(worstUp <= 0.25 * kVoxelSizeM);
  CHECK(worstAll <= 0.50 * kVoxelSizeM);
}

// =============================================================================
// WG-22 : TERRAFORMING. Fill is representable, it moves the ONE surface, and
// levelArea collapses the height spread inside its disc and nowhere else.
// =============================================================================

// =============================================================================
// FILL IS REPRESENTABLE AT ALL. Before WG-22 the model was subtractive by
// construction: a removed set can only take rock away. This is the assertion the
// whole feature rests on, so it is stated on its own.
// =============================================================================
TEST(fill_makes_air_solid_and_raises_the_one_surface) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(sampleDir());
  const double surfR = forge.radiusM + baseHeight(forge, u);
  // WG-250: NOT `columnCells(u, surfR, +1, 6, up)`. That returns the cell
  // containing a point half a metre above the surface, and whether that cell's
  // CENTRE is above or below the designed surface depends only on where this
  // ground's surface sits inside its own cell. At coefficient 0.0525 of the
  // WG-243 amplitude sweep it came back already SOLID and three assertions in
  // this case failed for that reason and no other. This case is outside the
  // four the WG-250 brief named; the sweep found it, so it is fixed here.
  std::vector<VoxelCell> up;
  airCellsUp(forge, u, surfR, 6, up);
  CHECK(up.size() == 6);

  DensityField edits;
  // The three cells directly above the designed surface are AIR to begin with.
  for (int k = 0; k < 3; ++k) CHECK(!edits.solidCell(forge, up[k]));
  CHECK_NEAR(surfaceHeight(forge, u, edits), baseHeight(forge, u), 1e-12);

  for (int k = 0; k < 3; ++k) CHECK(fillCell(forge, edits, up[k]) > 0);
  // RE-BASELINED. The old assertion was addedCount() == 3, counting three CELL
  // ids. The field has no cell ids: airCount/rockCount split the CORNER
  // overrides by the SIGN of the stored distance, and a 0.87 m fill writes every
  // corner out to one cell past the sphere (a corner 1.6 m from the centre
  // genuinely is 0.73 m outside the placed ground, and storing that is what
  // makes the surface close smoothly). Most of those are still negative, so a
  // FILL legitimately raises airCount. The totals are printed, not predicted.
  std::printf("    fill: %zu corner overrides (%zu stored positive, %zu stored "
              "negative) for what the cell model stored as 3 added cells\n",
              edits.overrideCount(), edits.rockCount(), edits.airCount());
  CHECK(edits.rockCount() > 0);
  CHECK(edits.overrideCount() > 0);

  // Solidity says solid...
  for (int k = 0; k < 3; ++k) {
    CHECK(edits.solidCell(forge, up[k]));
    CHECK(isAddedCell(forge, edits, up[k]));   // was proc-air, now rock
  }
  // ...and the SAME oracle the mesh, the walker and collision read says the
  // surface came up with it. Anything less is the five-surfaces failure.
  const double raised = surfaceHeight(forge, u, edits) - baseHeight(forge, u);
  const double topCell = cellCenter(up[2]).length() - surfR;
  std::printf("    fill: surface rose %.4f m from three 0.87 m spheres stacked "
              "on the designed surface; the top sphere's centre is %.4f m up "
              "(old whole-cell model: exactly 3.0 m)\n", raised, topCell);
  // RE-BASELINED from CHECK_NEAR(raised, 3.0, 1e-9). The exact 3.0 held only
  // because a cell had a flat top face at a lattice plane. Placed ground now
  // tops out where the highest sphere does, and where that is depends on which
  // cells the radial actually passes through, so the bound is stated against the
  // measured top centre rather than against a round number.
  CHECK(raised > 0.0);
  CHECK(raised <= topCell + kCellBrushR + 0.1);
  CHECK_NEAR(derivedRaisingAt(forge, u, edits), raised, 1e-12);
  CHECK_NEAR(surfaceRadius(forge, u, edits),
             forge.radiusM + baseHeight(forge, u) + raised, 1e-9);
  // The signed offset the chunk mesher consumes is negative when ground rose.
  CHECK_NEAR(surfaceOffsetAt(forge, u, edits), -raised, 1e-12);

  // THE SHARP CLAIM, with a brush rather than a cell: place 3 m of continuous
  // ground on top of the designed surface and the ONE surface rises by 3 m.
  // This is what the old exact 3.0 m assertion was really about, restated in a
  // form the signed field can honour.
  DensityField pad;
  for (int k = 0; k <= 12; ++k)
    pad.fillSphere(forge, u * (surfR + k * 0.25), 1.2);
  const double padRise = surfaceHeight(forge, u, pad) - baseHeight(forge, u);
  std::printf("    fill: a continuous 3 m column of placed ground raises the "
              "one surface %.4f m (target 3.0 m + the 1.2 m brush radius)\n",
              padRise);
  CHECK(padRise >= 3.0);
  CHECK(padRise <= 3.0 + 1.2 + 0.25);
  CHECK(solidAt(forge, u * (surfR + 2.0), pad));    // and it is walkable rock
  CHECK_NEAR(surfaceOffsetAt(forge, u, pad), -padRise, 1e-12);

  // A CELL FLOATING WITH A GAP UNDER IT. THIS PROPERTY DID NOT SURVIVE THE PORT
  // AND THE ASSERTION IS DELIBERATELY GONE. WG-21 enforced it by rule: the
  // heightfield view was the TOP-ANCHORED contiguous run of edited cells, so a
  // disconnected block raised nothing, by construction. WG-24 root-finds the
  // TOPMOST crossing instead, and a floating block IS the topmost crossing, so
  // the view should now rise to the block.
  //
  // What it actually does is worse than either: it depends on where the block
  // sits. The sphere trace comes down from the fill cap in steps of up to 4 m,
  // and a brush only writes corner distances out to ONE CELL past its sphere, so
  // a thin slab whose signed-distance band is narrower than the current step is
  // stepped straight over. MEASURED at this site: a block 6.90 m up is seen and
  // raises the view 6.6169 m, while the same block 5.55 m up is missed and raises
  // it 0.0002 m. That is a coin flip, not a property.
  //
  // TODO(world-gen): decide which semantics the heightfield view owes for
  // DISCONNECTED placed ground, then assert it here. Until then this case
  // asserts only what is true either way: the block exists, it genuinely floats,
  // and whatever the view reports is inside the WG-22 fill cap.
  // WG-250: the block's cell and the point that proves the gap are both DERIVED
  // now. `fillCell(forge, floating, up[5])` plus `!solidAt(u * (surfR + 3.0))`
  // assumed up[5] sat about five metres up, which is true only when the radial
  // steps one whole cell each time; on a diagonal radial the distinct cells are
  // closer together and at coefficient 0.030 of the WG-243 sweep the block
  // reached down through the 3.0 m probe. Pick a cell whose centre clears the
  // ground by more than the brush's write reach, and probe the gap at that
  // reach below it, so both facts follow from the brush rather than from a
  // guess about the lattice.
  const double kBrushWriteReachM = kCellBrushR + kVoxelSizeM;   // brush() 's own
  VoxelCell floatCell = up[5];
  for (int k = 0; k < 256; ++k) {
    const VoxelCell c = cellForPos(u * (surfR + 4.0 + (k + 0.5) * 0.25 * kVoxelSizeM));
    if (!isProcSolid(forge, c)) { floatCell = c; break; }
  }
  const double floatCentreR = alongRadial(u, cellCenter(floatCell));
  const double gapR = floatCentreR - kBrushWriteReachM - 0.05;
  CHECK(gapR > surfR + 0.5);                  // the gap really is above ground
  DensityField floating;
  fillCell(forge, floating, floatCell);
  CHECK(floating.solidCell(forge, floatCell));              // the block exists
  CHECK(!floating.solidAt(forge, u * gapR));                // and it really floats
  const double floatRaise = derivedRaisingAt(forge, u, floating);
  DensityField floatLow;
  fillCell(forge, floatLow, up[4]);
  std::printf("    floating block %.2f m up (gap probed %.2f m up, one brush "
              "write reach below it): heightfield view rises %.4f m; a block "
              "%.2f m up: %.4f m (WG-21 rule said 0.0 m for both)\n",
              floatCentreR - surfR, gapR - surfR, floatRaise,
              cellCenter(up[4]).length() - surfR,
              derivedRaisingAt(forge, u, floatLow));
  CHECK(floatRaise >= 0.0);
  CHECK(floatRaise <= kSurfaceMaxFillM + 1e-9);

  // THE WG-22 FILL CAP, the mirror of the bedrock clamp and the other half of
  // contract item 4. A CONTINUOUS fill column from the ground to 30 m up is
  // unmissable, and the heightfield view still stops dead at kSurfaceMaxFillM.
  DensityField tower;
  for (int k = 0; k <= 60; ++k)
    tower.fillSphere(forge, u * (surfR + k * 0.5), 1.6);
  CHECK(tower.solidAt(forge, u * (surfR + 28.0)));          // rock 28 m up
  CHECK_NEAR(derivedRaisingAt(forge, u, tower), kSurfaceMaxFillM, 1e-9);
  CHECK_NEAR(surfaceHeight(forge, u, tower),
             baseHeight(forge, u) + kSurfaceMaxFillM, 1e-9);
}

// =============================================================================
// dig and fill are INVERSES, so undoing an edit restores the SOLIDITY it took
// away and does not keep growing the save.
//
// RE-EXPRESSED. The old file could assert that filling a dug cell left the store
// literally EMPTY, because the store was a set of cell ids and removing the id
// was the undo. A signed field cannot do that: dig writes -0.004 at a corner,
// fill writes back +0.004, and +0.004 is not the procedural value, so the
// override survives as a (correct, tiny) stored distance. What survives is the
// property that matters to the player and to the save:
//   * solidity comes back,
//   * the surface comes back to within the brush's own resolution,
//   * an undo entirely inside rock writes no new keys, and
//   * an op that changes nothing stores nothing.
// =============================================================================
// WG-250 REWRITE. Two of this case's numbers were readings of one ground.
// `hDug < h0 - 0.25` is a claim about how far a carve at a cell centre reaches
// along a radial that may pass anywhere in that cell, and
// `|h1 - h0| <= 0.25 * kVoxelSizeM` was measured at 0.032 m on the fixture's own
// site and reads up to 0.7547 m over 480 grounds. Both now come from the brush.
//
// AND THE CASE GAINS THE ASSERTION IT WAS MISSING, which is the only exact
// statement of "dig and fill are inverses" available on a signed field. The
// corner update is `max(min(d, s), -s)` with `s = |p - c| - R`. Inside the
// sphere s < 0, so the result is -s > 0: ROCK. Outside, -s <= 0 and
// `min(d, s) >= 0` whenever d >= 0, so the result is >= 0: ROCK. Therefore NO
// CORNER THAT WAS ROCK CAN BE AIR AFTER THE ROUND TRIP, exactly, at every
// ground, with no tolerance. That is asserted over the whole 7x7x7 corner block
// the brush and its skirt can reach, and it is what a broken fill trips first.
TEST(dig_and_fill_are_inverses_and_the_diff_shrinks) {
  const BodyParams forge = makeForge(20260616ull);
  const int kGrounds = 48;
  // DERIVED. The round trip replaces the ground inside the brush with the brush
  // SPHERE's own boundary, so the restored surface is at most one brush radius
  // from the cell centre, and the cell centre is at most half a cell diagonal
  // from the surface point. Neither number was read off a ground.
  const double kRestoreBoundM = kCellBrushR + kHalfCellDiagM;
  long long rockLost = 0;
  int informative = 0;
  double worstDugMargin = 1e300, worstRestore = 0.0, worstTowards = -1e300;
  for (int gi = 0; gi < kGrounds; ++gi) {
    const Vec3 u = groundDir(gi, kGrounds);
    const double surfR = forge.radiusM + baseHeight(forge, u);
    // The TOPMOST solid cell, not a buried one: undoing a dig 2.5 m down would
    // leave the surface where it was either way and prove nothing about the
    // undo. Asked as a PROPERTY (see topmostProcSolidCell): the old
    // `columnCells(u, surfR, -1, 1, ...)` hands back a procedurally AIR cell at
    // the lattice phases where the surface sits low in its own cell.
    const VoxelCell under = topmostProcSolidCell(forge, u, surfR);
    const VoxelCell over  = lowestProcAirCell(forge, u, surfR);
    CHECK(isProcSolid(forge, under));
    CHECK(!isProcSolid(forge, over));
    const std::vector<VoxelCell> down(1, under);

    DensityField e;
    const double h0 = surfaceHeight(forge, u, e);
    // Every corner the brush and its one-cell skirt can reach, before the dig.
    std::vector<double> was;
    was.reserve(343);
    for (int dz = -3; dz <= 3; ++dz)
      for (int dy = -3; dy <= 3; ++dy)
        for (int dx = -3; dx <= 3; ++dx)
          was.push_back(e.cornerDensity(
              forge, VoxelCell{under.cx + dx, under.cy + dy, under.cz + dz}));

    CHECK(digCell(forge, e, under) > 0);
    CHECK(!e.solidCell(forge, under));
    CHECK(isRemovedCell(forge, e, under));
    CHECK(e.airCount() > 0);
    const double hDug = surfaceHeight(forge, u, e);
    // DERIVED: the carved cell is air throughout, so the surface is at or below
    // the bottom of the run the radial takes through it, to within the root
    // find's own quarter-cell bracket.
    const double run = guaranteedAirRunM(u, surfR, down);
    if (run > 0.0) ++informative;
    CHECK(h0 - hDug >= run - kRootFindBracketM);
    worstDugMargin = std::min(worstDugMargin, (h0 - hDug) - (run - kRootFindBracketM));

    // Filling a dug cell gives the rock back, and puts the surface back.
    CHECK(fillCell(forge, e, under) > 0);
    CHECK(e.solidCell(forge, under));
    CHECK(!isRemovedCell(forge, e, under));
    const double h1 = surfaceHeight(forge, u, e);

    // THE EXACT INVARIANT. No corner that was rock is air after the round trip.
    size_t i = 0;
    for (int dz = -3; dz <= 3; ++dz)
      for (int dy = -3; dy <= 3; ++dy)
        for (int dx = -3; dx <= 3; ++dx) {
          const double before = was[i++];
          const double after = e.cornerDensity(
              forge, VoxelCell{under.cx + dx, under.cy + dy, under.cz + dz});
          if (before >= 0.0 && after < 0.0) ++rockLost;
        }

    // DERIVED: the surface comes back to within the brush's own reach.
    CHECK(std::fabs(h1 - h0) <= kRestoreBoundM);
    // DERIVED: and the undo moves the surface no FURTHER from where it started
    // than the dig did. Both heights carry the root find's quarter-cell bracket,
    // so the pair carries two of them and nothing more.
    CHECK(std::fabs(h1 - h0) <= std::fabs(hDug - h0) + 2.0 * kRootFindBracketM);
    worstRestore = std::max(worstRestore, std::fabs(h1 - h0));
    worstTowards = std::max(worstTowards, std::fabs(h1 - h0) - std::fabs(hDug - h0));

    // The store does NOT come back to empty (the old CHECK(e.empty()) is gone
    // because dig writes -0.004 at a corner and fill writes back +0.004, neither
    // of which is the procedural value), and at a SURFACE cell an undo
    // legitimately grows it, because a fill sphere centred on the topmost solid
    // cell places ground into the air half of that cell. Where the op is
    // entirely inside rock, the undo writes no new keys at all.
    DensityField buriedRT;
    const VoxelCell deepCell = cellForPos(u * (surfR - 12.5 * kVoxelSizeM));
    CHECK(digCell(forge, buriedRT, deepCell) > 0);
    const size_t deepDug = buriedRT.overrideCount();
    CHECK(fillCell(forge, buriedRT, deepCell) > 0);
    CHECK(buriedRT.solidCell(forge, deepCell));
    CHECK(buriedRT.overrideCount() == deepDug);

    // Fill placed ground above the surface, then take it back.
    CHECK(fillCell(forge, e, over) > 0);
    CHECK(e.solidCell(forge, over));
    CHECK(isAddedCell(forge, e, over));
    CHECK(digCell(forge, e, over) > 0);
    CHECK(!e.solidCell(forge, over));
    CHECK(!isAddedCell(forge, e, over));

    // Filling rock that is already there is a no-op, not a stored fact. This one
    // survives EXACTLY: max(d, r - |p - c|) cannot raise a corner whose
    // procedural density already exceeds the sphere's, so nothing is written.
    DensityField deep;
    CHECK(fillCell(forge, deep, deepCell) == 0);
    CHECK(deep.empty());
    // The mirror: carving air that is already air stores nothing either.
    CHECK(digCell(forge, deep, cellForPos(u * (surfR + 12.5 * kVoxelSizeM))) == 0);
    CHECK(deep.empty());
  }
  std::printf("    undo at the surface over %d grounds: %lld of %d corner blocks' "
              "rock turned to air by a dig-then-fill (must be 0); worst surface "
              "departure after the undo %.4f m against the brush's own reach "
              "%.4f m; worst step AWAY from the start relative to the dig "
              "%+.4f m against 2 x the root find's %.2f m bracket\n",
              kGrounds, rockLost, kGrounds * 343, worstRestore, kRestoreBoundM,
              worstTowards, kRootFindBracketM);
  std::printf("    the dig itself: worst margin above the guaranteed-air run "
              "%+.4f m, informative at %d of %d grounds\n",
              worstDugMargin, informative, kGrounds);
  CHECK(rockLost == 0);
  CHECK(informative > 0);
}

// =============================================================================
// THE HEADLINE: levelArea collapses the height spread inside its radius, leaves
// the ground outside it untouched, and is idempotent.
// =============================================================================
TEST(level_area_flattens_the_disc_and_only_the_disc) {
  const BodyParams forge = makeForge(20260616ull);
  // A site with REAL relief. sampleDir() is a smooth spot whose 8 m disc spans
  // 0.73 m, less than one voxel, so levelling it could only prove that a 1 m
  // lattice cannot beat 1 m. This dir was found by scanning the body for the
  // steepest 8 m disc under 12 m of spread: 7.70 m across 16 m, a 26 degree
  // slope, which is a hillside a player would actually want to flatten.
  const Vec3 u = unitOf(latLonToDir(1.00, -0.90));
  const double radiusM = 8.0;

  // Sample points: rings inside the disc, and a ring well outside it.
  std::vector<Vec3> in, out;
  in.push_back(u);
  ringDirs(forge, u, radiusM * 0.4, 8, in);
  ringDirs(forge, u, radiusM * 0.8, 8, in);
  ringDirs(forge, u, radiusM * 3.0, 12, out);

  DensityField edits;
  const auto spread = [&](const std::vector<Vec3>& pts) {
    double lo = 1e30, hi = -1e30;
    for (size_t i = 0; i < pts.size(); ++i) {
      const double h = surfaceHeight(forge, pts[i], edits);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return hi - lo;
  };
  const double beforeIn = spread(in);
  const double beforeOut = spread(out);
  std::vector<double> outBefore;
  for (size_t i = 0; i < out.size(); ++i)
    outBefore.push_back(surfaceHeight(forge, out[i], edits));

  // Stand at the centre; level to the height under the player's own feet.
  const double target = baseHeight(forge, u);
  const LevelResult r = levelArea(forge, edits, u * (forge.radiusM + target),
                                  radiusM, target);
  CHECK(r.scanned > 0);      // NOTE: scanned now counts CORNERS, not cells.
  CHECK(r.cells() > 0);      // it actually moved ground

  const double afterIn = spread(in);
  double worstOnPad = 0.0;
  for (size_t i = 0; i < in.size(); ++i)
    worstOnPad = std::max(worstOnPad,
                          std::fabs(surfaceHeight(forge, in[i], edits) - target));
  std::printf("    levelArea: spread inside the disc %.4f m -> %.4f m, worst "
              "column off target %.6f m; %d corners scanned, %d cells cut, %d "
              "filled (WG-23 on the cell model: 7.703 m -> 1.511 m)\n",
              beforeIn, afterIn, worstOnPad, r.scanned, r.dug, r.filled);
  // RE-BASELINED from CHECK(afterIn <= 2.0 * kVoxelSizeM). The two-voxel
  // threshold was the MEDIUM's limit, not the algorithm's: a Cartesian 1 m
  // lattice cut by a plane that is not axis-aligned terminates on a staircase.
  // A signed field reproduces the plane exactly under trilinear interpolation,
  // so the pad is flat to the root find's own resolution. Bounded at a quarter
  // of a voxel, the same threshold WG-23 wanted and could not reach.
  CHECK(afterIn <= 0.25 * kVoxelSizeM);
  CHECK(afterIn * 3.0 < beforeIn);

  // THE NEGATIVE CONTROL. Outside the radius nothing moved AT ALL, bitwise.
  for (size_t i = 0; i < out.size(); ++i)
    CHECK(asBits(surfaceHeight(forge, out[i], edits)) == asBits(outBefore[i]));
  CHECK_NEAR(spread(out), beforeOut, 1e-12);

  // Every sampled point on the pad reads the target height, and the ground just
  // under it is SOLID while the air just over it is not: the surface the mesh
  // draws and the solidity collision reads are the same answer.
  for (size_t i = 0; i < in.size(); ++i) {
    const double h = surfaceHeight(forge, in[i], edits);
    // RE-BASELINED from kVoxelSizeM + 1e-9, for the same reason as afterIn.
    CHECK(std::fabs(h - target) <= 0.25 * kVoxelSizeM);
    // THE AGREEMENT THAT MATTERS. If these two ever disagree the player floats
    // above the pad or sinks into it, which is the five-surfaces bug returning.
    const double rr = forge.radiusM + h;
    CHECK(solidAt(forge, in[i] * (rr - 0.5 * kVoxelSizeM), edits));
    CHECK(!solidAt(forge, in[i] * (rr + 0.5 * kVoxelSizeM), edits));
    // And the CELL-quantised shape agrees too, one cell out either way.
    CHECK(edits.solidCell(forge, cellForPos(in[i] * (rr - 1.5 * kVoxelSizeM))));
    CHECK(!edits.solidCell(forge, cellForPos(in[i] * (rr + 1.5 * kVoxelSizeM))));
  }

  // IDEMPOTENT: a held key must not make the pad creep.
  const size_t overridesAfter = edits.overrideCount();
  const LevelResult again = levelArea(forge, edits, u * (forge.radiusM + target),
                                      radiusM, target);
  CHECK(again.cells() == 0);
  CHECK(edits.overrideCount() == overridesAfter);
}

// =============================================================================
// WG-23 : NO COLUMN INSIDE THE DISC KEEPS ITS ORIGINAL HEIGHT.
//
// This is the assertion whose absence let a levelling tool ship, measure a 2.3x
// collapse in height spread, and read to the player as nothing happening.
//
// Spread over a ring of samples is an AVERAGE claim, and the failure was in the
// tail: on the cell model `levelArea` stored only the cells whose solidity
// CHANGED, while the heightfield read the result back as a contiguous run of
// explicitly edited cells along each column. The procedural surface is a 1 m
// staircase around the smooth designed height, so a column's probe regularly
// landed in a cell that was already air on the cut side or already rock on the
// fill side. Nothing was stored there, the run ended at the first step, and that
// column kept its ORIGINAL height while its neighbours moved by metres. Measured
// in the browser on a 29 degree slope before the fix: 8.7% of 253 columns did
// not move at all, the worst 2.5 m below target.
//
// So the property is stated per COLUMN and over a dense grid, not as a spread:
// every column the disc covers moves to within the bound of the target, and the
// shell agrees with the surface at every one of them.
// =============================================================================
TEST(level_leaves_no_column_at_its_original_height) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(latLonToDir(1.00, -0.90));   // the 26 degree hillside
  const double radiusM = 8.0;
  const double target = baseHeight(forge, u);

  // A dense grid over the disc, not a ring: the failure is a scatter of single
  // columns, and a ring of 8 walks straight past it.
  const Vec3 seed = (std::fabs(u.x) < 0.9) ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
  Vec3 e1 = crossOf(u, seed);
  e1 = e1 * (1.0 / e1.length());
  const Vec3 e2 = crossOf(u, e1);
  std::vector<Vec3> grid;
  for (double a = -radiusM * 0.75; a <= radiusM * 0.75; a += 0.5)
    for (double b = -radiusM * 0.75; b <= radiusM * 0.75; b += 0.5)
      if (a * a + b * b <= radiusM * radiusM * 0.5625)
        grid.push_back(unitOf(u * forge.radiusM + e1 * a + e2 * b));
  CHECK(grid.size() > 100);

  std::vector<double> before;
  DensityField edits;
  for (size_t i = 0; i < grid.size(); ++i)
    before.push_back(surfaceHeight(forge, grid[i], edits));

  const LevelResult r = levelArea(forge, edits, u * (forge.radiusM + target),
                                  radiusM, target);
  CHECK(r.cells() > 0);

  // RE-BASELINED BOUND. On the cell model the bound was kVoxelSizeM + 0.9 = 1.9 m
  // and it was the MEDIUM's, not the algorithm's: a column's surface was decided
  // by the one cell the target plane passed through, and a cell centre sits up to
  // half a cell diagonal off the ray that probes it. A signed field has neither
  // limitation, because levelDisc assigns the plane's own signed distance and
  // trilinear interpolation reproduces a linear function exactly. The bound is
  // therefore restated at a quarter of a voxel, which is the perceptual
  // threshold WG-23 defined and could not meet at 0.973 m.
  const double bound = 0.25 * kVoxelSizeM;
  int stuck = 0;
  int agree = 0;
  double worst = 0.0, worstBefore = 0.0;
  for (size_t i = 0; i < grid.size(); ++i) {
    const double h = surfaceHeight(forge, grid[i], edits);
    // A column that needed to move further than the bound and did not move AT
    // ALL is the defect: not a rough floor, a hole in one. Exactly zero.
    if (std::fabs(before[i] - target) > bound
        && std::fabs(h - before[i]) < 1e-9) ++stuck;
    worst = std::max(worst, std::fabs(h - target));
    worstBefore = std::max(worstBefore, std::fabs(before[i] - target));
    // The shell and the surface still agree at every sample: rock just below the
    // reported ground, air just above it. This is the DW-26 pair, and it is now
    // asked of the CONTINUOUS shape at half a cell rather than of the quantised
    // shape at 1.5 cells, because the field can answer at that resolution.
    const double rr = forge.radiusM + h;
    const bool below = solidAt(forge, grid[i] * (rr - 0.5 * kVoxelSizeM), edits);
    const bool above = solidAt(forge, grid[i] * (rr + 0.5 * kVoxelSizeM), edits);
    if (below && !above) ++agree;
  }
  std::printf("    levelled pad, %zu columns: worst departure from target "
              "%.6f m after, %.4f m before; %d stuck, %d of %zu agree with the "
              "shell (WG-23 on the cell model: 3.45 m before, 1.08 m after)\n",
              grid.size(), worst, worstBefore, stuck, agree, grid.size());
  CHECK(stuck == 0);
  // Every column, not the median.
  CHECK(worst <= bound);
  CHECK(agree == static_cast<int>(grid.size()));

  // Still idempotent, and the second pass still moves nothing.
  const LevelResult again = levelArea(forge, edits, u * (forge.radiusM + target),
                                      radiusM, target);
  CHECK(again.dug == 0 && again.filled == 0);
  const size_t ov = edits.overrideCount();
  levelArea(forge, edits, u * (forge.radiusM + target), radiusM, target);
  CHECK(edits.overrideCount() == ov);
}

// =============================================================================
// Levelling is deterministic, and it survives a save/load round trip with the
// SURFACE intact, not merely the byte count.
// =============================================================================
TEST(level_is_deterministic_and_round_trips) {
  const BodyParams forge = makeForge(20260616ull);
  const Vec3 u = unitOf(latLonToDir(1.00, -0.90));   // the sloped site again
  const double target = baseHeight(forge, u) - 1.0;
  const Vec3 centre = u * (forge.radiusM + target);

  DensityField a, b;
  const LevelResult ra = levelArea(forge, a, centre, 6.0, target);
  const LevelResult rb = levelArea(forge, b, centre, 6.0, target);
  CHECK(ra.dug == rb.dug && ra.filled == rb.filled);
  CHECK(ra.scanned == rb.scanned);
  CHECK(a.overrideCount() == b.overrideCount());
  CHECK(a.airCount() == b.airCount() && a.rockCount() == b.rockCount());
  CHECK(asBits(surfaceHeight(forge, u, a)) == asBits(surfaceHeight(forge, u, b)));
  // The pad really needed FILL as well as cut, so the round trip below is
  // exercising both halves of the diff. (Old assertion: addedCount() > 0.)
  CHECK(a.rockCount() > 0);
  CHECK(a.airCount() > 0);

  // Byte-for-byte determinism of the save itself, not only of the surface.
  ByteWriter wa, wb;
  a.serialize(wa);
  b.serialize(wb);
  CHECK(wa.buf == wb.buf);

  ByteReader rd(wa.buf);
  DensityField back;
  CHECK(back.deserialize(rd));
  CHECK(back.overrideCount() == a.overrideCount());
  CHECK(back.airCount() == a.airCount());
  CHECK(back.rockCount() == a.rockCount());
  std::printf("    level round trip: %d cells cut, %d filled, %zu corner "
              "overrides, %zu save bytes; surface bit-identical after reload\n",
              ra.dug, ra.filled, a.overrideCount(), wa.buf.size());

  // REPLACES the old per-id set walk (removedSet()/addedSet() no longer exist).
  // The property that mattered was never "the same ids came back", it was "the
  // same SURFACE came back", so ask the oracle over the whole pad.
  std::vector<Vec3> pad;
  pad.push_back(u);
  ringDirs(forge, u, 2.0, 12, pad);
  ringDirs(forge, u, 5.0, 12, pad);
  ringDirs(forge, u, 20.0, 12, pad);      // and untouched ground outside it
  for (size_t i = 0; i < pad.size(); ++i) {
    CHECK(asBits(surfaceHeight(forge, pad[i], back)) ==
          asBits(surfaceHeight(forge, pad[i], a)));
    CHECK(back.solidCell(forge, cellForPos(pad[i] * (forge.radiusM + target))) ==
          a.solidCell(forge, cellForPos(pad[i] * (forge.radiusM + target))));
  }

  // A PRE-WG-24 stream (a VoxelEdits slot: bare [count][ids...], no magic) is
  // REFUSED rather than misread, which is how the persistence layer routes a
  // legacy binary-occupancy slot to VoxelEdits' own reader. Slots written before
  // the density field existed must not be bricked, and must not be swallowed
  // here as if they were densities.
  ByteWriter legacy;
  legacy.varint(2);
  legacy.varint(1234567ull);
  legacy.varint(7654321ull);
  ByteReader lr(legacy.buf);
  DensityField old;
  CHECK(!old.deserialize(lr));
  CHECK(old.empty());
}
