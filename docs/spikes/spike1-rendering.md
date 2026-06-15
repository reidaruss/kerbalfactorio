# Spike 1 — Rendering: Seamless Scaled-Space Traversal (the visual sell)

> **Domain:** Rendering & Graphics (Wave 2, consumes Wave-1 contracts) · **Phase:** 0 · **Spike:** 1 (highest-risk item) · **Status:** Designed, ready to build · **Last updated:** 2026-06-14
> **Owner:** `rendering-controller` · Read alongside: [rendering.md](../controllers/rendering.md) · **[Spike 1 core-engine design](spike1-core-engine.md)** (§5 contracts, `OnOriginRebased`/`OnSOIChange`) · **[Spike 1 world-gen design](spike1-worldgen.md)** (§4 `FTerrainChunk`, §5 `FBodyParams`/`FAtmosphereProfile`) · [MASTER_PLAN](../MASTER_PLAN.md) §6, §11 D-001/D-006 · [AGENT_ARCHITECTURE](../AGENT_ARCHITECTURE.md)
> **Co-domains:** core-engine (Wave 1 DONE — frames, floating origin, the two events) · world-gen (Wave 1 DONE — terrain chunks, body/atmosphere params)

---

## 0. Purpose & the one question this spike answers

Core-engine's Spike-1 proves the seam is **physically achievable** (no precision wobble, no Chaos kraken, no hitch) and ships a **placeholder single camera** so its demo runs. This spike proves the seam is **visually seamless** — that walk → orbit → land → walk **looks** like one continuous shot with **no loading screen, no pop, no z-fighting, no lighting jolt**. Replacing core-engine's placeholder camera with the real **dual-camera scaled-space rig** is *our* deliverable; everything here hangs off that.

This retires the rendering-side risks (rendering.md §7):
- **R2** — scaled↔near cross-fade artifacts (popping, lighting mismatch) on fast approach. *This is the make-or-break visual risk and the core of §2/§7.*
- **RN-2-area** — a 1 m object and a 10⁹ m body drawn in one frame with no z-fighting (§3).
- **R1** — Nanite cost on terrain (measured, §5/§7).

**Non-goals (hard scope fence):** no factory rendering (the LOD ladder is sketched conceptually in §5.4 only — it is not built this spike); placeholder art only; no water/cloud sim; one star + Forge + Cinder. We consume world-gen geometry and core-engine transforms; we do **not** redefine either's contract — gaps are flagged for Admin (§7, Completion Report).

**Locked decisions honored:** RN-1 (dual-camera scaled space), RN-2 (log/cascaded depth), D-001 (UE5; Nanite/Lumen provisional), D-006 (body constants from the single canonical Body Definition, consumed via world-gen `FBodyParams`/`FAtmosphereProfile` — **we hardcode nothing**).

---

## 1. Dual-camera scaled-space rig (RN-1)

### 1.1 The problem the rig solves

A planet's surface detail is ~1 m; the planet is 600 km across; its SOI reaches 84,000 km; the star is further still. No single perspective camera with one near/far pair can hold a 1 m rock and an 84,000 km horizon in the same frustum without the far plane being absurd and depth precision collapsing. KSP's answer — and ours (RN-1) — is **two scenes rendered by two cameras at two different scales, composited into one image.** The player never knows there are two.

### 1.2 The two scenes

| | **Near scene** | **Scaled scene** |
|---|---|---|
| **Camera** | `NearCam` | `ScaledCam` |
| **Renders** | Everything within the active bubble at true 1:1 scale: streamed terrain (`FTerrainChunk`), the observer/craft, nearby physics objects, near atmosphere volume, VFX. | Distant celestial bodies as **low-poly baked proxies** at a shrunk scale: Forge proxy, Cinder proxy, the star/sun billboard, starfield skybox. |
| **Scale** | 1.0 (UE world units = meters, floating-origin–anchored) | `SCALED_K = 1 / 6e5` ≈ **1.67e-6** (see §1.3) |
| **Origin** | Floating origin (observer near (0,0,0)) | Fixed scaled origin; proxies placed at `UniverseCoord × SCALED_K` |
| **Depth** | Logarithmic depth (§3), near=0.1 m, far≈ a few hundred km | Its own perspective range at scaled units; far plane covers the whole system in scaled space |
| **Lit by** | Real directional light (sun) + Lumen/sky | Same sun direction; proxies use baked/cheap lighting matched to the near sun (§2.4) |
| **Draw order** | Drawn **second**, composited **on top** | Drawn **first** (background) |

The near scene is *the world you can touch*. The scaled scene is *the world you can see but not yet reach*. The whole seamless trick is: as you approach a body, its representation **migrates from the scaled scene into the near scene** (§2). A frame is always "scaled background + near foreground, depth-merged."

### 1.3 The scale factor

`SCALED_K` shrinks universe meters into a small, float-safe scaled-space coordinate so the scaled camera's near/far range is sane and its depth precision is fine.

