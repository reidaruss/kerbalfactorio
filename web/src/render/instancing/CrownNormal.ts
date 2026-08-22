// The CROWN IMPOSTOR's shading normal, and nothing else.
//
// A sibling of `FoliageNormal.ts` rather than a branch inside it, on that
// file's own precedent and for a stronger reason: `bendNormals` is shared by
// `grass`, `leaf` AND `canopy`, RN-1766 bought +7.4 per cent of whole-frame
// `iqr` at `forestfloor` with it, and a crown fix that edited it in place could
// not be proved harmless to the understorey by construction. Scoped to its own
// file and its own predicate, the understorey's bytes are untouched by
// CONSTRUCTION and the proof is a pngdiff rather than an argument.

import * as THREE from 'three';

/**
 * RN-2590. THE CROWN IMPOSTOR IS NOT A TUFT, AND `bendNormals` DEGENERATES ON
 * IT IN TWO WAYS AT ONCE.
 *
 * WHAT THE SHIPPED BYTES ARE, read out of `props_canopy.glb` with a manual
 * glTF parse that shares no code with the render path (RN-2590's dump; the
 * same numbers a fresh-context verifier read for 2.38.1a). Every `OF_Canopy`
 * part is `_impostor()`'s two crossed quads: EIGHT vertices, FOUR triangles,
 * flat-shaded, `cx` and `cz` EXACTLY 0, `lo` exactly 0. Quad A lies in the
 * `z = 0` plane with normal `(0,0,1)`; quad B is the same quad yawed 90
 * degrees, so its plane is `x = 0` with normal `(1,0,0)` and its vertices
 * carry `x = +/-2.572e-16` (Broadleaf), `+/-1.179e-16` (Pine),
 * `+/-8.879e-17` (Fir) as the residue of `cos(pi/2)`.
 *
 * DEFECT 1, COPLANARITY. `bendNormals` anchors at the base centre, which for
 * a crossed quad centred on its own axis is `(0, lo, 0)` and lies ON both card
 * planes. `d = pos - base` is therefore IN the card's plane for every vertex
 * of that card, and at the shipped `amount = 1.0` the bent normal IS `d/|d|`:
 * entirely in-plane, so `N . V` goes to zero on a card viewed head-on. That is
 * the grazing limit, where the split-sum environment BRDF is largest, and it
 * is the geometric half of "the crown is 58 to 87 per cent specular"
 * (rendering.md 2.38.2). Any anchor ON THE AXIS has this property, including a
 * raised centroid, because a plane through the axis contains every direction
 * from every point of that axis. **The in-plane term cannot be fixed by moving
 * the anchor. It is fixed by mixing in the card's own normal, which is the one
 * direction the plane does not contain.**
 *
 * DEFECT 2, A SIGN TEAR, CAUSED BY DEFECT 1. `sgn = (n . d) < 0 ? -1 : 1` with
 * `n . d` exactly zero in exact arithmetic. Quad A's `n . d` is exactly `0.0`
 * (its `z` is exactly zero) and `0 < 0` is false, so quad A resolves `+1`
 * uniformly and does not tear. Quad B's is the residue above, and it ALTERNATES
 * SIGN around the quad. Measured on the shipped Broadleaf: v4 and v7 take
 * `sgn = -1`, v5 and v6 take `+1`, so `v7` -- a TOP corner -- is baked with
 * `up = -0.8944` while `v6` on the SAME top edge is baked `+0.8944`. Both of
 * quad B's triangles carry at least one inverted vertex and the second is lit
 * as if it faced the ground. Fir reads -0.9978 / +0.9978 and Pine
 * -0.9944 / +0.9944 at the same two vertices. **Live in shipping, and the
 * mechanism is a ternary resolving on float residue, so no epsilon fixes it:
 * only removing the tie does.**
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRUCTION, DERIVED
 * ---------------------------------------------------------------------------
 * WHAT NORMAL A CROWN IMPOSTOR SHOULD CARRY, and the answer is neither of the
 * two obvious ones.
 *
 *  (a) NOT the card's own normal. That is the `?foliagenormal=0` state: two
 *      vertical walls. A wall's irradiance goes as `cos(elevation)` where the
 *      clearing it is divided by goes as `sin(elevation)`, so the four-pose
 *      `rho` spread EXPLODES to 63.5x (2.38.1a, measured).
 *  (b) NOT the crown's own SURFACE normal either, which is the answer a
 *      spheroid derivation gives and it is wrong here. Fit a spheroid to the
 *      Fir impostor's own box (mean plan half-extent 1.275 m, height 16.5 m)
 *      and its implicit gradient `(rx/A^2, (y-yc)/B^2, rz/A^2)` is horizontal-
 *      DOMINATED everywhere off the pole, because `A << B`. A slender conifer's
 *      true surface normal really is nearly horizontal, and adopting it walks
 *      straight back into (a).
 *
 * WHAT THE IMPOSTOR IS A SAMPLE OF IS THE CANOPY LAYER, and that is the
 * quantity the guard's band is derived on: `rn2550guard`'s 0.18 to 0.75 is a
 * CLOSED-CANOPY reflectance against a clearing, i.e. a property of a rough
 * horizontal LAYER seen from above, not of one leaf mass seen from the side.
 * A layer's normal is `up`, rolled outward by the local convexity of the crown
 * that carries it. So:
 *
 *     dome(p) = normalize( (px - cx,  (py - lo) + q,  pz - cz) )
 *
 * with the anchor dropped `q` BELOW the crown base. `q = 0` is RN-1766 exactly:
 * the rim of the card takes `up = 0`, a purely horizontal normal, which is (a)'s
 * wall at the one place the crown is widest. `q -> infinity` is a flat plate,
 * `up = 1` everywhere, no roundness left. The anchor depth is the whole family
 * and it has exactly one free parameter.
 *
 * PARAMETERISE IT AS AN ANGLE, NOT AS A LENGTH, so one number serves three
 * species whose crowns differ by a factor of four in plan. Let `R` be the part's
 * own mean plan half-extent (`(ax + az)/2`, measured off the geometry, never
 * authored) and let `CROWN_FLANK_DEG` be the angle FROM UP that the shading
 * normal takes at the widest rim. Then
 *
 *     q = R / tan(CROWN_FLANK_DEG)
 *
 * and by construction the rim's up-component is `cos(CROWN_FLANK_DEG)` for
 * EVERY part, whatever its aspect. Fir gets `q = 0.736 m` at 60 degrees against
 * Broadleaf's `2.728 m`, which is the per-species adaptation the single angle
 * buys.
 *
 * THEN THE OUT-OF-PLANE TERM, which `dome` cannot supply at any `q`. Split the
 * dome direction into its POLAR angle (how far off vertical) and its AZIMUTH
 * (which way it faces in plan), and mix the card's authored normal `n` into the
 * AZIMUTH ONLY:
 *
 *     cosT = dome.y,  sinT = |dome.xz|           the dome's own polar split
 *     a    = normalize( dome.xz * (1 - c) + n.xz * c )
 *     crown(p) = ( a.x * sinT,  cosT,  a.z * sinT )
 *
 * so the DOME says how far off up and the CARD says which way that tilt faces.
 *
 * MIXING INTO THE AZIMUTH RATHER THAN INTO THE WHOLE VECTOR, and the difference
 * was measured before it was chosen. A straight `dome*(1-c) + n*c` also leaves
 * the plane, but `n` is HORIZONTAL on every impostor quad, so it dilutes the
 * up component while it does it: at `crownflank=25` the baked mean `|up|` fell
 * from 0.947 to 0.871 as `c` went 0 to 0.3, and that lost up-component is
 * exactly the term the whole derivation above is trying to buy. The azimuth mix
 * leaves `cosT` untouched by construction, so `c` costs nothing in the one
 * quantity that compresses the pose spread.
 *
 * AND AT `c = 1` THE CONSTRUCTION HAS NO FREE AZIMUTH LEFT, which is why the
 * shipped value is 1 rather than a tuned fraction. The plan radial then enters
 * ONLY through its magnitude, as `sinT`; the direction is the card's own
 * authored normal at every vertex. In one sentence: **the dome says how far off
 * vertical, the card says which way that tilt faces.** Nothing arbitrary is left
 * to choose, `minAzimuthOut` is 1.0 at every vertex (the coplanarity is gone
 * entirely rather than reduced), and the interior values are worse on the frame
 * as well as on the argument: at `crownflank=12`, `forestairnoon` `rho` reads
 * 0.0954 / 0.0943 / 0.0994 / 0.1075 / 0.1124 at `c` = 0 / 0.35 / 0.6 / 0.8 / 1.0,
 * a shallow MINIMUM at 0.35 where the two azimuths half cancel and a maximum at
 * the endpoint.
 *
 * `n` is used EXACTLY AS AUTHORED. No hemisphere ternary, no epsilon, no tie:
 * quad A's eight components are `(0,0,1)` and quad B's are `(1,0,0)`, constant
 * per quad because the impostor is flat-shaded, so the construction is
 * CONTINUOUS ACROSS EVERY TRIANGLE BY CONSTRUCTION and defect 2 cannot recur.
 * The arbitrary global sign of `n` costs nothing because `OF_Canopy` is
 * `doubleSided` in the glTF (`of_lib.DOUBLE_SIDED` carries `Canopy`) and three
 * negates the whole normal on a back face, so `c * n` points toward the VIEWER
 * on whichever side is visible. That is the property being bought: `c` raises
 * `N . V` on the visible face monotonically and can never lower it.
 *
 * `dome`'s sign is likewise fixed at `+1` unconditionally. Outward-and-up from
 * a point below the crown base is the correct hemisphere for a crown with no
 * case analysis, which is why RN-1766's sign term is absent here rather than
 * repaired: it exists because a TUFT's authored facet normals point two
 * arbitrary ways and flipping them cost 7.5 per cent of `iqr`. A crown impostor
 * has no authored facing worth preserving.
 *
 * ---------------------------------------------------------------------------
 * ONE BINARY, FOUR SWITCHES (RN-952: every term gets one)
 * ---------------------------------------------------------------------------
 *   `?crownnormal=0`   the crown takes `bendNormals` again, tear and all: the
 *                      EXACT pre-RN-2590 bytes and the negative control for
 *                      the whole lane.
 *   `?crownflank=<deg>` sweeps the anchor. `90` is `q = 0`, RN-1766's anchor
 *                      with the deterministic sign, so `crownflank=90` and
 *                      `crowncard=0` together isolate the SIGN FIX alone.
 *   `?crowncard=<0..1>` sweeps the out-of-plane mix. `0` restores the in-plane
 *                      degeneracy while keeping everything else, so it isolates
 *                      the COPLANARITY fix alone.
 *   `?foliagenormal=`  still the master gate, unchanged in meaning: `0` is the
 *                      authored glTF bytes for crowns and understorey alike.
 */
