// LOD seam census. For every resident chunk, classify each of its four edges by
// what is resident on the other side: same depth, coarser (a T-junction, which
// edge stitching must snap), finer, or nothing. Reports the depth histogram and
// the stitch metrics, so "are there even any LOD boundaries in this view" is a
// measurement rather than a guess.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/seams.js
//
(() => {
  const of = window.__of;
  const c = of.chunks(4000);
  const keys = new Set(c.map((x) => x.key));
  const visible = new Set(c.filter((x) => x.visible).map((x) => x.key));
  const depths = {};
  let same = 0, coarser = 0, finer = 0, none = 0;
  const examples = [];
  const D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const x of c) {
    depths[x.depth] = (depths[x.depth] || 0) + 1;
    const p = x.key.split(':').map(Number);
    const f = p[0], d = p[1], qx = p[2], qy = p[3];
    const span = 2 ** d;
    for (const dd of D) {
      const nx = qx + dd[0], ny = qy + dd[1];
      if (nx < 0 || ny < 0 || nx >= span || ny >= span) continue;
      if (visible.has(f + ':' + d + ':' + nx + ':' + ny)) { same++; continue; }
      let hit = 0;
      for (let k = 1; k <= 3 && d - k >= 0; k++) {
        if (visible.has(f + ':' + (d - k) + ':' + (nx >> k) + ':' + (ny >> k))) { hit = k; break; }
      }
      if (hit > 0) {
        coarser++;
        if (examples.length < 8) {
          examples.push({ me: x.key, coarserBy: hit, nb: f + ':' + (d - hit) + ':' + (nx >> hit) + ':' + (ny >> hit) });
        }
        continue;
      }
      let fine = false;
      for (let k = 1; k <= 2; k++) {
        if (visible.has(f + ':' + (d + k) + ':' + (nx << k) + ':' + (ny << k))) { fine = true; break; }
      }
      if (fine) finer++; else none++;
    }
  }
  return {
    residentDumped: c.length,
    residentTotal: of.world().chunks.resident,
    hidden: of.world().chunks.hidden,
    keysNotVisible: keys.size - visible.size,
    depths,
    edges: { same, coarser, finer, none },
    examples,
    stitch: of.stats().stitch,
  };
})()
