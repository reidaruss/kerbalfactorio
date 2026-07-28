# Instrument hygiene: how measurements lie on this project

Written 2026-07-28 after a night in which **four instruments were broken and
three of them belonged to the lane that caught them**. Every one had the same
shape, and it is a shape worth naming.

This is not a rule list. It is the failure catalogue, so the next lane
recognises the pattern before it burns a pass.

## The dominant failure: a control that depends on something that moved

`probes/post.js` failed for weeks and two of us (Admin included) diagnosed it as
"its pass conditions read inverted". **That was wrong.** All three failures were
genuine, and the cause was that the control had gone stale: the attribution
ratio was calibrated on a bare hillside at RN-10, and then **RN-15 planted an
understorey over the control column**. Nobody tuned a threshold. The world moved
under a number that was correct when it was written.

The same shape, three more times in one night:
- A LOD2 saving control applied to every batch instead of the four detail props,
  reading 2.30 M against 972 k. It would have let the lane claim a **1.33 M**
  triangle saving instead of the true **115,670**. It failed in the FLATTERING
  direction, which is the direction nobody double-checks.
- A `deliveredFraction` reading **1.5146** because a skirt produced cards it
  never requested. A ratio that can read 1.5 cannot be trusted to read 0.98.
- `mapwork.js` asserting `after.lumaStep >= before.lumaStep`, a frame-wide mean
  over 2,784 samples asked to notice a pad that moves 4 of them. It cleared by
  0.086, and **any change of sign passes a `>=`**.

**Practice:** when a probe's verdict depends on a baseline, the baseline is a
dependency. State what it assumes about the world, and re-derive it when the
world changes. A control is code and it rots like code.

## Numbers cannot see everything, and knowing which is which is the skill

The terrain detail bump moved **35% of the near band with a healthy peak** and
every metric said it worked. It was in fact producing concentric arcs centred on
the player, because float32 at 6e5 m has a 0.0625 m ULP against a 4.3 mm pixel
footprint, so `dFdx` was exactly zero across runs of pixels. **No number saw it.
A screenshot did.**

Conversely, the map painted `2784 of 2784` samples into an unreadable grey wash,
and the picture looked plausible enough that only a contrast measurement settled
it.

**Practice:** DW-7 in both directions. A structural check cannot replace looking,
and looking cannot replace a count. Spatial-frequency artefacts (banding, arcs,
seams, moire) are for the eye. Magnitude, coverage and conservation are for the
number. Know which kind of claim you are making.

## An assertion that has never been seen to fail is not an assertion

Standing rule 11, and it kept earning its place:
- Three probes read `mesh.faces`, a field deleted at WG-24. Two comparisons were
  `undefined < undefined` and `undefined >= undefined`, **both false**, so the
  tunnel save/reload check was not vacuously green, it was **stuck red** and
  hidden beside a neighbouring red term everyone had learned to ignore.
- `voxelskin.js` **passed better when nothing was built** than when a pad was.
- `levelstream.js`'s headline verdict has never been evaluated on a single row:
  it reads a field that does not exist, so `[].every(...)` is vacuously true.
- `padflat.js` has not executed a line of its body since WG-22; it calls seven
  functions that exist nowhere.

**Practice:** break the thing on purpose and watch the probe go red, by name.
The negative control IS the deliverable. `run.mjs` now throws on a read of a
field the client does not publish, which converts the whole silent class into a
loud one.

## The environment is part of the measurement

- A **stale dev server on a forgotten port** produced a convincing ABI-mismatch
  failure while the source was consistent, and later produced three "it does not
  work" reports from Reid about features that were correct in main. That is what
  BT-27's build stamp exists for: the running client states its own commit, and
  `+dirty` means it matches none.
- **Frame timings are worthless while several lanes build on the machine.** One
  quiet-machine reading had a binary at p50 5.8 ms; re-measured later, the same
  binary read 10.2. A lane nearly reported a 4.8 ms regression that did not
  exist. Interleave A/B/A/B inside one binary, or publish the invariant counts
  (draw calls, programs, triangles, VRAM) and say plainly that timings are
  unresolved.
- **`--strictPort` is mandatory.** Without it vite silently picks another port
  and you measure somebody else's server.

## The scene is part of the measurement (R8)

Every geometric probe on this project ran on the flat spawn clearing, and it hid
two defects outright:
- A belt corner misalignment of **10.1 degrees** measured **exactly zero** on
  flat ground across 39 driven keypresses. It only appeared on a 14.82 degree
  hillside.
- The tunnel sinking hunt burned two passes partly because the probe dug its own
  tunnel at spawn, where the heightfield sits a couple of metres above the floor
  rather than 19 m.

**Practice:** a probe asserting a distance, an angle or a seam runs its scene at
least twice, once flat and once on measured slope, and reports which is which.
A pond's shoreline is a circle, so it gets four bearings, not one.

## The asset is part of the measurement, and a constant is a hidden assumption

