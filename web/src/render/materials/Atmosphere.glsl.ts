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
  };
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
`;

/** Air density fraction at an altitude, for CPU-side masking heuristics. */
export function airDensityAt(p: AtmosphereParams, altM: number): number {
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
