// One live vessel design: a /core `Vessel` handle plus the readouts the
// assembly view draws. Nothing is computed here that /core computes; every
// number below is a copy out of the scratch arena taken immediately after the
// call that produced it (standing rule 5).
import { scratchF64, scratchI32 } from '../sim/wasm/heap.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  vesselAbi, MASS_PROPS_WORDS, PART_ROW_WORDS, STAGE_PERF_WORDS, TRANSFORM_WORDS,
} from '../sim/wasm/vesselabi.js';
import type { OfVesselModule } from '../sim/wasm/vesselabi.js';

export interface DesignPart {
  handle: number;
  partId: number;
  parent: number;      // handle, or -1 for the root
  attach: number;      // Attach enum
  stage: number;
  originM: [number, number, number];
  centroidM: [number, number, number];
  radialAngleRad: number;
  propellantKg: number;
}

export interface StageRow {
  index: number; startMassKg: number; endMassKg: number; propellantKg: number;
  ispVacuumS: number; thrustVacuumN: number; thrustSeaLevelN: number;
  deltaVVacuumMS: number; burnTimeS: number; twr: number;
  engines: number; partCount: number;
  /**
   * GP-118. How many parts this stage DECOUPLES, which `_of_vs_stage_info`
   * already published in its second word and nothing had ever read. It is the
   * fact that separates "this stage does nothing" from "this stage drops a spent
   * booster", and without it the pre-flight check would have to refuse the
   * decoupler-under-a-bell vehicle GP-73 measured actually flying.
   */
  decouplers: number;
}

export interface DesignStats {
  parts: number; totalDeltaV: number; massKg: number; dryKg: number;
  propellantKg: number; lengthM: number; padTwr: number;
  staticMarginM: number; stable: boolean; crew: number;
  comM: [number, number, number];
}

/** The serialised form. Positions are NOT stored: the tree plus the catalogue
 *  reproduces them exactly, and storing them would create a second authority
 *  for where a part sits. */
export interface DesignJson {
  v: 1;
  name: string;
  parts: { p: number; parent: number; a: number; ang: number; off: number; st: number }[];
  stages: { act: number[]; dec: number[] }[];
  /**
   * GP-75. WHETHER THE STAGE TABLE BELOW IS THE PLAYER'S OR THE DERIVATION'S,
   * which is `Vab.handStaged` and is state that has to travel WITH the table it
   * protects. Optional so an older slot is legal; absent reads as false, which
   * restores GP-33's stated rule (the latch is set when a stage arrow is
   * pressed) rather than the boot-time latch it had drifted into.
   */
  hs?: boolean;
}

const NEVER = 0x7fffffff;

export class VesselDesign {
  readonly handle: number;
  parts: DesignPart[] = [];
  stages: StageRow[] = [];
  stats: DesignStats = emptyStats();
  /** Bumped on every structural change, so a view can skip a rebuild. */
  revision = 0;

  private readonly V: OfVesselModule;

  constructor(private readonly M: OfCoreModule, private readonly body: number) {
    this.V = vesselAbi(M);
    this.handle = this.V._of_vs_create();
    this.refresh();
  }

  dispose(): void { this.V._of_vs_destroy(this.handle); }

  get empty(): boolean { return this.parts.length === 0; }
  get rootHandle(): number {
    const r = this.parts.find((p) => p.parent < 0);
    return r ? r.handle : -1;
  }
  find(handle: number): DesignPart | null {
    return this.parts.find((p) => p.handle === handle) ?? null;
  }

  // --- editing --------------------------------------------------------------

  addRoot(partId: number): number {
    const h = this.V._of_vs_add_root(this.handle, partId);
    if (h >= 0) this.changed();
    return h;
  }

  attach(parent: number, partId: number, how: number,
         angleRad = 0, offsetM = 0): number {
    const h = this.V._of_vs_attach(this.handle, parent, partId, how, angleRad, offsetM);
    if (h >= 0) this.changed();
    return h;
  }

  /** Removes the part and everything below it. -> parts removed. */
  remove(handle: number): number {
    const n = this.V._of_vs_remove(this.handle, handle);
    if (n > 0) this.changed();
    return n;
  }

