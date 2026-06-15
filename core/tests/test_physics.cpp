// =============================================================================
// Wave-0 headless tests for the Physics & Orbital Mechanics core.
//
// Maps the spike2-physics validation gates to concrete headless assertions:
//   - G1  Conic correctness        -> Kepler propagation returns to start over
//                                     one period; energy & angular momentum
//                                     conserved by the analytic propagator.
//   - PH-3 universal-variable      -> a HYPERBOLIC (e>1) flyby round-trips
//                                     forward-and-back through the SAME code path.
//   - G3/G6/G8 NO-DRIFT (headline) -> the custom SYMPLECTIC integrator tracks the
//                                     analytic conic over dozens of periods with
//                                     BOUNDED energy drift, while naive forward
//                                     Euler visibly GAINS energy (the kraken).
//   - G6  Park/resume no-drift     -> state -> elements -> state is the identity
//                                     for both an elliptic and a hyperbolic orbit.
//
// Numbers use the real Forge/Cinder μ values (D-006) so the orbits are physical.
// =============================================================================
#include "test_framework.h"
#include "of/orbital.h"

using namespace of;
using namespace of::orbital;

// --- helpers -----------------------------------------------------------------
static double dist(const Vec3& a, const Vec3& b) { return (a - b).length(); }

// A canonical low circular Forge orbit: 100 km altitude above R=600 km.
// Circular speed v = sqrt(μ/r); place it on +x moving +y so it's equatorial.
static StateVector lowForgeCircular() {
  const double r = kForgeRadiusM + 100.0e3;       // 700 km radius
  const double v = std::sqrt(kForgeMu / r);        // circular speed
  return StateVector{Vec3{r, 0, 0}, Vec3{0, v, 0}};
}

// =============================================================================
// G1a — Kepler propagation correctness: one full period returns to the start.
// A circular Forge orbit propagated by exactly its period T must return to the
// initial (r, v) to tight tolerance.
// =============================================================================
TEST(kepler_circular_returns_after_one_period) {
  const StateVector s0 = lowForgeCircular();
  const double r = s0.r.length();
  const double a = r;  // circular: a == r
  const double T = orbitalPeriod(a, kForgeMu);

  const StateVector s1 = propagate(s0, T, kForgeMu);

  // Position and velocity return to the start (sub-millimetre / sub-µm-per-s).
  CHECK_NEAR(s1.r.x, s0.r.x, 1e-3);
  CHECK_NEAR(s1.r.y, s0.r.y, 1e-3);
  CHECK_NEAR(s1.r.z, s0.r.z, 1e-3);
  CHECK_NEAR(s1.v.x, s0.v.x, 1e-6);
  CHECK_NEAR(s1.v.y, s0.v.y, 1e-6);
  CHECK_NEAR(s1.v.z, s0.v.z, 1e-6);

  // Half a period -> diametrically opposite, velocity reversed.
  const StateVector sh = propagate(s0, T / 2.0, kForgeMu);
  CHECK_NEAR(sh.r.x, -s0.r.x, 1e-2);
  CHECK_NEAR(sh.v.y, -s0.v.y, 1e-5);
}

// =============================================================================
// G1b — Elliptical orbit: energy and angular momentum are conserved BY the
// analytic propagation, and one period returns to start. Uses a real low-Forge
// elliptical orbit (periapsis 700 km radius, apoapsis higher).
// =============================================================================
TEST(kepler_elliptic_conserves_energy_and_momentum) {
  // Periapsis at 700 km radius, give it extra speed (1.15x circular) -> ellipse.
  const double rp = kForgeRadiusM + 100.0e3;
  const double vc = std::sqrt(kForgeMu / rp);
  const StateVector s0{Vec3{rp, 0, 0}, Vec3{0, 1.15 * vc, 0}};

  const Elements el = stateToElements(s0, kForgeMu, 0.0);
  CHECK(el.e > 0.0 && el.e < 1.0);          // genuinely elliptic
  CHECK(el.a > rp);                          // a larger than periapsis radius

  const double E0 = specificEnergy(s0, kForgeMu);
  const double h0 = specificAngularMomentum(s0);

  // Sample the orbit at several points across one period; conserved quantities
  // must hold at every sample (analytic propagation is exact).
  const double T = orbitalPeriod(el.a, kForgeMu);
  for (int k = 1; k <= 8; ++k) {
    const double t = (T * k) / 8.0;
    const StateVector s = propagate(s0, t, kForgeMu);
    CHECK_NEAR(specificEnergy(s, kForgeMu), E0, std::fabs(E0) * 1e-9);
    CHECK_NEAR(specificAngularMomentum(s), h0, h0 * 1e-9);
  }

  // Full period returns to start.
  const StateVector s1 = propagate(s0, T, kForgeMu);
  CHECK_NEAR(dist(s1.r, s0.r), 0.0, 1.0);          // < 1 m over the whole orbit
  CHECK_NEAR((s1.v - s0.v).length(), 0.0, 1e-3);   // < 1 mm/s
}

