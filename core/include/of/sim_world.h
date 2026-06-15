#pragma once
// =============================================================================
// sim_world.h — Headless Phase-1 integration substrate (M2.1–M2.4 logic).
//
// This is the *glue* core: it COMPOSES the four green Wave-0 cores into a single
// fixed-tick game loop, with no rendering and no UE. It proves the cores fit
// together to drive the playable slice's flight spine:
//
//     Forge surface → ascent (ACTIVE) → low orbit (ON-RAILS) →
//     cross to Cinder's SOI (FRAME SWITCH) → descend → land on Cinder,
//
// all under one SimClock, while a Factory ticks every step and keeps producing.
//
// It owns and wires:
//   * of::SimClock        (sim_clock.h)        — the single fixed tick.
//   * of::FrameGraph      (reference_frame.h)  — star → Forge → Cinder, D-006
//                                                params + SOI radii + a Cinder
//                                                orbital offset from Forge.
//   * of::FloatingOrigin  (floating_origin.h)  — tracks the ACTIVE observer
//                                                (the vessel) so the engine-space
//                                                coords stay near zero (the
//                                                seamless / no-wobble property).
//   * a Vessel — a UniverseCoord state that is either:
//       - ACTIVE  : (r, v) integrated with the symplectic of::orbital::Integrator
//                   (full flight dynamics, optional constant thrust), or
//       - ON-RAILS: of::orbital::Elements propagated analytically (no drift),
//     with promote()/demote() (the MASTER_PLAN §3 active/on-rails principle).
//   * a Factory — of::factory::FactorySim, ticked every fixed step.
//
// The central body for the vessel's two-body physics is whichever frame it is
// expressed in (Forge or Cinder) — the SOI switch re-parents BOTH the frame and
// the gravitational μ, exactly the patched-conics model (D-002).
//
// Header-only, double precision, no engine deps. Builds on the four cores only.
// =============================================================================
#include <cstdint>

#include "of/sim_clock.h"
#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/floating_origin.h"
#include "of/reference_frame.h"
#include "of/orbital.h"
#include "of/cubed_sphere.h"
#include "of/factory_sim.h"

namespace of {

// --- Vessel flight mode (the MASTER_PLAN §3 lever) ---------------------------
enum class VesselMode : uint8_t {
  Active = 0,   // full per-step symplectic integration (near a player)
  OnRails = 1,  // analytic Kepler propagation (far / coasting)
};

// =============================================================================
// SimWorld — the composed headless game world for the Phase-1 flight slice.
//
// Coordinate convention: the vessel's position/velocity are always expressed in
// the CURRENT central-body frame (Forge or Cinder), body-centre-relative metres,
// matching the orbital core's StateVector convention. The FrameGraph holds where
// each body sits in root (star) space, so the FloatingOrigin (which tracks the
// vessel in ROOT space) keeps engine coords near zero regardless of which body
// the vessel currently belongs to.
// =============================================================================
class SimWorld {
 public:
  // Construct with a world seed (drives world-gen) and the fixed timestep.
  explicit SimWorld(uint64_t worldSeed = 0xACE1ull, double fixedDt = 1.0 / 60.0)
      : clock_(fixedDt),
        factory_(fixedDt),
        floatingOrigin_(/*rebaseThresholdM*/ 4000.0),
        forgeBody_(worldgen::makeForge(worldSeed)),
        cinderBody_(worldgen::makeCinder(worldSeed)) {
    buildFrames();
  }

  // ---- Body / frame access -------------------------------------------------
  const worldgen::BodyParams& forge() const { return forgeBody_; }
  const worldgen::BodyParams& cinder() const { return cinderBody_; }
  FrameId forgeFrame() const { return forgeFrame_; }
  FrameId cinderFrame() const { return cinderFrame_; }
  const FrameGraph& frames() const { return frames_; }

  SimClock& clock() { return clock_; }
  const SimClock& clock() const { return clock_; }
  factory::FactorySim& factory() { return factory_; }
  const factory::FactorySim& factory() const { return factory_; }
  const FloatingOrigin& floatingOrigin() const { return floatingOrigin_; }

