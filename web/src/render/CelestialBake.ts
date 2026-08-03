// RN-845. THE BAKE: a body's own surface, resampled into two equirect maps.
//
// Split out of CelestialBodies.ts because that file crossed the 400-line cap
// (ARCHITECTURE.md 2.2 rule 1) and because this half has one job with one
// question attached: WHOSE height field is the moon in the sky made of.
//
// The answer is the same one the moon under your boots is made of. This calls
// `createBodyHandle` for a body nobody is standing on (D-006's own reason for
// existing) and samples that body's `SurfaceOracle`, so the disc is a
// resampling of the landable surface rather than a decorative noise field. A
// procedural crater texture would have looked the same in the first screenshot
// and would have been a second authority on the shape of a world, which is the
// defect class this project has paid for more than any other.
//
// WHAT THE BAKE CAN AND CANNOT CARRY, stated rather than discovered later:
// at 512 wide over Cinder's 200 km radius a texel is 2.45 km of ground. World
// gen authored nine crater scales reaching 1.8 m, so this carries the top few
// rungs and nothing below them. At the 1.91 degrees Cinder subtends from Forge
// that is about 5x oversampled and the limit is invisible; with the body
// filling the screen on approach it is the limit, and it is why the material
// carries a sub-texel normal detail term that never touches the silhouette.

