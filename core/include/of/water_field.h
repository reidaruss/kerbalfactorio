#pragma once
// =============================================================================
// water_field.h - THE WATER LEVEL AUTHORITY (WG-36).
//
// WHY THIS IS ITS OWN HEADER, AND WHY IT IS NOT A FUNCTION ON surface_field.h.
//
// Adding water adds a THIRD answer to "where is the surface here". The project
// already has two, deliberately (DW-26): `surfaceHeight` is the smooth ground,
// `solidCell` is the voxel shell, and a ctest asserts the bound between them,
// because the alternative - one of them quietly standing in for the other -
// is the ambiguity that produced the sinking deck and the sinking tunnel and
// cost days both times.
//
// So the water level is published the same way: as ITS OWN NAMED QUANTITY with
// ITS OWN BOUND, in its own file, under names that cannot be mistaken for the
// ground. There is no function in this header called `surfaceHeight`, there is
// no overload of anything in surface_field.h, and NOTHING here is ever a valid
// answer to "what do my feet rest on". If you are looking for the ground, you
// are in the wrong header; go to surface_field.h and stay there.
//
// The reverse also holds and is the reason `designedHeightNoPond` exists: the
// water level is measured DOWN from the ground the basin was cut into, never
// from `sampleDesignedHeight`, which already has the basin subtracted out of
// it. Deriving one from the other would be circular, and the circularity would
// present as "the pond gets deeper every time you look at it".
//
// THE MODEL, in three quantities and one invariant.
//
//   levelM      - ONE scalar per body: the height, in metres above the datum,
//                 of the pond's flat water surface. Flat is not a
//                 simplification, it is what standing water IS at this scale;
//                 a 32 m pond on a 600 km sphere deviates from its own chord
//                 by 0.21 mm.
//   depthAt     - how much water stands over the GROUND under a direction.
//                 Zero everywhere there is no water, including on the beach
//                 inside the basin rim. This is the only function that reads
//                 both authorities, and it reads each for what it is.
//   submersionM - how far a POINT is below the water surface. Negative above.
//                 This is the character controller's one question, and it is
//                 answerable from here alone (no ground query in it at all),
//                 which is the point: "am I in water" must have exactly one
//                 place to be asked from.
//
//   INVARIANT (asserted in test_water_field.cpp, both directions):
//                 water never sits below its own bed, and never above its own
//                 rim. Formally, for every direction inside the SHORELINE,
//                   sampleDesignedHeight(dir) <= levelM <= designedHeightNoPond(dir)
//                 with the left inequality strict at the centre and the right
//                 strict everywhere, by exactly pondFreeboardM at the rim.
//
//                 "Inside the shoreline" and "inside the rim" are DIFFERENT
//                 SETS and this comment previously used them interchangeably,
//                 which made the left half of the invariant false over the
//                 whole annulus between them: that annulus is the dry BEACH,
//                 where the ground stands above the water on purpose and
//                 levelAt correctly returns kNoWater. The suite asserts the
//                 beach complement separately (ground strictly above the water
//                 there) rather than quietly narrowing the claim.
//
// SHORELINE. The waterline is not a fourth constant, it is derived: the radius
// at which the basin has dropped exactly pondFreeboardM. Shipping it as a
// constant is how a probe ends up policing a ring that the tool it watches has
// since moved (standing rule 11's negative-control failure), so `shorelineM`
// below solves for it from the basin profile every time it is asked.
//
// DETERMINISM. Pure functions of (BodyParams, dir/pos). Multiply, add, sqrt and
// one Newton solve - no trig, no pow (DW-14).
//
// Header-only C++17. Consumes cubed_sphere.h + biome.h + surface_field.h
// READ-ONLY.
// =============================================================================
#include <cmath>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/surface_field.h"

