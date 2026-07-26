#pragma once
// =============================================================================
// surface_walk.h — headless "surface-walk" data layer (Phase-3 character mode).
//
// The math/queries the UE WHOLE-PLANET PLAYER CONTROLLER binds to when the
// player is a CHARACTER standing / walking ON a body's surface (distinct from
// the orbital vessel path in sim_world.h). It ties together, deterministically:
//
//   * a geodetic player state (lat, lon, heading, eyeHeight)  <->  a 64-bit
//     UniverseCoord in the body frame (FrameId == bodyId+1, the cubed-sphere
//     convention generateQuadMesh / makeObserverLatLonAlt already use),
//   * radial UP and centre-pointing GRAVITY at the player,
//   * the DESIGNED terrain surface under the player (biome.h's
//     SampleDesignedTerrainHeight — the shaped relief, not the raw heightfield),
//   * GREAT-CIRCLE movement along the surface from a heading (forward / right),
//     snapping the player back onto the designed surface each step,
//   * FLOATING-ORIGIN integration: as the walker travels, drive a
//     FloatingOrigin rebase when the engine-space offset exceeds a threshold and
//     surface a consumeRebased() event so the renderer / TerrainStreamer re-anchor
//     (TerrainStreamer::onOriginRebased),
//   * the TerrainStreamer observer (a UniverseCoord) that FOLLOWS the walker so
//     the resident chunk set streams around the character, and
//   * LOCAL queries for the UE layer — biome under / around the player, surface
//     hardness, and nearby deposits in the player's quad
//     (BiomeResourceField::QueryRegionDeposits): "what's around me".
//
// DETERMINISM (WG-6 discipline, inherited): every query is a PURE function of
// (BodyParams, player state[, voxel edits]). Movement is a closed-form great-
// circle step, and the terrain snap routes through surface_field.h's ONE
// surfaceHeight (WG-21) — the SAME surface the mesh, collision, and deposit pass
// read (designed base − voxel-derived lowering) — so a walk reproduces bit-for-bit
// and the character always sits on the same shaped terrain the renderer draws AND
// drops into its own digs (no more hovering over a hole). The undug snap is
// bit-identical to the designed base (surfaceHeight with no lowering == baseHeight
// == sampleDesignedHeight), so an edit-free walk is unchanged.
//
// Header-only C++17. Consumes cubed_sphere.h / biome.h / terrain_stream.h /
// surface_field.h / floating_origin.h READ-ONLY. No UE, no rendering, no physics —
// the isolation harness the UE character controller mirrors.
// =============================================================================
#include <cstdint>
#include <cmath>
#include <vector>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/floating_origin.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/terrain_stream.h"
#include "of/voxel_terrain.h"
#include "of/surface_field.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — SurfaceObserver: the geodetic player-on-a-body state + its queries.
//
// State is geodetic (lat, lon, heading, eyeHeight); everything else is derived.
// The body frame is FrameId == bodyId+1 (the generateQuadMesh convention), so the
// UniverseCoords here drop straight into TerrainStreamer / BiomeResourceField.
// =============================================================================
class SurfaceObserver {
 public:
  // Construct the walker at a geodetic site. `headingRad` is the compass bearing
  // (0 = toward +lat / "north", increasing clockwise toward +lon / "east");
  // `eyeHeightM` lifts the eye above the terrain (the camera height). The engine /
  // floating-origin rebase threshold defaults to the SimWorld value (4 km).
  SurfaceObserver(BodyParams body, double latRad, double lonRad,
                  double headingRad = 0.0, double eyeHeightM = 1.7,
                  double rebaseThresholdM = 4000.0)
      : body_(std::move(body)),
        lat_(latRad),
        lon_(lonRad),
        heading_(headingRad),
        eyeHeight_(eyeHeightM),
        origin_(rebaseThresholdM) {
    // Snap the floating origin onto the eye position at construction so engine
    // coords start near zero (mirrors SimWorld::placeOnForgeSurface force-rebase).
    origin_.maybeRebase(eyePositionUniverse());
    consumeRebased();  // construction snap is not a "moved" event the renderer reacts to
  }

