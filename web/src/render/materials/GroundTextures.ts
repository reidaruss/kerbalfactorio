// The two ground detail maps, and the ONE place either of them is loaded.
//
// RN-1258. Split out of TerrainMaterial.ts because the terrain stopped being
// the only consumer: the dug voxel face (VoxelFaceMaterial) projects the same
// two maps triplanarly so that a cut bank and the hillside it is cut into are
// drawn from the same bytes. The alternative was a second `fetch` and a second
// `createImageBitmap` of the same file, which is not merely wasteful: it is a
// second authority on what the ground is made of, and the two could drift the
// moment one call site's decode options were edited and the other's were not.
// This file exists so that cannot happen. It is a cache keyed on the filename
// and it hands every caller the SAME `IUniform` object, so a texture that
// finishes loading after a material is built reaches every material at once.
//
// The load path itself is unchanged to the character from the one RN-78
// measured; its comment is preserved below because the reason is not
// guessable.

import * as THREE from 'three';

const CACHE = new Map<string, THREE.IUniform<THREE.Texture>>();

/**
 * The shared uniform holder for one ground map. Callers must NOT mutate
 * `.value`; the loader owns it.
 */
export function groundTexture(file: string): THREE.IUniform<THREE.Texture> {
  const hit = CACHE.get(file);
  if (hit !== undefined) return hit;
  const u = load(file);
  CACHE.set(file, u);
  return u;
}

/** The two files this project ships, named once so a typo is a build error. */
export const GROUND_VALUE_MAP = 'of_ground.png';
export const GROUND_RELIEF_MAP = 'of_ground_relief.png';

function load(file: string): THREE.IUniform<THREE.Texture> {
  const ph = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1,
    THREE.RGBAFormat);
  ph.needsUpdate = true;
  // ONE IUniform object handed to EVERY consumer, so the swap-on-load below
  // reaches the near material, the far material and the voxel face in one
  // assignment and they cannot disagree about which texture the ground wears.
  //
  // NOT TextureLoader, and the reason was MEASURED (RN-78): the HTMLImage
  // decode path PREMULTIPLIES RGB by alpha, and this texture's alpha is a
  // DATA channel sitting near 0.5, so every colour channel arrived halved,
  // every field read below its 0.5 identity, and the "modulation" darkened
  // the whole planet 89% one-way (257,065 darker against 31,457 lighter at
  // the RN-15 camera, meanDelta 47). createImageBitmap with premultiplyAlpha
  // 'none' and colorSpaceConversion 'none' is the load path that hands the
  // sampler the file's actual bytes.
  const u: THREE.IUniform<THREE.Texture> = { value: ph };
  fetch(`assets/textures/${file}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bmp = await createImageBitmap(await r.blob(), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
      const t = new THREE.Texture(bmp);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      // A data texture: the channels are modulation fields, not colours.
      t.colorSpace = THREE.NoColorSpace;
      // 16, and the number is load-bearing, not a luxury: the walking camera
      // sees ground at 8 degrees of grazing by 12 m, where the anisotropy
      // ratio is already past 6, and any pixel past the budget UNDER-FILTERS
      // into per-pixel texture deltas that the bump's derivative amplifies
      // into black speckle. 16 holds proper filtering out to ~28 m, which is
      // past where the bump's own footprint fade has retired that term.
      // (An earlier sweep of this setting "did nothing" because the samples
      // then sat in non-uniform control flow with UNDEFINED LOD; see
      // TerrainShader's note. Filtering settings only mean anything once the
      // LOD is defined.) three clamps to the device maximum at upload.
      t.anisotropy = 16;
      t.flipY = false;           // an ImageBitmap upload ignores UNPACK_FLIP_Y
      t.generateMipmaps = true;  // the 0.5-centred channels NEED the mip chain
      t.needsUpdate = true;
      u.value = t;
      ph.dispose();
    })
    .catch((e: unknown) => {
      console.error(`[of] terrain: ${file} did NOT load (${String(e)}).`
        + ' The ground draws untextured; run `npm run sync-assets`.');
    });
  return u;
}
