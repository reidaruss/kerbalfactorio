#pragma once
// =============================================================================
// of::orbital — Patched-conics orbital mechanics for the Physics Wave-0 core.
//
// Implements (per docs/spikes/spike2-physics.md §1, §2, §4 and decisions
// PH-3 / PH-4):
//
//   * Classical Keplerian elements  (a, e, i, Ω, ω, ν / M0) for a given μ.
//   * state <-> elements conversions (the FConics transform library, §1.5).
//   * Universal-variable Kepler propagation — ONE code path for elliptic,
//     parabolic, and hyperbolic orbits (Stumpff functions C(z), S(z), Newton
//     iteration on the universal anomaly χ). This is PH-3: an escape/transfer
//     between Forge and Cinder is hyperbolic in one frame, and we must NOT have
//     a separately-buggy branch for it.
//   * A custom fixed-step SYMPLECTIC integrator (velocity-Verlet / leapfrog)
//     for two-body gravity (+ optional constant thrust accel). This is the
//     PH-4 hybrid: the custom integrator owns flight dynamics. Its headline
//     property is NO SECULAR ENERGY DRIFT (the "no-kraken" guarantee at the
//     math level, gates G3/G6/G8).
//   * A deliberately naive forward-Euler integrator, kept ONLY as the
//     cautionary contrast in the no-drift test (it visibly gains energy).
//   * Park/resume: state -> elements (+ epoch) -> state, the lossless conic fit
//     that underpins the on-rails↔active no-drift guarantee (§2.2).
//
// Pure, header-only, double precision. Builds on of::Vec3. No engine deps.
// =============================================================================
#include <cmath>
#include "of/vec3.h"

