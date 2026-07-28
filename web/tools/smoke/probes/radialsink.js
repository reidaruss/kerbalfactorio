// radialsink.js: GP-150. EVIDENCE HAND-OFF TO THE PHYSICS LANE.
//
//   npx vite --config vite.probe.config.ts --port 5263 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5263/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/radialsink.js
//
// A SOLID BOOSTER STRAPPED TO A TANK DRAWS HALF INSIDE IT, on the shipped path,
// with nothing modified. Screenshot: docs/screenshots/GP150_radial_sink.png.
//
// THE MECHANISM, which is the useful half. `vessel.h::originFrom` places a
// radial child at `parent.diameterM * 0.5` along the outward normal, using ONLY
// THE PARENT'S RADIUS. `centroidOf` documents what that means: "Origin is on
// the mount plane; the body extends outward". So the convention is that a
// radial part's mesh is authored extending OUTWARD FROM ITS ORIGIN, and it
// holds for the fin, the solar panel, the RCS block, the landing leg and the
// vernier. It does NOT hold for the Solid Booster, which is also a stack part
// and is therefore authored around its own axis. Its origin is its axis, so
// mounting that origin on the parent's hull buries half of it.
//
// GP-116 recorded "a 1.25 m booster stands 0.15 m clear of a 1.25 m core". That
// is true of the mount PLANE and false of the MESH, and no number in that pass
// could have caught it because every number was about the plane.
//
// THIS PROBE ASSERTS THE DEFECT, DELIBERATELY, so it fails by name the day it
// is fixed and points at this file rather than going quietly green. That is the
// GP-146 pattern: a record of why something was ever like this, attached to the
// check that will prove it no longer is. WHOEVER FIXES IT: invert section 2,
// do not delete it.
//
// NOT THIS LANE'S TO FIX. `originFrom` is /core, and the question underneath it
// is an art-contract one (is a radial part's origin its mount plane or its
// axis?) before it is a code one. Routed by Admin to the physics lane together
// with the `radialOffsetM` field missing from `of_vs_transforms`, as one ABI
// bump with the per-part convention made an explicit declared property.
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
  const need = ['Fuel Tank (large) [S]', 'Radial Decoupler', 'Solid Booster',
                'Aero Fin', 'Solar Panel'];
  for (const n of need) check(`catalogue has ${n}`, by[n] !== undefined, n);
  // The dimensions come off the catalogue, never out of a literal in here.
  for (const n of need) {
    if (by[n] === undefined) continue;
    check(`${n} publishes a diameter`,
          mustNum(by[n], 'diameterM', n) > 0, `${by[n].diameterM}`);
  }
  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (n) => { of.vab('drop'); of.vab('take', by[n].index); await sleep(1); };

  const CORE = 'Fuel Tank (large) [S]';
  const coreR = by[CORE].diameterM * 0.5;

  /**
   * Strap `part` to the core, directly or through a radial decoupler, and
   * report where its own hull ends up relative to the core's.
   */
  const strap = async (part, viaPylon) => {
    await clear();
    await hold(CORE);
    if (!of.vab('place').ok) return { part, err: 'core refused' };
    await sleep(2);
    let mountName = part;
    if (viaPylon) mountName = 'Radial Decoupler';
    await hold(mountName);
    const ring = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen)
      .sort((a, b) => Math.abs(a.offsetM - 2.0) - Math.abs(b.offsetM - 2.0))[0];
    if (ring === undefined) return { part, err: 'no ring' };
    of.vab('hover', ring.ndc[0], ring.ndc[1]);
    await sleep(0.6);
    const r0 = of.vab('place');
    if (!r0.ok) return { part, viaPylon, refused: r0.report.message };
    await sleep(2);
    let rep = r0.report;
    if (viaPylon) {
      const dh = rep.parts[rep.parts.length - 1].handle;
      await hold(part);
      const pyl = of.vab('nodes').filter((n) => n.parent === dh)[0];
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
    // The inboard face of the strap-on, in the core's own radial coordinate.
    // Positive overlap means it is INSIDE the core hull.
    const inboardR = axisR - ownR;
    return {
      part, viaPylon,
      axisRadiusM: Number(axisR.toFixed(4)),
      ownRadiusM: Number(ownR.toFixed(4)),
      coreRadiusM: Number(coreR.toFixed(4)),
      inboardFaceR: Number(inboardR.toFixed(4)),
      overlapM: Number((coreR - inboardR).toFixed(4)),
      touchingWouldNeedAxisAtM: Number((coreR + ownR).toFixed(4)),
    };
  };

  // --- 1. the parts the convention IS true for: the positive control --------
  // A fin and a solar panel are authored extending outward from their origin,
  // so mounting the origin on the hull is correct for them and this probe must
  // NOT claim otherwise. If these ever start reading like the booster, the
  // convention has changed rather than the defect having spread.
  const fin = await strap('Aero Fin', false);
  const solar = await strap('Solar Panel', false);
  check('a fin straps on', fin.axisRadiusM !== undefined, JSON.stringify(fin));
  check('a solar panel straps on', solar.axisRadiusM !== undefined,
        JSON.stringify(solar));
  check('and both sit with their ORIGIN exactly on the core hull, which is the '
        + 'documented convention and is correct for a mesh authored outward',
        Math.abs(fin.axisRadiusM - coreR) < 1e-6
        && Math.abs(solar.axisRadiusM - coreR) < 1e-6,
        JSON.stringify({ fin: fin.axisRadiusM, solar: solar.axisRadiusM, coreR }));

  // --- 2. THE DEFECT. Invert this section when it is fixed, do not delete it.
  const boost = await strap('Solid Booster', true);
  check('a booster straps to a radial decoupler', boost.axisRadiusM !== undefined,
        JSON.stringify(boost));
  check('its axis sits at the pylon offset GP-116 measured',
        Math.abs(boost.axisRadiusM - 0.775) < 1e-3, `${boost.axisRadiusM}`);
  check('THE BOOSTER HULL IS INSIDE THE CORE HULL. This is the defect. When it '
        + 'is fixed, this check fails and section 2 gets inverted, not deleted',
        boost.overlapM > 0.4,
        `overlap ${boost.overlapM} m: inboard face at r=${boost.inboardFaceR} `
        + `inside a core of radius ${boost.coreRadiusM}`);
  check('and touching rather than intersecting would need the axis further out',
        boost.touchingWouldNeedAxisAtM > boost.axisRadiusM,
        `${boost.touchingWouldNeedAxisAtM} against ${boost.axisRadiusM}`);

  // The picture, on request, because the numbers above are the case and the
  // picture is what makes anyone believe it. Off by default so an ordinary run
  // does not carry a megabyte of base64:
  //   --evalargs='{"shot":1}' | node tools/smoke/writeshot.mjs <out.png>
  let png = null;
  if (OF_ARGS.shot) {
    await clear();
    await hold(CORE);
    of.vab('place');
    await sleep(2);
    await hold('Radial Decoupler');
    const ring = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen)
      .sort((a, b) => Math.abs(a.offsetM - 2.0) - Math.abs(b.offsetM - 2.0))[0];
    if (ring !== undefined) {
      of.vab('hover', ring.ndc[0], ring.ndc[1]);
      await sleep(0.6);
      const d = of.vab('place');
      await sleep(2);
      const dh = d.report.parts[d.report.parts.length - 1].handle;
      await hold('Solid Booster');
      const pyl = of.vab('nodes').filter((n) => n.parent === dh)[0];
      if (pyl !== undefined) {
        of.vab('hover', pyl.ndc[0], pyl.ndc[1]);
        await sleep(0.6);
        of.vab('place');
        await sleep(2);
      }
    }
    // Hand emptied, so the node cage and the ghost are not in the picture and
    // what is left is the geometry the claim is about.
    of.vab('drop');
    await sleep(2);
    png = document.querySelector('canvas').toDataURL('image/png');
  }

  return {
    valid: fails.length === 0,
    fails,
    png,
    log: [{ correctByConvention: [fin, solar], defect: boost,
            note: 'overlapM > 0 means the strap-on is inside the core hull' }],
    note: 'GP-150. `originFrom` uses only the PARENT radius, which is correct '
      + 'for a mesh authored outward from its origin (fin, solar, RCS, leg, '
      + 'vernier) and wrong for one authored around its own axis (the Solid '
      + 'Booster, which is also a stack part). Routed to the physics lane with '
      + 'the missing `radialOffsetM` field as one ABI bump. Section 2 asserts '
      + 'the defect ON PURPOSE so the fix fails it by name.',
  };
})()
