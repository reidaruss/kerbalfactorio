# State of the Union

**Written 2026-08-03 by the Admin session that ran the parallel-lane experiment.
This file exists so a fresh Claude Code session can pick the project up cold and
run it under the architecture in §7 without relearning anything expensive.**

**§7 is the one Reid chose, on 2026-08-03: graph engineering. If you read only one
section before starting work, read that one, then §7.4 before you fan anything
out.**

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
allowance, 773 MB of it in one fortnight.

**Where storage actually landed, including one unintended consequence.**
Retiring that rule and then re-adding `docs/` rewrote every screenshot at HEAD as
an ordinary git blob. That was **not** planned in that step, and it is the end
state the plan wanted anyway: **LFS at HEAD fell from 1,065 files to 30.** The
cost is that the remote now holds both, roughly **791 MB of git objects plus
860 MB of LFS left over from history.** It is inside the free allowance and new
screenshots no longer touch LFS, so it stops growing. **A third history rewrite
to reclaim the orphaned LFS was judged not worth the risk.** If the quota ever
matters, `git lfs migrate export --include="*.png,*.jpg" --everything` is the
move, and it grows the object store by roughly what it frees.

**The general lesson, and it is the one this project keeps relearning:** changing
a `.gitattributes` filter changes what `git add` *means* for every file it
matched. The rule change and the next `add -A` are one operation, not two.

### Running it

```bash
cd D:/karbalfactorio/web && npm ci          # once
./wasm/build.ps1                            # PowerShell; -SkipNative to skip the parity generator
npm run sync-assets && npm run sync-wasm && npm run build
npx vite preview --port 4200 --strictPort --host 127.0.0.1
```

`emsdk` is expected at `C:\Users\reida\emsdk`. `node_modules` was deliberately
not copied in the move; `npm ci` rebuilds it.

### Where development runs: Reid's Proxmox cluster, decided 2026-08-03

**Development moves off Reid's desktop and onto a Proxmox VM. The game keeps
rendering on his machine.**

**No GPU is required and that is a measured fact, not an assumption.** The
headless browser harness already runs `--enable-unsafe-swiftshader`, which is
software rasterisation on the CPU, and every Blender render this project has
produced was Cycles on CPU. A rendering lane recorded that **frame cost through
SwiftShader is not measurable**, because the current build's own run-to-run
spread is wider than the difference between builds. So a GPU-less node costs
nothing that is currently being measured.

**The split, and it is the whole point:**

- **On the VM:** Claude Code itself, every lane, `emcc`, `g++`, `ctest`, Blender,
  every headless Chrome probe, and the served build.
- **On Reid's machine:** his browser, pointed at the VM over the LAN. **The game
  renders on his 4060 Ti.** His CPU stays free and his disk is not the constraint.

**Sizing, as provisioned by Reid on 2026-08-03: 16 cores, 48 GB RAM, 300 GB
disk.** The workload is largely parallel: several lanes, each capable of running
a headless Chrome with the frame limiter disabled, plus Cycles renders. The disk
matters: this project hit **64 MB free** and truncated a source file to zero
bytes mid-write, and lanes create isolated `git archive` scratch trees
constantly. 300 GB also leaves room for four git worktrees (§7.4) at roughly 5 GB
each.

**16 cores is the real constraint on how wide a fan-out can be, and it is not the
same number as the agent cap.** A headless Chrome probe on software rasterisation
will take every core it is given. **§7.4 carries the per-worker concurrency
budget; read it before fanning out anything that renders.**

**One concrete change the next session must make.** Every freeze in this
project's history served with `--host 127.0.0.1`, which is loopback only and
unreachable from Reid's machine once the server lives on a VM. **The Release lane
must bind to the LAN instead** and give Reid the VM's address.

**What this changes about the rules.** The "stop everything while Reid is
playing" rule existed because lanes and his game competed for one CPU: a headless
browser at unlimited framerate pegged every core and his mouse stopped behaving,
and separately a lane ran `taskkill /F /IM chrome.exe` and closed his browser.
**Both failure modes become impossible.** What survives is narrower and still
real: **do not rebuild, restart or re-freeze the served build while he is
playing**, because that is now the thing he is connected to. Lanes may build,
test and render freely.

**What this does not change.** The harness still cannot measure frame cost, so
**Reid actually playing on real hardware remains the only genuine performance
signal this project has.** Treat a report of fps from a probe as a liveness check
and nothing more.

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

