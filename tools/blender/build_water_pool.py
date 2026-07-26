"""build_water_pool.py - Water pool, NodeKind::WaterPool.

    blender --background --python tools/blender/build_water_pool.py

Produces assets/models/dist/nodes/water_pool.glb.

3.0 x 3.0 m, rim 0.25 m proud of the ground: a shallow rock-rimmed basin with
a muddy bed and a flat water plane just below the rim. Near-flat assets get
near-flat budgets, so this is a 12-sided irregular rim prism, one n-gon bed,
four half-buried rim rocks and a single n-gon of water.

DEPLETION IS THE WATERLINE. _Full sits 0.05 m below the rim, _Half drops to
0.125 m and _Low to 0.055 m, and each drop exposes a ring of wet mud that was
not visible before. Falling water plus a growing brown ring is the clearest
depletion read of the nine nodes and it costs 48 triangles.

    WaterPool
      WaterPool_<V>_LOD0 / _LOD1     rim, bed and exposed mud for that level
      ripple_pivot                   Water_Ripple translates this in Z
        WaterPool_<V>_Water          the water plane for that level
      col_WaterPool
      socket_draw

The three water planes hang off ONE shared pivot because validate_glb.py
checks the clip name set exactly, so there can only be one Water_Ripple in the
file and one object for it to drive. The renderer therefore shows every node
whose name starts with `WaterPool_<Variant>_`, which picks up both the LOD
mesh and the matching water plane.

PREFERRED AT RUNTIME: drive the surface from a vertex-displacement shader and
ignore the clip. The clip exists so the asset is complete without shader work.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "WaterPool"
OUT = of.dist_path("nodes", "water_pool.glb")
DIMS = (3.00, 3.00, 0.25)
ORDER = ["Rock", "Soil", "Water"]
SEED = 7307

R_OUT, R_IN, RIM_Z = 1.42, 1.00, 0.24
BED_Z = 0.02

# (variant, water radius, water level, mud shelf inner radius or None)
LEVELS = (("Full", 1.02, 0.200, None),
          ("Half", 0.78, 0.125, 0.76),
          ("Low", 0.46, 0.055, 0.44))


def _basin(seg_rim=12, seg_bed=10, rocks=True):
    p = hc.Parts()
    p.add(*hc.rim_ring(seg_rim, R_OUT, R_IN, RIM_Z, seed=SEED, jit=0.06,
                       z_jit=0.05), role="Rock")
    p.add(*hc.ngon(seg_bed, R_IN + 0.04, BED_Z, seed=SEED + 3, jit=0.05),
          role="Soil")
    if rocks:
        # Half-buried rim rocks. They break the ring's outline so the pool
        # reads as a landform rather than a washer dropped on the terrain.
        for k, (x, y, rx, ry) in enumerate(((1.05, 0.42, 0.30, 0.26),
                                            (-0.62, 1.02, 0.26, 0.28),
                                            (-1.06, -0.52, 0.28, 0.24),
                                            (0.46, -1.10, 0.24, 0.26))):
            p.add(*hc.lobe(rx, ry, 0.235, loc=(x, y, 0.0), seg=5,
                           seed=SEED + 11 + k * 13, jit=0.18)[:3], role="Rock")
    return p


def lod0(variant):
    for vname, _, level, shelf in LEVELS:
        if vname != variant:
            continue
        p = _basin()
        if shelf is not None:
            # The mud ring the falling waterline uncovers: from the old
            # shoreline down to the new one.
            p.add(*hc.rim_ring(8, R_IN + 0.03, shelf, level + 0.012,
                               seed=SEED + 21, jit=0.05, z_jit=0.10,
                               z_bottom=BED_Z), role="Soil")
        return p
    raise KeyError(variant)


def lod1(variant):
    p = _basin(seg_rim=8, seg_bed=8, rocks=False)
    for vname, _, level, shelf in LEVELS:
        if vname == variant and shelf is not None:
            p.add(*hc.rim_ring(6, R_IN + 0.03, shelf, level + 0.012,
                               seed=SEED + 21, jit=0.05, z_jit=0.10,
                               z_bottom=BED_Z), role="Soil")
    return p


def water(radius, level):
    p = hc.Parts()
    p.add(*hc.ngon(12, radius, level, seed=SEED + 31, jit=0.03), role="Water")
    return p


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    hero = lod0("Full")
    xform = hero.fit(DIMS)

    ripple = of.add_pivot("ripple_pivot", (0.0, 0.0, 0.0), root)

    reported = []
    for vname, wr, wz, _ in LEVELS:
        for lod, maker in enumerate((lod0, lod1)):
            p = hero if (vname == "Full" and lod == 0) else maker(vname)
            if p is not hero:
                p.apply(xform)
            mb = of.MeshBuilder()
            p.into(mb, role_order=ORDER)
            mb.build("%s_%s_LOD%d" % (NAME, vname, lod), root)
            reported.append(("%s_LOD%d" % (vname, lod), mb))
        w = water(wr, wz).apply(xform)
        mb = of.MeshBuilder()
        w.into(mb, role_order=ORDER)
        mb.build("%s_%s_Water" % (NAME, vname), ripple)
        reported.append(("%s_Water" % vname, mb))

    of.add_collision_box("col_" + NAME, DIMS, (0, 0, DIMS[2] * 0.5), root,
                         role="Rock")
    of.add_socket("socket_draw", (0.0, 0.0, 0.20), parent=root,
                  extras={"of_role": "draw"})

    # Water_Ripple, 1 to 121, loop, +/- 10 mm in Z. Frame 1 is the identity
    # pose: an Action is evaluated at the current frame and baked into the
    # exported node TRS, so a clip that starts off-origin permanently offsets
    # the asset.
    of.add_clip(ripple, "Water_Ripple", "location",
                [(1, (0.0, 0.0, 0.000)), (31, (0.0, 0.0, 0.010)),
                 (61, (0.0, 0.0, 0.000)), (91, (0.0, 0.0, -0.010)),
                 (121, (0.0, 0.0, 0.000))])

    of.report(NAME, reported)
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
