// RN-1575. THE PRESENTED SKY WITH THE SUN IN IT, which this repo could not
// photograph until now.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1600 --height=900 --evalfile=tools/smoke/probes/sunshot.js \
//     --evalargs='{"sunDot":0.45}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
// WHY IT EXISTS. RN-1572 narrows the sun disc from 3.15 degrees to the real
// 0.53 and raises its radiance 35x to conserve irradiance. Every instrument
// this project owns measures that change in the ENVIRONMENT CUBE
// (`probes/ibldiag.js`) or on a subject lit BY it (`probes/artframe.js`), and
// none of them looks at the sky itself. But the disc is drawn into the
// presented frame too, so the change is a LOOK change, and a look change that
// nobody photographed is a look change nobody agreed to. RN-1525 said this in
// as many words: "That change is also visible in the presented sky, which is a
// different lane's judgement."
//
// THE AIM IS SOLVED AGAINST THE RENDERER'S OWN SUN VECTOR, NOT SEARCHED FOR
// BRIGHTNESS. `machinemat.js`'s rule and `artframe.js` repeats it: a camera
// chosen by how bright the result came out is a classifier that depends on the
// quantity under test. So the target is a point 1 km along
// `__ofShade.sun().sunWorld` -- which is `SkyPass.sunDirection`, the vector the
// sky, the scattering integral and the cascade rig are all driven by -- and the
// yaw/pitch pair is refined by MISS ANGLE to that point, coarse to fine.
//
// NOT `__ofPost.state().sun`, deliberately. RN-1492 measured that vector
// failing as a camera-placement instrument (neither it nor its negation puts
// the eye on the lit side) and that finding is unexplained rather than fixed,
// so a second probe must not quietly depend on it.
//
// THE READOUT is a `sunbox`: a small rectangle centred on where the disc was
// aimed, plus the whole frame and a sky band well away from it. A narrower and
// brighter disc must raise the sunbox's `p95` and `hiFrac` hard while leaving
// the off-sun sky band alone -- that second half is the irradiance-conserving
// claim as the PRESENTED frame sees it, and it is the one that could fail
// independently of the cube measurement.
(async (A) => {
  const of = window.__of;
  const sleep = (s) => of.run(s, 60);
  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  if (of === undefined) return { valid: false, why: 'no __of' };
  const SH = window.__ofShade;
  if (SH === undefined) return { valid: false, why: 'no __ofShade: this probe needs the sun vector' };

  const post = window.__ofPost ? window.__ofPost.state() : null;
  if (post === null) return { valid: false, why: 'no __ofPost: the post stack never built' };
  if (post.post !== true && A.allowPostOff !== true) {
    return { valid: false, why: 'THE POST STACK IS OFF and this frame would be ungraded', postState: post };
  }

  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);
  of.build(0);
  await sleep(0.5);

  // Somewhere with a clean horizon, so the disc is not behind a hill. The
  // forest site is §2.1's own, which keeps this frame comparable with the
  // lookdev columns taken at the same place.
  const lat = A.lat ?? -19.85;
  const lon = A.lon ?? -72.7853;
  // ALTITUDE IS AN ARGUMENT AND IT HAS TO BE. At a low sun the disc is often
  // behind relief from a standing eye: measured at this site, `sunDot` 0.20
  // puts the sunbox at luma 1.4 with the aim missing by 0.033 degrees, i.e.
  // aimed correctly at a hill. A dusk frame whose subject is occluded is not a
  // dusk frame, and raising the eye is the honest fix rather than hunting for a
  // longitude where it happens to clear.
  if (A.teleport !== false) {
    of.teleport(lat, lon, A.alt ?? 2.0);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
  }
  const pin = () => of.setSunElev(A.sunDot ?? 0.45);
  let solve = pin();
  await of.settle(A.settle ?? 20);
  solve = pin();
  await sleep(0.2);

  // ------------------------------------------------------------- aim at it
  const sun = SH.sun();
  const a0 = of.aim();
  const target = [
    a0.origin[0] + sun.sunWorld[0] * 1000,
    a0.origin[1] + sun.sunWorld[1] * 1000,
    a0.origin[2] + sun.sunWorld[2] * 1000,
  ];
  const missTo = (y, p) => {
    of.look(y, p);
    const a = of.aim();
    const d = a.dir;
    const dot = d[0] * sun.sunWorld[0] + d[1] * sun.sunWorld[1] + d[2] * sun.sunWorld[2];
    return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
  };
  let by = of.world().observer.yawDeg;
  let bp = 0;
  let bm = Infinity;
  for (const step of [30, 8, 2, 0.5, 0.125]) {
    let ny = by; let np = bp;
    for (let k = -12; k <= 12; ++k) {
      for (let m = -12; m <= 12; ++m) {
        const y = by + k * step;
        const p = Math.max(-89, Math.min(89, bp + m * step));
        const miss = missTo(y, p);
        if (miss < bm) { bm = miss; ny = y; np = p; }
      }
    }
    by = ny; bp = np;
  }
  of.look(by, bp);
  await sleep(0.3);

  // ------------------------------------------------------------ the capture
  const blob = await of.screenshot();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const W = bmp.width;
  const H = bmp.height;

  const stat = (x0, y0, x1, y1) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const n = w * h;
    let sr = 0; let sg = 0; let sb = 0; let hi = 0; let white = 0;
    const lum = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
      const r = d[i * 4]; const g = d[i * 4 + 1]; const b = d[i * 4 + 2];
      sr += r; sg += g; sb += b;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = y;
      if (y > 255 * 0.80) hi++;
      if (y > 250) white++;
    }
    lum.sort();
    const q = (f) => lum[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
    const mr = sr / n; const mg = sg / n; const mb = sb / n;
    return { px: n, luma: r2(0.2126 * mr + 0.7152 * mg + 0.0722 * mb),
      rgb: [r2(mr), r2(mg), r2(mb)], warm: r2(mr - mb),
      p50: r2(q(0.5)), p95: r2(q(0.95)), p99: r2(q(0.99)), max: r2(q(1)),
      hiFrac: r3(hi / n), whiteFrac: r3(white / n) };
  };

  // The disc is aimed at frame centre, so the sunbox is centred. It is sized in
  // DEGREES rather than pixels so the same rectangle means the same solid angle
  // if the FOV or the resolution ever moves: 4 degrees across, which holds the
  // old 3.15-degree disc whole and gives the 0.53-degree one plenty of margin.
  const fovDeg = A.fovDeg ?? 60;
  const pxPerDeg = H / fovDeg;
  const halfPx = (A.sunBoxDeg ?? 4) * 0.5 * pxPerDeg;
  const cxp = W / 2; const cyp = H / 2;
  const sunbox = stat(cxp - halfPx, cyp - halfPx, cxp + halfPx, cyp + halfPx);
  // A patch of sky 20 degrees away from the disc, on the same row: the control
  // that says the change was irradiance-conserving in the PRESENTED frame and
  // did not simply brighten everything.
  const offPx = (A.offSunDeg ?? 20) * pxPerDeg;
  const offsun = stat(cxp + offPx - halfPx, cyp - halfPx, cxp + offPx + halfPx, cyp + halfPx);

  const png = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  const s = of.stats();
  return {
    valid: true,
    frame: { w: W, h: H },
    aim: { yawDeg: r2(by), pitchDeg: r2(bp), missDeg: r3(bm),
      sunBoxDeg: A.sunBoxDeg ?? 4, offSunDeg: A.offSunDeg ?? 20 },
    sun: { ...SH.sun(), wantDot: A.sunDot ?? 0.45,
      elevDot: r3(s.sky.elevationDot), sunT: r3(s.sky.sunT), solve },
    sunbox, offsun, world: stat(0, 0, W, H),
    postState: post, shadow: s.shadow, ibl: s.ibl,
    png,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
