// DOES THE SHADOW CONTACT REACH THE PIXEL, AND WHAT DOES EACH PIECE OF IT COST?
// The one-binary instrument for RN-30.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4195/ \
//     --width=1280 --height=720 --evalfile=tools/smoke/probes/contact.js \
//     --evalargs='{"lat":12,"lon":150,"yawDeg":300,"pitchDeg":-10}'
//
// EVERYTHING HERE IS A MATCHED PAIR TAKEN INSIDE ONE PAGE, and that is not a
// convenience. This lane's claims are all differences of a few counts on ground
// that is streamed, lit by a moving sun and re-scattered on every chunk build,
// so two page loads cannot hold camera, sun and resident chunk set equal (RN-13
// cost a whole invalid before/after pair to exactly that). The three effects are
// therefore flipped through runtime handles the client publishes for this
// purpose: `__ofPost.setContact`, `__ofProps.setBaseShade`, `__ofAtmos.setAerial`.
//
// THREE CONTROLS, and each one is chosen so that a wrong answer is impossible to
// mistake for a right one:
//
//   SKY. The sky quad writes no depth, so the contact march must read it as
//   background and return exactly 1.0; and the aerosol term is reachable only
//   from a call site with a finite distance to geometry, so the sky quad cannot
//   call it at all. Both therefore predict a sky delta of EXACTLY ZERO, not a
//   small number. A sky that moves at all falsifies the confinement, which is
//   precisely how the first aerial-perspective attempt was caught and reverted.
//
//   TOGGLE COUNT. `setBaseShade` returns how many batches it touched and
//   `setContact` reports whether the pass actually ran. A measurement over an
//   effect that never ran is the failure this project has already shipped once
//   (RN-10 defect 4), so "it did something" is asserted separately from "it did
//   the right thing".
//
//   DENOMINATOR FLOOR. `1 - with/without` divides by nothing on an already-black
//   pixel and reads 1.0, which passed a percentile check on pixels the effect
//   never touched (RN-12). Every ratio below is computed only where the
//   reference pixel is above a floor, and the pixel count it was computed over
//   is reported next to it.
(async () => {
  const of = window.__of;
  const post = window.__ofPost;
  const props = window.__ofProps;
  const atmos = window.__ofAtmos;
  if (!post || !props || !atmos) {
    throw new Error('contact.js: missing a runtime handle: '
      + `__ofPost=${!!post} __ofProps=${!!props} __ofAtmos=${!!atmos}`);
  }

  const yaw = OF_ARGS.yawDeg ?? 300;
  const pitch = OF_ARGS.pitchDeg ?? -10;
  const sunT = OF_ARGS.sunT ?? 0.30;
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;

  // Same DOM-walk the world-art probe uses: hide every sibling of the canvas at
  // every ancestor level. A flat sweep of document.body.children leaves the
  // overlay up, because the canvas and the HUD share a wrapper.
  let node = document.querySelector('canvas');
  while (node !== null && node.parentElement !== null) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib !== node) sib.style.display = 'none';
    }
    node = node.parentElement;
  }

  const w0 = of.world();
  of.teleport(lat, lon, 2.0);
  of.setTime(sunT);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  of.look(yaw, pitch);
  of.setTime(sunT);           // RE-PIN: the wait above ate sim time (RN-13).
  await of.settle(30);

  let W = 0;
  let H = 0;
  /** The presented frame as raw RGBA. */
  const grab = async () => {
    of.setTime(sunT);
    await of.settle(8);
    const bmp = await createImageBitmap(await of.screenshot());
    W = bmp.width; H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    bmp.close();
    return d;
  };

  /**
   * How much did `b` darken relative to `a`, over one horizontal band?
   * `a` is the reference (effect OFF) and is also the denominator, so it is the
   * one that carries the floor.
   */
  const band = (a, b, y0f, y1f) => {
    const y0 = Math.round(H * y0f);
    const y1 = Math.round(H * y1f);
    let n = 0; let sum = 0; let moved = 0; let peak = 0;
    const all = [];
    for (let y = y0; y < y1; ++y) {
      for (let x = 0; x < W; ++x) {
        const i = (y * W + x) * 4;
        const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
        const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        if (la < 12) continue;          // THE FLOOR. See the header note.
        const dk = 1 - lb / la;
        sum += dk; n++;
        if (Math.abs(la - lb) > 2) moved++;
        if (dk > peak) peak = dk;
        all.push(dk);
      }
    }
    all.sort((p, q) => p - q);
    const k = Math.max(1, n);
    return {
      px: n,
      meanDarkening: +(sum / k).toFixed(4),
      p99: +(all[Math.min(all.length - 1, Math.floor(all.length * 0.99))] ?? 0).toFixed(4),
      peak: +peak.toFixed(4),
      movedFraction: +(moved / k).toFixed(4),
    };
  };

  /** Absolute channel movement, for a control that must read exactly zero. */
  const control = (a, b, y0f, y1f) => {
    const y0 = Math.round(H * y0f);
    const y1 = Math.round(H * y1f);
    let n = 0; let sum = 0; let peak = 0;
    for (let y = y0; y < y1; ++y) {
      for (let x = 0; x < W; ++x) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; ++c) {
          const d = Math.abs(a[i + c] - b[i + c]);
          sum += d; n++;
          if (d > peak) peak = d;
        }
      }
    }
    return { samples: n, meanAbs: +(sum / Math.max(1, n)).toFixed(4), peak };
  };

  const NEAR = [OF_ARGS.nearBand0 ?? 0.62, OF_ARGS.nearBand1 ?? 0.88];
  const MID = [OF_ARGS.midBand0 ?? 0.42, OF_ARGS.midBand1 ?? 0.52];
  const SKY = [OF_ARGS.skyBand0 ?? 0.05, OF_ARGS.skyBand1 ?? 0.15];

  // --- everything on, which is the shipped state.
  post.setContact(true); props.setBaseShade(true); atmos.setAerial(true);
  const all = await grab();
  const stateOn = post.state();

  // --- 1. CONTACT SHADOWS. One flag, one frame apart.
  post.setContact(false);
  const noContact = await grab();
  const contactRanOff = post.state().contactRan;
  post.setContact(true);

  // --- 2. BASE-CONTACT GRADIENT baked into the foliage vertices.
  const shadedBatches = props.setBaseShade(false);
  const noBase = await grab();
  props.setBaseShade(true);

  // --- 3. AERIAL PERSPECTIVE. Sigma to zero makes ofAtmoAerial the identity.
  atmos.setAerial(false);
  const noAerial = await grab();
  const aerosolOff = atmos.aerosol();
  atmos.setAerial(true);
  const aerosolOn = atmos.aerosol();

  // --- 4. COST. Each effect off for a sustained run, frame ring read AFTER the
  // run rather than after a capture: every grab above stalls the pipeline on a
  // readPixels, so reading the ring next to one measures the instrument.
  const timed = async (label, set) => {
    set();
    await of.run(OF_ARGS.timeSecs ?? 4.0);
    const f = of.stats().frameMs;
    const c = of.stats().draw.calls;
    return { label, p50: f.p50, p95: f.p95, p99: f.p99, worst: f.worst, drawCalls: c };
  };
  // INTERLEAVED, not one A then one B. This machine runs several lanes at once
  // and its frame ring drifts by more over a minute than any of these effects
  // costs, so an A/B/A/B/A/B order with medians is the only ordering in which
  // the drift cancels instead of being attributed. RN-10 learned this the same
  // way and published its per-effect deltas as unresolved rather than as
  // numbers; the honest output here is a median and a spread, not a delta.
  const cost = [];
  const reps = OF_ARGS.reps ?? 3;
  for (let i = 0; i < reps; ++i) {
    cost.push(await timed('all on', () => {
      post.setContact(true); atmos.setAerial(true);
    }));
    cost.push(await timed('contact off', () => {
      post.setContact(false); atmos.setAerial(true);
    }));
    cost.push(await timed('aerial off', () => {
      post.setContact(true); atmos.setAerial(false);
    }));
    cost.push(await timed('both off', () => {
      post.setContact(false); atmos.setAerial(false);
    }));
  }
  post.setContact(true); atmos.setAerial(true);
  const median = (label) => {
    const v = cost.filter((c) => c.label === label).map((c) => c.p50)
      .sort((a, b) => a - b);
    return +(v[Math.floor(v.length / 2)] ?? 0).toFixed(2);
  };
  const medians = {
    allOn: median('all on'), contactOff: median('contact off'),
    aerialOff: median('aerial off'), bothOff: median('both off'),
  };

  const w = of.world();
  return {
    valid: w.tick > w0.tick && W > 0 && shadedBatches > 0 && stateOn.contactRan === true,
    camera: {
      lat, lon, yawDeg: yaw, pitchDeg: pitch, sunT, biome: w.biome,
      converged: w.chunks.converged, convergeSpins: spin, viewport: [W, H],
    },
    // Did the switches actually switch? Asserted apart from what they did.
    handles: {
      contactRanWhenOn: stateOn.contactRan,
      contactRanWhenOff: contactRanOff,
      sunWorld: stateOn.sun,
      shadedBatches,
      aerosolOn, aerosolOff,
      tuning: {
        csLengthM: stateOn.csLengthM, csSteps: stateOn.csSteps,
        csStrength: stateOn.csStrength,
      },
    },
    contact: {
      near: band(noContact, all, NEAR[0], NEAR[1]),
      mid: band(noContact, all, MID[0], MID[1]),
      // MUST be exactly zero: the sky writes no depth, so the march reads it as
      // background and returns 1.0, and 1.0 through a multiply blend is identity.
      skyControl: control(noContact, all, SKY[0], SKY[1]),
    },
    baseShade: {
      near: band(noBase, all, NEAR[0], NEAR[1]),
      mid: band(noBase, all, MID[0], MID[1]),
      // MUST be exactly zero: the gradient lives on foliage vertices and the sky
      // is a quad with no colour attribute.
      skyControl: control(noBase, all, SKY[0], SKY[1]),
    },
    aerial: {
      near: band(noAerial, all, NEAR[0], NEAR[1]),
      mid: band(noAerial, all, MID[0], MID[1]),
      // THE CONTROL THAT FAILED LAST TIME, and the whole reason the term was
      // rewritten as a separate entry point rather than retuned. Confinement by
      // PATH predicts exactly zero here; confinement by scale height predicted a
      // small number and delivered sky saturation 0.494 to 0.410.
      skyControl: control(noAerial, all, SKY[0], SKY[1]),
    },
    cost, costP50Medians: medians,
  };
})()
