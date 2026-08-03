// RN-842. HOW MUCH OF A FACET'S SKY THE BODY'S OWN TERRAIN TAKES AWAY.
//
// ============================================================================
// THE DEFECT, NAMED
// ============================================================================
//
// TerrainShader splits a facet's ambient between the sky and the ground beside
// it with `skyView = 0.5 + 0.5 * dot(n, up)` (RN-8). That expression is exact
// for a facet on an INFINITE TANGENT PLANE: lying flat it sees the whole dome
// and no ground, stood on edge it sees half of each. It is the sky-view factor
// of a world with no landscape in it.
//
// A real cratered surface elevates the local horizon in every direction, so
// every facet sees LESS sky and MORE ground than that. The error has always
// been there and has always been invisible, because on a body with air
// `skyAmb` and the ground's own radiance are comparable in magnitude, so moving
// weight between the two channels barely moves a pixel.
//
// IN A VACUUM `skyAmb` IS EXACTLY ZERO AND THE ENTIRE AMBIENT RIDES ON THE
// GROUND CHANNEL, whose weight the flat-plane assumption drives to nearly
// nothing. Measured on Cinder at a 16 degree sun: a 21 degree slope is told it
// sees 96.7 per cent sky and 3.3 per cent ground, and 3.3 per cent of a bounce
// is the black slope filling the bottom two thirds of
// `docs/screenshots/RN840_C_surface_props.png`. That is why turning the sky off
// produced a lithograph. The model's only non-sky ambient channel was scaled by
// a factor an assumption had already set to zero.
//
// ============================================================================
// THE CORRECTION, AND WHY IT IS NOT A DIAL
// ============================================================================
//
// For a rough surface whose slope distribution has median angle `theta`, the
// local horizon stands at about `theta` above the tangent plane in a typical
// direction, and the fraction of a hemisphere lying below elevation angle
// `theta` is `sin(theta)`. Averaged over azimuth the occluded fraction is of
// order `(2 / pi) * theta`. So ONE number per body, and it is a MEASUREMENT of
// that body's own height field rather than a constant anybody chose:
//
//     omega = (2 / pi) * atan(medianSlope)
//
// The shader then reads
//
//     skyViewEff  = skyView * (1 - omega)
//     groundView  = (1 - skyView) + omega * skyView
//
// which SUM TO EXACTLY 1 for every normal and every omega, so no energy is
// created or destroyed and the term cannot brighten a frame on its own: it can
// only move irradiance from a channel that is zero in a vacuum into one that is
// not. At `omega = 0` both lines collapse to the pre-RN-842 expressions
// algebraically, which is what makes `?horizonocc=0` an EXACT negative control
// and not an approximate one.
//
// ============================================================================
// WHY IT IS MEASURED AT BOOT AND NOT WRITTEN DOWN
// ============================================================================
//
// A per-body constant in a table is a transcription, and D-006's whole point is
// that body facts come from /core. This samples the body's OWN oracle, so a
// third body authored in `cubed_sphere.h` gets a correct omega with no edit
// here, and a world-gen change to Cinder's crater ladder moves the lighting
// with it instead of leaving a stale number behind.
//
// THE MEDIAN AND NOT THE MEAN OR THE RMS (WG-146's corollary, paid for on this
// same body). A crater field's slope distribution is heavy-tailed: a few per
// cent of samples sit on a rim and dominate any mean. The p50 asks what the
// ground a player is standing on does, which is the question the ambient of a
// typical fragment is asking.
//
// ============================================================================
// THE BASELINE IS THE WHOLE ANSWER, SO IT IS ARGUED AND NOT ASSUMED
// ============================================================================
//
// Slope is scale-dependent on a fractal surface. `tools/smoke/probes/slopestat.js`
// takes the full ladder; these are its readings (median slope, p50):
//
//            2 m      8 m     40 m    200 m   1000 m
//   Cinder  17.91d   13.39d   11.22d  11.67d   6.67d
//   Forge     0.00d    3.02d   12.77d  12.08d   9.31d
//
// SAMPLE_M is 8 m because that is the scale at which nearby terrain still
// subtends a useful solid angle at a standing eye: relief one or two metres
// high a few metres away is what actually stands between a fragment and the
// sky, while a 200 m landform is far enough that it sits low on the horizon and
// occludes little. The two bodies separate hard at that scale (0.149 against
// 0.034) and converge at 40 m, which is the reading that says 40 m is measuring
// regional tilt rather than local shelter.
//
// Note what the table says about the blast radius: FORGE'S FINE SCALE IS FLAT.
// A median of 0.00 degrees over 2 m and 3.02 over 8 m puts Forge's omega at
// 0.034, so this term is close to a no-op on the planet and is the whole
// difference on the moon. That is the property that lets a vacuum be fixed
// without relighting a calibrated planet, and it is asserted rather than hoped
// for: see the RN-842 rows in `docs/controllers/rendering.md`.