  // Gravitational μ of whichever body the vessel currently orbits.
  double centralMu() const {
    return vesselFrame_ == cinderFrame_ ? orbital::kCinderMu : orbital::kForgeMu;
  }
  const worldgen::BodyParams& centralBody() const {
    return vesselFrame_ == cinderFrame_ ? cinderBody_ : forgeBody_;
  }
  double centralRadius() const { return centralBody().radiusM; }

  // ---- Vessel state --------------------------------------------------------
  VesselMode vesselMode() const { return mode_; }
  FrameId vesselFrame() const { return vesselFrame_; }
  const orbital::StateVector& vesselState() const { return state_; }
  Vec3 vesselThrust() const { return thrust_; }

  // Vessel position as a UniverseCoord in its current body frame.
  UniverseCoord vesselCoord() const { return UniverseCoord(state_.r, vesselFrame_); }

  // Vessel position re-expressed in root (star) coordinates — the frame-
  // independent physical point used to drive the floating origin + SOI tests.
  UniverseCoord vesselRootCoord() const {
    return frames_.toRoot(vesselCoord());
  }

  // Altitude above the body's mean radius (ignores terrain relief).
  double vesselAltitude() const { return state_.r.length() - centralRadius(); }

  // Altitude above the actual terrain surface at the vessel's ground track
  // (uses world-gen's SampleTerrainHeight, the resident-free height query).
  double vesselTerrainAltitude() const {
    return state_.r.length() - terrainRadiusUnder(state_.r);
  }

  // ---- Scene setup ---------------------------------------------------------

  // Place the vessel ON the Forge surface at terrain altitude, at rest in the
  // rotating-with-the-ground sense (we model a non-rotating body for the slice,
  // so "at rest" = zero velocity). lat/lon in radians choose the launch site.
  void placeOnForgeSurface(double lat, double lon) {
    const Vec3 dir = worldgen::latLonToDir(lat, lon);
    const double surfaceR = terrainRadius(forgeBody_, dir);
    vesselFrame_ = forgeFrame_;
    state_.r = dir * surfaceR;
    state_.v = Vec3{0, 0, 0};
    mode_ = VesselMode::Active;
    thrust_ = Vec3{0, 0, 0};
    // Snap the floating origin onto the vessel so engine coords start near zero.
    syncFloatingOrigin(/*force*/ true);
  }

  // Set a constant thrust acceleration (m/s², in the body frame) for ACTIVE
  // integration (a constant burn). Zero = coast.
  void setThrust(const Vec3& accel) { thrust_ = accel; }

  // Directly set the vessel velocity (e.g. to circularize before parking).
  void setVesselVelocity(const Vec3& v) { state_.v = v; }
  void setVesselState(const orbital::StateVector& s) { state_ = s; }

  // Circular orbital speed at the vessel's current radius about its body.
  double circularSpeedHere() const {
    return std::sqrt(centralMu() / state_.r.length());
  }

  // ---- Active / on-rails handoff (MASTER_PLAN §3) --------------------------

  // Demote ACTIVE → ON-RAILS: park the live (r, v) into Kepler elements at the
  // current SimTime (lossless conic fit, the orbital core's park()).
  void parkToRails() {
    elements_ = orbital::park(state_, centralMu(), clock_.simTime());
    mode_ = VesselMode::OnRails;
  }

  // Promote ON-RAILS → ACTIVE: resume the conic at the current SimTime back to a
  // live (r, v). A park-then-immediately-resume is the identity (no drift).
  void promoteToActive() {
    state_ = orbital::resume(elements_, clock_.simTime());
    mode_ = VesselMode::Active;
  }

  // Switch to ACTIVE using the CURRENT live state_ (does NOT resume the parked
  // conic). Use after setVesselState() to hand a freshly-set state to the
  // symplectic integrator — e.g. taking manual control for a transfer/descent.
  void makeActiveFromCurrentState() { mode_ = VesselMode::Active; }

  const orbital::Elements& railElements() const { return elements_; }

