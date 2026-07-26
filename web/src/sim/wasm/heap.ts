// Typed-array views over the WASM heap.
//
// STANDING RULE 5 (DECISIONS.md) lives here and nowhere else: -sALLOW_MEMORY_GROWTH
// can replace the whole WebAssembly.Memory buffer on ANY allocation, which detaches
// every typed array over the old buffer, and the scratch vectors can move on any
// producing call. So: never cache a heap view or a scratch pointer across a call
// into WASM. Re-read M.HEAPxx AND re-read the pointer, in that order, every time.
//
// Every scratch read in the codebase goes through these four helpers, so the rule
// is not something a caller can forget.

/** The Emscripten module, narrowed to the exports we actually call. */
export interface OfCoreModule {
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  _of_abi_version(): number;
  _of_last_hi(): number;
  _of_scratch_f32(): number;
  _of_scratch_f64(): number;
  _of_scratch_i32(): number;
  _of_scratch_u8(): number;

  _of_body_create_forge(seedLo: number, seedHi: number): number;
  _of_body_create_cinder(seedLo: number, seedHi: number): number;
  _of_body_destroy(body: number): void;
  _of_body_radius(body: number): number;
  _of_body_max_relief(body: number): number;
  _of_body_mu(body: number): number;
  _of_gravity_accel(body: number, rM: number): number;
  _of_body_kind(body: number): number;

