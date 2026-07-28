// THE POND'S SURFACE. Geometry from world data, look from this lane.
//
// OWNERSHIP (Admin ruling, RN-51). World-gen keeps the water LEVEL and the
// BASIN: `water_field.h`, `WaterOracle`, `levelAt` / `depthAt` / `shorelineM`.
// That is surface authority and stays in one place per DW-26. Rendering owns
// everything about how water LOOKS, including this mesh's geometry and vertex
// attributes, and this file moved from `web/src/world/` to `web/src/render/` at
// RN-51 so its location stops implying an ownership that is not true.
//
// WHAT COMES OUT OF THE WORLD AND IS NOT A LOOK, unchanged from WG-42:
//   * the disc reaches the SHORELINE, not the basin rim, so it stops where the
//     water actually stops and there is dry beach visible inside the bowl;
//   * it is a curved shell on the sphere, not a plane;
//   * the tessellation is finest at the waterline, where the shading changes
//     fastest and where a coarse ring would show as a polygonal edge;
//   * the WATER DEPTH under every vertex is read from the oracle at build time.
//     That one gradient is what makes it read as a body of water instead of a
//     decal, and it is world-gen data rather than a look. It now drives the
//     alpha, the volume tint, the refraction strength AND the foam band.
//
// TWO ATTRIBUTES REPLACE THE RGBA COLOUR WG-42 BAKED, and the reason is that a
// baked colour is a look computed on the CPU:
//   aWater = (metres of water here, radius / shorelineM)
//   aPlane = metres east / north of the pond centre in the pond's tangent basis
//
// `aPlane` IS THE LOAD-BEARING ONE. RN-45 measured that a field keyed on
// planet-centred metres cannot carry a derivative on this body: float32 at 6e5 m
// has a 0.03125 m quantum against a 4.3 mm pixel footprint, so the derivative is
// exactly zero across runs of pixels and steps on surfaces of constant range,
// which draws arcs centred on the eye. `aPlane` spans +/-11 m, so float32
// resolves it to about a micron, and the ripple's analytic gradient is exact at
// every pixel size. It also survives a floating-origin rebase untouched, because
// it is an attribute rather than something derived from the engine position.
//
// Anchoring follows standing rule 6: vertices are float32 metres about the pond
// centre (the disc is 32 m across, so f32 is 4 micrometres here and would be
// 71 mm about the planet centre), and the mesh's engine position is re-derived
// from the f64 anchor through FloatingOrigin on every rebase.

import * as THREE from 'three';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { WaterOracle } from '../world/WaterOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import type { DepthPolicy } from './DepthPolicy.js';
import type { AtmosphereUniforms } from './materials/Atmosphere.glsl.js';
import { createWaterMaterial, type WaterMaterialHandle } from './materials/WaterMaterial.js';

/** Rings from centre to shore, and segments around. 24 x 64 is 1,600 verts. */
const RINGS = 24;
const SEGS = 64;

/**
 * The one renderer capability the grab needs, named STRUCTURALLY so this file
 * still does not mention a concrete renderer class (Renderer.ts's WR-1 header:
 * it is the only file allowed to). `onBeforeRender` hands us the live renderer;
 * this interface is what we are willing to know about it.
 */
interface GrabHost {
  copyFramebufferToTexture(texture: THREE.Texture): void;
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
}

export interface WaterSurfaceOptions {
  readonly depth: DepthPolicy;
  /** The NEAR terrain material, read for its uniform objects. See WaterMaterial. */
  readonly terrain: THREE.ShaderMaterial;
  readonly atmosphere: AtmosphereUniforms;
  readonly cascades: number;
  /**
   * Whether a framebuffer grab is LEGAL in this build. Two conditions, and both
   * are hard rather than stylistic:
   *
   *  (1) THE POST STACK MUST BE ON. With `?post=0` the scene renders straight to
   *      the canvas, which is sRGB-encoded LDR, while this material's output is
   *      linear HDR. Mixing the two would double-encode the refracted bed. With
   *      post on, the scene target is linear half-float and the two agree.
   *  (2) MSAA MUST BE OFF on the scene target. When `samples > 0` three binds a
   *      MULTISAMPLED framebuffer for the scene pass, and `copyTexSubImage2D`
   *      from a multisampled read framebuffer is GL_INVALID_OPERATION in WebGL2.
   *      That would be RN-47's feedback loop again: a per-frame error storm, a
   *      term that reports itself as running, and zero pixels moved.
   *
   * When this is false the material falls back to the WG-42 depth-ramp look and
   * `__ofWater.state().live[2]` reads 0 against an `amp[2]` of 1, so the reason
   * is visible in the report rather than inferred.
   */
  readonly refractAllowed: boolean;
}

