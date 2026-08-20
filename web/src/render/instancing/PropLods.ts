// THE PROP LOD LADDER: how many rungs a scatter prop may author, how a .glb's
// mesh names are grouped into them, and which rung a requested tier resolves to.
//
// ============================ THE DEFECT (RN-2200) ==========================
//
// `PropLibrary.register` used to hold TWO named slots per (stem, material):
//
//     const slot = perMat.get(mat) ?? { lod0: null, lod2: null };
//     if (hit[2] === '0') slot.lod0 = m; else slot.lod2 = m;
//
// The `else` is the whole bug. It is not "LOD2 goes in the far slot", it is
// "EVERY tier that is not 0 goes in the far slot", so the far slot is decided
// by whichever mesh `Object3D.traverse` happens to reach LAST. Today every prop
// atlas ships exactly `_LOD0` and `_LOD2` (contracts.json `lod_nodes`), so the
// defect is dormant and nothing has ever mis-drawn.
//
// It stops being dormant the moment an atlas ships a third rung. A `_LOD3`
// impostor card authored beside its `_LOD2` cone would silently BECOME the
// LOD2: the four-triangle card would be what every tree between 45 m and the
// far ring draws, and the cone it was supposed to hand over to would be dead
// bytes. That is worse than the missing feature, which is why the fix lands
// first and on its own: the far tier's asset work is invisible-to-harmful
// without it.
//
// WHY AN ARRAY AND NOT A THIRD NAMED SLOT. A third name has the same shape as
// the second and fails the same way at the fourth rung. `NodeBatch` already
// keys its node geometry by tier index (`NodePart.geom[variant][lod]`) and
// already walks DOWN to the finest tier an asset actually ships; this is that
// rule, for the scatter side, in the one place both can be read together.

/**
 * Rungs a scatter prop may author: `_LOD0` .. `_LOD3`.
 *
 * FOUR, not three, and the fourth is the impostor rung the world audit found
 * missing (188,081 triangles at 1,200 m, zero trees in any aerial frame). A
 * tier past this is IGNORED rather than folded into the last slot, which is
 * exactly the failure above; `tierOfName` returns null for it and `register`
 * skips it, so a mis-authored `_LOD9` is absent and visible rather than
 * present and wrong.
 */
export const PROP_LODS = 4;

/**
 * `<stem>_LOD<n>`, with the optional `_<k>` suffix glTF appends when two nodes
 * in one file end up with the same name. Kept identical to the expression
 * `PropLibrary.register` carried, so no asset's grouping moves.
 */
const LOD_NAME = /^(.*)_LOD(\d)(?:_\d+)?$/;

/** One primitive of one prop: which batch it lives in, and its rungs. */
export interface PropPart {
  readonly material: string;
  /**
   * Geometry id per LOD tier, `-1` where this asset ships no such tier.
   * Length is always `PROP_LODS`, so an index is never out of range and a
   * missing rung is a value rather than an absence.
   */
  readonly lods: readonly number[];
}

/**
 * The geometry id for `part` at `tier`, FALLING BACK TOWARDS LOD0.
 *
 * The same rule as `NodeBatch.geomAt` and `ShadowLod.idAt`, and for the same
 * reason: an asset with no far tier must behave exactly as it did before this
 * ladder existed, not vanish. Every prop atlas today ships 0 and 2 only, so
 * `geomAtTier(part, 3)` resolves to the LOD2 cone until a LOD3 is authored,
 * and `geomAtTier(part, 1)` resolves to LOD0. Both are the pre-RN-2200
 * behaviour, by construction.
 */
export function geomAtTier(part: PropPart, tier: number): number {
  for (let t = Math.min(tier, part.lods.length - 1); t >= 0; --t) {
    const id = part.lods[t];
    if (id >= 0) return id;
  }
  return -1;
}

/** A fresh ladder with every rung absent. */
export function emptyLods(): number[] {
  return new Array<number>(PROP_LODS).fill(-1);
}

/** `Foo_LOD2` -> `{ stem: 'Foo', tier: 2 }`; null for anything else, including
 *  a tier this ladder has no rung for. */
export function tierOfName(name: string): { stem: string; tier: number } | null {
  const hit = LOD_NAME.exec(name);
  if (hit === null) return null;
  const tier = Number(hit[2]);
  if (!(tier >= 0) || tier >= PROP_LODS) return null;
  return { stem: hit[1], tier };
}

/** The minimum a grouped primitive has to answer, so the grouping can be
 *  exercised without a GL context or a real glTF (see `--selftest`). */
export interface NamedPrimitive {
  readonly name: string;
  readonly materialName: string;
}

/**
 * Group a file's primitives into `stem -> material -> rung`.
 *
 * TWO primitives claiming the same (stem, material, tier) is the one case with
 * no right answer, and it keeps the old last-writer-wins because that is what
 * glTF's own `_1` name suffix already means: two nodes with the same name are
 * the same thing exported twice. What no longer happens is two DIFFERENT tiers
 * fighting over one slot.
 */
export function groupTiers<T extends NamedPrimitive>(
  prims: Iterable<T>,
): Map<string, Map<string, (T | null)[]>> {
  const byStem = new Map<string, Map<string, (T | null)[]>>();
  for (const prim of prims) {
    const at = tierOfName(prim.name);
    if (at === null) continue;
    const perMat = byStem.get(at.stem) ?? new Map<string, (T | null)[]>();
    byStem.set(at.stem, perMat);
    const rungs = perMat.get(prim.materialName)
      ?? new Array<T | null>(PROP_LODS).fill(null);
    rungs[at.tier] = prim;
    perMat.set(prim.materialName, rungs);
  }
  return byStem;
}

/** The finest rung at or below `tier` that this group actually holds, or null.
 *  `groupTiers`'s answer to the same question `geomAtTier` answers for ids. */
export function meshAtTier<T>(rungs: readonly (T | null)[], tier: number): T | null {
  for (let t = Math.min(tier, rungs.length - 1); t >= 0; --t) {
    const m = rungs[t];
    if (m !== null && m !== undefined) return m;
  }
  return null;
}
