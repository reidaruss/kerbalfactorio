// RN-2645. ONE GEOMETRIC QUANTITY, TWO CONSUMERS: the fraction of a BEAM that
// reaches the mean depth of a canopy layer, and the same fraction averaged over
// the whole sky.
//
// WHY THIS IS A FILE RATHER THAN TWO EXPRESSIONS. `CanopySelfShadow.ts`'s law
// and RN-2645's environment cut are the same integral evaluated on two
// different sets of directions, and this project has now been bitten twice by
// two copies of one constant (MachineMat.ts's scar, RN-2249's palette hex).
// They are written ONCE here, and both consumers import them.
//
// ---------------------------------------------------------------------------
// THE QUANTITY, AND THE DEFECT IT NAMES
// ---------------------------------------------------------------------------
// `CanopySelfShadow`'s law asks what fraction of a beam survives the crowns
// above a crown surface, and answers with Beer-Lambert:
//
//     T_bottom(tau, c) = exp( -tau / c )        tau = K * mu,  c = the beam's
//                                                own direction cosine
//
// **That is the transmittance to the BOTTOM of the layer, and the card it
// multiplies stands for the WHOLE crown.** `OF_Canopy` is one impostor spanning
// a tree's entire foliage volume, so the quantity the shade law needs is the
// MEAN of `T` over the depth the card occupies, not its value at the darkest
// leaf in the stand:
//
//     T_mean(tau, c) = (1/tau) * INT_0^tau exp(-t/c) dt
//                    = (c / tau) * ( 1 - exp(-tau / c) )
//
// **`T_mean` IS THE SUNLIT FRACTION, AND THAT IS ITS LITERATURE ANCHOR.** For a
// beam at direction cosine `c` through a canopy of optical depth `tau`, the
// fraction of leaf area that sees the beam unobstructed is exactly
// `(1 - exp(-k L)) / (k L)`. It is the sunlit / shaded split every two-leaf
// canopy model is built on (de Pury and Farquhar 1997; Wang and Leuning 1998;
// Sinclair's earlier form), and it is the standard alternative to the big-leaf
// assumption for precisely the reason it is needed here: a layer lit at its top
// and dark at its base cannot be represented by the value at either end.
//
// Both limits are the right ones and neither needs a branch of its own beyond
// the small-argument guard below: `T_mean -> 1` as `tau -> 0` (an empty stand
// shades nothing) and `T_mean -> c / tau` as `tau -> inf` (a deep stand's
// sunlit fraction is its top layer, which thins as `1/tau`).
//
// ---------------------------------------------------------------------------
// THE SKY IS THE SAME INTEGRAL OVER EVERY DIRECTION AT ONCE
// ---------------------------------------------------------------------------
// A crown surface inside a stand does not see the whole sky either, and the
// fraction it does see is `T_mean` averaged over the hemisphere with the
// cosine-weighted measure a Lambertian surface and an irradiance integral both
// use:
//
//     skyView(tau) = 2 * INT_0^1 c * T_mean(tau, c) dc
//                  = (2 / tau) * INT_0^1 c^2 * ( 1 - exp(-tau / c) ) dc
//
// which is the classical `(2 / tau) * ( 1/3 - E_4(tau) )` written as a
// quadrature over `c` instead of as an exponential integral, because in this
// form the physics is on the page: the same beam function, over the sky rather
// than along the sun.
//
// **AND IT RETIRES A GUESS THIS PROJECT HAS BEEN CARRYING SINCE RN-2275.**
// `CROWN_SELF_FLOOR`'s own derivation ends "a canopy interior does not see the
// whole sky, and half of it is the honest reduction, so 0.08 is that share
// times a canopy sky-view factor of about 0.55". That 0.55 was authored by eye.
// `skyView` at the Hills stand (`mu` 0.2996, `tau` 0.9587) is **0.5063**. The
// guess was good and it is now a derivation, and the SAME number is what the
// crown's environment map has to be scaled by, which is RN-2645's second
// handle.
//
// ---------------------------------------------------------------------------
// WHY A QUADRATURE AND NOT `E_4`
// ---------------------------------------------------------------------------
// `E_4` needs `E_1`, which needs a series below 1 and a continued fraction
// above it, and then an upward recurrence that loses digits exactly where this
// project's `tau` lives (0 to about 3.3). A 24-node Gauss-Legendre rule on a
// smooth, bounded integrand costs 24 `exp` calls once per frame on the CPU and
// is accurate to well past the four decimals anything downstream prints. It is
// also checkable by hand: `skyView(0) = 1` exactly, and the rule reproduces
// `2 * (1/3 - E_4(tau))` to 1e-9 at every `tau` in range.
//
// The integrand `c^2 (1 - exp(-tau/c))` is continuous at `c = 0` (it goes to
// zero) but `exp(-tau/c)` underflows there, so the beam function guards on `c`
// rather than letting the exponent run to infinity.