/**
 * THE RIM ANGLE, AND IT IS PINNED BY TWO MEASUREMENTS PULLING OPPOSITE WAYS
 * RATHER THAN BY A DERIVATION, which is stated plainly because pretending
 * otherwise is how a look constant acquires a fake pedigree.
 *
 * WHAT THE DERIVATION GIVES IS A DIRECTION, NOT A VALUE. "The impostor samples
 * the canopy LAYER" is the statement that its reflectance should not depend on
 * the pose, and that is measurable: the four-pose spread of `rho0`, the crown's
 * unshaded unspecular diffuse ratio. Measured on one build, one session, a
 * fresh process per arm (`rn2591ladder --rho0=1`):
 *
 *   pre-lane (`?crownnormal=0`)   8.41x   (0.3719 / 1.7814 / 0.4114 / 3.1268)
 *   `crownflank=42, card 0.35`    5.48x   (0.3573 / 1.2186 / 0.5010 / 1.9570)
 *   `crownflank=25, card 0.35`    3.75x   (0.4122 / 1.0374 / 0.5523 / 1.5444)
 *   `crownflank=12, card 0`       2.23x   (0.4578 / 0.7779 / 0.5857 / 1.0205)
 *
 * **MONOTONE, WITH NO KNEE.** The layer statement is satisfied better the
 * smaller the angle gets, and its limit is a flat plate. So it gives no value.
 *
 * WHAT DOES GIVE A VALUE IS THAT `rn2550guard`'s TWO CONSTRAINTS BRACKET IT
 * FROM OPPOSITE SIDES, which was not expected and is the reason this block is
 * this long.
 *
 *  - **FROM ABOVE, the `crowns` band at `forestairnoon`.** That pose's standing
 *    violation may be repaid and never deepened, so `rho` must stay at or above
 *    0.0992 - 0.005 = **0.0942**. At `crowncard=1` it reads 0.1124 / 0.1016 /
 *    0.0961 / 0.0938 / 0.0865 at 12 / 25 / 32 / 35 / 45 degrees, so **past
 *    about 33 degrees the crown is too dark and the guard fails.**
 *  - **FROM BELOW, the `box` RATCHET at `flyovernoon`.** Correcting the normal
 *    makes the crown BRIGHTER at a high sun, and `box` is a one-sided darkness
 *    ratchet with no upper derivation, so the same fix that moves that pose's
 *    `rho` from 0.2488 (just outside the CORE) to 0.2968 (inside it) also
 *    raises `boxShip`. Measured on one build: **0.9403 at 12 degrees, over the
 *    0.9343 + 0.005 ceiling and a HARD FAIL**, against 0.9377 at 25 and 0.9361
 *    at 32. **Below about 22 degrees the crown is too bright and the guard
 *    fails.** The two constraints disagree about the same change at the same
 *    pose, which is filed as its own finding in rendering.md 2.39.7.
 *
 * **25 degrees is inside that bracket with the largest usable margin on the
 * binding side and a repayment rather than a deepening on the other**: `rho`
 * 0.1016 at `forestairnoon`, 0.0074 clear of the floor and 0.0024 ABOVE the
 * recorded violation, with `flyovernoon` `boxShip` 0.0016 and `boxSurf` 0.0018
 * clear of their ceilings on an instrument this lane's own control reproduced
 * to four decimals exactly. The roundness given up at the small end is
 * published rather than argued: `RN2590_crowns_round45_3x.png` is the
 * 45-degree crop, which the band refuses.
 */
