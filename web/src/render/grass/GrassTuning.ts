// THE GROUND-COVER CARPET'S NUMBERS, in one file, RN-2145.
//
// WHY A CARPET AND NOT MORE SCATTER (the gap analysis, section 1 difference 1).
// The prop scatter places DISCRETE OBJECTS on the ground: a tuft is a thing that
// stands somewhere, with a silhouette, a species and a shadow. Space Engineers'
// grassland does not read that way, and the reason is not density: their ground
// IS grass, a continuous cover whose colour is the terrain's own colour, and
// ours is a substrate with objects on it. Those are two different systems, and
// bolting the second onto the first is how you get a denser table with more
// objects on it. So this is a separate layer with a separate rule: EVERY BLADE
// TAKES ITS COLOUR FROM THE GROUND BENEATH IT (GrassPalette.coverAlbedo), which
// is what makes cover and substrate structurally unable to disagree.
//
// THE UNIT DISCIPLINE, and it is WG-192's scar in both directions (recorded in
// ScatterLook.CLUSTER_SHIFT and again in RN-1855): a value in CELLS is silently
// a function of maxDepth, and a value in METRES is silently a function of the
// cell. Every distance here is in METRES because every one of them is about how
// far away the camera is, which is not a property of the lattice. The one
// quantity that is NOT about metres is the fade, and it is in PIXELS, for the
// same reason: what retires a blade card is that it stops being resolvable, and
// that is an angular fact about the camera, not a distance.

/** ?grass=0 removes the whole layer: no geometry, no material, no draw. The
 *  control is bit-exact against the pre-carpet build because nothing is
 *  constructed, which is standing rule 7's shape (?wind=0's precedent). */
const q = new URLSearchParams(self.location.search);

/** A missing parameter is MISSING, not zero. `Number(null)` is 0 and this
 *  project has shipped two features permanently off through that exact hole
 *  (RN-150: the ground texture and the wet-sand shoreline). */
function num(name: string, dflt: number): number {
  const v = q.get(name);
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : dflt;
}

export const GRASS_ON = q.get('grass') !== '0';
/** The raw strings, published beside the resolved values so a probe asserts the
 *  BOOT DEFAULT as its own fixture rather than inferring it. */
export const GRASS_RAW: Readonly<Record<string, string | null>> = {
  grass: q.get('grass'), grassdens: q.get('grassdens'),
  grassfade: q.get('grassfade'), grasspx: q.get('grasspx'),
  grasstint: q.get('grasstint'), grasssharp: q.get('grasssharp'),
  grasstrans: q.get('grasstrans'), grassval: q.get('grassval'),
};

/** A flat multiplier on the cover albedo's VALUE, applied after the luminance-
 *  preserving chroma rotation so the two are separable: the rotation is the
 *  rule and this is the one knob for "is the carpet sitting at the same level
 *  as the ground it stands on". `?grassval=` sweeps it and 1 is the honest
 *  default (the carpet IS the ground's albedo and nothing more). */
export const COVER_VALUE = num('grassval', 1);

/**
 * NEAR TUFT DENSITY, instances per square metre at the eye.
 *
 * THE NUMBER THE BRIEF ASKS FOR IS BLADES PER SQUARE METRE (50 to 150) AND THIS
 * IS NOT THAT NUMBER, so the conversion is written down rather than left for a
 * reader to reconstruct. `of_grass_a.png` is FIFTEEN tapering blades periodic in
 * u over the full texture width (texgen.py `_grass_strips`, pitch 1/15; RN-2330
 * to RN-2339 raised this from ELEVEN and narrowed every blade, the world audit's
 * "brushed not bladed" fix). A near tuft is TUFT_QUADS crossed quads, each
 * taking a u-slice of CARD_U_SPAN, so it carries `TUFT_QUADS * CARD_U_SPAN * 15`
 * painted blades:
 *
 *   2 quads x 0.20 span x 15 blades = 6.0 blades per tuft
 *   32 tufts/m2 x 6.0               = 192 blades per square metre at the eye,
 *                                     falling through the brief's 50 to 150 band
 *                                     between about 2 m and 6 m (see DENS_HALF_M)
 *
 * which is inside the brief's band and near its top, where a meadow wants to
 * be, and is within a blade of the pre-RN-2330 190: CARD_U_SPAN moved 0.27 ->
 * 0.20 (11/15 of the old value) FOR EXACTLY THIS REASON, so the painted-blades-
 * per-card count holds at 3.0 while each of those three blades is individually
 * the narrower, sharper-tapered shape texgen now paints; the areal density this
 * comment protects therefore does not move as a side effect of the texture
 * change. `?grassdens=` scales it; 0 leaves the layer constructed and empty,
 * which is deliberately NOT the same control as `?grass=0` (one measures the
 * cost of an empty pass, the other removes the pass).
 */
