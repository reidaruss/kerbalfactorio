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
//
// RN-2050. This file is the BARREL and the four-phase orchestrator. The phases
// run in exactly the order their bodies ran in before the split:
//   1. TerrainUniformState.ts  build every shared uniform holder, once
//   2. TerrainProgram.ts       make(false), then make(true)
//   3. TerrainArtHandle.ts     install window.__ofTerrainArt over that state
//   4. the returned handle     update() / dispose()
// The query parsers those phases read live in TerrainAmpQuery.ts (how strong
// each art term is) and TerrainReliefQuery.ts (the relief geometry controls);
// the three published shapes live in TerrainMaterialTypes.ts. Every public
// symbol this file used to export is re-exported below, so no import site
// outside this directory changed.

import type * as THREE from 'three';
import { installTerrainArtHandle } from './TerrainArtHandle.js';
import { makeTerrainMaterial } from './TerrainProgram.js';
import { buildTerrainUniformState } from './TerrainUniformState.js';
import type { TerrainMaterialOptions, TerrainMaterials }
  from './TerrainMaterialTypes.js';

export type { TerrainMaterialOptions, TerrainMaterials, TerrainWaterBand }
  from './TerrainMaterialTypes.js';

export function createTerrainMaterials(o: TerrainMaterialOptions): TerrainMaterials {
  const s = buildTerrainUniformState(o);
  const near = makeTerrainMaterial(o, s, false);
  const far = makeTerrainMaterial(o, s, true);
  installTerrainArtHandle(s);
  const { groundTex } = s;
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
    setTreelineReach(reachM) { s.treeline.value.z = reachM; },
    dispose() { near.dispose(); far.dispose(); groundTex.value.dispose(); },
  };
}
