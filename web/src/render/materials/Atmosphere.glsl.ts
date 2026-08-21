// THE atmospheric scattering model. One implementation, shared as a GLSL string
// by SkyAtmosphere (the sky pass) and TerrainMaterial (aerial perspective), which
// is what makes the near scene and the scaled far scene agree at the horizon
// instead of seaming (ARCHITECTURE.md sections 4.4 and 7.3).
//
// Analytic single scattering, Rayleigh + Mie, ray-marched. Physically plausible
// is the target, not physically exact.
//
// Every position handed to these functions is PLANET-CENTRED METRES. The two
// callers differ only in how they get there: the near scene subtracts the body
// centre, the far scene multiplies by metres-per-unit. Same numbers, same
// function, so the horizon cannot disagree with the sky.

import * as THREE from 'three';
import { ATMOSPHERE_CHAPMAN, ATMOSPHERE_LAYER } from './AtmosphereAero.glsl.js';

export interface AtmosphereParams {
  /** Ground radius in metres: the shell light rays are occluded by. */
  planetRadiusM: number;
  /** Atmosphere thickness above the ground radius. */
  thicknessM: number;
  /** Rayleigh and Mie density scale heights. */
  rayleighScaleM: number;
  mieScaleM: number;
  /** Rayleigh scattering coefficients per metre, RGB. */
  betaR: THREE.Vector3;
  /** Mie scattering coefficient per metre (grey). */
  betaM: number;
  /** Mie anisotropy. */
  mieG: number;
  /** Radiance scale for the sun disc. */
  sunIntensity: number;
  /**
   * BOUNDARY-LAYER AEROSOL, the term that produces aerial perspective at
   * PLAYABLE range: (extinction per metre at the datum, scale height in metres,
   * isotropic multiple-scattering fraction of the phase).
   *
   * It exists because Rayleigh is CORRECT and therefore useless here. Molecular
   * scattering moves a ridge by about one part in a hundred over the 200 m to
   * 3 km a player actually looks across, and the measurement said so: near band
   * against far band in one capture reads saturation -0.186, i.e. the DISTANT
   * ground is MORE saturated than the ground at the player's feet, which is
   * backwards. Real outdoor haze at that range is aerosol, it lives in the first
   * kilometre or so of the column, and nothing in a Rayleigh plus Mie sky model
   * represents it.
   */
  aerosolSigma: number;
  aerosolScaleM: number;
  aerosolMs: number;
  /** Haze radiance multiplier on uSunColor. Grey ON PURPOSE: see the note. */
  aerosolTint: THREE.Vector3;
  /** Aerosol phase anisotropy. */
  aerosolG: number;
  /**
   * RN-2175. THE SCATTERING CURVATURE THE SUN PATH IS INTEGRATED AGAINST, as a
   * MULTIPLE of `planetRadiusM`. 1 is the body's own curvature and is the
   * physically literal answer; see `forgeAtmosphere` for why Forge ships more.
   * Only the grazing half of the day can feel it: `ofChapman`'s high-sun limit
   * is H / sin(elevation) whatever R is.
   */
  sunCurveK: number;
}

/**
 * Forge: 600 km ground radius, 5.6 km Rayleigh scale height (D-006), Earth
 * coefficients. Tuned by rendering, not by derivation: sunIntensity sets the
 * absolute level the ACES curve sees, and betaM sets how fast a distant ridge
 * turns to haze. The first pass at 1.5x Earth betaR put a 25 km mesa at pure
 * white, which is arguably correct for Earth and useless as a game image.
 */
