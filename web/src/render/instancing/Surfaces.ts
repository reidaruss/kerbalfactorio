// The shared tiling surfaces (ASSET-SPECS 2.8, DW-35) and the ONE place that
// decides which of them a material gets. New file: the three batch paths
// (MachineBatch, NodeBatch, PropLibrary) each build their own materials and each
// copy-pasted the same `normalize()`, so putting the decision here is what stops
// a third copy of it drifting.
//
// LOAD ONCE, SHARE EVERYWHERE. Six PNGs total, ~5.7 MiB of base VRAM for the
// whole 48-asset set. A per-file texture would multiply that by the asset count,
// which is the entire reason the texture pass shipped two shared tilings instead
// of per-asset maps.
//
// THE MACHINE PATH NOW CARRIES AN ALBEDO, AND THE BAN ABOVE IT IS RETIRED
// RATHER THAN QUIETLY BROKEN (RN-560). The paragraph that stood here said
// "NO ALBEDO MAP ON THE MACHINE PATH, EVER", and closed with the structural
// guarantee that `MachineBatch` is pinned to 'panel', 'panel' carries no
// albedo, and therefore an albedo could only ever reach a family the machine
// path never asks for. RN-553 gave `panel` a tiling albedo, which made the
// last sentence FALSE while every word above it still read as current. A
// comment asserting a guarantee that has stopped holding is worse than no
// comment, because the next lane reasons from it instead of from the code.
//
// WHAT IS ACTUALLY TRUE, ROLE BY ROLE. `MachineBatch` sets `vertexColors:
// true` and its `onBeforeCompile` writes `diffuseColor.rgb` after
// `<map_fragment>`, but it does so INSIDE a role test, so the map's fate
// differs per role rather than being lost wholesale:
//
//   role 0  every plinth, body, collar, plate, greeble and brick: the hook
//           does not run at all, so the albedo survives intact. This is the
//           overwhelming majority of machine surface area and it is the
//           entire point of giving `panel` an albedo.
//   roles 2,3,4  belt decks and both curve handednesses: `mix(diffuseColor,
//           cargo, blob)`, so the albedo survives wherever there is no cargo
//           blob and is displaced where there is. That is correct: cargo is
//           meant to cover the deck it sits on.
//   role 1  the status chip: `diffuseColor.rgb = c * 0.22`, a hard write. The
//           albedo is discarded. Also correct: an indicator's colour is the
//           entity's visual state and must not be modulated by paint wear.
//
// The mean-neutral divide holds across all of this because it lives in
// `material.color` (x 1/albedo_mean_linear) and three composes
// `material.color x map x vertexColour`, both of which land before the hook.
// Normal, roughness, metalness and AO land earlier still (ASSET-SPECS 2.8).
//
// NOT MEASURED IN THE CLIENT, AND SAID SO. The above is read off the shader
// source and the three composition order, not off a frame. The in-game look
// of the machine albedo is owed.
//
// UVs ARE IN METRES, so the consumer sets `repeat = 1 / tile_m` and the texel
// density is a JSON edit rather than a rebuild of 48 binaries.

import * as THREE from 'three';

import { applyFoliageTone, FOLIAGE_TONE, foliageToneState, setFoliageTone } from './FoliageTone.js';
import { loadTexture } from '../../assets/Loaders.js';

// RN-1550: `paintchip` and `rust` join the union. Both have been IN the shipped
// manifest since RN-1474/RN-1475 and neither was ever nameable here, because
// this type is written against the roles the client can encounter and no role
// pointed at either one. That is the correct state for a family with no
// consumer and the wrong one the moment a role does: `familyForRole` returns
// this type, so an unlisted family is a compile error at the table rather than
// an untextured surface in the game, which is the failure mode this file's
// three-way manifest check exists to make loud.
// RN-1780: `masonry` (look audit R3, the ruin/foundation/launch-pad world
// scale split off `stone`) and `ember` (look audit R6, the firebox peep and
// sight strip's emissive map) join the union for the same reason paintchip
// and rust did above.
export type Family = 'panel' | 'coarse' | 'bark' | 'ore' | 'stone' | 'fur'
  | 'paintchip' | 'rust' | 'masonry' | 'ember'
  | 'leaf' | 'grass' | 'suitfab' | 'suitplate' | 'flat';

/**
 * Role -> family. This is a COPY of `surfaces.json`'s two tables and it is
 * deliberately a copy: `NodeBatch.build()` is synchronous and must bucket a
 * material the instant the glTF lands, so a decision that waits on a fetch would
 * be a race whose losing branch is a rock normal map on a leaf card. The copy is
 * checked against the shipped manifest as soon as it arrives (`mismatches`), and
 * a disagreement is a console.error, which fails a smoke run.
 *
 * `flat` is not a third texture set. It is the recorded decision NOT to map a
 * role, one reason per entry in the manifest's `flat_roles`.
 */
