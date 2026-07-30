"""build_props_plains.py - the Plains biome scatter atlas.

    blender --background --python tools/blender/build_props_plains.py

Produces assets/models/dist/props/props_plains.glb (ASSET-SPECS 3.2,
Biome::Plains).

Plains is the biome the player spends the first hour in, and the one with the
least terrain relief to look at, so its dressing does the work the landform
does not. Six props across three scale bands: two grass patches that differ in
height and density rather than in shape, a flower cluster that is the only
saturated colour in any biome atlas, two pebbles a step apart in size, and one
shrub that breaks the horizon line.

Materials (6): OF_Grass, OF_LeafLight, OF_LeafDry, OF_Accent, OF_Leaf, OF_Rock.
The pebbles carry a couple of OF_LeafDry facets as dry lichen, which is a
second stone tone for free.

Collision: Plains_PebbleB only. Everything else - both grass patches, the
flowers, the small pebble and the shrub - is walk-through, because plains
scatter is dense and a player pushing through waist-high grass should not
feel it.

W11 pass (2026-07-27, dims relaxed by the controller the same night): the two
grass tufts are no longer a single bouquet standing in the middle of their
footprint - the scatter system's instance cap (PropLibrary.ts CAPACITY=7000
over a 170 m radius) means coverage per instance is the only lever available
without a client change, so each one is now several loose FANS scattered
across a much bigger footprint with bare ground between them, so one instance
reads as a patch of meadow rather than a shaving brush. Grass moved onto its
own OF_Grass role (distinct from tree OF_Leaf, and its own BatchedMesh pool in
PropLibrary), and a couple of blades per fan run taller as pale OF_LeafLight
seed heads, which is what breaks a tuft's flat top line.

CORRECTED same night, second pass: the first cut of "several fans" was still a
RING of individually spaced blades per fan, which reads as isolated 1-2 cm
spikes at the 20-50 m the scatter system actually views this prop from - a
blade that thin is sub-pixel and vanishes, the exact failure this asset was
being redone to fix. Low-poly grass reads at distance from MASS, not from
blade count: each fan is now built from a small spawn radius (blades share a
near-common base) and a wide blade (base taper starts around 10-12 cm, not
2 cm), so the fan has a solid green core at its centre and only the TIPS
splay to break the outline - "a low-poly bush that happens to be made of
blades", not blades modelled individually. The shrub's three green lobes pick
up an OF_LeafLight top-facet highlight (the same "facets that see the sky"
trick forest_rock uses for moss), so it reads as a lit mass instead of a flat
green blob.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsPlains"
OUT = of.dist_path("props", "props_plains.glb")

# (offset x, offset y, blade count, height, seed, seed-head count) per fan.
# Spawn radius and blade width are constants at the call site (below), tuned
# so a fan's blades share a near-common base and OVERLAP into a solid core:
# individual blades only separate near the tip, which is what breaks the
# outline without the clump ever thinning out to isolated spikes.
GRASS_A_FANS = (
    (0.00, 0.00, 6, 0.44, 3101, 1),
    (0.30, 0.22, 6, 0.40, 3113, 1),
    (-0.28, 0.20, 5, 0.42, 3127, 0),
    (0.02, -0.32, 5, 0.36, 3139, 1),
)

GRASS_B_FANS = (
    (0.00, 0.00, 7, 0.62, 3111, 1),
    (0.40, 0.30, 6, 0.54, 3121, 1),
    (-0.38, 0.26, 6, 0.56, 3133, 0),
    (0.02, -0.42, 5, 0.48, 3143, 1),
)


def grass_tuft_a():
    """A meadow patch built from a few overlapping FANS, not a ring of
    individually spaced blades: each fan's blades share a near-common base
    (spawn radius 0.030) and are wide (0.115, tapering to a point), so the
    fan has a solid green core at 20-50 m instead of vanishing into 1-2 cm
    hairs. Several fans spread across the footprint with bare ground
    between THEM is the patch; the overlap inside one fan is the mass."""
    p = hc.Parts()
    for cx, cy, count, h, seed, nheads in GRASS_A_FANS:
        p.extend(pc.tuft(count, h, 0.115, 0.030, seed, bend=0.22, segs=3,
                         droop=0.32, role="Grass", h_var=0.32,
                         loc=(cx, cy, 0.0), heads=nheads,
                         head_role="LeafLight"))
    return p


def grass_tuft_a_lod2():
    p = hc.Parts()
    for cx, cy, seed in ((0.0, 0.0, 3101), (-0.20, 0.16, 3161)):
        p.extend(pc.tuft(3, 0.42, 0.16, 0.020, seed, bend=0.22, segs=2,
                         droop=0.32, role="Grass", h_var=0.24,
                         loc=(cx, cy, 0.0)))
    return p


def grass_tuft_b():
    """Taller, sparser, going over: four fans spread wider than tuft A's,
    still built from a tight, wide-based cluster so it keeps its mass, a dry
    note through every fan (every 3rd blade) and pale seed heads breaking
    the top line - the whole difference in read between A and B at 15 m."""
    p = hc.Parts()
    for cx, cy, count, h, seed, nheads in GRASS_B_FANS:
        p.extend(pc.tuft(count, h, 0.125, 0.035, seed, bend=0.32, segs=3,
                         droop=0.38, role="Grass", alt_role="LeafDry",
                         alt_every=3, h_var=0.34, phase=17.0,
                         loc=(cx, cy, 0.0), heads=nheads,
                         head_role="LeafLight"))
    return p


def grass_tuft_b_lod2():
    p = hc.Parts()
    for cx, cy, seed in ((0.0, 0.0, 3111), (0.26, 0.20, 3179),
                        (-0.24, 0.14, 3185)):
        p.extend(pc.tuft(3, 0.58, 0.17, 0.025, seed, bend=0.32, segs=2,
                         droop=0.38, role="Grass", alt_role="LeafDry",
                         alt_every=3, h_var=0.26, phase=17.0,
                         loc=(cx, cy, 0.0)))
    return p


def _flower(height, azim, bend, seed, radius):
    """One straight stem with a flat petal disc on its tip.

    The disc is a single n-gon facing +Z: three triangles, single sided, seen
    from above, which is the only angle a 60 mm flower is ever read from. The
    stem tip is computed from the same expression blade() uses, so the head
    lands exactly on it rather than near it."""
    p = hc.Parts()
    droop = 0.06
    p.add(*pc.blade(height, 0.022, azim, bend, segs=2, droop=droop),
          role="Grass", uvs=pc.blade_uvs("Grass", 2, seed))
    a = math.radians(azim)
    tip = (math.cos(a) * bend, math.sin(a) * bend, height * (1.0 - droop))
    p.add(*hc.ngon(5, radius, 0.0, loc=tip, seed=seed, jit=0.18),
          role="Accent")
    return p


def flower_cluster():
    p = pc.tuft(7, 0.30, 0.065, 0.05, 3121, bend=0.20, segs=3, droop=0.34,
                role="Grass", h_var=0.35)
    for i, (h, az, bd, r) in enumerate(((0.50, 20.0, 0.06, 0.055),
                                        (0.44, 95.0, 0.10, 0.048),
                                        (0.47, 155.0, 0.05, 0.052),
                                        (0.38, 210.0, 0.11, 0.042),
                                        (0.52, 265.0, 0.07, 0.050),
                                        (0.40, 315.0, 0.08, 0.045))):
        p.extend(_flower(h, az, bd, 3131 + i * 7, r))
    return p


def flower_cluster_lod2():
    p = pc.tuft(3, 0.30, 0.080, 0.035, 3121, bend=0.20, segs=2, droop=0.34,
                role="Grass", h_var=0.26)
    for i, (h, az, bd, r) in enumerate(((0.50, 20.0, 0.06, 0.060),
                                        (0.47, 155.0, 0.05, 0.055))):
        p.extend(_flower(h, az, bd, 3131 + i * 7, r))
    return p


def pebble_a():
    return pc.rock(3141, "Rock", "LeafDry", ((13, 16),), lobes=1, seg=6,
                   jit=0.22, rings=pc.SLAB_RINGS,
                   plan=(((0.0, 0.0, 0.0), (0.50, 0.44, 0.26)),))


def pebble_b():
    """One step up in size and one lobe up in complexity, so the two pebbles
    never read as the same rock scaled."""
    return pc.rock(3151, "Rock", "LeafDry", ((12, 15), (14,)), lobes=2, seg=6,
                   jit=0.19,
                   plan=(((0.00, 0.00, 0.00), (0.50, 0.44, 0.34)),
                         ((0.32, -0.14, 0.00), (0.26, 0.24, 0.22))))


def shrub():
    """Four leaf masses sitting straight on the ground, no visible stem: at
    1 m across a stem is two pixels and costs 16 triangles to say nothing.
    The three green masses pick up an OF_LeafLight top-facet highlight (the
    same "facets that see the sky" trick forest_rock uses for moss on a
    boulder), so the shrub reads as a lit mass rather than a flat green
    blob, for zero extra triangles."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.44, 0.40, 0.62), "Leaf", 3161),
            ((0.30, 0.16, 0.00), (0.28, 0.26, 0.44), "Leaf", 3167),
            ((-0.26, 0.14, 0.00), (0.26, 0.24, 0.40), "LeafDry", 3173),
            ((0.04, -0.28, 0.00), (0.24, 0.22, 0.36), "Leaf", 3179))
    top_fan = (12, 13, 14, 15, 16, 17)   # DOME_RINGS, seg=6: the apex facets
    for loc, r, role, seed in plan:
        hi = "LeafLight" if role == "Leaf" else None
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed,
                                  jit=0.22, role=role, ore_role=hi,
                                  ore_faces=top_fan if hi else ())
        # Every face of a shrub lobe is a foliage role, so the whole lobe
        # takes the shell UV rule.
        p.add(v, f, sm, roles,
              uvs=pc.shell_uvs(v, seed, centre=(loc[0], loc[1])))
    return p


PROPS = [
    pc.Prop("Plains_GrassTuftA", (0.95, 0.95, 0.55), grass_tuft_a,
            ["Grass", "LeafLight"], lod2=grass_tuft_a_lod2),
    pc.Prop("Plains_GrassTuftB", (1.30, 1.30, 0.78), grass_tuft_b,
            ["Grass", "LeafDry", "LeafLight"], lod2=grass_tuft_b_lod2),
    pc.Prop("Plains_FlowerCluster", (0.70, 0.70, 0.55), flower_cluster,
            ["Grass", "Accent"], lod2=flower_cluster_lod2),
    pc.Prop("Plains_PebbleA", (0.34, 0.30, 0.18), pebble_a,
            ["Rock", "LeafDry"], lod2=0.20),
    pc.Prop("Plains_PebbleB", (0.85, 0.72, 0.50), pebble_b,
            ["Rock", "LeafDry"], lod2=0.18, collide=True, col_role="Rock"),
    pc.Prop("Plains_Shrub", (1.05, 0.95, 0.80), shrub,
            ["Leaf", "LeafDry", "LeafLight"], lod2=0.16),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