- We pick `SCALED_K = 1 / Forge.RadiusM` = `1 / 6.0e5` (Forge's radius comes from `FBodyParams.RadiusM`, **not** a literal). In scaled space Forge has radius **1.0 uu**, Cinder ≈ 0.33 uu, the star is a few thousand uu out, the planet→moon distance is tens of uu. The whole system fits in a sphere of a few thousand scaled units — trivially inside a single perspective frustum with healthy depth precision.
- `SCALED_K` is a constant for the spike (one star system). It is read from the canonical body radius so if Forge's radius is retuned, the rig rescales automatically (D-006 discipline).
- Conversion: `scaledPos(coord) = (coord − ScaledSpaceOrigin).InFrame(StarFrame) × SCALED_K`. The scaled scene lives in **StarFrame** (the universe root) so all bodies share one stable scaled coordinate space regardless of which SOI the observer is currently in.

> **Why root-frame for scaled space:** the near scene rebases constantly (the observer moves); the scaled scene must **not** — distant bodies should sit rock-still in the sky while you walk. Anchoring scaled space to the non-rotating `StarFrame` root (and only *re-orienting/re-positioning the ScaledCam*, never the proxies, per §1.5) gives a stable celestial sphere.

### 1.4 Compositing into one image

Two render passes, one output. Order each frame:

1. **ScaledCam renders first** into the scene color/back buffer: starfield skybox → star → body proxies (Forge, Cinder), with its own depth. This is the "infinitely far" backdrop.
2. **NearCam renders second on top**, *not clearing color*, into the same target. The near scene's log-depth (§3) governs occlusion **within** the near scene. Because everything in the near scene is, by construction, nearer than everything in the scaled scene (a body you can touch has migrated *into* the near scene — see §2), near pixels simply overwrite scaled pixels wherever the near scene drew geometry. Sky/empty near-scene pixels keep the scaled backdrop.
3. The **atmosphere/aerial-perspective** (§4) is applied as a post step that can see **both** depths so the horizon haze correctly fades the scaled proxy of the *same* body when partially migrated (the one subtle case, handled in §2.3).

**UE5 implementation of the composite** (two candidate paths, decided in build step 2, §6):
- **(A) Two `UCameraComponent`s + a custom `ViewExtension` / two-pass `SceneViewFamily`** that renders ScaledCam then NearCam into one view, near depth-cleared, scaled not. Cleanest for sharing one post-process/atmosphere stack; this is the intended path.
- **(B) `SceneCaptureComponent2D` for the scaled scene → render target, sampled as a far-background material under the main near camera.** Simpler to stand up, but the scaled pass becomes a flat backdrop (loses true depth interplay during migration) and costs a full extra capture. **Fallback only** if (A)'s custom view extension proves too heavy for the spike timeline.

We build **(A)** but keep **(B)** as the de-risk fallback (noted in §7).

### 1.5 How the rig is driven by core-engine frames + floating origin

The rig is a slave to core-engine's authority — it owns *no* positions, only *projections* of them.

- **NearCam** is parented to the observer pawn (core-engine build step 7) so it lands near (0,0,0) every rebase automatically. Its world transform is the observer's engine-space transform; nothing special needed beyond following the pawn.
- **ScaledCam** shares the NearCam's **orientation** (you look the same direction in both scenes) and its **scaled position**: `ScaledCam.pos = scaledPos(observer.UniverseCoord)`. The observer's `UniverseCoord` is read from the active `SimProxy.Position()` (core-engine §5.3) and converted by §1.3. ScaledCam's *rotation* = NearCam's rotation exactly; its *FOV* = NearCam's FOV exactly. Same lens, two scales.
- **On `OnOriginRebased(DeltaEngine, NewOrigin)`** (core-engine §1.6): the **near scene** re-anchors — NearCam is already pawn-parented so it's automatic, but **world-space-referenced render state must re-anchor**: world-position-node materials, Niagara world-space emitters, decals, any cached world-space vectors, and (critically) the **Sky Atmosphere component transform** (§4.3) all shift by `−DeltaEngine` or re-read `NewOrigin`. The **scaled scene does nothing** on a rebase — its coordinates are root-frame authority-derived, which a rebase doesn't change (§1.3). We subscribe one handler:
  ```cpp
  FloatingOrigin.OnRebased().AddUObject(this, &UScaledSpaceRig::HandleOriginRebased);
  void UScaledSpaceRig::HandleOriginRebased(const FVector& DeltaEngine, const FUniverseCoord& NewOrigin) {
      ReanchorWorldSpaceMaterials(DeltaEngine);   // re-base any cached world-space deltas
      ReanchorAtmosphereTransform(NewOrigin);     // §4.3 — keep Forge's atmosphere centered on Forge
      // ScaledCam: nothing — its pos is recomputed from authority each frame (§1.5).
      // NearCam: nothing — pawn-parented, core-engine already ApplyWorldOffset'd the pawn.
  }
  ```
  We also honor the `rebasedThisTick` flag (core-engine §4.3): on a rebased tick we do **not** interpolate camera/world-space transforms across the discontinuity — we snap, so there is never a lerp across the teleport. This is the rendering half of core-engine's anti-pop guarantee (V2).
- **On `OnSOIChange(FSOIChangeEvent)`** (core-engine §2.3): the rig re-evaluates which body is the **approach target** and which proxies migrate (§2). Position/orientation continuity is already handled by core-engine's re-expression; rendering just updates *which* body is "the one we're landing on." No camera teleport — the SOI change is a coordinate re-expression, and scaled space is in the root frame so the celestial backdrop doesn't jump.

> **Net:** core-engine moves the universe; we render two projections of it and never fight the authority. Every position we draw is `coord.ToEngine(FloatingOrigin)` (near) or `scaledPos(coord)` (scaled). We store no independent world positions that a rebase could desync.

---

## 2. Scaled-proxy ↔ real-terrain transition (the no-loading-screen moment) — retires R2

This is the half that sells the premise: the instant a distant blue dot **becomes ground under your feet** with no seam. It is a **cross-fade across altitude bands**, driven by world-gen streaming (`OnChunkReady`) and stabilized against the floating origin.

### 2.1 The approach bands (per body, altitude above its surface)

Altitude `alt = ‖observer.UniverseCoord − bodyCenter‖ − Body.RadiusM` (authority-space, body params from `FBodyParams`). Bands (tunable; values are scale-relative, derived from `RadiusM`/`SoiRadiusM`, not literals):

| Band | Altitude (Forge example) | Scaled proxy | Near terrain | Atmosphere |
|---|---|---|---|---|
| **B0 Distant** | > ~1 SOI-ish / very far | full proxy, lit, in scaled scene | not streaming | off |
| **B1 Approach** | ~SOI → ~3 R (≈ 1.8e6 m) | proxy still drawn | world-gen begins streaming **coarse** root-face chunks (we forward observer pos to `UpdateStreaming`) | off |
| **B2 Handoff** | ~3 R → ~1.1 R (≈ down to ~60 km) | proxy **cross-fading out** | coarse→mid LOD chunks resident (`OnChunkReady` firing); near terrain now occludes where present | **fading in** (Forge only; §4) |
| **B3 Surface** | < ~1.1 R (atmosphere top ~70 km and below) | proxy **fully off** for this body | full LOD chunks streaming down to walking detail | full (Forge) |

Cinder (airless, `bHasAtmosphere=false`) uses the same bands minus the atmosphere column — its terminator is sharp and the proxy→terrain swap is the *only* transition.

### 2.2 What swaps when

- **Geometry handoff.** In B1 we ask world-gen to start streaming (`ITerrainProvider::UpdateStreaming(observer.UniverseCoord, SimTime)`). World-gen fires `OnChunkReady(const FTerrainChunk&)` as coarse chunks become resident; we build a UE mesh per chunk (§5) and draw it in the **near scene**. The body's **scaled proxy keeps drawing** through B1/B2 so there is never a hole — the proxy is the safety backdrop until real terrain covers that solid angle.
- **The cross-fade (B2).** We do **not** hard-swap proxy→terrain (that pops). Instead, across B2 we drive a blend parameter `proxyAlpha: 1→0` by altitude. Two complementary mechanisms, layered:
  1. **Occlusion-first:** real terrain is *opaque and nearer*, so wherever a near chunk has streamed in, it already covers the proxy behind it — no blend needed there. The proxy only shows through *gaps* (chunks not yet resident).
  2. **Dither/temporal fade on the proxy** for the gaps: as `proxyAlpha→0`, the proxy fades via a screen-door/dither (TAA-resolved) so any still-unstreamed sliver dissolves rather than vanishing. By B3 every solid angle is covered by resident terrain and `proxyAlpha=0`, so the fade is invisible.
- **Reverse (ascent)** runs the bands backwards with hysteresis (a separate fade-out altitude from fade-in, mirroring world-gen's LOD merge hysteresis and core-engine's promotion hysteresis) so hovering at a band edge can't flicker proxy on/off.

### 2.3 The one subtle case — partial migration & the horizon

While in B2 the *same body* is partly near-terrain (foreground) and partly scaled-proxy (far backdrop, beyond the streamed cap). The horizon is where they meet. Two things keep it seamless:
- The near terrain's outer streamed edge sits **below** the proxy's silhouette (proxy radius == real radius in projected size because `SCALED_K` is exact and both derive from `RadiusM`), so the proxy reads as "the rest of the planet curving away" — geometrically continuous with the near terrain.
- **Aerial perspective (§4) is applied over both depths**, so atmospheric haze thickens identically on near terrain and on the proxy at the same world distance — the seam is washed into the same fog gradient. (This is why the composite is depth-aware, §1.4 step 3.)

### 2.4 Pop & lighting-mismatch mitigation (R2 — the core risk)

R2 is "popping + lighting mismatch on fast approach." Mitigations, each mapped to a failure mode:

| Failure mode | Mitigation |
|---|---|
| **Geometry pop** (proxy snaps to terrain) | Cross-fade band B2 with dither + occlusion-first (§2.2); never a hard swap. World-gen's own swap-when-4-children-ready (worldgen §3.2) guarantees no half-built near mesh. |
| **Pop-in holes during fast descent** | Proxy stays drawn as backdrop until terrain covers it; world-gen per-tick generation budget (worldgen §3.2) spreads mesh build; we gate `proxyAlpha=0` on "near terrain covers the body's solid angle," not purely on altitude. |
| **Lighting mismatch** (proxy lit differently than near terrain) | **Single shared sun.** Both scenes use the *same* directional light vector (sun direction from the star frame). Proxy material is baked/shaded to match the near terrain's albedo + the same sun so brightness/terminator line up. The proxy's terminator and the near terrain's terminator are the *same* sun-relative angle, so they meet continuously at the horizon. |
| **Atmosphere seam** (sky color differs proxy vs near) | One UE Sky Atmosphere centered on Forge drives *both* the near aerial perspective and (via matched RayleighTint) the proxy's rim, so the limb glow is continuous (§4). |
| **Rebase pop mid-approach** | The cross-fade is altitude-driven (authority distance), which a rebase does not change; `rebasedThisTick` snaps transforms. So a rebase firing mid-descent does not perturb `proxyAlpha` and produces no visual discontinuity (validated V-R3 / ties core-engine V2, world-gen WV5). |

**Pass criterion for R2** (§7): across a full B0→B3 descent at orbital speed (≥2 km/s closing), filmed frame-by-frame, there is **no single-frame jump** in the body silhouette, **no visible lighting/terminator discontinuity** at the proxy↔terrain horizon, and **no flicker** at band edges.

---

## 3. Depth strategy (RN-2) — 1 m and 10⁹ m in one frame, no z-fighting

### 3.1 The split: two cameras already do most of the work

The dual-camera rig (§1) is itself the first line of depth defense: the near scene only ever holds geometry from ~0.1 m to a few hundred km (everything beyond has migrated to scaled space), and the scaled scene holds 10⁻⁶-scaled bodies whose *scaled* depth range is tiny. **Neither camera individually spans cm→10⁹ m** — that span only exists across the *composite*, where the scaled scene is unconditionally behind the near scene (§1.4). So the catastrophic single-frustum case is structurally avoided.

But the **near scene alone still spans ~0.1 m (a bolt) to ~300 km (the streamed terrain horizon + far near-atmosphere)** — ~6 decades. A standard 24-bit integer depth buffer gives ~4 usable decades and *will* z-fight terrain at the horizon against close geometry. That is what RN-2 fixes, in the near camera.

### 3.2 Logarithmic depth in the near camera (RN-2 → Accepted)

We adopt the **logarithmic depth buffer** (Outerra technique, the canonical planetary-renderer solution). The mapping makes depth precision proportional to 1/z, matching how projected feature size scales, so a 24-bit buffer covers ~9 decades — cosmic range — with no z-fighting.

The math (from Outerra), applied in the near camera's shaders:
```
// vertex stage (per the rig's near-scene shaders):
//   C tunes the linear near region; w is clip-space w (eye-space distance)
out float vLogZ;
gl_Position.z = (2.0 * log(gl_Position.w * C + 1.0) / log(FAR * C + 1.0) - 1.0) * gl_Position.w;
vLogZ = 1.0 + gl_Position.w * C;     // pass to fragment for the per-pixel correction

// fragment stage — REQUIRED, because the vertex log-z is only exact at vertices;
// linear interpolation of a logarithmic quantity strays between vertices:
gl_FragDepth = log(vLogZ) / log(FAR * C + 1.0);
```
- `C ≈ 0.01` keeps ~the nearest 10 m linear (no banding on close geometry); tuned to our near tessellation.
- `FAR` = the near camera's far plane (a few hundred km — past it is scaled space's job).
- **Fragment-shader depth write is mandatory** for correctness on large triangles (terrain), per Outerra. Cost: writing `gl_FragDepth`/`SV_Depth` disables early-Z on those passes. We **scope log-depth to the geometry that needs it** (large terrain + far near-objects); tiny near props can stay on standard depth since they never z-fight at distance. (Measured in V-R2, §7.)