export function forgeAtmosphere(planetRadiusM: number): AtmosphereParams {
  return {
    planetRadiusM,
    thicknessM: 6.0e4,
    rayleighScaleM: 5.6e3,
    mieScaleM: 1.2e3,
    betaR: new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6),
    betaM: 3.5e-6,
    mieG: 0.76,
    sunIntensity: 15.0,
    // RN-2175. 4.5e-4 -> 1.4e-4 PER METRE, i.e. a Koschmieder visual range of
    // 8.7 km -> 27.9 km, which is the world audit's gap 1 in its own words:
    // "the ordering is right at every rung; only the magnitude is wrong".
    //
    // WHAT IT IS MEASURED AGAINST, because the audit's own two instruments turn
    // out not to measure this term (NUMBERS.md, and the lane report). `?atmos=0`
    // deletes the SKY BOX, so a horizon-straddling rectangle fills a third of
    // itself with void; and `flyover.hzBand` straddles the horizon, so a third
    // of it is sky the aerosol cannot reach by construction. Against the honest
    // control -- `?aerosol=0`, sky intact, every sky rectangle bit-identical --
    // the flyover's all-ground `box` reads iqr 27.36 hazed against 56.47 clear,
    // so the term was taking 51.6 per cent of the contrast off the ground of a
    // 1,200 m flight. 8.7 km of visibility is a hazy day by the WMO's own
    // table, and the bar (a 20 km silhouette desaturated and still legible) is
    // a clear one.
    //
    // WHAT IT COSTS, STATED: the vertical column through the layer is exactly
    // sigma x H, so the planet seen from orbit loses aerosol haze in the same
    // proportion, 0.18 of optical depth down to 0.056. Raising H to hold that
    // product was measured and rejected: a taller layer puts an eye at 1,200 m
    // back INSIDE it and gives most of the flyover's contrast straight back.
    // The `limb` shot is re-taken as a regression rather than assumed away, and
    // the limb's praise in the audit is Rayleigh's, not this term's.
    //
    // 1.4e-4 per metre with a 400 m scale height ABOVE THE LAYER'S BASE (see
    // `ofAtmoAerial`, which is where that reference is set, and why).
    //
    // The pair is chosen against two constraints that pull opposite ways, and
    // the tension between them is the whole of the tuning. sigma sets how fast
    // ground recedes: 4.5e-4 is a Koschmieder visual range of 8.7 km, which
    // gives 0.22 of optical depth at 500 m, 0.90 at 2 km and 2.25 at 5 km, i.e.
    // a ladder the eye can actually read at the range a player looks across. The
    // SCALE HEIGHT does not affect that at all for a horizontal ground-level
    // ray, and it is entirely about what the planet looks like FROM ORBIT: the
    // vertical column through the whole layer is exactly sigma x H, so 400 m
    // costs the scaled planet 0.18 of optical depth (16% haze) while 1,200 m
    // would cost it 0.54 and turn Forge into a grey ball. Measured both ways
    // rather than reasoned about, because the same term draws both frames.
    //
    // FIRST ATTEMPT'S NUMBERS, kept because the correction is the interesting
    // part: 3.0e-4 with a 1,200 m scale height measured off the DATUM. At the
    // Hills test site, whose ground stands at 860 m, that leaves exp(-860/1200)
    // = 0.49 of the layer at the player's own feet and moved 0.3% of the mid
    // band's pixels. Referencing the local ground instead is worth about 2x, and
    // it is worth it everywhere rather than only here.
    aerosolSigma: 1.4e-4,
    aerosolScaleM: 400,
    // 0.55 isotropic against a mild g = 0.35, and the two were set together to
    // compress the phase function's dynamic range rather than to be right.
    // Aerosol at this density is optically thick enough that real haze is
    // largely MULTIPLY scattered, so a floor is physical; but the reason for
    // THIS floor is that a single-scatter g = 0.55 lobe spans 45:1 between the
    // solar and anti-solar directions, which puts the haze well above the ground
    // it replaces on one side of the frame and well below it on the other, so
    // turning around would make the distance alternately glow and darken. At
    // g = 0.35 with a 0.55 floor the span is 2.8:1 and the haze is brighter than
    // the ground it veils in every direction, which is what "haze" means.
    aerosolMs: 0.55,
    aerosolG: 0.35,
    // GREY, and this is the whole finding of the first attempt. A blue-biased
    // coefficient (the physically tempting choice, and what Rayleigh does) does
    // not haze, it DARKENS: it extinguishes red hard and refills with saturated
    // blue, so the far band's mean red fell 70.2 to 57.0 while its saturation
    // moved by 0.004. Haze is a WHITE veil. The 0.34 in blue against 0.30 in red
    // is the only bias left, and it is small enough to read as air rather than
    // as a filter. The absolute level is set so the haze sits a little ABOVE the
    // radiance of the ground it veils in the anti-solar direction, because haze
    // that is darker than what it covers is not haze, it is a shadow.
    // RN-2175. NEUTRAL, NOT BLUE-BIASED, and the change is one third of audit
    // gap 8. This vector multiplies `uSunColor` to give the haze its radiance,
    // so it colours EVERY distant surface in the game; at (0.38, 0.39, 0.43) it
    // pushed the whole far field cold at every hour, which is precisely the
    // "brightens toward the sun and never reddens" the audit measured. The
    // first attempt's finding that a STRONGLY blue coefficient darkens rather
    // than hazes still stands and is why this is not warm either: it is flat,
    // and the colour of the haze now comes from `sunT`, which reddens on the
    // sun's own path. That is the term that should own it.
    // 0.32 and not the old 0.38-0.43, and the cut is what the SKY entry point
    // costs. The level was set against the GROUND the haze veils, so it is the
    // radiance of sunlit terrain; a sky ray at twenty degrees is looking at a
    // source three to five times darker, and the same level over-brightens it.
    // Measured on the `dawnsun` pose, which is the frame that finds this: at
    // 0.40 every sky rectangle looking INTO a 5.85 degree sun sits above 200
    // with hiFrac 0.5 to 0.65, i.e. the forward lobe clips the whole upper
    // frame.
    //
    // RN-2320, lane L3 COLOUR AT RANGE. NOT FLAT ANY MORE, and the reason the
    // flat version was wrong is arithmetic rather than taste: World Audit R2
    // measured whole-frame `warm` (meanR - meanB) NEGATIVE on all four daylight
    // aerial poses (`flyover` -10.55, `flyovernoon` -3.26, `forestair` -18.72,
    // `forestairnoon` -13.44) while eleven of twelve ground poses read warm-
    // positive, i.e. the world reads as a sea the moment the eye leaves the
    // ground. `sunT`'s reddening (2.19's own note, "that is the term that
    // should own it") only fires near the horizon; at a HIGH sun (`flyovernoon`
    // dot 0.897, `forestairnoon` dot 0.736) `sunT` is nearly white, so a flat
    // haze contributes no warmth at the two arms where the audit's numbers are
    // worst. `?aerosol=0` is the honest control and it says why a small warm
    // bias is safe rather than a repeat of the pre-RN-2175 mistake: with the
    // WHOLE aerosol term removed, `forestairnoon` reads warm -29.94 and
    // `flyovernoon` reads -12.94, both COLDER than the shipped flat-grey haze
    // (-13.44 / -3.26). So the haze is not the thing making the frame cold, the
    // sky and the ground it is compared against are, and a flat haze was
    // already the least-bad of the two directions; it just was not warm enough
    // to close the gap. (0.40, 0.31, 0.22) keeps the SAME mean level (0.31,
    // against 0.32 before) so the sky-ray brightness argument two paragraphs up
    // is undisturbed -- `dawnsun`'s three sky rectangles (`skyUp`, `skyOff`,
    // `hzBand`) still read `hiFrac` 0 at this triple, verified on this build --
    // and moves the bias from a symmetric +/-0.02 to an asymmetric +0.09/-0.09
    // around it, R up and B down, which is the SAME direction `sunT` already
    // reddens in and the OPPOSITE of the pre-RN-2175 blue bias this file's
    // first note warns against. Measured, one flag apart, same build:
    // `flyover` -10.55 -> -0.08, `flyovernoon` -3.26 -> +6.70, `forestair`
    // -18.72 -> -7.14, `forestairnoon` -13.44 -> -0.85 (the last three finish
    // the move alongside RN-2320's BiomePalette Forest change below; aerosolTint
    // alone reaches roughly halfway). `forestair` is the one pose that does not
    // cross zero: at its dot 0.55 sun the inter-crown self-shadow law (RN-2275,
    // K = 3.2 off a real LAI) is doing MORE darkening than at `forestairnoon`'s
    // dot 0.736, because the sun path through the canopy is longer, and that
    // darkening is physically grounded rather than a defect this lane may
    // correct by weakening RN-2275's law. Reported rather than chased further.
    // Every ground-pose rectangle this lane checked moved by grade-intent
    // amounts and none changed sign; see rendering.md 2.21 for the full table.
    // `?aerosoltint=` is not a registered sweep (no such flag existed before
    // this lane and one uniform triple does not need a page-param isolator on
    // top of `?aerosol=0`, which already isolates the whole term).
    aerosolTint: new THREE.Vector3(0.40, 0.31, 0.22),
    // 10.6x Forge's own 600 km, i.e. Earth's curvature, and it is the single
    // constant in this lane that is a CHOICE rather than a correction.
    //
    // Forge is a 600 km body carrying a 5.6 km scale height (D-006). Feed those
    // two numbers to an exact Chapman integral and the grazing sun column at a
    // 5.85 degree sun is 36,940 m against Earth's 70,320: about half. Half the
    // airmass is half the reddening, so a physically exact single-scattering
    // model on this planet CANNOT produce a sunset, and no amount of tuning
    // inside the integral changes that, because the shortfall is the planet's
    // radius and the radius is a gameplay decision.
    //
    // So the sun path alone is integrated against Earth's curvature, which
    // takes the 5.85 degree column to 52,285 m, and the choice is safe in a way
    // a gain on the optical depth would not be: `ofChapman`'s high-sun limit is
    // H / sin(elevation) INDEPENDENT OF R, so this constant is algebraically
    // incapable of moving the noon sky. `?sunarc=1` restores the body's own
    // curvature and `?sunarc=0` restores the pre-RN-2175 three-step march.
    sunCurveK: 10.6,
  };
}

