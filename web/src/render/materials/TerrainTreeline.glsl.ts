// RN-2266. THE FAR TREELINE, GLSL half. Pairs with TerrainTreeline.ts on
// TerrainCoverFar / TerrainSplat's own precedent: the TS file holds the
// constants, the derivations and the proofs, this file holds the shader and
// nothing else. Every number below is interpolated from an exported constant
// in that file, so there is no second copy of any of them.

import {
  TREE_CROWN_M, TREE_EDGE_W, TREE_MOTTLE, TREE_NEAR_M, TREE_SIN_MIN,
} from './TerrainTreeline.js';
// RN-2275. The self-shadow law travels WITH the term that consumes it, on this
// file's own precedent: one authority, in TypeScript, emitting its own GLSL.
// RN-2525 adds the spectral split beside it, same precedent, same file.
import { CROWN_SELF_GLSL, CROWN_SPECTRAL_GLSL } from './CanopySelfShadow.js';

export const TERRAIN_TREELINE_PARS = /* glsl */`
  ${CROWN_SELF_GLSL}
  ${CROWN_SPECTRAL_GLSL}
  #define OF_TREE_NEAR_M ${TREE_NEAR_M.toFixed(1)}
  #define OF_TREE_EDGE_W ${TREE_EDGE_W.toFixed(5)}
  #define OF_TREE_CROWN_M ${TREE_CROWN_M.toFixed(2)}
  #define OF_TREE_MOTTLE ${TREE_MOTTLE.toFixed(4)}
  #define OF_TREE_SIN_MIN ${TREE_SIN_MIN.toFixed(5)}

  // THE INSTANCE TIER'S OWN DENSITY WEIGHT, MIRRORED, and the mirror is proved
  // rather than asserted: TerrainTreeline.assertTreelineMatchesScatter() calls
  // the live ScatterTuning.canopyDistanceWeight at module load across the whole
  // band and THROWS if this expression disagrees.
  //
  // Below OF_TREE_NEAR_M (CANOPY_NEAR_FULL_M, 690 m) it returns 1, which makes
  // the MATERIAL term identically zero there. That is the harvest ring's ground
  // and TreeField owns it: every tree a player can reach is a node they can
  // chop (RN-2228), and painting canopy over it would be a lie the player can
  // walk into. It is also what keeps every walk pose bit-identical.
  float ofTreeInstanceW(float g, float reach) {
    if (g < OF_TREE_NEAR_M) return 1.0;
    if (g >= reach) return 0.0;
    float t = min(1.0, (g - OF_TREE_NEAR_M) / max(1.0, reach - OF_TREE_NEAR_M));
    return 1.0 + (OF_TREE_EDGE_W - 1.0) * t;
  }

  // BEER-LAMBERT ON THE CANOPY THE INSTANCE TIER DID NOT PLACE, and this one
  // expression is the whole mechanism: it is what makes a horizon read as
  // forest rather than as a green tint, AND it is the handover.
  //
  // mu is crown PLAN area per unit ground area (the canopy area index; see
  // ChunkCanopy.BIOME_CANOPY_MU) and w is the instance tier's own density
  // weight at this ground distance. For randomly placed crowns the
  // transmittance of a canopy layer along a ray at depression sinDep is
  // exp(-mu / sinDep), so:
  //   the FULL canopy would cover      1 - exp(-mu / s)
  //   the instances at weight w cover  1 - exp(-mu w / s)
  // and the terrain, which is drawn BEHIND the cards, has to supply the rest of
  // the ground the full canopy would have hidden. As a fraction of the ground
  // the instances left visible that is exactly
  //   (Cfull - Cinst) / (1 - Cinst) = 1 - exp(-mu (1 - w) / s)
  // i.e. the same law on the density the instances are MISSING. Two properties
  // fall out and neither is tuned: at w = 1 (just past the harvest ring) it is
  // identically zero, and at w = 0 (past the realised reach) it is the full
  // canopy. The 0.16 -> 0 step canopyDistanceWeight takes at the reach is
  // cancelled to the digit by this term's own step in the other direction,
  // because both are the same exponential of the same product.
  //
  // The angle is why a 32 per cent area index at Hills reads as 26 per cent
  // cover at three kilometres and as a closed wall at twenty: a wood seen
  // edge-on is solid however open it is in plan. Nothing is scaled to make
  // that happen; it is 1/sinDep.
  //
  // OF_TREE_SIN_MIN floors the depression so the exponent cannot blow up on a
  // ray that is exactly tangent; see TerrainTreeline.ts for the value's reason.
  float ofTreeCover(float mu, float w, float sinDep) {
    return 1.0 - exp(-mu * (1.0 - w) / max(sinDep, OF_TREE_SIN_MIN));
  }

  // RN-2560. THE STAGE PAINT, and it is a categorical map rather than a level:
  // the question it answers is "how far into this term did this fragment get",
  // which has five discrete answers and no in-between. Every colour is under
  // 0.25 because the shipped grade is an ACES fit that compresses the top of
  // the range to nine counts (NUMBERS.md, RN-2479), and they are separated by
  // HUE rather than by level so the lighting multiply cannot merge two rungs.
  //
  //   0 RED    the SCALED program drew this fragment, so the whole term is
  //            compiled out of it by the #ifndef OF_SCALED below
  //   1 BLUE   near program, the outer gate refused: amp 0, reach 0 (the
  //            canopy tier is not running) or vCanopy 0 (no canopy biome, or
  //            past the treeline altitude)
  //   2 AMBER  gate passed and treeW == 1, i.e. inside OF_TREE_NEAR_M: the
  //            harvest ring, where the term is zero BY DESIGN
  //   3 GREEN  Beer-Lambert evaluated and returned effectively nothing
  //   4 WHITE  evaluated and contributing: the term is LIVE here
  vec3 ofTreelineStagePaint(float s) {
    if (s < 0.5) return vec3(0.20, 0.00, 0.00);
    if (s < 1.5) return vec3(0.00, 0.00, 0.20);
    if (s < 2.5) return vec3(0.20, 0.20, 0.00);
    if (s < 3.5) return vec3(0.00, 0.20, 0.00);
    return vec3(0.20, 0.20, 0.20);
  }
`;

