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

## A syntax error anywhere silently disables type checking everywhere

`tsc` reports **syntax** errors and **semantic** errors in separate phases, and
when any file in the program fails to parse it **suppresses semantic diagnostics
for the whole program**. So a tree with one unparseable file reports a handful of
`TS1005`s and **zero** type errors, and every lane reading that output as "four
errors, none of them mine, otherwise clean" is not being type checked at all.

Found 2026-07-28: an uncommitted shader file had four backticks inside a GLSL
template literal, which terminated the literal early. `npx tsc --noEmit` reported
those four and nothing else, repo-wide. Another lane stubbed the file out in a
scratch copy and immediately turned up two real type errors that had been hidden.

The trap is that the output looks *specific*. Four errors in one file reads as a
narrow, someone-else's problem, not as a global outage of the tool.

**Practice:** treat a non-empty `tsc` run as **no information about any other
file**. Fix the parse error first, then re-run before drawing any conclusion. And
when a clean run is load-bearing, prove the checker is alive with a **negative
control**: inject a deliberate type error, watch it fail **by name**, remove it,
watch the silence return. That is standing rule 11 applied to the toolchain
rather than to a probe, and it costs about ninety seconds.

The general form, which is worth more than the instance: **a checker that can
degrade to a weaker mode without announcing it will eventually be read as though
it were still in the strong mode.** The same shape appears in `check-limits`
(passes vacuously on a file it cannot read), in a probe reading a deleted field,
and in `[].every(...)`.

## A set has no order, so a set comparison cannot check an ordering

The same lane wrote a static check that pulled every `uniform <type> <name>` out
of a generated fragment shader, pulled every `u`-prefixed identifier the body
used, and reported which were used but never declared. It printed `(none)`. The
shader then failed to compile with eight errors, all of them
`'uCascadeFar' : undeclared identifier`, because a helper had been concatenated
**above** the uniform block and GLSL requires declaration before use.

The check was not wrong about its own question. It was asked a question whose
answer could not express the failure. Membership was fine; position was the bug.

**Practice:** when a check reduces a program to a set, a count or a total, write
down which properties that reduction **destroys**, and do not claim those. For
generated GLSL specifically: **nothing but a compiler checks a compiler.** The
driver found this in one run and named the line.

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
- **Vite's watcher will reload the page out from under a running probe.** Editing
  a probe file and immediately running it produced `Execution context was
  destroyed, most likely because of a navigation` plus `net::ERR_ABORTED` on the
  document, three runs in a row, and the failure names neither the edit nor the
  watcher. Leave a few seconds between writing a file and driving the browser.
- **The sun the post stack publishes FREEZES below the horizon.**
  `ShadowRig.update` does `if (!this.active) continue` before it moves the light,
  and `Frame.publishSun` derives `__ofPost.state().sun` from that light's
  position minus its target. So once the rig goes inactive the vector stops
  changing. A probe read the identical elevation `0.5486` for two different times
  of day, which is the tell. Harmless where the post stack uses it, because the
  contact-shadow march is gated on the same rig; **not** harmless in an
  instrument. `of.stats().sky.elevationDot` is computed from the sky's own sun
  and does not freeze.

## A term measured only where it cannot work reports its own absence

R8 says a geometric probe runs on a slope as well as on the flat. The same rule
has a lighting form, and the water lane hit it twice in one pass on one term.

The sun glint was measured at four fixed bearings and read peak tile deltas of
0.10, 0.13, 0.91 and 1.13 counts, i.e. nothing anywhere, and **two of the four
"failed"**. Neither reading was evidence. Three of those cameras had the sun
behind them, where a correct specular highlight is **supposed** to be invisible,
so the probe was asserting that a term must appear where physics forbids it,
which is RN-46's `wetCells: 0` error with the sign flipped. Aiming the station at
the sun's own azimuth, read from the scene rather than assumed, moved the same
term to a peak of 55.

The second half is subtler and is about the **grid**, not the camera. Even
correctly aimed, the glint read ~0 on a 64 x 36 tile mean, because each tile is
20 x 20 px and a sparkle path a few pixels wide averages away inside it. At
160 x 90 the same effect reads a peak of 72. **The tile size is part of the
instrument**, and a sparse high-frequency term measured on a coarse grid is
indistinguishable from a dead one.

