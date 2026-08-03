#pragma once
// =============================================================================
// of::flight - powered atmospheric and near-body flight for a vessel.
//
// This is the half of the vessel programme that of::orbital deliberately does
// NOT cover. orbital.h owns conics: a coasting body under one point mass,
// propagated analytically, with no drift, and it is green and pinned. It knows
// nothing about mass that changes, air that pushes back, or which way the nose
// is pointing. flight.h owns exactly those three things, and hands the
// trajectory back the moment they stop mattering.
//
// THE BOUNDARY, stated once (§6):
//   flight.h integrates while ANY of {thrust, drag} is non-zero.
//   Above the atmosphere ceiling with the engines off, both are exactly zero,
//   the integrator reduces BIT-FOR-BIT to of::orbital::Integrator, and the
//   trajectory may be parked as a conic with no loss. test_flight.cpp asserts
//   the bit-exactness rather than asserting a tolerance, because the two code
//   paths really are the same arithmetic in the same order and anything less
//   than exact would mean one of them had drifted.
//
// Sections:
//   §1  flight state and environment
//   §2  propulsion: thrust, Isp lapse, propellant draw
//   §3  drag
//   §4  aerodynamic torque and the DW-30 anti-flip model
//   §5  control authority and stability assist
//   §6  the integrator, and the handoff to of::orbital
//   §7  the gravity-turn guidance ribbon (DW-30 item 6): shown, not flown
//
// Gravity comes from BodyParams::muM3S2 and from nowhere else (DW-18). There is
// no g in this file, no density model, and no second constant that could
// disagree with the walker about the same planet.
//
// Header-only, double precision, no engine deps.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "of/atmosphere.h"
#include "of/orbital.h"
#include "of/vec3.h"
#include "of/vessel.h"

namespace of {
namespace flight {

using orbital::cross;
using orbital::normalized;

// =============================================================================
// §1 - state and environment.
// =============================================================================

// Attitude is carried as two orthonormal body axes expressed in the world
// (body-centred inertial) frame. `forward` is the vessel's +Y, the stack axis,
// pointing at the nose: the same axis the art contract assembles along, so a
// renderer needs no convention translation. `right` is the vessel's +X and
// exists so roll is representable; the third axis is their cross product.
struct FlightState {
  Vec3 posM{0, 0, 0};        // relative to the body centre
  Vec3 velMS{0, 0, 0};       // in the body-centred inertial frame
  Vec3 forward{0, 1, 0};     // unit
  Vec3 right{1, 0, 0};       // unit, perpendicular to forward
  Vec3 angVelRadS{0, 0, 0};  // world frame
  double timeS = 0.0;
  double throttle = 0.0;     // 0..1, clamped by each engine's minThrottle

