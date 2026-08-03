// =============================================================================
// of_ap_api.inc: §21 of the bridge: AUTOPILOT MISSION PLANNING (ABI 22).
//
// Included from of_core_api.cpp, after of_enemies_api.inc. It must come after
// of_flight_api.inc, because `g_flights` lives in that file's anonymous
// namespace, and after of_vessel_api.inc for `g_vessels`.
//
// NO ABI BUMP, DELIBERATELY, and the gameplay lane's own design is why. These
// four exports are purely ADDITIVE: no existing row moves, no stride changes,
// and `Autopilot.ts::apMissing` detects them by SYMBOL PRESENCE rather than by
// version, so a client built before they existed keeps working and says on
// screen exactly which names it is waiting for. Bumping would have forced a
// lock-step client change for a surface nothing old reads. ABI stays 22.
//
// THIS FILE IS THE OTHER HALF OF A CONTRACT THE GAMEPLAY LANE PUBLISHED FIRST,
// in the header of `web/src/game/Autopilot.ts`, committed before this existed so
// it could be read in the repo rather than in a message. Signatures, word counts
// and argument order are theirs verbatim. Where this lane disagreed with the
// contract it is written down below rather than silently resolved.
//
// WHY THE MATHS IS NOT IN TYPESCRIPT: same reason as of_maneuver_api.inc, and
// one sharper. A transfer needs Lambert, an element fit, a conic propagation and
// Tsiolkovsky inverted across the remaining stages. All four are in /core, and
// R43 is the standing proof of what a second opinion costs: a stage mixing a
// solid booster with a liquid engine published 656.02 m/s for 3890.36 of real
// capability, and a fuel gate built on that would have refused rockets that fly.
// `dvAvailable` in every row below is `vessel::remainingDeltaVVacuumMS` or
// `totalDeltaVVacuumMS` and never anything else.
//
// THE CLIENT SUPPLIES NO MU AND NO BODY RADIUS (DW-18). For the three flight
// calls they come off the handle's own FlightEnvironment. For the design call
// see §21.1, which is the one place the published contract had a hole.
// =============================================================================
#include <limits>
#include <map>

#include "of/autopilot.h"
#include "of/transfer.h"

namespace tf = of::transfer;
namespace ap = of::autopilot;

// The departure-curve cap. Same argument as kMnMaxSamples: past a couple of
// hundred points a chart is drawing sub-pixel, and a bound turns one mistyped
// argument into a small answer instead of a gigabyte.
static const int kApMaxCurveSamples = 256;

// How finely each departure sample searches its own time of flight. Measured on
// the Anchorage case: 24 lands 2.32 m/s (0.6%) above the true Hohmann optimum,
// which is inside the 5% mission reserve, and the whole 48 x 24 scan costs
// 6.1 ms. A chart that took 60 ms to redraw would be a worse chart.
static const int kApTofSamples = 24;

// Build a Target from the nine words the client sends. `taRad` NaN means THE
// TARGET HAS NO PHASE: it is a requested orbit rather than an object, any point
// on the ring will do, and there is therefore no phase angle and no window.
// That is Reid's fifth ask ("set an automatic take it to this orbit") and the
// contract carries it as a NaN rather than as a second entry point.
static tf::Target apTarget(double smaM, double ecc, double incRad, double lanRad,
                           double argpRad, double taRad, double epochS,
                           double mu) {
  tf::Target t;
  t.el.a = smaM;
  t.el.e = ecc;
  t.el.i = incRad;
  t.el.lan = lanRad;
  t.el.argp = argpRad;
  t.el.nu = taRad;
  t.el.epoch = epochS;
  t.el.mu = mu;
  // The mean anomaly the propagator actually advances. `park` is the one place
  // that conversion lives, so this goes through a state vector rather than
  // re-deriving Kepler's equation here.
  if (std::isfinite(taRad)) {
    const of::orbital::StateVector s = of::orbital::elementsToState(t.el, epochS);
    t.el = of::orbital::park(s, mu, epochS);
  }
  return t;
}

static bool apPhaseless(double taRad) { return !std::isfinite(taRad); }

