// The part catalogue, read ONCE out of /core and never re-derived.
//
// Everything here is a copy of vessel.h's authored data. The client invents no
// dimension, no mass and no Isp: if a number on this screen disagrees with
// core/tests/test_vessel.cpp, this file is wrong. The two things it DOES decide
// are presentation (which group a part lists under, how a cost reads) and the
// survival TIER GATE, both of which are stated below.
import { scratchF64, scratchI32, scratchU8 } from '../sim/wasm/heap.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { vesselAbi, PART_INFO_WORDS } from '../sim/wasm/vesselabi.js';
import type { ModeRules } from './GameMode.js';

export interface CostStack { item: number; count: number }

export interface PartRow {
  index: number;          // catalogue index; the id every call takes
  id: number;             // PartId (0x0100+)
  name: string;           // display name from /core
  label: string;          // display name DISAMBIGUATED (see below)
  asset: string;          // the glb node name, exactly
  cls: number;            // PartClass
  group: string;          // the UI grouping
  diameterM: number;
  heightM: number;
  nodeTop: boolean;
  nodeBottom: boolean;
  radialMount: boolean;
  /** GP-159 / ABI 21. 0 = the origin is the inboard MOUNT PLANE, 1 = it is the
   *  part's own AXIS. Declared by `/core` and never derived here: `vessel.h`
   *  makes it a required constructor parameter precisely so that no rule about
   *  kind or mesh stands in for it. Read only for a radial attachment. */
  radialOrigin: number;
  dryMassKg: number;
  propellant: number;
  propellantKg: number;
  thrustVacuumN: number;
  thrustSeaLevelN: number;
  ispVacuumS: number;
  ispSeaLevelS: number;
  crew: number;
  itemId: number;
  cost: CostStack[];
  tier1: boolean;         // the DW-29 Tier-1 set
  isDecoupler: boolean;   // PartClass::Decoupler, the only interstage tenant
}

/** Class S = 1.25 m, class L = 2.50 m, exactly 2x (ASSET-SPECS §3.3). */
export const CLASS_S = 1.25;
export const CLASS_L = 2.5;

/** The only part whose two ends are different classes: L below, S above. */
const STACK_ADAPTER = 0x011a;

/** DW-29 Tier 1 is the contiguous PartId block 0x0100..0x010C. Tier 2 (control,
 *  power, docking) and the whole class-L stack are later tech, which is what the
 *  survival catalogue gate hangs on until research reaches the browser. */
function isTier1(id: number): boolean { return id >= 0x0100 && id <= 0x010c; }

const GROUPS: Record<number, string> = {
  0: 'Command', 1: 'Fuel', 2: 'Engines', 3: 'Coupling', 4: 'Aero',
  5: 'Structural', 6: 'Control', 7: 'Power', 8: 'Coupling', 9: 'Utility',
};

/** The class a part presents at its BOTTOM mating face, or 0 if it has none. */
export function classAtBottom(p: PartRow): number {
  if (!p.nodeBottom) return 0;
  return p.id === STACK_ADAPTER ? CLASS_L : p.diameterM;
}
/** The class a part presents at its TOP mating face, or 0 if it has none. */
export function classAtTop(p: PartRow): number {
  if (!p.nodeTop) return 0;
  return p.id === STACK_ADAPTER ? CLASS_S : p.diameterM;
}

function text(M: OfCoreModule, n: number): string {
  if (n <= 0) return '';
  const bytes = scratchU8(M, n).slice();
  return new TextDecoder().decode(bytes);
}

/**
 * Read the whole catalogue. Cheap (24 rows, ~100 calls) and done once at boot.
 */
