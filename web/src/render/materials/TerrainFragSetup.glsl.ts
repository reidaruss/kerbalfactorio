// The terrain fragment shader's FRAME SETUP, the first statements of main():
// the depth policy's fragment body, the dithered stream-in cross-fade, the
// planet-centred position and view ray, the geometric normal, the hoisted pixel
// footprint, the surface-art weights, the rock/cover selection and the macro
// colour variation.
//
// It ends where the ground TEXTURE begins, which is the first of the three big
// `#ifndef OF_SCALED` blocks. Split out of TerrainShader.ts at RN-2051, GLSL
// unchanged to the character; a FUNCTION rather than a const because the depth
// policy's fragment body interpolates on its first line.

import type { DepthPolicy } from '../DepthPolicy.js';

export function terrainFragSetup(depth: DepthPolicy): string {
  return /* glsl */`
      ${depth.fragmentBody}
      // Stream-in cross-fade. Dithered rather than blended: it stays opaque, it
      // needs no sorting, and the two halves use COMPLEMENTARY thresholds, so
      // every pixel is covered by exactly one of the outgoing and incoming
      // chunks and they never z-fight against each other mid-dissolve.
      if (vFade < 1.0) {
        float b = ofBayer4(gl_FragCoord.xy);
        if (vFade < 0.0) { if (-vFade - 1.0 >= b) discard; }
        else if (vFade < b) discard;
      }

      // Everything below is in PLANET-CENTRED METRES, which is the one frame the
      // shared atmosphere model speaks. uMetresPerUnit is 1 in the near scene
      // and 1e5 in the scaled far scene, and that is the ONLY difference.
      //
      // Hoisted above the albedo block at RN-45: the surface-art field is keyed
      // on pM because pM is the only position here that survives a floating
      // origin rebase, so the albedo now needs it. See TerrainArt.glsl.
      vec3 pM = (vWorld - uBodyCenter) * uMetresPerUnit;
      vec3 camM = (cameraPosition - uBodyCenter) * uMetresPerUnit;
      vec3 toCam = pM - camM;
      float dist = max(length(toCam), 1.0);
      vec3 rd = toCam / dist;

      vec3 n = normalize(vNormalW);
      vec3 up = normalize(vWorld - uBodyCenter);
      // The GEOMETRIC normal, deliberately. flat_ selects rock against surface
      // cover and gates the snow band, and both are questions about the actual
      // slope of the ground. Feeding them the bumped normal below would let a
      // 4 m ripple decide whether a hillside is rock, which is a feedback loop
      // and reads as noise in the biome blend rather than as relief.
      float flat_ = clamp(dot(n, up), 0.0, 1.0);

      // RN-1900. THE PIXEL FOOTPRINT, HOISTED, and hoisted for a correctness
      // reason rather than to save two instructions. Three terms below fade on
      // it and each used to compute it for itself inside its own branch; those
      // branches are all bare-uniform ones today, so all three are legal, but
      // the mid-field layer's own gate is NOT a uniform (it is the fade itself)
      // and a dFdx inside non-uniform control flow is undefined by the rule
      // RN-78 paid a full hunt for the sampled half of. Computed once here, in
      // control flow that is uniform by construction, it is defined for every
      // consumer and there is one authority for "how big is a pixel of ground"
      // instead of three copies of one expression.
      //
      // It is the same quantity ofArtBumpG reads: max(|dFdx(pos)|,|dFdy(pos)|)
      // in world metres. At a grazing pose the dFdy arm binds and grows as the
      // SQUARE of the range, which is why every fade in this material is keyed
      // on it and not on dist.
      float footM = max(length(dFdx(vWorld)), length(dFdy(vWorld)));

      // SURFACE ART (RN-45). Compiled out of the scaled far scene entirely, and
      // faded to nothing well inside the near scene's own reach; both reasons
      // are in TerrainArt.glsl's header and they are not the same reason.
      float macroW = 0.0, bumpW = 0.0, strataW = 0.0;
      float hArt = 0.0;
      #ifndef OF_SCALED
        // 600 m to 4 km: complete by 4 km against a ~15 km handover to the far
        // scene, so the same ridge cannot be modulated on one side of the
        // handover and flat on the other.
        macroW = uArtAmp.x * (1.0 - smoothstep(600.0, 4000.0, dist));
        // NO DISTANCE FADE ON THE BUMP. It is faded on the PIXEL FOOTPRINT
        // inside ofArtBump instead, because range is not what aliases a bump
        // and a distance fade let a field of moire arcs through at five metres.
        // See TerrainArt.glsl's note on that function.
        bumpW = uArtAmp.y;
        // 500 m to 2.5 km. A 2.35 m bed subtends about 3 px at 1 km on this
        // viewport and field of view, which is where a band starts to alias.
        strataW = uArtAmp.z * (1.0 - smoothstep(500.0, 2500.0, dist));
        if (macroW > 0.0) hArt = ofArtMacro(pM);
      #endif

      // Steep ground shows rock rather than the biome's surface cover. This is
      // the cheap stand-in for the triplanar slope blend arriving at W4.
      //
      // The rock term was a flat vec3 and it is what every cliff, ravine
      // wall and crater rim on the planet is drawn with, so it is where the
      // bedding goes. vRelief is metres above the datum, which is exactly the
      // altitude a bed is a function of.
      vec3 rock = ofArtStrata(vec3(0.30, 0.28, 0.26), vRelief, pM, strataW);
      float coverSel = smoothstep(0.55, 0.88, flat_);
      vec3 albedo = mix(rock, vBiomeColor, coverSel);

      // MACRO VARIATION. Two effects off one field, because they answer two
      // different halves of "flat colour": the tint moves the ground between a
      // lush and a dry reading, which is what varies between hillsides, and the
      // value moves it light to dark, which is what varies within one. Applied
      // AFTER the rock blend so a cliff face is varied too, and BEFORE snow so
      // a snowfield stays clean.
      // THE TWO TINTS ARE RECIPROCAL ABOUT 1.0 PER CHANNEL, and that is a
      // correction rather than a preference. The first pair shipped as
      // (0.86, 1.00, 0.90) and (1.12, 1.03, 0.84), whose per-channel MEAN is
      // (0.99, 1.015, 0.87). A mean blue of 0.87 is a 13% net blue reduction
      // applied to the whole planet, i.e. a colour grade wearing a variation
      // layer's clothes, and the probe caught it as a 5.03% drop in the mid
      // band's LEVEL while its spread rose. A variation term must move the
      // spread and leave the level alone; these two now average (1.00, 1.01,
      // 1.00) and it reads as -1.1%, which is the macro field's own asymmetry.
      if (macroW > 0.0) {
        vec3 tint = mix(vec3(0.90, 1.00, 1.10), vec3(1.10, 1.02, 0.90),
                        hArt * 0.5 + 0.5);
        albedo *= mix(vec3(1.0), tint, macroW);
        albedo *= 1.0 + macroW * 0.40 * hArt;
      }

      // WG-230. THE WORLD-LOCKED PHASE PROBE, and the reason a coordinate-only
      // lane paints anything at all.
      //
      // uPhaseProbe.x ships at 0, so this multiplies albedo by exactly 1.0 (0.0
      // times a bounded finite value is 0.0 in IEEE-754, and ofPhaseProbe is
      // bounded by construction), i.e. the committed frame is bit-identical.
      // What it buys is that the attribute is READ, so aPhase is bound rather
      // than link-stripped, and ?phaseamp=1 photographs the whole wire --
      // float64 reduction, per-chunk stamp, attribute, varying -- in one frame.
      // A declaration nothing reads proves none of that, and RN-2268's scar is
      // exactly the failure where the publish never fires and every counter
      // still reads correct.
      //
      // It sits here rather than in the albedo or splat block because those are
      // the far-ground lane's to edit and this is a seam, not a term.
      albedo *= 1.0 + uPhaseProbe.x * ofPhaseProbe();
`;
}