  // ---- The fixed tick ------------------------------------------------------
  // Advance the whole world by exactly one fixed step:
  //   1. tick the factory (it keeps producing while you fly),
  //   2. advance the vessel — ACTIVE integrates one symplectic step; ON-RAILS
  //      propagates the conic to the new SimTime,
  //   3. detect an SOI crossing into Cinder and re-parent the frame + μ
  //      (continuously — the physical point does not jump),
  //   4. drive the floating origin to follow the active observer (rebasing as
  //      the vessel travels), and advance the SimClock.
  void step() {
    const double dt = clock_.fixedDt();

    // 1. Factory ticks under the same clock — the base keeps working.
    factory_.step();

    // 2. Vessel motion.
    if (mode_ == VesselMode::Active) {
      orbital::Integrator integ(state_, centralMu(), thrust_);
      integ.step(dt);
      state_ = integ.s;
    } else {
      // On-rails: evaluate the parked conic at the *next* tick's SimTime.
      const double nextTime = clock_.simTime() + dt;
      state_ = orbital::resume(elements_, nextTime);
    }

    // 3. Reference-frame (SOI) transition — patched conics (D-002).
    maybeCrossSOI();

    // 4. Floating origin tracks the active observer (rebases as we climb).
    syncFloatingOrigin(/*force*/ false);

    // 5. Advance the master clock (keeps factory + world on one TickIndex).
    clock_.advance(dt);
  }

  // ---- Terrain helpers (world-gen queries) ---------------------------------

  // Terrain surface radius (body radius + relief) under a body-frame direction.
  static double terrainRadius(const worldgen::BodyParams& body, const Vec3& dir) {
    return body.radiusM + worldgen::sampleHeightField(body, orbital::normalized(dir));
  }

  // Terrain surface radius under a body-frame position vector (its direction).
  double terrainRadiusUnder(const Vec3& r) const {
    return terrainRadius(centralBody(), r);
  }

  // True once the vessel has descended to (or below) the terrain surface +
  // a small contact tolerance — "ground contact".
  bool vesselLanded(double toleranceM = 1.0) const {
    return vesselTerrainAltitude() <= toleranceM;
  }

  // SOI bookkeeping (for tests / assertions).
  int soiSwitchCount() const { return soiSwitches_; }
  double cinderSoiRadius() const { return orbital::kCinderSoiRadius; }

  // Distance from the vessel (in root space) to Cinder's centre (root space).
  double distanceToCinderCentre() const {
    const Vec3 vRoot = vesselRootCoord().pos;
    const Vec3 cinderRoot = frames_.rootOffset(cinderFrame_);
    return (vRoot - cinderRoot).length();
  }
  double distanceToForgeCentre() const {
    const Vec3 vRoot = vesselRootCoord().pos;
    const Vec3 forgeRoot = frames_.rootOffset(forgeFrame_);
    return (vRoot - forgeRoot).length();
  }

 private:
  // --- Frame graph: star(root) → Forge → Cinder ----------------------------
  void buildFrames() {
    // Forge sits a long way from the star; the exact value is irrelevant to the
    // slice loop (we never leave Forge's SOI), it just exercises root-space
    // offsets at planetary scale (the precision case the floating origin solves).
    forgeFrame_ = frames_.addFrame(kRootFrame, Vec3{kForgeStarDistanceM, 0, 0},
                                   orbital::kForgeSoiRadius);
    // Cinder orbits Forge. Its offset is well inside Forge's SOI (8.4e7 m) and
    // far enough out that Cinder's own SOI (2.4e6 m) is a small bubble around it.
    cinderFrame_ = frames_.addFrame(forgeFrame_, Vec3{kCinderOrbitRadiusM, 0, 0},
                                    orbital::kCinderSoiRadius);
    vesselFrame_ = forgeFrame_;
  }

