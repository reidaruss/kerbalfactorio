// THE BINDING HALF: the registry of materials waiting for a surface, the
// loaded surfaces themselves, the map-state toggles, and the one function that
// writes a surface onto a material.
//
// Split out of Surfaces.ts at the 400-line cap (2.2 rule 1). A pure move.
//
// The module state lives here rather than in Surfaces.ts because `apply` and
// `setMaps` are its only writers and they are here; `ready` (still in
// Surfaces.ts) fills `surfaces` and re-applies `registered` across the import,
// and `surfaceReport` reads all of it the same way. None of these is a
// rebinding of a `let`, so an imported binding is enough.

import * as THREE from 'three';

import { applyFoliageTone } from './FoliageTone.js';
import { publishCanopyTone } from '../materials/TerrainTreeline.js';
import { canopyRoughnessOverride, publishCanopyCardBase }
  from '../materials/CanopySelfShadow.js';
import type { Family } from './SurfaceRoles.js';

export interface Surface {
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

export interface Reg {
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
export const state = {
  normal: true, orm: true,
  albedo: new URLSearchParams(self.location.search).get('leaftex') !== '0',
  emissive: true, alpha: true,
};

export const registered: Reg[] = [];
export const surfaces = new Map<Family, Surface>();

export function apply(r: Reg): void {
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
    // RN-2265. THE FAR TREELINE READS ITS GREEN OFF THIS LINE, and it is
    // published here rather than copied because the far ground and the near
    // cards MEET at the canopy handover: two copies of one green is a colour
    // step at a fixed radius around the player, the one artefact a handover
    // exists to prevent (RN-2249's own argument for giving the crown card
    // `Leaf`'s hex to the digit). What the terrain wants is the card's MEAN
    // RENDERED albedo, so the mean the divide above took out is multiplied
    // back in: a terrain fragment has no card texture to supply it.
    if (r.family === 'canopy') {
      publishCanopyTone(r.mat.color, on ? (s.albedoMean as number) : 1);
      // RN-2275. THE SECOND HALF OF THE SAME SEAM, and it is registered in the
      // same statement pair for the same reason. The line above hands the far
      // ground the card's colour; this one hands the card's own material to
      // the inter-crown self-shadow term, which scales it per frame so the
      // near stand darkens by the same law and the same numbers the far paint
      // darkens by. It is registered HERE, and not from PropLibrary, because
      // this is the one place the colour is FINALISED: after the
      // `albedo_mean_linear` divide and after `applyFoliageTone`. Registering
      // earlier would capture a base that is not the shipped green, and the
      // per-frame write is `base * S` rather than a multiply, so a re-run of
      // this function on a late texture load re-captures rather than compounds.
      publishCanopyCardBase(r.mat.color);
      // RN-2570. THE SWITCH THE CROWN CARD'S ROUGHNESS NEVER HAD, and it is
      // registered in the same statement group as the other two because this
      // is the one place the `canopy` family's material is reachable.
      //
      // IT WRITES NOTHING ON THE SHIPPED PATH. `canopyRoughnessOverride()`
      // returns null unless `?canopyrough=` is on the URL, so the asset's own
      // authored value stands and this lane cannot move a pixel by accident.
      // That is deliberate rather than timid: the fully-rough arm was built,
      // measured at both ends and REFUSED on evidence (it moves the card's
      // specular by -1.6 and +2.0 per cent at the two binding poses, the wrong
      // way at the second), and what the project actually lacked was the
      // ISOLATOR -- N7 could not eliminate the crown's specular as a suspect
      // because `?terrainspec=` reaches no prop and nothing reached this
      // scalar. See CanopySelfShadow.ts for the whole record.
      //
      // AFTER the colour writes and not before, on the same idempotence
      // argument the block above rests on: `apply` re-runs on a late texture
      // load, so every line here must be a WRITE of an absolute value rather
      // than a modification of what is already there. An override is
      // idempotent; a multiply would not be.
      //
      // The family carries no ORM (`s.orm` is undefined for every card family
      // in the shipped manifest), so `r.mat.roughnessMap` is null a few lines
      // below and this scalar is the SOLE authority on the card's roughness.
      // If texgen ever ships a canopy ORM, three MULTIPLIES the map by this
      // factor and the override becomes a scale rather than a value -- which is
      // MachineMat.ts's exact scar, so it is written down before it bites.
      const rough = canopyRoughnessOverride();
      if (rough !== null) r.mat.roughness = rough;
    }
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
