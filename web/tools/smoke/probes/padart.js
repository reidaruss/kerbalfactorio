// THE LAUNCH PAD, FROM A PLAYER'S EYE, ON THE D3D PATH. The framing half of
// the RN-1690 form pass, and the only receipt in that pass taken in the actual
// renderer rather than in Cycles.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//     --evalfile=tools/smoke/probes/padart.js \
//     --evalargs='{"shot":"deck"}' --out=docs/screenshots/RN1690_pad_d3d_deck.png
//
// WHY IT IS NOT `probes/pad.js --out`. `pad.js` is the acceptance gate: it
// ends after a lift-off, with the camera wherever the flight left it and the
// vessel gone. A picture taken there is a picture of the sky. This probe does
// the one thing pad.js does that a photograph needs - lay a 6 x 6 platform and
// put a pad on it - and then STOPS, frames, and hands the frame to run.mjs's
// own --out capture, which is `artshot.js`'s arrangement exactly.
//
// WHY IT IS NOT A CYCLES RENDER EITHER, since `render_launch_pad.py` already
// makes eight of those. ART-CAMPAIGN-2026-08-13's binding platform rule: every
// frame judged for LOOK is taken on the Windows D3D path, because Cycles
// answers "is the geometry right" and the client answers "does it read". They
// disagree about exactly the things a form pass changes - the shipped IBL, the
// PCF shadows, the post chain, and the tiling maps at their shipped resolution
// rather than a preview's.
//
// `shot` picks the framing and nothing else, so two runs differ only by the
// build under them:
//   walk   30 m off the south-east corner at eye height, the approach read
//   close  18 m off the same corner, the deck-furniture read
//   high   15 m up and 45 m out, the arrangement read
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const sleep = (n) => of.run(n);
  const log = [];
  const D = 180 / Math.PI;
  const latDeg = (y, r) => Math.asin(Math.max(-1, Math.min(1, y / (r || 1)))) * D;

  const hideUi = () => {
    // AT THE END AND NOT ON ENTRY. The build prompt, the hotbar and the
    // objective panel are created as the probe uses them, so a sweep run
    // before the first placement hides an empty document.
    //
    // AND IT HIDES EVERYTHING THAT DOES NOT CONTAIN THE CANVAS rather than
    // walking the canvas's own ancestor chain hiding siblings, which is what
    // `artshot.js` does and what left the GETTING STARTED panel in the first
    // three frames of this pass: that walk only reaches nodes that happen to
    // be siblings at some level of the chain, and this HUD is not one.
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const keep = canvases.reduce((a, c) => (
      a === null || c.clientWidth * c.clientHeight > a.clientWidth * a.clientHeight
        ? c : a), null);
    if (keep === null) return;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el !== keep && !el.contains(keep) && el.tagName !== 'CANVAS') {
        el.style.display = 'none';
      }
    }
  };

  // AN EMPTY HAND FOR THE PHOTOGRAPH. A placeable still in hand draws its
  // GHOST at the crosshair, and the launch pad's ghost is a translucent 24 m
  // block: the first framed attempt came back with the whole scene behind an
  // orange 24 x 24 x 28 m box. The hotbar is cycled to a slot the build
  // system does not ghost, which is any slot that is not a structure.
  const emptyHand = async () => {
    const parts = bar().slots.map((sl) => sl.part);
    const PLACEABLE = new Set(['foundation', 'launchpad', 'wall', 'floor',
      'door', 'pillar']);
    let i = parts.findIndex((q) => q === null || q === undefined);
    if (i < 0) i = parts.findIndex((q) => !PLACEABLE.has(q));
    if (i < 0) return;
    await hold(i);
  };

  await sleep(1.0);
  if (of.game().mode.sandbox !== true) {
    return { valid: false, why: 'padart needs --sandbox=1' };
  }
  of.setTime(A.sunT ?? 0.30);

  // -- the aim helpers, lifted from probes/pad.js because they are the same
  //    problem: point the crosshair at a body-frame point through an observer
  //    whose yaw origin is not the ray's.
  const aimRay = () => of.world().player.aim;
  const horizAngle = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    const u = [o[0] / r, o[1] / r, o[2] / r];
    const k = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = [d[0] - u[0] * k, d[1] - u[1] * k, d[2] - u[2] * k];
    const e = [-u[1], u[0], 0];
    const el = Math.hypot(e[0], e[1], e[2]) || 1;
    const ex = [e[0] / el, e[1] / el, e[2] / el];
    const nx = [u[1] * ex[2] - u[2] * ex[1], u[2] * ex[0] - u[0] * ex[2],
      u[0] * ex[1] - u[1] * ex[0]];
    return Math.atan2(h[0] * ex[0] + h[1] * ex[1] + h[2] * ex[2],
      h[0] * nx[0] + h[1] * nx[1] + h[2] * nx[2]) * D;
  };
  const pitchOf = (o, d) => {
    const r = Math.hypot(o[0], o[1], o[2]) || 1;
    return Math.asin(Math.max(-1, Math.min(1,
      (d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / r))) * D;
  };
  let yawOffset = 0;
  {
    const a = aimRay();
    yawOffset = of.world().observer.yawDeg - horizAngle(a.origin, a.dir);
  }
  const aimAt = async (p) => {
    for (let i = 0; i < 2; ++i) {
      const a = aimRay();
      const d = [p.x - a.origin[0], p.y - a.origin[1], p.z - a.origin[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const r0 = Math.hypot(a.origin[0], a.origin[1], a.origin[2]) || 1;
      const up0 = [a.origin[0] / r0, a.origin[1] / r0, a.origin[2] / r0];
      const vert0 = d[0] * up0[0] + d[1] * up0[1] + d[2] * up0[2];
      const horiz = Math.hypot(d[0] - up0[0] * vert0, d[1] - up0[1] * vert0,
        d[2] - up0[2] * vert0);
      if (horiz < 0.5) {
        of.look(of.world().observer.yawDeg, -82); await sleep(1 / 60); continue;
      }
      const u = [d[0] / l, d[1] / l, d[2] / l];
      of.look(horizAngle(a.origin, u) + yawOffset,
        Math.max(-82, Math.min(82, pitchOf(a.origin, u))));
      await sleep(1 / 60);
    }
  };

  const st = of.structures();
  const pads = of.pads();
  if (st === null || pads === null) return { valid: false, why: 'no structures/pads' };
  const CELLS = pads.cells(st.module.cellM);
  const bar = () => of.game().hotbar;
  const slotOf = (part) => bar().slots.findIndex((s) => s.part === part);
  const hold = async (i) => { of.input.act([`slot${i + 1}`], 4); await sleep(0.25); };

  // -- the platform, then the pad. Same sequence as probes/pad.js, minus every
  //    assertion: this probe is not the gate and must not pretend to be one.
  await hold(slotOf('foundation'));
  of.look(of.world().observer.yawDeg, -34);
  await sleep(0.2);
  of.input.act(['use'], 4);
  await sleep(0.35);
  if (st.sites.length < 1) return { valid: false, why: 'no site founded' };
  const site = st.sites[st.sites.length - 1];
  const C = st.module.cellM;
  const cellPoint = (i, j) => ({
    x: site.o.x + site.east.x * (i + 0.5) * C + site.north.x * (j + 0.5) * C,
    y: site.o.y + site.east.y * (i + 0.5) * C + site.north.y * (j + 0.5) * C,
    z: site.o.z + site.east.z * (i + 0.5) * C + site.north.z * (j + 0.5) * C,
  });
  const first = of.game().structures.parts.find((p) => p.kind === 'foundation');
  const base = first?.addr ?? [0, 0, 0];
  const HALF = Math.floor(CELLS / 2);
  const i0 = base[0] - HALF;
  const j0 = base[1] - HALF;
  const laidAt = (i, j) => of.game().structures.parts.some((q) =>
    q.kind === 'foundation' && q.addr !== null
    && q.addr[0] === i && q.addr[1] === j && q.addr[2] === 0);
  for (let pass = 0; pass < 60; ++pass) {
    let gap = null;
    for (let di = 0; di < CELLS && gap === null; ++di) {
      for (let dj = 0; dj < CELLS && gap === null; ++dj) {
        if (!laidAt(i0 + di, j0 + dj)) gap = [i0 + di, j0 + dj];
      }
    }
    if (gap === null) break;
    const c = cellPoint(gap[0], gap[1]);
    // Stand back 3 m along the site's own north before aiming, which is
    // GP-920's fix: aiming from directly on top of the target pushes the
    // pitch solve past its clamp and resolves a cell over.
    const s = { x: c.x - site.north.x * 3, y: c.y - site.north.y * 3,
      z: c.z - site.north.z * 3 };
    const cr = Math.hypot(s.x, s.y, s.z) || 1;
    of.teleport(latDeg(s.y, cr), Math.atan2(s.z, s.x) * D, 0);
    await sleep(0.35);
    await aimAt(c);
    of.input.act(['use'], 3);
    await sleep(1 / 20);
    if (!laidAt(gap[0], gap[1])) break;
  }
  const blocked = of.game().structures.parts.filter((p) => p.kind === 'foundation'
    && p.addr !== null && p.addr[0] >= i0 && p.addr[0] < i0 + CELLS
    && p.addr[1] >= j0 && p.addr[1] < j0 + CELLS && p.addr[2] === 0);
  log.push(`platform: ${blocked.length} of ${CELLS * CELLS}`);

  await hold(slotOf('launchpad'));
  const c0 = cellPoint(base[0], base[1]);
  const s0 = { x: c0.x - site.north.x * 8, y: c0.y - site.north.y * 8,
    z: c0.z - site.north.z * 8 };
  const r0 = Math.hypot(s0.x, s0.y, s0.z) || 1;
  of.teleport(latDeg(s0.y, r0), Math.atan2(s0.z, s0.x) * D, 0);
  await sleep(0.4);
  await aimAt(c0);
  of.input.act(['use'], 4);
  await sleep(0.6);
  const pad = of.pads().list[0] ?? null;
  log.push(`pads: ${of.pads().list.length}`);
  if (pad === null) return { valid: false, why: 'no pad placed', log };

  // -- frame it. TWO THINGS THE FIRST TWO EMPTY FRAMES TAUGHT.
  //
  // (1) THE CAMERA STANDS ON THE GROUND OFF THE PLATFORM AND NOT ON THE DECK.
  //     `of.teleport` takes a latitude, a longitude and a height above the
  //     SURFACE, so a position computed in body-frame metres survives only as
  //     a DIRECTION: the radial part is thrown away and replaced by the height
  //     argument. Asking for the pad deck put the eye 2 m above the terrain,
  //     which is underneath a 6 x 6 platform. Standing off the platform makes
  //     the height argument mean what it says, and it is also the read that
  //     matters: this thing is 24 m across and the question is what it looks
  //     like walking up to it.
  // (2) THE FRAME IS DERIVED FROM THE SITE'S OWN CELL GRID, NOT FROM THE PAD
  //     RECORD. `of.pads().list[]`'s `pos` is not the [x, y, z] array it looks
  //     like in a report dump, so `P[0]` read undefined, every offset came out
  //     NaN, and `of.teleport` put the observer at latitude 90 with a null
  //     longitude. `cellPoint` is the function the placement itself aimed
  //     through, so its frame is proven by the 36 foundations that went down.
  const c1 = cellPoint(base[0], base[1]);
  const P = [c1.x, c1.y, c1.z];
  const pr = Math.hypot(P[0], P[1], P[2]) || 1;
  const up = [P[0] / pr, P[1] / pr, P[2] / pr];
  const east = site.east;
  const north = site.north;
  const shot = A.shot ?? 'walk';
  // [east, north, eye height above the surface, aim height above the deck]
  const V = { walk: [22.0, -22.0, 2.0, 8.0],
    close: [14.0, -14.0, 2.0, 5.0],
    high: [30.0, -34.0, 16.0, 10.0] }[shot] ?? [22.0, -22.0, 2.0, 8.0];
  const eye = {
    x: P[0] + east.x * V[0] + north.x * V[1],
    y: P[1] + east.y * V[0] + north.y * V[1],
    z: P[2] + east.z * V[0] + north.z * V[1],
  };
  const er = Math.hypot(eye.x, eye.y, eye.z) || 1;
  of.teleport(latDeg(eye.y, er), Math.atan2(eye.z, eye.x) * D, V[2]);
  await sleep(2.0);
  const look = { x: P[0] + up[0] * V[3], y: P[1] + up[1] * V[3],
    z: P[2] + up[2] * V[3] };
  await aimAt(look);
  await emptyHand();
  await aimAt(look);
  await sleep(0.6);
  if (A.hideUi !== false) hideUi();
  await sleep(1.2);

  return {
    valid: true, shot, log,
    obs: of.world().observer,
    padView: of.game().padView,
  };
})()