  double altitudeM(double bodyRadiusM) const { return posM.length() - bodyRadiusM; }
};

struct FlightEnvironment {
  double muM3S2 = 0.0;        // THE gravity authority (BodyParams::muM3S2)
  double bodyRadiusM = 0.0;
  atmo::AtmosphereProfile air;
  // Angular velocity of the body, and therefore of its atmosphere, about +Y.
  // Zero until core-engine publishes a rotation rate on BodyParams (D-006
  // lists rotation in the body definition; the struct does not carry it yet).
  // Carried here so that adding it later is a value change and not a rewrite.
  double bodySpinRadS = 0.0;
};

// The air's velocity at a point, i.e. what a co-rotating atmosphere is doing.
inline Vec3 airVelocity(const FlightEnvironment& env, const Vec3& posM) {
  if (env.bodySpinRadS == 0.0) return Vec3{0, 0, 0};
  return cross(Vec3{0, env.bodySpinRadS, 0}, posM);
}

// =============================================================================
// §2 - propulsion.
// =============================================================================

struct PropulsionOutput {
  double thrustN = 0.0;        // total, at the current ambient pressure
  double massFlowKgS = 0.0;    // total propellant consumption
  double ispS = 0.0;           // thrust-weighted, at the current pressure
  int liveEngineCount = 0;     // engines with propellant left
};

// Which propellant pool an engine may draw from: parts in the same stage group
// as the engine, holding the kind it consumes.
//
// A solid booster is the exception that proves the rule: its SolidFuel lives in
// the booster part ITSELF, so "the same stage group" resolves to its own tank
// and no crossfeed is possible, which is exactly the behaviour DW-29 asks for
// without a special case.
inline std::vector<vessel::PartHandle> feedGroup(const vessel::Vessel& v,
                                                 const vessel::PartInstance& engine) {
  std::vector<vessel::PartHandle> out;
  const vessel::PartDef& ed = v.def(engine);
  for (const auto& p : v.parts) {
    if (v.def(p).propellant != ed.consumes) continue;
    if (p.stage != engine.stage) continue;
    if (p.propellantKg <= 0.0) continue;
    out.push_back(p.handle);
  }
  return out;
}

// Draw `wantKg` proportionally from every tank in the group. Proportional
// rather than top-tank-first is a modelling choice worth naming: it keeps the
// centre of mass moving smoothly instead of lurching each time a tank empties,
// which removes a source of attitude disturbance that teaches nothing. Returns
// what was actually drawn, which is less than wantKg on the last tick of a burn.
inline double drawPropellant(vessel::Vessel& v,
                             const std::vector<vessel::PartHandle>& group,
                             double wantKg) {
  if (wantKg <= 0.0 || group.empty()) return 0.0;
  double available = 0.0;
  for (vessel::PartHandle h : group) {
    const vessel::PartInstance* p = v.find(h);
    if (p) available += p->propellantKg;
  }
  const double take = std::min(wantKg, available);
  if (take <= 0.0) return 0.0;
  const double frac = take / available;
  double drawn = 0.0;
  for (vessel::PartHandle h : group) {
    vessel::PartInstance* p = v.find(h);
    if (!p) continue;
    const double d = p->propellantKg * frac;
    p->propellantKg -= d;
    if (p->propellantKg < 1e-9) p->propellantKg = 0.0;
    drawn += d;
  }
  return drawn;
}

// Evaluate (do not consume) the propulsion the vessel would produce right now.
inline PropulsionOutput evaluatePropulsion(const vessel::Vessel& v,
                                           double throttle, double pressureRatio) {
  PropulsionOutput out;
  double invIsp = 0.0;
  for (vessel::PartHandle h : vessel::activeEngines(v)) {
    const vessel::PartInstance* e = v.find(h);
    if (!e) continue;
    const vessel::PartDef& d = v.def(*e);
    if (!d.isEngine()) continue;
    if (feedGroup(v, *e).empty()) continue;  // dry: produces nothing

    // A non-throttleable engine (a solid) burns at its minThrottle, which is
    // authored as 1.0, whatever the lever says.
    const double th = d.throttleable
                          ? std::max(d.minThrottle, std::min(1.0, throttle))
                          : d.minThrottle;
    if (th <= 0.0) continue;

    const double T = atmo::lapse(d.thrustSeaLevelN, d.thrustVacuumN, pressureRatio) * th;
    const double isp = atmo::lapse(d.ispSeaLevelS, d.ispVacuumS, pressureRatio);
    if (T <= 0.0 || isp <= 0.0) continue;
    out.thrustN += T;
    invIsp += T / isp;
    out.massFlowKgS += T / (isp * atmo::kG0);
    ++out.liveEngineCount;
  }
  if (invIsp > 0.0) out.ispS = out.thrustN / invIsp;
  return out;
}

// =============================================================================
// §3 and §4 - aerodynamics.
//
// The drag decomposition, and why it is two terms and not one:
//
//   v_air is split into the component along the nose (v_ax) and the component
//   across it (v_n). Each gets its own Cd*A, summed over the parts:
//       F = -1/2 rho |v| ( CdA_axial v_ax + CdA_normal v_n )
//   At zero angle of attack that is ordinary axial drag. At 90 degrees it is
//   the full broadside. In between, the normal term grows as sin(alpha), which
//   is the right lift-curve behaviour for a body at small angles and is what
//   makes a fin worth bolting on.
//
//   The pitching MOMENT is computed with a different coefficient from the
//   force, which is standard aerodynamic practice and is explained at length on
//   PartDef::normalForceSlopeM2: broadside drag area says how hard the air
//   pushes a vehicle flying sideways, and the normal-force slope says where the
//   pushing starts when it is barely off axis. The moment arm is
//   (CoP - CoM) with the CoP weighted by the normal-force slope, and because
//   the axial term is parallel to that arm for an on-axis stack, every bit of
//   the pitching moment comes from the normal term. That is the flip.
// =============================================================================

struct AeroTuning {
  // ---- DW-30 item 1: aerodynamic flip is damped out. ----------------------
  //
  // The static margin, (CoP - CoM) . forward, decides the SIGN of the pitching
  // moment. Negative (CoP behind CoM) is a RESTORING moment: the air pushes the
  // nose back onto the airflow, which is what fins buy you. Positive (CoP ahead
  // of CoM) is a DESTABILISING moment: any angle of attack grows, and once it
  // passes about 30 degrees the vehicle is going backwards. That divergence is
  // the single mechanic DW-30 names as making KSP brutal for a beginner, and
  // Reid's brief is explicit that it is a frustration, not a decision.
  //
  // So: destabilising pitching moment is multiplied by this gain, and RESTORING
  // pitching moment is not touched. Three properties follow, and all three are
  // measured in test_flight.cpp:
  //
  //   * it is CONTINUOUS. The moment is proportional to the static margin, so
  //     it is exactly zero at the margin where the gain switches. There is no
  //     step to fall through as a tank drains and the CoM walks aft.
  //   * fins still do real work. A finned rocket is on the restoring branch,
  //     gets the full physical moment, and visibly weathercocks onto prograde.
  //     The concession makes bad designs survivable; it does not make good
  //     designs pointless.
  //   * at the default 0.0 the claim "a rocket at a modest angle of attack does
  //     not tumble" is a theorem rather than a race between two coefficients.
  //     Rate damping alone CANNOT hold the angle of a statically unstable body:
  //     it bounds the rate and lets the angle grow linearly. The only honest
  //     ways to get a bounded ANGLE are to remove the divergence or to fly a
  //     controller, and DW-30 asks for the former.
  //
  // Set to 1.0 to get the real, unforgiving physics back; it is the negative
  // control the anti-flip test uses, and it tumbles in about 3 seconds.
  double unstableAeroGain = 0.0;

  // ---- Aerodynamic pitch damping (a real derivative, generously sized). ----
  // M_q = -k * 1/2 rho |v| * CdA_normal * L^2 * omega_perp. Dimensionally a
  // pitch-damping moment; physically it is the fact that a rotating body meets
  // its own rotation as a distributed angle of attack along its length. Real
  // vehicles have it, KSP models it thinly, and it is what makes a rocket
  // settle rather than ring. It vanishes with rho, so it does nothing in space.
  double pitchDampK = 0.25;