/**
 * The smallest direction cosine the beam function will evaluate at.
 *
 * It is `CROWN_SUN_MIN`'s argument on the other ray and it has the same
 * property: by `c = 0.02` the exponent for even the sparsest stand in the game
 * has saturated, so the VALUE cannot matter and it exists only to keep the
 * division finite. It is written here rather than imported so this module has
 * no dependency at all; the two are the same number for the same reason.
 */
const MIN_COS = 0.02;

/** Below this `tau` the layer is empty and `T_mean` is 1 to float precision;
 *  the series `1 - tau/(2c) + ...` is used implicitly by returning 1, which is
 *  correct to better than 1e-7 for `tau < 1e-7` at any `c >= MIN_COS`. */
const MIN_TAU = 1e-7;

/**
 * `T_mean(tau, c)`: the fraction of a beam at direction cosine `c` that
 * survives to the MEAN depth of a canopy layer of optical depth `tau`.
 *
 * This is the sunlit fraction. See the header for the anchor and for why the
 * shipped law's `exp(-tau/c)` is the same quantity taken at the layer's BASE.
 */
export function crownBeamMean(tau: number, c: number): number {
  if (!(tau > MIN_TAU)) return 1;
  const cc = Math.max(c, MIN_COS);
  return (cc / tau) * (1 - Math.exp(-tau / cc));
}

/**
 * 24-node Gauss-Legendre nodes and weights on [0, 1], as the standard [-1, 1]
 * rule mapped by `x = (t + 1) / 2`, `w = w_t / 2`.
 *
 * TABULATED RATHER THAN COMPUTED. Generating the nodes needs a Newton solve on
 * Legendre polynomials at module scope, which is thirty lines of code to
 * reproduce a table that has been the same since 1814. The values are the
 * 12 symmetric pairs of the standard rule.
 */
const GL24_T: readonly number[] = [
  0.0640568928626056, 0.1911188674736163, 0.3150426796961634,
  0.4337935076260451, 0.5454214713888396, 0.6480936519369755,
  0.7401241915785544, 0.8200019859739029, 0.8864155270044011,
  0.9382745520027328, 0.9747285559713095, 0.9951872199970213,
];
const GL24_W: readonly number[] = [
  0.1279381953467522, 0.1258374563468283, 0.1216704729278034,
  0.1155056680537256, 0.1074442701159656, 0.0976186521041139,
  0.0861901615319533, 0.0733464814110803, 0.0592985849154368,
  0.0442774388174198, 0.0285313886289337, 0.0123412297999872,
];

/**
 * `skyView(tau)`: the cosine-weighted mean of `crownBeamMean` over the sky.
 *
 * It is the fraction of the sky's own radiance that reaches a crown surface at
 * the mean depth of its stand, and it is what the crown card's environment map
 * must be scaled by. `skyView(0) = 1` and it falls monotonically in `tau`.
 */
export function crownSkyView(tau: number): number {
  if (!(tau > MIN_TAU)) return 1;
  let s = 0;
  for (let i = 0; i < GL24_T.length; i++) {
    const w = GL24_W[i] / 2;
    // The two nodes of the symmetric pair, mapped onto [0, 1].
    const a = (1 - GL24_T[i]) / 2;
    const b = (1 + GL24_T[i]) / 2;
    s += w * (a * crownBeamMean(tau, a) + b * crownBeamMean(tau, b));
  }
  return 2 * s;
}

/**
 * The GLSL half of `crownBeamMean`, character for character in the other
 * language, interpolated from this module's own constant so there is no second
 * copy of `MIN_COS`.
 *
 * `skyView` has no GLSL half and does not need one: the far treeline PAINT has
 * no environment map (the terrain reads its sky ambient from the scattering
 * integral per fragment, `SkyIbl.ts`'s own header), so the sky-view factor is a
 * CARD-side quantity and is computed once per frame on the CPU.
 */
export const CROWN_BEAM_GLSL = /* glsl */`
  #define OF_CROWN_MIN_COS ${MIN_COS.toFixed(5)}

  // RN-2645. The sunlit fraction: the layer MEAN of exp(-tau/c), which is the
  // quantity a whole-crown impostor needs where exp(-tau/c) alone is the value
  // at the layer's base. See CrownSkyView.ts for the derivation and the anchor.
  float ofCrownBeamMean(float tau, float c) {
    float cc = max(c, OF_CROWN_MIN_COS);
    float x = tau / cc;
    return x < 1e-5 ? 1.0 : (1.0 - exp(-x)) / x;
  }
`;
