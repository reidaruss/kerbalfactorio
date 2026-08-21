// THE FAR GROUND's half of the terrain-art runtime handle: two setters and one
// fixture for RN-2340's world-locked mid and horizon rungs.
//
// A separate file on TerrainSplatHandle.ts's precedent and for its reason (2.2
// rule 1; TerrainArtHandle is already at the cap). It takes the whole uniform
// state rather than the two holders it reads, which is deliberate: a signature
// naming two holders would have to be edited every time this term grows one.
//
// WHY A RUNTIME HANDLE AND NOT JUST A QUERY FLAG, and it is the stronger of the
// two instruments (RN-30). `?horizon=0` gives standing rule 7's one-binary
// control over a whole session; `__ofTerrainArt.setHorizon(0)` toggles the term
// between two SETTLED FRAMES, which holds the camera, the sun, the streamed
// chunk set and the scatter equal by construction rather than by care, and that
// is what makes a before/after attributable to the term instead of to the run.

import {
  HORIZON_AN_M, HORIZON_AN_WA, HORIZON_AN_WB,
  HORIZON_A_ANALYTIC, HORIZON_A_AO, HORIZON_A_CHROMA, HORIZON_A_NORMAL,
  HORIZON_A_VALUE,
  HORIZON_CELL_FOOT_FAR, HORIZON_CELL_FOOT_MID, HORIZON_CELL_FAR_M,
  HORIZON_CELL_MID_M, HORIZON_CELL_PX,
  HORIZON_ECO_GATE, HORIZON_ECO_PX, HORIZON_FAR_REPEATS, HORIZON_FAR_TILE_M,
  HORIZON_FOOT_FAR, HORIZON_FOOT_MID, HORIZON_FOOT_OUT, HORIZON_MID_REPEATS,
  HORIZON_MID_TILE_M, HORIZON_TILE_PX_OUT,
  HORIZON_WARP_FAR_REPEATS, HORIZON_WARP_FAR_TILE_M, HORIZON_WARP_MID_REPEATS,
  HORIZON_WARP_MID_TILE_M, HORIZON_WARP_UV_FAR, HORIZON_WARP_UV_MID,
  MASSIF_A_BUMP, MASSIF_A_VALUE, MASSIF_BAND, MASSIF_FADE_M,
} from './TerrainHorizon.js';
import { horizonAmpFromQuery, horizonEcoFromQuery, massifAmpFromQuery }
  from './TerrainAmpQuery.js';
import { PHASE_PERIOD_M, phasePeriodDivides, phaseQuantumM }
  from '../../world/ChunkPhase.js';
import type { TerrainUniformState } from './TerrainUniformState.js';