export const NEAR_PER_M2 = 32 * num('grassdens', 1);

/**
 * The density falloff's half-distance, in metres. Density is
 * `NEAR_PER_M2 / (1 + d/DENS_HALF_M)^2`, i.e. it falls as the inverse square of
 * a shifted range, which is the law that keeps SCREEN density roughly flat: the
 * ground area one pixel covers grows as the square of range over the same span.
 * A flat-per-m2 carpet is the thing to avoid; it is a wall of instances at the
 * horizon and a thin one at your feet.
 */
export const DENS_HALF_M = 10;

/** The near tuft's card, in metres, at the eye. Grown with range by `growAt`.
 *
 * RN-2145 FIRST CAPTURE, and the number moved because the picture said so.
 * At 0.30 m wide over a 0.42 u span the card carries 4.6 painted blades, i.e.
 * a blade is 6.5 cm across, and the FIRST MEADOW FRAME CAME BACK AS SOLID
 * TAPERED WEDGES with no blade separation at all. The cause is the card
 * family's own stated design: `texgen.py` set the blade width to clear the
 * 0.35 alpha cutoff so "distant mips converge toward solid rather than
 * dissolving", and at 4 m a 0.42 u span across 58 px is a mip-3 fetch where
 * the 1.6-texel gaps between blades average away. Fewer, wider blades per
 * card is the fix that survives the mip: 0.27 span is three blades, whose
 * gaps are 2.5 texels at the same mip and are still there. */
//
// SECOND CAPTURE: 0.18 x 0.30 still read as GREEN SHARK FINS. The painted blade
// is 5 to 8 per cent of the card's width, so a 0.18 m card makes a 3.5 to 5.3 cm
// blade against a 30 cm height: an aspect of about 1:6.7, which is a succulent
// and not a grass. Real grass is nearer 1:30, and the floor on how thin we can
// go is the harness's own: FXAA only, no MSAA, no TAA (world audit gap 17), so
// an alpha-tested blade under about 4 px shimmers in motion. 0.13 x 0.34 puts
// the blade at 3.2 cm and 1:10.6, which is 6.3 px at 4 m: as slim as this
// renderer can hold still, and stated as the constraint it is rather than as a
// choice.
export const TUFT_W_M = 0.13;
export const TUFT_H_M = 0.38;
/** Crossed quads per near tuft. Two is the cheapest shape that reads from any
 *  bearing; a third quad is +50% triangles for a silhouette the per-instance
 *  yaw already scrambles across the field. */
export const TUFT_QUADS = 2;
/** Height segments per quad. TWO, so the wind can BEND a blade rather than
 *  shearing it: one segment can only translate the tip, which detaches the card
 *  from its own root line at any visible amplitude. */
export const TUFT_SEGS = 2;
/** The u-slice one quad takes out of the periodic card. See TUFT_W_M for why
 *  it is three blades and not five.
 *
 *  RN-2330 to RN-2339: moved 0.27 -> 0.20 when `_grass_strips` went from 11
 *  painted blades to 15 (thinner, sharper-tapered, the world audit's
 *  "brushed not bladed" fix): 0.27 * 11/15 = 0.198, rounded to 0.20, holds
 *  the SAME three-painted-blades-per-quad count the RN-2145 first capture
 *  chose (a wider span reads as a mip-solid wedge; see the note above this
 *  constant's old value in git history), so this constant is the reason the
 *  texture's own blade-count change costs the near tuft nothing in areal
 *  blade density (see NEAR_PER_M2's arithmetic above). */