### 3.3 The UE5 reality check (D-001 — the real engineering tension)

UE5 does **not** expose a clean "turn on log depth" switch, and this is the load-bearing risk in this section:
- UE5 uses a **reversed-Z floating-point depth buffer** by default. Reversed-Z float already buys a lot of far-range precision "for free" — for a few-hundred-km near scene it may *alone* be enough, making a custom log buffer unnecessary. **First experiment (V-R2): measure whether reversed-Z float depth z-fights at the near-scene horizon at all.** If it doesn't, RN-2 is satisfied by the engine default and we *don't* pay the `SV_Depth` cost.
- If reversed-Z float is insufficient, we inject a **custom log-depth output** via a global material/shader modification (custom `SV_Depth` write in the terrain material + a translucent/world-position offset path), or a **cascaded/segmented depth** scheme: split the near scene's range into 2 depth sub-ranges (e.g. 0.1 m–5 km and 5 km–300 km) rendered as ordered passes, each with its own near/far, composited back-to-front. Cascaded depth sidesteps `SV_Depth` (keeps early-Z) at the cost of an extra pass — RN-2's text explicitly allows "logarithmic **or cascaded**."
- **Nanite interaction (D-001):** Nanite manages its own visibility/depth and does **not** support a custom per-pixel `SV_Depth` write. So **log depth and Nanite-on-terrain are partly incompatible.** This pushes us toward: reversed-Z-float-is-enough (best), or cascaded passes (Nanite-compatible), rather than a global `SV_Depth` hack. **This is the single most important depth finding and is flagged in §7.**

