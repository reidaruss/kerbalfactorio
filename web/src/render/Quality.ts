// Quality tier -> concrete knobs. One table, no scattered `if (tier === ...)`.

import type { QualityTier } from '../app/Config.js';

export interface QualityKnobs {
  readonly tier: QualityTier;
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadowMapSize: number;
  readonly csmCascades: number;
  /** TerrainStreamer genBudget: meshes built per streaming update. */
  readonly genBudget: number;
  readonly maxResidentChunks: number;
  readonly postfx: boolean;
}

const TABLE: Record<QualityTier, Omit<QualityKnobs, 'tier'>> = {
  low: {
    maxPixelRatio: 1, antialias: false, shadowMapSize: 1024, csmCascades: 1,
    genBudget: 8, maxResidentChunks: 160, postfx: false,
  },
  med: {
    maxPixelRatio: 1.5, antialias: true, shadowMapSize: 1024, csmCascades: 3,
    genBudget: 12, maxResidentChunks: 256, postfx: false,
  },
  high: {
    maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, csmCascades: 3,
    genBudget: 16, maxResidentChunks: 384, postfx: true,
  },
};

export function qualityKnobs(tier: QualityTier): QualityKnobs {
  return { tier, ...TABLE[tier] };
}