const ROLE_FAMILY: Readonly<Record<string, Family>> = {
  Hazard: 'panel', Steel: 'panel',
  SteelDark: 'panel', SteelLight: 'panel',
  // RN-1493 / RN-1494 / RN-1550. The consumers of the D-020 vocabulary that
  // RN-1474 and RN-1475 shipped unreferenced. The full argument is in texgen's
  // copy of this table, which is the authority; in one line each: `Accent` is
  // PAINT ON plate and never plate, and `paintchip` is authored as exactly
  // that coating failing, so the role and the family finally describe one
  // object; `SteelWorn` is a separate `paintchip` consumer for paint failing
  // where the machine gets HIT rather than a painted band, so it does not
  // collide with `Accent`; `SteelRust` is a new role rather than a
  // re-pointing because every existing steel role is worn by the rockets and
  // the station too, and a rusted orbital hull is a worse claim than an
  // unweathered smelter or miner.
  //
  // INTEGRATION NOTE (art-forms merge, 2026-08-13): `SteelRust` was minted
  // once per lane (smelter hot path, then independently the miner's wet-ore
  // path) with two different constants. `of_lib.PALETTE`'s copy of this
  // decision has the full resolution: ONE `SteelRust` role, carrying the
  // art-forms constants (834F2A, 0.35, 0.92) everywhere, because that value
  // is what the smelter lane's own report already asked for.
  //
  // Moves in the same commit as texgen's table (RN-100's rule:
  // verifyAgainstManifest makes a one-sided move a failed smoke run, and
  // check-roles.mjs makes it a failed build).
  Accent: 'paintchip',
  SteelWorn: 'paintchip', SteelRust: 'rust',
  // SuitAccent stays on `panel` and that is deliberate rather than an
  // oversight: rocket_common.py and build_lander_landed.py both paint with it,
  // so it is NOT a player-only role and moving it would re-surface another
  // lane's assets.
  SuitAccent: 'panel',
  // RN-643 / RN-644: the pressure garment. `Suit`, `SuitDark` and `Plate` are
  // used by build_player_body.py, build_player_fp_arms.py and
  // build_armour_set.py and by NOTHING else in the repo, which is what makes
  // re-pointing them a player-only act. They were on `panel`, and panel
  // encodes MANUFACTURE OUT OF PLATE (seams, rivet rows, a weld bead), which
  // is the wrong fact about a woven garment in the way `coarse` was the wrong
  // fact about bark. Section 2.1 item 4 measures panel's effective roughness
  // band at 0.032 and names it as the plastic read on every machine, plate and
  // suit; suitfab and suitplate measure 0.224 and 0.268 on the same roles.
  // Moves in the same commit as texgen's table (RN-100's rule:
  // verifyAgainstManifest makes a one-sided move a failed smoke run, and it
  // did exactly that when this edit was first forgotten).
  // RN-950: `SuitGrime` wears the SAME family the suit does, and the reason it
  // is on `suitfab` rather than on a family of its own is texgen's: the dirt is
  // meant to read as dirt ON fabric, so the weave has to come through it, and
  // the roughness that separates the two lives in the glTF material (0.92
  // against SuitDark's 0.70) rather than in the surface. This row was in
  // texgen's table and in the shipped manifest and NOT here, so the grime drew
  // with no weave and no ORM while keeping its roughness, which is exactly the
  // half of the effect that survives a missing surface family.
  Suit: 'suitfab', SuitDark: 'suitfab', SuitGrime: 'suitfab',
  Plate: 'suitplate',
  Bark: 'bark', BarkLight: 'bark',
  Coal: 'coarse', Copper: 'coarse',
  Iron: 'coarse', Regolith: 'coarse',
  Rubber: 'coarse', Sand: 'coarse', Soil: 'coarse',
  // RN-742: the HOST ROCK roles leave `coarse` for their own family, on the
  // exact argument that moved Bark out of it and Suit out of `panel`: the
  // family encoded the wrong FACT about the surface. Measured, `coarse` has a
  // mean normal tilt of 7.69 degrees with a MAXIMUM of 27.12, so no texel in
  // it is steeper than 27 degrees, and 0.0 per cent of its ORM green falls
  // below 0.60, so no part of it is ever smooth. Host rock that can neither
  // glint nor catch a raking sun was the flattest thing in the game by
  // measurement, and it is most of the screen area of every boulder, the whole
  // spire and all the scree.
  //
  // What stays on `coarse` is what `coarse` actually describes well: granular
  // and dug-up things. Sand, Soil, Regolith, the Coal and Iron and Copper ITEM
  // chunks, and Rubber.
  //
  // Moves in the same commit as texgen's table (RN-100's rule:
  // verifyAgainstManifest makes a one-sided move a failed smoke run).
  Rock: 'stone', RockDark: 'stone',
  // RN-1780 (look audit R3): `Masonry`/`MasonryDark`, NOT a re-point of
  // `Rock`/`RockDark`. Measured off the shipped bytes, `stone`'s consumers
  // span 0.14 m (an item-atlas chunk) to 35.2 m (the ruin), and RN-953
  // already refused retiling `stone` itself: a tile that reads on the ruin
  // puts a 1.4 m boulder at 0.78 repeats. `Masonry`/`MasonryDark` are worn
  // by exactly the ruin, the foundation deck and the launch pad (all
  // `structures`/`rocket` scale); every boulder, the spire, the scree and
  // the smelter's hearth surround stay on `Rock`/`RockDark` -> `stone`.
  // Moves in the same commit as texgen's table (RN-100's rule).
  Masonry: 'masonry', MasonryDark: 'masonry',
  // RN-157: the ore SEAM roles (Admin's ruling: ore-in-rock and refined-item
  // are different substances that coincidentally shared a colour; OF_Iron and
  // friends stay untouched on the items). The `ore` family is vein banding
  // with crystalline grain, and its ORM's roughness spread is what makes a
  // seam glint under a moving sun. Moves in the same commit as texgen's table
  // (RN-100's rule: verifyAgainstManifest makes a disagreement a failed run).
  CoalSeam: 'ore', CopperOre: 'ore', IronOre: 'ore',
  // RN-181: the foliage roles leave `flat` for the two ALBEDO CARD families.
  // The recorded flat_roles objections are honoured, not overruled: they
  // refused a NORMAL map on a card, and these families carry none. What a
  // card family adds is an albedo whose alpha IS the shape, alpha-tested at
  // the manifest's declared cutoff. Moves in the same commit as texgen's
  // table (RN-100's rule: verifyAgainstManifest fails the run otherwise).
  Grass: 'grass',
  Leaf: 'leaf', LeafDeep: 'leaf', LeafDry: 'leaf', LeafLight: 'leaf',
  // RN-455, retargeted RN-461: the first CREATURE family, and the first
  // tiling family that also carries an albedo. The ROLE names stay chitin
  // because a tarantula cuticle is chitin; the FAMILY is `fur` because the
  // setae growing out of it are what you see. The two eye roles stay flat
  // and the manifest records why: an eye is the one part of a spider that
  // genuinely is a polished sphere, and it is 3 to 6 cm across.
  Chitin: 'fur', ChitinBand: 'fur', ChitinUnder: 'fur',
  Fang: 'fur',
  EmissiveState: 'flat', EyeDark: 'flat', EyeGlow: 'flat', Glass: 'flat',
  Ice: 'flat', Oil: 'flat', Skin: 'flat', Water: 'flat',
  // RN-1780 (look audit R6): the firebox peep and sight strip. A role of its
  // own rather than a re-point of `EmissiveState` (which stays `flat` for
  // every status chip in the game, 23 other build scripts' worth), because
  // `MachineFx.ts` and `MachineGeometry.roleOf` both match material names by
  // the `EmissiveState` SUFFIX, which this role name preserves on purpose so
  // `MachineGlow`'s per-instance colour, intensity and flicker keep driving
  // it unchanged. `ember`'s emissive map supplies only the spatial variation
  // that was missing (peep iqr 0.93, strip iqr 4.15 against 40.54/72.68 for
  // the plate beside them).
  EmberEmissiveState: 'ember',
};

const FOLIAGE_TONE_FAMILIES = new Set(Object.keys(FOLIAGE_TONE));