  /** Every part in the subtree rooted at `handle`, inclusive. */
  subtree(handle: number): DesignPart[] {
    const out: DesignPart[] = [];
    for (const p of this.parts) {
      let cur: number = p.handle;
      for (let guard = 0; guard < 4096 && cur >= 0; ++guard) {
        if (cur === handle) { out.push(p); break; }
        const q = this.find(cur);
        if (!q) break;
        cur = q.parent;
      }
    }
    return out;
  }

  clear(): void {
    this.V._of_vs_clear(this.handle);
    this.changed();
  }

  autostage(): number {
    const n = this.V._of_vs_autostage(this.handle);
    this.changed();
    return n;
  }

  /** Reorder. /core renumbers every part's stage group through the same
   *  permutation, so the readouts describe the vessel that now exists. */
  stageMove(from: number, to: number): boolean {
    const ok = this.V._of_vs_stage_move(this.handle, from, to) === 1;
    if (ok) this.changed();
    return ok;
  }

  private changed(): void { this.revision += 1; this.refresh(); }

  // --- reading --------------------------------------------------------------

  refresh(): void {
    const M = this.M, V = this.V, v = this.handle;

    const n = V._of_vs_parts(v);
    const rows = n > 0 ? scratchI32(M, n * PART_ROW_WORDS).slice() : new Int32Array(0);
    const t = V._of_vs_transforms(v);
    const tr = t > 0 ? scratchF64(M, t * TRANSFORM_WORDS).slice() : new Float64Array(0);

    const parts: DesignPart[] = [];
    for (let i = 0; i < n; ++i) {
      const r = i * PART_ROW_WORDS, o = i * TRANSFORM_WORDS;
      parts.push({
        handle: rows[r] ?? -1, partId: rows[r + 1] ?? 0, parent: rows[r + 2] ?? -1,
        attach: rows[r + 3] ?? 0, stage: rows[r + 4] ?? NEVER,
        originM: [tr[o] ?? 0, tr[o + 1] ?? 0, tr[o + 2] ?? 0],
        centroidM: [tr[o + 3] ?? 0, tr[o + 4] ?? 0, tr[o + 5] ?? 0],
        radialAngleRad: tr[o + 6] ?? 0, propellantKg: tr[o + 7] ?? 0,
      });
    }
    this.parts = parts;

    const sc = V._of_vs_stage_performance(v);
    const sp = sc > 0 ? scratchF64(M, sc * STAGE_PERF_WORDS).slice() : new Float64Array(0);
    const stages: StageRow[] = [];
    for (let k = 0; k < sc; ++k) {
      const b = k * STAGE_PERF_WORDS;
      const last = k === sc - 1;
      const group = this.stageGroup(k);
      stages.push({
        index: k, startMassKg: sp[b + 1] ?? 0, endMassKg: sp[b + 2] ?? 0,
        propellantKg: sp[b + 3] ?? 0, ispVacuumS: sp[b + 4] ?? 0,
        thrustVacuumN: sp[b + 6] ?? 0, thrustSeaLevelN: sp[b + 7] ?? 0,
        deltaVVacuumMS: sp[b + 9] ?? 0, burnTimeS: sp[b + 11] ?? 0,
        twr: V._of_vs_twr(v, k, this.body, 0),
        engines: group.activate,
        decouplers: group.decouple,
        partCount: parts.filter((p) => (last ? p.stage >= k : p.stage === k)).length,
      });
    }
    this.stages = stages;

    const mpN = V._of_vs_mass_properties(v);
    const mp = mpN === MASS_PROPS_WORDS
      ? scratchF64(M, MASS_PROPS_WORDS).slice() : new Float64Array(MASS_PROPS_WORDS);
    const margin = V._of_vs_static_margin(v);
    this.stats = {
      parts: parts.length,
      totalDeltaV: V._of_vs_total_dv_vacuum(v),
      massKg: mp[2] ?? 0, dryKg: mp[0] ?? 0, propellantKg: mp[1] ?? 0,
      lengthM: V._of_vs_length(v),
      padTwr: sc > 0 ? V._of_vs_twr(v, 0, this.body, 0) : 0,
      staticMarginM: margin,
      // Negative margin is stable (centre of pressure BEHIND centre of mass).
      // An empty or finless design reads unstable and should, because it is.
      stable: parts.length > 0 && margin < 0,
      crew: V._of_vs_crew_capacity(v),
      comM: [mp[3] ?? 0, mp[4] ?? 0, mp[5] ?? 0],
    };
  }