  // ---- Accessors -----------------------------------------------------------
  const BodyParams& body() const { return body_; }
  double lat() const { return lat_; }
  double lon() const { return lon_; }
  double heading() const { return heading_; }
  double eyeHeight() const { return eyeHeight_; }
  void setHeading(double headingRad) { heading_ = headingRad; }
  void setEyeHeight(double m) { eyeHeight_ = m; }

  // Bind the player's VOXEL destruction diff (WG-21) so the surface snap drops
  // into the player's own digs: surfaceHeightM() reads the oracle's ONE surface
  // (designed base − voxel-derived lowering) instead of the bare designed base.
  // Null (the default) = the undug designed base, bit-identical to before. The
  // pointer is borrowed (the UE layer owns the VoxelEdits); pass nullptr to unbind.
  void setVoxelEdits(const VoxelEdits* edits) { voxels_ = edits; }
  const VoxelEdits* voxelEdits() const { return voxels_; }

  // Body frame id for this walker's UniverseCoords (== bodyId+1).
  FrameId frame() const { return static_cast<FrameId>(body_.bodyId + 1); }

  // ---- Surface geometry ----------------------------------------------------

  // Radial unit direction (the surface point's outward direction == geographic
  // local UP) at the player's lat/lon.
  Vec3 dir() const { return latLonToDir(lat_, lon_); }

  // Local UP (radial, outward) — the surface normal the UE controller aligns the
  // character capsule to. (Designed terrain has slope; this is the body-radial up,
  // the gravity-opposing reference; per-vertex mesh normals carry the micro-slope.)
  Vec3 localUp() const { return dir(); }
  Vec3 localUp(const Vec3& d) const {
    const double l = d.length();
    return (l > 0.0) ? Vec3(d.x / l, d.y / l, d.z / l) : Vec3(0, 1, 0);
  }

  // Gravity direction: toward the body centre (== -localUp). Unit vector.
  Vec3 gravityDir() const { const Vec3 u = dir(); return Vec3(-u.x, -u.y, -u.z); }

  // Gravitational acceleration magnitude at the player (m/s^2), Newtonian point
  // mass: g = mu / r^2, with mu read from the BODY (BodyParams::muM3S2, DW-18).
  //
  // WAS: a uniform-sphere density model, (4/3)*pi*G*rho*R at rho = 3500, which
  // is where Forge's 0.587 m/s^2 and its 4.8 second jump came from. That made
  // gravity a SECOND authority disagreeing with of::orbital's kForgeMu (9.81
  // m/s^2 at the surface) about the same planet: the walker fell at one g and
  // the propagator orbited at another, sixteen times apart. Same shape of defect
  // as the five surfaces, so it is resolved the same way: one authority, on the
  // body, and everybody reads it.
  //
  // The density fallback survives ONLY for a body with no mu set (muM3S2 == 0),
  // so a caller who forgets still gets a finite, body-scaled number rather than
  // zero gravity.
  double gravityAccel() const {
    const double r = surfaceRadiusM();
    if (body_.muM3S2 > 0.0 && r > 0.0) return body_.muM3S2 / (r * r);
    // g = (4/3) * pi * G * rho * R  for a uniform sphere at the surface.
    constexpr double kG = 6.67430e-11;       // gravitational constant
    constexpr double kRho = 3500.0;          // mean rocky density (kg/m^3)
    return (4.0 / 3.0) * 3.14159265358979323846 * kG * kRho * r;
  }
  // Explicit-mu variant for callers that carry the body's GM (mu = G*M).
  double gravityAccel(double mu) const {
    const double r = surfaceRadiusM();
    return (r > 0.0) ? mu / (r * r) : 0.0;
  }

