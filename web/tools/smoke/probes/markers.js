// markers.js (GP-520): THE MARKER SUBSTRATE. One registry, injected through
// the debug source `of.markers('add', ...)` exactly as the real producer (L6,
// the reveal lane, later) will, then read back off BOTH maps.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ \
//     --evalfile=tools/smoke/probes/markers.js
//
// SURVIVAL, DELIBERATELY (no --sandbox=1): sandbox's `revealAll` bypasses the
// TERRAIN layer's own gate, which would make "a marker draws even where the
// survey layer is undiscovered" trivially true for the wrong reason (nothing
// would be gated in the first place). Survival is the only mode where the
// terrain layer's gate is actually closed anywhere, so it is the only mode
// that can show the marker layer not sharing it.
//
// THREE PROPERTIES, each asserted:
//   1. THE TAG REACHED THE 2D REPORT, and the pixel it drew at matches an
//      INDEPENDENT `toPx` (MapPaint.ts, copied here) over `MapPaint.markerPosM`
//      of the marker's own `dirBody`, computed off the published `proj` and
//      `bodyRadiusM` rather than trusted a second time with no way to check it.
//   2. `known: false` IS ABSENT. The one gate a marker draws behind.
//   3. A KNOWN MARKER FAR FROM SPAWN DRAWS WHILE THE SURVEY FIELD IS STILL
//      NEARLY EMPTY (`surveyFraction` near 0): the marker layer shares no gate
//      with the terrain layer's `reveal || seen` test (MapLayers.ts).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.markers !== 'function') return { valid: false, why: 'no __of.markers' };
  if (typeof of.map !== 'function') return { valid: false, why: 'no __of.map' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  await sleep(1.0);
  of.markers('clear');

  // --- fixture: the player's own direction off the body, and a second
  // direction 30 degrees around a tangent axis, i.e. far enough along the
  // surface that no local survey observation could reach it.
  const w0 = of.world();
  const feet = w0.player.feet;
  const bodyR = w0.bodyRadiusM;
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dirNear = norm([feet[0], feet[1], feet[2]]);
  const ref = Math.abs(dirNear[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const axis = norm(cross(dirNear, ref));
  const tangent = cross(axis, dirNear);
  // 6 km of arc: comfortably past the local survey horizon (a few hundred to
  // low thousands of metres, read off `of.map('disc')` in practice) while
  // staying inside the ~10s-of-km view a handful of zoom-out presses reach,
  // rather than a fixed ANGLE, which on a 600 km body (measured) put the
  // first version of this offset 314 km out — past every span the fixture
  // actually zooms to, so it was cropped off-canvas and never tested the
  // claim at all. Found by running the probe and reading its own report.
  const theta = 6000 / bodyR;
  const dirFar = norm([
    dirNear[0] * Math.cos(theta) + tangent[0] * Math.sin(theta),
    dirNear[1] * Math.cos(theta) + tangent[1] * Math.sin(theta),
    dirNear[2] * Math.cos(theta) + tangent[2] * Math.sin(theta),
  ]);
  log.push(`bodyRadiusM=${bodyR} arcOffsetM=${Math.round(theta * bodyR)}`);

  const addNear = of.markers('add', {
    key: 'probe-near', kind: 'ruin', dirBody: dirNear, label: 'Probe Near', known: true,
  });
  check('the near marker was added', addNear?.added?.key === 'probe-near', JSON.stringify(addNear));
  const addFar = of.markers('add', {
    key: 'probe-far', kind: 'signal', dirBody: dirFar, label: 'Probe Far', known: true,
  });
  check('the far marker was added', addFar?.added?.key === 'probe-far', JSON.stringify(addFar));
  const addHidden = of.markers('add', {
    key: 'probe-hidden', kind: 'deposit', dirBody: dirNear, label: 'Probe Hidden', known: false,
  });
  check('the unknown marker was added', addHidden?.added?.known === false, JSON.stringify(addHidden));

  // --- open the map with a real M press, the same as map3d.js.
  const mapCode = (of.input.bindings().map || [])[0];
  if (!mapCode) return { valid: false, why: 'no map binding' };
  const pressM = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  pressM();
  await sleep(0.6);
  check('M opened the map (the press landed)', of.map().open === true);

  // Zoom out repeatedly (map3d.js's own recipe) so the far marker, ~30 degrees
  // of arc from spawn, is comfortably on-canvas rather than culled off it.
  for (let i = 0; i < 12; ++i) of.map('zoom', { mult: 1.4 });
  await sleep(0.5);

  const rep0 = of.map('report');
  const disc = of.map('disc');
  check('survival: revealAll is false (the terrain gate is actually closed)',
    disc?.revealAll === false, JSON.stringify(disc));
  check('almost nothing has been surveyed yet: surveyFraction is near zero',
    typeof disc?.discovery?.surveyFraction === 'number' && disc.discovery.surveyFraction < 0.02,
    JSON.stringify(disc?.discovery));

  const drawn = rep0.view.drawn;
  log.push(`marks: ${JSON.stringify(drawn.markers)}`);

  // --- 1. tags reached the report, and known:false is absent.
  check('the near marker\'s tag is in the 2D draw report',
    drawn.markers.includes('marker:probe-near'), JSON.stringify(drawn.markers));
  check('the far marker\'s tag is in the 2D draw report',
    drawn.markers.includes('marker:probe-far'), JSON.stringify(drawn.markers));
  check('the UNKNOWN marker\'s tag is ABSENT: known is the only gate',
    !drawn.markers.includes('marker:probe-hidden'), JSON.stringify(drawn.markers));

  // --- 2. the near marker's drawn pixel matches an INDEPENDENT toPx, copied
  // verbatim from MapPaint.ts, over MapPaint.markerPosM of its own dirBody.
  const row = drawn.markerRows.find((r) => r.key === 'probe-near');
  check('the near marker has a pixel row', row !== undefined, JSON.stringify(drawn.markerRows));
  let pxErr = null;
  if (row !== undefined) {
    const pr = drawn.proj;
    const l = Math.hypot(dirNear[0], dirNear[1], dirNear[2]) || 1;
    const p = [dirNear[0] / l * bodyR, dirNear[1] / l * bodyR, dirNear[2] / l * bodyR];
    const dx = p[0] - pr.ox, dy = p[1] - pr.oy, dz = p[2] - pr.oz;
    const wantX = pr.cx + pr.m2p * (dx * pr.u[0] + dy * pr.u[1] + dz * pr.u[2]);
    const wantY = pr.cy - pr.m2p * (dx * pr.v[0] + dy * pr.v[1] + dz * pr.v[2]);
    pxErr = Math.hypot(row.xPx - wantX, row.yPx - wantY);
    check('the drawn pixel matches an independent MapPaint.toPx, within 2 px',
      pxErr < 2, `err=${pxErr.toFixed(3)} drawn=(${row.xPx.toFixed(1)},${row.yPx.toFixed(1)}) `
      + `want=(${wantX.toFixed(1)},${wantY.toFixed(1)})`);
  }

  // --- 3. the 3D map's own census counts the two known kinds at least once.
  const t3 = of.map('three').three;
  check('the 3D map counts a ruin marker', t3 !== null && t3.markerKinds.ruin >= 1,
    JSON.stringify(t3 === null ? null : t3.markerKinds));
  check('the 3D map counts a signal marker', t3 !== null && t3.markerKinds.signal >= 1,
    JSON.stringify(t3 === null ? null : t3.markerKinds));

  of.markers('clear');

  return {
    valid: fails.length === 0, fails, log,
    pxErr, disc, markerKinds: t3 === null ? null : t3.markerKinds,
    marks: drawn.markers,
  };
})()
