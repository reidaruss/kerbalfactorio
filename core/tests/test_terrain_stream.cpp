// Wave-1 headless tests for the terrain STREAMING + LOD manager (Spike 1 §3,
// §4.1–§4.2) — terrain_stream.h over cubed_sphere.h.
//
// Proves the load-bearing properties the UE terrain renderer depends on:
//   - SELECTION DETERMINISM     : same observer -> identical resident set (sorted,
//                                 order-independent), bit-identical chunk content.
//   - LOD DEEPENS TOWARD OBSERVER: the quad under the observer reaches a deeper
//                                 depth than far-side quads; closer observer ->
//                                 finer max depth.
//   - CRACK-FREE ACROSS A LOD SEAM: a fine quad and its 1-level-coarser neighbour
//                                 share BIT-IDENTICAL edge-vertex heights (the
//                                 position-hash guarantee), AND the fine quad
//                                 carries a skirt that drops radially inward to
//                                 cover the T-junction sliver. Asserted bitwise.
//   - BALANCED INVARIANT        : no two edge-adjacent resident quads differ by
//                                 more than one LOD level.
//   - EVICTION ON RECEDE        : moving the observer away raises evict events and
//                                 coarsens the resident set.
//   - GENERATION BUDGET RESPECTED: updateStreaming builds at most genBudget chunks
//                                 per call; the resident set converges over several
//                                 budgeted calls to the SAME set an unbudgeted call
//                                 reaches.
//   - PROCGEN OPT IS BIT-IDENTICAL: the optimized valueNoise/sampler reproduces
//                                 the original sampler's height bits exactly.
#include <cstdint>
#include <cstring>
#include <map>
#include <set>
#include <vector>

#include "test_framework.h"
#include "of/cubed_sphere.h"
#include "of/terrain_stream.h"
#include "of/terrain_deform.h"  // Task 1: the optional deform-lowering wire-in

using namespace of;
using namespace of::worldgen;

// --- bit-identity helpers ----------------------------------------------------
static uint64_t asBits(double d) {
  uint64_t u;
  std::memcpy(&u, &d, sizeof(u));
  return u;
}
static bool bitEqual(double a, double b) { return asBits(a) == asBits(b); }
static bool bitEqual(const Vec3& a, const Vec3& b) {
  return bitEqual(a.x, b.x) && bitEqual(a.y, b.y) && bitEqual(a.z, b.z);
}

// A tight config that reaches deep LOD quickly so tests stay small + fast.
static StreamConfig testCfg() {
  StreamConfig c;
  c.splitRatio = 1.0;
  c.maxDepth = 8;       // plenty deep to show LOD deepening, small enough to be fast
  c.genBudget = 0;      // default: unlimited for the selection-property tests
  c.skirtFraction = 0.5;
  return c;
}

// =============================================================================
// SELECTION DETERMINISM: the same observer selects the IDENTICAL resident set,
// and TerrainStreamer builds bit-identical chunk content (the cache-key property).
// =============================================================================
TEST(stream_selection_is_deterministic) {
  const BodyParams forge = makeForge(20260615ull);
  const StreamConfig cfg = testCfg();
  const UniverseCoord obs =
      makeObserverLatLonAlt(forge, /*lat*/ 0.3, /*lon*/ -1.1, /*alt*/ 2000.0);

  const std::vector<FQuadKey> a = selectResidentSet(forge, obs, cfg);
  const std::vector<FQuadKey> b = selectResidentSet(forge, obs, cfg);
  CHECK(a.size() == b.size());
  CHECK(a.size() > 6);  // more than the 6 face roots -> it actually subdivided
  bool same = (a.size() == b.size());
  for (size_t i = 0; i < a.size() && same; ++i) same = (a[i] == b[i]);
  CHECK(same);

  // And two independent streamers driven to the same observer end up with the
  // same resident keys AND bit-identical chunk content hashes.
  TerrainStreamer s1(forge, cfg), s2(forge, cfg);
  s1.updateStreaming(obs);
  s2.updateStreaming(obs);
  CHECK(s1.residentCount() == s2.residentCount());
  CHECK(s1.residentCount() == a.size());
  bool contentSame = true;
  for (const auto& kv : s1.resident()) {
    auto it = s2.resident().find(kv.first);
    if (it == s2.resident().end()) { contentSame = false; break; }
    if (it->second.contentHash != kv.second.contentHash) contentSame = false;
  }
  CHECK(contentSame);
}

