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
// NO ALBEDO MAP ON THE MACHINE PATH, EVER (RN-176 narrowed this from a global
// ban). `MachineBatch` sets `vertexColors: true` and its `onBeforeCompile`
// writes `diffuseColor.rgb` AFTER `<map_fragment>`, so a base-colour map would
// be silently overwritten for four of five roles. Normal, roughness, metalness
// and AO all land earlier in the meshphysical fragment, so all four survive it
// (ASSET-SPECS 2.8). That argument is SPECIFIC to the machine hook: the flora
// batch paths (PropLibrary, NodeBatch) have no such hook, and the albedo CARD
// families (leaf, grass) attach `map` + alphaTest there. MachineBatch is
// pinned to 'panel', which carries no albedo, so the ban holds structurally:
// an albedo can only ever reach a family the machine path never asks for.
//
// UVs ARE IN METRES, so the consumer sets `repeat = 1 / tile_m` and the texel
// density is a JSON edit rather than a rebuild of 48 binaries.

import * as THREE from 'three';

import { applyFoliageTone, FOLIAGE_TONE, foliageToneState, setFoliageTone } from './FoliageTone.js';

export type Family = 'panel' | 'coarse' | 'bark' | 'ore' | 'fur' | 'leaf'
  | 'grass' | 'flat';

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
};

const FOLIAGE_TONE_FAMILIES = new Set(Object.keys(FOLIAGE_TONE));

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
  /** THREE shapes now (RN-455). A tiling PBR surface carries normal+orm; an
   *  albedo CARD family carries `albedo` in unit space with an alphaTest; and
   *  a tiling BODY family carries all three, metre UVs, no alpha. The union is
   *  the same fields, so a consumer is still "whatever this family declares". */
  normal?: THREE.Texture; orm?: THREE.Texture; albedo?: THREE.Texture;
  tileM?: number; sizePx: number; vramBytes: number;
  alphaTest?: number; albedoMean?: number;
}

interface Reg {
  label: string; family: Family; mat: THREE.MeshStandardMaterial;
  /** The material's own colour as authored, captured on first albedo apply so
   *  the mean-neutral compensation (x 1/albedo_mean) is idempotent and the
   *  `albedo: false` toggle can restore the exact pre-texture colour. */
  baseColor: THREE.Color | null;
}

/** Which maps are currently bound. All true is the shipped state.
 *  `?leaftex=0` boots with the albedo cards off (standing rule 7 isolation);
 *  `setMaps({albedo})` flips them inside one settled frame for matched pairs. */
const state = {
  normal: true, orm: true,
  albedo: new URLSearchParams(self.location.search).get('leaftex') !== '0',
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
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
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
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
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
    if (f.albedo !== undefined) {
      surf.albedo = f.uv_space === 'unit' || f.tile_m === undefined
        ? await makeAlbedoTexture(DIR + f.albedo.file, f.wrap)
        : await makeTilingAlbedo(DIR + f.albedo.file, f.tile_m);
      surf.alphaTest = f.alpha_test;
      surf.albedoMean = f.albedo_mean;
      surf.vramBytes += per;
    }
    if (f.normal !== undefined && f.orm !== undefined && f.tile_m !== undefined) {
      const [normal, orm] = await Promise.all([
        makeTexture(DIR + f.normal.file, f.tile_m),
        makeTexture(DIR + f.orm.file, f.tile_m),
      ]);
      surf.normal = normal;
      surf.orm = orm;
      surf.tileM = f.tile_m;
      surf.vramBytes += per * 2;
    }
    // A family declaring NEITHER shape is tolerated and skipped, which is the
    // bark precedent made structural: a family addition must not break an
    // older client.
    if (surf.albedo === undefined && surf.normal === undefined) continue;
    surfaces.set(name as Family, surf);
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
  if (s.albedo !== undefined) {
    // The albedo card path (RN-181). Three composes
    //   diffuse = material.color x map x vertexColour x instanceTint
    // so the map is a FOURTH multiplier and would darken every card by its
    // own mean. `albedo_mean` is measured into the manifest for exactly this:
    // the material colour is scaled by 1/mean so the modulation is
    // mean-neutral and the card keeps its palette brightness. alphaTest is
    // the manifest's declared cutoff, and the depth material follows it
    // (three's shadow variant copies map+alphaTest, WebGLShadowMap:481).
    const on = state.albedo;
    if (r.baseColor === null) r.baseColor = r.mat.color.clone();
    r.mat.map = on ? s.albedo : null;
    r.mat.alphaTest = (on && s.alphaTest !== undefined) ? s.alphaTest : 0;
    const k = (on && s.albedoMean !== undefined && s.albedoMean > 0)
      ? 1 / s.albedoMean : 1;
    r.mat.color.copy(r.baseColor).multiplyScalar(k);
    // AFTER the mean-neutral scale and never before it. `albedo_mean` is a
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
  r.mat.roughnessMap = state.orm ? (s.orm ?? null) : null;
  r.mat.metalnessMap = state.orm ? (s.orm ?? null) : null;
  r.mat.aoMap = state.orm ? (s.orm ?? null) : null;
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
  const r: Reg = { label, family, mat, baseColor: null };
  registered.push(r);
  apply(r);
}

export interface MapState { normal: boolean; orm: boolean; albedo: boolean }

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
