// =============================================================================
// of_maneuver_api.inc: §17 of the bridge: MANEUVER NODE PLANNING (ABI 11).
//
// Included from of_core_api.cpp, after of_research_api.inc.
//
// Every call here is a pure function of a flight handle plus a few doubles.
// Nothing is stored: a node lives in the client's UI, is re-evaluated whenever
// a handle moves, and commands nothing. That is PH-37 and it is the reason
// this can be a pass-through rather than a second registry.
//
// WHY THE MATHS IS NOT IN TYPESCRIPT. A node needs conic propagation, a
// prograde/normal/radial triad, an element fit and Tsiolkovsky inverted. All
// four already exist in /core, pinned by 242 checks including one that flies
// the burn a node describes and compares the orbit reached against the orbit
// predicted. A TypeScript copy would be a SECOND answer to "where is the
// trajectory" and to "which way is normal", which is the two-authority failure
// this project has paid for six times. The map draws; it does not compute.
//
// The one thing the client must NOT do is supply mu or the body radius. They
// come off the flight handle's own FlightEnvironment, which came off
// BodyParams::muM3S2 (DW-18, the one gravity authority). A JS-supplied mu
// would be a second gravity, which is the sixteen-times-apart bug DW-18 exists
// to have already fixed.
// =============================================================================
#include "of/maneuver.h"

namespace mnv = of::maneuver;

// The polyline cap. 512 points is well past the pixel resolution of any map
// and it bounds one mistyped argument from asking for a gigabyte.
static const int kMnMaxSamples = 512;

// -----------------------------------------------------------------------------
// §17.1: the conic through an arbitrary state, as a polyline the map can draw.
//
// The state is passed in rather than read off the handle so that ONE call
// serves both curves the map shows: the current trajectory (from of_fl_state)
// and the trajectory a node would produce (from of_mn_plan's post-burn
// velocity at the node position). mu and the body radius are the handle's.
//
// -> the POINT count; f64 scratch holds count*3 doubles [x,y,z] in the
//    body-centred inertial frame, in order, closing the loop for a bound orbit.
// -----------------------------------------------------------------------------
OF_API int of_mn_path(int f, double px, double py, double pz,
                      double vx, double vy, double vz, int samples) {
  resetF64(0);
  fl::FlightSim* s = g_flights.get(f);
  if (!s || samples < 2) return 0;
  const int n = samples > kMnMaxSamples ? kMnMaxSamples : samples;
  const of::orbital::StateVector sv{vec(px, py, pz), vec(vx, vy, vz)};
  // An unbound trajectory is swept out to one SOI crossing time at the current
  // speed, which is a horizon rather than a physical event: patched-conic SOI
  // handoff is not built (physics R5 family), so the map shows the arc and
  // does not claim to know where it ends up.
  const double horizon = std::max(600.0, of::orbital::kForgeSoiRadius /
                                             std::max(1.0, sv.v.length()));
  const mnv::Path path =
      mnv::samplePath(sv, s->env.muM3S2, s->env.bodyRadiusM, n, horizon);
  resetF64(path.points.size() * 3);
  for (const of::Vec3& q : path.points) {
    g_f64.push_back(q.x); g_f64.push_back(q.y); g_f64.push_back(q.z);
  }
  return static_cast<int>(path.points.size());
}

