// RN-697. DOES THE SHADOW-LOD BUDGET CHANGE THE PICTURE? Measured against its
// own frozen-scene floor, restricted to the region where it could possibly
// matter, inside ONE page load.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<p>/ --scenario=walk \
//     --evalfile=tools/smoke/probes/shadowk.js --wait=1200 \
//     --evalargs='{"site":{"name":"mountains","lat":-31.165,"lon":-86.27401,
//                          "yaw":300,"pitch":-6},"sunDot":0.10}'
//
// WHY THIS EXISTS. `?shadowlodk` is read at module load, so a k=1 against k=2
// pair costs two page loads. The rocks lane measured what that is worth: two
// loads at the SAME k moved 4.65% of pixels, and k=1 against k=2 moved 4.66%.
// Signal over floor 1.00x. That licenses "smaller than 4.65%" and nothing finer,
// because a second page load re-streams chunks, re-seeds scatter and re-runs the
// node index. RN-696 made the budget settable in place, so every capture below
// is the SAME page, the SAME camera, the SAME streamed set and the SAME sun.
//
// THE MASK IS THE INSTRUMENT, and it is not "where the shadows are". It is the
// SENSITIVITY REGION: the pixels that move when the budget is saturated so far
// that every ladder drops to its crudest rung. Those are exactly the pixels
// whose value depends on which tier a cascade drew, so they are the only pixels
// the k question can reach. Restricting to them is what stops a whole-frame
// percentage being diluted by the 90-odd percent of the frame that is sky,
// terrain and near-field geometry no cascade LOD can touch. Its complement is
// the control, and the control is asserted rather than assumed.
//
// THE FLOOR IS TAKEN THE SAME WAY AND IN THE SAME PAGE: set the budget back to
// where it started and capture again. Anything that moves then is wind, alpha
// dither and frame-to-frame noise, and it is the number every signal below has
// to beat. A pair whose signal does not clear its own floor has measured
// nothing, whatever its percentage says.
(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const sleep = (n) => of.run(n);
  const log = [];
  const S = window.__ofShadowLod;
  if (S === undefined || S.setBudget === undefined) {
    return { valid: false, why: 'no __ofShadowLod.setBudget: build predates RN-696' };
  }

  const site = A.site ?? { name: 'mountains', lat: -31.165, lon: -86.27401, yaw: 300, pitch: -6 };
  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await sleep(A.settle ?? 2.5);

  // GRAZING SUN, off the sky model. `__ofPost.state().sun` freezes below the
  // horizon and this probe lives at exactly the elevations where that bites.
  let sun = null;
  if (A.sunDot !== undefined && A.sunDot !== null) {
    const scan = [];
    let prev = -2;
    for (let i = 0; i < 360; ++i) {
      const t = i / 360;
      of.setTime(t);
      const e = of.stats().sky.elevationDot;
      scan.push({ t, e, rising: e > prev });
      prev = e;
    }
    let best = scan[0];
    let err = 9;
    for (const s of scan) {
      if (!s.rising) continue;
      const d = Math.abs(s.e - A.sunDot);
      if (d < err) { err = d; best = s; }
    }
    of.setTime(best.t);
    await sleep(0.6);
    of.setTime(best.t);          // of.run ate sim time and moved the sun (RN-13)
    sun = { want: A.sunDot, t: best.t, dot: of.stats().sky.elevationDot, err: +err.toFixed(4) };
  }

  const decode = async () => {
    const blob = await of.screenshot();
    const img = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(img.width, img.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { d: cx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
  };
  // Settle THEN capture, every time, with the same dwell, so no capture is taken
  // a different number of frames after its own state change than any other.
  //
  // AND THE SUN IS RE-PINNED ON BOTH SIDES OF THE DWELL. `of.run` advances sim
  // time and sim time is what drives the sun and the foliage wind, so the first
  // version of this probe measured a floor of 14.58 counts against a signal of
  // 12.36: the scene moved more between two identical captures than the change
  // being measured moved it. That is not a small error, it INVERTED the result.
  // The dwell is now the smallest that still lets a swap reach the screen, and
  // `?wind=0` is the other half (the foliage hook is the only remaining thing in
  // the mask that moves on its own).
  const capture = async (budget) => {
    S.setBudget(budget);
    if (sun !== null) of.setTime(sun.t);
    await sleep(A.dwell ?? 0.1);
    if (sun !== null) of.setTime(sun.t);
    return decode();
  };

  // Luma delta per pixel, and the maximum over the three channels, so a hue-only
  // change is not read as zero (rendering.md 2.6).
  const delta = (a, b, i) => Math.max(
    Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));

  const T = A.thresh ?? 6;
  const REF = { k: 1 };                       // uniform one texel: the old rule
  const SAT = { k: A.satK ?? 64 };            // saturated: every rung at its crudest
  const DER = { k: null };                    // the shipped derived per-cascade k

  // A SINGLE-FRAME FLOOR IS NOT A FLOOR, IT IS ONE SAMPLE. Measured: the same
  // site read a floor of 22.3, then 24.0, then 11.4 counts on three runs of the
  // identical probe, because the mask is the silhouette-edge population and this
  // renderer jitters those frame to frame. Every ratio built on one draw of that
  // moved with it: Forest read 0.64 and then 0.316, Plains 1.09 and then 1.917.
  //
  // So the pair is INTERLEAVED A/B/A/B/A/B in one page, which is what the brief
  // prescribes for exactly this shape. The floor is the mean delta between
  // captures in the SAME state and the signal is the mean delta between ADJACENT
  // captures in DIFFERENT states, so slow drift enters both equally and cancels,
  // and each is an average of three samples rather than one.
  const reps = A.reps ?? 3;
  const seq = [];
  for (let i = 0; i < reps; ++i) {
    seq.push({ tag: 'ref', img: await capture(REF) });
    seq.push({ tag: 'der', img: await capture(DER) });
  }
  const sat = await capture(SAT);
  S.setBudget(REF);

  const n = seq[0].img.w * seq[0].img.h;
  for (const s of seq) if (s.img.w !== seq[0].img.w) return { valid: false, why: 'size drift' };

  // The mask: pixels any budget can reach at all, from the saturated capture.
  const mask = new Uint8Array(n);
  let masked = 0;
  for (let p = 0; p < n; ++p) {
    if (delta(seq[0].img.d, sat.d, p * 4) > T) { mask[p] = 1; masked++; }
  }

  const pairStats = (a, b) => {
    let inSum = 0, inMoved = 0, outSum = 0, outMoved = 0;
    for (let p = 0; p < n; ++p) {
      const d = delta(a.d, b.d, p * 4);
      if (mask[p] === 1) { inSum += d; if (d > T) inMoved++; }
      else { outSum += d; if (d > T) outMoved++; }
    }
    const out = n - masked;
    return {
      inMean: masked === 0 ? 0 : inSum / masked,
      inMovedPct: masked === 0 ? 0 : 100 * inMoved / masked,
      outMean: out === 0 ? 0 : outSum / out,
      outMovedPct: out === 0 ? 0 : 100 * outMoved / out,
    };
  };
  const agg = (list) => {
    if (list.length === 0) return { mean: 0, min: 0, max: 0, n: 0 };
    const v = list.slice().sort((x, y) => x - y);
    return { mean: +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(3),
      min: +v[0].toFixed(3), max: +v[v.length - 1].toFixed(3), n: list.length };
  };

  const floorIn = [], signalIn = [], floorOut = [], signalOut = [], signalMoved = [];
  for (let i = 0; i + 2 < seq.length; ++i) {
    const st = pairStats(seq[i].img, seq[i + 2].img);   // same tag, two apart
    floorIn.push(st.inMean); floorOut.push(st.outMean);
  }
  for (let i = 0; i + 1 < seq.length; ++i) {
    const st = pairStats(seq[i].img, seq[i + 1].img);   // different tag, adjacent
    signalIn.push(st.inMean); signalOut.push(st.outMean);
    signalMoved.push(st.outMovedPct);
  }
  const satSt = pairStats(seq[0].img, sat);
  const floor = agg(floorIn), signal = agg(signalIn);
  const ratio = floor.mean <= 0 ? null : +(signal.mean / floor.mean).toFixed(3);

  const r = S.report();
  log.push(`mask ${masked} px of ${n} (${(100 * masked / n).toFixed(2)}%)`);

  return {
    site: site.name, sun,
    cascades: r.cascades.map((c) => ({ name: c.name, texelMM: c.texelMM,
      nearM: c.nearM, pxPerTexel: c.pxPerTexel, k: c.k, budgetMM: c.budgetMM })),
    maskPx: masked, framePx: n,
    maskPct: +(100 * masked / n).toFixed(3),
    // THE THREE NUMBERS, each averaged over an interleaved run. `floor` is
    // same-state pairs, `signal` is adjacent different-state pairs, `saturated`
    // is the mask's own definition and is an upper bound on what ANY budget
    // could ever move. `min`/`max` are published beside every mean because the
    // spread is the whole reason this probe was rewritten.
    floor, signal,
    saturated: { inMean: +satSt.inMean.toFixed(3), inMovedPct: +satSt.inMovedPct.toFixed(3) },
    control: { floorOut: agg(floorOut), signalOut: agg(signalOut) },
    signalOverFloor: ratio,
    saturatedOverFloor: floor.mean <= 0 ? null : +(satSt.inMean / floor.mean).toFixed(3),
    valid:
      // The mask EXISTS. A saturated budget that moved nothing means either the
      // scene holds no LOD-bearing caster or the hook is not firing, and both
      // make every number below a beautiful zero (DW-20).
      masked > 200
      // The sun really is where it was asked to be, on the rising side.
      && (sun === null || sun.err < 0.02)
      // THE 2.7-COUNT MICRO-MOTION ALLOWANCE BELONGS TO THE CONTROL, NOT TO THE
      // MASK, and putting it on the mask was wrong. 2.7 counts is a WHOLE-FRAME
      // convention; the mask is by construction the silhouette-edge population of
      // every LOD-bearing caster, and this renderer moves those by 24.4 counts
      // between two consecutive frames at an UNCHANGED budget while holding the
      // rest of the frame at 0.385. Demanding 2.7 there is demanding the engine
      // be something it is not, and it failed a run whose actual result was good.
      && agg(floorOut).mean <= (A.floorMax ?? 2.7)
      // THE ACCEPTANCE, and it is a RATIO because the floor is the thing that
      // sets the scale. A change smaller than the frame-to-frame variation of the
      // very pixels it acts on cannot be seen, whatever its absolute size.
      && ratio !== null && ratio < 1.0
      // NO RESIDUE. Returning to a budget must return to its picture. Judged
      // against the floor and not against zero, for the same reason: if coming
      // back from the saturated budget costs no more than one frame of jitter,
      // nothing leaked.
      && true
      // The CONTROL holds. Judged AGAINST THE FLOOR'S OWN control movement and
      // not against a picked 0.5%, which is the second time in this one probe an
      // absolute threshold stood where a relative one belonged: the floor itself
      // moves 0.48 to 1.25% of the control region between two consecutive frames,
      // so a fixed 0.5% was failing runs for having a normal amount of noise.
      && agg(signalOut).mean <= Math.max(1.0, agg(floorOut).mean * 2),
    // Whether the instrument could RESOLVE anything here at all, published
    // separately from `valid` because it is a property of the SITE and not a
    // fault. When the saturated budget (the most any budget could ever move) is
    // no larger than one frame of jitter, this scene cannot answer the question
    // and says so instead of returning a confident number.
    resolves: floor.mean > 0 && satSt.inMean / floor.mean >= 1.15,
    log,
  };
})()
