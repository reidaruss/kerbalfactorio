// RN-2635 (lane N14, THE DRY SEA IS A CHROMA BOUNDARY). THE BIOME-ID PAINT
// ARM, and it exists to satisfy the R5 verifier's binding rule before a
// single palette hex is touched: R4's rank 1 died of an unproven rectangle,
// so this lane proves the subject first.
//
// WHY A NEW, INDEPENDENT PALETTE AND NOT `vBiomeColor`. `vBiomeColor` reads
// `uBiomeColor[bi]`, which is `BiomePalette.ts`'s own authored HEX table --
// exactly the thing under suspicion. Painting the classifier THROUGH the
// suspect table would prove nothing: a wrong palette row would produce a
// wrong-looking paint too, and the two failures cannot be told apart. So
// this file carries its OWN fixed, maximally-saturated debug palette, keyed
// on the same `/core` Biome enum index the vertex shader already decodes
// into `bi` (TerrainVertex.glsl.ts), and reads NOTHING from BiomePalette.ts.
//
// WHY IT OVERRIDES `lit` AT THE END AND NOT EARLIER. The dry-sea defect is
// read at 1,200 m, where RN-2540 measured the additive airlight term at
// ~92 per cent of the pixel. A paint spliced in before aerial perspective
// would be washed nearly monochrome by that floor at exactly the range this
// lane has to look at, which defeats the point of an identification arm.
// So the override sits AFTER both aerial-perspective calls in
// `TerrainFragLight.glsl.ts`, replacing `lit` outright rather than mixing a
// small term into it: the debug colour is the WHOLE fragment, immune to
// range, sun angle and shadow, which is what makes a single screenshot
// enough to classify every pixel in it.
//
//   ?biomeid=1   the terrain renders ONLY the debug classifier colour
//
// 0 (absent or `biomeid=0`) is the shipped frame EXACTLY: the GLSL branch
// does not execute and `lit` is untouched, so this arm cannot move a single
// committed rectangle when unused (verified in this lane's guard pass).
//
// RN-150-safe: a missing parameter is missing, never `Number(null) === 0`.
//
// A FAILURE MODE THIS ARM HAS AND A READER MUST KNOW, found by the R5
// verifier reviewing this lane's own "thin Plains sliver" claim (2026-08-22).
// `vBiomeIdx` (TerrainVertex.glsl.ts) is an INTERPOLATED varying, exactly
// like `vBiomeColor` beside it, and this file decodes it with `int(v+0.5)`
// in the fragment. Interpolating between two ADJACENT indices (e.g. Ocean=0
// to Beach=1) only ever passes through [0,1], which rounds to 0 or 1 and
// never fabricates a third class. But interpolating between two indices that
// are NOT adjacent (e.g. Beach=1 directly to Forest=3, with no Plains=2
// vertex nearby) sweeps continuously through the WHOLE intervening range, and
// at v in [1.5, 2.5) that rounds to 2 -- Plains -- with no Plains geometry
// anywhere near it. **Every direct Beach/Forest interface therefore paints a
// fake mid-index band, by construction, and no Ocean/Beach interface does**,
// because Ocean and Beach are adjacent indices and Beach and Forest are not.
// A band read off this arm at a class boundary is UNPROVEN until it is cross-
// checked against a non-interpolated source (the shipped `vBiomeColor`
// hue, a `?biomescale=`-style discrete readback, or simply narrowing the
// window until the reading is flat rather than mid-transition); this arm is
// reliable in the INTERIOR of a class and not at its edge.

import type * as THREE from 'three';
import { aerialDiagAmp } from './AerialDiag.js';

/**
 * `?biomeid=1`. Bound into the terrain program only; the far-treeline paint
 * and every prop/canopy card are UNCHANGED by this flag; the whole reading is
 * "what does the TERRAIN classifier say this fragment is", which is exactly
 * rank 3's question (a terrain-palette defect, not a canopy one).
 */
export const uBiomeIdPaint: THREE.IUniform<number> =
  { value: aerialDiagAmp('biomeid', 0) };

/**
 * The probe surface (AerialDiag.ts's own precedent, RN-2268's scar): a flag
 * that never reached a uniform reports the default and describes it as the
 * request, so the ACTUAL bound value is published here rather than trusted
 * from the typed URL.
 */
export function biomeIdPaintState(): { active: number; flag: boolean } {
  const q = new URLSearchParams(self.location.search);
  return { active: uBiomeIdPaint.value, flag: q.get('biomeid') !== null };
}

(window as unknown as { __ofBiomeIdPaint: unknown }).__ofBiomeIdPaint = {
  report: biomeIdPaintState,
};