  /** `_of_vs_stage_info` word 0 and word 1: how many parts this stage ACTIVATES
   *  (autostage puts engines there) and how many it DECOUPLES. Read together,
   *  in one call, because two calls would take two views of the same scratch. */
  private stageGroup(k: number): { activate: number; decouple: number } {
    const w = this.V._of_vs_stage_info(this.handle, k);
    if (w <= 0) return { activate: 0, decouple: 0 };
    const a = scratchI32(this.M, w).slice();
    return { activate: a[0] ?? 0, decouple: a[1] ?? 0 };
  }

  // --- serialisation --------------------------------------------------------

  toJson(name: string, handStaged = false): DesignJson {
    const idx = new Map<number, number>();
    this.parts.forEach((p, i) => idx.set(p.handle, i));
    const stages: { act: number[]; dec: number[] }[] = [];
    const count = this.V._of_vs_stage_count(this.handle);
    for (let k = 0; k < count; ++k) {
      const w = this.V._of_vs_stage_info(this.handle, k);
      const a = w > 0 ? scratchI32(this.M, w).slice() : new Int32Array([0, 0]);
      const nA = a[0] ?? 0, nD = a[1] ?? 0;
      const act: number[] = [], dec: number[] = [];
      for (let i = 0; i < nA; ++i) act.push(idx.get(a[2 + i] ?? -1) ?? -1);
      for (let i = 0; i < nD; ++i) dec.push(idx.get(a[2 + nA + i] ?? -1) ?? -1);
      stages.push({ act, dec });
    }
    return {
      v: 1, name,
      parts: this.parts.map((p) => ({
        p: p.partId, parent: p.parent < 0 ? -1 : (idx.get(p.parent) ?? -1),
        a: p.attach, ang: p.radialAngleRad, off: 0, st: p.stage,
      })),
      stages,
      hs: handStaged,
    };
  }

  /** Rebuild from JSON. Returns the number of parts restored; a malformed row
   *  is skipped rather than thrown, the same rule SaveGame applies. */
  fromJson(d: DesignJson): number {
    this.V._of_vs_clear(this.handle);
    const handles: number[] = [];
    for (const row of d.parts ?? []) {
      if (typeof row?.p !== 'number') { handles.push(-1); continue; }
      let h = -1;
      if (row.parent < 0) h = this.V._of_vs_add_root(this.handle, row.p);
      else {
        const ph = handles[row.parent];
        if (ph !== undefined && ph >= 0) {
          h = this.V._of_vs_attach(this.handle, ph, row.p, row.a,
                                   row.ang ?? 0, row.off ?? 0);
        }
      }
      handles.push(h);
      // Set the stage group AFTER the attach, and never through stage_clear,
      // which resets every part to payload and would undo this.
      if (h >= 0 && typeof row.st === 'number') {
        this.V._of_vs_set_part_stage(this.handle, h, row.st === NEVER ? -1 : row.st);
      }
    }
    for (const s of d.stages ?? []) {
      const k = this.V._of_vs_stage_add(this.handle);
      for (const i of s.act ?? []) {
        const h = handles[i];
        if (h !== undefined && h >= 0) this.V._of_vs_stage_push(this.handle, k, 0, h);
      }
      for (const i of s.dec ?? []) {
        const h = handles[i];
        if (h !== undefined && h >= 0) this.V._of_vs_stage_push(this.handle, k, 1, h);
      }
    }
    this.changed();
    return this.parts.length;
  }
}

function emptyStats(): DesignStats {
  return {
    parts: 0, totalDeltaV: 0, massKg: 0, dryKg: 0, propellantKg: 0,
    lengthM: 0, padTwr: 0, staticMarginM: 0, stable: false, crew: 0,
    comM: [0, 0, 0],
  };
}
