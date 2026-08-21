// PHASE 1 of createTerrainMaterials: build every shared uniform holder, ONCE,
// before either material exists. Split out of TerrainMaterial.ts at RN-2050;
// the body below is the original lines 425-570 unchanged.
//
// WHY THIS IS ONE PHASE AND NOT THIRTY CONSTANTS IN A FACTORY. Every holder
// here is shared BY REFERENCE between the near and the far material and with
// the runtime handle, which is what makes "the two materials cannot disagree"
// structural rather than something someone has to remember. Building them in
// one place, before either consumer runs, is what that sharing IS.
//
// The state's TYPE is derived from this function rather than declared, so the
// two cannot drift: adding a holder below publishes it, and a holder that
// stops existing stops type-checking at every reader.

import * as THREE from 'three';
import { biomeGrain, biomeMatWeights, biomeReliefWeights, biomeTint }
  from './BiomeMaterial.js';
import { biomeColorArray } from './BiomePalette.js';
import { GROUND_RELIEF_MAP, GROUND_VALUE_MAP, groundTexture } from './GroundTextures.js';
import { ART_COARSE_M, ART_FINE_M, FINE_A, FINE_B, FINE_R, FINE_W,
  MID_A_M, MID_B_M, RELIEF_FINE_M } from './TerrainArt.glsl.js';
import { artAmpFromQuery, emitGroundFromQuery, fineAmpFromQuery,
  groundReliefAmpFromQuery,
  horizonAmpFromQuery, horizonCellFromQuery, horizonEcoFromQuery,
  horizonPlainsFromQuery, massifAmpFromQuery,
  massifFadeFromQuery, massifMFromQuery,
  splatAmpFromQuery, splatFarAmpFromQuery,
  groundTexAmpFromQuery, midAmpFromQuery, specAmpFromQuery, wetBandFromQuery }
  from './TerrainAmpQuery.js';
import { fineMFromQuery, horizonOccFromQuery, reliefCellFromQuery,
  reliefCellNoiseFromQuery, reliefGradFromQuery, reliefGradUvFromQuery,
  reliefSwingFromQuery } from './TerrainReliefQuery.js';
import type { TerrainMaterialOptions } from './TerrainMaterialTypes.js';
import { onCanopyTone, treelineAmpFromQuery, treelineMottleFromQuery }
  from './TerrainTreeline.js';
import { SHADE } from './CanopySelfShadow.js';
import { biomeCoverMuArray, coverStandAmpFromQuery, coverStandChromaFromQuery,
  coverStandMosaicFromQuery,
  coverStandValueFromQuery } from './TerrainCoverFarStand.js';
import { phaseProbeFromQuery } from './TerrainPhase.js';
import { SPLAT_FADE_ALBEDO, SPLAT_FADE_NORMAL, SPLAT_MAPS }
  from './TerrainSplat.js';

/** Everything the program factory and the runtime handle share, by reference. */
export type TerrainUniformState = ReturnType<typeof buildTerrainUniformState>;

