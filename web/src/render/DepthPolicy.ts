// THE depth-policy authority (ARCHITECTURE.md section 3.3, DECISIONS.md DW-3).
//
// The camera split is the primary mechanism; this file only picks the buffer
// encoding and hands every custom material the shader prelude for the active
// mode. Materials concatenate the preludes unconditionally, so "forgot the
// logdepthbuf chunks" is not a reachable state.
//
//   1. reversedDepthBuffer  when EXT_clip_control is present (86% of WebGL2)
//   2. logarithmicDepthBuffer  fallback, quality tier above low
//   3. plain depth          low tier; the caller then shortens nearCam.far

import type { Config, QualityTier } from '../app/Config.js';

export type DepthMode = 'reversed' | 'log' | 'plain';

export interface DepthRendererParams {
  reversedDepthBuffer: boolean;
  logarithmicDepthBuffer: boolean;
}

/** What to ask WebGLRenderer for. Reversed-Z silently degrades if unsupported. */
export function depthRendererParams(cfg: Config, quality: QualityTier): DepthRendererParams {
  if (cfg.forcePlainDepth) return { reversedDepthBuffer: false, logarithmicDepthBuffer: false };
  if (cfg.forceLogDepth) return { reversedDepthBuffer: false, logarithmicDepthBuffer: true };
  return { reversedDepthBuffer: true, logarithmicDepthBuffer: quality === 'low' ? false : false };
}

/** What we actually got, after the capability probe. */
export function resolveDepthMode(
  reversedAvailable: boolean, cfg: Config, quality: QualityTier,
): DepthMode {
  if (cfg.forcePlainDepth) return 'plain';
  if (cfg.forceLogDepth) return 'log';
  if (reversedAvailable) return 'reversed';
  return quality === 'low' ? 'plain' : 'log';
}

const LOG_VS_PARS = '#include <logdepthbuf_pars_vertex>';
const LOG_VS_BODY = '#include <logdepthbuf_vertex>';
const LOG_FS_PARS = '#include <logdepthbuf_pars_fragment>';
const LOG_FS_BODY = '#include <logdepthbuf_fragment>';

export class DepthPolicy {
  readonly mode: DepthMode;
  /** Goes in the vertex shader's declaration block. */
  readonly vertexPars: string;
  /** Goes at the END of main(), after gl_Position is assigned. */
  readonly vertexBody: string;
  readonly fragmentPars: string;
  /** Goes at the START of the fragment main(). */
  readonly fragmentBody: string;

  constructor(mode: DepthMode) {
    this.mode = mode;
    const log = mode === 'log';
    // reversed-Z needs no shader participation at all: three flips the
    // projection matrix, the clear value and the depth func for us.
    this.vertexPars = log ? LOG_VS_PARS : '';
    this.vertexBody = log ? LOG_VS_BODY : '';
    this.fragmentPars = log ? LOG_FS_PARS : '';
    this.fragmentBody = log ? LOG_FS_BODY : '';
  }

  /** Near-scene far plane. Plain depth cannot hold 100 km, so it gets 30 km. */
  nearFarPlaneM(): number {
    return this.mode === 'plain' ? 3.0e4 : 1.0e5;
  }

  /** Coarsest chunk depth allowed in the NEAR scene (section 3.2). */
  nearDepthCutoff(): number {
    return this.mode === 'plain' ? 5 : 6;
  }
}