  // Roll is not damped by the above (a body of revolution has almost no roll
  // damping), so it gets its own small term, otherwise a roll disturbance in
  // atmosphere never decays.
  double rollDampK = 0.05;
};

struct AeroForces {
  Vec3 forceN{0, 0, 0};     // world frame, acting at the CoP
  Vec3 torqueNm{0, 0, 0};   // world frame, about the CoM
  double densityKgM3 = 0.0;
  double dynamicPressurePa = 0.0;
  double airspeedMS = 0.0;
  double angleOfAttackRad = 0.0;
  double staticMarginM = 0.0;  // > 0 means statically unstable
  bool flipDampingActive = false;
};

inline AeroForces aerodynamics(const vessel::Vessel& v,
                               const vessel::MassProperties& mp,
                               const FlightState& s,
                               const FlightEnvironment& env,
                               const AeroTuning& tune) {
  AeroForces a;
  const double alt = s.altitudeM(env.bodyRadiusM);
  a.densityKgM3 = atmo::density(env.air, alt);
  if (a.densityKgM3 <= 0.0) return a;

  const Vec3 vAir = s.velMS - airVelocity(env, s.posM);
  a.airspeedMS = vAir.length();
  if (a.airspeedMS < 1e-6) return a;
  a.dynamicPressurePa = atmo::dynamicPressure(a.densityKgM3, a.airspeedMS);

  const Vec3 f = normalized(s.forward);
  const Vec3 vHat = vAir * (1.0 / a.airspeedMS);
  const double c = std::fmax(-1.0, std::fmin(1.0, f.dot(vHat)));
  a.angleOfAttackRad = std::acos(c);

  const Vec3 vAx = f * vAir.dot(f);
  const Vec3 vN = vAir - vAx;

  const double k = 0.5 * a.densityKgM3 * a.airspeedMS;
  a.forceN = (vAx * mp.axialCdA + vN * mp.normalCdA) * (-k);

  // --- pitching moment, with the DW-30 concession -------------------------
  const Vec3 arm = mp.copM - mp.comM;  // body frame, but the stack is the axis
  // Express the arm in the world frame: the CoP/CoM offset is along the vessel
  // axis (plus any lateral offset from asymmetric radial parts), so rebuild it
  // from the body axes rather than assuming it is purely axial.
  const Vec3 up3 = cross(f, s.right);   // the vessel's +Z in world
  const Vec3 armW = s.right * arm.x + f * arm.y + up3 * arm.z;
  a.staticMarginM = arm.y;

  // The moment-producing normal force uses the normal-force slope, NOT the
  // broadside drag area. Same shape of expression, different coefficient.
  const Vec3 normalForceForMoment = vN * (-k * mp.normalForceSlope);
  Vec3 tau = cross(armW, normalForceForMoment);

  // Split into roll (about the nose axis) and pitch/yaw. Only pitch/yaw is a
  // flip; roll about the axis of symmetry is harmless and is left alone.
  const Vec3 tauRoll = f * tau.dot(f);
  Vec3 tauPitchYaw = tau - tauRoll;
  if (a.staticMarginM > 0.0) {
    tauPitchYaw = tauPitchYaw * tune.unstableAeroGain;
    a.flipDampingActive = true;
  }
  tau = tauRoll + tauPitchYaw;

  // --- rate damping -------------------------------------------------------
  const double L = std::fmax(1.0, v.lengthM());
  const Vec3 wRoll = f * s.angVelRadS.dot(f);
  const Vec3 wPerp = s.angVelRadS - wRoll;
  const double base = 0.5 * a.densityKgM3 * a.airspeedMS * mp.normalCdA * L * L;
  tau = tau - wPerp * (tune.pitchDampK * base) - wRoll * (tune.rollDampK * base);

  a.torqueNm = tau;
  return a;
}

// =============================================================================
// §5 - control authority and stability assist (DW-30 item 2).
//
// Stability assist is a CONTROLLER that spends the vessel's own torque, not a
// free hand on the tiller. Its authority is the sum of three sources, every one
// of which comes from a part that is actually bolted on:
//   * reaction wheels and the pod's own torque: free, but modest;
//   * RCS blocks: strong, but they burn monopropellant and they are useless
//     with the tanks dry;
//   * engine gimbal: by far the largest, and available ONLY while thrusting,
//     which is why an unpowered coast through the atmosphere feels different.
// A vessel with none of the three cannot hold attitude, and the test asserts
// exactly that, because "stability assist is on by default" must not quietly
// mean "attitude is free".
// =============================================================================

// PH-39: the four orbital modes are APPENDED, so 0..4 keep the values the
// bridge, FlightAbi.ts and every existing probe already speak. They point at
// orbital::basisAt's triad and at nothing they derive themselves.
//
// There is deliberately no `Node` mode. A node's burn direction is FIXED in
// inertial space once the node is placed (the impulse is planned at one point
// on the conic), so holding it is exactly what `Command` already does, and
// adding a fifth way to say "point there" would put a maneuver concept inside
// the attitude controller. The caller sets Command and feeds it Plan::
// burnDirection - which is also what makes hold-node cost nothing to build.
enum class SasMode : uint8_t {
  Off = 0,
  Hold,        // hold the attitude captured when the mode was set
  Prograde,    // along the velocity vector
  Retrograde,
  Command,     // hold a caller-supplied direction (what a guidance ribbon does)
  Normal,      // 5: along r x v, the orbit pole
  Antinormal,  // 6
  RadialIn,    // 7: toward the body, perpendicular to velocity
  RadialOut,   // 8: away from it
};

struct ControlAuthority {
  double reactionNm = 0.0;
  double rcsNm = 0.0;
  double gimbalNm = 0.0;
  double totalNm() const { return reactionNm + rcsNm + gimbalNm; }
};

inline ControlAuthority controlAuthority(const vessel::Vessel& v,
                                         const vessel::MassProperties& mp,
                                         double throttle, double pressureRatio) {
  ControlAuthority ca;
  const double monoprop =
      vessel::propellantAboardKg(v, vessel::Propellant::Monopropellant);
  for (const auto& p : v.parts) {
    const vessel::PartDef& d = v.def(p);
    ca.reactionNm += d.reactionTorqueNm;

    if (d.rcsThrustN > 0.0 && monoprop > 0.0) {
      // Torque arm is the distance from the CoM along the stack axis: a block
      // sitting level with the centre of mass gives no pitch authority at all,
      // which is a real and teachable placement decision.
      const double arm = std::fabs(p.centroidM.y - mp.comM.y);
      ca.rcsNm += d.rcsThrustN * arm;
    }
  }
  if (throttle > 0.0) {
    for (vessel::PartHandle h : vessel::activeEngines(v)) {
      const vessel::PartInstance* e = v.find(h);
      if (!e) continue;
      const vessel::PartDef& d = v.def(*e);
      if (d.gimbalRangeRad <= 0.0) continue;
      if (feedGroup(v, *e).empty()) continue;
      const double T =
          atmo::lapse(d.thrustSeaLevelN, d.thrustVacuumN, pressureRatio) * throttle;
      const double arm = std::fabs(e->centroidM.y - mp.comM.y);
      ca.gimbalNm += T * std::sin(d.gimbalRangeRad) * arm;
    }
  }
  return ca;
}

// TOTAL TRANSLATIONAL RCS THRUST, and the one simplification in it is stated
// rather than buried: the block's rated thrust is treated as available in ANY
// direction. A real cluster has nozzle groups and cannot push equally every
// way, but `PartDef` carries one scalar and no nozzle geometry, so modelling
// the asymmetry would mean inventing the placements. Inventing them would make
// a docking approach depend on numbers nobody authored.
//
// Torque and translation are billed from the SAME TANK and are not otherwise
// coupled: SAS can be damping a spin while the approach translates, and both
// draw monopropellant until it runs out, at which point both stop.
inline double rcsTranslationThrustN(const vessel::Vessel& v) {
  if (vessel::propellantAboardKg(v, vessel::Propellant::Monopropellant) <= 0.0)
    return 0.0;
  double n = 0.0;
  for (const auto& p : v.parts) n += v.def(p).rcsThrustN;
  return n;
}

struct SasTuning {
  double kp = 2.5;   // proportional gain on the attitude error, per second^2
  double kd = 3.0;   // rate gain, per second
  double deadbandRad = 0.002;
};

struct SasOutput {
  Vec3 torqueNm{0, 0, 0};
  double errorRad = 0.0;
  double demandedNm = 0.0;
  double appliedNm = 0.0;
  bool saturated = false;
  double monopropUsedKg = 0.0;
};

// The commanded direction for a mode. `hold` is the captured attitude and is
// only read in SasMode::Hold; `command` only in SasMode::Command.
inline Vec3 sasTarget(SasMode mode, const FlightState& s, const Vec3& hold,
                      const Vec3& command) {
  switch (mode) {
    case SasMode::Hold: return normalized(hold);
    case SasMode::Prograde: {
      const double sp = s.velMS.length();
      return (sp > 1e-6) ? s.velMS * (1.0 / sp) : normalized(s.forward);
    }
    case SasMode::Retrograde: {
      const double sp = s.velMS.length();
      return (sp > 1e-6) ? s.velMS * (-1.0 / sp) : normalized(s.forward);
    }
    case SasMode::Command: return normalized(command);
    case SasMode::Normal:
      return orbital::basisAt({s.posM, s.velMS}).normal;
    case SasMode::Antinormal:
      return orbital::basisAt({s.posM, s.velMS}).normal * -1.0;
    case SasMode::RadialOut:
      return orbital::basisAt({s.posM, s.velMS}).radialOut;
    case SasMode::RadialIn:
      return orbital::basisAt({s.posM, s.velMS}).radialOut * -1.0;
    case SasMode::Off:
    default: return normalized(s.forward);
  }
}

// A PD controller on the attitude error, clamped to the authority the vessel
// actually has and paid for out of monopropellant when RCS is part of the sum.
inline SasOutput stabilityAssist(vessel::Vessel& v, const vessel::MassProperties& mp,
                                 const FlightState& s, SasMode mode,
                                 const Vec3& hold, const Vec3& command,
                                 const ControlAuthority& ca, const SasTuning& tune,
                                 double dt) {
  SasOutput out;
  if (mode == SasMode::Off) return out;

  const Vec3 f = normalized(s.forward);
  const Vec3 t = sasTarget(mode, s, hold, command);

  // Rotation axis and angle that would take `f` onto `t`.
  Vec3 axis = cross(f, t);
  const double sinA = axis.length();
  const double cosA = std::fmax(-1.0, std::fmin(1.0, f.dot(t)));
  out.errorRad = std::atan2(sinA, cosA);
  if (sinA > 1e-12) {
    axis = axis * (1.0 / sinA);
  } else if (cosA < 0.0) {
    // EXACTLY ANTIPARALLEL, AND THIS USED TO STALL THE VEHICLE FOR EVER
    // (PH-151). The cross product of two opposed unit vectors is zero, so the
    // demanded torque was zero, so a vessel commanded to flip exactly 180
    // degrees sat in an unstable equilibrium and never turned. `errorRad` was
    // correctly reported as pi the whole time, which is the part that makes it
    // nasty: the controller knew, said so, and did nothing.
    //
    // MEASURED, and it is not a corner case for an autopilot: circularising at
    // apoapsis points exactly retrograde relative to the burn that raised the
    // orbit, BY CONSTRUCTION, so the second burn of every hold-orbit program
    // hits it. The vehicle held 180.000 degrees for 600 s of sim and the burn
    // never happened. A player only ever hits it by being perfectly prograde
    // and pressing retrograde, which is rare; a geometric plan hits it always.
    //
    // At exactly pi every axis perpendicular to `f` is an equally valid
    // rotation axis, so one is CHOSEN rather than found: cross `f` with
    // whichever cardinal axis it is least aligned with, which is guaranteed
    // non-degenerate and depends on `f` alone, so it stays bit-deterministic.
    const double ax = std::fabs(f.x), ay = std::fabs(f.y), az = std::fabs(f.z);
    const Vec3 pick = (ax <= ay && ax <= az) ? Vec3{1, 0, 0}
                      : (ay <= az)           ? Vec3{0, 1, 0}
                                             : Vec3{0, 0, 1};
    axis = normalized(cross(f, pick));
  } else {
    // Parallel: already pointed. `errorRad` is ~0, so the deadband below stops
    // the proportional term and only the rate term runs, which is what damps a
    // residual spin.
    axis = Vec3{0, 0, 0};
  }

  // EACH CHANNEL IS PAID FOR WITH THE INERTIA THE INTEGRATOR WILL DIVIDE IT BY,
  // AND GETTING THAT WRONG MADE SAS A ROLL OSCILLATOR AT THE CLIENT'S OWN TICK
  // (PH-165).
  //
  // This is a torque, and §6 below splits it into a roll component divided by
  // Iyy and a perpendicular component divided by max(Ixx, Izz). It used to be
  // built with the TRANSVERSE inertia throughout, so the roll channel's closed
  // loop was not `omega' = -kd omega` but `omega' = -kd (Itrans/Iroll) omega`,
  // and an explicit step of that diverges once `kd (Itrans/Iroll) dt > 2`.
  //
  // MEASURED, and the prediction and the measurement agree to the third
  // decimal. A rocket is long and thin, so Itrans/Iroll is large by
  // construction: the shipped reference Ascender is 46.26 with its fins on and
  // 83.71 with the booster nearly dry. At the browser's fixed tick of 1/60 s
  // that makes the threshold ratio 40.0, and one step then turns a roll rate
  // of +1e-3 rad/s into -1.3132e-3, which is larger than the input and points
  // the other way.
  //
  // THIS IS NOT A CORNER CASE AND IT NEEDED NO SEED. Ninety seconds of an
  // ORDINARY ASCENT, the shipped rocket, throttle open, a fifteen degree
  // pitch-over, nothing injected anywhere:
  //     dt 0.002    peak roll 9.9e-17 deg/s
  //     dt 1/60     peak roll 41.98   deg/s
  // The four fins' aerodynamic forces do not cancel to the last bit, and the
  // unstable mode takes that to 42 degrees per second.
  //
  // WHY NOTHING CAUGHT IT, and it took three tries to find because each layer
  // hid it from the next. Roll does not move the thrust axis, so the ascent
  // acceptance (apoapsis, periapsis, staging time, max q, angle of attack,
  // pointing error) is blind to it by construction, and so is
  // `the_ascent_does_not_depend_on_the_step_size`, which flies 0.02 and 0.01,
  // one either side of the 0.0144 s threshold. The CLIENT then hid the
  // symptom: `FlightSas.levelWings` rewrites `right` every tick to keep the
  // navball level, so the craft LOOKS level while `angVelRadS` keeps its roll.
  // Its own comment records the evidence and misattributes it, in these words:
  // "a vessel that picks up half a degree per second on the way up arrives in
  // orbit lying on its side ... Measured on the first orbit captured: ROL -93
  // degrees with no roll input given at any point." That was this bug.
  //
  // And what finally reported it was the autopilot, whose ignition gate reads
  // the WHOLE angular velocity: a vehicle perfectly aimed, apparently level,
  // and turning at 42 deg/s can never satisfy a 0.5 deg/s gate, so the burn
  // never happens and the program holds for ever (R71).
  //
  // The P term needs no split: `axis` is a normalized cross product with `f`,
  // so it is perpendicular to `f` by construction and is purely transverse.
  const double Itrans = std::fmax(1.0, std::fmax(mp.IxxKgM2, mp.IzzKgM2));
  const double Iroll = std::fmax(1.0, mp.IyyKgM2);
  Vec3 demand{0, 0, 0};
  if (out.errorRad > tune.deadbandRad)
    demand = axis * (tune.kp * out.errorRad * Itrans);
  // Rate term opposes the whole angular velocity, including roll, so SAS also
  // stops a spin rather than only pointing the nose. Both channels now decay at
  // `kd` per second, which is what `kd` has always claimed to be.
  const Vec3 wRoll = f * s.angVelRadS.dot(f);
  const Vec3 wPerp = s.angVelRadS - wRoll;
  demand = demand - (wPerp * (tune.kd * Itrans) + wRoll * (tune.kd * Iroll));

  out.demandedNm = demand.length();
  const double limit = ca.totalNm();
  if (out.demandedNm <= 1e-9 || limit <= 0.0) {
    out.saturated = (limit <= 0.0 && out.demandedNm > 1e-9);
    return out;
  }
  double scale = 1.0;
  if (out.demandedNm > limit) { scale = limit / out.demandedNm; out.saturated = true; }
  out.torqueNm = demand * scale;
  out.appliedNm = out.demandedNm * scale;

  // Pay for the RCS share. Reaction wheels are free (they are paid for in
  // electricity, which is not modelled yet); the gimbal is free because the
  // engine is already burning. Only the RCS fraction costs propellant.
  if (ca.rcsNm > 0.0 && limit > 0.0) {
    const double rcsShare = out.appliedNm * (ca.rcsNm / limit);
    // Convert torque back to thrust through the average arm, then to mass flow.
    double arm = 0.0, isp = 0.0, n = 0.0;
    for (const auto& p : v.parts) {
      const vessel::PartDef& d = v.def(p);
      if (d.rcsThrustN <= 0.0) continue;
      arm += std::fabs(p.centroidM.y - mp.comM.y);
      isp += d.rcsIspS;
      n += 1.0;
    }
    if (n > 0.0 && arm > 0.0 && isp > 0.0) {
      arm /= n; isp /= n;
      const double thrustUsed = rcsShare / arm;
      const double kg = thrustUsed / (isp * atmo::kG0) * dt;
      double left = kg;
      for (auto& p : v.parts) {
        if (v.def(p).propellant != vessel::Propellant::Monopropellant) continue;
        const double take = std::min(left, p.propellantKg);
        p.propellantKg -= take;
        left -= take;
        if (left <= 0.0) break;
      }
      out.monopropUsedKg = kg - left;
    }
  }
  return out;
}

// =============================================================================
// §6 - the integrator, and the handoff to of::orbital.
// =============================================================================

// Rodrigues rotation of `v` about unit axis `k` by angle `ang`.
inline Vec3 rotateAbout(const Vec3& v, const Vec3& k, double ang) {
  const double c = std::cos(ang), s = std::sin(ang);
  return v * c + cross(k, v) * s + k * (k.dot(v) * (1.0 - c));
}

struct FlightTelemetry {
  /** Translational RCS actually delivered this tick, newtons. 0 when the
   *  command is zero OR when the monopropellant has run out, and those are
   *  different situations that a screen has to be able to tell apart, so an
   *  approach program reads this rather than assuming its command landed. */
  double rcsThrustN = 0.0;
  double altitudeM = 0.0;
  double speedMS = 0.0;
  double machlessQPa = 0.0;
  double densityKgM3 = 0.0;
  double massKg = 0.0;
  double thrustN = 0.0;
  double accelMS2 = 0.0;
  double angleOfAttackRad = 0.0;
  double staticMarginM = 0.0;
  double sasErrorRad = 0.0;
  bool sasSaturated = false;
  bool inSpace = false;
};

class FlightSim {
 public:
  vessel::Vessel craft;
  FlightState state;
  FlightEnvironment env;
  AeroTuning aero;
  SasTuning sasTune;
  SasMode sas = SasMode::Hold;   // DW-30 item 2: ON by default, from flight one
  Vec3 sasHold{0, 1, 0};
  Vec3 sasCommand{0, 1, 0};
  FlightTelemetry telemetry;