> **THREE SHAS IN THIS SECTION WERE DEAD AND ARE NOW REPLACED (2026-08-11,
> CE-44).** `79630e9`, `72d9f88` and (in core-engine.md §5e) `870f3e4` do not
> resolve in this repository: they were rewritten out on 2026-08-03 when `ue/`
> and 132 screenshots were stripped from every commit. Current refs are named
> inline below. **A SHA in a document that survived a history rewrite is not a
> stale pointer, it is a pointer to nothing, and `git show` says so in one
> second.** Worth a habit: after a rewrite, every SHA in every doc is suspect.

1. **DONE.** The carrier frame (`da710a4`, CE-30 to CE-38) and its first
   consumer, the station's geometry (`2cccbc6`, CE-80 to CE-86). Deck and rider
   agree to **1.7e-9 m over 600 ticks** on a rotor frame carrying Anchorage's own
   **31.320919525472796 m per tick**. (The old text said "at 542 m/s"; that is
   Cinder's orbital speed from CE-30's separate measurement, not this one's.)
2. **NOT ON THIS MACHINE AT ALL, AND THE "MEASURED" CLAIM CANNOT BE CHECKED.**
   `ph357-station-stamp` **does not exist** in the clone at `~/kerbalfactorio`,
   in any worktree, or on `origin` (`git ls-remote --heads origin` returns one
   ref, `main`). Its tip `1e9a899` is not a valid object here; only the stated
   merge-base `4b4fef4` resolves. So the branch was made somewhere that never
   pushed it, it is not backed up by the remote, and **neither the "MEASURED"
   claim in this document nor the "UNMEASURED, PARKED ON A BRANCH" claim in the
   commit subject can be read from here.** Until somebody pushes it, **Anchorage
   still ships frozen** (`mintStation` sets `stampedTick = -1`) and every moving
   measurement in this project is taken on an instrument frame.
3. **DONE 2026-08-11 (CE-39 to CE-43), on `lane/carrier-rider`.** The membership
   predicate, the per-tick board/release decision sited immediately after
   `mounts.syncAt`, and a `visit:station` arrival that seats the player AT REST
   IN THE FRAME instead of at rest in the body frame. `of.carrier('census').ride`
   now reads `boards: 1` after the press. **The old drift figures, restated in
   TICKS because that is the client's only clock:** 6 ticks is 187.93 m and the
   figure labelled "+1.0 s" is 3,476 m, which is **111 ticks, not 60**: at
   31.320919525472796 m per tick, 1.0 s of being left behind is **1,879.26 m**,
   and the label was off by 1.85x. Measured with controls in §5e of
   [core-engine.md](controllers/core-engine.md).

**R97 IS NOT REACHABLE ON FOOT, AND THE GUARD ADMIN ASKED FOR WOULD BE DEAD
CODE (CE-44, 2026-08-11).** "Refuse warp while boarded" was ruled and then
verified rather than built: warp lives on `player/FlightControls.ts` calling
`FlightSession.setWarp`, and `FlightControls` is a field of `VesselObserver`, so
it only samples input while the ACTIVE VIEW SOURCE is a vessel. A boarded rider
is a walker: there is no warp key, no warp cheat, and `sim/DayCycle.ts` states
the rule in as many words ("warp is flight-local by design"). The warp-to-orbit
cheat needs a live flight session too. So there is nothing to refuse until R93
opens dock-then-EVA; the requirement is written into `app/StationMount.ts` at
the seam it will land on. R97's rendezvous half is untouched and still open.

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

1. ~~**Board the rider onto the carrier** (§4a.3)~~ **DONE 2026-08-11, CE-39 to
   CE-43, on `lane/carrier-rider`.** What replaces it: **get
   `ph357-station-stamp` onto a machine that can see it.** It is on no reachable
   ref and on no remote (§4a.2), so "then merge it" is not an instruction
   anybody here can follow. Anchorage stays frozen until it arrives or is
   rebuilt, and while it is frozen every carrier fixture in this project is an
   instrument frame.
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

## 7. The architecture: graph engineering

**Reid chose this on 2026-08-03 after reading Argona's "Graph Engineering" course
(`https://x.com/Argona0x/status/2080626046903157126`, 24 Jul 2026). This section
summarises it, then maps it onto this project. The summary is faithful to the
source; the mapping and the hardware numbers are ours.**

### 7.1 The idea, in the source's terms

Three words carry it:

- A **node** is one unit of work: one agent, one input, one output.
- An **edge** is a dependency: the output of one node is the input of the next.
- A **graph** is the network where independent work runs at once.

**"Your 'do A, then B, then C' is already a graph. Just the saddest one there is,
one edge wide."**

**Step 1, and it is the whole skill.** On every "and then", ask **whether the next
step actually reads the previous step's output.** Yes means a real edge, so keep
the order. No means it was never an edge, so run them at the same time. The
example given is *"summarize this file, and then tell me the weather"*: two boxes,
no arrow, because the weather never reads the summary.

**Step 2.** Tag every seam, keep the real edges, stack the rest side by side. The
longest surviving chain of real edges is the **critical path**, and it is the
fastest the work can ever finish. **Sixteen agents do not shorten it and
sixty-four do not either. To go faster, cut a false edge rather than add an
agent.**

**Step 3, the runnable shape.** Fan out one worker per item, workers sharing no
state; **verify each finding with a separate agent on fresh context that checks a
real signal**, not "did the worker say done"; merge into one report, with
intermediate results living in script variables rather than being fed back as
chat. Rules: **workers never review their own work, the verifier never
implements, start at about twenty items.**

In Claude Code this is the **Workflow** tool: `ultracode:` plus a description makes
Claude draft an orchestrator script, print its phases, and wait for approval;
`/workflows` watches it; pressing `s` saves it to `.claude/workflows/` as a
reusable `/name` command. **Caps are sixteen agents at once and a thousand per
run.** Coordination is free because it is plain code, **but every agent underneath
is billed and a workflow burns more than a normal session.**

**Step 4, the two moves that make it robust.**

**A fresh verifier, because self-grading is measured bias.** The source cites
GPT-4 recognising its own writing 73.5% of the time with that self-recognition
causally driving preference (Panickssery, NeurIPS 2024), and self-scoring inflated
by 10% for GPT-4 and 25% for Claude (Zheng, NeurIPS 2023). **We have not verified
those citations.** The rule: the verifier is an outsider that never touched the
work and checks a real signal; for subjective calls, a jury of three models from
different families. *"A graph of agents on one shared context is just one loop
with extra steps, agreeing with itself."*

**Isolation, because parallel agents in one checkout clobber each other.** Freeze
into every worker: **never `git stash`, never `git reset`, no git command except
committing a specific file, no slow commands before the test phase.** Then shard
across git worktrees, grouped, so four worktrees of sixteen replaces sixty-four
checkouts.

**Step 5, Amdahl's law, and check it before deploying.**

```
S = 1 / ((1 − p) + p/N)      p = independent share, N = agents

p = 0.95, N = 16  →  ×9.14   (not ×16)
p = 0.70, N = 16  →  ×2.91
ceiling (N = ∞)   =  1 / (1 − p)
```

Even 256 agents at p = 0.95 reach only ×18.6. **The "and then" test from Step 1 is
how you estimate p before a single agent runs.**

The cited ceiling: Bun's Zig-to-Rust port, ~50 workflows, 64 agents at peak, four
worktrees of sixteen, 535,496 lines to over a million across 6,502 commits in
eleven days, with **the whole test suite as the merge gate**, 1.38 million
assertions across six platforms.

**Three lines hold it: fan out where the work is independent, gate the edges where
confidence matters, freeze the nodes that hold the truth.**

### 7.2 What this project already got right, and what it got wrong

**Read this part before adopting anything, because the fit is not uniform.**

**Already right, arrived at independently and expensively:**

- **Isolation.** Lanes measure in a `git archive HEAD` tree plus their own files,
  after one lane reported `main` broken when it was reading another lane's
  half-finished refactor.
- **The committing rule.** Our private-index protocol is the source's "no git
  command except committing a specific file", discovered the hard way after a
  commit landed containing **zero files** and a stale index was primed to delete
  137 lines across two lanes.
- **Real signals over self-report.** The `INSTRUMENTS.md` and `NUMBERS.md`
  catalogue is exactly the source's "checks a real signal, not did the worker say
  done", written from about twenty instrument failures in one week.

**Wrong, and the source names both:**

- **We ran a line, not a graph.** Brief a lane, wait, read the report, brief
  again. **The orchestrator's own context was the critical path**, and it was
  frequently the only edge. Most of those edges were false: the art lane never
  read the physics lane's output.
- **Verification was self-verification.** Each lane checked its own work. The
  catalogue proves the source's point better than the source does: **a probe that
  passed by construction, a control that would not go red, a gate that could not
  see the case it was written for, an instrument that had the exact defect it was
  built to find, and thirteen stages reporting PASS with no assertions at all.**
  **Every one of those is a node grading its own exam.**

### 7.3 The shape for this project

**Rule zero, unchanged and now reinforced: the top-level session is the
orchestrator and does not implement.** It reads reports, rules, routes, allocates
number blocks, and talks to Reid. It may read files and git history. It does not
edit code, build, probe, drive a browser, or commit anything but decision records.

**The standing phases for any non-trivial job:**

1. **Scope.** One agent, or the orchestrator reading, produces the work list.
   **This is where you apply the "and then" test and count `p`.**
2. **Fan out.** One worker per item, no shared state, worktree-isolated when they
   write to the repo.
3. **Verify on fresh context.** A **separate** agent per finding, which never
   touched the work, checking a real signal. **This is the change from how we have
   been working and it is the important one.**
4. **Merge.** One report. Intermediate results stay in the orchestrator's
   variables, not re-fed as conversation.

**Model tiering** (Reid's requirement, and it maps onto the phases):

| phase | model | why |
|---|---|---|
| scope, and any lane whose first job is to diagnose | **Opus** | the brief can only say *what to find out*; the premise may be wrong, and premise correction was this project's highest-value output all week |
| fan-out workers with a stated cause and a named file | **Sonnet** | the brief can say *what to do* |
| fresh-context verifiers | **Sonnet**, escalate to Opus for subjective calls | checking a real signal is mechanical; judging art or design is not |
| merge and synthesis | **Opus** | it is a judgement about the whole |
| Release lane (settled rebuild, freeze, smoke) | **Sonnet** | a written procedure, and it is the only lane that commits `web/wasm/dist/*` and `expected.json` |

**The test for which model:** if the brief contains "measure whether", "decide the
shape", or "the premise may be wrong", it is Opus. If it contains a file path and
a defect description, it is Sonnet.

### 7.4 The hardware, and why it changes the caps

**Reid's VM: 16 cores, 48 GB RAM, 300 GB disk.**

**The source's sixteen-agent cap is a scheduler limit, not a hardware one, and our
workers are unusually heavy.** Budget by what a worker actually runs:

| worker kind | realistic concurrency on 16c/48G | why |
|---|---|---|
| reading, writing, doc work | **12 to 16** | cheap, and 16 is the tool's cap anyway |
| `ctest` / `emcc` builds | **4 to 6** | each build already parallelises across cores |
| headless Chrome probes | **3 to 4** | SwiftShader software rasterisation with the frame limiter off; each one will take every core it is given |
| Blender Cycles renders | **2 to 3** | same, plus RAM |

**Do not fan out sixteen browser probes on this box.** A probe sweep is the one
place where a wide fan-out will be slower than a narrow one, because they contend
for the same cores. Shard it: the probe-sweep tool `web/tools/smoke/probeall.mjs`
already supports shards and is resumable per results file.

**Worktrees fit the disk.** The repo is roughly 5 GB with LFS materialised, so four
worktrees is about 20 GB against 300 GB, comfortable. The Agent tool takes
`isolation: "worktree"` directly.

### 7.5 The first graph to run

**Do this one first, because it is the highest `p` in the project and the result
is already needed.**

`web/tools/smoke/probeall.mjs` exists, is inert, and nothing invokes it. **284
probes, none of which can currently fail the harness** (§4b). That is a near-pure
fan-out: every probe is independent, so `p` is close to 1, and the merge is a
single list.

Scope, fan out across three or four shards, **verify each red serially on fresh
context** because a red measured under contention may be contention, then merge
into one list. **Only then decide the gate.** The estimated run is 60 to 70
minutes at two shards.

**Second graph: the playability sweep**, which is naturally one worker per screen
with a fresh-context verifier per finding.

**Not a graph: the carrier-rider work in §4a.3.** It is one node on the critical
path, and Amdahl's law says agents will not help. **Give it one Opus lane.**

### 7.6 What a brief must contain

Unchanged from hard experience, plus the graph additions:

1. The **goal**, in Reid's words where they exist.
2. **What already exists**, with numbers, so the worker does not rebuild it.
3. **The premise, marked as a premise**, with an instruction to measure it and
   report if it is wrong.
4. **The decision-number block**, recorded in `NUMBERS.md` before the lane starts.
5. **File ownership**, and what to publish rather than reach for.
6. **The commit protocol**, and for fan-out workers the frozen rule: **never
   stash, never reset, no git command but committing a specific file.**
7. **The measurement standard**, plus the two or three catalogued traps most
   likely to bite this job.
8. **Its position in the graph**: is this a worker, a verifier, or the merge? **A
   verifier is told it must never implement. A worker is told it will not grade
   its own work.**

### 7.7 What a report must contain

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
