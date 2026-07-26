// ONE shared ShaderMaterial for every chunk in both scenes. Same program, same
// uniforms, so chunks batch trivially and the shader cache never thrashes; the
// far-scene variant is the same source with #define OF_SCALED, not a second
// material (ARCHITECTURE.md section 4.4).
//
// Per-chunk state is ZERO. Everything that varies per chunk arrives in the
// aBiome / aHeight / aFadeT0 attributes, which is what lets one material serve
// 250 meshes without a clone or a per-draw uniform push.
//
// The GLSL lives in TerrainShader.ts.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { biomeColorArray } from './BiomePalette.js';
import { terrainFragmentShader, terrainVertexShader } from './TerrainShader.js';
import { FAR_SCALE } from '../Scenes.js';

// ?side= overrides this for a one-off diagnosis; the committed default is what
// the winding actually needs (see SharedIndex).
const TERRAIN_SIDE = ((): THREE.Side => {
  const s = new URLSearchParams(self.location.search).get('side');
  if (s === 'double') return THREE.DoubleSide;
  if (s === 'back') return THREE.BackSide;
  return THREE.FrontSide;
})();

/**
 * Aerial-perspective sample counts. Far cheaper than the sky quad: the segment
 * is short and nearly iso-altitude, so 4 x 2 is already smooth.
 */
const AP_VIEW_STEPS = 4;
const AP_LIGHT_STEPS = 2;

export interface TerrainMaterialOptions {
  readonly depth: DepthPolicy;
  readonly maxReliefM: number;
  readonly atmosphere: AtmosphereUniforms;
  /** Cascade far planes in metres; the length is the cascade count. */
  readonly cascadeSplits: number[];
  readonly fadeSecs: number;
}

export interface TerrainMaterials {
  readonly near: THREE.ShaderMaterial;
  readonly far: THREE.ShaderMaterial;
  /** Push the per-frame globals. Per-chunk uniform state stays at zero. */
  update(bodyCenterEngine: THREE.Vector3, simTimeSecs: number): void;
  dispose(): void;
}

export function createTerrainMaterials(o: TerrainMaterialOptions): TerrainMaterials {
  const palette = biomeColorArray();
  const cascades = o.cascadeSplits.length;
  const splits = new THREE.Vector3(
    o.cascadeSplits[0] ?? 1, o.cascadeSplits[1] ?? 1, o.cascadeSplits[2] ?? 1,
  );

  const make = (scaled: boolean): THREE.ShaderMaterial => {
    // UniformsLib.lights is MANDATORY for a lights:true ShaderMaterial: three
    // writes ambientLightColor / directionalLights / directionalShadowMap
    // straight into material.uniforms and throws if the slots are missing.
    const uniforms: Record<string, THREE.IUniform> =
      THREE.UniformsUtils.merge([THREE.UniformsLib.lights]);
    // Assigned AFTER the merge on purpose: merge deep-clones, and the atmosphere
    // uniforms must stay the SAME OBJECTS the sky material holds. Sharing by
    // reference is what makes "the sky and the horizon agree" structural rather
    // than something someone has to remember to synchronise.
    Object.assign(uniforms, o.atmosphere, {
      uBodyCenter: { value: new THREE.Vector3(0, 0, 0) },
      uMaxRelief: { value: o.maxReliefM },
      uBiomeColor: { value: palette },
      uAmbient: { value: new THREE.Color(0.030, 0.034, 0.045) },
      uTime: { value: 0 },
      uFadeDur: { value: o.fadeSecs },
      uMetresPerUnit: { value: scaled ? 1 / FAR_SCALE : 1 },
      uCascadeFar: { value: splits },
      uSkyAmbient: { value: 0.32 },
    });
    const m = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: terrainVertexShader(o.depth),
      fragmentShader: terrainFragmentShader(o.depth),
      // HAS_NORMAL is NOT set here: WebGLProgram already emits it for any
      // material whose geometry has a normal attribute, and defining it twice is
      // a hard compile failure. shadowmap_vertex reads it to decide whether to
      // apply the normal bias, so it must come from three, not from us.
      defines: {
        OF_CASCADES: scaled ? 0 : cascades,
        OF_AP_VIEW: AP_VIEW_STEPS,
        OF_AP_LIGHT: AP_LIGHT_STEPS,
        ...(scaled ? { OF_SCALED: 1 } : {}),
      },
      lights: true,
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
    update(bodyCenterEngine, simTimeSecs) {
      (near.uniforms.uBodyCenter.value as THREE.Vector3).copy(bodyCenterEngine);
      // The far scene puts the body centre at the scaled origin, always.
      (far.uniforms.uBodyCenter.value as THREE.Vector3).set(0, 0, 0);
      near.uniforms.uTime.value = simTimeSecs;
      far.uniforms.uTime.value = simTimeSecs;
    },
    dispose() { near.dispose(); far.dispose(); },
  };
}
