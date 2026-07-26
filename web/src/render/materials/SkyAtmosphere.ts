// Pass-1 atmosphere: one full-sky box carrying the analytic scattering model.
//
// The sky camera never translates, so the box is a skybox and the fragment's
// object-space position IS the view ray. That removes every inverse-matrix
// uniform a full-screen-quad reconstruction would need, and the ray is exact
// because rasterization interpolates a planar face perspective-correctly.
//
// Depth test and write are off: pass 1 paints every pixel and everything after
// composites over it by clear order (ARCHITECTURE.md section 3.1).

import * as THREE from 'three';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import type { QualityTier } from '../../app/Config.js';

/** View / light ray-march sample counts per tier. Cost is viewSteps*lightSteps. */
const STEPS: Record<QualityTier, [number, number]> = {
  low: [6, 2],
  med: [8, 3],
  high: [10, 3],
};

export interface SkyAtmosphere {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Camera position in PLANET-CENTRED metres. */
  setCameraPos(x: number, y: number, z: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export function createSkyAtmosphere(
  atmos: AtmosphereUniforms, tier: QualityTier,
): SkyAtmosphere {
  const [viewSteps, lightSteps] = STEPS[tier];
  const uCamPosM = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmos, uCamPosM },
    defines: { OF_VIEW_STEPS: viewSteps, OF_LIGHT_STEPS: lightSteps },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${ATMOSPHERE_PARS}
      uniform vec3 uCamPosM;
      varying vec3 vDir;

      void main() {
        vec3 rd = normalize(vDir);
        vec3 trans;
        vec3 col = ofAtmoScatter(uCamPosM, rd, 1.0e9, OF_VIEW_STEPS, OF_LIGHT_STEPS, trans);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  material.name = 'SkyAtmosphere';

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), material);
  mesh.name = 'skyAtmosphere';
  mesh.frustumCulled = false;
  // Before the stars, so the stars composite additively on top and are washed
  // out by a bright sky exactly as section 7.3 promises.
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    setCameraPos(x, y, z) { uCamPosM.value.set(x, y, z); },
    setEnabled(on) { mesh.visible = on; },
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