// The 10-word reach row, in `Autopilot.ts`'s own order:
//   0  ok            physics answered at all. 0 means REFUSED, not "zero cost".
//   1  dvRequired    the mission, all five legs
//   2  dvAvailable   /core's own figure and nothing else
//   3  margin        available - required, negative when short
//   4  feasible      1/0
//   5  ascent        pad to a parking orbit. 0 for a craft already in orbit,
//                    and that is a PHYSICAL zero.
//   6  planeChange   what the plane mismatch actually adds, allocated rather
//                    than decomposed (transfer.h §5). 0 for a launch, because a
//                    launch picks its plane with its azimuth.
//   7  transfer      the injection burn, priced as if the planes matched
//   8  arrival       match for a vessel, capture for a body, 0 for a flyby
//   9  reserve       5%, the one POLICY in the row, named in transfer.h
// Words 5 to 9 sum to word 1 exactly, because a screen drawing five bars beside
// a total must be able to add them up.
static int apPushReach(const tf::MissionBudget& b) {
  resetF64(10);
  const double a[10] = {
      b.ok ? 1.0 : 0.0, b.totalMS, b.availableMS, b.marginMS,
      b.feasible ? 1.0 : 0.0,
      b.ascentMS, b.planeChangeMS, b.transferMS, b.arrivalMS, b.reserveMS};
  for (double x : a) g_f64.push_back(x);
  return 10;
}

// -----------------------------------------------------------------------------
// §21.1: THE BAY'S QUESTION. Can this vehicle, as drawn, reach that orbit.
//
// THE CONTRACT HAD A HOLE HERE AND IT IS RESOLVED RATHER THAN PAPERED OVER.
// The published signature is `of_ap_design_reach(v, sma, ecc, inc, lan)` with no
// body handle, and a `vs::Vessel` carries no body: it is parts and geometry, and
// every other `of_vs_*` that needs gravity (`of_vs_twr`) takes a body handle
// explicitly. So this call has no source of mu, and a JS-supplied one is
// forbidden.
//
// It does not need one. `transfer::ascentDvMS` is CALIBRATED against a flown
// Forge ascent and REFUSES every other body, so the only launch this function
// can price is a Forge launch either way, and `orbital::kForgeMu` is that body's
// one authority rather than a second copy of it (test_vessel.cpp pins
// `worldgen::makeForge().muM3S2 == orbital::kForgeMu` bit for bit). The day
// there is a pad anywhere else, this refuses instead of guessing (R63) and the
// signature grows a body handle in the same commit as the second pad.
//
// A rocket on a pad has NO PHASE with anything, so `ecc`, `inc` and `lan` are
// accepted and the answer is a Hohmann to the ring: no window, no Lambert, and
// no true anomaly in the signature, which is the contract being right.
// -----------------------------------------------------------------------------
OF_API int of_ap_design_reach(int v, double smaM, double ecc, double incRad,
                              double lanRad) {
  resetF64(0);
  vs::Vessel* p = g_vessels.get(v);
  if (!p) return 0;
  (void)ecc; (void)incRad; (void)lanRad;
  p->layout();
  return apPushReach(tf::launchBudget(*p, smaM));
}

// -----------------------------------------------------------------------------
// §21.2: THE MAP'S QUESTION. Can the craft I am flying reach it, leaving at t.
//
// `tDepartFromNowS` is seconds from the flight's own clock, so the client never
// has to know what the sim time is.
// -----------------------------------------------------------------------------
OF_API int of_ap_flight_reach(int f, double tDepartFromNowS, double smaM,
                              double ecc, double incRad, double lanRad,
                              double argpRad, double taRad, double epochS) {
  resetF64(0);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();
  const double mu = s->env.muM3S2;
  const of::orbital::Elements ship = s->park();
  const double depart = s->state.timeS + tDepartFromNowS;
  const tf::Target tgt =
      apTarget(smaM, ecc, incRad, lanRad, argpRad, taRad, epochS, mu);

  tf::Transfer tr;
  if (apPhaseless(taRad)) {
    // NO PHASE, so there is nothing to rendezvous with: the target is a ring.
    // The honest cost is the Hohmann to it, and it is the same at every
    // departure time, which is why the curve below comes out flat rather than
    // being special-cased into flatness.
    tf::MissionBudget b;
    const double rNow = of::orbital::elementsToState(ship, depart).r.length();
    tf::hohmannBurnsMS(rNow, smaM, mu, &b.transferMS, &b.arrivalMS);
    const double mission = b.transferMS + b.arrivalMS;
    b.reserveMS = mission * tf::kMissionReserveFraction;
    b.totalMS = mission + b.reserveMS;
    b.availableMS = vs::remainingDeltaVVacuumMS(s->craft);
    b.marginMS = b.availableMS - b.totalMS;
    b.feasible = b.marginMS >= 0.0;
    b.ok = true;
    return apPushReach(b);
  }

  // A real target: search this departure time's own best time of flight, the
  // same way `scanWindow` does, so one departure of the curve and this call
  // cannot disagree.
  const double tH = tf::hohmannTimeS(ship.a, smaM, mu);
  if (!(tH > 0.0)) return 0;
  double best = 1e308;
  for (int j = 0; j < kApTofSamples; ++j) {
    const double g = static_cast<double>(j) / (kApTofSamples - 1);
    const double tof = (0.25 + g * 1.5) * tH;
    const tf::Transfer c = tf::solveTransfer(ship, tgt, depart, tof);
    if (!c.valid || !(c.totalDvMS < best)) continue;
    best = c.totalDvMS;
    tr = c;
  }
  if (!tr.valid) return 0;
  // Already in orbit, so the ascent leg is a PHYSICAL zero and says so.
  const tf::AscentCost noAscent;
  return apPushReach(tf::missionBudget(s->craft, ship, tgt, tr, noAscent));
}

