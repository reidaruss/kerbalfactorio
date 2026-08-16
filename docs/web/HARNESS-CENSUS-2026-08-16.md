# The harness gate census (BT-155 to BT-174)

**Written 2026-08-16 by `lane/harness-census`, a build-tooling lane.** This is
the quiet serial census that BT-80..83 attempted and failed (287 of 291 probes
returned no verdict, 191 SIGKILLed at 240 s on a box that was never quiet). It
is the last prerequisite named for flipping the probe-harness gate: the
mechanism itself was built and proven both ways in BT-80..83, the audit gave
302 of 314 probes documented invocations with 12 visible exclusions and zero
silent nulls (BT-115/BT-116), per-probe timeout markers landed for the two
known long probes and stdout streaming to disk removed the truncation failure
mode (BT-130). What was missing was a real, complete, quiet-enough run of the
whole set. This is that run.

## Method

- Branch `lane/harness-census`, own worktree (`D:\karbalfactorio\.claude\worktrees\agent-a956232559e6b8259`).
- Built once: `npm ci` (worktree had no `node_modules`), `npm run sync-wasm`,
  `npm run sync-assets`, `npm run build` (`tsc --noEmit && vite build`), both
  clean. The committed `web/wasm/dist/of-core.{mjs,wasm}` was used as-is
  (ABI 26); no native or emscripten rebuild was needed or done.
- Served once: `vite preview --port 4600 --strictPort --host 127.0.0.1`,
  started detached, real PID captured off `netstat -ano` (27188), killed by
  that PID at the end (`taskkill /F /PID 27188`). Never `127.0.0.1` for other
  lanes' benefit; this is a self-contained local census, not the shared serve.
- Swept with `web/tools/smoke/probeall.mjs` at **2 concurrent** shards
  (`--shard=0/1 --shards=2`), per Reid's 2026-08-16 ruling that heavy
  development now runs on the desktop and the VM keeps only the test server,
  and per this lane's own brief to hold concurrency at 2 because other lanes
  share this machine. Each shard is its own `node` process (real Windows PID
  via `Start-Process -PassThru`, not bash's `$!`, which reports a wrapper PID
  under Git Bash and would have made "kill by PID" a lie), its own
  `--results=` JSONL file, its own `--stdoutdir=`. No `--nodocs` (only probes
  with a documented `run.mjs` invocation ran through the runner; the audit's
  own EXCLUDED bucket is reported separately below).
- Batching: `probeall.mjs`'s own per-shard, per-probe resumable append (one
  JSON line per probe as it finishes) *is* the checkpoint — a stall loses at
  most the one probe in flight, and restarting the same command with the same
  `--results=` file resumes from the recorded set. This lane polled both
  shard files every 30 to 60 s in foreground loops for the ~4 hour run rather
  than backgrounding and walking away.