namespace of {
namespace orbital {

// --- Canonical body gravitational parameters (MASTER_PLAN §11 D-006) ---------
// μ = g · R².  Derived once here so no caller hardcodes its own copy (D-006).
//   Forge : R = 600 km, g ≈ 9.81 m/s²  -> μ ≈ 3.5316e12 m³/s²
//   Cinder: R = 200 km, g ≈ 1.63 m/s²  -> μ ≈ 6.52e10  m³/s²
constexpr double kForgeRadiusM   = 600.0e3;
constexpr double kForgeSurfaceG  = 9.81;
constexpr double kForgeMu        = kForgeSurfaceG * kForgeRadiusM * kForgeRadiusM;   // 3.5316e12
constexpr double kForgeSoiRadius = 8.4e7;   // m (spike2-physics §1.3)

constexpr double kCinderRadiusM   = 200.0e3;
constexpr double kCinderSurfaceG  = 1.63;
constexpr double kCinderMu        = kCinderSurfaceG * kCinderRadiusM * kCinderRadiusM;  // 6.52e10
constexpr double kCinderSoiRadius = 2.4e6;  // m (spike2-physics §1.3)

constexpr double kPi    = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;

// --- Small Vec3 helpers (cross product lives here, not in the core Vec3) ------
inline Vec3 cross(const Vec3& a, const Vec3& b) {
  return Vec3{a.y * b.z - a.z * b.y,
             a.z * b.x - a.x * b.z,
             a.x * b.y - a.y * b.x};
}
inline Vec3 normalized(const Vec3& v) {
  const double L = v.length();
  return (L > 0.0) ? v * (1.0 / L) : v;
}

// --- A two-body state: position + velocity in the central body's frame -------
struct StateVector {
  Vec3 r;  // position relative to the central body (m)
  Vec3 v;  // velocity in the central body's frame (m/s)
};

// --- Classical Keplerian element set (spike2-physics §1.1, FOrbitalElements) --
// a is negative for hyperbolic orbits (e > 1). Anomaly is stored as the mean
// anomaly at the epoch (M0); under two-body motion only the anomaly advances.
struct Elements {
  double a    = 0.0;   // semi-major axis (m); < 0 for hyperbolic
  double e    = 0.0;   // eccentricity (0 = circular, <1 ellipse, >1 hyperbola)
  double i    = 0.0;   // inclination (rad)
  double lan  = 0.0;   // Ω longitude of ascending node (rad)
  double argp = 0.0;   // ω argument of periapsis (rad)
  double nu   = 0.0;   // ν true anomaly at epoch (rad)
  double m0   = 0.0;   // M0 mean anomaly at epoch (rad)  (∞-handling for parabola not needed: clamped)
  double epoch = 0.0;  // SimTime at which m0/nu hold (s)
  double mu   = 0.0;   // central μ cached for propagation without a frame lookup
};

// =============================================================================
// Stumpff functions C(z), S(z) — the universal-variable kernel.
//   z = α·χ²  where α = 1/a (positive elliptic, negative hyperbolic, 0 parabolic)
// Closed forms with a series fallback near z = 0 to avoid catastrophic
// cancellation. (Wikipedia: Universal variable formulation; Vallado.)
// =============================================================================
inline double stumpffC(double z) {
  if (z > 1e-6) {
    return (1.0 - std::cos(std::sqrt(z))) / z;
  } else if (z < -1e-6) {
    const double s = std::sqrt(-z);
    return (std::cosh(s) - 1.0) / (-z);
  }
  // Series near 0: C = 1/2 - z/24 + z²/720 - ...
  return 0.5 - z / 24.0 + (z * z) / 720.0;
}

inline double stumpffS(double z) {
  if (z > 1e-6) {
    const double s = std::sqrt(z);
    return (s - std::sin(s)) / (s * s * s);
  } else if (z < -1e-6) {
    const double s = std::sqrt(-z);
    return (std::sinh(s) - s) / (s * s * s);
  }
  // Series near 0: S = 1/6 - z/120 + z²/5040 - ...
  return 1.0 / 6.0 - z / 120.0 + (z * z) / 5040.0;
}

// =============================================================================
// Universal-variable Kepler propagation.
//
// Propagate a state vector (r0, v0) forward by dt under gravity μ, returning the
// new (r, v). ONE path for elliptic / parabolic / hyperbolic — the branch is
// only in the sign of α = 1/a, absorbed by the Stumpff functions.
//
// Method: Newton iteration on the universal anomaly χ to satisfy the universal
// Kepler equation, then reconstruct (r, v) via the Lagrange f, g coefficients.
// (Curtis, "Orbital Mechanics for Engineering Students", Algorithm 3.4.)
// =============================================================================
inline StateVector propagate(const StateVector& s0, double dt, double mu) {
  if (dt == 0.0) return s0;

  const double r0 = s0.r.length();
  const double v0 = s0.v.length();
  const double vr0 = s0.r.dot(s0.v) / r0;          // radial velocity component
  const double alpha = 2.0 / r0 - (v0 * v0) / mu;  // = 1/a (reciprocal semi-major axis)
  const double sqrtMu = std::sqrt(mu);

  // Initial guess for χ (Curtis §3.7): scales well for all conic types.
  double chi;
  if (alpha > 1e-12) {
    // Elliptic
    chi = sqrtMu * std::fabs(alpha) * dt;
  } else if (alpha < -1e-12) {
    // Hyperbolic — Curtis's robust starting value.
    const double a = 1.0 / alpha;  // negative
    const double sgn = (dt >= 0.0) ? 1.0 : -1.0;
    chi = sgn * std::sqrt(-a) *
          std::log((-2.0 * mu * alpha * dt) /
                   (s0.r.dot(s0.v) +
                    sgn * std::sqrt(-mu * a) * (1.0 - r0 * alpha)));
  } else {
    // Near-parabolic
    chi = sqrtMu * dt / r0;
  }

  // Newton iteration on the universal Kepler equation:
  //   f(χ) = r0·vr0/√μ · χ²·C(z) + (1 - α·r0)·χ³·S(z) + r0·χ - √μ·dt = 0
  //   f'(χ) = r0·vr0/√μ · χ·(1 - α·χ²·S(z)) + (1 - α·r0)·χ²·C(z) + r0
  const int kMaxIter = 100;
  const double kTol = 1e-10;
  double z = 0.0;
  for (int it = 0; it < kMaxIter; ++it) {
    z = alpha * chi * chi;
    const double C = stumpffC(z);
    const double S = stumpffS(z);
    const double f = (r0 * vr0 / sqrtMu) * chi * chi * C +
                     (1.0 - alpha * r0) * chi * chi * chi * S +
                     r0 * chi - sqrtMu * dt;
    const double fp = (r0 * vr0 / sqrtMu) * chi * (1.0 - alpha * chi * chi * S) +
                      (1.0 - alpha * r0) * chi * chi * C + r0;
    const double dchi = f / fp;
    chi -= dchi;
    if (std::fabs(dchi) < kTol) break;
  }

  // Lagrange coefficients (Curtis Eq. 3.69) reconstruct (r, v).
  z = alpha * chi * chi;
  const double C = stumpffC(z);
  const double S = stumpffS(z);

  const double f = 1.0 - (chi * chi / r0) * C;
  const double g = dt - (1.0 / sqrtMu) * chi * chi * chi * S;

  const Vec3 r = s0.r * f + s0.v * g;
  const double rmag = r.length();

  const double fdot = (sqrtMu / (rmag * r0)) * (alpha * chi * chi * chi * S - chi);
  const double gdot = 1.0 - (chi * chi / rmag) * C;

  const Vec3 v = s0.r * fdot + s0.v * gdot;
  return StateVector{r, v};
}

// =============================================================================
// State vector  ->  classical elements  (spike2-physics §1.5: stateToElements).
// Handles e ≥ 1 (hyperbolic) and the near-circular / near-equatorial
// degeneracies with the standard fallbacks. `t` becomes the element epoch.
// =============================================================================
inline Elements stateToElements(const StateVector& s, double mu, double t = 0.0) {
  Elements el;
  el.mu = mu;
  el.epoch = t;

  const Vec3 r = s.r;
  const Vec3 v = s.v;
  const double rmag = r.length();
  const double vmag = v.length();

  const Vec3 h = cross(r, v);          // specific angular momentum
  const double hmag = h.length();

  const Vec3 nodeVec = cross(Vec3{0, 0, 1}, h);  // node line (points to asc. node)
  const double nmag = nodeVec.length();

  // Eccentricity vector: e = ((v² - μ/r)·r - (r·v)·v) / μ
  const double rdotv = r.dot(v);
  const Vec3 evec =
      (r * (vmag * vmag - mu / rmag) - v * rdotv) * (1.0 / mu);
  el.e = evec.length();

  // Specific orbital energy -> semi-major axis (negative a for hyperbola).
  const double energy = vmag * vmag / 2.0 - mu / rmag;
  if (std::fabs(energy) > 1e-12) {
    el.a = -mu / (2.0 * energy);
  } else {
    el.a = 1e308;  // parabolic edge: a -> ∞
  }

  // Inclination.
  el.i = std::acos(std::fmax(-1.0, std::fmin(1.0, h.z / hmag)));

  const double kSmall = 1e-11;
  const bool circular = el.e < kSmall;
  const bool equatorial = el.i < kSmall || (kPi - el.i) < kSmall;

  // Longitude of ascending node Ω.
  if (!equatorial && nmag > kSmall) {
    el.lan = std::acos(std::fmax(-1.0, std::fmin(1.0, nodeVec.x / nmag)));
    if (nodeVec.y < 0.0) el.lan = kTwoPi - el.lan;
  } else {
    el.lan = 0.0;  // equatorial: Ω undefined, conventionally 0
  }

  // Argument of periapsis ω and true anomaly ν.
  double nu;
  if (!circular && !equatorial && nmag > kSmall) {
    el.argp = std::acos(std::fmax(-1.0, std::fmin(1.0, nodeVec.dot(evec) / (nmag * el.e))));
    if (evec.z < 0.0) el.argp = kTwoPi - el.argp;
    nu = std::acos(std::fmax(-1.0, std::fmin(1.0, evec.dot(r) / (el.e * rmag))));
    if (rdotv < 0.0) nu = kTwoPi - nu;
  } else if (!circular && equatorial) {
    // Equatorial elliptic: use longitude of periapsis as ω, Ω = 0.
    el.argp = std::atan2(evec.y, evec.x);
    if (el.argp < 0.0) el.argp += kTwoPi;
    nu = std::acos(std::fmax(-1.0, std::fmin(1.0, evec.dot(r) / (el.e * rmag))));
    if (rdotv < 0.0) nu = kTwoPi - nu;
  } else if (circular && !equatorial) {
    // Circular inclined: ω = 0, use argument of latitude as ν.
    el.argp = 0.0;
    nu = std::acos(std::fmax(-1.0, std::fmin(1.0, nodeVec.dot(r) / (nmag * rmag))));
    if (r.z < 0.0) nu = kTwoPi - nu;
  } else {
    // Circular equatorial: ω = 0, use true longitude as ν.
    el.argp = 0.0;
    nu = std::atan2(r.y, r.x);
    if (nu < 0.0) nu += kTwoPi;
  }
  el.nu = nu;

  // Mean anomaly at epoch M0 from ν (one path keyed off conic type).
  if (el.e < 1.0) {
    // Elliptic: eccentric anomaly E then Kepler's equation.
    const double E = 2.0 * std::atan2(std::sqrt(1.0 - el.e) * std::sin(nu / 2.0),
                                      std::sqrt(1.0 + el.e) * std::cos(nu / 2.0));
    el.m0 = E - el.e * std::sin(E);
    el.m0 = std::fmod(el.m0, kTwoPi);
    if (el.m0 < 0.0) el.m0 += kTwoPi;
  } else {
    // Hyperbolic: hyperbolic anomaly H then hyperbolic Kepler's equation.
    const double H = 2.0 * std::atanh(std::sqrt((el.e - 1.0) / (el.e + 1.0)) *
                                      std::tan(nu / 2.0));
    el.m0 = el.e * std::sinh(H) - H;
  }
  return el;
}

// =============================================================================
// Classical elements  ->  state vector at time t  (spike2-physics §1.5).
// Builds the perifocal (r, v), then rotates into the frame by Ω, i, ω. The
// anomaly is advanced from epoch via the universal-variable propagator so a
// single, tested code path serves elliptic AND hyperbolic.
// =============================================================================
inline StateVector elementsToState(const Elements& el, double t) {
  const double mu = el.mu;

  // 1) Reconstruct the perifocal state at the element EPOCH from (a, e, ν0).
  // Use the conic radius/velocity formulas (valid for any e via |a|).
  const double e = el.e;
  const double nu = el.nu;
  // semi-latus rectum p = a(1 - e²); for hyperbola a<0, (1-e²)<0 -> p>0.
  const double p = el.a * (1.0 - e * e);
  const double rmag = p / (1.0 + e * std::cos(nu));

  // Perifocal frame (PQW): periapsis along +P.
  const Vec3 r_pqw{rmag * std::cos(nu), rmag * std::sin(nu), 0.0};
  const double sqrtMuP = std::sqrt(mu / p);
  const Vec3 v_pqw{-sqrtMuP * std::sin(nu),
                   sqrtMuP * (e + std::cos(nu)),
                   0.0};

  // 2) Rotate PQW -> frame by the 3-1-3 Euler sequence (Ω, i, ω).
  const double cO = std::cos(el.lan), sO = std::sin(el.lan);
  const double ci = std::cos(el.i), si = std::sin(el.i);
  const double cw = std::cos(el.argp), sw = std::sin(el.argp);

  // Rotation matrix rows (PQW -> ECI), standard astrodynamics R = Rz(-Ω)Rx(-i)Rz(-ω).
  const double R11 = cO * cw - sO * sw * ci;
  const double R12 = -cO * sw - sO * cw * ci;
  const double R21 = sO * cw + cO * sw * ci;
  const double R22 = -sO * sw + cO * cw * ci;
  const double R31 = sw * si;
  const double R32 = cw * si;

  auto rot = [&](const Vec3& u) {
    return Vec3{R11 * u.x + R12 * u.y,
                R21 * u.x + R22 * u.y,
                R31 * u.x + R32 * u.y};
  };

  StateVector atEpoch{rot(r_pqw), rot(v_pqw)};

  // 3) Propagate from the epoch to the requested time t (one universal path).
  return propagate(atEpoch, t - el.epoch, mu);
}

// =============================================================================
// Conserved quantities — used as correctness oracles by the tests.
// =============================================================================
inline double specificEnergy(const StateVector& s, double mu) {
  return s.v.lengthSq() / 2.0 - mu / s.r.length();
}
inline double specificAngularMomentum(const StateVector& s) {
  return cross(s.r, s.v).length();
}
inline double orbitalPeriod(double a, double mu) {
  // Defined only for bound (elliptic) orbits; a > 0.
  return kTwoPi * std::sqrt(a * a * a / mu);
}

// =============================================================================
// Gravitational acceleration toward the central body: a = -μ r / |r|³.
// (Optional constant thrust accel is added by the integrator caller.)
// =============================================================================
inline Vec3 gravAccel(const Vec3& r, double mu) {
  const double rmag = r.length();
  const double inv_r3 = 1.0 / (rmag * rmag * rmag);
  return r * (-mu * inv_r3);
}

// =============================================================================
// Custom fixed-step SYMPLECTIC integrator (velocity-Verlet / leapfrog).
//
// This is the PH-4 hybrid's flight-dynamics core. Velocity-Verlet is symplectic
// for separable Hamiltonians (kinetic + potential), so the discrete energy
// oscillates around the true value but DOES NOT drift secularly — the math-level
// "no-kraken" guarantee. Contrast with forward Euler below, which pumps energy.
//
// thrustAccel is an optional constant acceleration (m/s²) in the frame, applied
// every step (models a constant burn). Pass {0,0,0} for a pure coast.
// =============================================================================
struct Integrator {
  StateVector s;
  double mu;
  Vec3 thrustAccel{0, 0, 0};

