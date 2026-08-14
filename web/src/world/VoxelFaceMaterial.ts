// RN-1258. THE DUG FACE'S MATERIAL, and the reason it is the furthest thing in
// this project from the reference bar: it had none.
//
// What shipped was `new THREE.MeshLambertMaterial({ vertexColors: true })`.
// Three interpolated vertex colours from RN-80's depth profile, one Lambert
// term, and NOT ONE MAP OF ANY KIND. Every other surface in the game wears at
// least an albedo and a normal; the one surface the player puts their face
// against, every single time they dig, wore a gradient. At headlamp range a
// gradient is a flat plastic sheet, and no amount of grading, exposure or
// light reaches it, because there is nothing there to light.
//
// ---------------------------------------------------------------------------
// WHY IT COULD NOT SIMPLY USE THE TERRAIN'S OWN MATERIAL
// ---------------------------------------------------------------------------
// Two reasons, and both are already recorded in VoxelMesh's header rather than
// discovered here. The terrain program never reads three's light list, so a
// tunnel shaded with it stopped responding to the headlamp (lift 3.46x -> 1.12x,
// measured). And the terrain's texture coordinate is `vChunkUv`, a per-quad
// surface parameterisation that a cut through the volume does not have and
// cannot be given: the dug face is an isosurface of a density field, extracted
// by surface nets, with no UVs at all.
//
// So the answer is the one the brief names: PROJECT. Triplanar for the albedo,
// world-space analytic noise for the relief, both keyed on a coordinate that is
// stable under everything this mesh does to itself.
//
// ---------------------------------------------------------------------------
// THE COORDINATE, WHICH IS THE ONE THING THAT HAD TO BE GOT RIGHT
// ---------------------------------------------------------------------------
// `VoxelMesh` writes vertex positions RELATIVE TO ITS OWN ANCHOR, and the
// anchor is the running minimum brick corner: dig one metre in -x past the
// current minimum and every position in the buffer is rewritten and the object
// transform moves to compensate. Geometrically that is a no-op. For a
// projection it is a catastrophe: a texture keyed on the local position would
// SLIDE ACROSS THE WHOLE TUNNEL every time the player dug in a new direction,
// which is the single most obvious artefact a projected material can have.
//
// The body-frame position is stable but unusable for the opposite reason: it is
// float32 at about 6e5 m on Forge, so one ULP is 0.0625 m and a 0.2 m grain
// would quantise to a third of its own wavelength. That is TerrainArt's whole
// precision note, arriving here from a different direction.
//
// `uVoxOrigin` is the fix and it is exact rather than approximate. The anchor
// moves in whole CELLS, so the shader is handed the anchor cell reduced modulo
// a fixed integer number of cells and multiplied by the cell size. Adding it to
// the local position gives a coordinate that (a) is congruent to the body-frame
// position modulo the projection period, so the pattern is nailed to the world,
// and (b) never exceeds a few tens of metres, so its derivatives are clean.
// The reduction is integer arithmetic on an integer, so it is exact; there is
// no drift to accumulate.
//
// ---------------------------------------------------------------------------
// WHY THE BUMP IS ANALYTIC AND THE ALBEDO IS SAMPLED
// ---------------------------------------------------------------------------
// Not symmetry, and not cost. A triplanar bump from `of_ground_relief` would
// have walked straight back into RN-741: that texture is authored with SHARP
// CRESTS on purpose, a screen derivative of a slope discontinuity prints a
// hairline along every crest, and the terrain had to buy a band-limited
// gradient (nine fetches, three per axis) to fix it. Here the fix is free,
// because the coordinate above is small-magnitude by construction and therefore
// SUB-METRE NOISE IS REACHABLE, which it is not on the terrain. An analytic
// value-noise stack differentiates exactly, has no crests to snap on, costs no
// fetch, and reaches 0.2 m features that the terrain cannot express at all.
// The dug face is the one surface in this game that gets to have fine relief.
//
// The ALBEDO is sampled because the thing being claimed there is material
// identity: the cut bank must be made of the same bytes as the hillside it is
// cut into (`of_ground.png`, via the shared `GroundTextures` cache, one upload,
// one authority), with the same per-biome channel weights and the same grain
// tint. An analytic albedo would be a second opinion about what soil looks
// like.
//
// ---------------------------------------------------------------------------
// LAMBERT -> PHONG, AND WHY THAT IS NOT A LIGHTING CHANGE
// ---------------------------------------------------------------------------
// three's `lights_lambert_fragment` and `lights_phong_fragment` compute the
// identical diffuse term, `BRDF_Lambert(diffuseColor.rgb)`, over the identical
// irradiance from the identical light list. Phong adds a Blinn specular lobe on
// top. With `specular` black the two materials are the same image, which is
// what makes `?voxelspec=0` an EXACT control rather than a near one, and it is
// why the measured headlamp response is not in play: nothing about the diffuse
// path moved. What is bought is that wet rock in a tunnel can catch the lamp,
// which is most of what makes a cut face read as stone rather than as paper.

