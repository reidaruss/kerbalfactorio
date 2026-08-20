# The Fidelity Gap: what +1000% actually requires

**Author: Admin orchestrator, at Reid's direct request, 2026-08-19.**
**Reference pair: Reid's meadow frame (build f4a200b, plains, standing eye) against the Space Engineers alpha 11/2015 grassland shot. The instruction: ignore the ships, look at the world.**

## 1. What is actually different between the two frames

Putting the frames side by side and being honest about it, the gap is not one defect. It is five missing SYSTEMS and one process failure. Item by item, what SE's landscape has and ours does not:

1. **The ground IS grass there; here grass sits ON the ground.** SE renders a continuous grass carpet: dense instanced blades near the camera whose colour matches the terrain beneath, fading into a grass-textured terrain material at distance. There is no visible "bare substrate with clumps on it" anywhere in their frame. Our frame is a flat sandy substrate with discrete chunky tufts scattered at prop density. This single difference is roughly half the perceived gap: the eye reads their ground as a material and ours as a table with objects on it.
2. **Their terrain wears materials; ours wears a palette.** SE's mountains read as rock with snow because they are textured with albedo, normal and roughness layers blended by slope and altitude. Our terrain has NO texture layers: two greyscale detail maps (of_ground.png, of_ground_relief.png, see GroundTextures.ts) modulate a procedural per-biome colour. That is why our ground reads as tinted noise at every distance, and why the audit found "no material at all past 75 m": there was never a material, only near-field detail modulation.
3. **Their sky is a participant; ours is a backdrop.** SE has a blue gradient sky with clouds, and that sky visibly LIGHTS the scene: shadowed grass is blue-green, not black. Our ambient is a hand-tuned scalar ladder (TerrainAmbient.ts literals), not a sky-coloured hemisphere, and we have no cloud system at all. Their shadow side has colour and air; our shadow side goes toward black (AO at strength 0.9, radius 0.9 m reads as hard dark blobs under every tuft).
4. **Their frame is graded; ours is raw.** The SE shot has colour harmony: greens sit together, the sky-to-ground balance is composed, distance goes gently blue. We ship ACES straight to canvas with no grading pass, saturated foliage greens against orange dirt, and the audit-confirmed milk-wall horizon. Grading is the cheapest multiplier in this document and we have never spent one lane on it.
5. **Their vegetation assets are an order of fidelity higher.** Individual SE grass blades and trees are unremarkable, but they are dense, soft-shaded, translucent-looking and colour-coordinated. Our props are chunky low-poly with hard facet shading and no translucency approximation (the whole conifer is 791 triangles at LOD0; the ceiling study proved triangles are not what we are short of). Better lighting cannot rescue chunky source geometry; this is an asset ceiling, not a shader ceiling.
6. **Water.** Their lake anchors the composition. We have a water shader and an underwater pass but no canonical landscape uses water as a compositional element. Minor beside 1 to 5; listed for completeness.

## 2. Why three weeks of "make it better" produced +2% instead of +1000%

This is the part Reid asked me to face directly, and the machine's own records show the mechanism:

- **We optimised what we could verify.** The whole apparatus (probes, pngdiff, luma rectangles, verifiers) rewards measurable correctness. Every art lane proved its delta against instruments, and the instruments cannot measure "reads as a lush world". So the system converged on CORRECT: correct haze constants, correct LOD counts, correct tile chequerboards. Correct and beautiful are different axes, and nothing in the loop pulled toward the second.
- **Every lane judged itself against yesterday's frame, not against the bar.** The masonry, pad and ashlar passes were each genuine improvements over their predecessors and each was allowed to call that a win. Anchoring drift: a thousand +2% steps against a moving self-reference never reach a fixed external reference. The D-020 bar existed as words; no lane ever put an SE frame beside its own output and had to survive the comparison.
- **The gap is multiplicative, and we worked additively.** Carpet x materials x sky-light x grading x assets multiply into the SE look. Tuning any one system while four are absent moves the product a few percent, which is exactly what Reid has been seeing. No amount of haze-constant work makes a bare substrate read as a meadow.

## 3. The options

### Option A: build the five systems in the browser (RECOMMENDED)

