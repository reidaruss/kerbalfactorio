# Art direction

**Status: authoritative. Every art, rendering and asset lane reads this before
touching anything. Set by Reid 2026-08-01, recorded by Admin.**

## The correction, in Reid's words

> "When I said I wanted the game to be like Kerbal Space Program I meant the
> mechanics of the game, not the art style. Kerbal is very like pastel smooth
> surfaces and low complexity. I was thinking more realistic, like Skyrim or
> Elden Ring, detailed and complex. Maybe this is why the art being produced
> doesn't meet my expectations."

**KSP was always a MECHANICS reference and was never an art reference.** The
project name, the docs, and every art pass to date have carried the unstated
assumption that the look should follow the mechanical inspiration. That
assumption was never checked with Reid and it was wrong.

This matters more than a normal preference note, because a wrong north star does
not produce obviously wrong work. It produces work that measures well, passes
every gate, and lands slightly short of what the person wanted, over and over.
Several passes in this project did exactly that: they were correct against the
brief and the brief was aimed at the wrong target.

## The target

**Realistic, detailed, complex.** Skyrim and Elden Ring are the references.
The common thread Reid is pointing at is not a specific palette, it is:

- **Surfaces that respond to light like materials**, not like coloured plastic.
  Roughness varies across a surface. Metal reads as metal. Wet reads as wet.
- **Detail at every distance.** Something to look at up close, silhouette
  interest at range, and no flat regions that resolve into nothing.
- **Complexity and asymmetry.** Wear, damage, dirt, chipping, staining, growth,
  sag, and irregularity. Nothing in a real world is extruded and pristine.
- **Grounded, muted, layered colour.** Not pastel, not saturated primaries.
  Value and material contrast do the work rather than hue.

## What is explicitly OUT, and must be unlearned

These are all things this project has deliberately done. They were reasonable
under the old assumption and they are now wrong:

- Flat vertex colour as the primary albedo source.
- Smooth-shaded, unweathered, symmetric forms.
- Pastel or high-value palettes chosen for readability.
- "Clean" as a quality bar. Clean is now a defect.
- Treating low triangle counts as a virtue in itself rather than a budget.

## Sequencing rule, and the reason for it

**Look development comes before re-authoring assets.** Lighting, tonemapping,
exposure, shadow contrast, ambient occlusion and colour grading are set FIRST,
and assets are judged and authored against that target afterwards.

The reason is a mistake this project has already made once and written up: when
the prop ambient was wrong, re-authoring boulder albedo to compensate would have
**baked the lighting error permanently into the assets**, leaving the next lane a
set of rocks tuned to cancel a bug. Re-arting fifty assets under untuned
lighting is that same failure at fifty times the scale.

A large share of "pastel and smooth" is not the models at all. It is the
response curve, the ambient floor, the shadow contrast and the absence of
material response. Those are cheap to change and they change everything.

## The honest ceiling

This is a browser WebGL client rendering a procedurally generated planet at an
unrelaxed frame budget, with assets authored by headless Blender scripts rather
than sculpted and photoscanned. **It will not reach Elden Ring's fidelity, and
saying otherwise would be dishonest.** What is genuinely available:

- Full PBR material response (the surface families already ship normal and ORM
  maps; the albedo and alpha map type landed in RN-176 to RN-183).
- Filmic tonemapping, exposure control and colour grading.
- Normal maps carrying detail that costs no triangles.
- Higher triangle budgets where silhouette needs them, priced honestly.
- Weathering, grime and asymmetry authored procedurally, which is where
  script-authored assets are actually STRONGER than hand modelling: variation
  can be a function of position and seed rather than a repeated decal.

The gap between "current" and "the ceiling above" is very large and is almost
entirely unexploited. That is the work.

## Decisions this reframes

Do not silently reverse these. Re-examine each against this document, and record
the outcome:

- The DW-10 shader ledger exists to stop uncontrolled program growth. Realistic
  material response may legitimately need slots. The ledger is a budget with an
  argument attached, not a prohibition.
- `contracts.json` triangle budgets were sized for a low-poly game. Raising one
  is now a normal, arguable act rather than a failure.
- RN-101 concluded geometry beat leaf textures for the canopy. That was measured
  under the old target. Re-test it under the new one.
- Anything justified by "reads clean" or "stays readable at distance" needs its
  reasoning re-stated in terms of detail and material.

## What does not change

Every measurement discipline in `INSTRUMENTS.md` and every process rule in
`NUMBERS.md` stands unchanged. A new art direction is not a licence to ship
unmeasured work. Pairs, controls, invariant tables, named failure modes before
measuring, and negative controls reverted byte-identical all still apply. The
target moved; the standard did not.