/**
 * RN-1476. Every family something in this build can actually ask for, derived
 * from ROLE_FAMILY rather than listed, so it cannot drift out of step with it.
 * `ready` skips loading any manifest family absent from this set; see the long
 * note at the loop for why an unreferenced family is worth skipping at all.
 *
 * THE TWO LITERALS ARE UNIONED IN ON PURPOSE. `SpiderFlock` attaches 'fur' as
 * a STRING LITERAL rather than through a role lookup, so it does not reach
 * `familyForRole` and would not be implied by the role table if the chitin
 * roles were ever moved off it. 'panel' is here for the same reason and stays
 * even though RN-1478 made `MachineBatch` resolve through the role table like
 * everything else: it is that path's declared FALLBACK for a `flat` or card
 * role, so a machine can still ask for it with no role naming it. Both are in
 * ROLE_FAMILY's values today, which is exactly why leaving them implicit is a
 * trap: the set would keep working right up until a role move silently
 * un-referenced a family a call site still attaches, and the failure would be
 * an untextured machine with no error anywhere. `familyForRole`'s other callers
 * (PropLibrary, NodeBatch, PlayerRig, MachineGeometry) all resolve through the
 * role table and need no entry here.
 */
const REFERENCED_FAMILIES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ROLE_FAMILY),
  'panel',
  'fur',
]);

const DIR = 'assets/textures/';

// The manifest schema version this client knows how to read (D-016). Bumped
// alongside a field's meaning changing (albedo_mean -> albedo_mean_linear,
// v1 -> v2) so a stale build fails loudly in `ready` rather than dividing by
// a raw-sRGB mean it was never written to expect.
const SURFACES_MANIFEST_VERSION = 2;

/**
 * RN-953. Override a family's `tile_m` from the URL, e.g.
 * `?tile=suitplate:0.12` or `?tile=suitplate:0.12,stone:0.5`.
 *
 * WHY THIS IS A SWEEP AND NOT A NEW DEFAULT. `tile_m` is authored in
 * texgen.py's `FAMILY_TILE_M` and baked into the shipped manifest, and that is
 * the right home for it: the tile size is an argument about the generator's own
 * feature spectrum. But the manifest's `uv_space: metres` contract exists
 * precisely so the consumer divides, which means the client can ASK the
 * question without a regeneration, and asking it costs one multiply instead of
 * eight PNGs and a full re-bake of every other family.
 *
 * THE QUESTION IS REAL AND THE PREMISE UNDER IT WAS MEASURED FALSE.
 * `suitplate`'s generator states its consumers are "3 to 6 cm parts" and sizes
 * the tile at 0.4 m so that "a tile eight times the largest of them cannot
 * repeat on any one part". Measured off the shipped bytes, by connected
 * component through the index lists of all four .glb that carry `OF_Plate`:
 * the literal 3 to 6 cm band contains ZERO components; the small cluster is 32
 * finger plates at 24.7 to 28.4 mm totalling 0.001 per cent of the material's
 * area; and the parts a player actually looks at are 146 to 455 mm, which at a
 * 0.4 m tile carry 0.4 to 1.1 repeats. One repeat means the tile's own
 * lowest-frequency content is at helmet scale, which is the "spattered
 * concrete" read, and it is the opposite failure to the one the generator was
 * defending against.
 *
 * THE BLAST RADIUS WAS THE PLAYER KIT AND NOTHING ELSE WHEN THIS WAS WRITTEN,
 * AND RN-1478 ENDED THAT. `space_station.glb` carries 99.7 per cent of all
 * `OF_Plate` surface area on 3.3 to 9.2 m hull panels, and it used to be
 * unreachable because `MachineBatch` called `attachSurface(m, 'panel', ...)`
 * unconditionally, so a machine's authored role never reached `familyForRole`.
 * **That is no longer true**: the station deck now draws on a real `suitplate`
 * layer, so a `tile_m` move on this family reaches the hull as well as the
 * suit and the sweep has to be judged on both.
 */
const TILE_OVERRIDE: Readonly<Record<string, number>> = ((): Record<string, number> => {
  const out: Record<string, number> = {};
  const raw = new URLSearchParams(self.location.search).get('tile');
  if (raw === null) return out;
  for (const part of raw.split(',')) {
    const [name, v] = part.split(':');
    const m = Number(v);
    // A malformed entry is a LOUD failure, not a silently ignored one: this is
    // a measurement flag, and a sweep that quietly ran at the default is the
    // vacuous-control shape run.mjs's own whitelist exists to stop.
    if (name === undefined || !Number.isFinite(m) || m <= 0) {
      console.error(`[of] surfaces: ?tile= entry '${part}' is not '<family>:<metres>'`
        + ' with a positive number. Nothing was overridden.');
      continue;
    }
    out[name] = m;
  }
  return out;
})();

interface ManifestMap { file: string; bytes: number; sha256: string }
interface ManifestFamily {
  /** The surface families carry normal+orm; the albedo card families (leaf,
   *  grass) carry `albedo` only, with unit UVs and an alpha_test contract.
   *  ALL map fields are therefore optional, and a family is consumed by
   *  whichever fields it declares. */
  normal?: ManifestMap; orm?: ManifestMap; albedo?: ManifestMap;
  /** RN-1462. Two ADDITIVE slots alongside the five DW-35 shipped (albedo,
   *  normal, roughness, metalness, AO). Both are TILING like normal/orm, not
   *  card-shaped like a leaf's `albedo`, so both require `tile_m` the same
   *  way normal/orm do (`ready` refuses one that does not, rather than
   *  silently discarding it). No shipped family declares either today: this
   *  lane wires the slot, texgen produces nothing for it (own report). */
  emissive?: ManifestMap;
  /** A STANDALONE alpha mask, distinct from a card family's embedded RGBA
   *  alpha channel. Reuses `alpha_test` below as its required companion
   *  rather than adding a second field for the same idea: `ready` refuses an
   *  `alpha` map with no valid `alpha_test`, mirroring D-016's
   *  albedo_mean_linear refusal, because three.js ignores `alphaMap`
   *  entirely on an opaque material with `alphaTest` at its 0 default. */
  alpha?: ManifestMap;
  tile_m?: number; size_px: number; texels_per_m?: number;
  uv_space?: 'unit' | 'metres';
  wrap?: { u: 'repeat' | 'clamp'; v: 'repeat' | 'clamp' };
  alpha_test?: number; albedo_mean_linear?: number;
  /** RN-1462. A per-family multiplier on the decoded tangent-space normal's
   *  XY (three's `material.normalScale`, applied uniformly on both axes).
   *  Absent means three's own default of 1.0: every family that ships
   *  without this field must read exactly as it did before this lane. */
  normal_scale?: number;
}
interface Manifest {
  version: number; zlib: string;
  families: Record<string, ManifestFamily>;
  roles: Record<string, string>;
  flat_roles: Record<string, string>;
}