/**
 * The term itself, spliced into TERRAIN_FRAG_ALBEDO. It lives here and not
 * there for the 400-code-line cap (ARCHITECTURE 2.2 rule 1, which counts GLSL
 * comment lines inside a template literal as code), on TerrainSplat.glsl's own
 * precedent: the shader half of a term lives beside the term's other half.
 */
export const TERRAIN_TREELINE_BLOCK = /* glsl */`
      // RN-2265. THE FAR TREELINE. Past the canopy impostor tier's realised
      // reach the ground has to keep being a landscape, and from 1,200 m that
      // is 91 per cent of the frame: the reach is 3,500 m and the horizon is
      // 37,947 m. The whole argument, the refused fourth impostor tier and the
      // handover's derivation are in TerrainTreeline.ts.
      //
      // WHERE IT SITS IN THE ORDER, and it is not arbitrary. BEFORE the
      // snowline and the relief ramp, so a distant wood takes the same
      // altitude ramp the ground it stands on takes and cannot read brighter
      // than its own hillside; and inside the albedo block, so the aerial
      // perspective in TERRAIN_FRAG_LIGHT hazes it exactly as it hazes the
      // ground -- which is RN-2232's whole finding about the instance tier,
      // arriving free here because this is an albedo and not an overlay.
      //
      // NOT A BARE-UNIFORM BRANCH, and that is legal HERE and nowhere else in
      // this file: nothing inside samples a texture and nothing inside takes a
      // derivative (footM is the hoisted one from the setup chunk, computed in
      // control flow that is uniform by construction). That is the exact
      // condition RN-78 and RN-1733 had to hoist their own work out of, and it
      // is met rather than assumed. ofArtMid's own header makes the same
      // argument for the same reason.
      // RN-2560. THE STAGE, declared OUTSIDE the guard on purpose: 0 is "the
      // scaled program drew me", and only a variable that exists in both
      // programs can carry that answer. It is written by the branches below
      // and read by exactly one bare-uniform line at the end of this block, so
      // in the shipped frame (uTreelinePaint 0) nothing reads it at all.
      float treeStage = 0.0;
      float treeKOut = 0.0;
      // RN-2560. THE SCALED SHELL'S PARTICIPATION, and this is where a
      // #ifndef OF_SCALED used to sit with no reason written beside it.
      //
      // WHAT THE PAINT FOUND. The term's own charter is the ground past the
      // impostor tier, and the near program stops at the ~15 km chunk-depth
      // handover, so the band from there to the 37,947 m horizon is drawn by
      // the SCALED program and the compile-time guard removed the term from
      // exactly that band. Measured with ?treelinepaint=3 (stage 0): 1.46
      // per cent of the terrain pixels at forestair, 0.74 at flyover.
      //
      // IT IS A UNIFORM AND NOT A DEFINE, so the pair is one flag inside one
      // build on one program set (RN-843/RN-1000's rule). It DEFAULTS OFF,
      // which is the pre-RN-2560 frame exactly, because turning it on makes a
      // term newly live on a band nothing has ever measured and that is a
      // visual lane rather than a diagnosis. ?treelinefar=1 is the priced
      // arm; rendering.md 2.36 carries what it costs.
      #ifdef OF_SCALED
        float treeShell = uTreelineFar;
      #else
        float treeShell = 1.0;
      #endif
      if (treeShell > 0.0) {
        treeStage = 1.0;
        if (uTreeline.x > 0.0 && uTreeline.z > 0.0 && vCanopy > 0.0) {
          treeStage = 2.0;
          // GROUND distance, the frame canopyDistanceWeight is written in.
          // RN-2228 is the scar: a 3-D eye distance compared against a radius
          // that means ground switched the whole tier off from the air.
          float treeG = length(toCam - up * dot(toCam, up));
          float treeW = ofTreeInstanceW(treeG, uTreeline.z);
          if (treeW < 1.0) {
            // sin(depression) of the view ray against the LOCAL up. The
            // geometric normal is deliberately not used: this is a question
            // about the path length through a canopy layer standing on the
            // datum, not about the slope of the facet under it.
            float treeS = clamp(abs(dot(rd, up)), 0.0, 1.0);
            // coverSel, shared with every other cover term in this material,
            // is what keeps a cliff face and a scree slope out of it.
            float treeK = clamp(uTreeline.x * coverSel
                                * ofTreeCover(vCanopy, treeW, treeS), 0.0, 1.0);
            // THE MOTTLE, retired at its OWN wavelength's Nyquist point on the
            // curve every other fade in this material uses (0.125 to 0.333 of
            // the wavelength, fully out at a third against a fold at a half).
            // Without it a closed canopy at the horizon is a flat green plate,
            // which is the defect one range band further out.
            // RN-2560. footM IS IN vWorld UNITS AND THE COMPARISON IS IN
            // METRES, which is one multiply in the near program (uMetresPerUnit
            // is exactly 1 there, so this is bit-identical) and a factor of 1e5
            // in the scaled one. Without it the mottle would come back at FULL
            // amplitude at the horizon the moment the shell participates, which
            // is the opposite of what its own Nyquist retirement is for.
            float treeF = 1.0 - smoothstep(OF_TREE_CROWN_M * 0.125,
                                           OF_TREE_CROWN_M * 0.333,
                                           footM * uMetresPerUnit);
            float treeM = treeF > 0.0
              ? (ofArtVnoise(pM / OF_TREE_CROWN_M + 91.3) - 0.5) * treeF : 0.0;
            // RN-2275. INTER-CROWN SELF-SHADOWING, and the sun direction it
            // needs was ALREADY IN SCOPE HERE: 2.18.10 recorded it as needing
            // plumbing, and that was wrong. ATMOSPHERE_PARS declares
            // uSunDir at the top of this fragment shader (Atmosphere.glsl:351)
            // and TerrainFragPars splices it in before main, so A4's shared
            // sun vector -- the same OBJECT the sky material holds, by the
            // reference TerrainProgram takes deliberately -- reaches the albedo
            // block with nothing added. The only thing this block has to do is
            // resolve it against the LOCAL up, which the setup chunk already
            // computed for the fragment's own position.
            //
            // NOT the geometric normal, and for ofTreeCover's own reason one line up: this asks
            // how long the sun's path through a canopy layer standing on the
            // datum is, not how the facet under it is tilted. A wood on a
            // south slope is not a differently self-shadowed wood, and using
            // the geometric normal here would have made it one.
            //
            // normalize(uSunDir) is recomputed rather than hoisted from
            // TERRAIN_FRAG_LIGHT's own sd, which is one chunk further down.
            // Moving that declaration up would edit a shipped chunk whose whole
            // split contract is "GLSL unchanged to the character" to save one
            // normalize inside a branch only canopy fragments enter.
            float treeSun = dot(normalize(uSunDir), up);
            // THE FULL vCanopy, not treeW's complement. The view term paints
            // the density the instances are missing; a crown's SHADOW is cast
            // by every crown above it whatever tier drew it, so both halves
            // take the same local index and reach the same factor. That is the
            // near/far agreement, and it is why the card half can be one
            // scalar rather than a second curve.
            //
            // RN-2525. ofCrownSelfShade still returns the ONE achromatic
            // scalar the law always has; ofCrownSpectralSplit turns it into
            // the per-channel triple CanopySelfShadow.ts derives from the
            // leaf optics, with the TRIPLE'S OWN Rec.709-weighted mean pinned
            // at the scalar it was given (an exact identity -- see that
            // file's header). That is NOT the same as this line's rendered
            // luma being unchanged: uTreelineTone is not neutral, so the
            // result runs a small measured amount brighter than the
            // achromatic law's own prediction. See CanopySelfShadow.ts for the
            // measured size of that drift and for why RN-2275's four pairs
            // were RE-MEASURED rather than assumed protected by algebra alone.
            vec3 treeTone = uTreelineTone
              * ofCrownSpectralSplit(ofCrownSelfShade(vCanopy, treeSun, uCrownShade));
            albedo = mix(albedo,
                         treeTone * (1.0 + uTreeline.y * treeM), treeK);
            // RN-2560. 0.002 of coverage is a quarter of a count on a 255 axis
            // at this term's own contrast, i.e. below anything a rectangle can
            // report, so the two rungs are "evaluated and invisible" against
            // "evaluated and LIVE" rather than an arbitrary threshold.
            treeStage = treeK > 0.002 ? 4.0 : 3.0;
            treeKOut = treeK;
          }
        }
      }
      // RN-2560. THE PAINTED ARM. A bare-uniform branch, false in every shipped
      // frame, so this line costs the default program a compare against a
      // uniform and changes nothing; the no-pixel-change claim is nonetheless
      // MEASURED rather than argued from that (rendering.md 2.36).
      if (uTreelinePaint > 0.5) {
        if (uTreelinePaint < 1.5) {
          albedo = ofTreelineStagePaint(treeStage);
        } else if (uTreelinePaint < 2.5) {
          albedo = vec3(clamp(treeKOut, 0.0, 1.0) * 0.22);
        } else {
          // THE ISOLATE ARMS, 3 + stage. One stage is painted 0.20 and every
          // other fragment is painted EXACTLY BLACK, which is the one value a
          // painted scalar carries through an ACES grade unambiguously, so a
          // rectangle's mean over this arm is a direct reading of how much of
          // that rectangle sat at that stage. Five arms, one flag apart, on
          // one build.
          albedo = abs(uTreelinePaint - 3.0 - treeStage) < 0.5
            ? vec3(0.20) : vec3(0.0);
        }
      }
`;
