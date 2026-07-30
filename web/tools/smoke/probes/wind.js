// Does the foliage actually move in the wind, and does NOTHING ELSE? (RN-99)
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/wind.js
//   ... --wind=0 ...        # the negative control: zero hooks, bit-exact stillness
//   ... --evalargs='{"freezeT":40}' --out=docs/screenshots/RN99_t40.png
//                           # leaves the wind FROZEN at t for a matched PNG pair
//
// THE INSTRUMENT IS THE FREEZE, and it is what makes the floor exactly zero.
// `of.framehash` renders synchronously and advances no ticks, and the wind time
// is a uniform that `__ofWind.freeze(t)` pins. So two captures at two frozen
// wind times differ by NOTHING except the sway: same camera, same sun, same
// streamed chunks, same sim tick, to the bit. No screenshot pair across a page
// load can make that claim (RN-71: `of.framehash` does not survive a reload).
//
// WHAT IS ASSERTED, in order of strength:
//   1. Frozen time is frozen: two captures at the SAME t hash identical.
//   2. The sway moves pixels BOTH ways (a silhouette change brightens where a
//      blade leaves and darkens where it arrives; RN-63's split rule).
//   3. It moves them ONLY on foliage: the moved tiles sit inside the prop mask
//      (props shown vs hidden, proplight.js's method), and with the props
//      HIDDEN two wind times hash bit-identical, so nothing else in the scene
//      consumes the wind clock.
//   4. `windamp=0` inside the same page is bit-exact with the same page's own
//      stillness: the hooked program at zero amplitude displaces nothing, so
//      the hook itself has no pixel cost.
//   5. With `?wind=0`: zero materials hooked, and the same two-freeze capture
//      pair hashes IDENTICAL, which is the static build reproduced.
// The base band (y = 0) is zero BY CONSTRUCTION in the shader (amplitude is
// linear in height above the prop's own base), the same style of claim as the
// refraction offset vanishing at the shoreline (RN-51): the named failure
// modes, "grass detaches from the ground" and "the whole tree slides", are
// structurally unreachable rather than tuned away. The close-up PNG pair is
// still taken and still looked at, per DW-7.
(async () => {
  const of = window.__of;
  const wind = window.__ofWind;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); };

  // The RN-15 camera by default, so this pass, RN-15, RN-30 and RN-45 are all
  // comparable: Hills, understorey at ~0.55 coverage, 462 canopy trees.
  // `stay: true` keeps the spawn (the harvest-node clearing, where the trees
  // that sway through `nodes:flat:matte` actually are).
  if (A.stay !== true) of.teleport(A.lat ?? 12, A.lon ?? 150, A.alt ?? 2);
  of.look(A.yaw ?? 300, A.pitch ?? -10);
  if (A.noon === true) {
    // Local solar noon, forestsite.js's solver verbatim: `setTime` is a
    // BODY-frame direction, so a fixed t is a different hour at every
    // longitude (WG-53). The first forest pair of RN-100 was shot at night
    // because of exactly this.
    let best = 0; let bestDot = -2;
    for (let i = 0; i < 240; ++i) {
      of.setTime(i / 240);
      const d = of.stats().sky.elevationDot;
      if (d > bestDot) { bestDot = d; best = i / 240; }
    }
    of.setTime(best);
  } else {
    of.setTime(A.sunT ?? 0.30);
  }
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

  const TX = 160; const TY = 90;
  const EPS = 0.5;           // counts of 8x8-tile mean; means are published to 0.01
  const T1 = A.t1 ?? 40.0;   // 1.6 s apart: ~120 degrees of the 1.31 rad/s term
  const T2 = A.t2 ?? 41.6;
  const T3 = A.t3 ?? 43.2;
  const st0 = wind.state();

  // A one-shot mode for screenshots: freeze and leave frozen, let --out shoot.
  if (typeof A.freezeT === 'number') {
    wind.freeze(A.freezeT);
    await of.run(0.2);
    return { valid: true, mode: 'freeze', frozenAt: A.freezeT, state: wind.state() };
  }

  const grab = () => of.framehash(TX, TY);
  const diff = (a, b) => {
    let moved = 0; let up = 0; let down = 0; let peak = 0; let sum = 0;
    const tiles = [];
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = b.tiles[i] - a.tiles[i];
      const m = Math.abs(d);
      sum += m;
      if (m > peak) peak = m;
      if (m > EPS) { moved++; tiles.push(i); if (d > 0) up++; else down++; }
    }
    return { moved, up, down, peak, mean: sum / a.tiles.length, tiles };
  };

  // ---- the ?wind=0 branch: the control IS the result ----------------------
  if (!st0.enabled) {
    check('wind=0: zero materials hooked', st0.hooked.length === 0);
    wind.freeze(T1); const a = grab();
    wind.freeze(T2); const b = grab();
    check('wind=0: two wind times hash IDENTICAL (the static build)',
      a.hash === b.hash);
    wind.thaw();
    const s = of.stats();
    return {
      valid: fails.length === 0, fails, mode: 'control',
      hooked: st0.hooked, hashA: a.hash, hashB: b.hash,
      stats: {
        calls: s.draw.calls, triangles: s.draw.triangles, programs: s.draw.programs,
        geometries: s.draw.geometries, vramMB: s.vramEstimateMB,
      },
    };
  }

  // ---- fixture: the hook matched something, and freeze freezes ------------
  check('at least 8 materials hooked (8 foliage prop batches + tree leaves)',
    st0.hooked.length >= 8);
  wind.freeze(T1);
  const capA = grab();
  const capA2 = grab();
  check('frozen time is frozen: same t hashes identical', capA.hash === capA2.hash);

  // ---- the prop mask, by difference, never by rectangle (proplight.js) ----
  // Taken FROZEN, so the only difference between the two mask captures is the
  // visibility toggle itself.
  of.propsVisible(false);
  const capHid = grab();
  // THE STRONGEST "NOTHING ELSE MOVED" CONTROL, and it replaced a broken one.
  // The first version of this probe asserted a fixed top-of-frame "pure sky"
  // band moved zero tiles, and it failed with 512 moved: at the RN-15 camera
  // the hillside rises and canopy crowns stand in those rows, so the band was
  // not sky, which is INSTRUMENTS.md's opening failure (a control that depends
  // on something that moved) and RN-45's sky-band error verbatim. 98.98% of
  // those moved tiles sat inside the prop mask: foliage, not an escape. The
  // replacement needs no geometry assumption at all: with the props HIDDEN,
  // two wind times must hash IDENTICAL, because nothing else in the scene
  // consumes the wind clock.
  wind.freeze(T2);
  const capHid2 = grab();
  // `trees: true` INVERTS this control on purpose. `propsVisible` hides only
  // the scatter batches, not `NodeBatch`, so at a site with harvest trees the
  // hidden frame still contains swaying crowns and the identity CANNOT hold.
  // That is not a leak, it is the direct measurement of `nodes:flat:matte`:
  // with the scatter hidden and the arms frozen (framehash advances no ticks),
  // the hidden-pair diff is PURE harvest-crown motion.
  const hidDiff = diff(capHid, capHid2);
  if (A.trees === true) {
    check('props hidden, the harvest crowns still sway (nodes:flat:matte)',
      capHid.hash !== capHid2.hash && hidDiff.moved > 20);
    check('crown sway moves BOTH ways',
      hidDiff.up >= 0.2 * hidDiff.moved && hidDiff.down >= 0.2 * hidDiff.moved);
  } else {
    check('props hidden, two wind times hash IDENTICAL (nothing else moves)',
      capHid.hash === capHid2.hash);
  }
  wind.freeze(T1);
  of.propsVisible(true);
  const capShown = grab();
  check('mask control: props-shown recapture matches capA', capShown.hash === capA.hash);
  const maskD = diff(capHid, capShown);
  const propTiles = new Set(maskD.tiles);
  check('fixture: the frame contains props (mask > 200 tiles)', propTiles.size > 200);

  // ---- the motion, at zero floor ------------------------------------------
  wind.freeze(T2); const capB = grab();
  wind.freeze(T3); const capC = grab();
  const ab = diff(capA, capB);
  const bc = diff(capB, capC);
  check('the sway moves pixels (A vs B)', ab.moved > 100);
  check('and keeps moving them (B vs C)', bc.moved > 100);
  check('BOTH directions, A-B: brighter and darker each >= 20% of moved',
    ab.up >= 0.2 * ab.moved && ab.down >= 0.2 * ab.moved);
  check('BOTH directions, B-C likewise',
    bc.up >= 0.2 * bc.moved && bc.down >= 0.2 * bc.moved);
  let onProps = 0;
  for (const t of ab.tiles) if (propTiles.has(t)) onProps++;
  const conc = ab.moved > 0 ? onProps / ab.moved : 0;
  if (A.trees !== true) {
    check('moved tiles are ON the foliage: >= 85% inside the prop mask', conc >= 0.85);
  }
  // Outside-mask movers are reported, not asserted: the concentration bound
  // above owns that claim, and the hidden-pair identity owns "nothing else".
  let outsideMask = 0;
  for (const t of ab.tiles) if (!propTiles.has(t)) outsideMask++;

  // ---- amp=0 inside the same page: the hook alone costs no pixel ----------
  wind.set(0);
  wind.freeze(T1); const capD = grab();
  wind.freeze(T2); const capE = grab();
  check('windamp 0: two wind times hash identical (zero displacement is zero)',
    capD.hash === capE.hash);
  wind.set(st0.ampM);
  wind.thaw();

  const s = of.stats();
  return {
    valid: fails.length === 0, fails,
    hooked: st0.hooked,
    ampM: st0.ampM, treeK: st0.treeK,
    maskTiles: propTiles.size,
    ab: { moved: ab.moved, up: ab.up, down: ab.down, peak: ab.peak, mean: +ab.mean.toFixed(4) },
    bc: { moved: bc.moved, up: bc.up, down: bc.down, peak: bc.peak, mean: +bc.mean.toFixed(4) },
    concentration: +conc.toFixed(4),
    outsideMask,
    hiddenPair: {
      moved: hidDiff.moved, up: hidDiff.up, down: hidDiff.down,
      peak: hidDiff.peak,
    },
    stats: {
      calls: s.draw.calls, triangles: s.draw.triangles, programs: s.draw.programs,
      geometries: s.draw.geometries, vramMB: s.vramEstimateMB,
    },
  };
})()
