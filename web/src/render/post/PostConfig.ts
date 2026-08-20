// The post stack's flags and tunables, and the reasoning behind the numbers.
//
// TWO OCCLUSION SOURCES, AND HOW THEY DIVIDE THE WORK. The material lane bakes
// an occlusion channel into the packed ORM map, and this file computes a second
// occlusion term in screen space. Multiplying two occlusion terms that describe
// the SAME thing double-darkens and reads as muddy, so they are separated by
// SPATIAL FREQUENCY and the separation is structural, not a tuning:
//
//   baked aoMap  - occlusion INSIDE one surface: panel gaps, bolt recesses,
//                  weave. Lives in UV space, scale of centimetres, and no
//                  screen-space method can resolve it.
//   this stack   - occlusion BETWEEN separate pieces of geometry: a machine's
//                  foot against ground, a belt leg against a terrace, a rock
//                  in a hollow. Scale of a metre.
//
// WHAT ENFORCES THE SPLIT, corrected by measurement. The first version of this
// comment claimed `aoRadiusM` alone did it, and that the term was "physically
// incapable" of producing panel-gap detail. That is FALSE and the probe caught
// it: re-run at a 5 cm radius and the term does not vanish, it produces p99 0.54
// over 11% of the frame. Shrinking the radius does not silence the integral, it
// makes it SPECKLED, because the samples collapse inside one half-resolution
// texel and it starts integrating the surface's own depth gradient rather than
// an occluder.
//
// So the split is by SPATIAL FREQUENCY and it is the radius TOGETHER WITH the
// 4x4 denoise and the depth-aware upsample, which band-limit the output. The
// property `probes/post.js` checks is therefore smoothness, not magnitude:
// `roughness` is the darkening image's mean adjacent-pixel gradient over its
// mean magnitude, and a term that could compete with a baked texture map has to
// be rough at texel scale while this one has to be smooth.

export interface PostFlags {
  /** Master switch. Off restores the pre-lane path: straight to the canvas. */
  post: boolean;
  ao: boolean;
  /** Screen-space contact shadows. See ContactGlsl for why it is not a cascade. */
  contact: boolean;
  /**
   * The underwater view. Off removes the two blends ENTIRELY, which restores the
   * pre-lane image exactly; and the pass is skipped anyway whenever the eye is
   * dry, so on a dry planet this flag is already a no-op. See UnderwaterPass.
   */
  underwater: boolean;
  bloom: boolean;
  grade: boolean;
  aa: boolean;
}

export interface PostTuning {
  /** AO buffer size as a fraction of the drawing buffer. */
  aoScale: number;
  aoSlices: number;
  aoSteps: number;
  /** Occlusion radius in METRES of view space. See the frequency note above. */
  aoRadiusM: number;
  /** Fraction of the radius over which influence falls to zero. */
  aoFalloff: number;
  /** Hard cap on the radius in UV, so a close-up surface cannot sample the world. */
  aoMaxScreen: number;
  aoStrength: number;
  aoPower: number;
  aoDepthSigma: number;
  /** RN-2190. Metres of mean neighbour depth deviation at which thin-geometry
   *  damping saturates. See AoGlsl's normalAndEdgeFromDepth. */
  aoThinEdgeM: number;
  /** RN-2190. How far the AO result is pulled toward no occlusion at full
   *  thin-geometry saturation. 0 is off. */
  aoThinAmount: number;
  /** RN-2190. View-space metres: full strength inside aoThinNearM, zero
   *  beyond aoThinFarM. See AoGlsl's distance-gate comment. */
  aoThinNearM: number;
  aoThinFarM: number;
  /** March length in metres. The whole reason the term is a CONTACT shadow. */
  csLengthM: number;
  csSteps: number;
  /** Assumed occluder thickness in metres: the upper bound on an accepted hit. */
  csThickM: number;
  /** Depth bias in metres, against a lit surface shadowing itself. */
  csBiasM: number;
  csStrength: number;
  /** Hard cap on the march in UV, so a close-up surface cannot walk the frame. */
  csMaxScreen: number;
  /** Underwater extinction per METRE, per channel. Red hardest. See below. */
  uwSigma: [number, number, number];
  /** Scalar multiplier on uwSigma: "how murky is this water". */
  uwExtinction: number;
  /** Equilibrium radiance of the water, i.e. what a long path becomes. */
  uwTint: [number, number, number];
  /** Scalar multiplier on uwTint: "how bright is the murk". */
  uwTintScale: number;
  /**
   * In-scatter build-up rate as a fraction of the extinction. 1.0 is the
   * radiative-transfer equilibrium form, `col * tr + tint * (1 - tr)`, which is
   * exactly what `ofAtmoAerial` ends on and is the default for that reason. The
   * knob exists so the two coefficients can be pulled apart and MEASURED rather
   * than collapsed by assertion; below 1 the tint fills in more slowly than the
   * scene fades and the far water reads darker.
   */
  uwScatterFrac: number;
  /** Hard cap on the underwater path in metres, so a sky pixel is a number. */
  uwMaxPathM: number;
  bloomLevels: number;
  bloomThreshold: number;
  bloomKnee: number;
  bloomScatter: number;
  bloomStrength: number;
  exposure: number;
  contrast: number;
  /**
   * 0 = the RN-10 straight-line contrast that clips at both ends, 1 = the
   * slope-matched S that rolls them. See CompositeGlsl's `grade` doc comment;
   * 0 restores the pre-RN-207 image bit-exactly at the pre-RN-207 constants.
   */
  curveMix: number;
  saturation: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  lift: number;
  vignette: number;
  vignetteSoft: number;
  /** MSAA samples on the HDR scene target. 0 = none, FXAA carries the edges. */
  samples: number;
  /**
   * Use three's FXAA source UNCHANGED, with its implicit-LOD fetch. Off by
   * default because that fetch sits in a loop with a data-dependent exit and
   * ANGLE warns `X3595` on it, which the smoke runner correctly fails.
   *
   * The knob is the CONTROL, and running it demolished the claim it was built to
   * confirm. "`tLdr` has no mipmaps, so the two fetches select the same texel"
   * predicts identical pixels. Measured: max channel delta 176 of 255 over 5.5%
   * of the frame. The substitution is not a rounding difference.
   *
   * What IS true, and is what `probes/post.js` asserts: every pixel the two
   * variants disagree on is a pixel FXAA moved at all (containment 1.0000 of
   * 5.9% differing, against 12.5% that FXAA touches). And the explicit variant
   * is the CORRECT one rather than merely the quiet one: three fetches with
   * implicit derivatives inside a loop with a data-dependent exit, where
   * derivatives are undefined, which is precisely what ANGLE X3595 reports.
   */
  fxaaImplicitLod: boolean;
}


