// The understorey's shading normal, and nothing else.
//
// Split out of `PropGeometry.ts` at the 400-line cap, on that file's own
// precedent and for its own stated reason: everything here is a pure function
// of one BufferGeometry's normal attribute, and keeping it apart means a look
// change to foliage shading cannot move the base-contact gradient's bytes or
// the batch-normalisation contract beside it.

import * as THREE from 'three';

/**
 * RN-1766. THE UNDERSTOREY'S NORMALS, BENT OUTWARD FROM THE TUFT'S OWN BASE.
 *
 * MEASURED FIRST, on the shipped bytes rather than by eye. A blade of ground
 * cover is a flat facet standing on edge, and the facet normal that follows
 * from it points SIDEWAYS: over `detail_cards.glb`'s seven LOD0s the
 * area-weighted |up| of the normal reads 0.291 to 0.499 on the five plant
 * cards (`Detail_GrassCardC` 0.291, `B` 0.297, `A` 0.349, `FlowerSprig`
 * 0.367, `BroadleafForb` 0.443, `SedgeRosette` 0.499), against 0.723 on the
 * conifer's own crown blades and 0.858 on the pebble scatter. So a tuft is
 * lit as a handful of independent vertical sheets: whichever facets happen to
 * face the sun come out at one bright value, the rest at one dark value, and
 * nothing shades ACROSS a blade or ACROSS the clump. That is the mechanism
 * behind the audit's R2 "paper stuck in mud", and it is not a resolution
 * problem: A5 already took these cards to 1024 px.
 *
 * WHAT THIS DOES. Each vertex's normal is blended toward the direction from
 * the part's own base centre to that vertex, which is the standard spherified
 * or "capsule" foliage normal. The clump then shades as one rounded mass:
 * normals on the sun side turn toward the sun, normals on the far side turn
 * away, and the value runs continuously from base to tip instead of stepping
 * per facet. It costs NO triangles, NO draw calls, NO VRAM and no texture:
 * the normal attribute is already resident and is rewritten in place at
 * registration.
 *
 * THE BASE, NOT THE CENTROID, and the difference matters. From the centroid
 * the lower half of every blade bends DOWNWARD and the tuft's skirt goes
 * black. From a centre at the part's own minimum Y the direction is outward
 * and upward everywhere, which is also what a real clump does.
 *
 * DOUBLE-SIDED IS WHY THIS READS AS VOLUME RATHER THAN AS A TILT. Every
 * OF_Grass and OF_Leaf* role is in `of_lib.DOUBLE_SIDED`, and three flips the
 * normal on a back face, so the outward-facing side of a blade takes the bent
 * normal and the inward-facing side takes its negation. The inside of the
 * clump therefore goes dark while the outside catches the sky, which is the
 * self-shadowing a 3-triangle blade can never cast.
 *
 * THE FIRST VERSION WAS MEASURED FALSE AND THE FAILURE IS WHY THE SIGN TERM
 * BELOW EXISTS. Bending toward the RAW outward direction reverses whichever
 * half of a tuft's area happened to be authored facing inward, so it turns
 * that half away from the sun and the sky. Measured on `forestfloor`, real
 * D3D11, against `?foliagenormal=0` in the same binary: at 0.55 the whole
 * frame lost **7.5% of `iqr` (27.84 -> 24.05) and 6.3% of luma (30.24 ->
 * 25.19)** and pushed `loFrac` 0.589 -> 0.660, i.e. it made a frame the audit
 * already ranks R1 for being flat and dark, flatter and darker. 31.51% of
 * pixels moved against a 3.78% two-page-load floor, so the effect was real
 * and the SIGN was wrong. Taking the outward direction in the authored
 * normal's OWN hemisphere fixes it: same construction, same cost, and every
 * instrument reverses.
 *
 * WHAT IT MEASURES AT THE SHIPPED 1.0, `forestfloor` at the §2.1 pose, one
 * binary, `?foliagenormal=0` as the control, and the ground box as the
 * negative control that must NOT move:
 *
 *   understorey near   luma 38.26 -> 40.83   iqr 27.98 -> 30.41  (+8.7%)
 *   understorey mid    luma 29.81 -> 30.25   iqr 19.77 -> 20.00
 *   understorey left   luma 25.94 -> 26.74   iqr 25.91 -> 27.41  (+5.8%)
 *   whole frame        luma 30.24 -> 32.83   iqr 27.84 -> 29.90  (+7.4%)
 *                      loFrac 0.589 -> 0.559
 *   §2.1 ground box    luma 28.22 -> 28.01   iqr 19.77 -> 19.63  (unmoved)
 *
 * Monotone across 0 / 0.55 / 1.0 on all four rectangles, and 1.0 is the exact
 * spherified normal rather than a knob turned to its stop. Reproduced to 0.02
 * counts of luma on a second page load, at IDENTICAL triangles (1,429,028),
 * draw calls (72), programs (56) and VRAM (104.2 MB).
 *
 * ONE BINARY, ONE FLAG. `?foliagenormal=<0..1>` overrides the shipped amount
 * and `?foliagenormal=0` is the exact pre-change bytes, so the A/B is one
 * query parameter and not two builds.
 */
const DEFAULT_BEND = 1.0;
const FOLIAGE_BEND = (() => {
  const raw = new URLSearchParams(self.location.search).get('foliagenormal');
  const v = raw === null ? DEFAULT_BEND : Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_BEND;
})();

export function foliageBend(): { amount: number; raw: string | null } {
  return { amount: FOLIAGE_BEND,
    raw: new URLSearchParams(self.location.search).get('foliagenormal') };
}

export function bendNormals(g: THREE.BufferGeometry, amount: number): void {
  if (amount <= 0) return;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  let cx = 0; let cz = 0; let lo = Infinity;
  for (let i = 0; i < n; ++i) {
    cx += pos.getX(i); cz += pos.getZ(i);
    const y = pos.getY(i);
    if (y < lo) lo = y;
  }
  cx /= n; cz /= n;
  for (let i = 0; i < n; ++i) {
    const dx = pos.getX(i) - cx;
    const dy = pos.getY(i) - lo;
    const dz = pos.getZ(i) - cz;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // A vertex sitting exactly on the base centre has no outward direction,
    // so it keeps the one it was authored with rather than taking a NaN.
    if (dl < 1e-6) continue;
    const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
    // HEMISPHERE-CONSISTENT, and the naive version is why. A blade's authored
    // facet normal points one of two arbitrary ways, so bending toward a raw
    // outward direction turns half of every tuft's area AWAY from wherever it
    // was facing. Measured: the frame lost 7.5% of `iqr` and 6.3% of luma.
    // Taking whichever of +d / -d the facet is already on rotates it toward
    // the clump's roundness WITHOUT reversing it, so the gradient arrives and
    // the mean does not move.
    const sgn = (nx * dx + ny * dy + nz * dz) < 0 ? -1 : 1;
    const bx = nx * (1 - amount) + (sgn * dx / dl) * amount;
    const by = ny * (1 - amount) + (sgn * dy / dl) * amount;
    const bz = nz * (1 - amount) + (sgn * dz / dl) * amount;
    const bl = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bl < 1e-6) continue;
    nrm.setXYZ(i, bx / bl, by / bl, bz / bl);
  }
  nrm.needsUpdate = true;
}

