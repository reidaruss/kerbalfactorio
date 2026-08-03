#pragma once
// =============================================================================
// biome.h — planet-scale BIOME + terrain-design + planet-wide RESOURCE layer
// (world-gen Wave-3; Spike 1 §2 "biomes & surface materials", §4.5 resources).
//
// This is the layer that turns the raw, uniform noise heightfield into a
// *designed*, varied planet: oceans / beaches / plains / forests / hills /
// mountains / polar caps on a planet, and regolith / highland / crater-floor on
// a moon — each with (1) its own RELIEF CHARACTER (mountains ridge high, plains
// flatten, oceans sit below the datum) and (2) its own SURFACE MATERIAL id the
// renderer + terrain_stream chunk pick up, plus a planet-WIDE deterministic
// resource distribution biased by biome (ore favours hills/mountains, etc.).
//
// THE DETERMINISM DISCIPLINE (WG-6, inherited from cubed_sphere.h):
//   Everything here is a PURE function of (BodyParams, unit dir). Climate is
//   POSITION-hashed (temperature/moisture from hashPos over the dir), elevation
//   comes from the SAME sampleHeightField the mesh uses, and latitude from the
//   dir. So `biomeAt`, `sampleDesignedHeight`, and the resource pass all
//   reproduce bit-for-bit across runs / machines / save-reload — they cost ~0 to
//   persist (regenerate from seed; only depletion is a diff, WG-3 / C-6).
//
// ADDITIVE / NON-DESTRUCTIVE: `sampleHeightField` (cubed_sphere.h) is left
// BIT-FOR-BIT UNCHANGED — the pinned crack-free determinism tests (WV1–WV3) and
// the deposit catalog still see the identical canonical heights. The designed
// relief is layered on TOP via `sampleDesignedHeight`, which callers opt into;
// it preserves the shared-edge bit-identity property because the biome + the
// modulation are themselves pure functions of the (bit-identical) shared dir.
//
// Header-only. Consumes cubed_sphere.h + deposits.h READ-ONLY.
// =============================================================================
#include <cstdint>
#include <cmath>
#include <vector>
#include <algorithm>

#include "of/vec3.h"
#include "of/universe_coord.h"
#include "of/cubed_sphere.h"
#include "of/deposits.h"

