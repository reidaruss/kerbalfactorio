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
  // [east, north, eye height above the surface, aim height above the deck,
  //  aim east offset, aim north offset]
  //
  // RN-1815 adds the last two and two shots, and both additions exist because
  // the three original framings answer "what does the pad look like" and the
  // pad's two OWED look items are not answerable from any of them:
  //
  //   skirt   6 m off the south face at standing eye, aimed level. The outer
  //           skirt is the largest single surface in the walk and close shots
  //           and it fills this one, which is the distance the repeat was
  //           called visible at. `close` sees the same wall but spends most of
  //           the frame on the tower and the sky.
  //   trench  the SOUTH TRENCH MOUTH, standing outside the platform on the
  //           trench axis and aiming INTO it, which is the only eye position
  //           in the game that sees the deflector, the liner bands and the
  //           trench floor at once.
  //
  // A THIRD TRAP, ON TOP OF THE TWO THIS FILE ALREADY RECORDS, AND IT IS WHY
  // `trench` IS TAKEN AT 1.75 m RATHER THAN FROM ABOVE THE LIP. `of.teleport`
  // does not just interpret its third argument as a height above the TERRAIN
  // (trap (1) below): the observer is a physics body and it FALLS. Asking for
  // 6.5 m, which would have looked down the trench over the near lip and
  // shown its whole length, lands the eye back on the ground with no
  // complaint from the probe and no clue in the report - the returned
  // `obs.altM` is the settled value, not the requested one, so the frame is
  // simply a different shot with the same name. `high`'s own 16.0 has been
  // doing this since RN-1696 and its frame is a ground-level one. Nothing
  // here can stand on the 2 m deck, so the mouth is the read, and it is
  // where a walking player sees the trench from anyway.
  //
  // The aim offsets are what make `trench` possible at all. Every earlier shot
  // aims at the pad's centre column, and a camera on the trench axis aiming at
  // the centre at deck height photographs the launch table's underside rather
  // than the trench it is standing in front of.
  const V = { walk: [22.0, -22.0, 2.0, 8.0, 0.0, 0.0],
    close: [14.0, -14.0, 2.0, 5.0, 0.0, 0.0],
    high: [30.0, -34.0, 16.0, 10.0, 0.0, 0.0],
    skirt: [-19.0, -2.0, 1.75, 1.10, 0.0, 0.0],
    trench: [0.0, -18.0, 1.75, 1.05, 0.0, 0.0] }[shot]
    ?? [22.0, -22.0, 2.0, 8.0, 0.0, 0.0];
  // An invocation override, so a candidate framing is one `--evalargs` rather
  // than a source edit. `artframe.js`'s `extra` rule in the other direction:
  // measure a candidate before committing it.
  const Vx = Array.isArray(A.V) ? A.V : V;
  const eye = {
    x: P[0] + east.x * Vx[0] + north.x * Vx[1],
    y: P[1] + east.y * Vx[0] + north.y * Vx[1],
    z: P[2] + east.z * Vx[0] + north.z * Vx[1],
  };
  const er = Math.hypot(eye.x, eye.y, eye.z) || 1;
  of.teleport(latDeg(eye.y, er), Math.atan2(eye.z, eye.x) * D, Vx[2]);
  await sleep(2.0);
  const ae = Vx[4] ?? 0.0;
  const an = Vx[5] ?? 0.0;
  const look = {
    x: P[0] + up[0] * Vx[3] + east.x * ae + north.x * an,
    y: P[1] + up[1] * Vx[3] + east.y * ae + north.y * an,
    z: P[2] + up[2] * Vx[3] + east.z * ae + north.z * an,
  };
  await aimAt(look);
  await emptyHand();
  await aimAt(look);
  await sleep(0.6);
  if (A.hideUi !== false) hideUi();
  await sleep(1.2);

  // ======================================================================
  // RN-1815. THE NUMBERS COME BACK WITH THE FRAME, `artframe.js`'s rule and
  // its `statOn` idiom verbatim (luma, mean RGB, warm = meanR - meanB, sat,
  // p05/p50/p95, iqr, loFrac, hiFrac) so a pad reading is comparable with
  // every other art reading in the project. A pair of PNGs cannot say by how
  // much a surface moved, and both of this pass's owed items are claims about
  // a surface rather than about an arrangement.
  //
  // The rectangles are COMMITTED per shot (RN-1728's finding: an audit whose
  // boxes live only in a report has to be grid-searched back out by whoever
  // verifies it), in FRACTIONS of the frame so they survive a resolution
  // change, and an invocation may add or override one through `extra`.
  // ======================================================================
  const RECTS = {
    // `wall` is the plinth's outer face and nothing else: below the cap's
    // 0.20 m ledge, above the steel kerb, and 900 px of a 24 m run of the
    // surface the verifier called "a repeating dark aggregate or rock tile".
    // `kerb` (the steel edge angle under it) and `tank` (the propellant tank
    // behind it) are NEGATIVE CONTROLS: neither wears a role this pass
    // touches, both are in the same frame under the same light, and a change
    // that moves either of them has moved the scene rather than the skirt.
    skirt: { wall: [0.050, 0.440, 0.950, 0.630],
      kerb: [0.300, 0.675, 0.700, 0.700],
      tank: [0.695, 0.045, 0.800, 0.280] },
    // Down the trench from its south mouth.
    //   all    the whole trench interior: both walls, the floor and the
    //          deflector. The headline rectangle, and it is deliberately the
    //          one that CANNOT be gamed by moving a colour from one zone to
    //          another - if the trench still reads orange anywhere large, its
    //          saturation stays up.
    //   liner  the sunlit east wall's lower band, which is the single
    //          surface the "rust paint" finding was about. It spans the
    //          gradient's own threshold, so after RN-1815 it holds oxide at
    //          the mouth and soot beyond it in one rectangle: saturation must
    //          fall AND spread must rise, which one uniform colour cannot do.
    //   upper  the east wall's UPPER band, one metre above `liner` in the
    //          same light. `SteelDark` on `panel`, untouched by this pass by
    //          construction, so it is the negative control.
    //   floor  the trench floor slab.
    //   core   the trench's centre at the deflector, lit by bounce alone.
    trench: { all: [0.020, 0.460, 0.680, 0.640],
      liner: [0.581, 0.533, 0.669, 0.606],
      upper: [0.585, 0.435, 0.665, 0.485],
      floor: [0.219, 0.556, 0.500, 0.633],
      core: [0.300, 0.478, 0.500, 0.513] },
    walk: {}, close: {}, high: {},
  };
  const r2 = (x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const statOn = (cx, x0, y0, x1, y1) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const n = w * h;
    let sr = 0; let sg = 0; let sb = 0; let ssat = 0;
    let lo = 0; let hi = 0;
    const lum = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
      const r = d[i * 4]; const g = d[i * 4 + 1]; const b = d[i * 4 + 2];
      sr += r; sg += g; sb += b;
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      ssat += mx === 0 ? 0 : (mx - mn) / mx;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = y;
      if (y < 255 * 0.10) lo++;
      if (y > 255 * 0.80) hi++;
    }
    lum.sort();
    const q = (f) => lum[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
    const mr = sr / n; const mg = sg / n; const mb = sb / n;
    return { px: n,
      luma: r2(0.2126 * mr + 0.7152 * mg + 0.0722 * mb),
      rgb: [r2(mr), r2(mg), r2(mb)],
      warm: r2(mr - mb), sat: r3(ssat / n),
      p05: r2(q(0.05)), p50: r2(q(0.50)), p95: r2(q(0.95)),
      iqr: r2(q(0.75) - q(0.25)),
      loFrac: r3(lo / n), hiFrac: r3(hi / n) };
  };
  let stats = null;
  if (A.stats !== false) {
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const RECT = { ...(RECTS[shot] ?? {}), ...(A.extra ?? {}) };
    stats = { W: bmp.width, H: bmp.height,
      world: statOn(cx, 0, 0, bmp.width, bmp.height), box: {} };
    for (const [k, f] of Object.entries(RECT)) {
      stats.box[k] = statOn(cx, f[0] * bmp.width, f[1] * bmp.height,
        f[2] * bmp.width, f[3] * bmp.height);
      stats.box[k].rect = [Math.round(f[0] * bmp.width),
        Math.round(f[1] * bmp.height), Math.round(f[2] * bmp.width),
        Math.round(f[3] * bmp.height)];
    }
  }

  return {
    valid: true, shot, V: Vx, log, stats,
    post: window.__ofPost ? window.__ofPost.state().post : null,
    obs: of.world().observer,
    padView: of.game().padView,
  };
})()
