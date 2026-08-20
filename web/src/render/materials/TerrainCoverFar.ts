// THE FAR-FIELD COVER CONVERGENCE. RN-2195, fidelity lane A3 phase 1.5.
//
// THE GAP THIS CLOSES. A2's own file (GrassPalette.ts, "THE SEAM THIS FILE
// PUBLISHES TO A3") named the residual: the carpet fades out by about 90 m,
// and past 75 m -- clause C4's own albedo band, TerrainSplat.ts -- the near
// splat's chroma term (`ofSplatHue`) has already faded to nothing, so the
// ground reverts to the BARE BIOME PALETTE. On the meadow pose that palette
// is Plains' khaki 0x6d6a47, so the world went green at the feet and khaki at
// the horizon: a chroma step sitting exactly where the carpet hands off.
//
// THE MECHANISM. This is NOT a new palette and NOT a new per-biome table. It
// is the SAME rotation GrassPalette.coverAlbedo applies to every blade
// (constant-Rec.709-luminance, chroma-only, cannot move value), applied here
// to the terrain's OWN already-blended albedo instead of a CPU twin of it,
// and faded IN by exactly `1 - splatFadeA`: the near hue term's own fade
// curve, inverted. The two terms are complementary on ONE boundary
// (TerrainSplat.ts's SPLAT_FADE_ALBEDO, 35 to 75 m) rather than needing a
// second number, which is C4's own rule ("neither band is a new number")
// extended rather than broken.
//
// THE WEIGHT is `splatVeg * coverSel`, the SAME vegetation selector the
// splat's own grass/dirt split already computes (`clamp(vMatW.x * 3, 0, 1)`)
// times the SAME slope selector every other term in this material shares
// (`coverSel`). No new varying, no seventh per-biome table -- ofSplatW's own
// comment gives the reason: a per-biome table here would be "a second answer
// to a question BiomeMaterial has already answered". Gating by `coverSel` as
// well as `splatVeg` is what keeps a scree slope or a cliff face inside a
// vegetated biome from rotating green: Mountains' own veg (0.02) already
// carries most of that weight, but a rock outcrop inside Plains needs
// `coverSel` to carry the rest.
//
// THE ROTATION CONSTANTS ARE NOT RE-AUTHORED HERE. GLSL cannot import a
// TypeScript function, so the shader carries a closed-form copy of
// GrassPalette.coverAlbedo's own rotation body (r *= 1 - 0.45k, g *= 1 +
// 0.30k, b *= 1 - 0.15k, renormalised to the source luminance), and that copy
// is PROVEN identical rather than assumed: `assertFarCoverMatchesGrass`
// below calls the real, live `coverAlbedo` at module load and throws if this
// file's mirror disagrees by more than float rounding, on `assertHueLuminance`'s
// own precedent (TerrainSplat.ts: "there is no useful degraded mode where the
// world is quietly ... wrong inside 75 m and correct outside it").
//
// THE GREEN WEIGHT. `FAR_GREEN_BIOME` is `COVER[2].green` (Plains, "the
// meadow pose's own biome" by GrassPalette's own comment), imported LIVE
// rather than copied, so it cannot drift even if A2 retunes Plains' row. It is
// then scaled by the carpet's own population MEAN rather than its brightest
// blade: GrassPalette's `coverAlbedo` walks each blade's rotation back by
// `DRY_SPREAD * dry` (0.62, read from GrassPalette.ts's source; not exported,
// so it is a read and not an import) with `dry` drawn near-uniformly on [0,1)
// per instance (GrassSample.ts: `frac(hash32(seed, k * 8 + 5))`), so the
// carpet's own mean rotation strength is `green * (1 - 0.62 * 0.5)` =
// `green * 0.69`. Matching the FADING CARPET'S AVERAGE, not its greenest
// blade, is the right target for a rectangle that samples many blades and the
// ground beyond them in one box (`meadowfield`'s `rangeRects`): this is an
// approximation and is closed by the hero-frame proof, not by this arithmetic
// alone, exactly as GrassPalette's own green weights were tuned by capture
// rather than derived (see GrassPalette.ts's "THIRD CAPTURE" note).
//
// THE FADE. Faded in by `1 - splatFadeA` and by its own amplitude
// `uSplatFarAmp`, `?splatfar=0`'s whole-term isolator on `splatAmpFromQuery`'s
// pattern exactly (RN-150's dead-default guard applies here too).

import * as THREE from 'three';
import { COVER, coverAlbedo } from '../grass/GrassPalette.js';
import { COVER_VALUE } from '../grass/GrassTuning.js';

/** Re-exported so TerrainCoverFar.glsl.ts has one place to import this file's
 *  whole constant set from, rather than reaching into grass/ a second time. */
export { COVER_VALUE };

/** Mirrors GrassPalette.coverAlbedo's r *= 1 - 0.45k, g *= 1 + 0.30k,
 *  b *= 1 - 0.15k. Named so the GLSL #define is generated from the same three
 *  numbers rather than a second hand-typed triple, and cross-checked below. */
