// R8 / DW-35: are the two shared tiling surfaces actually BOUND and SAMPLING,
// and did the roles that were deliberately left flat stay flat?
//
//   node tools/smoke/run.mjs --scenario=walk --url=http://127.0.0.1:4310/ \
//     --evalfile=tools/smoke/probes/maps.js --out=docs/screenshots/RN_maps_after.png
//
// The failure this is written against is NOT "the texture did not load". It is
// "the texture loaded, the material has a non-null `normalMap`, and the shader
// never reads it". Every structural check below can pass while the frame is
// pixel-identical to the untextured one, which is exactly why the structural
// half is not allowed to stand alone.
//
// FIVE PROPERTIES, each asserted, none a tuned threshold.
//
// 1. THE UVs ARRIVED. `uv.synthesised` and `uv.countMismatch` are the two ways a
//    geometry can reach a batch without usable UVs. Both must be 0, and
//    `uv.copied` must be large: a zero-filled UV set samples texel (0,0) over
//    the whole primitive, which is a flat tint and not an error.
//
// 2. THE MAPS ARE BOUND, per material, with the right sampler state. `repeat`
//    must equal 1/tile_m because the UVs are in METRES, and `aoChannel` must be
//    0. That one is checked because it is the one predicted to be forgotten:
//    three samples aoMap from `vAoMapUv`, whose channel comes from the texture,
//    and a wrong channel fails as a slightly wrong constant tint.
//
// 3. THE NORMAL MAP PERTURBS SHADING. Structural binding proves nothing about
//    the shader, so the normal map is toggled OFF ALONE inside one settled frame
//    and the frame is differenced. Splitting `normal` from `orm` is what makes
//    the difference attributable to the normal map instead of to roughness,
//    metalness and AO moving together. NEGATIVE CONTROL: the same difference
//    over a sky box must be exactly zero, because the sky has no such material;
//    without it, a global exposure wobble would read as a working normal map.
//
// 4. THE FLAT ROLES STAYED FLAT. Leaf, Grass, Water, Ice, Glass, Skin, Oil and
//    EmissiveState are in `flat_roles` with a recorded reason each. Every
//    material whose family is `flat` must carry zero maps, and no material may
//    carry a map without a family. This is the property `NodeBatch.familyOf`
//    exists to preserve, so the probe also asserts that a `flat:` node bucket
//    EXISTS and is disjoint from the mapped ones.
//
// 5. THE CLIENT AND THE SHIPPED MANIFEST AGREE about which role takes which
//    surface, and no role is unknown to both tables.
(async () => {
  const of = window.__of;
  const S = window.__ofSurfaces;
  const secs = OF_ARGS.secs ?? 6;

  await S.ready;
  const w0 = of.world();

  // Walk a little so chunks stream and the clearing is populated, then let the
  // world converge. Same shape as probes/grass.js: a stationary probe measures
  // only what boot happened to build.
  of.input.tape([{ hold: Math.ceil(60 * secs) + 120, keys: ['KeyW'] }]);
  await of.run(secs, 144.3);
  of.input.tape([{ hold: 600, keys: [] }]);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 120) await of.run(0.5);
  await of.run(0.5);

  of.look(OF_ARGS.yawDeg ?? 0, OF_ARGS.pitchDeg ?? -12);
  await of.run(0.5);
  await of.settle(8);

  // ---- pixel differencing, all inside one settled frame ----
  const grab = async () => {
    const bmp = await createImageBitmap(await of.screenshot());
    // Read the dimensions BEFORE close(): a closed ImageBitmap reports 0 x 0,
    // and every box derived from it is then empty, which is why `samplePx` is
    // returned next to every difference rather than only the difference.
    const w = bmp.width; const h = bmp.height;
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, w, h);
    bmp.close();
    return { d: d.data, w, h };
  };
  // Mean absolute per-channel difference over a box, and the fraction of pixels
  // that moved by more than one count. A mean is reported because a normal map's
  // whole effect is a few counts of shading and a threshold would hide it.
  const diff = (a, b, box) => {
    let sum = 0; let moved = 0; let n = 0; let peak = 0;
    for (let y = box.y0; y < box.y1; ++y) {
      for (let x = box.x0; x < box.x1; ++x) {
        const i = (y * a.w + x) * 4;
        const e = Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1])
          + Math.abs(a.d[i + 2] - b.d[i + 2]);
        sum += e / 3;
        if (e > peak) peak = e;
        if (e > 3) moved++;
        n++;
      }
    }
    return {
      meanAbsDelta: Math.round((sum / Math.max(1, n)) * 1000) / 1000,
      movedFraction: Math.round((moved / Math.max(1, n)) * 1e4) / 1e4,
      peakDelta: peak, samplePx: n,
    };
  };
  const meanLum = (a, box) => {
    let s = 0; let n = 0;
    for (let y = box.y0; y < box.y1; ++y) {
      for (let x = box.x0; x < box.x1; ++x) {
        const i = (y * a.w + x) * 4;
        s += (a.d[i] * 77 + a.d[i + 1] * 151 + a.d[i + 2] * 28) / 256;
        n++;
      }
    }
    return Math.round((s / Math.max(1, n)) * 100) / 100;
  };

  const probe = await grab();
  const W = probe.w; const H = probe.h;
  // The ground box: the lower-middle of the frame at pitch -12, which is the
  // clearing floor, its props and its nodes. The sky box: the top strip, which
  // at this pitch is above the horizon and contains no batch material at all.
  const ground = { x0: (W * 0.25) | 0, x1: (W * 0.75) | 0, y0: (H * 0.55) | 0, y1: (H * 0.95) | 0 };
  const sky = { x0: (W * 0.25) | 0, x1: (W * 0.75) | 0, y0: 0, y1: (H * 0.10) | 0 };

  S.setMaps({ normal: true, orm: true });
  await of.settle(3);
  const all = await grab();
  const statsAfter = of.stats();

  S.setMaps({ normal: false, orm: true });
  await of.settle(3);
  const noNormal = await grab();

  S.setMaps({ normal: false, orm: false });
  await of.settle(3);
  const none = await grab();
  const statsBefore = of.stats();

  // `leaveOff` is how the BEFORE screenshot is taken: the same probe, the same
  // seed, the same tape and therefore the same camera and sun, with the maps
  // detached at the end so run.mjs's --out captures the untextured frame.
  const leaveOff = OF_ARGS.leaveOff === true;
  S.setMaps({ normal: !leaveOff, orm: !leaveOff });
  await of.settle(3);

  const r = S.report();

  // ---- assertions ----
  const mapped = r.materials.filter((m) => m.family !== 'flat');
  const flat = r.materials.filter((m) => m.family === 'flat');
  const tileOf = {};
  for (const f of r.families) tileOf[f.name] = f.tileM;

  const bindingOk = mapped.length > 0 && mapped.every((m) =>
    m.hasNormal && m.hasRough && m.hasMetal && m.hasAo
    && m.aoChannel === 0 && m.normalChannel === 0
    && m.wrapRepeat && m.dataColorSpace
    && Math.abs(m.repeat - 1 / tileOf[m.family]) < 1e-6);
  const flatOk = flat.length > 0 && flat.every((m) =>
    !m.hasNormal && !m.hasRough && !m.hasMetal && !m.hasAo);

  const nodeBuckets = r.materials.filter((m) => m.label.startsWith('nodes:'))
    .map((m) => m.label.slice(6));
  const nodeFlat = nodeBuckets.filter((b) => b.startsWith('flat:'));
  const nodeMapped = nodeBuckets.filter((b) => !b.startsWith('flat:'));
  // The role names actually found in the loaded node and prop glbs, so the
  // bucketing claim is made against what shipped and not against the table.
  const foliageRoles = Object.entries(r.rolesSeen)
    .filter(([k]) => /^(Leaf|Grass|Water|Ice|Glass|Skin|Oil|EmissiveState)/.test(k));
  const foliageFlat = foliageRoles.length > 0 && foliageRoles.every(([, v]) => v === 'flat');

  const dNormal = diff(all, noNormal, ground);
  const dOrm = diff(noNormal, none, ground);
  const dAll = diff(all, none, ground);
  const dSky = diff(all, none, sky);

  return {
    valid: r.ready && of.world().tick > w0.tick && probe.w > 0,
    isolation: {
      note: 'runtime toggle, one settled frame: camera, sun, streamed set and'
        + ' terrain are identical between captures by construction',
      leaveOff, state: r.state,
      stateAsAsked: r.state.normal === !leaveOff && r.state.orm === !leaveOff,
    },
    // --- PROPERTY 5: the client table and the shipped manifest agree.
    manifest: {
      loaded: r.manifest, families: r.families,
      tableAgreesWithManifest: r.tableAgreesWithManifest,
      mismatches: r.mismatches, unknownRoles: r.unknownRoles,
      ok: r.tableAgreesWithManifest && r.unknownRoles.length === 0,
    },
    // --- PROPERTY 1: the UVs arrived, on every primitive, on ALL THREE paths.
    // Per consumer, because the walk scenario has no machines placed and a
    // single total would let the machine path pass on the nodes' UVs.
    uv: {
      ...r.uv,
      ok: r.uv.synthesised === 0 && r.uv.countMismatch === 0
        && (r.uv.byConsumer.machines ?? 0) > 0 && (r.uv.byConsumer.nodes ?? 0) > 0
        && (r.uv.byConsumer.props ?? 0) > 0,
    },
    // The machine batch is the one material with a custom fragment edit, and
    // ASSET-SPECS 2.8 rules out an albedo map precisely BECAUSE that edit
    // overwrites diffuseColor. The other four maps surviving it is an ordering
    // claim about three's chunk list, read here off the real shader string.
    shaderOrder: {
      ...r.shaderOrder,
      ok: Object.values(r.shaderOrder).length > 0
        && Object.values(r.shaderOrder).every((o) =>
          o.mapsResolveBeforeHook && o.aoAppliedAfterHook),
    },
    // --- PROPERTY 2: bound, with the right sampler state.
    binding: {
      materials: r.materials.length, mapped: mapped.length, flat: flat.length,
      aoChannels: [...new Set(mapped.map((m) => m.aoChannel))],
      repeats: [...new Set(mapped.map((m) => m.repeat))],
      anisotropy: [...new Set(mapped.map((m) => m.anisotropy))],
      ok: bindingOk,
    },
    // --- PROPERTY 3: the normal map is READ, not merely attached.
    shading: {
      normalOnly: dNormal, ormOnly: dOrm, allMaps: dAll,
      skyControl: dSky,
      groundLumWithMaps: meanLum(all, ground),
      groundLumWithout: meanLum(none, ground),
      // A normal map that is bound and ignored gives exactly 0.000 here. The
      // sky control is the negative half: it must be exactly 0, because nothing
      // above the horizon uses a batch material, so any nonzero reading there
      // would mean the toggle moved something global and the ground number
      // could not be attributed to the maps.
      // `samplePx > 0` and a lit ground are the two degenerate readings that
      // would otherwise let a difference of exactly 0 read as a passing sky
      // control while nothing was examined at all.
      ok: dNormal.samplePx > 0 && dSky.samplePx > 0
        && meanLum(all, ground) > 8
        && dNormal.meanAbsDelta > 0 && dNormal.movedFraction > 0
        && dOrm.meanAbsDelta > 0
        && dSky.meanAbsDelta === 0 && dSky.peakDelta === 0,
    },
    // --- PROPERTY 4: the flat roles stayed flat.
    flatRoles: {
      flatMaterials: flat.map((m) => m.label),
      nodeBuckets, nodeFlat, nodeMapped,
      foliageRolesSeen: Object.fromEntries(foliageRoles),
      bucketedByFamily: nodeBuckets.every((b) => b.includes(':')),
      ok: flatOk && foliageFlat && nodeFlat.length > 0 && nodeMapped.length > 0,
    },
    rolesSeen: r.rolesSeen,
    cost: {
      drawCalls: statsAfter.draw.calls, triangles: statsAfter.draw.triangles,
      drawCallsMapsOff: statsBefore.draw.calls,
      trianglesMapsOff: statsBefore.draw.triangles,
      frameMs: statsAfter.frameMs, vramEstimateMB: statsAfter.vramEstimateMB,
      textureVramMB: r.vramMB, textureVramBytes: r.vramBytes,
      programs: statsAfter.draw.programs, geometries: statsAfter.draw.geometries,
      textures: statsAfter.draw.textures,
      nodePools: statsAfter.props, drawBudget: statsAfter.budget,
    },
  };
})()
