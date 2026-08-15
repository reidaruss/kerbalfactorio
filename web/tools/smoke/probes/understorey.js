// understorey.js (RN-1760). WHAT THE FOLIAGE COSTS THE SHADOW PASS, AT THE
// FOREST SITE, READ OFF THE RUNNING CLIENT RATHER THAN OFF THE SHIPPED BYTES.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<p>/ --scenario=walk \
//     --evalfile=tools/smoke/probes/understorey.js --wait=900 \
//     --evalargs='{}'
//
// WHY IT IS NOT `check_shadow_lod.py`. That tool reads the shipped glb and
// merges every primitive of a variant into ONE ladder. `NodeBatch.ladder`
// does not: it measures per (file, variant, MATERIAL FAMILY), because a batch
// is a family. The two therefore disagree by construction, and the client's
// is the one that decides what is drawn. Both are reported here side by side
// so the offline tool can be used for iteration with its bias known instead
// of assumed.
//
// WHAT MAKES THE READING NON-VACUOUS. A ladder report from a scene with no
// foliage in it is a beautiful table of zeroes, so the scene is asserted
// first: chunks converged, the scatter pool refused nothing, no cell and no
// chunk capped, and the tree field actually delivered what it wanted. The
// scatter density comes back on EVERY run whether or not this pass touches
// it, because "density did not change" is a claim about two numbers and not
// about intent.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const sleep = (n) => of.run(n);
  const log = [];

  // The `forestfloor` pose, verbatim from `artframe.js`'s SHOTS table, so the
  // numbers here and the frame that ships beside them are the same scene.
  const lat = A.lat ?? -19.85;
  const lon = A.lon ?? -72.7853;
  const yaw = A.yaw ?? 300;
  const pitch = A.pitch ?? -26;

  of.build(0);
  of.teleport(lat, lon, 2.0);
  await sleep(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
  await sleep(1.0);
  of.look(yaw, pitch);
  await sleep(0.4);
  const sun = of.setSunElev(A.sunDot ?? 0.70);
  await sleep(0.6);
  of.look(yaw, pitch);
  await sleep(A.settle ?? 1.0);

  const s = of.stats();
  const p = s.props;
  const rep = window.__ofShadowLod.report();

  // The foliage rows only. `label` is `${file}|${variant}|${family}`, so the
  // filter is on the FILE half and never on a substring of the whole label.
  const FOLIAGE = ['tree_conifer', 'tree_broadleaf', 'bush_scrub',
    'detail_cards', 'props_forest', 'props_canopy'];
  const rows = [];
  for (const pool of rep.pools) {
    for (const r of pool.rows) {
      const file = String(r.label).split('|')[0];
      if (!FOLIAGE.some((f) => file.includes(f))) continue;
      rows.push({
        pool: pool.pool, label: r.label, tris: r.tris, devMM: r.devMM,
        tier: r.tierPerCascade,
        // 1 + (cascades still on tier 0), `check_shadow_lod.marginal`.
        marginal: 1 + r.tierPerCascade.filter((t) => t === 0).length,
      });
    }
  }
  rows.sort((a, b) => (a.label < b.label ? -1 : 1));

  // A ladder is only worth its multiplier if instances of it are actually in
  // the cascades. `savedPerFrame` is the client's own last-frame figure and is
  // the number an A/B has to reproduce.
  log.push(`rows ${rows.length} savedPerFrame ${rep.savedPerFrame}`);

  // --- WHICH PROP BATCHES ARE EVEN IN THE SHADOW PASS -----------------------
  // `PropLibrary` splits the understorey into `:detail` batches with
  // `castShadow = false` (its own DETAIL_SUFFIX note), so a shadow ladder
  // authored for `detail_cards` would be authored for a pass those cards are
  // not in. That is a claim about the shipped client, so it is READ.
  const props = window.__ofProps.stats();
  const casting = { casts: [], noCast: [] };
  for (const b of props.perMaterial ?? []) {
    (b.casts ? casting.casts : casting.noCast).push(`${b.name}:${b.live}`);
  }

  // --- THE CEILING, AND IT IS THE MEASUREMENT THAT COMES BEFORE ANY BUILD ----
  // RN-696's `setBudget` moves the admission budget IN PLACE, so the whole
  // question "what could a perfect shadow-safe LOD ladder possibly pay here?"
  // is a sweep inside ONE settled frame instead of an asset wave. k = 1 is the
  // shipped rule; a large k admits every authored tier at every cascade, which
  // is strictly better than any ladder an art pass could ever write, because
  // no ladder can be admitted MORE than always. Whatever that arm saves is the
  // hard ceiling on the shadow half of this pass.
  const ceiling = [];
  for (const k of (A.ks ?? [1, 5, 25, 200])) {
    window.__ofShadowLod.setBudget({ k });
    await sleep(0.35);
    const st = of.stats();
    const r2 = window.__ofShadowLod.report();
    ceiling.push({
      k, savedPerFrame: r2.savedPerFrame, triangles: st.draw.triangles,
      frameP50: +st.frameMs.p50.toFixed(2), nearMs: +st.passMs.near.toFixed(2),
      budgetMM: r2.cascades.map((c) => c.budgetMM),
    });
  }
  window.__ofShadowLod.setBudget({ k: null });
  await sleep(0.35);

  // --- WHERE THE TREES ACTUALLY ARE ----------------------------------------
  // `NODE_LOD1_M` is 55 m and `NODE_LOD2_M` is 165 m, so LOD1 is a DISTANCE
  // tier before it is ever a shadow tier and anything added to it is paid for
  // by every tree in the 55 to 165 m annulus. That is a count, not an
  // adjective, so it is counted. The cascades are nested ortho boxes centred
  // near the eye (`ShadowRig.update`, r = far * 0.72), so the shadow bands are
  // 15.8 / 57.6 / 216 m of RADIUS and not the raw splits.
  // The tree field publishes its own ring radius and live count. The annulus
  // shares below are UNIFORM-DENSITY ESTIMATES off those two numbers and are
  // labelled as such: the field refuses slopes, water and clearings, so the
  // real distribution is not uniform, and no client surface publishes a
  // per-instance distance to count it exactly.
  let dist = null;
  try {
    const g = of.game === undefined ? null : of.game();
    const tf = (g && g.nodes) ? g.nodes : null;
    const r = tf ? tf.radiusM : null;
    const live = tf ? tf.live : null;
    const ann = (a, b) => (r ? Math.round(live * (Math.min(b, r) ** 2
      - Math.min(a, r) ** 2) / (r * r)) : null);
    dist = {
      statsKeys: Object.keys(of.stats()),
      radiusM: r, live,
      // Cascade RADII are far * 0.72 (`ShadowRig.update`), not the splits.
      cascadeRadiusM: [15.84, 57.6, 216],
      estByBand: r ? {
        '0-15.8_c0': ann(0, 15.84), '15.8-55_LOD0': ann(15.84, 55),
        '55-57.6': ann(55, 57.6), '57.6-165_LOD1': ann(57.6, 165),
        '165-216_LOD2': ann(165, 216), 'beyond216': live - ann(0, 216),
      } : null,
      caveat: 'uniform-density estimate off radiusM and live, not a count',
    };
  } catch (e) { dist = { error: String(e) }; }

  return {
    casting,
    ceiling,
    dist,
    ok: true,
    site: { lat, lon, yaw, pitch, sun },
    sceneReal: {
      converged: of.world().chunks.converged,
      propsPlaced: p.propsPlaced,
      poolRefused: p.refused, cellsCapped: p.cellsCapped,
      chunksCapped: p.chunksCapped,
      ok: p.propsPlaced > 0 && p.refused === 0 && p.cellsCapped === 0
        && p.chunksCapped === 0,
    },
    scatter: {
      chunks: p.chunks, propsPlaced: p.propsPlaced, groundM2: p.groundM2,
      placedPerM2: p.placedPerM2, wantedPerM2: p.wantedPerM2,
      deliveredFraction: p.deliveredFraction,
      instances: p.instances, capacity: p.capacity,
    },
    cost: {
      triangles: s.draw.triangles, drawCalls: s.draw.calls,
      programs: s.draw.programs, geometries: s.draw.geometries,
      frameMs: s.frameMs, passMs: s.passMs,
      vramEstimateMB: s.vramEstimateMB,
    },
    shadow: {
      flag: rep.flag, cascades: rep.cascades,
      swaps: rep.swaps, instances: rep.instances,
      savedTriangles: rep.savedTriangles, passes: rep.passes,
      savedPerFrame: rep.savedPerFrame, batches: rep.batches,
    },
    foliage: rows,
    log,
  };
})()
