// of::TerrainStreamer, in its own WASM instance, in its own thread.
//
// Every ready chunk is packed by of_chunk_packed (one interleaved 34,076 B span
// written straight into the WASM heap), de-interleaved into the five sections
// ChunkFormat defines, and handed to the main thread as ONE transferable.
// Nothing is traversed element by element across the boundary, which is the
// whole point of the R1 gate (DW-13).
//
// Standing rule 5 is observed literally here: every scratch view is re-read
// after its producing call and copied before the next one.

import { loadOfCore } from '../sim/wasm/OfCore.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchI32, scratchF64, scratchU8, viewU16 } from '../sim/wasm/heap.js';
import {
  chunkBlobLayout, chunkBlobViews, chunkKey, deinterleave,
  type ChunkBlobLayout,
} from '../world/ChunkFormat.js';
import type {
  TerrainChunkMsg, TerrainDigMsg, TerrainInitMsg, TerrainInitedMsg,
  TerrainEditsMsg, TerrainLevelMsg, TerrainObserveMsg, TerrainUpdateMsg,
  ToTerrain,
} from './TerrainProtocol.js';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ToTerrain>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let M: OfCoreModule | null = null;
let body = 0;
let streamer = 0;
/** THIS worker's own VoxelEdits (DW-16: heaps are never shared). Lazily made. */
let workerEdits = 0;
let layout: ChunkBlobLayout | null = null;
let verts = 0;

async function init(msg: TerrainInitMsg): Promise<void> {
  const t0 = performance.now();
  M = await loadOfCore();
  const loadMs = performance.now() - t0;
  body = M._of_body_create_forge(msg.seedLo >>> 0, msg.seedHi >>> 0);
  streamer = M._of_streamer_create(
    body, msg.splitRatio, msg.mergeHysteresis, msg.maxDepth,
    msg.minResidentDepth, msg.skirtFraction, msg.genBudget,
  );
  if (streamer <= 0) throw new Error('of_streamer_create failed');

  verts = M._of_packed_vertex_count();
  layout = chunkBlobLayout(verts);

  // The ONE index buffer: 33x33 grid + skirt ring, identical for every chunk.
  const indexCount = M._of_chunk_index_buffer();
  const index = viewU16(M, M._of_chunk_index_ptr(), indexCount).slice();
  const reply: TerrainInitedMsg = {
    type: 'inited',
    verts,
    stride: M._of_packed_stride(),
    indexCount,
    interiorIndexCount: M._of_chunk_interior_index_count(),
    index: index.buffer,
    radiusM: M._of_body_radius(body),
    maxReliefM: M._of_body_max_relief(body),
    loadMs,
  };
  ctx.postMessage(reply, [reply.index]);
}

/**
 * W5. Replay one dig into THIS worker's own VoxelEdits and post back the chunks
 * /core re-meshed. The lowering is bound once, at first dig, through
 * of_streamer_set_edits, so every chunk built from here on reads
 * derivedLoweringAt: the mouth opens where a column was emptied from the top,
 * and a tunnel under intact ground correctly opens nothing.
 */
function dig(msg: TerrainDigMsg): void {
  const mod = M;
  if (mod === null) return;
  if (workerEdits === 0) {
    workerEdits = mod._of_edits_create();
    mod._of_streamer_set_edits(streamer, workerEdits);
  }
  const t0 = performance.now();
  const n = mod._of_streamer_dig(streamer, msg.x, msg.y, msg.z, msg.radiusM);
  if (n < 0) return;
  const t1 = performance.now();
  drain(msg.seq, n, t0, t1, 'digged', [],
    n, true, mod._of_streamer_resident_count(streamer));
}

/**
 * WG-22. Replay one LEVEL into THIS worker's own VoxelEdits and post back the
 * chunks /core re-meshed. Same shape as dig() and same binding: the lowering fn
 * is bound once, at the first edit, and since WG-22 it carries the SIGNED
 * surface offset, so a filled pad raises the streamed mesh by the same call that
 * a dug pit lowers it. Nothing here knows what levelling means; `levelArea` does.
 */
function level(msg: TerrainLevelMsg): void {
  const mod = M;
  if (mod === null) return;
  if (workerEdits === 0) {
    workerEdits = mod._of_edits_create();
    mod._of_streamer_set_edits(streamer, workerEdits);
  }
  const t0 = performance.now();
  const n = mod._of_streamer_level(streamer, msg.x, msg.y, msg.z, msg.radiusM,
    msg.targetHeightM, msg.maxCutM, msg.maxFillM);
  if (n < 0) return;
  const t1 = performance.now();
  drain(msg.seq, n, t0, t1, 'digged', [],
    n, true, mod._of_streamer_resident_count(streamer));
}

/**
 * Replace this worker's edit set wholesale and re-mesh near the observer.
 * See TerrainEditsMsg: the restore path reconciles against the authority.
 */