  // TRANSLATIONAL RCS (PH-173). An INERTIAL direction whose magnitude is the
  // throttle, 0 to 1, of the vehicle's total RCS thrust. Zero means off, which
  // is the default and is what every existing flight does.
  //
  // WHY THIS HAD TO EXIST BEFORE A DOCKING APPROACH COULD. A rocket accelerates
  // along its nose. A docking approach has to hold the PORT pointed at the
  // other port while closing, and those two directions are only the same if you
  // approach exactly along your own thrust axis and never need to correct
  // sideways. Correcting sideways is the entire job of an approach, so without
  // translation a vehicle can point OR move, and a program that pointed the
  // nose wherever it needed to push would arrive with its port facing the wrong
  // way and fail the capture cone.
  //
  // `rcsThrustN` has been authored on the RCS block (1000 N, Isp 240 s) since
  // the catalogue was written and was consumed for TORQUE ONLY, which is R15's
  // shape again: a part doing half of what its own data says.
  Vec3 rcsTranslate{0, 0, 0};

  // Set the hold attitude to whatever the vessel is doing now.
  void captureHold() { sasHold = normalized(state.forward); }

  // Gravity, and only gravity: exactly of::orbital::gravAccel, called through
  // so there is one implementation and it is the tested one.
  Vec3 gravity(const Vec3& r) const { return orbital::gravAccel(r, env.muM3S2); }