  // The ONE surface relief (metres above the datum) under the player (WG-21):
  // surface_field.h's surfaceHeight = designed base − voxel-derived lowering,
  // bedrock-clamped. With no voxel edits bound this is exactly the designed base
  // (SampleDesignedTerrainHeight), bit-for-bit — so an undug walk is unchanged;
  // with edits bound the player stands on / drops into their own digs.
  double surfaceHeightM() const {
    const Vec3 d = dir();
    return voxels_ ? surfaceHeight(body_, d, *voxels_)
                   : baseHeight(body_, d);  // == sampleDesignedHeight(body_, d)
  }
  // Absolute surface radius (body radius + designed relief) under the player.
  double surfaceRadiusM() const { return body_.radiusM + surfaceHeightM(); }

  // The player's FEET position (on the designed surface) as a body-frame coord.
  UniverseCoord footPositionUniverse() const {
    return UniverseCoord(dir() * surfaceRadiusM(), frame());
  }
  // The player's EYE position (feet + eyeHeight, radially up) as a body-frame coord.
  UniverseCoord eyePositionUniverse() const {
    return UniverseCoord(dir() * (surfaceRadiusM() + eyeHeight_), frame());
  }

  // ---- Movement (great-circle step along the surface) ----------------------
  //
  // Move forwardM along the current heading and rightM perpendicular to it,
  // both as great-circle arc lengths on the body. Closed-form + deterministic:
  // we rotate the dir/heading frame by the arc angle = distance / surfaceRadius,
  // then re-derive (lat, lon, heading) and re-snap to the designed surface
  // (eye = terrainHeight + eyeHeight). A floating-origin rebase may fire (consume
  // it via consumeRebased()).
  void move(double forwardM, double rightM) {
    // Build the local tangent frame at the current position.
    const Vec3 up = dir();                 // radial
    Vec3 north, east;
    tangentFrame(up, north, east);
    // Movement heading tangent: forward bearing + a right (east-of-forward) step.
    const Vec3 fwdTan = bearingTangent(north, east, heading_);
    const Vec3 rightTan = bearingTangent(north, east, heading_ + kHalfPi);

    // Compose the net tangential step direction + arc length.
    Vec3 stepTan(fwdTan.x * forwardM + rightTan.x * rightM,
                 fwdTan.y * forwardM + rightTan.y * rightM,
                 fwdTan.z * forwardM + rightTan.z * rightM);
    const double arcLenM = stepTan.length();
    if (arcLenM > 0.0) {
      const Vec3 moveTan(stepTan.x / arcLenM, stepTan.y / arcLenM,
                         stepTan.z / arcLenM);
      // Rotate `up` toward `moveTan` by theta = arcLen / R (great-circle step).
      const double theta = arcLenM / surfaceRadiusM();
      const double c = std::cos(theta), s = std::sin(theta);
      const Vec3 newUp(up.x * c + moveTan.x * s, up.y * c + moveTan.y * s,
                       up.z * c + moveTan.z * s);
      const Vec3 nUp = normalize(newUp);
      // Re-derive geodetic lat/lon from the new radial direction.
      dirToLatLon(nUp, lat_, lon_);
      // Update heading: parallel-transport the bearing to the new point so a pure
      // forward walk keeps a stable course. We recompute the bearing of the moved
      // tangent at the NEW point and bias the original right-step into it.
      Vec3 nNorth, nEast;
      tangentFrame(nUp, nNorth, nEast);
      // The moved tangent, transported to the new point, is the new "forward".
      // Project the original combined step bearing onto the new tangent basis.
      const Vec3 newFwd = transportTangent(moveTan, up, nUp);
      heading_ = bearingOf(nNorth, nEast, newFwd);
    }

    // Snap onto the designed surface + drive the floating origin.
    origin_.maybeRebase(eyePositionUniverse());
  }

  // ---- Floating-origin integration -----------------------------------------

  const FloatingOrigin& floatingOrigin() const { return origin_; }
  int rebaseCount() const { return origin_.rebaseCount(); }

  // Engine-space (near-origin, double) position of the player's eye — what the
  // GPU / physics consume. Bounded by the rebase threshold after a rebase.
  Vec3 enginePosition() const { return origin_.toEngineD(eyePositionUniverse()); }
  Vec3f enginePositionF() const { return origin_.toEngine(eyePositionUniverse()); }

