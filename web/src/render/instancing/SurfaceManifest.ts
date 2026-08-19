// THE SHIPPED MANIFEST: where it lives, what version this client reads, the
// shape it declares, the `?tile=` override that displaces one of its fields,
// and the three-way check that the client's copied role table still agrees
// with it.
//
// Split out of Surfaces.ts at the 400-line cap (2.2 rule 1). A pure move;
// Surfaces.ts imports and re-exports what its callers reached for.
//
// `mismatches` lives here because `verifyAgainstManifest` is its only writer,
// for the reason SurfaceRoles gives about `rolesSeen`.

import { CARD_FAMILIES, ROLE_FAMILY } from './SurfaceRoles.js';

export const DIR = 'assets/textures/';

// The manifest schema version this client knows how to read (D-016). Bumped
// alongside a field's meaning changing (albedo_mean -> albedo_mean_linear,
// v1 -> v2) so a stale build fails loudly in `ready` rather than dividing by
// a raw-sRGB mean it was never written to expect.
export const SURFACES_MANIFEST_VERSION = 2;

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
export const TILE_OVERRIDE: Readonly<Record<string, number>> = ((): Record<string, number> => {
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

export interface ManifestMap { file: string; bytes: number; sha256: string }
export interface ManifestFamily {
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
export interface Manifest {
  version: number; zlib: string;
  families: Record<string, ManifestFamily>;
  roles: Record<string, string>;
  flat_roles: Record<string, string>;
}

export const mismatches: string[] = [];

export function verifyAgainstManifest(m: Manifest): void {
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
