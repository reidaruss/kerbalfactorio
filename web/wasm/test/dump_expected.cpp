// =============================================================================
// dump_expected.cpp — GROUND-TRUTH generator for the WASM parity test.
//
// Compiled NATIVELY (WinLibs g++, the exact toolchain that builds the 22 green
// ctest suites), it runs a fixed scenario through the SAME flat C API the WASM
// module exports and prints the results as JSON with every double emitted as its
// raw IEEE-754 hex bit pattern (so the JSON round-trip cannot lose a bit).
//
// web/wasm/test/parity.mjs then replays the identical scenario against the WASM
// build and diffs the two JSON documents. Any difference is a real divergence in
// the compiled math, not in the harness: both sides call the same shim over the
// same unmodified /core headers.
//
// It is a unity build (#include of the shim .cpp) on purpose — there is exactly
// one definition of the API under test, so the native and WASM sides cannot
// drift apart.
//
// The scenario deliberately re-uses the pinned values the ctest suites already
// assert (test_surface_field's dig-column / tunnel cases, test_automation's
// auto-line chain and its exact-miner-rate case), so the JSON is anchored to
// ground truth the project already trusts, not merely to itself. The
// SELF-CHECKS block below re-asserts those invariants natively and refuses to
// emit if any of them breaks.
// =============================================================================
#include "../of_core_api.cpp"

#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <vector>
#include <string>

// --- FNV-1a 32-bit over raw bytes. Chosen because JS can reproduce it EXACTLY
// with Math.imul (a 64-bit hash would force BigInt on the JS side). Doubles are
// hashed as their 8 little-endian IEEE bytes, so the hash is bit-sensitive.
static uint32_t g_h = 0;
static void hInit() { g_h = 0x811c9dc5u; }
static void hByte(uint8_t b) { g_h ^= b; g_h *= 0x01000193u; }
static void hBytes(const void* p, size_t n) {
  const uint8_t* b = static_cast<const uint8_t*>(p);
  for (size_t i = 0; i < n; ++i) hByte(b[i]);
}
static void hF64(double d) { hBytes(&d, 8); }
static void hF32(float f) { hBytes(&f, 4); }
static void hI32(int32_t v) { hBytes(&v, 4); }
static uint32_t hEnd() { return g_h; }

// Emit a double as its exact IEEE-754 bit pattern in hex.
static std::string bits(double d) {
  uint64_t u; std::memcpy(&u, &d, 8);
  char buf[32];
  std::snprintf(buf, sizeof(buf), "\"%016llx\"", (unsigned long long)u);
  return std::string(buf);
}

static int g_fail = 0;
#define SELF(cond, msg)                                                        \
  do { if (!(cond)) { std::fprintf(stderr, "SELF-CHECK FAILED: %s\n", msg);    \
                      g_fail = 1; } } while (0)

// The sample directions the whole fixture is built on (fixed lat/lon, radians).
// Chosen to hit several biomes and to stay off the cube-face seams.
struct LL { double lat, lon; };
static const LL kSamples[] = {
    {0.0, 0.0},      {0.30, 0.70},   {-0.45, 2.10},  {1.10, -1.30},
    {1.45, 0.20},    {-1.42, 3.00},  {0.62, -2.55},  {-0.15, 1.05},
};
static const int kNumSamples = 8;

// The dig direction used by the surface-oracle + voxel cases.
static void digDir(double& x, double& y, double& z) {
  const double l = std::sqrt(0.31 * 0.31 + 0.57 * 0.57 + 0.76 * 0.76);
  x = 0.31 / l; y = 0.57 / l; z = 0.76 / l;
}