import * as THREE from 'three';

import { biomeGrain, biomeMatWeights, biomeTint }
  from '../render/materials/BiomeMaterial.js';
import { BIOME_COUNT } from '../render/materials/BiomePalette.js';
import { GROUND_VALUE_MAP, groundTexture } from '../render/materials/GroundTextures.js';
import { TERRAIN_ART_BUMP, TERRAIN_ART_NOISE } from '../render/materials/TerrainArt.glsl.js';

/**
 * The projection period, in CELLS. `uVoxOrigin` is the anchor cell reduced
 * modulo this, so it must be an integer and it must be a common multiple of
 * every tile size below expressed in cells, or the reduction would move the
 * pattern by a fraction of a tile instead of by a whole one.
 *
 * 256 cells at the shipped voxel size is comfortably larger than any tunnel the
 * near mesh holds, so in practice the reduction never even fires; it is here so
 * that the coordinate is bounded by construction rather than by how far anyone
 * has dug so far.
 */
const ORIGIN_PERIOD_CELLS = 256;

/**
 * The two triplanar tile sizes, in metres.
 *
 * DERIVED FROM THE VIEWING DISTANCE, not copied from the terrain. The terrain's
 * texture band is 2 m to 35 m and its tiles are 1.23 m, 3.62 m and 11.6 m. A
 * dug face is looked at from 0.4 m to about 4 m, an order of magnitude closer,
 * so the terrain's tiles would show a third of one tile across a whole wall and
 * read as a smooth wash. These are the terrain's fine and mid tiles divided by
 * four, which puts three to eight tiles across a typical cut and is the density
 * the reference reads at.
 */
const TILE_FINE_M = 0.308;
const TILE_COARSE_M = 0.904;

export interface VoxelFaceOptions {
  /** `?voxelgrain=` amplitude for the projected albedo detail; 0 removes it. */
  readonly grainAmp: number;
  /** `?voxelbump=` amplitude for the analytic relief; 0 removes it. */
  readonly bumpAmp: number;
  /** `?voxelspec=` amplitude for the Blinn lobe; 0 is diffuse-identical. */
  readonly specAmp: number;
}

export interface VoxelFaceMaterial {
  readonly material: THREE.Material;
  /** The /core biome the near mesh sits in; picks the per-biome material row. */
  setBiome(biomeId: number): void;
  /**
   * The anchor cell (integers) and the cell size, from which the stable
   * projection offset is derived. Called on every rebuild, which is when the
   * anchor can have moved.
   */
  setAnchor(cell: readonly [number, number, number], cellM: number): void;
  dispose(): void;
}

