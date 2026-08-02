// RN-511 to RN-513. THE "DUSK IS A NEAR-UNIFORM PALE CYAN WASH" ATTRIBUTION.
// It is not dusk, it is not the atmosphere, and it is not a shader term: it is
// a BUILD GHOST covering the viewport, and this probe is the elimination that
// says so in one page.
//
//   node tools/smoke/run.mjs --sandbox=1 --combat=1 --scenario=walk \
//     --sundot=0.30 --width=1600 --height=900 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/duskghost.js
//
// THIS IS RN-146'S SHAPE, ARRIVING A SECOND TIME. RN-146's washed-out pale disc
// was never a shader term either: it was `LevelRing`, a tool decal that ignored
// sun and atmosphere, and it was attributed by toggling every terrain, texture,
// post, atmosphere and shadow term in turn and finding that exactly one flag
// removed it. The same reasoning applies here and reaches the same KIND of
// answer, which is the part worth writing down: **when a whole frame changes
// colour, suspect something DRAWN before suspecting how things are LIT**, because
// a lighting term has to act through albedo and normal and therefore leaves the
// frame's structure intact, while an object in front of the camera does not.
//
// WHAT THE ELIMINATION FOUND, BEFORE THIS PROBE EXISTED. One binary (b45bdd1),
// one site (lat 2.0363, lon 144.0562, Mountains, 4,779 m relief), one heading
// (yaw 150, pitch -6), one sun (`--sundot=0.30`):
//
//   plain teleport and look          world mean 115.2  warm -38.2  sky RGB  42/ 80/133
//   probes/spiderskin.js's own run   world mean 196.8  warm -46.2  sky RGB 161/197/197
//
// and the wash SURVIVES `?post=0`, `?levelring=0`, `?props=0`, `?water=0` and
// `?underwater=0`. Surviving `?post=0` alone eliminates the exposure, the
// contrast, the saturation and the whole grade, because that flag restores the
// pre-stack path exactly. What is left is something in the scene.
//
// THE CLAIM AND ITS NEGATIVE CONTROL. Selecting a hotbar slot through the
// player's own number-key path (`of.build(n)`) and changing NOTHING else moves
// the entire frame's mean RGB, by an amount and a HUE that depend on the slot;
// and returning to the first slot restores the first row's numbers. A restore
// that lands back on its own starting value is what separates "the ghost is the
// cause" from "the frame drifted while I was measuring".
//
// AND IT IS MEASURED AT NOON AS WELL AS AT DUSK, which is the assertion that
// kills the original diagnosis outright: an effect that is the same size with
// the sun 69 degrees up is not a property of low sun.
//
// THE INSTRUMENT IS RGB. `of.framehash` publishes per-tile MEAN LUMINANCE only,
// and INSTRUMENTS.md's pale-disc entry is exactly why that is not enough: this
// defect moves HUE hard and luma sometimes barely at all. Measured here, against
// a two-capture floor of 0.03 counts of mean and 0.006 of warm: one hotbar
// selection moves the world band's mean by 55.8 counts and its `warm` axis by
// 208.8, and the restore lands back on its start to 0.000 and 0.001. A luma-only
// reading would have called that a quarter of the effect.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const out = { checks: [], fails: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail });
    if (!ok) out.fails.push(`${name}: ${JSON.stringify(detail)}`);
  };

  const site = A.site ?? {
    name: 'rn459mtn', lat: 2.0362668, lon: 144.056187, alt: 2.0, yaw: 150, pitch: -6,
  };

  // ---------------------------------------------------------------- fixture
  const p0 = of.post();
  check('the post stack is ON, so this is the shipping path', p0.flags.post === true,
    { post: p0.flags.post, search: location.search });
  check('this is a build-capable world, or every slot below selects nothing',
    of.game() !== null, { game: of.game() === null ? 'null' : 'present' });

  // ------------------------------------------------------------------ scene
  of.teleport(site.lat, site.lon, site.alt);
  of.look(site.yaw, site.pitch);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 200) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  of.look(site.yaw, site.pitch);
  // 11,465 foliage instances move in every frame otherwise, which is more moving
  // pixels than the term under test.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);
  await of.settle(A.settle ?? 10);

  const decode = async () => {
    const blob = await of.screenshot();
    const img = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { d: cx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
  };
  const rowStat = (f, y0, y1) => {
    let n = 0; let r = 0; let g = 0; let b = 0; let sat = 0; let satN = 0;
    for (let y = Math.max(0, y0); y < Math.min(f.h, y1); ++y) {
      for (let x = 0; x < f.w; ++x) {
        const i = (y * f.w + x) * 4;
        const R = f.d[i]; const G = f.d[i + 1]; const B = f.d[i + 2];
        n++; r += R; g += G; b += B;
        const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
        if (mx >= 16) { sat += (mx - mn) / mx; satN++; }
      }
    }
    return {
      rows: [y0, y1],
      mean: +(0.299 * r / n + 0.587 * g / n + 0.114 * b / n).toFixed(2),
      meanR: +(r / n).toFixed(2), meanG: +(g / n).toFixed(2), meanB: +(b / n).toFixed(2),
      warm: +((r - b) / n).toFixed(3),
      sat: +(satN > 0 ? sat / satN : 0).toFixed(4),
    };
  };
  // Fixed row bands and not horizon-relative: the ghost MOVES the horizon rule's
  // own answer (it is bright and blue over the ground), so a horizon-relative
  // band would be a ruler made of the thing under test.
  const bands = (f) => ({
    sky: rowStat(f, 0, Math.round(f.h * 0.30)),
    ground: rowStat(f, Math.round(f.h * 0.55), Math.round(f.h * 0.75)),
    world: rowStat(f, 0, Math.round(f.h * 0.75)),
  });
  const asPng = async () => {
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; const C = 0x8000;
    for (let i = 0; i < buf.length; i += C) s += String.fromCharCode.apply(null, buf.subarray(i, i + C));
    return `data:image/png;base64,${btoa(s)}`;
  };

  // The sun rungs. `null` is this site's own noon, found by scanning the day
  // rather than assumed, and `of.stats().sky.elevationDot` is used throughout
  // because `__ofPost.state().sun` FREEZES below the horizon.
  const scan = [];
  let prevE = -2;
  for (let i = 0; i < 240; ++i) {
    const t = i / 240;
    of.setTime(t);
    const e = of.stats().sky.elevationDot;
    scan.push({ t, e, rising: e > prevE });
    prevE = e;
  }
  let noon = scan[0];
  for (const s of scan) if (s.e > noon.e) noon = s;
  const rungFor = (d) => {
    if (d === null) return { want: 'noon', t: noon.t };
    let best = scan[0]; let err = 9;
    for (const s of scan) {
      if (!s.rising) continue;
      const e = Math.abs(s.e - d);
      if (e < err) { err = e; best = s; }
    }
    return { want: d, t: best.t, err: +err.toFixed(4) };
  };

  const SLOTS = A.slots ?? [1, 5, 3, 6, 1];
  const rows = [];
  // One PNG per named slot, taken at the FIRST rung only, so the pair is one
  // selection apart on one build under one light and nothing else differs.
  const pngs = {};
  for (const want of (A.dots ?? [0.30, null])) {
    const rung = rungFor(want);
    of.setTime(rung.t);
    await of.run(0.5);
    of.setTime(rung.t);                 // RN-13: of.run ate sim time and moved the sun.
    of.look(site.yaw, site.pitch);
    await of.settle(A.settle ?? 10);
    const elevDot = of.stats().sky.elevationDot;
    const elevDeg = +(Math.asin(Math.max(-1, Math.min(1, elevDot))) * 180 / Math.PI).toFixed(2);

    // THE FLOOR, PUBLISHED BEFORE ANY RESULT: two captures at identical state.
    const fa = await decode(); const fb = await decode();
    const ba = bands(fa); const bb = bands(fb);
    const floor = {
      worldMean: +Math.abs(ba.world.mean - bb.world.mean).toFixed(3),
      worldWarm: +Math.abs(ba.world.warm - bb.world.warm).toFixed(3),
    };

    const slotRows = [];
    for (const slot of SLOTS) {
      of.build(slot);
      await of.run(0.1);
      of.setTime(rung.t);
      of.look(site.yaw, site.pitch);
      await of.settle(6);
      const f = await decode();
      slotRows.push({
        slot, ...bands(f),
        draw: { calls: of.stats().draw.calls, triangles: of.stats().draw.triangles,
          programs: of.stats().draw.programs },
      });
      if ((A.shotSlots ?? []).includes(slot) && pngs[`slot${slot}`] === undefined) {
        pngs[`slot${slot}`] = await asPng();
      }
    }

    // THE NEGATIVE CONTROL. The first and last entries of SLOTS are the same
    // slot, so the last row must return to the first row's numbers. A restore
    // that lands elsewhere means something OTHER than the selection moved while
    // this ran, and every number above would then be unattributed.
    const first = slotRows[0]; const last = slotRows[slotRows.length - 1];
    const back = {
      dMean: +(last.world.mean - first.world.mean).toFixed(3),
      dWarm: +(last.world.warm - first.world.warm).toFixed(3),
    };
    check(`elev ${elevDeg}: the slot restore returns the frame to its own start`,
      Math.abs(back.dMean) <= Math.max(0.5, floor.worldMean * 3)
      && Math.abs(back.dWarm) <= Math.max(0.5, floor.worldWarm * 3),
      { back, floor });

    // THE CLAIM. Selecting a slot must move the frame by far more than the floor,
    // and it must move HUE more than it moves value, which is the property that
    // makes it a wash rather than a brightness change.
    let peakMean = 0; let peakWarm = 0;
    for (const r of slotRows) {
      peakMean = Math.max(peakMean, Math.abs(r.world.mean - first.world.mean));
      peakWarm = Math.max(peakWarm, Math.abs(r.world.warm - first.world.warm));
    }
    check(`elev ${elevDeg}: the hotbar selection alone moves the WHOLE frame`,
      peakMean > 10 && peakMean > floor.worldMean * 20,
      { peakMean, peakWarm, floor });
    check(`elev ${elevDeg}: and it moves HUE further than VALUE, which is the wash`,
      peakWarm > peakMean, { peakMean, peakWarm });

    rows.push({ want: rung.want, elevDot, elevDeg, floor, slots: slotRows, restore: back,
      peak: { mean: +peakMean.toFixed(2), warm: +peakWarm.toFixed(2) } });
  }

  // THE ASSERTION THAT KILLS THE ORIGINAL DIAGNOSIS. If the effect is a build
  // ghost it is the same size at noon; if it were a dusk lighting fault it
  // could not be.
  if (rows.length === 2) {
    const r = rows.map((x) => x.peak.warm);
    check('the effect is NOT a property of low sun: it is within 25 per cent at noon',
      Math.abs(r[0] - r[1]) / Math.max(r[0], r[1]) < 0.25,
      { duskPeakWarm: r[0], noonPeakWarm: r[1],
        elev: rows.map((x) => x.elevDeg) });
  }

  return {
    site: site.name, biome: of.world().biome, observer: of.world().observer,
    search: location.search, rows, pngs,
    checks: out.checks, fails: out.fails,
  };
})()
