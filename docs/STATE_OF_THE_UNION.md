# State of the Union

**Written 2026-08-03 by the Admin session that ran the parallel-lane experiment.
This file exists so a fresh Claude Code session can pick the project up cold and
run it under the architecture in §6 without relearning anything expensive.**

Read this file, then `CLAUDE.md`, then `story_line_outline_v1.txt`, then
`docs/web/NUMBERS.md`. Everything else is reachable from those.

---

## 1. Where everything is, as of the move

| | |
|---|---|
| **Project root** | `D:\karbalfactorio` |
| **Remote** | `https://github.com/reidaruss/kerbalfactorio.git`, branch `main` |
| **Previous root** | `C:\Users\reida\Nextcloud\Kerbal Factorio` **(retired, do not use)** |
| **`.git` backup** | `D:\_backup_kerbalfactorio_git_2026-08-03` (pre-rewrite, 3.6 GB) |
| **Reid's play server** | `http://127.0.0.1:4200`, served from `D:\karbalfactorio\web` |

**The project left Nextcloud on 2026-08-03 and the reason matters.** A sync
client was watching `.git` while up to six agent lanes wrote to it concurrently
using low-level plumbing, which is a real corruption risk. Directory scans timed
out at three minutes. The drive filled and truncated a source file to zero bytes
mid-write. **Nothing in this project should ever live in a sync folder again.**
Git plus the remote is the backup.

**History was rewritten in the same move.** `ue/`, the abandoned Unreal attempt,
was stripped from all 778 commits along with 132 pre-fortnight screenshots;
743 commits remain. The blanket `*.png filter=lfs` rule was retired, because it
was written for Unreal and had been quietly billing every screenshot a lane
produced: 1,169 of them had reached 941 MB against GitHub's 1 GB free LFS
allowance, 773 MB of it in one fortnight. Existing screenshots stay as pointers
(813 MB, inside the allowance); new ones are ordinary blobs.

### Running it

```bash
cd D:/karbalfactorio/web && npm ci          # once
./wasm/build.ps1                            # PowerShell; -SkipNative to skip the parity generator
npm run sync-assets && npm run sync-wasm && npm run build
npx vite preview --port 4200 --strictPort --host 127.0.0.1
```

`emsdk` is expected at `C:\Users\reida\emsdk`. `node_modules` was deliberately
not copied in the move; `npm ci` rebuilds it.

---

## 2. What the game is

**Orbital Foundry.** KSP's *mechanics* fused with Factorio's automation, in a
browser: a Three.js client over a C++ `/core` compiled to WebAssembly, with a
flat C ABI shim. **KSP was never an art reference**, which was discovered late
and expensively; see `docs/web/ART-DIRECTION.md`.

Two worlds exist: **Forge** (600 km, atmosphere) and **Cinder** (200 km, airless
moon). One planet, one moon, seamless surface-to-orbit, floating origin, patched
conics.

---

## 3. What actually works right now

A player can spawn in a forest, gather, craft, mine, smelt, build a belt-fed
factory, research, build a rocket in the VAB **and revise it afterwards**, walk
to it, launch, reach orbit, open a 3D map, and fly under autopilot to either the
space station or the moon. Land on the moon. Teleport into the station and walk
around inside it. Return.

Landed and measured in the last week specifically:

- **The moon**, from a C++ constant to nine crater scales down to 1.8 m, drawn
  in the sky at 1.91 degrees, flyable, landable.
- **Autopilot**: hold-orbit to **5.8 m** on an 800 km semi-major axis; rendezvous
  ending **108.87 m out at 0.23133 m/s**; a full moon mission with injection,
  mid-course correction, SOI handoff and capture at **e 0.000729**.
- **Departure-timing charts** for both destinations, 64 samples, refusals drawn
  as gaps.
- **Landing** at 1.0 m/s vertical on measured slopes; **airless ascent**;
  **docking capture and an auto-approach** (`/core` only, no player button).
- **RCS translation** on the numpad; the full navball readout set.
- **Sandbox tells the truth** across the build menu, craft column and research.
- The station **orbits** (on a branch, see §4).

---

## 4. What is blocked, and the exact shape of each block

### 4a. Reid's first mission is not flyable. Three links, two done.

His storyline gates the autopilot behind **docking with the station**, so the
first orbital mission is **hand flown on purpose**. Flown by hand at HEAD it
missed by **1,228,348 m** against a 0.60 m capture radius, because **Anchorage
moves 0 m while publishing 1879.255 m/s**: matching a fixed point means killing
1879 m/s and `docking.h` refuses above 2.0 m/s. Impossible, not hard.