// =============================================================================
// BENCH mode (`dump_expected.exe --bench`) — the NATIVE baseline for the
// WASM/native perf ratio. Runs exactly the two loops web/wasm/test/parity.mjs
// runs, through the same C API, so the ratio is apples to apples (both include
// the shim's f32 staging, which the browser really pays).
// =============================================================================
static int runBench() {
  const uint32_t kSeedLo = 0x0BF00D01u, kSeedHi = 0x00000000u;
  const int forge = of_body_create_forge(kSeedLo, kSeedHi);

  // --- quad-mesh generation rate -------------------------------------------
  const int kQuads = 60;
  auto t0 = std::chrono::high_resolution_clock::now();
  long long verts = 0;
  for (int q = 0; q < kQuads; ++q) {
    const int face = q % 6;
    const int depth = 3 + (q % 5);
    const uint32_t qx = static_cast<uint32_t>(q) % (1u << depth);
    const uint32_t qy = static_cast<uint32_t>(q * 7) % (1u << depth);
    const int m = of_quadmesh_generate(forge, face, depth, qx, qy, 0, 1);
    verts += of_quadmesh_vertex_count(m);
    of_quadmesh_destroy(m);
  }
  auto t1 = std::chrono::high_resolution_clock::now();
  const double meshSec = std::chrono::duration<double>(t1 - t0).count();

  // --- factory tick rate ----------------------------------------------------
  const int kOre = 0x0033, kIngot = 0x0010, kPart = 0x0040;
  const int net = of_net_create(1.0 / 60.0);
  const int miner   = of_net_place_miner(net, 1e9, kOre, 8.0, 50);
  const int belt1   = of_net_place_belt(net, 2, 32);
  const int smelter = of_net_place_smelter(net, kOre, kIngot, 20, 0, 0);
  const int belt2   = of_net_place_belt(net, 2, 32);
  const int asmb    = of_net_place_assembler(net, kIngot, 1, 0, 0, kPart, 1, 25, 0, 0);
  of_net_connect(net, miner, belt1, 0);
  of_net_connect(net, belt1, smelter, 0);
  of_net_connect(net, smelter, belt2, 0);
  of_net_connect(net, belt2, asmb, 0);
  const int kTicks = 2000000;
  auto t2 = std::chrono::high_resolution_clock::now();
  of_net_step_n(net, kTicks);
  auto t3 = std::chrono::high_resolution_clock::now();
  const double tickSec = std::chrono::duration<double>(t3 - t2).count();

  // --- voxel dig + exposed-face extraction rate -----------------------------
  double dx, dy, dz; digDir(dx, dy, dz);
  const int edits = of_edits_create();
  const double surfR = of_surface_radius(forge, 0, dx, dy, dz);
  const double r = surfR - 2.0;
  auto t4 = std::chrono::high_resolution_clock::now();
  of_edits_dig(edits, forge, dx * r, dy * r, dz * r, 8.0);
  const int faces = of_exposed_faces(forge, edits, dx * r, dy * r, dz * r, 10.0);
  auto t5 = std::chrono::high_resolution_clock::now();
  const double voxSec = std::chrono::duration<double>(t5 - t4).count();

  std::printf("{\"quads\": %d, \"verts\": %lld, \"meshSec\": %.6f, "
              "\"vertsPerSec\": %.0f, \"ticks\": %d, \"tickSec\": %.6f, "
              "\"ticksPerSec\": %.0f, \"voxelFaces\": %d, \"voxelSec\": %.6f}\n",
              kQuads, verts, meshSec, verts / meshSec, kTicks, tickSec,
              kTicks / tickSec, faces, voxSec);
  return 0;
}

