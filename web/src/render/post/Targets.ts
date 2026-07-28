// Every render target the post stack owns, allocated in one place so its VRAM
// is a number this file can print rather than an estimate.
//
// The scene target carries a DEPTH TEXTURE, and that is the whole reason the
// stack can do ambient occlusion without a second geometry pass. ARCHITECTURE
// section 3.1 clears depth between the four passes, so the depth attachment
// holds EXACTLY ONE pass's depth at any instant. The AO pass runs immediately
// after the NEAR pass and before its clearDepth(), so what it reads is the near
// 1:1 scene and nothing else - not the sky (which does not write depth), not the
// far scaled scene (cleared), and not the view model (not drawn yet). That is
// the correct subject: AO is about machines and props resting on ground.
//
// The depth texture is DEPTH_COMPONENT32F rather than the default framebuffer's
// 24-bit fixed point (DW-3 closed). Reversed-Z only concentrates precision when
// the mantissa can follow it, so this is the first buffer in the project where
// reversed-Z can deliver its headline win.

import * as THREE from 'three';

export interface TargetSizes {
  readonly w: number;
  readonly h: number;
  readonly aoW: number;
  readonly aoH: number;
  readonly bloomLevels: number;
}

function sceneTarget(w: number, h: number, samples: number): THREE.WebGLRenderTarget {
  const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
  depth.format = THREE.DepthFormat;
  depth.minFilter = THREE.NearestFilter;
  depth.magFilter = THREE.NearestFilter;
  depth.generateMipmaps = false;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depth,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    samples,
  });
  rt.texture.name = 'post:scene';
  return rt;
}

function aoTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  rt.texture.name = 'post:ao';
  return rt;
}

function hdrTarget(w: number, h: number, name: string): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.name = name;
  return rt;
}

function ldrTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    // The composite writes sRGB-ENCODED bytes here and the AA pass wants those
    // bytes back unchanged, so this is NOT an sRGB texture: an sRGB sampler
    // would decode on read and FXAA would run on linear values, which is
    // exactly the mistake that makes post AA look like a blur.
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.name = 'post:ldr';
  return rt;
}

export class PostTargets {
  scene!: THREE.WebGLRenderTarget;
  ao!: THREE.WebGLRenderTarget;
  aoBlur!: THREE.WebGLRenderTarget;
  /**
   * Full-resolution AO. It exists because the pass that multiplies AO into the
   * scene colour must not sample any attachment of the scene framebuffer, and
   * the depth-aware upsample needs depth. One R8 buffer buys a halo-free
   * silhouette and a legal draw; see AoGlsl's "WHY FOUR PASSES".
   */
  aoFull!: THREE.WebGLRenderTarget;
  /**
   * Screen-space contact shadows, full resolution R8. Full rather than half
   * because the whole claim of the term is that it resolves a 3-triangle blade
   * against the soil it stands in, and a half-resolution buffer cannot: the
   * feature it is looking for is one to three pixels wide. It is one byte per
   * pixel, so the resolution is 0.9 MB at 1280x720 and not a budget question.
   */
  contact!: THREE.WebGLRenderTarget;
  ldr!: THREE.WebGLRenderTarget;
  /** Bloom mip chain, index 0 = half resolution. */
  bloom: THREE.WebGLRenderTarget[] = [];
  sizes!: TargetSizes;
  bytes = 0;

  constructor(
    w: number, h: number,
    private readonly aoScale: number,
    private readonly bloomLevels: number,
    private readonly samples: number,
  ) {
    this.allocate(w, h);
  }

  private allocate(w: number, h: number): void {
    const W = Math.max(2, w | 0);
    const H = Math.max(2, h | 0);
    const aw = Math.max(2, Math.round(W * this.aoScale));
    const ah = Math.max(2, Math.round(H * this.aoScale));
    this.scene = sceneTarget(W, H, this.samples);
    this.ao = aoTarget(aw, ah);
    this.aoBlur = aoTarget(aw, ah);
    this.aoFull = aoTarget(W, H);
    this.contact = aoTarget(W, H);
    this.ldr = ldrTarget(W, H);
    this.bloom = [];
    let bw = W;
    let bh = H;
    for (let i = 0; i < this.bloomLevels; ++i) {
      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
      this.bloom.push(hdrTarget(bw, bh, `post:bloom${i}`));
    }
    this.sizes = { w: W, h: H, aoW: aw, aoH: ah, bloomLevels: this.bloom.length };
    // Byte accounting, not an estimate: 8 B/px half-float RGBA, 4 B/px depth32F
    // and RGBA8, 1 B/px for the two R8 AO buffers. MSAA colour is charged at
    // samples x, which is the reason `?msaa=` is measured rather than assumed.
    const msaa = Math.max(1, this.samples);
    this.bytes = W * H * 8 * msaa      // scene colour
      + W * H * 4 * msaa               // scene depth32F
      + W * H * 8                      // scene colour resolve (only when msaa > 1)
        * (msaa > 1 ? 1 : 0)
      + aw * ah * 2                    // ao + aoBlur, R8
      + W * H * 1                      // aoFull, R8
      + W * H * 1                      // contact, R8
      + W * H * 4                      // ldr
      + this.bloom.reduce((n, t) => n + t.width * t.height * 8, 0);
  }

  resize(w: number, h: number): boolean {
    if ((w | 0) === this.sizes.w && (h | 0) === this.sizes.h) return false;
    this.dispose();
    this.allocate(w, h);
    return true;
  }

  dispose(): void {
    this.scene.depthTexture?.dispose();
    this.scene.dispose();
    this.ao.dispose();
    this.aoBlur.dispose();
    this.aoFull.dispose();
    this.contact.dispose();
    this.ldr.dispose();
    for (const b of this.bloom) b.dispose();
    this.bloom = [];
  }
}
