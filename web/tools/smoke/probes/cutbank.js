// WHY DOES A CUT BANK GO BLACK UNDER A HIGH SUN? The instrument, not the fix.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4181/ --scenario=walk \
//        --props=0 --voxelnear=0 \
//        --evalfile=tools/smoke/probes/cutbank.js \
//        --out=docs/screenshots/RN_cutbank.png
//
// THE SUBJECT is a CIRCULAR PIT, cut in one press with __of.level(under - d).
// That shape is the whole point: around its rim the depth, the range from the
// eye, the albedo rule, the relief band, the cascade the fragment lands in and
// the drawn facet's steepness are all the SAME at every compass bearing. The one
// thing that changes with bearing is dot(normal, sunDir). So a luminance sweep
// around the rim measures that term and nothing else, and it needs no second
// scene, no second material and no golden image to be evidence.
//
// Add --voxelnear=0 (RN-6's isolation) to take the near voxel mesh out of the
// scene entirely, so every pixel sampled below is a TERRAIN CHUNK fragment.
//
// FOUR THINGS COME BACK.
//
//   1. drove{}: DW-20. Ticks advanced, cells dug, the pit depth actually
//      measured through of.surface, and the drawn facet's dot(n,up). A colour
//      number over a pit that was never cut is a number about nothing.
//   2. sweep[]: per bearing, the mean RGB of a box on the WALL and a box on the
//      FLOOR, both from ONE screenshot, plus the ranges each was taken at.
//   3. verdict{}: the darkest wall against the floor under it, as a ratio, with
//      the tolerance stated in `minWallFrac`.
//   4. crossCheck{}: the same darkest bearing measured the OTHER way (aim at
//      the wall, sample frame centre; aim at the floor, sample frame centre).
//      Two independent samplings of the same surfaces; if they disagree the
//      projection arithmetic in `rowFor` is wrong and nothing else here counts.
(async () => {
  const of = window.__of;
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const log = [];
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const unit = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / r, p[1] / r, p[2] / r];
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

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  const bodyR = w0.bodyRadiusM;
  const tick0 = of.world().tick;

  of.setView('FP');
  of.teleport(A.latDeg ?? 1.79040, A.lonDeg ?? 144.20960, 2.0);
  await settle(A.arriveSecs ?? 3.0);
  // A HIGH sun, fixed, for everything below, and SOLVED rather than guessed.
  // The defect is specifically the high-sun case: a low sun grazes a vertical
  // face and lights it fine. dirForT sweeps a small circle, so the elevation a
  // site can reach is a property of the site; scan for the t nearest the target
  // and report what was actually achieved rather than assuming a magic number.
  const wantDot = A.sunDot ?? 0.94;
  let sunT = 0, bestErr = Infinity, maxDot = -1;
  for (let i = 0; i < 720; ++i) {
    of.setTime(i / 720);
    const d = of.stats().sky.elevationDot;
    if (d > maxDot) maxDot = d;
    const err = Math.abs(d - wantDot);
    if (err < bestErr) { bestErr = err; sunT = i / 720; }
  }
  of.setTime(sunT);
  await settle(0.5);
  log.push(`sun t ${sunT.toFixed(4)} dot ${of.stats().sky.elevationDot} (site max ${maxDot})`);

  // Standing rule 1: every height here is of.surface, the one edited surface.
  const hAt = (u) => of.surface(u[0], u[1], u[2]).surfaceM;
  const upAt = () => unit(of.world().player.aim.origin);
  const eye = () => of.world().player.aim.origin;

  // --- CUT THE PIT ----------------------------------------------------------
  // Straight down, so LevelAction's disc centres on the feet rather than on
  // wherever the aim ray happened to reach. One press: maxCutM is 12 m.
  of.look(0, -89);
  await settle(0.4);
  const uCentre = upAt();
  const hBefore = hAt(uCentre);
  const depthM = A.depthM ?? 6.0;
  const res = of.level(hBefore - depthM);
  await settle(A.reMeshSecs ?? 2.5);
  const hAfter = hAt(uCentre);
  log.push(`pit ${(hBefore - hAfter).toFixed(2)} m deep, ${res === null ? 'null' : res.dug} cells`);

  // The DRAWN facet's steepness at the rim. The chunk samples the field at the
  // shipped 1.8 m LOD (DW-19), so a wall that is vertical in the signed field
  // is rendered as rise-over-1.8-m and THAT is the normal the shader gets.
  const facetM = A.facetM ?? 1.8;
  const facetFlat = (u) => {
    const h0 = hAt(u);
    let worst = 0;
    for (const d of ring(u, facetM, 8, bodyR)) worst = Math.max(worst, Math.abs(hAt(d) - h0));
    return { flat: facetM / Math.hypot(facetM, worst), riseM: worst };
  };

  // --- MARCH ----------------------------------------------------------------
  const march = (yawDeg, pitchDeg) => {
    of.look(yawDeg, pitchDeg);
    const ray = of.world().player.aim;
    const o = ray.origin, d = ray.dir;
    for (let t = 0.2; t <= (A.reachM ?? 26); t += 0.1) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      const r = Math.hypot(x, y, z);
      const s = of.surface(x / r, y / r, z / r);
      if (r <= bodyR + s.surfaceM) {
        return { t, u: [x / r, y / r, z / r], hM: s.surfaceM, aboveFloorM: s.surfaceM - hAfter };
      }
    }
    return null;
  };

  // --- SAMPLING -------------------------------------------------------------
  // fovY is 60 degrees and never changes (CameraRig has no caller for setFov),
  // so a pitch offset from the camera axis maps to a screen row exactly. That is
  // what lets the wall box and the floor box come out of ONE frame.
  const TAN_HALF = Math.tan((60 * Math.PI) / 360);
  const rowFor = (pitchCamDeg, pitchTargetDeg, h) => {
    const dRad = ((pitchCamDeg - pitchTargetDeg) * Math.PI) / 180;
    return Math.round(h * 0.5 * (1 + Math.tan(dRad) / TAN_HALF));
  };
  const grab = async () => {
    const shot = of.screenshot();
    await settle(0.3);
    const bmp = await createImageBitmap(await shot);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return { ctx, w: bmp.width, h: bmp.height };
  };
  const half = A.halfPx ?? 40;
  const boxAt = (g, cx, cy) => {
    const x0 = Math.max(0, Math.min(g.w - 2 * half, (cx - half) | 0));
    const y0 = Math.max(0, Math.min(g.h - 2 * half, (cy - half) | 0));
    const d = g.ctx.getImageData(x0, y0, half * 2, half * 2).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    const rgb = [+(r / n).toFixed(1), +(gr / n).toFixed(1), +(b / n).toFixed(1)];
    return { rgb, lum: +((rgb[0] * 77 + rgb[1] * 151 + rgb[2] * 28) / 256).toFixed(1), at: [x0, y0] };
  };

  // --- THE SWEEP ------------------------------------------------------------
  const bearings = A.bearings ?? [0, 45, 90, 135, 180, 225, 270, 315];
  const sweep = [];
  for (const yaw of bearings) {
    // Find a wall pitch and a floor pitch at this bearing by marching, so the
    // probe knows what each box is pointed at instead of assuming a geometry.
    const rows = [];
    for (let p = A.pitchHiDeg ?? 34; p >= (A.pitchLoDeg ?? -34); p -= 1) {
      const m = march(yaw, p);
      if (m === null) continue;
      const f = facetFlat(m.u);
      rows.push({ p, t: m.t, flat: f.flat, riseM: f.riseM, aboveFloorM: m.aboveFloorM });
    }
    const walls = rows.filter((r) => r.flat < (A.wallFlatMax ?? 0.55)
      && r.aboveFloorM > (A.wallMinAboveM ?? 1.0) && r.t > 4 && r.t < 20);
    if (walls.length === 0) { log.push(`yaw ${yaw}: no wall facet found`); continue; }
    // The middle of the wall band, so the box is not straddling the rim or the toe.
    const wall = walls[(walls.length / 2) | 0];
    const floors = rows.filter((r) => r.flat > (A.floorFlatMin ?? 0.95)
      && Math.abs(r.aboveFloorM) < 0.6 && r.t > 2);
    if (floors.length === 0) { log.push(`yaw ${yaw}: no floor facet found`); continue; }
    // Comparable RANGE: of the flat floor hits, the one closest to the wall's.
    let floor = floors[0];
    for (const f of floors) if (Math.abs(f.t - wall.t) < Math.abs(floor.t - wall.t)) floor = f;

    // Aim BETWEEN the two samples, not at either. The FP arms and the hotbar own
    // the bottom of the frame and are neither terrain nor the same material; a
    // first pass that aimed at the wall put the floor box on a shiny gauntlet at
    // two bearings, and the "floor" luminance swung from 74.6 to 140.6 around a
    // pit whose floor is one flat plane. Splitting the difference puts both
    // boxes in the clear third of the frame and keeps them in ONE capture.
    const pitchCam = (wall.p + floor.p) / 2;
    of.look(yaw, pitchCam);
    await settle(0.5);
    const g = await grab();
    const yWall = rowFor(pitchCam, wall.p, g.h);
    const yFloor = rowFor(pitchCam, floor.p, g.h);
    const vmTop = A.viewModelTopPx ?? 720;
    if (yFloor + half > vmTop || yWall - half < 0) {
      log.push(`yaw ${yaw}: boxes at ${yWall}/${yFloor} would touch the view model`);
      continue;
    }
    const wallBox = boxAt(g, g.w / 2, yWall);
    const floorBox = boxAt(g, g.w / 2, yFloor);
    sweep.push({
      yaw,
      // `bandDeg` is how tall the wall is in the frame. The box spans about
      // 5.3 degrees at fovY 60, so a band narrower than that would mean the
      // sample straddled the rim into sky and the number is not the wall's.
      wall: { pitch: wall.p, rangeM: +wall.t.toFixed(2), flat: +wall.flat.toFixed(3),
        riseM: +wall.riseM.toFixed(2), aboveFloorM: +wall.aboveFloorM.toFixed(2),
        bandDeg: walls[0].p - walls[walls.length - 1].p, ...wallBox },
      floor: { pitch: floor.p, rangeM: +floor.t.toFixed(2), flat: +floor.flat.toFixed(3),
        ...floorBox },
      frac: +(wallBox.lum / Math.max(0.1, floorBox.lum)).toFixed(3),
      rangeRatio: +(wall.t / Math.max(0.1, floor.t)).toFixed(2),
    });
  }
  if (sweep.length < 4) return { valid: false, why: 'fewer than 4 bearings resolved', log, sweep };

  // --- VERDICT --------------------------------------------------------------
  let dark = sweep[0], bright = sweep[0];
  for (const s of sweep) {
    if (s.wall.lum < dark.wall.lum) dark = s;
    if (s.wall.lum > bright.wall.lum) bright = s;
  }
  // THE TOLERANCE, and it is derived rather than picked. On a clear day a
  // vertical face receives about 13% of the horizontal direct irradiance as sky
  // diffuse (halved to ~6.5% because it sees half the dome) plus about 11% again
  // bounced off the sunlit ground beside it: call it 0.18 of what the flat
  // ground receives. Rock albedo is close enough to biome albedo that the
  // RADIANCE ratio lands in the same place. So a shaded cut bank should sit near
  // a fifth of the sunlit floor's luminance, and the failure being measured is
  // not "a bit dark", it is an order of magnitude below that.
  const minWallFrac = A.minWallFrac ?? 0.18;
  const w1 = of.world();
  const sky1 = of.stats().sky;
  const tf = of.terraform();

  // --- CROSS-CHECK: the same two surfaces, sampled the other way -------------
  const centreOf = async (yaw, pitch) => {
    of.look(yaw, pitch);
    await settle(0.5);
    const g = await grab();
    return boxAt(g, g.w / 2, g.h / 2);
  };
  const cWall = await centreOf(dark.yaw, dark.wall.pitch);
  const cFloor = await centreOf(dark.yaw, dark.floor.pitch);

  // Frame the capture on the darkest bearing: the picture and the number agree.
  of.look(dark.yaw, A.shotPitchDeg ?? dark.wall.pitch);
  await settle(1.0);

  const fFacet = facetFlat(uCentre);
  return {
    // DW-20 first.
    valid: (w1.tick - tick0) > 400 && res !== null && res.dug > 0
      && (hBefore - hAfter) > depthM * 0.8 && sweep.length >= 4,
    drove: {
      ticksAdvanced: w1.tick - tick0,
      framesRendered: w1.frames - w0.frames,
      cellsDug: res === null ? 0 : res.dug,
      removedCells: tf.removedCells,
      mouth: tf.mouth,
      pitDepthM: +(hBefore - hAfter).toFixed(2),
      floorFacetFlat: +fFacet.flat.toFixed(3),
      floorFacetRiseM: +fFacet.riseM.toFixed(2),
    },
    // Standing rule 7. A 6 m pit SHADOWS ITS OWN FLOOR, and a cast shadow is
    // not the thing under test: run with --shadows=0 and the only quantity that
    // still varies around the rim is dot(N, sunDir). `active` false is what
    // proves the cascades were actually out of the frame.
    shadows: of.stats().shadow,
    sun: { ...sky1, sunT: A.sunT ?? 0.25,
      elevationDeg: +((Math.asin(Math.min(1, Math.max(-1, sky1.elevationDot)))
        * 180) / Math.PI).toFixed(1) },
    // THE MEASUREMENT.
    darkestWall: { yaw: dark.yaw, rgb: dark.wall.rgb, lum: dark.wall.lum,
      rangeM: dark.wall.rangeM, flat: dark.wall.flat },
    floorUnderIt: { rgb: dark.floor.rgb, lum: dark.floor.lum, rangeM: dark.floor.rangeM },
    brightestWall: { yaw: bright.yaw, rgb: bright.wall.rgb, lum: bright.wall.lum },
    darkestFrac: dark.frac,
    brightestFrac: bright.frac,
    // A circular pit is azimuthally symmetric in everything BUT dot(N, sunDir).
    // This spread is therefore that term, measured.
    azimuthalSpread: +(bright.wall.lum - dark.wall.lum).toFixed(1),
    cutBankNotBlack: dark.frac >= minWallFrac,
    minWallFrac,
    crossCheck: {
      wallCentreLum: cWall.lum, wallSameFrameLum: dark.wall.lum,
      floorCentreLum: cFloor.lum, floorSameFrameLum: dark.floor.lum,
      agreesWithin: +Math.max(Math.abs(cWall.lum - dark.wall.lum),
        Math.abs(cFloor.lum - dark.floor.lum)).toFixed(1),
    },
    sweep,
    site: { lat: +w1.observer.latDeg.toFixed(5), lon: +w1.observer.lonDeg.toFixed(5),
      biome: w1.biome },
    log,
  };
})()
