# Spike 1 — World Generation: Minimal Cubed-Sphere Heightfield Terrain

> **Domain:** World Generation & Terrain (co-lead, parallel to core-engine) · **Phase:** 0 → Phase-1 deposit contracts pinned · **Spike:** 1 · **Status:** Designed, ready to build; **C-1/C-6 pinned (§4.5–§4.6)** · **Last updated:** 2026-06-14 (Phase-1 C-1 `FDepositNode` pinned + C-6 `IPersistable` confirmed, WG-11/WG-12; prior: RC-2/RC-7 additive fields)
> **Owner:** `world-gen-controller` · Read alongside: [world-gen.md](../controllers/world-gen.md) · **[Spike 1 core-engine design](spike1-core-engine.md)** (the contract this builds against) · [MASTER_PLAN](../MASTER_PLAN.md) §6,§9,§10
> **Co-domains:** core-engine (Wave-1 done — pins `UniverseCoord`/`FFrameId`, `OnOriginRebased`, `OnSOIChange`) · rendering (Wave 2, consumes the §4 chunk contract) · physics (later, consumes the §4 height/collision queries)

---

## 0. Purpose & scope fence

Give Spike 1's seamless **walk → orbit → land** demo **real ground**: a cubed-sphere quadtree **heightfield** for exactly **one planet (with atmosphere) + one airless moon**, with streaming LOD, deterministic from seed, and floating-origin aware. This is the terrain the core-engine demo flies over and lands on — it replaces the placeholder primitive-sphere colliders the core-engine build plan (spike1-core-engine.md §6, step 8) stands up first.

**This spike answers one question:** *can we produce a seam-free, crack-free, pop-free cubed-sphere heightfield that streams LOD continuously from orbit altitude down to walking scale, anchored to core-engine's floating origin, for two bodies?* If yes, the bulk-terrain approach (WG-1) is validated and Phase-1 generation (biomes, deposits) builds on it.

**Hard scope fence (non-goals for this spike):**
- **No voxel deformation** (D-005 / WG-2). Heightfield only. But the height/collision query API (§4) keeps the **voxel-patch seam** so a patch can later override the heightfield without changing callers.
- **No biomes, no deposits, no POIs** (Phase 1). Surface material is a single placeholder per body, keyed off slope/altitude only enough to read terrain shape.
- **No real material/shading work** — that's rendering's (Wave 2). We emit data; rendering draws it.
- **Basic noise only** — recognizable planet + cratered moon, not a beauty pass.
- **Two bodies only** — the planet and the moon from core-engine's `StarFrame → PlanetFrame → MoonFrame` graph (spike1-core-engine.md §2.1).

---

## 1. Cubed-sphere quadtree structure

### 1.1 The six-face cube → sphere

Each body's surface is a **cube of 6 faces**, each face an independent **quadtree**. This is the KSP PQS ("Procedural Quad Sphere") model: a sphere is formed from a faceted cube by warping each face outward to the sphere, and each face carries a quadtree so detail subdivides where the observer is close. ([KSP Wiki — Making Planets](https://wiki.kerbalspaceprogram.com/wiki/Tutorial:Making_Planets), [Kopernicus PQS](https://kopernicus.github.io/wiki/content/PQSMods/PQS.html))

```
        +Y (face 2, "top")
         ┌─────┐
  -X(4)  │ +Z  │  +X(5)        6 faces, fixed IDs:
 ┌─────┐ │ (0) │ ┌─────┐        0:+Z  1:-Z  2:+Y  3:-Y  4:-X  5:+X
 │     │ └─────┘ │     │       Each face = root quad of a quadtree.
 └─────┘  -Y(3)  └─────┘       Quad children: SW=0 SE=1 NW=2 NE=3
        ┌─────┐
        │ -Z  │ (1, "back")
        └─────┘
```

**Face-local parameterization.** A point on face `f` is `(u, v) ∈ [-1, 1]²`. The face's two in-plane axes and outward normal are a fixed orthonormal basis `Basis(f) = {right_f, up_f, normal_f}` (a constant lookup table, 6 entries). The cube-space point is:

```
cube(f, u, v) = normal_f + u·right_f + v·up_f          // on the unit cube face plane
```

