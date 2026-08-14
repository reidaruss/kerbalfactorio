// The per-biome MATERIAL record (RN-1257): channel amplitudes, relief weights,
// detail frequency, grain tint and roughness. Split out of BiomePalette.ts on
// the CascadeShadow / TerrainVertex precedent, purely for the 400-line cap
// (2.2 rule 1).
//
// BiomePalette does NOT re-export these, which is where that precedent stops
// and it cost one page load to learn: this file imports BIOME_COUNT from
// BiomePalette to assert its own row count, so a re-export closes the cycle and
// the assertion runs while BIOME_COUNT is still undefined. It threw on the
// first frame, which is the guard at the bottom of this file doing its job.
// The three consumers import from here directly.
//
// WHY IT IS A SEPARATE FILE AND NOT SEPARATE TABLES IN THE OLD ONE:
// BiomePalette answers "what colour is this biome", which is a question about
// the SUBSTRATE and is settled by section 2.1 item 3. These three tables answer
// "what is it MADE of", which is a question about frequency, chroma break-up
// and light response, and it is settled by photograph against the Space
// Engineers bar. Two questions, two review criteria, and the second one is the
// whole of pass A3. They stay indexed by the same /core Biome enum and a biome
// that gains a colour without gaining a material should still fail review in
// one screenful, which is what the shared BIOME_COUNT import is for.

import * as THREE from 'three';

import { BIOME_COUNT } from './BiomePalette.js';