import type { SurfaceOracle } from '../../world/SurfaceOracle.js';
import type { PlanetBody } from '../../world/PlanetBody.js';

/**
 * The baseline the median slope is taken over. See the note above: this is an
 * argued choice and the ladder that supports it is in `slopestat.js`.
 */
export const SAMPLE_M = 8;

/**
 * Grid edge. 24 x 24 is 576 cells and 2,304 oracle calls at ~3 us, i.e. about
 * 7 ms once at boot, against `benchOracle`'s existing 3,000-call warm-up on the
 * same path. The full-fidelity 72 x 72 lives in the probe; this is asserted
 * AGAINST that rather than assumed to agree with it.
 */
const GRID = 24;

export interface HorizonOcclusion {
  /** The fraction of a hemisphere the local horizon occludes, in [0, 1). */
  readonly omega: number;
  /** Median slope as a gradient and in degrees, published so the number can be
   *  checked against `slopestat.js` rather than taken on faith. */
  readonly medianSlope: number;
  readonly medianSlopeDeg: number;
  readonly baselineM: number;
  readonly samples: number;
  readonly ms: number;
}

/**
 * Measure the body's median surface slope and turn it into an occluded
 * fraction. Called once, at boot, before the first frame.
 *
 * `latDeg`/`lonDeg` is the observer's spawn: the sample patch is centred there
 * because that is the terrain the player will actually be standing on, and a
 * whole-body average would mix a crater floor with a highland and describe
 * neither. A body whose regions differ enough for that to matter wants a
 * per-region omega, which is a real follow-on and is recorded as one.
 */
export function measureHorizonOcclusion(
  oracle: SurfaceOracle, body: PlanetBody, latDeg: number, lonDeg: number,
): HorizonOcclusion {
  const t0 = performance.now();
  const R = body.radiusM;
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  // The spawn direction and an orthonormal east/north tangent pair at it.
  const d = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  const e = [-Math.sin(lo), 0, Math.cos(lo)];
  const n = [-Math.sin(la) * Math.cos(lo), Math.cos(la), -Math.sin(la) * Math.sin(lo)];
  const a = SAMPLE_M / R;                 // angular step for SAMPLE_M of arc

  // RE-NORMALISED at every sample. Without it a large offset drifts off the
  // sphere and reads a shorter radius, which shows up as a spurious slope that
  // grows with distance from the centre of the patch.
  const h = (de: number, dn: number): number => {
    const x = d[0] + e[0] * de + n[0] * dn;
    const y = d[1] + e[1] * de + n[1] * dn;
    const z = d[2] + e[2] * de + n[2] * dn;
    const l = Math.hypot(x, y, z) || 1;
    return oracle.baseHeight(x / l, y / l, z / l);
  };

  const slopes: number[] = [];
  for (let iy = 0; iy < GRID; ++iy) {
    for (let ix = 0; ix < GRID; ++ix) {
      const ox = (ix - GRID / 2) * a;
      const oy = (iy - GRID / 2) * a;
      // CENTRED differences, so this is the gradient AT the sample rather than
      // between it and its neighbour.
      const hE = h(ox + a, oy), hW = h(ox - a, oy);
      const hN = h(ox, oy + a), hS = h(ox, oy - a);
      if (!Number.isFinite(hE) || !Number.isFinite(hW)
          || !Number.isFinite(hN) || !Number.isFinite(hS)) continue;
      const gx = (hE - hW) / (2 * SAMPLE_M);
      const gy = (hN - hS) / (2 * SAMPLE_M);
      slopes.push(Math.hypot(gx, gy));
    }
  }
  slopes.sort((p, q) => p - q);
  const medianSlope = slopes.length === 0
    ? 0 : slopes[Math.floor(slopes.length / 2)];
  // CLAMPED WELL BELOW 1. omega is a fraction of a hemisphere and the small
  // angle argument behind it stops being true long before 45 degrees, so a
  // pathological field cannot drive the sky share to zero and turn the ambient
  // into a pure bounce. 0.45 is a 35 degree median, rougher than either shipped
  // body by a wide margin, and it exists to bound a defect rather than to tune
  // a look.
  const omega = Math.min(0.45, (2 / Math.PI) * Math.atan(medianSlope));
  return {
    omega,
    medianSlope,
    medianSlopeDeg: (Math.atan(medianSlope) * 180) / Math.PI,
    baselineM: SAMPLE_M,
    samples: slopes.length,
    ms: performance.now() - t0,
  };
}
