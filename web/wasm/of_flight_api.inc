// =============================================================================
// of_flight_api.inc: §13 of the bridge: the ATMOSPHERE and the FLIGHT SIM.
//
// Included from of_core_api.cpp, after of_staging_api.inc.
//
// THE ASSEMBLY VIEW DOES NOT USE THIS. It is here because standing rule 9 makes
// an ABI bump atomic and therefore expensive, and every call below is a
// mechanical pass-through of a `flight.h` field whose shape that header already
// fixed. Landing it with the vessel surface costs one file and saves the flight
// lane a second bump; leaving it out would have cost a bump to add
// `of_fl_set_throttle`. Nothing here invents a control scheme: what a navball
// reads and what a throttle key does is the flight lane's design, and the
// arguments below are `FlightState` and `SasMode` verbatim.
//
// The one non-obvious thing: `FlightSim` OWNS its craft (`flight.h` line 520),
// so of_fl_create COPIES the design out of a vessel handle. Editing the design
// afterwards does not touch the vehicle in flight, which is correct - a rocket
// on the pad is not a blueprint - and means the assembly view and a live flight
// can coexist without either aliasing the other.
// =============================================================================
#include "of/atmosphere.h"
#include "of/flight.h"

namespace at = of::atmo;
namespace fl = of::flight;

namespace { Registry<fl::FlightSim> g_flights; }

// =============================================================================
// §13.1: atmosphere. Pure functions of (bodyId, altitude); `bodyId` is the
// BodyParams::bodyId (0 = Forge, anything else = airless, atmosphere.h §2).
// PH-10/PH-11: one exponential with a fade to EXACTLY zero over the top 10 km,
// so "am I on rails" is a boolean rather than a threshold.
// =============================================================================
OF_API double of_atmo_density(int bodyId, double altM) {
  return at::density(at::atmosphereForBody(static_cast<uint32_t>(bodyId)), altM);
}
OF_API double of_atmo_density_raw(int bodyId, double altM) {
  return at::densityRaw(at::atmosphereForBody(static_cast<uint32_t>(bodyId)), altM);
}
OF_API double of_atmo_pressure_ratio(int bodyId, double altM) {
  return at::pressureRatio(at::atmosphereForBody(static_cast<uint32_t>(bodyId)), altM);
}
OF_API double of_atmo_space_altitude(int bodyId) {
  return at::spaceAltitudeM(at::atmosphereForBody(static_cast<uint32_t>(bodyId)));
}
OF_API int of_atmo_in_space(int bodyId, double altM) {
  return at::inSpace(at::atmosphereForBody(static_cast<uint32_t>(bodyId)), altM) ? 1 : 0;
}
OF_API double of_atmo_dynamic_pressure(double densityKgM3, double airspeedMS) {
  return at::dynamicPressure(densityKgM3, airspeedMS);
}
// Interpolate a sea-level and a vacuum value by ambient pressure ratio. This is
// how thrust and Isp change with altitude, and it is the same call the core
// makes, so a HUD and the integrator cannot disagree.
OF_API double of_atmo_lapse(double seaLevelValue, double vacuumValue, double pRatio) {
  return at::lapse(seaLevelValue, vacuumValue, pRatio);
}
// The Isp reference constant. PH-18: this is a UNIT CONVERSION, not a gravity.
// Never use it as g; that is of_body_mu / of_gravity_accel.
OF_API double of_atmo_g0(void) { return at::kG0; }

// =============================================================================
// §13.2: the flight sim.
// =============================================================================

// Copy the design in vessel handle `v` onto a launch-ready flight sim bound to
// body handle `body` (mu and radius come from its BodyParams, DW-18; the air
// comes from its bodyId). -> a flight handle, or 0.
OF_API int of_fl_create(int v, int body) {
  vs::Vessel* p = g_vessels.get(v);
  const wg::BodyParams* b = g_bodies.get(body);
  if (!p || !b) return 0;
  fl::FlightSim* f = new fl::FlightSim();
  f->craft = *p;
  f->craft.layout();
  f->env.muM3S2 = b->muM3S2;
  f->env.bodyRadiusM = b->radiusM;
  f->env.air = at::atmosphereForBody(b->bodyId);
  f->state.posM = Vec3(0.0, b->radiusM, 0.0);
  f->state.velMS = Vec3(0.0, 0.0, 0.0);
  f->state.forward = Vec3(0.0, 1.0, 0.0);
  f->state.right = Vec3(1.0, 0.0, 0.0);
  f->captureHold();
  return g_flights.add(f);
}
OF_API void of_fl_destroy(int f) { g_flights.remove(f); }