/**
 * RN-840. A VACUUM, as an AtmosphereParams. Cinder and every future airless
 * body take this instead of Forge's profile.
 *
 * A real record and not a null, because the shader's uniform block is shared by
 * reference with two terrain materials and the sky box (DW-22), and a null would
 * force every consumer to grow a branch for a case better expressed as zeroed
 * coefficients. Every scattering term is EXACTLY zero and so is the thickness,
 * which is what `airDensityAt` below keys on. `sunIntensity` is NOT zeroed: it
 * is the sun disc's radiance and the star field's reference level, and the sun
 * is still there. A vacuum removes the scattering, not the star.
 */
export function airlessAtmosphere(planetRadiusM: number): AtmosphereParams {
  return {
    planetRadiusM,
    thicknessM: 0,
    // Never divided by while thicknessM is 0 (every consumer gates on the
    // thickness first), but 1 rather than 0 so that a future caller that
    // forgets the gate gets exp(-h) and not a NaN.
    rayleighScaleM: 1,
    mieScaleM: 1,
    betaR: new THREE.Vector3(0, 0, 0),
    betaM: 0,
    mieG: 0,
    sunIntensity: 15.0,
    aerosolSigma: 0,
    aerosolScaleM: 1,
    aerosolMs: 0,
    aerosolTint: new THREE.Vector3(0, 0, 0),
    aerosolG: 0,
    // Never reached: every scattering term is zero, so no sun path is ever
    // integrated. 1 rather than 0 so a future caller that forgets the gate gets
    // the body's own curvature and not a division by zero.
    sunCurveK: 1,
  };
}

