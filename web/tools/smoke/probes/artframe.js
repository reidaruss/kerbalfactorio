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
// A seventh is not the campaign plan's and says so in its own manifest row:
//   ruinwall     RN-1970's shot, the ruin's masonry square on at walking
//                distance. Six shots at 20 px/m cannot judge a per-block
//                surface property, which is how a family shipped a repeat
//                nobody photographed.
//
// AND FIVE MORE AT RN-2065, THE VISTA SET, which are the first shots in this
// file that photograph anything further away than 34 m. Their reasons are in
// their own manifest rows; the short version is that the nine above are all
// close or mid range and the world's own weaknesses live at distance and in
// the sky.
//   vista        the horizon vista at eye level from a 4.7 km ridge.
//   vistadawn    the same pose at a 5.7 degree sun.
//   vistanoon    the same pose at the top of the day arc.
// AND A SIXTH AT THAT SITE, RN-2160, which is one of RN-2065's own rejects
// promoted because a later lane needed exactly the frame it was rejected for:
//   mtnslope     the eye on a slope facing UPHILL, i.e. the steep substrate
//                filling the frame. RN-2160's terrain splat is judged here,
//                and it is a shot rather than an `--evalargs` override
//                because an override is a pose that exists in one shell
//                history: a verifier reproduced RN-2160's ratio at a guessed
//                pose and a different absolute level.
//   flyover      1,200 m over the spawn, the first-launch view.
//   limb         120 km up, the orbit-to-surface frame.
// The last two need a FLY view source and therefore their own `--scenario=`,
// because the walking capsule discards `of.teleport`'s altitude argument:
//
// The splat lane's own pair, one flag apart on one build, fresh process each
// (`--splat=0` is the before arm):
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk --width=1600 --height=900 --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"mtnslope"}' | node tools/smoke/writeshot.mjs docs/screenshots/RN2160_mtnslope_after.png
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=surface \
//     --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"flyover"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=orbit \
//     --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"limb"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
// AND ONE MORE AT RN-2130, the fidelity charter's first hero frame:
//   meadow       the plains site at a standing eye, pitch -8, dot 0.55: the
//                pose Reid's own screenshot was taken at, promoted out of
//                RN-2065's reject list because the frame the lane is judged
//                on has to be the frame the player stands in.
// The three `vista*` shots and `meadow` take the file's own `--scenario=walk`
// line at the top of this header, with the shot name changed.
//
// AND ONE MORE AT RN-2145, because the shot set could not frame its own
// headline defect:
//   meadow       plains at a standing eye with the props ON, the open-grassland
//                frame the Space Engineers comparison is actually about. Its
//                manifest row has the site, the pitch and the rectangles with
//                the reasons for each. It takes the `--scenario=walk` line at
//                the top of this header with the shot name changed:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"meadow"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
// AND TWO MORE AT RN-2285 (WORLD AUDIT R2), each added because a domain this
// audit had to SCORE had no frame anywhere in the set that could show it, and
// adding a shot is cheaper than arguing (NUMBERS.md, "a shot set can be
// structurally blind to its own subject"):
//   pondside     the home pond's dry beach looking across the water. Forge has
//                exactly ONE water surface, 55 m from the spawn pad, and no
//                canonical frame in this project has ever contained it, so
//                "water as a compositional element" was a domain nothing could
//                photograph. Its site is the pond's own centre offset 19 m
//                north; see the row for the derivation and for the drawn-water
//                assertion the setup block makes.
//   meadownight  `meadow`'s pose and rectangles to the digit at a SUB-HORIZON
//                sun (dot -0.25), i.e. the third of the day arc no shot in the
//                file reaches. `basedusk` at dot 0.20 was the darkest frame
//                this project had, and the storyline puts the player outdoors
//                overnight on day one.
// Both take the `--scenario=walk` line above with the shot name changed:
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"pondside"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"meadownight"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
//
// AND ONE MORE AT RN-2365 (WORLD AUDIT R3), added for the same reason and
// derived by SPREAD rather than transcribed (see its own block beside the
// `forestair`/`flyover` sun variants):
//   smelternight `smelterhero`'s pose, standoff, bearing and all twelve
//                rectangles TO THE DIGIT at `meadownight`'s own sub-horizon
//                sun (dot -0.25). Rank 12 of two audits is "nothing emissive
//                lights anything", and every frame that claim rests on is
//                daylit, so it cannot separate an emissive that contributes
//                nothing from one the sun is drowning. This is the only frame
//                in the file where a hot machine is the brightest object in
//                the world.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
//     --sandbox=1 --width=1600 --height=900 \
//     --evalfile=tools/smoke/probes/artframe.js --evalargs='{"shot":"smelternight"}' \
//     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
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
  const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);
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
      // RN-2475. THE FAR RUNG, AND IT IS THE FIRST RECTANGLE IN THIS PROJECT
      // THAT FRAMES THE PLAINS FAR GROUND.
      //
      // World audit R4 ranked "the plains far ground is a flat painted plane
      // past ~130 m" its number one and quoted `meadow.hzBand` iqr 4.06,
      // unmoved across three audits, as the evidence. **`meadow.hzBand`
      // contains no terrain.** Paint every terrain fragment magenta and that
      // rectangle comes back rgb (214.11, 207.55, 188.64) against a shipped
      // (214.08, 207.56, 188.60): it sits at frame y 270 to 306 and the
      // horizon at that pose is at y 317 to 325. Its 4.06 is the haze band's
      // own iqr and no ground term can ever move it, which is exactly why
      // three audits watched it not move. NUMBERS.md's site-blindness entry
      // one level finer: the rectangle was not merely at the wrong SITE, it
      // was on the wrong SIDE OF THE HORIZON.
      //
      // WHERE THE SUBJECT ACTUALLY IS, measured on the same painted frame:
      // terrain covers frame rows 310 to 322 at THIS pose at 100 per cent and
      // 0.000 to 0.02 of every row below 330, because the carpet and the
      // scatter own the whole lower frame. The plains far ground is a
      // THIRTEEN-ROW BAND under the horizon, and this rung sits in the middle
      // of it (rows 315 to 320 on the pose as committed).
      //
      // WHY 250 m AND NOT A FRACTION. `rangeRects` places it live off this
      // capture's own observer and the report prints `rangeM` and `footM`
      // beside it, and `footM` is the number this whole gap is about: at a
      // standing eye the pixel footprint grows as the SQUARE of the range --
      // 0.257 m at 18 m, 0.957 at 35, 2.79 at 60, 11.1 at 120, **48.6 at 250**
      // and 292 at 600. Every rung of the material's own ladder has retired at
      // its own Nyquist point by 130 m, so 250 m is inside the band where the
      // question "does anything draw here" has a yes/no answer. A hand-written
      // fraction would name a range it does not have the moment the terrain
      // moves the eye, and the guard above refuses outright if the range falls
      // off the frame rather than clamping it onto some other ground.
      //
      // 600 m was measured and NOT taken, and the reason is recorded rather
      // than the choice hidden: at 600 m the strip is rows 312 to 317, three
      // rows from the horizon line, and any pose drift walks it into the sky.
      // 250 m has six rows of margin on both sides.
      rangeRects: [18, 27, 35, 250],
      rangeRowsPx: 5,
      extra: {
        r18c: [0.1500, 0.4236282, 0.8500, 0.4291838],
        r27c: [0.1500, 0.3975332, 0.8500, 0.4030888],
        r35c: [0.1500, 0.3855162, 0.8500, 0.3910718],
      },
      why: 'the MID FIELD at 18 / 27 / 35 m, the band no other shot can see',
    },
    // RN-2145. THE MEADOW, AND THE SHOT SET HAD NO SUCH THING.
    //
    // The gap analysis' section 1 difference 1 is about a MEADOW: a standing
    // eye on open grassland, ground filling the lower half, nothing built and
    // no canopy in the way. Nine canonical frames and five vista poses later,
    // this project still could not take that picture. `forestfloor` is under a
    // closed canopy at pitch -26 and its ground is litter; `midfield` is the
    // right site and turns THE PROPS OFF, which is exactly the layer being
    // judged; the plains vista is a REJECT kept as evidence about the horizon.
    // A shot set that cannot frame its own headline defect is the world audit's
    // section 2.3 finding in miniature, and it costs one manifest row to fix.
    //
    // THE SITE IS `midfield`'s, verbatim (lat -7.9675, lon 116.53189, biome 2
    // Plains), so the two shots are the same ground and any difference between
    // them is the props and the carpet rather than the place. THE PITCH IS -12
    // AND NOT -10 or -26: at -10 the ground runs out of the frame at about 30 m
    // and the near carpet is a strip; at -26 the near carpet is most of the
    // frame and the mid field, which is the half a carpet is most likely to
    // leave bald, is invisible. -12 puts the feet at the bottom edge and the
    // horizon just above centre, which is the composition the SE reference is
    // in and is what the judgement is about.
    //
    // `box` is the MID FIELD, deliberately, and it was chosen before any number
    // was taken (the "a rectangle chosen after the numbers are in is a rectangle
    // chosen to agree with them" rule). `near` and `far` are its neighbours:
    // near is the band a carpet always wins and far is the band it has to hand
    // over cleanly, so the three together can say "this reads at the feet and
    // is bald at 40 m" if that is what happened.
    // MERGE NOTE (Admin, 2026-08-20): RN-2145 published this row under the
    // name `meadow`; lane A1 landed a different `meadow` pose (yaw 120,
    // pitch -8, the sky-to-ground balance hero) in the same merge window, so
    // this row is renamed `meadowfield` to keep both instruments. Every digit
    // in the RN-2145 record was taken at THIS pose (yaw 150, pitch -12).
    meadowfield: {
      scenario: 'walk', needsSandbox: false,
      lat: -7.9675, lon: 116.53189, yaw: 150, pitch: -12,
      sunDot: 0.70, sunTol: 0.06,
      box: [0.2000, 0.5200, 0.8000, 0.6000],
      // RN-2145 FIRST CAPTURE, AND THE FIXTURE WAS WRONG BEFORE THE FEATURE
      // WAS. The three rectangles above were hand-written fractions, and
      // inverting the flat-plane range map afterwards put them at 3.8 to 4.5 m,
      // 8.5 to 11.8 m and 11.8 to 16 m: NOT ONE OF THEM REACHED THE MID FIELD,
      // which is the band a carpet is most likely to leave bald and the band
      // the whole judgement is about. At a 2 m eye and a 60 degree fov, 25 m to
      // 60 m of ground occupies about seven pixels, so a hand-picked fraction
      // cannot land there and a rectangle that names a range it does not have
      // is worse than no rectangle (RN-1857's own reason for this mechanism).
      //
      // `rangeRects` places them LIVE off this capture's own observer, and the
      // report prints `rangeM` for each, so if the terrain moves the eye the
      // fixture says so out loud instead of quietly measuring somewhere else.
      // The five rungs are the five questions: 4 m is at the feet where any
      // carpet wins, 10 m is where the near rung is still dense, 25 m is the
      // handover, 55 m is inside the fade and is where "bald in the middle
      // distance" would show, and 100 m is RN-2355 to RN-2364's own addition:
      // THE PLATE BAND'S CENTRE.
      //
      // World audit R2's corrected rank 4 named the defect as the band from
      // the carpet's fade to the treeline, and until this lane no committed
      // rectangle sat anywhere past `r55` -- `hz` below measures the true
      // horizon, hundreds of metres out, which is a different question. A
      // sweep of the gap (20 to 260 m, `?grass=0` one flag apart) found the
      // floor of it empirically rather than by argument: iqr fell to 17.00
      // at 95-100 m on the shipped (pre-fix) build while the BARE terrain
      // underneath, now real material since L1's RN-2340, read 42 to 45 --
      // i.e. the carpet itself was the flatter of the two at exactly this
      // range, which is GrassTuning.MAT_OUT_LO_M/HI_M's own finding. r100 is
      // that floor's centre, and it is where the fix is judged: iqr 16.48 on
      // the pre-lane build, 55.70 on this one, same rectangle and pose, fresh
      // process each (the change is a shipped constant rather than a query
      // override, so the two builds are read rather than diffed by a flag).
      // RN-2475. THE SIXTH RUNG IS `midfield`'s NEW FAR RUNG AT THE SAME RANGE,
      // deliberately, so the two poses at this site can be read against each
      // other: `midfield` declares `props: false` and its 250 m strip is 100
      // per cent terrain, this one keeps the props and its 250 m strip is 48 to
      // 74 per cent terrain with distant scatter in the rest. Same site, same
      // range, one flag of difference in what stands on it, which is the pair
      // "is the far ground bare, and is it bare in the frame the player
      // actually gets". See `midfield`'s own note for why `meadow.hzBand`,
      // which R4 called the only rectangle framing this subject, is above the
      // horizon and contains no terrain at all.
      //
      // AT THIS POSE THE SUBJECT IS ROWS 278 TO 296 and this rung lands at 287
      // to 292, measured on the terrain-painted frame. `hz` above is NOT this
      // rectangle and does not replace it: `hz` spans rows 252 to 297, so more
      // than half of it is sky, and its own note already records that it was
      // placed by looking rather than by range.
      rangeRects: [4, 10, 25, 55, 100, 250],
      rangeRowsPx: 5,
      extra: {
        sky: [0.3000, 0.1000, 0.7000, 0.2000],
        // RN-2195. THE KHAKI STRIP ITSELF, added rather than range-mapped like
        // `r4`..`r55` above (on `sky`'s own plain-fraction precedent, a few
        // lines up): the geometric range at this band is many hundreds of
        // metres to the true horizon, far past REACH_M and the prop scatter's
        // own reach, where `rangeRects`' flat-plane inversion is not the
        // right tool. Located by looking (RN2195_meadowfield_after.png): the
        // tan/khaki band sits between the treeline and the sky, roughly
        // y 0.28 to 0.33 of the frame.
        //
        // CORRECTION, RN-2355 to RN-2364. THE OLD NOTE HERE CLAIMED THIS BAND
        // WAS "insensitive to a term that only acts past it" (the carpet's
        // own 2 to 60 m domain). That was already stale by the time this lane
        // measured it: `hz`'s own pixel band (y 252 to 297 of 900) OVERLAPS
        // `r85` through `r130`'s rows (297 down to 292), not just the true
        // horizon past REACH_M. `hz` therefore DOES move with the far rung's
        // own tuning -- measured here at 90.48 before this lane's fix and
        // 96.84 after, on the same build, one flag apart -- and that is
        // corroborating evidence for the fix rather than noise: `hz` sits
        // inside the plate band it was assumed to sit past.
        hz: [0.0500, 0.2800, 0.9500, 0.3300],
        // WG-260. THE 170-TO-550 m BAND, TWO RECTANGLES, AND THE LADDER THEY
        // ARE PLACED FROM. 2.32.10 item 3 asked for rows 278-284 and told
        // whoever committed it to re-derive the placement from their OWN
        // corrected centre-column ladder rather than reuse its numbers.
        //
        // This is that ladder, re-taken at WG-260 on a throwaway build that
        // painted the terrain fragment's own `dist` as a THREE-BIT RGB CODE
        // (six thresholds, one bit per channel, so a level is identified by
        // WHICH CHANNELS ARE ON and never by a luminance the tone curve
        // compresses -- a first attempt using six equal luminance steps put
        // four of its six rungs inside one count of each other and could not
        // be decoded), captured at 1600x3600 so every 900-frame row is four
        // rows wide, and read at the narrow centre column `x` in [795, 805).
        // Rungs, converted back to 900-frame rows:
        //
        //     100 m -> row 293.9        170 m -> row 281.6
        //     130 m -> row 288.4        210 m -> row 279.1
        //     past 690 m -> rows 274.3 to 278.7     horizon -> row 273.9
        //
        // `170 m -> 281.6` reproduces 2.32.3's corrected `281.3` to a third
        // of a row, from an instrument that shares no code with it. That is
        // the independent confirmation that record asked for.
        //
        // AND IT OVERTURNS 2.32.10's OWN PREDICTED RANGE FOR THIS RECTANGLE.
        // That item reads rows 278-284 as "roughly 340 m at the top to about
        // 150 m at the bottom". The bottom is right: row 284.5 interpolates
        // to about 150 m between the measured 170 m and 130 m rungs. The top
        // is not. At this column there is NO VISIBLE GROUND AT ALL between
        // about 210 m and 690 m: it is hidden behind the near rise, whose own
        // crest is the local skyline, so the painted code steps straight from
        // the 170-to-210 m level to the past-690 m level inside a single
        // 900-frame row. Row 278 is therefore ground BEYOND 690 m. Top to
        // bottom the rectangle reads about 14 per cent far ground past 690 m,
        // about 37 per cent at 170 to 210 m, and about 49 per cent inside the
        // 170 m prop ring.
        //
        // NARROW IN X, AND THE WIDTH IS MEASURED RATHER THAN ASSUMED. The
        // same 170 m rung sits at 4x-row 1119.5 at `x` 500, 1126.3 at `x` 800
        // and 1134.5 at `x` 1100, so iso-range contours curve by 3.75
        // 900-frame rows across that span and a wide rectangle would smear
        // its own range boundary over half its height. [0.45, 0.55] holds it
        // inside about one row. That is 2.32.3's lesson applied to the
        // RECTANGLE and not only to the instrument that placed it.
        midband: [0.4500, 0.3088889, 0.5500, 0.3166667],
        // AND THE ONE THE TERM ACTUALLY LIVES IN, because `midband` is on the
        // GROUND side of the horizon and everything the mid tier places
        // stands on the SKY side of it. A 12 m tree at 210 m reaches row 234
        // and one at 690 m reaches row 265, while the far impostor wall it
        // stands in front of tops out around row 265. Rows 236 to 264 are
        // therefore the band that is pure sky without this tier and
        // silhouette with it. Committing only `midband` would be NUMBERS.md's
        // straddle trap in mirror image -- a rectangle on the wrong side of
        // the horizon for the term it is asked about -- so both ship and both
        // get quoted. Wide in `x` deliberately: this one asks a COVERAGE
        // question, not a range one, so contour curvature cannot smear it.
        midtree: [0.1500, 0.2622222, 0.8500, 0.2944444],
      },
      why: 'the MEADOW: plains at a standing eye, the frame section 1 '
        + 'difference 1 is about, and the one no shot in this file could take',
    },
    // ===================== RN-2065. THE FIVE VISTA POSES =====================
    //
    // WHY THEY EXIST. Every shot above this line is close or mid range: the
    // furthest subject any of them frames is the ruin at 34 m, and RN-1900
    // added `midfield` precisely because 18 to 44 m was invisible to the other
    // seven. Past 44 m the shot set has NOTHING, and past 44 m is where the
    // world's own work is: the canopy ring ends at 620 m, the shadow rig's
    // last cascade ends at 300 m, the macro tint fades out over 600 to 4000 m
    // and the aerial-perspective integral is the only thing rendering
    // anything at all beyond that. Nine canonical frames could not have judged
    // one of those, and a look audit taken on them alone would have concluded
    // the world is finished at the exact ranges where a player spends most of
    // the game looking.
    //
    // THE SITE IS `mtn` (lat 2.036 / lon 144.056) AT YAW 120, AND BOTH HALVES
    // OF THAT WERE CHOSEN BY CAPTURE RATHER THAN BY ARGUMENT. Six frames were
    // taken and five are rejects; they are recorded rather than deleted,
    // because "stand somewhere high and look out" is not a pose and each
    // reject is a real reading about the world. All six on real D3D11 through
    // this manifest, sun pinned to dot 0.70, 1600x900:
    //   plains (-7.9675, 116.53189), biome 2. REJECTED as a vista and KEPT as
    //       evidence (`docs/screenshots/RN2065_sweep_plains.png`): the horizon
    //       is flat to 59 km and the frame holds no relief to judge at any
    //       range. It is also the frame that costs the most anywhere in this
    //       file -- 2,759,465 triangles, 71 calls, frame p50 32.1 ms -- which
    //       is over the `StatsProbe` ALERT triangle threshold and twice a
    //       60 Hz budget, at a standing eye on flat ground with nothing built.
    //   forest (-19.85, -72.7853), biome 3, 1,420,222 tris, p50 13.6 ms. The
    //       canopy fills the frame to the horizon line, so the shot measures
    //       the tree ring and never the terrain behind it.
    //   hills2 (22.286, 108.84406). Rejected and kept for the same reason as
    //       plains: it is the frame in which the distant snow band reads as
    //       flat white paper over a near-black mid ground, which is a finding
    //       and not a vista.
    //   mtn at yaw 300 and at yaw 210, biome 5 (Mountains). Both stand the eye
    //       on a slope FACING UPHILL: the frame is 80 per cent scree at 5 to
    //       40 m and holds no horizon at all. This is the trap in picking a
    //       site by its elevation: a high site is not a high VIEW, and the
    //       walker lands wherever the surface oracle puts him.
    //   mtn at yaw 120, biome 5, 591,906 tris, 47 calls, p50 10.1 ms. SHIPPED.
    //       Six ridge lines between the eye and the horizon, the whole depth
    //       ladder in one frame (near scree, the 300 m shadow edge, the macro
    //       tint fade over 600 to 4000 m, the aerial-perspective integral
    //       carrying everything past that), and it is the CHEAPEST of the six
    //       by a factor of 4.7 against plains, which is worth stating: the
    //       frame with the most distance in it is not the expensive one.
    // The site's own elevation is not re-measured here and is not this shot's
    // claim. `of.world().observer.altM` reads 1.62 at every one of the six
    // because the walking capsule reports the EYE ABOVE THE GROUND and not the
    // ground above the datum; `ConfigTypes.ts` records lat 2 / lon 144 at
    // 4,667.789 m as of 2026-08-03 and `setup.biome` 5 agrees with the
    // Mountains half of that. If the ridge ever drifts the way the old spawn
    // did, the biome in the report is what says so.
    //
    // PITCH IS -2 AND NOT 0, so the horizon sits just above the frame centre
    // and both halves carry signal. At pitch 0 the top half is 450 rows of
    // sky gradient and the ground below the horizon is compressed into a
    // strip too shallow to hold a range rectangle.
    //
    // THREE SUNS, ONE POSE, AND THAT IS THE POINT. `vista`, `vistadawn` and
    // `vistanoon` differ in exactly one manifest field (`sunDot`), so the day
    // arc becomes a controlled comparison at a fixed camera rather than three
    // pictures of three places. §2b measured the dusk half of the cycle at
    // four sites and had no picture of any of them at a range past 5 m;
    // `basedusk` closed that for a BASE at 19 m and cannot see a horizon.
    //
    // THE RECTANGLES ARE A DEPTH LADDER AND A SKY TRIPLE, and both are claims
    // this file has never been able to make.
    //   `box`     the canonical box, and on this shot it is the HAZE BAND: the
    //       far basin and the ridge behind it, i.e. the part of the frame that
    //       is nothing but atmosphere and terrain tint.
    //   `skyL` / `skyR`, the same height either side of frame centre, and
    //       `skyHz`, a clean patch just over the ridge line. An analytic
    //       Rayleigh/Mie integral must brighten and warm toward the sun AND
    //       toward the horizon; a gradient dome can only do the second. The
    //       three together separate those two, and the pair only means
    //       anything once you know which side the sun is on, which is why
    //       `setup.sunYawOffDeg` is published beside them and why the boxes
    //       are named for the FRAME and not for the sun (naming a rectangle
    //       `skySun` before establishing the bearing is how a reading gets
    //       filed backwards).
    //   `hzBand` the furthest ridge in the frame; `mid` a nearer ridge with
    //       the same material on it; `nearG` the scree at 5 to 40 m. Aerial
    //       perspective is a CONTRAST RAMP over range, so a single rectangle
    //       cannot see it and three can: the claim is about `iqr` and `sat`
    //       FALLING monotonically from `nearG` to `hzBand`, not about any one
    //       of their values.
    //   `nearG` DELIBERATELY STOPS ABOVE y = 0.76 so it cannot clip the
    //       first-person view model, which occupies the bottom 12 per cent of
    //       every ground frame in this file (section 2.8 R4).
    // They are committed as fractions, RN-1727's rule, so a verifier reads
    // them out of the manifest instead of grid-searching them out of the PNG.
    vista: {
      scenario: 'walk', needsSandbox: false,
      lat: 2.036, lon: 144.056, yaw: 120, pitch: -2,
      sunDot: 0.70, sunTol: 0.06,
      box: [0.2500, 0.4600, 0.7500, 0.6000],
      extra: {
        skyL: [0.0500, 0.1000, 0.2000, 0.2000],
        skyR: [0.8000, 0.1000, 0.9500, 0.2000],
        skyHz: [0.4000, 0.3300, 0.6000, 0.3800],
        hzBand: [0.0500, 0.4600, 0.2500, 0.5600],
        mid: [0.4000, 0.5400, 0.7000, 0.6000],
        nearG: [0.2000, 0.7100, 0.8000, 0.7600],
      },
      why: 'the HORIZON VISTA at eye level on high ground, the range ladder',
    },
    vistadawn: {
      scenario: 'walk', needsSandbox: false,
      lat: 2.036, lon: 144.056, yaw: 120, pitch: -2,
      // 0.10 and not 0.20. `basedusk` takes 0.20 because at 0.12 its subject
      // (a base at 19 m) went to world luma 15.6 and could not be judged. This
      // shot's subject is the SKY and the horizon, which are the two things a
      // low sun makes brighter rather than darker, so it can go lower than any
      // ground shot in this file and should: 0.10 is 5.7 degrees, inside the
      // band where a real atmosphere reddens and a gradient dome does not.
      sunDot: 0.10, sunTol: 0.03,
      box: [0.2500, 0.4600, 0.7500, 0.6000],
      extra: {
        skyL: [0.0500, 0.1000, 0.2000, 0.2000],
        skyR: [0.8000, 0.1000, 0.9500, 0.2000],
        skyHz: [0.4000, 0.3300, 0.6000, 0.3800],
        hzBand: [0.0500, 0.4600, 0.2500, 0.5600],
        mid: [0.4000, 0.5400, 0.7000, 0.6000],
        nearG: [0.2000, 0.7100, 0.8000, 0.7600],
      },
      why: 'the same vista at a 5.7 degree sun: the low-sun half of the arc',
    },
    // RN-2175 (fidelity lane A4). THE SUN, IN FRAME, and it closes world-audit
    // gap 16: "no canonical frame contains the sun disc ... should be closed by
    // whichever lane touches the sky, since it costs one manifest row".
    //
    // A COMMITTED ROW AND NOT AN --evalargs OVERRIDE, which is RN-2169's rule
    // paid forward: that lane published a ratio from a pose the command line
    // carried and the record did not, and a verifier reproduced the ratio at a
    // different absolute level because there was nothing to reproduce FROM.
    //
    // The pose is `vistadawn`'s site turned to FACE the sun. `vistadawn` reports
    // sunYawOffDeg -52.70 at yaw 120, so yaw 67.3 puts the sun on the frame's
    // vertical centre line, and pitch +6 against a 5.85 degree sun puts it
    // within a degree of the frame centre. The horizon therefore sits 6 degrees
    // below centre, which at a 60 degree vertical field over 900 px is y = 0.60,
    // and every rectangle below is placed off that number rather than guessed.
    dawnsun: {
      scenario: 'walk', needsSandbox: false,
      lat: 2.036, lon: 144.056, yaw: 67.3, pitch: 6,
      sunDot: 0.10, sunTol: 0.03,
      box: [0.2500, 0.2000, 0.7500, 0.5000],
      extra: {
        // The disc is 0.53 degrees, i.e. 8 px of the 900. This rectangle is 48
        // px and is therefore mostly AUREOLE with the disc inside it, which is
        // stated because a reader would otherwise take `sunCore` for the disc's
        // own radiance. The disc cannot be measured by a rectangle at this
        // resolution and this lane does not claim to have measured it.
        sunCore: [0.4850, 0.4700, 0.5150, 0.5300],
        glareIn: [0.4400, 0.4200, 0.5600, 0.5800],
        glareOut: [0.3200, 0.3400, 0.6800, 0.6600],
        skyUp: [0.4000, 0.0300, 0.6000, 0.1000],
        skyOff: [0.0300, 0.0300, 0.1500, 0.1200],
        hzBand: [0.0500, 0.6200, 0.3500, 0.6800],
      },
      why: 'the SUN IN FRAME at a 5.7 degree sun: the disc, its glare falloff and the warm sky around it (audit gap 16)',
    },
    vistanoon: {
      scenario: 'walk', needsSandbox: false,
      lat: 2.036, lon: 144.056, yaw: 120, pitch: -2,
      // THE TOP OF THE DAY ARC, AND THE MISS IS THE MEASUREMENT. `dirForT`
      // fixes the sun's declination at a constant 0.42 y-component
      // (`SkyPass.ts`), so a site's maximum elevation is a property of its
      // latitude and nothing else, and 0.92 is reachable at lat 2.036 and is
      // NOT reachable at most of the sites in this file. `setSunElev` returns
      // the closest phase it found rather than refusing, so `sunTol` is what
      // turns an unreachable ask into a refusal instead of a photograph of a
      // different hour (machinemat.js's rule, this file's own header).
      sunDot: 0.92, sunTol: 0.06,
      box: [0.2500, 0.4600, 0.7500, 0.6000],
      extra: {
        skyL: [0.0500, 0.1000, 0.2000, 0.2000],
        skyR: [0.8000, 0.1000, 0.9500, 0.2000],
        skyHz: [0.4000, 0.3300, 0.6000, 0.3800],
        hzBand: [0.0500, 0.4600, 0.2500, 0.5600],
        mid: [0.4000, 0.5400, 0.7000, 0.6000],
        nearG: [0.2000, 0.7100, 0.8000, 0.7600],
      },
      why: 'the same vista at the top of the day arc: shortest shadows',
    },
    // RN-2130 (FIDELITY LANE A1). `meadow`: THE POSE REID'S OWN SCREENSHOT WAS
    // TAKEN AT, PROMOTED FROM A SWEEP REJECT TO A MANIFEST ROW.
    //
    // The plains site (-7.9675, 116.53189, biome 2) is RN-2065's most damning
    // reject and it is kept in that row's prose as evidence. The fidelity
    // charter (`docs/web/FIDELITY-GAP-2026-08-19.md`) makes it a HERO FRAME
    // instead, and the promotion is the point: the frame the lane is judged on
    // has to be the frame the player actually stands in, not the one that
    // photographs best. The storyline puts the player on flat ground gathering
    // wood for the first several hours; the vista set never photographs that.
    //
    // WHY THIS POSE AND NOT `vista`'s. `vista` is a RANGE ladder: a 4.7 km
    // ridge at pitch -2 with six ridge lines in it, and its subject is the air.
    // This shot's subject is the GROUND CARPET at 2 to 30 m and the shade
    // inside it, so the pitch is -8 (the horizon sits at about y = 0.30 and the
    // meadow gets two thirds of the frame) and the sun is dot 0.55, about 33
    // degrees, which is the hour that casts a readable prop shadow rather than
    // the near-zenith light that hides the defect this lane is fixing.
    //
    // IT IS THE MOST EXPENSIVE FRAME IN THIS FILE and that is recorded rather
    // than avoided: 2,759,465 triangles / 71 calls at RN-2065, over the
    // StatsProbe ALERT threshold, on flat ground with nothing built. Cost is
    // L2's subject, not A1's; this lane must not make it worse and does not
    // claim to make it better.
    //
    // THE RECTANGLES ARE A SKY-TO-GROUND BALANCE, which is section 1
    // difference 4's actual complaint, plus the shade patch difference 3 is
    // about. `skyHi`/`skyHz` against `nearG`/`mid` is the balance; `hzBand` is
    // the milk wall; `shade` sits in the near meadow where the understorey
    // casts, so "shadowed grass reads blue-green, never black" becomes a
    // reading (`warm` and `sat` on that box) instead of an adjective.
    meadow: {
      scenario: 'walk', needsSandbox: false,
      lat: -7.9675, lon: 116.53189, yaw: 120, pitch: -8,
      sunDot: 0.55, sunTol: 0.05,
      box: [0.2500, 0.5200, 0.7500, 0.7000],
      extra: {
        skyHi: [0.3500, 0.0500, 0.6500, 0.1500],
        skyHz: [0.4000, 0.2200, 0.6000, 0.2800],
        hzBand: [0.0500, 0.3000, 0.4000, 0.3400],
        mid: [0.3000, 0.4000, 0.7000, 0.4600],
        nearG: [0.2000, 0.6600, 0.8000, 0.7400],
        shade: [0.0600, 0.7000, 0.2600, 0.7500],
      },
      why: 'the PLAINS MEADOW at a standing eye: hero frame 1 of the fidelity '
        + 'charter, the ground carpet and the shade inside it',
    },
    // AND A SIXTH AT THIS SITE, RN-2160, WHICH IS A REJECT PROMOTED.
    //
    // RN-2065 swept six framings to pick the vista and recorded `mtn at yaw
    // 300` as one of five REJECTS: "both stand the eye on a slope facing
    // uphill", which is the wrong frame for a horizon vista and was kept only
    // as a note about picking a viewpoint by elevation. It is exactly the
    // RIGHT frame for a question that had not been asked yet, which is what a
    // STEEP SUBSTRATE is made of, and RN-2160's splat is the first term whose
    // subject is that surface. So the reject is promoted to a shot rather than
    // re-derived, and the reason it is a shot at all is a process one: RN-2160
    // took this frame by overriding `vista` on the command line
    // (`--evalargs='{"shot":"vista","yaw":300,"pitch":-8}'`), which photographs
    // fine and RECORDS NOTHING. A fresh-context verifier reproduced that lane's
    // published RATIO at a guessed pose and a different absolute LEVEL, which
    // is the whole failure: an ad-hoc override is a pose that exists in one
    // shell history. THE FILE'S OWN HEADER RULE IS "reproducible to the pose",
    // and an `--evalargs` override is not a pose, it is a rumour about one.
    //
    // THE RECTANGLES ARE `vista`'s FRACTIONS TO THE DIGIT, deliberately, so the
    // RN2160_mtnslope frames already committed remain readable against this row
    // rather than being orphaned by it. THREE OF THEM ARE RENAMED AND NOT
    // MOVED, because at yaw 300 the slope fills the frame and the boxes
    // `vista` calls `skyL`, `skyR` and `skyHz` land on GROUND here. A rectangle
    // whose name asserts a subject it does not contain is the shape of defect
    // section 2.1's own notes keep finding, and renaming costs nothing while
    // leaving them would have published three "sky" luminances measured off a
    // mountainside. `hzBand`, `mid`, `nearG` and `box` keep their names because
    // at this pose they still mean what they say: `hzBand` is the far ridge
    // over the shoulder of the slope, `mid` the middle distance, `nearG` the
    // ground at the feet, and it is `nearG` that RN-2163's pair is quoted on.
    mtnslope: {
      scenario: 'walk', needsSandbox: false,
      lat: 2.036, lon: 144.056, yaw: 300, pitch: -8,
      sunDot: 0.70, sunTol: 0.06,
      box: [0.2500, 0.4600, 0.7500, 0.6000],
      extra: {
        upL: [0.0500, 0.1000, 0.2000, 0.2000],
        upR: [0.8000, 0.1000, 0.9500, 0.2000],
        upC: [0.4000, 0.3300, 0.6000, 0.3800],
        hzBand: [0.0500, 0.4600, 0.2500, 0.5600],
        mid: [0.4000, 0.5400, 0.7000, 0.6000],
        nearG: [0.2000, 0.7100, 0.8000, 0.7600],
      },
      why: 'the eye on a MOUNTAIN SLOPE facing uphill: the steep-substrate '
        + 'frame, where the terrain material has to carry the whole picture',
    },
    // RN-2285 (WORLD AUDIT R2). `pondside`: THE ONLY WATER SURFACE IN THE
    // WORLD, AND NO FRAME HAS EVER CONTAINED IT.
    //
    // The world audit's gap 11 ("the water shader is good and there is exactly
    // one pond in the world wearing it") was carried forward twice on prose
    // alone, because nothing in `SHOTS` could photograph water: nine of the
    // canonical shots are inside forty metres of dry ground, the vista set is
    // a 4.7 km ridge above the treeline, and the aerials are 1,200 m up. A
    // domain nothing can photograph accumulates no findings and a queue ranked
    // by findings ranks it last for ever, which is this file's own recorded
    // lesson at RN-2065.
    //
    // THE SITE IS DERIVED, NOT SCOUTED BLIND. `cubed_sphere.h` puts Forge's
    // one pond at `pondDir` (-0.86689714668285123, -0.059473307692452633,
    // 0.49492652257203795), 55 m from the spawn pad and wholly inside the
    // 150 m dead-flat disc, with a 22 m basin, a waterline at 16.623 m and
    // 3.40 m of water at the middle. `dirToLatLon` (lat = asin(y),
    // lon = atan2(z, x)) puts that centre at lat -3.409582, lon 150.277209;
    // this eye stands 19 m NORTH of it, i.e. 2.4 m of dry beach outside the
    // waterline, and looks back south across the whole pond. Four bearings
    // were taken to choose it (0 / 90 / 180 / 270) and 180 is the only one
    // with the far bank, its wood and the sky above it in the same frame.
    // THE LAT/LON ARE LITERALS FOR THE REASON EVERY OTHER ROW'S ARE: the site
    // IS the pose. What is NOT trusted is that the pose still LANDS on water,
    // which is why the setup block below asserts the water mesh was drawn.
    //
    // WHY dot 0.55 AND NOT NOON. Water's whole subject is the specular and the
    // Fresnel, and both are a function of the angle between the eye, the
    // surface and the sun; a near-zenith sun at a shallow eye puts the
    // reflected sun behind the camera and photographs the one hour at which a
    // water shader has least to say. 0.55 is `meadow`'s own constant, so the
    // two ground heroes are lit the same and the pond can be compared with the
    // field beside it rather than only with itself.
    pondside: {
      scenario: 'walk', needsSandbox: false,
      lat: -3.4077676, lon: 150.277209, yaw: 180, pitch: -8,
      sunDot: 0.55, sunTol: 0.05,
      // Open water, clear of the near shore and of the sand bar at frame right.
      box: [0.1500, 0.5000, 0.6500, 0.7000],
      extra: {
        sky: [0.3500, 0.0500, 0.6500, 0.1500],
        wood: [0.2000, 0.2700, 0.8000, 0.3600],   // the far bank's tree line
        bank: [0.2500, 0.3850, 0.7500, 0.4250],   // the far bank's grass strip
        shore: [0.7500, 0.5200, 0.9500, 0.5800],  // the wet sand bar, frame right
        nearW: [0.0500, 0.8000, 0.2500, 0.8800],  // water at the feet, clear of the gloves
      },
      why: 'the HOME POND from its own beach: the only water surface on Forge, '
        + '55 m from the spawn, and the first frame in this file to contain any',
    },
    // RN-2285 (WORLD AUDIT R2). `meadownight`: THE THIRD OF THE DAY ARC NO
    // SHOT IN THIS FILE REACHES.
    //
    // Every sun in `SHOTS` is above the horizon and the lowest is `basedusk`
    // at dot 0.20. So the whole of the night -- the star field, the ambient
    // floor, the headlamp, whether a player can read the ground at all -- has
    // never been judged, and the storyline has the player outdoors on foot
    // through the first night. `setSunElev` reaches a sub-horizon phase at
    // this site: dot -0.25 pins with a miss inside 0.03, measured before this
    // row was written.
    //
    // IT IS `meadow` ONE FIELD APART, POSE AND RECTANGLES TO THE DIGIT, on the
    // `vista`/`vistadawn`/`vistanoon` precedent: three rows that share one
    // camera and differ in `sunDot` make the day arc a CONTROLLED comparison,
    // and a night shot at a hand-picked new site would only be comparable with
    // itself. `hzBand`, `mid`, `nearG` and `shade` keep their names because at
    // this pose they still mean what they say; what they will read is dark,
    // and reading dark is the finding rather than a reason to move them.
    meadownight: {
      scenario: 'walk', needsSandbox: false,
      lat: -7.9675, lon: 116.53189, yaw: 120, pitch: -8,
      sunDot: -0.25, sunTol: 0.03,
      box: [0.2500, 0.5200, 0.7500, 0.7000],
      extra: {
        skyHi: [0.3500, 0.0500, 0.6500, 0.1500],
        skyHz: [0.4000, 0.2200, 0.6000, 0.2800],
        hzBand: [0.0500, 0.3000, 0.4000, 0.3400],
        mid: [0.3000, 0.4000, 0.7000, 0.4600],
        nearG: [0.2000, 0.6600, 0.8000, 0.7400],
        shade: [0.0600, 0.7000, 0.2600, 0.7500],
      },
      why: 'the PLAINS MEADOW at a SUB-HORIZON sun (dot -0.25): `meadow` one '
        + 'field apart, and the only night frame this project has',
    },
    // THE TWO FLY POSES, AND THEY NEED A DIFFERENT SCENARIO, WHICH IS THE
    // WHOLE REASON THIS FILE HAD NONE.
    //
    // `Controller.teleport` DISCARDS ITS THIRD ARGUMENT (`_altM`, and the
    // contract is stated out loud at `Controller.ts` and `ConfigTypes.ts`:
    // "alt is ignored (the capsule spawns ON the surface)"). Every shot above
    // runs `--scenario=walk`, so every shot above is standing on the ground by
    // construction and no amount of arguing with `of.teleport` was ever going
    // to lift one. The altitude-honouring view source is `ObserverCamera`, and
    // it drives the frame when the scenario's mode is `fly`, which
    // `--scenario=surface`, `ascent`, `orbit` and `space` all are.
    //
    // So these two shots carry their own `--scenario=` in their invocation,
    // and the branch below REFUSES rather than photographing the ground if the
    // observer came back in a walking mode. A silently-grounded flyover is the
    // exact failure `station` spent three passes on in another costume: a
    // frame that looks fine, measures fine and is of the wrong thing.
    flyover: {
      scenario: 'surface', needsSandbox: false, fly: true,
      // The spawn's own ground, from 1,200 m. `HOME` and not a scenic site:
      // this is the view a player gets on the first launch of the storyline's
      // rocket, over the terrain the first four hours are spent on.
      lat: -3.41413, lon: 150.27984, altM: 1200,
      // -14 puts the horizon in the top fifth and the ground under the
      // aircraft in the bottom third, so the frame holds both the aerial
      // perspective ramp and the LOD ladder the eye passes over.
      yaw: 300, pitch: -14,
      sunDot: 0.55, sunTol: 0.06,
      // THE RECTANGLES WERE PLACED, CAPTURED, AND THEN MOVED, which is this
      // file's own rule (RN-1839) and worth restating: the first `hzBand` here
      // was written at y 0.21 from the pitch arithmetic and the horizon
      // actually lands at y 0.36, so it measured sky and reported it as
      // terrain. Placed against the capture now.
      //   `hzBand`      the horizon line itself.
      //   `under`       the ground DIRECTLY BELOW, i.e. a 1.2 km slant path
      //       and the shortest column of air anything in this frame is seen
      //       through. If the haze whites this out, it whites out everything.
      //   `shadowStep`  the last shadow cascade's own boundary, which crosses
      //       this frame as a hard stepped edge. Committed as a rectangle
      //       because it is a DEFECT with a location, and a defect nobody
      //       wrote a rectangle for is a defect the next pass argues about.
      box: [0.2500, 0.4500, 0.7500, 0.7500],
      extra: {
        skyBand: [0.2000, 0.0500, 0.8000, 0.1500],
        hzBand: [0.2000, 0.3500, 0.8000, 0.3750],
        under: [0.3500, 0.8500, 0.6500, 0.9800],
        shadowStep: [0.1875, 0.5900, 0.5625, 0.6444],
      },
      why: 'the MID-ALTITUDE FLIGHT VIEW at 1,200 m over the spawn',
    },
    // WG-227. THE AERIAL POSE OVER FOREST, and it exists because rendering.md
    // 2.14.10 item 3 asked for it by name: "the `vista` pose is blind to
    // vegetation ... a new aerial judgement pose over the Forest biome is
    // owed". `flyover` above is the spawn, which is HILLS, whose canopy table
    // is open woodland by design (72 stems a hectare against Forest's 230), so
    // every aerial judgement this project has ever made about its forests has
    // been made over ground that is not forest.
    //
    // IT IS A SHOT AND NOT AN `--evalargs` OVERRIDE, on `mtnslope`'s own
    // recorded reason one row up: "an override is a pose that exists in one
    // shell history ... an `--evalargs` override is not a pose, it is a rumour
    // about one". A verifier has to be able to reproduce this frame from the
    // repository alone.
    //
    // EVERY FIELD BUT lat/lon IS `flyover`'s, TO THE DIGIT, and deliberately:
    // altitude, yaw, pitch, sun and all five rectangles. The pair is then one
    // variable apart (the ground under it) and the two frames' numbers are
    // directly comparable, which is the whole reason to reuse a framing rather
    // than compose a prettier one. The site is RN-2065's own surveyed forest
    // site, the one its reject list records as "forest (-19.85, -72.7853),
    // biome 3 ... the canopy fills the frame to the horizon line".
    forestair: {
      scenario: 'surface', needsSandbox: false, fly: true,
      lat: -19.85, lon: -72.7853, altM: 1200,
      yaw: 300, pitch: -14,
      sunDot: 0.55, sunTol: 0.06,
      box: [0.2500, 0.4500, 0.7500, 0.7500],
      extra: {
        skyBand: [0.2000, 0.0500, 0.8000, 0.1500],
        hzBand: [0.2000, 0.3500, 0.8000, 0.3750],
        under: [0.3500, 0.8500, 0.6500, 0.9800],
        shadowStep: [0.1875, 0.5900, 0.5625, 0.6444],
        // RN-2265. THE HANDOVER PAIR, and the two y bounds are SOLVED from the
        // pose rather than found by looking. This camera is at 1,200 m with a
        // 60 degree vertical field and a 14 degree pitch, so a pixel at
        // vertical NDC v looks down at depression 14 - atan(v tan 30), and the
        // ground it hits is h / tan(depression) away. Solving that at the
        // canopy tier's realised reach (canopyReachM(3500, 1200) = 3,500 m)
        // gives y = 0.5746, and the two rectangles are the equal-height bands
        // either side of it: `treeIn` is ground from 3,500 m in to 3,086 m,
        // where the impostors are still being drawn at their 0.16 edge weight,
        // and `treeOut` is 3,500 m out to 4,027 m, where there has never been
        // a tree of any kind. If the far treeline hands over, these two read
        // the same; if it does not, the boundary is a step between them.
        treeIn: [0.2000, 0.5746, 0.8000, 0.6100],
        treeOut: [0.2000, 0.5392, 0.8000, 0.5746],
        // RN-2275. THE SAME BOUNDARY, SPLIT IN HALF, BECAUSE THE PAIR ABOVE
        // CANNOT TELL A GRADIENT FROM A SEAM AND THIS LANE NEEDED IT TO.
        //
        // 2.18.6 subtracted a `?canopy=0` arm from the raw step on the
        // argument that the bare frame carries the pose's own haze gradient
        // anyway. That control is valid for a term that ADDS canopy at a fixed
        // brightness and INVALID for one that changes how bright the canopy
        // is, and the arithmetic says why: across a range boundary a surface
        // reads `L0 * T + Lin`, so the step between two bands is
        // `L0_out*T_out - L0_in*T_in + (Lin_out - Lin_in)`. As `L0` falls the
        // first two terms shrink and the step tends to the pure in-scatter
        // difference, which is POSITIVE. A darker surface therefore has a
        // LARGER step across the same two bands with no seam anywhere, and
        // subtracting the BRIGHT bare arm's step charges that to the handover.
        // Measured, and this is what forced the new rectangles: the shipped
        // term's raw step is 11.96 against the bare arm's 7.42, which the old
        // instrument reports as a 4.54-count handover failure.
        //
        // THE FOUR BANDS ARE THE FIX AND THEY NEED NO CONTROL ARM AT ALL. Each
        // existing band is halved, so the profile from far to near is
        // `treeOutB`, `treeOutA`, the 3,500 m boundary, `treeInA`, `treeInB`,
        // at four equal steps in vertical NDC. A range gradient is SMOOTH
        // across all four; a seam is a jump concentrated in the ONE difference
        // that crosses the boundary, `treeOutA - treeInA`. The test is
        // therefore a SECOND difference within one frame -- that middle step
        // against the mean of its two neighbours -- and it needs no second arm,
        // no bare reference and no assumption about how haze behaves, which is
        // the whole reason to place them.
        treeInB: [0.2000, 0.5923, 0.8000, 0.6100],
        treeInA: [0.2000, 0.5746, 0.8000, 0.5923],
        treeOutA: [0.2000, 0.5569, 0.8000, 0.5746],
        treeOutB: [0.2000, 0.5392, 0.8000, 0.5569],
        // RN-2495. THE CROWN MASS ITSELF, and it is COMMITTED rather than
        // passed as an `--evalargs` override because RN-1727 refuses overrides
        // for exactly this: "an override is not a pose, it is a rumour about
        // one", and a verifier has to be able to reproduce a judged rectangle
        // from the repository alone.
        //
        // Every other rectangle on this shot is a BAND across the frame and
        // therefore averages crowns together with the clearings between them.
        // That is the right instrument for "is the wood darker than its
        // clearing" (RN-2275's four pairs read `box`, and RN-2550's band still
        // does -- but note that "averages crowns together with the clearings
        // between them" is exactly the crown-COVERAGE term that stops a patch
        // ratio from being a closed-canopy reflectance: with a black canopy and
        // no gap shadow the patch ratio can only reach 1 - f. rendering.md 2.35
        // states what the one scalar can and cannot conclude) and the WRONG one for
        // "what colour is a crown", which is what four audits have actually
        // been complaining about: at `box` the far treeline PAINT carries
        // 1.86 of this lane's 1.93-count move and the CARDS carry 0.07, so a
        // band rectangle is nearly blind to the cards.
        //
        // 0.28125, 0.6667 -> 0.40625, 0.7778 is 450,600-650,700 at 1600x900,
        // 20,000 px, placed on the dense card band in the lower-left third
        // where the impostors are largest. It is read against the SAME
        // rectangle under `?canopy=0`, which is the clearing at identical
        // range through identical air, so nothing about it is hand-balanced.
        crowns: [0.28125, 0.666667, 0.40625, 0.777778],
      },
      why: 'the MID-ALTITUDE FLIGHT VIEW at 1,200 m over FOREST, not the spawn',
    },
    limb: {
      scenario: 'orbit', needsSandbox: false, fly: true,
      // 120 km is 20 km INSIDE the ORBIT band (`Regime.ts` puts the boundary
      // at 1.0e5 m), which is deliberate: at this altitude every chunk has
      // moved to the far scaled scene, the shadow rig is off, and the sky
      // dome, the terrain shell and the planet proxy are all drawn through
      // the same shared atmosphere uniform record. If the surface-to-space
      // handover has a seam, this is the altitude it shows at.
      lat: -3.41413, lon: 150.27984, altM: 1.2e5,
      // -18, i.e. well ABOVE the 20.6 degree horizon depression at this
      // altitude, so the limb and the atmosphere ring sit across the middle
      // of the frame with black sky above and lit ground below. Pitched down
      // onto the ground (which is `ObserverCamera.reframe`'s own default here)
      // the atmosphere is edge-on nowhere in frame and the shot cannot see
      // the one thing it exists for.
      yaw: 300, pitch: -18,
      sunDot: 0.30, sunTol: 0.06,
      // SAME CORRECTION AS `flyover`, AND WORSE, so it is recorded rather than
      // quietly fixed: the first `ring` here sat at y 0.40 and the limb halo
      // actually crosses y 0.69 to 0.73, so the rectangle named for the
      // atmosphere read 0.17 counts of pure black sky. Read as published that
      // would have said "the limb has no atmosphere ring", which is the
      // opposite of what the frame shows. Placed against the capture now.
      //   `space`  black sky well above the limb: the star field's own field,
      //       and the frame's zero.
      //   `ring`   the lit atmosphere halo where it crosses the upper right.
      //   `ground` the sunlit planet surface below the terminator.
      //   `seam`   THE DEFECT, and it has a location: a set of concentric
      //       stepped ribbons along the terminator on the left, where the
      //       scaled-space terrain shell's LOD tiles catch the low sun. A
      //       rectangle on the artefact is what lets the next pass show it
      //       gone rather than describe it differently.
      box: [0.2000, 0.6000, 0.9000, 0.9000],
      extra: {
        space: [0.3000, 0.0400, 0.7000, 0.1200],
        ring: [0.5000, 0.6900, 0.6500, 0.7300],
        ground: [0.3000, 0.8200, 0.7000, 0.9500],
        seam: [0.0938, 0.7778, 0.3750, 0.9556],
      },
      why: 'the ORBIT-TO-SURFACE frame at 120 km: the limb, the ring, the shell',
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
    // RN-1970. THE SEVENTH SHOT, and it exists because six of them are taken
    // at a range where a wall is 20 px/m and none of them could have judged
    // the thing this lane was sent to fix. `ruin` frames the whole temple at
    // 34 m, which is the right frame for a silhouette and the wrong one for a
    // SURFACE: a 1.8 m tile is 38 px there, so the per-block tone that carried
    // the family's repeat is four pixels of one block.
    //
    // SQUARE ON A LONG FACE, OFF THE SITE'S OWN `wall` SOCKET AND NOT OFF A
    // GUESSED BEARING. The first version of this shot built the four side
    // normals from `quat` and stood at a radius from `sitePos`; `standAt`
    // dropped the walker ONTO THE STYLOBATE and photographed the colonnade
    // from inside, which is a picture of the pose being wrong rather than of
    // the wall. `of.ruins().list[0].points.wall` is a point the site itself
    // publishes on a cella wall, so its tangential offset from `sitePos` IS
    // the outward normal and its height above grade IS a sensible aim, both
    // measured off the placed instance rather than assumed about the model.
    //
    // WHICH OF THE TWO LONG FACES IS A SUN QUESTION AND IT IS ANSWERED WITH
    // THE SUN. The body-frame direction is `dirForT` at the pinned `sunT`
    // (SkyPass: normalize(cos 2 pi t, 0.42, sin 2 pi t)), and the face used is
    // whichever of the socket's own side and its mirror faces INTO it.
    // Choosing by measured luma would be the classifier-depends-on-the-
    // quantity-under-test trap `aimAt` above already refuses.
    //
    // 5.0 m IS THE STANDOFF AND IT IS A COMPROMISE STATED RATHER THAN HIDDEN.
    // A player reads this wall from two to eight metres. Closer than about
    // four and the frame holds under two tiles, which is too few for the
    // column instrument to say anything about a repeat; further and the block
    // detail this shot exists for starts going back into the mip chain.
    ruinwall: {
      scenario: 'walk', needsSandbox: false,
      sunDot: 0.35, sunTol: 0.02,
      standoffM: 5.0,
      box: [0.2000, 0.2000, 0.8000, 0.8000],
      extra: {
        // COMMITTED AFTER A GRID, not written by eye, which is RN-1839's own
        // rule about this file one shot along. The pose puts a hard shadow
        // edge down the left of the frame and the deck along the bottom, and
        // a rectangle holding either measures the shadow: the first
        // candidates read column-averaged std 39.6 and 53.6 counts on a wall
        // whose sunlit run reads 8.45. The two below are the sunlit face
        // alone, and `loFrac` 0.027 and 0.013 are the evidence for that
        // rather than the claim.
        //   `wall`     the sunlit upper face, and the rectangle the column
        //              instrument is read on.
        //   `wallLow`  the same face lower down, where the rain wash off the
        //              bed joints and the arris spall live.
        //
        // `wallLow` IS 84,000 px, ABOUT TWO TILES AND THREE BLOCKS, AND THAT
        // IS A WIDTH THIS FILE HAS TO KEEP SAYING OUT LOUD (RN-2018). At three
        // blocks the rectangle is largely a reading of WHICH BLOCK DREW WHICH
        // TONE, so any masonry change that re-assigns tones moves it by more
        // than the change is worth, in whichever direction the three blocks
        // happen to land. That is a reason to quote it WITH the caveat, and
        // RN-1970 instead left it out: it regressed this rectangle col.std
        // 18.76 -> 21.66 and col.peak 0.649 -> 0.830 against RN-1835 and named
        // neither figure in its report, while quoting `wall` and `cella`,
        // which had both improved. Measured across the same one-variable pair,
        // masonry albedo only:
        //   RN-1835 -> RN-1970   col.std 18.76 -> 21.66, peak 0.649 -> 0.830,
        //                        luma 79.14 -> 107.58
        //   RN-1970 -> RN-2010   col.std 21.66 -> 16.87, peak 0.830 -> 0.521,
        //                        iqr 50.03 -> 28.20, luma 107.58 -> 96.13
        // i.e. repaired past where it started. THE CAVEAT IS NOT WAIVED BY THE
        // SIGN OF THE MOVE. Three blocks is three blocks in both directions,
        // and `ruin.cella` at 34 m is the rectangle a tone-repeat claim should
        // rest on, because 19.6 tiles is a population and three blocks is not.
        //
        // THE RN-2010 ROW ABOVE IS THE RE-TAKEN, ENEMY-SUPPRESSED PAIR. Its
        // first version was rejected because both saved frames were a spider
        // at the lens (89/150 and 107/150 health). Re-taken clean, these two
        // rectangles reproduce to the last digit, `box` and `world` do not,
        // and the reason is the timing gap documented at the `peaceful` block
        // below: the creature was in the centre of frame when the measurement
        // was taken and had filled it by the time the screenshot was.
        wall: [0.5625, 0.0556, 0.9875, 0.6111],
        wallLow: [0.6250, 0.6111, 0.9750, 0.7778],
      },
      why: 'the ruin wall at walking distance, square on a sunlit long face',
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
      //
      // FORWARD POINTER, RN-2472. "Looking AFT from that same spot is the
      // whole hull against the star field" is the claim six audits then
      // measured as an interior corner. It was never true: the vestibule seat
      // is about 4.0 m from the hull's own local origin and the merged hull's
      // own bounding sphere is 36.003 m (`stationDraw.boundM`), so the eye sat
      // roughly 32 m inside solid hull volume and no look direction from
      // there could have cleared it. See the pose-dispatch block's own note
      // for the fix (the eye now leaves the bound before aiming at anything)
      // and `eyeLocal`/`eyeLocalOverBound` (published every capture) for the
      // measurement that would have caught this the first time.
      sunMode: 'time', timeOfDay: 0.60,
      // RN-2472. `back`/`yawOff`/`pitch` used to frame the OLD vestibule seat,
      // 4.0 m from the hull's own local origin, 32 m inside `boundM`'s 36.003 m
      // -- no look direction from there could ever clear the hull, which is
      // the six-audit interior reading `eyeLocal`/`eyeLocalOverBound` now
      // measure directly (rendering.md 2.27, 3.21). The eye is reseated first
      // (see the pose-dispatch block) to a point PAST the bound, straight out
      // the spine's own +X (`standAboard`'s documented convention), and the
      // base bearing below is "look back at the hull's own local origin", not
      // "along the orbit": `back`/`yawOff`/`pitchOff` are now a framing
      // offset ON TOP OF that look-at-hull bearing rather than the whole of
      // it, and 0/0/0 (dead centre) already delivers the MUST-SHOW frame RN-
      // 1935 described and this row could not reach from inside the hull: the
      // full hull, a strut truss and solar panels, against a starred sky
      // (`docs/screenshots/RN2470_station_after.png`).
      back: false, yawOff: 0, pitchOff: 0,
      // The hull's own body, clear of both first-person hands (which sit below
      // y 0.62 in this frame) and the frame's outer margin, verified by
      // capture rather than guessed: `loFrac` 0.77, `hiFrac` 0, no clipped
      // glove skin inside it.
      box: [0.0500, 0.0800, 0.9500, 0.6000],
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

  // RN-2275. THE SAME TWO AERIAL POSES AT TWO MORE SUN ANGLES, because
  // inter-crown self-shadowing is a function of solar elevation and a term
  // measured at ONE hour has not been measured. `vista` / `vistadawn` /
  // `vistanoon` are the in-repo precedent for exactly this: three rows that
  // differ in one field, `sunDot`, rather than an `--evalargs` override, which
  // `mtnslope`'s row calls "not a pose, a rumour about one".
  //
  // DERIVED FROM THE PARENT ROW BY SPREAD rather than transcribed. The pose,
  // the site and all five (or seven) rectangles must be the parent's TO THE
  // DIGIT or the arms are not comparable, and a copied rectangle block is a
  // second authority that drifts the first time either is nudged.
  //
  // THE HIGH ROW IS EACH SITE'S OWN LOCAL NOON AND THE TWO SITES DIFFER,
  // which is `lookdev.js`'s rule (its `noon` rung is "the max reachable
  // elevation at that site") and it had to be measured rather than derived.
  // The first draft of this block asked both sites for dot 0.90 on the
  // latitude arithmetic -- `forestair` sits at -19.85 and cos(19.85) = 0.941 --
  // and the pin REFUSED at 0.736, because Forge's sun is not overhead at the
  // equinox latitude that arithmetic assumes. Measured on the shipped build:
  // `forestair` tops out at 0.736 and `flyover`, twenty degrees nearer the
  // equator, at 0.897.
  //
  // A HARDCODED MAXIMUM IS A CONSTANT COPIED FROM THE THING IT WATCHES, and
  // the tolerance is what makes that safe rather than a comment promising it
  // is: 0.02 is tighter than the miss an ephemeris change would produce, so
  // the row goes `valid:false` with the achieved dot printed instead of
  // silently photographing a different hour. That is the failure this pair of
  // fields exists for, and it has already fired once in this lane.
  //
  // 0.20 is 11.5 degrees. The sun path through a canopy layer there is five
  // times the vertical one, which is the whole axis this lane is measuring,
  // and it is still well above the terminator, where the direct term starts
  // leaving for reasons that have nothing to do with crowns.
  for (const [base, tag, dot, tol] of [
    ['forestair', 'noon', 0.736, 0.02], ['forestair', 'low', 0.20, 0.02],
    ['flyover', 'noon', 0.897, 0.02], ['flyover', 'low', 0.20, 0.02],
  ]) {
    SHOTS[base + tag] = {
      ...SHOTS[base], sunDot: dot, sunTol: tol,
      why: `${SHOTS[base].why} -- at ${tag === 'noon' ? "the site's own LOCAL NOON" : 'a LOW sun'}`
        + ` (dot ${dot}), for the inter-crown self-shadow arc`,
    };
  }

  // RN-2365 (WORLD AUDIT R3). `smelternight`: THE ONE FRAME THAT CAN TELL
  // "nothing emissive lights anything" APART FROM "the sun is louder than it".
  //
  // R1 gap, R2 rank 12: a white-hot hearth throws no light and no bloom onto
  // the ground a metre away. Every frame that claim has ever rested on is a
  // DAYLIT one -- `smelterhero` and `machine` at dot 0.448, `basedusk`'s wall
  // strip at dot 0.20 -- and a daylit frame cannot distinguish an emissive
  // that contributes nothing from an emissive that contributes something
  // forty decibels under the sun. The distinction is the whole of the
  // question a lane would be dispatched to answer, and no shot in this file
  // could ever have asked it. That is the "a shot set can be structurally
  // blind to its own subject" rule (NUMBERS.md), one domain over from the two
  // shots RN-2285 added for the same reason.
  //
  // IT IS `smelterhero` ONE FIELD APART, DERIVED BY SPREAD, on the
  // `meadow`/`meadownight` precedent and for that row's own stated reason:
  // the pose, the standoff, the bearing and all TWELVE rectangles must be the
  // parent's to the digit or the arms are not comparable, and a transcribed
  // rectangle block is a second authority that drifts the first time either
  // is nudged. `firebox`, `peep` and `strip` are the emissive surfaces;
  // `plate`, `sunface`, `hearthL` and `hearthR` are clean shell and brick
  // that contain no fire BY THEIR OWN MANIFEST NOTES, so they are the
  // negative controls: if the emissive lights the machine at all, those four
  // rise off the night floor while the sky ambient cannot move them.
  //
  // dot -0.25 IS `meadownight`'S OWN PIN, unchanged, so the two night frames
  // this file now has share one sun and the machine can be read against the
  // bare meadow at the same hour rather than against itself.
  //
  //   node tools/smoke/run.mjs --url=http://127.0.0.1:<port>/ --scenario=walk \
  //     --sandbox=1 --width=1600 --height=900 \
  //     --evalfile=tools/smoke/probes/artframe.js \
  //     --evalargs='{"shot":"smelternight"}' \
  //     | node tools/smoke/writeshot.mjs docs/screenshots/<name>.png
  SHOTS.smelternight = {
    ...SHOTS.smelterhero, sunDot: -0.25, sunTol: 0.03,
    why: `${SHOTS.smelterhero.why} -- at a SUB-HORIZON sun (dot -0.25), the `
      + 'only frame in this file where a hot machine is the brightest thing '
      + 'in the world, so "nothing emissive lights anything" becomes a '
      + 'measurement instead of an inference from a daylit frame',
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
  // RN-2065. `of.game()` RETURNS NULL WHEN THERE IS NO GAMEPLAY, and until the
  // two fly shots landed nothing in this file had ever run outside
  // `--scenario=walk`, so `of.game().mode` threw before any shot-specific code
  // could run at all. The throw was a real TypeError out of `page.evaluate`,
  // i.e. no report and no frame, which is the right FAILURE and the wrong
  // MESSAGE: it says "cannot read mode of null" about a probe whose actual
  // problem would have been an unsandboxed scenario. Null-safe now, with the
  // sandbox rule unchanged for every shot that declares `needsSandbox`.
  const gameNow = typeof of.game === 'function' ? of.game() : null;
  if (gameNow !== null && gameNow !== undefined && gameNow.mode !== undefined
      && S.needsSandbox && gameNow.mode.sandbox !== true) {
    return { valid: false, shot: name, why: 'this shot needs --sandbox=1' };
  }
  if ((gameNow === null || gameNow === undefined) && S.needsSandbox) {
    return { valid: false, shot: name,
      why: 'this shot needs --sandbox=1 and there is no gameplay at all' };
  }

  // Freeze everything that moves on its own, so a pair differs only by the
  // change under test. lookdev.js's rule; the wind clock alone would otherwise
  // put a few thousand moving pixels into every pair.
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // ENEMIES ARE A THING THAT MOVES ON ITS OWN AND THIS BLOCK MISSED THEM
  // (RN-2018). They are exactly the wind clock's failure mode with legs, and
  // they cost this file a published number. RN-2010's `ruinwall` pair was
  // taken with a live hostile spider in front of the camera in BOTH arms: two
  // of its legs cross the `wallLow` rectangle diagonally and MOVE between the
  // arms, so 16.1 per cent of that rectangle's pixels differ by more than 20
  // counts, its near-black fraction goes 0.556 to 0.623, and 79 to 82 per cent
  // of it is not masonry at all. Player health read 89/150 on one arm against
  // 107/150 on the other, which is the tell in one number: THOSE WERE TWO
  // DIFFERENT SIMULATION MOMENTS, not one scene with a texture swapped. The
  // build was one variable apart and the SCENE was not, and no amount of care
  // over the manifest fixes that. `peaceful` both stops further dispatch and
  // clears what is already out (Cheats.ts `togglePeaceful` -> `setPeaceful`),
  // so it is the whole remedy rather than half of it.
  //
  // IT RUNS FOR EVERY SHOT AND NOT ONLY THE RUIN ONES, deliberately: a look
  // frame is never improved by a wandering enemy, and a shot that happens to
  // be clean today is one nest-tick away from not being. The cost is one cheat
  // flag on a throwaway probe world. `of.cheat` is absent in some builds and
  // returns a receipt rather than throwing, so this neither assumes it exists
  // nor swallows the outcome: the receipt is published on the eval under
  // `peaceful`, so a frame taken WITHOUT suppression says so in its own JSON
  // instead of looking identical to one taken with it.
  //
  // ================= THE DEFECT UNDERNEATH, WHICH IS GENERAL =================
  // THE PUBLISHED STATISTICS AND THE SAVED SCREENSHOT ARE NOT THE SAME FRAME,
  // and that is true of every shot this file has ever published. `run.mjs`
  // does: run this probe (which measures its rectangles off the canvas at its
  // own capture instant) -> `settle(20)` -> `page.screenshot`. Anything moving
  // in the world advances across that gap.
  //
  // RN-2010's rejected pair is the worked example and it cuts BOTH ways, which
  // is the part worth keeping. The screenshots are a spider filling the frame
  // and are worthless. But re-taken with `peaceful`, `wall` and `wallLow`
  // reproduce TO THE LAST DIGIT in every published field, while `box` (86.22
  // -> 90.79) and `world` (73.79 -> 75.70) move: the creature was already in
  // the centre of the frame when the measurement was taken, and had not
  // reached the right-hand wall rectangles until after it. So the numbers were
  // not all contaminated and the screenshots were all worthless, and NEITHER
  // could have been inferred from the other.
  //
  // Read a screenshot from this harness as an ILLUSTRATION of the shot, never
  // as evidence for the numbers beside it. If a frame has to be evidence, the
  // scene must hold still, which is what this block is for; `settle` cannot be
  // moved before the probe without breaking every shot that drives the world.
  // ==========================================================================
  let peaceful = null;
  try {
    peaceful = (typeof of.cheat === 'function') ? of.cheat('peaceful') : 'no of.cheat';
  } catch (e) {
    peaceful = 'threw: ' + (e && e.message ? e.message : String(e));
  }

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
  // BT-315 to BT-319. THE DISPATCH GUARD. Set to `true` by the FIRST statement
  // inside every pose-dispatch branch below, never inferred from `setup` or
  // any other side effect: those are shot-specific shapes and a guard built
  // out of one of them is a guard that only some shots can trip. Checked once,
  // right after the last dispatch branch and before `the capture` section, so
  // a shot present in `SHOTS` and in no branch refuses loudly instead of
  // photographing wherever the scenario happened to spawn the walker (see the
  // trap comment above the vista branch, and `mtnslope`'s own history there).
  let posed = false;

  // RN-1900. `midfield` takes `forestfloor`'s setup verbatim (teleport, spin to
  // convergence, pin the sun AFTER the teleport because the solve is against
  // the observer's own up, then look), at its own site, yaw and pitch. Sharing
  // the branch rather than copying it is deliberate: the two shots differ only
  // in the manifest row, and a second hand-written copy of this sequence is how
  // one of them ends up pinning the sun before the teleport.
  // RN-2145. `meadow` joins the same branch for RN-1900's reason exactly: it is
  // `midfield`'s site with a different pitch and the props LEFT ON, so a second
  // copy of this sequence would be a second chance to pin the sun before the
  // teleport.
  if (name === 'forestfloor' || name === 'midfield' || name === 'meadowfield') {
    posed = true;
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

  // RN-2065. THE VISTA FAMILY. `forestfloor`'s sequence at a different site
  // and a shallower pitch, with two additions the distance shots need and the
  // close ones never did.
  //
  // (1) THE CONVERGENCE SPIN IS LONGER AND ITS RESULT IS ASSERTED. A close
  // shot converges when the chunks under the feet arrive; a horizon shot is
  // not finished until the streamer has walked the whole quadtree out to the
  // limb, which at 4.7 km of eye altitude is several hundred chunk builds
  // through ONE terrain worker with a genBudget of 8 to 16 meshes per update
  // (`Quality.ts`). `forestfloor`'s 240 half-second spins is 120 s and was
  // written for a 2 m eye. A vista that photographs mid-stream is a picture of
  // the STREAMER, not of the world, and it would read as exactly the LOD
  // defect this shot exists to look for, so the frame is refused rather than
  // taken unconverged.
  //
  // (2) THE EYE ALTITUDE IS PUBLISHED, because the site is the whole claim.
  // `mtn` is a site the world GENERATES, and `ConfigTypes.ts` records that the
  // old spawn drifted 1,704.789 m and changed biome without anything noticing.
  // If this ridge ever moves, `setup.eyeAltM` says so in the report instead of
  // the pose quietly becoming a different pose.
  // RN-2160. `mtnslope` JOINS THIS BRANCH RATHER THAN GETTING ITS OWN, because
  // it is the same site, the same teleport, the same convergence gate and the
  // same sun pin, differing only in the two manifest fields that name a
  // framing. Splitting it out would be a second copy of the one setup that
  // publishes `eyeAltM`, and this ridge is exactly the site whose drift that
  // field exists to catch.
  //
  // AND THIS LINE IS A TRAP, WHICH IS WHY IT IS COMMENTED. The pose dispatch
  // below is a flat chain of `if (name === ...)` blocks with NO final else, so
  // a shot that is in `SHOTS` and in none of these blocks IS NEVER POSED: it
  // photographs wherever the walk scenario spawned, and every field in the
  // report -- `valid`, the rectangles, the sun solve, the render stats --
  // reads perfectly correct about the wrong place. `mtnslope` did exactly that
  // on its first run (`setup: {}`, `vramMB` 82.4 against the site's own 104.2)
  // and the only reason it was caught is that a lane happened to know what the
  // right numbers looked like. ADDING A SHOT MEANS ADDING IT HERE TOO.
  // RN-2285. `pondside` and `meadownight` join this branch and are LISTED
  // here as well as in `SHOTS`, which is exactly what the paragraph above
  // demands in capital letters. `meadownight` is `meadow`'s site and camera at
  // one different `sunDot`, so it needs nothing this branch does not already
  // do; `pondside` is a different site at the same 2 m eye, and the one thing
  // it needs beyond this branch (a proof that the water was actually DRAWN) is
  // asserted immediately after it rather than inside it, so this shared setup
  // stays one sequence for every shot that takes it.
  if (name === 'vista' || name === 'vistadawn' || name === 'vistanoon'
      || name === 'meadow' || name === 'mtnslope' || name === 'dawnsun'
      || name === 'pondside' || name === 'meadownight') {
    posed = true;
    const w0 = of.world();
    of.teleport(A.lat ?? S.lat, A.lon ?? S.lon, 2.0);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 600) await sleep(0.5);
    await sleep(1.5);
    sun = pin();                     // AFTER the teleport, forestfloor's reason
    if ((A.props ?? S.props) === false) of.propsVisible(false);
    of.look(A.yaw ?? S.yaw, A.pitch ?? S.pitch);
    await sleep(0.5);
    const o = of.world().observer;
    if (of.world().chunks.converged !== true && A.allowUnconverged !== true) {
      return { valid: false, shot: name, spins: spin,
        why: 'the terrain streamer never converged, so this frame is a '
          + 'photograph of the stream and not of the world. Pass '
          + '{"allowUnconverged":true} only when the mid-stream frame IS the '
          + 'subject.', chunks: of.world().chunks };
    }
    // WHICH SIDE OF THE FRAME THE SUN IS ON, MEASURED. `skyL` and `skyR` are
    // named for the frame because the sun's bearing is not a manifest constant
    // -- `setSunElev` solves a PHASE against this site's own up, so the
    // azimuth it lands on is a property of the site and the elevation asked
    // for, and it moves between `vista`, `vistadawn` and `vistanoon`. This is
    // the angle between the look direction and the sun, projected onto the
    // horizontal, signed so that a POSITIVE value means the sun is to the
    // RIGHT of the look direction (i.e. toward `skyR`). Without it the sky
    // pair is two numbers with no hypothesis attached, which is how a lane
    // publishes "the sun side is darker" about the anti-sun side.
    // THE LOCAL UP IS REBUILT FROM lat/lon AND THEN CHECKED AGAINST A NUMBER
    // THE ENGINE ALREADY PUBLISHES, so the convention is proven rather than
    // assumed. `FloatingOrigin` only TRANSLATES, so engine axes are body axes
    // and `dirForT`'s constant 0.42 y-component says +y is the polar axis;
    // that makes the local up at (lat, lon) the usual
    // (cos lat cos lon, sin lat, cos lat sin lon). If that reconstruction is
    // right then `dot(up, sunDir)` MUST equal `sky.elevationDot`, which is
    // defined as exactly that dot product. `upCheck` is the difference, and it
    // is published rather than asserted so a convention change shows up as a
    // number in the report instead of as a silently mirrored bearing.
    const aimNow = of.aim();
    const sunNow = window.__ofPost ? window.__ofPost.state().sun : null;
    let sunYawOffDeg = null;
    let sunElevDeg = null;
    let upCheck = null;
    if (aimNow !== null && Array.isArray(sunNow)) {
      const la = (o.latDeg * Math.PI) / 180;
      const lo = (o.lonDeg * Math.PI) / 180;
      const up = [Math.cos(la) * Math.cos(lo), Math.sin(la),
        Math.cos(la) * Math.sin(lo)];
      const s3 = norm(sunNow);
      upCheck = r3(dot(up, s3) - of.stats().sky.elevationDot);
      sunElevDeg = r2((Math.asin(Math.max(-1, Math.min(1, dot(up, s3))))
        * 180) / Math.PI);
      const f = norm(aimNow.dir);
      const fH = norm(addk(f, up, -dot(f, up)));       // look dir, flattened
      const sH = norm(addk(s3, up, -dot(s3, up)));     // sun dir, flattened
      const rgt = norm(cross(fH, up));                 // +right in the frame
      sunYawOffDeg = r2((Math.atan2(dot(sH, rgt), dot(sH, fH)) * 180) / Math.PI);
    }
    setup = { teleported: true, converged: of.world().chunks.converged,
      spins: spin, biome: of.world().biome, eyeAltM: r2(o.altM),
      sunYawOffDeg, sunElevDeg, upCheck,
      regime: of.world().regime, chunks: of.world().chunks,
      tickAdvanced: of.world().tick > w0.tick };
  }

  // RN-2285. `pondside` ASSERTS THAT THE WATER WAS DRAWN, and it is the one
  // check that separates this shot from a lat/lon typo.
  //
  // `WaterSurface` sets `mesh.frustumCulled = true` and increments `grabs`
  // inside `onBeforeRender`, which three fires ONLY for an object that has
  // survived the cull. So a non-zero `grabs` is not a claim that the pond
  // exists somewhere on the planet, it is a measurement that this camera drew
  // it -- which is the property a "water" frame has to have and the property a
  // pose two hundred metres off would silently lose while every other field in
  // the report read correct (RN-2169's own defect, one layer out).
  if (name === 'pondside') {
    const wtr = window.__ofWater;
    const st = wtr === undefined ? null : wtr.state();
    const grabs = (wtr === undefined || wtr.grabs === undefined)
      ? null : wtr.grabs();
    setup.water = st === null ? null
      : { grabs, grab: st.grab, amp: st.amp, live: st.live };
    if (grabs === null || grabs <= 0) {
      return { valid: false, shot: name, setup,
        why: 'the water mesh was never drawn at this pose (`__ofWater.grabs()` '
          + `is ${String(grabs)}), so this frame is of dry ground under a `
          + 'filename that claims a pond. Check the site against '
          + "`cubed_sphere.h`'s `pondDir` before changing anything else." };
    }
  }

  // RN-2065. THE TWO FLY POSES. See their manifest rows for why they cannot
  // share the branch above: the walking capsule discards the altitude.
  // WG-227. `forestair` is `flyover`'s pose over different ground, so it takes
  // `flyover`'s branch verbatim. Listed here and not only in `SHOTS`, because
  // this block's own comment says a shot missing from it "IS NEVER POSED" and
  // reports perfectly correct numbers about the wrong place.
  // RN-2275. The four sun-angle rows derived from `flyover` and `forestair`
  // take the same branch, and they are matched by PREFIX rather than listed,
  // because the rows themselves are built by a loop over the same two names:
  // a hand-written list here would be the second authority that goes stale the
  // moment a fifth angle is added, which is the exact shape of the trap the
  // dispatch guard forty lines down exists to catch. `limb` stays named.
  if (name.startsWith('flyover') || name.startsWith('forestair')
      || name === 'limb') {
    posed = true;
    const o0 = of.world().observer;
    if (o0.mode !== 'FLY') {
      return { valid: false, shot: name, observerMode: o0.mode,
        why: 'this shot needs the FLY view source and the observer came back '
          + `in mode '${String(o0.mode)}'. Run it with --scenario=${S.scenario} `
          + '(or add --mode=fly). The walking capsule DISCARDS of.teleport\'s '
          + 'altitude argument, so a walk-mode run of this shot photographs the '
          + 'ground and every field in the report still reads correct.' };
    }
    const w0 = of.world();
    const alt = A.altM ?? S.altM;
    of.teleport(A.lat ?? S.lat, A.lon ?? S.lon, alt);
    await sleep(2.0);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 600) await sleep(0.5);
    await sleep(2.0);
    sun = pin();
    of.look(A.yaw ?? S.yaw, A.pitch ?? S.pitch);
    await sleep(0.5);
    const o = of.world().observer;
    // ASSERT THE ALTITUDE, for the same reason `voxelface` asserts that the
    // pit exists: a shot named for a height that was not reached is filed as
    // evidence about that height.
    const tolM = Math.max(50, alt * 0.02);
    if (!(Math.abs(o.altM - alt) <= tolM)) {
      return { valid: false, shot: name, wantAltM: alt, gotAltM: r2(o.altM),
        tolM: r2(tolM), observer: o,
        why: 'the eye is not at the altitude this shot names' };
    }
    if (of.world().chunks.converged !== true && A.allowUnconverged !== true) {
      return { valid: false, shot: name, spins: spin,
        why: 'the terrain streamer never converged; see the vista branch note',
        chunks: of.world().chunks };
    }
    setup = { teleported: true, wantAltM: alt, eyeAltM: r2(o.altM),
      observerMode: o.mode, regime: of.world().regime, spins: spin,
      depthMode: of.world().depthMode, chunks: of.world().chunks,
      converged: of.world().chunks.converged,
      tickAdvanced: of.world().tick > w0.tick };
  }

  if (name === 'voxelface') {
    posed = true;
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

  // RN-2365. `smelternight` IS LISTED HERE AS WELL AS IN `SHOTS`, which is
  // what the dispatch's own comment demands in capital letters: it is
  // `smelterhero` at one different `sunDot`, so it needs nothing this branch
  // does not already do, and the branch re-pins the sun after `standAt`
  // anyway, which is the step a sub-horizon pin has to survive.
  if (name === 'machine' || name === 'smelterhero' || name === 'smelternight') {
    posed = true;
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

  if (name === 'ruinwall') {
    posed = true;
    if (typeof of.ruins !== 'function') return { valid: false, why: 'no of.ruins' };
    await of.run(0.5, 60);
    const R0 = of.ruins();
    if (R0 === null || R0.count < 1) {
      return { valid: false, shot: name, why: 'no ruin instance drawn', ruins: R0 };
    }
    const inst = R0.list[0];
    const up = inst.up;
    const wp = inst.points ? inst.points.wall : null;
    if (!Array.isArray(wp) || wp.length !== 3) {
      return { valid: false, shot: name,
        why: 'the site publishes no points.wall to stand square on',
        points: inst.points };
    }
    // The socket's offset from the site centre, split into the part along the
    // local up (its height on the wall) and the part across it (the wall's own
    // outward normal, and the radius the face sits at).
    const off = sub(wp, inst.sitePos);
    const upM = dot(off, up);
    const tan = addk(off, up, -upM);
    const radM = len(tan);
    if (radM < 1.0) {
      return { valid: false, shot: name,
        why: 'points.wall is on the site axis, so it names no face', off };
    }
    const n0 = norm(tan);
    // The sun's body-frame direction at the CURRENT pin. `pin()` has already
    // run once above; it runs again after the move because the elevation solve
    // is against the observer's own up and the observer is about to travel.
    const sunVec = () => {
      const a = 2 * Math.PI * of.stats().sky.sunT;
      return norm([Math.cos(a), 0.42, Math.sin(a)]);
    };
    const faceFor = () => {
      const sd = sunVec();
      const d0 = dot(n0, sd);
      const n = d0 >= dot([-n0[0], -n0[1], -n0[2]], sd)
        ? n0 : [-n0[0], -n0[1], -n0[2]];
      return { n, litDot: r3(dot(n, sd)),
        target: addk(addk(inst.sitePos, n, radM), up, upM) };
    };
    let face = faceFor();
    const want = A.standoffM ?? S.standoffM;
    const stand = addk(addk(face.target, face.n, want), up, A.dropM ?? 6);
    const at = of.standAt(stand[0], stand[1], stand[2]);
    if (at === null) return { valid: false, shot: name, why: 'standAt refused', stand };
    await sleep(1.5);
    let spin = 0;
    while (!of.world().chunks.converged && spin++ < 240) await sleep(0.5);
    sun = pin();                     // the observer moved, so the solve moved
    face = faceFor();                // ...and so, fractionally, did the face
    const framed = aimAt(face.target, [8, 4, 0, -4, -8],
      of.world().observer.yawDeg, [90, 16, 4, 1]);
    const r1 = of.ruins().list[0];
    setup = { standoffM: r2(gd(of.aim().origin, face.target)), wantStandoffM: want,
      wallRadM: r2(radM), wallUpM: r2(upM),
      faceNormal: face.n.map(r3), litDot: face.litDot,
      lod: r1.lod, distM: r2(r1.distM), footprintM: inst.footprintM,
      framed, converged: of.world().chunks.converged };
  }

  if (name === 'ruin') {
    posed = true;
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
    posed = true;
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
    posed = true;
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
    // RN-2472. STEP OUT PAST THE HULL'S OWN BOUND BEFORE AIMING AT ANYTHING.
    //
    // The default arrival socket (`visit:station`'s own vestibule deck, RN-822)
    // is a documented ~4.0 m from the hull's local origin (`ride.local`) while
    // the merged hull's own bounding sphere (`stationDraw.boundM`) measures
    // 36.003 m: the eye above that socket is at `eyeLocalOverBound` about 0.12,
    // i.e. inside the hull's own volume by a wide margin, which is the six-audit
    // interior reading (rendering.md 2.27, WORLD-AUDIT-R4 3.21). No look
    // direction from a point inside a closed hull's bound can photograph its
    // outside, so the eye has to leave that volume before `back`/`yawOff`/
    // `pitch` mean anything.
    //
    // `of.standAboard(lx, ly, lz)` (`DebugSeat.ts`, CE-54) reseats the SAME
    // boarded rider at an arbitrary point in the station's OWN authored local
    // frame -- "+X along the spine, +Y the radial (up), +Z across", its own
    // documented convention -- at rest in the carrier (matched velocity), so
    // this does not re-board and does not touch the real `visit:station` path
    // already exercised above; it only re-seats within it, exactly as
    // `stationride.js` and `stationwalk.js` already drive it. The default
    // target is straight out along the spine (+X), past the bound by a stated
    // margin, both overridable so the next lane can re-sweep without editing
    // this file: `eyeLx` defaults to `boundM + eyeMarginM`, `eyeLy`/`eyeLz`
    // default to 0 (on the spine's own centreline, so the hull silhouettes
    // symmetrically rather than off to one side).
    const boundM0 = of.stats().stationDraw?.boundM ?? 0;
    const eyeMarginM = A.eyeMarginM ?? S.eyeMarginM ?? 12;
    const eyeLx = A.eyeLx ?? S.eyeLx ?? (boundM0 + eyeMarginM);
    const eyeLy = A.eyeLy ?? S.eyeLy ?? 0;
    const eyeLz = A.eyeLz ?? S.eyeLz ?? 0;
    const seat2 = typeof of.standAboard === 'function'
      ? of.standAboard(eyeLx, eyeLy, eyeLz) : null;
    if (seat2 === null || seat2.error) {
      return { valid: false, shot: name, why: 'standAboard refused the exterior seat',
        seat2, boundM0, eyeLx, eyeLy, eyeLz };
    }
    await of.run(0.3, 15);
    // Aim down the spine's own local +X, with yaw measured in the LOCAL TANGENT
    // FRAME at the player's radial. A screen-space atan2 of the body-frame axis
    // is a different frame and points at a wall (stationdraw.js's own scar).
    // `w` is re-read after the reseat above: the walker's body-frame `feet`
    // moved with it, and the tangent frame below is built off THAT point.
    const w1 = of.world().player;
    const f = w1.feet;
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
    // RN-2472. THE BASE BEARING IS NOW "BACK TOWARD THE HULL", NOT "ALONG THE
    // ORBIT", because the eye no longer sits inside the hull the orbital
    // bearing used to graze. `back`/`fwd` above are kept and still published
    // (`diag.fwdDeg`/`baseDeg`) because they are still the true orbital
    // reading, but they are no longer what `of.look` is aimed from.
    //
    // The direction from the NEW seat back to the hull's own local origin is
    // computed in the hull's OWN authored frame (`[-eyeLx, -eyeLy, -eyeLz]`,
    // the negative of the point just stood at, since the origin is (0,0,0) in
    // that frame by construction -- the same frame `eyeLocal` reads into) and
    // rotated into BODY frame by the hull's live `quat` (`StationView.sync`'s
    // own orientation, local-to-world, so this is the forward rotation and not
    // `atCapture`'s inverse). Decomposed into the SAME east/north/up tangent
    // triple `fwd` used, so `of.look`'s yaw/pitch convention is unchanged.
    const sdq = of.stats().stationDraw?.quat ?? [0, 0, 0, 1];
    const rotQuat = (q, v) => {
      const [qx, qy, qz, qw] = q;
      const [vx, vy, vz] = v;
      const tx = 2 * (qy * vz - qz * vy);
      const ty = 2 * (qz * vx - qx * vz);
      const tz = 2 * (qx * vy - qy * vx);
      return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx)];
    };
    const localDir = norm([-eyeLx, -eyeLy, -eyeLz]);
    const bodyDir = rotQuat(sdq, localDir);
    const hullYawDeg = (Math.atan2(dot(bodyDir, east), dot(bodyDir, north)) * 180) / Math.PI;
    const hullHorizM = Math.hypot(dot(bodyDir, east), dot(bodyDir, north));
    const hullPitchDeg = (Math.atan2(dot(bodyDir, u), hullHorizM) * 180) / Math.PI;
    const base = A.back ?? S.back ? hullYawDeg + 180 : hullYawDeg;
    const finalYawDeg = A.yaw ?? (base + (A.yawOff ?? S.yawOff ?? 0));
    const finalPitchDeg = A.pitch ?? (hullPitchDeg + (A.pitchOff ?? S.pitchOff ?? 0));
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
    setup = { grounded: w1.grounded, onDeck: w1.onDeck,
      yawDeg: r2(finalYawDeg), ride,
      // RN-2472. The exterior reseat, named rather than folded into `diag`,
      // because a shot that stops reproducing wants this checked before
      // anything below it.
      seat2, boundM0: r3(boundM0), eyeLx: r3(eyeLx), eyeLy: r3(eyeLy), eyeLz: r3(eyeLz),
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

  // BT-315 to BT-319. THE DISPATCH GUARD. This is the general form of the trap
  // the comment above the vista branch names: the dispatch above is a flat
  // chain of `if (name === ...)` blocks with no final else, and every one of
  // them sets `posed = true` as its own first statement (never inferred from
  // `setup` or any other side effect, because those are shot-specific shapes
  // and a guard built from one of them only catches some shots). A shot that
  // is in `SHOTS` and matched none of them reaches here having done nothing to
  // the camera -- still standing wherever `--scenario=` spawned the walker --
  // and every field the capture section below would go on to fill in (`valid`,
  // the rectangles, the sun solve, the render stats) would read as a correct
  // measurement of the wrong place, exactly what happened to `mtnslope` on its
  // first run and was only caught because a lane happened to know the right
  // numbers. Refuse loudly here instead, before any of that work runs.
  if (posed !== true) {
    return { valid: false, shot: name,
      why: `THE DISPATCH GUARD: '${name}' is in SHOTS but no pose-dispatch `
        + 'branch above ran for it, so this would have photographed wherever '
        + 'the scenario spawned the walker. Add a branch for it, or join it to '
        + 'an existing one, before this shot can be trusted.' };
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
  // RN-1951. THE DRAWN HULL'S OWN POSE, AT THE CAPTURE INSTANT, AND IT IS THE
  // FIELD EVERY EARLIER PASS WAS MISSING.
  //
  // `setup.drawnParts` / `staleMaxM` / `eyeDistM` above are read right after
  // `of.look`, two settle windows before the photograph, and `staleMaxM` only
  // ever compared the TRANSLATION (`StationView.staleness`). So a hull whose
  // ORIENTATION differed run to run reported a hard zero every time. `quat` and
  // `posB` are the two numbers `StationView.sync` actually composes its engine
  // transform from, read here at the same instant as `originF` and `dirF`, so
  // "the camera is identical and the hull is not" is one comparison.
  const sd = name === 'station' ? of.stats().stationDraw : null;
  const captureDiag = name === 'station' ? {
    originF: captureAim ? captureAim.origin : null,
    dirF: captureAim ? captureAim.dir : null,
    postSunF: capturePostSun,
    sunBearingDeg: r2(captureSunBearingDeg),
    drawQuat: sd ? sd.quat : null,
    drawPosB: sd ? sd.posB : null,
    drawEyeDistM: sd ? sd.eyeDistM : null,
    drawStaleMaxM: sd ? sd.staleMaxM : null,
    drawnPartsF: sd ? sd.drawnParts : null,
    // RN-1952. WHAT IS ACTUALLY BEING RASTERISED at the capture instant. The
    // runner's own `stats` block is read AFTER the probe returns, by which time
    // this shot's walker is no longer on the deck at all (`stationDraw.visible`
    // false, `eyeDistM` 420 km), so every draw-count comparison made from it
    // was measuring the wrong frame.
    stationDrawF: sd,
    drawF: of.stats().draw,
    // RN-1953. THE HEADLAMP, AT THE CAPTURE INSTANT. Worth reading because it
    // has the right SHAPE for a run-to-run residual: `skyVis` drives the cone,
    // the hemisphere ambient AND `sunScale` together, on a 0.12/0.6 s
    // time-driven adapt, and `Headlamp.measure` asks the TERRAIN oracle how much
    // sky the eye can see, which inside a sealed hull 400 km above that terrain
    // is a question with no meaning. MEASURED FLAT on every capture of the
    // `station` shot (`skyVis`/`rawVis`/`sunScale`/`ambient`/`lampCd` all
    // constant across modal and excursion frames), so it is a RULED-OUT
    // candidate and not a suspect. Kept because a negative that had to be
    // checked is worth more published than re-derived.
    lampF: of.stats().lamp,
    // RN-1955. The near camera's ENGINE-space transform beside the hull's
    // (`stationDrawF.posE`). `originF`/`dirF` above are body-frame and cannot
    // see the floating origin; these two can, and their DIFFERENCE is what the
    // frame is actually a picture of.
    camF: of.stats().cam,
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
  //
  // RN-2031. AND THE INSTRUMENTS READ **AFTER** THE SCREENSHOT PROMISE
  // RESOLVES, WHICH IS THE FIRST TIME THIS FILE HAS READ THEM ON THE
  // PHOTOGRAPHED FRAME.
  //
  // `captureDiag` above is built BEFORE this call. `of.screenshot()` is
  // `Loop.capture()`, which parks a waiter and resolves it from inside the
  // NEXT `step()`, after `frame.render()` (`Loop.ts`). So between the two there
  // is at least one whole frame, and outside a driven `of.run` window that
  // frame's `dt` is real wall-clock rAF time rather than the fixed `1/renderHz`
  // the settle windows use. Every quantity `Loop.step` recomputes per frame --
  // `alpha`, `observer.interpolate`, `mounts.syncWatchersAt(renderTick)`,
  // `origin.toEngine`, `rig.setView` -- is therefore a DIFFERENT value in the
  // photograph than in `captureDiag`, and `captureDiag` cannot see the
  // difference by construction.
  //
  // That is the same class of defect RN-1954 already recorded one level up
  // (`run.mjs` reads its `stats` block two settle windows after the probe
  // returns) and RN-1955 recorded one level down (`of.aim()` is the fixed-tick
  // eye, not the camera). This is the third instance and the innermost: the
  // camera certificate RN-1955 built to replace `aim()` is itself read on the
  // wrong frame. `atCapture` is read here instead, in the microtask the
  // resolve schedules, before any further frame can run.
  const atCapture = () => {
    const s0 = of.stats();
    const sd = s0.stationDraw ?? null;
    // RN-2470. THE EYE, IN THE HULL'S OWN FRAME, AND IT IS A DERIVED FIELD ONLY.
    //
    // Six audits asked "is the station shot inside the hull" by reading a
    // frame with an eye, never by asking the hull itself. Everything this
    // needs already ships: `s0.cam.posE` (`Debug.ts`'s `cam`, the ENGINE-space
    // transform the frame was actually rasterised from, RN-1955) and
    // `sd.posE`/`sd.quat`/`sd.boundM` (`StationView.stats`, the drawn hull's
    // own engine position, orientation and merged bounding radius, all read at
    // this SAME `of.stats()` call so nothing here compares two instants).
    // `eyeLocal` rotates the camera-minus-hull vector by the INVERSE of
    // `sd.quat` -- the identical quaternion `StationView.sync`'s
    // `this.m.compose(this.p, this.quat, this.one)` composes the drawn
    // transform with, so this is not a second convention, only its inverse.
    // `eyeLocalOverBound` is that vector's magnitude against `sd.boundM`: under
    // 1 means the eye sits inside the merged hull's own bounding sphere and NO
    // look direction from here can find open space past all of it; over 1
    // means it cannot, structurally, whatever the frame goes on to show.
    let eyeLocal = null;
    let eyeLocalOverBound = null;
    if (sd && sd.posE && sd.quat && s0.cam && s0.cam.posE) {
      const dx = s0.cam.posE[0] - sd.posE[0];
      const dy = s0.cam.posE[1] - sd.posE[1];
      const dz = s0.cam.posE[2] - sd.posE[2];
      const [qx, qy, qz, qw] = sd.quat;
      // Conjugate of a unit quaternion is its inverse: negate the vector part.
      const ix = -qx; const iy = -qy; const iz = -qz; const iw = qw;
      const tx = 2 * (iy * dz - iz * dy);
      const ty = 2 * (iz * dx - ix * dz);
      const tz = 2 * (ix * dy - iy * dx);
      eyeLocal = [
        dx + iw * tx + (iy * tz - iz * ty),
        dy + iw * ty + (iz * tx - ix * tz),
        dz + iw * tz + (ix * ty - iy * tx),
      ];
      if (sd.boundM > 0) {
        eyeLocalOverBound = Math.hypot(eyeLocal[0], eyeLocal[1], eyeLocal[2]) / sd.boundM;
      }
    }
    return {
      cam: s0.cam ?? null,
      drawQuat: sd ? sd.quat : null,
      drawPosB: sd ? sd.posB : null,
      drawPosE: sd ? sd.posE : null,
      drawEyeDistM: sd ? sd.eyeDistM : null,
      drawVisible: sd ? sd.visible : null,
      drawnParts: sd ? sd.drawnParts : null,
      staleMaxM: sd ? sd.staleMaxM : null,
      drawBoundM: sd ? sd.boundM : null,
      eyeLocal, eyeLocalOverBound,
      clock: typeof of.stationClock === 'function' ? of.stationClock() : null,
      frames: of.world().frames, tick: of.world().tick,
      rebases: of.world().origin.rebases,
      eyeRel: of.world().eyeRel,
    };
  };
  //
  // AND IT IS BRACKETED, because neither side alone is the photograph.
  // `Loop.capture` pushes a waiter and `Loop.step` services it AFTER
  // `frame.render()`, so the photographed frame is the FIRST frame after the
  // `of.screenshot()` call: `pre` is therefore within one frame of it and is
  // the tighter certificate. The waiter is then resolved from
  // `renderer.capture().then(...)`, an async read-back and blob encode that
  // takes as long as it takes while rAF keeps running, so `post` can be many
  // frames late. Publishing BOTH makes the width of that window a measured
  // number instead of an assumption -- and the window is the subject.
  //
  // RN-2033. `{"captureDriven":true}` -- SERVICE THE CAPTURE FROM A DRIVEN
  // FRAME INSTEAD OF FROM THE FIRST NATURAL rAF FRAME. Off by default.
  //
  // `Loop.run` calls `stop()`, steps a synthetic clock at a fixed `1/renderHz`
  // with its own carried accumulator (FS-101, GP-1013: a driven run is a
  // function of its own arguments and no wall-clock value enters it), and only
  // then calls `start()` again. So the moment the probe's last settle window
  // ends, the next frame is a LIVE rAF frame, whose `dt` is a wall-clock
  // difference and therefore lands on an alpha nothing in the probe controls.
  // That is the frame `Loop.capture`'s waiter is serviced on.
  //
  // A negative `dt` there is what RN-2035 clamps, and note it is NOT unique to
  // the hand-back frame: a fresh-context verifier measured negative deltas
  // recurring throughout live rAF. This arm is therefore a control on WHICH
  // frame the photograph lands on, and not a claim about which frames are bad.
  //
  // Pushing the waiter and THEN driving turns that frame back into a driven
  // one. If the shot's spread is a property of which live frame the photograph
  // landed on, this arm removes it; if the spread survives, it is not.
  //
  // RN-2034. AND `photo`, WHICH IS THE PHOTOGRAPHED FRAME ITSELF.
  //
  // `Loop.start`'s rAF callback re-registers itself as its FIRST statement and
  // only then calls `frame(now)`. A callback registered from here, between two
  // frames, is therefore queued behind the loop's own for the next frame and
  // runs immediately after that frame's `step()` has rendered and serviced the
  // capture waiter. So one `requestAnimationFrame` after pushing the waiter
  // reads the state of the frame that was actually photographed, which is the
  // reading three passes of this shot have wanted and none has had.
  //
  // `of.settle(1)` would be the obvious way and cannot be used: `settleGate`
  // never opens for a walker 400 km above the terrain the streamer is chasing
  // (PH-89), which is why this shot runs a fixed window instead of settling.
  const grab = async () => {
    const pre = atCapture();
    let blob; let photo = null;
    if (A.captureDriven === true) {
      const pending = of.screenshot();
      // `total = max(1, round(seconds * renderHz))`, so this is exactly one
      // driven frame unless a caller asks for more.
      await of.run(A.captureDrivenS ?? (1 / 60), A.captureDrivenHz ?? 60);
      photo = atCapture();
      blob = await pending;
    } else {
      const pending = of.screenshot();
      photo = await new Promise((res) => {
        requestAnimationFrame(() => res(atCapture()));
      });
      blob = await pending;
    }
    const at = atCapture();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { blob, W: bmp.width, H: bmp.height, cx, at, pre, photo };
  };

  // RN-2550. THE LINEAR-LIGHT PATCH MEAN (`lin`), purely ADDITIVE: every field
  // below is computed exactly as before and no published number moves.
  //
  // WHY IT CANNOT BE RECOVERED FROM `luma` AFTER THE FACT. `luma` is a mean of
  // sRGB-ENCODED counts. The sRGB decode is CONVEX, so decoding a patch mean is
  // not the mean of the patch's decoded pixels (Jensen), and the two differ by
  // a term that grows with the patch's own VARIANCE. The wood arm and the
  // clearing arm do not have the same variance -- 2.19.4 measured `box` iqr
  // 64.40 on the wood against 59.62 on the bare ground at `flyovernoon` -- so
  // the error does not cancel in a wood/clearing RATIO. It has to be done per
  // pixel, and per pixel it has to be done HERE, because this is the only place
  // in the project where the pixels exist.
  //
  // AND IT IS PER CHANNEL, NEVER ON THE LUMA SCALAR. Luminance is a linear
  // functional of LINEAR radiance, so the decode goes on R, G and B and the
  // Rec.709 weights go on the DECODED values. Decoding the 8-bit luma scalar
  // instead applies a channel EOTF to an already-mixed quantity, which is not a
  // radiometric quantity at all and is not the same number.
  //
  // WHAT IT IS AND IS NOT. This is the exact IEC 61966-2-1 inverse EOTF
  // INCLUDING THE TOE (c <= 0.04045 -> c/12.92), tabulated over the 256 code
  // values, so for an 8-bit input the LUT is exact rather than approximate. It
  // undoes the DISPLAY ENCODE only. The frame is post-ACES and post-grade, so
  // `lin` is DISPLAY-LINEAR luminance and NOT scene radiance; 2.34.10 item 3's
  // HalfFloat scene-RT readout is still the thing that would give scene-linear.
  const SRGB_LIN = new Float64Array(256);
  for (let i = 0; i < 256; ++i) {
    const c = i / 255;
    SRGB_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /** The §2.1 idiom, on one rectangle. RGB is decoded rather than luma alone:
   *  a luma-only instrument reads ~0 on a hue-only change and a grade moves
   *  both (§2.6). `warm` is meanR - meanB in counts, POSITIVE IS WARM.
   *  `lin` is the RN-2550 linear-light mean described above. */
  const statOn = (cx, x0, y0, x1, y1) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const d = cx.getImageData(Math.round(x0), Math.round(y0), w, h).data;
    const n = w * h;
    let sr = 0; let sg = 0; let sb = 0; let ssat = 0;
    let lo = 0; let hi = 0;
    let lr = 0; let lg = 0; let lb = 0;
    const lum = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
      const r = d[i * 4]; const g = d[i * 4 + 1]; const b = d[i * 4 + 2];
      sr += r; sg += g; sb += b;
      lr += SRGB_LIN[r]; lg += SRGB_LIN[g]; lb += SRGB_LIN[b];
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
      lin: { Y: r6((0.2126 * lr + 0.7152 * lg + 0.0722 * lb) / n),
        rgb: [r6(lr / n), r6(lg / n), r6(lb / n)] },
      col: colOn(d, w, h),
    };
  };

  /**
   * RN-1970. THE TILING INSTRUMENT FOR A WALL, additive: every field above is
   * unchanged and every number any earlier pass published against a rectangle
   * here still means what it meant.
   *
   * `iqr` and the percentile row are BLIND TO WHICH FREQUENCY BAND the detail
   * sits in - RN-1732 is this repo's own recorded scar from exactly that - and
   * a tiling repeat is a statement about one band and nothing else. This is
   * the metric a fresh-context verifier used to catch two lanes overstating a
   * look change, reimplemented here so it is taken through the same manifest
   * and the same capture as everything else in the report.
   *
   * COLUMN-AVERAGED, WHICH IS THE WHOLE POINT AND IS THE OPPOSITE OF
   * `groundnear.js`'s ROW-WISE version of the same idea. That instrument reads
   * ground at a grazing angle, where one row is one iso-range slice and a
   * column smears many scales together. A WALL is the other case: it is seen
   * near square on, its world scale is nearly constant down a column, and the
   * repeat runs ALONG it. Averaging each column to one number therefore keeps
   * the horizontal periodicity intact and cancels everything that varies only
   * up the wall - which is exactly right, because a feature constant along u
   * cannot contribute to a repeat a player can count.
   *
   *   `std`   the column-averaged signal's own standard deviation in counts of
   *           luma, i.e. HOW LOUD the light-and-dark banding across the wall
   *           is. A correlation on a signal that is not there means nothing,
   *           so this number is published first and read first.
   *   `peak`  the largest LOCAL maximum strictly after the first local
   *           minimum, with `lag` in pixels. groundnear.js's rule, reused
   *           rather than re-derived: the global maximum over a band is always
   *           at its lower edge, because a smooth signal decays monotonically,
   *           so a bare maximum reads blur and not repetition.
   *
   * The band is [4, floor(w/3)] by default: a lag past a third of the
   * rectangle is two samples of one period and cannot be believed.
   * `{"colBand":[lo,hi]}` overrides it for a rectangle whose world scale is
   * known, which is how a tile lag in metres becomes a lag in pixels.
   */
  const colOn = (d, w, h) => {
    const col = new Float64Array(w);
    for (let j = 0; j < h; ++j) {
      for (let i = 0; i < w; ++i) {
        const o = (j * w + i) * 4;
        col[i] += 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
      }
    }
    let m = 0;
    for (let i = 0; i < w; ++i) { col[i] /= h; m += col[i]; }
    m /= w;
    let v0 = 0;
    for (let i = 0; i < w; ++i) { col[i] -= m; v0 += col[i] * col[i]; }
    const std = Math.sqrt(v0 / w);
    const band = Array.isArray(A.colBand) ? A.colBand : null;
    const minLag = Math.max(1, Math.round(band ? band[0] : 4));
    const maxLag = Math.min(w - 2, Math.round(band ? band[1] : Math.floor(w / 3)));
    if (v0 < 1e-9 || maxLag <= minLag + 1) {
      return { std: r2(std), minLag, maxLag, lag: null, peak: null };
    }
    const c = (L) => {
      let s = 0;
      for (let i = 0; i + L < w; ++i) s += col[i] * col[i + L];
      return s / v0;
    };
    const cur = new Float64Array(maxLag + 2);
    for (let L = minLag; L <= maxLag + 1 && L <= w - 1; ++L) cur[L] = c(L);
    let firstMin = minLag;
    while (firstMin + 1 <= maxLag && cur[firstMin + 1] < cur[firstMin]) firstMin++;
    let bl = null; let bp = -2;
    for (let L = firstMin + 1; L < maxLag; ++L) {
      if (cur[L] >= cur[L - 1] && cur[L] >= cur[L + 1] && cur[L] > bp) {
        bp = cur[L]; bl = L;
      }
    }
    return { std: r2(std), minLag, maxLag, firstMin,
      lag: bl, peak: bl === null ? null : r3(bp) };
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

  // ======================================================================
  // RN-1990. THE MODEL-OVER-FRAME RATIO, and it is a MATCHED PAIR TAKEN IN
  // ONE PAGE LOAD rather than two numbers filed next to each other.
  //
  // WHAT IT MEASURES AND WHY IT IS NOT A RECTANGLE. RN-1875 established that
  // the view model's fault is its LIGHT, not its geometry: model luma over
  // frame luma read 0.55 / 1.23 / 2.76 / 3.36 across the four shots, a
  // quantity that should sit near 1 and that CHANGES SIGN. A rectangle around
  // two hands and a diagonal haft is mostly world, so the model's pixels have
  // to be identified by DIFFERENCE against the same frame with the model
  // suppressed -- which is exactly what `hideVm` already builds, one page load
  // at a time. Doing both halves here makes the pair provably one variable
  // apart: same scene build, same wind clock, same IBL counter, same pose.
  //
  // THREE DENOMINATORS, PUBLISHED TOGETHER, because they answer three
  // different questions and picking one silently is how a ratio gets argued
  // rather than read:
  //   `ratio`       model / WHOLE FRAME. RN-1875's published quantity, kept to
  //                 the digit so this lane's before-numbers are comparable
  //                 with that one's. Its denominator contains the model.
  //   `ratioWorld`  model / the frame MINUS the model's own pixels. The same
  //                 statement with the subject removed from its own control.
  //   `ratioBehind` model / THE WORLD IT OCCLUDES, read out of the control
  //                 frame at exactly the masked pixels. This is the local
  //                 statement and the strictest one: it compares the held tool
  //                 against the surface it is held in front of, at the same
  //                 depth range, under the same sun, with no framing in it.
  //
  // THE MASK IS CONTAMINATED AND THE CONTAMINATION IS PUBLISHED, never
  // assumed away. Anything that moves between the two grabs (foliage, the wind
  // clock, dither) lands in the difference. RN-1876 measured that at 156 px of
  // 50,980 on `forestfloor` and 0 above y=0.75 on `voxelface`; `maskHiFrac` is
  // the share of the mask in the TOP HALF of the frame, where a first-person
  // carry has no geometry at all, so a reading that climbs is the tell.
  //
  // AND IT TAKES ARMS. `{"vmArms":[{"name":"shipped","shadow":false}, ...]}`
  // measures the SAME shot at several settings of `__ofVmLight` inside ONE page
  // load, each with its own model/control pair. That is the whole reason the
  // shadow term was built with a runtime switch rather than a boot flag: a
  // before/after taken across two page loads differs by the whole scene build,
  // the wind clock and the IBL counter, and this lane's quantity is a ratio of
  // two lumas that all three of those move.
  const VL = window.__ofVmLight ?? null;
  const pairAt = async () => {
    const gT = await grab();
    vmDbg.hide(true);
    await of.settle(A.vmSettle ?? 2);
    if (vmDbg.hidden() !== true) return { err: 'the control frame did not take' };
    const gC = await grab();
    vmDbg.hide(false);
    await of.settle(A.vmSettle ?? 2);
    if (vmDbg.hidden() !== false) return { err: 'the view model would not come back' };
    if (gC.W !== gT.W || gC.H !== gT.H) return { err: 'the pair differs in size' };
    const w = gT.W; const h = gT.H;
    const A0 = gT.cx.getImageData(0, 0, w, h).data;
    const B0 = gC.cx.getImageData(0, 0, w, h).data;
    // 6 counts on any channel. Below that is dither and 8-bit rounding; the
    // model is an opaque object at 0.3 to 0.7 m and moves whole channels.
    const T = Math.max(1, Math.round(A.vmDiffT ?? 6));
    let mn = 0; let mr = 0; let mg = 0; let mb = 0;
    let br = 0; let bg = 0; let bb = 0;
    let wn = 0; let wr = 0; let wg = 0; let wb = 0;
    let hiN = 0;
    const halfRow = Math.floor(h / 2);
    for (let y = 0; y < h; ++y) {
      for (let x = 0; x < w; ++x) {
        const i = (y * w + x) * 4;
        const dr = Math.abs(A0[i] - B0[i]);
        const dg = Math.abs(A0[i + 1] - B0[i + 1]);
        const db = Math.abs(A0[i + 2] - B0[i + 2]);
        if (dr > T || dg > T || db > T) {
          mn++; mr += A0[i]; mg += A0[i + 1]; mb += A0[i + 2];
          br += B0[i]; bg += B0[i + 1]; bb += B0[i + 2];
          if (y < halfRow) hiN++;
        } else {
          wn++; wr += A0[i]; wg += A0[i + 1]; wb += A0[i + 2];
        }
      }
    }
    const Y = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const frameL = statOn(gT.cx, 0, 0, w, h).luma;
    const modelL = mn === 0 ? null : Y(mr / mn, mg / mn, mb / mn);
    const behindL = mn === 0 ? null : Y(br / mn, bg / mn, bb / mn);
    const worldL = wn === 0 ? null : Y(wr / wn, wg / wn, wb / wn);
    return {
      maskPx: mn, maskFrac: r3(mn / (w * h)),
      maskHiFrac: mn === 0 ? null : r3(hiN / mn),
      modelLuma: r2(modelL), modelWarm: mn === 0 ? null : r2(mr / mn - mb / mn),
      frameLuma: frameL,
      worldLuma: r2(worldL),
      worldWarm: wn === 0 ? null : r2(wr / wn - wb / wn),
      behindLuma: r2(behindL),
      behindWarm: mn === 0 ? null : r2(br / mn - bb / mn),
      ratio: mn === 0 ? null : r3(modelL / frameL),
      ratioWorld: mn === 0 || wn === 0 ? null : r3(modelL / worldL),
      ratioBehind: mn === 0 ? null : r3(modelL / behindL),
      diffT: T,
    };
  };

  let vmRatio = null;
  let vmArms = null;
  const wantArms = Array.isArray(A.vmArms) && A.vmArms.length > 0;
  if (A.vmRatio === true || wantArms) {
    if (vmDbg === null) {
      return { valid: false, shot: name,
        why: 'vmRatio needs window.__ofViewModel and it does not exist.' };
    }
    if (vmHidden === true) {
      return { valid: false, shot: name,
        why: 'vmRatio with hideVm is a difference of a frame against itself.' };
    }
    if (wantArms && VL === null) {
      return { valid: false, shot: name,
        why: 'vmArms needs window.__ofVmLight and it does not exist, so every '
          + 'arm would silently be the same frame.' };
    }
    const arms = wantArms ? A.vmArms : [{ name: 'as-built' }];
    // Arms the renderer handle once, so `mapAt` can read the cascade below.
    if (VL !== null && typeof VL.peek === 'function') {
      VL.peek();
      await of.settle(6);
    }
    vmArms = [];
    for (const arm of arms) {
      if (VL !== null) {
        VL.shadow(arm.shadow === undefined ? true : arm.shadow === true);
        VL.sun(arm.sun ?? 1);
        VL.ambient(arm.ambient ?? 1);
        if (typeof VL.biasAdd === 'function') VL.biasAdd(arm.biasAdd ?? 0);
        await of.settle(A.vmSettle ?? 2);
        // `ambientAbs` asks for an ABSOLUTE hemisphere intensity rather than a
        // multiplier, and it exists because the shipped view-model ambient
        // (1.1) has to be reproducible as an arm on every shot. The world-side
        // endpoint this lane now derives from is `stockFloor`, i.e.
        // `TERRAIN_AMBIENT`, which `terrainNightAmbient` rewrites every frame
        // from the sun's elevation -- so the multiplier that reaches 1.1 is a
        // different number on a dot 0.88 shot than on a dot 0.35 one, and a
        // constant multiplier written into the invocation would quietly measure
        // four different ambients and call them one control.
        if (typeof arm.ambientAbs === 'number') {
          const a = VL.state().ambient;
          if (!(a > 0)) {
            return { valid: false, shot: name,
              why: `vmArms[${arm.name}]: ambientAbs needs a live hemisphere, read ${a}.` };
          }
          VL.ambient(arm.ambientAbs / a);
          await of.settle(A.vmSettle ?? 2);
        }
      }
      const p = await pairAt();
      if (p.err !== undefined) {
        return { valid: false, shot: name, why: `vmArms[${arm.name}]: ${p.err}` };
      }
      // THE ARM'S OWN STATE, READ BACK OFF THE CLIENT, never the argument that
      // was sent: `__ofVmLight.state()` reports the shadow intensity actually
      // uploaded and the hemisphere intensity actually applied, so an arm that
      // did not take is visible as an arm whose state matches its neighbour's.
      // RN-1990. AND WHETHER THE PLAYER IS IN A CAST SHADOW AT THIS POSE, read
      // out of cascade 0's own colour attachment at the very texel the arms
      // sample. Without it a shot whose ratio does not move under the shadow
      // term is ambiguous between "the term is inert" and "there is nothing
      // above this player", and the four canonical poses turn out to be the
      // second: the terrain does not cast into cascade 0, only the trees do.
      let occl = null;
      if (VL !== null && typeof VL.mapAt === 'function') {
        const st = VL.state();
        const cell = VL.mapAt(st.eyeCoord[0], st.eyeCoord[1]);
        // Reversed depth: a LARGER z is nearer the light and the attachment
        // holds 1 - z, so an occluder in front of the arms reads z above eyeZ.
        const z = 1 - cell.oneMinusZ;
        occl = { uv: [st.eyeCoord[0], st.eyeCoord[1]], eyeZ: st.eyeCoord[2],
          cellZ: r3(z), casterHere: cell.rgba[3] > 0 && z > st.eyeCoord[2] };
      }
      vmArms.push({ arm: arm.name ?? JSON.stringify(arm), ...p, occl,
        vmState: VL === null ? null : VL.state() });
    }
    if (VL !== null) {
      VL.shadow(true); VL.sun(1); VL.ambient(1);
      if (typeof VL.biasAdd === 'function') VL.biasAdd(0);
      await of.settle(2);
    }
    vmRatio = vmArms[vmArms.length - 1];
  }

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
  // ======================================================================
  // RN-2032. `{"repeat":K}` -- K-1 EXTRA CAPTURES IN THIS SAME PAGE LOAD.
  //
  // ADDITIVE AND OFF BY DEFAULT: nothing below this block reads `repeats`, and
  // with `repeat` absent no extra frame is taken, so every number and every
  // pixel any earlier pass has published is unchanged to the digit.
  //
  // WHY IT IS THE EXPERIMENT THIS SHOT NEEDS. Every census of the station shot
  // so far has been one capture per PAGE LOAD, so "the frame changed" and "the
  // boot changed" are the same observation and no arm can separate them. K
  // captures inside one load, with the instruments read on each photographed
  // frame (`grab().at`), separates them: if the frames within a load differ,
  // the mode is chosen per FRAME and every per-boot suspect (install order,
  // asset load order, the scene build) is out at once.
  //
  // `repeatRunS` drives a fixed window between grabs so the gap is the same
  // sim time each time; 0 grabs back to back with only the natural rAF frame
  // between them.
  let repeats = null;
  if (Number.isFinite(A.repeat) && A.repeat > 1) {
    repeats = [];
    for (let k = 1; k < A.repeat; ++k) {
      if ((A.repeatRunS ?? 0) > 0) await of.run(A.repeatRunS, A.repeatHz ?? 30);
      const gk = await grab();
      const bk = [S.box[0] * gk.W, S.box[1] * gk.H, S.box[2] * gk.W, S.box[3] * gk.H];
      repeats.push({
        k,
        box: statOn(gk.cx, bk[0], bk[1], bk[2], bk[3]),
        world: statOn(gk.cx, 0, 0, gk.W, gk.H),
        at: gk.at, pre: gk.pre, photo: gk.photo,
        png: A.repeatPng === true ? await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(gk.blob);
        }) : null,
      });
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
  // BT-255. REMOVED: THIS USED TO TELEPORT THE WALKER BACK TO THE GROUND
  // HERE, "for the same PH-89 reason: `run.mjs` settles AFTER the eval
  // returns" -- and that reasoning does not hold for `--out`. `run.mjs` takes
  // its screenshot AFTER `settle()`+`wait`, both of which run AFTER this eval
  // resolves (RN-2030), so leaving the walker on the station until here and
  // then jumping him to the RN-352 forest at 2 m meant every `--out` capture
  // of this shot photographed the FOREST, HUD altitude ~1.6 m, while
  // `eval.png` (this probe's own canvas grab, taken above at the station) was
  // always correct. Every published station PNG taken via `--out` predates
  // this fix and shows the wrong scene; see shot-grades.md's flag.
  //
  // THE PH-89 HANG WAS TESTED FOR, NOT ASSUMED AWAY. PH-89 is real for a
  // walker mid-transition to/from orbit, which is exactly why the shot's OWN
  // pre-capture settle above (`of.run(1.0, 30)` instead of `of.settle()`)
  // stays a fixed window rather than a gate. But `run.mjs`'s blanket
  // post-eval `window.__of.settle(n)` (the same terrain-convergence gate)
  // runs a full two settle-windows and an ibl-convergence loop AFTER
  // boarding, by which point the terrain streamer's target has not moved
  // since before boarding (riding the carrier is a physics integration, not
  // a re-teleport, so nothing re-targets the streamer) and is still
  // converged from the walker's pre-board position. Measured directly: with
  // this teleport removed, `run.mjs --out` on `station` still prints `smoke:
  // PASS` and writes a photo of the hull, same order of runtime as before
  // (no hang, no timeout). Removing the teleport costs nothing this shot's
  // own report depends on: `pose`, `setup`, `captureDiag` and every stat
  // above are all read before this point and are therefore identical either
  // way.
  // RN-2260. THE POOL CEILING, READ ON THE PHOTOGRAPHED FRAME rather than
  // trusted from the one-time `console.error` `PropLibrary.grow()` fires
  // (that fires once per batch, `b.warned`, so a sweep taking several readings
  // in one process only sees it on the FIRST hit). `refused`/`exhausted` never
  // decrement once a slot is denied, so this is exactly the settleGate class
  // of fix (2.14.4, `scatterBacklog`): a hero frame whose prop pool has ever
  // refused an instance THIS SESSION is a truncated frame, and `valid` must
  // say so on every capture of it, not only the first.
  const poolRefused = s.props === undefined || s.props === null
    ? 0 : (s.props.refused ?? s.props.exhausted ?? 0);
  return {
    valid: poolRefused === 0, shot: name, why: S.why,
    poolRefused,
    // RN-2018. The enemy-suppression receipt, published rather than assumed,
    // so a frame taken without it is distinguishable from one taken with it in
    // the JSON alone. See the `peaceful` block above for the pair it cost.
    peaceful,
    // The player's health at the capture. Not decoration: it is the cheapest
    // single tell that two arms were the SAME simulation moment, and it is the
    // one that caught RN-2010's contaminated pair (89/150 against 107/150).
    // `of.game().vitals` is `PlayerVitals.report()`, so `hp`/`maxHp` are the
    // book's own fields and not a probe's reconstruction of them.
    vitals: (() => {
      try {
        const v = of.game ? of.game().vitals : null;
        return v ? { hp: v.hp, maxHp: v.maxHp, deaths: v.deaths,
          hurtEvents: v.hurtEvents } : null;
      } catch (e) { return null; }
    })(),
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
    // RN-2031/RN-2032. The instruments read on THE PHOTOGRAPHED FRAME (see
    // `grab`), and the extra in-load captures if `{"repeat":K}` asked for them.
    // `atCapture` is published on every shot because every shot's `captureDiag`
    // has the same one-frame-early defect; `repeats` is null unless asked for.
    atCapture: g0.at, preCapture: g0.pre, photoCapture: g0.photo, repeats,
    // RN-1876. Whether THIS frame is the view-model control. Published on every
    // shot, so a pair is provably one variable apart rather than filed as one.
    vmHidden,
    // RN-1990. Null unless `{"vmRatio": true}` or `{"vmArms": [...]}` was asked
    // for, so every capture any earlier pass has taken is unchanged.
    vmRatio, vmArms,
    pose,
    // THE PIPELINE THE FRAME CAME THROUGH, published so a pair can be shown to
    // be one variable apart rather than asserted to be.
    postState: post,
    shade,
    shadow: s.shadow, ibl: s.ibl,
    // WG-220. THE SCATTER'S OWN COUNTERS, ON THE PHOTOGRAPHED FRAME. Purely
    // additive: nothing above reads it, every existing field is untouched, and
    // it is `null` on any build whose `of.stats()` carries no props record.
    //
    // It is here rather than in a second probe because a canopy-density claim
    // is an arithmetic statement about the frame ("this many crowns over this
    // much visible ground") and taking the count in one process and the
    // picture in another is exactly how two arms drift apart. `canopyProps` is
    // INSTANCES, not trees: `props_canopy.glb` authors its `_LOD3` across four
    // materials, so a far tree occupies four slots until RN-2240 lands.
    scatter: s.props === undefined || s.props === null ? null : {
      canopyProps: s.props.canopyProps, canopyCells: s.props.canopyCells,
      canopyM2: s.props.canopyM2, canopyPerM2: s.props.canopyPerM2,
      canopyDelivered: s.props.canopyDelivered,
      canopyRadiusM: s.props.canopyRadiusM, canopyShade: s.props.canopyShade,
      canopyBareCells: s.props.canopyBareCells,
      canopyShadeMean: s.props.canopyShadeMean,
      canopyShadeSd: s.props.canopyShadeSd,
      canopyShadeMax: s.props.canopyShadeMax,
      canopyShadeCells: s.props.canopyShadeCells,
      canopyPlanetMean: s.props.canopyPlanetMean,
      canopyPlanetSd: s.props.canopyPlanetSd,
      canopyOfferedCells: s.props.canopyOfferedCells,
      canopySlopeCells: s.props.canopySlopeCells,
      // WG-260. THE MID TIER, the 170-to-550 m band, on the canopy row's own
      // terms so the pair can be read together. `mid: false` IS the
      // `?midhole=0` arm and says so on the row (standing rule 7).
      // `midCards` against `midProps` is the split the eye verdict turns on:
      // an instance past `CANOPY_LOD3_M` is a four-triangle impostor and one
      // inside it is an authored `_LOD2` cone, and a row that published only
      // the total could not tell a band of TREES from a band of billboards
      // standing fifty pixels tall. Additive; every field above is untouched
      // and each reads `undefined` on a pre-WG-260 build rather than moving
      // any existing number.
      mid: s.props.mid ?? null, midEdge: s.props.midEdge ?? null,
      midProps: s.props.midProps ?? null,
      midCards: s.props.midCards ?? null, midCells: s.props.midCells ?? null,
      midM2: s.props.midM2 ?? null, midPerM2: s.props.midPerM2 ?? null,
      midDelivered: s.props.midDelivered ?? null,
      propsPlaced: s.props.propsPlaced, cellsScattered: s.props.cellsScattered,
      wantedPerM2: s.props.wantedPerM2, placedPerM2: s.props.placedPerM2,
      deliveredFraction: s.props.deliveredFraction,
      cellsCapped: s.props.cellsCapped, chunksCapped: s.props.chunksCapped,
      chunksRefused: s.props.chunksRefused,
      scatterBacklog: s.props.scatterBacklog, chunks: s.props.chunks,
      poolRefused, poolCeiling: s.props.ceiling ?? null,
    },
    // RN-2275. INTER-CROWN SELF-SHADOWING, read back from BOTH of its halves
    // in one object. `self.uniform` is the (amp, K, floor) the terrain's
    // fragment shader is holding and `self.amp/k/floor` is what the card
    // updater read out of the same triple, so a probe can assert they are one
    // set of numbers rather than two that agree today. `self.live` false means
    // the canopy batch material was never registered and the NEAR half of the
    // term is silently absent -- which is invisible in a frame, because an
    // un-darkened card is still a card (2.18.5's failure mode, one term over).
    // `cardMu` / `sinSun` / `cardShade` let a verifier recompute the law
    // independently and check the GLSL and the TypeScript are still the same
    // three lines.
    treeline: (() => {
      const h = window.__ofTerrainArt;
      return h === undefined || typeof h.treeline !== 'function'
        ? null : h.treeline();
    })(),
    // WG-230. THE WORLD-LOCKED PHASE, read off the live page rather than
    // recomputed here. `amp` is what the fragment shader is holding (0 in the
    // shipped frame; `?phaseamp=1` is the arm that paints the checker), and
    // `quantumM` against `pmQuantumM` is the whole claim of that lane made
    // readable from a probe: how fine the shading coordinate is at a chunk of
    // the given local extent, against what `pM` carries at the same fragment.
    // `divides` is the seam rule for the period the caller asks about.
    phase: (() => {
      const h = window.__ofTerrainArt;
      return h === undefined || typeof h.phaseState !== 'function'
        ? null : h.phaseState();
    })(),
    // RN-2385. THE EMISSIVE LIGHT'S ARMING PROOF, read off the live page on
    // the photographed frame. `spliced` is how many programs actually took the
    // term (zero with a nonzero `amp` is the vacuous green: configured and in
    // no shader); `selected` is how many fires this frame's uniform array
    // actually holds and `emitters` is what is in it, so a lane can show the
    // light is where the machine is rather than assert it; `dropped` is the
    // count that lost the WebGL2 budget, which is the number that says whether
    // `EMIT_MAX` is real in play; and `sceneLights` is the near scene's own
    // three.js light count, which is this change's central claim (it adds
    // none) taken as a reading rather than as a sentence.
    emit: (() => {
      const h = window.__ofEmit;
      return h === undefined || typeof h.report !== 'function'
        ? null : h.report();
    })(),
    render: { triangles: s.draw.triangles, calls: s.draw.calls,
      programs: s.draw.programs, vramMB: s.vramEstimateMB,
      frameMs: { p50: r2(s.frameMs.p50), p95: r2(s.frameMs.p95),
        p99: r2(s.frameMs.p99) },
      passMs: { near: r2(s.passMs.near), post: r2(s.passMs.post),
        total: r2(s.passMs.total) } },
    setup, log, png, cropPng,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
