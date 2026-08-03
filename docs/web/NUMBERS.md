# Decision-number allocation ledger

**Admin owns this file.** A lane does not pick its own numbers.

## Why this exists

Six numbering collisions happened before this file did. Every one had the same
shape: two lanes appending to the same numbered list at the same time, each
reading a table that was correct when it read it. GP-25 twice, ARCHITECTURE
items 108/109, FS-33/FS-34, GP-57 to GP-60 four ways, and finally a case where
one lane claimed GP-65 to GP-72, committed first, was renumbered around by a
second lane, and the second lane then landed on the renumbered range anyway.

Conventions did not fix it, because the failure is a race and a convention is
not a lock. Reviewing harder did not fix it either. The only thing that works
is that the numbers are handed out by one writer before the work starts.

## The rule

1. Admin allocates a **disjoint block** to each lane **in its brief**, before
   the lane begins.
2. A lane uses only its own block. It never reads the table to decide what is
   free, because that read is the race.
3. A lane that runs out asks Admin for another block rather than taking the
   next number it can see.
4. Unused numbers in a block are **abandoned, not reclaimed**. A gap in the
   sequence costs nothing. Reusing a number costs a day of confusion, and has.
5. Admin updates this file when it allocates, not when the lane lands. An
   allocation that exists only in a brief is invisible to the next allocation.

## Allocated

