// THE POND'S SURFACE, built from the water level and NOT shaded by world-gen.
//
// READ THIS BEFORE CHANGING IT. This mesh is deliberately the least interesting
// thing that can be honestly called a water surface, and the reason is that a
// water surface which ships as a flat blue plane reads as a bigger blob than
// the ones this pass removed. The rendering lane owns water's LOOK; world-gen
// owns its EXTENT and its DEPTH. So what is here is exactly the part that comes
// out of the world data and nothing else:
//
//   * the disc reaches the SHORELINE, not the basin rim, so it stops where the
//     water actually stops and there is dry beach visible inside the bowl;
//   * it is a curved shell on the sphere, not a plane;
//   * per-vertex colour AND ALPHA are a function of the WATER DEPTH under that
//     vertex, read from the oracle at build time, so it is translucent at the
//     edge where the bottom is 5 cm down and dense in the middle where it is
//     3.4 m down. That one gradient is what makes it read as a body of water
//     instead of a decal, and it is world-gen data rather than a look.
//
// What is NOT here, on purpose, and what the rendering lane still has to do:
//   * no normal animation, no ripples, no flow, no foam at the shoreline;
//   * no refraction, no reflection, no specular sun glint;
//   * no underwater fog / tint when the camera crosses the surface (the number
//     that pass needs already exists and is measured every tick, see
//     Swim.ts SwimState.headUnderM);
//   * no custom shader AT ALL. DW-10 caps the project at five and this spends
//     none of them: it is a stock MeshStandardMaterial with a vertex colour
//     attribute. Whoever gives water a real look should spend one of the five
//     here knowingly, not inherit a half-shaded thing from this lane.
//
// Anchoring follows standing rule 6: vertices are float32 metres about the pond
// centre (the disc is 32 m across, so f32 is 4 micrometres here and would be
// 71 mm about the planet centre), and the mesh's engine position is re-derived
// from the f64 anchor through FloatingOrigin on every rebase.

import * as THREE from 'three';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { SurfaceOracle } from './SurfaceOracle.js';
import type { WaterOracle } from './WaterOracle.js';
import type { Vec3d } from './PlanetBody.js';

/** Rings from centre to shore, and segments around. 24 x 64 is 1,600 verts. */
const RINGS = 24;
const SEGS = 64;

/**
 * Shallow and deep tints. Both are read as "what colour is the water column",
 * so the shallow end is close to the wet ground it is standing on and the deep
 * end is the only genuinely blue thing in the pond. Note neither is the
 * 0x14406e the Ocean BIOME paints dry ground with; that value is a terrain
 * palette entry and borrowing it here would tie a water look to a ground look.
 */
const SHALLOW = new THREE.Color(0x6f8f86);
const DEEP = new THREE.Color(0x1b4f63);
/** Alpha at the shoreline, and at full depth. */
const ALPHA_SHORE = 0.14;
const ALPHA_DEEP = 0.82;
/** Depth, in metres, at which the alpha ramp has fully saturated. */
const ALPHA_FULL_M = 2.6;

export class WaterSurface {
  readonly mesh: THREE.Mesh | null = null;
  /** Body-frame f64 anchor the geometry is stored about. */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  /** Deepest water the built mesh actually saw, metres. A measurement, not a
   *  constant: a probe reads it to prove the disc covers real depth. */
  readonly builtMaxDepthM: number = 0;
  readonly vertexCount: number = 0;

  constructor(private readonly origin: FloatingOrigin,
              oracle: SurfaceOracle, water: WaterOracle) {
    const disc = water.disc;
    if (disc === null || disc.shorelineM <= 0) return;

    // Tangent basis at the pond centre. Same construction the slope sampler
    // uses, so "east" means the same thing in both.
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
    const col = new Float32Array(vCount * 4);   // RGBA: alpha carries the depth
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

      const groundR = oracle.surfaceRadius(dx, dy, dz);
      const depth = Math.max(0, levelR - groundR);
      if (depth > maxDepth) maxDepth = depth;
      const k = Math.min(1, depth / ALPHA_FULL_M);
      col[i * 4] = SHALLOW.r + (DEEP.r - SHALLOW.r) * k;
      col[i * 4 + 1] = SHALLOW.g + (DEEP.g - SHALLOW.g) * k;
      col[i * 4 + 2] = SHALLOW.b + (DEEP.b - SHALLOW.b) * k;
      col[i * 4 + 3] = ALPHA_SHORE + (ALPHA_DEEP - ALPHA_SHORE) * k;
    };

    put(0, 0, 0);
    for (let ring = 1; ring <= RINGS; ++ring) {
      // Squared spacing so the tessellation is finest at the shoreline, which
      // is where the alpha ramp changes fastest and where a coarse ring would
      // show as a polygonal waterline.
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
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      // DoubleSide so the surface is still there when the camera goes under it.
      // Without it, swimming would look exactly like walking through a hole.
      side: THREE.DoubleSide,
      // Off, so the pond bed and anything standing in the water still draw.
      // This is the one sorting compromise in the file and it is the standard
      // one for a single translucent layer.
      depthWrite: false,
      roughness: 0.12,
      metalness: 0.0,
    });
    mat.name = 'Water';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = true;
    this.builtMaxDepthM = maxDepth;
    this.vertexCount = vCount;
    this.reanchor();
  }

  /** Re-derive the engine transform from the f64 anchor. Call on OriginRebased. */
  reanchor(): void {
    if (this.mesh === null) return;
    this.origin.toEngine(this.anchor, this.mesh.position);
  }
}