  // Did the last move(s) trigger a floating-origin rebase the renderer / terrain
  // must react to (re-anchor chunks via TerrainStreamer::onOriginRebased)? One-shot:
  // returns true once per rebase, then clears. The UE layer polls this each tick.
  bool consumeRebased() {
    const int now = origin_.rebaseCount();
    if (now != lastSeenRebase_) {
      lastSeenRebase_ = now;
      return true;
    }
    return false;
  }

  // ---- Terrain-stream binding ----------------------------------------------

  // The UniverseCoord to feed TerrainStreamer::updateStreaming so the resident
  // chunk set follows the walker. LOD runs on this 64-bit authority position
  // (terrain_stream.h §3.1), independent of the floating origin — so it is the
  // EYE coord in the body frame (above the designed surface).
  UniverseCoord makeStreamObserver() const { return eyePositionUniverse(); }

  // ---- Local queries ("what's around me") ----------------------------------

  // The biome directly under the player.
  Biome biomeHere() const { return biomeAt(body_, dir()); }

  // Surface hardness in [0,1] under the player (feeds footstep / dig physics).
  double hardnessHere() const { return hardnessForBiome(biomeHere()); }

  // The cube-quad key under the player at a given LOD depth (the region the
  // deposit query + chunk lookups use). Pure function of (dir, depth).
  FQuadKey quadHere(int depth) const {
    return quadKeyForDir(body_.bodyId, dir(), depth);
  }

  // Nearby deposits: those whose direction falls within the player's quad (at
  // `depth`) on `field`, padded by marginRad so nodes just over the quad edge are
  // still returned. Deterministic (pure angular containment over a pure quad key).
  std::vector<FDepositNode> nearbyDeposits(const BiomeResourceField& field,
                                           int depth = 8,
                                           double marginRad = 0.0) const {
    return field.QueryRegionDeposits(body_, quadHere(depth), marginRad);
  }

 private:
  static constexpr double kHalfPi = 1.57079632679489661923;

  static Vec3 normalize(const Vec3& v) {
    const double l = v.length();
    return (l > 0.0) ? Vec3(v.x / l, v.y / l, v.z / l) : Vec3(0, 1, 0);
  }

  // Build an orthonormal tangent basis (north, east) at radial `up`. North points
  // toward +lat (the pole), east toward +lon, both tangent to the sphere. At a
  // pole (degenerate) we fall back to a fixed basis so movement stays defined.
  static void tangentFrame(const Vec3& up, Vec3& north, Vec3& east) {
    // East = normalize(poleAxis x up); North = up x east. poleAxis = +Y.
    const Vec3 pole(0, 1, 0);
    Vec3 e(pole.y * up.z - pole.z * up.y, pole.z * up.x - pole.x * up.z,
           pole.x * up.y - pole.y * up.x);  // pole x up
    double el = e.length();
    if (el < 1e-12) {
      // At a pole: pick an arbitrary stable east (the +X meridian tangent).
      e = Vec3(1, 0, 0);
      el = 1.0;
    }
    east = Vec3(e.x / el, e.y / el, e.z / el);
    // North = up x east (so {east, north, up} is right-handed, north toward +lat).
    north = Vec3(up.y * east.z - up.z * east.y, up.z * east.x - up.x * east.z,
                 up.x * east.y - up.y * east.x);
  }

  // A unit tangent for a compass bearing (0 = north, +pi/2 = east).
  static Vec3 bearingTangent(const Vec3& north, const Vec3& east, double bearing) {
    const double c = std::cos(bearing), s = std::sin(bearing);
    return Vec3(north.x * c + east.x * s, north.y * c + east.y * s,
                north.z * c + east.z * s);
  }

  // Inverse: the compass bearing of a tangent vector in the (north, east) basis.
  static double bearingOf(const Vec3& north, const Vec3& east, const Vec3& tan) {
    const double n = tan.dot(north), e = tan.dot(east);
    return std::atan2(e, n);
  }

