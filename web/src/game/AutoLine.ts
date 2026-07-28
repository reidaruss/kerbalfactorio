// THE automation authority in the client: a typed face over the of_net_* flat C
// ABI (of_core_api.cpp section 7), which is a thin shim over the tested
// automation.h / factory_sim.h. No belt speed, no craft time, no extraction rate
// and no wiring decision is made here. Everything is /core's.
//
// STANDING RULE 5 lives in every read below: a scratch view is built AFTER the
// producing call and COPIED before anything else calls into WASM. The entity
// stream fills BOTH the i32 and f32 arenas in one call, which is safe because
// they are separate buffers, but the copy still happens before the next call.
//
// DW-8 lives here too, in what this file does NOT expose per item: belts are
// read as O(lines) flow rows, and GetLineItems is a separate, explicitly
// near-field call. Nothing in the render path is allowed to iterate items.

import { scratchF32, scratchI32, type OfCoreModule } from '../sim/wasm/heap.js';

/** One row of FFactoryEntityState (section 6.2), unpacked. */
export interface EntityRow {
  id: number; typeId: number; visual: number; anim: number;
  lod: number; boundCm: number;
  x: number; y: number; z: number;
}

/** One row of FFactoryBeltFlowState: the whole belt at LOD 1+, O(lines). */
export interface FlowRow {
  lineId: number; item: number; speedQuant: number; density: number;
  compressed: number;
}

/** VisualState, in the order factory_sim.h's entityVisualState returns them. */
export const VISUAL = { idle: 0, working: 1, blocked: 2, noPower: 3 } as const;

export class AutoLine {
  /** The /core network handle. Recreated whenever the topology changes. */
  private handle: number;
  /** Ticks stepped since the network was created. Proof the sim advanced. */
  ticks = 0;
  /** Networks discarded by a rebuild, and the belt items they were carrying. */
  rebuilds = 0;
  itemsLostToRebuild = 0;

  constructor(private readonly M: OfCoreModule, private readonly fixedDt: number) {
    this.handle = M._of_net_create(fixedDt);
  }

  get net(): number { return this.handle; }

  /**
   * Throw the network away and start a fresh one.
   *
   * FactorySim has no entity removal by design (the SoA is append-only and the
   * dense index IS the render key), so a topology change is a rebuild. The
   * caller is responsible for carrying state across: miners are re-placed with
   * the ore they had left, machine inputs are re-fed. Items in flight ON A BELT
   * are genuinely lost, which is why the count is reported rather than hidden.
   */
  recreate(itemsInFlight: number): void {
    this.M._of_net_destroy(this.handle);
    this.handle = this.M._of_net_create(this.fixedDt);
    this.rebuilds++;
    this.itemsLostToRebuild += itemsInFlight;
    this.ticks = 0;
  }

  destroy(): void { this.M._of_net_destroy(this.handle); }

  // --- placement -----------------------------------------------------------
  /** Bind a miner to a deposit BY NODE KIND: deposits.h picks the ore. */
  placeMinerForNode(kind: number, deposit: number, ratePerSec: number,
                    outCap = 50): number {
    return this.M._of_net_place_miner_for_node(
      this.handle, kind, deposit, ratePerSec, outCap);
  }
  placeBelt(tiles: number, speed: number): number {
    return this.M._of_net_place_belt(this.handle, tiles, speed);
  }
  placeSmelter(ore: number, ingot: number, craftTicks: number, outCap = 0): number {
    return this.M._of_net_place_smelter(this.handle, ore, ingot, craftTicks, 0, outCap);
  }
  /**
   * FS-56: a MULTI-INPUT machine, which is the shape the assembler needs and the
   * one thing `placeSmelter` cannot express.
   *
   * `automation.h`'s `placeAssembler` has shipped since Phase 1 and this is its
   * first caller in the browser. A single-ingredient recipe is `inB = 0,
   * countB = 0`, which /core documents as legal and reads as a satisfied second
   * slot, so no caller needs a branch. `powerW` is 0 for the same reason the
   * coal smelter's is: the assembler is a fuel-free tier-1 machine until the
   * ladder in `gameplay.h` section S.0 grows a powered rung for it, and passing a
   * draw here would make it brown out on a grid it was never registered with.
   */
  placeAssembler(inA: number, countA: number, inB: number, countB: number,
                 out: number, outCount: number, craftTicks: number,
                 outCap = 0): number {
    return this.M._of_net_place_assembler(this.handle, inA, countA, inB, countB,
      out, outCount, craftTicks, 0, outCap);
  }
  /** Wire two buildings. `item` 0 lets /core infer it. True on success. */
  connect(from: number, to: number): boolean {
    return this.M._of_net_connect(this.handle, from, to, 0) === 1;
  }
  /**
   * Stamp the section 6 render metadata. Position is metres RELATIVE to the
   * caller's 64-bit anchor (standing rule 6): the stream field is float32, and
   * an absolute body-frame metre at Forge's 600 km radius quantizes to ~64 mm.
   */
  setPlacement(build: number, typeId: number, x: number, y: number, z: number,
               boundCm: number): void {
    this.M._of_net_set_placement(this.handle, build, typeId, x, y, z, boundCm);
  }
  entityIndex(build: number): number {
    return this.M._of_net_entity_index(this.handle, build);
  }
  feed(build: number, count: number): void {
    this.M._of_net_feed_machine(this.handle, build, count);
  }
  /** ABI 17 / FS-56: the SECOND ingredient slot. Its twin above feeds slot 1. */
  feed2(build: number, count: number): void {
    this.M._of_net_feed_machine2(this.handle, build, count);
  }