namespace of {
namespace worldgen {

// =============================================================================
// §1 — The biome set.
//
// A small, designed palette covering a planet's climate zones plus a moon's
// airless surface variety. The planet biomes are climate-driven (latitude ->
// temperature, position-hashed moisture, elevation); the moon biomes are
// elevation / crater driven (airless: no oceans, no latitude bands worth
// speaking of). Kept as one enum so `materialForBiome` is total.
// =============================================================================
enum class Biome : uint8_t {
  Ocean = 0,     // below sea level (planet)
  Beach,         // narrow band just above sea level
  Plains,        // low, flat, temperate
  Forest,        // moist temperate (vegetated)
  Hills,         // moderate relief
  Mountains,     // high ridged relief (cold above tree line)
  Polar,         // high-latitude ice / snow (planet poles)
  // --- moon (airless) biomes ---
  Regolith,      // default dusty moon surface
  MoonHighland,  // raised, brighter highland
  CraterFloor,   // depressed crater interior
  Unknown,       // guard (never returned)
  COUNT
};

// =============================================================================
// §2 — Climate substrate (position-hashed, WG-6).
//
// Two smooth fBm fields over the dir give a temperature offset and a moisture
// value; latitude supplies the dominant temperature gradient (poles cold). All
// position-hashed so they are deterministic and seam-consistent.
// =============================================================================

// Relief denominator, guarded. One place so every consumer agrees.
inline double reliefDenom(const BodyParams& body) {
  return (body.maxReliefM > 0.0) ? body.maxReliefM : 1.0;
}

// Normalised relief in [-1,1]-ish: relief / maxRelief (planet datum-relative).
inline double normalizedRelief(const BodyParams& body, const Vec3& dir) {
  return sampleHeightField(body, dir) / reliefDenom(body);
}

// Temperature in roughly [0,1]: 1 = hot (equator, low), 0 = cold (pole, high).
// latitude gradient + altitude lapse + a position-hashed wobble.
//
// The `H` form takes an ALREADY-SAMPLED raw height. Every caller on the designed
// -height path has one in hand; the old signature re-entered the whole noise
// stack to get it back, which is why sampleDesignedHeight was evaluating the
// height field THREE times per vertex (WG-25).
//
// DW-14: cos(lat) is computed as sqrt(1 - dir.y^2), not cos(asin(dir.y)). dir.y
// IS sin(lat) by construction, sqrt is correctly rounded on every IEEE-754
// toolchain, and asin/cos are not, so this drops two libm calls from the hot
// path AND removes a 1-ULP mingw-vs-musl divergence from the biome classifier.
inline double temperatureAtH(const BodyParams& body, const Vec3& dir, double h) {
  double y = dir.y;
  if (y > 1.0) y = 1.0;
  if (y < -1.0) y = -1.0;
  const double latFactor = std::sqrt(1.0 - y * y);   // == cos(lat), exactly
  const double alt = std::max(0.0, h / reliefDenom(body));  // altitude lapse
  // Position-hashed wobble (channel 0xC11A7E) so isotherms aren't perfect bands.
  const double wob = 0.12 * fbm(body.bodySeed, dir, 4.0, 3, 0xC11A7Eu);
  double t = 0.5 * latFactor + 0.5 * (1.0 - 0.6 * alt) + wob - 0.25;
  if (t < 0.0) t = 0.0;
  if (t > 1.0) t = 1.0;
  return t;
}

inline double temperatureAt(const BodyParams& body, const Vec3& dir) {
  return temperatureAtH(body, dir, sampleHeightField(body, dir));
}

// Moisture in [0,1]: position-hashed fBm; biases Forest vs Plains.
inline double moistureAt(const BodyParams& body, const Vec3& dir) {
  const double m = 0.5 + 0.5 * fbm(body.bodySeed, dir, 3.0, 4, 0x305u);
  return std::max(0.0, std::min(1.0, m));
}

// =============================================================================
// §3 — biomeAt: the classifier.
//
// PURE function of (body, dir). Drives off latitude (poles cold), elevation
// (from the canonical heightfield), and the position-hashed temperature/moisture
// climate. Planet and moon use distinct rule sets (moon is airless).
// =============================================================================
// --- Classifier thresholds (normalised relief). Named so terrain tuning and the
//     biome map can be reasoned about together. WG-25 retuned Mountains/Hills
//     after the noise stack changed the relief distribution.
static constexpr double kBeachBandRel = 0.010;   // above datum -> beach
static constexpr double kHillsRel     = 0.150;   // above this -> Hills
static constexpr double kMountainsRel = 0.330;   // above this -> Mountains
// |sin(lat)| at lat = 1.30 rad (~74.5 deg), the polar-cap latitude. Held as
// sin(lat) rather than lat so the test needs no asin on the hot path (DW-14).
static constexpr double kPolarSinLat  = 0.9635581854171929;

inline Biome biomeAtPlanetH(const BodyParams& body, const Vec3& dir, double h) {
  const double denom = reliefDenom(body);
  const double rel = h / denom;
  const double seaRel = body.seaLevelM / denom;

  // Polar caps: high latitude OR very cold high terrain -> snow/ice.
  // |dir.y| IS |sin(lat)|, so no asin is needed (DW-14).
  if (std::fabs(dir.y) > kPolarSinLat ||
      (rel > seaRel && temperatureAtH(body, dir, h) < 0.18)) {
    return Biome::Polar;
  }
  // Ocean: at/below the relief datum. Since WG-25 the raw field is no longer
  // clamped at the datum, so this is genuinely "below sea level", not "in the
  // flat clamp band".
  if (rel <= seaRel) return Biome::Ocean;
  if (rel <= seaRel + kBeachBandRel) return Biome::Beach;
  if (rel > kMountainsRel) return Biome::Mountains;
  if (rel > kHillsRel) return Biome::Hills;
  // Low land: forest if moist, plains otherwise. Moisture is sampled ONLY here
  // (4 valueNoise calls) instead of unconditionally, same value, fewer calls.
  return (moistureAt(body, dir) > 0.55) ? Biome::Forest : Biome::Plains;
}

inline Biome biomeAtPlanet(const BodyParams& body, const Vec3& dir) {
  return biomeAtPlanetH(body, dir, sampleHeightField(body, dir));
}

// Airless: no oceans, no forests. Elevation bands only.
//
// WG-141 RE-TUNED THE THRESHOLDS, and the reason is worth keeping because it is
// a coupling that is easy to miss: `maxReliefM` is BOTH the declared relief
// bound AND the denominator these bands are expressed in. Raising it to cover
// the crater ladder's real extremes therefore widened every band at the same
// time, and the split went to Regolith 89.9% / MoonHighland 2.0% / CraterFloor
// 8.1%. A biome carrying 2% of a body is a biome whose props and palette will
// essentially never be drawn.
//
// The bands are narrow because the field's mass is narrow: the base fbm puts
// most ground within a few hundred metres of the datum and the crater ladder
// supplies the tails, so a threshold placed at a fifth of maxRelief sits far out
// in the tail. `moon_biomes_are_all_populated` asserts the split and will catch
// the next person who moves maxReliefM without looking here.
inline Biome biomeAtMoonH(const BodyParams& body, double h) {
  const double rel = h / reliefDenom(body);
  if (rel < -0.070) return Biome::CraterFloor;   // crater interiors
  if (rel > 0.070) return Biome::MoonHighland;   // raised, rough highland
  return Biome::Regolith;                         // the dusty plain / mare
}

inline Biome biomeAtMoon(const BodyParams& body, const Vec3& dir) {
  return biomeAtMoonH(body, sampleHeightField(body, dir));
}

inline Biome biomeAt(const BodyParams& body, const Vec3& dir) {
  return body.kind == kPlanet ? biomeAtPlanet(body, dir)
                              : biomeAtMoon(body, dir);
}

// Convenience: classify by geo coords (lat/lon in radians).
inline Biome biomeAtLatLon(const BodyParams& body, double lat, double lon) {
  return biomeAt(body, latLonToDir(lat, lon));
}

// =============================================================================
// §4 — materialForBiome: surface-material id for the renderer / chunk.
//
// A uint16 material id per biome — terrain_stream.h's TerrainChunk.materialId and
// the UE renderer pick a material/texture by this id. Stable values (append new
// biomes at the end; never renumber an existing one — these cross the contract).
// =============================================================================
enum : uint16_t {
  kMatOcean        = 0,
  kMatBeach        = 1,
  kMatPlains       = 2,
  kMatForest       = 3,
  kMatHills        = 4,
  kMatMountains    = 5,
  kMatPolar        = 6,
  kMatRegolith     = 7,
  kMatMoonHighland = 8,
  kMatCraterFloor  = 9,
  kMatUnknown      = 0xFFFF,
};

inline uint16_t materialForBiome(Biome b) {
  switch (b) {
    case Biome::Ocean:        return kMatOcean;
    case Biome::Beach:        return kMatBeach;
    case Biome::Plains:       return kMatPlains;
    case Biome::Forest:       return kMatForest;
    case Biome::Hills:        return kMatHills;
    case Biome::Mountains:    return kMatMountains;
    case Biome::Polar:        return kMatPolar;
    case Biome::Regolith:     return kMatRegolith;
    case Biome::MoonHighland: return kMatMoonHighland;
    case Biome::CraterFloor:  return kMatCraterFloor;
    case Biome::Unknown:
    case Biome::COUNT:        return kMatUnknown;
  }
  return kMatUnknown;
}

// Surface hardness in [0,1] per biome (feeds physics's SurfaceHardness, WG-10):
// ice/rock hard, sand/plains soft. Deterministic from biome only.
inline double hardnessForBiome(Biome b) {
  switch (b) {
    case Biome::Ocean:        return 0.10;  // (water-ish / shore mud)
    case Biome::Beach:        return 0.30;  // sand
    case Biome::Plains:       return 0.45;
    case Biome::Forest:       return 0.50;
    case Biome::Hills:        return 0.65;
    case Biome::Mountains:    return 0.90;  // rock
    case Biome::Polar:        return 0.80;  // ice
    case Biome::Regolith:     return 0.55;
    case Biome::MoonHighland: return 0.75;
    case Biome::CraterFloor:  return 0.60;
    default:                  return 0.50;
  }
}

// =============================================================================
// §5 — sampleDesignedHeight: per-biome RELIEF MODULATION (the "design" layer).
//
// Layered ADDITIVELY on top of the canonical sampleHeightField (which is left
// bit-for-bit unchanged so the pinned WV1–WV3 tests still pass). The modulation
// is a pure function of the (bit-identical) shared dir + the biome at that dir,
// so it PRESERVES the crack-free shared-edge bit-identity: a vertex on a seam has
// the same dir from either quad -> the same base height, the same biome, the same
// modulation -> the same designed height bits.
//
// Relief character per biome:
//   Mountains    -> AMPLIFY ridged relief (sharper, higher peaks).
//   Hills        -> moderate amplification.
//   Plains       -> FLATTEN toward the datum.
//   Beach        -> nearly flat just above datum.
//   Forest       -> gentle rolling (slight amplification of low relief).
//   Ocean        -> pulled BELOW the datum (a real basin, not a flat clamp).
//   Polar        -> smoothed ice sheet (flatten, slight raise for the cap).
//   Regolith     -> unchanged base.
//   MoonHighland -> slight raise. CraterFloor -> slight deepen.
// =============================================================================
inline double designedReliefFactor(Biome b) {
  // Multiplicative gain applied to the base relief above the datum.
  //
  // NOTHING READS THIS FOR SHAPING ANY MORE. It is retained as the DESCRIPTION
  // of the relief character each biome is meant to have, and as the table the
  // two continuous gain curves below were derived from.
  //
  // WG-141 retired its last caller, the moon. The comment that used to sit here
  // claimed the moon's bands were "close enough together not to step", and that
  // claim was false and had never been measured. `terrain_probe --body cinder`
  // measured the steps directly: the 1.00 -> 1.15 jump at rel 0.20 puts a 120 m
  // wall along a contour line, and the 1.00 -> 1.10 jump at rel -0.10 puts a
  // 40 m one. They show up in the biome histogram as gaps no sample can land in
  // (Regolith topping out at 797.9 m with MoonHighland starting at 923.9 m).
  // This is the same defect WG-25 fixed on the planet, one body later, and it is
  // the third thing about Cinder that was simply never revisited.
  switch (b) {
    case Biome::Mountains:    return 1.60;
    case Biome::Hills:        return 1.25;
    case Biome::Forest:       return 1.05;
    case Biome::Plains:       return 0.45;
    case Biome::Beach:        return 0.15;
    case Biome::Polar:        return 0.70;
    case Biome::MoonHighland: return 1.15;
    case Biome::CraterFloor:  return 1.10;
    case Biome::Regolith:     return 1.00;
    case Biome::Ocean:        return 1.00;
    default:                  return 1.00;
  }
}

// -----------------------------------------------------------------------------
// designedGainForRelief: the CONTINUOUS relief-shaping curve (WG-25).
//
// WHY THIS EXISTS. The old design layer switched the gain on the DISCRETE biome,
// which made the shaped surface DISCONTINUOUS at every biome boundary. Measured
// on Forge at world seed 0x0bf00d01, the two adjacent samples with the largest
// step were 985 metres apart VERTICALLY at a horizontal spacing of 100 m: at the
// Hills/Mountains threshold, 2700 m of base relief read 3375 m on the Hills side
// (gain 1.25) and 4320 m on the Mountains side (gain 1.60). Every coastline had
// a ~1.2 km wall for the same reason (Ocean jumped to a separately-generated
// basin depth), and the Plains/Forest moisture threshold added an ~860 m one.
//
// Terrain made of flat plateaus separated by kilometre-tall vertical steps is
// precisely the "mountains look like lumps" complaint: the plateaus read as
// domes and the steps read as unclimbable walls. So the gain is now a smoothstep
// blend over the SAME relief bands: monotone (d/drel of rel*gain > 0 everywhere)
// and C1, so lowland still flattens and highland still steepens, with no step
// anywhere on the planet.
//
// Multiply/add only: no trig, no pow (DW-14).
inline double designedGainForRelief(double rel) {
  double g = 1.15;                                        // sea floor: real basin
  g = lerp(g, 0.30, smoothstep(-0.030, 0.008, rel));      // shore / beach: flat
  g = lerp(g, 0.60, smoothstep(0.008, 0.070, rel));       // plains
  g = lerp(g, 1.15, smoothstep(0.090, 0.260, rel));       // hills
  g = lerp(g, 1.45, smoothstep(0.300, 0.520, rel));       // mountains
  return g;
}

// designedGainForMoonRelief: the same cure, for the moon (WG-141).
//
// The bands are the moon's own, straddling biomeAtMoonH's thresholds rather than
// switching on them, so the BIOME stays discrete (it is a material id, it should
// be) while the HEIGHT stays continuous. Values come from designedReliefFactor's
// moon rows: crater floors deepen slightly, the regolith plain is unchanged, the
// highland steepens.
//
// Monotone, which is the property that matters: d(rel * g)/drel stays positive
// across both blends (checked at the band edges, worst case 1.25), so higher
// base relief always means higher shaped ground and the design layer can never
// fold the terrain over itself.
//
// Multiply/add only: no trig, no pow (DW-14).
inline double designedGainForMoonRelief(double rel) {
  double g = 1.10;                                     // crater floor: deepen
  g = lerp(g, 1.00, smoothstep(-0.130, -0.010, rel));  // regolith plain
  g = lerp(g, 1.15, smoothstep(0.010, 0.130, rel));    // highland: steepen
  return g;
}

// -----------------------------------------------------------------------------
// designedHeightNoPad: the designed surface BEFORE the home flat pad.
//
// Split out from sampleDesignedHeight so the pad can be a strict wrapper and so
// tests can prove that outside the blend radius the two are BIT-IDENTICAL.
inline double designedHeightNoPad(const BodyParams& body, const Vec3& dir) {
  const double base = sampleHeightField(body, dir);
  const double denom = reliefDenom(body);

  if (body.kind == kPlanet) {
    const double above = base - body.seaLevelM;
    double shaped = body.seaLevelM + above * designedGainForRelief(above / denom);
    // Smooth ice-cap dome. Driven by |sin(lat)| = |dir.y| so it needs no trig
    // (DW-14) and, being a smoothstep, adds no step at the polar biome edge,
    // the old version added a flat 0.04*maxRelief the instant |lat| crossed
    // 1.30 rad, i.e. a 240 m wall ringing both poles.
    shaped += 0.030 * body.maxReliefM *
              smoothstep(0.945, 0.990, std::fabs(dir.y));
    return shaped;
  }

  // Moon: scale relief by the CONTINUOUS gain about zero (no datum clamp).
  // Was `designedReliefFactor(biomeAtMoonH(base))`, which stepped on the
  // discrete biome and walled the contour lines; see the note on that function.
  return base * designedGainForMoonRelief(base / denom);
}

// -----------------------------------------------------------------------------
// designedHeightNoPond: the designed surface WITH the pad and WITHOUT the pond.
//
// = designedHeightNoPad, with the body's HOME FLAT PAD blended in. Because the
// pad lives here, the mesh, collision, the walker, voxel solidity, deposit
// snapping and build placement all see the level pad with NO special case
// anywhere.
//
// Outside homeBlendRadiusM the function returns designedHeightNoPad's value
// UNCHANGED: the same double, not a rounded copy, so the pad perturbs a 600 m
// disc and leaves the other 99.9999% of the planet bit-identical.
//
// WG-36 renamed this out of sampleDesignedHeight and left the body untouched.
// It is public rather than a detail because it is the ONE thing that can answer
// "how high would the ground here be if there were no pond", which is what the
// pond's water level is measured down from. Deriving the water level from
// sampleDesignedHeight instead would be circular: the basin is subtracted from
// exactly the height the water is supposed to be referenced to.
inline double designedHeightNoPond(const BodyParams& body, const Vec3& dir) {
  const double h = designedHeightNoPad(body, dir);
  if (body.homeFlatRadiusM <= 0.0) return h;          // no pad on this body

  // Arc distance from the pad centre. chord = 2*sin(theta/2) and theta is at
  // most 8e-4 rad here, so arc = radiusM * chord to within 1e-10 m. sqrt only,
  // no asin, no acos (DW-14).
  const double dx = dir.x - body.homeDir.x;
  const double dy = dir.y - body.homeDir.y;
  const double dz = dir.z - body.homeDir.z;
  const double distM =
      body.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
  if (distM >= body.homeBlendRadiusM) return h;       // untouched, bit-identical

  // t = 0 inside the flat radius, 1 at the blend radius.
  const double t =
      smoothstep(body.homeFlatRadiusM, body.homeBlendRadiusM, distM);
  const double padH = designedHeightNoPad(body, body.homeDir);
  // Written pad-first so t == 0 returns padH EXACTLY (dead flat, bit-exact)
  // rather than padH plus a rounding residue.
  return padH + (h - padH) * t;
}

// -----------------------------------------------------------------------------
// pondBasinDropM (WG-36): metres of GROUND removed by the home pond's basin.
//
// A pond you can only see is a decal. This is the thing that makes it a place:
// the ground actually goes DOWN, so there is a floor to stand on, a slope to
// wade down, and a volume for water to be in.
//
// Profile: drop(t) = depth * (1 - smoothstep(0,1,t)), t = dist/pondRadiusM.
// smoothstep is C1 with zero derivative at BOTH ends, which buys two things
// that matter more than they look:
//   * at t = 1 the basin meets the surrounding ground TANGENTIALLY, so the rim
//     is not a cliff and no LOD level ever has to resolve a step there;
//   * at t = 0 the floor is locally flat, so the deepest part is a bed rather
//     than a point, which is what makes it read as a pond and not a funnel.
// The steepest grade is at t = 0.5 and is 1.5 * depth / radius, which for the
// shipped 4 m / 22 m is 0.273 (15.3 deg) - inside CAPSULE.slopeLimitCos, so
// the whole basin is walkable and the player wades rather than slides.
//
// Returns EXACTLY 0.0 at and beyond pondRadiusM, so subtracting it leaves the
// rest of the planet's designed height bit-identical.
//
// Multiply/add and one sqrt only: no trig, no pow (DW-14).
inline double pondBasinDropM(const BodyParams& body, const Vec3& dir) {
  if (body.pondRadiusM <= 0.0) return 0.0;            // no pond on this body
  const double dx = dir.x - body.pondDir.x;
  const double dy = dir.y - body.pondDir.y;
  const double dz = dir.z - body.pondDir.z;
  const double distM =
      body.radiusM * std::sqrt(dx * dx + dy * dy + dz * dz);
  if (distM >= body.pondRadiusM) return 0.0;          // untouched, bit-identical
  const double t = distM / body.pondRadiusM;
  return body.pondDepthM * (1.0 - smoothstep(0.0, 1.0, t));
}

// -----------------------------------------------------------------------------
// sampleDesignedHeight: THE surface authority (standing rule 1).
//
// The pad, then the basin. Both are terrain. NEITHER is the water level: this
// function answers "where is the GROUND" and nothing else, everywhere on the
// body, including under the pond. See water_field.h for the other question.
inline double sampleDesignedHeight(const BodyParams& body, const Vec3& dir) {
  return designedHeightNoPond(body, dir) - pondBasinDropM(body, dir);
}

// Designed height at a geo coord (mirrors SampleTerrainHeight but designed).
inline double SampleDesignedTerrainHeight(const BodyParams& body, double lat,
                                          double lon) {
  return sampleDesignedHeight(body, latLonToDir(lat, lon));
}

// =============================================================================
// §6 — Planet-WIDE resource distribution, biased by biome.
//
// The planet-scale generalisation of deposits.h's GenerateDeposits: a
// deterministic placement pass over the WHOLE body whose RESOURCE choice +
// DENSITY are biased by the biome at each candidate, so ore concentrates where it
// should (iron/copper/coal/stone in hills/mountains; sparse elsewhere). Same
// determinism discipline (position-hashed, WG-6); queryable by region (cube quad)
// so the streamer/renderer can populate the planet on the fly.
//
// Resource ids reuse the survival raw-resource block (deposits.h §S) — these are
// the planet-wide terrestrial ores; the off-world Cinderite hook (WG-4) is still
// honoured (Cinderite only on the moon). `Resource` stays an OPAQUE gameplay
// ItemId (WG-11): world-gen owns only PLACEMENT.
// =============================================================================

// Which resource a biome favours, and how likely a candidate there spawns one.
// Returns true + fills (resource, spawnProb) if this biome hosts deposits.
inline bool biomeResource(const BodyParams& body, Biome b, const Vec3& dir,
                          ItemId& outResource, double& outSpawnProb) {
  // Moon: the off-world hook (WG-4) — Cinderite-dominant, never on a planet.
  if (body.kind == kMoon) {
    const double r = hashToUnit(hashPos(body.bodySeed, dir, 0xC1DEu));
    outResource = (r < 0.7) ? kItemCinderite : kItemFerriteOre;
    // Crater floors expose more ore (impact gardening); highlands less.
    outSpawnProb = (b == Biome::CraterFloor) ? 0.16
                 : (b == Biome::MoonHighland) ? 0.07
                                              : 0.10;
    return true;
  }

  // Planet: biome-biased terrestrial ores. Pick among the survival ore block.
  const double pick = hashToUnit(hashPos(body.bodySeed, dir, 0x0E5Cu));
  switch (b) {
    case Biome::Mountains:
      // Mountains: rich in iron + copper + coal + stone.
      outSpawnProb = 0.22;
      outResource = (pick < 0.35) ? survival::kItemRawIron
                  : (pick < 0.60) ? survival::kItemRawCopper
                  : (pick < 0.82) ? survival::kItemCoal
                                  : survival::kItemStone;
      return true;
    case Biome::Hills:
      // Hills: the prime ore zone (iron/copper heavy).
      outSpawnProb = 0.26;
      outResource = (pick < 0.40) ? survival::kItemRawIron
                  : (pick < 0.70) ? survival::kItemRawCopper
                  : (pick < 0.88) ? survival::kItemStone
                                  : survival::kItemCoal;
      return true;
    case Biome::Plains:
      // Plains: sparse, mostly stone + the occasional iron.
      outSpawnProb = 0.08;
      outResource = (pick < 0.65) ? survival::kItemStone
                  : (pick < 0.90) ? survival::kItemRawIron
                                  : survival::kItemCoal;
      return true;
    case Biome::Forest:
      // Forest: wood + a little stone (oil seeps in lowland forest).
      outSpawnProb = 0.18;
      outResource = (pick < 0.55) ? survival::kItemWood
                  : (pick < 0.80) ? survival::kItemStone
                  : (pick < 0.92) ? survival::kItemRawIron
                                  : survival::kItemOil;
      return true;
    case Biome::Beach:
      // Beaches: occasional stone only.
      outSpawnProb = 0.05;
      outResource = survival::kItemStone;
      return true;
    case Biome::Polar:
      // Polar: scarce; mostly stone (ore frozen under ice).
      outSpawnProb = 0.06;
      outResource = (pick < 0.7) ? survival::kItemStone : survival::kItemRawIron;
      return true;
    case Biome::Ocean:
      // No surface deposits in open ocean (oil offshore is a Phase-4 concern).
      outSpawnProb = 0.0;
      outResource = 0;
      return false;
    default:
      outSpawnProb = 0.0;
      outResource = 0;
      return false;
  }
}

// Per-kind base extractable amount (item units) for the planet-wide ores.
inline double planetResourceBaseAmount(ItemId r) {
  if (r == survival::kItemRawIron)   return 200000.0;
  if (r == survival::kItemRawCopper) return 180000.0;
  if (r == survival::kItemCoal)      return 150000.0;
  if (r == survival::kItemStone)     return 300000.0;
  if (r == survival::kItemWood)      return 30000.0;
  if (r == survival::kItemOil)       return 90000.0;
  if (r == kItemCinderite)           return 50000.0;
  if (r == kItemFerriteOre)          return 120000.0;
  return 100000.0;
}

// -----------------------------------------------------------------------------
// GenerateBiomeDeposits: the planet-WIDE, biome-biased placement pass.
//
// Deterministic from (bodySeed, body): a denser Fibonacci-sphere candidate
// lattice than the small catalog, each candidate position-hashed for existence
// (gated by the candidate's biome spawn probability), resource chosen by biome,
// surface-snapped to the DESIGNED height so nodes sit on the shaped terrain.
// Stable hashed id (face region + candidate ordinal). Cinderite only on the moon.
// -----------------------------------------------------------------------------
inline std::vector<FDepositNode> GenerateBiomeDeposits(const BodyParams& body,
                                                       uint64_t bodySeed,
                                                       FrameId bodyFrame) {
  std::vector<FDepositNode> out;
  // A planet-scale candidate count (denser than the small catalog) so the whole
  // sphere is covered; spawn probability gates how many actually land.
  const int count = (body.kind == kPlanet) ? 8192 : 4096;

  for (int n = 0; n < count; ++n) {
    Vec3 cand = fibonacciDir(n, count);
    // Small position-hashed jitter (same discipline as GenerateDeposits).
    const Vec3 jit(hashToSigned(hashPos(bodySeed, cand, 0x1A)) * 0.01,
                   hashToSigned(hashPos(bodySeed, cand, 0x2B)) * 0.01,
                   hashToSigned(hashPos(bodySeed, cand, 0x3C)) * 0.01);
    Vec3 p(cand.x + jit.x, cand.y + jit.y, cand.z + jit.z);
    double invLen = 1.0 / p.length();
    const Vec3 dir(p.x * invLen, p.y * invLen, p.z * invLen);

    const Biome b = biomeAt(body, dir);
    ItemId resource = 0;
    double spawnProb = 0.0;
    if (!biomeResource(body, b, dir, resource, spawnProb)) continue;

    // Existence: position-hashed acceptance gated by the biome's spawn prob.
    const double exist = hashToUnit(hashPos(bodySeed, dir, 0xB10DEu));
    if (exist >= spawnProb) continue;

    FDepositNode node;
    // Snap to the DESIGNED surface (so the node sits on the shaped terrain).
    const double h = sampleDesignedHeight(body, dir);
    const double radius = body.radiusM + h;
    node.Position = UniverseCoord(dir * radius, bodyFrame);
    dirToLatLon(dir, node.Lat, node.Lon);
    node.SurfaceNormal = dir;  // approx radial-up (fine for placement)
    node.Body = body.bodyId;
    node.Resource = resource;
    node.Grade = static_cast<float>(
        0.3 + 0.7 * hashToUnit(hashPos(bodySeed, dir, 0x67ade)));
    node.InitialAmount = planetResourceBaseAmount(resource) * node.Grade;
    node.RemainingAmount = node.InitialAmount;
    const uint64_t region = static_cast<uint64_t>(faceOfDir(dir));
    uint64_t id = mix64(bodySeed ^ 0xB10DE5u);
    id = hashCombine(id, region);
    id = hashCombine(id, static_cast<uint64_t>(n));
    node.Id = id;

    out.push_back(node);
  }
  return out;
}

// =============================================================================
// §7 — BiomeResourceField: holds the planet-wide catalog + a REGION query.
//
// The streamer/renderer asks "what deposits are in/near this cube quad?" as it
// streams a region in, instead of scanning the whole planet. We answer by the
// quad's angular extent on the sphere (a quad covers a cone of directions; a
// deposit is "in" the quad if its dir falls within the quad's angular footprint,
// padded by a margin for nodes just over the edge).
// =============================================================================
class BiomeResourceField {
 public:
  BiomeResourceField() = default;
  explicit BiomeResourceField(std::vector<FDepositNode> nodes)
      : nodes_(std::move(nodes)) {}