export const CROWN_FLANK_DEG = 25;
/**
 * ONE, AND IT IS AN ENDPOINT RATHER THAN A TUNING. See the header's own
 * paragraph: at `c = 1` the azimuth is the card's authored normal at every
 * vertex, nothing arbitrary is left to choose, the coplanarity is gone entirely
 * (`minAzimuthOut` 1.0 rather than reduced), and the interior values measure
 * WORSE on the frame as well (a shallow minimum at 0.35).
 */
export const CROWN_CARD_MIX = 1.0;

const num = (key: string, def: number, lo: number, hi: number): number => {
  const raw = new URLSearchParams(self.location.search).get(key);
  if (raw === null) return def;
  const v = Number(raw);
  // RN-150's dead-default guard. `Number(null)` is 0 and `Number('')` is 0, and
  // 0 is a MEANINGFUL setting for both of these, so an unparseable or
  // out-of-range ask returns the SHIPPED value rather than a silent clamp: a
  // clamped ask reports the clamp and the table then describes the clamp as the
  // request, which is RN-2268's scar.
  return Number.isFinite(v) && v >= lo && v <= hi ? v : def;
};

/** The live crown-normal settings, one read, so a report cannot drift. */
export function crownBend(): {
  on: boolean; flankDeg: number; cardMix: number;
} {
  const raw = new URLSearchParams(self.location.search).get('crownnormal');
  return {
    on: raw === null ? true : raw !== '0',
    flankDeg: num('crownflank', CROWN_FLANK_DEG, 0.5, 90),
    cardMix: num('crowncard', CROWN_CARD_MIX, 0, 1),
  };
}

