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
#include "of/flight.h"
#include "of/orbital.h"
#include "of/vessel.h"

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
// LAMBERT (PH-145). The one INVERSE in orbital.h, and the piece every transfer,
// rendezvous and departure-time chart is built out of.
//
// THE ORACLE IS THE PROPAGATOR ITSELF AND IT NEEDS NO OUTSIDE DATA. Take a real
// conic, ask the forward solver where it is at t0 and at t0+dt, then hand those
// two positions and that dt to the inverse and demand it return the conic's OWN
// velocities. Any error in the sweep angle, the branch, the Lagrange
// coefficients or the Stumpff arguments shows up as a velocity that does not
// match, and the two solvers share only C(z) and S(z), so this is not a
// tautology: `propagate` iterates on chi with r0 and v0 known, `lambert`
// iterates on z with r1 and r2 known.
// =============================================================================
TEST(lambert_recovers_the_conic_the_propagator_flew) {
  // Deliberately eccentric and inclined, so no term can be zero by luck.
  const StateVector s0{Vec3(7.0e5, 1.2e5, -2.0e5),
                       Vec3(-400.0, 2100.0, 900.0)};
  const Vec3 h = cross(s0.r, s0.v);

  // The conic's period is 2584.54 s. Every time of flight below is UNDER it,
  // which is not a detail: see the next test.
  const double tofs[4] = {120.0, 600.0, 1500.0, 2400.0};
  for (double tof : tofs) {
    const StateVector s1 = propagate(s0, tof, kForgeMu);
    const LambertSolution L = lambert(s0.r, s1.r, tof, kForgeMu, h);
    CHECK(L.valid);
    // 1 mm/s against velocities of ~2.3 km/s. The MEASURED agreement is 1e-8
    // m/s or better; the tolerance is loose so a future retune of the iteration
    // limit does not turn a 4 ULP change into a red line.
    CHECK_NEAR(L.v1.x, s0.v.x, 1e-3);
    CHECK_NEAR(L.v1.y, s0.v.y, 1e-3);
    CHECK_NEAR(L.v1.z, s0.v.z, 1e-3);
    CHECK_NEAR(L.v2.x, s1.v.x, 1e-3);
    CHECK_NEAR(L.v2.y, s1.v.y, 1e-3);
    CHECK_NEAR(L.v2.z, s1.v.z, 1e-3);
    CHECK(L.sweepRad > 0.0 && L.sweepRad < kTwoPi);
    // and the sweep it reports is the one actually flown.
    const Vec3 c = cross(s0.r, s1.r);
    double cd = s0.r.dot(s1.r) / (s0.r.length() * s1.r.length());
    if (cd > 1.0) cd = 1.0;
    if (cd < -1.0) cd = -1.0;
    const double flown = (c.dot(h) >= 0.0) ? std::acos(cd) : kTwoPi - std::acos(cd);
    CHECK_NEAR(L.sweepRad, flown, 1e-12);
  }
}

// -----------------------------------------------------------------------------
// AND THE RESTRICTION, MEASURED RATHER THAN ASSUMED, because it is the one way
// this function returns a CONFIDENT WRONG ANSWER.
//
// `lambert` solves the SINGLE-REVOLUTION problem. Ask it for a time of flight
// longer than the period and it does not fail and it does not warn: it correctly
// answers a different question, "reach that point sweeping 0.05 rad in 2600 s",
// which is a huge slow ellipse rather than the orbit you were on. The signature
// is unmistakable once you look for it (a 3.5 km/s error on a 2.3 km/s orbit),
// and the rule that avoids it belongs to the CALLER, who knows the period:
// keep the time of flight under one revolution. `transfer.h` does exactly that.
// -----------------------------------------------------------------------------
TEST(lambert_is_single_revolution_and_this_pins_where_that_bites) {
  const StateVector s0{Vec3(7.0e5, 1.2e5, -2.0e5), Vec3(-400.0, 2100.0, 900.0)};
  const Vec3 h = cross(s0.r, s0.v);
  const Elements el = stateToElements(s0, kForgeMu, 0.0);
  const double period = orbitalPeriod(el.a, kForgeMu);
  CHECK_NEAR(period, 2584.54, 0.01);

  // Just under: it is the orbit we flew, to the last digit that matters.
  const double under = period * 0.99;
  const StateVector a1 = propagate(s0, under, kForgeMu);
  const LambertSolution A = lambert(s0.r, a1.r, under, kForgeMu, h);
  CHECK(A.valid);
  CHECK((A.v1 - s0.v).length() < 1e-3);

  // Just over: still `valid`, still finite, and NOT the orbit we flew.
  const double over = period * 1.01;
  const StateVector b1 = propagate(s0, over, kForgeMu);
  const LambertSolution B = lambert(s0.r, b1.r, over, kForgeMu, h);
  CHECK(B.valid);
  CHECK((B.v1 - s0.v).length() > 1000.0);
}