**Decision (this spike):** try in order — (1) **reversed-Z float default** (measure first); (2) **cascaded near-depth passes** (Nanite-safe) if (1) z-fights; (3) custom `SV_Depth` log write (non-Nanite terrain only) as last resort. RN-2 is satisfied by whichever passes V-R2 cheapest. We do **not** commit to Nanite-on-terrain until this is measured (§5, §7, R1).

### 3.4 Interaction of depth with the two cameras

- The **scaled camera** uses **plain depth** at scaled units — its range is tiny (a few thousand scaled uu), so standard depth is fine; no log needed there.
- The **composite** (§1.4) does not depth-merge the two cameras into one buffer (their depths are in different scales). Instead the near scene is unconditionally composited **over** the scaled scene; correctness holds because §2 guarantees anything you can reach is *in* the near scene. The only depth interplay needed is in §2.3 (horizon haze), handled in the post pass with the near depth + a known proxy distance, not by sharing a depth buffer.

---

## 4. Atmospheric scattering (the sky-fades-to-black sell)

### 4.1 Approach — UE5 Sky Atmosphere, parameterized from `FAtmosphereProfile`

Rayleigh + Mie scattering driven by camera altitude + sun direction, per planet. We use UE5's built-in **Sky Atmosphere component** rather than a hand-rolled shader: it implements physically-based Rayleigh + Mie + absorption, and (verified, research) **explicitly supports moving "seamlessly from the planet's surface through the atmosphere to outer space"** with the sky naturally fading to black as altitude rises — exactly the sell we need. Rolling our own analytic LUT scattering is a Phase-1 option if the built-in proves too inflexible, but for the spike the built-in retires the risk fastest.

