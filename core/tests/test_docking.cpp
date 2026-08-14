// =============================================================================
// test_docking.cpp - the capture test and the join (of/docking.h, PH-170).
//
// D-015: a docking port is a part instance in a design, and "automatically
// dock" ships in two layers with CAPTURE FIRST, because it is the mechanism
// and manual docking needs it too. This file tests that layer and nothing
// above it.
//
// THE ACCEPTANCE IS THE TUNNELLING TEST. Everything else here is ordinary
// geometry; the one assertion that justifies the whole shape of the header is
// that a point-in-sphere test at tick boundaries reports NOTHING for two ports
// that pass exactly through each other, and the swept test reports 0.0 m.
//
// The port frames used below are the ones the asset lane measured off the
// shipped `.glb` bytes, so a change to the meshes fails here rather than in a
// browser:
//   station  socket_dock                   local (30.40, 2.20, 0), face +X, roll +Y
//   vessel   DockingPort/socket_dock       local (0, 0.30, 0),     face +Y, roll +X
// =============================================================================
#include <cmath>
#include <cstdio>

#include "of/cubed_sphere.h"
#include "of/docking.h"
#include "of/orbital.h"
#include "of/vessel.h"
#include "test_framework.h"

using namespace of;
namespace dk = of::docking;

static const double kDeg = 180.0 / orbital::kPi;

// The two shipped frames, as measured off the assets.
static dk::PortPose stationSocketLocal() {
  dk::PortPose p;
  p.posM = Vec3{30.40, 2.20, 0.0};
  p.faceAxis = Vec3{1, 0, 0};      // +X
  p.rollAxis = Vec3{0, 1, 0};      // +Y
  return p;
}
static dk::PortPose vesselSocketLocal() {
  dk::PortPose p;
  p.posM = Vec3{0.0, 0.30, 0.0};
  p.faceAxis = Vec3{0, 1, 0};      // +Y
  p.rollAxis = Vec3{1, 0, 0};      // +X
  return p;
}

// A port sitting still at a place, pointing a way.
static dk::PortPose at(const Vec3& p, const Vec3& face, const Vec3& roll) {
  dk::PortPose q;
  q.posM = p;
  q.faceAxis = orbital::normalized(face);
  q.rollAxis = orbital::normalized(roll);
  return q;
}

// =============================================================================
// DW-20: prove the fixture before believing anything measured in it.
// =============================================================================
TEST(the_shipped_capture_numbers_are_the_ones_the_part_carries) {
  const vessel::PartDef* d =
      vessel::catalogue().get(vessel::parts::DockingPort);
  CHECK(d != nullptr);
  CHECK(d->cls == vessel::PartClass::Docking);
  // The two numbers `Limits` defaults to are the PART'S, and this is the
  // assertion that keeps them one fact rather than two copies. DW-30 item 5
  // says the cone is wide on purpose; 0.60 and 30 degrees are what is authored.
  const dk::Limits lim;
  CHECK_NEAR(lim.captureRadiusM, d->dockCaptureRadiusM, 1e-12);
  CHECK_NEAR(lim.captureConeRad, d->dockCaptureConeRad, 1e-12);
  CHECK_NEAR(lim.captureRadiusM, 0.60, 1e-12);
  CHECK_NEAR(lim.captureConeRad * kDeg, 30.0, 1e-9);
}

