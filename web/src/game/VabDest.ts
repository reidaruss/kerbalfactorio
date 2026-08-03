// =============================================================================
// VabDest.ts - the bay's destination CHOICE: the state behind the panel block.
//
// GP-265. `ui/VabDestination` is the screen (DW-2: plain DOM, data in, callbacks
// out) and this is the mode-side half that decides what goes on it. The split
// is the same one `VabPanel`/`Vab` already has, and it matters here for one
// concrete reason: WHICH DESTINATION IS SELECTED IS NOT A PROPERTY OF THE
// DESIGN. It survives placing a part, re-staging, saving and loading, and it
// must, because a player who picks Anchorage and then adds a booster is asking
// exactly the question this feature exists to answer.
//
// The rows come from `AutopilotTargets`' sources and are never merged by kind
// here, so a planetary body arriving later changes nothing in this file.
// =============================================================================
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { AUTOPILOT_ITEM_ID, designReach, moduleFitted } from './Autopilot.js';
import type { Reach } from './Autopilot.js';
import {
  bodySource, collect, findTarget, registrySource, requestedOrbit,
} from './AutopilotTargets.js';
import type { AutopilotTarget, HomeBody } from './AutopilotTargets.js';
import type { VabDestState } from '../ui/VabDestination.js';
import type { DesignPart } from './VesselDesign.js';

/** Where a first orbit sits. 100 km is the altitude the teleport cheat and the
 *  ascent probe both already use, so the default the player is offered is the
 *  one the rest of the game treats as "in orbit". */
const DEFAULT_ALT_KM = 100;
const DEFAULT_INC_DEG = 0;

export interface VabDestPorts {
  M: OfCoreModule;
  /** The /core body handle the bay is on. */
  body: number;
  designHandle(): number;
  parts(): readonly DesignPart[];
  catalogueIds(): readonly number[];
  /** /core's own total delta-v for the design as drawn. */
  dvAvailableMS(): number;
  /** GP-267. '' when the item is available or ungated, else the NAME of the
   *  tech that unlocks it. Optional so `?research=0` and every existing
   *  caller keep working, and an absent authority reads as UNGATED. */
  lockOf?(itemId: number): string;
  /** GP-267. TRUE only when a tech gates this item AND it is researched. */
  unlockedByTech?(itemId: number): boolean;
}

export class VabDest {
  /** '' is "nothing picked", which is a real state and not a default. */
  selectedId = '';
  altKm = DEFAULT_ALT_KM;
  incDeg = DEFAULT_INC_DEG;
  private home: HomeBody | null = null;

  constructor(private readonly p: VabDestPorts) {}

  /** Radius and gravity off /core's own body, read once. DW-18: this client
   *  never carries a second copy of either number. */
  private body(): HomeBody {
    if (this.home === null) {
      this.home = {
        name: 'home',
        radiusM: this.p.M._of_body_radius(this.p.body),
        muM3S2: this.p.M._of_body_mu(this.p.body),
      };
    }
    return this.home;
  }

  rows(): AutopilotTarget[] {
    const h = this.body();
    const out = collect([registrySource(h), bodySource()]);
    // The requested orbit is LAST because it is the one that is always
    // available: a list whose first row is the same every session teaches the
    // player nothing about what is up there.
    out.push(requestedOrbit(h, this.altKm * 1000, this.incDeg));
    return out;
  }

  select(id: string): void {
    this.selectedId = this.selectedId === id ? '' : id;
  }

  setOrbit(altKm: number, incDeg: number): void {
    this.altKm = altKm;
    this.incDeg = incDeg;
  }

  /** What the panel draws. One pass, one place, so the screen and any probe
   *  read the same object. */
  state(): VabDestState {
    const rows = this.rows();
    const sel = findTarget(rows, this.selectedId);
    const fit = moduleFitted(this.p.parts(), this.p.catalogueIds(),
                             this.p.lockOf?.bind(this.p));
    let reach: Reach = {
      waitingOn: '', ok: false, dvRequiredMS: NaN, dvAvailableMS: NaN,
      marginMS: NaN, feasible: false, legsMS: [],
    };
    if (sel !== null && sel.orbit !== null) {
      reach = designReach(this.p.M, this.p.designHandle(), sel.orbit);
    }
    return {
      rows, selectedId: this.selectedId, fit, reach,
      dvAvailableMS: this.p.dvAvailableMS(),
      altKm: this.altKm, incDeg: this.incDeg,
    };
  }

  /** For `__of.vab()`. The numbers a probe asserts, in /core's own units. */
  report(): unknown {
    const s = this.state();
    return {
      selectedId: s.selectedId,
      rowIds: s.rows.map((r) => r.id),
      blockedIds: s.rows.filter((r) => r.blocked !== '').map((r) => r.id),
      moduleFitted: s.fit.fitted,
      moduleCount: s.fit.count,
      partMissingFromCatalogue: s.fit.partMissingFromCatalogue,
      lockedByTech: s.fit.lockedByTech,
      moduleReason: s.fit.reason,
      waitingOn: s.reach.waitingOn,
      solverOk: s.reach.ok,
      legsMS: [...s.reach.legsMS],
      dvAvailableMS: s.dvAvailableMS,
      dvRequiredMS: s.reach.dvRequiredMS,
      marginMS: s.reach.marginMS,
      feasible: s.reach.feasible,
      altKm: s.altKm, incDeg: s.incDeg,
      // GP-267. /core's OWN two answers about the part item, published side by
      // side so a probe asserts the GATE rather than the sentence the gate
      // produced. `lock` is empty for an ungated item and for an unlocked one;
      // `unlocked` is true only for a gated-and-earned one. A probe that read
      // one without the other could not tell survival-before-research from
      // sandbox, which is the exact confusion this pass already made once.
      partItemId: AUTOPILOT_ITEM_ID,
      partLock: this.p.lockOf?.(AUTOPILOT_ITEM_ID) ?? '',
      partUnlockedByTech: this.p.unlockedByTech?.(AUTOPILOT_ITEM_ID) ?? false,
    };
  }
}
