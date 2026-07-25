// Formats the debug HUD text. Pure data in, strings out, zero three.js.

import type { HudLine } from './Hud.js';

interface StatsLike {
  fps: number;
  frameMs: { p50: number; p99: number; last: number };
  passMs: { sky: number; far: number; near: number; viewModel: number };
  cpuMs: number;
  draw: { calls: number; triangles: number; geometries: number; programs: number };
  vramEstimateMB: number;
  budget: { drawCalls: string; triangles: string; frameP99: string };
}

interface WorldLike {
  seed: string;
  scenario: string;
  observer: { latDeg: number; lonDeg: number; altM: number };
  surfaceHeightM: number;
  biome: number;
  origin: { rebases: number };
  chunks: { resident: number; near: number; far: number; pending: number; converged: boolean };
  depthMode: string;
}

function m(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} Mm`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)} km`;
  return `${v.toFixed(1)} m`;
}

export function hudLines(
  s: StatsLike, w: WorldLike, gpu: string, oracleUs: number,
): HudLine[] {
  return [
    { label: 'seed', value: `${w.seed}  scenario=${w.scenario}` },
    { label: 'fps', value: `${s.fps.toFixed(0)}  p50 ${s.frameMs.p50.toFixed(1)} ms  p99 ${s.frameMs.p99.toFixed(1)} ms`, warn: s.budget.frameP99 !== 'ok' },
    { label: 'passes ms', value: `sky ${s.passMs.sky.toFixed(2)} far ${s.passMs.far.toFixed(2)} near ${s.passMs.near.toFixed(2)} vm ${s.passMs.viewModel.toFixed(2)}` },
    { label: 'cpu ms', value: s.cpuMs.toFixed(2) },
    { label: 'draw calls', value: `${s.draw.calls}  (budget 150 / alert 300)`, warn: s.budget.drawCalls !== 'ok' },
    { label: 'triangles', value: `${(s.draw.triangles / 1000).toFixed(0)}k`, warn: s.budget.triangles !== 'ok' },
    { label: 'geometries', value: `${s.draw.geometries}  programs ${s.draw.programs}` },
    { label: 'vram est', value: `${s.vramEstimateMB.toFixed(1)} MB` },
    { label: 'depth', value: w.depthMode },
    { label: 'oracle', value: `${oracleUs.toFixed(2)} us / call` },
    { label: 'observer', value: `lat ${w.observer.latDeg.toFixed(3)}  lon ${w.observer.lonDeg.toFixed(3)}  alt ${m(w.observer.altM)}` },
    { label: 'surface', value: `${m(w.surfaceHeightM)} relief  biome ${w.biome}` },
    { label: 'chunks', value: `${w.chunks.resident} resident (near ${w.chunks.near} / far ${w.chunks.far})  pending ${w.chunks.pending}${w.chunks.converged ? '  CONVERGED' : ''}` },
    { label: 'rebases', value: `${w.origin.rebases}` },
    { label: 'gpu', value: gpu.slice(0, 52) },
    { label: 'keys', value: 'drag=look  WASD=move  R/F=alt  wheel=zoom  shift=fast  `=hud' },
  ];
}
