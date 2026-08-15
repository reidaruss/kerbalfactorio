// RN-1478. WHICH SURFACE EACH MACHINE LAYER ACTUALLY WEARS, and the sampler
// arithmetic that decided the design, read off the live client rather than
// argued.
//
// Places a smelter and a belt through the real ghost-and-press path (the
// machine art frame's own scene), then publishes:
//   families   every registered material whose label starts `machines:`, its
//              family, and which of the five map slots are BOUND. This is the
//              whole claim: `machines:factoryMachines:stone` with a normal, an
//              ORM and an albedo is the smelter hearth wearing stone.
//   samplers   the GL limit and the machine program's own texture-unit count,
//              counted from the compiled program's active uniforms rather than
//              from the material, so the shadow cascades and the PMREM env are
//              in the total the same way the driver sees them.
//   pools      instances, batches and refusals per pool, so the split is shown
//              not to have cost a drawn machine.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/machinefam.js
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const S = window.__ofSurfaces;
  if (!S) return { valid: false, why: 'no __ofSurfaces' };
  await S.ready;

  // ---- the scene: artframe.js's machine shot, minus the framing solve -------
  const fac = () => of.game().factory;
  const yaw0 = of.world().observer.yawDeg;
  const put = async (from, to) => {
    for (let p = from; p >= to; p -= 0.3) {
      of.look(yaw0, p);
      await sleep(0.035);
      const g = of.build().ghost;
      if (g === null || !g.ok) continue;
      const before = fac().buildings;
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
      await sleep(0.16);
      if (fac().buildings > before) return p;
    }
    return null;
  };
  of.build(3);
  const smelter = await put(-14, -46);
  of.build(2);
  const belt = smelter === null ? null : await put(smelter + 4, -12);
  of.build(0);
  await of.settle(A.settle ?? 12);

  // ---- what the layers wear ------------------------------------------------
  const s0 = of.stats();
  const r = S.report();
  const families = r.materials.filter((m) => m.label.startsWith('machines:'))
    .map((m) => ({ label: m.label, family: m.family,
      albedo: m.hasMap, normal: m.hasNormal, rough: m.hasRough,
      metal: m.hasMetal, ao: m.hasAo, repeat: m.repeat,
      mapPx: m.mapSize, roughness: m.roughness, metalness: m.metalness }));

  // ---- the sampler budget --------------------------------------------------
  // EVERY TERM IS MEASURED, and the sum is stated rather than the sum being
  // measured, because three allocates a texture unit per sampler UNIFORM and
  // there is no API that hands a probe the per-program count. The limit comes
  // off the live context (`getContext` with the same type returns the context
  // that already exists, so this does not create a second one).
  const cv = document.querySelector('canvas');
  const gl = cv === null ? null : cv.getContext('webgl2');
  const base = families.find((f) => f.family === 'panel') ?? families[0] ?? null;
  const perMaterial = base === null ? 0
    : [base.albedo, base.normal, base.rough, base.metal, base.ao]
      .filter(Boolean).length;
  const cascades = s0.shadow.cascades;
  const env = s0.ibl.ready ? 1 : 0;
  const samplers = {
    limitPerStage: gl === null ? null : gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    limitCombined: gl === null ? null
      : gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    guaranteed: 16,
    perMachineMaterial: perMaterial,
    envMap: env,
    shadowCascades: cascades,
    // What ONE machine program binds. Unchanged by the split, which is the
    // point: the split spends draws, not units.
    machineProgram: perMaterial + env + cascades,
    // What the refused one-material design would have needed: the base five
    // plus albedo+normal+ORM for every EXTRA family this pool carries.
    oneMaterialWouldNeed: perMaterial + env + cascades
      + 3 * Math.max(0, families.filter((f) => f.label.startsWith('machines:factoryMachines:')).length - 1),
  };

  const pools = of.game().pools ?? null;
  const s = of.stats();
  return {
    valid: families.length > 0,
    placed: fac().buildings, smelterPitch: smelter, beltPitch: belt,
    families, samplers, pools,
    unknownRoles: r.unknownRoles, mismatches: r.mismatches,
    rolesSeen: r.rolesSeen,
    draw: { calls: s.draw.calls, programs: s.draw.programs,
      triangles: s.draw.triangles, textures: s.draw.textures },
    vramMB: s.vramEstimateMB,
    frameMs: { p50: s.frameMs.p50, p95: s.frameMs.p95 },
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
