// HOW MANY TEXELS OF SILHOUETTE ERROR A CASCADE MAY BE GIVEN, and the answer is
// NOT one number for the whole rig.
//
// RN-696. `ShadowLod.ts` shipped with a single `k = 1` and the rocks lane then
// measured that `k = 2` gains 17 of 24 rock rows and 2.26x the saving. Admin gave
// this lane the ruling and asked whether `k` should differ per BATCH TYPE, since
// machine deviations are 325 to 640 mm and were thought neutral to `k`.
//
// BOTH HALVES OF THAT FRAMING ARE WRONG, and the measurement says so.
//
// (1) `k = 2` IS NOT NEUTRAL FOR MACHINES. Measured on the 78-building base, one
//     binary: the saving goes from -15,157 at k=1 to -50,260 at k=2, a factor of
//     3.3, and almost all of it is the smelter's and the assembler's `_LOD2`
//     (396 mm and 400 mm) fitting cascade 2's doubled 421.88 mm budget. The
//     reward is not on the node side alone, so neither is the risk.
//
// (2) THE THING THAT VARIES IS THE CASCADE, NOT THE ASSET. A texel is a world
//     length; what the eye can see is its SCREEN footprint, and that is
//     `texel / pixelSize(d)` where `pixelSize(d) = 2 d tan(fov/2) / height`. At
//     the near edge of each cascade's own working range, with the client's 60
//     degree vertical FOV:
//
//       cascade 0, texel 15.47 mm, nearest caster 2.2 m   ->  5.48 px per texel
//       cascade 1, texel 56.25 mm, near split   22 m      ->  1.99 px per texel
//       cascade 2, texel 210.94 mm, near split  80 m      ->  2.06 px per texel
//
//     Cascades 1 and 2 are self-similar at about two pixels per texel, which is
//     not luck: they are consecutive splits fitted by the same 0.72 factor into
//     the same map size. CASCADE 0 IS THE ODD ONE, three times coarser on screen,
//     because it has no near SPLIT to be measured against, only the player's own
//     standing distance. So a uniform k in texels hands cascade 0 three times the
//     visible error it hands the other two, right in front of the player's face,
//     which is the one place the brief's failure modes are most legible.
//
// THE RULE: bound the SCREEN error, not the texel count.
//
//     k(c) = SCREEN_PX / pxPerTexel(c)
//
// One published budget in pixels, and every cascade's k falls out of the rig's
// own geometry. At the shipped 4.0 px this yields k = 0.73 / 2.01 / 1.95, so the
// rocks lane's cascade-1 near misses (four rows inside 11 mm of the old 56.25 mm
// wall) all clear a 112.9 mm budget, the smelter clears cascade 2 at 410.5 mm,
// and cascade 0 gets STRICTER than it was rather than looser. It is the k=2 win
// without the k=2 near field.
//
// WHY THE HEIGHT IS A REFERENCE AND NOT THE LIVE CANVAS. 900 px is the height
// every measurement on this project is taken at, and pinning it means the LOD
// ladder does not change when the window is resized or when a Quality tier moves
// `maxPixelRatio` between 1 and 2. A ladder that shifts on resize would pop
// shadows mid-frame and would make two lanes' numbers incomparable for a reason
// neither could see. The FOV is read live, because `CameraRig` has a setter and
// RN-641 already moved it once.

/** The height every measurement on this project is taken at. See above. */
export const REF_HEIGHT_PX = 900;

/** The nearest distance the game will let a player put a machine: `portcost.js`
 *  places its row at 2.2 to 4.2 m and refuses anything closer. Cascade 0 has no
 *  near split, so this is what stands in for one. */
export const NEAREST_CASTER_M = 2.2;