**Cube → sphere with tangent warp (even tessellation).** Naïve normalize (`dir = normalize(cube)`) bunches triangles at face centers and stretches them at corners. We instead apply a **tangent warp** to `(u,v)` before projecting, which compresses toward face centers and expands at corners, yielding much more uniform triangle area across the sphere ([Cube-to-sphere projections, JCGT 2018](https://www.jcgt.org/published/0007/02/01/paper.pdf); [Quadrilateralized spherical cube / COBE](https://en.wikipedia.org/wiki/Quadrilateralized_spherical_cube)):

```
warp(s)      = tan(s · π/4)                              // s ∈ [-1,1] → [-1,1], equal-angle
unitDir(f,u,v) = normalize( normal_f
                            + warp(u)·right_f
                            + warp(v)·up_f )             // point on unit sphere
```

`unitDir` is a **frame-stable, seed-independent** direction. `unitDir → (lat, lon)` is a pure trig conversion (the inverse `(lat,lon) → (f,u,v)` is also closed-form: pick the face by the dominant axis of the lat/lon direction vector, then `atan` to invert the warp — used by `SampleTerrainHeight`, §4.3).

> **Decision WG-5 (Accepted):** Cube→sphere uses the **tangent (equal-angle) warp**, not raw normalize, for uniform LOD triangle density. Cost is one `tan` per axis at mesh-gen time only (not per frame). Inverse is closed-form so lat/lon ↔ face/quad is cheap.

### 1.2 Quad addressing — the deterministic key

A quad is identified by a **`FQuadKey`**: `(bodyId, faceId, depth, quadPath)`.

- `faceId ∈ [0,5]`.
- `quadPath` — a base-4 path from the face root: each 2-bit step picks a child `{SW=0, SE=1, NW=2, NE=3}`. `depth` = number of steps. We pack the path into a `uint64` (2 bits/level → up to 32 levels, far more than needed; we cap at `maxDepth`, §3.1). `depth==0` is the whole face.
- A quad covers the `(u,v)` sub-rectangle obtained by bisecting `[-1,1]²` `depth` times along the path. Closed-form: `(uMin,uMax,vMin,vMax)` from `quadPath` — no tree walk needed to know a quad's extent.

This key is the **deterministic seed coordinate**. Two runs, two machines, save/reload — same key → byte-identical mesh. That is what makes the natural world free to persist (MASTER_PLAN §9: seed regenerates, only diffs are stored).

### 1.3 (bodySeed, faceId, quadPath) → heightfield mesh — deterministic pipeline

A quad's mesh is `GRID × GRID` vertices (default **`GRID = 33`** → 32×32 cells; +1 so neighbor quads at the same depth **share** edge vertices exactly). Generation is a pure function — no global state, no RNG draw order dependence:

```
GenerateQuadMesh(bodySeed, FQuadKey key) -> FTerrainChunk:
  basis   = Basis(key.faceId)
  (uMin,uMax,vMin,vMax) = QuadExtent(key)                 // §1.2, closed-form
  for j in 0..GRID-1, i in 0..GRID-1:
     u  = lerp(uMin, uMax, i/(GRID-1))
     v  = lerp(vMin, vMax, j/(GRID-1))
     dir = unitDir(key.faceId, u, v)                      // §1.1, tangent-warped, normalized
     h   = SampleHeightField(bodySeed, dir)               // §2, the noise stack (meters of relief)
     // VOXEL SEAM (stubbed this spike): h = ApplyPatchOverride(bodyId, dir, h)  // §4.4
     radius = body.radius + h
     posLocalToBodyCenter = dir * radius                  // 64-bit, meters, in body frame
     vertices[i,j] = posLocalToBodyCenter
  normals = computeNormals(vertices)                      // central differences on the grid
  return FTerrainChunk{ key, vertices(near-origin, see §3.4), normals, skirt(§1.4), ... }
```

**Determinism rule (WG-6, Accepted):** every noise sample is hashed from `(bodySeed, dir)` — *position-hashed*, never sequence-hashed. `SampleHeightField` for a given `(bodySeed, dir)` returns the same value regardless of which quad, which depth, or which order it's evaluated in. This is what guarantees **shared edge vertices between a quad and its neighbor — and between a quad and its own children — are bit-identical** (the foundation of crack-free seams, §1.4). The `quadPath` only chooses *which* `dir`s get sampled and at what density, never *what value* a `dir` yields.

### 1.4 Seam & crack handling (the core risk — R1/§7 of this doc)

Three independent mechanisms, layered (research: skirts + edge-stitching + shared-vertex determinism are the standard trio for chunked-LOD planets — [GameDev.net: quadtree terrain stitching](https://www.gamedev.net/forums/topic/597910-quadtree-terrain-stitching/), [chunked LOD procedural planets](https://www.gamedev.net/forums/topic/485584-chunked-lod-with-procedural-planets/)):

1. **Shared-edge determinism (primary).** Because height is position-hashed (§1.3), two same-depth quads sharing an edge sample the *same* `dir`s on that edge → identical positions → **no T-junction, no gap** between equal-LOD neighbors, including **across the three cube-face boundaries** where two faces meet (the seam `dir`s are shared by construction). This also holds across a quad and its 4 children: the children's coarse-edge vertices re-sample the same `dir`s as the parent edge.

2. **Skirts (covers LOD-boundary cracks).** Where a high-LOD quad abuts a lower-LOD neighbor, the finer edge has vertices the coarser edge lacks → a hairline crack. We attach a **skirt**: a 1-quad-deep apron of vertices dropped radially inward by `skirtDepth = k · quadEdgeLength` (k≈0.5). It's hidden under the surface and closes any LOD-mismatch hole with no per-frame neighbor bookkeeping. Cheap, robust, slightly wasteful — the standard chunked-LOD fix. ([GameDev: terrain LOD and cracks](https://www.gamedev.net/forums/topic/713470-terrain-lod-and-cracks/))

3. **Edge-stitch index buffers (optional polish, deferred).** A finer edge can instead be re-indexed to weld to the coarser neighbor's vertex count (multiple pre-baked edge index buffers selected by neighbor-depth delta). Cleaner than skirts but needs neighbor-depth lookup each split. **Spike uses skirts;** stitching is a Phase-1 polish option noted here, not built now.

> **We enforce the "max 1 LOD level difference between edge-adjacent quads" invariant** (balanced/restricted quadtree). Combined with skirts sized for a 1-level step, this bounds the worst-case crack and is the single most important rule for pop-free descent. The quadtree split logic (§3) refuses to split a quad more than one level deeper than any edge neighbor until the neighbor splits too (cascade).

---

## 2. Minimal noise stack

Position-hashed value/Perlin/simplex noise over the **unit-sphere direction** `dir` (3D domain → no UV-seam artifacts; the cube faces are only a *meshing* device, the noise lives on the sphere). Layers are deliberately few — recognizable, not pretty.

**Shared base hash:** `hash3(bodySeed, dir·freq)` seeds every octave; mixing `bodySeed` makes the two bodies look unrelated from one world seed.

### 2.1 Planet (atmosphere, rolling continents + mountains)

| Layer | Type | Role | Rough params |
|---|---|---|---|
| **L0 Continents** | fBm, 4 octaves, low freq | continent vs ocean basins; large-scale relief | base freq ≈ 2–3 cycles/sphere, amp ≈ 2–4 km |
| **L1 Mountains** | ridged-multifractal, 4 oct | mountain ranges along continent edges, masked by L0 | freq ×8 of L0, amp ≈ 2–3 km, masked where L0 < sea band |
| **L2 Detail/roughness** | fBm, 3 oct, high freq | hills & surface texture at walking scale | freq ×32, amp ≈ 50–150 m, only evaluated at high LOD |
| **Sea level clamp** | analytic | flatten everything below `seaLevel` to a flat "ocean" plane (placeholder, no water sim) | `h = max(h, seaLevel)` |

`h_planet(dir) = clampSea( L0 + mask(L0)·L1 + L2 )`.

### 2.2 Moon (airless, cratered + rolling)

| Layer | Type | Role | Rough params |
|---|---|---|---|
| **M0 Rolling base** | fBm, 3 oct | gentle mare/highland undulation | freq ≈ 3, amp ≈ 0.5–1 km |
| **M1 Craters** | crater field (Worley/Voronoi-based) | the moon read — bowl + raised rim + ejecta | Poisson-ish hashed crater centers; radius/depth by hashed size; profile = rim-bump minus bowl |
| **M2 Detail** | fBm, 2 oct, high freq | small-scale regolith roughness at high LOD | freq ×32, amp ≈ 20–60 m |

`h_moon(dir) = M0 + craterProfile(dir) + M2`. The crater layer is a **deterministic hashed-grid** field: hash cells on the sphere, one candidate crater per cell, accumulate the nearest few craters' radial profiles. Same position-hash discipline (§1.3) so craters are identical across runs/LOD.

> **LOD-aware octave gating (perf, R2):** high-freq layers (L2/M2) are only summed when a quad's depth is high enough that the octave is above the quad's vertex Nyquist — at orbital LOD we skip them entirely. This keeps low-LOD whole-face quads cheap (MASTER_PLAN streaming-budget concern).

> **Decision WG-7 (Accepted):** Noise stack is **3 layers per body** (base + signature + detail), position-hashed on the 3D sphere direction, octave-gated by LOD. Planet signature = ridged mountains; moon signature = crater field. Tunable, not final — Phase 1 replaces with the biome-aware stack.

---

## 3. LOD selection + chunk streaming

### 3.1 LOD level selection (distance-based, KSP-PQS-style)

Subdivide a quad when the observer is close enough that its on-screen detail warrants it — the classic "subdivide what you approach, coalesce what you leave" rule ([Kopernicus PQS](https://kopernicus.github.io/wiki/content/PQSMods/PQS.html)).

```
DesiredSplit(quad, observerPosOnBody):
   d   = distance(observerPos, quad.center)         // both in body-frame meters
   s   = quad.edgeLength(meters)                     // shrinks by 2 each depth
   // split if the quad subtends more than a target angular size:
   return (s / max(d, eps)) > SPLIT_RATIO            // SPLIT_RATIO ≈ 1.0 (tunable)
          && quad.depth < maxDepth(body)
```

- **`maxDepth`** is per body, chosen so the finest quad's cell size ≈ target walking detail (e.g. ~1 m cells). For a ~600 km-radius planet with `GRID=33`, that's ~depth 12–14. Moon (smaller) a level or two less.
- **Merge** uses `SPLIT_RATIO · hysteresisFactor` (e.g. merge threshold at 0.6× split threshold) so a quad doesn't split/merge-thrash at the boundary — mirrors core-engine's promotion hysteresis philosophy (spike1-core-engine.md §3.2).
- **Balanced-quadtree constraint** (§1.4): never let edge-adjacent quads differ by >1 level; force-split the coarser neighbor first (cascade) so skirts always cover at most a 1-level step.

**`observerPos` source:** the observer's `UniverseCoord` (from core-engine's active observer) re-expressed into the **body's frame** and reduced to a body-center-relative vector. We get it via the body's `FFrameId` and `FUniverseCoord::InFrame` / the `IFrameGraph` (spike1-core-engine.md §5.1–5.2). LOD is evaluated on the **64-bit authority position**, *not* the floating-origin engine position — so LOD is correct regardless of where the origin currently sits.

### 3.2 Streaming in/out

- **Active band:** terrain only streams for bodies near the observer. We subscribe to core-engine's **`OnSOIChange`** (`FSOIChangeEvent`, spike1-core-engine.md §2.3, §5.2): on entering a body's frame we begin streaming that body; the body we left keeps a coarse root-quad shell and drops fine quads. (Two-body spike: planet + moon are both always within view distance, so both keep at least their coarse faces resident; only fine LOD streams by §3.1.)
- **Async generation:** a quad split request enqueues `GenerateQuadMesh` (§1.3) on a **worker pool** (off the game thread — it's a pure function, trivially parallel). The new finer quads are **not swapped in until all 4 children are ready**, so the surface never shows a half-resolved hole (no pop-in gap). Parent stays visible until children are ready, then is hidden (its skirt covered any transient mismatch anyway).
- **Eviction:** quads merged out (observer receded) are released after a short dwell (anti-thrash), their meshes pooled for reuse.
- **Budget:** cap quad-generations dispatched per tick (KSP's `maxQuadLengthsPerFrame` analogue) so a fast descent spreads mesh build over several ticks rather than spiking a frame (R2 / streaming budget).

### 3.3 Tie to floating origin — `OnOriginRebased`

**Every terrain quad stores its center as a `FUniverseCoord`** (64-bit + `FFrameId` of its body), **never a raw `FVector`** — this is the explicit core-engine requirement (spike1-core-engine.md §1.4 step "World-gen / streaming", §8). On rebase:

```
// world-gen subscribes in BeginPlay:
FloatingOrigin.OnRebased().AddRaw(this, &UTerrainStreamer::HandleOriginRebased);

void HandleOriginRebased(const FVector& DeltaEngine, const FUniverseCoord& NewOrigin):
   // Quad centers are UniverseCoord — authority is unchanged by a rebase.
   // We only re-project each resident quad's render/collision transform:
   for each residentQuad:
       quad.EngineTransform = quad.CenterUniverse.ToEngine(NewOrigin)   // §5.1 core-engine
   // Vertex buffers are stored body-center-relative (§3.4) so they DON'T move;
   // only the per-quad component transform is re-anchored. O(resident quads), cheap.
```

Because vertices are stored relative to the body center (§3.4) and only the **component transform** is the `UniverseCoord→engine` projection, a rebase is an O(number-of-resident-quads) transform refresh — no vertex rewrite, no regeneration. This is the whole reason tile centers are `UniverseCoord`: the rebase becomes a re-projection, not a rebuild (spike1-core-engine.md §1.4).

> We do **not** subscribe terrain LOD selection to `OnOriginRebased` — LOD uses authority position (§3.1), which a rebase doesn't change. We subscribe only to **re-anchor transforms**. This keeps the two concerns clean.

### 3.4 Where vertices live (precision)

Quad vertices are generated and stored **relative to the body center** (a small-ish range: body radius ± relief, ~600 km — still large). To stay 32-bit-safe near the camera, the quad's **render mesh is stored relative to the quad center** (`vertex − quadCenterLocal`), and the quad center is the `UniverseCoord` that gets projected to engine space each frame/rebase. A high-LOD quad spans meters → its local vertices are tiny → GPU/physics see near-origin floats exactly as core-engine's contract requires (spike1-core-engine.md §1.2, CE-4). This mirrors core-engine's "64-bit authority, 32-bit near origin" split at the chunk level.

---

## 4. Pinned data contracts

> These are what **rendering** (Wave 2) and **physics** (later) code against. They are **consistent with core-engine's pinned contracts** (spike1-core-engine.md §5): every position is a `FUniverseCoord` (carries its `FFrameId`); engine-space projection is via `FFloatingOrigin`. UE/C++-flavored; **names are the contract.**

### 4.1 `FTerrainChunk` — the unit rendering consumes

```cpp
USTRUCT()
struct FTerrainChunk {
    FQuadKey        Key;            // (bodyId, faceId, depth, quadPath) — deterministic id (§1.2)
    FUniverseCoord  CenterUniverse; // 64-bit chunk center + FFrameId of its body (core-engine §5.1).
                                    //   THE floating-origin anchor. NOT an FVector. (spike1-core-engine §1.4/§8)
    double          ChunkRadiusM;   // bounding radius (meters) for culling / LOD
    uint16          GridDim;        // verts per side (GRID, default 33)

    // Geometry — vertices are LOCAL to CenterUniverse (small floats, 32-bit safe; §3.4):
    TArray<FVector3f> Positions;    // GridDim*GridDim, meters, relative to chunk center
    TArray<FVector3f> Normals;      // per-vertex, body-frame
    TArray<FVector2f> UVs;          // face-local (u,v) for placeholder material
    TArray<uint32>    Indices;      // triangle list (interior grid)
    // Skirt geometry appended after the interior set (§1.4) — separate index range:
    TArray<uint32>    SkirtIndices;

    uint8           MaterialId;     // placeholder: 0=planet-rock 1=moon-regolith (rendering maps to a mat)
    uint64          ContentHash;    // hash(bodySeed,Key) — change-detection / cache key / determinism check
};
```

**Engine transform** for rendering each frame: `FTransform xf; xf.SetLocation( Chunk.CenterUniverse.ToEngine(FloatingOrigin) );` — then draw `Positions` under it. On `OnOriginRebased`, re-call `ToEngine` (§3.3). **A chunk's `Positions` never change on rebase** — only the transform.

### 4.2 `ITerrainProvider` — the streaming/query facade (rendering + physics)

```cpp
class ITerrainProvider {
public:
    // ---- Streaming (rendering subscribes) ----
    // Fired when a chunk becomes resident (ready to draw) or is evicted.
    virtual FOnChunkReady&   OnChunkReady() = 0;     // broadcasts const FTerrainChunk&
    virtual FOnChunkEvicted& OnChunkEvicted() = 0;   // broadcasts FQuadKey
    // Drive LOD from the observer's authority position each tick (§3.1).
    virtual void UpdateStreaming(const FUniverseCoord& ObserverPos, double SimTime) = 0;

    // ---- Height & collision queries (physics consumes; §4.3) ----
    virtual double SampleTerrainHeight(FBodyId Body, double Lat, double Lon) const = 0;
    virtual FTerrainHit RaycastTerrain(FBodyId Body,
                                       const FUniverseCoord& From,
                                       const FVector3d& Dir, double MaxDist) const = 0;
    virtual bool   GetGroundContact(FBodyId Body, const FUniverseCoord& At,
                                    FTerrainContact& OutContact) const = 0;
    virtual const FBodyParams& GetBodyParams(FBodyId Body) const = 0;   // §5
};
```

### 4.3 Height & collision query signatures (physics contract — settles world-gen.md §5)

```cpp
// Heightfield sample: terrain elevation (meters above body reference radius) at a geographic coord.
// Deterministic, frame-independent, callable WITHOUT the chunk being resident (pure noise eval, §2).
double SampleTerrainHeight(FBodyId Body, double Lat, double Lon) const;
//   -> body.radius is added by caller if they want absolute radius; this returns RELIEF (h).
//   Internally: (lat,lon) -> dir -> face/quad inverse (§1.1) -> SampleHeightField(bodySeed, dir).

// Convenience absolute-position form (what physics ground-snapping actually wants):
//   returns the surface point as a UniverseCoord in the body's frame, plus surface normal.
struct FTerrainContact {
    FUniverseCoord SurfacePoint;   // on the heightfield, body frame (64-bit)
    FVector3f      Normal;         // body-frame surface normal
    double         Height;         // relief used (meters)
    uint8          MaterialId;     // placeholder surface id
    bool           bFromVoxelPatch;// false this spike; true later if a patch overrode (§4.4)
    // --- RC-7 append-only additions (physics, spike2-physics §5.2) — populated from existing data ---
    double         SlopeRad;       // terrain slope at the contact, radians: angle of Normal from
                                   //   local radial-up (= acos(dot(Normal, r̂)), r̂ = SurfacePoint dir).
                                   //   Derived from the Normal this query already computes. Physics:
                                   //   tip-over / leg-tolerance check. Range [0, π/2] on a heightfield.
    double         SurfaceHardness;// normalized [0,1] contact-stiffness scalar (0 = soft regolith/sand,
                                   //   1 = hard rock/ice). Keyed off the same MaterialId/biome the query
                                   //   already returns. Physics maps it to friction/restitution.
};
bool GetGroundContact(FBodyId Body, const FUniverseCoord& At, FTerrainContact& Out) const;
//   At = a position near/above the surface; projects radially to the heightfield.

// Ray vs terrain (for landing gear / lidar / placement). Sphere-tracing the heightfield.
struct FTerrainHit {
    bool           bHit;
    FUniverseCoord Point;          // 64-bit hit position, body frame
    FVector3f      Normal;
    double         Distance;
    uint8          MaterialId;
    bool           bFromVoxelPatch;
    // --- RC-7 append-only additions (physics, spike2-physics §5.2) — same semantics as FTerrainContact ---
    double         SlopeRad;       // terrain slope at the hit, radians: angle of Normal from local
                                   //   radial-up (= acos(dot(Normal, r̂)), r̂ = Point dir). From the
                                   //   Normal this raycast already computes. Range [0, π/2].
    double         SurfaceHardness;// normalized [0,1] contact-stiffness scalar; keyed off MaterialId/biome
                                   //   (0 = soft regolith/sand, 1 = hard rock/ice). Physics: friction/restitution.
};
FTerrainHit RaycastTerrain(FBodyId Body, const FUniverseCoord& From,
                           const FVector3d& Dir, double MaxDist) const;
```

**Consistency with core-engine, confirmed:**
- Every position in/out is an `FUniverseCoord` (carries `FFrameId`) or is body-frame relative — never a bare `FVector` (matches spike1-core-engine.md §5.1 delta: "a `UniverseCoord` is not a bare double3 — it carries its frame").
- `FBodyId` maps 1:1 to the body's `FFrameId` in `IFrameGraph` (a chunk's `CenterUniverse.Frame` == that body's frame). World-gen holds `FBodyId → FFrameId` so callers can pass either.
- `SampleTerrainHeight` is **pure & resident-free**: physics can query collision for a body the renderer hasn't streamed (e.g. an autopilot ground-track). This is deliberate — physics must not depend on render residency.

> **RC-7 (append-only, non-breaking — reconciliation 2026-06-14):** `SlopeRad` and `SurfaceHardness` were **added** to `FTerrainContact` and `FTerrainHit` at the **end** of each struct. They are derived entirely from data the query already computes — `SlopeRad` from the contact/hit `Normal` (angle from local radial-up), `SurfaceHardness` from the `MaterialId`/biome already returned — so populating them costs ~nothing and adds no new gen work. **No existing field changed meaning; no signature changed; callers that ignore the new fields are unaffected.** `SurfaceHardness` is published as a **normalized `[0,1]` `double`** (not the `uint8 0..255` physics first sketched in spike2-physics §5.2) so it can be applied directly as a friction/restitution lerp without a fixed-point rescale — this is a tightening of the same field, agreed at reconciliation. (See world-gen.md §3 decision WG-10, §5.)

### 4.4 Voxel-patch seam (stubbed, but in the API — WG-2 / D-005)

The query layer checks a per-body **patch registry** *before* falling back to the heightfield:

```cpp
// Spike: ApplyPatchOverride is a no-op stub returning the heightfield value unchanged.
double ApplyPatchOverride(FBodyId, const FVector3d& dir, double heightfieldH) const;
//   Later: if a voxel/SDF dig patch covers `dir`, return its surface instead and set
//   FTerrainContact.bFromVoxelPatch=true. Callers ALREADY branch on bFromVoxelPatch,
//   so adding real patches later changes NO caller signatures. (world-gen.md R1, §6 seam)
```

This is the seam WG-2 requires us to keep open without paying for it now: `bFromVoxelPatch` is in every result struct, the override hook exists, the registry is empty. Rendering and physics code against it today; Phase-4 voxel work fills it in.

---

## 4.5 Deposit catalog — `FDepositNode` (Phase-1, C-1 PINNED)

> **Added Phase 1 (contract C-1, PHASE1-PLAN §10).** Spike 1 *listed* deposits as Phase-1 work but never pinned the struct (§8, world-gen.md §5). This section pins it. Consumed three ways: **gameplay** (mining UX tooltip + miner-placement validity — gameplay-phase1.md §2), **factory-sim** (miner extraction rate), **persistence** (depletion diff — §4.6 / C-6). It is the Phase-1 analogue of the §4.1–§4.3 contracts and obeys the same rules: every position is an `FUniverseCoord` (carries `FFrameId`), deterministic from seed, append-only.
>
> **Ownership boundary (hard):** the **resource identity is an `ItemId`** — an **OPAQUE handle owned by gameplay's C-3 `ItemId → FItemDef` registry** (gameplay-phase1.md §4.1, §8.C). World-gen **references** it; it does **not** define, name, or interpret it. A deposit *carries* an `ItemId`; what that id *means* (name "Cinderite", icon, stack size, recipes) is gameplay's. World-gen only guarantees *which* `ItemId` a body's deposits carry (the per-body resource-identity rule, §4.5.2) and that the same id appears in the player's pack and the smelter's input (one shared id space — C-3).

### 4.5.1 The struct

```cpp
USTRUCT()
struct FDepositNode {
    FDepositId      Id;             // stable deposit id — the persistence key for depletion (§4.6 / C-6).
                                    //   DETERMINISTIC: hash(bodySeed, FQuadKey of placement region, localIndex)
                                    //   so it regenerates bit-identically (WV1) and a depletion diff re-binds
                                    //   to the same node on reload. NOT a runtime-assigned sequence number.

    FUniverseCoord  Position;       // node center, 64-bit + FFrameId of its body (core-engine §5.1). THE anchor.
                                    //   NOT a bare FVector. Sits on the heightfield surface (radius+h at its dir).
    double          Lat;            // surface latitude  (radians) — closed-form from Position dir (§1.1 inverse).
    double          Lon;            // surface longitude (radians) — convenience for map/HUD + per-body enum;
                                    //   redundant with Position but cheap and saves callers the trig.
    FVector3f       SurfaceNormal;  // body-frame terrain normal at the node — for miner "sit flat" alignment
                                    //   (gameplay ghost up-axis, gameplay-phase1.md §3.2). Same normal the
                                    //   §4.3 query computes; carries the node's local slope implicitly.

    FBodyId         Body;           // which body owns it (== Position.Frame's body; 0=Forge 1=Cinder, §5).

    // --- Resource identity (OPAQUE — gameplay C-3 owns the id space; world-gen only references it) ---
    ItemId          Resource;       // the mined item this node yields. OPAQUE gameplay-owned handle (C-3
                                    //   ItemId→FItemDef registry, gameplay-phase1.md §8.C). World-gen assigns
                                    //   WHICH id per body (resource-identity rule §4.5.2) but never interprets
                                    //   it. e.g. Forge nodes carry the Ferrite-ore id; Cinder ALSO carries the
                                    //   Cinderite id (§4.5.3). Replaces gameplay's placeholder `DepositTypeId`
                                    //   (gameplay-phase1.md §8.A) — there is no separate world-gen deposit-type
                                    //   enum; the gameplay ItemId IS the type, keeping one id space (C-3).

    // --- Richness / quantity ---
    float           Grade;          // richness ∈ (0,1] — extraction-RATE multiplier (factory-sim miner speed,
                                    //   gameplay-phase1.md §7.2 "rate by deposit grade"). Hashed per node.
    double          InitialAmount;  // total extractable quantity at world-gen (the seed baseline, in item units).
                                    //   Regenerates from seed — NOT saved.

    // --- Depletion state (the ONLY mutable field — becomes the persistence diff, WG-3 / C-6) ---
    double          RemainingAmount;// current extractable quantity left. == InitialAmount at world-gen; decreases
                                    //   as a miner extracts. THIS is the (depositId, remaining) saved per region
                                    //   (§4.6). At 0 the node is exhausted (gameplay greys it, miner blocks).
};
```

**`ItemId` note (loud, for Admin + consumers):** `ItemId` is **not a world-gen type.** It is gameplay's C-3 registry handle (gameplay-phase1.md §8.C), treated here as an opaque `uint16`-ish token. World-gen's only authority over it is *placement*: which body's nodes carry which id (§4.5.2–§4.5.3). This deliberately **collapses** gameplay's proposed `DepositTypeId` (gameplay-phase1.md §8.A) into the shared `ItemId` so the mined thing is the same id in the deposit, on the belt, in the smelter, and in the player's pack — one id space (C-3), no translation table. *If C-3 lands as a distinct `FDepositId→ItemId` indirection instead, this field becomes that key with no other struct change — additive.*

`FDepositId` is a 64-bit opaque world-gen-owned stable id (hashed, above); `FBodyId` maps 1:1 to the body's `FFrameId` (§4.3 consistency note).

### 4.5.2 Deterministic seeded placement rule (per body) → the catalog

The deposit catalog is **generated, not stored** — same discipline as terrain (WG-3, WG-6): a deterministic per-body pass over the sphere yields the node set, so two runs / two machines / save-reload produce the **identical** catalog (WV1 extends to deposits). Only `RemainingAmount` diffs (§4.6).

```
GenerateDeposits(bodySeed, FBodyId body) -> TArray<FDepositNode>:
  for each placement cell C on the body's cube-sphere (hashed-grid, the SAME hashed-grid the
      moon crater field uses, §2.2 — Poisson-ish: one candidate per cell, jittered by hash):
     if hash3(bodySeed, "deposit", C.dir) < bodyDepositDensity(body):   // density per body
        dir   = jitter(C.dir, hash3(bodySeed,"jit",C))                  // node direction on sphere
        h     = SampleHeightField(bodySeed, dir)                        // §2 — sits ON the surface
        normal= terrainNormalAt(bodySeed, dir)                          // §1.3 central-diff normal
        region= truncate(FQuadKey(faceOf(dir), pathTo(dir)), RegionDepth) // §4.6 / persistence §3.1
        localI= indexWithinRegion(C)                                    // disambiguates >1 node/region
        node.Id       = hash64(bodySeed, region, localI)                // stable, §4.5.1
        node.Resource = PickResource(bodySeed, body, dir)               // §4.5.3 — per-body identity
        node.Grade    = lerp(0.3, 1.0, hash01(bodySeed,"grade",dir))    // richness
        node.InitialAmount = node.RemainingAmount = baseAmount(node.Resource) * node.Grade
        node.Position = FUniverseCoord( dir*(body.radius+h), body.Frame )
        node.Lat,node.Lon = dirToLatLon(dir)                            // §1.1 inverse
        emit node
```

**Determinism rule (inherits WG-6):** every draw — whether a cell spawns, its jitter, its grade, its resource — is **position-hashed** from `(bodySeed, dir)` / `(bodySeed, cell)`, never sequence-hashed. Placement order is irrelevant; the catalog is a pure function of `bodySeed`. This is what lets `FDepositId` be a stable hash and the catalog be free to persist (only depletion is a diff). `bodyDepositDensity` is per-body (Forge richer/broader; Cinder sparse), tunable in playtest (gameplay owns balance numbers, gameplay-phase1.md §7).

**Catalog query surface** (added to `ITerrainProvider`, §4.2 — append-only, non-breaking):

```cpp
// Per-body enumeration (gameplay map/objective, factory-sim, persistence region scan):
virtual void GetDeposits(FBodyId Body, TArray<FDepositNode>& Out) const = 0;
// Proximity query for the "look at a deposit" tooltip (gameplay-phase1.md §2.2) — nodes near a coord:
virtual void QueryDepositsNear(const FUniverseCoord& At, double RadiusM,
                               TArray<FDepositNode>& Out) const = 0;
// Single-node fetch by id (factory-sim miner binds to a node; persistence re-binds a depletion diff):
virtual bool GetDeposit(FDepositId Id, FDepositNode& Out) const = 0;
// Extraction sink (factory-sim miner calls; world-gen authoritatively decrements + clamps at 0):
virtual double ExtractFromDeposit(FDepositId Id, double RequestedAmount) = 0; // returns amount granted
```

`ExtractFromDeposit` is the **only** mutator of deposit state — it decrements `RemainingAmount` (clamped ≥0, returns what was actually granted) and marks the node's region dirty for persistence (§4.6). Resident-free like the height queries: a miner can extract from a body the renderer hasn't streamed (factory-sim runs on-rails, §3.2).

### 4.5.3 Per-body resource identity + the Cinder-only resource (WG-4, the off-world hook)

`PickResource(bodySeed, body, dir)` implements **WG-4** (per-body resource identity → forces interplanetary logistics) and plants the **Phase-1 off-world hook** (PHASE1-PLAN §2.4, P1-D4):

| Body | Deposits carry (`ItemId`, gameplay-owned) | Role |
|---|---|---|
| **Forge** (planet) | the **Ferrite-ore** id (+ optional fuel-item id if the generator burns fuel, gameplay-phase1.md §7.1) | the base on-planet ore — everything the surface factory needs |
| **Cinder** (moon) | the **Cinderite** id (*Cinder-only*) | **the off-world identity hook** — an id that appears on **no Forge node** |

**The hard rule (the whole point of WG-4):** `PickResource` returns the **Cinderite `ItemId` only for `body == Cinder`**, and never returns it for Forge. So the *only* place in the universe a player can mine that id is the moon. This is the concrete "you must leave the planet" hook (gameplay-phase1.md §7.3): gameplay's objective step 6 ("mine the off-world resource") has a predicate `a miner producing the Cinderite ItemId`, and that predicate is **only satisfiable on Cinder** because world-gen placed that id nowhere else. World-gen owns the *placement* (where the id lives); gameplay owns the *id and its meaning* (it's "Cinderite", C-3) and the *objective* that consumes it. The Phase-2 tech *gate* (a Forge recipe requiring Cinderite) attaches to this later (P1-D4 — OUT now); the slice just plants the resource so the gate has somewhere to land.

> **Decision WG-11 (Accepted):** `FDepositNode` pinned (C-1) — id/Position(`FUniverseCoord`+`FFrameId`)/lat-lon/`SurfaceNormal`/`FBodyId` + an **opaque gameplay-owned `ItemId`** resource (NOT a world-gen type; collapses gameplay's `DepositTypeId` into the shared C-3 id space) + Grade/InitialAmount + the single mutable `RemainingAmount`. Catalog is **deterministically seed-generated** per body (position-hashed, WG-6 discipline) so it regenerates bit-identically (WV1) and only depletion is a diff. Cinderite `ItemId` is placed **only on Cinder** (WG-4 off-world hook, P1-D4). *(§4.5, §4.6)*

## 4.6 Deposit depletion persistence — confirm `IPersistable` (C-6, world-gen's slice)

> **Added Phase 1 (contract C-6, PHASE1-PLAN §10; persistence-phase1.md §1.2, §2.1, §6.1).** Confirms world-gen can implement persistence's `IPersistable` over its single Phase-1 mutation.

**World-gen's entire Phase-1 save surface is deposit depletion — nothing else.** Per persistence-phase1.md §1.2: terrain is **SEED, not a diff** (no voxel dig in the slice — D-005/WG-2; every quad regenerates from `(worldSeed, FQuadKey)`, WV1), and the voxel-patch seam (`bFromVoxelPatch`, §4.4) stays empty. The **only** world-gen state a player mutates is how much they mined out of a deposit.

**Confirmed: world-gen implements `IPersistable` (`DomainId = WorldGen`, **chunk-scoped**) over exactly `(depositId, remaining)[]` per region:**

| `IPersistable` member | World-gen behaviour |
|---|---|
| `DomainId()` | `WorldGen` |
| `SchemaVersion()` | `1` (deposit-depletion payload; bumped only if the depletion record format changes) |
| `EnumerateDirtyChunks(out)` | the set of `FChunkKey` regions containing a deposit whose `RemainingAmount < InitialAmount` (touched by `ExtractFromDeposit`, §4.5.2). Untouched regions emit nothing → 0 bytes (persistence §1.3). |
| `SaveDiffs(key, out)` | for each depleted node in `key`'s region: write `(varint depositId-local, double remaining)`. Returns `false` (writes nothing) if no node in the region is depleted (persistence §2 empty-chunk rule). The compact `(varint depositId, varint/​double remaining)[]` persistence §5.1 expects. |
| `LoadDiffs(key, in, ver)` | **after** world-gen regenerates the region's deposit *placement* from seed (§4.5.2 — free), read back each `(depositId, remaining)` and set `RemainingAmount` on the matching regenerated node. The id matches because it is the same deterministic hash (§4.5.1). Unwritten nodes keep `RemainingAmount == InitialAmount`. |

**Why this is sound (and trivial):**
- **Region key = path-prefix of the deposit's placement `FQuadKey`** — `truncate(FQuadKey, RegionDepth)` (persistence §3.1), the *same* rule terrain quads and factory entities use. A deposit's region is closed-form from its `dir`; no separate spatial index (computed at placement, §4.5.2).
- **`depositId` is stable across save/load** because it is `hash64(bodySeed, region, localIndex)` (§4.5.1) — regeneration yields the identical id, so a saved `remaining` re-binds to the correct regenerated node with no fuzzy matching. This is exactly the `depositId` "hashed from `(bodySeed, FQuadKey, localIndex)`" persistence-phase1.md §2.1 specified — **confirmed, world-gen produces precisely that id.**
- **Load order honored:** world-gen's `LoadDiffs` runs at persistence load step 3 (after core-engine re-seeds, before factory-sim/gameplay) — terrain+deposit placement regenerates, then depletion patches it (persistence §4.5). World-gen is regenerate-then-patch, never load-every-node.
- **PS-7 / WV1 dependency:** this all rests on deterministic regen — the deposit catalog regenerating bit-identically (§4.5.2 inherits WG-6 / WV1). That is already a world-gen guarantee. **No new gen risk; no new contract from persistence beyond implementing `IPersistable`.**

> **Decision WG-12 (Accepted):** C-6 confirmed for world-gen — it implements persistence's `IPersistable` (chunk-scoped, `DomainId=WorldGen`) over **deposit depletion only**: `(depositId, remaining)[]` per region, `depositId = hash64(bodySeed, region, localIndex)` (the stable id persistence §2.1 asked for). Terrain regenerates from seed (PS-7/WV1) — not serialized; voxel seam empty (WG-2). World-gen's whole Phase-1 diff surface is this one record type. *(§4.6)*

---

## 5. Body parameters (the 2 bodies)

Published to **physics** (μ, radius, SOI, rotation) and **rendering** (radius, atmosphere). Values are spike-scale (KSP-Kerbin/Mun-inspired, round numbers) — **gameplay-tuned later**. They must be consistent with the rails/spin/μ that core-engine's `FReferenceFrame` already carries (spike1-core-engine.md §2.1, §5.2) — world-gen owns the **surface/atmosphere** half; core-engine owns the **orbit rail** half; **μ, radius, SOI, spin are shared and must match**.

```cpp
USTRUCT()
struct FBodyParams {
    FBodyId   BodyId;
    FFrameId  Frame;            // == the body's frame in IFrameGraph
    double    RadiusM;          // reference (sea-level / datum) radius, meters
    double    Mu;               // gravitational parameter GM (m^3/s^2)  — matches FReferenceFrame.Mu
    double    SurfaceGravity;   // m/s^2 at RadiusM (= Mu / RadiusM^2), convenience
    double    SoiRadiusM;       // matches FReferenceFrame.SoiRadius
    FBodySpin Spin;             // axis, sidereal period, phase0 — matches FReferenceFrame.Spin
    bool      bHasAtmosphere;
    FAtmosphereProfile Atmo;    // valid iff bHasAtmosphere
    double    SeaLevelM;        // relief clamp datum (planet); 0 for moon
    double    MaxReliefM;       // max |h| from noise — for culling bounds / SOI sanity
};

USTRUCT()
struct FAtmosphereProfile {     // basic exponential isothermal model (spike)
    double ScaleHeightM;        // H: density e-folding height (Rayleigh) → UE "Rayleigh Exponential Distribution"
    double SeaLevelDensity;     // kg/m^3 at datum
    double SeaLevelPressure;    // Pa at datum
    double AtmoTopM;            // altitude where atmo is treated as vacuum (~ several H)
    // density(alt) = SeaLevelDensity * exp(-alt / ScaleHeightM), 0 above AtmoTopM
    FLinearColor RayleighTint;  // placeholder sky tint for rendering's scattering (Wave 2)
    // --- RC-2 append-only additions (rendering, spike1-rendering §4.2 / §8 GAP) — Mie/aerosol terms ---
    // UE Sky-Atmosphere needs Mie inputs for horizon haze / aerial perspective; these supply them so
    // rendering hardcodes no Mie default (D-006). Airless bodies (bHasAtmosphere=false) leave them 0 / N/A.
    double MieScaleHeightM;     // Mie (aerosol) e-folding height, metres → UE "Mie Exponential Distribution".
                                //   Aerosols hug the surface, so typically << Rayleigh ScaleHeightM.
    double MieScatteringScale;  // Mie scattering coefficient/strength (haze density) → UE "Mie Scattering Scale".
                                //   Relative strength scalar; tuned so the horizon haze reads correctly.
    double MieAnisotropy;       // Mie phase asymmetry g, dimensionless [−1,1], forward-scatter ~0.76–0.85
                                //   → UE "Mie Anisotropy". Drives the bright sun-side horizon glow.
};
```

### 5.1 Planet — "Forge" (placeholder name)

| Param | Value | Note |
|---|---|---|
| Radius (datum) | **600 km** (6.0e5 m) | Kerbin-scale; big enough to feel planetary, small enough to traverse in a spike |
| μ (GM) | **3.53e12 m³/s²** | gives g₀ ≈ 9.81 m/s² at surface |
| Surface gravity g₀ | **~9.81 m/s²** | `μ/R²` |
| SOI radius | **~84,000 km** (8.4e7 m) | must equal `PlanetFrame.SoiRadius`; comfortably contains the moon's orbit |
| Sidereal rotation | **6 h** (21,600 s) | walker co-rotates with surface (core-engine `Spin`) |
| Atmosphere | **YES** | scale height **H ≈ 5,600 m**, sea-level ρ ≈ 1.2 kg/m³, P ≈ 101 kPa, top ≈ 70 km |
| Atmo — Mie (RC-2) | **`MieScaleHeightM ≈ 1,200 m`**, **`MieScatteringScale ≈ 1.0`**, **`MieAnisotropy ≈ 0.80`** | aerosol haze hugs the surface (Mie H << Rayleigh H); `g≈0.80` gives a natural forward-scatter horizon glow (Earth-like, UE Sky-Atmosphere default-range) |
| Max relief | **~6 km** | continents+mountains (§2.1) |
| Sea level | datum (h clamped ≥ 0) | flat placeholder ocean plane |
| Deposits (C-1, §4.5) | **Ferrite-ore `ItemId`** (+ optional fuel-item id) | base on-planet ore; broader/richer density. `ItemId` is gameplay-owned (C-3); world-gen only places it. **Never carries the Cinderite id.** |

### 5.2 Moon — "Cinder" (placeholder name)

| Param | Value | Note |
|---|---|---|
| Radius (datum) | **200 km** (2.0e5 m) | Mun-scale, airless |
| μ (GM) | **6.5e10 m³/s²** | gives g₀ ≈ 1.63 m/s² (≈ lunar) at surface |
| Surface gravity g₀ | **~1.63 m/s²** | low-g landing feel; stresses the frame-velocity/landing path of core-engine V4 |
| SOI radius | **~2,400 km** (2.4e6 m) | must equal `MoonFrame.SoiRadius`; the SOI the demo *enters* (core-engine §2.3 / V5) |
| Orbit (rail) | owned by core-engine | `MoonFrame.LocalOrbit` around the planet; world-gen doesn't set it, just consumes the frame |
| Sidereal rotation | **~40 h** (slow) | placeholder |
| Atmosphere | **NO** | `bHasAtmosphere=false`; airless — sharp terminator, no scattering |
| Atmo — Mie (RC-2) | **N/A (airless)** | `FAtmosphereProfile` is not valid for Cinder (`bHasAtmosphere=false`); Mie fields (like all atmo fields) are unused — left **0 / N/A**. Rendering draws no Sky-Atmosphere for Cinder (spike1-rendering §4.4) |
| Max relief | **~4 km** | craters + rolling (§2.2) |
| Deposits (C-1, §4.5) | **Cinderite `ItemId`** (Cinder-only) | **the off-world hook (WG-4, P1-D4).** This id is placed on **no Forge node** — the only place to mine it is Cinder, making "you must leave the planet" concrete. `ItemId` is gameplay-owned (C-3); world-gen owns only *that it lives here and nowhere else* (§4.5.3). Sparse density. |

> **Cross-check flagged to Admin:** `RadiusM`, `Mu`, `SoiRadiusM`, `Spin` here are **shared** with core-engine's `FReferenceFrame`. Core-engine's spike doc lists "circular `{radius, period, phase}`" rails and `mu`/`soiRadius` fields but **does not pin numeric values**. These numbers are world-gen's proposal; **Admin should confirm core-engine adopts the same constants** (single source of truth) — see §7 DEPENDENCIES. No contract conflict, just a value that must be agreed once.

> **RC-2 (append-only, non-breaking — reconciliation 2026-06-14):** `MieScaleHeightM`, `MieScatteringScale`, `MieAnisotropy` were **appended** to `FAtmosphereProfile` for rendering's UE Sky-Atmosphere horizon haze (spike1-rendering §4.2 mapping table + §8 GAP). They sit at the **end** of the struct; no existing field (Rayleigh terms, tint, scale height) changed meaning or position, so rendering — already a consumer of `FAtmosphereProfile` — sees no break. World-gen owns these constants (D-006: rendering hardcodes no Mie default; it now reads them). **Forge:** `MieScaleHeightM≈1,200 m`, `MieScatteringScale≈1.0`, `MieAnisotropy≈0.80` (§5.1). **Cinder:** airless → `FAtmosphereProfile` invalid (`bHasAtmosphere=false`), Mie fields **0 / N/A** (§5.2). (See world-gen.md §3 decision WG-10, §5.)

---

## 6. Step-by-step UE5 build plan

Built so it slots into core-engine's Wave 1 step 8 ("Bodies as OnRails SimProxies… world-gen supplies real minimal terrain when ready; until then a primitive sphere collider"). World-gen replaces that primitive.

### WG-Build 0 — Pure-CPU core (no UE rendering yet, unit-testable)
1. **`FQuadKey` + quad math** (§1.2): face basis table, `QuadExtent`, path pack/unpack, `unitDir` with tangent warp. Unit-test: child quads tile the parent exactly; the 12 cube edges' shared `dir`s match between the two faces (seam determinism, §1.4-#1).
2. **Noise stack** (§2): `SampleHeightField(bodySeed, dir)` for planet & moon; position-hashed; octave-gated. Unit-test: same `dir` → same `h` regardless of call order/quad; visualize an equirectangular height dump per body to eyeball "looks like a planet / cratered moon."
3. **`GenerateQuadMesh`** (§1.3): grid → vertices (body-center-relative) → normals → skirt. Unit-test: **adjacent same-depth quads share identical edge vertices; parent edge == child coarse edge** (zero gap, the crack guarantee).

### WG-Build 1 — Streaming + LOD live in UE5
4. **`UTerrainStreamer`** (UE `UActorComponent` / world subsystem): the quadtree per face, `DesiredSplit`/merge with hysteresis (§3.1), balanced-quadtree cascade (§1.4 invariant), async `GenerateQuadMesh` on a worker pool, swap-when-4-children-ready, eviction dwell, per-tick generation budget (§3.2).
5. **Chunk → render mesh:** emit `FTerrainChunk` (§4.1); build a UE mesh (ProceduralMeshComponent or `RealtimeMesh`/Nanite-friendly path — rendering picks the final, we provide the data) per resident quad; placeholder material by `MaterialId`. Fire `OnChunkReady`/`OnChunkEvicted`.
6. **Floating-origin hookup** (§3.3): store each quad center as `FUniverseCoord`; subscribe `OnOriginRebased`; on rebase, re-`ToEngine` every resident quad's component transform (no vertex rewrite). Subscribe `OnSOIChange` to gate which body streams fine LOD (§3.2).
7. **Body params + frames** (§5): register planet & moon `FBodyParams`; bind each `FBodyId` to its `FFrameId` from `IFrameGraph`; confirm μ/radius/SOI/spin match core-engine's `FReferenceFrame` (reconcile via Admin if not).
8. **Query layer** (§4.3): implement `SampleTerrainHeight`, `GetGroundContact`, `RaycastTerrain` against the heightfield (resident-free); wire the `ApplyPatchOverride`/`bFromVoxelPatch` stub (§4.4). Give core-engine's observer pawn a real ground to stand/land on (replaces the primitive sphere collider).

### WG-Build 2 — Integrate with the core-engine demo
9. **Swap into the demo:** in core-engine's walk→orbit→land flow (spike1-core-engine.md §6 "demo flow"), replace the placeholder sphere colliders for planet & moon with streamed terrain. Walk on planet (co-rotating via `Spin`), ascend (watch LOD coalesce + rebases re-anchor terrain transforms), cross to moon (SOI event begins moon streaming), descend (LOD subdivides), land & walk on craters.

### 6.1 Validation — continuous LOD, no cracks, no popping (acceptance gates)

| # | What to prove | How | Pass criteria |
|---|---|---|---|
| **WV1** | Deterministic regen | Generate same `FQuadKey` twice, two processes; compare `ContentHash` & vertices | Byte-identical (seed+diff persistence is sound) |
| **WV2** | No cracks at equal LOD | Render two adjacent same-depth quads + across all 3 face-corner seams | No visible gap; shared edge verts bit-identical |
| **WV3** | No cracks at LOD boundary | Force a 1-level LOD step between neighbors; inspect the seam | Skirt closes it; no hole; balanced-quadtree holds (no >1-level step) |
| **WV4** | No LOD popping on descent | Fly orbit→surface continuously; watch quads subdivide | Subdivision is gradual; swap-when-ready means no half-built holes; no visible snap (hysteresis + skirts) |
| **WV5** | Rebase re-anchors terrain | Trigger core-engine rebases (4 km radius) while terrain resident | Terrain stays put visually; only transforms refreshed; **no terrain pop at rebase** (ties core-engine V2) |
| **WV6** | SOI-gated streaming | Cross planet→moon SOI (core-engine V5) | Moon begins streaming on `OnSOIChange`; planet drops fine LOD; no hitch |
| **WV7** | Query correctness | `SampleTerrainHeight`/`GetGroundContact` vs the rendered mesh at random lat/lon | Query surface matches rendered surface within tolerance; resident-free queries work |
| **WV8** | Streaming budget | Fast descent; watch per-tick mesh-gen count | Generations spread across ticks; no frame spike beyond budget (R2) |

WV5/WV6 are the **integration gates with core-engine** — they prove terrain honors the floating-origin + frame contracts, not just that it meshes a sphere.

---

## 7. Open questions & risks (this spike)

- **WR1 (primary):** seam/crack freedom across cube-face boundaries at high LOD. Mitigated by shared-edge determinism + skirts + balanced quadtree (§1.4); validated by WV2/WV3. Residual risk: tangent-warp float error at face corners could de-sync shared `dir`s — mitigate by computing face-edge `dir`s from a **single canonical face** (lower faceId owns the shared edge) so both faces read identical doubles. **Built-in canonicalization, noted for WG-Build 0 step 1.**
- **WR2 (perf, = world-gen.md R2):** noise cost at low LOD over a 600 km body. Mitigated by octave-gating (§2) + per-tick generation budget (§3.2). Validate WV8.
- **WR3:** body-param numbers (§5) must equal core-engine's `FReferenceFrame` constants. **Dependency on Admin to confirm single source of truth.** No contract conflict, just value agreement.
- **WR4 (deferred, seam kept):** voxel-patch ↔ heightfield continuity (world-gen.md R1). API seam built (§4.4, `bFromVoxelPatch`), implementation deferred to Phase 4 (D-005).
- **WR5:** physics collision against a heightfield (vs a baked collision mesh) — the query layer (§4.3) is analytic/sphere-traced; whether physics wants per-quad baked collision bodies or analytic queries is a **physics-domain decision** to negotiate (the contract supports both: analytic queries now, collision-mesh emission can be added to `FTerrainChunk` later without breaking callers).

---

## 8. Cross-domain notes (for Admin)

- **core-engine (consumed):** `FUniverseCoord`+`FFrameId`, `FFloatingOrigin`/`ToEngine`, `OnOriginRebased`, `OnSOIChange`, `IFrameGraph`, `FReferenceFrame` (μ/radius/SOI/spin). **All honored. One reconcile item:** numeric body constants (§5, WR3) — Admin confirm core-engine adopts the same.
- **rendering (Wave 2, provided):** `FTerrainChunk` (§4.1) + `OnChunkReady`/`OnChunkEvicted` + `ITerrainProvider`. Rendering owns materials/scattering; we hand them geometry + `MaterialId` + atmosphere profile (§5).
- **physics (later, provided):** `SampleTerrainHeight` / `GetGroundContact` / `RaycastTerrain` (§4.3), all `FUniverseCoord`-based. **Negotiate WR5** (analytic queries vs baked collision meshes).
- **gameplay + factory-sim (Phase 1, provided — C-1):** **`FDepositNode`** catalog (§4.5) + the `GetDeposits`/`QueryDepositsNear`/`GetDeposit`/`ExtractFromDeposit` query surface. Three-way consumer (gameplay mining UX, factory-sim miner extraction, persistence depletion). **Cross-domain dependency on gameplay (C-3):** the deposit's `Resource` is gameplay's **opaque `ItemId`** — world-gen references it, does **not** define it; we need the C-3 `ItemId` registry to exist with stable ids for **Ferrite-ore** (Forge) and **Cinderite** (Cinder-only). World-gen guarantees *placement* (which body carries which id); gameplay owns *the id and its meaning*. Flagged for Admin to confirm the single `FDepositNode` serves all three (it does) and that `ItemId` is the one shared C-3 space. **`DepositTypeId` from gameplay's §8.A proposal is collapsed into `ItemId`** — no separate world-gen type. *(WG-11)*
- **persistence (Phase 1, provided — C-6):** `FQuadKey`+`bodySeed` regenerate any chunk **and the deposit catalog** (WV1); only voxel-patch diffs (Phase 4) and **deposit-depletion** (Phase 1) need saving — natural terrain + deposit placement are free (MASTER_PLAN §9, WG-3). **Confirmed:** world-gen implements `IPersistable` (chunk-scoped, `DomainId=WorldGen`) over `(depositId, remaining)[]` per region; `depositId = hash64(bodySeed, region, localIndex)` — exactly the stable id persistence §2.1 specified (§4.6, WG-12). No new ask of persistence beyond implementing the interface.

## 9. References

KSP PQS / Procedural Quad Sphere ([KSP Wiki](https://wiki.kerbalspaceprogram.com/wiki/Tutorial:Making_Planets), [Kopernicus PQS](https://kopernicus.github.io/wiki/content/PQSMods/PQS.html)). Chunked-LOD planet seams/cracks: [terrain LOD & cracks](https://www.gamedev.net/forums/topic/713470-terrain-lod-and-cracks/), [chunked LOD procedural planets](https://www.gamedev.net/forums/topic/485584-chunked-lod-with-procedural-planets/), [quadtree terrain stitching](https://www.gamedev.net/forums/topic/597910-quadtree-terrain-stitching/). Cube→sphere mapping: [Cube-to-sphere projections, JCGT 2018](https://www.jcgt.org/published/0007/02/01/paper.pdf), [Quadrilateralized spherical cube (COBE)](https://en.wikipedia.org/wiki/Quadrilateralized_spherical_cube). Core-engine contracts: [spike1-core-engine.md](spike1-core-engine.md) §1,§2,§5.
