// THE renderer seam. This is the ONLY file in the codebase that names a concrete
// three.js renderer class (DECISIONS.md DW-10 / WR-1). Everything else takes the
// OFRenderer interface, so a WebGPU swap at W6 is a milestone and not a rewrite.

import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { Config } from '../app/Config.js';
import type { QualityKnobs } from './Quality.js';
import { DepthPolicy, depthRendererParams, resolveDepthMode } from './DepthPolicy.js';
import { PostStack, type PostHost } from './post/PostStack.js';

export interface RendererCaps {
  readonly reversedDepthAvailable: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly anisotropy: number;
  readonly precision: string;
  readonly gpu: string;
  /**
   * Bits in the DEFAULT framebuffer's depth attachment, and whether it is a
   * float format. This decides whether reversed-Z buys anything at all:
   * reversing only concentrates precision when the mantissa can follow it, so
   * on a fixed-point buffer it is numerically identical to standard depth.
   */
  readonly depthBits: number;
  readonly depthIsFloat: boolean;
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
  /**
   * The post-processing stack. It lives behind the seam because it owns render
   * targets and issues draws, and both of those are renderer-specific; Frame.ts
   * owns WHEN each half of it runs, because that is a question about the
   * four-pass clear order and nothing else. Null only if construction failed.
   */
  readonly post: PostStack;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  clearAll(): void;
  clearDepth(): void;
  setSize(width: number, height: number): void;
  info(): RenderInfo;
  resetInfo(): void;
  /** Must be called inside the same task as the render, or the buffer is gone. */
  capture(): Promise<Blob>;
  /**
   * RGBA8 read-back of the default framebuffer, origin BOTTOM-LEFT. Same
   * same-task rule as capture(). Only the depth probe uses this; it stays on
   * the seam so no other module ever reaches for the raw GL context.
   */
  readPixels(x: number, y: number, w: number, h: number, out: Uint8Array): void;
  /**
   * A pre-filtered environment map of `scene`, for Scene.environment. It lives
   * on the seam because PMREMGenerator is renderer-specific; SkyIbl owns WHEN.
   */
  environmentFrom(scene: THREE.Scene): THREE.Texture | null;
  /**
   * RN-1462. Lets a `KTX2Loader` ask the GPU which compressed formats it
   * supports (three's `detectSupport`, which needs the concrete renderer and
   * must run before that loader transcodes anything). This is the one seam
   * crossing for it, mirroring `environmentFrom`'s PMREMGenerator precedent:
   * everything else takes `OFRenderer` so a WebGPU swap is a two-method edit
   * here rather than a rewrite at every call site (DW-10 / WR-1).
   */
  detectKtx2Support(loader: KTX2Loader): void;
  /**
   * RN-1415. The cube side `environmentFrom` builds at, published so a probe
   * can say WHICH environment it measured. Without it `?iblsize=64` and the
   * `high` default are the same report with different pixels, which is the
   * shape of every result this project has had to re-take.
   */
  readonly iblSize: number;
  dispose(): void;
}

function gpuName(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext === null) return gl.getParameter(gl.RENDERER) as string;
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
}