// -----------------------------------------------------------------------------
// AND THE CLOSED-FORM CROSS-CHECK, because the test above would still pass if
// the two solvers shared one wrong constant. A HOHMANN transfer between two
// coplanar circular orbits has a delta-v every textbook publishes.
//
// IT CANNOT BE ASKED FOR DIRECTLY, and that is a property rather than a
// nuisance: a Hohmann sweeps EXACTLY 180 degrees, so its two endpoints are
// collinear through the focus, and collinear endpoints determine no plane.
// Every Lambert solver in existence is singular there. So the assertion is the
// LIMIT: as the sweep approaches 180 degrees the two-burn total must converge
// to the textbook figure FROM ABOVE and never go under it, because Hohmann is
// the optimum and nothing may beat it.
//
// Hand figures for Forge, 700 km to 1000 km (Anchorage's radius):
//   v1c 2246.139545   vP 2436.280400   dv1 190.140854
//   v2c 1879.255172   vA 1705.396280   dv2 173.858892
//   total 363.999746   half-period 1310.063984 s
// -----------------------------------------------------------------------------
TEST(lambert_converges_to_the_textbook_hohmann_from_above) {
  const double mu = kForgeMu;
  const double r1 = kForgeRadiusM + 100.0e3;
  const double r2 = kForgeRadiusM + 400.0e3;
  const double aT = 0.5 * (r1 + r2);
  const double v1c = std::sqrt(mu / r1);
  const double vP = std::sqrt(mu * (2.0 / r1 - 1.0 / aT));
  const double vA = std::sqrt(mu * (2.0 / r2 - 1.0 / aT));
  const double dv1Book = vP - v1c;
  const double dv2Book = std::sqrt(mu / r2) - vA;
  const double totalBook = dv1Book + dv2Book;
  const double tofBook = kPi * std::sqrt(aT * aT * aT / mu);
  CHECK_NEAR(dv1Book, 190.140854, 1e-5);
  CHECK_NEAR(dv2Book, 173.858892, 1e-5);
  CHECK_NEAR(tofBook, 1310.063984, 1e-5);

  // The transfer ellipse itself, departing prograde at periapsis.
  const StateVector t0{Vec3(r1, 0.0, 0.0), Vec3(0.0, vP, 0.0)};
  const Vec3 h = cross(t0.r, t0.v);

  const double fracs[4] = {0.90, 0.95, 0.99, 0.999};
  double prevTotal = 1e9;
  for (double f : fracs) {
    const double tof = tofBook * f;
    const StateVector t1 = propagate(t0, tof, mu);
    const LambertSolution L = lambert(t0.r, t1.r, tof, mu, h);
    CHECK(L.valid);
    // It recovers the transfer ellipse it was handed, first of all.
    CHECK((L.v1 - t0.v).length() < 1e-6);
    CHECK((L.v2 - t1.v).length() < 1e-6);

    // Departure is AT periapsis in every case, so this burn is exactly the
    // textbook one at every sweep and not only in the limit.
    const double burn1 = (L.v1 - Vec3(0.0, v1c, 0.0)).length();
    CHECK_NEAR(burn1, dv1Book, 1e-6);

    // Arrival: circularise at whatever radius the sweep actually reached.
    const double R = t1.r.length();
    const Vec3 east = cross(normalized(h), normalized(t1.r));
    const double burn2 = (east * std::sqrt(mu / R) - L.v2).length();

    const double total = burn1 + burn2;
    CHECK(total >= totalBook);        // nothing beats Hohmann
    CHECK(total < prevTotal);         // and it converges monotonically
    prevTotal = total;
  }
  // MEASURED: 378.330602, 367.719292, 364.150422, 364.001254 against a book
  // 363.999746. The last is 0.0015 m/s over at a sweep of 179.872 degrees.
  CHECK(prevTotal - totalBook < 0.01);
  CHECK_NEAR(prevTotal, 364.001254, 1e-4);
}

