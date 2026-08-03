// =============================================================================
// poi.h  (WG-200 to WG-206) -- POINT-OF-INTEREST PLACEMENT.
//
// The world says WHERE a site is. It never says what is inside one.
//
// This is the placement half of the domain's charter line "POI / structure
// placement -- ruins, anomalies, loot sites (content authored by gameplay;
// placement here)". Gameplay owns the reward, the research, the scan and the
// questline. World-gen owns: which body may hold a site, where a site may
// stand, how big a hole it punches in every other placement system, and the
// one bit that says somebody has been there.
//
// -----------------------------------------------------------------------------
// THE TYPE, NOT THE INSTANCE
// -----------------------------------------------------------------------------
// There is exactly one ruin near the spawn today and there will be many later.
// So there is no `theRuin()` anywhere in this header. A site is a row in
// `siteSpecsFor(bodyId)`, and adding the scattered ones is adding rows.
//
// The two placement MODES both exist from day one, deliberately, because a
// second mode added later is a rewrite and a second mode proven on day one is
// a table:
//
//   Anchor::Home    candidates on a golden-angle spiral about body.homeDir in
//                   a stated arc band. This is the near-spawn ruin.
//   Anchor::Global  candidates on a Fibonacci sphere over the whole body.
//                   This is "more scattered around the planet", and it is
//                   already tested even though no shipped spec uses it yet.
//
// Both run through ONE `admit()`. A gate that only one mode obeys is a gate
// that will be forgotten by the other.
//
// -----------------------------------------------------------------------------
// ASK WHICH BODY IT IS. THAT IS THE ENTIRE POINT OF `siteSpecsFor`.
// -----------------------------------------------------------------------------
// The tutorial spiral put 51 nodes on the moon regardless of body and nobody
// noticed until somebody drove it, because `seedNests` had no body test of any
// kind: not a wrong table, an ABSENT QUESTION. WG-144's rule says a bug class
// that crosses bodies will cross again.
//
// So `siteSpecsFor` is keyed on `bodyId` and its default arm is a REFUSAL, not
// a fallback to Forge's list. Cinder returns an empty span with a named reason
// (`refusalFor`), and an unknown body returns empty with a different named
// reason. "Nothing was placed" and "nothing was placed because this body is
// ruled lifeless" are different sentences and only the second one can be
// reviewed.
//
// -----------------------------------------------------------------------------
// WHY THE ID DOES NOT COME FROM THE POSITION
// -----------------------------------------------------------------------------
// `id = hashCombine(hashCombine(mix64(bodySeed), bodyId), kind << 32 | ordinal)`.
// The ORDINAL, never the winning candidate index and never the direction.
//
// A terrain change moves the winning candidate. If the id were derived from the
// chosen direction, every terrain change would orphan every "I have been here"
// bit in every save on the planet, silently, and the ruin would present itself
// as unvisited to a player who had cleared it. Keying on the ordinal means the
// site may MOVE and stays the same site. That is exactly WG-11's discipline for
// `FDepositNode::Id` (a hash of (bodySeed, region, localIndex), never of a
// position) applied to a scarcer object where the cost of getting it wrong is
// higher.
//
// -----------------------------------------------------------------------------
// WHAT IS SAVED
// -----------------------------------------------------------------------------
// One bit per site. Everything else regenerates (WG-3, C-6). The site table is
// a pure function of (bodySeed, bodyId, the spec table, the height field), so
// the natural world stays free to persist and only `visited` is a diff.
//
// -----------------------------------------------------------------------------
// EXISTENCE IS NOT RENDERING
// -----------------------------------------------------------------------------
// A site's LOCATION is known to the world from the moment the world exists.
// Its geometry is a normal streamed prop and is nothing to do with this header.
// The table is tiny (56 bytes a row; one ruin is one row, five hundred ruins is
// 28 KB), so there is no streaming of the table, no residency, no cache and no
// query cost worth optimising. Whoever draws it decides when; whoever reveals
// it decides whether the player is told.
//
// -----------------------------------------------------------------------------
// THE SURFACE THIS READS
// -----------------------------------------------------------------------------
// `sampleDesignedHeight`, the WG-21 surface authority: the BASE surface, never
// the edited one. A player who digs a hole must not move a ruin, and a ruin
// re-seated on the edited surface would do exactly that, since the edit set is
// save state and the table is not. The consequence is stated rather than
// hidden: dig under a ruin and it will end up standing over a hole, the same as
// every other static structure in this project.
// =============================================================================
#ifndef OF_POI_H
#define OF_POI_H

#include <cmath>
#include <cstdint>
#include <cstddef>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"
#include "of/water_field.h"