### 4.2 Mapping `FAtmosphereProfile` → Sky Atmosphere parameters (D-006: consume, never hardcode)

Forge's atmosphere comes entirely from world-gen's `FBodyParams.Atmo` (`FAtmosphereProfile`, worldgen §5). We map:

| `FAtmosphereProfile` field | UE Sky Atmosphere parameter | Notes |
|---|---|---|
| (`FBodyParams.RadiusM`) | **Ground Radius** | Forge 600 km — read from body params, not literal |
| `AtmoTopM` (~70 km) | **Atmosphere Height** | altitude where atmo→vacuum |
| `ScaleHeightM` (~5,600 m) | **Rayleigh Exponential Distribution** | the e-folding height that drives sky-fades-to-black |
| `SeaLevelDensity` / derived | **Rayleigh Scattering Scale** | tuned so sea-level sky reads blue at the configured density |
| `RayleighTint` | Rayleigh scattering color + **proxy rim tint** (§2.4) | the one field that also drives the scaled proxy's limb so near/scaled match |
| (derived, placeholder) | **Mie Scattering / Mie Exponential Distribution / Mie Anisotropy** | haze near horizon; spike uses modest defaults (no per-body Mie field yet — see gap, §7) |
| (derived) | **Aerial Perspective View Distance Scale** | thickens distance haze; tuned so the proxy↔terrain horizon (§2.3) blends |

**No atmosphere constant is authored in rendering.** If world-gen retunes `ScaleHeightM`, the sky thickness changes with zero rendering edits (D-006).

### 4.3 Driving it from camera altitude + sun + the floating origin

- **Altitude/look:** the Sky Atmosphere computes scattering from the camera's position relative to the planet center automatically — as the NearCam climbs from surface through `AtmoTopM`, Rayleigh density falls off by `ScaleHeightM` and the sky **fades from blue → deep blue → black**. No manual altitude wiring; we just keep the component centered on Forge.
- **Centering on Forge under floating origin:** the Sky Atmosphere transform mode is **"Planet Center at Component Transform,"** and the component is positioned at `Forge.center.ToEngine(FloatingOrigin)` each frame and re-anchored on `OnOriginRebased` (§1.5 `ReanchorAtmosphereTransform`). This keeps the atmosphere shell glued to Forge's real center as the origin shifts — without it, a rebase would slide the whole sky.
- **Sun direction:** the scene's directional light uses the star→Forge direction (from the frame graph); the same vector lights the near terrain, the proxy (§2.4), and the scattering — one sun, continuous terminator.

### 4.4 Cinder is airless — skip

`Cinder.bHasAtmosphere == false`. We render **no** Sky Atmosphere for Cinder: black sky right to the horizon, a **sharp terminator**, hard shadows, stars visible in daytime. This is also why the **single-atmosphere limitation** of UE Sky Atmosphere (verified, research: "render multiple planetary atmospheres at once — not supported") is a **non-issue this spike** — only Forge has one, and you're never inside both at once. **Flagged for Admin** as a real constraint for the multi-body future (§7).

---

## 5. Terrain LOD rendering — consuming `FTerrainChunk`

### 5.1 Chunk → UE mesh

