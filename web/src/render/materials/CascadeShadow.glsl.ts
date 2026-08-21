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
/**
 * RN-2306. `?shadowcast=0` STOPS THE SAMPLE AS WELL AS THE CAST, AND THAT IS
 * WHAT MAKES IT AN ISOLATOR RATHER THAN A GL ERROR.
 *
 * RN-1954 implemented the flag entirely in `ShadowRig`, by clearing
 * `light.castShadow`. That is a LIGHTS-STATE change and nothing else: no map
 * is rendered, so `light.shadow.map` stays null and three binds its default
 * 2-D texture into the `sampler2DShadow` array this function reads. On every
 * WALK pose the read is live (`vz` is inside the 300 m split), so the draw
 * takes `GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format
 * and sampler type (signed/unsigned/float/shadow)` -- 256 of them at `machine`
 * and at `meadow`, which `run.mjs` correctly fails. On every AERIAL pose the
 * read is already past the last split, so the same flag returned a
 * BYTE-IDENTICAL frame and looked like a passing control. One flag, two
 * behaviours, and neither of them is a measurement (WORLD-AUDIT-R2 section 4;
 * NUMBERS.md, "a control whose arming step silently fails is
 * indistinguishable from a passing control").
 *
 * The fix is a COMPILE-TIME guard rather than a uniform, and the reason is
 * this file's own splicing rule: `CASCADE_GLSL` is pasted into three
 * materials' pars (terrain, grass, water) that each build their own uniform
 * map, so a `uniform float` declared here would be declared in all three
 * programs and SET in none of them -- i.e. it would read 0 and switch the
 * shadows off in the shipped build. The flag is read once at boot and cannot
 * change, so a preprocessor constant is the honest shape for it, and it takes
 * the sampler out of the program entirely: an unused `sampler2DShadow` is not
 * in the active-uniform list, so there is nothing left for three to leave
 * unbound. `ShadowRig` still clears `castShadow` under the same flag, so
 * RN-1954's documented behaviour -- "the light simply stops writing and
 * sampling a depth map", the draw-call drop included -- is what now actually
 * happens.
 *
 * ABSENT IS THE SHIPPED IDENTITY, to the character: with no flag the
 * interpolations below are the empty string and this file emits exactly the
 * GLSL it emitted before, apart from the `NUM_DIR_LIGHT_SHADOWS` guard, which
 * is discussed at its own line.
 */
const SHADOW_SAMPLE_OFF =
  new URLSearchParams(self.location.search).get('shadowcast') === '0';
/** Folded into the `#if` below, so the whole lookup compiles out. */
const SAMPLE_GUARD = SHADOW_SAMPLE_OFF ? ' && 0' : '';

export const CASCADE_GLSL = /* glsl */`
  float ofCascadeShadow(float vz) {
    // NUM_DIR_LIGHT_SHADOWS IS PART OF THE GUARD, and it is the structural half
    // of RN-2306: three declares \`directionalShadowMap\` with exactly that many
    // slots, and this function indexes OF_CASCADES of them off a quality knob
    // that three has never heard of. Where the two agree (every shipped tier:
    // three casting cascades and three shadow slots, or one and one) the
    // condition is unchanged and the compiled program is the one that shipped.
    // Where they disagree -- any future state in which a cascade stops casting
    // while the material still thinks it can sample -- this returns 1.0
    // instead of reading a sampler three did not bind. An undefined
    // NUM_DIR_LIGHT_SHADOWS evaluates to 0 in the preprocessor, so a material
    // spliced without \`lights: true\` fails safe rather than failing to compile.
    #if defined(USE_SHADOWMAP) && !defined(OF_SCALED) && OF_CASCADES > 0 && NUM_DIR_LIGHT_SHADOWS >= OF_CASCADES${SAMPLE_GUARD}
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