namespace of {
namespace worldgen {
namespace poi {

using SiteId = uint64_t;

enum class SiteKind : uint16_t {
  None = 0,
  /** The ancient civilisation's remains. The hinge of the progression spine:
   *  investigating one is what opens electricity and the antenna upgrade. */
  Ruin = 1,
};

enum class Anchor : uint8_t {
  /** Banded about `BodyParams::homeDir`. Moves with the spawn, by design: the
   *  anchor is read from the body, so if the spawn is ever relocated the ruin
   *  relocates with it and nothing here needs editing. */
  Home = 0,
  /** Spread over the whole body. The "more scattered around the planet" mode. */
  Global = 1,
};

/** Why a candidate direction was refused. Published rather than dropped: a
 *  refusal that names itself can be reviewed and a silent one cannot
 *  (GP-268's `starterRefused`, same reasoning). */
enum class Refusal : uint8_t {
  Admitted = 0,
  OutOfBand,      // arc from the anchor outside [minArcM, maxArcM]
  InsidePadBlend, // the spawn pad's blend reaches here, so it is not natural
  Ocean,          // the biome is Ocean
  Wet,            // standing water somewhere over the footprint disc
  Tilt,           // the fitted plane is too steep -- a uniform grade
  Residual,       // the ground is broken INSIDE the footprint
  TooClose,       // within the mutual separation of a site already placed
  BiomeRefused,   // the spec forbids this biome
};

inline const char* refusalName(Refusal r) {
  switch (r) {
    case Refusal::Admitted:       return "admitted";
    case Refusal::OutOfBand:      return "out of band";
    case Refusal::InsidePadBlend: return "inside the spawn pad blend";
    case Refusal::Ocean:          return "ocean";
    case Refusal::Wet:            return "standing water on the footprint";
    case Refusal::Tilt:           return "footprint tilt";
    case Refusal::Residual:       return "broken ground inside the footprint";
    case Refusal::TooClose:       return "too close to another site";
    case Refusal::BiomeRefused:   return "biome refused by the spec";
  }
  return "unknown";
}

// =============================================================================
// THE FOOTPRINT INSTRUMENT
//
// "Do not put it on a cliff" is TWO failures wearing one word, and the
// instrument that sees one is blind to the other:
//
//   TILT      the whole disc is a uniform grade. A 36 m building on a 4 degree
//             slope has one edge 1.26 m off the ground.
//   BROKEN    the mean plane is level and there is a step, a ledge or a boulder
//             crest INSIDE the disc. A point slope at the centre reads healthy
//             and the building still has a hole under it.
//
// WG-146 is the same shape one level up: slope saturates on a crater wall, so
// it could not tell "tilted" from "featured", and separated by 1.31x where
// curvature separated by 33x. A single slope sample here has the identical
// defect at a smaller scale.
//
// So this is a least-squares PLANE FIT over the disc, reporting both, out of
// one set of samples so the two numbers cannot disagree about what they saw.
//
// MEASURED on Forge in the shipped 700 to 1400 m band over 20,000 candidates
// (`site_probe`), against a span-only gate calibrated to admit the SAME
// fraction so the comparison is about WHICH ground each admits:
//
//   footprint   pair admits   span-admitted, pair-refused   of which
//     18 m        4.69%                 79                  72 tilt, 7 residual
//     30 m        9.30%                235                  23 tilt, 212 residual
//
// READ THAT HONESTLY, because it does not say what it first looks like it
// says. At the SHIPPED 18 m footprint the tilt gate does most of the work and
// the residual catches 7 of 79; the residual's share only becomes dominant at
// 30 m. Broken ground inside 18 m is genuinely rarer than inside 30 m, which
// is a property of the terrain rather than of the instrument.
//
// The residual gate stays anyway, and the reason is stated so nobody deletes
// it as dead weight: it is the ONLY thing between a bigger site type and a
// building with a hole under it, its cost is zero (it falls out of a fit that
// is already being computed for the tilt), and the 30 m column is what it will
// look like the moment anyone adds one. Adding a gate after the fact means
// re-deriving a threshold nobody has data for.
//
// THE BASELINE IS STATED BY CONSTRUCTION: the disc radius IS the footprint
// radius and the ring spacing is r/3. A terrain angle without its baseline is
// not a number -- the same Cinder point reads 24.500 degrees over 6 m and
// 26.627 over 1000 m.
//
// Sphere curvature over the disc is r^2/(2R) = 0.00027 m at r = 18 m on Forge,
// which is 0.03% of the residual budget, so the fit is not corrected for it.
// At r = 300 m it would be 0.075 m and it would have to be.
// =============================================================================

/** Samples in the footprint fit: centre + 3 rings x 12 spokes. */
constexpr int kFootSamples = 37;

struct FootMeasure {
  double tiltDeg = 0;      // fitted plane's angle from local horizontal
  double residP95M = 0;    // p95 of |h - plane| over the disc
  double residMaxM = 0;
  double spanM = 0;        // max - min raw. Reported, never gated on.
  double hCentreM = 0;
  double padDeltaM = 0;    // designed - designedNoPad. Nonzero => inside the pad.
};

namespace geom {

struct Tangent { Vec3 c, east, north; };

inline Tangent tangentAt(const Vec3& c) {
  Vec3 up(0, 1, 0);
  if (std::fabs(c.y) > 0.99) up = Vec3(1, 0, 0);
  Vec3 e(up.y * c.z - up.z * c.y, up.z * c.x - up.x * c.z,
         up.x * c.y - up.y * c.x);
  e = e * (1.0 / e.length());
  return Tangent{c, e, Vec3(c.y * e.z - c.z * e.y, c.z * e.x - c.x * e.z,
                            c.x * e.y - c.y * e.x)};
}

/** Gnomonic offset, error r^3/(3R^2): 3e-9 m at 30 m on Forge. */
inline Vec3 offsetDir(const Tangent& f, double R, double dx, double dy) {
  const double a = dx / R, b = dy / R;
  Vec3 p(f.c.x + a * f.east.x + b * f.north.x,
         f.c.y + a * f.east.y + b * f.north.y,
         f.c.z + a * f.east.z + b * f.north.z);
  return p * (1.0 / p.length());
}

inline double arcBetween(const Vec3& a, const Vec3& b, double R) {
  double d = a.x * b.x + a.y * b.y + a.z * b.z;
  if (d > 1.0) d = 1.0;
  if (d < -1.0) d = -1.0;
  return std::acos(d) * R;
}

/** p-quantile of a small array, sorted in place. */
inline double quantile(double* v, int n, double p) {
  if (n <= 0) return 0.0;
  for (int i = 1; i < n; ++i) {
    const double key = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > key) { v[j + 1] = v[j]; --j; }
    v[j + 1] = key;
  }
  const double idx = p * (n - 1.0);
  int lo = static_cast<int>(idx);
  if (lo < 0) lo = 0;
  int hi = (lo + 1 < n) ? lo + 1 : lo;
  const double t = idx - lo;
  return v[lo] * (1.0 - t) + v[hi] * t;
}

}  // namespace geom

/** Measure the ground over a disc of radius `rM` centred on `dir`. */
inline FootMeasure measureFootprint(const BodyParams& body, const Vec3& dir,
                                    double rM) {
  const geom::Tangent f = geom::tangentAt(dir);
  const double R = body.radiusM;
  double xs[kFootSamples], ys[kFootSamples], hs[kFootSamples];
  int n = 0;
  xs[n] = 0.0; ys[n] = 0.0;
  hs[n] = sampleDesignedHeight(body, dir);
  ++n;
  for (int ring = 1; ring <= 3; ++ring) {
    const double rr = rM * (static_cast<double>(ring) / 3.0);
    for (int k = 0; k < 12; ++k) {
      // Odd rings on the spokes, even rings offset half a spoke, so the 37
      // samples do not line up along 12 radii and leave 12 blind wedges.
      const double a = (k / 12.0) * 2.0 * 3.14159265358979323846
                     + ((ring & 1) ? 0.0 : 3.14159265358979323846 / 12.0);
      const double x = std::cos(a) * rr, y = std::sin(a) * rr;
      xs[n] = x; ys[n] = y;
      hs[n] = sampleDesignedHeight(body, geom::offsetDir(f, R, x, y));
      ++n;
    }
  }
  double Sxx = 0, Syy = 0, Sxy = 0, Sx = 0, Sy = 0, S1 = 0;
  double Shx = 0, Shy = 0, Sh = 0;
  for (int i = 0; i < n; ++i) {
    Sxx += xs[i] * xs[i]; Syy += ys[i] * ys[i]; Sxy += xs[i] * ys[i];
    Sx += xs[i]; Sy += ys[i]; S1 += 1.0;
    Shx += hs[i] * xs[i]; Shy += hs[i] * ys[i]; Sh += hs[i];
  }
  const double m[3][3] = {{Sxx, Sxy, Sx}, {Sxy, Syy, Sy}, {Sx, Sy, S1}};
  const double rhs[3] = {Shx, Shy, Sh};
  auto det3 = [](const double a[3][3]) {
    return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
         - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
         + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  };
  const double D = det3(m);
  double coef[3] = {0, 0, 0};
  if (std::fabs(D) > 1e-30) {
    for (int c = 0; c < 3; ++c) {
      double mc[3][3];
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) mc[i][j] = (j == c) ? rhs[i] : m[i][j];
      coef[c] = det3(mc) / D;
    }
  }
  FootMeasure out;
  out.hCentreM = hs[0];
  out.tiltDeg = std::atan(std::sqrt(coef[0] * coef[0] + coef[1] * coef[1]))
              * (180.0 / 3.14159265358979323846);
  double res[kFootSamples];
  double hmin = hs[0], hmax = hs[0];
  for (int i = 0; i < n; ++i) {
    res[i] = std::fabs(hs[i] - (coef[0] * xs[i] + coef[1] * ys[i] + coef[2]));
    if (res[i] > out.residMaxM) out.residMaxM = res[i];
    if (hs[i] < hmin) hmin = hs[i];
    if (hs[i] > hmax) hmax = hs[i];
  }
  out.spanM = hmax - hmin;
  // p95, not max: one sample landing on a boulder crest must not veto good
  // ground, and WG-146's corollary is that terrain second-order quantities are
  // heavy-tailed, so a MEAN would pass on a handful of features while typical
  // ground inside the footprint stayed broken.
  out.residP95M = geom::quantile(res, n, 0.95);
  out.padDeltaM = out.hCentreM - designedHeightNoPad(body, dir);
  return out;
}

// =============================================================================
// THE SPEC TABLE
// =============================================================================

struct SiteSpec {
  SiteKind kind = SiteKind::None;
  Anchor anchor = Anchor::Home;
  /** How many of this kind this body carries. */
  uint32_t count = 0;
  /** The disc the site occupies. Everything else keeps out of it, and it is
   *  the disc the footprint gates are measured over. */
  double footprintM = 0;
  /** Arc band from the anchor. Ignored for Anchor::Global. */
  double minArcM = 0, maxArcM = 0;
  /** Minimum arc separation between two sites of this kind. */
  double separationM = 0;
  double maxTiltDeg = 0;
  double maxResidM = 0;
  /** How many authored variants the art set provides; the chosen one is
   *  hashed, so two ruins are not the same building. */
  uint32_t variants = 1;
  /** Candidates tried before giving up and REFUSING to place. A fallback that
   *  drops the gates would put a ruin on a cliff quietly; a refusal that names
   *  itself can be fixed. */
  uint32_t maxTries = 4096;
};

// -----------------------------------------------------------------------------
// FORGE. One ruin, in a band the player can walk.
//
// THE BAND'S INNER EDGE IS NOT TASTE. `makeForge` declares
// homeBlendRadiusM = 600 m, inside which `sampleDesignedHeight` is the spawn
// pad's artificial blend rather than natural ground. A site inside that is
// sitting on a construction of the spawn, so 700 m is 600 m plus the footprint
// plus margin, and `admit` CHECKS the pad delta rather than trusting the
// arithmetic, so growing the pad cannot quietly invalidate this number.
//
// The outer edge is a walk. At the shipped 4.6 m/s (`Controller.ts` walkMps)
// 1400 m is 5.1 minutes out and 10.1 minutes for the round trip, or half that
// sprinting. Far enough that you do not trip over it before you have built the
// antenna that is supposed to reveal it; near enough to be a walk rather than
// an expedition.
//
// footprintM 18 m (a 36 m complex) with tilt <= 4.0 deg and residP95 <= 1.0 m
// admits 4.69% of the ground in the band, measured over 20,000 candidates.
// That is one site in 21, so `maxTries` 4096 has two orders of magnitude of
// margin, and the shipped world places its ruin on candidate 21 of 4096.
//
// THE ART SPEC FALLS OUT OF THOSE TWO NUMBERS AND IS NOT A SEPARATE OPINION.
// The worst admissible ground drops 18*tan(4) = 1.26 m from centre to rim and
// carries up to 1.0 m of residual on top, so a ruin needs a plinth, skirt or
// buried course that can absorb about 2.3 m at its rim without daylight under
// it. Tighten the gates and that number falls; loosen them and it rises. It is
// derived here so that it stays derived (a relationship written in prose is a
// number nobody is checking).
// -----------------------------------------------------------------------------
inline const SiteSpec* forgeSpecs(int* countOut) {
  static const SiteSpec kSpecs[] = {
    SiteSpec{SiteKind::Ruin, Anchor::Home, 1, 18.0, 700.0, 1400.0, 400.0,
             4.0, 1.0, /*variants*/ 1, /*maxTries*/ 4096},
  };
  *countOut = 1;
  return kSpecs;
}

/** Why a body has no sites. Empty string where it does. */
inline const char* refusalFor(uint16_t bodyId) {
  switch (bodyId) {
    case 0: return "";
    // WG-141 ruled Cinder lifeless: it is airless, it is a crater field, and
    // no civilisation lived there to leave anything behind. This is a decision
    // recorded as a value, not an accident of an empty table.
    case 1: return "Cinder is ruled lifeless (WG-141): no ruins on the moon";
    default: return "unknown body: no site table, and no fallback to Forge's";
  }
}

/** The site table for a body. KEYED ON THE BODY. The default arm REFUSES. */
inline const SiteSpec* siteSpecsFor(uint16_t bodyId, int* countOut) {
  *countOut = 0;
  switch (bodyId) {
    case 0: return forgeSpecs(countOut);
    case 1: return nullptr;   // Cinder, see refusalFor
    default: return nullptr;
  }
}

// =============================================================================
// ADMISSIBILITY -- ONE function, both anchor modes.
// =============================================================================

struct Verdict {
  Refusal refusal = Refusal::Admitted;
  bool ok = false;
  double arcM = 0;
  double wetM = 0;
  FootMeasure foot;
};

/**
 * May a site of this spec stand at `dir`?
 *
 * Gate order is cheapest first, so a candidate on the far side of the planet
 * costs one dot product rather than 37 height samples.
 *
 * WATER IS TESTED OVER THE WHOLE FOOTPRINT, not at the centre. A centre-only
 * test admits a shoreline site with its back half under the pond, which is
 * precisely the case the gate exists for.
 */
inline Verdict admit(const BodyParams& body, const Vec3& anchor, const Vec3& dir,
                     const SiteSpec& spec) {
  Verdict v;
  const double R = body.radiusM;
  v.arcM = geom::arcBetween(anchor, dir, R);
  if (spec.anchor == Anchor::Home
      && (v.arcM < spec.minArcM || v.arcM > spec.maxArcM)) {
    v.refusal = Refusal::OutOfBand;
    return v;
  }
  if (biomeAt(body, dir) == Biome::Ocean) {
    v.refusal = Refusal::Ocean;
    return v;
  }
  // WATER BEFORE THE FOOTPRINT, for two reasons and the second is the one that
  // matters. It is cheaper: 13 depth queries against 37 height samples. And
  // putting the pad-blend test first made the water gate UNREACHABLE, because
  // Forge's only water is a pond 55 m from `homeDir` and therefore inside the
  // 600 m pad blend, so every wet candidate was refused as InsidePadBlend and
  // the water gate could never be exercised by anything. A gate that no input
  // can reach is not a gate.
  const geom::Tangent f = geom::tangentAt(dir);
  double wet = water::depthAt(body, dir);
  for (int k = 0; k < 12; ++k) {
    const double a = (k / 12.0) * 2.0 * 3.14159265358979323846;
    const double w = water::depthAt(
        body, geom::offsetDir(f, R, std::cos(a) * spec.footprintM,
                                std::sin(a) * spec.footprintM));
    if (w > wet) wet = w;
  }
  v.wetM = wet;
  if (wet > 0.0) { v.refusal = Refusal::Wet; return v; }
  v.foot = measureFootprint(body, dir, spec.footprintM);
  // The pad blend is not natural ground. Checked rather than assumed from the
  // band arithmetic, because the pad's radius is a body constant that can grow
  // and this is the only thing that would notice.
  if (v.foot.padDeltaM != 0.0) {
    v.refusal = Refusal::InsidePadBlend;
    return v;
  }
  if (v.foot.tiltDeg > spec.maxTiltDeg) { v.refusal = Refusal::Tilt; return v; }
  if (v.foot.residP95M > spec.maxResidM) {
    v.refusal = Refusal::Residual;
    return v;
  }
  v.refusal = Refusal::Admitted;
  v.ok = true;
  return v;
}

// =============================================================================
// THE SITE
// =============================================================================

struct FSite {
  SiteId id = 0;
  SiteKind kind = SiteKind::None;
  uint16_t body = 0;
  uint32_t variant = 0;
  /** Ordinal within its (body, kind). The id is derived from THIS. */
  uint32_t ordinal = 0;
  /** Unit direction, body frame. THE anchor of everything else here. */
  Vec3 dir{0, 0, 0};
  /** Body-frame metres on the BASE surface. */
  Vec3 pos{0, 0, 0};
  /** Surface normal, == dir on a sphere; carried so a caller never re-derives. */
  Vec3 up{0, 0, 0};
  double latRad = 0, lonRad = 0;
  double yawRad = 0;
  double footprintM = 0;
  /** Arc distance from the body's anchor. 0 for a Global site. */
  double arcFromAnchorM = 0;
  /** The measurement that admitted it, published so nobody re-measures. */
  double tiltDeg = 0;
  double residP95M = 0;
  double groundM = 0;
  int16_t biome = -1;
};

inline SiteId siteIdFor(const BodyParams& body, SiteKind kind, uint32_t ordinal) {
  const uint64_t k = (static_cast<uint64_t>(static_cast<uint16_t>(kind)) << 32)
                   | static_cast<uint64_t>(ordinal);
  return hashCombine(hashCombine(mix64(body.bodySeed),
                                 static_cast<uint64_t>(body.bodyId) + 1u), k);
}

/** Why a spec placed fewer sites than it asked for. */
struct PlacementReport {
  uint32_t asked = 0;
  uint32_t placed = 0;
  uint32_t tried = 0;
  /** Refusal histogram, indexed by `Refusal`. */
  uint32_t refusals[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
};

/**
 * The deterministic candidate sequence for a spec.
 *
 * FIRST ADMISSIBLE IN A FIXED ORDER, never best-of-N, and that is a cost
 * decision with a stability argument behind it. Scoring 20,000 candidates
 * costs 740,000 height samples at world init; taking the first admissible at a
 * measured 4.6% hit rate costs about 800. And a score drifts on ANY terrain
 * change anywhere in the band, while a first-admissible only drifts when a
 * candidate before the winner changes verdict.
 *
 * The spiral is area-uniform in radius (r = sqrt of a uniform), so the sample
 * density is the same at 700 m and at 1400 m rather than piling up at the
 * inner edge, and the golden angle spreads the sequence rather than sweeping
 * one bearing.
 */
inline Vec3 candidateDir(const BodyParams& body, const SiteSpec& spec,
                         const Vec3& anchor, uint32_t i) {
  const double kGolden = 2.39996322972865332;
  if (spec.anchor == Anchor::Global) {
    // Fibonacci sphere, the same construction `GenerateDeposits` uses.
    const double n = 4096.0;
    const double t = (static_cast<double>(i % 4096u) + 0.5) / n;
    const double y = 1.0 - 2.0 * t;
    const double r = std::sqrt(y * y < 1.0 ? 1.0 - y * y : 0.0);
    const double a = kGolden * static_cast<double>(i);
    return Vec3(std::cos(a) * r, y, std::sin(a) * r);
  }
  // A hashed jitter on the radius so two specs with the same band on the same
  // body do not walk the identical sequence.
  const double u = hashToUnit(hashCombine(mix64(body.bodySeed),
      (static_cast<uint64_t>(static_cast<uint16_t>(spec.kind)) << 40)
      | static_cast<uint64_t>(i)));
  const double lo = spec.minArcM * spec.minArcM;
  const double hi = spec.maxArcM * spec.maxArcM;
  const double rr = std::sqrt(lo + u * (hi - lo));
  const double a = kGolden * static_cast<double>(i);
  const geom::Tangent f = geom::tangentAt(anchor);
  return geom::offsetDir(f, body.radiusM, std::cos(a) * rr,
                           std::sin(a) * rr);
}

/**
 * Every site on a body. A pure function of (bodySeed, bodyId, spec table,
 * height field). No LOD gating, no residency, no camera, no clock.
 */
inline std::vector<FSite> generateFrom(const BodyParams& body,
                                       const SiteSpec* specs, int nSpecs,
                                       std::vector<PlacementReport>* reports
                                           = nullptr) {
  std::vector<FSite> out;
  if (specs == nullptr || nSpecs == 0) return out;
  const Vec3 anchor = body.homeDir.length() > 0.5
      ? body.homeDir : Vec3(1.0, 0.0, 0.0);
  for (int s = 0; s < nSpecs; ++s) {
    const SiteSpec& spec = specs[s];
    PlacementReport rep;
    rep.asked = spec.count;
    std::vector<Vec3> placedDirs;
    for (uint32_t i = 0; i < spec.maxTries && rep.placed < spec.count; ++i) {
      ++rep.tried;
      const Vec3 d = candidateDir(body, spec, anchor, i);
      Verdict v = admit(body, anchor, d, spec);
      if (v.ok) {
        for (const Vec3& p : placedDirs) {
          if (geom::arcBetween(p, d, body.radiusM) < spec.separationM) {
            v.ok = false;
            v.refusal = Refusal::TooClose;
            break;
          }
        }
      }
      ++rep.refusals[static_cast<int>(v.refusal)];
      if (!v.ok) continue;
      FSite site;
      site.ordinal = rep.placed;
      site.kind = spec.kind;
      site.body = body.bodyId;
      site.id = siteIdFor(body, spec.kind, site.ordinal);
      site.dir = d;
      site.up = d;
      site.groundM = v.foot.hCentreM;
      site.pos = d * (body.radiusM + v.foot.hCentreM);
      site.latRad = std::asin(d.y);
      site.lonRad = std::atan2(d.z, d.x);
      // Yaw from the ID, not from the index, for the same reason the id is:
      // a site that moves keeps its orientation.
      site.yawRad = hashToUnit(mix64(site.id ^ 0x9E3779B97F4A7C15ull))
                  * 2.0 * 3.14159265358979323846;
      site.variant = spec.variants > 1
          ? static_cast<uint32_t>(
                hashToUnit(mix64(site.id ^ 0xD1B54A32D192ED03ull))
                * static_cast<double>(spec.variants)) % spec.variants
          : 0u;
      site.footprintM = spec.footprintM;
      site.arcFromAnchorM = v.arcM;
      site.tiltDeg = v.foot.tiltDeg;
      site.residP95M = v.foot.residP95M;
      site.biome = static_cast<int16_t>(biomeAt(body, d));
      placedDirs.push_back(d);
      out.push_back(site);
      ++rep.placed;
    }
    if (reports != nullptr) reports->push_back(rep);
  }
  return out;
}

/** Every site on a body, from the SHIPPED spec table for its body id. */
inline std::vector<FSite> generateSites(const BodyParams& body,
                                        std::vector<PlacementReport>* reports
                                            = nullptr) {
  int nSpecs = 0;
  const SiteSpec* specs = siteSpecsFor(body.bodyId, &nSpecs);
  return generateFrom(body, specs, nSpecs, reports);
}

// =============================================================================
// THE WALK. Published, deliberately NOT a gate.
//
// The straight great circle from the spawn to a site is the WORST case for
// reachability: a player may walk around an obstacle, so a walkable great
// circle PROVES the site is reachable and an unwalkable one merely fails to
// prove it. Gating on it would refuse good sites for a reason that is not
// true, so it is measured, published, and asserted on the SHIPPED instance in
// the test rather than enforced inside the generator.
//
// Two arms, because one is not a number: a 5 m grade is dominated by the
// detail octaves and a 20 m grade is the landform you actually have to climb.
// =============================================================================
struct WalkMeasure {
  double lengthM = 0;
  double maxGrade5Deg = 0;
  double maxGrade20Deg = 0;
  double climbM = 0;    // net gain, anchor to site
  double ascentM = 0;   // total of the positive steps
  int wetSamples = 0;
  int samples = 0;
};

inline WalkMeasure measureWalk(const BodyParams& body, const Vec3& from,
                               const Vec3& to, double stepM = 5.0) {
  WalkMeasure w;
  const double R = body.radiusM;
  w.lengthM = geom::arcBetween(from, to, R);
  const int n = static_cast<int>(w.lengthM / stepM) + 1;
  std::vector<double> h(static_cast<size_t>(n) + 1);
  std::vector<Vec3> d(static_cast<size_t>(n) + 1);
  for (int i = 0; i <= n; ++i) {
    const double t = static_cast<double>(i) / static_cast<double>(n);
    Vec3 p(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
           from.z + (to.z - from.z) * t);
    p = p * (1.0 / p.length());
    d[static_cast<size_t>(i)] = p;
    h[static_cast<size_t>(i)] = sampleDesignedHeight(body, p);
  }
  w.samples = n + 1;
  const double ds = w.lengthM / static_cast<double>(n);
  int span20 = static_cast<int>(20.0 / ds + 0.5);
  if (span20 < 1) span20 = 1;
  const double kR2D = 180.0 / 3.14159265358979323846;
  for (int i = 0; i < n; ++i) {
    const double dh = h[static_cast<size_t>(i) + 1] - h[static_cast<size_t>(i)];
    const double g = std::atan(std::fabs(dh) / ds) * kR2D;
    if (g > w.maxGrade5Deg) w.maxGrade5Deg = g;
    if (dh > 0) w.ascentM += dh;
  }
  for (int i = 0; i + span20 <= n; ++i) {
    const double dh = h[static_cast<size_t>(i + span20)]
                    - h[static_cast<size_t>(i)];
    const double g = std::atan(std::fabs(dh) / (ds * span20)) * kR2D;
    if (g > w.maxGrade20Deg) w.maxGrade20Deg = g;
  }
  for (int i = 0; i <= n; ++i)
    if (water::depthAt(body, d[static_cast<size_t>(i)]) > 0.0) ++w.wetSamples;
  w.climbM = h[static_cast<size_t>(n)] - h[0];
  return w;
}

// =============================================================================
// THE CATALOG -- the query surface, and the ONE mutable bit.
// =============================================================================

class SiteCatalog {
 public:
  SiteCatalog() = default;

