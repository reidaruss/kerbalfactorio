// =============================================================================
// of_poi_api.inc — THE POI / SITE BRIDGE (poi.h, WG-200 to WG-212). ABI 24.
//
// #included into of_core_api.cpp at the foot, after of_ap_api.inc, exactly as
// the files before it are, so the scratch arena, `resetF64`/`resetI32`, the
// `wg` alias, `vec()`, `joinU64()` and `g_bodies` are all in scope. One
// translation unit is the contract.
//
// world-gen.md §"THE POI / SITE SEAM" specified this bridge and deliberately
// did not build it (WG-167): nine exports, one 18-f64-word row, the id split
// into two 32-bit halves because a uint64 id does not survive one f64. That
// content is binding here. The CALLING CONVENTION is this file's own call,
// because the spec's prose ("outPtr") predates a working build and every
// other array-returning export in this shim uses the scratch arena rather
// than a caller-supplied pointer (see the file header's §0). Following that
// established convention here rather than inventing a second one is the
// point: `of_poi_row` and `of_poi_near` write through `g_f64`/`g_i32` and
// return a count, exactly as `of_gp_patch_state` and `of_disc_window` do.
//
// THE SECOND BIT. Admin approved `known_` beside `visited_` in the same pass
// (poi.h's state machine is unknown -> known -> visited, monotone): the scan
// reveals a site (`of_poi_known` / `of_poi_mark_known`) before a player has
// necessarily walked up to it (`of_poi_visited` / `of_poi_mark_visited`).
// Eleven exports land here, not nine, and the row layout is unchanged.
//
// A CATALOG IS BUILT PER BODY HANDLE AND CACHED, not rebuilt per call: the
// generator runs `admit()` up to `maxTries` times at construction, and the
// two mutable bits must persist across calls or `of_poi_mark_visited` would
// forget itself on the very next query. The cache is keyed on the body
// HANDLE, but a handle slot is REUSED after `of_body_destroy` (see
// `Registry::add`), so the cache also carries the `BodyParams*` the catalog
// was built from and rebuilds whenever that pointer no longer matches — a
// destroyed-and-recreated handle must never hand back a stale catalog built
// for a different body's seed.
// =============================================================================
#include "of/poi.h"

namespace poi = of::worldgen::poi;

namespace {
struct PoiEntry {
  const wg::BodyParams* srcBody = nullptr;
  poi::SiteCatalog cat;
};
std::map<int, PoiEntry> g_poi;

// Build-or-fetch. Returns null for a body handle `g_bodies` does not know;
// every of_poi_* export below refuses the same way `of_body_radius` et al. do.
poi::SiteCatalog* poiCatalogFor(int body) {
  const wg::BodyParams* b = g_bodies.get(body);
  if (!b) return nullptr;
  auto it = g_poi.find(body);
  if (it != g_poi.end() && it->second.srcBody == b) return &it->second.cat;
  PoiEntry fresh;
  fresh.srcBody = b;
  fresh.cat = poi::SiteCatalog::ForBody(*b);
  PoiEntry& stored = (g_poi[body] = std::move(fresh));
  return &stored.cat;
}
}  // namespace

// -----------------------------------------------------------------------------
// §22.1: where. count / row / near / nearest / inside.
// -----------------------------------------------------------------------------

// How many sites this body carries (0 for Cinder, refused by name in
// SiteCatalog::refusal() but not published over this bridge — gameplay asks
// "how many" and "where", never "why zero"). -1 for an unknown body handle.
OF_API int of_poi_count(int body) {
  const poi::SiteCatalog* cat = poiCatalogFor(body);
  return cat ? static_cast<int>(cat->size()) : -1;
}

// f64 scratch, EXACTLY 18 words, world-gen.md's order:
//   [0]  idLo    [1] idHi     (the id split into two 32-bit halves)
//   [2]  kind    [3] ordinal
//   [4..6]   dir (unit, body frame)
//   [7..9]   pos (body-frame metres, BASE surface)
//   [10] latRad  [11] lonRad  [12] yawRad
//   [13] footprintM   [14] arcFromAnchorM
//   [15] tiltDeg      [16] residP95M
//   [17] biome (of/biome.h's Biome, or -1)
// Returns 18, or 0 for an unknown body or an out-of-range index — a bad index
// is REFUSED rather than clamped, so a caller iterating past `of_poi_count`
// finds out rather than re-reading row 0.
OF_API int of_poi_row(int body, int i) {
  resetF64(18);
  const poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return 0;
  if (i < 0 || static_cast<size_t>(i) >= cat->size()) return 0;
  const poi::FSite& s = cat->sites()[static_cast<size_t>(i)];
  g_f64.push_back(static_cast<double>(static_cast<uint32_t>(s.id)));
  g_f64.push_back(static_cast<double>(static_cast<uint32_t>(s.id >> 32)));
  g_f64.push_back(static_cast<double>(static_cast<uint16_t>(s.kind)));
  g_f64.push_back(static_cast<double>(s.ordinal));
  g_f64.push_back(s.dir.x); g_f64.push_back(s.dir.y); g_f64.push_back(s.dir.z);
  g_f64.push_back(s.pos.x); g_f64.push_back(s.pos.y); g_f64.push_back(s.pos.z);
  g_f64.push_back(s.latRad);
  g_f64.push_back(s.lonRad);
  g_f64.push_back(s.yawRad);
  g_f64.push_back(s.footprintM);
  g_f64.push_back(s.arcFromAnchorM);
  g_f64.push_back(s.tiltDeg);
  g_f64.push_back(s.residP95M);
  g_f64.push_back(static_cast<double>(s.biome));
  return 18;
}

