// =============================================================================
// of_discovery_api.inc — §18, THE DISCOVERABLE MAP (discovery.h). ABI 12.
//
// #included into of_core_api.cpp after of_maneuver_api.inc, exactly as the five
// files before it are, so the scratch arena, `resetF64` and the `wg` alias above
// are all in scope. One translation unit is the contract.
//
// WHAT THIS IS FOR. DW-36 makes the map discoverable in survival: you cannot see
// what you have never been to. That is WORLD state and not UI state, so the set
// of seen ground lives in /core beside the terrain it describes, it is
// deterministic, and it persists (DW-17). The client SHADES what this answers;
// it never decides what is shaded. A TypeScript copy of the horizon rule would
// be a second authority over what the player has seen, and the SAVED set would
// then disagree with the DRAWN one, which is the two-authority failure this
// project has already paid for repeatedly.
//
// THE RULE, one sentence: a cell is discovered when the observer has been
// somewhere it was above their horizon. It is read at TWO resolutions, because
// height buys EXTENT and costs RESOLUTION:
//
//   SURVEY   ~9.4 km cells, horizon-limited, uncapped. The shape of the world;
//            what the map shades. Orbit fills it in, and should.
//   EXPLORE  ~293 m cells, horizon-limited AND capped at 10 km of ground chord.
//            The detail of the world; what gates an ore patch.
//
// So one 80 km lap of Forge hands you the continents plus a 20 km thread of
// detail under the ground track, and the ore in the next valley is still yours
// to find. discovery.h carries the derivation of every number above; there are
// none in this file.
//
// NO TRANSCENDENTALS cross this boundary either. Both tests behind it are
// algebraic (CE-11 / DW-15), because a 1 ULP difference would flip a boundary
// cell and desync a SAVED set between two clients.
//
// ONE FIELD PER MODULE INSTANCE, like the inventory and the ore patches above:
// the player has one memory of one body, and a handle registry would invite the
// client to hold two and shade the wrong one.
// =============================================================================
#include "of/discovery.h"

namespace disc = of::worldgen::discovery;

namespace {
std::unique_ptr<disc::WorldDiscovery> g_disc;
disc::DiscoveryTuning g_discTuning;
double g_discRadiusM = 0.0;

// The last pass and the last window, kept so of_disc_report publishes counts
// that were taken INSIDE the call rather than re-derived from its arguments.
// That distinction is the navball lane's lesson: a field that is present and
// never fed must be distinguishable from a live one.
disc::ObservePass g_discLastSurvey;
disc::ObservePass g_discLastExplore;
int g_discWindowRows = 0;
bool g_discWindowTruncated = false;

// Body radius by §1's bodyId convention: 0 = Forge (600 km), 1 = Cinder
// (200 km). The radius is a constant OF THE BODY and not of the seed, so this
// needs no BodyParams handle and a caller that has created no body can still
// ask. Anything else is an unknown body and is refused rather than guessed.
double discBodyRadius(int bodyId) {
  if (bodyId == 0) return wg::makeForge(0).radiusM;
  if (bodyId == 1) return wg::makeCinder(0).radiusM;
  return 0.0;
}

void discRebuild() {
  g_disc.reset(new disc::WorldDiscovery(g_discRadiusM, g_discTuning));
  g_discLastSurvey = disc::ObservePass();
  g_discLastExplore = disc::ObservePass();
  g_discWindowRows = 0;
  g_discWindowTruncated = false;
}

const disc::DiscoveryGrid* discLayer(int layer) {
  if (!g_disc) return nullptr;
  if (layer == 0) return &g_disc->survey();
  if (layer == 1) return &g_disc->explore();
  return nullptr;
}

// A window ceiling, in the same spirit as §17's kMnMaxSamples: it bounds one
// mistyped argument from asking for hundreds of megabytes of corners. It is NOT
// a silent ceiling — hitting it sets the SAME truncation flag a small maxRows
// does, which of_disc_report[14] publishes, so a caller that overruns finds out
// (DW-28: a resource that silently drops work when full is worse than one that
// fails loudly).
const int kDiscMaxWindowRows = 65536;
}  // namespace

// -----------------------------------------------------------------------------
// §18.1: the field. Build it, tune it, empty it.
// -----------------------------------------------------------------------------

// Build a fresh, EMPTY discovery field at `bodyId`'s radius with discovery.h's
// default tuning. 1 on success, 0 for a body this bridge does not know.
//
// UNCONDITIONAL: it throws away whatever was there. That is what a probe and a
// new world want, and it is why it is NOT what a boot path should call — see
// of_disc_ensure directly below.
OF_API int of_disc_reset(int bodyId) {
  const double r = discBodyRadius(bodyId);
  if (!(r > 0.0)) return 0;
  g_discRadiusM = r;
  g_discTuning = disc::DiscoveryTuning();
  discRebuild();
  return 1;
}