export function terrainHorizonHandle(s: TerrainUniformState):
Record<string, unknown> {
  const { horizonAmp, horizonEco } = s;
  return {
    /** RN-2340. The four amplitudes, written into the SHARED vector so the near
     *  and far materials cannot disagree and no push is needed.
     *
     *  Negatives are refused rather than clamped, on `setSplat`'s rule exactly:
     *  a negative amplitude is a caller error, and reading it as its own
     *  magnitude would make a mistyped sweep look like a working one. */
    setHorizon(value: number, chroma?: number, nrm?: number, ao?: number):
    [number, number, number, number] {
      const v = horizonAmp.value;
      const put = (x: number | undefined, cur: number): number =>
        (x !== undefined && Number.isFinite(x) && x >= 0 ? x : cur);
      v.x = put(value, v.x);
      v.y = put(chroma, v.y);
      v.z = put(nrm, v.z);
      v.w = put(ao, v.w);
      return [v.x, v.y, v.z, v.w];
    },
    getHorizon(): [number, number, number, number] {
      const v = horizonAmp.value;
      return [v.x, v.y, v.z, v.w];
    },
    /** RN-2340. The biome-boundary break's own scalar, isolable separately for
     *  the reason its uniform's comment gives: it fails in a way the four
     *  amplitudes cannot. */
    setHorizonEco(value: number): number {
      if (Number.isFinite(value) && value >= 0) horizonEco.value = value;
      return horizonEco.value;
    },
    getHorizonEco(): number { return horizonEco.value; },
    /** RN-2421. The cell guard's arming scalar and the analytic stand-in's
     *  amplitude, on setHorizon's rule (negatives refused, not clamped). */
    setHorizonCell(armed: number, analytic?: number): [number, number] {
      const v = s.horizonCell.value;
      if (Number.isFinite(armed) && armed >= 0) v.x = armed;
      if (analytic !== undefined && Number.isFinite(analytic) && analytic >= 0) {
        v.y = analytic;
      }
      return [v.x, v.y];
    },
    getHorizonCell(): [number, number] {
      const v = s.horizonCell.value;
      return [v.x, v.y];
    },
    /** RN-2340. The MASSIF term's two amplitudes, on setHorizon's rule. */
    setMassif(value: number, bump?: number): [number, number] {
      const v = s.massifAmp.value;
      if (Number.isFinite(value) && value >= 0) v.x = value;
      if (bump !== undefined && Number.isFinite(bump) && bump >= 0) v.y = bump;
      return [v.x, v.y];
    },
    getMassif(): [number, number, number, number] {
      const v = s.massifAmp.value;
      const m = s.massifM.value;
      return [v.x, v.y, m.x, m.y];
    },
    /**
     * The boot DEFAULT and the derived geometry, as one fixture, separate from
     * the live values for `splatDefault`'s reason (RN-150: two features have
     * shipped dark because every probe passed an explicit flag and nothing ever
     * exercised what ships).
     *
     * IT PUBLISHES THE SEAM RULE'S OWN ARITHMETIC and not only the amplitudes,
     * because that is the claim this term rests on and the one whose failure is
     * a hairline at range rather than a missing feature: `repeats` are what
     * `assertPhasePeriod` returned at module load, `divides` re-checks the same
     * predicate from the probe's side, and `quantumM` is the reconstructed
     * coordinate's float32 quantum at the given chunk half-extent, which is the
     * number that decides whether a read at range is resolvable at all. A probe
     * that sees `divides` false has caught a seam before it is photographed.
     *
     * AND IT NOW PUBLISHES THE INCOMMENSURABILITY ARITHMETIC BESIDE IT, in the
     * same four-wide shape (mid rung, horizon rung, mid warp, horizon warp),
     * because divisibility was never the whole rule and the half that was
     * missing is what shipped a lattice. `coprime` is gcd(warp, tile) == 1 per
     * rung, computed here from the published repeats so a probe can check the
     * claim rather than take it, and `superM` is the metres the composite of
     * warp and tile actually repeats on -- 256 when the pair is coprime, the
     * tile itself in the equal-repeat case that shipped.
     */
    horizonDefault(): {
      present: boolean; amp: [number, number, number, number]; eco: number;
      shipped: [number, number, number, number];
      tileM: [number, number, number, number];
      repeats: [number, number, number, number];
      divides: [boolean, boolean, boolean, boolean];
      coprime: [boolean, boolean]; superM: [number, number];
      footMid: [number, number]; footFar: [number, number];
      footOut: [number, number]; tilePxOut: [number, number];
      periodM: number; quantumM: [number, number]; warpUv: [number, number];
      warpM: [number, number]; ecoPx: number; ecoGate: [number, number];
      massifAmp: [number, number]; massifShipped: [number, number];
      massifM: [number, number]; massifFadeM: [number, number];
      massifBand: [number, number];
      cell: [number, number]; cellShipped: number;
      cellM: [number, number]; cellPx: [number, number];
      cellFootMid: [number, number]; cellFootFar: [number, number];
      anM: [number, number]; anW: [number, number];
    } {
      const p = new URLSearchParams(self.location.search);
      const boot = horizonAmpFromQuery();
      const bootM = massifAmpFromQuery();
      const keys = ['horizon', 'horizonval', 'horizonchroma', 'horizonnrm',
        'horizonao', 'horizoneco', 'horizonecoamp', 'horizoncell',
        'horizoncellan', 'horizonmassif',
        'horizonmassifval', 'horizonmassifbump', 'horizonmassifm'];
      const tiles: [number, number, number, number] = [
        HORIZON_MID_TILE_M, HORIZON_FAR_TILE_M,
        HORIZON_WARP_MID_TILE_M, HORIZON_WARP_FAR_TILE_M,
      ];
      // gcd, recomputed on the probe's side of the fence for the same reason
      // `divides` is: a fixture that only echoes the module's own answer proves
      // the module ran, not that the answer is right.
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      const gMid = gcd(HORIZON_WARP_MID_REPEATS, HORIZON_MID_REPEATS);
      const gFar = gcd(HORIZON_WARP_FAR_REPEATS, HORIZON_FAR_REPEATS);
      return {
        present: keys.some((k) => p.get(k) !== null),
        amp: [boot.x, boot.y, boot.z, boot.w],
        eco: horizonEcoFromQuery(),
        shipped: [HORIZON_A_VALUE, HORIZON_A_CHROMA, HORIZON_A_NORMAL,
          HORIZON_A_AO],
        tileM: tiles,
        repeats: [HORIZON_MID_REPEATS, HORIZON_FAR_REPEATS,
          HORIZON_WARP_MID_REPEATS, HORIZON_WARP_FAR_REPEATS],
        divides: [phasePeriodDivides(tiles[0]), phasePeriodDivides(tiles[1]),
          phasePeriodDivides(tiles[2]), phasePeriodDivides(tiles[3])],
        coprime: [gMid === 1, gFar === 1],
        superM: [PHASE_PERIOD_M / gMid, PHASE_PERIOD_M / gFar],
        footMid: [HORIZON_FOOT_MID[0], HORIZON_FOOT_MID[1]],
        footFar: [HORIZON_FOOT_FAR[0], HORIZON_FOOT_FAR[1]],
        // The top rung's retirement, published in BOTH units: the pixels per
        // tile the band is written in and the metres of footprint it becomes,
        // so a probe can check the derivation rather than the result.
        footOut: [HORIZON_FOOT_OUT[0], HORIZON_FOOT_OUT[1]],
        tilePxOut: [HORIZON_TILE_PX_OUT[0], HORIZON_TILE_PX_OUT[1]],
        periodM: PHASE_PERIOD_M,
        // Two chunk half-extents: a max-depth quad and a coarse ring one, so a
        // probe can see that the quantum is set by the CHUNK and not by the
        // BODY, which is the whole reason this coordinate reaches the horizon
        // when `pM` cannot.
        quantumM: [phaseQuantumM(20.5), phaseQuantumM(3700)],
        warpUv: [HORIZON_WARP_UV_MID, HORIZON_WARP_UV_FAR],
        warpM: [HORIZON_WARP_UV_MID * PHASE_PERIOD_M,
          HORIZON_WARP_UV_FAR * PHASE_PERIOD_M],
        ecoPx: HORIZON_ECO_PX,
        ecoGate: [HORIZON_ECO_GATE[0], HORIZON_ECO_GATE[1]],
        massifAmp: [bootM.x, bootM.y],
        massifShipped: [MASSIF_A_VALUE, MASSIF_A_BUMP],
        massifM: [s.massifM.value.x, s.massifM.value.y],
        massifFadeM: [MASSIF_FADE_M[0], MASSIF_FADE_M[1]],
        massifBand: [MASSIF_BAND[0], MASSIF_BAND[1]],
        // RN-2421. The cell guard, published in BOTH units for footOut's own
        // reason: a probe can check the derivation (tile / cells, then cell /
        // pixels) rather than the result, and `cell` is the LIVE pair so a
        // frame can prove which arm it is.
        cell: [s.horizonCell.value.x, s.horizonCell.value.y],
        cellShipped: HORIZON_A_ANALYTIC,
        cellM: [HORIZON_CELL_MID_M, HORIZON_CELL_FAR_M],
        cellPx: [HORIZON_CELL_PX[0], HORIZON_CELL_PX[1]],
        cellFootMid: [HORIZON_CELL_FOOT_MID[0], HORIZON_CELL_FOOT_MID[1]],
        cellFootFar: [HORIZON_CELL_FOOT_FAR[0], HORIZON_CELL_FOOT_FAR[1]],
        anM: [HORIZON_AN_M[0], HORIZON_AN_M[1]],
        anW: [HORIZON_AN_WA, HORIZON_AN_WB],
      };
    },
  };
}