OF_API int of_fl_set_pos_vel(int f, double px, double py, double pz,
                             double vx, double vy, double vz) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->state.posM = vec(px, py, pz);
  s->state.velMS = vec(vx, vy, vz);
  return 1;
}
// `forward` is the vessel +Y (the stack axis, toward the nose) and `right` is
// the vessel +X, both in the body-centred inertial frame. flight.h
// orthonormalizes, so a slightly non-perpendicular pair is accepted.
OF_API int of_fl_set_attitude(int f, double fx, double fy, double fz,
                              double rx, double ry, double rz) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->state.forward = vec(fx, fy, fz);
  s->state.right = vec(rx, ry, rz);
  return 1;
}
OF_API int of_fl_set_ang_vel(int f, double x, double y, double z) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->state.angVelRadS = vec(x, y, z);
  return 1;
}
OF_API int of_fl_set_throttle(int f, double t) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->state.throttle = t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
  return 1;
}
// 0 Off, 1 Hold, 2 Prograde, 3 Retrograde, 4 Command. DW-30 item 2 ships Hold.
OF_API int of_fl_set_sas(int f, int mode) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || mode < 0 || mode > 4) return 0;
  s->sas = static_cast<fl::SasMode>(mode);
  return 1;
}
OF_API int of_fl_set_sas_command(int f, double x, double y, double z) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->sasCommand = vec(x, y, z);
  return 1;
}
OF_API int of_fl_capture_hold(int f) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->captureHold();
  return 1;
}

OF_API int of_fl_step(int f, double dt) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || !(dt > 0.0)) return 0;
  s->step(dt);
  return 1;
}
// n fixed steps of dt. Returns the number taken; capped so a mistyped argument
// cannot wedge the browser.
OF_API int of_fl_step_n(int f, double dt, int n) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || !(dt > 0.0) || n <= 0) return 0;
  const int lim = n > 2000000 ? 2000000 : n;
  for (int i = 0; i < lim; ++i) s->step(dt);
  return lim;
}
// -> jettisoned mass in kg, or -1 if there was nothing left to fire.
OF_API double of_fl_stage(int f) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return -1.0;
  const vs::StageResult r = s->stage();
  return r.fired ? r.jettisonedMassKg : -1.0;
}
OF_API int of_fl_next_stage_index(int f) {
  fl::FlightSim* s = g_flights.get(f);
  return s ? s->craft.nextStageIndex : -1;
}
// TRUE when nothing flight.h models is acting: no air and no thrust, so the
// trajectory is a conic and of::orbital owns it (PH-16).
OF_API int of_fl_on_rails_eligible(int f) {
  fl::FlightSim* s = g_flights.get(f);
  return (s && s->onRailsEligible()) ? 1 : 0;
}

// f64 scratch, EXACTLY 17:
//   [posX,Y,Z, velX,Y,Z, fwdX,Y,Z, rightX,Y,Z, angVelX,Y,Z, timeS, throttle]
OF_API int of_fl_state(int f) {
  resetF64(17);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  const fl::FlightState& st = s->state;
  const double a[17] = {st.posM.x, st.posM.y, st.posM.z,
                        st.velMS.x, st.velMS.y, st.velMS.z,
                        st.forward.x, st.forward.y, st.forward.z,
                        st.right.x, st.right.y, st.right.z,
                        st.angVelRadS.x, st.angVelRadS.y, st.angVelRadS.z,
                        st.timeS, st.throttle};
  for (double x : a) g_f64.push_back(x);
  return 17;
}