function loadEdits(msg: TerrainEditsMsg): void {
  const mod = M;
  if (mod === null) return;
  if (workerEdits === 0) {
    workerEdits = mod._of_edits_create();
    mod._of_streamer_set_edits(streamer, workerEdits);
  }
  const src = new Uint8Array(msg.bytes);
  const t0 = performance.now();
  mod._of_edits_alloc_bytes(src.length);
  // Standing rule 5: the view is taken AFTER the alloc that sized it and used
  // before anything else re-enters WASM.
  scratchU8(mod, src.length).set(src);
  const n = mod._of_streamer_load_edits(streamer, msg.x, msg.y, msg.z, msg.radiusM);
  if (n < 0) return;
  const t1 = performance.now();
  drain(msg.seq, n, t0, t1, 'digged', [],
    n, true, mod._of_streamer_resident_count(streamer));
}

function observe(msg: TerrainObserveMsg): void {
  const mod = M;
  const L = layout;
  if (mod === null || L === null) return;

  const t0 = performance.now();
  const readyCount = mod._of_streamer_update(streamer, msg.x, msg.y, msg.z);
  // Evicted keys come from the key array; READY keys deliberately do not (see
  // the note below). The key calls fill the SAME i32 arena, so the result is
  // copied out before the next call into WASM.
  const evictedN = mod._of_streamer_evicted_keys(streamer);
  const evictedKeys = scratchI32(mod, evictedN * 4).slice();
  const generated = mod._of_streamer_generated(streamer);
  const converged = mod._of_streamer_converged(streamer) !== 0;
  const resident = mod._of_streamer_resident_count(streamer);
  const t1 = performance.now();

  const evicted: string[] = [];
  for (let i = 0; i < evictedN; ++i) {
    evicted.push(chunkKey(evictedKeys[i * 4], evictedKeys[i * 4 + 1],
      evictedKeys[i * 4 + 2], evictedKeys[i * 4 + 3]));
  }
  drain(msg.seq, readyCount, t0, t1, 'update', evicted, generated, converged, resident);
}

/**
 * Copy `readyCount` freshly built chunks out of the WASM arenas and post them.
 * Shared by `observe` and `dig` so a re-meshed chunk travels the SAME path as a
 * newly streamed one: same accessors, same de-interleave, same slot reuse.
 * Standing rule 5 lives in this loop: every scratch view is re-read per call.
 */
function drain(
  seq: number, readyCount: number, t0: number, t1: number,
  type: 'update' | 'digged', evicted: string[], generated: number,
  converged: boolean, resident: number,
): void {
  const mod = M;
  const L = layout;
  if (mod === null || L === null) return;
  const chunks: TerrainChunkMsg[] = [];
  const transfer: Transferable[] = [];
  let bytes = 0;
  for (let i = 0; i < readyCount; ++i) {
    // meta -> i32, anchor -> f64, packed -> u8. Independent arenas, but meta for
    // chunk i+1 clobbers i32, so everything is consumed before moving on.
    mod._of_chunk_meta(streamer, i);
    const meta = scratchI32(mod, 11).slice();
    mod._of_chunk_anchor(streamer, i);
    const anchor = scratchF64(mod, 5).slice();
    const nBytes = mod._of_chunk_packed(streamer, i);
    // .slice() copies out of the heap AND yields a 4-byte-aligned buffer.
    const packed = scratchU8(mod, nBytes).slice().buffer;

    const blob = new ArrayBuffer(L.byteLength);
    const maxOffsetM = deinterleave(packed, chunkBlobViews(blob, L), verts);

    // The key MUST come from of_chunk_meta, not of_streamer_ready_keys: meta is
    // the same indexed per-chunk accessor family as the anchor and the packed
    // buffer, so key, anchor and vertices are guaranteed to describe the same
    // quad. Taking the key from the separate ready-keys array assumes the two
    // orderings match; when they do not, a slot is reused under a wrong key and
    // a slab of terrain from elsewhere renders at a stale anchor.
    const key = chunkKey(meta[0], meta[1], meta[2], meta[3]);
    chunks.push({
      key,
      faceId: meta[0], depth: meta[1], qx: meta[2], qy: meta[3],
      materialId: meta[5], biome: meta[6],
      cx: anchor[0], cy: anchor[1], cz: anchor[2],
      chunkRadiusM: anchor[3],
      maxOffsetM,
      blob,
    });
    transfer.push(blob);
    bytes += L.byteLength;
  }
  const t2 = performance.now();

  const out: TerrainUpdateMsg = {
    type,
    seq,
    chunks, evicted, resident, generated, converged,
    updateMs: t1 - t0,
    packMs: t2 - t1,
    bytes,
  };
  ctx.postMessage(out, transfer);
}

ctx.onmessage = (e: MessageEvent<ToTerrain>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') { void init(msg).catch(fail); return; }
    if (msg.type === 'observe') observe(msg);
    if (msg.type === 'dig') dig(msg);
    if (msg.type === 'level') level(msg);
    if (msg.type === 'edits') loadEdits(msg);
  } catch (err) {
    fail(err);
  }
};

function fail(err: unknown): void {
  ctx.postMessage({
    type: 'error',
    message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
  });
}