  Integrator(const StateVector& s0, double mu_, Vec3 thrust = Vec3{0, 0, 0})
      : s(s0), mu(mu_), thrustAccel(thrust) {}

  // One symplectic (velocity-Verlet) step of size dt.
  void step(double dt) {
    const Vec3 a0 = gravAccel(s.r, mu) + thrustAccel;
    // r_{n+1} = r_n + v_n·dt + 1/2·a_n·dt²
    s.r = s.r + s.v * dt + a0 * (0.5 * dt * dt);
    // a_{n+1} from the new position
    const Vec3 a1 = gravAccel(s.r, mu) + thrustAccel;
    // v_{n+1} = v_n + 1/2·(a_n + a_{n+1})·dt
    s.v = s.v + (a0 + a1) * (0.5 * dt);
  }

  void stepN(double dt, int n) {
    for (int k = 0; k < n; ++k) step(dt);
  }
};

// =============================================================================
// Naive forward-Euler integrator — the cautionary contrast ONLY.
//
//   r_{n+1} = r_n + v_n·dt
//   v_{n+1} = v_n + a(r_n)·dt
//
// Explicit Euler is NOT symplectic; on a bound orbit it secularly GAINS energy
// (the orbit spirals outward) — exactly the class of error that produces the
// KSP "kraken" when a general solver integrates planetary-scale gravity. The
// no-drift test pits the symplectic integrator against this to show WHY the
// symplectic choice matters (spike2-physics §4.3).
// =============================================================================
struct EulerIntegrator {
  StateVector s;
  double mu;
  Vec3 thrustAccel{0, 0, 0};

