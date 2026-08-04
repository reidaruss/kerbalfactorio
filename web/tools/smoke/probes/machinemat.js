// RN-1200: THE MACHINE'S MATERIAL RESPONSE, CLOSE ENOUGH TO JUDGE IT.
//
// WHY A NEW PROBE RATHER THAN `factoryshot.js`. That probe frames the whole set
// from 18.19 m so the arrangement reads as one set, which is what FS-73 needed
// and is the wrong instrument for this. Measured on its frame, the machine box
// carries a MEDIAN LUMINANCE OF 12 COUNTS out of 255: the visible faces are the
// shadowed side of a smelter, and INSTRUMENTS.md's "a term measured only where
// it cannot work reports its own absence" is exactly what a null there would
// mean. A material response has to be measured where there is light on the
// material.
//
// SO THIS ONE STANDS CLOSE AND PINS THE SUN. One smelter and one belt tile,
// placed by the same ghost-and-press path a player uses, then the camera walks
// in to a few metres and aims at the machine. The belt is not decoration: its
// deck is the `Rubber` role (0.00 / 0.85) against the smelter's `Steel` (0.85 /
// 0.45) and `Accent` (0.00 / 0.50), so one frame contains roles that must move
// in DIFFERENT DIRECTIONS. A frame with only Steel in it could not tell a
// per-role channel from a uniform darkening.
//
// THE SUN IS PINNED AND THE MISS IS ASSERTED. `setSunElev` scans 720 phases and
// returns the closest, so an unreachable target comes back as the site's
// maximum WITH NO COMPLAINT (its own comment says so). This refuses on `err`
// rather than photographing whatever the solver could reach under a filename
// that claims otherwise, which is RN-1002's lesson. It is re-pinned immediately
// before the settle because `of.run` drifts it.
//
// WHAT IT RETURNS AND WHY EACH FIELD IS THERE. `placed` and `standoffM` are the
// SETUP assertion (DW-20): a frame taken after nothing was placed, or from
// across the clearing, is a photograph of a claim nobody tested. `sunErr` is
// the pin. `machineMat` and `distinct` are the channel's own read-out, so one
// run says both what was drawn and what the shader was given: `distinct` is 0
// under `?machinemat=0`, exactly 1 under `?machinemat=flat` and many under the
// shipped default, which is three states told apart by one number.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const eye = () => of.aim().origin;
  const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fac = () => of.game().factory;

  // A mid-elevation sun, not noon. A machine's screen area is mostly VERTICAL
  // faces, and an overhead sun grazes every one of them: the 0.85 sweep left
  // the machine box at a median of 13.7 counts while lifting the GROUND from 67
  // to 105, which is the shape of a light that is missing the subject.
  const SUN = Number(OF_ARGS.sun ?? 0.45);
  await sleep(0.6);
  let sun = of.setSunElev(SUN);
  if (sun.err > 0.02) {
    return { fail: 'the sun would not pin', want: SUN, got: sun.gotDot, err: sun.err };
  }

  const yaw0 = of.world().observer.yawDeg;
  const ghostAt = async (y, p) => { of.look(y, p); await sleep(0.035); return of.build().ghost; };
  const press = async () => {
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
    await sleep(0.16);
  };
  // Place one kind at the first legal cell in a pitch sweep, and REPORT whether
  // the building count actually rose. `of.build()` returning a ghost with
  // `ok: true` is a claim about the placement rules; the count is the fact.
  const put = async (kind, from, to) => {
    for (let p = from; p >= to; p -= 0.3) {
      const g = await ghostAt(yaw0, p);
      if (g === null || !g.ok) continue;
      const before = fac().buildings;
      await press();
      if (fac().buildings > before) return { pos: g.pos, cell: g.cell, pitch: p };
    }
    return null;
  };

  of.build(3);
  const smelter = await put('smelter', -14, -46);
  if (smelter === null) return { fail: 'the smelter would not go down', log };
  log.push(`smelter ${smelter.cell}`);

  of.build(2);
  const belt = await put('belt', smelter.pitch + 4, -12);
  if (belt !== null) log.push(`belt ${belt.cell}`);
  of.build(0);
  await sleep(0.3);

  // Walk in. The stop is a DISTANCE, re-checked each burst against the
  // machine's own reported position, not a fixed number of bursts.
  const target = smelter.pos;
  let closest = gd(eye(), target);
  for (let i = 0; i < 24; ++i) {
    const d = gd(eye(), target);
    if (d < Number(OF_ARGS.standoff ?? 6.0)) break;
    if (d < closest) closest = d;
    of.look(yaw0, -6);
    of.input.tape([{ hold: 30, keys: ['KeyW'] }]);
    await sleep(0.6);
  }
  // WALK PAST AND LOOK BACK, when asked. A player places a machine in FRONT of
  // themselves and then approaches it, so the face this probe first sees is the
  // one turned away from a rising sun: swept over the whole reachable elevation
  // band at this site the near face only ever reaches a mean of 12.24 counts of
  // 255, monotonically, i.e. it is lit by sky and bounce alone at every hour.
  // That is a property of the APPROACH, not of the site, and the fix is to
  // stand on the other side rather than to keep raising the sun.
  const past = Number(OF_ARGS.past ?? 0);
  for (let i = 0; i < past; ++i) {
    of.look(yaw0, -6);
    of.input.tape([{ hold: 30, keys: ['KeyW'] }]);
    await sleep(0.6);
  }
  of.input.tape([{ hold: 2, keys: [] }]);
  await sleep(0.3);

  // Aim at the machine, by MISS DISTANCE to its reported centre rather than by
  // brightness. A camera chosen by how bright the subject came out is a
  // classifier that depends on the very quantity under test.
  const missTo = (y, p) => {
    of.look(y, p);
    const a = of.aim();
    const e = a.origin;
    const v = [target[0] - e[0], target[1] - e[1], target[2] - e[2]];
    const t = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
    return t <= 0 ? Infinity
      : Math.hypot(v[0] - a.dir[0] * t, v[1] - a.dir[1] * t, v[2] - a.dir[2] * t);
  };
  let by = yaw0;
  let bp = -6;
  for (const step of [16, 4, 1]) {
    let bm = Infinity;
    let ny = by;
    let np = bp;
    for (let k = -8; k <= 8; ++k) {
      for (const dp of [2, -2, -6, -10, -16]) {
        const m = missTo(by + k * step, dp);
        if (m < bm) { bm = m; ny = by + k * step; np = dp; }
      }
    }
    by = ny; bp = np;
  }
  of.look(by, bp);
  // RE-PIN. `of.run` drifts a pinned sun, and everything above it ran the sim
  // for tens of seconds. Pinning at the top and photographing at the bottom
  // would be a control that stopped holding halfway through its own procedure.
  sun = of.setSunElev(SUN);
  await sleep(1.2);

  const f = fac();
  const mm = self.__ofMachineMat.state();
  const tb = self.__ofMachineMat.table();
  return {
    valid: f.buildings >= 1 && mm.mode !== undefined,
    placed: f.buildings, kinds: f.list.map((b) => b.kind),
    standoffM: +gd(eye(), target).toFixed(2),
    yawDeg: +by.toFixed(2), pitchDeg: bp,
    sunWant: SUN, sunGot: sun.gotDot, sunErr: sun.err,
    machineMat: { mode: mm.mode, flagPresent: mm.flagPresent, baked: mm.baked,
      bare: mm.bare, bareOn: mm.bareOn },
    distinct: tb.distinct, injections: tb.injections, missingAnchors: tb.missing,
    log,
  };
})()
