// The chunk wire format, shared by terrain.worker and the main thread.
//
// /core hands us ONE pre-interleaved 28 B/vertex buffer (WASM-BRIDGE.md 4.8).
// three.js cannot bind that directly: InterleavedBufferAttribute takes its GL
// type from the InterleavedBuffer's array, so a single buffer cannot carry
// float32 positions AND int8 normals AND uint16 uvs. See the note in
// ARCHITECTURE.md section 4.2 (updated). The worker therefore de-interleaves
// into ONE contiguous ArrayBuffer with five fixed sections, which is still one
// transferable per chunk, still constant size, and still zero-copy on the wire.
//
// Positions stay float32 RELATIVE to the chunk's 64-bit anchor (standing rule 6).
// They are never absolute planet-scale floats.

export interface ChunkBlobLayout {
  readonly verts: number;
  readonly positionOffset: number;   // float32 x3
  readonly heightOffset: number;     // float32 x1
  readonly uvOffset: number;         // uint16  x2, normalized
  readonly biomeOffset: number;      // uint8   x4  [biomeId, materialId, hardness, flags]
  readonly normalOffset: number;     // int8    x3, normalized
  readonly byteLength: number;
}

/** The source layout, from of_packed_*(). */
export const PACKED_STRIDE = 28;
export const PACKED_OFF_POSITION = 0;
export const PACKED_OFF_NORMAL = 12;
export const PACKED_OFF_UV = 16;
export const PACKED_OFF_BIOME = 20;
export const PACKED_OFF_HEIGHT = 24;

/** Section offsets are 4-byte aligned by construction; int8 goes last. */
export function chunkBlobLayout(verts: number): ChunkBlobLayout {
  const positionOffset = 0;
  const heightOffset = positionOffset + verts * 12;
  const uvOffset = heightOffset + verts * 4;
  const biomeOffset = uvOffset + verts * 4;
  const normalOffset = biomeOffset + verts * 4;
  return {
    verts, positionOffset, heightOffset, uvOffset, biomeOffset, normalOffset,
    byteLength: normalOffset + verts * 3,
  };
}

export interface ChunkBlobViews {
  position: Float32Array;
  height: Float32Array;
  uv: Uint16Array;
  biome: Uint8Array;
  normal: Int8Array;
}

export function chunkBlobViews(buf: ArrayBuffer, L: ChunkBlobLayout): ChunkBlobViews {
  return {
    position: new Float32Array(buf, L.positionOffset, L.verts * 3),
    height: new Float32Array(buf, L.heightOffset, L.verts),
    uv: new Uint16Array(buf, L.uvOffset, L.verts * 2),
    biome: new Uint8Array(buf, L.biomeOffset, L.verts * 4),
    normal: new Int8Array(buf, L.normalOffset, L.verts * 3),
  };
}

/**
 * Read /core's interleaved buffer into the five sections. `packed` must be a
 * COPY out of the WASM heap: a scratch view is only valid until the next call
 * into WASM (standing rule 5).
 */
/**
 * Read /core's interleaved buffer into the five sections and return the exact
 * bounding radius. of_chunk_max_offset EXCLUDES the skirt ring (measured: it
 * reports 52,639 m for a depth-3 chunk whose furthest skirt vertex is at
 * 108,403 m), so using it for the bounding sphere frustum-culls chunks that are
 * genuinely on screen. The true maximum is free here: the loop already touches
 * every vertex.
 */
export function deinterleave(packed: ArrayBuffer, out: ChunkBlobViews, verts: number): number {
  const f32 = new Float32Array(packed);
  const i8 = new Int8Array(packed);
  const u16 = new Uint16Array(packed);
  const u8 = new Uint8Array(packed);
  const F = PACKED_STRIDE / 4;   // 7 floats per vertex
  const S = PACKED_STRIDE / 2;   // 14 uint16 per vertex
  let maxR2 = 0;
  for (let v = 0; v < verts; ++v) {
    const f = v * F, b = v * PACKED_STRIDE, s = v * S;
    const p3 = v * 3;
    const px = f32[f], py = f32[f + 1], pz = f32[f + 2];
    const r2 = px * px + py * py + pz * pz;
    if (r2 > maxR2) maxR2 = r2;
    out.position[p3] = px;
    out.position[p3 + 1] = py;
    out.position[p3 + 2] = pz;
    out.height[v] = f32[f + 6];
    out.normal[p3] = i8[b + PACKED_OFF_NORMAL];
    out.normal[p3 + 1] = i8[b + PACKED_OFF_NORMAL + 1];
    out.normal[p3 + 2] = i8[b + PACKED_OFF_NORMAL + 2];
    const u2 = v * 2;
    out.uv[u2] = u16[s + PACKED_OFF_UV / 2];
    out.uv[u2 + 1] = u16[s + PACKED_OFF_UV / 2 + 1];
    const q4 = v * 4;
    out.biome[q4] = u8[b + PACKED_OFF_BIOME];
    out.biome[q4 + 1] = u8[b + PACKED_OFF_BIOME + 1];
    out.biome[q4 + 2] = u8[b + PACKED_OFF_BIOME + 2];
    out.biome[q4 + 3] = u8[b + PACKED_OFF_BIOME + 3];
  }
  return Math.sqrt(maxR2);
}

export function chunkKey(faceId: number, depth: number, qx: number, qy: number): string {
  return `${faceId}:${depth}:${qx}:${qy}`;
}
