// The terrain fragment shader's DECLARATION BLOCK: the includes, the depth
// policy's pars, the two imported pars libraries, every uniform and varying,
// the dither matrix and the cascade shadow GLSL. Everything above
// `void main()`, and nothing else.
//
// Split out of TerrainShader.ts at RN-2051 on this file's own four-times-used
// mechanism (RN-78, RN-148), GLSL unchanged to the character. It is a FUNCTION
// rather than a const because the depth policy interpolates here.
//
// The chunk carries a LEADING newline and no trailing one; TerrainShader.ts
// concatenates the chunks with nothing between them, which is what makes the
// assembled source byte-identical to the single template literal it replaced.

import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import { TERRAIN_ART_PARS } from './TerrainArt.glsl.js';
import { CASCADE_GLSL } from './CascadeShadow.glsl.js';
import { BAYER } from './TerrainDither.glsl.js';
import { TERRAIN_TREELINE_PARS } from './TerrainTreeline.glsl.js';
import { TERRAIN_PHASE_PARS } from './TerrainPhase.glsl.js';
import type { DepthPolicy } from '../DepthPolicy.js';

export function terrainFragPars(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.fragmentPars}
    // NOTE: do NOT include <tonemapping_pars_fragment> or
    // <colorspace_pars_fragment> here. WebGLProgram already injects both into
    // every ShaderMaterial's fragment prefix whenever toneMapping and
    // outputColorSpace are set, and including them again is a hard compile
    // failure ("function already has a body"). Only the BODY chunks belong here.
    #include <shadowmap_pars_fragment>
    ${ATMOSPHERE_PARS}
    ${TERRAIN_ART_PARS}
    uniform vec3 uArtAmp;      // x macro colour, y detail bump, z rock strata
    uniform sampler2D uGroundTex;   // RN-77's four packed detail fields
    uniform float uGroundTexAmp;
    uniform sampler2D uGroundRelief; // RN-147's four asymmetric height fields
    uniform float uGroundReliefAmp;
    // RN-741. 1 takes the relief's slope over a fixed tile-space support, 0 is
    // the pre-RN-741 screen derivative that printed the etched squiggles.
    uniform float uReliefGrad;
    // RN-843. The SUPPORT the relief slope is differenced over, in tile units.
    // A UNIFORM and no longer the OF_RELIEF_GRAD_UV define, because the shipped
    // value turned out to be the defect and a define cannot be swept inside one
    // page, one camera and one streamed chunk set. ?reliefgraduv= moves it; the
    // boot default is RELIEF_GRAD_UV.
    uniform float uReliefGradUv;
    // RN-1855. THE TWO FOOTPRINT FADES' WAVELENGTHS, IN METRES, promoted out of
    // OF_ART_FINE_M / OF_RELIEF_FINE_M for RN-843's reason and one more. Their
    // BOOT DEFAULTS are now DERIVED (ART_FINE_M = FINE_CHUNK_M / ART_OCT_FINE,
    // RELIEF_FINE_M = FINE_CHUNK_M / RELIEF_REPEATS * RELIEF_FINE_TILES) rather
    // than written as absolute metres, which is the actual fix: written in
    // metres they were silently a function of maxDepth and went 2.0x wrong the
    // day WG-186 halved the quad. They are UNIFORMS on top of that because the
    // correction moves the picture AT RANGE, and a before/after at range has to
    // be one flag inside one page, one camera and one streamed chunk set --
    // two page loads is two scenes (RN-1000). ?artfinem= and ?relieffinem=
    // restore 4.2 and 0.45.
    uniform float uArtFineM;
    uniform float uReliefFineM;
    // RN-1900. The vnoise bump's COARSE octave's own wavelength in metres, so
    // the two octaves of hB are faded against their own Nyquist points instead
    // of both against the finer one's. Boot default ART_COARSE_M
    // (FINE_CHUNK_M / ART_OCT_COARSE = 5.4585 m), derived for uArtFineM's
    // reason; ?artcoarsem= sweeps it, and setting it EQUAL to uArtFineM is the
    // exact pre-RN-1900 single-fade behaviour and is the before half of this
    // half of the lane's pair.
    uniform float uArtCoarseM;
    // RN-1900. THE MID-FIELD LAYER, the ninth surface-art term. x is the
    // amplitude and is an isolator first (?groundmid=0 restores the pre-RN-1900
    // ground exactly); y is the per-biome luminance rule's weight, on the
    // near-field layer's uFineLum precedent and for the identical measured
    // reason (one amplitude across a nine-fold spread of biome luminance is one
    // term invisible at one site and shouting at another).
    uniform vec2 uMidAmp;
    // RN-1900. The layer's two wavelengths IN METRES. A uniform because the
    // frequency is the live question this term is judged on and a define cannot
    // be swept inside one page, one camera and one streamed chunk set
    // (RN-843/RN-1000); and because the two footprint fades read this SAME
    // vector, so the octave and the fade that protects it cannot become two
    // numbers that agreed once, which is RN-1855's whole scar.
    uniform vec2 uMidM;
    // RN-961. The ripple direction's swing in RADIANS, peak to peak, across
    // cells. 0 collapses every cell's rotation to the identity, which restores
    // the pre-RN-961 sample coordinate exactly, so ?reliefswing=0 is the
    // negative control for the whole term on one build.
    uniform float uReliefSwing;
    // RN-1005. The direction field's two SCALES, promoted out of
    // OF_REL_CELL / OF_REL_CELL_NOISE for RN-843's reason. uReliefCell is the
    // cell edge in tile units (1 tile = 3.6 m), i.e. how far you walk before
    // the ripple can point somewhere else. uReliefCellNoise is the frequency
    // of the angle noise ON the cell lattice, so 1/uReliefCellNoise is the
    // number of cells over which the direction is CORRELATED: the two
    // together, and not the swing alone, decide how many directions are on
    // screen at once. ?reliefcell= and ?reliefcellnoise= sweep them.
    uniform float uReliefCell;
    uniform float uReliefCellNoise;
    // RN-842. The fraction of a hemisphere the body's own terrain occludes.
    // 0 is the pre-RN-842 flat-tangent-plane model, exactly. See
    // HorizonOcclusion.ts for what it is and why it is measured, not chosen.
    uniform float uHorizonOcc;
    // RN-841. 1 takes the bounce source from the UNSHADOWED flat ground (the
    // expression SkyAtmosphere's ground shell already uses), 0 restores the
    // pre-RN-841 form where a fragment's own shadow extinguished the light
    // bouncing off the sunlit ground beside it. ?bouncelit=0 is the control.
    uniform float uBounceLit;
    // RN-57. x water level (metres above datum), y shoreline radius m, z the
    // height in metres over which the wet band dries out, w amplitude.
    uniform vec4 uWetBand;
    uniform vec3 uWetDir;      // unit direction of the pond centre, body frame
    uniform vec3 uBodyCenter;
    uniform float uMaxRelief;
    uniform vec3 uAmbient;
    // RN-731. Amplitude of the specular lobe, on uGroundTexAmp's pattern
    // exactly: ?terrainspec=0 removes the term with no branch left behind
    // and ?terrainspecamp= sweeps it, so the control is one flag on one
    // build rather than two commits apart.
    // x is the SUN lobe (the GGX highlight), y is the SKY lobe (the grazing
    // reflection). Two components rather than one because they fail
    // differently and therefore have to be isolable separately: the sun half
    // is a local highlight and the sky half is the one that can turn into a
    // broad ambient lift over the whole middle distance, which is named
    // failure mode 1. A single amplitude would only ever have been able to
    // answer "is the specular on", never "which half is doing this".
    uniform vec2 uSpecAmp;
    // RN-1733. The near-field detail layer. x is the BUMP amplitude and y the
    // ALBEDO amplitude, two components rather than one for uSpecAmp's reason
    // exactly: they fail differently (a bump that is too strong reads as
    // gravel, an albedo that is too strong reads as noise) so they have to be
    // isolable separately, and a single amplitude could only ever answer "is
    // the layer on". ?groundfine=0 removes both.
    uniform vec2 uFineAmp;
    // RN-1733. The layer's three repeats per quad (x clod, y crease ridge,
    // z grit) and its three height weights. Uniforms rather than defines for
    // RN-843's measured reason: which frequency band the near ground is
    // missing is settled by looking at matched frames one uniform apart, and a
    // define can only be swept one BUILD per rung, which is not a pair.
    // Only INTEGER frequencies keep the chunk-edge seam closed; see
    // ofArtVnoise2P.
    uniform vec3 uFineFreq;
    uniform vec3 uFineW;
    // RN-1735. 1 applies the per-biome luminance weight (ofArtFineLum), 0 is
    // the flat amplitude this layer shipped with for one afternoon and which
    // measured +134% of near-ground iqr at Beach against 0% at Plains. A hard
    // 0 or 1 and not an amplitude, on uReliefGrad's precedent: what 0 restores
    // is a defect, and an intermediate value would be neither state.
    uniform float uFineLum;
    // RN-2160. THE SPLAT LAYER SET. x value, y chroma, z normal-and-roughness.
    uniform vec3 uSplatAmp;
    // (albedoFadeStart, albedoFadeEnd, normalFadeStart, normalFadeEnd) in
    // METRES of view distance. Two bands rather than one because they protect
    // two different things: the albedo band is texW's 35-to-75 (where the
    // existing ground-texture term retires, so the handover to phase 2 is ONE
    // boundary) and the normal band is the relief bump's 30-to-60, which
    // completes inside the max-depth ring where the chunk UV's world scale is
    // constant. See TerrainSplat.ts clause C4.
    uniform vec4 uSplatFade;
    // RN-2195. THE FAR-FIELD COVER CONVERGENCE's own amplitude, separate from
    // uSplatAmp for TerrainCoverFar.ts's own reason: this term fails
    // differently from the near-field three (it can green ground that should
    // stay khaki, or fail to meet the carpet at all) and has to be isolable
    // on its own flag (?splatfar=0).
    uniform float uSplatFarAmp;
    // RN-2340. THE FAR GROUND: (value, chroma, normal-and-roughness, curvature).
    // FOUR and not one, on uSplatAmp's precedent and for its measured reason:
    // they fail differently, so a single switch could only ever answer "is the
    // far ground on". ?horizon=0 kills all four and is the before half of
    // every pair this lane is judged by; ?horizonval=, ?horizonchroma=,
    // ?horizonnrm= and ?horizonao= sweep them one at a time.
    uniform vec4 uHorizonAmp;
    // RN-2340. The range-aware biome-boundary break's own amplitude, separate
    // from the four above for uSplatFarAmp's reason exactly: it fails in a way
    // none of them can (it can dissolve a coastline that is supposed to be
    // sharp) and has to be isolable on its own flag, ?horizoneco=0. It is a
    // multiplier on HORIZON_ECO_PX, so 1 is the authored 2.5-pixel band.
    uniform float uHorizonEco;
    // RN-2340. THE MASSIF TERM: x the albedo value amplitude, y the bump
    // amplitude. Two and not one for uFineAmp's reason exactly: too much value
    // is a blotchy mountain and too much bump is a corrugated one, and a single
    // switch could only ever answer "is it on". ?horizonmassif=0 removes both
    // and is the before half of every massif pair.
    uniform vec2 uMassifAmp;
    // RN-2340. The massif's two octave WAVELENGTHS IN METRES. Uniforms and not
    // defines for RN-843's measured reason: which band the distance is missing
    // is settled by matched frames one uniform apart inside one page, one
    // camera and one streamed chunk set, and a define can only be swept one
    // BUILD per rung, which is not a pair. The two footprint fades in the bump
    // chunk read this SAME vector, so an octave and the fade that protects it
    // cannot become two numbers that agreed once (RN-1855's whole scar).
    // ?horizonmassifm=1240,390 sweeps them.
    uniform vec2 uMassifM;
    // RN-2340. The massif's DISTANCE fade-out, (start, end) in metres. A
    // uniform and not a define for RN-843's reason and one of this lane's own:
    // it is a HANDOVER guard against the near/far scene split, the range of
    // that split is a property of the depth policy and the streamer rather than
    // of this material, and the only honest way to find where a distant ridge
    // actually sits is to sweep the fade and watch which ridge stops moving.
    // ?horizonmassiffade=a,b sweeps it.
    uniform vec2 uMassifFade;
    // Six layers, six samplers, and the packing is what makes that affordable:
    // R albedo value, G/B tangent normal xy, A roughness detail, every channel
    // centred on 0.5. Six layers x albedo/normal/ORM would be eighteen units
    // and WebGL2 guarantees sixteen.
    uniform sampler2D uSplatGrass;
    uniform sampler2D uSplatDirt;
    uniform sampler2D uSplatRock;
    uniform sampler2D uSplatCliff;
    uniform sampler2D uSplatScree;
    uniform sampler2D uSplatSnow;
    uniform float uFadeDur;
    uniform float uMetresPerUnit;
    uniform vec3 uCascadeFar;
    uniform float uSkyAmbient;
    // RN-2265. THE FAR TREELINE. x amplitude (?treeline=0 / ?treelineamp=),
    // y mottle amplitude, z the instance tier's REALISED ground reach in
    // metres, published every frame by Scatter itself rather than re-derived
    // here (see TerrainTreeline.ts's handover note). z <= 0 is "the canopy tier
    // is off", which turns this term off with it: ?canopy=0 stays the exact
    // no-canopy-anywhere frame RN-2225 measured against.
    uniform vec3 uTreeline;
    // The canopy CARD's own mean rendered albedo, linear, read off the live
    // material by SurfaceBind rather than copied. See TerrainTreeline.ts.
    uniform vec3 uTreelineTone;
    // RN-2275. INTER-CROWN SELF-SHADOWING: (amp, K, floor). The SAME three
    // floats the canopy card's per-frame colour update reads, held once in
    // CanopySelfShadow.SHADE, so the near stand and the far treeline cannot be
    // darkened by different numbers. x = 0 is the exact pre-RN-2275 frame.
    uniform vec3 uCrownShade;
    varying vec3 vBiomeColor;
    varying vec4 vMatW;
    varying vec4 vRelW;
    // RN-1257. The per-biome MATERIAL record, packed into two vec4 so the
    // whole of it costs two varyings: vGrain is (scaleFine, scaleMid,
    // scaleCoarse, roughBase) and vTint is (tintR, tintG, tintB, roughVar).
    // Interpolated across biome edges exactly as vMatW and vRelW are, which is
    // what makes a biome boundary a material gradient rather than a line.
    varying vec4 vGrain;
    varying vec4 vTint;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;
    varying float vFade;
    varying float vViewZ;
    varying vec2 vChunkUv;
    // RN-2265. The canopy AREA INDEX at this fragment: world-gen's own
    // canopyWeight times the biome's crown area per unit ground, evaluated
    // per terrain vertex on the CPU (ChunkCanopy.ts) because that field's
    // integer-lattice hash is not expressible in GLSL ES 1.00.
    varying float vCanopy;
    // WG-230. The WORLD-LOCKED shading coordinate, in units of the 256 m phase
    // period: the chunk's float64-reduced anchor phase plus the vertex's own
    // chunk-local offset. It is what pM cannot be -- resolvable at range --
    // and what vChunkUv cannot be -- the same world scale at every LOD ring.
    // See TerrainPhase.glsl.ts for the integer-repeats seam rule.
    varying vec3 vPhase;
    // WG-230. The phase PROBE: x amplitude, y checker repeats per period.
    // x ships at 0, so the default frame is bit-identical to the one before
    // this lane; ?phaseamp=1 paints the checker that proves the attribute
    // arrives and ?phaserep= sizes it to the pose. A bare uniform and not a
    // define on purpose: no new program permutation, so the pair is one flag
    // inside one build (RN-843/RN-1000).
    uniform vec2 uPhaseProbe;
    ${BAYER}
    ${CASCADE_GLSL}
    ${TERRAIN_TREELINE_PARS}
    ${TERRAIN_PHASE_PARS}
`;
}
