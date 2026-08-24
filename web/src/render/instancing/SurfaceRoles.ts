// ROLE -> FAMILY: the client's copy of surfaces.json's two role tables, the
// family vocabulary itself, and the four lookups every batch path goes through
// to turn an authored material name into a surface family.
//
// Split out of Surfaces.ts at the 400-line cap (2.2 rule 1). A pure move: the
// table and the lookups are unchanged, and Surfaces.ts imports and RE-EXPORTS
// all of it, so every existing import site keeps reaching for these through
// Surfaces.js exactly as before.
//
// `rolesSeen` and `unknownRoles` live here rather than with the rest of the
// module state because `familyForRole` is the ONLY writer of either, and a
// counter that lives away from its single writer is how two files end up
// disagreeing about what has been seen. `surfaceReport` reads them across the
// import, which is what an ES module binding already supports.

import type * as THREE from 'three';

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
// RN-2740: `snow` joins for the same reason, and unlike paintchip and rust it
// arrives WITH its consumer -- `Snow` points at it in the same commit, so this
// union entry is load-bearing from the first build rather than reserved.
export type Family = 'panel' | 'coarse' | 'bark' | 'ore' | 'stone' | 'fur'
  | 'paintchip' | 'rust' | 'masonry' | 'concrete' | 'ember' | 'timber'
  | 'snow' | 'leaf' | 'grass' | 'canopy' | 'suitfab' | 'suitplate' | 'flat';

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
export const ROLE_FAMILY: Readonly<Record<string, Family>> = {
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
  // RN-1880 (look audit R4): the tool haft in the first-person hand, and the
  // rawhide that lashes and wraps it. `Haft` is a SPLIT off `Bark`, on the
  // same shape as RN-1780's `Masonry` split off `Rock`: bark's field is sized
  // for a trunk at 3 to 10 m and this is the one wood surface the player
  // holds at 0.62 m, where `timber`'s 1097 texels/m clears the ~1000 px/m
  // first-person floor texgen's own FAMILY_SIZE block already set for
  // `suitfab` and `suitplate`. `Rawhide` reuses `suitfab` for that floor's
  // sake rather than adding a second family at the same distance.
  // Moves in the same commit as texgen's table (RN-100's rule).
  Haft: 'timber', Rawhide: 'suitfab',
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
  // RN-1815: the launch pad leaves `masonry` for a POURED family of its own.
  // RN-1780 fixed masonry's world SCALE and deliberately reused stone's
  // generator, so masonry is still a field of 22 cm fractured facets - right
  // for a quarried ruin, wrong for a pad whose surfaces were cast against
  // formwork. The pad's verifier read its 2 m outer skirt as "a repeating
  // dark aggregate or rock tile rather than poured concrete". `concrete`
  // carries board marks, form panel joints, tie holes, blowholes and stains
  // instead, and it answers the "visible repeat" half of that finding by
  // ORIENTATION: the pad's skirt is 24 m long and 1.55 m tall, so at a 1.8 m
  // tile only the horizontal axis can ever be counted, and every loud feature
  // in this family varies along v. `Masonry` stays for the ruin and the
  // foundation deck. Moves in the same commit as texgen's table (RN-100).
  // RN-1820 adds `ConcreteLean`/`ConcreteRich`: the plinth's POUR BAYS, the
  // same material at +-9 counts of luma. They are palette rows and nothing
  // else - same family, same three PNGs, zero texture memory - because the
  // finding they answer is that the tone is uniform over 24 m and a 1.8 m
  // tiling map cannot say anything at 6 m without saying it 13 times.
  Concrete: 'concrete', ConcreteDark: 'concrete', ConcreteSoot: 'concrete',
  ConcreteLean: 'concrete', ConcreteRich: 'concrete',
  // RN-1815: soot on steel shares `SteelRust`'s family on purpose. The steel
  // under a flame trench's carbon is oxidised, so the flake relief has to
  // read through the deposit (RN-859's rule, where SuitGrime reused suitfab
  // so the weave reads through the dirt); the role differs by palette only,
  // which is where the dark near-neutral matte lives.
  Soot: 'rust',
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
  // RN-2245: a THIRD card family, worn by exactly one thing -- the `_LOD3`
  // crown impostor in `props_canopy.glb`. A separate family and not a fifth
  // `leaf` role because the two textures are pictures of different objects:
  // `leaf` is one conifer frond (and every `OF_Leaf*` consumer maps it as one,
  // down to the bough cards on the tree the player is standing next to),
  // `canopy` is one whole tree crown. Moves in the same commit as texgen's
  // table (RN-100's rule).
  Canopy: 'canopy',
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
  // RN-2700 (World Audit R6 rank 1) split `Snow` off `Ice` and left it on
  // `flat`. RN-2740 moves it to its own family, and the reversal is worth
  // stating rather than just editing, because BOTH decisions are correct and
  // only one fact separates them.
  //
  // R6 named the FAMILY as the defect ("the same surface family as glass, oil,
  // skin, water and every status chip"). That framing was REFUTED and stays
  // refuted: `flat` binds no map, so it could not have caused the 46.21-count
  // warm inversion at `mtnslope` row 191, and RN-2700 proved by isolation that
  // the inversion lived in the MATERIAL -- a 33-count-of-chroma blue at
  // roughness 0.25 -- of which the palette hex carried 88 per cent of the
  // recovery. Nothing here revisits that.
  //
  // What RN-2700 could not answer was the MICRO-RELIEF half, and its stated
  // reason for staying on `flat` was that no texgen family was a picture of
  // snow: borrowing `coarse` would have divided a soil map's spread about a
  // 0.1806 mean back through `material.color` and swung a 0.76-albedo drift by
  // half its value every 0.75 m. RN-2740 authored the family instead of
  // borrowing one, and re-measured that exact trap against it before moving:
  // mean 0.5574, per-texel ratio 0.9053..1.0952, so the drift renders
  // 0.691..0.836 and the tile-mean luma moves +0.0166 per cent. See texgen's
  // ROLE_FAMILY entry and rendering.md 2.53.
  //
  // Moves in the same commit as texgen's table (RN-100's rule:
  // verifyAgainstManifest makes a one-sided move a failed smoke run, and
  // check-roles.mjs makes it a failed build).
  Snow: 'snow',
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
export const REFERENCED_FAMILIES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ROLE_FAMILY),
  'panel',
  'fur',
]);

export const rolesSeen = new Map<string, Family>();
export const unknownRoles: string[] = [];

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
 * The three CARD families, named here so a METRE-UV consumer can refuse them
 * (RN-1478; `canopy` joined at RN-2245).
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
export const CARD_FAMILIES: ReadonlySet<string> = new Set<string>(
  ['grass', 'leaf', 'canopy']);

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