  static SiteCatalog ForBody(const BodyParams& body) {
    SiteCatalog c;
    c.sites_ = generateSites(body, &c.reports_);
    c.visited_.assign(c.sites_.size(), 0u);
    c.refusal_ = refusalFor(body.bodyId);
    return c;
  }

  const std::vector<FSite>& sites() const { return sites_; }
  size_t size() const { return sites_.size(); }
  const std::vector<PlacementReport>& reports() const { return reports_; }
  /** Empty where the body has sites; otherwise WHY it has none. */
  const char* refusal() const { return refusal_; }

  const FSite* byId(SiteId id) const {
    for (size_t i = 0; i < sites_.size(); ++i)
      if (sites_[i].id == id) return &sites_[i];
    return nullptr;
  }

  /**
   * Every site whose direction lies inside a CONE about `dir`.
   *
   * A cone, not a projection and not a rectangle, for WG-29's reason: a scan
   * radius yields one, a camera frustum yields one, and a map's orthographic
   * cell does not survive the limb. `cosHalfAngle` is the cosine so the caller
   * never pays a trig call and the test is one dot product.
   */
  std::vector<size_t> near(const Vec3& dir, double cosHalfAngle) const {
    std::vector<size_t> out;
    for (size_t i = 0; i < sites_.size(); ++i) {
      const double d = sites_[i].dir.x * dir.x + sites_[i].dir.y * dir.y
                     + sites_[i].dir.z * dir.z;
      if (d >= cosHalfAngle) out.push_back(i);
    }
    return out;
  }

