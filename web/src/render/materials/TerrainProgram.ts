// PHASE 2 of createTerrainMaterials: turn the shared uniform state into ONE
// ShaderMaterial. Split out of TerrainMaterial.ts at RN-2050; the body below is
// the original lines 573-642 unchanged apart from a uniform two-space dedent.
//
// Called exactly twice, `scaled` false then true, and that is the whole
// near/far story: same program source, same shared uniform objects, one
// #define apart (ARCHITECTURE.md section 4.4).

import * as THREE from 'three';
import { TERRAIN_AMBIENT, TERRAIN_SKY_AMBIENT } from './TerrainAmbient.js';
import { terrainFragmentShader, terrainVertexShader } from './TerrainShader.js';
import { FAR_SCALE } from '../Scenes.js';
import { EMIT_UNIFORMS } from './EmissiveLight.js';
import type { TerrainMaterialOptions } from './TerrainMaterialTypes.js';
import type { TerrainUniformState } from './TerrainUniformState.js';

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

export function makeTerrainMaterial(
  o: TerrainMaterialOptions, s: TerrainUniformState, scaled: boolean,
): THREE.ShaderMaterial {
  const { palette, artAmp, groundTex, groundAmp, biomeMat, reliefTex,
    reliefAmp, biomeRelief, biomeGrainW, biomeTintW, specAmp, fineAmp,
    fineFreq, fineW, fineLum, reliefGrad, reliefGradUv, artFineM, reliefFineM,
    artCoarseM, midAmp, midM, reliefSwing, reliefCell, reliefCellNoise,
    horizonOcc, bounceLit, wetBand, wetDir, cascades, splits,
    splatAmp, splatFade, splatFarAmp, treeline, treelineTone, crownShade,
    phaseProbe, horizonAmp, horizonEco, horizonCell, horizonPlains, emitGround,
    massifAmp, massifM, massifFade,
    splatGrass, splatDirt, splatRock, splatCliff,
    splatScree, splatSnow } = s;
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
    // THE SHARED OBJECTS, not copies of the numbers. SkyAtmosphere's ground
    // shell holds these same two so the environment's lower hemisphere is
    // computed from the terrain's own ambient model (RN-64, TerrainAmbient.ts).
    uAmbient: { value: TERRAIN_AMBIENT },
    uTime: { value: 0 },
    uFadeDur: { value: o.fadeSecs },
    uMetresPerUnit: { value: scaled ? 1 / FAR_SCALE : 1 },
    uCascadeFar: { value: splits },
    uSkyAmbient: { value: TERRAIN_SKY_AMBIENT },
    uArtAmp: { value: artAmp },
    uGroundTex: groundTex,
    uGroundTexAmp: groundAmp,
    uGroundRelief: reliefTex,
    uGroundReliefAmp: reliefAmp,
    uBiomeMat: { value: biomeMat },
    uBiomeRelief: { value: biomeRelief },
    uBiomeGrain: { value: biomeGrainW },
    uBiomeTint: { value: biomeTintW },
    uWetBand: { value: wetBand },
    uWetDir: { value: wetDir },
    uSpecAmp: { value: specAmp },
    uFineAmp: { value: fineAmp },
    uFineFreq: { value: fineFreq },
    uFineW: { value: fineW },
    uFineLum: fineLum,
    uReliefGrad: reliefGrad,
    uReliefGradUv: reliefGradUv,
    uArtFineM: artFineM,
    uReliefFineM: reliefFineM,
    uArtCoarseM: artCoarseM,
    uMidAmp: { value: midAmp },
    uMidM: { value: midM },
    uReliefSwing: reliefSwing,
    uReliefCell: reliefCell,
    uReliefCellNoise: reliefCellNoise,
    uHorizonOcc: horizonOcc,
    uBounceLit: bounceLit,
    // RN-2160. The splat. The two vectors are wrapped; the six samplers are
    // passed THROUGH as the shared holders, exactly as uGroundTex is, so a map
    // that finishes loading after the material is built reaches the near
    // material and the far one in one assignment.
    //
    // The samplers are declared and bound for BOTH materials even though every
    // consumer of them is inside `#ifndef OF_SCALED`. That is the established
    // pattern in this file (uGroundRelief does the same) and it is free: three
    // drops an unused uniform at link time, so the scaled program does not
    // spend a texture unit on a layer it cannot reach.
    uSplatAmp: { value: splatAmp },
    uSplatFade: { value: splatFade },
    // RN-2195. Already an IUniform holder (a scalar, on groundAmp/reliefAmp's
    // own pattern rather than splatAmp's vector one), so passed through
    // rather than re-wrapped.
    uSplatFarAmp: splatFarAmp,
    // RN-2265. The far treeline: (amp, mottle, realised ground reach) and the
    // canopy card's own mean rendered albedo. Both shared by reference.
    uTreeline: treeline,
    uTreelineTone: treelineTone,
    // RN-2275. Inter-crown self-shadowing, (amp, K, floor). Shared by
    // reference like every other holder here, and holding the SAME three
    // numbers the canopy card's per-frame colour update reads.
    uCrownShade: crownShade,
    // WG-230. The world-locked phase probe, (amplitude, checker repeats),
    // already an IUniform holder, so passed through rather than re-wrapped.
    uPhaseProbe: phaseProbe,
    // RN-2340. The far ground's four amplitudes and the biome-boundary break.
    // Already IUniform holders, so passed through rather than re-wrapped, which
    // is what makes the runtime handle and both materials one object.
    uHorizonAmp: horizonAmp,
    uHorizonEco: horizonEco,
    uHorizonCell: horizonCell,
    uHorizonPlains: horizonPlains,
    uMassifAmp: massifAmp,
    uMassifM: massifM,
    uMassifFade: massifFade,
    uSplatGrass: splatGrass,
    uSplatDirt: splatDirt,
    uSplatRock: splatRock,
    uSplatCliff: splatCliff,
    uSplatScree: splatScree,
    uSplatSnow: splatSnow,
  });
  // RN-2422. THE EMISSIVE IRRADIANCE BUNDLE, the four holders EmissiveLight
  // writes every frame, taken BY REFERENCE for the atmosphere's own reason
  // twenty lines up: the ground and the machine beside it must be lit by one
  // set of emitters, and sharing the objects is what makes that structural.
  // Assigned to BOTH programs: the scaled one compiles the term out, so its
  // uniforms are stripped by the compiler and these entries go nowhere, which
  // is cheaper than a second uniform table that could disagree.
  Object.assign(uniforms, EMIT_UNIFORMS);
  uniforms.uEmitGround = emitGround;
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
}
