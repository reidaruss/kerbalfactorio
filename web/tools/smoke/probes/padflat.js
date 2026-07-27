// WG-24 acceptance: after levelling, HOW FLAT IS THE GROUND, measured on each of
// the three surfaces separately, because they are three different instruments and
// conflating them is how WG-22 reported a 2.3x win on a tool the user said did
// nothing.
//
//   1. THE FIELD, through the oracle (`of.surface`). This is what collision, the
//      aim ray and the build system read. It is the claim.
//   2. THE NEAR VOXEL MESH, read straight off the THREE.Mesh named `voxelNear`.
//      This is the surface-nets extraction of that same field: the geometry that
//      actually draws the pad, at 1 m.
//   3. THE STREAMED CHUNK, via `__of.meshVerts`. This is the far-field
//      heightfield at the shipped 1.8 m LOD (DW-19), which cannot resolve a 6 m
//      pad no matter how flat the field under it is. WG-23 measured this one and
//      got 0.973 m; it is reported here so the comparison is like for like, and
//      so the LOD limit is visible as a separate number rather than blamed on the
//      tool.
//
// Every number is the WORST STEP BETWEEN TWO POINTS 4 m APART, because 4 m is the
// DW-32 structural module and therefore the span a foundation bridges, and
// because a surface is judged by its worst neighbouring pair rather than by the
// middle of a distribution (WG-23).
const of = window.__of;
const log = [];
const R = (x, n = 4) => Number(x.toFixed(n));

// --- setup, proven before anything is measured (DW-20) ----------------------
const t0 = of.stats().ticks;
of.teleport(2.0, 144.0, 3);
await of.settle(4.0);
const ticks0 = of.stats().ticks - t0;

// Find a slope. A levelling tool cannot be proven on flat ground: the spawn
// clearing is inside the lattice's own old resolution (ARCHITECTURE 15.2 item
// 99), and WG-26 has now deliberately flattened 150 m around spawn, which makes
// that doubly true.
let best = null;
const step = 0.0009;
for (let i = -12; i <= 12; ++i) {
  for (let j = -12; j <= 12; ++j) {
    const lat = 2.0 + i * step, lon = 144.0 + j * step;
    const h = [];
    for (let k = 0; k < 5; ++k) {
      const a = (k / 5) * Math.PI * 2;
      h.push(of.surfaceAtLatLon(lat + Math.cos(a) * 0.00006,
                                lon + Math.sin(a) * 0.00006));
    }
    const spread = Math.max(...h) - Math.min(...h);
    if (spread > 1.5 && spread < 9.0 && (best === null || spread > best.spread))
      best = { lat, lon, spread };
  }
}
if (best === null) return { ok: false, why: 'no sloped site found', ticks0 };
log.push(`site: lat ${R(best.lat, 6)} lon ${R(best.lon, 6)}, probe spread ${R(best.spread, 3)} m`);

of.teleport(best.lat, best.lon, 3);
await of.settle(4.0);

// --- the three measurements, as one function so they cannot drift apart -----
const worstStep4m = (heightAt) => {
  // An 11 x 11 grid at 2 m, comparing points exactly 4 m apart, inside a radius
  // that stays clear of the disc rim: the rim is a wall by design and measuring
  // it would be measuring the tool's edge rather than its floor.
  const N = 11, SP = 2.0, KEEP = 4.5;
  const g = [];
  for (let j = 0; j < N; ++j)
    for (let i = 0; i < N; ++i) {
      const x = (i - (N - 1) / 2) * SP, y = (j - (N - 1) / 2) * SP;
      g.push({ x, y, h: heightAt(x, y) });
    }
  let worst = 0, pairs = 0;
  const at = (i, j) => g[j * N + i];
  for (let j = 0; j < N; ++j)
    for (let i = 0; i < N; ++i) {
      const a = at(i, j);
      if (a.h === null || Math.hypot(a.x, a.y) > KEEP) continue;
      for (const b of [i + 2 < N ? at(i + 2, j) : null, j + 2 < N ? at(i, j + 2) : null]) {
        if (!b || b.h === null || Math.hypot(b.x, b.y) > KEEP) continue;
        worst = Math.max(worst, Math.abs(a.h - b.h));
        ++pairs;
      }
    }
  return { worst, pairs };
};

const site = of.tangentFrameAt(best.lat, best.lon);
const oracleH = (x, y) => of.surfaceAtOffset(best.lat, best.lon, x, y);

const before = {
  oracle: worstStep4m(oracleH),
  chunk: worstStep4m((x, y) => of.drawnHeightAtOffset(best.lat, best.lon, x, y, 1.2)),
};

// --- level it, through the real key, at a pitch a player looks from ---------
of.look(0, -20);
const pressed = await of.pressLevel(1.2);
await of.settle(3.0);

const after = {
  oracle: worstStep4m(oracleH),
  chunk: worstStep4m((x, y) => of.drawnHeightAtOffset(best.lat, best.lon, x, y, 1.2)),
  voxel: worstStep4m((x, y) => of.voxelHeightAtOffset(best.lat, best.lon, x, y, 1.2)),
};

log.push(`FIELD  (oracle):      ${R(before.oracle.worst)} m -> ${R(after.oracle.worst)} m`);
log.push(`DRAWN  (voxel mesh):  n/a before -> ${R(after.voxel.worst)} m over ${after.voxel.pairs} pairs`);
log.push(`DRAWN  (chunk, 1.8 m LOD): ${R(before.chunk.worst)} m -> ${R(after.chunk.worst)} m`);

return {
  ok: true,
  ticks0,
  pressed,
  site: best,
  threshold: 0.25,
  before, after,
  meetsThresholdOnField: after.oracle.worst <= 0.25,
  meetsThresholdOnVoxelMesh: after.voxel.worst <= 0.25,
  voxelStats: of.voxelStats ? of.voxelStats() : null,
  log,
};