// =============================================================================
// PH-3 — Universal-variable handles HYPERBOLIC orbits (e > 1) with the SAME
// code path. Propagate a hyperbolic flyby forward then back -> round-trips, and
// the trajectory has the expected escape character (energy > 0, a < 0).
// =============================================================================
TEST(universal_variable_hyperbolic_roundtrips) {
  // A Cinder hyperbolic flyby: periapsis 300 km radius, speed 1.6x escape.
  const double rp = kCinderRadiusM + 100.0e3;       // 300 km radius
  const double vEsc = std::sqrt(2.0 * kCinderMu / rp);
  const StateVector s0{Vec3{rp, 0, 0}, Vec3{0, 1.6 * vEsc, 0}};

  const Elements el = stateToElements(s0, kCinderMu, 0.0);
  CHECK(el.e > 1.0);                                 // genuinely hyperbolic
  CHECK(el.a < 0.0);                                 // negative semi-major axis
  CHECK(specificEnergy(s0, kCinderMu) > 0.0);        // unbound (escape) energy

  const double E0 = specificEnergy(s0, kCinderMu);
  const double h0 = specificAngularMomentum(s0);

  // Propagate forward a good chunk of the flyby, then back the same dt.
  const double dt = 600.0;  // 10 minutes
  const StateVector fwd = propagate(s0, dt, kCinderMu);

  // Conserved quantities hold on the hyperbola too.
  CHECK_NEAR(specificEnergy(fwd, kCinderMu), E0, std::fabs(E0) * 1e-9);
  CHECK_NEAR(specificAngularMomentum(fwd), h0, h0 * 1e-9);

  // It actually moved a long way (sanity: not a no-op).
  CHECK(dist(fwd.r, s0.r) > 100.0e3);

  // Round-trip back to the start.
  const StateVector back = propagate(fwd, -dt, kCinderMu);
  CHECK_NEAR(back.r.x, s0.r.x, 1e-2);
  CHECK_NEAR(back.r.y, s0.r.y, 1e-2);
  CHECK_NEAR(back.r.z, s0.r.z, 1e-2);
  CHECK_NEAR(back.v.x, s0.v.x, 1e-5);
  CHECK_NEAR(back.v.y, s0.v.y, 1e-5);
  CHECK_NEAR(back.v.z, s0.v.z, 1e-5);
}