  _of_base_height(body: number, dx: number, dy: number, dz: number): number;
  _of_surface_height(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_surface_radius(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_solid_at(body: number, edits: number, x: number, y: number, z: number): number;
  _of_solid_cell(body: number, edits: number, cx: number, cy: number, cz: number): number;
  _of_biome_at(body: number, dx: number, dy: number, dz: number): number;

  // --- W5 voxel edits. The main thread owns the ONE handle (DW-16); workers
  //     replay the op log into their own instance, they never share this one.
  _of_edits_create(): number;
  _of_edits_destroy(edits: number): void;
  _of_edits_dig(edits: number, body: number, x: number, y: number, z: number,
                radiusM: number): number;
  _of_edits_dig_cell(edits: number, cx: number, cy: number, cz: number): number;
  _of_edits_removed_count(edits: number): number;
  _of_edits_is_removed_cell(edits: number, cx: number, cy: number, cz: number): number;
  /** Fills i32 scratch [minX,minY,minZ,maxX,maxY,maxZ]; 1 = valid, 0 = untouched. */
  _of_edits_dirty_region(edits: number): number;
  _of_edits_clear_dirty(edits: number): void;
  /** Face count; i32 scratch holds 5 ints per face [cx,cy,cz,axis,sign]. */
  _of_exposed_faces(body: number, edits: number, x: number, y: number, z: number,
                    radiusM: number): number;
  _of_voxel_size(): number;
  _of_cell_for_pos(x: number, y: number, z: number): void;
  _of_cell_center(cx: number, cy: number, cz: number): void;
  _of_streamer_set_edits(s: number, edits: number): void;
  /** Replay one dig into the streamer's own edits and re-mesh the chunks it
   *  opened, publishing them through the normal ready path. Returns the count. */
  _of_streamer_dig(s: number, x: number, y: number, z: number, radiusM: number): number;
  _of_material_for_biome(biome: number): number;
  _of_latlon_to_dir(lat: number, lon: number): void;
  _of_dir_to_latlon(dx: number, dy: number, dz: number): void;

  _of_streamer_create(body: number, splitRatio: number, mergeHysteresis: number,
                      maxDepth: number, minResidentDepth: number,
                      skirtFraction: number, genBudget: number): number;
  _of_streamer_destroy(s: number): void;
  // ABI 2: takes the edits handle and derives from of_surface_radius, so it is
  // now on the one surface authority. SurfaceOracle.observerPos still computes
  // the position itself, which keeps the oracle the single caller of record.
  _of_observer_latlon_alt(body: number, edits: number, lat: number, lon: number,
                          altM: number): void;
  _of_streamer_update(s: number, ox: number, oy: number, oz: number): number;
  _of_streamer_evicted_count(s: number): number;
  _of_streamer_generated(s: number): number;
  _of_streamer_converged(s: number): number;
  _of_streamer_resident_count(s: number): number;
  _of_streamer_ready_keys(s: number): number;
  _of_streamer_evicted_keys(s: number): number;

  _of_chunk_meta(s: number, i: number): number;
  _of_chunk_anchor(s: number, i: number): number;
  _of_chunk_neighbour_depths(s: number, i: number): number;
  _of_chunk_packed(s: number, i: number): number;
  _of_chunk_max_offset(s: number, i: number): number;

  _of_packed_stride(): number;
  _of_packed_vertex_count(): number;
  _of_chunk_index_buffer(): number;
  _of_chunk_index_ptr(): number;
  _of_chunk_interior_index_count(): number;

  // --- W5 gameplay slice (of_core_api.cpp section 9). One SliceRegistry and one
  //     Inventory per module instance, so these are singletons on the MAIN
  //     thread instance only; a worker's copy is a different pack.
  _of_gp_init(): number;
  _of_gp_slot_count(): number;
  /** Fills i32 scratch with [item, count] per slot. Returns the slot count. */
  _of_gp_inventory(): number;
  _of_gp_count(item: number): number;
  _of_gp_add(item: number, count: number): number;
  _of_gp_remove(item: number, count: number): number;
  _of_gp_clear(): number;
  _of_gp_item_count(): number;
  _of_gp_item_at(index: number): number;
  /** Writes the display name into the u8 scratch. Returns the byte length. */
  _of_gp_item_name(item: number): number;
  /** Fills i32 scratch with the 13 survival ItemIds. Returns 13. */
  _of_gp_item_ids(): number;

  _of_gp_kinds_reset(): void;
  _of_gp_kinds_push(kind: number): void;
  _of_gp_nodes_clear(): void;
  _of_gp_nodes_count(): number;
  _of_gp_nodes_layout(body: number, edits: number, dx: number, dy: number,
                      dz: number, ringRadiusRad: number): number;
  _of_gp_node_add(body: number, edits: number, kind: number,
                  dx: number, dy: number, dz: number): number;
  /** f64 scratch [x,y,z,remaining,initial,grade,kind,resource]. Returns 8. */
  _of_gp_node_state(i: number): number;
  /** i32 scratch [granted,usedTool,nodeEmpty,resource]. Returns granted. */
  _of_gp_node_harvest(i: number, baseYield: number, toolYield: number): number;

  _of_gp_recipe_count(): number;
  /** i32 scratch [out,outN,can,inN,(item,have,need)*inN]. Returns the length. */
  _of_gp_recipe_info(i: number): number;
  _of_gp_craft(i: number): number;

  _of_gp_furnace_create(tier: number): number;
  _of_gp_furnace_destroy(f: number): void;
  _of_gp_furnace_insert(f: number, item: number, count: number): number;
  _of_gp_furnace_collect(f: number, want: number): number;
  _of_gp_furnace_run(f: number, ticks: number): number;
  /** i32 scratch [oreItem,oreN,outItem,outN,fuel,progress,perSmelt,on]. 8. */
  _of_gp_furnace_state(f: number): number;
  /** Remove ore from a node WITHOUT granting it. Returns the units removed. */
  _of_gp_node_drain(i: number, units: number): number;
  /** What `ore` smelts into (gameplay.h smeltOutputFor), or 0 if not an ore. */
  _of_gp_smelt_output_for(ore: number): number;

  // --- W6 automation (of_core_api.cpp section 7, over automation.h). One
  //     BuildableNetwork per handle; buildings are per-network build indices.
  _of_net_create(fixedDt: number): number;
  _of_net_destroy(n: number): void;
  _of_net_place_miner(n: number, deposit: number, item: number,
                      ratePerSecond: number, outCap: number): number;
  _of_net_place_miner_for_node(n: number, kind: number, deposit: number,
                               ratePerSecond: number, outCap: number): number;
  _of_net_place_belt(n: number, tiles: number, speed: number): number;
  _of_net_place_smelter(n: number, ore: number, ingot: number, craftTicks: number,
                        powerW: number, outCap: number): number;
  _of_net_place_assembler(n: number, inA: number, countA: number, inB: number,
                          countB: number, out: number, outCount: number,
                          craftTicks: number, powerW: number, outCap: number): number;
  /** Wire two buildings; item 0 auto-infers. 1 on success. */
  _of_net_connect(n: number, from: number, to: number, item: number): number;
  _of_net_step_n(n: number, ticks: number): void;
  _of_net_tick_index(n: number): number;
  _of_net_produced_of(n: number, item: number): number;
  _of_net_miner_remaining(n: number, build: number): number;
  _of_net_miner_depleted(n: number, build: number): number;
  _of_net_output_buffer(n: number, build: number): number;
  _of_net_input_buffer(n: number, build: number): number;
  _of_net_belt_item_count(n: number, build: number): number;
  _of_net_working(n: number, build: number): number;
  _of_net_progress01(n: number, build: number): number;
  _of_net_feed_machine(n: number, build: number, count: number): number;
  _of_net_take_output(n: number, build: number, want: number): number;
  _of_net_set_placement(n: number, build: number, typeId: number,
                        x: number, y: number, z: number, boundCm: number): void;
  _of_net_entity_index(n: number, build: number): number;
  _of_net_build_count(n: number): number;
  /** Rows; i32 [Id,TypeId,VisualState,AnimPhase,Lod,BoundRadius], f32 [x,y,z]. */
  _of_net_emit_entity_states(n: number): number;
  /** Rows; i32 [LineId,ItemDominant,FlowSpeedQuant,Density,Compressed]. */
  _of_net_emit_belt_flows(n: number): number;
  /** Items; i32 [ItemType,UnitOffset] per item. LOD-0 only (the O(items) pull). */
  _of_net_get_line_items(n: number, build: number): number;
  _of_net_units_per_tile(): number;
}

/** Read the f64 scratch arena. Call AFTER the producing call, never before. */
export function scratchF64(M: OfCoreModule, n: number): Float64Array {
  const p = M._of_scratch_f64();
  return M.HEAPF64.subarray(p >>> 3, (p >>> 3) + n);
}

export function scratchF32(M: OfCoreModule, n: number): Float32Array {
  const p = M._of_scratch_f32();
  return M.HEAPF32.subarray(p >>> 2, (p >>> 2) + n);
}

export function scratchI32(M: OfCoreModule, n: number): Int32Array {
  const p = M._of_scratch_i32();
  return M.HEAP32.subarray(p >>> 2, (p >>> 2) + n);
}

export function scratchU8(M: OfCoreModule, n: number): Uint8Array {
  const p = M._of_scratch_u8();
  return M.HEAPU8.subarray(p, p + n);
}

/** A retained (non-scratch) uint16 span. Still invalidated by memory growth. */
export function viewU16(M: OfCoreModule, ptr: number, n: number): Uint16Array {
  return M.HEAPU16.subarray(ptr >>> 1, (ptr >>> 1) + n);
}
