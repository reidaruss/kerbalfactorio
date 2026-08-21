// RN-2175 (fidelity lane A4). THE SKY'S OWN IRRADIANCE, SAMPLED ON THE CPU.
//
// WHAT IT REPLACES, AND WHY BOTH HALVES WERE WRONG.
//
// The terrain, the carpet, the water and the sky's ground shell all computed
// their ambient as `ofAtmoScatter(p, up, 1.0e9, 2, 2) * TERRAIN_SKY_AMBIENT`:
// the radiance of ONE direction, straight up, standing in for a whole
// hemisphere. At a high sun that is a fair approximation, because the dome is
// nearly uniform. At dawn it is the worst possible sample: the zenith is the
// one part of the sky that has NOT reddened, so the fill a low sun puts into
// every shadow was the colour of midnight blue while the horizon burned orange.
// Lane A1 papered over exactly that with two authored endpoints
// (`AMBIENT_NOON`, `AMBIENT_LOWSUN`) and said so in its own handoff: "these are
// still authored endpoints and not a spherical-harmonic probe of the real sky;
// a probe is A4's job".
//
// THIS IS THAT PROBE, AND IT IS DELIBERATELY NOT AN SH BAKE. Nine directions,
// cosine-weighted, once per frame, on the CPU. A hemisphere's irradiance is one
// number per channel; spherical harmonics buy directionality the consumers do
// not have a term for, since `skyView` is already a scalar sky-view factor.
//
// THE SECOND-AUTHORITY PROBLEM, NAMED RATHER THAN HIDDEN. This is a CPU port of
// a GLSL model, so there are now two implementations of one thing, which is the
// failure mode `TerrainAmbient.ts` and `createAtmosphereUniforms` both exist to
// prevent. Three things bound it: every CONSTANT comes from the same
// `AtmosphereParams` record the shader's uniforms are built from, so there is
// no number to keep in sync, only structure; the structure is the same
// single-scattering integral with the same Chapman sun path and the same
// boundary-layer column; and `__ofSkyProbe.report()` publishes the triple so a
// probe can hold it against the sky pixels rather than assume they agree.
// `?skyirr=0` restores the zenith-march ambient and A1's authored endpoints
// together, which is the one flag that puts the whole term back.

import * as THREE from 'three';
import type { AtmosphereParams } from './Atmosphere.glsl.js';
import { AERO_TINT_ON } from './Atmosphere.glsl.js';

/**
 * Nine directions: the zenith plus two rings of four. The rings sit at 20 and
 * 50 degrees elevation because that is where a cosine-weighted hemisphere
 * actually keeps its energy, and 20 degrees is low enough to catch the warm
 * band the zenith misses entirely. Azimuths are placed RELATIVE TO THE SUN each
 * frame (see `skyIrradiance`), so the sample set rotates with the day and the
 * fill cannot go cold merely because the sun drifted between two fixed spokes.
 */
const RING_ELEV = [20, 50];
const RING_N = 4;

/** exp(x*x)*erfc(x), the same approximation `ofErfcx` uses in the shader. */
function erfcx(x: number): number {
  return 2 / (1.7724539 * (x + Math.sqrt(x * x + 1.2732395)));
}

/** The Chapman column, term for term `ofChapman`. */
function chapman(h0: number, sinZ: number, cosZ: number, R: number, H: number): number {
  const hh = Math.max(h0, 0);
  const r0 = R + hh;
  const c = Math.max(cosZ, 1e-3);
  const u = (sinZ / c) * Math.sqrt(r0 / (2 * H));
  return Math.exp(-hh / H) * Math.sqrt(1.5707963 * r0 * H) * erfcx(u) / c;
}

/** Rayleigh and Mie phase at cos(angle to the sun). */
function phaseR(mu: number): number { return 0.0596831 * (1 + mu * mu); }

function phaseM(mu: number, g: number): number {
  const gg = g * g;
  const d = Math.max(1 + gg - 2 * g * mu, 1e-4);
  return 0.0795775 * (1 - gg) / (d * Math.sqrt(d));
}

const dir = new THREE.Vector3();
const east = new THREE.Vector3();
const north = new THREE.Vector3();
const out = new THREE.Color();

/**
 * The hemispherical average sky RADIANCE at an observer, in the same units the
 * shader's `ofAtmoScatter` returns, so it drops into `skyAmb` in place of the
 * zenith sample with no rescale.
 *
 * `altM` is the eye's altitude above the datum and `baseM` the boundary layer's
 * base, both as the shader sees them. `sunUpDot` is `dot(sunDir, up)`.
 */