  vessel::MassProperties massProps() {
    craft.layout();
    return vessel::massProperties(craft);
  }

  // One fixed step. dt is the sim tick; 0.02 s is what the ascent test uses.
  void step(double dt) {
    craft.layout();
    const vessel::MassProperties mp = vessel::massProperties(craft);
    const double alt = state.altitudeM(env.bodyRadiusM);
    const double pr = atmo::pressureRatio(env.air, alt);

    // --- propulsion: evaluate, then consume ------------------------------
    const PropulsionOutput prop = evaluatePropulsion(craft, state.throttle, pr);
    if (prop.massFlowKgS > 0.0) burn(prop.massFlowKgS * dt, pr);

    const double massKg = std::fmax(1.0, mp.totalKg);
    const Vec3 f = normalized(state.forward);
    const Vec3 thrustAccel = f * (prop.thrustN / massKg);

    // --- translational RCS: evaluate, then consume, exactly as above -------
    Vec3 rcsAccel{0, 0, 0};
    telemetry.rcsThrustN = 0.0;
    {
      const double want = rcsTranslate.length();
      const double avail = rcsTranslationThrustN(craft);
      if (want > 1e-9 && avail > 0.0) {
        const double th = std::fmin(1.0, want);
        const double T = avail * th;
        rcsAccel = rcsTranslate * (T / (want * massKg));
        telemetry.rcsThrustN = T;
        // Monopropellant, through the same Isp the torque path uses. Averaged
        // over the blocks that have one, for the same reason `stabilityAssist`
        // averages: there is one tank and no per-nozzle bookkeeping.
        double isp = 0.0, k = 0.0;
        for (const auto& p : craft.parts) {
          const vessel::PartDef& d = craft.def(p);
          if (d.rcsThrustN <= 0.0 || d.rcsIspS <= 0.0) continue;
          isp += d.rcsIspS; k += 1.0;
        }
        if (k > 0.0 && isp > 0.0) {
          double left = T / ((isp / k) * atmo::kG0) * dt;
          for (auto& p : craft.parts) {
            if (craft.def(p).propellant != vessel::Propellant::Monopropellant)
              continue;
            const double take = std::fmin(left, p.propellantKg);
            p.propellantKg -= take;
            left -= take;
            if (left <= 0.0) break;
          }
        }
      }
    }

    // --- aerodynamics ----------------------------------------------------
    const AeroForces af = aerodynamics(craft, mp, state, env, aero);
    const Vec3 dragAccel = af.forceN * (1.0 / massKg);

    // --- attitude control -------------------------------------------------
    const ControlAuthority ca = controlAuthority(craft, mp, state.throttle, pr);
    const SasOutput so = stabilityAssist(craft, mp, state, sas, sasHold,
                                         sasCommand, ca, sasTune, dt);

    // --- rotational integration ------------------------------------------
    // Inertia is treated as a diagonal about the stack axis: one transverse
    // value for pitch and yaw, one for roll. The gyroscopic term omega x (I
    // omega) is dropped, which is exact for a body with Ixx == Izz and small
    // for a rocket with any roll rate a player will ever fly.
    {
      const Vec3 tau = af.torqueNm + so.torqueNm;
      const double Itrans = std::fmax(1.0, std::fmax(mp.IxxKgM2, mp.IzzKgM2));
      const double Iroll = std::fmax(1.0, mp.IyyKgM2);
      const Vec3 tRoll = f * tau.dot(f);
      const Vec3 tPerp = tau - tRoll;
      state.angVelRadS = state.angVelRadS + tPerp * (dt / Itrans) + tRoll * (dt / Iroll);

      const double w = state.angVelRadS.length();
      if (w > 1e-12) {
        const Vec3 k = state.angVelRadS * (1.0 / w);
        state.forward = rotateAbout(state.forward, k, w * dt);
        state.right = rotateAbout(state.right, k, w * dt);
        orthonormalize();
      }
    }

    // --- translational integration ---------------------------------------
    // Velocity-Verlet. Written in exactly the term order of
    // of::orbital::Integrator::step so that when thrust and drag are both zero
    // this is BIT-IDENTICAL to it (asserted in test_flight.cpp), which is what
    // makes the handoff at the atmosphere ceiling free of a seam.
    {
      const Vec3 a0 = gravity(state.posM) + thrustAccel + dragAccel + rcsAccel;
      state.posM = state.posM + state.velMS * dt + a0 * (0.5 * dt * dt);
      const Vec3 a1 = gravity(state.posM) + thrustAccel + dragAccel + rcsAccel;
      state.velMS = state.velMS + (a0 + a1) * (0.5 * dt);
      telemetry.accelMS2 = a0.length();
    }

    state.timeS += dt;

    telemetry.altitudeM = state.altitudeM(env.bodyRadiusM);
    telemetry.speedMS = state.velMS.length();
    telemetry.machlessQPa = af.dynamicPressurePa;
    telemetry.densityKgM3 = af.densityKgM3;
    telemetry.massKg = mp.totalKg;
    telemetry.thrustN = prop.thrustN;
    telemetry.angleOfAttackRad = af.angleOfAttackRad;
    telemetry.staticMarginM = af.staticMarginM;
    telemetry.sasErrorRad = so.errorRad;
    telemetry.sasSaturated = so.saturated;
    telemetry.inSpace = atmo::inSpace(env.air, telemetry.altitudeM);
  }