/**
 * `OF_Canopy` AND NOTHING ELSE, and the predicate is a material name rather
 * than a geometry test on purpose.
 *
 * A shape test ("is this two coplanar-with-the-axis quads") was the other
 * candidate and it is worse here in the way NUMBERS' "a sentence in a comment
 * is not an invariant" warns about: it would silently start and stop applying
 * as assets change, and the day a harvest tree's LOD2 impostor picks up the
 * same shape it would take a canopy-layer normal it is not a canopy layer of.
 * `OF_Canopy` is authored at `_LOD3` ALONE (RN-2247) and is the far crown card,
 * which is exactly the subject; the name is the scope. Same reasoning, and the
 * same `startsWith`, as `ScatterLook.isFoliageMaterial`'s own `OF_Canopy` arm.
 */
export function isCrownImpostorMaterial(name: string): boolean {
  return name.startsWith('OF_Canopy');
}

// THE BAKE'S OWN READBACK, and it is here because a registration-time rewrite
// has no uniform for a probe to read. RN-2268's scar is that a flag which never
// reaches the shader reports the default and every arm then measures the same
// picture; the remedy for a CPU-side bake is to publish what it actually wrote.
// `downVerts` is the tear's own signature and is 3 of 24 on the pre-lane path.
//
// TWO OUT-OF-PLANE MEASURES, NOT ONE, and the second exists because the first
// answers a question that is only half the defect. `minAbsOutOfPlane` is the
// baked normal projected onto its card's plane normal: it is the literal
// coplanarity reading and it is 0.0000 at all 24 vertices on the pre-lane path.
// But a normal pointing STRAIGHT UP is also in that plane (the card plane
// contains the vertical axis), so raising `meanUp` drives this measure toward
// zero while genuinely fixing the aerial `N . V`, and reading it alone would
// call the anchor fix a regression. `minAzimuthOut` therefore measures the same
// projection on the HORIZONTAL part of the normal alone, which is the azimuth
// spread `crowncard` buys and is independent of how far off vertical the dome
// put the vertex. Both are published; a reader needs both.
const report = {
  parts: 0, verts: 0, meanUp: 0, minAbsOutOfPlane: 1, minAzimuthOut: 1,
  downVerts: 0, path: 'none',
};
let accUp = 0;

