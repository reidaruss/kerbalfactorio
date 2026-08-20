// grasswind.js: DOES THE CARPET ACTUALLY MOVE, AND DOES IT MOVE WITH THE PROPS?
// RN-2145.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 --heartbeat=45 \
//     --evalfile=tools/smoke/probes/grasswind.js --evalargs='{}'
//
// The two controls, each of which must make the motion go away:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 --wind=0 \
//     --evalfile=tools/smoke/probes/grasswind.js --evalargs='{"still":1}'
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 --grass=0 \
//     --evalfile=tools/smoke/probes/grasswind.js --evalargs='{"props":1}'
//
// THE METHOD, and it is a matched pair inside ONE settled frame sequence rather
// than two page loads, which is PropWind's own reason for having `freeze` at
// all: a reload cannot hold the camera, the streamed chunk set and the sun
// equal, so a before/after across two loads measures the scene as much as the
// term. The wind clock is pinned at three offsets in one process and the
// FRAME HASH is read at each.
//
// WHAT A DIFFERENCE PROVES AND WHAT IT DOES NOT. Three differing hashes prove
// that SOMETHING in the frame moves with the wind clock; they do not prove the
// carpet is what moved, because the props are hooked to the same clock. That is
// what the `props` arm is for: with `?grass=0` the props still sway, so the
// motion that arm measures is the props' alone, and the difference between the
// two arms is the carpet's contribution. The `still` arm (`?wind=0`) removes
// the hook entirely and must produce three IDENTICAL hashes; if it does not,
// something else in the frame is moving and neither of the other two arms means
// what it says.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const w = window.__ofWind;
  if (!w) return { valid: false, why: 'no __ofWind' };
  const sleep = (n) => of.run(n);
  const fails = [];

  of.teleport(A.lat ?? -7.9675, A.lon ?? 116.53189, 2.0);
  await sleep(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
  await sleep(1.5);
  of.look(A.yaw ?? 150, A.pitch ?? -12);
  await sleep(0.5);

  // Three offsets rather than two. The harmonics are incommensurate on purpose
  // (PropWind's note), but two samples can still land near a still point of one
  // of them by luck, and a claim about motion that rests on one comparison is a
  // coin flip. Three gives two independent comparisons.
  const OFFSETS = [0, 1.9, 3.7];
  const shots = [];
  for (const t of OFFSETS) {
    w.freeze(t);
    await sleep(0.4);
    shots.push(of.framehash(48, 27));
  }
  w.thaw();

  // A HASH EQUALITY WOULD BE THE WRONG TEST AND animgate.js SAYS WHY: this
  // scene is not bit-exact across `of.run()` even with every mixer frozen, so a
  // bare inequality proves nothing and a bare equality would never happen. What
  // is measured instead is the MAGNITUDE of the change, per 48x27 tile of mean
  // luminance, which has a floor an arm can be compared against.
  const delta = (a, b) => {
    let mx = 0, sum = 0;
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = Math.abs(a.tiles[i] - b.tiles[i]);
      if (d > mx) mx = d;
      sum += d;
    }
    return { max: Math.round(mx * 100) / 100,
      mean: Math.round((sum / a.tiles.length) * 100) / 100 };
  };
  const d01 = delta(shots[0], shots[1]);
  const d12 = delta(shots[1], shots[2]);
  // THE CLAIM IS ON THE MEAN AND NOT ON THE MAX, and the reason is a
  // measurement rather than a preference. With `?wind=0` and the carpet
  // correctly still, the mean tile change falls to 0.50 to 0.57 counts while
  // ONE tile still moves by 34.4: there is a single localised thing in this
  // frame that changes across an `of.run()` and it is not the wind (the mean
  // moved 6x, the max did not move at all). Asserting on the max would be
  // RN-1906's outlier contamination exactly, where two rocks entering a strip
  // moved iqr by 36 per cent against a row std of 1.5. The max is REPORTED so
  // the outlier is visible rather than hidden, and the bar is on the mean.
  const moved = Math.max(d01.mean, d12.mean);
  const maxTile = Math.max(d01.max, d12.max);

  const still = A.still === 1;
  if (still && moved > 0.8) {
    fails.push(`?wind=0 and the mean tile still moves by ${moved} counts, so `
      + 'something outside the wind hook is moving and no other arm is clean');
  }
  if (!still && moved < 1.5) {
    fails.push(`only ${moved} counts of mean tile motion across three wind `
      + 'offsets: nothing measurable is swaying');
  }

  return {
    valid: fails.length === 0,
    arm: still ? 'still' : (A.props === 1 ? 'props' : 'on'),
    fails,
    offsets: OFFSETS,
    tileDelta: { t0t1: d01, t1t2: d12, meanMoved: moved, maxTile },
    hashes: shots.map((s) => s.hash),
    wind: w.state(),
    grass: window.__ofGrass ? window.__ofGrass.report().rungs
      .map((r) => ({ rung: r.rung, instances: r.instances })) : null,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