interface Surface {
  /** THREE shapes now (RN-455). A tiling PBR surface carries normal+orm; an
   *  albedo CARD family carries `albedo` in unit space with an alphaTest; and
   *  a tiling BODY family carries all three, metre UVs, no alpha. The union is
   *  the same fields, so a consumer is still "whatever this family declares".
   *  `emissive`/`alphaMap` (RN-1462) join the union the same way. */
  normal?: THREE.Texture; orm?: THREE.Texture; albedo?: THREE.Texture;
  emissive?: THREE.Texture; alphaMap?: THREE.Texture;
  tileM?: number; sizePx: number; vramBytes: number;
  alphaTest?: number; albedoMean?: number; normalScale?: number;
}

interface Reg {
  label: string; family: Family; mat: THREE.MeshStandardMaterial;
  /** The material's own colour as authored, captured on first albedo apply so
   *  the mean-neutral compensation (x 1/albedo_mean_linear) is idempotent and the
   *  `albedo: false` toggle can restore the exact pre-texture colour. */
  baseColor: THREE.Color | null;
}

/** Which maps are currently bound. All true is the shipped state.
 *  `?leaftex=0` boots with the albedo cards off (standing rule 7 isolation);
 *  `setMaps({albedo})` flips them inside one settled frame for matched pairs.
 *  `emissive`/`alpha` (RN-1462) get the same isolation shape as normal/orm
 *  even though no shipped family uses either yet, so a probe against a
 *  future family does not also need a new toggle plumbed. */
const state = {
  normal: true, orm: true,
  albedo: new URLSearchParams(self.location.search).get('leaftex') !== '0',
  emissive: true, alpha: true,
};

const registered: Reg[] = [];
const surfaces = new Map<Family, Surface>();
const rolesSeen = new Map<string, Family>();
const unknownRoles: string[] = [];
const mismatches: string[] = [];
let manifest: Manifest | null = null;
let uvCopied = 0;
let uvSynthesised = 0;
let uvCountMismatch = 0;
/** Geometries whose UVs were copied, per consumer, so "the UVs arrived" can be
 *  asserted for the machine path separately from the node and prop paths. */
const uvBy: Record<string, number> = {};
const shaderOrder: Record<string, unknown> = {};

/** The material name minus the `OF_` prefix. `OF_SteelDark` -> `SteelDark`. */
export function roleOfMaterialName(name: string): string {
  return name.startsWith('OF_') ? name.slice(3) : name;
}

/**
 * Which surface a role takes, or `flat` for a role deliberately left unmapped.
 *
 * A role in NEITHER table is an asset-pipeline bug and is reported rather than
 * defaulted (ASSET-SPECS 2.9 (3)); it falls back to `flat`, because putting no
 * map on an unknown surface is the recoverable half of the mistake.
 */
export function familyForRole(role: string): Family {
  const f = ROLE_FAMILY[role];
  if (f === undefined) {
    if (!unknownRoles.includes(role)) {
      unknownRoles.push(role);
      console.error(`[of] surfaces: role '${role}' is in neither surfaces.json`
        + ' roles nor flat_roles. It draws UNTEXTURED. Fix the asset pipeline.');
    }
    rolesSeen.set(role, 'flat');
    return 'flat';
  }
  rolesSeen.set(role, f);
  return f;
}

/** Family for a three material, by its authored name. The batch paths' entry. */
export function familyForMaterial(m: THREE.Material): Family {
  return familyForRole(roleOfMaterialName(m.name));
}

/**
 * The two CARD families, named here so a METRE-UV consumer can refuse them
 * (RN-1478).
 *
 * A card family carries an albedo in UNIT card space whose ALPHA is the shape,
 * cut at `alpha_test`. Every batch path that box-projects its UVs in metres
 * (`copyUv` plus `repeat = 1 / tile_m`) would sample that card at a scale it
 * was never authored for AND alpha-test the result, so a solid object wearing
 * one comes back with leaf-shaped holes punched through it. That is worse than
 * the wrong map, and it is the one case where the machine path's `panel`
 * fallback is the honest answer rather than the defect: `items_atlas.glb`'s
 * `Item_LeafDry` is a 16-vertex quad authored `OF_LeafDry`, whose family is
 * `leaf`, and it stays on the base family for this reason.
 *
 * SECOND TABLE, VERIFIED RATHER THAN REMEMBERED, exactly like `ROLE_FAMILY`
 * above: `verifyAgainstManifest` checks this set against the shipped
 * manifest's own `uv_space`, so a family that becomes a card (or stops being
 * one) is a mismatch on the next boot rather than a silent hole.
 */
const CARD_FAMILIES: ReadonlySet<string> = new Set<string>(['grass', 'leaf']);

/**
 * Whether `f` is a family a metre-UV batch path can actually wear: it tiles,
 * and it is a map at all.
 *
 * `flat` is excluded because it is the recorded decision NOT to map a role, and
 * a consumer asking "which surface do I bind" must be told "none" rather than
 * handed an empty one.
 */
export function isTilingFamily(f: Family): boolean {
  return f !== 'flat' && !CARD_FAMILIES.has(f);
}

/**
 * Copy `uv` from `src` onto `dst`. UNCONDITIONALLY: the attribute is always
 * created, and the only thing the source's presence decides is whether it holds
 * the asset's UVs or zeroes.
 *
 * This is the whole of ASSET-SPECS 2.9 (1) and it lives in one function on
 * purpose. Guarding the `setAttribute` with `if (src.getAttribute('uv'))`
 * reintroduces a mixed-attribute merge: `mergeGeometries` returns `null` on a
 * mismatched attribute set and both call sites swallow that with `?? list[0]`,
 * so ONE untextured primitive anywhere in an asset would silently reduce it to
 * its first primitive. `BatchedMesh.addGeometry` is the same trap one layer
 * down. The failure mode is "most of the scene quietly disappeared".
 *
 * `uvSynthesised` and `uvCountMismatch` are counted rather than tolerated: both
 * mean an asset shipped without usable UVs, and a probe asserts they are zero.
 */