// =============================================================================
// HEADLINE — NO-DRIFT (gates G3 / G6 / G8). The "no-kraken at the math level."
//
// Integrate a coasting low-Forge orbit with the custom SYMPLECTIC integrator for
// MANY thousands of steps (dozens of periods) and compare against the analytic
// conic. Assert:
//   (a) energy drift stays BOUNDED and small (symplectic integrators oscillate
//       energy but do NOT secularly gain it);
//   (b) the integrated position stays within a stated tolerance of analytic;
//   (c) a naive forward-Euler integrator over the SAME run VISIBLY GAINS energy
//       — the contrast that documents WHY the symplectic choice matters.
// =============================================================================
TEST(no_drift_symplectic_vs_euler_over_many_orbits) {
  const StateVector s0 = lowForgeCircular();
  const double r0 = s0.r.length();
  const double T = orbitalPeriod(r0, kForgeMu);
  const double E0 = specificEnergy(s0, kForgeMu);

  // Fixed step ~ T/2000 (≈ 0.3 s for this orbit) over 30 full periods.
  const int stepsPerOrbit = 2000;
  const int orbits = 30;
  const double dt = T / stepsPerOrbit;
  const int totalSteps = stepsPerOrbit * orbits;

  Integrator sym(s0, kForgeMu);
  EulerIntegrator eul(s0, kForgeMu);

  // Track the worst-case (max) energy excursion of the SYMPLECTIC integrator
  // across the whole run — a symplectic scheme keeps this bounded.
  double symMaxRelEnergyErr = 0.0;
  for (int k = 0; k < totalSteps; ++k) {
    sym.step(dt);
    const double E = specificEnergy(sym.s, kForgeMu);
    const double rel = std::fabs((E - E0) / E0);
    if (rel > symMaxRelEnergyErr) symMaxRelEnergyErr = rel;
  }
  // Euler integrated separately for the same number of steps.
  for (int k = 0; k < totalSteps; ++k) eul.step(dt);

  const double symFinalRelErr =
      std::fabs((specificEnergy(sym.s, kForgeMu) - E0) / E0);
  const double eulFinalRelErr =
      std::fabs((specificEnergy(eul.s, kForgeMu) - E0) / E0);

  // (a) Symplectic energy error is BOUNDED and tiny over 30 orbits.
  CHECK(symMaxRelEnergyErr < 1e-3);     // worst-case excursion < 0.1%
  CHECK(symFinalRelErr < 1e-3);         // and it does NOT grow secularly

  // (b) Symplectic position tracks the analytic conic to a stated tolerance.
  // Compare final positions: analytic vs integrated after the whole run.
  const StateVector analyticFinal =
      propagate(s0, dt * totalSteps, kForgeMu);
  const double posErr = dist(sym.s.r, analyticFinal.r);
  // Tolerance: well under 0.1% of orbit radius (700 km -> 700 m budget).
  CHECK(posErr < 700.0);

  // (c) The cautionary contrast: naive Euler GAINS energy by orders of
  // magnitude more than the symplectic scheme. This is the kraken.
  CHECK(eulFinalRelErr > 50.0 * symFinalRelErr);
  CHECK(eulFinalRelErr > symMaxRelEnergyErr);  // exceeds the symplectic envelope

  // Surface the measured figures in the test log for the completion report.
  std::printf(
      "    [no-drift] symplectic max|dE/E|=%.3e final|dE/E|=%.3e  "
      "pos_err=%.3g m  |  euler final|dE/E|=%.3e  (ratio %.1fx)\n",
      symMaxRelEnergyErr, symFinalRelErr, posErr, eulFinalRelErr,
      eulFinalRelErr / std::fmax(symFinalRelErr, 1e-30));
}

// =============================================================================
// NO-DRIFT corollary — over the SAME long run, the symplectic semi-major axis
// (orbit size) stays put while Euler's orbit spirals OUTWARD (a grows). Directly
// shows "no secular drift" vs "energy pumping" in element space.
// =============================================================================
TEST(no_drift_symplectic_orbit_size_stable_euler_spirals) {
  const StateVector s0 = lowForgeCircular();
  const double T = orbitalPeriod(s0.r.length(), kForgeMu);
  const double dt = T / 2000.0;
  const int totalSteps = 2000 * 20;  // 20 orbits

  const double a0 = stateToElements(s0, kForgeMu).a;

  Integrator sym(s0, kForgeMu);
  EulerIntegrator eul(s0, kForgeMu);
  sym.stepN(dt, totalSteps);
  eul.stepN(dt, totalSteps);

  const double aSym = stateToElements(sym.s, kForgeMu).a;
  const double aEul = stateToElements(eul.s, kForgeMu).a;

  // Symplectic keeps orbit size within 0.1%.
  CHECK_NEAR(aSym, a0, a0 * 1e-3);
  // Euler's orbit has visibly inflated (energy gained -> a grows outward).
  CHECK(aEul > a0 * 1.01);
}

// =============================================================================
// G6 — Park/resume round-trip is the identity on (r, v), for an ELLIPTIC orbit.
// state -> Keplerian elements (+ epoch) -> state, evaluated at the same SimTime.
// This is the formal no-drift guarantee at the on-rails↔active seam.
// =============================================================================
TEST(park_resume_roundtrip_elliptic_is_identity) {
  // An inclined, eccentric Forge orbit so every element is exercised.
  const double rp = kForgeRadiusM + 250.0e3;
  const double vc = std::sqrt(kForgeMu / rp);
  // Give it an out-of-plane velocity component for nonzero inclination.
  const StateVector s0{Vec3{rp, 0, 0},
                       Vec3{0.0, 1.1 * vc * 0.92, 1.1 * vc * 0.39}};

  const double simTime = 1234.5;
  const Elements el = park(s0, kForgeMu, simTime);
  CHECK(el.e > 0.0 && el.e < 1.0);
  CHECK(el.i > 0.0);  // genuinely inclined

  const StateVector s1 = resume(el, simTime);  // same SimTime -> identity
  CHECK_NEAR(s1.r.x, s0.r.x, 1e-4);
  CHECK_NEAR(s1.r.y, s0.r.y, 1e-4);
  CHECK_NEAR(s1.r.z, s0.r.z, 1e-4);
  CHECK_NEAR(s1.v.x, s0.v.x, 1e-7);
  CHECK_NEAR(s1.v.y, s0.v.y, 1e-7);
  CHECK_NEAR(s1.v.z, s0.v.z, 1e-7);

  // And resuming at a LATER time matches a direct analytic propagation
  // (park stores the conic; resume(t) == propagate(s0, t - epoch)).
  const StateVector sLater = resume(el, simTime + 500.0);
  const StateVector sProp = propagate(s0, 500.0, kForgeMu);
  CHECK_NEAR(dist(sLater.r, sProp.r), 0.0, 1e-2);
}

