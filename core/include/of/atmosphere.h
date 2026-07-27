#pragma once
// =============================================================================
// of::atmo - the atmosphere, and the flight forces that read it.
//
// This is DW-30's "less air resistance as you get higher" made numeric, and it
// is the ONE authority for air density in the simulation. Three separate things
// read it and they must not disagree:
//
//   1. drag        (0.5 * rho * v^2 * CdA), which is what makes an ascent cost
//                  more than the orbital velocity alone;
//   2. engine      thrust and Isp, which rise as ambient pressure falls;
//   3. the SPACE   boundary, which is where of::orbital takes the trajectory
//                  over from the powered-flight integrator (see flight.h).
//
// PH-10 - the model is a single exponential, rho = rho0 * exp(-h / H), with
// H = 5600 m for Forge. That number is not invented here: D-006 fixes Forge's
// atmospheric scale height at ~5.6 km and the rendering lane's scattering model
// (web/src/render/materials/Atmosphere.glsl.ts, `rayleighScaleM: 5.6e3`,
// `thicknessM: 6.0e4`) already ships it. Picking a second scale height would
// have made the air you fly through disagree with the air you look at, which is
// the five-surfaces failure wearing a different hat. Cinder is airless (D-006).
//
// PH-11 - the exponential is FADED TO EXACTLY ZERO over the top 10 km rather
// than truncated at the ceiling. See section 2 for the numbers and the reason.
//
// Header-only, double precision, no engine deps. Depends on of::Vec3 and on
// of::worldgen::BodyParams (the one body-constant authority, D-006/DW-18).
// =============================================================================
#include <cmath>
#include <cstdint>

#include "of/vec3.h"

namespace of {
namespace atmo {

// =============================================================================
// SECTION 1 - constants.
// =============================================================================

// The specific-impulse reference constant. This is a UNIT CONVERSION, not a
// gravity: Isp in seconds times g0 gives an exhaust velocity in m/s, and the
// value is 9.80665 m/s^2 by international definition wherever you are in the
// solar system.
//
// It is deliberately NOT BodyParams::muM3S2 / r^2, and it is deliberately not
// 9.81 either. Forge's SURFACE gravity happens to be 9.81 m/s^2 (DW-18) and the
// two constants therefore look almost identical, which is exactly why this
// comment exists: a rocket flown to Cinder must burn at the same Isp it burned
// at on the pad. The one gravity authority is BodyParams::muM3S2 and nothing in
// this file reads a gravity at all.
constexpr double kG0 = 9.80665;

// =============================================================================
// SECTION 2 - the atmosphere profile.
//
// rho(h) = rho0 * exp(-h / H) * fade(h)
// p(h)/p0 =        exp(-h / H) * fade(h)     (isothermal: p and rho share a
//                                             scale height, so ONE exponential
//                                             serves both and they cannot drift)
//
// PH-11, the fade, stated with its numbers because it is a deliberate
// concession and not an accident of a simplified model:
//
//   The raw exponential at Forge's 60 km ceiling is 2.723e-5 kg/m^3. That is
//   small but it is NOT nothing: on a 2 t vessel with CdA = 2 m^2 at orbital
//   speed (2313 m/s) it is 0.072 m/s^2 of deceleration. Truncating it at the
//   ceiling therefore puts a step in the force at exactly the altitude every
//   player circularises at, and an orbit 100 m below the line decays while an
//   orbit 100 m above it is eternal. KSP has this wart; KSP hides it by making
//   the boundary density about a thousandth of ours.
//
//   So the density is multiplied by a C1 smoothstep that is 1 at and below
//   fadeStartM (50 km) and 0 at and above topM (60 km). Consequences, all
//   measured in test_flight.cpp:
//     * density is CONTINUOUS everywhere, including across the space boundary,
//       so thrust, Isp and drag have no step anywhere;
//     * density is EXACTLY 0.0 above the ceiling, so "am I on rails" is a
//       boolean and not a threshold (flight.h's handoff to of::orbital);
//     * the raw exponential is untouched below 50 km, where 99.98% of the drag
//       integral of an ascent lives. The whole cost of the fade is paid in a
//       band the vehicle crosses in about 12 seconds.
// =============================================================================
struct AtmosphereProfile {
  double seaLevelDensityKgM3 = 0.0;  // rho0
  double scaleHeightM = 1.0;         // H
  double topM = 0.0;                 // ceiling: density is exactly 0 at/above
  double fadeStartM = 0.0;           // below this the exponential is exact

