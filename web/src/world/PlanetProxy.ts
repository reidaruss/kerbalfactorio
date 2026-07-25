// The far-scene scaled proxy for a body. It sits just BELOW the lowest possible
// terrain (radius - maxRelief), so streamed coarse shells always win the depth
// test and the proxy only ever shows through gaps while the streamer converges.
// Two draw calls for a whole planet; the scaled-space seam is exercised from
// day one rather than retrofitted (ARCHITECTURE.md section 3.1).

import * as THREE from 'three';
import { FAR_SCALE } from '../render/Scenes.js';
import { biomeColorArray } from '../render/materials/BiomePalette.js';
import type { PlanetBody } from './PlanetBody.js';
import type { SurfaceOracle } from './SurfaceOracle.js';

export class PlanetProxy {
  readonly mesh: THREE.Mesh;
  /** Milliseconds spent sampling the oracle to colour the proxy. */
  readonly buildMs: number;
  readonly vertexCount: number;

  constructor(body: PlanetBody, oracle: SurfaceOracle, detail = 4) {
    const t0 = performance.now();
    const rProxy = (body.radiusM - body.maxReliefM * 1.05) * FAR_SCALE;
    const geo = new THREE.IcosahedronGeometry(rProxy, detail);
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const palette = biomeColorArray();
    for (let i = 0; i < n; ++i) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const b = oracle.biomeAt(x / len, y / len, z / len);
      const c = palette[b] ?? palette[2];
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.vertexCount = n;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: false,
    }));
    this.mesh.name = `${body.name}Proxy`;
    this.mesh.frustumCulled = true;
    this.buildMs = performance.now() - t0;
  }

  setVisible(v: boolean): void { this.mesh.visible = v; }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
