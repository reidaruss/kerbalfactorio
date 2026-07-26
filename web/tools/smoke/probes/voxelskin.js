// Does terraformed ground LOOK like ground, and does it stop OBSTRUCTING play?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --scenario=walk \
//        --props=0 --gameplay=0 \
//        --evalfile=tools/smoke/probes/voxelskin.js \
//        --out=docs/screenshots/RN_voxelskin.png
//
// Add --voxelskin=0 to run the same measurements against the UNFILTERED voxel
// shell W5 shipped. That is the isolation standing rule 7 asks for: the claim
// is that one layer was painting a 1 m lattice of dark pyramids over ground the
// terrain chunk already drew, and the way to prove it is to switch that layer
// back on and watch the numbers move.
//
// FOUR MEASUREMENTS.
//
//   1. HOW MUCH of what /core exposes is untouched ground. `exposed` is every
//      solid-to-air face in the re-meshed bricks; `dropped` is the share of
//      them that belong to no edit. A big ratio IS the defect, counted.
//   2. THE AIM RAY. Independently of anything this change does, march the
//      player's own aim against BOTH of the oracle's answers and report where
//      each stops. The gap is how far short of the visible ground a pickaxe
//      swing or a levelling disc used to land, in metres.
//   3. COLOUR. Rendered pixels of the levelled pad against rendered pixels of
//      untouched terrain at the same pitch and a similar range. Two aims, two
//      canvas captures, mean RGB of a 64 px box at each. "Looks like terrain"
//      is an opinion; a per-channel difference with a stated tolerance is not.
//   4. COST. Draw calls, frame p50/p99 and the re-mesh time a level costs.
//
// DW-20: every wait is real time through of.run, and the tick delta is reported
// first so a run that measured a frozen simulation is visible as one.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const R = A.radiusM ?? 6.0;
  const log = [];

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const hold = async (secs, keys) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
  };
  const eye = () => {
    const w = of.world();
    return w.player === null ? null : w.player.aim.origin;
  };
  const ring = (u, metres, n, radiusM) => {
    const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cx = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]];
    let e1 = cx(u, seed);
    const L = Math.hypot(...e1); e1 = e1.map((v) => v / L);
    const e2 = cx(u, e1);
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = (2 * Math.PI * i) / n;
      out.push(unit([0, 1, 2].map((k) =>
        u[k] * radiusM + (e1[k] * Math.cos(a) + e2[k] * Math.sin(a)) * metres)));
    }
    return out;
  };
  // Standing rule 1 applies to the harness: every height here is of.surface.
  const heights = (dirs) => dirs.map((d) => of.surface(d[0], d[1], d[2]).surfaceM);
  const spreadOf = (hs) => Math.max(...hs) - Math.min(...hs);

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character, nothing can level' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const bodyR = w0.bodyRadiusM;
  const tick0 = of.world().tick;

  // --- find a slope: item 99 says a levelling tool cannot be proved on a plain
  const spawn = of.world().observer;
  const site = { latDeg: spawn.latDeg, lonDeg: spawn.lonDeg, spread: -1, scanned: 0 };
  const scan = (cLat, cLon, stepDeg, span, maxM) => {
    for (let i = -span; i <= span; ++i) {
      for (let j = -span; j <= span; ++j) {
        const lat = cLat + i * stepDeg, lon = cLon + j * stepDeg;
        of.teleport(lat, lon, 2.0);
        const uu = unit(eye());
        site.scanned++;
        const hs = heights([uu, ...ring(uu, R * 0.7, 4, bodyR), ...ring(uu, R, 4, bodyR)]);
        const s = spreadOf(hs);
        if (s > site.spread && s <= maxM) {
          site.spread = s; site.latDeg = lat; site.lonDeg = lon;
        }
      }
    }
  };
  scan(spawn.latDeg, spawn.lonDeg, 0.02, 8, A.maxSlopeM ?? 9.0);
  scan(site.latDeg, site.lonDeg, 0.0016, 5, A.maxSlopeM ?? 9.0);
  of.teleport(site.latDeg, site.lonDeg, 2.0);
  await settle(3.0);
  log.push(`site lat ${site.latDeg.toFixed(5)} lon ${site.lonDeg.toFixed(5)}, `
    + `probe spread ${site.spread.toFixed(3)} m over ${site.scanned} candidates`);

  // === 2. THE AIM RAY, measured BEFORE anything is edited ===================
  //
  // Two marches along the player's own aim: one against of.solidAt, the 1 m
  // lattice shell, and one against "solid AND at or below the surface", which
  // is the ground that is drawn. Where they disagree, the shell is invisible
  // rock in front of the ground the player is pointing at.
  const marchGap = (yawDeg, pitchDeg) => {
    of.look(yawDeg, pitchDeg);
    const ray = of.world().player.aim;
    const o = ray.origin, d = ray.dir;
    const step = 0.05, reach = 16.0;
    let tShell = -1, tGround = -1;
    for (let t = step; t <= reach; t += step) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (!of.solidAt(x, y, z)) continue;
      if (tShell < 0) tShell = t;
      const r = Math.hypot(x, y, z);
      if (r <= bodyR + of.surface(x / r, y / r, z / r).surfaceM) { tGround = t; break; }
    }
    if (tShell < 0 || tGround < 0) return null;
    // How high the shell hit stands above the surface under IT: the height of
    // the invisible wall, in metres.
    const hx = o[0] + d[0] * tShell, hy = o[1] + d[1] * tShell, hz = o[2] + d[2] * tShell;
    const hr = Math.hypot(hx, hy, hz);
    const above = hr - (bodyR + of.surface(hx / hr, hy / hr, hz / hr).surfaceM);
    return { yawDeg, pitchDeg, tShell: +tShell.toFixed(3), tGround: +tGround.toFixed(3),
      shortM: +(tGround - tShell).toFixed(3), aboveGroundM: +above.toFixed(3) };
  };
  // A grid of aims, not one: the shell's disagreement with the smooth surface
  // is a boundary-layer effect that varies cell by cell, so a single ray reports
  // wherever it happened to land rather than what the tool has to survive.
  const aimRows = [];
  for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (const pitch of [-18, -25, -32, -40, -55]) {
      const r = marchGap(yaw, pitch);
      if (r !== null) aimRows.push(r);
    }
  }
  const shorts = aimRows.map((r) => r.shortM).sort((a, b) => a - b);
  const aboves = aimRows.map((r) => r.aboveGroundM).sort((a, b) => a - b);
  const pct = (a, q) => (a.length === 0 ? 0 : a[Math.min(a.length - 1, Math.round(q * (a.length - 1)))]);
  const worstShort = pct(shorts, 1);
  const worstAbove = pct(aboves, 1);
  const blocked = aimRows.filter((r) => r.shortM > 0.25).length;

  // And what the SHIPPED tool now does with the same aim: a dig strike's own
  // reported hit, and how far above the visible ground it landed.
  // WHAT THE SHIPPED TOOL DOES WITH THE SAME AIM. The expected distance is
  // marched against the SMOOTH surface FIRST, because a strike lowers the very
  // column it is measured against: reading surfaceM after the dig reports the
  // new pit floor and makes a correct hit look 1.9 m too high. That is a probe
  // bug, and it produced one before this comment did.
  const strikes = [];
  for (const yaw of [0, 90, 180, 270]) {
    for (const pitch of [-45, -60, -75]) {
      of.look(yaw, pitch);
      const ray = of.world().player.aim;
      const o = ray.origin, d = ray.dir;
      let expected = -1;
      for (let t = 0.05; t <= 6.0; t += 0.05) {
        const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
        const r = Math.hypot(x, y, z);
        if (r <= bodyR + of.surface(x / r, y / r, z / r).surfaceM) { expected = t; break; }
      }
      const st0 = of.dig();
      if (st0 === null || st0.hit === null || expected < 0) continue;
      strikes.push({ yaw, pitch, expectedM: +expected.toFixed(2),
        actualM: +st0.distM.toFixed(2), cells: st0.cells,
        errM: +(st0.distM - expected).toFixed(3) });
      of.forgetTunnels();
      await settle(0.05);
    }
  }
  const strikeErrM = strikes.length === 0 ? null
    : +Math.max(...strikes.map((v) => Math.abs(v.errM))).toFixed(3);
  of.forgetTunnels();
  await settle(0.4);

  // === 1. LEVEL A PAD, through the key a player presses =====================
  of.look(A.yawDeg ?? 0, A.pitchDeg ?? -72);
  await settle(0.4);
  const uPad = unit(eye());
  const before = heights([uPad, ...ring(uPad, R * 0.5, 6, bodyR)]);
  const tf0 = of.terraform();
  await hold(A.levelSecs ?? 1.6, ['KeyQ']);
  await settle(0.5);
  const tf1 = of.terraform();
  const after = heights([uPad, ...ring(uPad, R * 0.5, 6, bodyR)]);
  const mesh = of.voxels().mesh;
  log.push(`levelled: dug ${tf1.removedCells - tf0.removedCells}, `
    + `filled ${tf1.addedCells - tf0.addedCells}, `
    + `spread ${spreadOf(before).toFixed(3)} -> ${spreadOf(after).toFixed(3)} m`);
  log.push(`near mesh: exposed ${mesh.exposed}, dropped ${mesh.dropped}, `
    + `drawn faces ${mesh.faces}, quads ${mesh.quads}, ${mesh.lastMs} ms`);

  // === 3. COLOUR: the pad against the ground it replaced ====================
  //
  // Back off so the pad is in front rather than under the feet, then find two
  // aims at the same pitch: one whose ground point is INSIDE the pad and one
  // whose ground point is well clear of it. The ground point is found by the
  // same march used above, so the probe knows what it photographed.
  const padCentre = uPad;
  const angleTo = (u) => Math.acos(Math.min(1, Math.max(-1,
    u[0] * padCentre[0] + u[1] * padCentre[1] + u[2] * padCentre[2]))) * bodyR;
  // Local steepness at a surface direction, from the ONE surface, so a flat pad
  // is never compared against a cliff face and the difference blamed on colour.
  const slopeAt = (u) => {
    const h0 = of.surface(u[0], u[1], u[2]).surfaceM;
    let m = 0;
    for (const d of ring(u, 1.0, 4, bodyR)) {
      m = Math.max(m, Math.abs(of.surface(d[0], d[1], d[2]).surfaceM - h0));
    }
    return m;
  };
  const groundPoint = (yawDeg, pitchDeg) => {
    of.look(yawDeg, pitchDeg);
    const ray = of.world().player.aim;
    const o = ray.origin, d = ray.dir;
    for (let t = 0.1; t <= 40; t += 0.1) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      const r = Math.hypot(x, y, z);
      if (r <= bodyR + of.surface(x / r, y / r, z / r).surfaceM) {
        return { u: unit([x, y, z]), distM: t };
      }
    }
    return null;
  };
  // Back off to a MEASURED standoff, not for a guessed number of seconds: at
  // this standoff one pitch reaches the pad dead ahead and the same pitch to
  // the side reaches ground well clear of it, which is what makes "same pitch,
  // same range" and "pad versus not pad" satisfiable at once.
  const standoffM = A.standoffM ?? 8.0;
  of.look((A.yawDeg ?? 0) + 180, 0);
  await settle(0.2);
  let walked = 0;
  for (let k = 0; k < 14; ++k) {
    walked = angleTo(unit(eye()));
    if (walked >= standoffM) break;
    await hold(0.35, ['KeyW']);
  }
  await settle(0.8);
  log.push(`stood off ${walked.toFixed(2)} m from the pad centre`);

  // THE COMPARISON HAS TO BE FAIR OR IT MEASURES THE FRAMING. Aerial
  // perspective, the shadow cascade and the sun's incidence all move with RANGE
  // and with the SLOPE of the ground being looked at, so a pad photographed at
  // 9 m on the flat against a hillside at 21 m reports those two and calls the
  // difference colour. The pair is therefore chosen by matched range and
  // matched local steepness, over a free sweep of yaw and pitch; the camera
  // pitch itself is an output, not a constraint, because on a 5 m slope a fixed
  // pitch simply misses the ground.
  const cands = [];
  for (let yaw = 0; yaw < 360; yaw += 10) {
    for (let pitch = -8; pitch >= -70; pitch -= 6) {
      const g = groundPoint(((A.yawDeg ?? 0) + yaw) % 360, pitch);
      if (g === null || g.distM > 26) continue;
      cands.push({ yaw: ((A.yawDeg ?? 0) + yaw) % 360, pitch,
        dM: angleTo(g.u), distM: g.distM, slopeM: slopeAt(g.u) });
    }
  }
  const pads = cands.filter((c) => c.dM < R * 0.6);
  const grounds = cands.filter((c) => c.dM > R * 1.6);
  let aimPad = null, aimGround = null, pairErr = null;
  for (const p0 of pads) {
    for (const g0 of grounds) {
      const err = Math.abs(g0.distM - p0.distM) + 12 * Math.abs(g0.slopeM - p0.slopeM);
      if (pairErr === null || err < pairErr) { pairErr = err; aimPad = p0; aimGround = g0; }
    }
  }
  const rangeErr = aimPad === null ? null : Math.abs(aimGround.distM - aimPad.distM);
  const slopeErr = aimPad === null ? null : Math.abs(aimGround.slopeM - aimPad.slopeM);
  if (aimPad !== null
      && (rangeErr > (A.rangeMatchM ?? 3.0) || slopeErr > (A.slopeMatchM ?? 0.25))) {
    aimPad = null; aimGround = null;
  }
  const pairing = { candidates: cands.length, pads: pads.length, grounds: grounds.length,
    rangeErrM: rangeErr === null ? null : +rangeErr.toFixed(3),
    slopeErrM: slopeErr === null ? null : +slopeErr.toFixed(3) };

  const meanRGB = async (half) => {
    const shot = of.screenshot();
    await settle(0.25);
    const blob = await shot;
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const x0 = ((bmp.width >> 1) - half) | 0, y0 = ((bmp.height >> 1) - half) | 0;
    const d = ctx.getImageData(x0, y0, half * 2, half * 2).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)];
  };

  let colour = null;
  if (aimPad === null || aimGround === null) {
    log.push(`no matched pad/ground aim pair at standoff ${walked.toFixed(2)} m`);
  }
  if (aimPad !== null && aimGround !== null) {
    of.look(aimPad.yaw, aimPad.pitch);
    await settle(0.5);
    const padRGB = await meanRGB(A.sampleHalfPx ?? 32);
    of.look(aimGround.yaw, aimGround.pitch);
    await settle(0.5);
    const groundRGB = await meanRGB(A.sampleHalfPx ?? 32);
    const dR = padRGB.map((v, i) => Math.abs(v - groundRGB[i]));
    const lum = (c) => (c[0] * 77 + c[1] * 151 + c[2] * 28) / 256;
    const rel = Math.max(...dR) / Math.max(1, Math.max(...groundRGB));
    colour = {
      padRGB, groundRGB, absDelta: dR.map((v) => +v.toFixed(1)),
      relWorstChannel: +rel.toFixed(4),
      padLum: +lum(padRGB).toFixed(1), groundLum: +lum(groundRGB).toFixed(1),
      aimPad: { yaw: aimPad.yaw, pitch: aimPad.pitch, dM: +aimPad.dM.toFixed(2),
        distM: +aimPad.distM.toFixed(2), slopeM: +aimPad.slopeM.toFixed(3) },
      aimGround: { yaw: aimGround.yaw, pitch: aimGround.pitch,
        dM: +aimGround.dM.toFixed(2), distM: +aimGround.distM.toFixed(2),
        slopeM: +aimGround.slopeM.toFixed(3) },
    };
    log.push(`pad rgb ${padRGB.join(',')} vs ground rgb ${groundRGB.join(',')} `
      + `(pad ${aimPad.dM.toFixed(2)} m from centre, ground ${aimGround.dM.toFixed(2)} m)`);
  }

  // Frame the pad for the capture the runner takes.
  if (aimPad !== null) of.look(aimPad.yaw, A.shotPitchDeg ?? aimPad.pitch);
  await settle(0.8);

  const st = of.stats();
  const w1 = of.world();
  const tol = A.colourTolerance ?? 0.12;
  return {
    valid: w1.tick - tick0 > 300 && colour !== null,
    ticks: w1.tick - tick0,
    // The two halves of the acceptance.
    padMatchesGround: colour !== null && colour.relWorstChannel <= tol,
    skinIsEditsOnly: mesh.editFacesOnly,
    aimReachesTheGround: strikeErrM !== null && strikeErrM <= (A.aimTolM ?? 0.3),
    colourTolerance: tol,
    colour,
    shell: {
      exposed: mesh.exposed, dropped: mesh.dropped,
      droppedFraction: mesh.exposed > 0 ? +(mesh.dropped / mesh.exposed).toFixed(4) : 0,
      faces: mesh.faces, quads: mesh.quads, triangles: mesh.triangles,
      bricks: mesh.bricks, remeshMs: mesh.lastMs, editFacesOnly: mesh.editFacesOnly,
    },
    aim: {
      samples: aimRows.length,
      shortM: { p50: pct(shorts, 0.5), p95: pct(shorts, 0.95), worst: worstShort },
      shellAboveGroundM: { p50: pct(aboves, 0.5), p95: pct(aboves, 0.95), worst: worstAbove },
      raysStoppedEarly: blocked,
      strikeWorstErrM: strikeErrM,
      strikes,
    },
    pad: {
      dug: tf1.removedCells - tf0.removedCells,
      filled: tf1.addedCells - tf0.addedCells,
      spreadBeforeM: +spreadOf(before).toFixed(3),
      spreadAfterM: +spreadOf(after).toFixed(3),
    },
    cost: {
      drawCalls: st.draw.calls, budget: st.budget.drawCalls,
      p50Ms: st.frameMs.p50, p99Ms: st.frameMs.p99, triangles: st.draw.triangles,
      programs: st.draw.programs,
    },
    site,
    pairing,
    log,
  };
})()