// -----------------------------------------------------------------------------
// §21.3: THE CHART. Reid asked to see "how optimal the current time would be to
// launch vs waiting later", which is a CURVE and not a number, and it is also
// what makes his scheduling rule legible: refuse a destination you cannot reach
// NOW, but allow scheduling one you WILL be able to reach at a better time.
// That rule is only coherent if reach is a function of when you go.
//
// 4 words per sample, `Autopilot.ts`'s order:
//   0  tDepart from now (s)
//   1  dvRequired at that departure, all legs including the reserve
//   2  feasible 1/0 against the craft's own remaining delta-v
//   3  arrival from now (s), so the chart can label when you would get there
// Returns the SAMPLE COUNT. An infeasible sample is still a sample: the chart
// must draw the expensive part of the curve, or a player cannot see the shape
// they are waiting for.
// -----------------------------------------------------------------------------
OF_API int of_ap_departure_curve(int f, double tStartS, double tEndS, int samples,
                                 double smaM, double ecc, double incRad,
                                 double lanRad, double argpRad, double taRad,
                                 double epochS) {
  resetF64(0);
  fl::FlightSim* s = g_flights.get(f);
  if (!s || samples < 2 || !(tEndS > tStartS)) return 0;
  const int n = samples > kApMaxCurveSamples ? kApMaxCurveSamples : samples;
  s->craft.layout();
  const double mu = s->env.muM3S2;
  const of::orbital::Elements ship = s->park();
  const double available = vs::remainingDeltaVVacuumMS(s->craft);
  const tf::Target tgt =
      apTarget(smaM, ecc, incRad, lanRad, argpRad, taRad, epochS, mu);
  const double tH = tf::hohmannTimeS(ship.a, smaM, mu);
  if (!(tH > 0.0)) return 0;

  resetF64(static_cast<size_t>(n) * 4);
  for (int i = 0; i < n; ++i) {
    const double fr = static_cast<double>(i) / (n - 1);
    const double fromNow = tStartS + fr * (tEndS - tStartS);
    const double depart = s->state.timeS + fromNow;

    double dv = 0.0, arriveFromNow = 0.0;
    bool got = false;
    if (apPhaseless(taRad)) {
      // A ring has no window, so every departure costs the same and the chart
      // is flat BY CONSTRUCTION rather than by a special case in the client.
      const double rNow = of::orbital::elementsToState(ship, depart).r.length();
      double d1 = 0.0, d2 = 0.0;
      tf::hohmannBurnsMS(rNow, smaM, mu, &d1, &d2);
      dv = (d1 + d2) * (1.0 + tf::kMissionReserveFraction);
      arriveFromNow = fromNow + tf::hohmannTimeS(rNow, smaM, mu);
      got = true;
    } else {
      double best = 1e308, bestTof = 0.0;
      for (int j = 0; j < kApTofSamples; ++j) {
        const double g = static_cast<double>(j) / (kApTofSamples - 1);
        const double tof = (0.25 + g * 1.5) * tH;
        const tf::Transfer c = tf::solveTransfer(ship, tgt, depart, tof);
        if (!c.valid || !(c.totalDvMS < best)) continue;
        best = c.totalDvMS;
        bestTof = tof;
      }
      if (best < 1e307) {
        dv = best * (1.0 + tf::kMissionReserveFraction);
        arriveFromNow = fromNow + bestTof;
        got = true;
      }
    }
    // A departure with no solution publishes a NaN cost rather than a zero.
    // Zero would draw as the cheapest point on the chart, which is the exact
    // opposite of the truth, and `Autopilot.ts` already filters on
    // `Number.isFinite`.
    g_f64.push_back(fromNow);
    g_f64.push_back(got ? dv : std::numeric_limits<double>::quiet_NaN());
    g_f64.push_back(got && dv <= available ? 1.0 : 0.0);
    g_f64.push_back(got ? arriveFromNow : std::numeric_limits<double>::quiet_NaN());
  }
  return n;
}

