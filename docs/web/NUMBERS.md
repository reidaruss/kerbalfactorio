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
built, measured, committed, and **invisible to the player** — the probes that
proved them all passed an explicit flag, so nothing ever exercised the default.

**A flag's DEFAULT is a fixture and must be asserted as one.** If a probe only
ever runs the feature with `?feature=1`, it proves the feature works and proves
nothing about whether anyone sees it. Assert the boot default in its own check,
red-by-name when the default is wrong.
