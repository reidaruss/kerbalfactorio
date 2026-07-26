"""build_oil_seep.py - Oil seep, NodeKind::OilSeep.

    blender --background --python tools/blender/build_oil_seep.py

Produces assets/models/dist/nodes/oil_seep.glb.

2.2 x 2.2 x 0.35 m. A dark tar pool in a cracked crust: a 10-sided irregular
crust ring, loose crust chips, a soil apron at the tar line and a flat oil
surface just above the bed. OF_Oil is nearly black at roughness 0.25, which is
the point: every other ground material in the palette is matte, so the one
glossy patch on the terrain is unmistakably oil at any distance.

DEPLETION IS THE TAR LINE, the same idea as the water pool: the slick shrinks
from 0.70 m to 0.46 m to 0.26 m radius and a widening ring of dried crust
takes its place, and the pressure mounds go from two, to one, to none. A dead
seep is flat, dry and matte, which is exactly how it should read.

    OilSeep
      OilSeep_<V>_LOD0 / _LOD1    crust, apron and slick for that level
      bubble_pivot                Oil_Bubble drives this
        OilSeep_<V>_Bulges        pressure mounds for that level
      col_OilSeep
      socket_draw / socket_item_pop

ONE CLIP, TWO MOUNDS THAT DO NOT PULSE TOGETHER. ASSET-SPECS 4.10 asks for the
two bulges to swell half a cycle apart, but the validator checks the clip name
set exactly, so there is exactly one Oil_Bubble and one object for it to drive.
The mounds are therefore keyed as one group whose pivot ROTATES a few degrees
about Y as well as scaling: the mound at -X rises while the mound at +X sinks,
which is the alternation the spec asks for, out of one clip on one object.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "OilSeep"
OUT = of.dist_path("nodes", "oil_seep.glb")
DIMS = (2.20, 2.20, 0.35)
ORDER = ["Rock", "Soil", "Oil"]
SEED = 8419

R_OUT, R_IN, CRUST_Z = 1.05, 0.70, 0.335

# (variant, slick radius, slick level, dried-crust inner radius or None,
#  mound count)
LEVELS = (("Full", 0.68, 0.060, None, 2),
          ("Half", 0.46, 0.048, 0.44, 1),
          ("Low", 0.26, 0.035, 0.24, 0))

MOUNDS = (((-0.34, 0.10, 0.105), (0.26, 0.24), 0.17),
          ((0.36, -0.14, 0.090), (0.20, 0.22), 0.14))


def _crust(seg_ring=10, chips=True):
    p = hc.Parts()
    p.add(*hc.rim_ring(seg_ring, R_OUT, R_IN, CRUST_Z, seed=SEED, jit=0.05,
                       z_jit=0.06), role="Rock")
    if chips:
        # Loose plates sheared off the crust. Flat, angular and half sunk:
        # the seep should look like ground that split, not a bowl.
        for k, (x, y, rx, ry) in enumerate(((0.74, 0.46, 0.24, 0.20),
                                            (-0.50, 0.72, 0.22, 0.24),
                                            (-0.14, -0.86, 0.26, 0.20))):
            p.add(*hc.lobe(rx, ry, 0.16, loc=(x, y, 0.0), seg=5,
                           seed=SEED + 7 + k * 19, jit=0.20)[:3], role="Rock")
    return p


def lod0(variant):
    for vname, sr, sz, dried, _ in LEVELS:
        if vname != variant:
            continue
        p = _crust()
        if dried is not None:
            p.add(*hc.rim_ring(8, R_IN + 0.02, dried, sz + 0.010,
                               seed=SEED + 23, jit=0.05, z_jit=0.12,
                               z_bottom=0.015), role="Soil")
        p.add(*hc.ngon(10, sr, sz, seed=SEED + 31, jit=0.04), role="Oil")
        return p
    raise KeyError(variant)


def lod1(variant):
    p = _crust(seg_ring=8, chips=False)
    for vname, sr, sz, dried, _ in LEVELS:
        if vname != variant:
            continue
        if dried is not None:
            p.add(*hc.rim_ring(6, R_IN + 0.02, dried, sz + 0.010,
                               seed=SEED + 23, jit=0.05, z_jit=0.12,
                               z_bottom=0.015), role="Soil")
        p.add(*hc.ngon(8, sr, sz, seed=SEED + 31, jit=0.04), role="Oil")
    return p


def bulges(count):
    p = hc.Parts()
    for k in range(count):
        loc, r, h = MOUNDS[k]
        p.add(*hc.blob(r[0], r[1], h, loc, seg=6, seed=SEED + 41 + k * 17,
                       jit=0.14, rings=(0.34, 0.70), radii=(0.86, 0.74)),
              role="Oil")
    return p


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    hero = lod0("Full")
    xform = hero.fit(DIMS)

    pivot = of.add_pivot("bubble_pivot", (0.0, 0.0, 0.0), root)

    reported = []
    for vname, _, _, _, nmounds in LEVELS:
        for lod, maker in enumerate((lod0, lod1)):
            p = hero if (vname == "Full" and lod == 0) else maker(vname)
            if p is not hero:
                p.apply(xform)
            mb = of.MeshBuilder()
            p.into(mb, role_order=ORDER)
            mb.build("%s_%s_LOD%d" % (NAME, vname, lod), root)
            reported.append(("%s_LOD%d" % (vname, lod), mb))
        if nmounds:
            b = bulges(nmounds).apply(xform)
            mb = of.MeshBuilder()
            b.into(mb, role_order=ORDER)
            mb.build("%s_%s_Bulges" % (NAME, vname), pivot)
            reported.append(("%s_Bulges" % vname, mb))

    of.add_collision_box("col_" + NAME, DIMS, (0, 0, DIMS[2] * 0.5), root,
                         role="Rock")
    of.add_socket("socket_draw", (0.0, 0.0, 0.06), parent=root,
                  extras={"of_role": "draw"})
    of.add_socket("socket_item_pop", (0.0, -0.55, 0.22), parent=root,
                  extras={"of_role": "item_pop"})

    # Oil_Bubble, 1 to 97, loop. Scale swells the group while the Y rotation
    # tips it, so the -X mound rises as the +X mound sinks. Keys are unevenly
    # spaced and the peaks differ, so it seeps rather than ticks. Frame 1 is
    # the identity pose (see tree_common.py for why that is not optional).
    of.add_clip_multi(pivot, "Oil_Bubble", {
        "scale": [(1, (1.00, 1.00, 1.00)), (19, (1.03, 1.03, 1.11)),
                  (41, (1.01, 1.01, 1.02)), (58, (1.04, 1.04, 1.12)),
                  (78, (1.01, 1.01, 1.03)), (97, (1.00, 1.00, 1.00))],
        "rotation_euler": [(1, of.deg3()), (24, of.deg3(0.0, 3.5, 0.0)),
                           (49, of.deg3()), (73, of.deg3(0.0, -3.5, 0.0)),
                           (97, of.deg3())],
    })

    of.report(NAME, reported)
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