**Practice:** state the condition under which a claim is made and pin it (this
probe pins the sun 4 degrees up, and records that at 49 degrees the same term
reads 1.67 counts, so nobody later "fixes" a number that is geometry). Prefer a
**two-sided** claim to a threshold: this one asserts the glint is present with
the sun up and **bit-exactly absent** with it below the horizon, which no
tuned-until-it-passes threshold can imitate.

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

## A fixture whose value is the identity of the operation reads exactly like a pass (GP-142, GP-145)

The other entries here are about a check that cannot see a defect. This one is
about a **setup** that cannot produce one, which is worse, because the check is
fine and reviewing it harder finds nothing.

**Three instances in one night, all in the assembly bay.**

**One.** `VesselDesign.toJson` wrote `off: 0` as a literal, so `radialOffsetM`,
the number that says where along a hull a strap-on sits, was never serialised.
Every strap-on slid to the base of its parent on every save and load. It shipped,
and it survived because GP-116 authored the pylon at **offset 0**, and every
strap-on probe since goes through the pylon. **The entire radial path was
exercised at the one input where total loss of that input is invisible**, since
zero is the identity of the addition being lost. Reading `off` back gave 0 and
the expected value was 0, and both were right.

**Two and three.** Writing the probe for GP-145 I did it twice more in ten
minutes. The section needed a top face that an engine cannot take, so it built a
lone Stack Decoupler. A lone decoupler has a free **bottom** face too, so the
snap legitimately answered with that, and the line under test read "Vacuum
Engine under Stack Decoupler": a correct answer to a question the section was
not asking. Replacing it with a bare tank did exactly the same thing for exactly
the same reason. The fixture only became capable of exhibiting the defect when
it was a tank with an engine already under it, which closes the only downward
face because an engine's own bottom is an interstage.

The ancestor is already in this file under standing rule 11: a `fillSaturated()`
helper that **wrote the end state directly** while claiming in a doc comment to
model a belt that had been running, and every test of the operation that fills a
belt pushing exactly one item. Same shape, one layer up.

**Practice, and it is cheap.** A probe **asserts its own fixture before it
asserts the behaviour**, in terms of the quantity under test. `probes/vabround.js`
now checks that the ring it chose is more than 1.5 m off the base before it
checks anything about the round trip, and `probes/vabdirection.js` checks that
no free bottom face is left before it reads the refusal. Both would have been
green against the defect without that line, and both fail loudly if a later
change moves the fixture back to the degenerate value.

The general form: **when a probe picks a value for a parameter it is not
testing, ask what the operation under test does to the identity element of that
parameter, and do not pick it.** Zero offsets, empty lists, single-item
collections, one-part stacks and default angles are where a total loss of
behaviour is indistinguishable from correct behaviour. This is the same reason
R8 says a geometric probe runs on a slope as well as on the flat: the flat
ground was the identity, and it hid a 10.1 degree belt misalignment as exactly
zero across 39 driven keypresses.

## An implication passes when its antecedent is false, and `||` in a check is the signature (GP-156)

**This one is greppable, so audit before you reflect.** The other entries here
ask you to think about your instrument. This one you can find mechanically, in
your own probes, tonight.

`probes/launchguide.js` contained

```js
check('in ORBIT it says so and points at the map',
      s4.status !== 'ORBIT' || s4.names === 'map', ...)
```

which is an implication, and **an implication with a false antecedent is
vacuously true**. The line before it pressed Teleport To Orbit. If that press
had done nothing, the status would not have been `ORBIT`, the antecedent would
have been false, and the probe would have gone green having tested nothing about
the thing it exists to test. It is `[].every(...)` wearing different clothes,
which is already in this file as the most expensive class of green.

**The signature to search for: `||` or `!==` inside a `check(...)` condition.**
Every one of them is a claim of the form "if A then B", and every one needs A
asserted somewhere in its own right, or the check has a hole the size of A.

The fix is one line: assert the antecedent separately.

```js
check('the teleport actually put the craft in orbit', s4.status === 'ORBIT', ...);
```

The control is what makes it worth having, and it is worth running rather than
describing. With the orbit press suppressed, the new check fails by name
(`status ASCENT`) and **the original implication does not appear in the failure
list at all**. Red and green side by side on one run.

Note what the fix did NOT change: the press really does land, and that green
was real. **A true result and a supported one are different things**, and this
file exists because only the second kind survives someone changing the code.

