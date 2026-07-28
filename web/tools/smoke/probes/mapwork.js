// MAPWORK (WG-33): CAN THE PLAYER SEE THEIR OWN WORK ON THE MAP?
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5411/ --sandbox=1 --settle=8 \
//     --evalfile=tools/smoke/probes/mapwork.js \
//     --out=docs/screenshots/WG33_mapwork.png
//
// WHY IT EXISTS. DW-37's map read the DESIGNED height, which is by definition
// the world before the player touched it, so a dug hole, a levelled pad and a
// tunnel mouth could not reach the map at all, however it was shaded. That is
// not a shading defect and no amount of contrast would have fixed it; it is the
// map reading the wrong field. ABI 14 makes it read `surfaceHeight`, and this
// is the probe that can tell the difference.
//
// THE SHAPE OF THE PROOF IS A BEFORE AND AN AFTER OF THE SAME VIEW. The map is
// framed once, the grid the painter was handed is copied, the player digs and
// levels through their OWN keys, the map is framed again at the same span and
// centre, and the two grids are compared SAMPLE FOR SAMPLE. `__of.map('grid')`
// hands back the identical object the painter drew from, so this compares what
// the map DREW across the work, not two fresh samples that would agree with
// each other whatever the map was doing.
//
// AND IT ASSERTS THE CONTRAST, not just the depth. A hole that moved the height
// by 3 m and moved no pixels is still an invisible hole: `deltaLuma` is the
// tone difference the worked samples actually gained, read off MapContrast's
// own receipt of the two frames.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'world', 'teleport', 'dig', 'level', 'terraform']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const WANT = typeof A.spanM === 'number' ? A.spanM : 400;
  const ZOOM = 1.15;
  const MAP = () => of.map('report');
  // PLAIN TIME, never a tape. A tape writes the held-key set directly and holds
  // it, so a real M keydown dispatched after one is overwritten on the next
  // drain and the map never opens. That cost a run to learn.
  const settle = (s) => of.run(s, 60);

  await settle(1.2);
  const w0 = of.world();
  if (w0.player === null) return { valid: false, why: 'no character on foot' };
  if (of.terraform() === null) return { valid: false, why: 'no terraforming tool' };
  await of.wipe();
  of.forgetTunnels();
  await settle(1.0);

  // THE MAP, OPENED WITH THE REAL KEY and zoomed with the real hook, exactly as
  // mapshot.js does, because a view no player can reach proves nothing.
  const open = async () => {
    if (MAP().open === true) return true;
    const code = (of.input.bindings().map || [])[0];
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.5);
    return MAP().open === true;
  };
  const close = async () => {
    const code = (of.input.bindings().map || [])[0];
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await of.run(0.5);
  };
  const frame = async () => {
    if (!(await open())) return null;
    for (let i = 0; i < 400 && MAP().spanM > WANT * ZOOM; i++) {
      of.map('zoom', { mult: 1 / ZOOM }); await of.run(0.03);
    }
    for (let i = 0; i < 400 && MAP().spanM < WANT / ZOOM; i++) {
      of.map('zoom', { mult: ZOOM }); await of.run(0.03);
    }
    await of.run(0.6);
    const r = MAP();
    return { grid: of.map('grid'), spanM: r.spanM,
      contrast: r.view.drawn.contrast, painted: r.view.drawn.discoveredQuads };
  };

  // THE SITE IS CHOSEN BEFORE THE FIRST FRAME, never between the two, or the
  // map re-centres on the player and the "before" and "after" are two different
  // pieces of ground. A LEVEL PRESS ALSO NEEDS A SLOPE, and the spawn is a
  // dead-flat 150 m start pad (BodyParams.homeFlatRadiusM) blending out to
  // 600 m, so a press there is a measured no-op that proves nothing. That the
  // DEFAULT view is centred on that pad is itself half of what Reid saw.
  const S = of.world().observer;
  const DEG = 180 / Math.PI, R = of.world().bodyRadiusM;
  of.teleport(S.latDeg + ((A.offsetM ?? 1400) / R) * DEG, S.lonDeg, 2);
  await settle(2.5);

  const before = await frame();
  if (before === null) return { valid: false, why: 'the M key did not open the map' };
  if (before.grid.error) return { valid: false, why: before.grid.error };
  await close();

  // --- THE WORK, through the player's own keys and tools --------------------
  // A pad first, because levelling both cuts and fills and is the larger mark;
  // then a trench beside it, which is the smaller and harder one to see.
  of.look(A.yawDeg ?? 0, A.pitchDeg ?? -20);
  await settle(0.5);
  const lv = of.level();
  await settle(0.6);
  const digs = [];
  for (let i = 0; i < (A.strikes ?? 24); i++) {
    of.look((A.yawDeg ?? 0) + 70 + (i % 6) * 8, -30 - (i % 4) * 6);
    digs.push(of.dig());
    await of.run(0.2, 60);
  }
  await settle(1.0);
  const tf = of.terraform();

  const after = await frame();
  if (after === null || after.grid.error) {
    return { valid: false, why: 'the map would not re-frame after the work' };
  }

  // --- THE COMPARISON, sample for sample ------------------------------------
  const b = before.grid, a = after.grid;
  if (b.cols !== a.cols || b.rows !== a.rows) {
    return { valid: false, why: `grid reshaped ${b.cols}x${b.rows} -> ${a.cols}x${a.rows}` };
  }
  const n = b.cols * b.rows;
  let moved = 0, worst = 0, worstAt = -1, sum = 0;
  for (let i = 0; i < n; i++) {
    if (b.biome[i] < 0 || a.biome[i] < 0) continue;
    const d = Math.abs(a.heightM[i] - b.heightM[i]);
    if (d > 1e-6) { moved++; sum += d; }
    if (d > worst) { worst = d; worstAt = i; }
  }
  // THE LOCAL STEP AT THE WORK. A feature is visible when it differs from what
  // is next to it, so this is the height difference between the most-moved
  // sample and its four neighbours, which is what the shader turns into tone.
  let localStepM = 0;
  if (worstAt >= 0) {
    const x = worstAt % b.cols, y = (worstAt / b.cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.cols || ny >= b.rows) continue;
      const j = ny * b.cols + nx;
      if (a.biome[j] < 0) continue;
      localStepM = Math.max(localStepM, Math.abs(a.heightM[worstAt] - a.heightM[j]));
    }
  }

  // --- AND THE TONE, WHICH IS THE PART A PLAYER ACTUALLY SEES (WG-34) --------
  //
  // THE FIRST VERSION OF THIS PROBE PASSED WITHOUT PROVING ANYTHING, and that
  // is worth recording because it passed for the most flattering possible
  // reason. Its last check was `after.lumaStep >= before.lumaStep`: a frame-wide
  // mean over 2,784 samples, asked to notice a pad that moves 4 of them.
  // Measured on the run that "passed": a level press of 315 dug and 119 filled
  // cells plus 24 pickaxe strikes carried lumaStep from 4.214 to 4.300. The
  // check cleared by 0.086 on a number whose own frame-to-frame noise is larger
  // than that, and it would have cleared identically had the map drawn nothing
  // at all, because ANY change of sign passes a `>=`.
  //
  // A GLOBAL STATISTIC IS THE WRONG UNIT FOR A LOCAL QUESTION. "Can I see my
  // pad" is a question about the handful of samples the pad covers, so these
  // read the painter's OWN per-sample tones (`grid.luma`, MapContrast's
  // retained bytes) at exactly the samples whose height moved.
  const bl = b.luma, al = a.luma, am = a.lumaMask;
  const haveLuma = Array.isArray(bl) && Array.isArray(al) && Array.isArray(am)
    && bl.length === n && al.length === n;
  // How much tone the work ADDED at the samples it moved, and how far the most
  // changed of them now stands from the ground beside it. The second is the one
  // that matters: a feature is visible when it differs from its surroundings,
  // not when it differs from its own past.
  let toneMoved = 0, worstToneAt = -1, workContrast = 0, meanTone = 0;
  if (haveLuma) {
    let sumT = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (b.biome[i] < 0 || a.biome[i] < 0 || am[i] !== 1) continue;
      if (Math.abs(a.heightM[i] - b.heightM[i]) <= 1e-6) continue;
      const d = Math.abs(al[i] - bl[i]);
      sumT += d; k++;
      if (d > toneMoved) { toneMoved = d; worstToneAt = i; }
    }
    meanTone = k > 0 ? sumT / k : 0;
    if (worstToneAt >= 0) {
      const x = worstToneAt % a.cols, y = (worstToneAt / a.cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= a.cols || ny >= a.rows) continue;
        const j = ny * a.cols + nx;
        if (am[j] !== 1) continue;
        workContrast = Math.max(workContrast, Math.abs(al[worstToneAt] - al[j]));
      }
    }
  }

  const cut = lv === null ? 0 : (lv.dug ?? 0), fill = lv === null ? 0 : (lv.filled ?? 0);
  const struck = digs.filter((d) => d !== null && (d.cells ?? 0) > 0).length;
  // THE FLOORS, DERIVED AND NOT CHOSEN, each the geometric mean of the value at
  // which the claim is empty and the value actually measured. Both anchors are
  // measurements of THIS frame, not preferences:
  //
  //   toneMoved   empty at the frame's own mean adjacent tone step, because a
  //               sample that moved by less than the ground varies anyway is
  //               indistinguishable from the ground. Reverted to ABI 13 the
  //               frame read 4.214 and the work moved 0; on ABI 14 it moved 28.
  //               sqrt(4.214 x 28) = 10.8624, cleared by 2.578x.
  //   standOut    empty at 1.0, which is "the work differs from its neighbours
  //               by exactly as much as neighbours normally differ", i.e.
  //               invisible. Measured 9.07. sqrt(1 x 9.07) = 3.0116, cleared by
  //               3.012x.
  //
  // `workContrast` is compared against the frame's OWN mean adjacent tone step
  // rather than an absolute byte count, so the claim is scale-free: it survives
  // a change of palette, of zoom and of biome, and it says the thing worth
  // saying, which is that the player's work stands out FROM the natural ground.
  const STAND_OUT = typeof A.standOut === 'number' ? A.standOut : 3.0116;
  const TONE_FLOOR = typeof A.toneFloor === 'number' ? A.toneFloor : 10.8624;
  const natural = after.contrast.lumaStep;
  const checks = [
    ['the level press moved ground', cut + fill > 0],
    ['the pickaxe removed ground', struck > 0],
    ['the map grid CHANGED where the player worked', moved > 0],
    ['the worked ground moved by more than a sample of natural relief',
      worst > b.stepM],
    ['the worked sample stands proud of its neighbours', localStepM > b.stepM],
    ['the painter gave the work its own TONES', haveLuma],
    [`the worked samples changed tone (${+toneMoved.toFixed(1)} >= ${TONE_FLOOR})`,
      toneMoved >= TONE_FLOOR],
    [`the work stands out from the natural ground `
      + `(${+workContrast.toFixed(1)} >= ${STAND_OUT} x ${natural})`,
      workContrast >= STAND_OUT * natural],
  ];
  return {
    valid: true,
    spanM: Math.round(after.spanM),
    sampleSizeM: +b.sampleSizeM.toFixed(3),
    level: { dug: cut, filled: fill, quotedM: lv === null ? null : lv.flatnessM },
    digStrikes: struck,
    samplesMoved: moved, of: n,
    worstMoveM: +worst.toFixed(3), meanMoveM: moved ? +(sum / moved).toFixed(3) : 0,
    naturalStepM: +b.stepM.toFixed(4), afterStepM: +a.stepM.toFixed(4),
    localStepM: +localStepM.toFixed(3),
    haveLuma,
    toneMovedLuma: +toneMoved.toFixed(2), meanToneMovedLuma: +meanTone.toFixed(2),
    workContrastLuma: +workContrast.toFixed(2),
    naturalStepLuma: natural,
    standOutRatio: natural > 0 ? +(workContrast / natural).toFixed(2) : 0,
    toneFloor: TONE_FLOOR, standOut: STAND_OUT,
    contrastBefore: before.contrast, contrastAfter: after.contrast,
    cells: { removed: tf.removedCells, added: tf.addedCells },
    pass: checks.every((c) => c[1]),
    failed: checks.filter((c) => !c[1]).map((c) => c[0]),
  };
})()
