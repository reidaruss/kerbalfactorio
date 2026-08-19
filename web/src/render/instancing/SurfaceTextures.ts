// THE FOUR TEXTURE FACTORIES: one per shape a manifest map can take, because
// the colour space belongs to what the map MEANS and the repeat belongs to
// what its UVs are, and those are independent.
//
// Split out of Surfaces.ts at the 400-line cap (2.2 rule 1). A pure move.

import * as THREE from 'three';

import { loadTexture } from '../../assets/Loaders.js';

/**
 * An albedo card map differs from the surface maps in every setting that
 * matters: it is COLOUR (sRGB, where normal/orm are data), its UVs are UNIT
 * card space so repeat stays 1 (no metre division), u wraps because a grass
 * band may cross the seam while v CLAMPS because the card's tip rows are
 * authored alpha-0 and must dissolve rather than wrap the roots back in.
 */
export function makeAlbedoTexture(url: string,
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
export function makeTilingAlbedo(url: string, tileM: number): Promise<THREE.Texture> {
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

export function makeTexture(url: string, tileM: number): Promise<THREE.Texture> {
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
export function makeEmissiveTexture(url: string, tileM: number): Promise<THREE.Texture> {
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
