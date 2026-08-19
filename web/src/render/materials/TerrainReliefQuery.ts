// The RELIEF GEOMETRY controls, read off the query string: the slope's
// derivation and support, the two footprint-fade wavelengths, the ripple
// direction field's two scales and swing, and the body's horizon occlusion.
// Split out of TerrainMaterial.ts at RN-2050.
//
// These are not amplitudes and that is why they are not in TerrainAmpQuery.ts:
// several are hard 0-or-1 negative controls whose zero restores a KNOWN
// previous state, and the rest are strictly-positive scales where a bad value
// takes the boot default rather than being clamped into a state nothing
// documents.

import { REL_CELL, REL_CELL_NOISE, RELIEF_GRAD_UV, REL_SWING_DEFAULT }
  from './TerrainArt.glsl.js';

/**
 * RN-741. Whether the relief bump takes its slope over a fixed tile-space
 * support (1, shipped) or as a screen derivative of the sampled height (0, the
 * exact pre-RN-741 path).
 *
 * This is a NEGATIVE CONTROL rather than a taste knob, so it is a hard 0 or 1
 * and not an amplitude: the thing it restores is a defect, and an intermediate
 * value would be a blend of two derivations rather than either of them.
 */
export function reliefGradFromQuery(): number {
  return new URLSearchParams(self.location.search).get('reliefgrad') === '0' ? 0 : 1;
}

/**
 * RN-843. `?reliefgraduv=` overrides the support the relief slope is
 * differenced over, in TILE UNITS (one unit is one repeat of
 * `of_ground_relief`). A missing parameter is MISSING and takes the boot
 * default, never `Number(null) === 0`, which would ship the term with a zero
 * support and difference a texel against itself (NUMBERS.md, boot defaults).
 */
export function reliefGradUvFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefgraduv');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : RELIEF_GRAD_UV;
}

/**
 * RN-1855. `?artfinem=` and `?relieffinem=` override the two footprint fades'
 * wavelengths, in METRES. The shipped values are DERIVED (2.0664 and 0.2249 at
 * the shipped depth), and passing the pre-RN-1855 `4.2` and `0.45` is the
 * negative control that restores the shipped-for-a-fortnight picture exactly,
 * on one build, one camera and one streamed chunk set.
 *
 * Strictly positive, on reliefCellFromQuery's rule: zero would multiply the
 * smoothstep's two edges into each other and hand `ofArtBumpG` a fade that is
 * NaN or 1 depending on the driver, which is a state nothing documents. A bad
 * value takes the boot default rather than being clamped. A missing parameter
 * is MISSING and takes the boot default, never `Number(null) === 0` (RN-150,
 * and it is exactly this material that paid for that lesson).
 */
export function fineMFromQuery(key: string, boot: number): number {
  const v = new URLSearchParams(self.location.search).get(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : boot;
}

/**
 * RN-961. `?reliefswing=` is the ripple direction's peak-to-peak swing across
 * cells, in radians. `?reliefswing=0` collapses every cell's rotation to the
 * identity and restores the pre-RN-961 sample coordinate exactly, so it is the
 * negative control for the whole term on one build rather than two commits
 * apart. A missing parameter is MISSING and takes the boot default (NUMBERS.md,
 * boot defaults), never `Number(null) === 0`, which would ship the term off
 * while every filename claimed it was on.
 */
export function reliefSwingFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefswing');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : REL_SWING_DEFAULT;
}

/**
 * RN-1005. The direction field's two SCALES, on reliefSwingFromQuery's pattern.
 * `?reliefcell=` is the cell edge in tile units and `?reliefcellnoise=` is the
 * angle noise's frequency on the cell lattice. Both are strictly positive: zero
 * would divide by zero and a negative cell mirrors the lattice, so a bad value
 * takes the boot default rather than being clamped into a state nothing
 * documents.
 *
 * There is NO "off" value for either, and that is correct rather than an
 * oversight: the negative control for the whole mechanism is `?reliefswing=0`,
 * which collapses every rotation to the identity and makes both scales
 * unobservable. A second control over the same term would be two ways to
 * express one state, and the pair could disagree.
 */
export function reliefCellFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefcell');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : REL_CELL;
}
export function reliefCellNoiseFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefcellnoise');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : REL_CELL_NOISE;
}

/**
 * RN-842. `?horizonocc=` overrides the measured occlusion, and `?horizonocc=0`
 * is the EXACT negative control: at zero the shader's two ambient weights are
 * algebraically the pre-RN-842 expressions, so the control restores the old
 * behaviour rather than approximating it.
 *
 * Returns null when the parameter is ABSENT, which is what lets Boot tell "the
 * caller asked for zero" apart from "nobody asked". Parsing a missing flag as
 * `Number(null) === 0` is how a feature ships off with its own control
 * permanently engaged (NUMBERS.md, boot defaults).
 */
export function horizonOccFromQuery(): number | null {
  const v = new URLSearchParams(self.location.search).get('horizonocc');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(0.45, Math.max(0, n)) : null;
}
