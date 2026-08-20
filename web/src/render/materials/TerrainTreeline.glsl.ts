// RN-2266. THE FAR TREELINE, GLSL half. Pairs with TerrainTreeline.ts on
// TerrainCoverFar / TerrainSplat's own precedent: the TS file holds the
// constants, the derivations and the proofs, this file holds the shader and
// nothing else. Every number below is interpolated from an exported constant
// in that file, so there is no second copy of any of them.

import {
  TREE_CROWN_M, TREE_EDGE_W, TREE_MOTTLE, TREE_NEAR_M, TREE_SIN_MIN,
} from './TerrainTreeline.js';

export const TERRAIN_TREELINE_PARS = /* glsl */`
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
      #ifndef OF_SCALED
        if (uTreeline.x > 0.0 && uTreeline.z > 0.0 && vCanopy > 0.0) {
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
            float treeF = 1.0 - smoothstep(OF_TREE_CROWN_M * 0.125,
                                           OF_TREE_CROWN_M * 0.333, footM);
            float treeM = treeF > 0.0
              ? (ofArtVnoise(pM / OF_TREE_CROWN_M + 91.3) - 0.5) * treeF : 0.0;
            albedo = mix(albedo,
                         uTreelineTone * (1.0 + uTreeline.y * treeM), treeK);
          }
        }
      #endif
`;