1. **DONE.** The carrier frame (`79630e9`). Deck and rider agree to **1.7e-9 m**
   over 600 ticks at 542 m/s.
2. **ON A BRANCH, MEASURED, NOT MERGED.** `ph357-station-stamp` (`72d9f88`).
   The station moves at exactly the predicted rate, `frozen` goes false, the
   navball target block starts telling the truth, and the rendezvous is
   bit-identical through the burn.
3. **NOT STARTED, AND IT IS THE ONE REAL GAP.** With the record stamped, a
   player who arrives on the deck is **left behind within six ticks with no
   floor**: 188 m at +0.1 s, 3,476 m at +1.0 s. `of.carrier('census').ride`
   reads `boards: 0`. `CarrierRide` is constructed at `Boot.ts:300` and **never
   given a carrier by any shipped path**. *The mount got its consumer; the rider
   did not.* Core-engine's.

Also open on this path: **R93**, `of_fl_dock_*` has no client caller and needs
`of_dk_port_at` so the world pose comes from `docking::portAt` rather than a
TypeScript copy. **R97**, warp is flight-local, so a warped rendezvous
desynchronises; the predicted ratio near 1000 is **unverified** because the
measurement crashed the tab on one build and ran 13 minutes without finishing on
the other. **R98**, a rails record's clock does not survive a save.

### 4b. The test harness cannot report a failure

**284 probes. Zero of them can fail the harness.** `run.mjs` decides its exit
code from console errors and failed requests only; a probe returning
`fails: ['DELIBERATE FAILURE']` prints `smoke: PASS` and exits 0. Confirmed by
negative control against an isolated build.

A partial sweep, 18 of 189 runnable probes and **alphabetically biased so it is
not a rate**, found four genuinely red and silently passing. The sharpest is
`apexec.js`: *"asked r 800000.0 m, reached 749987.1 m, out by -50012.9 m"* and
*"planned 144.9070, spent 73.6634"*. **An autopilot 50 km short having spent
half its planned delta-v, reported by a probe that exits 0.**

`web/tools/smoke/probeall.mjs` exists, is inert, and nothing invokes it. The
full sweep is 60 to 70 minutes at two shards. **Do the sweep before the gate.**

Related: `npm run check` is an `&&` chain whose `check:limits` link went red
**407 commits ago**, eleven commits after `check:boot` was added. **The only
gate that proves the app starts ran for eleven commits and has been decoration
ever since.** 40 files are over the 400-line cap.

### 4c. The storyline's motivating spine does not exist

`story_line_outline_v1.txt` is the plan of record. Everything orbital is
downstream of walking into a ruin. **Ruin placement exists** (`core/include/of/poi.h`,
one ruin 753.8 m from spawn, a 2.7 minute walk, plus a `SiteCatalog` seam).
**The scanning antenna, the reveal, both antenna upgrades, the solar-system map,
the mysterious signal and the mobile scanning module do not.** Nor do loose
stones on the ground, which are the second rung of the chain and which make the
pickaxe gate legal (gating ore behind a pickaxe alone **deadlocks a fresh
spawn**, because the pickaxe recipe needs raw iron).

The ruin needs a mesh: 18 m footprint, a plinth absorbing 2.3 m at the rim, 6 to
12 m tall, enterable, `col_Ruin1..N` with **no underscore before the digit**,
`Ruin_LOD0/1/2`.

### 4d. Art: the light is fine, the paint is not, and one colour-space bug dominates

`surfaces.json` publishes `albedo_mean` in the **sRGB domain** and
`Surfaces.apply` divides it out in **linear** working space. The compensation
**under-compensates by 2.13x on machine panel and 2.36x on rock**, the two
families a player looks at most. Confirmed: disabling the map lifts a machine
box median **12.44 to 28.21, +127% against +113% predicted**.