export function buildTerrainUniformState(o: TerrainMaterialOptions) {
  const palette = biomeColorArray();
  // ONE Vector3 shared by both materials by reference, on the atmosphere's own
  // precedent (see the merge note below): a runtime toggle that reached the
  // near material and not the far one would be a second authority on how the
  // ground looks, which is the exact bug class this file already guards.
  const artAmp = artAmpFromQuery();
  // The ground texture (RN-78): one shared IUniform for the map, one shared
  // holder for the amplitude, the biome weight table built once. All shared
  // by reference between the two materials for the reason artAmp is.
  const groundTex = groundTexture(GROUND_VALUE_MAP);
  const groundAmp: THREE.IUniform<number> = { value: groundTexAmpFromQuery() };
  const biomeMat = biomeMatWeights();
  // RN-148: the asymmetric relief pair, shared by reference exactly as the
  // value texture is and for the same one-authority reason.
  const reliefTex = groundTexture(GROUND_RELIEF_MAP);
  const reliefAmp: THREE.IUniform<number> = { value: groundReliefAmpFromQuery() };
  const biomeRelief = biomeReliefWeights();
  // RN-1257. The per-biome material record and its two EXACT controls.
  // `?biomescale=0` writes the pre-RN-1257 frequency partition into every
  // biome, so the three-tap blend reproduces the old two-tap one to the bit;
  // `?biometint=0` writes (1,1,1) into every tint, so the modulation goes back
  // to being pure value. Both are hard 0-or-1 on reliefGrad's precedent rather
  // than amplitudes, because what they restore is a PREVIOUS STATE and an
  // intermediate value would be neither state (RN-741's argument).
  //
  // There is deliberately no third flag for the roughness table: roughness has
  // exactly one consumer, so `?terrainspec=0` already removes every effect it
  // can have, and a second control over one term is two ways to express one
  // state that can disagree (RN-1005's argument).
  const qp = new URLSearchParams(self.location.search);
  const biomeGrainW = biomeGrain(qp.get('biomescale') === '0');
  const biomeTintW = biomeTint(qp.get('biometint') === '0');
  // The wet band, likewise ONE object shared by both materials by reference so
  // a runtime tweak cannot reach one and not the other. The amplitude is zero on
  // a dry body, which is what makes `ofArtWet` return on its first line and cost
  // the fragment a compare rather than two lengths.
  // RN-731. One shared holder for the specular amplitude, by reference into
  // both materials for the same one-authority reason artAmp is: a runtime
  // toggle that reached the near material and not the far one would be a
  // second opinion about how the ground responds to light.
  const specAmp = specAmpFromQuery();
  // RN-1733. One shared holder for the near-field detail layer, by reference
  // into both materials for the one-authority reason artAmp is: a runtime
  // toggle that reached the near material and not the far one would be a
  // second opinion about what the ground is made of. (The far material
  // compiles the term out entirely, so the share is belt and braces there and
  // the reason to keep it is that the pattern must not have an exception.)
  const fineAmp = fineAmpFromQuery();
  // RN-1733. The layer's three repeats and three weights, shared by reference
  // for the one-authority reason artAmp is. `?groundfinefreq=61,109,191` and
  // `?groundfinew=0.55,0.35,0.30` override them; a malformed or non-positive
  // triple takes the boot default rather than being clamped into a state
  // nothing documents (reliefCellFromQuery's rule).
  const triple = (key: string, d: readonly [number, number, number],
    positive: boolean): THREE.Vector3 => {
    const v = new URLSearchParams(self.location.search).get(key);
    const n = (v ?? '').split(',').map(Number);
    const ok = n.length === 3 && n.every((x) => Number.isFinite(x)
      && (!positive || x > 0));
    return ok ? new THREE.Vector3(n[0], n[1], n[2])
      : new THREE.Vector3(d[0], d[1], d[2]);
  };
  const fineFreq = triple('groundfinefreq', [FINE_A, FINE_R, FINE_B], true);
  const fineW = triple('groundfinew', FINE_W, false);
  // RN-1735. `?groundfinelum=0` restores the FLAT amplitude across every biome
  // exactly, which is what makes the luminance rule falsifiable on one build
  // rather than two commits apart. A hard 0 or 1, on reliefGrad's precedent.
  const fineLum: THREE.IUniform<number> = {
    value: new URLSearchParams(self.location.search).get('groundfinelum') === '0'
      ? 0 : 1,
  };
  // RN-741, shared by reference into both materials for the one-authority
  // reason artAmp is: a control that reached the near material and not the far
  // one would make the negative control a statement about one scene only.
  const reliefGrad: THREE.IUniform<number> = { value: reliefGradFromQuery() };
  // RN-843. The relief slope's SUPPORT, promoted from a `#define` to a shared
  // uniform. It was a compile-time constant because it was believed to be
  // derived and settled; it is neither (see RELIEF_GRAD_UV's note), and the
  // measurement that showed so needed to sweep it inside ONE page, one camera
  // and one streamed chunk set, which a define cannot do.
  const reliefGradUv: THREE.IUniform<number> = { value: reliefGradUvFromQuery() };
  // RN-1855. The two footprint-fade wavelengths, shared by reference into both
  // materials for the one-authority reason artAmp is. The far material compiles
  // the whole art block out, so the share is belt and braces there; the pattern
  // must not have an exception.
  const artFineM: THREE.IUniform<number> = {
    value: fineMFromQuery('artfinem', ART_FINE_M),
  };
  const reliefFineM: THREE.IUniform<number> = {
    value: fineMFromQuery('relieffinem', RELIEF_FINE_M),
  };
  // RN-1900. The vnoise bump's COARSE octave's wavelength, the third member of
  // the same family and shared the same way. `?artcoarsem=2.0664` (i.e. equal
  // to ART_FINE_M) reproduces the pre-RN-1900 single-fade bump exactly, which
  // is why this exists as a uniform at all rather than only as a constant.
  const artCoarseM: THREE.IUniform<number> = {
    value: fineMFromQuery('artcoarsem', ART_COARSE_M),
  };
  // RN-1900. The mid-field layer's amplitude and its luminance-rule weight,
  // shared by reference into both materials for the one-authority reason artAmp
  // is. `?groundmid=0` is the whole-term isolator and the BEFORE half of every
  // pair this term is judged by; `?groundmidamp=` sweeps it;
  // `?groundmidlum=0` restores the flat amplitude across every biome exactly,
  // which is what makes RN-1735's rule falsifiable on this term too rather than
  // inherited on faith.
  const midAmp = midAmpFromQuery();
  // RN-1900. The layer's two wavelengths IN METRES (not repeats: its coordinate
  // is planet-centred metres, so a metre is a metre at every depth and on every
  // body, and WG-192's cells-are-secretly-maxDepth trap cannot reach it).
  // `?groundmidm=12.4,4.7` sweeps them; a malformed or non-positive pair takes
  // the boot default rather than being clamped into a state nothing documents,
  // which is `triple`'s own rule one field up.
  const midM = ((): THREE.Vector2 => {
    const v = new URLSearchParams(self.location.search).get('groundmidm');
    const n = (v ?? '').split(',').map(Number);
    return (n.length === 2 && n.every((x) => Number.isFinite(x) && x > 0))
      ? new THREE.Vector2(n[0], n[1]) : new THREE.Vector2(MID_A_M, MID_B_M);
  })();
  // RN-961. Shared by reference into both materials for the one-authority
  // reason artAmp is: a control that reached the near material and not the far
  // one would make the negative control a statement about one scene only.
  const reliefSwing: THREE.IUniform<number> = { value: reliefSwingFromQuery() };
  // RN-1005. Shared by reference into both materials for the one-authority
  // reason artAmp is: a scale that reached the near material and not the far
  // one would make the sweep a statement about one scene only.
  const reliefCell: THREE.IUniform<number> = { value: reliefCellFromQuery() };
  const reliefCellNoise: THREE.IUniform<number> = { value: reliefCellNoiseFromQuery() };
  // RN-842. The body's own horizon occlusion. Written by Boot from
  // `measureHorizonOcclusion`; the boot value here is the flat-plane model, so
  // a material built before the measurement lands behaves exactly as it did
  // before RN-842 rather than guessing.
  const horizonOcc: THREE.IUniform<number> = { value: horizonOccFromQuery() ?? 0 };
  // RN-841. Shared by reference into both materials for the one-authority
  // reason artAmp is. A hard 0 or 1 and not an amplitude, on reliefGrad's
  // precedent: what 0 restores is a defect, and an intermediate value would be
  // a blend of two derivations rather than either of them.
  const bounceLit: THREE.IUniform<number> = {
    value: new URLSearchParams(self.location.search).get('bouncelit') === '0' ? 0 : 1,
  };
  // RN-2160. THE SPLAT. Three amplitudes (value, chroma, normal-and-
  // roughness) on uFineAmp's precedent: they fail differently, so they have to
  // be isolable separately and `?splat=0` is the one flag that kills all three
  // at once for the before/after pair.
  const splatAmp = splatAmpFromQuery();
  // The two fade bands as one vec4, (albedoStart, albedoEnd, nrmStart, nrmEnd).
  // NEITHER PAIR IS THIS LANE'S NUMBER: 35/75 is texW's own band and 30/60 is
  // the relief bump's, each lifted with the argument that chose it (see
  // TerrainSplat.ts clause C4). They are a uniform anyway, because the whole
  // convergence claim is about where these reach zero and a claim nobody can
  // sweep is a claim nobody can falsify.
  const splatFade = ((): THREE.Vector4 => {
    const v = new URLSearchParams(self.location.search).get('splatfade');
    const n = (v ?? '').split(',').map(Number);
    return (n.length === 4 && n.every((x) => Number.isFinite(x) && x > 0))
      ? new THREE.Vector4(n[0], n[1], n[2], n[3])
      : new THREE.Vector4(SPLAT_FADE_ALBEDO[0], SPLAT_FADE_ALBEDO[1],
                          SPLAT_FADE_NORMAL[0], SPLAT_FADE_NORMAL[1]);
  })();
  // RN-2195. THE FAR-FIELD COVER CONVERGENCE's own amplitude, shared by
  // reference into both materials for the one-authority reason artAmp is: a
  // toggle that reached the near material and not the far one would be a
  // second opinion about what colour the ground converges to past the fade.
  const splatFarAmp: THREE.IUniform<number> = { value: splatFarAmpFromQuery() };
  // RN-2340. THE FAR GROUND: (value, chroma, normal-and-roughness, curvature)
  // and the biome-boundary break's own scalar, both shared by reference into
  // both materials for the one-authority reason artAmp is. The far material
  // compiles the whole term out (`#ifndef OF_SCALED`), so the share is belt and
  // braces there and the reason to keep it is that the pattern must not have an
  // exception.
  const horizonAmp: THREE.IUniform<THREE.Vector4> = {
    value: horizonAmpFromQuery(),
  };
  const horizonEco: THREE.IUniform<number> = { value: horizonEcoFromQuery() };
  // RN-2422. The ground's half of the emissive irradiance: 1 shipped, 0 is the
  // ground that takes no fire light at all, i.e. every machine surface exactly
  // as M3 shipped it and the terrain back where it was.
  const emitGround: THREE.IUniform<number> = { value: emitGroundFromQuery() };
  // RN-2421. The cell guard's arming scalar and the analytic stand-in's
  // amplitude, shared by reference into both materials for horizonAmp's reason.
  const horizonCell: THREE.IUniform<THREE.Vector2> = {
    value: horizonCellFromQuery(),
  };
  // RN-2475. The far macro pair's amplitude, its own scalar for the reason
  // TerrainFragPars gives beside the uniform, shared by reference likewise.
  const horizonPlains: THREE.IUniform<number> = { value: horizonPlainsFromQuery() };
  // RN-2340. The MASSIF term's two amplitudes and its two octave wavelengths,
  // shared by reference for the same one-authority reason.
  const massifAmp: THREE.IUniform<THREE.Vector2> = {
    value: massifAmpFromQuery(),
  };
  const massifM: THREE.IUniform<THREE.Vector2> = { value: massifMFromQuery() };
  const massifFade: THREE.IUniform<THREE.Vector2> = {
    value: massifFadeFromQuery(),
  };
  // Six maps, ONE shared IUniform each out of GroundTextures' cache, and it
  // must be the holder rather than a fresh { value } wrapper for that file's
  // own stated reason: the texture arrives asynchronously and the loader
  // reassigns `.value`, so a copy would leave one material holding the 1x1
  // placeholder forever. Destructured into six NAMED locals rather than kept
  // as an array, so TerrainProgram's destructure can name-check each one.
  const [splatGrass, splatDirt, splatRock, splatCliff, splatScree, splatSnow] =
    SPLAT_MAPS.map((f) => groundTexture(f));
  // RN-2265. THE FAR TREELINE: (amp, mottle, realised ground reach). The third
  // component is written every frame from the SCATTER's own reach (see
  // TerrainMaterials.setTreelineReach) and starts at 0, which is "the canopy
  // tier is not running", so a frame taken before the first scatter update
  // shows the pre-lane ground rather than a treeline nothing is handing over
  // from. Shared by reference into both materials for splatFarAmp's reason.
  const treeline: THREE.IUniform<THREE.Vector3> = {
    value: new THREE.Vector3(
      treelineAmpFromQuery(), treelineMottleFromQuery(), 0),
  };
  const treelineTone: THREE.IUniform<THREE.Vector3> = {
    value: new THREE.Vector3(),
  };
  onCanopyTone((r, g, b) => { treelineTone.value.set(r, g, b); });
  // RN-2275. INTER-CROWN SELF-SHADOWING, (amp, K, floor). Built FROM the same
  // `SHADE` triple the canopy card's per-frame update reads, so the near cards
  // and the far paint are darkened by one set of numbers rather than by two
  // that agree today. Shared by reference into both materials.
  const crownShade: THREE.IUniform<THREE.Vector3> = {
    value: new THREE.Vector3(SHADE[0], SHADE[1], SHADE[2]),
  };
  // RN-2512. THE MID FIELD'S GROUND COVER: (amp, mosaic, value, chroma). Shared by
  // reference into both materials for splatFarAmp's reason, and the far
  // material compiles the term out (`#ifndef OF_SCALED`) exactly as it does the
  // treeline's, so the share is belt and braces there and is kept because the
  // pattern must not have an exception.
  const coverStand: THREE.IUniform<THREE.Vector4> = {
    value: new THREE.Vector4(
      coverStandAmpFromQuery(), coverStandMosaicFromQuery(),
      coverStandValueFromQuery(), coverStandChromaFromQuery()),
  };
  // RN-2511. The per-biome ground-cover area index the vertex shader pairs the
  // aCover attribute with. A Float32Array rather than a plain array because
  // three uploads it to a float[] uniform directly and a table DERIVED from
  // Registry has no reason to become boxed numbers on the way. Shared by
  // reference for the same one-authority reason.
  const biomeCover: THREE.IUniform<Float32Array> = { value: biomeCoverMuArray() };
  // WG-230. The world-locked phase PROBE: (amplitude, checker repeats per
  // period), amplitude 0 in the shipped frame. Shared by reference into both
  // materials for splatFarAmp's reason: the scaled far scene carries the
  // attribute too, and a probe that reached one material and not the other
  // would photograph a seam this lane does not have.
  const phaseProbe: THREE.IUniform<THREE.Vector2> = { value: phaseProbeFromQuery() };
  const wetBand = wetBandFromQuery(o.water);
  const wetDir = new THREE.Vector3(
    o.water?.dirX ?? 0, o.water?.dirY ?? 1, o.water?.dirZ ?? 0);
  const cascades = o.cascadeSplits.length;
  const splits = new THREE.Vector3(
    o.cascadeSplits[0] ?? 1, o.cascadeSplits[1] ?? 1, o.cascadeSplits[2] ?? 1,
  );

  return {
    palette, artAmp, groundTex, groundAmp, biomeMat, reliefTex, reliefAmp,
    biomeRelief, biomeGrainW, biomeTintW, specAmp, fineAmp, fineFreq, fineW,
    fineLum, reliefGrad, reliefGradUv, artFineM, reliefFineM, artCoarseM,
    midAmp, midM, reliefSwing, reliefCell, reliefCellNoise, horizonOcc,
    bounceLit, wetBand, wetDir, cascades, splits,
    splatAmp, splatFade, splatFarAmp, treeline, treelineTone, crownShade,
    coverStand, biomeCover,
    phaseProbe, horizonAmp, horizonEco, horizonCell, horizonPlains, emitGround,
    massifAmp, massifM, massifFade,
    splatGrass, splatDirt, splatRock, splatCliff, splatScree, splatSnow,
  };
}