// RN-208: the defaults live in their own file for the 400-line cap and are
// re-exported here, so `PostConfig.js` remains the one import site for them.
export { POST_DEFAULTS, tuningFrom } from './PostDefaults.js';
import { POST_DEFAULTS, tuningFrom } from './PostDefaults.js';

export interface PostSettings {
  readonly flags: PostFlags;
  readonly tune: PostTuning;
}

function n(p: URLSearchParams, key: string, fallback: number): number {
  const v = p.get(key);
  if (v === null) return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Standing rule 7, applied to a layer that is drawn on top of everything: every
 * effect switches off INDEPENDENTLY and the master switch restores the exact
 * path the renderer took before this lane existed.
 *
 *   ?post=0    no render target, no composite. three's own ACES on the canvas.
 *   ?ao=0      no AO buffers written and no multiply into the scene colour.
 *   ?contact=0 no contact-shadow march and no multiply. Plus ?cslength=
 *              ?cssteps= ?csthick= ?csstrength= to sweep it.
 *   ?underwater=0 no absorption blend and no in-scatter blend, so the image is
 *              the pre-lane one exactly. Plus ?uwext= (extinction scale),
 *              ?uwtint= (tint scale), ?uwscatter= and ?uwpath= to sweep it.
 *              Note the pass is skipped whenever the eye is dry regardless, so
 *              on a dry planet this flag can move nothing.
 *   ?bloom=0   no pyramid at all, and the composite's bloom term is zero.
 *   ?grade=0   the colour grade becomes an identity mix. LOOK changes, not cost.
 *   ?curve=0   the grade's contrast term returns to the RN-10 straight line, so
 *              the response-curve change of RN-207 has a one-flag control that
 *              costs nothing and forks no program. Plus ?contrast= ?saturation=
 *              ?lift= ?vignette= to sweep the grade from a URL.
 *   ?aa=0      the composite writes straight to the canvas, no FXAA pass.
 *
 * The tunables are here rather than in Config.ts because they are rendering
 * numbers and Config.ts is the "what run is this" authority, not a settings bag.
 */
export function parsePost(search: string, quality: 'low' | 'med' | 'high'): PostSettings {
  const p = new URLSearchParams(search);
  const master = p.get('post');
  // TWO SCENARIOS TURN THE STACK OFF BY DEFAULT, because both READ RAW PIXEL
  // VALUES and a tone curve plus a colour grade silently changes what they read.
  // This is the same argument Boot.ts already makes for the atmosphere under
  // `?clear=` ("a painted sky makes every void pixel opaque, so the census would
  // silently read zero"), applied to a layer that recolours every pixel.
  //
  //   ?clear=RRGGBB  LoopFrameHash.countHoles compares presented pixels against the clear
  //     colour with a +/-12 per-channel tolerance. Magenta through ACES, an sRGB
  //     encode, a split tone and a vignette is not magenta within 12 counts, so
  //     every crack and hole probe would read ZERO holes and pass.
  //   ?scenario=zfight  ZFightProbe reads back coloured coplanar pairs. Post
  //     buys it nothing and could only move the colours it compares.
  //
  // Both are overridable with an explicit `?post=1`, so the interaction can be
  // measured rather than merely avoided.
  const clear = p.get('clear');
  const readsRawPixels = (clear !== null && clear !== '' && clear !== '000000')
    || p.get('scenario') === 'zfight';
  const on = master === '1' ? true
    : master === '0' ? false
      : quality !== 'low' && !readsRawPixels;
  return {
    flags: {
      post: on,
      ao: p.get('ao') !== '0',
      contact: p.get('contact') !== '0',
      underwater: p.get('underwater') !== '0',
      bloom: p.get('bloom') !== '0',
      grade: p.get('grade') !== '0',
      aa: p.get('aa') !== '0',
    },
    tune: tuningFrom({
      aoScale: Math.min(1, Math.max(0.25, n(p, 'aoscale', POST_DEFAULTS.aoScale))),
      aoSlices: Math.min(8, Math.max(1, n(p, 'aoslices', POST_DEFAULTS.aoSlices) | 0)),
      aoSteps: Math.min(16, Math.max(1, n(p, 'aosteps', POST_DEFAULTS.aoSteps) | 0)),
      aoRadiusM: Math.max(0.02, n(p, 'aoradius', POST_DEFAULTS.aoRadiusM)),
      aoStrength: Math.min(1, Math.max(0, n(p, 'aostrength', POST_DEFAULTS.aoStrength))),
      aoPower: Math.max(0.1, n(p, 'aopower', POST_DEFAULTS.aoPower)),
      // RN-2190. `?aothin=0` is the isolator: it forces the amount to 0.0,
      // which is algebraically the pre-RN-2190 AO_FS expression, regardless of
      // what ?aothinamount= asks for. `?aothinedge=` sweeps the threshold alone.
      aoThinEdgeM: Math.max(0.001, n(p, 'aothinedge', POST_DEFAULTS.aoThinEdgeM)),
      aoThinAmount: p.get('aothin') === '0'
        ? 0 : Math.min(1, Math.max(0, n(p, 'aothinamount', POST_DEFAULTS.aoThinAmount))),
      aoThinNearM: Math.max(0, n(p, 'aothinnear', POST_DEFAULTS.aoThinNearM)),
      aoThinFarM: Math.max(0.01, n(p, 'aothinfar', POST_DEFAULTS.aoThinFarM)),
      csLengthM: Math.max(0.01, n(p, 'cslength', POST_DEFAULTS.csLengthM)),
      csSteps: Math.min(24, Math.max(2, n(p, 'cssteps', POST_DEFAULTS.csSteps) | 0)),
      csThickM: Math.max(0.01, n(p, 'csthick', POST_DEFAULTS.csThickM)),
      csStrength: Math.min(1, Math.max(0, n(p, 'csstrength', POST_DEFAULTS.csStrength))),
      uwExtinction: Math.max(0, n(p, 'uwext', POST_DEFAULTS.uwExtinction)),
      uwTintScale: Math.max(0, n(p, 'uwtint', POST_DEFAULTS.uwTintScale)),
      uwScatterFrac: Math.max(0, n(p, 'uwscatter', POST_DEFAULTS.uwScatterFrac)),
      uwMaxPathM: Math.max(1, n(p, 'uwpath', POST_DEFAULTS.uwMaxPathM)),
      bloomLevels: Math.min(7, Math.max(1, n(p, 'bloomlevels', POST_DEFAULTS.bloomLevels) | 0)),
      bloomStrength: Math.max(0, n(p, 'bloomstrength', POST_DEFAULTS.bloomStrength)),
      bloomThreshold: Math.max(0, n(p, 'bloomthresh', POST_DEFAULTS.bloomThreshold)),
      exposure: Math.max(0.01, n(p, 'exposure', POST_DEFAULTS.exposure)),
      // The look-development knobs (RN-207). They were in-page only, which made
      // every grade comparison a `setPostTune` call inside one probe and left no
      // way to boot a build in a known grade. `?curve=0` is the one that matters:
      // it is the negative control for the whole response-curve change and it
      // reaches the shipped straight line without a rebuild.
      curveMix: Math.min(1, Math.max(0, n(p, 'curve', POST_DEFAULTS.curveMix))),
      contrast: Math.max(0, n(p, 'contrast', POST_DEFAULTS.contrast)),
      saturation: Math.max(0, n(p, 'saturation', POST_DEFAULTS.saturation)),
      lift: n(p, 'lift', POST_DEFAULTS.lift),
      vignette: Math.min(1, Math.max(0, n(p, 'vignette', POST_DEFAULTS.vignette))),
      // MSAA on the HDR scene target. Off by default: it costs `samples` times
      // the colour AND depth memory of a 16-bit-float target, and three has to
      // resolve the depth attachment mid-frame for the AO pass to read it. The
      // knob exists so that trade is measured rather than asserted.
      samples: Math.min(8, Math.max(0, n(p, 'msaa', POST_DEFAULTS.samples) | 0)),
      fxaaImplicitLod: p.get('fxaalod') === '0',
    }),
  };
}