- **Load, honestly recorded:** this was not a quiet machine. Mid-run,
  `tasklist` showed 16 `node.exe` and 20 `chrome.exe` processes and
  `Get-Counter '\Processor(_Total)\% Processor Time'` read 100%; several other
  lanes' branches were active concurrently (their own `vite preview`
  instances on ports 4931/4972/4973/5461/5891 were visible throughout). The
  sweep still completed with **zero silent nulls and zero TRUNCATED_OUTPUT**,
  which is itself evidence BT-130's fixes hold under real contention. Wall
  time: preview server up 09:33:56, both shards reported `probeall: done` by
  13:33:06 — **essentially 4 hours** for 304 runnable probes at 2 concurrent
  on a contended box (BT-116's own estimate, "60 to 70 minutes at two
  shards", was for a quieter machine and a smaller, `--only`-scoped set).
- Cleanup: both shard `node` processes exited on their own when their queues
  finished (verified via `tasklist /FI "PID eq ..."` before the preview
  server was killed). No orphaned `chrome.exe` tied to port 4600 was found
  afterward. The preview server was killed by its real PID, never by image
  name.
- **No probe file was edited.** This is a measurement lane. Every finding
  below is recorded, not fixed.

## Headline counts

316 probe files on disk (`web/tools/smoke/probes/*.js`), every one accounted
for exactly once:

| Class | Count | What it means |
|---|---:|---|
| GREEN | 217 | ran, returned a report, verdict clean |
| RED | 35 | ran, returned a report, verdict failed |
| NO_VERDICT | 30 | ran, returned a report, **no field `probeall.mjs` recognises as a verdict** |
| NO_OUTPUT | 22 | did not return a parseable report (15 genuine 240 s timeouts, 7 non-timeout crashes/bails) |
| EXCLUDED | 12 | self-declared two-phase helper, correctly skipped (BT-115's own mechanism) |
| TRUNCATED_OUTPUT | 0 | BT-130's stdout-to-disk fix held; nothing hit the 800 MB safety cap |

**These original counts are left as this lane recorded them; they are not the
current truth.** See the "Amendment" section at the end of this document
(2026-08-15, `lane/verdict-convention`, BT-175 to BT-189) for the corrected
counts (219 GREEN / 39 RED / 24 NO_VERDICT / 22 NO_OUTPUT / 12 EXCLUDED) and
the re-sweep evidence behind each change.

304 probes actually ran through the runner (217+35+30+22); 12 more were
recorded EXCLUDED without running, matching BT-115's audit exactly
(`bodydig.js`, `chestsave.js`, `damagesave.js`, `eva.js`, `mtnbore.js`,
`mtnstand.js`, `padclear.js`, `poisites.js`, `rockreload.js`, `savenamed.js`,
`startfresh.js`, `treereload.js` — every one still a `PROBEALL-EXCLUDE` header
naming the driver `.mjs` that runs it in its real two-phase harness).

**This is the first time all 316 probe files have gone through one pass in
one sweep.** The 79 probes BT-116 covered are a subset of this run; the other
~225 (previously "documented" but never actually swept as a set, per BT-80's
failed census) had never been through a full pass before today.

## The BT-116 reds are closed. Cross-checked, not assumed.

Every one of BT-116's original 10 reds, plus the two it routed to other
lanes, came back GREEN in this sweep, matching the wave of landings the brief
named:

| Probe | BT-116 verdict | This census | Closed by |
|---|---|---|---|
| `controls.js` | RED, 8 fails | GREEN | GP-890/891/892, furnace-cluster |
| `machinepanel.js` | RED | GREEN | GP-890/891/892 |
| `machineshot.js` | RED | GREEN | GP-890/891/892 |
| `rescale.js` | RED | GREEN | GP-906, reds-triage |
| `buildghost.js` | RED | GREEN | GP-909 to GP-911 |
| `digore.js` | RED | GREEN | GP-912 |
| `craftfull.js` | RED (routed, not one of the 10) | GREEN | GP-913/914 |
| `balance.js` | RED | GREEN | FS-116, factory-reds |
| `moonsite.js` | RED (batch artifact suspected) | GREEN | FS-101 (drivenAcc fix), GP-920 |
| `pad.js` | RED | GREEN | GP-922 to GP-924, GP-937/938 |
| `basesnap.js` | RED | GREEN | GP-915 (partial) + GP-935/936 (closed) |
| `machineports.js` | RED (BT-130, `phaseB.inputFell` false) | GREEN | FS-114/115 |
| `propshadow.js` | NO_OUTPUT (stdout cap) | GREEN | BT-130 |
| `cantilever.js` | NO_OUTPUT (240 s timeout) | GREEN, 344 s | BT-130 (`PROBEALL-TIMEOUT: 600000`) + FS-101 |
| `animgate.js` | RED (`ok: false`, BT-40 original) | **still RED** | not yet diagnosed; same finding as BT-130's spot check |
| `discovery.js` | not swept until CE-100 | **still RED** | CE-100 recorded it red on a stashed, rebuilt baseline independent of that lane; not this census's finding, confirms it persists |

The brief's instruction to "expect fewer reds than the old lists imply" holds
exactly: **zero of BT-116's ten reds are still open.** The 35 reds this
census found are almost entirely new information, surfaced because most of
the 316 probes had simply never been run as a set before.

## RED (35): triage on the evidence in hand, nothing fixed

Two are previously known and not this lane's finding (`animgate.js`,
`discovery.js`, table above). Of the other 33, several cluster by shared
symptom text, which is itself evidence for a shared cause. Grouped by
confidence, not by probe name:

### High confidence: instrument, same family as an already-fixed class

- **`build.js`, `furnace.js`, `furnacelit.js`** — all three fail identically,
  `"could not craft the furnace"`, `pack` short of Raw iron. **`furnace.js`
  and `furnacelit.js` carry the exact stocking-loop line GP-890 diagnosed and
  fixed in `controls.js`/`machinepanel.js`/`machineshot.js`**:
  `if (n.kind !== 0 && n.kind !== 3 && n.kind !== 2) continue` (skips Rock,
  so the pickaxe is never craftable, so every Coal/Iron/Copper swing is
  refused `ToolRequired` under GP-506's gate). `build.js` uses a different
  loop (`[0,1,2,3].includes(n.kind)`, Rock included) but the *same* missing
  step — no pickaxe craft between the bare sweep and the gated one — so the
  same three kinds still come back empty. **These three probes were not in
  GP-890's or FS-114/115's scope and were never fixed.** (Recorded here as
  NO_VERDICT, not RED — see the NO_VERDICT section; they belong to both
  because of a second, independent harness gap.)
- **`genpole.js` (15 fails), `power.js` (10 fails), `gp49.js` (3 fails)** —
  all three describe the same shape from different angles: `"coal was mined
  for the generator: 0"`, `"a generator is on the ground"` followed by "NO
  FUEL"/"NO NETWORK" readouts, `"the SAME smelter goes down clear of the
  generator"`. This is very likely **the identical GP-506 tool-gate family**:
  a bare-hand coal-mining loop that predates the pickaxe gate, now refused,
  so no coal ever reaches a generator that three different probes then watch
  fail to produce power. Not confirmed by reading `genpole.js`/`power.js`/
  `gp49.js` line by line (out of this lane's budget), but the symptom match
  to GP-890's already-proven mechanism is strong. **Recommend one lane
  diagnose all three together, GP-890-style, before assuming three separate
  defects.**

### High confidence: instrument, self-labelled

- **`flyto.js`**: `valid: false (why: fixture 0 parts)` — the probe names its
  own fixture as empty.
- **`qolflight3.js`**: `valid: false (why: fixture failed to reach orbit:
  CLAMPED)` — same self-labelling.
- **`map3d.js`** shares the same word: `"the flight is live in ORBIT:
  CLAMPED"` is one of its 7 fails. Combined with `qolflight3.js` and the two
  genuine timeouts `ascent.js`/`apexec.js` (see TIMEOUT below, both also
  orbit/ascent probes) and `maneuver.js` (also timed out), **there is a
  visible cluster of 5 probes (`map3d.js`, `qolflight3.js`, `vabdest.js`,
  `ascent.js`, `apexec.js`, `maneuver.js`) all touching the same shared
  ascent/orbit fixture path, several of them CLAMPED or unable to reach
  orbit at all under this run.** Worth its own diagnostic pass as one
  cluster rather than six separate reds; not diagnosed further here.

### Medium confidence: instrument, matches a catalogued class

- **`playthrough.js`**: `"good 1187 vs bad undefined"` — an `undefined` read
  is exactly `INSTRUMENTS.md`'s and NUMBERS.md's own "dead field read" class
  (BT-26/BT-27): the probe is very likely reading a field that moved.
- **`pondscatter.js`**: `"the coverage sample is empty or both captures were
  black"` — matches the catalogued "black frame from a camera inside
  geometry" class (BT-15/`INSTRUMENTS.md`).
- **`visitsite.js`**: fail text says `"the menu carries all seven sites"` and
  then **lists eight** (`spawn, current, hills, hills2, plains, beach,
  beach2, forest`). The count in the assertion is stale against the site
  list, not the game.
- **`vesselrails.js`**: `"the registry is empty: 1 records"` — the message
  contradicts itself (not empty, one record); reads as a stale `=== 0`
  expectation, plausibly related to the very recent maneuver-catalogue/
  carrier-station work in this repo's last few commits.
- **`padstair.js`, `vesselrebase.js`**: both fail on a `"6 x 6 platform"` /
  `"6 x 6 block"` completion claim alongside `valid: false (why: no pad
  placed)`. This is very plausibly the same aim/placement-helper class
  GP-922/923 fixed in `pad.js` itself (a `l < 0.5 m` guard that could never
  fire, an un-stood-back placement step) — just not yet applied to these two
  other probes, which appear to carry their own copies of similar helpers.
- **`terrainart.js`**: the fail text itself raises the possibility
  (`"either this is not a matched pair or the term is not confined to the
  terrain"`) — the probe is unsure of its own methodology, which is a
  self-report of instrument risk.
- **`mapwork.js`**: `INSTRUMENTS.md` already documents this exact probe's
  history (a `>=` comparison that passed on any sign of change, cleared by
  0.086 on a 2,784-sample mean). The current fail (`pass: false`, no detail)
  may or may not be the same defect area; needs its own read against that
  known history, not a fresh guess.
- **`ibldiag.js`**: `"the disc boost did not change the cube maximum: the
  raise never reached the capture"` — an active branch (`lane/ibl-diag`)
  already exists in this repo; **this red may already be owned**, check
  before dispatching a new lane.

### No confidence either way: the fail text carries no diagnostic content

Six reds are a bare `valid: false` (or `ok`/`pass: false`) with **nothing
else in `fails[]`** — the exact "a red with no reason attached" pattern
NUMBERS.md's own style repeatedly calls out as worth a name:
`beltturn.js`, `burieddiag.js` (has one line but it hedges between two
causes itself: `"the walker kept its floor, or the detector never armed"`),
`tunnellit.js`, `tunnelsink.js`, `underwater.js`. Also under-detailed:
`clamprestore.js` (`"THE CLAMP RELEASES on a RESTORED vessel: CLAMPED,
releases undefined"` — a real save/restore state claim, worth a look, but no
further breadcrumb), `tunnelmouth.js` (`"no walkable descending slope found
near spawn"`, a world-gen fixture precondition), `cheats.js` (a UI-string
match), `handoff.js`, `machineopen.js`, `vabsnap.js`, `wind.js`,
`phrcskeys.js`, `phrendezvous.js`, `equip.js`. These are genuinely
undiagnosed from this lane's evidence; **instrument vs game is an open
question for each**, and phrasing several of them ("props hidden, two wind
times hash IDENTICAL", "the frame gave the triangles back exactly", small
non-zero RCS off-axis components) reads more like real physics/rendering
measurements than fixture noise, so **do not default-assume instrument** for
this group.

## NO_VERDICT (30): named, and the bucket is not what it looks like

The BT-115 audit estimated "about 15" report-only probes. This census counts
**30** in the NO_VERDICT class, and roughly **24 of them are legitimately
report-only** telemetry/screenshot/perf dumps with no pass/fail field at all
by design: `bakecost.js`, `cost.js`, `forestsite.js`, `frame.js`, `holes.js`,
`lunarnight.js`, `nightsky.js`, `plainshot.js`, `pop.js`, `popshot.js`,
`r17_hp.js`, `r17_scout.js`, `rockpose.js`, `rocksite.js`, `seamcut.js`,
`seams.js`, `shine.js`, `treectl.js`, `treesite.js`, `viewtoggle.js`,
`walk.js`, `walkdet.js`, `zfight.js`, plus `buildtol.js` (computes a
`tolerance` band and reports `advanced`/`footprintM`/`buryBoundM` but never
asserts against its own tolerance — measures without concluding, a softer
finding, not a hidden fail).

**The other 6 are not report-only. They are RED, and the harness cannot see
it.** `probeall.mjs`'s `verdictOf()` recognises exactly four signals:
`fails[]` (array), and boolean `valid`/`ok`/`pass`. **It does not recognise a
fifth, real, currently-used convention: a singular `fail` field carrying a
truthy string message.** Six probes return exactly that and nothing else
recognisable, and every one of the six strings names a real failure, not an
empty placeholder:

| Probe | `eval.fail` | Reading |
|---|---|---|
| `airlock.js` | `"the ramp is not the length the fringe predicts"` | 0.326 mm off a computed prediction; needs its own read |
| `build.js` | `"could not craft the furnace"` | same GP-890 tool-gate family, see RED section above |
| `furnace.js` | `"could not craft the furnace"` | same GP-890 tool-gate family, confirmed via source (stale stocking loop) |
| `furnacelit.js` | `"could not craft the furnace"` | same GP-890 tool-gate family, confirmed via source |
| `orbitdeck.js` | `"run this with --sandbox=1"` | **pure invocation bug**: the probe's own documented header command is missing a flag it needs, exactly `clickonce.js`'s BT-116 precedent |
| `portmigrate.js` | `"the smelter would not go down at the head"` | undiagnosed, needs its own read |

Cross-checked against every GREEN too, not just the NO_VERDICT bucket: no
probe returned a truthy `fail` alongside a `valid`/`ok`/`pass: true`, so
**nothing is falsely GREEN**. The gap only ever under-counts into
NO_VERDICT, which BT-41's own proposed gate shape treats as visible-but-
non-blocking — meaning **these six would keep passing the flipped gate
silently, forever, exactly the defect this whole audit lineage exists to
catch.** This is the single most important finding in this census for the
flip decision.

## TIMEOUT and crash (22 total under NO_OUTPUT)

**15 genuine hard timeouts**, `exit: null`, `timedOut: true`, killed at
`240000 ms` (nobody's per-probe `PROBEALL-TIMEOUT` override was hit — these
are all first-time hits, not the two BT-130 already knows about):
`apexec.js`, `ascent.js`, `assembler.js`, `autoapproach.js`, `basereal.js`,
`buildshot.js`, `demolish.js`, `enemies.js`, `factoryrebase.js`,
`maneuver.js`, `padgate.js`, `pondwade.js`, `post.js`, `qolflight2.js`,
`survivalrun.js`. `post.js` was one of BT-40's original 4 REDs
("`post.js` 4" fails); it has since moved from a returned RED to an
unrecoverable timeout, which is a regression in the probe's running time
worth flagging on its own, separate from whatever its original 4 fails were.

**3 probes hit `timedOut: true` but still produced a complete, parseable,
trustworthy verdict** (BT-130's stdout-to-disk fix means the report was
already fully written before the hard kill landed): `enemyshot.js` (GREEN,
240034 ms), `machineports.js` (GREEN, 420043 ms, 43 ms past its own
`PROBEALL-TIMEOUT: 420000` override), and `walk.js` (NO_VERDICT, 240045 ms,
though its own internal `walkSecs` is only 90). **All three finish their
actual work and then hang on process exit** rather than returning promptly —
an instrument debt (probably a lingering `page`/`browser` handle or timer),
not a probe correctness question, and worth its own look since it silently
eats the whole timeout budget on three probes that are otherwise fine.

**7 non-timeout crashes** (`exit: 1`, `timedOut: false`, the browser or
runner itself threw before a report was produced):
- `navdraw.js`: `"ABANDONED, never boarded, so nothing below was measured"` — a
  bail guard, plausibly stale against the CE-100 boarding-contract rewrite
  (`standAt` vs `standAboard`).
- `qolbuild2.js`, `qolbuild3.js`: both throw mid-run (`"N of M checks
  failed: found an aim at which ... is PLACEABLE (fixture)"`) — a fixture
  precondition search failing, thrown as an exception instead of returned in
  `fails[]`, so the runner sees a crash rather than a verdict.
- `qolsandbox.js`: `"ABANDONED, wrong mode; nothing below this line was
  measured"` — a bail guard, mode mismatch.
- `ripplewalk.js`: `"setSunElev(0.64) missed by 0.1158; this site cannot
  reach that elevation"` — a fixture/site limitation, self-described.
- `shadowk.js`: `"SyntaxError: Invalid or unexpected token"` inside
  `page.evaluate` — **this is a real instrument bug**, the probe fails to
  even parse/execute, not a game claim at all.
- `stationframe.js`: `"page.waitForFunction: Timeout 60000ms exceeded"` — a
  *different*, shorter (60 s) internal wait inside `run.mjs` itself, not the
  240 s process timeout; a condition the probe waits for never became true
  inside that window.

## The flip statement

**The gate cannot be flipped exactly as `probeall.mjs`'s verdict rule stands
today without shipping a known false-negative.** Two concrete gaps, both
found by this census, both fixable without touching a single probe's game
assertions:

1. **`verdictOf()` must recognise the `fail` (singular, string) convention**
   used by at least 6 live probes, or those 6 stay silently non-blocking
   forever under the flipped gate (`airlock.js`, `build.js`, `furnace.js`,
   `furnacelit.js`, `orbitdeck.js`, `portmigrate.js`). This is the same
   class of fix BT-43 already made once for the `ok`-only convention; it is
   the identical shape of gap, just a different key name. **Small, scoped,
   mechanical.**
2. **`orbitdeck.js`'s documented header command is missing `--sandbox=1`**,
   a one-line fixture-invocation fix with the exact `clickonce.js` precedent
   already in this file's own history (BT-116).

Beyond those two, the flip is a judgement call, not a blocker, and the
options are:

- **Flip now, with the 35 REDs entering `known-red.json`** (BT-41's proposed
  two-sided allowlist: exactly the recorded fail count passes, more fails,
  zero fails also fails so a silent fix has to delist itself). This is
  honest and matches the project's stated gate shape, but ships a gate that
  is known-incomplete against item (1) above until it is fixed — the 6
  `fail`-only probes would need fixing or listing as EXCLUDED first, or they
  are invisible to the allowlist too.
- **Fix (1) and (2) first** (estimated under a day for one build-tooling
  lane; both are `probeall.mjs`/one-probe-header changes, no game code),
  re-sweep only the previously-NO_VERDICT and previously-EXCLUDED sets to
  confirm the fix surfaces exactly 6 new reds and nothing else moves, **then**
  flip with the full, now-accurate 35-to-41-probe `known-red.json`.

**This lane recommends the second path** on the evidence above (a
known-incomplete gate is the same defect this whole audit lineage exists to
find), but does not flip the gate: that is named in this lane's own brief as
an Admin decision, and Reid should see the false-negative finding before it
is made.

## Verification

- `npx tsc --noEmit` clean, `npx vite build` clean (see Method).
- `node --check` not run against any probe (none was edited).
- Census shape is reproducible: 2 shards (`--shard=0/1 --shards=2`) against a
  locally built, `vite preview --port 4600 --strictPort --host 127.0.0.1`
  served tree, real D3D11 headless Chrome (`--use-angle=default`, ANGLE
  resolves to D3D11 on this box, matching every prior lane's own
  verification), processes started via `Start-Process -PassThru` for a real
  PID and killed by that PID.
- Raw artifacts kept as this lane's own record, not committed (large):
  `census/shard0.jsonl`, `census/shard1.jsonl` (one line per probe, full
  `fails[]`, `evalKeys`, timing), `census/stdout0/`, `census/stdout1/` (full
  raw report per probe). Available in the worktree for any lane that wants
  to re-derive a claim in this file rather than re-run the sweep.

## Amendment (2026-08-15, `lane/verdict-convention`, BT-175 to BT-189)

**This is an amendment, not a silent rewrite.** Every count and table above is
left exactly as `lane/harness-census` recorded it on 2026-08-16. What follows
is what changed, why, and the new evidence, so a reader can see both what was
believed then and what is known now.

### Cause

This lane's brief was BT-160's own recommended path: fix `verdictOf()`'s
missing singular-`fail` convention and `orbitdeck.js`'s missing `--sandbox=1`
flag, then re-sweep only the affected set to confirm the fix surfaces exactly
the six known probes and moves nothing else. That work is items 1 to 3 below.
Partway through, the coordinator added three more items surfaced by a
same-day cross-lane finding and by this lane's own re-sweep: the loopback-
shadows-wildcard trap (`NUMBERS.md`, recorded by Admin 2026-08-15/16), the
`machineports.js` 43 ms margin, and the requirement to re-run every RED
serially per `probeall.mjs`'s own header comment (lines 38-43: "every red
from a sharded sweep is re-run serially before it goes on the list": the
original census never actually did this for its 35). Items 4 to 6 below are
that work.

### 1. `verdictOf()` now recognises five conventions, not four

Confirmed by grepping every probe for how it actually returns (not assumed
from one example): `fails: [...]` (array), `valid`/`ok`/`pass` (booleans),
and the missed fifth, a singular truthy string `fail` from an early-return
guard shaped `const fail = (why, extra) => ({ fail: why, ...extra })`. Fixed
in `web/tools/smoke/probeall.mjs`'s `verdictOf()`. While in there, an
unrecognised-but-verdict-shaped key (a near-miss name, or a right name with
the wrong type) now returns a new, LOUD `UNRECOGNISED_VERDICT_SHAPE` class
naming the offending key, instead of silently falling into `NO_VERDICT`:
the exact failure mode that let the singular-`fail` gap go unnoticed as long
as it did. A real report-only probe's keys (`texW`, `drawCalls`,
`footprintM`, ...) never match this pattern, confirmed against all 24
legitimately report-only probes in the re-sweep below: none tripped it.

### 2. `orbitdeck.js`'s missing invocation

The probe carried no `// node tools/smoke/run.mjs ...` header at all: the
old `extractCmd()` matched the first comment line containing the substring
`run.mjs`, which was a prose sentence 56 lines down with zero `--` flags, so
the probe ran undocumented and its own opening guard
(`if (!of.sandbox().sandbox) return { fail: 'run this with --sandbox=1', ... }`)
failed every time. Added the standard header block (`--scenario=walk
--sandbox=1`, the same convention `decksink.js` and `clickonce.js` already
use, `clickonce.js`'s BT-11x note being the named precedent) ahead of the
prose paragraph that used to be matched by mistake.

### 3. Parser-fix re-sweep: the affected set, before and after

Built once (`npm ci`, `sync-wasm`, `sync-assets`, `tsc --noEmit` clean, `vite
build` clean). Served `vite preview --port 4650 --strictPort --host
127.0.0.1`, 2 concurrent shards, 38 probes: all 30 originally-NO_VERDICT
probes, a 5-probe GREEN control (`controls.js`, `digore.js`, `craftfull.js`,
`balance.js`, `moonsite.js`), a 3-probe RED control (`genpole.js`,
`mapwork.js`, `playthrough.js`). Ownership of the port was proven before
trusting it: a unique sentinel file was written into `web/dist` and fetched
back over HTTP first, per the loopback-shadows-wildcard rule below.

| Probe | Before | After |
|---|---|---|
| `airlock.js` | NO_VERDICT | **RED** ("the ramp is not the length the fringe predicts") |
| `build.js` | NO_VERDICT | **RED** ("could not craft the furnace") |
| `furnace.js` | NO_VERDICT | **RED** ("could not craft the furnace") |
| `furnacelit.js` | NO_VERDICT | **RED** ("could not craft the furnace") |
| `portmigrate.js` | NO_VERDICT | **RED** ("the smelter would not go down at the head") |
| `orbitdeck.js` | NO_VERDICT | **GREEN** (both fixes together clear it) |
| the other 24 NO_VERDICT probes | NO_VERDICT | NO_VERDICT, unchanged (confirmed legitimately report-only; none tripped `UNRECOGNISED_VERDICT_SHAPE`) |
| GREEN control (5) | GREEN | GREEN, unchanged |
| RED control (3) | RED | RED, unchanged |

This is the parser change proven both ways: a probe reporting the singular
`fail` convention is now RED, and every probe reporting one of the other
four conventions is classified exactly as before. Full per-probe records:
`web/tools/smoke/resweep/shard0.jsonl`, `shard1.jsonl` (this lane's own
worktree, not committed, same convention as the original census's raw
artifacts).

### 4. `machineports.js`'s timeout margin

The original census's `PROBEALL-TIMEOUT: 420000` override finished at
420043 ms, 43 ms of margin under real contention, not a margin. Raised to
`600000`, the same value already used by `cantilever.js`'s own override,
recorded in the probe's own header comment.

### 5. Every RED re-run serially, per `probeall.mjs`'s own rule

`probeall.mjs` says explicitly that a RED from a sharded sweep is not
trustworthy until re-run serially; the original census never did this for
its 35. This lane did, plus the 5 newly-surfaced REDs from item 3 (38
probes total: 33 of the census's named REDs it could ground in the document
text, covering both previously-known reds `animgate.js`/`discovery.js`, plus
the 5 from item 3; **see the note on the "35" count below**).

**A server died mid-run and the reading up to that point was voided, not
kept.** Another lane's teardown killed every preview server on the box
partway through the first serial attempt (port 4650): 3 probes had already
returned genuine verdicts (`airlock.js`, `animgate.js`, `beltturn.js`, all
RED), then the connection dropped. The next 19 probes returned instant
`exit=1`/`NO_OUTPUT` because there was nothing to connect to, and the
remaining 14 were never attempted. Per the loopback-shadows-wildcard rule,
that reading is void, not a verdict: it was discarded, not reported. A
fresh server was started on a new port (4715), ownership proven again via a
freshly-written sentinel fetched back over HTTP, and the 21 void plus 14
unattempted (35 probes) were re-run. **The server's liveness was
independently re-confirmed by fetching the sentinel every 15 s for the
entire re-run**, so the next finding is not another dead-server artifact:

- 32 of the 35 returned clean, real verdicts on the first re-attempt.
- 3 (`phrcskeys.js`, `phrendezvous.js`, `playthrough.js`) hit the shared
  240 s timeout with **no parseable output**, deep in the serial queue,
  while the sentinel confirmed the server was alive and answering the whole
  time. Re-run in isolation (just these 3, wider 360 s wrapper budget, same
  live server): all 3 returned genuine RED verdicts at 209 s, 251 s, and
  209 s wall time, comfortably real reds, not fixture failures, but two of
  the three exceed the shared 240 s default even alone. This reads as
  resource accumulation over a long serial run (many sequential Chrome
  launches), not concurrent-shard contention, which is a different harness
  caveat than any previously named. **Flagged, not fixed**: no
  `PROBEALL-TIMEOUT` override was added without the kind of dedicated
  standalone measurement BT-130 did for `cantilever.js`/`machineports.js`;
  that measurement is unstarted future work.

**Final serial-confirmed table (38 checked):**

| Result | Count | Detail |
|---|---:|---|
| Confirmed RED, as classified | 32 | includes `animgate.js`, `discovery.js` (both previously known) |
| Confirmed RED after a false NO_OUTPUT read | 3 | `phrcskeys.js`, `phrendezvous.js`, `playthrough.js` (see above) |
| Newly-red from item 3, confirmed again here | 2 | `airlock.js`, `portmigrate.js` (the other 3 newly-red probes, `build.js`, `furnace.js`, `furnacelit.js`, are also in this 38 and also confirmed RED, folded into the 32 above) |
| **Reclassified RED to GREEN** | 1 | **`terrainart.js`**: the census's original RED was a sharded-contention artifact. Serially, with no other probe competing for the GPU/CPU, it is clean. This is exactly the failure mode `probeall.mjs`'s own comment warns a shard can produce, now caught by doing what that comment says. |

**On the "35" count:** this lane could only ground 33 individually-named
probes in the census document's own text (31 newly-found across its
confidence buckets, plus the 2 previously-known), not 35. The document's own
prose has at least one internal miscount to match (the "no confidence"
section opens "Six reds are a bare `valid: false`..." and then names five).
This is flagged for a future amendment rather than guessed at; it does not
change any of the 38 verdicts actually re-run above, only whether the
original headline "35" was itself exactly right.

### 6. Corrected headline counts

| Class | Original | Corrected | Change |
|---|---:|---:|---|
| GREEN | 217 | **219** | +`orbitdeck.js` (item 3), +`terrainart.js` (item 5, reclassified from RED) |
| RED | 35 | **39** | -`terrainart.js` (item 5), +`airlock.js`/`build.js`/`furnace.js`/`furnacelit.js`/`portmigrate.js` (item 3) |
| NO_VERDICT | 30 | **24** | -6 (the singular-`fail` probes, 5 to RED + `orbitdeck.js` to GREEN) |
| NO_OUTPUT | 22 | 22 | unchanged; not re-swept by this lane (see NO_OUTPUT triage below) |
| EXCLUDED | 12 | 12 | unchanged |

219 + 39 + 24 + 22 + 12 = 316. Every probe still accounted for exactly once.

### NO_OUTPUT (22): characterised, not fixed, same triage discipline the original census used for its REDs

- **The ascent/orbit cluster**: `apexec.js`, `ascent.js`, `maneuver.js`
  (timeouts) join the census's own already-identified cluster with
  `map3d.js`, `qolflight3.js`, `vabdest.js` (all confirmed RED above): one
  diagnostic pass across all six is recommended, not six separate ones.
- **`post.js`**: a regression, not a new finding. BT-40 originally recorded
  it as a returned RED (4 fails); it now hangs to a hard timeout instead of
  returning. Worth flagging on its own to whichever domain owns it, since
  "used to answer, now hangs" is a different and more urgent claim than "was
  always slow."
- **`machineports.js`**: fixed, item 4 above.
- **11 remaining first-time timeouts with no shared textual signature**:
  `assembler.js`, `autoapproach.js`, `basereal.js`, `buildshot.js`,
  `demolish.js`, `enemies.js`, `factoryrebase.js`, `padgate.js`,
  `pondwade.js`, `qolflight2.js`, `survivalrun.js`. Each needs its own
  standalone, no-wrapper-timeout run (the BT-130 method) to tell "genuinely
  slow, needs a documented override" from "hangs, is a real bug": 11 runs
  at up to several hundred seconds each is outside this lane's own number
  block and time budget. **Remaining checklist item, owner: build-tooling,
  next lane.**
- **3 that hit `timedOut: true` but still produced a complete, trustworthy
  report** (`enemyshot.js` GREEN, `machineports.js` GREEN, `walk.js`
  NO_VERDICT): all three finish their real work and then hang on process
  exit rather than returning promptly, an instrument debt (a lingering
  handle or timer), not a verdict question. Still open.
- **7 crashes**: `shadowk.js` is a genuine instrument bug (a `SyntaxError`
  inside `page.evaluate`, does not even parse) and is the one item here that
  is a real code fix, not a diagnosis, unstarted. `qolbuild2.js`/
  `qolbuild3.js` throw a fixture-precondition failure as an exception
  instead of returning it in `fails[]`; changing that to a return would turn
  a crash into a real, informative RED. `navdraw.js`, `qolsandbox.js`,
  `ripplewalk.js`, `stationframe.js` are each self-describing bail guards or
  fixture limits per the original census, not re-diagnosed further here.

**Gate design gap this triage surfaces:** BT-41's `known-red.json` makes a
*new* RED visible against a flipped gate. Nothing today makes a *new*
NO_OUTPUT visible the same way: a probe silently regressing from GREEN to
a timeout would pass a flipped gate exactly as silently as the singular-
`fail` probes did before this lane's fix. This is named in the flip
position below, not resolved here.

### The flip position, restated

**The two originally-named blockers (BT-158's parser gap, BT-160's missing
`--sandbox=1`) are fixed and proven both ways.** The re-sweep found nothing
the fix should not have moved, and moved everything it should have.

**This lane does not consider the gate ready to flip anyway**, on evidence
this lane itself produced rather than on the original two blockers:

1. **`terrainart.js` proves the sharded-RED-is-untrustworthy rule is not
   theoretical.** A `known-red.json` built from the original, un-reconfirmed
   35 would have shipped one wrong entry on day one. The corrected 39-probe
   RED set above (33 census-named + `airlock.js`/`build.js`/`furnace.js`/
   `furnacelit.js`/`portmigrate.js`, minus `terrainart.js`) is the first set
   this lane would trust for that file, and even it carries the open "35 vs
   33-named" question above.
2. **NO_OUTPUT (22) has no protective allowlist and 15 of its 22 members are
   undiagnosed.** A flipped gate needs an answer for what NO_OUTPUT means
   under it before it can be called complete, not just an accurate RED list.
3. **A new, real timing caveat** (three probes reading NO_OUTPUT only when
   deep in a long serial queue) means "re-run serially" is necessary but not
   sufficient for a fully trustworthy reading; a probe's position in a long
   queue is its own confound, previously undocumented.

**Recommended remaining checklist, with owners:**

| Item | Owner |
|---|---|
| Standalone BT-130-style timing runs for the 11 unclustered NO_OUTPUT timeouts | build-tooling, next lane |
| Decide and implement how NO_OUTPUT is represented under a flipped gate (a `known-no-output.json`, or fold into `known-red.json`, or something else) | Admin decision, then build-tooling |
| `shadowk.js`'s `SyntaxError` (a real instrument bug, not a diagnosis) | build-tooling |
| `post.js`'s RED-to-timeout regression | whichever domain owns `post.js`'s scenario |
| Reconcile the census document's "35" claim against the 33 this lane could ground in its own text | build-tooling, next amendment |
| The flip itself | **Admin decision**, not this lane's, unchanged from the original brief |

## Cross-reference

[NUMBERS.md](NUMBERS.md) BT-155 to BT-189 for the allocation and usage split.
[../controllers/build-tooling.md](../controllers/build-tooling.md) for the
subagent-log entry. [INSTRUMENTS.md](INSTRUMENTS.md) for `mapwork.js`'s prior
history, cited above rather than repeated.