// THE BOOT-SAFE FORM. Make sure a field for `bodyId` exists, and RESET ONLY IF
// there is none or the one there is cut for a different body. 1 on success, 0
// for a body this bridge does not know.
//
// It exists because of an ordering defect that cost the player their explored
// world. The save is applied EARLY, while the world is still coming up; the map
// is built LATER and built the discovery field. So the load found no field and
// refused, and then the later construction wrote an empty field over what had
// just been restored — after which the 20 s autosave persisted the empty set
// and the exploration was gone for good.
//
// discovery.h's stream now carries the body radius, so the load no longer needs
// the field to exist first. This closes the other half: the construction that
// runs AFTERWARDS must not wipe what the load put there. Two halves, because
// the ordering is the defect and either half alone still loses the world.
//
// The radius comparison is EXACT and is meant to be: both sides are the same
// body constant, one of them through discovery.h's bit-exact f64 round trip.
OF_API int of_disc_ensure(int bodyId) {
  const double r = discBodyRadius(bodyId);
  if (!(r > 0.0)) return 0;
  if (g_disc && g_disc->bodyRadiusM() == r) {
    g_discRadiusM = r;  // the field is already this body's; keep what it holds
    return 1;
  }
  return of_disc_reset(bodyId);
}

// Re-tune and CLEAR. 1 on success, 0 if of_disc_reset was never called: there is
// no body to build against and guessing one would put the discovered world on
// the wrong planet.
//
// TUNING IS DATA (GP-12: tune without touching a code path), so a probe or a
// balance pass moves these from JS and no branch is added anywhere. A
// NON-POSITIVE field means "take discovery.h's DEFAULT for that field" — the
// default, NOT the value currently in force — so of_disc_configure(0,0,0,0,0)
// is exactly "back to stock". Every field's derivation is in discovery.h §2.
//
//   surveyCellM        target survey cell edge, metres        (default 10000)
//   exploreCellM       target explore cell edge, metres       (default 250)
//   horizonFraction    the balance dial, (0,1]; 1 is the true
//                      geometric horizon and is the derived value
//   exploreMaxRadiusM  how far one EXPLORE pass may reach, as
//                      a ground chord, metres                 (default 10000)
//   maxCellsPerPass    cells one pass may VISIT before it gives
//                      up and reports budgetHit               (default 65536)
//
// This CLEARS the field and it must: the two cell targets change the LATTICE,
// and a key cut at one cell size addresses different ground at another.
OF_API int of_disc_configure(double surveyCellM, double exploreCellM,
                             double horizonFraction, double exploreMaxRadiusM,
                             int maxCellsPerPass) {
  if (!g_disc) return 0;
  disc::DiscoveryTuning t;  // the defaults, then only what was asked for
  if (surveyCellM > 0.0) t.surveyCellTargetM = surveyCellM;
  if (exploreCellM > 0.0) t.exploreCellTargetM = exploreCellM;
  if (horizonFraction > 0.0) t.horizonFraction = horizonFraction;
  if (exploreMaxRadiusM > 0.0) t.exploreMaxRadiusM = exploreMaxRadiusM;
  if (maxCellsPerPass > 0)
    t.maxCellsPerPass = static_cast<uint32_t>(maxCellsPerPass);
  g_discTuning = t;
  discRebuild();
  return 1;
}

// Forget everything seen, keeping the body and the tuning. The last-pass figures
// go with it: reporting a pass whose cells are no longer held would be a live
// number describing a field that no longer exists.
OF_API void of_disc_clear(void) {
  if (!g_disc) return;
  g_disc->clear();
  g_discLastSurvey = disc::ObservePass();
  g_discLastExplore = disc::ObservePass();
  g_discWindowRows = 0;
  g_discWindowTruncated = false;
}

// -----------------------------------------------------------------------------
// §18.2: seeing. ONE call feeds both layers, because there is ONE rule.
// -----------------------------------------------------------------------------

// One observation from a direction on the body (need not be unit) and a height
// above the LOCAL SURFACE in metres. The walker's eye height is discovery.h's
// and is added there, in the one place, so no caller has to remember it.
//
// Returns the cells ADDED across both layers — 0 is the normal answer for
// standing still, and it costs one dot product — or -1 if there is no field.
//
// COST is O(the area swept) and never O(entities): this call takes a direction
// and an altitude and cannot see a machine, an ore patch or a vessel at all.
OF_API int of_disc_observe(double dx, double dy, double dz, double altM) {
  if (!g_disc) return -1;
  g_disc->observe(vec(dx, dy, dz), altM, g_discLastSurvey, g_discLastExplore);
  return static_cast<int>(g_discLastSurvey.added + g_discLastExplore.added);
}