  // Parallel-transport a tangent vector from point `fromUp` to point `toUp` along
  // the great circle between them (rotate it by the same angle the up vector
  // turned). Keeps a forward walk on a stable geodesic course.
  static Vec3 transportTangent(const Vec3& tan, const Vec3& fromUp,
                               const Vec3& toUp) {
    // Rotation taking fromUp -> toUp (about their cross product). Apply to `tan`.
    Vec3 axis(fromUp.y * toUp.z - fromUp.z * toUp.y,
              fromUp.z * toUp.x - fromUp.x * toUp.z,
              fromUp.x * toUp.y - fromUp.y * toUp.x);
    const double al = axis.length();
    if (al < 1e-12) return tan;  // no rotation (same point)
    axis = Vec3(axis.x / al, axis.y / al, axis.z / al);
    double cosA = fromUp.dot(toUp);
    if (cosA > 1.0) cosA = 1.0;
    if (cosA < -1.0) cosA = -1.0;
    const double ang = std::acos(cosA);
    const double c = std::cos(ang), s = std::sin(ang);
    // Rodrigues' rotation of `tan` about `axis` by `ang`.
    const double dotAT = axis.dot(tan);
    const Vec3 cross(axis.y * tan.z - axis.z * tan.y,
                     axis.z * tan.x - axis.x * tan.z,
                     axis.x * tan.y - axis.y * tan.x);
    return Vec3(tan.x * c + cross.x * s + axis.x * dotAT * (1 - c),
                tan.y * c + cross.y * s + axis.y * dotAT * (1 - c),
                tan.z * c + cross.z * s + axis.z * dotAT * (1 - c));
  }

  // The cube-quad (faceId + quad path at `depth`) that contains a direction.
  // Mirrors the cubed_sphere lattice: pick the canonical face, find the (u,v) on
  // that face, map to the 2^depth x 2^depth quad grid. Pure function of the dir.
  static FQuadKey quadKeyForDir(uint32_t bodyId, const Vec3& d, int depth) {
    const int faceId = faceOfDir(d);
    const FaceBasis& b = faceBasis(faceId);
    // Project d onto the face: the face is at normal*1 + right*wu + up*wv (before
    // normalize), so the face-plane coords are (d.right / d.normal, d.up / d.normal)
    // in WARPED space; invert the tangent warp to get the lattice (u,v) in [-1,1].
    const double dn = d.dot(b.normal);
    const double dr = d.dot(b.right);
    const double du = d.dot(b.up);
    const double wu = (std::fabs(dn) > 1e-12) ? dr / dn : 0.0;  // warped u
    const double wv = (std::fabs(dn) > 1e-12) ? du / dn : 0.0;  // warped v
    const double u = unwarp(wu);  // face (u,v) in [-1,1]
    const double v = unwarp(wv);
    const double denom = static_cast<double>(uint64_t(1) << depth);
    auto toQuad = [&](double s) -> uint32_t {
      double t = (s + 1.0) * 0.5 * denom;  // [0, 2^depth]
      if (t < 0.0) t = 0.0;
      const double maxIdx = denom - 1.0;
      if (t > maxIdx) t = maxIdx;
      return static_cast<uint32_t>(t);
    };
    return FQuadKey{bodyId, faceId, depth, toQuad(u), toQuad(v)};
  }

  // Inverse of cubed_sphere::warp (s -> tan(s*pi/4)): unwarp(w) = atan(w)*4/pi.
  static double unwarp(double w) {
    return std::atan(w) * (4.0 / 3.14159265358979323846);
  }

  BodyParams body_;
  double lat_;        // radians, [-pi/2, pi/2]
  double lon_;        // radians, [-pi, pi]
  double heading_;    // radians, compass bearing (0=north, +=east)
  double eyeHeight_;  // metres above the designed surface
  FloatingOrigin origin_;
  int lastSeenRebase_ = 0;
  const VoxelEdits* voxels_ = nullptr;  // borrowed player dig diff (WG-21); null = undug base
};

}  // namespace worldgen
}  // namespace of