export const CARD_U_SPAN = 0.20;

/**
 * THE FAR RUNG, and it is a different card rather than the near one scaled up.
 *
 * Holding COVERAGE constant while density falls means growing the card as the
 * range, and at 90 m that is a 1.3 m "blade", which is a bush. The honest
 * answer is a second rung whose card is WIDE AND SHORT: one quad, two
 * triangles, the full blade-set u span (15 since RN-2330 to RN-2339, was 11),
 * sized like a patch of turf rather than like a tuft. It costs a quarter of a
 * near tuft per instance, which is what
 * makes covering the 14 m to 92 m annulus affordable at all.
 */
export const MAT_W_M = 1.10;
export const MAT_H_M = 0.42;
/** Far-rung instances per square metre, flat. Coverage per instance is
 *  MAT_W_M * MAT_H_M = 0.462 m2 of vertical curtain, so 1.55/m2 is 0.72 of the
 *  ground area standing up: at the grazing angle a standing eye sees the mid
 *  field through, that is a closed carpet. */
export const MAT_PER_M2 = 1.55 * num('grassdens', 1);
/** Where the far rung fades IN, in metres. Inside this the near tufts own the
 *  ground and a second card layer would only add overdraw. */
export const MAT_IN_LO_M = 12;
export const MAT_IN_HI_M = 20;