// f64 scratch, EXACTLY 16. Returns 16, or 0 if there is no field.
//
//   [0]  surveyCells            discovered coarse cells
//   [1]  exploreCells           discovered fine cells
//   [2]  surveyFraction         of the WHOLE body, [0,1]
//   [3]  exploreFraction        of the WHOLE body, [0,1]
//   [4]  surveyCellSizeM        cell edge at a face CENTRE (see discovery.h §1:
//   [5]  exploreCellSizeM       a corner cell is up to 2.12x smaller)
//   [6]  lastSurveyRadiusM      the ground CHORD the last pass swept
//   [7]  lastExploreRadiusM     ditto, after the explore cap
//   [8]  lastSurveyAdded        newly discovered by the last pass
//   [9]  lastExploreAdded
//   [10] lastVisited            cells the last pass touched, both layers
//   [11] budgetHit              1 if either layer gave up on maxCellsPerPass
//   [12] observations           of_disc_observe calls since the last clear
//   [13] lastWindowRows         rows the last of_disc_window emitted
//   [14] lastWindowTruncated    1 if it had more to say than maxRows allowed
//   [15] bodyRadiusM
//
// Every figure here was counted INSIDE the call that produced it. None is
// re-derived from the arguments, so a stale one reads as stale.
OF_API int of_disc_report(void) {
  resetF64(16);
  if (!g_disc) return 0;
  const disc::DiscoveryGrid& s = g_disc->survey();
  const disc::DiscoveryGrid& e = g_disc->explore();
  const double a[16] = {
      static_cast<double>(s.size()),
      static_cast<double>(e.size()),
      s.fraction(),
      e.fraction(),
      s.grid().cellSizeAtFaceCentreM(),
      e.grid().cellSizeAtFaceCentreM(),
      g_discLastSurvey.radiusChordM,
      g_discLastExplore.radiusChordM,
      static_cast<double>(g_discLastSurvey.added),
      static_cast<double>(g_discLastExplore.added),
      static_cast<double>(g_discLastSurvey.visited + g_discLastExplore.visited),
      (g_discLastSurvey.budgetHit || g_discLastExplore.budgetHit) ? 1.0 : 0.0,
      static_cast<double>(g_disc->observations()),
      static_cast<double>(g_discWindowRows),
      g_discWindowTruncated ? 1.0 : 0.0,
      g_discRadiusM};
  for (double x : a) g_f64.push_back(x);
  return 16;
}

// -----------------------------------------------------------------------------
// §18.3: asking. The gate, and the drawable set.
// -----------------------------------------------------------------------------

// Has this direction been seen? layer 0 = SURVEY (has the shape been seen — what
// the map shades), 1 = EXPLORE (has the detail been seen — what gates an ore
// patch). 1 / 0, or -1 for a bad layer or no field, which is a REFUSAL and not
// an answer: a caller must not read "undiscovered" out of "I have no field".
OF_API int of_disc_has(int layer, double dx, double dy, double dz) {
  const disc::DiscoveryGrid* g = discLayer(layer);
  if (!g) return -1;
  return g->hasDir(vec(dx, dy, dz)) ? 1 : 0;
}

// THE DRAW CALL. Every discovered cell of `layer` whose CENTRE is within cosMin
// of (dx,dy,dz) — that is, dot(centre, dir) >= cosMin, which is the same
// algebraic test discovery.h uses and not a second one in angles.
//
// Returns the ROW count. f64 scratch, 12 doubles per row: the cell's FOUR corner
// directions in cellCorners order, x,y,z each. Multiply by the surface oracle's
// radius if you want positions; they are unit directions on purpose.
//
// CORNERS, NOT A CENTRE PLUS A SIZE. The map's projection is ORTHOGRAPHIC, so a
// cell near the limb foreshortens to a sliver; a square stamped at the centre
// would paint discovered ground over undiscovered.
//
// If more cells match than `maxRows` (or than this file's kDiscMaxWindowRows
// ceiling), exactly that many rows are emitted and the TRUNCATION FLAG that
// of_disc_report[14] publishes is set. DW-28: a ceiling that silently drops work
// is the worst failure class this project has; this one reports.
OF_API int of_disc_window(int layer, double dx, double dy, double dz,
                          double cosMin, int maxRows) {
  resetF64(0);
  g_discWindowRows = 0;
  g_discWindowTruncated = false;
  const disc::DiscoveryGrid* g = discLayer(layer);
  if (!g) return 0;
  int cap = maxRows < 0 ? 0 : maxRows;
  if (cap > kDiscMaxWindowRows) cap = kDiscMaxWindowRows;
  const Vec3 dir = disc::unitOfDir(vec(dx, dy, dz));
  const disc::SurfaceCellGrid& lat = g->grid();
  const std::vector<disc::CellKey>& cells = g->cells();
  // An upper bound on the rows, so the common case reserves once and the
  // pathological one cannot reserve more than the world actually holds.
  const size_t bound = cells.size() < static_cast<size_t>(cap)
                           ? cells.size() : static_cast<size_t>(cap);
  resetF64(bound * 12);
  int matched = 0;
  int rows = 0;
  Vec3 corners[4];
  for (disc::CellKey k : cells) {
    if (lat.cellCentreDir(k).dot(dir) < cosMin) continue;
    ++matched;
    if (rows >= cap) continue;  // keep counting: the flag must be honest
    lat.cellCorners(k, corners);
    for (const Vec3& q : corners) {
      g_f64.push_back(q.x); g_f64.push_back(q.y); g_f64.push_back(q.z);
    }
    ++rows;
  }
  g_discWindowRows = rows;
  g_discWindowTruncated = matched > rows;
  return rows;
}

