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
#include "of/ascent.h"      // R87: the ribbon's airless schedule, one source
#include "of/atmosphere.h"
#include "of/flight.h"
#include "of/landing.h"     // SurfaceFrame, the ground the ribbon is handed

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
// PH-251. WHERE THE GROUND IS, absolute radius, 0 to switch the rule off.
//
// `flight.h` has no contact model and had nothing that stopped a vehicle at
// all: a periapsis inside the body propagated straight through it, measured at
// 540,153.9 m below Forge's datum with every instrument reading healthy. This
// hands /core the one thing it cannot work out for itself.
//
// IT MUST BE THE SAME RADIUS THE CALLER'S OWN ARREST USES, or there are two
// authorities pinning a vehicle to two different heights. `FlightSession` pushes
// `surfaceRadius(up) + baseOffsetM`, which is character-for-character what its
// DOWN state snaps to, so this moves the existing rule one layer down rather
// than adding a second one. What that buys is WARP: `of_fl_step_n` takes up to
// n sub-steps per call and the client's arrest only runs after all n, so a
// descending vehicle went through the ground and was snapped back out of it.
//
// It is a REFUSAL and not contact: no gear, no friction, no tip-over, no impact
// tolerance. The velocity is deliberately kept, because it is what `landing.h`
// reads to say whether an arrival was a landing or a crash.
OF_API int of_fl_set_surface(int f, double radiusM) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->env.surfaceRadiusM = radiusM > 0.0 ? radiusM : 0.0;
  return 1;
}

// How the refusal is doing. f64 scratch, EXACTLY 3:
//   [0] groundRefusals   cumulative count of steps that ended pinned
//   [1] deepestRefusalM  how far under the surface the worst refused step
//                        WOULD have gone. THE instrument: 0.4 m of settling and
//                        9 km of tunnelling are both "refused" and are not the
//                        same event, and the second one is what this exists for
//   [2] onGround         1 if the step just taken was refused
OF_API int of_fl_ground(int f) {
  resetF64(3);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  g_f64.push_back(static_cast<double>(s->telemetry.groundRefusals));
  g_f64.push_back(s->telemetry.deepestRefusalM);
  g_f64.push_back(s->telemetry.onGround ? 1.0 : 0.0);
  return 3;
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
// ABI 11 appends 5 Normal, 6 Antinormal, 7 RadialIn, 8 RadialOut, which point
// at orbital::basisAt's triad - the SAME triad a maneuver node's handles are
// expressed in, because two derivations of "which way is normal" would show up
// as a node marker that is not quite where the SAS holding it points.
// There is no Node mode: a node's burn direction is fixed in inertial space,
// so Command(4) plus of_fl_set_sas_command IS hold-node.
OF_API int of_fl_set_sas(int f, int mode) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || mode < 0 || mode > 8) return 0;
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

// THE AUTOPILOT RIDES INSIDE THE STEP, and that is a deliberate choice rather
// than a convenience.
//
// An autopilot has to run once per fixed tick, BEFORE the integrator, on the
// same dt. Exposing it as a separate `of_ap_tick(f, dt)` would put a second
// call in the client's hot loop that it has to remember, in the right order,
// with the right dt, in BOTH `of_fl_step` and `of_fl_step_n`, and forgetting it
// under time warp is a silent failure: the vehicle coasts through its own burn
// and arrives somewhere else. Driving it from in here means ARMING is the only
// thing a client does, and a warped step flies the program exactly like a
// real-time one.
//
// Defined in of_ap_api.inc, which is included after this file, so it is
// forward-declared here. Same pattern as `of_gp_init` reaching the research
// layer at the foot of of_core_api.cpp.
void apDriveAutopilot(int f, fl::FlightSim& s, double dt);