/**
 * RN-2355 to RN-2364, world audit R2 lane L4. WHERE THE FAR RUNG HANDS OVER,
 * and it is a real window rather than the shipped "never" (1e8, 1e9).
 *
 * MEASURED, NOT ASSUMED: `meadowfield`, one flag apart on one build, the same
 * `?grass=0` isolator every other lane uses. With the carpet ON the ground past
 * 35 m reads FLATTER than the BARE terrain does, and the gap widens with range:
 *
 *   range   ON iqr   OFF iqr (bare terrain, now real material since L1)
 *    20 m    33.85    54.76
 *    35 m    25.91    53.18
 *    55 m    21.14    55.76
 *    75 m    19.07    51.93
 *    95 m    17.00    45.06
 *
 * The near tuft's own header states the law this rung was shipped without:
 * "a flat-per-m2 carpet is ... a wall of instances at the horizon". That is
 * exactly what MAT_PER_M2 held at a 1e9 half-distance is, and it is exactly
 * what the audit's "uniform plate" is measuring. A screen row at a grazing
 * pose compresses a large, and RANGE-GROWING, depth of the 12-to-95 m annulus
 * into a handful of pixels, so the number of independently-coloured cards
 * averaging into one pixel grows with range even though the ground-area each
 * card occupies does not fall to compensate (unlike the near tuft's own
 * DENS_HALF_M law, whose whole job is exactly that compensation). The result
 * is the classic many-samples-average-to-a-constant read: luma flatlines near
 * 150 from 55 m to 95 m while the bare ground beneath it swings from 74 to 86.
 *
 * THE FIX IS THE SAME MECHANISM THE NEAR TUFT ALREADY HANDS OVER BY
 * (`uOut`, GrassGlsl's own "a HANDOVER, not a Nyquist fade": TUFT_OUT_LO_M),
 * applied to the rung it was always wired for and never given numbers. It is
 * not a density-law rewrite (which would need the far rung made GRADED to
 * avoid GrassSample.ts's own contract -- "densityAt must be the SAME CURVE
 * THE SHADER EVALUATES, or ... thins" -- and this rung is built once per
 * chunk arrival, never resampled): a smoothstep multiplier can only ever
 * REDUCE `dens` below what `densityAt` (unchanged, still MAT_PER_M2 flat)
 * provisioned for, so the failure mode this can ever produce is WASTE (an
 * instance built and never shown), never THIN (a shown instance that was
 * never built). That is the safe side of GrassSample's own warning.
 *
 * THE WINDOW, AND WHY IT IS NOT [40, 100] AS FIRST TRIED. A [40, 100] arm was
 * built and measured on the same rectangles, and the r55-to-r100 band it was
 * aimed at DID NOT MOVE (`r95` iqr 17.00 before and after, to the digit),
 * while `r130`/`r160` jumped hard (16.86 -> 25.93, 20.06 -> 46.99). The cause
 * is CARD HEIGHT, not card count: a far-rung card grown to its GROW_MAX
 * height (0.798 m) subtends `0.798 / d` radians, which at d = 45 m is 13.9 px
 * at this pose's own `uPxPerRad` -- enough to visually reach a screen row the
 * flat-ground range map assigns to roughly 60 m. A card at 40 to 70 m is only
 * lightly thinned by a [40, 100] window (95.7 per cent density still stands
 * at 35 m, 92.6 per cent at 50 m) and its own height BLEEDS UPWARD into the
 * rows this lane's instrument reads, so the row-level number never saw the
 * far-range thinning at all: it was reading nearer, barely-touched cards the
 * whole time. Pulling the window in fixes the row it was aimed at rather than
 * moving the effect further out and calling it done.
 *
 * THE WINDOW THAT SHIPPED. Lower edge 30 m: `r25` (footM 0.487, well inside
 * the coarse splat's own crossover) is untouched (smoothstep(30, ., 25) is
 * exactly 0) and `r35`'s audit-praised 25.91 loses under 5 per cent of the
 * rung's density (95.7 per cent retained). Upper edge 70 m: by there density
 * is exactly zero, so no card exists to bleed into the rows past it, and the
 * bleed radius of the LAST cards still fading out (at 60 to 70 m, itself
 * under 13 px of angular height) does not reach the `r95`/`r100` band this
 * lane's instrument reads. Both are unchanged from measurement to shipping
 * decision: this is the arm that was actually re-read on the same rectangles,
 * not a second guess left untested.
 *
 * REACH_M IS UNCHANGED (95) and does not need to move: the mechanism is
 * per-instance and keyed on live `dist`, so it retires every card by 70 m
 * regardless of chunk/LOD residency slack, well inside the existing reach.
 * Past 70 m the terrain's own material -- real since L1's RN-2340, iqr 45 to
 * 56 bare in this same band -- is what carries the read, which is the
 * composition this lane's charter asks for rather than a fight over it.
 */
export const MAT_OUT_LO_M = 30;
export const MAT_OUT_HI_M = 70;

/**
 * THE FADE, IN PIXELS, AND WHY IT IS NOT IN METRES.
 *
 * RN-1855's rule is that a fade constant must be DERIVED from the thing it
 * protects, never typed, because a typed metre value is silently a function of
 * whatever geometry it was measured against and goes wrong the day that moves
 * (ART_FINE_M and RELIEF_FINE_M both ran 2.0x past their own Nyquist point for
 * exactly this reason). What retires a grass card is that it stops resolving,
 * so the constant that governs it is an ANGULAR SIZE and the fade is computed
 * live in the vertex shader from the card's own grown height, the eye distance
 * and the camera's own pixels-per-radian:
 *
 *   px = cardHeightM * grow * (viewportH / (2 tan(fovY/2))) / dist
 *
 * FADE_PX_HI to FADE_PX_LO is the window. It is set WELL INSIDE the fold rather
 * than at it: a 6 px card still resolves, and the reason to retire it there is
 * cost, not aliasing. Stating that honestly matters because RN-1900 refused a
 * fade widened to buy content back and the refusal was right; this is the other
 * direction, a fade deliberately kept inside its own Nyquist limit.
 *
 * At the reference viewport (900 px tall, 60 degree vertical fov, so 779.4
 * px/rad) and the far rung's grown card, the window lands at about 60 m to
 * 92 m, which is the 60 to 100 m the charter asks for. THE METRES ARE THE
 * CONSEQUENCE, NOT THE INPUT: change the resolution or the fov and the fade
 * moves with them instead of quietly becoming wrong.
 */
