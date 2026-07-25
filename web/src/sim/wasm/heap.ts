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
  _of_body_kind(body: number): number;

  _of_base_height(body: number, dx: number, dy: number, dz: number): number;
  _of_surface_height(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_surface_radius(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_solid_at(body: number, edits: number, x: number, y: number, z: number): number;
  _of_solid_cell(body: number, edits: number, cx: number, cy: number, cz: number): number;
  _of_biome_at(body: number, dx: number, dy: number, dz: number): number;
  _of_material_for_biome(biome: number): number;
  _of_latlon_to_dir(lat: number, lon: number): void;
  _of_dir_to_latlon(dx: number, dy: number, dz: number): void;

  _of_streamer_create(body: number, splitRatio: number, mergeHysteresis: number,
                      maxDepth: number, minResidentDepth: number,
                      skirtFraction: number, genBudget: number): number;
  _of_streamer_destroy(s: number): void;
  _of_observer_latlon_alt(body: number, lat: number, lon: number, altM: number): void;
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