  /** Nearest site of a kind, or -1. `SiteKind::None` matches any kind. */
  int nearest(const Vec3& dir, SiteKind kind = SiteKind::None) const {
    int best = -1;
    double bestDot = -2.0;
    for (size_t i = 0; i < sites_.size(); ++i) {
      if (kind != SiteKind::None && sites_[i].kind != kind) continue;
      const double d = sites_[i].dir.x * dir.x + sites_[i].dir.y * dir.y
                     + sites_[i].dir.z * dir.z;
      if (d > bestDot) { bestDot = d; best = static_cast<int>(i); }
    }
    return best;
  }

  /**
   * Is `dir` inside any site's footprint, plus `marginM`?
   *
   * THE KEEP-OUT EVERY OTHER PLACEMENT SYSTEM ASKS. Trees, rocks, ore
   * outcrops, scatter props and player building all need this or a 14 m
   * conifer grows through the roof.
   *
   * Compare directions and scale by the radius, never surface positions: a
   * placed node's `pos` is at `radius + height` and a candidate unit direction
   * scaled by `radius` alone differs from it by the terrain height, which is
   * 27 m at the Forest site and beat a 6 m keep-out silently when the tree
   * field first wrote this test.
   */
  bool insideAnySite(const BodyParams& body, const Vec3& dir,
                     double marginM = 0.0) const {
    Vec3 u = dir;
    const double L = u.length();
    if (L <= 0.0) return false;
    u = u * (1.0 / L);
    for (const FSite& s : sites_) {
      const double keep = s.footprintM + marginM;
      if (geom::arcBetween(s.dir, u, body.radiusM) < keep) return true;
    }
    return false;
  }

