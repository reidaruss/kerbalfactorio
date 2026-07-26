// The star field: 4,000 THREE.Points on the unit sphere, generated from the
// world seed so a golden image is reproducible (ARCHITECTURE.md section 7.4).
//
// The regime split is handled by ONE uniform. Stars are drawn additively AFTER
// the atmosphere, and uStarFade attenuates them by how much lit air is between
// the eye and space. On the surface at noon that is ~1 and the stars vanish; in
// orbit it is 0 and they are at full brightness; at the terminator they emerge
// as the sky darkens. Nothing switches, so there is no regime seam to get wrong.

import * as THREE from 'three';

const STAR_COUNT = 4000;
/** Just inside skyCam.far (10). */
const SHELL = 8;

/** xorshift32, so the star field is reproducible from ?seed=. */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export interface Starfield {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  /** 0 = full brightness (space or night), 1 = washed out by a lit sky. */
  setDaylight(d: number): void;
  dispose(): void;
}

export function createStarfield(seedLo: number, pixelRatio: number): Starfield {
  const rand = rng(seedLo ^ 0x5bd1e995);
  const pos = new Float32Array(STAR_COUNT * 3);
  const col = new Float32Array(STAR_COUNT * 3);
  const size = new Float32Array(STAR_COUNT);
  const c = new THREE.Color();
  for (let i = 0; i < STAR_COUNT; ++i) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    pos[i * 3] = r * Math.cos(th) * SHELL;
    pos[i * 3 + 1] = u * SHELL;
    pos[i * 3 + 2] = r * Math.sin(th) * SHELL;
    // Magnitude drives both size and brightness; temperature drives a crude
    // blackbody ramp from amber through white to blue.
    const mag = Math.pow(rand(), 2.4);
    const temp = rand();
    c.setRGB(0.62 + (1 - temp) * 0.38, 0.72 + 0.16 * (1 - Math.abs(temp - 0.5) * 2), 0.80 + temp * 0.20);
    c.multiplyScalar(0.22 + mag * 1.05);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = 1.1 + mag * 2.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const uStarFade = { value: 1.0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uStarFade, uPixelRatio: { value: pixelRatio } },
    vertexShader: /* glsl */`
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      uniform float uStarFade;
      varying vec3 vColor;
      void main() {
        // A soft disc rather than a square: gl_PointCoord is the sprite UV.
        float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float a = smoothstep(1.0, 0.15, d);
        gl_FragColor = vec4(vColor * a * uStarFade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = 'StarfieldMaterial';

  const points = new THREE.Points(geo, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  points.renderOrder = 1;

  return {
    points,
    material,
    setDaylight(d) { uStarFade.value = Math.max(0, 1 - d); },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
