// WG-230. The world-locked phase's CLIENT half: the probe amplitude's query and
// the runtime fixture. No GLSL (TerrainPhase.glsl.ts) and no reduction
// arithmetic (world-gen's ChunkPhase.ts, which is the one authority on the
// period and on what divides it).
//
// THE SHIPPED AMPLITUDE IS ZERO and that is not a disabled feature, it is the
// deliverable. This lane's product is a COORDINATE plus the evidence that it
// arrives; the material that paints with it is R2's L1 far-ground lane. So the
// default frame is bit-identical to the one before this lane, and `?phaseamp=1`
// is the arm that photographs the wire working.
//
// The param is registered in `run.mjs`'s PAGE_PARAMS in this same commit, which
// is RN-152's scar: a flag the runner does not forward silently runs BOTH arms
// of a control pair at the default and reports a confident null.

import * as THREE from 'three';
import { PHASE_PERIOD_M, phasePeriodDivides } from '../../world/ChunkPhase.js';

/** The probe checker's default repeats per period; 128 is a 2 m checker. */
export const PHASE_PROBE_REPEATS = 128;

/**
 * The probe's shipped amplitude. Zero, deliberately: see the header.
 */
export const PHASE_A_PROBE = 0;

/**
 * `?phaseamp=` sweeps the amplitude and `?phaserep=` the checker size.
 *
 * Negatives are refused rather than clamped, on `setSplat`'s rule exactly:
 * reading a negative as its own magnitude makes a mistyped sweep look like a
 * working one. The repeats are ROUNDED to a whole number rather than refused,
 * because a fractional repeat count is the one input that would make the probe
 * itself draw the chunk-edge seam it exists to disprove.
 */
export function phaseProbeFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const a = Number(p.get('phaseamp'));
  const r = Number(p.get('phaserep'));
  return new THREE.Vector2(
    p.get('phaseamp') !== null && Number.isFinite(a) && a >= 0 ? a : PHASE_A_PROBE,
    p.get('phaserep') !== null && Number.isFinite(r) && r >= 1
      ? Math.round(r) : PHASE_PROBE_REPEATS,
  );
}

/**
 * The runtime fixture, spread into `window.__ofTerrainArt`.
 *
 * IT PUBLISHES THE QUANTUM AND NOT ONLY THE AMPLITUDE, because the amplitude
 * answers "is the probe on" and the quantum answers the question this lane
 * exists for: how fine is the shading coordinate at a given chunk extent, and
 * how does that compare with the `pM` it replaces. Both arms are computed from
 * the shipped constants rather than transcribed, so a period change moves the
 * fixture with it.
 */
export function terrainPhaseHandle(probe: { value: THREE.Vector2 }):
Record<string, unknown> {
  return {
    setPhaseProbe(value: number, repeats?: number): [number, number] {
      if (Number.isFinite(value) && value >= 0) probe.value.x = value;
      if (repeats !== undefined && Number.isFinite(repeats) && repeats >= 1) {
        probe.value.y = Math.round(repeats);
      }
      return [probe.value.x, probe.value.y];
    },
    /**
     * `periodM` is the world period a consumer wants; `divides` is the seam
     * rule and `repeats` is the integer it must multiply `vPhase` by.
     * `quantumM` is the float32 quantum of the reconstructed coordinate over a
     * chunk of `localRadiusM`, and `pmQuantumM` is what `pM` carries at Forge's
     * radius for the same fragment (2^18 <= |component| < 2^19, WG-50's
     * measured typical case), so the ratio is readable straight off a probe.
     */
    phaseState(periodM = 2, localRadiusM = 20.5): {
      present: boolean; amp: number; shipped: number; periodM: number;
      probeRepeats: number; wantPeriodM: number; divides: boolean;
      repeats: number; quantumM: number; pmQuantumM: number; ratio: number;
    } {
      const p = new URLSearchParams(self.location.search);
      const t = 1 + Math.abs(localRadiusM) / PHASE_PERIOD_M;
      const quantumM = 2 ** (Math.floor(Math.log2(t)) - 23) * PHASE_PERIOD_M;
      const pmQuantumM = 2 ** (18 - 23);
      return {
        present: p.get('phaseamp') !== null || p.get('phaserep') !== null,
        amp: probe.value.x,
        shipped: PHASE_A_PROBE,
        periodM: PHASE_PERIOD_M,
        probeRepeats: probe.value.y,
        wantPeriodM: periodM,
        divides: phasePeriodDivides(periodM),
        repeats: PHASE_PERIOD_M / periodM,
        quantumM,
        pmQuantumM,
        ratio: pmQuantumM / quantumM,
      };
    },
  };
}