function num(name: string, fallback: number): number {
  const raw = new URLSearchParams(self.location.search).get(name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Screen pixels of silhouette error a cascade may be given, WHEN THIS POLICY IS
 * ASKED FOR. It is not the default and the measurement is why.
 *
 * RN-697 built the instrument Admin asked for: an interleaved A/B/A/B pair in
 * ONE page, restricted to the sensitivity mask (the pixels a saturated budget
 * moves), with the floor and the signal each averaged over three samples. It
 * had to be rewritten twice on the way, and both rewrites are recorded in
 * `probes/shadowk.js` because both were the same mistake: an absolute threshold
 * standing where a relative one belonged. The single-frame floor was the worse
 * one, reading 22.3, then 24.0, then 11.4 counts on three runs of the identical
 * probe, which moved every ratio built on it.
 *
 * THE ANSWER, AND IT IS NOT THE ONE ANYONE WANTED. Signal over floor at grazing
 * sun, sun dot 0.10, wind off, three samples a side:
 *
 *     Mountains 1.198     Forest 0.852     Plains 1.471
 *
 * At two of three sites the derived policy moves shadow-edge pixels MORE than
 * two consecutive frames at an unchanged budget move them. Admin's ruling was
 * "take it if you can show it with a sharper instrument, do not take it on the
 * 1.00x bound alone". The sharper instrument exists now and it does not clear
 * the bar, so the default stays at uniform one texel and this policy ships
 * behind `?shadowlodpx=4` for whoever takes the look decision.
 *
 * WHAT THE INSTRUMENT CANNOT SAY, stated because it bounds the conclusion: it
 * measures the MAGNITUDE of a change, not its direction. The derived policy is
 * looser than k=1 at cascades 1 and 2 and STRICTER at cascade 0, so some of the
 * pixels counted against it changed because a near-field substitution was
 * REMOVED. Telling an improvement from a degradation needs an eye, not a mean.
 */
export const SCREEN_PX_DEFAULT = 4.0;

/** `?shadowlodk=` forces a UNIFORM k on every cascade, which is what the old
 *  build did and is the negative control for this whole file. NaN when absent,
 *  so "not passed" is distinguishable from a passed 0 (`Number(null)` is 0). */
const RAW_K = new URLSearchParams(self.location.search).get('shadowlodk');
const FORCED_K = RAW_K === null ? NaN : Number(RAW_K);

/** Absent unless asked for, so "not passed" stays distinguishable from a passed
 *  value and the boot default is a fixture rather than an inference. */
const RAW_PX = new URLSearchParams(self.location.search).get('shadowlodpx');
const state = {
  px: RAW_PX === null ? NaN : num('shadowlodpx', SCREEN_PX_DEFAULT),
  // THE SHIPPED DEFAULT IS UNIFORM ONE TEXEL. `?shadowlodpx=4` opts into the
  // derived per-cascade policy; `?shadowlodk=` forces any uniform k. With
  // neither, this is exactly the rule RN-681 measured and committed.
  forcedK: Number.isFinite(FORCED_K) && FORCED_K > 0 ? FORCED_K
    : (RAW_PX === null ? 1 : NaN),
  fovDeg: 60,
};

/** `CameraRig` publishes the vertical FOV it is actually running. */
export function publishFov(fovDeg: number): void {
  if (fovDeg > 0) state.fovDeg = fovDeg;
}

/** Metres per screen pixel at distance `d`, at the reference height. */
export function pixelSizeAt(d: number): number {
  return (2 * d * Math.tan((state.fovDeg * Math.PI) / 360)) / REF_HEIGHT_PX;
}

/** Screen pixels one shadow texel of `texelM` covers at the cascade's near edge. */
export function pxPerTexel(texelM: number, nearM: number): number {
  const p = pixelSizeAt(Math.max(nearM, 0.01));
  return p > 0 ? texelM / p : 0;
}

/**
 * The world-metre deviation budget for one cascade.
 *
 * Returns `k * texel` so callers keep comparing a length with a length. A forced
 * uniform k short-circuits the whole derivation, which is what makes
 * `?shadowlodk=1` restore the previous behaviour exactly rather than
 * approximately.
 */
export function budgetFor(texelM: number, nearM: number): number {
  if (Number.isFinite(state.forcedK)) return texelM * state.forcedK;
  if (!Number.isFinite(state.px)) return texelM;
  const per = pxPerTexel(texelM, nearM);
  return per > 0 ? (state.px / per) * texelM : texelM;
}

/** The k this cascade is actually running, for the report and for a probe. */
export function kFor(texelM: number, nearM: number): number {
  if (texelM <= 0) return 0;
  return budgetFor(texelM, nearM) / texelM;
}

/**
 * RUNTIME, and this is the half that fixes the instrument rather than the look.
 *
 * `?shadowlodk` is read at module load, so a k=1 against k=2 pair costs two page
 * loads and cannot hold the camera, the streamed chunk set, the sun and the node
 * index equal. The rocks lane measured exactly that wall: two loads at the SAME
 * k moved 4.65% of pixels and k=1 against k=2 moved 4.66%, a signal-over-floor
 * of 1.00x, which licenses only "smaller than 4.65%" and cannot say anything
 * finer. Setting the budget in place lets a matched pair be two calls apart
 * inside one settled frame, which is the same move `Surfaces.setMaps` and
 * `setFoliageTone` already make and for the same stated reason.
 */
export function setBudget(next: { px?: number; k?: number | null }): void {
  if (next.px !== undefined && next.px > 0) { state.px = next.px; state.forcedK = NaN; }
  if (next.k !== undefined) {
    state.forcedK = next.k === null ? NaN : (next.k > 0 ? next.k : NaN);
    // `setBudget({k: null})` means "use the derived policy", so it needs a px to
    // derive from even when the page booted without one.
    if (next.k === null && !Number.isFinite(state.px)) state.px = SCREEN_PX_DEFAULT;
  }
}

export function budgetState(): { px: number | null; forcedK: number | null;
  fovDeg: number; refHeightPx: number; nearestCasterM: number;
  rawK: string | null; rawPx: string | null; policy: string } {
  return {
    px: Number.isFinite(state.px) ? state.px : null,
    forcedK: Number.isFinite(state.forcedK) ? state.forcedK : null,
    fovDeg: state.fovDeg,
    refHeightPx: REF_HEIGHT_PX,
    nearestCasterM: NEAREST_CASTER_M,
    rawK: RAW_K,
    rawPx: RAW_PX,
    policy: Number.isFinite(state.forcedK) ? 'uniform' : 'perCascade',
  };
}