export function copyUv(src: THREE.BufferGeometry, dst: THREE.BufferGeometry,
                       count: number, tag = '?'): void {
  const a = src.getAttribute('uv');
  const uv = new Float32Array(count * 2);
  if (a === undefined) { uvSynthesised++; uvBy[`${tag}:MISSING`] = (uvBy[`${tag}:MISSING`] ?? 0) + 1; }
  else if (a.count < count) uvCountMismatch++;
  else {
    for (let i = 0; i < count; ++i) { uv[i * 2] = a.getX(i); uv[i * 2 + 1] = a.getY(i); }
    uvCopied++;
    uvBy[tag] = (uvBy[tag] ?? 0) + 1;
  }
  dst.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Record where three's map chunks sit relative to a custom `onBeforeCompile`
 * hook, off the ACTUAL shader string three handed the caller.
 *
 * `MachineBatch` overwrites `diffuseColor.rgb` at `<emissivemap_fragment>`,
 * which is the reason ASSET-SPECS 2.8 refuses an albedo map. The claim that the
 * OTHER four maps survive that edit is an ordering claim about meshphysical's
 * chunk list, and this asserts it instead of remembering it: roughness,
 * metalness and the normal frame must all resolve BEFORE the hook, and AO is
 * applied after it. If three ever reorders those chunks, this reads false.
 */
export function noteShaderOrder(tag: string, frag: string): void {
  const at = (c: string): number => frag.indexOf(`#include <${c}>`);
  const rough = at('roughnessmap_fragment');
  const metal = at('metalnessmap_fragment');
  const nrm = at('normal_fragment_maps');
  const hook = at('emissivemap_fragment');
  const ao = at('aomap_fragment');
  shaderOrder[tag] = {
    roughnessmap: rough, metalnessmap: metal, normalMaps: nrm,
    emissivemapHook: hook, aomap: ao,
    mapsResolveBeforeHook: rough > 0 && metal > 0 && nrm > 0 && hook > 0
      && Math.max(rough, metal, nrm) < hook,
    aoAppliedAfterHook: ao > hook && hook > 0,
  };
}

/**
 * An albedo card map differs from the surface maps in every setting that
 * matters: it is COLOUR (sRGB, where normal/orm are data), its UVs are UNIT
 * card space so repeat stays 1 (no metre division), u wraps because a grass
 * band may cross the seam while v CLAMPS because the card's tip rows are
 * authored alpha-0 and must dissolve rather than wrap the roots back in.
 */
function makeAlbedoTexture(url: string,
                           wrap?: { u: string; v: string }): Promise<THREE.Texture> {
  return loadTexture(url).then((t) => {
    t.wrapS = wrap?.u === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.wrapT = wrap?.v === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    return t;
  });
}

/**
 * A TILING albedo (RN-455): sRGB like a card, metre-repeated like a normal map.
 *
 * It is neither of the two existing cases and mixing them up is silent both
 * ways: loaded as a card it would show one 0.30 m tile stretched over a whole
 * creature, and loaded as a surface it would be decoded as data and come out
 * washed out. The colour space belongs to what the map MEANS and the repeat
 * belongs to what its UVs are, and those are independent.
 */
function makeTilingAlbedo(url: string, tileM: number): Promise<THREE.Texture> {
  return loadTexture(url).then((t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tileM, 1 / tileM);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.channel = 0;
    return t;
  });
}

function makeTexture(url: string, tileM: number): Promise<THREE.Texture> {
  return loadTexture(url).then((t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    // UVs are metres, so one repeat per tile_m metres.
    t.repeat.set(1 / tileM, 1 / tileM);
    // BOTH maps are data. TextureLoader leaves colorSpace at NoColorSpace,
    // which is what a normal map and a packed ORM need; naming it is cheaper
    // than re-deriving it the next time someone reads this.
    t.colorSpace = THREE.NoColorSpace;
    // three clamps this to the device maximum at upload
    // (WebGLTextures.setTextureParameters), so 16 means "as much as the GPU has".
    t.anisotropy = 16;
    // aoMap samples `vAoMapUv`, whose channel comes from the TEXTURE. Three's
    // default is 0 in r185 (Texture.channel = 0), but the ORM image is one
    // object in three slots, so stating it here is what keeps the AO and the
    // roughness reading the same UV set if anyone ever adds a second one.
    t.channel = 0;
    return t;
  });
}

/**
 * RN-1462. Emissive is LIGHT COLOUR, unlike normal/orm/alpha which are DATA:
 * sRGB-decoded like an albedo, but metre-tiled like normal/orm rather than
 * card-shaped in unit space, because every family that could plausibly carry
 * one (panel edge-lights, a machine indicator strip) is a tiling body family,
 * not a card. No shipped family declares `emissive` yet; this exists so the
 * day one does, `ready` below has somewhere to route it that already carries
 * the anisotropy/channel conventions the other four slots settled on.
 */
function makeEmissiveTexture(url: string, tileM: number): Promise<THREE.Texture> {
  return loadTexture(url).then((t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tileM, 1 / tileM);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.channel = 0;
    return t;
  });
}

function verifyAgainstManifest(m: Manifest): void {
  for (const [role, fam] of Object.entries(m.roles)) {
    if (ROLE_FAMILY[role] !== fam) {
      mismatches.push(`${role}: manifest ${fam}, client ${ROLE_FAMILY[role] ?? 'absent'}`);
    }
  }
  for (const role of Object.keys(m.flat_roles)) {
    if (ROLE_FAMILY[role] !== 'flat') {
      mismatches.push(`${role}: manifest flat, client ${ROLE_FAMILY[role] ?? 'absent'}`);
    }
  }
  for (const role of Object.keys(ROLE_FAMILY)) {
    if (m.roles[role] === undefined && m.flat_roles[role] === undefined) {
      mismatches.push(`${role}: client-only, absent from surfaces.json`);
    }
  }
  // RN-1478. `CARD_FAMILIES` against the manifest's own `uv_space`, on the same
  // terms as the role table above: the client's copy is checked, not trusted.
  // A card is a family whose UVs are unit card space, which is exactly the set
  // that ships no `tile_m`, so either field would do and `uv_space` is the one
  // that says what it means.
  for (const [name, f] of Object.entries(m.families)) {
    const card = f.uv_space === 'unit';
    if (card !== CARD_FAMILIES.has(name)) {
      mismatches.push(`${name}: manifest ${card ? 'card' : 'tiling'}, client `
        + `${CARD_FAMILIES.has(name) ? 'card' : 'tiling'}`);
    }
  }
  if (mismatches.length > 0) {
    console.error('[of] surfaces: the client role table disagrees with '
      + `surfaces.json on ${mismatches.length} role(s): ${mismatches.join('; ')}`);
  }
}

