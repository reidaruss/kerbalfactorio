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
  // B. PRESENT. Stand at the asset's own spawn socket, which `standAt` takes
  //    in the body frame. `install.standPos` is `stationStandBody`, the one
  //    place the local-to-body transform for the spawn is written; a probe
  //    composing the quaternion itself is what PH-105 already paid for.
  // ======================================================================
  const p = st.install.standPos;
  const at = of.standAt(p[0], p[1], p[2]);
  check('the walker reached the spawn socket', at !== null, JSON.stringify(at));
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
  const al = st.axes.along;
  const yaw = A.yaw ?? (Math.atan2(dot(al, east), dot(al, north)) * 180) / Math.PI;
  of.look(yaw, -2);
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
  // C. HOME. Not politeness: `run.mjs` settles on terrain convergence and a
  //    walker left in orbit hangs the runner (PH-89).
  // ======================================================================
  of.standAt(home[0], home[1], home[2]);
  await sleep(1.0);
  const back = of.stats().stationDraw;
  check('and it stops drawing again once the player leaves',
    back?.visible === false, JSON.stringify(back));

  return { valid: fails.length === 0, fails, absent, present, delta,
    station: { id: st.id, altM: r3(st.deckR - 600000), proxies: st.proxies },
    png };
})()
