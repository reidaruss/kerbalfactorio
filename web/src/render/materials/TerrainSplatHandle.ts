// The SPLAT's half of the terrain-art runtime handle: three setters and two
// fixtures for RN-2160's near-field material layers.
//
// Split out of TerrainArtHandle.ts at the 400-line cap (2.2 rule 1). Adding
// these methods inline took that file to 427 lines, and the split is a MOVE:
// every method below is byte-identical to the one that left, and
// TerrainArtHandle spreads the returned object into the same literal, so
// `window.__ofTerrainArt` has exactly the same shape it would have had.
//
// It takes the whole uniform state rather than the four holders it reads,
// which is deliberate: a signature naming four holders would have to be edited
// every time this term grows one, and the destructure below is where a missing
// holder becomes a compile error either way.

import { SPLAT_A_CHROMA, SPLAT_A_NORMAL, SPLAT_A_VALUE, SPLAT_LAYERS,
  SPLAT_WARP_UV, luma709 } from './TerrainSplat.js';
import { splatAmpFromQuery } from './TerrainAmpQuery.js';
import type { TerrainUniformState } from './TerrainUniformState.js';

export function terrainSplatHandle(s: TerrainUniformState):
Record<string, unknown> {
  const { splatAmp, splatFade, splatGrass, splatSnow } = s;
  return {
    /** RN-2160. The SPLAT's three amplitudes, written into the SHARED vector so
     *  the near and far materials cannot disagree and no push is needed.
     *
     *  Negatives are refused rather than clamped, on setFine's rule exactly: a
     *  negative amplitude is a caller error, and reading it as its own
     *  magnitude would make a mistyped sweep look like a working one. */
    setSplat(value: number, chroma?: number, nrm?: number): [number, number, number] {
      if (Number.isFinite(value) && value >= 0) splatAmp.x = value;
      const c = chroma === undefined ? splatAmp.y : chroma;
      const nr = nrm === undefined ? splatAmp.z : nrm;
      if (Number.isFinite(c) && c >= 0) splatAmp.y = c;
      if (Number.isFinite(nr) && nr >= 0) splatAmp.z = nr;
      return [splatAmp.x, splatAmp.y, splatAmp.z];
    },
    getSplat(): [number, number, number] {
      return [splatAmp.x, splatAmp.y, splatAmp.z];
    },
    /** RN-2160. The boot DEFAULT as its own fixture, separate from the live
     *  value, for fineDefault's reason (RN-150: two features have shipped dark
     *  because every probe passed an explicit flag and nothing ever exercised
     *  what ships).
     *
     *  It publishes the LAYER TABLE as well as the amplitudes, and the two
     *  fields that matter for judging this term are the ones a reader cannot
     *  derive: `tileM` is what each layer's integer repeat count actually lands
     *  the world tile at (the authored metres rounded to a whole number of
     *  repeats per max-depth quad), and `hueLuma` is the Rec.709 luminance of
     *  each hue vector, which MUST read 1 to six decimals. That second number
     *  is clause C3 of the convergence rule made observable from a probe rather
     *  than merely asserted at module load: if it is ever not 1, the chroma
     *  term is moving value and the palette is not converging. */
    splatDefault(): { present: boolean; amp: [number, number, number];
      shipped: [number, number, number];
      fadeAlbedoM: [number, number]; fadeNormalM: [number, number];
      layers: string[]; repeats: number[]; tileM: number[];
      roughBase: number[]; hueLuma: number[]; warpUv: number } {
      const p = new URLSearchParams(self.location.search);
      const boot = splatAmpFromQuery();
      const keys = ['splat', 'splatval', 'splatchroma', 'splatnrm', 'splatfade'];
      return {
        present: keys.some((k) => p.get(k) !== null),
        amp: [boot.x, boot.y, boot.z],
        shipped: [SPLAT_A_VALUE, SPLAT_A_CHROMA, SPLAT_A_NORMAL],
        fadeAlbedoM: [splatFade.x, splatFade.y],
        fadeNormalM: [splatFade.z, splatFade.w],
        layers: SPLAT_LAYERS.map((l) => l.name),
        repeats: SPLAT_LAYERS.map((l) => l.repeats),
        tileM: SPLAT_LAYERS.map((l) => l.actualTileM),
        roughBase: SPLAT_LAYERS.map((l) => l.roughBase),
        hueLuma: SPLAT_LAYERS.map((l) => luma709(l.hue.x, l.hue.y, l.hue.z)),
        warpUv: SPLAT_WARP_UV,
      };
    },
    /** RN-2160. The splat's FIXTURE assertion, texState's argument for six maps
     *  at once. A pair of frames taken against six 1x1 placeholders is
     *  bit-identical by construction and reads as a dead TERM when it is a dead
     *  FETCH, and with six textures that failure has six independent ways to
     *  happen. Two are reported rather than one because the first and last
     *  layers are loaded by the same code path in the same tick: if `grass` is
     *  1024 and `snow` is 1, the cache is fine and one file is missing, which
     *  is a different bug from "sync-assets was never run". */
    splatTexState(): { grass: number; snow: number } {
      const g = splatGrass.value.image as { width?: number } | null;
      const w = splatSnow.value.image as { width?: number } | null;
      return { grass: g?.width ?? 0, snow: w?.width ?? 0 };
    },
  };
}