const ready = (async (): Promise<void> => {
  const res = await fetch(`${DIR}surfaces.json`);
  if (!res.ok) throw new Error(`surfaces.json: HTTP ${res.status}`);
  const m = await res.json() as Manifest;
  if (m.version !== SURFACES_MANIFEST_VERSION) {
    throw new Error(`surfaces.json: manifest version ${m.version}, this client `
      + `reads version ${SURFACES_MANIFEST_VERSION}. Run \`npm run sync-assets\` `
      + 'or regenerate the manifest; a mismatch means a field changed meaning '
      + '(e.g. albedo_mean -> albedo_mean_linear, D-016) and must not be read '
      + 'as the old one.');
  }
  manifest = m;
  verifyAgainstManifest(m);
  const skipped: string[] = [];
  for (const [name, f] of Object.entries(m.families)) {
    // RN-1476. A FAMILY NO ROLE WEARS IS NOT DOWNLOADED, NOT DECODED AND NOT
    // RESIDENT, and this is a cost rule rather than a correctness one.
    //
    // The loop below is EAGER: every family the manifest declares is fetched
    // and uploaded at boot, whether or not anything in the scene draws with
    // it. That was free while the manifest only ever listed families in use.
    // It stopped being free when `texgen.py` gained `paintchip` and `rust`
    // (RN-1474, RN-1475), which are the D-020 vocabulary shipped AHEAD of the
    // wiring, deliberately, following the `leaf`/`grass` precedent: a role
    // move must land in the same commit as the client change that consumes it
    // or `verifyAgainstManifest` turns a one-sided move into a failed smoke
    // run. Those two are 512 px and carry three maps each, so loading them
    // unreferenced costs about 3 MB of transfer and 8 MB of VRAM to draw
    // exactly nothing, against a whole-game texture budget of 7.9 MB.
    //
    // THE RULE IS DERIVED, NOT LISTED, which is the point. A hand-maintained
    // "not yet wired" list is a second table to drift out of step with
    // ROLE_FAMILY, and this file already carries one copied table and a
    // verifier whose whole existence (RN-951) is that copied tables drift.
    // `REFERENCED_FAMILIES` is computed from ROLE_FAMILY's own values, so the
    // moment a lane points a role at `rust` the family loads with no other
    // edit, and a family cannot be skipped while something can name it.
    //
    // THE SKIP IS ANNOUNCED rather than silent. A texture that quietly fails
    // to load and a texture nothing asked for look identical from here, and
    // this project has repeatedly paid for the pair being indistinguishable;
    // the one-line summary below is what tells a lane wiring `rust` why its
    // brand new surface is not on screen.
    if (!REFERENCED_FAMILIES.has(name)) {
      skipped.push(name);
      continue;
    }
    // Two family shapes (RN-176/RN-181). A tiling surface carries normal+orm
    // in metres; an albedo card family carries `albedo` in unit card space.
    // A family declaring NEITHER shape is tolerated and skipped, which is the
    // bark precedent made structural: a family addition must not break an
    // older client, and `f.normal.file` on an albedo family would have thrown
    // inside `ready` and taken every other family down with it.
    // One map per DECLARED field rather than one branch per family shape
    // (RN-455). The old form was `if (albedo) {...; continue}` followed by the
    // normal+orm case, which structurally could not express a family carrying
    // both, and would have silently loaded chitin as a card: one 0.30 m tile
    // stretched over a whole creature, with no normal map and no roughness.
    // Silently, because every check downstream asks "is a map bound" and one
    // was.
    const per = Math.round(f.size_px * f.size_px * 4 * (4 / 3));
    const surf: Surface = { sizePx: f.size_px, vramBytes: 0 };
    // RN-953. ONE resolved tile per family, used by every map this family
    // declares. Resolving it once rather than at each call site is the whole
    // safety of the override: an albedo left on the manifest value while the
    // normal moved would put the paint and the relief on different scales,
    // which reads as a blurred surface rather than as a wrong tile and is the
    // hardest kind of mistake to see in a picture.
    const tileM = f.tile_m === undefined ? undefined
      : (TILE_OVERRIDE[name] ?? f.tile_m);
    if (f.albedo !== undefined) {
      surf.albedo = f.uv_space === 'unit' || tileM === undefined
        ? await makeAlbedoTexture(DIR + f.albedo.file, f.wrap)
        : await makeTilingAlbedo(DIR + f.albedo.file, tileM);
      surf.alphaTest = f.alpha_test;
      surf.albedoMean = f.albedo_mean_linear;
      surf.vramBytes += per;
    }
    if (f.normal !== undefined && f.orm !== undefined && tileM !== undefined) {
      const [normal, orm] = await Promise.all([
        makeTexture(DIR + f.normal.file, tileM),
        makeTexture(DIR + f.orm.file, tileM),
      ]);
      surf.normal = normal;
      surf.orm = orm;
      surf.tileM = tileM;
      surf.vramBytes += per * 2;
    }
    // RN-1462. Both new slots are TILING, like normal/orm, so both need
    // `tile_m`; a family that declares one WITHOUT a tile size is a manifest
    // that failed to build correctly (card families have no use for either,
    // since a card already carries its shape in its own albedo alpha), and
    // gets the same loud refusal D-016 gave a missing albedo_mean_linear
    // rather than being silently skipped like the untagged bark case above.
    if (f.emissive !== undefined) {
      if (tileM === undefined) {
        throw new Error(`[of] surfaces: ${name} carries an emissive map with `
          + 'no tile_m (card families use unit UVs and have no metre tile '
          + 'size, so an emissive map on one is meaningless). Regenerate '
          + 'surfaces.json.');
      }
      surf.emissive = await makeEmissiveTexture(DIR + f.emissive.file, tileM);
      surf.vramBytes += per;
    }
    if (f.alpha !== undefined) {
      if (tileM === undefined) {
        throw new Error(`[of] surfaces: ${name} carries an alpha map with no `
          + 'tile_m (card families use unit UVs and have no metre tile size). '
          + 'Regenerate surfaces.json.');
      }
      if (f.alpha_test === undefined || !(f.alpha_test > 0)) {
        // MeshStandardMaterial ignores `alphaMap` entirely on an opaque
        // material once `alphaTest` sits at its 0 default: a map bound
        // without a valid alpha_test is a silent no-op indistinguishable
        // from the map never having loaded at all, exactly the shape D-016
        // refused for a present albedo with no albedo_mean_linear.
        throw new Error(`[of] surfaces: ${name} has an alpha map but no `
          + `valid alpha_test (got ${String(f.alpha_test)}). Regenerate `
          + 'surfaces.json.');
      }
      surf.alphaMap = await makeTexture(DIR + f.alpha.file, tileM);
      surf.alphaTest = f.alpha_test;
      surf.vramBytes += per;
    }
    surf.normalScale = f.normal_scale;
    // A family declaring NONE of the four map shapes is tolerated and
    // skipped, which is the bark precedent made structural: a family
    // addition must not break an older client. `emissive`/`alphaMap` join the
    // albedo/normal check (RN-1462) because both require `tile_m` above and
    // so can appear on a family that declares neither of the original two.
    if (surf.albedo === undefined && surf.normal === undefined
      && surf.emissive === undefined && surf.alphaMap === undefined) continue;
    surfaces.set(name as Family, surf);
  }
  if (skipped.length > 0) {
    console.info(`[of] surfaces: ${skipped.length} manifest family(ies) not `
      + `loaded because no role wears them: ${skipped.join(', ')}. This is `
      + 'the expected state for a surface shipped ahead of its wiring; point '
      + 'a role at one in ROLE_FAMILY (and in texgen.py\'s copy of the same '
      + 'table, in the same commit) to bring it in.');
  }
  for (const r of registered) apply(r);
})();

