// Wave-0 headless tests for the core-engine substrate.
// Maps the spike1-core-engine validation gates to concrete assertions:
//   - V3 (no precision wobble at planetary scale)  -> FloatingOrigin precision
//   - rebase correctness (relative positions invariant) -> rebase invariance
//   - SOI/frame transforms                          -> FrameGraph round-trips
//   - CE-3 fixed tick decoupled from render          -> SimClock determinism
#include "test_framework.h"
#include "of/floating_origin.h"
#include "of/reference_frame.h"
#include "of/sim_clock.h"

using namespace of;

// --- Floating origin: the headline precision win (gate V3) -------------------
// Two points 1 m apart, sitting 1,000,000 km from the universe origin. With a
// floating origin near them, the 1 m separation survives a float32 round-trip;
// naive float storage at that magnitude loses it entirely.
TEST(floating_origin_preserves_precision_at_1e9_m) {
  const double base = 1.0e9;  // 1,000,000 km from root
  UniverseCoord a(Vec3(base, 0, 0));
  UniverseCoord b(Vec3(base + 1.0, 0, 0));  // exactly 1 m away

  FloatingOrigin fo(/*threshold*/ 4000.0);
  CHECK(fo.maybeRebase(a));  // observer drifts far -> world rebases under it

  const Vec3f ea = fo.toEngine(a);
  const Vec3f eb = fo.toEngine(b);
  CHECK_NEAR(static_cast<double>(eb.x - ea.x), 1.0, 1e-3);  // 1 m preserved

  // Document WHY the floating origin is needed: naive float loses the metre.
  const float fa = static_cast<float>(base);
  const float fb = static_cast<float>(base + 1.0);
  CHECK(std::fabs(static_cast<double>(fb - fa) - 1.0) > 0.5);
}

// --- Rebase invariance: the core correctness property ------------------------
// Relative positions of two objects must be identical before and after a rebase.
TEST(rebase_keeps_relative_positions_invariant) {
  UniverseCoord p(Vec3(1.0e8, 2.0e8, 3.0e8));
  UniverseCoord q(Vec3(p.pos.x + 5.0, p.pos.y, p.pos.z));  // 5 m from p

  FloatingOrigin fo(4000.0);
  fo.maybeRebase(p);  // origin -> p
  const Vec3 relBefore = fo.toEngineD(p) - fo.toEngineD(q);
  const int rebasesBefore = fo.rebaseCount();

  // Move the observer 10 km away -> must trigger a second rebase.
  UniverseCoord observer(Vec3(p.pos.x + 10000.0, p.pos.y, p.pos.z));
  CHECK(fo.maybeRebase(observer));
  CHECK(fo.rebaseCount() == rebasesBefore + 1);

  const Vec3 relAfter = fo.toEngineD(p) - fo.toEngineD(q);
  CHECK_NEAR(relAfter.x, relBefore.x, 1e-9);
  CHECK_NEAR(relAfter.y, relBefore.y, 1e-9);
  CHECK_NEAR(relAfter.z, relBefore.z, 1e-9);
  CHECK_NEAR(relAfter.x, -5.0, 1e-9);
}

TEST(floating_origin_engine_roundtrip) {
  UniverseCoord uc(Vec3(1.23456789e9, -9.87e8, 4.4e8));
  FloatingOrigin fo(4000.0);
  fo.maybeRebase(uc);
  const UniverseCoord back = fo.fromEngine(fo.toEngineD(uc));
  CHECK_NEAR(back.pos.x, uc.pos.x, 1e-6);
  CHECK_NEAR(back.pos.y, uc.pos.y, 1e-6);
  CHECK_NEAR(back.pos.z, uc.pos.z, 1e-6);
}

// --- Frame graph: re-express a point across frames (foundation for SOI) ------
TEST(frame_graph_transforms_roundtrip) {
  FrameGraph g;
  const FrameId planet = g.addFrame(kRootFrame, Vec3(1.5e11, 0, 0), 6.0e8);
  const FrameId moon = g.addFrame(planet, Vec3(4.0e8, 0, 0), 6.6e7);

  const Vec3 moonRoot = g.rootOffset(moon);
  CHECK_NEAR(moonRoot.x, 1.5e11 + 4.0e8, 1e-3);

  // A point 1,700 km up in the moon's frame (a surface-ish point).
  UniverseCoord pMoon(Vec3(1.7e6, 0, 0), moon);

  // moon -> root -> moon must be identity.
  const UniverseCoord pRoot = g.toRoot(pMoon);
  CHECK_NEAR(pRoot.pos.x, 1.5e11 + 4.0e8 + 1.7e6, 1e-3);
  const UniverseCoord pBack = g.toFrame(pRoot, moon);
  CHECK_NEAR(pBack.pos.x, 1.7e6, 1e-3);
  CHECK(pBack.frame == moon);

  // Re-express the same point in the planet's frame.
  const UniverseCoord pPlanet = g.toFrame(pMoon, planet);
  CHECK_NEAR(pPlanet.pos.x, 4.0e8 + 1.7e6, 1e-3);
  CHECK(pPlanet.frame == planet);
}

// --- SimClock: fixed tick, exact accounting, determinism (CE-3) --------------
TEST(sim_clock_fixed_tick_exact_and_deterministic) {
  // 2 Hz clock with binary-exact dt to assert tick counts without fp slop.
  SimClock c(0.5);
  CHECK(c.advance(2.0) == 4);
  CHECK(c.tickIndex() == 4u);
  CHECK_NEAR(c.alpha(), 0.0, 1e-12);

  CHECK(c.advance(0.25) == 0);  // not a full tick yet
  CHECK_NEAR(c.alpha(), 0.5, 1e-12);
  CHECK(c.advance(0.25) == 1);  // crosses the tick boundary
  CHECK(c.tickIndex() == 5u);

  // Determinism: identical input streams -> identical tick index.
  SimClock x(1.0 / 60.0), y(1.0 / 60.0);
  const double frames[] = {0.016, 0.017, 0.020, 0.001, 0.033};
  for (double f : frames) x.advance(f);
  for (double f : frames) y.advance(f);
  CHECK(x.tickIndex() == y.tickIndex());

  // alpha stays in [0, 1) after arbitrary advances.
  SimClock z(1.0 / 60.0);
  z.advance(0.123456);
  CHECK(z.alpha() >= 0.0);
  CHECK(z.alpha() < 1.0);
}
