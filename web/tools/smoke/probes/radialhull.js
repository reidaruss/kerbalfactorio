// radialhull.js: PH-81. A STRAP-ON NO LONGER DRAWS INSIDE THE PART IT IS
// STRAPPED TO, measured on the shipped path with nothing stubbed.
//
//   npx vite --config vite.probe.config.ts --port 5509 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5509/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/radialhull.js
//
// WHAT THIS REPLACES. `probes/radialsink.js` (GP-150) asserts the DEFECT on
// purpose, so that the day it is fixed it fails by name and points at itself.
// This file is the other half of that hand-off: the same measurement, with the
// sign of the claim inverted, taken through the same driven bay.
//
// THE DEFECT, in one line. `vessel.h::originFrom` placed a radial child at
// `parent.diameterM * 0.5` along the outward normal, using ONLY THE PARENT'S
// RADIUS, so the child's ORIGIN landed on the parent's hull. That is correct
// when the origin means the child's inboard MOUNT PLANE, which is how a fin, a
// solar panel, an RCS block, a landing leg, a vernier and the radial decoupler
// are authored (ASSET-SPECS §3.3, `socket_radial_mount` at local (0,0,0)). It
// is wrong when the origin means the child's own AXIS, which is how the Solid
// Booster is authored, because the same mesh must also serve stack mounting
// (§3.3 gives it `socket_radial_attach (-0.625, 3.00, 0)`, a point on its OWN
// hull). Measured before the fix: axis at r = 0.775 m carrying a 0.625 m
// radius against a 0.625 m core, i.e. 0.475 m of interpenetrating cylinders.
//
// THE FIX IS A DECLARATION AND NOT A DERIVATION. `PartDef::radialOrigin` is
// REQUIRED (it is the struct's only constructor parameter and there is no
// default constructor, so every authored row had to answer), and `originFrom`
// and `centroidOf` branch on it. No rule about part class or mesh shape could
// have separated the booster from the fin, because the booster is a stack part,
// an engine and a radial part at the same time.
//
// WHAT IS MEASURED, AND WHY IT IS A SUBTRACTION. The subject is the GAP between
// two hulls along the outward normal:
//
//     gap = |origin_xz(child)| - R(parent) - R(child)
//
// Negative means the two cylinders occupy the same space, which is the whole
// complaint and is the one reading that cannot be produced by a camera, a
// material, a missing mesh or a cull. Every radius comes off `vab('catalogue')`
// and every position off `vab('report').parts[].origin`, which is /core's own
// published layout, so nothing here is recomputed out of the assumption it is
// checking (standing rule 11).
//
// THE MOUNT-PLANE PARTS ARE THE POSITIVE CONTROL AND THEY MUST NOT MOVE. A fin
// and a solar panel were never what was broken. If their origins stop sitting
// exactly on the host hull, the convention changed rather than the defect being
// fixed, and this probe says so by name.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const cat = of.vab('catalogue');
  const by = {};
  for (const c of cat) by[c.name] = c;
  const CORE = 'Fuel Tank (large) [S]';
  const need = [CORE, 'Radial Decoupler', 'Solid Booster', 'Aero Fin',
                'Solar Panel'];
  for (const n of need) check(`catalogue has ${n}`, by[n] !== undefined, n);
  if (fails.length > 0) return { valid: false, fails, log: [] };
  // Every dimension comes off the catalogue. There is no literal radius here.
  for (const n of need) {
    check(`${n} publishes a diameter`, by[n].diameterM > 0, `${by[n].diameterM}`);
  }
  const coreR = by[CORE].diameterM * 0.5;

  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (n) => { of.vab('drop'); of.vab('take', by[n].index); await sleep(1); };

  /**
   * Strap `part` to the core, directly on the hull or through a radial
   * decoupler, and report where its own hull ends up relative to the core's.
   */
  const strap = async (part, viaPylon) => {
    await clear();
    await hold(CORE);
    if (!of.vab('place').ok) return { part, err: 'core refused' };
    await sleep(2);
    await hold(viaPylon ? 'Radial Decoupler' : part);
    const ring = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen)
      .sort((a, b) => Math.abs(a.offsetM - 2.0) - Math.abs(b.offsetM - 2.0))[0];
    if (ring === undefined) return { part, err: 'no ring' };
    of.vab('hover', ring.ndc[0], ring.ndc[1]);
    await sleep(0.6);
    const r0 = of.vab('place');
    if (!r0.ok) return { part, viaPylon, refused: r0.report.message };
    await sleep(2);
    let rep = r0.report;
    let pylonRow = null;
    if (viaPylon) {
      pylonRow = rep.parts[rep.parts.length - 1];
      await hold(part);
      const pyl = of.vab('nodes').filter((n) => n.parent === pylonRow.handle)[0];
      if (pyl === undefined) return { part, err: 'no pylon node' };
      of.vab('hover', pyl.ndc[0], pyl.ndc[1]);
      await sleep(0.6);
      const r1 = of.vab('place');
      if (!r1.ok) return { part, viaPylon, refused: r1.report.message };
      await sleep(2);
      rep = r1.report;
    }
    const p = rep.parts[rep.parts.length - 1];
    const axisR = Math.hypot(p.origin[0], p.origin[2]);
    const ownR = by[part].diameterM * 0.5;
    return {
      part, viaPylon,
      axisRadiusM: Number(axisR.toFixed(6)),
      ownRadiusM: Number(ownR.toFixed(6)),
      coreRadiusM: Number(coreR.toFixed(6)),
      // POSITIVE means clear air between the two hulls. NEGATIVE means the two
      // cylinders are inside one another, which is the defect.
      gapM: Number((axisR - coreR - ownR).toFixed(6)),
      radialOffsetM: p.radialOffsetM,
      // RAW, not rounded. Rounding this to six places and then comparing it to
      // the published value at 1e-9 is a check that can only fail, which is how
      // this line read on its first run.
      mountedAtM: ring.offsetM,
      pylonOriginY: pylonRow === null ? null : pylonRow.origin[1],
    };
  };

  // --- 1. the positive control: mount-plane parts have NOT moved -----------
  const fin = await strap('Aero Fin', false);
  const solar = await strap('Solar Panel', false);
  check('a fin straps on', fin.axisRadiusM !== undefined, JSON.stringify(fin));
  check('a solar panel straps on', solar.axisRadiusM !== undefined,
        JSON.stringify(solar));
  check('a MOUNT-PLANE part still sits with its ORIGIN exactly on the core '
        + 'hull. These were never broken and a fix that moved them would be a '
        + 'second defect wearing the first one\'s clothes',
        Math.abs(fin.axisRadiusM - coreR) < 1e-9
        && Math.abs(solar.axisRadiusM - coreR) < 1e-9,
        JSON.stringify({ fin: fin.axisRadiusM, solar: solar.axisRadiusM, coreR }));

  // --- 2. THE FIX. A booster flush on the hull, and one on a pylon ---------
  const flush = await strap('Solid Booster', false);
  check('a booster straps straight to a hull', flush.axisRadiusM !== undefined,
        JSON.stringify(flush));
  check('AND ITS HULL DOES NOT ENTER THE CORE HULL. This is the claim. Before '
        + 'PH-81 the same measurement read -0.625 m, which is the booster '
        + 'buried to its own centreline',
        flush.gapM >= 0, `gap ${flush.gapM} m`);
  check('a flush strap-on is EXACTLY flush: the two hulls touch, to f64, '
        + 'because the axis is placed at parentR + childR and nothing rounds',
        Math.abs(flush.gapM) < 1e-9, `gap ${flush.gapM} m`);
  check('so its axis sits at the sum of the two radii',
        Math.abs(flush.axisRadiusM - (coreR + flush.ownRadiusM)) < 1e-9,
        `${flush.axisRadiusM} against ${coreR + flush.ownRadiusM}`);

  const pylon = await strap('Solid Booster', true);
  check('a booster straps to a radial decoupler', pylon.axisRadiusM !== undefined,
        JSON.stringify(pylon));
  check('AND IT TOO CLEARS THE CORE HULL. This read -0.475 m before PH-81, '
        + 'with the booster axis at r = 0.775 m inside a 0.625 m core',
        pylon.gapM >= 0, `gap ${pylon.gapM} m`);
  check('the pylon holds it OFF the hull rather than merely on it, so a strap-on '
        + 'through a decoupler stands further out than a flush one',
        pylon.axisRadiusM > flush.axisRadiusM,
        `${pylon.axisRadiusM} against ${flush.axisRadiusM}`);

  // --- 3. ITEM 2: the row now describes a radial placement on its own ------
  // `of_vs_transforms` publishes `radialOffsetM` as word 8 (ABI 20). Before it,
  // the client subtracted two origins to recover the value it had itself passed
  // to `attach`, which was exact and left the row unable to say where a part was
  // mounted without also holding its parent's row.
  check('a radial part publishes its own radialOffsetM',
        typeof fin.radialOffsetM === 'number', `${fin.radialOffsetM}`);
  check('and it is the height the node was aimed at, not zero and not re-derived',
        Math.abs(fin.radialOffsetM - fin.mountedAtM) < 1e-9,
        `published ${fin.radialOffsetM} against node ${fin.mountedAtM}`);
  check('the booster on a pylon rides at the pylon\'s own height, which is '
        + 'offset 0 from a parent that is itself already up the core',
        pylon.radialOffsetM === 0 || Math.abs(pylon.radialOffsetM) < 1e-9,
        `${pylon.radialOffsetM}`);

  return {
    valid: fails.length === 0,
    fails,
    log: [{ control: [fin, solar], flush, pylon,
            note: 'gapM < 0 means the strap-on is inside the core hull' }],
    note: 'PH-81. `PartDef::radialOrigin` is a REQUIRED declaration: MountPlane '
      + '(origin is the inboard face, body outward) or Axis (origin is the '
      + 'part\'s own centreline, because the mesh also serves stack mounting). '
      + '`originFrom` and `centroidOf` branch on it instead of assuming '
      + 'mount-plane semantics. Item 2 of the same ABI 20 bump appends '
      + '`radialOffsetM` to the transforms row. This probe is the inverse of '
      + 'probes/radialsink.js, which asserts the defect on purpose.',
  };
})()