// =============================================================================
// G6 (hyperbolic) — element round-trip for a HYPERBOLIC orbit. Confirms the
// park/resume path is conic-type agnostic (PH-3): one code path, e<1 and e>1.
// =============================================================================
TEST(park_resume_roundtrip_hyperbolic_is_identity) {
  const double rp = kCinderRadiusM + 50.0e3;
  const double vEsc = std::sqrt(2.0 * kCinderMu / rp);
  // Inclined hyperbolic flyby.
  const StateVector s0{Vec3{rp, 0, 0},
                       Vec3{0.0, 1.4 * vEsc * 0.9, 1.4 * vEsc * 0.4}};

  const double simTime = 42.0;
  const Elements el = park(s0, kCinderMu, simTime);
  CHECK(el.e > 1.0);   // hyperbolic
  CHECK(el.a < 0.0);
  CHECK(el.i > 0.0);

  const StateVector s1 = resume(el, simTime);
  CHECK_NEAR(s1.r.x, s0.r.x, 1e-3);
  CHECK_NEAR(s1.r.y, s0.r.y, 1e-3);
  CHECK_NEAR(s1.r.z, s0.r.z, 1e-3);
  CHECK_NEAR(s1.v.x, s0.v.x, 1e-6);
  CHECK_NEAR(s1.v.y, s0.v.y, 1e-6);
  CHECK_NEAR(s1.v.z, s0.v.z, 1e-6);
}

// =============================================================================
// μ sanity (D-006) — the derived gravitational parameters are the documented
// values, so the orbits above are physical (not arbitrary toy numbers).
// =============================================================================
TEST(body_mu_values_match_D006) {
  CHECK_NEAR(kForgeMu, 3.5316e12, 1e9);    // g·R² for Forge
  CHECK_NEAR(kCinderMu, 6.52e10, 1e7);     // g·R² for Cinder
  // Surface gravity reconstructs: g = μ / R².
  CHECK_NEAR(kForgeMu / (kForgeRadiusM * kForgeRadiusM), 9.81, 1e-6);
  CHECK_NEAR(kCinderMu / (kCinderRadiusM * kCinderRadiusM), 1.63, 1e-6);
}

// =============================================================================
// Thrust integration — the symplectic integrator accepts a constant thrust
// accel and a coast (zero thrust) reproduces the analytic conic. Light sanity
// that the integrator's thrust path is wired and gravity-only matches Kepler.
// =============================================================================
TEST(integrator_coast_matches_kepler_thrust_raises_orbit) {
  const StateVector s0 = lowForgeCircular();
  const double T = orbitalPeriod(s0.r.length(), kForgeMu);
  const double dt = T / 4000.0;

  // Coast (no thrust) for a quarter orbit -> matches analytic.
  Integrator coast(s0, kForgeMu);
  coast.stepN(dt, 1000);  // T/4
  const StateVector analytic = propagate(s0, dt * 1000, kForgeMu);
  CHECK(dist(coast.s.r, analytic.r) < 50.0);  // tight tracking

  // Prograde thrust raises specific energy (orbit-raising burn).
  const Vec3 prograde = normalized(s0.v);
  Integrator burn(s0, kForgeMu, prograde * 5.0);  // 5 m/s² prograde
  const double Ebefore = specificEnergy(burn.s, kForgeMu);
  burn.stepN(dt, 1000);
  const double Eafter = specificEnergy(burn.s, kForgeMu);
  CHECK(Eafter > Ebefore);  // energy added by thrust
}