World-gen owns LOD *selection*, streaming, seams, skirts; **rendering owns turning each resident `FTerrainChunk` into a drawn mesh and shading it.** We subscribe:
```cpp
TerrainProvider->OnChunkReady().AddUObject(this, &UTerrainRenderer::BuildChunkMesh);    // const FTerrainChunk&
TerrainProvider->OnChunkEvicted().AddUObject(this, &UTerrainRenderer::ReleaseChunkMesh); // FQuadKey
```
Per `OnChunkReady`:
- Create a mesh component from `Positions` (interior grid) + `Indices`, with `Normals`, `UVs`, and the **skirt** drawn from `SkirtIndices` (worldgen §4.1) so LOD-boundary cracks stay hidden — we render the skirt; world-gen sized it.
- Positions are **chunk-center-local small floats** (worldgen §3.4); we set the component transform to `Chunk.CenterUniverse.ToEngine(FloatingOrigin)` (worldgen §4.1) and draw the local positions under it. 32-bit-safe by construction.
- `MaterialId` (0=planet-rock, 1=moon-regolith) selects a placeholder material instance (rendering owns the materials; world-gen owns the id). Slope/altitude-based placeholder tint only (no biomes this spike).

### 5.2 Instanced vs Nanite (D-001, R1)

| Option | Use | Risk |
|---|---|---|
| **ProceduralMeshComponent / RealtimeMeshComponent** (classic) | Default for the spike. Streamed quad meshes are already LOD-selected by world-gen, so we don't need Nanite's auto-LOD; classic meshes give us a clean `SV_Depth`/cascaded-depth path (§3.3) and predictable cost. | Many components → draw-call count; mitigated by world-gen's bounded resident-quad count (3-frame system, two bodies). |
| **Nanite** | Evaluate as an experiment (R1). Nanite *could* offload triangle/LOD budget for very-high-detail terrain. | **Conflicts with custom log-depth `SV_Depth` (§3.3).** Nanite on dynamically-streamed procedural meshes is also not its sweet spot (it favors static high-poly assets). **Likely net-negative for spike terrain;** measured in V-R1. |

**Decision (this spike):** **classic streamed meshes** (RealtimeMeshComponent), **not Nanite**, for terrain — because (a) world-gen already does LOD so Nanite's headline feature is redundant here, and (b) Nanite blocks the cascaded/`SV_Depth` depth path we may need (§3.3). Nanite's real payoff is **later factory meshes** (RN-4, dense static-ish machine geometry) — noted, not built. **R1 verdict for terrain: lean classic; re-test Nanite only if classic draw-calls blow the budget.**

### 5.3 Re-anchoring on `OnOriginRebased`

We do **not** rewrite vertices on rebase. Per worldgen §3.3, only the per-chunk **component transform** is the `UniverseCoord→engine` projection. Our handler (one line per resident chunk):
```cpp
void UTerrainRenderer::HandleOriginRebased(const FVector& DeltaEngine, const FUniverseCoord& NewOrigin) {
    for (auto& [key, comp] : ResidentChunkComponents)
        comp->SetWorldLocation( ChunkCenters[key].ToEngine(NewOrigin) );  // §5.1, worldgen §4.1
    // Positions/Normals untouched. O(resident chunks). Honors rebasedThisTick (no interp across it).
}
```
This is O(resident chunks) and shares the exact re-projection world-gen specified — terrain "stays put" visually through a rebase (ties world-gen WV5 + core-engine V2). LOD selection is **not** re-driven on rebase (it runs on authority position, worldgen §3.1) — we only re-anchor transforms, keeping the two concerns clean.

### 5.4 Factory LOD ladder — conceptual only (NOT built this spike)

Sketched per the non-goal fence, for forward-consistency (rendering.md §4, RN-3): (0) instanced meshes + animated items near → (1) instanced machines, items as scrolling material → (2) machine impostors, no items → (3) not rendered (sim on-rails). Band edges align to core-engine's active/on-rails distance bands. **No factory geometry exists in Spike 1**; this is a pointer, not a deliverable.

---

## 6. Step-by-step UE5 build plan

Slots onto core-engine Wave-2 step 10 ("publish the four contracts + two events as rendering hook points; core-engine ships a placeholder single camera so the demo runs first"). We **replace that placeholder camera** with the rig. World-gen's terrain (its WG-Build) feeds our §5. Order:

### RN-Build 0 — Rig skeleton (replace the placeholder camera)
1. **Project hookup:** subscribe to `OnFixedTick`/`Alpha` (interpolate camera between snapshots), `OnOriginRebased`, `OnSOIChange`, and `ITerrainProvider::OnChunkReady/OnChunkEvicted`. Confirm `FBodyParams` (incl. `RadiusM`, `Atmo`) read from world-gen — **assert nothing is hardcoded** (D-006 self-check).
2. **Dual-camera rig (§1):** stand up `NearCam` (pawn-parented) + `ScaledCam`; implement path (A) two-pass view extension (fallback (B) SceneCapture noted). Wire `SCALED_K = 1/FBodyParams[Forge].RadiusM`; ScaledCam pos = `scaledPos(observer.UniverseCoord)`, rot/FOV = NearCam's. **Validate:** a static star/proxy backdrop sits still while the pawn walks (rig stable).