/**
 * RN-840. THE selector, so `Boot.ts` never names a body. `hasAtmosphere` is
 * `PlanetBody.hasAtmosphere`, which is /core's own `AtmosphereProfile::present()`
 * read back through `_of_atmo_*`. Nothing here knows what a Cinder is.
 */
export function atmosphereForBody(planetRadiusM: number, hasAtmosphere: boolean): AtmosphereParams {
  return hasAtmosphere ? forgeAtmosphere(planetRadiusM) : airlessAtmosphere(planetRadiusM);
}

export interface AtmosphereUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uPlanetR: { value: number };
  uAtmoR: { value: number };
  uBetaR: { value: THREE.Vector3 };
  uBetaM: { value: number };
  uScaleH: { value: THREE.Vector2 };
  uMieG: { value: number };
  uAtmosOn: { value: number };
  /** (sigma per metre, scale height m, isotropic MS fraction). x = 0 disables. */
  uAerosol: { value: THREE.Vector3 };
  /** Haze radiance multiplier on uSunColor. */
  uAeroTint: { value: THREE.Vector3 };
  uAeroG: { value: number };
  /** RN-2175. (scattering curvature radius m, 1 = analytic Chapman sun path). */
  uSunArc: { value: THREE.Vector2 };
  /** RN-2175. 1 while the sky ray carries the boundary layer. `?skyaero=0`. */
  uSkyAero: { value: number };
  /**
   * RN-2175. THE HEMISPHERICAL SKY RADIANCE, sampled on the CPU once per frame
   * (SkyProbe.ts) and shared BY REFERENCE like everything else in this record,
   * so the terrain, the grass carpet, the water and the sky's ground shell all
   * read one number. `w` is 1 while it is in use and 0 under `?skyirr=0`, where
   * every consumer falls back to the zenith march it used before.
   */
  uSkyIrr: { value: THREE.Vector4 };
  /**
   * RN-2175. THE LAYER'S OWN BASE ALTITUDE, in metres above `uPlanetR`, and a
   * mode selector. `x` is the ground under the OBSERVER (written per frame by
   * SkyPass); `y` is 1 for that reference and 0 for the pre-RN-2175 per-ray one,
   * which is what `?aerobase=0` restores. See `ofAtmoAerial`.
   */
  uAeroRef: { value: THREE.Vector2 };
}

