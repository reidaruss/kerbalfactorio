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

export const POST_DEFAULTS: PostTuning = {
  // Half resolution. Full-res AO measured at 3.2x the cost for a difference
  // that the 4x4 denoise plus the depth-aware upsample already covers; the
  // number is in rendering.md.
  aoScale: 0.5,
  // 3 slices x 6 steps = 36 depth taps per AO pixel. Two slices banded visibly
  // on curved terrain at this denoise width; four cost 28% more for no
  // measurable contrast change.
  aoSlices: 3,
  aoSteps: 6,
  aoRadiusM: 0.9,
  aoFalloff: 0.55,
  // 9% of the screen. Without this, standing with your face against a wall makes
  // every AO pixel sample the whole framebuffer and the cost spikes on exactly
  // the frames that are already worst.
  aoMaxScreen: 0.09,
  // 0.9 and not 1.0: this multiplies TOTAL radiance, including direct sun,
  // because the terrain program computes its own light from uSunDir and there is
  // no ambient channel to reach into. Holding a little back is the honest
  // correction for occluding light that was never occludable.
  aoStrength: 0.9,
  aoPower: 1.35,
  // Depth weight, per metre. 8 keeps the blur inside a 12 cm depth band.
  aoDepthSigma: 8,
  // 0.45 m, which is a little over the density-weighted mean understorey height
  // of 0.281 m and well under cascade 0's 15.5 mm-per-texel resolution limit for
  // a blade. The term is bounded BY DISTANCE, which is what stops it ever
  // disagreeing with the cascaded maps: it physically cannot see a hill.
  csLengthM: 0.45,
  // 8 taps. The march is full resolution, so this is 8 depth reads per lit
  // pixel; 12 was measured and bought a difference smaller than the run-to-run
  // spread, which is reported rather than spent.
  csSteps: 8,
  // An occluder deeper than this is not between the surface and the sun, it is a
  // separate object further away that happens to line up. Without the upper
  // bound a hillside shadows the ground in front of it through open air.
  csThickM: 0.55,
  csBiasM: 0.012,
  // Deliberately below 1.0. Like `aoStrength`, this multiplies TOTAL radiance
  // including sky ambient, because the terrain program computes its own light
  // from uSunDir and there is no direct-only channel to reach into. Holding some
  // back is the honest correction for occluding light that was never occludable.
  csStrength: 0.72,
  csMaxScreen: 0.05,
  // WHERE THESE COME FROM. The shape is the Smith and Baker (1981) absorption
  // spectrum of pure water, which is the standard tabulation and is brutally
  // asymmetric: about 0.24 /m at 600 nm (red), 0.055 /m at 550 nm (green) and
  // 0.011 /m at 450 nm (blue). Red is absorbed roughly 22x harder than blue, and
  // that ratio, not the absolute level, is what makes water look like water.
  //
  // What is shipped is that spectrum with a small, roughly grey scattering and
  // dissolved-organics term added for a SMALL FRESHWATER POND, which is turbid
  // in a way clear ocean water is not: 0.35 / 0.06 / 0.045 per metre. The blue
  // channel moves the most in relative terms (0.011 to 0.045) because particulate
  // scattering is the term that dominates there and a pond has plenty of it.
  // Sanity check at the pond's own scale: the basin is about 4 m deep, so a ray
  // across it collects exp(-0.35 * 4) = 0.25 of its red, exp(-0.06 * 4) = 0.79
  // of its green and exp(-0.045 * 4) = 0.84 of its blue. That is a visible
  // colour cast at pond depth rather than a wash, which is the intent.
  uwSigma: [0.35, 0.06, 0.045],
  uwExtinction: 1.0,
  // The equilibrium radiance: what a pixel at infinite depth becomes. Blue-green
  // and DARK, at roughly a fifth of lit-ground radiance, because it is sunlight
  // that has already been scattered sideways through several metres of the same
  // water the coefficients above describe. A bright tint here is the failure this
  // whole term exists to avoid: it lifts the frame instead of drowning it, which
  // is the same "global lift rather than a halo" mistake DW-35 warns about for
  // bloom and PostConfig's own bloom note measured.
  uwTint: [0.045, 0.135, 0.155],
  uwTintScale: 1.0,
  uwScatterFrac: 1.0,
  // 60 m. The pond is 22 m across and about 4 m deep, so nothing that is
  // genuinely under water is further away than about 25 m; past that the ray has
  // left through the surface or is looking at a background pixel, and both cases
  // want to saturate. At 60 m even blue keeps only exp(-0.045 * 60) = 0.067, so
  // the cap is well past the point where it can be seen, and it is here to keep
  // exp() away from an argument of 4.5e7 rather than to shape anything.
  uwMaxPathM: 60,
  bloomLevels: 5,
  // 0.75 and 0.14, and BOTH were retuned after measurement rather than chosen.
  // At the first values (threshold 1.0, strength 0.05) bloom was wired, correct
  // and effectively invisible: the brightest thing in the scene is SkyPass's sun
  // sprite at about 1.0 of HDR radiance, so it sat exactly ON the knee and only
  // the shoulder contributed, for a measured peak lift of 0.4 of 255. Nine draw
  // calls were buying nothing anybody could see.
  //
  // The sweep that picked the replacement, measured on the sun disc with the
  // aim solved analytically against `SkyPass.dirForT` (residual 0.019 degrees):
  //   threshold 1.0  peak +0.41   sky-half pixels moved 0.0001
  //   threshold 0.7  peak +1.03   sky-half pixels moved 0.0047
  //   threshold 0.4  peak +2.08   sky-half pixels moved 0.9948   <- the whole sky
  //   threshold 0.1  peak +3.05   sky-half pixels moved 0.9994
  // 0.4 is where bloom stops being a halo and becomes a global lift, which is
  // the exact failure mode DW-35 warns about, so the threshold sits well above
  // it and the STRENGTH does the visible work instead. Radial decay at these
  // values is a halo and not a lift: the lift falls by roughly 4x from the
  // source to 100 px and is under 0.03 of 255 beyond 300 px.
  bloomThreshold: 0.75,
  bloomKnee: 0.5,
  bloomScatter: 0.85,
  bloomStrength: 0.14,
  exposure: 1.0,
  contrast: 1.06,
  saturation: 1.08,
  // Graded TOWARD the desert biome, which already reads well: warm in the light,
  // slightly cool in shade. Both tints average to 1.0 across RGB so the grade
  // moves hue, not exposure.
  shadowTint: [0.97, 0.995, 1.035],
  highlightTint: [1.035, 1.005, 0.96],
  lift: 0.012,
  vignette: 0.16,
  vignetteSoft: 0.45,
  samples: 0,
  fxaaImplicitLod: false,
};

export function tuningFrom(over: Partial<PostTuning>): PostTuning {
  return { ...POST_DEFAULTS, ...over };
}

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
  //   ?clear=RRGGBB  Loop.countHoles compares presented pixels against the clear
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
      // MSAA on the HDR scene target. Off by default: it costs `samples` times
      // the colour AND depth memory of a 16-bit-float target, and three has to
      // resolve the depth attachment mid-frame for the AO pass to read it. The
      // knob exists so that trade is measured rather than asserted.
      samples: Math.min(8, Math.max(0, n(p, 'msaa', POST_DEFAULTS.samples) | 0)),
      fxaaImplicitLod: p.get('fxaalod') === '0',
    }),
  };
}