  EulerIntegrator(const StateVector& s0, double mu_, Vec3 thrust = Vec3{0, 0, 0})
      : s(s0), mu(mu_), thrustAccel(thrust) {}

  void step(double dt) {
    const Vec3 a = gravAccel(s.r, mu) + thrustAccel;
    s.r = s.r + s.v * dt;          // uses OLD velocity (explicit)
    s.v = s.v + a * dt;            // uses OLD-position accel (explicit)
  }
  void stepN(double dt, int n) {
    for (int k = 0; k < n; ++k) step(dt);
  }
};

// =============================================================================
// Park / resume — the on-rails↔active no-drift round-trip (spike2-physics §2.2).
//   park  : active CoM state (r, v) -> Keplerian elements (+ epoch). Lossless,
//           because two-body motion is exactly the conic through any (r, v).
//   resume: elements evaluated at SimTime -> (r, v). Re-derives the same conic.
// A demote-then-immediately-promote at the same time is the identity on (r, v)
// up to float error — the formal no-drift guarantee (gate G6).
// =============================================================================
inline Elements park(const StateVector& s, double mu, double simTime) {
  return stateToElements(s, mu, simTime);
}
inline StateVector resume(const Elements& el, double simTime) {
  return elementsToState(el, simTime);
}

}  // namespace orbital
}  // namespace of