// -----------------------------------------------------------------------------
// §21.4: THE BURN ITSELF, in `of_mn_plan`'s own 26 words IN THE SAME ORDER so
// one client reader serves both, then the post-burn position and velocity so
// `of_mn_path` draws the planned conic with no second propagator.
//
//   0-25  exactly of_mn_plan's row (see of_maneuver_api.inc §17.3)
//   26-28 post-burn position, body-centred inertial
//   29-31 post-burn velocity
// 32 words. Feed 26-31 straight into `of_mn_path` and the map draws the
// transfer, which is milestone 3 handed to the map for free.
//
// THE NODE IS DERIVED, NOT INVENTED. The transfer solve produces an inertial
// delta-v vector; `maneuver::Node` wants it in the prograde/normal/radial triad,
// so it is PROJECTED onto `orbital::basisAt`, which is the one triad in the
// codebase (PH-39). Then the ordinary `maneuver::plan` evaluates it, which means
// the burn duration, the lead, the feasibility and the resulting orbit all come
// from the same code the manual node uses and cannot drift from it.
// -----------------------------------------------------------------------------
OF_API int of_ap_plan(int f, double tDepartFromNowS, double smaM, double ecc,
                      double incRad, double lanRad, double argpRad, double taRad,
                      double epochS) {
  resetF64(0);
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();
  const double mu = s->env.muM3S2;
  const of::orbital::Elements ship = s->park();
  const double depart = s->state.timeS + tDepartFromNowS;

  of::Vec3 dv{0, 0, 0};
  if (apPhaseless(taRad)) {
    // A ring: the first burn of a Hohmann, prograde, at the current radius.
    const of::orbital::StateVector now = of::orbital::elementsToState(ship, depart);
    double d1 = 0.0, d2 = 0.0;
    tf::hohmannBurnsMS(now.r.length(), smaM, mu, &d1, &d2);
    const of::orbital::Basis b = of::orbital::basisAt(now);
    dv = b.prograde * (smaM > now.r.length() ? d1 : -d1);
  } else {
    const tf::Target tgt =
        apTarget(smaM, ecc, incRad, lanRad, argpRad, taRad, epochS, mu);
    const double tH = tf::hohmannTimeS(ship.a, smaM, mu);
    if (!(tH > 0.0)) return 0;
    tf::Transfer tr;
    double best = 1e308;
    for (int j = 0; j < kApTofSamples; ++j) {
      const double g = static_cast<double>(j) / (kApTofSamples - 1);
      const tf::Transfer c =
          tf::solveTransfer(ship, tgt, depart, (0.25 + g * 1.5) * tH);
      if (!c.valid || !(c.totalDvMS < best)) continue;
      best = c.totalDvMS;
      tr = c;
    }
    if (!tr.valid) return 0;
    dv = tr.departDv;
  }

  // Into the one triad, at the node rather than at the ship (PH-40's rule).
  const of::orbital::StateVector at = of::orbital::elementsToState(ship, depart);
  const of::orbital::Basis basis = of::orbital::basisAt(at);
  mnv::Node n;
  n.tFromNowS = tDepartFromNowS;
  n.progradeMS = dv.dot(basis.prograde);
  n.normalMS = dv.dot(basis.normal);
  n.radialMS = dv.dot(basis.radialOut);

  const mnv::Plan p = mnv::plan(s->orbitalState(), mu, s->env.bodyRadiusM,
                                s->craft, n);
  resetF64(32);
  const double a[32] = {
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
      p.orbitAfter.periodS, p.orbitAfter.bound ? 1.0 : 0.0,
      p.before.r.x, p.before.r.y, p.before.r.z,
      p.after.v.x, p.after.v.y, p.after.v.z};
  for (double x : a) g_f64.push_back(x);
  return 32;
}