/** Read the three isolation amplitudes, each on TerrainMaterial's flag rules. */
export function voxelFaceOptionsFromQuery(): VoxelFaceOptions {
  const p = new URLSearchParams(self.location.search);
  // A missing parameter is MISSING and takes the boot default, never
  // `Number(null) === 0`, which is how a feature ships off with its own control
  // permanently engaged (NUMBERS.md, boot defaults). This file is new and the
  // trap has fired in TerrainMaterial twice, so it is written correctly once.
  const amp = (k: string, dflt: number): number => {
    const v = p.get(k);
    if (v === null) return dflt;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : dflt;
  };
  return { grainAmp: amp('voxelgrain', 1), bumpAmp: amp('voxelbump', 1), specAmp: amp('voxelspec', 1) };
}

export function createVoxelFaceMaterial(o: VoxelFaceOptions): VoxelFaceMaterial {
  const matW = biomeMatWeights();
  const grainW = biomeGrain(false);
  const tintW = biomeTint(false);

  const uVoxTex = groundTexture(GROUND_VALUE_MAP);
  const uVoxOrigin: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3() };
  const uVoxMat: THREE.IUniform<THREE.Vector4> = { value: matW[0].clone() };
  // (wFine, wCoarse, roughBase, roughVar) collapsed from the terrain's row.
  const uVoxBiome: THREE.IUniform<THREE.Vector4> = { value: new THREE.Vector4() };
  const uVoxTint: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(1, 1, 1) };
  const uVoxAmp: THREE.IUniform<THREE.Vector3> = {
    value: new THREE.Vector3(o.grainAmp, o.bumpAmp, o.specAmp),
  };

  const m = new THREE.MeshPhongMaterial({
    vertexColors: true,
    // Black by default so the lobe is entirely `uVoxAmp.z`'s to switch off; the
    // colour below is applied inside the injected chunk, not by three, so
    // ?voxelspec=0 is bit-exact against the Lambert image.
    specular: new THREE.Color(0x000000),
    shininess: 26,
  });
  m.name = 'VoxelFace';

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uVoxTex, uVoxOrigin, uVoxMat, uVoxBiome, uVoxTint, uVoxAmp,
    });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute float aRock;
        uniform vec3 uVoxOrigin;
        varying vec3 vVoxPos;
        varying float vRock;
      `)
      // `position` and not `transformed`: the object carries no rotation and no
      // scale (VoxelMesh only ever sets `position`), so object space IS the
      // body frame up to the translation `uVoxOrigin` puts back. Reading
      // `transformed` would pick up any future morph or skin and silently
      // change what the projection is nailed to.
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vVoxPos = position + uVoxOrigin;
        vRock = aRock;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform sampler2D uVoxTex;
        uniform vec4 uVoxMat;    // the biome's four channel amplitudes
        uniform vec4 uVoxBiome;  // x wFine, y wCoarse, z roughBase, w roughVar
        uniform vec3 uVoxTint;   // the biome's grain tint axis
        uniform vec3 uVoxAmp;    // x grain, y bump, z specular
        varying vec3 vVoxPos;
        varying float vRock;
        ${TERRAIN_ART_NOISE}
        ${TERRAIN_ART_BUMP}

        // Triplanar weights. Biased toward the dominant axis and then squared,
        // because an unbiased |n| blend smears all three projections together
        // on any face that is not axis-aligned, and a surface-nets isosurface
        // is almost never axis-aligned. The subtraction can never zero all
        // three: the smallest possible largest component of a unit vector is
        // 1/sqrt(3) = 0.577, comfortably above the 0.22 bias.
        vec3 ofVoxTriW(vec3 n) {
          vec3 w = max(abs(n) - 0.22, vec3(0.0));
          w *= w;
          return w / max(w.x + w.y + w.z, 1e-4);
        }

        vec4 ofVoxTri(vec3 p, float inv, vec3 w) {
          return w.x * texture2D(uVoxTex, p.zy * inv)
               + w.y * texture2D(uVoxTex, p.xz * inv)
               + w.z * texture2D(uVoxTex, p.xy * inv);
        }

        // THE CUT SURFACE'S OWN RELIEF. Three octaves on the stable local
        // coordinate, all analytic, so ofArtBump's screen derivative is exact
        // and there is no authored crest for it to snap on (RN-741).
        //
        // The third octave is a SMOOTH ridge: 1 - sqrt(v*v + eps) has a
        // near-crease at v = 0 without ever being non-differentiable, which is
        // what gives a cut face the fractured look that plain value noise
        // cannot and what a hard abs() would buy at the price of RN-741's
        // hairlines all over again. eps 0.03 sets how tight the crease is.
        //
        // Rock breaks COARSER and HARDER than soil, so vRock leans the stack:
        // topsoil gets the fine crumb, bedrock gets the ridges.
        //
        // THE WEIGHTS WERE MEASURED DOWN AND THE FAILURE IS RN-78's, ARRIVING
        // AT A NEW SURFACE. The first version put 0.85 on the 0.62 m octave,
        // and a smooth metre-scale undulation IS liquid's visual signature
        // whatever it is drawn on: the frame came back with the whole cut
        // reading as WET OIL. It took four negative controls to attribute,
        // because ?terrainspec=0, ?groundrelief=0, ?terrainbump=0 and
        // ?groundtex=0 all left it untouched, which is what finally named the
        // voxel mesh rather than the ground as its owner. The stack is now
        // weighted toward 0.19 m and 0.075 m, the ridge share is up, and the
        // total amplitude is down from 0.55 to 0.20. The lesson transfers
        // exactly: the fix for a liquid read is FINER and MORE ASYMMETRIC, not
        // merely SMALLER, because scaling an undulation leaves an undulation.
        //
        // THE AMPLITUDE HAD TO COME DOWN BY MORE THAN IT LOOKS, and the reason
        // is arithmetic rather than taste: a derivative bump's strength is the
        // sum of weight/wavelength, not the sum of weights. Moving energy from
        // a 0.62 m octave to a 0.075 m one multiplies that sum even while every
        // weight falls, and the first retune came back as a black-and-tan
        // leopard pattern because the sum had nearly doubled. It is now about
        // 0.87 of the original, which is the number to reason with if this is
        // ever swept again.
        float ofVoxHeight(vec3 p) {
          float o1 = ofArtVnoise(p * (1.0 / 0.62)) - 0.5;
          float o2 = ofArtVnoise(p * (1.0 / 0.19) + 11.3) - 0.5;
          float o3 = ofArtVnoise(p * (1.0 / 0.075) + 29.4) - 0.5;
          float v = ofArtVnoise(p * (1.0 / 0.34) + 3.7) * 2.0 - 1.0;
          float ridge = 0.52 - sqrt(v * v + 0.012);
          return o1 * 0.26 + o2 * 0.80 + o3 * mix(0.24, 0.15, vRock)
               + ridge * mix(0.40, 0.95, vRock);
        }
      `)
      // AFTER <color_fragment>, which is where three has just multiplied the
      // vertex colour in. The projected detail must ride RN-80's depth profile
      // rather than replace it: the profile is what says soil-then-rock and
      // this is what says what soil and rock are made of.
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec3 ofVoxW = ofVoxTriW(normalize(vNormal));
        vec4 ofVoxG = uVoxBiome.x
              * (ofVoxTri(vVoxPos, 1.0 / ${TILE_FINE_M.toFixed(3)}, ofVoxW) - vec4(0.5))
            + uVoxBiome.y
              * (ofVoxTri(vVoxPos, 1.0 / ${TILE_COARSE_M.toFixed(3)}, ofVoxW) - vec4(0.5));
        // OF_TEX_SCALE_GAIN's job on the terrain, done here by the same number
        // for the same reason: the two-bin partition sums to 1, so without it
        // the dug face would be modulated at two thirds of the ground's depth
        // and would read as the flatter of the two surfaces at the seam where
        // they meet.
        float ofVoxGrain = 1.55 * dot(ofVoxG, uVoxMat);
        // The same normalisation the terrain applies before roughness reads
        // the grain, and for the same reason: MAT_W's sums are
        // luminance-compensated across a factor of six, so an un-normalised
        // grain would make the specular's variation a function of the albedo
        // table's amplitude rather than of the biome's roughness row.
        float ofVoxGrainN = ofVoxGrain / max(dot(uVoxMat, vec4(1.0)), 1e-3);
        diffuseColor.rgb *= vec3(1.0) + uVoxAmp.x * ofVoxGrain * uVoxTint;
      `)
      // AFTER <normal_fragment_begin>, so `normal` exists and is the
      // interpolated gradient normal surface nets produced. vVoxPos and not
      // vViewPosition: the bump's surface-gradient algebra wants the WORLD
      // (here: body-frame-congruent) derivative of position, and the two
      // differ by the view rotation, which would tilt every bump with the
      // camera.
      .replace('#include <normal_fragment_begin>', /* glsl */`
        #include <normal_fragment_begin>
        if (uVoxAmp.y > 0.0) {
          normal = ofArtBump(normal, vVoxPos, ofVoxHeight(vVoxPos),
                             uVoxAmp.y * 0.20, 0.075);
        }
      `)
      // AFTER <specularmap_fragment>, which is where three sets
      // specularStrength. Rock glints and soil does not, and within rock the
      // grain decides which facet is catching the lamp, so the lobe is driven
      // by the same two signals the albedo and the relief already used and
      // introduces no third opinion.
      .replace('#include <lights_phong_fragment>', /* glsl */`
        #include <lights_phong_fragment>
        material.specularColor = vec3(0.055 + 0.075 * vRock)
          * uVoxAmp.z
          * (1.0 - uVoxBiome.w * 0.5
             + uVoxBiome.w * clamp(ofVoxGrainN * 3.2, -1.0, 1.0) * 0.5)
          * (2.0 - uVoxBiome.z);
      `);
  };

  const setBiome = (biomeId: number): void => {
    const i = Math.min(BIOME_COUNT - 1, Math.max(0, biomeId | 0));
    uVoxMat.value.copy(matW[i]);
    const g = grainW[i];
    const t = tintW[i];
    // THE THREE-BIN PARTITION COLLAPSES TO TWO, and the collapse is not
    // arbitrary. The terrain's coarse bin is an 11.6 m tile, which at the
    // 0.4 m to 4 m the dug face is looked at from would show a twentieth of
    // one tile: a constant, i.e. a level shift with no texture in it. So the
    // fine bin drives the fine tile and the other two drive the coarse one,
    // which preserves each biome's fine-to-broad RATIO (the thing that makes
    // regolith read finer than a snowdrift) while spending both tiles inside
    // the range the surface is actually seen at.
    uVoxBiome.value.set(g.x, g.y + g.z, g.w, t.w);
    uVoxTint.value.set(t.x, t.y, t.z);
  };
  setBiome(0);

  const setAnchor = (cell: readonly [number, number, number], cellM: number): void => {
    // Euclidean modulo: the anchor cell is a running MINIMUM and goes negative
    // as soon as the player digs toward the body's origin, and JavaScript's %
    // keeps the sign of the dividend. A negative offset here would still be
    // congruent, but it would not be bounded, which is half of what this
    // reduction is for.
    const mod = (v: number): number =>
      ((v % ORIGIN_PERIOD_CELLS) + ORIGIN_PERIOD_CELLS) % ORIGIN_PERIOD_CELLS;
    uVoxOrigin.value.set(mod(cell[0]) * cellM, mod(cell[1]) * cellM, mod(cell[2]) * cellM);
  };

  return { material: m, setBiome, setAnchor, dispose: () => m.dispose() };
}
