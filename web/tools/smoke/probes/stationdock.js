// stationdock.js: GP-285. THE STATION'S DOCK SOCKET IS A FRAME AT RUNTIME.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/stationdock.js
//
// RN-853 found the station's `socket_dock` authored 180 degrees out, facing
// back into its own hull, which under ASSET-SPECS 4.23's anti-parallel rule
// accepts a vessel arriving from INSIDE the station and refuses one arriving
// from space. RN-854 added the offline gate that would have caught it
// (`validate_glb`'s `socket_frames` block, measured off the shipped bytes).
//
// THIS IS THE OTHER HALF, AND IT IS A DIFFERENT CLAIM. The offline gate proves
// the BYTES are right. It cannot prove the axis survives the loader, the scene
// graph and the client's own station-local transform, and until GP-284 it did
// not: `learnStationSockets` called `setFromMatrixPosition` and dropped every
// rotation on the floor. So the asset could be perfect and the running game
// still had no idea which way the port pointed.
//
// **Two independent checks that are both blind in the same way are not two
// checks**, which is why this one is deliberately NOT a second copy of the
// offline gate's arithmetic. It reads the RUNNING client's own published
// frames and compares them against `contracts.json`'s declared numbers, so the
// two halves are checked against ONE contract rather than against each other.
//
// WHAT WOULD MAKE THIS VACUOUS, named before measuring: if the station were not
// installed, `sockets` would be an empty array and every `for` over it would
// pass having asserted nothing. That is `[].every(...)`, this project's most
// expensive class of green, so the count and the presence of `socket_dock` are
// asserted in their own right BEFORE any axis is looked at.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  // THE CONTRACT, transcribed from tools/blender/contracts.json's
  // `space_station.socket_frames`, which is the asset lane's own declaration
  // and the same block `validate_glb` measures the bytes against.
  const WANT = {
    socket_dock: { pos: [30.40, 2.20, 0], face: [1, 0, 0], roll: [0, 1, 0] },
    socket_entry: { pos: [26.80, 0, 0], face: [1, 0, 0] },
  };

  await sleep(1.0);
  const st = of.station ? of.station() : null;
  if (st === null || st === undefined) {
    return { valid: false, why: 'no __of.station()', fails };
  }
  if (st.error !== undefined) {
    return { valid: false, why: `station: ${st.error}`, fails };
  }

  const rows = st.sockets;
  check('the client publishes socket FRAMES at all', Array.isArray(rows),
        `sockets is ${typeof rows}. Before GP-284 the rotation was read out of `
        + 'the glb and discarded, so there was nothing to publish.');
  if (!Array.isArray(rows)) {
    return { valid: false, why: 'no socket frames on the report', fails, st };
  }
  // THE ANTECEDENT. Everything below is a loop over `rows`, and a loop over an
  // empty array asserts nothing while reading exactly like a pass.
  check('the station shipped some sockets', rows.length > 0,
        `${rows.length} sockets`);
  const byName = new Map(rows.map((r) => [r.name, r]));
  log.push(`sockets: ${rows.map((r) => r.name).join(', ')}`);

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);

  const measured = {};
  for (const [name, want] of Object.entries(WANT)) {
    const got = byName.get(name);
    if (!check(`the asset ships ${name}`, got !== undefined,
               `have [${rows.map((r) => r.name).join(', ')}]`)) continue;
    const dp = Math.hypot(got.pos[0] - want.pos[0], got.pos[1] - want.pos[1],
                          got.pos[2] - want.pos[2]);
    check(`${name} is where the contract says`, dp < 0.005,
          `contract [${want.pos}] vs runtime [${got.pos.map((v) => v.toFixed(3))}]`
          + `, ${dp.toFixed(4)} m apart`);
    // THE AXIS, WHICH IS THE WHOLE POINT. Asserted as a DOT PRODUCT against the
    // contract's unit vector rather than component by component, because that
    // is the quantity the anti-parallel rule is stated in and because a
    // component comparison passes on a vector that is right about every axis
    // and wrong about its length.
    const df = dot(got.face, want.face);
    check(`${name} FACES the way the contract says`, df > 0.9995,
          `dot(runtime face [${got.face.map((v) => v.toFixed(4))}], contract `
          + `[${want.face}]) = ${df.toFixed(6)}. A dot of about -1 is the RN-853 `
          + 'defect: a port facing into its own hull, which accepts a vessel '
          + 'arriving from inside the station.');
    check(`${name}'s face is a unit vector`, Math.abs(len(got.face) - 1) < 1e-6,
          `|face| = ${len(got.face)}`);
    if (want.roll !== undefined) {
      const dr = dot(got.roll, want.roll);
      check(`${name}'s ROLL datum matches`, dr > 0.9995,
            `dot = ${dr.toFixed(6)}. Without a roll reference two mated hulls `
            + 'are free to rotate against each other, which is the quieter half '
            + 'of RN-853 and the half nobody would have reported.');
      // AND THE FRAME IS A FRAME. Two axes that are nearly parallel describe no
      // orientation at all, and neither dot-against-contract check above can
      // see that on its own.
      const perp = Math.abs(dot(got.face, got.roll));
      check(`${name}'s face and roll are perpendicular`, perp < 1e-5,
            `|dot(face, roll)| = ${perp}`);
      measured[name] = { pos: got.pos, face: got.face, roll: got.roll,
                         faceDot: df, rollDot: dr, perp };
    } else {
      measured[name] = { pos: got.pos, face: got.face, faceDot: df };
    }
  }

  // THE SPAWN STILL WORKS, because `stationSocket` kept returning a position
  // and GP-231's arrival path reads it. A frame arriving must not move a
  // player's feet.
  check('the spawn socket is still resolvable', byName.has('socket_hall')
        || byName.has('socket_entry'),
        `have [${rows.map((r) => r.name).join(', ')}]`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    socketCount: rows.length,
    socketNames: rows.map((r) => r.name),
    measured,
    note: 'the runtime frames are compared against contracts.json, which is '
      + 'the same declaration validate_glb measures the shipped bytes against, '
      + 'so the offline gate and the running client are checked against one '
      + 'contract rather than against each other',
  };
})()
