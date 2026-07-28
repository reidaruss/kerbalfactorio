// vabround.js: GP-142. A DESIGN SURVIVES SAVE AND LOAD WHERE THE PLAYER PUT IT.
//
//   npx vite --config vite.probe.config.ts --port 5261 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5261/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabround.js
//
// `VesselDesign.toJson` wrote `off: 0` as a literal for every part, so
// `radialOffsetM`, the one number that says WHERE ALONG THE HULL a strap-on
// sits, was never serialised. Measured on the shipped build: a radial decoupler
// placed 2.8571 m up a 4 m tank, carrying a solid booster on its pylon, came
// back from a save and a load with both parts at y = 0. Each had moved 2.8571 m
// down the rocket. `fromJson` had always read `row.off ?? 0` correctly.
//
// WHY THIS WAS NOT CAUGHT BY THE EXISTING PROBES, which is the reusable part:
// GP-116 authored the pylon at OFFSET 0 and every strap-on probe since has gone
// through it, so the whole radial path was exercised at the single value where
// a total loss is invisible. The fixture chose the one input that cannot fail.
//
// This probe therefore places the decoupler MID-HULL on purpose and asserts the
// offset it measures is not near zero BEFORE it asserts the round trip, so a
// future change that quietly moves the fixture back to the base cannot make
// this go green by removing the thing under test.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const PID = { TankSLong: 0x0102, SolidBooster: 0x0105, DecouplerRadial: 0x0107,
                EngineS: 0x0103 };
  const cat = of.vab('catalogue');
  const idx = {};
  for (const k of Object.keys(PID)) {
    const r = cat.find((x) => x.id === PID[k]);
    idx[k] = r === undefined ? -1 : r.index;
    check(`catalogue has ${k}`, idx[k] >= 0, `PartId 0x${PID[k].toString(16)}`);
  }
  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (p) => { of.vab('drop'); of.vab('take', idx[p]); await sleep(1); };

  // --- build: tank, a radial decoupler HALF WAY UP IT, a booster on the pylon
  await clear();
  await hold('TankSLong');
  check('the tank starts the stack', of.vab('place').ok === true);
  await sleep(2);
  await hold('EngineS');
  {
    const b = of.vab('nodes').filter((n) => n.kind === 'bottom')[0];
    check('the tank offers a bottom face', b !== undefined);
    if (b !== undefined) {
      of.vab('hover', b.ndc[0], b.ndc[1]);
      await sleep(0.5);
      check('an engine goes under it', of.vab('place').ok === true);
    }
  }
  await sleep(2);
  await hold('DecouplerRadial');
  const ring = of.vab('nodes').filter((n) => n.kind === 'radial' && n.onScreen)
    .sort((a, b) => Math.abs(a.offsetM - 2.6) - Math.abs(b.offsetM - 2.6))[0];
  check('a mid-hull radial mount exists', ring !== undefined);
  // THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR. A ring at offset 0 would make
  // every check below pass against the defect this probe exists for.
  check('and it is NOT at the base, which is where this defect hides',
        ring !== undefined && ring.offsetM > 1.5,
        `offset ${ring === undefined ? 'none' : ring.offsetM.toFixed(4)} m`);
  if (ring !== undefined) { of.vab('hover', ring.ndc[0], ring.ndc[1]); await sleep(1); }
  const dec = of.vab('place');
  check('the radial decoupler goes on', dec.ok === true, dec.report.message);
  await sleep(2);
  const decHandle = dec.ok ? dec.report.parts[dec.report.parts.length - 1].handle : -1;
  await hold('SolidBooster');
  const pyl = of.vab('nodes').filter((n) => n.parent === decHandle)[0];
  check('the decoupler publishes its pylon', pyl !== undefined,
        `no node with parent ${decHandle}`);
  if (pyl !== undefined) { of.vab('hover', pyl.ndc[0], pyl.ndc[1]); await sleep(1); }
  check('a booster straps to it', of.vab('place').ok === true);
  await sleep(2);

  // --- the round trip -------------------------------------------------------
  // Compared on the GEOMETRY and the TOPOLOGY, never on raw handles: a rebuild
  // allocates fresh handles by design (`nextHandle_` never rewinds), so a
  // handle comparison would fail for a reason that is not a defect.
  const shape = () => {
    const rep = of.vab('report');
    const at = new Map();
    rep.parts.forEach((p, i) => at.set(p.handle, i));
    return rep.parts.map((p) => ({
      id: p.partId, attach: p.attach,
      parentIndex: p.parent < 0 ? -1 : (at.get(p.parent) ?? -2),
      origin: p.origin.map((v) => Number(v.toFixed(6))),
    }));
  };
  const before = shape();
  check('four parts were built', before.length === 4, `${before.length}`);
  of.vab('save', 'vabround');
  await sleep(2);
  await clear();
  check('the bay really was emptied', of.vab('report').parts.length === 0,
        `${of.vab('report').parts.length} parts after clear`);
  of.vab('load', 'vabround');
  await sleep(3);
  const after = shape();

  check('every part came back', after.length === before.length,
        `${after.length} of ${before.length}`);
  const moved = [];
  for (let i = 0; i < Math.min(before.length, after.length); ++i) {
    const b = before[i], a = after[i];
    const d = Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1],
                         a.origin[2] - b.origin[2]);
    if (d > 1e-9) moved.push({ i, id: b.id, movedM: Number(d.toFixed(4)),
                               from: b.origin, to: a.origin });
  }
  check('NOTHING MOVED, which is the whole defect: radial parts slid to y = 0',
        moved.length === 0, JSON.stringify(moved));
  check('and the tree came back the same shape',
        JSON.stringify(after.map((p) => [p.id, p.attach, p.parentIndex]))
        === JSON.stringify(before.map((p) => [p.id, p.attach, p.parentIndex])),
        JSON.stringify({ before: before.map((p) => p.parentIndex),
                         after: after.map((p) => p.parentIndex) }));
  // Two-sided: the offset that was lost is the one that must now be present, so
  // assert its VALUE and not merely that the two runs agree. Two identical
  // zeroes would satisfy a comparison and would be the bug.
  const radial = after.filter((p) => p.attach === 3);
  check('a radial part is still up the hull where it was put',
        radial.length > 0 && radial.every((p) => p.origin[1] > 1.5),
        JSON.stringify(radial.map((p) => p.origin)));
  log.push({ ringOffsetM: ring === undefined ? null : Number(ring.offsetM.toFixed(4)),
             before, after, moved });

  return {
    valid: fails.length === 0,
    fails,
    log,
    note: 'GP-142: toJson re-derives radialOffsetM from the origins /core '
      + 'publishes (vessel.h originFrom puts a radial child at parent.y + off), '
      + 'rather than writing the literal 0 it used to. Before this, saving and '
      + 'loading moved every strap-on 2.8571 m down the rocket.',
  };
})()