ready.catch((e: unknown) => {
  console.error(`[of] surfaces: the shared maps did NOT load (${String(e)}).`
    + ' Every batch draws untextured; run `npm run sync-assets`.');
});

/** Resolves when the manifest and every map a family declares are bound. */
export function surfacesReady(): Promise<void> { return ready.catch(() => undefined); }

function apply(r: Reg): void {
  const s = surfaces.get(r.family);
  if (s === undefined) return;                 // 'flat', or not loaded yet
  if (s.albedo !== undefined) {
    // The albedo card path (RN-181). Three composes
    //   diffuse = material.color x map x vertexColour x instanceTint
    // so the map is a FOURTH multiplier and would darken every card by its
    // own mean. `albedo_mean_linear` is measured into the manifest for exactly this:
    // the material colour is scaled by 1/mean so the modulation is
    // mean-neutral and the card keeps its palette brightness. alphaTest is
    // the manifest's declared cutoff, and the depth material follows it
    // (three's shadow variant copies map+alphaTest, WebGLShadowMap:481).
    const on = state.albedo;
    if (r.baseColor === null) r.baseColor = r.mat.color.clone();
    r.mat.map = on ? s.albedo : null;
    r.mat.alphaTest = (on && s.alphaTest !== undefined) ? s.alphaTest : 0;
    // NO k=1 FALLBACK (D-016). A family carrying an albedo map without a
    // valid albedo_mean_linear is a manifest that failed to build correctly,
    // not a family that happens to need no compensation: silently applying
    // the map unscaled would darken the surface by its own mean and read as
    // a lighting bug nobody could trace back here. Loud beats plausible.
    if (on && (s.albedoMean === undefined || !(s.albedoMean > 0))) {
      throw new Error(`[of] surfaces: ${r.family} has an albedo map but no `
        + `valid albedo_mean_linear (got ${String(s.albedoMean)}). `
        + 'Regenerate surfaces.json.');
    }
    const k = on ? 1 / (s.albedoMean as number) : 1;
    r.mat.color.copy(r.baseColor).multiplyScalar(k);
    // AFTER the mean-neutral scale and never before it. `albedo_mean_linear` is a
    // SCALAR that undoes the map's own average darkening, so it commutes with a
    // value factor but not with a saturation one; putting the tone second means
    // the number in the manifest keeps meaning what it says and this term is a
    // separate, isolable act. Rewriting from `baseColor` on every call is what
    // makes both idempotent, so `setMaps` can be flipped any number of times.
    applyFoliageTone(r.mat.color, r.family);
    r.mat.needsUpdate = true;
    // NO early return (RN-455). A tiling body family carries an albedo AND a
    // normal AND an orm, and the `return` that used to sit here is why the
    // card path and the surface path could never be the same family.
  }
  r.mat.normalMap = state.normal ? (s.normal ?? null) : null;
  // RN-1462. Three's own default is (1,1); `s.normalScale` is undefined for
  // every family that ships without `normal_scale` (all of them, today), so
  // this is a no-op there and every existing family reads exactly as before.
  r.mat.normalScale.setScalar(state.normal && s.normalScale !== undefined ? s.normalScale : 1);
  r.mat.roughnessMap = state.orm ? (s.orm ?? null) : null;
  r.mat.metalnessMap = state.orm ? (s.orm ?? null) : null;
  r.mat.aoMap = state.orm ? (s.orm ?? null) : null;
  if (r.mat.aoMap !== null) r.mat.aoMap.channel = 0;
  // RN-1462: emissiveMap and alphaMap, the two DW-35 slots ASSET-SPECS 2.8 /
  // RN-560 left unwired. Both are optional per family exactly like
  // normal/orm/albedo above: `s.emissive`/`s.alphaMap` are undefined for
  // every family in the shipped manifest (this lane converts no texture), so
  // this is inert until texgen ships one.
  r.mat.emissiveMap = state.emissive ? (s.emissive ?? null) : null;
  r.mat.alphaMap = state.alpha ? (s.alphaMap ?? null) : null;
  if (r.mat.alphaMap !== null) {
    // alphaTest is the alpha map's REQUIRED companion, checked hard in
    // `ready` (mirroring D-016's albedo_mean_linear refusal): an alphaMap on
    // an otherwise-opaque MeshStandardMaterial is a silent no-op unless
    // alphaTest (or `transparent`) is set. Takes precedence over the albedo
    // branch's own alphaTest above, on the (currently nonexistent) family
    // that would carry both.
    r.mat.alphaTest = s.alphaTest as number;
  }
  r.mat.needsUpdate = true;
}

/**
 * Give `mat` the shared surface for `family`, now or when the maps land.
 *
 * `flat` registers the material and attaches NOTHING. That is not a no-op worth
 * skipping: it is what lets a probe assert that the roles the texture pass
 * deliberately left bare (foliage, glass, water, ice, skin, state lights) are
 * still bare, instead of inferring it from their absence.
 */
export function attachSurface(mat: THREE.MeshStandardMaterial, family: Family,
                              label: string): void {
  const r: Reg = { label, family, mat, baseColor: null };
  registered.push(r);
  apply(r);
}

export interface MapState {
  normal: boolean; orm: boolean; albedo: boolean;
  /** RN-1462. */
  emissive: boolean; alpha: boolean;
}

/**
 * Bind or unbind the maps on every registered material, in place.
 *
 * Standing rule 7's isolation, done at RUNTIME rather than as a query flag and
 * for the reason `PropLibrary.setVisible` already documents: a before/after that
 * differences two page loads cannot hold the camera, the streamed chunk set, the
 * sun angle and the terrain equal, and a normal map's whole effect is a few
 * counts of shading. Toggling inside one settled frame can. Splitting `normal`
 * from `orm` is what makes a measured difference ATTRIBUTABLE to the normal map
 * rather than to roughness, metalness and AO moving at the same time.
 */
