// The one place a post-processing material becomes a draw call.
//
// A full-screen TRIANGLE, not a quad: a quad's diagonal is shaded twice by the
// 2x2 derivative rasteriser and it splits the screen into two triangles that
// cannot share a texture-cache line across the seam. One oversized triangle
// clipped to the viewport is strictly cheaper and is what every post stack ships.
//
// The vertex shader bypasses the camera entirely (`gl_Position = vec4(xy,0,1)`),
// which is deliberate: DepthPolicy flips the projection matrix under reversed-Z
// and rewrites gl_FragDepth under log depth, and a post pass must be immune to
// both. No post material may declare a depth test, write depth, or read a
// projection matrix for anything except UNPROJECTING a depth sample.

import * as THREE from 'three';

let sharedGeometry: THREE.BufferGeometry | null = null;

function fullScreenTriangle(): THREE.BufferGeometry {
  if (sharedGeometry !== null) return sharedGeometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  g.name = 'post:fullScreenTriangle';
  sharedGeometry = g;
  return g;
}

export const POST_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * three defines `varying`, `attribute` and `texture2D` for GLSL3 but pointedly
 * does NOT define `gl_FragColor` (WebGLProgram: the two lines that add
 * `pc_fragColor` are both guarded by `glslVersion !== GLSL3`). So a GLSL3 post
 * shader declares its own output, and every post shader here is GLSL3 for one
 * reason: `textureLod`. An implicit-derivative fetch inside a loop the compiler
 * cannot prove uniform makes ANGLE emit `X3595`, the smoke runner fails on any
 * WebGL warning, and an explicit level of 0 is what a mipmap-free depth texture
 * always meant anyway.
 */
const GLSL3_FS_PRELUDE = `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`;

export interface PostMaterialOpts {
  readonly defines?: Record<string, string | number>;
  /** Default true. FXAA comes from three's addons and is GLSL1. */
  readonly glsl3?: boolean;
  /** Multiply the destination by this pass's output. Used by the AO apply. */
  readonly multiply?: boolean;
  /** Add this pass's output to the destination. Used by the bloom upsample. */
  readonly add?: boolean;
}

export function postMaterial(
  name: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  opts: PostMaterialOpts = {},
): THREE.ShaderMaterial {
  const glsl3 = opts.glsl3 !== false;
  const m = new THREE.ShaderMaterial({
    name,
    glslVersion: glsl3 ? THREE.GLSL3 : THREE.GLSL1,
    vertexShader: POST_VS,
    fragmentShader: glsl3 ? GLSL3_FS_PRELUDE + fragmentShader : fragmentShader,
    uniforms,
    defines: { ...(opts.defines ?? {}) },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  if (opts.multiply === true) {
    // dst' = src * dst. The AO pass never reads the colour buffer it darkens,
    // so there is no ping-pong and no full-resolution copy anywhere in the AO
    // path. Alpha is left alone on purpose: the scene target's alpha is not a
    // quantity anything downstream reads, and multiplying it would make the
    // effect visible in a toBlob() capture as transparency.
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.ZeroFactor;
    m.blendDst = THREE.SrcColorFactor;
    m.blendEquation = THREE.AddEquation;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.blendEquationAlpha = THREE.AddEquation;
  } else if (opts.add === true) {
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.AddEquation;
  } else {
    m.blending = THREE.NoBlending;
  }
  return m;
}

/** A material bound to the shared triangle. `mesh` is what the seam draws. */
export class Blit {
  readonly mesh: THREE.Mesh;

  constructor(readonly material: THREE.ShaderMaterial) {
    this.mesh = new THREE.Mesh(fullScreenTriangle(), material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = `post:${material.name}`;
  }

  get u(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  dispose(): void { this.material.dispose(); }
}

export function disposeSharedQuadGeometry(): void {
  sharedGeometry?.dispose();
  sharedGeometry = null;
}
