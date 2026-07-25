// THE renderer seam. This is the ONLY file in the codebase that names a concrete
// three.js renderer class (DECISIONS.md DW-10 / WR-1). Everything else takes the
// OFRenderer interface, so a WebGPU swap at W6 is a milestone and not a rewrite.

import * as THREE from 'three';
import type { Config } from '../app/Config.js';
import type { QualityKnobs } from './Quality.js';
import { DepthPolicy, depthRendererParams, resolveDepthMode } from './DepthPolicy.js';

export interface RendererCaps {
  readonly reversedDepthAvailable: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly anisotropy: number;
  readonly precision: string;
  readonly gpu: string;
}

export interface RenderInfo {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface OFRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly caps: RendererCaps;
  readonly depth: DepthPolicy;
  readonly pixelRatio: number;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  clearAll(): void;
  clearDepth(): void;
  setSize(width: number, height: number): void;
  info(): RenderInfo;
  resetInfo(): void;
  /** Must be called inside the same task as the render, or the buffer is gone. */
  capture(): Promise<Blob>;
  dispose(): void;
}

function gpuName(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext === null) return gl.getParameter(gl.RENDERER) as string;
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
}

class WebGLSeam implements OFRenderer {
  private readonly r: THREE.WebGLRenderer;
  readonly caps: RendererCaps;
  readonly depth: DepthPolicy;

  constructor(canvas: HTMLCanvasElement, cfg: Config, q: QualityKnobs) {
    const dp = depthRendererParams(cfg, q.tier);
    this.r = new THREE.WebGLRenderer({
      canvas,
      antialias: q.antialias,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      reversedDepthBuffer: dp.reversedDepthBuffer,
      logarithmicDepthBuffer: dp.logarithmicDepthBuffer,
    });
    const caps = this.r.capabilities;
    const gl = this.r.getContext() as WebGL2RenderingContext;
    this.caps = {
      reversedDepthAvailable: caps.reversedDepthBuffer === true,
      maxTextureSize: caps.maxTextureSize,
      maxSamples: caps.maxSamples,
      anisotropy: caps.getMaxAnisotropy(),
      precision: caps.precision,
      gpu: gpuName(gl),
    };
    this.depth = new DepthPolicy(resolveDepthMode(this.caps.reversedDepthAvailable, cfg, q.tier));

    // Frame.ts owns the clear order for the 4-pass ladder, so autoClear is off.
    // autoReset likewise: three resets info at the top of every render() call, so
    // with four passes per frame the counters would only ever show the last one.
    this.r.autoClear = false;
    this.r.info.autoReset = false;
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.r.setClearColor(0x000000, 1);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.0;
  }

  get domElement(): HTMLCanvasElement { return this.r.domElement; }
  get pixelRatio(): number { return this.r.getPixelRatio(); }

  render(scene: THREE.Scene, camera: THREE.Camera): void { this.r.render(scene, camera); }
  clearAll(): void { this.r.clear(true, true, true); }
  clearDepth(): void { this.r.clearDepth(); }
  setSize(width: number, height: number): void { this.r.setSize(width, height, false); }
  resetInfo(): void { this.r.info.reset(); }

  info(): RenderInfo {
    const i = this.r.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      points: i.render.points,
      lines: i.render.lines,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
    };
  }

  capture(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.r.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }

  dispose(): void { this.r.dispose(); }
}

export function createRenderer(canvas: HTMLCanvasElement, cfg: Config, q: QualityKnobs): OFRenderer {
  return new WebGLSeam(canvas, cfg, q);
}
