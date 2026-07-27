// Pure mapping from the model to the panel's row shapes. No state, no DOM, no
// three.js: it exists so `Vab.ts` stays a mode controller and so the shape the
// panel consumes can be unit-read at a glance.
import { CLASS_L, detailOf } from './VesselCatalogue.js';
import type { PartRow } from './VesselCatalogue.js';
import type { DesignPart, StageRow } from './VesselDesign.js';
import type { VabPartRow, VabStageRow } from '../ui/VabPanel.js';

export function partRows(offered: readonly PartRow[], handIndex: number,
                         costText: (p: PartRow) => string,
                         affordable: (p: PartRow) => boolean): VabPartRow[] {
  return offered.map((p) => ({
    index: p.index,
    name: p.label,
    group: p.group,
    cls: classTag(p),
    cost: costText(p),
    affordable: affordable(p),
    selected: handIndex === p.index,
    detail: detailOf(p),
  }));
}

export function stageRows(stages: readonly StageRow[]): VabStageRow[] {
  return stages.map((s) => ({
    index: s.index,
    deltaV: s.deltaVVacuumMS,
    twr: s.twr,
    burnS: s.burnTimeS,
    thrustKN: s.thrustVacuumN / 1000,
    engines: s.engines,
    partCount: s.partCount,
  }));
}

/** 'S', 'L' or 'radial'. A part with no stack node at all is a radial fitting,
 *  and calling it class S would invite the player to try to stack it. */
export function classTag(p: PartRow): string {
  if (!p.nodeTop && !p.nodeBottom) return 'radial';
  return Math.abs(p.diameterM - CLASS_L) < 1e-9 ? 'L' : 'S';
}

/**
 * The catalogue as a probe reads it: one row per part with the two facts that
 * can silently be wrong (does the mesh exist, and did its name have to be
 * reconciled) next to the two that are content (the item id and the cost).
 */
export function catalogueReport(catalogue: readonly PartRow[], view: MeshFacts,
                                affordInCore: (p: PartRow) => boolean): unknown {
  return catalogue.map((p) => ({
    index: p.index, id: p.id, name: p.label, asset: p.asset,
    hasMesh: !view.missing.has(p.asset),
    renamed: view.renamed.has(p.asset),
    itemId: p.itemId, tier1: p.tier1,
    cost: p.cost, affordInCore: affordInCore(p),
  }));
}

/** Just enough of VabView to write the two reports, so this file imports no
 *  three.js and stays a pure mapping. */
export interface MeshFacts {
  readonly missing: Set<string>;
  readonly renamed: Set<string>;
  jointGaps(parts: readonly DesignPart[]): {
    child: number; parent: number; kind: string; gapM: number | null;
  }[];
}

/** The measured joint gaps, summarised. `unmeasurable` is a part with no
 *  shipped mesh and therefore no sockets: reported, never counted as zero. */
export function jointGapReport(view: MeshFacts,
                               parts: readonly DesignPart[]): unknown {
  const gaps = view.jointGaps(parts);
  const known: number[] = [];
  for (const g of gaps) if (g.gapM !== null) known.push(g.gapM);
  return {
    joints: gaps.length,
    measured: known.length,
    unmeasurable: gaps.length - known.length,
    worstM: known.length > 0 ? Math.max(...known) : null,
    gaps,
  };
}