  static BiomeResourceField ForBody(const BodyParams& body, uint64_t bodySeed,
                                    FrameId bodyFrame) {
    return BiomeResourceField(GenerateBiomeDeposits(body, bodySeed, bodyFrame));
  }

  const std::vector<FDepositNode>& GetDeposits() const { return nodes_; }
  size_t size() const { return nodes_.size(); }

  // Deposits whose direction falls within the angular footprint of cube quad
  // `key` (on body `body`), padded by `marginRad` so a node just over the seam is
  // still returned to the abutting region. Cheap angular containment test.
  std::vector<FDepositNode> QueryRegionDeposits(const BodyParams& body,
                                                const FQuadKey& key,
                                                double marginRad = 0.0) const {
    // The quad's centre dir + its angular radius (centre-to-corner half-angle).
    const Vec3 c = quadCenterDirLocal(key);
    const double halfAngle = quadAngularRadius(key) + marginRad;
    const double cosThresh = std::cos(std::min(3.14159265358979323846, halfAngle));
    std::vector<FDepositNode> hits;
    for (const FDepositNode& d : nodes_) {
      const Vec3 nd = nodeDir(body, d);
      if (nd.dot(c) >= cosThresh) hits.push_back(d);
    }
    return hits;
  }

  // Mutating queries mirror DepositCatalog so callers can use either uniformly.
  bool GetDeposit(DepositId id, FDepositNode& out) const {
    for (const FDepositNode& d : nodes_) {
      if (d.Id == id) { out = d; return true; }
    }
    return false;
  }
  double ExtractFromDeposit(DepositId id, double requested) {
    if (requested <= 0.0) return 0.0;
    for (FDepositNode& d : nodes_) {
      if (d.Id == id) {
        const double g = std::min(requested, d.RemainingAmount);
        d.RemainingAmount -= g;
        if (d.RemainingAmount < 0.0) d.RemainingAmount = 0.0;
        return g;
      }
    }
    return 0.0;
  }