export function readCatalogue(M: OfCoreModule): PartRow[] {
  const V = vesselAbi(M);
  const n = V._of_vs_part_count();
  const rows: PartRow[] = [];
  for (let i = 0; i < n; ++i) {
    const got = V._of_vs_part_info(i);
    // GP-159. A STRIDE MISMATCH IS NEVER RECOVERABLE, so it THROWS rather than
    // skipping the row.
    //
    // This was `continue`, and that is a ceiling that reports success: widening
    // the published row without moving `PART_INFO_WORDS` skips EVERY part, so
    // the entire assembly bay comes up empty with no error anywhere. Nothing
    // downstream can tell "this build has no parts" from "this build cannot
    // read its parts", and the first is a legitimate state (a mode may offer
    // none) while the second is a broken bridge.
    //
    // It is the same class as the ABI guard one layer down: refusing to run
    // against a bridge you do not agree with is the behaviour, and the fix is
    // never to widen the tolerance. Standing rule 9's whole point is that half
    // a bridge change is a broken build rather than an unfinished one, and a
    // `continue` turns exactly that into a quiet one.
    if (got !== PART_INFO_WORDS) {
      throw new Error(`of_vs_part_info stride mismatch: wasm returned ${got} `
        + `words, client expects ${PART_INFO_WORDS}. The wasm and the client `
        + `disagree about the catalogue row; rebuild web/wasm and re-sync.`);
    }
    const f = scratchF64(M, PART_INFO_WORDS).slice();
    const name = text(M, V._of_vs_part_name(i));
    const asset = text(M, V._of_vs_part_asset(i));
    const itemId = V._of_vs_part_item(i);
    const words = V._of_vs_part_cost_info(i);
    const cost: CostStack[] = [];
    if (words > 0) {
      const c = scratchI32(M, words).slice();
      const inN = c[1] ?? 0;
      for (let k = 0; k < inN; ++k) {
        cost.push({ item: c[2 + k * 2] ?? 0, count: c[3 + k * 2] ?? 0 });
      }
    }
    const id = f[0] ?? 0;
    rows.push({
      index: i, id, name, asset, cls: f[1] ?? 0,
      label: name, group: GROUPS[f[1] ?? 0] ?? 'Utility',
      diameterM: f[2] ?? 0, heightM: f[3] ?? 0,
      nodeTop: (f[4] ?? 0) > 0.5, nodeBottom: (f[5] ?? 0) > 0.5,
      radialMount: (f[6] ?? 0) > 0.5,
      radialOrigin: f[34] ?? 0,
      dryMassKg: f[7] ?? 0, propellant: f[8] ?? 0, propellantKg: f[9] ?? 0,
      thrustSeaLevelN: f[12] ?? 0, thrustVacuumN: f[13] ?? 0,
      ispSeaLevelS: f[14] ?? 0, ispVacuumS: f[15] ?? 0,
      crew: f[24] ?? 0,
      itemId, cost, tier1: isTier1(id), isDecoupler: (f[1] ?? 0) === 3,
    });
  }
  // TWO parts ship the same display name from /core: 0x0102 TankLiquidSmallLong
  // and 0x0117 TankLiquidLarge are both "Fuel Tank (large)". They are different
  // CLASSES, so the class suffix is the disambiguation the player already needs
  // in order to know what mates with what. Raised to the physics lane; fixing it
  // in vessel.h is their call, and this line becomes a no-op the day they do.
  for (const r of rows) {
    const clash = rows.some((o) => o !== r && o.name === r.name);
    r.label = clash ? `${r.name} [${classLetter(r)}]` : r.name;
  }
  return rows;
}

/** 'S', 'L' or 'radial' (a part with no stack node at all). */
export function classLetter(p: PartRow): string {
  if (!p.nodeTop && !p.nodeBottom) return 'radial';
  if (p.id === STACK_ADAPTER) return 'L>S';
  return Math.abs(p.diameterM - CLASS_L) < 1e-9 ? 'L' : 'S';
}

/**
 * Which parts this mode offers. GameMode is the ONE authority (GP-29): a branch
 * written here asks a NAMED question rather than testing a boolean, so when
 * research lands it replaces the `tier1` fallback and nothing else moves.
 */
export function offeredParts(all: readonly PartRow[], mode: ModeRules,
                             unlockedByTech?: (itemId: number) => boolean): PartRow[] {
  if (mode.fullCatalogue) return all.slice();
  // GP-267. RESEARCH JOINS THE TIER GATE, it does not replace it.
  //
  // The note above said research would replace the `tier1` fallback, and doing
  // that wholesale tonight would silently re-price the whole survival
  // catalogue: 13 parts are offered today by tier alone and none of them is
  // gated by a tech, so every one of them would vanish. The additive rule is
  // the one that is true right now: a part is offered if it is Tier 1 OR its
  // item has been unlocked. `FlightAutopilot` unlocks exactly one item, so
  // this changes exactly one row and the day more techs carry parts it keeps
  // working with no edit here.
  //
  // THE PREDICATE IS "A TECH GATES THIS AND IT HAS BEEN RESEARCHED", NOT
  // "NOTHING IS STOPPING IT". The first draft passed a lock-reason function and
  // treated the empty string as unlocked; that string is empty for an UNGATED
  // item too, so every Tier-2 part in the catalogue read as unlocked and
  // survival offered 24 of 25 instead of 13. Found by driving it, invisible in
  // the source, and the reason the port is named for the thing it asserts.
  //
  // A missing port means NOT unlocked, never "unlocked". A gate that opens when
  // its authority is absent is not a gate.
  return all.filter((p) => p.tier1
    || (unlockedByTech !== undefined && p.itemId > 0 && unlockedByTech(p.itemId)));
}

/** One line of specification for the catalogue list. */
export function detailOf(p: PartRow): string {
  const size = `${p.diameterM.toFixed(2)} x ${p.heightM.toFixed(2)} m`;
  if (p.thrustVacuumN > 0) {
    const kn = (p.thrustVacuumN / 1000).toFixed(0);
    return `${size}, ${kn} kN vac, Isp ${p.ispSeaLevelS.toFixed(0)}/${p.ispVacuumS.toFixed(0)} s`;
  }
  if (p.propellantKg > 0) {
    return `${size}, ${p.dryMassKg.toFixed(0)} kg dry + ${p.propellantKg.toFixed(0)} kg`;
  }
  return `${size}, ${p.dryMassKg.toFixed(0)} kg`;
}