import * as THREE from 'three';
import { biomeColorArray, terrainAlbedo } from './materials/BiomePalette.js';
import { dirForUv } from './materials/CelestialMaterial.js';
import { PlanetBody, type BodyId } from '../world/PlanetBody.js';
import { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export interface BakedBody {
  readonly relief: THREE.DataTexture;
  readonly albedo: THREE.DataTexture;
  /** Half the encoded range: heights map to [-reliefM, +reliefM]. */
  readonly reliefM: number;
  readonly minM: number;
  readonly maxM: number;
  readonly samples: number;
}

export function bakeBody(core: OfCoreModule, id: BodyId, seedLo: number,
  seedHi: number, W: number, H: number): BakedBody {
  const body = PlanetBody.create(core, id, seedLo, seedHi);
  const oracle = new SurfaceOracle(core, body);
  const hs = new Float32Array(W * H);
  const bio = new Uint8Array(W * H);
  const rgba = new Uint8Array(W * H * 4);
  const palette = biomeColorArray();
  const dir = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < H; ++j) {
    const v = (j + 0.5) / H;
    for (let i = 0; i < W; ++i) {
      dirForUv((i + 0.5) / W, v, dir);
      const h = oracle.baseHeight(dir.x, dir.y, dir.z);
      hs[j * W + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      bio[j * W + i] = oracle.biomeAt(dir.x, dir.y, dir.z);
    }
  }
  // THE ALBEDO IS THE TERRAIN'S OWN RULE, NOT THE RAW BIOME COLOUR.
  //
  // `PlanetProxy` paints the palette straight, which is correct for a thing you
  // are standing on and see through the terrain material as well. A disc has no
  // terrain material behind it, so a raw classifier is ALL it gets, and a hard
  // ten-value classifier at 2.4 km per texel is what made Forge's coastlines
  // read as dithered speckle in the first telephoto frame: there is no value
  // between "ocean" and "plains" for the filter to interpolate through.
  //
  // `terrainAlbedo` is `TerrainShader`'s four lines (BiomePalette.ts says so and
  // says they must move together). It takes `flat` = dot(normal, up) and `band`
  // = relief / maxRelief, so it is CONTINUOUS in the height field: slope darkens
  // toward rock, altitude brightens, peaks take snow. That both antialiases the
  // classifier for free and makes the disc read as terrain rather than as a
  // biome map. It costs NO extra oracle calls: the gradient comes from the
  // height field already sampled above.
  const maxRelief = Math.max(1, body.maxReliefM);
  const duM0 = (2 * Math.PI * body.radiusM) / W;
  const dvM = (Math.PI * body.radiusM) / H;
  const col = new THREE.Color();
  for (let j = 0; j < H; ++j) {
    const phi = (1 - (j + 0.5) / H) * Math.PI;
    // du shrinks as cos(latitude); the clamp is one equatorial texel of arc, so
    // a polar row cannot report an infinite slope from a finite height step.
    const duM = Math.max(duM0 * Math.sin(phi), duM0 * 0.5);
    for (let i = 0; i < W; ++i) {
      const k = j * W + i;
      const iL = (i - 1 + W) % W, iR = (i + 1) % W;
      const jD = Math.max(0, j - 1), jU = Math.min(H - 1, j + 1);
      const dhdu = (hs[j * W + iR] - hs[j * W + iL]) / (2 * duM);
      const dhdv = (hs[jU * W + i] - hs[jD * W + i]) / ((jU - jD) * dvM);
      const flat = 1 / Math.sqrt(1 + dhdu * dhdu + dhdv * dhdv);
      terrainAlbedo(palette[bio[k]] ?? palette[2], flat, hs[k] / maxRelief, col);
      const o = k * 4;
      rgba[o] = Math.round(255 * Math.min(1, Math.max(0, col.r)));
      rgba[o + 1] = Math.round(255 * Math.min(1, Math.max(0, col.g)));
      rgba[o + 2] = Math.round(255 * Math.min(1, Math.max(0, col.b)));
      rgba[o + 3] = 255;
    }
  }
  // HALF FLOAT, not a packed hi/lo byte pair. A packed pair cannot be linearly
  // filtered: the low byte wraps at a texel boundary and the interpolation
  // spikes, so the only safe filter would be nearest, and nearest on a body
  // that fills the screen during an approach is visible blocking. WebGL2
  // filters half-float in core, so this costs nothing and no extension.
  const reliefM = Math.max(1, body.maxReliefM);
  const half = new Uint16Array(W * H);
  for (let k = 0; k < W * H; ++k) {
    half[k] = THREE.DataUtils.toHalfFloat(
      Math.min(1, Math.max(0, hs[k] / (2 * reliefM) + 0.5)));
  }
  const relief = new THREE.DataTexture(half, W, H, THREE.RedFormat,
    THREE.HalfFloatType);
  relief.minFilter = THREE.LinearFilter;
  relief.magFilter = THREE.LinearFilter;
  // Repeat in u and clamp in v: an equirect map is a cylinder, not a torus, and
  // wrapping v folds the north pole onto the south.
  relief.wrapS = THREE.RepeatWrapping;
  relief.wrapT = THREE.ClampToEdgeWrapping;
  relief.needsUpdate = true;
  const albedo = new THREE.DataTexture(rgba, W, H, THREE.RGBAFormat);
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.magFilter = THREE.LinearFilter;
  albedo.generateMipmaps = true;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.needsUpdate = true;
  body.dispose();
  return { relief, albedo, reliefM: 2 * reliefM, minM: lo, maxM: hi,
    samples: W * H * 2 };
}

/**
 * THE MEAN ALBEDO OF A WHOLE WORLD, from the world's own biome map.
 *
 * Planetshine needs the reflectance of the body doing the shining, and the
 * three ways to get one were: transcribe a number (D-018's exact prohibition,
 * and it would be a SECOND claim about what Forge is made of), ask /core (there
 * is no such export and inventing one is another domain's), or MEASURE the
 * surface that already exists. This is the third. A coarse grid is plenty:
 * the quantity is an average over the sphere, so the sampling error falls as
 * 1/sqrt(n) and 32 x 16 is under a millisecond of oracle.
 *
 * IT IS A NORMAL-INCIDENCE REFLECTANCE AND NOT A BOND ALBEDO, stated because
 * the difference matters if anyone later uses this for an energy budget: it
 * ignores the phase integral and the ocean's specular lobe, both of which move
 * a real Bond albedo by tens of per cent. For the purpose here, which is the
 * brightness of a planet in a moon's sky, it is the right order and it is
 * derived from this world rather than from Earth.
 */
export function meanAlbedo(core: OfCoreModule, id: BodyId, seedLo: number,
  seedHi: number, n = 32): THREE.Color {
  const body = PlanetBody.create(core, id, seedLo, seedHi);
  const oracle = new SurfaceOracle(core, body);
  const palette = biomeColorArray();
  const dir = new THREE.Vector3();
  const acc = new THREE.Color(0, 0, 0);
  const h = n >> 1;
  let w = 0;
  for (let j = 0; j < h; ++j) {
    const v = (j + 0.5) / h;
    // Equal-area weighting: an equirect grid over-samples the poles by sin(phi),
    // and an unweighted mean of a world with ice caps would be visibly wrong.
    const wt = Math.sin((1 - v) * Math.PI);
    for (let i = 0; i < n; ++i) {
      dirForUv((i + 0.5) / n, v, dir);
      const c = palette[oracle.biomeAt(dir.x, dir.y, dir.z)] ?? palette[2];
      acc.r += c.r * wt; acc.g += c.g * wt; acc.b += c.b * wt;
      w += wt;
    }
  }
  body.dispose();
  return w > 0 ? acc.multiplyScalar(1 / w) : new THREE.Color(0.3, 0.3, 0.3);
}

/**
 * THE ONE THING THE BAKE AND THE SHADER SHARE, MEASURED.
 *
 * The bake walks texels through `dirForUv`; the shader samples by the
 * geometry's own `uv` attribute. If those two parameterisations differ by a
 * mirror or a quarter turn the moon renders with its map rotated, and every
 * assertion in JS still passes: the texture is right, the sampling is right,
 * and the correspondence between them is wrong. Nothing else in the pipeline
 * can catch that, and a screenshot cannot either, because a rotated moon is a
 * completely plausible moon.
 *
 * This is that correspondence, checked at every vertex of the shipped geometry
 * against the position attribute THREE actually generated. Flip a sign in
 * `dirForUv` and it returns about 2.
 */
export function uvResidualOf(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const d = new THREE.Vector3();
  const q = new THREE.Vector3();
  let worst = 0;
  for (let i = 0; i < pos.count; ++i) {
    q.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const len = q.length();
    if (len < 1e-12) continue;
    q.multiplyScalar(1 / len);
    dirForUv(uv.getX(i), uv.getY(i), d);
    worst = Math.max(worst, d.distanceTo(q));
  }
  return worst;
}
