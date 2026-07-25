// ONE shared ShaderMaterial for every chunk in both scenes. Same program, same
// uniforms, so chunks batch trivially and the shader cache never thrashes; the
// far-scene variant is the same source with #define OF_SCALED, not a second
// material (ARCHITECTURE.md section 4.4).
//
// Per-chunk state is ZERO. Everything that varies per vertex arrives in the
// aBiome / aHeight attributes /core already fills.
//
// W1 shades from the biome palette. The 8-layer KTX2 array texture, triplanar
// slopes and in-material aerial perspective land at W3/W4.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import { BIOME_COUNT, biomeColorArray } from './BiomePalette.js';

// ?side= overrides this for a one-off diagnosis; the committed default is what
// the winding actually needs (see SharedIndex).
const TERRAIN_SIDE = ((): THREE.Side => {
  const s = new URLSearchParams(self.location.search).get('side');
  if (s === 'double') return THREE.DoubleSide;
  if (s === 'back') return THREE.BackSide;
  return THREE.FrontSide;
})();

export interface TerrainUniforms {
  uSunDir: { value: THREE.Vector3 };
  uBodyCenter: { value: THREE.Vector3 };
  uMaxRelief: { value: number };
  uBiomeColor: { value: THREE.Color[] };
  uAmbient: { value: THREE.Color };
}

function vertexShader(depth: DepthPolicy): string {
  return /* glsl */`
    ${depth.vertexPars}
    attribute vec4 aBiome;
    attribute float aHeight;
    uniform vec3 uBiomeColor[${BIOME_COUNT}];
    varying vec3 vBiomeColor;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;
    void main() {
      // aBiome.x is the /core Biome enum as an unnormalized uint8.
      int bi = int(aBiome.x + 0.5);
      vBiomeColor = uBiomeColor[bi];
      // Chunk meshes are translated and uniformly scaled only, so the model
      // matrix's upper 3x3 preserves direction after a normalize.
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vRelief = aHeight;
      gl_Position = projectionMatrix * viewMatrix * world;
      ${depth.vertexBody}
    }
  `;
}

function fragmentShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.fragmentPars}
    // NOTE: do NOT include <tonemapping_pars_fragment> or
    // <colorspace_pars_fragment> here. WebGLProgram already injects both into
    // every ShaderMaterial's fragment prefix whenever toneMapping and
    // outputColorSpace are set, and including them again is a hard compile
    // failure ("function already has a body"). Only the BODY chunks belong here.
    uniform vec3 uSunDir;
    uniform vec3 uBodyCenter;
    uniform float uMaxRelief;
    uniform vec3 uAmbient;
    varying vec3 vBiomeColor;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;

    void main() {
      ${depth.fragmentBody}
      vec3 n = normalize(vNormalW);
      vec3 up = normalize(vWorld - uBodyCenter);
      float flat_ = clamp(dot(n, up), 0.0, 1.0);

      // Steep ground shows rock rather than the biome's surface cover. This is
      // the cheap stand-in for the triplanar slope blend arriving at W4.
      vec3 rock = vec3(0.30, 0.28, 0.26);
      vec3 albedo = mix(rock, vBiomeColor, smoothstep(0.55, 0.88, flat_));

      // /core's maxRelief is a nominal 6,000 m on Forge but baseHeight peaks
      // above it (6,520 m measured), so the snowline is expressed past 1.0
      // rather than clamped, and it never reaches pure white.
      float band = vRelief / max(1.0, uMaxRelief);
      float snow = smoothstep(0.86, 1.14, band) * smoothstep(0.45, 0.85, flat_) * 0.9;
      albedo = mix(albedo, vec3(0.88, 0.92, 0.98), snow);
      // A little value variation with height keeps large flat areas readable.
      albedo *= 0.82 + 0.26 * smoothstep(0.0, 0.7, band);

      vec3 sd = normalize(uSunDir);
      float ndl = max(dot(n, sd), 0.0);
      float wrap = max(dot(n, sd) * 0.5 + 0.5, 0.0);
      vec3 lit = albedo * (uAmbient + vec3(0.92) * ndl + vec3(0.12) * wrap * wrap);

      gl_FragColor = vec4(lit, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}

export interface TerrainMaterials {
  readonly near: THREE.ShaderMaterial;
  readonly far: THREE.ShaderMaterial;
  /** Push the per-frame globals. Per-chunk uniform state stays at zero. */
  update(sunDir: THREE.Vector3, bodyCenterEngine: THREE.Vector3): void;
  dispose(): void;
}

export function createTerrainMaterials(depth: DepthPolicy, maxReliefM: number): TerrainMaterials {
  const palette = biomeColorArray();
  const make = (scaled: boolean): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0.4, 0).normalize() },
        uBodyCenter: { value: new THREE.Vector3(0, 0, 0) },
        uMaxRelief: { value: maxReliefM },
        uBiomeColor: { value: palette },
        uAmbient: { value: new THREE.Color(0.085, 0.095, 0.12) },
      },
      vertexShader: vertexShader(depth),
      fragmentShader: fragmentShader(depth),
      defines: scaled ? { OF_SCALED: '1' } : {},
      side: TERRAIN_SIDE,
    });
    m.name = scaled ? 'TerrainMaterial(scaled)' : 'TerrainMaterial';
    return m;
  };
  const near = make(false);
  const far = make(true);
  return {
    near,
    far,
    update(sunDir, bodyCenterEngine) {
      (near.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
      (near.uniforms.uBodyCenter.value as THREE.Vector3).copy(bodyCenterEngine);
      (far.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
      // The far scene puts the body centre at the scaled origin, always.
      (far.uniforms.uBodyCenter.value as THREE.Vector3).set(0, 0, 0);
    },
    dispose() { near.dispose(); far.dispose(); },
  };
}