OF_API int of_fl_step(int f, double dt) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || !(dt > 0.0)) return 0;
  apDriveAutopilot(f, *s, dt);
  s->step(dt);
  return 1;
}
// n fixed steps of dt. Returns the number taken; capped so a mistyped argument
// cannot wedge the browser.
OF_API int of_fl_step_n(int f, double dt, int n) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s || !(dt > 0.0) || n <= 0) return 0;
  const int lim = n > 2000000 ? 2000000 : n;
  for (int i = 0; i < lim; ++i) {
    apDriveAutopilot(f, *s, dt);
    s->step(dt);
  }
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
// WORD 17 IS THE SAS MODE, AND IT IS ONE WORD BECAUSE ONE WORD WAS ASKED FOR
// (PH-168).
//
// Nothing published /core's sas mode, so a client's SAS chip could only ever
// show the client's own mirror of what it last requested. `of_ap_cancel`
// leaves the vehicle in `SasMode::Command`, so after a cancel the chip and the
// vehicle disagreed and nothing could tell which was right. The gameplay lane
// refused to fix that by re-asserting their own mode, which would have changed
// what the vehicle DOES in order to correct what a chip SAYS, and that refusal
// is why this word exists.
//
// They were offered tank delta-v, arrival time and a reason code alongside it
// and turned all three down. A field nobody reads is how `ok` came to be
// published and ignored until it drew a refusal as a confident CANNOT REACH,
// so the row grows by exactly what has a reader.
//
// APPENDED, so words 0..16 mean what every shipped reader thinks. See
// `FlightAbi.ts`: its stride check is now a MINIMUM rather than an equality,
// because an exact-stride check turns an additive word into a silent total
// loss of position, velocity and attitude (R39's shape, on the row that
// carries the vehicle's state).
OF_API int of_fl_state(int f) {
  resetF64(18);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  const fl::FlightState& st = s->state;
  const double a[18] = {st.posM.x, st.posM.y, st.posM.z,
                        st.velMS.x, st.velMS.y, st.velMS.z,
                        st.forward.x, st.forward.y, st.forward.z,
                        st.right.x, st.right.y, st.right.z,
                        st.angVelRadS.x, st.angVelRadS.y, st.angVelRadS.z,
                        st.timeS, st.throttle,
                        static_cast<double>(s->sas)};
  for (double x : a) g_f64.push_back(x);
  return 18;
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

// ABI 22 / R44b: PER-STAGE PERFORMANCE OF THE CRAFT THAT IS ACTUALLY FLYING.
//
// `of_vs_stage_performance` takes a DESIGN handle, and `of_fl_create` above
// does `f->craft = *p`, so the design is a blueprint that never burns a gram.
// A navball table fed from it is frozen for the whole flight and no refresh
// cadence can help, because the object being read is the wrong object: after
// staging for real, with stage 0's engine and tank physically gone, stage 0's
// row still read its pad value of 1857.79 m/s.
//
// Identical 13-word rows in the same order (pushStagePerfRow, of_staging_api.inc
// §12.2), so ONE client reader serves both and the only difference is the
// subject. Returns the STAGE COUNT.
OF_API int of_fl_stage_performance(int f) {
  fl::FlightSim* s = g_flights.get(f);
  resetF64(s ? s->craft.stages.size() * 13 : 0);
  if (!s) return 0;
  s->craft.layout();
  const std::vector<vs::StagePerformance> all = vs::allStagePerformance(s->craft);
  for (const vs::StagePerformance& q : all) pushStagePerfRow(q);
  return static_cast<int>(all.size());
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

// ABI 20: NINE words per part, not eight, and the ninth is `radialOffsetM`.
// This row and `of_vs_transforms`'s are ONE format sharing ONE client constant
// (vesselabi.ts TRANSFORM_WORDS), so widening one and not the other would not
// be a smaller change, it would be a misaligned read in the flight lane.
OF_API int of_fl_transforms(int f) {
  fl::FlightSim* s = g_flights.get(f);
  resetF64(s ? s->craft.parts.size() * 9 : 0);
  if (!s) return 0;
  s->craft.layout();
  for (const auto& q : s->craft.parts) {
    g_f64.push_back(q.originM.x);   g_f64.push_back(q.originM.y);
    g_f64.push_back(q.originM.z);   g_f64.push_back(q.centroidM.x);
    g_f64.push_back(q.centroidM.y); g_f64.push_back(q.centroidM.z);
    g_f64.push_back(q.radialAngleRad);
    g_f64.push_back(q.propellantKg);
    g_f64.push_back(q.attach == vs::Attach::Radial ? q.radialOffsetM : 0.0);
  }
  return static_cast<int>(s->craft.parts.size());
}

// PH-66. SET ONE PART'S PROPELLANT, in kg, CLAMPED to that part's own capacity.
//
// The one write the fuel surface has ever been missing, and it exists for
// exactly one caller: putting a half-empty tank back after a reload. Everything
// else about propellant here is a read, and burning is the only other way it
// moves. `FlightCheats.refillTanks` says out loud what its absence cost -- it
// rebuilds the whole craft from its design and replays every staging to refill,
// because there was no other route -- and PH-30 / R11 named it as the single
// reason a flight could not be saved: restoring by replaying `stage` gets the
// right hardware and FULL TANKS, i.e. free delta-v on every reload.
//
// The clamp is the property that makes this safe to expose. A save file is
// untrusted input, and a setter that accepted any number would let a hand-edited
// slot put 10^9 kg in a 2150 kg tank, which is not a cheat but a mass property
// the integrator would then fly. Clamping to `propellantCapacityKg` means the
// worst a corrupt slot can do is a full tank, which the game can already produce
// by pressing one key in the bay. Negative clamps to zero for the same reason.
// -> 1 on success, 0 for a bad flight handle or a bad part handle.
OF_API int of_fl_set_propellant(int f, int partHandle, double kg) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  vs::PartInstance* q = s->craft.find(static_cast<vs::PartHandle>(partHandle));
  if (!q) return 0;
  const double cap = s->craft.def(*q).propellantCapacityKg;
  q->propellantKg = kg < 0.0 ? 0.0 : (kg > cap ? cap : kg);
  return 1;
}

// =============================================================================
// §13.3: ON RAILS. `orbital::park` and `orbital::resume` reach the browser.
//
// PH-64/PH-65. These are the two calls that let a vessel keep existing while
// nothing is simulating it. They are deliberately PURE and take NO handle, the
// same shape `of_mn_*` takes and for the same reason: a vessel on rails is not a
// FlightSim, it is nine numbers, and requiring a live flight handle to advance
// one would mean keeping alive exactly the object being retired.
//
// `FlightSim::park`/`resume` in flight.h are the member forms and are NOT
// exported, on purpose. A flight handle that could park itself would be a
// second answer to "is this vessel on rails", held inside the object whose
// retirement is the question. The predicate stays `of_fl_on_rails_eligible`.
//
// The epoch is a bare double in whatever clock the caller keeps, because
// `orbital::Elements` carries it and `elementsToState` only ever uses the
// DIFFERENCE `t - epoch`. Nothing here has an opinion about where zero is.
// =============================================================================

// Fit a conic to a state vector. f64 scratch, EXACTLY 9:
//   [a, e, i, lan, argp, nu, m0, epoch, mu]
// Note `i` is measured against +Z and this world's pole is +Y (PH-40): these are
// storage, not a readout, and the round trip through of_orb_resume is exact.
OF_API int of_orb_park(double px, double py, double pz,
                       double vx, double vy, double vz,
                       double mu, double simTimeS) {
  resetF64(9);
  const of::orbital::StateVector sv{vec(px, py, pz), vec(vx, vy, vz)};
  const of::orbital::Elements el = of::orbital::park(sv, mu, simTimeS);
  const double a[9] = {el.a, el.e, el.i, el.lan, el.argp,
                       el.nu, el.m0, el.epoch, el.mu};
  for (double x : a) g_f64.push_back(x);
  return 9;
}

// Evaluate that conic at `simTimeS`. f64 scratch, EXACTLY 6: [rX,Y,Z, vX,Y,Z].
//
// THIS IS THE WHOLE OF ON-RAILS PROPAGATION and it costs one Kepler solve. It is
// a function of the ELEMENTS and the TIME ASKED FOR, never of how many times it
// has been called, so advancing 3600 s in one call and in 216,000 calls of one
// tick produce bit-identical answers. That property is the reason a rails record
// must never re-fit its elements from a propagated state: re-fitting would make
// the answer depend on the call pattern, which is exactly the drift the analytic
// path exists to avoid (PH-3, PH-6).
OF_API int of_orb_resume(double a, double e, double i, double lan, double argp,
                         double nu, double m0, double epoch, double mu,
                         double simTimeS) {
  resetF64(6);
  of::orbital::Elements el;
  el.a = a; el.e = e; el.i = i; el.lan = lan; el.argp = argp;
  el.nu = nu; el.m0 = m0; el.epoch = epoch; el.mu = mu;
  const of::orbital::StateVector sv = of::orbital::resume(el, simTimeS);
  g_f64.push_back(sv.r.x); g_f64.push_back(sv.r.y); g_f64.push_back(sv.r.z);
  g_f64.push_back(sv.v.x); g_f64.push_back(sv.v.y); g_f64.push_back(sv.v.z);
  return 6;
}

// The guidance ribbon (DW-30 item 6), and it now TAKES A BODY (R87).
//
// WHAT THIS REPLACES AND WHY THE NAME CHANGED. `of_fl_guidance_pitch(altitudeM)`
// built a DEFAULT `flight::GravityTurnProgram` and was handed one number. Its
// constants are Forge's, so off an airless moon whose whole parking orbit is
// 20 km it asked for a launch that is still 33 degrees from horizontal at
// 20 km and does not level out until 45 km. While the navball only DREW the
// ribbon that was an inaccuracy. PH-201 gave it a key, so it became a wrong
// instruction a player can follow.
//
// IT IS A RENAME AND NOT A WIDENING, DELIBERATELY. Adding parameters to the old
// name would leave a client built against the new signature calling an OLD
// binary with the flight handle sitting where an altitude used to be: a small
// integer, a plausible altitude, a pitch of 0.0, and no error anywhere. That is
// exactly the confidently-incorrect class this project keeps paying for. A new
// name makes a stale binary fail by symbol, which the client already detects.
//
// `targetApoapsisM` is the orbit being bought, datum-relative. It is IGNORED on
// a body with air and REQUIRED without one, because the airless schedule's
// independent variable is the share of the target already bought. There is no
// defensible default for it, so word 4 goes to 0 and the caller draws nothing.
// `altitudeAglM` is the caller's, because terrain is the caller's: /core's
// flight sim knows the DATUM radius and nothing about the ground under it.
//
// f64 scratch, EXACTLY 5:
//   [0] pitchFromVerticalRad  the COMMANDED pitch, after every clamp: what to
//                             draw and what a follow mode should fly. Compose
//                             it with your own east; east stays the client's
//                             (PH-40: this codebase already carries two
//                             inclination conventions and does not need a third)
//   [1] schedulePitchRad      what the schedule asked BEFORE the terrain clamp.
//                             Equal to [0] where no clamp applies, so the two
//                             apart is a terrain veto a screen can show
//   [2] apoapsisAltM          datum-relative, off the state vector via arcPeak
//                             and never off a `bound` flag (R14). The airless
//                             schedule's own independent variable
//   [3] atmospheric           1 = the altitude schedule, scheduled off this
//                             body's own air; 0 = the apoapsis-progress one
//   [4] usable                0 = airless with no target set, so there is no
//                             schedule and the ribbon must say nothing
OF_API int of_fl_ascent_guidance(int f, double targetApoapsisM,
                                 double altitudeAglM) {
  resetF64(5);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();
  const of::vessel::MassProperties mp = of::vessel::massProperties(s->craft);
  const fl::PropulsionOutput full = fl::evaluatePropulsion(s->craft, 1.0, 0.0);
  const double aFull = full.thrustN / std::fmax(1.0, mp.totalKg);

  // The ground frame the airless law takes, built from what the caller knows.
  // `upUnit` is the radial, which is what the client's own horizon frame uses.
  of::landing::SurfaceFrame ground;
  ground.upUnit = of::orbital::normalized(s->state.posM);
  ground.radiusM = s->state.posM.length() - std::fmax(0.0, altitudeAglM);
  ground.normalUnit = ground.upUnit;

  // THE DOWNRANGE HINT IS SYNTHETIC AND THAT IS SOUND, because the returned
  // quantity is a PITCH and this law's pitch is independent of the azimuth: the
  // heading enters `ascent::guide` only through "is there a heading at all" and
  // through building a direction this export then measures the angle of. Any
  // non-degenerate horizontal vector gives the same pitch, so passing the
  // client's east would be a parameter whose value is discarded.
  Vec3 hint = of::orbital::cross(Vec3{0, 1, 0}, ground.upUnit);
  if (hint.length() < 1e-9) hint = of::orbital::cross(Vec3{1, 0, 0}, ground.upUnit);

  const of::ascent::Ribbon rb = of::ascent::ribbon(
      s->state.posM, s->state.velMS, ground, hint, s->env.air, s->env.muM3S2,
      s->env.bodyRadiusM, aFull, targetApoapsisM);
  g_f64.push_back(rb.pitchFromVerticalRad);
  g_f64.push_back(rb.schedulePitchRad);
  g_f64.push_back(rb.apoapsisAltM);
  g_f64.push_back(rb.atmospheric ? 1.0 : 0.0);
  g_f64.push_back(rb.usable ? 1.0 : 0.0);
  return 5;
}
