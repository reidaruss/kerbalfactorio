// artframe.js: THE FIVE CANONICAL ART FRAMES (RN-1405). One file, five named
// shots, each reproducible to the pose, the sun and the scene.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"forestfloor"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
// The five are the campaign plan's (docs/scope/ART-CAMPAIGN-2026-08-13.md):
//   forestfloor  the RN-352 forest site at standing eye, the frame §2.1's own
//                calibration row is taken on.
//   machine      the RN-1200 machine close-up, a smelter and a belt deck at a
//                pinned dot 0.45 sun, framed on the same box.
//   ruin         the ruin at approach, the first destination the storyline
//                sends a player to walk to.
//   basedusk     a built base under a low sun, which is the half of the cycle
//                §2b measured and no picture had ever been taken in.
//   station      the station's own hall, 400 km up, lit by nothing local.
//
// ==========================================================================
// WHY THIS FILE EXISTS AT ALL, given `artshot.js` and the `*shot.js` family
// ==========================================================================
//
// THE CAPTURE. `run.mjs --out` is a PLAYWRIGHT PAGE screenshot, so it
// photographs the DOM overlay as well as the canvas: the first frame taken for
// this pass came back with the objectives panel, an interaction tooltip and a
// progress bar over the subject. `artshot.js` hides UI by walking the canvas's
// siblings, which is correct at the instant it runs and cannot survive the HUD
// nodes that mount LATER (the tooltip appears when the aim lands on a harvest
// node, which is after the pose is set). `of.screenshot()` captures the CANVAS
// and is HUD-free BY CONSTRUCTION, which is lookdev.js's own `HUD_FREE` note,
// so every frame here goes through `writeshot.mjs` instead.
//
// THE POST TRAP, and it is asserted rather than avoided. `post/PostConfig.ts`
// switches the whole stack OFF by default whenever the run reads raw pixels
// (`?clear=` set to anything but black, or `?scenario=zfight`) and whenever the
// quality tier is `low`. A judged frame taken under either is silently
// UNGRADED, and an ungraded frame is a photograph of a pipeline nobody ships.
// Neither condition is reachable from this probe's own invocation, but "not
// reachable" is an argument and `postState.post === true` is a measurement, so
// the probe REFUSES to return a frame with the stack off. `?post=0` is still
// available deliberately, as the pass's negative control, and then the refusal
// is bypassed with `{"allowPostOff": true}` so the control can actually be
// taken and cannot be taken by accident.
//
// THE SUN IS PINNED BY ELEVATION AND THE MISS IS ASSERTED, machinemat.js's
// rule: `setSunElev` scans 720 phases and returns the CLOSEST, so an
// unreachable target comes back as the site's maximum with no complaint. Every
// shot names a dot and a tolerance, and it is re-pinned immediately before the
// capture because `of.run` drifts it (RN-13).
//
// THE NUMBERS COME BACK WITH THE FRAME. A pair of PNGs cannot say by how much
// something moved, so each shot also publishes a decode of its own capture: the
// whole frame and one NAMED BOX in the §2.1 idiom (luma, mean RGB, `warm` =
// meanR - meanB in counts, `sat`, `p05/p50/p95`, `loFrac`, `hiFrac`). The box
// is a property of the shot, listed in `SHOTS` below, and for `machine` it is
// RN-1200's own 505,20,1160,430 so the readings are comparable with that pass.
//
// AND FOR `machine` IT IS NOW MORE THAN ONE BOX, WHICH RN-1479 PROVED IT OWED
// (RN-1490). That pass routed machine materials through their authored roles
// and found RN-1200's rectangle BIT-IDENTICAL either side of the change, to the
// digit, in both arms: not a null result but a true reading of what the
// rectangle frames. 505,20,1160,430 is the smelter's plate BODY, every role on
// it is `panel`, and the `Rock` hearth columns that DID move are in frame and
// outside it. A gateway measurement that cannot see a material change by
// construction is an instrument, not a guardrail, so the manifest now carries an
// `extra` map of further named rectangles decoded from the same capture and
// published beside the canonical one. `machine`'s two are the column rectangles
// RN-1479 measured and separately showed to be deterministic under a re-run
// (0.01 luma, 0.00 iqr) while the foliage in the same frame moves 3.32 per cent
// of pixels: the columns can carry a claim and the leaves cannot.
//
// `box` KEEPS ITS NAME, ITS RECTANGLE AND ITS PLACE IN THE REPORT so every
// number any earlier pass published against it stays comparable. The extras are
// additive.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const r2 = (x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : null);
  const r3 = (x) => (Number.isFinite(x) ? Number(x.toFixed(3)) : null);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const addk = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const gd = (a, b) => len(sub(a, b));

  // ======================================================================
  // THE MANIFEST. Every field of a shot is here and nothing about a shot is
  // anywhere else, so "reproduce frame 3" is one argument and never a set of
  // remembered flags.
  //
  // `box` is [x0, y0, x1, y1] in FRACTIONS of the frame, so a shot survives a
  // resolution change; the pixel box is printed in the report beside it.
  // `sunDot` is `sky.elevationDot`, `sunTol` is the largest miss the shot will
  // accept before it refuses rather than photographing a different hour.
  // ======================================================================
  const SHOTS = {
    forestfloor: {
      scenario: 'walk', needsSandbox: false,
      lat: -19.85, lon: -72.7853, yaw: 300, pitch: -26,
      sunDot: 0.70, sunTol: 0.06,
      box: [0.4125, 0.5822, 0.5875, 0.7378],   // §2.1's groundNear, 140 px at 0.5/0.66
      why: 'the RN-352 forest site, standing eye, the §2.1 calibration pose',
    },
    machine: {
      scenario: 'walk', needsSandbox: false,
      sunDot: 0.45, sunTol: 0.02,
      box: [0.3156, 0.0222, 0.7250, 0.4778],   // RN-1200's 505,20,1160,430 at 1600x900
      // RN-1490. The two hearth-column rectangles, RN-1479's own
      // 300,0,470,600 and 1225,0,1320,560 at 1600x900. These are the ONLY
      // rectangles in this frame shown to be both deterministic across runs
      // and responsive to a material change (`?tile=stone:0.12` moves the left
      // one's iqr 11.50 -> 10.11 and leaves `box` bit-identical), which is what
      // makes them a guardrail rather than a second opinion.
      extra: {
        hearthL: [0.1875, 0.0000, 0.2938, 0.6667],
        hearthR: [0.7656, 0.0000, 0.8250, 0.6222],
      },
      why: 'the RN-1200 machine close-up: Steel, Accent and Rubber in one frame',
    },
    smelterhero: {
      // RN-1491. THE SIXTH SHOT, AND IT IS THE SAME SCENE, WHICH IS THE ONLY
      // REASON IT CAN BE ADDED HONESTLY. It runs `machine`'s own placement
      // block verbatim (same build menus, same ghost-and-press path, same
      // assertion that the smelter actually went down) and differs in exactly
      // two published fields: the standoff and the aim height. So the pair
      // `machine` / `smelterhero` is one camera move apart and not one scene
      // apart, and anything that fails in one fails identically in the other.
      //
      // 3.2 m AND +1.7 m OF AIM, both chosen against the asset rather than by
      // eye: the smelter is 4 x 4 m and 3.60 m tall (build_smelter.py's header),
      // so 3.2 m of standoff puts its 3.40 m body across most of the frame
      // width at this FOV and aiming at the socket instead of at mid-height
      // would photograph the plinth with the stack cropped off, which is the
      // mistake the `ruin` shot already recorded and fixed with `aimUpM`.
      //
      // THE BEARING WAS SWEPT AND ALL FOUR ARMS ARE RECORDED, because the one
      // thing that came out of the sweep is bigger than the framing choice.
      // Matched runs, standoff 4.6, sun pinned to the same dot 0.448 in every
      // one, box luma / warm / loFrac:
      //
      //     bearing   0   24.23  -17.68  0.673   square on the pour face
      //     bearing  90   18.02  -11.26  0.799   the service side, worst
      //     sun tangent  27.50  -17.81  0.672   a corner, per `__ofPost` sun
      //     its negation 26.41  -17.30  0.722   the opposite corner
      //
      // NONE OF THE FOUR IS LIT. Every arm puts the machine's vertical faces in
      // shade with the GROUND fully lit in the same frame (world p95 155 to
      // 197), and no bearing exists that turns a lit face toward the eye. That
      // is not a framing problem and it is reported up rather than tuned away:
      // at the campaign's own dot-0.45 pin, the smelter is read entirely by the
      // sky IBL and never by the sun, so every A0 machine frame to date is a
      // photograph of ambient. `warm` between -11 and -18 counts in all four
      // arms is the same fact in the other instrument: the subject is BLUE
      // because the sky is the only light on it.
      //
      // BEARING 90 IS CHOSEN, AND BEARING 0 IS THE INSTRUCTIVE REJECT. 0 is the
      // prettiest arm by some distance: it stands square on a face with both
      // hearth columns, the whole plate field, the collar and the roof line in
      // one frame. It is also the +X SERVICE side, which carries neither of the
      // two roles this pass moved, and it was photographed either side of the
      // change before that was noticed: canonical box 24.23 -> 24.22, the
      // `plate` rectangle 24.30 -> 24.30, both hearth columns identical to the
      // digit. A beautiful frame that cannot see the change is RN-1479's defect
      // a second time, one shot later, and it is recorded here so the next lane
      // reads the reject rather than re-running the sweep. 90 is the +Y CHARGE
      // face, which is the one the `machine` shot itself frames; it carries the
      // hood and the intake band and it was shot as a full matched pair, but it
      // shows the hood edge-on and the band at a grazing angle.
      //
      // 270 IS THE SHIPPED BEARING: the -Y POUR face, the face build_smelter.py
      // names as the one a player stands at. It is the only arm that puts the
      // firebox casting square to the camera at 0.6 m2 of screen, and the
      // casting is where the whole question is decided - a large oxide surface
      // with bright hardware bolted to it, set into a plate shell, is either
      // the Space Engineers read or it is not. It also holds the launder, the
      // keep-out ring, the placard and both hearth columns in the same frame.
      scenario: 'walk', needsSandbox: false,
      sunDot: 0.45, sunTol: 0.02,
      standoff: 4.6, aimUpM: 1.7, sunSide: true, bearingDeg: 270,
      box: [0.2500, 0.1000, 0.7500, 0.8500],
      // FIVE RECTANGLES, EACH FRAMING ONE FAMILY, so a change is attributed and
      // never inferred. `firebox` is the coaming and door leaf above the peep,
      // chosen to EXCLUDE both emissive parts: an emissive is unaffected by any
      // surface change and would only dilute the rectangle it sits in. `band`
      // is the painted keep-out ring. `plate` is clear shell to the right of
      // the casting and away from every fitting, and the two columns are the
      // refractory brick. `panel` and `stone` are untouched by this pass, so
      // `plate` and both columns are the NEGATIVE CONTROLS and must hold while
      // `firebox` and `band` move.
      extra: {
        firebox: [0.3875, 0.3444, 0.6375, 0.4167],
        band: [0.2938, 0.7611, 0.7313, 0.8200],
        plate: [0.6781, 0.2833, 0.7469, 0.6833],
        hearthL: [0.1719, 0.2222, 0.2188, 0.9111],
        hearthR: [0.8094, 0.2222, 0.8438, 0.9111],
      },
      why: 'the smelter at arm-reach: the proof-shot framing, plate and brick',
    },
    ruin: {
      scenario: 'walk', needsSandbox: false,
      sunDot: 0.35, sunTol: 0.02,
      // THE BEARING IS PART OF THE SHOT AND WAS CHOSEN AGAINST TWO REJECTS,
      // both recorded so the next lane does not re-run the sweep. Bearing 35 at
      // 42 m puts a canopy conifer squarely in front of the cella and the
      // temple reads as a grey block behind a tree. Bearing 200 is a clean
      // silhouette and is fully BACKLIT, so the whole camera-facing side is one
      // shadow value and no material claim can be judged on it. Bearing 60 at
      // 34 m keeps a sunlit face on the left, the shaded front, the stylobate
      // and the debris field, which is a value range rather than a shape.
      bearingDeg: 60, standoffM: 34, aimUpM: 4.0,
      box: [0.2800, 0.3000, 0.7400, 0.6100],
      why: 'the ruin at approach, the structure high-water mark, whole silhouette',
    },
    basedusk: {
      scenario: 'walk', needsSandbox: true,
      // dot 0.20 is `lookdev.js`'s OWN dusk rung (`wantDots` [null, 0.20, -0.02,
      // -0.40]), so this frame and the §2b table are the same hour and can be
      // read against each other. dot 0.12 was tried first and the whole frame
      // came back at world luma 15.6 with loFrac 0.86: a true reading of §2b's
      // named open problem, and not a frame anybody can judge a material on.
      sunDot: 0.20, sunTol: 0.02,
      // Bearing 210 was tried and rejected: it stands the eye behind a canopy
      // trunk that fills the right third of the frame. 260 clears it and keeps
      // the smelter's lit window, the wall block, the deck and the low-sun
      // ground plane all in one frame.
      bearingDeg: 260, standoffM: 19, aimUpM: 1.6,
      box: [0.2500, 0.3800, 0.7500, 0.7200],
      why: 'foundations, walls and machines under a low sun: §2b has no picture',
    },
    station: {
      scenario: 'walk', needsSandbox: false,
      // THE ONLY SHOT PINNED BY PHASE RATHER THAN BY ELEVATION, and it is not a
      // shortcut. `setSunElev` solves against `observer.up`, which 400 km up is
      // a radial through a hull rather than a ground normal, so "17 degrees
      // above the local horizontal" says nothing about whether any light
      // reaches the inside of a sealed hall. Pinned at dot 0.30 the frame came
      // back at world luma 2.11 and box luma 0.10, i.e. black, while every
      // other field in the report (visible true, drawnParts 2, staleMaxM 0)
      // read perfectly correct: the exact shape of a probe measuring the wrong
      // thing successfully. RN-822's own capture is at phase 0.35 and this
      // takes the same phase, and PUBLISHES the elevation it lands on rather
      // than asserting one.
      //
      // AND IT IS THE EXTERIOR, WHICH IS ALSO A CORRECTION. The plan says "the
      // station" and the interior was the assumed reading, because RN-822's
      // capture is an interior. `visit:station` lands the walker on the
      // vestibule deck at station-local (3.47, 0, 1.98), from which the
      // forward look down the spine is EMPTY SPACE, and three separate frames
      // came back at world luma 2.1 to 2.8 before one was actually looked at
      // rather than measured. Looking AFT from that same spot is the whole
      // hull against the star field, which is the harder lighting case and the
      // better target: no terrain bounce, no atmosphere, no fill, so the entire
      // read is the direct sun, the IBL and the material. `yawOff` and `pitch`
      // are a framing offset off the spine bearing and were chosen against the
      // first aft frame, which put the hull in the top right corner.
      sunMode: 'time', timeOfDay: 0.60,
      back: true, yawOff: 45, pitch: 3,
      box: [0.4200, 0.2000, 0.9800, 0.7200],
      why: 'the station exterior, 400 km up, no terrain bounce and no local fill',
    },
  };

  const name = A.shot;
  const S = SHOTS[name];
  if (S === undefined) {
    return { valid: false, why: `unknown shot '${String(name)}'`,
      shots: Object.keys(SHOTS) };
  }

  // ----------------------------------------------------------------- the gate
  // Refuse an ungraded frame before doing any work, so a misconfigured run
  // costs a second rather than a whole scene build and a wrong picture.
  const post = window.__ofPost ? window.__ofPost.state() : null;
  if (post === null) return { valid: false, why: 'no __ofPost: the post stack never built' };
  if (post.post !== true && A.allowPostOff !== true) {
    return { valid: false, shot: name,
      why: 'THE POST STACK IS OFF and this frame would be silently ungraded. '
        + 'PostConfig.ts turns it off for ?clear=, ?scenario=zfight and '
        + 'quality=low. Pass {"allowPostOff":true} only when the ungraded frame '
        + 'IS the control being taken.',
      postState: post };
  }
  if (of.game().mode !== undefined && S.needsSandbox
      && of.game().mode.sandbox !== true) {
    return { valid: false, shot: name, why: 'this shot needs --sandbox=1' };
  }

  // Freeze everything that moves on its own, so a pair differs only by the
  // change under test. lookdev.js's rule; the wind clock alone would otherwise
  // put a few thousand moving pixels into every pair.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);
  await sleep(0.6);
  of.build(0);                       // no build ghost over the frame

  // -------------------------------------------------------------- the sun pin
  // Two modes, and a shot names which. 'elev' pins an ELEVATION DOT against the
  // observer's own up, which is the right control on a ground shot and is what
  // makes two sites comparable. 'time' pins a PHASE, which is the right control
  // when "elevation above the local horizontal" is not a statement about the
  // light on the subject at all (see the station's own note above).
  const mode = A.sunMode ?? S.sunMode ?? 'elev';
  const pin = () => (mode === 'time'
    ? (of.setTime(A.timeOfDay ?? S.timeOfDay), null)
    : of.setSunElev(A.sunDot ?? S.sunDot));
  let sun = pin();

  // ======================================================================
  // THE SCENES. Each one leaves the camera where the shot wants it and
  // returns whatever the setup assertion for that shot is (DW-20): a frame
  // taken after nothing was placed is a photograph of a claim nobody tested.
  // ======================================================================
  /** Aim at a world point by MISS DISTANCE, never by brightness: a camera
   *  chosen by how bright the subject came out is a classifier that depends on
   *  the very quantity under test (machinemat.js). */
  const aimAt = (target, pitches, yaw0, spans) => {
    const missTo = (y, p) => {
      of.look(y, p);
      const a = of.aim();
      const v = sub(target, a.origin);
      const t = v[0] * a.dir[0] + v[1] * a.dir[1] + v[2] * a.dir[2];
      return t <= 0 ? Infinity
        : Math.hypot(v[0] - a.dir[0] * t, v[1] - a.dir[1] * t, v[2] - a.dir[2] * t);
    };
    let by = yaw0;
    let bp = pitches[0];
    let bm = Infinity;
    for (const step of spans) {
      let ny = by;
      let np = bp;
      for (let k = -8; k <= 8; ++k) {
        for (const dp of pitches) {
          const m = missTo(by + k * step, dp);
          if (m < bm) { bm = m; ny = by + k * step; np = dp; }
        }
      }
      by = ny; bp = np;
    }
    of.look(by, bp);
    return { yawDeg: r2(by), pitchDeg: bp, missM: r3(bm) };
  };

  let setup = {};

  if (name === 'forestfloor') {
    const w0 = of.world();
    of.teleport(S.lat, S.lon, 2.0);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    await sleep(1.0);
    sun = pin();                     // AFTER the teleport: the solve is against
    of.look(S.yaw, S.pitch);         // the observer's own up, which just moved
    setup = { teleported: true, converged: of.world().chunks.converged,
      biome: of.world().biome, tickAdvanced: of.world().tick > w0.tick };
  }

  if (name === 'machine' || name === 'smelterhero') {
    // machinemat.js's scene, and deliberately the same one: a smelter for the
    // Steel and Accent roles and a belt for Rubber, so one frame contains roles
    // whose roughness must move in DIFFERENT directions. A frame with only
    // Steel in it could not tell a per-role channel from a uniform darkening.
    const fac = () => of.game().factory;
    const eye = () => of.aim().origin;
    const yaw0 = of.world().observer.yawDeg;
    const press = async () => {
      of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
      await sleep(0.16);
    };
    const put = async (from, to) => {
      for (let p = from; p >= to; p -= 0.3) {
        of.look(yaw0, p);
        await sleep(0.035);
        const g = of.build().ghost;
        if (g === null || !g.ok) continue;
        const before = fac().buildings;
        await press();
        if (fac().buildings > before) return { pos: g.pos, cell: g.cell, pitch: p };
      }
      return null;
    };
    of.build(3);
    const smelter = await put(-14, -46);
    if (smelter === null) return { valid: false, shot: name, why: 'the smelter would not go down' };
    of.build(2);
    const belt = await put(smelter.pitch + 4, -12);
    of.build(0);
    await sleep(0.3);
    // Walk in to the standoff, re-checked each burst against the machine's own
    // reported position rather than after a fixed number of bursts.
    const target = smelter.pos;
    const want = A.standoff ?? S.standoff ?? 6.0;
    let sunSide = null;
    if (A.sunSide ?? S.sunSide) {
      // THE SUN VECTOR COMES FROM THE POST STACK'S OWN UNIFORM, not from a
      // second solve: `__ofPost.state().sun` is the direction the renderer is
      // actually lighting with this frame, so a camera placed against it
      // cannot disagree with the shading the way an independently recomputed
      // sun could. Projected into the machine's tangent plane and walked out
      // along, so the eye ends up between the sun and the subject.
      //
      // THE BEARING IS A CALIBRATED CONSTANT AND NOT A DERIVATION, AND THE
      // DERIVATION IS RECORDED BECAUSE IT FAILED (RN-1492). The obvious build
      // is to read `__ofPost.state().sun`, project it into the machine's
      // tangent plane and stand on it: `Frame.ts:92` sets that vector to
      // `light.position - light.target.position`, which reads as TOWARD the
      // sun. Measured on this build it does NOT put the eye on the lit side,
      // and neither does its negation. Matched pair at 4.6 m, one sign apart:
      // +tangent box luma 27.50 / warm -17.81 / loFrac 0.672, -tangent 26.41 /
      // -17.30 / 0.722, and the frames show a corner of the machine in shadow
      // with the GROUND fully lit in both. Two opposite bearings both landing
      // shaded means the sun's azimuth is near-perpendicular to the projected
      // vector, i.e. that vector and these positions are not in the same frame,
      // whatever the assignment line reads like. That is a real finding about
      // `__ofPost.state().sun` as an instrument and it is reported rather than
      // worked around silently; what is worked around is only this shot's need
      // for a lit subject.
      //
      // So the bearing is built the way `ruin` and `basedusk` build theirs, in
      // the tangent frame off the PLAYER'S OWN FEET that both of those shots
      // already stand on, and its value is a measured constant with the
      // rejected bearings recorded beside it in `SHOTS`.
      const f0 = of.world().player.feet;
      const up = norm(f0);
      const e0 = norm(cross(up, [0, 1, 0]));
      const e1 = norm(cross(up, e0));
      const th = ((A.bearingDeg ?? S.bearingDeg) * Math.PI) / 180;
      const tan = norm(addk(addk([0, 0, 0], e0, Math.cos(th)),
        e1, Math.sin(th)));
      const stand = addk(addk(target, tan, want), up, A.dropM ?? 4);
      const at = of.standAt(stand[0], stand[1], stand[2]);
      if (at === null) return { valid: false, shot: name, why: 'standAt refused', stand };
      await sleep(1.2);
      sun = pin();                   // the observer moved, so the solve moved
      sunSide = { bearingDeg: A.bearingDeg ?? S.bearingDeg,
        postSun: window.__ofPost.state().sun.map(r3),
        tangent: tan.map(r3), dropM: A.dropM ?? 4 };
    } else {
      for (let i = 0; i < 24; ++i) {
        if (gd(eye(), target) < want) break;
        of.look(yaw0, -6);
        of.input.tape([{ hold: 30, keys: ['KeyW'] }]);
        await sleep(0.6);
      }
      of.input.tape([{ hold: 2, keys: [] }]);
      await sleep(0.3);
    }
    // AIM AT MID-HEIGHT, NOT AT THE SOCKET, once the eye is close enough for
    // the difference to matter. `machine` keeps 0 so its pose is unchanged to
    // the digit; `smelterhero` lifts the aim by the asset's own half-height.
    // The up used is the radial through the machine's own position, which is a
    // real surface normal on a curved body and not a world axis.
    const lift = A.aimUpM ?? S.aimUpM ?? 0;
    const aimPt = lift === 0 ? target : addk(target, norm(target), lift);
    // `machine` KEEPS ITS EXACT SOLVE, seed yaw and spans included, so its pose
    // and therefore RN-1200's rectangle stay comparable to the digit. The hero
    // gets a coarse 90-degree pass first because `standAt` drops the walker on
    // a bearing nothing chose, so the subject can start behind him.
    const framed = sunSide === null
      ? aimAt(aimPt, [2, -2, -6, -10, -16], yaw0, [16, 4, 1])
      : aimAt(aimPt, [10, 6, 2, -2, -6], of.world().observer.yawDeg,
        [90, 16, 4, 1]);
    setup = { placed: fac().buildings, kinds: fac().list.map((b) => b.kind),
      standoffM: r2(gd(eye(), target)), wantStandoffM: want, aimUpM: lift,
      belt: belt !== null, sunSide, framed };
  }

  if (name === 'ruin') {
    if (typeof of.ruins !== 'function') return { valid: false, why: 'no of.ruins' };
    await of.run(0.5, 60);           // one real frame, so distM and the LOD rung
    const R = of.ruins();            // are real and not their placeholders
    if (R === null || R.count < 1) {
      return { valid: false, shot: name, why: 'no ruin instance drawn',
        ruins: R };
    }
    const inst = R.list[0];
    const up = inst.up;
    // Approach from a TANGENT bearing at a fixed standoff, so the shot is a
    // walk-up silhouette rather than an aerial. The bearing is built from the
    // site's own up, so it is a real tangent on a curved body and not a world
    // axis that happens to look level near the equator.
    const e0 = norm(cross(up, [0, 1, 0]));
    const e1 = norm(cross(up, e0));
    const th = ((A.bearingDeg ?? S.bearingDeg) * Math.PI) / 180;
    const dir = norm(addk(addk([0, 0, 0], e0, Math.cos(th)), e1, Math.sin(th)));
    const stand = addk(addk(inst.sitePos, dir, A.standoffM ?? S.standoffM),
      up, A.dropM ?? 6);            // dropped in from above so the walker snaps
    const at = of.standAt(stand[0], stand[1], stand[2]);                // to ground
    if (at === null) return { valid: false, shot: name, why: 'standAt refused', stand };
    await sleep(1.5);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    sun = pin();                     // the observer moved, so the solve moved
    // Aim at the ruin's own mid-height rather than its socket, or the shot is
    // of the plinth with the temple cropped off the top.
    const target = addk(inst.sitePos, up, A.aimUpM ?? S.aimUpM);
    const yaw0 = of.world().observer.yawDeg;
    const framed = aimAt(target, [4, 0, -4, -8], yaw0, [16, 4, 1]);
    const r1 = of.ruins().list[0];
    setup = { standoffM: r2(gd(of.aim().origin, inst.sitePos)),
      lod: r1.lod, distM: r2(r1.distM), boundM: r2(inst.boundM),
      gradeM: r3(R.gradeM), framed,
      converged: of.world().chunks.converged };
  }

  if (name === 'basedusk') {
    // sandboxshot.js's builder: foundations, walls and two machines, all free,
    // all through the real ghost-and-press path a player uses.
    const yaw0 = of.world().observer.yawDeg;
    const AROUND = [0, 25, -25, 50, -50, 75, -75];
    const place = async (menu, lo, hi) => {
      of.build(menu);
      await sleep(0.1);
      for (const dy of AROUND) {
        for (let p = lo; p <= hi; p += 2) {
          of.look((yaw0 + dy + 360) % 360, p);
          await sleep(0.05);
          const g = of.build().structGhost;
          if (g === null || !g.ok || g.addr === null) continue;
          of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 6, keys: [] }]);
          await sleep(0.22);
          return true;
        }
      }
      return false;
    };
    let decks = 0;
    for (let i = 0; i < 9; ++i) if (await place(4, -84, -30)) decks++;
    let walls = 0;
    for (let i = 0; i < 6; ++i) if (await place(6, -60, -14)) walls++;
    // The machines go down through `of.build()`'s own menu and a pitch sweep,
    // machinemat.js's path, rather than through two hotbar slots: `hotbar(3)`
    // and `hotbar(5)` placed ZERO machines here and reported success, because a
    // slot index is not a machine kind and nothing checks that it is.
    const fac = () => of.game().factory;
    const putMachine = async (menu) => {
      of.build(menu);
      await sleep(0.1);
      for (const dy of [120, 145, 95, 170]) {
        for (let p = -14; p >= -46; p -= 0.4) {
          of.look((yaw0 + dy + 360) % 360, p);
          await sleep(0.035);
          const g = of.build().ghost;
          if (g === null || !g.ok) continue;
          const before = fac().buildings;
          of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 4, keys: [] }]);
          await sleep(0.16);
          if (fac().buildings > before) return true;
        }
      }
      return false;
    };
    let machines = 0;
    for (const menu of [3, 2]) if (await putMachine(menu)) machines++;
    of.hotbar(1);
    of.build(0);
    await sleep(0.3);
    const parts = of.game().structures.parts;
    if (parts.length === 0) {
      return { valid: false, shot: name, why: 'nothing was built',
        built: { decks, walls, machines } };
    }
    const c = parts.reduce((a, p) => [a[0] + p.pos[0] / parts.length,
      a[1] + p.pos[1] / parts.length, a[2] + p.pos[2] / parts.length], [0, 0, 0]);
    // STAND OFF BY CONSTRUCTION, not by walking backwards. The first version
    // held `back` for 55 frames and the camera finished INSIDE the base, so the
    // "base at dusk" frame was a corner of two walls at 2 m; the framing solver
    // then aimed correctly at a centroid the player was standing on. `standAt`
    // on the site's own tangent puts the eye at a stated distance whatever the
    // build ended up shaped like.
    const f0 = of.world().player.feet;
    const up = norm(f0);
    const e0 = norm(cross(up, [0, 1, 0]));
    const e1 = norm(cross(up, e0));
    const th = ((A.bearingDeg ?? S.bearingDeg) * Math.PI) / 180;
    const dir = norm(addk(addk([0, 0, 0], e0, Math.cos(th)), e1, Math.sin(th)));
    const stand = addk(addk(c, dir, A.standoffM ?? S.standoffM), up, A.dropM ?? 5);
    if (of.standAt(stand[0], stand[1], stand[2]) === null) {
      return { valid: false, shot: name, why: 'standAt refused', stand };
    }
    await sleep(1.5);
    sun = pin();
    const framed = aimAt(addk(c, up, A.aimUpM ?? S.aimUpM), [0, -4, -8, -14],
      of.world().observer.yawDeg, [40, 8, 2]);
    setup = { built: { foundations: decks, walls, machines, parts: parts.length },
      standoffM: r2(gd(of.aim().origin, c)), framed };
  }

  if (name === 'station') {
    // ======================================================================
    // BOARDING IS THROUGH THE PAUSE MENU'S OWN ROW, NOT THROUGH `standAt`,
    // AND THAT WAS FOUND THE EXPENSIVE WAY.
    //
    // `stationdraw.js` stands the walker at `install.standPos`, which is a
    // body-frame ABSOLUTE point, and `Controller.standAt` zeroes the absolute
    // velocity (PH-90, and its own comment says so). The station is in a 400 km
    // orbit at 7.67 km/s. So the walker is put where the deck WAS and then
    // stands still while the deck leaves: after the 1.2 s settle every station
    // probe performs, the eye is 11,653.895 m away, which is 7.67 km/s times
    // 1.52 s to three figures. The station still reports `visible: true` and
    // `drawnParts: 2` because it IS drawn, 11.65 km off, a few pixels across,
    // and the capture comes back black with every field in the report correct.
    //
    // `stationdraw.js` FAILS this on the shipped build today, unmodified, on
    // exactly this check ("and is standing on the deck 400 km up"). That is a
    // live regression in the station spawn path and it is reported up rather
    // than worked around here; what is worked around is only this shot's need
    // for a camera on the deck.
    //
    // `stationframe.js` boards through `#of-pause button[data-cheat=
    // "visit:station"]`, the row a player presses, which mounts the carrier so
    // the deck carries the walker instead of outrunning him. That is the path.
    // ======================================================================
    if (typeof of.station !== 'function') return { valid: false, why: 'no of.station' };
    const st = of.station();
    if (st === null || st.install === null) {
      return { valid: false, shot: name, why: 'no installed station: drop ?station=0' };
    }
    pin();
    await of.settle(20);
    of.pause(true);
    await of.run(0.35, 15);
    const row = document.querySelector('#of-pause button[data-cheat="visit:station"]');
    if (row === null) {
      return { valid: false, shot: name, why: 'no visit:station row in the pause menu' };
    }
    row.click();
    of.pause(false);
    await of.run(1.2, 15);
    const w = of.world().player;
    const ride = typeof of.carrier === 'function' ? of.carrier() : null;
    if (w.onDeck !== true) {
      return { valid: false, shot: name,
        why: 'the press did not put the walker on the deck',
        player: { grounded: w.grounded, onDeck: w.onDeck }, ride };
    }
    // Aim down the spine's own local +X, with yaw measured in the LOCAL TANGENT
    // FRAME at the player's radial. A screen-space atan2 of the body-frame axis
    // is a different frame and points at a wall (stationdraw.js's own scar).
    const f = w.feet;
    const l = len(f) || 1;
    const u = [f[0] / l, f[1] / l, f[2] / l];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const east = (() => {
      const e = [u[2], 0, -u[0]];
      const el = len(e);
      return el < 1e-9 ? [1, 0, 0] : [e[0] / el, e[1] / el, e[2] / el];
    })();
    const north = cross(u, east);
    const al = of.station().axes.along;
    const fwd = (Math.atan2(dot(al, east), dot(al, north)) * 180) / Math.PI;
    const base = A.back ?? S.back ? fwd + 180 : fwd;
    of.look(A.yaw ?? (base + (A.yawOff ?? S.yawOff ?? 0)), A.pitch ?? S.pitch ?? -2);
    await of.run(1.0, 30);
    const d = of.stats().stationDraw;
    if (d === null || d.visible !== true) {
      return { valid: false, shot: name, why: 'the station is not drawing',
        stationDraw: d };
    }
    setup = { grounded: w.grounded, onDeck: w.onDeck,
      yawDeg: r2(A.yaw ?? fwd), ride,
      drawnParts: d.drawnParts, staleMaxM: d.staleMaxM,
      eyeDistM: r2(d.eyeDistM), altM: r2(st.deckR - 600000) };
  }

  // ------------------------------------------------------------- the capture
  // RE-PIN immediately before settling. Everything above ran the sim for tens
  // of seconds and `of.run` drifts a pinned sun, so pinning at the top and
  // photographing at the bottom is a control that stopped holding halfway
  // through its own procedure (RN-13, machinemat.js).
  sun = pin();
  // `settle()` waits for TERRAIN CONVERGENCE, and a walker 400 km up with the
  // streamer chasing a surface he is nowhere near never converges (PH-89, and
  // four runs were lost to it before `stationframe.js` wrote the line down).
  // The orbital shot therefore runs a fixed window instead.
  if (name === 'station') await of.run(1.0, 30);
  else await of.settle(A.settle ?? 24);
  sun = pin();
  await sleep(0.2);
  const elevDot = of.stats().sky.elevationDot;
  const sunErr = mode === 'time' ? 0 : Math.abs(elevDot - (A.sunDot ?? S.sunDot));
  if (sunErr > (A.sunTol ?? S.sunTol) && A.anySun !== true) {
    return { valid: false, shot: name,
      why: `the sun would not pin: wanted ${A.sunDot ?? S.sunDot}, `
        + `got ${elevDot} (miss ${r3(sunErr)} > ${A.sunTol ?? S.sunTol}). `
        + 'Photographing this would put a different hour under the same filename.',
      sun, elevDot };
  }

  const blob = await of.screenshot();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const W = bmp.width;
  const H = bmp.height;

  /** The §2.1 idiom, on one rectangle. RGB is decoded rather than luma alone:
   *  a luma-only instrument reads ~0 on a hue-only change and a grade moves
   *  both (§2.6). `warm` is meanR - meanB in counts, POSITIVE IS WARM. */
  const stat = (x0, y0, x1, y1) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const n = w * h;
    let sr = 0; let sg = 0; let sb = 0; let ssat = 0;
    let lo = 0; let hi = 0;
    const lum = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
      const r = d[i * 4]; const g = d[i * 4 + 1]; const b = d[i * 4 + 2];
      sr += r; sg += g; sb += b;
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      ssat += mx === 0 ? 0 : (mx - mn) / mx;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = y;
      if (y < 255 * 0.10) lo++;
      if (y > 255 * 0.80) hi++;
    }
    lum.sort();
    const q = (f) => lum[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
    const mr = sr / n; const mg = sg / n; const mb = sb / n;
    return {
      px: n,
      luma: r2(0.2126 * mr + 0.7152 * mg + 0.0722 * mb),
      rgb: [r2(mr), r2(mg), r2(mb)],
      warm: r2(mr - mb), sat: r3(ssat / n),
      p05: r2(q(0.05)), p50: r2(q(0.50)), p95: r2(q(0.95)),
      iqr: r2(q(0.75) - q(0.25)),
      loFrac: r3(lo / n), hiFrac: r3(hi / n),
    };
  };

  const bx = [S.box[0] * W, S.box[1] * H, S.box[2] * W, S.box[3] * H];
  /** RN-1490. The shot's further named rectangles, decoded from the SAME
   *  capture, so an extra box costs a `getImageData` and never a second frame
   *  that would differ from the first by the wind clock and the foliage. */
  const extraPx = {};
  const extraStat = {};
  for (const [k, f] of Object.entries(S.extra ?? {})) {
    const e = [f[0] * W, f[1] * H, f[2] * W, f[3] * H];
    extraPx[k] = e.map((v) => Math.round(v));
    extraStat[k] = stat(e[0], e[1], e[2], e[3]);
  }
  const png = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  const s = of.stats();
  const obs = of.world().observer;
  const pose = { yawDeg: r2(obs.yawDeg), pitchDeg: r2(obs.pitchDeg),
    latDeg: r3(obs.latDeg), lonDeg: r3(obs.lonDeg), altM: r2(obs.altM) };
  // BACK TO THE GROUND BEFORE RESOLVING, for the same PH-89 reason: `run.mjs`
  // settles AFTER the eval returns. Every station-side stat above is already
  // captured, so this cannot change a number in the report.
  if (name === 'station') {
    if (typeof of.carrier === 'function') of.carrier('release');
    of.teleport(-3.41413, 150.27984, 2);
    await of.run(1.0, 15);
  }
  return {
    valid: true, shot: name, why: S.why,
    frame: { w: W, h: H },
    boxPx: bx.map((v) => Math.round(v)),
    box: stat(bx[0], bx[1], bx[2], bx[3]),
    extraPx, extra: extraStat,
    world: stat(0, 0, W, H),
    sun: { mode, wantDot: mode === 'time' ? null : (A.sunDot ?? S.sunDot),
      sunT: r3(of.stats().sky.sunT), elevDot: r3(elevDot),
      err: r3(sunErr), tol: A.sunTol ?? S.sunTol ?? null, solve: sun },
    pose,
    // THE PIPELINE THE FRAME CAME THROUGH, published so a pair can be shown to
    // be one variable apart rather than asserted to be.
    postState: post,
    shadow: s.shadow, ibl: s.ibl,
    render: { triangles: s.draw.triangles, calls: s.draw.calls,
      programs: s.draw.programs, vramMB: s.vramEstimateMB,
      frameMs: { p50: r2(s.frameMs.p50), p95: r2(s.frameMs.p95),
        p99: r2(s.frameMs.p99) },
      passMs: { near: r2(s.passMs.near), post: r2(s.passMs.post),
        total: r2(s.passMs.total) } },
    setup, log, png,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