The ceiling study proved the headroom exists: ~10 ms against a 16.6 ms budget on the heavy scene, not fill-bound across a 16x pixel sweep, 74 spare draw calls, and 58.8 per cent of current triangles are recoverable shadow waste. Nothing below needs WebGPU or native.

- **A1. Image pipeline first (1 lane, days).** Exposure and tone response tuned per sun elevation, a colour-grading pass with a chosen palette, AO softened from black blobs to coloured occlusion, shadow ambient fill from a sky colour, bloom restraint. A global multiplier on every frame including everything built later. Do this first so every subsequent lane is judged through a competent image.
- **A2. Ground-cover carpet (1 to 2 lanes).** GPU-instanced grass blades and tufts, on the order of 50 to 150 per square metre near the camera, colour SAMPLED FROM the terrain beneath each instance so ground and cover cannot disagree, wind, fading by 60 to 100 m into A3's grass texture layer. Our own instancing layer already proves six-figure instance counts are fine. This kills the billiard-table read in one lane and is the single largest visual win available.
- **A3. Terrain PBR splatting (2 lanes).** Four to six real texture layers (grass, dirt, rock, cliff, scree, snow) blended by slope, altitude and biome, near field plus the far-field hole the audit flagged. Source the layers from Polyhaven (CC0, photoreal PBR, no attribution required, redistributable), routed through texgen for byte-determinism, so material quality stops being an authoring bottleneck.
- **A4. Sky system (1 lane).** Sky-coloured hemispheric ambient replacing the scalar ladder, a cloud layer (a textured dome is enough; SE's own clouds are simple), a sun disc, and the aerosol re-reference from the paused L1 brief folded in, so distance goes blue instead of white. **CORRECTION, 2026-08-20 (SUPERSEDED, kept above rather than rewritten):** this bullet's aerosol case rested on WORLD-AUDIT-2026-08-19.md's gap-1 headline of 77.5 per cent, measured through a contaminated `?atmos=0` control that deletes the sky and voids a third of the rectangle; A4's own verifier corrected that to a 44.5 per cent basis via the honest `?aerosol=0` control (rendering.md 2.12.2), which is what A4 actually shipped against.
- **A5. Vegetation uplift plus the far tier (2 lanes).** Re-author the prop and tree sets at higher polygon budgets with soft normals and a translucency approximation for foliage (the current chunky look is a style accident, not a constraint), plus the impostor far rung from the paused L2 brief so the world stays forested from the air. The bake-pipeline map for the far rung already exists (the L2 scout's report: LOD3 emission is nearly free in the builders; the real work is two client-side blockers in NodeBatchTypes/NodeField and a last-writer-wins slot bug in PropLibrary.register that must be fixed first).

Sequencing: A1, then A2, then A3, with A4 and A5 behind them. Honest estimate: 8 to 12 lanes to a frame that stands beside the SE shot without embarrassment.

### Option B: switch to native or an engine

Rejected on the evidence. The ceiling study measured that the platform is not the constraint, and the five missing systems are engine-agnostic work that would still need doing after a 40-to-80-lane-week port. An engine's built-in foliage and GI tools mainly benefit human artists clicking in editors; our production is code-and-pipeline, which the browser serves fine.

### Option C: WebGPU

Re-gate only if a specific system hits a real wall. None of A1 to A5 does; the one genuine WebGL2 hard limit found was clustered many-light rendering, which no landscape item needs.

### Option D: the process change (MANDATORY, whichever option)

Hero-frame development:

1. Freeze THREE hero frames: this meadow view, the ridge vista, the dawn shot. Beside each, a reference board of two or three SE landscape frames.
2. Every graphics lane ships a side-by-side of its after-frame against the REFERENCE BOARD, not against its own before-frame, and an explicit statement of which numbered differences from section 1 it closed, partially closed, or did not touch.
3. Instruments are demoted to regression rails (determinism, perf budgets, no popping). They stop being the definition of done for look work.
4. Reid rates the hero frames each play session on the only scale that matters: does this read closer to the bar. Tonight's +2% verdict is the first data point of exactly this loop, and it caught what every instrument missed.

## 4. What this does NOT require

No renderer rewrite, no native port, no WebGPU migration, no new hardware, and no waiting: A1 and A2 are independent of everything else and are each a single-lane change to files no other lane owns.