/**
 * Per-biome GROUND TEXTURE channel weights (RN-78): how much of each of
 * RN-77's four detail fields a biome's flat cover shows. Order matches the
 * texture channels: x grass clump, y rock grain, z granular, w clod.
 *
 * These are AMPLITUDES, not a partition. Each channel arrives at the shader
 * centred on 0.5 with an equal, known spread (groundtex.py's _centre), so a
 * weight vector's absolute sum is that biome's total modulation amplitude and
 * the ratios are its material character. The sums sat near 0.3 for every biome
 * until RN-1257 and now run 0.17 (Polar) to 0.99 (Forest), set by the
 * luminance rule in the section below rather than chosen. THE OLD 0.3 WAS
 * MEASURED DOWN FROM 0.6:
 * with both sample scales stacked the 0.6 table produced a +/-45% modulation
 * that photographed as dark speckle soup at the RN-15 camera (89% of moved
 * pixels darker, the tone curve compressing the bright half), and 0.35 of it
 * read as turf. Halving the table is the calibrated middle.
 *
 * Kept beside the colour table because they are indexed by the SAME /core
 * Biome enum, and a new biome that gets a colour but no weights should fail
 * review in one screenful.
 *
 * RN-1257. THE TEN BIOMES WERE NOT TEN MATERIALS, AND THIS IS THE MEASUREMENT.
 * Concatenate each biome's MAT_W and RELIEF_W rows into one 8-vector and take
 * every nearest-neighbour distance. On the shipped tables:
 *
 *     MoonHighland/CraterFloor 0.052   Plains/Hills 0.054
 *     Regolith/MoonHighland    0.055   Regolith/CraterFloor 0.100
 *     Mountains/CraterFloor    0.122
 *
 * against a typical component of about 0.1. Five of the ten biomes were within
 * one component's width of another one, so Regolith, MoonHighland and
 * CraterFloor were the same material wearing three palette entries, and so
 * were Plains and Hills. That is not a tuning complaint: no shader change can
 * make two biomes look different while their whole material description is the
 * same numbers. Retuned, the worst pair on the SAME 8-vector is Plains/Hills
 * at 0.222, a factor of 4.3, and the full record (which now also carries scale,
 * tint and roughness) separates them further still.
 *
 * THE THREE MOON BIOMES ARE THE CASE WORTH READING, because they are the ones
 * the airless bodies are made of and they are now separated on three axes at
 * once rather than by rounding: Regolith is granular-dominant and the FINEST
 * grain in the game, MoonHighland is grain-dominant and blocky, CraterFloor is
 * ponded dust over coarse broken rock. Same palette family, three reads.
 *
 * ---------------------------------------------------------------------------
 * THE ROW SUMS ARE NOT A TASTE SETTING, AND THE FOREST FRAME IS WHY
 * ---------------------------------------------------------------------------
 * This modulation is MULTIPLICATIVE (albedo *= 1 + texW * grain * tint), so the
 * CONTRAST IT PRODUCES IN COUNTS SCALES WITH THE BIOME'S OWN ALBEDO. That reads
 * as obvious written down and it had never been accounted for, and it is why
 * the first RN-1257 pair moved the section 2.1 Forest box by 0.07 counts of
 * luma while the same code visibly re-textured the ground at the RN-15 site.
 *
 * Forest's linear luminance is 0.042 and Beach's is 0.367, a factor of NINE.
 * Under one shared weight scale the brightest biome got nine times the visible
 * texture of the darkest, and the darkest is the forest floor: the exact frame
 * Reid called "plato-y smooth pastel", and the one RN-347 deliberately made
 * darker still. A uniform table therefore guaranteed that the site most in need
 * of texture received the least of it.
 *
 * The sums are now set by
 *
 *     sum(b) = k / luminance(b)^0.6
 *
 * anchored so Forest lands at 0.99, which is where the frame stops being a
 * sheet and does not yet read as speckle. That anchor is a PHOTOGRAPH, not a
 * preference: at the Forest site with the scatter hidden, ?groundtexamp=1 is
 * invisible, 6 reads as dark worms, and 2.6 reads as leaf litter with a crack
 * network. 2.6 times the old row sum of 0.38 is 0.99. The RATIOS inside each
 * row are untouched by the rescale, so a biome's material character and the
 * strength of its texture stay two decisions in two places.
 *
 * THE EXPONENT IS 0.6 AND NOT 1.0 on purpose. At 1.0 the compensation is exact
 * and every biome receives identical absolute contrast, which is wrong: bright
 * dry ground genuinely does show more absolute variation than dark wet humus,
 * and full equalisation flattens sand. 0.6 removes most of a nine-fold error
 * and leaves the part of it that is physical.
 *
 * TWO DELIBERATE DEVIATIONS FROM THE RULE, named so they are not read as
 * arithmetic slips. Ocean is clamped from the rule's 0.90 to 0.60, because the
 * bed is seen through the wet film, which darkens and desaturates it a second
 * time, and a rule that does not know about the film over-drives it. Polar
 * takes the rule's 0.17 and that happens to preserve its RN-78 intent of being
 * the quietest row in the table, because snow is the brightest biome.
 *
 * RN-78's SPECKLE-SOUP BOUND IS NOT VIOLATED BY THIS, and the distinction is
 * the whole defence of a sum near 1. That failure was a sum near 0.6 applied to
 * EVERY biome with both scales stacked, i.e. 0.6 on BRIGHT ground, and its
 * symptom was 89 per cent of moved pixels going darker. Here 0.99 lands on the
 * darkest ground in the game and 0.28 on the brightest, which is the opposite
 * distribution, and the fields being driven now carry authored structure
 * (RN-1256) instead of being smooth noise, so the amplitude buys litter and
 * cracks rather than speckle. ?groundtexamp= remains the one-flag sweep if that
 * judgement is ever contested.
 */