// -----------------------------------------------------------------------------
// It REFUSES rather than inventing an answer. Every one of these has exactly one
// honest response and it is `valid == false`.
// -----------------------------------------------------------------------------
TEST(lambert_refuses_the_cases_that_have_no_answer) {
  const Vec3 a(7.0e5, 0.0, 0.0), b(0.0, 7.0e5, 0.0);
  const Vec3 n = cross(a, b);
  CHECK(!lambert(a, b, 0.0, kForgeMu, n).valid);        // no time
  CHECK(!lambert(a, b, -100.0, kForgeMu, n).valid);     // negative time
  CHECK(!lambert(a, b, 600.0, 0.0, n).valid);           // no gravity
  CHECK(!lambert(a, a * 2.0, 600.0, kForgeMu, n).valid);   // collinear, same way
  CHECK(!lambert(a, a * -1.0, 600.0, kForgeMu, n).valid);  // collinear, opposite
  CHECK(!lambert(Vec3(0, 0, 0), b, 600.0, kForgeMu, n).valid);  // at the centre
  // A refused solve returns zeros, not garbage, so a caller that ignores
  // `valid` gets an obviously wrong answer rather than a plausible one.
  const LambertSolution bad = lambert(a, b, -1.0, kForgeMu, n);
  CHECK(bad.v1.lengthSq() == 0.0 && bad.v2.lengthSq() == 0.0);
}