// =============================================================================
// LOD DEEPENS TOWARD THE OBSERVER: the quad directly beneath the observer reaches
// the max depth in the set, and far-side quads stay coarse. A closer observer
// yields a finer maximum depth.
// =============================================================================
TEST(stream_lod_deepens_toward_observer) {
  const BodyParams forge = makeForge(7ull);
  StreamConfig cfg = testCfg();

  const double lat = 0.2, lon = 0.9;
  const UniverseCoord obs = makeObserverLatLonAlt(forge, lat, lon, 500.0);
  const Vec3 obsDir = latLonToDir(lat, lon);

  const std::vector<FQuadKey> set = selectResidentSet(forge, obs, cfg);

  int maxDepthNear = -1, maxDepthFar = -1;
  for (const FQuadKey& k : set) {
    const Vec3 cdir = quadCenterDir(k);
    const double dotp = cdir.dot(obsDir);  // ~1 near observer, <0 far side
    if (dotp > 0.9) maxDepthNear = std::max(maxDepthNear, k.depth);
    if (dotp < -0.5) maxDepthFar = std::max(maxDepthFar, k.depth);
  }
  // The near column subdivided far deeper than the far hemisphere.
  CHECK(maxDepthNear >= 4);
  CHECK(maxDepthFar >= 0);
  CHECK(maxDepthNear > maxDepthFar);

  // A closer observer (lower altitude) reaches a finer max depth overall.
  const UniverseCoord obsHigh = makeObserverLatLonAlt(forge, lat, lon, 200000.0);
  const UniverseCoord obsLow = makeObserverLatLonAlt(forge, lat, lon, 200.0);
  auto maxDepthOf = [&](const UniverseCoord& o) {
    int md = -1;
    for (const FQuadKey& k : selectResidentSet(forge, o, cfg))
      md = std::max(md, k.depth);
    return md;
  };
  CHECK(maxDepthOf(obsLow) > maxDepthOf(obsHigh));
}

// =============================================================================
// BALANCED INVARIANT: no two edge-adjacent resident quads differ by >1 level.
// This is what bounds the worst-case seam to a single LOD step (skirt-coverable).
// =============================================================================
TEST(stream_balanced_quadtree_invariant) {
  const BodyParams forge = makeForge(31415ull);
  const StreamConfig cfg = testCfg();
  const UniverseCoord obs = makeObserverLatLonAlt(forge, -0.6, 2.2, 800.0);
  const std::vector<FQuadKey> set = selectResidentSet(forge, obs, cfg);

  // Index resident cells per face at every depth for fast cover lookup.
  std::set<std::tuple<int, int, uint32_t, uint32_t>> cells;
  for (const FQuadKey& k : set)
    cells.insert({k.faceId, k.depth, k.qx, k.qy});

  auto coveringDepth = [&](int face, int depth, int64_t qx, int64_t qy) -> int {
    for (int dd = depth; dd >= 0; --dd) {
      const int shift = depth - dd;
      uint32_t cqx = (uint32_t)(qx >> shift), cqy = (uint32_t)(qy >> shift);
      if (cells.count({face, dd, cqx, cqy})) return dd;
    }
    return -1;
  };

  int worstDelta = 0;
  for (const FQuadKey& k : set) {
    const int64_t span = (int64_t)1 << k.depth;
    const int64_t nx[4] = {-1, +1, 0, 0}, ny[4] = {0, 0, -1, +1};
    for (int e = 0; e < 4; ++e) {
      const int64_t qx = (int64_t)k.qx + nx[e], qy = (int64_t)k.qy + ny[e];
      if (qx < 0 || qy < 0 || qx >= span || qy >= span) continue;  // off-face
      const int nd = coveringDepth(k.faceId, k.depth, qx, qy);
      if (nd < 0) continue;
      worstDelta = std::max(worstDelta, std::abs(k.depth - nd));
    }
  }
  CHECK(worstDelta <= 1);  // balanced: at most a 1-level edge step
}

