// Pass 1 contents: the star field and the sun disc. Rotation-only camera, depth
// test and write off, so this paints every pixel and everything after composites
// over it by clear order. Analytic atmospheric scattering lands here at W3.

import * as THREE from 'three';

/** xorshift32, so the star field is reproducible from ?seed= (section 11.3). */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const STAR_COUNT = 4000;

export class SkyPass {
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(1, 0.3, 0).normalize();
  private readonly sunSprite: THREE.Sprite;

  constructor(seedLo: number, sunT: number) {
    const rand = rng(seedLo ^ 0x5bd1e995);
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < STAR_COUNT; ++i) {
      // Uniform on the sphere, then pushed out to just inside skyCam.far.
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      pos[i * 3] = r * Math.cos(th) * 8;
      pos[i * 3 + 1] = u * 8;
      pos[i * 3 + 2] = r * Math.sin(th) * 8;
      // Crude blackbody ramp: most stars dim and white, a few blue or amber.
      const mag = Math.pow(rand(), 2.2);
      const temp = rand();
      c.setRGB(0.65 + temp * 0.35, 0.72 + temp * 0.18, 0.85 + (1 - temp) * 0.15);
      c.multiplyScalar(0.25 + mag * 0.95);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.6, sizeAttenuation: false, vertexColors: true,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.AdditiveBlending,
    }));
    stars.name = 'starfield';
    stars.frustumCulled = false;
    this.group.add(stars);

    const sunTex = SkyPass.discTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, color: 0xfff3d6, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: false,
    }));
    this.sunSprite.scale.set(0.09, 0.09, 1);
    this.sunSprite.renderOrder = 1;
    this.group.add(this.sunSprite);

    this.group.name = 'skyPass';
    this.setSunT(sunT);
  }

  /** Sun angle in turns, [0,1). Deterministic: __of.setTime() drives this. */
  setSunT(t: number): void {
    const a = t * Math.PI * 2;
    this.sunDirection.set(Math.cos(a), 0.42, Math.sin(a)).normalize();
    this.sunSprite.position.copy(this.sunDirection).multiplyScalar(7);
  }

  private static discTexture(): THREE.Texture {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; ++y) {
      for (let x = 0; x < N; ++x) {
        const dx = (x + 0.5) / N - 0.5;
        const dy = (y + 0.5) / N - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const a = Math.max(0, 1 - d);
        const v = Math.round(255 * Math.min(1, a * a * 3));
        const i = (y * N + x) * 4;
        data[i] = 255; data[i + 1] = 250; data[i + 2] = 235; data[i + 3] = v;
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
}