// -----------------------------------------------------------------------------
// The reference normal, not an axis, decides the sweep. Flip it and the SAME
// two points are joined the long way round, which is the property that makes
// this work in a codebase carrying two inclination conventions (PH-40).
// -----------------------------------------------------------------------------
TEST(lambert_takes_its_direction_from_the_reference_normal) {
  const Vec3 a(7.0e5, 0.0, 0.0), b(0.0, 7.0e5, 0.0);
  const Vec3 n = cross(a, b);
  const LambertSolution shortWay = lambert(a, b, 900.0, kForgeMu, n);
  const LambertSolution longWay = lambert(a, b, 900.0, kForgeMu, n * -1.0);
  CHECK(shortWay.valid);
  CHECK(longWay.valid);
  CHECK_NEAR(shortWay.sweepRad, kPi / 2.0, 1e-9);
  CHECK_NEAR(longWay.sweepRad, 1.5 * kPi, 1e-9);
  // Same endpoints, same clock, different conic: the velocities must differ.
  CHECK((shortWay.v1 - longWay.v1).length() > 100.0);
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

// =============================================================================
// ON RAILS, for a VESSEL (G6 / PH-16, through of::flight rather than through a
// bare state vector).
//
// The tests above prove park/resume is the identity on (r, v). What a client
// actually demotes is a VESSEL: a craft with stages, propellant and an
// attitude, living in a FlightSim. This test asserts the four things the
// on-rails contract owes that client, on the reference vehicle in an 80 km
// circular Forge orbit with the throttle shut:
//
//   1. PATH INDEPENDENCE, exactly. Where the vessel is at a given SimTime is a
//      function of the elements and that SimTime and of nothing else, so
//      asking ONCE for t0 + 60 s and asking 3000 times in 20 ms increments must
//      give BIT-IDENTICAL answers.
//   2. RE-FITTING IS A DIFFERENT COMPUTATION, and is the negative control that
//      makes point 1 mean something. Re-parking at every step is not
//      bit-identical, so fitting the conic once and then leaving it alone is a
//      load-bearing decision rather than a stylistic one.
//   3. DEMOTE/PROMOTE ROUND TRIP against the integrator: the conic and the
//      actively stepped vehicle agree over 60 s and over a full revolution.
//   4. THE CRAFT IS UNTOUCHED. resume writes posM, velMS and timeS and nothing
//      else, so the stage index and the propellant aboard survive a restore.
//      The client's save/load path depends on exactly that.
// =============================================================================

// The reference vehicle, built the way test_flight.cpp's `makeAscender(true)`
// builds it: 9845 kg on the pad, 4922.91 m/s of vacuum delta-v. Copied rather
// than shared because the two suites are separate translation units and neither
// owns a fixture header; if the construction below ever stops matching
// test_flight.cpp, the two suites are measuring two different rockets.
struct RailsAscender {
  vessel::Vessel v;
  vessel::PartHandle pod, chute, tankUp, engUp, dec, tankLo, engLo;
};

static RailsAscender makeRailsAscender() {
  RailsAscender a;
  vessel::Vessel& v = a.v;
  a.pod = v.addRoot(vessel::parts::CommandPod);
  a.chute = v.attach(a.pod, vessel::parts::Parachute, vessel::Attach::StackBottom);
  a.tankUp = v.attach(a.chute, vessel::parts::TankLiquidSmall,
                      vessel::Attach::StackBottom);
  a.engUp = v.attach(a.tankUp, vessel::parts::EngineVacuumSmall,
                     vessel::Attach::StackBottom);
  a.dec = v.attach(a.engUp, vessel::parts::DecouplerStackSmall,
                   vessel::Attach::StackBottom);
  a.tankLo = v.attach(a.dec, vessel::parts::TankLiquidSmallLong,
                      vessel::Attach::StackBottom);
  a.engLo = v.attach(a.tankLo, vessel::parts::EngineLiquidSmall,
                     vessel::Attach::StackBottom);
  for (int i = 0; i < 4; ++i)
    v.attach(a.tankLo, vessel::parts::Fin, vessel::Attach::Radial,
             i * 0.5 * kPi, 0.15);
  v.assignSubtreeToStage(a.dec, 0);
  vessel::Stage s0; s0.activate.push_back(a.engLo);
  vessel::Stage s1; s1.activate.push_back(a.engUp); s1.decouple.push_back(a.dec);
  v.stages.push_back(s0);
  v.stages.push_back(s1);
  v.layout();
  return a;
}

// A FlightSim carrying that vehicle on the 80 km circular orbit, first stage
// LIT and the throttle shut. Lit deliberately: "on rails" must mean "nothing is
// acting", not "no engine has ever been staged", and a vessel that has already
// staged is the one a player actually parks. The stage index is 1 here, which
// is what makes assertion 4 below a real check rather than 0 == 0.
static flight::FlightSim makeRailsSim(const flight::FlightEnvironment& env,
                                      double rM, double vCircMS, double t0S) {
  flight::FlightSim sim;
  sim.craft = makeRailsAscender().v;
  sim.env = env;
  sim.state.posM = Vec3{rM, 0, 0};
  sim.state.velMS = Vec3{0, vCircMS, 0};
  sim.state.forward = Vec3{0, 1, 0};   // nose prograde
  sim.state.right = Vec3{1, 0, 0};
  sim.state.throttle = 0.0;
  sim.state.timeS = t0S;
  // Attitude is not what this test is about, and SAS Off is what guarantees it:
  // no torque is demanded, so no monopropellant can be spent, so the propellant
  // assertion at the end can only be moved by the park/resume path itself.
  sim.sas = flight::SasMode::Off;
  sim.stage();
  return sim;
}

TEST(vessel_on_rails_determinism) {
  flight::FlightEnvironment env;
  env.muM3S2 = kForgeMu;              // DW-18: the ONE gravity authority
  env.bodyRadiusM = kForgeRadiusM;
  env.air = atmo::makeForgeAtmosphere();

  const double r = kForgeRadiusM + 80000.0;        // 680 km radius
  const double vCirc = std::sqrt(kForgeMu / r);    // 2278.93 m/s
  const double t0 = 137.0;                         // a nonzero epoch, so the
                                                   // element epoch is exercised
  const double dt = 0.02;                          // the sim tick
  const int M = 3000;                              // 60 s of it

  flight::FlightSim sim = makeRailsSim(env, r, vCirc, t0);

  // The premise: 80 km is above the 60 km atmosphere ceiling and the throttle
  // is shut, so nothing of::flight models is acting and the trajectory IS a
  // conic. Everything below is meaningless if this is false.
  CHECK(sim.onRailsEligible());
  CHECK_NEAR(vCirc, 2278.93, 0.01);

  const Elements el = park(sim.orbitalState(), env.muM3S2, sim.state.timeS);
  CHECK_NEAR(el.a, r, 1.0);
  CHECK(el.e < 1e-9);          // genuinely circular
  CHECK(el.epoch == t0);       // parked at the instant it was asked for

  // ---- 1. PATH INDEPENDENCE, exactly ------------------------------------
  // Exact `==` and not a tolerance, because these are not two approximations of
  // the same answer: the elements never move, only the time asked for does, so
  // both calls run the SAME arithmetic on the SAME inputs. `t0 + M * dt` and
  // the loop's last `t0 + k * dt` are the same expression on the same doubles.
  // A tolerance here would let a hidden mutable in resume() through, which is
  // the one failure this property exists to make impossible.
  const StateVector jump = resume(el, t0 + M * dt);

  StateVector walked = resume(el, t0);
  for (int k = 1; k <= M; ++k) walked = resume(el, t0 + k * dt);

  CHECK(walked.r.x == jump.r.x);
  CHECK(walked.r.y == jump.r.y);
  CHECK(walked.r.z == jump.r.z);
  CHECK(walked.v.x == jump.v.x);
  CHECK(walked.v.y == jump.v.y);
  CHECK(walked.v.z == jump.v.z);
  // and it really did move: 60 s of a 1875 s orbit is about 137 km of arc.
  CHECK(dist(jump.r, sim.state.posM) > 100.0e3);

  // ---- 2. RE-FITTING IS NOT THE SAME THING (the negative control) --------
  // Same 3000 samples, but the conic is re-fitted from the propagated state at
  // every one of them. state -> elements -> state is the identity in exact
  // arithmetic and is NOT the identity in doubles (it goes through acos, atan2
  // and Kepler's equation each way), so 3000 of them accumulate. Asserting only
  // that the answer DIFFERS is the honest bar: the size of the difference is a
  // property of the rounding, not of the design, but the fact that there is one
  // is what makes "fit once, then leave it alone" a decision worth keeping.
  // Measured 8.98e-10 m and 1.53e-11 m/s apart after 3000 re-fits, i.e. tiny but
  // real. It is NOT asserted as a magnitude, because a magnitude here would be
  // an assertion about the compiler's rounding rather than about the design.
  StateVector reFit = resume(el, t0);
  Elements rolling = el;
  for (int k = 1; k <= M; ++k) {
    const double t = t0 + k * dt;
    reFit = resume(rolling, t);
    rolling = park(reFit, env.muM3S2, t);
  }
  const double reFitPosErrM = dist(reFit.r, jump.r);
  const double reFitVelErrMS = (reFit.v - jump.v).length();
  const bool reFitIsBitIdentical =
      reFit.r.x == jump.r.x && reFit.r.y == jump.r.y && reFit.r.z == jump.r.z &&
      reFit.v.x == jump.v.x && reFit.v.y == jump.v.y && reFit.v.z == jump.v.z;
  CHECK(!reFitIsBitIdentical);

  // ---- 3. DEMOTE / PROMOTE ROUND TRIP against the integrator -------------
  // A second vessel in the identical initial state, advanced ACTIVELY at 20 ms
  // through of::flight (which above the atmosphere with the engine shut is
  // bit-for-bit of::orbital::Integrator), against the conic evaluated at the
  // same instant. Any disagreement is the integrator's own truncation error.
  flight::FlightSim active = makeRailsSim(env, r, vCirc, t0);
  for (int k = 0; k < M; ++k) active.step(dt);

  // The active clock accumulates dt 3000 times while the conic is asked for
  // t0 + 3000*dt in one multiply; the two differ by well under a nanosecond, so
  // compare at the sim's OWN clock (which is what a real restore does) and pin
  // that they are the same instant.
  CHECK_NEAR(active.state.timeS, t0 + M * dt, 1e-9);
  const StateVector railed60 = resume(el, active.state.timeS);
  const double pos60M = (active.state.posM - railed60.r).length();
  const double vel60MS = (active.state.velMS - railed60.v).length();
  // Measured 1.014e-4 m and 1.827e-7 m/s over the 60 s. One metre and one
  // centimetre per second are four orders of magnitude above that, deliberately:
  // this pair is the "did the seam move at all" bar, and the tight one is the
  // full-revolution pair below.
  CHECK(pos60M < 1.0);
  CHECK(vel60MS < 0.01);

  // The same thing over a FULL REVOLUTION, which is where truncation error has
  // had time to show. 1874.81 s at 20 ms is 93740 steps.
  const double period = orbitalPeriod(el.a, env.muM3S2);
  CHECK_NEAR(period, 1874.81, 0.01);
  const int revSteps = static_cast<int>(period / dt);
  flight::FlightSim rev = makeRailsSim(env, r, vCirc, t0);
  for (int k = 0; k < revSteps; ++k) rev.step(dt);
  const StateVector railedRev = resume(el, rev.state.timeS);
  const double posRevM = (rev.state.posM - railedRev.r).length();
  const double velRevMS = (rev.state.velMS - railedRev.v).length();
  // Bounds are the MEASURED residue plus generous headroom, stated as such:
  // measured 6.395e-3 m and 2.143e-5 m/s over one 1874.81 s revolution at a
  // 20 ms step. 0.05 m and 2e-4 m/s leave roughly eight times that, which is
  // room for a compiler's floating-point rounding and none at all for a change
  // in the physics.
  //
  // That residue is the whole of velocity-Verlet's truncation error and nothing
  // else, and it is the size theory says: the scheme's frequency error is
  // (omega*dt)^2/24, here 1.9e-10, so one revolution of phase slip is 1.2e-9 rad
  // and 680 km of radius turns that into about a millimetre. If this figure ever
  // comes back in metres, something has started acting on a vessel that is
  // supposed to be coasting.
  CHECK(posRevM < 0.05);
  CHECK(velRevMS < 2.0e-4);
  // and the orbit itself has not drifted: a full revolution later the vessel is
  // back where it started, which is the no-drift claim in its plainest form.
  // 50 m rather than a millimetre because 93740 whole ticks is 1874.800 s
  // against a 1874.811 s period, so the run stops 0.010958 s short of the top
  // and the vessel is still 24.97 m of arc away from it. That gap is the integer
  // step count, not the physics; the physics is the 6.4 mm above.
  CHECK(dist(rev.state.posM, Vec3{r, 0, 0}) < 50.0);

  // ---- 4. THE PROPELLANT AND THE STAGE INDEX DO NOT MOVE ON RAILS --------
  // resume() writes posM, velMS and timeS. Nothing else in the craft is its
  // business, and the client's restore path is built on that: a vessel that
  // came off rails with a different stage index or a different fuel load would
  // be a vessel the save file no longer describes.
  const int stageBefore = sim.craft.nextStageIndex;
  const double lfBefore =
      vessel::propellantAboardKg(sim.craft, vessel::Propellant::LiquidFuel);
  const double monoBefore =
      vessel::propellantAboardKg(sim.craft, vessel::Propellant::Monopropellant);
  CHECK(stageBefore == 1);          // the lower stage has been fired
  CHECK_NEAR(lfBefore, 6450.0, 1e-9);   // 2150 + 4300 kg, both tanks full
  CHECK_NEAR(monoBefore, 40.0, 1e-9);   // the pod's own tank

  sim.resume(el, t0 + M * dt);
  CHECK(sim.craft.nextStageIndex == stageBefore);
  CHECK(vessel::propellantAboardKg(sim.craft, vessel::Propellant::LiquidFuel) ==
        lfBefore);
  CHECK(vessel::propellantAboardKg(sim.craft,
                                   vessel::Propellant::Monopropellant) ==
        monoBefore);
  // and the restore did land where the conic said it would, so the round trip
  // was a real one and not a no-op.
  CHECK(sim.state.posM.x == jump.r.x);
  CHECK(sim.state.posM.y == jump.r.y);
  CHECK(sim.state.posM.z == jump.r.z);
  CHECK(sim.state.timeS == t0 + M * dt);

  std::printf(
      "    [vessel on rails] 80 km circular Forge, reference vehicle, 20 ms tick\n"
      "      1. one jump vs 3000 samples : BIT-IDENTICAL on all six components\n"
      "      2. re-fitting every step    : pos %.6g m, vel %.6g m/s away from the\n"
      "                                    single jump (%s)\n"
      "      3. active vs rails,   60 s  : pos %.6g m, vel %.6g m/s\n"
      "         active vs rails, 1 rev   : pos %.6g m, vel %.6g m/s over %.1f s"
      " (%d steps)\n"
      "      4. stage index %d and %.1f kg of propellant unchanged by resume\n",
      reFitPosErrM, reFitVelErrMS,
      reFitIsBitIdentical ? "BIT-IDENTICAL, which the test does not expect"
                          : "not bit-identical, as expected",
      pos60M, vel60MS, posRevM, velRevMS, period, revSteps,
      sim.craft.nextStageIndex, lfBefore);
}
