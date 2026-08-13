// ruinplace.js: THE WORLD ACTUALLY SHOWS THE RUIN (WG-166 to WG-171).
//
//   npx --prefix web vite build --outDir dist
//   npx --prefix web vite preview --outDir dist --port 4333 --strictPort
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4333/ \
//     --sandbox=1 --combat=1 --evalfile=web/tools/smoke/probes/ruinplace.js
//
// AND THE SAME FILE AGAIN WITH --body=cinder, WHICH MUST PASS WITH THE
// OPPOSITE OUTCOME. `poi.h` places NOTHING on the moon and says why; a run
// against it must therefore draw zero ruins, hold zero ruin colliders and post
// zero guards, and must PUBLISH A REASON rather than an absence. That is the
// negative control for the whole feature: without it, "one ruin on Forge" and
// "one ruin everywhere, unconditionally" are the same picture.
//
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4333/ \
//     --sandbox=1 --combat=1 --body=cinder \
//     --evalfile=web/tools/smoke/probes/ruinplace.js
//
// WHAT THIS MEASURES, AND WHY EACH THING IS DATA AND NOT A PICTURE.
// A screenshot of a ruin proves a ruin-shaped thing was rasterised. It cannot
// tell you the instance is at the site the generator chose, that its collision
// hull is the one the .glb ships, or that a garrison is holding rather than
// merely existing. Every assertion below reads a number: the site row out of
// `of.sites()` (the TABLE, WG-151) against the drawn instance out of
// `of.ruins()` (the INSTANCES, WG-166), which are two independent readings of
// the same fact and can therefore disagree.
//
// THE COLLISION SECTION IS CE-50's TECHNIQUE, and the reason it is a capsule
// and not a point is core-engine.md's own lesson: a position check that asks
// whether the answer is where you asked for it cannot notice that the place you
// asked for is not a place. So the wall and the doorway are both tested with
// FIVE COLUMNS at the walker's own `CAPSULE_SAMPLES_M` heights through
// `of.solidBuild`, which is the walker's own predicate (`StructureBodies.
// blocks`), and both directions of the instrument are proven in the same run:
// a point 100 m away reads CLEAR, the wall reads SOLID, and the wall is
// re-read at the very end so a check that quietly stopped working cannot pass.
//
// AND THEN IT WALKS. A query saying "the wall is solid" is not the same claim
// as "the player cannot get through it", so the last section drives the real
// walker with `of.input.tape` twice over: once into a wall, which must NOT get
// through, and once at the doorway, which MUST. Same tape length, same speed,
// two outcomes; either one alone would be satisfiable by a walker that is
// simply stuck everywhere or solid nowhere.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.ruins !== 'function') return { valid: false, why: 'no of.ruins' };
  if (typeof of.sites !== 'function') return { valid: false, why: 'no of.sites' };
  const sleep = (n) => of.run(n);
  const march = (secs) => of.run(secs, 60);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const gd = (a, b) => len(sub(a, b));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];

  await sleep(1.0);
  of.audio('unlock');
  await sleep(0.2);
  // One frame of the render loop, so `RuinSites.update` has run at least once
  // and the LOD rung and `distM` are real rather than their construction-time
  // placeholders. Asserting a rung before any frame would be asserting the
  // initial value of a field, which is a test of nothing.
  await march(0.5);

  const R0 = of.ruins();
  const S0 = of.sites();
  if (R0 === null || S0 === null) return { valid: false, why: 'no character' };
  const ruinRows = S0.rows.filter((r) => r.kind === 1);
  log.push(`site table: ${S0.count} row(s), ${ruinRows.length} of ruin kind`);
  log.push(`ruin instances: ${R0.count}, why="${R0.why}"`);

  // =====================================================================
  // 0. THE NEGATIVE CONTROL, when this is a body the generator refuses.
  //    See the header: `--body=cinder`. It must draw nothing, hold no
  //    collider, post no guard, and SAY SO.
  // =====================================================================
  if (ruinRows.length === 0) {
    check('A BODY WITH NO RUIN SITE DRAWS NO RUIN', R0.count === 0,
          JSON.stringify({ count: R0.count, list: R0.list }));
    check('and it publishes a REASON rather than an absence',
          typeof R0.why === 'string' && R0.why.length > 0, JSON.stringify(R0.why));
    check('and the instance count is derived from the table, not assumed',
          R0.rowsRuin === 0 && R0.refused === 0,
          JSON.stringify({ rowsSeen: R0.rowsSeen, rowsRuin: R0.rowsRuin,
            refused: R0.refused }));
    const guards0 = of.enemies('near', 12)
      .filter((c) => c.provenance === 'garrison');
    check('and nobody is standing guard at a ruin that is not there',
          guards0.length === 0, JSON.stringify(guards0));
    // The asset still LOADED: a zero that comes from a failed fetch is a
    // different zero, and this is the one line that separates them.
    check('the refusal is the generator\'s and not a missing asset '
          + '(socket_grade still read)', R0.gradeM > 0 && R0.boundM > 0,
          JSON.stringify({ gradeM: R0.gradeM, boundM: R0.boundM }));
    await march(3);
    check('and nothing appeared while the world ran',
          of.ruins().count === 0, JSON.stringify(of.ruins()));
    return { valid: fails.length === 0, negativeControl: true, log, fails,
      ruins: of.ruins() };
  }

  // =====================================================================
  // 1. THE INSTANCE IS THE SITE. Two independent readings, bound field by
  //    field. `of.sites()` has never heard of the draw path and `of.ruins()`
  //    has never heard of `of_poi_row`'s wire format.
  // =====================================================================
  check('EXACTLY ONE RUIN IS DRAWN, one per ruin-kind row and no more',
        R0.count === ruinRows.length && R0.count === 1,
        JSON.stringify({ drawn: R0.count, rows: ruinRows.length }));
  check('and nothing was refused on the way', R0.refused === 0
        && R0.rowsRuin === ruinRows.length && R0.why === '',
        JSON.stringify({ refused: R0.refused, rowsRuin: R0.rowsRuin,
          why: R0.why }));
  const row = ruinRows[0];
  const inst = R0.list[0];
  /** The site's ground normal. Every tangent basis and every radial split
   *  below is built on it, so it is hoisted here rather than re-derived. */
  const up = inst.up;
  check('THE DRAWN INSTANCE CARRIES THE SITE\'S OWN ID, both halves',
        inst.idLo === row.idLo && inst.idHi === row.idHi
        && (inst.idLo !== 0 || inst.idHi !== 0),
        JSON.stringify({ inst: [inst.idLo, inst.idHi],
          row: [row.idLo, row.idHi] }));
  check('and it stands at the site position EXACTLY, not near it',
        inst.sitePos[0] === row.pos.x && inst.sitePos[1] === row.pos.y
        && inst.sitePos[2] === row.pos.z,
        JSON.stringify({ inst: inst.sitePos, row: row.pos }));
  check('and it took the site\'s own footprint rather than minting a second '
        + 'opinion about it',
        inst.footprintM === row.footprintM && inst.footprintM === 18,
        JSON.stringify({ inst: inst.footprintM, row: row.footprintM }));
  // THE YAW IS NOT CROSS-CHECKED AGAINST `of.sites()`, AND THAT IS A GAP THIS
  // PROBE NAMES RATHER THAN PAPERS OVER: `DebugSites.rowReport` publishes
  // fifteen fields of the row and `yawRad` is not one of them, so there is no
  // second reading of it to bind against. What CAN be bound, and is, is the
  // drawn ORIENTATION to the published yaw: the quaternion below is rebuilt
  // here from (up, yawRad) alone, by arithmetic that has never seen
  // `RuinSites.spawn`, and compared to the one the instance is actually posed
  // with. That catches the failure that matters -- a yaw published and not
  // applied, or applied about the wrong axis -- which a field-equality check
  // against a second copy of the same number never would.
  const qAlign = (() => {
    const w = 1 + up[1];
    const v = [up[2], 0, -up[0], w];
    const n = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n, v[3] / n];
  })();
  const s2 = Math.sin(inst.yawRad / 2);
  const qYaw = [up[0] * s2, up[1] * s2, up[2] * s2, Math.cos(inst.yawRad / 2)];
  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qWant = qMul(qYaw, qAlign);
  const qDot = Math.abs(qWant[0] * inst.quat[0] + qWant[1] * inst.quat[1]
    + qWant[2] * inst.quat[2] + qWant[3] * inst.quat[3]);
  check('THE DRAWN ORIENTATION IS THE PUBLISHED YAW ABOUT THE GROUND NORMAL, '
        + 'rebuilt independently and matched',
        Math.abs(qDot - 1) < 1e-6, `|q . qWant| = ${qDot}`);
  check('and the yaw is a real derived angle rather than an unset zero '
        + '(poi.h hashes it off the site id)',
        inst.yawRad > 0 && inst.yawRad < 2 * Math.PI, `${inst.yawRad}`);

  // =====================================================================
  // 2. IT STANDS ON THE GROUND, AND THE 2.3 m PLINTH IS WHY.
  //    `socket_grade` is the asset's own datum (WG-166): the model is sunk
  //    that far below the surface point so the buried course has somewhere
  //    to be on ground the admission gate merely tolerates.
  // =====================================================================
  log.push(`gradeM=${R0.gradeM} boundM=${R0.boundM} `
    + `lod1M=${R0.lod1M} lod2M=${R0.lod2M}`);
  check('THE GRADE DATUM CAME OUT OF THE .glb, and it is poi.h\'s ~2.3 m',
        R0.gradeM > 2.2 && R0.gradeM < 2.4, `${R0.gradeM}`);
  const wantPivot = add(inst.sitePos, up, -R0.gradeM);
  check('and the model pivot IS the site position pushed down that datum',
        gd(inst.pos, wantPivot) < 1e-6,
        JSON.stringify({ pos: inst.pos, want: wantPivot }));
  check('THE SITE SITS ON THE LIVE SURFACE: the oracle every structure asks '
        + 'agrees with the radius the generator recorded',
        Math.abs(inst.standoffM) < 0.05,
        `standoff ${inst.standoffM} m (site ${inst.siteRadiusM}, `
        + `live ${inst.liveSurfaceRadiusM})`);
  check('the placement is UP-ALIGNED: the site normal is the radial',
        Math.abs(len(up) - 1) < 1e-9
        && dot(norm(inst.sitePos), up) > 0.999999, JSON.stringify(up));
  check('and the tilt the gate admitted is the flat ground it claimed',
        row.tiltDeg < 4 && row.residP95M < 1,
        JSON.stringify({ tiltDeg: row.tiltDeg, residP95M: row.residP95M }));

  // =====================================================================
  // 3. IT IS 753.8 m FROM SPAWN AND IT IS DRAWN FROM THERE. The LOD rung is
  //    the thing the asset's three tiers exist for, and asserting it here
  //    is what keeps `Ruin_LOD1` from being 6,200 triangles of dead bytes.
  // =====================================================================
  const spawnFeet = of.weight().at;
  const spawnToRuinM = gd(spawnFeet, inst.sitePos);
  log.push(`spawn is ${spawnToRuinM.toFixed(1)} m from the ruin; `
    + `arcFromAnchorM=${row.arcFromAnchorM.toFixed(1)}; lod=${inst.lod} `
    + `at distM=${inst.distM}`);
  check('THE RUIN IS THE WALK THE SPAWN MOVE MEASURED (WG-214: 753.8 m)',
        Math.abs(row.arcFromAnchorM - 753.8) < 5
        && Math.abs(spawnToRuinM - row.arcFromAnchorM) < 20,
        `arc ${row.arcFromAnchorM.toFixed(2)} m, straight-line from the `
        + `player ${spawnToRuinM.toFixed(2)} m`);
  check('and from spawn it draws a REDUCED tier, which is what the ladder '
        + 'is for', inst.lod === 1 && spawnToRuinM > R0.lod1M
        && spawnToRuinM < R0.lod2M,
        JSON.stringify({ lod: inst.lod, distM: inst.distM,
          lod1M: R0.lod1M, lod2M: R0.lod2M }));

  // =====================================================================
  // 4. THE GARRISON IS THE SITE'S, AND IT IS HOLDING.
  //    `EnemyGarrison.ts`'s whole composition argument is that who stands at
  //    a ruin is a property of the SITE, so the assertion that matters is
  //    not "some creatures exist" but "their post is this ruin and their
  //    seed is this ruin's id".
  // =====================================================================
  const hostile = of.game().mode.hostile === true;
  const guards = of.enemies('near', 12).filter((c) => c.provenance === 'garrison');
  log.push(`hostile=${hostile}; ${guards.length} garrison creature(s), `
    + `report says ${inst.garrison} at seed ${inst.garrisonSeed}`);
  if (hostile) {
    check('A GARRISON IS POSTED AT THE RUIN, 3 to 6 guards off the catalogue',
          inst.garrison >= 3 && inst.garrison <= 6
          && guards.length === inst.garrison,
          JSON.stringify({ reported: inst.garrison, live: guards.length }));
    check('and the seed is the SITE ID\'s low half, not a magic number',
          inst.garrisonSeed === inst.idLo, JSON.stringify({
            seed: inst.garrisonSeed, idLo: inst.idLo }));
    // THE POST IS THE SITE, SPLIT INTO ITS TWO COMPONENTS, because the whole
    // vector is NOT equal and the difference is `EnemySwarm.spawnGarrison`'s
    // own `onGround(postPos, ctx, 0.6)`: a creature body stands 0.6 m off the
    // ground, so the post is the site DIRECTION re-seated on the live ground
    // radius and lifted. Asserting `post === sitePos` would fail on a correct
    // sim; asserting only the distance would pass on a post 0.6 m sideways.
    // Tangential zero and radial 0.6 says exactly what is true.
    const offs = guards.map((c) => {
      const d = sub(c.post, inst.sitePos);
      const radial = dot(d, up);
      return { radial, tangential: len(add(d, up, -radial)) };
    });
    check('every guard\'s post IS the site: zero tangential offset, and the '
          + '0.6 m of radial lift EnemySwarm gives every body',
          guards.length > 0 && offs.every((o) => o.tangential < 0.01
            && Math.abs(o.radial - 0.6) < 0.05),
          JSON.stringify(offs.map((o) => [+o.radial.toFixed(4),
            +o.tangential.toFixed(6)])));
    await march(4);
    const held = of.enemies('near', 12).filter((c) => c.provenance === 'garrison');
    const farthest = Math.max(...held.map((c) => gd(c.pos, inst.sitePos)), 0);
    check('and they HOLD at it: nobody engaged, nobody wandered past their '
          + 'own scatter, with the player 753 m away',
          held.length === inst.garrison
          && held.every((c) => c.garrisonState === 'hold') && farthest < 12,
          JSON.stringify({ states: held.map((c) => c.garrisonState),
            farthestM: +farthest.toFixed(2) }));
  } else {
    check('A SAFE WORLD POSTS NO GUARD AT THE RUIN, which is GP-93\'s rule '
          + 'with no ruin-shaped hole in it',
          inst.garrison === 0 && guards.length === 0,
          JSON.stringify({ reported: inst.garrison, live: guards.length }));
  }

  // =====================================================================
  // 5. COLLISION, CE-50's WAY. Five capsule columns at the walker's own
  //    sample heights, through the walker's own predicate. See the header.
  // =====================================================================
  const CAP_SAMPLES_M = [0.15, 0.9, 1.65];
  const CAP_RADIUS_M = 0.4;
  // A tangent basis at the ruin, so the four side columns are horizontal
  // there rather than horizontal at the planet's north pole.
  const tA = norm(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const tB = norm(cross(up, tA));
  const capsuleHits = (p) => {
    const hits = [];
    const cols = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [a, b] of cols) {
      const base = add(add(p, tA, a * CAP_RADIUS_M), tB, b * CAP_RADIUS_M);
      for (const h of CAP_SAMPLES_M) {
        const q = add(base, up, h);
        if (of.solidBuild(...q)) hits.push(`${a},${b}@${h}`);
      }
    }
    return hits;
  };
  // AND THE WALKER'S OWN TEST, WHICH IS NOT THE SAME TEST, and confusing the
  // two cost this probe a run. `KinematicBody` calls `StructureBodies.free`,
  // which samples ONE column at `CAPSULE_SAMPLES_M` and nothing off-axis; the
  // five-column form above is strictly MORE conservative and is the right
  // instrument for "would a body FIT here" (a doorway, a clearance). It is the
  // wrong instrument for "is the body INSIDE something", because a player
  // correctly stopped flush against a wall has a 0.4 m side column in the
  // stone and is not inside anything. Two questions, two predicates, and the
  // one that has to match the walker is the walker's own.
  const walkerHits = (p) => CAP_SAMPLES_M
    .filter((h) => of.solidBuild(...add(p, up, h)))
    .map((h) => `centre@${h}`);
  const P = inst.points;
  check('the report published the probe points it promised',
        P.wall !== null && P.entry !== null && P.cella !== null
        && P.deck !== null && P.grade !== null, JSON.stringify(P));
  // The wall centre is INSIDE the box, so the capsule's centre column alone
  // is enough; every column is tested anyway because a hull that only
  // happens to catch the exact centre is a hull with a hole in it.
  const wallStand = add(P.wall, up, -1.0);
  const wallHits = capsuleHits(wallStand);
  check('THE WALL IS SOLID TO THE WALKER\'S OWN PREDICATE, at the walker\'s '
        + 'own capsule', wallHits.length >= 5,
        `${wallHits.length} of 15 samples solid: ${JSON.stringify(wallHits)}`);
  // THE INSTRUMENT CAN READ CLEAR. Without this, `solidBuild` returning true
  // unconditionally passes every check above it.
  const farPoint = add(inst.sitePos, tA, 100);
  check('NEGATIVE CONTROL: 100 m away the same capsule reads CLEAR',
        capsuleHits(farPoint).length === 0,
        JSON.stringify(capsuleHits(farPoint)));
  // AND THE DOORWAY IS NOT SOLID. `socket_entry` is the threshold; a capsule
  // there must fit, or the ruin is a sealed box and "enterable" is a claim
  // nobody checked.
  const entryHits = capsuleHits(P.entry);
  check('THE DOORWAY IS OPEN: a player-sized capsule fits in the entry',
        entryHits.length === 0, JSON.stringify(entryHits));
  const cellaHits = capsuleHits(P.cella);
  check('and so does the INSIDE: the cella takes the same capsule',
        cellaHits.length === 0, JSON.stringify(cellaHits));
  // The deck is what a player stands ON, so it must be solid BELOW the feet
  // and clear ABOVE them. One point cannot say that; two can.
  const deckTop = P.deck;
  check('THE PLINTH DECK IS A FLOOR: solid at its own centre, clear a metre '
        + 'above it', of.solidBuild(...deckTop)
        && capsuleHits(add(deckTop, up, 1.2)).length === 0,
        JSON.stringify({ atDeck: of.solidBuild(...deckTop),
          above: capsuleHits(add(deckTop, up, 1.2)) }));

  // =====================================================================
  // 6. AND THEN IT WALKS. A query is not a walker. Two runs of the same
  //    tape: one into a wall (must not pass), one at the doorway (must).
  // =====================================================================
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u,
      v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -8;
    for (const step of [16, 4, 1, 0.3]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  // GP-680's rule: peaceful FIRST. A garrison holds 30 m from the post and
  // this section walks inside that radius on purpose, so without it the
  // fixture is eaten and every distance below is measured across a respawn.
  if (hostile) { of.cheat('peaceful'); await sleep(0.2); }
  // 6a. INTO A WALL. Start on the ground outside the north cella wall,
  //     aim at the wall, and walk further than the gap. The signed distance
  //     along the wall's own outward normal must not change sign.
  const wallOut = norm(sub([P.wall[0], P.wall[1], P.wall[2]], inst.sitePos));
  const wallOutFlat = norm(add(wallOut, up, -dot(wallOut, up)));
  const startA = add(P.wall, wallOutFlat, 5);
  of.standAt(...add(startA, up, -1.0));
  await march(1.2);
  const beforeA = of.weight().at;
  const sideBefore = dot(sub(beforeA, P.wall), wallOutFlat);
  aimAtPoint(P.cella);
  of.input.tape([{ hold: 150, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
  // Sampled DURING the walk, not after it: `blockedByBuild` is set per tick by
  // `KinematicBody` and cleared at the top of the next one, so reading it once
  // at the end would catch it only if the last tick happened to be the blocked
  // one. It is the walker's own word for "a structure stopped me", and it is
  // the difference between "the player did not reach the far side" and "the
  // player was refused" -- a walker that simply ran out of tape passes the
  // side-of-the-wall check for free.
  let blockedByBuild = false;
  for (let i = 0; i < 16; i++) {
    await march(0.2);
    if (of.world().player.blockedByBuild === true) blockedByBuild = true;
  }
  const afterA = of.weight().at;
  const sideAfter = dot(sub(afterA, P.wall), wallOutFlat);
  const movedA = gd(beforeA, afterA);
  log.push(`wall run: side ${sideBefore.toFixed(2)} -> ${sideAfter.toFixed(2)} m, `
    + `moved ${movedA.toFixed(2)} m, blockedByBuild=${blockedByBuild}`);
  check('THE PLAYER DOES NOT WALK THROUGH THE WALL: 2.5 s of forward input '
        + 'left them on the outside of it',
        sideAfter > 0.2,
        `signed distance along the wall normal went ${sideBefore.toFixed(2)} -> `
        + `${sideAfter.toFixed(2)} m (positive is outside)`);
  check('and they are not standing INSIDE the hull either, by the WALKER\'s '
        + 'own predicate (see `walkerHits`: a body flush against a wall has a '
        + 'side column in the stone and is not inside anything)',
        walkerHits(afterA).length === 0, JSON.stringify(walkerHits(afterA)));
  check('the tape actually drove them (a walker that never moved would pass '
        + 'the check above for free)', movedA > 1.5,
        `${movedA.toFixed(2)} m of travel`);
  check('and the WALKER SAID SO: `blockedByBuild` fired, so this is a refusal '
        + 'rather than a walk that happened to run out of tape', blockedByBuild,
        'blockedByBuild never went true during the wall run');

  // 6b. THROUGH THE DOORWAY. Same tape, same speed, the opposite outcome.
  const entryOut = norm(sub([P.entry[0], P.entry[1], P.entry[2]], inst.sitePos));
  const entryOutFlat = norm(add(entryOut, up, -dot(entryOut, up)));
  const startB = add(P.entry, entryOutFlat, 6);
  of.standAt(...add(startB, up, -1.0));
  await march(1.2);
  const beforeB = of.weight().at;
  const inBefore = gd(beforeB, inst.sitePos);
  aimAtPoint(P.cella);
  of.input.tape([{ hold: 150, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
  await march(3.2);
  const afterB = of.weight().at;
  const inAfter = gd(afterB, inst.sitePos);
  log.push(`door run: ${inBefore.toFixed(2)} -> ${inAfter.toFixed(2)} m from the `
    + `site centre (footprint radius ${inst.footprintM} m)`);
  check('THE RUIN IS ENTERABLE: the identical tape at the doorway carried the '
        + 'player INSIDE the footprint', inAfter < inBefore - 3
        && inAfter < inst.footprintM,
        `${inBefore.toFixed(2)} -> ${inAfter.toFixed(2)} m from centre, `
        + `footprint ${inst.footprintM} m`);
  check('and they ended up standing in clear space, not wedged in stone',
        walkerHits(afterB).length === 0, JSON.stringify(walkerHits(afterB)));

  // =====================================================================
  // 7. A RELOAD KEEPS IT. `Structures.reset()` wipes the shared solid set
  //    on every load, and WG-168's reseat is the only thing that puts the
  //    ruin back. This is the check that would go red the day somebody
  //    moves the reseat below another step that adds solids.
  // =====================================================================
  // SAVE FIRST, and that is not ceremony. `loadSlot` refuses a slot that does
  // not exist and returns null BEFORE it reaches `restoreStructures`, so a bare
  // `of.load()` on a world that has never been saved wipes nothing, reseats
  // nothing, and passes both checks below without exercising a line of the path
  // they exist to test. DW-20: a harness has to prove its own setup.
  const wrote = await of.save();
  const ledger = await of.load();
  log.push(`save -> ${JSON.stringify(wrote)}`);
  check('the save that makes the load meaningful actually wrote',
        wrote !== null && wrote.refused === undefined, JSON.stringify(wrote));
  await march(0.5);
  const R1 = of.ruins();
  log.push(`after load: ruinsReseated=${ledger === null ? 'n/a'
    : ledger.ruinsReseated}, count=${R1.count}`);
  check('A LOAD DID NOT DUPLICATE THE RUIN', R1.count === R0.count
        && R1.list[0].idLo === inst.idLo, JSON.stringify(R1.list.map((r) => r.idLo)));
  check('AND IT IS STILL SOLID AFTERWARDS: the load wiped the shared solid '
        + 'set and the reseat put this one back',
        capsuleHits(wallStand).length >= 5 && ledger !== null
        && ledger.ruinsReseated === R0.count,
        JSON.stringify({ hits: capsuleHits(wallStand).length,
          reseated: ledger === null ? null : ledger.ruinsReseated }));
  // THE INSTRUMENT, RE-READ AT THE END. If `solidBuild` had silently started
  // answering false for everything, every capsule check above would still
  // have passed on the CLEAR side and only this pair can catch it.
  check('CLOSING CONTROL: the wall still reads solid and open ground still '
        + 'reads clear, from the same instrument that passed everything above',
        capsuleHits(wallStand).length >= 5
        && capsuleHits(farPoint).length === 0,
        JSON.stringify({ wall: capsuleHits(wallStand).length,
          far: capsuleHits(farPoint).length }));
  // The world report carries the same instances the debug surface does, so a
  // probe reading either sees one world rather than two.
  const viaGame = of.game().ruins;
  check('and `of.game().ruins` agrees with `of.ruins()`',
        viaGame.count === R1.count && viaGame.list[0].idLo === inst.idLo,
        JSON.stringify({ game: viaGame.count, ruins: R1.count }));

  return { valid: fails.length === 0, negativeControl: false, log, fails,
    site: row, ruins: R1, ledgerReseated: ledger === null
      ? null : ledger.ruinsReseated };
})()
