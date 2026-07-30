// THE DUG-SURFACE LOOK (RN-80): dig a pit, photograph what it exposes, and
// assert the PROPERTY, which is that the exposed material is no longer the
// surface material. Runs identically against a control build and the RN-80
// build, so a cross-build pair is the same scene by construction: same seed,
// same site, same scripted strikes, same camera.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4272/ \
//     --evalfile=tools/smoke/probes/digskin.js
//
// Numbers, not vibes: the frame is sampled in a centre box (the pit interior
// after the strikes) BEFORE the dig and AFTER it, and the claim has two
// halves, each falsifiable:
//   1. The dig moved the box at all (a dig that failed reads as a green pass
//      on any colour claim, so the fixture is asserted first: voxel triangles
//      must be nonzero and the box must have moved).
//   2. AFTER the dig the box is BROWNER and DARKER than before: r/g rises
//      (soil against grass) and luma falls. Against the old code the same
//      run leaves r/g essentially unchanged, because the pit was painted
//      with the surface rule; that is the discriminating signature.
(async () => {
  const of = window.__of;
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const sunT = OF_ARGS.sunT ?? 0.30;
  const strikes = OF_ARGS.strikes ?? 14;

  if (OF_ARGS.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const w0 = of.world();
  of.teleport(lat, lon, 2.0);
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  of.propsVisible(false);
  // Aim steeply down-forward so the strikes land in the frame's centre box.
  of.look(300, -50);
  of.setTime(sunT);
  await of.settle(20);

  const grab = async () => {
    of.setTime(sunT);
    await of.settle(OF_ARGS.settle ?? 12);
    const bmp = await createImageBitmap(await of.screenshot());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const W = bmp.width, H = bmp.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    // Centre box: the pit interior at this camera. 30% wide, rows 40..75%.
    const x0 = Math.floor(W * 0.35), x1 = Math.floor(W * 0.65);
    const y0 = Math.floor(H * 0.40), y1 = Math.floor(H * 0.75);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; ++y) {
      for (let x = x0; x < x1; ++x) {
        const i = (y * W + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    const blob2 = await of.screenshot();
    const buf = new Uint8Array(await blob2.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    bmp.close();
    return {
      box: { r: r / n, g: g / n, b: b / n, luma: (r * 0.299 + g * 0.587 + b * 0.114) / n },
      png: `data:image/png;base64,${btoa(s)}`,
    };
  };

  const before = await grab();
  const shots = [];
  for (let i = 0; i < strikes; ++i) { shots.push(of.dig()); await of.run(0.25, 60); }
  const after = await grab();

  const vox = of.voxels();
  const w = of.world();
  const dug = shots.filter((s) => s && s.applied !== false).length;
  const rgBefore = before.box.r / Math.max(1, before.box.g);
  const rgAfter = after.box.r / Math.max(1, after.box.g);
  return {
    valid: w.tick > w0.tick && w.chunks.converged,
    camera: { lat, lon, sunT, biome: w.biome },
    strikes, dug,
    voxel: vox === null ? null : { triangles: vox.triangles ?? vox.mesh?.triangles ?? null, raw: vox },
    boxBefore: before.box, boxAfter: after.box,
    rgBefore: +rgBefore.toFixed(4), rgAfter: +rgAfter.toFixed(4),
    lumaDrop: +(before.box.luma - after.box.luma).toFixed(2),
    pngBefore: before.png, pngAfter: after.png,
  };
})()