  bool present() const { return seaLevelDensityKgM3 > 0.0 && topM > 0.0; }
};

// Forge (bodyId 0): Earth-like sea level, D-006's 5.6 km scale height, and the
// 60 km ceiling the rendering lane's scattering shell already uses.
inline AtmosphereProfile makeForgeAtmosphere() {
  AtmosphereProfile a;
  a.seaLevelDensityKgM3 = 1.225;
  a.scaleHeightM = 5600.0;
  a.topM = 60000.0;
  a.fadeStartM = 50000.0;
  return a;
}

// Cinder (bodyId 1): airless, per D-006. Every query returns exactly 0 and
// `present()` is false, so a caller can branch once instead of per-sample.
inline AtmosphereProfile makeCinderAtmosphere() { return AtmosphereProfile{}; }

// Body id -> profile. The bodyId values are BodyParams::bodyId (0 Forge,
// 1 Cinder); anything else is airless until somebody authors it.
inline AtmosphereProfile atmosphereForBody(uint32_t bodyId) {
  if (bodyId == 0) return makeForgeAtmosphere();
  return makeCinderAtmosphere();
}

// --- The raw exponential, with NO fade. Exposed so the tests can pin the
//     model itself separately from the concession, and so a caller that wants
//     the honest physical value (e.g. a debug readout) can have it.
inline double densityRaw(const AtmosphereProfile& a, double altitudeM) {
  if (!a.present()) return 0.0;
  if (altitudeM <= 0.0) return a.seaLevelDensityKgM3;  // below the datum: clamp
  return a.seaLevelDensityKgM3 * std::exp(-altitudeM / a.scaleHeightM);
}

// C1 smoothstep, 1 at/below x0 and 0 at/above x1. (Not std::lerp games: this is
// written out so the continuity claim is readable.)
inline double fadeToVacuum(double h, double x0, double x1) {
  if (h <= x0) return 1.0;
  if (h >= x1) return 0.0;
  const double t = (h - x0) / (x1 - x0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

// THE density (PH-10 + PH-11). This is what every force reads.
inline double density(const AtmosphereProfile& a, double altitudeM) {
  if (!a.present() || altitudeM >= a.topM) return 0.0;
  return densityRaw(a, altitudeM) * fadeToVacuum(altitudeM, a.fadeStartM, a.topM);
}

// Ambient pressure as a FRACTION of sea level, in [0, 1]. Isothermal, so this
// is the same exponential as the density, which is the point: one curve, so the
// air a wing feels and the air an engine bell feels can never disagree.
inline double pressureRatio(const AtmosphereProfile& a, double altitudeM) {
  if (!a.present()) return 0.0;
  return density(a, altitudeM) / a.seaLevelDensityKgM3;
}

// The space boundary: at or above this, density is EXACTLY zero, drag is
// exactly zero, engines produce exactly their vacuum figures, and flight.h is
// willing to hand the trajectory to of::orbital (see flight.h section 6).
inline double spaceAltitudeM(const AtmosphereProfile& a) { return a.topM; }

inline bool inSpace(const AtmosphereProfile& a, double altitudeM) {
  return !a.present() || altitudeM >= a.topM;
}

// Dynamic pressure q = 1/2 rho v^2 (Pa). The one number that says how hard the
// air is working on the vehicle; max-q is where a badly built rocket flips.
inline double dynamicPressure(double densityKgM3, double airspeedMS) {
  return 0.5 * densityKgM3 * airspeedMS * airspeedMS;
}

// =============================================================================
// SECTION 3 - engine lapse with ambient pressure.
//
// Both thrust and Isp interpolate linearly on the PRESSURE ratio between their
// sea-level and vacuum figures, which is the standard game-engine model and the
// one KSP uses.
//
// The invariant worth knowing (and worth testing, which test_flight.cpp does):
// if the authored parts satisfy T_sl / Isp_sl == T_vac / Isp_vac, then mass
// flow is EXACTLY constant at every altitude, because
//     T(p)/Isp(p) = [k*Isp_vac(1-p) + k*Isp_sl*p] / [Isp_vac(1-p) + Isp_sl*p]
//                 = k
// identically in p. That is physically right (a bell's throat does not care
// what is outside it), and it means a stage's BURN TIME is an altitude-
// independent property of the stage, which is what lets the assembly view show
// one honest number.
// =============================================================================
inline double lapse(double seaLevelValue, double vacuumValue, double pRatio) {
  return vacuumValue + (seaLevelValue - vacuumValue) * pRatio;
}

}  // namespace atmo
}  // namespace of