class WebGLSeam implements OFRenderer, PostHost {
  private readonly r: THREE.WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  readonly caps: RendererCaps;
  readonly depth: DepthPolicy;
  readonly post: PostStack;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** RN-1415. The PMREM cube side, from the quality tier and `?iblsize=`. */
  readonly iblSize: number;
  /** For the full-screen triangle. Never moves; the post VS ignores it anyway. */
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly sizeScratch = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement, cfg: Config, q: QualityKnobs) {
    this.iblSize = q.iblSize;
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
    this.gl = gl;
    this.caps = {
      reversedDepthAvailable: caps.reversedDepthBuffer === true,
      maxTextureSize: caps.maxTextureSize,
      maxSamples: caps.maxSamples,
      anisotropy: caps.getMaxAnisotropy(),
      precision: caps.precision,
      gpu: gpuName(gl),
      depthBits: gl.getParameter(gl.DEPTH_BITS) as number,
      depthIsFloat: (() => {
        const t = gl.getFramebufferAttachmentParameter(
          gl.FRAMEBUFFER, gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
        ) as number;
        return t === gl.FLOAT;
      })(),
    };
    this.depth = new DepthPolicy(resolveDepthMode(this.caps.reversedDepthAvailable, cfg, q.tier));

    // Frame.ts owns the clear order for the 4-pass ladder, so autoClear is off.
    // autoReset likewise: three resets info at the top of every render() call, so
    // with four passes per frame the counters would only ever show the last one.
    this.r.autoClear = false;
    this.r.info.autoReset = false;
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.r.setClearColor(cfg.clearColor, 1);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.0;
    // Shadow cascades (ShadowRig). Only the NEAR scene holds shadow-casting
    // lights, so WebGLShadowMap returns early for the sky, far and view-model
    // passes and the maps are rendered exactly once per frame, not four times.
    this.r.shadowMap.enabled = cfg.shadows;
    // RN-1420. The filter is a SHADOWMAP_TYPE define, so it is a property of
    // every program in the build and not of a light: terrain, water, props,
    // machines and the stock materials all take it through their own
    // `<shadowmap_pars_fragment>` include. `PCFShadowMap` is a ONE-TEXEL kernel,
    // and §2.1.5 measures cascade 0 at 15.47 mm per texel over 0 to 22 m, so
    // every contact edge inside a walking frame was a 15 mm hard step.
    // `PCFSoftShadowMap` IS NOT AVAILABLE AND THAT IS MEASURED, NOT ASSUMED:
    // three r185 answers it with "THREE.WebGLShadowMap: PCFSoftShadowMap has
    // been deprecated. Using PCFShadowMap instead." on the console, which the
    // smoke runner correctly fails the run on. Setting it would have been a
    // silent no-op with a warning. VSM is the one remaining soft filter.
    this.r.shadowMap.type = q.shadowSoft ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    // Constructed LAST: PostStack asks the host for its buffer size, and the
    // size is not final until setPixelRatio and the clear colour are set.
    this.post = new PostStack(this, { ...cfg.post.flags }, { ...cfg.post.tune });
  }

  get domElement(): HTMLCanvasElement { return this.r.domElement; }
  get pixelRatio(): number { return this.r.getPixelRatio(); }
  get depthMode(): 'reversed' | 'log' | 'plain' { return this.depth.mode; }

  setTarget(rt: THREE.WebGLRenderTarget | null): void { this.r.setRenderTarget(rt); }

  bufferSize(): { w: number; h: number } {
    this.r.getDrawingBufferSize(this.sizeScratch);
    return { w: this.sizeScratch.x, h: this.sizeScratch.y };
  }

  /**
   * One post pass. `this.r.render` and not `renderBufferDirect` on purpose: the
   * direct path skips the state resets around blending and depth that a post
   * material relies on, and three's own post addons take exactly this route.
   */
  drawFullScreen(mesh: THREE.Mesh): void { this.r.render(mesh, this.quadCam); }

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

  environmentFrom(scene: THREE.Scene): THREE.Texture | null {
    this.pmrem ??= new THREE.PMREMGenerator(this.r);
    // fromScene renders the scene into a small cube and pre-filters it. The sky
    // box is centred on the origin and the sky camera never translates, so the
    // default 0.1 to 100 range covers it exactly.
    //
    // It ALLOCATES A NEW RENDER TARGET every call and offers no way to reuse
    // one, so the previous target is disposed here rather than in SkyIbl:
    // disposing only the .texture leaks the target, and the leak is not subtle.
    // Measured before this line existed: renderer.info.memory.textures climbing
    // past 50 and the near pass at 170 ms.
    //
    // RN-1415, THE SIZE IS NOW THE QUALITY TIER'S AND NOT A LITERAL 64. 64 was
    // section 7.1's size and it is the specular resolution of every stock
    // material in the game at once. A cube face 64 px across subtends 1.4
    // degrees per texel, which is below the lobe width of anything rougher than
    // about 0.35 and ABOVE it for everything smoother, so the machines' Steel
    // role (effective roughness 0.45 x ormG) and every polished part in the
    // ruin, the station and the suit were reading one blurred value across a
    // whole plate. `?iblsize=64` restores it exactly, on any tier.
    const next = this.pmrem.fromScene(scene, 0, 0.1, 100, { size: this.iblSize });
    this.envTarget?.dispose();
    this.envTarget = next;
    return next.texture;
  }

  detectKtx2Support(loader: KTX2Loader): void { loader.detectSupport(this.r); }

  readPixels(x: number, y: number, w: number, h: number, out: Uint8Array): void {
    const gl = this.gl;
    // three may leave a render target bound; the probe wants what was presented.
    this.r.setRenderTarget(null);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  }

  dispose(): void {
    this.post.dispose();
    this.envTarget?.dispose(); this.pmrem?.dispose(); this.r.dispose();
  }
}

export function createRenderer(canvas: HTMLCanvasElement, cfg: Config, q: QualityKnobs): OFRenderer {
  return new WebGLSeam(canvas, cfg, q);
}