export const FADE_PX_HI = num('grasspx', 9);
export const FADE_PX_LO = FADE_PX_HI * num('grassfade', 0.667);

/**
 * CARD GROWTH WITH RANGE, capped. `grow(d) = min(GROW_MAX, 1 + d/GROW_M)`, the
 * same idea as ScatterTuning.DETAIL_FAR_GROW and for the same reason: it buys
 * back screen coverage per instance as density falls. Capped because an
 * uncapped grow is how a carpet turns into shrubbery at range.
 */
export const GROW_M = 34;
export const GROW_MAX = 1.9;

/**
 * RESIDENCY, in metres of NEAREST approach of the chunk. Beyond this no carpet
 * instance exists at all, which is what keeps the buffers bounded: the whole
 * carpet lives inside a 95 m disc, about 28,000 m2, which at these densities is
 * a five-figure instance count and not a six-figure one.
 */
export const REACH_M = 95;
/** Near tufts stop existing here; the far rung carries the rest. */
export const TUFT_REACH_M = 26;

/**
 * THE REBUILD LADDER, geometric, ratio REBUILD_RATIO.
 *
 * A cell's instance count is decided at BUILD time from that cell's distance,
 * and the eye then moves. Scatter solves this with three named bands and
 * accepts the quantisation (Scatter.detailBandOf); a carpet cannot, because its
 * density changes by 20x across its own reach and a band edge would be a
 * visible ring. So: geometric bands, and a build that LEADS the band (see
 * BUILD_LEAD) so supply is never below demand inside a band, plus a per-instance
 * threshold in the vertex shader so the visible set is a pure function of LIVE
 * distance and a rebuild changes only what EXISTS, never what is SEEN.
 *
 * That last property is the whole reason the shader carries `iWant`: an
 * instance added by a rebuild is born above the current threshold and is
 * invisible until the eye earns it. There is no popping to hide.
 */
export const REBUILD_RATIO = 1.25;
export const BAND_NEAR_M = 3;
/** Build each cell for `dist * BUILD_LEAD`, i.e. denser than it needs, so the
 *  shader's demand stays under supply for the whole band. 1/REBUILD_RATIO
 *  exactly: any less and a chunk runs short before its next rebuild. */
export const BUILD_LEAD = 1 / REBUILD_RATIO;

/** Chunks (re)built per update. Higher than Scatter's 1 because a carpet chunk
 *  is arithmetic over cells with no library acquire, no quaternion compose and
 *  no per-part loop, and because only ~10 chunks are ever inside REACH_M. */
export const BUILDS_PER_UPDATE = 3;

/** Slope gate, cosine against local up. Matched to ScatterTuning.MIN_SLOPE_COS
 *  deliberately: cover and props disagreeing about which ground is walkable
 *  would read as the carpet stopping at an invisible line. */
export const MIN_SLOPE_COS = 0.55;

/** Instance pool ceilings. A cap that TRUNCATES silently biases every number
 *  computed over it (WG-193's meshVertsNear scar: occupancy 1.004 at depth 13
 *  against 0.516 at depth 16, half the disc missing). These REFUSE the chunk
 *  and count the refusal instead, and `report()` publishes the count. */
export const TUFT_CAP = 40000;
export const MAT_CAP = 90000;

/** Which band a nearest-distance falls in. Pure, monotonic, and the only
 *  authority on when a chunk is re-sampled. */
export function bandOf(nearM: number): number {
  if (!(nearM > BAND_NEAR_M)) return 0;
  return 1 + Math.floor(Math.log(nearM / BAND_NEAR_M) / Math.log(REBUILD_RATIO));
}

/** Near-tuft density at a range, instances per square metre. */
export function tuftDensity(d: number): number {
  const k = 1 + Math.max(0, d) / DENS_HALF_M;
  return NEAR_PER_M2 / (k * k);
}
