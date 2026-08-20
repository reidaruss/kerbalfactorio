// The post stack's TUNABLE VALUES and the measurements that chose them, split
// out of PostConfig.ts at RN-208 purely for the 400-line cap (ARCHITECTURE 2.2
// rule 1): the look-development calibration needed the room to state its own
// evidence, and a constant whose reason is not beside it becomes a constant
// nobody dares move. PostConfig.ts RE-EXPORTS both names, so every existing
// import site resolves unchanged and there is still exactly one authority on
// what the stack's defaults are.
//
// The TEXT of every value and every comment below is unchanged by the move.

import type { PostTuning } from './PostConfig.js';

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
  // RN-2130, retuned BY EYE against the meadow hero frame, which is the
  // process the fidelity charter's Option D installs and is why no instrument
  // delta is quoted for it. 0.9 m is a metre-scale occlusion radius chosen for
  // machine feet and belt legs, and it is the wrong radius for an understorey
  // card 0.28 m tall: at 0.9 m every tuft in the meadow occludes its whole
  // neighbourhood and the frame reads as dark patches with grass in them
  // rather than grass with shade under it. 0.55 m is a little under twice the
  // density-weighted mean understorey height, so a blade still shades its own
  // base and stops shading the next clump over.
  aoRadiusM: 0.55,
  aoFalloff: 0.55,
  // 9% of the screen. Without this, standing with your face against a wall makes
  // every AO pixel sample the whole framebuffer and the cost spikes on exactly
  // the frames that are already worst.
  aoMaxScreen: 0.09,
  // 0.9 and not 1.0: this multiplies TOTAL radiance, including direct sun,
  // because the terrain program computes its own light from uSunDir and there is
  // no ambient channel to reach into. Holding a little back is the honest
  // correction for occluding light that was never occludable.
  //
  // RN-2130: 0.9 -> 0.60, AND THE ARGUMENT ABOVE IS WHY, TAKEN FURTHER. If
  // this multiplies total radiance then a strength of 0.9 says "a fully
  // occluded surface receives a tenth of all light in the universe", which is
  // not a correction, it is a hole. The measurement on the meadow hero frame
  // before this change: near-ground loFrac 0.318, i.e. nearly a third of the
  // ground at the player's feet below display luma 24, at a 33 degree sun on
  // open flat plain. `aoStrength` is now a PER-CHANNEL weight at the shader
  // (see AoGlsl's AO_APPLY_FS and ToneDrive's OCC_TINT_DAY): this number is
  // the red channel's strength and green and blue are 0.86 and 0.62 of it, so
  // the effective grey strength is nearer 0.47 and what is left in the hollow
  // is sky-coloured rather than absent.
  aoStrength: 0.6,
  // 1.35 -> 1.15. The power curve steepens the dark end of the occlusion image,
  // which was compensating for a term that had already been asked to do too
  // much. With the strength honest, the compensation is a second darkening.
  aoPower: 1.15,
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
  // RN-2130, BLOOM RESTRAINT. 0.75 -> 0.86 and 0.14 -> 0.10, and the reason is
  // the shoulder rather than the bloom. The tone response now compresses
  // everything above display 0.58, so a halo that was authored against an
  // uncompressed top end lands on a top end that has moved down: at the old
  // values the bloom was spending its lift inside the range the shoulder is
  // pulling back, which reads as haze rather than as glow. The threshold stays
  // well clear of 0.4, where the sweep in the note above measured bloom
  // becoming a global lift instead of a halo, and that remains the boundary
  // this constant is defending.
  bloomThreshold: 0.86,
  bloomKnee: 0.5,
  bloomScatter: 0.85,
  bloomStrength: 0.1,
  // RN-208, THE LOOK-DEVELOPMENT CALIBRATION, AND THE CRITERION THAT CHOSE IT.
  //
  // ART-DIRECTION.md asks for grounded, muted, layered colour in which "value
  // and material contrast do the work rather than hue". That is measurable on a
  // single frame with no reference, and `probes/lookdev.js` measures it: the
  // interquartile range of luminance is how much work VALUE is doing, and mean
  // saturation is how much work HUE is doing.
  //
  // Measured, one binary, in-page pairs with an EXACTLY ZERO instrument floor,
  // world band (bottom quarter dropped: the first-person arms are their own pass
  // with their own hemisphere and barely respond to the sun, RN-66), at three
  // sites and four sun elevations:
  //
  //             iqr before -> after      mean saturation before -> after
  //   Hills  noon 79 deg     55 -> 71     0.527 -> 0.473
  //   Plains noon 59 deg     89 -> 108    0.564 -> 0.492
  //   Forest noon 47 deg    113 -> 132    0.544 -> 0.454
  //   Hills  graze 12 deg    99 -> 121    0.547 -> 0.470   (see rendering.md)
  //
  // EXPOSURE 1.2 IS NOT A TASTE, IT IS THE LARGEST VALUE AT WHICH THE SHADOW
  // OCCUPANCY DOES NOT MOVE. `loFrac`, the share of the frame under luma 24,
  // reads 8.11 / 18.32 / 26.67 per cent at the three sites before and
  // 8.50 / 18.63 / 27.41 after. So the gain in value contrast is NOT bought by
  // brightening the image out of its own shadows, which is what every larger
  // exposure does: at 1.4 the same three read 7.11 / 17.12 / 24.46 and the tile
  // diff goes one-way-lighter, which is an exposure change wearing a contrast
  // costume. The probe asserts the two-way movement for exactly that reason.
  //
  // AND THE HEADROOM IS THE OTHER HALF. Before this change `hiFrac`, the share
  // of the frame above luma 200, was 0.00 per cent at Hills noon, 0.00 at Plains
  // noon and 0.86 at Forest noon: at every site and every daylight elevation the
  // top fifth of the display range was EMPTY. A frame with no highlights and a
  // clipped black point is the flat, plastic read the art direction is
  // complaining about, and it is not a curve fault, it is an exposure that was
  // never calibrated (it was three's default, carried through RN-10 untouched).
  //
  // SATURATION 0.92 HOLDS CHROMA WHILE VALUE RISES, which is the whole point.
  // A contrast increase applied per channel RAISES chroma on its own: at
  // contrast 1.45 with the shipped saturation 1.08, Hills noon measured
  // saturation 0.527 -> 0.578 and mean chroma 57.7 -> 65.7. At 0.92 the same
  // frame reads chroma 56.8 against the shipped 57.7, i.e. hue is doing
  // fractionally LESS work than before while value does 29 per cent more.
  // RN-2130: THIS IS STILL THE NOON EXPOSURE AND IT IS STILL 1.2. ToneDrive.ts
  // now drives the live value off the sun's elevation and lands on exactly
  // this number at a high sun, deliberately: 1.2 is the one exposure in this
  // project that was MEASURED (the largest value at which shadow occupancy
  // does not move, three sites, four elevations, above) and a look lane does
  // not get to discard a calibration because it wants a different picture. The
  // half of the arc that moves is the half nobody ever calibrated. This field
  // also remains the value `?tone=0` restores, which is what makes the whole
  // fidelity lane switchable off in one flag.
  exposure: 1.2,
  contrast: 1.45,
  curveMix: 1,
  // 0.92 -> 0.94. The green harmonisation removes hue DISAGREEMENT rather than
  // hue, so a frame that has stopped arguing with itself can carry slightly
  // more chroma than one that has not. Two hundredths, and it is stated as the
  // judgement it is.
  saturation: 0.94,
  // RN-2130. THE PALETTE, and it is no longer "toward the desert biome".
  //
  // The decision is written out in full in ToneDrive.ts: ONE MEADOW, LIT AT TWO
  // TEMPERATURES. Warm dry-straw light on what the sun touches, cool blue-green
  // in what it does not, because the sky is the only other lamp in the scene.
  // The RN-208 tints were +-0.035 either side of neutral, which is a hint at a
  // split tone rather than one; these have a measured max deviation 0.14
  // along the warm/cool axis rather than along the desert's orange/teal one.
  //
  // BOTH STILL AVERAGE TO ABOUT 1.0 ACROSS RGB, which is the invariant RN-208
  // established and this lane keeps: the split tone moves hue and must not
  // become a second exposure control, because there is now a real one.
  // ToneDrive adds the dawn warmth ON TOP of the highlight side only.
  shadowTint: [0.91, 0.99, 1.14],
  highlightTint: [1.055, 1.01, 0.93],
  // 0 at RN-208, was 0.012. A shadow lift is a lifted BLACK POINT, which is the
  // first thing ART-DIRECTION.md's "pastel" names. The term stays (it is one
  // multiply-add and it takes a NEGATIVE value to crush instead), because the
  // next lane may want to open the toe once albedo work lands.
  lift: 0.0,
  vignette: 0.16,
  vignetteSoft: 0.45,
  samples: 0,
  fxaaImplicitLod: false,
};

export function tuningFrom(over: Partial<PostTuning>): PostTuning {
  return { ...POST_DEFAULTS, ...over };
}
