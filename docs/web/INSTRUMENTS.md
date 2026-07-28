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

## Cross-references

Standing rules 4, 7, 10, 11 and DW-7, DW-20 in
[DECISIONS.md](DECISIONS.md). The commit-isolation technique that makes rule 10
enforceable is in [NUMBERS.md](NUMBERS.md).
