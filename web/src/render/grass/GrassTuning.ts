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
  grasstint: q.get('grasstint'),
};

/**
 * NEAR TUFT DENSITY, instances per square metre at the eye.
 *
 * THE NUMBER THE BRIEF ASKS FOR IS BLADES PER SQUARE METRE (50 to 150) AND THIS
 * IS NOT THAT NUMBER, so the conversion is written down rather than left for a
 * reader to reconstruct. `of_grass_a.png` is ELEVEN tapering blades periodic in
 * u over the full texture width (texgen.py `_grass_strips`, pitch 1/11). A near
 * tuft is TUFT_QUADS crossed quads, each taking a u-slice of CARD_U_SPAN, so it
 * carries `TUFT_QUADS * CARD_U_SPAN * 11` painted blades:
 *
 *   2 quads x 0.42 span x 11 blades = 9.24 blades per tuft
 *   14 tufts/m2 x 9.24              = 129 blades per square metre
 *
 * which is inside the brief's band and near its top, where a meadow wants to
 * be. `?grassdens=` scales it; 0 leaves the layer constructed and empty, which
 * is deliberately NOT the same control as `?grass=0` (one measures the cost of
 * an empty pass, the other removes the pass).
 */
export const NEAR_PER_M2 = 14 * num('grassdens', 1);

/**
 * The density falloff's half-distance, in metres. Density is
 * `NEAR_PER_M2 / (1 + d/DENS_HALF_M)^2`, i.e. it falls as the inverse square of
 * a shifted range, which is the law that keeps SCREEN density roughly flat: the
 * ground area one pixel covers grows as the square of range over the same span.
 * A flat-per-m2 carpet is the thing to avoid; it is a wall of instances at the
 * horizon and a thin one at your feet.
 */
export const DENS_HALF_M = 9;

/** The near tuft's card, in metres, at the eye. Grown with range by `growAt`. */
export const TUFT_W_M = 0.30;
export const TUFT_H_M = 0.26;
/** Crossed quads per near tuft. Two is the cheapest shape that reads from any
 *  bearing; a third quad is +50% triangles for a silhouette the per-instance
 *  yaw already scrambles across the field. */
export const TUFT_QUADS = 2;
/** Height segments per quad. TWO, so the wind can BEND a blade rather than
 *  shearing it: one segment can only translate the tip, which detaches the card
 *  from its own root line at any visible amplitude. */
export const TUFT_SEGS = 2;
/** The u-slice one quad takes out of the 11-blade periodic card. */
export const CARD_U_SPAN = 0.42;

/**
 * THE FAR RUNG, and it is a different card rather than the near one scaled up.
 *
 * Holding COVERAGE constant while density falls means growing the card as the
 * range, and at 90 m that is a 1.3 m "blade", which is a bush. The honest
 * answer is a second rung whose card is WIDE AND SHORT: one quad, two
 * triangles, the full 11-blade u span, sized like a patch of turf rather than
 * like a tuft. It costs a quarter of a near tuft per instance, which is what
 * makes covering the 14 m to 92 m annulus affordable at all.
 */
export const MAT_W_M = 1.10;
export const MAT_H_M = 0.42;
/** Far-rung instances per square metre, flat. Coverage per instance is
 *  MAT_W_M * MAT_H_M = 0.462 m2 of vertical curtain, so 1.7/m2 is 0.79 of the
 *  ground area standing up: at the grazing angle a standing eye sees the mid
 *  field through, that is a closed carpet. */
export const MAT_PER_M2 = 1.7 * num('grassdens', 1);
/** Where the far rung fades IN, in metres. Inside this the near tufts own the
 *  ground and a second card layer would only add overdraw. */
export const MAT_IN_LO_M = 12;
export const MAT_IN_HI_M = 20;

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
