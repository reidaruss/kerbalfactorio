// The reporting surface for `ShadowLod.ts`: everything a probe needs to AUDIT
// the rule rather than take it, which means the rule's INPUTS (each cascade's
// texel, its near distance, the screen footprint that follows, and the k that
// falls out) and not only its output. Split from `ShadowLod.ts` because that
// file crossed the 400-line cap when the k policy stopped being one number.

import { budgetFor, budgetState, kFor, pxPerTexel, setBudget } from './ShadowLodK.js';
import { measureStats } from './ShadowLodMeasure.js';
import { cascadesPublished, farSkipStats, laddersPublished, swapStats,
  frameSaving, tierFor,
  SHADOW_LOD_ON, SHADOW_LOD_RAW } from './ShadowLod.js';

export interface ShadowLodReport {
  /** The flag AS PARSED. `raw: null` with `on: true` is the boot default. */
  flag: { raw: string | null; on: boolean; bootDefault: boolean };
  /** RN-696: the k POLICY and its inputs, so a reader can re-derive every k
   *  below rather than take it. */
  budget: { px: number | null; forcedK: number | null; fovDeg: number;
    refHeightPx: number; nearestCasterM: number; rawK: string | null;
    rawPx: string | null; policy: string };
  cascades: { name: string; texelM: number; texelMM: number; nearM: number;
    farM: number; pxPerTexel: number; k: number; budgetMM: number }[];
  /** RN-2203. `batches` is how many carry the impostor skip, `registered` the
   *  same count from the other side, `passes` the cascade passes it ran in and
   *  `skipped` the casters it actually removed. Zero `skipped` with nonzero
   *  `batches` is a live skip with nothing at the impostor rung to remove. */
  farSkip: { batches: number; passes: number; skipped: number;
    registered: number; on: string[]; noImpostor: string[] };
  swaps: number;
  instances: number;
  /** Cumulative triangles the swap removed, and the cascade passes it ran in.
   *  `saved / passes * cascades` is the per-FRAME saving to check an A/B with. */
  savedTriangles: number;
  passes: number;
  batches: number;
  savedPerFrame: number;
  measure: { calls: number; ms: number };
  pools: {
    pool: string;
    rows: {
      label: string; tris: number[]; devMM: number[];
      /** Tier this ladder is admitted to at each published cascade, in the
       *  published order, at the shipped k and at k = 2 beside it. */
      tierPerCascade: number[]; tierPerCascadeK2: number[];
    }[];
  }[];
}

export function shadowLodReport(): ShadowLodReport {
  return {
    flag: { raw: SHADOW_LOD_RAW, on: SHADOW_LOD_ON, bootDefault: true },
    budget: budgetState(),
    cascades: cascadesPublished().map((p) => ({
      name: p.name, texelM: p.texelM,
      texelMM: Math.round(p.texelM * 1e5) / 100,
      nearM: p.nearM, farM: p.farM,
      pxPerTexel: Math.round(pxPerTexel(p.texelM, p.nearM) * 1000) / 1000,
      k: Math.round(kFor(p.texelM, p.nearM) * 1000) / 1000,
      budgetMM: Math.round(budgetFor(p.texelM, p.nearM) * 1e5) / 100,
    })),
    // RN-2203. The far-shadow skip, published with BOTH halves: how many
    // batches registered one and how many casters it has actually removed. A
    // registered skip that never fires is the vacuous green this project keeps
    // catching, and `skipped: 0` beside `batches: 21` says which of the two
    // failures it is (no impostor instances yet, versus no skip installed).
    farSkip: farSkipStats(),
    swaps: swapStats().swaps,
    instances: swapStats().instances,
    savedTriangles: swapStats().saved,
    passes: swapStats().passes,
    batches: swapStats().batches,
    // THE LAST FRAME, not a lifetime mean. Published so it can be checked
    // AGAINST an A/B rather than instead of one; if the two disagree, the
    // counter is the one to doubt and the frame is the one to believe.
    savedPerFrame: frameSaving(),
    measure: measureStats(),
    pools: laddersPublished().map((l) => ({
      pool: l.pool,
      rows: l.rows.map((r) => ({
        label: r.label, tris: [...r.tris],
        devMM: r.dev.map((d) => (Number.isFinite(d) ? Math.round(d * 1e5) / 100 : -1)),
        tierPerCascade: cascadesPublished().map((p) => tierFor(r.dev, p.texelM, p.nearM)),
        tierPerCascadeK2: cascadesPublished().map((p) => {
          const budget = p.texelM * 2;
          let t = 0;
          for (let i = 1; i < r.dev.length; ++i) if (r.dev[i] <= budget) t = i;
          return SHADOW_LOD_ON && p.texelM > 0 ? t : 0;
        }),
      })),
    })),
  };
}

(self as unknown as { __ofShadowLod: unknown }).__ofShadowLod = {
  report: shadowLodReport,
  // Not routed through `window.__of`: `Debug.ts` is at the 400-line cap and
  // belongs to another lane tonight. `Surfaces.ts` set this precedent and gave
  // the same reason; both are removable in one line.
  on: SHADOW_LOD_ON,
  /**
   * RN-696. Change the budget IN PLACE so a matched pair is two calls apart
   * inside one settled frame instead of two page loads apart. The rocks lane's
   * k=1 against k=2 pair could not beat its own two-load floor (4.66% moved
   * against a 4.65% floor, 1.00x) and this is the fix for that, not for the look.
   * `setBudget({k: null})` returns to the derived per-cascade policy.
   */
  setBudget: (next: { px?: number; k?: number | null }): unknown => {
    setBudget(next);
    return budgetState();
  },
};
