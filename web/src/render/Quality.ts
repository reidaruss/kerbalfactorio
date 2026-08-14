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
   *
   * RN-1610. FLOORED AT 256 ON EVERY TIER. RN-1572/1573 authored the sun disc
   * at its real 0.53 deg, ~2.25 texels at a 256 cube, and it is MISSED
   * ENTIRELY at 64 (low) and lands only partially at 128 (med): `ibldiag.js`
   * at those sizes reads `brightTexels` 0 and `peakRatio` ~1.0, i.e. no
   * specular sun on two of three tiers -- the night's headline improvement
   * absent on low and medium. Candidates were (a) floor the cube on every
   * tier, (b) widen the disc only inside the capture pass at small cube
   * sizes, (c) tier-dependent disc width. Chosen: (a), on RN-1415's OWN
   * measured number rather than a new one -- that row already priced a
   * 64->256 raise on this exact GPU at 0.6 to 1.0 ms a rebuild, CHEAPER than
   * the 10.5 ms this docstring records at 64, so flooring low/med to 256 is
   * not a new cost, it is reusing a cost already measured and settled. (b)
   * and (c) both add a capture-time branch for a saving this repo already
   * knows is negative (the floor is free, not merely affordable); rejected
   * for more moving parts buying nothing the floor doesn't already buy. The
   * disc's own radiance/solid-angle product (RN-1572) is untouched -- this is
   * a resolution floor, not a re-author of the sun, and the presented sky
   * (the atmosphere pass, not this cube) never reads `iblSize` at all.
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
    csmCascades: 1, iblSize: 256, // RN-1610: floored, was 64
    genBudget: 8, maxResidentChunks: 160, postfx: false,
  },
  med: {
    maxPixelRatio: 1.5, antialias: true, shadowMapSize: 1024, shadowSoft: false,
    csmCascades: 3, iblSize: 256, // RN-1610: floored, was 128
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