// -----------------------------------------------------------------------------
// §18.4: persistence (persistence.h byte cursors, no filesystem).
//
// DW-17, and deliberately the SAME call sequence as of_edits_* so a save routine
// has one shape to learn. JS: call of_disc_serialize(), read the returned byte
// count from of_scratch_u8() and store it; to load, call of_disc_alloc_bytes(n),
// copy the bytes into HEAPU8 at of_scratch_u8(), then call of_disc_deserialize().
// The u8 arena is shared with of_edits_* and the inventory, so a save routine
// does one of them at a time.
//
// The BYTES are /core's: WorldDiscovery::serialize is templated over the
// persistence.h cursors and takes a SaveWriter directly, so the delta-varint
// stream a browser writes is byte-for-byte the one the native suites read.
// -----------------------------------------------------------------------------
OF_API int of_disc_serialize(void) {
  g_u8.clear();
  if (!g_disc) return -1;
  of::persist::SaveWriter w;
  g_disc->serialize(w);
  g_u8 = w.bytes();
  return static_cast<int>(g_u8.size());
}
OF_API void of_disc_alloc_bytes(int n) { g_u8.assign(n > 0 ? n : 0, 0); }
// Returns the TOTAL cells restored (survey + explore), or -1 on refusal. /core
// refuses a stream cut at a different cell size rather than reinterpreting the
// keys against this lattice, which would place the discovered world somewhere it
// has never been.
//
// IT NEEDS NO FIELD FIRST, and that is the point rather than a convenience. The
// stream carries the body radius (discovery.h §4), so a load can happen before
// anything has told this module which body the player is on — which is exactly
// the browser's boot order, and used to make this call return -1 every time.
// When there is no field, one is constructed at a PLACEHOLDER radius and
// discovery.h corrects it from the bytes; that is not a guess, because the
// radius that ends up in force came out of the stream and never out of the 1.0
// below. A field that already exists is likewise re-cut to the stream's body.
//
// A REFUSAL LEAVES THE FIELD AS IT WAS. discovery.h's WorldDiscovery::deserialize
// is all-or-nothing across both layers AND across the lattice, so an existing
// field is untouched by a -1. (This block used to say the opposite — that a -1
// left the field of unknown provenance and the caller had to reset. That was
// true of the first version and was stale by the time it was written.) The one
// case that is not a no-op is the one where there was nothing to keep: if the
// placeholder above was built and the stream is then refused, the placeholder is
// dropped, so the caller is back to having no field rather than holding a
// 1-metre phantom body.
OF_API int of_disc_deserialize(void) {
  // AN EMPTY ARENA IS REFUSED BEFORE ANYTHING IS BUILT. The reader throws on a
  // read past the end and this module is built with exceptions off, so a stream
  // with no bytes in it would take the whole instance down rather than return.
  // The old `if (!g_disc) return -1` covered this by accident on a fresh module;
  // now that a fresh module is a legal caller, the guard has to be its own.
  if (g_u8.empty()) return -1;
  const bool hadField = static_cast<bool>(g_disc);
  if (!hadField) {
    g_discRadiusM = 1.0;  // placeholder; the stream's radius replaces it below
    g_discTuning = disc::DiscoveryTuning();
    discRebuild();
  }
  of::persist::SaveReader r(g_u8);
  if (!g_disc->deserialize(r)) {  // not my stream, or a foreign lattice
    if (!hadField) { g_disc.reset(); g_discRadiusM = 0.0; }
    return -1;
  }
  // The body the stream was cut for is now the body this module is about, so
  // of_disc_report[15] reports it rather than the placeholder.
  g_discRadiusM = g_disc->bodyRadiusM();
  return static_cast<int>(g_disc->survey().size() + g_disc->explore().size());
}
