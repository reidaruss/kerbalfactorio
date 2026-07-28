// Who pays for a vessel part, and what the refusal says.
//
// Split out of `Vab.ts` at the 400-line cap, and it is a real seam: everything
// here is a question about the PACK and the MODE, and nothing in it knows what a
// node or a stage is. GP-29's rule is the one that matters and it lives here
// whole: the mode may lift a cost, but `affordInCore` still publishes /core's own
// unmodified verdict, so "12 parts placed" can never be confused with a broken
// affordability check.
import { scratchU8 } from '../sim/wasm/heap.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import type { ModeRules } from './GameMode.js';
import type { PartRow } from './VesselCatalogue.js';

export class VabCost {
  private readonly itemNames = new Map<number, string>();

  constructor(private readonly M: OfCoreModule,
              private readonly mode: ModeRules) {}

  canAfford(p: PartRow): boolean {
    return this.mode.freeBuild || this.affordInCore(p);
  }

  /** All-or-nothing, and it adds no item: commit the placement only on true. */
  pay(p: PartRow): boolean {
    if (this.mode.freeBuild) return true;
    return vesselAbi(this.M)._of_vs_part_pay(p.index) === 1;
  }

  refund(p: PartRow): void { vesselAbi(this.M)._of_vs_part_refund(p.index); }

  /** /core's OWN verdict, NOT overridden by the mode (GP-29). */
  affordInCore(p: PartRow): boolean {
    return vesselAbi(this.M)._of_vs_part_can_afford(p.index) === 1;
  }

  why(p: PartRow): string { return `need ${this.text(p)}`; }

  text(p: PartRow): string {
    if (this.mode.freeBuild) return 'free';
    if (p.cost.length === 0) return 'no cost';
    return p.cost.map((c) => `${c.count} ${this.itemName(c.item)}`).join(' + ');
  }

  private itemName(item: number): string {
    const hit = this.itemNames.get(item);
    if (hit !== undefined) return hit;
    const n = this.M._of_gp_item_name(item);
    const s = n > 0 ? new TextDecoder().decode(scratchU8(this.M, n).slice())
                    : `item ${item}`;
    this.itemNames.set(item, s);
    return s;
  }
}
