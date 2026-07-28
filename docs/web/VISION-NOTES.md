# Vision notes, captured 2026-07-27

Reid's own framing, recorded so it is not lost and not acted on prematurely.
**This is NOT a plan of record.** [RETHINK.md](../review-2026-06-16/RETHINK.md) is.
Items here are direction, not commitments, and several are explicitly "note it,
do not build it yet".

Where a line is Reid's judgement rather than a derived requirement, it is
attributed, because the difference matters when someone later wants to argue
with it.

---

## 1. Build menu on B, and the death of the craft-then-hotbar loop

**Status: BUILD THIS. It is the one fully specified item here.**

Reid: "I don't want to have to craft them and then put them in the hotbar and
then scroll to the hotbar item and then place it."

- `B` opens a build menu.
- It lists the build items the player has **unlocked**.
- Affordable ones are **lit**; unaffordable ones are **greyed**.
- Clicking one puts it in hand with the placement preview, exactly as the
  hotbar route does today.
- `Escape` leaves that state.
- **Survival: raw resources are enough.** Structures no longer need a crafting
  step at all. The build menu consumes raw materials directly.
- **Sandbox: everything is buildable**, per DW-31.
- Covers foundations, walls, roofs, doors, launch pads, smelters, power poles,
  and everything else structural.

This removes crafting from the structure path entirely. Crafting remains
whatever it is for non-structural items; that boundary needs stating when the
work is scoped.

## 2. Machines should be Satisfactory-sized, not Factorio-sized

**Status: informs the assembler work now, and a later machine-art pass.**

Reid: "look up images of satisfactory the game, smelters and assemblers and
storage containers... they're pretty big and they have slots for the inputs and
slots for the outputs that fit the belts and the belts snap to."

Measured reference (Satisfactory): foundation **8 m**; Constructor one tile at
**8 x 10 m**; Assembler about **2 x 2** tiles; Manufacturer about **3 x 3**;
belts clear machines at **8 m** of stacked height.

Our structural module is **4 m** (DW-32), so a Satisfactory Constructor is
roughly 2 x 2 of our foundations and an Assembler 4 x 4. **Our machines are far
too small relative to the player and to the grid.** Sizing machines in whole
structural modules is also what makes ports land predictably on belt height.

FS-43 to FS-55 landed the port model; the remaining gap is physical scale and
the art that goes with it.

## 3. Assemblers

**Status: BUILD THIS, next after the port model.**

- Belt resources in, like a smelter.
- **Select a recipe** from a menu. This is the part smelters do not have.
- Show inputs, outputs and build progress, like the smelter panel (GP-61 to
  GP-64).
- Produce buildables: smelters, mining drills, and so on. It automates the
  crafting loop, which is the point.

## 4. Space, and why anyone would go

**Status: NOTE. The station is the near-term story hook; the rest is later.**

Reid's landing point after thinking aloud: **there is already a small space
station in orbit when the game starts.** To unlock autopilot you fly up
manually, dock, walk around inside, and **find something that unlocks the
autopilot recipe**.

The step before it: **you build something that detects a signal**, the signal is
this mysterious object in orbit, and your goal becomes finding out what it is.
That is two backwards steps of progression already specified.

Two candidate progression models were considered and this supersedes both:
achievement-style ("dock with something, unlock it") and Factorio-style
("harvest something in orbit, ship science back down"). The station-with-a-thing
-inside is a third option Reid preferred because it gives space a *place*.

Later, and explicitly not now:
- **Rockets get much bigger.** Early ones are a crew capsule you cannot move
  around inside; you dock and enter the station through an airlock. Later
  modules are large enough to **walk or float around inside**.
- **Space stations you build**, with automation inside them: smelters,
  assemblers, belts, running in orbit.
- Moon, other planets, the sun, KSP-style. Orbits must be **tracked without
  being rendered**: you need to know where a body is from the clock alone.

## 5. The time problem

**Status: NOTE. Genuinely unsolved, and Reid flagged it as a real risk.**

KSP lets you warp time. That does not work here for two reasons Reid gave:
1. If you are mining and running a factory, warping is effectively cheating.
2. At real scale, an interplanetary transfer is days or weeks of wall time.

And it gets worse with multiplayer, where one player warping is incoherent for
everyone else.

No answer yet. Worth noting that the on-rails framework (FS-4) already separates
"simulated in detail" from "advanced by formula", which is the machinery any
solution would be built on.

## 6. Multiplayer shape

**Status: NOTE, but it constrains architecture NOW.**

Reid: "I don't wanna host any official servers." Players start their own game
and invite friends, or run their own dedicated server. **No first-party hosting,
ever.** If this changes how something is built, it wins.

Rendering follows the player: two players, one on a station and one on the
ground, each render their own surroundings. That is already the direction the
networking domain assumed (interest management), so it is consistent.

## 7. Graphics settings, and benchmarking

**Status: NOTE, belongs with the options menu.**

Texture quality, render distance, and the rest, adjustable so the game can be
benchmarked across machines. The options menu shell is being built now with
exactly this section stubbed.

## 8. Enemies: deliberately parked

**Status: PARKED by Reid, on purpose.**

Reid: get the base game working really well first. Once basic enemies, health,
destruction and pollution exist, **stop and do not focus on it again until
everything else is polished.**

What he wants when it resumes:
- **Base defence**: buildable walls, a big gate you can pass through,
  auto-turrets that shoot attackers. Walls assembled from smelted iron and
  stone, made in an assembler.
- **Giant spider enemies**, at least for some types. Models, movement, attack
  animations, nests.

The design critique worth keeping, because it is the actual insight:

> Factorio gives no incentive to explore. It is "do I need another ore patch,
> yes, find the nearest one." And the evolution mechanic makes exploring hostile
> even if you wanted to. Satisfactory incentivises exploration because you must
> find things to upgrade with, but it has no base defence, and outside power
> slugs there is little reason to look around.

Reid wants **base defence like Factorio AND a real reason to explore, going
further than Satisfactory's**. Neither game does both. That is a design problem
to solve, not a feature to copy, and it is the most interesting open question in
this document.

## 9. Working agreement for long unattended runs

Reid, going to sleep 2026-07-27: keep working. When the queue empties and the
work is solid, start laying **framework and proof of concepts** for the bigger
items above, then iterate and deepen. Graphics specifically will want "10 more
passes", so a graphics pass is never finished, only currently landed.

Do not wait for a testing signal to keep going; wait for it only to decide what
to hand over.