/**
 * ONE uniform record, shared BY REFERENCE between the sky material and the
 * terrain materials. Sharing the objects rather than copying the numbers is why
 * the sky and the aerial perspective cannot drift apart: there is nothing to
 * synchronise.
 */
export function createAtmosphereUniforms(p: AtmosphereParams, on: boolean): AtmosphereUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(1, 0.4, 0).normalize() },
    uSunColor: { value: new THREE.Color(1, 1, 1).multiplyScalar(p.sunIntensity) },
    uPlanetR: { value: p.planetRadiusM },
    uAtmoR: { value: p.planetRadiusM + p.thicknessM },
    uBetaR: { value: p.betaR.clone() },
    uBetaM: { value: p.betaM },
    uScaleH: { value: new THREE.Vector2(p.rayleighScaleM, p.mieScaleM) },
    uMieG: { value: p.mieG },
    uAtmosOn: { value: on ? 1 : 0 },
    uAerosol: {
      value: new THREE.Vector3(
        p.aerosolSigma * AEROSOL_AMP, p.aerosolScaleM, p.aerosolMs),
    },
    uAeroTint: { value: p.aerosolTint.clone() },
    uAeroG: { value: p.aerosolG },
    uAeroRef: { value: new THREE.Vector2(0, AERO_DATUM_ON ? 1 : 0) },
    uSunArc: {
      value: new THREE.Vector2(
        p.planetRadiusM * (SUN_ARC_K === null ? p.sunCurveK : SUN_ARC_K),
        SUN_ARC_K === 0 ? 0 : 1),
    },
    uSkyAero: { value: SKY_AERO_ON ? 1 : 0 },
    uSkyIrr: { value: new THREE.Vector4(0, 0, 0, SKY_IRR_ON ? 1 : 0) },
  };
}