**The whole game has been running roughly half as bright as intended on every
textured surface.** The fix is one line in either `texgen.py` or `Surfaces.ts`
and it **doubles the brightness of every textured asset**, all of which have had
their values judged by eye under the wrong factor. **Reid has seen the picture
and has not answered yet.** Two recorded conclusions (RN-1252's arithmetic,
RN-347's "no-op by construction") are false because of it and now say so.

Also open: `?ao=0` is worth **+24.9%** on a machine wall and machines are
occluded three times, one of which is a texture's baked AO wrapped around
geometry it was never authored for. Retuning needs a machine-lit arm of
`lookdev.js` first.

---

## 5. The todo list

**Ordered by what unblocks the most.**

1. **Board the rider onto the carrier** (§4a.3), then merge `ph357-station-stamp`.
   Unblocks the first mission, docking, and standing on anything that moves.
2. **Run the full probe sweep, then gate `run.mjs`** (§4b). Until this lands,
   "green" means nothing anywhere in the project.
3. **Answer the albedo question** (§4d), then the machine palette pass, which is
   already unblocked and waiting.
4. **The scanning spine** (§4c): antenna, reveal, ruin contents, antenna upgrade.
5. **Loose stones and the pickaxe gate**, one design, not two.
6. **Wire docking to a button** (R93) once the station moves.
7. **The moon's departure chart** is drawn; the moon's **arrival** still has no
   closest-approach readout anywhere in the game.

**Standing quality-of-life list**, driven and evidenced, in
`docs/controllers/gameplay.md` GP-550 onward: the debug HUD is on by default and
covers the left third of every frame; there is **no pause**; the build menu shuts
after every pick; you cannot place at a distance; **no belt direction cue exists
anywhere**; 0 of 15 build-menu tiles say what anything does and **5 of 11 hotbar
slots are unnameable by any route**; developer strings reach the player
(`of_vs_total_dv_vacuum` in the VAB, raw glTF socket names in the build prompt,
`Q16` and `65536` in the power panel).

**Older open items** live as Admin tasks and in the controller files: combat has
no place in the world yet (Reid: enemies enter at or on the way to the ruins),
water overhaul, the VAB's remaining snapping work, terrain fidelity, the FOV
mismatch (client renders 60, every doc says 70), and the electricity tier, which
sits inside the pre-alpha line and is an entire factory tier on its own.

---

## 6. The architecture, and why it is changing

### What was run, and what it cost

One Admin session orchestrated up to **six concurrent domain lanes**, each a
subagent with a controller file. **The work output was excellent.** The
orchestration had two failure modes and both are structural rather than
incidental.

**Failure one: the orchestrator did implementation.** It ran builds, freezes,
smoke suites, browser probes and git surgery. That work is what consumed the
session: reading long reports and running heavy tooling in the same context that
was supposed to be making decisions. It also caused the only two incidents that
reached Reid directly, both of which were the orchestrator or a lane running
heavy tooling while he was playing.

**Failure two: shared surfaces that fail silently.** Five were found. Only one of
them fails loudly.

### The five shared surfaces

| surface | how it fails | mitigation that worked |
|---|---|---|
| **the wasm blob** | unmergeable; second committer silently reverts the first, and it looks green because the binary parses and only exports are missing | nobody commits it; one settled rebuild by a single owner |
| **the git index** | a concurrent reset between `add` and `write-tree` produced a **commit containing zero files** with a full message; and a private index leaves the shared one holding a **revert** | private `GIT_INDEX_FILE`, whole sequence in one shell invocation, then reset your own paths |
| **the working tree** | a lane measured another lane's half-finished refactor and reported main broken | measure in `git archive HEAD` plus your own files |
| **numbered decisions** | two lanes append to one numbered list and collide | Admin allocates disjoint blocks **in the brief and in the ledger** |
| **controller files** | two lanes append to one doc | one lane per domain, or report to Admin instead |

**A sixth appeared when a lane was killed mid-pass:** its uncommitted files sat
in the tree **indistinguishable from another lane's live edits**, carrying
decision numbers the ledger had never seen. Cost the next lane an hour of
forensics.

### The single most expensive defect class

**Two authorities for one quantity.** Six instances in one week: the station
existing as both a moving record and a frozen structure; two inclination
conventions, nearly a third; the moon held still in one file and moving in
another; a throttle gauge reading the player's own input instead of the engine;
**four separate tables of what the worlds are called**; and machine materials
built from two literals that had never heard of the per-part channel every other
batch used.

Every one ran cleanly and looked plausible. **Ask, of any quantity: who owns
this, and is anyone else computing it?**

### Instrument failures dominate

Roughly **twenty harness defects were found in a week, against effectively none
in the systems being measured.** That ratio is the finding. The catalogue is in
`docs/web/NUMBERS.md` and `docs/web/INSTRUMENTS.md` and it is the most valuable
asset this project has. The ones that recur:

- **A probe that prints and never asserts passes forever.**
- **A control that will not go red is a finding**, not a nuisance.
- **A control whose arming step silently fails is indistinguishable from a
  passing control.**
- **A fixture that cannot perform the action cannot exhibit a defect in it**, and
  **a fixture that must differ from the default will never test the default** (the
  first autopilot press a player ever made did nothing and reported success).
- **Measure the authored table, not the picture.**
- **An implausible magnitude is an instrument bug; a plausible one in a
  load-bearing document is checked by nobody**, because nothing it touches comes
  out wrong.
- **A count that happens to equal a total reads as success.**

### The behaviour that produced the most value

**Lanes correcting the brief.** Repeatedly, the highest-value output of a lane
was discovering that the premise it had been handed was wrong: that the
terrain bounce *does* reach machines; that the ascent schedule should not be
shared between bodies; that a textbook arm length was unreachable inside the
published height; that the wall's darkness was albedo rather than metalness.

**This must be invited explicitly in every brief**, because a lane that treats
the brief as ground truth produces confident wrong work.

---

## 7. The proposed architecture

**Rule zero: the top-level session does not implement.** It may read files, read
git history and read reports. It does not edit code, run builds, run probes,
drive a browser, or commit anything except its own decision records.

### Roles

| role | model | does |
|---|---|---|
| **Orchestrator** (top session) | Opus | reads reports, makes rulings, routes findings, allocates number blocks, sequences conflicting lanes, talks to Reid. **Writes only `docs/` decision records.** |
| **Domain lane** | Opus | anything whose first job is to *diagnose*, anything cross-domain, anything where the premise might be wrong |
| **Task lane** | Sonnet | a named defect with a stated cause; wiring a published export to a UI; running an existing harness; asset re-authoring against a written spec; doc consolidation |
| **Release lane** | Sonnet | the settled rebuild, the freeze to 4200, the smoke run. **The only lane that commits `web/wasm/dist/*` and `expected.json`.** |

**Choosing the model.** Sonnet when the brief can state *what* to do and the
answer is not in doubt. Opus when the brief can only state *what to find out*.
If a brief contains the words "measure whether", "decide the shape", or "the
premise may be wrong", it is Opus. If it contains a file path and a defect
description, it is Sonnet.

### Concurrency rules

- **At most four lanes.** Six was past the point where the orchestrator could
  read reports faster than they arrived.
- **One lane per decision-number prefix**, and the block goes in the brief **and**
  in `docs/web/NUMBERS.md` before the lane starts.
- **Declare file ownership in the brief.** Shared wiring files (`Boot.ts`,
  `Services.ts`, `run.mjs`, `package.json`) have **one named writer** per session
  and everyone else publishes a request.
- **Zero lanes while Reid is playing.** Not reduced. Zero browser, zero renders,
  zero builds. He will say when.
- **Wind down, never kill.** A stopped lane commits or explicitly names what is
  unlanded.

### Every brief must contain

1. The **goal**, and Reid's own words where they exist.
2. **What already exists**, with numbers, so the lane does not rebuild it.
3. **The premise, explicitly marked as a premise**, with an instruction to
   measure it and report if it is wrong.
4. **The decision-number block.**
5. **File ownership**: what is yours, what is another lane's, what to publish
   instead of reaching.
6. **The commit protocol** (private index, one invocation, tree differs from
   base, three-argument `update-ref`, `show --stat`, reset your paths).
7. **The measurement standard**, and the two or three catalogued traps most
   likely to bite this particular job.
8. **The stop rule**: what to do when Reid starts playing.

### Every report must contain

1. What **landed**, with commit SHAs.
2. What was **measured**, with the control beside it.
3. What was **refused**, and why.
4. What is **half-done**, named rather than left in the tree.
5. What belongs to **another domain**.
6. **Exports or counts changed**, so the Release lane can verify without reading
   the diff.

---

## 8. Rules that must not be relearned

- **Nobody commits the wasm blob but the Release lane.**
- **`git commit -- <paths>` does not commit what you staged.** It commits the
  working tree and discards your index.
- **A literal `HEAD` in `update-ref` re-resolves at call time**, so the guard is
  vacuous. Capture `BASE` once into a variable.
- **A `finally`'s `cwd` is part of its revert**, and a trap that restores through
  a relative path is not a restore.
- **A build and a test in one shell line report the previous build's verdict if
  the build fails.**
- **In an `&&` chain, where you put a gate decides whether it is a gate.**
- **A finding that a later entry fixes must point forward from the finding**, or
  the next reader routes work that is already done.
- **A finding with no owner ships forever.** Three station defects sat marked
  "for the Blender lane" while no Blender lane existed, and Reid then walked
  through a wall.
- **Kill processes by command line, never by image name.** A lane ran
  `taskkill /F /IM chrome.exe /T` and took Reid's browser with it.
- **Read a gate's verdict token, not its tail.**
</content>