The factory lane shipped one 8 m machine into a set where every previous machine
was 1 m or 2 m, and it falsified **four separate constants at once**, in four
files, each written independently and three of them asserting the assumption in
prose beside the code:

- `FactorySnap.nearestSocket`: does the crosshair CATCH this building
  (`bestD + 1.6`, commented "every socket of these assets is inside 1.6 m of the
  building's own origin").
- `FactoryWiring`'s machine-to-machine pair loop: can two machines LINK at all
  (`1.6 * 2 + PORT_MATE_M`, same comment).
- `FactoryGhost.PREVIEW_NEAR_M`: what the ghost SAYS it will connect to, before
  the button goes down (same expression again).
- `Factory.pick`: can you INTERACT with it (`PICK_REACH_M` 3.5 m measured to the
  centroid, which means "2.5 m from the face" only while a machine is 2 m).

The last one is the instructive one. An 8 m machine's centre is 4.000 m from its
own face, so the reach test rejected it **from every standing position that
exists in the world**. The machine was placed, drawn, connected, wired and
ticking, and could not be opened, fed, collected from or demolished. Every
table, every port, every link and every published report field was correct.
**No static check could have seen it and no existing probe would have, because
every existing probe builds its scene out of 1 m and 2 m parts.** A driven run
found it on its second attempt; reading found only one of the four.

This is DW-28's class (a ceiling that reports success) reached by a new route,
and DW-33's lesson (`DECK_H` = 0.50 encoding "the error all lands on one side")
stated more generally:

**When an assumption is true of every asset, it gets COPIED rather than derived,
and the copies do not know about each other. Adding the first asset that breaks
it does not produce one failure, it produces one failure per copy, and they
surface in unrelated subsystems as unrelated symptoms.**

**Practice, two halves.** When you add an asset that is the first of its size,
class or shape, treat it as an instrument test of every constant that has ever
been sized against the old set, and grep for the literal. And when you write a
bound that depends on an asset's dimensions, derive it from the dimension table
rather than from today's largest value, even where the constant is obviously
correct today, because "obviously correct today" is exactly the comment all four
of these carried.

Corollary for probes: the two failures here pointed in **opposite** directions.
The reach constant made a working machine unreachable, and a separate missing
case in `inputItemOf` made a working machine look starved, reporting `null` for
a hopper the sim was visibly draining (a peak of 0 in a slot that had just
produced twelve items, reading 98 after the fix). A report that says null where
it means "I do not compute this for your kind" cannot be told from one that
means "empty", and that ambiguity is invisible until a new kind arrives.

## A negative control is not finished when it goes red (FS-71)

**It is finished when the revert is verified byte-identical.** A negative control
deliberately breaks working code, so between applying it and reverting it the
tree contains a real defect that nothing distinguishes from an accidental one.

This was not hypothetical: the machine was restarted mid-pass while a restore
path was deliberately zeroed, and the working tree was left holding a chest that
forgets its contents, with no process alive that remembered why it was there. The
next reader, including the same agent later, has no way to tell a control from a
bug by looking at it.

So the control has three steps and not two, and the third is the one that gets
skipped: apply, observe red **with the numbers printed**, revert and diff against
`HEAD`. `git status --porcelain <file>` printing nothing is the proof. On
returning to any interrupted pass, diff before running anything, because a
suspicious result may be measuring a break you left yourself.

## A tool that reports nothing may not be running (FS-70)

**A syntax error anywhere silently disables semantic type checking everywhere.**
TypeScript reports syntactic diagnostics for the file that failed to parse and
then declines to run semantic checks on the WHOLE program. `npx tsc --noEmit`
therefore prints a handful of errors that all name one file, and zero type
errors for every other file in the repository, which is indistinguishable at a
glance from a clean run with unrelated noise at the top.

This was found with four parse errors in one lane's shader file standing between
another lane's change and any type checking at all. Stubbing that one file in a
scratch copy and re-running found two REAL errors the suppressed run had hidden:
a `Record<K, V>` table that a new union member had made incomplete, and three
invented method names on a class that has none of them. Both would have reached
a browser.

**So a clean tsc reading is only meaningful if the SYNTAX error count is also
zero.** "No semantic errors" and "no semantic errors were looked for" print
almost identically, and the second is the more likely reading whenever any file
in the tree is mid-edit. The check is cheap: if the output names only one file,
and the codes are TS1xxx rather than TS2xxx, nothing else was examined.

The general rule this belongs to is the one the rest of this file keeps arriving
at from different directions. **A green result from an instrument that was never
running is the most expensive kind of green**, because it costs nothing to
obtain, survives review, and is indistinguishable from the real thing until
something ships. The other instances here are a control that depends on
something that moved, an assertion that has never been seen to fail, a scene
that cannot exhibit the defect, and a probe pointed at the wrong axis. This one
is the tool declining to start.

## Cross-references

Standing rules 4, 7, 10, 11 and DW-7, DW-20 in
[DECISIONS.md](DECISIONS.md). The commit-isolation technique that makes rule 10
enforceable is in [NUMBERS.md](NUMBERS.md).
