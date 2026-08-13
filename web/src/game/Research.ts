// THE TECH TREE, in the client at last.
//
// `core/include/of/research.h` has been green since June and had NEVER been
// called from the browser. A sandbox probe reported `researchGatesInClient: 0`
// and said so plainly rather than faking a pass, which is how we know. This
// file is the typed face over the `of_rs_*` bridge (ABI 9), and like GameCore
// it implements NO RULE: every affordability check, every prereq walk and every
// refusal comes back out of WASM, so the browser cannot hold an opinion the
// headless suites do not.
//
// TWO THINGS THIS FILE IS CAREFUL ABOUT.
//
// THE REFUSAL IS A CODE, NOT A SENTENCE. `/core` returns `ResearchBlock` plus
// the offending id and this file composes the line with names it already has.
// That is what makes "refused because the prereq is missing" and "refused
// because the science is short" DIFFERENT assertions: a boolean cannot tell
// them apart, and a gate that refuses for the wrong reason passes a boolean
// test every time.
//
// AVAILABLE IS NOT UNLOCKED. An item is gated if and only if some tech names
// it, so everything the tree never mentions is free for ever and nobody had to
// write a "wood is not locked" list. `available()` is the question every gate
// in the client asks; `gated()` is the one a panel asks to decide whether to
// say anything at all.

