// vmsurface.js (RN-1882): WHAT THE FIRST-PERSON VIEW MODEL AND ITS HELD TOOL
// ACTUALLY WEAR, read off the running client rather than off the manifest.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --evalfile=tools/smoke/probes/vmsurface.js
//
// WHY IT EXISTS. RN-1880 split `Haft` off `Bark` onto a new `timber` family
// whose whole point is a tile size, and a tile size reaches the frame through
// `texture.repeat`. Three separate things can go right on paper and still
// leave the shaft wearing the old field: the manifest can declare the family
// and the client's ROLE_FAMILY not know the role (`check-roles` catches that
// one), the material can be registered and the map fail to bind (`hasMap`),
// or the map can bind at the wrong repeat. `check-roles` is a STATIC gate on
// three tables; this is the dynamic half, and it asserts the number that
// actually multiplies the UV.
//
// It also publishes the rows for the arms themselves, because the same
// registry is where a role that draws untextured would show up, and the
// look audit's R4 entry named a bare untextured surface without checking.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  await of.ready;
  await of.settle(12);
  const S = window.__ofSurfaces;
  if (!S) return { valid: false, why: 'no __ofSurfaces' };
  const rep = S.report();
  const rows = rep.materials
    .filter((m) => m.label.startsWith('fparms'))
    .map((m) => ({
      label: m.label, family: m.family, hasMap: m.hasMap, mapSize: m.mapSize,
      hasNormal: m.hasNormal, hasRough: m.hasRough, hasAo: m.hasAo,
      repeat: m.repeat === null ? null : Number(m.repeat.toFixed(4)),
      roughness: Number(m.roughness.toFixed(3)),
      metalness: Number(m.metalness.toFixed(3)),
    }));
  const fam = {};
  for (const f of rep.families) {
    fam[f.name] = { tileM: f.tileM, sizePx: f.sizePx,
      texelsPerM: f.tileM ? Number((f.sizePx / f.tileM).toFixed(1)) : null,
      repeat: f.repeat === null ? null : Number(f.repeat.toFixed(4)) };
  }
  // The claim in one boolean, so a reader does not have to re-derive it.
  const haft = rows.find((r) => r.label.includes('OF_Haft')) ?? null;
  const wrap = rows.find((r) => r.label.includes('OF_Rawhide')) ?? null;
  const ok = haft !== null && haft.family === 'timber' && haft.hasMap === true
    && haft.hasNormal === true && Math.abs(haft.repeat - 1 / 0.35) < 1e-3
    && wrap !== null && wrap.family === 'suitfab' && wrap.hasMap === true;
  return {
    valid: true, ok,
    why: ok ? 'the haft is on timber at 1/0.35 with its maps bound, and the '
      + 'wrap is on suitfab'
      : 'the haft or the wrap is NOT wearing what RN-1880 declared',
    haft, wrap, rows,
    families: { timber: fam.timber ?? null, bark: fam.bark ?? null,
      suitfab: fam.suitfab ?? null, suitplate: fam.suitplate ?? null },
    unknownRoles: rep.unknownRoles, mismatches: rep.mismatches,
    tableAgreesWithManifest: rep.tableAgreesWithManifest,
    vramMB: rep.vramMB,
  };
})()
