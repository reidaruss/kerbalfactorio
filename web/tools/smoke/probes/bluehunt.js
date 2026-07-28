// bluehunt.js - what, exactly, is blue near spawn?
//
// Reid: "idk what these blue blobs are but i assume water". Reading the code
// turned up three candidates and no way to choose between them by reading:
//   (a) NodeKind::WaterPool harvest nodes,
//   (b) the ore-patch ground skin (translucent grey-blue lobed discs, ~40 m
//       spread around spawn, GROUND_COLOUR[IronOre] = 0x53687d),
//   (c) Biome::Ocean terrain, painted 0x14406e, which is dry ground.
// So measure. This probe counts nodes by kind, dumps the ore patches with
// their kinds and ranges, and reads the presented framebuffer back to count
// how many pixels are actually blue and where they sit on screen.
//
// OF_ARGS: { yawDeg, pitchDeg, altM }
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const yield0 = () => new Promise((r) => { setTimeout(r, 0); });

  if (typeof A.altM === 'number') {
    const w0 = of.world();
    of.teleport(w0.observer.latDeg, w0.observer.lonDeg, A.altM);
  }
  of.look(A.yawDeg ?? 0, A.pitchDeg ?? -8);
  await of.settle(24);
  await of.run(1.0, 60);
  await yield0();

  const w = of.world();

  // --- harvest nodes by kind ---
  const nodes = of.nodes();
  const byKind = {};
  for (const n of nodes) {
    const k = String(n && n.kind !== undefined ? n.kind : 'unknown');
    byKind[k] = (byKind[k] || 0) + 1;
  }

  // --- ore patches, if published ---
  let patchInfo = null;
  try {
    const g = of.game();
    const ps = g && g.ore ? g.ore : (g && g.patches ? g.patches : null);
    if (ps && typeof ps.length === 'number') {
      patchInfo = { count: ps.length, sample: JSON.parse(JSON.stringify(ps.slice(0, 8))) };
    }
  } catch (_e) { patchInfo = { count: null, sample: null }; }

  // --- read the frame back and classify blue ---
  // "Blue" here is deliberately generous and stated: b greater than both r and
  // g by at least 12/255, and not near-black. Sky is excluded by only counting
  // pixels BELOW the horizon row, which is found as the first row from the top
  // whose blue fraction drops under 20%.
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    || canvas.getContext('webgl2');
  let blue = null;
  if (gl) {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // rows: index 0 is the BOTTOM row in GL order.
    const rowBlue = new Int32Array(H);
    let total = 0;
    for (let y = 0; y < H; ++y) {
      let c = 0;
      for (let x = 0; x < W; ++x) {
        const i = (y * W + x) * 4;
        const r = buf[i], g2 = buf[i + 1], b = buf[i + 2];
        if (b > r + 12 && b > g2 + 12 && b > 24) c++;
      }
      rowBlue[y] = c;
      total += c;
    }
    // Ground half of the screen only (GL rows 0..H/2 are the lower half).
    let lower = 0;
    for (let y = 0; y < (H >> 1); ++y) lower += rowBlue[y];
    // Where in the lower half is the blue concentrated?
    const bands = [];
    const BANDS = 8;
    for (let bnd = 0; bnd < BANDS; ++bnd) {
      let c = 0;
      const y0 = Math.floor((bnd * (H >> 1)) / BANDS);
      const y1 = Math.floor(((bnd + 1) * (H >> 1)) / BANDS);
      for (let y = y0; y < y1; ++y) c += rowBlue[y];
      bands.push(c);
    }
    blue = {
      w: W, h: H, pixels: W * H,
      bluePixels: total,
      bluePctAll: Math.round((10000 * total) / (W * H)) / 100,
      blueLowerHalf: lower,
      bluePctLowerHalf: Math.round((10000 * lower) / ((W * H) / 2)) / 100,
      lowerHalfBandsBottomToMid: bands,
    };
  }

  const p = w.player.feet;
  const pr = Math.hypot(p[0], p[1], p[2]);
  const here = of.surface(p[0] / pr, p[1] / pr, p[2] / pr);

  return {
    valid: w.tick > 30 && nodes !== undefined,
    tick: w.tick,
    yawDeg: A.yawDeg ?? 0,
    spawn: { lat: w.observer.latDeg, lon: w.observer.lonDeg, altM: w.observer.altM },
    surfaceHereM: here.surfaceM,
    biomeHere: w.biome,
    nodeCount: nodes.length,
    nodeKinds: byKind,
    waterPoolNodes: byKind['5'] || 0,
    patchInfo,
    blue,
  };
})()