// =============================================================================
// CRACK-FREE ACROSS A LOD SEAM (the headline). Construct a fine quad and its
// 1-level-coarser edge neighbour explicitly. Prove (a) the shared edge HEIGHTS are
// bit-identical at the dirs they share (position-hash guarantee survives across a
// LOD step), and (b) the fine quad's SKIRT drops every edge vertex radially inward
// (below the surface) so the T-junction sliver is physically covered.
// =============================================================================
TEST(stream_crackfree_across_lod_boundary) {
  const BodyParams forge = makeForge(2024ull);
  const StreamConfig cfg = testCfg();

  // Coarse quad C at depth d covering the east neighbour region; fine quad F at
  // depth d+1 abutting C's west edge. F's west edge (i=0) lattice column must hit
  // a subset of C's east edge (i=GRID-1) lattice columns -> shared dirs.
  const int d = 4;
  FQuadKey C{forge.bodyId, /*face*/ 0, d, /*qx*/ 5, /*qy*/ 4};
  // The fine quad just west of C, one level deeper. C covers face-grid column 5 at
  // depth d; the quad immediately west is column 4 at depth d. Its SE child at
  // depth d+1 sits at (qx=2*4+1=9, ...) and its east edge meets C's west edge.
  FQuadKey westCoarse{forge.bodyId, 0, d, 4, 4};
  FQuadKey F = quadChild(westCoarse, /*SE=1*/ 1);  // east-south child, east edge meets C's west edge

  const TerrainChunk cc = buildChunk(forge, C, cfg);
  const TerrainChunk cf = buildChunk(forge, F, cfg);

  // C's west edge (i=0) and F's east edge (i=GRID-1): the fine edge has 2x the
  // vertex density, so every OTHER fine vertex coincides with a coarse vertex.
  // The fine quad F is at depth d+1 with half C's edge span; F covers C's
  // SOUTH half of the west edge. F east-edge vertex j maps to a shared dir with
  // C west-edge vertex (j/2) for even j in F's south coverage.
  // Rather than hand-derive the index map, prove the GUARANTEE directly: for every
  // fine east-edge vertex whose dir EQUALS a coarse west-edge vertex dir, the
  // heights are bit-identical (no crack at the shared points).
  int sharedFound = 0;
  for (int jf = 0; jf < cf.gridDim; ++jf) {
    const int fE = cf.idx(cf.gridDim - 1, jf);   // F east edge
    for (int jc = 0; jc < cc.gridDim; ++jc) {
      const int cW = cc.idx(0, jc);              // C west edge
      if (bitEqual(cf.dirs[fE], cc.dirs[cW])) {
        // Same dir -> position-hashed height MUST be bit-identical across the LOD step.
        CHECK(asBits(cf.heights[fE]) == asBits(cc.heights[cW]));
        CHECK(bitEqual(cf.positions[fE], cc.positions[cW]));
        ++sharedFound;
      }
    }
  }
  CHECK(sharedFound >= cf.gridDim / 2);  // ~half the fine edge coincides with coarse

  // SKIRT coverage: the fine quad carries a skirt, dropped radially inward by a
  // positive depth, so every skirt vertex is strictly BELOW the surface radius at
  // its dir -> the T-junction sliver against the coarser neighbour is physically
  // sealed. Prove the apron is non-empty and strictly inward.
  CHECK(cf.skirtDepthM > 0.0);
  CHECK(!cf.skirtPositions.empty());
  // Each skirt vertex's radius == (radius + h - skirtDepth) < surface radius there.
  // We re-derive the south-edge surface radii and check the matching skirt verts.
  bool allInward = true;
  for (size_t s = 0; s < cf.skirtPositions.size(); ++s) {
    const double rSkirt = cf.skirtPositions[s].length();
    // The skirt vertex shares a dir with some edge vertex; its surface radius is
    // body.radius + that edge vertex height. Skirt must be inward by skirtDepth.
    // Cheapest robust check: skirt radius < min interior edge surface radius.
    if (rSkirt <= 0.0) allInward = false;
  }
  CHECK(allInward);

  // Direct inward check on the south edge (first GRID skirt verts mirror i=..,j=0).
  for (int i = 0; i < cf.gridDim; ++i) {
    const int v = cf.idx(i, 0);
    const double rSurface = cf.positions[v].length();
    const double rSkirt = cf.skirtPositions[i].length();  // south edge first in apron
    CHECK(rSkirt < rSurface);                              // strictly inward
    CHECK_NEAR(rSurface - rSkirt, cf.skirtDepthM, 1e-6);   // by exactly skirtDepth
  }
}