namespace of {
namespace worldgen {
namespace water {

// -----------------------------------------------------------------------------
// The sentinel a column with no water returns.
//
// It is a large NEGATIVE height rather than NaN or 0. NaN because every
// comparison against NaN is false, so a caller that forgets to test would
// silently take the "not in water" branch on a body that HAS water, which is
// the quiet-wrong-answer failure this project keeps paying for. 0 because 0 is
// a legal height (it is the datum, and Forge's seaLevelM). A value 1e30 below
// the datum can only ever compare as "the water is unreachably far below you",
// which is the correct reading of "there is no water here" in every comparison
// a caller can write.
constexpr double kNoWater = -1.0e30;

/** True if this body declares a pond at all. */
inline bool hasPond(const BodyParams& body) {
  return body.pondRadiusM > 0.0 && body.pondDepthM > 0.0;
}

// -----------------------------------------------------------------------------
// levelM: THE water level. One scalar for the body, metres above the datum.
//
// = the ground the basin was cut into, at the basin centre, less the freeboard.
// Reads designedHeightNoPond and NEVER sampleDesignedHeight - see the header
// comment on circularity.
inline double levelM(const BodyParams& body) {
  if (!hasPond(body)) return kNoWater;
  return designedHeightNoPond(body, body.pondDir) - body.pondFreeboardM;
}

/** The absolute radius (metres from the body centre) of the water surface. */
inline double levelRadius(const BodyParams& body) {
  if (!hasPond(body)) return kNoWater;
  return body.radiusM + levelM(body);
}

// -----------------------------------------------------------------------------
// Arc distance from the pond centre, in metres. Same chord metric the pad and
// the basin use, so "inside the pond" means the same thing in all three.
inline double distFromPondM(const BodyParams& body, const Vec3& dir) {
  const double dx = dir.x - body.pondDir.x;
  const double dy = dir.y - body.pondDir.y;
  const double dz = dir.z - body.pondDir.z;
  return body.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
}

// -----------------------------------------------------------------------------
// shorelineM: the radius, in metres from the pond centre, where the water meets
// the ground. DERIVED from the basin profile, never stored.
//
// Solve depth * (1 - smoothstep(0,1,t)) = freeboard for t, i.e.
//   s(t) = t*t*(3 - 2t) = 1 - freeboard/depth.
// s is strictly increasing on [0,1], so bisection converges unconditionally and
// needs no derivative and no guard against a bad initial guess. 60 halvings
// takes the bracket below 1e-18, which is under the f64 spacing of t, so the
// answer is exact to the representation.
//
// Returns 0 if the water would not stand at all (freeboard >= depth), and
// pondRadiusM if the basin would overflow (freeboard <= 0). Both are refused by
// the assertions in test_water_field.cpp for any body that ships.
inline double shorelineM(const BodyParams& body) {
  if (!hasPond(body)) return 0.0;
  if (body.pondFreeboardM >= body.pondDepthM) return 0.0;
  if (body.pondFreeboardM <= 0.0) return body.pondRadiusM;
  const double target = 1.0 - body.pondFreeboardM / body.pondDepthM;
  double lo = 0.0, hi = 1.0;
  for (int i = 0; i < 60; ++i) {
    const double mid = 0.5 * (lo + hi);
    if (mid * mid * (3.0 - 2.0 * mid) < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi) * body.pondRadiusM;
}

/** The deepest water on the body, metres. depth - freeboard, or 0. */
inline double maxDepthM(const BodyParams& body) {
  if (!hasPond(body)) return 0.0;
  const double d = body.pondDepthM - body.pondFreeboardM;
  return d > 0.0 ? d : 0.0;
}

// -----------------------------------------------------------------------------
// levelAt: the water surface height under a direction, or kNoWater.
//
// "Under a direction" and not "at a point": whether a COLUMN has water in it is
// a property of the column. Whether a POINT is under water is submersionM's
// question, and they are kept apart on purpose because conflating them is how a
// player standing on a rock in the middle of a pond ends up swimming.
inline double levelAt(const BodyParams& body, const Vec3& dir) {
  if (!hasPond(body)) return kNoWater;
  if (distFromPondM(body, dir) >= body.pondRadiusM) return kNoWater;
  const double lvl = levelM(body);
  // Inside the basin but up on the dry beach: the ground here stands above the
  // water, so this column holds no water however close to the pond it is.
  if (sampleDesignedHeight(body, dir) >= lvl) return kNoWater;
  return lvl;
}

// -----------------------------------------------------------------------------
// depthAt: metres of water standing over the ground under a direction.
//
// THE ONLY function here that reads a ground authority, and it reads the EDITED
// surface, so digging the bed deeper makes the water deeper and filling it in
// makes the water shallower - which is what makes the pump and the dredge, when
// they arrive, work on the world rather than on a decoration. Zero everywhere
// there is no water; never negative.
inline double depthAt(const BodyParams& body, const Vec3& dir,
                      const DensityField& edits) {
  const double lvl = levelAt(body, dir);
  if (lvl == kNoWater) return 0.0;
  const double ground = surfaceHeight(body, dir, edits);
  const double d = lvl - ground;
  return d > 0.0 ? d : 0.0;
}

/** depthAt against the pristine designed bed (no voxel edits). */
inline double depthAt(const BodyParams& body, const Vec3& dir) {
  const double lvl = levelAt(body, dir);
  if (lvl == kNoWater) return 0.0;
  const double d = lvl - sampleDesignedHeight(body, dir);
  return d > 0.0 ? d : 0.0;
}

// -----------------------------------------------------------------------------
// submersionM: how far a body-frame POINT is below the water surface.
//
// Positive under water, negative above it, and kNoWater-ish (a large negative)
// where there is no water at all, so `submersionM(p) > 0` is a complete and
// safe test for "this point is in water" with no companion check needed.
//
// This is the character controller's ONE question, and note what it does not
// do: it does not query the ground. A capsule that is below the water surface
// is in water whether it is floating, standing on the bed, or buried in it.
// Mixing the ground in here is what would make "am I swimming" depend on which
// of three surfaces answered first.
inline double submersionM(const BodyParams& body, const Vec3& pos) {
  if (!hasPond(body)) return kNoWater;
  const double r = std::sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (r < 1e-6) return kNoWater;
  const double inv = 1.0 / r;
  const Vec3 dir(pos.x * inv, pos.y * inv, pos.z * inv);
  if (distFromPondM(body, dir) >= body.pondRadiusM) return kNoWater;
  const double lvl = levelM(body);
  // WHAT THIS RETURNS ON THE BEACH, stated accurately because the first version
  // of this comment argued something the code does not do.
  //
  // The answer is a pure height comparison against the water level. It does NOT
  // consult the ground, by design. For a point RESTING on the beach that gives
  // "not in water", which is right and is why a wader on the bank is dry. For a
  // point BELOW the beach surface but inside pondRadiusM - buried, or standing
  // in a hole the player has dug beside the pond - it returns a POSITIVE
  // submersion even though there is soil between that point and the pond.
  //
  // That is deliberate and it is the water-table reading: dig a pit next to a
  // pond and it fills. It is also the only reading available to a function that
  // is forbidden from asking where the ground is, and being forbidden that is
  // the entire reason this file exists. If a future consumer needs "is this
  // point in OPEN water", that is a different question and it gets its own
  // named function; it does not get bolted onto this one.
  return (body.radiusM + lvl) - r;
}

/** Convenience: is this body-frame point below the water surface? */
inline bool submerged(const BodyParams& body, const Vec3& pos) {
  return submersionM(body, pos) > 0.0;
}

}  // namespace water
}  // namespace worldgen
}  // namespace of