 private:
  // Recover a node's unit direction from its body-relative position.
  static Vec3 nodeDir(const BodyParams& body, const FDepositNode& d) {
    (void)body;
    const Vec3& p = d.Position.pos;
    const double l = p.length();
    return (l > 0.0) ? Vec3(p.x / l, p.y / l, p.z / l) : Vec3(0, 1, 0);
  }
  // Quad centre dir (mirrors terrain_stream's quadCenterDir without including it).
  static Vec3 quadCenterDirLocal(const FQuadKey& k) {
    const double denom = static_cast<double>(uint64_t(1) << k.depth);
    const double u = -1.0 + 2.0 * (static_cast<double>(k.qx) + 0.5) / denom;
    const double v = -1.0 + 2.0 * (static_cast<double>(k.qy) + 0.5) / denom;
    return unitDir(k.faceId, u, v);
  }
  // Half-angle from the quad centre to a corner (the quad's angular radius).
  static double quadAngularRadius(const FQuadKey& k) {
    const double denom = static_cast<double>(uint64_t(1) << k.depth);
    const double u0 = -1.0 + 2.0 * (static_cast<double>(k.qx)) / denom;
    const double v0 = -1.0 + 2.0 * (static_cast<double>(k.qy)) / denom;
    const Vec3 ctr = quadCenterDirLocal(k);
    const Vec3 corner = unitDir(k.faceId, u0, v0);
    double d = ctr.dot(corner);
    if (d > 1.0) d = 1.0;
    if (d < -1.0) d = -1.0;
    return std::acos(d);
  }

  std::vector<FDepositNode> nodes_;
};

}  // namespace worldgen
}  // namespace of