Found by auditing every probe that presses a pause-menu button, after a press
helper was caught reporting success on a click that never landed (GP-155). Of
seven probes that touch the menu, exactly one had the defect being hunted, and
this was in a different one, by a different mechanism. **The audit was worth its
cost for the thing it was not looking for**, which is the usual way.

## A computed style is what CSS asked for, not what the user agent drew (GP-151)

The pairing matters more than the instance, so here is the instance first.

Predicted, before measuring, that the pause menu's keyboard focus ring would be
invisible. `getComputedStyle(el).outlineColor` agreed: `rgb(16, 16, 16)` on a
panel of `rgba(26, 32, 38, 0.94)`, near-black on near-black, unreadable. **A
screenshot refuted both the prediction and the number.** Chrome's
`outline-style: auto` ignores `outline-color` entirely and draws its own
high-contrast ring, which is perfectly legible.

**And this points the OPPOSITE way to the rest of this file.** The standing
lesson here is that the eye is unreliable and the number is truth: concentric
arcs no metric saw, a grey wash that looked plausible and was not. Here the
number was wrong and the picture was right.

So the rule is neither "trust numbers" nor "trust pictures". It is that
**a computed style is a statement of what CSS asked for, not of what the user
agent drew**, and the two diverge precisely where the UA reserves a behaviour to
itself: `outline: auto`, `appearance: auto`, default form-control rendering,
`font: caption`. This is the same shape as "a value published for rendering is
not automatically fit to measure with", one layer further out: there the value
was correct where it was USED and frozen where it was READ; here the value is
correct as an INPUT and silently not an output.

**Practice:** for anything the user agent may draw its own way, the instrument
is a picture or a hit test, not the cascade. And when a number and a picture
disagree, the question is not which to believe but which one is downstream of
the thing you are actually claiming.

## The discriminating run is cheap and the certainty is not (GP-155)

Chasing a probe failure, I was certain that an edit made LATER in a file could
not break a check made EARLIER in it. That is true in general. It was wrong
here, and being certain of it cost more than testing it would have.

The test was four runs: my source and HEAD's source, crossed with my probe and
HEAD's probe. It took minutes and it immediately contradicted the certainty,
which is the only reason the hunt turned toward the real cause. **Reading the
receipt log at the moment of failure**, rather than continuing to reason about
what could and could not have caused it, is what actually named it: the log
contained no receipt for the press at all, so the press had reported success and
nothing had happened.

The general form, and it is about time rather than about instruments:
**when a measurement contradicts something you are sure of, the cheapest next
move is almost always another measurement, not another argument.** Certainty is
the most expensive thing to carry into a hunt, because it decides which
experiments you do not bother running.

Corollary, learned on the same verb: **while the cause is unknown, revert to
byte-identical rather than leaving a half-understood change in place**, and
re-apply only once it can be explained. That matters most on the paths that
destroy something. This was the save wipe.

## Cross-references

Standing rules 4, 7, 10, 11 and DW-7, DW-20 in
[DECISIONS.md](DECISIONS.md). The commit-isolation technique that makes rule 10
enforceable is in [NUMBERS.md](NUMBERS.md).

## The published value froze, and only the instrument noticed

`__ofPost.state().sun` **stops updating once the sun is below the horizon.**
`ShadowRig.update` does `if (!this.active) continue` before moving the light,
and `Frame.publishSun` derives from that light, so the published elevation holds
its last daylight value forever. A probe read an identical `0.5486` for two
genuinely different times of day.

This is harmless where the post stack consumes it, because the contact march is
gated on the same rig that stopped. **It is not harmless in an instrument**, and
it is invisible precisely when you are testing the night case.

Use `of.stats().sky.elevationDot`, which does not freeze.

The general rule: **a value published for rendering is not automatically fit to
measure with.** Rendering may legitimately stop maintaining something the moment
it stops drawing it, and a value that is correct wherever it is *used* can still
be frozen everywhere it is *read*. Before measuring with a published field, ask
what stops updating it, and prove it moves across the case you are testing.

## The screenshot is not automatically the instrument (RN-61, RN-62, RN-63)

Every other entry in this file is a failure. This one is the habit that keeps
paying, recorded so it is copied rather than rediscovered.

