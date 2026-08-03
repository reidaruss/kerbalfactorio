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
    // 4.5e-4 per metre with a 400 m scale height ABOVE THE LOCAL GROUND (see
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
    aerosolSigma: 4.5e-4,
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
    aerosolTint: new THREE.Vector3(0.38, 0.39, 0.43),
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
      value: new THREE.Vector3(p.aerosolSigma, p.aerosolScaleM, p.aerosolMs),
    },
    uAeroTint: { value: p.aerosolTint.clone() },
    uAeroG: { value: p.aerosolG },
  };
}

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

  // Transmittance from a point straight out to space along dir. This is what
  // reddens the sun at the terminator, and it is the same integral the sky uses.
  vec3 ofAtmoSunTransmittance(vec3 p, vec3 dir, int steps) {
    vec2 h = ofAtmoHit(p, dir, uAtmoR);
    if (h.y <= 0.0) return vec3(1.0);
    vec2 g = ofAtmoHit(p, dir, uPlanetR);
    if (g.x > 0.0 && g.y > g.x) return vec3(0.0);
    vec2 od = ofAtmoOD(p, dir, max(h.x, 0.0), h.y, steps);
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
        vec2 lh = ofAtmoHit(p, uSunDir, uAtmoR);
        vec2 odL = ofAtmoOD(p, uSunDir, 0.0, max(lh.y, 0.0), lightSteps);
        vec3 att = exp(-(uBetaR * (odView.x + odL.x) + uBetaM * 1.1 * (odView.y + odL.y)));
        sumR += att * dens.x;
        sumM += att * dens.y;
      }
      t += ds;
    }
    trans = exp(-(uBetaR * odView.x + uBetaM * 1.1 * odView.y));
    return (sumR * uBetaR * phR + sumM * uBetaM * phM) * uSunColor;
  }

  /**
   * BOUNDARY-LAYER AEROSOL HAZE OVER A PATH THAT TERMINATES ON GEOMETRY.
   *
   * THIS IS THE SECOND ATTEMPT AND THE ONLY THING THAT CHANGED IS THE
   * CONFINEMENT. The first one added the aerosol INSIDE ofAtmoScatter and relied
   * on a 400 m scale height to keep it off the sky. That is confinement by
   * HEIGHT and it does not work, because a near-horizon sky ray lies inside the
   * layer for tens of kilometres: the ground hazed correctly (far-band red 70.2
   * to 60.9, blue over red 0.393 to 0.460) and the term then failed its own
   * control, moving sky saturation 0.494 to 0.410 and sky red 81.9 to 97.0. It
   * was reverted whole, and the sky control is what made that call possible.
   *
   * The confinement here is by PATH, and the seam it needs already existed:
   * every escaping ray in this codebase passes tMax = 1.0e9 and every
   * terminating ray passes a real metre distance. So the rule is that this is a
   * SEPARATE ENTRY POINT, called only from the one call site that has a finite
   * distance to geometry (TerrainShader's aerial perspective). The sky quad, and
   * the terrain's own upward sky-ambient ray, cannot reach it at all. "The sky
   * did not move" stops being a tuning result and becomes a property of the call
   * graph. Note that a #define keyed on "is this the terrain material" would
   * have got it WRONG, because the sky-ambient ray IS a terrain fragment issuing
   * an escaping ray; the distinction that matters is the ray, not the material.
   *
   * THE OPTICAL DEPTH IS ANALYTIC, NOT MARCHED, and that is what makes it safe
   * from orbit. For a height profile that is linear along the segment,
   * INTEGRAL exp(-h/H) ds = L * H / (h1 - h0) * (exp(-h0/H) - exp(-h1/H)), which
   * self-limits correctly: a viewer 100 km up looking down collects about H
   * worth of dense air no matter how long the ray is, while a viewer standing on
   * the ground looking horizontally collects the whole length of it. A midpoint
   * or Simpson rule would weight its samples by the FULL path length and would
   * produce an enormous optical depth for a scaled planet seen from space, which
   * is a failure this closed form structurally cannot have.
   */
  vec3 ofAtmoAerial(vec3 col, vec3 ro, vec3 rd, float distM, vec3 sunT) {
    if (uAtmosOn < 0.5 || uAerosol.x <= 0.0) return col;
    float H = uAerosol.y;
    float a0 = max(length(ro) - uPlanetR, 0.0);
    float a1 = max(length(ro + rd * distM) - uPlanetR, 0.0);
    // THE LAYER SITS ON THE TERRAIN, NOT ON THE DATUM, and heights are measured
    // from the LOWER end of the ray. This is what a boundary layer physically is
    // (it is why mountains stand above the haze and valleys fill with it) and it
    // is also what makes one pair of constants work at every elevation: measured
    // from the datum, the same term is 2x weaker on an 860 m hillside than at
    // sea level and vanishes on a mountain, so it would have to be retuned per
    // site, which is another way of saying it would be wrong everywhere but one.
    //
    // Continuous by construction: the two branches meet where a1 = a0, and there
    // both give the same reference, so a fragment crossing the camera's own
    // altitude does not step.
    float base = min(a0, a1);
    float h0 = a0 - base;
    float h1 = a1 - base;
    float dh = h1 - h0;
    float e0 = exp(-h0 / H);
    // The limit of the closed form as dh goes to zero, taken explicitly rather
    // than divided into: a horizontal ray is the single most common case here,
    // and it is exactly the one that makes the denominator vanish.
    float colDepth = abs(dh) < 1.0
      ? distM * e0
      : distM * H / dh * (e0 - exp(-h1 / H));
    float od = uAerosol.x * max(colDepth, 0.0);
    float tr = exp(-od);

    float mu = dot(rd, uSunDir);
    float gg = uAeroG * uAeroG;
    float den = max(1.0 + gg - 2.0 * uAeroG * mu, 1e-4);
    float hg = 0.0795775 * (1.0 - gg) / (den * sqrt(den));
    float ph = mix(hg, 0.0795775, uAerosol.z);
    // sunT is the transmittance along the SUN ray at the shaded fragment, handed
    // in by the caller rather than recomputed. It costs nothing, it is the right
    // order of magnitude for the whole path at these ranges, and it means the
    // haze reddens through the terminator and goes out at night with the sun
    // instead of hanging in the frame as a grey sheet after sunset.
    vec3 haze = uSunColor * uAeroTint * ph * sunT;
    return col * tr + haze * (1.0 - tr);
  }
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
