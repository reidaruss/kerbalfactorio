# Orbital Foundry: current status and resume point

**Read this first after any session break.** Living status doc, updated at milestone boundaries.
Last updated 2026-07-05.

## What this project is now

A **Three.js / WebAssembly browser game**, pivoted from Unreal on 2026-07-05. KSP crossed with
Factorio: first person by default (V toggles third person) on a real procedurally generated
planet. Harvest, hand-craft, build grid-snapped factories, dig 1 m voxel tunnels, research, and
ultimately launch to orbit and reach the moon Cinder, with no loading screens.

The headless C++ simulation in `core/` is unchanged and is the crown jewel: 22 green ctest suites,
deterministic, compiled to WASM and driven from JS. The Unreal layer is **frozen**, not deleted
(tag `ue-frozen-2026-07-05`, unfinished work on branch `archive/ue-r2b-wip`).

## Required reading, in order

1. `docs/web/DECISIONS.md` (DW-1..DW-23 plus standing engineering rules 1 to 8). **Rules 1, 5, 6
   and DW-20 are the ones that have actually bitten people.**
2. `docs/web/ARCHITECTURE.md` (engine and rendering design, milestones W0 to W9, and **§15.2,
   the growing list of things that did not survive contact with reality**).
3. `docs/web/WASM-BRIDGE.md` (the `/core` C API, ABI 2, memory and ownership conventions).
4. `docs/web/ASSET-SPECS.md` (the complete asset manifest and the Blender pipeline).
5. `docs/review-2026-06-16/RETHINK.md` (why the project was restructured; still the strategic plan).

## Milestone state

| Milestone | State |
|---|---|
| W0 skeleton, four-pass renderer, WASM handshake, dev loop | done |
| W1 streamed procedural planet renders in a browser | done |
| W2 character controller, sustained-walk floating origin, LOD stitching, reversed-Z closed | done |
| W3 sky, sun, cascaded shadows, analytic atmosphere, stream-in cross-fade, cube-face culling fix | done |
| **W4 look and feel: BatchedMesh terrain, rigged player, biome props** | **in flight** |
| W5 voxel digging and tunnels | next |
| W6 building and automation in-world (also the WebGPU re-evaluation gate) | pending |
| W7 progression: research wired to play, build costs, power | pending |
| W8 **the seam**: boardable vessel, launch to orbit | pending, the signature milestone |
| W9 Cinder | pending |

**Art manifest is COMPLETE: 42/42 assets validated**, full rebuild produces a zero-byte diff,
2.43 MB total, zero textures. Tier 0 (player rig 44 bones/14 clips, FP arms, tools, 13 machines,
9 harvest nodes, items atlas), Tier 1 (10 biome atlases, 41 props), Tier 2 (rocket parts on a
1.25 m stack contract, launch pad, lander, far-scene sphere, plume).

## Commands

```
npm --prefix web run dev                     # dev server (or the of-web launch.json entry)
node web/tools/smoke/run.mjs --scenario=surface --out=docs/screenshots/x.png [--seed= --eval='<js>']
node web/wasm/test/parity.mjs                # WASM vs native parity gate
npm --prefix web run check                   # 400-line module cap gate
python tools/blender/validate_glb.py --all   # asset contract gate (must stay 42/42)
web/wasm/build.ps1                           # rebuild the wasm (activates emsdk itself)
```

Emscripten lives at `C:\Users\reida\emsdk`. In PowerShell activate with `& "C:\Users\reida\emsdk\emsdk_env.ps1"`.

## Measured baseline (RTX 4060 Ti, 1600x900)

Full frame 0.993 ms, shadows 0.123 ms, atmosphere below the 0.03 ms floor. Draw calls 141 to 157
on the surface (**the one budget under pressure**, target 150, which is why W4 does the
BatchedMesh upgrade before adding foliage), 32 to 46 from orbit. Triangles 288 to 320k of 2.7 M.
VRAM 60.1 MB, 48 MB of it shadow maps. Oracle calls 1.9 to 3.2 us synchronous on the main thread.
Chunk build and pack 1.8 to 3.5 ms against a 12 ms gate.

## Open items and known risks

- **Draw calls** are the binding constraint, not frame time. W4a addresses it.
- The rigged player currently receives no terrain shadow, and cascade-to-cascade blending is not
  implemented (W4).
- **DW-18 is not yet implemented:** Forge should take Kerbin-like gravity (600 km radius, about
  9.81 m/s^2). Current 0.587 m/s^2 gives a 4.8 second jump, which reads as broken. This is a
  `core/` body-parameter change and it affects orbital mechanics, so do it deliberately.
- **DW-19 is half done.** Root cause found and fixed in `43a0fda` (WG-22): the LOD distance metric
  sampled the RAW heightfield for quad centres while the player stands on the DESIGNED surface, a
  590 m to 3,100 m constant offset that put an irreducible floor on distance, so the quadtree
  saturated and ignored `maxDepth` entirely (proof: maxDepth 12 and 16 gave byte-identical
  resident sets). 22 of 22 suites green with the fix. **Remaining: measure the achieved cell size
  at the player's feet in-browser and the chunk-count and frame-cost curve**, then confirm 2 m or
  finer before W5 digging starts. `core/tools/lod_probe` (commit `cc246f2`) exists for this.
- **This was the five-surfaces failure for the third time** (UE build, then the WASM bridge
  observer, now the LOD metric). Standing rule 1 says every consumer reads `surface_field.h`, and
  three separate components have still broken it. When touching anything that computes a height,
  a radius, or a distance to the ground, check which surface it samples **first**.
- **DW-15 gate:** before any native peer (multiplayer server or native port) exists, vendor
  `tan`/`asin`/`atan2`/`cos` into `/core` and re-baseline. A 1 ULP libm difference grows a
  different planet from the same seed.
- Persistence is still browser-side work: `persistence_file.h` is excluded from WASM, so the
  unified save (inventory, buildings, research, voxel edits) moves to IndexedDB/OPFS (DW-17).

## Process rules that have earned their place

1. **Commit incrementally.** Several agents were killed mid-task by account limits today. The ones
   that committed as they went lost nothing.
2. **Verification must be driven, not posed**, and per DW-20 a probe must prove it advanced the
   simulation before its numbers are trusted.
3. **Measure before believing a diagnosis.** Three separate "known" defects this session turned out
   to be misdiagnosed, including one where a proxy sphere was hiding half a missing planet.