/**
 * What the crown bake actually wrote, for `treeline().crownNormal`.
 *
 * IT ACCUMULATES AND IS NEVER RESET, so `parts` is the divisor a reader needs:
 * three on a boot that registers `props_canopy` once, six if something ever
 * registers it twice. `meanUp` and `minAbsOutOfPlane` are means and minima over
 * whatever was registered, so they survive that; `downVerts` is a COUNT and
 * would double, which is why `parts` is published beside it rather than left
 * implicit (NUMBERS: "a rounded FRACTION cannot represent a rare event;
 * publish the COUNT beside it").
 */
export function crownBakeReport(): typeof report { return report; }

export function crownNormals(g: THREE.BufferGeometry, amount: number): void {
  // `?foliagenormal=0` must be the authored glTF bytes EXACTLY, not a blend
  // that lands on them: RN-1766's control is quoted as "the exact pre-change
  // bytes" and a round trip through a normalize would only be exact to float.
  // Same early return, same reason, as `bendNormals`.
  if (amount <= 0) return;
  const q = crownBend();
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
  // R, THE MEAN PLAN HALF-EXTENT, measured off this part's own vertices. For a
  // crossed quad every vertex of quad A sits at |r| = ax and every vertex of
  // quad B at |r| = az, so this mean IS (ax + az)/2 exactly, which is the
  // quantity the derivation above names. It is a mean rather than a max because
  // the two quads have different reach (the Broadleaf is 4.20 by 5.25) and the
  // anchor is one point for the whole part.
  let rSum = 0;
  for (let i = 0; i < n; ++i) {
    rSum += Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz);
  }
  const R = rSum / n;
  // A part with no plan extent has no rim, so it has no flank angle to honour
  // and the anchor stays at the base. Guarded rather than assumed: a degenerate
  // part would otherwise divide the whole crown family by zero.
  const depth = R > 1e-6 ? R / Math.tan(q.flankDeg * Math.PI / 180) : 0;
  const c = q.cardMix;
  for (let i = 0; i < n; ++i) {
    const nx = nrm.getX(i); const ny = nrm.getY(i); const nz = nrm.getZ(i);
    const dx = pos.getX(i) - cx;
    const dy = pos.getY(i) - lo + depth;
    const dz = pos.getZ(i) - cz;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Only reachable at `depth = 0` for a vertex exactly on the base centre,
    // which no impostor vertex is; it keeps its authored normal rather than
    // taking a NaN, exactly as `bendNormals` does.
    if (dl < 1e-6) continue;
    // NO SIGN TERNARY. See the header: the outward-and-up hemisphere is the
    // only one a crown has, and the tie that produced the tear is not resolved
    // here, it is absent.
    //
    // THE POLAR/AZIMUTH SPLIT. `cosT` is the dome's whole vertical answer and
    // is written straight through, so `crowncard` cannot spend it.
    const cosT = dy / dl;
    const dxz = Math.hypot(dx, dz);
    const sinT = dxz / dl;
    let ax = dxz > 1e-9 ? dx / dxz : 0;
    let az = dxz > 1e-9 ? dz / dxz : 0;
    // The card's own normal, HORIZONTAL PART ONLY. Every impostor quad is an
    // exactly vertical plane so its authored normal is already horizontal and
    // this is the identity; the projection is here so a part whose authored
    // normal is NOT horizontal degrades to the pure dome rather than tilting
    // the polar angle it must not touch.
    const cl = Math.hypot(nx, nz);
    if (cl > 1e-9 && dxz > 1e-9) {
      const mx = ax * (1 - c) + (nx / cl) * c;
      const mz = az * (1 - c) + (nz / cl) * c;
      const ml = Math.hypot(mx, mz);
      // `ml` can only vanish if the card normal is exactly ANTI-parallel to the
      // radial at c = 0.5, which cannot happen on a plane that contains the
      // radial; guarded anyway rather than trusted.
      if (ml > 1e-9) { ax = mx / ml; az = mz / ml; }
    }
    const kx = ax * sinT;
    const ky = cosT;
    const kz = az * sinT;
    // The master gate, and it is the same blend `bendNormals` uses so
    // `?foliagenormal=0` is the authored bytes for crowns and understorey by
    // one rule rather than two.
    const bx = nx * (1 - amount) + kx * amount;
    const by = ny * (1 - amount) + ky * amount;
    const bz = nz * (1 - amount) + kz * amount;
    const bl = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bl < 1e-6) continue;
    nrm.setXYZ(i, bx / bl, by / bl, bz / bl);
  }
}