// =============================================================================
// §21.5: EXECUTION. Arm, cancel, status.
//
// PUBLISHED BY THIS LANE FIRST, deliberately. The planning half worked because
// the gameplay lane wrote its contract into a committed file before the other
// side existed. This is the same pattern with the sides swapped: execution is
// physics' half, so physics publishes and gameplay binds. Names, word counts
// and order are settled here, and this comment is the specification.
//
// THREE CALLS AND NO TICK. The autopilot is driven from inside `of_fl_step` and
// `of_fl_step_n` (see of_flight_api.inc), so a client ARMS a program and then
// steps the flight exactly as it already does. There is no per-frame autopilot
// call to forget, no ordering to get wrong, and a time-warped step flies the
// program identically to a real-time one, which matters because a scheduled
// departure hours away is only reachable under warp.
//
// A SCHEDULED DEPARTURE NEEDS NO SEPARATE MECHANISM. Reid's ask is "set it to a
// later time if you don't have enough fuel right now but will at a more optimal
// time". A program armed now whose first ignition is hours away simply coasts
// until then: the future departure is a number in the plan, not a state in the
// executor, so there is nothing extra to persist, cancel or get wrong.
//
// STILL NO ABI BUMP. Additive, no stride moves, and symbol-presence detection
// keeps an old client working and naming what it waits for. ABI stays 22.
//
//   of_ap_arm_hold_orbit(f, targetRadiusM)                 -> 1 armed, 0 refused
//   of_ap_arm_transfer(f, tDepartFromNowS, ...9 target)    -> 1 armed, 0 refused
//   of_ap_cancel(f)                                        -> 1 if it was armed
//   of_ap_status(f)                                        -> 18, or 0
//   of_ap_note(f)                                          -> UTF-8 byte count
//
// A REFUSAL IS AN ANSWER. `arm` returns 0 when the program is not flyable, and
// `of_ap_note` then says why in words a screen can print: "not enough delta-v
// aboard for this orbit" is a different sentence from "degenerate orbit
// request", and a UI given one boolean could not tell a player which.
// =============================================================================

// One autopilot per FLIGHT handle, in a map rather than as a member of
// FlightSim. An executor is not part of what a vessel IS: the same craft flown
// by hand and flown by autopilot is the same object, and only the bridge knows
// which is happening. Keeping it here also means /core stays free of the
// question and `flight.h` needs no field it would have to serialise.
namespace { std::map<int, ap::Autopilot> g_pilots; }

// Called from of_fl_step / of_fl_step_n, once per tick, before the integrator.
void apDriveAutopilot(int f, fl::FlightSim& s, double dt) {
  auto it = g_pilots.find(f);
  if (it == g_pilots.end()) return;
  ap::Autopilot& pilot = it->second;
  if (!pilot.running()) return;
  const ap::Command c = pilot.update(s, dt);
  ap::Autopilot::apply(s, c);
}

OF_API int of_ap_arm_hold_orbit(int f, double targetRadiusM) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();
  const ap::Program p = ap::holdOrbit(s->orbitalState(), s->state.timeS,
                                      s->env.muM3S2, targetRadiusM, s->craft);
  g_pilots[f].arm(p);
  return p.valid ? 1 : 0;
}

OF_API int of_ap_arm_transfer(int f, double tDepartFromNowS, double smaM,
                              double ecc, double incRad, double lanRad,
                              double argpRad, double taRad, double epochS) {
  fl::FlightSim* s = g_flights.get(f);
  if (!s) return 0;
  s->craft.layout();
  const double mu = s->env.muM3S2;
  const of::orbital::Elements ship = s->park();
  const double depart = s->state.timeS + tDepartFromNowS;
  const tf::Target tgt =
      apTarget(smaM, ecc, incRad, lanRad, argpRad, taRad, epochS, mu);

  // The SAME time-of-flight search the reach row and the departure curve use,
  // so a player who was shown a cost on the chart is armed with the transfer
  // that produced it rather than with a second opinion about the same trip.
  const double tH = tf::hohmannTimeS(ship.a, smaM, mu);
  if (!(tH > 0.0)) return 0;
  tf::Transfer best;
  double bestDv = 1e308;
  for (int j = 0; j < kApTofSamples; ++j) {
    const double g = static_cast<double>(j) / (kApTofSamples - 1);
    const tf::Transfer c =
        tf::solveTransfer(ship, tgt, depart, (0.25 + g * 1.5) * tH);
    if (!c.valid || !(c.totalDvMS < bestDv)) continue;
    bestDv = c.totalDvMS;
    best = c;
  }
  if (!best.valid) return 0;
  // A vessel target is MATCHED; a body is CAPTURED, and transfer.h refuses to
  // publish an arrival vector for a capture so that nobody flies one across a
  // frame change. A body therefore arms as a single injection burn today, and
  // PH-156 is opening that seam rather than working around it.
  const ap::Program p = ap::flyTransfer(best, s->craft, !tgt.isBody());
  g_pilots[f].arm(p);
  return p.valid ? 1 : 0;
}

