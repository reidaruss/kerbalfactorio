// RN-121: THE SKELETAL-PLAYBACK GATE. Does this client play an authored
// AnimationClip on screen, measured on pixels rather than on a report field?
//
//   node tools/smoke/run.mjs --scenario=walk --props=0 --sundot=0.30 \
//     --url=http://127.0.0.1:5173/ --evalfile=tools/smoke/probes/animgate.js \
//     --evalargs='{"expectAnim":true}'
//   node tools/smoke/run.mjs --scenario=walk --props=0 --sundot=0.30 --anim=0 \
//     --url=http://127.0.0.1:5173/ --evalfile=tools/smoke/probes/animgate.js \
//     --evalargs='{"expectAnim":false}'
//
// NAMED FAILURE MODES, before measuring (INSTRUMENTS.md): a T-pose/rest pose on
// screen is "the mixer is not ticking"; a mesh collapsed to the origin is a
// bind-matrix mismatch; a clip that plays in the validator but not the client
// is two loaders configured differently. The first is the one this probe can
// produce ON PURPOSE via ?anim=0, which is what makes the positive reading
// attributable to the mixer and nothing else.
//
// THE PROPERTY, not the magnitude. The Idle clip is authored at EXACTLY 2.0 s
// (121 authored frames, first key at t=0 by DW-34). A playing cyclic clip must
// make the frame at t and t+2.0 nearly identical and the frame at t and t+1.0
// maximally different; a frozen build must make all three captures BIT-EXACT
// (of.framehash is bit-exact within one page, RN-71; the sun is set once at
// boot and never advanced by of.run). An idle cannot prove the mixer ticks by
// its magnitude, but the CYCLE structure can: no static defect produces
// "different at half period, same at full period".
//
// The fixture is asserted before the behaviour (GP-142/GP-145): expectAnim
// comes in from the command line and is checked against the avatar's own
// published animLive, so a URL that silently dropped ?anim=0 fails by name
// instead of green-lighting the wrong branch.
(async () => {
  const of = window.__of;
  const expect = OF_ARGS && typeof OF_ARGS.expectAnim === 'boolean'
    ? OF_ARGS.expectAnim : true;

  // Arms against the sky: pitch up so the lower-third view model is the only
  // near geometry in frame, and no tree or pond contributes animated pixels.
  of.look(0, 18);
  await of.run(1.0); // crossfades done (FADE_SECS 0.15), state settled on idle
  await of.settle(8);

  const av = of.stats().avatar;
  const fixtureOk = av !== null && av.animLive === expect
    && av.bodyLoaded === true && av.armsLoaded === true;

  const TX = 48, TY = 27;
  const grab = async () => {
    await of.settle(4);
    return of.framehash(TX, TY);
  };
  // readPixels is BOTTOM-LEFT origin (Loop.countHoles states it), so tile row
  // 0 is the BOTTOM of the screen, which is where the FP arms live. `strong`
  // counts tiles over 2.5 luminance counts: pose motion reads tens of counts,
  // while the sub-count residue of float mixer-time modulo at a full period
  // reads under 2.5 everywhere or the cycle is not a cycle.
  const tileDiff = (a, b) => {
    let moved = 0, strong = 0, max = 0, movedBottom = 0, movedTop = 0;
    for (let i = 0; i < a.tiles.length; i++) {
      const d = Math.abs(a.tiles[i] - b.tiles[i]);
      if (d > max) max = d;
      if (d > 0.25) {
        moved++;
        if (Math.floor(i / TX) < Math.floor(TY * 0.55)) movedBottom++;
        else movedTop++;
      }
      if (d > 2.5) strong++;
    }
    return { moved, strong, movedBottom, movedTop, max: +max.toFixed(3) };
  };

  const runTrio = async () => {
    const h0 = await grab();
    await of.run(1.0);        // half the 2.0 s idle cycle
    const h1 = await grab();
    await of.run(1.0);        // completes one full cycle from h0
    const h2 = await grab();
    return {
      half: tileDiff(h0, h1),
      full: tileDiff(h0, h2),
      hashes: [h0.hash, h1.hash, h2.hash],
      bitExact: h0.hash === h1.hash && h1.hash === h2.hash,
    };
  };

  // First person: the arms are the subject.
  const fp = await runTrio();

  // Third person: the body is the subject. The camera sits behind the body, so
  // the moving tiles must be the body's own silhouette band, mid-frame.
  of.setView('TP');
  await of.run(1.0);
  const tp = await runTrio();
  of.setView('FP');

  const s = of.stats();
  const live = {
    // A playing 2 s cycle: strong pose motion at half period, NO strong motion
    // at full period, and the FP motion sits in the bottom band where the view
    // model is. "Strong at half, none at full" is the cycle's own signature;
    // no static defect and no monotonic drift can produce it.
    fpOk: fp.half.strong >= 10 && fp.full.strong === 0
      && fp.half.movedBottom > fp.half.movedTop,
    tpOk: tp.half.strong >= 10 && tp.full.strong === 0,
  };
  const frozen = {
    // The frozen build is the static build: three captures, one image.
    fpOk: fp.bitExact && fp.half.moved === 0 && fp.full.moved === 0,
    tpOk: tp.bitExact && tp.half.moved === 0 && tp.full.moved === 0,
  };

  return {
    expectAnim: expect,
    fixture: {
      ok: fixtureOk,
      animLive: av?.animLive ?? null,
      bodyClips: av?.bodyClips ?? 0, armClips: av?.armClips ?? 0,
      playing: av?.playing ?? '', playingFp: av?.playingFp ?? '',
    },
    fp, tp,
    verdict: expect ? live : frozen,
    ok: fixtureOk && (expect ? live.fpOk && live.tpOk
      : frozen.fpOk && frozen.tpOk),
    cost: { drawCalls: s.draw.calls, triangles: s.draw.triangles,
      programs: s.draw.programs ?? null },
  };
})()