export const FAR_ROT_R = -0.45;
export const FAR_ROT_G = 0.30;
export const FAR_ROT_B = -0.15;

/** Plains' green weight, live from GrassPalette's own table (index 2, "the
 *  meadow pose's own biome") -- not a copy, so it cannot drift. */
export const FAR_GREEN_BIOME = COVER[2].green;

/** The carpet's population-mean discount against its brightest blade. See the
 *  header: DRY_SPREAD (0.62, read from GrassPalette.ts) times a mean dry of
 *  0.5 under GrassSample.ts's near-uniform per-instance draw. */
export const FAR_DRY_MEAN = 1 - 0.62 * 0.5;

/** The rotation strength this file's shader term uses at full weight
 *  (`splatVeg * coverSel == 1`). */
export const FAR_GREEN = FAR_GREEN_BIOME * FAR_DRY_MEAN;

/** The default amplitude, `SPLAT_A_VALUE`/`_CHROMA`/`_NORMAL`'s own pattern:
 *  1 is "as designed", `?splatfar=0` is the whole-term isolator. */
export const SPLAT_A_FAR = 1.0;

function luma709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The closed-form mirror of coverAlbedo's rotation body. Used ONLY to prove
 *  FAR_ROT_R/G/B and COVER_VALUE agree with the live function; the shader does
 *  this same arithmetic itself, per-fragment, on the terrain's own albedo. */
function mirrorRotate(substrate: THREE.Color, k: number, out: THREE.Color): THREE.Color {
  const r0 = substrate.r; const g0 = substrate.g; const b0 = substrate.b;
  const l0 = luma709(r0, g0, b0);
  const r = r0 * (1 + FAR_ROT_R * k);
  const g = g0 * (1 + FAR_ROT_G * k);
  const b = b0 * (1 + FAR_ROT_B * k);
  const l = luma709(r, g, b);
  const s = (l > 1e-6 ? l0 / l : 1) * COVER_VALUE;
  return out.setRGB(r * s, g * s, b * s);
}

/** THE CROSS-CHECK. Runs at module load and THROWS, on `assertHueLuminance`'s
 *  precedent: a silent drift between this file's baked GLSL constants and
 *  GrassPalette's own formula is exactly the seam this lane exists to close,
 *  so there is no degraded mode where it is wrong and quiet about it.
 *
 *  Compared at `dry = 0` (GrassPalette's own un-drifted anchor) against
 *  `mirrorRotate`'s `k = FAR_GREEN_BIOME` (the UNDISCOUNTED weight): the mean
 *  discount (`FAR_DRY_MEAN`) is this file's own tuning choice, not part of
 *  `coverAlbedo`'s contract, so the cross-check proves the ROTATION FORMULA
 *  agrees and does not fold a second file's assumption about dry's
 *  distribution into the thing being proved.
 *
 *  Skipped when `?grasstint` is set: that flag scales `coverAlbedo`'s
 *  rotation by a private, unexported constant (`TINT_AMP`) this file has no
 *  way to read, so a debug override of the carpet's own tint is a state this
 *  check cannot speak to either way. */
export function assertFarCoverMatchesGrass(): void {
  if (new URLSearchParams(self.location.search).get('grasstint') !== null) return;
  const PLAINS = 2;
  const samples: ReadonlyArray<[number, number, number]> = [
    [0.153, 0.144, 0.063],  // Plains substrate itself (GrassPalette.ts's own worked example)
    [0.30, 0.30, 0.30],     // a neutral grey, so the check is not one hue
    [0.05, 0.20, 0.05],     // already-greenish, so renormalisation is exercised
  ];
  const live = new THREE.Color();
  const mine = new THREE.Color();
  for (const [r, g, b] of samples) {
    const substrate = new THREE.Color(r, g, b);
    coverAlbedo(substrate, PLAINS, live, 0);
    mirrorRotate(substrate, FAR_GREEN_BIOME, mine);
    const d = Math.max(
      Math.abs(live.r - mine.r), Math.abs(live.g - mine.g), Math.abs(live.b - mine.b));
    if (d > 1e-5) {
      throw new Error(`[of] terrain cover-far: mirror disagrees with `
        + `GrassPalette.coverAlbedo by ${d} at (${r},${g},${b}). The baked `
        + "rotation constants have drifted from the carpet's own formula.");
    }
  }
}

assertFarCoverMatchesGrass();

/** Published for a probe, `splatDefault()`'s own shape: what this term is
 *  doing and the proof that it agrees with the carpet, without re-running the
 *  cross-check (which already ran, and threw, at module load if it disagreed). */
export function farCoverState(): {
  green: number; greenBiome: number; dryMean: number; rot: [number, number, number];
  value: number;
} {
  return {
    green: FAR_GREEN, greenBiome: FAR_GREEN_BIOME, dryMean: FAR_DRY_MEAN,
    rot: [FAR_ROT_R, FAR_ROT_G, FAR_ROT_B], value: COVER_VALUE,
  };
}