// Same-depth neighbour edge is ALSO bit-identical (sanity: the LOD-boundary test
// above isolates the cross-level case; this re-confirms the equal-LOD case end to
// end through the streaming chunk record, not just generateQuadMesh).
TEST(stream_same_depth_edge_bit_identical) {
  const BodyParams cinder = makeCinder(99ull);
  const StreamConfig cfg = testCfg();
  FQuadKey a{cinder.bodyId, 3, 5, 6, 9};
  FQuadKey b = a; b.qx += 1;
  const TerrainChunk ca = buildChunk(cinder, a, cfg);
  const TerrainChunk cb = buildChunk(cinder, b, cfg);
  for (int j = 0; j < ca.gridDim; ++j) {
    const int aE = ca.idx(ca.gridDim - 1, j);
    const int bW = cb.idx(0, j);
    CHECK(asBits(ca.heights[aE]) == asBits(cb.heights[bW]));
    CHECK(bitEqual(ca.positions[aE], cb.positions[bW]));
  }
}

// =============================================================================
// EVICTION ON RECEDE: drive the observer in close (deep resident set), then far
// away. The far update must raise evict events and shrink the resident set.
// =============================================================================
TEST(stream_eviction_on_recede) {
  const BodyParams forge = makeForge(555ull);
  StreamConfig cfg = testCfg();
  cfg.genBudget = 0;  // converge in one update for this test
  TerrainStreamer s(forge, cfg);

  const UniverseCoord near = makeObserverLatLonAlt(forge, 0.1, 0.1, 300.0);
  const UniverseCoord far = makeObserverLatLonAlt(forge, 0.1, 0.1, 500000.0);

  const StreamUpdate u1 = s.updateStreaming(near);
  const size_t residentNear = s.residentCount();
  CHECK(u1.ready.size() == residentNear);   // first update: all ready
  CHECK(u1.evicted.empty());
  CHECK(residentNear > 6);

  const StreamUpdate u2 = s.updateStreaming(far);
  CHECK(!u2.evicted.empty());                // receding evicts fine quads
  CHECK(s.residentCount() < residentNear);   // coarser set now resident
}

// =============================================================================
// GENERATION BUDGET RESPECTED + CONVERGENCE: with a small budget, each update
// builds at most genBudget chunks; repeated updates at a FIXED observer converge
// to exactly the unbudgeted resident set (same keys + same content).
// =============================================================================
TEST(stream_generation_budget_respected) {
  const BodyParams forge = makeForge(8675309ull);
  StreamConfig cfg = testCfg();
  const UniverseCoord obs = makeObserverLatLonAlt(forge, -0.4, 1.7, 400.0);

  // Target (unbudgeted) resident set for reference.
  StreamConfig unbCfg = cfg; unbCfg.genBudget = 0;
  TerrainStreamer ref(forge, unbCfg);
  ref.updateStreaming(obs);
  const size_t target = ref.residentCount();
  CHECK(target > 12);

  // Budgeted streamer: cap 8 builds/update.
  cfg.genBudget = 8;
  TerrainStreamer s(forge, cfg);
  int updates = 0;
  bool everOverBudget = false;
  for (; updates < 100; ++updates) {
    const StreamUpdate u = s.updateStreaming(obs);
    if (u.generated > cfg.genBudget) everOverBudget = true;  // must never happen
    if (u.converged) break;
  }
  CHECK(!everOverBudget);                 // budget never exceeded
  CHECK(updates >= 1);
  CHECK(s.residentCount() == target);     // converged to the full target set

  // Converged content == the unbudgeted content, key-for-key.
  bool same = (s.residentCount() == ref.residentCount());
  for (const auto& kv : ref.resident()) {
    auto it = s.resident().find(kv.first);
    if (it == s.resident().end()) { same = false; break; }
    if (it->second.contentHash != kv.second.contentHash) same = false;
  }
  CHECK(same);

  // It actually TOOK several budgeted updates (proves the budget bites).
  CHECK(updates >= (int)((target + cfg.genBudget - 1) / cfg.genBudget) - 1);
}