| Block | Lane | Status |
|---|---|---|
| GP-57 to GP-60 | launch pad placement | landed |
| GP-61 to GP-64 | machine interaction panel | landed |
| GP-65 | combat, health on every buildable | landed |
| GP-66 to GP-72 | combat, claimed then abandoned in a collision | **burned, never reuse** |
| GP-73 to GP-76 | launch pad, clamp and recover and stairs | landed |
| GP-77 to GP-78 | unused remainder of the pad block | burned |
| GP-79, GP-82 | combat, player health and sandbox danger rule | landed |
| GP-80, GP-81, GP-83, GP-84 | combat, claimed and unstarted | held |
| GP-85 to GP-99 | combat continuation: the gun, enemies in the world | allocated |
| GP-100 to GP-114 | Escape menu and cheat panel | allocated, not started |
| GP-115 to GP-129 | VAB overhaul | GP-115 to GP-122 USED (snap near misses, the radial pylon, the probe vite config, the pre-flight verdict, the roll-out confirm, the tabbed rail, recover in the bay, the bay camera); GP-123 onward free |
| WG-29 to WG-30 | the map draws the world | landed |
| WG-31 to WG-32 | tunnel floor, tunnel mouth | landed |
| WG-33 to WG-34 | close-in map contrast, ABI 14 | landed |
| WG-35 to WG-44 | water: the pond basin, the water level authority, ABI 16, swimming | landed (WG-35 blob diagnosis, WG-36 basin + water_field.h, WG-37 water_field_tests, WG-38 ABI 16, WG-39 WaterOracle, WG-40 Swim.ts, WG-41 Capsule/slopeGate split, WG-42 WaterSurface, WG-43 pondwade probe, WG-44 pondshot probe) |
| WG-45 to WG-49 | water remainder: the pump and pipes are NOT in this block, they need an Admin decision first | held |
| PH-45 to PH-46 | tunnel sinking does not reproduce under a mountain | landed |
| PH-47 to PH-59 | tunnel sinking, structural lead | allocated |
| FS-33, FS-35 to FS-42 | corner cargo, pollution, typed items, belt corners | landed |
| FS-43 to FS-57 | Satisfactory-style machine ports | allocated, not started |
| GP-85, GP-86 | combat: enemy loop at ABI 15, the gun | landed |
| GP-87 to GP-99 | combat remainder, enemies in the world | held |
| RN-1 to RN-14 | rendering, historic | landed |
| RN-15 to RN-29 | ground vegetation, contact blending, aerial perspective | allocated |
| FS-56 to FS-75 | assemblers, storage container, machine scale | allocated |
| PH-64 to PH-84 | vessel persistence and on-rails propagation | PH-64 to PH-70 USED (the registry as the one answer to "where is this vessel", the three record modes, ABI 18, the saved form, the player's body parks coherently, the handoff seam, the verified design snapshot); PH-71 onward free |
| RN-45 to RN-69 | graphics pass three: rocks, LOD2 cards, terrain material | allocated |
| GP-100 to GP-114 | Escape menu, cheats, hotbar editing, BUILD MENU on B | allocated |
| RN-30 to RN-44 | rendering: shadow contact, grass height, aerial perspective take two | allocated |
| PH-47 | tunnel sinking, structural lead, not reproduced | landed |
| PH-60 to PH-74 | physics: R18 fall through rock, R18b stuck in a wall | landed at PH-60 to PH-63. **THE TAIL OF THIS ROW OVERLAPS `PH-64 to PH-84` ABOVE AND IS SURRENDERED**: the later allocation is the live one, PH-64 to PH-70 are the vessel lane's, and nothing from the R18 lane may take a number above PH-63. Recorded rather than silently renumbered, because two lanes reading the same row differently is how a number gets used twice |
| BT-27 | the build stamp | landed |
| PS-13 to PS-16 | persistence: R46, named saves through the writeSlot choke point | PS-13 to PS-15 landed; PS-16 burned. Block taken per the Admin brief's own instruction (the PS series lived only in the controller file, ended at PS-12); recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| RN-241 to RN-270 | rendering, the rock geometry pass under ART-DIRECTION.md | RN-241 to RN-247 landed (the fracture vocabulary, four fracture behaviours, the budget raises, the harvestable spire, Mountains and Hills scree, the decoration size-rule correction); RN-248 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| RN-331 to RN-370 | rendering, the look-development pass under ART-DIRECTION.md | RN-331 to RN-337, RN-345 to RN-347 and RN-352 landed (the findings, the adopted response curve, the fourth site that disagreed, the ground/sky mask and the night answer, the foliage tone, the instance variation, the biome substrate table, and the written target at rendering.md 2.1); RN-338 to RN-340 are FINDINGS ONLY and are named as not-done in the entry; RN-348 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |
| PH-140 to PH-199 | physics, the autopilot: R43's dv lie, Lambert, transfers, hold-orbit, rendezvous | PH-141 to PH-155 USED (the stage performance fix, ABI 22, `orbital::lambert`, `transfer.h`, the departure sweep, the four `of_ap_*` exports, the allocated plane-change leg, hold-this-orbit, the SAS 180 degree singularity, rendezvous); PH-156 onward free |
| WG-140 to WG-199 | world-gen, Cinder the moon and the lifecycle boundary | WG-141 to WG-150 USED (the moon reachable from the client, the crater ladder, the neighbourhood defect, the rim step, the biome-gain bug one body over, the curvature instrument, the noise counter's blind spot, the atmosphere routing, and the seam analysis); WG-151 onward free |
| GP-261 to GP-271 | gameplay, the autopilot part, VAB reach panel and map planner | landed (the published `of_ap_*` contract, the pending state, the part 0x010D, the reach gate, the NO ANSWER band, the departure chart, the drawn arc, the airless-body plant invariant) |
| GP-272 to GP-299 | gameplay, autopilot execution: arm, cancel, per-frame status | allocated 2026-08-03 |
| GP-300 to GP-349 | gameplay, the end-to-end playthrough of everything landed 2026-08-03 | allocated 2026-08-03 |
| PH-200 to PH-249 | physics, the airless ascent program and R63's calibration | allocated 2026-08-03 |
| PS-40 to PS-89 | persistence, the save has no notion of a second body, and an armed programme does not survive a reload | allocated 2026-08-03 |
| CE-30 to CE-79 | core-engine, the carrier frame term | allocated 2026-08-03 |
| RN-950 to RN-999 | rendering, the untextured role, the tile scale, the ambient floor | allocated 2026-08-03 |
| RN-845 to RN-899 | rendering, drawing a second body in the sky | allocated 2026-08-03 |
| RN-851, RN-856 to RN-859 | asset lane, docking port and first-person arms | **LANDED INSIDE THE ROW ABOVE. Admin's failure, see note.** Those five are **burned**; the rendering lane must not reuse them |
| RN-900 to RN-949 | asset lane, third-person body and armour set | allocated 2026-08-03 |
| GP-500 to GP-549 | gameplay, the teleport to the moon, loose stones and the pickaxe gate, the autopilot behind the station | GP-500 to GP-505 USED (the Another-world group and the reload route, the already-here refusal, the seven Forge sites blocked off-Forge, the driven runner and its negative control, and the two SCOPING entries for the pickaxe gate and the autopilot milestone); GP-506 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible |
| GP-450, GP-452, GP-455 | gameplay, an unallocated pass that wrote the moon teleport and never landed | **BURNED, NEVER REUSE.** A gameplay pass on 2026-08-03 wrote the moon-teleport work into the working tree carrying these three numbers, which **this file has never allocated to anybody**, and ended without committing or logging. The next gameplay lane found the files uncommitted, verified them, **renumbered them into its own allocated block** (GP-500, GP-502, GP-505) and landed them. The originals are burned per rule 4. **The lesson is rule 1's, not rule 4's: the pass took numbers it was not given, and nothing but a later reader noticed** |
| GP-350 to GP-399 | gameplay, the thread past the launch pad, the length of a transfer, and the two charts' refusal vocabulary | GP-350 to GP-353 USED (the three flight rows and the `VoyagePort`, the trip duration off curve word 3, the drawn refusal columns and the pinned affordability rule, the `mapplanner.js` premise that GP-291/GP-295 retired); GP-354 onward free. Allocated in the Admin brief; recorded here by the lane because rule 5 says an allocation that exists only in a brief is invisible to the next allocation |

**The RN collision above was Admin's, and rule 5 is exactly what would have caught
it.** I allocated RN-845 to RN-899 to a rendering lane in its brief, and at the
same time ran an asset lane with **no block at all**, having told it to continue
the RN series. It took RN-851 and RN-856 to RN-859, inside the other lane's
range. Nothing broke, because the rendering lane had not reached those numbers
yet; **that is luck, not process.**

The cause is one line above in this file: I had already written that not
allocating blocks to those lanes was "a judgement call, not an oversight",
justified by there being **one lane per domain**. That justification was wrong
within the hour, because an asset lane and a rendering lane are **two lanes in
one number series** even when they are different domains by charter. **The unit
that collides is the number prefix, not the org chart.**

**Blocks NOT allocated tonight, deliberately and with the reason recorded**, since
rule 5 says an unrecorded decision is invisible: the rendering and core-engine
lanes were told to continue their own series rather than being handed a block.
That is a violation of rule 2 and it was a judgement call, not an oversight.
**Exactly one lane per domain is live**, and every collision in the history above
was two lanes inside one domain, so the race this ledger exists to prevent cannot
currently occur. **The moment a second lane opens in either domain, both need
blocks before either starts.**

FS-34 is deliberately unused: the pollution lane renumbered its own FS-33/FS-34
to FS-35/FS-36 when corner cargo reached main first.

## Related

Standing rule 10 (path-limited commits) is the other half of this. Two lanes in
one checkout collide on files as well as on numbers, and a broad `git add` has
already swept one lane's work into another lane's commit.

## FIRST: `git commit -- <paths>` DISCARDS YOUR INDEX

Read this before the technique below, because it is the trap the technique
exists to escape, and standing rule 10 as originally written walked straight
into it.

**`git commit -- <paths>` does not commit what you staged.** It ignores the
index and commits the CURRENT WORKING TREE contents of those paths. So a lane
that hunk-stages carefully, verifies with `git diff --cached --numstat`, and
then commits "path-limited" has its hunk selection **silently thrown away** and
ships whole files including other lanes' in-flight edits.

That is the mechanism behind all three incidents this session where one lane's
work landed inside another lane's commit. It was never carelessness. Three
lanes followed the rule as written and the rule was wrong.

- `git add <paths>` then a bare `git commit` (no pathspec) is safe: it commits
  the index.
- `git commit -- <paths>` is NOT safe and must not be used when any file you
  touch also carries someone else's uncommitted work.

## Committing from a shared checkout without disturbing other lanes

Standing rule 10 says commit path-limited. That is necessary and it is not
sufficient: `git add <paths>` still writes the SHARED index, so a lane that
stages 32 files and a lane that stages 3 fight over one file, and three times
this project a broad `git add` swept another lane's work into the wrong commit.

The Escape-menu lane solved it properly on 2026-07-28 and it is now the
recommended technique when other lanes have staged work:

1. Point `GIT_INDEX_FILE` at a private index file.
2. Stage only your paths into it.
3. `git commit-tree` and `git update-ref` to land the commit.

The shared index is never touched, so a lane with a large staged set keeps it.

When a file you own carries ANOTHER lane's uncommitted hunks in the working
tree, do not commit the file wholesale. Build a **filtered blob** from `HEAD`
plus your own hunks and stage that. Their work stays in the working tree for
them to commit themselves.

This is the difference between "I tried not to touch their work" and "I could
not have touched their work". Prefer the second.

One wrinkle the private-index technique does not remove: after landing a commit
that way, the SHARED index still holds pre-commit entries for your paths and
will read as staged modifications or deletions. Follow with
`git reset -q HEAD -- <your paths>` (scoped to your paths, never `.`).

### Freezing a build: archive `web`, never the whole tree

`git archive HEAD | tar -x` extracts **`ue/` as well**, which is 6.8 GB of dead
Unreal assets superseded by the Three.js pivot. Two lanes doing that at once
filled a 931 GB disk to zero on 2026-07-28 and briefly stopped every lane.

Always scope it:

```
git archive HEAD web | tar -x --strip-components=1 -C <dir>
```

Then `cp -r web/public <dir>/public` (generated, not tracked) and build with
`OF_BUILD_STAMP=<sha>` so the frozen bundle states the commit it came from
rather than interrogating the checkout around it.

Delete the scratch directory when done. A 24 MB build left behind is nothing;
thirteen of them plus their Chrome profiles is not.

### `abi=N` IN THE BOOT LOG IS A CONSISTENCY CHECK, NOT A FRESHNESS CHECK

**A freeze of `b30d161` reported `abi=19` with smoke PASS and zero console
errors, on a tree whose source says 20. Both halves were true and neither was a
bug.** Resolved 2026-07-28 (PH-82).

The client throws unless the wasm agrees with it:

```
// OfCore.ts
const abi = M._of_abi_version();
if (abi !== OF_ABI_VERSION) throw new Error(...)
```

So `abi=19` printing successfully proves the bundle ALSO expected 19. **A stale
build is internally consistent**: old JS expects 19, old wasm returns 19, the
check passes, the page boots, smoke is green. The handshake line can only ever
catch a MISMATCHED build, and a mismatched build does not boot at all, so in
practice the line can never fail. **It says client and wasm agree with each
other. It says nothing about whether either is HEAD.**

Verified rather than argued: HEAD's committed binary was loaded in node and asked
directly, `_of_abi_version()` returns **20**; a correct `git archive HEAD web`
freeze bundles `client expects 20`, serves the 411607-byte wasm and reports
**`abi=20`** with smoke PASS.

**CORRECTION, and the correction is the interesting part.** I concluded from that
"so the build that printed 19 was not built from HEAD". **That was wrong.** Admin
ran the two commands below against the live demo and the freeze WAS building
HEAD: bundle `client expects 20`, HEAD `OF_ABI_VERSION = 20`, served wasm byte
identical to HEAD's. The real cause was a **stale server on a reused port** (see
the entry above this one): the measurement never reached the new build at all.

The lesson survives the wrong diagnosis and is arguably strengthened by it.
**Neither of us could tell the difference from the inside.** A self-consistent
report is compatible with a stale build, a stale server, and a correct build, and
the boot line reads the same in all three. That is the whole argument for
comparing against HEAD rather than trusting a self-report, and it is why the two
commands below are worth running even when nothing looks wrong.

**`OF_BUILD_STAMP` has the same shape and is worth naming beside it.**
`vite.config.ts:20` takes the stamp from the environment and only falls back to
`git rev-parse` (then to `'nogit'` inside an archive, which has no `.git`). A
freeze therefore states the sha the operator TOLD it to state. Stamp a stale
directory `b30d161` and it will say `b30d161` in good faith. **The stamp restates
the intent; it does not measure the content.**

Two things that look like verification and are not, both reporting exactly what a
correctly-labelled stale build would report.

**THE CHECK THAT ACTUALLY MEASURES IT** compares the served artifact against
HEAD, which the build cannot self-report:

```bash
# 1. the served wasm IS HEAD's
git show HEAD:web/wasm/dist/of-core.wasm | cmp - <servedroot>/wasm/of-core.wasm   && echo "wasm matches HEAD"
# 2. the bundle's expectation IS HEAD's constant
grep -oh "client expects [0-9]*" <servedroot>/assets/*.js | sort -u
git show HEAD:web/src/sim/wasm/OfCore.ts | grep "OF_ABI_VERSION = "
```

Both are cheap and neither can be satisfied by a build that merely agrees with
itself. Run them on every handover build; `abi=N` is worth printing but is not
evidence of freshness.

### `npx vite build` SKIPS sync-wasm, so a frozen build can carry a stale wasm

`npm run build` runs `prebuild` (`sync-wasm` then `sync-assets`). **`npx vite
build` does not.** So a scratch build made the fast way keeps whatever
`web/public/wasm` happened to hold.

It bit a lane on 2026-07-28: another lane bumped the client to ABI 19 mid
session, the lane's builds kept a wasm at 18, **a binary silently failed to
boot, a `--out` screenshot never wrote, and it compared two images that were the
same file**. Identical output from a changed input is the tell, and it paid off
three times that night.

This applies to Admin's frozen handover builds too. After archiving, copy the
ARCHIVED `web/wasm/dist` into the build's `public/wasm` rather than copying the
live checkout's `public/`, or run `sync-wasm` inside the scratch tree. Then
confirm the handshake ABI in the boot log matches the source's
`OF_ABI_VERSION`.

### Scratch build directories: one per lane, named, and yours alone

The disk reached **7.2 MB free of 931 GB** on 2026-07-28 from `dist-*`
directories accumulating across every lane, and one lane deleted another lane's
mid-run, which corrupts a measurement in a way that looks like a code defect.

- One scratch directory per lane, named for the lane (`dist-<lane>`).
- Delete it when the pass ends. Not "eventually".
- **Never delete a directory you did not create.** If the disk is tight, say so
  and let Admin arbitrate.

### `update-ref` must be compare-and-swap, and staging must be path-explicit

Four times this session a lane's commit has carried a file belonging to another
lane. Twice the content happened to be correct, once it cost a commit outright.
Two independent causes, and the protocol needs both halves:

**1. Stage by explicit path, never by directory or `-A`.** A directory add
sweeps whatever another lane left modified in that directory.

**2. Use the three-argument `update-ref` so a concurrent commit fails loudly:**

```
git update-ref HEAD <new-sha> <expected-old-sha>
```

where `<expected-old-sha>` is the HEAD you passed to `commit-tree -p`. The
two-argument form **silently orphans any commit another lane landed** between
your `read-tree` and your `update-ref`, because your new commit's parent is the
HEAD you read, not the HEAD that exists. The three-argument form refuses and
you re-read and retry, which is the correct behaviour under concurrency.

Related: a private-index commit chain can fail mid-way and leave HEAD untouched
(seen once with exit 66 under disk pressure). **`git log` is the check, not the
exit code of the chain.**

### A probe file has no registry, so creating one can silently destroy another

`web/tools/smoke/probes/*.js` are loose files with no index. **Writing a probe
onto a name that already exists is indistinguishable from creating a new one**,
and the Write tool will not warn you. It happened on 2026-07-28: a lane's new
screenshot probe landed on GP-61's `machineshot.js` and destroyed it. It was
caught only because the lane ran

```
git diff-index --cached --name-status HEAD
```

and saw `M` where it expected `A`.

**Before writing a new probe, check the name is free.** After staging, check the
status letter is `A` for every file you believe you created. An `M` on a path
you have never edited means you have just overwritten someone's work, and the
content will commit cleanly and look correct.

This is the same family as the four commit sweeps: **the tooling cannot tell
"new" from "replacing something I never read".** Explicit-path staging and
compare-and-swap `update-ref` close the commit half; this check closes the
authoring half.

### Freezing a build: `sync-assets` too, not just `sync-wasm`

`git archive HEAD web` archives **only `web/`**. The models live in `assets/`
at the repo root and reach the client via `web/public/assets`, which is
generated and **not** regenerated by `npx vite build` (only `npm run build`'s
`prebuild` does it, and only in the tree it runs in).

So a freeze that copies the live `web/public` into an archived tree ships
whatever models the shared checkout last synced. On 2026-07-28 that was four
boulders and a broadleaf behind HEAD: Admin's demo builds served **old rocks
and an old tree** while reporting the correct commit stamp.

Before every freeze, from the repo root:

```
cd web && npm run sync-assets
```

then copy `web/public` into the scratch tree as usual, and copy the archived
`web/wasm/dist` over `public/wasm` per the `sync-wasm` note above.

This is the same family as the wasm trap and the stale `web/dist` bundle: **the
served artefact and the committed source are separate things, and only one of
them is what the stamp names.** A build stamp proves which source was archived.
It proves nothing about the models, the wasm, or anything else generated.

### `--strictPort` fails the NEW server, so a reused port measures the OLD build

`--strictPort` is the right flag, but understand what it does on a port you
already used: **the new preview refuses to start, the old server keeps serving,
and anything you point at that port measures the previous build.** No error
reaches you if you background the server and only check the URL afterwards,
because the URL answers 200 the whole time.

This cost Admin a false alarm on 2026-07-28: a freeze of HEAD appeared to report
`abi=19` against a source that says 20, which looked like a stale-build defect
serious enough to raise with a lane. **The build was correct. The measurement
was pointed at a server from six freezes earlier**, and seven stale preview
servers were found still listening.

Before serving on a port, kill whatever holds it and confirm it is gone, or use
a port no run has used. After serving, confirm the server you just started is
the one answering, not merely that something answers.

This is the same family as everything else in this file: **the instrument was
aimed at the wrong thing, and the wrong thing answered plausibly.**

### What actually proves a frozen build is HEAD

The boot line `abi=N` proves the client and the wasm **agree with each other**.
A stale build is internally consistent, so it prints a number and boots and goes
green. It cannot prove freshness, and a genuinely mismatched build does not boot
at all, so in practice that line can never fail.

`OF_BUILD_STAMP` has the same shape: `vite.config.ts` states the sha the
operator passed it, in good faith, whatever directory it is stamping.

Compare the served artifact against HEAD instead, which is the one thing a build
cannot self-report:

```
git show HEAD:web/wasm/dist/of-core.wasm | cmp - <servedroot>/wasm/of-core.wasm
grep -oh "client expects [0-9]*" <servedroot>/assets/*.js | sort -u
git show HEAD:web/src/sim/wasm/OfCore.ts | grep "OF_ABI_VERSION = "
```

Keep printing `abi=N`. It is worth having during development, where a broken
pairing is possible. Just never read it as freshness on a handover build.

### The shared index accumulates STALE blobs, and a bare commit ships them

Private-index commits leave the shared index untouched, so entries staged hours
earlier survive there indefinitely. They are not merely redundant: measured on
2026-07-28, three probe paths held blobs that differed from **both** HEAD and the
working tree.

```
cheats.js:      staged 0570417f   head c1b8f588   worktree c1b8f588
launchguide.js: staged 027f9179   head 519d47f5   worktree 519d47f5
savenamed.js:   staged cc795cf2   head 0c9d5089   worktree 0c9d5089
```

A bare `git commit` in that state would have **reverted three probe fixes**,
including the vacuous-antecedent repair, under whatever message the committing
lane happened to write. The same hazard appears as staged deletions: a lane
found two screenshots marked `D ` while present on disk and in HEAD.

**Check `git diff --cached --name-status` before and after every pass.** It
should be empty. If it is not, `git reset -q HEAD -- <paths>` clears it without
touching the working tree.

This is the fourth member of the sweep family. The others move a file into the
wrong commit; this one moves a file **backwards in time** while every surface a
lane normally checks (`git status`, the working tree, `cat-file -e HEAD:`) looks
correct, because the stale content is only in the index.

### A filtered blob is not enough when the artifact is GENERATED from a shared source

The filtered-blob technique (commit only your own hunks of a file another lane
has uncommitted work in) protects a file you EDIT. It does not protect a file
you REGENERATE.

On 2026-07-30 a lane regenerated `surfaces.json` from the shared surface-family
source while a sibling lane had an uncommitted table move in that source. The
generator read the sibling's working-tree state, and the regenerated artifact
laundered their unlanded work into HEAD under an unrelated commit message. The
blob was filtered; the INPUT was not.

**Before committing any generated artifact, check whether its generator reads a
file another lane is mid-edit in.** If it does, either regenerate from a clean
`git archive HEAD` tree, or confirm the generator's inputs are all committed.
`git status` on the GENERATOR'S INPUTS is the check, not `git status` on the
artifact.

This is the fifth member of the sweep family, and the sneakiest: every surface a
lane normally inspects looks correct, because the artifact genuinely is the
correct output of the tree as it stood.

### Boot defaults: `Number(null)` is 0, so a feature can ship OFF

`RN-150`: the ground texture and the wet-sand shoreline both had boot defaults
that evaluated through `Number(null)` and landed on 0. Both features were fully
built, measured, committed, and **invisible to the player**: the probes that
proved them all passed an explicit flag, so nothing ever exercised the default.

**A flag's DEFAULT is a fixture and must be asserted as one.** If a probe only
ever runs the feature with `?feature=1`, it proves the feature works and proves
nothing about whether anyone sees it. Assert the boot default in its own check,
red-by-name when the default is wrong.

### A filtered blob built from a STALE BASE is a revert, not an omission

The filtered-blob technique (commit HEAD's content plus only your own hunks, so
a sibling lane's in-flight work in the same file is not swept) was adopted to
fix the sweep family. **It carries the same defect it was adopted to fix, for
the same reason: it is built FROM A BASE, and a base is a point in time.**

Measured on 2026-08-01. A lane committed ten files and fourteen screenshots. The
very next commit **reverted all of them**, not carelessly, but because it built
its blob as "HEAD plus only my hunks" against **the HEAD that existed when its
pass started**, which was the first commit's parent. The blob faithfully
preserved every row that existed when the lane began and silently deleted every
row that arrived afterwards.

This is the `git checkout --` entry generalised. That one says a checkout is
unsafe when HEAD moves under you mid-pass. **A filtered blob has exactly the
same property, and it is the technique we adopted BECAUSE of that entry.**

**Two rules, both required:**

1. **Pin the base SHA once**, at the moment you decide to commit, and build
   every blob from that exact SHA (`git show <sha>:<path>`), never from the
   moving `HEAD:` ref.
2. **Verify HEAD is still that SHA in the same breath as the commit**, and
   refuse if it moved. Re-read, rebuild the blob, retry.

That is "the check has to be adjacent to the write", applied to the thing that
actually moves.

### `git commit` refreshes the index and can discard a `--cacheinfo` blob

`git commit` runs `refresh_index()` and re-reads stat-dirty paths from the
working tree, **which can silently replace a blob you staged with
`--cacheinfo` by whatever the shared tree currently holds.** A carefully
filtered blob does not survive it.

Use `git write-tree` plus `git commit-tree`, which do not refresh, and
**assert the tree BEFORE it is written rather than inspecting the commit
afterwards.** Inspecting afterwards tells you what happened; asserting before
tells you whether to proceed.

### A filtered commit protects the files you NAME, not the inputs your BUILD READ

Two laundering hazards were already recorded: staging a file another lane is
mid-edit in, and regenerating a shared artifact whose generator source is
uncommitted. **This is a third and it defeats both defences.**

On 2026-08-02 a lane staged four paths by name and deliberately did NOT stage a
dirty `of_lib.py`. **The staging was correct. The artifact was not.**
`build_smelter.py` READS `of_lib.py` at build time, so the `smelter.glb` it
committed carried a sibling lane's unreleased palette edit, baked into the
bytes.

**Explicit-path staging gives ZERO protection here**, because the contamination
is inside the artifact before staging begins. Every gate passes on it: the
validator, the coplanar check, the byte-identical rebuild control (it rebuilds
from the same dirty input), and `git diff --cached` all read clean.

**The only check that catches it is a `git archive HEAD` rebuild and a hash
compare.** Measured: a clean rebuild produced `0848bc10` against the committed
`9226b56f`.

**Before committing any built artifact, ask what its build script READS, not
just what you are staging.** If any input is dirty, rebuild from a clean
`git archive HEAD` tree and compare hashes.

### Read a gate's VERDICT TOKEN, never its last lines

A lane ran `check_coplanar.py | tail -2` and shipped a red gate. On success the
last line **is** the verdict. On failure the verdict is followed by a six-line
explanatory footer, **so the same `tail` showed prose and hid `FAIL` six lines
above it.**

**A truncation that is safe on the happy path and lossy on the failure path
fails in exactly the direction nobody checks.** Grep the verdict token
(`FAIL`, `OVER`, `over allowance`) rather than slicing the tail.

### An implausible magnitude is an instrument bug until proven otherwise

`check_shadow_lod.py` treated a whole file's LOD nodes as one ladder, so on
`launch_pad` (which declares `LaunchPad_LOD0/1/2` **and** `LaunchClamp_LOD0/2`)
it measured a pad against a clamp standing 14 m away and reported a deviation of
**14,090 mm**.

Two lanes and Admin propagated that number as an asset defect within an hour,
and it became a task. **Fourteen metres is not a plausible LOD deviation for a
2,564-triangle asset.** The tell was there and nobody looked.

**When a measurement is implausible in magnitude, suspect the instrument before
writing it down as a finding.**

### The marginal multiplier prices the NEXT triangle; it is not a saving

The shadow-cascade work gave asset lanes a lever: an asset's marginal multiplier
is `1 + (cascades still drawing tier 0)`, so making a lower tier shadow-safe
takes an asset from 4x to 3x to 2x to 1x, and every triangle after that costs
proportionally less frame.

**It is a price on future growth, not a recovery on present cost, and treating
it as the latter produces work that measures well and saves nothing.**

Measured on 2026-08-02. `floor` missed cascade 0 by 20.00 mm, exactly like
`belt_segment`, and looked like the same cheap win. It is not. The 20.00 mm is
the ribs' tops penetrating 0.020 into the plate, and **`Floor_LOD1`'s entire
saving IS the omission of those ribs**, 132 triangles down to 60. Adding them
back to clear the gate returns LOD1 to 132, **identical to LOD0**. Cascade 0
would draw the same triangles either way, the multiplier would read a triumphant
1.0x, and nothing whatsoever would have been saved.

**Where making a tier shadow-safe costs that tier its entire reason to exist,
the multiplier becomes a false proxy for the thing it stands for.** Check what
the lower tier actually omits before spending anything to make it admissible.
An asset that is not about to grow does not benefit from a cheaper next
triangle.

`belt_segment` is the honest opposite case and shows what a real one looks like:
its 20.00 mm was a **dropped state chip**, so restoring it cost twelve triangles,
took the asset to 1.87 mm and 1.0x, **and fixed a correctness defect on its own
terms** (a belt at LOD1 range had no state readout at all, while every other
machine's LOD1 keeps its chip).

### A completed attribution with no owner ships forever

The near ground on Forge has carried a pattern of dark etched contour lines in
every close frame for months. Reid reported it directly. It was then attributed
**definitively, by elimination**: it survives `?groundtexamp=0` and vanishes
under `?groundreliefamp=0`, so it is the ground relief bump. A second lane
independently flagged the identical artefact from in-world frames without
knowing that attribution already existed.

**Two lanes measured it, both were mid-pass on something else, both correctly
declined to reach outside their slice, and nobody fixed it.** Every individual
decision was right and the outcome was a known defect shipping in every build.

The gap is Admin's, not the lanes'. **A lane that finds a defect outside its
slice has discharged its duty by reporting it. Converting that report into an
owned task in the same turn is the controller's job**, and a report that lands
only in a controller file is a report that has been filed rather than routed.

When two independent lanes report the same symptom, that is not corroboration
to be noted. **It is evidence that the routing failed once already.**

### An unowned load-bearing file is a bug in the agent architecture

`web/src/world/FloatingOrigin.ts` has **zero decision tags and is named in no
controller doc**, and a runtime body switch turns on it. `Services.body` is a
`readonly` scalar on a 45-field all-`readonly` record **with no teardown of any
kind**, and it is likewise unclaimed.

Floating origin is listed in core-engine's charter in `CLAUDE.md` in those exact
words. **It has been theirs the entire time and their context file never said
so.** Nothing was contested; the file simply fell between the charter and the
context file, which is where rot accumulates without anyone deciding to allow
it.

**Ownership recorded only in the charter is not ownership.** When a domain
touches a file that its own context file does not name, adding it there is part
of the work, not paperwork after it.

### A registered parameter that does not move the picture is worse than a missing one

`--sundot` is registered in `PAGE_PARAMS`. `--sundot=0.28` and `--sundot=0.92`
produce **visually identical frames** in the walk scenario.

A lane reached for it to reproduce a grazing-light condition and got a confident
null result: the artefact under investigation appeared unchanged across the
whole range, which is exactly what "this is not lighting dependent" looks like.
**A missing flag fails loudly. A dead one returns a clean answer to a question
it never asked.**

Being in the params list is a claim that the control works. **Either make it do
what its name says or delete it**, and treat any registered control that has
never been proven to move its own output as unverified rather than available.

### An unmergeable binary cannot be owned by more than one lane at a time

On 2026-08-02 three lanes were concurrently rebuilding `web/wasm/dist/of-core.wasm`:
physics adding transfer exports, gameplay adding a catalogue row, world-gen
adding a body. **A `.wasm` is one opaque blob and git cannot merge it. Whoever
commits second silently reverts the others, and it looks green, because the
binary still parses and only the missing exports are wrong.**

The world-gen lane caught this unprompted and refused to commit, because two
physics commits touching `orbital.h` and `transfer.h` had landed after its
build. That refusal is the correct instinct and it should not have to be
rediscovered per lane.

**Standing rule.** Lanes commit headers, `.inc` files, TS and probes freely,
because text merges. **No lane commits `web/wasm/dist/of-core.wasm` or
`web/wasm/test/expected.json`.** They are built, used, and left dirty. Admin
does one settled rebuild from a tree holding every lane's sources, regenerates
the fixture, verifies the exports, and commits the binary alone. Every lane
states the exact export names and word counts it added, so the rebuild verifies
them without reading diffs.

Related and separately load-bearing: **an ABI bump and its wasm must land in one
commit that boots.** A half-bridge window reached `main` earlier the same night,
client at ABI 22 while the wasm was still 21, before the following commit closed
it.

### The shared git index is a second collision surface, and it fails silently

On 2026-08-02 a lane **landed a commit containing zero files.** `fe1268a` has a
full message, reads perfectly normally in `git log`, and is empty. **A
concurrent lane reset the shared index between its `git add` and its
`git write-tree`, two bash calls apart.**

Compare the two failure modes. A `.wasm` clobber at least leaves a wrong binary
that a probe can catch. **An eaten index leaves a commit that looks correct in
every log and history view and contains nothing**, and the work stays in the
working tree looking exactly like work that was committed.

**The check that was already in place did not catch it.** Confirming
`git diff --cached` is empty at both ends passes trivially when the index was
already empty when it was read. **A check that passes for the wrong reason is
worse than no check**, because it converts an unexamined risk into a recorded
assurance.

**Standing rule while lanes share a tree:**

1. **Private index.** `GIT_INDEX_FILE` under your own scratchpad,
   `git read-tree HEAD` into it, stage explicit paths into it. Never the shared
   index.
2. **The whole sequence in ONE shell invocation.** Between two calls another
   lane can and will run.
3. **Verify the written tree actually differs from the base tree** before
   `commit-tree`. Equality with base is the failure signature.
4. **Three-argument `update-ref refs/heads/main <new> <base>`**, so a moved HEAD
   fails loudly rather than clobbering.
5. **`git show --stat` afterwards** and confirm the file list is what you meant.
6. **Then `git reset -- <your paths>` on the SHARED index.** See below: this
   step is not tidiness, it is the fix for a worse bug than the one above.

**The second failure mode, which is worse: a private index does not clean up
after itself.** Once you commit from one, your files are still sitting in the
shared index in their **pre-commit** state, and relative to the new HEAD that
state is a **revert**.

Measured on this tree the same night, after two lanes had correctly adopted
private indexes: the shared index held **seven stale entries and would have
deleted 137 lines across two lanes** on the next commit anyone made from it. It
included a screenshot staged as a **deletion** moments after it had been
committed, and 35 lines of this file, **the entry documenting the first half of
this very bug.**

Repair is a path-limited `git reset -- <paths>`, which resets index entries to
HEAD and does not touch the working tree.

**A stale index entry is a silent revert wearing a normal-looking commit.** It is
one level worse than the empty commit: an empty commit merely loses your work,
while a stale entry actively removes somebody else's, and the diff of the
offending commit looks like ordinary work.

The general form, which is the part worth carrying elsewhere: **when several
writers share one mutable staging area, correctness cannot be established at the
ends of the operation. It has to be established inside it.** And **a writer that
opts out of the shared area still owes it a write**, because everyone else is
still reading it.

### The shared WORKING TREE is a collision surface too, so measure in an isolated one

A lane hit `ReferenceError: Lifetime is not defined` in `Boot.ts`, reasonably
concluded that `main` was broken, and reported it as such.

**`main` was fine.** `Lifetime` appears nowhere in HEAD. `web/src/app/Lifetime.ts`
was an **untracked file** belonging to another lane that had **22 modified and 5
new files in flight** for a mid-refactor that did not boot yet and was never
meant to.

Nobody was at fault. A refactor is unbootable in the middle by nature, and the
lane that found it drew the only conclusion its evidence supported.

**The rule: measure in `git archive HEAD` plus your own files, on your own
port.** Never against the shared working tree.

Two distinct things go wrong without it, and the second is worse:

- **You measure somebody else's half-finished work** and attribute it to yours,
  or to `main`.
- **A green result is not yours either.** Passing in a tree that contains another
  lane's uncommitted fixes proves nothing about what you are about to commit.

Corollary for the lane doing the refactoring: **commit in bootable slices where
you can**, because to everyone else an unbootable working copy is
indistinguishable from a broken `main`. Where a seam genuinely cannot boot until
all of it lands, say so out loud, so the other lanes stop trusting the tree
deliberately rather than discovering it one error at a time.

That makes five shared surfaces in this checkout: **the wasm blob, the git index,
the working tree, numbered decisions, and controller files.** All five failed at
least once. Only the wasm blob fails loudly.

### Path-limited commits cannot separate two lanes editing the SAME file

Every rule above protects against sweeping in **unrelated** files. None of them
helps when the collision is **inside one file**, because path-limiting operates
at file granularity and interleaved edits are finer than that.

On 2026-08-03 the rendering lane needed `web/src/app/Boot.ts` in order to commit
a shader change, since `Boot.ts` was that shader's only caller. The core-engine
lane's world-lifecycle refactor was **interleaved in the same file**, along with
`Services.ts`. The rendering lane could not exclude those hunks and still leave a
tree that compiled, **so it committed both under its own message and said so
plainly in its report.**

**Its reasoning was sound and its outcome was inverted.** It committed the
*callers* without the *new modules*, believing that was the option that kept
HEAD compiling. HEAD then imported `Lifetime.ts`, `WorldSession.ts` and
`HandleLedger.ts`, **none of which were in HEAD**. Main did not compile for
exactly one commit, until the core-engine lane landed those files.

**Nothing was lost. Two files are attributed to the wrong lane forever.**

**The failure is Admin's to prevent, not the lane's to solve.** A lane that
discovers this at commit time has only bad options: commit both and misattribute,
or decline and block. By then it is too late.

**The rule.** Wiring files that nearly every feature must touch (`Boot.ts`,
`Services.ts`, `main.ts`, and the equivalent in any codebase) are **predictable
collision points**. Before briefing two lanes, ask which files both will have to
edit. Where the answer is a shared wiring file, either **serialise the lanes**,
exactly as binary assets are serialised, or **name one lane the sole writer** of
that file and have the other publish what it needs wired.

The general form: **the granularity of your isolation mechanism sets the
granularity of the conflicts it can prevent.** File paths cannot protect a file.

**And the corollary, learned the same way:** committing half of an interleaved
change produces the broken state you were trying to avoid. If the two halves
cannot be separated, they cannot be committed separately either. Stop and
escalate rather than choosing which half to ship.

### A sentence in a comment is not an invariant

An asset file asserted, in prose, that a cuff's first ring inradius swallows the
skin band's circumradius. **It was true when it was written.** Months later a
change to a neighbouring proportion broke it, and **the bare wrist burst out of
the cuff as an orange collar.** One line below, knuckle plates sat at a typed
`z` tuned against the old palm thickness; against the new palm they would have
**floated 15 mm above it**.

**Two latent traps, both armed by a change that had nothing to do with either,
both documented in prose, neither checked by anything.** The render caught the
first immediately. Nothing would have caught the second.

The same file had already produced a second instance of the same thing that
morning: a docstring justifying two LOD thresholds with the numbers 52 mm and
163 mm, where the measured values are **139.87 mm and 278.37 mm**. **A comment
that justifies a number is a number nobody is checking**, and the next person
reasons from it.

**The rule.** When you write down a relationship between two authored values,
either **derive one from the other** or **assert it in the build**. Prose is for
the reason, never for the constraint. A relationship that matters enough to
explain matters enough to fail.

The tell that you are about to do this: any comment containing "so that",
"which means", "hence", or a number that appears nowhere in the code beneath it.

### Measure the authored table, not the picture

The same pass found that a hand's five finger tubes were **one fused solid**.
Two circles are separate only when their centres are further apart than the
**sum** of their radii, and every adjacent pair overlapped: 12.0 mm, 18.5 mm,
16.0 mm. **The hand could not show a gap between two fingers at any pose, from
any camera, under any lighting.**

An earlier pass had looked at the same complaint and fixed the colour, the
distance and the finger *count*. All three were real defects. **The section was
the mitten**: a palm authored 130 x 86 mm at 1.5:1 against a real hand's roughly
90 x 28 at 3.2:1, with 43 mm fingers against a real 18 to 20.

**A frame shows you a symptom and every plausible cause for that symptom is
wrong.** The webbing looked like missing detail and was tube intersection. The
mitten looked like a modelling style and was two numbers in a table.

**When an art complaint survives a pass that addressed it, stop looking at the
render and go read the numbers the asset was built from.**

### Put the re-apply of a negative control in a `finally`

A negative control means deliberately reverting your fix, rebuilding, proving the
defect returns, and then putting the fix back. **The middle of that procedure is
a tree containing a known defect on purpose.**

If the process dies there, is interrupted, or the lane runs out of context, **the
deliberate defect is what is left in the working tree**, and it looks exactly
like ordinary in-progress work to whoever finds it.

**Make revert and re-apply one process with the re-apply in a `finally`**, so no
interruption can leave the reverted state behind. An asset lane did this
unprompted tonight while proving a palette change, and it is the right shape for
every negative control anyone runs here.

The general form: **any procedure whose intermediate state is a lie must not
have an exit that stops in the middle.**

### A build and a test in one shell line will report the PREVIOUS build's verdict

Twice in one night a build failed, **the stale binary from the previous build ran,
and the suite reported green.** Once it nearly recorded a false negative control,
which is the worst possible place for it: the whole point of that procedure is
that the reverted code must fail, and a stale binary makes it pass.

`INSTRUMENTS.md` already says **a tool that reports nothing may not be running.**
This is the sharper form: **a tool that reports something may be reporting on
code that no longer exists.**

`make && ./tests` is safe. `make; ./tests` is not, and neither is any pipeline
where the test output is what gets read and the compiler output scrolls past.
**Grep the compiler output separately from the test output**, or fail the whole
line on a non-zero build status. It costs one line.

The general form, and it is the same shape as the empty commit and the stale
index: **when two steps share a workspace, the second one cannot tell you whether
the first one happened.** Ask the first step directly.

### A control that fails to go red is a finding, not a nuisance

A lane wrote a gate asserting a rig's humerus-to-forearm ratio, then tried to
prove it by setting the constant back to the shipped, defective value.

**The build went green.**

The elbow position is **derived** from that ratio, so moving the ratio moves both
sides of the equality. **The gate structurally could not see the case it was
written for.** It was only ever guarding a *typed* elbow, and the elbow had
stopped being typed in the same commit that added the gate.

**And the case it could not see was the exact one it existed to prevent.** Admin
had predicted in writing that a future lane would set that target to the view
model's 1.06 by mistake. The equality would have waved it through.

**The gap was found by a control failing, not by a gate passing.** Every green in
that build was truthful and the check was worthless.

The fix was to give the target its own **plausibility band** (1.15 to 1.40, with
1.06 deliberately outside it and named in the message), which is a claim about
the value rather than a relationship between two values that move together.

**Two rules.**

**When a negative control does not go red, do not adjust the control until it
does. Ask first whether the gate can see that class of change at all.** A control
that has to be tuned to fail is telling you something about the gate.

**And beware asserting a relationship between quantities that are derived from
each other.** `assert(a == f(b))` proves nothing when `b` was computed from `a`.
The identity holds by construction, at every value, including every wrong one.

### Gate the complaint, not a proxy for it

The same pass had to protect a first-person rig from a "correction" that would
reopen a closed complaint. The obvious gate is the hand's distance from the eye,
which is the number two previous passes fought over.

**The lane gated the complaint instead**: one glove's share of the visible frame
height at the shipped 60 degree FOV, which is what the user actually objected to.

| state | visible frame | one glove |
|---|---|---|
| shipped | 0.7159 m | **13.4%** |
| old distance restored | 0.5023 m | **19.1%** |
| old distance **and** the old section | 0.5023 m | **25.9%** |

A band at one sixth sits between 13.4 and 19.1, **so it refuses the regression
without needing the old section restored as well.** A distance gate would have
passed anything that kept the distance while making the hand huge; this one
cannot.

**Where a complaint can be expressed as a measurement, gate that measurement.**
A proxy is only as good as the assumption connecting it to the thing anyone
cares about, and that assumption is rarely written down.

### A finding that a later entry fixes must say so where the finding is

Admin briefed a lane on GP-146, a recorded defect marked "RECORDED, NOT FIXED":
`of_vs_remove` takes the subtree further from the root, so which half of an
identical rocket a delete destroys depends on which part was placed first.

**It had been fixed two entries later by GP-148**, which normalised the root to
the top of the stack. Nothing in GP-146 pointed forward. The lane discovered it
by **re-running the probe at HEAD rather than trusting the record**, and found
green.

**The decision log is now over 300 entries deep.** A reader who lands on a
finding has no way to know the story continued, and the cost falls on whoever
routes work from it. **That is one wasted round trip and it will not be the
last.**

**The rule: when an entry closes an earlier finding, edit the earlier finding to
point forward.** Backward references are free and useless; a later entry naming
an earlier one is only visible to somebody already reading the later one.

**And the corollary the same lane supplied:** those delete assertions were
**inverted in place** when GP-148 landed. **A probe edited to expect the opposite
result is exactly the artefact you cannot take on trust**, because a claim
inverted once can be inverted wrongly. Re-run, do not read.

### The fixture that must differ from the default will never test the default

An end-to-end playthrough found that **the very first autopilot press a player
ever makes did nothing and reported success.**

The requested-orbit field defaults to 100 km. The teleport-to-orbit cheat puts a
player at 100 km. **So the default destination is the orbit you are already in.**
The solver correctly returned a valid programme of **zero burns**, the executor
correctly completed it instantly, and the screen correctly said the programme was
complete.

**Nothing was wrong anywhere.** Every component behaved to specification. **The
identity element was standing in the player's path and each part was right while
it did.**

**No test caught it, and the reason is the rule.** Every autopilot probe written
that night **moves the altitude first, on purpose, so that there is something to
measure.** A zero-burn programme is useless as a fixture: you cannot assert a
delta-v, a burn count or an arrival against it. So every test author,
independently and for a good reason, **excluded the exact case a player meets
first.**

**The rule: a fixture that must differ from the default in order to measure
anything will never test the default.** And defaults are what a new player, a
new caller and a fresh install all encounter before anything else.

The general form: **identity cases are invisible to differential testing.** Zero
burns, an empty list, a no-op edit, a destination equal to the origin, a rename to
the same name. Each is a case where the correct behaviour is *nothing*, which is
also what a broken implementation does.

**Test them explicitly and assert on the report rather than on the change.** Here
the fix was measured on both sides: 0 burns at 100 km, 2 burns and 207.31 m/s at
250 km. The first half of that pair is the one nobody writes.

Related and distinct from **a fixture that never performs the action cannot
exhibit a defect in the action**: that one is about the fixture not doing enough,
this one is about the fixture being unable to do nothing.

### A metric that is flat in its own independent variable is not measuring that variable

A lane swept a rotation strength and watched two numbers. Local anisotropy fell
monotonically, as expected. **The between-window orientation spread saturated at
37 to 38 degrees from the very smallest swing onward and never moved again.**

They read that as "0.4 is the efficient point". **The correct reading is that the
spread was not responding to the thing being swept at all**, and a quantity that
does not respond to its own independent variable is not measuring it.

**Only looking at the picture caught it.** The image was a field of concentric
fingerprint whorls, visibly far worse than the artefact it was meant to fix.

**When a sweep produces a number that is flat across the range, do not read off an
optimum. Ask what that number is actually a function of.** Saturation from the
first step is the signature.

### A second side removes one class of false pass and guarantees nothing else

The same instrument was **deliberately built two-sided** to dodge a trap already
recorded here: a single whole-frame anisotropy number would fall both when the
artefact was fixed and when the signal was destroyed. So the claim became **each
local window is still a corduroy, AND the windows disagree with each other**, and
it was validated first on synthetics through the identical code (0.9894 for a pure
corduroy with orientation exact, 0.0462 for white noise, 0.1743 for isotropic
blobs).

**It passed the fingerprint at every setting.** Local coherence went *up*, 0.5214
to 0.7147. Spread went up, 16.97 to 37.76 degrees. **Both halves were true
statements about the image, and the image was wrong.**

**Concentric contours are locally near-parallel and turn with position, so a
fingerprint satisfies both sides by construction.** The missing property was
**local wavelength**, and nothing in the claim mentioned frequency.

**The rule: adding a side removes one class of false pass. It says nothing about
the classes you have not enumerated.** Two-sided is better than one-sided and is
not a proof. **Name what a passing image could still be** before trusting a green,
and write that list in the instrument's own header so the next reader cannot
trust it naively.

### A gate that constrains the thing it measures has become a design

`_relief_ripple` caps how far it warps its wave vector, specifically so the vector
**never flips sign**, because a sign flip would break the skew asymmetry that the
generator's own selftest measures.

**The test is not wrong and the cap is not careless.** Together they are the
reason the ground ripple has **no orientation freedom anywhere on the planet**,
which is the artefact Reid has complained about repeatedly.

**A gate is supposed to observe the work. When the work is shaped to keep the gate
green, the gate has quietly become a specification** and nobody decided that it
should be one. The tell is a constraint in the generator whose stated purpose is
to protect a measurement rather than to serve the output.

### In an `&&`-chained aggregate, where you put a gate decides whether it IS a gate

A lane added a new check to `npm run check`. **`check` is an `&&` chain, and one
of its existing links has been red for everybody for some time** (29 files over a
line-count cap, nobody's fault, nobody's tonight).

**A gate appended to the end of that chain would never have executed a single
line**, while its own commit message truthfully said it had been added to the
aggregate check. It would have read as covered and been dead from the day it
landed.

They placed it **before** the failing link and **verified rather than reasoned**:
`npm run check` prints `posecheck: PASS (9 checks)` and *then* goes red further
down, in that order.

**The rule: adding a gate to a chain is not the same as running it.** Check what
is upstream of your link and whether any of it is currently failing. **A
long-broken link converts everything after it into decoration**, and the decay is
silent because each new gate's author verifies their gate in isolation.

Corollary, and it is why the situation persists: **a permanently red aggregate
trains everyone to stop reading it**, which is what makes the next dead gate
invisible. Fix the red link or split the chain; do not add to a chain nobody
runs.

### A wrong number that changes nothing is the one no process catches

Admin wrote an orbital speed of 7.6 km/s into the authoritative decision log. It
came from a domain report, it was repeated in a source file and in two risk
entries, and **it is 4.05x out**: the real figure is 1879.26 m/s. 7.5 km/s is
Earth's low orbit, and this planet's mu is 3.5316e12.

**Every conclusion drawn from it was correct.** The argument it supported (that
two representations of one object disagreed, and that the disagreement was large)
holds at either value. **So no reader ever had a reason to check it**, and it
survived three independent transcriptions.

`NUMBERS.md` already says **an implausible magnitude is an instrument bug until
proven otherwise**. This is the complement: **a plausible magnitude in a
load-bearing document is checked by nobody, precisely because nothing it touches
comes out wrong.**

**Quantities that decorate an argument rather than drive it are the ones to
verify**, because the argument will never do it for you. When a number is quoted
to justify a decision, ask whether the decision would change if the number were
half or double. **If the answer is no, that number has no defender.**