### RN-Build 1 — Depth + scaled bodies
3. **Depth (§3):** first **measure reversed-Z float** at the near horizon (V-R2). If it z-fights, add **cascaded near-depth passes** (Nanite-safe) or scoped `SV_Depth` log write (non-Nanite terrain). Pick the cheapest that passes.
4. **Scaled proxies (§1.2):** low-poly baked Forge + Cinder + star billboard + starfield in the scaled scene, lit by the shared sun. Placeholder art.

### RN-Build 2 — Terrain + transition + atmosphere
5. **Terrain rendering (§5):** `OnChunkReady`→RealtimeMesh per chunk (interior + skirt), transform = `CenterUniverse.ToEngine`, material by `MaterialId`; `OnOriginRebased`→re-anchor transforms; `OnChunkEvicted`→release. **NOT Nanite** (§5.2).
6. **Proxy↔terrain transition (§2):** approach-band state machine (authority altitude from `FBodyParams`), forward observer pos to `UpdateStreaming`, drive `proxyAlpha` cross-fade (occlusion-first + dither), hysteresis on ascent.
7. **Atmosphere (§4):** Sky Atmosphere centered on Forge ("Planet Center at Component Transform"), params from `FAtmosphereProfile`, re-anchored on rebase; **none** for Cinder (airless). Shared directional sun.

### RN-Build 3 — Integrate with the full demo
8. **Drop into core-engine's walk→orbit→land→walk flow:** spawn on Forge (walk, co-rotating) → ascend (watch sky fade to black, LOD coalesce, rebases re-anchor terrain *and* atmosphere, proxy cross-fade out→in reversed) → cross to Cinder (`OnSOIChange`: Forge atmosphere off-screen, Cinder proxy→terrain swap, sharp terminator) → descend, land, walk. **No loading screen anywhere** — that's the whole point.

### 6.1 Validation — proving visual seamlessness (acceptance gates)

Measured with `stat unit`/frametime CSV + frame-stepped capture (so pop/z-fight/hitch are *measured*, not eyeballed), run across the full loop:

| # | What to prove | How | Pass criteria |
|---|---|---|---|
| **RV1** | Rig is stable & origin-locked | Walk/strafe on Forge; trigger core-engine rebases (4 km) | Scaled backdrop dead-still; near scene un-popped; **no camera jump** at any rebase (ties core-engine V2) |
| **RV2** | No z-fighting cm→horizon | Place a 1 m object on terrain with the 600 km body + horizon in frame | **Zero z-fighting** at the horizon and on the near object simultaneously (RN-2 retired) |
| **RV3** | Proxy↔terrain seamless (R2) | Descend Forge B0→B3 at ≥2 km/s, frame-stepped | **No single-frame silhouette jump, no lighting/terminator discontinuity at the horizon, no band-edge flicker** |
| **RV4** | Sky fades to black | Ascend Forge surface→space | Sky transitions blue→black smoothly via `ScaleHeightM`; horizon limb glow continuous; no banding |
| **RV5** | Airless moon | Land on Cinder | Black sky to the horizon, **sharp terminator**, no atmosphere artifacts; proxy→terrain swap clean |
| **RV6** | Terrain re-anchors on rebase | Rebases fire while terrain resident | Terrain visually static; only transforms refreshed; **no terrain pop** (ties world-gen WV5) |
| **RV7** | SOI-cross visual | Fly Forge→Cinder across SOI (core-engine V5) | Forge atmo leaves frame, Cinder terrain begins; **no hitch, no backdrop jump** (scaled space is root-frame) |
| **RV8** | Full traversal | Whole walk→orbit→land→walk loop | Completes with **no loading screen, no pop, no z-fighting, no lighting jolt, no hitch** end-to-end |

RV3 + RV8 are the headline gates — they are *the visual sell*. RV6/RV7 are the integration gates with core-engine + world-gen (the rig honors the frame/origin contracts, not just "looks pretty in a static scene").

---

## 7. Risk retirement

| Risk | What it is | Mitigation (this doc) | Validated by | Pass/fail criterion |
|---|---|---|---|---|
| **R2** (primary) | Scaled↔near cross-fade popping + lighting mismatch on fast approach | Cross-fade bands + occlusion-first + dither; proxy as safety backdrop; single shared sun; depth-aware aerial-perspective seam wash (§2) | **RV3, RV8** | PASS if a frame-stepped orbital-speed descent shows no silhouette jump, no terminator/lighting discontinuity at the horizon, no band-edge flicker. FAIL → escalate (consider hold-the-camera-during-fade or pre-warm streaming further out). |
| **RN-2-area** | 1 m + 10⁹ m in one frame, z-fighting | Dual-camera structurally avoids the full span; log/cascaded depth in the near camera for its ~6 decades (§3); **measure reversed-Z float first** | **RV2** | PASS if no z-fighting at horizon + near object together. The cheapest of {reversed-Z float, cascaded, log `SV_Depth`} that passes wins. |
| **R1** | Nanite cost on terrain | Use **classic streamed meshes**, not Nanite, for terrain (world-gen already LODs; Nanite blocks our depth path) (§5.2) | **RV2/RV8 perf, V-R1** | PASS (lean): classic meshes hold frame budget with two bodies' resident quads. Re-test Nanite only if draw-calls blow budget. **Verdict: Nanite deferred to factory meshes.** |
| **Depth×Nanite conflict** (new, flagged) | Nanite can't take a custom per-pixel `SV_Depth` write — log depth and Nanite-on-terrain are partly incompatible | Drove the §5.2 "classic, not Nanite for terrain" decision and the §3.3 depth-path ordering | RV2 + §5.2 | Resolved by *not* combining them on terrain; flagged to Admin as a standing UE5 constraint for any future Nanite-terrain ambition. |