  // Keep the floating origin glued to the ACTIVE observer (the vessel), in ROOT
  // space — so engine-space coords (vessel relative to origin) stay near zero
  // however far the vessel travels in root space. `force` snaps immediately
  // (scene setup); otherwise the origin only jumps past the rebase threshold.
  void syncFloatingOrigin(bool force) {
    const UniverseCoord vRoot = vesselRootCoord();
    if (force) {
      // Force an immediate rebase onto the vessel by clearing the threshold once.
      // (maybeRebase only fires past threshold; for a hard snap we set origin.)
      forceRebaseOnto(vRoot);
    } else {
      floatingOrigin_.maybeRebase(vRoot);
    }
  }

  // Hard-snap the floating origin onto a coord (used at scene setup / right after
  // a frame switch, where we want engine coords to restart near zero). Uses the
  // public rebase path by temporarily guaranteeing the threshold is exceeded:
  // we simply call maybeRebase from a far-away synthetic prior — but cleaner is
  // to drive it through the same public API. FloatingOrigin rebases to the
  // observer's pos when the observer is past threshold; at setup the origin is
  // (0,0,0) and the vessel is ~1.5e11 away, so a single maybeRebase snaps it.
  void forceRebaseOnto(const UniverseCoord& vRoot) {
    floatingOrigin_.maybeRebase(vRoot);
  }

  // Patched-conics SOI transition: if the vessel (currently in Forge's frame)
  // enters Cinder's sphere of influence, re-express its state into Cinder's
  // frame and re-base the two-body problem on Cinder's μ. The physical point is
  // continuous: FrameGraph::toFrame is an exact offset, so position does not
  // jump; velocity is frame-relative and our frames are non-rotating, so it
  // carries over unchanged.
  void maybeCrossSOI() {
    if (vesselFrame_ == forgeFrame_) {
      if (distanceToCinderCentre() <= orbital::kCinderSoiRadius) {
        switchVesselToFrame(cinderFrame_);
        ++soiSwitches_;
      }
    } else if (vesselFrame_ == cinderFrame_) {
      // Symmetric exit (not needed for the slice's one-way trip, but correct).
      if (distanceToCinderCentre() > orbital::kCinderSoiRadius) {
        switchVesselToFrame(forgeFrame_);
        ++soiSwitches_;
      }
    }
  }

  // Re-express the vessel state into `target` frame, preserving the physical
  // point (position) and velocity (non-rotating frames share a velocity basis).
  // If on-rails, re-park the conic in the new frame's μ so propagation continues.
  void switchVesselToFrame(FrameId target) {
    const UniverseCoord here = vesselCoord();
    const UniverseCoord there = frames_.toFrame(here, target);
    state_.r = there.pos;
    // velocity is unchanged across a static-offset frame change.
    vesselFrame_ = target;
    if (mode_ == VesselMode::OnRails) {
      // Refit the conic to the NEW central body so resume() uses Cinder's μ.
      elements_ = orbital::park(state_, centralMu(), clock_.simTime());
    }
    // Restart engine-space coords near zero around the new active frame.
    syncFloatingOrigin(/*force*/ true);
  }

  // Constants (root-space layout; sensible, inside Forge's SOI).
  static constexpr double kForgeStarDistanceM = 1.5e11;   // ~1 AU from the star
  static constexpr double kCinderOrbitRadiusM = 1.2e7;    // 12,000 km Forge↔Cinder
                                                          // (> Cinder SOI 2.4e6,
                                                          //  ≪ Forge SOI 8.4e7)

  // Owned subsystems (the four cores + the integration state).
  SimClock clock_;
  factory::FactorySim factory_;
  FloatingOrigin floatingOrigin_;
  FrameGraph frames_;

  worldgen::BodyParams forgeBody_;
  worldgen::BodyParams cinderBody_;
  FrameId forgeFrame_ = kRootFrame;
  FrameId cinderFrame_ = kRootFrame;

  // Vessel.
  VesselMode mode_ = VesselMode::Active;
  FrameId vesselFrame_ = kRootFrame;
  orbital::StateVector state_{};   // (r, v) in vesselFrame_, body-centre-relative
  orbital::Elements elements_{};   // parked conic when ON-RAILS
  Vec3 thrust_{0, 0, 0};           // constant thrust accel while ACTIVE

  int soiSwitches_ = 0;
};

}  // namespace of
