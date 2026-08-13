// WG-151 setup probe for reload.mjs: enumerate the POI/site table
// over the bridge (ABI 24), mark the shipped ruin known then visited through
// the real debug path (`of.sites()` / `of.siteMarkKnown` / `of.siteMarkVisited`,
// DebugSites.ts), save, and hand the runner the site's IDENTITY so phase 2 can
// prove both bits survived a real reload.
//
// THE SITE IS NAMED BY ITS ID (idLo/idHi), NEVER BY ROW INDEX. `Sites.refresh()`
// rebuilds the row array fresh every construction and poi.h makes no promise
// that row order is stable across it -- only `siteIdFor`'s ordinal keying is a
// contract (WG-204). If the id-keyed save (`SiteCatalog::serialize`) were
// broken, phase 2's by-id lookup would find a site with both bits still false
// and the runner's assertions would go red by name.
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5211/ \
//     --setup=probes/poisites.js
//
// NO --params NEEDED, unlike treereload.js/rockreload.js: the site table is
// read entirely through the debug bridge (no walking, no swinging), and it
// exists at any spawn on Forge -- world-gen places the ruin from `homeDir`,
// which moves with the spawn (WG-200's whole point).
(async () => {
  const of = window.__of;
  await of.run(1.0);

  if (typeof of.sites !== 'function') {
    return { valid: false, fail: 'window.__of.sites is not wired (DebugSites.ts)' };
  }
  const table = of.sites();
  if (table === null || table.count < 1) {
    return { valid: false, fail: `no sites on this body: ${JSON.stringify(table)}` };
  }
  // Found by KIND, not assumed to be row 0, even though today it is the only
  // row: `siteSpecsFor` could add a second kind without this probe noticing.
  const ruinIndex = table.rows.findIndex((r) => r.kind === 1);
  if (ruinIndex < 0) {
    return { valid: false, fail: `no Ruin-kind site: ${JSON.stringify(table)}` };
  }
  const ruin = table.rows[ruinIndex];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  // THE SHIPPED RUIN, MEASURED (WG-214): 753.8 m from spawn, footprint 18 m.
  // A few metres of slack rather than an exact bar, because a future terrain
  // pass that moves the winning candidate by a few metres without changing
  // the id is the exact case WG-204 protects and this probe should not flag.
  check('the known ruin appears at the measured distance from spawn',
        Math.abs(ruin.arcFromAnchorM - 753.8) < 10,
        `arcFromAnchorM ${ruin.arcFromAnchorM}, wanted ~753.8 m`);
  check('with the shipped footprint', ruin.footprintM === 18,
        `${ruin.footprintM}`);
  check('and a real position (not the planet centre)',
        Math.hypot(ruin.pos.x, ruin.pos.y, ruin.pos.z) > 1000,
        JSON.stringify(ruin.pos));
  check('and a real, non-zero id',
        (ruin.idLo !== 0 || ruin.idHi !== 0), `idLo ${ruin.idLo}, idHi ${ruin.idHi}`);

  const knownBefore = ruin.known;
  const visitedBefore = ruin.visited;
  check('unmarked at boot: not known', knownBefore === false, `${knownBefore}`);
  check('unmarked at boot: not visited', visitedBefore === false, `${visitedBefore}`);

  // NEGATIVE CONTROL, DRIVEN FIRST so a side effect on the real site would
  // show up as a false positive on the checks that follow rather than being
  // masked by them: a row index the table does not have.
  const badIndexResult = of.siteMarkKnown(table.count + 999);
  const statsAfterBadIndex = of.sites().stats;
  check('a corrupt row index is refused (null), not silently accepted',
        badIndexResult === null, `${JSON.stringify(badIndexResult)}`);
  check('and it left the table untouched',
        statsAfterBadIndex.known === 0 && statsAfterBadIndex.visited === 0,
        JSON.stringify(statsAfterBadIndex));

  // THE STATE MACHINE: known first (the scan), then visited (the walk-up),
  // through the same debug path a probe for the reveal lane will eventually
  // drive from a real scan action.
  const markedKnown = of.siteMarkKnown(ruinIndex);
  const markedVisited = of.siteMarkVisited(ruinIndex);
  check('markKnown returns true the first time', markedKnown === true,
        `${markedKnown}`);
  check('markVisited returns true the first time', markedVisited === true,
        `${markedVisited}`);
  const afterMarks = of.sites().rows[ruinIndex];
  check('both bits read back true before any save', afterMarks.known === true
        && afterMarks.visited === true, JSON.stringify(afterMarks));

  // THE SAVE, explicitly, so phase 2 is reading a slot this probe wrote.
  const saved = await of.save();
  check('the save succeeded', saved !== null, JSON.stringify(saved));

  const ticks = of.world().tick;
  return {
    valid: fails.length === 0,
    fails,
    // `ruin` is the key name reload.mjs's POISITES block reads to find the
    // site AFTER the reload -- by id, never by index (see the header).
    ruin: {
      idLo: ruin.idLo, idHi: ruin.idHi, kind: ruin.kind,
      arcFromAnchorM: ruin.arcFromAnchorM, footprintM: ruin.footprintM,
      pos: ruin.pos,
    },
    knownBefore, visitedBefore,
    badIndexResult, statsAfterBadIndex,
    markedKnown, markedVisited, afterMarks,
    tableCount: table.count,
    saves: of.game().persist?.saves ?? 0,
    savedReport: saved,
    ticks,
  };
})()