RN-61 gave fourteen harvest trees a per-instance tint and size. The before and
after frames looked **identical** to the eye, and the honest report from looking
at them would have been "no visible change". The frame was mostly desert with
three trees in it, so the change occupied about 2% of the pixels: not a small
effect, a small *share of the frame*. Diffed numerically instead, HUD and hotbar
excluded, it was **13,514 of 544,000 pixels moving by more than 6 counts with a
maximum channel delta of 180**, concentrated exactly where the trees were.

**A frame in which the change occupies a few per cent of the pixels cannot be
judged by looking at it**, and a matched pair of screenshots is evidence only
once you know what fraction of the frame the effect is allowed to touch. This is
the same shape as the tile-size entry above: there, the instrument's resolution
decided whether a term was visible at all; here, the frame's *composition*
decides whether the eye can see a change that is definitely present.

### Assert the property, not the magnitude

The stronger half. When the diff is the instrument, assert what the feature **is**
rather than how big it came out:

- RN-62's base-contact bake: **26,361 of 26,844 changed pixels got darker, 483
  lighter.** A darkening gradient that stopped darkening things would be broken
  by definition, so the direction is the assertion.
- RN-63's mineral height scale: **12,715 darker against 13,764 lighter**, a
  deliberately even split. A silhouette change moves pixels both ways; had it
  come out 98% darker, it would have meant the scale change was accidentally
  shading something instead of reshaping it.

A magnitude assertion rots the moment somebody tunes a constant, and it invites a
tolerance wide enough to pass on nothing. A property assertion survives tuning
and still fails when the feature genuinely breaks. **Prefer the invariant that
falls out of what the change means over the number it happened to produce.**

### Name the failure mode before measuring, then look for it

RN-62's comment predicted that too deep a mineral band would read as "a rock
dipped in paint" and chose 0.64 over the bottom 20% against foliage's 0.42 over
38% for that reason. The frame was then checked for that specific artefact rather
than for general goodness. A named prediction is falsifiable; a justification
written after the screenshot is not, and reads the same in the diff.

## Summing independent fields narrows the distribution (RN-644)

`suitplate`'s wear mask was the sum of four independent noise fields. Its
measured effective metalness band came out at **0.074, against the 0.406 of the
`panel` family it was replacing**: a straight regression on the single number
the family had been built to fix, in a map whose whole argument was that
metalness should carry information.

Nothing was wrong with any of the four fields. The central limit theorem was
doing exactly what it says: a sum of independent terms concentrates around its
mean, so a mask assembled that way is unimodal and narrow no matter how much
structure went into it.

The fix is to ask what shape the quantity really has. **Paint does not thin, it
CHIPS**: a coating is either there or it is not, so the physically right
distribution is bimodal, and a `smoothstep` over the raw sum produces that.
The knee is **centred on the measured raw median**, not guessed: a knee placed
by eye at 0.20 to 0.46 against a raw median of 0.25 left 95 per cent of the
plate fully coated and the roughness band at 0.115, which is a bimodal design
with only one of its two modes populated.

Generalised: **before spending effort on the inputs to a mask, measure the
distribution of its output.** A band that is too narrow is far more often a
statement about how the terms were combined than about the terms.

## Anything a player can count reads as hand-made (RN-643)

`suitfab`'s first version used a 5 mm thread pitch, which is roughly what a real
technical weave has. It rendered as **knitted wool**. At 5 mm a player counts
about twenty-four threads across the back of a glove, and a countable repeat
reads as hand-knitting whatever the material is supposed to be.

The pitch went to 3.3 mm, just at the texel floor, and the amplitude came down
with it, because **amplitude and pitch are not independent**: a crown height
that is fine at one pitch is a corrugation slope at half of it, and no amount of
adjusting the normal strength afterwards recovers the read.

The rule that generalises: a repeating structure has to sit either **clearly
above** the resolution, where it is a designed feature, or **at or below** it,
where it is a texture. The band in between, where the eye can just resolve
individual elements and therefore count them, is where a surface stops looking
like a material and starts looking like a craft project.

## "Mostly hidden" is a claim that has to be rendered (RN-646)

Two versions of the first-person knuckle guard were killed by looking at them,
and both were killed by geometry that was reasoned about rather than viewed.

Version one authored four plates at 12.5 mm half-width against 10.5 mm
half-thickness, which is very nearly round in section, with the long axis
running forward along the hand. Reasoned in the abstract that is "four plates on
the knuckle line". Seen from a camera sitting behind the hand, which is where
the first-person camera always is, it is **four forward-pointing claws**, and it
was worse than the single slab it replaced.