// f64 scratch, EXACTLY 12:
//   [altitudeM, speedMS, dynamicPressurePa, densityKgM3, massKg, thrustN,
//    accelMS2, angleOfAttackRad, staticMarginM, sasErrorRad, sasSaturated,
//    inSpace]
OF_API int of_fl_telemetry(int f) {
  resetF64(12);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  const fl::FlightTelemetry& t = s->telemetry;
  const double a[12] = {t.altitudeM, t.speedMS, t.machlessQPa, t.densityKgM3,
                        t.massKg, t.thrustN, t.accelMS2, t.angleOfAttackRad,
                        t.staticMarginM, t.sasErrorRad,
                        t.sasSaturated ? 1.0 : 0.0, t.inSpace ? 1.0 : 0.0};
  for (double x : a) g_f64.push_back(x);
  return 12;
}

// f64 scratch, EXACTLY 6:
//   [apoapsisAltM, periapsisAltM, semiMajorAxisM, eccentricity, periodS, bound]
// An unbound trajectory reports apoapsis 1e308 and bound 0, which is flight.h's
// own convention, not a sentinel invented here.
OF_API int of_fl_orbit(int f) {
  resetF64(6);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  const fl::OrbitSummary o =
      fl::summarize(s->orbitalState(), s->env.muM3S2, s->env.bodyRadiusM);
  g_f64.push_back(o.apoapsisAltM);   g_f64.push_back(o.periapsisAltM);
  g_f64.push_back(o.semiMajorAxisM); g_f64.push_back(o.eccentricity);
  g_f64.push_back(o.periodS);        g_f64.push_back(o.bound ? 1.0 : 0.0);
  return 6;
}

// The delta-v still available from the CURRENT state, using the propellant
// actually left aboard. Deliberately a different number from the assembly
// view's total (vessel.h §7).
OF_API double of_fl_remaining_dv_vacuum(int f) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0.0;
  s->craft.layout();
  return vs::remainingDeltaVVacuumMS(s->craft);
}

// The live craft's tree, for the renderer: same layouts as of_vs_parts /
// of_vs_transforms, so one reader serves the assembly view and flight.
OF_API int of_fl_parts(int f) {
  fl::FlightSim* s = g_flights.get(f);
  resetI32(s ? s->craft.parts.size() * 5 : 0);
  if (!s) return 0;
  for (const auto& q : s->craft.parts) {
    g_i32.push_back(static_cast<int32_t>(q.handle));
    g_i32.push_back(static_cast<int32_t>(q.def));
    g_i32.push_back(q.parent == vs::kNoHandle ? -1 : static_cast<int32_t>(q.parent));
    g_i32.push_back(static_cast<int32_t>(q.attach));
    g_i32.push_back(static_cast<int32_t>(q.stage));
  }
  return static_cast<int>(s->craft.parts.size());
}

OF_API int of_fl_transforms(int f) {
  fl::FlightSim* s = g_flights.get(f);
  resetF64(s ? s->craft.parts.size() * 8 : 0);
  if (!s) return 0;
  s->craft.layout();
  for (const auto& q : s->craft.parts) {
    g_f64.push_back(q.originM.x);   g_f64.push_back(q.originM.y);
    g_f64.push_back(q.originM.z);   g_f64.push_back(q.centroidM.x);
    g_f64.push_back(q.centroidM.y); g_f64.push_back(q.centroidM.z);
    g_f64.push_back(q.radialAngleRad);
    g_f64.push_back(q.propellantKg);
  }
  return static_cast<int>(s->craft.parts.size());
}

// The gravity-turn guidance ribbon (DW-30 item 6): the pitch, in radians from
// vertical, a good ascent holds at this altitude. It does NOT fly anything.
// f64 scratch, EXACTLY 2: [pitchFromVerticalRad, headingIsPrograde].
OF_API int of_fl_guidance_pitch(double altitudeM) {
  resetF64(2);
  const fl::GravityTurnProgram g;
  g_f64.push_back(g.pitchFromVerticalRad(altitudeM));
  g_f64.push_back(altitudeM >= g.verticalUntilM ? 1.0 : 0.0);
  return 2;
}