**Overall:** the rendering half is **buildable and de-risked**. The dominant residual risk is **R2** (the cross-fade) — addressed structurally (proxy-as-backdrop + occlusion-first means the worst case is a brief dither, never a hole), and the dominant *engineering* surprise is **depth × Nanite incompatibility**, resolved by keeping terrain on classic meshes. Nothing here threatens D-001; if anything it *narrows* where Nanite is used (factory later, not terrain).

---

## 8. Cross-domain notes (for Admin)

- **core-engine (consumed) — sufficient.** `UniverseCoord`+`FFrameId`/`ToEngine`/`FFloatingOrigin`, `OnOriginRebased(DeltaEngine, NewOrigin)`, `OnSOIChange(FSOIChangeEvent)`, `IFrameGraph`, `SimProxy.Position()`/`Velocity()`, `SimClock.Alpha()`/`TickIndex()`. All four §5 contracts + both events are exactly what the rig needs. **One soft ask, not a blocker:** rendering reads the active observer's `UniverseCoord` and the **sun/star→body direction** from the frame graph each frame for ScaledCam placement, lighting, and scattering — confirm `IFrameGraph` cheaply exposes a body/star frame's universe position at `SimTime` (it does, via `FReferenceFrame::ToUniverse(SimTime)` §5.2 — flagged only so Admin notes rendering is a per-frame consumer of it).
- **world-gen (consumed) — sufficient.** `FTerrainChunk` (center as `FUniverseCoord`, local positions, skirts, `MaterialId`), `OnChunkReady`/`OnChunkEvicted`, `ITerrainProvider::UpdateStreaming`, `FBodyParams`/`FAtmosphereProfile`. The chunk contract gives us everything to draw + re-anchor. **One gap flagged below.**
- **GAP flagged to Admin (genuine, not a silent redefinition):** `FAtmosphereProfile` (worldgen §5) carries **Rayleigh** fields (`ScaleHeightM`, `SeaLevelDensity`, `RayleighTint`) but **no Mie parameters** (Mie scale height, anisotropy/asymmetry `g`). UE Sky Atmosphere needs Mie inputs for horizon haze. This spike uses placeholder Mie defaults, but for visual fidelity the canonical Body Definition (D-006) should grow **Mie fields on `FAtmosphereProfile`** (owned by world-gen per D-006). *Request:* Admin asks world-gen to add `MieScaleHeightM`, `MieScatteringScale`, `MieAnisotropy` to `FAtmosphereProfile`. Non-breaking addition; rendering already consumes the struct.
- **CONSTRAINT flagged to Admin:** UE5 Sky Atmosphere supports **only one atmosphere on screen at once**. Harmless this spike (only Forge has one; never inside two). **Material for the multi-body future** (§4.4) — a real planet-hopping game with two atmospheric bodies in frame will need a custom scattering path or atmosphere-swapping. Logged so it's not a surprise in Phase 4.
- **D-006 confirmed honored:** every body/atmosphere constant (radius, atmosphere scale height, tint, SOI for band math) is read from `FBodyParams`/`FAtmosphereProfile`; `SCALED_K` itself is derived from `RadiusM`. **Rendering hardcodes no physical constant.**

## 9. References

KSP dual-camera scaled space (RN-1; MASTER_PLAN §6/§7). Logarithmic depth buffer — Outerra ([Maximizing depth buffer range & precision](https://outerra.blogspot.com/2012/11/maximizing-depth-buffer-range-and.html), [Logarithmic Z-buffer](https://outerra.blogspot.com/2009/08/logarithmic-z-buffer.html)), [gamedeveloper.com overview](https://www.gamedeveloper.com/programming/logarithmic-depth-buffer), [Sundog: log depth in practice](https://www.sundog-soft.com/2015/06/using-an-opengl-logarithmic-depth-buffer-in-silverlining-and-triton/). UE5 [Sky Atmosphere component](https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine) (Rayleigh/Mie, surface→space fade, single-atmosphere limit, transform modes), UE5 [SceneCapture2D](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SceneCaptureComponent2D)/[Cameras](https://dev.epicgames.com/documentation/en-us/unreal-engine/cameras-in-unreal-engine). Cross-domain contracts: [spike1-core-engine.md](spike1-core-engine.md) §5 + the two events; [spike1-worldgen.md](spike1-worldgen.md) §4–§5.
```
