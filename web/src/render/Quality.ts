// Quality tier -> concrete knobs. One table, no scattered `if (tier === ...)`.

import type { QualityTier } from '../app/Config.js';

export interface QualityKnobs {
  readonly tier: QualityTier;
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadowMapSize: number;
  /**
   * RN-1420. `THREE.VSMShadowMap` rather than `PCFShadowMap`. **DEFAULT FALSE
   * ON EVERY TIER, AND THAT IS A PRICE AND NOT AN OVERSIGHT.**
   *
   * The intent was `PCFSoftShadowMap`: cascade 0 is 15.47 mm per shadow texel
   * over 0 to 22 m (§2.1.5) with a ONE-TEXEL PCF kernel, so every contact edge
   * in a walking frame is a hard 15 mm step, which is the largest "reads like a
   * render" tell in a ground-level frame. three r185 has DEPRECATED that filter
   * ("PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."), so
   * setting it is a no-op plus a console warning the smoke runner fails on.
   *
   * VSM is the only soft filter r185 still has, and it was measured rather than
   * adopted: ONE binary, the RN-1200 machine scene, one flag apart, same pose
   * (miss 0.20 m both) and same pinned sun (dot 0.4479 both).
   *
   *   ?shadowsoft=0   box luma 20.43, p95 39.12   near 6.5 ms,  frame p50 9.4 ms
   *   ?shadowsoft=1   box luma 25.43, p95 71.51   near 14.2 ms, frame p50 19.2 ms
   *
   * It costs 2.18x the near pass and 2.04x the frame, putting p50 at 19.2 ms
   * against a 16.6 ms budget, and it LIFTS the shadowed subject 24.4 per cent
   * with p95 up 82.8 per cent, which is VSM's own light bleed and is a fidelity
   * regression rather than a softening. Refused on cost AND on look.
   *
   * The switch stays so the next lane re-PRICES it instead of re-discovering
   * it, and so the frames above can be reproduced from one build.
   */
  readonly shadowSoft: boolean;
  readonly csmCascades: number;
  /**
   * RN-1415. The cube side of the PMREM environment (`Renderer.environmentFrom`).
   * This is the specular resolution of EVERY stock material in the game: the
   * machines, the structures, the ruin, the tools and the suit all read their
   * reflection out of this one map, and until this pass it was 64 for every
   * tier. Section 7.1's original 64 was chosen against a 10.5 ms rebuild cost
   * measured on this same GPU, and the rebuild is amortised over 240 frames
   * plus an elevation trigger, so the honest question is what a rebuild HITCH
   * costs and not what it costs per frame.
   */
  readonly iblSize: number;
  /** TerrainStreamer genBudget: meshes built per streaming update. */
  readonly genBudget: number;
  readonly maxResidentChunks: number;
  readonly postfx: boolean;
}

const TABLE: Record<QualityTier, Omit<QualityKnobs, 'tier'>> = {
  low: {
    maxPixelRatio: 1, antialias: false, shadowMapSize: 1024, shadowSoft: false,
    csmCascades: 1, iblSize: 64,
    genBudget: 8, maxResidentChunks: 160, postfx: false,
  },
  med: {
    maxPixelRatio: 1.5, antialias: true, shadowMapSize: 1024, shadowSoft: false,
    csmCascades: 3, iblSize: 128,
    genBudget: 12, maxResidentChunks: 256, postfx: false,
  },
  high: {
    maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, shadowSoft: false,
    csmCascades: 3, iblSize: 256,
    genBudget: 16, maxResidentChunks: 384, postfx: true,
  },
};

/**
 * `over` is the URL's say (Config's `iblSizeOverride` / `shadowSoftOverride`),
 * and it exists so both of RN-1415's and RN-1420's changes have the exact
 * negative control standing rule 7 asks for: `?iblsize=64` restores the size
 * every tier shipped with and `?shadowsoft=0` restores `PCFShadowMap`, both
 * inside ONE binary, so a before/after pair is two runs of one build rather
 * than two builds.
 */
export function qualityKnobs(
  tier: QualityTier,
  over: { iblSize?: number; shadowSoft?: boolean } = {},
): QualityKnobs {
  const base = TABLE[tier];
  return {
    tier,
    ...base,
    iblSize: over.iblSize ?? base.iblSize,
    shadowSoft: over.shadowSoft ?? base.shadowSoft,
  };
}