// Every site index whose direction lies inside the CONE (dx,dy,dz,cosHalf) —
// WG-29's reason, restated in discovery's own §18.3: a scan radius and a
// camera frustum both yield a cone, an orthographic map cell does not survive
// the limb. i32 scratch, one index per row, at most `maxN`. Returns the
// number WRITTEN (never more than `maxN`, and never more than actually
// matched), or -1 for an unknown body.
OF_API int of_poi_near(int body, double dx, double dy, double dz,
                       double cosHalf, int maxN) {
  resetI32(0);
  const poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  const std::vector<size_t> idx = cat->near(vec(dx, dy, dz), cosHalf);
  const size_t cap = maxN < 0 ? 0 : static_cast<size_t>(maxN);
  const size_t n = idx.size() < cap ? idx.size() : cap;
  resetI32(n);
  for (size_t k = 0; k < n; ++k) g_i32.push_back(static_cast<int32_t>(idx[k]));
  return static_cast<int>(n);
}

// The nearest site of `kind` (poi.h's SiteKind; 0/None matches any kind) to
// the direction, as an INDEX for `of_poi_row`. -1 for no site of that kind
// AND for an unknown body — both are "there is nothing to hand back", and
// `of_poi_count` is how a caller tells an empty table from a bad handle.
OF_API int of_poi_nearest(int body, double dx, double dy, double dz, int kind) {
  const poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  return cat->nearest(vec(dx, dy, dz), static_cast<poi::SiteKind>(kind));
}

// THE KEEP-OUT every placement system asks: is `dir` (unit direction OR a
// surface position — insideAnySite normalises) within `marginM` of any
// site's footprint? 1/0, or -1 for an unknown body.
OF_API int of_poi_inside(int body, double dx, double dy, double dz,
                         double marginM) {
  const wg::BodyParams* b = g_bodies.get(body);
  const poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!b || !cat) return -1;
  return cat->insideAnySite(*b, vec(dx, dy, dz), marginM) ? 1 : 0;
}

// -----------------------------------------------------------------------------
// §22.2: the two mutable bits. unknown -> known -> visited, monotone.
// `idLo`/`idHi` are `of_poi_row`'s [0]/[1] handed straight back.
// -----------------------------------------------------------------------------

// Has the scan revealed this site? 1/0, or -1 for an unknown body — a REFUSAL,
// never read as "not yet known" (the same discipline `of_disc_has` uses).
OF_API int of_poi_known(int body, uint32_t idLo, uint32_t idHi) {
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  return cat->known(joinU64(idLo, idHi)) ? 1 : 0;
}

// Reveal it. 1 the first time, 0 if it was already known or the id matches no
// site, -1 for an unknown body.
OF_API int of_poi_mark_known(int body, uint32_t idLo, uint32_t idHi) {
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  return cat->markKnown(joinU64(idLo, idHi)) ? 1 : 0;
}

// Has this site been investigated? Same refusal discipline as of_poi_known.
OF_API int of_poi_visited(int body, uint32_t idLo, uint32_t idHi) {
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  return cat->visited(joinU64(idLo, idHi)) ? 1 : 0;
}

// Record a visit. 1 the first time, 0 afterward or for an unmatched id, -1 for
// an unknown body. ALSO SETS known (poi.h's markVisited does this, so a
// player who stumbles onto an unscanned ruin still reads as known once they
// have stood on it).
OF_API int of_poi_mark_visited(int body, uint32_t idLo, uint32_t idHi) {
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  return cat->markVisited(joinU64(idLo, idHi)) ? 1 : 0;
}

// -----------------------------------------------------------------------------
// §22.3: persistence. The same three-call shape `of_disc_*` and `of_edits_*`
// use, so a save routine has one shape to learn across all three. The u8
// arena is SHARED, so do one at a time (standing rule 5).
// -----------------------------------------------------------------------------

// Write both bits into the u8 scratch: poi.h's serialize() is the known ids
// then the visited ids, each sorted delta-varint. -> byte count, or -1 for an
// unknown body.
OF_API int of_poi_save(int body) {
  g_u8.clear();
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  of::persist::SaveWriter w;
  cat->serialize(w);
  g_u8 = w.bytes();
  return static_cast<int>(g_u8.size());
}
// Size the u8 scratch to `n` bytes so JS can copy a saved stream in.
OF_API void of_poi_alloc_bytes(int n) { g_u8.assign(n > 0 ? n : 0, 0); }
// Load from the u8 scratch into `body`'s catalog. -> the total ids restored
// (known + visited), or -1 if there is no field for `body` or the arena is
// empty. AN EMPTY ARENA IS REFUSED BEFORE ANYTHING TOUCHES THE READER, exactly
// as `of_disc_deserialize` refuses one, because this module runs with
// exceptions off and the reader throws on a read past the end.
OF_API int of_poi_load(int body) {
  if (g_u8.empty()) return -1;
  poi::SiteCatalog* cat = poiCatalogFor(body);
  if (!cat) return -1;
  of::persist::SaveReader r(g_u8);
  if (!cat->deserialize(r)) return -1;
  return static_cast<int>(cat->knownCount() + cat->visitedCount());
}