/**
 * RN-2175. `?aerosol=` scales the boundary-layer extinction; `0` removes the
 * term entirely WITH THE SKY STILL PAINTING, which is the control this term has
 * never had.
 *
 * `?atmos=0` was the only aerosol-off arm available and it is not one: it
 * deletes the sky box, so a rectangle that straddles the horizon fills a third
 * of itself with pure void and reports an inter-quartile range that is mostly
 * the ground-against-nothing step. The world audit's headline "the haze is
 * destroying 77.5 per cent of the horizon's contrast" was taken that way and is
 * measured against a contaminated reference; see NUMBERS.md.
 */
const AEROSOL_AMP = ((): number => {
  const v = new URLSearchParams(self.location.search).get('aerosol');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : 1;
})();

/**
 * `?skyirr=0` restores the pre-RN-2175 ambient in one flag: the zenith-only
 * march in every shader that has one AND lane A1's two authored floor endpoints
 * in TerrainAmbient. Standing rule 7: a term whose two halves have two switches
 * is a term whose off state is an argument rather than a measurement.
 */
export const SKY_IRR_ON =
  new URLSearchParams(self.location.search).get('skyirr') !== '0';

/** `?skyaero=0` takes the boundary layer back out of the sky ray, exactly. */
const SKY_AERO_ON =
  new URLSearchParams(self.location.search).get('skyaero') !== '0';

/** `?aerobase=0` restores the pre-RN-2175 per-ray reference, exactly. */
const AERO_DATUM_ON =
  new URLSearchParams(self.location.search).get('aerobase') !== '0';

/**
 * `?sunarc=` on the `stockfloor` precedent: absent ships `sunCurveK`, `0` puts
 * the three-step march back, and any other number is a curvature multiple, so
 * `?sunarc=1` is the body's own curvature. RN-150-safe: missing is MISSING.
 */
const SUN_ARC_K = ((): number | null => {
  const v = new URLSearchParams(self.location.search).get('sunarc');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : null;
})();

