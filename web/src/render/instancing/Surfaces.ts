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
// THERE IS NO ALBEDO MAP AND ONE MUST NOT BE ADDED. `MachineBatch` sets
// `vertexColors: true` and its `onBeforeCompile` writes `diffuseColor.rgb` AFTER
// `<map_fragment>`, so a base-colour map would be silently overwritten for four
// of five roles. Normal, roughness, metalness and AO all land earlier in the
// meshphysical fragment (`<roughnessmap_fragment>`, `<metalnessmap_fragment>`
// and `<normal_fragment_maps>` all precede `<emissivemap_fragment>`, which is
// where that edit hooks), so all four survive it. See ASSET-SPECS 2.8.
//
// UVs ARE IN METRES, so the consumer sets `repeat = 1 / tile_m` and the texel
// density is a JSON edit rather than a rebuild of 48 binaries.

import * as THREE from 'three';

export type Family = 'panel' | 'coarse' | 'bark' | 'ore' | 'flat';

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
  Accent: 'panel', Hazard: 'panel', Plate: 'panel', Steel: 'panel',
  SteelDark: 'panel', SteelLight: 'panel', Suit: 'panel', SuitAccent: 'panel',
  SuitDark: 'panel',
  Bark: 'bark', BarkLight: 'bark',
  Coal: 'coarse', Copper: 'coarse',
  Iron: 'coarse', Regolith: 'coarse', Rock: 'coarse', RockDark: 'coarse',
  Rubber: 'coarse', Sand: 'coarse', Soil: 'coarse',
  // RN-157: the ore SEAM roles (Admin's ruling: ore-in-rock and refined-item
  // are different substances that coincidentally shared a colour; OF_Iron and
  // friends stay untouched on the items). The `ore` family is vein banding
  // with crystalline grain, and its ORM's roughness spread is what makes a
  // seam glint under a moving sun. Moves in the same commit as texgen's table
  // (RN-100's rule: verifyAgainstManifest makes a disagreement a failed run).
  CoalSeam: 'ore', CopperOre: 'ore', IronOre: 'ore',
  EmissiveState: 'flat', Glass: 'flat', Grass: 'flat', Ice: 'flat',
  Leaf: 'flat', LeafDeep: 'flat', LeafDry: 'flat', LeafLight: 'flat',
  Oil: 'flat', Skin: 'flat', Water: 'flat',
};

const DIR = 'assets/textures/';

interface ManifestMap { file: string; bytes: number; sha256: string }
interface ManifestFamily {
  /** The surface families carry normal+orm; the albedo card families (leaf,
   *  grass) carry `albedo` only, with unit UVs and an alpha_test contract.
   *  ALL map fields are therefore optional, and a family is consumed by
   *  whichever fields it declares. */
  normal?: ManifestMap; orm?: ManifestMap; albedo?: ManifestMap;
  tile_m?: number; size_px: number; texels_per_m?: number;
  uv_space?: 'unit' | 'metres';
  wrap?: { u: 'repeat' | 'clamp'; v: 'repeat' | 'clamp' };
  alpha_test?: number; albedo_mean?: number;
}
interface Manifest {
  version: number; zlib: string;
  families: Record<string, ManifestFamily>;
  roles: Record<string, string>;
  flat_roles: Record<string, string>;
}

interface Surface {
  normal: THREE.Texture; orm: THREE.Texture;
  tileM: number; sizePx: number; vramBytes: number;
}

interface Reg {
  label: string; family: Family; mat: THREE.MeshStandardMaterial;
}

/** Which maps are currently bound. Both true is the shipped state. */
const state = { normal: true, orm: true };

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

function makeTexture(url: string, tileM: number): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
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
  if (mismatches.length > 0) {
    console.error('[of] surfaces: the client role table disagrees with '
      + `surfaces.json on ${mismatches.length} role(s): ${mismatches.join('; ')}`);
  }
}

const ready = (async (): Promise<void> => {
  const res = await fetch(`${DIR}surfaces.json`);
  if (!res.ok) throw new Error(`surfaces.json: HTTP ${res.status}`);
  const m = await res.json() as Manifest;
  manifest = m;
  verifyAgainstManifest(m);
  for (const [name, f] of Object.entries(m.families)) {
    // An albedo card family (leaf, grass) has no normal/orm pair. This pass
    // SKIPS it entirely rather than half-loading it: no role maps to these
    // families yet (the role move lands atomically with the attach code), so
    // loading their maps now would spend VRAM nothing samples. Tolerating the
    // manifest entry is the load-bearing part: the bark precedent is that a
    // family addition must not break an older client, and `f.normal.file` on
    // an albedo family would have thrown inside `ready` and taken every
    // OTHER family down with it.
    if (f.normal === undefined || f.orm === undefined || f.tile_m === undefined) continue;
    const [normal, orm] = await Promise.all([
      makeTexture(DIR + f.normal.file, f.tile_m),
      makeTexture(DIR + f.orm.file, f.tile_m),
    ]);
    // Base level plus the mip chain, which converges to 4/3 of the base.
    const bytes = Math.round(f.size_px * f.size_px * 4 * 2 * (4 / 3));
    surfaces.set(name as Family, {
      normal, orm, tileM: f.tile_m, sizePx: f.size_px, vramBytes: bytes,
    });
  }
  for (const r of registered) apply(r);
})();

ready.catch((e: unknown) => {
  console.error(`[of] surfaces: the shared maps did NOT load (${String(e)}).`
    + ' Every batch draws untextured; run `npm run sync-assets`.');
});

/** Resolves when the manifest and all four maps are bound. */
export function surfacesReady(): Promise<void> { return ready.catch(() => undefined); }

function apply(r: Reg): void {
  const s = surfaces.get(r.family);
  if (s === undefined) return;                 // 'flat', or not loaded yet
  r.mat.normalMap = state.normal ? s.normal : null;
  r.mat.roughnessMap = state.orm ? s.orm : null;
  r.mat.metalnessMap = state.orm ? s.orm : null;
  r.mat.aoMap = state.orm ? s.orm : null;
  if (r.mat.aoMap !== null) r.mat.aoMap.channel = 0;
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
  const r: Reg = { label, family, mat };
  registered.push(r);
  apply(r);
}

export interface MapState { normal: boolean; orm: boolean }

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
  families: { name: string; tileM: number; sizePx: number; repeat: number }[];
  materials: {
    label: string; family: Family; hasNormal: boolean; hasRough: boolean;
    hasMetal: boolean; hasAo: boolean; aoChannel: number | null;
    normalChannel: number | null; repeat: number | null;
    wrapRepeat: boolean; dataColorSpace: boolean; anisotropy: number | null;
    aoIntensity: number; roughness: number; metalness: number;
  }[];
}

/** Everything a probe needs to assert the maps are BOUND, not merely loaded. */
export function surfaceReport(): SurfaceReport {
  let vram = 0;
  const families = [];
  for (const [name, s] of surfaces) {
    vram += s.vramBytes;
    families.push({
      name, tileM: s.tileM, sizePx: s.sizePx, repeat: s.normal.repeat.x,
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
      };
    }),
  };
}

// The probe surface. Not routed through `window.__of` because Debug.ts belongs
// to another lane tonight and is at the 400-line cap; this is one property and
// it is removable in one line.
(window as unknown as { __ofSurfaces: unknown }).__ofSurfaces = {
  report: surfaceReport, setMaps, ready: surfacesReady(),
};