export function skyIrradiance(
  p: AtmosphereParams, up: THREE.Vector3, sunDir: THREE.Vector3,
  altM: number, baseM: number, aeroSigma: number,
): THREE.Color {
  out.setRGB(0, 0, 0);
  if (p.thicknessM <= 0) return out;
  // A frame aligned to the SUN's azimuth, so the ring samples straddle the warm
  // side and the cold side symmetrically at every hour.
  east.copy(sunDir).addScaledVector(up, -sunDir.dot(up));
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0).addScaledVector(up, -up.x);
  east.normalize();
  north.copy(up).cross(east).normalize();

  const sunUpDot = sunDir.dot(up);
  // The sun's own transmittance at the observer, the same expression the
  // terrain's `sunT` uses. It is the whole of the reddening.
  const sunCos = Math.sqrt(Math.max(1 - sunUpDot * sunUpDot, 0));
  const R = p.planetRadiusM * p.sunCurveK;
  const odSR = chapman(altM, sunUpDot, sunCos, R, p.rayleighScaleM);
  const odSM = chapman(altM, sunUpDot, sunCos, R, p.mieScaleM);

  let wSum = 0;
  for (let ring = -1; ring < RING_ELEV.length; ++ring) {
    const n = ring < 0 ? 1 : RING_N;
    for (let i = 0; i < n; ++i) {
      if (ring < 0) {
        dir.copy(up);
      } else {
        const el = RING_ELEV[ring] * Math.PI / 180;
        const az = (i + 0.5) * 2 * Math.PI / RING_N;
        dir.copy(up).multiplyScalar(Math.sin(el))
          .addScaledVector(east, Math.cos(el) * Math.cos(az))
          .addScaledVector(north, Math.cos(el) * Math.sin(az));
      }
      const cosT = Math.max(dir.dot(up), 0);
      if (cosT <= 0) continue;
      const mu = dir.dot(sunDir);
      // VIEW-PATH column along this direction, analytic for the same reason the
      // sun path is: a near-horizon ray is hundreds of kilometres long and a
      // handful of uniform samples cannot represent air that lives in the first
      // ten of them.
      const vSin = cosT;
      const vCos = Math.sqrt(Math.max(1 - vSin * vSin, 0));
      const colR = chapman(altM, vSin, vCos, p.planetRadiusM, p.rayleighScaleM);
      const colM = chapman(altM, vSin, vCos, p.planetRadiusM, p.mieScaleM);
      const pr = phaseR(mu);
      const pm = phaseM(mu, p.mieG);
      const bm = p.betaM * 1.1;
      const mie = p.betaM * colM * pm;
      // THE BOUNDARY LAYER, the same term `ofAtmoSkyAero` adds to the sky quad,
      // so the fill reddens at dawn for the same reason the horizon does. Its
      // absence here is what would make the shade disagree with the sky above
      // it, which is the whole defect this file exists to close.
      const aOd = aeroSigma * chapman(
        Math.max(altM - baseM, 0), vSin, vCos, p.planetRadiusM, p.aerosolScaleM);
      const aTr = Math.exp(-aOd);
      const aPh = phaseM(mu, p.aerosolG) * 0.85 + 0.0795775 * 0.15;
      // RN-2400. THE SAME `ofAeroTintAt` AS THE SHADER, term for term: a
      // threshold ramp on THIS RING DIRECTION's own optical depth, zero below
      // `aerosolTintOd0` and linear to 1 over `aerosolTintOdSpan`, floored at
      // 0.3 exactly as the GLSL sky entry (`ofAtmoSkyAero`) is -- this probe
      // is the sky's own ambient, so it takes the SKY floor and not the
      // ground entry's 0. `?aerodepth=0` (AERO_TINT_ON) restores the flat
      // blend on this CPU port exactly as it does in the GLSL, which is the
      // "one switch for both halves" rule this file's own header states.
      const tintRamp = Math.min(Math.max(
        (aOd - p.aerosolTintOd0) / Math.max(p.aerosolTintOdSpan, 1e-3), 0), 1);
      const tintK = AERO_TINT_ON ? Math.max(tintRamp, 0.3) : 0;
      const w = cosT;
      wSum += w;
      // Single scattering with the sun path's extinction on the source and the
      // view path's on what comes back, then the layer composited over it.
      for (let c = 0; c < 3; ++c) {
        const bR = c === 0 ? p.betaR.x : c === 1 ? p.betaR.y : p.betaR.z;
        const tintNear = c === 0 ? p.aerosolTint.x
          : c === 1 ? p.aerosolTint.y : p.aerosolTint.z;
        const tintFar = c === 0 ? p.aerosolTintFar.x
          : c === 1 ? p.aerosolTintFar.y : p.aerosolTintFar.z;
        const tint = tintNear + (tintFar - tintNear) * tintK;
        const sky = (bR * colR * pr + mie)
          * Math.exp(-(bR * (odSR + colR) + bm * (odSM + colM))) * p.sunIntensity;
        const haze = p.sunIntensity * tint * aPh
          * Math.exp(-(bR * odSR + bm * odSM));
        const rad = (sky * aTr + haze * (1 - aTr)) * w;
        if (c === 0) out.r += rad;
        else if (c === 1) out.g += rad;
        else out.b += rad;
      }
    }
  }
  if (wSum > 0) out.multiplyScalar(1 / wSum);
  return out;
}
