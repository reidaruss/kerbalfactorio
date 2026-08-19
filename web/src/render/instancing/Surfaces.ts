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

import { FOLIAGE_TONE, foliageToneState, setFoliageTone } from './FoliageTone.js';

// BT-276. Five leaf modules split out of this file at the 400-line cap (2.2
// rule 1). Each is a pure move of whole declarations, and every public symbol
// is RE-EXPORTED below, so every import site keeps reaching for these through
// Surfaces.js exactly as it did. What is left here is the module's own reason
// to exist: the boot fetch that turns the manifest into bound surfaces, and
// the report a probe reads off the result.
import { REFERENCED_FAMILIES, rolesSeen, unknownRoles, type Family }
  from './SurfaceRoles.js';
import { DIR, SURFACES_MANIFEST_VERSION, TILE_OVERRIDE, mismatches,
  verifyAgainstManifest, type Manifest } from './SurfaceManifest.js';
import { makeAlbedoTexture, makeEmissiveTexture, makeTexture, makeTilingAlbedo }
  from './SurfaceTextures.js';
import { apply, registered, setMaps, state, surfaces, type MapState,
  type Surface } from './SurfaceBind.js';
import { shaderOrder, uvBy, uvCopied, uvCountMismatch, uvSynthesised }
  from './SurfaceUv.js';

export { type Family, familyForMaterial, familyForRole, isTilingFamily,
  roleOfMaterialName } from './SurfaceRoles.js';
export { attachSurface, setMaps, type MapState } from './SurfaceBind.js';
export { copyUv, noteShaderOrder } from './SurfaceUv.js';

const FOLIAGE_TONE_FAMILIES = new Set(Object.keys(FOLIAGE_TONE));

let manifest: Manifest | null = null;

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