export class WaterSurface {
  readonly mesh: THREE.Mesh | null = null;
  /** Body-frame f64 anchor the geometry is stored about. */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  /** Deepest water the built mesh actually saw, metres. A measurement, not a
   *  constant: a probe reads it to prove the disc covers real depth. */
  readonly builtMaxDepthM: number = 0;
  readonly vertexCount: number = 0;
  private handle: WaterMaterialHandle | null = null;
  private grab: THREE.FramebufferTexture | null = null;
  private grabW = 0;
  private grabH = 0;
  private readonly sizeScratch = new THREE.Vector2();
  /** Frames on which the grab actually ran. A counter, not a boolean, because
   *  "it ran once at boot" and "it runs every frame" are different claims. */
  grabs = 0;

  constructor(private readonly origin: FloatingOrigin,
              oracle: SurfaceOracle, water: WaterOracle,
              private readonly opts: WaterSurfaceOptions) {
    const disc = water.disc;
    if (disc === null || disc.shorelineM <= 0) return;
    // Standing rule 7: `?water=0` removes the surface entirely, so any claim
    // about what the pond does to the frame can be isolated against a build with
    // no pond in it. Read here rather than threaded through Config because the
    // whole of this decision lives in this file and a flag routed through two
    // other lanes' modules to reach one `if` is a coordination cost for nothing.
    if (new URLSearchParams(self.location.search).get('water') === '0') return;

    // Tangent basis at the pond centre. Same construction the slope sampler
    // uses, so "east" means the same thing in both. The two vectors are also
    // handed to the material: engine space is a pure TRANSLATION of body space,
    // so a body-frame direction is already an engine-frame direction and the
    // ripple basis needs no per-frame update and no rebase.
    const ux = disc.dirX, uy = disc.dirY, uz = disc.dirZ;
    let ex = -uz, ey = 0, ez = ux;
    const el = Math.hypot(ex, ey, ez);
    if (el < 1e-9) { ex = 1; ey = 0; ez = 0; } else { ex /= el; ez /= el; }
    const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;

    const levelR = oracle.body.radiusM + disc.levelM;
    this.anchor.x = ux * levelR; this.anchor.y = uy * levelR; this.anchor.z = uz * levelR;

    const vCount = 1 + RINGS * SEGS;
    const pos = new Float32Array(vCount * 3);
    const nrm = new Float32Array(vCount * 3);
    const plane = new Float32Array(vCount * 2);
    const wat = new Float32Array(vCount * 2);
    let maxDepth = 0;

    const put = (i: number, distM: number, ang: number): void => {
      const c = Math.cos(ang), s = Math.sin(ang);
      // A point on the sphere at arc `distM` from the centre along this bearing.
      // Small-angle: build the offset in the tangent plane and re-normalise.
      const t = distM / oracle.body.radiusM;
      let dx = ux + t * (c * ex + s * nx);
      let dy = uy + t * (c * ey + s * ny);
      let dz = uz + t * (c * ez + s * nz);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      // THE WATER SURFACE IS THE WATER LEVEL. It is not `surfaceRadius` plus
      // anything, and this is the one line in the client where that could have
      // been fudged. The ground is read separately, one line down, and only to
      // find out how DEEP the water is here.
      const px = dx * levelR, py = dy * levelR, pz = dz * levelR;
      pos[i * 3] = px - this.anchor.x;
      pos[i * 3 + 1] = py - this.anchor.y;
      pos[i * 3 + 2] = pz - this.anchor.z;
      // Normal is the local up: the surface is a shell of the sphere.
      nrm[i * 3] = dx; nrm[i * 3 + 1] = dy; nrm[i * 3 + 2] = dz;
      // The ripple coordinate. Planar metres from the pond centre, which is the
      // whole reason the ripple can carry an exact derivative. See the header.
      plane[i * 2] = distM * c;
      plane[i * 2 + 1] = distM * s;

      const groundR = oracle.surfaceRadius(dx, dy, dz);
      const depth = Math.max(0, levelR - groundR);
      if (depth > maxDepth) maxDepth = depth;
      wat[i * 2] = depth;
      wat[i * 2 + 1] = distM / disc.shorelineM;
    };

    put(0, 0, 0);
    for (let ring = 1; ring <= RINGS; ++ring) {
      // Squared spacing so the tessellation is finest at the shoreline, which
      // is where the shading changes fastest and where a coarse ring would show
      // as a polygonal waterline.
      const f = ring / RINGS;
      const distM = disc.shorelineM * f * f;
      for (let s = 0; s < SEGS; ++s) {
        put(1 + (ring - 1) * SEGS + s, distM, (2 * Math.PI * s) / SEGS);
      }
    }

    const idx: number[] = [];
    for (let s = 0; s < SEGS; ++s) {
      idx.push(0, 1 + s, 1 + ((s + 1) % SEGS));
    }
    for (let ring = 1; ring < RINGS; ++ring) {
      const a0 = 1 + (ring - 1) * SEGS, b0 = 1 + ring * SEGS;
      for (let s = 0; s < SEGS; ++s) {
        const s1 = (s + 1) % SEGS;
        idx.push(a0 + s, b0 + s, b0 + s1);
        idx.push(a0 + s, b0 + s1, a0 + s1);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aPlane', new THREE.BufferAttribute(plane, 2));
    g.setAttribute('aWater', new THREE.BufferAttribute(wat, 2));
    g.setIndex(idx);

    this.handle = createWaterMaterial({
      depth: opts.depth,
      terrain: opts.terrain,
      atmosphere: opts.atmosphere,
      east: new THREE.Vector3(ex, ey, ez),
      north: new THREE.Vector3(nx, ny, nz),
      cascades: opts.cascades,
    });
    this.mesh = new THREE.Mesh(g, this.handle.material);
    this.mesh.renderOrder = 2;
    // Frustum culling is what makes the grab cost nothing when the pond is off
    // screen: `onBeforeRender` fires only for objects that survive the cull.
    this.mesh.frustumCulled = true;
    this.mesh.onBeforeRender = (r, _s, cam): void => {
      this.beforeRender(r as unknown as GrabHost, cam);
    };
    this.builtMaxDepthM = maxDepth;
    this.vertexCount = vCount;
    // The grab is NOT counted by `vramEstimateMB`, which is built from the post
    // targets and the chunk pool, so it is published here or the cost claim
    // would be an assertion rather than a measurement. It reads 0 until the
    // pond is first drawn, which is the claim that matters: a body with no
    // water, a camera looking away, `?post=0` and `?msaa=` all pay nothing.
    const w = self as unknown as Record<string, Record<string, unknown>>;
    if (w.__ofWater !== undefined) {
      w.__ofWater.grabBytes = (): number => this.grabBytes;
      w.__ofWater.grabs = (): number => this.grabs;
    }
    this.reanchor();
  }

  /**
   * Per-frame water state, pushed at the ONE instant it is both needed and free.
   *
   * `onBeforeRender` fires immediately before this mesh's draw call and after
   * every earlier draw in the same render list has been submitted, which is what
   * makes it the grab point: the bound framebuffer holds the sky, the far scaled
   * scene and every opaque object of the near pass, and does NOT yet hold the
   * water. It is also the only place with the live camera and drawing-buffer
   * size in hand, so the projection facts the refraction offset needs are pushed
   * here rather than from a per-frame system that would run whether the pond
   * were on screen or not.
   */
  private beforeRender(r: GrabHost, cam: THREE.Camera): void {
    const h = this.handle;
    if (h === null) return;
    const p = cam as THREE.PerspectiveCamera;
    const size = r.getDrawingBufferSize(this.sizeScratch);
    if (p.isPerspectiveCamera === true) {
      h.setView(THREE.MathUtils.degToRad(p.fov), p.aspect, size.y);
    }
    if (!this.opts.refractAllowed) return;
    const w = Math.max(1, Math.floor(size.x));
    const hh = Math.max(1, Math.floor(size.y));
    if (this.grab !== null && (this.grabW !== w || this.grabH !== hh)) {
      // Storage is immutable once three has allocated it (texStorage2D), so a
      // resize is a dispose and a rebuild, never a `needsUpdate`.
      this.grab.dispose();
      this.grab = null;
      h.setGrab(null);
    }
    if (this.grab === null) {
      // HalfFloatType because the scene target is, and copyTexSubImage2D does
      // no format conversion: a mismatched destination is a GL error, not a
      // slower path. See WaterSurfaceOptions.refractAllowed.
      this.grab = new THREE.FramebufferTexture(w, hh);
      this.grab.type = THREE.HalfFloatType;
      this.grab.colorSpace = THREE.NoColorSpace;
      this.grabW = w; this.grabH = hh;
      h.setGrab(this.grab);
    }
    r.copyFramebufferToTexture(this.grab);
    this.grabs++;
  }

  /** Bytes the grab holds. Zero until it first runs, and zero if it never does. */
  get grabBytes(): number {
    return this.grab === null ? 0 : this.grabW * this.grabH * 8;
  }

  /** Re-derive the engine transform from the f64 anchor. Call on OriginRebased. */
  reanchor(): void {
    if (this.mesh === null) return;
    this.origin.toEngine(this.anchor, this.mesh.position);
  }

  dispose(): void {
    this.grab?.dispose();
    this.handle?.dispose();
    this.mesh?.geometry.dispose();
  }
}
