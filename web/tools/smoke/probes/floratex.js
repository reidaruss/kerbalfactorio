// Are the foliage albedo cards BOUND, live, restorable, and what do they cost?
// (RN-181 / RN-182 / RN-183)
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/floratex.js
//   ... --leaftex=0 --evalargs='{"off":true}' ...   # the negative control
//
// FIXTURE FIRST (INSTRUMENTS.md: a probe asserts its own fixture before the
// behaviour, in terms of the quantity under test). The named failure mode this
// exists to catch is the GREY-WHITE one: the batch path silently drops the map
// and the toggle diffs two identical frames, which reads as a dead term when
// it is a dead fetch. So the fixture check is hasMap AND mapSize 256 (a 1x1
// placeholder passes hasMap and is RN-78's groundshot lie), on every foliage
// batch material, before any pixel is compared.
//
// THE PAIR is wind.js's zero-floor shape: wind frozen, `of.framehash` renders
// synchronously and advances no ticks, so `setMaps({albedo})` is the ONLY
// thing that can differ between captures. Two property assertions, both from
// mechanism:
//   (1) The cutout moves tiles BOTH ways. Alpha test replaces opaque card
//       interior with whatever stands behind it (sky, ground, other cards),
//       and the albedo modulation moves covered texels around their mean, so
//       a one-sided result would mean the term is shading rather than
//       reshaping (RN-63's rule).
//   (2) The restore is BIT-EXACT: setMaps(on) after setMaps(off) must hash
//       identical to the first capture, because apply() rebinds the same
//       texture object, the same alphaTest, and baseColor restores the exact
//       pre-texture colour bytes.
//
// COST is measured A/B/A/B INTERLEAVED IN ONE PAGE (INSTRUMENTS.md: timings
// are worthless across builds while other lanes build on the machine; the
// interleave is the honest form). p50/p95 of sampled frameMs per phase.
(async () => {
  const of = window.__of;
  const wind = window.__ofWind;
  const surf = window.__ofSurfaces;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); };

  await surf.ready;

  // ---- fixture ----------------------------------------------------------
  const r0 = surf.report();
  check('table agrees with manifest', r0.tableAgreesWithManifest);
  check('uv never synthesised', r0.uv.synthesised === 0);
  const fams = Object.fromEntries(r0.families.map((f) => [f.name, f]));
  check('leaf family carries albedo', fams.leaf !== undefined && fams.leaf.albedo);
  check('grass family carries albedo', fams.grass !== undefined && fams.grass.albedo);
  check('alpha_test declared 0.35',
    fams.leaf?.alphaTest === 0.35 && fams.grass?.alphaTest === 0.35);
  const foliage = r0.materials.filter((m) => m.family === 'leaf' || m.family === 'grass');
  check('foliage batches registered', foliage.length >= 5);

  if (A.off === true) {
    // Negative control (?leaftex=0): every foliage material bare, alphaTest 0,
    // colour unscaled. The behaviour half is skipped: there is no term to
    // measure, and that absence is the claim.
    check('control: no card map bound', foliage.every((m) => !m.hasMap));
    check('control: no alpha test', foliage.every((m) => m.alphaTest === 0));
    return { fails, mode: 'control-off', foliage: foliage.map((m) => m.label) };
  }
  check('every foliage batch has the map', foliage.every((m) => m.hasMap));
  check('map is 256, not a placeholder', foliage.every((m) => m.mapSize === 256));
  check('alpha test bound at 0.35', foliage.every((m) => m.alphaTest === 0.35));

  // ---- scene ------------------------------------------------------------
  // The forest site: the ONE place the leaf-card fill-rate cliff can appear
  // (a term measured only where it cannot work reports its own absence).
  of.teleport(A.lat ?? -19.85, A.lon ?? -72.7853, A.alt ?? 2);
  of.look(A.yaw ?? 300, A.pitch ?? -6);
  // Local solar noon, forestsite.js's solver: a fixed t is a different hour
  // at every longitude (WG-53), and sky.elevationDot does not freeze.
  let best = 0; let bestD = -2;
  for (let i = 0; i < 240; ++i) {
    of.setTime(i / 240);
    const d = of.stats().sky.elevationDot;
    if (d > bestD) { bestD = d; best = i / 240; }
  }
  of.setTime(best);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.5);

  if (A.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  // ---- the pair ---------------------------------------------------------
  const TX = 160; const TY = 90; const EPS = 0.5;
  wind.freeze(A.t ?? 40.0);
  const grab = () => of.framehash(TX, TY);
  const diff = (a, b) => {
    let moved = 0; let up = 0; let down = 0; let peak = 0;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = b.tiles[i] - a.tiles[i];
      if (Math.abs(d) > EPS) {
        moved++;
        if (d > 0) up++; else down++;
        peak = Math.max(peak, Math.abs(d));
      }
    }
    return { moved, up, down, peak: +peak.toFixed(2) };
  };

  // NO of.run BETWEEN CAPTURES. framehash renders synchronously (the material
  // recompile happens inside that render), and running the sim between
  // captures would hand the diff every moving thing in the world: the first
  // draft did, and its "restore" read 950 tiles of creature and cloud motion.
  const on1 = grab();
  surf.setMaps({ albedo: false });
  const off = grab();
  surf.setMaps({ albedo: true });
  const on2 = grab();

  const move = diff(off, on1);       // off -> on: what the texture adds
  const restore = diff(on1, on2);
  check('the texture moves the frame', move.moved > 50);
  check('and it moves it BOTH ways', move.up > 0 && move.down > 0
    && Math.min(move.up, move.down) / Math.max(move.up, move.down) > 0.1);
  check('restore is bit-exact', restore.moved === 0 && on1.hash === on2.hash);

  // ---- cost, A/B/A/B in this page --------------------------------------
  // `stats().frameMs.last` is the per-frame sample; the client's own p50/p95
  // are a rolling window that would smear the A phase into the B reading, so
  // the phases collect their own samples and take their own percentiles.
  const phase = async (albedo, secs) => {
    surf.setMaps({ albedo });
    await of.run(0.5);                       // settle the recompile
    const samples = [];
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) {
      await of.run(0.1);
      samples.push(mustNum(of.stats().frameMs, 'last', 'frameMs'));
    }
    samples.sort((x, y) => x - y);
    return {
      n: samples.length,
      p50: +samples[Math.floor(samples.length * 0.5)].toFixed(2),
      p95: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
    };
  };
  const secs = A.secs ?? 4;
  const cost = {
    on_a: await phase(true, secs), off_a: await phase(false, secs),
    on_b: await phase(true, secs), off_b: await phase(false, secs),
  };
  surf.setMaps({ albedo: true });

  const s = of.stats();
  return {
    fails,
    sun: +bestD.toFixed(4),
    pair: { move, restore, hashEqual: on1.hash === on2.hash },
    cost,
    invariants: {
      calls: s.draw.calls, triangles: s.draw.triangles,
      programs: s.draw.programs, geometries: s.draw.geometries,
      textures: s.draw.textures, vram: s.vramEstimateMB,
    },
  };
})()
