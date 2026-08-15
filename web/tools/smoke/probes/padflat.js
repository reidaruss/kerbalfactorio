// padflat.js: RETIRED, 2026-08-14 (GP-865 to GP-874). Kept as a pointer, not
// deleted, so nobody reverts the seven-phantom-call version back in blind.
//
// WHAT THIS FILE ORIGINALLY CLAIMED (WG-24 acceptance): after levelling, HOW
// FLAT IS THE GROUND, measured on three surfaces SEPARATELY (the oracle
// field, the drawn near voxel mesh, and the far streamed chunk at 1.8 m LOD)
// so a 2.3x "win" on one instrument could never again be reported as a win on
// the tool, which is what WG-22 did.
//
// WHY IT IS RETIRED RATHER THAN REWRITTEN. WG-193 found it calls
// `of.surfaceAtLatLon`/`of.surfaceAtOffset`, neither of which exist. That
// finding undersold it: a repo-wide grep (this lane, 2026-08-14) found the
// file calls SEVEN functions that exist nowhere in `web/src` --
// `of.surfaceAtLatLon`, `of.surfaceAtOffset`, `of.tangentFrameAt`,
// `of.pressLevel`, `of.drawnHeightAtOffset`, `of.voxelHeightAtOffset` and
// `of.voxelStats` -- confirming INSTRUMENTS.md's own standing-rule-11 entry
// ("padflat.js has not executed a line of its body since WG-22"). It could
// not have passed or failed; it could only ever throw before its first
// assertion.
//
// THE CLAIM IS NOT ABANDONED, IT MOVED. `probes/level.js` (WG-22/WG-23)
// already tests the live claim end to end, against TODAY's real API, in more
// depth than this file ever ran: a REAL `KeyQ` DOM keypress at a player
// pitch (not a tape), `of.surface(dx,dy,dz)` for the oracle field and
// `of.meshVerts(x,y,z,radiusM)` for the drawn near mesh -- the same "worst
// step over a 4 m span" measure this file wanted, at the same 0.25 m DW-32
// perceptual threshold this file used -- plus a negative control sized off
// the tool's own reach, a walk-on check, and a save/reload survival check
// with the rock put back in between. Re-run live on this lane's own local
// build (2026-08-14, `node tools/smoke/run.mjs --scenario=walk
// --evalfile=tools/smoke/probes/level.js`), it is GREEN end to end: `valid:
// true`, all 13 named checks true, log `"before: oracle spread 1.542 m,
// DRAWN step within 4 m 1.065 m"` -> `"after: oracle spread 0.000 m, DRAWN
// step 0 m, outside max delta 0.000000 m over 12 pts"`, `perceptual:
// {thresholdM: 0.25, drawnStepM: 0, meetsThreshold: true}`, the tool's own
// quote agreeing with an independent oracle remeasurement to 0 m error, and
// `padSurvivesReload: true`.
//
// THE ONE PIECE THIS FILE HAD THAT `level.js` DOES NOT: the third surface,
// the far streamed chunk at ~1.8 m LOD. There is no live API for it either.
// `of.meshVerts` (`TerrainDebug.meshVertsNear`) filters to `v.isNear` chunks
// only, by construction (`if (!v.isNear || !v.visible) continue`), and no
// other exposed call samples height at an arbitrary point on a resident far
// chunk. Rebuilding that comparison honestly would need a new client-side
// debug hook, which is bigger than an instrument fix and is left as an OWED
// item rather than faked with a near-mesh number wearing its clothes. It was
// also never the load-bearing half of the claim: the header above named it a
// context comparison ("so the LOD limit is visible as a separate number
// rather than blamed on the tool"), not an acceptance criterion.
//
// Building a second live instrument beside `level.js` for the same claim is
// exactly the collision NUMBERS.md's own registry note warns about ("A probe
// file has no registry, so creating one can silently destroy another"), so
// this file stays retired rather than duplicated.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/padflat.js
(async () => {
  const of = window.__of;
  const liveOracle = typeof of?.surface === 'function';
  const liveMesh = typeof of?.meshVerts === 'function';
  const PHANTOMS = ['surfaceAtLatLon', 'surfaceAtOffset', 'tangentFrameAt',
    'pressLevel', 'drawnHeightAtOffset', 'voxelHeightAtOffset', 'voxelStats'];
  const stillAbsent = PHANTOMS.filter((k) => typeof of?.[k] !== 'function');
  const reappeared = PHANTOMS.filter((k) => typeof of?.[k] === 'function');
  return {
    // Checkable rather than asserted-and-forgotten: if `of.surface` or
    // `of.meshVerts` (the calls `level.js` now depends on) ever disappear,
    // or if one of the seven phantom names is ever reintroduced without this
    // file being revisited, this goes red rather than staying a silent
    // green pointer.
    valid: liveOracle && liveMesh && reappeared.length === 0,
    retired: true,
    why: 'WG-24 three-surface flatness claim now lives in probes/level.js '
      + '(WG-22/WG-23), which drives the real levelling tool through a DOM '
      + 'key and reads of.surface + of.meshVerts. This file could not have '
      + 'run since WG-22 (seven calls to functions absent from web/src).',
    successor: 'web/tools/smoke/probes/level.js',
    successorVerdict2026_08_14: 'valid:true, 13/13 named checks true, '
      + 'perceptual.meetsThreshold:true at drawnStepM 0 against thresholdM '
      + '0.25, padSurvivesReload:true',
    liveApiPresent: { 'of.surface': liveOracle, 'of.meshVerts': liveMesh },
    phantomCallsStillAbsent: stillAbsent,
    phantomCallsReappeared: reappeared,
    owed: 'no live API samples height at an arbitrary point on a resident '
      + 'FAR (non-isNear) chunk, so the third surface (streamed chunk at '
      + '~1.8 m LOD) cannot be honestly rebuilt without a new client-side '
      + 'debug hook; left owed rather than faked.',
    numbers: 'GP-865 to GP-874',
  };
})()