/**
 * Fold one baked crown part into the readback. Called by BOTH paths from
 * `PropGeometry.normalize`, so the control arm reports its own numbers rather
 * than nothing, which is what makes `?crownnormal=0` provably the control
 * instead of provably silent.
 */
export function accumulateCrownBake(g: THREE.BufferGeometry, path: string): void {
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = nrm.count;
  let cx = 0; let cz = 0;
  for (let i = 0; i < n; ++i) { cx += pos.getX(i); cz += pos.getZ(i); }
  cx /= n; cz /= n;
  for (let i = 0; i < n; ++i) {
    const y = nrm.getY(i);
    accUp += Math.abs(y);
    if (y < -1e-4) report.downVerts += 1;
    // THE COPLANARITY MEASURE ITSELF. The card's plane contains the axis and
    // the vertical, so its normal is the horizontal direction PERPENDICULAR to
    // the vertex's own plan radial. Projecting the baked normal onto it is
    // exactly "how far did this normal leave its card's plane", and it reads
    // 0.0000 on the pre-lane path at every one of the 24 vertices.
    const rx = pos.getX(i) - cx; const rz = pos.getZ(i) - cz;
    const rl = Math.hypot(rx, rz);
    if (rl > 1e-6) {
      const ox = -rz / rl; const oz = rx / rl;
      const nxv = nrm.getX(i); const nzv = nrm.getZ(i);
      const a = Math.abs(nxv * ox + nzv * oz);
      if (a < report.minAbsOutOfPlane) report.minAbsOutOfPlane = a;
      // THE AZIMUTH-ONLY MEASURE. Same projection, but on the normal's
      // horizontal part alone, so a vertex the dome has pointed nearly straight
      // up does not report as "in-plane" for a reason that has nothing to do
      // with the azimuth mix. See the report block's own note.
      const hl = Math.hypot(nxv, nzv);
      if (hl > 1e-6) {
        const b = Math.abs((nxv / hl) * ox + (nzv / hl) * oz);
        if (b < report.minAzimuthOut) report.minAzimuthOut = b;
      }
    }
  }
  report.parts += 1;
  report.verts += n;
  report.meanUp = accUp / report.verts;
  report.path = path;
}