// =============================================================================
// DIAG mode (`dump_expected.exe --diag`) — the native side of diag.mjs. Prints
// a libm probe table as JSON and writes the per-vertex terrain-pipeline scan to
// test/diag_scan.bin (8 doubles + 1 int32 per vertex, little-endian).
// =============================================================================
static int runDiag() {
  const uint32_t kSeedLo = 0x0BF00D01u, kSeedHi = 0x00000000u;
  const int forge = of_body_create_forge(kSeedLo, kSeedHi);
  const int kFace = 2, kDepth = 5;
  const uint32_t kQx = 7, kQy = 11;

  // A spread of arguments per function: the domain the terrain code actually
  // uses (latitudes, warp arguments, normalized dirs) plus a few awkward ones.
  static const double kArgs[] = {
      0.0, 0.1, 0.25, 0.5, 0.7853981633974483, 1.0, 1.3, 1.42, 1.5707963267948966,
      2.1, 3.0, -0.15, -0.45, -1.42, -2.55, 0.9999, -0.9999, 0.30, 0.62, 1.10,
      1.45, 0.577350269189626, 0.31, 0.57, 0.76, 123.456, 1e-8, 1e8};
  const int kN = static_cast<int>(sizeof(kArgs) / sizeof(kArgs[0]));

  std::printf("{\n  \"seedLo\": %u, \"seedHi\": %u,\n", kSeedLo, kSeedHi);
  std::printf("  \"scanFace\": %d, \"scanDepth\": %d, \"scanQx\": %u, \"scanQy\": %u,\n",
              kFace, kDepth, kQx, kQy);
  std::printf("  \"libm\": [\n");
  for (int f = 0; f < 12; ++f) {
    std::printf("    [");
    int emitted = 0;
    for (int i = 0; i < kN; ++i) {
      const double a = kArgs[i];
      const double b = kArgs[(i + 7) % kN];
      const double r = of_diag_libm(f, a, b);
      // NaN/Inf would break JSON — skip those inputs for this function.
      if (!(r == r) || r > 1e300 || r < -1e300) continue;
      std::printf("%s{\"a\": %.17g, \"b\": %.17g, \"r\": %.17g}",
                  emitted++ ? ", " : "", a, b, r);
    }
    std::printf("]%s\n", (f == 11) ? "" : ",");
  }
  std::printf("  ]\n}\n");

  // Scan exactly the quads the STREAMER produces (3 budgeted updates around the
  // parity fixture's observer) — i.e. the quads whose chunk content actually
  // diverged — so the stage-by-stage table localises the real cause rather than
  // a quad picked at random.
  FILE* fp = std::fopen("web/wasm/test/diag_scan.bin", "wb");
  if (!fp) fp = std::fopen("diag_scan.bin", "wb");
  if (fp) {
    const int s = of_streamer_create(forge, 1.0, 0.6, 6, 0, 0.5, 16);
    of_observer_latlon_alt(forge, 0.30, 0.70, 20000.0);
    const double* o = of_scratch_f64();
    const double ox = o[0], oy = o[1], oz = o[2];
    std::vector<int32_t> keys;
    for (int u = 0; u < 3; ++u) {
      const int ready = of_streamer_update(s, ox, oy, oz);
      of_streamer_ready_keys(s);
      const int32_t* kp = of_scratch_i32();
      for (int i = 0; i < ready * 4; ++i) keys.push_back(kp[i]);
    }
    of_streamer_destroy(s);
    const int nq = static_cast<int>(keys.size()) / 4;
    for (int q = 0; q < nq; ++q) {
      const int n = of_diag_scan_quad(forge, keys[q * 4 + 0], keys[q * 4 + 1],
                                      static_cast<uint32_t>(keys[q * 4 + 2]),
                                      static_cast<uint32_t>(keys[q * 4 + 3]));
      const double* d = of_scratch_f64();
      std::vector<double> dcopy(d, d + static_cast<size_t>(n) * 8);
      const int32_t* biomes = of_scratch_i32();
      for (int v = 0; v < n; ++v) {
        std::fwrite(&dcopy[static_cast<size_t>(v) * 8], 8, 8, fp);
        std::fwrite(&biomes[v], 4, 1, fp);
      }
    }
    std::fclose(fp);
    std::fprintf(stderr, "diag: scanned %d streamed quads\n", nq);
  }

  // The ROOT probe: std::tan over the EXACT arguments cubed_sphere.h's warp()
  // feeds it — the face-lattice coordinates at every LOD level. unitDir is the
  // sole producer of every sampled direction, and height is position-hashed
  // from that direction's raw bits, so a 1-ULP tan difference here is amplified
  // into a completely different height. This sweep says how often that happens.
  FILE* tf = std::fopen("web/wasm/test/diag_tan.bin", "wb");
  if (!tf) tf = std::fopen("diag_tan.bin", "wb");
  if (tf) {
    for (int L = 0; L <= 14; ++L) {
      const uint64_t span = uint64_t(1) << L;
      const uint64_t step = (span > 511) ? (span / 511) : 1;
      for (uint64_t i = 0; i <= span; i += step) {
        const double s = of::worldgen::latticeCoord(i, L);
        const double a = s * 0.78539816339744830961;
        const double r = std::tan(a);
        std::fwrite(&r, 8, 1, tf);
      }
    }
    std::fclose(tf);
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--bench") return runBench();
  if (argc > 1 && std::string(argv[1]) == "--diag") return runDiag();
  const uint32_t kSeedLo = 0x0BF00D01u, kSeedHi = 0x00000000u;
  const int forge = of_body_create_forge(kSeedLo, kSeedHi);
  const int cinder = of_body_create_cinder(kSeedLo, kSeedHi);

  std::printf("{\n");
  std::printf("  \"abi\": %d,\n", of_abi_version());
  std::printf("  \"seedLo\": %u, \"seedHi\": %u,\n", kSeedLo, kSeedHi);
  std::printf("  \"forgeRadius\": %s,\n", bits(of_body_radius(forge)).c_str());
  std::printf("  \"cinderRadius\": %s,\n", bits(of_body_radius(cinder)).c_str());
  std::printf("  \"forgeSeedLo\": %u,\n", of_body_seed_lo(forge));
  std::printf("  \"forgeSeedHi\": %u,\n", of_last_hi());

  // =========================================================================
  // CASE 1 — terrain heights at fixed (lat,lon): raw, designed, base, surface.
  // =========================================================================
  std::printf("  \"heights\": [\n");
  for (int i = 0; i < kNumSamples; ++i) {
    of_latlon_to_dir(kSamples[i].lat, kSamples[i].lon);
    const double* d = of_scratch_f64();
    const double dx = d[0], dy = d[1], dz = d[2];
    const double raw = of_sample_raw_height_latlon(forge, kSamples[i].lat, kSamples[i].lon);
    const double des = of_sample_designed_height_latlon(forge, kSamples[i].lat, kSamples[i].lon);
    const double base = of_base_height(forge, dx, dy, dz);
    const double surf = of_surface_height(forge, 0, dx, dy, dz);
    const double mraw = of_sample_raw_height_latlon(cinder, kSamples[i].lat, kSamples[i].lon);
    const double mbase = of_base_height(cinder, dx, dy, dz);
    // WG-21 invariant the ctest suite pins: baseHeight IS sampleDesignedHeight,
    // and with no edits surfaceHeight IS baseHeight — bit for bit.
    SELF(std::memcmp(&base, &des, 8) == 0, "baseHeight != designedHeight (Forge)");
    SELF(std::memcmp(&surf, &base, 8) == 0, "undug surfaceHeight != baseHeight");
    std::printf("    {\"dirX\": %s, \"dirY\": %s, \"dirZ\": %s, \"raw\": %s, "
                "\"designed\": %s, \"base\": %s, \"surface\": %s, "
                "\"moonRaw\": %s, \"moonBase\": %s}%s\n",
                bits(dx).c_str(), bits(dy).c_str(), bits(dz).c_str(),
                bits(raw).c_str(), bits(des).c_str(), bits(base).c_str(),
                bits(surf).c_str(), bits(mraw).c_str(), bits(mbase).c_str(),
                (i == kNumSamples - 1) ? "" : ",");
  }
  std::printf("  ],\n");

  // =========================================================================
  // CASE 2 — biome classification + material + hardness at the same dirs.
  // =========================================================================
  std::printf("  \"biomes\": [\n");
  for (int i = 0; i < kNumSamples; ++i) {
    of_latlon_to_dir(kSamples[i].lat, kSamples[i].lon);
    const double* d = of_scratch_f64();
    const int bp = of_biome_at(forge, d[0], d[1], d[2]);
    const int bm = of_biome_at(cinder, d[0], d[1], d[2]);
    const double temp = of_temperature_at(forge, d[0], d[1], d[2]);
    const double moist = of_moisture_at(forge, d[0], d[1], d[2]);
    std::printf("    {\"planet\": %d, \"moon\": %d, \"planetMat\": %d, "
                "\"moonMat\": %d, \"hardness\": %s, \"temp\": %s, \"moist\": %s}%s\n",
                bp, bm, of_material_for_biome(bp), of_material_for_biome(bm),
                bits(of_hardness_for_biome(bp)).c_str(), bits(temp).c_str(),
                bits(moist).c_str(), (i == kNumSamples - 1) ? "" : ",");
  }
  std::printf("  ],\n");

  // =========================================================================
  // CASE 3 — full generateQuadMesh: content hash + per-vertex height hash +
  // f32 position/normal hashes + a few exact vertex heights.
  // =========================================================================
  {
    const int m = of_quadmesh_generate(forge, 2, 5, 7, 11, 0, /*designed*/ 1);
    const int n = of_quadmesh_vertex_count(m);
    const uint32_t hlo = of_quadmesh_content_hash_lo(m);
    const uint32_t hhi = of_last_hi();
    const double* hs = of_quadmesh_heights_f64(m);
    hInit(); for (int i = 0; i < n; ++i) hF64(hs[i]);
    const uint32_t heightHash = hEnd();
    const float* ps = of_quadmesh_positions_f32(m);
    hInit(); for (int i = 0; i < n * 3; ++i) hF32(ps[i]);
    const uint32_t posHash = hEnd();
    const float* ns = of_quadmesh_normals_f32(m);
    hInit(); for (int i = 0; i < n * 3; ++i) hF32(ns[i]);
    const uint32_t nrmHash = hEnd();
    of_quadmesh_center(m);
    const double* c = of_scratch_f64();
    const double cx = c[0], cy = c[1], cz = c[2];

    // RAW-base variant (the historical cubed_sphere path) as a second probe.
    const int mr = of_quadmesh_generate(forge, 2, 5, 7, 11, 0, /*designed*/ 0);
    const uint32_t rlo = of_quadmesh_content_hash_lo(mr);
    const uint32_t rhi = of_last_hi();

    // Crack-free proof: the shared edge between this quad and its east
    // neighbour must be bit-identical. Sample both and hash the shared column.
    const int me = of_quadmesh_generate(forge, 2, 5, 8, 11, 0, 1);
    const double* he = of_quadmesh_heights_f64(me);
    const double* hm = of_quadmesh_heights_f64(m);
    const int G = of_quadmesh_grid_dim(m);
    int seamOk = 1;
    for (int j = 0; j < G; ++j) {
      const double a = hm[j * G + (G - 1)];   // east edge of this quad
      const double b = he[j * G + 0];         // west edge of the neighbour
      if (std::memcmp(&a, &b, 8) != 0) seamOk = 0;
    }
    SELF(seamOk == 1, "shared-edge heights are not bit-identical (crack-free)");

    std::printf("  \"quadmesh\": {\"gridDim\": %d, \"vertexCount\": %d, "
                "\"contentHashLo\": %u, \"contentHashHi\": %u, "
                "\"rawContentHashLo\": %u, \"rawContentHashHi\": %u, "
                "\"heightHash\": %u, \"posHash\": %u, \"nrmHash\": %u, "
                "\"centerX\": %s, \"centerY\": %s, \"centerZ\": %s, "
                "\"chunkRadius\": %s, \"h0\": %s, \"h544\": %s, \"h1088\": %s, "
                "\"seamOk\": %d},\n",
                G, n, hlo, hhi, rlo, rhi, heightHash, posHash, nrmHash,
                bits(cx).c_str(), bits(cy).c_str(), bits(cz).c_str(),
                bits(of_quadmesh_chunk_radius(m)).c_str(),
                bits(hs[0]).c_str(), bits(hs[544]).c_str(), bits(hs[1088]).c_str(),
                seamOk);
    of_quadmesh_destroy(m); of_quadmesh_destroy(mr); of_quadmesh_destroy(me);
  }

  // Index buffer (renderer-facing, deterministic).
  {
    const int ic = of_grid_indices(33);
    const uint16_t* ip = of_grid_indices_ptr();
    hInit(); hBytes(ip, static_cast<size_t>(ic) * 2);
    std::printf("  \"indices\": {\"count\": %d, \"hash\": %u},\n", ic, hEnd());
  }

  // =========================================================================
  // CASE 4 — surface oracle BEFORE and AFTER a dig-down column (the
  // test_surface_field dig_column_lowers_surface_by_derived_amount case).
  // =========================================================================
  {
    double dx, dy, dz; digDir(dx, dy, dz);
    const double before = of_base_height(forge, dx, dy, dz);
    const double surfR = of_surface_radius(forge, 0, dx, dy, dz);
    const int edits = of_edits_create();
    const int N = 6;   // carve 6 one-metre cells straight down from the surface
    for (int k = 0; k < N; ++k) {
      const double r = surfR - (static_cast<double>(k) + 0.5);
      of_edits_dig_cell_at(edits, dx * r, dy * r, dz * r);
    }
    const double lowering = of_derived_lowering(forge, edits, dx, dy, dz);
    const double after = of_surface_height(forge, edits, dx, dy, dz);
    // ctest invariant: the surface drops by EXACTLY the derived lowering, and
    // the lowering is ~N metres (1 m quantization tolerance).
    SELF(lowering >= (N - 1) * 1.0 && lowering <= (N + 1) * 1.0,
         "dig-column lowering out of the +/-1 m band");
    SELF(std::fabs((before - after) - lowering) < 1e-9,
         "surfaceHeight did not drop by exactly the derived lowering");
    std::printf("  \"digColumn\": {\"cells\": %d, \"before\": %s, \"after\": %s, "
                "\"lowering\": %s, \"removed\": %d},\n",
                N, bits(before).c_str(), bits(after).c_str(),
                bits(lowering).c_str(), of_edits_removed_count(edits));
    of_edits_destroy(edits);
  }

  // =========================================================================
  // CASE 5 — HORIZONTAL TUNNEL: removal below the surface leaves the ceiling
  // solid, so the heightfield view sees NO lowering (test_surface_field
  // horizontal_tunnel_no_surface_lowering).
  // =========================================================================
  {
    double dx, dy, dz; digDir(dx, dy, dz);
    const int edits = of_edits_create();
    const double surfR = of_surface_radius(forge, 0, dx, dy, dz);
    // A tangent direction to drive the tunnel along.
    double tx = -dy, ty = dx, tz = 0.0;
    const double tl = std::sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl; ty /= tl; tz /= tl;
    const double depth = 12.0;                    // 12 m below the surface
    const double baseR = surfR - depth;
    int removed = 0;
    const int steps = 10;
    for (int k = 0; k < steps; ++k) {
      const double s = static_cast<double>(k) * 2.0;
      const double px = dx * baseR + tx * s;
      const double py = dy * baseR + ty * s;
      const double pz = dz * baseR + tz * s;
      removed += of_edits_dig(edits, forge, px, py, pz, 1.4);
    }
    // Every column over the tunnel must keep its ceiling: zero lowering.
    int noLowering = 0;
    hInit();
    for (int k = 0; k < steps; ++k) {
      const double s = static_cast<double>(k) * 2.0;
      double cx = dx * baseR + tx * s, cy = dy * baseR + ty * s,
             cz = dz * baseR + tz * s;
      const double l = std::sqrt(cx * cx + cy * cy + cz * cz);
      cx /= l; cy /= l; cz /= l;
      const double low = of_derived_lowering(forge, edits, cx, cy, cz);
      const double sh = of_surface_height(forge, edits, cx, cy, cz);
      const double bh = of_base_height(forge, cx, cy, cz);
      hF64(low); hF64(sh);
      if (low == 0.0 && std::memcmp(&sh, &bh, 8) == 0) ++noLowering;
    }
    const uint32_t tunnelHash = hEnd();
    SELF(removed > 0, "tunnel removed no cells");
    SELF(noLowering == steps, "tunnel produced surface lowering (ceiling lost)");
    // The ceiling directly above the tunnel is still SOLID.
    const double ceilR = surfR - depth + 3.0;
    const int ceilingSolid = of_solid_at(forge, edits, dx * ceilR, dy * ceilR, dz * ceilR);
    SELF(ceilingSolid == 1, "tunnel ceiling is not solid");
    std::printf("  \"tunnel\": {\"removed\": %d, \"columns\": %d, "
                "\"noLoweringColumns\": %d, \"ceilingSolid\": %d, \"hash\": %u},\n",
                removed, steps, noLowering, ceilingSolid, tunnelHash);
    of_edits_destroy(edits);
  }

  // =========================================================================
  // CASE 6 — voxel dig brush: removed count, dirty AABB, exposed faces.
  // =========================================================================
  {
    double dx, dy, dz; digDir(dx, dy, dz);
    const int edits = of_edits_create();
    const double surfR = of_surface_radius(forge, 0, dx, dy, dz);
    const double r = surfR - 2.0;
    const int removed = of_edits_dig(edits, forge, dx * r, dy * r, dz * r, 4.0);
    const int dirtyOk = of_edits_dirty_region(edits);
    const int32_t* dr = of_scratch_i32();
    int32_t d6[6] = {dr[0], dr[1], dr[2], dr[3], dr[4], dr[5]};
    const int faces = of_exposed_faces(forge, edits, dx * r, dy * r, dz * r, 5.0);
    const int32_t* fp = of_scratch_i32();
    hInit(); for (int i = 0; i < faces * 5; ++i) hI32(fp[i]);
    const uint32_t faceHash = hEnd();
    // Round-trip the removed set through persistence.h's byte cursors.
    const int nbytes = of_edits_serialize(edits);
    const uint8_t* sb = of_scratch_u8();
    hInit(); hBytes(sb, static_cast<size_t>(nbytes));
    const uint32_t saveHash = hEnd();
    SELF(removed > 0, "dig brush removed nothing");
    SELF(faces > 0, "no exposed faces after a dig");
    SELF(nbytes > 0, "voxel edits serialized to 0 bytes");
    std::printf("  \"voxel\": {\"removed\": %d, \"dirtyValid\": %d, "
                "\"dirty\": [%d,%d,%d,%d,%d,%d], \"faces\": %d, "
                "\"faceHash\": %u, \"saveBytes\": %d, \"saveHash\": %u},\n",
                removed, dirtyOk, d6[0], d6[1], d6[2], d6[3], d6[4], d6[5],
                faces, faceHash, nbytes, saveHash);
    of_edits_destroy(edits);
  }

  // =========================================================================
  // CASE 7 — terrain streaming: 3 budgeted updates around a fixed observer.
  // =========================================================================
  {
    const int s = of_streamer_create(forge, 1.0, 0.6, /*maxDepth*/ 6,
                                     /*minResidentDepth*/ 0, 0.5, /*budget*/ 16);
    of_observer_latlon_alt(forge, 0.30, 0.70, 20000.0);
    const double* o = of_scratch_f64();
    const double ox = o[0], oy = o[1], oz = o[2];
    std::printf("  \"streaming\": {\"obsX\": %s, \"obsY\": %s, \"obsZ\": %s, "
                "\"updates\": [\n",
                bits(ox).c_str(), bits(oy).c_str(), bits(oz).c_str());
    for (int u = 0; u < 3; ++u) {
      const int ready = of_streamer_update(s, ox, oy, oz);
      const int gen = of_streamer_generated(s);
      const int conv = of_streamer_converged(s);
      const int res = of_streamer_resident_count(s);
      const int evc = of_streamer_evicted_count(s);
      of_streamer_ready_keys(s);
      const int32_t* kp = of_scratch_i32();
      hInit(); for (int i = 0; i < ready * 4; ++i) hI32(kp[i]);
      const uint32_t keyHash = hEnd();
      // Per-chunk content hash for EVERY ready chunk, so the parity test can
      // report exactly HOW MANY chunks differ (not just "the first one did").
      int gd = 0, skirt = 0;
      std::string hashes, biomes;
      for (int ci = 0; ci < ready; ++ci) {
        const int nh = of_chunk_heights_f64(s, ci);
        const double* hp = of_scratch_f64();
        hInit(); for (int i = 0; i < nh; ++i) hF64(hp[i]);
        const uint32_t ch = hEnd();
        of_chunk_meta(s, ci);
        const int32_t* mp = of_scratch_i32();
        if (ci == 0) { gd = mp[4]; skirt = mp[9]; }
        char buf[48];
        std::snprintf(buf, sizeof(buf), "%s%u", ci ? "," : "", ch);
        hashes += buf;
        std::snprintf(buf, sizeof(buf), "%s%d", ci ? "," : "", mp[6]);
        biomes += buf;
      }
      std::printf("    {\"ready\": %d, \"generated\": %d, \"converged\": %d, "
                  "\"resident\": %d, \"evicted\": %d, \"keyHash\": %u, "
                  "\"gridDim\": %d, \"skirtVerts\": %d, "
                  "\"chunkHashes\": [%s], \"chunkBiomes\": [%s]}%s\n",
                  ready, gen, conv, res, evc, keyHash, gd, skirt,
                  hashes.c_str(), biomes.c_str(), (u == 2) ? "" : ",");
    }
    std::printf("  ]},\n");
    of_streamer_destroy(s);
  }

  // =========================================================================
  // CASE 8 — the factory auto-line (mirrors test_automation.cpp exactly).
  //   deposit -> miner -> belt -> smelter -> belt -> assembler -> part
  // =========================================================================
  {
    const int kOre = 0x0033, kIngot = 0x0010, kPart = 0x0040;
    const int net = of_net_create(1.0 / 60.0);
    const int miner   = of_net_place_miner(net, 100000, kOre, 8.0, 50);
    const int belt1   = of_net_place_belt(net, 2, 32);
    const int smelter = of_net_place_smelter(net, kOre, kIngot, 20, 0, 0);
    const int belt2   = of_net_place_belt(net, 2, 32);
    const int asmb    = of_net_place_assembler(net, kIngot, 1, 0, 0, kPart, 1, 25, 0, 0);
    of_net_connect(net, miner, belt1, 0);
    of_net_connect(net, belt1, smelter, 0);
    of_net_connect(net, smelter, belt2, 0);
    of_net_connect(net, belt2, asmb, 0);
    of_net_step_n(net, 5000);

    const double ore = of_net_produced_of(net, kOre);
    const double ingot = of_net_produced_of(net, kIngot);
    const double part = of_net_produced_of(net, kPart);
    const int rows = of_net_emit_entity_states(net);
    const int32_t* ip = of_scratch_i32();
    hInit(); for (int i = 0; i < rows * 6; ++i) hI32(ip[i]);
    const uint32_t stateHash = hEnd();
    const int flows = of_net_emit_belt_flows(net);
    const int32_t* fp = of_scratch_i32();
    hInit(); for (int i = 0; i < flows * 5; ++i) hI32(fp[i]);
    const uint32_t flowHash = hEnd();
    const int items = of_net_get_line_items(net, belt1);
    const int32_t* lp = of_scratch_i32();
    hInit(); for (int i = 0; i < items * 2; ++i) hI32(lp[i]);
    const uint32_t itemHash = hEnd();

    SELF(ore > 0 && ingot > 0 && part > 0, "auto-line produced nothing");
    SELF(part <= ingot, "more parts than ingots (item minted from nothing)");

    std::printf("  \"factory\": {\"ore\": %.0f, \"ingot\": %.0f, \"part\": %.0f, "
                "\"minerRemaining\": %.0f, \"belt1Items\": %d, "
                "\"smelterOut\": %d, \"asmIn\": %d, \"tick\": %.0f, "
                "\"stateRows\": %d, \"stateHash\": %u, \"flows\": %d, "
                "\"flowHash\": %u, \"lineItems\": %d, \"itemHash\": %u, "
                "\"asmProgress\": %s, \"smelterWorking\": %d},\n",
                ore, ingot, part, of_net_miner_remaining(net, miner),
                of_net_belt_item_count(net, belt1),
                of_net_output_buffer(net, smelter),
                of_net_input_buffer(net, asmb), of_net_tick_index(net),
                rows, stateHash, flows, flowHash, items, itemHash,
                bits(of_net_progress01(net, asmb)).c_str(),
                of_net_working(net, smelter));
    of_net_destroy(net);
  }

  // Deposit depletion + exact miner rate (test_automation's two arithmetic cases).
  {
    const int kOre = 0x0033, kIngot = 0x0010, kPart = 0x0040;
    const int net = of_net_create(1.0 / 60.0);
    const int miner   = of_net_place_miner(net, 40, kOre, 8.0, 50);
    const int belt1   = of_net_place_belt(net, 2, 32);
    const int smelter = of_net_place_smelter(net, kOre, kIngot, 20, 0, 0);
    const int belt2   = of_net_place_belt(net, 2, 32);
    const int asmb    = of_net_place_assembler(net, kIngot, 1, 0, 0, kPart, 1, 25, 0, 0);
    of_net_connect(net, miner, belt1, 0);
    of_net_connect(net, belt1, smelter, 0);
    of_net_connect(net, smelter, belt2, 0);
    of_net_connect(net, belt2, asmb, 0);
    of_net_step_n(net, 20000);
    const double mined = of_net_produced_of(net, kOre);
    SELF(mined == 40.0, "depleted miner did not mine exactly the deposit");
    SELF(of_net_miner_remaining(net, miner) == 0.0, "deposit not fully drained");

    const int net2 = of_net_create(1.0 / 60.0);
    const int m2 = of_net_place_miner(net2, 600, kOre, 60.0, 0);
    of_net_step_n(net2, 600);
    const double mined2 = of_net_produced_of(net2, kOre);
    SELF(mined2 == 600.0, "exact miner rate drifted (600 units in 600 ticks)");

    std::printf("  \"factoryDeplete\": {\"mined\": %.0f, \"remaining\": %.0f, "
                "\"depleted\": %d, \"exactRateMined\": %.0f, "
                "\"exactRateRemaining\": %.0f},\n",
                mined, of_net_miner_remaining(net, miner),
                of_net_miner_depleted(net, miner), mined2,
                of_net_miner_remaining(net2, m2));
    of_net_destroy(net); of_net_destroy(net2);
  }

  std::printf("  \"selfCheck\": %d\n}\n", g_fail == 0 ? 1 : 0);
  if (g_fail) {
    std::fprintf(stderr, "\nNATIVE SELF-CHECKS FAILED — fixture is not ground truth.\n");
    return 2;
  }
  return 0;
}
