// ruininvest.js: L7 (GP-546 to GP-549). WALKING INTO THE RUIN AND PRESSING
// INTERACT AT THE investigate SOCKET GRANTS THE MILESTONE THAT UNLOCKS
// ELECTRIFICATION.
//
//   npm --prefix web run build
//   npx --prefix web vite preview --host --port 4341
//   node web/tools/smoke/run.mjs --url=http://<lan>:4341/ --sandbox=1 \
//     --width=640 --height=360 \
//     --evalfile=web/tools/smoke/probes/ruininvest.js
//
// SANDBOX, NOT SURVIVAL, AND THAT IS A DELIBERATE CHOICE: this feature has no
// crafting or building precondition of its own -- the only preconditions are
// POSITION (walk to the ruin) and AIM (find the socket), identical in either
// mode. `of.research()` is a read-only debug op straight onto `/core`'s
// `ResearchState` (GP-532), so it does not go through the survival-only
// `researchStationGated` UI panel this probe never opens. Sandbox also means
// zero garrison (GameMode.ts: `hostile = !sandbox || sandboxCombat`, and
// `--sandbox=1` alone leaves `sandboxCombat` false), so this file needs no
// `of.cheat('peaceful')` and no combat risk at all -- `researchstation.js`'s
// own multi-hundred-swing harvest loop would answer a question this probe
// does not ask.
//
// THE WALK is `ruinplace.js`'s own technique, reused rather than
// re-derived: teleport to just outside the doorway (a real walk from spawn
// is that file's own claim, already proven; re-walking 753.8 m here would
// only cost wall clock), then TAPE THROUGH THE DOORWAY with `of.input.tape`,
// so "entered the ruin" is a driven walker crossing a real collision
// boundary and not a teleport into a solid box. A second, short leg then
// closes on `socket_investigate` from inside the cella.
//
// THE CLAIM, in order: out of range does nothing (negative control, first);
// walking in and interacting grants the milestone exactly once, observed
// three independent ways (the per-ruin `visited` bit, the milestone list,
// and the one `console.info` line `grantMilestone` is documented to log);
// Electrification's own block moves OFF `MilestoneMissing` the instant the
// grant lands, which is "research becomes reachable" read off the tree
// itself rather than inferred; a second press at the same ruin is a named,
// honest refusal ("already investigated") that changes nothing and logs
// nothing; and a save + reload keeps both bits WITHOUT logging a second
// grant, because `PersistProgress.ts` restores milestones through
// `research.earn` directly and never through `grantMilestone` (research.h's
// own comment states the rule this asserts).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.ruins !== 'function') return { valid: false, why: 'no of.ruins' };
  if (typeof of.sites !== 'function') return { valid: false, why: 'no of.sites' };
  if (typeof of.research !== 'function') return { valid: false, why: 'no of.research' };
  const sleep = (n, hz = 30) => of.run(n, hz);
  const march = (secs, hz = 60) => of.run(secs, hz);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const step = (what) => console.log(`[probe] ${what}`);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const gd = (a, b) => len(sub(a, b));

  // A window on `console.info`, so "did a grant fire" is an OBSERVATION of
  // `grantMilestone`'s own documented side effect rather than an inference
  // from `research.milestones()` alone, which cannot by itself distinguish
  // "granted once here" from "was already granted by something else".
  let grantLogs = 0;
  const origInfo = console.info.bind(console);
  const watchGrants = () => { grantLogs = 0; console.info = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes('milestone earned')) grantLogs++;
    origInfo(...a);
  }; };
  const unwatch = () => { console.info = origInfo; };

  const T_ELECTRIFICATION = 0x0010;
  const M_RUIN_INVESTIGATED = 0x0003;
  const BLOCK_MILESTONE_MISSING = 4;
  const techElec = () => (of.research() ?? []).find((t) => t.id === T_ELECTRIFICATION);

  await sleep(1.0);
  of.audio('unlock');
  await sleep(0.2);
  await march(0.5);

  check('this run is SANDBOX', of.game().mode.sandbox === true, JSON.stringify(of.game().mode));
  check('and SAFE (no combat flag), so the ruin posts no garrison',
    of.game().mode.hostile === false, JSON.stringify(of.game().mode));

  // ===========================================================================
  // 0. THE RUIN, THE SOCKET, AND WHAT ELECTRIFICATION LOOKS LIKE BEFORE ANY OF
  //    THIS RAN. `ruinplace.js` already proves the instance IS the site row
  //    and that the collision hull is real; this file trusts that and reads
  //    only what it needs.
  // ===========================================================================
  const R0 = of.ruins();
  const S0 = of.sites();
  if (R0 === null || S0 === null) return { valid: false, why: 'no character' };
  check('exactly one ruin is drawn (ruinplace.js\'s own claim, trusted here)',
    R0.count === 1, JSON.stringify({ count: R0.count, why: R0.why }));
  const inst = R0.list[0];
  const P = inst.points;
  check('THE MODEL PUBLISHES AN INVESTIGATE POINT', Array.isArray(P.investigate),
    JSON.stringify(P));
  const row = S0.rows.find((r) => r.idLo === inst.idLo && r.idHi === inst.idHi);
  check('the drawn instance has a matching site row', row !== undefined,
    JSON.stringify({ inst: [inst.idLo, inst.idHi], rows: S0.rows.map((r) => [r.idLo, r.idHi]) }));
  check('NEGATIVE CONTROL: the site has not been visited yet', row?.visited === false,
    JSON.stringify(row));

  const e0 = techElec();
  check('Electrification exists in the tree', e0 !== undefined, JSON.stringify(of.research()));
  check('NEGATIVE CONTROL: Electrification starts MILESTONE-BLOCKED, naming '
    + 'RuinInvestigated', e0?.block === BLOCK_MILESTONE_MISSING && e0?.milestone === M_RUIN_INVESTIGATED,
    JSON.stringify(e0));
  check('NEGATIVE CONTROL: the milestone is not held yet',
    !(of.game().progress.research.milestones ?? []).includes(M_RUIN_INVESTIGATED),
    JSON.stringify(of.game().progress.research.milestones));

  // ===========================================================================
  // 1. OUT OF RANGE DOES NOTHING. Far from the socket and not aimed at it: no
  //    prompt, and pressing E changes neither the site's `visited` bit nor the
  //    milestone. This is the refusal a player never has to be told about,
  //    because the crosshair never claimed anything was there.
  // ===========================================================================
  step('negative control: out of range');
  const farPoint = add(inst.sitePos, inst.up, 40);
  of.standAt(...farPoint);
  // Heading is deliberately left alone here: 40 m is well past the combined
  // pick reach regardless of which way the crosshair points, and forcing an
  // absolute heading (`of.look(0, 0)`) would hand the WALK below a residual
  // yaw that could be a half-circle from the ruin's real bearing, which is
  // exactly the trap `aimAtPoint`'s wide first pass (below) also defends
  // against independently -- belt and braces, not redundant.
  await sleep(0.3);
  check('OUT OF RANGE: the crosshair resolves to no investigate target',
    of.game().aimed.investigate === null, JSON.stringify(of.game().aimed.investigate));
  watchGrants();
  of.input.act(['interact'], 4);
  await sleep(0.3);
  check('and pressing E out of range left the site unvisited',
    of.sites().rows.find((r) => r.idLo === inst.idLo)?.visited === false);
  check('and granted nothing (no console log fired)', grantLogs === 0, grantLogs);
  unwatch();

  // ===========================================================================
  // 2. WALK IN. `ruinplace.js` section 6b's own technique: stand outside the
  //    doorway, aim at the cella, tape forward. A short second leg then closes
  //    on `socket_investigate` itself, which is not guaranteed to sit on the
  //    doorway's own axis.
  // ===========================================================================
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u, v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -8;
    // `ruinplace.js`'s own [16, 4, 1, 0.3] ladder is correct THERE because its
    // walker is already roughly facing the ruin by the time it calls this
    // (its own prior leg aimed at the same site). This file's first call has
    // no such guarantee -- the negative control above stands 40 m off in
    // whatever heading the spawn left behind -- so the FIRST pass here is
    // widened to 60 (6*60 = 360 degrees), a full circle regardless of the
    // starting yaw, before narrowing with the same ladder. MEASURED, not
    // assumed: the [16,...] ladder alone under-walked the doorway leg by
    // 7.2 m in this file's own first run (19.23 m from centre against the
    // needed <18), a mis-aimed tape rather than a walker defect.
    for (const s of [60, 16, 4, 1, 0.3]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * s, Math.max(-88, Math.min(20, p + b * s)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * s; bp = p + b * s; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  const up = inst.up;
  step('walking through the doorway');
  const entryOut = norm(sub([P.entry[0], P.entry[1], P.entry[2]], inst.sitePos));
  const entryOutFlat = norm(add(entryOut, up, -dot(entryOut, up)));
  const startB = add(P.entry, entryOutFlat, 6);
  of.standAt(...add(startB, up, -1.0));
  await march(1.2);
  const beforeB = of.weight().at;
  aimAtPoint(P.cella);
  of.input.tape([{ hold: 150, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
  await march(3.2);
  const afterB = of.weight().at;
  log.push(`door leg: ${gd(beforeB, inst.sitePos).toFixed(2)} -> `
    + `${gd(afterB, inst.sitePos).toFixed(2)} m from centre`);
  check('THE PLAYER WALKED THROUGH THE DOORWAY, INTO THE FOOTPRINT',
    gd(afterB, inst.sitePos) < inst.footprintM, JSON.stringify({ afterB, footprintM: inst.footprintM }));

  step('closing on the investigate socket');
  // MEASURED, NOT ASSUMED: eight re-aimed hops toward `P.investigate` from
  // here covered barely a metre (12.65 -> 6.56 m) whichever hop budget was
  // given, which is a WALKER GENUINELY BLOCKED by interior geometry between
  // the doorway line and this specific socket, not a slow one -- doubling
  // the hop count changed nothing, which is the tell. Checked directly
  // rather than argued: `of.solidBuild` at `P.investigate` itself reads
  // SOLID at the walker's own capsule heights, so the point is (as its name
  // suggests) the CENTRE OF AN OBJECT -- an altar or console, picked at
  // range the same way a machine's centre is (`GameplayAim.ts`'s own
  // `PICK_REACH_PAST_SURFACE_M`), not open floor a body can stand on. The
  // doorway crossing above is the real, load-bearing collision claim; this
  // leg stands 1.2 m back along the SAME entry axis that crossing already
  // proved is open, which is where a player interacting with the object
  // would actually be standing.
  check('the finding, confirmed directly: the socket IS solid at some capsule '
    + 'height (an object, not open floor)',
    [0.15, 0.9, 1.65].some((h) => of.solidBuild(...add(P.investigate, up, h))),
    JSON.stringify(P.investigate));
  const nudge = add(P.investigate, entryOutFlat, 1.2);
  of.standAt(...nudge);
  await march(0.5);
  aimAtPoint(P.investigate);
  await sleep(0.2);
  const distToSocket = gd(of.weight().at, P.investigate);
  log.push(`distance to socket_investigate: ${distToSocket.toFixed(2)} m, `
    + `aimed=${JSON.stringify(of.game().aimed.investigate)}`);

  // ===========================================================================
  // 3. IN RANGE, AIMED, NOT YET INVESTIGATED.
  // ===========================================================================
  check('IN RANGE: the crosshair resolves the investigate point',
    of.game().aimed.investigate !== null, JSON.stringify(of.game().aimed.investigate));
  check('and it names THIS ruin, by id',
    of.game().aimed.investigate?.idLo === inst.idLo && of.game().aimed.investigate?.idHi === inst.idHi,
    JSON.stringify(of.game().aimed.investigate));
  check('and reads not-yet-investigated', of.game().aimed.investigate?.alreadyVisited === false,
    JSON.stringify(of.game().aimed.investigate));

  // ===========================================================================
  // 4. THE PRESS. Granted once, three independent readings.
  // ===========================================================================
  step('pressing interact at the socket');
  const refusedBefore = of.sites().rows.find((r) => r.idLo === inst.idLo)?.visited;
  watchGrants();
  of.input.act(['interact'], 4);
  await sleep(0.3);
  check('THE SITE IS NOW VISITED (poi.h\'s own bit)',
    refusedBefore === false && of.sites().rows.find((r) => r.idLo === inst.idLo)?.visited === true,
    JSON.stringify(of.sites().rows.find((r) => r.idLo === inst.idLo)));
  check('THE MILESTONE IS HELD', (of.game().progress.research.milestones ?? [])
    .includes(M_RUIN_INVESTIGATED), JSON.stringify(of.game().progress.research.milestones));
  check('AND THE GRANT LOGGED EXACTLY ONCE', grantLogs === 1, grantLogs);
  unwatch();
  const e1 = techElec();
  check('ELECTRIFICATION\'S RESEARCH BECOMES REACHABLE: block moved OFF '
    + 'MilestoneMissing', e1?.block !== BLOCK_MILESTONE_MISSING,
    JSON.stringify({ before: e0, after: e1 }));

  // ===========================================================================
  // 5. IDEMPOTENT SECOND PRESS: honestly refused, nothing moves, nothing logs.
  // ===========================================================================
  step('pressing interact again at the same ruin');
  watchGrants();
  of.input.act(['interact'], 4);
  await sleep(0.3);
  check('a second press at an already-investigated ruin logs NOTHING',
    grantLogs === 0, grantLogs);
  unwatch();
  check('and the milestone list did not grow a duplicate',
    (of.game().progress.research.milestones ?? [])
      .filter((m) => m === M_RUIN_INVESTIGATED).length === 1,
    JSON.stringify(of.game().progress.research.milestones));
  check('the aim now reads "already investigated"',
    of.game().aimed.investigate?.alreadyVisited === true, JSON.stringify(of.game().aimed.investigate));

  // ===========================================================================
  // 6. SAVE + RELOAD: both bits survive, and the RELOAD ITSELF grants nothing.
  //    `PersistProgress.ts` restores milestones through `research.earn`
  //    directly (never `grantMilestone`), so this must observe ZERO grant
  //    logs across the load even though the milestone comes back.
  // ===========================================================================
  step('save + reload');
  const wrote = await of.save();
  check('the save wrote', wrote !== null && wrote.refused === undefined, JSON.stringify(wrote));
  watchGrants();
  const ledger = await of.load();
  await march(0.5);
  check('THE LOAD ITSELF GRANTED NOTHING (no console log during the reload)',
    grantLogs === 0, grantLogs);
  unwatch();
  check('the milestone SURVIVED the reload', (of.game().progress.research.milestones ?? [])
    .includes(M_RUIN_INVESTIGATED), JSON.stringify(of.game().progress.research.milestones));
  check('and exactly once, not duplicated by the restore path',
    (of.game().progress.research.milestones ?? [])
      .filter((m) => m === M_RUIN_INVESTIGATED).length === 1,
    JSON.stringify(of.game().progress.research.milestones));
  const rowAfterLoad = of.sites().rows.find((r) => r.idLo === inst.idLo && r.idHi === inst.idHi);
  check('and the ruin\'s own visited bit survived the reload too',
    rowAfterLoad?.visited === true, JSON.stringify(rowAfterLoad));
  const e2 = techElec();
  check('and Electrification is still off the milestone block after the reload',
    e2?.block !== BLOCK_MILESTONE_MISSING, JSON.stringify(e2));
  log.push(`ledger: ${JSON.stringify(ledger)}`);

  return {
    valid: true,
    pass: fails.length === 0,
    fails,
    log,
    ruin: { idLo: inst.idLo, idHi: inst.idHi, points: P },
    electrification: { before: e0, afterGrant: e1, afterReload: e2 },
    milestones: of.game().progress.research.milestones,
  };
})()