const MAT_W: [number, number, number, number][] = [
  [0.00, 0.08, 0.40, 0.12], // Ocean: the visible part is the sandy bed
  [0.00, 0.02, 0.23, 0.03], // Beach: sand, granular dominant
  // RN-149: Plains up 0.19 -> 0.24 (denser grass clumping was the second
  // pass's brief) and Forest clod up 0.14 -> 0.18 (the litter read), both
  // still inside the calibrated regime: the RN-78 speckle-soup failure was a
  // table SUM near 0.6 with both scales stacked; these sums move 0.32 -> 0.37
  // and 0.32 -> 0.36, nowhere near it, and the pairs are re-photographed.
  // RN-1257 moves every row: the RATIOS by the clustering measurement above,
  // the SUMS by the luminance rule below it. Both notes are in this docstring.
  [0.33, 0.00, 0.06, 0.09], // Plains: turf clumping, the purest grass read
  [0.34, 0.00, 0.08, 0.57], // Forest: litter and crack, turf subordinate
  [0.21, 0.08, 0.04, 0.17], // Hills: thin turf over STONY ground, as named
  [0.02, 0.29, 0.05, 0.04], // Mountains: scree; rock grain and nothing else
  [0.00, 0.04, 0.11, 0.02], // Polar: subdued; snow is smooth
  [0.00, 0.05, 0.25, 0.05], // Regolith: dust and pebbles, granular dominant
  [0.00, 0.13, 0.11, 0.03], // MoonHighland: blocky, grain over dust
  [0.00, 0.15, 0.31, 0.14], // CraterFloor: ponded dust over broken rock
];

/**
 * RN-1257. PER-BIOME DETAIL FREQUENCY: the partition of the ground texture's
 * amplitude across THREE sample scales. x is the FINE tap (47 repeats per
 * quad, a 1.23 m tile), y the MID (16, 3.6 m, the tap that shipped), z the
 * COARSE (5, 11.6 m).
 *
 * THE ROWS SUM TO EXACTLY 1 AND THAT IS THE POINT. `MAT_W` above owns how
 * MUCH a biome's ground is modulated; this table owns WHERE IN FREQUENCY that
 * modulation sits, and the two questions were previously the same answer for
 * every biome on the planet: `(g1 - 0.5) + 0.55 * (g2 - 0.5)`, i.e. the fixed
 * partition (0, 0.645, 0.355), everywhere, with no fine tap at all. A biome
 * could say it was rougher. It could not say it was FINER, and grain size is
 * most of what separates dust from soil from scree by eye.
 *
 * `OF_TEX_SCALE_GAIN` (1.55, in TerrainArt.glsl) carries the old total gain,
 * so a row of (0, 0.645, 0.355) reproduces the pre-RN-1257 blend exactly and
 * `?biomescale=0` writes that row into every biome as the exact control.
 *
 * THE THIRD TAP IS AN INTEGER REPEAT, 47, for RN-78's seam argument
 * unchanged: at a shared edge between same-depth chunks one chunk's
 * fract(k * 1.0) meets the other's fract(k * 0.0) and the phase is continuous
 * by arithmetic. A non-integer fine scale would put an albedo step on every
 * chunk edge, which is the one thing this coordinate cannot forgive. 47 rather
 * than 48 so the fine lattice shares no cell boundary with the 16-repeat one.
 *
 * The fine tap is what carries RN-1256's pebbles and terraced facets: at 47
 * repeats a texel is 1.2 mm, which is under a ground pixel at arm's length,
 * so the hard edges authored into `of_ground.png` finally arrive as hard
 * edges rather than as mip-averaged mottle.
 */
const SCALE_W: [number, number, number][] = [
  [0.30, 0.50, 0.20], // Ocean: grainy bed
  [0.46, 0.42, 0.12], // Beach: sand is nearly all fine grain
  [0.22, 0.53, 0.25], // Plains: tuft-scale, plus broad dry/lush patches
  [0.38, 0.50, 0.12], // Forest: a leaf is finer than a tuft
  [0.28, 0.48, 0.24], // Hills: the broadest patchiness of the turf biomes
  [0.42, 0.44, 0.14], // Mountains: chip-scale scree, little broad variation
  [0.10, 0.34, 0.56], // Polar: drifts are BROAD; almost no fine grain
  [0.52, 0.36, 0.12], // Regolith: the finest read in the game, dust and grit
  [0.38, 0.44, 0.18], // MoonHighland: coarser, blockier regolith
  [0.32, 0.48, 0.20], // CraterFloor: coarse blocks in broad ponds of dust
];

