// What a probe reads off the assembly bay, lifted out of `Vab.ts` for the same
// reason `VabRows.ts` was: the bay is a mode controller, and twenty-four lines
// of pure serialisation is not a mode. It also bought the room GP-55 needed,
// which is worth saying out loud because a 400-line cap that is met by deleting
// a comment is met dishonestly.
//
// It reaches into the bay's fields deliberately. A report that re-derived any
// of these would be reporting on itself, which is the failure standing rule 11
// is about; this one is a view of the live object and nothing more.

import * as store from './VabStore.js';
import { offeredParts } from './VesselCatalogue.js';
import { catalogueReport, jointGapReport } from './VabRows.js';
import { VabView } from './VabView.js';
import type { Vab } from './Vab.js';

/** Joint gaps MEASURED on the drawn scene rather than on the model. */
export function vabJointGaps(v: Vab): unknown {
  return jointGapReport(v.view, v.design.parts);
}

export function vabCatalogue(v: Vab): unknown {
  return catalogueReport(v.catalogue, v.view, (p) => v.affordInCore(p));
}

export function vabReport(v: Vab): unknown {
  return {
    open: v.open, mode: v.modeRules.mode, freeBuild: v.modeRules.freeBuild,
    catalogue: v.catalogue.length,
    offered: offeredParts(v.catalogue, v.modeRules).length,
    meshesMissing: [...v.view.missing],
    assetsRenamed: [...v.view.renamed],
    renameDebt: VabView.renameCount,
    hand: v.hand === null ? null : v.hand.label,
    handIndex: v.hand === null ? -1 : v.hand.index,
    symmetry: v.symmetry, selected: v.selected, nodes: v.nodes.length,
    snapped: v.active === null ? null
      : { parent: v.active.parent, kind: v.active.kind, pos: v.active.posM },
    placed: v.placed, refused: v.refused, removed: v.removed,
    enters: v.enters, handStaged: v.handStaged,
    parts: v.design.parts.map((p) => ({
      handle: p.handle, partId: p.partId, parent: p.parent,
      attach: p.attach, stage: p.stage, origin: p.originM,
    })),
    stages: v.design.stages, stats: v.design.stats,
    designs: store.listDesigns(),
    camera: v.cam.report(), pointer: v.pointer.report(),
    message: v.message,
  };
}
