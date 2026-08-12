# Handoff from the forked orchestrator session, 2026-08-12 ~21:15

**Context: two orchestrator sessions ran concurrently today (a fork; Reid noticed and closed this one). This file is what the fork learned and landed that the surviving session may not know. Delete this file once absorbed.**

## Landed and pushed by this fork (desktop hour, Reid-authorised real-GPU work)
- **`lane/probe-fixtures` (2d94384), pushed, ready to merge after a look:** maneuver.js catalogue fixture 24 -> 25 (EngineVernier 0x0116), carrier.js C1/C7 rewritten for the stamped moving station.
- **maneuver.js FIRST REAL VERDICT: GREEN on real GPU** (64 rows ok, orbit 86.5 x 80.3 km, e 0.00452). The sole known-red.json entry is therefore CLEARED as an instrument defect; a gate-flip prerequisite is satisfied.
- **carrier.js 42/43** with the two rewritten rows green. The one red is NEW and genuine: rotor row C1, perTickM 31.32092 vs r*w 31.320866, relative ~1.7e-6 against 1e-6 tolerance; the rotor seeds `from: 'station'` and the stamped station plausibly perturbed it just past tolerance. Single run; needs a diagnosis lane (core-engine).

## Verified on real GPU this evening (desktop, main 9487e22)
- **apexec.js GREEN, 256 s wall**: the historical 50 km shortfall did NOT reproduce; miss -26.6 m on an 800 km ask, planned dv spent to 7 s.f. D3D baselines recorded: apexec 256 s, post 90 s, carrier 120 s (all SwiftShader timeouts on the VM).
- Second-sourced green: stationboard 29/29, mapbody, markers, pickaxegate, objectives, harvest, stationframe headline (its CONTROL row is display-cadence-sensitive at high fps: at 1.91 frames/tick only two alpha phases sampled, collider peak-to-peak reads 13.55 m not ~31.32; instrument note, core-engine).

## CRITICAL, already known to the surviving session but re-confirmed with mechanism
- **main's committed wasm dist (built at 205cef6) predates gameplay.h's research station (271b58c)**: /core returns item 0/typeId 0 for it while the client gates research on building it. researchstation.js (~41 cascading fails) and buildmenu.js reds on main-as-committed are ALL this. The Release ABI-24 settled rebuild is mandatory and probably also explains the post.js placement anomaly (only 2 of 7 machines stand; recheck after the rebuild, not before).
- **buildmenu.js residuals to recheck post-rebuild:** researchstation tile has no icon (still text) and sandbox greying flags it locked.
- Runner gate confirmed unflipped (reds print smoke: PASS, exit 0) per design; flip prerequisites are in ADMIN.md's 2026-08-12 midday note, with prerequisite (2) maneuver verification NOW SATISFIED by this handoff.

## Reid rulings given to this fork today (relay)
- Desktop heavy work was authorised for one hour ending ~21:20 2026-08-12; expired, do not assume it.
- The model bump (sonnet->opus, opus->fable) expired ~11:30 2026-08-12.
- Reid: no need to ask before restarting the served build while he is not testing.
