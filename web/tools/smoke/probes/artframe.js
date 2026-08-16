// artframe.js: THE CANONICAL ART FRAMES (RN-1405, sixth added at RN-1258).
// One file, six named shots, each reproducible to the pose, the sun and the
// scene.
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
//   voxelface    RN-1258's sixth shot: a dug pit's cut face at arm's length,
//                the one surface in the game the world does not draw until
//                the player has struck it.
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
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
    // RN-1258. THE SIXTH SHOT, and the one the other five could not take: the
    // DUG FACE. Every frame above photographs a surface the world already
    // draws; this one has to CREATE its subject first, because the near voxel
    // mesh holds nothing at all until the player has struck the ground.
    //
    // THE SUN IS PINNED HIGH (0.88) AND THAT IS THE ONE CHOICE HERE THAT WAS
    // MADE BY LOOKING RATHER THAN BY ARGUMENT, so it is recorded with its two
    // rejects. Dot 0.28 was tried first, on the reasoning that a cut bank is a
    // shaded, mostly ambient-lit surface and should be judged as one: the pit
    // interior came back at luma 18 and read as a BLACK HOLE, and a frame with
    // no signal in the subject cannot settle a material question. Dot 0.55 was
    // better and still lost most of the box to long understorey shadows. At
    // 0.88 the shadows are short, the near wall of the cut is lit, and the
    // frame is about the material rather than about the weather. The shaded
    // and lamp-lit cases are real and are owed their own frames; they are not
    // this one, and pretending one frame covers all three is how a pass ends
    // up judging nothing.
    //
    // RN-1650 CORRECTION, so the next lane does not lose an hour to the old
    // note. This USED to say prop shadows survive `propsVisible(false)` here,
    // on the strength of `--props=0` "changing nothing" (box luma 29.76
    // against 29.78). Re-measured (`propshadow.js`, real D3D11): those two
    // numbers are the runtime toggle and a true `?props=0` boot AGREEING WITH
    // EACH OTHER, not a comparison against a props-ON control -- the props-ON
    // reading at this box is 67.58, and BOTH removal methods land on
    // bit-identical 87.01 (rgb, p05, p50, p95, iqr, loFrac all equal to the
    // digit). Props are cleanly removed from the shadow pass either way. What
    // is left in this box after removal is the dug pit's OWN wall
    // self-shadowing a near-zenith sun barely reaches, unrelated to props,
    // which is what the next sentence already said: the high sun is what
    // actually shrinks it.
    voxelface: {
      scenario: 'walk', needsSandbox: false,
      lat: 12, lon: 150, yaw: 300, pitch: -38,
      sunDot: 0.88, sunTol: 0.06,
      strikes: 26, props: false,
      box: [0.3200, 0.4400, 0.6800, 0.8600],
      // RN-1727 (audit-corrections). §2.8 R1's two UNTOUCHED-TERRAIN
      // rectangles, committed rather than left for the next reader to
      // grid-search back out of the PNG, which is what this correction's own
      // verifier had to do. `groundA`/`groundB` are the two patches of
      // untouched ground R1 measured (iqr 22.13, 16.06); R1's third figure,
      // "the dug cut face reads iqr 36.78", is this shot's own canonical
      // `box` above (that IS the dug face by construction, see `why` below),
      // so no separate rectangle for it is committed here.
      //
      // Verified against a real D3D11 capture on this build: `groundA`
      // reproduces iqr 22.13 to the digit; `groundB` lands at 15.99, within
      // 0.1 of R1's published 16.06.
      //
      // FOUND WHILE VERIFYING, AND IT IS WHY NO `cutFace` RECTANGLE IS
      // COMMITTED: the pit's own SHAPE is not bit-reproducible page load to
      // page load, even though `box.iqr` itself reads 37.40 identically on
      // two separate loads. A small rectangle fully inside `box` (px
      // 1060,720-1200,860) read 36.76 on one load and 33.55 on another --
      // three points of scatter on a window the whole-box average does not
      // show. `groundA`/`groundB`, both outside the pit, are stable across
      // the same loads. So the untouched terrain is deterministic and the
      // dig pattern is not: the strikes land on slightly different voxel
      // cells each load, which redistributes local contrast inside the pit
      // without moving the box-wide statistic much. R1's own 36.78 sits
      // inside that scatter band, consistent with one honest sample of a
      // quantity nobody had previously shown to be noisy. Not chased further
      // within this correction's scope; the next lane that wants a STABLE
      // sub-rectangle inside the dug face should expect to need one anchored
      // to the pit's own geometry (e.g. `of.voxels()`) rather than to fixed
      // screen pixels.
      extra: {
        groundA: [0.1250000, 0.3944444444444444, 0.1875000, 0.5055555555555555],
        groundB: [0.0437500, 0.1055555555555556, 0.1000000, 0.2055555555555556],
      },
      why: 'the dug voxel face at arm\'s length, RN-1258\'s subject',
    },
    // RN-1900. THE EIGHTH SHOT, AND THE SUBJECT NO CANONICAL SHOT COULD SEE.
    //
    // RN-1859 measured that a change moving the 18 to 44 m band by 40 to 60 per
    // cent of iqr at three sites is INVISIBLE to every published baseline this
    // project has, because every rectangle in the manifest sits on a machine,
    // on a structure, or on ground within 5 m of the eye at a footprint under
    // 0.02 m (rendering.md section 2.1.7a). That is a hole in the shot set, and
    // this closes it: the mid field, at a standing eye, with the ground and
    // nothing else in the strips.
    //
    // THE POSE IS PLAINS AT YAW 150 AND IT WAS CHOSEN BY MEASUREMENT, NOT TASTE.
    // The same site at the RN-1857 yaw of 300 puts two dark loose-stone rocks
    // and the far tree line inside the 35 m strip, and the signature is
    // textbook: on this lane's own pair the 35 m strip's iqr moved +36 per cent
    // while its row std moved +1.5 per cent, i.e. a robust statistic saw the
    // term and a non-robust one was swamped by a handful of very dark outliers.
    // At yaw 150 the same three strips are clean ground to the horizon and the
    // two statistics agree. The rejected yaw is recorded rather than deleted
    // because "the mid field did not move at 35 m" was a real reading, and it
    // was a reading about the RECTANGLE.
    //
    // PROPS OFF, `groundnear.js`'s rule and its reason verbatim: at a standing
    // eye pitched into the ground the understorey covers most of the frame, and
    // a claim about the GROUND cannot be settled through somebody else's leaf
    // cards.
    //
    // `box` IS THE 27 m STRIP AS A COMMITTED FRACTION, so this shot has a
    // headline number of the same shape every other shot has, and `r18c`/`r35c`
    // are its two neighbours. They were computed by inverting the flat-plane
    // range map at the eye this pose actually stands at (1.62 m, not the 2.0 m
    // the teleport asks for), a pitch of -10 and a 60 degree FOV, and they are
    // committed so a verifier reproduces them rather than grid-searching them
    // back out of the PNG (RN-1727's own correction). `rangeRects` below places
    // the same three LIVE off this capture's own observer; the report prints
    // `rangeM` for both, so if the terrain ever moves the eye the two disagree
    // out loud instead of one of them quietly naming the wrong range.
    midfield: {
      scenario: 'walk', needsSandbox: false,
      lat: -7.9675, lon: 116.53189, yaw: 150, pitch: -10,
      sunDot: 0.70, sunTol: 0.06,
      props: false,
      box: [0.1500, 0.3975332, 0.8500, 0.4030888],   // the 27 m strip
      rangeRects: [18, 27, 35],
      rangeRowsPx: 5,
      extra: {
        r18c: [0.1500, 0.4236282, 0.8500, 0.4291838],
        r27c: [0.1500, 0.3975332, 0.8500, 0.4030888],
        r35c: [0.1500, 0.3855162, 0.8500, 0.3910718],
      },
      why: 'the MID FIELD at 18 / 27 / 35 m, the band no other shot can see',
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
      // RN-1574. THIS SHOT CANNOT CARRY A SUNLIT-FACE BOX, AND THAT IS A
      // MEASUREMENT RATHER THAN AN OMISSION.
      //
      // RN-1527 asked every machine frame for a rectangle on a face the sun
      // reaches, because RN-1200's `box` above is 99.7 per cent IBL-lit and is
      // therefore blind to every direct-light change by construction. The
      // search was run here properly: a 6x4 lattice of candidate rectangles
      // over the whole subject, each read twice one variable apart (the
      // shipped bias against RN-1571's pre-fix sign, which is exactly the
      // direct-sun term switching on and off). **The largest direct-sun delta
      // anywhere in this frame is 1.4 counts**, on a 6x4 grid plus `box` plus
      // both hearth columns; the same lattice on `smelterhero` reaches 50.2.
      // A full 16-rung day sweep at this pose agrees: `box` peaks at 24.11 at
      // near-zenith against 18.87 at the pinned hour, and the two solutions at
      // the pinned elevation dot (azimuth 207.5 and 330.1) read 18.27 and
      // 20.16. The camera walks in on the default yaw and lands on the side
      // facing AWAY from the sun, at every hour.
      //
      // The bearing is what would have to move, and the bearing is frozen:
      // `machine` keeps its exact solve so RN-1200's numbers stay comparable
      // to the digit. So the sunlit-face box lives on `smelterhero`, which was
      // built with a `sunSide` bearing for this exact purpose, and this note
      // exists so the next lane does not spend a night re-deriving it.
      // RN-1935 (shot-grades). MOVED OFF THE SKIRT, NOT RENAMED. RN-1839
      // already found the mechanism: splitting the old 300,0,470,600 /
      // 1225,0,1320,560 rectangles into thirds put the whole `paintchip`-pass
      // delta in the LOWER third of each (`hearthL` 12.08 -> 11.85 iqr, upper
      // and middle thirds bit-identical), because both strips run down to
      // y = 0.6667 / 0.6222 and clip the painted keep-out SKIRT at the
      // column's foot rather than stopping on stone. That made them unsafe as
      // a `stone`-only control for any other lane reading them off this
      // manifest, and this lane's own dispatch measured it in pixels rather
      // than iqr: 3068 of 102000 px differ inside the OLD `hearthL` box
      // against the control this manifest's own `Accent`/`paintchip` split
      // implies, 3047 of them (99.3%) in the lower third alone; `hearthR`
      // 1427 of 53200, 1384 (97.0%) in the lower third. `smelterhero`'s own
      // `hearthL`/`hearthR` (different framing, does not reach the skirt at
      // this camera's angle) stay the clean reference at 0 of 46500.
      //
      // FIX: both rectangles now END AT RN-1839's OWN THIRD BOUNDARY (400 px
      // of the old 600, 373 px of the old 560), i.e. they keep the upper two
      // thirds RN-1839 already showed bit-identical across a `paintchip`
      // change and drop the lower third that clips the skirt. Still the
      // `Rock`/stone refractory brick, still deterministic and responsive to
      // a `stone` family change (RN-1490), now genuinely stone-only.
      //
      // VERIFIED, real D3D11 (RTX 4060 Ti, ANGLE), three consecutive
      // captures at this build: `hearthL` px 68000, iqr 11.09, loFrac 0.85,
      // hiFrac 0.002, identical to the digit all three times; `hearthR` px
      // 35435, iqr 9.08, loFrac 0.859, hiFrac 0, identical on two fields and
      // within 0.01 count of itself on luma/rgb[0] across the three (the
      // project's own accepted floor for run-to-run float noise, e.g.
      // RN-1859's `basedusk`). Both p95 fell (old `hearthL` 46.77 -> 42.91,
      // `hearthR` 41.76 -> 38.11), which is the skirt's own brighter paint
      // leaving the box, exactly the direction contamination predicts.
      extra: {
        hearthL: [0.1875, 0.0000, 0.2938, 0.4444444444444444],
        hearthR: [0.7656, 0.0000, 0.8250, 0.4148148148148148],
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
        // RN-1574. THE SUNLIT-FACE BOX RN-1479 AND RN-1527 BOTH ASKED FOR, and
        // it is on this shot rather than on `machine` because this is the shot
        // that HAS a sunlit face (see `machine`'s own note above, which carries
        // the 26-rectangle search that found none there).
        //
        // NOT CHOSEN BY EYE. A 6x4 lattice was laid over the whole subject and
        // every cell read twice one variable apart -- the shipped bias against
        // RN-1571's pre-fix sign, i.e. the direct-sun term switching off and on
        // -- and this rectangle carried the largest such delta of any cell that
        // is plate rather than fire or oxide: **luma 21.7 -> 71.9, a delta of
        // 50.2 counts and 3.3x**, at `sat` 0.175, which is what says steel and
        // not the `rust` family (the launder band beside it runs sat 0.857).
        // `iqr` 53.6 and `p95` 127.7 on the lit arm.
        //
        // WHAT IT FRAMES: clean `panel` plate on the pour-face wall, left of
        // the hearth surround and below the charging hood, with a rivet run,
        // a downpipe and the pipe's own cast shadow inside it. So it moves on
        // a direct-light change, on a `panel` family change, AND on a contact
        // or shadow change, which is three of the four things the campaign
        // measures; it deliberately contains no fire and no oxide so it cannot
        // be moved by the emissive.
        sunface: [0.2600, 0.4200, 0.3500, 0.5700],
        firebox: [0.3875, 0.3444, 0.6375, 0.4167],
        band: [0.2938, 0.7611, 0.7313, 0.8200],
        plate: [0.6781, 0.2833, 0.7469, 0.6833],
        hearthL: [0.1719, 0.2222, 0.2188, 0.9111],
        hearthR: [0.8094, 0.2222, 0.8438, 0.9111],
        // RN-1727 (audit-corrections). THE TWO FLAT SURFACES §2.8 R6 NAMED,
        // committed so the next reader does not grid-search the PNG the way
        // this correction's own verifier had to. `peep` is the port and
        // `strip` is the sight band inside the firebox, both untextured
        // (`OF_EmissiveState`, `build_smelter.py:794-797`). Verified against a
        // real D3D11 capture on this build, bit-identical to R6's own
        // published figures: `peep` iqr 0.93, p50 190.33, p95 191.98; `strip`
        // iqr 4.15.
        peep: [0.483750, 0.4288888888888889, 0.536875, 0.4977777777777778],
        strip: [0.436250, 0.5766666666666667, 0.582500, 0.5922222222222222],
        // RN-1839. THE TWO PAINTED SLABS, AND THE REASON `band` IS NOT ENOUGH.
        // R6 quotes `band` at iqr 63.69 as the machine's most varied surface.
        // It is not a surface measurement: the rectangle spans the whole 4 m
        // keep-out ring and the ring runs from full light at its left end to
        // deep shade at its right, so 63.69 is a LIGHTING RAMP across a flat
        // painted slab. Read through this manifest, a 130 px window at its lit
        // end reads iqr 12.94 and a 230 px window at its shaded end 4.82.
        // `bandLit` and `bandShade` are those two windows, committed, so the
        // next lane measures the paint and not the sun.
        //
        // `placard` is the 0.40 x 0.26 m painted sign on the upper left of the
        // pour face (`build_smelter.py`'s `mf.placard(..., "Accent")`). It is
        // the flattest bright warm cell anywhere in this frame: a 40 px
        // lattice over the whole capture puts it flatter than any other cell
        // with warm over 40.
        //
        // BOTH ARE `Accent` -> `paintchip`, i.e. PAINT, and neither is
        // emissive. That is worth stating in the manifest because RN-1835's
        // brief called them "the two flat emissive slabs" and the emissive
        // slot could never have reached either one: `MachineBatch`'s
        // status-chip branch is role 1 and both of these are role 0.
        //
        // Measured on this build (RN-1838's paintchip landing) on real D3D11,
        // both arms read through this manifest, before -> after:
        //   placard    iqr 29.00 -> 37.52, p05 100.48 -> 54.64,
        //              p50 129.21 -> 104.73, p95 154.37 -> 156.09
        //   bandLit    iqr 12.94 -> 34.15, p95 168.70 -> 184.43
        //   bandShade  iqr  4.82 -> 11.97
        //   firebox 40.54, plate 25.74, hearthL 63.40, hearthR 21.74,
        //   peep 20.66, strip 52.68 and sunface 53.66 are bit-identical in
        //   EVERY published field across the same pair, which is what
        //   attributes the move to `paintchip` and to nothing else in frame.
        placard: [0.2700, 0.3388888888888889, 0.332500, 0.4133333333333333],
        bandLit: [0.2937500, 0.7644444444444445, 0.3750000, 0.8111111111111111],
        bandShade: [0.5625000, 0.7644444444444445, 0.7062500, 0.8111111111111111],
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
      // RN-1839. FOUR RECTANGLES, COMMITTED. §2.8 R3, RN-1780 and RN-1835 have
      // now each quoted a "cella wall patch" figure and NONE of them wrote down
      // where the patch was, so three passes in a row have argued about a
      // number nobody after them could re-take. That is RN-1728's finding
      // happening again on a different shot, so the rectangles go in the
      // manifest and the numbers below are read back FROM the manifest on a
      // real D3D11 capture rather than from the search that found them.
      //
      // `cella` is clean sunlit wall on the long face, clear of the two dark
      // openings and of the leaning slab at its foot; `cellaDark` is the
      // shaded end wall, which is the same family lit by the sky alone and is
      // where a relief change shows up with no direct sun helping it. `sky`
      // and `hill` are the NEGATIVE CONTROLS and they are the reason the pair
      // can be believed: a family change must not touch either, and on the
      // ashlar pass both came back bit-identical to the digit across the two
      // builds while the two wall rectangles moved.
      //
      // Measured on this build (RN-1835's ashlar landing) on real D3D11, both
      // arms read THROUGH THIS MANIFEST rather than off an ad-hoc decoder,
      // before -> after:
      //   cella      iqr 23.15 -> 29.20, p05 105.18 -> 103.61,
      //              p50 138.03 -> 143.66, p95 161.97 -> 168.87
      //   cellaDark  iqr  4.93 ->  6.86, p05 9.51 -> 8.51
      //   sky        14.00 -> 14.00, and luma/p05/p50/p95 111.51/98.04/
      //              111.12/126.26 on BOTH arms: bit-identical to the digit
      //   hill       27.67 -> 27.67, likewise 68.53/31.49/71.11/94.59 on both
      //
      // ONE TRAP, PAID FOR ONCE HERE. `statOn` above weights luma Rec.709
      // (0.2126/0.7152/0.0722) and `tools/smoke/boxstat.mjs` weights it
      // Rec.601 (0.299/0.587/0.114), so a number from the offline decoder and
      // a number from this probe are NOT on one scale: the same `cella`
      // rectangle reads 29.20 here and 29.27 there, and `sky` reads 14.00 and
      // 13.53. Both are internally consistent, and mixing them across a
      // before/after pair is a defect. Every figure in this comment is this
      // probe's own.
      extra: {
        cella: [0.2875, 0.4444444444444444, 0.3562500, 0.5555555555555556],
        cellaDark: [0.3875, 0.4222222222222222, 0.4375000, 0.5777777777777777],
        sky: [0.6250, 0.1111111111111111, 0.7500000, 0.2222222222222222],
        hill: [0.8125, 0.5222222222222223, 0.9062500, 0.5777777777777777],
      },
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
      // RN-1727 (audit-corrections). §2.8 R7's two sky rectangles, committed
      // for the same reason as the other shots in this pass: the audit read
      // them and never wrote down where. `skyHigh` is near the zenith,
      // `skyLow` a clean unobstructed patch just above the horizon haze
      // (chosen off the frame's own right edge to dodge the mountain and tree
      // silhouettes that intrude on every other candidate at this height).
      // Verified against a real D3D11 capture on this build, bit-identical to
      // R7's own published `warm`: `skyHigh` -87.69, `skyLow` -20.09.
      extra: {
        skyHigh: [0.3750, 0.0366666666666667, 0.6875, 0.0644444444444444],
        skyLow: [0.9312500, 0.3666666666666667, 0.9812500, 0.3777777777777778],
      },
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
      // thing successfully.
      //
      // RN-822's own default (`stationdraw.js`) IS phase 0.35, and an earlier
      // draft of this comment claimed this shot took the same phase; the code
      // has shipped 0.60 since the commit that introduced both, which A0
      // never noticed and RN-1800's look audit did. THE CODE IS KEPT: 0.35 was
      // RN-822's choice for the INTERIOR frame this shot deliberately stopped
      // taking (see the next paragraph), so there is no comparability to lose
      // by disagreeing with it, and every box-luma number this shot has ever
      // published (RN-1411, and RN-1800's own three captures below) was taken
      // against 0.60. Re-pinning to 0.35 now would be the revert, not the fix.
      // This comment is corrected to the code rather than the code to the
      // stale comment, and PUBLISHES the elevation it lands on rather than
      // asserting one.
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
      back: true, yawOff: 105, pitch: 3,
      box: [0.4200, 0.2000, 0.9800, 0.7200],
      // RN-1800. THE STATION'S OWN ORBITAL CLOCK, PINNED, AND THIS IS THE
      // ACTUAL FIX FOR THE NON-REPRODUCIBLE SHOT.
      //
      // `sunMode: 'time'` above pins the SUN. It never pinned the STATION: the
      // hull is nadir-locked (`DebugGameplay.ts`'s `station()` docstring) at
      // 400 km and 7.67 km/s, so its ATTITUDE is a function of where it is on
      // its own orbit, which `VesselRegistry.clockAt` derives from elapsed
      // FIXED TICKS since the record was last stamped -- not from the
      // day-night clock `setTime` moves. Two captures that pin the identical
      // sun phase still board, settle and frame the shot in a different
      // number of ticks each run (menu transition, `standAt` convergence and
      // the carrier-boarding wait are none of them tick-counted), so the hull
      // is at a different point in its orbit, and therefore a different
      // attitude to the same fixed sun, every time. That is what three
      // captures at "the same pin" read as box luma 21.78, then 3.73, then
      // 5.69: not the sun moving, the hull.
      //
      // `stationClockS` is applied ONCE, before `of.settle(20)` and the
      // boarding press below (see that block's own note for why not later
      // and not right before the press either -- both were tried and both
      // broke something a naive reading would have missed).
      //
      // RN-1810, A FRESH-CONTEXT VERIFIER'S FINDING, AND IT IS RIGHT: THE PIN
      // ABOVE IS CORRECT AND NECESSARY AND IT IS NOT SUFFICIENT. Four verifier
      // captures on the merged tree read box luma 2.46, 40.29, 30.98, 2.89 --
      // WORSE than the defect this pin set out to fix -- with `stationClock`'s
      // own `elapsed-since-stamp` at only 240-247 ticks (0.117 s on an ~818 s
      // orbit) every time: the pin LANDS, every run, to the digit. So the
      // mover is not the orbital phase.
      //
      // TRACED FURTHER, NOT JUST RE-ASSERTED: two captures were pulled where
      // `captureDiag` -- read at the ACTUAL capture instant, see below --
      // showed `stationClock.pos`, `captureDiag.originF` (the eye) and
      // `captureDiag.dirF` (the look direction) ALL EQUAL TO FULL FLOAT
      // PRECISION between them (a `tick`/`stampedTick` pair 66 apart in both
      // captures, which cancels in `clockAt`'s own formula, so every quantity
      // that formula feeds -- position, velocity, the LVLH basis `OrbitCarrier
      // .poseAt` builds from them -- is provably identical). One capture shows
      // the exterior hull against the star field; the other shows the STATION
      // INTERIOR, a corridor of riveted wall panels, no stars anywhere in
      // frame. Same camera, same eye, same direction, two different SCENES.
      // That is not a lighting gradient and no clock pin can fix it: the geometry
      // actually drawn is not a pure function of anything this shot's own
      // debug surface can read.
      //
      // THE LEADING SUSPECT, NAMED SO THE NEXT LANE DOES NOT RE-DERIVE IT:
      // `StationMount.ts`'s own header says the drawn hull is posed once at
      // install with `stationQuat` (position-only, nadir-locked, an ARBITRARY
      // roll picked by `THREE.Quaternion.setFromUnitVectors`'s shortest-path
      // convention) and "the mount re-poses it every tick after this" via
      // `OrbitCarrier.poseAt`'s `lvlh` basis (position AND velocity, roll tied
      // to the along-track direction) -- two DIFFERENT roll conventions with no
      // reason to agree, and PH-357's own history names this exact class of bug
      // once already ("the two-authority trap that put orbitdeck.js's corridor
      // upside down while every assertion passed"). Whether the per-tick
      // re-pose is actually firing every run in this scripted/driven execution
      // path, or the drawn hull can be left on its install-time `stationQuat`
      // pose under some condition this probe triggers, is exactly what
      // `StationView.sync`/`StationMount.ts`'s watcher registration needs
      // instrumented next -- core-engine or rendering territory, not a probe
      // fix, and named rather than worked around.
      //
      // THE PIN STAYS, because it is still correct for what it targets (the
      // sun-relative attitude question RN-1800 opened with) and removing it
      // would silently re-introduce that half of the defect. THE SHOT'S TARGET
      // GRADE IS MARKED UNMEASURED (rendering.md 2.1.7) rather than published
      // on a number four fresh captures showed is not reproducible.
      //
      // RN-1935 (shot-grades), THE FRAMING FIX THE ABOVE ASKED FOR, AND THE
      // POSE CHECKED OUT UNDER IT. `yawOff: 45` was chosen against the
      // PRE-FIX bearing (244.15 deg) and on the corrected one (255.35 deg,
      // CE-115..117) it still points into the hull's own interior on current
      // `main` -- confirmed by capture, not assumed: at 45 the frame is a
      // riveted corridor with a carpeted floor, no stars, the same INTERIOR
      // this entry already named. Swept `yawOff` in the field CE-117 itself
      // proposed (`--evalargs='{"shot":"station","yawOff":N}'`) rather than
      // solved on paper: 0 and 90 are still interior; **105 is the first
      // angle that clears the hull and shows the MUST-SHOW frame**, a lit
      // exterior hull segment and a strut truss against a visibly starred
      // sky (`docs/screenshots/RN1935_station_yo105.png`). `captureDiag`
      // proves the POSE fix holds under it: three captures at this exact
      // yawOff/pitch read `originF`/`dirF` EQUAL TO FULL FLOAT PRECISION all
      // three times, so CE-115..117 is not what stands between this shot and
      // a baseline any more.
      //
      // WHAT DOES, AND THIS LANE'S OWN `ibl.builds` CORRELATION BELOW WAS
      // FALSIFIED BY A FRESH-CONTEXT VERIFIER'S PROPER CONTROL -- READ THAT,
      // NOT THE THREE-SAMPLE READING THIS COMMENT FIRST SHIPPED WITH. Three
      // bit-identical-camera captures here read box luma 20.88/12.23/28.86
      // (2.36x) alongside `ibl.builds` 9/8/11, which is three samples and no
      // control. The verifier's FIVE bit-identical-camera captures (`originF`
      // /`dirF`/`postSunF`/`sunBearingDeg` all equal to full float precision,
      // so the pose fix and this `yawOff: 105` framing both hold) read box
      // luma **25.96 / 40.17 / 12.75 / 12.92 / 47.27, a 3.71x spread** --
      // WIDER than this entry's own 2.36x. `ibl.builds` read **11/11/11/11/9**:
      // four of the five sit at a CONSTANT count and still span 12.75 to
      // 40.17, 3.15x, on their own, so the counter does not predict the luma
      // swing. `chunksBuilt` was constant at 562 across all five. **The
      // controls this lane's own pass never carried are what falsify it**:
      // `forestfloor` and `machine`, captured alongside, are bit-identical to
      // the digit while their OWN `ibl.builds` moves, so the counter is not
      // even coupled to what a shot draws when that shot does not move. Box
      // and world luma do not track each other either (ratios 1.26/0.84/
      // 0.74/0.68/1.85), so the residual is not simply frame-wide either.
      // THE HONEST STATE: the residual is WIDER than first measured (3.71x,
      // not 2.36x) and stays fully UNATTRIBUTED. `stationClock.pos` and the
      // camera pose are solved and reproducible; neither `ibl.builds` nor a
      // frame-wide luma ratio explains the spread. NOT this lane's to fix
      // (core-engine/rendering territory) -- the next lane should treat the
      // cause as OPEN, not start from the builds-counter correlation this
      // comment originally, and wrongly, handed off. THE GRADE STAYS
      // UNMEASURED.
      stationClockS: -100,
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
  // RN-1800. Set only by the `station` shot, read only by the general re-pin
  // section below (`the capture`): the station's own orbital clock target, so
  // it can be re-applied there with nothing left to drift it before `grab()`.
  let stationClockTarget;

  // RN-1900. `midfield` takes `forestfloor`'s setup verbatim (teleport, spin to
  // convergence, pin the sun AFTER the teleport because the solve is against
  // the observer's own up, then look), at its own site, yaw and pitch. Sharing
  // the branch rather than copying it is deliberate: the two shots differ only
  // in the manifest row, and a second hand-written copy of this sequence is how
  // one of them ends up pinning the sun before the teleport.
  if (name === 'forestfloor' || name === 'midfield') {
    const w0 = of.world();
    of.teleport(S.lat, S.lon, 2.0);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    await sleep(1.0);
    sun = pin();                     // AFTER the teleport: the solve is against
    // RN-1900. `midfield` declares `props: false` and this is where it lands,
    // on `voxelface`'s precedent and its reason (a claim about the ground
    // cannot be settled through somebody else's leaf cards). `forestfloor`
    // declares nothing, so it is untouched.
    if ((A.props ?? S.props) === false) of.propsVisible(false);
    of.look(S.yaw, S.pitch);         // the observer's own up, which just moved
    setup = { teleported: true, converged: of.world().chunks.converged,
      biome: of.world().biome, tickAdvanced: of.world().tick > w0.tick };
  }

  if (name === 'voxelface') {
    const w0 = of.world();
    of.teleport(S.lat, S.lon, 2.0);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    await sleep(1.0);
    sun = pin();                     // AFTER the teleport, forestfloor's reason
    // THE SCATTER IS HIDDEN, artshot.js's precedent and its exact reason: at a
    // standing eye pitched into the ground the understorey covers most of the
    // box, and the understorey is pass A5's subject, not this one. A frame in
    // which the claim is 60 per cent occluded by a different lane's work
    // cannot settle either lane's question.
    if ((A.props ?? S.props) === false) of.propsVisible(false);
    of.look(S.yaw, S.pitch);
    await sleep(0.5);
    // `of.dig()` is zero-argument and drives the PLAYER'S OWN aim ray
    // (DebugTerraform.ts), which is why the look above has to come first and
    // why ARCHITECTURE.md's `dig(lat, lon, depth)` signature is stale. Each
    // strike is one sphere; sixteen at this pitch cuts a pit deep enough to
    // reach the subsoil stop of RN-80's profile, which is the point: a frame
    // of pure topsoil would judge one third of the material.
    //
    // THE AIM SWEEPS, and that is the difference between a frame of a hole and
    // a frame of a FACE. Sixteen strikes down one ray deepens a shaft whose
    // walls are all edge-on to the eye; fanning the yaw a few degrees either
    // side cuts a short trench, whose near wall is the large, well-lit,
    // camera-facing surface this shot exists to judge.
    const n = A.strikes ?? S.strikes;
    let struck = 0;
    for (let i = 0; i < n; ++i) {
      const t = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1;   // -1 .. +1
      of.look(S.yaw + t * 7, S.pitch + Math.abs(t) * 6);
      await sleep(0.06);
      if (of.dig() !== null) struck++;
      await of.run(0.25, 60);
    }
    // Look INTO the cut for the photograph, steeper than the digging pose, so
    // the near wall fills the box rather than the untouched ground beyond it.
    of.look(S.yaw, A.shotPitch ?? -44);
    await sleep(0.4);
    const vox = of.voxels();
    // ASSERT THE SUBJECT EXISTS BEFORE PHOTOGRAPHING IT. A dig that silently
    // did nothing yields an ordinary ground frame, and an ordinary ground
    // frame filed under this name is worse than no frame: it would be read as
    // "the dug face looks exactly like the terrain", which is the claim.
    if (!(vox && vox.mesh && vox.mesh.triangles > 0)) {
      return { valid: false, shot: name, struck,
        why: 'the near voxel mesh holds no triangles, so there is no dug face '
          + 'in this frame to photograph', voxels: vox };
    }
    setup = { teleported: true, struck, converged: of.world().chunks.converged,
      biome: of.world().biome, tickAdvanced: of.world().tick > w0.tick,
      voxTriangles: vox.mesh.triangles, voxVertices: vox.mesh.vertices,
      voxBricks: vox.mesh.bricks, voxVisible: vox.meshVisible,
      removedCells: vox.removedCells };
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
    // RN-1800. PIN THE STATION'S OWN ORBITAL CLOCK BEFORE BOARDING, NOT AFTER,
    // AND BEFORE `of.settle(20)`, NOT RIGHT BEFORE THE PRESS.
    //
    // Two placements were tried and both taught something the next lane
    // should not have to re-learn.
    //
    // RIGHT BEFORE THE CAPTURE (next to the aim, the obvious spot) is wrong:
    // `visit:station` SEATS the walker at wherever the deck IS at the moment
    // of the press (`seatOnStationDeck`), so re-pinning to a new target AFTER
    // that press relocates the station out from under an already-seated
    // walker in one tick -- a bigger version of the exact bug `stationdraw.js`
    // already documents (the walker left behind while the deck moves on).
    // Measured: the eye ended up 1,088,460 m from the station and
    // `stationDraw.visible` false, an order of magnitude worse than the
    // 11,653.895 m miss the un-pinned shot already had.
    //
    // RIGHT BEFORE `row.click()`, WITH NO `await` BETWEEN THEM (tried second,
    // on the reasoning that JS is single-threaded so nothing could drift in
    // between) is ALSO wrong, and for a reason the position numbers do not
    // show: boarding itself stopped registering (`ridingMounted: false`,
    // `boarding.boarded: 0`) on every run tried this way, where the SAME pin
    // placed one step earlier boards every time. The carrier membership test
    // (`Loop.fixedTick`, CE-30) is not a pure position check against the
    // walker's seated point; it is evaluated against the mount's own tracked
    // motion, and a clock write with literally zero elapsed ticks between it
    // and the press gives that tracking no tick in which to observe the
    // walker arriving on the newly-pinned orbit at all.
    //
    // PINNED HERE INSTEAD, one `settle` and one menu transition before the
    // press, boarding is reliable (confirmed valid on every run) and the
    // residual few ticks of settle/menu jitter before boarding reads the
    // clock (`stationClock().stampedTick` measured 10 ticks apart between two
    // runs, RN-1800's own log) move the captured phase by a bounded amount
    // rather than failing the shot outright -- see the box's own reported
    // bound in the report and in rendering.md's target grade for this shot.
    // See `of.stationClock()` (`DebugGameplay.ts`) and the `station` shot's
    // own note above for why the clock is the quantity `setTime` never
    // touched.
    stationClockTarget = A.stationClockS ?? S.stationClockS;
    if (stationClockTarget !== undefined && typeof of.stationClock === 'function') {
      of.stationClock(stationClockTarget);
    }
    pin();
    await of.run(0.5, 30);
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
    const finalYawDeg = A.yaw ?? (base + (A.yawOff ?? S.yawOff ?? 0));
    const finalPitchDeg = A.pitch ?? S.pitch ?? -2;
    of.look(finalYawDeg, finalPitchDeg);
    await of.run(1.0, 30);
    const d = of.stats().stationDraw;
    if (d === null || d.visible !== true) {
      return { valid: false, shot: name, why: 'the station is not drawing',
        stationDraw: d };
    }
    // RN-1810 DIAGNOSTIC. Everything the yaw solve above depends on, plus the
    // ACTUAL final camera direction and its bearing to the sun, published so a
    // run-to-run comparison can find which of these varies. `setup.yawDeg`
    // previously reported `fwd` (the raw spine bearing before `back`/`yawOff`
    // are applied), never the angle actually passed to `of.look`; that is
    // fixed here to `finalYawDeg` and the raw solve is kept alongside it under
    // its own name rather than silently dropped.
    const aim = of.aim();
    const postSun = window.__ofPost ? window.__ofPost.state().sun : null;
    const sunBearingDeg = postSun === null ? null
      : (Math.acos(Math.max(-1, Math.min(1,
        dot(norm(aim.dir), norm(postSun))))) * 180) / Math.PI;
    setup = { grounded: w.grounded, onDeck: w.onDeck,
      yawDeg: r2(finalYawDeg), ride,
      drawnParts: d.drawnParts, staleMaxM: d.staleMaxM,
      eyeDistM: r2(d.eyeDistM), altM: r2(st.deckR - 600000),
      diag: {
        feet: f.map(r2), u: u.map(r3), east: east.map(r3), north: north.map(r3),
        al: al.map ? al.map(r3) : al, fwdDeg: r2(fwd), baseDeg: r2(base),
        finalYawDeg: r2(finalYawDeg), finalPitchDeg,
        aimDir: aim ? aim.dir.map(r3) : null, postSun: postSun ? postSun.map(r3) : null,
        sunBearingDeg: r2(sunBearingDeg),
      } };
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
  // RN-1810 DIAGNOSTIC. WAIT FOR THE IBL BUILD COUNT TO STOP MOVING.
  // `ibl.builds` was observed to differ by exactly one between a dim and a
  // bright station capture at otherwise-matched camera/sun diagnostics, which
  // is a candidate for a REFLECTIVE hull reading a cubemap that has not
  // finished rebuilding for the space environment by the time of capture.
  // Bounded so a genuinely stuck build cannot hang the shot; the loop's own
  // iteration count is published so a probe can see whether it ever needed to.
  let iblSettleIters = 0;
  if (name === 'station') {
    let last = of.stats().ibl.builds;
    for (let i = 0; i < 20; ++i) {
      await of.run(0.3, 30);
      const now = of.stats().ibl.builds;
      iblSettleIters = i + 1;
      if (now === last) break;
      last = now;
    }
  }
  // RN-1800. READ (NEVER RE-WRITE) THE STATION'S OWN CLOCK HERE.
  //
  // The obvious move is to re-pin it again right before the capture, the same
  // idiom as the sun two lines up -- and it is wrong, found by trying it. The
  // walker is riding the deck through matched-velocity physics integration
  // once boarded (CE-30's carrier frame), not through a live pose re-parent,
  // so a second `of.stationClock()` WRITE here recomputes the station's
  // Kepler position from the new clock while the already-boarded walker's own
  // position keeps integrating from where boarding left him: exactly the
  // "left behind while the deck moves on" failure this shot already documents
  // for `standAt`, self-inflicted a second time. Measured: `eyeDistM` held at
  // 4.32 m across eleven single-pin captures and would not have stayed there
  // with a second write here (RN-1800's own sweep instrument, off the shipped
  // file, `docs/web/NUMBERS.md`). The single pin before boarding is therefore
  // the whole fix; this call only PUBLISHES what it landed on.
  const stationClock = name === 'station' && typeof of.stationClock === 'function'
    ? of.stationClock() : null;
  // RN-1810 DIAGNOSTIC. THE CAMERA POSE AT THE ACTUAL CAPTURE INSTANT, not at
  // the moment `of.look` was called: `setup.diag` above is read right after
  // aiming and BEFORE the settle windows that follow it (two more `of.run`
  // calls' worth of sim time), so if anything drifts between aiming and
  // photographing, this is the field that would show it and that one would not.
  const captureAim = name === 'station' ? of.aim() : null;
  const capturePostSun = name === 'station' && window.__ofPost
    ? window.__ofPost.state().sun : null;
  const captureSunBearingDeg = captureAim && capturePostSun
    ? (Math.acos(Math.max(-1, Math.min(1,
      dot(norm(captureAim.dir), norm(capturePostSun))))) * 180) / Math.PI
    : null;
  const captureDiag = name === 'station' ? {
    originF: captureAim ? captureAim.origin : null,
    dirF: captureAim ? captureAim.dir : null,
    postSunF: capturePostSun,
    sunBearingDeg: r2(captureSunBearingDeg),
  } : null;
  const elevDot = of.stats().sky.elevationDot;
  const sunErr = mode === 'time' ? 0 : Math.abs(elevDot - (A.sunDot ?? S.sunDot));
  if (sunErr > (A.sunTol ?? S.sunTol) && A.anySun !== true) {
    return { valid: false, shot: name,
      why: `the sun would not pin: wanted ${A.sunDot ?? S.sunDot}, `
        + `got ${elevDot} (miss ${r3(sunErr)} > ${A.sunTol ?? S.sunTol}). `
        + 'Photographing this would put a different hour under the same filename.',
      sun, elevDot };
  }

  // RN-1570. ONE capture, decoded many times, hoisted into `grab()` so the
  // shade discriminator below can take a MATCHED PAIR in this same page load
  // rather than across two scene builds. The single-capture path below calls it
  // exactly once and is unchanged to the digit.
  const grab = async () => {
    const blob = await of.screenshot();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { blob, W: bmp.width, H: bmp.height, cx };
  };

  /** The §2.1 idiom, on one rectangle. RGB is decoded rather than luma alone:
   *  a luma-only instrument reads ~0 on a hue-only change and a grade moves
   *  both (§2.6). `warm` is meanR - meanB in counts, POSITIVE IS WARM. */
  const statOn = (cx, x0, y0, x1, y1) => {
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

  /**
   * The shot's named rectangles, plus any the INVOCATION adds. A candidate
   * rectangle has to be measured before it is worth committing to `SHOTS`, and
   * editing the manifest to try one makes every trial a source change; this
   * way a grid of candidates is one `--evalargs`. Shot-declared keys lose to
   * invocation-declared ones of the same name, so a candidate can be A/B'd
   * against the committed rectangle it wants to replace.
   */
  const EXTRA = { ...(S.extra ?? {}), ...(A.extra ?? {}) };

  /**
   * RN-1900. RANGE-PLACED RECTANGLES, AND THE COMMITTED FRACTIONS BESIDE THEM.
   *
   * `groundnear.js` already places a strip by inverting its own flat-plane
   * `rangeAtRow`, and its note says exactly why a hand-written fraction is not
   * good enough on its own: at a standing eye the ground past 15 m is
   * compressed into a few dozen rows just under the horizon, and where those
   * rows are is a function of the eye height the TERRAIN gives (this pose asks
   * for 2.0 m and stands at 1.62 m), the pitch and the FOV. A fraction names
   * one range and reads another the moment the ground moves a few centimetres.
   *
   * But a probe that only ever COMPUTES its rectangles leaves the next reader
   * grid-searching them back out of a PNG, which is the exact complaint RN-1727
   * fixed for the voxel face's two ground patches. So this does both, and the
   * disagreement between them is the instrument: `rNN` is computed live from
   * the observer this capture actually had, `rNNc` is the committed fraction
   * measured on the build this lane shipped, and the report prints `rangeM` for
   * both. Equal numbers mean the pose reproduced; unequal numbers mean the eye
   * moved and say by how much, instead of silently mislabelling a strip.
   *
   * Thin (5 rows) and wide, for groundnear's reason: a strip 1120 px across is
   * 5,600 samples, while one tall enough to feel comfortable would span a factor
   * of two in range and average away the very gradient it is placed to resolve.
   */
  const RANGE_ROWS = A.rangeRowsPx ?? S.rangeRowsPx ?? 5;
  let rangeAtRow = null;
  let footAtRow = null;
  if (Array.isArray(S.rangeRects) || Array.isArray(A.rangeRects)) {
    const list = A.rangeRects ?? S.rangeRects;
    const obs = of.world().observer;
    const eyeM = obs.altM;
    const pitchDeg = obs.pitchDeg;
    const fovDeg = A.fovDeg ?? S.fovDeg ?? 60;
    const half = Math.tan((fovDeg * Math.PI / 180) / 2);
    rangeAtRow = (fy) => {
      const ndc = 1 - 2 * fy;
      const depress = -(pitchDeg * Math.PI / 180) - Math.atan(ndc * half);
      return depress <= 1e-3 ? Infinity : eyeM / Math.tan(depress);
    };
    footAtRow = (fy, H) => {
      const dy = 1 / Math.max(1, H);
      const a = rangeAtRow(fy - dy / 2);
      const b = rangeAtRow(fy + dy / 2);
      return (Number.isFinite(a) && Number.isFinite(b)) ? Math.abs(a - b) : Infinity;
    };
    const rowAtRange = (r) => {
      const ndc = Math.tan(-(pitchDeg * Math.PI / 180) - Math.atan(eyeM / r)) / half;
      return (1 - ndc) / 2;
    };
    const h = RANGE_ROWS / (2 * (A.rangeH ?? 900));
    for (const r of list) {
      const fy = rowAtRange(r);
      if (!(fy > h && fy < 1 - h)) {
        return { valid: false, shot: name, why: `rangeRects ${r} m falls off the`
          + ` frame at eye ${r2(eyeM)} m, pitch ${r2(pitchDeg)}, fov ${fovDeg}`
          + ` (fy ${r3(fy)}); that is a pose problem, not something to clamp` };
      }
      EXTRA[`r${r}`] = [A.rangeX ?? 0.15, fy - h, A.rangeX1 ?? 0.85, fy + h];
    }
  }

  /** Every named rectangle this shot declares, decoded off ONE capture. */
  const readAll = (g) => {
    const b = [S.box[0] * g.W, S.box[1] * g.H, S.box[2] * g.W, S.box[3] * g.H];
    const ex = {};
    for (const [k, f] of Object.entries(EXTRA)) {
      ex[k] = statOn(g.cx, f[0] * g.W, f[1] * g.H, f[2] * g.W, f[3] * g.H);
    }
    return { box: statOn(g.cx, b[0], b[1], b[2], b[3]), extra: ex,
      world: statOn(g.cx, 0, 0, g.W, g.H) };
  };

  // ==================================================================
  // RN-1570. THE SHADE DISCRIMINATOR. Opt-in with {"shade":true}; absent,
  // not one line below runs and the frame is the shipped one.
  //
  // RN-1492 found the smelter's vertical faces in shade in all six of its
  // camera bearings while the ground and the roof in the same frame were lit,
  // and named two candidate causes without claiming either: the SHOT's sun
  // placement, or the machine SHADOWING ITSELF. Each arm below removes exactly
  // one term and re-reads the same rectangles on the same pose.
  //
  //   nocast   the machine stops casting into the cascades; it still receives,
  //            the terrain still casts. A face that lights here was in the
  //            machine's OWN umbra.
  //   norig    no cascade casts anything. Separates "the machine shadows
  //            itself" from "the terrain/belt/tree beside it does".
  //   sweep    the sun walked right round the day at a FIXED camera. A face
  //            that no phase ever lights is a face the sun cannot reach, which
  //            is the shot-geometry cause in its measurable form.
  //
  // N.L is read analytically beside every rung, because that is what makes the
  // sweep a discriminator rather than a table: a wall whose N.L EXCEEDS the
  // roof's while the roof is lit and the wall is not cannot be explained by
  // geometry, whatever the picture looks like.
  let shade = null;
  if (A.shade === true) {
    const SH = window.__ofShade;
    if (SH === undefined) return { valid: false, shot: name, why: 'no __ofShade' };
    const bearings = A.shadeBearings ?? [0, 90, 180, 270];
    const arm = async (label) => {
      await of.run(0.5, 20);
      const g = await grab();
      const st = of.stats();
      return { arm: label, ...readAll(g),
        sun: SH.sun(), ndotl: SH.faceNdotL(bearings),
        shadow: st.shadow,
        draw: { calls: st.draw.calls, triangles: st.draw.triangles } };
    };

    // BASELINE FIRST, so no arm can leak into it.
    const base = await arm('baseline');

    const offMachine = SH.machineCast(false);
    if (offMachine.changed === 0) {
      return { valid: false, shot: name,
        why: 'the nocast arm changed NOTHING, so it is a silent identity and '
          + 'any conclusion from it would be about no machine at all. '
          + 'Failure mode 1 in ShadeDiag.ts.',
        shadeState: SH.state(), offMachine };
    }
    const nocast = await arm('nocast');
    const onMachine = SH.machineCast(true);

    // THE `norig` ARM IS A KNOWN NO-OP AND IS KEPT AS A NAMED ONE.
    // `ShadowRig.update` re-asserts `light.castShadow = this.active` EVERY
    // FRAME (ShadowRig.ts:142), so clearing it here is undone before the next
    // capture. It is run anyway, and its restore count is published, because a
    // no-op that reports itself is worth more than an arm quietly dropped: the
    // `onRig.changed === 0` below IS the evidence that the write never
    // survived, and it is the same shape as RN-1526's half-armed mirror.
    const offRig = SH.rigCast(false);
    const norig = await arm('norig');
    const onRig = SH.rigCast(true);
    const rigArmed = onRig.changed === offRig.changed && offRig.changed > 0;

    // THE BIAS SWEEP. `shadow.bias` is a depth-buffer-unit offset over a
    // 7999 m ortho range, so 6e-4 is 4.8 WORLD METRES on a 4 m machine. Three
    // r185's PCF branch adds it without the `USE_REVERSED_DEPTH_BUFFER` guard
    // that its VSM and BASIC branches carry, and this build runs PCF on
    // reversed depth. If the sign is the defect, flipping it must light the
    // face and zeroing it must land between the two.
    //
    // THE RESTORE IS READ, NOT REMEMBERED AS A LITERAL, and the first version
    // of this block got that wrong in the way that matters. It ended
    // `SH.bias(-0.0006)`, the pre-fix constant, UNCONDITIONALLY -- so every
    // `shade` run, including ones that asked for no bias arms at all, put the
    // defect back before the shot's own capture and returned a frame from the
    // build being replaced. It was caught because the headline box on
    // `smelterhero` read 19.55 under `--shade` against 45.65 on the identical
    // binary without it. A restore that names a value instead of reading one
    // is a restore that goes stale the moment the shipped value moves.
    const shippedBias = of.stats().shadow.biasUnits;
    const biasArms = [];
    for (const b of (A.shadeBias ?? [-0.0006, 0, 0.0006])) {
      const set = SH.bias(b);
      const a = await arm(`bias${b}`);
      biasArms.push({ ...a, set });
    }
    const biasRestored = SH.bias(shippedBias);

    // The sun sweep, at the SHIPPED caster setup, camera untouched.
    const steps = A.shadeSweep ?? 12;
    const sweep = [];
    for (let i = 0; i < steps; ++i) {
      const t = i / steps;
      of.setTime(t);
      await of.run(0.4, 16);
      const g = await grab();
      const r = readAll(g);
      sweep.push({ t: r3(t), sun: SH.sun(), ndotl: SH.faceNdotL(bearings),
        box: r.box, extra: r.extra, world: r.world });
    }
    // Put the shot's own sun back and re-settle, so the frame this probe
    // returns below is still the shot's frame and not the sweep's last rung.
    sun = pin();
    await of.settle(A.settle ?? 24);
    sun = pin();
    await sleep(0.2);

    shade = { base, nocast, norig, rigArmed, biasArms, shippedBias, biasRestored, sweep,
      counts: { offMachine, onMachine, offRig, onRig },
      state: SH.state(), bearings };
  }

  // RN-1876. `{"hideVm": true}` takes the SAME frame with the first-person
  // view model suppressed. It is the control half of a per-pixel difference,
  // which is the only honest way to read the model's frame share: the look
  // audit's own R4 could publish nothing better than "roughly 7.8 per cent as
  // an upper bound (a bounding rectangle ...)", and a bounding rectangle
  // around two hands and a diagonal haft is mostly world.
  //
  // ASSERTED, NOT ASSUMED. `Systems` rewrites `viewModel.visible` from the
  // camera mode on every frame, so a probe that just clears the flag captures
  // an unchanged frame and reports a coverage of zero as a result. The
  // suppression therefore goes through `Avatar.debugHidden`, is READ BACK
  // here, and a disagreement refuses the frame. The default is untouched, so
  // every capture any pass has ever taken is bit-identical.
  const vmDbg = window.__ofViewModel ?? null;
  let vmHidden = false;
  if (A.hideVm === true) {
    if (vmDbg === null) {
      return { valid: false, shot: name,
        why: 'hideVm was asked for and window.__ofViewModel does not exist, so '
          + 'the control frame would silently be the treatment frame.' };
    }
    vmDbg.hide(true);
    await of.settle(2);
    vmHidden = vmDbg.hidden();
    if (vmHidden !== true) {
      return { valid: false, shot: name,
        why: 'hideVm did not take: __ofViewModel.hidden() is still false.' };
    }
  }

  const g0 = await grab();
  const { W, H, cx } = g0;
  const blob = g0.blob;
  const stat = (x0, y0, x1, y1) => statOn(cx, x0, y0, x1, y1);

  const bx = [S.box[0] * W, S.box[1] * H, S.box[2] * W, S.box[3] * H];
  /** RN-1490. The shot's further named rectangles, decoded from the SAME
   *  capture, so an extra box costs a `getImageData` and never a second frame
   *  that would differ from the first by the wind clock and the foliage. */
  const extraPx = {};
  const extraStat = {};
  for (const [k, f] of Object.entries(EXTRA)) {
    const e = [f[0] * W, f[1] * H, f[2] * W, f[3] * H];
    extraPx[k] = e.map((v) => Math.round(v));
    extraStat[k] = stat(e[0], e[1], e[2], e[3]);
    // RN-1900. The RANGE and the pixel FOOTPRINT this rectangle actually landed
    // at, printed for every extra once a shot declares `rangeRects`, so a
    // committed fraction (`r27c`) and a live-placed strip (`r27`) can be read
    // against each other. `footM` is the vertical arm of the max() the shader's
    // fades read and is NOT the same statement as the range: at a grazing angle
    // it grows as the SQUARE of the range, so two boxes a factor of two apart
    // in range are a factor of four apart in the variable the term sees.
    if (rangeAtRow !== null) {
      extraStat[k].rangeM = r2(rangeAtRow((f[1] + f[3]) / 2));
      extraStat[k].footM = r3(footAtRow((f[1] + f[3]) / 2, H));
    }
  }
  const png = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  // RN-1900. AN OPTIONAL UPSCALED CROP OF THE SAME CAPTURE, because this lane's
  // subject is twenty pixel rows tall and a 1600x900 frame of it is a
  // deliverable nobody can judge. `{"crop":[x0,y0,x1,y1],"cropScale":4}` in
  // fractions of the frame. NEAREST-NEIGHBOUR (imageSmoothingEnabled false) on
  // purpose: a smoothed upscale would invent exactly the mid-frequency content
  // the frame is being examined for, which is the picture-side version of the
  // instrument traps this repo catalogues. Off the SAME capture, so it is the
  // same pixels the numbers above were read from and never a second frame.
  let cropPng = null;
  if (Array.isArray(A.crop) && A.crop.length === 4) {
    const k = Math.max(1, Math.round(A.cropScale ?? 4));
    const sx = Math.round(A.crop[0] * W); const sy = Math.round(A.crop[1] * H);
    const sw = Math.max(1, Math.round((A.crop[2] - A.crop[0]) * W));
    const sh = Math.max(1, Math.round((A.crop[3] - A.crop[1]) * H));
    const cv = new OffscreenCanvas(sw * k, sh * k);
    const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = false;
    c2.drawImage(await createImageBitmap(blob), sx, sy, sw, sh, 0, 0, sw * k, sh * k);
    const cb = await cv.convertToBlob({ type: 'image/png' });
    cropPng = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(cb);
    });
  }

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
    // RN-1800. The station's own orbital clock as pinned for THIS capture, so
    // a probe can verify the pin landed rather than assume it: `null` on
    // every shot but `station`.
    stationClock, captureDiag, iblSettleIters,
    // RN-1876. Whether THIS frame is the view-model control. Published on every
    // shot, so a pair is provably one variable apart rather than filed as one.
    vmHidden,
    pose,
    // THE PIPELINE THE FRAME CAME THROUGH, published so a pair can be shown to
    // be one variable apart rather than asserted to be.
    postState: post,
    shade,
    shadow: s.shadow, ibl: s.ibl,
    render: { triangles: s.draw.triangles, calls: s.draw.calls,
      programs: s.draw.programs, vramMB: s.vramEstimateMB,
      frameMs: { p50: r2(s.frameMs.p50), p95: r2(s.frameMs.p95),
        p99: r2(s.frameMs.p99) },
      passMs: { near: r2(s.passMs.near), post: r2(s.passMs.post),
        total: r2(s.passMs.total) } },
    setup, log, png, cropPng,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