  // --- the one mutable bit -------------------------------------------------
  bool visited(SiteId id) const {
    for (size_t i = 0; i < sites_.size(); ++i)
      if (sites_[i].id == id) return visited_[i] != 0;
    return false;
  }

  /**
   * Record that a site has been investigated.
   *
   * Returns TRUE only the first time, so the caller can distinguish "this is
   * the first visit" from "again" without keeping a second copy of the bit.
   * WHAT investigating means, what it unlocks and when it fires are gameplay's
   * entirely; this is the durable half.
   */
  bool markVisited(SiteId id) {
    for (size_t i = 0; i < sites_.size(); ++i) {
      if (sites_[i].id != id) continue;
      if (visited_[i] != 0) return false;
      visited_[i] = 1;
      return true;
    }
    return false;
  }

  size_t visitedCount() const {
    size_t n = 0;
    for (uint8_t v : visited_) if (v != 0) ++n;
    return n;
  }

  /**
   * The whole save surface: the visited ids, sorted, delta-varint.
   *
   * Templated on the persistence cursor style so this header stays a leaf and
   * never includes persistence.h, exactly as `VoxelEdits` does.
   */
  template <typename Writer>
  void serialize(Writer& w) const {
    std::vector<uint64_t> ids;
    for (size_t i = 0; i < sites_.size(); ++i)
      if (visited_[i] != 0) ids.push_back(sites_[i].id);
    for (size_t i = 1; i < ids.size(); ++i) {
      size_t j = i;
      while (j > 0 && ids[j - 1] > ids[j]) {
        const uint64_t t = ids[j - 1]; ids[j - 1] = ids[j]; ids[j] = t;
        --j;
      }
    }
    w.varint(static_cast<uint64_t>(ids.size()));
    uint64_t prev = 0;
    for (uint64_t id : ids) { w.varint(id - prev); prev = id; }
  }

  template <typename Reader>
  bool deserialize(Reader& r) {
    visited_.assign(sites_.size(), 0u);
    const uint64_t n = r.varint();
    uint64_t prev = 0;
    for (uint64_t i = 0; i < n; ++i) {
      prev += r.varint();
      // An id with no site is DROPPED, not an error: a table that shrank
      // because a spec changed must still load, and losing a bit for a site
      // that no longer exists costs nothing.
      for (size_t k = 0; k < sites_.size(); ++k)
        if (sites_[k].id == prev) visited_[k] = 1;
    }
    return true;
  }

 private:
  std::vector<FSite> sites_;
  std::vector<PlacementReport> reports_;
  std::vector<uint8_t> visited_;
  const char* refusal_ = "";
};

}  // namespace poi
}  // namespace worldgen
}  // namespace of

#endif  // OF_POI_H