  // Fire the next stage. Returns the jettisoned subtree(s); the caller decides
  // whether to keep simulating them as debris.
  vessel::StageResult stage() {
    vessel::StageResult r = vessel::fireStage(craft);
    craft.layout();
    return r;
  }

  // --- the of::orbital boundary ------------------------------------------

  orbital::StateVector orbitalState() const {
    return orbital::StateVector{state.posM, state.velMS};
  }

  // TRUE when nothing this file models is acting: no air, no thrust. At that
  // moment the trajectory is a conic and of::orbital owns it.
  //
  // It re-evaluates propulsion rather than reading the telemetry, because the
  // telemetry is one step stale and a caller is entitled to ask this question
  // before the first step of a session or immediately after cutting the engine.
  bool onRailsEligible() const {
    const double alt = state.posM.length() - env.bodyRadiusM;
    if (!atmo::inSpace(env.air, alt)) return false;
    return evaluatePropulsion(craft, state.throttle, 0.0).thrustN <= 0.0;
  }

  orbital::Elements park() const {
    return orbital::park(orbitalState(), env.muM3S2, state.timeS);
  }
  void resume(const orbital::Elements& el, double simTimeS) {
    const orbital::StateVector sv = orbital::resume(el, simTimeS);
    state.posM = sv.r;
    state.velMS = sv.v;
    state.timeS = simTimeS;
  }

