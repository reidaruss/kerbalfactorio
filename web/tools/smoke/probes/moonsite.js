// WG-141: what is actually under the player on Cinder, at several sites.
//
// Answers three questions no counter in the HUD answers on its own:
//   1. Is this really the moon? (radius, declared relief, biome id)
//   2. Do the harvest-node streams honour the moon's zero densities, and if
//      something still places, WHAT is it and where did it come from?
//   3. What does the ground do at a spread of sites: relief, slope, and the
//      crater curvature the /core ladder is supposed to have put there.
//
// Sites are passed in so the same probe serves every capture of the night.
//
//   node tools/smoke/run.mjs --scenario=walk --body=cinder \
//        --evalfile=tools/smoke/probes/moonsite.js
//
// `body=cinder` boots on the moon; OF_ARGS.sites defaults to the spawn site
// (lat 2, lon 144) when omitted, so no --evalargs is required to run this.
(async () => {
  const of = window.__of;
  const args = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const sites = args.sites || [{ name: 'spawn', lat: 2.0, lon: 144.0 }];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  const settleHere = async () => {
    let guard = 0;
    while (!of.world().chunks.converged && guard++ < 240) await of.run(0.25);
    guard = 0;
    while (guard++ < 120) {
      const s = of.stats();
      const g = of.game();
      const backlog = (s.props && s.props.scatterBacklog) || 0;
      const rb = (g.rocks && g.rocks.backlog) || 0;
      const tb = (g.trees && g.trees.backlog) || 0;
      if (backlog === 0 && rb === 0 && tb === 0) break;
      await of.run(0.25);
    }
    await of.settle(4);
  };

  const w0 = of.world();
  const t0 = w0.tick;

  // --- identity -------------------------------------------------------------
  const identity = {
    bodyRadiusM: mustNum(w0, 'bodyRadiusM', 'world()'),
    maxReliefM: (of.stats().terrain && of.stats().terrain.maxReliefM) || null,
  };
  // A moon is 200 km; Forge is 600 km. This is the one check that cannot be
  // fooled by a palette or a biome id.
  check('the body is Cinder, not Forge',
        Math.abs(identity.bodyRadiusM - 200000) < 1,
        `bodyRadiusM ${identity.bodyRadiusM}`);

  const rows = [];
  for (const site of sites) {
    of.teleport(site.lat, site.lon, 2.0);
    await settleHere();

    const w = of.world();
    const g = of.game();
    const r = w.bodyRadiusM;

    // Curvature of the DRAWN surface, sampled through the oracle so it is the
    // same authority /core asserts on. Step east along the surface.
    const dir = { x: 0, y: 0, z: 0 };
    const lat = site.lat * Math.PI / 180, lon = site.lon * Math.PI / 180;
    dir.x = Math.cos(lat) * Math.cos(lon);
    dir.y = Math.sin(lat);
    dir.z = Math.cos(lat) * Math.sin(lon);
    // east tangent
    let ex = -Math.sin(lon), ey = 0, ez = Math.cos(lon);
    const curv = {};
    for (const d of [4, 40, 400]) {
      const a = d / r;
      const p = (k) => {
        const q = { x: dir.x + ex * a * k, y: dir.y + ey * a * k, z: dir.z + ez * a * k };
        const l = Math.hypot(q.x, q.y, q.z);
        return of.surface(q.x / l, q.y / l, q.z / l).baseM;
      };
      const h0 = p(-1), h1 = p(0), h2 = p(1);
      curv[`c${d}`] = Math.abs(h0 - 2 * h1 + h2);
      curv[`s${d}`] = Math.abs(h2 - h1);
    }

    rows.push({
      site: site.name,
      lat: site.lat, lon: site.lon,
      biome: w.biome,
      reliefM: w.surfaceHeightM,
      slopeDeg: (of.stats().player && of.stats().player.slopeDeg) || null,
      curvature: curv,
      trees: g.trees ? {
        live: g.trees.live, cells: g.trees.cells,
        biomeZeroCells: g.trees.biomeZeroCells, wanted: g.trees.wanted,
        delivered: g.trees.delivered,
      } : null,
      rocks: g.rocks ? {
        live: g.rocks.live, cells: g.rocks.cells,
        biomeZeroCells: g.rocks.biomeZeroCells, wanted: g.rocks.wanted,
        delivered: g.rocks.delivered,
      } : null,
      nodes: g.nodes ? { nodes: g.nodes.nodes, instances: g.nodes.instances } : null,
      props: (() => {
        const p = of.stats().props || {};
        return { propsPlaced: p.propsPlaced, cellsScattered: p.cellsScattered,
                 deliveredFraction: p.deliveredFraction };
      })(),
    });
  }

  // --- what actually got placed, by kind, at the LAST site ------------------
  const kindCount = {};
  const artCount = {};
  for (const n of of.nodes()) {
    kindCount[n.kind] = (kindCount[n.kind] || 0) + 1;
    artCount[n.art] = (artCount[n.art] || 0) + 1;
  }

  // Every moon biome must be one of 7, 8, 9. A planet biome here means the
  // field is asking the wrong body.
  for (const r of rows) {
    check(`site ${r.site} classifies as a moon biome`,
          r.biome >= 7 && r.biome <= 9, `biome ${r.biome}`);
  }

  check('the sim advanced', of.world().tick - t0 > 100);

  return {
    valid: fails.length === 0,
    fails,
    identity,
    rows,
    lastSiteNodeKinds: kindCount,
    lastSiteNodeArt: artCount,
  };
})()