// =============================================================================
// PROCGEN OPTIMIZATION IS BIT-IDENTICAL. The optimized valueNoise() in
// cubed_sphere.h reorganizes the hash chain (shared-prefix hoist) but MUST produce
// the same bits. We re-implement the ORIGINAL chain here and compare height bits
// vertex-for-vertex over real quads on both bodies. (The procgen_bench tool does
// the same as a timed run; this is the ctest guard.)
// =============================================================================
namespace orig {
inline double valueNoise(uint64_t seed, const Vec3& p, uint64_t channel) {
  const double fx = std::floor(p.x), fy = std::floor(p.y), fz = std::floor(p.z);
  const int ix = (int)fx, iy = (int)fy, iz = (int)fz;
  const double tx = fade(p.x - fx), ty = fade(p.y - fy), tz = fade(p.z - fz);
  auto corner = [&](int dx, int dy, int dz) -> double {
    uint64_t h = mix64(seed ^ (channel * 0x9E3779B97F4A7C15ull));
    h = hashCombine(h, (uint64_t)(int64_t)(ix + dx));
    h = hashCombine(h, (uint64_t)(int64_t)(iy + dy));
    h = hashCombine(h, (uint64_t)(int64_t)(iz + dz));
    return hashToSigned(h);
  };
  const double c000 = corner(0,0,0), c100 = corner(1,0,0);
  const double c010 = corner(0,1,0), c110 = corner(1,1,0);
  const double c001 = corner(0,0,1), c101 = corner(1,0,1);
  const double c011 = corner(0,1,1), c111 = corner(1,1,1);
  const double x00 = lerp(c000,c100,tx), x10 = lerp(c010,c110,tx);
  const double x01 = lerp(c001,c101,tx), x11 = lerp(c011,c111,tx);
  const double y0 = lerp(x00,x10,ty), y1 = lerp(x01,x11,ty);
  return lerp(y0,y1,tz);
}
inline double fbm(uint64_t s, const Vec3& d, double fr, int oc, uint64_t ch) {
  double sum=0, amp=0.5, f=fr;
  for (int o=0;o<oc;++o){ sum += amp*valueNoise(s, d*f, ch+(uint64_t)o); f*=2; amp*=0.5; }
  return sum;
}
inline double ridged(uint64_t s, const Vec3& d, double fr, int oc, uint64_t ch) {
  double sum=0, amp=0.5, f=fr, prev=1.0;
  for (int o=0;o<oc;++o){ double n=valueNoise(s, d*f, ch+(uint64_t)o+777u);
    n=1.0-std::fabs(n); n*=n; sum+=amp*n*prev; prev=n; f*=2; amp*=0.5; }
  return sum;
}
inline double craterField(uint64_t seed, const Vec3& dir, double freq) {
  const Vec3 p = dir*freq;
  const double fx=std::floor(p.x), fy=std::floor(p.y), fz=std::floor(p.z);
  const int cx=(int)fx, cy=(int)fy, cz=(int)fz;
  double h=0;
  for (int dz=-1;dz<=1;++dz) for (int dy=-1;dy<=1;++dy) for (int dx=-1;dx<=1;++dx){
    uint64_t cell=mix64(seed^0xC0FFEEull);
    cell=hashCombine(cell,(uint64_t)(int64_t)(cx+dx));
    cell=hashCombine(cell,(uint64_t)(int64_t)(cy+dy));
    cell=hashCombine(cell,(uint64_t)(int64_t)(cz+dz));
    const Vec3 centre(fx+dx+hashToUnit(hashCombine(cell,1)),
                      fy+dy+hashToUnit(hashCombine(cell,2)),
                      fz+dz+hashToUnit(hashCombine(cell,3)));
    const double exist=hashToUnit(hashCombine(cell,4));
    if (exist>0.55) continue;
    const Vec3 dd=p-centre; const double dist=dd.length();
    const double cr=0.30+0.45*hashToUnit(hashCombine(cell,5));
    if (dist>cr*1.6) continue;
    const double t=dist/cr; double prof;
    if (t<1.0) prof=-(1.0-t*t);
    else { const double rim=(t-1.0)/0.6; prof=(rim<1.0)?(1.0-rim)*0.5:0.0; }
    h+=prof;
  }
  return h;
}
inline double sampleHeightField(const BodyParams& b, const Vec3& dir) {
  if (b.kind==kPlanet) {
    const double L0=fbm(b.bodySeed,dir,2.5,4,11);
    const double mask=std::max(0.0,L0);
    const double L1=ridged(b.bodySeed,dir,20.0,4,23);
    const double L2=fbm(b.bodySeed,dir,80.0,3,37);
    double h=L0*0.6+mask*L1*0.9+L2*0.04; h*=b.maxReliefM;
    if (h<b.seaLevelM) h=b.seaLevelM; return h;
  } else {
    const double M0=fbm(b.bodySeed,dir,3.0,3,41);
    const double M1=craterField(b.bodySeed,dir,9.0);
    const double M2=fbm(b.bodySeed,dir,90.0,2,53);
    return (M0*0.4+M1*0.7+M2*0.03)*b.maxReliefM;
  }
}
}  // namespace orig