import { scratchF64, scratchI32, scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';

/** `research.h` ResearchBlock, in enum order. */
export const BLOCK = {
  None: 0, UnknownTech: 1, AlreadyUnlocked: 2,
  PrereqMissing: 3, MilestoneMissing: 4, CostShort: 5,
} as const;

/** `research.h` milestones. DW-29's autopilot condition is ReachedOrbit.
 *  RuinInvestigated (L7, GP-546 to GP-549) is Electrification's: granted from
 *  `RuinInteract.ts` when the player interacts at a ruin's investigate socket. */
export const MILESTONE = {
  ReachedOrbit: 0x0001, LandedOffWorld: 0x0002, RuinInvestigated: 0x0003,
} as const;

export interface TechCost { item: number; have: number; need: number }
/** kind 0 = item, 1 = entity TypeId, 2 = RecipeId. */
export interface TechUnlock { kind: number; id: number }

export interface Tech {
  index: number;
  id: number;
  name: string;
  /** Longest prereq chain behind it: the column a graph lays it out in. */
  depth: number;
  unlocked: boolean;
  canResearch: boolean;
  block: number;
  /** Set when block is PrereqMissing. */
  prereq: number;
  /** Set when block is MilestoneMissing. */
  milestone: number;
  /** Set when block is CostShort, with how many more are needed. */
  costItem: number;
  shortBy: number;
  prereqs: number[];
  cost: TechCost[];
  unlocks: TechUnlock[];
}

const decoder = new TextDecoder();

export class Research {
  /** Techs researched this session, so a probe can prove the button did work. */
  researched = 0;
  private readonly names = new Map<number, string>();

  constructor(private readonly M: OfCoreModule) {
    // Idempotent, and of_gp_init already called it. Called again here so a
    // client that reached this object by some other path still gets a tree
    // rather than a set of gates that all silently answer yes.
    this.M._of_rs_init();
  }

  get count(): number { return this.M._of_rs_tech_count(); }

  /** Every tech with its live state. Rebuilt per call: costs move as the pack
   *  does, and a cached row is a row that greys the wrong button. */
  list(): Tech[] {
    const out: Tech[] = [];
    for (let i = 0; i < this.count; ++i) {
      const t = this.at(i);
      if (t !== null) out.push(t);
    }
    return out;
  }

  at(i: number): Tech | null {
    if (this.M._of_rs_tech_state(i) !== 9) return null;
    // Copied out of the heap IMMEDIATELY (standing rule 5): every call below
    // re-enters WASM and any growth detaches the view.
    const s = scratchI32(this.M, 9).slice();
    const nPre = this.M._of_rs_tech_prereqs(i);
    const pre = nPre > 0 ? Array.from(scratchI32(this.M, nPre).slice()) : [];
    const nCost = this.M._of_rs_tech_cost(i);
    const c = nCost > 0 ? scratchI32(this.M, nCost * 3).slice() : new Int32Array(0);
    const cost: TechCost[] = [];
    for (let k = 0; k < nCost; ++k) {
      cost.push({ item: c[k * 3], have: c[k * 3 + 1], need: c[k * 3 + 2] });
    }
    const nUn = this.M._of_rs_tech_unlocks(i);
    const u = nUn > 0 ? scratchI32(this.M, nUn * 2).slice() : new Int32Array(0);
    const unlocks: TechUnlock[] = [];
    for (let k = 0; k < nUn; ++k) unlocks.push({ kind: u[k * 2], id: u[k * 2 + 1] });
    return {
      index: i, id: s[0], name: this.techName(i), depth: s[1],
      unlocked: s[2] !== 0, canResearch: s[3] !== 0, block: s[4],
      prereq: s[5], milestone: s[6], costItem: s[7], shortBy: s[8],
      prereqs: pre, cost, unlocks,
    };
  }

  /** Memoised: a tech's display name never changes within a session. */
  techName(i: number): string {
    const hit = this.names.get(i);
    if (hit !== undefined) return hit;
    const n = this.M._of_rs_tech_name(i);
    const s = n > 0 ? decoder.decode(scratchU8(this.M, n).slice()) : `tech#${i}`;
    this.names.set(i, s);
    return s;
  }

  milestoneName(m: number): string {
    const n = this.M._of_rs_milestone_name(m);
    return n > 0 ? decoder.decode(scratchU8(this.M, n).slice()) : '';
  }

  /** Spend the science out of the PACK and apply the unlock. All or nothing. */
  research(techId: number): boolean {
    const ok = this.M._of_rs_try(techId) === 1;
    if (ok) this.researched++;
    return ok;
  }

  // --- the gates ------------------------------------------------------------
  /** May the player use this item right now? True when no tech gates it. */
  itemAvailable(item: number): boolean {
    return this.M._of_rs_item_available(item) === 1;
  }
  /** Does ANY tech name this item? A panel asks so it knows whether to speak. */
  itemGated(item: number): boolean {
    return this.M._of_rs_item_gated(item) === 1;
  }
  entityAvailable(typeId: number): boolean {
    return this.M._of_rs_entity_available(typeId) === 1;
  }
  /** The hand recipe at `index` in the of_gp_recipe_* index space. */
  recipeAvailable(index: number): boolean {
    return this.M._of_rs_recipe_available(index) === 1;
  }

  /** Which tech would unlock this item, for the sentence on a greyed row. */
  techForItem(item: number): Tech | null {
    for (const t of this.list()) {
      for (const u of t.unlocks) if (u.kind === 0 && u.id === item) return t;
    }
    return null;
  }
  /** Which tech would unlock this entity TypeId. */
  techForEntity(typeId: number): Tech | null {
    for (const t of this.list()) {
      for (const u of t.unlocks) if (u.kind === 1 && u.id === typeId) return t;
    }
    return null;
  }

  // --- milestones (DW-29) ---------------------------------------------------
  /** Record that the player DID something. The flight lane calls this the
   *  first time an ascent comes back down. Monotonic. */
  earn(m: number): boolean { return this.M._of_rs_set_milestone(m) === 1; }
  earned(m: number): boolean { return this.M._of_rs_has_milestone(m) === 1; }
  milestones(): number[] {
    const n = this.M._of_rs_milestones();
    return n > 0 ? Array.from(scratchI32(this.M, n).slice()) : [];
  }

  // --- persistence ----------------------------------------------------------
  unlocked(): number[] {
    const n = this.M._of_rs_unlocked();
    return n > 0 ? Array.from(scratchI32(this.M, n).slice()) : [];
  }
  /** The load path: restore the unlock SET rather than replaying the spend,
   *  which would need the exact science the player used. Milestones restore
   *  separately through `earn`, deliberately: a reload that silently granted
   *  one would hand out DW-29's autopilot for free. */
  restore(techIds: readonly number[]): number {
    let n = 0;
    for (const t of techIds) if (this.M._of_rs_restore(t) === 1) n++;
    return n;
  }

  /** The science ItemIds, so nothing in JS types 0x0020. */
  scienceItems(): number[] {
    const n = this.M._of_rs_science_items();
    return n > 0 ? Array.from(scratchI32(this.M, n).slice()) : [];
  }

  report(): unknown {
    const techs = this.list();
    return {
      techs: techs.length,
      unlocked: techs.filter((t) => t.unlocked).length,
      available: techs.filter((t) => t.canResearch).length,
      researched: this.researched,
      milestones: this.milestones(),
      // The number the sandbox probe once reported as 0. It is how many things
      // the tree gates that the player may NOT use yet, which is the only
      // reading that distinguishes "a tech tree" from "a menu".
      gatesHeld: techs.filter((t) => !t.unlocked)
        .reduce((n, t) => n + t.unlocks.length, 0),
    };
  }
}

/**
 * GP-530. THE ONE ENTRY POINT for a LIVE grant. `Research.earn` alone was
 * reachable from exactly one call site in the whole web tree
 * (`PersistProgress.ts`'s restore path) and from nowhere that a player's own
 * play could reach: FlightAutopilot's `ReachedOrbit` gate was unearnable in a
 * fresh world, a live bug this wraps the fix for.
 *
 * A THIN WRAPPER, on purpose: `earn` (`_of_rs_set_milestone`) is already the
 * one authority and is already idempotent (research.h's `setMilestone`
 * no-ops on a milestone already held), so this adds nothing to the rule and
 * only adds the RECEIPT — the cause is logged so "why did this unlock" has an
 * answer beyond "it did". Returns what `earn` returned: true the first time,
 * false every time after.
 *
 * NOT for the restore path. `PersistProgress.ts` calls `p.research.earn`
 * directly and must keep doing so: a LOAD is not something the player DID
 * (SaveGame.ts's own `SaveProgress` header states the same rule for why
 * techs and milestones are separate lists), so it is deliberately not routed
 * through the function that exists to say a cause for live play.
 */
export function grantMilestone(r: Research, m: number, cause: string): boolean {
  const granted = r.earn(m);
  if (granted) {
    console.info(`[of] milestone earned: ${r.milestoneName(m)} (0x${m.toString(16)}) - ${cause}`);
  }
  return granted;
}

/** A read of the four progression f64 fields, shared by Progression.ts. */
export function readF64(M: OfCoreModule, n: number): number[] {
  return n > 0 ? Array.from(scratchF64(M, n).slice()) : [];
}