OF_API int of_ap_cancel(int f) {
  auto it = g_pilots.find(f);
  if (it == g_pilots.end()) return 0;
  // Cutting the throttle is PART of cancelling. Leaving the engine lit because
  // the executor stopped looking is the worst possible reading of the word.
  fl::FlightSim* s = g_flights.get(f);
  if (s) s->state.throttle = 0.0;
  g_pilots.erase(it);
  return 1;
}

// f64 scratch, EXACTLY 18. Returns 18, or 0 when nothing is armed for `f`.
//    0  running        1 while the program is still going (Coast/Orient/Burn),
//                      0 once it is Done or Aborted. This is the word an ARM
//                      button reads. It is NOT "is something armed", because
//                      the COUNT already says that: a refused arm returns 18
//                      with running 0 and phase 5, so a screen can show the
//                      refusal and its note instead of forgetting it happened.
//    1  phase          0 Idle, 1 Coast, 2 Orient, 3 Burn, 4 Done, 5 Aborted
//    2  mode           0 Off, 1 HoldOrbit, 2 Transfer
//    3  burnIndex      which burn is next or running
//    4  burnCount
//    5  timeToIgnitionS  of that burn. NEGATIVE means the burn is OVERDUE,
//                        which is exactly what a vehicle still slewing looks
//                        like, and is a state a screen should be able to show.
//    6  dvSpentTotalMS   integrated from thrust ACTUALLY delivered, not planned
//    7  dvThisBurnMS     spent so far on the current burn
//    8  currentBurnDvMS  what that burn is meant to cost
//    9  pointingErrorDeg
//   10  rateDegS
//   11  burningNow     1/0
//   12  throttleNow    what the executor last commanded
//   13  programDvMS    the whole program
//   14  targetRadiusM  HoldOrbit only, else 0
//   15-17 the current burn's direction, unit, inertial. A navball can draw this
//         directly, and it is the SAME vector the executor is holding, so the
//         marker and the ship can never disagree.
OF_API int of_ap_status(int f) {
  resetF64(18);
  auto it = g_pilots.find(f);
  if (it == g_pilots.end()) return 0;
  const ap::Autopilot& pilot = it->second;
  const ap::Program& p = pilot.program;
  const ap::Status& st = pilot.status;
  const int bi = (st.burnIndex >= 0 && st.burnIndex < p.burnCount) ? st.burnIndex : 0;
  const of::Vec3 dir = (p.burnCount > 0)
      ? of::orbital::normalized(p.burns[bi].deltaV) : of::Vec3{0, 1, 0};
  fl::FlightSim* s = g_flights.get(f);
  const double a[18] = {
      pilot.running() ? 1.0 : 0.0,
      static_cast<double>(st.phase),
      static_cast<double>(p.mode),
      static_cast<double>(st.burnIndex),
      static_cast<double>(p.burnCount),
      st.timeToIgnitionS,
      st.dvSpentTotalMS,
      st.dvSpentThisBurnMS,
      (p.burnCount > 0) ? p.burns[bi].deltaVMS : 0.0,
      st.pointingErrorDeg,
      st.rateDegS,
      st.burningNow ? 1.0 : 0.0,
      s ? s->state.throttle : 0.0,
      p.totalDvMS,
      p.targetRadiusM,
      dir.x, dir.y, dir.z};
  for (double x : a) g_f64.push_back(x);
  return 18;
}

// Why it refused, or what it is doing, in words a screen can print. u8 scratch,
// UTF-8, NOT null terminated; returns the byte count. Same convention as
// `of_vs_part_name`, through the same `textOut` helper so there is one string
// path across the whole bridge.
OF_API int of_ap_note(int f) {
  auto it = g_pilots.find(f);
  if (it == g_pilots.end()) return textOut("nothing armed");
  const ap::Autopilot& pilot = it->second;
  const char* n = (pilot.status.note && pilot.status.note[0] != '\0')
                  ? pilot.status.note : pilot.program.note;
  return textOut(n);
}