// =============================================================================
// THE ONE THAT JUSTIFIES THE HEADER: A POINT TEST AT TICK BOUNDARIES IS BLIND.
//
// R67 measured the pathological case at 7.6 km/s, which is 127 m of travel in
// one 1/60 s tick against a 1.2 m diameter capture sphere. D-014 has since made
// the station genuinely orbit, so that speed no longer arises from the station
// standing still; the sweep stays because a player can fly any approach speed
// they like and a test that is only correct for slow ones fails exactly when a
// mistake is made.
// =============================================================================
TEST(a_port_that_passes_exactly_through_another_is_seen_by_the_sweep_and_not_by_a_point_test) {
  const double dt = 1.0 / 60.0;
  const double vRel = 7600.0;                       // m/s, R67's own figure
  const double travel = vRel * dt;
  CHECK_NEAR(travel, 126.666, 0.01);                // 127 m per tick

  // The station's port stands still at the origin; the vessel's port starts
  // half the tick's travel before it and ends half after, so it passes EXACTLY
  // through it mid-tick.
  const dk::PortPose s0 = at(Vec3{0, 0, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
  const dk::PortPose v0 = at(Vec3{0, -travel * 0.5, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
  const dk::PortPose v1 = at(Vec3{0, travel * 0.5, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});

  const dk::Limits lim;
  // THE POINT TEST, WRITTEN OUT, so the claim is demonstrated rather than
  // asserted about code that does not exist.
  const double sepStart = (v0.posM - s0.posM).length();
  const double sepEnd = (v1.posM - s0.posM).length();
  CHECK(sepStart > lim.captureRadiusM);
  CHECK(sepEnd > lim.captureRadiusM);
  CHECK_NEAR(sepStart, 63.333, 0.01);
  CHECK_NEAR(sepEnd, 63.333, 0.01);
  // 63.3 m away at BOTH ends of the tick, 105 capture radii out, and exactly
  // coincident in between. A point-in-sphere test cannot see this.

  const dk::CaptureResult r = dk::sweptCapture(s0, s0, v0, v1, lim, dt);
  CHECK_NEAR(r.closestApproachM, 0.0, 1e-9);
  CHECK_NEAR(r.tFraction, 0.5 - lim.captureRadiusM / travel, 1e-6);
  // It DID see it, and it REFUSED, and the refusal is the right one: the ports
  // are facing each other and within the radius, and it is the SPEED that is
  // impossible. A latch here would be this project teaching a player that
  // closing speed does not matter.
  CHECK(!r.captured);
  CHECK(std::string(r.note) == "no capture: closing too fast to latch");
  CHECK_NEAR(r.closingMS, vRel, 1e-6);
}

// =============================================================================
// THE FLOWN CASE. PH-154 flew a rendezvous to Anchorage and ended 108.87 m out
// at 0.23133 m/s relative. That is the arrival this has to accept, so it is the
// arrival it is given, at the speed that was actually measured.
// =============================================================================
TEST(the_rendezvous_this_project_actually_flew_captures) {
  const double dt = 1.0 / 60.0;
  const double closing = 0.23133;                   // PH-154's measured figure
  const double step = closing * dt;
  CHECK_NEAR(step, 0.003856, 1e-6);                 // 3.9 mm per tick

  const dk::Limits lim;
  const dk::PortPose s = at(Vec3{0, 0, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
  // Approaching along the station port's face axis, arriving just outside the
  // capture radius and crossing it during the tick.
  const double y0 = lim.captureRadiusM + step * 0.25;
  const dk::PortPose v0 = at(Vec3{0, y0, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
  const dk::PortPose v1 = at(Vec3{0, y0 - step, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});

  const dk::CaptureResult r = dk::sweptCapture(s, s, v0, v1, lim, dt);
  CHECK(r.captured);
  CHECK(std::string(r.note) == "captured");
  CHECK_NEAR(r.closingMS, closing, 1e-9);
  CHECK_NEAR(r.coneErrorRad, 0.0, 1e-12);
  // It latched at the instant it crossed the radius, a quarter of the way in,
  // and not at the end of the tick.
  CHECK_NEAR(r.tFraction, 0.25, 1e-9);
  CHECK_NEAR(r.separationM, lim.captureRadiusM, 1e-9);

  // AND THE FIXTURE COULD FAIL: start it a whole radius further out and the
  // same tick does not reach.
  const dk::PortPose w0 = at(Vec3{0, y0 + lim.captureRadiusM, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
  const dk::PortPose w1 = at(Vec3{0, y0 + lim.captureRadiusM - step, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
  const dk::CaptureResult miss = dk::sweptCapture(s, s, w0, w1, lim, dt);
  CHECK(!miss.captured);
  CHECK(std::string(miss.note)
        == "no capture: the ports never came within the capture radius");
}

// =============================================================================
// EACH REFUSAL BY NAME, and each one provoked by changing exactly one thing
// about the flight above.
// =============================================================================
TEST(each_way_a_capture_can_fail_says_which_way_it_failed) {
  const double dt = 1.0 / 60.0;
  const dk::Limits lim;
  const dk::PortPose s = at(Vec3{0, 0, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
  const double step = 0.23133 * dt;
  const double y0 = lim.captureRadiusM + step * 0.25;

  // 1. MISSED, laterally. Same speed, same axis, offset by two radii.
  {
    const Vec3 off{2.0 * lim.captureRadiusM, 0, 0};
    const dk::PortPose v0 = at(Vec3{0, y0, 0} + off, Vec3{0, -1, 0}, Vec3{1, 0, 0});
    const dk::PortPose v1 = at(Vec3{0, y0 - step, 0} + off, Vec3{0, -1, 0}, Vec3{1, 0, 0});
    const dk::CaptureResult r = dk::sweptCapture(s, s, v0, v1, lim, dt);
    CHECK(!r.captured);
    CHECK(std::string(r.note)
          == "no capture: the ports never came within the capture radius");
    // and the refusal carries the number a screen would want to show. It is
    // NOT the lateral offset: the port is still 0.597 m short along the mating
    // axis at the end of the tick, so the closest approach is the hypotenuse.
    // Derived here rather than pinned, because a pinned 1.34 would be a number
    // nobody could check, and the first version of this line asserted the
    // lateral offset alone and was wrong by 0.14 m.
    const double yEnd = y0 - step;
    const double expect = std::sqrt(4.0 * lim.captureRadiusM * lim.captureRadiusM
                                    + yEnd * yEnd);
    CHECK_NEAR(r.closestApproachM, expect, 1e-9);
    CHECK(r.closestApproachM > 2.0 * lim.captureRadiusM);
  }

  // 2. FACING THE WRONG WAY. Inside the radius, arriving slowly, and pointing
  //    the SAME way as the station's port instead of back at it, which is a
  //    180 degree cone error against a 30 degree cone.
  {
    const dk::PortPose v0 = at(Vec3{0, y0, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
    const dk::PortPose v1 = at(Vec3{0, y0 - step, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
    const dk::CaptureResult r = dk::sweptCapture(s, s, v0, v1, lim, dt);
    CHECK(!r.captured);
    CHECK(std::string(r.note) == "no capture: the ports are not facing each other");
    CHECK_NEAR(r.coneErrorRad * kDeg, 180.0, 1e-9);
  }

  // 3. THE CONE IS WHERE IT SAYS IT IS, and that is a two-sided claim: inside
  //    it captures, outside it does not, and the two cases are one degree
  //    apart. A gate proven only on the far side of itself is a gate that has
  //    never been seen to hold.
  for (int i = 0; i < 2; ++i) {
    const double tiltDeg = (i == 0) ? 29.0 : 31.0;
    const double t = tiltDeg / kDeg;
    const Vec3 face{std::sin(t), -std::cos(t), 0.0};
    const dk::PortPose v0 = at(Vec3{0, y0, 0}, face, Vec3{1, 0, 0});
    const dk::PortPose v1 = at(Vec3{0, y0 - step, 0}, face, Vec3{1, 0, 0});
    const dk::CaptureResult r = dk::sweptCapture(s, s, v0, v1, lim, dt);
    CHECK_NEAR(r.coneErrorRad * kDeg, tiltDeg, 1e-9);
    CHECK(r.captured == (i == 0));
    if (i == 1)
      CHECK(std::string(r.note) == "no capture: the ports are not facing each other");
  }

  // 4. TOO FAST, and the boundary is likewise two-sided: 1.99 m/s latches,
  //    2.01 does not, aimed identically.
  for (int i = 0; i < 2; ++i) {
    const double vRel = (i == 0) ? 1.99 : 2.01;
    const double stp = vRel * dt;
    const double yy = lim.captureRadiusM + stp * 0.25;
    const dk::PortPose v0 = at(Vec3{0, yy, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
    const dk::PortPose v1 = at(Vec3{0, yy - stp, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
    const dk::CaptureResult r = dk::sweptCapture(s, s, v0, v1, lim, dt);
    CHECK_NEAR(r.closingMS, vRel, 1e-9);
    CHECK(r.captured == (i == 0));
    if (i == 1)
      CHECK(std::string(r.note) == "no capture: closing too fast to latch");
  }
}

// =============================================================================
// BOTH PORTS MOVING, which is what D-014 made the normal case: the station is
// genuinely in orbit, so a capture is between two things travelling at 7.6 km/s
// that happen to be nearly stationary WITH RESPECT TO EACH OTHER.
// =============================================================================
TEST(capture_is_between_two_moving_ports_and_only_the_relative_motion_matters) {
  const double dt = 1.0 / 60.0;
  const dk::Limits lim;
  const double orbitalMS = 7600.0;                  // both of them, together
  const Vec3 carry{orbitalMS * dt, 0, 0};
  const double closing = 0.23133;
  const double step = closing * dt;
  const double y0 = lim.captureRadiusM + step * 0.25;

  const dk::PortPose s0 = at(Vec3{0, 0, 0}, Vec3{0, 1, 0}, Vec3{1, 0, 0});
  const dk::PortPose s1 = at(carry, Vec3{0, 1, 0}, Vec3{1, 0, 0});
  const dk::PortPose v0 = at(Vec3{0, y0, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0});
  const dk::PortPose v1 = at(Vec3{0, y0 - step, 0} + carry, Vec3{0, -1, 0}, Vec3{1, 0, 0});

  const dk::CaptureResult r = dk::sweptCapture(s0, s1, v0, v1, lim, dt);
  CHECK(r.captured);
  // The 7.6 km/s of common motion is INVISIBLE to the test: the closing speed
  // and the capture instant are bit-identical to the case where both are at
  // rest, which is the property that makes this usable in an orbiting frame.
  const dk::CaptureResult still = dk::sweptCapture(
      s0, s0, v0, at(Vec3{0, y0 - step, 0}, Vec3{0, -1, 0}, Vec3{1, 0, 0}), lim, dt);
  CHECK(r.closingMS == still.closingMS);
  CHECK(r.tFraction == still.tFraction);
  CHECK_NEAR(r.closingMS, closing, 1e-9);
}

// =============================================================================
// THE JOIN, against the frames the asset lane measured off the shipped bytes.
//
// This is the half that decides where the vessel ENDS UP, and it is checked by
// closing the loop rather than by inspecting a matrix: mate, then place the
// vessel's port using the mated pose, then assert it lands on the station's
// port. A sign error anywhere in the construction fails that.
// =============================================================================
TEST(a_mated_vessel_puts_its_own_port_exactly_on_the_stations) {
  // The station itself is somewhere arbitrary and pointed somewhere arbitrary,
  // so nothing in this test can pass by sitting at an origin.
  const Vec3 stationOrigin{1.0e6, -2.5e5, 3.75e5};
  const Vec3 stationForward = orbital::normalized(Vec3{0.3, 0.8, -0.5});
  const Vec3 stationRight = orbital::normalized(Vec3{0.9, -0.1, 0.2});
  const dk::PortPose sPort =
      dk::portAt(stationOrigin, stationForward, stationRight, stationSocketLocal());
  const dk::PortPose vLocal = vesselSocketLocal();

  const dk::MatedPose m = dk::matedPose(sPort, vLocal);

  // The attitude it produced is a real attitude: orthonormal, right-handed.
  CHECK_NEAR(m.forward.length(), 1.0, 1e-12);
  CHECK_NEAR(m.right.length(), 1.0, 1e-12);
  CHECK_NEAR(m.forward.dot(m.right), 0.0, 1e-12);

  // THE LOOP CLOSES. Place the vessel's port from the mated pose and it lands
  // on the station's port, to the millimetre and well past it.
  const dk::PortPose placed = dk::portAt(m.originM, m.forward, m.right, vLocal);
  CHECK_NEAR((placed.posM - sPort.posM).length(), 0.0, 1e-9);
  // ... and pointing back at it, which is the one minus sign docking is about.
  CHECK_NEAR(placed.faceAxis.dot(sPort.faceAxis), -1.0, 1e-12);
  CHECK_NEAR(dk::coneErrorRad(placed.faceAxis, sPort.faceAxis), 0.0, 1e-6);
  // ... and clocked to the station's roll.
  CHECK_NEAR(placed.rollAxis.dot(sPort.rollAxis), 1.0, 1e-12);

  // AND A CAPTURE TEST RUN ON THE MATED POSE AGREES: zero separation, zero cone
  // error, zero closing speed. The two halves of this header are consistent
  // with each other, which is not automatic and is the thing most likely to rot.
  const dk::Limits lim;
  const dk::CaptureResult r = dk::sweptCapture(sPort, sPort, placed, placed, lim,
                                               1.0 / 60.0);
  CHECK(r.captured);
  CHECK_NEAR(r.separationM, 0.0, 1e-9);
  CHECK_NEAR(r.closingMS, 0.0, 1e-12);

  // The vessel's origin is 0.30 m back from its port along the mating axis,
  // which is the port's own local offset and is the number the asset lane
  // published. Asserted as a DISTANCE, so it fails if the offset is dropped
  // (which is GP-142's shape: `off: 0` written as a literal, invisible because
  // the fixture used zero).
  CHECK_NEAR((m.originM - sPort.posM).length(), 0.30, 1e-9);
}

// -----------------------------------------------------------------------------
// AND THE STATION'S OWN SOCKET FACES OUT OF ITS HULL. The asset lane found this
// frame shipped 180 degrees wrong, facing back INTO the station, so it accepted
// a vessel arriving from inside. Nothing caught it because the asset gate
// compares socket POSITIONS and has never had an opinion about AXES. It is
// checked here, in physics, because the consequence is a physics one.
// -----------------------------------------------------------------------------
TEST(the_stations_dock_socket_points_away_from_the_station_and_not_into_it) {
  const dk::PortPose local = stationSocketLocal();
  // The socket sits 30.40 m out along the station's own +X, and its face axis
  // is +X: away from the hull. If the axis were negated it would point at the
  // station's centre, and the dot product below is the whole test.
  CHECK(local.posM.x > 0.0);
  CHECK(local.faceAxis.dot(orbital::normalized(local.posM)) > 0.0);
  CHECK_NEAR(local.faceAxis.dot(orbital::normalized(Vec3{1, 0, 0})), 1.0, 1e-12);
  // and the roll axis really is perpendicular to it, which `applyTriadRotation`
  // would otherwise quietly fix with a Gram-Schmidt and hide.
  CHECK_NEAR(local.faceAxis.dot(local.rollAxis), 0.0, 1e-12);

  const dk::PortPose v = vesselSocketLocal();
  CHECK_NEAR(v.faceAxis.dot(v.rollAxis), 0.0, 1e-12);
  // The vessel's port faces along +Y, which is the stack axis toward the nose
  // in `flight.h`'s convention, so a port on the top node points where the nose
  // points and a docking approach is flown NOSE FIRST.
  CHECK_NEAR(v.faceAxis.dot(orbital::normalized(Vec3{0, 1, 0})), 1.0, 1e-12);
}

// =============================================================================
// PH-362. THE LIVE ENVELOPE VERDICT: WHAT THE DOCK BUTTON IS ALLOWED TO SAY.
//
// D-015's manual rung. `sweptCapture` answers a question about a tick that has
// already happened; a button has to answer one about the instant it is pressed,
// on a sim that may be paused, and it has to name the gate that is shut rather
// than return a boolean. These are the edges: exactly at the radius, one
// micrometre outside it, over the speed limit, pointing away, already latched,
// and asked about a vessel's own port.
//
// WHAT WOULD MAKE THIS VACUOUS, named first: a `candidate` that returned
// `OutOfRange` for everything would pass a suite that only ever checked
// refusals. So every refusal below is paired with the arrangement that DOES
// latch, differing in exactly the one quantity under test.
// -----------------------------------------------------------------------------

// Two ports face to face, `gapM` apart along X, closing at `closeMS`.
// `mine` faces +X and sits at the origin; `theirs` faces -X, which is the
// antiparallel pair `coneErrorRad` returns 0 for.
struct Pair {
  dk::PortPose mine, theirs;
  Vec3 relVel{0, 0, 0};
};
static Pair facing(double gapM, double closeMS) {
  Pair p;
  p.mine = at(Vec3{0, 0, 0}, Vec3{1, 0, 0}, Vec3{0, 1, 0});
  p.theirs = at(Vec3{gapM, 0, 0}, Vec3{-1, 0, 0}, Vec3{0, 1, 0});
  p.relVel = Vec3{closeMS, 0, 0};   // toward `theirs`, i.e. closing
  return p;
}

TEST(the_button_is_offered_inside_the_envelope_and_the_numbers_read_true) {
  const dk::Limits lim;
  const Pair p = facing(0.40, 0.25);
  const dk::Candidate c =
      dk::candidate(p.mine, p.theirs, p.relVel, lim, false, false);
  CHECK(c.available);
  CHECK(c.verdict == dk::Verdict::Available);
  CHECK_NEAR(c.separationM, 0.40, 1e-12);
  // POSITIVE IS CLOSING, and that sign is the whole reason this exists beside
  // `CaptureResult::closingMS`, which is a magnitude.
  CHECK_NEAR(c.closingMS, 0.25, 1e-12);
  CHECK_NEAR(c.coneErrorRad, 0.0, 1e-12);
}

TEST(drifting_away_reads_as_a_negative_rate_and_still_latches) {
  const dk::Limits lim;
  // Inside the envelope but LEAVING. It is still a legal capture -- a magnet
  // does not ask which way you are going, only how fast -- and the screen gets
  // the minus sign it needs to say "drifting away".
  const Pair p = facing(0.40, -0.25);
  const dk::Candidate c =
      dk::candidate(p.mine, p.theirs, p.relVel, lim, false, false);
  CHECK(c.available);
  CHECK(c.closingMS < 0.0);
  CHECK_NEAR(c.closingMS, -0.25, 1e-12);
}

TEST(the_capture_radius_is_the_edge_and_the_edge_is_inclusive) {
  const dk::Limits lim;
  // EXACTLY at the radius: offered. The gate is `>`, so the boundary belongs to
  // the capture, which is the same convention `sweptCapture` uses (it solves
  // for the crossing of |d| == R and treats that crossing as contact).
  const Pair edge = facing(lim.captureRadiusM, 0.1);
  const dk::Candidate on =
      dk::candidate(edge.mine, edge.theirs, edge.relVel, lim, false, false);
  CHECK(on.available);
  CHECK_NEAR(on.separationM, 0.60, 1e-12);

  // One micrometre outside it: refused, and it says RANGE rather than a
  // boolean, because "it did not dock" is not a sentence a player can act on.
  const Pair off = facing(lim.captureRadiusM + 1e-6, 0.1);
  const dk::Candidate out =
      dk::candidate(off.mine, off.theirs, off.relVel, lim, false, false);
  CHECK(!out.available);
  CHECK(out.verdict == dk::Verdict::OutOfRange);
  // AND THE NUMBERS ARE STILL PUBLISHED. A refusal that reported nothing would
  // leave a screen unable to say how much closer to fly.
  CHECK_NEAR(out.separationM, 0.600001, 1e-9);
  CHECK_NEAR(out.closingMS, 0.1, 1e-12);
}

TEST(over_the_closing_limit_says_too_fast_and_not_out_of_range) {
  const dk::Limits lim;
  CHECK_NEAR(lim.maxClosingMS, 2.0, 1e-12);
  // Just under: latches.
  const Pair slow = facing(0.30, lim.maxClosingMS - 1e-9);
  CHECK(dk::candidate(slow.mine, slow.theirs, slow.relVel, lim, false, false)
            .available);
  // Just over: the ONE sentence that made this worth building. The bug this
  // guards is the bridge's own (`reasonOf`): a too-fast arrival reported at the
  // sphere boundary and got classified as a range miss.
  const Pair fast = facing(0.30, lim.maxClosingMS + 1e-6);
  const dk::Candidate c =
      dk::candidate(fast.mine, fast.theirs, fast.relVel, lim, false, false);
  CHECK(!c.available);
  CHECK(c.verdict == dk::Verdict::TooFast);
  CHECK(c.separationM < lim.captureRadiusM);   // it is NOT a range miss

  // AND THE GATE IS ON THE MAGNITUDE, NOT THE PROJECTION. A port sliding
  // sideways through the envelope at 8 m/s has a signed closing rate of zero
  // and must not latch; gating on the projection would have latched it.
  const Pair sideways = facing(0.30, 0.0);
  const dk::Candidate s = dk::candidate(sideways.mine, sideways.theirs,
                                        Vec3{0, 8.0, 0}, lim, false, false);
  CHECK(!s.available);
  CHECK(s.verdict == dk::Verdict::TooFast);
  CHECK_NEAR(s.closingMS, 0.0, 1e-12);
}

TEST(a_port_pointing_the_wrong_way_is_told_about_the_pointing) {
  const dk::Limits lim;
  // Both faces +X: the target's port points the same way as ours, which is
  // 180 degrees from mated. Inside the radius and dead slow, so the ONLY thing
  // wrong is the attitude.
  const dk::PortPose mine = at(Vec3{0, 0, 0}, Vec3{1, 0, 0}, Vec3{0, 1, 0});
  dk::PortPose theirs = at(Vec3{0.20, 0, 0}, Vec3{1, 0, 0}, Vec3{0, 1, 0});
  const dk::Candidate c =
      dk::candidate(mine, theirs, Vec3{0.05, 0, 0}, lim, false, false);
  CHECK(!c.available);
  CHECK(c.verdict == dk::Verdict::NotFacing);
  CHECK_NEAR(c.coneErrorRad * kDeg, 180.0, 1e-9);

  // The cone edge, both sides of it, so the 30 degrees is measured rather than
  // assumed. `coneErrorRad` is the angle from ANTIPARALLEL, so a face rotated
  // by 29 degrees off -X is 29 degrees of error.
  const double edges[2] = {29.0, 31.0};
  for (const double deg : edges) {
    const double a = orbital::kPi - deg / kDeg;
    theirs = at(Vec3{0.20, 0, 0}, Vec3{std::cos(a), std::sin(a), 0},
                Vec3{0, 0, 1});
    const dk::Candidate e =
        dk::candidate(mine, theirs, Vec3{0.05, 0, 0}, lim, false, false);
    CHECK_NEAR(e.coneErrorRad * kDeg, deg, 1e-9);
    CHECK(e.available == (deg < 30.0));
    if (!e.available) CHECK(e.verdict == dk::Verdict::NotFacing);
  }
}

TEST(a_vessel_may_not_dock_to_itself_and_that_beats_every_other_verdict) {
  const dk::Limits lim;
  // A vessel's own port against itself: perfectly in range, perfectly still.
  // Geometry alone would call this an ideal capture, which is exactly why the
  // identity rule cannot be left to geometry.
  const dk::PortPose p = at(Vec3{0, 0, 0}, Vec3{1, 0, 0}, Vec3{0, 1, 0});
  const dk::Candidate self =
      dk::candidate(p, p, Vec3{0, 0, 0}, lim, false, true);
  CHECK(!self.available);
  CHECK(self.verdict == dk::Verdict::SelfDock);
  // And it wins over the range refusal too, so a client cannot be told "fly
  // closer" about a vessel it is already inside.
  const Pair far = facing(500.0, 0.0);
  const dk::Candidate farSelf =
      dk::candidate(far.mine, far.theirs, far.relVel, lim, false, true);
  CHECK(farSelf.verdict == dk::Verdict::SelfDock);

  // THE CONTROL: the identical geometry with two different vessels latches.
  CHECK(dk::candidate(p, at(Vec3{0, 0, 0}, Vec3{-1, 0, 0}, Vec3{0, 1, 0}),
                      Vec3{0, 0, 0}, lim, false, false)
            .available);
}

TEST(an_already_latched_vessel_is_refused_rather_than_latched_twice) {
  const dk::Limits lim;
  const Pair p = facing(0.0, 0.0);          // mated: 0 m, 0 m/s
  const dk::Candidate again =
      dk::candidate(p.mine, p.theirs, p.relVel, lim, true, false);
  CHECK(!again.available);
  CHECK(again.verdict == dk::Verdict::AlreadyDocked);
  // The control, one bool apart.
  CHECK(dk::candidate(p.mine, p.theirs, p.relVel, lim, false, false).available);
}

TEST(a_vessel_with_no_port_can_never_be_offered_a_dock) {
  // "No port" is not a pose, so it cannot be a geometric refusal: it is the
  // ABSENCE of the part, and the authority on that is the catalogue. This is
  // the assertion the client's own gate is built on -- a design whose parts
  // contain no `DockingPort` never reaches `candidate` at all -- and it is here
  // so the two halves of D-015's uniform rule ("a vessel can dock if its design
  // contains a port") are checked against one fact.
  const vessel::PartDef* port =
      vessel::catalogue().get(vessel::parts::DockingPort);
  CHECK(port != nullptr);
  CHECK(port->dockCaptureRadiusM > 0.0);
  // and EVERY other part in the catalogue carries a zero radius, so "has a
  // port" is decidable off the part table with no second list to maintain.
  int withPort = 0;
  for (const vessel::PartDef& d : vessel::catalogue().all()) {
    if (d.dockCaptureRadiusM > 0.0) withPort += 1;
  }
  CHECK(withPort == 1);
}

// =============================================================================
// PH-363. LETTING GO.
// =============================================================================
TEST(a_release_pushes_straight_out_of_the_port_and_clears_the_envelope) {
  const dk::Limits lim;
  // Latched to a host travelling at orbital speed. The release must be relative
  // to the HOST: a vessel that came off at 0.20 m/s in the BODY frame would be
  // 7.8 km/s adrift, which is the same class of defect `CarrierRide.restAt`
  // exists for.
  const Vec3 hostVel{0.0, 7800.0, 0.0};
  const dk::PortPose myPort = at(Vec3{10, 0, 0}, Vec3{1, 0, 0}, Vec3{0, 1, 0});
  const Vec3 v = dk::releaseVelocity(myPort, hostVel, 0.0);   // 0 -> the default
  CHECK_NEAR(v.x - hostVel.x, dk::kReleaseSepMS, 1e-12);
  CHECK_NEAR(v.y, hostVel.y, 1e-12);
  CHECK_NEAR(v.z, hostVel.z, 1e-12);
  CHECK_NEAR(dk::kReleaseSepMS, 0.20, 1e-12);

  // AND IT ACTUALLY GETS OUT. Coasting at the release rate, the separation
  // passes the capture radius in 3.0 s, which is the derivation in the header
  // checked rather than restated.
  const double tClearS = lim.captureRadiusM / dk::kReleaseSepMS;
  CHECK_NEAR(tClearS, 3.0, 1e-12);
  CHECK(dk::kReleaseSepMS * 10.0 <= lim.maxClosingMS);  // an order below the limit

  // A caller may ask for its own rate, and the direction is still the port's.
  const dk::PortPose sideways = at(Vec3{0, 0, 3}, Vec3{0, 0, -1}, Vec3{1, 0, 0});
  const Vec3 w = dk::releaseVelocity(sideways, Vec3{0, 0, 0}, 0.5);
  CHECK_NEAR(w.z, -0.5, 1e-12);
  CHECK_NEAR(w.x, 0.0, 1e-12);
}

TEST(the_manual_dwell_is_why_two_metres_per_second_is_the_limit) {
  // The number `Limits::maxClosingMS` carries is a POLICY, and this is the
  // physical fact that makes it the right policy for a HAND FLOWN dock rather
  // than an arbitrary round number.
  //
  // A head-on pass spends 2R/v inside the capture sphere. At the limit that is
  // 0.60 s, which is about twice a deliberate reaction (250 ms) and therefore
  // a window a player can actually hit. At 10 m/s it is 0.12 s, which is UNDER
  // one reaction time: the button would light and go out before a hand could
  // answer it. The limit is the speed at which manual docking stops being a
  // thing a human can do, and it is also the speed above which `sweptCapture`
  // refuses. One number, two arguments, no drift.
  //
  // THE FIRST DRAFT OF THIS TEST CLAIMED 0.12 s WAS "SHORTER THAN A FRAME AT
  // 30 FPS" AND THE ASSERTION FAILED, which is the reason the arithmetic is
  // asserted rather than only written in the comment: 0.12 s is 3.6 frames.
  // The conclusion survived; the justification did not, and only the check
  // knew.
  const dk::Limits lim;
  const double kReactionS = 0.25;
  const double dwellAtLimitS = 2.0 * lim.captureRadiusM / lim.maxClosingMS;
  CHECK_NEAR(dwellAtLimitS, 0.60, 1e-12);
  CHECK(dwellAtLimitS > 2.0 * kReactionS);
  const double dwellAtTenS = 2.0 * lim.captureRadiusM / 10.0;
  CHECK_NEAR(dwellAtTenS, 0.12, 1e-12);
  CHECK(dwellAtTenS < kReactionS);
  // And the rendezvous this project actually flew clears the limit by nearly an
  // order of magnitude, so the gate refuses mistakes and not the flight plan.
  CHECK(0.23133 * 8.0 < lim.maxClosingMS);
}