export function setMaps(next: Partial<MapState>): MapState {
  if (next.normal !== undefined) state.normal = next.normal;
  if (next.orm !== undefined) state.orm = next.orm;
  if (next.albedo !== undefined) state.albedo = next.albedo;
  if (next.emissive !== undefined) state.emissive = next.emissive;
  if (next.alpha !== undefined) state.alpha = next.alpha;
  for (const r of registered) apply(r);
  return { ...state };
}

export interface SurfaceReport {
  ready: boolean;
  manifest: { version: number; zlib: string; families: string[] } | null;
  tableAgreesWithManifest: boolean;
  mismatches: string[];
  unknownRoles: string[];
  rolesSeen: Record<string, Family>;
  state: MapState;
  uv: {
    copied: number; synthesised: number; countMismatch: number;
    byConsumer: Record<string, number>;
  };
  shaderOrder: Record<string, unknown>;
  vramBytes: number;
  vramMB: number;
  families: {
    name: string; tileM: number | null; sizePx: number; repeat: number | null;
    albedo: boolean; alphaTest: number | null; albedoMean: number | null;
    /** RN-1462. */
    emissive: boolean; alpha: boolean; normalScale: number | null;
    /** RN-953. The manifest's own tile, and whether `?tile=` displaced it. A
     *  sweep whose flag was dropped reports the default and reads as a result,
     *  which is RN-698's failure; this makes the ask and the outcome separate
     *  fields so a probe can assert the sweep actually took. */
    manifestTileM: number | null; tileOverridden: boolean;
  }[];
  materials: {
    label: string; family: Family; hasNormal: boolean; hasRough: boolean;
    hasMetal: boolean; hasAo: boolean; aoChannel: number | null;
    normalChannel: number | null; repeat: number | null;
    wrapRepeat: boolean; dataColorSpace: boolean; anisotropy: number | null;
    aoIntensity: number; roughness: number; metalness: number;
    /** The albedo card path (RN-181): hasMap distinguishes a BOUND card map
     *  from the grey-white silent-drop failure; mapSize catches the 1x1
     *  placeholder version of the same lie (RN-78's groundshot lesson). */
    hasMap: boolean; mapSize: number | null; alphaTest: number;
    /** RN-1462. */
    hasEmissive: boolean; hasAlpha: boolean; normalScale: number;
    colorR: number;
    /** RN-345. The material colour AFTER the mean-neutral scale and the foliage
     *  tone, so a probe can read the shipped palette rather than infer it, and
     *  `toned` says whether this family was one of the two that has one. */
    colorG: number; colorB: number; toned: boolean;
  }[];
  /** RN-345. The tone's amplitude and table, published so the BOOT DEFAULT is
   *  assertable in its own right (RN-150: a flag whose default is never
   *  exercised is a feature that can ship off and measure perfectly). */
  foliageTone: { amp: number; families: Record<string, { sat: number; val: number }> };
}

/** Everything a probe needs to assert the maps are BOUND, not merely loaded. */
export function surfaceReport(): SurfaceReport {
  let vram = 0;
  const families = [];
  for (const [name, s] of surfaces) {
    vram += s.vramBytes;
    families.push({
      name, tileM: s.tileM ?? null, sizePx: s.sizePx,
      repeat: s.normal?.repeat.x ?? null,
      albedo: s.albedo !== undefined, alphaTest: s.alphaTest ?? null,
      albedoMean: s.albedoMean ?? null,
      emissive: s.emissive !== undefined, alpha: s.alphaMap !== undefined,
      normalScale: s.normalScale ?? null,
      manifestTileM: manifest?.families[name]?.tile_m ?? null,
      tileOverridden: TILE_OVERRIDE[name] !== undefined,
    });
  }
  const roles: Record<string, Family> = {};
  for (const [k, v] of [...rolesSeen].sort((a, b) => a[0].localeCompare(b[0]))) roles[k] = v;
  return {
    ready: surfaces.size > 0,
    manifest: manifest === null ? null : {
      version: manifest.version, zlib: manifest.zlib,
      families: Object.keys(manifest.families),
    },
    tableAgreesWithManifest: manifest !== null && mismatches.length === 0,
    mismatches: [...mismatches],
    unknownRoles: [...unknownRoles],
    rolesSeen: roles,
    state: { ...state },
    uv: {
      copied: uvCopied, synthesised: uvSynthesised,
      countMismatch: uvCountMismatch, byConsumer: { ...uvBy },
    },
    shaderOrder: { ...shaderOrder },
    vramBytes: vram,
    vramMB: Math.round((vram / (1024 * 1024)) * 100) / 100,
    families,
    foliageTone: foliageToneState(),
    materials: registered.map((r) => {
      const m = r.mat;
      const n = m.normalMap;
      const o = m.aoMap;
      return {
        label: r.label, family: r.family,
        hasNormal: n !== null, hasRough: m.roughnessMap !== null,
        hasMetal: m.metalnessMap !== null, hasAo: o !== null,
        aoChannel: o === null ? null : o.channel,
        normalChannel: n === null ? null : n.channel,
        repeat: n === null ? null : n.repeat.x,
        wrapRepeat: n !== null && n.wrapS === THREE.RepeatWrapping
          && n.wrapT === THREE.RepeatWrapping,
        dataColorSpace: n !== null && n.colorSpace === THREE.NoColorSpace
          && m.roughnessMap !== null && m.roughnessMap.colorSpace === THREE.NoColorSpace,
        anisotropy: n === null ? null : n.anisotropy,
        aoIntensity: m.aoMapIntensity,
        roughness: m.roughness, metalness: m.metalness,
        hasMap: m.map !== null,
        mapSize: m.map === null ? null
          : (m.map.image as { width?: number } | undefined)?.width ?? null,
        alphaTest: m.alphaTest,
        hasEmissive: m.emissiveMap !== null, hasAlpha: m.alphaMap !== null,
        normalScale: m.normalScale.x,
        colorR: m.color.r, colorG: m.color.g, colorB: m.color.b,
        toned: FOLIAGE_TONE_FAMILIES.has(r.family),
      };
    }),
  };
}

// The probe surface. Not routed through `window.__of` because Debug.ts belongs
// to another lane tonight and is at the 400-line cap; this is one property and
// it is removable in one line.
(window as unknown as { __ofSurfaces: unknown }).__ofSurfaces = {
  report: surfaceReport, setMaps, ready: surfacesReady(),
  /** RN-345. Re-applies every registered material, so a matched pair is one
   *  call apart inside one settled frame rather than two page loads apart. */
  setFoliageTone: (amp: number): number => {
    const v = setFoliageTone(amp);
    for (const r of registered) apply(r);
    return v;
  },
};