/** Vector3 array for the uBiomeScale uniform, index == the /core Biome enum. */
export function biomeScaleWeights(): THREE.Vector3[] {
  return SCALE_W.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

/**
 * RN-1257. THE GRAIN TINT: the per-channel AXIS the ground texture's
 * modulation is applied along, so a biome's detail carries hue as well as
 * value.
 *
 * Until now `albedo *= 1 + texW * mix` multiplied all three channels by the
 * same scalar, which is a VALUE-ONLY modulation by construction: the ground
 * could get lighter and darker and could never get warmer and cooler. Every
 * biome's detail therefore had exactly one degree of freedom and the frame's
 * only chroma variation was the 186 m macro tint, which is far too coarse to
 * be read as material.
 *
 * MEAN-PRESERVING BY CONSTRUCTION, and that is why this is not a colour grade
 * wearing a variation layer's clothes (the mistake the macro tint made and
 * TerrainShader's comment still carries). The grain scalar is centred on zero
 * because every channel of `of_ground.png` is centred on 0.5, so multiplying
 * it by a fixed vector leaves every channel's MEAN at exactly 1.0 whatever the
 * vector is. Only the spread moves, and moving the spread is the whole job.
 *
 * THE SIGN FLIPS BETWEEN SOIL AND ROCK, deliberately, and it is the single
 * most useful line in the table. Organic and mineral SOIL is warm where it is
 * bright (dry straw, tan litter flakes, sun-bleached sand) and cool where it
 * is dark (damp humus in the cracks). Fresh ROCK is the opposite: a clean
 * fracture face is cool grey and the weathered, iron-stained surface around it
 * is warm, which is the same iron/grey axis `ofArtStrata` already leans on for
 * cliffs. So Mountains and MoonHighland lean blue and everything made of dirt
 * leans red, and a scree slope now reads as a different SUBSTANCE from a
 * ploughed field rather than as the same substance at a different brightness.
 *
 * `?biometint=0` writes (1, 1, 1) into every row, which restores the exact
 * pre-RN-1257 scalar modulation.
 */
const TINT_W: [number, number, number][] = [
  [1.00, 1.00, 1.00], // Ocean: neutral; the water film owns the hue here
  [1.16, 1.00, 0.80], // Beach: warm dry sand over cooler damp
  [1.10, 1.04, 0.86], // Plains: dry straw highs over cooler soil
  [1.18, 1.00, 0.78], // Forest: tan litter flakes over dark cold humus
  [1.08, 1.02, 0.90], // Hills: turf, mild
  [0.92, 0.98, 1.12], // Mountains: COOL fracture against warm weathering
  [0.94, 0.99, 1.10], // Polar: snow's shadows are blue and its highs are not
  [1.05, 1.00, 0.93], // Regolith: barely chromatic, as real regolith is
  [0.97, 0.99, 1.06], // MoonHighland: anorthositic, cool against the mare
  [1.08, 1.00, 0.90], // CraterFloor: basalt and impact melt read warmer
];

/**
 * RN-1257. PER-BIOME ROUGHNESS: (base, variation), replacing the derived rule
 * `ofArtRough` used to run.
 *
 * THE MEASUREMENT THAT FORCED THIS, and it is the headline defect of the
 * terrain's material response. Roughness was `dot(normalise(MAT_W), (0.95,
 * 0.72, 0.86, 0.97))`, i.e. a weighted average of four constants that are
 * themselves within 0.25 of each other, over weight vectors that were already
 * clustered. Evaluated over the shipped table, flat-ground roughness for the
 * WHOLE PLANET was:
 *
 *     Ocean 0.863  Beach 0.864  Plains 0.945  Forest 0.953  Hills 0.947
 *     Mountains 0.821  Polar 0.845  Regolith 0.848
 *     MoonHighland 0.831  CraterFloor 0.826
 *
 * a band 0.131 wide across every biome in the game, and 0.027 wide across the
 * five rock and airless ones. Section 2.1 item 4's own rule is that a family's
 * effective roughness band must be at least about 0.15 wide or it is "a
 * constant under a moving sun", and it was written about MESH families. THE
 * TERRAIN, WHICH IS MOST OF EVERY FRAME, FAILS THAT RULE BY A WIDER MARGIN
 * THAN ANY MESH FAMILY EVER HAS, and nobody had evaluated the expression.
 *
 * Worse than narrow: it was CONSTANT PER BIOME. There was no per-pixel
 * roughness anywhere on the planet, so the specular lobe RN-731 added could
 * only ever produce one smooth highlight shape over a whole hillside. Glitter
 * needs the roughness to vary at grain scale, and now it does: `y` is the
 * peak roughness swing the biome's own grain field drives, saturating, so a
 * scree slope breaks its highlight into facets and a snowfield does not.
 *
 * The base band is 0.55 (drifted snow) to 0.97 (regolith, the most
 * backscattering natural surface there is and the one that must NEVER glint)
 * and is 0.420 wide. Rock is the smooth end and organic litter the rough end,
 * which is the opposite of the intuition that rock is rough: what makes a
 * cliff a cliff is that nothing soft stays on it.
 *
 * NO SEPARATE OFF SWITCH, and that is correct rather than an omission.
 * Roughness has exactly one consumer, `ofArtSpec` plus `ofArtSkySpec`, so
 * `?terrainspec=0` already removes every effect this table can have, exactly,
 * on one build. A second control over the same term would be two ways to
 * express one state and the pair could disagree (RN-1005's argument).
 */
const ROUGH_W: [number, number][] = [
  [0.86, 0.04], // Ocean: wet bed, uniform
  [0.84, 0.07], // Beach: packed fine sand can take a slight sheen
  [0.96, 0.05], // Plains: turf, and turf does not glint
  [0.97, 0.05], // Forest: leaf litter, the roughest ground in the game
  [0.95, 0.06], // Hills: turf over stone, so a shade under Plains
  [0.70, 0.26], // Mountains: fresh fracture is smooth, and it GLITTERS
  [0.55, 0.05], // Polar: drifted snow, smooth and uniform
  [0.97, 0.14], // Regolith: must not glint at any sun angle
  [0.90, 0.20], // MoonHighland: blocky, so more facet variance
  [0.84, 0.24], // CraterFloor: impact melt and glass are locally smooth
];

/**
 * The two vec4 arrays the shader actually reads, packed so the whole per-biome
 * material record costs TWO varyings rather than four. Layout, stated once
 * because three files index it:
 *
 *   uBiomeGrain = (scaleFine, scaleMid, scaleCoarse, roughBase)
 *   uBiomeTint  = (tintR,     tintG,    tintB,       roughVar)
 *
 * `legacyScale` is `?biomescale=0` and `flatTint` is `?biometint=0`; each
 * writes the pre-RN-1257 row into every biome so the control is one flag on
 * one build rather than two commits apart (standing rule 7).
 */
export function biomeGrain(legacyScale: boolean): THREE.Vector4[] {
  return SCALE_W.map(([x, y, z], i) => (legacyScale
    ? new THREE.Vector4(0, 1 / 1.55, 0.55 / 1.55, ROUGH_W[i][0])
    : new THREE.Vector4(x, y, z, ROUGH_W[i][0])));
}

export function biomeTint(flatTint: boolean): THREE.Vector4[] {
  return TINT_W.map(([x, y, z], i) => (flatTint
    ? new THREE.Vector4(1, 1, 1, ROUGH_W[i][1])
    : new THREE.Vector4(x, y, z, ROUGH_W[i][1])));
}

/** Vector4 array for the uBiomeMat uniform, index == the /core Biome enum. */
export function biomeMatWeights(): THREE.Vector4[] {
  return MAT_W.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
}

/**
 * Per-biome RELIEF channel weights (RN-148): how much of each of RN-147's four
 * ASYMMETRIC height fields a biome's flat cover shows through the bump. Order
 * matches of_ground_relief's channels: x sand ripple, y clod, z scree step,
 * w leaf litter.
 *
 * These weight a HEIGHT that feeds ofArtBump (lighting normal only), so their
 * scale is not comparable to MAT_W's albedo percentages: the bump amplifies a
 * field by its own frequency, and these fields are far finer than the vnoise
 * octaves. Start table authored by intent, then CALIBRATED BY PHOTOGRAPH at
 * grazing sun exactly as MAT_W was measured down from 0.6 (asymmetry is
 * invisible at noon, so the calibration frames are morning and evening).
 *
 * Biome intent, stated so a retune has something to be checked against:
 * Beach and the visible Ocean bed are RIPPLE-MARKED (the classic, and sand
 * ripples are asymmetric by formation); Forest floor is LITTER; Plains and
 * Hills are clumpy turf via CLOD; Mountains flat ground is SCREE; Polar stays
 * near zero BY DESIGN (drifted snow is smooth and RN-78 shipped it clean on
 * purpose; a snowfield with dirt clods is the named failure mode here).
 *
 * RN-1257 moves seven rows, on the clustering measurement in MAT_W's note.
 * The three airless rows were (0.06,0.12,0.22,0.02), (0.05,0.10,0.26,0.02) and
 * (0.04,0.10,0.30,0.03): three colinear points differing only in how much
 * scree they showed, which is one axis pretending to be three materials. They
 * now differ in KIND (Regolith soft dust ripple and clod, MoonHighland hard
 * steps, CraterFloor ponded clod over blocks), and Mountains takes the scree
 * channel almost outright because it is the only biome whose flat ground
 * genuinely IS talus.
 */
const RELIEF_W: [number, number, number, number][] = [
  [0.32, 0.05, 0.04, 0.00], // Ocean: ripple-marked sandy bed
  [0.46, 0.05, 0.02, 0.00], // Beach: ripples dominant
  [0.05, 0.32, 0.02, 0.06], // Plains: clumpy turf
  [0.00, 0.10, 0.02, 0.44], // Forest: leaf litter, almost purely
  [0.03, 0.24, 0.16, 0.08], // Hills: clod over the STONE its cover is thin on
  [0.02, 0.06, 0.52, 0.02], // Mountains: talus; the strongest relief in the game
  [0.03, 0.03, 0.02, 0.00], // Polar: near zero; snow is smooth
  [0.10, 0.16, 0.18, 0.03], // Regolith: soft dust ripple and clod, few steps
  [0.04, 0.08, 0.30, 0.03], // MoonHighland: hard steps, blocky
  [0.03, 0.14, 0.24, 0.04], // CraterFloor: ponded clod over broken rock
];

/** Vector4 array for the uBiomeRelief uniform, index == the /core Biome enum. */
export function biomeReliefWeights(): THREE.Vector4[] {
  return RELIEF_W.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
}

/**
 * The guard the split made mechanical. BiomePalette's own note asks that "a new
 * biome that gets a colour but no weights should fail review in one screenful";
 * with the colour in one file and the material in another that stopped being
 * true by inspection, so it is asserted instead. Module scope, so it throws at
 * IMPORT rather than on the first frame in the biome nobody tested.
 */
if (MAT_W.length !== BIOME_COUNT || RELIEF_W.length !== BIOME_COUNT
    || SCALE_W.length !== BIOME_COUNT || TINT_W.length !== BIOME_COUNT
    || ROUGH_W.length !== BIOME_COUNT) {
  throw new Error(`[of] BiomeMaterial: ${MAT_W.length}/${RELIEF_W.length}/`
    + `${SCALE_W.length}/${TINT_W.length}/${ROUGH_W.length} rows against `
    + `${BIOME_COUNT} biomes. A biome has a colour and no material.`);
}