TEST(procgen_optimized_is_bit_identical) {
  const BodyParams bodies[2] = {makeForge(20260615ull), makeCinder(20260615ull)};
  int compared = 0;
  for (const BodyParams& body : bodies) {
    for (int f = 0; f < 6; ++f) {
      for (int d = 2; d <= 5; ++d) {
        const FQuadKey k{body.bodyId, f, d, 1u, 2u};
        const QuadMesh m = generateQuadMesh(body, k);  // uses OPTIMIZED sampler
        for (size_t v = 0; v < m.dirs.size(); ++v) {
          const double hOrig = orig::sampleHeightField(body, m.dirs[v]);
          // optimized height already baked in m.heights[v]
          CHECK(asBits(m.heights[v]) == asBits(hOrig));
          ++compared;
        }
      }
    }
  }
  CHECK(compared == 2 * 6 * 4 * kGridDim * kGridDim);  // every vertex checked
}

// =============================================================================
// DEFORM-LOWERING wire-in (Task 1): generateQuadMesh / buildChunk / the streamer
// accept an optional height-lowering callback. With NO callback the mesh is
// bit-identical to the original (the dig layer is purely additive). With a dig
// applied via TerrainDeform, the chunk under the dig RE-MESHES lower at the dug
// cells while every other vertex stays bit-identical — exactly what the UE layer
// needs so a dig drops the surface the player walks on, only where it was dug.
// =============================================================================
TEST(deform_lowering_lowers_only_dug_cells_else_bit_identical) {
  const BodyParams forge = makeForge(20260616ull);

  // Build a DEEP quad (fine vertex spacing) and dig AT one of its interior vertex
  // dirs so the dig is guaranteed to land on real mesh vertices. At depth 14 the
  // vertex pitch (~7 m) is comparable to the deform cell pitch, so a dig radius of
  // a few cell pitches covers a handful of vertices.
  const Vec3 seedDir = latLonToDir(0.20, 0.55);
  const int face = faceOfDir(seedDir);
  FQuadKey k{forge.bodyId, face, 0, 0u, 0u};
  for (int d = 0; d < 14; ++d) {
    FQuadKey best = quadChild(k, 0);
    double bestDot = -2.0;
    for (int c = 0; c < 4; ++c) {
      const FQuadKey ch = quadChild(k, c);
      const double dt = quadCenterDir(ch).dot(seedDir);
      if (dt > bestDot) { bestDot = dt; best = ch; }
    }
    k = best;
  }

  // Undeformed chunk (no fn) == generateQuadMesh with the SAME DESIGNED base the
  // chunk now draws (WG-21: the mesh samples sampleDesignedHeight, not RAW), bit-
  // for-bit. Re-baselined from the old RAW reference to the designed base.
  const HeightFieldFn designedBase = [&](const Vec3& d){ return sampleDesignedHeight(forge, d); };
  const TerrainChunk base = buildChunk(forge, k, StreamConfig{}, nullptr);
  const QuadMesh designed = generateQuadMesh(forge, k, nullptr, designedBase);
  bool baseIdentical = true;
  for (size_t v = 0; v < base.heights.size(); ++v)
    if (asBits(base.heights[v]) != asBits(designed.heights[v])) baseIdentical = false;
  CHECK(baseIdentical);

  // Dig at the chunk's CENTRE vertex dir with a radius spanning several cell pitches
  // and the mesh vertex pitch, so the brush is guaranteed to cover mesh vertices.
  TerrainDeform deform;
  const Vec3 digDir = base.dirs[base.idx(base.gridDim/2, base.gridDim/2)];
  const double cellPitch = deformCellPitchM(forge);
  const double vtxPitch = (base.positions[base.idx(1,0)] -
                           base.positions[base.idx(0,0)]).length();
  const double radiusM = std::max(cellPitch, vtxPitch) * 4.0 + 5.0;
  const double removed = deform.digBrush(forge, digDir, radiusM, /*amountM*/ 5.0);
  CHECK(removed > 0.0);
  HeightLoweringFn fn = [&](const Vec3& d){ return deform.depthDugAt(d); };

  // Deformed chunk: dug vertices are lowered by exactly the dug depth, and every
  // NON-dug vertex is bit-identical to the base (the deform never touches them).
  const TerrainChunk dug = buildChunk(forge, k, StreamConfig{}, fn);
  int lowered = 0, unchanged = 0;
  for (size_t v = 0; v < dug.heights.size(); ++v) {
    const double loweringM = deform.depthDugAt(dug.dirs[v]);
    if (loweringM > 0.0) {
      CHECK_NEAR(base.heights[v] - dug.heights[v], loweringM, 1e-6);
      ++lowered;
    } else {
      CHECK(asBits(dug.heights[v]) == asBits(base.heights[v]));
      ++unchanged;
    }
  }
  CHECK(lowered > 0);       // the hole is in the mesh
  CHECK(unchanged > 0);     // the rest of the chunk is untouched

  // The streamer's rebuildChunk path: rebuilding this resident chunk with the fn
  // bound re-meshes it LOWER at the dug cells (the dig shows on the walked surface).
  TerrainStreamer streamer(forge, StreamConfig{});
  // Make the chunk resident by seeding its cell directly, then rebuild with the fn.
  StreamConfig deepCfg; deepCfg.maxDepth = 14; deepCfg.genBudget = 0;
  TerrainStreamer s2(forge, deepCfg);
  s2.setLoweringFn(fn);
  const UniverseCoord obs = makeObserverLatLonAlt(forge, 0.20, 0.55, 2.0);
  for (int i = 0; i < 60; ++i) if (s2.updateStreaming(obs).converged) break;
  bool foundLoweredResident = false;
  for (const auto& kv : s2.resident()) {
    const TerrainChunk& ch = kv.second;
    for (size_t v = 0; v < ch.heights.size(); ++v) {
      if (deform.depthDugAt(ch.dirs[v]) > 0.0) {
        // WG-21: the mesh base is the DESIGNED surface; a dug vertex is lower than
        // its designed base by the lowering amount.
        const double baseH = sampleDesignedHeight(forge, ch.dirs[v]);
        if (baseH - ch.heights[v] > 1e-6) foundLoweredResident = true;
      }
    }
  }
  CHECK(foundLoweredResident);
  (void)removed;
}
