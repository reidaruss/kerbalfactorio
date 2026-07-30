// The cascade lookup, moved out of TerrainShader.ts at RN-78 purely for the
// 400-line cap (2.2 rule 1): the ground-texture term needed the room, and this
// block is the one piece of that file that is already an exported, self-
// contained authority. The GLSL text is UNCHANGED to the character, so every
// program that concatenates it compiles to what it compiled to before.
//
// TerrainShader.ts RE-EXPORTS this under its old name, so WaterShader's import
// (RN-52) still resolves and there is still exactly one authority on which
// cascade a view range belongs to. See the doc comment below for why a second
// copy of this selection must never exist.

/**
 * The cascade lookup, EXPORTED at RN-52 so the water surface shades itself from
 * the same three cascades the ground under it does. A second copy of this
 * selection would be a second authority on which cascade a range belongs to,
 * and the visible failure would be a pond whose glint stays lit inside a shadow
 * the shoreline is already in. It reads `uCascadeFar` and three's own shadow
 * uniforms, so any material using it needs `lights: true` and the shadowmap
 * chunks, exactly as the terrain material does.
 */
export const CASCADE_GLSL = /* glsl */`
  float ofCascadeShadow(float vz) {
    #if defined(USE_SHADOWMAP) && !defined(OF_SCALED) && OF_CASCADES > 0
      float s = 1.0;
      if (vz < uCascadeFar.x) {
        s = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize,
          directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias,
          directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
      }
      #if OF_CASCADES > 1
      else if (vz < uCascadeFar.y) {
        s = getShadow(directionalShadowMap[1], directionalLightShadows[1].shadowMapSize,
          directionalLightShadows[1].shadowIntensity, directionalLightShadows[1].shadowBias,
          directionalLightShadows[1].shadowRadius, vDirectionalShadowCoord[1]);
      }
      #endif
      #if OF_CASCADES > 2
      else if (vz < uCascadeFar.z) {
        s = getShadow(directionalShadowMap[2], directionalLightShadows[2].shadowMapSize,
          directionalLightShadows[2].shadowIntensity, directionalLightShadows[2].shadowBias,
          directionalLightShadows[2].shadowRadius, vDirectionalShadowCoord[2]);
      }
      #endif
      // Fade the last cascade out rather than ending it, or the shadow set
      // terminates on a hard arc that the eye reads instantly while walking.
      float last = uCascadeFar[OF_CASCADES - 1];
      return mix(s, 1.0, smoothstep(last * 0.82, last, vz));
    #else
      return 1.0;
    #endif
  }
`;