export const ATMOSPHERE_PARS = /* glsl */`
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uPlanetR;
  uniform float uAtmoR;
  uniform vec3  uBetaR;
  uniform float uBetaM;
  uniform vec2  uScaleH;
  uniform float uMieG;
  uniform float uAtmosOn;
  uniform vec3  uAerosol;
  uniform vec3  uAeroTint;
  uniform float uAeroG;
  uniform vec2  uAeroRef;
  uniform vec2  uSunArc;
  uniform float uSkyAero;
  uniform vec4  uSkyIrr;

  // Entry and exit parameters of a ray against a sphere centred on the origin.
  // A miss returns (1, -1), so every caller's "y > x" test rejects it.
  vec2 ofAtmoHit(vec3 ro, vec3 rd, float R) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float d = b * b - c;
    if (d < 0.0) return vec2(1.0, -1.0);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  // (Rayleigh, Mie) optical depth along a segment, trapezoid-free midpoint rule.
  vec2 ofAtmoOD(vec3 ro, vec3 rd, float t0, float t1, int steps) {
    vec2 od = vec2(0.0);
    float ds = (t1 - t0) / float(steps);
    float t = t0 + 0.5 * ds;
    for (int i = 0; i < steps; ++i) {
      float h = max(length(ro + rd * t) - uPlanetR, 0.0);
      od += exp(-h / uScaleH) * ds;
      t += ds;
    }
    return od;
  }

  ${ATMOSPHERE_CHAPMAN}

  // Transmittance from a point straight out to space along dir. This is what
  // reddens the sun at the terminator, and it is the same integral the sky uses.
  vec3 ofAtmoSunTransmittance(vec3 p, vec3 dir, int steps) {
    vec2 h = ofAtmoHit(p, dir, uAtmoR);
    if (h.y <= 0.0) return vec3(1.0);
    vec2 g = ofAtmoHit(p, dir, uPlanetR);
    if (g.x > 0.0 && g.y > g.x) return vec3(0.0);
    vec2 od = ofSunOD(p, dir, steps);
    return exp(-(uBetaR * od.x + uBetaM * 1.1 * od.y));
  }

  /**
   * In-scattered radiance along [0, tMax] of the ray (ro, rd), and the
   * transmittance of that same segment. tMax is the distance to the surface for
   * aerial perspective, or a huge number for the sky.
   */
  vec3 ofAtmoScatter(vec3 ro, vec3 rd, float tMax, int viewSteps, int lightSteps,
                     out vec3 trans) {
    trans = vec3(1.0);
    if (uAtmosOn < 0.5) return vec3(0.0);
    vec2 a = ofAtmoHit(ro, rd, uAtmoR);
    float t0 = max(a.x, 0.0);
    float t1 = min(a.y, tMax);
    if (a.y <= a.x || t1 <= t0) return vec3(0.0);

    float mu = dot(rd, uSunDir);
    float phR = 0.0596831 * (1.0 + mu * mu);
    float gg = uMieG * uMieG;
    float denom = max(1.0 + gg - 2.0 * uMieG * mu, 1e-4);
    float phM = 0.0795775 * (1.0 - gg) / (denom * sqrt(denom));

    vec2 odView = vec2(0.0);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float ds = (t1 - t0) / float(viewSteps);
    float t = t0 + 0.5 * ds;
    for (int i = 0; i < viewSteps; ++i) {
      vec3 p = ro + rd * t;
      float h = max(length(p) - uPlanetR, 0.0);
      vec2 dens = exp(-h / uScaleH) * ds;
      odView += dens;
      vec2 gh = ofAtmoHit(p, uSunDir, uPlanetR);
      if (!(gh.x > 0.0 && gh.y > gh.x)) {
        vec2 odL = ofSunOD(p, uSunDir, lightSteps);
        vec3 att = exp(-(uBetaR * (odView.x + odL.x) + uBetaM * 1.1 * (odView.y + odL.y)));
        sumR += att * dens.x;
        sumM += att * dens.y;
      }
      t += ds;
    }
    trans = exp(-(uBetaR * odView.x + uBetaM * 1.1 * odView.y));
    return (sumR * uBetaR * phR + sumM * uBetaM * phM) * uSunColor;
  }

  ${ATMOSPHERE_LAYER}

`;

/** Air density fraction at an altitude, for CPU-side masking heuristics. */
export function airDensityAt(p: AtmosphereParams, altM: number): number {
  // RN-840. A VACUUM HAS NO DENSITY TO DECAY. Without this line the exponential
  // returns exactly 1 at the datum whatever the coefficients are, because a
  // scale height is not a presence test, and `daylightFactor` below therefore
  // washed the stars out of Cinder's noon sky with air that is not there.
  //
  // The gate is the THICKNESS and not the scattering coefficients, because the
  // thickness is the term /core's `AtmosphereProfile::present()` is written in
  // (`topM > 0`), so the two authorities agree by construction rather than by
  // both happening to be zero.
  if (p.thicknessM <= 0) return 0;
  return Math.exp(-Math.max(0, altM) / p.rayleighScaleM);
}

/**
 * How much the lit sky washes out the star field, in [0, 1]. This is a MASKING
 * heuristic, not a second scattering model: it reads the same params object and
 * the same sun elevation the shader uses, so there is no number to keep in sync.
 */
export function daylightFactor(p: AtmosphereParams, altM: number, sunElevDot: number): number {
  const density = airDensityAt(p, altM);
  const day = THREE.MathUtils.smoothstep(sunElevDot, -0.18, 0.10);
  return THREE.MathUtils.clamp(density * day, 0, 1);
}