  // --- advance -------------------------------------------------------------
  step(ticks: number): void {
    if (ticks <= 0) return;
    this.M._of_net_step_n(this.handle, ticks);
    this.ticks += ticks;
  }
  /** /core's own tick counter, so a probe can check ours against it (DW-20). */
  get coreTicks(): number { return this.M._of_net_tick_index(this.handle); }

  // --- queries -------------------------------------------------------------
  minerRemaining(build: number): number {
    return this.M._of_net_miner_remaining(this.handle, build);
  }
  minerDepleted(build: number): boolean {
    return this.M._of_net_miner_depleted(this.handle, build) === 1;
  }
  outputBuffer(build: number): number {
    return this.M._of_net_output_buffer(this.handle, build);
  }
  inputBuffer(build: number): number {
    return this.M._of_net_input_buffer(this.handle, build);
  }
  /** FS-56: the SECOND ingredient's slot. `of_net_input2_buffer` has been in the
   *  shim and in the shipped wasm since ABI 16 with no caller, so reading it
   *  needs no bump: it is a TS declaration catching up with a live export. */
  input2Buffer(build: number): number {
    return this.M._of_net_input2_buffer(this.handle, build);
  }
  beltItems(build: number): number {
    return this.M._of_net_belt_item_count(this.handle, build);
  }
  working(build: number): boolean {
    return this.M._of_net_working(this.handle, build) === 1;
  }
  progress01(build: number): number {
    return this.M._of_net_progress01(this.handle, build);
  }
  producedOf(item: number): number {
    return this.M._of_net_produced_of(this.handle, item);
  }
  /** Take up to `want` out of a building's output buffer. Returns what moved. */
  takeOutput(build: number, want: number): number {
    return this.M._of_net_take_output(this.handle, build, want);
  }

  // --- the section 6 stream ------------------------------------------------
  /**
   * One row per live entity, in dense index order. The i32 and f32 arenas are
   * separate buffers filled by the same call, so both views are valid until the
   * next producing call; both are read out into plain objects here.
   */
  entityStates(): EntityRow[] {
    const n = this.M._of_net_emit_entity_states(this.handle);
    if (n <= 0) return [];
    const ip = scratchI32(this.M, n * 6);
    const fp = scratchF32(this.M, n * 3);
    const out: EntityRow[] = [];
    for (let i = 0; i < n; ++i) {
      out.push({
        id: ip[i * 6], typeId: ip[i * 6 + 1], visual: ip[i * 6 + 2],
        anim: ip[i * 6 + 3], lod: ip[i * 6 + 4], boundCm: ip[i * 6 + 5],
        x: fp[i * 3], y: fp[i * 3 + 1], z: fp[i * 3 + 2],
      });
    }
    return out;
  }

  /** THE belt render view (DW-8): O(lines), never O(items). */
  beltFlows(): FlowRow[] {
    const n = this.M._of_net_emit_belt_flows(this.handle);
    if (n <= 0) return [];
    const p = scratchI32(this.M, n * 5);
    const out: FlowRow[] = [];
    for (let i = 0; i < n; ++i) {
      out.push({
        lineId: p[i * 5], item: p[i * 5 + 1], speedQuant: p[i * 5 + 2],
        density: p[i * 5 + 3], compressed: p[i * 5 + 4],
      });
    }
    return out;
  }

  /**
   * The ONE O(items) pull, for near belts only. Returns [item, unitOffset]
   * pairs; divide the offset by unitsPerTile for metres from the line head.
   */
  lineItems(build: number): { item: number; offsetTiles: number }[] {
    const n = this.M._of_net_get_line_items(this.handle, build);
    if (n <= 0) return [];
    const per = this.M._of_net_units_per_tile() || 256;
    const p = scratchI32(this.M, n * 2);
    const out: { item: number; offsetTiles: number }[] = [];
    for (let i = 0; i < n; ++i) {
      out.push({ item: p[i * 2], offsetTiles: p[i * 2 + 1] / per });
    }
    return out;
  }

  /** Sub-tile units per belt tile: 256, and asked rather than assumed. */
  get unitsPerTile(): number { return this.M._of_net_units_per_tile() || 256; }

  /**
   * FS-28: take ONE item off a belt, nearest to `offsetTiles` from the line
   * head. Returns the ItemId taken, or 0 when nothing was within `toleranceTiles`.
   *
   * The offsets are in TILES here and in sub-tile units across the bridge, the
   * same conversion `lineItems` does in the other direction, so a caller that
   * read an item's position out of `lineItems` can hand the same number straight
   * back and get that item.
   */
  takeLineItem(build: number, offsetTiles: number, toleranceTiles: number): number {
    const per = this.unitsPerTile;
    return this.M._of_net_take_line_item(this.handle, build,
      Math.max(0, Math.round(offsetTiles * per)),
      Math.max(0, Math.round(toleranceTiles * per)));
  }
}