 private:
  void orthonormalize() {
    state.forward = normalized(state.forward);
    state.right = state.right - state.forward * state.forward.dot(state.right);
    state.right = normalized(state.right);
  }

  void burn(double wantKg, double pressureRatio) {
    // Split the demand between the live engines in proportion to their own mass
    // flow, then draw each engine's share from its own feed group.
    std::vector<vessel::PartHandle> live;
    std::vector<double> share;
    double total = 0.0;
    for (vessel::PartHandle h : vessel::activeEngines(craft)) {
      const vessel::PartInstance* e = craft.find(h);
      if (!e) continue;
      const vessel::PartDef& d = craft.def(*e);
      if (!d.isEngine() || feedGroup(craft, *e).empty()) continue;
      const double th = d.throttleable
                            ? std::max(d.minThrottle, std::min(1.0, state.throttle))
                            : d.minThrottle;
      if (th <= 0.0) continue;
      const double T =
          atmo::lapse(d.thrustSeaLevelN, d.thrustVacuumN, pressureRatio) * th;
      const double isp = atmo::lapse(d.ispSeaLevelS, d.ispVacuumS, pressureRatio);
      if (T <= 0.0 || isp <= 0.0) continue;
      const double mdot = T / (isp * atmo::kG0);
      live.push_back(h);
      share.push_back(mdot);
      total += mdot;
    }
    if (total <= 0.0) return;
    for (size_t i = 0; i < live.size(); ++i) {
      const vessel::PartInstance* e = craft.find(live[i]);
      if (!e) continue;
      const std::vector<vessel::PartHandle> g = feedGroup(craft, *e);
      drawPropellant(craft, g, wantKg * (share[i] / total));
    }
  }
};

// --- Orbit readouts, so the HUD and the tests read the same numbers. --------
struct OrbitSummary {
  double apoapsisAltM = 0.0;
  double periapsisAltM = 0.0;
  double semiMajorAxisM = 0.0;
  double eccentricity = 0.0;
  double periodS = 0.0;
  bool bound = false;
};

inline OrbitSummary summarize(const orbital::StateVector& sv, double mu,
                              double bodyRadiusM) {
  OrbitSummary o;
  const orbital::Elements el = orbital::stateToElements(sv, mu, 0.0);
  o.semiMajorAxisM = el.a;
  o.eccentricity = el.e;
  o.bound = (el.e < 1.0 && el.a > 0.0);
  if (o.bound) {
    o.apoapsisAltM = el.a * (1.0 + el.e) - bodyRadiusM;
    o.periapsisAltM = el.a * (1.0 - el.e) - bodyRadiusM;
    o.periodS = orbital::orbitalPeriod(el.a, mu);
  } else {
    o.periapsisAltM = el.a * (1.0 - el.e) - bodyRadiusM;
    o.apoapsisAltM = 1e308;
  }
  return o;
}

// =============================================================================
// §7 - the gravity-turn guidance ribbon (DW-30 item 6).
//
// This publishes the pitch profile a good ATMOSPHERIC ascent follows. It does
// not fly it itself: the whole point of DW-29's progression is that reaching
// orbit is a manual skill first, so this is what the navball draws and the
// player is what tracks it.
//
// TWO THINGS HAVE CHANGED SINCE THAT WAS WRITTEN AND BOTH MATTER.
//
// (1) PH-201 shipped a SAS mode that follows the ribbon, so "the player is what
// tracks it" now includes a key. A ribbon that is drawn and never flown can be
// approximately right; one with a key on it is an instruction.
//
// (2) THIS PROGRAM IS FOR A BODY WITH AIR AND IS NOT A GENERAL ASCENT. It
// pitches on ALTITUDE because the atmosphere is the thing being raced, and that
// is the wrong variable where there is no air: on Cinder it is still 33 degrees
// from horizontal at 20 km, which is that moon's entire parking orbit. The
// airless schedule is `ascent.h`'s, and `ascent::ribbon` is the ONE place that
// chooses between them. Nothing should construct this directly to draw a ribbon
// on an arbitrary body; go through `ascent::ribbon` (R87).
// =============================================================================
struct GravityTurnProgram {
  double verticalUntilM = 500.0;   // straight up off the pad
  double turnCompleteM = 45000.0;  // horizontal by here
  double exponent = 0.55;          // shape of the turn