// -----------------------------------------------------------------------------
// §17.2: the scalars that go beside the curve. Same arguments, same conic.
//
// f64 scratch, EXACTLY 18:
//   [bound, periodS, semiMajorAxisM, eccentricity, inclinationRad,
//    apoapsisAltM, periapsisAltM, timeToApoapsisS, timeToPeriapsisS,
//    apX, apY, apZ, peX, peY, peZ, normalX, normalY, normalZ]
//
// The normal is published so a map builds its projection frame from the one
// authority rather than taking its own cross product of r and v.
//
// `inclinationRad` is measured against the WORLD's +Y pole and is deliberately
// not orbital::Elements::i, which is measured against +Z (PH-40). The element
// set is self-consistent, so nothing that uses it is wrong; its `i` is simply
// an angle to a plane this planet does not have, and printing it beside a
// latitude would be a number that looks right and is not.
//
// The two apsis TIMES are -1 for an unbound trajectory, which has no apoapsis
// and whose periapsis may be in the past. -1 is a refusal, not a time.
// -----------------------------------------------------------------------------
OF_API int of_mn_orbit_meta(int f, double px, double py, double pz,
                            double vx, double vy, double vz) {
  resetF64(18);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  const of::orbital::StateVector sv{vec(px, py, pz), vec(vx, vy, vz)};
  const mnv::Path p =
      mnv::samplePath(sv, s->env.muM3S2, s->env.bodyRadiusM, 2, 600.0);
  const double a[18] = {p.bound ? 1.0 : 0.0, p.periodS, p.semiMajorAxisM,
                        p.eccentricity, p.inclinationRad,
                        p.apoapsisAltM, p.periapsisAltM,
                        p.timeToApoapsisS, p.timeToPeriapsisS,
                        p.apoapsis.x, p.apoapsis.y, p.apoapsis.z,
                        p.periapsis.x, p.periapsis.y, p.periapsis.z,
                        p.normal.x, p.normal.y, p.normal.z};
  for (double x : a) g_f64.push_back(x);
  return 18;
}

// -----------------------------------------------------------------------------
// §17.3: THE NODE. Plan a burn `tFromNowS` ahead of the vessel's current
// state, with the three KSP handles, and report what it costs and what it
// produces. Nothing is stored and nothing is commanded.
//
// f64 scratch, EXACTLY 26:
//    0     valid
//    1-3   node position (body-centred inertial), where the burn happens
//    4-6   post-burn velocity AT the node: feed these with 1-3 back into
//          of_mn_path to draw the orbit the node produces
//    7-9   burn direction, unit: where to point the nose. Feed it to
//          of_fl_set_sas_command + SAS mode 4 and that IS hold-node.
//   10     deltaVMS               how much
//   11     timeToNodeS            when the node is
//   12     timeToBurnStartS       when to LIGHT IT: node minus half the burn
//   13     burnDurationS          how long for
//   14     burnLeadS              half of 13, published so nobody halves it twice
//   15     deltaVAvailableMS      what the ship actually carries right now
//   16     shortfallMS            0 when it can be flown
//   17     feasible               1/0
//   18     stagesUsed             how many stagings the burn spans
//   19     burnFractionOfPeriod   how impulsive the impulsive plan really is
//   20-25  resulting orbit: [apoapsisAltM, periapsisAltM, semiMajorAxisM,
//          eccentricity, periodS, bound] - the same six words and the same
//          order as of_fl_orbit, so one reader serves both.
// -----------------------------------------------------------------------------
OF_API int of_mn_plan(int f, double tFromNowS, double dvProgradeMS,
                      double dvNormalMS, double dvRadialMS) {
  resetF64(26);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();

  mnv::Node n;
  n.tFromNowS = tFromNowS;
  n.progradeMS = dvProgradeMS;
  n.normalMS = dvNormalMS;
  n.radialMS = dvRadialMS;

  const mnv::Plan p = mnv::plan(s->orbitalState(), s->env.muM3S2,
                                s->env.bodyRadiusM, s->craft, n);
  const double a[26] = {
      p.valid ? 1.0 : 0.0,
      p.before.r.x, p.before.r.y, p.before.r.z,
      p.after.v.x, p.after.v.y, p.after.v.z,
      p.burnDirection.x, p.burnDirection.y, p.burnDirection.z,
      p.deltaVMS, p.timeToNodeS, p.timeToBurnStartS,
      p.burn.durationS, p.burn.leadS, p.burn.deltaVAvailableMS,
      p.burn.shortfallMS, p.burn.feasible ? 1.0 : 0.0,
      static_cast<double>(p.burn.stagesUsed), p.burn.burnFractionOfPeriod,
      p.orbitAfter.apoapsisAltM, p.orbitAfter.periapsisAltM,
      p.orbitAfter.semiMajorAxisM, p.orbitAfter.eccentricity,
      p.orbitAfter.periodS, p.orbitAfter.bound ? 1.0 : 0.0};
  for (double x : a) g_f64.push_back(x);
  return 26;
}