Version two added a thin dark carrier strip for the plates to be riveted to,
described in its own comment as "mostly hidden". It was authored **wider than
the four plates meant to hide it** and tapered to a point at its forward end,
so what rendered was a dark triangle down the back of the glove: the most
conspicuous thing in the frame, added by a part whose entire justification was
that you would not see it.

**A part authored to explain another part is only worth its triangles if it is
actually hidden, and whether it is hidden is a measurement, not an assumption.**
The cheap check is the one that was skipped twice: render it from the camera the
asset is actually seen from, before believing the reasoning.

## A ladder authored for screen distance is admitted by a different test than a shadow cascade uses (RN-561)

Every LOD ladder in this project was authored against ONE question: at what
screen size does a cruder tier stop being distinguishable? That question is
about how SMALL the object looks. A shadow cascade asks a different one: how
far did the SURFACE move? Those two admit different meshes, and nothing in the
project had ever asked the second one, so no asset had ever been measured
against it.

The consequence was not a wrong ladder, which would have been visible. It was a
ladder that is correct for its own purpose and silently unusable for another,
which is why it survived every gate: `validate_glb` checks tier triangle
counts, `check_coplanar` checks paint, and neither has any opinion about the
distance between two tiers' surfaces.

**How it surfaced.** The machine lane priced a triangle raise against a
recovery in which the three CSM cascades would draw the cruder tiers that
already ship in every `.glb`: `2276 + 192 + 2x48 = 2564` against `2276 x 4`, a
factor of 34. The cost half of that estimate was independently reproduced and
was right. The recovery half was never measured. Cascade 0 is **15.47 mm per
shadow texel** and the smelter's `_LOD1` deviates **325 mm** from its `_LOD0`,
so no cascade fine enough to matter may draw it, and the factor of 34 is a
factor of **1.00**.

**The cause predates the raise and belongs to nobody's pass**: the pre-raise
592-triangle smelter's `_LOD1` already measured 264.8 mm. This is not a defect
somebody introduced, it is a question nobody had asked.

**The measurement is asymmetric and that is load-bearing.** It is taken from
LOD0's VERTICES to the tier's SURFACE, never between vertex sets. A base ring
that the cruder tier lifted by 30 mm must report 30 mm; a vertex-set comparison
scores it at zero, because every vertex of the cruder tier does have a near
neighbour in the finer one. The three failure modes it bounds are a shifted
shadow edge, a DETACHED CONTACT shadow (the most legible, because the eye reads
it as the object floating), and a thin feature that vanishes from its own
shadow.

**What an asset lane actually banks is the marginal multiplier**, `1 +
(cascades still drawing tier 0)`: 4.0x when every cascade is stuck on tier 0,
2.0x at 0,1,1. Halving it doubles what that asset can afford at LOD0 across
every instance in the world. **Authoring a shadow-safe tier therefore buys more
frame than trimming any LOD0 ever will**, because it moves the multiplier
rather than the term.

**The authoring rule, and the four causes nobody would have guessed.** Block in
every LOD0 feature standing more than about 56 mm proud (cascade 1's texel),
one box at the feature's envelope; below that the cascade cannot resolve it
anyway. Reproducing the greebles is not the job. Measured on the smelter, the
features whose absence dominated were: a roof junction box over a bare pan
(325 mm), a hopper vibrator over a bare rear face (290 mm), **a ladder's
bracketed landing, which is WIDER THAN THE LADDER, so a block sized to the
obvious feature still missed by 160 mm**, a roof pipe run (150 mm), and a
painted skirt the tier never had, which left the anchor bolts 141 mm over a
plinth. Not one of them is a silhouette feature; every one of them is a shadow.

**Measure it where it is authored.** The running client's
`__ofShadowLod.report()` is the authority, and it is the wrong place to author
against: an asset lane edits a build script and runs Blender, and should not
have to boot a browser to learn whether the edit bought anything.
`tools/blender/check_shadow_lod.py` is the same number offline from the shipped
bytes, and it is trustworthy for exactly one reason: it reproduces `report()`'s
325.00 mm **to the penny**. An offline instrument that merely agrees in spirit
with the shipping one is a second opinion, not a check.