  // THE SAME PROGRAM, WITH ITS ONE BODY-SHAPED CONSTANT READ OFF THE BODY.
  //
  // `turnCompleteM = 45000` is not a free parameter and never was: it is three
  // quarters of the way up Forge's air, and the reason the turn finishes there
  // is that above it there is nothing left to be through. Stated as a fraction
  // of `AtmosphereProfile::topM` it is EXACTLY the shipped number on Forge
  // (0.75 * 60000 == 45000, pinned with `==` in test_ascent.cpp), so this
  // introduces no new value: it explains the existing one and lets a second
  // atmospheric body get a correct schedule without anybody tuning a literal.
  //
  // `verticalUntilM` is NOT derived, because it is not about air. It is pad
  // clearance, and it is deliberately the same 500 m that
  // `ascent::Profile::clearanceM` holds: one clearance number appearing in two
  // programs rather than two numbers that happen to agree.
  //
  // An airless profile has `topM == 0`, which would collapse the turn to a
  // step at the pad. It is REFUSED rather than clamped: `ascent::ribbon` picks
  // the apoapsis-progress schedule for an airless body and never calls this,
  // and a caller that reaches here with no air has asked the wrong question.
  static GravityTurnProgram forAtmosphere(const atmo::AtmosphereProfile& air) {
    GravityTurnProgram g;
    if (air.present()) g.turnCompleteM = 0.75 * air.topM;
    return g;
  }

  // Angle from local vertical, radians: 0 straight up, pi/2 horizontal.
  double pitchFromVerticalRad(double altitudeM) const {
    if (altitudeM <= verticalUntilM) return 0.0;
    if (altitudeM >= turnCompleteM) return 0.5 * orbital::kPi;
    const double t = (altitudeM - verticalUntilM) / (turnCompleteM - verticalUntilM);
    return 0.5 * orbital::kPi * std::pow(t, exponent);
  }

  // The commanded nose direction at a position, given a downrange heading.
  // `up` is the local vertical (radial) and `east` is the horizontal direction
  // the ascent is flying towards; both must be unit and perpendicular.
  Vec3 commandedForward(double altitudeM, const Vec3& up, const Vec3& east) const {
    const double p = pitchFromVerticalRad(altitudeM);
    return normalized(up * std::cos(p) + east * std::sin(p));
  }
};

// Pull a commanded direction back towards the airflow so it never asks for more
// than `maxAoARad` of angle of attack.
//
// This is what a real ascent does and what a pilot does by feel: the ribbon
// says where the profile wants the nose, and you do not chase it into the air
// at 20 degrees off prograde, because the drag penalty is quadratic in the
// normal component and the moment is what used to flip you. Left unclamped, the
// reference ascent asked for 19.45 degrees of angle of attack at 40 km; clamped
// to 5, the same profile and the same vehicle reach a rounder orbit with more
// propellant left, and the difference is entirely in what was thrown away
// sideways.
//
// It is NOT part of the flight model, it is part of GUIDANCE, which is why it
// is a free function the caller may ignore rather than something the integrator
// applies behind the player's back. Flying badly is still allowed.
//
// WHEN to apply it is the caller's decision, and it matters: applying it from
// the pad is a trap. Off the pad the velocity IS vertical, so a clamp measured
// against the velocity forbids the pitch-over that starts a gravity turn, the
// velocity therefore stays vertical, and the clamp forbids it again. The
// reference ascent flown that way went straight up, hit 79.7 kPa of dynamic
// pressure at 22 km, and fell back. Gate it on dynamic pressure instead: below
// a few kPa the air cannot hurt you whatever angle you fly at, and that window
// is exactly where the turn has to be started.
inline Vec3 clampToMaxAoA(const Vec3& command, const Vec3& velocityMS,
                          double maxAoARad) {
  const double sp = velocityMS.length();
  if (sp < 1.0 || maxAoARad <= 0.0) return normalized(command);
  const Vec3 vHat = velocityMS * (1.0 / sp);
  const Vec3 c = normalized(command);
  const double cosA = std::fmax(-1.0, std::fmin(1.0, c.dot(vHat)));
  const double ang = std::acos(cosA);
  if (ang <= maxAoARad) return c;
  Vec3 axis = cross(vHat, c);
  const double s = axis.length();
  if (s < 1e-12) return c;
  axis = axis * (1.0 / s);
  return normalized(rotateAbout(vHat, axis, maxAoARad));
}

}  // namespace flight
}  // namespace of
