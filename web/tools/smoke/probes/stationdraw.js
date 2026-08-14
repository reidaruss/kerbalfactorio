// RN-822. THE STATION IS DRAWN, AND HERE IS THE FRAME.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5188/ --scenario=walk \
//     --sandbox=1 --evalfile=tools/smoke/probes/stationdraw.js \
//     | node tools/smoke/writeshot.mjs docs/screenshots/RN822_station_inside.png
//
// `stationwalk.js` proved the PLACE and `stationvisit.js` proved the DOOR. Both
// were green while the station had no mesh in any scene, which is the whole
// reason this file exists: every instrument the station had could pass with
// nothing on screen, because none of them ever asked the renderer a question.
//
// THE CAPTURE IS THE PROBE'S OWN AND NOT `--out`'s, and that is forced rather
// than preferred. `run.mjs` fires `--out` after `settle()`, and `settle()` waits
// for terrain convergence; a walker parked 400 km up with the streamer chasing
// a surface he is nowhere near never converges (PH-89). So the frame is grabbed
// here, in the same task as the render, and `writeshot.mjs` decodes it. The
// probe then walks the player back down before it resolves, for the same reason
// every other station probe does.
//
// THE INVARIANT TABLE IS TAKEN BOTH WAYS AND THE ORDER MATTERS. Absent first,
// from the ground, where the station is 400 km away and behind the near
// camera's far plane; present second, from inside the hall. Taking them the
// other way round would measure a warmed-up renderer against a cold one and
// attribute the difference to the station: `programs` and `geometries` are
// CUMULATIVE in three's `info.memory`, they never fall, and a program compiled
// for the station stays compiled after it is culled. So the table reports the
// delta AND says which of its columns can legitimately be non-zero on a cull.
//
// OF_ARGS:
//   { "png": false }   skip the capture (the numbers still come back).
//   { "yaw": <deg> }   override the framing.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'undefined' ? {} : OF_ARGS;
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const sleep = (n) => of.run(n);

  await sleep(0.8);
  if (of.world().player === null) return { valid: false, why: 'no character' };
  if (typeof of.station !== 'function') return { valid: false, why: 'no __of.station' };
  if (typeof of.standAt !== 'function') return { valid: false, why: 'no __of.standAt' };
  // CE-54. The verb this probe now arrives through. A build without it is a
  // build in which `standAt` still boards nothing, so saying so beats running.
  if (typeof of.standAboard !== 'function') {
    return { valid: false, why: 'no __of.standAboard: rebuild (CE-54)' };
  }
  if (typeof of.carrier !== 'function') return { valid: false, why: 'no __of.carrier' };
  const st = of.station();
  if (st === null) return { valid: false, why: 'no station record: drop ?station=0' };
  if (st.install === null) return { valid: false, why: 'the station never installed' };
  // The build ghost covers the viewport when a slot is armed. Every capture in
  // this suite disarms first.
  of.build(0);
  of.setTime(A.timeOfDay ?? 0.35);

  const home = of.world().player.feet.slice();
  /** The six columns the brief asks for, plus the two the gate is made of. */
  const table = () => {
    const s = of.stats();
    const d = of.stats().stationDraw;
    return {
      drawCalls: s.draw.calls,
      programs: s.draw.programs,
      triangles: s.draw.triangles,
      geometries: s.draw.geometries,
      textures: s.draw.textures,
      vramMB: s.vramEstimateMB,
      stationVisible: d?.visible ?? null,
      stationEyeDistM: r3(d?.eyeDistM ?? NaN),
      stationFarPlaneM: d?.farPlaneM ?? null,
      stationStaleMaxM: d?.staleMaxM ?? null,
      stationDrawnParts: d?.drawnParts ?? null,
      budget: s.budget.drawCalls,
    };
  };

  // ======================================================================
  // A. ABSENT. On the ground, 400 km under it. The station must not draw,
  //    and the REASON must be the camera's own far plane rather than a
  //    visibility flag somebody set: `eyeDistM` and `farPlaneM` are both
  //    published so the inequality can be checked rather than trusted.
  // ======================================================================
  await of.settle(20);
  const absent = table();
  check('the station does not draw from the ground',
    absent.stationVisible === false, JSON.stringify(absent));
  check('and it is beyond the near camera, which is WHY',
    absent.stationEyeDistM > absent.stationFarPlaneM,
    `${absent.stationEyeDistM} m against a ${absent.stationFarPlaneM} m far plane`);
  check('and the distance is the orbit, not a placeholder',
    absent.stationEyeDistM > 3.5e5 && absent.stationEyeDistM < 4.5e5,
    `${absent.stationEyeDistM} m`);

  // ======================================================================
  // B. PRESENT. Stand on the deck, ABOARD THE STATION'S FRAME (CE-54).
  // ======================================================================
  //
  // THIS SECTION USED TO CALL `of.standAt` AND IT WAS WRONG TWICE (RN-1412).
  // Both halves produced a BLACK FRAME WITH A PERFECT REPORT, which is the
  // only reason this file is worth reading:
  //
  //   1. THE AIM WAS STALE. The target was composed from `install.standPos`
  //      and `install.pos`, which are written ONCE at install. Anchorage has
  //      travelled by the time this probe runs, so the socket the probe aimed
  //      at was measured 5,352 m from the live deck: outside the 28.64 m bound,
  //      so not even the per-tick membership rule could catch it (`ruleBoarded`
  //      stayed 0 for the whole run).
  //   2. THE VELOCITY WAS ZEROED. `standAt` puts the feet somewhere and zeroes
  //      the ABSOLUTE velocity, so even a perfectly aimed walker is one the
  //      deck leaves behind at 1879.2552 m/s. Measured from the socket: the
  //      deck is 1,002 m away after 0.53 s and 14,032 m after 7.47 s, while the
  //      walker free-falls at exactly g*t (26.371 m/s at 7.47 s).
  //
  // And through all of it `stationDraw` reported `visible: true` and
  // `drawnParts: 2`, because the station IS drawn: it is a speck kilometres
  // away and still inside the 100 km far plane. EVERY COLUMN OF THE OLD REPORT
  // WAS TRUE AND THE STATION WAS NOT IN SHOT. Section D below is the answer to
  // that: the frame is read in pixels, and it is read on the fraction of it
  // that is near geometry rather than on brightness, because the failing frame
  // is not dark (measured: 13.79 mean luma of correctly drawn planet and
  // stars).
  //
  // `standAboard` takes the STATION'S OWN AUTHORED LOCAL frame (+X along the
  // spine, +Y radial, +Z across) and resolves it against the LIVE pose, so
  // there is no install record in this probe any more and no quaternion rebuilt
  // here (PH-105's lesson, and standing rule 11). With no argument it seats at
  // the asset's own spawn socket, through the same `seatOnStationDeck` the
  // `visit:station` row presses.
  //
  // `atX` frames the OTHER picture: stand on the spine centreline at a chosen
  // station-local x and look back down the corridor, which is the view that
  // shows whether the hall mouth is a doorway or a wall.
  const deckBoundM = of.carrier('mounts').solid.cr;
  const aboard = A.atX === undefined
    ? of.standAboard() : of.standAboard(A.atX, 0.6, 0);
  check('the walker reached the deck', aboard.error === undefined,
    JSON.stringify(aboard));
  check('and it is ABOARD the station\'s frame, which is what standAt could not do',
    aboard.carrier === 'station:anchorage', JSON.stringify(aboard.carrier));
  // THE ARRIVAL CARRIES THE STATION. 0.05 m/s of slack for the seat point's own
  // lever arm, which is `stationboard.js`'s number and its argument: the frame
  // rotates, so `pointVelocity` at a socket 4 m off the origin differs from the
  // origin's by up to 7.6e-3 m/s. It still discriminates absolutely against the
  // defect, which reads ~0 here.
  const STATION_MS = 1879.2551715283678;
  check('and arrived CARRYING it: the defect reads ~0 m/s here',
    Math.abs(aboard.speedMS - STATION_MS) < 0.05,
    `|vel| ${aboard.speedMS} m/s against ${STATION_MS}`);
  check('and the feet are INSIDE the deck bound, not kilometres off a stale socket',
    aboard.deckDepthM < 0, `${aboard.deckDepthM} m of depth (negative is inside)`);
  await sleep(1.2);
  const w = of.world().player;
  check('and is standing on the deck 400 km up', w.grounded === true && w.onDeck === true,
    JSON.stringify({ grounded: w.grounded, onDeck: w.onDeck }));

  // Aim down the spine, which is the station's own local +X, read off
  // `st.axes` rather than rebuilt. Standing rule 11: a probe that rebuilt the
  // rotation would agree with itself whatever the station did.
  //
  // `yawOf` is `stationwalk.js`'s, verbatim, and it is not a screen-space
  // atan2 of the axis: yaw is measured in the LOCAL TANGENT FRAME at the
  // player's own radial, so it has to be projected onto that frame's east and
  // north first. The first version of this probe took `atan2(along.x, along.z)`
  // straight off the body-frame axis, which is a different frame entirely, and
  // pointed the camera at a wall.
  const u = (() => {
    const f = of.world().player.feet;
    const l = Math.hypot(f[0], f[1], f[2]) || 1;
    return [f[0] / l, f[1] / l, f[2] / l];
  })();
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const east = (() => {
    const e = [u[2], 0, -u[0]];
    const l = Math.hypot(e[0], e[1], e[2]);
    return l < 1e-9 ? [1, 0, 0] : [e[0] / l, e[1] / l, e[2] / l];
  })();
  const north = [u[1] * east[2] - u[2] * east[1], u[2] * east[0] - u[0] * east[2],
    u[0] * east[1] - u[1] * east[0]];
  // RE-READ, NOT `st.axes`. CE-46: a probe's own snapshot ages now. `st` was
  // taken before the walker moved and the station has turned since; aiming at
  // an axis measured tens of seconds ago points the camera slightly down the
  // wrong corridor for the same reason `install.pos` aimed the feet at empty
  // space. The one line that reads the axis reads it at the tick it is used.
  const al = of.station().axes.along;
  const fwd = (Math.atan2(dot(al, east), dot(al, north)) * 180) / Math.PI;
  // `back: true` turns round and looks AFT down the spine, which from the
  // vestibule is the hall mouth head on.
  const yaw = A.yaw ?? (A.back === true ? fwd + 180 : fwd);
  of.look(yaw, A.pitch ?? -2);
  await of.settle(20);
  const present = table();

  check('the station draws when the player is inside it',
    present.stationVisible === true, JSON.stringify(present));
  check('both stems are placed', present.stationDrawnParts === 2,
    String(present.stationDrawnParts));
  // THE REBASE AUDIT, AND IT IS A HARD ZERO. The drawn matrix is read back off
  // the BatchedMesh and re-derived from the f64 body-frame pose through
  // `origin.toEngine`, rounded the way the GPU rounded it. A non-zero here
  // reads for exactly one reason and its magnitude names the delta.
  check('and it is drawn where it actually is', present.stationStaleMaxM === 0,
    `${present.stationStaleMaxM} m of stale engine transform`);
  check('the draw budget survived it', present.budget !== 'FAIL', present.budget);

  const delta = {};
  for (const k of ['drawCalls', 'programs', 'triangles', 'geometries', 'textures',
    'vramMB']) delta[k] = Number((present[k] - absent[k]).toFixed(3));
  // The station is TWO instances of ONE batch, so the honest expectation for
  // the scene pass is small and positive. It is published rather than asserted
  // tightly, because the two frames are not otherwise matched: one is on
  // terrain with a factory in reach and the other is in orbit with neither.
  check('drawing the station cost draw calls, so something was actually drawn',
    delta.drawCalls !== 0 || present.triangles !== absent.triangles,
    JSON.stringify(delta));

  // ======================================================================
  // C. THE EYE STAYED ABOARD ACROSS THE SETTLE (CE-54, RN-1412's gate).
  // ======================================================================
  //
  // `of.settle(20)` is SECONDS of wall clock, and that is the window the defect
  // lived in: the checks above are taken AFTER it, so a walker who left during
  // it is a walker every column above describes correctly and from 19 km away.
  // The old file measured the settle at 1.52 s by dividing its own miss by a
  // station speed of 7.67 km/s. Both figures were wrong: Anchorage travels at
  // 1879.2552 m/s (core-engine.md section 5d; the 7.5 km/s in `SpaceStation.ts`
  // is Earth's low orbit and is 4.08x out), and the settle actually ran ~6.2 s.
  //
  // So the gate is a DISTANCE, taken after the settle, against the deck's own
  // published bound rather than a typed metre.
  const ride = of.carrier('census');
  check('THE EYE IS STILL INSIDE THE DECK BOUND AFTER THE SETTLE',
    present.stationEyeDistM < deckBoundM,
    `${present.stationEyeDistM} m from the station against its own `
    + `${deckBoundM} m bound. Reproduced here, the pre-CE-54 arrival reads `
    + '6,215.659 m at this line (RN-1412 reported 11,653.895 m on its own '
    + 'settle) and still reports visible:true, drawnParts:2');
  check('...and the walker is still riding it, by the membership predicate',
    ride.ride.carrier === 'station:anchorage' && ride.aboard?.insideBoard === true,
    JSON.stringify({ carrier: ride.ride.carrier, aboard: ride.aboard }));
  check('...at the station\'s own speed, not decaying toward the body frame',
    Math.abs(Math.hypot(...ride.vel) - STATION_MS) < 1.0,
    `|vel| ${Math.hypot(...ride.vel)} m/s against ${STATION_MS}`);

  // ======================================================================
  // D. AND THE FRAME HAS SOMETHING IN IT. PIXELS, NOT COUNTERS.
  // ======================================================================
  //
  // THE WHOLE POINT OF RN-1412. Every counter in section B passed while the
  // picture was empty, because `visible`, `drawnParts` and `drawCalls` all
  // answer "did the renderer submit the station", and none of them answers "is
  // it in shot". A speck 19 km down the far plane satisfies all three.
  //
  // The reader is `airless.js`'s, verbatim in method: `readPixels` off the
  // drawing buffer (the HUD is DOM, so it is already excluded) and Rec.709 luma
  // on the DISPLAY values, because the composite has already sRGB-encoded them
  // and decoding here would measure a different quantity than every other luma
  // number in this suite.
  const shot = (() => {
    const cv = document.getElementById('of-canvas');
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true })
            || cv.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl === null) return null;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, lit = 0, bright = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l;
      if (l > 8) lit++;
      if (l > 40) bright++;
    }
    const n = W * H;
    return { w: W, h: H, pixels: n, meanLuma: r3(sum / n),
      litFrac: r3(lit / n), brightFrac: r3(bright / n) };
  })();
  check('the frame could be read at all', shot !== null, 'no GL context off #of-canvas');
  if (shot !== null) {
    // THE THRESHOLDS ARE MEASURED FROM BOTH STATES, AND THE FAILING ONE WAS RUN
    // RATHER THAN IMAGINED. At 1600x900, standing in the hall: meanLuma 58.168,
    // litFrac 0.991, brightFrac 0.404. The pre-CE-54 arrival, reproduced whole
    // (stale install socket, body-frame `standAt`, same aim, same settle):
    // meanLuma 13.79, litFrac 0.183, brightFrac 0.12.
    //
    // AND THAT PAIR CORRECTS THE BUG REPORT THIS FILE ANSWERS. RN-1412 called
    // the failing output a BLACK FRAME. It is not black: 13.79 mean luma is the
    // planet and the starfield, correctly drawn, with the station a speck
    // 6.2 km down the far plane. A "is the frame black" gate would have passed
    // the defect. What separates the two states is HOW MUCH OF THE FRAME IS
    // NEAR GEOMETRY, which is why the gates are set on the fraction of lit
    // pixels and on the mean, both roughly midway between the two readings and
    // both quoted beside their own failing value.
    check('THE FRAME IS FULL OF STATION, not a speck in a lot of space',
      shot.litFrac > 0.6, `${shot.litFrac} of pixels above luma 8; the defect `
      + 'reads 0.183 here and this reads 0.991');
    check('...and the frame is bright with near geometry',
      shot.meanLuma > 30, `mean luma ${shot.meanLuma}; the defect reads 13.79 `
      + '(planet and stars, no station) and this reads 58.168');
  }

  let png = null;
  if (A.png !== false) {
    const blob = await of.screenshot();
    png = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  // ======================================================================
  // E. HOME. Not politeness: `run.mjs` settles on terrain convergence and a
  //    walker left in orbit hangs the runner (PH-89).
  // ======================================================================
  // `standAt` and not `standAboard`: the ground is on no carrier, this is the
  // case CE-54 left untouched, and the walker is let go by the per-tick release
  // rule on the next tick because 400 km is well past the release radius.
  of.standAt(home[0], home[1], home[2]);
  await sleep(1.0);
  const back = of.stats().stationDraw;
  check('and it stops drawing again once the player leaves',
    back?.visible === false, JSON.stringify(back));

  return { valid: fails.length === 0, fails, absent, present, delta,
    /** CE-54. The arrival, the frame it is in, and the picture it produced:
     *  the three readings RN-1412 needed side by side. */
    aboard: { carrier: aboard.carrier, local: aboard.local,
              speedMS: aboard.speedMS, deckDepthM: aboard.deckDepthM,
              clear: aboard.clear, scannedM: aboard.scannedM,
              deckBoundM, eyeDistAfterSettleM: present.stationEyeDistM,
              stillRiding: ride.ride.carrier },
    shot,
    station: { id: st.id, altM: r3(st.deckR - 600000), proxies: st.proxies },
    png };
})()
