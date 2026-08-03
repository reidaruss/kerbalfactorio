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
    offered: v.offered().length,
    // GP-267. The part ids actually on offer, so a probe asserts WHICH row
    // the research gate withheld rather than only that a count moved.
    offeredIds: v.offered().map((p) => p.id),
    meshesMissing: [...v.view.missing],
    assetsRenamed: [...v.view.renamed],
    renameDebt: VabView.renameCount,
    hand: v.hand === null ? null : v.hand.label,
    handIndex: v.hand === null ? -1 : v.hand.index,
    symmetry: v.symmetry, selected: v.selected, nodes: v.nodes.length,
    snapped: v.active === null ? null
      : { parent: v.active.parent, kind: v.active.kind, pos: v.active.posM },
    // GP-115. THE NEAR MISS the cursor is over but the hand cannot take, and the
    // sentence that says why. Published because "the ghost went away" and "the
    // snap search is broken" are the two readings a player has to choose between
    // when neither is reported, and they need different fixes.
    blocked: v.blocked === null ? null
      : { parent: v.blocked.node.parent, kind: v.blocked.node.kind,
          cls: v.blocked.node.cls, why: v.blocked.why },
    placed: v.placed, refused: v.refused, removed: v.removed,
    enters: v.enters, handStaged: v.handStaged, reframes: v.reframes,
    rollOutsRefused: v.rollOutsRefused, rollOutsForced: v.rollOutsForced,
    rollOutArmed: v.rollOutArmed, verdict: v.verdict,
    // GP-265. The destination choice and the reach verdict, in /core's units.
    destination: v.dest.report(),
    parts: v.design.parts.map((p) => ({
      handle: p.handle, partId: p.partId, parent: p.parent,
      attach: p.attach, stage: p.stage, origin: p.originM,
      // ABI 20 (PH-81). ADDITIVE. The height up the parent at which a radial
      // mount sits, published by `of_vs_transforms` rather than re-derived from
      // two origins, so a probe can read a radial placement off one row.
      radialOffsetM: p.radialOffsetM,
    })),
    stages: v.design.stages, stats: v.design.stats,
    designs: store.listDesigns(),
    camera: v.cam.report(), pointer: v.pointer.report(),
    message: v.message,
  };
}
